# NetViet HR Real-Time Infrastructure & Backend Synchronization Analysis

**Author**: Explorer 1 (Backend & Real-Time Infrastructure Specialist)  
**Date**: 2026-08-27  
**Scope**: Backend codebase (`worker.js`, `server.js`, `src/chat-room.js`, `wrangler.toml`, D1 Schemas, API endpoints, WebSocket connection lifecycles, and edge case resilience).

---

## 1. Executive Summary

A comprehensive investigation into the NetViet HR codebase (`d:\NetVietTv\nexrall-hr-manager---marketing`) reveals that while a high-performance **Cloudflare Durable Object WebSocket architecture** (`ChatRoom`) exists for conversation-specific chat rooms, **real-time synchronization is completely absent across all other shared data domains (Tasks, Subtasks, Comments, Attendance, Overtime, Leave Requests, Payroll, Payslips/Invoices, User Profiles, Roles, Departments, and Settings)**.

Furthermore, within the Chat module itself, several REST-based mutation endpoints (such as editing/deleting messages via REST, pin/unpin, emoji reactions, and creating conversations) fail to trigger DO broadcast updates. The rest of the application relies on an aggressive 10-second polling interval for basic header badge counters, while full data tables require manual page refreshes (`F5`) or view navigation.

To achieve true bidirectional real-time synchronization where User A’s mutation is instantly observed by User B without manual refresh, the real-time infrastructure must be expanded into a unified, topic-based event broadcast pipeline.

---

## 2. Real-Time Transport & Infrastructure Inventory

### 2.1 Configured Architecture

1. **Cloudflare Worker & Bindings (`wrangler.toml`, `worker.js`)**:
   - `main = "worker.js"` with compatibility date `2026-07-22`.
   - Single Durable Object binding:
     ```toml
     [[durable_objects.bindings]]
     name = "CHAT_ROOM"
     class_name = "ChatRoom"

     [[migrations]]
     tag = "v1"
     new_sqlite_classes = ["ChatRoom"]
     ```
   - Database: Cloudflare D1 (`binding = "DB"`, `database_name = "nexrall-hr-manager-local"`).
   - Storage: Cloudflare R2 (`binding = "HR_DOCUMENTS"`).
   - Cron Trigger: Nightly auto-checkout at `17:05 UTC` (00:05 HCM).

2. **Durable Object Implementation (`src/chat-room.js`)**:
   - Class `ChatRoom` handles WebSocket connections on a **per-conversation** basis.
   - Instance addressing: `env.CHAT_ROOM.idFromName(String(convId))`.
   - Uses the **Cloudflare WebSocket Hibernation API** (`this.ctx.acceptWebSocket(server)`, `ws.serializeAttachment()`, `ws.deserializeAttachment()`).
   - Supports internal broadcast HTTP endpoint (`POST /broadcast` on `https://chat-room.internal/broadcast`) for Worker-to-DO fan-out.

3. **Transport Mechanism Gaps**:
   - **No Global / User-Level WebSocket or SSE Stream**: There is no persistent connection opened at application login. WebSocket connections are initiated only when navigating into a specific chat conversation (`src/views/chat.js:connectWS(convId)`).
   - **No Event Bus / PubSub for General Domain Events**: Tasks, Attendance, Leave, and Payroll have no mechanism to push events to active browser clients.
   - **Polling Fallback**: `src/app.js` runs `setInterval(..., 10000)` polling `/api/chat/header-summary` and `/api/notifications` to refresh top header badge counters.

---

## 3. Connection Lifecycle, Authentication & Broadcasting Mechanics

### 3.1 Connection & Authentication Lifecycle (`src/chat-room.js`, `server.js`)

```
Browser Client                    Worker Router (server.js)              ChatRoom DO
     |                                      |                                  |
     | --- GET /api/chat/ws/:convId ------> |                                  |
     |     (Upgrade: websocket, token)      | (Verifies D1 membership)         |
     |                                      | --- stub.fetch(..., conv=id) --> |
     |                                      |                                  | (ctx.acceptWebSocket)
     | <== 101 Switching Protocols =========|================================= |
     |                                      |                                  |
     | --- { type: 'auth', token, user_id } ---------------------------------> |
     |                                                                         | (Validates token in D1)
     |                                                                         | (ws.serializeAttachment)
     |                                                                         | (Stores session in Map)
     | <== { type: 'auth:ok', user_id, user_name } ----------------------------|
     | <== Broadcast { type: 'user:online', ... } to other sockets in room --- |
```

