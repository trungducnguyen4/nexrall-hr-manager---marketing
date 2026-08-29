// ═════════════════════════════════════════════════════════════════════
//  RealtimeClient — Persistent Real-Time Transport Engine
//  Features:
//  - WebSocket primary transport with automatic SSE fallback
//  - Monotonic sequence tracking (`lastSeq`) & missed-event replay
//  - 30s application-level ping/pong heartbeat for dead socket detection
//  - Browser tab visibilitychange / focus wake-up revalidation
//  - Direct piping of events into EventBus
// ═════════════════════════════════════════════════════════════════════

import { EventBus } from './event-bus.js';

const DEFAULT_TOPICS = ['tasks', 'chat', 'notifications', 'attendance', 'leave', 'payroll', 'users'];
const PING_INTERVAL = 30_000;
const PING_TIMEOUT = 10_000;
const INITIAL_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;
const NATIVE_API_ORIGIN = 'https://nexrall-hr-manager-marketing.netviettv-hr-manager.workers.dev';

export class RealtimeClient {
  constructor(options = {}) {
    this.options = {
      pingInterval: PING_INTERVAL,
      pingTimeout: PING_TIMEOUT,
      initialBackoff: INITIAL_BACKOFF,
      maxBackoff: MAX_BACKOFF,
      fallbackToSse: true,
      ...options,
    };

    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    this.transport = 'none';       // 'none' | 'ws' | 'sse'
    this.user = null;
    this.token = null;
    this.topics = new Set(DEFAULT_TOPICS);
    this._lastSeq = 0;

    this.ws = null;
    this.sse = null;
    this.heartbeatTimer = null;
    this.pingTimeoutTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.lastActivityTime = 0;
    this.isIntentionalDisconnect = false;
    this._visibilityBound = false;
    this._wsFailedCount = 0;

    this._onVisibilityOrFocus = this._onVisibilityOrFocus.bind(this);
  }

  get lastSeq() {
    return this._lastSeq;
  }

  set lastSeq(seq) {
    this._lastSeq = Math.max(0, Number(seq) || 0);
  }

  setLastSeq(seq) {
    this.lastSeq = seq;
  }

  isConnected() {
    return this.status === 'connected';
  }

  /**
   * Connect real-time transport with user credentials.
   * @param {Object} params
   * @param {Object} params.user - Current user object
   * @param {string} params.token - Auth session token
   * @param {string[]} [params.topics] - Topics to subscribe to
   * @param {string} [params.url] - Optional override endpoint
   */
  async connect(params = {}) {
    if (params.user) this.user = params.user;
    if (params.token) this.token = params.token;
    if (Array.isArray(params.topics)) {
      params.topics.forEach(t => this.topics.add(t));
    }

    if (!this.token) {
      console.warn('[RealtimeClient] Cannot connect: missing auth token');
      return;
    }

    this.isIntentionalDisconnect = false;
    this._bindVisibilityListeners();

    // If currently connected or reconnecting, reset cleanly
    this._cleanupTimers();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    if (this.sse) {
      try { this.sse.close(); } catch (_) {}
      this.sse = null;
    }

    // Try WebSocket if supported and hasn't failed repeatedly
    const wsAvailable = typeof WebSocket !== 'undefined';
    if (wsAvailable && this._wsFailedCount < 3) {
      this._connectWs(params.url);
    } else if (this.options.fallbackToSse && typeof EventSource !== 'undefined') {
      this._connectSse(params.url);
    } else if (wsAvailable) {
      this._connectWs(params.url);
    } else {
      console.warn('[RealtimeClient] Neither WebSocket nor EventSource is available in this environment');
    }
  }

  /**
   * Build WebSocket connection URL based on environment.
   */
  _buildWsUrl(overrideUrl) {
    if (overrideUrl) return overrideUrl;
    const isNative = typeof globalThis !== 'undefined' && !!globalThis.Capacitor?.isNativePlatform?.();
    const baseOrigin = isNative ? NATIVE_API_ORIGIN : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const wsOrigin = baseOrigin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    return `${wsOrigin}/api/realtime/ws`;
  }

  /**
   * Build SSE connection URL based on environment.
   */
  _buildSseUrl(overrideUrl) {
    if (overrideUrl) return overrideUrl;
    const isNative = typeof globalThis !== 'undefined' && !!globalThis.Capacitor?.isNativePlatform?.();
    const baseOrigin = isNative ? NATIVE_API_ORIGIN : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const topicsStr = Array.from(this.topics).join(',');
    const q = new URLSearchParams({
      token: this.token || '',
      lastEventSeq: String(this._lastSeq || 0),
      topics: topicsStr,
    }).toString();
    return `${baseOrigin}/api/realtime/events?${q}`;
  }

