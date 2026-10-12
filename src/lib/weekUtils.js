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

/** Taipei wall-clock parts of a real Date: { weekday (0=Sun..6=Sat), hour, minute }. */
export function getTaipeiParts(date) {
  const tw = toTaipeiShifted(date);
  return { weekday: tw.getUTCDay(), hour: tw.getUTCHours(), minute: tw.getUTCMinutes() };
}

/** The week_start key (Tuesday, Taipei) of the week before the one containing `date`. */
export function getPreviousWeekStartKey(date) {
  const thisKey = getWeekStartKey(date);
  const [y, m, d] = thisKey.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 7));
  return formatDateKey(prev);
}

/** Shifts a week_start key by `weeks` (negative = earlier). */
export function shiftWeekKey(weekStartKey, weeks) {
  const [y, m, d] = weekStartKey.split('-').map(Number);
  return formatDateKey(new Date(Date.UTC(y, m - 1, d + weeks * 7)));
}

/**
 * A real Date safely inside the given week (Friday 12:00 Taipei) — used as
 * the reference date when parsing titles for a past week, so year
 * inference is right even across New Year.
 */
export function weekMidpoint(weekStartKey) {
  const [y, m, d] = weekStartKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 3, 12 - 8, 0));
}

/** The week_start key (Tuesday, Taipei) of the week containing the Taipei calendar date y-m-d. */
export function weekKeyOfTaipeiDate(y, m, d) {
  return getWeekStartKey(new Date(Date.UTC(y, m - 1, d, 12 - 8, 0))); // Taipei noon
}

/** Today's Taipei calendar date as { y, m, d }. */
export function getTaipeiToday(now = new Date()) {
  const tw = toTaipeiShifted(now);
  return { y: tw.getUTCFullYear(), m: tw.getUTCMonth() + 1, d: tw.getUTCDate() };
}

/** Every week_start key from startKey to endKey, inclusive. */
export function listWeekKeys(startKey, endKey) {
  const keys = [];
  for (let k = startKey; k <= endKey; k = shiftWeekKey(k, 1)) keys.push(k); // YYYY-MM-DD sorts lexicographically
  return keys;
}

/** "2026/09/29 (二) ～ 2026/10/26 (一)" — a multi-week range, with years. */
export function getRangeLabel(startKey, endKey) {
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const end = new Date(Date.UTC(ey, em - 1, ed + 6));
  const fmt = (y, m, d) => `${y}/${pad2(m)}/${pad2(d)}`;
  return `${fmt(sy, sm, sd)} (二) ～ ${fmt(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate())} (一)`;
}
