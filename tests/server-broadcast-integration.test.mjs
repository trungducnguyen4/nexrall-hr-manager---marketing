// tests/server-broadcast-integration.test.mjs
// Empirical verification harness testing broadcastAppEvent() integration in server.js
// across core domain endpoints, envelope contract compliance, and fault tolerance.

import { pathToFileURL } from 'url';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const { migrate, handle, broadcastAppEvent } = mod;

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  [PASS] ${name}`);
}

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
    async batch(items) {
      const results = [];
      for (const it of items) {
        results.push(await it.run());
      }
      return results;
    },
  };
}

const capturedBroadcasts = [];

function createMockSyncHub(shouldThrow = false) {
  return {
    idFromName(name) {
      return { name };
    },
    get(id) {
      return {
        async broadcast(envelope) {
          if (shouldThrow) {
            throw new Error('Simulated AppSyncHub Durable Object connection crash');
          }
          capturedBroadcasts.push(envelope);
          return { ok: true, id: envelope.id, seq: 1 };
        },
        async fetch(request) {
          if (shouldThrow) {
            throw new Error('Simulated AppSyncHub HTTP fetch connection reset');
          }
          const body = await request.json();
          capturedBroadcasts.push(body);
          return new Response(JSON.stringify({ ok: true, id: body.id, seq: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      };
    },
  };
}

function initFullSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'employee',
      department TEXT,
      position TEXT,
      avatar_color TEXT DEFAULT '#4F46E5',
      avatar_initials TEXT,
      avatar_url TEXT,
      work_location TEXT,
      phone TEXT,
      salary REAL DEFAULT 0,
      bank_account TEXT,
      bank_name TEXT,
      is_active INTEGER DEFAULT 1,
      lifecycle_status TEXT,
      must_change_password INTEGER DEFAULT 0,
      employee_type TEXT,
      contract_type TEXT,
      hire_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      temp_password TEXT,
      reset_token TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      assigned_by INTEGER,
      department TEXT,
      date TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'normal',
      label_color TEXT DEFAULT '#6366F1',
      checkin_time TEXT,
      checkout_time TEXT,
      is_locked INTEGER DEFAULT 0,
      workspace_id INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      team_project_id INTEGER,
      group_id INTEGER,
      label_id INTEGER,
      import_position INTEGER,
      position REAL
    );

    CREATE TABLE IF NOT EXISTS task_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      project_id INTEGER,
      entity_type TEXT,
      entity_id INTEGER,
      entity_title TEXT,
      assignee_id INTEGER,
      assignee_name TEXT,
      actor_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS task_followers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      code TEXT,
      type TEXT,
      department TEXT,
      status TEXT DEFAULT 'active',
      manager_id INTEGER,
      created_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS task_project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT,
      position INTEGER,
      color TEXT,
      is_archived INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      name TEXT,
      color TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      is_done INTEGER DEFAULT 0,
      assigned_to INTEGER,
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      mentions TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS task_mention_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      comment_id INTEGER NOT NULL,
      mentioned_by INTEGER NOT NULL,
      mentioned_by_name TEXT,
      task_title TEXT,
      comment_snippet TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      work_type TEXT DEFAULT 'office',
      shift TEXT DEFAULT 'full',
      registered INTEGER DEFAULT 1,
      checkin_time TEXT,
      checkout_time TEXT,
      checkin_ip TEXT,
      checkout_ip TEXT,
      status TEXT DEFAULT 'present',
      late_minutes INTEGER DEFAULT 0,
      work_hours REAL DEFAULT 0,
      checkin_location_id INTEGER,
      checkin_distance_meters REAL,
      checkin_accuracy_meters REAL,
      checkin_verification_method TEXT,
      checkin_lat REAL,
      checkin_lng REAL,
      checkin_geofence_status TEXT,
      checkin_requires_review INTEGER DEFAULT 0,
      checkin_review_status TEXT DEFAULT 'none',
      expected_start TEXT,
      expected_end TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS attendance_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT,
      address TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER NOT NULL DEFAULT 100,
      max_accuracy_meters INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wifi_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wifi_name TEXT,
      ip_range TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS leave_types (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paid_policy TEXT DEFAULT 'paid',
      deducts_annual_leave INTEGER DEFAULT 0,
      requires_evidence INTEGER DEFAULT 0,
      requires_bod_approval INTEGER DEFAULT 0,
      max_days INTEGER,
      short_description TEXT,
      policy_description TEXT,
      notice_hours INTEGER,
      required_documents TEXT,
      requires_handover INTEGER DEFAULT 0,
      approval_flow TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      employee_id INTEGER,
      type TEXT,
      start_date TEXT,
      end_date TEXT,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      current_approver TEXT,
      approval_level INTEGER DEFAULT 1,
      submitted_at TEXT DEFAULT (datetime('now','localtime')),
      leave_session TEXT DEFAULT 'full',
      total_days REAL DEFAULT 1,
      handover_user_id INTEGER,
      handover_user_name TEXT,
      approval_flow TEXT,
      balance_reserved_days REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      leave_type_code TEXT NOT NULL,
      balance_year INTEGER NOT NULL,
      available_days REAL NOT NULL DEFAULT 0,
      updated_by INTEGER,
      updated_by_name TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(user_id, leave_type_code, balance_year)
    );

    CREATE TABLE IF NOT EXISTS leave_balance_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      leave_type_code TEXT NOT NULL,
      balance_year INTEGER NOT NULL,
      leave_request_id INTEGER,
      delta_days REAL NOT NULL,
      entry_type TEXT NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS leave_approval_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leave_request_id INTEGER NOT NULL,
      approval_level INTEGER,
      actor_id INTEGER,
      actor_name TEXT,
      action TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS leave_request_documents (
      id TEXT PRIMARY KEY,
      leave_request_id INTEGER,
      owner_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      required_label TEXT,
      uploaded_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      base_salary REAL DEFAULT 0,
      bonus REAL DEFAULT 0,
      allowance REAL DEFAULT 0,
      deduction REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      insurance REAL DEFAULT 0,
      net_salary REAL DEFAULT 0,
      work_days INTEGER DEFAULT 0,
      absent_days INTEGER DEFAULT 0,
      late_days INTEGER DEFAULT 0,
      standard_days INTEGER DEFAULT 0,
      paid_leave_days REAL DEFAULT 0,
      late_minutes INTEGER DEFAULT 0,
      early_leave_minutes INTEGER DEFAULT 0,
      missing_checkinout_days INTEGER DEFAULT 0,
      approved_overtime_minutes INTEGER DEFAULT 0,
      overtime_pay REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      note TEXT,
      employee_confirmed_at TEXT,
      review_status TEXT DEFAULT 'none',
      review_resolved_at TEXT,
      locked_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS invoice_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT,
      changed_by INTEGER,
      changed_by_name TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS invoice_review_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      requested_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      handled_by INTEGER,
      handled_by_name TEXT,
      handled_note TEXT,
      handled_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'direct',
      name TEXT,
      team_id INTEGER,
      project_id INTEGER,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      last_read_message_id INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT,
      reply_to_id INTEGER,
      task_id INTEGER,
      message_type TEXT DEFAULT 'text',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      edited_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      type TEXT DEFAULT 'file',
      file_name TEXT,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT,
      storage_key TEXT,
      width INTEGER,
      height INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(message_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS message_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      mentioned_user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS message_all_mentions (
      message_id INTEGER PRIMARY KEY,
      mentioned_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS pinned_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      pinned_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(conversation_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS chat_polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL UNIQUE,
      question TEXT NOT NULL,
      allows_multiple INTEGER DEFAULT 0,
      is_closed INTEGER DEFAULT 0,
      closed_by INTEGER,
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS chat_poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      position INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(option_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      description TEXT,
      location TEXT,
      meeting_url TEXT,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS chat_event_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      response TEXT DEFAULT 'invited',
      responded_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dissolved_conversations (
      conversation_id INTEGER PRIMARY KEY,
      dissolved_by INTEGER NOT NULL,
      dissolved_by_name TEXT,
      dissolved_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS task_completion_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      department TEXT DEFAULT '',
      project_id INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

// Helper to initialize in-memory DB and mock environment
async function setupTestEnvironment(syncHub = createMockSyncHub(false)) {
  const db = new DatabaseSync(':memory:');
  initFullSchema(db);

  const d1 = makeD1(db);
  const env = {
    DB: d1,
    SYNC_HUB: syncHub,
    USER_ID: '1',
  };

  // Run migrations safely
  await migrate(env);

  // Insert test users: Admin (id=1) and Employee (id=2)
  db.exec(`
    INSERT OR REPLACE INTO users (id, employee_code, full_name, email, password_hash, role, department, position, is_active, lifecycle_status, employee_type, contract_type)
    VALUES (1, 'ADM01', 'Admin User', 'admin@example.com', 'hash_admin', 'admin', 'Ban Giám Đốc', 'Giám Đốc', 1, 'Chính thức', 'CHINH_THUC', 'Chính thức');

    INSERT OR REPLACE INTO users (id, employee_code, full_name, email, password_hash, role, department, position, is_active, lifecycle_status, employee_type, contract_type)
    VALUES (2, 'EMP02', 'Employee Two', 'emp2@example.com', 'hash_emp2', 'employee', 'Phòng Kỹ Thuật', 'Kỹ sư', 1, 'Chính thức', 'CHINH_THUC', 'Chính thức');
  `);

  // Disable attendance GPS constraint for easy test checkins
  db.exec(`
    INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('attendance_gps_constraint', '0');
  `);

  // Insert project & group for task tests
  db.exec(`
    INSERT OR REPLACE INTO task_projects (id, name, code, type, department, status, created_by)
    VALUES (1, 'Realtime Project', 'RTP', 'project', 'Ban Giám Đốc', 'active', 1);

    INSERT OR REPLACE INTO task_project_members (project_id, user_id) VALUES (1, 1), (1, 2);

    INSERT OR REPLACE INTO task_groups (id, project_id, name, position)
    VALUES (1, 1, 'Sprint Backlog', 0), (2, 1, 'In Progress', 1);
  `);

  // Insert leave types for leave tests
  db.exec(`
    INSERT OR REPLACE INTO leave_types (code, name, paid_policy, is_active, requires_evidence, requires_handover)
    VALUES ('UNPAID', 'Nghỉ không lương', 'unpaid', 1, 0, 0),
           ('ANNUAL', 'Nghỉ phép năm', 'paid', 1, 0, 0);

    INSERT OR REPLACE INTO leave_balances (user_id, leave_type_code, balance_year, available_days)
    VALUES (1, 'ANNUAL', 2026, 12);
  `);

  const adminToken = '1111111111111111111111111111111111111111111111111111111111111111';
  db.exec(`
    INSERT OR REPLACE INTO sessions (user_id, token, expires_at, revoked)
    VALUES (1, '${adminToken}', 4102444800, 0);
  `);

  const employeeToken = '2222222222222222222222222222222222222222222222222222222222222222';
  db.exec(`
    INSERT OR REPLACE INTO sessions (user_id, token, expires_at, revoked)
    VALUES (2, '${employeeToken}', 4102444800, 0);
  `);

  async function apiCall(method, path, body = null, token = adminToken) {
    const req = new Request(`https://hr.internal${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = await handle(req, env);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, headers: res.headers };
  }

  return { db, d1, env, apiCall, adminToken, employeeToken };
}

