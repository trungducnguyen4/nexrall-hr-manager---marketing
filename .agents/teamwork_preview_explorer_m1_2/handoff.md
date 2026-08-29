# Handoff Report: Universal `broadcastAppEvent()` Helper & Chat REST Mutation Broadcast Remediation

**Milestone**: Milestone 1 (Backend Real-Time Core & Broadcast Pipeline)  
**Agent**: Explorer M1_2 (`teamwork_preview_explorer_m1_2`)  
**Working Directory**: `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_2`  
**Handoff Type**: Hard (Task Complete)

---

## 1. Observation

1. **Missing Universal `broadcastAppEvent()` Helper**:
   - `server.js` currently defines `broadcastChatUpdate(env, conversationId, payload)` at lines 2195–2201, which communicates strictly with `env.CHAT_ROOM` DO via `https://chat-room.internal/broadcast`.
   - There is no universal event broadcaster connecting Worker REST mutation routes to the global `AppSyncHub` Durable Object singleton (`env.SYNC_HUB.get(env.SYNC_HUB.idFromName('global'))`).

2. **Chat REST Mutation Broadcast Gaps in `server.js`**:
   - **`PUT /api/messages/:id`** (Lines 9491–9501):
     ```javascript
     const msgMatch = path.match(/^\/api\/messages\/(\d+)$/);
     if (msgMatch && request.method === 'PUT') {
       const msgId = parseInt(msgMatch[1]);
       const b = await request.json().catch(() => ({}));
       const content = String(b.content || '').trim();
       if (!content) return json({ error: 'Nội dung không được để trống' }, 400);
       const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
       await env.DB.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND sender_id = ?')
         .bind(content, now, msgId, me.id).run();
       return json({ ok: true });
     }
     ```
     *Directly observed*: Zero broadcast calls (`broadcastChatUpdate` is missing, `broadcastAppEvent` is missing). Message ownership is not verified beforehand, nor is `conversation_id` extracted.
   
   - **`DELETE /api/messages/:id`** (Lines 9503–9509):
     ```javascript
     if (msgMatch && request.method === 'DELETE') {
       const msgId = parseInt(msgMatch[1]);
       const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
       await env.DB.prepare('UPDATE messages SET deleted_at = ? WHERE id = ? AND sender_id = ?')
         .bind(now, msgId, me.id).run();
       return json({ ok: true });
     }
     ```
     *Directly observed*: Zero broadcast calls to `CHAT_ROOM` or `AppSyncHub`.
   
   - **`POST /api/messages/:id/pin` and `DELETE /api/messages/:id/pin`** (Lines 9511–9528):
     *Directly observed*: Updates `pinned_messages` table in D1 but triggers no real-time broadcast to `CHAT_ROOM` or `AppSyncHub`.
   
   - **`POST /api/messages/:id/reactions` and `DELETE /api/messages/:id/reactions`** (Lines 9530–9547):
     *Directly observed*: Inserts/deletes from `message_reactions` in D1 but does not fetch aggregated reactions or dispatch any real-time event.
   
   - **`POST /api/conversations`** (Lines 9101–9128):
     *Directly observed*: Inserts row into `conversations` and `conversation_members`, but emits zero events to target member user IDs.

3. **`ChatRoom` DO WebSocket Handlers in `src/chat-room.js`**:
   - `ChatRoom` handles WS events (`message:send`, `message:edit`, `message:delete`, `reaction:add`, `reaction:remove`), but only broadcasts via `this.broadcast()` to sockets connected to that specific room instance. It does not forward events to `AppSyncHub` for app-wide UI updates (unread badges, global notification toasts).

---

## 2. Logic Chain

