-- Boss definitions (name, channel pair, emoji, color) live in .env now —
-- see src/config/bosses.js. This table only tracks which Discord message
-- represents which (guild, boss, week) so re-syncs edit in place.
CREATE TABLE IF NOT EXISTS weekly_summary_messages (
  guild_id        TEXT NOT NULL,
  boss_name       TEXT NOT NULL,
  week_start_date TEXT NOT NULL, -- YYYY-MM-DD, the Tuesday of that week (Asia/Taipei)
  channel_id      TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  PRIMARY KEY (guild_id, boss_name, week_start_date)
);

-- Tracks which signup threads have already had their "30 minutes before"
-- reminder sent, so the periodic scan never double-sends. One row per
-- thread — a thread only ever needs one reminder in its lifetime.
CREATE TABLE IF NOT EXISTS reminded_threads (
  guild_id    TEXT NOT NULL,
  boss_name   TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  reminded_at TEXT NOT NULL, -- ISO timestamp, for debugging only
  PRIMARY KEY (thread_id)
);

-- Tracks which threads have already gotten a "please fix your title
-- manually" notice (see titleNormalizer.js), so a captain who ignores it
-- isn't @-mentioned again on every subsequent edit attempt.
CREATE TABLE IF NOT EXISTS title_fix_notices (
  thread_id   TEXT PRIMARY KEY,
  notified_at TEXT NOT NULL
);

-- Tracks which threads have already gotten the "24 hours before raid time,
-- still missing people" @everyone nudge (see dayBeforeNotice.js), so it
-- only ever fires once per thread even if the team is still missing
-- people the whole way up to raid time.
CREATE TABLE IF NOT EXISTS day_before_notices (
  guild_id    TEXT NOT NULL,
  boss_name   TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  PRIMARY KEY (thread_id)
);

-- Tracks which weekly reports (see weeklyReport.js) have already been
-- posted, so the every-minute scan sends each one exactly once. Keyed by
-- the destination channel (several bosses can share one report channel
-- and are combined into a single report) and the week being reported.
CREATE TABLE IF NOT EXISTS weekly_reports_sent (
  guild_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  report_week_key TEXT NOT NULL, -- the Tuesday (YYYY-MM-DD) of the week that was reported on
  sent_at         TEXT NOT NULL,
  PRIMARY KEY (channel_id, report_week_key)
);

-- Which Discord message shows which week's schedule for which boss, keyed
-- by the boss's SIGNUP FORUM CHANNEL ID — an immutable Discord ID. (The old
-- weekly_summary_messages table above was keyed by boss *name*, so merely
-- renaming BOSS_<n>_NAME in .env made the bot think it was a brand-new boss
-- and re-post every week's schedule. That table is kept untouched as a
-- backup/migration source and is no longer written to.)
CREATE TABLE IF NOT EXISTS schedule_messages (
  signup_channel_id TEXT NOT NULL,
  week_start_date   TEXT NOT NULL, -- YYYY-MM-DD, the Tuesday of that week (Asia/Taipei)
  guild_id          TEXT NOT NULL,
  boss_name         TEXT NOT NULL, -- informational label only, never used for lookups
  channel_id        TEXT NOT NULL, -- the schedule channel the message lives in
  message_id        TEXT NOT NULL,
  PRIMARY KEY (signup_channel_id, week_start_date)
);

-- Small key/value table for one-off bookkeeping (e.g. "migration done").
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
