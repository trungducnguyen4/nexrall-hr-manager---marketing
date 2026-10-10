/**
 * Invoices Controller - HTTP Endpoints for Employee Payslips & Invoices
 */
import { json, err } from '../lib/response.js';
import { nowStr } from '../lib/time.js';
import { buildMonthlyOvertimeSummary } from '../services/attendance.service.js';

export async function handleInvoiceRoutes(request, env, me, path, url, options = {}) {
  const {
    isManager = false,
    isAdmin = false,
    isHcns = () => false,
    broadcastAppEvent = async () => {},
  } = options;

  if (path === '/api/invoices' && request.method === 'GET') {
    const userId2 = url.searchParams.get('userId');
    const month2 = url.searchParams.get('month');
    const year2 = url.searchParams.get('year');
    const status2 = url.searchParams.get('status');
    let q = 'SELECT i.*, u.full_name, u.employee_code, u.department, u.position FROM invoices i JOIN users u ON i.user_id=u.id WHERE 1=1';
    const binds = [];
    if (!isManager) { q += ' AND i.user_id=?'; binds.push(me.id); }
    else {
      if (!isAdmin && !isHcns(me)) { q += ' AND u.department=?'; binds.push(me.department); }
      if (userId2) { q += ' AND i.user_id=?'; binds.push(parseInt(userId2)); }
    }
    if (month2) { q += ' AND i.month=?'; binds.push(parseInt(month2)); }
    if (year2) { q += ' AND i.year=?'; binds.push(parseInt(year2)); }
    if (status2) { q += ' AND i.status=?'; binds.push(status2); }
    q += ' ORDER BY i.year DESC, i.month DESC, i.id DESC';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ invoices: results });
  }

  if (path === '/api/invoices' && request.method === 'POST') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    if (!b.user_id || !b.month || !b.year) return json({ error: 'Thiếu thông tin' }, 400);
    const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(b.user_id).first();
    if (!invoiceUser) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    if (!isAdmin && !isHcns(me) && invoiceUser.department !== me.department) return json({ error: 'Không có quyền lập phiếu ngoài phòng ban' }, 403);
    const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE year=? AND month=?')
      .bind(b.year, b.month).first();
    const seq = String((count?.cnt || 0) + 1).padStart(3, '0');
    const invNum = 'HD-' + b.year + String(b.month).padStart(2,'0') + '-' + seq;
    const base = b.base_salary || 0;
    const bonus = b.bonus || 0;
    const allowance = b.allowance || 0;
    const deduction = b.deduction || 0;
    const tax = b.tax ?? Math.round((base + bonus) * 0.1);
    const insurance = b.insurance ?? Math.round(base * 0.08);
    const overtime = await buildMonthlyOvertimeSummary(env, b.user_id, b.month, b.year, base);
    const net = base + bonus + allowance + overtime.overtimePay - deduction - tax - insurance;
    const r = await env.DB.prepare(
      'INSERT INTO invoices (invoice_number,user_id,month,year,base_salary,bonus,allowance,deduction,tax,insurance,net_salary,work_days,absent_days,late_days,standard_days,paid_leave_days,late_minutes,early_leave_minutes,missing_checkinout_days,approved_overtime_minutes,overtime_pay,status,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(invNum,b.user_id,b.month,b.year,base,bonus,allowance,deduction,tax,insurance,net,b.work_days||0,b.absent_days||0,b.late_days||0,b.standard_days||0,b.paid_leave_days||0,b.late_minutes||0,b.early_leave_minutes||0,b.missing_checkinout_days||0,overtime.approvedOvertimeMinutes,overtime.overtimePay,b.status||'draft',b.note||'').run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(r.meta.last_row_id, null, b.status||'draft', me.id, me.full_name, 'Created invoice').run();
    await broadcastAppEvent(env, 'invoices', 'invoice:created', {
      id: r.meta.last_row_id,
      invoice_number: invNum,
      user_id: b.user_id,
      month: b.month,
      year: b.year,
      net_salary: net,
      status: b.status || 'draft',
    }, { actorId: me.id });
    return json({ ok: true, id: r.meta.last_row_id, invoice_number: invNum });
  }

  const invConfirmMatch = path.match(/^\/api\/invoices\/(\d+)\/confirm$/);
  if (invConfirmMatch && request.method === 'POST') {
    const iid = parseInt(invConfirmMatch[1]);
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
    if (!inv) return json({ error: 'Khong tim thay phieu luong' }, 404);
    if (inv.user_id !== me.id) return json({ error: 'Khong co quyen' }, 403);
    if (!['issued', 'review_requested'].includes(String(inv.status || ''))) {
      return json({ error: 'Chi co the xac nhan phieu luong da phat hanh' }, 400);
    }
    await env.DB.prepare(
      "UPDATE invoices SET status='employee_confirmed',employee_confirmed_at=datetime('now','localtime'),review_status='none',review_resolved_at=COALESCE(review_resolved_at,datetime('now','localtime')) WHERE id=?"
    ).bind(iid).run();
    await env.DB.prepare(
      "UPDATE invoice_review_requests SET status='closed',updated_at=datetime('now','localtime') WHERE invoice_id=? AND status='open'"
    ).bind(iid).run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(iid, inv.status || null, 'employee_confirmed', me.id, me.full_name || '', 'Employee confirmed payslip').run();
    await broadcastAppEvent(env, 'invoices', 'invoice:confirmed', {
      id: iid,
      user_id: inv.user_id,
      status: 'employee_confirmed',
    }, { actorId: me.id });
    return json({ ok: true });
  }

  const invReviewMatch = path.match(/^\/api\/invoices\/(\d+)\/review-request$/);
  if (invReviewMatch && request.method === 'POST') {
    const iid = parseInt(invReviewMatch[1]);
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
    if (!inv) return json({ error: 'Khong tim thay phieu luong' }, 404);
    if (inv.user_id !== me.id) return json({ error: 'Khong co quyen' }, 403);
    if (inv.locked_at || inv.status === 'paid' || inv.status === 'employee_confirmed') {
      return json({ error: 'Phieu luong da khoa hoac da xac nhan' }, 400);
    }
    if (!['issued', 'review_requested'].includes(String(inv.status || ''))) {
      return json({ error: 'Chi co the yeu cau xem lai phieu luong da phat hanh' }, 400);
    }
    const b = await request.json().catch(() => ({}));
    const category = String(b.category || '').trim();
    const allowed = new Set(['attendance', 'bonus', 'deduction', 'base_salary', 'bank_info', 'other']);
    const message = String(b.message || '').trim();
    if (!allowed.has(category)) return json({ error: 'Loai yeu cau khong hop le' }, 400);
    if (!message) return json({ error: 'Vui long nhap ly do can xem lai' }, 400);
    await env.DB.prepare(
      `INSERT INTO invoice_review_requests (invoice_id,user_id,category,message,requested_amount,status)
       VALUES (?,?,?,?,?,'open')`
    ).bind(iid, me.id, category, message, Number(b.requested_amount || 0)).run();
    await env.DB.prepare(
      "UPDATE invoices SET status='review_requested',review_status='open',review_reason=?,review_requested_at=datetime('now','localtime') WHERE id=?"
    ).bind(message, iid).run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(iid, inv.status || null, 'review_requested', me.id, me.full_name || '', message).run();
    await broadcastAppEvent(env, 'invoices', 'invoice:review_requested', {
      id: iid,
      user_id: inv.user_id,
      status: 'review_requested',
      category,
      message,
    }, { actorId: me.id });
    return json({ ok: true });
  }

  const invResolveMatch = path.match(/^\/api\/invoices\/(\d+)\/resolve-review$/);
  if (invResolveMatch && request.method === 'POST') {
    if (!isManager) return json({ error: 'Khong co quyen' }, 403);
    const iid = parseInt(invResolveMatch[1]);
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
    if (!inv) return json({ error: 'Khong tim thay phieu luong' }, 404);
    if (!isAdmin && !isHcns(me)) {
      const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(inv.user_id).first();
      if (!invoiceUser || invoiceUser.department !== me.department) return json({ error: 'Không có quyền xử lý phiếu ngoài phòng ban' }, 403);
    }
    if (inv.locked_at || inv.status === 'paid') return json({ error: 'Phieu luong da khoa' }, 400);
    const b = await request.json().catch(() => ({}));
    const note = String(b.note || '').trim();
    const nextStatus = b.nextStatus === 'employee_confirmed' ? 'employee_confirmed' : 'issued';
    if (!note) return json({ error: 'Vui long nhap ghi chu xu ly' }, 400);
    await env.DB.prepare(
      `UPDATE invoices SET status=?,review_status='resolved',review_note=?,review_resolved_at=datetime('now','localtime'),
        employee_confirmed_at=CASE WHEN ?='employee_confirmed' THEN datetime('now','localtime') ELSE employee_confirmed_at END
       WHERE id=?`
    ).bind(nextStatus, note, nextStatus, iid).run();
    await env.DB.prepare(
      "UPDATE invoice_review_requests SET status='resolved',handled_by=?,handled_by_name=?,handled_note=?,handled_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE invoice_id=? AND status='open'"
    ).bind(me.id, me.full_name || '', note, iid).run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(iid, inv.status || null, nextStatus, me.id, me.full_name || '', note).run();
    await broadcastAppEvent(env, 'invoices', 'invoice:review_resolved', {
      id: iid,
      user_id: inv.user_id,
      status: nextStatus,
      note,
    }, { actorId: me.id });
    return json({ ok: true });
  }

  const invMatch = path.match(/^\/api\/invoices\/(\d+)$/);
  if (invMatch) {
    const iid = parseInt(invMatch[1]);
    if (request.method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT i.*, u.full_name, u.employee_code, u.department, u.position, u.contract_type, u.bank_account, u.bank_name FROM invoices i JOIN users u ON i.user_id=u.id WHERE i.id=?'
      ).bind(iid).first();
      if (!row) return json({ error: 'Không tìm thấy' }, 404);
      if (!isManager && row.user_id !== me.id) return json({ error: 'Không có quyền' }, 403);
      if (isManager && !isAdmin && !isHcns(me) && row.user_id !== me.id && row.department !== me.department) return json({ error: 'Không có quyền' }, 403);
      const review = await env.DB.prepare(
        'SELECT * FROM invoice_review_requests WHERE invoice_id=? ORDER BY id DESC LIMIT 1'
      ).bind(iid).first();
      row.latest_review_request = review || null;
      row.pending_actor = row.status === 'issued' ? row.full_name : (row.status === 'review_requested' ? 'HCNS' : '');
      row.confirmed_by = row.employee_confirmed_at ? row.full_name : '';
      row.checked_by = row.review_resolved_at ? (row.issued_by_name || '') : '';
      row.approved_by = row.issued_by_name || '';
      return json({ invoice: row });
    }
    if (request.method === 'PUT') {
      if (!isManager) return json({ error: 'Không có quyền' }, 403);
      const b = await request.json();
      const existingInv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
      if (!existingInv) return json({ error: 'Khong tim thay' }, 404);
      if (!isAdmin && !isHcns(me)) {
        const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(existingInv.user_id).first();
        if (!invoiceUser || invoiceUser.department !== me.department) return json({ error: 'Không có quyền sửa phiếu ngoài phòng ban' }, 403);
      }
      if (existingInv.locked_at || existingInv.status === 'paid') return json({ error: 'Phieu luong da khoa, khong the chinh sua' }, 400);
      const base = b.base_salary || 0, bonus = b.bonus || 0;
      const allowance = b.allowance || 0, deduction = b.deduction || 0;
      const tax = b.tax ?? Math.round((base + bonus) * 0.1);
      const insurance = b.insurance ?? Math.round(base * 0.08);
      const overtime = await buildMonthlyOvertimeSummary(env, existingInv.user_id, existingInv.month, existingInv.year, base);
      const net = base + bonus + allowance + overtime.overtimePay - deduction - tax - insurance;
      const nextStatus = b.status || existingInv.status || 'draft';
      const lockAt = nextStatus === 'paid' ? nowStr() : null;
      const confirmedAt = nextStatus === 'employee_confirmed' ? (existingInv.employee_confirmed_at || nowStr()) : existingInv.employee_confirmed_at;
      await env.DB.prepare(
        'UPDATE invoices SET base_salary=?,bonus=?,allowance=?,deduction=?,tax=?,insurance=?,net_salary=?,work_days=?,absent_days=?,late_days=?,standard_days=?,paid_leave_days=?,late_minutes=?,early_leave_minutes=?,missing_checkinout_days=?,approved_overtime_minutes=?,overtime_pay=?,status=?,note=?,locked_at=?,locked_by=?,locked_by_name=?,employee_confirmed_at=? WHERE id=?'
      ).bind(base,bonus,allowance,deduction,tax,insurance,net,b.work_days||0,b.absent_days||0,b.late_days||0,b.standard_days??0,b.paid_leave_days??0,b.late_minutes??0,b.early_leave_minutes??0,b.missing_checkinout_days??0,overtime.approvedOvertimeMinutes,overtime.overtimePay,nextStatus,b.note||'',lockAt,lockAt ? me.id : null,lockAt ? me.full_name : null,confirmedAt,iid).run();
      if (nextStatus !== existingInv.status) {
        await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
          .bind(iid, existingInv.status || null, nextStatus, me.id, me.full_name, b.status_note || b.note || null).run();
      }
      await broadcastAppEvent(env, 'invoices', 'invoice:updated', {
        id: iid,
        user_id: existingInv.user_id,
        status: nextStatus,
        net_salary: net,
      }, { actorId: me.id });
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isManager) return json({ error: 'Không có quyền' }, 403);
      const existingInv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
      if (existingInv && !isAdmin && !isHcns(me)) {
        const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(existingInv.user_id).first();
        if (!invoiceUser || invoiceUser.department !== me.department) return json({ error: 'Không có quyền xóa phiếu ngoài phòng ban' }, 403);
      }
      if (existingInv && (existingInv.locked_at || existingInv.status === 'paid')) return json({ error: 'Phieu luong da khoa, khong the xoa' }, 400);
      await env.DB.prepare('DELETE FROM invoices WHERE id=?').bind(iid).run();
      await broadcastAppEvent(env, 'invoices', 'invoice:deleted', {
        id: iid,
        user_id: existingInv?.user_id,
      }, { actorId: me.id });
      return json({ ok: true });
    }
  }
  return null;
}
