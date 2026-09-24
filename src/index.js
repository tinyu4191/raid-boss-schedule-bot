import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getBossConfigs, getBossConfigBySignupChannel } from './config/bosses.js';
import { syncBossSchedule } from './lib/scheduleSync.js';
import { scanAndSendReminders } from './lib/reminderScan.js';
import { scanAndNotifyDayBefore } from './lib/dayBeforeNotice.js';
import { parseThreadTitle } from './lib/titleParser.js';
import { normalizeThreadTitle } from './lib/titleNormalizer.js';
import { msUntilNextTaipeiMidnight } from './lib/weekUtils.js';
import { hasTitleFixNoticeBeenSent, markTitleFixNoticeSent } from './db/db.js';
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
  partials: [Partials.Channel],
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
client.on('threadUpdate', (_oldThread, newThread) => handleThreadEvent(newThread, { attemptTitleFix: true }));
client.on('threadDelete', (thread) => handleThreadEvent(thread));

async function runReminderScan() {
  for (const cfg of getBossConfigs()) {
    await scanAndSendReminders(client, cfg).catch((err) =>
      console.error(`[reminderScan] ${cfg.boss_name} failed:`, err)
    );
    await scanAndNotifyDayBefore(client, cfg).catch((err) =>
      console.error(`[dayBeforeNotice] ${cfg.boss_name} failed:`, err)
    );
  }
}

// Threads only get re-synced when something actually happens to them
// (created, edited, archived, deleted) — an entry that quietly crosses
// its raid time with no such activity wouldn't get its ~~已結束~~
// strikethrough until the next unrelated event happened to touch that
// boss. This daily pass at Asia/Taipei midnight re-syncs every boss
// regardless, so "已結束" stays accurate even on a quiet day.
async function runFullResync(reason) {
  for (const cfg of getBossConfigs()) {
    await syncBossSchedule(client, cfg).catch((err) =>
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

  // Catch up on anything that changed while the bot was offline.
  await runFullResync('startup sync');

  // Kick off the pre-raid reminder scan loop and the daily midnight resync.
  await runReminderScan();
  setInterval(runReminderScan, REMINDER_SCAN_INTERVAL_MS);
  scheduleMidnightResync();
});

registerCommandHandlers(client);

client.login(process.env.DISCORD_TOKEN);
