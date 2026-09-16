import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getBossConfigs, getBossConfigBySignupChannel } from './config/bosses.js';
import { syncBossSchedule } from './lib/scheduleSync.js';
import { scanAndSendReminders } from './lib/reminderScan.js';
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

async function handleThreadEvent(thread) {
  if (!thread?.parentId) return;
  const bossConfig = getBossConfigBySignupChannel(thread.parentId);
  if (!bossConfig) return; // thread isn't in a configured signup channel
  try {
    await syncBossSchedule(client, bossConfig);
  } catch (err) {
    console.error(`[syncBossSchedule] ${bossConfig.boss_name} failed:`, err);
  }
}

// A thread's title (date/status/slots) can change at any point — create,
// rename, or archive/delete — so we resync on all three.
client.on('threadCreate', handleThreadEvent);
client.on('threadUpdate', (_oldThread, newThread) => handleThreadEvent(newThread));
client.on('threadDelete', handleThreadEvent);

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
