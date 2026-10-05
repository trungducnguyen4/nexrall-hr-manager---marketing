import { pathToFileURL } from 'url';
import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const {
  ensureAiSchema,
  executeTool,
  runCopilotTurn,
  handle
} = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ok  ${name}`); }

function makeD1(db) {
  return {
    async exec(sql) { db.exec(sql); },
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const s = {
        bind(...a) { args = a; return s; },
        async all() { const results = stmt.all(...args); return { results }; },
        async first() { const row = stmt.get(...args); return row ?? null; },
        async run() {
          const info = stmt.run(...args);
          return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
        },
      };
      return s;
    },
    async batch(items) { for (const it of items) await it.run(); },
  };
}

console.log('--- Test Suite: AI Agent Action Engine & Real Operations Execution ---');

const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT,
    full_name TEXT,
    email TEXT,
    password_hash TEXT,
    role TEXT DEFAULT 'employee',
    department TEXT,
    position TEXT,
    avatar_color TEXT DEFAULT '#4F46E5',
    avatar_initials TEXT DEFAULT 'NV',
    avatar_url TEXT,
    work_location TEXT DEFAULT 'HN',
    salary REAL DEFAULT 0,
    phone TEXT,
    bank_account TEXT,
    bank_name TEXT,
    is_active INTEGER DEFAULT 1,
    employee_type TEXT DEFAULT 'fulltime',
    lifecycle_status TEXT DEFAULT 'Chính thức',
    must_change_password INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leave_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    balance_year INTEGER,
    available_days REAL,
    used_days REAL
  );

  CREATE TABLE IF NOT EXISTS task_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    project_id INTEGER
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER DEFAULT 1,
    team_project_id INTEGER,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    due_date TEXT,
    assigned_to INTEGER,
    assigned_by INTEGER,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    employee_id INTEGER,
    request_type TEXT,
    type TEXT,
    start_date TEXT,
    end_date TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    step1_status TEXT DEFAULT 'pending',
    step2_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    priority TEXT DEFAULT 'normal',
    target_scope TEXT DEFAULT 'all',
    target_department TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    month INTEGER,
    year INTEGER,
    status TEXT DEFAULT 'published'
  );

  CREATE TABLE invoice_review_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER,
    user_id INTEGER,
    category TEXT,
    message TEXT,
    requested_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    user_id INTEGER,
    expires_at INTEGER DEFAULT 9999999999,
    revoked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    employee_id INTEGER,
    employee_code TEXT,
    month TEXT,
    base_salary REAL DEFAULT 0,
    net_salary REAL DEFAULT 0
  );
`);

const d1 = makeD1(db);
const env = {
  DB: d1,
  AI_PROVIDER: 'edge_simulated',
  JWT_SECRET: 'test_secret_for_agent_actions'
};

const ADMIN_TOKEN = '1'.repeat(64);
const MANAGER_TOKEN = '2'.repeat(64);
const EMPLOYEE_TOKEN = '3'.repeat(64);

await ensureAiSchema(env);

// Seed users: Admin, Manager, Employee 1, Employee 2
db.exec(`
  INSERT INTO users (id, employee_code, full_name, email, role, department)
  VALUES
    (1, 'NV01', 'Admin Quản Trị', 'admin@netviet.live', 'admin', 'HCNS'),
    (2, 'NV02', 'Trưởng Phòng Hải', 'manager@netviet.live', 'manager', 'Marketing'),
    (3, 'NV03', 'Nguyễn Đức Trung', 'trung@netviet.live', 'employee', 'Marketing'),
    (4, 'NV04', 'Lê Thị Thu', 'thu@netviet.live', 'employee', 'HCNS');

  INSERT INTO sessions (token, user_id, expires_at, revoked)
  VALUES
    ('${ADMIN_TOKEN}', 1, 9999999999, 0),
    ('${MANAGER_TOKEN}', 2, 9999999999, 0),
    ('${EMPLOYEE_TOKEN}', 3, 9999999999, 0);

  INSERT INTO tasks (id, title, status, priority, due_date, assigned_to, assigned_by)
  VALUES
    (101, 'Viết bài truyền thông chiến dịch Q4', 'todo', 'medium', '2026-10-15', 3, 2),
    (102, 'Thiết kế banner sinh nhật công ty', 'in-progress', 'high', '2026-10-20', 3, 2);

  INSERT INTO requests (id, user_id, request_type, start_date, end_date, reason, status)
  VALUES
    (201, 3, 'leave', '2026-10-10', '2026-10-11', 'Đi việc gia đình', 'pending'),
    (202, 3, 'leave', '2026-09-01', '2026-09-02', 'Nghỉ ốm', 'approved');

  INSERT INTO invoices (id, user_id, month, year, status)
  VALUES (301, 3, 8, 2026, 'published');
`);

