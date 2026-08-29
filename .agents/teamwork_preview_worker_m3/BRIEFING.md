# BRIEFING — 2026-08-27T02:56:00Z

## Mission
Deliver Milestone 3: Standardize view lifecycle contract with `el._cleanup` across all 20 views, fix memory leaks in `src/views/tasks.js`, implement reactive event handling and surgical DOM updates using `EventBus.bindView` across all feature domain views, and add comprehensive reactivity tests.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m3
- Original parent: 27a75596-2468-49af-8063-8f1274737242
- Milestone: Milestone 3 (Feature Domain View Reactivity & Cleanup)

## 🔒 Key Constraints
- Genuine implementations only: no dummy/facade implementations, no hardcoded test results.
- Clean DOM lifecycle: Every view must export or return a rendered DOM element with an attached `el._cleanup = () => { ... }` or clean teardown handling.
- EventBus binding: Use `EventBus.bindView(el, ...)` to auto-bind subscriptions to view DOM lifecycle.
- Zero memory leaks: All document/window level event listeners, intervals, timers, and EventBus subscriptions must be cleaned up on unmount.
- Surgical DOM updates: When events arrive, update the relevant DOM elements directly where applicable rather than full page re-render.
- Keep all tests passing (node --test).

## Current Parent
- Conversation ID: 27a75596-2468-49af-8063-8f1274737242
- Updated: 2026-08-27T02:56:00Z

## Task Summary
- **What to build**: Standardize lifecycle cleanup across 20 views, fix tasks.js memory leaks, implement reactive DOM update subscriptions across domain views (`tasks.js`, `chat.js`, `notifications.js`, `attendance.js`, `leave.js`, `payroll.js`, `invoices.js`, `users.js`, `dashboard.js`, `departments.js`, `settings.js`, `recruitment.js`, `assets.js`, `campaigns.js`, `evaluation.js`, `kpis.js`, `payslip-detail.js`, `taskpanel.js`, `dbadmin.js`, `wifi.js`), and create `tests/views-reactivity.test.mjs`.
- **Success criteria**: All 20 views have proper cleanup, EventBus domain reactivity works with surgical DOM updates, test suite passes 100%.
- **Interface contracts**: `PROJECT.md`, `src/event-bus.js`, `src/app.js`.

## Key Decisions Made
- Used `AbortController` in `src/views/tasks.js` to manage document listeners (`click`, `task-copied`, `task-mentions-read`) with automatic teardown in `el._cleanup`.
- Exported `renderTaskpanel` with `el._cleanup` and tied `openPanel` event bus unsubs to `closePanel`.
- Exported `renderPayslipDetail` with `el._cleanup`.
- Used `EventBus.bindView(el, ...)` across all domain views so view subscriptions are automatically deregistered on view cleanup in `src/app.js`.
- Added surgical DOM update handlers for tasks, chat (messages, edits, deletes, reactions, pins, unread counts), notifications, attendance, leave, payroll, invoices, users, campaigns, assets, evaluation, KPIs, wifi, settings, and departments.

## Artifact Index
- `.agents/teamwork_preview_worker_m3/progress.md`
- `.agents/teamwork_preview_worker_m3/DISPATCH.md`
- `.agents/teamwork_preview_worker_m3/BRIEFING.md`
- `.agents/teamwork_preview_worker_m3/handoff.md`
- `tests/views-reactivity.test.mjs`

## Change Tracker
- **Files modified**:
  - `src/views/tasks.js`: Memory leak fix, AbortController listeners, EventBus.bindView for tasks & subtasks & comments, el._cleanup.
  - `src/views/taskpanel.js`: Lifecycle openPanel unsubs, renderTaskpanel export, el._cleanup.
  - `src/views/chat.js`: EventBus.bindView for chat & chat:*, message/reaction/pin/unread reactivity, lightbox keydown cleanup.
  - `src/views/notifications.js`: EventBus.bindView for notifications, searchTimer cleanup.
  - `src/views/attendance.js`: EventBus.bindView for attendance, clockInterval & geoMap cleanup.
  - `src/views/leave.js`: EventBus.bindView for leave, el._cleanup.
  - `src/views/payroll.js`: EventBus.bindView for payroll and invoices, row cache cleanup.
  - `src/views/invoices.js`: EventBus.bindView for invoices and payroll, el._cleanup.
  - `src/views/users.js`: EventBus.bindView for users, directory and profile reactivity, searchTimer cleanup.
  - `src/views/dashboard.js`: EventBus.bindView for tasks, attendance, leave, users, payroll, notifications, refresh debouncer.
  - `src/views/departments.js`: EventBus.bindView for departments and users, el._cleanup.
  - `src/views/settings.js`: EventBus.bindView for users, el._cleanup.
  - `src/views/recruitment.js`: EventBus.bindView for recruitment, el._cleanup.
  - `src/views/assets.js`: EventBus.bindView for assets, el._cleanup.
  - `src/views/campaigns.js`: EventBus.bindView for campaigns, el._cleanup.
  - `src/views/evaluation.js`: EventBus.bindView for evaluations, el._cleanup.
  - `src/views/kpis.js`: EventBus.bindView for kpis, el._cleanup.
  - `src/views/payslip-detail.js`: renderPayslipDetail export, el._cleanup.
  - `src/views/dbadmin.js`: el._cleanup.
  - `src/views/wifi.js`: EventBus.bindView for wifi and location_config, el._cleanup.
  - `tests/views-reactivity.test.mjs`: Comprehensive 47-test suite for lifecycle cleanup and DOM reactivity.
- **Build status**: All tests passing (47/47 views reactivity tests, 22/22 realtime tests, 14/14 broadcast tests, 9/9 synchub tests, 11/11 adversarial tests).
- **Pending issues**: None.

## Quality Status
- **Build/test result**: All 103 tests pass across 5 test suites.
- **Lint status**: Zero syntax or lint violations.
- **Tests added/modified**: `tests/views-reactivity.test.mjs` with 47 automated tests.

## Loaded Skills
- None requested.
