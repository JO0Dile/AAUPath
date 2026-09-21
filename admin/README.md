# Admin Mode

Edit the published catalogue — universities, majors, courses, prerequisites,
logos, icons — from inside the app, without touching a file or running a build.

**It is optional.** With no Worker deployed, Admin Mode still loads, says it has
no API configured, and nothing else about the app changes. Students never see it
either way.

---

## How a change reaches a student

```
Admin dashboard  →  admin Worker  →  commit into data/
                                  →  CI rebuilds web/plans.json
                                  →  GitHub Pages redeploys
                                  →  every student, on their next load
```

There is no database. `data/` remains the single source of truth, so nothing is
duplicated, every edit is a real commit with a message, and a mistake is undone
with `git revert`. The honest cost is latency: a change is live in **about a
minute**, not instantly.

The rebuild step is the `Publish catalogue` workflow. Without it an admin edit
lands in `data/`, `web/plans.json` keeps the old content, and the app keeps
serving the old content — the change looks saved and never appears.

### Icons, logos and emoji — which one shows

Three fields, one mark, tried in this order:

| | Wins over | Use it for |
|---|---|---|
| **Uploaded image** | everything | a real logo or artwork |
| **Built-in icon** | the emoji | a clean themed mark from the picker |
| **Emoji** | — | the last fallback; always works |

You do not have to choose one — fill in as many as you like and the topmost one
wins. Both editors show a live **What students will see** panel with the actual
mark and a line saying which field produced it, so clearing an icon and setting
a logo is never a guess.

### Students who customised a plan are not overwritten

If someone edited their own copy of a plan and you then publish a change to it,
their copy is **not** replaced. They get a dialog listing exactly what changed —
courses added or removed, credit hours, moved semesters, prerequisites — and
choose **Apply changes to my plan** or **Keep my current version**. Declining is
remembered, so the same version never asks twice.

Presentation is treated differently on purpose. Icons, logos, blurbs and
university details are not student-editable, so they refresh silently with no
prompt even on a customised plan.

---

## Setup (once)

### 1. Generate your credentials

**No computer needed — a phone works.** Open:

```
https://jo0dile.github.io/AAUPath/keygen.html
```

Type a password twice (or tap **Suggest a strong one**) and press **Generate**.
It prints `ADMIN_PASSWORD_HASH` and a fresh `SESSION_SECRET`, each with a Copy
button. Copy both, then close the page.

That page does the hashing **in your browser**, using the browser's own crypto.
It contains no network code at all — no fetch, no form action, no third-party
script — so nothing you type there can leave the device. You can prove it: turn
on aeroplane mode, reload, and generate anyway; it still works.

Publishing that page is harmless. PBKDF2 is a public algorithm and the page
holds no secret — it is a calculator. It is deliberately not linked from the app
and not in the service worker's precache list, so no student ever loads it.

**If you do have a computer with Python**, this is the same thing offline:

```bash
python3 tools/hash-admin-password.py
```

Either way the password itself is never stored, never sent, and never written to
a file — only the PBKDF2-SHA256 hash of it. Which means **nobody can recover it
for you**, so keep it somewhere you trust. If you lose it, generate a new hash
and replace the old value in Cloudflare; nothing else has to change.

### 2. Create a GitHub token

GitHub → Settings → Developer settings → **Fine-grained personal access token**

- Repository access: **only this repository**
- Permissions: **Contents → Read and write**

That is the whole scope it needs. It cannot touch any other repo, and it lives
only inside the Worker.

### 3. Deploy the Worker

Create a Cloudflare Worker named `studyplan-admin`, paste in
[`cloudflare-worker.js`](cloudflare-worker.js), Deploy. Then under
**Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `ADMIN_USERNAME` | **Secret** | whatever you want to type |
| `ADMIN_PASSWORD_HASH` | **Secret** | from step 1 |
| `SESSION_SECRET` | **Secret** | from step 1 |
| `GITHUB_TOKEN` | **Secret** | from step 2 |
| `REPO_OWNER` | Variable | `JO0Dile` |
| `REPO_NAME` | Variable | `AAUPath` — the repo's *current* name. It was `MyMenuPack` before the rename; if the Worker still has the old value, fix it in the Cloudflare dashboard, because publishing writes to this repo through the GitHub API. |
| `REPO_BRANCH` | Variable | `main` |
| `ALLOWED_ORIGIN` | Variable | `https://jo0dile.github.io` — an **origin**: scheme and host only, no path, no trailing slash. A full app URL is accepted and trimmed down, but the bare origin is the honest value. Comma-separate to allow more than one. |
| `REQUIRE_CF_ACCESS` | Variable | **Do not add this yet.** Only after step 3b is finished — see the warning there. |

The four marked **Secret** are encrypted by Cloudflare and cannot be read back,
including by you. That is the point. The username is a Secret too — a Variable
is displayed in plain text to anyone who can open the Cloudflare dashboard, and
half a credential is still half a credential.

