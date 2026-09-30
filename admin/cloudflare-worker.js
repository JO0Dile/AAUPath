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
//   4. Optional — staff logins for deans and professors: Settings → Bindings →
//      add a D1 database binding named STAFF_DB (the studyplan-cloud database
//      is fine; it gets its own `staff` table). Without it, the admin room's
//      Staff logins page says so and nothing else changes.
// ---------------------------------------------------------------------------

// Which commit this Worker was deployed from. .github/workflows/
// deploy-workers.yml writes it in on every deploy; a copy pasted by hand
// keeps the placeholder, which the admin room reads as "version unknown".
// GET /__version answers with it, so the admin room can tell whether each
// Worker is up to date.
const WORKER_BUILD = '__WORKER_BUILD__';

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
    // PATCH too: staff logins are changed with it (Save, Pause, New link).
    // Without it here the browser drops the reply before the page sees it.
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

// The same file as it was at an earlier commit (round 8, idea 30: the
// change history). Read-only: nothing is ever written from this.
async function ghGetAt(env, path, ref) {
  const r = await fetch(`${ghUrl(env, path)}?ref=${encodeURIComponent(ref)}`, { headers: ghHeaders(env) });
  if (r.status === 404) return { exists: false };
  if (!r.ok) throw new Error(`github GET ${path}@${ref}: ${r.status}`);
  const meta = await r.json();
  return { exists: true, text: new TextDecoder().decode(b64decode(meta.content || '')) };
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
    // Dates students see counting down on Home (add/drop, midterms, finals…).
    // Only well-formed rows survive; the list is capped.
    ...(Array.isArray(u.dates) ? { dates: validDates(u.dates) } : {}),
    // Switchboard numbers the About screen reads. The editor does not manage
    // them, so they are passed through as they are (handlePutUniversity keeps
    // the stored ones when a save does not send any).
    ...(u.contacts && typeof u.contacts === 'object' && !Array.isArray(u.contacts) ? { contacts: u.contacts } : {}),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDates(list) {
  return list
    .filter((d) => d && DATE_RE.test(String(d.date || '')) && str(d.en).trim())
    .slice(0, 40)
    .map((d) => ({
      en: str(d.en, 80),
      ar: str(d.ar, 80),
      date: String(d.date),
      ...(DATE_RE.test(String(d.end || '')) ? { end: String(d.end) } : {}),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
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

  // Round 10, idea 7 · replaced courses: a student who passed the old course
  // keeps it under the new one. The old one is usually gone from the plan, so
  // only its id (its course number) is checked for shape.
  const replaced = Array.isArray(m.replaced) ? m.replaced : [];
  if (replaced.length > 100) throw fail('up to 100 replaced courses');
  const olds = new Set();
  for (const r of replaced) {
    const old = String((r && r.old) || '').trim();
    if (!SLUG_RE.test(old)) throw fail(`replaced course: “${old.slice(0, 40)}” is not a course number or id`);
    if (!courseIds.has(r.new)) throw fail(`replaced course ${old}: pick the course it counts as`);
    if (old === r.new) throw fail(`replaced course ${old} can’t count as itself`);
    if (olds.has(old)) throw fail(`replaced course ${old} is listed twice`);
    olds.add(old);
  }
  // Idea 8 · elective tracks: named groups of this plan's courses.
  const tracks = Array.isArray(m.tracks) ? m.tracks : [];
  if (tracks.length > 20) throw fail('up to 20 tracks');
  const trackIds = new Set();
  for (const t of tracks) {
    if (!SLUG_RE.test(String((t && t.id) || ''))) throw fail('a track needs an id');
    if (trackIds.has(t.id)) throw fail(`two tracks share the id ${t.id}`);
    trackIds.add(t.id);
    if (!str(t.name).trim()) throw fail('a track needs a name');
    if (!Array.isArray(t.courses) || !t.courses.length) throw fail(`track “${str(t.name, 40)}”: pick its courses`);
    for (const c of t.courses) if (!courseIds.has(c)) throw fail(`track “${str(t.name, 40)}”: unknown course ${c}`);
  }

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
    replaced: replaced.map((r) => ({ old: String(r.old).trim(), oldName: str(r.oldName, 200).trim(), new: r.new })),
    tracks: tracks.map((t) => ({ id: t.id, name: str(t.name, 80).trim(), nameAr: str(t.nameAr, 80).trim(), courses: [...new Set(t.courses)] })),
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
    replaced: Array.isArray(stored.replaced) ? stored.replaced : [],
    tracks: Array.isArray(stored.tracks) ? stored.tracks : [],
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
    // Left out when empty, so a plan without them keeps its file unchanged.
    ...(edited.replaced && edited.replaced.length ? { replaced: edited.replaced } : { replaced: undefined }),
    ...(edited.tracks && edited.tracks.length ? { tracks: edited.tracks } : { tracks: undefined }),
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
  // Fields the editor does not send are kept from the stored file, so a save
  // cannot quietly drop them: the switchboard numbers, and the dates list
  // when the save came from an editor that predates it.
  try {
    const stored = existing && existing.text ? JSON.parse(existing.text) : null;
    if (stored) {
      if (clean.contacts === undefined && stored.contacts) clean.contacts = stored.contacts;
      if (clean.dates === undefined && Array.isArray(stored.dates)) clean.dates = stored.dates;
    }
  } catch { /* an unreadable stored file just means nothing to keep */ }
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

async function handleGetMajor(env, uni, slug, request, ref) {
  if (!SLUG_RE.test(uni) || !SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  // ?ref=<commit>: the major as it was then, in the editor's shape, so the
  // dashboard can show what changed and put an old version back (as a new
  // save, never by rewriting history).
  if (ref) {
    if (!/^[0-9a-f]{7,40}$/.test(ref)) return json({ error: 'bad ref' }, 400, env, request);
    const old = await ghGetAt(env, `data/${uni}/majors/${slug}.json`, ref);
    if (!old.exists) return json({ error: 'not found at that version' }, 404, env, request);
    return json({ ok: true, major: toEditable(JSON.parse(old.text)), ref }, 200, env, request);
  }
  const f = await ghGet(env, `data/${uni}/majors/${slug}.json`);
  if (!f.exists) return json({ error: 'not found' }, 404, env, request);
  return json({ ok: true, major: toEditable(JSON.parse(f.text)), sha: f.sha }, 200, env, request);
}

// The saves that touched one major, newest first (round 8, idea 30).
async function handleHistory(env, uni, slug, request) {
  if (!SLUG_RE.test(uni) || !SLUG_RE.test(slug)) return json({ error: 'bad slug' }, 400, env, request);
  const path = `data/${uni}/majors/${slug}.json`;
  const branch = env.REPO_BRANCH || 'main';
  const r = await fetch(`https://api.github.com/repos/${env.REPO_OWNER}/${env.REPO_NAME}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=20`,
    { headers: ghHeaders(env) });
  if (!r.ok) throw new Error(`github commits ${path}: ${r.status}`);
  const list = await r.json();
  return json({ ok: true, commits: (Array.isArray(list) ? list : []).map((c) => ({
    sha: c.sha,
    date: c.commit && c.commit.author ? c.commit.author.date : null,
    message: c.commit ? String(c.commit.message || '').split('\n')[0].slice(0, 200) : '',
  })) }, 200, env, request);
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

// ---------------------------------------------------------------------------
// Staff logins — deans and professors (round 10)
//
// You (the admin) make each login: a role, a university and college, and for a
// professor the courses it covers. The login starts with no password: it gets
// a one-time setup code, sent to the person as a link, and they choose their
// own password with it. A dean can also make, pause and remove professor
// logins inside their own college.
//
// Stored in a D1 database bound to this Worker as STAFF_DB (the same
// studyplan-cloud database is fine; this makes its own `staff` table). No
// binding = these routes say so, and nothing else in this Worker changes.
//
// A staff token is signed with the same SESSION_SECRET as the admin's but is a
// different shape ({k:'staff', sid, tv}) with no `u`, so verifyToken() — the
// admin gate — never accepts it, and verifyStaff() never accepts an admin's.
// ---------------------------------------------------------------------------

const STAFF_ROLES = ['dean', 'professor'];
const STAFF_USER_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const STAFF_SETUP_TTL = 14 * 24 * 60 * 60;       // a setup link lasts two weeks
const STAFF_PBKDF2_TOTAL = 600000;
const STAFF_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// A login's `college` is '*' (every college of its university), or one or
// more college ids separated by commas: a dean can lead several colleges,
// and a professor can teach in several.
function collegeList(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
function coversCollege(row, college) {
  if (row.college === '*') return true;
  return collegeList(row.college).includes(college);
}
// Whether two logins share a college (a dean and one of their professors).
function sharesCollege(a, b) {
  if (a.college === '*' || b.college === '*') return true;
  const bl = collegeList(b.college);
  return collegeList(a.college).some((c) => bl.includes(c));
}
function firstCollege(row) { return row.college === '*' ? '' : (collegeList(row.college)[0] || ''); }

let staffTableReady = false;
async function staffDb(env) {
  if (!env.STAFF_DB) {
    throw fail('Staff logins need a database. In Cloudflare → Workers → studyplan-admin → Settings → Bindings, add a D1 database binding named STAFF_DB (the studyplan-cloud database is fine), then Deploy.');
  }
  if (!staffTableReady) {
    await env.STAFF_DB.prepare(`CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, uni TEXT NOT NULL, college TEXT NOT NULL DEFAULT '', courses TEXT NOT NULL DEFAULT '[]',
      password_hash TEXT, setup_hash TEXT, setup_exp INTEGER, status TEXT NOT NULL DEFAULT 'active',
      tv INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      last_seen INTEGER)`).run();
    staffTableReady = true;
  }
  return env.STAFF_DB;
}

async function hashStaffPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveChunked(enc.encode(password), salt, STAFF_PBKDF2_TOTAL);
  return `pbkdf2$${STAFF_PBKDF2_TOTAL}$${b64url(salt)}$${b64url(bits)}`;
}
function newSetupCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = '';
  for (let i = 0; i < 12; i++) out += STAFF_CODE_ALPHABET[bytes[i] % STAFF_CODE_ALPHABET.length];
  return out;
}
// Only an HMAC of the code is kept, tied to the login it was made for.
async function setupHash(id, code, env) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(`staff-setup:${id}:${clean}`));
  return b64url(sig);
}

async function issueStaffToken(row, env) {
  const payload = { k: 'staff', sid: row.id, tv: row.tv, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

// The signed-in staff row, or null. A paused login, a changed password
// (tv moved on) or an expired token all read as signed out.
async function verifyStaff(request, env) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const [body, sig] = (auth.startsWith('Bearer ') ? auth.slice(7) : '').split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!p || p.k !== 'staff' || !p.sid || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    const db = await staffDb(env);
    const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(p.sid).first();
    if (!row || row.status !== 'active' || row.tv !== p.tv) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!row.last_seen || now - row.last_seen > 3600) {
      await db.prepare('UPDATE staff SET last_seen = ? WHERE id = ?').bind(now, row.id).run();
    }
    return row;
  } catch (e) {
    if (e && e.userFacing) throw e;
    return null;
  }
}

function staffOut(r) {
  let courses = [];
  try { courses = JSON.parse(r.courses || '[]'); } catch { courses = []; }
  return {
    id: r.id, username: r.username, name: r.name, role: r.role, uni: r.uni, college: r.college, courses,
    status: r.status, hasPassword: !!r.password_hash,
    setupPending: !r.password_hash || !!r.setup_hash,
    createdBy: r.created_by, createdAt: r.created_at, lastSeen: r.last_seen || null,
  };
}

// Validates the parts of a login anyone may set. `forDean` fixes role,
// university and college to the dean's own.
function staffFields(body, forDean) {
  const out = {};
  if (body.name !== undefined) out.name = str(body.name, 80);
  const cleanColleges = (v) => {
    if (Array.isArray(v)) v = v.join(',');
    v = String(v || '').trim();
    if (v === '' || v === '*') return v;
    const list = collegeList(v);
    for (const c of list) if (!SLUG_RE.test(c)) throw fail('pick a college');
    return [...new Set(list)].join(',');
  };
  if (forDean) {
    out.role = 'professor'; out.uni = forDean.uni;
    // A dean may give a professor any of the dean's own colleges, and no other.
    let want = body.college !== undefined ? cleanColleges(body.college) : forDean.college;
    if (!want) want = forDean.college;
    if (forDean.college !== '*') {
      if (want === '*') want = forDean.college;
      const mine = collegeList(forDean.college);
      if (collegeList(want).some((c) => !mine.includes(c))) throw fail('you can only choose your own colleges');
    }
    out.college = want;
  } else {
    if (body.role !== undefined) {
      if (!STAFF_ROLES.includes(body.role)) throw fail('role must be dean or professor');
      out.role = body.role;
    }
    if (body.uni !== undefined) {
      if (!SLUG_RE.test(String(body.uni))) throw fail('pick a university');
      out.uni = String(body.uni);
    }
    if (body.college !== undefined) out.college = cleanColleges(body.college);
  }
  if (body.courses !== undefined) {
    if (!Array.isArray(body.courses) || body.courses.length > 60) throw fail('courses must be a list of up to 60 course ids');
    const list = [];
    for (const c of body.courses) {
      const id = String(c || '').trim();
      if (!SLUG_RE.test(id)) throw fail(`“${id.slice(0, 40)}” is not a course id`);
      if (!list.includes(id)) list.push(id);
    }
    out.courses = JSON.stringify(list);
  }
  return out;
}

async function createStaff(env, body, createdBy, forDean) {
  const db = await staffDb(env);
  const username = String(body.username || '').trim().toLowerCase();
  if (!STAFF_USER_RE.test(username)) throw fail('username: 3–32 letters, numbers, dots, dashes or underscores');
  const f = staffFields(body, forDean);
  if (!f.role) throw fail('role must be dean or professor');
  if (!f.uni) throw fail('pick a university');
  if (f.role === 'dean' && !f.college) throw fail('a dean needs a college');
  const taken = await db.prepare('SELECT id FROM staff WHERE username = ?').bind(username).first();
  if (taken) throw fail('that username is taken');
  const id = crypto.randomUUID();
  const code = newSetupCode();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO staff (id, username, name, role, uni, college, courses, setup_hash, setup_exp, status, tv, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
    .bind(id, username, f.name || '', f.role, f.uni, f.college || '', f.courses || '[]',
          await setupHash(id, code, env), now + STAFF_SETUP_TTL, createdBy, now).run();
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first();
  return { staff: staffOut(row), setupCode: code };
}

async function updateStaff(env, row, body, forDean) {
  const db = await staffDb(env);
  const f = staffFields(body, forDean);
  if (forDean) { delete f.role; delete f.uni; if (body.college === undefined) delete f.college; }
  const sets = []; const vals = [];
  for (const k of ['name', 'role', 'uni', 'college', 'courses']) {
    if (f[k] !== undefined) { sets.push(`${k} = ?`); vals.push(f[k]); }
  }
  if (body.status !== undefined) {
    if (!['active', 'paused'].includes(body.status)) throw fail('status must be active or paused');
    sets.push('status = ?'); vals.push(body.status);
  }
  let code = null;
  if (body.newSetupCode) {
    code = newSetupCode();
    // A new link also signs the login out everywhere until it is used.
    sets.push('setup_hash = ?', 'setup_exp = ?', 'tv = tv + 1');
    vals.push(await setupHash(row.id, code, env), Math.floor(Date.now() / 1000) + STAFF_SETUP_TTL);
  }
  if (!sets.length) throw fail('nothing to change');
  await db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, row.id).run();
  const fresh = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(row.id).first();
  return { staff: staffOut(fresh), setupCode: code };
}

async function handleStaffLogin(request, env) {
  const body = await readJson(request, 4096);
  await sleep(LOGIN_DELAY_MS);
  const db = await staffDb(env);
  const row = await db.prepare('SELECT * FROM staff WHERE username = ?')
    .bind(String(body.username || '').trim().toLowerCase()).first();
  if (!row || !row.password_hash || !(await verifyPassword(String(body.password || ''), row.password_hash))) {
    return json({ error: 'wrong username or password' }, 401, env, request);
  }
  if (row.status !== 'active') return json({ error: 'this login is paused — ask whoever gave it to you' }, 403, env, request);
  return json({ ok: true, token: await issueStaffToken(row, env), me: staffOut(row) }, 200, env, request);
}

async function handleStaffSetup(request, env) {
  const body = await readJson(request, 4096);
  await sleep(LOGIN_DELAY_MS);
  const password = String(body.password || '');
  if (password.length < 8 || password.length > 200) throw fail('the password needs at least 8 characters');
  const db = await staffDb(env);
  const row = await db.prepare('SELECT * FROM staff WHERE username = ?')
    .bind(String(body.username || '').trim().toLowerCase()).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || !row.setup_hash || !row.setup_exp || row.setup_exp < now ||
      !timingSafeEqual(await setupHash(row.id, body.code, env), row.setup_hash)) {
    return json({ error: 'this setup link is not valid any more — ask for a new one' }, 401, env, request);
  }
  if (row.status !== 'active') return json({ error: 'this login is paused — ask whoever gave it to you' }, 403, env, request);
  await db.prepare('UPDATE staff SET password_hash = ?, setup_hash = NULL, setup_exp = NULL, tv = tv + 1 WHERE id = ?')
    .bind(await hashStaffPassword(password), row.id).run();
  const fresh = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(row.id).first();
  return json({ ok: true, token: await issueStaffToken(fresh, env), me: staffOut(fresh) }, 200, env, request);
}

// ---------------------------------------------------------------------------
// Staff course content (round 10, part B)
//
// What a dean or professor writes for students: a course's "About this course"
// and "Revise first", which semester it is offered in, a note on its
// prerequisites, and a note pinned to the course until a date. Plus each
// professor's card for Find a Professor. Kept in STAFF_DB, served to every
// student from GET /api/public/content (the app keeps its last copy, so it
// still shows offline).
//
// A professor's change waits for their dean (staff_pending); a dean's goes
// live at once. Every live change is written to staff_log with who made it.
// Which college a course belongs to comes from the published plans.json.
// ---------------------------------------------------------------------------

const CONTENT_FIELDS = {
  about: (v) => str(v, 1200),
  revise: (v) => str(v, 400),
  offered: (v) => { if (!['', 's1', 's2'].includes(v || '')) throw fail('offered must be s1, s2 or empty'); return v || ''; },
  prereqNote: (v) => str(v, 300),
  // This semester's sections: [{ n, days: [0-6], s: 'HH:MM', e: 'HH:MM', room, prof }].
  sections: (v) => {
    if (!v || (Array.isArray(v) && !v.length)) return '';
    if (!Array.isArray(v) || v.length > 30) throw fail('sections must be a list of up to 30');
    const T = /^([01]\d|2[0-3]):[0-5]\d$/;
    return JSON.stringify(v.map((x, i) => {
      const days = Array.isArray(x.days) ? [...new Set(x.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort() : [];
      if (!days.length) throw fail(`section ${i + 1}: pick at least one day`);
      if (!T.test(String(x.s)) || !T.test(String(x.e)) || String(x.e) <= String(x.s)) throw fail(`section ${i + 1}: check the start and end time`);
      return { n: str(x.n, 20) || String(i + 1), days, s: String(x.s), e: String(x.e), room: str(x.room, 40), prof: str(x.prof, 80) };
    }));
  },
  note: (v) => {
    if (!v || !String(v.text || '').trim()) return '';
    if (!DATE_RE.test(String(v.until || ''))) throw fail('a pinned note needs an end date');
    return JSON.stringify({ text: str(v.text, 300), until: String(v.until) });
  },
};
const CARD_FIELDS = ['office', 'hours', 'contact', 'email', 'phone'];
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,120}\.[^\s@<>]{2,20}$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/;
// Only the fields that were sent, checked.
function cardFields(body) {
  const out = {};
  for (const k of CARD_FIELDS) if (body[k] !== undefined) out[k] = str(body[k], 200).trim();
  if (out.email && !EMAIL_RE.test(out.email)) throw fail('that email doesn’t look right');
  if (out.phone && !PHONE_RE.test(out.phone)) throw fail('a phone number is digits, spaces, + ( ) or -');
  return out;
}
// A login's card in Find a Professor, merged with what is sent. A new phone
// number is hidden from students until it is allowed again, unless the one
// saving it may allow it (showPhone true or false).
async function saveCard(db, row, fields, by, showPhone) {
  const was = await db.prepare('SELECT * FROM staff_cards WHERE uni = ? AND username = ?').bind(row.uni, row.username).first() || {};
  const c = {};
  for (const k of CARD_FIELDS) c[k] = fields[k] !== undefined ? fields[k] : (was[k] || '');
  let ok = was.phone_ok ? 1 : 0;
  if (c.phone !== (was.phone || '')) ok = 0;
  if (showPhone !== undefined) ok = showPhone ? 1 : 0;
  if (!c.phone) ok = 0;
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO staff_cards (uni, username, name, office, hours, contact, email, phone, phone_ok, courses, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uni, username) DO UPDATE SET name = excluded.name, office = excluded.office, hours = excluded.hours, contact = excluded.contact,
      email = excluded.email, phone = excluded.phone, phone_ok = excluded.phone_ok, courses = excluded.courses, at = excluded.at`)
    .bind(row.uni, row.username, row.name || row.username, c.office, c.hours, c.contact, c.email, c.phone, ok, row.courses || '[]', now).run();
  await db.prepare('INSERT INTO staff_log (uni, college, what, by, at) VALUES (?, ?, ?, ?, ?)')
    .bind(row.uni, firstCollege(row), `Card in Find a Professor · ${row.name || row.username}${showPhone !== undefined && c.phone ? (ok ? ' · phone shown' : ' · phone hidden') : ''}`, by, now).run();
}
function cardOut(c) {
  return c ? { office: c.office || '', hours: c.hours || '', contact: c.contact || '', email: c.email || '', phone: c.phone || '', phoneShown: !!c.phone_ok } : null;
}
// Staff lists carry each login's card, for the admin's and the dean's forms.
async function withCards(env, rows) {
  const db = await contentDb(env);
  const out = [];
  for (const r of rows) {
    const c = await db.prepare('SELECT * FROM staff_cards WHERE uni = ? AND username = ?').bind(r.uni, r.username).first();
    out.push({ ...staffOut(r), card: cardOut(c) });
  }
  return out;
}
// What the admin or a dean typed about a login's contact details when making
// or changing it.
async function cardFromForm(env, row, body, by) {
  if (body.email === undefined && body.phone === undefined && body.phoneShown === undefined) return;
  const f = cardFields({ email: body.email, phone: body.phone });
  await saveCard(await contentDb(env), row, f, by, body.phoneShown === undefined ? undefined : !!body.phoneShown);
}

let contentTablesReady = false;
async function contentDb(env) {
  const db = await staffDb(env);
  if (!contentTablesReady) {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS staff_content (uni TEXT NOT NULL, course TEXT NOT NULL, field TEXT NOT NULL,
        value TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (uni, course, field))`,
      `CREATE TABLE IF NOT EXISTS staff_cards (uni TEXT NOT NULL, username TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
        office TEXT NOT NULL DEFAULT '', hours TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
        courses TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL, PRIMARY KEY (uni, username))`,
      `CREATE TABLE IF NOT EXISTS staff_pending (id TEXT PRIMARY KEY, uni TEXT NOT NULL, college TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL, course TEXT NOT NULL DEFAULT '', field TEXT NOT NULL DEFAULT '', value TEXT NOT NULL,
        by TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
        decided_by TEXT, decided_at INTEGER)`,
      `CREATE TABLE IF NOT EXISTS staff_log (id INTEGER PRIMARY KEY AUTOINCREMENT, uni TEXT NOT NULL, college TEXT NOT NULL DEFAULT '',
        what TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)`,
      // Round 10, ideas 13, 14 and 11: replies under students' thoughts,
      // thoughts reported to the admin, and a college's dates on Home.
      `CREATE TABLE IF NOT EXISTS staff_replies (thought TEXT PRIMARY KEY, uni TEXT NOT NULL, course TEXT NOT NULL,
        text TEXT NOT NULL, by TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS staff_reports (thought TEXT PRIMARY KEY, uni TEXT NOT NULL, plan TEXT NOT NULL DEFAULT '',
        course TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, by TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', decided_at INTEGER)`,
      `CREATE TABLE IF NOT EXISTS staff_dates (id TEXT PRIMARY KEY, uni TEXT NOT NULL, college TEXT NOT NULL,
        label TEXT NOT NULL, date TEXT NOT NULL, by TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`,
    ]) await db.prepare(sql).run();
    // Round 10, idea 18: a change remembers the value it replaced, so a dean
    // can put it back. Added to a staff_log made before that.
    for (const col of ['undo TEXT', 'undone INTEGER NOT NULL DEFAULT 0']) {
      try { await db.prepare(`ALTER TABLE staff_log ADD COLUMN ${col}`).run(); } catch { /* already there */ }
    }
    // A card's email and phone. The phone reaches students only once a dean
    // (or the admin) allows it: phone_ok.
    for (const col of ["email TEXT NOT NULL DEFAULT ''", "phone TEXT NOT NULL DEFAULT ''", 'phone_ok INTEGER NOT NULL DEFAULT 0']) {
      try { await db.prepare(`ALTER TABLE staff_cards ADD COLUMN ${col}`).run(); } catch { /* already there */ }
    }
    contentTablesReady = true;
  }
  return db;
}

