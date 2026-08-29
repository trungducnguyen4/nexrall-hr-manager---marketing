## 2026-08-27T02:06:06Z
You are Worker M1 for Milestone 1: Backend Real-Time Core & Broadcast Pipeline.

Working Directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m1
Project Spec: d:\NetVietTv\nexrall-hr-manager---marketing\PROJECT.md
Original Request Path: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\ORIGINAL_REQUEST.md
Explorer Reports:
- d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_1\analysis.md
- d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_2\analysis.md
- d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_3\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Tasks for Milestone 1:
1. Initialize progress.md in your directory with 'Last visited: [timestamp]'.
2. Create `src/sync-hub.js` implementing the `AppSyncHub` Durable Object class with:
   - WebSocket acceptance using Cloudflare DO Hibernation API (`this.ctx.acceptWebSocket(server)`).
   - Session serialization on socket attachment (`ws.serializeAttachment()`).
   - Ping/Pong heartbeat (30s heartbeat, handling client pings, socket liveness checks).
   - 100-event sliding replay buffer with monotonic sequence IDs and timestamps.
   - Internal RPC / HTTP endpoint (`POST /broadcast`) supporting topic/user filtering.
   - SSE fallback stream support (`/api/realtime/events`).
   - Stats endpoint (`/api/realtime/stats`).
3. Update `wrangler.toml` to declare `SYNC_HUB` binding and migrations tag `v2` for `AppSyncHub`.
4. Update `worker.js` to import and export `AppSyncHub`.
5. Update `server.js`:
   - Add universal `broadcastAppEvent(env, topic, eventName, payload, options)` helper.
   - Route `/api/realtime/ws`, `/api/realtime/events`, `/api/realtime/stats` to `AppSyncHub`.
   - Implement missing Chat REST broadcasts (`PUT /api/messages/:id`, `DELETE /api/messages/:id`, pins, reactions, `POST /api/conversations`).
   - Inject `broadcastAppEvent()` across all domain mutation endpoints in `server.js` (Tasks, Subtasks, Comments, Mentions, Attendance, Overtime, Leave, Payroll, Payslips, Invoices, Users, Roles) as detailed in Explorer M1_3 analysis.
6. Verify and run existing tests (e.g. `node tests/task-reorder.mjs`, `node tests/subtask-schema.mjs`, `node tests/employee-profile-smoke.mjs`, `node tests/geofence.mjs`).
7. Write `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m1\handoff.md` with:
   - Observation: Exact files and lines modified/created.
   - Logic Chain: Technical rationale.
   - Caveats: Any edge cases.
   - Conclusion: Summary of implementation.
   - Verification Method: Test commands run and passing results.
8. Send a message to parent when completed.
