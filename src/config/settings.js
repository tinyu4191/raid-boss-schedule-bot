// Global (not per-boss) tunables, read from .env. Both are in minutes.
//
//   RAID_END_AFTER_MINUTES=120     a team counts as "已結束" (struck through
//                                  on the schedule) this long AFTER its raid
//                                  start time. 0 = strike as soon as it starts.
//   SCHEDULE_REFRESH_MINUTES=120   how often the bot re-checks this/last
//                                  week's schedule so those strikethroughs
//                                  appear without anyone touching a thread.
//                                  0 = off (only thread events + the daily
//                                  midnight resync update the schedule).
//
// Invalid values (not a number / negative) fall back to the defaults rather
// than silently turning the feature off.

function readMinutes(name, defaultMinutes, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultMinutes;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`[settings] ${name}="${raw}" is not a valid number of minutes (>= ${min}); using ${defaultMinutes}.`);
    return defaultMinutes;
  }
  return n;
}

export function getRaidEndAfterMs() {
  return readMinutes('RAID_END_AFTER_MINUTES', 120) * 60 * 1000;
}

/** 0 means disabled. Otherwise at least 5 minutes, to stay clear of Discord rate limits. */
export function getScheduleRefreshMs() {
  const minutes = readMinutes('SCHEDULE_REFRESH_MINUTES', 120);
  if (minutes === 0) return 0;
  return Math.max(minutes, 5) * 60 * 1000;
}
