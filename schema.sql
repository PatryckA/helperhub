-- HelperHub database schema (Cloudflare D1 / SQLite)
-- For the D1 dashboard console use schema-oneline.sql (the console only takes one line).

CREATE TABLE IF NOT EXISTS groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,              -- web address: helperhub.au/<slug>
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT '',          -- school, sport, community, other
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending (email not verified) | active | suspended
  accent        TEXT NOT NULL DEFAULT '#2f7d6d',
  has_logo      INTEGER NOT NULL DEFAULT 0,
  logo_version  INTEGER NOT NULL DEFAULT 0,
  welcome_text  TEXT NOT NULL DEFAULT '',
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  reminder_hours INTEGER NOT NULL DEFAULT 24,
  timezone      TEXT NOT NULL DEFAULT 'Australia/Sydney',
  donation_url  TEXT NOT NULL DEFAULT '',          -- default for new events
  donation_text TEXT NOT NULL DEFAULT '',
  question_label TEXT NOT NULL DEFAULT '',         -- optional extra sign-up question, e.g. "Which team?"
  question_required INTEGER NOT NULL DEFAULT 0,
  email_limit   INTEGER,                           -- per-group daily cap override (owner can raise)
  suspended_reason TEXT NOT NULL DEFAULT '',
  created_ip    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at  TEXT
);

CREATE TABLE IF NOT EXISTS group_logos (
  group_id  INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  mime      TEXT NOT NULL,
  data      TEXT NOT NULL                          -- base64, resized in the browser to max 400px
);

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

-- One-time emailed links (login, verify new group). Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS login_links (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    INTEGER,                              -- set when the link also activates a new group
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  published    INTEGER NOT NULL DEFAULT 0,
  dropoff_date TEXT NOT NULL DEFAULT '',
  dropoff_time TEXT NOT NULL DEFAULT '',
  dropoff_note TEXT NOT NULL DEFAULT '',
  donation_url TEXT NOT NULL DEFAULT '',
  donation_text TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_group ON events(group_id);

CREATE TABLE IF NOT EXISTS slots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'shift',     -- shift | item
  title        TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  date         TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  capacity     INTEGER NOT NULL DEFAULT 1,
  start_utc    TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_slots_event ON slots(event_id);
CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start_utc);

CREATE TABLE IF NOT EXISTS signups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id       INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  mobile        TEXT NOT NULL,
  comments      TEXT NOT NULL DEFAULT '',
  answer        TEXT NOT NULL DEFAULT '',          -- answer to the group's extra question
  item_desc     TEXT NOT NULL DEFAULT '',
  dietary       TEXT NOT NULL DEFAULT '',
  manage_token  TEXT NOT NULL,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signups_slot ON signups(slot_id);
CREATE INDEX IF NOT EXISTS idx_signups_token ON signups(manage_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_unique ON signups(slot_id, email);

CREATE TABLE IF NOT EXISTS email_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER,                              -- NULL for platform emails (login links)
  to_email    TEXT NOT NULL,
  from_name   TEXT NOT NULL DEFAULT '',
  reply_to    TEXT,
  subject     TEXT NOT NULL,
  html        TEXT NOT NULL,
  ics         TEXT,
  priority    INTEGER NOT NULL DEFAULT 1,           -- 0 = send first (login links)
  status      TEXT NOT NULL DEFAULT 'queued',       -- queued | sending | sent | failed | dropped
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_queue(status, priority, id);
CREATE INDEX IF NOT EXISTS idx_email_group_sent ON email_queue(group_id, sent_at);

-- Simple rate limiting (sign-ups, logins, new groups) by key such as "login:1.2.3.4"
CREATE TABLE IF NOT EXISTS rate_hits (
  key  TEXT NOT NULL,
  at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_key ON rate_hits(key, at);
