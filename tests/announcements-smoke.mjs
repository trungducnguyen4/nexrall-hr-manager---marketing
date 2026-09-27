// ════════════════════════════════════════════════════════════════════════════
//  Company Announcements Workflow Smoke Tests (Node.js, Mock D1)
// ════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import assert from 'assert';

const TOKEN = 'a'.repeat(64);
const SERVER_URL = 'https://x.local';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
const { handle } = mod;

let passed = 0;
function ok(name) { passed++; console.log(`  ✓ ${name}`); }

function makeSession({ role = 'employee', department = 'Marketing', id = 1, full_name = 'NV Marketing' } = {}) {
  return {
    uid: id, full_name, email: `user${id}@x.com`, role, department,
    position: 'Nhân viên', avatar_color: '#4F46E5', avatar_initials: 'NV',
    avatar_url: null, employee_code: `NV-00${id}`, salary: 10000000, phone: '0901234567',
    bank_account: null, bank_name: null, is_active: 1,
    lifecycle_status: null, must_change_password: 0,
  };
}

function createMockEnv(sessionUser, sharedState = {}) {
  if (!sharedState.users) {
    sharedState.users = [
      { id: 1, full_name: 'NV Marketing 1', role: 'employee', department: 'Marketing', employee_code: 'NV-001', is_active: 1 },
      { id: 2, full_name: 'NV IT 2', role: 'employee', department: 'Phòng IT', employee_code: 'NV-002', is_active: 1 },
      { id: 3, full_name: 'Chuyên viên HCNS', role: 'employee', department: 'Phòng HCNS', employee_code: 'HR-001', is_active: 1 },
      { id: 4, full_name: 'Giám Đốc Quản Trị', role: 'admin', department: 'Ban Giám Đốc', employee_code: 'AD-001', is_active: 1 },
    ];
  }

  if (!sharedState.announcements) {
    sharedState.announcements = [
      {
        id: 10,
        title: 'Chào mừng thành viên mới tháng 9',
        content: 'Chào mừng tất cả các nhân sự mới gia nhập công ty trong tháng này!',
        priority: 'normal',
        target_scope: 'all',
        target_department: null,
        attachment_url: null,
        attachment_name: null,
        created_by: 4,
        created_at: '2026-09-01 08:00:00',
        updated_at: null,
      },
      {
        id: 11,
        title: 'Bảo trì hệ thống server IT',
        content: 'Server nội bộ sẽ bảo trì vào 22h tối nay, chỉ phòng IT trực.',
        priority: 'important',
        target_scope: 'department',
        target_department: 'Phòng IT',
        attachment_url: 'https://files.com/it.pdf',
        attachment_name: 'it.pdf',
        created_by: 4,
        created_at: '2026-09-05 09:00:00',
        updated_at: null,
      }
    ];
  }

  if (!sharedState.announcementReads) {
    sharedState.announcementReads = [];
  }

  const { users, announcements, announcementReads } = sharedState;

  const db = {
    async exec() {},
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async all() {
          if (sql.includes('FROM sessions')) return { results: [sessionUser] };
          if (sql.includes('FROM announcements a') && sql.includes('ORDER BY a.created_at DESC')) {
            const [uid, dept, canManage] = stmt.args;
            const res = announcements
              .filter(a => canManage === 1 || a.target_scope === 'all' || a.target_department === dept)
              .map(a => {
                const u = users.find(x => x.id === a.created_by) || {};
                const isRead = announcementReads.some(r => r.announcement_id === a.id && r.user_id === uid);
                return {
                  ...a,
                  creator_name: u.full_name,
                  creator_avatar: u.avatar_url,
                  creator_role: u.role,
                  creator_department: u.department,
                  is_read: isRead ? 1 : 0,
                };
              });
            return { results: res };
          }
          if (sql.includes('FROM users')) return { results: users };
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO announcements')) {
            const [title, content, priority, targetScope, targetDepartment, attachmentUrl, attachmentName, createdBy] = stmt.args;
            const newId = announcements.length + 100;
            const newAnn = {
              id: newId,
              title, content, priority,
              target_scope: targetScope,
              target_department: targetDepartment,
              attachment_url: attachmentUrl,
              attachment_name: attachmentName,
              created_by: createdBy,
              created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
              updated_at: null,
            };
            announcements.unshift(newAnn);
            return { meta: { last_row_id: newId } };
          }
          if (sql.includes('INSERT OR IGNORE INTO announcement_reads')) {
            if (sql.includes('SELECT a.id')) {
              // read-all
              const [uid, dept, canManage] = stmt.args;
              const visible = announcements.filter(a => canManage === 1 || a.target_scope === 'all' || a.target_department === dept);
              for (const v of visible) {
                if (!announcementReads.some(r => r.announcement_id === v.id && r.user_id === uid)) {
                  announcementReads.push({ announcement_id: v.id, user_id: uid, read_at: new Date().toISOString() });
                }
              }
              return { meta: { changes: visible.length } };
            }
            const [annId, uid] = stmt.args;
            if (!announcementReads.some(r => r.announcement_id === annId && r.user_id === uid)) {
              announcementReads.push({ announcement_id: annId, user_id: uid, read_at: new Date().toISOString() });
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE announcements')) {
            const [title, content, priority, targetScope, targetDepartment, attachmentUrl, attachmentName, now, id] = stmt.args;
            const a = announcements.find(x => x.id === id);
            if (a) {
              Object.assign(a, { title, content, priority, target_scope: targetScope, target_department: targetDepartment, attachment_url: attachmentUrl, attachment_name: attachmentName, updated_at: now });
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM announcement_reads WHERE announcement_id = ?')) {
            const annId = stmt.args[0];
            const idxs = [];
            for (let i = announcementReads.length - 1; i >= 0; i--) {
              if (announcementReads[i].announcement_id === annId) announcementReads.splice(i, 1);
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM announcements WHERE id = ?')) {
            const annId = stmt.args[0];
            const idx = announcements.findIndex(x => x.id === annId);
            if (idx >= 0) announcements.splice(idx, 1);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes('FROM sessions')) return sessionUser;
          if (sql.includes("setting_key='schema_version'") || sql.includes("setting_key='seed_version'")) return null;
          if (sql.includes('SELECT COUNT(*) AS unread_count') && sql.includes('FROM announcements a')) {
            const [dept, canManage, uid] = stmt.args;
            const visible = announcements.filter(a => canManage === 1 || a.target_scope === 'all' || a.target_department === dept);
            const unread = visible.filter(a => !announcementReads.some(r => r.announcement_id === a.id && r.user_id === uid));
            return { unread_count: unread.length };
          }
          if (sql.includes('SELECT * FROM announcements WHERE id = ?')) {
            const id = stmt.args[0];
            return announcements.find(x => x.id === id) || null;
          }
          if (sql.includes('FROM announcements a') && sql.includes('WHERE a.id = ?')) {
            const id = stmt.args.length === 1 ? stmt.args[0] : stmt.args[1];
            const uid = stmt.args.length === 2 ? stmt.args[0] : null;
            const a = announcements.find(x => x.id === id);
            if (!a) return null;
            const u = users.find(x => x.id === a.created_by) || {};
            const isRead = uid ? announcementReads.some(r => r.announcement_id === a.id && r.user_id === uid) : 1;
            return {
              ...a,
              creator_name: u.full_name,
              creator_avatar: u.avatar_url,
              creator_role: u.role,
              creator_department: u.department,
              is_read: isRead ? 1 : 0,
            };
          }
          return null;
        }
      };
      return stmt;
    },
    async batch(items) {
      if (items) { for (const it of items) if (it?.run) await it.run(); }
    }
  };

  return { env: { DB: db }, announcements, announcementReads, users };
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

console.log('\n--- 1. Scope & Unread Count Verification ---');
{
  const shared = {};
  // Marketing employee
  const mktEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }), shared);
  const mktRes = await callApi('GET', '/api/announcements', undefined, mktEnv);
  assert.strictEqual(mktRes.status, 200);
  assert.strictEqual(mktRes.body.announcements.length, 1);
  assert.strictEqual(mktRes.body.announcements[0].id, 10);
  ok('Marketing employee only receives company-wide announcements, IT announcement is filtered');

  const unreadMkt = await callApi('GET', '/api/announcements/unread-count', undefined, mktEnv);
  assert.strictEqual(unreadMkt.status, 200);
  assert.strictEqual(unreadMkt.body.unread_count, 1);
  ok('Unread count matches 1 for unread company-wide announcement');

  // IT employee
  const itEnv = createMockEnv(makeSession({ id: 2, role: 'employee', department: 'Phòng IT' }), shared);
  const itRes = await callApi('GET', '/api/announcements', undefined, itEnv);
  assert.strictEqual(itRes.status, 200);
  assert.strictEqual(itRes.body.announcements.length, 2);
  ok('IT employee receives both company-wide and IT department announcements');

  // Admin
  const adminEnv = createMockEnv(makeSession({ id: 4, role: 'admin', department: 'Ban Giám Đốc' }), shared);
  const adminRes = await callApi('GET', '/api/announcements', undefined, adminEnv);
  assert.strictEqual(adminRes.status, 200);
  assert.strictEqual(adminRes.body.announcements.length, 2);
  assert.strictEqual(adminRes.body.can_manage, true);
  ok('Admin can view all announcements and has can_manage permission');
}

