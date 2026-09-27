// ════════════════════════════════════════════════════════════════════════════
//  Two-Step Approval Workflow Smoke Tests (WFH, OT, Leave, Popups)
// ════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import assert from 'assert';

const TOKEN = 'a'.repeat(64);
const SERVER_URL = 'https://two-step.local';
const TODAY = '2026-09-19';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const { handle } = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ✓ ${name}`); }

function makeSession(u) {
  return {
    uid: u.id,
    user_id: u.id,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
    department: u.department,
    position: u.position || 'Nhân viên',
    avatar_color: '#4F46E5',
    avatar_initials: 'NV',
    avatar_url: null,
    employee_code: u.employee_code,
    salary: 10000000,
    phone: '0901234567',
    bank_account: null,
    bank_name: null,
    is_active: 1,
    lifecycle_status: null,
    must_change_password: 0,
    revoked: 0,
    expires_at: 9999999999,
  };
}

function createMockEnv(sessionUser, shared) {
  if (!shared.users) {
    shared.users = [
      { id: 1, employee_code: 'HAUNV', full_name: 'Nguyễn Văn Hậu', email: 'haunv@company.com', role: 'director', department: 'Ban Giám Đốc', position: 'Tổng giám đốc', is_active: 1 },
      { id: 2, employee_code: 'AD-001', full_name: 'Admin Hệ Thống', email: 'admin@company.com', role: 'admin', department: 'Ban Giám Đốc', position: 'Quản trị viên', is_active: 1 },
      { id: 10, employee_code: 'HR-010', full_name: 'Trần Thị Nhân Sự', email: 'hr@company.com', role: 'employee', department: 'Phòng HCNS', position: 'Chuyên viên HCNS', is_active: 1 },
      { id: 20, employee_code: 'MKT-020', full_name: 'Lê Văn Trưởng Phòng', email: 'mgr@company.com', role: 'manager', department: 'Marketing', position: 'Trưởng phòng Marketing', is_active: 1 },
      { id: 30, employee_code: 'NV-030', full_name: 'Phạm Văn Nhân Viên', email: 'emp@company.com', role: 'employee', department: 'Marketing', position: 'Nhân viên', is_active: 1 },
    ];
  }
  if (!shared.attendance) shared.attendance = [];
  if (!shared.overtime_requests) shared.overtime_requests = [];
  if (!shared.overtime_forms) shared.overtime_forms = [];
  if (!shared.leave_requests) shared.leave_requests = [];
  if (!shared.employee_popups) shared.employee_popups = [];
  if (!shared.notifications) shared.notifications = [];

  let nextId = 500;

  const db = {
    async exec() {},
    async batch(items) { for (const it of items) if (it?.run) await it.run(); },
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async all() {
          if (sql.includes('FROM sessions')) return { results: [sessionUser] };
          if (sql.includes('FROM users')) return { results: shared.users };
          if (sql.includes('FROM employee_popups')) {
            const uid = stmt.args[0];
            const rows = shared.employee_popups.filter(p => p.user_id === uid && (!p.is_dismissed || p.is_dismissed === 0));
            return { results: rows };
          }
          if (sql.includes('FROM attendance a') && sql.includes('JOIN users u')) {
            const res = shared.attendance.map(a => {
              const u = shared.users.find(x => x.id === a.user_id) || {};
              return { ...a, full_name: u.full_name, employee_code: u.employee_code, department: u.department, avatar: u.avatar };
            });
            return { results: res };
          }
          if (sql.includes('FROM overtime_requests o') && sql.includes('JOIN users u')) {
            const res = shared.overtime_requests.map(o => {
              const u = shared.users.find(x => x.id === o.user_id) || {};
              return { ...o, full_name: u.full_name, employee_code: u.employee_code, department: u.department };
            });
            return { results: res };
          }
          if (sql.includes('FROM leave_requests l')) {
            const res = shared.leave_requests.map(l => {
              const u = shared.users.find(x => x.id === l.employee_id) || {};
              return { ...l, employee_name: u.full_name, employee_code: u.employee_code, department: u.department, can_action: true };
            });
            return { results: res };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("setting_key='schema_version'") || sql.includes("setting_key='seed_version'")) return { setting_value: '2026-09-19-two-step-approvals-v1' };
          if (sql.includes('FROM sessions')) return sessionUser;
          if (sql.includes('FROM users WHERE id = ?')) {
            return shared.users.find(u => u.id === stmt.args[0]) || null;
          }
          if (sql.includes('FROM employee_popups WHERE id = ?')) {
            return shared.employee_popups.find(p => p.id === stmt.args[0]) || null;
          }
          if (sql.includes('FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?')) {
            const a = shared.attendance.find(x => x.id === stmt.args[0]);
            if (!a) return null;
            const u = shared.users.find(x => x.id === a.user_id) || {};
            return { ...a, full_name: u.full_name, employee_code: u.employee_code, department: u.department };
          }
          if (sql.includes('FROM attendance WHERE id=?')) {
            return shared.attendance.find(a => a.id === stmt.args[0]) || null;
          }
          if (sql.includes('FROM overtime_requests o JOIN users u ON u.id=o.user_id WHERE o.id=?')) {
            const o = shared.overtime_requests.find(x => x.id === stmt.args[0]);
            if (!o) return null;
            const u = shared.users.find(x => x.id === o.user_id) || {};
            return { ...o, full_name: u.full_name, employee_code: u.employee_code, department: u.department };
          }
          if (sql.includes('FROM overtime_forms')) {
            const f = shared.overtime_forms.find(x => x.id === stmt.args[0]);
            if (!f) return null;
            const u = shared.users.find(x => x.id === f.user_id) || {};
            return { ...f, department: u.department, full_name: u.full_name };
          }
          if (sql.includes('FROM leave_requests')) {
            const l = shared.leave_requests.find(x => x.id === stmt.args[0]);
            if (!l) return null;
            const u = shared.users.find(x => x.id === l.employee_id) || {};
            return { ...l, employee_name: u.full_name, employee_code: u.employee_code, department: u.department, applicant_dept: u.department };
          }
          if (sql.includes('SELECT') && sql.includes('leave_types')) {
            return { code: 'annual', name: 'Phép năm', paid_policy: 'paid', deducts_annual_leave: 1 };
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO employee_popups')) {
            const [uid, reqType, reqId, dec, tit, msg, det, actId, actName] = stmt.args;
            const newPopup = {
              id: ++nextId,
              user_id: uid,
              request_type: reqType,
              request_id: reqId,
              decision: dec,
              title: tit,
              message: msg,
              details_json: det,
              actor_id: actId,
              actor_name: actName,
              is_dismissed: 0,
              created_at: new Date().toISOString(),
            };
            shared.employee_popups.push(newPopup);
            return { meta: { last_row_id: newPopup.id } };
          }
          if (sql.includes('UPDATE employee_popups')) {
            const [popId, uid] = stmt.args;
            const p = shared.employee_popups.find(x => Number(x.id) === Number(popId) && Number(x.user_id) === Number(uid));
            if (p) p.is_dismissed = 1;
            return { meta: { changes: p ? 1 : 0 } };
          }
          if (sql.includes('UPDATE attendance SET wfh_status=?')) {
            const attId = stmt.args[stmt.args.length - 1];
            const a = shared.attendance.find(x => x.id === attId);
            if (a) {
              a.wfh_status = stmt.args[0];
              if (sql.includes('wfh_step1_reviewer_id')) {
                a.wfh_step1_reviewer_id = stmt.args[1];
                a.wfh_step1_reviewer_name = stmt.args[2];
                a.wfh_step1_note = stmt.args[3];
              } else if (sql.includes('wfh_reviewer_id')) {
                a.wfh_reviewer_id = stmt.args[1];
                a.wfh_reviewer_name = stmt.args[2];
                a.wfh_review_note = stmt.args[3];
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE overtime_requests SET status=?')) {
            const otId = stmt.args[stmt.args.length - 1];
            const o = shared.overtime_requests.find(x => x.id === otId);
            if (o) {
              o.status = stmt.args[0];
              if (sql.includes('step1_reviewer_id')) {
                o.approved_minutes = stmt.args[1];
                o.step1_reviewer_id = stmt.args[2];
                o.step1_reviewer_name = stmt.args[3];
                o.step1_note = stmt.args[4];
              } else {
                o.approved_minutes = stmt.args[1];
                o.reviewer_id = stmt.args[2];
                o.reviewer_name = stmt.args[3];
                o.review_note = stmt.args[4];
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE overtime_forms SET status=?')) {
            const formId = stmt.args[stmt.args.length - 1];
            const f = shared.overtime_forms.find(x => x.id === formId);
            if (f) {
              f.status = stmt.args[0];
              if (sql.includes('step1_reviewer_id')) {
                f.step1_note = stmt.args[1];
                f.step1_reviewer_id = stmt.args[2];
                f.step1_reviewer_name = stmt.args[3];
              } else {
                f.review_note = stmt.args[1];
                f.reviewer_id = stmt.args[2];
                f.reviewer_name = stmt.args[3];
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE leave_requests')) {
            const leaveId = stmt.args[stmt.args.length - 1];
            const l = shared.leave_requests.find(x => x.id === leaveId);
            if (l) {
              if (sql.includes("status='pending_director'")) {
                l.status = 'pending_director';
                l.approval_level = stmt.args[0];
                l.current_approver = stmt.args[1];
                l.step1_reviewer_id = stmt.args[2];
                l.step1_reviewer_name = stmt.args[3];
                l.step1_note = stmt.args[4];
              } else if (sql.includes("status='approved'")) {
                l.status = 'approved';
                l.approval_level = stmt.args[0];
                l.current_approver = stmt.args[1];
                l.approved_by = stmt.args[2];
                l.approved_by_name = stmt.args[3];
              } else if (sql.includes("status='rejected'")) {
                l.status = 'rejected';
                l.current_approver = null;
                l.rejected_by = stmt.args[0];
                l.rejected_by_name = stmt.args[1];
                l.rejection_note = stmt.args[2];
              }
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notifications')) {
            shared.notifications.push({ user_id: stmt.args[0], title: stmt.args[1], content: stmt.args[2] });
            return { meta: { last_row_id: ++nextId } };
          }
          return { meta: { changes: 1, last_row_id: ++nextId } };
        }
      };
      return stmt;
    }
  };

  return { DB: db, sessionUser, shared };
}

async function callApi(method, path, body, env) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
  const req = new Request(`${SERVER_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handle(req, env);
  const text = await res.text();
  let jsonBody = null;
  try { jsonBody = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: jsonBody, raw: text };
}

