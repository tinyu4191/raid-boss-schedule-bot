// Parses discussion-thread titles like:
//   08/20(三) 20:00｜缺2(劍士,弓箭手)     -- 舊格式，無團名
//   08/20(三) 20:00｜已滿                -- 舊格式，無團名
//   08/20(三) 20:00｜無敵樹王團(-2打手)   -- 新格式，有團名 + 缺人
//   08/20(三) 20:00｜屠龍小隊             -- 新格式，有團名，沒有「缺」或「-」就代表已滿
//
// Weekday text inside the parens after the date is not validated — it's for
// humans only.
//
// Rule for the free-text status (anything after ｜ that isn't the literal
// "已滿"): if it contains 缺 or -, it's read as "<團名><缺N(職業)>" (團名
// optional). Otherwise the whole text is treated as a full team's name.
const TITLE_PREFIX_RE = /^(\d{1,2})\/(\d{1,2})\([^)]*\)\s*(\d{1,2}):(\d{2})\s*[｜|]\s*(.+)$/;

// Old format, checked first and as its own exact/anchored pattern: "缺N(職
// 業...)" with NO team name, where the parens wrap only the class list
// (they sit right after the digit). This must be tried before MISSING_RE
// below, or MISSING_RE would misparse the parens as part of a team name
// section instead.
const OLD_MISSING_RE = /^缺\s*(\d+)\s*\(([^)]*)\)$/;

// New format: optional team name + a missing-marker (缺 or -) + digit +
// optional class list, with the marker's parens (if any) wrapping the
// marker itself rather than just the classes:
//   "無敵樹王團(-2打手)"  -> name="無敵樹王團", count=2, classes="打手"
//   "無敵樹王團-2打手"    -> same, without parens
// Classes deliberately excludes '(' as well as ')', so this can't
// accidentally swallow a stray paren from the old-format structure above.
const MISSING_RE = /^(.*?)\(?[-缺]\s*(\d+)\s*([^()]*?)\)?\s*$/;

/**
 * @param {string} title - raw thread title
 * @param {Date} referenceDate - "now", used to infer the year
 * @returns {null | {
 *   date: Date,             // instant corresponding to the Asia/Taipei wall-clock time in the title
 *   isFull: boolean,
 *   missingCount: number,
 *   missingClasses: string[], // free text, exactly as the captain typed it
 *   teamName: string | null   // free text team name, if the captain gave one
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
  let missingCount = 0;
  let missingClasses = [];
  let teamName = null;

  if (statusText === '已滿') {
    isFull = true;
  } else {
    const oldMatch = OLD_MISSING_RE.exec(statusText);
    if (oldMatch) {
      isFull = false;
      missingCount = Number(oldMatch[1]);
      missingClasses = oldMatch[2].split(',').map((s) => s.trim()).filter(Boolean);
      // teamName stays null — old format never has one.
    } else if (!statusText.includes('缺') && !statusText.includes('-')) {
      // No missing-marker at all — the whole thing is a team name, and a
      // named team with no 缺/- is read as full.
      isFull = true;
      teamName = statusText;
    } else {
      const missingMatch = MISSING_RE.exec(statusText);
      if (!missingMatch) return null; // has 缺/- but doesn't parse — ignore silently

      const [, namePart, countRaw, classesRaw] = missingMatch;
      isFull = false;
      missingCount = Number(countRaw);
      missingClasses = classesRaw.split(',').map((s) => s.trim()).filter(Boolean);
      teamName = namePart.trim() || null;
    }
  }

  return { date, isFull, missingCount, missingClasses, teamName };
}
