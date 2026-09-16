import 'dotenv/config';

/**
 * Boss list is defined entirely in .env with a numbered pattern, so adding
 * a new boss is a config change, not a code change:
 *
 *   BOSS_1_NAME=樹王
 *   BOSS_1_SIGNUP_CHANNEL_ID=...
 *   BOSS_1_SCHEDULE_CHANNEL_ID=...
 *   BOSS_1_EMOJI=🌳         (optional, defaults to ⚔️)
 *   BOSS_1_COLOR=#57F287    (optional, defaults to #57F287)
 *   BOSS_1_GUILD_ID=...     (optional — see multi-server note below)
 *
 *   BOSS_2_NAME=龍王
 *   BOSS_2_SIGNUP_CHANNEL_ID=...
 *   BOSS_2_SCHEDULE_CHANNEL_ID=...
 *
 * To add a boss later: append the next BOSS_<n>_* block to .env and
 * restart the bot. Numbering must stay contiguous from 1 — parsing stops
 * at the first missing BOSS_<n>_NAME, so don't leave gaps.
 *
 * MULTIPLE SERVERS, ONE BOT: the top-level GUILD_ID is just the *default*
 * guild for any boss that doesn't specify its own. A boss belonging to a
 * different Discord server sets BOSS_<n>_GUILD_ID to override it. The bot
 * itself doesn't care — thread events are matched purely by channel ID
 * (globally unique across Discord), so the same running process already
 * handles as many servers as it's been invited to; only the boss→guild
 * mapping needed a way to vary per boss, which this covers.
 *
 * NOTE: this is intentionally lazy (not evaluated at import time). Some
 * entrypoints — deploy-commands.js in particular — only need a command's
 * *definition*, not a fully-configured .env, so importing this module
 * must not force validation. Validation only runs the first time
 * getBossConfigs() is actually called, and the result is cached.
 */
let cachedConfigs = null;

export function getBossConfigs() {
  if (cachedConfigs) return cachedConfigs;

  const defaultGuildId = process.env.GUILD_ID; // fallback only now, not required by itself

  const configs = [];
  for (let i = 1; ; i++) {
    const name = process.env[`BOSS_${i}_NAME`];
    if (!name) break; // first gap in numbering = end of list

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

    configs.push({
      guild_id: guildId,
      boss_name: name,
      signup_channel_id: signupChannelId,
      schedule_channel_id: scheduleChannelId,
      emoji: process.env[`BOSS_${i}_EMOJI`] || '⚔️',
      color: process.env[`BOSS_${i}_COLOR`] || '#57F287',
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
