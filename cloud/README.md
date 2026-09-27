# Cloud Sync

Sign in with an email and password, and a student's selected plan, progress,
grades, and any custom-built plans follow them to a new phone or browser.

**It is optional.** With no Worker deployed, the app works exactly as it
always has — everything stays in the browser's own storage, and the "Cloud
Sync" section in Settings just says it isn't configured.

---

## How it works

```
Sign up / sign in  →  this Worker  →  D1 `users` row + a session token
Sync push / pull    →  this Worker  →  D1 `sync_state` row (one JSON blob per user)
```

This is the **only** Worker in this project backed by a real database.
`admin/`, `ai/`, and `collector/` are all stateless — GitHub or nothing is
their datastore. Real multi-device accounts need somewhere to keep a
password hash and a synced blob that isn't any one device's own storage, so
this Worker uses [Cloudflare D1](https://developers.cloudflare.com/d1/) —
free, serverless SQLite, on the same platform as the rest of this project's
infrastructure.

The synced blob is exactly the shape `AAUP_STORAGE` already keeps in
`localStorage` — selected plan, progress checkmarks, grades, custom plans —
just mirrored under one account instead of one device.

---

## Setup (once)

### 1. Create the database

```bash
npx wrangler d1 create studyplan-cloud
```

This prints a `database_id` — keep it, the Worker's D1 binding needs it.

### 2. Apply the schema

```bash
npx wrangler d1 execute studyplan-cloud --remote --file=cloud/schema.sql
```

Two tables: `users` (email + password hash, nothing else) and `sync_state`
(one JSON blob per user). See the comments in `schema.sql` for why they're
split.

### 3. Deploy the Worker

Create a Cloudflare Worker named `studyplan-cloud`, paste in
[`cloudflare-worker.js`](cloudflare-worker.js), Deploy. Then:

- **Settings → Bindings → D1 Database** — bind it as `DB`, pointing at the
  database from step 1.
- **Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `SESSION_SECRET` | **Secret** | any long random string — generate one the same way as admin's (`python3 tools/hash-admin-password.py` prints one, or use the keygen page). **Do not reuse admin's `SESSION_SECRET`.** They sign different kinds of tokens; sharing the value means a leak of one lets someone forge the other. |
| `ALLOWED_ORIGIN` | Variable | `https://jo0dile.github.io` — same format as the admin Worker's; comma-separate to allow more than one. |

### 4. Point the app at it

`web/js/01-catalogue.js` already contains:

```js
window.APP_CLOUD_URL = 'https://studyplan-cloud.pmhtrfalab999.workers.dev';
```

Change it only if you named the Worker something else. Leave it `''` to
keep Cloud Sync off entirely.

### 5. Check it

Open `<worker-url>/api/health` — `{"ok":true}` means the address is right.
Then try signing up for a real account in the app's Settings → Cloud Sync.

---

## What is deliberately NOT in this v1

**Password reset by email.** Still not here: it needs an email provider
(e.g. Resend) and a domain to send from. Instead there are three ways back
into an account that need neither:

- **Recovery code.** Shown once at sign-up (and re-issued any time from a
  signed-in device). "Forgot password?" on the sign-in form takes the email
  or username, the code, and a new password. Only an HMAC of the code is
  stored; using it spends it and shows a new one.
- **A device that is still signed in** can set a new password without the
  old one (Change password → "Forgot your current password?"). Every other
  device is signed out.
- **The maintainer** can find the account in the Developer panel's "Student
  accounts" section and give it a temporary password. This needs the
  Worker's `ADMIN_SECRET`; without it those routes answer 403.

## Sign in with Google (optional)

1. In Google Cloud Console, create a project, then **APIs & Services →
   OAuth consent screen**: External, app name "AAUPath", your email as
   support contact, and only the default scopes (email, profile, openid).
   Press **Publish app** so it is "In production". With only those basic
   scopes Google does not require a review, and students do not see the
   "Google hasn't verified this app" screen. That screen appears when an app
   asks for sensitive scopes, or is still in Testing mode for someone who is
   not a listed test user.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under *Authorized JavaScript origins* add `https://jo0dile.github.io`
   (and any other address the app is served from).
3. Copy the client id (`….apps.googleusercontent.com`) into
   `APP_GOOGLE_CLIENT_ID` in `web/js/01-catalogue.js` **and** into this
   Worker as the `GOOGLE_CLIENT_ID` variable. The button appears only when
   the app has it.

The Worker checks Google's ID token with Google's `tokeninfo` endpoint,
requires the token to be issued for this client id with a verified email,
and links it to the account with the same email, or makes a new one.

**Rate limiting beyond the login delay.** Every login attempt costs a fixed
400ms (same trick as the admin Worker), which blunts scripted guessing but
is not a real per-IP limiter — that needs Cloudflare KV or Turnstile, not
added here to keep the v1 scope to what a database-backed account system
strictly needs.

---

## Security model

Same approach as `admin/cloudflare-worker.js`, adapted for many users
instead of one:

- Passwords are never stored — only a PBKDF2-SHA256 hash (600,000
  iterations, random salt per user).
- A wrong password and a nonexistent email return the **identical** error,
  in the **same** amount of time (a dummy hash is verified against even
  when no such user exists) — so a login attempt's timing can't be used to
  discover which emails are registered.
- Sign-in returns an HMAC-signed session token (30-day expiry) carrying the
  user's id and a `token_version`. Every route re-checks the token against
  the live database row on every request — a token isn't just verified
  cryptographically, its version has to still match.
- **Changing the password bumps `token_version`**, which invalidates every
  *other* signed-in device's token immediately, with no server-side session
  store to maintain. The device making the change gets a fresh token in the
  same response so it isn't logged out by its own action.
- A sync push carries the client's last-known `updatedAt`. If the row moved
  since (synced from a second device first), the push is refused with a 409
  and the server's current copy attached — the same "this changed since you
  opened it" pattern the admin catalogue editor already uses — rather than
  one device silently overwriting another's progress.
- Every reply is `Cache-Control: no-store`; every payload is size-capped
  before it is even parsed.

## Limits

| Thing | Limit | Why |
|---|---|---|
| Password | 8–200 characters | Long enough to matter, short enough to type on a phone |
| Synced data | 2 MB | One student's whole local state, generously |
| Session | 30 days | "Stay signed in," not a work session — unlike the 8-hour admin session |

All of it fits inside Cloudflare's free tier (D1's free tier is 5 GB and 5
million reads/day — several orders of magnitude past what a study-plan
app's sync traffic will ever reach).