const adminUser = { id: 1, employee_code: 'NV01', full_name: 'Admin Quản Trị', role: 'admin' };
const managerUser = { id: 2, employee_code: 'NV02', full_name: 'Trưởng Phòng Hải', role: 'manager' };
const employeeUser = { id: 3, employee_code: 'NV03', full_name: 'Nguyễn Đức Trung', role: 'employee' };

// -------------------------------------------------------------
// Test 1: Direct Task Status Update via Tool & RBAC
// -------------------------------------------------------------
{
  // Employee 3 updates task 101 assigned to himself -> Allowed
  const res = await executeTool(env, 'task_update_status', { taskId: 101, status: 'done' }, employeeUser);
  assert.strictEqual(res.executed, true);
  assert.strictEqual(res.actionType, 'update_task_status');
  assert.ok(res.undoAction);
  assert.strictEqual(res.undoAction.payload.status, 'todo');

  const check = db.prepare('SELECT status FROM tasks WHERE id = 101').get();
  assert.strictEqual(check.status, 'done');
  ok('Direct Execution: Task status updated to "done" with undo payload generated');
}

// -------------------------------------------------------------
// Test 2: Task Status Update RBAC (Unrelated employee rejected)
// -------------------------------------------------------------
{
  const unrelatedUser = { id: 4, employee_code: 'NV04', full_name: 'Lê Thị Thu', role: 'employee' };
  const res = await executeTool(env, 'task_update_status', { taskId: 101, status: 'in-progress' }, unrelatedUser);
  assert.strictEqual(res.error, 'PERMISSION_DENIED');
  ok('RBAC Protection: Unassigned employee blocked from altering task status');
}

// -------------------------------------------------------------
// Test 3: Direct Task Reassignment by Manager
// -------------------------------------------------------------
{
  const res = await executeTool(env, 'task_assign', { taskId: 101, assigneeName: 'Lê Thị Thu' }, managerUser);
  assert.strictEqual(res.executed, true);
  assert.strictEqual(res.actionType, 'assign_task');
  assert.strictEqual(res.undoAction.payload.assigneeId, 3);

  const check = db.prepare('SELECT assigned_to FROM tasks WHERE id = 101').get();
  assert.strictEqual(check.assigned_to, 4);
  ok('Direct Execution: Manager successfully reassigns task with undo payload');
}

// -------------------------------------------------------------
// Test 4: Task Details Update (Due date & priority)
// -------------------------------------------------------------
{
  const res = await executeTool(env, 'task_update_details', { taskId: 102, dueDate: '2026-10-25', priority: 'urgent' }, managerUser);
  assert.strictEqual(res.executed, true);

  const check = db.prepare('SELECT due_date, priority FROM tasks WHERE id = 102').get();
  assert.strictEqual(check.due_date, '2026-10-25');
  assert.strictEqual(check.priority, 'urgent');
  ok('Direct Execution: Task due date and priority updated');
}

// -------------------------------------------------------------
// Test 5: Leave Approval RBAC & Execution
// -------------------------------------------------------------
{
  // Employee cannot approve
  const empRes = await executeTool(env, 'leave_approve', { requestId: 201 }, employeeUser);
  assert.strictEqual(empRes.error, 'PERMISSION_DENIED');

  // Manager can approve
  const mgrRes = await executeTool(env, 'leave_approve', { requestId: 201 }, managerUser);
  assert.strictEqual(mgrRes.executed, true);
  assert.strictEqual(mgrRes.actionType, 'approve_leave_request');

  const check = db.prepare('SELECT status, step1_status, step2_status FROM requests WHERE id = 201').get();
  assert.strictEqual(check.status, 'approved');
  assert.strictEqual(check.step1_status, 'approved');
  ok('Leave Approval: Strictly enforces Manager/Admin role and marks request approved');
}

