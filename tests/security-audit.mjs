import assert from 'node:assert/strict';
import {
  isMonitoredActor,
  saveIngestedLog,
  fetchAuditLogs,
  clearAuditLogs,
  renderAuditUiHtml,
  AUDIT_SHARED_SECRET
} from '../server/services/security-audit.service.js';

console.log('Testing Security Audit Service...');

// 1. isMonitoredActor detection
assert.equal(isMonitoredActor('admin@company.com'), true, 'Should match admin@company.com');
assert.equal(isMonitoredActor('ADMIN@COMPANY.COM'), true, 'Should match case-insensitive');
assert.equal(isMonitoredActor('ADMIN001'), true, 'Should match ADMIN001 code');
assert.equal(isMonitoredActor('netviettv.tuyendung@gmail.com'), true, 'Should match netviettv.tuyendung@gmail.com');
assert.equal(isMonitoredActor({ id: 1 }), true, 'Should match User ID 1');
assert.equal(isMonitoredActor({ userId: 1 }), true, 'Should match userId 1');
assert.equal(isMonitoredActor({ email: 'admin@company.com' }), true, 'Should match email in object');
assert.equal(isMonitoredActor({ employee_code: 'ADMIN001' }), true, 'Should match employee_code in object');
assert.equal(isMonitoredActor('other@company.com'), false, 'Should not match other email');
assert.equal(isMonitoredActor({ id: 547, email: 'tuan@company.com' }), false, 'Should not match other user');
console.log('  ok isMonitoredActor matches target admin accounts');

// 2. Mock DB operations
const records = [];
const mockDb = {
  prepare(sql) {
    const runner = {
      async run() {
        if (sql.includes('DELETE')) {
          records.length = 0;
        }
        return { success: true };
      },
      async all() {
        return { results: [...records] };
      }
    };
    return {
      run: runner.run,
      all: runner.all,
      bind(...args) {
        return {
          async run() {
            if (sql.includes('INSERT')) {
              records.push({
                id: args[0],
                timestamp: args[1],
                source_env: args[2],
                event_type: args[3],
                actor_id: args[4],
                actor_email: args[5],
                actor_code: args[6],
                method: args[7],
                path: args[8],
                status_code: args[9],
                ip_address: args[10],
                country: args[11],
                user_agent: args[12],
                referer: args[13],
                request_payload: args[14],
                response_summary: args[15],
              });
            } else if (sql.includes('DELETE')) {
              records.length = 0;
            }
            return { success: true };
          },
          async all() {
            return { results: [...records] };
          }
        };
      }
    };
  }
};

const mockEnv = { DB: mockDb };
const testLog = {
  id: 'test-uuid-123',
  timestamp: new Date().toISOString(),
  source_env: 'production',
  event_type: 'LOGIN_FAILURE',
  actor_email: 'admin@company.com',
  method: 'POST',
  path: '/api/auth/login',
  status_code: 401,
  ip_address: '113.161.80.99',
  country: 'VN',
  user_agent: 'Mozilla/5.0 Chrome',
  request_payload: JSON.stringify({ login: 'admin@company.com' }),
  response_summary: JSON.stringify({ error: 'Mật khẩu không đúng' })
};

const saveRes = await saveIngestedLog(mockEnv, testLog);
assert.equal(saveRes.ok, true, 'saveIngestedLog should succeed');
assert.equal(records.length, 1, 'Should have 1 record in mock DB');
assert.equal(records[0].actor_email, 'admin@company.com');

const logs = await fetchAuditLogs(mockEnv);
assert.equal(logs.length, 1, 'fetchAuditLogs should return 1 record');
assert.equal(logs[0].id, 'test-uuid-123');

const clearRes = await clearAuditLogs(mockEnv);
assert.equal(clearRes.ok, true, 'clearAuditLogs should succeed');
assert.equal(records.length, 0, 'Records should be emptied');
console.log('  ok save, fetch, and clear audit logs in DB');

// 3. UI rendering check
const html = renderAuditUiHtml();
assert.ok(html.includes('<!DOCTYPE html>'), 'HTML doc type');
assert.ok(html.includes('NetViet HR'), 'Brand title');
assert.ok(html.includes('Security Audit Center'), 'Center title');
assert.ok(html.includes('/api/audit/logs'), 'API call inside script');
console.log('  ok renderAuditUiHtml produces complete interactive dashboard with NetViet brandkit');

console.log('PASS: All Security Audit tests passed successfully!');