console.log('\n--- 2. Create Announcement Permissions ---');
{
  const shared = {};
  // Regular employee tries to create announcement -> 403
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }), shared);
  const createEmpRes = await callApi('POST', '/api/announcements', {
    title: 'Thông báo trái phép',
    content: 'Nội dung test',
  }, empEnv);
  assert.strictEqual(createEmpRes.status, 403);
  assert.ok(createEmpRes.body.error.includes('Quản trị viên và HCNS'));
  ok('Regular employee cannot create announcement (403)');

  // HCNS creates announcement -> 200
  const hrEnv = createMockEnv(makeSession({ id: 3, role: 'employee', department: 'Phòng HCNS' }), shared);
  const createHrRes = await callApi('POST', '/api/announcements', {
    title: 'Quy chế thưởng quý 3',
    content: 'Chi tiết quy chế thưởng quý 3 cho toàn thể nhân sự.',
    priority: 'important',
    target_scope: 'all',
  }, hrEnv);
  assert.strictEqual(createHrRes.status, 200);
  assert.ok(createHrRes.body.announcement);
  assert.strictEqual(createHrRes.body.announcement.title, 'Quy chế thưởng quý 3');
  ok('HCNS personnel can create announcement (200)');
}

console.log('\n--- 3. Mark Announcement As Read & Read-All ---');
{
  const shared = {};
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }), shared);
  
  // Before read
  let unread = await callApi('GET', '/api/announcements/unread-count', undefined, empEnv);
  assert.strictEqual(unread.body.unread_count, 1);

  // Mark single announcement 10 as read
  const readRes = await callApi('POST', '/api/announcements/10/read', {}, empEnv);
  assert.strictEqual(readRes.status, 200);

  // After read
  unread = await callApi('GET', '/api/announcements/unread-count', undefined, empEnv);
  assert.strictEqual(unread.body.unread_count, 0);
  ok('Marking announcement 10 as read reduces unread count to 0');

  // IT employee reads all
  const itEnv = createMockEnv(makeSession({ id: 2, role: 'employee', department: 'Phòng IT' }), shared);
  let itUnread = await callApi('GET', '/api/announcements/unread-count', undefined, itEnv);
  assert.strictEqual(itUnread.body.unread_count, 2);

  const readAllRes = await callApi('POST', '/api/announcements/read-all', {}, itEnv);
  assert.strictEqual(readAllRes.status, 200);

  itUnread = await callApi('GET', '/api/announcements/unread-count', undefined, itEnv);
  assert.strictEqual(itUnread.body.unread_count, 0);
  ok('POST /api/announcements/read-all marks all visible announcements as read');
}

