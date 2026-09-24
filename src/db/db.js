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

// ---------- weekly_summary_messages ----------
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
