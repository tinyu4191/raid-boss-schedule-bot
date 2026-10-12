import { MessageFlags } from 'discord.js';
import { getBossConfigs } from '../config/bosses.js';
import { groupReportTargets, buildReportForTarget, postReport } from './weeklyReport.js';

/**
 * Shared body of /weeklyreport and /givemereport: build the report for
 * this server's bosses over [startKey, endKey] and either preview it
 * (ephemeral, works before a channel is configured) or post it to each
 * configured report channel. Manual posts are never recorded as "sent",
 * so they don't affect the scheduled weekly report.
 */
export async function respondWithReport(interaction, { startKey, endKey = startKey, post = false, includesCurrentWeek = false }) {
  const configs = getBossConfigs().filter((c) => c.guild_id === interaction.guildId);
  if (configs.length === 0) {
    await interaction.reply({ content: '這個伺服器目前 .env 尚未設定任何王', flags: MessageFlags.Ephemeral });
    return;
  }

  const targets = groupReportTargets(configs, { includeUnset: !post });
  if (targets.length === 0) {
    await interaction.reply({
      content: '沒有任何王設定了 `BOSS_<n>_REPORT_CHANNEL_ID`，無法發送。（不加 post 參數可以先預覽）',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const embeds = [];
  const notes = [];
  for (const target of targets.slice(0, 10)) {
    const names = target.configs.map((c) => c.boss_name).join('、');
    const embed = await buildReportForTarget(interaction.client, target, startKey, endKey, { includesCurrentWeek });
    if (post) {
      try {
        await postReport(interaction.client, target.channelId, embed);
        notes.push(`✅ 已發送到 <#${target.channelId}>（${names}）`);
      } catch (err) {
        console.error(`[report command] could not post to channel ${target.channelId}:`, err);
        notes.push(`❌ 發送到 <#${target.channelId}> 失敗（${names}）：${err.message}（檢查機器人在該頻道的 Send Messages / Embed Links 權限）`);
      }
    } else {
      embeds.push(embed);
      const where = target.channelId ? `將發到 <#${target.channelId}>` : '尚未設定 REPORT_CHANNEL_ID，不會發送';
      notes.push(`${names} — ${where}`);
    }
  }
  await interaction.editReply({ content: notes.join('\n'), embeds, allowedMentions: { parse: [] } });
}
