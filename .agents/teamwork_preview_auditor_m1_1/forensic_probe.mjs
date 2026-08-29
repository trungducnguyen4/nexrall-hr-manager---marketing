// Forensic Auditor Independent Probe Suite for Milestone 1
import assert from 'node:assert/strict';
import { AppSyncHub } from '../../src/sync-hub.js';
import { broadcastAppEvent } from '../../server.js';

let passed = 0;
let failed = 0;

function runCheck(name, fn) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      throw new Error(`Test ${name} returned a Promise, use asyncRunCheck`);
    }
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    failed++;
  }
}

async function asyncRunCheck(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    failed++;
  }
}

console.log('=== FORENSIC PROBE 1: Monotonic Sequence & Buffer Sliding Window ===');

await asyncRunCheck('Monotonic sequence increments exactly once per event and maintains chronological order', async () => {
  const mockStorage = {
    data: new Map(),
    async get(k) { return this.data.get(k); },
    async put(k, v) {
      if (typeof k === 'object') {
        for (const [key, val] of Object.entries(k)) this.data.set(key, val);
      } else {
        this.data.set(k, v);
      }
    }
  };
  const ctx = { storage: mockStorage, getWebSockets: () => [] };
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  assert.equal(hub.seq, 0);
  assert.equal(hub.replayBuffer.length, 0);

  const totalEvents = 250;
  for (let i = 1; i <= totalEvents; i++) {
    const res = await hub.broadcast({ topic: 'test', event: 'tick', payload: { i } });
    assert.equal(res.ok, true);
    assert.equal(res.seq, i);
    assert.equal(hub.seq, i);
  }

  // Verify buffer capacity constraint
  assert.equal(hub.replayBuffer.length, 100, 'Buffer must cap at exactly maxBufferSize (100)');
  assert.equal(hub.replayBuffer[0].seq, 151, 'Oldest event seq must be 151');
  assert.equal(hub.replayBuffer[99].seq, 250, 'Newest event seq must be 250');

  // Verify storage persistence
  assert.equal(mockStorage.data.get('seq'), 250);
  assert.equal(mockStorage.data.get('replayBuffer').length, 100);
});

console.log('=== FORENSIC PROBE 2: Multi-Client Topic & Actor Visibility Matrix ===');

await asyncRunCheck('Multi-client topic and user isolation matrix is strictly enforced', async () => {
  const hub = new AppSyncHub({ getWebSockets: () => [] }, {});
  await hub.initPromise;

  const clientAll = { userId: 1, topics: ['*'] };
  const clientTasksOnly = { userId: 2, topics: ['tasks'] };
  const clientLeaveOnly = { userId: 3, topics: ['leave'] };
  const clientSpecificUser = { userId: 4, topics: ['*'] };

  // 1. Tasks event broadcast without user restrictions
  const taskEvent = { id: 'evt_1', seq: 1, topic: 'tasks', event: 'task:created', payload: {} };
  assert.equal(hub.isEventVisibleToSession(taskEvent, clientAll), true, 'clientAll sees tasks');
  assert.equal(hub.isEventVisibleToSession(taskEvent, clientTasksOnly), true, 'clientTasks sees tasks');
  assert.equal(hub.isEventVisibleToSession(taskEvent, clientLeaveOnly), false, 'clientLeave must NOT see tasks');
  assert.equal(hub.isEventVisibleToSession(taskEvent, clientSpecificUser), true, 'clientSpecificUser sees public tasks');

  // 2. Targeted event to user 4 only
  const directEvent = { id: 'evt_2', seq: 2, topic: 'notifications', event: 'mention', payload: {}, targetUserIds: [4] };
  assert.equal(hub.isEventVisibleToSession(directEvent, clientAll), false, 'User 1 must not see user 4 notification');
  assert.equal(hub.isEventVisibleToSession(directEvent, clientTasksOnly), false, 'User 2 must not see user 4 notification');
  assert.equal(hub.isEventVisibleToSession(directEvent, clientLeaveOnly), false, 'User 3 must not see user 4 notification');
  assert.equal(hub.isEventVisibleToSession(directEvent, clientSpecificUser), true, 'User 4 sees targeted notification');

  // 3. Null / undefined session defense
  assert.equal(hub.isEventVisibleToSession(taskEvent, null), false, 'Null session returns false');
  assert.equal(hub.isEventVisibleToSession(taskEvent, undefined), false, 'Undefined session returns false');
});

console.log('=== FORENSIC PROBE 3: Replay Handling & Boundary Stress Tests ===');

