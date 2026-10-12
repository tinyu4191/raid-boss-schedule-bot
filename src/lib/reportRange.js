import { getTaipeiToday, weekKeyOfTaipeiDate, getWeekStartKey, listWeekKeys, shiftWeekKey } from './weekUtils.js';

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

const MAX_CHOICES = 25; // Discord's limit for autocomplete results

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** "09/29～10/05（上週）" — years are added only when they differ from the current Taipei year. */
export function formatWeekChoiceLabel(weekKey, now = new Date()) {
  const [y, m, d] = weekKey.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  const thisYear = getTaipeiToday(now).y;
  const showYear = y !== thisYear || end.getUTCFullYear() !== thisYear;
  const startPart = `${showYear ? `${y}/` : ''}${pad2(m)}/${pad2(d)}`;
  const endPart = `${showYear ? `${end.getUTCFullYear()}/` : ''}${pad2(end.getUTCMonth() + 1)}/${pad2(end.getUTCDate())}`;

  const currentKey = getWeekStartKey(now);
  const lastKey = shiftWeekKey(currentKey, -1);
  const tag = weekKey === currentKey ? '（本週，進行中）' : weekKey === lastKey ? '（上週）' : '';
  return `${startPart}～${endPart}${tag}`;
}

/**
 * Choices for the start/end week dropdowns: the most recent weeks first
 * (newest at the top), filtered by whatever the user has typed. Typing a
 * date also surfaces that exact week, so weeks older than the list are
 * still reachable. `minKey` hides weeks before it (used for the "end"
 * dropdown once a start week has been picked).
 * @returns {Array<{ name: string, value: string }>} value is the week's Tuesday (YYYY-MM-DD)
 */
export function buildWeekChoices({ typed = '', minKey = null, now = new Date() } = {}) {
  const currentKey = getWeekStartKey(now);
  const floorKey = minKey && minKey <= currentKey ? minKey : null;

  const keys = [];
  for (let i = 0; i < MAX_CHOICES * 2 && keys.length < MAX_CHOICES * 2; i++) {
    const key = shiftWeekKey(currentKey, -i);
    if (floorKey && key < floorKey) break;
    keys.push(key);
  }

  let choices = keys.map((key) => ({ name: formatWeekChoiceLabel(key, now), value: key }));

  const text = String(typed).trim();
  if (text) {
    const parsed = parseUserDate(text, now);
    const exact = parsed ? weekKeyOfTaipeiDate(parsed.y, parsed.m, parsed.d) : null;
    const filtered = choices.filter((c) => c.name.includes(text) || c.value.includes(text));
    if (exact && exact <= currentKey && (!floorKey || exact >= floorKey)) {
      const exactChoice = { name: formatWeekChoiceLabel(exact, now), value: exact };
      choices = [exactChoice, ...filtered.filter((c) => c.value !== exact)];
    } else {
      choices = filtered;
    }
  }
  return choices.slice(0, MAX_CHOICES);
}
