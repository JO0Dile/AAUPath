// ---------------------------------------------------------------------------
// Admin API — the only thing in this project allowed to change published data.
//
// WHY THIS SHAPE
//
// The app is a static site on GitHub Pages. There is no server and no
// database, and adding one would undo the property the whole project is built
// on: it works offline, costs nothing, and cannot break for a student because
// some backend is down.
//
// So this Worker is not a database. It is an authenticated writer for the repo
// that already holds the data:
//
//   Admin dashboard  →  this Worker  →  GitHub commit into data/
//                                    →  CI rebuilds web/plans.json
//                                    →  Pages deploys
//                                    →  every user gets it on next load
//
// data/ stays the single source of truth. Nothing is duplicated, every change
// is a real commit with an author and a message, and any mistake is revertable
// with `git revert`. The cost is honesty about latency: a change is live in
// about a minute (CI + deploy), not instantly.
//
// SECURITY MODEL
//
//   - The password is never stored. Only a PBKDF2-SHA256 hash of it is, as an
//     encrypted Worker secret. Generate it with tools/hash-admin-password.py.
//   - Login returns an HMAC-signed session token with an expiry. There is no
//     session store to steal, and a token cannot be forged without the signing
//     secret, which also lives only as an encrypted secret.
//   - EVERY mutating request re-verifies that token server-side. The dashboard
//     cannot authorize itself: hiding a button in the UI is not access control,
//     so the UI does not pretend to be.
//   - The GitHub token stays here. It never reaches a browser. That is the
//     entire reason this Worker exists rather than the dashboard talking to
//     GitHub directly.
//   - Every payload is re-validated here against the real schema. The
//     dashboard's validation is a convenience for the admin, not a guarantee.
//
// SETUP
//   1. Paste this file into a new Cloudflare Worker, Deploy.
//   2. Settings → Variables:
//        ADMIN_USERNAME        (Secret)   e.g. dile  — a Secret, not a Variable:
//                                         a Variable is shown in plain text in the
//                                         Cloudflare dashboard to anyone with access
//                                         to the account, and half a credential is
//                                         still half a credential
//        ADMIN_PASSWORD_HASH   (Secret)   output of tools/hash-admin-password.py
//        SESSION_SECRET        (Secret)   any long random string
//        GITHUB_TOKEN          (Secret)   fine-grained PAT, Contents: Read+Write, this repo only
//        REPO_OWNER            (Variable) JO0Dile
//        REPO_NAME             (Variable) AAUPath
//        REPO_BRANCH           (Variable) main
//        ALLOWED_ORIGIN        (Variable) https://jo0dile.github.io
//        REQUIRE_CF_ACCESS     (Variable) LEAVE THIS UNSET until Cloudflare Access is
//                                         actually in front of the Worker. Setting it to 1
//                                         first makes every route return 404, including
//                                         your own login — the door locks with the key
//                                         still inside.
//   3. Put the Worker URL in APP_ADMIN_URL in web/js/01-catalogue.js.
// ---------------------------------------------------------------------------

const SESSION_TTL_SECONDS = 8 * 60 * 60;      // a working day, then log in again
const MAX_JSON_BYTES = 400 * 1024;            // one major file, generously
const MAX_IMAGE_BYTES = 512 * 1024;           // a logo, not a photograph
const LOGIN_DELAY_MS = 400;                   // blunts online password guessing

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

// An origin is scheme + host + port and nothing else. ALLOWED_ORIGIN is typed
// by hand, so it routinely arrives as the full app URL
// ("https://example.github.io/AAUPath/") or with a trailing slash — neither
// of which ever equals the Origin header a browser sends. The mismatch is
// invisible from the outside: the Worker keeps working in an address bar,
// because a top-level navigation sends no Origin at all, and only fetches from
// the page break. So the value is normalized down to a real origin rather than
// compared as a raw string.
function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '*') return raw;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function allowedOrigins(env) {
  // Comma-separated so a custom domain and the github.io address can both be
  // allowed without picking one.
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

// Echoes the caller's own origin when it is on the list, which is both more
// correct than a fixed string and what any future credentialed request would
// require. With nothing configured it falls back to '*' — open, but the
// password is what protects this, not the origin header.
function resolveOrigin(request, env) {
  const list = allowedOrigins(env);
  if (!list.length || list.includes('*')) return '*';
  const got = normalizeOrigin(request.headers.get('Origin') || '');
  if (got && list.includes(got)) return got;
  return list[0];
}

function corsHeaders(env, request) {
  return {
    'Access-Control-Allow-Origin': request ? resolveOrigin(request, env) : (allowedOrigins(env)[0] || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// no-store is not decoration. Without it these replies carry no cache
// directives and no validators, so a browser is free to apply heuristic
// freshness and hand the dashboard a minutes-old copy of a university. The
// dashboard renders its form from that copy and Save posts the whole object
// back — which silently reverts every edit made in between. That is exactly
// what happened: five consecutive saves each rewrote the file to a
// byte-identical *earlier* version, undoing a logo and a description that had
// saved correctly minutes before. Nothing here is cacheable by nature; the
// only correct freshness for an editing surface is none.
function json(body, status, env, request) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...corsHeaders(env, request),
    },
  });
}

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64decode(pad + '==='.slice((pad.length + 3) % 4));
}

