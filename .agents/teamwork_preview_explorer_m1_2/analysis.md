# Technical Analysis: Universal `broadcastAppEvent()` Helper & Chat REST Mutation Broadcast Gap Audit

**Milestone**: Milestone 1 (Backend Real-Time Core & Broadcast Pipeline)  
**Agent**: Explorer M1_2 (`teamwork_preview_explorer_m1_2`)  
**Date**: 2026-08-27  
**Scope**: `server.js`, `src/chat-room.js`, Durable Object integration (`SYNC_HUB` & `CHAT_ROOM`), and Chat REST mutation broadcast gap remediation.

---

## 1. Executive Summary & Scope Overview

In NetViet HR's multi-tenant architecture, data mutations occur through REST API endpoints on Cloudflare Workers (`server.js`) as well as direct WebSocket connections inside Durable Objects (`src/chat-room.js`). To fulfill requirement **R2** (Real-Time Infrastructure & Event Broadcasting), every server-side mutation that changes shared state must reliably dispatch real-time events to all relevant clients so that User B observes User A's changes immediately without a page refresh (F5).

This investigation covers two core backend responsibilities:
1. **Universal `broadcastAppEvent()` helper function** in `server.js`: Design of the central broadcast pipeline connecting Worker REST endpoints with the `AppSyncHub` Durable Object singleton (`env.SYNC_HUB`), adhering strictly to the contract defined in `PROJECT.md`.
2. **Chat REST mutation gap audit & concrete remediation**: Comprehensive audit and code-level patch design for all Chat REST endpoints (`PUT /api/messages/:id`, `DELETE /api/messages/:id`, `POST /api/messages/:id/pin`, `POST /api/messages/:id/reactions`, `POST /api/conversations`, etc.) to implement the dual-broadcast pattern (`CHAT_ROOM` DO for per-conversation WS subscribers + `AppSyncHub` DO for global app-wide event bus).

---

## 2. Universal `broadcastAppEvent()` Helper Function Design

### 2.1 Durable Object Binding & Stub Acquisition
The global event distribution engine is managed by the `AppSyncHub` Durable Object (bound as `SYNC_HUB` in `wrangler.toml`). Because NetViet HR operates as a unified organizational workspace, `AppSyncHub` is instantiated as a named singleton:

```javascript
const hubId = env.SYNC_HUB.idFromName('global');
const hubStub = env.SYNC_HUB.get(hubId);
```

### 2.2 Standard Envelope Specification (`PROJECT.md` Contract)
Every event emitted by `broadcastAppEvent()` must conform to the TypeScript contract in `PROJECT.md`:

```typescript
interface RealtimeEvent<T = any> {
  id: string;               // Unique monotonic event identifier (e.g., 'evt_1724749200_a1b2c3')
  seq: number;              // Monotonic sequence number (assigned by AppSyncHub sliding replay buffer)
  topic: string;            // 'tasks' | 'chat' | 'notifications' | 'attendance' | 'leave' | 'payroll' | 'users'
  event: string;            // E.g., 'chat:message_edited', 'task:created', 'leave:approved'
  payload: T;               // Structured domain payload
  actorId: number | null;   // User ID who performed the mutation (for self-exclusion or audit)
  targetUserIds?: number[]; // Optional whitelist of recipient user IDs (omitted for public/topic broadcast)
  timestamp: string;        // ISO 8601 UTC timestamp
}
```

### 2.3 Non-Blocking Execution & Fault Tolerance
A cardinal rule of the NetViet HR architecture is that **broadcast failures must NEVER cause the primary database mutation to fail**.
- All D1 SQLite statements commit first.
- The dispatch to `AppSyncHub` is wrapped in an isolated `try...catch` block.
- Any network, timeout, or hibernation wake-up error inside `AppSyncHub` is logged via `console.warn` but suppressed, returning `{ ok: false, error: ... }` rather than throwing.
- Execution is lightweight and sub-millisecond on Cloudflare's internal DO network.

### 2.4 Complete Implementation Code for `server.js`

