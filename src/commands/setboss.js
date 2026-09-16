import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { upsertBossConfig } from '../db/db.js';
import { syncBossSchedule } from '../lib/scheduleSync.js';

export const data = new SlashCommandBuilder()
  .setName('setboss')
  .setDescription('設定一個突襲王的報名頻道與行程表頻道')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) => o.setName('name').setDescription('王的名稱，例如：樹王').setRequired(true))
  .addChannelOption((o) =>
    o.setName('signup_channel').setDescription('報名用 Forum 頻道').addChannelTypes(ChannelType.GuildForum).setRequired(true)
  )
  .addChannelOption((o) =>
    o
      .setName('schedule_channel')
      .setDescription('出團行程表頻道')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addStringOption((o) => o.setName('emoji').setDescription('代表 emoji，例如：🌳').setRequired(false))
  .addStringOption((o) => o.setName('color').setDescription('embed 顏色 hex，例如：#57F287').setRequired(false));

export async function execute(interaction) {
  const bossName = interaction.options.getString('name');
  const signupChannel = interaction.options.getChannel('signup_channel');
  const scheduleChannel = interaction.options.getChannel('schedule_channel');
  const emoji = interaction.options.getString('emoji') ?? '⚔️';
  const color = interaction.options.getString('color') ?? '#57F287';

  upsertBossConfig({
    guildId: interaction.guildId,
    bossName,
    signupChannelId: signupChannel.id,
    scheduleChannelId: scheduleChannel.id,
    emoji,
    color,
  });

  await interaction.reply({
    content: `✅ 已設定「${bossName}」：報名頻道 ${signupChannel} → 行程表 ${scheduleChannel}`,
    ephemeral: true,
  });

  const cfg = {
    guild_id: interaction.guildId,
    boss_name: bossName,
    signup_channel_id: signupChannel.id,
    schedule_channel_id: scheduleChannel.id,
    emoji,
    color,
  };
  await syncBossSchedule(interaction.client, cfg).catch((err) => console.error(`[setboss] initial sync failed:`, err));
}
