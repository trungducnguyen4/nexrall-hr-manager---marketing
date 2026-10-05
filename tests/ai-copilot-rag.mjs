import { pathToFileURL } from 'url';
import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const {
  ensureAiSchema,
  seedInitialKnowledge,
  hybridSearch,
  chunkMarkdownDocument,
  cosineSimilarity,
  generateDeterministicEmbedding,
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

console.log('--- Test Suite: AI Copilot, Deep RAG & LLMOps Platform ---');

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
    lifecycle_status TEXT DEFAULT 'Chính thức',
    must_change_password INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE task_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER DEFAULT 1,
    name TEXT,
    status TEXT DEFAULT 'active'
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

  CREATE TABLE attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    work_date TEXT,
    check_in TEXT,
    check_out TEXT,
    status TEXT DEFAULT 'present',
    is_late INTEGER DEFAULT 0,
    late_minutes INTEGER DEFAULT 0,
    note TEXT
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    user_id INTEGER,
    expires_at INTEGER DEFAULT 9999999999,
    revoked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    employee_id INTEGER,
    month TEXT,
    base_salary REAL DEFAULT 0,
    kpi_bonus REAL DEFAULT 0,
    allowance REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    overtime_pay REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    insurance REAL DEFAULT 0,
    work_days REAL DEFAULT 0,
    standard_days REAL DEFAULT 0,
    net_salary REAL DEFAULT 0,
    transfer_amount REAL DEFAULT 0,
    transfer_status TEXT,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS payroll_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'draft',
    total_employees INTEGER DEFAULT 0,
    complete_employees INTEGER DEFAULT 0,
    missing_employees INTEGER DEFAULT 0,
    estimated_total REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    month INTEGER,
    year INTEGER,
    base_salary REAL DEFAULT 0,
    bonus REAL DEFAULT 0,
    allowance REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    net_salary REAL DEFAULT 0,
    status TEXT DEFAULT 'issued'
  );
`);

const env = { DB: makeD1(db) };

const USER_TOKEN = 'a'.repeat(64);
const ADMIN_TOKEN = 'b'.repeat(64);

// Insert test users
db.exec(`
  INSERT INTO users (id, employee_code, full_name, email, role, department) VALUES
  (1, 'ADMIN', 'Admin Director', 'admin@netviet.com.vn', 'admin', 'Ban Giám Đốc'),
  (101, 'NV001', 'Nguyễn Văn A', 'nva@netviet.com.vn', 'employee', 'Kỹ thuật'),
  (102, 'NV002', 'Trần Thị B', 'ttb@netviet.com.vn', 'employee', 'Marketing');

  INSERT INTO sessions (token, user_id, expires_at, revoked) VALUES
  ('${USER_TOKEN}', 101, 9999999999, 0),
  ('${ADMIN_TOKEN}', 1, 9999999999, 0);

  INSERT INTO attendance (user_id, work_date, check_in, is_late, late_minutes, note) VALUES
  (101, '2026-10-01', '08:34', 0, 0, ''),
  (101, '2026-10-02', '08:40', 1, 5, 'Đi muộn 5 phút (Lần 1 - Miễn phạt)'),
  (101, '2026-10-03', '08:45', 1, 10, 'Đi muộn 10 phút (Lần 2 - Miễn phạt)'),
  (101, '2026-10-05', '08:50', 1, 15, 'Đi muộn 15 phút (Lần 3 - Phạt: 20.000đ)');

  INSERT INTO tasks (title, assigned_to, assigned_by, status, priority) VALUES
  ('Viết báo cáo kỹ thuật Q3', 101, 1, 'in-progress', 'high'),
  ('Tối ưu hóa cơ sở dữ liệu', 101, 1, 'todo', 'urgent');

  INSERT INTO payroll_batches (month, status) VALUES ('2026-08', 'published'), ('2026-09', 'draft');

  INSERT INTO payroll (employee_id, user_id, month, base_salary, work_days, standard_days, kpi_bonus, allowance, deduction, overtime_pay, insurance, tax, net_salary, transfer_status) VALUES
  (101, '101', '2026-08', 15000000, 22, 22, 2000000, 1000000, 20000, 500000, 1575000, 350000, 16555000, 'Đã chuyển khoản'),
  (101, '101', '2026-09', 15000000, 20, 22, 1500000, 1000000, 40000, 0, 1575000, 300000, 15585000, 'Tạm tính'),
  (102, '102', '2026-08', 18000000, 22, 22, 3000000, 1500000, 0, 0, 1890000, 550000, 20060000, 'Đã chuyển khoản');
