// ════════════════════════════════════════════════════════════════════════════
//  Company Chat Workflow Verification Tests (node, mock D1)
// ════════════════════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import assert from 'assert';

const TOKEN = 'c'.repeat(64);
const SERVER_URL = 'https://x.local';

const mod = await import(pathToFileURL('D:/NetVietTv/nexrall-hr-manager---marketing/server.js').href);
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

function createMockEnv(sessionUser, sharedState = {}) {
  const users = sharedState.users || [
    { id: 1, full_name: 'Nhân viên 1 (MKT)', role: 'employee', department: 'Marketing', employee_code: 'NV-001', avatar_url: null, is_active: 1 },
    { id: 2, full_name: 'Nhân viên 2 (IT)', role: 'employee', department: 'IT', employee_code: 'NV-002', avatar_url: null, is_active: 1 },
    { id: 3, full_name: 'Trưởng phòng MKT', role: 'manager', department: 'Marketing', employee_code: 'TP-001', avatar_url: null, is_active: 1 },
    { id: 4, full_name: 'Quản trị viên Admin', role: 'admin', department: 'Ban Giám Đốc', employee_code: 'AD-001', avatar_url: null, is_active: 1 },
  ];

  const conversations = sharedState.conversations || [
    { id: 99, type: 'company', name: 'Kênh chung công ty', team_id: null, project_id: null, created_by: 1, created_at: '2026-08-01 00:00:00', dissolved_at: null }
  ];

  const conversationMembers = sharedState.conversationMembers || [
    { conversation_id: 99, user_id: 1, role: 'member', last_read_message_id: 0 },
    { conversation_id: 99, user_id: 2, role: 'member', last_read_message_id: 0 },
    { conversation_id: 99, user_id: 3, role: 'admin', last_read_message_id: 0 },
    { conversation_id: 99, user_id: 4, role: 'owner', last_read_message_id: 0 },
  ];

  const messages = sharedState.messages || [
    { id: 501, conversation_id: 99, sender_id: 2, content: 'Chào cả công ty!', message_type: 'text', reply_to_id: null, task_id: null, edited_at: null, deleted_at: null, created_at: '2026-08-01 10:00:00' },
    { id: 502, conversation_id: 99, sender_id: 4, content: 'Thông báo họp đầu tuần 9h sáng', message_type: 'text', reply_to_id: null, task_id: null, edited_at: null, deleted_at: null, created_at: '2026-08-01 10:05:00' },
  ];

  const pinnedMessages = sharedState.pinnedMessages || [];

  const db = {
    async exec() {},
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async all() {
          // console.log('ALL:', sql, stmt.args);

          if (sql.includes('FROM sessions')) return { results: [sessionUser] };
          if (sql.includes('FROM users WHERE is_active = 1')) {
            return { results: users.filter(u => u.is_active === 1) };
          }
          if (sql.includes('FROM users')) {
            return { results: users };
          }
          if (sql.includes('FROM conversation_members cm JOIN users u')) {
            const convId = stmt.args[0];
            const members = conversationMembers.filter(m => m.conversation_id === convId).map(m => {
              const u = users.find(x => x.id === m.user_id) || {};
              return { ...m, full_name: u.full_name, employee_code: u.employee_code, avatar_url: u.avatar_url };
            });
            return { results: members };
          }
          if (sql.includes('FROM conversation_members WHERE conversation_id = ?')) {
            const convId = stmt.args[0];
            return { results: conversationMembers.filter(m => m.conversation_id === convId) };
          }
          if (sql.includes('FROM messages WHERE conversation_id = ?')) {
            return { results: messages.filter(m => m.conversation_id === stmt.args[0]) };
          }
          if (sql.includes('FROM pinned_messages pm JOIN messages m')) {
            const convId = stmt.args[0];
            const pins = pinnedMessages.filter(p => p.conversation_id === convId).map(p => {
              const msg = messages.find(m => m.id === p.message_id) || {};
              const sender = users.find(u => u.id === msg.sender_id) || {};
              return { ...msg, sender_name: sender.full_name, pinned_by: p.pinned_by, pinned_at: p.created_at, is_pinned: 1 };
            });
            return { results: pins };
          }
          if (sql.includes('FROM message_attachments')) return { results: [] };
          if (sql.includes('FROM message_reactions')) return { results: [] };
          if (sql.includes('FROM message_mentions')) return { results: [] };
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO conversations')) {
            const newId = conversations.length + 100;
            conversations.push({ id: newId, type: stmt.args[0], name: stmt.args[1], created_by: stmt.args[2] });
            return { meta: { last_row_id: newId } };
          }
          if (sql.includes('INSERT OR IGNORE INTO conversation_members')) {
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO messages')) {
            const newMsgId = messages.length + 600;
            const [convId, senderId, content, replyToId, taskId, messageType] = stmt.args;
            const newMsg = {
              id: newMsgId, conversation_id: convId, sender_id: senderId, content,
              reply_to_id: replyToId, task_id: taskId, message_type: messageType,
              edited_at: null, deleted_at: null, created_at: new Date().toISOString()
            };
            messages.push(newMsg);
            return { meta: { last_row_id: newMsgId } };
          }
          if (sql.includes('INSERT OR IGNORE INTO pinned_messages')) {
            const [convId, messageId, pinnedBy] = stmt.args;
            pinnedMessages.push({ conversation_id: convId, message_id: messageId, pinned_by: pinnedBy, created_at: new Date().toISOString() });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM pinned_messages')) {
            const [convId, messageId] = stmt.args;
            const idx = pinnedMessages.findIndex(p => p.conversation_id === convId && p.message_id === messageId);
            if (idx >= 0) pinnedMessages.splice(idx, 1);
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE messages SET deleted_at = ? WHERE id = ?')) {
            const [deletedAt, msgId] = stmt.args;
            const msg = messages.find(m => m.id === Number(msgId));
            if (msg) msg.deleted_at = deletedAt;
            return { meta: { changes: 1 } };
          }
          return { meta: { last_row_id: 1, changes: 1 } };
        },
        async first() {
          const res = await (async () => {

          if (sql.includes('FROM sessions')) return sessionUser;
          if (sql.includes("setting_key='schema_version'") || sql.includes("setting_key='seed_version'")) return null;
          if (sql.includes("SELECT id, name, type FROM conversations WHERE type = 'company'") || sql.includes("SELECT id FROM conversations WHERE type = 'company'")) {
            return conversations.find(c => c.type === 'company') || null;
          }
          if (sql.includes("SELECT id, name, type FROM conversations WHERE name = 'Kênh chung công ty'") || sql.includes("SELECT id FROM conversations WHERE name = 'Kênh chung công ty'")) {
            return conversations.find(c => c.name === 'Kênh chung công ty') || null;
          }
          if (sql.includes('FROM conversations c') && sql.includes('WHERE c.id = ?')) {
            const conv = conversations.find(c => c.id === stmt.args[2]);
            if (!conv) return null;
            return {
              ...conv,
              member_count: conversationMembers.filter(m => m.conversation_id === conv.id).length,
              unread_count: 0
            };
          }
          if (sql.includes('SELECT * FROM conversations WHERE id = ?')) {
            return conversations.find(c => c.id === stmt.args[0]) || null;
          }
          if (sql.includes('FROM conversation_members cm JOIN conversations c') || sql.includes('FROM conversations c JOIN conversation_members cm')) {
            const convId = stmt.args[0];
            const userId = stmt.args[1];
            const conv = conversations.find(c => c.id === convId);
            const mem = conversationMembers.find(m => m.conversation_id === convId && m.user_id === userId);
            if (!conv || !mem) return null;
            return { ...conv, role: mem.role, is_dissolved: 0 };
          }
          if (sql.includes('FROM messages m') && sql.includes('JOIN users u') && sql.includes('m.conversation_id = ?')) {
            const convId = stmt.args[0];
            const convMsgs = messages.filter(m => m.conversation_id === convId);
            const last = convMsgs[convMsgs.length - 1];
            if (!last) return null;
            const sender = users.find(u => u.id === last.sender_id) || {};
            return { ...last, sender_name: sender.full_name };
          }
          if (sql.includes('SELECT conversation_id, sender_id FROM messages WHERE id = ? AND deleted_at IS NULL')) {
            const msg = messages.find(m => m.id === Number(stmt.args[0]) && !m.deleted_at);
            return msg || null;
          }
          if (sql.includes('SELECT id, conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL')) {
            const msg = messages.find(m => m.id === Number(stmt.args[0]) && !m.deleted_at);
            return msg || null;
          }
          if (sql.includes('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')) {
            const [convId, uid] = stmt.args;
            return conversationMembers.find(m => m.conversation_id === convId && m.user_id === uid) ? { 1: 1 } : null;
          }
          if (sql.includes('FROM messages WHERE id = ?') || sql.includes('SELECT * FROM messages WHERE id = ?') || (sql.includes('FROM messages m JOIN users u') && sql.includes('WHERE m.id=?'))) {
            const msg = messages.find(m => m.id === Number(stmt.args[0]));
            if (!msg) return null;
            const sender = users.find(u => u.id === msg.sender_id) || {};
            return { ...msg, sender_name: sender.full_name, sender_avatar: sender.avatar_url, is_pinned: 0 };
          }
            return null;
          })();
          return res;
        }
      };
      return stmt;
    },
    async batch(items) { for (const it of items) await it.run(); }
  };

  return { env: { DB: db }, conversations, conversationMembers, messages, pinnedMessages, users };
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

