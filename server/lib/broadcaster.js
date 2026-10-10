/**
 * Universal Real-Time Event Broadcaster
 * Dispatches standardized event envelopes to the AppSyncHub Durable Object.
 * Non-blocking & fault-tolerant: broadcast errors never fail the primary D1 transaction.
 *
 * @param {object} env - Cloudflare Worker environment bindings
 * @param {string|object} topicOrEvent - Domain topic ('tasks', 'chat', 'notifications', 'attendance', 'leave', 'payroll', 'invoices', 'users') or full event object
 * @param {string|object} [eventOrPayload] - Event name or payload
 * @param {object} [payloadObj] - Domain data payload
 * @param {object} [options] - Optional envelope overrides
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function broadcastAppEvent(env, topicOrEvent, eventOrPayload = {}, payloadObj = {}, options = {}) {
  const syncHubBinding = env?.SYNC_HUB || env?.APP_SYNC_HUB;
  if (!syncHubBinding) {
    return { ok: false, error: 'SYNC_HUB binding not available' };
  }

  let envelope;
  if (typeof topicOrEvent === 'object' && topicOrEvent !== null) {
    envelope = {
      id: topicOrEvent.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      seq: topicOrEvent.seq || 0,
      topic: String(topicOrEvent.topic || 'system'),
      event: String(topicOrEvent.event || topicOrEvent.topic || 'update'),
      payload: topicOrEvent.payload !== undefined ? topicOrEvent.payload : {},
      actorId: topicOrEvent.actorId !== undefined && topicOrEvent.actorId !== null ? Number(topicOrEvent.actorId) : null,
      ...(Array.isArray(topicOrEvent.targetUserIds) && topicOrEvent.targetUserIds.length ? {
        targetUserIds: topicOrEvent.targetUserIds.map(Number).filter(id => Number.isInteger(id) && id > 0)
      } : {}),
      timestamp: topicOrEvent.timestamp || new Date().toISOString(),
    };
  } else {
    const topic = String(topicOrEvent);
    let eventName, payload, opts;
    if (typeof eventOrPayload === 'string') {
      eventName = eventOrPayload;
      payload = payloadObj || {};
      opts = options || {};
    } else {
      eventName = options?.event || topic;
      payload = eventOrPayload || {};
      opts = payloadObj || {};
    }

    const eventId = opts.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const timestamp = opts.timestamp || new Date().toISOString();
    const actorId = opts.actorId !== undefined && opts.actorId !== null ? Number(opts.actorId) : (opts.actor_id !== undefined && opts.actor_id !== null ? Number(opts.actor_id) : null);
    const targetUserIds = Array.isArray(opts.targetUserIds || opts.target_user_ids)
      ? (opts.targetUserIds || opts.target_user_ids).map(Number).filter(id => Number.isInteger(id) && id > 0)
      : undefined;

    envelope = {
      id: eventId,
      seq: opts.seq || 0,
      topic,
      event: String(eventName),
      payload,
      actorId,
      actor_id: actorId,
      ...(targetUserIds && targetUserIds.length ? { targetUserIds, target_user_ids: targetUserIds } : {}),
      timestamp,
    };
  }

  try {
    const hubId = syncHubBinding.idFromName('global');
    const hubStub = syncHubBinding.get(hubId);

    if (typeof hubStub.broadcast === 'function') {
      return await hubStub.broadcast(envelope);
    }

    const response = await hubStub.fetch('https://sync-hub.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      console.warn(`[broadcastAppEvent] AppSyncHub returned HTTP ${response.status} for ${envelope.topic}:${envelope.event}`);
      return { ok: false, status: response.status };
    }
    return await response.json().catch(() => ({ ok: true, id: envelope.id }));
  } catch (error) {
    console.warn(`[broadcastAppEvent] Broadcast failed for ${envelope?.topic}:${envelope?.event}:`, error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}
