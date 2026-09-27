// ---------------------------------------------------------------------------
// Student Thoughts — a small Cloudflare Worker holding the shared wall.
//
// WHY THIS IS ITS OWN WORKER
//
// The admin Worker holds a GitHub token that can write to the repository.
// This endpoint accepts writes from ANYONE running the app — that is the
// whole point of a wall — so the two must never share a process, a secret or
// a blast radius. If this one is ever abused, the worst case is a wall full
// of rubbish that can be cleared with one KV delete. Nothing here can touch
// the repo, the plans, or a student's progress.
//
// WHAT IT STORES
//
// One line of text, a display name if the student set one, a timestamp, and
// an opaque device id used only so a student can delete their own post. No
// account, no email, no IP kept after rate limiting, no progress data. A
// thought is public by definition, so nothing private is accepted in the
// first place.
//
// SETUP
//   1. Create a KV namespace and bind it as THOUGHTS.
//   2. Paste this file into a new Worker and deploy it.
//   3. Put the Worker's URL in APP_THOUGHTS_URL (web/js/01-catalogue.js).
//   4. Optional: set ALLOWED_ORIGIN to your site so no other page can post.
//   5. Optional: set ADMIN_SECRET (a Worker secret, not a var) to a long
//      random string. The Developer panel's Student Thoughts section sends it
//      to list every wall and delete any post. Without it, only a post's own
//      device can delete it.
//
// The app filters language before it ever calls this (web/js/58-wordfilter.js),
// but a Worker must never trust its client — anyone can curl this URL — so
// the same list runs again here, server-side, and that copy is the one that
// actually decides.
// ---------------------------------------------------------------------------

