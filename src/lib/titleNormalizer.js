// Best-effort auto-fix for near-miss thread titles, run ONLY at the moment
// a thread is created or edited (not during periodic scans — see
// index.js). Only attempted when the title fails the strict format in
// titleParser.js; if it already parses cleanly, this is never invoked.
//
// Handles, by construction rather than by special-casing each mistake:
//   - full-width digits / slash / colon / parens (９２１, ／, ：, （）)
//   - missing, extra, or oddly-placed whitespace
//   - a missing ｜ separator
//   - date / weekday-parens / time appearing in the wrong relative order
//   - a wrong or garbled weekday-in-parens (recomputed from the date, not
//     trusted from the original text)
//
// Strategy: normalize full-width→half-width across the whole string, find
// the date and time anywhere in it (order-independent), remove those
// spans (plus an optional weekday-parens block immediately following the
// date, and one separator character) from the string, and treat whatever
// remains — trimmed only at the outer edges, internal spacing untouched —
// as the name/status portion. This is deliberately not exhaustive: a name
// that itself happens to contain something date- or time-shaped could
// confuse it. When it can't find a valid date AND a valid time, it backs
// off entirely rather than guessing (see index.js for what happens then).

const FULLWIDTH_MAP = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '／': '/',
  '：': ':',
  '（': '(',
  '）': ')',
};

function normalizeWidth(str) {
  return [...str].map((ch) => FULLWIDTH_MAP[ch] ?? ch).join('');
}

const DATE_RE = /(\d{1,2})\/(\d{1,2})/;
const TIME_RE = /(\d{1,2}):(\d{2})/;
const SEP_RE = /[｜|]/;
const WEEKDAY_CHARS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * @param {string} rawTitle
 * @param {Date} referenceDate - "now", used the same way as titleParser's
 *   year-inference so the recomputed weekday is correct.
 * @returns {{ fixed: false } | { fixed: true, newTitle: string }}
 */
export function normalizeThreadTitle(rawTitle, referenceDate = new Date()) {
  const normalized = normalizeWidth(String(rawTitle));

  const dateMatch = DATE_RE.exec(normalized);
  if (!dateMatch) return { fixed: false };
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { fixed: false };

  const timeMatch = TIME_RE.exec(normalized);
  if (!timeMatch) return { fixed: false };
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return { fixed: false };

  const spans = [[dateMatch.index, dateMatch.index + dateMatch[0].length]];

  // An optional weekday-in-parens block immediately after the date
  // (allowing whitespace in between) — its content is discarded; the
  // weekday shown in the fixed title is always recomputed from the date.
  const afterDateStart = dateMatch.index + dateMatch[0].length;
  const gap = /^\s*/.exec(normalized.slice(afterDateStart))[0];
  const parenStart = afterDateStart + gap.length;
  const parenMatch = /^\(([^()]{0,10})\)/.exec(normalized.slice(parenStart));
  if (parenMatch) {
    spans.push([parenStart, parenStart + parenMatch[0].length]);
  }

  spans.push([timeMatch.index, timeMatch.index + timeMatch[0].length]);

  const sepMatch = SEP_RE.exec(normalized);
  if (sepMatch) {
    spans.push([sepMatch.index, sepMatch.index + 1]);
  }

  // Remove every matched span (descending order so earlier indices stay
  // valid), then trim only the outer edges — internal spacing in
  // whatever's left (the name/status text) is kept exactly as typed.
  spans.sort((a, b) => b[0] - a[0]);
  let leftover = normalized;
  for (const [start, end] of spans) {
    leftover = leftover.slice(0, start) + leftover.slice(end);
  }
  leftover = leftover.trim();

  if (!leftover) return { fixed: false }; // nothing usable left as name/status

  // Recompute the weekday from the validated date, same year-inference
  // rule as titleParser.js, rather than trusting the original text.
  const refYear = referenceDate.getFullYear();
  let dateObj = new Date(Date.UTC(refYear, month - 1, day, hour - 8, minute));
  const twoMonthsMs = 60 * 24 * 60 * 60 * 1000;
  if (dateObj.getTime() < referenceDate.getTime() - twoMonthsMs) {
    dateObj = new Date(Date.UTC(refYear + 1, month - 1, day, hour - 8, minute));
  }
  const twDate = new Date(dateObj.getTime() + 8 * 60 * 60 * 1000);
  const weekdayChar = WEEKDAY_CHARS[twDate.getUTCDay()];

  const pad2 = (n) => String(n).padStart(2, '0');
  const newTitle = `${pad2(month)}/${pad2(day)}(${weekdayChar}) ${pad2(hour)}:${pad2(minute)}｜${leftover}`;

  return { fixed: true, newTitle };
}
