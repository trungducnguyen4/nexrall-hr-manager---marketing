export function normalizeOvertimeItems(items, periodMonth, { allowFuture = false } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) return { error: 'Tháng làm thêm không hợp lệ' };
  if (!Array.isArray(items) || !items.length || items.length > 31) return { error: 'Form cần từ 1 đến 31 dòng làm thêm' };
  const seen = new Set();
  const normalized = [];
  const todayLocal = new Date();
  const todayDateStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`;
  const todayDate = new Date(todayDateStr + 'T00:00:00');
  for (const raw of items) {
    const startAt = String(raw?.start_at || '');
    const endAt = String(raw?.end_at || '');
    const reason = String(raw?.reason || '').trim();
    const category = ['workday', 'rest_day', 'holiday'].includes(raw?.time_category) ? raw.time_category : 'workday';
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endAt) || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return { error: 'Mỗi dòng OT phải có ngày giờ bắt đầu và kết thúc hợp lệ' };
    if (!startAt.startsWith(`${periodMonth}-`)) return { error: 'Ngày bắt đầu OT phải thuộc đúng tháng của form' };
    if (end <= start || end.valueOf() - start.valueOf() > 24 * 60 * 60 * 1000) return { error: 'Thời gian OT phải lớn hơn 0 và không quá 24 giờ' };
    if (!allowFuture && new Date(startAt.slice(0, 10) + 'T00:00:00').valueOf() > todayDate.valueOf()) return { error: 'Không thể khai báo OT trong tương lai' };
    if (!reason || reason.length > 1000) return { error: 'Lý do OT là bắt buộc và tối đa 1000 ký tự' };
    const key = `${startAt}|${endAt}`;
    if (seen.has(key)) return { error: 'Không được nhập hai dòng OT trùng thời gian' };
    seen.add(key);
    normalized.push({
      start_at: startAt,
      end_at: endAt,
      requested_minutes: Math.round((end - start) / 60000),
      reason,
      time_category: category,
      proof_url: raw?.proof_url ? String(raw.proof_url).trim().slice(0, 10000) : null,
    });
  }
  return { items: normalized };
}

export async function applyCalendarOvertimeCategories(env, items) {
  return Promise.all(items.map(async item => {
    const workDate = item.start_at.slice(0, 10);
    const holiday = await env.DB.prepare('SELECT id FROM company_holidays WHERE holiday_date=? AND is_active=1').bind(workDate).first();
    const weekday = new Date(`${workDate}T00:00:00`).getDay();
    return { ...item, time_category: holiday ? 'holiday' : (weekday === 0 || weekday === 6) ? 'rest_day' : item.time_category };
  }));
}
