import { json, err } from '../lib/response.js';
import {
  listOvertimeRequests,
  createOvertimeRequest,
  actionOvertimeRequest,
  listOvertimeForms,
  createOvertimeForm,
  updateOvertimeForm,
  submitOvertimeForm,
  decisionOvertimeForm,
} from '../services/overtime.service.js';

export const OvertimeController = {
  async listRequests({ env, url, me }, options) {
    const month = String(url.searchParams.get('month') || '');
    const status = String(url.searchParams.get('status') || '');
    const results = await listOvertimeRequests(env, me, { month, status }, options);
    return json({ overtime_requests: results });
  },

  async createRequest({ env, request, me }, { rateLimit, attShiftBounds, attToMinutes, broadcastAppEvent }) {
    const retryAfter = rateLimit(request, `overtime:${me.id}`, 10, 24 * 60 * 60 * 1000);
    if (retryAfter) {
      return json({ error: 'Đã vượt số lần gửi yêu cầu trong ngày', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const b = await request.json().catch(() => ({}));
    const attendanceId = parseInt(b.attendance_id);
    const reason = String(b.reason || '').trim();
    if (!attendanceId || !reason) return err(400, 'Vui lòng nhập lý do làm thêm giờ');
    if (reason.length > 1000) return err(400, 'Lý do làm thêm giờ không được quá 1000 ký tự');

    const result = await createOvertimeRequest(env, me, { attendanceId, reason }, { attShiftBounds, attToMinutes, broadcastAppEvent });
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async actionRequest({ env, request, me }, id, action, options) {
    const { rateLimit } = options;
    const retryAfter = rateLimit(request, `overtime-review:${me.id}`, 30, 60 * 60 * 1000);
    if (retryAfter) {
      return json({ error: 'Đã vượt giới hạn duyệt trong một giờ', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const b = await request.json().catch(() => ({}));
    const note = String(b.review_note || '').trim();
    const result = await actionOvertimeRequest(env, me, id, action, { note, approvedMinutesInput: b.approved_minutes }, options);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async listForms({ env, url, me }, options) {
    const month = String(url.searchParams.get('month') || '');
    const status = String(url.searchParams.get('status') || '');
    const forms = await listOvertimeForms(env, me, { month, status }, options);
    return json({ overtime_forms: forms });
  },

  async createForm({ env, request, me }, { rateLimit, broadcastAppEvent }) {
    const retryAfter = rateLimit(request, `overtime-form:${me.id}`, 20, 24 * 60 * 60 * 1000);
    if (retryAfter) {
      return json({ error: 'Đã vượt số lần tạo form OT trong ngày', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const b = await request.json().catch(() => ({}));
    const periodMonth = String(b.period_month || '');
    const result = await createOvertimeForm(env, me, {
      periodMonth,
      rawItems: b.items,
      submit: b.submit,
      proofUrl: b.proof_url,
    }, { broadcastAppEvent });
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async updateForm({ env, request, me }, formId, { broadcastAppEvent }) {
    const b = await request.json().catch(() => ({}));
    const result = await updateOvertimeForm(env, me, formId, {
      periodMonthInput: b.period_month,
      rawItems: b.items,
      proofUrlInput: b.proof_url,
    }, { broadcastAppEvent });
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async submitForm({ env, me }, formId, { broadcastAppEvent }) {
    const result = await submitOvertimeForm(env, me, formId, { broadcastAppEvent });
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async decisionForm({ env, request, me }, formId, options) {
    const b = await request.json().catch(() => ({}));
    const action = b.action === 'reject' ? 'reject' : 'approve';
    const note = String(b.review_note || '').trim();
    const result = await decisionOvertimeForm(env, me, formId, { action, note, itemDecisions: b.items }, options);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  }
};