const MAX_LEN = 280;
const MAX_PER_PLAN = 200;        // the wall keeps the most recent N
const RATE_WINDOW_MS = 20 * 1000;
const RATE_MAX = 1;              // posts per device per window

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
    if (!env.THOUGHTS) return json({ error: 'KV namespace THOUGHTS is not bound' }, 500, cors);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const isAdmin = !!env.ADMIN_SECRET && request.headers.get('X-Admin-Secret') === env.ADMIN_SECRET;

    try {
      // Every wall at once, newest first, for the Developer panel. Admin only:
      // it includes the device ids, which nobody else ever gets.
      if (request.method === 'GET' && path.endsWith('/thoughts/all')) {
        if (!isAdmin) return json({ error: 'forbidden' }, 403, cors);
        const planKeys = await env.THOUGHTS.list({ prefix: 'wall:' });
        const all = [];
        for (const k of planKeys.keys) {
          const plan = k.name.slice('wall:'.length);
          (await readWall(env, plan)).forEach((t) => all.push({ ...t, plan, voters: undefined }));
        }
        all.sort((a, b) => (b.at || 0) - (a.at || 0));
        return json({ thoughts: all }, 200, cors);
      }

      if (request.method === 'GET' && path.endsWith('/thoughts')) {
        const plan = safeId(url.searchParams.get('plan') || '');
        // One wall for the whole university: ?all=1 merges every major's
        // list, newest first. Posts are still stored per major (so each one
        // keeps which major it came from, shown as a tag in the app), but
        // everybody reads all of them.
        const all = url.searchParams.get('all') === '1';
        if (!plan && !all) return json({ error: 'plan is required' }, 400, cors);
        let list;
        if (all) {
          list = [];
          const planKeys = await env.THOUGHTS.list({ prefix: 'wall:' });
          for (const k of planKeys.keys) {
            const p = k.name.slice('wall:'.length);
            (await readWall(env, p)).forEach((t) => list.push({ ...t, plan: t.plan || p }));
          }
          list.sort((a, b) => (b.at || 0) - (a.at || 0));
          list = list.slice(0, 400);
        } else {
          list = await readWall(env, plan);
        }
        // `voters` is which device id cast which reaction — that is exactly
        // the kind of anonymous-but-linkable record this Worker promises not
        // to keep around for anyone but the owner. Every reader gets the
        // count; nobody but this endpoint's own react handler ever sees who.
        const out = list.map((t) => ({ ...t, up: countReactions(t, 'up'), down: countReactions(t, 'down'), voters: undefined }));
        return json({ thoughts: out }, 200, cors);
      }

      if (request.method === 'POST' && path.endsWith('/thoughts')) {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'invalid json' }, 400, cors);
        return await addThought(env, body, cors, request);
      }

      if (request.method === 'POST' && path.includes('/thoughts/') && path.endsWith('/react')) {
        const id = decodeURIComponent(path.split('/thoughts/')[1].replace(/\/react$/, ''));
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'invalid json' }, 400, cors);
        return await reactToThought(env, id, body, cors);
      }

      if (request.method === 'DELETE' && path.includes('/thoughts/')) {
        const id = decodeURIComponent(path.split('/thoughts/')[1] || '');
        const body = await request.json().catch(() => ({}));
        return await deleteThought(env, id, String(body.by || ''), cors, isAdmin);
      }
    } catch (err) {
      return json({ error: 'server error' }, 500, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};

// ---- storage ---------------------------------------------------------------

const key = (plan) => `wall:${plan}`;

async function readWall(env, plan) {
  const raw = await env.THOUGHTS.get(key(plan));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeWall(env, plan, list) {
  await env.THOUGHTS.put(key(plan), JSON.stringify(list.slice(0, MAX_PER_PLAN)));
}

async function addThought(env, body, cors, request) {
  const plan = safeId(body.plan || '');
  const by = safeId(body.by || '');
  const text = clean(String(body.text || '')).slice(0, MAX_LEN).trim();
  const name = clean(String(body.name || '')).slice(0, 40).trim();

  if (!plan) return json({ error: 'plan is required' }, 400, cors);
  if (!by) return json({ error: 'by is required' }, 400, cors);
  if (!text) return json({ error: 'empty' }, 400, cors);

  // The client already checked; check again, because the client is whatever
  // is on the other end of the wire and may not be the app at all.
  const bad = firstBadWord(text);
  if (bad) return json({ error: 'blocked', word: bad }, 422, cors);

  // One post per device per window. Keyed on the device id, not the IP: a
  // whole campus can share one address, and blocking a campus to slow one
  // person down is the wrong trade.
  const rateKey = `rate:${by}`;
  const last = await env.THOUGHTS.get(rateKey);
  if (last && Date.now() - Number(last) < RATE_WINDOW_MS) {
    return json({ error: 'slow down' }, 429, cors);
  }
  await env.THOUGHTS.put(rateKey, String(Date.now()), { expirationTtl: 60 });

  // SPAM. The device id above is made up by the client, so a script can
  // invent a new one for every post. Three more limits the client cannot
  // choose its way around:
  //   - per network address: 20 posts in 10 minutes. Generous on purpose —
  //     a whole campus can share one address. The address itself is never
  //     stored: only a salted hash, as a counter that expires in 10 minutes.
  //   - per device per day: 15.
  //   - the same words twice: a post identical to one already on the wall
  //     from the last day is refused.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip) {
    const ipKey = `ip:${await sha256((env.ADMIN_SECRET || 'aaupath') + ip)}`;
    const n = Number(await env.THOUGHTS.get(ipKey)) || 0;
    if (n >= 20) return json({ error: 'too many', final: true }, 429, cors);
    await env.THOUGHTS.put(ipKey, String(n + 1), { expirationTtl: 600 });
  }
  const dayKey = `day:${by}:${new Date().toISOString().slice(0, 10)}`;
  const today = Number(await env.THOUGHTS.get(dayKey)) || 0;
  if (today >= 15) return json({ error: 'daily limit', final: true }, 429, cors);
  await env.THOUGHTS.put(dayKey, String(today + 1), { expirationTtl: 60 * 60 * 26 });
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const wall0 = await readWall(env, plan);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (wall0.some((t) => (t.at || 0) > dayAgo && norm(t.text || '') === norm(text))) {
    return json({ error: 'duplicate', final: true }, 409, cors);
  }

  const item = {
    id: safeId(body.id || '') || `${by}-${Date.now().toString(36)}`,
    text,
    name,
    at: Date.now(),
    by,
  };
  // A post written from inside a course carries that course, so the app can
  // show it on the course's own page as well as on the whole wall.
  const course = safeId(body.course || '').slice(0, 80);
  if (course) {
    item.course = course;
    item.courseName = clean(String(body.courseName || '')).slice(0, 80).trim();
  }

  const list = await readWall(env, plan);
  // Same id twice = a queued post being retried after it actually landed.
  if (!list.some((t) => t.id === item.id)) list.unshift(item);
  await writeWall(env, plan, list);

  return json({ ok: true, thought: item }, 200, cors);
}

function countReactions(t, kind) {
  const voters = t.voters || {};
  return Object.keys(voters).filter((k) => voters[k] === kind).length;
}

// One reaction per device per thought, switchable, and un-settable by
// sending the same kind twice (toggle off) — same ownership model as
// deleteThought below: the device id is the only claim there is.
async function reactToThought(env, id, body, cors) {
  const plan = safeId(body.plan || '');
  const by = safeId(body.by || '');
  const kind = body.kind === 'up' || body.kind === 'down' ? body.kind : null;
  if (!plan || !by) return json({ error: 'plan and by are required' }, 400, cors);

  const list = await readWall(env, plan);
  const item = list.find((t) => t.id === id);
  if (!item) return json({ error: 'not found' }, 404, cors);
  if (!item.voters) item.voters = {};

  if (kind && item.voters[by] === kind) {
    delete item.voters[by]; // tapping the same reaction again clears it
  } else if (kind) {
    item.voters[by] = kind;
  } else {
    delete item.voters[by];
  }
  await writeWall(env, plan, list);
  return json({ ok: true, up: countReactions(item, 'up'), down: countReactions(item, 'down'), mine: item.voters[by] || null }, 200, cors);
}

async function deleteThought(env, id, by, cors, isAdmin) {
  if (!id || (!by && !isAdmin)) return json({ error: 'id and by are required' }, 400, cors);
  // The device id is the only claim of ownership there is. It is not a
  // password and is not treated as one — it lets a student remove their own
  // post from their own phone, and nothing more.
  const planKeys = await env.THOUGHTS.list({ prefix: 'wall:' });
  for (const k of planKeys.keys) {
    const plan = k.name.slice('wall:'.length);
    const list = await readWall(env, plan);
    // The maintainer can remove any post; everyone else only their own.
    const next = list.filter((t) => !(t.id === id && (isAdmin || t.by === by)));
    if (next.length !== list.length) {
      await writeWall(env, plan, next);
      return json({ ok: true }, 200, cors);
    }
  }
  return json({ ok: true, note: 'nothing matched' }, 200, cors);
}

// ---- helpers ---------------------------------------------------------------

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function safeId(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
}

// Angle brackets never survive: the app escapes on render too, but a stored
// value that cannot contain markup is one less thing to get right later.
function clean(s) {
  return s.replace(/[<>]/g, '').replace(/\s+/g, ' ');
}

// ---- the same decision as the client -------------------------------------
//
// This copy is the one that actually decides: a client is whatever is on the
// other end of the wire, and anyone can curl this URL. It mirrors
// web/js/58-wordfilter.js — same normalization, same tiers, same context
// rules. When you change one, change the other; a word blocked only on the
// client is not blocked at all.
//
//   ALWAYS       an insult in every sentence. No context is looked for.
//   CONTEXTUAL   only an insult when aimed at a person.
//   COMPARATIVE  "أفعل من" — an insult wearing a topical sentence as a coat.
//
// The contextual decision, in order: a person right beside the word with no
// governing preposition in front of it, then strong targeting, then topic,
// then a thing being criticised, then a person anywhere, then block.

const ALWAYS = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'kike', 'spic',
  'chink', 'coon', 'wetback', 'paki', 'gook', 'fuck', 'shit', 'bitch',
  'bastard', 'asshole', 'dick', 'cock', 'prick', 'pussy', 'cunt', 'whore',
  'slut', 'wanker', 'twat', 'sharmuta', 'sharmoot', 'manyak', 'manyook', 'ars',
  'شرموط', 'قحبه', 'عاهره', 'منيوك', 'خول', 'لوطي', 'كسم', 'كسمك', 'طيز',
  'خرا', 'معرص', 'يلعن', 'انعل',
];

