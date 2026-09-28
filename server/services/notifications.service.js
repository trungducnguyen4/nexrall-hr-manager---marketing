/**
 * Notifications Service
 * Xử lý truy vấn CSDL và nghiệp vụ thông báo (Push Notification, Task Mentions, Alerts)
 */

export const NotificationsService = {
  async subscribePush(env, userId, { endpoint, p256dh, auth, user_agent }, ensurePushSchemaFn) {
    if (typeof ensurePushSchemaFn === 'function') {
      await ensurePushSchemaFn(env);
    }
    const ep = String(endpoint || '').trim();
    const pKey = String(p256dh || '').trim();
    const aKey = String(auth || '').trim();
    const ua = String(user_agent || '').slice(0, 500);

    if (!ep || !pKey || !aKey) {
      return { error: 'Thông tin Push Subscription không hợp lệ (thiếu endpoint hoặc keys)', status: 400 };
    }

    try {
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id=excluded.user_id,
           p256dh=excluded.p256dh,
           auth=excluded.auth,
           user_agent=excluded.user_agent,
           updated_at=datetime('now','localtime')`
      ).bind(userId, ep, pKey, aKey, ua).run();
    } catch (upsertErr) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(ep).run();
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))`
      ).bind(userId, ep, pKey, aKey, ua).run();
    }

    return { ok: true };
  },

  async unsubscribePush(env, userId, endpoint, ensurePushSchemaFn) {
    if (typeof ensurePushSchemaFn === 'function') {
      await ensurePushSchemaFn(env);
    }
    const ep = String(endpoint || '').trim();
    if (ep) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').bind(ep, userId).run();
    } else {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=?').bind(userId).run();
    }
    return { ok: true };
  },

  async testPush(env, me, sendWebPushNotificationFn, ensurePushSchemaFn) {
    if (typeof ensurePushSchemaFn === 'function') {
      await ensurePushSchemaFn(env);
    }
    const pushRes = await sendWebPushNotificationFn(env, [me.id], {
      title: '🔔 NetViet HR - PWA',
      body: `Xin chào ${me.full_name || 'bạn'}! Thông báo đẩy lên màn hình khóa đã hoạt động thành công 🚀`,
      icon: me.avatar_url || '/icon-192.png',
      badge: '/icon-192.png',
      url: '/#/notifications',
      tag: 'test-push-notification',
    });

    if (pushRes && pushRes.total === 0) {
      return {
        error: 'Chưa có thiết bị nào kích hoạt thông báo cho tài khoản này. Vui lòng mở ứng dụng TRÊN ĐIỆN THOẠI, vào Cài đặt ➔ Thông báo và bấm "Kích hoạt thông báo" (chọn Cho phép khi máy hỏi).',
        status: 400
      };
    }

    return {
      ok: true,
      message: `Đã gửi thông báo thử nghiệm đến ${pushRes?.sent || 1} thiết bị của bạn`
    };
  },

  async getTaskMentionsUnreadCount(env, userId) {
    const totalRow = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM task_mention_notifications WHERE user_id=? AND is_read=0').bind(userId).first();
    const { results: projectRows = [] } = await env.DB.prepare(
      `SELECT t.team_project_id AS project_id, COUNT(*) AS cnt
       FROM task_mention_notifications tmn
       JOIN tasks t ON t.id = tmn.task_id
       WHERE tmn.user_id = ? AND tmn.is_read = 0
       GROUP BY t.team_project_id`
    ).bind(userId).all();

    const by_project = {};
    for (const r of projectRows) {
      if (r.project_id) by_project[String(r.project_id)] = Number(r.cnt || 0);
    }

    return {
      count: Number(totalRow?.cnt || 0),
      by_project,
    };
  },

  async getTaskMentions(env, userId) {
    const { results = [] } = await env.DB.prepare(
      `SELECT tmn.*, t.team_project_id AS project_id, t.title AS task_title
       FROM task_mention_notifications tmn
       LEFT JOIN tasks t ON t.id = tmn.task_id
       WHERE tmn.user_id=? ORDER BY tmn.created_at DESC LIMIT 100`
    ).bind(userId).all();
    return results;
  },

  async markTaskMentionRead(env, userId, notifId, broadcastAppEventFn) {
    await env.DB.prepare('UPDATE task_mention_notifications SET is_read=1 WHERE id=? AND user_id=?')
      .bind(notifId, userId).run();

    if (typeof broadcastAppEventFn === 'function') {
      await broadcastAppEventFn(env, 'notifications', 'notification:read', {
        id: notifId,
        user_id: userId,
      }, { actorId: userId, targetUserIds: [userId] });
    }

    return { ok: true };
  },

  processNotificationList(notifications, searchParams) {
    const windowDays = Math.min(90, Math.max(1, parseInt(searchParams.get('window') || '30', 10)));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('page_size') || '25', 10)));

    const moduleFilter = String(searchParams.get('module') || '').trim();
    const typeFilter = String(searchParams.get('type') || '').trim();
    const severityFilter = String(searchParams.get('severity') || '').trim();
    const search = String(searchParams.get('search') || '').trim().toLocaleLowerCase('vi');

    const filtered = notifications.filter(notification => {
      if (moduleFilter && notification.module !== moduleFilter) return false;
      if (typeFilter && notification.type !== typeFilter) return false;
      if (severityFilter && notification.severity !== severityFilter) return false;
      if (search) {
        const haystack = [
          notification.title, notification.message, notification.employee_name,
          notification.employee_code, notification.department, notification.module_label,
        ].join(' ').toLocaleLowerCase('vi');
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const severityRank = { danger: 0, warning: 1, info: 2 };
    filtered.sort((a, b) =>
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
      || String(b.occurred_on || b.due_date || '').localeCompare(String(a.occurred_on || a.due_date || ''))
      || String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'vi')
    );

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
    const values = key => [...new Set(notifications.map(item => item[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'vi'));

    return {
      notifications: paginated,
      total,
      active_total: notifications.length,
      pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: {
        danger: notifications.filter(item => item.severity === 'danger').length,
        warning: notifications.filter(item => item.severity === 'warning').length,
        info: notifications.filter(item => item.severity === 'info').length,
        employee_profile: notifications.filter(item => item.module === 'employee_profile').length,
        attendance: notifications.filter(item => item.module === 'attendance').length,
      },
      filter_options: {
        modules: values('module').map(value => ({
          value,
          label: notifications.find(item => item.module === value)?.module_label || value,
        })),
        types: values('type'),
        severities: values('severity'),
      },
      window_days: windowDays,
    };
  }
};
