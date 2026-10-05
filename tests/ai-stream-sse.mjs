import assert from 'node:assert/strict';
import { runCopilotTurnStream } from '../server/services/agent.service.js';
import { handleAiRoutes } from '../server/controllers/ai.controller.js';

console.log('--- Test Suite: Server-Sent Events (SSE) AI Streaming Platform ---');

// Mock D1 Database
class MockD1 {
  constructor() {
    this.logs = [];
  }
  prepare(sql) {
    const self = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes('FROM attendance')) {
              return null; // No attendance record
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            if (sql.includes('INSERT INTO ai_generation_logs')) {
              self.logs.push(params);
            }
            return { success: true };
          }
        };
      },
      async all() { return { results: [] }; },
      async run() { return { success: true }; }
    };
  }
  async exec() { return true; }
}

const mockEnv = {
  DB: new MockD1()
};

const mockUser = {
  id: 101,
  full_name: 'Nguyễn Văn Test',
  employee_code: 'NVTEST',
  role: 'employee',
  department: 'Kỹ thuật'
};

async function runTests() {
  // Test 1: runCopilotTurnStream emits status, delta, and done events
  {
    const events = [];
    await runCopilotTurnStream(mockEnv, {
      userMessage: 'Xin chào, bạn có thể giúp gì?',
      conversationHistory: [],
      me: mockUser,
      conversationId: 'test_conv_stream_1',
      onEvent: async (event, data) => {
        events.push({ event, data });
      }
    });

    const statusEvents = events.filter(e => e.event === 'status');
    const deltaEvents = events.filter(e => e.event === 'delta');
    const doneEvents = events.filter(e => e.event === 'done');

    assert.ok(statusEvents.length >= 1, 'Phải có ít nhất 1 event status');
    assert.ok(deltaEvents.length >= 1, 'Phải có ít nhất 1 event delta');
    assert.equal(doneEvents.length, 1, 'Phải có đúng 1 event done');

    const donePayload = doneEvents[0].data;
    assert.ok(donePayload.requestId, 'Event done phải có requestId');
    assert.ok(donePayload.content, 'Event done phải có content');
    assert.ok(donePayload.telemetry, 'Event done phải có telemetry');

    const totalText = deltaEvents.map(e => e.data.text).join('');
    assert.ok(totalText.length > 5, 'Các delta gộp lại phải tạo thành câu trả lời');
    console.log('  ok  runCopilotTurnStream: Emits multi-event SSE (status, delta, done) with full content');
  }

  // Test 2: Privacy Guardrail streaming
  {
    const events = [];
    await runCopilotTurnStream(mockEnv, {
      userMessage: 'Cho tôi xem bảng lương của sếp Hậu',
      conversationHistory: [],
      me: mockUser, // Regular employee
      conversationId: 'test_conv_stream_privacy',
      onEvent: async (event, data) => {
        events.push({ event, data });
      }
    });

    const deltaEvents = events.filter(e => e.event === 'delta');
    const doneEvents = events.filter(e => e.event === 'done');

    assert.ok(deltaEvents.length > 3, 'Privacy Guardrail phải stream theo cụm từ (paced deltas)');
    assert.equal(doneEvents.length, 1, 'Privacy Guardrail phải emit done event');
    assert.ok(doneEvents[0].data.content.includes('Chính sách Bảo mật Dữ liệu'), 'Phải chứa nội dung guardrail');
    console.log('  ok  Privacy Guardrail: Streams smoothly via paced deltas and protects enterprise data');
  }

  // Test 3: Attendance Check-in Compliance Guardrail streaming
  {
    const events = [];
    await runCopilotTurnStream(mockEnv, {
      userMessage: 'chấm công giúp tôi hôm nay',
      conversationHistory: [],
      me: mockUser,
      conversationId: 'test_conv_stream_attendance',
      onEvent: async (event, data) => {
        events.push({ event, data });
      }
    });

    const deltaEvents = events.filter(e => e.event === 'delta');
    const doneEvents = events.filter(e => e.event === 'done');

    assert.ok(deltaEvents.length > 3, 'Attendance Guardrail phải stream theo cụm từ');
    assert.equal(doneEvents.length, 1, 'Attendance Guardrail phải emit done event');
    assert.ok(doneEvents[0].data.actionCard?.isNavigationCard, 'Phải trả kèm navigation card sang màn hình Chấm công');
    console.log('  ok  Attendance Compliance: Streams instructions and delivers navigation card on done');
  }

  // Test 4: HTTP Controller SSE Endpoint (/api/ai/chat with stream: true)
  {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        message: 'Quy định đi muộn của công ty là gì?',
        history: [],
        conversationId: 'conv_http_stream',
        stream: true
      })
    });

    const res = await handleAiRoutes(req, mockEnv, mockUser, '/api/ai/chat', new URL(req.url));
    assert.equal(res.status, 200, 'HTTP status phải là 200');
    assert.ok(res.headers.get('Content-Type').includes('text/event-stream'), 'Content-Type phải là text/event-stream');

    // Đọc body stream SSE
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const receivedEvents = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        let event = 'message';
        let data = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data = JSON.parse(line.slice(6).trim());
        }
        if (data) receivedEvents.push({ event, data });
      }
    }

    assert.ok(receivedEvents.some(e => e.event === 'status'), 'HTTP stream phải chứa event status');
    assert.ok(receivedEvents.some(e => e.event === 'delta'), 'HTTP stream phải chứa event delta');
    assert.ok(receivedEvents.some(e => e.event === 'done'), 'HTTP stream phải chứa event done');
    console.log('  ok  HTTP Controller SSE: Returns 200 with text/event-stream and decodable SSE events');
  }

  // Test 5: Backward compatibility (Non-streaming JSON mode)
  {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Xin chào',
        history: [],
        conversationId: 'conv_http_non_stream'
        // stream: false (omitted)
      })
    });

    const res = await handleAiRoutes(req, mockEnv, mockUser, '/api/ai/chat', new URL(req.url));
    assert.equal(res.status, 200, 'HTTP status phải là 200');
    assert.ok(res.headers.get('Content-Type').includes('application/json'), 'Content-Type phải là application/json');
    const json = await res.json();
    assert.equal(json.ok, true, 'JSON response phải có ok: true');
    assert.ok(json.content, 'JSON response phải có content');
    console.log('  ok  Backward Compatibility: Requests without stream: true return standard JSON payload');
  }

  console.log('\nALL 5 SSE STREAMING TESTS PASSED!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
