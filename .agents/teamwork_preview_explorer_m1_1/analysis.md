# Technical Analysis & Architecture Design: Real-Time Sync Hub (Milestone 1)

**Author:** Explorer M1_1  
**Milestone:** Milestone 1 — Backend Real-Time Core & Broadcast Pipeline  
**Target Files:**  
- `src/sync-hub.js` (New Durable Object class: `AppSyncHub`)
- `wrangler.toml` (DO binding & migration tag)
- `worker.js` (Export `AppSyncHub` and request routing)
- `server.js` (Route integration for `/api/realtime/ws`, `/api/realtime/events`, `/api/realtime/stats`, and `broadcastAppEvent` helper)

---

## 1. System Context & Requirements Analysis

### 1.1 Problem Statement
The NetViet HR platform currently relies on one-way REST mutations and periodic polling or full page reloads (F5). When User A performs a mutation (e.g. creating/updating a task, submitting/approving leave, checking in attendance, posting comments, modifying roles), User B does not observe the change in real-time unless they manually refresh or switch views. While a conversational `ChatRoom` Durable Object exists for per-conversation chat messaging, there is no centralized, multi-tenant real-time synchronization hub for application-wide domain events across all 8 core feature domains:
1. Tasks & Subtasks CRUD & Reordering
2. Task Comments & Mentions
3. Chat Conversations & Unread Badges
4. Notifications & Live Badges
5. Attendance Check-in/out & Approvals
6. Leave Requests & Balances
7. Payroll & Overtime Records
8. User Profiles, Roles & Permissions

### 1.2 Architectural Solution
Milestone 1 introduces `AppSyncHub`, a singleton/tenant-scoped Cloudflare Durable Object utilizing Cloudflare's **Hibernation API**. `AppSyncHub` acts as the single source of truth for real-time event distribution:
- **WebSocket Hibernation**: Keeps thousands of persistent client connections alive at zero idle compute cost.
- **Session Serialization**: Persists authenticated user identity (`userId`, `role`, `department`, `topics`) directly on the WebSocket attachment across hibernation wakeups.
- **Monotonic Sliding Replay Buffer**: Maintains the last 100 domain events with monotonic sequence IDs (`seq`) and UTC timestamps. Reconnecting clients pass `lastEventSeq` to receive all missed events instantly without full page reload.
- **Bi-directional Heartbeats**: Ping/Pong handling with connection liveness tracking.
- **Internal Broadcast Pipeline**: Direct RPC and HTTP `POST /broadcast` endpoint for `server.js` mutations.
- **Fallback SSE Stream (`/api/realtime/events`)**: Unidirectional HTTP streaming for environments where WebSockets are blocked by proxies/firewalls.

---

## 2. Component Design & Specifications

### 2.1 Configuration: `wrangler.toml`
To register the new Durable Object and apply schema migrations:

```toml
# Chat: one Durable Object instance per conversation for WebSocket real-time.
[[durable_objects.bindings]]
name = "CHAT_ROOM"
class_name = "ChatRoom"

# AppSyncHub: Global Durable Object for real-time event distribution and client sync
[[durable_objects.bindings]]
name = "APP_SYNC_HUB"
class_name = "AppSyncHub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChatRoom"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["AppSyncHub"]
```

### 2.2 Worker Export & Integration: `worker.js`
`worker.js` must import `AppSyncHub` from `./src/sync-hub.js` and export it in the module exports:

```javascript
import { handle, handleScheduled } from './server.js';
import { ChatRoom } from './src/chat-room.js';
import { AppSyncHub } from './src/sync-hub.js';

// ... fetch and scheduled handlers ...

export { ChatRoom, AppSyncHub };
```

### 2.3 `AppSyncHub` Durable Object Architecture (`src/sync-hub.js`)

#### 2.3.1 Data Structures & State
1. **`this.sessions: Map<WebSocket, Session>`**: In-memory mapping of active WebSocket connections to user session attachments.
2. **`this.sseClients: Map<number, SseClient>`**: In-memory mapping of active SSE clients (`{ clientId, writer, session, keepAliveTimer }`).
3. **`this.replayBuffer: Array<RealtimeEvent>`**: Sliding FIFO buffer holding the last 100 events (`maxBufferSize = 100`).
4. **`this.seq: number`**: Monotonic increasing sequence counter, incremented for every broadcasted event.
5. **Persistence**: `this.seq` and `this.replayBuffer` are persisted to `this.ctx.storage` to survive DO evictions.

