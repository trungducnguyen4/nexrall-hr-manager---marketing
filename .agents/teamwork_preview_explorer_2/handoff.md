# Handoff Report: Frontend Architecture & Reactivity Specialist

**Agent**: Explorer 2 (Frontend Architecture & Reactivity Specialist)  
**Target Directory**: `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_2`  
**Date**: 2026-08-27  
**Milestone**: Real-Time Synchronization Audit & Remediation

---

## 1. Observation

1. **WebSocket & Durable Object Scope**:
   - In `src/chat-room.js` (lines 11–60) and `worker.js` (lines 2, 54), `ChatRoom` Durable Object is the only DO class registered and is used exclusively for chat WebSocket upgrades at `/api/chat/ws/:convId`.
   - In `src/views/chat.js` (lines 1663–1747), WebSocket connections are established only when `connectWS(convId)` is called inside an active conversation, and are immediately torn down via `disconnectWS()` when navigating away.
2. **Client Polling & Local Mutation Invalidation**:
   - In `src/app.js` (lines 300–304, 357), background polling is implemented using `setInterval`:
     - `_chatUnreadTimer = window.setInterval(..., 10_000)` polling `/api/chat/header-summary` and `/api/notifications`.
     - `_mentionBadgeTimer = setInterval(refreshTaskMentionBadge, 30_000)` polling `/api/notifications/task-mentions/unread-count`.
   - In `src/api.js` (lines 171–177), `inv(...prefixes)` only clears local in-memory `_cache` and dispatches `document.dispatchEvent(new CustomEvent('hr-data-mutated', { detail: { prefixes } }))`. This event is local to the mutating browser window.
   - In `src/app.js` (lines 284–287), `onDataMutated` only refreshes `employeeAlertBadge` and `taskMentionBadge` on the local mutating client.
3. **Mount-Once Lifecycle & Stale Closures**:
   - In `src/app.js` (lines 657–716), the router removes previous `viewNode`, creates a new `div.view-container`, imports the module, and executes `render<View>(viewNode, me, route)`.
   - Out of 20 view modules in `src/views/`, only 3 modules implement `el._cleanup`:
     - `src/views/attendance.js` (line 162)
     - `src/views/chat.js` (line 58)
     - `src/views/users.js` (line 361)
     - The remaining 17 views (`tasks.js`, `dashboard.js`, `leave.js`, `payroll.js`, `invoices.js`, `notifications.js`, etc.) do not set `el._cleanup`.
   - In `src/views/tasks.js` (lines 685, 1479, 1480), `document.addEventListener('click', ...)`, `document.addEventListener('task-copied', ...)`, and `document.addEventListener('task-mentions-read', ...)` are attached on every `renderTasks` call without cleanup, accumulating duplicate event listeners and retaining stale closures on dead DOM references.
4. **Zero Cross-Client Reactivity for Domain Modules**:
   - None of `src/views/tasks.js`, `src/views/attendance.js`, `src/views/leave.js`, `src/views/payroll.js`, `src/views/invoices.js`, `src/views/notifications.js`, `src/views/dashboard.js`, or `src/views/users.js` listen to any server event stream.

---

## 2. Logic Chain

1. **Premise 1 (Transport)**: Since `ChatRoom` DO WebSocket is the only real-time channel and is active only when a user is in an open chat conversation, any user on any other page (e.g. Tasks, Attendance, Leave, Payroll) has **zero** real-time transport connection to the backend.
2. **Premise 2 (Polling Delay & Incomplete Scope)**: Since background polling in `src/app.js` only checks header summary counts (every 10s–30s) and never polls task lists, kanban columns, attendance logs, or leave requests, User B's active view data remains completely unrefreshed when User A mutates data.
3. **Premise 3 (Local-Only Mutation Dispatch)**: Because `src/api.js:inv()` dispatches `hr-data-mutated` strictly on `document` within the mutating client's own execution context, User B receives zero notification of User A's mutations.
4. **Premise 4 (Lifecycle & Leaks)**: Because 17 views do not register `_cleanup` functions and attach global event listeners (such as in `tasks.js`), navigating between routes causes memory leaks, duplicate callbacks, and stale closures.
5. **Conclusion**: Achieving real-time multi-client synchronization across NetViet HR requires:
   - Establishing a persistent real-time transport (SSE `/api/events` or Global WS) connected upon login.
   - Implementing a client-side Reactive Event Bus (`src/event-bus.js`) with automatic lifecycle-scoped unbinding.
   - Refactoring all domain views to subscribe to domain events, perform surgical/flicker-free DOM patching, and register complete `el._cleanup` routines.

---

## 3. Caveats

- **Network Constraints**: In environments with strict corporate proxies, WebSocket connections might be blocked; a Server-Sent Events (SSE) stream or HTTP long-polling fallback should be supported alongside WebSockets.
- **Backend Publishing Dependency**: This analysis focuses on the frontend client layer. Real-time delivery to the frontend is contingent on the backend worker/Durable Objects broadcasting events whenever mutations occur in D1 database handlers.

---

## 4. Conclusion

The NetViet HR frontend currently lacks real-time reactivity outside of individual active chat rooms. All other views rely on static mount-time fetches and suffer from stale closures and lack of cleanup. 

Implementing the proposed 4-tier reactive architecture (**Client Stream Handler $\rightarrow$ Reactive Event Bus $\rightarrow$ Shell State Manager $\rightarrow$ Lifecycle-Managed Reactive Views**) will completely eliminate the need for manual page refreshes (F5), replace inefficient polling intervals, prevent memory leaks, and guarantee instant, flicker-free synchronization across all users.

Detailed architectural recommendations and per-view reactivity matrices are published in:  
`d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_2\analysis.md`.

---

## 5. Verification Method

1. **Verify WebSocket Transport Scope**:
   - Inspect `src/chat-room.js` (lines 11–60) and `worker.js` (lines 1–55). Confirm that only `ChatRoom` is configured for WebSockets.
   - Inspect `src/views/chat.js` (lines 1663–1756) to confirm WebSocket lifecycle is bound only to open conversations.
2. **Verify Polling & Invalidation Mechanics**:
   - Inspect `src/app.js` (lines 300–304, 357) for `setInterval` timers.
   - Inspect `src/api.js` (lines 171–177) for `CustomEvent('hr-data-mutated')` local dispatch.
3. **Verify View Cleanup Coverage**:
   - Run grep search `_cleanup` across `src/views/`:
     Only `attendance.js`, `chat.js`, and `users.js` define `el._cleanup`.
4. **Verify Memory Leak in Tasks**:
   - Inspect `src/views/tasks.js` lines 685, 1479, 1480 for unbounded `document.addEventListener` registrations.
