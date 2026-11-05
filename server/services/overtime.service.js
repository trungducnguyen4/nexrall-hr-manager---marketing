import { err } from '../lib/response.js';

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

/**
 * List Overtime Requests with role-based filtering
 */
export async function listOvertimeRequests(env, me, { month, status }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau }) {
  let q = `SELECT o.*,u.full_name,u.employee_code,u.department FROM overtime_requests o JOIN users u ON u.id=o.user_id WHERE 1=1`;
  const binds = [];
  if (!isAttendanceAdmin && !isDirectorHau(me)) {
    q += ' AND o.user_id=?';
    binds.push(me.id);
  } else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && !isDirectorHau(me)) {
    q += ' AND u.department=?';
    binds.push(me.department);
  }
  if (/^\d{4}-\d{2}$/.test(month)) {
    q += " AND strftime('%Y-%m',o.work_date)=?";
    binds.push(month);
  }
  if (['pending', 'pending_director', 'approved', 'rejected'].includes(status)) {
    q += ' AND o.status=?';
    binds.push(status);
  }
  q += " ORDER BY CASE o.status WHEN 'pending' THEN 0 WHEN 'pending_director' THEN 1 ELSE 2 END,o.work_date DESC,o.id DESC";
  const { results = [] } = await (binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q)).all();
  return results;
}

/**
 * Create an Overtime Request for a single checkout
 */
export async function createOvertimeRequest(env, me, { attendanceId, reason }, { attShiftBounds, attToMinutes, broadcastAppEvent }) {
  const record = await env.DB.prepare('SELECT * FROM attendance WHERE id=? AND user_id=?').bind(attendanceId, me.id).first();
  if (!record || !record.checkout_time) {
    return { error: 'Không tìm thấy checkout hợp lệ', status: 404 };
  }
  const bounds = attShiftBounds(record.work_type || 'office', record.shift || 'full', record.expected_start, record.expected_end);
  const requestedMinutes = Math.max(0, (attToMinutes(record.checkout_time) || 0) - (attToMinutes(bounds.end) || 0));
  if (requestedMinutes < 1) {
    return { error: 'Checkout không muộn hơn giờ kết thúc ca', status: 400 };
  }
  try {
    const r = await env.DB.prepare('INSERT INTO overtime_requests (attendance_id,user_id,work_date,shift_end_time,checkout_time,requested_minutes,reason,status) VALUES (?,?,?,?,?,?,?,\'pending\')')
      .bind(record.id, me.id, record.date, bounds.end, record.checkout_time, requestedMinutes, reason).run();
    const overtimeReqId = r.meta.last_row_id;
    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime:requested', {
        id: overtimeReqId,
        attendance_id: record.id,
        user_id: me.id,
        user_name: me.full_name,
        employee_code: me.employee_code,
        department: me.department,
        work_date: record.date,
        requested_minutes: requestedMinutes,
        reason,
        status: 'pending',
      }, { actorId: me.id });
    }
    return { ok: true, id: overtimeReqId, requested_minutes: requestedMinutes };
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return { error: 'Đã gửi yêu cầu làm thêm giờ cho checkout này', status: 400 };
    }
    throw e;
  }
}

/**
 * Perform review action (approve/reject/step1 forward) on an Overtime Request
 */