async function runTests() {
  console.log('🧪 STARTING 2-STEP APPROVAL WORKFLOW SMOKE TESTS\n');
  const shared = {};

  const userHau = { id: 1, employee_code: 'HAUNV', full_name: 'Nguyễn Văn Hậu', email: 'haunv@company.com', role: 'director', department: 'Ban Giám Đốc', position: 'Tổng giám đốc' };
  const userHr = { id: 10, employee_code: 'HR-010', full_name: 'Trần Thị Nhân Sự', email: 'hr@company.com', role: 'employee', department: 'Phòng HCNS', position: 'Chuyên viên HCNS' };
  const userMgr = { id: 20, employee_code: 'MKT-020', full_name: 'Lê Văn Trưởng Phòng', email: 'mgr@company.com', role: 'manager', department: 'Marketing', position: 'Trưởng phòng Marketing' };
  const userEmp = { id: 30, employee_code: 'NV-030', full_name: 'Phạm Văn Nhân Viên', email: 'emp@company.com', role: 'employee', department: 'Marketing', position: 'Nhân viên' };

  const envHau = createMockEnv(makeSession(userHau), shared);
  const envHr = createMockEnv(makeSession(userHr), shared);
  const envMgr = createMockEnv(makeSession(userMgr), shared);
  const envEmp = createMockEnv(makeSession(userEmp), shared);

  // ════════════════════════════════════════════════════════════════════════════
  // 1. WFH 2-STEP APPROVAL
  // ════════════════════════════════════════════════════════════════════════════
  console.log('--- 1. WFH 2-Step Approval Flow ---');
  shared.attendance.push({
    id: 1001,
    user_id: 30,
    date: TODAY,
    work_type: 'wfh',
    shift: 'full',
    wfh_status: 'pending',
    wfh_reason: 'Nhà có việc gia đình',
  });

  // Step 1: HR approves
  const wfhStep1Res = await callApi('POST', '/api/attendance/1001/wfh-decision', {
    action: 'approve',
    review_note: 'HCNS đồng ý bước 1',
  }, envHr);
  assert.strictEqual(wfhStep1Res.status, 200);
  assert.strictEqual(wfhStep1Res.body.wfh_status, 'pending_director');
  assert.strictEqual(wfhStep1Res.body.final, false);
  const wfh1001 = shared.attendance.find(a => a.id === 1001);
  assert.strictEqual(wfh1001.wfh_status, 'pending_director');
  assert.strictEqual(wfh1001.wfh_step1_reviewer_name, 'Trần Thị Nhân Sự');
  ok('HCNS can approve WFH step 1 -> wfh_status becomes pending_director');

  // Step 2 blocked for non-Hau / non-admin
  const wfhStep2Forbidden = await callApi('POST', '/api/attendance/1001/wfh-decision', {
    action: 'approve',
    review_note: 'Cố duyệt bước 2',
  }, envHr);
  assert.strictEqual(wfhStep2Forbidden.status, 403);
  ok('Non-Hau cannot approve WFH step 2 (403)');

  // Step 2 approved by anh Hậu (Tổng Giám Đốc)
  const wfhStep2Res = await callApi('POST', '/api/attendance/1001/wfh-decision', {
    action: 'approve',
    review_note: 'Anh Hậu duyệt chốt',
  }, envHau);
  assert.strictEqual(wfhStep2Res.status, 200);
  assert.strictEqual(wfhStep2Res.body.wfh_status, 'approved');
  assert.strictEqual(wfhStep2Res.body.final, true);
  assert.strictEqual(wfh1001.wfh_status, 'approved');
  assert.strictEqual(wfh1001.wfh_reviewer_name, 'Nguyễn Văn Hậu');
  ok('Anh Hậu approves WFH step 2 -> wfh_status becomes approved (final: true)');

  // Verify popup created for employee
  const wfhPopup = shared.employee_popups.find(p => p.user_id === 30 && p.request_type === 'wfh' && p.request_id === 1001);
  assert.ok(wfhPopup, 'Employee popup must be created');
  assert.strictEqual(wfhPopup.decision, 'approved');
  assert.ok(wfhPopup.title.includes('đã được duyệt'));
  ok('Employee popup created on final WFH approval');

  // Employee fetches pending popups
  const empPopupsRes = await callApi('GET', '/api/employee/popups/pending', undefined, envEmp);
  assert.strictEqual(empPopupsRes.status, 200);
  assert.strictEqual(empPopupsRes.body.popups.length, 1);
  assert.strictEqual(empPopupsRes.body.popups[0].id, wfhPopup.id);
  ok('Employee receives pending popup via GET /api/employee/popups/pending');

  // Employee dismisses popup
  const dismissRes = await callApi('POST', `/api/employee/popups/${wfhPopup.id}/dismiss`, undefined, envEmp);
  assert.strictEqual(dismissRes.status, 200);
  const empPopupsAfter = await callApi('GET', '/api/employee/popups/pending', undefined, envEmp);
  assert.strictEqual(empPopupsAfter.body.popups.length, 0);
  ok('Dismissing popup sets is_dismissed = 1 and clears pending queue');

  // Direct approval override by anh Hậu at Step 1
  shared.attendance.push({
    id: 1002,
    user_id: 30,
    date: TODAY,
    work_type: 'wfh',
    shift: 'full',
    wfh_status: 'pending',
    wfh_reason: 'Khẩn cấp',
  });
  const directWfhRes = await callApi('POST', '/api/attendance/1002/wfh-decision', {
    action: 'approve',
    review_note: 'Anh Hậu duyệt khẩn cấp 1 bước',
  }, envHau);
  assert.strictEqual(directWfhRes.status, 200);
  assert.strictEqual(directWfhRes.body.wfh_status, 'approved');
  assert.strictEqual(directWfhRes.body.final, true);
  ok('Anh Hậu can directly approve WFH at step 1 (emergency override)');

  // ════════════════════════════════════════════════════════════════════════════
  // 2. OVERTIME REQUEST 2-STEP APPROVAL
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n--- 2. Overtime Request 2-Step Approval Flow ---');
  shared.overtime_requests.push({
    id: 2001,
    user_id: 30,
    work_date: TODAY,
    shift_end_time: '17:30',
    checkout_time: '19:30',
    requested_minutes: 120,
    reason: 'Hỗ trợ sự kiện',
    status: 'pending',
  });

  // HCNS approves step 1
  const otStep1Res = await callApi('POST', '/api/overtime-requests/2001/approve', {
    approved_minutes: 120,
    review_note: 'HCNS kiểm tra checkout chuẩn',
  }, envHr);
  assert.strictEqual(otStep1Res.status, 200);
  assert.strictEqual(otStep1Res.body.status, 'pending_director');
  assert.strictEqual(otStep1Res.body.final, false);
  const ot2001 = shared.overtime_requests.find(o => o.id === 2001);
  assert.strictEqual(ot2001.status, 'pending_director');
  assert.strictEqual(ot2001.step1_reviewer_name, 'Trần Thị Nhân Sự');
  ok('HCNS can approve Overtime Request step 1 -> status becomes pending_director');

  // Step 2 blocked for non-Hau
  const otStep2Forbidden = await callApi('POST', '/api/overtime-requests/2001/approve', {
    approved_minutes: 120,
  }, envHr);
  assert.strictEqual(otStep2Forbidden.status, 403);
  ok('Non-Hau cannot approve Overtime Request step 2 (403)');

  // Anh Hậu approves step 2
  const otStep2Res = await callApi('POST', '/api/overtime-requests/2001/approve', {
    approved_minutes: 120,
    review_note: 'Đồng ý duyệt 120 phút',
  }, envHau);
  assert.strictEqual(otStep2Res.status, 200);
  assert.strictEqual(otStep2Res.body.status, 'approved');
  assert.strictEqual(otStep2Res.body.final, true);
  assert.strictEqual(ot2001.status, 'approved');
  assert.strictEqual(ot2001.reviewer_name, 'Nguyễn Văn Hậu');

  const otPopup = shared.employee_popups.find(p => p.user_id === 30 && p.request_type === 'overtime' && p.request_id === 2001);
  assert.ok(otPopup, 'Employee popup must be created for approved overtime');
  assert.strictEqual(otPopup.decision, 'approved');
  ok('Anh Hậu approves Overtime Request step 2 -> popup created for employee');

  // ════════════════════════════════════════════════════════════════════════════
  // 3. OVERTIME FORM 2-STEP APPROVAL
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n--- 3. Overtime Form 2-Step Approval Flow ---');
  shared.overtime_forms.push({
    id: 3001,
    user_id: 30,
    month: '2026-09',
    period_month: '2026-09',
    requested_total_minutes: 120,
    approved_total_minutes: 120,
    items_json: '[]',
    total_hours: 15,
    status: 'pending',
  });

  // HCNS approves step 1
  const formStep1Res = await callApi('POST', '/api/overtime-forms/3001/decision', {
    action: 'approve',
    review_note: 'HCNS đã đối soát bảng công',
  }, envHr);
  assert.strictEqual(formStep1Res.status, 200);
  assert.strictEqual(formStep1Res.body.status, 'pending_director');
  assert.strictEqual(formStep1Res.body.final, false);
  const form3001 = shared.overtime_forms.find(f => f.id === 3001);
  assert.strictEqual(form3001.status, 'pending_director');
  assert.strictEqual(form3001.step1_reviewer_name, 'Trần Thị Nhân Sự');
  ok('HCNS approves Overtime Form step 1 -> status becomes pending_director');

  // Anh Hậu approves step 2
  const formStep2Res = await callApi('POST', '/api/overtime-forms/3001/decision', {
    action: 'approve',
    review_note: 'Duyệt bảng OT tháng 9',
  }, envHau);
  assert.strictEqual(formStep2Res.status, 200);
  assert.strictEqual(formStep2Res.body.status, 'approved');
  assert.strictEqual(formStep2Res.body.final, true);
  assert.strictEqual(form3001.status, 'approved');
  assert.strictEqual(form3001.reviewer_name, 'Nguyễn Văn Hậu');

  const formPopup = shared.employee_popups.find(p => p.user_id === 30 && p.request_type === 'overtime_form' && p.request_id === 3001);
  assert.ok(formPopup, 'Employee popup must be created for approved overtime form');
  assert.strictEqual(formPopup.decision, 'approved');
  ok('Anh Hậu approves Overtime Form step 2 -> popup created for employee');

  // ════════════════════════════════════════════════════════════════════════════
  // 4. LEAVE REQUEST 2-STEP APPROVAL & REJECTION
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n--- 4. Leave Request 2-Step Approval & Rejection ---');
  shared.leave_requests.push({
    id: 4001,
    employee_id: 30,
    type: 'annual',
    start_date: '2026-09-25',
    end_date: '2026-09-25',
    leave_session: 'full',
    total_days: 1,
    reason: 'Việc gia đình',
    status: 'pending',
  });

  // Step 1 approval by Manager
  const leaveStep1Res = await callApi('PUT', '/api/leave/4001', {
    status: 'approved',
  }, envMgr);
  assert.strictEqual(leaveStep1Res.status, 200);
  assert.strictEqual(leaveStep1Res.body.status, 'pending_director');
  assert.strictEqual(leaveStep1Res.body.final, false);
  const leave4001 = shared.leave_requests.find(l => l.id === 4001);
  assert.strictEqual(leave4001.status, 'pending_director');
  assert.strictEqual(leave4001.step1_reviewer_name, 'Lê Văn Trưởng Phòng');
  ok('Manager approves Leave step 1 -> status becomes pending_director (final: false)');

  // Step 2 blocked for Manager
  const leaveStep2Forbidden = await callApi('PUT', '/api/leave/4001', {
    status: 'approved',
  }, envMgr);
  assert.strictEqual(leaveStep2Forbidden.status, 403);
  ok('Manager cannot approve Leave step 2 (403)');

  // Step 2 approved by anh Hậu
  const leaveStep2Res = await callApi('PUT', '/api/leave/4001', {
    status: 'approved',
  }, envHau);
  assert.strictEqual(leaveStep2Res.status, 200);
  assert.strictEqual(leaveStep2Res.body.status, 'approved');
  assert.strictEqual(leaveStep2Res.body.final, true);
  assert.strictEqual(leave4001.status, 'approved');
  assert.strictEqual(leave4001.approved_by_name, 'Nguyễn Văn Hậu');

  const leavePopup = shared.employee_popups.find(p => p.user_id === 30 && p.request_type === 'leave' && p.request_id === 4001);
  assert.ok(leavePopup, 'Employee popup must be created for approved leave');
  assert.strictEqual(leavePopup.decision, 'approved');
  ok('Anh Hậu approves Leave step 2 -> popup created for employee');

  // Rejection at step 1 creates rejection popup
  shared.leave_requests.push({
    id: 4002,
    employee_id: 30,
    type: 'annual',
    start_date: '2026-09-28',
    end_date: '2026-09-28',
    leave_session: 'full',
    total_days: 1,
    reason: 'Nghỉ du lịch',
    status: 'pending',
  });
  const leaveRejectRes = await callApi('PUT', '/api/leave/4002', {
    status: 'rejected',
    note: 'Tuần này dự án đang bàn giao gấp',
  }, envMgr);
  assert.strictEqual(leaveRejectRes.status, 200);
  assert.strictEqual(leaveRejectRes.body.status, 'rejected');
  assert.strictEqual(leaveRejectRes.body.final, true);
  const rejectPopup = shared.employee_popups.find(p => p.user_id === 30 && p.request_type === 'leave' && p.request_id === 4002);
  assert.ok(rejectPopup, 'Employee popup must be created for rejected leave');
  assert.strictEqual(rejectPopup.decision, 'rejected');
  assert.ok(rejectPopup.message.includes('Tuần này dự án đang bàn giao gấp'));
  ok('Rejection at Step 1 marks rejected + creates rejection popup with reason');

  console.log(`\n🎉 ALL ${passed} TESTS PASSED SUCCESSFULLY!`);
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