console.log('\n=== REAL-TIME BROADCAST INTEGRATION & FAULT TOLERANCE TEST HARNESS ===\n');

// ──────────────────────────────────────────────────────────────────────────
// TEST 1: POST /api/tasks -> tasks (task:created)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall } = await setupTestEnvironment();

  const res = await apiCall('POST', '/api/tasks', {
    title: 'Test Create Task Broadcast',
    description: 'Verifying real-time broadcast hook',
    status: 'todo',
    priority: 'high',
    team_project_id: 1,
    group_id: 1,
    assigned_to: 2,
    due_date: '2026-09-15',
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);
  const createdTaskId = res.json.id;
  assert.ok(createdTaskId > 0, 'Should return created task id');

  const broadcast = capturedBroadcasts.find(b => b.topic === 'tasks' && b.event === 'task:created');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for task:created');
  assert.strictEqual(broadcast.topic, 'tasks');
  assert.strictEqual(broadcast.event, 'task:created');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.id, createdTaskId);
  assert.strictEqual(broadcast.payload.title, 'Test Create Task Broadcast');
  assert.strictEqual(broadcast.payload.status, 'todo');
  assert.strictEqual(broadcast.payload.priority, 'high');
  assert.strictEqual(broadcast.payload.assigned_to, 2);
  assert.strictEqual(broadcast.payload.team_project_id, 1);
  assert.strictEqual(broadcast.payload.group_id, 1);
  assert.ok(broadcast.id, 'Event envelope must have monotonic/unique event ID');
  assert.ok(broadcast.timestamp, 'Event envelope must have ISO timestamp');

  ok('POST /api/tasks broadcasts topic "tasks", event "task:created" with complete payload and actorId');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 2: PUT /api/tasks/:id -> tasks (task:updated)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall, db } = await setupTestEnvironment();

  db.exec(`
    INSERT INTO tasks (id, title, description, assigned_to, assigned_by, team_project_id, group_id, status, priority, position)
    VALUES (101, 'Original Task 101', 'Initial desc', 2, 1, 1, 1, 'todo', 'normal', 0);
  `);

  const res = await apiCall('PUT', '/api/tasks/101', {
    title: 'Updated Task 101 Title',
    status: 'done',
    priority: 'urgent',
    team_project_id: 1,
    group_id: 2,
    position: 50,
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);

  const broadcast = capturedBroadcasts.find(b => b.topic === 'tasks' && b.event === 'task:updated');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for task:updated');
  assert.strictEqual(broadcast.topic, 'tasks');
  assert.strictEqual(broadcast.event, 'task:updated');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.id, 101);
  assert.strictEqual(broadcast.payload.title, 'Updated Task 101 Title');
  assert.strictEqual(broadcast.payload.status, 'done');
  assert.strictEqual(broadcast.payload.priority, 'urgent');
  assert.strictEqual(broadcast.payload.group_id, 2);
  assert.strictEqual(broadcast.payload.position, 50);

  ok('PUT /api/tasks/:id broadcasts topic "tasks", event "task:updated" with modified attributes');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 3: POST /api/tasks/reorder -> tasks (task:reordered)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall, db } = await setupTestEnvironment();

  db.exec(`
    INSERT INTO tasks (id, title, team_project_id, group_id, position, assigned_by)
    VALUES (201, 'Task R1', 1, 1, 0, 1),
           (202, 'Task R2', 1, 1, 10, 1),
           (203, 'Task R3', 1, 1, 20, 1);
  `);

  const movesPayload = [
    { id: 203, group_id: 1, position: 0 },
    { id: 201, group_id: 1, position: 10 },
    { id: 202, group_id: 1, position: 20 },
  ];

  const res = await apiCall('POST', '/api/tasks/reorder', {
    project_id: 1,
    moves: movesPayload,
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);
  assert.strictEqual(res.json.updated, 3);

  const broadcast = capturedBroadcasts.find(b => b.topic === 'tasks' && b.event === 'task:reordered');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for task:reordered');
  assert.strictEqual(broadcast.topic, 'tasks');
  assert.strictEqual(broadcast.event, 'task:reordered');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.project_id, 1);
  assert.deepStrictEqual(broadcast.payload.moves, movesPayload);

  ok('POST /api/tasks/reorder broadcasts topic "tasks", event "task:reordered" with moves array and project_id');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 4: POST /api/attendance/checkin -> attendance (attendance:checkin)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall } = await setupTestEnvironment();

  const res = await apiCall('POST', '/api/attendance/checkin', {
    latitude: 10.762622,
    longitude: 106.660172,
    accuracy: 15,
    note: 'Empirical verification checkin',
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);
  assert.ok(['present', 'late'].includes(res.json.status));

  const broadcast = capturedBroadcasts.find(b => b.topic === 'attendance' && b.event === 'attendance:checkin');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for attendance:checkin');
  assert.strictEqual(broadcast.topic, 'attendance');
  assert.strictEqual(broadcast.event, 'attendance:checkin');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.user_id, 1);
  assert.strictEqual(broadcast.payload.user_name, 'Admin User');
  assert.strictEqual(broadcast.payload.employee_code, 'ADM01');
  assert.ok(broadcast.payload.checkin_time, 'Payload must include checkin_time');

  ok('POST /api/attendance/checkin broadcasts topic "attendance", event "attendance:checkin" with user metadata');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 5: POST /api/leave -> leave (leave:created)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall } = await setupTestEnvironment();

  const res = await apiCall('POST', '/api/leave', {
    start_date: '2026-09-01',
    end_date: '2026-09-01',
    leave_session: 'full',
    type: 'UNPAID',
    reason: 'Empirical verification leave request',
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);
  const createdLeaveId = res.json.id;
  assert.ok(createdLeaveId > 0);

  const broadcast = capturedBroadcasts.find(b => b.topic === 'leave' && b.event === 'leave:created');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for leave:created');
  assert.strictEqual(broadcast.topic, 'leave');
  assert.strictEqual(broadcast.event, 'leave:created');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.id, createdLeaveId);
  assert.strictEqual(broadcast.payload.user_id, 1);
  assert.strictEqual(broadcast.payload.type, 'UNPAID');
  assert.strictEqual(broadcast.payload.start_date, '2026-09-01');
  assert.strictEqual(broadcast.payload.end_date, '2026-09-01');
  assert.strictEqual(broadcast.payload.total_days, 1);
  assert.strictEqual(broadcast.payload.status, 'pending');

  ok('POST /api/leave broadcasts topic "leave", event "leave:created" with date interval, total days, and status');

  // Verify leave approval (PUT /api/leave/:id)
  capturedBroadcasts.length = 0;
  const approveRes = await apiCall('PUT', `/api/leave/${createdLeaveId}`, {
    status: 'approved',
  });
  assert.strictEqual(approveRes.status, 200, `Expected 200 but got ${approveRes.status}: ${JSON.stringify(approveRes.json)}`);
  assert.strictEqual(approveRes.json.ok, true);

  const approveBroadcast = capturedBroadcasts.find(b => b.topic === 'leave' && b.event === 'leave:approved');
  assert.ok(approveBroadcast, 'broadcastAppEvent must be invoked for leave:approved');
  assert.strictEqual(approveBroadcast.payload.id, createdLeaveId);
  assert.strictEqual(approveBroadcast.payload.status, 'approved');
  ok('PUT /api/leave/:id approves leave and broadcasts event "leave:approved"');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 5B: POST /api/tasks/completion-subscriptions/save -> saves subscriptions