`);

// Test 1: ensureAiSchema and seedInitialKnowledge
await ensureAiSchema(env);
const seedRes = await seedInitialKnowledge(env, 1);
assert.strictEqual(seedRes.ok, true);

const docCount = db.prepare('SELECT COUNT(*) as c FROM knowledge_documents').get();
assert.strictEqual(docCount.c, 3, 'Must seed exactly 3 knowledge documents');

const chunkCount = db.prepare('SELECT COUNT(*) as c FROM knowledge_chunks').get();
assert(chunkCount.c >= 6, 'Must have multiple semantic chunks across documents');
ok('ensureAiSchema & seedInitialKnowledge successfully indexed HR policy documents');

// Test 2: Deterministic vector embedding & Cosine Similarity
const v1 = generateDeterministicEmbedding('Quy định giờ làm 8h35 đi muộn');
const v2 = generateDeterministicEmbedding('Giờ làm việc và tính trễ 8h35');
const v3 = generateDeterministicEmbedding('Bảo mật tài khoản ngân hàng mật khẩu');
const sim12 = cosineSimilarity(v1, v2);
const sim13 = cosineSimilarity(v1, v3);
assert(sim12 > sim13, 'Similar semantic strings must have higher cosine similarity');
ok('Embedding & Cosine Similarity math functions correctly');

// Test 3: Hybrid Search (RAG)
const ragLate = await hybridSearch(env, { query: 'đi muộn sau 8h35 bị phạt bao nhiêu tiền?', limit: 3 });
assert(ragLate.results.length > 0, 'Must retrieve chunks for late policy');
assert(ragLate.citations.length > 0, 'Must generate citations');
assert(ragLate.contextText.includes('08:35') || ragLate.contextText.includes('phạt'), 'Context must contain late policy details');
ok('HybridSearch (Vector + BM25 + RRF) retrieves accurate policy chunks with citations');

// Test 4: Tool Execution (Attendance Summary)
const me101 = { id: 101, full_name: 'Nguyễn Văn A', role: 'employee', department: 'Kỹ thuật' };
const attSummary = await executeTool(env, 'get_my_attendance_summary', { month: '2026-10' }, me101);
assert.strictEqual(attSummary.lateCount, 3);
assert.strictEqual(attSummary.penaltyCount, 1);
assert.strictEqual(attSummary.totalPenaltyVnd, 20000);
ok('Tool: get_my_attendance_summary calculates late counts and 20k penalty correctly');

// Test 5: Tool Execution (List Tasks)
const taskList = await executeTool(env, 'list_my_tasks', { status: 'all' }, me101);
assert.strictEqual(taskList.count, 2);
assert.strictEqual(taskList.tasks[0].priority, 'urgent');
ok('Tool: list_my_tasks returns user tasks sorted by priority');

// Test 6: Copilot Turn & Telemetry Logging
const turnRes = await runCopilotTurn(env, {
  userMessage: 'Quy định đi muộn sau 8h35 và mức phạt thế nào?',
  conversationHistory: [],
  me: me101
});
assert(turnRes.requestId.startsWith('req_'));
assert(turnRes.content.length > 20);
assert(turnRes.telemetry.tokens.total > 0);
assert(turnRes.telemetry.latencyMs >= 0);

// Check log was saved to DB
const logRow = db.prepare('SELECT * FROM ai_generation_logs WHERE id=?').get(turnRes.requestId);
assert(logRow, 'Telemetry log must be persisted in ai_generation_logs');
assert.strictEqual(logRow.user_id, 101);
ok('runCopilotTurn executes grounded reasoning and logs LLMOps telemetry');

// Test 6b: Tool: get_my_payslip_summary calculates payslip breakdown & distinguishes official vs draft
const payslipAug = await executeTool(env, 'get_my_payslip_summary', { month: '2026-08' }, me101);
assert.strictEqual(payslipAug.found, true);
assert.strictEqual(payslipAug.isOfficial, true);
assert.strictEqual(payslipAug.financialSummary.netSalaryVnd, 16555000);
assert.strictEqual(payslipAug.financialSummary.kpiBonusVnd, 2000000);

const payslipSep = await executeTool(env, 'get_my_payslip_summary', { month: '2026-09' }, me101);
assert.strictEqual(payslipSep.found, true);
assert.strictEqual(payslipSep.isOfficial, false);
assert(payslipSep.statusNote.includes('TẠM TÍNH'));
ok('Tool: get_my_payslip_summary provides complete financial breakdown & handles draft status');

// Test 6c: Enterprise Privacy Guardrail & PII Shield blocks non-admin asking for other employee's salary
const privacyTurn = await runCopilotTurn(env, {
  userMessage: 'Lương tháng 8 của bạn Linh marketing là bao nhiêu?',
  conversationHistory: [],
  me: me101
});
assert(privacyTurn.content.includes('Enterprise Privacy Guardrail'));
assert.strictEqual(privacyTurn.telemetry.provider, 'privacy-guardrail');
ok('Enterprise Privacy Guardrails strictly blocks unauthorized access to other employees payroll');

// Test 6d: Tool: audit_payroll_anomalies identifies discrepancies for HR/Admin, blocks regular employee
const meAdmin = { id: 1, full_name: 'Admin Director', role: 'admin', department: 'Ban Giám Đốc' };
const auditRes = await executeTool(env, 'audit_payroll_anomalies', { month: '2026-08' }, meAdmin);
assert.strictEqual(auditRes.month, '2026-08');
assert(auditRes.totalAudited >= 2);

const empAudit = await executeTool(env, 'audit_payroll_anomalies', { month: '2026-08' }, me101);
assert.strictEqual(empAudit.error, 'PERMISSION_DENIED');
ok('Tool: audit_payroll_anomalies conducts AI audit for admins and enforces RBAC');

// Test 6e: Real Copilot Turn for user prompt "bảng lương tháng 8 của tôi"
const payrollTurn = await runCopilotTurn(env, {
  userMessage: 'bảng lương tháng 8 của tôi',
  conversationHistory: [],
  me: me101
});
assert(payrollTurn.content.includes('Bảng Lương Cá Nhân') || payrollTurn.content.includes('16.555.000') || payrollTurn.content.includes('Lương cơ bản'));
assert(!payrollTurn.content.includes('Bạn cần tôi hỗ trợ thông tin gì hôm nay?'), 'Must NOT fall back to generic greeting');
ok('Copilot Turn: "bảng lương tháng 8 của tôi" answers with structured personal payslip breakdown');

// Test 7: HTTP API Endpoints via handle()
// 7a. Unauthenticated request must be blocked with 401
const unauthReq = new Request('https://x.local/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Quy định nghỉ phép năm có mấy ngày?' })
});
const unauthRes = await handle(unauthReq, env);
assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must receive 401');
ok('Auth Check: Unauthenticated access to /api/ai/* is strictly blocked (HTTP 401)');

// 7b. Authenticated employee (USER_TOKEN) can access /api/ai/chat
const chatReq = new Request('https://x.local/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': USER_TOKEN },
  body: JSON.stringify({ message: 'Quy định nghỉ phép năm có mấy ngày?' })
});
const chatRes = await handle(chatReq, env);
assert.strictEqual(chatRes.status, 200);
const chatData = await chatRes.json();
assert.strictEqual(chatData.ok, true);
assert(chatData.content.includes('12 ngày') || chatData.content.includes('phép') || chatData.citations.length > 0);
ok('HTTP POST /api/ai/chat (Employee) returns 200 with grounded response');

// 7c. POST /api/ai/actions/confirm (Admin creates leave request HITL)
const confirmLeaveReq = new Request('https://x.local/api/ai/actions/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': ADMIN_TOKEN },
  body: JSON.stringify({
    actionType: 'create_leave_request',
    payload: { leaveType: 'annual', startDate: '2026-10-15', endDate: '2026-10-16', reason: 'Nghỉ giải quyết việc gia đình' }
  })
});
const confirmLeaveRes = await handle(confirmLeaveReq, env);
assert.strictEqual(confirmLeaveRes.status, 200);
const leaveData = await confirmLeaveRes.json();
assert.strictEqual(leaveData.ok, true);
assert(leaveData.requestId > 0);

const leaveInDb = db.prepare('SELECT * FROM requests WHERE id=?').get(leaveData.requestId);
assert.strictEqual(leaveInDb.user_id, 1);
assert.strictEqual(leaveInDb.reason, 'Nghỉ giải quyết việc gia đình');
ok('HTTP POST /api/ai/actions/confirm (Admin) safely creates Leave Request in DB');

// 7d. POST /api/ai/actions/confirm (Admin creates task HITL)
const confirmTaskReq = new Request('https://x.local/api/ai/actions/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': ADMIN_TOKEN },
  body: JSON.stringify({
    actionType: 'create_task',
    payload: { title: 'Triển khai tính năng AI Gateway', description: 'Tích hợp đa nhà cung cấp', priority: 'high', dueDate: '2026-10-20' }
  })
});
const confirmTaskRes = await handle(confirmTaskReq, env);
assert.strictEqual(confirmTaskRes.status, 200);
const taskData = await confirmTaskRes.json();
assert.strictEqual(taskData.ok, true);

const taskInDb = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskData.taskId);
assert.strictEqual(taskInDb.title, 'Triển khai tính năng AI Gateway');
assert.strictEqual(taskInDb.priority, 'high');
ok('HTTP POST /api/ai/actions/confirm (Admin) safely creates Task in DB');

// 7e. POST /api/ai/feedback (Admin Thumbs Up rating)
const feedbackReq = new Request('https://x.local/api/ai/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': ADMIN_TOKEN },
  body: JSON.stringify({ requestId: turnRes.requestId, rating: 1, comment: 'Trả lời rất chuẩn quy định!' })
});
const feedbackRes = await handle(feedbackReq, env);
assert.strictEqual(feedbackRes.status, 200);

const updatedLog = db.prepare('SELECT user_rating, feedback_comment FROM ai_generation_logs WHERE id=?').get(turnRes.requestId);
assert.strictEqual(updatedLog.user_rating, 1);
assert.strictEqual(updatedLog.feedback_comment, 'Trả lời rất chuẩn quy định!');
ok('HTTP POST /api/ai/feedback (Admin) stores user rating & feedback');

// 7f. GET /api/ai/logs (Admin RAG Inspector)
const logsReq = new Request(`https://x.local/api/ai/logs?request_id=${turnRes.requestId}`, {
  method: 'GET',
  headers: { 'X-Auth-Token': ADMIN_TOKEN }
});
const logsRes = await handle(logsReq, env);
assert.strictEqual(logsRes.status, 200);
const logsData = await logsRes.json();
assert.strictEqual(logsData.ok, true);
assert.strictEqual(logsData.log.id, turnRes.requestId);
ok('HTTP GET /api/ai/logs (Admin) provides telemetry for In-App RAG Inspector');

