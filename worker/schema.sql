-- Harmonia Android closed-beta signups.
-- Apply:  npx wrangler d1 execute harmonia-beta --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS beta_signups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT    NOT NULL UNIQUE,   -- the Google account email for Play access
  device           TEXT,                      -- optional: phone model
  android_version  TEXT,                      -- optional: Android version
  user_agent       TEXT,                      -- captured server-side for debugging
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  added_to_console INTEGER NOT NULL DEFAULT 0 -- 0 = not yet added to Play Console tester list
);

-- Fast lookup of the batch you still need to add to Play Console.
CREATE INDEX IF NOT EXISTS idx_beta_pending ON beta_signups (added_to_console);
