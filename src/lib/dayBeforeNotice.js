// "24 hours before raid time, still missing people" nudge: unlike the
// 30-minute pre-raid reminder (which always fires, posts to the
// schedule/reminder channel, and tags the roster), this one only fires
// when the team is STILL MISSING PEOPLE at the 24-hour mark, posts
// directly IN the team's own thread (not the schedule channel), and pings
// @everyone to attract new sign-ups — a louder, once-only nudge aimed at
// people who aren't already following that specific thread.
import { ChannelType } from 'discord.js';
import { parseThreadTitle } from './titleParser.js';
import { hasDayBeforeNoticeBeenSent, markDayBeforeNoticeSent } from '../db/db.js';

const DAY_BEFORE_LEAD_MINUTES = 24 * 60;

/**
 * Scans one boss's active signup threads and, for any thread whose raid
 * time is within 24 hours AND still marked as missing people (never for
 * an already-full team), posts an @everyone nudge in that thread. Fires
 * at most once per thread — safe to call repeatedly (same pattern as
 * scanAndSendReminders).
 */
export async function scanAndNotifyDayBefore(client, bossConfig) {
  const { guild_id, boss_name, signup_channel_id } = bossConfig;

  const forumChannel = await client.channels.fetch(signup_channel_id).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

  const active = await forumChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
  const now = new Date();

  for (const thread of active.threads.values()) {
    if (hasDayBeforeNoticeBeenSent(thread.id)) continue;

    const parsed = parseThreadTitle(thread.name, now);
    if (!parsed) continue; // malformed title — same as everywhere else, ignore silently
    if (parsed.isFull) continue; // already full — nothing to nudge for

    const minutesUntil = (parsed.date.getTime() - now.getTime()) / 60000;
    if (minutesUntil > DAY_BEFORE_LEAD_MINUTES || minutesUntil < 0) continue;

    await thread
      .send({
        content: '@everyone 距離出團時間還有 24 小時，這團目前還缺人，想報名的人趕快喔！',
        allowedMentions: { parse: ['everyone'] },
      })
      .catch((err) => console.error(`[dayBeforeNotice] ${boss_name} / ${thread.name} failed:`, err));

    markDayBeforeNoticeSent(guild_id, boss_name, thread.id);
  }
}
