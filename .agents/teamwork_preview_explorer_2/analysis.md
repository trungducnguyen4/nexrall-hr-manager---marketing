# Technical Analysis: Frontend Architecture & Real-Time Reactivity Audit

**Author**: Explorer 2 (Frontend Architecture & Reactivity Specialist)  
**Date**: 2026-08-27  
**Scope**: `src/api.js`, `src/app.js`, `src/views/*`, `src/chat-room.js`, `index.html`, Client-side Reactivity & State Architecture

---

## 1. Executive Summary

A comprehensive architectural audit of the NetViet HR frontend was conducted to evaluate multi-client real-time synchronization. The audit reveals that **the client application operates primarily as a static, single-user Single Page Application (SPA) with isolated REST polling and localized cache invalidation**.

### Key Architectural Findings:
1. **Fragmented Real-Time Transport**:
   - WebSocket transport exists **only** for individual chat rooms (`ChatRoom` Durable Object at `/api/chat/ws/:convId`), instantiated exclusively when a user enters a specific chat conversation.
   - Global application state (header alerts, task mention badges, unread chat count) relies on disconnected `setInterval` HTTP polling (10s and 30s timers).
   - All other domain modules (Tasks, Attendance, Leave, Payroll, Payslips, Invoices, Users, KPIs, Evaluations, Recruitment, Departments, Assets) have **zero real-time transport** (no SSE, no global WebSocket, no automated polling).
2. **One-Way Local Mutation Invalidation**:
   - `src/api.js` defines an invalidation helper `inv(...prefixes)` that clears memory cache in `_cache` and emits a local DOM `CustomEvent('hr-data-mutated')`.
   - This event is **only dispatched on the mutating client's browser window**. It never crosses client boundaries.
   - Even on the mutating client, `app.js` only listens to `hr-data-mutated` to refresh the alert and mention badges; active view DOMs (such as Kanban boards or Attendance tables) are not wired to re-render from `hr-data-mutated`.
3. **Mount-Once View Lifecycles & Stale Closures**:
   - 17 of 20 views (`tasks.js`, `leave.js`, `dashboard.js`, `payroll.js`, `invoices.js`, etc.) fetch data strictly once when their `render<View>` entrypoint is invoked by the hash router.
   - Views store state in closure variables (`tasks = []`, `cachedLeaveList = []`, `userBalances = []`) that are unreachable after mounting.
   - 17 views lack `_cleanup` hooks, leading to lingering `document.addEventListener` bindings (e.g. `tasks.js` lines 685, 1479, 1480), leaking closures and running callbacks against detached DOM nodes.
4. **Required Remediation**:
   - Introduce a **Unified Real-Time Event Stream** (SSE `/api/events` or Global WS `/api/ws`) connected on session boot.
   - Establish a **Frontend Reactive Event Bus (`src/event-bus.js`)** that routes server events to domain listeners.
   - Standardize **View Lifecycle & Auto-Subscription Cleanup** across all `src/views/*` modules to eliminate stale closures and achieve flicker-free UI updates without manual reloads (F5).

---

## 2. Real-Time Transport & Stream Connection Analysis

### 2.1 Current Implementation Breakdown

| Component / View | Current Transport Mechanism | Real-Time Latency | Disconnection / Background Behavior |
|---|---|---|---|
| **Chat Room Active View** (`src/views/chat.js`) | WebSocket to Cloudflare DO (`/api/chat/ws/:convId`) | ~50ms (instant) | Disconnects intentionally (`disconnectWS()`) when switching conversations or navigating away from chat. Reconnects on error with exponential backoff (up to 30s). |
| **Chat Global Badges & Attention Chips** (`src/app.js`) | Polling `GET /api/chat/header-summary` via `setInterval` every 10s | 0 – 10 seconds | Runs continuously while logged in; re-triggers on `visibilitychange` & `window.focus`. |
| **Task Mentions Badge** (`src/app.js`) | Polling `GET /api/notifications/task-mentions/unread-count` via `setInterval` every 30s | 0 – 30 seconds | Runs continuously; re-triggers on window focus. |
| **Notification Center Alerts** (`src/app.js`) | Polling `GET /api/notifications` via `setInterval` every 10s | 0 – 10 seconds | Runs continuously; re-triggers on window focus. |
| **Tasks & Kanban Boards** (`src/views/tasks.js`) | **None** (REST GET on mount only) | $\infty$ (Requires F5 or re-navigation) | No live connection, no polling. |
| **Task Slide-out Panel** (`src/views/taskpanel.js`) | **None** (REST GET on open only) | $\infty$ (Requires closing and re-opening) | No live connection, no polling. |
| **Attendance & Live GeoMap** (`src/views/attendance.js`) | **None** (REST GET on mount only) | $\infty$ (Requires manual button click or F5) | Clock ticks locally; server attendance records never push. |
| **Leave Management** (`src/views/leave.js`) | **None** (REST GET on mount only) | $\infty$ (Requires F5 or tab switch) | No live connection, no polling. |
| **Payroll & Invoices / Payslips** (`src/views/payroll.js`, `src/views/invoices.js`) | **None** (REST GET on mount only) | $\infty$ (Requires F5 or filter trigger) | No live connection. |
| **Employee Directory & Profiles** (`src/views/users.js`) | **None** (REST GET on mount only) | $\infty$ (Requires F5 or filter change) | No live connection. |
| **Dashboard** (`src/views/dashboard.js`) | **None** (REST GET on mount only) | $\infty$ (Requires F5) | No live connection. |

