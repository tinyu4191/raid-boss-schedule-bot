// Parses discussion-thread titles like:
//   08/20(三) 20:00｜缺2(劍士,弓箭手)
//   08/20(三) 20:00｜已滿
//   08/20(三) 20:00｜無敵樹王團(-2打手)
//   08/20(三) 20:00｜屠龍小隊
//   09/19(六) 14:00｜叭叭後面有樹王拓荒-兩法 -火
//
// Weekday text inside the parens after the date is not validated — it's for
// humans only.
//
// Status-text rule: the literal "已滿" means full, no name. Otherwise: if
// the text contains 缺 or -, everything from the FIRST such marker onward
// is kept and shown VERBATIM as the "missing" info — however the captain
// phrased it (Arabic numerals, Chinese numerals like 兩, multiple "-X -Y"
// segments, whatever) — and everything before that marker is the team
// name. There is deliberately no attempt to parse out a structured count
// or class list anymore: real usage varies too much for that to hold up,
// and passing the raw text through is both simpler and more robust. If the
// text contains NEITHER 缺 nor -, the whole thing is a team name and the
// team is read as full.
const TITLE_PREFIX_RE = /^(\d{1,2})\/(\d{1,2})\([^)]*\)\s*(\d{1,2}):(\d{2})\s*[｜|]\s*(.+)$/;
const MARKER_RE = /[-缺]/;

/**
 * @param {string} title - raw thread title
 * @param {Date} referenceDate - "now", used to infer the year
 * @returns {null | {
 *   date: Date,              // instant corresponding to the Asia/Taipei wall-clock time in the title
 *   isFull: boolean,
 *   missingText: string,     // raw text from the first 缺/- marker onward, '' if full
 *   teamName: string | null  // free text team name, if the captain gave one
 * }}
 */
export function parseThreadTitle(title, referenceDate = new Date()) {
  const prefixMatch = TITLE_PREFIX_RE.exec(String(title).trim());
  if (!prefixMatch) return null;

  const [, mm, dd, hh, min, statusRaw] = prefixMatch;
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(min);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  // Infer year from referenceDate. Taiwan is UTC+8 with no DST, so a TW
  // wall-clock time of (month, day, hour, minute) is UTC (hour-8).
  const refYear = referenceDate.getFullYear();
  let date = new Date(Date.UTC(refYear, month - 1, day, hour - 8, minute));

  // If that lands more than ~2 months before "now", assume it rolled into
  // next year (e.g. referenceDate is late Dec, title says early Jan).
  const twoMonthsMs = 60 * 24 * 60 * 60 * 1000;
  if (date.getTime() < referenceDate.getTime() - twoMonthsMs) {
    date = new Date(Date.UTC(refYear + 1, month - 1, day, hour - 8, minute));
  }

  const statusText = statusRaw.trim();

  let isFull;
  let missingText = '';
  let teamName = null;

  if (statusText === '已滿') {
    isFull = true;
  } else {
    const markerMatch = MARKER_RE.exec(statusText);
    if (!markerMatch) {
      // No 缺/- anywhere — the whole thing is a team name, read as full.
      isFull = true;
      teamName = statusText;
    } else {
      isFull = false;
      let idx = markerMatch.index;
      // If the marker is immediately preceded by '(', that paren belongs
      // to the missing-info chunk (it's wrapping "-2打手" as a whole), not
      // to the team name — e.g. "無敵樹王團(-2打手)" should split into
      // name="無敵樹王團" / missing="(-2打手)", not leave a dangling "(".
      if (idx > 0 && statusText[idx - 1] === '(') {
        idx -= 1;
      }
      teamName = statusText.slice(0, idx).trim() || null;
      missingText = statusText.slice(idx).trim();
    }
  }

  return { date, isFull, missingText, teamName };
}
