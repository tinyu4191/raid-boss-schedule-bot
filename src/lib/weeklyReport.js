import { ChannelType, EmbedBuilder } from 'discord.js';
import { parseThreadTitle } from './titleParser.js';
import { resolveBossTag } from './forumTags.js';
import {
  getWeekStartKey,
  getWeekRangeLabel,
  getPreviousWeekStartKey,
  getTaipeiParts,
  weekMidpoint,
  listWeekKeys,
  getRangeLabel,
} from './weekUtils.js';
import { hasWeeklyReportBeenSent, markWeeklyReportSent } from '../db/db.js';

const REPORT_HOUR_TAIPEI = 8; // Tuesday 08:00 Asia/Taipei
const TUESDAY = 2;
const MAX_CAPTAIN_LINES = 15;
const MAX_WEEK_LINES = 26;

/**
 * True from Tuesday 08:00 Asia/Taipei until the end of that Tuesday. The
 * window (rather than one exact minute) lets a bot that was restarted or
 * briefly offline at 08:00 still catch up the same day; weekly_reports_sent
 * guarantees it never double-sends.
 */
export function isWeeklyReportWindow(now = new Date()) {
  const { weekday, hour } = getTaipeiParts(now);
  return weekday === TUESDAY && hour >= REPORT_HOUR_TAIPEI;
}

/**
 * Groups boss configs into report targets: configs in the same guild that
 * share a report channel become ONE report. Configs with no report channel
 * are skipped unless includeUnset is true (used by the /weeklyreport
 * preview, which should work before the channel is configured).
 */
export function groupReportTargets(configs, { includeUnset = false } = {}) {
  const groups = new Map();
  for (const cfg of configs) {
    if (!cfg.report_channel_id && !includeUnset) continue;
    const key = `${cfg.guild_id}:${cfg.report_channel_id ?? 'unset'}`;
    if (!groups.has(key)) {
      groups.set(key, { guildId: cfg.guild_id, channelId: cfg.report_channel_id ?? null, configs: [] });
    }
    groups.get(key).configs.push(cfg);
  }
  return [...groups.values()];
}

/**
 * Reads every signup forum in the target and returns one entry per VALID
 * thread (title parses) whose raid date falls in the given week range
 * (inclusive, both ends are week_start keys).
 * @returns {Promise<Array<{ weekKey: string, ownerId: string|null, isFull: boolean, bossName: string, bossEmoji: string }>>}
 */
export async function collectRangeEntries(client, configs, startKey, endKey) {
  const fallbackReference = weekMidpoint(startKey);
  const entries = [];

  for (const cfg of configs) {
    const forum = await client.channels.fetch(cfg.signup_channel_id).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      console.warn(`[weeklyReport] ${cfg.boss_name}: signup channel ${cfg.signup_channel_id} is not a forum, skipped.`);
      continue;
    }
    const isShared = Array.isArray(cfg.boss_tags);

    const [active, archived] = await Promise.all([
      forum.threads.fetchActive().catch(() => ({ threads: new Map() })),
      // fetchAll pages through the whole archive — the schedule sync only
      // needs the newest page, but a report must not silently miss teams.
      forum.threads.fetchArchived({ type: 'public', fetchAll: true }).catch(() => ({ threads: new Map() })),
    ]);
    const seen = new Set();
    for (const thread of [...active.threads.values(), ...archived.threads.values()]) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);

      // The title has no year, so it's inferred relative to a reference
      // date. The thread's own creation time is the best one: a team is
      // always created shortly before its raid date, which keeps year
      // inference right across New Year and for ranges spanning years.
      const parsed = parseThreadTitle(thread.name, thread.createdAt ?? fallbackReference);
      if (!parsed) continue;
      const weekKey = getWeekStartKey(parsed.date);
      if (weekKey < startKey || weekKey > endKey) continue;

      let bossName = cfg.boss_name;
      let bossEmoji = cfg.emoji;
      if (isShared) {
        const label = resolveBossTag(thread, forum, cfg.boss_tags);
        bossName = label.name;
        bossEmoji = label.emoji || cfg.emoji;
      }
      entries.push({ weekKey, ownerId: thread.ownerId ?? null, isFull: parsed.isFull, bossName, bossEmoji });
    }
  }
  return entries;
}

export function collectWeekEntries(client, configs, weekStartKey) {
  return collectRangeEntries(client, configs, weekStartKey, weekStartKey);
}

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

/**
 * Pure: entries -> the report embed. A single week (startKey === endKey)
 * keeps the original "上週開團統計" layout; a longer range adds a
 * per-week breakdown and a range title.
 */