### 2.2 Transport Gaps & Limitations
1. **No Shared Event Infrastructure**: Chat is the only module wired to a Durable Object. There is no central pub/sub hub on the backend to broadcast data mutations to connected clients.
2. **Inefficient Polling Overhead**: Running multiple periodic timers (10s header summary, 10s notifications, 30s task mentions) causes unnecessary HTTP requests, battery drain on mobile PWA, and still results in up to 30 seconds of lag.
3. **Session Interruption**: When a user switches browser tabs, timers continue or pause depending on browser throttling; on return (`hr-window-focused`), requests burst simultaneously.

---

## 3. State Management, Caches, Lifecycle & Stale Closures

### 3.1 `src/api.js` In-Memory Cache Audit
```javascript
// src/api.js lines 39-46
const CACHE_TTL = {
  '/api/integrations/vietqr/banks': 24 * 60 * 60_000,
  '/api/leave-types':               30_000,
  '/api/departments':               30_000,
  '/api/wifi-whitelist':            30_000,
  '/api/attendance-locations':      30_000,
};
```
- `_cache` is a module-scoped `Map`. `cachedGet()` provides stale-while-revalidate for matching prefixes.
- **Limitation**: All transactional endpoints (`/api/tasks`, `/api/leave`, `/api/attendance`, `/api/invoices`, `/api/payroll`, `/api/users`, etc.) return `ttl = 0` (bypassing `_cache`). Therefore, data caching is completely non-existent for dynamic entities at the API client layer.
- **Local Invalidation (`inv`)**:
  ```javascript
  function inv(...prefixes) {
    _writeGen++;
    prefixes.forEach(p => invalidateCache(p));
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('hr-data-mutated', { detail: { prefixes } }));
    }
  }
  ```
  `inv()` only affects the local browser window. It cannot notify other tabs or other users.

### 3.2 View Mount & Router Lifecycle (`src/app.js`)
```javascript
// src/app.js lines 673-706
if (_activeViewCleanup) {
  try { _activeViewCleanup(); } catch (error) { console.warn('View cleanup failed', error); }
}
_activeViewCleanup = null;
if (_activeViewNode) _activeViewNode.remove();
_activeViewNode = null;
contentEl.querySelectorAll(':scope > .view-container').forEach(node => node.remove());

const viewNode = document.createElement('div');
viewNode.className = 'view-container';
viewNode.dataset.view = routeKey;
contentEl.appendChild(viewNode);

...
await mod[fnName](viewNode, me, { hash, routeKey, segments });
_activeViewNode = viewNode;
_activeViewCleanup = viewNode._cleanup || null;
```

#### The View Cleanup Deficit:
Out of 20 view modules in `src/views/`, only **3 modules** set `el._cleanup`:
1. `src/views/attendance.js`: Clears `clockInterval` and destroys Leaflet map instance.
2. `src/views/chat.js`: Removes body CSS classes, disconnects WebSocket, and clears conversation timers.
3. `src/views/users.js`: Clears `searchTimer`.

**The other 17 view modules do NOT register `el._cleanup`**.

### 3.3 Stale Closures and Memory Leak Analysis