#### 2.3.2 WebSocket Lifecycle & Hibernation Protocol
- **Connection Acceptance**:
  ```javascript
  const [client, server] = Object.values(new WebSocketPair());
  this.ctx.acceptWebSocket(server);
  ```
- **Session Serialization**:
  When a client authenticates via token (checked against the D1 `sessions` table):
  ```javascript
  const session = {
    userId: user.id,
    userName: user.full_name || 'User',
    userRole: user.role || 'employee',
    department: user.department || '',
    topics: Array.isArray(msg.topics) && msg.topics.length > 0 ? msg.topics : ['*'],
    connectedAt: new Date().toISOString(),
    lastPingAt: Date.now(),
  };
  ws.serializeAttachment(session);
  this.sessions.set(ws, session);
  ```
- **Hibernation Restoration**:
  When waking up from hibernation, `this.restoreSessions()` iterates `this.ctx.getWebSockets()` and calls `ws.deserializeAttachment()` to re-populate `this.sessions`.

#### 2.3.3 Message Protocol (Client <-> Server)
| Direction | Message Type | Payload Structure | Purpose |
|---|---|---|---|
| Client -> DO | `auth` | `{ token: string, user_id?: number, lastEventSeq?: number, topics?: string[] }` | Authenticate connection & request missed events |
| DO -> Client | `auth:ok` | `{ type: 'auth:ok', userId: number, userName: string, currentSeq: number }` | Confirmation of valid session |
| DO -> Client | `auth:error` | `{ type: 'auth:error', message: string, code: string }` | Authentication failure (closes WS with code 4001) |
| Client -> DO | `ping` | `{ type: 'ping', t?: number }` | Heartbeat probe |
| DO -> Client | `pong` | `{ type: 'pong', t?: number, serverTime: number }` | Heartbeat response |
| Client -> DO | `subscribe` | `{ type: 'subscribe', topics: string[] }` | Subscribe to additional event topics |
| Client -> DO | `unsubscribe` | `{ type: 'unsubscribe', topics: string[] }` | Unsubscribe from event topics |
| Client -> DO | `replay` | `{ type: 'replay', lastEventSeq: number }` | Request missed events after reconnect |
| DO -> Client | `replay:batch` | `{ type: 'replay:batch', events: RealtimeEvent[], replayedCount: number, currentSeq: number }` | Missed events batch replay |
| DO -> Client | `replay:complete`| `{ type: 'replay:complete', replayedCount: number, currentSeq: number }` | Replay completed signal |
| DO -> Client | `replay:overflow`| `{ type: 'replay:overflow', oldestAvailableSeq: number, currentSeq: number }` | Missed events exceeded buffer; client must do full fetch |
| DO -> Client | `event` (Envelope) | `RealtimeEvent` (see below) | Real-time event push |

#### 2.3.4 Standard Event Envelope Contract
```typescript
interface RealtimeEvent<T = any> {
  id: string;               // Unique ID: 'evt_' + timestamp + '_' + seq + '_' + rand
  seq: number;              // Monotonic sequence number (1, 2, 3, ...)
  topic: string;            // 'tasks' | 'chat' | 'notifications' | 'attendance' | 'leave' | 'payroll' | 'users' | 'system'
  event: string;            // Specific event name: e.g. 'task:updated', 'leave:approved'
  payload: T;               // Domain data payload
  actorId: number;          // User ID who performed the mutation (0 for system)
  targetUserIds?: number[]; // Optional user whitelist (omitted for public/topic broadcast)
  timestamp: string;        // ISO 8601 UTC timestamp
}
```

#### 2.3.5 Event Filtering Logic (`isEventVisibleToSession`)
Before dispatching an event to any WebSocket or SSE client:
1. **Target User Check**: If `event.targetUserIds` is defined and non-empty, ensure `session.userId` is included in `event.targetUserIds`. If not, skip.
2. **Topic Subscription Check**: If `session.topics` does not include `'*'` or `'all'`, ensure `session.topics.includes(event.topic)`. If not, skip.

