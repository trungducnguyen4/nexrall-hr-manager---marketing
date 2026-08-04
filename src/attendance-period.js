// The accounting period is resolved in Vietnam time, independent of the
// browser's local timezone.  It is deliberately standalone for regression
// testing at the January and 01–10 boundaries.
export function attendanceClosingMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((all, part) => (all[part.type] = part.value, all), {});
  let year = Number(parts.year);
  let month = Number(parts.month);
  if (Number(parts.day) <= 10) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}
