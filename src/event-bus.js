// ═════════════════════════════════════════════════════════════════════
//  Reactive Event Bus — Central Frontend Pub/Sub & View Lifecycle
// ═════════════════════════════════════════════════════════════════════

export class EventBusClass {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to a topic or event pattern.
   * @param {string} topic - Event name or wildcard (e.g. 'tasks', 'task:created', 'tasks:*', '*')
   * @param {Function} handler - Callback function receiving event data
   * @returns {Function} Unsubscribe function
   */
  on(topic, handler) {
    if (!topic || typeof handler !== 'function') {
      return () => {};
    }
    const topicKey = String(topic).trim();
    if (!this._listeners.has(topicKey)) {
      this._listeners.set(topicKey, new Set());
    }
    this._listeners.get(topicKey).add(handler);
    return () => this.off(topicKey, handler);
  }

  /**
   * Unsubscribe a handler from a topic.
   * @param {string} topic - Event name or wildcard
   * @param {Function} handler - Callback function to remove
   */
  off(topic, handler) {
    if (!topic) return;
    const topicKey = String(topic).trim();
    const set = this._listeners.get(topicKey);
    if (set) {
      if (typeof handler === 'function') {
        set.delete(handler);
      }
      if (set.size === 0 || !handler) {
        this._listeners.delete(topicKey);
      }
    }
  }

  /**
   * Register a one-time event listener.
   * @param {string} topic
   * @param {Function} handler
   * @returns {Function} Unsubscribe function
   */
  once(topic, handler) {
    if (!topic || typeof handler !== 'function') {
      return () => {};
    }
    const topicKey = String(topic).trim();
    const wrapper = (...args) => {
      this.off(topicKey, wrapper);
      try {
        handler(...args);
      } catch (err) {
        console.error(`[EventBus] Error in once handler for "${topicKey}":`, err);
      }
    };
    return this.on(topicKey, wrapper);
  }

  /**
   * Emit an event to all matching subscribers.
   * Matches exact topic, prefix wildcards (e.g. 'tasks:*'), and global wildcard ('*').
   * @param {string} topic - Topic or event name being emitted
   * @param {*} data - Event payload / envelope
   * @returns {number} Number of handlers invoked
   */
  emit(topic, data) {
    if (!topic) return 0;
    const topicKey = String(topic).trim();
    const handlersToCall = new Set();

    // 1. Exact match handlers
    const exact = this._listeners.get(topicKey);
    if (exact) {
      exact.forEach(h => handlersToCall.add(h));
    }

    // 2. Wildcard prefix handlers (e.g. 'task:*' or 'tasks:*')
    const colonIdx = topicKey.indexOf(':');
    if (colonIdx > 0) {
      const prefix = topicKey.slice(0, colonIdx);
      const wildcardKey = `${prefix}:*`;
      const wildPrefix = this._listeners.get(wildcardKey);
      if (wildPrefix) {
        wildPrefix.forEach(h => handlersToCall.add(h));
      }
    }

    // 3. Global wildcard handlers ('*')
    const globalWildcard = this._listeners.get('*');
    if (globalWildcard) {
      globalWildcard.forEach(h => handlersToCall.add(h));
    }

    // Execute handlers safely
    let invoked = 0;
    for (const handler of handlersToCall) {
      try {
        handler(data, topicKey);
      } catch (err) {
        console.error(`[EventBus] Error in subscriber for "${topicKey}":`, err);
      }
      invoked++;
    }

    return invoked;
  }

  /**
   * Bind an event listener to a view container element.
   * When the view's lifecycle ends (`el._cleanup()` is invoked or element is detached),
   * the listener is automatically unregistered.
   * @param {HTMLElement|Object} viewElement - DOM node or view context
   * @param {string} topic - Event topic
   * @param {Function} handler - Event handler callback
   * @returns {Function} Manual unsubscribe function
   */
  bindView(viewElement, topic, handler) {
    const unsub = this.on(topic, handler);
    if (!viewElement || typeof viewElement !== 'object') {
      return unsub;
    }

    if (!Array.isArray(viewElement._eventBusUnsubs)) {
      viewElement._eventBusUnsubs = [];
    }
    viewElement._eventBusUnsubs.push(unsub);

    const prevCleanup = viewElement._cleanup;
    viewElement._cleanup = () => {
      unsub();
      if (typeof prevCleanup === 'function') {
        try {
          prevCleanup();
        } catch (err) {
          console.warn('[EventBus] Error in chained view cleanup:', err);
        }
      }
    };

    return unsub;
  }

  /**
   * Clear all registered listeners.
   */
  clear() {
    this._listeners.clear();
  }

  /**
   * Return number of active listeners for a topic (or total if omitted).
   * @param {string} [topic]
   * @returns {number}
   */
  listenerCount(topic) {
    if (topic) {
      return this._listeners.get(String(topic).trim())?.size || 0;
    }
    let total = 0;
    for (const set of this._listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

export const EventBus = new EventBusClass();
export const eventBus = EventBus;
export default EventBus;
