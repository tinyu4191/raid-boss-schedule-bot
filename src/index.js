import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getBossConfigs, getBossConfigBySignupChannel } from './config/bosses.js';
import { syncBossSchedule } from './lib/scheduleSync.js';
import { scanAndSendReminders } from './lib/reminderScan.js';
import { parseThreadTitle } from './lib/titleParser.js';
import { normalizeThreadTitle } from './lib/titleNormalizer.js';
import { hasTitleFixNoticeBeenSent, markTitleFixNoticeSent } from './db/db.js';
import { registerCommandHandlers } from './commands/index.js';

const REMINDER_SCAN_INTERVAL_MS = 60 * 1000; // check every minute

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
  }
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
  for (const cfg of bossConfigs) {
    await syncBossSchedule(client, cfg).catch((err) =>
      console.error(`[startup sync] ${cfg.boss_name} failed:`, err)
    );
  }

  // Kick off the pre-raid reminder scan loop.
  await runReminderScan();
  setInterval(runReminderScan, REMINDER_SCAN_INTERVAL_MS);
});

registerCommandHandlers(client);

client.login(process.env.DISCORD_TOKEN);