// Which colleges each course is taught in, and which college each major is
// in, from the published plans.json (too big for the contents API, so raw).
// Kept for ten minutes per Worker instance.
let planIndex = null, planIndexAt = 0;
async function plansIndex(env) {
  if (planIndex && Date.now() - planIndexAt < 10 * 60 * 1000) return planIndex;
  const branch = env.REPO_BRANCH || 'main';
  const r = await fetch(`https://raw.githubusercontent.com/${env.REPO_OWNER}/${env.REPO_NAME}/${branch}/web/plans.json`,
    { headers: env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'studyplan-admin-worker' } : { 'User-Agent': 'studyplan-admin-worker' } });
  if (!r.ok) throw new Error(`plans.json: ${r.status}`);
  const data = await r.json();
  const courseColleges = {}, majorCollege = {}, courseNames = {}, courseCodes = {};
  for (const p of data.plans || []) {
    const uni = p.university || 'aaup';
    majorCollege[p.id] = { uni, college: p.collegeId || '', name: (p.majorName && p.majorName.en && p.majorName.en.big) || p.id };
    for (const c of p.courses || []) {
      const k = `${uni}/${c.id}`;
      (courseColleges[k] = courseColleges[k] || new Set()).add(p.collegeId || '');
      if (!courseNames[k]) courseNames[k] = c.name || c.id;
      if (c.courseNumber) courseCodes[k] = c.courseNumber;
    }
  }
  planIndex = { courseColleges, majorCollege, courseNames, courseCodes };
  planIndexAt = Date.now();
  return planIndex;
}
async function courseInCollege(env, uni, course, college) {
  const ix = await plansIndex(env);
  const set = ix.courseColleges[`${uni}/${course}`];
  return !!(set && set.has(college));
}
async function courseName(env, uni, course) {
  try { return (await plansIndex(env)).courseNames[`${uni}/${course}`] || course; } catch { return course; }
}
async function mayWriteCourse(env, me, course) {
  if (me.role === 'professor') {
    let mine = [];
    try { mine = JSON.parse(me.courses || '[]'); } catch { mine = []; }
    return mine.includes(course);
  }
  if (me.college === '*') {
    const ix = await plansIndex(env);
    return !!ix.courseColleges[`${me.uni}/${course}`];
  }
  for (const c of collegeList(me.college)) if (await courseInCollege(env, me.uni, course, c)) return true;
  return false;
}