1. **`src/views/tasks.js` Document Listener Accumulation**:
   - Line 685: `document.addEventListener('click', ...)` attached for dropdown dismissals.
   - Line 1479: `document.addEventListener('task-copied', () => { if (selectedProjectId) loadBoard(); }, { once: false });`
   - Line 1480: `document.addEventListener('task-mentions-read', async () => { ... }, { once: false });`
   - **Impact**: Every time the user navigates to `#/tasks`, new event listeners are attached to `document`. When `task-copied` or `task-mentions-read` fires, all historical closure instances execute concurrently, referencing stale `selectedProjectId` values and attempting to manipulate detached DOM trees.
2. **`src/views/chat.js` Lightbox Keydown Listener**:
   - Line 2205: `document.addEventListener('keydown', handleLightboxKeydown);` is bound globally and never removed in `el._cleanup`.
3. **Internal Module/Closure State Isolation**:
   - In `tasks.js`, `projects`, `groups`, `tasks`, and `projectMembers` are local variables inside `renderTasks`.
   - When a task mutation occurs externally, there is no exported API or event handler to trigger `loadBoard()` or patch the internal `tasks` array.

---

## 4. Comprehensive Per-View Real-Time Reactivity Audit

The following matrix documents the exact behavior of every view and sub-view in the NetViet HR application when shared data mutations occur:

| View Module & Path | Shared Data Entity | Current Behavior when User A Mutates Data | User B Experience (No F5) | Required Reactive Event & Handling |
|---|---|---|---|---|
| **Tasks Board** (`src/views/tasks.js`) | Tasks, Subtasks, Columns/Groups, Projects, Labels | User A's view calls internal `loadBoard()` via callback. | **Completely stale**. User B sees old task positions, deleted tasks, old titles. Drag-and-drop conflicts occur if User B moves a card that User A already modified. | Event: `tasks:changed`, `task:created`, `task:updated`, `task:deleted`, `task:reordered`, `task_group:changed`<br/>Action: Surgical DOM update or atomic `loadBoard()` reload. |
| **Task Details Panel** (`src/views/taskpanel.js`) | Task description, assignees, subtask completion, followers, attachments | User A calls `loadTask()`. | **Completely stale**. If User B has panel open for Task #123, User A's edits or subtask checks never appear. | Event: `task:updated:{taskId}`, `task:comment_added:{taskId}`, `subtask:updated:{taskId}`<br/>Action: Dynamically append comments, toggle checkboxes, update status pills. |
| **Task Mentions & Comments** (`src/views/taskpanel.js`, `src/app.js`) | Task comments with `@mentions` | User A posts comment; local client emits `task-mentions-read` on read. | User B waits up to 30 seconds for `_mentionBadgeTimer` to poll. Panel comments do not appear in real-time. | Event: `task:mention:{userId}`, `task:comment_added`<br/>Action: Instant badge increment, play chime (`playMentionSound()`), append comment to open panel. |
| **Chat Room** (`src/views/chat.js`) | Conversation messages, reactions, polls, events | Broadcast via `ChatRoom` DO to WebSocket. | **Real-time ONLY IF User B is actively inside that specific conversation**. If User B is in conversation list or another route, receives no instant update. | Event: `chat:message_new`, `chat:unread_count`, `chat:conversation_updated`<br/>Action: Update conversation snippet in sidebar list, increment unread badge, play audio chime. |
| **Header Attention Chips** (`src/app.js`) | Urgent mentions (`@all` or `@user`), upcoming meetings | Fetched via 10s poll `/api/chat/header-summary`. | Delayed by 0–10s. If dismissed on one device, other device stays open until poll. | Event: `chat:attention_update`<br/>Action: Immediately display or clear chips without polling delay. |
| **Notification Center** (`src/views/notifications.js`) | HR Alerts (probation due, contract expiry, late/early flags) | Invalidation clears cache; badge polls every 10s. | Notification list on `#/notifications` is **static**. New alerts or status dismissals do not appear without manual "Làm mới" button click. | Event: `notification:new`, `notification:resolved`<br/>Action: Prepend new alert card with slide-in animation, update severity counters. |
| **Attendance & Live Map** (`src/views/attendance.js`) | Check-in / Check-out records, GPS locations, OT requests | Invalidation dispatches `hr-data-mutated`. | Admin viewing live attendance GeoMap or attendance table does not see arriving employees in real-time. | Event: `attendance:checkin`, `attendance:checkout`, `attendance:ot_requested`<br/>Action: Add marker to GeoMap, prepend row in attendance table. |
| **Leave Management** (`src/views/leave.js`) | Leave requests, manager decisions, leave balances | Invalidation dispatches `hr-data-mutated`. | Manager does not see new leave requests; employee does not see approval/rejection status change. | Event: `leave:created`, `leave:status_updated`, `leave:balance_updated`<br/>Action: Update KPI counter cards (`kpi-pending-val`), update row status badge. |
| **Payroll & Payslips** (`src/views/payroll.js`, `src/views/invoices.js`, `src/views/payslip-detail.js`) | Monthly payroll calculations, payslip confirmations, review requests | Local client triggers `loadPayrollData()`. | Employee does not see payslip published; HR does not see `review_requested` or `confirmed` status updates. | Event: `payroll:published`, `invoice:status_changed`<br/>Action: Update invoice status pill, reload payroll summary cards. |
| **User Directory & Profile** (`src/views/users.js`, `src/app.js`) | Employee profiles, avatar uploads, lifecycle status, salary/contract | Local `hr-avatar-updated` updates current user's header avatar. | Other users viewing Directory or Profile see old data. Role/permission changes require re-login. | Event: `user:updated`, `user:avatar_changed`, `user:lifecycle_changed`<br/>Action: Update user row in directory, refresh profile view if open. |
| **Dashboard** (`src/views/dashboard.js`) | Task metrics, Attendance rings, Leave/OT summaries, Admin overview | Rendered once on mount. | Widgets become increasingly stale as the day progresses. | Event: Domain events (`task:*`, `attendance:*`, `leave:*`)<br/>Action: Selectively invalidate and re-render dashboard summary cards. |
| **Organization & Departments** (`src/views/departments.js`) | Department structure, manager assignments, headcounts | Local mutation updates caller. | Other users see old structure. | Event: `department:updated`, `department:member_changed`<br/>Action: Refresh department grid. |
| **Recruitment** (`src/views/recruitment.js`) | Candidates, interview stages, evaluation notes | Local mutation updates caller. | HR team members see desynchronized candidate pipelines. | Event: `candidate:created`, `candidate:stage_changed`<br/>Action: Move candidate card across Kanban stages. |
| **Marketing Campaigns** (`src/views/campaigns.js`) | Marketing campaigns, budgets, schedules | Local mutation updates caller. | Marketing team sees stale campaign statuses. | Event: `campaign:updated`<br/>Action: Update campaign table/cards. |
| **Performance Evaluation & KPIs** (`src/views/evaluation.js`, `src/views/kpis.js`) | Evaluation periods, reviews, KPI templates & submissions | Local mutation updates caller. | Reviewers/Employees see outdated review workflows. | Event: `evaluation:submitted`, `evaluation:reviewed`, `kpi:status_changed`<br/>Action: Update evaluation status badges and scores. |
| **Asset Handover** (`src/views/assets.js`) | Handover credentials, asset logs | Local mutation updates caller. | Handover recipients do not see newly assigned assets. | Event: `asset:created`, `asset:status_changed`<br/>Action: Refresh asset table. |
| **WiFi & Location Config** (`src/views/wifi.js`) | Office GPS coordinates, WiFi BSSID whitelists | Invalidation updates local cache. | Employees checking in immediately after admin config may be blocked by stale cached coordinates. | Event: `location_config:updated`<br/>Action: Purge cache and reload whitelist. |

