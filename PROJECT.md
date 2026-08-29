# Project: NetViet HR Real-Time Synchronization Audit & Remediation

## Architecture
The real-time synchronization architecture establishes a multi-tenant, bi-directional event distribution pipeline connecting Cloudflare Workers / Durable Objects backend with a reactive, event-driven vanilla ES module frontend:

`
[User A Client] ──(REST Mutation)──> [Cloudflare Worker: server.js]
                                            │
                                            ├──> Writes to D1 Database (SQLite)
                                            │
                                            └──> Calls broadcastAppEvent(env, topic, payload)
                                                        │
                                                        ▼
                                            [Durable Object: AppSyncHub]
                                                        │
                                                        ├── WS / SSE Stream
                                                        ▼
                                            [User B Client: src/realtime.js]
                                                        │
                                                        ▼
                                            [Frontend Event Bus: src/event-bus.js]
                                                        │
                                    ┌───────────────────┴───────────────────┐
                                    ▼                                       ▼
                    [src/api.js Cache Invalidation]          [Active View DOM Reactive Patch]
                    (clears stale in-memory cache)           (e.g., tasks.js, leave.js, chat.js)
`

## Feature Inventory
Every feature domain from the survey is inventoried below with exact milestone assignments and event specifications:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Tasks & Subtasks CRUD | Real-time creation, status change, reorder, assignment, subtask toggling, deletion | M1, M2, M3 | survey |
| 2 | Task Comments & Mentions | Live comment posting, @mention alerts, live task comment thread sync | M1, M2, M3 | survey |
| 3 | Chat Conversations & Messages | Direct/group messaging, live typing, edits, deletes, pins, reactions, unread count | M1, M2, M3 | survey |
| 4 | Notifications & Live Badges | Instant badge count increment/decrement, popup toast notifications, mark-as-read sync | M1, M2, M3 | survey |
| 5 | Attendance Check-in/out | Live check-in status reflection in team list, location review approval/rejection sync | M1, M2, M3 | survey |
| 6 | Leave Requests & Approvals | Real-time leave submission, manager approval/rejection, balance recalculation | M1, M2, M3 | survey |
| 7 | Payroll & Overtime Records | Live overtime request submission & approvals, payroll batch calculation, payslip confirmation | M1, M2, M3 | survey |
| 8 | User Profiles & Roles | Live profile update (avatar, name), role & department permission change propagation | M1, M2, M3 | survey |
| 9 | Real-Time Transport Core | AppSyncHub DO, WebSocket /api/realtime/ws, SSE /api/realtime/events, Heartbeat & Replay | M1, M2 | survey |
| 10 | Two-Client Sync Test Suite | Multi-client automated integration test suite verifying instant cross-client sync without F5 | M4, E2E | survey |
| 11 | Deployment & Verification | sync-to-deploy.ps1 bundle synchronization, Worker syntax check, zero test regressions | M5 | survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend Real-Time Core & Broadcast Pipeline | AppSyncHub Durable Object (`src/sync-hub.js`), `wrangler.toml` & `worker.js` bindings, universal `broadcastAppEvent()` in `server.js`, and chat REST broadcast fixes | none | DONE |
| M2 | Frontend Client Sync Engine & Reactive Event Bus | `src/realtime.js` connection client, `src/event-bus.js` reactive bus, `src/api.js` cache invalidation, and `src/app.js` polling removal | M1 | DONE |
| M3 | Feature Domain View Reactivity & Cleanup | Refactor all views (`src/views/*`) with `el._cleanup`, event subscriptions, and surgical DOM updates | M2 | DONE |
| M4 | Automated Two-Client Sync Test Suite & Audit Report | Complete two-client test suite across all 8 domains + Real-Time Feature Matrix audit report | M3 | IN_PROGRESS |
| M5 | Build & Deployment Verification | Run sync-to-deploy.ps1, verify .local-public/ build health, worker validation, regression checks | M4 | PLANNED |

## Interface Contracts
### Backend Event Envelope ( roadcastAppEvent -> AppSyncHub -> Client)
`	ypescript
interface RealtimeEvent<T = any> {
  id: string;          // Monotonic event ID (e.g., 'evt_1724749200_1234')
  seq: number;         // Monotonic sequence number
  topic: string;       // E.g., 'tasks', 'chat', 'notifications', 'attendance', 'leave', 'payroll', 'users'
  event: string;       // E.g., 'task:created', 'task:updated', 'comment:created', 'leave:approved'
  payload: T;          // Structured domain payload
  actorId: number;     // User ID who triggered the mutation
  targetUserIds?: number[]; // Optional whitelist of target user IDs (omitted for public/topic broadcast)
  timestamp: string;   // ISO 8601 UTC timestamp
}
`

### Client Event Bus Contract (src/event-bus.js)
`javascript
// Global subscription
EventBus.on(topic, handler); // returns unsubscribe function

// View-scoped subscription (auto-cleans on view removal)
EventBus.bindView(viewElement, topic, handler);

// Emission from realtime client
EventBus.emit(topic, eventData);
`

### View Lifecycle Contract (src/views/*.js)
`javascript
export async function renderView(el, me, route) {
  // 1. Initial render & data load
  // 2. EventBus.bindView(el, 'topic', (event) => { /* update DOM reactively */ });
  // 3. Register cleanup
  el._cleanup = () => {
    // Unbind any custom DOM listeners or timers
  };
}
`

## Code Layout
- Backend Worker & Server: server.js, worker.js, wrangler.toml
- Backend Durable Objects: src/chat-room.js, src/sync-hub.js
- Frontend Core: src/api.js, src/app.js, src/realtime.js, src/event-bus.js, index.html
- Frontend Views: src/views/*.js (20 views)
- Tests: 	ests/*.mjs, 	ests/realtime-sync/*.mjs
- Build & Deploy: sync-to-deploy.ps1, package.json