export async function actionOvertimeRequest(env, me, id, action, { note, approvedMinutesInput }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau, refreshInvoiceOvertime, createEmployeePopup, broadcastAppEvent }) {
  if (!isAttendanceAdmin && !isDirectorHau(me)) {
    return { error: 'Không có quyền duyệt làm thêm giờ', status: 403 };
  }
  const requestRow = await env.DB.prepare('SELECT o.*,u.department FROM overtime_requests o JOIN users u ON u.id=o.user_id WHERE o.id=?').bind(id).first();
  if (!requestRow) {
    return { error: 'Không tìm thấy yêu cầu làm thêm giờ', status: 404 };
  }
  if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && !isDirectorHau(me) && requestRow.department !== me.department) {
    return { error: 'Không có quyền duyệt yêu cầu ngoài phòng ban', status: 403 };
  }

  const currentStatus = requestRow.status || 'pending';
  if (!['pending', 'pending_director'].includes(currentStatus)) {
    return { error: 'Yêu cầu đã được xử lý', status: 400 };
  }

  const isHau = isDirectorHau(me);
  if (currentStatus === 'pending_director' && !isHau) {
    return { error: 'Chỉ anh Hậu (Phó Tổng Giám Đốc) hoặc Quản trị viên mới có quyền phê duyệt bước cuối cùng.', status: 403 };
  }

  if (action === 'reject' && !note) {
    return { error: 'Vui lòng nhập lý do từ chối', status: 400 };
  }

  const approvedMinutes = action === 'approve'
    ? Math.min(Math.max(0, parseInt(approvedMinutesInput ?? requestRow.requested_minutes) || 0), requestRow.requested_minutes)
    : 0;
  if (action === 'approve' && approvedMinutes < 1) {
    return { error: 'Số phút được duyệt phải lớn hơn 0', status: 400 };
  }

  if (action === 'reject') {
    const nextStatus = 'rejected';
    await env.DB.prepare("UPDATE overtime_requests SET status=?,approved_minutes=0,reviewer_id=?,reviewer_name=?,review_note=?,reviewed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?")
      .bind(nextStatus, me.id, me.full_name || '', note || null, id).run();

    if (createEmployeePopup) {
      await createEmployeePopup(env, {
        userId: requestRow.user_id,
        requestType: 'overtime',
        requestId: id,
        decision: 'rejected',
        title: 'Đơn làm thêm giờ (OT) bị từ chối',
        message: `Yêu cầu làm thêm giờ ngày ${requestRow.work_date} của bạn đã bị từ chối bởi ${me.full_name || 'Quản lý'}.${note ? ` Lý do: ${note}` : ''}`,
        details: {
          request_type: 'overtime',
          request_id: id,
          work_date: requestRow.work_date,
          requested_minutes: requestRow.requested_minutes,
          reviewer_name: me.full_name,
          reason: note,
        },
        actorId: me.id,
        actorName: me.full_name || '',
        broadcastAppEvent,
      });
    }

    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime:rejected', {
        id,
        user_id: requestRow.user_id,
        status: nextStatus,
        approved_minutes: 0,
        reviewer_id: me.id,
        reviewer_name: me.full_name || '',
        review_note: note || null,
        final: true,
      }, { actorId: me.id });
    }

    return { ok: true, status: nextStatus, approved_minutes: 0, final: true };
  }

  // action === 'approve'
  const isFinalApproval = currentStatus === 'pending_director' || isHau;
  if (isFinalApproval) {
    const nextStatus = 'approved';
    await env.DB.prepare("UPDATE overtime_requests SET status=?,approved_minutes=?,reviewer_id=?,reviewer_name=?,review_note=?,reviewed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?")
      .bind(nextStatus, approvedMinutes, me.id, me.full_name || '', note || null, id).run();
    const d = new Date(`${requestRow.work_date}T00:00:00`);
    const ot = await refreshInvoiceOvertime(env, requestRow.user_id, d.getMonth() + 1, d.getFullYear(), me);

    if (createEmployeePopup) {
      await createEmployeePopup(env, {
        userId: requestRow.user_id,
        requestType: 'overtime',
        requestId: id,
        decision: 'approved',
        title: 'Đơn làm thêm giờ (OT) đã được phê duyệt!',
        message: `Yêu cầu làm thêm giờ ngày ${requestRow.work_date} (${approvedMinutes} phút) đã được ${isHau ? 'anh Hậu (Phó Tổng Giám Đốc)' : (me.full_name || 'Ban Giám Đốc')} phê duyệt chính thức.${note ? ` Ghi chú: ${note}` : ''}`,
        details: {
          request_type: 'overtime',
          request_id: id,
          work_date: requestRow.work_date,
          requested_minutes: requestRow.requested_minutes,
          approved_minutes: approvedMinutes,
          reviewer_name: isHau ? 'Anh Hậu (Phó Tổng Giám Đốc)' : me.full_name,
          note,
        },
        actorId: me.id,
        actorName: me.full_name || '',
        broadcastAppEvent,
      });
    }

    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime:approved', {
        id,
        user_id: requestRow.user_id,
        status: nextStatus,
        approved_minutes: approvedMinutes,
        reviewer_id: me.id,
        reviewer_name: me.full_name || '',
        review_note: note || null,
        overtime: ot,
        final: true,
      }, { actorId: me.id });
    }

    return { ok: true, status: nextStatus, approved_minutes: approvedMinutes, overtime: ot, final: true };
  } else {
    const nextStatus = 'pending_director';
    await env.DB.prepare("UPDATE overtime_requests SET status=?,approved_minutes=?,step1_reviewer_id=?,step1_reviewer_name=?,step1_reviewed_at=datetime('now','localtime'),step1_note=?,updated_at=datetime('now','localtime') WHERE id=?")
      .bind(nextStatus, approvedMinutes, me.id, me.full_name || '', note || null, id).run();

    try {
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type, link) VALUES (?, ?, ?, 'attendance', '/attendance')"
      ).bind(
        requestRow.user_id,
        'Tiến độ yêu cầu OT (Bước 1 đã duyệt)',
        `HCNS (${me.full_name}) đã duyệt bước 1 yêu cầu làm thêm giờ ngày ${requestRow.work_date} (${approvedMinutes} phút). Đang chờ anh Hậu phê duyệt chốt.`
      ).run();
    } catch (_) {}

    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime:forwarded', {
        id,
        user_id: requestRow.user_id,
        status: nextStatus,
        approved_minutes: approvedMinutes,
        step1_reviewer_id: me.id,
        step1_reviewer_name: me.full_name || '',
        step1_note: note || null,
        final: false,
      }, { actorId: me.id });
    }

    return { ok: true, status: nextStatus, approved_minutes: approvedMinutes, final: false };
  }
}

