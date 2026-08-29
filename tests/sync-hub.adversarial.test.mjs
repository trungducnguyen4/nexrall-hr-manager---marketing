// tests/sync-hub.adversarial.test.mjs
// ============================================================================
// EMPIRICAL CHALLENGER STRESS & ADVERSARIAL TEST SUITE FOR AppSyncHub
// ============================================================================

import assert from 'node:assert/strict';
import { AppSyncHub } from '../src/sync-hub.js';
import { broadcastAppEvent } from '../server.js';

let passed = 0;
let total = 0;

async function runTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  [PASS] Test ${total}: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] Test ${total}: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ── Mock Helpers for DO Hibernation, Storage, DB & WebSockets ──────────────

class MockStorage {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
    this.putCalls = 0;
  }
  async get(key) {
    if (Array.isArray(key)) {
      const res = new Map();
      for (const k of key) {
        if (this.data.has(k)) res.set(k, this.data.get(k));
      }
      return res;
    }
    return this.data.get(key);
  }
  async put(key, value) {
    this.putCalls++;
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
  constructor(initialAttachment = null, shouldThrowOnSend = false) {
    this.attachment = initialAttachment;
    this.sent = [];
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
    this.shouldThrowOnSend = shouldThrowOnSend;
  }
  send(msg) {
    if (this.shouldThrowOnSend) {
      throw new Error('WebSocket connection broken / EPIPE');
    }
    if (this.closed) {
      throw new Error('Cannot send on closed WebSocket');
    }
    this.sent.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
  }
  close(code = 1000, reason = '') {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
  serializeAttachment(data) {
    // Deep clone to simulate real serialization
    this.attachment = JSON.parse(JSON.stringify(data));
  }
  deserializeAttachment() {
    return this.attachment ? JSON.parse(JSON.stringify(this.attachment)) : null;
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

class MockD1DB {
  constructor(users = [], sessions = []) {
    this.users = new Map(users.map(u => [u.id, u]));
    this.sessions = new Map(sessions.map(s => [s.token, s]));
  }
  prepare(query) {
    const db = this;
    return {
      bind(...params) {
        return {
          async first() {
            const token = params[0];
            const session = db.sessions.get(token);
            if (!session || session.revoked) return null;
            if (session.expires_at <= Math.floor(Date.now() / 1000)) return null;
            const user = db.users.get(session.user_id);
            if (!user) return null;
            return {
              id: user.id,
              full_name: user.full_name,
              role: user.role,
              department: user.department,
              employee_code: user.employee_code,
              is_active: user.is_active,
            };
          }
        };
      }
    };
  }
}

console.log('================================================================');
console.log('STARTING EMPIRICAL CHALLENGER ADVERSARIAL STRESS SUITE (M1_1)');
console.log('================================================================\n');

// ── 1. High-Frequency Interleaved Broadcasts & Concurrency ─────────────────

await runTest('1. High-Frequency Interleaved Broadcasts (500 events across 50 sessions)', async () => {
  const users = [];
  const sessions = [];
  for (let i = 1; i <= 50; i++) {
    users.push({
      id: i,
      full_name: `User ${i}`,
      role: i === 1 ? 'admin' : 'employee',
      department: 'Engineering',
      employee_code: `EMP${i}`,
      is_active: 1,
    });
    sessions.push({
      token: `token_${i}`,
      user_id: i,
      revoked: 0,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
  }

  const db = new MockD1DB(users, sessions);
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, { DB: db });
  await hub.initPromise;

  // Create 50 distinct sessions with varying topic subscriptions
  const sessionsCount = 50;
  const clientSockets = [];
  const topicsPool = ['tasks', 'chat', 'leave', 'attendance', 'payroll', 'notifications', 'users'];

  for (let i = 1; i <= sessionsCount; i++) {
    const sessionTopics = i % 5 === 0 ? ['*'] : [topicsPool[i % topicsPool.length], topicsPool[(i + 1) % topicsPool.length]];
    const ws = new MockWebSocket();
    ctx.acceptWebSocket(ws);
    
    // Genuinely authenticate via DB token
    await hub.webSocketMessage(ws, JSON.stringify({
      type: 'auth',
      token: `token_${i}`,
      topics: sessionTopics,
    }));

    assert.equal(ws.sent.length, 1, `WS ${i} should have auth:ok frame`);
    assert.equal(ws.sent[0].type, 'auth:ok');

    const session = hub.sessions.get(ws);
    assert(session, `Session for user ${i} must exist in hub`);
    clientSockets.push({ ws, session, id: i });
  }

  assert.equal(hub.sessions.size, 50, 'All 50 sessions should be active in memory');

  // Fire 500 interleaved asynchronous broadcasts concurrently
  const totalEvents = 500;
  const broadcastPromises = [];

  for (let i = 1; i <= totalEvents; i++) {
    const topic = topicsPool[i % topicsPool.length];
    const promise = hub.broadcast({
      topic,
      event: `${topic}:updated`,
      payload: { index: i, timestamp: Date.now() },
      actorId: (i % sessionsCount) + 1,
    });
    broadcastPromises.push(promise);
  }

  const results = await Promise.all(broadcastPromises);

  // Assertions on sequence monotonicity and completeness
  assert.equal(hub.seq, 500, 'Sequence counter must reach exactly 500');
  assert.equal(results.length, 500, 'All 500 broadcast promises must resolve');
  
  // Verify strict sequence assignment without duplicates
  const assignedSeqs = results.map(r => r.seq);
  const uniqueSeqs = new Set(assignedSeqs);
  assert.equal(uniqueSeqs.size, 500, 'Every broadcast must receive a unique sequence number');
  assert.equal(Math.min(...assignedSeqs), 1, 'First sequence number must be 1');
  assert.equal(Math.max(...assignedSeqs), 500, 'Last sequence number must be 500');

  // Verify replay buffer size caps at exactly 100
  assert.equal(hub.replayBuffer.length, 100, 'Replay buffer must be capped at maxBufferSize=100');
  assert.equal(hub.replayBuffer[0].seq, 401, 'Oldest event in sliding buffer must be seq 401');
  assert.equal(hub.replayBuffer[99].seq, 500, 'Newest event in sliding buffer must be seq 500');

  // Verify message delivery ordering on wildcard clients (subscribed to '*')
  // Notice ws.sent has 1 auth:ok message followed by 500 broadcast messages = 501 messages
  const wildcardClient = clientSockets.find(c => c.session.topics.includes('*'));
  assert(wildcardClient, 'Wildcard client must exist');
  assert.equal(wildcardClient.ws.sent.length, 501, 'Wildcard client must receive auth:ok + 500 events');

  // Verify events 1..500 are in strictly increasing order
  for (let j = 1; j < wildcardClient.ws.sent.length; j++) {
    const evt = wildcardClient.ws.sent[j];
    assert.equal(evt.seq, j, `Event at position ${j} must have seq ${j}`);
  }
});

// ── 2. Replay Buffer Boundary Conditions & Edge Cases ──────────────────────

await runTest('2.1 Replay buffer boundary: Replaying exactly at 100-event window boundary', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Push 200 events (buffer will hold 101..200)
  for (let i = 1; i <= 200; i++) {
    await hub.broadcast({
      topic: 'tasks',
      event: 'task:created',
      payload: { id: i },
      actorId: 1,
    });
  }

  assert.equal(hub.seq, 200);
  assert.equal(hub.replayBuffer.length, 100);
  assert.equal(hub.replayBuffer[0].seq, 101);
  assert.equal(hub.replayBuffer[99].seq, 200);

  const session = { userId: 1, topics: ['tasks'] };
  
  // Boundary Case A: Client at lastEventSeq = 100 (exactly oldestSeq - 1)
  // This is the EXACT limit where replay can succeed without overflow!
  const wsExactBoundary = new MockWebSocket(session);
  hub.handleReplay(wsExactBoundary, session, 100);

  assert.equal(wsExactBoundary.sent.length, 1);
  assert.equal(wsExactBoundary.sent[0].type, 'replay:batch');
  assert.equal(wsExactBoundary.sent[0].replayedCount, 100, 'Should replay all 100 available events');
  assert.equal(wsExactBoundary.sent[0].events[0].seq, 101);
  assert.equal(wsExactBoundary.sent[0].events[99].seq, 200);
  assert.equal(wsExactBoundary.sent[0].currentSeq, 200);

  // Boundary Case B: Client at lastEventSeq = 99 (1 event beyond boundary)
  // MUST trigger replay:overflow
  const wsOverflowBoundary = new MockWebSocket(session);
  hub.handleReplay(wsOverflowBoundary, session, 99);

  assert.equal(wsOverflowBoundary.sent.length, 1);
  assert.equal(wsOverflowBoundary.sent[0].type, 'replay:overflow');
  assert.equal(wsOverflowBoundary.sent[0].oldestAvailableSeq, 101);
  assert.equal(wsOverflowBoundary.sent[0].currentSeq, 200);
});

await runTest('2.2 Replay buffer boundary: Zero sequence replay, future sequence, and string sequence', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Case A: When buffer has 50 events (seq 1..50, no overflow yet)
  for (let i = 1; i <= 50; i++) {
    await hub.broadcast({ topic: 'chat', event: 'chat:message', payload: { i } });
  }

  const session = { userId: 2, topics: ['chat'] };

  // Replay from seq 0 when buffer starts at 1 (0 == 1 - 1 -> should NOT overflow, should replay 1..50)
  const wsZero = new MockWebSocket(session);
  hub.handleReplay(wsZero, session, 0);
  assert.equal(wsZero.sent.length, 1);
  assert.equal(wsZero.sent[0].type, 'replay:batch');
  assert.equal(wsZero.sent[0].replayedCount, 50);

  // Replay from current sequence (50) -> should return replay:complete with 0 events
  const wsCaughtUp = new MockWebSocket(session);
  hub.handleReplay(wsCaughtUp, session, 50);
  assert.equal(wsCaughtUp.sent.length, 1);
  assert.equal(wsCaughtUp.sent[0].type, 'replay:complete');
  assert.equal(wsCaughtUp.sent[0].replayedCount, 0);

  // Replay from future sequence (999) -> should return replay:complete with 0 events
  const wsFuture = new MockWebSocket(session);
  hub.handleReplay(wsFuture, session, 999);
  assert.equal(wsFuture.sent.length, 1);
  assert.equal(wsFuture.sent[0].type, 'replay:complete');
  assert.equal(wsFuture.sent[0].replayedCount, 0);

  // Replay with string parameter '40'
  const wsStringSeq = new MockWebSocket(session);
  hub.handleReplay(wsStringSeq, session, '40');
  assert.equal(wsStringSeq.sent.length, 1);
  assert.equal(wsStringSeq.sent[0].type, 'replay:batch');
  assert.equal(wsStringSeq.sent[0].replayedCount, 10);
  assert.equal(wsStringSeq.sent[0].events[0].seq, 41);

  // Replay with invalid/NaN sequence (e.g. 'invalid_seq')
  const wsNaNSeq = new MockWebSocket(session);
  hub.handleReplay(wsNaNSeq, session, 'invalid_seq');
  // clientSeq = Number('invalid_seq' || 0) -> NaN. Should not throw.
  assert.equal(wsNaNSeq.sent.length, 1);
});

// ── 3. Connection Hibernation & State Serialization Recovery ────────────────

await runTest('3. Connection Hibernation & State Serialization Lifecycle', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Create 5 sockets with different subscriptions and attachments
  const sockets = [];
  for (let i = 1; i <= 5; i++) {
    const ws = new MockWebSocket();
    const session = {
      userId: i * 10,
      userName: `Employee ${i}`,
      userRole: 'employee',
      department: 'Marketing',
      employeeCode: `EMP00${i}`,
      topics: i === 1 ? ['tasks'] : (i === 2 ? ['chat'] : ['leave', 'attendance']),
      connectedAt: new Date().toISOString(),
      lastPingAt: Date.now(),
    };
    ws.serializeAttachment(session);
    ctx.acceptWebSocket(ws);
    hub.sessions.set(ws, session);
    sockets.push({ ws, session });
  }

  assert.equal(hub.sessions.size, 5);

  // SIMULATE HIBERNATION:
  // In Cloudflare Workers, when DO hibernates, the JS environment is evicted from memory.
  // When a new event arrives or DO wakes up, this.sessions is empty in new instance,
  // but ctx.getWebSockets() returns the open sockets with serialized attachments!
  hub.sessions.clear();
  assert.equal(hub.sessions.size, 0, 'In-memory sessions wiped during hibernation');

  // Trigger restoreSessions explicitly (as done on wakeup / constructor)
  hub.restoreSessions();
  assert.equal(hub.sessions.size, 5, 'All 5 sessions must be restored from WebSocket attachments');

  // Verify topics and userIds were preserved exactly
  const restoredSession1 = hub.sessions.get(sockets[0].ws);
  assert.equal(restoredSession1.userId, 10);
  assert.deepEqual(restoredSession1.topics, ['tasks']);

  const restoredSession2 = hub.sessions.get(sockets[1].ws);
  assert.equal(restoredSession2.userId, 20);
  assert.deepEqual(restoredSession2.topics, ['chat']);

  // Test subscription modification updates attachment
  hub.handleSubscribe(sockets[0].ws, restoredSession1, { topics: ['notifications'] });
  const updatedAttachment = sockets[0].ws.deserializeAttachment();
  assert(updatedAttachment.topics.includes('tasks'));
  assert(updatedAttachment.topics.includes('notifications'), 'Attachment must reflect updated subscriptions');

  // Test dynamic recovery during broadcast if socket was not in sessions map
  hub.sessions.delete(sockets[1].ws); // Simulate socket woke up without constructor restore
  await hub.broadcast({ topic: 'chat', event: 'chat:msg', payload: { text: 'Hello' } });
  assert.equal(sockets[1].ws.sent.length, 1, 'Socket must be dynamically restored and receive broadcast');
  assert.equal(hub.sessions.has(sockets[1].ws), true, 'Socket must be added back to sessions map');
});

// ── 4. Malformed Payloads, Unauthenticated Sockets & Security Isolation ─────

await runTest('4.1 Unauthenticated WebSocket message rejection & auth enforcement', async () => {
  const db = new MockD1DB(
    [
      { id: 1, full_name: 'Active User', role: 'admin', department: 'IT', employee_code: 'A01', is_active: 1 },
      { id: 2, full_name: 'Disabled User', role: 'employee', department: 'HR', employee_code: 'D01', is_active: 0 },
    ],
    [
      { token: 'valid_token_1', user_id: 1, revoked: 0, expires_at: Math.floor(Date.now() / 1000) + 3600 },
      { token: 'expired_token', user_id: 1, revoked: 0, expires_at: Math.floor(Date.now() / 1000) - 3600 },
      { token: 'revoked_token', user_id: 1, revoked: 1, expires_at: Math.floor(Date.now() / 1000) + 3600 },
      { token: 'disabled_user_token', user_id: 2, revoked: 0, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    ]
  );

  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, { DB: db });
  await hub.initPromise;

  // Unauthenticated client sending subscribe
  const wsUnauth = new MockWebSocket();
  ctx.acceptWebSocket(wsUnauth);
  await hub.webSocketMessage(wsUnauth, JSON.stringify({ type: 'subscribe', topics: ['tasks'] }));
  assert.equal(wsUnauth.sent.length, 1);
  assert.equal(wsUnauth.sent[0].type, 'auth:error');
  assert.equal(wsUnauth.sent[0].code, 'UNAUTHORIZED');

  // Client with missing token
  const wsNoToken = new MockWebSocket();
  await hub.webSocketMessage(wsNoToken, JSON.stringify({ type: 'auth' }));
  assert.equal(wsNoToken.sent[0].type, 'auth:error');
  assert.equal(wsNoToken.closed, true);

  // Client with expired token
  const wsExpired = new MockWebSocket();
  await hub.webSocketMessage(wsExpired, JSON.stringify({ type: 'auth', token: 'expired_token' }));
  assert.equal(wsExpired.sent[0].type, 'auth:error');
  assert.equal(wsExpired.closed, true);

  // Client with revoked token
  const wsRevoked = new MockWebSocket();
  await hub.webSocketMessage(wsRevoked, JSON.stringify({ type: 'auth', token: 'revoked_token' }));
  assert.equal(wsRevoked.sent[0].type, 'auth:error');
  assert.equal(wsRevoked.closed, true);

  // Client with inactive user account
  const wsInactive = new MockWebSocket();
  await hub.webSocketMessage(wsInactive, JSON.stringify({ type: 'auth', token: 'disabled_user_token' }));
  assert.equal(wsInactive.sent[0].type, 'auth:error');
  assert.equal(wsInactive.closed, true);

  // Valid client authentication
  const wsValid = new MockWebSocket();
  await hub.webSocketMessage(wsValid, JSON.stringify({ type: 'auth', token: 'valid_token_1', topics: ['tasks', 'attendance'] }));
  assert.equal(wsValid.sent[0].type, 'auth:ok');
  assert.equal(wsValid.sent[0].userId, 1);
  assert.equal(wsValid.closed, false);
  assert.equal(hub.sessions.has(wsValid), true);
});

await runTest('4.2 Malformed WebSocket messages, non-JSON buffers, and error resilience', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  const ws = new MockWebSocket();
  ctx.acceptWebSocket(ws);

  // Malformed JSON string
  await hub.webSocketMessage(ws, '{{{ NOT VALID JSON !!!');
  // Binary buffer with valid JSON
  const binaryMsg = new TextEncoder().encode(JSON.stringify({ type: 'ping', t: 12345 }));
  await hub.webSocketMessage(ws, binaryMsg);
  assert.equal(ws.sent.length, 1);
  assert.equal(ws.sent[0].type, 'pong');
  assert.equal(ws.sent[0].t, 12345);

  // Unknown message types
  await hub.webSocketMessage(ws, JSON.stringify({ type: '__unknown_command__', foo: 'bar' }));
  // Should safely do nothing without crashing
});

