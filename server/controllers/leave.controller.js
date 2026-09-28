import { json, err } from '../lib/response.js';
import { LeaveService } from '../services/leave.service.js';

export const LeaveController = {
  async listTypes(ctx) {
    const url = new URL(ctx.request.url);
    const res = await LeaveService.listTypes(ctx.env, url);
    return json(res);
  },

  async createType(ctx, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.createType(ctx.env, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateType(ctx, id, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.updateType(ctx.env, id, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteType(ctx, id, deps) {
    const res = await LeaveService.deleteType(ctx.env, id, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async getBalances(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await LeaveService.getBalances(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async adjustBalance(ctx, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.adjustBalance(ctx.env, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async uploadDocument(ctx, deps) {
    const form = await ctx.request.formData().catch(() => null);
    const res = await LeaveService.uploadDocument(ctx.env, form, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async listRequests(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await LeaveService.listRequests(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async createRequest(ctx, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.createRequest(ctx.env, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async listDocuments(ctx, leaveId, deps) {
    const res = await LeaveService.listDocuments(ctx.env, leaveId, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async getDocumentFile(ctx, leaveId, documentId, deps) {
    const url = new URL(ctx.request.url);
    const res = await LeaveService.getDocumentFile(ctx.env, url, leaveId, documentId, ctx.me, deps);
    if (res instanceof Response) return res;
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateRequest(ctx, id, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.updateRequest(ctx.env, id, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteRequest(ctx, id, deps) {
    const res = await LeaveService.deleteRequest(ctx.env, id, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async listHolidays(ctx) {
    const res = await LeaveService.listHolidays(ctx.env);
    return json(res);
  },

  async createHoliday(ctx) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.createHoliday(ctx.env, b, ctx.me);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateHoliday(ctx, id) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const res = await LeaveService.updateHoliday(ctx.env, id, b, ctx.me);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteHoliday(ctx, id) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const res = await LeaveService.deleteHoliday(ctx.env, id, ctx.me);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  }
};