// Explicit sexual words: abuse in every sentence, including one about
// studying. Matched EXACTLY — no clitic prefixes — because they are two and
// three letters long and would otherwise hit "بكس" (box), "كسب" (earn),
// "زبدة" (butter), "الزبون", "كساء" and "نيكولا". Every spelling anyone
// writes is listed instead.
const ALWAYS_EXACT = [
  'كس', 'الكس', 'وكس', 'كسك', 'كسه', 'كسها', 'كسهم', 'كسختك',
  'زب', 'الزب', 'وزب', 'زبك', 'زبه', 'زبر', 'الزبر', 'زبري',
  'نيك', 'النيك', 'ونيك', 'ينيك', 'بينيك', 'تنيك', 'متناك',
  'نياكه', 'منيوكه', 'عرص', 'العرص',
  'kus', 'kess', 'kos', 'teez', 'tiz', 'neek', 'nayek', 'nik',
];

const CONTEXTUAL = [
  'ass', 'idiot', 'stupid', 'dumb', 'moron', 'loser', 'trash', 'filthy',
  'donkey', 'pig', 'dog', 'monkey', 'swine',
  'kelev', 'kelef', 'kalb', 'kelb', 'hmar', 'himar', 'jahsh', 'khanzeer',
  // kus/kess/teez/tiz live in ALWAYS_EXACT now — context must not excuse them.
  'حمار', 'حمير', 'جحش', 'كلب', 'كلاب', 'خنزير', 'خنازير', 'قرد', 'مونكي',
  'وسخ', 'قذر', 'نجس', 'زباله', 'غبي', 'تافه', 'حقير', 'فاشل', 'كيليف',
];

