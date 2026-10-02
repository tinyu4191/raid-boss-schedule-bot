import { EmbedBuilder } from 'discord.js';
import { getWeekRangeLabel, formatTaipeiDateHeader, formatTaipeiTime, isPast } from './weekUtils.js';
import { applyTitleTemplate } from './titleTemplate.js';

/**
 * @param {object} args
 * @param {string} args.bossName
 * @param {string} args.emoji
 * @param {string} args.color - hex color
 * @param {string} [args.fullEmoji] - status emoji for a full team, defaults to 🈵
 * @param {string} [args.missingEmoji] - status emoji for a team missing people, defaults to 🆓
 * @param {string} [args.scheduleTitleTemplate] - custom embed title template
 *   ({emoji}/{name} placeholders — see config/bosses.js CUSTOM TITLES).
 *   Falls back to the existing hardcoded phrasing when not set.
 * @param {string} [args.emptyTextTemplate] - custom "no signups" text
 *   template, same placeholders and fallback behavior.
 * @param {string} args.weekStartKey - YYYY-MM-DD (Tuesday)
 * @param {Array}  args.entries - [{ date, isFull, missingText, teamName, threadId, bossLabel }]
 *   bossLabel ({ name, emoji } | null) is only set in shared/tag-based mode
 *   (see config/bosses.js BOSS_<n>_TAGS) — one signup forum serving several
 *   bosses, distinguished per-thread by Forum tag rather than by channel.
 * @param {Date}   args.now
 * @param {boolean} [args.isShared] - shared/tag-based mode: the title and
 *   "no signups" text drop the single-boss framing, and each line is
 *   prefixed with its own resolved boss label.
 * @returns {{ empty: true, content: string } | { empty: false, embed: EmbedBuilder }}
 */
export function buildScheduleEmbed({
  bossName,
  emoji,
  color,
  fullEmoji = '🈵',
  missingEmoji = '🆓',
  scheduleTitleTemplate = null,
  emptyTextTemplate = null,
  weekStartKey,
  entries,
  now = new Date(),
  isShared = false,
}) {
  const templateVars = { emoji, name: bossName };

  if (entries.length === 0) {
    const content = emptyTextTemplate
      ? applyTitleTemplate(emptyTextTemplate, templateVars)
      : isShared
        ? '🗓️ 本週尚無隊伍報名'
        : `${emoji} ${bossName}突襲 — 本週尚無隊伍報名`;
    return { empty: true, content };
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
      const statusEmoji = e.isFull ? fullEmoji : missingEmoji;

      let afterPipe;
      if (isShared) {
        // The arrow already links to the thread, and Discord renders that
        // thread's own title inline right after it — so the team name and
        // missing-info text here would just be a duplicate. What's
        // actually missing at a glance is *which boss* this is, so show
        // that instead: the tag's own emoji if it has one configured,
        // falling back to a bracketed name (e.g. for 未標籤突襲, whose
        // fallback emoji is ❓ so it still reads fine either way).
        afterPipe = e.bossLabel?.emoji || `【${e.bossLabel?.name || '未標籤突襲'}】`;
      } else {
        const missingPart = e.missingText;
        afterPipe = e.isFull
          ? e.teamName
            ? `${e.teamName}（已滿）`
            : '已滿'
          : e.teamName
            ? `${e.teamName} ${missingPart}`
            : missingPart;
      }

      const line = `${statusEmoji} ${formatTaipeiTime(e.date)} ｜${afterPipe} → <#${e.threadId}>`;
      lines.push(isPast(e.date, now) ? `~~${line}~~ *(已結束)*` : line);
    }
    lines.push('');
  }

  const title = scheduleTitleTemplate
    ? applyTitleTemplate(scheduleTitleTemplate, templateVars)
    : isShared
      ? '🗓️ 本週出團行程表'
      : `${emoji} ${bossName}突襲 — 本週行程表`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`\`${getWeekRangeLabel(weekStartKey)}\`\n\n${lines.join('\n').trim()}`)
    .setColor(color || '#57F287')
    .setFooter({ text: '最後更新' })
    .setTimestamp(now);

  return { empty: false, embed };
}