const FIELD_LABEL = { about: 'About this course', revise: 'Revise first', offered: 'Offered in', prereqNote: 'Prerequisite note', note: 'Pinned note', sections: 'Sections' };
async function applyContent(db, env, uni, college, course, field, value, by, how) {
  const now = Math.floor(Date.now() / 1000);
  const was = await db.prepare('SELECT value FROM staff_content WHERE uni = ? AND course = ? AND field = ?').bind(uni, course, field).first();
  if (value === '') await db.prepare('DELETE FROM staff_content WHERE uni = ? AND course = ? AND field = ?').bind(uni, course, field).run();
  else {
    await db.prepare(`INSERT INTO staff_content (uni, course, field, value, by, at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uni, course, field) DO UPDATE SET value = excluded.value, by = excluded.by, at = excluded.at`)
      .bind(uni, course, field, value, by, now).run();
  }
  await db.prepare('INSERT INTO staff_log (uni, college, what, by, at, undo) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(uni, college, `${await courseName(env, uni, course)} · ${FIELD_LABEL[field] || field}${value === '' ? ' removed' : ''}${how || ''}`, by, now,
      JSON.stringify({ course, field, value: was ? was.value : '' })).run();
}
async function applyCard(db, uni, college, row, card, by) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO staff_cards (uni, username, name, office, hours, contact, courses, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uni, username) DO UPDATE SET name = excluded.name, office = excluded.office, hours = excluded.hours,
      contact = excluded.contact, courses = excluded.courses, at = excluded.at`)
    .bind(uni, row.username, row.name || row.username, card.office, card.hours, card.contact, row.courses || '[]', now).run();
  await db.prepare('INSERT INTO staff_log (uni, college, what, by, at) VALUES (?, ?, ?, ?, ?)')
    .bind(uni, college, `Card in Find a Professor · ${row.name || row.username}`, by, now).run();
}

async function handleStaffContent(request, env, me) {
  const body = await readJson(request, 16384);
  const course = String(body.course || '');
  const field = String(body.field || '');
  if (!SLUG_RE.test(course)) throw fail('pick a course');
  if (!CONTENT_FIELDS[field]) throw fail('unknown field');
  if (!(await mayWriteCourse(env, me, course))) return json({ error: 'your login doesn’t cover this course' }, 403, env, request);
  const value = CONTENT_FIELDS[field](body.value);
  const db = await contentDb(env);
  const who = me.name || me.username;
  if (me.role === 'dean') {
    await applyContent(db, env, me.uni, firstCollege(me), course, field, value, who);
    return json({ ok: true, live: true }, 200, env, request);
  }
  // A professor's newer change to the same thing replaces their older one.
  await db.prepare("DELETE FROM staff_pending WHERE status = 'waiting' AND kind = 'content' AND uni = ? AND course = ? AND field = ? AND by = ?")
    .bind(me.uni, course, field, me.username).run();
  await db.prepare(`INSERT INTO staff_pending (id, uni, college, kind, course, field, value, by, by_name, at) VALUES (?, ?, ?, 'content', ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), me.uni, me.college || '', course, field, value, me.username, who, Math.floor(Date.now() / 1000)).run();
  return json({ ok: true, waiting: true }, 200, env, request);
}

