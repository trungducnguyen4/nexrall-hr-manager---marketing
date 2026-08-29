## 2026-08-27T02:31:20Z
You are Worker M2 for Milestone 2: Frontend Client Sync Engine & Reactive Event Bus.

Working Directory: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m2
Project Spec: d:\NetVietTv\nexrall-hr-manager---marketing\PROJECT.md
Original Request Path: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\ORIGINAL_REQUEST.md
Explorer Analysis: d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_2\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Tasks for Milestone 2:
1. Initialize progress.md in your directory with 'Last visited: [timestamp]'.
2. Create `src/event-bus.js`:
   - Implement singleton `EventBus` supporting `on(topic, handler)`, `off(topic, handler)`, `emit(topic, data)`, `once(topic, handler)`.
   - Implement `bindView(viewElement, topic, handler)` which tracks active view subscriptions and automatically unregisters them when the view's lifecycle ends (`el._cleanup` or DOM detachment).
3. Create `src/realtime.js`:
   - Implement `RealtimeClient` class managing persistent connection to `/api/realtime/ws` (WebSocket) with automatic fallback to `/api/realtime/events` (SSE).
   - Support `connect({ user, token })`, `disconnect()`, `subscribe(topic)`, `unsubscribe(topic)`.
   - Support monotonic sequence tracking (`lastSeq`) and request missed-event replay on reconnect (`last_seq`).
   - Support application-level ping/pong heartbeats (30s interval) to detect dead sockets.
   - Support browser tab visibility change (`document.visibilitychange` / `window.focus`) to detect wake-up after system sleep and verify connection health.
   - Pipe incoming server events directly into `EventBus.emit(event.topic, event)` and `EventBus.emit(event.event, event)`.
4. Update `src/api.js`:
   - Connect global cache invalidation to `EventBus`: when real-time events arrive for topics, invalidate related cache prefixes in `_cache`.
5. Update `src/app.js`:
   - Initialize and connect `RealtimeClient` upon successful user authentication.
   - Subscribe to default application topics (`tasks`, `chat`, `notifications`, `attendance`, `leave`, `payroll`, `users`).
   - Remove 10s and 30s `setInterval` polling timers (`_chatUnreadTimer`, `_mentionBadgeTimer`).
   - Replace polling timers with reactive event listeners on `EventBus` (`chat:message_created`, `notification:mention`, `notification:read`, `task:created`, `leave:approved`, etc.) to update header unread counters, alert badges, and task mention badges instantly in real-time.
   - Disconnect real-time stream upon user logout.
6. Create and run unit/integration test suite for frontend reactivity (e.g., `tests/frontend-realtime.test.mjs` verifying EventBus, bindView lifecycle cleanup, RealtimeClient WebSocket/SSE fallback, sequence tracking, and cache invalidation).
7. Verify all tests pass with zero regressions.
8. Write `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_worker_m2\handoff.md` with:
   - Observation: Exact files and changes.
   - Logic Chain: Technical rationale.
   - Caveats: Edge cases.
   - Conclusion: Summary.
   - Verification Method: Test commands run and passing outputs.
9. Send a message to parent when completed.
