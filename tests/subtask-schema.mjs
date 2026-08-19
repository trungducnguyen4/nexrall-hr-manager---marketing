// ════════════════════════════════════════════════════════════
//  Subtask self-healing schema regression tests (node, sqlite).
//
//  Production symptom: opening a Task → "+ Thêm công việc con" →
//  typing title/description/assignee/due → "Thêm" → HTTP 500 with
//  "Không thể xử lý yêu cầu. Mã tham chiếu: <uuid>".
//
//  Root cause: `ALTER TABLE subtasks ADD COLUMN description` lived
//  BELOW the schema-version fast path in migrate(). A production D1
//  already carrying `schema_version == SCHEMA_VERSION` returns early
//  and never runs the ALTER, so INSERT ... description throws
//  "table subtasks has no column named description".
//
//  Fix: `ensureSubtaskSchema(env)` runs BEFORE the fast path, is
//  idempotent/additive, and the CREATE TABLE now ships with the
//  column. These tests lock that behaviour in.
//
//  A single shared "legacy full" DB is used for all cases so the
//  module-level `_migrated` guard (one migrate pass per isolate,
//  matching production) applies realistically.
//
//  Run:  node tests/subtask-schema.mjs
// ════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';

// Current schema marker set by migrate() at the end of the version-gated block.
// Simulates a production DB that already "finished" migrating to this version.
const SCHEMA_VERSION = '2026-08-11-project-timeline-v1';

const SERVER_URL = 'https://x.local';
const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const { migrate, ensureSubtaskSchema, handle } = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ok  ${name}`); }
function done() { console.log(`\n${passed} assertions passed`); }

// ── D1-compatible facade over a real in-memory SQLite engine ──
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
        async run() { const info = stmt.run(...args); return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } }; },
      };
      return s;
    },
    async batch(items) { for (const it of items) await it.run(); },
  };
}

function tableInfo(db, table) {
  return db.prepare(`SELECT * FROM pragma_table_info(?)`).all(table);
}

// Build a "legacy full" SQLite DB: modern tables the endpoint touches, but the
// `subtasks` table is the ORIGINAL one WITHOUT `description`, and settings is
// already marked at SCHEMA_VERSION — exactly the production state that breaks.
function legacyFullDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY, setting_key TEXT, setting_value TEXT);
           INSERT INTO settings (setting_key, setting_value) VALUES ('schema_version', '${SCHEMA_VERSION}');`);
  // ORIGINAL subtasks schema — deliberately missing `description`.
  db.exec(`CREATE TABLE subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    is_done INTEGER DEFAULT 0,
    assigned_to INTEGER,
    due_date TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_code TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'employee', department TEXT,
    position TEXT, avatar_color TEXT, avatar_initials TEXT, avatar_url TEXT, work_location TEXT,
    phone TEXT, salary REAL DEFAULT 0, bank_account TEXT, bank_name TEXT, is_active INTEGER DEFAULT 1,
    lifecycle_status TEXT, must_change_password INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')), temp_password TEXT, reset_token TEXT
  );
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL, revoked INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, assigned_to INTEGER,
    assigned_by INTEGER, department TEXT, date TEXT, due_date TEXT, status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'normal', label_color TEXT DEFAULT '#6366F1', checkin_time TEXT, checkout_time TEXT,
    is_locked INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')), team_project_id INTEGER, group_id INTEGER, label_id INTEGER
  );
  CREATE TABLE task_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, action TEXT NOT NULL,
    detail TEXT, project_id INTEGER, entity_type TEXT, entity_id INTEGER, entity_title TEXT, assignee_id INTEGER,
    assignee_name TEXT, actor_name TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE task_followers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL
  );
  CREATE TABLE task_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT, type TEXT, department TEXT
  );
  CREATE TABLE task_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, position INTEGER, color TEXT
  );
  CREATE TABLE task_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, color TEXT
  );
  CREATE TABLE wifi_whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, wifi_name TEXT, ip_range TEXT, description TEXT, is_active INTEGER DEFAULT 1
  );
  INSERT INTO users (employee_code, full_name, email, password_hash, role, department, position) VALUES
    ('NV-1','Manager','m@x.com','x','manager','Ban Giám Đốc','M'),
    ('NV-2','Alice','a@x.com','x','employee','Phòng Marketing','E'),
    ('NV-3','Bob','b@x.com','x','employee','Phòng Marketing','E');
  `);
  return db;
}