// -------------------------------------------------------------
// Test 6: Leave Cancellation by Owner
// -------------------------------------------------------------
{
  // Create a pending request
  db.exec("INSERT INTO requests (id, user_id, start_date, end_date, status) VALUES (203, 3, '2026-11-01', '2026-11-02', 'pending')");

  // Owner cancels -> Allowed
  const res = await executeTool(env, 'leave_cancel', { requestId: 203 }, employeeUser);
  assert.strictEqual(res.executed, true);
  assert.strictEqual(res.actionType, 'cancel_leave_request');

  const check = db.prepare('SELECT status FROM requests WHERE id = 203').get();
  assert.strictEqual(check.status, 'cancelled');
  ok('Leave Cancellation: Employee can cancel their own pending leave request');
}

// -------------------------------------------------------------
// Test 7: Announcement Creation Draft Card for sensitive ops
// -------------------------------------------------------------
{
  const res = await executeTool(env, 'announcement_post', {
    title: 'Thông báo nghỉ lễ Quốc Khánh',
    content: 'Toàn thể CBNV nghỉ lễ từ ngày...',
    priority: 'important'
  }, adminUser);

  assert.strictEqual(res.isActionCard, true);
  assert.strictEqual(res.actionType, 'post_announcement');
  assert.strictEqual(res.payload.title, 'Thông báo nghỉ lễ Quốc Khánh');
  ok('Human-in-the-Loop Card: Sensitive broadcast returns interactive Action Card for review');
}

// -------------------------------------------------------------
// Test 8: Employee Code Update RBAC Check
// -------------------------------------------------------------
{
  // Employee attempting to change code -> Blocked
  const empRes = await executeTool(env, 'employee_update_code', { userId: 3, employeeCode: 'NV888' }, employeeUser);
  assert.strictEqual(empRes.error, 'PERMISSION_DENIED');

  // Admin attempting -> Generates Action Card
  const adminRes = await executeTool(env, 'employee_update_code', { userId: 3, employeeCode: 'NV888' }, adminUser);
  assert.strictEqual(adminRes.isActionCard, true);
  assert.strictEqual(adminRes.payload.employeeCode, 'NV888');
  ok('Employee Code Update: Admin-only protection strictly enforced');
}

// -------------------------------------------------------------
// Test 9: Payroll Review Request Execution
// -------------------------------------------------------------
{
  const res = await executeTool(env, 'payroll_request_review', {
    month: '2026-08',
    message: 'Tháng 8 tôi bị tính thiếu 1 ngày công tác',
    requestedAmount: 500000
  }, employeeUser);

  assert.strictEqual(res.executed, true);
  assert.strictEqual(res.actionType, 'request_invoice_review');

  const check = db.prepare('SELECT * FROM invoice_review_requests WHERE user_id = 3').get();
  assert.ok(check);
  assert.strictEqual(check.category, 'other');
  assert.strictEqual(check.requested_amount, 500000);
  ok('Payroll Review Request: Recorded in invoice_review_requests and notified to HCNS');
}

// -------------------------------------------------------------
// Test 10: Natural Language Intent Recognition in runCopilotTurn
// -------------------------------------------------------------
{
  // User says: "Đổi task 102 sang hoàn thành giúp tôi"
  const turn1 = await runCopilotTurn(env, {
    userMessage: 'Đổi task 102 sang hoàn thành giúp tôi',
    me: managerUser,
    conversationHistory: []
  });
  assert.ok(turn1.executedAction || turn1.actionCard);
  assert.strictEqual(turn1.executedAction?.actionType, 'update_task_status');

  const check1 = db.prepare('SELECT status FROM tasks WHERE id = 102').get();
  assert.strictEqual(check1.status, 'done');
  ok('Natural Language Parser: "Đổi task 102 sang hoàn thành" parsed and executed automatically');
}

// -------------------------------------------------------------
// Test 11: HTTP POST /api/ai/actions/confirm (Confirm Action Card)
// -------------------------------------------------------------
{
  // Confirm posting announcement as Admin
  const req = new Request('https://hrnetviet.live/api/ai/actions/confirm', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth-token': ADMIN_TOKEN
    },
    body: JSON.stringify({
      actionType: 'post_announcement',
      payload: {
        title: 'Lịch kiểm toán nội bộ tháng 10',
        content: 'Bộ phận HCNS và Kế toán sẽ kiểm toán từ ngày 15/10.',
        priority: 'important'
      }
    })
  });

  const res = await handle(req, env);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.ok(data.announcementId);

  const check = db.prepare('SELECT title FROM announcements WHERE id = ?').get(data.announcementId);
  assert.strictEqual(check.title, 'Lịch kiểm toán nội bộ tháng 10');
  ok('HTTP API Confirm: /api/ai/actions/confirm executes post_announcement');
}