// ──────────────────────────────────────────────────────────────────────────
{
  const { apiCall, db } = await setupTestEnvironment();
  const res = await apiCall('POST', '/api/tasks/completion-subscriptions/save', {
    departments: ['Phòng Marketing', 'Phòng Kỹ Thuật'],
    project_ids: [1, 2],
  });
  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);
  assert.strictEqual(res.json.count, 4);

  const getRes = await apiCall('GET', '/api/tasks/completion-subscriptions');
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.json.subscriptions.length, 4);
  ok('POST /api/tasks/completion-subscriptions/save successfully saves subscriptions without D1 SQL error');

  // Test Task completion notification dispatch
  capturedBroadcasts.length = 0;
  const taskRes = await apiCall('POST', '/api/tasks', {
    title: 'Test completion task',
    department: 'Phòng Marketing',
    status: 'todo',
  });
  assert.strictEqual(taskRes.status, 200);
  const taskId = taskRes.json.id;

  // Mark task as done
  capturedBroadcasts.length = 0;
  const updateTaskRes = await apiCall('PUT', `/api/tasks/${taskId}`, {
    status: 'done',
  });
  assert.strictEqual(updateTaskRes.status, 200);

  const completedNotifBroadcast = capturedBroadcasts.find(b => b.topic === 'tasks' && b.event === 'task:completed_notif');
  assert.ok(completedNotifBroadcast, 'Broadcast task:completed_notif should be sent');
  assert.deepStrictEqual(completedNotifBroadcast.targetUserIds, [1], 'targetUserIds should include subscribed user 1');

  // Verify task_mention_notifications record was created without NOT NULL constraint error
  const notifRow = db.prepare('SELECT * FROM task_mention_notifications WHERE task_id = ?').get(taskId);
  assert.ok(notifRow, 'task_mention_notifications record should exist');
  assert.strictEqual(notifRow.comment_id, 0, 'comment_id must be 0 to satisfy NOT NULL constraint');
  ok('PUT /api/tasks/:id dispatches task completion notifications and Web Push without SQL errors');

  // Test Subtask completion notification dispatch
  const subtaskRes = await apiCall('POST', `/api/tasks/${taskId}/subtasks`, {
    title: 'Test subtask item',
  });
  assert.strictEqual(subtaskRes.status, 200);
  const subtaskId = subtaskRes.json.id;

  capturedBroadcasts.length = 0;
  const updateSubtaskRes = await apiCall('PUT', `/api/subtasks/${subtaskId}`, {
    is_done: 1,
  });
  assert.strictEqual(updateSubtaskRes.status, 200);

  const subtaskCompletedBroadcast = capturedBroadcasts.find(b => b.topic === 'tasks' && b.event === 'task:subtask_completed_notif');
  assert.ok(subtaskCompletedBroadcast, 'Broadcast task:subtask_completed_notif should be sent');
  assert.deepStrictEqual(subtaskCompletedBroadcast.targetUserIds, [1], 'targetUserIds should include subscribed user 1');
  ok('PUT /api/subtasks/:id dispatches subtask completion notifications and Web Push without SQL errors');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 6: POST /api/invoices/:id/confirm -> invoices (invoice:confirmed)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall, db } = await setupTestEnvironment();

  db.exec(`
    INSERT INTO invoices (id, invoice_number, user_id, month, year, base_salary, net_salary, status)
    VALUES (501, 'INV-2026-08-501', 1, 8, 2026, 15000000, 15000000, 'issued');
  `);

  const res = await apiCall('POST', '/api/invoices/501/confirm');

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);

  const broadcast = capturedBroadcasts.find(b => b.topic === 'invoices' && b.event === 'invoice:confirmed');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for invoice:confirmed');
  assert.strictEqual(broadcast.topic, 'invoices');
  assert.strictEqual(broadcast.event, 'invoice:confirmed');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.id, 501);
  assert.strictEqual(broadcast.payload.user_id, 1);
  assert.strictEqual(broadcast.payload.status, 'employee_confirmed');

  ok('POST /api/invoices/:id/confirm broadcasts topic "invoices", event "invoice:confirmed" with invoice ID and employee status');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 7: PUT /api/messages/:id -> chat (chat:message_edited)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall, db } = await setupTestEnvironment();

  db.exec(`
    INSERT INTO conversations (id, type, name, created_by)
    VALUES (601, 'direct', 'DM Admin-Emp2', 1);

    INSERT INTO conversation_members (conversation_id, user_id, role)
    VALUES (601, 1, 'owner'), (601, 2, 'member');

    INSERT INTO messages (id, conversation_id, sender_id, content, message_type)
    VALUES (701, 601, 1, 'Original direct message text', 'text');
  `);

  const res = await apiCall('PUT', '/api/messages/701', {
    content: 'Edited direct message content text',
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.ok, true);
  assert.strictEqual(res.json.message.content, 'Edited direct message content text');

  const broadcast = capturedBroadcasts.find(b => b.topic === 'chat' && b.event === 'chat:message_edited');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for chat:message_edited');
  assert.strictEqual(broadcast.topic, 'chat');
  assert.strictEqual(broadcast.event, 'chat:message_edited');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.conversation_id, 601);
  assert.strictEqual(broadcast.payload.message_id, 701);
  assert.strictEqual(broadcast.payload.message.content, 'Edited direct message content text');

  ok('PUT /api/messages/:id broadcasts topic "chat", event "chat:message_edited" with message payload and conversation ID');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 8: POST /api/conversations -> chat (chat:conversation_created)