/**
 * List Overtime Forms with item aggregation
 */
export async function listOvertimeForms(env, me, { month, status }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau }) {
  let q = `SELECT f.*,u.full_name,u.employee_code,u.department FROM overtime_forms f JOIN users u ON u.id=f.user_id WHERE 1=1`;
  const binds = [];
  if (!isAttendanceAdmin && !isDirectorHau(me)) {
    q += ' AND f.user_id=?';
    binds.push(me.id);
  } else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && !isDirectorHau(me)) {
    q += ' AND u.department=?';
    binds.push(me.department);
  }
  if (/^\d{4}-\d{2}$/.test(month)) {
    q += ' AND f.period_month=?';
    binds.push(month);
  }
  if (['draft', 'pending', 'pending_director', 'approved', 'partially_approved', 'rejected'].includes(status)) {
    q += ' AND f.status=?';
    binds.push(status);
  }
  q += " ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'pending_director' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,f.period_month DESC,f.id DESC";
  const { results: forms = [] } = await (binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q)).all();
  for (const form of forms) {
    form.items = (await env.DB.prepare('SELECT * FROM overtime_form_items WHERE form_id=? ORDER BY start_at,id').bind(form.id).all()).results || [];
    form.requested_minutes = form.items.reduce((sum, item) => sum + Number(item.requested_minutes || 0), 0);
    form.approved_minutes = form.items.reduce((sum, item) => sum + Number(item.approved_minutes || 0), 0);
  }
  return forms;
}

/**
 * Create Overtime Form and items
 */
export async function createOvertimeForm(env, me, { periodMonth, rawItems, submit, proofUrl }, { broadcastAppEvent }) {
  const validated = normalizeOvertimeItems(rawItems, periodMonth);
  if (validated.error) return { error: validated.error, status: 400 };
  const items = await applyCalendarOvertimeCategories(env, validated.items);
  const status = submit === false ? 'draft' : 'pending';
  const cleanProofUrl = proofUrl ? String(proofUrl).trim().slice(0, 10000) : null;
  const r = await env.DB.prepare(
    "INSERT INTO overtime_forms (user_id,period_month,status,source,submitted_at,proof_url) VALUES (?,?,?,?,CASE WHEN ?='pending' THEN datetime('now','localtime') ELSE NULL END,?)"
  ).bind(me.id, periodMonth, status, 'employee', status, cleanProofUrl).run();
  const formId = r.meta.last_row_id;
  await env.DB.batch(items.map(item => env.DB.prepare(
    'INSERT INTO overtime_form_items (form_id,start_at,end_at,requested_minutes,reason,time_category,proof_url) VALUES (?,?,?,?,?,?,?)'
  ).bind(formId, item.start_at, item.end_at, item.requested_minutes, item.reason, item.time_category, item.proof_url || null)));
  if (broadcastAppEvent) {
    await broadcastAppEvent(env, 'attendance', 'overtime_form:created', {
      id: formId,
      user_id: me.id,
      period_month: periodMonth,
      status,
      proof_url: cleanProofUrl,
    }, { actorId: me.id });
  }
  return { ok: true, id: formId, status };
}

/**
 * Update an existing draft Overtime Form
 */
