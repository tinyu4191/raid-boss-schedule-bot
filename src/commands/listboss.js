import { SlashCommandBuilder } from 'discord.js';
import { getBossConfigs } from '../config/bosses.js';

export const data = new SlashCommandBuilder().setName('listboss').setDescription('列出目前這個伺服器設定的突襲王');

export async function execute(interaction) {
  const bossConfigs = getBossConfigs().filter((c) => c.guild_id === interaction.guildId);
  if (bossConfigs.length === 0) {
    await interaction.reply({ content: '這個伺服器目前 .env 尚未設定任何王', ephemeral: true });
    return;
  }
  const lines = bossConfigs.map(
    (c) => `${c.emoji} **${c.boss_name}** — 報名 <#${c.signup_channel_id}> → 行程表 <#${c.schedule_channel_id}>`
  );
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}
