import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getBossConfigs } from '../config/bosses.js';
import { getPreviousWeekStartKey, shiftWeekKey } from '../lib/weekUtils.js';
import { groupReportTargets, buildReportForTarget, postReport } from '../lib/weeklyReport.js';

export const data = new SlashCommandBuilder()
  .setName('weeklyreport')
  .setDescription('預覽（或手動發送）週報統計 — 測試用，正式週報會在週二 08:00 自動發送')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption((o) =>
    o
      .setName('weeks_ago')
      .setDescription('統計幾週前（1 = 上週，預設）')
      .setMinValue(1)
      .setMaxValue(12)
      .setRequired(false)
  )
  .addBooleanOption((o) =>
    o
      .setName('post')
      .setDescription('true = 實際發到設定的報告頻道（需已設 REPORT_CHANNEL_ID）；預設只有你看得到的預覽')
      .setRequired(false)
  );

export async function execute(interaction) {
  const weeksAgo = interaction.options.getInteger('weeks_ago') ?? 1;
  const post = interaction.options.getBoolean('post') ?? false;
  const configs = getBossConfigs().filter((c) => c.guild_id === interaction.guildId);
  if (configs.length === 0) {
    await interaction.reply({ content: '這個伺服器目前 .env 尚未設定任何王', flags: MessageFlags.Ephemeral });
    return;
  }

  // Preview works even before a report channel is configured.
  const targets = groupReportTargets(configs, { includeUnset: !post });
  if (targets.length === 0) {
    await interaction.reply({
      content: '沒有任何王設定了 `BOSS_<n>_REPORT_CHANNEL_ID`，無法發送。（不加 post 參數可以先預覽）',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const weekKey = shiftWeekKey(getPreviousWeekStartKey(new Date()), -(weeksAgo - 1));

  const embeds = [];
  const notes = [];
  for (const target of targets.slice(0, 10)) {
    const embed = await buildReportForTarget(interaction.client, target, weekKey);
    if (post) {
      await postReport(interaction.client, target.channelId, embed);
      notes.push(`✅ 已發送到 <#${target.channelId}>（${target.configs.map((c) => c.boss_name).join('、')}）`);
    } else {
      embeds.push(embed);
      const where = target.channelId ? `將發到 <#${target.channelId}>` : '尚未設定 REPORT_CHANNEL_ID，不會自動發送';
      notes.push(`${target.configs.map((c) => c.boss_name).join('、')} — ${where}`);
    }
  }
  // Manual sends are never recorded as "sent", so they do not suppress the scheduled Tuesday report.
  await interaction.editReply({ content: notes.join('\n'), embeds, allowedMentions: { parse: [] } });
}