```javascript
/**
 * Universal Real-Time Event Broadcaster
 * Dispatches standardized event envelopes to the AppSyncHub Durable Object.
 * Non-blocking & fault-tolerant: broadcast errors never fail the primary D1 transaction.
 *
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {string} topic - Domain topic ('tasks', 'chat', 'notifications', 'attendance', 'leave', 'payroll', 'users')
 * @param {string} eventName - Domain event name ('chat:message_edited', 'task:created', etc.)
 * @param {object} payload - Domain payload data
 * @param {object} [options] - Optional envelope overrides
 * @param {number} [options.actorId] - User ID who triggered the mutation
 * @param {number[]} [options.targetUserIds] - Optional whitelist of recipient user IDs
 * @param {string} [options.id] - Custom event ID (defaults to auto-generated monotonic string)
 * @param {string} [options.timestamp] - ISO 8601 UTC timestamp
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function broadcastAppEvent(env, topic, eventName, payload = {}, options = {}) {
  if (!env?.SYNC_HUB) {
    // Durable Object binding not configured (e.g. unit test or minimal environment)
    return { ok: false, error: 'SYNC_HUB binding not available' };
  }

  const eventId = options.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const timestamp = options.timestamp || new Date().toISOString();
  const actorId = options.actorId !== undefined && options.actorId !== null ? Number(options.actorId) : null;
  const targetUserIds = Array.isArray(options.targetUserIds)
    ? options.targetUserIds.map(Number).filter(id => Number.isInteger(id) && id > 0)
    : undefined;

  const envelope = {
    id: eventId,
    seq: options.seq || 0,
    topic: String(topic),
    event: String(eventName),
    payload: payload || {},
    actorId,
    ...(targetUserIds && targetUserIds.length ? { targetUserIds } : {}),
    timestamp,
  };

  try {
    const hubId = env.SYNC_HUB.idFromName('global');
    const stub = env.SYNC_HUB.get(hubId);
    const response = await stub.fetch('https://sync-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      console.warn(`[broadcastAppEvent] AppSyncHub returned HTTP ${response.status} for ${topic}:${eventName}`);
      return { ok: false, status: response.status };
    }
    return { ok: true, id: eventId };
  } catch (error) {
    console.warn(`[broadcastAppEvent] Broadcast failed for ${topic}:${eventName}:`, error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}
```

---

## 3. Chat Real-Time Architecture & Dual-Broadcast Pattern

In the NetViet HR codebase, Chat has two real-time channels:
1. **`CHAT_ROOM` Durable Object** (`src/chat-room.js`): Sharded per conversation ID (`env.CHAT_ROOM.idFromName(String(convId))`). Dedicated to users actively viewing a specific conversation tab (handling typing indicators, direct socket fan-out, Web Push notifications).
2. **`AppSyncHub` Durable Object** (`src/sync-hub.js`): Global user-level connection hub. Dedicated to real-time sync across the entire app (updating conversation sidebar unread counters, notification badge increments, toast popups when viewing Tasks/Leave/Attendance, and real-time conversation list updates).

### The Dual-Broadcast Requirement
When a Chat mutation occurs via REST in `server.js`, it **must broadcast to both**:
- `broadcastChatUpdate(env, conversationId, chatRoomPayload)` -> Informs all clients currently inside that chat room's WebSocket.
- `broadcastAppEvent(env, 'chat', appSyncEvent, envelopePayload, options)` -> Informs all users connected to `AppSyncHub` across the entire application.

```
                  ┌──> [CHAT_ROOM DO (convId)] ──> [Active Conversation View]
[REST Mutation] ──┤
                  └──> [AppSyncHub DO (global)] ──> [Global Event Bus / All Clients]
```

---

## 4. Chat REST Mutation Gap Audit & Remediation Guide

Below is the complete audit of the 5 key Chat REST mutation gaps in `server.js`, including current flawed code, identified root causes, and exact drop-in replacements.

### Gap 1: `PUT /api/messages/:id` (Message Editing)
* **Location in `server.js`**: Lines 9491–9501
* **Current Vulnerability**:
  - Updates D1 `messages` table directly.
  - Does NOT fetch `conversation_id` or check if the record exists/sender is owner.
  - Does NOT call `broadcastChatUpdate()` -> active chat room clients never see the edited text.
  - Does NOT call `broadcastAppEvent()` -> global app bus is oblivious to message edit.