// Their own card goes live at once; only the phone waits for a dean (a dean's
// own phone waits for the admin).
async function handleStaffCard(request, env, me) {
  const body = await readJson(request, 8192);
  const db = await contentDb(env);
  await saveCard(db, me, cardFields(body), me.name || me.username, me.admin ? true : undefined);
  const c = await db.prepare('SELECT * FROM staff_cards WHERE uni = ? AND username = ?').bind(me.uni, me.username).first();
  return json({ ok: true, live: true, card: cardOut(c) }, 200, env, request);
}

// What waits: for a dean, everything from their college's professors (a
// course change counts when the course is taught in the dean's college); for
// a professor, their own. Each item carries what is live now, for the diff.
async function listPending(env, me) {
  const db = await contentDb(env);
  const rs = me.role === 'dean'
    ? await db.prepare("SELECT * FROM staff_pending WHERE status = 'waiting' AND uni = ? ORDER BY at").bind(me.uni).all()
    : await db.prepare("SELECT * FROM staff_pending WHERE status = 'waiting' AND uni = ? AND by = ? ORDER BY at").bind(me.uni, me.username).all();
  const out = [];
  for (const p of rs.results || []) {
    if (me.role === 'dean') {
      const ok = p.kind === 'card' ? sharesCollege(me, { college: p.college })
        : await mayWriteCourse(env, me, p.course);
      if (!ok) continue;
    }
    let now = '';
    if (p.kind === 'content') {
      const cur = await db.prepare('SELECT value FROM staff_content WHERE uni = ? AND course = ? AND field = ?').bind(p.uni, p.course, p.field).first();
      now = cur ? cur.value : '';
    } else {
      const cur = await db.prepare('SELECT office, hours, contact FROM staff_cards WHERE uni = ? AND username = ?').bind(p.uni, p.by).first();
      now = cur ? JSON.stringify({ office: cur.office, hours: cur.hours, contact: cur.contact }) : '';
    }
    out.push({ id: p.id, kind: p.kind, course: p.course, courseName: p.course ? await courseName(env, p.uni, p.course) : '',
               field: p.field, value: p.value, now, by: p.by, byName: p.by_name, at: p.at });
  }
  return out;
}

