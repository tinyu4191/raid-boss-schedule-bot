import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '..', 'data.sqlite');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// ---------- schedule_messages (keyed by signup forum channel ID) ----------

export function getScheduleMessage(signupChannelId, weekStartDate) {
  return db
    .prepare(`SELECT * FROM schedule_messages WHERE signup_channel_id = ? AND week_start_date = ?`)
    .get(signupChannelId, weekStartDate);
}

export function listScheduleMessages(signupChannelId) {
  return db
    .prepare(`SELECT * FROM schedule_messages WHERE signup_channel_id = ? ORDER BY week_start_date`)
    .all(signupChannelId);
}

export function deleteScheduleMessage(signupChannelId, weekStartDate) {
  db.prepare(`DELETE FROM schedule_messages WHERE signup_channel_id = ? AND week_start_date = ?`).run(
    signupChannelId,
    weekStartDate
  );
}

export function upsertScheduleMessage({ signupChannelId, guildId, bossName, weekStartDate, channelId, messageId }) {
  db.prepare(`
    INSERT INTO schedule_messages (signup_channel_id, week_start_date, guild_id, boss_name, channel_id, message_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(signup_channel_id, week_start_date) DO UPDATE SET
      guild_id = excluded.guild_id,
      boss_name = excluded.boss_name,
      channel_id = excluded.channel_id,
      message_id = excluded.message_id
  `).run(signupChannelId, weekStartDate, guildId, bossName, channelId, messageId);
}

const MIGRATION_KEY = 'schedule_messages_keyed_by_signup_channel';

/**
 * One-time copy of the legacy name-keyed rows (weekly_summary_messages)
 * into schedule_messages. A legacy row is carried over only when its
 * (guild_id, boss_name) matches a boss that is configured RIGHT NOW — that
 * is the same matching the old code used, so every boss that was being
 * edited in place keeps being edited in place. Rows whose name no longer
 * matches anything (e.g. a boss that was renamed or removed from .env) are
 * left behind in the legacy table: they point at orphaned messages the bot
 * can no longer know how to treat. Idempotent and safe to call on every
 * start; it records completion in `meta` so deleted rows never resurrect.
 * @returns {{ alreadyDone: boolean, migrated: number, leftBehind: number }}
 */
export function migrateLegacyScheduleRows(configs) {
  if (db.prepare(`SELECT 1 FROM meta WHERE key = ?`).get(MIGRATION_KEY)) {
    return { alreadyDone: true, migrated: 0, leftBehind: 0 };
  }
  if (!configs || configs.length === 0) return { alreadyDone: false, migrated: 0, leftBehind: 0 }; // never mark done on an empty config

  const legacy = db
    .prepare(`SELECT guild_id, boss_name, week_start_date, channel_id, message_id FROM weekly_summary_messages`)
    .all();
  let migrated = 0;
  let leftBehind = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO schedule_messages (signup_channel_id, week_start_date, guild_id, boss_name, channel_id, message_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const row of legacy) {
      const cfg = configs.find((c) => c.guild_id === row.guild_id && c.boss_name === row.boss_name);
      if (!cfg) {
        leftBehind++;
        continue;
      }
      migrated += insert.run(cfg.signup_channel_id, row.week_start_date, row.guild_id, row.boss_name, row.channel_id, row.message_id).changes;
    }
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(MIGRATION_KEY, new Date().toISOString());
  })();
  return { alreadyDone: false, migrated, leftBehind };
}

/** Legacy (name-keyed) rows — used only by the migration and the repair/diagnostic scripts. */
export function listLegacyScheduleRows() {
  return db
    .prepare(`SELECT guild_id, boss_name, week_start_date, channel_id, message_id FROM weekly_summary_messages ORDER BY guild_id, boss_name, week_start_date`)
    .all();
}

