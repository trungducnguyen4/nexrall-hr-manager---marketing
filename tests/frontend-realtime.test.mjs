// ═════════════════════════════════════════════════════════════════════
//  Frontend Real-Time & Reactive Event Bus Unit & Integration Suite
// ═════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { EventBusClass, EventBus } from '../src/event-bus.js';
import { RealtimeClient } from '../src/realtime.js';
import { _cache, invalidateCache, clearCache, TOPIC_CACHE_MAP, setupCacheInvalidation } from '../src/api.js';

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('🧪 Starting Frontend Real-Time & Reactive Event Bus Test Suite...\n');

// ═════════════════════════════════════════════════════════════════════
//  1. EventBus Unit Tests
// ═════════════════════════════════════════════════════════════════════
console.log('--- 1. EventBus Core Mechanics & Wildcards ---');

test('EventBus.on registers handler and receives exact match emit', () => {
  const bus = new EventBusClass();
  let received = null;
  const unsub = bus.on('tasks:created', (data) => {
    received = data;
  });

  const count = bus.emit('tasks:created', { id: 101, title: 'Test Task' });
  assert.equal(count, 1);
  assert.deepEqual(received, { id: 101, title: 'Test Task' });

  unsub();
  assert.equal(bus.emit('tasks:created', { id: 102 }), 0);
});

test('EventBus.off removes handler explicitly', () => {
  const bus = new EventBusClass();
  let calls = 0;
  const handler = () => { calls++; };

  bus.on('chat:message', handler);
  bus.emit('chat:message', {});
  assert.equal(calls, 1);

  bus.off('chat:message', handler);
  bus.emit('chat:message', {});
  assert.equal(calls, 1);
});

test('EventBus.once fires exactly once and auto-unregisters', () => {
  const bus = new EventBusClass();
  let count = 0;
  bus.once('leave:approved', (data) => {
    count++;
  });

  bus.emit('leave:approved', { id: 1 });
  bus.emit('leave:approved', { id: 2 });
  bus.emit('leave:approved', { id: 3 });

  assert.equal(count, 1);
  assert.equal(bus.listenerCount('leave:approved'), 0);
});

test('EventBus wildcard prefix matching (e.g., tasks:* receives tasks:created and tasks:deleted)', () => {
  const bus = new EventBusClass();
  const received = [];

  bus.on('tasks:*', (data, topic) => {
    received.push({ topic, data });
  });

  bus.emit('tasks:created', { id: 1 });
  bus.emit('tasks:deleted', { id: 2 });
  bus.emit('chat:message', { id: 3 }); // should NOT match

  assert.equal(received.length, 2);
  assert.equal(received[0].topic, 'tasks:created');
  assert.equal(received[1].topic, 'tasks:deleted');
});

test('EventBus global wildcard (*) receives all emitted topics', () => {
  const bus = new EventBusClass();
  const history = [];

  bus.on('*', (data, topic) => {
    history.push(topic);
  });

  bus.emit('attendance:checkin', {});
  bus.emit('payroll:published', {});
  bus.emit('users:updated', {});

  assert.deepEqual(history, ['attendance:checkin', 'payroll:published', 'users:updated']);
});

test('EventBus handles subscriber errors without crashing other subscribers', () => {
  const bus = new EventBusClass();
  let normalCalled = false;

  bus.on('test:event', () => {
    throw new Error('Explosion in handler!');
  });
  bus.on('test:event', () => {
    normalCalled = true;
  });

  const count = bus.emit('test:event', { foo: 'bar' });
  assert.equal(count, 2);
  assert.equal(normalCalled, true);
});

test('EventBus.listenerCount and clear() operate correctly', () => {
  const bus = new EventBusClass();
  bus.on('topicA', () => {});
  bus.on('topicA', () => {});
  bus.on('topicB', () => {});

  assert.equal(bus.listenerCount('topicA'), 2);
  assert.equal(bus.listenerCount('topicB'), 1);
  assert.equal(bus.listenerCount(), 3);

  bus.clear();
  assert.equal(bus.listenerCount(), 0);
});

