// Task drag-and-drop / reorder endpoint and position sorting tests
import { pathToFileURL } from 'url';
import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const { migrate, handle } = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ok  ${name}`); }
function done() { console.log(`\n${passed} assertions passed`); }

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
    async batch(items) {
      const results = [];
      for (const it of items) {
        results.push(await it.run());
      }
      return results;
    },
  };
}

const db = new DatabaseSync(':memory:');
const d1 = makeD1(db);
const env = { DB: d1 };

// Base tables
db.exec(`
  CREATE TABLE settings (id INTEGER PRIMARY KEY, setting_key TEXT, setting_value TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_code TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'admin', department TEXT,
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
    updated_at TEXT DEFAULT (datetime('now','localtime')), team_project_id INTEGER, group_id INTEGER, label_id INTEGER,
    import_position INTEGER, position REAL
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
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT, type TEXT, department TEXT,
    status TEXT DEFAULT 'active', manager_id INTEGER, created_by INTEGER
  );
  CREATE TABLE task_project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL
  );
  CREATE TABLE task_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, name TEXT, position INTEGER, color TEXT, is_archived INTEGER DEFAULT 0
  );
  CREATE TABLE task_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT, color TEXT, is_active INTEGER DEFAULT 1
  );
  CREATE TABLE subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
    is_done INTEGER DEFAULT 0, assigned_to INTEGER, due_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Run migration
await migrate(env);

// Insert admin user
db.exec(`INSERT INTO users (id, employee_code, full_name, email, password_hash, role, department, is_active) VALUES (1, 'ADM01', 'Admin', 'admin@example.com', 'hash', 'admin', 'Ban Giám Đốc', 1);`);

// Insert project & groups
db.exec(`INSERT INTO task_projects (id, name, type, status, created_by) VALUES (1, 'Test Project', 'project', 'active', 1);`);
db.exec(`INSERT INTO task_groups (id, project_id, name, position) VALUES (1, 1, 'Group 1', 0), (2, 1, 'Group 2', 1);`);

// Insert initial tasks
db.exec(`INSERT INTO tasks (id, title, team_project_id, group_id, position, assigned_by, created_at) VALUES
  (101, 'Task A', 1, 1, 0, 1, '2026-08-01 10:00:00'),
  (102, 'Task B', 1, 1, 10, 1, '2026-08-01 10:01:00'),
  (103, 'Task C', 1, 1, 20, 1, '2026-08-01 10:02:00');
`);

const token = 'a'.repeat(64);
db.exec(`INSERT INTO sessions (user_id, token, expires_at, revoked) VALUES (1, '${token}', 4102444800, 0);`);

async function call(method, path, body = null) {
  const req = new Request(`https://x.local${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handle(req, env);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// 1. Check initial order
let res = await call('GET', '/api/tasks?project_id=1');
assert.strictEqual(res.status, 200);
let taskTitles = res.json.tasks.map(t => t.title);
assert.deepStrictEqual(taskTitles, ['Task A', 'Task B', 'Task C']);
ok('Initial task list respects position ASC order');

// 2. Reorder tasks: move Task C to top (C, A, B)
res = await call('POST', '/api/tasks/reorder', {
  project_id: 1,
  moves: [
    { id: 103, group_id: 1, position: 0 },
    { id: 101, group_id: 1, position: 10 },
    { id: 102, group_id: 1, position: 20 },
  ],
});
assert.strictEqual(res.status, 200);
assert.strictEqual(res.json.ok, true);
assert.strictEqual(res.json.updated, 3);
ok('POST /api/tasks/reorder batch updates positions');

// 3. Verify updated order
res = await call('GET', '/api/tasks?project_id=1');
assert.strictEqual(res.status, 200);
taskTitles = res.json.tasks.map(t => t.title);
assert.deepStrictEqual(taskTitles, ['Task C', 'Task A', 'Task B']);
ok('GET /api/tasks returns newly reordered tasks [Task C, Task A, Task B]');

// 4. Test moving task to another group via task_ids payload
res = await call('POST', '/api/tasks/reorder', {
  project_id: 1,
  group_id: 2,
  task_ids: [102, 103],
});
assert.strictEqual(res.status, 200);
assert.strictEqual(res.json.ok, true);

// Verify task 102 and 103 moved to group 2
const row102 = db.prepare(`SELECT group_id, position FROM tasks WHERE id = 102`).get();
assert.strictEqual(row102.group_id, 2);
assert.strictEqual(row102.position, 0);

const row103 = db.prepare(`SELECT group_id, position FROM tasks WHERE id = 103`).get();
assert.strictEqual(row103.group_id, 2);
assert.strictEqual(row103.position, 10);
ok('POST /api/tasks/reorder with task_ids successfully updates group_id and positions');

done();
