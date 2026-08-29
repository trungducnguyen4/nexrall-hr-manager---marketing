# Handoff Report — Explorer 3: Feature Domain Inventory & Test/Sync Specialist

**Agent ID**: Explorer 3 (`teamwork_preview_explorer_3`)  
**Parent ID**: Orchestrator (`27a75596-2468-49af-8063-8f1274737242`)  
**Workspace**: `d:\NetVietTv\nexrall-hr-manager---marketing`  
**Date**: 2026-08-27  
**Artifacts Produced**:
- `.agents/teamwork_preview_explorer_3/analysis.md`
- `.agents/teamwork_preview_explorer_3/handoff.md`
- `.agents/teamwork_preview_explorer_3/progress.md`
- `.agents/teamwork_preview_explorer_3/BRIEFING.md`

---

## 1. Observation

1. **WebSocket Infrastructure Scope**:
   - `src/chat-room.js` (lines 11–61, 364–383): The `ChatRoom` Durable Object is instantiated per conversation (`/api/chat/ws/:convId`). It maintains a local session map (`this.sessions`) for WebSockets connected to that specific room.
   - `server.js` (lines 9645–9650): WebSocket upgrades only target `/api/chat/ws/:convId` and route directly to the `CHAT_ROOM` DO instance.
   - There is NO global Durable Object or Server-Sent Events (SSE) endpoint for app-wide event distribution.

2. **Frontend Polling & Lag**:
   - `src/app.js` (lines 300–304): `_chatUnreadTimer` polls `refreshChatHeaderSummary()` and `refreshEmployeeAlertBadge()` every **10,000 ms** (10 seconds).
   - `src/app.js` (lines 356–357): `_mentionBadgeTimer` polls `refreshTaskMentionBadge()` every **30,000 ms** (30 seconds).
   - When User A sends a message or mentions User B, User B experiences up to a 10s–30s delay before the header badge updates if not in the room.

3. **Frontend Cache Invalidation Isolation**:
   - `src/api.js` (lines 171–177):
     ```javascript
     function inv(...prefixes) {
       _writeGen++;
       prefixes.forEach(p => invalidateCache(p));
       if (typeof document !== 'undefined') {
         document.dispatchEvent(new CustomEvent('hr-data-mutated', { detail: { prefixes } }));
       }
     }
     ```
     This function is called by mutations (`createTask`, `updateTask`, `checkin`, `createLeave`, `updateUser`, etc.). It invalidates the local memory cache and fires a custom event ONLY on the local `document`. It does not broadcast over the network to other users.

4. **Static View Lifecycle**:
   - `src/views/tasks.js` (lines 204–315): `renderTasks` fetches data once on mount (`loadProjects()`, `loadBoard()`). It does not attach listeners for external updates or real-time event subscriptions.
   - `src/views/attendance.js`, `src/views/leave.js`, `src/views/users.js`, `src/views/payroll.js`: All follow the single-mount fetch pattern. When User A mutates data, User B's DOM remains stale until a route change or manual browser refresh.

5. **Existing Test Framework**:
   - `tests/task-reorder.mjs` (lines 1–173) and `tests/subtask-schema.mjs` (lines 1–259): Use `node:sqlite`'s `DatabaseSync(':memory:')` wrapped in a D1 facade to test `server.js`'s `handle(req, env)` directly and synchronously.
   - Test execution is fast, self-contained, and requires no external live server.

---

## 2. Logic Chain

1. **Premise**: Real-time multi-user collaboration requires that whenever User A mutates shared state in the database, User B's interface updates without manual intervention or page reload.
2. **Observation Step**: In NetViet HR, only chat rooms have a WebSocket connection, and only when the user is actively viewing that specific conversation.
3. **Inference Step**: Any mutation occurring outside the active chat room (e.g. task status update, subtask check, attendance check-in, leave request, role update) has no real-time push mechanism to reach User B.
4. **Observation Step**: Header badges for mentions and alerts rely on 10s and 30s polling intervals.
5. **Inference Step**: Polling introduces significant latency (up to 30s) and generates unnecessary Worker request volume, failing the instant reactivity requirement.
6. **Conclusion Step**: A unified event broadcasting layer (via a Global Event Hub DO or Server-Sent Events / WebSocket channel) combined with reactive view subscriptions and cache invalidation is necessary to satisfy Requirements R1, R2, R3, and R4.

---

## 3. Caveats

1. **No External Network in Code-Only Test**: Automated testing during CI/local runs should utilize in-memory Node.js integration tests (`node:sqlite` + mock DO/EventBus) to remain self-contained, deterministic, and fast without requiring external Cloudflare deployments.
2. **Capacitor Mobile Shell**: Mobile iOS/Android builds use Capacitor (`src/native.js`, `src/push.js`). Real-time push for background/lock-screen notifications relies on Web Push / APNs, whereas in-app real-time synchronization relies on the active socket/SSE connection.

---

## 4. Conclusion

1. **Complete Feature Inventory**: All 8 domain features (Tasks & Subtasks, Task Comments & Mentions, Chat Conversations, Notifications & Badges, Attendance Check-in/out, Leave Requests & Approvals, Payroll & Overtime, User Profiles & Roles) have been fully documented with exact mutation endpoints, payload schemas, and target recipient scopes in `analysis.md`.
2. **Two-Client Testing Architecture**: Formulated an automated two-client integration testing harness simulating Client A (Mutator) and Client B (Observer) to verify <500ms real-time event delivery and automatic DOM/state convergence across all 8 domains without F5 refresh.
3. **Deployment Health**: Verified `sync-to-deploy.ps1`, `wrangler.toml`, and native ES module SPA architecture. All files in `src/` cleanly mirror to `.local-public/`.

---

## 5. Verification Method

To independently verify these observations:
1. **Inspect Chat WebSocket Scope**:
   - Open `src/chat-room.js` and `server.js:9645`. Notice `CHAT_ROOM.idFromName(String(convId))` is only invoked for `/api/chat/ws/:convId`.
2. **Inspect Polling Timers**:
   - Open `src/app.js:300` and `src/app.js:356`. Verify `10000` ms and `30000` ms intervals for badges.
3. **Inspect Local Mutation Invalidation**:
   - Open `src/api.js:171`. Verify `document.dispatchEvent` is local-only.
4. **Run Existing Tests**:
   - Execute: `node tests/task-reorder.mjs`
   - Execute: `node tests/subtask-schema.mjs`
   - Both should pass with 0 errors.