// ═════════════════════════════════════════════════════════════════════
//  2. View Lifecycle & bindView Auto-Cleanup Tests
// ═════════════════════════════════════════════════════════════════════
console.log('\n--- 2. View Lifecycle & bindView Auto-Cleanup ---');

test('bindView attaches listener and automatically unbinds when viewNode._cleanup() runs', () => {
  const bus = new EventBusClass();
  const mockViewNode = { dataset: { view: 'tasks' } };
  let eventsReceived = 0;

  bus.bindView(mockViewNode, 'task:created', () => {
    eventsReceived++;
  });

  bus.emit('task:created', { id: 1 });
  assert.equal(eventsReceived, 1);

  // Simulate router tearing down view and executing _cleanup
  assert.equal(typeof mockViewNode._cleanup, 'function');
  mockViewNode._cleanup();

  bus.emit('task:created', { id: 2 });
  assert.equal(eventsReceived, 1); // No new events received after cleanup
});

test('bindView preserves and chains existing custom _cleanup logic on viewNode', () => {
  const bus = new EventBusClass();
  let customCleanupRan = false;
  let eventCount = 0;

  const mockViewNode = {
    _cleanup: () => {
      customCleanupRan = true;
    }
  };

  bus.bindView(mockViewNode, 'chat:message_created', () => {
    eventCount++;
  });

  bus.emit('chat:message_created', {});
  assert.equal(eventCount, 1);
  assert.equal(customCleanupRan, false);

  mockViewNode._cleanup();

  assert.equal(customCleanupRan, true);
  bus.emit('chat:message_created', {});
  assert.equal(eventCount, 1);
});

test('Multiple bindView calls on same viewNode all unregister upon cleanup', () => {
  const bus = new EventBusClass();
  const mockViewNode = {};
  let taskEvents = 0;
  let chatEvents = 0;
  let notifEvents = 0;

  bus.bindView(mockViewNode, 'tasks', () => { taskEvents++; });
  bus.bindView(mockViewNode, 'chat', () => { chatEvents++; });
  bus.bindView(mockViewNode, 'notifications', () => { notifEvents++; });

  bus.emit('tasks', {});
  bus.emit('chat', {});
  bus.emit('notifications', {});

  assert.equal(taskEvents, 1);
  assert.equal(chatEvents, 1);
  assert.equal(notifEvents, 1);

  mockViewNode._cleanup();

  bus.emit('tasks', {});
  bus.emit('chat', {});
  bus.emit('notifications', {});

  assert.equal(taskEvents, 1);
  assert.equal(chatEvents, 1);
  assert.equal(notifEvents, 1);
  assert.equal(bus.listenerCount(), 0);
});

// ═════════════════════════════════════════════════════════════════════
//  3. RealtimeClient Protocol, Sequence Tracking & Fallback
// ═════════════════════════════════════════════════════════════════════
console.log('\n--- 3. RealtimeClient Protocol, Sequence Tracking & Fallback ---');

test('RealtimeClient maintains monotonic sequence number (lastSeq)', () => {
  const client = new RealtimeClient();
  assert.equal(client.lastSeq, 0);

  client.lastSeq = 5;
  assert.equal(client.lastSeq, 5);

  // Incoming event with higher seq updates lastSeq
  client._dispatchServerEvent({ seq: 12, topic: 'tasks', event: 'task:created', payload: {} });
  assert.equal(client.lastSeq, 12);

  // Out of order lower seq does not decrease lastSeq
  client._dispatchServerEvent({ seq: 8, topic: 'tasks', event: 'task:updated', payload: {} });
  assert.equal(client.lastSeq, 12);
});