1. **Premise 1**: For requirement R2 (Real-Time Infrastructure) and R1 (Shared-Data Inventory), whenever User A modifies shared chat data (editing a message, deleting a message, pinning a message, reacting with emoji, or creating a conversation), all other active users must receive real-time updates without manual page refresh.
2. **Premise 2**: Active conversation viewers are connected via WebSocket to `CHAT_ROOM` DO (`src/chat-room.js`), while users browsing other areas of the application (e.g. Tasks, Attendance, Leave) or holding general browser sessions are connected via `AppSyncHub` DO (`src/sync-hub.js`).
3. **Inference 1**: Therefore, every chat mutation route in `server.js` requires a **Dual-Broadcast** pattern:
   - Call `broadcastChatUpdate(env, conversationId, payload)` to update the active `ChatRoom` DO room sockets.
   - Call `broadcastAppEvent(env, 'chat', eventName, payload, options)` to update the global `AppSyncHub` DO connection pool.
4. **Inference 2**: `broadcastAppEvent()` must format the envelope strictly according to `PROJECT.md` (`id`, `seq`, `topic`, `event`, `payload`, `actorId`, `targetUserIds`, `timestamp`) and must isolate DO network calls in a `try...catch` block to guarantee zero disruption to D1 SQL transactions.
5. **Inference 3**: Replacing the 5 flawed Chat REST endpoints with complete, robust implementations (ownership check, D1 commit, hydration, dual-broadcast, and enriched response) completely solves the Chat REST real-time synchronization gap.

---

## 3. Caveats

1. **Durable Object Binding Name**: The analysis assumes `wrangler.toml` binds `AppSyncHub` under `SYNC_HUB` (`[[durable_objects.bindings]] name = "SYNC_HUB" class_name = "AppSyncHub"`), which is being coordinated by M1_1. If named differently, the binding name in `broadcastAppEvent()` must match.
2. **Replay Buffer Sequences**: `seq` is passed as `0` by `server.js` and assigned monotonically by `AppSyncHub` inside its sliding replay buffer, preserving chronological event ordering.
3. **No Code Written to Source Files**: As an Explorer, this analysis only produces design specifications and concrete code blueprints in `.agents/teamwork_preview_explorer_m1_2/analysis.md`. The implementer will apply these changes to `server.js` and `src/chat-room.js`.

---

## 4. Conclusion

1. The universal helper `broadcastAppEvent(env, topic, eventName, payload, options)` is fully specified and ready for insertion into `server.js`.
2. All 5 Chat REST mutation endpoints (`PUT /api/messages/:id`, `DELETE /api/messages/:id`, `POST /api/messages/:id/pin`, `POST /api/messages/:id/reactions`, `POST /api/conversations`), plus supporting endpoints (`POST /messages`, `PUT /conversations/:id`, polls, events), have been audited with exact line numbers and complete, drop-in replacement code written in `analysis.md`.
3. The Dual-Broadcast architecture cleanly decouples conversation-scoped WebSocket rooms (`CHAT_ROOM`) from app-wide event distribution (`AppSyncHub`), resolving all unread badge, toast notification, and view staleness issues.

---

## 5. Verification Method

To independently verify the analysis and implementation:

1. **Inspect Analysis Artifact**:
   - Read `d:\NetVietTv\nexrall-hr-manager---marketing\.agents\teamwork_preview_explorer_m1_2\analysis.md`.
2. **Syntax Validation**:
   - Run `node --check server.js`
   - Run `node --check src/chat-room.js`
3. **Endpoint Real-Time Verification**:
   - When implemented in Milestone 1:
     - Client A sends `PUT /api/messages/:id` -> Verify `chat:message_edited` arrives on Client B's WebSocket (`CHAT_ROOM` and `AppSyncHub`) without page reload.
     - Client A sends `DELETE /api/messages/:id` -> Verify `chat:message_deleted` arrives on Client B.
     - Client A sends `POST /api/messages/:id/pin` -> Verify `chat:message_pinned` arrives on Client B.
     - Client A sends `POST /api/messages/:id/reactions` -> Verify `chat:reaction_updated` arrives on Client B.
     - Client A sends `POST /api/conversations` -> Verify `chat:conversation_created` arrives on Client B's `AppSyncHub` stream and auto-renders in conversation list.
