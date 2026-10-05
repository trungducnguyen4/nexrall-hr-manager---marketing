import assert from 'node:assert/strict';
import { handleAiRoutes } from '../server/controllers/ai.controller.js';
import { cosineSimilarity, circuitBreaker } from '../server/services/ai-gateway.service.js';

console.log('--- Test Suite: P0 Security, Resilience & Integrity Audit ---');

class MockD1 {
  constructor() {
    this.logs = new Map();
    this.logs.set('req_user1_private', {
      id: 'req_user1_private',
      user_id: 1,
      query_text: 'Bảng lương mật của tôi',
      response_text: 'Lương thực nhận: 25.000.000đ'
    });
  }
  prepare(sql) {
    const self = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes('user_id = ? OR ? = 1') && sql.includes('SELECT')) {
              const [reqId, userId, isAdmin] = params;
              const log = self.logs.get(reqId);
              if (!log) return null;
              if (log.user_id === userId || isAdmin === 1) return log;
              return null;
            }
            if (sql.includes('FROM ai_generation_logs WHERE id = ?')) {
              return self.logs.get(params[0]) || null;
            }
            return null;
          },
          async all() { return { results: [] }; },
          async run() {
            if (sql.includes('UPDATE ai_generation_logs') && sql.includes('user_id = ? OR ? = 1')) {
              const [, , reqId, userId, isAdmin] = params;
              const log = self.logs.get(reqId);
              if (log && (log.user_id === userId || isAdmin === 1)) {
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 0 } };
            }
            return { success: true, meta: { last_row_id: 99, changes: 1 } };
          }
        };
      },
      async all() { return { results: [] }; },
      async run() { return { success: true, meta: { last_row_id: 99, changes: 1 } }; }
    };
  }
  async exec() { return true; }
}

const mockEnv = { DB: new MockD1() };
const user1 = { id: 1, role: 'employee', full_name: 'Nguyễn Văn A' };
const user2 = { id: 2, role: 'employee', full_name: 'Trần Thị B' };
const adminUser = { id: 99, role: 'admin', full_name: 'Admin Boss' };

