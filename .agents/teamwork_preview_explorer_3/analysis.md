# NetViet HR Real-Time Synchronization Audit & Domain Feature Inventory

**Author**: Explorer 3 (Feature Domain Inventory & Test/Sync Specialist)  
**Date**: 2026-08-27  
**Workspace**: `d:\NetVietTv\nexrall-hr-manager---marketing`  
**Target Reference**: `ORIGINAL_REQUEST.md` (R1: Feature Inventory & Event Tracing, R4: Two-Client Sync Testing)

---

## 1. Executive Summary

A comprehensive architectural audit was performed on the NetViet HR codebase across frontend modules (`src/app.js`, `src/api.js`, `src/views/*`), backend Worker and Durable Object handlers (`worker.js`, `server.js`, `src/chat-room.js`), configuration (`wrangler.toml`, `package.json`), and build/deploy pipelines (`sync-to-deploy.ps1`).

### Primary Findings
1. **Isolated WebSocket Scope**: The existing WebSocket infrastructure is limited strictly to single chat conversations via the `ChatRoom` Durable Object (`/api/chat/ws/:convId`). When User B is not actively in that conversation room (e.g. on Dashboard, Tasks, Attendance, or Leave), no real-time WebSocket connection exists.
2. **Polling-Based Header Badges**: Global unread counters and badges rely on background polling timers (`setInterval` every 10s for chat summary and alerts, 30s for task mentions). This causes noticeable lag (up to 10–30 seconds) and wastes Cloudflare Worker requests.
3. **Purely Local Cache Invalidation**: The frontend cache invalidation mechanism (`inv(...)` in `src/api.js`) only fires a local DOM event (`document.dispatchEvent(new CustomEvent('hr-data-mutated'))`) on User A's browser. It has **no network broadcast component**. When User A mutates tasks, subtasks, attendance, leave, payroll, or user roles, User B's browser receives zero notification.
4. **No Real-Time Subscriptions for Core HR Views**: None of the core views (`tasks.js`, `attendance.js`, `leave.js`, `users.js`, `payroll.js`, `notifications.js`) establish event subscriptions or reactive listeners. They only fetch data once on initial route mount.

---

## 2. Complete Shared-Data Feature Inventory (8 Domain Features)

| Feature Domain | Primary UI View Files | Backend Routes & Handlers (`server.js`) | Persistence Tables (D1 / SQLite) | Real-Time Scope & Target Audience |
| :--- | :--- | :--- | :--- | :--- |
| **1. Tasks & Subtasks** | `src/views/tasks.js`<br>`src/views/taskpanel.js` | `GET/POST /api/tasks`<br>`PUT/DELETE /api/tasks/:id`<br>`POST /api/tasks/reorder`<br>`POST /api/tasks/:id/subtasks`<br>`PUT/DELETE /api/subtasks/:id`<br>`/api/task-projects/*`<br>`/api/task-groups/*`<br>`/api/task-labels/*` | `tasks`<br>`subtasks`<br>`task_projects`<br>`task_project_members`<br>`task_groups`<br>`task_labels`<br>`task_activity` | Project members, assignees, creators, task followers, department members. |
| **2. Task Comments & @Mentions** | `src/views/taskpanel.js`<br>`src/views/notifications.js` | `GET/POST /api/tasks/:id/comments`<br>`POST/DELETE /api/tasks/:id/followers`<br>`GET/POST/DELETE /api/tasks/:id/attachments`<br>`GET /api/notifications/task-mentions` | `task_comments`<br>`task_mention_notifications`<br>`task_followers`<br>`task_attachments` | Mentioned users (instant badge + sound), task followers (live comment stream in open panel). |
| **3. Chat Conversations & Direct/Group Messages** | `src/views/chat.js`<br>`src/chat-room.js` | `WS /api/chat/ws/:convId`<br>`GET/POST /api/chat/conversations`<br>`GET/POST /api/chat/conversations/:id/messages`<br>`GET /api/chat/header-summary` | `conversations`<br>`conversation_members`<br>`messages`<br>`message_attachments`<br>`message_reactions`<br>`message_mentions` | Conversation members (instant message, reaction, typing indicator, read receipt, header attention chip). |
| **4. Notifications & Real-Time Badges** | `src/views/notifications.js`<br>`src/app.js` (header/bottom nav) | `GET /api/notifications`<br>`GET /api/notifications/task-mentions/unread-count`<br>`PATCH /api/notifications/task-mentions/:id/read` | `task_mention_notifications`<br>`leave_requests`<br>`attendance`<br>`users` (dynamic alert rules) | All active authenticated users (role- and user-filtered badges, danger/warning/info counters). |
| **5. Attendance Check-in / Check-out** | `src/views/attendance.js`<br>`src/views/dashboard.js` | `POST /api/attendance/register`<br>`POST /api/attendance/checkin`<br>`POST /api/attendance/checkout`<br>`POST /api/attendance/:id/location-review`<br>`POST /api/attendance/batch` | `attendance`<br>`attendance_locations`<br>`wifi_whitelist` | HR Admins, Managers, and Department peers (live presence widget, attendance board, review queue). |
| **6. Leave Requests & Approvals** | `src/views/leave.js`<br>`src/views/dashboard.js` | `GET/POST /api/leave`<br>`PUT/DELETE /api/leave/:id`<br>`GET/POST /api/leave/balances`<br>`POST /api/leave/uploads` | `leave_requests`<br>`leave_balances`<br>`leave_balance_ledger`<br>`leave_approval_history`<br>`leave_request_documents` | Applicant (status changes), Direct Manager / HR / BGD approvers (pending approval counter), Handover peers. |
| **7. Payroll & Overtime Records** | `src/views/payroll.js`<br>`src/views/payslip-detail.js`<br>`src/views/invoices.js` | `GET/POST /api/payroll`<br>`POST /api/payroll/batch`<br>`POST /api/payroll/export-payslips`<br>`POST /api/payroll-adjustments/*`<br>`GET/POST /api/invoices/*`<br>`GET/POST /api/overtime-requests/*` | `payroll`<br>`invoices`<br>`payroll_adjustments`<br>`overtime_requests`<br>`overtime_forms` | All employees (payslip publishing), HR Admins (live calculation, dispute reviews, approval flow). |
| **8. User Profiles & Roles / Permissions** | `src/views/users.js`<br>`src/views/settings.js`<br>`src/app.js` | `GET/POST /api/users`<br>`PUT/DELETE /api/users/:id`<br>`PATCH /api/users/:id/profile`<br>`PUT /api/users/:id/lifecycle`<br>`GET/POST /api/users/:id/documents` | `users`<br>`sessions`<br>`employee_documents`<br>`employee_audit_log` | Target user (immediate role/permission reload), all users (directory, avatars, organizational chart). |

