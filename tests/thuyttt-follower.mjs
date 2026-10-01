import { pathToFileURL } from 'url';
import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const {
  migrate,
  resolveThuytttUser,
  resolveHaunvUser,
  ensureEmployeePersonalProject,
  syncThuytttFollowerToAllProjectsAndTasks,
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

console.log('--- Test Suite: THUYTTT Follower & Project Member Sync ---');

// Setup in-memory sqlite db
const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT,
    full_name TEXT,
    email TEXT,
    role TEXT DEFAULT 'employee',
    department TEXT,
    position TEXT,
    is_active INTEGER DEFAULT 1,
    lifecycle_status TEXT DEFAULT 'Chính thức'
  );

  CREATE TABLE task_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER DEFAULT 1,
    name TEXT,
    code TEXT,
    type TEXT DEFAULT 'project',
    description TEXT,
    department TEXT,
    manager_id INTEGER,
    status TEXT DEFAULT 'active',
    start_date TEXT,
    end_date TEXT,
    created_by INTEGER,
    updated_at TEXT
  );

  CREATE TABLE task_project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    user_id INTEGER,
    role TEXT DEFAULT 'member',
    added_by INTEGER,
    UNIQUE(project_id, user_id)
  );

  CREATE TABLE task_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    name TEXT,
    position INTEGER DEFAULT 0,
    color TEXT,
    created_by INTEGER,
    is_archived INTEGER DEFAULT 0
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER DEFAULT 1,
    team_project_id INTEGER,
    group_id INTEGER,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    assigned_to INTEGER,
    assigned_by INTEGER,
    department TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE task_followers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    user_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, user_id)
  );

  CREATE TABLE task_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    project_id INTEGER,
    user_id INTEGER,
    user_name TEXT,
    user_avatar TEXT,
    user_color TEXT,
    action TEXT,
    entity_type TEXT,
    entity_id INTEGER,
    entity_title TEXT,
    assignee_id INTEGER,
    assignee_name TEXT,
    detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT
  );

  CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  );
`);

const env = { DB: makeD1(db) };

// Insert users: HAUNV, THUYTTT, NV1, NV2
db.exec(`
  INSERT INTO users (id, employee_code, full_name, email, role, department) VALUES
  (528, 'HAUNV', 'Nguyễn Văn Hậu', 'haunguyen.me@gmail.com', 'admin', 'Ban Giám Đốc'),
  (531, 'THUYTTT', 'Trần Thị Thanh Thúy', 'thuyttt@netviet.com.vn', 'admin', 'Phòng HCNS'),
  (101, 'NV001', 'Nguyễn Văn A', 'nva@netviet.com.vn', 'employee', 'Kỹ thuật'),
  (102, 'NV002', 'Trần Thị B', 'ttb@netviet.com.vn', 'employee', 'Marketing');
`);

// Test 1: resolveThuytttUser & resolveHaunvUser
const thuy = await resolveThuytttUser(env);
assert.strictEqual(thuy.id, 531);
assert.strictEqual(thuy.employee_code, 'THUYTTT');
ok('resolveThuytttUser correctly finds THUYTTT');

const hau = await resolveHaunvUser(env);
assert.strictEqual(hau.id, 528);
assert.strictEqual(hau.employee_code, 'HAUNV');
ok('resolveHaunvUser correctly finds HAUNV');

// Test 2: ensureEmployeePersonalProject creates workspace and adds THUYTTT & HAUNV
const p1Id = await ensureEmployeePersonalProject(env, { id: 101, full_name: 'Nguyễn Văn A', employee_code: 'NV001' }, 531);
assert(p1Id > 0);

const membersP1 = db.prepare('SELECT user_id, role FROM task_project_members WHERE project_id=?').all(p1Id);
const memberMap1 = new Map(membersP1.map(m => [m.user_id, m.role]));
assert.strictEqual(memberMap1.get(101), 'owner');
assert.strictEqual(memberMap1.get(528), 'member');
assert.strictEqual(memberMap1.get(531), 'member');
ok('ensureEmployeePersonalProject attaches owner (101), HAUNV (528), and THUYTTT (531)');

// Test 3: Create some pre-existing projects and tasks without THUYTTT
const p2Stmt = db.prepare(`INSERT INTO task_projects (workspace_id, name, manager_id) VALUES (1, 'Old Project', 102)`);
const p2Info = p2Stmt.run();
const p2Id = Number(p2Info.lastInsertRowid);
db.prepare(`INSERT INTO task_project_members (project_id, user_id, role, added_by) VALUES (?, 102, 'owner', 102)`).run(p2Id);

const t1Stmt = db.prepare(`INSERT INTO tasks (workspace_id, team_project_id, title, assigned_to, assigned_by) VALUES (1, ?, 'Old Task 1', 102, 102)`);
const t1Info = t1Stmt.run(p2Id);
const t1Id = Number(t1Info.lastInsertRowid);

// Pre-state: p2 does not have 531, t1 does not have 531 in task_followers
const p2MembersBefore = db.prepare('SELECT user_id FROM task_project_members WHERE project_id=?').all(p2Id);
assert(!p2MembersBefore.some(m => m.user_id === 531));
const t1FollowersBefore = db.prepare('SELECT user_id FROM task_followers WHERE task_id=?').all(t1Id);
assert(!t1FollowersBefore.some(f => f.user_id === 531));

// Test 4: Run syncThuytttFollowerToAllProjectsAndTasks
const syncRes = await syncThuytttFollowerToAllProjectsAndTasks(env);
assert.strictEqual(syncRes.ok, true);

const p2MembersAfter = db.prepare('SELECT user_id FROM task_project_members WHERE project_id=?').all(p2Id);
assert(p2MembersAfter.some(m => m.user_id === 531), 'THUYTTT must now be member of old project');
assert(p2MembersAfter.some(m => m.user_id === 528), 'HAUNV must now be member of old project');

const t1FollowersAfter = db.prepare('SELECT user_id FROM task_followers WHERE task_id=?').all(t1Id);
assert(t1FollowersAfter.some(f => f.user_id === 531), 'THUYTTT must now be follower of old task');
assert(t1FollowersAfter.some(f => f.user_id === 528), 'HAUNV must now be follower of old task');
ok('syncThuytttFollowerToAllProjectsAndTasks successfully backfilled THUYTTT & HAUNV to all existing projects and tasks');

// Test 5: Idempotency (run again without duplicating or erroring)
const syncRes2 = await syncThuytttFollowerToAllProjectsAndTasks(env);
assert.strictEqual(syncRes2.ok, true);
const countMembersP2 = db.prepare('SELECT COUNT(*) as c FROM task_project_members WHERE project_id=? AND user_id=531').get(p2Id);
assert.strictEqual(countMembersP2.c, 1, 'THUYTTT must not be duplicated in project members');
const countFollowersT1 = db.prepare('SELECT COUNT(*) as c FROM task_followers WHERE task_id=? AND user_id=531').get(t1Id);
assert.strictEqual(countFollowersT1.c, 1, 'THUYTTT must not be duplicated in task followers');
ok('syncThuytttFollowerToAllProjectsAndTasks is 100% idempotent');

console.log(`\nALL ${passed} TESTS PASSED!`);
