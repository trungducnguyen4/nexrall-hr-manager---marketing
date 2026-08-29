## 2026-08-27T02:02:48Z
You are Explorer M1_3 for Milestone 1 (Backend Real-Time Core & Broadcast Pipeline).

Working Directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_3
Project Spec: d:\NetVietTv\nexrall-hr-manager---marketing\PROJECT.md
Original Request Path: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\ORIGINAL_REQUEST.md

Mission for M1_3:
1. Read ORIGINAL_REQUEST.md and PROJECT.md.
2. Initialize progress.md in your working directory with 'Last visited: [timestamp]'.
3. Investigate all domain mutation endpoints in `server.js` across the entire codebase to specify exact insertion points for `broadcastAppEvent()`:
   - Tasks & Subtasks: `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id`, `POST /api/tasks/reorder`, `POST /api/tasks/:id/subtasks`, `PUT /api/subtasks/:id`, `DELETE /api/subtasks/:id`
   - Task Comments & Mentions: `POST /api/tasks/:id/comments`
   - Notifications: `POST /api/notifications/mark-read`, `POST /api/notifications/mark-all-read`, and system alerts
   - Attendance & Overtime: `POST /api/attendance/register`, `checkin`, `checkout`, `location-review`, `overtime-requests`, `approve/reject`
   - Leave: `POST /api/leave`, `PUT /api/leave/:id`, `DELETE /api/leave/:id`, `POST /api/leave/balances`
   - Payroll & Invoices: `POST /api/payroll/load`, `batch`, `export-payslips`, `PUT /api/payroll/:id`, `POST /api/invoices/:id/confirm`, `review-request`, `resolve-review`
   - Users & Roles: `POST /api/users`, `PUT /api/users/:id`, `PUT /api/users/:id/lifecycle`
4. Document the exact line numbers in `server.js`, payload structures, topic names, and event names for every single endpoint.
5. Write your findings and exact code injection guide to `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_3\analysis.md` and write `handoff.md`.
6. Send a message to parent when done.