test('RealtimeClient pipes server events to EventBus with topic and event names', () => {
  const client = new RealtimeClient();
  let topicEvent = null;
  let exactEvent = null;
  let genericEvent = null;

  EventBus.on('attendance', (e) => { topicEvent = e; });
  EventBus.on('attendance:checkin', (e) => { exactEvent = e; });
  EventBus.on('realtime:event', (e) => { genericEvent = e; });

  const rawEnvelope = {
    id: 'evt_1724749200_1',
    seq: 42,
    topic: 'attendance',
    event: 'attendance:checkin',
    payload: { userId: 5, time: '08:30:00' },
    actorId: 5,
    timestamp: new Date().toISOString()
  };

  client._dispatchServerEvent(rawEnvelope);

  assert.deepEqual(topicEvent, rawEnvelope);
  assert.deepEqual(exactEvent, rawEnvelope);
  assert.deepEqual(genericEvent, rawEnvelope);
  assert.equal(client.lastSeq, 42);

  EventBus.clear();
});

test('RealtimeClient handles replay:batch and replay:overflow frames', () => {
  const client = new RealtimeClient();
  const replayedEvents = [];
  let overflowDetected = false;

  EventBus.on('realtime:overflow', () => { overflowDetected = true; });
  EventBus.on('tasks:created', (e) => { replayedEvents.push(e); });

  // Simulate replay:batch with missed events
  client._handleWsMessage({
    type: 'replay:batch',
    events: [
      { id: 'evt_1', seq: 10, topic: 'tasks', event: 'tasks:created', payload: { id: 1 } },
      { id: 'evt_2', seq: 11, topic: 'tasks', event: 'tasks:created', payload: { id: 2 } },
    ],
    replayedCount: 2,
    currentSeq: 11
  });

  assert.equal(replayedEvents.length, 2);
  assert.equal(client.lastSeq, 11);

  // Simulate replay:overflow
  client._handleWsMessage({
    type: 'replay:overflow',
    oldestAvailableSeq: 50,
    currentSeq: 150
  });

  assert.equal(overflowDetected, true);
  assert.equal(client.lastSeq, 150);

  EventBus.clear();
});

test('RealtimeClient WebSocket auth handshake and connection state', () => {
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sentMessages = [];
    }
    send(data) {
      this.sentMessages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }

  // Inject mock WebSocket into global scope
  globalThis.WebSocket = MockWebSocket;

  const client = new RealtimeClient();
  client.connect({
    user: { id: 1, full_name: 'Test User' },
    token: 'valid_test_token',
    topics: ['tasks', 'chat']
  });

  assert.equal(client.transport, 'ws');
  assert.equal(client.status, 'connecting');

  // Simulate onopen firing
  client.ws.readyState = 1;
  client.ws.onopen();
  assert.equal(client.ws.sentMessages.length, 1);
  assert.equal(client.ws.sentMessages[0].type, 'auth');
  assert.equal(client.ws.sentMessages[0].token, 'valid_test_token');
  assert.deepEqual(client.ws.sentMessages[0].topics.includes('tasks'), true);

  // Simulate server replying auth:ok
  let connectedNotified = false;
  EventBus.on('realtime:connected', (info) => {
    connectedNotified = true;
    assert.equal(info.transport, 'ws');
  });

  client._handleWsMessage({ type: 'auth:ok', userId: 1, currentSeq: 88 });
  assert.equal(client.status, 'connected');
  assert.equal(connectedNotified, true);
  assert.equal(client.lastSeq, 88);

  // Test ping/pong
  client.ws.sentMessages = [];
  client._startHeartbeat();
  // Trigger ping
  client._safeSendWs({ type: 'ping', t: Date.now() });
  assert.equal(client.ws.sentMessages[0].type, 'ping');

  // Receive pong
  client._handleWsMessage({ type: 'pong', t: Date.now() });
  assert.equal(client.pingTimeoutTimer, null);

  // Disconnect
  client.disconnect();
  assert.equal(client.status, 'disconnected');
  assert.equal(client.transport, 'none');

  EventBus.clear();
});