---

## 3. End-to-End Event Tracing Across Domain Features

### 3.1 Tasks & Subtasks
```
[User A] -> Action: Drag & drop task to "Done" / Add Subtask
         -> HTTP Request: PUT /api/tasks/:id (status="done") OR POST /api/tasks/:id/subtasks
         -> Backend: DB UPDATE tasks / INSERT subtasks -> Record activity
         -> Target Event:
            Topic: "project:<projectId>"
            Payload: {
              event: "task:updated" | "subtask:created",
              task_id: 102,
              project_id: 1,
              group_id: 2,
              status: "done",
              subtask: { id: 45, title: "Design review", is_done: 0 },
              actor: { id: 1, name: "User A" }
            }
         -> Broadcast: Sent to all clients subscribed to project 1 (and task followers).
         -> [User B] (Observing Board or Task Panel):
            - If on `#/tasks` (Project 1): Board card moves from Todo -> Done column with smooth animation.
            - If task panel 102 is open: Subtask row dynamically appends; progress bar updates.
            - No page reload or lost scroll position.
```

### 3.2 Task Comments & @Mentions
```
[User A] -> Action: Types "@UserB please review the API contract" -> clicks Send
         -> HTTP Request: POST /api/tasks/:id/comments { content, mentions: [{ user_id: 2, name: "User B" }] }
         -> Backend: DB INSERT task_comments, INSERT task_mention_notifications
         -> Target Events:
            1. Broad Event: Topic: "task:<taskId>" -> { event: "task:comment:new", task_id, comment: { id, content, author, created_at } }
            2. Targeted Event: Topic: "user:2" -> { event: "notification:mention", count_delta: +1, mention: { task_id, task_title, snippet } }
         -> [User B] Instant Reactions:
            - If task panel is open: New comment bubble smoothly slides into view; plays chime if enabled.
            - Everywhere in app: `#task-mention-badge` increments immediately; chime sound plays.
