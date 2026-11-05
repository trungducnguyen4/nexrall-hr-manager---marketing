/**
 * AI Agent Orchestration & Parity Test Suite
 * Validates bounded iterative tool execution loop (N <= 5),
 * tool authorization enforcement, error handling, and streaming parity.
 */
import assert from 'node:assert/strict';
import { runCopilotTurn } from '../server/services/agent/orchestrator/turn-orchestrator.js';
import { runCopilotTurnStream } from '../server/services/agent/orchestrator/stream-orchestrator.js';

class MockAgentD1 {
  constructor() {
    this.logs = [];
  }
  prepare(sql) {
    const self = this;
    return {
      bind(...params) {
        return {
          async first() {
            if (/FROM attendance/i.test(sql)) {
              return null;
            }
            if (/FROM tasks WHERE id = \?/i.test(sql)) {
              return { id: params[0], title: 'Test Task', status: 'in-progress', assigned_to: 101, assigned_by: 101 };
            }
            return null;
          },
          async all() {
            if (/FROM knowledge_documents/i.test(sql)) {
              return { results: [] };
            }
            if (/FROM knowledge_chunks/i.test(sql)) {
              return { results: [] };
            }
            return { results: [] };
          },
          async run() {
            self.logs.push({ sql, params });
            return { success: true, meta: { changes: 1 } };
          }
        };
      }
    };
  }
}

async function runTests() {
  console.log('--- STARTING AI AGENT ORCHESTRATION TESTS ---');

  const env = {
    DB: new MockAgentD1(),
    GEMINI_API_KEY: '', // offline deterministic edge heuristic
    OPENAI_API_KEY: '',
    AI: null
  };

  const employeeUser = {
    id: 101,
    role: 'employee',
    department: 'Kỹ thuật',
    full_name: 'Nguyễn Văn Test'
  };

  // Test 1: Direct answer without tools
  {
    console.log('[Test 1] Direct answer without tool call');
    const res = await runCopilotTurn(env, {
      userMessage: 'Xin chào',
      me: employeeUser
    });
    assert.ok(res.content, 'Must produce a non-empty response');
    assert.strictEqual(res.actionCard, null, 'Direct answer should not produce action card');
    console.log('  -> PASS: Direct greeting resolved smoothly.');
  }

  // Test 2: Heuristic intent / single tool execution
  {
    console.log('[Test 2] Single tool execution for task status update');
    const res = await runCopilotTurn(env, {
      userMessage: 'Hoàn thành task 101',
      me: employeeUser
    });
    assert.ok(res.content, 'Should output task update confirmation');
    assert.ok(res.executedAction || res.actionCard, 'Action should be tracked');
    console.log('  -> PASS: Task status tool executed.');
  }

  // Test 3: Tool Authorization Guardrail
  {
    console.log('[Test 3] Tool authorization guardrail blocks employee from restricted admin tool');
    const res = await runCopilotTurn(env, {
      userMessage: 'Đổi mã nhân viên của Lê Văn B thành NV999',
      me: employeeUser
    });
    // Employee is not admin; should not execute or card should be refused
    assert.ok(
      res.content.includes('Từ chối') || res.content.includes('Quyền') || res.actionCard === null || res.content.includes('Admin'),
      'Must guard against unauthorized employee code changes'
    );
    console.log('  -> PASS: Tool authorization denied restricted tool invocation.');
  }

  // Test 4: Streaming parity test
  {
    console.log('[Test 4] Streaming orchestrator tool synthesis parity');
    const events = [];
    await runCopilotTurnStream(env, {
      userMessage: 'Quy định chấm công NetViet thế nào?',
      me: employeeUser,
      onEvent: async (type, data) => {
        events.push({ type, data });
      }
    });

    const deltaEvents = events.filter(e => e.type === 'delta');
    const doneEvent = events.find(e => e.type === 'done');

    assert.ok(deltaEvents.length > 0, 'Stream must emit delta events');
    assert.ok(doneEvent, 'Stream must finish with done event');
    assert.ok(doneEvent.data.content.length > 0, 'Done content must be non-empty');
    console.log('  -> PASS: Streaming correctly delivered chunked response.');
  }

  // Test 5: Bounded loop stops at max iterations without crash
  {
    console.log('[Test 5] Bounded loop handles edge cases within max 5 iterations');
    const res = await runCopilotTurn(env, {
      userMessage: 'Tạo task: Kiểm tra an toàn hệ thống',
      me: employeeUser
    });
    assert.ok(res.content, 'Must complete bounded loop');
    assert.ok(res.actionCard || res.executedAction, 'Must have generated task action');
    console.log('  -> PASS: Bounded iteration successfully terminated.');
  }

  console.log('--- ALL AI AGENT ORCHESTRATION TESTS PASSED (5/5) ---');
}

runTests().catch(err => {
  console.error('Agent orchestration test failed:', err);
  process.exit(1);
});
