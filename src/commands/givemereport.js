import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { resolveWeekRange } from '../lib/reportRange.js';
import { respondWithReport } from '../lib/reportCommand.js';

export const data = new SlashCommandBuilder()
  .setName('givemereport')
  .setDescription('統計「起始週 ～ 結束週」的開團報告（週為週二～週一）')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o
      .setName('start')
      .setDescription('起始週：該週內任何一天都可以，例如 2026-09-29 或 9/29')
      .setRequired(true)
  )
  .addStringOption((o) =>
    o
      .setName('end')
      .setDescription('結束週：該週內任何一天都可以，例如 2026-10-26 或 10/26（含該週）')
      .setRequired(true)
  )
  .addBooleanOption((o) =>
    o
      .setName('post')
      .setDescription('true = 發到設定的報告頻道；預設 false，只有你看得到的預覽')
      .setRequired(false)
  );

export async function execute(interaction) {
  const range = resolveWeekRange(interaction.options.getString('start'), interaction.options.getString('end'));
  if (!range.ok) {
    await interaction.reply({ content: `❌ ${range.error}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await respondWithReport(interaction, {
    startKey: range.startKey,
    endKey: range.endKey,
    post: interaction.options.getBoolean('post') ?? false,
    includesCurrentWeek: range.includesCurrentWeek,
  });
}
