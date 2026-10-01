// The current calendar month is resolved in Vietnam time, independent of the
// browser's local timezone.
export function attendanceClosingMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((all, part) => (all[part.type] = part.value, all), {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  return `${year}-${String(month).padStart(2, '0')}`;
}
