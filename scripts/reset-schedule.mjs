// Clears and rebuilds ONE boss's schedule messages — the repair tool for
// duplicated / out-of-order schedules in a schedule channel.
//
//   npm run reset-schedule -- 8            # preview (BOSS number from .env), changes nothing
//   npm run reset-schedule -- 8 --yes      # really do it
//
// The target can be the BOSS_<n> number, the boss name, or the signup forum
// channel ID. What it does with --yes:
//   1. deletes every schedule message the bot has on record for that boss
//      (current records, plus old name-keyed records in the same schedule
//      channel that no current .env boss claims) — only messages the bot
//      itself wrote;
//   2. forgets those records;
//   3. re-posts all weeks from scratch, oldest first, so the newest week
//      ends up at the bottom.
// It never touches signup threads, reminders or reports. Stop the bot first
// (pm2 stop raid-boss-bot) so nothing else syncs at the same time.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { db, listScheduleMessages, deleteScheduleMessage, listLegacyScheduleRows, deleteLegacyScheduleRow } from '../src/db/db.js';
import { getBossConfigs } from '../src/config/bosses.js';
import { syncBossSchedule } from '../src/lib/scheduleSync.js';

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('用法: npm run reset-schedule -- <BOSS編號|王名稱|報名論壇頻道ID> [--yes]');
  process.exit(1);
}

const configs = getBossConfigs();
const cfg = configs.find(
  (c) => c.signup_channel_id === target || c.boss_name === target || envNumberOf(c) === target
);
if (!cfg) {
  console.error(`找不到「${target}」。目前 .env 的王：${configs.map((c) => c.boss_name).join('、')}`);
  process.exit(1);
}

function envNumberOf(c) {
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^BOSS_(\d+)_SIGNUP_CHANNEL_ID$/.exec(k);
    if (m && v === c.signup_channel_id) return m[1];
  }
  return null;
}

// Everything on record for this boss.
const targets = [];
for (const r of listScheduleMessages(cfg.signup_channel_id)) {
  targets.push({ kind: 'current', week: r.week_start_date, channelId: r.channel_id, messageId: r.message_id, label: cfg.boss_name });
}
const claimed = new Set(configs.filter((c) => c.guild_id === cfg.guild_id).map((c) => c.boss_name));
for (const r of listLegacyScheduleRows()) {
  if (r.guild_id !== cfg.guild_id || r.channel_id !== cfg.schedule_channel_id) continue;
  if (r.boss_name !== cfg.boss_name && claimed.has(r.boss_name)) continue; // belongs to another current boss
  if (targets.some((t) => t.messageId === r.message_id)) continue; // already counted via the current records
  targets.push({ kind: 'legacy', week: r.week_start_date, channelId: r.channel_id, messageId: r.message_id, label: r.boss_name, legacyKey: r });
}

console.log(`目標：${cfg.boss_name}（報名論壇 ${cfg.signup_channel_id} → 行程表頻道 ${cfg.schedule_channel_id}）`);
console.log(`有紀錄的行程表訊息共 ${targets.length} 則：`);
for (const t of targets) console.log(`  - ${t.week} ${t.kind === 'legacy' ? `[舊紀錄: ${t.label}]` : '[使用中]'} message ${t.messageId}`);

if (!apply) {
  console.log('\n這是預覽，沒有改任何東西。確認無誤後加上 --yes 才會真的刪除並重建。');
  process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(process.env.DISCORD_TOKEN);

let deleted = 0;
let skipped = 0;
for (const t of targets) {
  let forget = false;
  try {
    const channel = await client.channels.fetch(t.channelId);
    const msg = await channel.messages.fetch(t.messageId);
    if (msg.author?.id !== client.user.id) {
      console.log(`  略過 ${t.messageId}：不是機器人發的訊息。`);
      skipped++;
      forget = true;
    } else {
      await msg.delete();
      deleted++;
      forget = true;
    }
  } catch (err) {
    if (err?.code === 10008) forget = true; // already gone
    else {
      console.error(`  無法處理 ${t.messageId}（${err?.code ?? err?.name}: ${err?.message}）— 保留紀錄，不重建。`);
      skipped++;
      await client.destroy();
      console.error('中止：有訊息無法確認，請先排除權限問題（Read Message History / Manage Messages）再重跑。');
      process.exit(1);
    }
  }
  if (forget) {
    if (t.kind === 'current') deleteScheduleMessage(cfg.signup_channel_id, t.week);
    else deleteLegacyScheduleRow(t.legacyKey.guild_id, t.legacyKey.boss_name, t.legacyKey.week_start_date);
  }
}
console.log(`已刪除 ${deleted} 則，略過 ${skipped} 則。重建中…`);

await syncBossSchedule(client, cfg);
const after = listScheduleMessages(cfg.signup_channel_id);
console.log(`完成：行程表頻道現在有 ${after.length} 則（${after.map((r) => r.week_start_date).join(', ')}）。`);
await client.destroy();
process.exit(0);