export function buildReportEmbed({ startKey, endKey = startKey, entries, includesCurrentWeek = false }) {
  const total = entries.length;
  const multi = startKey !== endKey;
  const weekKeys = listWeekKeys(startKey, endKey);

  const embed = new EmbedBuilder()
    .setTitle(multi ? `📊 開團統計（共 ${weekKeys.length} 週）` : '📊 上週開團統計')
    .setColor('#5865F2')
    .setFooter({
      text: includesCurrentWeek
        ? '以出團日計算，只統計標題格式有效的團｜含尚未結束的本週，數字之後可能增加'
        : '以出團日計算，只統計標題格式有效的團',
    });

  const range = `\`${multi ? getRangeLabel(startKey, endKey) : getWeekRangeLabel(startKey)}\``;
  if (total === 0) {
    return embed.setDescription(`${range}\n\n${multi ? '這段期間' : '上週'}沒有任何有效標題的團。`);
  }

  const full = entries.filter((e) => e.isFull).length;
  const missing = total - full;

  // Captains
  const byCaptain = new Map();
  for (const e of entries) {
    const key = e.ownerId ?? 'unknown';
    const c = byCaptain.get(key) ?? { count: 0, full: 0 };
    c.count++;
    if (e.isFull) c.full++;
    byCaptain.set(key, c);
  }
  const captains = [...byCaptain.entries()].sort((a, b) => b[1].count - a[1].count || b[1].full - a[1].full);
  const captainLines = captains.slice(0, MAX_CAPTAIN_LINES).map(([id, c], i) => {
    const who = id === 'unknown' ? '（未知團長）' : `<@${id}>`;
    return `${i + 1}. ${who}　${c.count} 場（滿團 ${c.full}）`;
  });
  if (captains.length > MAX_CAPTAIN_LINES) {
    captainLines.push(`…另有 ${captains.length - MAX_CAPTAIN_LINES} 位團長`);
  }

  // Bosses
  const byBoss = new Map();
  for (const e of entries) {
    const b = byBoss.get(e.bossName) ?? { count: 0, emoji: e.bossEmoji };
    b.count++;
    byBoss.set(e.bossName, b);
  }
  const bossLines = [...byBoss.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, b]) => `${b.emoji} ${name}　${b.count} 場`);

  embed
    .setDescription(
      `${range}\n\n共開團 **${total}** 場　滿團 **${full}**（${pct(full, total)}%）｜未滿 **${missing}**（${pct(missing, total)}%）`
    )
    .addFields(
      { name: '👤 團長排行', value: captainLines.join('\n').slice(0, 1024) },
      { name: '⚔️ 各 BOSS 分布', value: bossLines.join('\n').slice(0, 1024) }
    );

  if (multi) {
    const perWeek = new Map(weekKeys.map((k) => [k, 0]));
    for (const e of entries) perWeek.set(e.weekKey, (perWeek.get(e.weekKey) ?? 0) + 1);
    const weekLines = weekKeys.slice(0, MAX_WEEK_LINES).map((k) => {
      const [, m, d] = k.split('-');
      return `${m}/${d} 起　${perWeek.get(k)} 場`;
    });
    if (weekKeys.length > MAX_WEEK_LINES) weekLines.push(`…共 ${weekKeys.length} 週，僅列前 ${MAX_WEEK_LINES} 週`);
    embed.addFields({ name: '📅 每週場數', value: weekLines.join('\n').slice(0, 1024) });
  }
  return embed;
}

/** Single-week convenience wrapper (the scheduled weekly report). */
export function buildWeeklyReportEmbed({ weekStartKey, entries }) {
  return buildReportEmbed({ startKey: weekStartKey, entries });
}

export async function buildReportForTarget(client, target, startKey, endKey = startKey, { includesCurrentWeek = false } = {}) {
  const entries = await collectRangeEntries(client, target.configs, startKey, endKey);
  return buildReportEmbed({ startKey, endKey, entries, includesCurrentWeek });
}

export async function postReport(client, channelId, embed) {
  const channel = await client.channels.fetch(channelId);
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }); // @mentions render but never notify
}

const loggedFailures = new Set(); // avoid logging the same failure every minute

/**
 * Called from the every-minute scan. Sends last week's report to every
 * subscribed report channel once Tuesday 08:00 (Taipei) has passed.
 */
export async function scanAndSendWeeklyReports(client, configs, now = new Date()) {
  // Global pause: WEEKLY_REPORT_AUTO=false stops ALL scheduled sends while
  // leaving every REPORT_CHANNEL_ID in place for manual /weeklyreport and
  // /givemereport posts.
  if (['false', 'off', '0', 'no'].includes((process.env.WEEKLY_REPORT_AUTO || '').trim().toLowerCase())) return;
  if (!isWeeklyReportWindow(now)) return;

  const reportWeekKey = getPreviousWeekStartKey(now);
  const subscribed = configs.filter((c) => c.weekly_report_enabled);

  for (const target of groupReportTargets(subscribed)) {
    if (hasWeeklyReportBeenSent(target.channelId, reportWeekKey)) continue;
    const failKey = `${target.channelId}:${reportWeekKey}`;
    try {
      const embed = await buildReportForTarget(client, target, reportWeekKey);
      await postReport(client, target.channelId, embed);
      markWeeklyReportSent(target.guildId, target.channelId, reportWeekKey);
      loggedFailures.delete(failKey);
      console.log(`[weeklyReport] sent report for week ${reportWeekKey} to channel ${target.channelId}`);
    } catch (err) {
      if (!loggedFailures.has(failKey)) {
        loggedFailures.add(failKey);
        console.error(`[weeklyReport] could not send to channel ${target.channelId} (will keep retrying today):`, err);
      }
    }
  }
}