---

## 5. Architectural Recommendations: Reactive Event Bus & State Store

To ensure smooth, flicker-free, instant UI updates across all views without requiring F5, we propose a 4-tier reactive architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                        │
│   (Mutations publish events to Global Realtime Stream)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ SSE / Global WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Client Stream Handler (`src/realtime.js`)       │
│    - Session authentication                                 │
│    - Reconnection with exponential backoff & jitter         │
│    - Tab visibility & focus re-sync                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ Server Event
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           Reactive Event Bus (`src/event-bus.js`)           │
│    - Type-safe publish / subscribe                          │
│    - View-scoped subscription with automatic cleanup        │
│    - Debounced batch dispatching                            │
└──────────────────────────────┬──────────────────────────────┘
                               │ Domain Events
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
┌────────────────────────────────┐ ┌──────────────────────────┐
│   Global Shell State Manager   │ │     Active Route View    │
│       (`src/app.js`)           │ │   (`src/views/<view>.js`)│
│  - Alert badges                │ │  - Surgical DOM updates  │
│  - Task mention badges         │ │  - Table / card patching │
│  - Attention chips             │ │  - Registered cleanup    │
│  - Audio chimes                │ │    lifecycle             │
└────────────────────────────────┘ └──────────────────────────┘
```

### 5.1 Tier 1: Client Realtime Transport Client (`src/realtime.js`)
- Uses Server-Sent Events (SSE) via `EventSource` connected to `/api/events` (or a multiplexed Global WebSocket `/api/ws`).
- Passes `X-Auth-Token` (or auth query parameter) on connection.
- Implements:
  - Heartbeat / ping mechanism (every 30s).
  - Exponential backoff reconnect ($1\text{s}, 2\text{s}, 4\text{s}, 8\text{s}, \dots, 30\text{s}$).
  - Immediate reconnect & state revalidation on `window.focus` and `document.visibilityState === 'visible'`.

### 5.2 Tier 2: Reactive Event Bus (`src/event-bus.js`)
A lightweight, high-performance publish-subscribe bus with view lifecycle awareness:

```javascript
// Architecture Prototype: src/event-bus.js
class ReactiveEventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) this._listeners.delete(event);
    }
  }

  emit(event, payload) {
    // Exact match listeners
    const set = this._listeners.get(event);
    if (set) set.forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } });

    // Wildcard listeners (e.g. 'tasks:*')
    const parts = event.split(':');
    if (parts.length > 1) {
      const wildcard = `${parts[0]}:*`;
      const wildSet = this._listeners.get(wildcard);
      if (wildSet) wildSet.forEach(cb => { try { cb(payload, event); } catch (e) { console.error(e); } });
    }
  }

  // Helper for route views: automatically unbinds when viewNode is cleaned up
  bindView(viewNode, event, callback) {
    const unsub = this.on(event, callback);
    const prevCleanup = viewNode._cleanup;
    viewNode._cleanup = () => {
      unsub();
      if (typeof prevCleanup === 'function') prevCleanup();
    };
    return unsub;
  }
}

