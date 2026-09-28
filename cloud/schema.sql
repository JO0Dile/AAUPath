-- Cloud Sync — D1 schema.
--
-- Two tables, on purpose. `users` is identity (email + password hash); it
-- almost never changes. `sync_state` is the one JSON blob a signed-in
-- device pushes and pulls — selected plan, progress, grades, custom plans,
-- everything AAUP_STORAGE already keeps in localStorage under an `aaup_`
-- key. Splitting them means a sync push never touches the row a login
-- verifies against, and deleting an account is one cascading delete.
--
-- Apply with:
--   npx wrangler d1 execute studyplan-cloud --remote --file=cloud/schema.sql
-- (drop --remote for a local dev database).
--
-- Already have a database from before `username` existed? Nothing to run:
-- the Worker adds `username` (and the recovery columns below) to an older
-- `users` table by itself on its first request.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  -- Optional friendlier sign-in identifier. NULL, not '', when unset — SQLite
  -- treats every NULL as distinct under a UNIQUE index, so any number of
  -- accounts can go without a username; two accounts could never both set it
  -- to '' under the same constraint.
  username      TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  -- Bumped on every password change. Embedded in every session token, so
  -- changing the password invalidates every OTHER signed-in device's token
  -- at once without needing a server-side session store to revoke from.
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  -- Account recovery (added later; the Worker adds both columns to an older
  -- database by itself on its first request, so nothing needs running):
  -- an HMAC of the student's current recovery code, and their Google
  -- account id once they have used Sign in with Google.
  recovery_hash TEXT,
  google_sub    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub);

CREATE TABLE IF NOT EXISTS sync_state (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