* **Proposed Drop-In Replacement**:
```javascript
  const msgMatch = path.match(/^\/api\/messages\/(\d+)$/);
  if (msgMatch && request.method === 'PUT') {
    const msgId = parseInt(msgMatch[1]);
    const existing = await env.DB.prepare(
      'SELECT conversation_id, sender_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(msgId).first();
    if (!existing) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    if (Number(existing.sender_id) !== Number(me.id)) {
      return json({ error: 'Chỉ người gửi mới được sửa tin nhắn' }, 403);
    }

    const b = await request.json().catch(() => ({}));
    const content = String(b.content || '').trim();
    if (!content) return json({ error: 'Nội dung không được để trống' }, 400);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    await env.DB.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND sender_id = ?')
      .bind(content, now, msgId, me.id).run();

    const updated = await getChatMessage(env, msgId, me.id);

    // Dual-broadcast
    await broadcastChatUpdate(env, existing.conversation_id, { type: 'message:edit', message: updated });
    await broadcastAppEvent(env, 'chat', 'chat:message_edited', {
      conversation_id: existing.conversation_id,
      message_id: msgId,
      message: updated,
    }, { actorId: me.id });

    return json({ ok: true, message: updated });
  }
```

---

### Gap 2: `DELETE /api/messages/:id` (Message Deletion)
* **Location in `server.js`**: Lines 9503–9509
* **Current Vulnerability**:
  - Sets `deleted_at = now` blindly.
  - Does NOT retrieve `conversation_id`.
  - Does NOT call `broadcastChatUpdate()` -> active conversation views retain the deleted message until refresh.
  - Does NOT call `broadcastAppEvent()` -> no event fired to update last message preview in conversation list.
* **Proposed Drop-In Replacement**:
```javascript
  if (msgMatch && request.method === 'DELETE') {
    const msgId = parseInt(msgMatch[1]);
    const existing = await env.DB.prepare(
      'SELECT conversation_id, sender_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(msgId).first();
    if (!existing) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    if (Number(existing.sender_id) !== Number(me.id) && me.role !== 'admin' && me.role !== 'director') {
      return json({ error: 'Chỉ người gửi mới được xóa tin nhắn' }, 403);
    }

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?')
      .bind(now, msgId).run();

    // Dual-broadcast
    await broadcastChatUpdate(env, existing.conversation_id, {
      type: 'message:delete',
      message_id: msgId,
      deleted_at: now,
    });
    await broadcastAppEvent(env, 'chat', 'chat:message_deleted', {
      conversation_id: existing.conversation_id,
      message_id: msgId,
      deleted_at: now,
    }, { actorId: me.id });

    return json({ ok: true, message_id: msgId, deleted_at: now });
  }
```

---

### Gap 3: `POST /api/messages/:id/pin` & `DELETE /api/messages/:id/pin` (Pin/Unpin Message)
* **Location in `server.js`**: Lines 9511–9528
* **Current Vulnerability**:
  - Inserts/deletes from `pinned_messages` table.
  - Does NOT broadcast to `CHAT_ROOM` DO -> pinned message bar at the top of the chat view remains stale for peer users.
  - Does NOT broadcast to `AppSyncHub` DO.
* **Proposed Drop-In Replacement**:
```javascript
  const msgPinMatch = path.match(/^\/api\/messages\/(\d+)\/pin$/);
  if (msgPinMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const messageId = Number(msgPinMatch[1]);
    const message = await env.DB.prepare(
      'SELECT id, conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(messageId).first();
    if (!message) return json({ error: 'Không tìm thấy tin nhắn' }, 404);

    const member = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(message.conversation_id, me.id).first();
    if (!member) return json({ error: 'Không có quyền ghim tin nhắn này' }, 403);

    const isPinning = request.method === 'POST';
    if (isPinning) {
      await env.DB.prepare('INSERT OR IGNORE INTO pinned_messages (conversation_id, message_id, pinned_by) VALUES (?, ?, ?)')
        .bind(message.conversation_id, messageId, me.id).run();
    } else {
      await env.DB.prepare('DELETE FROM pinned_messages WHERE conversation_id = ? AND message_id = ?')
        .bind(message.conversation_id, messageId).run();
    }

    // Dual-broadcast
    await broadcastChatUpdate(env, message.conversation_id, {
      type: 'message:pin',
      message_id: messageId,
      conversation_id: message.conversation_id,
      is_pinned: isPinning,
      pinned_by: me.id,
    });
    await broadcastAppEvent(env, 'chat', 'chat:message_pinned', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      is_pinned: isPinning,
      pinned_by: me.id,
    }, { actorId: me.id });

    return json({ ok: true, pinned: isPinning, message_id: messageId });
  }
```

---

### Gap 4: `POST /api/messages/:id/reactions` & `DELETE /api/messages/:id/reactions` (Reactions)
* **Location in `server.js`**: Lines 9530–9547
* **Current Vulnerability**:
  - Inserts/deletes from `message_reactions`.
  - Does NOT query aggregated reactions.
  - Does NOT broadcast to `CHAT_ROOM` DO (`reaction:update`) -> reaction pills below messages do not update in real-time.
  - Does NOT broadcast to `AppSyncHub` DO (`chat:reaction_updated`).
