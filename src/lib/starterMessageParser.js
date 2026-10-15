// Parses a signup thread's starter message (the "OP" post) to figure out
// who's going and which in-game channel (CH) the captain picked, close to
// raid time. Unlike the thread *title*, this needs the actual message
// content, which requires the Message Content privileged intent to be
// enabled — see README for the Developer Portal step.

// Matches "頻道88", "頻道：88", "頻道:88", "CH88", "CH 231", "ch999" etc.
// Requires the 頻道/CH prefix immediately before the digits so it never
// accidentally grabs an unrelated number elsewhere in the post.
const CHANNEL_RE = /(?:頻道|ch)\s*[:：]?\s*(\d+)/i;

/**
 * Renders a channel number as emoji for display in the reminder:
 * "123" -> "🇨 🇭1️⃣2️⃣3️⃣" (C and H as separate letter emoji). Each digit becomes its keycap emoji
 * (digit + U+FE0F + U+20E3). parseStarterMessage still returns the plain
 * digits; this is purely presentation.
 * @param {string} channelNumber - digits only, e.g. "88"
 */
export function formatChannelEmoji(channelNumber) {
  const keycaps = [...String(channelNumber)].map((d) => `${d}\uFE0F\u20E3`).join(' ');
  // 🇨 (U+1F1E8) + 🇭 (U+1F1ED) side by side would merge into the Swiss
  // flag, so a zero-width space between them keeps them as two separate
  // letter emoji, matching the keycap digits.
  return `${keycaps}`;
}

/**
 * @param {import('discord.js').Message | null} starterMessage
 * @param {string} captainId - thread.ownerId, always included in the roster
 * @returns {{
 *   memberIds: string[],      // deduped Discord user IDs, captain included
 *   channelNumber: string | null, // e.g. "88", or null if not found/no starter message
 * }}
 */
export function parseStarterMessage(starterMessage, captainId) {
  const memberIds = new Set();
  if (captainId) memberIds.add(captainId);

  if (!starterMessage) {
    return { memberIds: [...memberIds], channelNumber: null };
  }

  for (const user of starterMessage.mentions.users.values()) {
    if (user.bot) continue; // never tag other bots
    memberIds.add(user.id);
  }

  const content = starterMessage.content ?? '';
  const channelMatch = CHANNEL_RE.exec(content);
  const channelNumber = channelMatch ? channelMatch[1] : null;

  return { memberIds: [...memberIds], channelNumber };
}