// Shared production-like legacy DB + env. migrate() will run once (module `_migrated`).
const db = legacyFullDB();
const env = { DB: makeD1(db) };

// ── Case A — legacy subtasks + matching schema marker, direct migrate() ──
console.log('Case A: legacy subtasks (no description) + schema_version=SCHEMA_VERSION → migrate() adds column');
{
  await migrate(env);
  const cols = tableInfo(db, 'subtasks').map(c => c.name);
  assert.ok(cols.includes('description'), `expected description column, got: ${cols.join(', ')}`);
  ok('migrate() self-healed: PRAGMA table_info(subtasks) now has description');
}

// ── Case D — ensureSubtaskSchema is idempotent / repeatable, preserves data ──
console.log('Case D: ensureSubtaskSchema() repeated runs are safe');
{
  db.prepare("INSERT INTO subtasks (task_id,title,description,assigned_to,due_date) VALUES (?,?,?,?,?)")
    .run(1, 'payload-sub', 'hello', 1, '2026-08-13');
  db.prepare("INSERT INTO subtasks (task_id,title,is_done,assigned_to) VALUES (?,?,?,?)")
    .run(2, 'legacy-nodesc', 0, 2);
  const counts = db.prepare('SELECT COUNT(*) AS c FROM subtasks').get().c;
  for (let i = 0; i < 3; i++) {
    await ensureSubtaskSchema(env); // must not throw
  }
  const after = db.prepare('SELECT COUNT(*) AS c FROM subtasks').get().c;
  assert.strictEqual(after, counts, 'no rows duplicated/lost across repeated ensureSubtaskSchema');
  const descCols = tableInfo(db, 'subtasks').filter(c => c.name === 'description').length;
  assert.strictEqual(descCols, 1, 'description appears exactly once');
  const row = db.prepare('SELECT title,description FROM subtasks WHERE id=1').get();
  assert.strictEqual(row.description, 'hello', 'existing data preserved');
  ok('ensureSubtaskSchema ran 3× safely: no duplicate column, no data loss');
}

