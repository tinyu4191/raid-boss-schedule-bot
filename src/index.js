import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getBossConfigs, getBossConfigBySignupChannel } from './config/bosses.js';
import { syncBossSchedule } from './lib/scheduleSync.js';
import { scanAndSendReminders } from './lib/reminderScan.js';
import { refreshReminderForThread, catchUpReminderRefresh } from './lib/reminderRefresh.js';
import { scanAndNotifyDayBefore } from './lib/dayBeforeNotice.js';
import { scanAndSendWeeklyReports } from './lib/weeklyReport.js';
import { parseThreadTitle } from './lib/titleParser.js';
import { normalizeThreadTitle } from './lib/titleNormalizer.js';
import { msUntilNextTaipeiMidnight, msUntilNextTaipeiBoundary } from './lib/weekUtils.js';
import { getScheduleRefreshMs } from './config/settings.js';
import { hasTitleFixNoticeBeenSent, markTitleFixNoticeSent, migrateLegacyScheduleRows } from './db/db.js';
import { registerCommandHandlers } from './commands/index.js';

const REMINDER_SCAN_INTERVAL_MS = 60 * 1000; // check every minute
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Needed to read a signup thread's starter-message content (roster
    // mentions + "CH88"-style channel text) for the pre-raid reminder.
    // Requires the Message Content privileged intent to also be turned on
    // in the Developer Portal — see README.
    GatewayIntentBits.MessageContent,
  ],
  // Partials.Message: so edits to messages the bot hasn't cached (e.g. a
  // starter post from before the last restart) still raise messageUpdate.
  partials: [Partials.Channel, Partials.Message],
});

// Best-effort title auto-fix, run only at the moment of create/edit (not
// during periodic scans) — see titleNormalizer.js for what it can and
// can't fix. If it can't safely fix the title, the captain gets a single
// @-mention notice per thread instead of being silently ignored.
async function maybeFixThreadTitle(thread) {
  if (parseThreadTitle(thread.name)) return; // already valid, nothing to do

  const result = normalizeThreadTitle(thread.name);
  if (result.fixed) {
    await thread.setName(result.newTitle);
    return;
  }

  if (hasTitleFixNoticeBeenSent(thread.id)) return; // don't re-nag on every edit
  await thread
    .send({
      content: `<@${thread.ownerId}> 這個討論串的標題偵測不到完整的日期或時間，機器人沒辦法自動修正，麻煩手動調整成 \`MM/DD(週X) HH:mm｜名稱\` 的格式喔！`,
      allowedMentions: { parse: ['users'] },
    })
    .catch(() => {});
  markTitleFixNoticeSent(thread.id);
}

async function handleThreadEvent(thread, { attemptTitleFix = false } = {}) {
  if (!thread?.parentId) return;
  const bossConfig = getBossConfigBySignupChannel(thread.parentId);
  if (!bossConfig) return; // thread isn't in a configured signup channel

  if (attemptTitleFix) {
    await maybeFixThreadTitle(thread).catch((err) =>
      console.error(`[titleNormalizer] thread ${thread.id} failed:`, err)
    );
  }

  try {
    await syncBossSchedule(client, bossConfig);
  } catch (err) {
    console.error(`[syncBossSchedule] ${bossConfig.boss_name} failed:`, err);
  }
}

// A thread's title (date/status/slots) can change at any point — create,
// rename, or archive/delete — so we resync on all three. Title auto-fix
// only makes sense on create/update (a deleted thread has no title left
// to fix).
client.on('threadCreate', (thread) => handleThreadEvent(thread, { attemptTitleFix: true }));
client.on('threadUpdate', (_oldThread, newThread) => {
  handleThreadEvent(newThread, { attemptTitleFix: true });
  // A renamed thread may have a new raid time: fix the already-posted reminders too.
  if (newThread?.parentId && getBossConfigBySignupChannel(newThread.parentId)) {
    refreshReminderForThread(client, newThread, { force: true }).catch((err) =>
      console.error(`[reminderRefresh] thread ${newThread.id} failed:`, err)
    );
  }
});
client.on('threadDelete', (thread) => handleThreadEvent(thread));

