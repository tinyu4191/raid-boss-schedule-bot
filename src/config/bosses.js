import 'dotenv/config';

/**
 * Boss list is defined entirely in .env with a numbered pattern, so adding
 * a new boss is a config change, not a code change:
 *
 *   BOSS_1_NAME=樹王
 *   BOSS_1_SIGNUP_CHANNEL_ID=...
 *   BOSS_1_SCHEDULE_CHANNEL_ID=...
 *   BOSS_1_EMOJI=🌳         (optional, defaults to ⚔️)
 *   BOSS_1_COLOR="#57F287"  (optional, defaults to #57F287 — MUST be quoted,
 *                            see the dotenv-and-# note below)
 *   BOSS_1_GUILD_ID=...     (optional — see multi-server note below)
 *
 *   BOSS_2_NAME=龍王
 *   BOSS_2_SIGNUP_CHANNEL_ID=...
 *   BOSS_2_SCHEDULE_CHANNEL_ID=...
 *
 * Numbers do NOT need to be contiguous or start from any particular value
 * — every BOSS_<n>_NAME actually present in .env is picked up, in
 * ascending numeric order, regardless of gaps. (Earlier versions required
 * strict 1,2,3.. numbering with no gaps; that turned out to be a sharp
 * edge in practice — a skipped or commented-out middle entry silently
 * truncated everything after it. Scanning for whatever numbers exist
 * removes that failure mode entirely.) To add a boss: pick any unused
 * number — bigger than the current max is the obvious convention, but not
 * required — add its BOSS_<n>_* block, save, restart.
 *
 * DOTENV AND '#': dotenv treats an unquoted value's '#' as the start of a
 * comment and silently truncates everything from there — including the
 * '#' itself — even with no space before it. A hex color like #ED4245
 * written as BOSS_1_COLOR=#ED4245 becomes an EMPTY string, not an error,
 * so the bot just falls back to the default color with no warning. Always
 * quote color values: BOSS_1_COLOR="#ED4245".
 *
 * MULTIPLE SERVERS, ONE BOT: the top-level GUILD_ID is just the *default*
 * guild for any boss that doesn't specify its own. A boss belonging to a
 * different Discord server sets BOSS_<n>_GUILD_ID to override it. The bot
 * itself doesn't care — thread events are matched purely by channel ID
 * (globally unique across Discord), so the same running process already
 * handles as many servers as it's been invited to; only the boss→guild
 * mapping needed a way to vary per boss, which this covers.
 *
 * SHARED / TAG-BASED MODE: some servers use ONE signup forum for every
 * boss, distinguishing teams with Discord's own Forum tag feature instead
 * of one forum per boss. Adding BOSS_<n>_TAGS turns a config into this
 * mode: NAME still labels the config itself (for /listboss, DB keys, and
 * admin bookkeeping — NOT what's shown per-entry in the schedule), and
 * TAGS is a comma-separated list of the tag names (as configured on the
 * Forum channel) that represent a boss:
 *
 *   BOSS_7_NAME=ESC混合突襲池
 *   BOSS_7_SIGNUP_CHANNEL_ID=...
 *   BOSS_7_SCHEDULE_CHANNEL_ID=...
 *   BOSS_7_TAGS=普拉,困拉,龍王
 *
 * Each thread's applied tags are checked against this list; whichever one
 * matches becomes that entry's boss label in the shared schedule (which
 * shows every boss mixed together, sorted by time, each line prefixed
 * with its own resolved label). Non-boss tags (time-of-day, session
 * length, etc.) are simply not in this list, so they're ignored — the bot
 * never needs to know they exist. A thread with no matching boss tag
 * (captain forgot to apply one) is still shown, labeled "未標籤突襲",
 * rather than silently dropped — unlike a malformed title, this is
 * usually a one-off mistake worth surfacing.
 *
 * SHARED STYLES: the same boss (e.g. 樹王) often repeats across several
 * guild sections with identical emoji/color, which used to mean copying
 * BOSS_<n>_EMOJI/COLOR into every occurrence. A separate, also-numbered
 * (same gaps-allowed rule as BOSS_<n>) STYLE_<n>_* list defines a boss's
 * look-and-feel ONCE by name:
 *
 *   STYLE_1_NAME=樹王
 *   STYLE_1_EMOJI=🌳
 *   STYLE_1_COLOR="#57F287"
 *
 * Any BOSS_<n>_NAME that matches a STYLE_<n>_NAME picks up that emoji/color
 * automatically — no need to repeat EMOJI/COLOR on every BOSS_<n> block
 * for the same boss. Resolution order per boss: its own BOSS_<n>_EMOJI /
 * BOSS_<n>_COLOR if explicitly set (a per-instance override) → else the
 * matching STYLE_<n> entry by name → else the hardcoded default (⚔️ /
 * #57F287). STYLE_<n> numbering is independent of BOSS_<n> numbering.
 *
 * SEPARATE REMINDER CHANNEL: pre-raid reminders (see reminderScan.js) post
 * to BOSS_<n>_SCHEDULE_CHANNEL_ID by default, same as the weekly schedule
 * embed. When several BOSS_<n> configs (different signup forums) all point
 * at the same schedule channel — one server's "everything in one place"
 * setup — that channel ends up mixing several long-lived, repeatedly
 * edited schedule embeds with a stream of one-off reminder pings, which
 * gets busy fast. Setting BOSS_<n>_REMINDER_CHANNEL_ID sends that boss's
 * reminders there instead, leaving the schedule channel to hold only the
 * embeds. Optional — omit it and reminders keep going to the schedule
 * channel exactly as before.
 *
 * NOTE: this is intentionally lazy (not evaluated at import time). Some
 * entrypoints — deploy-commands.js in particular — only need a command's
 * *definition*, not a fully-configured .env, so importing this module
 * must not force validation. Validation only runs the first time
 * getBossConfigs() is actually called, and the result is cached.
 */
