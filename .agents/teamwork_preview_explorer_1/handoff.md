# Handoff Report — Explorer 1 (Backend & Real-Time Infrastructure Specialist)

**Working Directory**: `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_1`  
**Target Analysis**: `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_1\analysis.md`  
**Type**: Hard Handoff (Investigation Complete)  
**Date**: 2026-08-27  

---

## 1. Observation

1. **Durable Objects & Real-Time Binding Configuration**:
   - `wrangler.toml` (lines 23–31):
     ```toml
     [[durable_objects.bindings]]
     name = "CHAT_ROOM"
     class_name = "ChatRoom"

     [[migrations]]
     tag = "v1"
     new_sqlite_classes = ["ChatRoom"]
     ```
   - `worker.js` (lines 1–2, 54):
     ```javascript
     import { handle, handleScheduled } from './server.js';
     import { ChatRoom } from './src/chat-room.js';
     export { ChatRoom };
     ```
   - Only a single Durable Object class (`ChatRoom`) exists in the entire repository. There are no other DO classes, WebSocket servers, or SSE routes configured.

2. **Durable Object Scoping & WebSocket Connection Lifecycle**:
   - `src/chat-room.js` (lines 1–7, 57–61, 147–148, 364–370):
     - `ChatRoom` instances are partitioned strictly per conversation (`this.conversationId = requestedConversationId`).
     - WebSocket connections are accepted via `this.ctx.acceptWebSocket(server)`.
     - Session state is preserved on socket hibernation via `ws.serializeAttachment(sessionData)`.
     - `broadcast(data, excludeWs)` loops over `this.sessions` only within that specific conversation DO instance.
   - `src/views/chat.js` (lines 1663–1677):
     - WebSockets are opened exclusively inside an active conversation:
       `const wsUrl = `${protocol}//${location.host}/api/chat/ws/${convId}`; ws = new WebSocket(wsUrl);`.
     - Leaving the conversation closes the WebSocket (`disconnectWS()`).

3. **Backend Route Mutation Handlers in `server.js`**:
   - **Tasks & Subtasks**:
     - `POST /api/tasks` (line 6941): creates task, records task activity, writes followers. **No broadcast call exists.**
     - `PUT /api/tasks/:id` (line 7016): updates title/status/due_date/assignee. **No broadcast call exists.**
     - `DELETE /api/tasks/:id` (line 7058): deletes task. **No broadcast call exists.**
     - `POST /api/tasks/reorder` (line 6903): updates position/group. **No broadcast call exists.**
     - `POST /api/tasks/:id/subtasks` (line 7076): creates subtask. **No broadcast call exists.**
     - `PUT /api/subtasks/:id` (line 7110): updates subtask. **No broadcast call exists.**
     - `DELETE /api/subtasks/:id` (line 7141): deletes subtask. **No broadcast call exists.**
     - `POST /api/tasks/:id/comments` (line 7155): inserts comment, inserts DB mention row, dispatches Web Push (`sendWebPushNotification`). **No live WebSocket/SSE broadcast.**
   - **Chat (Gaps in REST mutations)**:
     - `PUT /api/messages/:id` (line 9492): updates DB content/edited_at. **Does NOT call `broadcastChatUpdate`.**
     - `DELETE /api/messages/:id` (line 9503): sets DB deleted_at. **Does NOT call `broadcastChatUpdate`.**
     - `POST /api/messages/:id/pin` (line 9511): inserts/deletes pinned messages. **Does NOT call `broadcastChatUpdate`.**
     - `POST /api/messages/:id/reactions` (line 9530): inserts/deletes reactions. **Does NOT call `broadcastChatUpdate`.**
     - `POST /api/conversations` (line 9101): creates conversation. **Does NOT broadcast to target member IDs.**
   - **Attendance & Overtime**:
     - `POST /api/attendance/register` (line 5763), `checkin` (line 5791), `checkout` (line 5841), `location-review` (line 5987): updates D1 attendance records. **No broadcast call exists.**
     - `POST /api/overtime-requests` (line 6020), `/approve|reject` (line 6043), `overtime-forms` (line 6088): **No broadcast call exists.**
   - **Leave Requests**:
     - `POST /api/leave` (line 7695), `PUT /api/leave/:id` (line 7776), `DELETE /api/leave/:id` (line 7810), `POST /api/leave/balances` (line 7623): updates D1 tables. **No broadcast call exists.**
   - **Payroll & Invoices**:
     - `POST /api/payroll/load` (line 7995), `batch` (line 8066), `export-payslips` (line 8108), `PUT /api/payroll/:id` (line 8245), `POST /api/invoices/:id/confirm` (line 7326), `review-request` (line 7346), `resolve-review` (line 7376): updates D1 tables. **No broadcast call exists.**
   - **User Profiles & Roles**:
     - `POST /api/users` (line 4994), `PUT /api/users/:id` (line 5295), `PUT /api/users/:id/lifecycle` (line 5386): updates D1 users/sessions/history. **No broadcast call exists.**