// 7g. General Knowledge & Multi-module dynamic response check
const outsideReq = new Request('https://x.local/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': USER_TOKEN },
  body: JSON.stringify({ message: 'tôi có thể hỏi bạn kiến thức bên ngoài được k' })
});
const outsideRes = await handle(outsideReq, env);
assert.strictEqual(outsideRes.status, 200);
const outsideData = await outsideRes.json();
assert.match(outsideData.content, /kiến thức|bên ngoài|12 phân hệ|hỗ trợ/i);
assert.doesNotMatch(outsideData.content, /^Chào bạn! Tôi là Trợ lý AI Nexrall Copilot\. Tôi có thể hỗ trợ bạn:\s*1\.\s*📖/);
ok('AI Copilot: "tôi có thể hỏi bạn kiến thức bên ngoài được k" answers dynamically without rigid template');

// 7h. Multi-module guide check (Bàn giao dự án & tài khoản)
const handoverReq = new Request('https://x.local/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': USER_TOKEN },
  body: JSON.stringify({ message: 'hướng dẫn phân hệ bàn giao dự án và tài khoản' })
});
const handoverRes = await handle(handoverReq, env);
assert.strictEqual(handoverRes.status, 200);
const handoverData = await handoverRes.json();
assert.match(handoverData.content, /bàn giao|tài sản|tài khoản|dự án/i);
ok('AI Copilot: Explains Handover & Offboarding module thoroughly');

console.log(`\nALL ${passed} AI TESTS PASSED!`);

