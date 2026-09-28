import { json, err } from '../lib/response.js';
import { AttendanceService } from '../services/attendance.service.js';

export const AttendanceController = {
  async list(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.list(ctx.env, url, ctx.me, deps);
    return json(res);
  },

  async listEmployees(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.listEmployees(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async myCompliance(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.myCompliance(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async today(ctx, deps) {
    const res = await AttendanceService.today(ctx.env, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async register(ctx, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.register(ctx.env, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async checkin(ctx, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.checkin(ctx.env, b, ctx.me, ctx.request, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async checkout(ctx, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.checkout(ctx.env, b, ctx.me, ctx.request, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async checkinPoints(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.checkinPoints(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async locationReview(ctx, aid, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.locationReview(ctx.env, aid, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async uploadWfhProof(ctx, deps) {
    const form = await ctx.request.formData().catch(() => null);
    const res = await AttendanceService.uploadWfhProof(ctx.env, form, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async serveWfhProof(ctx, docId, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.getWfhProofFile(ctx.env, url, docId, ctx.me, deps);
    if (res instanceof Response) return res;
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateWfhProof(ctx, aid, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.updateWfhProof(ctx.env, aid, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async listWfhRequests(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.listWfhRequests(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async decideWfh(ctx, aid, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.decideWfh(ctx.env, aid, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateRecord(ctx, aid, deps) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.updateRecord(ctx.env, aid, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteRecord(ctx, aid, deps) {
    const res = await AttendanceService.deleteRecord(ctx.env, aid, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async summary(ctx, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.summary(ctx.env, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async employeeSummary(ctx, eid, deps) {
    const url = new URL(ctx.request.url);
    const res = await AttendanceService.employeeSummary(ctx.env, eid, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async batchAdd(ctx, deps) {
    const url = new URL(ctx.request.url);
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.batchAdd(ctx.env, b, url, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async listLocations(ctx) {
    const res = await AttendanceService.listLocations(ctx.env);
    if (res.error) return err(res.status || 400, res.error);
    return json(res, res.status || 200);
  },

  async verifyLocation(ctx) {
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.verifyLocation(ctx.env, b);
    return json(res);
  },

  async createLocation(ctx, deps) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.createLocation(ctx.env, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async updateLocation(ctx, id, deps) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AttendanceService.updateLocation(ctx.env, id, b, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  },

  async deleteLocation(ctx, id, deps) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const res = await AttendanceService.deleteLocation(ctx.env, id, ctx.me, deps);
    if (res.error) return err(res.status || 400, res.error);
    return json(res);
  }
};
