// ════════════════════════════════════════════════════════════════════════════
//  WFH Approval Workflow Verification Tests (node, mock D1)
// ════════════════════════════════════════════════════════════════════════════
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN = 'b'.repeat(64);
const SERVER_URL = 'https://x.local';
const TODAY = '2026-08-16';

const serverPath = path.resolve(__dirname, '../server.js');
const mod = await import(pathToFileURL(serverPath).href);
const { handle } = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ✓ ${name}`); }

function makeSession({ role = 'employee', department = 'Marketing', id = 1, full_name = 'NV 1' } = {}) {
  return {
    uid: id, full_name, email: `user${id}@x.com`, role, department,
    position: 'Nhân viên', avatar_color: '#4F46E5', avatar_initials: 'NV',
    avatar_url: null, employee_code: `NV-00${id}`, salary: 10000000, phone: '0901234567',
    bank_account: null, bank_name: null, is_active: 1,
    lifecycle_status: null, must_change_password: 0,
  };
}

function createMockEnv(sessionUser) {
  const users = [
    { id: 1, full_name: 'Nhân viên 1 (MKT)', role: 'employee', department: 'Marketing', employee_code: 'NV-001', avatar: null, is_active: 1 },
    { id: 2, full_name: 'Nhân viên 2 (IT)', role: 'employee', department: 'IT', employee_code: 'NV-002', avatar: null, is_active: 1 },
    { id: 3, full_name: 'Trưởng phòng MKT', role: 'manager', department: 'Marketing', employee_code: 'TP-001', avatar: null, is_active: 1 },
    { id: 4, full_name: 'Quản trị viên Admin', role: 'admin', department: 'Ban Giám Đốc', employee_code: 'AD-001', avatar: null, is_active: 1 },
  ];

  const attendance = [
    {
      id: 101, user_id: 1, date: TODAY, work_type: 'wfh', shift: 'full',
      registered: 1, checkin_time: '08:30', checkout_time: '17:30', status: 'present',
      work_hours: 8, wfh_status: 'pending', wfh_reason: 'Con ốm cần chăm sóc tại nhà',
      wfh_proof_url: 'https://drive.google.com/proof1', wfh_proof_filename: 'don_xin_phep.pdf',
      wfh_proof_document_id: null, wfh_reviewer_id: null, wfh_reviewer_name: null,
      wfh_review_note: null, wfh_reviewed_at: null, note: ''
    },
    {
      id: 102, user_id: 2, date: TODAY, work_type: 'wfh', shift: 'full',
      registered: 1, checkin_time: '08:30', checkout_time: '17:30', status: 'present',
      work_hours: 8, wfh_status: 'pending', wfh_reason: 'Nhà sửa điện nước',
      wfh_proof_url: null, wfh_proof_filename: null,
      wfh_proof_document_id: null, wfh_reviewer_id: null, wfh_reviewer_name: null,
      wfh_review_note: null, wfh_reviewed_at: null, note: ''
    }
  ];

  const wfhProofFiles = [
    {
      id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
      user_id: 1,
      filename: 'minh_chung.jpg',
      content_type: 'image/jpeg',
      byte_size: 100,
      data_base64: Buffer.from('fake-image-content').toString('base64'),
      created_at: '2026-08-16 08:00:00'
    }
  ];

  const notifications = [];

  const db = {
    async exec() {},
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async all() {
          if (sql.includes('FROM sessions')) return { results: [sessionUser] };
          if (sql.includes('FROM users')) {
            return { results: users };
          }
          if (sql.includes('FROM attendance a') && sql.includes('JOIN users u')) {
            let res = attendance.map(a => {
              const u = users.find(x => x.id === a.user_id) || {};
              return { ...a, full_name: u.full_name, employee_code: u.employee_code, department: u.department, avatar: u.avatar };
            });
            if (sql.includes("a.work_type = 'wfh'")) {
              res = res.filter(r => r.work_type === 'wfh' && r.wfh_status != null);
            }
            if (sql.includes('a.user_id = ?')) {
              res = res.filter(r => r.user_id === stmt.args[0]);
            }
            if (sql.includes('u.department = ?')) {
              res = res.filter(r => r.department === stmt.args[0]);
            }
            if (sql.includes('a.wfh_status = ?')) {
              const statusArg = stmt.args.find(arg => ['pending', 'approved', 'rejected'].includes(arg));
              if (statusArg) res = res.filter(r => r.wfh_status === statusArg);
            }
            return { results: res };
          }
          if (sql.includes('FROM attendance')) {
            return { results: attendance };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO notifications')) {
            notifications.push({ user_id: stmt.args[0], title: stmt.args[1], content: stmt.args[2] });
          }
          if (sql.includes('UPDATE attendance SET wfh_status=?, wfh_reviewer_id=?, wfh_reviewer_name=?, wfh_review_note=?, wfh_reviewed_at=')) {
            const [nextStatus, reviewerId, reviewerName, note, id] = stmt.args;
            const r = attendance.find(x => x.id === Number(id));
            if (r) {
              r.wfh_status = nextStatus;
              r.wfh_reviewer_id = reviewerId;
              r.wfh_reviewer_name = reviewerName;
              r.wfh_review_note = note;
              r.wfh_reviewed_at = new Date().toISOString();
            }
          }
          if (sql.includes('UPDATE attendance SET wfh_reason=?, wfh_proof_url=?, wfh_proof_filename=?, wfh_proof_document_id=?, wfh_status=?')) {
            const [reason, proofUrl, proofFilename, proofDocId, newStatus, _status2, id] = stmt.args;
            const r = attendance.find(x => x.id === Number(id));
            if (r) {
              r.wfh_reason = reason;
              r.wfh_proof_url = proofUrl;
              r.wfh_proof_filename = proofFilename;
              r.wfh_proof_document_id = proofDocId;
              r.wfh_status = newStatus;
              if (newStatus === 'pending') r.wfh_review_note = null;
            }
          }
          if (sql.includes('INSERT INTO attendance')) {
            const newId = attendance.length + 1000;
            const [uid, date, workType, shift, expStart, expEnd, note, _cond, reason, proofUrl, proofFilename, proofDocId] = stmt.args;
            attendance.push({
              id: newId, user_id: uid, date, work_type: workType, shift,
              expected_start: expStart, expected_end: expEnd, registered: 1,
              status: 'registered', note, wfh_status: workType === 'wfh' ? 'pending' : null,
              wfh_reason: reason, wfh_proof_url: proofUrl, wfh_proof_filename: proofFilename,
              wfh_proof_document_id: proofDocId,
            });
            return { meta: { last_row_id: newId } };
          }
          return { meta: { last_row_id: 1 } };
        },
        async first() {
          if (sql.includes('FROM sessions')) return sessionUser;
          if (sql.includes("setting_key='schema_version'") || sql.includes("setting_key='seed_version'")) return null;
          if (sql.includes('SELECT * FROM attendance WHERE user_id=? AND date=?')) {
            return attendance.find(r => r.user_id === stmt.args[0] && r.date === stmt.args[1]) || null;
          }
          if (sql.includes('FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?')) {
            const r = attendance.find(x => x.id === Number(stmt.args[0]));
            if (!r) return null;
            const u = users.find(x => x.id === r.user_id) || {};
            return { ...r, full_name: u.full_name, employee_code: u.employee_code, department: u.department };
          }
          if (sql.includes('SELECT * FROM wfh_proof_files WHERE id=?')) {
            return wfhProofFiles.find(f => f.id === stmt.args[0]) || null;
          }
          return null;
        }
      };
      return stmt;
    },
    async batch(items) { for (const it of items) await it.run(); }
  };

  return { env: { DB: db }, attendance, users, notifications, wfhProofFiles };
}

async function callApi(method, path, body, env) {
  const req = new Request(SERVER_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': TOKEN,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handle(req, env.env);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data, res };
}

console.log('\n--- 1. Validation for WFH Registration ---');
{
  const user1 = makeSession({ id: 5, role: 'employee', full_name: 'Employee Test' });
  const mock = createMockEnv(user1);

  // Register WFH without reason -> Should fail 400
  const resNoReason = await callApi('POST', '/api/attendance/register', {
    work_type: 'wfh',
    shift: 'full',
  }, mock);
  assert.strictEqual(resNoReason.status, 400);
  assert.ok(resNoReason.body.error.includes('lý do'));
  ok('Registration without WFH reason is blocked (400)');

  // Register WFH with reason -> Should succeed 200 and set wfh_status = pending
  const resValid = await callApi('POST', '/api/attendance/register', {
    work_type: 'wfh',
    shift: 'full',
    wfh_reason: 'Nhà có việc gia đình đột xuất',
    wfh_proof_url: 'https://docs.google.com/123',
    wfh_proof_filename: 'don_wfh.pdf'
  }, mock);
  assert.strictEqual(resValid.status, 200);
  assert.strictEqual(resValid.body.ok, true);
  const created = mock.attendance.find(a => a.user_id === 5);
  assert.ok(created);
  assert.strictEqual(created.wfh_status, 'pending');
  assert.strictEqual(created.wfh_reason, 'Nhà có việc gia đình đột xuất');
  ok('Registration with WFH reason succeeds with pending status');
}

console.log('\n--- 2. WFH Request Scoping (Role-based access) ---');
{
  // Employee 1 sees only employee 1's request
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }));
  const empRes = await callApi('GET', '/api/attendance/wfh-requests', undefined, empEnv);
  assert.strictEqual(empRes.status, 200);
  assert.strictEqual(empRes.body.wfh_requests.length, 1);
  assert.strictEqual(empRes.body.wfh_requests[0].user_id, 1);
  ok('Employee only retrieves their own WFH requests');

  // Manager in Marketing sees Marketing requests (employee 1), not IT (employee 2)
  const mgrEnv = createMockEnv(makeSession({ id: 3, role: 'manager', department: 'Marketing' }));
  const mgrRes = await callApi('GET', '/api/attendance/wfh-requests', undefined, mgrEnv);
  assert.strictEqual(mgrRes.status, 200);
  assert.strictEqual(mgrRes.body.wfh_requests.length, 1);
  assert.strictEqual(mgrRes.body.wfh_requests[0].department, 'Marketing');
  ok('Manager only retrieves their department WFH requests');

  // Admin sees all departments
  const admEnv = createMockEnv(makeSession({ id: 4, role: 'admin', department: 'Ban Giám Đốc' }));
  const admRes = await callApi('GET', '/api/attendance/wfh-requests', undefined, admEnv);
  assert.strictEqual(admRes.status, 200);
  assert.strictEqual(admRes.body.wfh_requests.length, 2);
  ok('Admin retrieves company-wide WFH requests');
}

console.log('\n--- 3. WFH Decision: Approve & Reject ---');
{
  const mgrEnv = createMockEnv(makeSession({ id: 3, role: 'manager', department: 'Marketing', full_name: 'Trưởng phòng MKT' }));

  // Manager attempts to decide request from IT (department mismatch) -> 403
  const mismatchRes = await callApi('POST', '/api/attendance/102/wfh-decision', {
    action: 'approve'
  }, mgrEnv);
  assert.strictEqual(mismatchRes.status, 403);
  ok('Cross-department approval by manager is blocked (403)');

  // Reject without review note -> 400
  const rejectNoNote = await callApi('POST', '/api/attendance/101/wfh-decision', {
    action: 'reject',
    review_note: '   '
  }, mgrEnv);
  assert.strictEqual(rejectNoNote.status, 400);
  assert.ok(rejectNoNote.body.error.includes('lý do'));
  ok('Rejecting WFH without reason/note is blocked (400)');

  // Reject with review note -> 200, updates status to 'rejected'
  const rejectRes = await callApi('POST', '/api/attendance/101/wfh-decision', {
    action: 'reject',
    review_note: 'Hôm nay có lịch họp offline toàn team bắt buộc tham gia'
  }, mgrEnv);
  assert.strictEqual(rejectRes.status, 200);
  assert.strictEqual(rejectRes.body.wfh_status, 'rejected');
  const att101 = mgrEnv.attendance.find(a => a.id === 101);
  assert.strictEqual(att101.wfh_status, 'rejected');
  assert.strictEqual(att101.wfh_review_note, 'Hôm nay có lịch họp offline toàn team bắt buộc tham gia');
  assert.strictEqual(att101.wfh_reviewer_name, 'Trưởng phòng MKT');
  assert.ok(mgrEnv.notifications.some(n => n.user_id === 1 && n.title.includes('từ chối')));
  ok('Rejecting WFH with reason sets status rejected & sends notification');

  // Approve request -> 200, updates status to 'approved'
  const approveRes = await callApi('POST', '/api/attendance/101/wfh-decision', {
    action: 'approve',
    review_note: 'Đã nắm thông tin'
  }, mgrEnv);
  assert.strictEqual(approveRes.status, 200);
  assert.strictEqual(approveRes.body.wfh_status, 'approved');
  assert.strictEqual(att101.wfh_status, 'approved');
  assert.strictEqual(att101.wfh_reviewer_id, 3);
  assert.ok(mgrEnv.notifications.some(n => n.user_id === 1 && n.title.includes('đã được duyệt')));
  ok('Approving WFH sets status approved & sends notification');
}

console.log('\n--- 4. Resubmitting / Updating WFH Proof & Reason ---');
{
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }));
  const att101 = empEnv.attendance.find(a => a.id === 101);
  att101.wfh_status = 'rejected';
  att101.wfh_review_note = 'Thiếu minh chứng giấy nghỉ phép có chữ ký';

  // Another user tries to update -> 403
  const otherEmpEnv = createMockEnv(makeSession({ id: 2, role: 'employee', department: 'IT' }));
  otherEmpEnv.attendance = empEnv.attendance;
  const unauthorizedRes = await callApi('POST', '/api/attendance/101/wfh-proof', {
    wfh_reason: 'Cập nhật lại'
  }, otherEmpEnv);
  assert.strictEqual(unauthorizedRes.status, 403);
  ok('Unauthorized user cannot update proof (403)');

  // Owner resubmits proof -> resets wfh_status from 'rejected' to 'pending'
  const resubmitRes = await callApi('POST', '/api/attendance/101/wfh-proof', {
    wfh_reason: 'Đã bổ sung giấy xác nhận có chữ ký bác sĩ',
    wfh_proof_url: 'https://storage/new-proof.pdf',
    wfh_proof_filename: 'giay_kham_benh.pdf'
  }, empEnv);
  assert.strictEqual(resubmitRes.status, 200);
  assert.strictEqual(resubmitRes.body.wfh_status, 'pending');
  assert.strictEqual(att101.wfh_status, 'pending');
  assert.strictEqual(att101.wfh_proof_filename, 'giay_kham_benh.pdf');
  assert.strictEqual(att101.wfh_review_note, null);
  ok('Resubmitting proof resets rejected status back to pending');
}

console.log('\n--- 5. Proof File Serving & Authorization ---');
{
  const fileId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

  // Owner (user 1) fetches file -> 200 with inline disposition
  const ownerEnv = createMockEnv(makeSession({ id: 1, role: 'employee' }));
  const ownerReq = new Request(`${SERVER_URL}/api/attendance/wfh-proof/${fileId}`, {
    headers: { 'X-Auth-Token': TOKEN }
  });
  const ownerRes = await handle(ownerReq, ownerEnv.env);
  assert.strictEqual(ownerRes.status, 200);
  assert.strictEqual(ownerRes.headers.get('Content-Type'), 'image/jpeg');
  const buffer = await ownerRes.arrayBuffer();
  assert.strictEqual(Buffer.from(buffer).toString('utf-8'), 'fake-image-content');
  ok('Owner can retrieve uploaded proof file');

  // Another employee (user 2) fetches file -> 403 Forbidden
  const otherEnv = createMockEnv(makeSession({ id: 2, role: 'employee' }));
  const otherReq = new Request(`${SERVER_URL}/api/attendance/wfh-proof/${fileId}`, {
    headers: { 'X-Auth-Token': TOKEN }
  });
  const otherRes = await handle(otherReq, otherEnv.env);
  assert.strictEqual(otherRes.status, 403);
  ok('Non-authorized user cannot access proof file (403)');

  // Admin fetches file -> 200 OK
  const adminEnv = createMockEnv(makeSession({ id: 4, role: 'admin' }));
  const adminReq = new Request(`${SERVER_URL}/api/attendance/wfh-proof/${fileId}`, {
    headers: { 'X-Auth-Token': TOKEN }
  });
  const adminRes = await handle(adminReq, adminEnv.env);
  assert.strictEqual(adminRes.status, 200);
  ok('Admin can access proof file');
}

console.log(`\n========================================`);
console.log(`ALL ${passed} WFH APPROVAL TESTS PASSED!`);
console.log(`========================================\n`);
