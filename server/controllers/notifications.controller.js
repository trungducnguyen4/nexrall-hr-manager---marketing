import { json, err } from '../lib/response.js';
import { NotificationsService } from '../services/notifications.service.js';

export const NotificationsController = {
  getPushVapidPublicKey(ctx, publicKey) {
    return json({ public_key: publicKey });
  },

  async pushSubscribe(ctx, ensurePushSchemaFn) {
    try {
      const b = await ctx.request.json().catch(() => ({}));
      const res = await NotificationsService.subscribePush(ctx.env, ctx.me.id, b, ensurePushSchemaFn);
      if (res.error) return err(res.status || 400, res.error);
      return json({ ok: true });
    } catch (e) {
      console.error('Push subscribe error:', e);
      return err(500, 'Không thể lưu thông tin thông báo: ' + (e?.message || e));
    }
  },

  async pushUnsubscribe(ctx, ensurePushSchemaFn) {
    try {
      const b = await ctx.request.json().catch(() => ({}));
      const endpoint = String(b.endpoint || '').trim();
      const res = await NotificationsService.unsubscribePush(ctx.env, ctx.me.id, endpoint, ensurePushSchemaFn);
      if (res.error) return err(res.status || 400, res.error);
      return json({ ok: true });
    } catch (e) {
      return err(500, 'Lỗi hủy đăng ký push: ' + (e?.message || e));
    }
  },

  async testPush(ctx, sendWebPushNotificationFn, ensurePushSchemaFn) {
    try {
      const res = await NotificationsService.testPush(ctx.env, ctx.me, sendWebPushNotificationFn, ensurePushSchemaFn);
      if (res.error) return err(res.status || 400, res.error);
      return json(res);
    } catch (e) {
      return err(500, 'Lỗi gửi test push: ' + (e?.message || e));
    }
  },

  async getTaskMentionsUnreadCount(ctx) {
    const res = await NotificationsService.getTaskMentionsUnreadCount(ctx.env, ctx.me.id);
    return json(res);
  },

  async getTaskMentions(ctx) {
    const list = await NotificationsService.getTaskMentions(ctx.env, ctx.me.id);
    return json({ notifications: list });
  },

  async markTaskMentionRead(ctx, notifId, broadcastAppEventFn) {
    await NotificationsService.markTaskMentionRead(ctx.env, ctx.me.id, notifId, broadcastAppEventFn);
    return json({ ok: true });
  },

  async list(ctx, { triggerAutoCheckout, buildEmployeeAlerts, buildAttendanceNotifications, isAttendanceHcns, isHcns }) {
    if (typeof triggerAutoCheckout === 'function') {
      triggerAutoCheckout(ctx.env);
    }
    const url = new URL(ctx.request.url);
    const windowDays = Math.min(90, Math.max(1, parseInt(url.searchParams.get('window') || '30', 10)));
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));

    const notifications = [
      ...(hasHrScope && typeof buildEmployeeAlerts === 'function' ? await buildEmployeeAlerts(ctx.env, windowDays) : []),
      ...(typeof buildAttendanceNotifications === 'function' ? await buildAttendanceNotifications(ctx.env, ctx.me, {
        windowDays,
        isAdmin: ctx.isAdmin,
        isHcnsScope: isAttendanceHcns,
      }) : []),
    ];

    const result = NotificationsService.processNotificationList(notifications, url.searchParams);
    return json(result);
  }
};
