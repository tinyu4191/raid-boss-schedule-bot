import { ChannelType, EmbedBuilder } from 'discord.js';
import { parseThreadTitle } from './titleParser.js';
import { parseStarterMessage } from './starterMessageParser.js';
import { hasReminderBeenSent, markReminderSent } from '../db/db.js';

const REMINDER_LEAD_MINUTES = 30;

/**
 * Scans every configured boss's signup forum for threads whose raid time is
 * now within REMINDER_LEAD_MINUTES, and sends a one-time reminder for each
 * to that boss's schedule channel. Meant to be called on a timer (see
 * index.js) — safe to call repeatedly, since reminded_threads makes each
 * thread's reminder fire exactly once regardless of how often this runs.
 */
export async function scanAndSendReminders(client, bossConfig) {
  const { guild_id, boss_name, signup_channel_id, schedule_channel_id, emoji, color } = bossConfig;

  const forumChannel = await client.channels.fetch(signup_channel_id).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

  const scheduleChannel = await client.channels.fetch(schedule_channel_id).catch(() => null);
  if (!scheduleChannel) return;

  // Only active threads matter here — an archived/ended thread's raid time
  // has either already passed or the team disbanded, neither needs a
  // "starting soon" reminder.
  const active = await forumChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
  const now = new Date();

  for (const thread of active.threads.values()) {
    if (hasReminderBeenSent(thread.id)) continue;

    const parsed = parseThreadTitle(thread.name, now);
    if (!parsed) continue; // malformed title — same as everywhere else, ignore silently

    const minutesUntil = (parsed.date.getTime() - now.getTime()) / 60000;
    if (minutesUntil > REMINDER_LEAD_MINUTES || minutesUntil < 0) continue;

    await sendReminder({ client, thread, parsed, bossConfig: { boss_name, emoji, color }, scheduleChannel, guildId: guild_id })
      .catch((err) => console.error(`[reminder] ${boss_name} / ${thread.name} failed:`, err));

    markReminderSent(guild_id, boss_name, thread.id);
  }
}

async function sendReminder({ client, thread, parsed, bossConfig, scheduleChannel, guildId }) {
  const starterMessage = await thread.fetchStarterMessage().catch(() => null);
  const { memberIds, channelNumber } = parseStarterMessage(starterMessage, thread.ownerId);

  const teamLabel = parsed.teamName || `${bossConfig.boss_name}突襲團`;
  const channelText = channelNumber ? `CH${channelNumber}` : '⚠️ 待隊長另行公布';
  const threadLink = `https://discord.com/channels/${guildId}/${thread.id}`;
  const mentionLine = memberIds.map((id) => `<@${id}>`).join(' ');

  const content = `📣 ${REMINDER_LEAD_MINUTES} 分鐘後出團提醒 — 出團成員請注意：\n${mentionLine}`;

  const embed = new EmbedBuilder()
    .setTitle(`${bossConfig.emoji} ${bossConfig.boss_name}突襲 — ${teamLabel}`)
    .addFields(
      { name: '🕒 時間', value: formatReminderTime(parsed.date), inline: true },
      { name: '📡 頻道', value: channelText, inline: true },
      { name: '📎 討論串', value: `[點此前往](${threadLink})`, inline: false }
    )
    .setColor(bossConfig.color || '#57F287');

  await scheduleChannel.send({
    content,
    embeds: [embed],
    allowedMentions: { parse: ['users'] }, // never triggers @everyone/@here even if content ever contains it
  });
}

function formatReminderTime(date) {
  const twOffsetMs = 8 * 60 * 60 * 1000;
  const tw = new Date(date.getTime() + twOffsetMs);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(tw.getUTCMonth() + 1)}/${pad2(tw.getUTCDate())}(${weekdays[tw.getUTCDay()]}) ${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}`;
}
