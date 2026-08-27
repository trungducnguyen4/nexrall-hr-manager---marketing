// ── ChatRoom Durable Object ─────────────────────────────────────────
// One DO instance per conversation. Manages WebSocket connections,
// broadcasts real-time events, persists messages to D1.
// Events: message:send, message:edit, message:delete, reaction:add,
//          reaction:remove, poll:update, event:update, typing:start,
//          typing:stop, conversation:read
// =====================================================================

import { sendWebPushNotification } from '../server.js';

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Map of WebSocket → session data (restored after hibernation)
    this.sessions = new Map();
    this.conversationId = null;
    // Restore sessions from hibernated WebSocket connections
    this.restoreSessions();
  }

  // ── Restore sessions after hibernation ────────────────────────────
  restoreSessions() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const session = ws.deserializeAttachment();
        if (session && session.userId) {
          this.sessions.set(ws, session);
          if (!this.conversationId && session.conversationId) {
            this.conversationId = session.conversationId;
          }
        }
      } catch (_) { /* socket may not have attachment yet */ }
    }
  }

  // ── HTTP fetch — handles WebSocket upgrade ──────────────────────────
  async fetch(request) {
    const url = new URL(request.url);
    const requestedConversationId = url.searchParams.get('conv');
    if (requestedConversationId) this.conversationId = requestedConversationId;

    // Worker-only fan-out used by REST fallbacks (poll/event updates). This
    // Durable Object binding is not publicly routable, so no browser client
    // can invoke it directly.
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const payload = await request.json().catch(() => null);
      if (payload?.type) this.broadcast(payload);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────
  async webSocketMessage(ws, raw) {
    try {
      const msg = JSON.parse(raw);

      // Auth must be processed BEFORE session check — a new WebSocket
      // has no session yet, and auth is what creates it.
      if (msg.type === 'auth') {
        await this.handleAuth(ws, msg);
        return;
      }

      const session = this.sessions.get(ws);
      if (!session) {
        ws.send(JSON.stringify({ type: 'auth:error', message: 'WebSocket chưa được xác thực' }));
        return;
      }

      switch (msg.type) {
        case 'message:send': await this.handleSend(session, msg); break;
        case 'message:edit': await this.handleEdit(session, msg); break;
        case 'message:delete': await this.handleDelete(session, msg); break;
        case 'reaction:add': await this.handleReaction(session, msg, 'add'); break;
        case 'reaction:remove': await this.handleReaction(session, msg, 'remove'); break;
        case 'typing:start': this.broadcast({ type: 'typing:start', user_id: session.userId, user_name: session.userName }, ws); break;
        case 'typing:stop': this.broadcast({ type: 'typing:stop', user_id: session.userId }, ws); break;
        case 'conversation:read': await this.handleRead(session, msg); break;
      }
    } catch (error) {
      console.error('ChatRoom WS error', error?.message || error);
    }
  }

  async webSocketClose(ws, code, reason) {
    const session = this.sessions.get(ws);
    if (session) {
      this.broadcast({ type: 'user:offline', user_id: session.userId }, ws);
      this.sessions.delete(ws);
    }
  }

  async webSocketError(ws, error) {
    console.error('ChatRoom WS error', error?.message || error);
  }

  // ── Auth ──────────────────────────────────────────────────────────
  async handleAuth(ws, msg) {
    if (!msg.token || !msg.user_id) return;
    // Verify token against sessions table
    let user = null;
    try {
      user = await this.env.DB.prepare(
        `SELECT u.id, u.full_name, u.employee_code
         FROM users u JOIN sessions s ON s.user_id = u.id
         WHERE s.token = ? AND s.revoked = 0 AND s.expires_at > ?`
      ).bind(msg.token, Math.floor(Date.now() / 1000)).first();
    } catch (_) { /* fall through */ }

    if (!user) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid token' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    // conversationId is set during fetch() WS upgrade. After hibernation,
    // it may be restored from a previously attached session (see restoreSessions).
    // DO NOT fall back to this.ctx.id.toString() — that is NOT a numeric conv ID.
    if (!this.conversationId) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Conversation ID missing' }));
      ws.close(4000, 'Internal error');
      return;
    }

    const sessionData = {
      userId: user.id,
      userName: user.full_name || 'Unknown',
      userCode: user.employee_code || '',
      conversationId: this.conversationId,
    };

    // Persist session on the WebSocket so it survives DO hibernation.
    // Cloudflare Hibernation API: WebSocket connections are preserved
    // but the JS instance is destroyed. serializeAttachment stores
    // session data that can be restored via deserializeAttachment().
    ws.serializeAttachment(sessionData);
    this.sessions.set(ws, sessionData);

    // Verify user is a member of this conversation
    const isMember = await this.env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(Number(this.conversationId), user.id).first();

    if (!isMember) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Not a member' }));
      ws.close(4003, 'Forbidden');
      return;
    }

    ws.send(JSON.stringify({ type: 'auth:ok', user_id: user.id, user_name: user.full_name }));
    this.broadcast({ type: 'user:online', user_id: user.id, user_name: user.full_name }, ws);
  }

  // ── Message handlers ──────────────────────────────────────────────
  async handleSend(session, msg) {
    if (!msg.content && !msg.attachments?.length) return;
    const convId = Number(this.conversationId);
    const content = String(msg.content || '').trim();
    const replyToId = msg.reply_to_id ? Number(msg.reply_to_id) : null;
    if (msg.mention_all) {
      const conversation = await this.env.DB.prepare('SELECT type FROM conversations WHERE id=?').bind(convId).first();
      if (conversation?.type === 'direct' || !/(^|\s)@all\b/i.test(content)) {
        return;
      }
    }

    const result = await this.env.DB.prepare(
      `INSERT INTO messages (conversation_id, sender_id, content, reply_to_id, task_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(convId, session.userId, content || null, replyToId, msg.task_id ? Number(msg.task_id) : null).run();

    const messageId = result.meta?.last_row_id;
    if (!messageId) return;

    await this.saveMentions(convId, messageId, session.userId, msg.mention_ids);
    await this.saveAllMention(convId, messageId, session.userId, msg.mention_all, content);

    // Handle attachments
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        await this.env.DB.prepare(
          `INSERT INTO message_attachments (message_id, type, file_name, file_size, mime_type, storage_key, width, height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(messageId, att.type || 'file', att.file_name, att.file_size || 0, att.mime_type || '', att.storage_key, att.width || null, att.height || null).run();
      }
    }

    // Fetch full message with attachments and sender info
    const fullMsg = await this.fetchMessage(messageId, session.userId);
    if (!fullMsg) return;

    this.broadcast({ type: 'message:new', message: fullMsg });

    // ── Web Push to offline members (lock screen / background) ──
    try {
      const { results: memberRows = [] } = await this.env.DB.prepare(
        'SELECT user_id FROM conversation_members WHERE conversation_id = ?'
      ).bind(convId).all();

      // Collect online user IDs from active WebSocket sessions
      const onlineUserIds = new Set();
      for (const [, s] of this.sessions) {
        if (s.userId) onlineUserIds.add(Number(s.userId));
      }

      // Push only to users NOT currently connected via WebSocket
      const offlineRecipientIds = memberRows
        .map(r => Number(r.user_id))
        .filter(uid => uid && uid !== session.userId && !onlineUserIds.has(uid));

      if (offlineRecipientIds.length) {
        const convRow = await this.env.DB.prepare('SELECT name, type FROM conversations WHERE id = ?').bind(convId).first();
        const senderName = fullMsg.sender_name || session.userName || 'NetViet Chat';
        const isGroup = convRow?.type !== 'direct';
        const title = isGroup && convRow?.name ? `${convRow.name} (${senderName})` : senderName;
        const preview = fullMsg.content || '📎 [Tệp đính kèm]';

        await sendWebPushNotification(this.env, offlineRecipientIds, {
          title,
          body: preview,
          icon: fullMsg.sender_avatar || '/icon-192.png',
          badge: '/icon-192.png',
          url: `/#/chat/${convId}/${messageId}`,
          tag: `chat-${convId}-${messageId}`,
        });
      }
    } catch (pushErr) {
      console.warn('ChatRoom WS push error:', pushErr?.message || pushErr);
    }
  }

  async handleEdit(session, msg) {
    if (!msg.message_id || !msg.content) return;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await this.env.DB.prepare(
      'UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND sender_id = ?'
    ).bind(String(msg.content), now, Number(msg.message_id), session.userId).run();

    const updated = await this.fetchMessage(Number(msg.message_id), session.userId);
    if (updated) this.broadcast({ type: 'message:edit', message: updated });
  }

  async handleDelete(session, msg) {
    if (!msg.message_id) return;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await this.env.DB.prepare(
      'UPDATE messages SET deleted_at = ? WHERE id = ? AND sender_id = ?'
    ).bind(now, Number(msg.message_id), session.userId).run();

    this.broadcast({ type: 'message:delete', message_id: Number(msg.message_id), deleted_at: now });
  }

  async handleReaction(session, msg, action) {
    if (!msg.message_id || !msg.emoji) return;
    const messageId = Number(msg.message_id);
    const emoji = String(msg.emoji);

    if (action === 'add') {
      await this.env.DB.prepare(
        'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
      ).bind(messageId, session.userId, emoji).run();
    } else {
      await this.env.DB.prepare(
        'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
      ).bind(messageId, session.userId, emoji).run();
    }

    const reactions = await this.fetchReactions(messageId);
    this.broadcast({ type: 'reaction:update', message_id: messageId, reactions });
  }

  async handleRead(session, msg) {
    if (!msg.message_id) return;
    const messageId = Number(msg.message_id);
    await this.env.DB.prepare(
      'INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)'
    ).bind(messageId, session.userId).run();

    // Update last_read_message_id
    await this.env.DB.prepare(
      'UPDATE conversation_members SET last_read_message_id = MAX(last_read_message_id, ?) WHERE conversation_id = ? AND user_id = ?'
    ).bind(messageId, Number(this.conversationId), session.userId).run();

    this.broadcast({ type: 'conversation:read', user_id: session.userId, message_id: messageId });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  async fetchMessage(messageId, userId) {
    const row = await this.env.DB.prepare(
      `SELECT m.*, u.full_name AS sender_name, u.employee_code AS sender_code, u.avatar_url AS sender_avatar,
       EXISTS(SELECT 1 FROM pinned_messages pm WHERE pm.message_id = m.id) AS is_pinned
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?`
    ).bind(messageId).first();
    if (!row) return null;

    const attachments = await this.env.DB.prepare(
      'SELECT * FROM message_attachments WHERE message_id = ?'
    ).bind(messageId).all().then(r => r.results || []);

    const reactions = await this.fetchReactions(messageId);
    const mentions = await this.env.DB.prepare(
      `SELECT mm.mentioned_user_id AS user_id, u.full_name
       FROM message_mentions mm JOIN users u ON u.id = mm.mentioned_user_id
       WHERE mm.message_id = ?`
    ).bind(messageId).all().then(r => r.results || []);
    const mentionAll = await this.env.DB.prepare('SELECT 1 FROM message_all_mentions WHERE message_id=?').bind(messageId).first();

    return {
      ...row,
      attachments,
      reactions,
      mentions,
      mention_all: !!mentionAll,
      deleted_at: row.deleted_at || null,
      edited_at: row.edited_at || null,
    };
  }

  async fetchReactions(messageId) {
    const { results = [] } = await this.env.DB.prepare(
      `SELECT mr.emoji, mr.user_id, u.full_name AS user_name
       FROM message_reactions mr JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ?`
    ).bind(messageId).all();
    return results;
  }

  async saveMentions(conversationId, messageId, mentionedBy, mentionIds) {
    const requestedIds = [...new Set((Array.isArray(mentionIds) ? mentionIds : [])
      .map(Number).filter(id => Number.isInteger(id) && id > 0 && id !== mentionedBy))].slice(0, 25);
    if (!requestedIds.length) return;
    const placeholders = requestedIds.map(() => '?').join(',');
    const { results = [] } = await this.env.DB.prepare(
      `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id IN (${placeholders})`
    ).bind(conversationId, ...requestedIds).all();
    for (const row of results) {
      await this.env.DB.prepare(
        'INSERT OR IGNORE INTO message_mentions (message_id, mentioned_user_id, mentioned_by) VALUES (?, ?, ?)'
      ).bind(messageId, row.user_id, mentionedBy).run();
    }
  }

  async saveAllMention(conversationId, messageId, mentionedBy, requested, content) {
    if (!requested) return;
    const conversation = await this.env.DB.prepare('SELECT type FROM conversations WHERE id=?').bind(conversationId).first();
    if (conversation?.type === 'direct' || !/(^|\s)@all\b/i.test(String(content || ''))) return;
    await this.env.DB.prepare('INSERT OR IGNORE INTO message_all_mentions (message_id,mentioned_by) VALUES (?,?)')
      .bind(messageId, mentionedBy).run();
  }

  // ── Broadcast ─────────────────────────────────────────────────────
  broadcast(data, excludeWs = null) {
    const payload = JSON.stringify(data);
    // Primary: broadcast via sessions Map (fast lookup)
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs) continue;
      try { ws.send(payload); } catch (_) { /* client may have disconnected */ }
    }
    // Safety net: also broadcast to any WebSocket in ctx.getWebSockets()
    // that may not be in the sessions Map (e.g. restored after hibernation
    // but not yet re-authenticated). These get an auth:error first.
    const knownSockets = new Set(this.sessions.keys());
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs || knownSockets.has(ws)) continue;
      try {
        // This socket hasn't authenticated yet — send auth:error
        ws.send(JSON.stringify({ type: 'auth:error', message: 'Please re-authenticate' }));
      } catch (_) {}
    }
  }
}