1. **Acceptance & Membership Check**:
   - In `server.js` (lines 9636–9650), when `GET /api/chat/ws/:convId` is requested:
     - Worker extracts authenticated user `me.id`.
     - Queries D1 `SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`. If not a member, returns `403`.
     - Obtains DO stub via `env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(String(convId)))`.
     - Forwards the upgrade request to the DO.
2. **Handshake & Session Attachment**:
   - Client sends initial WS frame: `{"type": "auth", "token": "...", "user_id": 123}`.
   - `ChatRoom.handleAuth()` checks `sessions` table in D1 for active non-expired token.
   - Attaches `sessionData` (`userId`, `userName`, `userCode`, `conversationId`) to the socket using `ws.serializeAttachment(sessionData)`.
   - Stores session in `this.sessions` Map (`ws -> sessionData`).
3. **Hibernation Recovery**:
   - In `ChatRoom.constructor()`, `this.restoreSessions()` loops over `this.ctx.getWebSockets()` and calls `ws.deserializeAttachment()` to re-populate `this.sessions` without requiring client re-auth after DO sleep.
4. **Disconnection Handling**:
   - `webSocketClose(ws)` broadcasts `{"type": "user:offline", "user_id": ...}` and deletes `ws` from `this.sessions`.
5. **Broadcasting Mechanics**:
   - `broadcast(data, excludeWs)` iterates through `this.sessions` and sends `JSON.stringify(data)`.
   - Safety loop iterates untracked sockets in `this.ctx.getWebSockets()` and sends `auth:error`.
   - Worker API handlers invoke `broadcastChatUpdate(env, convId, payload)` which POSTs to `https://chat-room.internal/broadcast`.

---

## 4. Comprehensive Mutation Handler & Real-Time Broadcast Audit

The following table documents the audit of all mutation handlers across the 10 domain areas in `server.js`:

