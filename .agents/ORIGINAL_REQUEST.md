# Original User Request

## Initial Request — 2026-08-27T01:58:35Z

You are the Project Orchestrator for the NetViet HR real-time synchronization audit and remediation project.

Workspace Root: d:\NetVietTv\nexrall-hr-manager---marketing
Your Working Directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_orchestrator_1
Original User Request: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\ORIGINAL_REQUEST.md

Mission:
Perform a comprehensive async and real-time synchronization audit and remediation across the NetViet HR repository to ensure that whenever User A mutates shared data, User B automatically observes the changes without requiring a manual page refresh (F5).

Key Requirements:
1. R1: Shared-Data Feature Inventory & Event Tracing across Tasks & Subtasks, Task Comments & Mentions, Chat Conversations & Messages, Notifications & Badges, Attendance Check-in/out, Leave Requests & Approvals, Payroll/Overtime, User Profiles & Roles.
2. R2: Real-Time Infrastructure & Event Broadcasting Remediation (Durable Objects, Cloudflare Worker handlers, SSE/WS, reconnection recovery, heartbeat/tab-switching resilience).
3. R3: Frontend Reactive State & Cache Invalidation (src/api.js, src/app.js, src/views/*, eliminating stale closures, one-time fetch on mount, forced reloads).
4. R4: Automated Two-Client Synchronization Verification & Audit Report (integration tests verifying Client A mutation -> Client B auto-update without refresh, Real-Time Feature Matrix).
5. Ensure clean deployment via powershell -ExecutionPolicy Bypass -File .\sync-to-deploy.ps1 with verified Worker and UI bundle health.