export async function updateOvertimeForm(env, me, formId, { periodMonthInput, rawItems, proofUrlInput }, { broadcastAppEvent }) {
  const form = await env.DB.prepare('SELECT * FROM overtime_forms WHERE id=?').bind(formId).first();
  if (!form) return { error: 'Không tìm thấy form OT', status: 404 };
  if (Number(form.user_id) !== Number(me.id) || form.status !== 'draft') {
    return { error: 'Chỉ được sửa form OT nháp của chính bạn', status: 403 };
  }
  const periodMonth = String(periodMonthInput || form.period_month);
  const validated = normalizeOvertimeItems(rawItems, periodMonth);
  if (validated.error) return { error: validated.error, status: 400 };
  const items = await applyCalendarOvertimeCategories(env, validated.items);
  const proofUrl = proofUrlInput !== undefined ? (proofUrlInput ? String(proofUrlInput).trim().slice(0, 10000) : null) : (form.proof_url || null);
  await env.DB.batch([
    env.DB.prepare("UPDATE overtime_forms SET period_month=?,proof_url=?,updated_at=datetime('now','localtime') WHERE id=?").bind(periodMonth, proofUrl, formId),
    env.DB.prepare('DELETE FROM overtime_form_items WHERE form_id=?').bind(formId),
    ...items.map(item => env.DB.prepare('INSERT INTO overtime_form_items (form_id,start_at,end_at,requested_minutes,reason,time_category,proof_url) VALUES (?,?,?,?,?,?,?)').bind(formId, item.start_at, item.end_at, item.requested_minutes, item.reason, item.time_category, item.proof_url || null)),
  ]);
  if (broadcastAppEvent) {
    await broadcastAppEvent(env, 'attendance', 'overtime_form:updated', {
      id: formId,
      user_id: me.id,
      period_month: periodMonth,
      proof_url: proofUrl,
    }, { actorId: me.id });
  }
  return { ok: true };
}

/**
 * Submit draft Overtime Form
 */
export async function submitOvertimeForm(env, me, formId, { broadcastAppEvent }) {
  const form = await env.DB.prepare('SELECT * FROM overtime_forms WHERE id=?').bind(formId).first();
  if (!form) return { error: 'Không tìm thấy form OT', status: 404 };
  if (Number(form.user_id) !== Number(me.id) || form.status !== 'draft') {
    return { error: 'Chỉ được gửi form OT nháp của chính bạn', status: 403 };
  }
  await env.DB.prepare("UPDATE overtime_forms SET status='pending',submitted_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").bind(formId).run();
  if (broadcastAppEvent) {
    await broadcastAppEvent(env, 'attendance', 'overtime_form:submitted', {
      id: formId,
      user_id: me.id,
      status: 'pending',
    }, { actorId: me.id });
  }
  return { ok: true, status: 'pending' };
}

/**
 * Decision on Overtime Form (approve/reject/step1 forward)
 */
