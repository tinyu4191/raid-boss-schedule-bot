// All week math is done in Asia/Taipei (UTC+8, no DST), regardless of the
// host machine's timezone — the bot's deployment location doesn't matter.
const TW_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAY_CHARS = ['日', '一', '二', '三', '四', '五', '六'];

// Shifts a real Date so that reading it with the UTC* getters returns the
// Asia/Taipei wall-clock components.
function toTaipeiShifted(date) {
  return new Date(date.getTime() + TW_OFFSET_MS);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(shiftedUtcDate) {
  const y = shiftedUtcDate.getUTCFullYear();
  const m = pad2(shiftedUtcDate.getUTCMonth() + 1);
  const d = pad2(shiftedUtcDate.getUTCDate());
  return `${y}-${m}-${d}`;
}

/** Returns the YYYY-MM-DD (Taipei) of the Tuesday that starts the week containing `date`. */
export function getWeekStartKey(date) {
  const tw = toTaipeiShifted(date);
  const weekday = tw.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceTuesday = (weekday - 2 + 7) % 7;
  const tuesday = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate() - daysSinceTuesday));
  return formatDateKey(tuesday);
}

/** "08/18 (二) ～ 08/24 (一)" for a given week_start_date key. */
export function getWeekRangeLabel(weekStartKey) {
  const [y, m, d] = weekStartKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (dt) => `${pad2(dt.getUTCMonth() + 1)}/${pad2(dt.getUTCDate())}`;
  return `${fmt(start)} (二) ～ ${fmt(end)} (一)`;
}

/** "08/20 (三)" for a thread's parsed date. */
export function formatTaipeiDateHeader(date) {
  const tw = toTaipeiShifted(date);
  return `${pad2(tw.getUTCMonth() + 1)}/${pad2(tw.getUTCDate())} (${WEEKDAY_CHARS[tw.getUTCDay()]})`;
}

/** "20:00" for a thread's parsed date. */
export function formatTaipeiTime(date) {
  const tw = toTaipeiShifted(date);
  return `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}`;
}

export function isPast(date, now = new Date()) {
  return date.getTime() < now.getTime();
}

/**
 * Milliseconds from `now` until the next Asia/Taipei 00:00 boundary. Used
 * to schedule the daily full resync (see index.js) that catches entries
 * which crossed into "已結束" overnight with no thread activity to trigger
 * a normal sync.
 */
export function msUntilNextTaipeiMidnight(now = new Date()) {
  const tw = toTaipeiShifted(now);
  const nextMidnightTaipei = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate() + 1, 0, 0, 0, 0));
  const nextMidnightReal = new Date(nextMidnightTaipei.getTime() - TW_OFFSET_MS);
  return nextMidnightReal.getTime() - now.getTime();
}
