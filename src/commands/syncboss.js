import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getBossConfigs } from '../config/bosses.js';
import { syncBossSchedule } from '../lib/scheduleSync.js';

export const data = new SlashCommandBuilder()
  .setName('syncboss')
  .setDescription('手動重新整理某個王的行程表（一般不需要，thread 異動會自動觸發）')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o.setName('name').setDescription('王的名稱，需與 .env 裡的 BOSS_n_NAME 完全一致').setRequired(true)
  );

export async function execute(interaction) {
  const name = interaction.options.getString('name');
  const bossConfigs = getBossConfigs();
  const cfg = bossConfigs.find((c) => c.boss_name === name);
  if (!cfg) {
    await interaction.reply({
      content: `找不到「${name}」。目前設定的王：${bossConfigs.map((c) => c.boss_name).join('、') || '（無）'}`,
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  await syncBossSchedule(interaction.client, cfg);
  await interaction.editReply(`✅ 已重新整理「${name}」的行程表`);
}
