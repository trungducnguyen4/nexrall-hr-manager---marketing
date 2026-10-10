/**
 * Attendance & Geofence Service
 * Quản lý chấm công GPS, geofence, đăng ký ca/WFH, duyệt 2 bước WFH, và tổng hợp ngày công
 */

export const ATT_STANDARD_SHIFTS = {
  morning:   { start: '08:30', lateAfter: '08:35', end: '12:00' },
  afternoon: { start: '13:30', lateAfter: '13:35', end: '17:00' },
  full:      { start: '08:30', lateAfter: '08:35', end: '17:00' },
};

export const ATT_EARLY_CHECKOUT_TOLERANCE_MINUTES = 10;
export const PENALTY_POLICY_EFFECTIVE_MONTH = '2026-05';
export const LATE_PENALTY_NOTE_EFFECTIVE_MONTH = '2026-10';

export async function resolveLatePenaltyNote(env, userId, dateStr, lateMinutes, existingId = null, userCustomNote = '') {
  const customStr = String(userCustomNote || '').trim();
  const cleanedCustom = customStr
    .replace(/Đi muộn \d+p\s*\(Lần \d+\s*-\s*[^)]+\)\s*([|–-]\s*)?/gi, '')
    .trim();

  if (!dateStr || Number(lateMinutes || 0) <= 0) {
    return cleanedCustom;
  }
  const month = String(dateStr).slice(0, 7);
  if (month < LATE_PENALTY_NOTE_EFFECTIVE_MONTH) {
    return customStr;
  }

  try {
    let countSql = `SELECT COUNT(*) as count FROM attendance 
      WHERE user_id = ? 
        AND date LIKE ? 
        AND date <= ?
        AND COALESCE(late_minutes, 0) > 0 
        AND status NOT IN ('cancelled', 'rejected')`;
    const binds = [userId, `${month}-%`, dateStr];
    if (existingId) {
      countSql += ` AND id != ?`;
      binds.push(existingId);
    }
    const row = await env.DB.prepare(countSql).bind(...binds).first();
    const priorCount = Number(row?.count || 0);
    const lateIndex = priorCount + 1;

    const penaltyTag = lateIndex <= 2
      ? `Đi muộn ${lateMinutes}p (Lần ${lateIndex} - Miễn phạt)`
      : `Đi muộn ${lateMinutes}p (Lần ${lateIndex} - Phạt: 20.000đ)`;

    return cleanedCustom ? `${penaltyTag} | ${cleanedCustom}` : penaltyTag;
  } catch (err) {
    console.error('Error resolving late penalty note:', err);
    return customStr;
  }
}

export function geoDistanceMeters(lat1, lng1, lat2, lng2) {
  const r = 6371000, toRad = value => Number(value) * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function geofenceDecision(distanceMeters, radiusMeters) {
  const distance = Number(distanceMeters);
  const radius = Number(radiusMeters);
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0) return { inside: false, outside_meters: null };
  const inside = distance <= radius;
  return { inside, outside_meters: Math.max(0, distance - radius) };
}

export function attToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function attIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function attCountBusinessDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function attCountBusinessDaysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export async function isAttendanceWorkingDay(env, dateStr, employee = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const holiday = await env.DB.prepare('SELECT id FROM company_holidays WHERE holiday_date=? AND is_active=1').bind(dateStr).first();
  if (holiday) return false;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return true;
}

export async function attBusinessDaysBetweenAsync(env, startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = attIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (await isAttendanceWorkingDay(env, iso)) count++;
  }
  return count;
}

export async function getDynamicShiftBounds(env, workType, shift, expectedStart, expectedEnd) {
  const std = ATT_STANDARD_SHIFTS[shift] || ATT_STANDARD_SHIFTS.full;
  if (workType === 'business') {
    const start = expectedStart || std.start;
    const end = expectedEnd || std.end;
    return { start, lateAfter: start, end };
  }
  if (!env?.DB) return std;
  try {
    const rows = await env.DB.prepare(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('work_start', 'work_end', 'late_threshold')"
    ).all().then(r => r.results || []);
    const cfg = {};
    for (const r of rows) cfg[r.setting_key] = r.setting_value;
    const workStart = cfg.work_start || std.start;
    const workEnd = cfg.work_end || std.end;
    const lateThreshold = (Number(cfg.late_threshold) >= 5) ? Number(cfg.late_threshold) : 5;

    if (shift === 'morning') {
      const startMin = attToMinutes(workStart) ?? 510;
      const lateAfterMin = startMin + lateThreshold;
      const lateAfterStr = `${String(Math.floor(lateAfterMin / 60)).padStart(2, '0')}:${String(lateAfterMin % 60).padStart(2, '0')}`;
      return { start: workStart, lateAfter: lateAfterStr, end: '12:00' };
    } else if (shift === 'afternoon') {
      const startMin = 13 * 60 + 30;
      const lateAfterMin = startMin + lateThreshold;
      const lateAfterStr = `${String(Math.floor(lateAfterMin / 60)).padStart(2, '0')}:${String(lateAfterMin % 60).padStart(2, '0')}`;
      return { start: '13:30', lateAfter: lateAfterStr, end: workEnd };
    } else {
      const startMin = attToMinutes(workStart) ?? 510;
      const lateAfterMin = startMin + lateThreshold;
      const lateAfterStr = `${String(Math.floor(lateAfterMin / 60)).padStart(2, '0')}:${String(lateAfterMin % 60).padStart(2, '0')}`;
      return { start: workStart, lateAfter: lateAfterStr, end: workEnd };
    }
  } catch (_) {
    return std;
  }
}

export function attShiftBounds(workType, shift, expectedStart, expectedEnd) {
  const std = ATT_STANDARD_SHIFTS[shift] || ATT_STANDARD_SHIFTS.full;
  if (workType === 'business') {
    const start = expectedStart || std.start;
    const end = expectedEnd || std.end;
    return { start, lateAfter: start, end };
  }
  return std;
}

export function attTimeIsValid(value) {
  const minutes = attToMinutes(value);
  return minutes !== null && minutes >= 0 && minutes < 24 * 60 && /^\d{2}:\d{2}$/.test(String(value || ''));
}

export function attEarlyCheckoutMinutes(bounds, checkoutTime) {
  const end = attToMinutes(bounds.end);
  const checkout = attToMinutes(checkoutTime);
  if (end === null || checkout === null) return 0;
  return Math.max(0, end - checkout - ATT_EARLY_CHECKOUT_TOLERANCE_MINUTES);
}

export function attManualTimingMetrics(record, checkinTime, checkoutTime, customBounds = null) {
  const bounds = customBounds || attShiftBounds(record.work_type || 'office', record.shift || 'full', record.expected_start, record.expected_end);
  const checkinMinutes = attToMinutes(checkinTime);
  const checkoutMinutes = attToMinutes(checkoutTime);
  const lateMinutes = checkinMinutes === null ? 0 : Math.max(0, checkinMinutes - attToMinutes(bounds.lateAfter));
  const earlyMinutes = checkoutMinutes === null ? 0 : attEarlyCheckoutMinutes(bounds, checkoutTime);
  let workedMinutes = checkinMinutes === null || checkoutMinutes === null ? 0 : Math.max(0, checkoutMinutes - checkinMinutes);
  if (checkinMinutes !== null && checkoutMinutes !== null && (record.work_type || 'office') !== 'business' && (record.shift || 'full') === 'full') {
    const lunchStart = 12 * 60, lunchEnd = 13 * 60 + 30;
    workedMinutes -= Math.max(0, Math.min(checkoutMinutes, lunchEnd) - Math.max(checkinMinutes, lunchStart));
  }
  return { bounds, lateMinutes, earlyMinutes, workHours: Math.max(0, workedMinutes) / 60 };
}

export async function ensureAttendanceLocationSchema(env) {
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS attendance_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, address TEXT,
      latitude REAL NOT NULL, longitude REAL NOT NULL, radius_meters INTEGER NOT NULL DEFAULT 100,
      max_accuracy_meters INTEGER NOT NULL DEFAULT 100, is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();
  } catch (error) {
    console.error('Unable to create attendance_locations schema', error);
    return false;
  }
  try { await env.DB.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_locations_code ON attendance_locations(code) WHERE code IS NOT NULL'); } catch (_) {}
  try {
    const seedMarker = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='attendance_locations_seeded'").first();
    if (!seedMarker) {
      const countRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM attendance_locations').first();
      if (!countRow || countRow.cnt === 0) {
        await env.DB.prepare(`INSERT INTO attendance_locations
          (name,code,address,latitude,longitude,radius_meters,max_accuracy_meters,is_active)
          SELECT ?,?,?,?,?,?,?,1
           WHERE NOT EXISTS (SELECT 1 FROM attendance_locations WHERE code=? OR name=?)`)
          .bind('Văn phòng HCM (Toà nhà UNIASIA)', 'NETVIET-HCM', 'Toà nhà UNIASIA, A8 Trường Sơn, Phường Tân Sơn Hòa, Quận Tân Bình, TP. Hồ Chí Minh', 10.804915, 106.664816, 150, 120, 'NETVIET-HCM', 'Văn phòng HCM (Toà nhà UNIASIA)')
          .run();
        await env.DB.prepare(`INSERT INTO attendance_locations
          (name,code,address,latitude,longitude,radius_meters,max_accuracy_meters,is_active)
          SELECT ?,?,?,?,?,?,?,1
           WHERE NOT EXISTS (SELECT 1 FROM attendance_locations WHERE code=? OR name=?)`)
          .bind('Văn phòng Hà Nội', 'NETVIET-HN', 'Hà Nội', 21.018472, 105.793595, 100, 100, 'NETVIET-HN', 'Văn phòng Hà Nội')
          .run();
        await env.DB.prepare(`INSERT INTO attendance_locations
          (name,code,address,latitude,longitude,radius_meters,max_accuracy_meters,is_active)
          SELECT ?,?,?,?,?,?,?,1
           WHERE NOT EXISTS (SELECT 1 FROM attendance_locations WHERE code=? OR name=?)`)
          .bind('Phim Trường NetVietTv', 'NETVIET-Q9', '76 D12, Khu đô thị mới Đông Tăng Long, Long Phước, Hồ Chí Minh 70000', 10.814200, 106.819500, 200, 150, 'NETVIET-Q9', 'Phim Trường NetVietTv')
          .run();
      }
      await env.DB.prepare("INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES ('attendance_locations_seeded','1')").run();
    }
  } catch (error) {
    console.error('Unable to seed attendance locations', error);
  }
  for (const column of ['checkin_location_id INTEGER','checkout_location_id INTEGER','checkin_distance_meters REAL','checkout_distance_meters REAL','checkin_accuracy_meters REAL','checkout_accuracy_meters REAL','checkin_verification_method TEXT','checkout_verification_method TEXT','checkin_lat REAL','checkin_lng REAL','checkout_lat REAL','checkout_lng REAL','checkin_geofence_status TEXT','checkout_geofence_status TEXT','checkin_requires_review INTEGER DEFAULT 0','checkin_review_status TEXT DEFAULT \'none\'','checkin_reviewed_by INTEGER','checkin_review_note TEXT','checkin_reviewed_at TEXT','checkout_requires_review INTEGER DEFAULT 0','checkout_review_status TEXT DEFAULT \'none\'','checkout_reviewed_by INTEGER','checkout_review_note TEXT','checkout_reviewed_at TEXT']) {
    try { await env.DB.exec(`ALTER TABLE attendance ADD COLUMN ${column}`); } catch (_) {}
  }
  return true;
}

