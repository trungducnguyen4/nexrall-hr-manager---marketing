import { json, err } from '../lib/response.js';
import { UsersService } from '../services/users.service.js';

export const UsersController = {
  async directory(ctx, { sortVietnameseNames, ensureWorkLocationStandardization, isManager, isHcns }) {
    if (!isManager) return err(403, 'Không có quyền');
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const url = new URL(ctx.request.url);
    const result = await UsersService.getDirectory(
      ctx.env, url, ctx.me, hasHrScope, isManager,
      sortVietnameseNames, ensureWorkLocationStandardization
    );
    return json(result);
  },

  async exportXls(ctx, { sortVietnameseNames, isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin được xuất dữ liệu');
    const url = new URL(ctx.request.url);
    const workbook = await UsersService.exportXls(ctx.env, url, ctx.me, sortVietnameseNames);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(workbook, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="danh-sach-nhan-vien-${date}.xls"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },

  async alerts(ctx, { isHcns, buildEmployeeAlerts }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin được xem cảnh báo');
    const url = new URL(ctx.request.url);
    const windowDays = Math.min(90, Math.max(1, parseInt(url.searchParams.get('window') || '30', 10)));
    const alerts = typeof buildEmployeeAlerts === 'function' ? await buildEmployeeAlerts(ctx.env, windowDays) : [];
    return json({
      alerts,
      total: alerts.length,
      summary: alerts.reduce((summary, alert) => {
        summary[alert.type] = (summary[alert.type] || 0) + 1;
        return summary;
      }, {}),
      window_days: windowDays,
    });
  },

  async getProfile(ctx, userId, { isManager, isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const res = await UsersService.getProfile(ctx.env, userId, ctx.me, hasHrScope, isManager);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateProfile(ctx, userId, { isManager, isHcns, broadcastAppEvent, normalizeDeptName, employeeTypeCode, normalizeWorkLocation }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const input = await ctx.request.json().catch(() => ({}));
    const res = await UsersService.updateProfile(ctx.env, userId, input, ctx.me, hasHrScope, isManager, broadcastAppEvent, {
      normalizeDeptNameFn: normalizeDeptName,
      employeeTypeCodeFn: employeeTypeCode,
      normalizeWorkLocationFn: normalizeWorkLocation,
      isAdmin: ctx.isAdmin || (ctx.me && (ctx.me.role === 'admin' || ctx.me.is_admin === true)),
    });
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async checkDeleteEligibility(ctx, userId, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin mới có quyền kiểm tra');
    const res = await UsersService.checkDeleteEligibility(ctx.env, userId);
    return json(res);
  },

  async deleteUser(ctx, userId, { isHcns, broadcastAppEvent }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin mới có quyền xóa tài khoản nhân viên');
    if (Number(ctx.me.id) === userId) return err(400, 'Không thể tự xóa tài khoản của chính mình');
    const res = await UsersService.deleteUser(ctx.env, userId, ctx.me, broadcastAppEvent);
    if (res.error) return json(res, res.status || 400);
    return json(res);
  },

  async audit(ctx, userId, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin được xem nhật ký');
    const url = new URL(ctx.request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') || '30', 10)));
    const res = await UsersService.getAudit(ctx.env, userId, page, pageSize);
    return json(res);
  },

  async timeline(ctx, userId, { isManager, isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const res = await UsersService.getTimeline(ctx.env, userId, ctx.me, hasHrScope, isManager);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async getDocuments(ctx, userId, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const res = await UsersService.getDocuments(ctx.env, userId, ctx.me, hasHrScope);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async uploadDocument(ctx, userId, { isHcns, rateLimit }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin được thêm tài liệu');
    if (typeof rateLimit === 'function') {
      const retryAfter = rateLimit(ctx.request, 'employee-document-upload', 30, 10 * 60 * 1000);
      if (retryAfter) return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const form = await ctx.request.formData().catch(() => null);
    const res = await UsersService.uploadDocument(ctx.env, userId, form, ctx.me, hasHrScope);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async getDocumentFile(ctx, userId, documentId, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const url = new URL(ctx.request.url);
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    const res = await UsersService.getDocumentFile(ctx.env, userId, documentId, ctx.me, hasHrScope, disposition);
    if (res instanceof Response) return res;
    if (res?.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteDocument(ctx, userId, documentId, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Chỉ HCNS hoặc Admin được xóa tài liệu');
    const res = await UsersService.deleteDocument(ctx.env, userId, documentId, ctx.me, hasHrScope);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async getLegacyDocument(ctx, uid, kind, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const res = await UsersService.getLegacyDocument(ctx.env, uid, kind, ctx.me, hasHrScope);
    if (res instanceof Response) return res;
    if (res?.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async uploadLegacyDocument(ctx, uid, kind, { isHcns, rateLimit }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const canUpload = hasHrScope || (kind === 'avatar' && ctx.me.id === uid);
    if (!canUpload) return err(403, 'Chỉ HCNS hoặc quản trị viên được tải hồ sơ lên');

    if (typeof rateLimit === 'function') {
      const retryAfter = rateLimit(ctx.request, 'employee-document-upload', 20, 10 * 60 * 1000);
      if (retryAfter) return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const form = await ctx.request.formData().catch(() => null);
    const res = await UsersService.uploadLegacyDocument(ctx.env, uid, kind, form, ctx.me, hasHrScope);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteLegacyDocument(ctx, uid, kind, { isHcns }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const res = await UsersService.deleteLegacyDocument(ctx.env, uid, kind, ctx.me, hasHrScope);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async listUsers(ctx, { isManager, isHcns, sortVietnameseNames }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    const res = await UsersService.listUsers(ctx.env, ctx.me, hasHrScope, isManager, sortVietnameseNames);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async createUser(ctx, { isHcns, employeeTypeCode, normalizeDeptName, nextEmployeeCode, hashPassword, nameInitials, vnTodayStr, avatarColor, normalizeWorkLocation, ensureCompanyChannel, ensureEmployeePersonalProject, broadcastAppEvent }) {
    const hasHrScope = ctx.isAdmin || (typeof isHcns === 'function' && isHcns(ctx.me));
    if (!hasHrScope) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const res = await UsersService.createUser(ctx.env, b, ctx.me, hasHrScope, {
      employeeTypeCodeFn: employeeTypeCode,
      normalizeDeptNameFn: normalizeDeptName,
      nextEmployeeCodeFn: nextEmployeeCode,
      hashPasswordFn: hashPassword,
      nameInitialsFn: nameInitials,
      vnTodayStrFn: vnTodayStr,
      avatarColorFn: avatarColor,
      normalizeWorkLocationFn: normalizeWorkLocation,
      ensureCompanyChannelFn: ensureCompanyChannel,
      ensureEmployeePersonalProjectFn: ensureEmployeePersonalProject,
      broadcastAppEventFn: broadcastAppEvent,
    });
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async getUser(ctx, uid, { isManager, isHcns }) {
    const res = await UsersService.getUser(ctx.env, uid, ctx.me, isManager, ctx.isAdmin, isHcns);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateUser(ctx, uid, { isManager, isHcns, normalizeDeptName, hashPassword, nameInitials, broadcastAppEvent }) {
    const input = await ctx.request.json().catch(() => ({}));
    const res = await UsersService.updateUser(ctx.env, uid, input, ctx.me, isManager, ctx.isAdmin, isHcns, {
      normalizeDeptNameFn: normalizeDeptName,
      hashPasswordFn: hashPassword,
      nameInitialsFn: nameInitials,
      broadcastAppEventFn: broadcastAppEvent,
    });
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteUserAccount(ctx, uid) {
    const res = await UsersService.deleteUserAccount(ctx.env, uid, ctx.me, ctx.isAdmin);
    if (res.error) return json(res, res.status || 400);
    return json(res);
  },

  async basic(ctx, { sortVietnameseNames }) {
    const list = await UsersService.getBasic(ctx.env, sortVietnameseNames);
    return json({ users: list });
  },

  async updateLifecycle(ctx, luid, { isHrOrBod, broadcastAppEvent }) {
    const input = await ctx.request.json().catch(() => ({}));
    const res = await UsersService.updateLifecycle(ctx.env, luid, input, ctx.me, isHrOrBod, broadcastAppEvent);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  }
};
