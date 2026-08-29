# Handoff Report: Milestone 1 Real-Time Sync Hub Design & Architecture

**Agent:** Explorer M1_1  
**Working Directory:** `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_1`  
**Date:** 2026-08-27  

---

## 1. Observation

1. **`wrangler.toml` (lines 24-31)**:
   - Configures a single Durable Object class `ChatRoom` with binding `CHAT_ROOM` and migration tag `v1` (`new_sqlite_classes = ["ChatRoom"]`).
   - No DO binding or migration tag currently exists for a global sync hub.

2. **`worker.js` (lines 1-55)**:
   - Imports and exports `ChatRoom` from `./src/chat-room.js`.
   - Delegates all `/api/*` HTTP traffic to `handle(request, env)` from `server.js`.
   - Does not yet import or export `AppSyncHub`.

3. **`server.js` (lines 2195-2201, lines 9637-9650)**:
   - Chat WebSocket route `/api/chat/ws/:id` routes to `env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(String(convId)))`.
   - Chat REST mutations use internal HTTP endpoint `await stub.fetch('https://chat-room.internal/broadcast', { method: 'POST', body: JSON.stringify(payload) })`.
   - No universal broadcast helper exists (`broadcastAppEvent`), and non-chat domain mutations (tasks, comments, leave, attendance, payroll, user profile) do not broadcast real-time events.

4. **`src/chat-room.js` (lines 1-384)**:
   - Demonstrates Cloudflare DO Hibernation API usage (`this.ctx.acceptWebSocket(server)`, `ws.serializeAttachment()`, `ws.deserializeAttachment()`, `this.ctx.getWebSockets()`, `webSocketMessage`, `webSocketClose`, `webSocketError`).
   - Implements authentication via token lookup against D1 `sessions` and `users` tables.

5. **`PROJECT.md` & `TEST_INFRA.md`**:
   - Outlines 8 core feature domains requiring real-time cross-client sync.
   - Specifies standard event envelope format: `{ id, seq, topic, event, payload, actorId, targetUserIds, timestamp }`.

---

## 2. Logic Chain

1. **Singleton DO Instance vs Multi-Instance**:
   - While `ChatRoom` is partitioned by `conversationId`, general application state synchronization (tasks, notifications, leave, attendance, payroll, user roles) spans multiple domains for all authenticated company members.
   - Using a well-known Durable Object ID `env.APP_SYNC_HUB.idFromName('global')` establishes a unified, shared message distribution fabric with zero-cost hibernation when idle.

2. **Zero-Drop Reconnection via Sliding Replay Buffer**:
   - Network disconnections and mobile device sleep cycles temporarily sever WebSocket connections.
   - By maintaining a sliding buffer of the last 100 events (`this.replayBuffer`) with monotonic sequence numbers (`this.seq`), reconnecting clients providing `lastEventSeq` can instantly receive all missed events in a single batch (`replay:batch`), eliminating the need for full page refreshes (F5).
   - If the disconnect window exceeds 100 events, DO signals `replay:overflow` so the client can perform an intentional background refetch.

3. **Multi-Protocol Accessibility (WebSocket + SSE Fallback)**:
   - The primary transport uses Cloudflare DO Hibernation WebSockets (`/api/realtime/ws`).
   - For enterprise environments where WebSocket handshake (HTTP 101) is blocked by corporate proxies or firewalls, `AppSyncHub` exposes `/api/realtime/events` providing identical event streaming over Server-Sent Events (`text/event-stream`).

4. **Internal Broadcast Pipeline**:
   - `server.js` mutations will invoke `broadcastAppEvent(env, topic, payload, options)`.
   - The helper transmits the payload to `AppSyncHub` via DO RPC or `stub.fetch('https://app-sync-hub.internal/broadcast', { method: 'POST', body: ... })`.
   - `AppSyncHub` stamps the monotonic sequence ID, stores in replay buffer, and fans out to all active WebSockets and SSE streams according to topic subscriptions and target user filters.

---

## 3. Caveats

1. **Multi-tenancy Scope**:
   - The current design uses a singleton DO instance name `'global'`. If multi-organization isolation is introduced in the future, the DO ID can be dynamically partitioned by `orgId` (e.g. `env.APP_SYNC_HUB.idFromName('org_' + orgId)`).
2. **Local Test Environment DO Mocking**:
   - In Node.js unit/integration test harnesses (`tests/realtime-sync/*.mjs`), Cloudflare Durable Objects runtime bindings are mocked in-memory. The design ensures `AppSyncHub` operates cleanly whether run within Cloudflare Workers runtime or a Node.js mock harness with standard Map/Array structures.

---

## 4. Conclusion

The complete architectural specification and concrete code design for `AppSyncHub`, `wrangler.toml`, `worker.js`, and `server.js` integration have been formulated and documented in `.agents/teamwork_preview_explorer_m1_1/analysis.md`. The design fulfills all requirements of Milestone 1:
- DO Hibernation WebSocket support with session attachment.
- Monotonic sliding replay buffer (100 events) for instant recovery.
- Bidirectional ping/pong heartbeats.
- Internal HTTP / RPC broadcast pipeline for worker mutations.
- Server-Sent Events (SSE) fallback stream.

---

## 5. Verification Method

To verify the implementation once applied by the implementing agent:
1. **Syntax & Export Check**:
   - Ensure `src/sync-hub.js` exists and exports `AppSyncHub`.
   - Ensure `worker.js` exports `AppSyncHub`.
   - Ensure `wrangler.toml` includes `[[durable_objects.bindings]] name = "APP_SYNC_HUB"` and `tag = "v2"`.
2. **Local Worker Validation**:
   - Run `npx wrangler types` or `node -c src/sync-hub.js` to ensure zero syntax errors.
3. **Integration Test Suite**:
   - Run the two-client integration tests in `tests/realtime-sync/` verifying that REST mutations on Client A trigger immediate real-time event reception on Client B.