#### 2.3.6 Reconnection & Sliding Replay Buffer
- When an authenticated client provides `lastEventSeq`:
  - If `lastEventSeq >= this.seq`: Client is up to date; send `replay:complete`.
  - If `lastEventSeq < oldestSeq - 1` (where `oldestSeq = this.replayBuffer[0].seq`): Replay buffer has wrapped around (more than 100 events missed). DO sends `replay:overflow`, prompting the client to re-sync its caches via standard API GET endpoints.
  - Otherwise: Filter `this.replayBuffer` for `event.seq > lastEventSeq` and `isEventVisibleToSession(event, session)`. Send all missed events in a `replay:batch` or sequence, followed by `replay:complete`.

#### 2.3.7 Server-Sent Events (SSE) Fallback Stream (`/api/realtime/events`)
For environments where WebSockets are unavailable:
- Client initiates `GET /api/realtime/events?token=<TOKEN>&lastEventSeq=<SEQ>`.
- Authenticates token via `this.env.DB`.
- Instantiates a `TransformStream` with `text/event-stream; charset=utf-8` response headers.
- Emits initial `data: {"type":"connected","seq":this.seq,"userId":session.userId}\n\n`.
- Replays missed events if `lastEventSeq` is provided.
- Emits a periodic `: keepalive\n\n` comment every 25 seconds to prevent gateway timeouts.
- Intercepts stream abort/cancellation to clean up client references and interval timers.

---

## 3. Concrete Implementation Drafts

### 3.1 Proposed `src/sync-hub.js`