// -------------------------------------------------------------
// Test 12: HTTP POST /api/ai/actions/confirm RBAC enforcement
// -------------------------------------------------------------
{
  // Employee tries to post announcement -> 403 Forbidden
  const req = new Request('https://hrnetviet.live/api/ai/actions/confirm', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth-token': EMPLOYEE_TOKEN
    },
    body: JSON.stringify({
      actionType: 'post_announcement',
      payload: { title: 'Thông báo hack' }
    })
  });

  const res = await handle(req, env);
  assert.strictEqual(res.status, 403);
  ok('HTTP API Confirm: Regular employee blocked from post_announcement with HTTP 403');
}

// -------------------------------------------------------------
// Test 13: HTTP POST /api/ai/actions/undo (Rollback Action)
// -------------------------------------------------------------
{
  // First update task 102 to 'todo'
  db.exec("UPDATE tasks SET status = 'done' WHERE id = 102");

  const req = new Request('https://hrnetviet.live/api/ai/actions/undo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth-token': MANAGER_TOKEN
    },
    body: JSON.stringify({
      actionType: 'update_task_status',
      payload: {
        taskId: 102,
        status: 'in-progress'
      }
    })
  });

  const res = await handle(req, env);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);

  const check = db.prepare('SELECT status FROM tasks WHERE id = 102').get();
  assert.strictEqual(check.status, 'in-progress');
  ok('HTTP API Undo: /api/ai/actions/undo seamlessly rolls back task status');
}

// -------------------------------------------------------------
// Test 14: Check-in Compliance Guardrail ("giúp tôi checkin hôm nay" when not checked in)
// -------------------------------------------------------------
{
  // User 3 has not checked in today yet
  const res = await runCopilotTurn(env, {
    userMessage: 'giúp tôi checkin hôm nay',
    me: employeeUser,
    conversationHistory: []
  });

  assert.ok(res.content.includes('không thể thực hiện chấm công thay nhân sự'));
  assert.ok(res.content.includes('GPS Geofence'));
  assert.strictEqual(res.actionCard?.isNavigationCard, true);
  assert.strictEqual(res.actionCard?.link, '#/attendance');
  assert.ok(!res.content.includes('2023'), 'Must NOT hallucinate 2023 date');
  ok('Anti-Hallucination Guardrail: "giúp tôi checkin hôm nay" strictly rejects fake check-in and provides navigation card');
}

// -------------------------------------------------------------
// Test 15: Check-in Status Reporting ("giúp tôi checkin hôm nay" when already checked in)
// -------------------------------------------------------------
{
  const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
  const todayYMD = nowVN.toISOString().slice(0, 10);

  // Insert today's checkin for User 3
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      date TEXT,
      work_date TEXT,
      checkin_time TEXT,
      check_in TEXT,
      checkout_time TEXT,
      check_out TEXT,
      status TEXT,
      late_minutes INTEGER DEFAULT 0,
      note TEXT
    );
    INSERT INTO attendance (user_id, date, checkin_time, status, late_minutes)
    VALUES (3, '${todayYMD}', '08:28', 'present', 0);
  `);

  const res = await runCopilotTurn(env, {
    userMessage: 'giúp tôi checkin hôm nay',
    me: employeeUser,
    conversationHistory: []
  });

  assert.ok(res.content.includes('08:28'));
  assert.ok(res.content.includes('Đúng giờ'));
  assert.ok(!res.content.includes('2023'), 'Must NOT hallucinate 2023 date');
  ok('Attendance Status Check: Accurately reports real check-in record when user has already checked in today');
}

// -------------------------------------------------------------
// Test 16: Grounded Leave Overview ("tổng quan xem mọi người nghỉ phép vì lí do gì")
// -------------------------------------------------------------
{
  const res = await runCopilotTurn(env, {
    userMessage: 'tổng quan xem mọi người nghỉ phép vì lí do gì',
    me: managerUser,
    conversationHistory: []
  });

  assert.ok(!res.content.includes('các lý do nghỉ phép phổ biến của nhân sự bao gồm: nghỉ phép năm (Annual Leave)'), 'Must NOT return generic textbook boilerplate');
  assert.ok(res.content.includes('gia đình') || res.content.includes('ốm') || res.content.includes('đơn') || res.content.includes('lý do'));
  ok('Grounded Leave Overview: "tổng quan xem mọi người nghỉ phép vì lí do gì" aggregates real DB records instead of textbook boilerplate');
}

console.log(`\nALL ${passed} AI AGENT ACTIONS TESTS PASSED!`);