await runTest('4.3 Malformed broadcast payloads & targetUserIds sanitization', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  const wsUser1 = new MockWebSocket({ userId: 1, topics: ['*'] });
  const wsUser2 = new MockWebSocket({ userId: 2, topics: ['*'] });
  const wsUser3 = new MockWebSocket({ userId: 3, topics: ['*'] });
  ctx.acceptWebSocket(wsUser1);
  ctx.acceptWebSocket(wsUser2);
  ctx.acceptWebSocket(wsUser3);
  hub.sessions.set(wsUser1, wsUser1.attachment);
  hub.sessions.set(wsUser2, wsUser2.attachment);
  hub.sessions.set(wsUser3, wsUser3.attachment);

  // Broadcast with malformed/dirty targetUserIds: contains strings, floats, negative numbers, nulls
  await hub.broadcast({
    topic: 'tasks',
    event: 'task:special',
    payload: null,
    actorId: '10',
    targetUserIds: [1, '2', -5, 0, null, undefined, 'abc', 3.14],
  });

  // Target user IDs should sanitize to [1, 2]
  assert.equal(wsUser1.sent.length, 1, 'User 1 should receive event');
  assert.equal(wsUser2.sent.length, 1, 'User 2 should receive event (coerced from string "2")');
  assert.equal(wsUser3.sent.length, 0, 'User 3 should NOT receive event');

  // Verify envelope shape of received event with payload: null
  const received = wsUser1.sent[0];
  assert.equal(received.topic, 'tasks');
  assert.equal(received.actor_id, 10);
  assert.equal(received.actorId, 10);
  assert.equal(received.payload, null, 'Explicit null payload should be preserved');
  assert.deepEqual(received.targetUserIds, [1, 2]);

  // Also test broadcast with undefined payload -> defaults to {}
  await hub.broadcast({
    topic: 'chat',
    event: 'chat:msg',
    actor_id: 5,
  });
  const received2 = wsUser1.sent[1];
  assert.deepEqual(received2.payload, {}, 'Omitted payload should default to {}');
});