export async function isGpsConstraintEnabled(env) {
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='attendance_gps_constraint'").first();
    return String(row?.setting_value ?? '1') !== '0';
  } catch (_) {
    return true;
  }
}

export async function verifyAttendanceGeofence(env, payload = {}) {
  if (!(await ensureAttendanceLocationSchema(env))) {
    return { status: 'unavailable', reason: 'Chưa thể khởi tạo dữ liệu địa điểm chấm công' };
  }
  const latitude = Number(payload.latitude), longitude = Number(payload.longitude);
  const rawAccuracy = payload.accuracy === undefined || payload.accuracy === null || payload.accuracy === '' ? null : Number(payload.accuracy);
  const accuracy = rawAccuracy === null ? 0 : rawAccuracy;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { status: 'unavailable', reason: 'Chưa nhận được vị trí GPS hợp lệ' };
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return { status: 'invalid', reason: 'Tọa độ GPS ngoài phạm vi hợp lệ' };
  if (!Number.isFinite(accuracy) || accuracy < 0) return { status: 'invalid', reason: 'Độ chính xác GPS không hợp lệ' };
  const { results: locations = [] } = await env.DB.prepare('SELECT * FROM attendance_locations WHERE is_active=1').all();
  if (!locations.length) return { status: 'not_configured', reason: 'Chưa cấu hình địa điểm GPS' };
  const ranked = locations.map(location => ({ ...location, distance_meters: geoDistanceMeters(latitude, longitude, location.latitude, location.longitude) })).sort((a,b) => a.distance_meters - b.distance_meters);
  const location = ranked[0];
  const radius = Number(location.radius_meters || 100);
  const decision = geofenceDecision(location.distance_meters, radius);
  const base = { location, accuracy_meters: accuracy, distance_meters: location.distance_meters, inside_geofence: decision.inside, outside_meters: decision.outside_meters };
  if (decision.inside) return { status: 'verified', ...base };
  return { status: 'outside', ...base, reason: 'Bạn ở ngoài khu vực chấm công' };
}