async function decidePending(request, env, me, id) {
  if (me.role !== 'dean') return json({ error: 'only a dean can do that' }, 403, env, request);
  const body = await readJson(request, 1024);
  const accept = body.decision === 'accept';
  if (!accept && body.decision !== 'refuse') throw fail('decision must be accept or refuse');
  const mine = (await listPending(env, me)).find((p) => p.id === id);
  if (!mine) return json({ error: 'not found' }, 404, env, request);
  const db = await contentDb(env);
  const who = me.name || me.username;
  if (accept) {
    if (mine.kind === 'content') {
      await applyContent(db, env, me.uni, firstCollege(me), mine.course, mine.field, mine.value, `${mine.byName}, accepted by ${who}`);
    } else {
      const prof = await db.prepare('SELECT * FROM staff WHERE username = ?').bind(mine.by).first();
      if (prof) await applyCard(db, me.uni, firstCollege(me), prof, JSON.parse(mine.value), `${mine.byName}, accepted by ${who}`);
    }
  }
  await db.prepare('UPDATE staff_pending SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
    .bind(accept ? 'accepted' : 'refused', me.username, Math.floor(Date.now() / 1000), id).run();
  return json({ ok: true }, 200, env, request);
}

// Everything students see, for one university. Public and cacheable.
async function handlePublicContent(request, env, uni) {
  if (!SLUG_RE.test(uni)) throw fail('bad university');
  if (!env.STAFF_DB) return json({ ok: true, courses: {}, cards: [], replies: {}, dates: [] }, 200, env, request);
  const db = await contentDb(env);
  const courses = {};
  const rs = await db.prepare('SELECT course, field, value, at FROM staff_content WHERE uni = ?').bind(uni).all();
  let v = 0;
  for (const r of rs.results || []) {
    const c = courses[r.course] = courses[r.course] || {};
    c[r.field] = r.field === 'note' || r.field === 'sections' ? JSON.parse(r.value) : r.value;
    v = Math.max(v, r.at);
  }
  // Find a Professor: every active professor login, with what they teach, and
  // a dean once they have a card. The phone only when it was allowed.
  const cs = await db.prepare(`SELECT s.username, s.name, s.role, s.courses, s.created_at, c.office, c.hours, c.contact, c.email, c.phone, c.phone_ok, c.at
    FROM staff s LEFT JOIN staff_cards c ON c.uni = s.uni AND c.username = s.username
    WHERE s.uni = ? AND s.status = 'active'`).bind(uni).all();
  const cards = [];
  for (const r of cs.results || []) {
    if (r.role !== 'professor' && r.at == null) continue;
    v = Math.max(v, r.at || 0, r.created_at || 0);
    let list = [];
    try { list = JSON.parse(r.courses || '[]'); } catch { list = []; }
    cards.push({ name: r.name || r.username, office: r.office || '', hours: r.hours || '', contact: r.contact || '', email: r.email || '',
      phone: r.phone_ok ? (r.phone || '') : '', courses: list });
  }
  // Replies under students' thoughts, by the thought's id.
  const replies = {};
  const rr = await db.prepare('SELECT thought, course, text, by_name, at FROM staff_replies WHERE uni = ?').bind(uni).all();
  for (const r of rr.results || []) {
    replies[r.thought] = { course: r.course, text: r.text, by: r.by_name, at: r.at };
    v = Math.max(v, r.at);
  }
  // A college's dates, from yesterday on, each with the majors whose
  // students see it (all of the university's for '*').
  const dates = [];
  const dr = await db.prepare('SELECT id, college, label, date, at FROM staff_dates WHERE uni = ? AND date >= ? ORDER BY date')
    .bind(uni, isoDay(-1)).all();
  if ((dr.results || []).length) {
    let ix = null;
    try { ix = await plansIndex(env); } catch { ix = null; }
    for (const r of dr.results) {
      v = Math.max(v, r.at);
      if (!ix) continue;
      const majors = Object.keys(ix.majorCollege).filter((id) => ix.majorCollege[id].uni === uni && (r.college === '*' || ix.majorCollege[id].college === r.college));
      dates.push({ id: r.id, college: r.college, label: r.label, date: r.date, majors });
    }
  }
  const res = json({ ok: true, v, courses, cards, replies, dates }, 200, env, request);
  res.headers.set('Cache-Control', 'public, max-age=120');
  return res;
}

// ---------------------------------------------------------------------------
// Deans change their majors' plans (round 10, ideas 1 and A)
//
// The same major files the admin room edits, through the same validation and
// commits, limited to majors of the dean's colleges. Each commit says which
// dean made it, so the admin room's history shows it and Put back works.
// ---------------------------------------------------------------------------

async function deanMajorOk(env, me, uni, slug) {
  if (me.role !== 'dean' || uni !== me.uni || !SLUG_RE.test(slug)) return false;
  const f = await ghGet(env, `data/${uni}/majors/${slug}.json`);
  if (!f.exists) return false;
  return coversCollege(me, JSON.parse(f.text).college || '');
}

async function staffLog(env, me, college, what) {
  const db = await contentDb(env);
  await db.prepare('INSERT INTO staff_log (uni, college, what, by, at) VALUES (?, ?, ?, ?, ?)')
    .bind(me.uni, college, what, me.name || me.username, Math.floor(Date.now() / 1000)).run();
}

async function handleStaffMajors(request, env, me, seg, url) {
  if (me.role !== 'dean') return json({ error: 'only a dean can change a plan' }, 403, env, request);
  // /api/staff/majors — the majors a dean may open.
  if (seg[2] === 'majors' && request.method === 'GET') {
    const ix = await plansIndex(env);
    const list = Object.keys(ix.majorCollege).filter((id) => {
      const m = ix.majorCollege[id];
      return m.uni === me.uni && coversCollege(me, m.college);
    }).map((id) => ({ slug: id, name: ix.majorCollege[id].name, college: ix.majorCollege[id].college }));
    return json({ ok: true, majors: list }, 200, env, request);
  }
  // What the plan editor asks for on opening, cut to the dean's majors.
  if (seg[2] === 'status' && request.method === 'GET') {
    return json({ ok: true, username: me.name || me.username, canWrite: true, staff: true }, 200, env, request);
  }
  if (seg[2] === 'tree' && request.method === 'GET') {
    const ix = await plansIndex(env);
    const majors = Object.keys(ix.majorCollege).filter((id) => ix.majorCollege[id].uni === me.uni && coversCollege(me, ix.majorCollege[id].college)).map((slug) => ({ slug }));
    return json({ ok: true, universities: [{ slug: me.uni, name: me.uni.toUpperCase(), published: true, majors }] }, 200, env, request);
  }
  if (seg[2] === 'university' && seg[3] === me.uni && request.method === 'GET') return await handleGetUniversity(env, me.uni, request);
  const uni = seg[3], slug = seg[4];
  if (!(await deanMajorOk(env, me, uni, slug))) return json({ error: 'this major isn’t in your colleges' }, 403, env, request);
  if (seg[2] === 'history' && request.method === 'GET') return await handleHistory(env, uni, slug, request);
  if (seg[2] === 'major' && request.method === 'GET') return await handleGetMajor(env, uni, slug, request, url.searchParams.get('ref'));
  if (seg[2] === 'major' && request.method === 'PUT') {
    const body = await readJson(request, MAX_JSON_BYTES);
    const path = `data/${uni}/majors/${slug}.json`;
    const existing = await ghGet(env, path);
    const original = JSON.parse(existing.text);
    // A dean's save can't move the major out of the college it is in.
    const clean = validMajor({ ...body.major, slug, university: uni, college: original.college });
    const conflict = staleBase(body, existing, env, request);
    if (conflict) return conflict;
    const newSha = await ghPut(env, path, jsonBytes(toStored(clean, original)), `staff ${me.username}: update ${uni}/${slug}`, existing.sha);
    await staffLog(env, me, original.college || '', `${(await plansIndex(env)).majorCollege[slug]?.name || slug} · plan changed`);
    return json({ ok: true, major: clean, sha: newSha }, 200, env, request);
  }
  return json({ error: 'not found' }, 404, env, request);
}

// The prerequisites of one course, in every major of the dean's colleges that
// teaches it. `requires` names courses by id; in another major the same course
// is matched by id or by course number. { preview: true } only reports.
async function handleStaffPrereqs(request, env, me) {
  if (me.role !== 'dean') return json({ error: 'only a dean can change prerequisites' }, 403, env, request);
  const body = await readJson(request, 16384);
  const course = String(body.course || '');
  if (!SLUG_RE.test(course)) throw fail('pick a course');
  const want = Array.isArray(body.requires) ? body.requires.map(String).filter((x) => SLUG_RE.test(x)) : [];
  const ix = await plansIndex(env);
  const codeOf = (id) => ix.courseCodes[`${me.uni}/${id}`] || '';
  const code = codeOf(course);
  const wantCodes = want.map((id) => ({ id, code: codeOf(id) }));
  const changes = [];
  for (const slug of Object.keys(ix.majorCollege)) {
    const m = ix.majorCollege[slug];
    if (m.uni !== me.uni || !coversCollege(me, m.college)) continue;
    const path = `data/${me.uni}/majors/${slug}.json`;
    const f = await ghGet(env, path);
    if (!f.exists) continue;
    const major = JSON.parse(f.text);
    const courses = major.courses || [];
    const find = (id, cd) => courses.find((c) => c.slug === id) || (cd ? courses.find((c) => c.code === cd && !/-lab$/.test(c.slug)) : null);
    const target = find(course, code);
    if (!target) continue;
    const before = (major.prerequisites || []).filter((p) => p.forCourse === target.slug).map((p) => p.requires);
    const after = [];
    for (const w of wantCodes) {
      const c = find(w.id, w.code);
      if (c && c.slug !== target.slug && !after.includes(c.slug)) after.push(c.slug);
    }
    if (before.slice().sort().join(',') === after.slice().sort().join(',')) continue;
    const name = (id) => (courses.find((c) => c.slug === id) || {}).name || id;
    changes.push({ slug, major: m.name, course: target.name, before: before.map(name), after: after.map(name),
                   path, sha: f.sha, file: major, target: target.slug, next: after });
  }
  const report = changes.map((c) => ({ slug: c.slug, major: c.major, course: c.course, before: c.before, after: c.after }));
  if (body.preview) return json({ ok: true, changes: report }, 200, env, request);
  for (const c of changes) {
    const major = c.file;
    major.prerequisites = (major.prerequisites || []).filter((p) => p.forCourse !== c.target)
      .concat(c.next.map((r) => ({ requires: r, forCourse: c.target })));
    // Same checks as any save (no loops, no unknown courses).
    validMajor(toEditable(major));
    await ghPut(env, c.path, jsonBytes(major), `staff ${me.username}: prerequisites of ${c.course} in ${me.uni}/${c.slug}`, c.sha);
    await staffLog(env, me, ix.majorCollege[c.slug].college, `${c.course} · prerequisites in ${c.major}`);
  }
  return json({ ok: true, changes: report }, 200, env, request);
}

// Routes a signed-in staff member can use. Returns a Response, or null when
// the path is not one of them.
// ---------------------------------------------------------------------------
// What students said (round 10, ideas 13 and 14)
//
// Thoughts live in their own Worker (workers/thoughts-worker.js), which staff
// never write to. A reply is kept here under the thought's id and the course
// it answers for, and the app shows it under that thought. A report waits in
// the admin room, and only the admin takes a thought down: staff can't
// delete anything.
// ---------------------------------------------------------------------------
const THOUGHT_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
function isoDay(offset) { return new Date(Date.now() + (offset || 0) * 86400000).toISOString().slice(0, 10); }

// POST /api/staff/reply { thought, course, text } · an empty text takes it down.
async function handleStaffReply(request, env, me) {
  const body = await readJson(request, 8192);
  const thought = String(body.thought || ''), course = String(body.course || '');
  if (!THOUGHT_ID_RE.test(thought)) throw fail('which thought?');
  if (!SLUG_RE.test(course)) throw fail('pick a course');
  if (!(await mayWriteCourse(env, me, course))) return json({ error: 'your login doesn’t cover this course' }, 403, env, request);
  const text = str(body.text, 600).trim();
  const db = await contentDb(env);
  // A reply given for another course stays theirs.
  const had = await db.prepare('SELECT course FROM staff_replies WHERE thought = ?').bind(thought).first();
  if (had && had.course !== course && !(await mayWriteCourse(env, me, had.course))) {
    return json({ error: 'someone already answered this one for another course' }, 403, env, request);
  }
  const now = Math.floor(Date.now() / 1000);
  if (!text) await db.prepare('DELETE FROM staff_replies WHERE thought = ?').bind(thought).run();
  else {
    await db.prepare(`INSERT INTO staff_replies (thought, uni, course, text, by, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thought) DO UPDATE SET course = excluded.course, text = excluded.text, by = excluded.by, by_name = excluded.by_name, at = excluded.at`)
      .bind(thought, me.uni, course, text, me.username, me.name || me.username, now).run();
  }
  await staffLog(env, me, firstCollege(me), `${await courseName(env, me.uni, course)} · reply to what a student said${text ? '' : ' removed'}`);
  return json({ ok: true }, 200, env, request);
}

// POST /api/staff/report { thought, course, plan, text } · text is a copy, so
// the admin sees what was reported even if the wall changes.
async function handleStaffReport(request, env, me) {
  const body = await readJson(request, 8192);
  const thought = String(body.thought || ''), course = String(body.course || ''), plan = String(body.plan || '');
  if (!THOUGHT_ID_RE.test(thought)) throw fail('which thought?');
  if (!SLUG_RE.test(course)) throw fail('pick a course');
  if (plan && !SLUG_RE.test(plan)) throw fail('bad major');
  if (!(await mayWriteCourse(env, me, course))) return json({ error: 'your login doesn’t cover this course' }, 403, env, request);
  const db = await contentDb(env);
  await db.prepare(`INSERT INTO staff_reports (thought, uni, plan, course, text, by, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thought) DO NOTHING`)
    .bind(thought, me.uni, plan, course, str(body.text, 300).trim(), me.username, me.name || me.username, Math.floor(Date.now() / 1000)).run();
  await staffLog(env, me, firstCollege(me), `${await courseName(env, me.uni, course)} · reported what a student said to the admin`);
  return json({ ok: true }, 200, env, request);
}

// GET /api/staff/reported · the thoughts this login reported, and what the
// admin did with each.
async function handleStaffReported(request, env, me) {
  const db = await contentDb(env);
  const rs = await db.prepare('SELECT thought, status FROM staff_reports WHERE by = ? AND uni = ?').bind(me.username, me.uni).all();
  return json({ ok: true, reported: (rs.results || []).map((r) => ({ thought: r.thought, status: r.status })) }, 200, env, request);
}

// /api/admin/reports · the admin's list, and closing one.
async function handleAdminReports(request, env, seg) {
  const db = await contentDb(env);
  if (!seg[3] && request.method === 'GET') {
    const rs = await db.prepare("SELECT * FROM staff_reports WHERE status = 'open' ORDER BY at DESC").all();
    const reports = [];
    for (const r of rs.results || []) {
      reports.push({ thought: r.thought, uni: r.uni, plan: r.plan, course: r.course, courseName: await courseName(env, r.uni, r.course),
        text: r.text, byName: r.by_name, at: r.at });
    }
    return json({ ok: true, reports }, 200, env, request);
  }
  if (seg[3] && request.method === 'POST') {
    const body = await readJson(request, 1024);
    const status = String(body.status || '');
    if (!['removed', 'kept'].includes(status)) throw fail('status must be removed or kept');
    await db.prepare('UPDATE staff_reports SET status = ?, decided_at = ? WHERE thought = ?')
      .bind(status, Math.floor(Date.now() / 1000), seg[3]).run();
    return json({ ok: true }, 200, env, request);
  }
  return json({ error: 'not found' }, 404, env, request);
}

// ---------------------------------------------------------------------------
// College dates on Home (round 10, idea 11)
//
// A dean's dates (midterm week, a deadline) show on Home next to the
// university's own, for students of that college only. '*' is every college.
// ---------------------------------------------------------------------------
async function handleStaffDates(request, env, me, seg) {
  if (me.role !== 'dean') return json({ error: 'only a dean can add college dates' }, 403, env, request);
  const db = await contentDb(env);
  const mine = (college) => me.college === '*' || (college !== '*' && coversCollege(me, college));
  if (!seg[3] && request.method === 'GET') {
    const rs = await db.prepare('SELECT id, college, label, date, by_name FROM staff_dates WHERE uni = ? AND date >= ? ORDER BY date')
      .bind(me.uni, isoDay(-1)).all();
    return json({ ok: true, dates: (rs.results || []).filter((r) => mine(r.college)).map((r) => ({ id: r.id, college: r.college, label: r.label, date: r.date, byName: r.by_name })) }, 200, env, request);
  }
  if (!seg[3] && request.method === 'POST') {
    const body = await readJson(request, 4096);
    const label = str(body.label, 60).trim();
    const date = String(body.date || '');
    const college = String(body.college || firstCollege(me) || '*');
    if (!label) throw fail('write what the date is');
    if (!DATE_RE.test(date) || date < isoDay(0)) throw fail('pick a date from today on');
    if (college !== '*' && !SLUG_RE.test(college)) throw fail('pick a college');
    if (!mine(college)) return json({ error: 'that college isn’t yours' }, 403, env, request);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM staff_dates WHERE uni = ? AND college = ? AND date >= ?').bind(me.uni, college, isoDay(0)).first();
    if (n && n.n >= 30) throw fail('that college already has 30 dates coming up');
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO staff_dates (id, uni, college, label, date, by, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, me.uni, college, label, date, me.username, me.name || me.username, Math.floor(Date.now() / 1000)).run();
    await staffLog(env, me, college === '*' ? '' : college, `College date · ${label} · ${date}`);
    return json({ ok: true, id }, 200, env, request);
  }
  if (seg[3] && request.method === 'DELETE') {
    const row = await db.prepare('SELECT * FROM staff_dates WHERE id = ? AND uni = ?').bind(seg[3], me.uni).first();
    if (!row || !mine(row.college)) return json({ error: 'not found' }, 404, env, request);
    await db.prepare('DELETE FROM staff_dates WHERE id = ?').bind(row.id).run();
    await staffLog(env, me, row.college === '*' ? '' : row.college, `College date removed · ${row.label} · ${row.date}`);
    return json({ ok: true }, 200, env, request);
  }
  return json({ error: 'not found' }, 404, env, request);
}

// ---------------------------------------------------------------------------
// Recent changes, with Put back (round 10, idea 18)
//
// What changed in a dean's colleges, newest first, with who did it. A change
// to what students read about a course keeps the value it replaced, and Put
// back restores that (itself a change, which can be put back in turn). Plan
// changes are commits, put back from Edit this major's history instead.
// ---------------------------------------------------------------------------
async function handleStaffLog(request, env, me, seg) {
  if (me.role !== 'dean') return json({ error: 'only a dean can see this' }, 403, env, request);
  const db = await contentDb(env);
  const undoOf = (r) => { try { return r.undo ? JSON.parse(r.undo) : null; } catch { return null; } };
  const mine = async (r, u) => me.college === '*' || (u && u.course ? await mayWriteCourse(env, me, u.course) : !!(r.college && coversCollege(me, r.college)));
  if (!seg[3] && request.method === 'GET') {
    const rs = await db.prepare('SELECT id, college, what, by, at, undo, undone FROM staff_log WHERE uni = ? ORDER BY id DESC LIMIT 300').bind(me.uni).all();
    const out = [];
    for (const r of rs.results || []) {
      if (out.length >= 30) break;
      const u = undoOf(r);
      if (!(await mine(r, u))) continue;
      out.push({ id: r.id, what: r.what, by: r.by, at: r.at, canPutBack: !!(u && u.course && CONTENT_FIELDS[u.field]) && !r.undone, undone: !!r.undone });
    }
    return json({ ok: true, log: out }, 200, env, request);
  }
  if (seg[3] && seg[4] === 'putback' && request.method === 'POST') {
    const r = await db.prepare('SELECT * FROM staff_log WHERE id = ? AND uni = ?').bind(Number(seg[3]) || 0, me.uni).first();
    const u = r && undoOf(r);
    if (!r || !u || !u.course || !CONTENT_FIELDS[u.field] || !(await mine(r, u))) return json({ error: 'not found' }, 404, env, request);
    if (r.undone) return json({ error: 'that one is already put back' }, 409, env, request);
    if (!(await mayWriteCourse(env, me, u.course))) return json({ error: 'your login doesn’t cover this course' }, 403, env, request);
    await applyContent(db, env, me.uni, firstCollege(me), u.course, u.field, String(u.value || ''), me.name || me.username, ' · put back');
    await db.prepare('UPDATE staff_log SET undone = 1 WHERE id = ?').bind(r.id).run();
    return json({ ok: true }, 200, env, request);
  }
  return json({ error: 'not found' }, 404, env, request);
}

async function handleStaffRoutes(request, env, seg, url) {
  if (seg[1] !== 'staff') return null;
  if (seg[2] === 'login' && request.method === 'POST') return await handleStaffLogin(request, env);
  if (seg[2] === 'setup' && request.method === 'POST') return await handleStaffSetup(request, env);
  let me = await verifyStaff(request, env);
  // The admin, on the staff page, works as a dean of every college.
  if (!me) {
    const auth = request.headers.get('Authorization') || '';
    const admin = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', env);
    if (admin) me = { id: 'admin', username: 'admin', name: 'Admin', role: 'dean', uni: 'aaup', college: '*', courses: '[]', status: 'active', password_hash: 'x', admin: true };
  }
  if (!me) return json({ error: 'unauthorized' }, 401, env, request);
  if (me.admin && seg[2] === 'card') return json({ ok: true, card: null }, 200, env, request);
  if (seg[2] === 'me' && request.method === 'GET') return json({ ok: true, me: { ...staffOut(me), admin: !!me.admin } }, 200, env, request);
  if (seg[2] === 'content' && request.method === 'POST') return await handleStaffContent(request, env, me);
  if (seg[2] === 'prereqs' && request.method === 'POST') return await handleStaffPrereqs(request, env, me);
  if (['majors', 'major', 'history', 'status', 'tree', 'university'].includes(seg[2])) return await handleStaffMajors(request, env, me, seg, url);
  if (seg[2] === 'reply' && request.method === 'POST') return await handleStaffReply(request, env, me);
  if (seg[2] === 'report' && request.method === 'POST') return await handleStaffReport(request, env, me);
  if (seg[2] === 'reported' && request.method === 'GET') return await handleStaffReported(request, env, me);
  if (seg[2] === 'dates') return await handleStaffDates(request, env, me, seg);
  if (seg[2] === 'log') return await handleStaffLog(request, env, me, seg);
  if (seg[2] === 'card' && request.method === 'POST') return await handleStaffCard(request, env, me);
  if (seg[2] === 'card' && request.method === 'GET') {
    const db = await contentDb(env);
    const c = await db.prepare('SELECT * FROM staff_cards WHERE uni = ? AND username = ?').bind(me.uni, me.username).first();
    return json({ ok: true, card: cardOut(c) }, 200, env, request);
  }
  if (seg[2] === 'pending' && !seg[3] && request.method === 'GET') return json({ ok: true, pending: await listPending(env, me) }, 200, env, request);
  if (seg[2] === 'pending' && seg[3] && request.method === 'POST') return await decidePending(request, env, me, seg[3]);

  // /api/staff/team — a dean's professors (same university and college).
  if (seg[2] === 'team') {
    if (me.role !== 'dean') return json({ error: 'only a dean can do that' }, 403, env, request);
    const db = await staffDb(env);
    if (!seg[3] && request.method === 'GET') {
      const rs = await db.prepare("SELECT * FROM staff WHERE role = 'professor' AND uni = ? ORDER BY created_at").bind(me.uni).all();
      return json({ ok: true, staff: await withCards(env, (rs.results || []).filter((r) => sharesCollege(me, r))) }, 200, env, request);
    }
    if (!seg[3] && request.method === 'POST') {
      const body = await readJson(request, 16384);
      const res = await createStaff(env, body, me.username, me);
      await cardFromForm(env, await db.prepare('SELECT * FROM staff WHERE id = ?').bind(res.staff.id).first(), body, me.name || me.username);
      return json({ ok: true, ...res }, 200, env, request);
    }
    if (seg[3]) {
      const found = await db.prepare("SELECT * FROM staff WHERE id = ? AND role = 'professor' AND uni = ?")
        .bind(seg[3], me.uni).first();
      const row = found && sharesCollege(me, found) ? found : null;
      if (!row) return json({ error: 'not found' }, 404, env, request);
      if (request.method === 'PATCH') {
        const body = await readJson(request, 16384);
        const onlyCard = !Object.keys(body).some((k) => !['email', 'phone', 'phoneShown'].includes(k));
        const res = onlyCard ? { staff: staffOut(row) } : await updateStaff(env, row, body, me);
        await cardFromForm(env, await db.prepare('SELECT * FROM staff WHERE id = ?').bind(row.id).first(), body, me.name || me.username);
        return json({ ok: true, ...res }, 200, env, request);
      }
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM staff WHERE id = ?').bind(row.id).run();
        return json({ ok: true }, 200, env, request);
      }
    }
  }
  return json({ error: 'not found' }, 404, env, request);
}

