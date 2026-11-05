/** Fills {placeholders} in a message template. Unknown placeholders are left visible so gaps are obvious. */
export function render(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] == null || vars[key] === '' ? match : String(vars[key]),
  );
}

/** Friendly date and time in the viewer's zone, e.g. "Thu 3 Dec, 2:30 pm (Asia/Kolkata)". */
export function whenText(iso, timeZone = 'Asia/Kolkata') {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone,
  }).format(new Date(iso));
}
