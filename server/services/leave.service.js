/**
 * Leave & Policies Service
 * Quản lý loại nghỉ, chính sách nghỉ, số dư phép năm/nghỉ bù, quy trình duyệt 2 bước, tài liệu và ngày lễ
 */

import { attCountBusinessDaysBetween } from './attendance.service.js';

export const LEAVE_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const LEAVE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export function leavePolicyFor(type) {
  const flow = String(type?.approval_flow || '').trim();
  if (flow) return flow;
  return type?.requires_bod_approval ? 'manager_hr_bgd' : 'manager_hr';
}

export function leavePaidLabel(policy) {
  return policy === 'unpaid' ? 'Không hưởng lương' : policy === 'configurable' ? 'Theo chế độ' : 'Có hưởng lương';
}

export function leaveDaysForSession(startDate, endDate, session) {
  const businessDays = attCountBusinessDaysBetween(startDate, endDate);
  if (!businessDays) return 0;
  return session === 'morning' || session === 'afternoon' ? 0.5 : businessDays;
}

export function leaveBalanceType(type) {
  return type?.deducts_annual_leave ? 'annual' : type?.code === 'compensatory' ? 'compensatory' : null;
}

export async function getLeaveBalance(env, userId, leaveTypeCode, year) {
  const row = await env.DB.prepare(
    'SELECT available_days FROM leave_balances WHERE user_id=? AND leave_type_code=? AND balance_year=?'
  ).bind(userId, leaveTypeCode, year).first();
  if (row !== null && row !== undefined && row.available_days !== null) {
    return Number(row.available_days);
  }
  if (leaveTypeCode === 'annual') {
    const user = await env.DB.prepare('SELECT employee_type, lifecycle_status, contract_type FROM users WHERE id=?').bind(userId).first();
    const isOfficial = user && user.employee_type !== 'TTS' && user.lifecycle_status !== 'Thử việc' && user.lifecycle_status !== 'Thực tập' && user.contract_type !== 'Thử việc' && user.contract_type !== 'Thỏa thuận TTS';
    return isOfficial ? 12 : 0;
  }
  return 0;
}

export function canManageLeaveRequest(me, request, { isHrOrBod }) {
  if (typeof isHrOrBod === 'function' && isHrOrBod(me)) return true;
  return me?.role === 'manager' && !!request?.department && me.department === request.department;
}

export function canAdvanceLeaveApproval(me, request, { isDirectorHau, isStep1Approver, normalizeDeptName }) {
  if (!me || !request) return false;
  if (['approved', 'rejected'].includes(request.status)) return false;

  // Không cho phép tự duyệt đơn của chính mình (trừ khi là admin)
  if (Number(request.employee_id) === Number(me.id) || String(request.user_id) === String(me.id) || String(request.user_id) === String(me.employee_code || '')) {
    if (me?.role !== 'admin') return false;
  }

  // Anh Hậu (Phó Tổng Giám Đốc) hoặc Quản trị viên (admin) có toàn quyền duyệt ở bất kỳ bước nào
  if (typeof isDirectorHau === 'function' && isDirectorHau(me)) return true;

  const currentLevel = Number(request.approval_level || 1);
  const status = String(request.status || '');
  // Bước 2: Trạng thái 'pending_director' hoặc approval_level === 2 -> Chỉ anh Hậu (hoặc Admin) duyệt chốt
  if (status === 'pending_director' || currentLevel === 2) {
    return typeof isDirectorHau === 'function' && isDirectorHau(me);
  }

  // Bước 1: Trạng thái 'pending' hoặc approval_level === 1 -> HCNS hoặc Quản lý phòng ban duyệt sơ bộ
  if (status === 'pending' || currentLevel === 1) {
    if (typeof isStep1Approver === 'function' && isStep1Approver(me)) return true;
    const isDeptMgr = me?.role === 'manager' && !!request?.department && 
      (typeof normalizeDeptName === 'function' ? normalizeDeptName(me?.department) === normalizeDeptName(request?.department) : me?.department === request?.department);
    return isDeptMgr;
  }

  return false;
}

