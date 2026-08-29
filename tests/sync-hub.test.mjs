// tests/sync-hub.test.mjs
// Comprehensive test suite for AppSyncHub Durable Object and Real-Time Broadcast Pipeline

import assert from 'node:assert/strict';
import { AppSyncHub } from '../src/sync-hub.js';
import { broadcastAppEvent } from '../server.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// Mock Cloudflare DO Storage & Context
class MockStorage {
  constructor(initialData = {}) {
    this.data = new Map(Object.entries(initialData));
  }
  async get(key) {
    if (Array.isArray(key)) {
      const result = new Map();
      for (const k of key) {
        if (this.data.has(k)) result.set(k, this.data.get(k));
      }
      return result;
    }
    return this.data.get(key);
  }
  async put(key, value) {
    if (typeof key === 'object' && value === undefined) {
      for (const [k, v] of Object.entries(key)) this.data.set(k, v);
      return;
    }
    this.data.set(key, value);
  }
  async delete(key) {
    this.data.delete(key);
  }
}

class MockWebSocket {
  constructor(attachment = {}) {
    this.attachment = attachment;
    this.sent = [];
    this.closed = false;
  }
  send(msg) {
    this.sent.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
  }
  close() {
    this.closed = true;
  }
  serializeAttachment(data) {
    this.attachment = data;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

class MockDOContext {
  constructor(storage = new MockStorage()) {
    this.storage = storage;
    this.websockets = [];
  }
  acceptWebSocket(ws) {
    this.websockets.push(ws);
  }
  getWebSockets() {
    return this.websockets.filter(ws => !ws.closed);
  }
  setWebSocketAutoResponse() {}
}

console.log('--- Running AppSyncHub Tests ---');

await asyncTest('AppSyncHub initializes with default state and recovers sequence from storage', async () => {
  const storage = new MockStorage({ seq: 42, replayBuffer: [{ id: 42, topic: 'system', event: 'init' }] });
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});

  // Wait for restore
  await hub.initPromise;
  assert.equal(hub.seq, 42);
  assert.equal(hub.replayBuffer.length, 1);
  assert.equal(hub.replayBuffer[0].id, 42);
});

await asyncTest('AppSyncHub monotonic sequence and 100-event FIFO sliding buffer overflow', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Push 125 events
  for (let i = 1; i <= 125; i++) {
    await hub.fetch(new Request('https://hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'tasks',
        event: 'task:updated',
        payload: { task_id: i, title: `Task ${i}` },
        actor_id: 1,
      }),
    }));
  }

  assert.equal(hub.seq, 125, 'Sequence counter should be 125');
  assert.equal(hub.replayBuffer.length, 100, 'Replay buffer size should cap at 100');
  assert.equal(hub.replayBuffer[0].seq, 26, 'Oldest event in buffer should have seq 26');
  assert.equal(hub.replayBuffer[99].seq, 125, 'Newest event in buffer should have seq 125');
});

await asyncTest('AppSyncHub WebSocket replay batch on reconnect with last_seq', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Push 10 events
  for (let i = 1; i <= 10; i++) {
    await hub.fetch(new Request('https://hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'tasks',
        event: 'task:created',
        payload: { task_id: i },
      }),
    }));
  }

  const session = { userId: 1, role: 'admin', topics: ['tasks'] };
  const ws = new MockWebSocket(session);
  // Client reconnects having seen up to seq 7
  hub.handleReplay(ws, session, 7);

  assert.equal(ws.sent.length, 1, 'Should send replay:batch');
  assert.equal(ws.sent[0].type, 'replay:batch');
  assert.equal(ws.sent[0].events.length, 3, 'Should replay events 8, 9, 10');
  assert.equal(ws.sent[0].events[0].seq, 8);
  assert.equal(ws.sent[0].events[2].seq, 10);
  assert.equal(ws.sent[0].currentSeq, 10);
});

await asyncTest('AppSyncHub WebSocket replay:overflow when client is too far behind buffer', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Push 120 events
  for (let i = 1; i <= 120; i++) {
    await hub.fetch(new Request('https://hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'tasks', event: 'task:ping', payload: {} }),
    }));
  }

  const session = { userId: 1, role: 'admin', topics: ['tasks'] };
  const ws = new MockWebSocket(session);
  // Buffer has 21..120. Client asks for seq 5.
  hub.handleReplay(ws, session, 5);

  assert.equal(ws.sent.length, 1);
  assert.equal(ws.sent[0].type, 'replay:overflow');
  assert.equal(ws.sent[0].oldestAvailableSeq, 21);
  assert.equal(ws.sent[0].currentSeq, 120);
});