console.log('\n--- 1. Single Company Channel Retrieval ---');
{
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee', full_name: 'NV 1' }));
  const res = await callApi('GET', '/api/conversations', undefined, empEnv);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.conversations.length, 1);
  const conv = res.body.conversations[0];
  assert.strictEqual(conv.type, 'company');
  assert.strictEqual(conv.name, 'Kênh chung công ty');
  assert.strictEqual(conv.member_count, 4);
  ok('GET /api/conversations returns only the single company channel with all members');
}

console.log('\n--- 2. Block Creating Direct & Group Chats ---');
{
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee' }));
  const res = await callApi('POST', '/api/conversations', {
    type: 'direct',
    member_ids: [2]
  }, empEnv);
  assert.strictEqual(res.status, 403);
  assert.ok(res.body.error.includes('duy nhất'));
  ok('POST /api/conversations is blocked (403)');
}

console.log('\n--- 3. Message Sending in Company Channel ---');
{
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee' }));
  const res = await callApi('POST', '/api/conversations/99/messages', {
    content: 'Chào buổi sáng mọi người!',
    message_type: 'text'
  }, empEnv);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.message);
  assert.strictEqual(res.body.message.content, 'Chào buổi sáng mọi người!');
  ok('Any employee can post messages to the company channel');
}

