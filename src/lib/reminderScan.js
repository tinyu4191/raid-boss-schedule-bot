import { ChannelType, EmbedBuilder } from 'discord.js';
import { parseThreadTitle } from './titleParser.js';
import { parseStarterMessage, formatChannelEmoji } from './starterMessageParser.js';
import { resolveBossTag } from './forumTags.js';
import { applyTitleTemplate } from './titleTemplate.js';
import { hasReminderBeenSent, markReminderSent, saveReminderMessages } from '../db/db.js';

const REMINDER_LEAD_MINUTES = 30;

/**
 * Scans every configured boss's signup forum for threads whose raid time is
 * now within REMINDER_LEAD_MINUTES, and sends a one-time reminder for each
 * to that boss's schedule channel. Meant to be called on a timer (see
 * index.js) — safe to call repeatedly, since reminded_threads makes each
 * thread's reminder fire exactly once regardless of how often this runs.
 */
export async function scanAndSendReminders(client, bossConfig) {
  const {
    guild_id,
    boss_name,
    signup_channel_id,
    reminder_channel_id,
    emoji,
    color,
    boss_tags,
    reminder_title_template,
    thread_reminder_enabled,
  } = bossConfig;
  const isShared = Array.isArray(boss_tags);

  const forumChannel = await client.channels.fetch(signup_channel_id).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

  const reminderChannel = await client.channels.fetch(reminder_channel_id).catch(() => null);
  if (!reminderChannel) return;

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

    const bossLabel = isShared ? resolveBossTag(thread, forumChannel, boss_tags) : null;
    const displayBoss = bossLabel ? { name: bossLabel.name, emoji: bossLabel.emoji || emoji } : { name: boss_name, emoji };

    await sendReminder({
      client,
      thread,
      parsed,
      displayBoss,
      color,
      reminderTitleTemplate: reminder_title_template,
      reminderChannel,
      guildId: guild_id,
      threadReminderEnabled: thread_reminder_enabled !== false,
    }).catch((err) => console.error(`[reminder] ${boss_name} / ${thread.name} failed:`, err));

    markReminderSent(guild_id, boss_name, thread.id);
  }
}

async function sendReminder({
  client,
  thread,
  parsed,
  displayBoss,
  color,
  reminderTitleTemplate,
  reminderChannel,
  guildId,
  threadReminderEnabled = true,
}) {
  const starterMessage = await thread.fetchStarterMessage().catch(() => null);
  const { memberIds, channelNumber } = parseStarterMessage(starterMessage, thread.ownerId);

  const teamLabel = parsed.teamName || `${displayBoss.name}突襲團`;
  const channelText = buildReminderChannelText(channelNumber);
  const threadLink = `https://discord.com/channels/${guildId}/${thread.id}`;
  const mentionLine = memberIds.map((id) => `<@${id}>`).join(' ');

  const content = `📣 ${REMINDER_LEAD_MINUTES} 分鐘後出團提醒 — 出團成員請注意：\n${mentionLine}`;

  const title = reminderTitleTemplate
    ? applyTitleTemplate(reminderTitleTemplate, { emoji: displayBoss.emoji, name: displayBoss.name, team: teamLabel })
    : `${displayBoss.emoji} ${displayBoss.name}突襲 — ${teamLabel}`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      { name: '🕒 時間', value: formatReminderTime(parsed.date), inline: true },
      { name: '📡 頻道', value: channelText, inline: true },
      { name: '📎 討論串', value: `[點此前往](${threadLink})`, inline: false }
    )
    .setColor(color || '#57F287');

  let channelMsg = null;
  let threadMsg = null;
  try {
    channelMsg = await reminderChannel.send({
      content,
      embeds: [embed],
      allowedMentions: { parse: ['users'] }, // never triggers @everyone/@here even if content ever contains it
    });
  } finally {
    // The in-thread copy is independent: a failure in either place must not
    // stop the other (and neither is retried — the reminder fires once).
    if (threadReminderEnabled) {
      threadMsg = await thread
        .send({
          content: buildThreadReminderText(parsed.date, channelNumber, thread.ownerId),
          // The only ping: the captain, and only when the channel is still unset.
          allowedMentions: channelNumber || !thread.ownerId ? { parse: [] } : { users: [thread.ownerId] },
        })
        .catch((err) => {
          console.error(`[reminder] could not post in thread ${thread.id}:`, err?.message ?? err);
          return null;
        });
    }
    // Remember what was posted so a later edit of the starter post (e.g. the
    // captain settles on a channel) can update these messages in place.
    if (channelMsg || threadMsg) {
      saveReminderMessages({
        threadId: thread.id,
        signupChannelId: thread.parentId,
        channelNumber,
        reminderChannelId: channelMsg ? reminderChannel.id : null,
        reminderMessageId: channelMsg?.id ?? null,
        threadMessageId: threadMsg?.id ?? null,
      });
    }
  }
}

/** Channel line shown in the reminder channel's embed. */
export function buildReminderChannelText(channelNumber) {
  return channelNumber ? formatChannelEmoji(channelNumber) : '⚠️ 待隊長另行公布';
}

/** "123" -> "1️⃣2️⃣3️⃣" (no CH prefix: the label already says it's the channel). */
function formatChannelKeycaps(channelNumber) {
  return [...String(channelNumber)].map((d) => `${d}\uFE0F\u20E3`).join('');
}

/**
 * The short notice posted inside the signup thread itself. It never
 * mentions the team; the one exception is a nudge to the captain (when
 * captainId is given and no channel has been set yet) to fill in the channel
 * — editing the starter post then updates this message for everyone.
 */
export function buildThreadReminderText(date, channelNumber, captainId = null) {
  const channelText = channelNumber ? formatChannelKeycaps(channelNumber) : '⚠️ 待隊長另行公布';
  let text = `📣 ${REMINDER_LEAD_MINUTES} 分鐘後出團！\n🕒 時間：${formatReminderTime(date)}\n📡 頻道：${channelText}`;
  if (!channelNumber && captainId) {
    text += `\n👉 <@${captainId}> 隊長請在貼文內文加上「頻道：數字」，這則通知會自動更新給所有隊員`;
  }
  return text;
}

export function formatReminderTime(date) {
  const twOffsetMs = 8 * 60 * 60 * 1000;
  const tw = new Date(date.getTime() + twOffsetMs);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(tw.getUTCMonth() + 1)}/${pad2(tw.getUTCDate())}(${weekdays[tw.getUTCDay()]}) ${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}`;
}
