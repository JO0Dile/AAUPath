// ---------------------------------------------------------------------------
// Plan collector — a tiny Cloudflare Worker that receives plans the app sends
// and commits each one into data/collected/<id>.json in your GitHub repo.
//
// The app (plan.html) POSTs plan STRUCTURE only — never any personal data.
// This Worker holds the GitHub write token PRIVATELY (as an encrypted secret),
// which is the whole reason it exists: a static GitHub Pages site can't write
// to the repo, and the token must never sit in public front-end code.
//
// Setup (full walkthrough in COLLECTING.md):
//   1. Paste this whole file into a new Cloudflare Worker and Deploy.
//   2. Add these Variables/Secrets to the Worker:
//        GITHUB_TOKEN   (Secret)  fine-grained token, Contents: Read+Write, this repo only
//        REPO_OWNER               e.g. JO0Dile
//        REPO_NAME                e.g. AAUPath
//        REPO_BRANCH              e.g. main
//        COLLECT_SECRET (Secret)  a word you make up; match APP_COLLECT_SECRET in plan.html
//   3. Put the Worker's URL in APP_COLLECT_URL in plan.html.
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Collect-Secret',
      'Access-Control-Max-Age': '86400',
    };

    // Browser preflight for the cross-origin POST.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    // Parse first so the secret can come from either the header (the app's
    // default 'cloudflare' mode) or the body (its 'appsscript' mode, which
    // can't send custom headers). request.json() parses the body regardless of
    // content-type, so a text/plain JSON body works too.
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'invalid json' }, 400, cors); }

    // Optional shared secret so random traffic can't spam your repo.
    if (env.COLLECT_SECRET) {
      const got = request.headers.get('X-Collect-Secret') || (body && body.secret) || '';
      if (got !== env.COLLECT_SECRET) return json({ error: 'forbidden' }, 403, cors);
    }

    // Re-slugify the id server-side — never trust the path to client input.
    const id = String(body.id || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
    if (!id) return json({ error: 'missing or invalid id' }, 400, cors);
    if (!body.plan || typeof body.plan !== 'object') return json({ error: 'missing plan' }, 400, cors);

    // A generous ceiling so nobody can commit a giant blob through the app.
    const rawPlan = JSON.stringify(body.plan);
    if (rawPlan.length > 200000) return json({ error: 'plan too large' }, 413, cors);

    const record = {
      id,
      plan: body.plan,
      appVersion: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 20) : '',
      submittedAt: typeof body.submittedAt === 'string' ? body.submittedAt.slice(0, 40) : '',
      collectedAt: new Date().toISOString(),
    };

    const owner = env.REPO_OWNER;
    const repo = env.REPO_NAME;
    const branch = env.REPO_BRANCH || 'main';
    if (!owner || !repo || !env.GITHUB_TOKEN) {
      return json({ error: 'collector not configured (owner/repo/token)' }, 500, cors);
    }

    const path = `data/collected/${id}.json`;
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const ghHeaders = {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'plan-collector',
    };

    // If the file already exists we need its blob sha to update it in place
    // (the same student refining their plan overwrites, never duplicates).
    let sha;
    const existing = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
    if (existing.status === 200) {
      try { sha = (await existing.json()).sha; } catch { /* treat as new file */ }
    }

    const put = await fetch(api, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `collect: ${id}`,
        content: base64Utf8(JSON.stringify(record, null, 2) + '\n'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!put.ok) {
      const detail = (await put.text()).slice(0, 300);
      return json({ error: 'github write failed', status: put.status, detail }, 502, cors);
    }
    return json({ ok: true, id }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// UTF-8-safe base64 (btoa alone breaks on Arabic and emoji). The GitHub
// contents API wants base64-encoded file content.
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