await asyncTest('AppSyncHub topic subscription filtering', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // WS 1 subscribed only to 'chat'
  const wsChat = new MockWebSocket({ userId: 10, userRole: 'employee', topics: ['chat'] });
  // WS 2 subscribed to 'tasks' and 'attendance'
  const wsTasks = new MockWebSocket({ userId: 20, userRole: 'employee', topics: ['tasks', 'attendance'] });

  ctx.acceptWebSocket(wsChat);
  ctx.acceptWebSocket(wsTasks);

  // Broadcast a 'tasks' event
  await hub.fetch(new Request('https://hub.internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: 'tasks',
      event: 'task:created',
      payload: { id: 100, title: 'New Task' },
    }),
  }));

  assert.equal(wsChat.sent.length, 0, 'Chat WS should not receive tasks event');
  assert.equal(wsTasks.sent.length, 1, 'Tasks WS should receive tasks event');
  assert.equal(wsTasks.sent[0].topic, 'tasks');
  assert.equal(wsTasks.sent[0].event, 'task:created');
  assert.equal(wsTasks.sent[0].payload.id, 100);
});

await asyncTest('AppSyncHub targetUserIds visibility filtering', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  const wsUser1 = new MockWebSocket({ userId: 1, userRole: 'employee', topics: ['leave'] });
  const wsUser2 = new MockWebSocket({ userId: 2, userRole: 'employee', topics: ['leave'] });
  const wsUser3 = new MockWebSocket({ userId: 3, userRole: 'employee', topics: ['leave'] });

  ctx.acceptWebSocket(wsUser1);
  ctx.acceptWebSocket(wsUser2);
  ctx.acceptWebSocket(wsUser3);

  // Broadcast targeting only user 1 and user 2
  await hub.fetch(new Request('https://hub.internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: 'leave',
      event: 'leave:approved',
      payload: { leave_id: 55 },
      target_user_ids: [1, 2],
    }),
  }));

  assert.equal(wsUser1.sent.length, 1, 'User 1 should receive targeted broadcast');
  assert.equal(wsUser2.sent.length, 1, 'User 2 should receive targeted broadcast');
  assert.equal(wsUser3.sent.length, 0, 'User 3 should NOT receive broadcast targeted to [1, 2]');
});

await asyncTest('AppSyncHub stats endpoint returns accurate metrics', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  const ws = new MockWebSocket({ userId: 1, userRole: 'admin', topics: ['chat', 'tasks'] });
  ctx.acceptWebSocket(ws);

  await hub.fetch(new Request('https://hub.internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'chat', event: 'chat:message_created', payload: {} }),
  }));

  const res = await hub.fetch(new Request('https://hub.internal/api/realtime/stats'));
  assert.equal(res.status, 200);
  const stats = await res.json();

  assert.equal(stats.seq, 1);
  assert.equal(stats.buffer_size, 1);
  assert.equal(stats.active_connections, 1);
  assert(stats.topics_active.includes('chat'));
  assert(stats.topics_active.includes('tasks'));
});

await asyncTest('AppSyncHub SSE connection and streaming response', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Connect SSE with topics parameter
  const sseReq = new Request('https://hub.internal/api/realtime/events?topics=tasks,notifications', {
    headers: {
      'Accept': 'text/event-stream',
    },
  });

  const res = await hub.handleSSE(sseReq, { id: 99, role: 'employee' });
  assert.equal(res.status, 200);
  assert(res.headers.get('Content-Type').includes('text/event-stream'));
  assert(res.headers.get('Cache-Control').includes('no-cache'));
  assert.equal(hub.sseClients.size, 1, 'SSE client registered');
});

await asyncTest('broadcastAppEvent helper works with env.SYNC_HUB stub and handles errors safely', async () => {
  let broadcastCalled = false;
  let receivedData = null;

  const mockStub = {
    fetch: async (url, options) => {
      broadcastCalled = true;
      receivedData = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true, id: 1 }), { status: 200 });
    },
  };

  const mockEnv = {
    SYNC_HUB: {
      idFromName: (name) => name,
      get: (id) => mockStub,
    },
  };

  // Test standard call signature
  const res = await broadcastAppEvent(mockEnv, 'tasks', 'task:created', { id: 50, title: 'Sample' }, { actorId: 9 });
  assert.equal(Boolean(res && res.ok), true);
  assert.equal(broadcastCalled, true);
  assert.equal(receivedData.topic, 'tasks');
  assert.equal(receivedData.event, 'task:created');
  assert.equal(receivedData.payload.id, 50);
  assert.equal(receivedData.actor_id, 9);

  // Test fault tolerance when SYNC_HUB is null or throws
  const badEnv = {
    SYNC_HUB: {
      idFromName: () => { throw new Error('DO unreachable'); },
      get: () => {},
    },
  };
  // Should NOT throw, returns { ok: false, ... } gracefully
  const failRes = await broadcastAppEvent(badEnv, 'tasks', 'task:deleted', { id: 50 });
  assert.equal(failRes.ok, false);

  // Test empty env
  const emptyRes = await broadcastAppEvent({}, 'tasks', 'task:deleted', { id: 50 });
  assert.equal(emptyRes.ok, false);
});

console.log(`\nAll ${passed} AppSyncHub test cases passed successfully!`);