// Standard base64 → bytes. GitHub returns line-wrapped standard base64, which
// is a different alphabet from the URL-safe one used for tokens.
function b64decode(s) {
  const bin = atob(String(s).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Chunked on purpose: btoa(String.fromCharCode(...bytes)) spreads every byte
// as a separate argument, which overflows the call stack somewhere around a
// hundred KB — so it works on a small JSON file and then fails on the first
// real logo anyone uploads.
function b64encode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// Length-independent comparison. A plain === on secrets leaks their prefix
// through timing; this always walks the whole thing.
function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads a JSON body with a hard ceiling. Without one, a single request can
// pin the Worker's memory and CPU before any validation gets a chance to run,
// which is the cheapest denial of service there is against an authenticated
// endpoint. Content-Length is only a hint, so the decoded text is checked too.
async function readJson(request, limit) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared && declared > limit) throw fail(`request body is too large (limit ${Math.round(limit / 1024)} KB)`);
  const text = await request.text();
  if (text.length > limit) throw fail(`request body is too large (limit ${Math.round(limit / 1024)} KB)`);
  try { return JSON.parse(text); } catch { throw fail('request body is not valid JSON'); }
}

// ---------------------------------------------------------------------------
// password hashing + session tokens
// ---------------------------------------------------------------------------

// PBKDF2 in chunks of at most CHUNK iterations, each one taking the previous
// chunk's output as its input key material with the same salt.
//
// Cloudflare Workers refuses any single deriveBits call above 100,000:
//
//   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
//   supported (requested 600000).
//
// Lowering the target to fit would weaken every password by a factor of six.
// Six chunks of 100,000 cost an attacker exactly what one 600,000 pass costs,
// and no single call ever exceeds what the platform allows.
//
// This must stay byte-for-byte identical to derive() in
// tools/hash-admin-password.py and the copy in web/keygen.html — a mismatch
// means a hash generated by one will not verify in the other, which looks
// exactly like a wrong password and is unusually painful to track down.
const PBKDF2_CHUNK = 100000;

async function deriveChunked(passwordBytes, salt, total) {
  let material = passwordBytes;
  let remaining = total;
  let bits = null;
  while (remaining > 0) {
    const n = Math.min(PBKDF2_CHUNK, remaining);
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: n, hash: 'SHA-256' }, key, 256,
    );
    material = new Uint8Array(bits);
    remaining -= n;
  }
  return bits;
}

// Stored form: pbkdf2$<iterations>$<saltB64url>$<hashB64url>
// Same string tools/hash-admin-password.py prints, so the two cannot drift.
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  // A stored hash is pasted by hand, so it is exactly where malformed base64
  // comes from — and atob() throws rather than returning null. An exception
  // here used to escape as a Cloudflare 1101 page, which carries no CORS
  // headers, so the browser reported the completely misleading "Failed to
  // fetch" instead of "wrong password".
  try {
    const salt = unb64url(parts[2]);
    const bits = await deriveChunked(enc.encode(password), salt, iterations);
    return timingSafeEqual(b64url(bits), parts[3]);
  } catch (e) {
    // Kept as "wrong password" rather than an error: a stored hash is pasted by
    // hand and malformed base64 makes atob() throw, which must never reach the
    // caller as anything other than a failed login.
    console.error('verifyPassword:', e && e.message ? e.message : e);
    return false;
  }
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function issueToken(username, env) {
  const payload = { u: username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

// Returns the username, or null. Never throws on malformed input — a bad token
// is an ordinary 401, not a 500.
async function verifyToken(token, env) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(env.SESSION_SECRET), unb64url(sig), enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!payload || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.u || null;
  } catch {
    return null;
  }
}

// The gate every mutating route goes through. Returns null when authorized,
// or the Response to send back when not — so a route cannot forget to stop.
async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await verifyToken(token, env);
  if (!user) return json({ error: 'unauthorized' }, 401, env, request);
  return null;
}

// ---------------------------------------------------------------------------
// GitHub contents API
// ---------------------------------------------------------------------------

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'studyplan-admin-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function ghUrl(env, path) {
  return `https://api.github.com/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;
}

// Every read here is a read-before-write: whatever comes back is edited and
// committed straight over the top. A cached response therefore does not cost
// freshness, it costs data. Cloudflare will happily serve a subrequest from
// its edge cache, so the URL carries a unique parameter (GitHub ignores
// unknown query params) and the request opts out of caching explicitly.
async function ghGet(env, path) {
  const branch = env.REPO_BRANCH || 'main';
  const url = `${ghUrl(env, path)}?ref=${encodeURIComponent(branch)}&_=${Date.now()}`;
  const r = await fetch(url, {
    headers: { ...ghHeaders(env), 'Cache-Control': 'no-cache' },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (r.status === 404) return { exists: false };
  if (!r.ok) throw new Error(`github GET ${path}: ${r.status} ${await r.text()}`);
  const meta = await r.json();
  return { exists: true, sha: meta.sha, text: new TextDecoder().decode(b64decode(meta.content || '')) };
}

async function ghPut(env, path, contentBytes, message, sha) {
  const body = {
    message,
    content: b64encode(contentBytes),
    branch: env.REPO_BRANCH || 'main',
  };
  if (sha) body.sha = sha;
  const r = await fetch(ghUrl(env, path), {
    method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`github PUT ${path}: ${r.status} ${await r.text()}`);
  const out = await r.json();
  // The file's new sha, not the commit's. This is what the next save has to
  // send back as its baseSha, so an admin can press Save twice in a row
  // without the second one looking like a conflict.
  return out.content ? out.content.sha : null;
}

async function ghDelete(env, path, message, sha) {
  const r = await fetch(ghUrl(env, path), {
    method: 'DELETE', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: env.REPO_BRANCH || 'main' }),
  });
  if (!r.ok) throw new Error(`github DELETE ${path}: ${r.status} ${await r.text()}`);
  return true;
}

async function ghList(env, path) {
  const branch = env.REPO_BRANCH || 'main';
  const r = await fetch(`${ghUrl(env, path)}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`github LIST ${path}: ${r.status}`);
  const items = await r.json();
  return Array.isArray(items) ? items : [];
}