export async function ensureLeavePolicySchema(env) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type_code TEXT NOT NULL,
    balance_year INTEGER NOT NULL, available_days REAL NOT NULL DEFAULT 0,
    updated_by INTEGER, updated_by_name TEXT, updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, leave_type_code, balance_year)
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_balance_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type_code TEXT NOT NULL,
    balance_year INTEGER NOT NULL, leave_request_id INTEGER, delta_days REAL NOT NULL,
    entry_type TEXT NOT NULL, note TEXT, created_by INTEGER, created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_request_documents (
    id TEXT PRIMARY KEY, leave_request_id INTEGER, owner_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE, required_label TEXT, uploaded_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  for (const [column, type] of Object.entries({
    short_description: 'TEXT', policy_description: 'TEXT', notice_hours: 'INTEGER',
    required_documents: 'TEXT', requires_handover: 'INTEGER DEFAULT 0', approval_flow: 'TEXT',
  })) { try { await env.DB.exec(`ALTER TABLE leave_types ADD COLUMN ${column} ${type}`); } catch (_) {} }
  for (const [column, type] of Object.entries({
    leave_session: "TEXT DEFAULT 'full'", total_days: 'REAL', handover_user_id: 'INTEGER',
    handover_user_name: 'TEXT', approval_flow: 'TEXT', balance_reserved_days: 'REAL DEFAULT 0',
    approved_by: 'INTEGER', approved_by_name: 'TEXT', approved_at: 'TEXT',
    rejected_by: 'INTEGER', rejected_by_name: 'TEXT', rejected_at: 'TEXT',
    rejection_note: 'TEXT',
  })) { try { await env.DB.exec(`ALTER TABLE leave_requests ADD COLUMN ${column} ${type}`); } catch (_) {} }
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id,balance_year,leave_type_code)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_leave_documents_request ON leave_request_documents(leave_request_id,owner_id)'); } catch (_) {}
}

