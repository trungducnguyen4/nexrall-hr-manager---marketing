export async function createEmployeePopup(env, {
  userId,
  requestType,
  requestId,
  decision,
  title,
  message,
  details = {},
  actorId = null,
  actorName = '',
  broadcastAppEvent = null,
}) {
  try {
    const detailsJson = typeof details === 'object' ? JSON.stringify(details) : String(details || '{}');
    const r = await env.DB.prepare(`
      INSERT INTO employee_popups (
        user_id, request_type, request_id, decision, title, message, details_json, actor_id, actor_name, is_dismissed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now','localtime'))
    `).bind(userId, requestType, requestId, decision, title, message, detailsJson, actorId, actorName).run();

    const popupId = r?.meta?.last_row_id;

    try {
      await env.DB.prepare(`
        INSERT INTO notifications (user_id, title, content, type, link) VALUES (?, ?, ?, ?, ?)
      `).bind(
        userId,
        title,
        message,
        requestType === 'leave' ? 'leave' : 'attendance',
        requestType === 'leave' ? '/leave' : '/attendance'
      ).run();
    } catch (_) {}

    if (typeof broadcastAppEvent === 'function') {
      await broadcastAppEvent(env, 'notifications', 'popup:new', {
        popup_id: popupId,
        user_id: userId,
        request_type: requestType,
        request_id: requestId,
        decision,
        title,
        message,
        details,
        actor_id: actorId,
        actor_name: actorName,
      }, { actorId, targetUserIds: [userId] });
    }

    return popupId;
  } catch (err) {
    console.error('Failed to create employee popup:', err);
    return null;
  }
}

export const PopupsService = {
  async getPending(env, userId) {
    const { results = [] } = await env.DB.prepare(`
      SELECT * FROM employee_popups
      WHERE user_id = ? AND is_dismissed = 0
      ORDER BY id ASC
    `).bind(userId).all();
    return results;
  },

  async dismiss(env, popupId, userId) {
    await env.DB.prepare(`
      UPDATE employee_popups
      SET is_dismissed = 1, dismissed_at = datetime('now','localtime')
      WHERE id = ? AND user_id = ?
    `).bind(popupId, userId).run();
    return { ok: true };
  }
};
