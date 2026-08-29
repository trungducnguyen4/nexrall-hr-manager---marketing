# BRIEFING — 2026-08-27T02:06:30Z

## Mission
Implement Milestone 1: Backend Real-Time Core & Broadcast Pipeline (AppSyncHub Durable Object, wrangler.toml, worker.js, server.js real-time endpoints and universal domain mutation broadcasts).

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m1
- Original parent: 27a75596-2468-49af-8063-8f1274737242
- Milestone: Milestone 1 - Backend Real-Time Core & Broadcast Pipeline

## 🔒 Key Constraints
- DO NOT CHEAT. All implementations must be genuine.
- Real-time engine using Cloudflare DO Hibernation API (`this.ctx.acceptWebSocket(server)`).
- Session serialization on socket attachment (`ws.serializeAttachment()`).
- Ping/Pong heartbeat (30s heartbeat, handling client pings, socket liveness checks).
- 100-event sliding replay buffer with monotonic sequence IDs and timestamps.
- Internal RPC / HTTP endpoint (`POST /broadcast`) supporting topic/user filtering.
- SSE fallback stream support (`/api/realtime/events`).
- Stats endpoint (`/api/realtime/stats`).
- Universal `broadcastAppEvent(env, topic, eventName, payload, options)` in server.js.
- Inject real-time broadcasts into all domain mutations (Tasks, Subtasks, Comments, Mentions, Attendance, Overtime, Leave, Payroll, Payslips, Invoices, Users, Roles) & Chat REST mutations.

## Current Parent
- Conversation ID: 27a75596-2468-49af-8063-8f1274737242
- Updated: not yet

## Task Summary
- **What to build**: AppSyncHub Durable Object class in `src/sync-hub.js`, configure `wrangler.toml` and `worker.js`, route real-time endpoints and integrate `broadcastAppEvent` across all domain REST mutations in `server.js`.
- **Success criteria**: All real-time routes working, WebSocket/SSE/stats functional, broadcasts emitted on all domain mutations, all tests passing.
- **Interface contracts**: PROJECT.md, Explorer analysis reports.
- **Code layout**: `src/sync-hub.js`, `worker.js`, `wrangler.toml`, `server.js`, `tests/`.

## Key Decisions Made
- Followed Cloudflare DO Hibernation API specifications with `this.ctx.acceptWebSocket(server)`, `ws.serializeAttachment()`, `ws.deserializeAttachment()`.
- Built monotonic sequence counter (`seq`) with 100-event FIFO sliding buffer persisted to storage.
- Reconnection replay handling with `replay:batch`, `replay:complete`, and `replay:overflow`.
- Ensured `broadcastAppEvent()` is non-blocking and fault-tolerant across all domain mutations in `server.js`.
- Added dual-broadcasting in `src/chat-room.js` for ChatRoom WebSocket mutations.

## Artifact Index
- `src/sync-hub.js` — AppSyncHub DO implementation
- `wrangler.toml` — DO bindings and migrations
- `worker.js` — Export AppSyncHub DO
- `server.js` — Realtime routing & domain mutation broadcast hooks
- `src/chat-room.js` — Dual-broadcast hooks for chat room operations
- `tests/sync-hub.test.mjs` — Test suite for real-time broadcast and sync hub functionality

## Change Tracker
- **Files modified**: `src/sync-hub.js`, `wrangler.toml`, `worker.js`, `server.js`, `src/chat-room.js`, `tests/sync-hub.test.mjs`
- **Build status**: Pass (`node --check` passed cleanly on all files)
- **Pending issues**: None

## Quality Status
- **Build/test result**: Pass (9/9 in `sync-hub.test.mjs`, all existing unit tests pass)
- **Lint status**: Clean
- **Tests added/modified**: `tests/sync-hub.test.mjs` (9 comprehensive unit/integration test cases)
