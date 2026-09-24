import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getBossConfigs } from '../config/bosses.js';

export const data = new SlashCommandBuilder().setName('listboss').setDescription('列出目前這個伺服器設定的突襲王');

export async function execute(interaction) {
  const bossConfigs = getBossConfigs().filter((c) => c.guild_id === interaction.guildId);
  if (bossConfigs.length === 0) {
    await interaction.reply({ content: '這個伺服器目前 .env 尚未設定任何王', flags: MessageFlags.Ephemeral });
    return;
  }
  const lines = bossConfigs.map((c) => {
    const base = `${c.emoji} **${c.boss_name}** — 報名 <#${c.signup_channel_id}> → 行程表 <#${c.schedule_channel_id}>`;
    // Only call out the reminder channel when it's actually different —
    // most configs don't set BOSS_<n>_REMINDER_CHANNEL_ID, and for those
    // it silently defaults to the schedule channel, so repeating that
    // here every time would just be noise.
    if (c.reminder_channel_id !== c.schedule_channel_id) {
      return `${base}（提醒另發 <#${c.reminder_channel_id}>）`;
    }
    return base;
  });
  await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}
