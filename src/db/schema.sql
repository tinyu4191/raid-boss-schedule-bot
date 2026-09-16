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
