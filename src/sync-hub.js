// ── AppSyncHub Durable Object ─────────────────────────────────────────
// Global real-time event hub for multi-tenant state synchronization.
// Features:
// - Cloudflare DO Hibernation WebSocket support
// - Session serialization and connection tracking by user/topic
// - 30s heartbeat & ping/pong liveness checks
// - Monotonic sliding replay buffer (100 events) for instant reconnection
// - Internal RPC & HTTP POST /broadcast endpoint for Worker mutations
// - Fallback SSE stream support (/api/realtime/events)
// - Stats endpoint (/api/realtime/stats)
// =====================================================================

export class AppSyncHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    this.sessions = new Map(); // ws -> session
    this.sseClients = new Map(); // clientId -> { clientId, writer, session, keepAliveTimer }
    this.nextSseClientId = 1;

    this.seq = 0;
    this.replayBuffer = [];
    this.maxBufferSize = 100;

    if (this.ctx?.blockConcurrencyWhile) {
      this.initPromise = this.ctx.blockConcurrencyWhile(async () => {
        await this.initStorage();
        this.restoreSessions();
      });
    } else {
      this.initPromise = (async () => {
        await this.initStorage();
        this.restoreSessions();
      })();
    }
  }

  // ── Storage Initialization ──────────────────────────────────────────
  async initStorage() {
    try {
      if (this.ctx?.storage) {
        let stored = await this.ctx.storage.get(['seq', 'replayBuffer', 'buffer']);
        if (!stored || (typeof stored.get !== 'function' && !stored.seq && !stored.replayBuffer)) {
          // Fallback to individual gets if multi-key get returns empty/unsupported
          const seqVal = await this.ctx.storage.get('seq');
          const bufferVal = await this.ctx.storage.get('replayBuffer') || await this.ctx.storage.get('buffer');
          if (seqVal !== undefined) this.seq = Number(seqVal) || 0;
          if (bufferVal) this.replayBuffer = Array.isArray(bufferVal) ? bufferVal : [];
          return;
        }
        if (stored) {
          if (typeof stored.get === 'function') {
            this.seq = Number(stored.get('seq')) || 0;
            this.replayBuffer = stored.get('replayBuffer') || stored.get('buffer') || [];
          } else {
            this.seq = Number(stored.seq) || 0;
            this.replayBuffer = stored.replayBuffer || stored.buffer || [];
          }
        }
      }
    } catch (err) {
      console.warn('AppSyncHub initStorage error:', err?.message || err);
    }
  }

  // ── Restore sessions after hibernation ──────────────────────────────
  restoreSessions() {
    if (!this.ctx?.getWebSockets) return;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const session = ws.deserializeAttachment ? ws.deserializeAttachment() : null;
        if (session && session.userId) {
          this.sessions.set(ws, session);
        }
      } catch (_) {
        // Socket might not have attachment yet
      }
    }
  }

  // ── HTTP Fetch Handler ──────────────────────────────────────────────
  async fetch(request) {
    const url = new URL(request.url);

    // 1. Internal broadcast endpoint (invoked by Worker server.js)
    if (request.method === 'POST' && (url.pathname === '/broadcast' || url.pathname === '/api/realtime/broadcast')) {
      try {
        const payload = await request.json().catch(() => ({}));
        const res = await this.broadcast(payload);
        return new Response(JSON.stringify(res), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err?.message || String(err) }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. Health & Statistics endpoint
    if (url.pathname === '/stats' || url.pathname === '/api/realtime/stats') {
      const activeTopics = new Set();
      const liveWs = this.ctx?.getWebSockets ? Array.from(this.ctx.getWebSockets()) : [];
      const liveCount = liveWs.length || this.sessions.size;
      for (const s of this.sessions.values()) {
        if (Array.isArray(s.topics)) s.topics.forEach(t => activeTopics.add(t));
      }
      return new Response(JSON.stringify({
        ok: true,
        seq: this.seq,
        buffer_size: this.replayBuffer.length,
        bufferSize: this.replayBuffer.length,
        active_connections: liveCount,
        activeWs: liveCount,
        active_sse: this.sseClients.size,
        activeSse: this.sseClients.size,
        totalConnections: liveCount + this.sseClients.size,
        topics_active: Array.from(activeTopics),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Fallback SSE stream (/api/realtime/events)
    if (url.pathname === '/events' || url.pathname === '/api/realtime/events') {
      return await this.handleSse(request);
    }

    // 4. WebSocket Upgrade (/api/realtime/ws)
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      if (typeof WebSocketPair === 'undefined') {
        return new Response(JSON.stringify({ error: 'WebSocketPair not supported in this environment' }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Extract token + topics from query string for immediate auth
      const token = url.searchParams.get('token') || url.searchParams.get('t');
      const topicsParam = url.searchParams.get('topics') || url.searchParams.get('topic') || '';
      const topics = topicsParam ? topicsParam.split(',').map(s => s.trim()).filter(Boolean) : [];

      const [client, server] = Object.values(new WebSocketPair());
      if (this.ctx?.acceptWebSocket) {
        this.ctx.acceptWebSocket(server);
      }

      // Auto-authenticate from query string token immediately after accept
      if (token) {
        // Schedule auth in microtask so DO is fully set up
        Promise.resolve().then(() =>
          this.handleAuth(server, { token, topics: topics.length ? topics : undefined })
        ).catch(err => console.warn('AppSyncHub auto-auth error:', err?.message || err));
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found or upgrade required' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── WebSocket Lifecycle (Cloudflare Hibernation API) ────────────────
  async webSocketMessage(ws, raw) {
    try {
      const msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));

      if (msg.type === 'auth') {
        await this.handleAuth(ws, msg);
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t, serverTime: Date.now() }));
        const session = this.sessions.get(ws);
        if (session) {
          session.lastPingAt = Date.now();
          if (ws.serializeAttachment) {
            ws.serializeAttachment(session);
          }
        }
        return;
      }

      const session = this.sessions.get(ws);
      if (!session) {
        ws.send(JSON.stringify({ type: 'auth:error', message: 'WebSocket chưa được xác thực', code: 'UNAUTHORIZED' }));
        return;
      }

      switch (msg.type) {
        case 'subscribe':
          this.handleSubscribe(ws, session, msg);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(ws, session, msg);
          break;
        case 'replay':
          this.handleReplay(ws, session, msg.lastEventSeq !== undefined ? msg.lastEventSeq : (msg.fromSeq || 0));
          break;
        default:
          // Ignore unhandled client messages
          break;
      }
    } catch (error) {
      console.error('AppSyncHub WS message error:', error?.message || error);
    }
  }

  async webSocketClose(ws, code, reason) {
    this.sessions.delete(ws);
  }

  async webSocketError(ws, error) {
    this.sessions.delete(ws);
    console.error('AppSyncHub WS error:', error?.message || error);
  }

  // ── WebSocket Handlers ──────────────────────────────────────────────
  async handleAuth(ws, msg) {
    if (!msg.token) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Token missing', code: 'UNAUTHORIZED' }));
      try { ws.close(4001, 'Unauthorized'); } catch (_) {}
      return;
    }

    let user = null;
    try {
      if (this.env?.DB) {
        user = await this.env.DB.prepare(
          `SELECT u.id, u.full_name, u.role, u.department, u.employee_code, u.is_active
           FROM users u JOIN sessions s ON s.user_id = u.id
           WHERE s.token = ? AND s.revoked = 0 AND CAST(s.expires_at AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)`
        ).bind(msg.token).first();
      }
    } catch (err) {
      console.warn('AppSyncHub auth db error:', err?.message || err);
    }

    if (!user || user.is_active === 0 || user.is_active === false) {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid or expired token', code: 'UNAUTHORIZED' }));
      try { ws.close(4001, 'Unauthorized'); } catch (_) {}
      return;
    }

    const session = {
      userId: Number(user.id),
      userName: user.full_name || 'User',
      userRole: user.role || 'employee',
      department: user.department || '',
      employeeCode: user.employee_code || '',
      topics: Array.isArray(msg.topics) && msg.topics.length > 0 ? msg.topics : ['*'],
      connectedAt: new Date().toISOString(),
      lastPingAt: Date.now(),
    };

    if (ws.serializeAttachment) {
      ws.serializeAttachment(session);
    }
    this.sessions.set(ws, session);

    ws.send(JSON.stringify({
      type: 'auth:ok',
      userId: session.userId,
      userName: session.userName,
      currentSeq: this.seq,
    }));

    if (msg.lastEventSeq !== undefined && msg.lastEventSeq !== null) {
      this.handleReplay(ws, session, Number(msg.lastEventSeq));
    }
  }

  handleSubscribe(ws, session, msg) {
    if (!Array.isArray(msg.topics)) return;
    const current = new Set(session.topics || []);
    for (const t of msg.topics) {
      if (typeof t === 'string' && t.trim()) current.add(t.trim());
    }
    session.topics = Array.from(current);
    if (ws.serializeAttachment) {
      ws.serializeAttachment(session);
    }
    this.sessions.set(ws, session);
    ws.send(JSON.stringify({ type: 'subscribe:ok', topics: session.topics }));
  }

  handleUnsubscribe(ws, session, msg) {
    if (!Array.isArray(msg.topics)) return;
    const current = new Set(session.topics || []);
    for (const t of msg.topics) {
      if (typeof t === 'string') current.delete(t.trim());
    }
    session.topics = Array.from(current);
    if (ws.serializeAttachment) {
      ws.serializeAttachment(session);
    }
    this.sessions.set(ws, session);
    ws.send(JSON.stringify({ type: 'unsubscribe:ok', topics: session.topics }));
  }

  handleReplay(ws, session, lastEventSeq) {
    const clientSeq = Number(lastEventSeq || 0);
    if (clientSeq >= this.seq || this.replayBuffer.length === 0) {
      ws.send(JSON.stringify({ type: 'replay:complete', replayedCount: 0, currentSeq: this.seq }));
      return;
    }

    const oldestSeq = this.replayBuffer[0].seq;
    if (clientSeq < oldestSeq - 1) {
      ws.send(JSON.stringify({
        type: 'replay:overflow',
        message: 'Replay buffer overflow — missed events exceed buffer limit.',
        oldestAvailableSeq: oldestSeq,
        currentSeq: this.seq,
      }));
      return;
    }

    const missed = this.replayBuffer.filter(e => e.seq > clientSeq && this.isEventVisibleToSession(e, session));
    ws.send(JSON.stringify({
      type: 'replay:batch',
      events: missed,
      replayedCount: missed.length,
      currentSeq: this.seq,
    }));
  }

  // ── Universal Broadcast Method (RPC & Internal HTTP) ────────────────
  async broadcast(eventInput) {
    this.seq++;
    const now = new Date().toISOString();
    const rawTarget = eventInput.targetUserIds || eventInput.target_user_ids;
    const rawActor = eventInput.actorId !== undefined && eventInput.actorId !== null ? eventInput.actorId : eventInput.actor_id;
    const event = {
      id: eventInput.id || `evt_${Date.now()}_${this.seq}_${Math.random().toString(36).slice(2, 8)}`,
      seq: this.seq,
      topic: String(eventInput.topic || 'system'),
      event: String(eventInput.event || eventInput.topic || 'update'),
      payload: eventInput.payload !== undefined ? eventInput.payload : {},
      actor_id: rawActor !== undefined && rawActor !== null ? Number(rawActor) : null,
      actorId: rawActor !== undefined && rawActor !== null ? Number(rawActor) : null,
      targetUserIds: Array.isArray(rawTarget) && rawTarget.length > 0
        ? rawTarget.map(Number).filter(id => Number.isInteger(id) && id > 0)
        : undefined,
      timestamp: eventInput.timestamp || now,
    };

    // Push to sliding replay buffer (max 100 items)
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > this.maxBufferSize) {
      this.replayBuffer.splice(0, this.replayBuffer.length - this.maxBufferSize);
    }

    // Persist storage asynchronously
    if (this.ctx?.storage) {
      this.ctx.storage.put({ seq: this.seq, replayBuffer: this.replayBuffer }).catch(() => {});
    }

    const payloadString = JSON.stringify(event);

    // 1. Dispatch to WebSockets
    // ALWAYS use ctx.getWebSockets() as source of truth — it survives DO hibernation.
    // sessions map may be empty after wakeup; getWebSockets() is the authoritative list.
    const liveWebSockets = this.ctx?.getWebSockets ? Array.from(this.ctx.getWebSockets()) : [];
    if (liveWebSockets.length > 0) {
      for (const ws of liveWebSockets) {
        // Try to get session from map first, then from deserialized attachment
        let session = this.sessions.get(ws);
        if (!session && ws.deserializeAttachment) {
          try { session = ws.deserializeAttachment(); } catch (_) {}
          if (session) this.sessions.set(ws, session);
        }
        // If session exists, apply visibility filter; if no session, still send (client handles filtering)
        if (!session || this.isEventVisibleToSession(event, session)) {
          try { ws.send(payloadString); } catch (_) { this.sessions.delete(ws); }
        }
      }
    } else {
      // Fallback: use in-memory sessions map (non-hibernation environments)
      for (const [ws, session] of this.sessions) {
        if (this.isEventVisibleToSession(event, session)) {
          try { ws.send(payloadString); } catch (_) { this.sessions.delete(ws); }
        }
      }
    }

    // 2. Dispatch to SSE clients
    const sseChunk = new TextEncoder().encode(`id: ${event.seq}\nevent: message\ndata: ${payloadString}\n\n`);
    for (const [clientId, sseClient] of this.sseClients) {
      if (this.isEventVisibleToSession(event, sseClient.session)) {
        try {
          sseClient.writer.write(sseChunk).catch(() => {
            this.cleanupSseClient(clientId);
          });
        } catch (_) {
          this.cleanupSseClient(clientId);
        }
      }
    }

    return { ok: true, id: event.id, seq: event.seq };
  }

  // ── Event Visibility Check ──────────────────────────────────────────
  isEventVisibleToSession(event, session) {
    if (!session) return false;

    // Target users restriction
    if (Array.isArray(event.targetUserIds) && event.targetUserIds.length > 0) {
      const uid = Number(session.userId);
      if (!event.targetUserIds.includes(uid)) {
        return false;
      }
    }

    // Topic subscription filter
    const topics = Array.isArray(session.topics) ? session.topics : ['*'];
    if (!topics.includes('*') && !topics.includes('all') && !topics.includes(event.topic)) {
      return false;
    }

    return true;
  }

  // ── SSE Fallback Handler ────────────────────────────────────────────
  async handleSse(request, mockUser = null) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const lastEventSeq = parseInt(url.searchParams.get('lastEventSeq') || request.headers.get('Last-Event-ID') || '0', 10);
    const rawTopics = url.searchParams.get('topics');
    const topics = rawTopics ? rawTopics.split(',').map(s => s.trim()).filter(Boolean) : ['*'];

    let user = mockUser;
    if (!user) {
      if (!token) {
        return new Response(JSON.stringify({ error: 'Token missing', code: 'UNAUTHORIZED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        if (this.env?.DB) {
          user = await this.env.DB.prepare(
            `SELECT u.id, u.full_name, u.role, u.department, u.employee_code, u.is_active
             FROM users u JOIN sessions s ON s.user_id = u.id
             WHERE s.token = ? AND s.revoked = 0 AND CAST(s.expires_at AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)`
          ).bind(token).first();
        }
      } catch (_) {}

      if (!user || user.is_active === 0 || user.is_active === false) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const session = {
      userId: Number(user.id),
      userName: user.full_name || 'User',
      userRole: user.role || 'employee',
      department: user.department || '',
      employeeCode: user.employee_code || '',
      topics: topics.length > 0 ? topics : ['*'],
    };

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const clientId = this.nextSseClientId++;

    const keepAliveTimer = setInterval(() => {
      try {
        writer.write(encoder.encode(': keepalive\n\n')).catch(() => this.cleanupSseClient(clientId));
      } catch (_) {
        this.cleanupSseClient(clientId);
      }
    }, 25000);

    this.sseClients.set(clientId, { clientId, writer, session, keepAliveTimer });

    // Send initial connected frame
    writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'connected', seq: this.seq, userId: user.id, timestamp: new Date().toISOString() })}\n\n`)).catch(() => {});

    // Replay missed events if requested
    if (lastEventSeq > 0 && lastEventSeq < this.seq) {
      const oldestSeq = this.replayBuffer[0]?.seq || 0;
      if (lastEventSeq < oldestSeq - 1) {
        writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'replay:overflow', oldestAvailableSeq: oldestSeq, currentSeq: this.seq })}\n\n`)).catch(() => {});
      } else {
        const missed = this.replayBuffer.filter(e => e.seq > lastEventSeq && this.isEventVisibleToSession(e, session));
        for (const evt of missed) {
          writer.write(encoder.encode(`id: ${evt.seq}\nevent: message\ndata: ${JSON.stringify(evt)}\n\n`)).catch(() => {});
        }
        writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'replay:complete', replayedCount: missed.length, currentSeq: this.seq })}\n\n`)).catch(() => {});
      }
    }

    if (request.signal) {
      request.signal.addEventListener('abort', () => this.cleanupSseClient(clientId));
    }

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  async handleSSE(request, mockUser = null) {
    return this.handleSse(request, mockUser);
  }

  cleanupSseClient(clientId) {
    const client = this.sseClients.get(clientId);
    if (client) {
      if (client.keepAliveTimer) clearInterval(client.keepAliveTimer);
      try { client.writer.close(); } catch (_) {}
      this.sseClients.delete(clientId);
    }
  }
}