| Module / Area | API Endpoint & Method | Description | Current Real-Time Broadcast | Gap / Missing Event |
|---|---|---|---|---|
| **Tasks** | `POST /api/tasks` | Create task | ❌ None | Missing `task:created` event (scope: project/assignee/followers) |
| **Tasks** | `PUT /api/tasks/:id` | Update task (status, assignee, priority, due date) | ❌ None | Missing `task:updated` event |
| **Tasks** | `DELETE /api/tasks/:id` | Delete task | ❌ None | Missing `task:deleted` event |
| **Tasks** | `POST /api/tasks/reorder` | Drag-and-drop task reordering | ❌ None | Missing `task:reordered` event |
| **Task Projects** | `POST /api/task-projects` | Create project | ❌ None | Missing `project:created` event |
| **Task Projects** | `PUT /api/task-projects/:id` | Update project | ❌ None | Missing `project:updated` event |
| **Task Projects** | `DELETE /api/task-projects/:id` | Archive/delete project | ❌ None | Missing `project:deleted` event |
| **Task Projects** | `PUT /api/task-projects/:id/members`| Modify project members | ❌ None | Missing `project:members_updated` event |
| **Task Groups** | `POST/PUT/DELETE /api/task-groups*` | Kanban column CRUD | ❌ None | Missing `task_group:changed` event |
| **Task Labels** | `POST/PUT/DELETE /api/task-labels*` | Label CRUD | ❌ None | Missing `task_label:changed` event |
| **Subtasks** | `POST /api/tasks/:id/subtasks` | Create subtask | ❌ None | Missing `subtask:created` event |
| **Subtasks** | `PUT /api/subtasks/:id` | Update / toggle done | ❌ None | Missing `subtask:updated` event |
| **Subtasks** | `DELETE /api/subtasks/:id` | Delete subtask | ❌ None | Missing `subtask:deleted` event |
| **Task Comments**| `POST /api/tasks/:id/comments` | Post comment & mentions | ❌ None (DB insert & Web Push only) | Missing `task_comment:new` & `notification:mention` real-time events |
| **Task Files** | `POST /api/tasks/:id/attachments`| Upload task file | ❌ None | Missing `task_attachment:new` event |
| **Chat** | WS `message:send` | Send chat message | ✅ `message:new` | Fully broadcasted in room DO |
| **Chat** | REST `POST /api/conversations/:id/messages` | Send message (REST fallback) | ✅ `message:new` | Broadcasted via `broadcastChatUpdate` |
| **Chat** | WS `message:edit` / `message:delete` | Edit / delete msg | ✅ `message:edit`, `message:delete` | Handled inside DO WS |
| **Chat** | REST `PUT /api/messages/:id` | Edit message via REST | ❌ None | Missing `broadcastChatUpdate(env, convId, { type: 'message:edit' })` |
| **Chat** | REST `DELETE /api/messages/:id` | Delete message via REST | ❌ None | Missing `broadcastChatUpdate(env, convId, { type: 'message:delete' })` |
| **Chat** | REST `POST/DELETE /api/messages/:id/pin` | Pin/unpin message | ❌ None | Missing `broadcastChatUpdate(env, convId, { type: 'message:pin' })` |
| **Chat** | REST `POST/DELETE /api/messages/:id/reactions` | Add/remove reaction | ❌ None | Missing `broadcastChatUpdate(env, convId, { type: 'reaction:update' })` |
| **Chat** | REST `POST /api/conversations` | Create DM or Group | ❌ None | Missing `conversation:created` broadcast to all target member IDs |
| **Chat** | REST `DELETE /api/conversations/:id` | Dissolve group | ✅ `conversation:dissolved` | Broadcasted via `broadcastChatUpdate` |
| **Notifications**| `PATCH /api/notifications/task-mentions/:id/read` | Mark mention read | ❌ None | Missing `notification:read` event |
| **Attendance** | `POST /api/attendance/register` | Register work shift/type | ❌ None | Missing `attendance:registered` event |
| **Attendance** | `POST /api/attendance/checkin` | Check-in with GPS/IP | ❌ None | Missing `attendance:checkin` event (live map & dashboard) |
| **Attendance** | `POST /api/attendance/checkout` | Check-out with GPS/IP | ❌ None | Missing `attendance:checkout` event |
| **Attendance** | `POST /api/attendance/:id/location-review` | Manager review geofence | ❌ None | Missing `attendance:reviewed` event |
| **Overtime** | `POST /api/overtime-requests` | Request OT | ❌ None | Missing `overtime:requested` event |
| **Overtime** | `POST /api/overtime-requests/:id/(approve\|reject)` | Review OT | ❌ None | Missing `overtime:reviewed` event |
| **Overtime** | `POST /api/overtime-forms*` | Form OT workflow | ❌ None | Missing `overtime_form:changed` event |
| **Leave** | `POST /api/leave` | Submit leave request | ❌ None | Missing `leave:submitted` event |
| **Leave** | `PUT /api/leave/:id` | Approve/reject/forward leave | ❌ None | Missing `leave:status_changed` event |
| **Leave** | `DELETE /api/leave/:id` | Cancel leave request | ❌ None | Missing `leave:cancelled` event |
| **Leave** | `POST /api/leave/balances` | HR balance adjustment | ❌ None | Missing `leave_balance:updated` event |
| **Payroll** | `POST /api/payroll/load`, `batch` | Sync monthly payroll batch | ❌ None | Missing `payroll:batch_updated` event |
| **Payroll** | `PUT /api/payroll/:id` | Edit payroll line & log | ❌ None | Missing `payroll:item_updated` event |
| **Payroll** | `POST /api/payroll-adjustments/apply`| Apply penalties/bonuses | ❌ None | Missing `payroll:adjustments_applied` event |
| **Invoices** | `POST /api/payroll/export-payslips` | Issue employee payslips | ❌ None | Missing `payslip:issued` event |
| **Invoices** | `POST /api/invoices/:id/confirm` | Employee confirms payslip | ❌ None | Missing `payslip:confirmed` event |
| **Invoices** | `POST /api/invoices/:id/review-request` | Request payslip review | ❌ None | Missing `payslip:review_requested` event |
| **Invoices** | `POST /api/invoices/:id/resolve-review` | Manager resolves review | ❌ None | Missing `payslip:review_resolved` event |
| **Users & Roles**| `POST /api/users` | Create user | ❌ None | Missing `user:created` event |
| **Users & Roles**| `PUT /api/users/:id` | Update profile/role/salary | ❌ None | Missing `user:updated` event (vital for permission changes) |
| **Users & Roles**| `PUT /api/users/:id/lifecycle` | Update lifecycle status | ❌ None | Missing `user:lifecycle_changed` event |
| **Users & Roles**| `POST /api/users/:id/documents/*`| Upload private doc/avatar | ❌ None | Missing `user:avatar_updated` event |
| **Settings/Wifi**| `PUT /api/settings`, `PUT /api/wifi-whitelist*` | Global config updates | ❌ None | Missing `system:settings_updated` event |

