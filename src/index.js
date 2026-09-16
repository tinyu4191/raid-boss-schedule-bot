import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getBossConfigs, getBossConfigBySignupChannel } from './config/bosses.js';
import { syncBossSchedule } from './lib/scheduleSync.js';
import { registerCommandHandlers } from './commands/index.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
});

registerCommandHandlers(client);

client.login(process.env.DISCORD_TOKEN);
