import assert from 'node:assert/strict';
import { runCopilotTurn, runCopilotTurnStream } from '../server/services/agent.service.js';

console.log('--- Test Suite: Zero-Hallucination Real Data Leave Ranking Verification ---');

const directorUser = {
  id: 1,
  username: 'director_hau',
  full_name: 'Phạm Văn Hậu',
  role: 'director',
  department: 'Ban Giám đốc',
  employee_code: 'BGD-01'
};

class MockLeaveD1 {
  prepare(sql) {
    return {
      bind(...params) {
        return {
          async first() { return null; },
          async all() {
            if (sql.includes('FROM leave_requests lr')) {
              return {
                results: [
                  { id: 43, start_date: '2026-09-22', end_date: '2026-09-22', reason: 'Việc cá nhân', status: 'pending_director', employee_name: 'Phạm Hoàng Anh', employee_code: 'ANHPH', department: 'Phòng IT', user_id: 20 },
                  { id: 44, start_date: '2026-09-23', end_date: '2026-09-26', reason: 'Việc gia đình', status: 'approved', employee_name: 'Phạm Hoàng Anh', employee_code: 'ANHPH', department: 'Phòng IT', user_id: 20 },
                  { id: 45, start_date: '2026-09-28', end_date: '2026-09-29', reason: 'Nghỉ phép cá nhân', status: 'approved', employee_name: 'Phạm Hoàng Anh', employee_code: 'ANHPH', department: 'Phòng IT', user_id: 20 },
                  { id: 31, start_date: '2026-09-18', end_date: '2026-09-18', reason: 'Bị sốt', status: 'approved', employee_name: 'Nguyễn Duy Vĩnh Sơn', employee_code: 'SONNDV', department: 'Phòng Marketing', user_id: 21 },
                  { id: 55, start_date: '2026-09-30', end_date: '2026-09-30', reason: 'Đi học', status: 'pending_director', employee_name: 'Nguyễn Duy Vĩnh Sơn', employee_code: 'SONNDV', department: 'Phòng Marketing', user_id: 21 },
                  { id: 34, start_date: '2026-09-18', end_date: '2026-09-18', reason: 'Đi khám bệnh', status: 'approved', employee_name: 'Lương Thị Thanh Ngân', employee_code: 'NGANLTT', department: 'Phòng sản xuất TVC', user_id: 22 }
                ]
              };
            }
            return { results: [] };
          },
          async run() { return { success: true }; }
        };
      },
      async all() { return { results: [] }; },
      async run() { return { success: true }; }
    };
  }
}

const mockEnv = { DB: new MockLeaveD1() };

async function runVerification() {
  // 1. Test runCopilotTurn with exact user query: "ai là người xin nghỉ nhiều nhất trong tháng 9"
  {
    const res = await runCopilotTurn(mockEnv, {
      userMessage: 'ai là người xin nghỉ nhiều nhất trong tháng 9',
      me: directorUser,
      conversationHistory: []
    });

    console.log('\n--- Turn Response ---:\n', res.content);

    assert.ok(!res.content.includes('Nguyễn Văn A'), 'CRITICAL: Must NEVER contain fake placeholder "Nguyễn Văn A"');
    assert.ok(!res.content.includes('NV001'), 'CRITICAL: Must NEVER contain fake ID "NV001"');
    assert.ok(res.content.includes('Phạm Hoàng Anh'), 'Must identify real top leave taker "Phạm Hoàng Anh"');
    assert.ok(res.content.includes('ANHPH'), 'Must display correct employee code "ANHPH"');
    assert.ok(res.content.includes('7 ngày') || res.content.includes('7'), 'Must accurately calculate total days');
    console.log('  ok  1. runCopilotTurn: Correctly returns real employee (Phạm Hoàng Anh - ANHPH) with zero hallucination');
  }

  // 2. Test runCopilotTurnStream with exact user query
  {
    let streamedContent = '';
    const events = [];

    await runCopilotTurnStream(mockEnv, {
      userMessage: 'ai là người xin nghỉ nhiều nhất trong tháng 9',
      me: directorUser,
      conversationHistory: [],
      onEvent: (type, payload) => {
        events.push({ type, payload });
      }
    });

    const doneEvent = events.find(e => e.type === 'done');
    streamedContent = doneEvent?.payload?.content || '';

    console.log('\n--- Streamed Content ---:\n', streamedContent);

    assert.ok(!streamedContent.includes('Nguyễn Văn A'), 'CRITICAL: Streamed response must NEVER contain "Nguyễn Văn A"');
    assert.ok(!streamedContent.includes('NV001'), 'CRITICAL: Streamed response must NEVER contain "NV001"');
    assert.ok(streamedContent.includes('Phạm Hoàng Anh'), 'Streamed response must identify "Phạm Hoàng Anh"');
    assert.ok(streamedContent.includes('ANHPH'), 'Streamed response must display code "ANHPH"');
    console.log('  ok  2. runCopilotTurnStream: SSE stream delivers grounded data with zero hallucination');
  }

  // 3. Test natural language variations
  const variations = [
    'ai xin nghỉ nhiều nhất tháng 9',
    'nhân viên nào nghỉ nhiều nhất trong tháng 9',
    'ai là người nghỉ phép nhiều nhất tháng 9',
    'thống kê ai nghỉ nhiều nhất tháng 9'
  ];

  for (const q of variations) {
    const res = await runCopilotTurn(mockEnv, {
      userMessage: q,
      me: directorUser,
      conversationHistory: []
    });
    assert.ok(!res.content.includes('Nguyễn Văn A'), `Query "${q}" must not hallucinate Nguyễn Văn A`);
    assert.ok(res.content.includes('Phạm Hoàng Anh'), `Query "${q}" must identify Phạm Hoàng Anh`);
    console.log(`  ok  Variation: "${q}" -> Verified`);
  }

  console.log('\n--- ALL LEAVE RANKING & ANTI-HALLUCINATION VERIFICATIONS PASSED! ---');
}

runVerification().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