```javascript
// ── AppSyncHub Durable Object ─────────────────────────────────────────
// Global real-time event hub for multi-tenant state synchronization.
// Features:
// - Cloudflare DO Hibernation WebSocket support
// - Session serialization and connection tracking by user/topic
// - Monotonic sliding replay buffer (100 events) for instant reconnection
// - Internal RPC & HTTP POST /broadcast endpoint for Worker mutations
// - Fallback SSE stream support (/api/realtime/events)
// =====================================================================

export class AppSyncHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    this.sessions = new Map(); // ws -> session
    this.sseClients = new Map(); // clientId -> { writer, session, keepAliveTimer }
    this.nextSseClientId = 1;

    this.seq = 0;
    this.replayBuffer = [];
    this.maxBufferSize = 100;

    if (this.ctx?.blockConcurrencyWhile) {
      this.ctx.blockConcurrencyWhile(async () => {
        await this.initStorage();
        this.restoreSessions();
      });
    } else {
      this.restoreSessions();
    }
  }

  // ── Storage Initialization ──────────────────────────────────────────
  async initStorage() {
    try {
      if (this.ctx?.storage) {
        const stored = await this.ctx.storage.get(['seq', 'replayBuffer']);
        if (stored) {
          if (typeof stored.get === 'function') {
            this.seq = stored.get('seq') || 0;
            this.replayBuffer = stored.get('replayBuffer') || [];
          } else {
            this.seq = stored.seq || 0;
            this.replayBuffer = stored.replayBuffer || [];
          }
        }
      }
    } catch (err) {
      console.warn('AppSyncHub initStorage error:', err?.message || err);
    }
  }

  // ── Restore sessions after hibernation ──────────────────────────────
  restoreSessions() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const session = ws.deserializeAttachment();
        if (session && session.userId) {
          this.sessions.set(ws, session);
        }
      } catch (_) {}
    }
  }

  // ── HTTP Fetch Handler ──────────────────────────────────────────────
  async fetch(request) {
    const url = new URL(request.url);

    // 1. Internal broadcast endpoint (invoked by Worker server.js)
    if (request.method === 'POST' && (url.pathname === '/broadcast' || url.pathname === '/api/realtime/broadcast')) {
      try {
        const payload = await request.json();
        const res = await this.broadcast(payload);
        return new Response(JSON.stringify(res), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // 2. Health & Statistics endpoint
    if (url.pathname === '/stats' || url.pathname === '/api/realtime/stats') {
      return new Response(JSON.stringify({
        ok: true,
        activeWs: this.sessions.size,
        activeSse: this.sseClients.size,
        totalConnections: this.sessions.size + this.sseClients.size,
        seq: this.seq,
        bufferSize: this.replayBuffer.length,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Fallback SSE stream (/api/realtime/events)
    if (url.pathname === '/events' || url.pathname === '/api/realtime/events') {
      return await this.handleSse(request);
    }

    // 4. WebSocket Upgrade (/api/realtime/ws)
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found or upgrade required' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── WebSocket Lifecycle (Cloudflare Hibernation API) ────────────────
  async webSocketMessage(ws, raw) {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));

      if (msg.type === 'auth') {
        await this.handleAuth(ws, msg);
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t, serverTime: Date.now() }));
        const session = this.sessions.get(ws);
        if (session) {
          session.lastPingAt = Date.now();
          ws.serializeAttachment(session);
        }
        return;
      }

      const session = this.sessions.get(ws);
      if (!session) {
        ws.send(JSON.stringify({ type: 'auth:error', message: 'WebSocket chưa được xác thực', code: 'UNAUTHORIZED' }));
        return;
      }

      switch (msg.type) {
        case 'subscribe':
          this.handleSubscribe(ws, session, msg);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(ws, session, msg);
          break;
        case 'replay':
          this.handleReplay(ws, session, msg.lastEventSeq || msg.fromSeq || 0);
          break;
        default:
          // Ignore unhandled client messages
          break;
      }
    } catch (error) {
      console.error('AppSyncHub WS message error', error?.message || error);
    }
  }

  async webSocketClose(ws, code, reason) {
    this.sessions.delete(ws);
  }

  async webSocketError(ws, error) {
    this.sessions.delete(ws);
    console.error('AppSyncHub WS error', error?.message || error);
  }

  // ── WebSocket Handlers ──────────────────────────────────────────────
  async handleAuth(ws, msg) {
    if (!msg.token) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Token missing', code: 'UNAUTHORIZED' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    let user = null;
    try {
      user = await this.env.DB.prepare(
        `SELECT u.id, u.full_name, u.role, u.department, u.employee_code, u.is_active
         FROM users u JOIN sessions s ON s.user_id = u.id
         WHERE s.token = ? AND s.revoked = 0 AND CAST(s.expires_at AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)`
      ).bind(msg.token).first();
    } catch (err) {
      console.warn('AppSyncHub auth db error:', err?.message || err);
    }

    if (!user || !user.is_active) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid or expired token', code: 'UNAUTHORIZED' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    const session = {
      userId: Number(user.id),
      userName: user.full_name || 'User',
      userRole: user.role || 'employee',
      department: user.department || '',
      topics: Array.isArray(msg.topics) && msg.topics.length > 0 ? msg.topics : ['*'],
      connectedAt: new Date().toISOString(),
      lastPingAt: Date.now(),
    };

    ws.serializeAttachment(session);
    this.sessions.set(ws, session);

    ws.send(JSON.stringify({
      type: 'auth:ok',
      userId: user.id,
      userName: user.full_name,
      currentSeq: this.seq,
    }));

    if (msg.lastEventSeq !== undefined && msg.lastEventSeq !== null) {
      this.handleReplay(ws, session, Number(msg.lastEventSeq));
    }
  }

  handleSubscribe(ws, session, msg) {
    if (!Array.isArray(msg.topics)) return;
    const current = new Set(session.topics || []);
    for (const t of msg.topics) current.add(t);
    session.topics = Array.from(current);
    ws.serializeAttachment(session);
    this.sessions.set(ws, session);
    ws.send(JSON.stringify({ type: 'subscribe:ok', topics: session.topics }));
  }

  handleUnsubscribe(ws, session, msg) {
    if (!Array.isArray(msg.topics)) return;
    const current = new Set(session.topics || []);
    for (const t of msg.topics) current.delete(t);
    session.topics = Array.from(current);
    ws.serializeAttachment(session);
    this.sessions.set(ws, session);
    ws.send(JSON.stringify({ type: 'unsubscribe:ok', topics: session.topics }));
  }

  handleReplay(ws, session, lastEventSeq) {
    const clientSeq = Number(lastEventSeq || 0);
    if (clientSeq >= this.seq || this.replayBuffer.length === 0) {
      ws.send(JSON.stringify({ type: 'replay:complete', replayedCount: 0, currentSeq: this.seq }));
      return;
    }

    const oldestSeq = this.replayBuffer[0].seq;
    if (clientSeq < oldestSeq - 1) {
      ws.send(JSON.stringify({
        type: 'replay:overflow',
        message: 'Replay buffer overflow — missed events exceed buffer limit.',
        oldestAvailableSeq: oldestSeq,
        currentSeq: this.seq,
      }));
      return;
    }

    const missed = this.replayBuffer.filter(e => e.seq > clientSeq && this.isEventVisibleToSession(e, session));
    ws.send(JSON.stringify({
      type: 'replay:batch',
      events: missed,
      replayedCount: missed.length,
      currentSeq: this.seq,
    }));
  }

  // ── Universal Broadcast Method ──────────────────────────────────────
  async broadcast(eventInput) {
    this.seq++;
    const now = new Date().toISOString();
    const event = {
      id: eventInput.id || `evt_${Date.now()}_${this.seq}_${Math.random().toString(36).slice(2, 7)}`,
      seq: this.seq,
      topic: String(eventInput.topic || 'system'),
      event: String(eventInput.event || eventInput.topic || 'update'),
      payload: eventInput.payload !== undefined ? eventInput.payload : {},
      actorId: Number(eventInput.actorId || 0),
      targetUserIds: Array.isArray(eventInput.targetUserIds) ? eventInput.targetUserIds.map(Number) : undefined,
      timestamp: eventInput.timestamp || now,
    };

    // Push to sliding replay buffer
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > this.maxBufferSize) {
      this.replayBuffer.splice(0, this.replayBuffer.length - this.maxBufferSize);
    }

    // Persist storage asynchronously
    if (this.ctx?.storage) {
      this.ctx.storage.put({ seq: this.seq, replayBuffer: this.replayBuffer }).catch(() => {});
    }

    const payloadString = JSON.stringify(event);

    // 1. Dispatch to WebSockets
    for (const [ws, session] of this.sessions) {
      if (this.isEventVisibleToSession(event, session)) {
        try {
          ws.send(payloadString);
        } catch (_) {
          this.sessions.delete(ws);
        }
      }
    }

    // 2. Dispatch to SSE clients
    const sseChunk = new TextEncoder().encode(`id: ${event.seq}\nevent: message\ndata: ${payloadString}\n\n`);
    for (const [clientId, sseClient] of this.sseClients) {
      if (this.isEventVisibleToSession(event, sseClient.session)) {
        try {
          sseClient.writer.write(sseChunk).catch(() => {
            this.cleanupSseClient(clientId);
          });
        } catch (_) {
          this.cleanupSseClient(clientId);
        }
      }
    }

    return { ok: true, id: event.id, seq: event.seq };
  }

  // ── Event Visibility Check ──────────────────────────────────────────
  isEventVisibleToSession(event, session) {
    if (!session) return false;

    // Filter by target users if specified
    if (Array.isArray(event.targetUserIds) && event.targetUserIds.length > 0) {
      if (!event.targetUserIds.includes(Number(session.userId))) {
        return false;
      }
    }

    // Filter by subscribed topics
    const topics = session.topics || ['*'];
    if (!topics.includes('*') && !topics.includes('all') && !topics.includes(event.topic)) {
      return false;
    }

    return true;
  }

  // ── SSE Fallback Handler ────────────────────────────────────────────
  async handleSse(request) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const lastEventSeq = parseInt(url.searchParams.get('lastEventSeq') || '0', 10);

    if (!token) {
      return new Response(JSON.stringify({ error: 'Token missing', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let user = null;
    try {
      user = await this.env.DB.prepare(
        `SELECT u.id, u.full_name, u.role, u.department, u.is_active
         FROM users u JOIN sessions s ON s.user_id = u.id
         WHERE s.token = ? AND s.revoked = 0 AND CAST(s.expires_at AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)`
      ).bind(token).first();
    } catch (_) {}

    if (!user || !user.is_active) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = {
      userId: Number(user.id),
      userName: user.full_name,
      userRole: user.role,
      department: user.department,
      topics: ['*'],
    };

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const clientId = this.nextSseClientId++;

    const keepAliveTimer = setInterval(() => {
      try {
        writer.write(encoder.encode(': keepalive\n\n')).catch(() => this.cleanupSseClient(clientId));
      } catch (_) {
        this.cleanupSseClient(clientId);
      }
    }, 25000);

    this.sseClients.set(clientId, { clientId, writer, session, keepAliveTimer });

    // Send initial connected frame
    writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'connected', seq: this.seq, userId: user.id, timestamp: new Date().toISOString() })}\n\n`)).catch(() => {});

    // Replay missed events if requested
    if (lastEventSeq > 0 && lastEventSeq < this.seq) {
      const oldestSeq = this.replayBuffer[0]?.seq || 0;
      if (lastEventSeq < oldestSeq - 1) {
        writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'replay:overflow', oldestAvailableSeq: oldestSeq, currentSeq: this.seq })}\n\n`)).catch(() => {});
      } else {
        const missed = this.replayBuffer.filter(e => e.seq > lastEventSeq && this.isEventVisibleToSession(e, session));
        for (const evt of missed) {
          writer.write(encoder.encode(`id: ${evt.seq}\nevent: message\ndata: ${JSON.stringify(evt)}\n\n`)).catch(() => {});
        }
        writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'replay:complete', replayedCount: missed.length, currentSeq: this.seq })}\n\n`)).catch(() => {});
      }
    }

    if (request.signal) {
      request.signal.addEventListener('abort', () => this.cleanupSseClient(clientId));
    }

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  cleanupSseClient(clientId) {
    const client = this.sseClients.get(clientId);
    if (client) {
      if (client.keepAliveTimer) clearInterval(client.keepAliveTimer);
      try { client.writer.close(); } catch (_) {}
      this.sseClients.delete(clientId);
    }
  }
}
```

---

## 4. Integration with `server.js`

### 4.1 Universal `broadcastAppEvent()` Helper
In `server.js`, export the universal broadcast helper:

```javascript
export async function broadcastAppEvent(env, topicOrEvent, payload, options = {}) {
  if (!env?.APP_SYNC_HUB) return null;
  try {
    const doId = env.APP_SYNC_HUB.idFromName('global');
    const hubStub = env.APP_SYNC_HUB.get(doId);

    let eventData;
    if (typeof topicOrEvent === 'object' && topicOrEvent !== null) {
      eventData = topicOrEvent;
    } else {
      eventData = {
        topic: String(topicOrEvent),
        event: options.event || String(topicOrEvent),
        payload: payload !== undefined ? payload : {},
        actorId: options.actorId ? Number(options.actorId) : 0,
        targetUserIds: options.targetUserIds || undefined,
      };
    }

    if (typeof hubStub.broadcast === 'function') {
      return await hubStub.broadcast(eventData);
    }

    const res = await hubStub.fetch('https://app-sync-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    });
    return await res.json().catch(() => ({ ok: true }));
  } catch (error) {
    console.warn('broadcastAppEvent error:', error?.message || error);
    return null;
  }
}
```

### 4.2 Endpoint Routing in `server.js`
In `server.js` `handle(request, env)`:
```javascript
// ── Real-Time Sync Hub (WebSocket & SSE Stream) ──────────────────────
if (path === '/api/realtime/ws' && request.method === 'GET') {
  if (!env.APP_SYNC_HUB) return json({ error: 'AppSyncHub chưa được cấu hình' }, 503);
  const doId = env.APP_SYNC_HUB.idFromName('global');
  const stub = env.APP_SYNC_HUB.get(doId);
  return stub.fetch(request);
}

if (path === '/api/realtime/events' && request.method === 'GET') {
  if (!env.APP_SYNC_HUB) return json({ error: 'AppSyncHub chưa được cấu hình' }, 503);
  const doId = env.APP_SYNC_HUB.idFromName('global');
  const stub = env.APP_SYNC_HUB.get(doId);
  return stub.fetch(request);
}

if (path === '/api/realtime/stats' && request.method === 'GET') {
  if (!env.APP_SYNC_HUB) return json({ error: 'AppSyncHub chưa được cấu hình' }, 503);
  const doId = env.APP_SYNC_HUB.idFromName('global');
  const stub = env.APP_SYNC_HUB.get(doId);
  return stub.fetch(request);
}
```

---

## 5. Summary & Next Steps for Milestone 1 Team
1. `src/sync-hub.js` provides complete zero-drop real-time distribution across all 8 domains.
2. `wrangler.toml` and `worker.js` seamlessly register and export `AppSyncHub`.
3. In Milestone 1, `server.js` mutations will invoke `broadcastAppEvent(env, topic, payload, options)` whenever shared data is mutated.
4. Downstream milestones (M2, M3, M4) can reliably connect via `src/realtime.js` and `src/event-bus.js`.
