import { ChannelType } from 'discord.js';
import { getWeekStartKey, shiftWeekKey } from './weekUtils.js';
import { getRaidEndAfterMs } from '../config/settings.js';
import { parseThreadTitle } from './titleParser.js';
import { buildScheduleEmbed } from './embedBuilder.js';
import { resolveBossTag } from './forumTags.js';
import {
  getScheduleMessage,
  upsertScheduleMessage,
  listScheduleMessages,
  deleteScheduleMessage,
} from '../db/db.js';

// Looks up the Discord message a past sync recorded for a week. The
// distinction matters: only "Unknown Message" (10008) means the message
// really is gone and a replacement should be posted. Any other failure
// (missing Read Message History / View Channel, rate limit, Discord
// hiccup) says nothing about whether the message exists, and treating it
// as "deleted" posts a duplicate schedule on every sync.
const UNKNOWN_MESSAGE = 10008;

async function fetchTrackedMessage(scheduleChannel, messageId) {
  try {
    return { msg: await scheduleChannel.messages.fetch(messageId), gone: false, err: null };
  } catch (err) {
    return { msg: null, gone: err?.code === UNKNOWN_MESSAGE, err };
  }
}

function describeFetchError(err) {
  return `${err?.code ?? err?.name ?? 'error'}: ${err?.message ?? err}`;
}

// True when the message already shows exactly what we're about to put in
// it, so the edit (and the extra API call / "edited" churn) can be skipped.
// The footer timestamp is deliberately ignored: it changes every run.
function showsSameContent(msg, payload) {
  const msgEmbeds = msg.embeds ?? [];
  if (payload.embeds.length === 0) {
    return msgEmbeds.length === 0 && (msg.content ?? '') === (payload.content ?? '');
  }
  if (msgEmbeds.length !== 1 || payload.embeds.length !== 1 || (msg.content ?? '') !== '') return false;
  const cur = msgEmbeds[0];
  const next = payload.embeds[0].data ?? payload.embeds[0];
  return cur.title === next.title && cur.description === next.description && (cur.color ?? null) === (next.color ?? null);
}

/**
 * Rebuilds every affected weekly summary message for one boss, by re-reading
 * all threads currently in its signup forum channel. Recomputing from
 * scratch (rather than tracking incremental diffs) keeps this correct even
 * when a captain edits a title's date/time, which can move a thread from
 * one week's summary to another.
 *
 * Messages are tracked by the boss's signup forum channel ID (never its
 * name), so renaming BOSS_<n>_NAME can't make the bot lose track of them.
 * With recentOnly, only last week's and this week's messages are touched —
 * the periodic status refresh doesn't need to rewrite old history.
 */
async function syncBossScheduleInternal(client, bossConfig, { recentOnly = false } = {}) {
  const { guild_id, boss_name, signup_channel_id, schedule_channel_id, emoji, color, boss_tags } = bossConfig;
  const isShared = Array.isArray(boss_tags);

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

    const bossLabel = isShared ? resolveBossTag(thread, forumChannel, boss_tags) : null;
    weekGroups.get(weekKey).push({ ...parsed, threadId: thread.id, bossLabel });
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
  const existingWeeks = listScheduleMessages(signup_channel_id);
  for (const row of existingWeeks) {
    if (!weekGroups.has(row.week_start_date)) {
      weekGroups.set(row.week_start_date, []);
    }
  }

  // Oldest week first. Messages that already exist are edited in place and
  // keep their position, but any message that has to be (re)posted lands at
  // the bottom of the channel — so posting in ascending order is what makes
  // a full re-post come out with the newest week last, where people look.
  const orderedWeeks = [...weekGroups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const oldestWeekToTouch = recentOnly ? shiftWeekKey(currentWeekKey, -1) : null;
  const endAfterMs = getRaidEndAfterMs();

  for (const [weekKey, entries] of orderedWeeks) {
    if (oldestWeekToTouch && weekKey < oldestWeekToTouch) continue;
    const existing = getScheduleMessage(signup_channel_id, weekKey);

    // Non-current week with nothing left to show — clean up instead of
    // leaving a stale message behind. The current week is exempt: it
    // always shows something, even the "no signups" placeholder text.
    if (entries.length === 0 && weekKey !== currentWeekKey) {
      if (existing) {
        const tracked = await fetchTrackedMessage(scheduleChannel, existing.message_id);
        if (!tracked.msg && !tracked.gone) {
          // Can't tell whether it still exists — keep the record so it can be cleaned up next time.
          console.error(
            `[${boss_name}] could not look up old schedule message ${existing.message_id} for week ${weekKey} (${describeFetchError(tracked.err)}); leaving it alone.`
          );
          continue;
        }
        if (tracked.msg) await tracked.msg.delete().catch(() => {});
        deleteScheduleMessage(signup_channel_id, weekKey);
      }
      continue;
    }

    const { empty, embed, content } = buildScheduleEmbed({
      bossName: boss_name,
      emoji,
      color,
      fullEmoji: bossConfig.full_emoji,
      missingEmoji: bossConfig.missing_emoji,
      scheduleTitleTemplate: bossConfig.schedule_title_template,
      emptyTextTemplate: bossConfig.empty_text_template,
      weekStartKey: weekKey,
      entries,
      now,
      isShared,
      endAfterMs,
    });
    const payload = empty ? { content, embeds: [] } : { content: null, embeds: [embed] };

    if (existing) {
      const tracked = await fetchTrackedMessage(scheduleChannel, existing.message_id);
      if (tracked.msg) {
        if (!showsSameContent(tracked.msg, payload)) await tracked.msg.edit(payload);
        continue;
      }
      if (!tracked.gone) {
        // NOT proof the message is gone (usually a missing permission such
        // as Read Message History in the schedule channel) — posting a
        // replacement here is how duplicate schedules happen. Skip and say why.
        console.error(
          `[${boss_name}] could not look up schedule message ${existing.message_id} (week ${weekKey}) in channel ${schedule_channel_id}: ${describeFetchError(tracked.err)} — NOT posting a replacement. Check the bot's Read Message History / View Channel permission there.`
        );
        continue;
      }
      // Discord confirmed the stored message was deleted (or moved with the
      // schedule channel) — fall through and post a replacement.
      console.warn(`[${boss_name}] schedule message ${existing.message_id} (week ${weekKey}) no longer exists, posting a replacement.`);
    }

    const sent = await scheduleChannel.send(payload);
    upsertScheduleMessage({
      signupChannelId: signup_channel_id,
      guildId: guild_id,
      bossName: boss_name,
      weekStartDate: weekKey,
      channelId: schedule_channel_id,
      messageId: sent.id,
    });
  }
}

// Two thread events for the SAME boss can fire close enough together that
// their syncBossSchedule calls overlap (e.g. our own titleNormalizer
// renaming a thread fires a threadUpdate on top of the threadCreate that
// triggered it). If both overlapping runs see the same "the tracked
// message was deleted out-of-band" state before either has written its
// replacement back to the DB, each creates its own new message —
// duplicate schedule posts. Queuing per signup channel (one boss = one
// signup channel) serializes these so a run always sees the previous
// run's finished state, never a stale snapshot from mid-flight.
const syncQueues = new Map(); // signup_channel_id -> tail Promise of the queue

export function syncBossSchedule(client, bossConfig, options = {}) {
  const key = bossConfig.signup_channel_id;
  const previous = syncQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => syncBossScheduleInternal(client, bossConfig, options));
  syncQueues.set(key, next);
  return next;
}
