import { EmbedBuilder } from 'discord.js';
import { getWeekRangeLabel, formatTaipeiDateHeader, formatTaipeiTime, isPast } from './weekUtils.js';

/**
 * @param {object} args
 * @param {string} args.bossName
 * @param {string} args.emoji
 * @param {string} args.color - hex color
 * @param {string} args.weekStartKey - YYYY-MM-DD (Tuesday)
 * @param {Array}  args.entries - [{ date, isFull, missingText, teamName, threadId }]
 * @param {Date}   args.now
 * @returns {{ empty: true, content: string } | { empty: false, embed: EmbedBuilder }}
 */
export function buildScheduleEmbed({ bossName, emoji, color, weekStartKey, entries, now = new Date() }) {
  if (entries.length === 0) {
    return { empty: true, content: `${emoji} ${bossName}突襲 — 本週尚無隊伍報名` };
  }

  const sorted = [...entries].sort((a, b) => a.date - b.date);

  const byDay = new Map();
  for (const e of sorted) {
    const key = formatTaipeiDateHeader(e.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }

  const lines = [];
  for (const [dayLabel, dayEntries] of byDay) {
    lines.push(`**${dayLabel}**`);
    for (const e of dayEntries) {
      const statusEmoji = e.isFull ? '🈵' : '🈸';
      const missingPart = e.missingText;
      const statusText = e.isFull
        ? e.teamName
          ? `${e.teamName}（已滿）`
          : '已滿'
        : e.teamName
          ? `${e.teamName} ${missingPart}`
          : missingPart;
      const line = `${statusEmoji} ${formatTaipeiTime(e.date)} ｜${statusText} → <#${e.threadId}>`;
      lines.push(isPast(e.date, now) ? `~~${line}~~ *(已結束)*` : line);
    }
    lines.push('');
  }

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${bossName}突襲 — 本週行程表`)
    .setDescription(`\`${getWeekRangeLabel(weekStartKey)}\`\n\n${lines.join('\n').trim()}`)
    .setColor(color || '#57F287')
    .setFooter({ text: '最後更新' })
    .setTimestamp(now);

  return { empty: false, embed };
}