const COMPARATIVES = [
  'احمر من', 'اغبى من', 'اغبا من', 'احقر من', 'اوسخ من', 'اتفه من',
  'اجحش من', 'اكلب من', 'انجس من', 'اقذر من', 'زي الحمار', 'متل الحمار',
  'زي الكلب', 'متل الكلب', 'اكبر حمار', 'اكبر غبي',
  'than a donkey', 'than a pig', 'than a dog', 'than an idiot',
  'bigger idiot', 'biggest idiot', 'bigger donkey', 'more of an idiot',
];

const TARGETING = ['يا', 'انت', 'انتي', 'انتو', 'هاد', 'هذا', 'شكلك', 'ابن',
  'امك', 'ابوك', 'you', 'your', 'youre', 'ur', 'u'];
const TARGET_PHRASES = ['what a', 'such a', 'is a', 'are a', 'like a'];
const PEOPLE = ['الدكتور', 'دكتور', 'استاذ', 'مدرس', 'المعلم', 'الطالب', 'مدير',
  'المشرف', 'المحاضر', 'doctor', 'dr', 'professor', 'prof', 'teacher',
  'lecturer', 'instructor', 'student', 'he', 'she', 'they', 'him', 'her', 'them'];
// Govern what follows them, so they excuse a word that comes after.
const GOVERNORS = ['عن', 'حول', 'درسنا', 'ندرس', 'يدرس', 'يشرح', 'شرح', 'اوضح',
  'تحدث', 'بحث', 'قرأت', 'يتناول', 'بحكي', 'حكى',
  'about', 'on', 'studied', 'study', 'studying', 'explained', 'talked',
  'covers', 'read', 'discussed'];
const TOPICAL = GOVERNORS.concat(['دراسه', 'مساق', 'محاضره', 'حيوان', 'حيوانات',
  'فصيله', 'مزرعه', 'حديقه', 'عندي', 'عندنا', 'ربيت', 'اشتريت', 'صوره', 'فيلم',
  'كتاب', 'الجيران', 'البيت', 'احياء', 'الاحياء', 'علم', 'تجارب', 'مدربه',
  'تربيه', 'سلوك', 'انواع', 'course', 'lecture', 'chapter', 'animal', 'animals',
  'species', 'mammal', 'farm', 'zoo', 'biology', 'my', 'bought', 'adopted',
  'photo', 'picture', 'movie', 'book', 'neighbour', 'neighbor']);
// A thing can be called rubbish; a person cannot.
const THINGS = ['المساق', 'مساق', 'المحاضره', 'الامتحان', 'امتحان', 'النظام',
  'التطبيق', 'الموقع', 'الجدول', 'الخطه', 'المشروع', 'الكتاب', 'الواجب',
  'التسجيل', 'الماده', 'الفصل', 'الترم', 'course', 'lecture', 'exam', 'system',
  'app', 'website', 'schedule', 'plan', 'project', 'book', 'assignment',
  'homework', 'lab', 'registration', 'semester', 'term'];

const AR_PREFIX = '(?:[\u0648\u0641\u0628\u0643\u0644]|\u0627\u0644|\u064a\u0627|\u0647\u0627|\u0647\u0627\u0644|\u0639)*';
const AR_POSS = '(?:\u0643|\u0643\u0645|\u0647\u0627|\u0647\u0645|\u064a|\u0646\u0627)*';
const AR_FORMS = '(?:\u0647|\u0627\u062a|\u064a\u0646)?';
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i' };
const SEP = "[\\s._\\-*'\"`~^()\\[\\]{}/\\\\]";