// /api/admin/staff — the admin's view of every login.
async function handleAdminStaff(request, env, seg) {
  const db = await staffDb(env);
  if (!seg[3] && request.method === 'GET') {
    const rs = await db.prepare('SELECT * FROM staff ORDER BY role, uni, college, created_at').all();
    return json({ ok: true, staff: await withCards(env, rs.results || []) }, 200, env, request);
  }
  if (!seg[3] && request.method === 'POST') {
    const body = await readJson(request, 16384);
    const res = await createStaff(env, body, 'admin', null);
    await cardFromForm(env, await db.prepare('SELECT * FROM staff WHERE id = ?').bind(res.staff.id).first(), body, 'Admin');
    return json({ ok: true, ...res }, 200, env, request);
  }
  if (seg[3]) {
    const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(seg[3]).first();
    if (!row) return json({ error: 'not found' }, 404, env, request);
    if (request.method === 'PATCH') {
      const body = await readJson(request, 16384);
      const onlyCard = !Object.keys(body).some((k) => !['email', 'phone', 'phoneShown'].includes(k));
      const res = onlyCard ? { staff: staffOut(row) } : await updateStaff(env, row, body, null);
      await cardFromForm(env, await db.prepare('SELECT * FROM staff WHERE id = ?').bind(row.id).first(), body, 'Admin');
      return json({ ok: true, ...res }, 200, env, request);
    }
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM staff WHERE id = ?').bind(row.id).run();
      return json({ ok: true }, 200, env, request);
    }
  }
  return json({ error: 'not found' }, 404, env, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const seg = path.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (path === '/__version') return json({ build: WORKER_BUILD }, 200, env, request);

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

      // Staff (deans and professors) sign in and work through their own
      // routes, checked by verifyStaff() — never by the admin gate below.
      if (seg[0] === 'api' && seg[1] === 'staff') return await handleStaffRoutes(request, env, seg, url);
      // What staff wrote, for every student (no sign-in).
      if (seg[1] === 'public' && seg[2] === 'content' && request.method === 'GET') {
        return await handlePublicContent(request, env, url.searchParams.get('uni') || 'aaup');
      }

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
        if (request.method === 'GET') return await handleGetMajor(env, seg[2], seg[3], request, url.searchParams.get('ref'));
        if (request.method === 'PUT') return await handlePutMajor(request, env, seg[2], seg[3]);
        if (request.method === 'DELETE') return await handleDeleteMajor(env, seg[2], seg[3], request);
      }

      // /api/admin/staff  ·  /api/admin/staff/:id
      if (seg[1] === 'admin' && seg[2] === 'staff') return await handleAdminStaff(request, env, seg);
      // /api/admin/reports  ·  /api/admin/reports/:thought
      if (seg[1] === 'admin' && seg[2] === 'reports') return await handleAdminReports(request, env, seg);

      // /api/history/:university/:slug
      if (seg[1] === 'history' && seg[2] && seg[3] && request.method === 'GET') {
        return await handleHistory(env, seg[2], seg[3], request);
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