4. **Client-Side Polling & Cache Invalidation**:
   - `src/app.js` (lines 300–303):
     ```javascript
     if (!_chatUnreadTimer) _chatUnreadTimer = window.setInterval(() => {
       refreshChatHeaderSummary();
       refreshEmployeeAlertBadge();
     }, 10_000);
     ```
     Polling occurs every 10 seconds for header counters only.
   - `src/api.js` (lines 40–63):
     In-memory cache with 30s TTL for `/api/leave-types`, `/api/departments`, `/api/wifi-whitelist`, `/api/attendance-locations`. No cross-client cache invalidation exists.

5. **Edge Cases (Heartbeat, Missed Events, Replay)**:
   - Zero ping/pong heartbeat messages exist in `ChatRoom` or `chat.js`.
   - Zero sequence numbers, event logs, or replay cursors exist in the database or DO memory.
   - Tab sleep only triggers `refreshChatHeaderSummary()` on `visibilitychange` (lines 270–277 of `src/app.js`), without verifying WebSocket liveness or invalidating stale view models.

---

## 2. Logic Chain

1. From **Observation 1 & 2**, the only existing real-time transport is the `ChatRoom` Durable Object, which is isolated per conversation and active only when a user is inside that specific chat room view.
2. From **Observation 3**, every other core HR feature (Tasks, Subtasks, Comments, Attendance, Overtime, Leave, Payroll, Payslips, Profiles, Roles, Settings) executes SQL mutations against D1 and returns an HTTP response without notifying any other connected clients. Even within the Chat module, several REST mutation handlers (`PUT /api/messages/:id`, `DELETE /api/messages/:id`, `pin`, `reactions`, `create conversation`) omit the `broadcastChatUpdate` hook.
3. Therefore, whenever User A mutates data in any of these modules (e.g. completes a task, checks in, approves a leave request, confirms a payslip, or updates an employee role), User B's browser has zero transport mechanism to receive this change in real-time.
4. From **Observation 4**, User B only discovers new chat messages in other rooms or new alerts via a 10-second polling interval in `app.js`. For main view content (such as the Kanban board, task list, leave list, attendance report, and payroll overview), User B will continue viewing stale data indefinitely until User B manually hits `F5` (or switches views).
5. From **Observation 5**, network drops or background tab throttling cause missed real-time events that cannot be recovered because there is no sliding event buffer, no event IDs, and no application heartbeat.
6. **Conclusion**: Achieving cross-client synchronization requires:
   - Introducing an app-wide persistent Real-Time Sync transport (such as an `AppSyncHub` Durable Object with topic subscriptions).
   - Injecting a standardized `broadcastAppEvent(env, topic, payload)` helper across all mutation handlers in `server.js`.
   - Wiring client-side reactive event listeners in `src/api.js`, `src/app.js`, and all `src/views/*` controllers.
   - Adding heartbeat ping/pong, sliding replay buffer, and tab-wake synchronization.

---

## 3. Caveats

- **Load / Resource Scaling on Cloudflare Workers Free/Paid Tier**: A single global `AppSyncHub` Durable Object easily handles concurrent WebSockets for small-to-medium organizations (hundreds of simultaneous users). For thousands of simultaneous connections across multiple locations, topic-partitioned DOs or Cloudflare PubSub/Queues could be evaluated in the future.
- **R2 Storage Operations**: Document uploads (`task_attachments`, `leave_documents`, `employee_documents`) upload binary blobs to R2 and then write metadata to D1. Real-time broadcast should broadcast the D1 metadata event, not binary data.

---

## 4. Conclusion

The NetViet HR backend currently lacks real-time event broadcasting for 95% of its functionality, and the Chat module has notable REST broadcast omissions. 

To remediate this:
1. Implement `AppSyncHub` DO in `src/sync-hub.js` and register in `wrangler.toml`.
2. Connect a single app-wide WebSocket in `src/app.js` upon user login.
3. Add `broadcastAppEvent(env, topic, event)` across all mutation endpoints in `server.js`.
4. Fix missing `broadcastChatUpdate` calls in `server.js` for message edits, deletions, pins, and reactions.
5. Implement client-side cache invalidation and view-level event subscribers.
6. Implement 30s ping/pong heartbeats and a 100-event sliding replay buffer.

---

## 5. Verification Method

To independently verify the observations:
1. Inspect `wrangler.toml` to verify bindings: `view_file` on `wrangler.toml`.
2. Check `server.js` for calls to `broadcastChatUpdate`: `grep_search` with query `broadcastChatUpdate` in `server.js` (only 8 calls found, all in Chat, with REST edit/delete/pin/reactions missing).
3. Search `server.js` for any broadcast call in `tasks`, `attendance`, `leave`, `payroll`: `grep_search` for `broadcast` in `server.js` lines 5000–8500 (0 results found).
4. Inspect `src/app.js` lines 289–322: verify the 10,000ms polling timer `_chatUnreadTimer`.
5. Run test suite: `npm test` or `node tests/employee-profile-smoke.mjs` / `node tests/geofence.mjs`.