```

### 3.3 Chat Conversations & Direct/Group Messages
```
[User A] -> Action: Sends "Hello team" in Group Chat #5
         -> WS Frame to ChatRoom DO: { type: "message:send", content: "Hello team", attachments: [] }
         -> ChatRoom DO: DB INSERT messages, attachments, mentions
         -> DO Broadcast:
            1. In-Room WS: { type: "message:new", message: { id, conversation_id: 5, content: "Hello team", sender: ... } }
            2. Global Event Gateway (to non-room users):
               Topic: "user:<memberId>" -> { event: "chat:unread_update", conversation_id: 5, unread_delta: +1, preview: "Hello team" }
         -> [User B] Instant Reactions:
            - If inside Chat #5: Message instantly appends, auto-scrolls, marks read receipt back to DO.
            - If on another screen: Top header chat badge increments (e.g. from 0 to 1); Attention chip updates.
```

### 3.4 Notifications & Real-Time Badges
```
[User A / Admin] -> Action: Uploads missing contract document for Employee B
                 -> HTTP Request: POST /api/users/2/documents { category: "contract", ... }
                 -> Backend: DB INSERT document -> Clears "contract_due" or "missing_documents" alert
                 -> Target Event:
                    Topic: "user:2" (and "role:admin") -> { event: "notification:resolved", type: "contract_due", active_total: 2 }
                 -> [User B / Admin] Instant Reactions:
                    - Bell badge count decrements from 3 to 2.
                    - If on `#/notifications`, the corresponding alert card fades out.
```

### 3.5 Attendance Check-in / Check-out
```
[User A] -> Action: Clicks "Chấm công vào" (GPS verified)
         -> HTTP Request: POST /api/attendance/checkin { latitude, longitude, accuracy }
         -> Backend: DB UPDATE attendance SET checkin_time="08:28:15", status="present"
         -> Target Event:
            Topic: "attendance:today" -> {
              event: "attendance:checkin",
              user_id: 14,
              user_name: "Nguyen Van A",
              department: "Marketing",
              checkin_time: "08:28:15",
              status: "present",
              late_minutes: 0
            }
         -> [User B (HR Manager)] Instant Reactions:
            - Dashboard widget: "Nhân viên đang có mặt" increments (e.g. 18 -> 19).
            - Attendance table on `#/attendance`: User A's row instantly turns green with "08:28".
```

### 3.6 Leave Requests & Manager Approvals
```
[User A] -> Action: Submits 2 days Annual Leave -> clicks "Gửi đơn"
         -> HTTP Request: POST /api/leave { type: "annual", start_date, end_date, reason, handover_user_id }
         -> Backend: DB INSERT leave_requests, UPDATE leave_balances (reserve 2 days)
         -> Target Event:
            1. Topic: "user:<managerId>" -> { event: "leave:pending_approval", leave_id: 88, employee_name: "User A", days: 2 }
            2. Topic: "user:<userAId>" -> { event: "leave:balance_updated", available_days: 10 }
         -> [User B (Manager)] Instant Reactions:
            - Leave pending badge on sidebar/nav increments.
            - If on `#/leave`: Approval queue table immediately inserts User A's pending request.
```

### 3.7 Payroll & Overtime Records
```
[User A (HR Admin)] -> Action: Clicks "Xuất phiếu lương tháng 08/2026"
                    -> HTTP Request: POST /api/payroll/export-payslips { month: "2026-08" }
                    -> Backend: DB INSERT invoices for all active employees
                    -> Target Event:
                       Topic: "user:<allEmployees>" -> { event: "invoice:published", month: "2026-08", invoice_id }
                    -> [User B (Employee)] Instant Reactions:
                       - Notification toast: "Phiếu lương tháng 08/2026 đã sẵn sàng".
                       - Invoices view `#/invoices`: New unconfirmed payslip badge and card appear.
```

### 3.8 User Profiles & Roles / Permissions
```
[User A (Admin)] -> Action: Promotes Employee B to "manager" of Phòng HCNS
                 -> HTTP Request: PUT /api/users/2 { role: "manager", department: "Phòng HCNS" }
                 -> Backend: DB UPDATE users SET role="manager", department="Phòng HCNS"
                 -> Target Event:
                    Topic: "user:2" -> { event: "user:role_changed", user_id: 2, role: "manager", department: "Phòng HCNS" }
                 -> [User B (Promoted User)] Instant Reactions:
                    - Client updates internal `me` state.
                    - Admin navigation bar (`#admin-nav`) immediately becomes visible without page reload.
                    - Role-gated action buttons (e.g. "+ Project", "+ Nhóm dự án", "Phê duyệt đơn") activate.