---

## 5. Edge Case Analysis & Resilience Assessment

### 5.1 Reconnection & Session Handling
- **Current State**:
  - `ChatRoom` stores session credentials on the WebSocket using `ws.serializeAttachment()`.
  - When a client disconnects and reconnects, `connectWS` creates a new WebSocket and transmits `{ type: 'auth', token, user_id }`.
- **Deficiencies**:
  - No connection resumption tokens or session resumption IDs are used.
  - The client re-authenticates on every reconnect by executing a DB read query on `sessions` in D1. Under high reconnect bursts (e.g. Wi-Fi reconnect), this places unnecessary query load on D1.

### 5.2 Missed Events & Event Replay Buffer
- **Current State**:
  - No message sequence IDs (`seq_id` or `cursor`) or event replay logs are maintained in Durable Objects or D1.
- **Impact**:
  - If a user experiences a 3-second network drop or mobile handover, any broadcasts sent during those 3 seconds are permanently missed.
  - The UI does not know that events were dropped and remains out-of-sync until a full page reload or view remount occurs.

### 5.3 Heartbeat & Zombie Socket Detection
- **Current State**:
  - No application-level ping/pong mechanism exists in `ChatRoom` or `chat.js`.
  - Relying solely on TCP keepalive leaves "half-open" / zombie connections lingering in memory when mobile devices enter sleep mode or lose signal without sending a TCP `FIN`/`RST`.
- **Impact**:
  - DO instances maintain dead sockets until a write fails on `ws.send()`.
  - Client side does not realize the connection is dead and fails to trigger auto-reconnect.

### 5.4 Multi-Tab & Background Tab-Sleep Recovery
- **Current State**:
  - Multiple tabs opened by the same user to the same conversation connect to the same `ChatRoom` DO instance. Both receive live messages.
  - When a browser tab is placed in the background, modern browsers throttle timers and suspend WebSocket event processing.
  - On tab focus, `app.js` listens to `visibilitychange` and triggers `refreshChatHeaderSummary()` and `refreshEmployeeAlertBadge()`.
- **Deficiencies**:
  - Tab wake-up does NOT verify if the WebSocket socket is still open or stale.
  - View states (e.g. open Task list, Kanban board, Attendance list, Leave approvals) are NOT refetched or validated on tab wake-up.
  - In-memory cache in `src/api.js` (`_cache` Map with TTLs up to 30s) can serve stale cached responses when switching tabs after another user mutated data.

---

## 6. Architectural Recommendations for Remediation

To achieve full two-client synchronization across the entire NetViet HR system, we recommend a **unified 3-tier Real-Time Synchronization Architecture**:

```
                       ┌─────────────────────────────────────────────────────────┐
                       │               Cloudflare Edge Infrastructure            │
                       └─────────────────────────────────────────────────────────┘
                                                    │
                   ┌────────────────────────────────┴────────────────────────────────┐
                   ▼                                                                 ▼
      ┌─────────────────────────────┐                                   ┌─────────────────────────────┐
      │   Global App Sync DO        │                                   │   Per-Room Chat DOs         │
      │   (`AppSyncHub`)            │                                   │   (`ChatRoom`)              │
      │   - 1 instance per tenant   │                                   │   - 1 instance per convId   │
      │   - Subscribes user tabs    │                                   │   - High-frequency chat     │
      │   - Broadcasts domain events│                                   │   - Typing, read receipts   │
      └─────────────────────────────┘                                   └─────────────────────────────┘
                   ▲                                                                 ▲
                   │                                                                 │
                   └────────────────────────────────┬────────────────────────────────┘
                                                    │
                                  ┌───────────────────────────────────┐
                                  │   Worker REST & RPC Dispatcher    │
                                  │   (`server.js`)                   │
                                  │   - `broadcastAppEvent(...)`      │
                                  │   - `broadcastChatUpdate(...)`    │
                                  └───────────────────────────────────┘
```

