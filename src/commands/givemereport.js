import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { resolveWeekRange, parseUserDate, buildWeekChoices } from '../lib/reportRange.js';
import { weekKeyOfTaipeiDate } from '../lib/weekUtils.js';
import { respondWithReport } from '../lib/reportCommand.js';

export const data = new SlashCommandBuilder()
  .setName('givemereport')
  .setDescription('統計「起始週 ～ 結束週」的開團報告（週為週二～週一）')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o
      .setName('start')
      .setDescription('起始週：從選單選擇，或輸入該週內任一天（例如 9/29）')
      .setAutocomplete(true)
      .setRequired(true)
  )
  .addStringOption((o) =>
    o
      .setName('end')
      .setDescription('結束週（含該週）：從選單選擇，或輸入該週內任一天（例如 10/26）')
      .setAutocomplete(true)
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

// Dropdown for the start/end options. Weeks are generated live (newest
// first), so the list is always current; once a start week is chosen the
// end list only offers that week and later.
export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  let minKey = null;
  if (focused.name === 'end') {
    const startDate = parseUserDate(interaction.options.getString('start') ?? '');
    if (startDate) minKey = weekKeyOfTaipeiDate(startDate.y, startDate.m, startDate.d);
  }
  await interaction.respond(buildWeekChoices({ typed: focused.value, minKey }));
}