function normalize(text) {
  let s = String(text);
  try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
  return s.toLowerCase()
    .replace(/[\u064b-\u065f\u0640\u200b-\u200f]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0649\u06cc]/g, '\u064a')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064a')
    .replace(/\u06a9/g, '\u0643')
    .replace(/[013457|@$!]/g, (ch) => LEET[ch] || ch);
}

// Elongation is absorbed by the pattern, never by collapsing the text:
// collapsing turns "ass" into "as" and rejects every English sentence that
// contains the word "as".
const elongate = (w) => [...w].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+').join('');
const PADDED_TOKEN = new RegExp('^\\p{L}(?:' + SEP + '+\\p{L})+$', 'u');
const SEP_RE = new RegExp(SEP, 'gu');

function depad(s) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length >= 3) out.push(run.join('')); else out.push(...run); run = []; };
  for (const w of s.split(/\s+/)) {
    if (!w) continue;
    if (PADDED_TOKEN.test(w)) { flush(); out.push(w.replace(SEP_RE, '')); continue; }
    if ([...w].length === 1) { run.push(w); continue; }
    flush();
    out.push(w);
  }
  flush();
  return out.join(' ');
}

function pattern(raw) {
  const w = normalize(raw);
  const open = '(?:^|[^\\p{L}\\p{N}])';
  const close = '(?:$|[^\\p{L}\\p{N}])';
  const arabic = /[\u0600-\u06ff]/.test(w);
  const src = arabic
    ? open + AR_PREFIX + elongate(w) + (w.length >= 4 ? AR_POSS + AR_FORMS : AR_POSS) + close
    : open + elongate(w) + '(?:s|es|ed|ing)?' + close;
  return { raw, re: new RegExp(src, 'u') };
}

function exactPattern(raw) {
  const w = normalize(raw);
  return { raw, re: new RegExp('(?:^|[^\\p{L}\\p{N}])' + elongate(w) + '(?:$|[^\\p{L}\\p{N}])', 'u') };
}

const P_ALWAYS = ALWAYS.map(pattern).concat(ALWAYS_EXACT.map(exactPattern));
const P_CONTEXT = CONTEXTUAL.map(pattern);
const P_TARGET = TARGETING.map(pattern);
const P_PEOPLE = PEOPLE.map(pattern);
const P_TOPICAL = TOPICAL.map(pattern);
const P_GOVERN = GOVERNORS.map(pattern);
const P_THINGS = THINGS.map(pattern);
const N_COMPARATIVES = COMPARATIVES.map(normalize);
const CLAUSE_SPLIT = /[.!?،؛,;\n]+|\s(?:بس|لكن|ولكن|though|but|however)\s/u;

const any = (list, hay) => list.some((p) => p.re.test(hay));

function firstBadWord(text) {
  const hay = normalize(text);
  const variants = [hay, depad(hay), hay.replace(SEP_RE, '')];

  for (const p of P_ALWAYS) {
    if (variants.some((v) => v && p.re.test(v))) return p.raw;
  }
  for (const c of N_COMPARATIVES) {
    if (hay.includes(c) && !(any(P_TOPICAL, hay) && !any(P_PEOPLE, hay))) return c;
  }

  // A person right beside the word, with nothing governing it from in front.
  const WINDOW = 2;
  for (const v of variants) {
    const toks = v.split(/\s+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      const hit = P_CONTEXT.find((p) => p.re.test(' ' + toks[i] + ' '));
      if (!hit) continue;
      const before = toks.slice(Math.max(0, i - WINDOW), i).join(' ');
      if (any(P_GOVERN, before)) continue;
      const near = toks.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join(' ');
      if (any(P_TARGET, near) || any(P_PEOPLE, near)) return hit.raw;
    }
  }

  // Clause by clause, so a topical half cannot vouch for an abusive half.
  const clauses = [];
  for (const v of variants) {
    for (const c of v.split(CLAUSE_SPLIT).map((x) => x.trim()).filter(Boolean)) {
      if (!clauses.includes(c)) clauses.push(c);
    }
  }
  let unclear = '';
  for (const cl of clauses) {
    const hit = P_CONTEXT.find((p) => p.re.test(cl));
    if (!hit) continue;
    if (any(P_TARGET, cl) || TARGET_PHRASES.some((ph) => cl.includes(ph))) return hit.raw;
    if (any(P_TOPICAL, cl)) continue;
    if (any(P_PEOPLE, cl)) return hit.raw;
    if (any(P_THINGS, cl)) continue;
    unclear = hit.raw;
  }
  return unclear;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