### 6.1 Core Architectural Components

1. **Global App Sync Durable Object (`AppSyncHub`)**:
   - Add a lightweight `AppSyncHub` Durable Object class in `wrangler.toml`.
   - Browser opens a single persistent WebSocket at `/api/sync/ws` upon logging into the application (`src/app.js`).
   - Every active tab registers its `user_id`, `role`, and `department`.
   - Sockets can subscribe/unsubscribe to entity topics (e.g., `tasks`, `task:project:12`, `attendance:today`, `leave`, `payroll`, `users`, `user:123`).

2. **Standardized Real-Time Event Envelope Schema**:
   All events dispatched across the system must adhere to a standard JSON schema:
   ```json
   {
     "id": "evt_01j7x8k2m9a4b8c7d6e5f4",
     "topic": "tasks",
     "entity": "task",
     "action": "updated",
     "entity_id": 452,
     "sender_id": 18,
     "timestamp": 1724745600000,
     "version": 3,
     "payload": {
       "task_id": 452,
       "project_id": 5,
       "status": "done",
       "assignee_id": 24,
       "updated_fields": ["status", "position"]
     }
   }
   ```

3. **Universal Server-Side Broadcast Hook in `server.js`**:
   Implement a universal helper:
   ```javascript
   async function broadcastAppEvent(env, topic, event) {
     if (!env.APP_SYNC) return;
     try {
       const hub = env.APP_SYNC.get(env.APP_SYNC.idFromName('global'));
       await hub.fetch('https://app-sync.internal/broadcast', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ topic, event, timestamp: Date.now() }),
       });
     } catch (err) {
       console.warn('AppSync broadcast failed:', err?.message || err);
     }
   }
   ```
   Inject this call into every mutation endpoint (Tasks, Subtasks, Comments, Attendance, Overtime, Leave, Payroll, Invoices, Profiles, Settings).

4. **Missing REST Chat Broadcasts Remediation**:
   Add `broadcastChatUpdate` calls to:
   - `PUT /api/messages/:id` -> `{ type: 'message:edit', message }`
   - `DELETE /api/messages/:id` -> `{ type: 'message:delete', message_id }`
   - `POST/DELETE /api/messages/:id/pin` -> `{ type: 'message:pin', message_id, pinned }`
   - `POST/DELETE /api/messages/:id/reactions` -> `{ type: 'reaction:update', message_id, reactions }`
   - `POST /api/conversations` -> broadcast `conversation:created` via `AppSyncHub` to recipient user topics.

5. **Client-Side Reactive Event Dispatcher & Cache Invalidation**:
   - In `src/api.js`, when a real-time event arrives from the sync socket:
     - Automatically invalidate corresponding `_cache` entries (e.g. `leave:*` invalidates `/api/leave`, `tasks:*` invalidates task caches).
     - Dispatch DOM event `document.dispatchEvent(new CustomEvent('hr-sync-event', { detail: event }))`.
   - In view controllers (`src/views/tasks.js`, `attendance.js`, `leave.js`, `payroll.js`, `users.js`):
     - Register `hr-sync-event` listeners to selectively re-fetch or patch in-memory models in real-time.

6. **Connection Resilience, Heartbeats & Missed Event Recovery**:
   - **Ping/Pong Heartbeat**: Client sends `{"type": "ping"}` every 30s; server responds `{"type": "pong"}`. If no pong within 10s, client reconnects.
   - **Sliding Event Buffer**: `AppSyncHub` keeps the last 100 events in memory. When a client reconnects with `{"type": "auth", "last_event_id": "evt_..."}`, the DO replays all missed events since that ID, eliminating full page reloads on transient network drops.
   - **Tab Sleep / Foreground Sync**: On `visibilitychange` (foreground), the client sends a sync check to verify connection freshness and triggers a reactive view refresh if any events were missed.

---

## 7. Conclusion

The NetViet HR platform already possesses the necessary infrastructure foundation with Cloudflare Workers and Durable Objects. By extending the existing Chat DO pattern into a centralized `AppSyncHub` DO and systematically attaching `broadcastAppEvent` calls to all backend mutation handlers in `server.js`, the platform will achieve seamless, sub-100ms real-time synchronization across all shared HR operations.