test('RealtimeClient fallback to SSE when WebSocket is unsupported or fails', () => {
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 0);
    }
    close() {
      this.readyState = 2;
    }
  }

  globalThis.EventSource = MockEventSource;
  // Simulate no WebSocket
  delete globalThis.WebSocket;

  const client = new RealtimeClient();
  client.connect({
    user: { id: 2, full_name: 'SSE User' },
    token: 'sse_token_123',
    topics: ['tasks', 'leave']
  });

  assert.equal(client.transport, 'sse');
  assert.equal(client.status, 'connecting');

  client.sse.onopen();
  assert.equal(client.status, 'connected');

  let leaveEvent = null;
  EventBus.on('leave:approved', (e) => { leaveEvent = e; });

  // Simulate SSE message arriving
  client.sse.onmessage({
    data: JSON.stringify({
      id: 'evt_sse_1',
      seq: 99,
      topic: 'leave',
      event: 'leave:approved',
      payload: { requestId: 10 }
    })
  });

  assert.deepEqual(leaveEvent, {
    id: 'evt_sse_1',
    seq: 99,
    topic: 'leave',
    event: 'leave:approved',
    payload: { requestId: 10 }
  });
  assert.equal(client.lastSeq, 99);

  client.disconnect();
  assert.equal(client.status, 'disconnected');

  EventBus.clear();
});

// ═════════════════════════════════════════════════════════════════════
//  4. API Cache Invalidation via Real-Time Events
// ═════════════════════════════════════════════════════════════════════
console.log('\n--- 4. Real-Time Cache Invalidation Integration ---');

test('EventBus events automatically invalidate mapped cache prefixes in _cache', () => {
  setupCacheInvalidation(EventBus);
  clearCache();

  // Populate cache with static and dynamic entries
  _cache.set('/api/leave-types', { data: ['annual', 'sick'], ts: Date.now() });
  _cache.set('/api/departments', { data: ['Engineering', 'HR'], ts: Date.now() });
  _cache.set('/api/wifi-whitelist', { data: ['Office-WiFi'], ts: Date.now() });
  _cache.set('/api/attendance-locations', { data: [{ id: 1, name: 'HQ' }], ts: Date.now() });
  _cache.set('/api/integrations/vietqr/banks', { data: ['VCB', 'TCB'], ts: Date.now() });

  assert.equal(_cache.size, 5);

  // 1. Emit leave event -> should clear /api/leave-types
  EventBus.emit('leave:approved', { id: 1 });
  assert.equal(_cache.has('/api/leave-types'), false);
  assert.equal(_cache.has('/api/departments'), true);
  assert.equal(_cache.has('/api/wifi-whitelist'), true);

  // 2. Emit attendance/wifi event -> should clear /api/wifi-whitelist and /api/attendance-locations
  EventBus.emit('attendance:checkin', { id: 2 });
  assert.equal(_cache.has('/api/wifi-whitelist'), false);
  assert.equal(_cache.has('/api/attendance-locations'), false);
  assert.equal(_cache.has('/api/departments'), true);

  // 3. Emit users event -> should clear /api/departments
  EventBus.emit('users', { event: 'user:updated', payload: {} });
  assert.equal(_cache.has('/api/departments'), false);

  // VietQR bank cache should remain untouched (not in dynamic invalidation mapping)
  assert.equal(_cache.has('/api/integrations/vietqr/banks'), true);

  clearCache();
});

test('TOPIC_CACHE_MAP contains expected domains and prefixes', () => {
  assert.ok(TOPIC_CACHE_MAP.leave.includes('/api/leave-types'));
  assert.ok(TOPIC_CACHE_MAP.departments.includes('/api/departments'));
  assert.ok(TOPIC_CACHE_MAP.attendance.includes('/api/attendance-locations'));
  assert.ok(TOPIC_CACHE_MAP.wifi.includes('/api/wifi-whitelist'));
  assert.ok(TOPIC_CACHE_MAP.tasks.includes('/api/tasks'));
});