console.log('\n--- 4. Edit & Delete Announcement ---');
{
  const shared = {};
  // Employee 1 cannot edit announcement 10 (created by Admin 4) -> 403
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }), shared);
  const editForbidden = await callApi('PUT', '/api/announcements/10', {
    title: 'Sửa trộm',
    content: 'Nội dung sửa',
  }, empEnv);
  assert.strictEqual(editForbidden.status, 403);
  ok('Employee cannot edit announcement created by someone else (403)');

  // Admin edits announcement 10 -> 200
  const adminEnv = createMockEnv(makeSession({ id: 4, role: 'admin', department: 'Ban Giám Đốc' }), shared);
  const editSuccess = await callApi('PUT', '/api/announcements/10', {
    title: 'Tiêu đề đã được cập nhật',
    content: 'Nội dung cập nhật mới',
    priority: 'important',
  }, adminEnv);
  assert.strictEqual(editSuccess.status, 200);
  assert.strictEqual(editSuccess.body.announcement.title, 'Tiêu đề đã được cập nhật');
  ok('Admin successfully edits announcement');

  // Admin deletes announcement 10 -> 200
  const delSuccess = await callApi('DELETE', '/api/announcements/10', undefined, adminEnv);
  assert.strictEqual(delSuccess.status, 200);
  assert.strictEqual(shared.announcements.some(a => a.id === 10), false);
  ok('Admin successfully deletes announcement');
}