await asyncRunCheck('Replay engine handles boundary conditions, exact limits, and overflow correctly', async () => {
  const hub = new AppSyncHub({ getWebSockets: () => [] }, {});
  await hub.initPromise;

  for (let i = 1; i <= 100; i++) {
    await hub.broadcast({ topic: 'tasks', event: 'created', payload: { i } });
  }

  // Buffer currently has seq 1..100
  const session = { userId: 10, topics: ['tasks'] };
  let replayMessages = [];
  const mockWs = {
    send(data) { replayMessages.push(JSON.parse(data)); }
  };

  // Case A: Client at current sequence (no missed events)
  replayMessages = [];
  hub.handleReplay(mockWs, session, 100);
  assert.equal(replayMessages.length, 1);
  assert.equal(replayMessages[0].type, 'replay:complete');
  assert.equal(replayMessages[0].replayedCount, 0);

  // Case B: Client at sequence ahead of hub (e.g. clock desync / future seq)
  replayMessages = [];
  hub.handleReplay(mockWs, session, 105);
  assert.equal(replayMessages.length, 1);
  assert.equal(replayMessages[0].type, 'replay:complete');
  assert.equal(replayMessages[0].replayedCount, 0);

  // Case C: Client at sequence 95 (missed 5 events: 96, 97, 98, 99, 100)
  replayMessages = [];
  hub.handleReplay(mockWs, session, 95);
  assert.equal(replayMessages.length, 1);
  assert.equal(replayMessages[0].type, 'replay:batch');
  assert.equal(replayMessages[0].replayedCount, 5);
  assert.equal(replayMessages[0].events[0].seq, 96);
  assert.equal(replayMessages[0].events[4].seq, 100);

  // Case D: Client at sequence 0 (oldest available is seq 1, so 0 is oldestSeq - 1 -> valid boundary replay)
  replayMessages = [];
  hub.handleReplay(mockWs, session, 0);
  assert.equal(replayMessages.length, 1);
  assert.equal(replayMessages[0].type, 'replay:batch');
  assert.equal(replayMessages[0].replayedCount, 100);

  // Push 10 more events so buffer contains seq 11..110
  for (let i = 101; i <= 110; i++) {
    await hub.broadcast({ topic: 'tasks', event: 'created', payload: { i } });
  }

  // Case E: Client at sequence 0 -> oldest in buffer is 11, oldestSeq - 1 = 10. seq 0 < 10 -> replay:overflow
  replayMessages = [];
  hub.handleReplay(mockWs, session, 0);
  assert.equal(replayMessages.length, 1);
  assert.equal(replayMessages[0].type, 'replay:overflow');
  assert.equal(replayMessages[0].oldestAvailableSeq, 11);
  assert.equal(replayMessages[0].currentSeq, 110);
});

console.log('=== FORENSIC PROBE 4: SSE Fallback Protocol Compliance ===');

await asyncRunCheck('SSE handleSse returns compliant EventStream and streams events formatted correctly', async () => {
  const hub = new AppSyncHub({ getWebSockets: () => [] }, {});
  await hub.initPromise;

  // Broadcast initial event
  await hub.broadcast({ topic: 'general', event: 'ping', payload: { ping: true } });

  const mockUser = { id: 7, full_name: 'Forensic User', role: 'admin' };
  const ac = new AbortController();
  const sseReq = new Request('https://hub.internal/api/realtime/events?topics=general', {
    headers: { 'Accept': 'text/event-stream' },
    signal: ac.signal
  });

  const response = await hub.handleSse(sseReq, mockUser);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(hub.sseClients.size, 1);

  // Read the initial stream chunk
  const reader = response.body.getReader();
  const initialChunk = await reader.read();
  const initialText = new TextDecoder().decode(initialChunk.value);
  assert(initialText.includes('data: {"type":"connected"'), 'Must stream connected event');

  // Broadcast a new event while SSE client is active
  await hub.broadcast({ topic: 'general', event: 'alert', payload: { msg: 'system notice' } });

  const secondChunk = await reader.read();
  const secondText = new TextDecoder().decode(secondChunk.value);
  assert(secondText.includes('id: 2'), 'SSE must output monotonic ID');
  assert(secondText.includes('event: message'), 'SSE must output message event');
  assert(secondText.includes('"msg":"system notice"'), 'SSE must stream payload');

  // Abort client request
  ac.abort();
  assert.equal(hub.sseClients.size, 0, 'Aborted SSE client must be removed from map via signal abort');
});

console.log('=== FORENSIC PROBE 5: broadcastAppEvent Robustness & Invocations ===');

await asyncRunCheck('broadcastAppEvent handles all signature overloads and edge cases', async () => {
  let lastBroadcast = null;
  const mockStub = {
    fetch: async (url, init) => {
      lastBroadcast = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, id: lastBroadcast.id, seq: 99 }), { status: 200 });
    }
  };
  const mockEnv = {
    SYNC_HUB: {
      idFromName: (name) => `id_${name}`,
      get: (id) => mockStub,
    }
  };

  // Overload 1: full object signature
  await broadcastAppEvent(mockEnv, {
    topic: 'tasks',
    event: 'task:created',
    payload: { id: 10 },
    actorId: 42,
    targetUserIds: [1, 2, 3]
  });
  assert.equal(lastBroadcast.topic, 'tasks');
  assert.equal(lastBroadcast.event, 'task:created');
  assert.equal(lastBroadcast.payload.id, 10);
  assert.equal(lastBroadcast.actorId, 42);
  assert.deepEqual(lastBroadcast.targetUserIds, [1, 2, 3]);

  // Overload 2: positional signature (env, topic, event, payload, options)
  await broadcastAppEvent(mockEnv, 'leave', 'leave:approved', { leave_id: 8 }, { actorId: 99, target_user_ids: [12] });
  assert.equal(lastBroadcast.topic, 'leave');
  assert.equal(lastBroadcast.event, 'leave:approved');
  assert.equal(lastBroadcast.payload.leave_id, 8);
  assert.equal(lastBroadcast.actor_id, 99);
  assert.deepEqual(lastBroadcast.target_user_ids, [12]);

  // Non-blocking error handling when DO fails
  const errorEnv = {
    SYNC_HUB: {
      idFromName: () => 'id_global',
      get: () => ({
        fetch: async () => { throw new Error('DO crashed'); }
      })
    }
  };
  const failRes = await broadcastAppEvent(errorEnv, 'chat', 'chat:message_created', {});
  assert.equal(failRes.ok, false);
  assert.equal(failRes.error, 'DO crashed');
});

console.log(`\nProbe Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
