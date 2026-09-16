import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandData } from './commands/index.js';
import { getBossConfigs } from './config/bosses.js';

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const body = commandData.map((c) => c.toJSON());

// Collect every guild that needs these commands: the top-level GUILD_ID
// (if set) plus whatever guild IDs show up across the configured bosses
// (including per-boss BOSS_<n>_GUILD_ID overrides for a second/third
// server). Wrapped in try/catch so this still works even if .env's boss
// section isn't fully filled in yet — deploying commands shouldn't require
// a complete boss config.
const guildIds = new Set();
if (process.env.GUILD_ID) guildIds.add(process.env.GUILD_ID);

try {
  for (const cfg of getBossConfigs()) guildIds.add(cfg.guild_id);
} catch (err) {
  console.warn(
    `⚠️  暫時讀不到完整的王設定（${err.message}）。這次只會用頂層 GUILD_ID（如果有填）或 global 部署，之後把王設定填完可以再跑一次 npm run deploy-commands。`
  );
}

try {
  if (guildIds.size > 0) {
    for (const guildId of guildIds) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body });
      console.log(`✅ 已對伺服器 ${guildId} 註冊 ${body.length} 個指令（guild-scoped，立即生效）`);
    }
  } else {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
    console.log(`✅ 已註冊 ${body.length} 個指令（global，可能要等最多 1 小時才會出現）`);
  }
} catch (err) {
  console.error('❌ 指令註冊失敗:', err);
  process.exit(1);
}