* **Proposed Drop-In Replacement**:
```javascript
  const msgReactionMatch = path.match(/^\/api\/messages\/(\d+)\/reactions$/);
  if (msgReactionMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const msgId = parseInt(msgReactionMatch[1]);
    const message = await env.DB.prepare(
      'SELECT id, conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(msgId).first();
    if (!message) return json({ error: 'Không tìm thấy tin nhắn' }, 404);

    const isMember = await chatMember(env, message.conversation_id, me.id);
    if (!isMember) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const emoji = String(b.emoji || '').trim();
      if (!emoji) return json({ error: 'Emoji là bắt buộc' }, 400);
      await env.DB.prepare('INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
        .bind(msgId, me.id, emoji).run();
    } else {
      const emoji = url.searchParams.get('emoji') || '';
      if (emoji) {
        await env.DB.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
          .bind(msgId, me.id, emoji).run();
      } else {
        await env.DB.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?')
          .bind(msgId, me.id).run();
      }
    }

    const { results: reactions = [] } = await env.DB.prepare(
      `SELECT mr.emoji, mr.user_id, u.full_name AS user_name
       FROM message_reactions mr JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ?`
    ).bind(msgId).all();

    // Dual-broadcast
    await broadcastChatUpdate(env, message.conversation_id, {
      type: 'reaction:update',
      message_id: msgId,
      conversation_id: message.conversation_id,
      reactions,
    });
    await broadcastAppEvent(env, 'chat', 'chat:reaction_updated', {
      conversation_id: message.conversation_id,
      message_id: msgId,
      reactions,
    }, { actorId: me.id });

    return json({ ok: true, reactions });
  }
```

---

### Gap 5: `POST /api/conversations` (New Conversation Creation)
* **Location in `server.js`**: Lines 9101–9128
* **Current Vulnerability**:
  - Creates conversation and inserts member rows.
  - Does NOT dispatch any broadcast to target member user IDs.
  - When User A creates a direct chat or group with User B, User B never sees the conversation appear in their left sidebar until a full page reload occurs.
* **Proposed Drop-In Replacement**:
```javascript
  if (path === '/api/conversations' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const type = ['direct', 'group', 'team', 'project'].includes(b.type) ? b.type : 'direct';
    const name = String(b.name || '').slice(0, 200) || null;
    const memberIds = Array.isArray(b.member_ids)
      ? [...new Set(b.member_ids.map(Number).filter(id => id > 0 && id !== me.id))]
      : [];

    if (type === 'direct' && memberIds.length !== 1) return json({ error: 'DM cần đúng 1 người nhận' }, 400);

    if (type === 'direct') {
      const existing = await env.DB.prepare(
        `SELECT c.id FROM conversations c
         WHERE c.type = 'direct'
           AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?)
           AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?)
           AND (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) = 2`
      ).bind(me.id, memberIds[0]).first();
      if (existing) return json({ conversation_id: existing.id });
    }

    const result = await env.DB.prepare(
      'INSERT INTO conversations (type, name, team_id, project_id, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(type, name, b.team_id || null, b.project_id || null, me.id).run();
    const convId = result.meta?.last_row_id;

    await env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)')
      .bind(convId, me.id, 'owner').run();
    for (const uid of memberIds) {
      await env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)')
        .bind(convId, uid, 'member').run();
    }

    const allMemberIds = [Number(me.id), ...memberIds];
    const convRow = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
    const members = await env.DB.prepare(
      `SELECT cm.user_id, u.full_name, u.employee_code, u.avatar_url, cm.role
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`
    ).bind(convId).all().then(r => r.results || []);

    const createdConv = {
      ...convRow,
      members,
      member_count: members.length,
      unread_count: 0,
      last_message: null,
    };

    // Broadcast conversation:created targeted to all members
    await broadcastAppEvent(env, 'chat', 'chat:conversation_created', {
      conversation_id: convId,
      conversation: createdConv,
    }, {
      actorId: me.id,
      targetUserIds: allMemberIds,
    });

    return json({ conversation_id: convId, conversation: createdConv });
  }
```

---

### Gap 6: Additional Chat REST Endpoints (Completeness Audit)