export function deleteLegacyScheduleRow(guildId, bossName, weekStartDate) {
  db.prepare(`DELETE FROM weekly_summary_messages WHERE guild_id = ? AND boss_name = ? AND week_start_date = ?`).run(
    guildId,
    bossName,
    weekStartDate
  );
}

// ---------- weekly_summary_messages (legacy, name-keyed; see schedule_messages above) ----------
// Boss definitions themselves come from .env (src/config/bosses.js), not
// this database — only the "which message = which week" mapping lives here.

export function getWeeklySummaryMessage(guildId, bossName, weekStartDate) {
  return db.prepare(`
    SELECT * FROM weekly_summary_messages
    WHERE guild_id = ? AND boss_name = ? AND week_start_date = ?
  `).get(guildId, bossName, weekStartDate);
}

export function listWeeklySummaryMessages(guildId, bossName) {
  return db.prepare(`
    SELECT * FROM weekly_summary_messages
    WHERE guild_id = ? AND boss_name = ?
  `).all(guildId, bossName);
}

export function deleteWeeklySummaryMessage(guildId, bossName, weekStartDate) {
  db.prepare(`
    DELETE FROM weekly_summary_messages
    WHERE guild_id = ? AND boss_name = ? AND week_start_date = ?
  `).run(guildId, bossName, weekStartDate);
}

export function upsertWeeklySummaryMessage({ guildId, bossName, weekStartDate, channelId, messageId }) {
  db.prepare(`
    INSERT INTO weekly_summary_messages (guild_id, boss_name, week_start_date, channel_id, message_id)
    VALUES (@guildId, @bossName, @weekStartDate, @channelId, @messageId)
    ON CONFLICT(guild_id, boss_name, week_start_date) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id
  `).run({ guildId, bossName, weekStartDate, channelId, messageId });
}

// ---------- reminded_threads ----------

export function hasReminderBeenSent(threadId) {
  const row = db.prepare(`SELECT 1 FROM reminded_threads WHERE thread_id = ?`).get(threadId);
  return !!row;
}

export function markReminderSent(guildId, bossName, threadId) {
  db.prepare(`
    INSERT INTO reminded_threads (guild_id, boss_name, thread_id, reminded_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id) DO NOTHING
  `).run(guildId, bossName, threadId, new Date().toISOString());
}

// ---------- title_fix_notices ----------

export function hasTitleFixNoticeBeenSent(threadId) {
  const row = db.prepare(`SELECT 1 FROM title_fix_notices WHERE thread_id = ?`).get(threadId);
  return !!row;
}

export function markTitleFixNoticeSent(threadId) {
  db.prepare(`
    INSERT INTO title_fix_notices (thread_id, notified_at)
    VALUES (?, ?)
    ON CONFLICT(thread_id) DO NOTHING
  `).run(threadId, new Date().toISOString());
}

// ---------- day_before_notices ----------

export function hasDayBeforeNoticeBeenSent(threadId) {
  const row = db.prepare(`SELECT 1 FROM day_before_notices WHERE thread_id = ?`).get(threadId);
  return !!row;
}

export function markDayBeforeNoticeSent(guildId, bossName, threadId) {
  db.prepare(`
    INSERT INTO day_before_notices (guild_id, boss_name, thread_id, notified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id) DO NOTHING
  `).run(guildId, bossName, threadId, new Date().toISOString());
}

// ---------- weekly_reports_sent ----------

export function hasWeeklyReportBeenSent(channelId, reportWeekKey) {
  const row = db
    .prepare(`SELECT 1 FROM weekly_reports_sent WHERE channel_id = ? AND report_week_key = ?`)
    .get(channelId, reportWeekKey);
  return !!row;
}

export function markWeeklyReportSent(guildId, channelId, reportWeekKey) {
  db.prepare(`
    INSERT INTO weekly_reports_sent (guild_id, channel_id, report_week_key, sent_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id, report_week_key) DO NOTHING
  `).run(guildId, channelId, reportWeekKey, new Date().toISOString());
}
