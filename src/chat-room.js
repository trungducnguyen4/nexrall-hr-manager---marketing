// ── ChatRoom Durable Object ─────────────────────────────────────────
// One DO instance per conversation. Manages WebSocket connections,
// broadcasts real-time events, persists messages to D1.
// Events: message:send, message:edit, message:delete, reaction:add,
//          reaction:remove, typing:start, typing:stop, conversation:read
// =====================================================================

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Map of WebSocket → { userId, userName, userCode }
    this.sessions = new Map();
    // Conversation ID extracted from DO name
    this.conversationId = null;
  }

  // ── HTTP fetch (legacy, not used for WS) ──────────────────────────
  async fetch(request) {
    return new Response('ChatRoom DO – use WebSocket', { status: 200 });
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────
  async webSocketMessage(ws, raw) {
    try {
      const msg = JSON.parse(raw);
      const session = this.sessions.get(ws);
      if (!session) return;

      switch (msg.type) {
        case 'auth': await this.handleAuth(ws, msg); break;
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

    // Extract conversation ID from DO name
    if (!this.conversationId) {
      this.conversationId = this.ctx.id.toString();
    }

    this.sessions.set(ws, {
      userId: user.id,
      userName: user.full_name || 'Unknown',
      userCode: user.employee_code || '',
    });

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

    const result = await this.env.DB.prepare(
      `INSERT INTO messages (conversation_id, sender_id, content, reply_to_id, task_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(convId, session.userId, content || null, replyToId, msg.task_id ? Number(msg.task_id) : null).run();

    const messageId = result.meta?.last_row_id;
    if (!messageId) return;

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
      `SELECT m.*, u.full_name AS sender_name, u.employee_code AS sender_code
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?`
    ).bind(messageId).first();
    if (!row) return null;

    const attachments = await this.env.DB.prepare(
      'SELECT * FROM message_attachments WHERE message_id = ?'
    ).bind(messageId).all().then(r => r.results || []);

    const reactions = await this.fetchReactions(messageId);

    return {
      ...row,
      attachments,
      reactions,
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

  // ── Broadcast ─────────────────────────────────────────────────────
  broadcast(data, excludeWs = null) {
    const payload = JSON.stringify(data);
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs) continue;
      try { ws.send(payload); } catch (_) { /* client may have disconnected */ }
    }
  }
}