export async function runAutoCheckout(env) {
  const now = new Date(Date.now() + 7 * 3600000);
  const today = now.toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT * FROM attendance
      WHERE checkin_time IS NOT NULL
        AND checkout_time IS NULL
        AND date < ?
        AND status NOT IN ('absent','cancelled','rejected','leave')`
  ).bind(today).all().then(r => r.results || []);

  let closed = 0;
  for (const record of rows) {
    const shift = record.shift || 'full';
    const workType = record.work_type || 'office';
    const bounds = attShiftBounds(workType, shift, record.expected_start, record.expected_end);
    const endMin = attToMinutes(bounds.end) ?? (shift === 'morning' ? 12 * 60 : 17 * 60);
    const ciMin = attToMinutes(record.checkin_time) ?? attToMinutes(bounds.start);
    let workMinutes = Math.max(0, endMin - ciMin);
    if (workType !== 'business' && shift === 'full') {
      const lunchStart = 12 * 60, lunchEnd = 13 * 60 + 30;
      const overlap = Math.max(0, Math.min(endMin, lunchEnd) - Math.max(ciMin, lunchStart));
      workMinutes -= overlap;
    }
    const workHours = Math.max(0, workMinutes) / 60;
    const checkoutTime = bounds.end;
    const note = record.note ? `${record.note} (Quên checkout)` : 'Quên checkout';
    await env.DB.prepare(
      `UPDATE attendance
        SET checkout_time = ?, work_hours = ?, note = ?, auto_checkout = 1
        WHERE id = ?`
    ).bind(checkoutTime, workHours, note, record.id).run();
    closed++;
  }
  return { closed };
}

export async function syncTodayLateRecords(env, dateStr = null) {
  if (!env?.DB) return { updated: 0 };
  const today = dateStr || (new Date(Date.now() + 7 * 3600000)).toISOString().slice(0, 10);
  if (today < LATE_PENALTY_NOTE_EFFECTIVE_MONTH) return { updated: 0 };

  try {
    const { results = [] } = await env.DB.prepare(
      `SELECT * FROM attendance 
       WHERE date = ? 
         AND checkin_time IS NOT NULL 
         AND status NOT IN ('absent', 'cancelled', 'rejected', 'leave')`
    ).bind(today).all();

    let updated = 0;
    for (const row of results) {
      const workType = row.work_type || 'office';
      const shift = row.shift || 'full';
      const bounds = await getDynamicShiftBounds(env, workType, shift, row.expected_start, row.expected_end);
      const ciMinutes = attToMinutes(row.checkin_time);
      const lateAfterMinutes = attToMinutes(bounds.lateAfter);
      if (ciMinutes === null || lateAfterMinutes === null) continue;

      const calcLateMinutes = Math.max(0, ciMinutes - lateAfterMinutes);
      const expectedStatus = calcLateMinutes > 0 ? 'late' : (row.status === 'late' ? 'present' : row.status);

      if (calcLateMinutes !== Number(row.late_minutes || 0) || (calcLateMinutes > 0 && row.status === 'present') || (calcLateMinutes === 0 && row.status === 'late')) {
        const finalNote = await resolveLatePenaltyNote(env, row.user_id, today, calcLateMinutes, row.id, row.note || '');
        await env.DB.prepare(
          'UPDATE attendance SET late_minutes = ?, status = ?, note = ? WHERE id = ?'
        ).bind(calcLateMinutes, expectedStatus, finalNote, row.id).run();
        updated++;
      }
    }
    return { updated };
  } catch (err) {
    console.error('syncTodayLateRecords error:', err);
    return { updated: 0, error: err.message };
  }
}

export async function buildMonthlyWorkSummary(env, userId, month, year) {
  const mm = String(month).padStart(2, '0');
  const { results = [] } = await env.DB.prepare(
    "SELECT * FROM attendance WHERE user_id=? AND strftime('%m',date)=? AND strftime('%Y',date)=?"
  ).bind(userId, mm, String(year)).all();

  let fullDays = 0;
  let halfDays = 0;
  let incompleteDays = 0;
  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let absentDays = 0;
  let lateDays = 0;

  for (const r of results) {
    if (r.status === 'cancelled' || r.status === 'rejected') continue;
    if (r.status === 'absent') {
      absentDays++;
      continue;
    }
    const hasIn = !!r.checkin_time;
    const hasOut = !!r.checkout_time;
    if (!hasIn || !hasOut) {
      incompleteDays++;
      continue;
    }
    if (r.shift === 'morning' || r.shift === 'afternoon') halfDays++;
    else fullDays++;
    const late = Number(r.late_minutes || 0);
    const early = Number(r.early_minutes || 0);
    lateMinutes += late;
    earlyLeaveMinutes += early;
    if (late > 0) lateDays++;
  }

  let paidLeaveDays = 0;
  const monthStart = attIsoDate(year, month, 1);
  const monthEnd = attIsoDate(year, month, new Date(year, month, 0).getDate());
  try {
    const { results: leaves = [] } = await env.DB.prepare(
      `SELECT lr.start_date, lr.end_date FROM leave_requests lr
       LEFT JOIN leave_types lt ON lr.type = lt.code
       WHERE (CAST(lr.user_id AS TEXT) = CAST(? AS TEXT) OR lr.employee_id = ?)
         AND lr.status = 'approved'
         AND COALESCE(lt.paid_policy, 'paid') = 'paid'
         AND date(lr.start_date) <= date(?)
         AND date(lr.end_date) >= date(?)`
    ).bind(userId, userId, monthEnd, monthStart).all();

    for (const leave of leaves) {
      const s = String(leave.start_date) > monthStart ? String(leave.start_date) : monthStart;
      const e = String(leave.end_date) < monthEnd ? String(leave.end_date) : monthEnd;
      paidLeaveDays += attCountBusinessDaysBetween(s, e);
    }
  } catch (_) {}

  let approvedOvertimeMinutes = 0;
  let approvedOvertimeHours = 0;
  try {
    const { results: legacyResults = [] } = await env.DB.prepare(
      "SELECT work_date, COALESCE(approved_minutes, requested_minutes, 0) AS approved_minutes FROM overtime_requests WHERE (user_id=? OR CAST(user_id AS TEXT)=CAST(? AS TEXT)) AND status='approved' AND strftime('%m',work_date)=? AND strftime('%Y',work_date)=?"
    ).bind(userId, userId, mm, String(year)).all();
    const { results: formResults = [] } = await env.DB.prepare(
      `SELECT substr(i.start_at,1,10) AS work_date,
              COALESCE(NULLIF(i.approved_minutes, 0), i.requested_minutes, 0) AS approved_minutes,
              i.time_category
         FROM overtime_form_items i JOIN overtime_forms f ON f.id=i.form_id
        WHERE (f.user_id=? OR CAST(f.user_id AS TEXT)=CAST(? AS TEXT))
          AND f.status IN ('approved','partially_approved')
          AND strftime('%m',substr(i.start_at,1,10))=? AND strftime('%Y',substr(i.start_at,1,10))=?`
    ).bind(userId, userId, mm, String(year)).all();
    for (const item of [...legacyResults, ...formResults]) {
      approvedOvertimeMinutes += Math.max(0, Number(item.approved_minutes || 0));
    }
    approvedOvertimeHours = approvedOvertimeMinutes / 60;
  } catch (_) {}

  const standardWorkDays = attCountBusinessDays(year, month);
  const actualWorkDays = fullDays + halfDays * 0.5;

  return {
    userId,
    month,
    year,
    standardWorkDays,
    actualWorkDays,
    fullDays,
    halfDays,
    incompleteDays,
    paidLeaveDays,
    absentDays,
    lateDays,
    lateMinutes,
    earlyLeaveMinutes,
    approvedOvertimeMinutes,
    approvedOvertimeHours,
    recordCount: results.length,
  };
}

export const AttendanceService = {
  async list(env, url, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns }) {
    await runAutoCheckout(env).catch(() => {});
    await syncTodayLateRecords(env).catch(() => {});
    const userId = url.searchParams.get('userId');
    const month = url.searchParams.get('month');
    const year = url.searchParams.get('year');
    const date = url.searchParams.get('date');
    let q = `SELECT a.*, u.full_name, u.employee_code, u.department,
      (SELECT status FROM overtime_requests o WHERE o.attendance_id=a.id) AS overtime_status,
      (SELECT approved_minutes FROM overtime_requests o WHERE o.attendance_id=a.id) AS approved_overtime_minutes,
      (SELECT review_note FROM overtime_requests o WHERE o.attendance_id=a.id) AS overtime_review_note
      FROM attendance a JOIN users u ON a.user_id=u.id WHERE 1=1`;
    const binds = [];
    if (!isAttendanceAdmin) { q += ' AND a.user_id=?'; binds.push(me.id); }
    else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns) { q += ' AND u.department=?'; binds.push(me.department); }
    else if (userId) { q += ' AND a.user_id=?'; binds.push(parseInt(userId)); }
    if (date) { q += ' AND a.date=?'; binds.push(date); }
    else if (month && year) {
      q += " AND strftime('%m',a.date)=? AND strftime('%Y',a.date)=?";
      binds.push(String(month).padStart(2,'0'), String(year));
    } else if (month) {
      q += ' AND a.date LIKE ?'; binds.push('%-' + String(month).padStart(2,'0') + '-%');
    }
    q += ' ORDER BY a.date DESC';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return { attendance: results || [] };
  },

  async listEmployees(env, url, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns, sortVietnameseNames, vnTodayStr }) {
    if (!isAttendanceAdmin) return { error: 'Không có quyền', status: 403 };
    const date = String(url.searchParams.get('date') || '');
    const month = parseInt(url.searchParams.get('month'));
    const year = parseInt(url.searchParams.get('year'));
    let from = String(url.searchParams.get('from') || '');
    let to = String(url.searchParams.get('to') || '');
    if (date) {
      from = date;
      to = date;
    } else if (!from || !to) {
      const now = new Date();
      const resolvedYear = year || now.getFullYear();
      const resolvedMonth = month || (now.getMonth() + 1);
      if (resolvedMonth < 1 || resolvedMonth > 12) return { error: 'Tháng không hợp lệ', status: 400 };
      from = attIsoDate(resolvedYear, resolvedMonth, 1);
      to = attIsoDate(resolvedYear, resolvedMonth, new Date(resolvedYear, resolvedMonth, 0).getDate());
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return { error: 'Khoảng ngày không hợp lệ', status: 400 };
    }
    let q = `SELECT u.id AS user_id,u.full_name,u.employee_code,u.department,u.position,u.work_location,
      COUNT(a.id) AS record_count,
      COALESCE(SUM(CASE WHEN a.checkin_time IS NOT NULL AND a.checkout_time IS NOT NULL AND a.status NOT IN ('absent','cancelled','rejected') AND (a.work_type != 'wfh' OR COALESCE(a.wfh_status,'') != 'rejected') THEN CASE WHEN a.shift IN ('morning','afternoon') THEN 0.5 ELSE 1 END ELSE 0 END),0) AS actual_work_days,
      COALESCE(SUM(CASE WHEN a.checkin_time IS NOT NULL AND a.checkout_time IS NOT NULL AND a.status NOT IN ('absent','cancelled','rejected') AND (a.work_type != 'wfh' OR COALESCE(a.wfh_status,'') != 'rejected') THEN a.work_hours ELSE 0 END),0) AS total_work_hours,
      COALESCE(SUM(CASE WHEN COALESCE(a.late_minutes,0)>0 THEN 1 ELSE 0 END),0) AS late_days,
      COALESCE(SUM(CASE WHEN COALESCE(a.late_minutes,0)>0 THEN a.late_minutes ELSE 0 END),0) AS late_minutes,
      COALESCE(SUM(CASE WHEN a.status NOT IN ('absent','leave','cancelled','rejected') AND a.checkin_time IS NULL THEN 1 ELSE 0 END),0) AS missing_checkin_days,
      COALESCE(SUM(CASE WHEN a.status NOT IN ('absent','leave','cancelled','rejected') AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL THEN 1 ELSE 0 END),0) AS missing_checkout_days
      FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date BETWEEN ? AND ?
      WHERE (u.is_active=1 OR a.id IS NOT NULL)`;
    const binds = [from, to];
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns) { q += ' AND u.department=?'; binds.push(me.department); }
    q += ' GROUP BY u.id ORDER BY u.full_name COLLATE NOCASE';
    const { results = [] } = await env.DB.prepare(q).bind(...binds).all();
    const today = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    const attendanceRateTo = from.slice(0, 7) === today.slice(0, 7) ? (today < to ? today : to) : to;
    const standardWorkDays = await attBusinessDaysBetweenAsync(env, from, to);
    const expectedWorkDaysToDate = await attBusinessDaysBetweenAsync(env, from, attendanceRateTo);
    const employees = results.map(row => {
      const missingDays = Number(row.missing_checkin_days || 0) + Number(row.missing_checkout_days || 0);
      const actualWorkDays = Number(row.actual_work_days || 0);
      return {
        ...row,
        standard_work_days: standardWorkDays,
        expected_work_days_to_date: expectedWorkDaysToDate,
        attendance_rate: expectedWorkDaysToDate ? Number(((actualWorkDays / expectedWorkDaysToDate) * 100).toFixed(1)) : 0,
        period_status: !Number(row.record_count) ? 'no_data' : missingDays ? 'incomplete' : Number(row.late_days) ? 'late' : 'complete',
      };
    });
    const sorted = typeof sortVietnameseNames === 'function' ? sortVietnameseNames(employees, 'full_name') : employees;
    return { period: { from, to }, employees: sorted };
  },

  async myCompliance(env, url, me, { vnTodayStr, penaltyPolicyEffectiveMonth }) {
    const requestedMonth = String(url.searchParams.get('month') || '').trim();
    const todayHcm = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    const month = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : todayHcm.slice(0, 7);
    const effectiveMonth = penaltyPolicyEffectiveMonth || PENALTY_POLICY_EFFECTIVE_MONTH;
    const { results = [] } = await env.DB.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN COALESCE(late_minutes,0) > 0 THEN 1 ELSE 0 END),0) AS late_count,
        COALESCE(SUM(CASE
          WHEN date < ?
           AND status NOT IN ('absent','leave','cancelled','rejected')
           AND (checkin_time IS NULL OR checkout_time IS NULL)
          THEN 1 ELSE 0 END),0) AS missing_checkinout_count
       FROM attendance
       WHERE user_id=? AND date LIKE ?`
    ).bind(todayHcm, me.id, `${month}-%`).all();
    const row = results[0] || {};
    const lateCount = Number(row.late_count || 0);
    const missingCount = Number(row.missing_checkinout_count || 0);
    const policyActive = month >= effectiveMonth;
    return {
      month,
      policy_active: policyActive,
      late_count: lateCount,
      missing_checkinout_count: missingCount,
      late_free_remaining: policyActive ? Math.max(0, 2 - lateCount) : null,
      late_penalty_count: policyActive ? Math.max(0, lateCount - 2) : 0,
      late_penalty_amount: policyActive ? Math.max(0, lateCount - 2) * 20000 : 0,
      missing_penalty_amount: policyActive ? missingCount * 50000 : 0,
      policy: {
        effective_month: effectiveMonth,
        late_free_times: 2,
        late_penalty_from: 3,
        late_penalty_amount: 20000,
        missing_checkinout_penalty_amount: 50000,
      },
    };
  },

  async today(env, me, { isManager, isAdmin, isAttendanceHcns, vnTodayStr }) {
    const todayStr = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    let rows;
    if (isManager) {
      const scope = (!isAdmin && !isAttendanceHcns) ? ' AND u.department=?' : '';
      const stmt = env.DB.prepare(
        `SELECT a.*, CASE WHEN a.registered=1 AND a.checkin_time IS NULL AND a.status='present' THEN 'registered' ELSE a.status END AS status, u.full_name, u.employee_code, u.department FROM attendance a JOIN users u ON a.user_id=u.id WHERE a.date=?${scope} ORDER BY a.checkin_time`
      );
      const r = scope ? await stmt.bind(todayStr, me.department).all() : await stmt.bind(todayStr).all();
      rows = r.results || [];
    } else {
      const r = await env.DB.prepare(
        "SELECT a.*, CASE WHEN a.registered=1 AND a.checkin_time IS NULL AND a.status='present' THEN 'registered' ELSE a.status END AS status, u.full_name, u.employee_code, u.department FROM attendance a JOIN users u ON a.user_id=u.id WHERE a.user_id=? AND a.date=?"
      ).bind(me.id, todayStr).all();
      rows = r.results || [];
    }
    return { attendance: rows, today: todayStr };
  },

  async register(env, data, me, { vnTodayStr, broadcastAppEvent }) {
    const b = data || {};
    const workType = ['office', 'wfh', 'business'].includes(b.work_type) ? b.work_type : 'office';
    const shift = ['morning', 'afternoon', 'full'].includes(b.shift) ? b.shift : 'full';
    if (workType === 'business' && (!b.expected_start || !b.expected_end)) {
      return { error: 'Vui lòng nhập giờ bắt đầu và kết thúc dự kiến cho chuyến công tác', status: 400 };
    }
    const todayStr = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    const wfhReason = String(b.wfh_reason || '').trim();
    if (workType === 'wfh' && !wfhReason) {
      return { error: 'Vui lòng nhập lý do làm việc tại nhà (WFH)', status: 400 };
    }
    if (workType === 'wfh' && wfhReason.length > 1000) {
      return { error: 'Lý do WFH không được vượt quá 1000 ký tự', status: 400 };
    }
    const wfhProofUrl = workType === 'wfh' ? (String(b.wfh_proof_url || '').trim() || null) : null;
    const wfhProofFilename = workType === 'wfh' ? (String(b.wfh_proof_filename || '').trim() || null) : null;
    const wfhProofDocId = workType === 'wfh' ? (String(b.wfh_proof_document_id || '').trim() || null) : null;
    const existing = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?')
      .bind(me.id, todayStr).first();
    if (existing && existing.checkin_time) {
      return { error: 'Đã check-in hôm nay, không thể thay đổi đăng ký', status: 400 };
    }
    const expectedStart = workType === 'business' ? b.expected_start : null;
    const expectedEnd = workType === 'business' ? b.expected_end : null;
    const note = b.note || '';
    let recordId = existing ? existing.id : null;
    if (existing) {
      await env.DB.prepare(
        "UPDATE attendance SET work_type=?,shift=?,expected_start=?,expected_end=?,registered=1,status=CASE WHEN checkin_time IS NULL THEN 'registered' ELSE status END,note=?,wfh_status=CASE WHEN ?='wfh' THEN COALESCE(wfh_status, 'pending') ELSE NULL END,wfh_reason=CASE WHEN ?='wfh' THEN ? ELSE NULL END,wfh_proof_url=CASE WHEN ?='wfh' THEN COALESCE(?, wfh_proof_url) ELSE NULL END,wfh_proof_filename=CASE WHEN ?='wfh' THEN COALESCE(?, wfh_proof_filename) ELSE NULL END,wfh_proof_document_id=CASE WHEN ?='wfh' THEN COALESCE(?, wfh_proof_document_id) ELSE NULL END WHERE id=?"
      ).bind(workType, shift, expectedStart, expectedEnd, note, workType, workType, wfhReason || null, workType, wfhProofUrl, workType, wfhProofFilename, workType, wfhProofDocId, existing.id).run();
    } else {
      const insRes = await env.DB.prepare(
        "INSERT INTO attendance (user_id,date,work_type,shift,expected_start,expected_end,registered,status,note,wfh_status,wfh_reason,wfh_proof_url,wfh_proof_filename,wfh_proof_document_id) VALUES (?,?,?,?,?,?,1,'registered',?,CASE WHEN ?='wfh' THEN 'pending' ELSE NULL END,?,?,?,?)"
      ).bind(me.id, todayStr, workType, shift, expectedStart, expectedEnd, note, workType, wfhReason || null, wfhProofUrl, wfhProofFilename, wfhProofDocId).run();
      recordId = insRes?.meta?.last_row_id || null;
    }
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:registered', {
        user_id: me.id,
        user_name: me.full_name,
        employee_code: me.employee_code,
        department: me.department,
        date: todayStr,
        work_type: workType,
        shift,
        status: 'registered',
        wfh_status: workType === 'wfh' ? 'pending' : null,
        wfh_reason: workType === 'wfh' ? wfhReason : null,
      }, { actorId: me.id });
      if (workType === 'wfh') {
        await broadcastAppEvent(env, 'attendance', 'attendance:wfh_requested', {
          id: recordId,
          user_id: me.id,
          user_name: me.full_name,
          employee_code: me.employee_code,
          department: me.department,
          date: todayStr,
          shift,
          wfh_reason: wfhReason,
          wfh_proof_url: wfhProofUrl,
          wfh_proof_filename: wfhProofFilename,
          wfh_status: 'pending',
        }, { actorId: me.id });
      }
    }
    return { ok: true };
  },

  async checkin(env, data, me, request, { vnTodayStr, vnTimeStr, currentIpInfo, broadcastAppEvent }) {
    const b = data || {};
    const todayStr = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    let existing = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?')
      .bind(me.id, todayStr).first();
    if (existing && existing.checkin_time) {
      return { ok: true, status: existing.status, time: existing.checkin_time, late_minutes: existing.late_minutes || 0, already: true };
    }
    if (!existing) {
      await env.DB.prepare(
        'INSERT INTO attendance (user_id,date,work_type,shift,registered,note) VALUES (?,?,?,?,1,?)'
      ).bind(me.id, todayStr, 'office', 'full', b.note || '').run();
      existing = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').bind(me.id, todayStr).first();
    }
    const workType = existing.work_type || 'office';
    if (b.latitude !== undefined || b.longitude !== undefined || b.accuracy !== undefined) {
      const lat = Number(b.latitude), lng = Number(b.longitude);
      const acc = (b.accuracy === undefined || b.accuracy === null || b.accuracy === '') ? null : Number(b.accuracy);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { error: 'Tọa độ GPS không hợp lệ', status: 400 };
      }
      if (acc !== null && (!Number.isFinite(acc) || acc < 0)) return { error: 'Độ chính xác GPS không hợp lệ', status: 400 };
    }
    const ipInfo = typeof currentIpInfo === 'function' ? await currentIpInfo(env, request) : { ip: '', matched: true };
    const geo = await verifyAttendanceGeofence(env, b);
    const gpsConstraintEnabled = await isGpsConstraintEnabled(env);
    if (geo.status === 'invalid') return { error: geo.reason || 'Tọa độ GPS không hợp lệ', status: 400 };
    if (gpsConstraintEnabled && workType === 'office') {
      if (geo.status === 'unavailable') return { error: geo.reason || 'Chưa nhận được vị trí GPS hợp lệ', geofence: geo, status: 403 };
      if (geo.status === 'not_configured' && !ipInfo.matched) {
        return { error: `IP hien tai (${ipInfo.ip}) khong nam trong whitelist van phong`, ip: ipInfo.ip, matched: false, warning: ipInfo.warning, status: 403 };
      }
    }
    const timeStr = typeof vnTimeStr === 'function' ? vnTimeStr() : new Date().toTimeString().slice(0, 5);
    const bounds = await getDynamicShiftBounds(env, workType, existing.shift || 'full', existing.expected_start, existing.expected_end);
    const lateMinutes = Math.max(0, attToMinutes(timeStr) - attToMinutes(bounds.lateAfter));
    const status = lateMinutes > 0 ? 'late' : 'present';
    const geoLat = Number.isFinite(Number(b.latitude)) ? Number(b.latitude) : null;
    const geoLng = Number.isFinite(Number(b.longitude)) ? Number(b.longitude) : null;
    const isOffice = workType === 'office';
    const geofenceStatus = isOffice ? (geo.status === 'verified' ? 'inside' : 'outside') : null;
    const requiresReview = isOffice && geo.status === 'outside';
    const reviewStatus = requiresReview ? 'pending' : 'none';
    const finalNote = await resolveLatePenaltyNote(env, me.id, todayStr, lateMinutes, existing.id, b.note || existing.note || '');
    await env.DB.prepare('UPDATE attendance SET checkin_time=?,checkin_ip=?,status=?,late_minutes=?,checkin_location_id=?,checkin_distance_meters=?,checkin_accuracy_meters=?,checkin_verification_method=?,checkin_lat=?,checkin_lng=?,checkin_geofence_status=?,checkin_requires_review=?,checkin_review_status=?,note=? WHERE id=?')
      .bind(timeStr, ipInfo.ip, status, lateMinutes, geo.location?.id||null, geo.location?.distance_meters||null, geo.accuracy_meters||null, geo.status === 'verified' ? 'geofence' : (geo.location?.id ? 'geofence' : (ipInfo.matched ? 'ip' : null)), geoLat, geoLng, geofenceStatus, requiresReview ? 1 : 0, reviewStatus, finalNote, existing.id).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:checkin', {
        id: existing.id,
        user_id: me.id,
        user_name: me.full_name,
        employee_code: me.employee_code,
        department: me.department,
        date: todayStr,
        checkin_time: timeStr,
        status,
        late_minutes: lateMinutes,
        geofence_status: geofenceStatus,
        requires_review: requiresReview,
      }, { actorId: me.id });
    }
    return { ok: true, status, time: timeStr, late_minutes: lateMinutes, geofence: geo, gps_constraint_enabled: gpsConstraintEnabled, distance_meters: geo.location?.distance_meters ?? null, inside_geofence: geo.inside_geofence ?? null, geofence_status: geofenceStatus, requires_location_review: requiresReview, location_review_status: reviewStatus };
  },

  async checkout(env, data, me, request, { vnTodayStr, vnTimeStr, currentIpInfo, broadcastAppEvent }) {
    const b = data || {};
    const todayStr = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    let record = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?')
      .bind(me.id, todayStr).first();
    if (!record || !record.checkin_time) {
      const ipInfo = typeof currentIpInfo === 'function' ? await currentIpInfo(env, request) : { ip: '', matched: true };
      const gpsConstraintEnabled = await isGpsConstraintEnabled(env);
      if (gpsConstraintEnabled && (!record || (record.work_type || 'office') === 'office')) {
        if (!ipInfo.matched) return { error: `IP hien tai (${ipInfo.ip}) khong nam trong whitelist van phong`, ip: ipInfo.ip, matched: false, warning: ipInfo.warning, status: 403 };
      }
      const ciTime = typeof vnTimeStr === 'function' ? vnTimeStr() : new Date().toTimeString().slice(0, 5);
      if (!record) {
        await env.DB.prepare(
          'INSERT INTO attendance (user_id,date,work_type,shift,registered,checkin_time,checkin_ip,status) VALUES (?,?,?,?,1,?,?,?)'
        ).bind(me.id, todayStr, 'office', 'full', ciTime, ipInfo.ip, 'present').run();
      } else {
        await env.DB.prepare('UPDATE attendance SET checkin_time=?,checkin_ip=?,status=? WHERE id=?')
          .bind(ciTime, ipInfo.ip, 'present', record.id).run();
      }
      record = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').bind(me.id, todayStr).first();
    }
    if (record.checkout_time) {
      return { ok: true, time: record.checkout_time, work_hours: record.work_hours, early_minutes: record.early_minutes || 0, already: true };
    }
    const ipInfo = typeof currentIpInfo === 'function' ? await currentIpInfo(env, request) : { ip: '', matched: true };
    const workType = record.work_type || 'office';
    if (b.latitude !== undefined || b.longitude !== undefined || b.accuracy !== undefined) {
      const lat = Number(b.latitude), lng = Number(b.longitude);
      const acc = (b.accuracy === undefined || b.accuracy === null || b.accuracy === '') ? null : Number(b.accuracy);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { error: 'Tọa độ GPS không hợp lệ', status: 400 };
      }
      if (acc !== null && (!Number.isFinite(acc) || acc < 0)) return { error: 'Độ chính xác GPS không hợp lệ', status: 400 };
    }
    const geo = await verifyAttendanceGeofence(env, b);
    const gpsConstraintEnabled = await isGpsConstraintEnabled(env);
    if (geo.status === 'invalid') return { error: geo.reason || 'Tọa độ GPS không hợp lệ', status: 400 };
    if (gpsConstraintEnabled && workType === 'office') {
      if (geo.status === 'unavailable') return { error: geo.reason || 'Chưa nhận được vị trí GPS hợp lệ', geofence: geo, status: 403 };
      if (geo.status === 'not_configured' && !ipInfo.matched) {
        return { error: `IP hien tai (${ipInfo.ip}) khong nam trong whitelist van phong`, ip: ipInfo.ip, matched: false, warning: ipInfo.warning, status: 403 };
      }
    }
    const timeStr = typeof vnTimeStr === 'function' ? vnTimeStr() : new Date().toTimeString().slice(0, 5);
    const shift = record.shift || 'full';
    const bounds = attShiftBounds(workType, shift, record.expected_start, record.expected_end);
    const ciMin = attToMinutes(record.checkin_time) ?? attToMinutes(bounds.start);
    const coMin = attToMinutes(timeStr);
    const earlyMinutes = attEarlyCheckoutMinutes(bounds, timeStr);
    let workMinutes = Math.max(0, coMin - ciMin);
    if (workType !== 'business' && shift === 'full') {
      const lunchStart = 12 * 60, lunchEnd = 13 * 60 + 30;
      const overlap = Math.max(0, Math.min(coMin, lunchEnd) - Math.max(ciMin, lunchStart));
      workMinutes -= overlap;
    }
    const workHours = Math.max(0, workMinutes) / 60;
    const geoLat = Number.isFinite(Number(b.latitude)) ? Number(b.latitude) : null;
    const geoLng = Number.isFinite(Number(b.longitude)) ? Number(b.longitude) : null;
    const isOffice = workType === 'office';
    const geofenceStatus = isOffice ? (geo.status === 'verified' ? 'inside' : 'outside') : null;
    const requiresReview = isOffice && geo.status === 'outside';
    const reviewStatus = requiresReview ? 'pending' : 'none';
    await env.DB.prepare('UPDATE attendance SET checkout_time=?,checkout_ip=?,work_hours=?,early_minutes=?,checkout_location_id=?,checkout_distance_meters=?,checkout_accuracy_meters=?,checkout_verification_method=?,checkout_lat=?,checkout_lng=?,checkout_geofence_status=?,checkout_requires_review=?,checkout_review_status=? WHERE id=?')
      .bind(timeStr, ipInfo.ip, workHours, earlyMinutes, geo.location?.id||null, geo.location?.distance_meters||null, geo.accuracy_meters||null, geo.status === 'verified' ? 'geofence' : (geo.location?.id ? 'geofence' : (ipInfo.matched ? 'ip' : null)), geoLat, geoLng, geofenceStatus, requiresReview ? 1 : 0, reviewStatus, record.id).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:checkout', {
        id: record.id,
        user_id: me.id,
        user_name: me.full_name,
        employee_code: me.employee_code,
        department: me.department,
        date: todayStr,
        checkout_time: timeStr,
        work_hours: workHours,
        early_minutes: earlyMinutes,
        status: record.status,
      }, { actorId: me.id });
    }
    return { ok: true, attendance_id: record.id, time: timeStr, work_hours: workHours, early_minutes: earlyMinutes, geofence: geo, gps_constraint_enabled: gpsConstraintEnabled, distance_meters: geo.location?.distance_meters ?? null, inside_geofence: geo.inside_geofence ?? null, geofence_status: geofenceStatus, requires_location_review: requiresReview, location_review_status: reviewStatus };
  },

  async checkinPoints(env, url, me, { isAdmin, isAttendanceHcns, vnTodayStr }) {
    await ensureAttendanceLocationSchema(env);
    const todayStr = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get('date') || '')) ? String(url.searchParams.get('date')) : todayStr;
    const officeIdParam = parseInt(url.searchParams.get('office_id'), 10);
    let office = null;
    if (Number.isInteger(officeIdParam)) {
      office = await env.DB.prepare('SELECT * FROM attendance_locations WHERE id=? AND is_active=1').bind(officeIdParam).first();
    }
    if (!office) {
      const mine = await env.DB.prepare('SELECT checkin_location_id, checkin_lat, checkin_lng FROM attendance WHERE user_id=? AND date=?').bind(me.id, date).first();
      if (mine?.checkin_location_id) office = await env.DB.prepare('SELECT * FROM attendance_locations WHERE id=?').bind(mine.checkin_location_id).first();
      if (!office && Number.isFinite(Number(mine?.checkin_lat)) && Number.isFinite(Number(mine?.checkin_lng))) {
        const { results: nearestCandidates = [] } = await env.DB.prepare('SELECT * FROM attendance_locations WHERE is_active=1').all();
        office = nearestCandidates.map(location => ({ ...location, distance_meters: geoDistanceMeters(Number(mine.checkin_lat), Number(mine.checkin_lng), location.latitude, location.longitude) })).sort((a, b) => a.distance_meters - b.distance_meters)[0] || null;
      }
    }
    if (!office) {
      const topOffice = await env.DB.prepare('SELECT checkin_location_id AS id, COUNT(*) AS cnt FROM attendance WHERE date=? AND checkin_location_id IS NOT NULL GROUP BY checkin_location_id ORDER BY cnt DESC LIMIT 1').bind(date).first();
      if (topOffice?.id) office = await env.DB.prepare('SELECT * FROM attendance_locations WHERE id=?').bind(topOffice.id).first();
    }
    if (!office) {
      const { results: fallbackOffices = [] } = await env.DB.prepare('SELECT * FROM attendance_locations WHERE is_active=1 ORDER BY id LIMIT 1').all();
      office = fallbackOffices[0] || null;
    }
    const viewerScope = isAdmin || isAttendanceHcns ? 'company' : (me.role === 'manager' ? 'department' : 'self');
    if (!office) return { date, office: null, viewer: { can_view_all_markers: viewerScope === 'company', scope: viewerScope }, markers: [], reason: 'Chưa cấu hình địa điểm chấm công' };
    let q = `SELECT a.user_id, a.checkin_time, a.checkin_lat, a.checkin_lng, a.checkin_accuracy_meters, a.checkin_location_id, a.checkin_distance_meters, a.checkin_requires_review, a.checkin_review_status, u.full_name, u.employee_code, u.department
      FROM attendance a JOIN users u ON u.id=a.user_id
      WHERE a.date=? AND a.checkin_lat IS NOT NULL AND a.checkin_lng IS NOT NULL`;
    const binds = [date];
    if (viewerScope === 'self') { q += ' AND a.user_id=?'; binds.push(me.id); }
    else if (viewerScope === 'department') { q += ' AND u.department=?'; binds.push(me.department); }
    q += ' ORDER BY a.checkin_time ASC, a.id ASC';
    const { results: gpsRows = [] } = await env.DB.prepare(q).bind(...binds).all();
    const radius = Number(office.radius_meters || 100);
    const markers = gpsRows.map(row => {
      const lat = Number(row.checkin_lat), lng = Number(row.checkin_lng);
      const decision = geofenceDecision(geoDistanceMeters(lat, lng, office.latitude, office.longitude), radius);
      return {
        employee_id: row.user_id,
        employee_name: row.full_name,
        employee_code: row.employee_code || null,
        department: row.department || null,
        checkin_time: row.checkin_time || null,
        latitude: lat,
        longitude: lng,
        checkin_accuracy_meters: row.checkin_accuracy_meters ?? null,
        office_location_id: row.checkin_location_id ?? null,
        distance_m: Math.round(geoDistanceMeters(lat, lng, office.latitude, office.longitude)),
        inside_geofence: decision.inside,
        requires_location_review: !!row.checkin_requires_review,
        location_review_status: row.checkin_review_status || 'none',
        is_current_user: Number(row.user_id) === Number(me.id),
      };
    });
    markers.sort((a, b) => (b.is_current_user ? 1 : 0) - (a.is_current_user ? 1 : 0));
    return {
      date,
      office: { id: office.id, name: office.name, code: office.code, address: office.address, latitude: office.latitude, longitude: office.longitude, radius_meters: Number(office.radius_meters || 100), max_accuracy_meters: Number(office.max_accuracy_meters || 100) },
      viewer: { can_view_all_markers: viewerScope === 'company', scope: viewerScope },
      markers,
    };
  },

  async locationReview(env, aid, data, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns, broadcastAppEvent }) {
    if (!isAttendanceAdmin) return { error: 'Không có quyền', status: 403 };
    const b = data || {};
    const decision = ['approved', 'rejected'].includes(b.status) ? b.status : null;
    if (!decision) return { error: 'Trạng thái duyệt không hợp lệ', status: 400 };
    if (!Number.isInteger(aid) || aid <= 0) return { error: 'ID bản ghi không hợp lệ', status: 400 };
    const row = await env.DB.prepare('SELECT a.*, u.department FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').bind(aid).first();
    if (!row) return { error: 'Không tìm thấy bản ghi chấm công', status: 404 };
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && row.department !== me.department) {
      return { error: 'Không có quyền xem nhân sự ngoài phòng ban', status: 403 };
    }
    if (!Number(row.checkin_requires_review)) return { error: 'Bản ghi này không cần xem xét vị trí', status: 400 };
    const note = String(b.note || '').trim() || null;
    await env.DB.prepare("UPDATE attendance SET checkin_review_status=?, checkin_reviewed_by=?, checkin_review_note=?, checkin_reviewed_at=datetime('now','localtime') WHERE id=?")
      .bind(decision, me.id, note, aid).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:location_reviewed', {
        id: aid,
        user_id: row.user_id,
        status: decision,
        reviewed_by: me.id,
        reviewed_by_name: me.full_name || '',
        note,
      }, { actorId: me.id });
    }
    return { ok: true, attendance_id: aid, status: decision };
  },

  async uploadWfhProof(env, form, me, { safeDownloadName }) {
    if (!form) return { error: 'Vui lòng chọn tệp đính kèm', status: 400 };
    const rawFiles = form.getAll('files').length > 0 ? form.getAll('files') : (form.getAll('file').length > 0 ? form.getAll('file') : []);
    const files = rawFiles.filter(f => f && typeof f.stream === 'function');
    if (!files.length) return { error: 'Vui lòng chọn tệp đính kèm', status: 400 };
    if (files.length > 5) return { error: 'Tối đa 5 tệp cho mỗi lần tải lên', status: 400 };

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    const uploaded = [];

    for (const file of files) {
      const contentType = String(file.type || '').toLowerCase();
      if (!allowed.includes(contentType) || !Number.isFinite(file.size) || file.size < 1 || file.size > 10 * 1024 * 1024) {
        return { error: `Tệp ${file.name || ''}: Chỉ nhận ảnh (JPG, PNG, WebP, GIF) hoặc PDF, tối đa 10 MB`, status: 400 };
      }
      const bytes = await file.arrayBuffer();
      const documentId = crypto.randomUUID();
      const filename = typeof safeDownloadName === 'function' ? safeDownloadName(file.name) : file.name;
      const fileUrl = `/api/attendance/wfh-proof/${documentId}`;
      if (env.HR_DOCUMENTS) {
        const storageKey = `wfh-proofs/${me.id}/${documentId}`;
        await env.HR_DOCUMENTS.put(storageKey, bytes, {
          httpMetadata: { contentType, cacheControl: 'private, no-store' },
          customMetadata: { owner_id: String(me.id) }
        });
        await env.DB.prepare('INSERT INTO wfh_proof_files (id, user_id, filename, content_type, byte_size, data_base64) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(documentId, me.id, filename, contentType, file.size, null).run();
      } else {
        const b64 = Buffer.from(bytes).toString('base64');
        await env.DB.prepare('INSERT INTO wfh_proof_files (id, user_id, filename, content_type, byte_size, data_base64) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(documentId, me.id, filename, contentType, file.size, b64).run();
      }
      uploaded.push({ document_id: documentId, filename, file_url: fileUrl, size: file.size });
    }

    const first = uploaded[0];
    return {
      ok: true,
      document_id: first.document_id,
      filename: first.filename,
      file_url: first.file_url,
      files: uploaded,
    };
  },

  async getWfhProofFile(env, url, documentId, me, { isAttendanceAdmin, safeDownloadName, isDirectorHau }) {
    const row = await env.DB.prepare('SELECT * FROM wfh_proof_files WHERE id=?').bind(documentId).first();
    if (!row) return { error: 'Tệp không tồn tại', status: 404 };
    const isHau = typeof isDirectorHau === 'function' ? isDirectorHau(me) : false;
    const canAccess = Number(row.user_id) === Number(me.id) || isAttendanceAdmin || isHau || me?.role === 'admin';
    if (!canAccess) return { error: 'Không có quyền xem tệp', status: 403 };
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    const filename = typeof safeDownloadName === 'function' ? safeDownloadName(row.filename || 'proof') : (row.filename || 'proof');
    if (env.HR_DOCUMENTS) {
      const storageKey = `wfh-proofs/${row.user_id}/${documentId}`;
      const object = await env.HR_DOCUMENTS.get(storageKey);
      if (object) {
        return new Response(object.body, {
          headers: {
            'Content-Type': row.content_type || 'application/octet-stream',
            'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          }
        });
      }
    }
    if (row.data_base64) {
      const buffer = Buffer.from(row.data_base64, 'base64');
      return new Response(buffer, {
        headers: {
          'Content-Type': row.content_type || 'application/octet-stream',
          'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        }
      });
    }
    return { error: 'Nội dung tệp không khả dụng', status: 404 };
  },

  async updateWfhProof(env, attendanceId, data, me, { broadcastAppEvent }) {
    const record = await env.DB.prepare('SELECT a.*, u.department, u.full_name, u.employee_code FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').bind(attendanceId).first();
    if (!record) return { error: 'Không tìm thấy bản ghi chấm công', status: 404 };
    if (Number(record.user_id) !== Number(me.id)) return { error: 'Chỉ được bổ sung minh chứng của chính bạn', status: 403 };
    const b = data || {};
    const reason = String(b.wfh_reason || record.wfh_reason || '').trim();
    if (!reason) return { error: 'Vui lòng nhập lý do WFH', status: 400 };
    const proofUrl = b.wfh_proof_url !== undefined ? b.wfh_proof_url : record.wfh_proof_url;
    const proofFilename = b.wfh_proof_filename !== undefined ? b.wfh_proof_filename : record.wfh_proof_filename;
    const proofDocId = b.wfh_proof_document_id !== undefined ? b.wfh_proof_document_id : record.wfh_proof_document_id;
    const newStatus = (record.wfh_status === 'rejected' || !record.wfh_status) ? 'pending' : record.wfh_status;
    await env.DB.prepare(
      "UPDATE attendance SET wfh_reason=?, wfh_proof_url=?, wfh_proof_filename=?, wfh_proof_document_id=?, wfh_status=?, wfh_review_note=CASE WHEN ?='pending' THEN NULL ELSE wfh_review_note END WHERE id=?"
    ).bind(reason, proofUrl || null, proofFilename || null, proofDocId || null, newStatus, newStatus, attendanceId).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:wfh_requested', {
        id: attendanceId,
        user_id: me.id,
        user_name: me.full_name,
        employee_code: me.employee_code,
        department: record.department,
        date: record.date,
        wfh_status: newStatus,
        wfh_reason: reason,
        wfh_proof_url: proofUrl,
        wfh_proof_filename: proofFilename,
      }, { actorId: me.id });
    }
    return { ok: true, wfh_status: newStatus };
  },

  async listWfhRequests(env, url, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau }) {
    const isHau = typeof isDirectorHau === 'function' ? isDirectorHau(me) : false;
    const month = String(url.searchParams.get('month') || '');
    const status = String(url.searchParams.get('status') || '');
    const date = String(url.searchParams.get('date') || '');
    let q = `SELECT a.*, u.full_name, u.employee_code, u.department, u.avatar_url, u.avatar_color, u.avatar_initials
             FROM attendance a
             JOIN users u ON u.id = a.user_id
             WHERE a.work_type = 'wfh' AND a.wfh_status IS NOT NULL`;
    const binds = [];
    if (!isAttendanceAdmin && !isHau) {
      q += ' AND a.user_id = ?';
      binds.push(me.id);
    } else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && !isHau) {
      q += ' AND u.department = ?';
      binds.push(me.department);
    }
    if (/^\d{4}-\d{2}$/.test(month)) {
      q += " AND strftime('%Y-%m', a.date) = ?";
      binds.push(month);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      q += " AND a.date = ?";
      binds.push(date);
    }
    if (['pending', 'pending_director', 'approved', 'rejected'].includes(status)) {
      q += ' AND a.wfh_status = ?';
      binds.push(status);
    }
    q += " ORDER BY CASE a.wfh_status WHEN 'pending' THEN 0 WHEN 'pending_director' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END, a.date DESC, a.id DESC";
    const { results = [] } = await (binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q)).all();
    return { wfh_requests: results };
  },

  async decideWfh(env, id, data, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau, createEmployeePopup, broadcastAppEvent }) {
    const isHau = typeof isDirectorHau === 'function' ? isDirectorHau(me) : false;
    if (!isAttendanceAdmin && !isHau) return { error: 'Không có quyền duyệt yêu cầu WFH', status: 403 };
    const record = await env.DB.prepare('SELECT a.*, u.full_name, u.employee_code, u.department FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').bind(id).first();
    if (!record || record.work_type !== 'wfh') return { error: 'Không tìm thấy bản ghi WFH hợp lệ', status: 404 };
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && !isHau && record.department !== me.department) {
      return { error: 'Không có quyền duyệt yêu cầu ngoài phòng ban', status: 403 };
    }
    const currentStatus = record.wfh_status || 'pending';
    if (!['pending', 'pending_director'].includes(currentStatus)) {
      return { error: 'Yêu cầu WFH đã được xử lý', status: 400 };
    }
    if (currentStatus === 'pending_director' && !isHau) {
      return { error: 'Chỉ anh Hậu (Phó Tổng Giám Đốc) hoặc Quản trị viên mới có quyền phê duyệt bước cuối cùng.', status: 403 };
    }

    const b = data || {};
    const action = b.action === 'reject' ? 'reject' : 'approve';
    const note = String(b.review_note || '').trim();
    if (action === 'reject' && !note) {
      return { error: 'Vui lòng nhập lý do từ chối WFH', status: 400 };
    }

    if (action === 'reject') {
      const nextStatus = 'rejected';
      await env.DB.prepare(
        "UPDATE attendance SET wfh_status=?, wfh_reviewer_id=?, wfh_reviewer_name=?, wfh_review_note=?, wfh_reviewed_at=datetime('now','localtime') WHERE id=?"
      ).bind(nextStatus, me.id, me.full_name || '', note || null, id).run();

      if (typeof createEmployeePopup === 'function') {
        await createEmployeePopup(env, {
          userId: record.user_id,
          requestType: 'wfh',
          requestId: id,
          decision: 'rejected',
          title: 'Đơn làm việc tại nhà (WFH) bị từ chối',
          message: `Yêu cầu WFH ngày ${record.date} của bạn đã bị từ chối bởi ${me.full_name || 'Quản lý'}.${note ? ` Lý do: ${note}` : ''}`,
          details: {
            request_type: 'wfh',
            request_id: id,
            date: record.date,
            shift: record.shift,
            reviewer_name: me.full_name,
            reason: note,
          },
          actorId: me.id,
          actorName: me.full_name || '',
        });
      }

      if (typeof broadcastAppEvent === 'function') {
        await broadcastAppEvent(env, 'attendance', 'attendance:wfh_rejected', {
          id,
          user_id: record.user_id,
          wfh_status: nextStatus,
          wfh_reviewer_id: me.id,
          wfh_reviewer_name: me.full_name || '',
          wfh_review_note: note || null,
          final: true,
        }, { actorId: me.id });
      }

      return { ok: true, wfh_status: nextStatus, final: true };
    }

    // action === 'approve'
    const isFinalApproval = currentStatus === 'pending_director' || isHau;
    if (isFinalApproval) {
      const nextStatus = 'approved';
      await env.DB.prepare(
        "UPDATE attendance SET wfh_status=?, wfh_reviewer_id=?, wfh_reviewer_name=?, wfh_review_note=?, wfh_reviewed_at=datetime('now','localtime') WHERE id=?"
      ).bind(nextStatus, me.id, me.full_name || '', note || null, id).run();

      if (typeof createEmployeePopup === 'function') {
        await createEmployeePopup(env, {
          userId: record.user_id,
          requestType: 'wfh',
          requestId: id,
          decision: 'approved',
          title: 'Đơn làm việc tại nhà (WFH) đã được duyệt!',
          message: `Yêu cầu WFH ngày ${record.date} của bạn đã được ${isHau ? 'anh Hậu (Phó Tổng Giám Đốc)' : (me.full_name || 'Ban Giám Đốc')} phê duyệt chính thức.${note ? ` Ghi chú: ${note}` : ''}`,
          details: {
            request_type: 'wfh',
            request_id: id,
            date: record.date,
            shift: record.shift,
            reviewer_name: isHau ? 'Anh Hậu (Phó Tổng Giám Đốc)' : me.full_name,
            note,
          },
          actorId: me.id,
          actorName: me.full_name || '',
        });
      }

      if (typeof broadcastAppEvent === 'function') {
        await broadcastAppEvent(env, 'attendance', 'attendance:wfh_approved', {
          id,
          user_id: record.user_id,
          date: record.date,
          wfh_status: nextStatus,
          reviewer_id: me.id,
          reviewer_name: me.full_name || '',
          review_note: note || null,
          final: true,
        }, { actorId: me.id });
      }

      return { ok: true, wfh_status: nextStatus, final: true };
    } else {
      // Step 1 approval by HCNS -> pending_director
      const nextStatus = 'pending_director';
      await env.DB.prepare(
        "UPDATE attendance SET wfh_status=?, wfh_step1_reviewer_id=?, wfh_step1_reviewer_name=?, wfh_step1_reviewed_at=datetime('now','localtime'), wfh_step1_note=? WHERE id=?"
      ).bind(nextStatus, me.id, me.full_name || '', note || null, id).run();

      try {
        await env.DB.prepare(
          "INSERT INTO notifications (user_id, title, content, type, link) VALUES (?, ?, ?, 'attendance', '/attendance')"
        ).bind(
          record.user_id,
          'Tiến độ yêu cầu WFH (Bước 1 đã duyệt)',
          `HCNS (${me.full_name}) đã duyệt bước 1 yêu cầu WFH ngày ${record.date} của bạn. Đang chờ anh Hậu phê duyệt chốt.`
        ).run();
      } catch (_) {}

      if (typeof broadcastAppEvent === 'function') {
        await broadcastAppEvent(env, 'attendance', 'attendance:wfh_forwarded', {
          id,
          user_id: record.user_id,
          date: record.date,
          wfh_status: nextStatus,
          step1_reviewer_id: me.id,
          step1_reviewer_name: me.full_name || '',
          step1_note: note || null,
          final: false,
        }, { actorId: me.id });
      }

      return { ok: true, wfh_status: nextStatus, final: false };
    }
  },

  async updateRecord(env, aid, data, me, { isManager, isAdmin, isAttendanceHcns, broadcastAppEvent }) {
    if (!isManager) return { error: 'Không có quyền', status: 403 };
    const record = await env.DB.prepare('SELECT a.*,u.department FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').bind(aid).first();
    if (!record) return { error: 'Không tìm thấy chấm công', status: 404 };
    if (!isAdmin && !isAttendanceHcns && record.department !== me.department) {
      return { error: 'Không có quyền sửa chấm công ngoài phòng ban', status: 403 };
    }
    const b = data || {};
    const allowedStatus = ['present','late','absent','leave','cancelled','rejected'];
    const requestedStatus = allowedStatus.includes(b.status) ? b.status : 'present';
    if (['absent','leave','cancelled','rejected'].includes(requestedStatus)) {
      await env.DB.prepare(
        'UPDATE attendance SET checkin_time=NULL,checkout_time=NULL,status=?,work_hours=0,late_minutes=0,early_minutes=0,auto_checkout=0,note=? WHERE id=?'
      ).bind(requestedStatus, String(b.note || '').slice(0, 2000), aid).run();
      if (typeof broadcastAppEvent === 'function') {
        await broadcastAppEvent(env, 'attendance', 'attendance:updated', {
          id: aid,
          user_id: record.user_id,
          date: record.date,
          status: requestedStatus,
          checkin_time: null,
          checkout_time: null,
          work_hours: 0,
        }, { actorId: me.id });
      }
      return { ok: true, status: requestedStatus, late_minutes: 0, early_minutes: 0, work_hours: 0 };
    }

    const checkinTime = String(b.checkin_time || '').trim();
    const checkoutTime = String(b.checkout_time || '').trim();
    const workType = ['office','wfh','business'].includes(String(b.work_type || '')) ? String(b.work_type) : (record.work_type || 'office');
    const shift = ['morning','afternoon','full'].includes(String(b.shift || '')) ? String(b.shift) : (record.shift || 'full');
    if (!checkinTime && !checkoutTime) {
      return { error: 'Cần nhập ít nhất giờ check-in hoặc check-out', status: 400 };
    }
    if ((checkinTime && !attTimeIsValid(checkinTime)) || (checkoutTime && !attTimeIsValid(checkoutTime))) {
      return { error: 'Giờ check-in hoặc check-out không hợp lệ', status: 400 };
    }
    if (checkinTime && checkoutTime && attToMinutes(checkoutTime) <= attToMinutes(checkinTime)) {
      return { error: 'Giờ check-out phải sau giờ check-in', status: 400 };
    }
    const bounds = await getDynamicShiftBounds(env, workType, shift, record.expected_start, record.expected_end);
    const metrics = attManualTimingMetrics({ ...record, work_type: workType, shift }, checkinTime, checkoutTime, bounds);
    if (requestedStatus === 'present' && (metrics.lateMinutes > 0 || metrics.earlyMinutes > 0)) {
      const allowedCheckout = Math.max(0, attToMinutes(metrics.bounds.end) - ATT_EARLY_CHECKOUT_TOLERANCE_MINUTES);
      const allowedLabel = `${String(Math.floor(allowedCheckout / 60)).padStart(2, '0')}:${String(allowedCheckout % 60).padStart(2, '0')}`;
      return { error: `Muốn chỉnh Đúng giờ, check-in phải không muộn hơn ${metrics.bounds.lateAfter} và check-out không sớm hơn ${allowedLabel} của ca.`, status: 400 };
    }
    const status = requestedStatus === 'late' ? 'late' : (metrics.lateMinutes > 0 ? 'late' : 'present');
    const finalNote = await resolveLatePenaltyNote(env, record.user_id, record.date, metrics.lateMinutes, aid, b.note !== undefined ? b.note : record.note);
    await env.DB.prepare(
      'UPDATE attendance SET checkin_time=?,checkout_time=?,work_type=?,shift=?,status=?,work_hours=?,late_minutes=?,early_minutes=?,auto_checkout=0,note=? WHERE id=?'
    ).bind(checkinTime || null, checkoutTime || null, workType, shift, status, metrics.workHours, metrics.lateMinutes, metrics.earlyMinutes, String(finalNote || '').slice(0, 2000), aid).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:updated', {
        id: aid,
        user_id: record.user_id,
        date: record.date,
        status,
        checkin_time: checkinTime || null,
        checkout_time: checkoutTime || null,
        work_hours: metrics.workHours,
        late_minutes: metrics.lateMinutes,
        early_minutes: metrics.earlyMinutes,
      }, { actorId: me.id });
    }
    return { ok: true, status, late_minutes: metrics.lateMinutes, early_minutes: metrics.earlyMinutes, work_hours: metrics.workHours };
  },

  async deleteRecord(env, aid, me, { isManager, isAdmin, isAttendanceHcns, broadcastAppEvent }) {
    if (!isManager) return { error: 'Không có quyền', status: 403 };
    const record = await env.DB.prepare('SELECT a.*, u.department FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').bind(aid).first();
    if (!record) return { error: 'Không tìm thấy chấm công', status: 404 };
    if (!isAdmin && !isAttendanceHcns && record.department !== me.department) {
      return { error: 'Không có quyền xóa chấm công ngoài phòng ban', status: 403 };
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM overtime_requests WHERE attendance_id=?').bind(aid),
      env.DB.prepare('DELETE FROM attendance WHERE id=?').bind(aid),
    ]);
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:deleted', {
        id: aid,
        user_id: record.user_id,
        date: record.date,
      }, { actorId: me.id });
    }
    return { ok: true, deleted_id: aid };
  },

  async summary(env, url, me, { isManager, isAdmin, isAttendanceHcns }) {
    const month = parseInt(url.searchParams.get('month'));
    const year = parseInt(url.searchParams.get('year'));
    if (!month || !year) return { error: 'Thiếu tháng/năm', status: 400 };
    let targetUserId = me.id;
    const qUserId = url.searchParams.get('userId');
    if (qUserId) {
      if (!isManager && parseInt(qUserId) !== me.id) return { error: 'Không có quyền', status: 403 };
      targetUserId = parseInt(qUserId);
      if (targetUserId !== me.id && !isAdmin && !isAttendanceHcns) {
        const target = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(targetUserId).first();
        if (!target || target.department !== me.department) return { error: 'Không có quyền xem nhân sự ngoài phòng ban', status: 403 };
      }
    }
    return buildMonthlyWorkSummary(env, targetUserId, month, year);
  },

  async employeeSummary(env, employeeId, url, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns, vnTodayStr, buildMonthlyOvertimeSummary }) {
    const employee = await env.DB.prepare('SELECT id,full_name,employee_code,department,position,is_active FROM users WHERE id=?').bind(employeeId).first();
    if (!employee) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (employeeId !== me.id) {
      if (!isAttendanceAdmin) return { error: 'Không có quyền', status: 403 };
      if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && employee.department !== me.department) {
        return { error: 'Không có quyền xem nhân sự ngoài phòng ban', status: 403 };
      }
    }
    const month = parseInt(url.searchParams.get('month'));
    const year = parseInt(url.searchParams.get('year'));
    let from = String(url.searchParams.get('from') || '');
    let to = String(url.searchParams.get('to') || '');
    if (!from || !to) {
      const now = new Date();
      const resolvedYear = year || now.getFullYear();
      const resolvedMonth = month || (now.getMonth() + 1);
      if (resolvedMonth < 1 || resolvedMonth > 12) return { error: 'Tháng không hợp lệ', status: 400 };
      from = attIsoDate(resolvedYear, resolvedMonth, 1);
      to = attIsoDate(resolvedYear, resolvedMonth, new Date(resolvedYear, resolvedMonth, 0).getDate());
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return { error: 'Khoảng ngày không hợp lệ', status: 400 };
    }
    const { results: records = [] } = await env.DB.prepare(
      'SELECT a.*, loc.name AS checkin_office_name, COALESCE(loc.radius_meters,0) AS checkin_office_radius FROM attendance a LEFT JOIN attendance_locations loc ON loc.id=a.checkin_location_id WHERE a.user_id=? AND a.date BETWEEN ? AND ? ORDER BY a.date ASC'
    ).bind(employeeId, from, to).all();
    let paidLeaveDays = 0;
    try {
      const { results: leaves = [] } = await env.DB.prepare(
        `SELECT lr.start_date,lr.end_date FROM leave_requests lr LEFT JOIN leave_types lt ON lr.type=lt.code WHERE (CAST(lr.user_id AS TEXT)=CAST(? AS TEXT) OR lr.employee_id=?) AND lr.status='approved' AND COALESCE(lt.paid_policy,'paid')='paid' AND date(lr.start_date)<=date(?) AND date(lr.end_date)>=date(?)`
      ).bind(employeeId, employeeId, to, from).all();
      for (const leave of leaves) {
        paidLeaveDays += attCountBusinessDaysBetween(String(leave.start_date) > from ? String(leave.start_date) : from, String(leave.end_date) < to ? String(leave.end_date) : to);
      }
    } catch (_) {}
    const activeRecords = records.filter(r => !['cancelled', 'rejected'].includes(r.status));
    const complete = activeRecords.filter(r => r.checkin_time && r.checkout_time && r.status !== 'absent' && (r.work_type !== 'wfh' || r.wfh_status !== 'rejected'));
    const fullDays = complete.filter(r => r.shift !== 'morning' && r.shift !== 'afternoon').length;
    const halfDays = complete.length - fullDays;
    const missingCheckinDays = activeRecords.filter(r => !r.checkin_time && r.status !== 'absent' && r.status !== 'leave').length;
    const missingCheckoutDays = activeRecords.filter(r => r.checkin_time && !r.checkout_time).length;
    const lateDays = activeRecords.filter(r => Number(r.late_minutes || 0) > 0).length;
    const earlyDays = activeRecords.filter(r => Number(r.early_minutes || 0) > 0).length;
    const totalWorkHours = complete.reduce((sum, r) => sum + Number(r.work_hours || 0), 0);
    const standardWorkDays = await attBusinessDaysBetweenAsync(env, from, to);
    const todayStr = typeof vnTodayStr === 'function' ? vnTodayStr() : new Date().toISOString().slice(0, 10);
    const attendanceRateTo = from.slice(0, 7) === todayStr.slice(0, 7) ? (todayStr < to ? todayStr : to) : to;
    const expectedWorkDaysToDate = await attBusinessDaysBetweenAsync(env, from, attendanceRateTo);
    const actualWorkDays = fullDays + halfDays * .5;
    const overtime = typeof buildMonthlyOvertimeSummary === 'function' ? await buildMonthlyOvertimeSummary(env, employeeId, Number(from.slice(5, 7)), Number(from.slice(0, 4))) : { approvedOvertimeMinutes: 0, approvedOvertimeHours: 0 };
    return {
      employee,
      period: { from, to },
      summary: {
        standardWorkDays, expectedWorkDaysToDate, actualWorkDays, fullDays, halfDays,
        officeDays: complete.filter(r => (r.work_type || 'office') === 'office').length,
        wfhDays: complete.filter(r => r.work_type === 'wfh').length,
        businessDays: complete.filter(r => r.work_type === 'business').length,
        paidLeaveDays, absentDays: activeRecords.filter(r => r.status === 'absent').length,
        missingCheckinDays, missingCheckoutDays, lateDays,
        lateMinutes: activeRecords.reduce((sum, r) => sum + Number(r.late_minutes || 0), 0), earlyDays,
        earlyMinutes: activeRecords.reduce((sum, r) => sum + Number(r.early_minutes || 0), 0), totalWorkHours,
        approvedOvertimeMinutes: overtime.approvedOvertimeMinutes, approvedOvertimeHours: overtime.approvedOvertimeHours,
        attendanceRate: expectedWorkDaysToDate ? Number(((actualWorkDays / expectedWorkDaysToDate) * 100).toFixed(1)) : 0,
      },
      records
    };
  },

  async batchAdd(env, data, url, me, { isAttendanceAdmin, isAdmin, isAttendanceHcns, d1WriteWithRetry, broadcastAppEvent }) {
    if (!isAttendanceAdmin) return { error: 'Không có quyền', status: 403 };
    const b = data || {};
    const employeeId = parseInt(b.user_id);
    const fromDate = String(b.from_date || '');
    const toDate = String(b.to_date || '');
    const checkinTime = String(b.checkin_time || '').trim();
    const checkoutTime = String(b.checkout_time || '').trim();
    const status = ['present', 'late', 'absent', 'leave'].includes(b.status) ? b.status : 'present';
    const skipNonWorkingDays = b.skip_non_working_days !== false;
    const workType = ['office', 'wfh', 'business'].includes(b.work_type) ? b.work_type : 'office';
    const shift = ['morning', 'afternoon', 'full'].includes(b.shift) ? b.shift : 'full';
    const note = String(b.note || '').slice(0, 2000);
    const dryRun = String(url.searchParams.get('dry_run') || '') === '1';

    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
      return { error: 'Vui lòng chọn nhân viên và khoảng ngày hợp lệ', status: 400 };
    }
    if (checkinTime && !attTimeIsValid(checkinTime)) return { error: 'Giờ check-in không hợp lệ', status: 400 };
    if (checkoutTime && !attTimeIsValid(checkoutTime)) return { error: 'Giờ check-out không hợp lệ', status: 400 };

    const employee = await env.DB.prepare('SELECT id,full_name,employee_code,department,is_active FROM users WHERE id=?').bind(employeeId).first();
    if (!employee || !Number(employee.is_active)) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && employee.department !== me.department) {
      return { error: 'Không có quyền thêm chấm công cho nhân sự ngoài phòng ban', status: 403 };
    }

    let ci = checkinTime || null;
    let co = checkoutTime || null;
    if (status === 'absent' || status === 'leave') { ci = null; co = null; }
    const batchBounds = await getDynamicShiftBounds(env, workType, shift, null, null);
    const timing = attManualTimingMetrics({ work_type: workType, shift, expected_start: null, expected_end: null }, ci, co, batchBounds);
    const workHours = timing.workHours > 0 ? Number(timing.workHours.toFixed(2)) : null;

    const { results: existingRows = [] } = await env.DB.prepare('SELECT id,date FROM attendance WHERE user_id=? AND date BETWEEN ? AND ?').bind(employeeId, fromDate, toDate).all();
    const existingDates = new Set(existingRows.map(r => r.date));

    const createdDates = [];
    const skippedDates = [];
    const existsDates = [];
    for (let d = new Date(`${fromDate}T00:00:00`); d <= new Date(`${toDate}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const iso = attIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (existingDates.has(iso)) { existsDates.push(iso); continue; }
      if (skipNonWorkingDays && !(await isAttendanceWorkingDay(env, iso, employee))) { skippedDates.push(iso); continue; }
      createdDates.push(iso);
    }

    const summary = {
      dry_run: dryRun,
      created: createdDates.length,
      created_dates: createdDates,
      skipped: skippedDates.length,
      skipped_dates: skippedDates,
      exists: existsDates.length,
      exists_dates: existsDates,
      employee: { id: employee.id, full_name: employee.full_name, employee_code: employee.employee_code },
    };
    if (dryRun) return { ok: true, ...summary };

    const writeFn = typeof d1WriteWithRetry === 'function' ? d1WriteWithRetry : op => op();
    for (const iso of createdDates) {
      const rowNote = await resolveLatePenaltyNote(env, employeeId, iso, timing.lateMinutes, null, note || null);
      await writeFn(() => env.DB.prepare(
        'INSERT INTO attendance (user_id,date,checkin_time,checkout_time,status,work_hours,note,work_type,shift,registered,late_minutes,early_minutes) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)'
      ).bind(employeeId, iso, ci, co, status, workHours, rowNote || null, workType, shift, timing.lateMinutes, timing.earlyMinutes).run());
    }
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'attendance', 'attendance:batch_imported', {
        user_id: employeeId,
        created_dates: createdDates,
        count: createdDates.length,
      }, { actorId: me.id });
    }
    return { ok: true, ...summary };
  },

  async listLocations(env) {
    const schemaReady = await ensureAttendanceLocationSchema(env);
    if (!schemaReady) return { locations: [], schema_ready: false, warning: 'Không thể khởi tạo dữ liệu địa điểm chấm công. Vui lòng thử lại sau.', status: 503 };
    const { results = [] } = await env.DB.prepare('SELECT * FROM attendance_locations ORDER BY is_active DESC,name COLLATE NOCASE').all();
    return { locations: results };
  },

  async verifyLocation(env, data) {
    return verifyAttendanceGeofence(env, data || {});
  },

  async createLocation(env, data, me, { broadcastAppEvent }) {
    if (!(await ensureAttendanceLocationSchema(env))) return { error: 'Không thể khởi tạo dữ liệu địa điểm chấm công. Vui lòng thử lại sau.', status: 503 };
    const b = data || {};
    const parseCoord = val => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : null;
      const s = String(val || '').trim().replace(',', '.');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const lat = parseCoord(b.latitude);
    const lng = parseCoord(b.longitude);
    const radius = Math.max(10, parseCoord(b.radius_meters) || 100);
    const maxAccuracy = Math.max(5, parseCoord(b.max_accuracy_meters) || 100);
    if (!String(b.name || '').trim() || lat === null || lng === null) return { error: 'Tên và tọa độ là bắt buộc', status: 400 };
    const r = await env.DB.prepare('INSERT INTO attendance_locations (name,code,address,latitude,longitude,radius_meters,max_accuracy_meters,is_active) VALUES (?,?,?,?,?,?,?,?)')
      .bind(String(b.name).trim(), String(b.code || '').trim() || null, String(b.address || '').trim(), lat, lng, radius, maxAccuracy, b.is_active === false ? 0 : 1).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'location_config', 'attendance_location:created', { id: r.meta.last_row_id }, { actorId: me.id });
    }
    return { ok: true, id: r.meta.last_row_id };
  },

  async updateLocation(env, id, data, me, { broadcastAppEvent }) {
    if (!(await ensureAttendanceLocationSchema(env))) return { error: 'Không thể khởi tạo dữ liệu địa điểm chấm công. Vui lòng thử lại sau.', status: 503 };
    const b = data || {};
    const parseCoord = val => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : null;
      const s = String(val || '').trim().replace(',', '.');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const lat = parseCoord(b.latitude);
    const lng = parseCoord(b.longitude);
    const radius = Math.max(10, parseCoord(b.radius_meters) || 100);
    const maxAccuracy = Math.max(5, parseCoord(b.max_accuracy_meters) || 100);
    if (!String(b.name || '').trim() || lat === null || lng === null) return { error: 'Tên và tọa độ là bắt buộc', status: 400 };
    await env.DB.prepare('UPDATE attendance_locations SET name=?,code=?,address=?,latitude=?,longitude=?,radius_meters=?,max_accuracy_meters=?,is_active=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
      .bind(String(b.name).trim(), String(b.code || '').trim() || null, String(b.address || '').trim(), lat, lng, radius, maxAccuracy, b.is_active === false ? 0 : 1, id).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'location_config', 'attendance_location:updated', { id }, { actorId: me.id });
    }
    return { ok: true };
  },

  async deleteLocation(env, id, me, { broadcastAppEvent }) {
    if (!(await ensureAttendanceLocationSchema(env))) return { error: 'Không thể khởi tạo dữ liệu địa điểm chấm công. Vui lòng thử lại sau.', status: 503 };
    await env.DB.prepare('DELETE FROM attendance_locations WHERE id=?').bind(id).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'location_config', 'attendance_location:deleted', { id }, { actorId: me.id });
    }
    return { ok: true };
  }
};

export async function buildMonthlyOvertimeSummary(env, userId, month, year, baseSalary = 0) {
  const mm = String(month).padStart(2, '0');
  const { results: legacyResults = [] } = await env.DB.prepare(
    "SELECT work_date, COALESCE(approved_minutes, requested_minutes, 0) AS approved_minutes FROM overtime_requests WHERE (user_id=? OR CAST(user_id AS TEXT)=CAST(? AS TEXT)) AND status='approved' AND strftime('%m',work_date)=? AND strftime('%Y',work_date)=?"
  ).bind(userId, userId, mm, String(year)).all();
  const { results: formResults = [] } = await env.DB.prepare(
    `SELECT substr(i.start_at,1,10) AS work_date,
            COALESCE(NULLIF(i.approved_minutes, 0), i.requested_minutes, 0) AS approved_minutes,
            i.time_category
       FROM overtime_form_items i JOIN overtime_forms f ON f.id=i.form_id
      WHERE (f.user_id=? OR CAST(f.user_id AS TEXT)=CAST(? AS TEXT))
        AND f.status IN ('approved','partially_approved')
        AND strftime('%m',substr(i.start_at,1,10))=? AND strftime('%Y',substr(i.start_at,1,10))=?`
  ).bind(userId, userId, mm, String(year)).all();
  const { results: holidays = [] } = await env.DB.prepare(
    "SELECT holiday_date FROM company_holidays WHERE is_active=1 AND strftime('%m',holiday_date)=? AND strftime('%Y',holiday_date)=?"
  ).bind(mm, String(year)).all();
  const holidayDates = new Set(holidays.map(h => h.holiday_date));
  const standardDays = attCountBusinessDays(year, month) || 1;
  const hourlyRate = Number(baseSalary || 0) / standardDays / 8;
  let approvedMinutes = 0;
  let overtimePay = 0;
  for (const item of [...legacyResults, ...formResults]) {
    const minutes = Math.max(0, Number(item.approved_minutes || 0));
    const day = new Date(`${item.work_date}T00:00:00`).getDay();
    const multiplier = item.time_category === 'holiday' || holidayDates.has(item.work_date) ? 3 : item.time_category === 'rest_day' || day === 0 || day === 6 ? 2 : 1.5;
    approvedMinutes += minutes;
    overtimePay += (minutes / 60) * hourlyRate * multiplier;
  }
  return { approvedOvertimeMinutes: approvedMinutes, approvedOvertimeHours: approvedMinutes / 60, overtimePay: Math.round(overtimePay) };
}