// Writing JSON goes through here so every file this Worker commits is
// formatted the same way tools/build-catalogue.py and the repo already use —
// otherwise every admin edit would show up as a whole-file diff.
function jsonBytes(obj) {
  return enc.encode(JSON.stringify(obj, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// validation — the dashboard is not trusted, so everything is re-checked here
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const CATEGORIES = ['skills', 'core', 'math', 'dept', 'eng', 'uni', 'free'];

function str(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max || 300);
}

function fail(msg) {
  const e = new Error(msg);
  e.userFacing = true;
  return e;
}

// An empty box means "unplaced", not zero — zero is a real position that would
// jump the major to the front. Anything that is not a finite number (a typo, a
// pasted word) is treated as unplaced rather than rejected, so a bad keystroke
// in one field cannot block saving an otherwise valid plan.
function sortOrderOf(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Placed majors first in the admin's chosen order, then everything unplaced
// alphabetically — the order students see on the home page, so what the
// dashboard lists top to bottom is what the tiles do.
function byDisplayOrder(a, b) {
  const ao = sortOrderOf(a.sortOrder);
  const bo = sortOrderOf(b.sortOrder);
  if (ao !== null && bo !== null && ao !== bo) return ao - bo;
  if (ao !== null && bo === null) return -1;
  if (ao === null && bo !== null) return 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

// Save posts the *whole* object, so a form rendered from an out-of-date read
// does not merely fail to add something — it actively reverts everything saved
// since. There is no way to detect that from the payload alone: a description
// the admin deliberately cleared and one that was never loaded look identical.
//
// So the read hands out the file's sha and the save has to hand it back. If it
// no longer matches, the base moved and the payload describes a world that no
// longer exists — refuse it and say so, rather than committing a silent
// rollback. Saves sent without a baseSha are still accepted: an older
// dashboard, or a first-time create, must keep working.
function staleBase(body, existing, env, request) {
  const sent = body && typeof body.baseSha === 'string' ? body.baseSha : '';
  if (!sent || !existing.exists || sent === existing.sha) return null;
  return json({
    error: 'This changed since you opened it, so saving now would undo that change. ' +
           'Reload the editor and reapply your edit.',
    conflict: true,
    currentSha: existing.sha,
  }, 409, env, request);
}

function validUniversity(u) {
  if (!u || typeof u !== 'object') throw fail('university must be an object');
  if (!SLUG_RE.test(String(u.slug || ''))) throw fail('invalid university slug');
  if (!str(u.name).trim()) throw fail('university needs a name');
  const colleges = Array.isArray(u.colleges) ? u.colleges : [];
  for (const c of colleges) {
    if (!SLUG_RE.test(String(c.slug || ''))) throw fail(`invalid college slug: ${c.slug}`);
    if (!str(c.name).trim()) throw fail(`college ${c.slug} needs a name`);
  }
  return {
    schemaVersion: 1,
    slug: u.slug,
    name: str(u.name, 140),
    nameAr: str(u.nameAr, 140),
    shortName: str(u.shortName, 24) || String(u.slug).toUpperCase(),
    icon: str(u.icon, 8) || '🏛️',
    iconKey: str(u.iconKey, 40),
    website: str(u.website, 200),
    country: u.country == null ? null : str(u.country, 80),
    logoUrl: str(u.logoUrl, 300),
    description: u.description == null ? null : str(u.description, 2000),
    imageUrl: str(u.imageUrl, 300),
    colleges: colleges.map((c) => ({
      slug: c.slug,
      name: str(c.name, 160),
      nameAr: str(c.nameAr, 160),
      icon: str(c.icon, 8) || '🏫',
      iconKey: str(c.iconKey, 40),
      imageUrl: str(c.imageUrl, 300),
    })),
  };
}

function validMajor(m) {
  if (!m || typeof m !== 'object') throw fail('major must be an object');
  if (!SLUG_RE.test(String(m.slug || ''))) throw fail('invalid major slug');
  if (!str(m.name).trim()) throw fail('major needs a name');
  if (!SLUG_RE.test(String(m.university || ''))) throw fail('major needs a university slug');

  const years = Array.isArray(m.years) ? m.years : [];
  const yearIds = new Set();
  for (const y of years) {
    if (!SLUG_RE.test(String(y.id || ''))) throw fail(`invalid year id: ${y.id}`);
    yearIds.add(y.id);
  }

  const courses = Array.isArray(m.courses) ? m.courses : [];
  const seen = new Set();
  const courseIds = new Set();
  for (const c of courses) {
    if (!SLUG_RE.test(String(c.id || ''))) throw fail(`invalid course id: ${c.id}`);
    if (seen.has(c.id)) throw fail(`duplicate course id: ${c.id}`);
    seen.add(c.id);
    courseIds.add(c.id);
    if (!str(c.name).trim()) throw fail(`course ${c.id} needs a name`);
    const ch = Number(c.creditHours);
    if (!Number.isFinite(ch) || ch < 0 || ch > 20) throw fail(`course ${c.id}: credit hours must be 0–20`);
    if (c.category && !CATEGORIES.includes(c.category)) throw fail(`course ${c.id}: unknown category ${c.category}`);
    if (years.length && c.yearId && !yearIds.has(c.yearId)) throw fail(`course ${c.id}: unknown year ${c.yearId}`);
  }

  // Prerequisites are validated as a graph, not just as pairs: a cycle would
  // make a course permanently unreachable and silently break the whole plan.
  const prereqs = Array.isArray(m.prerequisites) ? m.prerequisites : [];
  const adj = new Map();
  for (const pair of prereqs) {
    if (!Array.isArray(pair) || pair.length !== 2) throw fail('each prerequisite must be [before, after]');
    const [a, b] = pair;
    if (!courseIds.has(a)) throw fail(`prerequisite refers to unknown course: ${a}`);
    if (!courseIds.has(b)) throw fail(`prerequisite refers to unknown course: ${b}`);
    if (a === b) throw fail(`course ${a} cannot be its own prerequisite`);
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map();
  const walk = (n) => {
    colour.set(n, GREY);
    for (const next of adj.get(n) || []) {
      const c = colour.get(next) || WHITE;
      if (c === GREY) throw fail(`prerequisites form a loop through ${next}`);
      if (c === WHITE) walk(next);
    }
    colour.set(n, BLACK);
  };
  for (const n of adj.keys()) if ((colour.get(n) || WHITE) === WHITE) walk(n);

  const out = {
    schemaVersion: 1,
    slug: m.slug,
    university: m.university,
    college: str(m.college, 60),
    name: str(m.name, 200),
    nameAr: str(m.nameAr, 200),
    subtitle: str(m.subtitle, 200),
    subtitleAr: str(m.subtitleAr, 200),
    icon: str(m.icon, 8) || '🎓',
    iconKey: str(m.iconKey, 40),
    imageUrl: str(m.imageUrl, 300),
    bio: str(m.bio, 2000),
    bioAr: str(m.bioAr, 2000),
    degreeHours: m.degreeHours == null ? null : Number(m.degreeHours) || null,
    // Where this major sits among its faculty's tiles on the home page. Null
    // means "unplaced", which sorts alphabetically after everything numbered,
    // so adding an order to one major never scrambles the rest.
    sortOrder: sortOrderOf(m.sortOrder),
    freeElectiveSuggestions: Array.isArray(m.freeElectiveSuggestions) ? m.freeElectiveSuggestions : [],
    years: years.map((y) => ({ id: y.id, hasSummer: !!y.hasSummer })),
    courses: courses.map((c) => ({
      id: c.id,
      courseNumber: str(c.courseNumber, 30),
      name: str(c.name, 200),
      nameAr: str(c.nameAr, 200),
      creditHours: Number(c.creditHours) || 0,
      category: CATEGORIES.includes(c.category) ? c.category : 'core',
      yearId: str(c.yearId, 20),
      // Empty is a real value: a course the plan deliberately does not schedule.
      // Defaulting it to s1 silently moved every department elective into
      // Semester 1 the first time a major was saved.
      semester: ['s1', 's2', 's3', 'summer'].includes(c.semester) ? c.semester
        : (c.semester === '' || c.semester == null ? '' : 's1'),
      description: str(c.description, 2000),
    })),
    prerequisites: prereqs.map((p) => [p[0], p[1]]),
  };
  return out;
}


// ---------------------------------------------------------------------------
// data/ schema  <->  dashboard schema
// ---------------------------------------------------------------------------
// A major file under data/ is authored in the shape tools/build-catalogue.py
// reads: slug/code/credits/year/semester and an UPPER_CASE category, with
// prerequisites as {requires, forCourse} objects and no years array at all
// (years are derived from where the courses sit). The dashboard works in the
// shape the app itself uses: id/courseNumber/creditHours/yearId/semester with
// lower-case categories and [before, after] pairs.
//
// Nothing translated between them, so every field the dashboard read was
// undefined: no course codes, no credit hours, no years, every category
// falling back to the first option, and every prerequisite resolving to the
// first course in the list because both ids were undefined. Editing was
// impossible and saving would have rewritten real plans into rubbish.
//
// Both directions live here, next to each other, because they are one contract
// and drift between them is silent.

const CATEGORY_TO_APP = {
  CORE: 'core', MATH: 'math', DEPARTMENT_ELECTIVE: 'dept', UNIVERSITY_ELECTIVE: 'uni',
  FREE_ELECTIVE: 'free', UNIVERSITY_REQUIREMENT: 'skills', ENGLISH: 'eng',
};
const CATEGORY_TO_DATA = Object.fromEntries(
  Object.entries(CATEGORY_TO_APP).map(([k, v]) => [v, k]),
);

function toEditable(stored) {
  const courses = Array.isArray(stored.courses) ? stored.courses : [];
  const years = {};
  for (const c of courses) {
    if (c.year == null) continue;
    years[`y${c.year}`] = years[`y${c.year}`] || Number(c.semester) === 3;
  }
  return {
    schemaVersion: stored.schemaVersion || 1,
    slug: stored.slug,
    university: stored.university,
    college: stored.college || '',
    name: stored.name || '',
    nameAr: stored.nameAr || '',
    subtitle: stored.subtitle || '',
    subtitleAr: stored.subtitleAr || '',
    icon: stored.icon || '',
    iconKey: stored.iconKey || '',
    imageUrl: stored.imageUrl || '',
    bio: stored.bio || '',
    bioAr: stored.bioAr || '',
    degreeHours: stored.degreeHours == null ? null : stored.degreeHours,
    sortOrder: sortOrderOf(stored.sortOrder),
    freeElectiveSuggestions: stored.freeElectiveSuggestions || [],
    years: Object.keys(years)
      .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))
      .map((id) => ({ id, hasSummer: years[id] })),
    courses: courses.map((c) => ({
      id: c.slug,
      courseNumber: c.code == null ? '' : String(c.code),
      name: c.name || '',
      nameAr: c.nameAr || '',
      // credits is a string in data/ ("2"), a number everywhere else.
      creditHours: Number(c.credits) || 0,
      category: CATEGORY_TO_APP[c.category] || 'core',
      // A null year means the plan deliberately does not schedule this course —
      // a department elective you choose. That must survive the round trip as
      // empty, not be invented into year one.
      yearId: c.year == null ? '' : `y${c.year}`,
      semester: c.semester == null ? '' : `s${c.semester}`,
      description: c.description || '',
    })),
    prerequisites: (Array.isArray(stored.prerequisites) ? stored.prerequisites : [])
      .map((p) => [p.requires, p.forCourse])
      .filter((p) => p[0] && p[1]),
  };
}

// `original` is the file as it sits in data/. Every course field the dashboard
// does not show — theoretical/practical hours, isElective, pairGroup,
// prerequisiteText, independentGrades — is carried through from it untouched.
// Rebuilding a course from only the edited fields would quietly delete the
// rest, and lab pairing and the assessment breakdown depend on them.
function toStored(edited, original) {
  const prev = {};
  for (const c of (original && original.courses) || []) prev[c.slug] = c;

  return {
    ...original,
    schemaVersion: original && original.schemaVersion ? original.schemaVersion : 1,
    slug: edited.slug,
    university: edited.university,
    college: edited.college,
    name: edited.name,
    nameAr: edited.nameAr,
    subtitle: edited.subtitle,
    subtitleAr: edited.subtitleAr,
    icon: edited.icon,
    iconKey: edited.iconKey,
    imageUrl: edited.imageUrl,
    bio: edited.bio,
    bioAr: edited.bioAr,
    degreeHours: edited.degreeHours,
    sortOrder: edited.sortOrder,
    freeElectiveSuggestions: edited.freeElectiveSuggestions,
    courses: edited.courses.map((c) => ({
      ...(prev[c.id] || {}),
      slug: c.id,
      code: c.courseNumber || null,
      name: c.name,
      nameAr: c.nameAr,
      // Kept as a string to match every other row in these files; a mixed-type
      // column would show up as noise in every future diff.
      credits: String(c.creditHours),
      category: CATEGORY_TO_DATA[c.category] || 'CORE',
      year: c.yearId ? parseInt(c.yearId.slice(1), 10) : null,
      semester: c.semester ? parseInt(c.semester.slice(1), 10) : null,
    })),
    prerequisites: edited.prerequisites.map(([requires, forCourse]) => ({ requires, forCourse })),
  };
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

async function handleLogin(request, env) {
  // A fixed delay on every attempt, success or failure. It is not rate
  // limiting — a Worker has no shared memory to count with — but it makes an
  // online guessing run thousands of times slower without affecting a human.
  await sleep(LOGIN_DELAY_MS);

  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return json({ error: 'admin not configured on the server' }, 500, env, request);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400, env, request); }

  const userOk = timingSafeEqual(String(body.username || ''), env.ADMIN_USERNAME);
  const passOk = await verifyPassword(String(body.password || ''), env.ADMIN_PASSWORD_HASH);

  // Both checks always run, and the message never says which one failed.
  if (!userOk || !passOk) return json({ error: 'invalid username or password' }, 401, env, request);

  return json({
    ok: true,
    token: await issueToken(env.ADMIN_USERNAME, env),
    username: env.ADMIN_USERNAME,
    expiresIn: SESSION_TTL_SECONDS,
  }, 200, env);
}

async function handleTree(env, request) {
  const index = await ghGet(env, 'data/universities.json');
  if (!index.exists) return json({ error: 'data/universities.json not found' }, 500, env, request);
  const parsed = JSON.parse(index.text);

  const universities = [];
  for (const u of parsed.universities || []) {
    const majors = await ghList(env, `data/${u.slug}/majors`);
    universities.push({
      ...u,
      published: u.published !== false,
      majors: majors
        .filter((f) => f.name.endsWith('.json'))
        .map((f) => ({ slug: f.name.replace(/\.json$/, ''), path: f.path })),
    });
  }
  return json({ ok: true, universities }, 200, env, request);
}

// The tree lists major *slugs* and nothing else, which is all it can afford:
// it walks every university, and reading each major file there would cost one
// subrequest per major across the whole catalogue. That was fine while the
// dashboard only ever showed a flat list — and it is exactly why the flat list
// was all it could show. There was no way to display a major's real name, and
// no way to group majors under the faculty they belong to, because the tree
// did not know either.
//
// This reads the metadata for ONE university's majors, so the cost is bounded
// by that university rather than by the catalogue, and it is only paid when
// someone opens that university. Course lists are deliberately not included:
// they are the bulk of a major file and the browser does not need them here.
async function handleMajorsMeta(env, uni, request) {
  if (!SLUG_RE.test(uni)) return json({ error: 'bad slug' }, 400, env, request);
  const files = (await ghList(env, `data/${uni}/majors`)).filter((f) => f.name.endsWith('.json'));

  const majors = [];
  for (const f of files) {
    const slug = f.name.replace(/\.json$/, '');
    try {
      const raw = await ghGet(env, f.path);
      const m = raw.exists ? JSON.parse(raw.text) : {};
      majors.push({
        slug,
        name: m.name || slug,
        nameAr: m.nameAr || '',
        college: m.college || '',
        icon: m.icon || '',
        iconKey: m.iconKey || '',
        imageUrl: m.imageUrl || '',
        sortOrder: sortOrderOf(m.sortOrder),
        courseCount: Array.isArray(m.courses) ? m.courses.length : 0,
      });
    } catch (e) {
      // One malformed file must not blank the whole browser. Listing it under
      // its slug keeps it reachable, which is the only way it can be fixed.
      console.error(`majors meta ${uni}/${slug}:`, e && e.message ? e.message : e);
      majors.push({ slug, name: slug, nameAr: '', college: '', icon: '', iconKey: '', imageUrl: '', sortOrder: null, courseCount: 0, unreadable: true });
    }
  }
  majors.sort(byDisplayOrder);
  return json({ ok: true, majors }, 200, env, request);
}

async function handleGetUniversity(env, slug, request) {
  if (!SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  const f = await ghGet(env, `data/${slug}/university.json`);
  if (!f.exists) return json({ error: 'not found' }, 404, env, request);
  return json({ ok: true, university: JSON.parse(f.text), sha: f.sha }, 200, env, request);
}

async function handlePutUniversity(request, env, slug) {
  if (!SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  const body = await readJson(request, MAX_JSON_BYTES);
  const clean = validUniversity({ ...body.university, slug });

  // A save that quietly drops a field is indistinguishable from one that never
  // carried it, and that ambiguity cost a logo and a description before anyone
  // could see it happening. One line in the Worker's log makes every save
  // answerable after the fact without exposing anything sensitive.
  console.log(`PUT university ${slug}: logoUrl=${JSON.stringify(clean.logoUrl)} ` +
              `iconKey=${JSON.stringify(clean.iconKey)} descLen=${(clean.description || '').length} ` +
              `colleges=${clean.colleges.length} baseSha=${body.baseSha ? 'sent' : 'absent'}`);

  const path = `data/${slug}/university.json`;
  const existing = await ghGet(env, path);
  const conflict = staleBase(body, existing, env, request);
  if (conflict) return conflict;
  const newSha = await ghPut(env, path, jsonBytes(clean), `admin: update ${slug} university info`, existing.sha);

  // The index carries the tile-level fields, so it has to move with the file
  // or the home screen and the detail page disagree.
  const idxPath = 'data/universities.json';
  const idx = await ghGet(env, idxPath);
  const parsed = JSON.parse(idx.text);
  const row = (parsed.universities || []).find((u) => u.slug === slug);
  if (row) {
    row.name = clean.name;
    row.nameAr = clean.nameAr;
    row.shortName = clean.shortName;
    row.icon = clean.icon;
    row.collegeCount = clean.colleges.length;
    if (typeof body.published === 'boolean') {
      if (body.published) delete row.published; else row.published = false;
    }
  } else {
    parsed.universities.push({
      slug, name: clean.name, nameAr: clean.nameAr, shortName: clean.shortName,
      icon: clean.icon, collegeCount: clean.colleges.length,
      ...(body.published === false ? { published: false } : {}),
    });
  }
  await ghPut(env, idxPath, jsonBytes(parsed), `admin: update ${slug} in the university index`, idx.sha);
  return json({ ok: true, university: clean, sha: newSha }, 200, env, request);
}

async function handleDeleteUniversity(env, slug, request) {
  if (!SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  // Unpublishing, not deleting. Removing the folder would throw away every
  // major transcribed under it, and the build already honours this flag.
  const idxPath = 'data/universities.json';
  const idx = await ghGet(env, idxPath);
  const parsed = JSON.parse(idx.text);
  const row = (parsed.universities || []).find((u) => u.slug === slug);
  if (!row) return json({ error: 'not found' }, 404, env, request);
  row.published = false;
  await ghPut(env, idxPath, jsonBytes(parsed), `admin: unpublish ${slug}`, idx.sha);
  return json({ ok: true, unpublished: slug, note: 'files kept in data/; set published:true to restore' }, 200, env, request);
}

async function handleGetMajor(env, uni, slug, request) {
  if (!SLUG_RE.test(uni) || !SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  const f = await ghGet(env, `data/${uni}/majors/${slug}.json`);
  if (!f.exists) return json({ error: 'not found' }, 404, env, request);
  return json({ ok: true, major: toEditable(JSON.parse(f.text)), sha: f.sha }, 200, env, request);
}

async function handlePutMajor(request, env, uni, slug) {
  if (!SLUG_RE.test(uni) || !SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  const body = await readJson(request, MAX_JSON_BYTES);
  const clean = validMajor({ ...body.major, slug, university: uni });
  const path = `data/${uni}/majors/${slug}.json`;
  const existing = await ghGet(env, path);
  const conflict = staleBase(body, existing, env, request);
  if (conflict) return conflict;
  const original = existing.exists ? JSON.parse(existing.text) : null;
  const verb = existing.exists ? 'update' : 'add';
  const newSha = await ghPut(env, path, jsonBytes(toStored(clean, original)),
    `admin: ${verb} ${uni}/${slug}`, existing.sha);
  // Hands back the editable shape, so the dashboard's in-memory copy stays in
  // the vocabulary it was working in rather than flipping to the stored one.
  return json({ ok: true, major: clean, created: !existing.exists, sha: newSha }, 200, env, request);
}

async function handleDeleteMajor(env, uni, slug, request) {
  if (!SLUG_RE.test(uni) || !SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  const path = `data/${uni}/majors/${slug}.json`;
  const f = await ghGet(env, path);
  if (!f.exists) return json({ error: 'not found' }, 404, env, request);
  await ghDelete(env, path, `admin: remove ${uni}/${slug}`, f.sha);
  return json({ ok: true, removed: `${uni}/${slug}`, note: 'recoverable with git revert' }, 200, env, request);
}

// PNG/JPEG/SVG uploads land in web/assets/uploads/ so they deploy with the
// site and are precached like everything else — an uploaded logo keeps working
// offline, which an external image URL would not.
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

async function handleUpload(request, env) {
  // base64 inflates by ~4/3, plus the JSON envelope.
  const body = await readJson(request, Math.ceil(MAX_IMAGE_BYTES * 1.4) + 4096);
  const ext = IMAGE_TYPES[body.contentType];
  if (!ext) return json({ error: 'only PNG, JPEG, WebP or SVG' }, 400, env, request);

  const name = String(body.name || '').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const base = name.replace(/\.[a-z0-9]+$/, '') || `asset-${Date.now()}`;
  const filename = `${base}.${ext}`;

  let bytes;
  try {
    bytes = b64decode(String(body.dataBase64 || '').replace(/^data:[^,]+,/, ''));
  } catch {
    return json({ error: 'image data is not valid base64' }, 400, env, request);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return json({ error: `image is ${Math.round(bytes.length / 1024)} KB; the limit is ${MAX_IMAGE_BYTES / 1024} KB` }, 413, env, request);
  }
  // An SVG is a document, not just pixels — it can carry script. Rejected
  // outright rather than sanitized, because a half-sanitized SVG served from
  // the app's own origin is a stored XSS on every user.
  if (ext === 'svg') {
    const text = new TextDecoder().decode(bytes);
    if (/<script|on[a-z]+\s*=|javascript:|<foreignObject/i.test(text)) {
      return json({ error: 'that SVG contains script or event handlers and was rejected' }, 400, env, request);
    }
  }

  const path = `web/assets/uploads/${filename}`;
  const existing = await ghGet(env, path);
  await ghPut(env, path, bytes, `admin: upload ${filename}`, existing.sha);
  return json({
    ok: true, filename, path,
    url: `assets/uploads/${filename}`,
    bytes: bytes.length,
    replaced: existing.exists,
  }, 200, env);
}

async function handleListAssets(env, request) {
  const items = await ghList(env, 'web/assets/uploads');
  return json({
    ok: true,
    assets: items.filter((f) => f.type === 'file').map((f) => ({
      filename: f.name, url: `assets/uploads/${f.name}`, bytes: f.size,
    })),
  }, 200, env);
}

async function handleDeleteAsset(env, filename, request) {
  const safe = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return json({ error: 'bad filename' }, 400, env, request);
  const path = `web/assets/uploads/${safe}`;
  const f = await ghGet(env, path);
  if (!f.exists) return json({ error: 'not found' }, 404, env, request);
  await ghDelete(env, path, `admin: delete asset ${safe}`, f.sha);
  return json({ ok: true, removed: safe }, 200, env, request);
}

// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const seg = path.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    // Unauthenticated, and deliberately almost silent. An earlier version
    // reported whether an admin was configured and which repo it wrote to,
    // which is a free reconnaissance answer for anyone who finds this URL:
    // it confirms an admin account exists and names the target. The only
    // thing an anonymous caller now learns is that a Worker is running.
    // Everything useful moved behind the session, into /api/status.
    if (path === '/api/health' || path === '/health') {
      // originAllowed is the one diagnostic worth exposing without a password.
      // A CORS rejection is otherwise completely opaque from the browser side —
      // it reports a failed request and refuses to say why — and the caller
      // already knows its own origin, so telling it whether that origin is on
      // the list reveals nothing it could not infer. Without this, a
      // misconfigured ALLOWED_ORIGIN is indistinguishable from a Worker that
      // was never deployed.
      const seen = normalizeOrigin(request.headers.get('Origin') || '');
      return json({
        ok: true,
        origin: seen || null,
        originAllowed: !seen || allowedOrigins(env).length === 0 ||
                       allowedOrigins(env).includes('*') || allowedOrigins(env).includes(seen),
        // True only when the gate is on AND this caller is not carrying an
        // Access assertion — i.e. exactly when every other route will 404 on
        // them. Saying so reveals only that the Worker is protected, which is
        // not a secret, and turns a dead end into a one-line fix.
        accessGateBlocking: env.REQUIRE_CF_ACCESS === '1' &&
                            !request.headers.get('Cf-Access-Jwt-Assertion'),
      }, 200, env, request);
    }

    // OPTIONAL SECOND GATE — Cloudflare Access (free for up to 50 users).
    // With Access in front of this Worker, Cloudflare authenticates the person
    // BEFORE any request reaches this code, and stamps a signed assertion
    // header. Set REQUIRE_CF_ACCESS=1 and an anonymous request cannot even
    // reach the password prompt, let alone guess at it. Without it, the
    // password is the only thing standing here — which is why the setup guide
    // recommends turning it on.
    if (env.REQUIRE_CF_ACCESS === '1' && !request.headers.get('Cf-Access-Jwt-Assertion')) {
      // Turning this on BEFORE Cloudflare Access is actually in front of the
      // Worker locks the door with the key still inside: nothing sends that
      // header, so every route 404s and the sign-in screen reports "not found"
      // — which reads as a bug in the app rather than as a setting that was
      // switched on too early. The 404 is kept (that is the point of the gate),
      // but /api/health below now says the gate is what answered, so the
      // dashboard can name the variable instead of leaving it to be guessed.
      return json({ error: 'not found' }, 404, env, request);
    }

    // Every handler below is `return await`, never a bare `return`. Returning
    // an async handler's promise un-awaited hands it straight out of this try,
    // so a rejection skips the catch entirely and escapes as Cloudflare's own
    // HTML error page — which carries no CORS header, so the browser reports a
    // CORS block instead of the real failure. An expired GITHUB_TOKEN showed up
    // exactly that way: "blocked by CORS policy" on a 500 from /api/tree.
    try {
      if (path === '/api/login' && request.method === 'POST') return await handleLogin(request, env);

      // Everything past this line requires a valid session. One gate, checked
      // before the route is even chosen, so no handler can be reached unguarded.
      const denied = await requireAdmin(request, env);
      if (denied) return denied;

      if (path === '/api/me' || path === '/api/status') {
        return json({
          ok: true,
          username: env.ADMIN_USERNAME,
          canWrite: !!(env.GITHUB_TOKEN && env.REPO_OWNER && env.REPO_NAME),
          repo: env.REPO_OWNER && env.REPO_NAME ? `${env.REPO_OWNER}/${env.REPO_NAME}` : null,
          branch: env.REPO_BRANCH || 'main',
        }, 200, env);
      }
      if (path === '/api/tree' && request.method === 'GET') return await handleTree(env, request);

      // /api/majors/:university — names and faculties for one university's
      // majors, so the browser can group them. Must be tested before the
      // /api/major/ routes below, which are a different (singular) path.
      if (seg[1] === 'majors' && seg[2] && request.method === 'GET') {
        return await handleMajorsMeta(env, seg[2], request);
      }

      // /api/university/:slug
      if (seg[1] === 'university' && seg[2]) {
        if (request.method === 'GET') return await handleGetUniversity(env, seg[2], request);
        if (request.method === 'PUT') return await handlePutUniversity(request, env, seg[2]);
        if (request.method === 'DELETE') return await handleDeleteUniversity(env, seg[2], request);
      }

      // /api/major/:university/:slug
      if (seg[1] === 'major' && seg[2] && seg[3]) {
        if (request.method === 'GET') return await handleGetMajor(env, seg[2], seg[3], request);
        if (request.method === 'PUT') return await handlePutMajor(request, env, seg[2], seg[3]);
        if (request.method === 'DELETE') return await handleDeleteMajor(env, seg[2], seg[3], request);
      }

      // /api/assets  ·  /api/assets/:filename
      if (seg[1] === 'assets') {
        if (request.method === 'GET' && !seg[2]) return await handleListAssets(env, request);
        if (request.method === 'POST' && !seg[2]) return await handleUpload(request, env);
        if (request.method === 'DELETE' && seg[2]) return await handleDeleteAsset(env, seg[2], request);
      }

      return json({ error: 'not found' }, 404, env, request);
    } catch (err) {
      // EVERY exit from this Worker must carry CORS headers, including the
      // failures. An uncaught throw returns Cloudflare's own 1101 page, which
      // has none — and a browser cannot read a response it is not allowed to
      // read, so it reports the request as having failed outright. That is why
      // a genuine server error used to surface in the dashboard as the
      // completely misleading "Failed to fetch", pointing at the network
      // instead of at the actual bug.
      //
      // A validation failure is the admin's problem and is worth reading; a
      // GitHub or runtime failure is not, and its text can contain the repo
      // path or token scope, so it is logged rather than returned.
      if (err && err.userFacing) return json({ error: err.message }, 400, env, request);
      console.error('admin worker error:', err && err.stack ? err.stack : err);
      return json({ error: 'something went wrong on the server — check the Worker logs' }, 500, env, request);
    }
  },
};
