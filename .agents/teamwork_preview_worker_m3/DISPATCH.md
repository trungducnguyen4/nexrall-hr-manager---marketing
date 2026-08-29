## 2026-08-27T02:37:12Z

You are Worker M3 for Milestone 3: Feature Domain View Reactivity & Cleanup across all views.

Working Directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m3
Project Spec: d:\NetVietTv\nexrall-hr-manager---marketing\PROJECT.md
Original Request Path: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\ORIGINAL_REQUEST.md
Explorer Analysis:
- d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_2\analysis.md
- d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_3\analysis.md
Worker M2 Handoff: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m2\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Tasks for Milestone 3:
1. Initialize progress.md in your directory with 'Last visited: [timestamp]'.
2. Standardize view lifecycle contract with `el._cleanup` across all 20 views in `src/views/` (`tasks.js`, `chat.js`, `notifications.js`, `attendance.js`, `leave.js`, `payroll.js`, `invoices.js`, `users.js`, `profile.js`, `dashboard.js`, `departments.js`, `settings.js`, `reports.js`, `calendar.js`, `onboarding.js`, `recruitment.js`, `assets.js`, `documents.js`, `wiki.js`, `audit-logs.js`).
3. Fix memory leaks in `src/views/tasks.js`:
   - Store references or use `AbortController` / proper cleanup inside `el._cleanup` for all `document.addEventListener` listeners (`click`, `task-copied`, `task-mentions-read`, etc.).
4. Implement reactive event handling and surgical DOM updates using `EventBus.bindView(el, ...)` in each key domain view:
   - `src/views/tasks.js`:
     * Subscribe to `tasks`, `task:*`, `subtask:*`, `comment:*`.
     * Update Kanban board cards, task list rows, open task details modal, subtask checkboxes, comments list without requiring a full page refresh.
   - `src/views/chat.js`:
     * Subscribe to `chat`, `chat:*`.
     * Update conversation list, message list (new message, edit, delete, reactions, pin) in real-time.
   - `src/views/notifications.js`:
     * Subscribe to `notifications`, `notification:*`.
     * Prepend new notifications dynamically, update unread state when marked read.
   - `src/views/attendance.js`:
     * Subscribe to `attendance`, `attendance:*`.
     * Update active attendance status, today's check-in/out times, team attendance log, location review status.
   - `src/views/leave.js`:
     * Subscribe to `leave`, `leave:*`.
     * Update leave requests table, approval status badges, remaining leave balances.
   - `src/views/payroll.js` & `src/views/invoices.js`:
     * Subscribe to `payroll`, `payroll:*`, `invoices`, `invoices:*`.
     * Update payroll calculation status, payslip confirmation status, review request status.
   - `src/views/users.js` & `src/views/profile.js`:
     * Subscribe to `users`, `user:*`, `users:*`.
     * Update employee list, status badges, profile information.
   - `src/views/dashboard.js`:
     * Subscribe to `*` or domain topics to reactively refresh KPI stats counters when team members check in, tasks are completed, or leave is approved.
5. Create and run comprehensive unit/DOM reactivity test suite (e.g. `tests/views-reactivity.test.mjs` verifying view cleanup, `EventBus.bindView` subscription lifecycle, and DOM update handlers across views).
6. Verify all test suites pass.
7. Write `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m3\handoff.md`.
8. Send a message to parent when completed.
