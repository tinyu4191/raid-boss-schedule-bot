import { getTaipeiToday, weekKeyOfTaipeiDate, getWeekStartKey, listWeekKeys } from './weekUtils.js';

export const MAX_RANGE_WEEKS = 53;

/**
 * Parses a user-typed date: "2026-09-29", "2026/9/29", or "9/29" / "09-29"
 * (year omitted). Without a year it means the current Taipei year, unless
 * that lands more than ~6 months in the future, in which case it means the
 * previous year (typing "12/15" in January means last December).
 * @returns {{ y: number, m: number, d: number } | null}
 */
export function parseUserDate(input, now = new Date()) {
  const m = /^\s*(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})\s*$/.exec(String(input));
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  let year = m[1] ? Number(m[1]) : getTaipeiToday(now).y;

  const valid = (y) => {
    const dt = new Date(Date.UTC(y, month - 1, day));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
  };
  if (!valid(year)) return null;

  if (!m[1]) {
    const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
    if (Date.UTC(year, month - 1, day) - now.getTime() > sixMonthsMs && valid(year - 1)) year -= 1;
  }
  return { y: year, m: month, d: day };
}

/**
 * Turns two user-typed dates into an inclusive range of weeks (Tue–Mon):
 * each date selects the week that CONTAINS it.
 * @returns {{ ok: true, startKey: string, endKey: string, weekCount: number, includesCurrentWeek: boolean }
 *          | { ok: false, error: string }}
 */
export function resolveWeekRange(startInput, endInput, now = new Date()) {
  const s = parseUserDate(startInput, now);
  if (!s) return { ok: false, error: `看不懂起始日期「${startInput}」，請輸入像 \`2026-09-29\` 或 \`9/29\`（該週內任何一天都可以）` };
  const e = parseUserDate(endInput, now);
  if (!e) return { ok: false, error: `看不懂結束日期「${endInput}」，請輸入像 \`2026-10-26\` 或 \`10/26\`（該週內任何一天都可以）` };

  const startKey = weekKeyOfTaipeiDate(s.y, s.m, s.d);
  const endKey = weekKeyOfTaipeiDate(e.y, e.m, e.d);
  const currentKey = getWeekStartKey(now);

  if (startKey > endKey) return { ok: false, error: '起始週晚於結束週，請對調或重新輸入' };
  if (startKey > currentKey) return { ok: false, error: '起始週還沒開始，沒有資料可以統計' };
  const weekCount = listWeekKeys(startKey, endKey).length;
  if (weekCount > MAX_RANGE_WEEKS) return { ok: false, error: `範圍太長（${weekCount} 週），上限 ${MAX_RANGE_WEEKS} 週` };

  return { ok: true, startKey, endKey, weekCount, includesCurrentWeek: endKey >= currentKey };
}