await runTest('4.4 Broken socket fault tolerance during broadcast', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  // Sockets: 1 healthy, 1 broken (throws on send), 1 healthy
  const wsHealthy1 = new MockWebSocket({ userId: 1, topics: ['*'] });
  const wsBroken = new MockWebSocket({ userId: 2, topics: ['*'] }, true); // throws on send
  const wsHealthy2 = new MockWebSocket({ userId: 3, topics: ['*'] });

  ctx.acceptWebSocket(wsHealthy1);
  ctx.acceptWebSocket(wsBroken);
  ctx.acceptWebSocket(wsHealthy2);
  hub.sessions.set(wsHealthy1, wsHealthy1.attachment);
  hub.sessions.set(wsBroken, wsBroken.attachment);
  hub.sessions.set(wsHealthy2, wsHealthy2.attachment);

  assert.equal(hub.sessions.size, 3);

  // Broadcast event
  const res = await hub.broadcast({ topic: 'tasks', event: 'task:updated', payload: { test: true } });
  assert.equal(res.ok, true);

  // Broken socket must be pruned from sessions without interrupting healthy sockets
  assert.equal(hub.sessions.size, 2, 'Broken socket must be automatically removed from sessions');
  assert.equal(hub.sessions.has(wsBroken), false);
  assert.equal(wsHealthy1.sent.length, 1);
  assert.equal(wsHealthy2.sent.length, 1);
});

