// Keeps already-posted reminders correct. A reminder goes out 30 minutes
// before a raid, often while the captain hasn't picked an in-game channel
// yet ("⚠️ 待隊長另行公布"), and the captain may change their mind afterwards.
// When the starter post's channel number changes, both copies of the
// reminder (reminder channel + inside the thread) are EDITED in place.
// Edits don't notify anyone — by design, the update is quiet.
//
// Two triggers, both calling refreshReminderForThread():
//   - messageUpdate on a thread's starter message (instant; index.js)
//   - a catch-up pass each minute over recently sent reminders, which covers
//     edits made while the bot was restarting / missed events
import { EmbedBuilder } from 'discord.js';
import { parseStarterMessage } from './starterMessageParser.js';
import { parseThreadTitle } from './titleParser.js';
import { buildThreadReminderText, buildReminderChannelText, formatReminderTime } from './reminderScan.js';
import { getReminderMessages, updateReminderChannelNumber, listRecentReminderMessages } from '../db/db.js';
import { getBossConfigBySignupChannel } from '../config/bosses.js';

const UNKNOWN_MESSAGE = 10008;
// How long after being sent a reminder is still re-checked by the catch-up
// pass: 30 min before the raid + the raid itself + margin.
const CATCH_UP_WINDOW_MS = 3 * 60 * 60 * 1000;

const FIELD_TIME = '🕒 時間';
const FIELD_CHANNEL = '📡 頻道';

const queues = new Map(); // thread_id -> tail promise (one refresh at a time per thread)

/**
 * @param {import('discord.js').ThreadChannel} thread
 * @param {object} [opts]
 * @param {import('discord.js').Message} [opts.starterMessage] - already-fetched starter message
 * @param {boolean} [opts.force] - also re-check the time (title may have been edited), not only the channel
 * @returns {Promise<boolean>} true if anything was edited
 */
export function refreshReminderForThread(client, thread, opts = {}) {
  const previous = queues.get(thread.id) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => doRefresh(client, thread, opts));
  queues.set(thread.id, next);
  next.finally(() => {
    if (queues.get(thread.id) === next) queues.delete(thread.id);
  }).catch(() => {});
  return next;
}

async function doRefresh(client, thread, { starterMessage = null, force = false } = {}) {
  const row = getReminderMessages(thread.id);
  if (!row) return false; // no reminder was sent for this thread (yet)
  if (thread.archived) return false; // messages in an archived thread can't be edited

  const starter = starterMessage && !starterMessage.partial ? starterMessage : await thread.fetchStarterMessage().catch(() => null);
  if (!starter) return false;
  const { channelNumber } = parseStarterMessage(starter, thread.ownerId);

  const channelChanged = (channelNumber ?? null) !== (row.channel_number ?? null);
  if (!channelChanged && !force) return false;

  const parsed = parseThreadTitle(thread.name);
  let edited = false;

  if (row.thread_message_id && parsed) {
    const msg = await thread.messages.fetch(row.thread_message_id).catch((err) => noteFetchError('thread', thread, err));
    if (msg) {
      const text = buildThreadReminderText(parsed.date, channelNumber, thread.ownerId);
      if (msg.content !== text) {
        await msg.edit({ content: text, allowedMentions: { parse: [] } }).catch((err) => logEditError('thread', thread, err));
        edited = true;
      }
    }
  }

  if (row.reminder_message_id && row.reminder_channel_id) {
    const channel = await client.channels.fetch(row.reminder_channel_id).catch(() => null);
    const msg = channel ? await channel.messages.fetch(row.reminder_message_id).catch((err) => noteFetchError('channel', thread, err)) : null;
    if (msg && msg.embeds[0]) {
      const embed = EmbedBuilder.from(msg.embeds[0]);
      const channelText = buildReminderChannelText(channelNumber);
      let changed = false;
      const fields = (embed.data.fields ?? []).map((f) => {
        if (f.name === FIELD_CHANNEL && f.value !== channelText) {
          changed = true;
          return { ...f, value: channelText };
        }
        if (f.name === FIELD_TIME && parsed && f.value !== formatReminderTime(parsed.date)) {
          changed = true;
          return { ...f, value: formatReminderTime(parsed.date) };
        }
        return f;
      });
      if (changed) {
        embed.setFields(fields);
        // Embeds only: the content (roster @mentions) is left as sent — a
        // mention added by editing wouldn't notify anyone anyway.
        await msg.edit({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err) => logEditError('channel', thread, err));
        edited = true;
      }
    }
  }

  // Record the new value even if a copy was already deleted, so we don't
  // keep re-checking the same change every minute.
  updateReminderChannelNumber(thread.id, channelNumber);
  if (edited) console.log(`[reminderRefresh] ${thread.name}: channel ${row.channel_number ?? '(none)'} -> ${channelNumber ?? '(none)'}`);
  return edited;
}

function noteFetchError(where, thread, err) {
  if (err?.code !== UNKNOWN_MESSAGE) {
    console.error(`[reminderRefresh] could not read the ${where} reminder for thread ${thread.id}: ${err?.code ?? err?.name}: ${err?.message ?? err}`);
  }
  return null;
}

function logEditError(where, thread, err) {
  console.error(`[reminderRefresh] could not edit the ${where} reminder for thread ${thread.id}: ${err?.code ?? err?.name}: ${err?.message ?? err}`);
}

/**
 * Re-check every reminder sent in the last few hours. Cheap when nothing
 * changed: one starter-message fetch per recent reminder.
 */
export async function catchUpReminderRefresh(client, now = new Date()) {
  const since = new Date(now.getTime() - CATCH_UP_WINDOW_MS).toISOString();
  for (const row of listRecentReminderMessages(since)) {
    if (!getBossConfigBySignupChannel(row.signup_channel_id)) continue; // boss no longer configured
    const thread = await client.channels.fetch(row.thread_id).catch(() => null);
    if (!thread?.isThread?.()) continue;
    await refreshReminderForThread(client, thread).catch((err) =>
      console.error(`[reminderRefresh] thread ${row.thread_id} failed:`, err)
    );
  }
}