  /**
   * Connect via WebSocket.
   */
  _connectWs(overrideUrl) {
    this.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    this.transport = 'ws';

    try {
      const url = this._buildWsUrl(overrideUrl);
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.lastActivityTime = Date.now();
        // Send initial auth message
        const authMsg = {
          type: 'auth',
          token: this.token,
          topics: Array.from(this.topics),
          lastEventSeq: this._lastSeq > 0 ? this._lastSeq : undefined,
        };
        this._safeSendWs(authMsg);
        this._startHeartbeat();
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastActivityTime = Date.now();
        this._handleWsMessage(event.data);
      };

      ws.onerror = (err) => {
        if (this.ws !== ws) return;
        console.warn('[RealtimeClient] WebSocket error:', err?.message || err);
      };

      ws.onclose = (event) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this._cleanupTimers();

        if (this.isIntentionalDisconnect) {
          this.status = 'disconnected';
          this.transport = 'none';
          EventBus.emit('realtime:disconnected', { intentional: true });
          return;
        }

        // Check if auth failed permanently
        if (event.code === 4001 || event.code === 4003) {
          this.status = 'disconnected';
          this.transport = 'none';
          EventBus.emit('realtime:auth_error', { code: event.code, reason: event.reason });
          return;
        }

        this._wsFailedCount++;
        // If WebSocket failed consecutively and SSE is supported, try SSE fallback
        if (this._wsFailedCount >= 2 && this.options.fallbackToSse && typeof EventSource !== 'undefined') {
          console.info('[RealtimeClient] Falling back from WebSocket to SSE transport');
          this._connectSse(overrideUrl);
          return;
        }

        this._scheduleReconnect(overrideUrl);
      };
    } catch (err) {
      console.warn('[RealtimeClient] Failed to initialize WebSocket:', err);
      this._wsFailedCount++;
      if (this.options.fallbackToSse && typeof EventSource !== 'undefined') {
        this._connectSse(overrideUrl);
      } else {
        this._scheduleReconnect(overrideUrl);
      }
    }
  }

  /**
   * Connect via Server-Sent Events (SSE) fallback.
   */
  _connectSse(overrideUrl) {
    this.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    this.transport = 'sse';

    try {
      const url = this._buildSseUrl(overrideUrl);
      const sse = new EventSource(url);
      this.sse = sse;

      sse.onopen = () => {
        if (this.sse !== sse) return;
        this.status = 'connected';
        this.reconnectAttempts = 0;
        this.lastActivityTime = Date.now();
        EventBus.emit('realtime:connected', { transport: 'sse', user: this.user, lastSeq: this._lastSeq });
        this._startHeartbeat();
      };

      sse.onmessage = (event) => {
        if (this.sse !== sse) return;
        this.lastActivityTime = Date.now();
        try {
          const data = JSON.parse(event.data);
          this._handleSseMessage(data);
        } catch (err) {
          console.warn('[RealtimeClient] SSE JSON parse error:', err);
        }
      };

      sse.onerror = (err) => {
        if (this.sse !== sse) return;
        console.warn('[RealtimeClient] SSE error / disconnection:', err);
        try { sse.close(); } catch (_) {}
        this.sse = null;
        this._cleanupTimers();

        if (this.isIntentionalDisconnect) {
          this.status = 'disconnected';
          this.transport = 'none';
          EventBus.emit('realtime:disconnected', { intentional: true });
          return;
        }

        this._scheduleReconnect(overrideUrl);
      };
    } catch (err) {
      console.warn('[RealtimeClient] Failed to initialize SSE:', err);
      this._scheduleReconnect(overrideUrl);
    }
  }

  /**
   * Handle incoming WebSocket message.
   */
  _handleWsMessage(rawData) {
    let msg;
    try {
      msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (err) {
      console.warn('[RealtimeClient] Invalid JSON over WebSocket:', err);
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    // Handle protocol frames
    switch (msg.type) {
      case 'auth:ok':
        this.status = 'connected';
        this.reconnectAttempts = 0;
        this._wsFailedCount = 0;
        if (this._lastSeq === 0 && typeof msg.currentSeq === 'number') {
          this._lastSeq = msg.currentSeq;
        }
        EventBus.emit('realtime:connected', { transport: 'ws', user: this.user, currentSeq: msg.currentSeq });
        return;

      case 'auth:error':
        this.status = 'disconnected';
        this.isIntentionalDisconnect = true;
        EventBus.emit('realtime:auth_error', msg);
        try { this.ws?.close(); } catch (_) {}
        return;

      case 'pong':
        this.lastActivityTime = Date.now();
        if (this.pingTimeoutTimer) {
          clearTimeout(this.pingTimeoutTimer);
          this.pingTimeoutTimer = null;
        }
        return;

      case 'subscribe:ok':
      case 'unsubscribe:ok':
        return;

      case 'replay:batch':
        if (Array.isArray(msg.events)) {
          for (const evt of msg.events) {
            this._dispatchServerEvent(evt);
          }
        }
        if (typeof msg.currentSeq === 'number') {
          this._lastSeq = Math.max(this._lastSeq, msg.currentSeq);
        }
        EventBus.emit('realtime:replayed', { count: msg.replayedCount || 0, currentSeq: this._lastSeq });
        return;

      case 'replay:overflow':
        if (typeof msg.currentSeq === 'number') {
          this._lastSeq = msg.currentSeq;
        }
        EventBus.emit('realtime:overflow', msg);
        EventBus.emit('hr-data-mutated', { overflow: true, ...msg });
        return;

      case 'replay:complete':
        if (typeof msg.currentSeq === 'number') {
          this._lastSeq = Math.max(this._lastSeq, msg.currentSeq);
        }
        return;

      default:
        // Regular domain event envelope
        this._dispatchServerEvent(msg);
        break;
    }
  }

  /**
   * Handle incoming SSE message.
   */
  _handleSseMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'connected') {
      if (this._lastSeq === 0 && typeof msg.seq === 'number') {
        this._lastSeq = msg.seq;
      }
      return;
    }

    if (msg.type === 'replay:overflow') {
      if (typeof msg.currentSeq === 'number') {
        this._lastSeq = msg.currentSeq;
      }
      EventBus.emit('realtime:overflow', msg);
      EventBus.emit('hr-data-mutated', { overflow: true, ...msg });
      return;
    }

    if (msg.type === 'replay:complete') {
      if (typeof msg.currentSeq === 'number') {
        this._lastSeq = Math.max(this._lastSeq, msg.currentSeq);
      }
      return;
    }

    // Domain event
    this._dispatchServerEvent(msg);
  }

  /**
   * Dispatch domain event to EventBus and update sequence.
   */
  _dispatchServerEvent(event) {
    if (!event || typeof event !== 'object') return;

    if (typeof event.seq === 'number') {
      if (this._lastSeq && event.seq <= this._lastSeq && event.type !== 'realtime:replayed') {
        // Drop duplicate sequence delivery
        return;
      }
      this._lastSeq = Math.max(this._lastSeq, event.seq);
    }

    // Single unified dispatch to EventBus (EventBus automatically notifies wildcard and base prefix listeners)
    const eventName = event.event || event.topic || 'realtime:event';
    EventBus.emit(eventName, event);

    // Also emit generic real-time envelope
    EventBus.emit('realtime:event', event);
  }

  /**
   * Safe send over WebSocket.
   */
  _safeSendWs(data) {
    if (this.ws && this.ws.readyState === 1 /* WebSocket.OPEN */) {
      try {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        this.ws.send(payload);
        return true;
      } catch (err) {
        console.warn('[RealtimeClient] WS send error:', err);
      }
    }
    return false;
  }

  /**
   * Subscribe to one or more topics.
   * @param {string|string[]} topicOrTopics
   */
  subscribe(topicOrTopics) {
    const list = Array.isArray(topicOrTopics) ? topicOrTopics : [topicOrTopics];
    const newTopics = [];
    for (const t of list) {
      if (typeof t === 'string' && t.trim()) {
        const clean = t.trim();
        if (!this.topics.has(clean)) {
          this.topics.add(clean);
          newTopics.push(clean);
        }
      }
    }

    if (newTopics.length === 0) return;

    if (this.transport === 'ws' && this.isConnected()) {
      this._safeSendWs({ type: 'subscribe', topics: newTopics });
    } else if (this.transport === 'sse' && this.isConnected()) {
      // Reconnect SSE with updated topics query
      this.connect({ user: this.user, token: this.token });
    }
  }

  /**
   * Unsubscribe from one or more topics.
   * @param {string|string[]} topicOrTopics
   */
  unsubscribe(topicOrTopics) {
    const list = Array.isArray(topicOrTopics) ? topicOrTopics : [topicOrTopics];
    const removedTopics = [];
    for (const t of list) {
      if (typeof t === 'string') {
        const clean = t.trim();
        if (this.topics.has(clean)) {
          this.topics.delete(clean);
          removedTopics.push(clean);
        }
      }
    }

    if (removedTopics.length === 0) return;

    if (this.transport === 'ws' && this.isConnected()) {
      this._safeSendWs({ type: 'unsubscribe', topics: removedTopics });
    } else if (this.transport === 'sse' && this.isConnected()) {
      this.connect({ user: this.user, token: this.token });
    }
  }

  /**
   * Request replay of missed events from a specific sequence number.
   * @param {number} [fromSeq]
   */
  requestReplay(fromSeq) {
    const seq = fromSeq !== undefined ? Number(fromSeq) : this._lastSeq;
    if (this.transport === 'ws' && this.isConnected()) {
      this._safeSendWs({ type: 'replay', lastEventSeq: seq });
    }
  }

  /**
   * Application-level ping/pong heartbeat.
   */
  _startHeartbeat() {
    this._cleanupTimers();
    this.heartbeatTimer = setInterval(() => {
      if (this.transport === 'ws' && this.ws && this.ws.readyState === 1) {
        // Send ping
        this._safeSendWs({ type: 'ping', t: Date.now() });

        // Set ping timeout
        if (this.pingTimeoutTimer) clearTimeout(this.pingTimeoutTimer);
        this.pingTimeoutTimer = setTimeout(() => {
          console.warn('[RealtimeClient] Ping timeout — dead socket detected. Reconnecting...');
          try { this.ws?.close(); } catch (_) {}
        }, this.options.pingTimeout);
      } else if (this.transport === 'sse' && this.sse) {
        // For SSE: verify connection liveness
        const elapsed = Date.now() - this.lastActivityTime;
        if (elapsed > this.options.pingInterval + this.options.pingTimeout) {
          console.warn('[RealtimeClient] SSE stream inactive. Reconnecting...');
          try { this.sse.close(); } catch (_) {}
          this._scheduleReconnect();
        }
      }
    }, this.options.pingInterval);
  }

  /**
   * Cleanup heartbeat and timeout timers.
   */
  _cleanupTimers() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pingTimeoutTimer) {
      clearTimeout(this.pingTimeoutTimer);
      this.pingTimeoutTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Exponential backoff reconnection.
   */
  _scheduleReconnect(overrideUrl) {
    this._cleanupTimers();
    if (this.isIntentionalDisconnect || !this.token) return;

    this.status = 'reconnecting';
    this.reconnectAttempts++;

    // Calculate jittered exponential backoff: min(initial * 2^(attempts-1), maxBackoff) + jitter
    const expDelay = Math.min(
      this.options.initialBackoff * Math.pow(2, Math.min(this.reconnectAttempts - 1, 6)),
      this.options.maxBackoff
    );
    const jitter = Math.floor(Math.random() * 500);
    const delay = expDelay + jitter;

    EventBus.emit('realtime:reconnecting', {
      attempt: this.reconnectAttempts,
      delay,
      lastSeq: this._lastSeq,
    });

    this.reconnectTimer = setTimeout(() => {
      if (this.isIntentionalDisconnect || !this.token) return;
      this.connect({ user: this.user, token: this.token, url: overrideUrl });
    }, delay);
  }

  /**
   * Tab visibility change and window focus wake-up listener.
   */
  _bindVisibilityListeners() {
    if (this._visibilityBound) return;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityOrFocus);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this._onVisibilityOrFocus);
    }
    this._visibilityBound = true;
  }

  _onVisibilityOrFocus() {
    if (this.isIntentionalDisconnect || !this.token) return;
    const isVisible = typeof document !== 'undefined' ? !document.hidden : true;
    if (!isVisible) return;

    // Tab became visible / focused: check connection health
    const now = Date.now();
    const elapsed = now - (this.lastActivityTime || 0);

    if (this.status !== 'connected' || elapsed > this.options.pingInterval * 1.5) {
      console.info('[RealtimeClient] Wakeup detected on focus/visibility change — checking connection health');
      if (this.status !== 'connected') {
        this.connect({ user: this.user, token: this.token });
      } else if (this.transport === 'ws') {
        this._safeSendWs({ type: 'ping', t: now });
      }
    }
  }

  /**
   * Disconnect transport and cleanup resources.
   */
  disconnect() {
    this.isIntentionalDisconnect = true;
    this.status = 'disconnected';
    this.transport = 'none';
    this._cleanupTimers();

    if (this.ws) {
      try { this.ws.close(1000, 'Client disconnected'); } catch (_) {}
      this.ws = null;
    }
    if (this.sse) {
      try { this.sse.close(); } catch (_) {}
      this.sse = null;
    }

    this.reconnectAttempts = 0;
    this._wsFailedCount = 0;

    EventBus.emit('realtime:disconnected', { intentional: true });
  }
}

export const realtime = new RealtimeClient();
export const Realtime = realtime;
export default realtime;