export async function decisionOvertimeForm(env, me, formId, { action, note, itemDecisions }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau, refreshInvoiceOvertime, createEmployeePopup, broadcastAppEvent }) {
  if (!isAttendanceAdmin && !isDirectorHau(me)) return { error: 'Không có quyền duyệt form OT', status: 403 };
  const form = await env.DB.prepare('SELECT f.*,u.department FROM overtime_forms f JOIN users u ON u.id=f.user_id WHERE f.id=?').bind(formId).first();
  if (!form) return { error: 'Không tìm thấy form OT', status: 404 };
  if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && !isDirectorHau(me) && form.department !== me.department) {
    return { error: 'Không có quyền duyệt form ngoài phòng ban', status: 403 };
  }

  const currentStatus = form.status || 'pending';
  if (!['pending', 'pending_director'].includes(currentStatus)) return { error: 'Form OT đã được xử lý', status: 400 };

  const isHau = isDirectorHau(me);
  if (currentStatus === 'pending_director' && !isHau) {
    return { error: 'Chỉ anh Hậu (Phó Tổng Giám Đốc) hoặc Quản trị viên mới có quyền phê duyệt bước cuối cùng.', status: 403 };
  }

  if (action === 'reject' && !note) return { error: 'Vui lòng nhập lý do từ chối', status: 400 };

  const { results: items = [] } = await env.DB.prepare('SELECT * FROM overtime_form_items WHERE form_id=? ORDER BY id').bind(formId).all();
  const supplied = new Map((Array.isArray(itemDecisions) ? itemDecisions : []).map(item => [Number(item.id), Number(item.approved_minutes)]));
  const updates = [];
  let approvedTotal = 0;
  for (const item of items) {
    const approved = action === 'reject' ? 0 : Math.min(Math.max(0, Number.isFinite(supplied.get(Number(item.id))) ? supplied.get(Number(item.id)) : Number(item.requested_minutes)), Number(item.requested_minutes));
    approvedTotal += approved;
    updates.push(env.DB.prepare("UPDATE overtime_form_items SET approved_minutes=?,updated_at=datetime('now','localtime') WHERE id=?").bind(Math.round(approved), item.id));
  }
  const requestedTotal = items.reduce((sum, item) => sum + Number(item.requested_minutes || 0), 0);

  if (action === 'reject') {
    const nextStatus = 'rejected';
    updates.push(env.DB.prepare("UPDATE overtime_forms SET status=?,review_note=?,reviewer_id=?,reviewer_name=?,reviewed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").bind(nextStatus, note || null, me.id, me.full_name || '', formId));
    await env.DB.batch(updates);

    if (createEmployeePopup) {
      await createEmployeePopup(env, {
        userId: form.user_id,
        requestType: 'overtime_form',
        requestId: formId,
        decision: 'rejected',
        title: 'Bảng kê OT tháng bị từ chối',
        message: `Bảng kê làm thêm giờ tháng ${form.period_month} của bạn đã bị từ chối bởi ${me.full_name || 'Quản lý'}.${note ? ` Lý do: ${note}` : ''}`,
        details: {
          request_type: 'overtime_form',
          request_id: formId,
          period_month: form.period_month,
          requested_minutes: requestedTotal,
          reviewer_name: me.full_name,
          reason: note,
        },
        actorId: me.id,
        actorName: me.full_name || '',
        broadcastAppEvent,
      });
    }

    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime_form:decided', {
        id: formId,
        user_id: form.user_id,
        status: nextStatus,
        approved_minutes: 0,
        final: true,
      }, { actorId: me.id });
    }

    return { ok: true, status: nextStatus, approved_minutes: 0, final: true };
  }

  // action === 'approve'
  const isFinalApproval = currentStatus === 'pending_director' || isHau;
  if (isFinalApproval) {
    const nextStatus = approvedTotal === requestedTotal ? 'approved' : 'partially_approved';
    updates.push(env.DB.prepare("UPDATE overtime_forms SET status=?,review_note=?,reviewer_id=?,reviewer_name=?,reviewed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").bind(nextStatus, note || null, me.id, me.full_name || '', formId));
    await env.DB.batch(updates);

    const [year, month] = form.period_month.split('-').map(Number);
    const overtime = await refreshInvoiceOvertime(env, form.user_id, month, year, me);

    if (createEmployeePopup) {
      await createEmployeePopup(env, {
        userId: form.user_id,
        requestType: 'overtime_form',
        requestId: formId,
        decision: 'approved',
        title: 'Bảng kê OT tháng đã được phê duyệt!',
        message: `Bảng kê làm thêm giờ tháng ${form.period_month} (${approvedTotal} phút) đã được ${isHau ? 'anh Hậu (Phó Tổng Giám Đốc)' : (me.full_name || 'Ban Giám Đốc')} phê duyệt chính thức.${note ? ` Ghi chú: ${note}` : ''}`,
        details: {
          request_type: 'overtime_form',
          request_id: formId,
          period_month: form.period_month,
          requested_minutes: requestedTotal,
          approved_minutes: approvedTotal,
          reviewer_name: isHau ? 'Anh Hậu (Phó Tổng Giám Đốc)' : me.full_name,
          note,
        },
        actorId: me.id,
        actorName: me.full_name || '',
        broadcastAppEvent,
      });
    }

    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime_form:decided', {
        id: formId,
        user_id: form.user_id,
        status: nextStatus,
        approved_minutes: approvedTotal,
        overtime,
        final: true,
      }, { actorId: me.id });
    }

    return { ok: true, status: nextStatus, approved_minutes: approvedTotal, overtime, final: true };
  } else {
    const nextStatus = 'pending_director';
    updates.push(env.DB.prepare("UPDATE overtime_forms SET status=?,step1_note=?,step1_reviewer_id=?,step1_reviewer_name=?,step1_reviewed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").bind(nextStatus, note || null, me.id, me.full_name || '', formId));
    await env.DB.batch(updates);

    try {
      await env.DB.prepare(
        "INSERT INTO notifications (user_id, title, content, type, link) VALUES (?, ?, ?, 'attendance', '/attendance')"
      ).bind(
        form.user_id,
        'Tiến độ bảng kê OT (Bước 1 đã duyệt)',
        `HCNS (${me.full_name}) đã duyệt bước 1 bảng kê OT tháng ${form.period_month} (${approvedTotal} phút). Đang chờ anh Hậu phê duyệt chốt.`
      ).run();
    } catch (_) {}

    if (broadcastAppEvent) {
      await broadcastAppEvent(env, 'attendance', 'overtime_form:forwarded', {
        id: formId,
        user_id: form.user_id,
        status: nextStatus,
        approved_minutes: approvedTotal,
        step1_reviewer_id: me.id,
        step1_reviewer_name: me.full_name || '',
        step1_note: note || null,
        final: false,
      }, { actorId: me.id });
    }

    return { ok: true, status: nextStatus, approved_minutes: approvedTotal, final: false };
  }
}
