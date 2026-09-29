// ---------------------------------------------------------------------------
// Ratings — a small Cloudflare Worker turning the difficulty/workload stars
// a student already sets on a course (js/20-personal.js, entirely local
// before this) into a pooled, cross-student number, plus a live count of
// who else currently has that course marked "in progress this semester"
// (js/21-course-modal-extras.js's own status field — nothing new asked of
// the student, just reported).
//
// WHY THIS IS ITS OWN WORKER
//
// Same reasoning as workers/thoughts-worker.js and
// workers/contributions-worker.js: takes writes from anyone running the
// app, so it cannot share a process or secret with the GitHub-writing admin
// Worker. The worst case of abuse here is a course's stats looking wrong
// until the next real rating comes in — nothing it stores can touch the
// repo, a plan, or another student's device.
//
// WHAT IT STORES
//
// One row per (course, device) — a device's own current difficulty,
// workload, and course status, keyed so a device can only ever have ONE
// vote per course (submitting again overwrites its own row instead of
// adding a second vote). The aggregate the app actually reads is computed
// from those rows, cached, and rebuilt on the next write to that course.
// No name, no grade, no plan — the app already strips all of that before
// this is ever called (see js/27-community.js).
//
// SETUP
//   1. Create a KV namespace and bind it as RATINGS.
//   2. Paste this file into a new Worker and deploy it.
//   3. Put the Worker's URL in APP_RATINGS_URL (web/js/01-catalogue.js).
//   4. Optional: set ALLOWED_ORIGIN to your site so no other page can post.
// ---------------------------------------------------------------------------

// Which commit this Worker was deployed from. .github/workflows/
// deploy-workers.yml writes it in on every deploy; a copy pasted by hand
// keeps the placeholder, which the admin room reads as "version unknown".
// GET /__version answers with it, so the admin room can tell whether each
// Worker is up to date.
const WORKER_BUILD = '__WORKER_BUILD__';

const RATE_WINDOW_MS = 5 * 1000;       // one write per device per course-ish burst
const MAX_COURSES_PER_QUERY = 60;
const WORKLOAD_VALUES = ['Easy', 'Medium', 'Hard'];
const STATUS_VALUES = ['planned', 'in_progress', 'done'];

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (new URL(request.url).pathname.replace(/\/+$/, '') === '/__version') return json({ build: WORKER_BUILD }, 200, cors);
    if (!env.RATINGS) return json({ error: 'KV namespace RATINGS is not bound' }, 500, cors);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      if (request.method === 'GET' && path.endsWith('/ratings')) {
        const courses = (url.searchParams.get('courses') || '')
          .split(',').map(safeId).filter(Boolean).slice(0, MAX_COURSES_PER_QUERY);
        if (!courses.length) return json({ error: 'courses is required' }, 400, cors);
        const out = {};
        for (const c of courses) out[c] = await readAggregate(env, c);
        return json({ ratings: out }, 200, cors);
      }

      if (request.method === 'POST' && path.endsWith('/ratings')) {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'invalid json' }, 400, cors);
        return await addRating(env, body, cors);
      }
    } catch (err) {
      return json({ error: 'server error' }, 500, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};

// ---- storage ---------------------------------------------------------------

const rowKey = (courseId, deviceId) => `row:${courseId}:${deviceId}`;
const aggKey = (courseId) => `agg:${courseId}`;

async function addRating(env, body, cors) {
  const courseId = safeId(body.courseId || '');
  const deviceId = safeId(body.deviceId || '');
  if (!courseId) return json({ error: 'courseId is required' }, 400, cors);
  if (!deviceId) return json({ error: 'deviceId is required' }, 400, cors);

  const rateKey = `rate:${deviceId}`;
  const last = await env.RATINGS.get(rateKey);
  if (last && Date.now() - Number(last) < RATE_WINDOW_MS) {
    return json({ error: 'slow down' }, 429, cors);
  }
  await env.RATINGS.put(rateKey, String(Date.now()), { expirationTtl: 30 });

  const difficulty = Number(body.difficulty);
  const workload = WORKLOAD_VALUES.includes(body.workload) ? body.workload : null;
  const status = STATUS_VALUES.includes(body.status) ? body.status : null;

  // A rating with nothing in it clears this device's row instead of storing
  // an empty one — matches the app's own "click the active star to clear
  // it" behaviour carrying through to the pooled number.
  const hasDifficulty = difficulty >= 1 && difficulty <= 5;
  if (!hasDifficulty && !workload && !status) {
    await env.RATINGS.delete(rowKey(courseId, deviceId));
  } else {
    const row = { difficulty: hasDifficulty ? difficulty : null, workload, status, at: Date.now() };
    await env.RATINGS.put(rowKey(courseId, deviceId), JSON.stringify(row));
  }

  const aggregate = await rebuildAggregate(env, courseId);
  return json({ ok: true, aggregate }, 200, cors);
}

async function rebuildAggregate(env, courseId) {
  const rows = await readRows(env, courseId);
  const aggregate = computeAggregate(rows);
  await env.RATINGS.put(aggKey(courseId), JSON.stringify(aggregate));
  return aggregate;
}

async function readRows(env, courseId) {
  const keys = await env.RATINGS.list({ prefix: `row:${courseId}:` });
  const rows = await Promise.all(keys.keys.map((k) => env.RATINGS.get(k.name, 'json')));
  return rows.filter(Boolean);
}

function computeAggregate(rows) {
  let difficultySum = 0, difficultyVotes = 0;
  const workloadCounts = { Easy: 0, Medium: 0, Hard: 0 };
  const statusCounts = { planned: 0, in_progress: 0, done: 0 };
  rows.forEach((r) => {
    if (typeof r.difficulty === 'number') { difficultySum += r.difficulty; difficultyVotes++; }
    if (r.workload && workloadCounts[r.workload] !== undefined) workloadCounts[r.workload]++;
    if (r.status && statusCounts[r.status] !== undefined) statusCounts[r.status]++;
  });
  return {
    avgDifficulty: difficultyVotes ? Math.round((difficultySum / difficultyVotes) * 10) / 10 : null,
    difficultyVotes,
    workloadCounts,
    inProgressCount: statusCounts.in_progress,
    plannedCount: statusCounts.planned,
  };
}

async function readAggregate(env, courseId) {
  const cached = await env.RATINGS.get(aggKey(courseId), 'json');
  if (cached) return cached;
  // Nothing cached yet (first-ever read for this course) — compute once
  // rather than reporting empty, since a write may not have happened since
  // this Worker was deployed.
  return computeAggregate(await readRows(env, courseId));
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