1. **`POST /api/conversations/:id/messages` (REST Message Send)** (Lines 9254–9352):
   - In addition to existing `broadcastChatUpdate(env, convId, { type: 'message:new', message })`, must also call:
     ```javascript
     const { results: memberRows = [] } = await env.DB.prepare(
       'SELECT user_id FROM conversation_members WHERE conversation_id = ?'
     ).bind(convId).all();
     const allMemberIds = memberRows.map(r => Number(r.user_id)).filter(Boolean);

     await broadcastAppEvent(env, 'chat', 'chat:message_created', {
       conversation_id: convId,
       message,
     }, {
       actorId: me.id,
       targetUserIds: allMemberIds,
     });
     ```
2. **`PUT /api/conversations/:id` (Rename Conversation)** (Lines 9164–9174):
   - Add dual broadcast with `chat:conversation_updated` event.
3. **`DELETE /api/conversations/:id` (Dissolve Group)** (Lines 9143–9162):
   - In addition to existing `broadcastChatUpdate()`, add `broadcastAppEvent(env, 'chat', 'chat:conversation_dissolved', { conversation_id: convId }, { actorId: me.id, targetUserIds: allMemberIds })`.
4. **`PUT /api/messages/:id/poll-votes` & `POST /api/messages/:id/poll/close`** (Lines 9398–9434):
   - Add `broadcastAppEvent(env, 'chat', 'chat:poll_updated', { conversation_id: message.conversation_id, message_id: messageId, poll: updated?.poll }, { actorId: me.id })`.
5. **`PUT /api/messages/:id/event`, `PUT /api/messages/:id/event-response`, `DELETE /api/messages/:id/event`** (Lines 9437–9489):
   - Add `broadcastAppEvent(env, 'chat', 'chat:event_updated', { conversation_id: message.conversation_id, message_id: messageId, event: updated?.event }, { actorId: me.id })`.

---

## 5. Event Catalog for Topic `chat`

| Event Name | Trigger Endpoint | Payload Keys | Target Recipients |
|---|---|---|---|
| `chat:message_created` | `POST /api/conversations/:id/messages` | `conversation_id`, `message` | Conversation members (`targetUserIds`) |
| `chat:message_edited` | `PUT /api/messages/:id` | `conversation_id`, `message_id`, `message` | Public topic or members |
| `chat:message_deleted` | `DELETE /api/messages/:id` | `conversation_id`, `message_id`, `deleted_at` | Public topic or members |
| `chat:message_pinned` | `POST` / `DELETE /api/messages/:id/pin` | `conversation_id`, `message_id`, `is_pinned`, `pinned_by` | Public topic or members |
| `chat:reaction_updated`| `POST` / `DELETE /api/messages/:id/reactions` | `conversation_id`, `message_id`, `reactions` | Public topic or members |
| `chat:conversation_created` | `POST /api/conversations` | `conversation_id`, `conversation` | Whitelist `[creatorId, ...memberIds]` |
| `chat:conversation_updated` | `PUT /api/conversations/:id` | `conversation_id`, `name` | Conversation members |
| `chat:conversation_dissolved` | `DELETE /api/conversations/:id` | `conversation_id` | Conversation members |
| `chat:poll_updated` | `PUT .../poll-votes`, `POST .../poll/close` | `conversation_id`, `message_id`, `poll` | Conversation members |
| `chat:event_updated` | `PUT .../event`, `PUT .../event-response`, `DELETE .../event` | `conversation_id`, `message_id`, `event` | Conversation members |

---

## 6. Implementation Checklist for Milestone 1 Backend Implementer

1. **Insert `broadcastAppEvent()` helper function** in `server.js` (around line 2200, exportable).
2. **Apply the 5 Chat REST mutation patches** in `server.js`:
   - `PUT /api/messages/:id` (message edit)
   - `DELETE /api/messages/:id` (message delete)
   - `POST /api/messages/:id/pin` and `DELETE /api/messages/:id/pin` (pin/unpin)
   - `POST /api/messages/:id/reactions` and `DELETE /api/messages/:id/reactions` (reactions)
   - `POST /api/conversations` (conversation creation)
3. **Apply enhancements** to `POST /api/conversations/:id/messages`, `PUT /api/conversations/:id`, poll endpoints, and event endpoints in `server.js`.
4. **Import and invoke `broadcastAppEvent()` in `src/chat-room.js`** inside `handleSend()`, `handleEdit()`, `handleDelete()`, and `handleReaction()` to ensure WebSocket mutations also update global `AppSyncHub`.
5. **Verify syntax**: Execute `node --check server.js` and `node --check src/chat-room.js`.