let cachedConfigs = null;
let cachedStyles = null;

// Finds every N for which `${prefix}_${N}_${suffix}` exists as an env var
// key, sorted ascending. Deliberately gap-tolerant — see the numbering
// note above for why "stop at the first missing number" was dropped.
function findNumberedKeys(prefix, suffix) {
  const re = new RegExp(`^${prefix}_(\\d+)_${suffix}$`);
  const nums = new Set();
  for (const key of Object.keys(process.env)) {
    const m = re.exec(key);
    if (m) nums.add(Number(m[1]));
  }
  return [...nums].sort((a, b) => a - b);
}

function loadBossStyles() {
  const styles = new Map(); // boss name -> { emoji, color }
  for (const i of findNumberedKeys('STYLE', 'NAME')) {
    const name = process.env[`STYLE_${i}_NAME`];
    if (!name) continue; // e.g. present but left blank
    styles.set(name, {
      emoji: process.env[`STYLE_${i}_EMOJI`] || null,
      color: process.env[`STYLE_${i}_COLOR`] || null,
    });
  }
  return styles;
}

function getStyles() {
  if (!cachedStyles) cachedStyles = loadBossStyles();
  return cachedStyles;
}

/**
 * Looks up a boss's STYLE_<n>_* entry by name (see the SHARED STYLES note
 * above). Used both for normal single-boss configs (already wired in
 * getBossConfigs below) and, as a fallback, by forumTags.js: in shared/
 * tag-based mode, a Forum tag with no emoji configured on the Discord side
 * can still show one by matching its name against this same registry —
 * one place to define what a boss looks like, reused everywhere its name
 * shows up.
 *
 * @param {string} name
 * @returns {{ emoji: string | null, color: string | null } | null}
 */
export function getBossStyle(name) {
  return getStyles().get(name) ?? null;
}

export function getBossConfigs() {
  if (cachedConfigs) return cachedConfigs;

  const defaultGuildId = process.env.GUILD_ID; // fallback only now, not required by itself
  const styles = getStyles();

  const configs = [];
  for (const i of findNumberedKeys('BOSS', 'NAME')) {
    const name = process.env[`BOSS_${i}_NAME`];
    if (!name) continue; // e.g. present but left blank

    const guildId = process.env[`BOSS_${i}_GUILD_ID`] || defaultGuildId;
    if (!guildId) {
      throw new Error(
        `BOSS_${i}_NAME (${name}) has no guild — set BOSS_${i}_GUILD_ID, or a top-level GUILD_ID to use as the default.`
      );
    }

    const signupChannelId = process.env[`BOSS_${i}_SIGNUP_CHANNEL_ID`];
    const scheduleChannelId = process.env[`BOSS_${i}_SCHEDULE_CHANNEL_ID`];
    if (!signupChannelId || !scheduleChannelId) {
      throw new Error(
        `BOSS_${i}_NAME (${name}) is missing BOSS_${i}_SIGNUP_CHANNEL_ID or BOSS_${i}_SCHEDULE_CHANNEL_ID in .env`
      );
    }

    const tagsRaw = process.env[`BOSS_${i}_TAGS`];
    const bossTags = tagsRaw
      ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : null; // null = normal single-boss mode; array = shared/tag-based mode

    const style = styles.get(name);
    const emoji = process.env[`BOSS_${i}_EMOJI`] || style?.emoji || '⚔️';
    const color = process.env[`BOSS_${i}_COLOR`] || style?.color || '#57F287';
    const reminderChannelId = process.env[`BOSS_${i}_REMINDER_CHANNEL_ID`] || scheduleChannelId;

    configs.push({
      guild_id: guildId,
      boss_name: name,
      signup_channel_id: signupChannelId,
      schedule_channel_id: scheduleChannelId,
      reminder_channel_id: reminderChannelId,
      emoji,
      color,
      boss_tags: bossTags,
    });
  }

  if (configs.length === 0) {
    console.warn('⚠️  No BOSS_*_NAME entries found in .env — bot will run but has nothing to sync.');
  }

  cachedConfigs = configs;
  return configs;
}

export function getBossConfigBySignupChannel(channelId) {
  return getBossConfigs().find((c) => c.signup_channel_id === channelId) ?? null;
}