// ── End-to-end (Cases B, C, E + permission) through handle() ──
console.log('End-to-end: POST/PUT/GET/DELETE subtask on the self-healed legacy DB');
{
  const token = 'a'.repeat(64);
  const expiry = 4102444800; // year 2100
  db.prepare("INSERT INTO sessions (user_id,token,expires_at,revoked) VALUES (?,?,?,0)").run(1, token, expiry);
  db.prepare("INSERT INTO tasks (id,title,assigned_to,assigned_by,status) VALUES (1,'Task A',1,1,'todo')").run();

  async function call(method, path, body, tok = token) {
    const req = new Request(SERVER_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': tok },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handle(req, env);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  // Case B — create with description
  let r = await call('POST', '/api/tasks/1/subtasks', {
    title: 'DAILY REPORT - THỨ 5 NGÀY 13/08/2026',
    description: '1. Các công việc đã làm...',
    assigned_to: 1,
    due_date: null,
  });
  assert.strictEqual(r.status, 200, `create should be 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.ok, true);
  assert.ok(r.body.id, 'returns { ok:true, id }');
  const subA = db.prepare('SELECT * FROM subtasks WHERE id=?').get(r.body.id);
  assert.strictEqual(subA.description, '1. Các công việc đã làm...', 'description persisted');
  assert.strictEqual(subA.task_id, 1);
  ok('Case B: POST with description → 200 {ok,id}, row persisted');

  // Case C — empty description / no assignee / no due must succeed
  r = await call('POST', '/api/tasks/1/subtasks', { title: 'Test', description: '', assigned_to: null, due_date: null });
  assert.strictEqual(r.status, 200, `empty description create should be 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.ok, true);
  ok('Case C: POST with empty description + null assignee → 200');

  // Case E — update description / assigned_to / due_date
  r = await call('PUT', `/api/subtasks/${subA.id}`, {
    title: 'DAILY REPORT - CẬP NHẬT',
    description: 'mô tả mới sau khi sửa',
    assigned_to: 2,
    due_date: '2026-08-20',
    is_done: 1,
  });
  assert.strictEqual(r.status, 200, `update should be 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  ok('Case E: PUT changes description/assignee/due → 200');

  // GET task detail reflects the change
  r = await call('GET', '/api/tasks/1');
  assert.strictEqual(r.status, 200, `GET task detail should be 200, got ${r.status}`);
  const updatedSub = r.body.subtasks.find(s => Number(s.id) === Number(subA.id));
  assert.ok(updatedSub, 'updated subtask present in GET detail');
  assert.strictEqual(updatedSub.description, 'mô tả mới sau khi sửa');
  assert.strictEqual(Number(updatedSub.assigned_to), 2);
  assert.strictEqual(updatedSub.due_date, '2026-08-20');
  assert.strictEqual(Number(updatedSub.is_done), 1);
  assert.strictEqual(updatedSub.assignee_name, 'Alice', 'assignee_name resolved via LEFT JOIN users');
  ok('Case E: GET /api/tasks/1 reflects updated description/assignee/due/is_done');

  // Permission — assigner (assigned_by, not assignee, not manager) may create (matches UI canEdit)
  const bobToken = 'b'.repeat(64);
  db.prepare("INSERT INTO sessions (user_id,token,expires_at,revoked) VALUES (?,?,?,0)").run(3, bobToken, expiry);
  db.prepare("INSERT INTO tasks (id,title,assigned_to,assigned_by,status) VALUES (2,'Task B',2,3,'todo')").run();
  r = await call('POST', '/api/tasks/2/subtasks', { title: 'Bob create', description: 'd', assigned_to: 2, due_date: null }, bobToken);
  assert.strictEqual(r.status, 200, `assigner should be allowed to create subtask, got ${r.status}: ${JSON.stringify(r.body)}`);
  ok('Permission: task assigner (assigned_by) can create subtask — consistent with UI canEdit');

  // Permission — unrelated user (not manager / assignee / assigner of target task) → 403
  const aliceToken = 'c'.repeat(64);
  db.prepare("INSERT INTO sessions (user_id,token,expires_at,revoked) VALUES (?,?,?,0)").run(2, aliceToken, expiry);
  r = await call('POST', '/api/tasks/1/subtasks', { title: 'outsider', description: '', assigned_to: null, due_date: null }, aliceToken);
  assert.strictEqual(r.status, 403, `unrelated user should be denied, got ${r.status}: ${JSON.stringify(r.body)}`);
  ok('Permission: unrelated user (not manager/assignee/assigner) → 403');

  // Delete as manager still works
  r = await call('DELETE', `/api/subtasks/${subA.id}`);
  assert.strictEqual(r.status, 200, `manager delete should be 200, got ${r.status}`);
  assert.ok(!db.prepare('SELECT id FROM subtasks WHERE id=?').get(subA.id), 'subtask deleted');
  ok('DELETE subtask (manager) → 200 and row removed');

  // Task PUT — task assigner (assigned_by, not assignee, not manager) may edit own task
  // (task 2 has no team_project_id, so the project gate is not in play).
  r = await call('PUT', '/api/tasks/2', { title: 'Task B edited by assigner', status: 'doing' }, bobToken);
  assert.strictEqual(r.status, 200, `assigner Task PUT should be 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  const edited = db.prepare('SELECT title,status FROM tasks WHERE id=2').get();
  assert.strictEqual(edited.title, 'Task B edited by assigner');
  assert.strictEqual(edited.status, 'doing');
  ok('Permission: Task PUT by assigner (assigned_by) → 200, changes persisted (matches UI canEdit)');

  // Task PUT — unrelated user (not manager/assignee/assigner) → 403
  r = await call('PUT', '/api/tasks/1', { title: 'hack' }, aliceToken);
  assert.strictEqual(r.status, 403, `unrelated Task PUT should be 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  ok('Permission: unrelated user Task PUT → 403');
}

done();