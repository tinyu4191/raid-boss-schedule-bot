// Resolves which boss a thread belongs to when a signup forum is shared
// across multiple bosses via Discord's own Forum tag feature, instead of
// one forum per boss. See config/bosses.js for the BOSS_<n>_TAGS format.
import { getBossStyle } from '../config/bosses.js';

const UNTAGGED_LABEL = { name: '未標籤突襲', emoji: '❓' };

/**
 * @param {import('discord.js').ThreadChannel} thread
 * @param {import('discord.js').ForumChannel} forumChannel
 * @param {string[]} bossTagNames - the configured BOSS_<n>_TAGS list
 * @returns {{ name: string, emoji: string | null }}
 *   Never null — falls back to the "未標籤突襲" label so a thread with no
 *   matching boss tag still shows up (a captain forgetting to tag it is
 *   usually a one-off mistake worth surfacing, not silently dropping).
 */
export function resolveBossTag(thread, forumChannel, bossTagNames) {
  const tagsById = new Map((forumChannel.availableTags || []).map((t) => [t.id, t]));

  for (const tagId of thread.appliedTags || []) {
    const tag = tagsById.get(tagId);
    if (!tag) continue;
    if (!bossTagNames.includes(tag.name)) continue; // a time/session tag, not a boss tag — ignore

    // Prefer the emoji configured on the Forum tag itself in Discord; if
    // the tag has none set, fall back to STYLE_<n>_EMOJI for a boss of
    // this name (see config/bosses.js) rather than showing nothing.
    const tagEmoji = tag.emoji ? (tag.emoji.id ? `<:${tag.emoji.name}:${tag.emoji.id}>` : tag.emoji.name) : null;
    const emoji = tagEmoji || getBossStyle(tag.name)?.emoji || null;
    return { name: tag.name, emoji };
  }

  return UNTAGGED_LABEL;
}
