// ---------------------------------------------------------------------------
// Contributions — a small Cloudflare Worker holding what students submit
// while helping build out a "coming soon" major, plus the maintainer's
// replies back to them.
//
// WHY THIS IS ITS OWN WORKER
//
// Same reasoning as workers/thoughts-worker.js: this endpoint takes writes
// from anyone running the app, so it must not sit behind the admin Worker's
// GitHub-writing secret. Nothing here can touch the repo directly — a
// contribution only becomes real course data once the maintainer reads it
// in the app's admin panel and adds it there themselves.
//
// WHAT IT STORES
//
// One submission per student per major-in-progress: the courses/years/
// prerequisites they added locally in the app's own plan editor, a device id
// (so they can check back for a reply with no account), and a display name
// if they set one. The maintainer's reply lives on the same record.
//
// SETUP
//   1. Create a KV namespace and bind it as CONTRIB.
//   2. Paste this file into a new Worker and deploy it.
//   3. Put the Worker's URL in APP_CONTRIB_URL (web/js/01-catalogue.js).
//   4. Set ADMIN_SECRET (a Worker secret, not a var) to any long random
//      string — this is what lets the admin panel list every submission
//      and reply to one, versus a student who can only ever see their own
//      device's. The app does NOT ship it: the admin panel's Contributions
//      tab asks for it once per session, so it lives only in the Worker and
//      in whatever you keep your passwords in.
//   5. Optional: set ALLOWED_ORIGIN to your site so no other page can post.
// ---------------------------------------------------------------------------

const MAX_STR = 200;
const MAX_COURSES = 400;      // generous ceiling, not a realistic count
const RATE_WINDOW_MS = 60 * 1000;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.CONTRIB) return json({ error: 'KV namespace CONTRIB is not bound' }, 500, cors);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const isAdmin = !!env.ADMIN_SECRET && request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET;

    try {
      if (request.method === 'GET' && path.endsWith('/contributions')) {
        const device = safeId(url.searchParams.get('device') || '');
        if (!isAdmin && !device) return json({ error: 'device is required' }, 400, cors);
        const all = await readAll(env);
        const list = isAdmin ? all : all.filter((c) => c.deviceId === device);
        return json({ contributions: list }, 200, cors);
      }

      if (request.method === 'POST' && path.endsWith('/contributions')) {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'invalid json' }, 400, cors);
        return await addContribution(env, body, cors);
      }

      if (request.method === 'POST' && path.includes('/contributions/') && path.endsWith('/reply')) {
        if (!isAdmin) return json({ error: 'admin only' }, 403, cors);
        const id = safeId(path.split('/contributions/')[1].replace(/\/reply$/, ''));
        const body = await request.json().catch(() => ({}));
        return await replyToContribution(env, id, body, cors);
      }

      if (request.method === 'DELETE' && path.includes('/contributions/')) {
        if (!isAdmin) return json({ error: 'admin only' }, 403, cors);
        const id = safeId(path.split('/contributions/')[1] || '');
        await env.CONTRIB.delete(itemKey(id));
        return json({ ok: true }, 200, cors);
      }
    } catch (err) {
      return json({ error: 'server error' }, 500, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};

// ---- storage ---------------------------------------------------------------

const itemKey = (id) => `contrib:${id}`;

async function readAll(env) {
  const keys = await env.CONTRIB.list({ prefix: 'contrib:' });
  const items = await Promise.all(keys.keys.map((k) => env.CONTRIB.get(k.name, 'json')));
  return items.filter(Boolean).sort((a, b) => b.submittedAt - a.submittedAt);
}

async function addContribution(env, body, cors) {
  const prefix = safeId(body.prefix || '');
  const deviceId = safeId(body.deviceId || '');
  if (!prefix) return json({ error: 'prefix is required' }, 400, cors);
  if (!deviceId) return json({ error: 'deviceId is required' }, 400, cors);
  // Two kinds of submission share this endpoint. A plan contribution carries
  // a course list; a prerequisite report (web/js/86-prereq-report.js) carries
  // one course and the arrow the student says is wrong, and has no course
  // list at all — so the non-empty check applies only to the first kind.
  const kind = body.kind === 'prereq-report' ? 'prereq-report' : 'plan';
  const courses = Array.isArray(body.courses) ? body.courses.slice(0, MAX_COURSES) : [];
  if (kind === 'plan' && !courses.length) {
    return json({ error: 'courses must be a non-empty array' }, 400, cors);
  }
  if (kind === 'prereq-report' && !body.course) {
    return json({ error: 'course is required for a prereq-report' }, 400, cors);
  }

  const rateKey = `rate:${deviceId}`;
  const last = await env.CONTRIB.get(rateKey);
  if (last && Date.now() - Number(last) < RATE_WINDOW_MS) {
    return json({ error: 'slow down' }, 429, cors);
  }
  await env.CONTRIB.put(rateKey, String(Date.now()), { expirationTtl: 60 });

  const item = {
    id: `${deviceId}-${Date.now().toString(36)}`,
    prefix,
    majorName: clean(String(body.majorName || '')).slice(0, MAX_STR),
    deviceId,
    contributorName: clean(String(body.contributorName || '')).slice(0, MAX_STR),
    kind,
    courses,
    prerequisites: Array.isArray(body.prerequisites) ? body.prerequisites.slice(0, 2000) : [],
    structure: body.structure && typeof body.structure === 'object' ? body.structure : null,
    // Report-only fields. Trimmed to the same limits as everything else here,
    // and absent entirely on a plan contribution.
    report: kind === 'prereq-report' ? {
      course: courseRef(body.course),
      wrongPrereq: body.wrongPrereq ? courseRef(body.wrongPrereq) : null,
      listedPrereqs: (Array.isArray(body.listedPrereqs) ? body.listedPrereqs : [])
        .slice(0, 40).map(courseRef),
      note: clean(String(body.note || '')).slice(0, 500),
    } : null,
    status: 'pending',
    adminReply: '',
    submittedAt: Date.now(),
    repliedAt: 0,
  };
  await env.CONTRIB.put(itemKey(item.id), JSON.stringify(item));
  return json({ ok: true, id: item.id }, 200, cors);
}

async function replyToContribution(env, id, body, cors) {
  if (!id) return json({ error: 'id is required' }, 400, cors);
  const existing = await env.CONTRIB.get(itemKey(id), 'json');
  if (!existing) return json({ error: 'not found' }, 404, cors);
  existing.adminReply = clean(String(body.message || '')).slice(0, 500);
  existing.status = safeId(body.status || 'replied') || 'replied';
  existing.repliedAt = Date.now();
  await env.CONTRIB.put(itemKey(id), JSON.stringify(existing));
  return json({ ok: true, contribution: existing }, 200, cors);
}

// ---- helpers ---------------------------------------------------------------

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
function safeId(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}
function courseRef(c) {
  const o = c && typeof c === 'object' ? c : {};
  return {
    id: safeId(o.id || ''),
    num: clean(String(o.num || '')).slice(0, 40),
    name: clean(String(o.name || '')).slice(0, MAX_STR),
  };
}
function clean(s) {
  return s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}
