import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getPreviousWeekStartKey, shiftWeekKey } from '../lib/weekUtils.js';
import { respondWithReport } from '../lib/reportCommand.js';

export const data = new SlashCommandBuilder()
  .setName('weeklyreport')
  .setDescription('預覽（或手動發送）單週統計報告')
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
  const weekKey = shiftWeekKey(getPreviousWeekStartKey(new Date()), -(weeksAgo - 1));
  await respondWithReport(interaction, { startKey: weekKey, post });
}