```

---

## 4. Detailed Gap Analysis & Root Cause Breakdown

```
+---------------------------------------------------------------------------------------------------+
|                                  CURRENT ARCHITECTURE GAPS                                        |
+------------------------------------+--------------------------------------------------------------+
| Component                          | Identified Limitation / Root Cause                           |
+------------------------------------+--------------------------------------------------------------+
| 1. ChatRoom Durable Object         | Hibernated DO is scoped per conversation ID only.            |
|                                    | No global User DO or Central Event Hub for cross-domain      |
|                                    | notifications and state mutations.                           |
+------------------------------------+--------------------------------------------------------------+
| 2. Frontend Cache (`src/api.js`)   | `inv(...)` emits a local custom event on the active document.|
|                                    | It has no awareness of other connected clients.              |
+------------------------------------+--------------------------------------------------------------+
| 3. Polling Overhead (`src/app.js`) | Background `setInterval` (10s and 30s) polls header summary, |
|                                    | notifications, and mentions, causing latency and worker churn.|
+------------------------------------+--------------------------------------------------------------+
| 4. Static View Mounts              | Views (`tasks.js`, `leave.js`, `attendance.js`, `users.js`)  |
|                                    | fetch data once in `renderView()` and do not bind to live    |
|                                    | update events or SSE/WS streams.                             |
+------------------------------------+--------------------------------------------------------------+
```

---

## 5. Proposed Real-Time Architecture & Event Infrastructure

To achieve sub-second User A -> Backend -> User B synchronization across all 8 domain features, the following architecture is recommended:

```
                      +-----------------------------+
                      |       Client A (User A)     |
                      +--------------+--------------+
                                     | HTTP Mutation (REST / JSON)
                                     v
                      +-----------------------------+
                      |   Cloudflare Worker API     |
                      |        (server.js)          |
                      +--------------+--------------+
                                     | 1. Commit to D1 SQLite
                                     | 2. Broadcast via Event Router
                                     v
                 +-------------------+-------------------+
                 |                                       |
                 v                                       v
   +---------------------------+           +---------------------------+
   |   ChatRoom DO (per conv)  |           |   User/Global Event Hub   |
   | (Detailed Chat Messaging) |           |  (SSE or User WS Stream)  |
   +-------------+-------------+           +-------------+-------------+
                 | WebSocket Frame                       | SSE / WS Event
                 v                                       v
   +---------------------------+           +---------------------------+
   |   Client B (Active Room)  |           |  Client B (Any HR View)   |
   +---------------------------+           +---------------------------+
```

### Event Topics & Payload Standard
All real-time events follow a unified envelope:
```json
{
  "id": "evt_01J6A1B2C3D4E5F6",
  "topic": "project:1" | "user:2" | "attendance:today" | "leave:admin",
  "type": "task:updated",
  "timestamp": 1787821140000,
  "actor_id": 1,
  "data": { ... }
}
```

---

## 6. Two-Client Automated Sync Testing Methodology

To verify real-time reactivity without manual F5 refresh, an automated test suite must simulate two distinct client sessions concurrently:

### 6.1 Test Harness Architecture

```
                       +----------------------------------------+
                       |    Automated Sync Test Runner (Node)   |
                       +-------------------+--------------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
                    v                                             v
     +------------------------------+              +------------------------------+
     |   Client A (Actor/Mutator)   |              |  Client B (Observer/Receiver)|
     |  Token: User A (e.g. Admin)  |              |  Token: User B (e.g. Empl)   |
     +--------------+---------------+              +--------------+---------------+
                    |                                             |
                    | 1. HTTP REST Mutation                       | 0. Connects to Event Stream
                    v                                             v
     +----------------------------------------------------------------------------+
     |                    Cloudflare Worker / Server In-Memory                    |
     |                       (DatabaseSync + Event Bus)                           |
     +----------------------------------------------------------------------------+
                    |                                             |
                    | 2. Mutation Persisted in D1                 | 3. Real-Time Event Delivered
                    +-------------------------------------------->| (Latency Assertion < 500ms)
                                                                  v
                                                   +------------------------------+
                                                   | 4. Client B State & Reactive |
                                                   |    DOM / Model Assertions    |
                                                   +------------------------------+