async function runAudit() {
  // 1. P0.5 Vector Dimension Consistency
  {
    const vec384 = new Array(384).fill(0.1);
    const vec1536 = new Array(1536).fill(0.1);
    const simMismatch = cosineSimilarity(vec384, vec1536);
    assert.equal(simMismatch, 0, 'Vector dimension mismatch phải trả về 0 để bảo toàn ngữ nghĩa');

    const vecIdentical = new Array(384).fill(0.5);
    const simIdentical = cosineSimilarity(vec384, vecIdentical);
    assert.ok(Math.abs(simIdentical - 1.0) < 0.0001, 'Cùng dimension và tỷ lệ phải đạt similarity ≈ 1');
    console.log('  ok  P0.5 Vector Dimension: Rejects cross-dimensional comparisons (0 on mismatch)');
  }

  // 2. P0.6 Circuit Breaker State Machine
  {
    circuitBreaker.recordSuccess('test-provider');
    assert.equal(circuitBreaker.canAttempt('test-provider'), true);
    
    // Trip after 3 failures
    circuitBreaker.recordFailure('test-provider', 'Error 1');
    circuitBreaker.recordFailure('test-provider', 'Error 2');
    circuitBreaker.recordFailure('test-provider', 'Error 3');
    assert.equal(circuitBreaker.canAttempt('test-provider'), false, 'Provider phải ở trạng thái OPEN sau 3 lần lỗi');
    console.log('  ok  P0.6 Circuit Breaker: Correctly trips to OPEN upon consecutive failure threshold');
  }

  // 3. P0.3 Authorization on AI Logs & Feedback
  {
    // User 2 cố gắng đọc log của User 1
    const reqLogOther = new Request('http://localhost/api/ai/logs?request_id=req_user1_private');
    const resForbidden = await handleAiRoutes(reqLogOther, mockEnv, user2, '/api/ai/logs', new URL(reqLogOther.url));
    assert.equal(resForbidden.status, 404, 'User khác không được phép đọc log của người khác (phải trả về 404 Not Found)');

    // User 1 tự đọc log của mình
    const resOwner = await handleAiRoutes(reqLogOther, mockEnv, user1, '/api/ai/logs', new URL(reqLogOther.url));
    assert.equal(resOwner.status, 200, 'Chính chủ được phép đọc log của mình');

    // Admin đọc log của User 1
    const resAdmin = await handleAiRoutes(reqLogOther, mockEnv, adminUser, '/api/ai/logs', new URL(reqLogOther.url));
    assert.equal(resAdmin.status, 200, 'Admin có quyền đọc log để audit');

    // User 2 cố gắng gửi feedback trên log của User 1
    const reqFeedbackOther = new Request('http://localhost/api/ai/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'req_user1_private', rating: 1, comment: 'Hacker vote' })
    });
    const resFbOther = await handleAiRoutes(reqFeedbackOther, mockEnv, user2, '/api/ai/feedback', new URL(reqFeedbackOther.url));
    assert.equal(resFbOther.status, 404, 'User khác không được quyền rate/comment log không thuộc sở hữu');
    console.log('  ok  P0.3 AI Log & Feedback Authorization: Strictly prevents unauthorized access / IDOR');
  }

  // 4. P0.2 Input Validation
  {
    // Message quá 2000 ký tự
    const longMsg = 'A'.repeat(2005);
    const reqLong = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: longMsg })
    });
    const resLong = await handleAiRoutes(reqLong, mockEnv, user1, '/api/ai/chat', new URL(reqLong.url));
    assert.equal(resLong.status, 400, 'Phải từ chối tin nhắn dài quá 2000 ký tự');

    // Payload quá 64KB
    const reqHuge = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '70000' },
      body: JSON.stringify({ message: 'test' })
    });
    const resHuge = await handleAiRoutes(reqHuge, mockEnv, user1, '/api/ai/chat', new URL(reqHuge.url));
    assert.equal(resHuge.status, 413, 'Phải từ chối payload lớn hơn 64KB (413 Payload Too Large)');
    console.log('  ok  P0.2 Input Validation: Rejects oversized messages and payloads early');
  }

  // 5. P0.4 Human-in-the-Loop Action Validation & Idempotency
  {
    // Sai định dạng ngày
    const reqBadDate = new Request('http://localhost/api/ai/actions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'create_leave_request',
        payload: { startDate: '12-10-2026', endDate: '13-10-2026' }
      })
    });
    const resBadDate = await handleAiRoutes(reqBadDate, mockEnv, user1, '/api/ai/actions/confirm', new URL(reqBadDate.url));
    assert.equal(resBadDate.status, 400, 'Phải từ chối ngày sai định dạng YYYY-MM-DD');

    // Ngày bắt đầu sau ngày kết thúc
    const reqInverted = new Request('http://localhost/api/ai/actions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'create_leave_request',
        payload: { startDate: '2026-10-20', endDate: '2026-10-15' }
      })
    });
    const resInverted = await handleAiRoutes(reqInverted, mockEnv, user1, '/api/ai/actions/confirm', new URL(reqInverted.url));
    assert.equal(resInverted.status, 400, 'Phải từ chối startDate > endDate');

    // Idempotency token test
    const actionId = 'act_' + Date.now();
    const reqValid1 = new Request('http://localhost/api/ai/actions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'create_leave_request',
        actionId,
        payload: { startDate: '2026-10-10', endDate: '2026-10-12', reason: 'Nghỉ phép năm' }
      })
    });
    const res1 = await handleAiRoutes(reqValid1, mockEnv, user1, '/api/ai/actions/confirm', new URL(reqValid1.url));
    const data1 = await res1.json();
    assert.equal(data1.ok, true);

    // Gửi lại cùng actionId (double click)
    const reqValid2 = new Request('http://localhost/api/ai/actions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'create_leave_request',
        actionId,
        payload: { startDate: '2026-10-10', endDate: '2026-10-12', reason: 'Nghỉ phép năm' }
      })
    });
    const res2 = await handleAiRoutes(reqValid2, mockEnv, user1, '/api/ai/actions/confirm', new URL(reqValid2.url));
    const data2 = await res2.json();
    assert.equal(data2.requestId, data1.requestId, 'Cùng actionId phải trả về kết quả đã cache, không tạo duplicate request');
    console.log('  ok  P0.4 HITL Actions: Strict schema validation & Idempotency protection');
  }

  // 6. P0.1 Rate Limiting (User bucket 10 req/min)
  {
    const rapidUser = { id: 7777, role: 'employee' };
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const r = new Request('http://localhost/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' })
      });
      const res = await handleAiRoutes(r, mockEnv, rapidUser, '/api/ai/chat', new URL(r.url));
      if (res.status === 429) {
        got429 = true;
        assert.ok(res.headers.get('Retry-After'), 'Phải trả về header Retry-After');
        break;
      }
    }
    assert.ok(got429, 'Gửi quá 10 req/phút phải bị chặn với mã 429 Too Many Requests');
    console.log('  ok  P0.1 AI Rate Limiting: Blocks flood requests (>10 req/min/user) with HTTP 429 and Retry-After');
  }

  console.log('\n--- ALL P0 SECURITY & INTEGRITY AUDITS PASSED! ---');
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