// ── 5. Memory Leaks, SSE Lifecycle & Long-Term Stability ───────────────────

await runTest('5.1 Memory leak check: Session cleanup on WebSocket close and error', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  const sockets = [];
  for (let i = 1; i <= 100; i++) {
    const ws = new MockWebSocket({ userId: i, topics: ['tasks'] });
    ctx.acceptWebSocket(ws);
    hub.sessions.set(ws, ws.attachment);
    sockets.push(ws);
  }

  assert.equal(hub.sessions.size, 100);

  // Close half with webSocketClose, half with webSocketError
  for (let i = 0; i < 50; i++) {
    await hub.webSocketClose(sockets[i], 1000, 'Normal closure');
  }
  for (let i = 50; i < 100; i++) {
    await hub.webSocketError(sockets[i], new Error('Socket reset by peer'));
  }

  assert.equal(hub.sessions.size, 0, 'All closed and errored sockets must be completely cleaned up');
});

await runTest('5.2 Memory leak check: SSE connection abort and interval timer cleanup', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  const abortControllers = [];
  const sseClientsCount = 20;

  for (let i = 1; i <= sseClientsCount; i++) {
    const ac = new AbortController();
    abortControllers.push(ac);
    const req = new Request(`https://hub.internal/api/realtime/events?topics=tasks`, {
      signal: ac.signal,
    });
    await hub.handleSSE(req, { id: i, role: 'employee' });
  }

  assert.equal(hub.sseClients.size, 20, '20 SSE clients connected');

  // Broadcast an event to all SSE clients
  await hub.broadcast({ topic: 'tasks', event: 'task:ping', payload: {} });

  // Abort all SSE connections
  for (const ac of abortControllers) {
    ac.abort();
  }

  assert.equal(hub.sseClients.size, 0, 'All SSE clients and keepalive timers must be cleaned up on abort');
});

await runTest('5.3 Long-term buffer stability (1,000 broadcasts stress test)', async () => {
  const storage = new MockStorage();
  const ctx = new MockDOContext(storage);
  const hub = new AppSyncHub(ctx, {});
  await hub.initPromise;

  for (let i = 1; i <= 1000; i++) {
    await hub.broadcast({
      topic: 'chat',
      event: 'chat:message',
      payload: { index: i, text: `Message ${i}` },
      actorId: 1,
    });
  }

  assert.equal(hub.seq, 1000);
  assert.equal(hub.replayBuffer.length, 100, 'Buffer must never exceed 100 items');
  assert.equal(hub.replayBuffer[0].seq, 901);
  assert.equal(hub.replayBuffer[99].seq, 1000);
});

console.log('\n================================================================');
console.log(`ALL ${passed}/${total} ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY!`);
console.log('================================================================');
process.exit(0);
