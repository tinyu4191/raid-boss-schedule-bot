import { ChannelType, EmbedBuilder } from 'discord.js';
import { parseThreadTitle } from './titleParser.js';
import { resolveBossTag } from './forumTags.js';
import {
  getWeekStartKey,
  getWeekRangeLabel,
  getPreviousWeekStartKey,
  getTaipeiParts,
  weekMidpoint,
} from './weekUtils.js';
import { hasWeeklyReportBeenSent, markWeeklyReportSent } from '../db/db.js';

const REPORT_HOUR_TAIPEI = 8; // Tuesday 08:00 Asia/Taipei
const TUESDAY = 2;
const MAX_CAPTAIN_LINES = 15;

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
 * thread (title parses) whose raid date falls in the given week.
 * @returns {Promise<Array<{ ownerId: string|null, isFull: boolean, bossName: string, bossEmoji: string }>>}
 */
export async function collectWeekEntries(client, configs, weekStartKey) {
  const referenceDate = weekMidpoint(weekStartKey);
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

      const parsed = parseThreadTitle(thread.name, referenceDate);
      if (!parsed || getWeekStartKey(parsed.date) !== weekStartKey) continue;

      let bossName = cfg.boss_name;
      let bossEmoji = cfg.emoji;
      if (isShared) {
        const label = resolveBossTag(thread, forum, cfg.boss_tags);
        bossName = label.name;
        bossEmoji = label.emoji || cfg.emoji;
      }
      entries.push({ ownerId: thread.ownerId ?? null, isFull: parsed.isFull, bossName, bossEmoji });
    }
  }
  return entries;
}

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

/** Pure: entries -> the report embed. */
export function buildWeeklyReportEmbed({ weekStartKey, entries }) {
  const total = entries.length;
  const embed = new EmbedBuilder()
    .setTitle('📊 上週開團統計')
    .setColor('#5865F2')
    .setFooter({ text: '以出團日計算，只統計標題格式有效的團' });

  const range = `\`${getWeekRangeLabel(weekStartKey)}\``;
  if (total === 0) {
    return embed.setDescription(`${range}\n\n上週沒有任何有效標題的團。`);
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
  return embed;
}

export async function buildReportForTarget(client, target, weekStartKey) {
  const entries = await collectWeekEntries(client, target.configs, weekStartKey);
  return buildWeeklyReportEmbed({ weekStartKey, entries });
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
