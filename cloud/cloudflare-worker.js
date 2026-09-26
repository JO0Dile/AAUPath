// ---------------------------------------------------------------------------
// Cloud Sync API — the only thing in this project that stores a student's
// email, password, or personal data anywhere but their own device.
//
// WHY THIS SHAPE
//
// Everything else in this app (admin/, ai/, collector/) is a stateless
// Worker sitting in front of GitHub — there is no database anywhere else on
// purpose. Real accounts need one: "sign in on a new phone and see the same
// progress" is not possible from a device's own localStorage alone. This is
// the one Worker in the project backed by a real datastore (Cloudflare D1),
// and it is scoped as narrowly as that requires: an email, a password hash,
// and one JSON blob per user — the same shape AAUP_STORAGE already keeps
// client-side, just mirrored.
//
//   Sign up / sign in  →  this Worker  →  D1 `users` row, session token
//   Sync push/pull      →  this Worker  →  D1 `sync_state` row (one per user)
//
// SECURITY MODEL — deliberately the same one admin/cloudflare-worker.js
// already uses, because it is already reviewed and already works:
//   - Passwords are never stored. Only a PBKDF2-SHA256 hash (600,000
//     iterations, random salt per user) — see verifyPassword() below.
//   - Sign-in returns an HMAC-signed session token (30-day expiry) carrying
//     the user's id and their CURRENT token_version. Changing the password
//     bumps token_version, which invalidates every other signed-in device's
//     token at once with no session store to maintain.
//   - EVERY route past /api/signup and /api/login re-verifies that token
//     server-side. Nothing here trusts the client.
//   - A sync push carries the client's last-known `updatedAt`; if the row
//     moved since (signed in on a second device, synced there first) the
//     push is refused with the server's current copy attached, the same
//     "this changed since you opened it" pattern the admin editor uses,
//     rather than silently overwriting one device's progress with another's.
//
// SETUP
//   1. Create a D1 database: `npx wrangler d1 create studyplan-cloud`
//   2. Apply cloud/schema.sql to it (see the comment at the top of that file).
//   3. Create a Worker, paste this file in, bind the D1 database as `DB`.
//   4. Settings → Variables:
//        SESSION_SECRET   (Secret)    any long random string — NOT the same
//                                     value as admin's SESSION_SECRET; a
//                                     leaked admin secret must not also
//                                     forge student sign-in tokens.
//        ALLOWED_ORIGIN   (Variable)  https://jo0dile.github.io
//   5. Put the Worker URL in APP_CLOUD_URL in web/js/01-catalogue.js.
//   See cloud/README.md for the full walkthrough, including why password
//   reset is not part of this v1.
// ---------------------------------------------------------------------------

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — "stay signed in", not a work session
const LOGIN_DELAY_MS = 400;                    // blunts online password guessing, same as admin
const MAX_SYNC_BYTES = 2 * 1024 * 1024;        // one student's whole local state, generously
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const MAX_EMAIL_LEN = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters, digits, underscore, 3-24 chars. No @ or . allowed, so a login
// identifier can always be classified as "looks like an email" or "looks
// like a username" without ambiguity.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

// ---------------------------------------------------------------------------
// small helpers — identical to admin/cloudflare-worker.js on purpose; two
// Workers hand-maintaining the same base64/HMAC/timing-safe primitives is
// how they quietly drift. Copied rather than shared because Workers deploy
// as a single file each with no build step in this project.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

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
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

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
  const pad = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(request, limit) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared && declared > limit) throw fail(`request body is too large (limit ${Math.round(limit / 1024)} KB)`);
  const text = await request.text();
  if (text.length > limit) throw fail(`request body is too large (limit ${Math.round(limit / 1024)} KB)`);
  try { return JSON.parse(text); } catch { throw fail('request body is not valid JSON'); }
}

function fail(msg) {
  const e = new Error(msg);
  e.userFacing = true;
  return e;
}

// ---------------------------------------------------------------------------
// password hashing + session tokens — same PBKDF2-in-chunks approach as
// admin/cloudflare-worker.js (Workers refuse a single deriveBits call above
// 100,000 iterations), and the same stored form:
//   pbkdf2$<iterations>$<saltB64url>$<hashB64url>
// ---------------------------------------------------------------------------

