import { json, err } from '../lib/response.js';
import {
  AUDIT_SHARED_SECRET,
  saveIngestedLog,
  fetchAuditLogs,
  clearAuditLogs,
  renderAuditUiHtml
} from '../services/security-audit.service.js';

export const AuditController = {
  /**
   * Endpoint nhận log từ Production chuyển sang Demo
   * POST /api/audit/ingest
   */
  async ingest(ctx) {
    const secret = ctx.request.headers.get('x-audit-secret');
    if (secret !== AUDIT_SHARED_SECRET) {
      return err(403, 'Forbidden: Invalid audit secret');
    }
    const log = await ctx.request.json().catch(() => null);
    if (!log) return err(400, 'Invalid log payload');

    const res = await saveIngestedLog(ctx.env, log);
    if (res.error) return err(500, res.error);
    return json({ ok: true, id: res.id });
  },

  /**
   * Endpoint lấy danh sách log
   * GET /api/audit/logs
   */
  async getLogs(ctx) {
    const url = new URL(ctx.request.url);
    const limit = Number(url.searchParams.get('limit')) || 100;
    const offset = Number(url.searchParams.get('offset')) || 0;
    const eventType = url.searchParams.get('eventType') || '';
    const search = url.searchParams.get('search') || '';

    const logs = await fetchAuditLogs(ctx.env, { limit, offset, eventType, search });
    return json({ success: true, count: logs.length, logs });
  },

  /**
   * Endpoint xoá logs
   * DELETE /api/audit/logs
   */
  async clearLogs(ctx) {
    await clearAuditLogs(ctx.env);
    return json({ ok: true, message: 'Audit logs cleared' });
  },

  /**
   * Trả về giao diện Dashboard
   * GET /audit
   */
  renderUi() {
    return new Response(renderAuditUiHtml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }
};