// ═════════════════════════════════════════════════════════════════════
//  5. Advanced Resilience & Edge Cases
// ═════════════════════════════════════════════════════════════════════
console.log('\n--- 5. Advanced Resilience, Dead Socket Detection & Wake-Up ---');

test('RealtimeClient dynamically subscribes and unsubscribes topics over active WebSocket', () => {
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sentMessages = [];
    }
    send(data) {
      this.sentMessages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
  }

  globalThis.WebSocket = MockWebSocket;
  const client = new RealtimeClient();
  client.connect({
    user: { id: 1 },
    token: 'test_token',
    topics: ['tasks']
  });

  client._handleWsMessage({ type: 'auth:ok', userId: 1, currentSeq: 10 });
  assert.equal(client.status, 'connected');

  // Subscribe new topic
  client.subscribe('invoices');
  assert.ok(client.topics.has('invoices'));
  const lastSent = client.ws.sentMessages[client.ws.sentMessages.length - 1];
  assert.equal(lastSent.type, 'subscribe');
  assert.deepEqual(lastSent.topics, ['invoices']);

  // Unsubscribe topic
  client.unsubscribe('tasks');
  assert.equal(client.topics.has('tasks'), false);
  const unsubMsg = client.ws.sentMessages[client.ws.sentMessages.length - 1];
  assert.equal(unsubMsg.type, 'unsubscribe');
  assert.deepEqual(unsubMsg.topics, ['tasks']);

  client.disconnect();
});

test('RealtimeClient sends replay request on demand', () => {
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sentMessages = [];
    }
    send(data) {
      this.sentMessages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
  }

  globalThis.WebSocket = MockWebSocket;
  const client = new RealtimeClient();
  client.connect({ user: { id: 1 }, token: 'test_token' });
  client._handleWsMessage({ type: 'auth:ok', userId: 1, currentSeq: 20 });

  client.requestReplay(15);
  const replayMsg = client.ws.sentMessages[client.ws.sentMessages.length - 1];
  assert.equal(replayMsg.type, 'replay');
  assert.equal(replayMsg.lastEventSeq, 15);

  client.disconnect();
});

test('RealtimeClient tab visibility / window focus triggers connection health check', () => {
  let reconnectTriggered = false;
  const client = new RealtimeClient();
  client.user = { id: 1 };
  client.token = 'test_token';
  client.status = 'disconnected'; // was sleeping or disconnected
  client.isIntentionalDisconnect = false;

  // Mock connect
  client.connect = () => {
    reconnectTriggered = true;
  };

  // Trigger focus wakeup
  client._onVisibilityOrFocus();
  assert.equal(reconnectTriggered, true);
});

test('bindView gracefully returns unsub function if viewElement is null or undefined', () => {
  const bus = new EventBusClass();
  let called = false;
  const unsub = bus.bindView(null, 'test:null_node', () => {
    called = true;
  });

  bus.emit('test:null_node', {});
  assert.equal(called, true);
  unsub();
  assert.equal(bus.listenerCount('test:null_node'), 0);
});

test('EventBus.off without handler removes all listeners on specified topic', () => {
  const bus = new EventBusClass();
  bus.on('multi', () => {});
  bus.on('multi', () => {});
  assert.equal(bus.listenerCount('multi'), 2);

  bus.off('multi');
  assert.equal(bus.listenerCount('multi'), 0);
});

// ═════════════════════════════════════════════════════════════════════
//  Summary
// ═════════════════════════════════════════════════════════════════════
console.log(`\n======================================================`);
console.log(`🎉 ALL ${passedTests} FRONTEND REAL-TIME TESTS PASSED!`);
console.log(`======================================================\n`);
