## 2026-08-27T02:55:57Z
You are Worker M4 for Milestone 4: Automated Two-Client Synchronization Test Suite & Comprehensive Audit Report.

Working Directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m4
Project Spec: d:\NetVietTv\nexrall-hr-manager---marketing\PROJECT.md
Test Infra Spec: d:\NetVietTv\nexrall-hr-manager---marketing\TEST_INFRA.md
Original Request Path: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\ORIGINAL_REQUEST.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Tasks for Milestone 4:
1. Initialize progress.md in your directory with 'Last visited: [timestamp]'.
2. Create the comprehensive Two-Client Automated Synchronization Test Suite in `tests/two-client-sync.test.mjs`:
   - Simulate Client A (Mutator) and Client B (Observer), each with distinct user identities, active sessions, and subscriptions via `AppSyncHub` and `EventBus`.
   - Implement Tier 1-4 tests covering all 8 domain features:
     1. Tasks & Subtasks: Client A creates/updates/reorders tasks & subtasks -> Client B observes instant DOM / Kanban updates without F5.
     2. Task Comments & Mentions: Client A posts comments with @mention -> Client B observes comment thread and live mention badge increment.
     3. Chat Conversations & Messages: Client A sends message, edits message, deletes message, adds reaction -> Client B receives real-time stream update, reaction update, and badge counters.
     4. Notifications & Badges: Client A triggers action generating notification -> Client B receives live toast/badge, marks read -> syncs.
     5. Attendance Check-in/out: Client A checks in/out -> Client B (manager/team) observes live attendance record update.
     6. Leave Requests & Approvals: Client A requests leave -> Client B (manager) approves -> Client A and B observe status change and balance updates.
     7. Payroll & Overtime: Client A submits overtime -> Manager approves -> Payroll recalculates -> Payslip confirmed -> real-time reflection.
     8. User Profiles & Roles: Client A updates profile avatar/name/role -> Client B observes live directory/header update without reload.
   - Include Tier 2 Boundary/Edge Cases: rapid interleaved mutations, client reconnect & replay buffer synchronization, topic isolation, and malformed payload resilience.
   - Include Tier 3 Cross-Feature Combinations: multi-domain workflows (e.g. task assignment + mention + notification; overtime + approval + payroll sync).
   - Include Tier 4 Real-World Workload Simulation: full workday multi-user scenario.
3. Run the test suite and verify 100% pass rate.
4. Generate `REALTIME_SYNC_AUDIT_REPORT.md` in the project root (`d:\NetVietTv\nexrall-hr-manager---marketing\REALTIME_SYNC_AUDIT_REPORT.md`) containing:
   - Executive Summary
   - Problem Statement & Pre-Remediation Baseline
   - End-to-End Real-Time Architecture (Durable Objects, WebSockets/SSE, EventBus, Cache Invalidation)
   - Real-Time Feature Matrix (covering all 8 domains, API mutations, backend events, transport, client subscribers, UI patch method, latency, test verification)
   - Two-Client E2E Test Suite Results & Metrics
   - Memory Leak & Lifecycle Audit (before vs after)
   - Deployment & Operational Readiness
5. Create `TEST_READY.md` in the project root as specified in the test track contract.
6. Write `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m4\handoff.md`.
7. Send a message to parent when completed.