### 3b. Put Cloudflare Access in front of it (strongly recommended, free)

Zero Trust → Access → Applications → **Self-hosted**, pointing at the Worker's
hostname. Add one policy: *Allow* → *Emails* → your address.

Now Cloudflare authenticates **you** — by email one-time PIN, Google, GitHub,
whatever you pick — before a request ever reaches this code. Then set
`REQUIRE_CF_ACCESS=1` and the Worker returns a flat `404` to anything arriving
without Cloudflare's signed assertion header.

With this on, an attacker who somehow learned your username *and* password still
cannot reach the login form. Free for up to 50 users. **This is the single
biggest thing you can do**, and it takes about three minutes.

> ⚠️ **Set `REQUIRE_CF_ACCESS=1` only after Access is actually working.** The
> Worker returns `404` to anything without Cloudflare's assertion header — and
> if Access is not in front of it, *nothing* sends that header, including you.
> Every route answers `{"error":"not found"}`, sign-in included. The door locks
> with the key inside.
>
> If that happens: delete the `REQUIRE_CF_ACCESS` variable in the Worker's
> settings. Variables apply immediately, so no redeploy is needed. The sign-in
> screen also detects this case by name and tells you the same thing.

### 4. Point the app at it

`web/js/01-catalogue.js` already contains:

```js
window.APP_ADMIN_URL = 'https://studyplan-admin.pmhtrfalab999.workers.dev';
```

Change it only if you named the Worker something else.

### 5. Check it

Open the app with `#admin` on the end of the URL and sign in.

The sign-in screen tells you **nothing** about your credentials before you
authenticate — that is deliberate (see Security below). It does report the two
failures that are otherwise impossible to tell apart:

- *Could not reach the admin API* — the Worker is not answering at that address.
  Open `<worker-url>/api/health` in a tab: `{"ok":true}` means the address is
  right, nothing loading means it is wrong. The panel underneath lets you paste
  a different address and Test it, with no code change.
- *The Worker is reachable but is refusing this site* — `ALLOWED_ORIGIN` does
  not match. The message names the exact value to set.

Once you are in, the Dashboard reports which repo and branch it is writing to,
and warns you there if the GitHub token is missing.

**Whenever you change the Worker's code, redeploy it.** Cloudflare keeps
serving the last deployed version, so a fix in this repo does nothing until it
is pasted in and deployed again.

---

## Getting in

- **`#admin`** on the end of the app URL, or
- **Developer Panel → 🛡 Admin Mode**.

Neither grants anything on its own. The Developer Panel's own password is a
cosmetic Easter-egg gate on a panel that only touches your own browser — it is
**not** related to the admin password and never protected anything real.

---

## What you can change

| Section | Covers |
|---|---|
| **Dashboard** | Counts, which repo and branch, how updates propagate |
| **Universities** | Name, Arabic name, short name, description, website, logo, icon, faculties, publish/unpublish |
| **Majors / Plans** | Grouped by faculty. Name, subtitle, faculty, description, icon, image, degree hours; add and delete |
| **Courses** | Code, name, Arabic name, credit hours, category, year, semester; add and delete |
| **Prerequisites** | Add and remove pairs, with a server-side loop check |
| **Study Plan** | Move courses between years and semesters; add and remove years and summer terms |
| **Assets** | Upload, preview, replace and delete images |
| **Settings** | Session info, how to change the password, how to revoke access |

A major's metadata, courses, prerequisites and semester layout are all one file
(`data/<uni>/majors/<slug>.json`), so those four sections are views of a single
object and one **Save major** writes all of them together. A course move and a
prerequisite change can never land half-applied.

### Adding a whole programme, in order

The dashboard follows the same shape the data has, so there is one path and it
runs downwards:

```
Universities → Edit → Faculties → + Add faculty → Save university
Majors       → pick the faculty → + Add major here → Create → Save major
Study Plan   → years, and which of them have a summer term
Courses      → + Add course, grouped by the term it sits in
Prerequisites→ before → after, checked for loops on the server
```

**A major belongs to a faculty, and the browser groups them that way.** The
add button lives on the faculty it adds to, so a new major starts out in the
right place instead of nowhere.

Anything whose faculty is blank, or points at a faculty that no longer exists,
is collected under **Not in any faculty** and marked. Those majors are real and
saved — but students cannot reach them, and before this they looked exactly
like every other row. The faculty field in the major editor is a list of that
university's actual faculties rather than a slug typed from memory.

Majors, Courses, Prerequisites and Study Plan are all one file, so **Save
major** on any of them writes all four together.

### Icons and logos

Three layers, tried in order, all optional:

1. **Uploaded image** — Assets → upload → paste the path into a logo or icon field.
2. **Built-in icon** — the picker shows the whole set as pictures.
3. **Emoji** — the original fallback, never removed.