// The captain edits the signup post (e.g. settles on an in-game channel after
// the reminder already went out): update the posted reminders in place. In a
// forum thread the starter message has the same ID as the thread itself.
client.on('messageUpdate', async (_oldMessage, message) => {
  try {
    const channel = message.channel;
    if (!channel?.isThread?.() || message.id !== channel.id) return;
    if (!getBossConfigBySignupChannel(channel.parentId)) return;
    await refreshReminderForThread(client, channel, { starterMessage: message.partial ? null : message });
  } catch (err) {
    console.error('[reminderRefresh] messageUpdate failed:', err);
  }
});

async function runReminderScan() {
  for (const cfg of getBossConfigs()) {
    await scanAndSendReminders(client, cfg).catch((err) =>
      console.error(`[reminderScan] ${cfg.boss_name} failed:`, err)
    );
    await scanAndNotifyDayBefore(client, cfg).catch((err) =>
      console.error(`[dayBeforeNotice] ${cfg.boss_name} failed:`, err)
    );
  }
  // Safety net for edits missed while the bot was down/restarting.
  await catchUpReminderRefresh(client).catch((err) => console.error('[reminderRefresh] catch-up failed:', err));
  await scanAndSendWeeklyReports(client, getBossConfigs()).catch((err) =>
    console.error('[weeklyReport] scan failed:', err)
  );
}

// Threads only get re-synced when something actually happens to them
// (created, edited, archived, deleted) — an entry that quietly crosses
// its raid time with no such activity wouldn't get its ~~已結束~~
// strikethrough until the next unrelated event happened to touch that
// boss. This daily pass at Asia/Taipei midnight re-syncs every boss
// regardless, so "已結束" stays accurate even on a quiet day.
async function runFullResync(reason, options = {}) {
  for (const cfg of getBossConfigs()) {
    await syncBossSchedule(client, cfg, options).catch((err) =>
      console.error(`[${reason}] ${cfg.boss_name} failed:`, err)
    );
  }
}

function scheduleMidnightResync() {
  const delay = msUntilNextTaipeiMidnight();
  setTimeout(async () => {
    await runFullResync('midnight resync');
    setInterval(() => runFullResync('midnight resync'), ONE_DAY_MS);
  }, delay);
}

// Periodic status refresh (default every 2 hours, SCHEDULE_REFRESH_MINUTES;
// 0 = off), aligned to Taipei clock boundaries (00:00, 02:00, ...). It only
// touches last week's and this week's messages, so a raid that just crossed
// its end time gets struck through without anyone having to edit a thread.
function scheduleStatusRefresh() {
  const interval = getScheduleRefreshMs();
  if (!interval) {
    console.log('Status refresh disabled (SCHEDULE_REFRESH_MINUTES=0).');
    return;
  }
  const run = () => runFullResync('status refresh', { recentOnly: true });
  setTimeout(() => {
    run();
    setInterval(run, interval);
  }, msUntilNextTaipeiBoundary(interval));
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // This is where .env validation actually needs to happen — the bot is
  // about to do real work, so fail loudly now if the config is bad.
  const bossConfigs = getBossConfigs();
  console.log(
    `Loaded ${bossConfigs.length} boss config(s) from .env: ${
      bossConfigs.map((c) => c.boss_name).join(', ') || '(none)'
    }`
  );

  // One-time move of the old name-keyed records to the signup-channel-ID
  // key (safe to run every start; it does nothing once done).
  const mig = migrateLegacyScheduleRows(bossConfigs);
  if (!mig.alreadyDone) {
    console.log(`Schedule records migrated to channel-ID tracking: ${mig.migrated} moved, ${mig.leftBehind} old record(s) not matching any current .env boss left untouched.`);
  }

  // Catch up on anything that changed while the bot was offline.
  await runFullResync('startup sync');

  // Kick off the pre-raid reminder scan loop and the daily midnight resync.
  await runReminderScan();
  setInterval(runReminderScan, REMINDER_SCAN_INTERVAL_MS);
  scheduleMidnightResync();
  scheduleStatusRefresh();
});

registerCommandHandlers(client);

client.login(process.env.DISCORD_TOKEN);