export const eventBus = new ReactiveEventBus();
```

### 5.3 Tier 3: Standardized View Lifecycle & Cleanup Contract
Every module in `src/views/` must adhere to the lifecycle pattern:
1. `render<View>(el, me, route)` registers `el._cleanup = () => { ... }`.
2. All `document` / `window` event listeners and `eventBus` subscriptions are tied to `el._cleanup`.
3. When `route()` tears down `_activeViewNode`, `_activeViewCleanup()` cleanly releases all listeners.

### 5.4 Tier 4: Flicker-Free UI Update Strategies
To avoid jarring full-page flashes when real-time updates arrive:
1. **Targeted DOM Patching**:
   - When a task card is updated (e.g. status changed from `todo` to `done`), find the element by `[data-task-id="..."]` and move it to the target column or update its status badge directly.
2. **Smooth Skeleton Transitions**:
   - For collection-level updates (e.g. project board load), debounce updates by 150ms to merge rapid multi-card drag events.
3. **Optimistic Updates with Server Confirmation**:
   - User A modifies card $\rightarrow$ DOM updates instantly $\rightarrow$ API request sent $\rightarrow$ Server broadcasts event to other clients $\rightarrow$ User B updates seamlessly.

---

## 6. Implementation Roadmap for Remediation

1. **Step 1: Real-Time Bus & Transport Module**
   - Create `src/event-bus.js` (Reactive Event Bus).
   - Create `src/realtime.js` (SSE / WS client with heartbeat, reconnect, and auth).
   - Wire `src/app.js` to initialize `realtime` on boot and dispatch incoming events into `eventBus`.
2. **Step 2: Replace Polling in `src/app.js` with Real-Time Subscriptions**
   - Replace 10s and 30s `setInterval` polling with reactive listeners on `chat:unread_count`, `notification:new`, `task:mention`.
3. **Step 3: Retrofit Core Views for Real-Time Reactivity**
   - Refactor `src/views/tasks.js` & `src/views/taskpanel.js`: subscribe to `tasks:*`, fix document listener leaks, implement surgical card updates.
   - Refactor `src/views/chat.js`: tie global and room-level chat events cleanly through the event bus.
   - Refactor `src/views/attendance.js`: live GeoMap updates on `attendance:checkin`.
   - Refactor `src/views/leave.js`: live badge and counter updates on `leave:status_updated`.
   - Refactor `src/views/payroll.js`, `src/views/invoices.js`, `src/views/users.js`, `src/views/notifications.js`.
4. **Step 4: Systematic View Cleanup Verification**
   - Audit all 20 views to ensure `el._cleanup` is defined and removes all attached DOM listeners and bus handlers.
