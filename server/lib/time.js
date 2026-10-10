/**
 * Date and Time Utilities for Vietnam (Asia/Ho_Chi_Minh - UTC+7)
 */

export function vnParts() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).reduce((m, p) => (m[p.type] = p.value, m), {});
}

export function vnTodayStr() {
  const p = vnParts();
  return `${p.year}-${p.month}-${p.day}`;
}

export function vnTimeStr() {
  const p = vnParts();
  return `${p.hour}:${p.minute}`;
}

export function vnDateTimeStr() {
  return `${vnTodayStr()} ${vnTimeStr()}:00`;
}

export function prevMonthStr(month) {
  const [year, mm] = String(month || '').split('-').map(Number);
  if (!year || !mm) return '';
  const d = new Date(Date.UTC(year, mm - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

