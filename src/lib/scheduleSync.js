import { ChannelType } from 'discord.js';
import { getWeekStartKey } from './weekUtils.js';
import { parseThreadTitle } from './titleParser.js';
import { buildScheduleEmbed } from './embedBuilder.js';
import {
  getWeeklySummaryMessage,
  upsertWeeklySummaryMessage,
  listWeeklySummaryMessages,
  deleteWeeklySummaryMessage,
} from '../db/db.js';

/**
 * Rebuilds every affected weekly summary message for one boss, by re-reading
 * all threads currently in its signup forum channel. Recomputing from
 * scratch (rather than tracking incremental diffs) keeps this correct even
 * when a captain edits a title's date/time, which can move a thread from
 * one week's summary to another.
 */
export async function syncBossSchedule(client, bossConfig) {
  const { guild_id, boss_name, signup_channel_id, schedule_channel_id, emoji, color } = bossConfig;

  const forumChannel = await client.channels.fetch(signup_channel_id).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    console.warn(`[${boss_name}] signup_channel_id ${signup_channel_id} is not a forum channel, skipping.`);
    return;
  }

  const [active, archived] = await Promise.all([
    forumChannel.threads.fetchActive().catch(() => ({ threads: new Map() })),
    forumChannel.threads.fetchArchived().catch(() => ({ threads: new Map() })),
  ]);
  const allThreads = [...active.threads.values(), ...archived.threads.values()];

  const now = new Date();
  const weekGroups = new Map(); // weekStartKey -> entries[]
  const currentWeekKey = getWeekStartKey(now);
  weekGroups.set(currentWeekKey, []); // always render the current week, even if empty

  for (const thread of allThreads) {
    const parsed = parseThreadTitle(thread.name, now);
    if (!parsed) continue; // title doesn't match the format — ignore silently
    const weekKey = getWeekStartKey(parsed.date);
    if (!weekGroups.has(weekKey)) weekGroups.set(weekKey, []);
    weekGroups.get(weekKey).push({ ...parsed, threadId: thread.id });
  }

  const scheduleChannel = await client.channels.fetch(schedule_channel_id).catch(() => null);
  if (!scheduleChannel) {
    console.warn(`[${boss_name}] schedule_channel_id ${schedule_channel_id} not found, skipping.`);
    return;
  }

  // A week that previously had a tracked summary message but no longer has
  // any threads (e.g. its last thread got deleted, or a captain edited a
  // title's date so the thread moved to a different week) also needs to be
  // revisited here — otherwise that message is never touched again and goes
  // stale (still pointing at a thread that no longer exists).
  const existingWeeks = listWeeklySummaryMessages(guild_id, boss_name);
  for (const row of existingWeeks) {
    if (!weekGroups.has(row.week_start_date)) {
      weekGroups.set(row.week_start_date, []);
    }
  }

  for (const [weekKey, entries] of weekGroups) {
    const existing = getWeeklySummaryMessage(guild_id, boss_name, weekKey);

    // Non-current week with nothing left to show — clean up instead of
    // leaving a stale message behind. The current week is exempt: it
    // always shows something, even the "no signups" placeholder text.
    if (entries.length === 0 && weekKey !== currentWeekKey) {
      if (existing) {
        const msg = await scheduleChannel.messages.fetch(existing.message_id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
        deleteWeeklySummaryMessage(guild_id, boss_name, weekKey);
      }
      continue;
    }

    const { empty, embed, content } = buildScheduleEmbed({
      bossName: boss_name,
      emoji,
      color,
      weekStartKey: weekKey,
      entries,
      now,
    });
    const payload = empty ? { content, embeds: [] } : { content: null, embeds: [embed] };

    if (existing) {
      const msg = await scheduleChannel.messages.fetch(existing.message_id).catch(() => null);
      if (msg) {
        await msg.edit(payload);
        continue;
      }
      // stored message was deleted out-of-band — fall through and re-send
    }

    const sent = await scheduleChannel.send(payload);
    upsertWeeklySummaryMessage({
      guildId: guild_id,
      bossName: boss_name,
      weekStartDate: weekKey,
      channelId: schedule_channel_id,
      messageId: sent.id,
    });
  }
}