Uploads are committed to `web/assets/uploads/` and deploy with the app, so an
uploaded logo still shows when the student is offline.

### Why a save can say "this changed since you opened it"

Save posts the **whole** university or major, not just the field you touched.
That is what makes one Save write metadata, courses, prerequisites and the
semester layout together — but it also means a form rendered from an
out-of-date copy does not merely fail to add something, it reverts everything
saved in between.

That is not hypothetical. Five consecutive saves once walked
`data/aaup/university.json` *backwards* — each one committing a byte-identical
earlier version, undoing a logo and a description that had saved correctly
minutes before. Every request returned `200`. Nothing was in the logs, because
nothing failed.

So each read now hands out the file's version, and each save has to hand it
back. If it no longer matches, the save is refused with that message instead of
being applied. Reload the editor and reapply the edit. Saves are still allowed
when there is nothing to be stale against — creating a major, or an older
dashboard that does not send a version.

Two things make the stale copy far less likely in the first place: every admin
reply is `Cache-Control: no-store` (a browser was free to serve a minutes-old
one before), and every read of GitHub is explicitly uncacheable.

### Deleting

- **Deleting a major** removes the file. Recoverable with `git revert`.
- **Unpublishing a university** sets `"published": false`. Its majors stay in
  `data/`, exactly as authored, and come back when you publish it again — which
  is why the delete button unpublishes rather than deleting a folder of work.

---

## Security

### What is guaranteed

**Your password cannot be discovered from anything published.** It is not in the
repo, not in the app, not in `plans.json`, not in any commit, and it is never
sent anywhere. Only a PBKDF2-SHA256 hash of it exists (600,000 iterations, random
salt), and only inside Cloudflare's encrypted secret store, which does not let
even you read it back. There is no path from the public site to the password.

The same is true of the username, once it is stored as a Secret.

- Sign-in returns an **HMAC-signed token** with an 8-hour expiry, kept in
  `sessionStorage` so closing the tab ends the session. There is no session store
  to steal, and forging a token requires `SESSION_SECRET`.
- **Every** request that changes anything re-verifies that token before the route
  is even chosen. Nothing in the dashboard authorizes itself.
- The sign-in screen is **deliberately uninformative**. `/api/health` answers
  `{"ok":true}` and nothing else — it does not confirm an admin exists, does not
  name the repo, does not say whether credentials are configured. A failed login
  says only *invalid username or password*, never which one was wrong, and takes
  the same 400 ms either way.
- Every payload is **re-validated on the server**: slug shapes, credit-hour
  ranges, unknown categories, prerequisites pointing at courses that do not
  exist, and prerequisite cycles.
- **SVG uploads carrying `<script>` or event handlers are rejected**, not
  sanitized — a half-cleaned SVG served from the app's own origin would be a
  stored XSS against every user.
- The GitHub token never reaches a browser.

### What cannot be hidden, and why that is fine

**The existence of an admin page cannot be kept secret.** This is a static site:
every visitor downloads `web/js/48-admin.js`, and anyone who reads it learns that
`#admin` opens a sign-in form. Minifying it, renaming the route, or removing it
from the docs would not change that — the file still ships to every device.

That is not the weakness it looks like. A login form is *supposed* to be
public; the door is not the lock. What matters is that knowing where the door is
gets an attacker no closer to opening it:

- the password is not derivable from anything they can download,
- the form does not tell them whether a username is right,
- and with Cloudflare Access on (step 3b), they cannot even reach the form.

Anyone who claims a public web app can hide its admin route is describing
obscurity, not security. This design does not rely on it.

### Your part

The one place this can still go wrong is not in the code:

- **Use a long, unique password.** Nothing here protects a password that is also
  used somewhere that gets breached.
- **Turn on Cloudflare Access.** It is free and it is the strongest control
  available to this project.
- **Never paste the password into a chat, an issue, a commit, or a screenshot.**
  Only `tools/hash-admin-password.py` should ever see it, on your own machine.
- **Keep the Cloudflare account itself secure** — 2FA on. Anyone who can log in
  there can change the secrets, and no amount of code can prevent that.

**To revoke access immediately** — a lost laptop, a shared password — replace
`SESSION_SECRET` in the Worker. Every signed-in session stops working at once.

---

## Limits

| Thing | Limit | Why |
|---|---|---|
| Uploaded image | 512 KB | A logo, not a photograph |
| Major JSON | 400 KB | Comfortably larger than the biggest real plan |
| Session | 8 hours | Long enough for a working day |
| Propagation | ~1 minute | CI rebuild plus Pages deploy |

All of it fits inside Cloudflare's free tier, and nothing here can start
charging you.

---

## One admin

There is one username and one password, because this is one person's project.
Multiple admins with separate logins would need a user store, which would need a
database, which is the thing this design exists to avoid. If that changes, the
place to add it is `verifyPassword()` and `requireAdmin()` — everything else
already goes through them.
