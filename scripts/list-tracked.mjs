// Shows every schedule message the bot is tracking and whether each one
// still exists in Discord — the first thing to run when schedules look
// duplicated or stale.
//
//   npm run list-tracked
//
// Read-only: never sends, edits or deletes anything. Prints only IDs, never
// the token. Records are keyed by the signup forum channel ID; "legacy"
// records (from before that, keyed by boss name) are listed separately.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { db, listLegacyScheduleRows } from '../src/db/db.js';
import { getBossConfigs } from '../src/config/bosses.js';

const configs = getBossConfigs();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(process.env.DISCORD_TOKEN);

async function check(channelId, messageId) {
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.messages.fetch(messageId);
    return { ok: true };
  } catch (err) {
    const hint =
      err?.code === 10008 ? '訊息已被刪除（會被補發）' :
      err?.code === 50013 || err?.code === 50001 ? '機器人沒有權限讀這個頻道/歷史訊息 — 檢查 Read Message History / View Channel' :
      '無法確認';
    return { ok: false, text: `${err?.code ?? err?.name}: ${err?.message} → ${hint}` };
  }
}

let bad = 0;
const rows = db
  .prepare(`SELECT * FROM schedule_messages ORDER BY signup_channel_id, week_start_date`)
  .all();
console.log('== 目前使用中的紀錄（以報名論壇頻道 ID 綁定）==');
for (const row of rows) {
  const cfg = configs.find((c) => c.signup_channel_id === row.signup_channel_id);
  const label = `${cfg?.boss_name ?? row.boss_name} / ${row.week_start_date} (論壇 ${row.signup_channel_id}) message ${row.message_id}`;
  const notes = [];
  if (!cfg) notes.push('⚠️ .env 目前沒有這個論壇頻道的設定');
  else if (cfg.schedule_channel_id !== row.channel_id) {
    notes.push(`⚠️ 紀錄的頻道 ${row.channel_id} ≠ .env 目前的行程表頻道 ${cfg.schedule_channel_id}`);
  }
  const r = await check(row.channel_id, row.message_id);
  if (!r.ok) bad++;
  console.log(`${r.ok ? '✅' : '❌'} ${label}${r.ok ? '' : '\n   ' + r.text}${notes.length ? '\n   ' + notes.join('\n   ') : ''}`);
}

const legacy = listLegacyScheduleRows();
console.log(`\n== 舊格式紀錄（以王名稱綁定，僅供參考，機器人已不再使用）==`);
for (const row of legacy) {
  const inUse = rows.some((r) => r.message_id === row.message_id);
  const r = await check(row.channel_id, row.message_id);
  console.log(
    `${inUse ? '↪️ 已轉移' : r.ok ? '🕳️ 孤兒（訊息還在 Discord，但機器人不再管理）' : '·  已不存在'} ${row.boss_name} / ${row.week_start_date} message ${row.message_id}`
  );
}
console.log(`\n使用中 ${rows.length} 筆，${bad} 筆查不到訊息；舊格式 ${legacy.length} 筆。`);
await client.destroy();
process.exit(0);