const PBKDF2_CHUNK = 100000;
const PBKDF2_TOTAL = 600000;

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

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveChunked(enc.encode(password), salt, PBKDF2_TOTAL);
  return `pbkdf2$${PBKDF2_TOTAL}$${b64url(salt)}$${b64url(bits)}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const salt = unb64url(parts[2]);
    const bits = await deriveChunked(enc.encode(password), salt, iterations);
    return timingSafeEqual(b64url(bits), parts[3]);
  } catch (e) {
    console.error('verifyPassword:', e && e.message ? e.message : e);
    return false;
  }
}

// A fixed, never-matching hash to verify against when the email lookup
// misses, so "no such user" and "wrong password" cost the same CPU time and
// the same wall-clock time — otherwise a login attempt's latency alone
// reveals whether an email is registered, one request at a time.
const DUMMY_HASH = 'pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function issueToken(uid, tokenVersion, env) {
  const payload = { uid, tv: tokenVersion, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

// Returns {uid, tv}, or null. Never throws on malformed input.
async function verifyToken(token, env) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(env.SESSION_SECRET), unb64url(sig), enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!payload || typeof payload.exp !== 'number' || typeof payload.uid !== 'string') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: payload.uid, tv: payload.tv };
  } catch {
    return null;
  }
}

// The gate every route past signup/login goes through. Returns the user row
// on success, or the Response to send back — so a route cannot forget to
// check it. Re-reads the user from D1 every time (not just the token)
// because token_version living only in the token would make a password
// change unable to actually revoke anything.
async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = await verifyToken(token, env);
  if (!claims) return { error: json({ error: 'unauthorized' }, 401, env, request) };
  const row = await env.DB.prepare('SELECT id, email, username, token_version, created_at FROM users WHERE id = ?')
    .bind(claims.uid).first();
  if (!row || row.token_version !== claims.tv) {
    return { error: json({ error: 'session expired — please sign in again' }, 401, env, request) };
  }
  return { user: row };
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

async function handleSignup(request, env) {
  if (!env.SESSION_SECRET) return json({ error: 'cloud sync is not configured on the server' }, 500, env, request);
  const body = await readJson(request, 4096);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  // Optional: a friendlier sign-in identifier than a full email address.
  // '' means "not set," not "set to empty" — normalizeUsername below keeps
  // that distinction so an unset username never collides with another
  // unset one under a UNIQUE index.
  const usernameRaw = body.username == null ? '' : String(body.username).trim();

  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ error: 'enter a valid email address' }, 400, env, request);
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return json({ error: `password must be at least ${MIN_PASSWORD_LEN} characters` }, 400, env, request);
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return json({ error: 'password is too long' }, 400, env, request);
  }
  if (usernameRaw && !USERNAME_RE.test(usernameRaw)) {
    return json({ error: 'username must be 3-24 characters: letters, numbers, underscore only' }, 400, env, request);
  }
  const username = usernameRaw || null;

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'an account with that email already exists — sign in instead' }, 409, env, request);
  if (username) {
    const takenUsername = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (takenUsername) return json({ error: 'that username is already taken' }, 409, env, request);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const createdAt = Date.now();
  await env.DB.prepare('INSERT INTO users (id, email, username, password_hash, token_version, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .bind(id, email, username, passwordHash, createdAt).run();

  return json({ ok: true, token: await issueToken(id, 1, env), email, username, createdAt }, 200, env, request);
}

async function handleLogin(request, env) {
  await sleep(LOGIN_DELAY_MS);
  if (!env.SESSION_SECRET) return json({ error: 'cloud sync is not configured on the server' }, 500, env, request);
  const body = await readJson(request, 4096);
  // One field does double duty: a student can type either their email or
  // their username to sign in. Deciding which lookup to run from the
  // SHAPE of the text (contains '@' and a dot => email) rather than trying
  // both queries keeps this to one DB read either way.
  const identifier = String(body.email != null ? body.email : body.identifier || '').trim();
  const password = String(body.password || '');
  const looksLikeEmail = EMAIL_RE.test(identifier);
  const lookupValue = looksLikeEmail ? normalizeEmail(identifier) : identifier;
  const lookupColumn = looksLikeEmail ? 'email' : 'username';

  const row = await env.DB.prepare(`SELECT id, email, username, password_hash, token_version, created_at FROM users WHERE ${lookupColumn} = ?`)
    .bind(lookupValue).first();
  const passOk = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);

  if (!row || !passOk) return json({ error: 'invalid email/username or password' }, 401, env, request);

  return json({
    ok: true,
    token: await issueToken(row.id, row.token_version, env),
    email: row.email,
    username: row.username,
    createdAt: row.created_at,
  }, 200, env, request);
}

async function handleMe(env, request, user) {
  return json({ ok: true, email: user.email, username: user.username, createdAt: user.created_at }, 200, env, request);
}

async function handleSetUsername(request, env, user) {
  const body = await readJson(request, 4096);
  const usernameRaw = body.username == null ? '' : String(body.username).trim();
  if (!usernameRaw) {
    await env.DB.prepare('UPDATE users SET username = NULL WHERE id = ?').bind(user.id).run();
    return json({ ok: true, username: null }, 200, env, request);
  }
  if (!USERNAME_RE.test(usernameRaw)) {
    return json({ error: 'username must be 3-24 characters: letters, numbers, underscore only' }, 400, env, request);
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(usernameRaw, user.id).first();
  if (taken) return json({ error: 'that username is already taken' }, 409, env, request);
  await env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(usernameRaw, user.id).run();
  return json({ ok: true, username: usernameRaw }, 200, env, request);
}

async function handleChangePassword(request, env, user) {
  const body = await readJson(request, 4096);
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  if (next.length < MIN_PASSWORD_LEN) {
    return json({ error: `new password must be at least ${MIN_PASSWORD_LEN} characters` }, 400, env, request);
  }
  if (next.length > MAX_PASSWORD_LEN) return json({ error: 'new password is too long' }, 400, env, request);

  const row = await env.DB.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').bind(user.id).first();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return json({ error: 'current password is incorrect' }, 401, env, request);
  }
  const newHash = await hashPassword(next);
  const newVersion = (row.token_version || 1) + 1;
  await env.DB.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?')
    .bind(newHash, newVersion, user.id).run();

  // Every OTHER device's token stops working the instant token_version no
  // longer matches — this device gets a fresh one so it is not logged out
  // by the very password change it just made.
  return json({ ok: true, token: await issueToken(user.id, newVersion, env) }, 200, env, request);
}

async function handleDeleteAccount(env, request, user) {
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  return json({ ok: true }, 200, env, request);
}

async function handleGetSync(env, request, user) {
  const row = await env.DB.prepare('SELECT data, updated_at FROM sync_state WHERE user_id = ?').bind(user.id).first();
  if (!row) return json({ ok: true, data: null, updatedAt: 0 }, 200, env, request);
  return json({ ok: true, data: JSON.parse(row.data), updatedAt: row.updated_at }, 200, env, request);
}

async function handlePostSync(request, env, user) {
  const body = await readJson(request, MAX_SYNC_BYTES);
  if (body.data === undefined || typeof body.data !== 'object' || body.data === null) {
    return json({ error: 'missing data object' }, 400, env, request);
  }

  const existing = await env.DB.prepare('SELECT updated_at, data FROM sync_state WHERE user_id = ?').bind(user.id).first();
  const baseUpdatedAt = Number.isFinite(body.baseUpdatedAt) ? body.baseUpdatedAt : null;
  // Same shape as admin's staleBase(): a push that started from an
  // out-of-date read would otherwise silently overwrite whatever another
  // device already synced up in the meantime. Pushes sent without a
  // baseUpdatedAt (first sync ever from this device) are always accepted.
  if (existing && baseUpdatedAt !== null && baseUpdatedAt !== existing.updated_at) {
    return json({
      error: 'synced data changed since this device last read it',
      conflict: true,
      serverData: JSON.parse(existing.data),
      serverUpdatedAt: existing.updated_at,
    }, 409, env, request);
  }

  const dataText = JSON.stringify(body.data);
  if (dataText.length > MAX_SYNC_BYTES) return json({ error: 'synced data is too large' }, 413, env, request);
  const updatedAt = Date.now();
  await env.DB.prepare(
    'INSERT INTO sync_state (user_id, data, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  ).bind(user.id, dataText, updatedAt).run();

  return json({ ok: true, updatedAt }, 200, env, request);
}

// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    if (path === '/api/health' || path === '/health') {
      return json({ ok: true }, 200, env, request);
    }

    // `return await`, never a bare `return`: an un-awaited handler promise
    // leaves this try before it settles, so its rejection skips the catch and
    // escapes as Cloudflare's HTML error page with no CORS header — which the
    // browser then reports as a CORS block instead of the real error.
    try {
      if (path === '/api/signup' && request.method === 'POST') return await handleSignup(request, env);
      if (path === '/api/login' && request.method === 'POST') return await handleLogin(request, env);

      // Everything past this line requires a valid, live session.
      const gate = await requireUser(request, env);
      if (gate.error) return gate.error;
      const user = gate.user;

      if (path === '/api/me' && request.method === 'GET') return await handleMe(env, request, user);
      if (path === '/api/username' && request.method === 'POST') return await handleSetUsername(request, env, user);
      if (path === '/api/password/change' && request.method === 'POST') return await handleChangePassword(request, env, user);
      if (path === '/api/account' && request.method === 'DELETE') return await handleDeleteAccount(env, request, user);
      if (path === '/api/sync' && request.method === 'GET') return await handleGetSync(env, request, user);
      if (path === '/api/sync' && request.method === 'POST') return await handlePostSync(request, env, user);

      return json({ error: 'not found' }, 404, env, request);
    } catch (err) {
      if (err && err.userFacing) return json({ error: err.message }, 400, env, request);
      console.error('cloud worker error:', err && err.stack ? err.stack : err);
      return json({ error: 'something went wrong on the server — check the Worker logs' }, 500, env, request);
    }
  },
};