```

### 6.2 Test Implementation Recipe (ESM Test Script)
The test runner can execute using Node.js built-in `node:test` or `assert` with mock SQLite D1 facade (matching `tests/task-reorder.mjs` and `tests/subtask-schema.mjs`):

```javascript
// Example Test Flow:
// 1. Initialize In-Memory D1 & Event Bus
// 2. Create User A (Manager) and User B (Employee)
// 3. Client B subscribes to Real-Time Event Stream
// 4. Client A calls handle(POST /api/tasks, { title: "Urgent Sync Task", assigned_to: UserB })
// 5. Assert Client B receives event "task:created" within 200ms
// 6. Client A calls handle(POST /api/tasks/:id/comments, { content: "@UserB please check" })
// 7. Assert Client B receives "notification:mention" and unread badge count increments to 1
// 8. Assert Client B reconnects with Last-Event-ID after network blip and receives missed events
```

### 6.3 Five Core Two-Client Test Suites to Implement
1. `tests/sync-tasks.mjs` — Tests Task creation, status drag-and-drop, position reordering, subtask toggles between Client A and Client B.
2. `tests/sync-comments.mjs` — Tests Task comment append, follower notifications, and @mention instant badge increment.
3. `tests/sync-attendance.mjs` — Tests Employee Check-in -> Admin Live Dashboard count & Attendance grid auto-refresh.
4. `tests/sync-leave.mjs` — Tests Employee Leave Submission -> Manager Pending Queue -> Manager Approval -> Employee Balance auto-update.
5. `tests/sync-reconnect.mjs` — Tests WebSocket/SSE heartbeat recovery, tab-switching focus event, and offline queue catch-up.

---

## 7. Build, Scripts, and Deployment Pipeline Verification

### 7.1 Sync & Deployment Script (`sync-to-deploy.ps1`)
- **Source Paths**: `src/`, `styles/`, `index.html`, `favicon.png`, `manifest.webmanifest`, `sw.js`, `icon-*.png`, `apple-touch-icon.png`.
- **Target Path**: `.local-public/`
- **Execution Flow**:
  1. Validates existence of `src/` and `styles/`.
  2. Recursively synchronizes files to `.local-public/`.
  3. Executes `npx wrangler deploy` to push static assets and Worker code to Cloudflare Workers.
- **Safety Flags**: `-NoDeploy` (sync files only), `-DryRun` (simulate copy without modifying disk).

### 7.2 Configuration & Dependencies (`package.json`, `wrangler.toml`)
- **Worker Runtime**: Cloudflare Workers with compatibility date `2026-07-22`.
- **Bindings**: D1 (`DB`), R2 (`HR_DOCUMENTS`), Durable Objects (`CHAT_ROOM`), Assets (`ASSETS`).
- **Static SPA Architecture**: Native ES Modules (no Vite bundle step needed; files are served directly as ES modules by Worker ASSETS binding).

---

## 8. Real-Time Feature Matrix

| Feature ID | Domain Feature | User A Mutation Event | Expected User B Instant Observation | Current Status | Remediation Required |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FT-01** | Task Creation | `POST /api/tasks` | New task card appears on project Kanban board | ❌ Stale (Needs F5) | Add `task:created` broadcast & reactive board patch |
| **FT-02** | Task Status & Move | `PUT /api/tasks/:id` | Card moves columns / updates color badge | ❌ Stale (Needs F5) | Add `task:updated` broadcast & Kanban card move |
| **FT-03** | Task Position Reorder | `POST /api/tasks/reorder` | Card positions adjust smoothly without jumps | ❌ Stale (Needs F5) | Add `task:reordered` broadcast |
| **FT-04** | Subtask Toggle / Add | `POST /api/tasks/:id/subtasks`<br>`PUT /api/subtasks/:id` | Subtask checkbox toggles & progress bar updates | ❌ Stale (Needs F5) | Add `subtask:*` broadcast to active task panel |
| **FT-05** | Task Comment & Mention | `POST /api/tasks/:id/comments` | Live comment appends; mention badge updates & sound | ⚠️ 30s Poll Lag | Add `task:comment:new` + instant mention broadcast |
| **FT-06** | Chat Messages | WS `message:send` | Message appends in room; unread badge outside | ⚠️ Room WS ok, outside 10s lag | Add Global User Event channel for outside-room badges |
| **FT-07** | Attendance Check-in | `POST /api/attendance/checkin` | Live presence counter & admin row turns green | ❌ Stale (Needs F5) | Add `attendance:checkin` broadcast |
| **FT-08** | Leave Submission & Approval | `POST /api/leave`<br>`PUT /api/leave/:id` | Approval queue updates; balance updates instantly | ❌ Stale (Needs F5) | Add `leave:*` broadcast to applicant & approvers |
| **FT-09** | Payroll Export | `POST /api/payroll/export-payslips` | Payslip invoice appears in employee invoices view | ❌ Stale (Needs F5) | Add `invoice:published` broadcast |
| **FT-10** | Role / Profile Change | `PUT /api/users/:id` | UI nav & permission gates instantly re-evaluate | ❌ Stale (Needs Logout) | Add `user:role_changed` broadcast & `me` update |