// ──────────────────────────────────────────────────────────────────────────
{
  capturedBroadcasts.length = 0;
  const { apiCall } = await setupTestEnvironment();

  const res = await apiCall('POST', '/api/conversations', {
    type: 'group',
    name: 'Realtime Core Engineers',
    member_ids: [2],
  });

  assert.strictEqual(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.json)}`);
  const createdConvId = res.json.conversation_id;
  assert.ok(createdConvId > 0);

  const broadcast = capturedBroadcasts.find(b => b.topic === 'chat' && b.event === 'chat:conversation_created');
  assert.ok(broadcast, 'broadcastAppEvent must be invoked for chat:conversation_created');
  assert.strictEqual(broadcast.topic, 'chat');
  assert.strictEqual(broadcast.event, 'chat:conversation_created');
  assert.strictEqual(Number(broadcast.actorId || broadcast.actor_id), 1);
  assert.strictEqual(broadcast.payload.conversation_id, createdConvId);
  assert.strictEqual(broadcast.payload.conversation.name, 'Realtime Core Engineers');
  assert.strictEqual(broadcast.payload.conversation.type, 'group');

  const targets = (broadcast.targetUserIds || broadcast.target_user_ids || []).map(Number);
  assert.ok(targets.includes(1) && targets.includes(2), 'Should target all conversation members');

  ok('POST /api/conversations broadcasts topic "chat", event "chat:conversation_created" with targetUserIds whitelist');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 9: FAULT TOLERANCE - SYNC_HUB Connection Throw/Crash
// ──────────────────────────────────────────────────────────────────────────
{
  console.log('\n--- Stress Testing Fault Tolerance: Failing SYNC_HUB Binding ---');
  capturedBroadcasts.length = 0;

  // Setup environment with a crashing SYNC_HUB mock
  const failingSyncHub = createMockSyncHub(true);
  const { apiCall, db } = await setupTestEnvironment(failingSyncHub);

  // 1. Task Creation with crashing DO
  const resTask = await apiCall('POST', '/api/tasks', {
    title: 'Fault Tolerant Task Under DO Outage',
    status: 'todo',
    priority: 'normal',
    team_project_id: 1,
    group_id: 1,
  });
  assert.strictEqual(resTask.status, 200, 'Primary mutation MUST succeed (200) even when SYNC_HUB fails');
  assert.strictEqual(resTask.json.ok, true);
  const taskId = resTask.json.id;

  // Verify task was indeed committed to SQLite
  const dbTask = db.prepare('SELECT title FROM tasks WHERE id=?').get(taskId);
  assert.strictEqual(dbTask?.title, 'Fault Tolerant Task Under DO Outage');
  ok('Fault Tolerance: POST /api/tasks commits to DB and returns 200 when SYNC_HUB throws');

  // 2. Task Edit with crashing DO
  const resTaskEdit = await apiCall('PUT', `/api/tasks/${taskId}`, {
    title: 'Fault Tolerant Task Renamed Under DO Outage',
    status: 'done',
  });
  assert.strictEqual(resTaskEdit.status, 200);
  const dbTaskUpdated = db.prepare('SELECT title, status FROM tasks WHERE id=?').get(taskId);
  assert.strictEqual(dbTaskUpdated?.title, 'Fault Tolerant Task Renamed Under DO Outage');
  assert.strictEqual(dbTaskUpdated?.status, 'done');
  ok('Fault Tolerance: PUT /api/tasks/:id commits to DB and returns 200 when SYNC_HUB throws');

  // 3. Attendance Checkin with crashing DO
  const resAtt = await apiCall('POST', '/api/attendance/checkin', {
    note: 'Checking in during sync outage',
  });
  assert.strictEqual(resAtt.status, 200);
  assert.strictEqual(resAtt.json.ok, true);
  ok('Fault Tolerance: POST /api/attendance/checkin succeeds when SYNC_HUB throws');

  // 4. Leave Request with crashing DO
  const resLeave = await apiCall('POST', '/api/leave', {
    start_date: '2026-09-02',
    end_date: '2026-09-02',
    leave_session: 'full',
    type: 'UNPAID',
    reason: 'Sync hub offline leave test',
  });
  assert.strictEqual(resLeave.status, 200);
  assert.strictEqual(resLeave.json.ok, true);
  ok('Fault Tolerance: POST /api/leave succeeds when SYNC_HUB throws');

  // 5. Payslip Confirmation with crashing DO
  db.exec(`
    INSERT INTO invoices (id, invoice_number, user_id, month, year, base_salary, status)
    VALUES (801, 'INV-2026-08-801', 1, 8, 2026, 20000000, 'issued');
  `);
  const resInv = await apiCall('POST', '/api/invoices/801/confirm');
  assert.strictEqual(resInv.status, 200);
  assert.strictEqual(resInv.json.ok, true);
  const dbInv = db.prepare('SELECT status FROM invoices WHERE id=801').get();
  assert.strictEqual(dbInv?.status, 'employee_confirmed');
  ok('Fault Tolerance: POST /api/invoices/:id/confirm commits to DB and returns 200 when SYNC_HUB throws');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 10: FAULT TOLERANCE - Missing SYNC_HUB Binding (null/undefined)
// ──────────────────────────────────────────────────────────────────────────
{
  console.log('\n--- Testing Fault Tolerance: Missing SYNC_HUB Binding ---');
  const { apiCall, db } = await setupTestEnvironment(null);

  const res = await apiCall('POST', '/api/tasks', {
    title: 'Task Created Without Any SYNC_HUB Configured',
    team_project_id: 1,
    group_id: 1,
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.ok, true);
  const dbTask = db.prepare('SELECT title FROM tasks WHERE id=?').get(res.json.id);
  assert.strictEqual(dbTask?.title, 'Task Created Without Any SYNC_HUB Configured');

  ok('Fault Tolerance: broadcastAppEvent gracefully returns without throwing when SYNC_HUB is null');
}

console.log(`\n======================================================`);
console.log(`ALL ${passed} INTEGRATION & FAULT TOLERANCE TESTS PASSED`);
console.log(`======================================================\n`);