console.log('\n--- 4. Pinned Announcement Permissions ---');
{
  const shared = { pinnedMessages: [] };
  // Employee 1 attempts to pin -> 403
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee' }), shared);
  const pinEmpRes = await callApi('POST', '/api/messages/502/pin', {}, empEnv);
  assert.strictEqual(pinEmpRes.status, 403);
  assert.ok(pinEmpRes.body.error.includes('Quản lý'));
  ok('Regular employee cannot pin announcements (403)');

  // Manager in Marketing pins announcement -> 200
  const mgrEnv = createMockEnv(makeSession({ id: 3, role: 'manager', department: 'Marketing' }), shared);
  const pinMgrRes = await callApi('POST', '/api/messages/502/pin', {}, mgrEnv);
  assert.strictEqual(pinMgrRes.status, 200);
  assert.strictEqual(shared.pinnedMessages.length, 1);
  assert.strictEqual(shared.pinnedMessages[0].message_id, 502);
  ok('Manager can pin announcements to the company channel');

  // Admin unpins announcement -> 200
  const admEnv = createMockEnv(makeSession({ id: 4, role: 'admin' }), shared);
  const unpinRes = await callApi('DELETE', '/api/messages/502/pin', undefined, admEnv);
  assert.strictEqual(unpinRes.status, 200);
  assert.strictEqual(shared.pinnedMessages.length, 0);
  ok('Admin can unpin announcements');
}

console.log('\n--- 5. Message Deletion & Moderation ---');
{
  const messages = [
    { id: 501, conversation_id: 99, sender_id: 2, content: 'Chào cả công ty!', message_type: 'text', reply_to_id: null, task_id: null, edited_at: null, deleted_at: null, created_at: '2026-08-01 10:00:00' },
    { id: 502, conversation_id: 99, sender_id: 4, content: 'Thông báo họp đầu tuần 9h sáng', message_type: 'text', reply_to_id: null, task_id: null, edited_at: null, deleted_at: null, created_at: '2026-08-01 10:05:00' },
  ];
  const shared = { messages };

  // Employee 1 attempts to delete message 501 (sent by employee 2) -> 403
  const empEnv = createMockEnv(makeSession({ id: 1, role: 'employee' }), shared);
  const delForbidden = await callApi('DELETE', '/api/messages/501', undefined, empEnv);
  assert.strictEqual(delForbidden.status, 403);
  ok('Employee cannot delete another person’s message (403)');

  // Employee 2 deletes their own message 501 -> 200
  const authorEnv = createMockEnv(makeSession({ id: 2, role: 'employee' }), shared);
  const delOwn = await callApi('DELETE', '/api/messages/501', undefined, authorEnv);
  assert.strictEqual(delOwn.status, 200);
  const msg501 = messages.find(m => m.id === 501);
  assert.ok(msg501.deleted_at);
  ok('Author can delete their own message');

  // Admin moderates / deletes message 502 -> 200
  const admEnv = createMockEnv(makeSession({ id: 4, role: 'admin' }), shared);
  const delAdmin = await callApi('DELETE', '/api/messages/502', undefined, admEnv);
  assert.strictEqual(delAdmin.status, 200);
  const msg502 = messages.find(m => m.id === 502);
  assert.ok(msg502.deleted_at);
  ok('Admin/Manager can moderate and delete inappropriate messages');
}

console.log('\n--- 6. Protect Company Channel from Dissolving ---');
{
  const admEnv = createMockEnv(makeSession({ id: 4, role: 'admin' }));
  const dissolveRes = await callApi('DELETE', '/api/conversations/99', undefined, admEnv);
  assert.strictEqual(dissolveRes.status, 400);
  assert.ok(dissolveRes.body.error.includes('Không thể giải tán kênh chung công ty'));
  ok('Company channel cannot be dissolved or deleted (400)');
}

console.log(`\n========================================`);
console.log(`ALL ${passed} COMPANY CHAT TESTS PASSED!`);
console.log(`========================================\n`);