export async function seedLeaveTypes(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    paid_policy TEXT DEFAULT 'paid',
    deducts_annual_leave INTEGER DEFAULT 0,
    requires_evidence INTEGER DEFAULT 0,
    requires_bod_approval INTEGER DEFAULT 0,
    max_days INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  const rows = [
    ['annual', 'Phép năm', 'paid', 1, 0, 0, null, 1],
    ['sick', 'Nghỉ ốm', 'paid', 0, 1, 0, null, 1],
    ['personal', 'Nghỉ việc riêng', 'unpaid', 0, 0, 0, null, 1],
    ['maternity', 'Nghỉ thai sản', 'paid', 0, 1, 1, null, 1],
    ['unpaid', 'Nghi khong huong luong', 'unpaid', 0, 0, 1, null, 1],
    ['personal_paid', 'Nghi viec rieng huong luong', 'paid', 0, 0, 0, null, 1],
    ['compensatory', 'Nghi bu', 'paid', 0, 0, 0, null, 1],
    ['other', 'Khác', 'configurable', 0, 0, 0, null, 1],
  ];
  await env.DB.batch(rows.map(r => env.DB.prepare(
    'INSERT OR IGNORE INTO leave_types (code,name,paid_policy,deducts_annual_leave,requires_evidence,requires_bod_approval,max_days,is_active) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(...r)));
}

export const LeaveService = {
  async listTypes(env, url) {
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    const q = includeInactive ? 'SELECT * FROM leave_types ORDER BY is_active DESC, name' : 'SELECT * FROM leave_types WHERE is_active=1 ORDER BY name';
    const { results } = await env.DB.prepare(q).all();
    return { leaveTypes: results || [] };
  },

  async createType(env, data, me, { isHcns }) {
    if (!isHcns(me)) return { error: 'Không có quyền', status: 403 };
    const b = data || {};
    const code = String(b.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const name = String(b.name || '').trim();
    if (!code || !name) return { error: 'Thiếu mã hoặc tên loại nghỉ', status: 400 };
    const r = await env.DB.prepare(
      'INSERT INTO leave_types (code,name,paid_policy,deducts_annual_leave,requires_evidence,requires_bod_approval,max_days,is_active,short_description,policy_description,notice_hours,required_documents,requires_handover,approval_flow) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(code, name, b.paid_policy || 'paid', b.deducts_annual_leave ? 1 : 0, b.requires_evidence ? 1 : 0, b.requires_bod_approval ? 1 : 0, b.max_days || null, b.is_active ?? 1, String(b.short_description || '').trim(), String(b.policy_description || '').trim(), b.notice_hours === '' || b.notice_hours == null ? null : Number(b.notice_hours), String(b.required_documents || '').trim(), b.requires_handover ? 1 : 0, String(b.approval_flow || '').trim()).run();
    return { ok: true, id: r.meta.last_row_id };
  },

  async updateType(env, id, data, me, { isHcns }) {
    if (!isHcns(me)) return { error: 'Không có quyền', status: 403 };
    const b = data || {};
    const code = String(b.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const name = String(b.name || '').trim();
    if (!code || !name) return { error: 'Thiếu mã hoặc tên loại nghỉ', status: 400 };
    await env.DB.prepare(
      "UPDATE leave_types SET code=?,name=?,paid_policy=?,deducts_annual_leave=?,requires_evidence=?,requires_bod_approval=?,max_days=?,is_active=?,short_description=?,policy_description=?,notice_hours=?,required_documents=?,requires_handover=?,approval_flow=?,updated_at=datetime('now','localtime') WHERE id=?"
    ).bind(code, name, b.paid_policy || 'paid', b.deducts_annual_leave ? 1 : 0, b.requires_evidence ? 1 : 0, b.requires_bod_approval ? 1 : 0, b.max_days || null, b.is_active ?? 1, String(b.short_description || '').trim(), String(b.policy_description || '').trim(), b.notice_hours === '' || b.notice_hours == null ? null : Number(b.notice_hours), String(b.required_documents || '').trim(), b.requires_handover ? 1 : 0, String(b.approval_flow || '').trim(), id).run();
    return { ok: true };
  },

  async deleteType(env, id, me, { isHcns }) {
    if (!isHcns(me)) return { error: 'Không có quyền', status: 403 };
    await env.DB.prepare("UPDATE leave_types SET is_active=0,updated_at=datetime('now','localtime') WHERE id=?").bind(id).run();
    return { ok: true };
  },

  async getBalances(env, url, me, { isHcns }) {
    const requestedUserId = Number(url.searchParams.get('user_id') || me.id);
    if (requestedUserId !== Number(me.id) && !isHcns(me)) return { error: 'Không có quyền xem số dư', status: 403 };
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());
    const targetUser = await env.DB.prepare('SELECT employee_type, lifecycle_status, contract_type FROM users WHERE id=?').bind(requestedUserId).first();
    const isOfficial = targetUser && targetUser.employee_type !== 'TTS' && targetUser.lifecycle_status !== 'Thử việc' && targetUser.lifecycle_status !== 'Thực tập' && targetUser.contract_type !== 'Thử việc' && targetUser.contract_type !== 'Thỏa thuận TTS';
    const defaultAnnualDays = isOfficial ? 12 : 0;

    let { results = [] } = await env.DB.prepare(
      'SELECT leave_type_code,available_days,balance_year,updated_at FROM leave_balances WHERE user_id=? AND balance_year=?'
    ).bind(requestedUserId, year).all();

    if (!results.find(x => x.leave_type_code === 'annual')) {
      results.push({
        leave_type_code: 'annual',
        available_days: defaultAnnualDays,
        balance_year: year,
      });
    }
    return { balances: results, year, is_official: isOfficial, default_annual_days: defaultAnnualDays };
  },

  async adjustBalance(env, data, me, { isHcns, broadcastAppEvent }) {
    if (!isHcns(me)) return { error: 'Chỉ HCNS được điều chỉnh số dư', status: 403 };
    const b = data || {};
    const userId = Number(b.user_id), typeCode = String(b.leave_type_code || '');
    const year = Number(b.balance_year || new Date().getFullYear()), delta = Number(b.delta_days);
    const note = String(b.note || '').trim();
    if (!Number.isInteger(userId) || !['annual', 'compensatory'].includes(typeCode) || !Number.isFinite(delta) || !delta || !note) {
      return { error: 'Dữ liệu điều chỉnh số dư không hợp lệ hoặc thiếu ghi chú', status: 400 };
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO leave_balances (user_id,leave_type_code,balance_year,available_days,updated_by,updated_by_name)
        VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,leave_type_code,balance_year) DO UPDATE SET available_days=leave_balances.available_days+excluded.available_days,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=datetime('now','localtime')`)
        .bind(userId, typeCode, year, delta, me.id, me.full_name || ''),
      env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)')
        .bind(userId, typeCode, year, delta, 'hr_adjustment', note, me.id, me.full_name || ''),
    ]);
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'leave', 'leave_balance:updated', {
        user_id: userId,
        leave_type_code: typeCode,
        balance_year: year,
        delta_days: delta,
        note,
      }, { actorId: me.id });
    }
    return { ok: true };
  },

  async uploadDocument(env, form, me, { safeDownloadName, employeeDocumentContentMatches }) {
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ tài liệu chưa được cấu hình', status: 503 };
    const file = form?.get('file');
    if (!file || typeof file.stream !== 'function') return { error: 'Vui lòng chọn tệp đính kèm', status: 400 };
    const contentType = String(file.type || '').toLowerCase();
    if (!LEAVE_DOCUMENT_TYPES.includes(contentType) || !Number.isFinite(file.size) || file.size < 1 || file.size > LEAVE_DOCUMENT_MAX_BYTES) {
      return { error: 'Chỉ nhận PDF, JPG, PNG hoặc WebP, tối đa 10 MB', status: 400 };
    }
    const bytes = await file.arrayBuffer();
    if (typeof employeeDocumentContentMatches === 'function' && !employeeDocumentContentMatches(contentType, bytes)) {
      return { error: 'Nội dung tệp không khớp định dạng', status: 400 };
    }
    const documentId = crypto.randomUUID(), storageKey = `leave-requests/${me.id}/${documentId}`;
    await env.HR_DOCUMENTS.put(storageKey, bytes, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { owner_id: String(me.id) } });
    const filename = typeof safeDownloadName === 'function' ? safeDownloadName(file.name) : file.name;
    await env.DB.prepare('INSERT INTO leave_request_documents (id,owner_id,original_filename,content_type,byte_size,storage_key,required_label) VALUES (?,?,?,?,?,?,?)')
      .bind(documentId, me.id, filename, contentType, file.size, storageKey, String(form?.get('label') || '').slice(0, 120)).run();
    return { ok: true, id: documentId, filename };
  },

  async listRequests(env, url, me, { isHrOrBod, isDirectorHau, isStep1Approver, normalizeDeptName }) {
    const statusFilter = url.searchParams.get('status') || '';
    const scope = url.searchParams.get('scope') || '';
    const selfOnly = url.searchParams.get('self') === '1' || scope === 'mine';
    const canReview = me.role === 'admin' || (typeof isHrOrBod === 'function' && isHrOrBod(me)) || me.role === 'manager';
    let query, params;
    const leaveSelectFields = `lr.*, u.full_name as employee_name, u.employee_code, u.department, lt.name AS type_name, lt.paid_policy, lt.deducts_annual_leave, lt.requires_evidence, lt.requires_bod_approval, lt.max_days, lt.short_description AS type_short_description, lt.policy_description AS type_policy_description, lt.notice_hours AS type_notice_hours, lt.required_documents AS type_required_documents, lt.requires_handover AS type_requires_handover,
      COALESCE(lr.approved_by_name, (SELECT actor_name FROM leave_approval_history WHERE leave_request_id=lr.id AND action='approved' ORDER BY id DESC LIMIT 1)) AS approved_by_name,
      COALESCE(lr.approved_at, (SELECT created_at FROM leave_approval_history WHERE leave_request_id=lr.id AND action='approved' ORDER BY id DESC LIMIT 1)) AS approved_at,
      COALESCE(lr.rejected_by_name, (SELECT actor_name FROM leave_approval_history WHERE leave_request_id=lr.id AND action='rejected' ORDER BY id DESC LIMIT 1)) AS rejected_by_name,
      COALESCE(lr.rejected_at, (SELECT created_at FROM leave_approval_history WHERE leave_request_id=lr.id AND action='rejected' ORDER BY id DESC LIMIT 1)) AS rejected_at,
      COALESCE(lr.rejection_note, (SELECT note FROM leave_approval_history WHERE leave_request_id=lr.id AND action='rejected' ORDER BY id DESC LIMIT 1)) AS rejection_note,
      COALESCE(lr.submitted_at, (SELECT created_at FROM leave_approval_history WHERE leave_request_id=lr.id AND action='submitted' ORDER BY id ASC LIMIT 1)) AS submitted_at`;

    if (!canReview || selfOnly) {
      query = `SELECT ${leaveSelectFields} FROM leave_requests lr
                LEFT JOIN users u ON lr.user_id=u.employee_code OR CAST(lr.user_id AS TEXT)=CAST(u.id AS TEXT) OR lr.employee_id=u.id
                LEFT JOIN leave_types lt ON lr.type=lt.code
                WHERE (CAST(lr.user_id AS TEXT)=CAST(? AS TEXT) OR CAST(lr.employee_id AS TEXT)=CAST(? AS TEXT) OR lr.user_id=?)`;
      params = [String(me.id), String(me.id), String(me.employee_code || '')];
    } else {
      query = `SELECT ${leaveSelectFields} FROM leave_requests lr
                LEFT JOIN users u ON CAST(lr.user_id AS TEXT)=CAST(u.id AS TEXT) OR lr.user_id=u.employee_code OR lr.employee_id=u.id
                LEFT JOIN leave_types lt ON lr.type=lt.code
                WHERE 1=1`;
      params = [];
      if (typeof isHrOrBod === 'function' && !isHrOrBod(me)) {
        query += ' AND u.department=?';
        params.push(me.department);
      }
    }
    if (statusFilter) { query += ' AND lr.status=?'; params.push(statusFilter); }
    query += " ORDER BY CASE WHEN lr.status = 'pending' THEN 0 WHEN lr.status = 'pending_director' THEN 1 ELSE 2 END ASC, COALESCE(lr.submitted_at, lr.id) DESC, lr.id DESC";
    try {
      await env.DB.prepare("UPDATE leave_requests SET current_approver='Quản lý / HR' WHERE status='pending' AND current_approver IN ('Quản lý trực tiếp', 'Ban Giám đốc')").run();
    } catch (_) {}
    const { results = [] } = await env.DB.prepare(query).bind(...params).all();
    const leave = await Promise.all(results.map(async row => {
      const docs = await env.DB.prepare('SELECT id,original_filename,content_type,byte_size,required_label FROM leave_request_documents WHERE leave_request_id=?').bind(row.id).all();
      const approverHint = row.current_approver === 'HAUNV' ? 'Anh Hậu (Phó Tổng Giám Đốc)' : (row.current_approver === 'Quản lý trực tiếp' || row.current_approver === 'Ban Giám đốc') ? 'Quản lý / HR' : (row.current_approver || (row.status === 'pending_director' ? 'Anh Hậu (Phó Tổng Giám Đốc)' : 'Quản lý / HR'));
      return {
        ...row,
        current_approver: approverHint,
        type_name: row.type_name || row.type,
        paid_label: leavePaidLabel(row.paid_policy),
        can_action: ['pending', 'pending_director'].includes(row.status) && canAdvanceLeaveApproval(me, row, { isDirectorHau, isStep1Approver, normalizeDeptName }),
        document_count: Number(docs.results?.length || 0),
        documents: docs.results || [],
      };
    }));
    return { leave };
  },

  async createRequest(env, data, me, { normalizeDeptName, broadcastAppEvent }) {
    const b = data || {};
    if (!b.start_date || !b.end_date || !b.type) return { error: 'Chọn loại nghỉ và ngày bắt đầu/kết thúc', status: 400 };
    if (String(b.start_date) > String(b.end_date)) return { error: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc', status: 400 };
    const typeCode = String(b.type).trim();
    const leaveType = await env.DB.prepare('SELECT * FROM leave_types WHERE code=? AND is_active=1').bind(typeCode).first();
    if (!leaveType) return { error: 'Loại nghỉ phép không hợp lệ hoặc đã tắt', status: 400 };
    const session = ['full', 'morning', 'afternoon'].includes(b.leave_session) ? b.leave_session : 'full';
    if (session !== 'full' && b.start_date !== b.end_date) return { error: 'Nghỉ nửa ngày chỉ áp dụng cho một ngày', status: 400 };
    const leaveDays = leaveDaysForSession(b.start_date, b.end_date, session);
    if (!leaveDays) return { error: 'Khoảng thời gian nghỉ không có ngày làm việc', status: 400 };
    const reason = String(b.reason || '').trim();
    if (!reason) return { error: 'Vui lòng nhập lý do nghỉ', status: 400 };
    const documentIds = [...new Set(Array.isArray(b.document_ids) ? b.document_ids.map(String).filter(Boolean) : [])];
    if (leaveType.requires_evidence && !documentIds.length) return { error: 'Loại nghỉ này yêu cầu tài liệu đính kèm', status: 400 };
    const needsHandover = !!leaveType.requires_handover || leaveDays >= 2;
    const handoverUserId = b.handover_user_id ? Number(b.handover_user_id) : null;
    if (needsHandover && !handoverUserId) return { error: 'Đơn nghỉ từ 2 ngày hoặc theo chính sách phải chọn người bàn giao', status: 400 };
    if (handoverUserId === Number(me.id)) return { error: 'Người bàn giao không thể là chính bạn', status: 400 };
    const handoverUser = handoverUserId ? await env.DB.prepare('SELECT id,full_name FROM users WHERE id=? AND is_active=1').bind(handoverUserId).first() : null;
    if (handoverUserId && !handoverUser) return { error: 'Người bàn giao không hợp lệ', status: 400 };
    if (documentIds.length) {
      const placeholders = documentIds.map(() => '?').join(',');
      const { results: documents = [] } = await env.DB.prepare(`SELECT id FROM leave_request_documents WHERE owner_id=? AND leave_request_id IS NULL AND id IN (${placeholders})`).bind(me.id, ...documentIds).all();
      if (documents.length !== documentIds.length) return { error: 'Tài liệu đính kèm không hợp lệ', status: 400 };
    }
    const balanceType = leaveBalanceType(leaveType), balanceYear = Number(String(b.start_date).slice(0, 4));
    if (balanceType === 'annual') {
      const isOfficial = me.employee_type !== 'TTS' && me.lifecycle_status !== 'Thử việc' && me.lifecycle_status !== 'Thực tập' && me.contract_type !== 'Thử việc' && me.contract_type !== 'Thỏa thuận TTS';
      if (!isOfficial) {
        return { error: 'Chế độ phép năm chỉ áp dụng cho nhân viên chính thức. Thực tập sinh và nhân viên thử việc chưa có phép năm, vui lòng chọn loại nghỉ khác (ví dụ: Nghỉ không lương).', status: 400 };
      }
    }
    if (balanceType && await getLeaveBalance(env, me.id, balanceType, balanceYear) < leaveDays) {
      return { error: `Không đủ số dư ${balanceType === 'annual' ? 'phép năm' : 'nghỉ bù'}`, status: 400 };
    }
    const deptNormalized = typeof normalizeDeptName === 'function' ? normalizeDeptName(me.department) : me.department;
    const isHcnsApplicant = deptNormalized === 'Phòng HCNS';
    const flow = leavePolicyFor(leaveType);
    const currentApprover = isHcnsApplicant ? 'Trưởng phòng HCNS' : 'Quản lý / HR';
    const r = await env.DB.prepare(
      'INSERT INTO leave_requests (user_id,employee_id,type,start_date,end_date,reason,status,current_approver,approval_level,submitted_at,leave_session,total_days,handover_user_id,handover_user_name,approval_flow,balance_reserved_days) VALUES (?,?,?,?,?,?,?,?,?,datetime(\'now\',\'localtime\'),?,?,?,?,?,?)'
    ).bind(String(me.id), me.id, typeCode, b.start_date, b.end_date, reason, 'pending', currentApprover, 1, session, leaveDays, handoverUser?.id || null, handoverUser?.full_name || null, flow, balanceType ? leaveDays : 0).run();
    const leaveRequestId = r.meta.last_row_id;
    if (balanceType) await env.DB.batch([
      env.DB.prepare("UPDATE leave_balances SET available_days=available_days-?,updated_at=datetime('now','localtime') WHERE user_id=? AND leave_type_code=? AND balance_year=?").bind(leaveDays, me.id, balanceType, balanceYear),
      env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,leave_request_id,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)').bind(me.id, balanceType, balanceYear, leaveRequestId, -leaveDays, 'pending_reservation', 'Giữ chỗ đơn nghỉ', me.id, me.full_name || ''),
    ]);
    if (documentIds.length) await env.DB.prepare(`UPDATE leave_request_documents SET leave_request_id=? WHERE id IN (${documentIds.map(() => '?').join(',')})`).bind(leaveRequestId, ...documentIds).run();
    await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(leaveRequestId, 0, me.id, me.full_name, 'submitted', 'Gửi đơn xin nghỉ phép').run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'leave', 'leave:created', {
        id: leaveRequestId,
        user_id: me.id,
        employee_id: me.id,
        employee_name: me.full_name,
        employee_code: me.employee_code,
        department: me.department,
        type: typeCode,
        start_date: b.start_date,
        end_date: b.end_date,
        leave_session: session,
        total_days: leaveDays,
        status: 'pending',
        current_approver: currentApprover,
        approval_flow: flow,
      }, { actorId: me.id });
    }
    return { ok: true, id: leaveRequestId };
  },

  async listDocuments(env, leaveId, me, { isHrOrBod }) {
    const leaveRow = await env.DB.prepare(`SELECT lr.*, u.department FROM leave_requests lr LEFT JOIN users u ON (u.id=lr.employee_id OR u.employee_code=lr.user_id) WHERE lr.id=?`).bind(leaveId).first();
    if (!leaveRow) return { error: 'Đơn nghỉ không tồn tại', status: 404 };
    const isOwner = Number(leaveRow.employee_id) === Number(me.id) || String(leaveRow.user_id) === String(me.id) || String(leaveRow.user_id) === String(me.employee_code || '');
    if (!isOwner && !canManageLeaveRequest(me, leaveRow, { isHrOrBod })) return { error: 'Không có quyền xem tài liệu', status: 403 };
    const { results: documents = [] } = await env.DB.prepare('SELECT id,original_filename,content_type,byte_size,required_label,created_at FROM leave_request_documents WHERE leave_request_id=?').bind(leaveId).all();
    return { documents };
  },

  async getDocumentFile(env, url, leaveId, documentId, me, { isHrOrBod, safeDownloadName }) {
    const document = await env.DB.prepare(`SELECT d.*,lr.employee_id,lr.user_id,u.department FROM leave_request_documents d
      JOIN leave_requests lr ON lr.id=d.leave_request_id LEFT JOIN users u ON (u.id=lr.employee_id OR u.employee_code=lr.user_id) WHERE d.id=? AND d.leave_request_id=?`).bind(documentId, leaveId).first();
    if (!document) return { error: 'Tài liệu không tồn tại', status: 404 };
    const isOwner = Number(document.employee_id) === Number(me.id) || String(document.user_id) === String(me.id) || String(document.user_id) === String(me.employee_code || '');
    if (!isOwner && !canManageLeaveRequest(me, document, { isHrOrBod })) return { error: 'Không có quyền xem tài liệu', status: 403 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ tài liệu chưa được cấu hình', status: 503 };
    const object = await env.HR_DOCUMENTS.get(document.storage_key);
    if (!object) return { error: 'Tệp không tồn tại trên kho lưu trữ', status: 404 };
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    const filename = typeof safeDownloadName === 'function' ? safeDownloadName(document.original_filename) : document.original_filename;
    return new Response(object.body, {
      headers: {
        'Content-Type': document.content_type || object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  },

  async updateRequest(env, id, data, me, { isDirectorHau, isStep1Approver, normalizeDeptName, createEmployeePopup, broadcastAppEvent }) {
    const b = data || {};
    const leaveReq = await env.DB.prepare('SELECT lr.*,u.department FROM leave_requests lr LEFT JOIN users u ON u.id=lr.employee_id WHERE lr.id=?').bind(id).first();
    if (!leaveReq) return { error: 'Không tìm thấy đơn nghỉ', status: 404 };
    
    if (b.status === 'rejected') {
      if (!canAdvanceLeaveApproval(me, leaveReq, { isDirectorHau, isStep1Approver, normalizeDeptName })) {
        return { error: 'Chưa đến bước phê duyệt của bạn', status: 403 };
      }
      const currentLevel = Number(leaveReq.approval_level || 1);
      const noteText = String(b.note || '').trim();

      await env.DB.prepare(`
        UPDATE leave_requests SET
          status='rejected',
          current_approver=NULL,
          rejected_by=?,
          rejected_by_name=?,
          rejected_at=datetime('now','localtime'),
          rejection_note=?
        WHERE id=?
      `).bind(me.id, me.full_name, noteText || null, id).run();

      if (leaveReq.balance_reserved_days > 0) {
        const type = leaveReq.type === 'annual' ? 'annual' : 'compensatory', year = Number(String(leaveReq.start_date).slice(0, 4));
        await env.DB.batch([
          env.DB.prepare("UPDATE leave_balances SET available_days=available_days+?,updated_at=datetime('now','localtime') WHERE user_id=? AND leave_type_code=? AND balance_year=?").bind(leaveReq.balance_reserved_days, leaveReq.employee_id, type, year),
          env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,leave_request_id,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)').bind(leaveReq.employee_id, type, year, id, leaveReq.balance_reserved_days, 'reservation_release', String(b.note || 'Từ chối đơn'), me.id, me.full_name || ''),
        ]);
      }
      await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(id, currentLevel, me.id, me.full_name, 'rejected', noteText).run();

      if (typeof createEmployeePopup === 'function') {
        await createEmployeePopup(env, {
          userId: leaveReq.employee_id,
          requestType: 'leave',
          requestId: id,
          decision: 'rejected',
          title: 'Đơn xin nghỉ phép bị từ chối',
          message: `Đơn nghỉ phép từ ${leaveReq.start_date} đến ${leaveReq.end_date} của bạn đã bị từ chối bởi ${me.full_name || 'Quản lý'}.${noteText ? ` Lý do: ${noteText}` : ''}`,
          details: {
            request_type: 'leave',
            request_id: id,
            start_date: leaveReq.start_date,
            end_date: leaveReq.end_date,
            leave_session: leaveReq.leave_session,
            total_days: leaveReq.total_days,
            reviewer_name: me.full_name,
            reason: noteText,
          },
          actorId: me.id,
          actorName: me.full_name || '',
        });
      }

      if (typeof broadcastAppEvent === 'function') {
        await broadcastAppEvent(env, 'leave', 'leave:rejected', {
          id,
          user_id: leaveReq.employee_id,
          status: 'rejected',
          note: noteText,
          rejected_by_name: me.full_name,
        }, { actorId: me.id });
      }
      return { ok: true, status: 'rejected', final: true };
    }

    if (b.status === 'approved') {
      if (!canAdvanceLeaveApproval(me, leaveReq, { isDirectorHau, isStep1Approver, normalizeDeptName })) {
        return { error: 'Chưa đến bước phê duyệt của bạn', status: 403 };
      }
      const currentLevel = Number(leaveReq.approval_level || 1);
      const isHau = typeof isDirectorHau === 'function' && isDirectorHau(me);
      const isFinalApproved = leaveReq.status === 'pending_director' || currentLevel === 2 || isHau;
      const noteText = String(b.note || '').trim();

      if (isFinalApproved) {
        const nextLevel = 99;
        const nextApprover = null;

        await env.DB.prepare(`
          UPDATE leave_requests SET
            status='approved',
            approval_level=?,
            current_approver=?,
            approved_by=?,
            approved_by_name=?,
            approved_at=datetime('now','localtime')
          WHERE id=?
        `).bind(nextLevel, nextApprover, me.id, me.full_name, id).run();

        await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(id, currentLevel, me.id, me.full_name, 'approved', noteText).run();

        if (typeof createEmployeePopup === 'function') {
          await createEmployeePopup(env, {
            userId: leaveReq.employee_id,
            requestType: 'leave',
            requestId: id,
            decision: 'approved',
            title: 'Đơn xin nghỉ phép đã được phê duyệt!',
            message: `Đơn nghỉ phép từ ${leaveReq.start_date} đến ${leaveReq.end_date} của bạn đã được ${isHau ? 'anh Hậu (Phó Tổng Giám Đốc)' : (me.full_name || 'Ban Giám Đốc')} phê duyệt chính thức.${noteText ? ` Ghi chú: ${noteText}` : ''}`,
            details: {
              request_type: 'leave',
              request_id: id,
              start_date: leaveReq.start_date,
              end_date: leaveReq.end_date,
              leave_session: leaveReq.leave_session,
              total_days: leaveReq.total_days,
              reviewer_name: isHau ? 'Anh Hậu (Phó Tổng Giám Đốc)' : me.full_name,
              note: noteText,
            },
            actorId: me.id,
            actorName: me.full_name || '',
          });
        }

        if (typeof broadcastAppEvent === 'function') {
          await broadcastAppEvent(env, 'leave', 'leave:approved', {
            id,
            user_id: leaveReq.employee_id,
            status: 'approved',
            approval_level: nextLevel,
            current_approver: nextApprover,
            final: true,
            note: noteText,
            approved_by_name: me.full_name,
          }, { actorId: me.id });
        }

        return { ok: true, status: 'approved', final: true };
      } else {
        // Step 1 approval by HCNS / Manager -> pending_director
        const nextLevel = 2;
        const nextApprover = 'HAUNV';

        await env.DB.prepare(`
          UPDATE leave_requests SET
            status='pending_director',
            approval_level=?,
            current_approver=?,
            step1_reviewer_id=?,
            step1_reviewer_name=?,
            step1_reviewed_at=datetime('now','localtime'),
            step1_note=?
          WHERE id=?
        `).bind(nextLevel, nextApprover, me.id, me.full_name, noteText || null, id).run();

        await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(id, currentLevel, me.id, me.full_name, 'forwarded', noteText).run();

        try {
          await env.DB.prepare(`
            INSERT INTO notifications (user_id, title, content, type, link) VALUES (?, ?, ?, 'leave', '/leave')
          `).bind(
            leaveReq.employee_id,
            'Tiến độ đơn nghỉ phép (Bước 1 đã duyệt)',
            `HCNS (${me.full_name}) đã duyệt bước 1 đơn nghỉ phép từ ${leaveReq.start_date} đến ${leaveReq.end_date}. Đơn đang được chuyển tiếp tới anh Hậu phê duyệt chốt.`
          ).run();
        } catch (_) {}

        if (typeof broadcastAppEvent === 'function') {
          await broadcastAppEvent(env, 'leave', 'leave:forwarded', {
            id,
            user_id: leaveReq.employee_id,
            status: 'pending_director',
            approval_level: nextLevel,
            current_approver: nextApprover,
            final: false,
            step1_reviewer_name: me.full_name,
            note: noteText,
          }, { actorId: me.id });
        }

        return { ok: true, status: 'pending_director', final: false };
      }
    }

    if (Number(leaveReq.employee_id) !== Number(me.id) || leaveReq.status !== 'pending') {
      return { error: 'Chỉ được sửa đơn của bạn khi đang chờ duyệt', status: 403 };
    }
    const updates = [], vals = [];
    if (b.reason !== undefined) {
      const reason = String(b.reason).trim();
      if (!reason) return { error: 'Vui lòng nhập lý do nghỉ', status: 400 };
      updates.push('reason=?');
      vals.push(reason);
    }
    if (!updates.length) return { error: 'Không có dữ liệu cập nhật', status: 400 };
    vals.push(id);
    await env.DB.prepare(`UPDATE leave_requests SET ${updates.join(',')} WHERE id=?`).bind(...vals).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'leave', 'leave:updated', {
        id,
        user_id: leaveReq.employee_id,
        updates: b,
      }, { actorId: me.id });
    }
    return { ok: true };
  },

  async deleteRequest(env, id, me, { isHcns, broadcastAppEvent }) {
    const leaveReq = await env.DB.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first();
    if (!leaveReq || (Number(leaveReq.employee_id) !== Number(me.id) && !isHcns(me))) {
      return { error: 'Không có quyền xóa đơn nghỉ', status: 403 };
    }
    if (leaveReq.status !== 'pending') return { error: 'Chỉ được xóa đơn đang chờ duyệt', status: 400 };
    if (leaveReq.balance_reserved_days > 0) {
      const type = leaveReq.type === 'annual' ? 'annual' : 'compensatory', year = Number(String(leaveReq.start_date).slice(0, 4));
      await env.DB.batch([
        env.DB.prepare("UPDATE leave_balances SET available_days=available_days+?,updated_at=datetime('now','localtime') WHERE user_id=? AND leave_type_code=? AND balance_year=?").bind(leaveReq.balance_reserved_days, leaveReq.employee_id, type, year),
        env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,leave_request_id,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)').bind(leaveReq.employee_id, type, year, id, leaveReq.balance_reserved_days, 'reservation_release', 'Hủy đơn nghỉ', me.id, me.full_name || ''),
      ]);
    }
    await env.DB.prepare('DELETE FROM leave_requests WHERE id=?').bind(id).run();
    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'leave', 'leave:deleted', {
        id,
        user_id: leaveReq.employee_id,
      }, { actorId: me.id });
    }
    return { ok: true };
  },

  async listHolidays(env) {
    const { results = [] } = await env.DB.prepare('SELECT * FROM company_holidays ORDER BY holiday_date DESC').all();
    return { holidays: results };
  },

  async createHoliday(env, data, me) {
    const b = data || {};
    const date = String(b.holiday_date || ''), name = String(b.name || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return { error: 'Ngày lễ và tên ngày lễ là bắt buộc', status: 400 };
    const r = await env.DB.prepare('INSERT INTO company_holidays (holiday_date,name,is_active) VALUES (?,?,?)').bind(date, name, b.is_active === false ? 0 : 1).run();
    return { ok: true, id: r.meta.last_row_id };
  },

  async updateHoliday(env, id, data, me) {
    const b = data || {};
    await env.DB.prepare('UPDATE company_holidays SET holiday_date=?,name=?,is_active=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').bind(String(b.holiday_date || ''), String(b.name || '').trim(), b.is_active === false ? 0 : 1, id).run();
    return { ok: true };
  },

  async deleteHoliday(env, id, me) {
    await env.DB.prepare('DELETE FROM company_holidays WHERE id=?').bind(id).run();
    return { ok: true };
  }
};
