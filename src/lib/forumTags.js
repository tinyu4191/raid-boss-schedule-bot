// Resolves which boss a thread belongs to when a signup forum is shared
// across multiple bosses via Discord's own Forum tag feature, instead of
// one forum per boss. See config/bosses.js for the BOSS_<n>_TAGS format.
import { getBossStyle } from '../config/bosses.js';

const UNTAGGED_LABEL = { name: '未標籤突襲', emoji: '❓' };

// Matches one leading emoji (optionally followed by a variation selector
// or skin-tone modifier) plus any whitespace after it — e.g. "⏰拉圖"
// splits into emoji="⏰", rest="拉圖". Some servers bake the emoji directly
// into the Forum tag's name instead of using Discord's separate per-tag
// emoji field; this lets BOSS_<n>_TAGS list stay plain text ("拉圖") while
// still recognizing "⏰拉圖" as that same tag, and reuses the emoji the
// admin already chose rather than requiring it to be set up twice.
const LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)\s*/u;

function stripLeadingEmoji(str) {
  const m = LEADING_EMOJI_RE.exec(str);
  if (!m) return { emoji: null, rest: str };
  return { emoji: m[1], rest: str.slice(m[0].length) };
}

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

    // Try an exact match first (plain tag names, no emoji baked in), then
    // fall back to matching with a leading emoji stripped off.
    let matchedName = null;
    let nameEmoji = null;
    if (bossTagNames.includes(tag.name)) {
      matchedName = tag.name;
    } else {
      const stripped = stripLeadingEmoji(tag.name);
      if (bossTagNames.includes(stripped.rest)) {
        matchedName = stripped.rest;
        nameEmoji = stripped.emoji;
      }
    }
    if (matchedName === null) continue; // a time/session tag, not a boss tag — ignore

    // Emoji priority: one baked into the tag's name > Discord's own
    // per-tag emoji field > STYLE_<n>_EMOJI fallback by name.
    const tagFieldEmoji = tag.emoji ? (tag.emoji.id ? `<:${tag.emoji.name}:${tag.emoji.id}>` : tag.emoji.name) : null;
    const emoji = nameEmoji || tagFieldEmoji || getBossStyle(matchedName)?.emoji || null;
    return { name: matchedName, emoji };
  }

  return UNTAGGED_LABEL;
}
