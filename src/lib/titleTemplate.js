// Fills in {placeholder} tokens in a custom title/text template, used by
// BOSS_<n>_SCHEDULE_TITLE / EMPTY_TEXT / REMINDER_TITLE (see
// config/bosses.js). An unrecognized {placeholder} is left in the output
// as-is rather than silently dropped, so a typo in a custom template
// shows up visibly instead of quietly disappearing.
export function applyTitleTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}