console.log('\n--- 5. Rich HTML & Anti-XSS Protection ---');
{
  const shared = {};
  const adminEnv = createMockEnv(makeSession({ id: 4, role: 'admin', department: 'Ban Giám Đốc' }), shared);
  
  // Post announcement with XSS attack vector and rich text
  const dirtyContent = '<h1>Thông báo quý 3</h1><p onclick="stealCookies()">Nội dung chính</p><script>alert("XSS Attack!")</script><a href="javascript:alert(1)">Click me</a>';
  const postRes = await callApi('POST', '/api/announcements', {
    title: 'Thông báo có định dạng HTML và script',
    content: dirtyContent,
    target_scope: 'all'
  }, adminEnv);

  assert.strictEqual(postRes.status, 200);
  const savedContent = postRes.body.announcement.content;
  assert.strictEqual(savedContent.includes('<script>'), false, 'Scripts must be stripped out');
  assert.strictEqual(savedContent.includes('alert("XSS Attack!")'), false, 'Script contents must be stripped');
  assert.strictEqual(savedContent.includes('onclick'), false, 'Event handlers must be stripped');
  assert.strictEqual(savedContent.includes('javascript:'), false, 'javascript: URIs must be stripped');
  assert.strictEqual(savedContent.includes('<h1>Thông báo quý 3</h1>'), true, 'Safe Word-like HTML tags must be preserved');
  ok('Server sanitizes XSS vectors while preserving safe Word rich-text HTML');

  // Employee cannot upload attachment (403)
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', department: 'Marketing' }), shared);
  const uploadEmpReq = new Request(SERVER_URL + '/api/announcements/upload', {
    method: 'POST',
    headers: { 'X-Auth-Token': TOKEN },
  });
  const uploadEmpRes = await handle(uploadEmpReq, empEnv.env);
  assert.strictEqual(uploadEmpRes.status, 403);
  ok('Employee cannot upload announcement attachments (403)');
}

console.log(`\n========================================`);
console.log(`ALL ${passed} ANNOUNCEMENT TESTS PASSED!`);
console.log(`========================================\n`);
