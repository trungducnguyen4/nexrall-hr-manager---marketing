/**
 * AI Controller - HTTP Endpoints for Copilot, RAG Knowledge & LLMOps Telemetry
 */
import { json, err } from '../lib/response.js';
import { runCopilotTurn, runCopilotTurnStream, safeBroadcast, checkRolePermissions, resolveUserPersona } from '../services/agent.service.js';
import { ingestDocument, seedInitialKnowledge } from '../services/rag.service.js';
import { ensureAiSchema } from '../services/ai-gateway.service.js';

// Rate Limiting Buckets for AI Copilot (P0.1)
const userAiBuckets = new Map();
const ipAiBuckets = new Map();

// Idempotency token cache for Human-in-the-Loop Actions (P0.4)
const actionIdempotencyCache = new Map();

function checkAiRateLimit(userId, clientIp) {
  const now = Date.now();
  // 1. User bucket: 10 requests / 60 seconds, 100 requests / 3600 seconds
  if (userId) {
    const userKey = `user:${userId}`;
    let uBucket = userAiBuckets.get(userKey);
    if (!uBucket || now >= uBucket.resetAt) {
      userAiBuckets.set(userKey, {
        count: 1,
        resetAt: now + 60_000,
        hourCount: (uBucket && now < uBucket.hourResetAt ? uBucket.hourCount + 1 : 1),
        hourResetAt: (uBucket && now < uBucket.hourResetAt ? uBucket.hourResetAt : now + 3600_000)
      });
    } else {
      uBucket.count += 1;
      if (now < uBucket.hourResetAt) uBucket.hourCount += 1;
      if (uBucket.count > 10) {
        const retrySec = Math.max(1, Math.ceil((uBucket.resetAt - now) / 1000));
        return { limited: true, retryAfter: retrySec, message: `Bạn đã gửi yêu cầu quá nhanh (tối đa 10 req/phút). Vui lòng thử lại sau ${retrySec}s.` };
      }
      if (uBucket.hourCount > 100) {
        const retrySec = Math.max(1, Math.ceil((uBucket.hourResetAt - now) / 1000));
        return { limited: true, retryAfter: retrySec, message: `Bạn đã vượt quá giới hạn AI trong 1 giờ (100 req/giờ). Vui lòng thử lại sau ${retrySec}s.` };
      }
    }
  }

  // 2. IP bucket: 20 requests / 60 seconds
  if (clientIp) {
    const ipKey = `ip:${clientIp}`;
    let ipBucket = ipAiBuckets.get(ipKey);
    if (!ipBucket || now >= ipBucket.resetAt) {
      ipAiBuckets.set(ipKey, { count: 1, resetAt: now + 60_000 });
    } else {
      ipBucket.count += 1;
      if (ipBucket.count > 20) {
        const retrySec = Math.max(1, Math.ceil((ipBucket.resetAt - now) / 1000));
        return { limited: true, retryAfter: retrySec, message: `Lưu lượng AI từ IP này quá nhanh. Vui lòng thử lại sau ${retrySec}s.` };
      }
    }
  }

  return { limited: false };
}

export async function handleAiRoutes(request, env, me, path, url) {
  if (!me || !me.id) {
    return err(401, 'Vui lòng đăng nhập để sử dụng AI Copilot');
  }

  // 0. Instant Role-aware Briefing Card (0ms LLM latency, 0 token cost)
  if (path === '/api/ai/briefing' && request.method === 'GET') {
    try {
      const persona = resolveUserPersona(me);
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const todayStr = now.toISOString().slice(0, 10);

      if (persona === 'director') {
        const u = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').first();
        const headcount = u?.cnt || 0;

        const att = await env.DB.prepare(`
          SELECT COUNT(CASE WHEN checkin_time IS NOT NULL THEN 1 END) as checkins,
                 COUNT(CASE WHEN work_type = 'wfh' THEN 1 END) as wfh
            FROM attendance WHERE date = ?
        `).bind(todayStr).first();
        const checkins = att?.checkins || 0;
        const presenceRate = headcount > 0 ? Number(((checkins / headcount) * 100).toFixed(1)) : 0;

        const ot = await env.DB.prepare("SELECT SUM(COALESCE(approved_minutes, requested_minutes, 0)) as min_sum FROM overtime_requests WHERE work_date LIKE ? AND (status = 'approved' OR status = 'pending')").bind(`${currentMonth}%`).first();
        const otHours = Number(((ot?.min_sum || 0) / 60).toFixed(1));

        const pendingReq = await env.DB.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'").first();
        const pendingCount = pendingReq?.cnt || 0;

        return json({
          ok: true,
          briefing: {
            persona: 'director',
            badge: 'Director Insights',
            title: 'Director Insights - Cố vấn Điều hành',
            subtitle: 'Phân tích dữ liệu & hỗ trợ quyết sách nhân sự cấp cao',
            greeting: `Kính chào **${me.full_name}**! Dưới đây là tóm tắt điều hành nhân sự hôm nay:`,
            metrics: [
              { label: 'Quy mô nhân sự', value: `${headcount} người`, icon: 'users', color: 'indigo' },
              { label: 'Tỷ lệ có mặt VP', value: `${presenceRate}%`, icon: 'activity', color: 'emerald' },
              { label: 'Giờ OT tháng này', value: `${otHours} giờ`, icon: 'clock', color: 'amber' },
              { label: 'Đơn chờ duyệt', value: `${pendingCount} đơn`, icon: 'shieldCheck', color: 'rose' }
            ],
            quickPrompts: [
              { label: 'Tăng trưởng nhân sự', prompt: 'Phân tích tăng trưởng quy mô nhân sự và tỷ lệ nghỉ việc turnover' },
              { label: 'So sánh phòng ban', prompt: 'So sánh chuyên cần, tỷ lệ đi muộn và hiệu suất giữa các phòng ban' },
              { label: 'Xu hướng chi phí OT', prompt: 'Phân tích xu hướng số giờ OT và chi phí làm thêm 3 tháng gần nhất' },
              { label: 'Báo cáo điều hành', prompt: 'Báo cáo điều hành tổng quan tình hình nhân sự công ty hôm nay' }
            ],
            quickTips: 'Hệ thống tự động đồng bộ số liệu thời gian thực. Bấm vào gợi ý hoặc nhập câu hỏi để phân tích chi tiết.'
          }
        });
      }

      if (persona === 'hr') {
        const u = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').first();
        const totalUsers = u?.cnt || 0;

        const att = await env.DB.prepare(`
          SELECT COUNT(CASE WHEN checkin_time IS NOT NULL AND work_type != 'wfh' THEN 1 END) as present,
                 COUNT(CASE WHEN work_type = 'wfh' THEN 1 END) as wfh,
                 COUNT(CASE WHEN late_minutes > 0 THEN 1 END) as late
            FROM attendance WHERE date = ?
        `).bind(todayStr).first();

        const leaves = await env.DB.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE ? BETWEEN start_date AND end_date AND status = 'approved'").bind(todayStr).first();
        const pendingLeaves = await env.DB.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'").first();

        const contracts = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE is_active = 1 AND contract_end_date IS NOT NULL AND contract_end_date >= date('now') AND contract_end_date <= date('now', '+30 days')").first();

        return json({
          ok: true,
          briefing: {
            persona: 'hr',
            badge: 'HR Copilot',
            title: 'HR Copilot - Vận hành Nhân sự',
            subtitle: 'Giám sát chuyên cần, quản trị thủ tục & thực thi chính sách',
            greeting: `Xin chào **${me.full_name}**! Báo cáo vận hành nhân sự ngày ${todayStr}:`,
            metrics: [
              { label: 'Có mặt tại VP', value: `${att?.present || 0}/${totalUsers}`, icon: 'userCheck', color: 'emerald' },
              { label: 'WFH / Nghỉ phép', value: `${att?.wfh || 0} WFH • ${leaves?.cnt || 0} nghỉ`, icon: 'home', color: 'blue' },
              { label: 'Đơn chờ duyệt', value: `${pendingLeaves?.cnt || 0} đơn`, icon: 'fileText', color: 'amber' },
              { label: 'HĐ sắp hết hạn', value: `${contracts?.cnt || 0} HĐ (30d)`, icon: 'alertTriangle', color: 'rose' }
            ],
            quickPrompts: [
              { label: 'Đi trễ > 3 lần', prompt: 'Những nhân viên nào tháng này đi trễ trên 3 lần?' },
              { label: 'Ai nghỉ hôm nay', prompt: 'Hôm nay ai đang nghỉ phép và ai làm việc WFH?' },
              { label: 'Hợp đồng hết hạn', prompt: 'Danh sách nhân viên có hợp đồng lao động sắp hết hạn trong 30 ngày tới?' },
              { label: 'Tổng giờ làm thêm', prompt: 'Tổng hợp số giờ làm thêm OT của các phòng ban tháng này?' }
            ],
            quickTips: 'Bạn có thể duyệt đơn nghỉ phép nhanh hoặc tra cứu quy chế công ty có trích dẫn điều khoản.'
          }
        });
      }

      // Default: Employee Personal Assistant
      let leaveBal = 12;
      try {
        const bal = await env.DB.prepare('SELECT available_days FROM leave_balances WHERE user_id = ? AND balance_year = ?').bind(me.id, currentYear).first();
        if (bal && bal.available_days != null) leaveBal = bal.available_days;
      } catch (_) {}

      const todayAtt = await env.DB.prepare('SELECT checkin_time, checkout_time, work_type, status, late_minutes FROM attendance WHERE user_id = ? AND date = ?').bind(me.id, todayStr).first();
      let attStatus = 'Chưa check-in';
      let attColor = 'amber';
      if (todayAtt?.checkin_time) {
        attStatus = `Check-in ${todayAtt.checkin_time}` + (todayAtt.late_minutes > 0 ? ` (Trễ ${todayAtt.late_minutes}p)` : ' (Đúng giờ)');
        attColor = todayAtt.late_minutes > 0 ? 'rose' : 'emerald';
      }

      let taskCount = 0;
      try {
        const t = await env.DB.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE assigned_to = ? AND status IN ('todo', 'in-progress')").bind(me.id).first();
        taskCount = t?.cnt || 0;
      } catch (_) {}

      return json({
        ok: true,
        briefing: {
          persona: 'employee',
          badge: 'HR Cá nhân',
          title: 'HR Assistant Cá nhân',
          subtitle: 'Trợ lý quyền lợi, chấm công & thủ tục của riêng bạn',
          greeting: `Xin chào **${me.full_name}**! Dưới đây là thông tin cá nhân của bạn hôm nay:`,
          metrics: [
            { label: 'Ngày phép còn lại', value: `${leaveBal} ngày`, icon: 'calendarDays', color: 'emerald' },
            { label: 'Chấm công hôm nay', value: attStatus, icon: 'clock3', color: attColor },
            { label: 'Công việc đang chờ', value: `${taskCount} task`, icon: 'clipboardList', color: 'indigo' }
          ],
          quickPrompts: [
            { label: 'Xin nghỉ phép', prompt: 'Tôi muốn đăng ký nghỉ phép ngày mai' },
            { label: 'Xin WFH', prompt: 'Tạo đơn xin làm việc tại nhà (WFH) ngày mai' },
            { label: 'Quên check-in', prompt: 'Tôi quên check-in hôm nay, hướng dẫn gửi giải trình chỉnh công' },
            { label: 'Phiếu lương của tôi', prompt: 'Bảng lương tháng này của tôi thế nào?' }
          ],
          quickTips: 'Bạn có thể gõ câu hỏi tự nhiên để tra cứu hoặc tạo đơn thủ tục với Action Card xác nhận tức thì.'
        }
      });
    } catch (bErr) {
      console.error('Copilot briefing error:', bErr);
      return err(500, 'Không thể tạo bản tóm tắt nhanh');
    }
  }

  // 1. Chat Completion / Copilot Query (Supports JSON & SSE Stream)
  if (path === '/api/ai/chat' && request.method === 'POST') {
    // 1.0 AI Rate Limiting Check (P0.1)
    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';
    const rateCheck = checkAiRateLimit(me.id, clientIp);
    if (rateCheck.limited) {
      return new Response(JSON.stringify({ error: rateCheck.message, code: 'AI_RATE_LIMIT_EXCEEDED' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(rateCheck.retryAfter)
        }
      });
    }

    try {
      try {
        await ensureAiSchema(env);
        await seedInitialKnowledge(env, me.id);
      } catch (_) {}

      // 1.1 Payload Size & Input Validation (P0.2)
      const cl = Number(request.headers.get('content-length') || 0);
      if (cl > 65536) {
        return err(413, 'Dung lượng payload AI vượt quá giới hạn (tối đa 64KB)');
      }

      const body = await request.json();
      const message = String(body.message || '').trim();
      if (!message) return err(400, 'Thiếu nội dung tin nhắn');
      if (message.length > 2000) {
        return err(400, 'Nội dung tin nhắn vượt quá giới hạn 2.000 ký tự');
      }

      let conversationHistory = Array.isArray(body.history) ? body.history : [];
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }
      for (const item of conversationHistory) {
        if (item && item.content && String(item.content).length > 2000) {
          item.content = String(item.content).slice(0, 2000);
        }
      }

      const conversationId = String(body.conversationId || 'default').slice(0, 64);
      const isStream = Boolean(body.stream) || request.headers.get('accept')?.includes('text/event-stream');

      if (isStream) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (event, data) => {
          try {
            const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            await writer.write(encoder.encode(payload));
          } catch (_) {}
        };

        (async () => {
          try {
            await runCopilotTurnStream(env, {
              userMessage: message,
              conversationHistory,
              me,
              conversationId,
              onEvent: sendEvent
            });
          } catch (streamErr) {
            console.error('Stream error:', streamErr);
            await sendEvent('error', { message: streamErr?.message || 'Lỗi xử lý luồng streaming' });
          } finally {
            try { await writer.close(); } catch (_) {}
          }
        })();

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Non-streaming JSON mode (100% backward compatible)
      const result = await runCopilotTurn(env, {
        userMessage: message,
        conversationHistory,
        me,
        conversationId
      });

      return json({ ok: true, ...result });
    } catch (error) {
      console.error('AI Chat endpoint error:', error);
      return err(500, error?.message || 'Lỗi xử lý AI Copilot');
    }
  }

  // 2. Knowledge Base Listing
  if (path === '/api/ai/knowledge' && request.method === 'GET') {
    try {
      const { results: docs = [] } = await env.DB.prepare(`
        SELECT id, title, category, version, effective_date, chunk_count, created_at, updated_at
          FROM knowledge_documents
         ORDER BY id ASC
      `).all();

      return json({ ok: true, documents: docs });
    } catch (error) {
      console.error('List knowledge documents error:', error);
      return err(500, 'Không thể tải danh sách tài liệu tri thức');
    }
  }

  // 3. Ingest New Knowledge Document
  if (path === '/api/ai/knowledge' && request.method === 'POST') {
    const isHcns = me.role === 'admin' || me.department === 'Phòng HCNS';
    if (!isHcns) return err(403, 'Chỉ Admin hoặc HCNS có quyền thêm tài liệu tri thức');

    try {
      const body = await request.json();
      const title = String(body.title || '').trim();
      const rawContent = String(body.content || '').trim();
      const category = body.category || 'hr_policy';
      const effectiveDate = body.effectiveDate || null;

      if (!title || !rawContent) return err(400, 'Thiếu tiêu đề hoặc nội dung tài liệu');

      const res = await ingestDocument(env, {
        title,
        category,
        effectiveDate,
        rawContent,
        actorId: me.id
      });

      return json({ ok: true, ...res });
    } catch (error) {
      console.error('Ingest knowledge document error:', error);
      return err(500, error?.message || 'Không thể bóc tách và lập chỉ mục tài liệu');
    }
  }

  // 4. Seed Standard Knowledge Base
  if (path === '/api/ai/knowledge/seed' && request.method === 'POST') {
    const isHcns = me.role === 'admin' || me.department === 'Phòng HCNS';
    if (!isHcns) return err(403, 'Không có quyền');

    try {
      const res = await seedInitialKnowledge(env, me.id);
      return json({ ok: true, ...res });
    } catch (error) {
      console.error('Seed knowledge error:', error);
      return err(500, 'Lỗi nạp dữ liệu tri thức mẫu');
    }
  }

  // 5. Human-in-the-Loop Action Confirmation (Supports all 14 action types)
  if (path === '/api/ai/actions/confirm' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { actionType, payload, actionId, idempotencyKey } = body;
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);

      // Idempotency token check (P0.4)
      const token = actionId || idempotencyKey;
      if (token) {
        const cached = actionIdempotencyCache.get(token);
        if (cached && (Date.now() - cached.timestamp < 60_000)) {
          return json(cached.response);
        }
      }

      if (actionType === 'create_leave_request') {
        const { leaveType, startDate, endDate, reason } = payload || {};
        if (!startDate || !endDate) return err(400, 'Thiếu ngày nghỉ phép');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return err(400, 'Định dạng ngày không hợp lệ (yêu cầu YYYY-MM-DD)');
        }
        if (startDate > endDate) {
          return err(400, 'Ngày bắt đầu không được sau ngày kết thúc');
        }
        const diffDays = Math.round((new Date(endDate) - new Date(startDate)) / (24 * 3600 * 1000)) + 1;
        if (diffDays > 30) {
          return err(400, 'Không thể nộp đơn nghỉ phép quá 30 ngày trong một yêu cầu');
        }
        const allowedLeaveTypes = ['annual', 'unpaid', 'maternity', 'wedding', 'funeral', 'sick', 'other'];
        const cleanType = allowedLeaveTypes.includes(leaveType) ? leaveType : 'annual';
        const cleanReason = String(reason || 'Tạo qua Trợ lý ảo HR NetViet').slice(0, 500);

        const r = await env.DB.prepare(`
          INSERT INTO requests (
            user_id, employee_id, request_type, type, start_date, end_date, reason,
            status, step1_status, step2_status, created_at, updated_at
          ) VALUES (?, ?, 'leave', ?, ?, ?, ?, 'pending', 'pending', 'pending', datetime('now','localtime'), datetime('now','localtime'))
        `).bind(
          me.id,
          me.id,
          cleanType,
          startDate,
          endDate,
          cleanReason
        ).run();

        const reqId = r.meta.last_row_id;
        await safeBroadcast(env, 'leave', 'leave:new', { id: reqId, user_id: me.id }, { actorId: me.id });
        const resObj = { ok: true, actionType, requestId: reqId, message: 'Đã tạo đơn xin nghỉ phép thành công' };
        if (token) actionIdempotencyCache.set(token, { timestamp: Date.now(), response: resObj });
        return json(resObj);
      }

      if (actionType === 'create_wfh_request') {
        const { date, shift, reason } = payload || {};
        if (!date) return err(400, 'Thiếu ngày làm việc WFH');
        const cleanReason = String(reason || 'Đăng ký WFH qua AI Copilot').slice(0, 500);
        const cleanShift = ['full', 'morning', 'afternoon'].includes(shift) ? shift : 'full';

        const existing = await env.DB.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').bind(me.id, date).first();
        let aid = existing?.id;
        if (existing) {
          await env.DB.prepare("UPDATE attendance SET work_type = 'wfh', shift = ?, wfh_status = 'pending', wfh_reason = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(cleanShift, cleanReason, existing.id).run();
        } else {
          const r = await env.DB.prepare("INSERT INTO attendance (user_id, date, work_type, shift, registered, status, wfh_status, wfh_reason, created_at) VALUES (?, ?, 'wfh', ?, 1, 'registered', 'pending', ?, datetime('now','localtime'))").bind(me.id, date, cleanShift, cleanReason).run();
          aid = r.meta?.last_row_id;
        }
        await safeBroadcast(env, 'attendance', 'attendance:wfh_requested', { id: aid, user_id: me.id, date, wfh_status: 'pending' }, { actorId: me.id });
        const resObj = { ok: true, actionType, attendanceId: aid, message: `Đã nộp đơn xin làm việc tại nhà (WFH) ngày ${date} thành công.` };
        if (token) actionIdempotencyCache.set(token, { timestamp: Date.now(), response: resObj });
        return json(resObj);
      }

      if (actionType === 'create_attendance_correction') {
        const { date, actualCheckin, actualCheckout, reason } = payload || {};
        if (!date) return err(400, 'Thiếu ngày làm việc cần chỉnh công');
        const cleanReason = String(reason || 'Yêu cầu giải trình/chỉnh công qua AI Copilot').slice(0, 500);
        const cleanIn = actualCheckin || '08:30';
        const cleanOut = actualCheckout || '17:00';

        const existing = await env.DB.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').bind(me.id, date).first();
        let aid = existing?.id;
        if (existing) {
          await env.DB.prepare("UPDATE attendance SET checkin_requires_review = 1, checkin_review_status = 'pending', checkin_review_note = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(cleanReason, `Giải trình AI: ${cleanReason}`, existing.id).run();
        } else {
          const r = await env.DB.prepare("INSERT INTO attendance (user_id, date, checkin_time, checkout_time, status, work_hours, checkin_requires_review, checkin_review_status, checkin_review_note, note, created_at) VALUES (?, ?, ?, ?, 'present', 8.5, 1, 'pending', ?, ?, datetime('now','localtime'))").bind(me.id, date, cleanIn, cleanOut, cleanReason, `Giải trình AI: ${cleanReason}`).run();
          aid = r.meta?.last_row_id;
        }
        await safeBroadcast(env, 'attendance', 'attendance:correction_requested', { id: aid, user_id: me.id, date }, { actorId: me.id });
        const resObj = { ok: true, actionType, attendanceId: aid, message: `Đã gửi yêu cầu chỉnh công / giải trình ngày ${date} thành công.` };
        if (token) actionIdempotencyCache.set(token, { timestamp: Date.now(), response: resObj });
        return json(resObj);
      }

      if (actionType === 'create_task') {
        const { title, description, priority, dueDate, assigneeId } = payload || {};
        const cleanTitle = String(title || '').trim().slice(0, 200);
        if (!cleanTitle) return err(400, 'Thiếu tiêu đề công việc hoặc tiêu đề không hợp lệ');

        const allowedPriorities = ['low', 'medium', 'high', 'urgent'];
        const cleanPriority = allowedPriorities.includes(priority) ? priority : 'medium';
        const cleanDueDate = (dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) ? dueDate : null;

        const r = await env.DB.prepare(`
          INSERT INTO tasks (
            workspace_id, title, description, priority, status, due_date,
            assigned_to, assigned_by, created_by, created_at, updated_at
          ) VALUES (1, ?, ?, ?, 'todo', ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
        `).bind(
          cleanTitle,
          String(description || '').slice(0, 2000),
          cleanPriority,
          cleanDueDate,
          assigneeId || me.id,
          me.id,
          me.id
        ).run();

        const tid = r.meta.last_row_id;
        await safeBroadcast(env, 'tasks', 'task:created', { id: tid, title: cleanTitle }, { actorId: me.id });
        const resObj = { ok: true, actionType, taskId: tid, message: 'Đã tạo công việc mới thành công' };
        if (token) actionIdempotencyCache.set(token, { timestamp: Date.now(), response: resObj });
        return json(resObj);
      }

      if (actionType === 'update_task_status') {
        const { taskId, status } = payload || {};
        const tid = Number(taskId);
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(tid).first();
        if (!task) return err(404, 'Không tìm thấy công việc');
        if (!isAdmin && !isManager && task.assigned_to !== me.id && task.assigned_by !== me.id) {
          return err(403, 'Không có quyền cập nhật công việc này');
        }
        await env.DB.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(status || 'done', tid).run();
        await safeBroadcast(env, 'tasks', 'task:updated', { id: tid, status: status || 'done' }, { actorId: me.id });
        return json({ ok: true, actionType, taskId: tid, message: `Đã cập nhật trạng thái Task #${tid} sang ${status || 'done'}` });
      }

      if (actionType === 'assign_task') {
        const { taskId, assigneeId } = payload || {};
        const tid = Number(taskId);
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(tid).first();
        if (!task) return err(404, 'Không tìm thấy công việc');
        if (!isAdmin && !isManager && task.assigned_by !== me.id) return err(403, 'Không có quyền');
        await env.DB.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(Number(assigneeId), tid).run();
        await safeBroadcast(env, 'tasks', 'task:assigned', { id: tid, assigned_to: Number(assigneeId) }, { actorId: me.id });
        return json({ ok: true, actionType, taskId: tid, message: `Đã phân công lại Task #${tid}` });
      }

      if (actionType === 'update_task_details') {
        const { taskId, dueDate, priority } = payload || {};
        const tid = Number(taskId);
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(tid).first();
        if (!task) return err(404, 'Không tìm thấy công việc');
        await env.DB.prepare("UPDATE tasks SET due_date = COALESCE(?, due_date), priority = COALESCE(?, priority), updated_at = datetime('now','localtime') WHERE id = ?")
          .bind(dueDate || null, priority || null, tid).run();
        await safeBroadcast(env, 'tasks', 'task:updated', { id: tid, due_date: dueDate, priority }, { actorId: me.id });
        return json({ ok: true, actionType, taskId: tid, message: `Đã cập nhật thông tin Task #${tid}` });
      }

      if (actionType === 'delete_task') {
        const { taskId } = payload || {};
        const tid = Number(taskId);
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(tid).first();
        if (!task) return err(404, 'Không tìm thấy công việc');
        if (!isAdmin && !isManager && task.assigned_by !== me.id) return err(403, 'Không có quyền xóa');
        await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(tid).run();
        await safeBroadcast(env, 'tasks', 'task:deleted', { id: tid }, { actorId: me.id });
        return json({ ok: true, actionType, taskId: tid, message: `Đã xóa công việc #${tid}` });
      }

      if (actionType === 'approve_leave_request') {
        if (!isAdmin && !isHcns && !isManager) return err(403, 'Không có quyền duyệt');
        const { requestId } = payload || {};
        const rid = Number(requestId);
        await env.DB.prepare(`
          UPDATE requests
             SET status = 'approved', step1_status = 'approved', step2_status = 'approved',
                 updated_at = datetime('now','localtime')
           WHERE id = ?
        `).bind(rid).run();
        await safeBroadcast(env, 'leave', 'leave:approved', { id: rid }, { actorId: me.id });
        return json({ ok: true, actionType, requestId: rid, message: `Đã phê duyệt đơn xin nghỉ phép #${rid}` });
      }

      if (actionType === 'reject_leave_request') {
        if (!isAdmin && !isHcns && !isManager) return err(403, 'Không có quyền từ chối');
        const { requestId, reason } = payload || {};
        const rid = Number(requestId);
        await env.DB.prepare(`
          UPDATE requests
             SET status = 'rejected', step1_status = 'rejected', step2_status = 'rejected',
                 updated_at = datetime('now','localtime')
           WHERE id = ?
        `).bind(rid).run();
        await safeBroadcast(env, 'leave', 'leave:rejected', { id: rid }, { actorId: me.id });
        return json({ ok: true, actionType, requestId: rid, message: `Đã từ chối đơn xin nghỉ phép #${rid}` });
      }

      if (actionType === 'post_announcement') {
        if (!isAdmin && !isHcns) return err(403, 'Chỉ Admin/HCNS mới có quyền đăng thông báo');
        const { title, content, priority, targetScope, targetDepartment } = payload || {};
        if (!title) return err(400, 'Thiếu tiêu đề thông báo');
        const r = await env.DB.prepare(`
          INSERT INTO announcements (title, content, priority, target_scope, target_department, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(title, content || title, priority || 'normal', targetScope || 'all', targetDepartment || null, me.id).run();
        const aid = r.meta.last_row_id;
        await safeBroadcast(env, 'announcements', 'announcement:new', { id: aid, title }, { actorId: me.id });
        return json({ ok: true, actionType, announcementId: aid, message: `Đã đăng thông báo thành công: "${title}"` });
      }

      if (actionType === 'update_employee_code') {
        if (!isAdmin) return err(403, 'Chỉ Quản trị viên mới có quyền cập nhật Mã nhân viên');
        const { userId, employeeCode } = payload || {};
        const uid = Number(userId);
        const newCode = String(employeeCode || '').trim().toUpperCase();
        if (!uid || !newCode) return err(400, 'Thiếu thông tin cập nhật');

        const existing = await env.DB.prepare('SELECT id FROM users WHERE UPPER(employee_code) = ? AND id != ? LIMIT 1').bind(newCode, uid).first();
        if (existing) return err(409, `Mã nhân viên "${newCode}" đã tồn tại trong hệ thống`);

        await env.DB.prepare("UPDATE users SET employee_code = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(newCode, uid).run();
        try {
          await env.DB.prepare('UPDATE payroll SET employee_code = ? WHERE employee_id = ? OR user_id = ?').bind(newCode, uid, String(uid)).run();
        } catch (_) {}
        await safeBroadcast(env, 'users', 'user:updated', { id: uid, employee_code: newCode }, { actorId: me.id });
        return json({ ok: true, actionType, userId: uid, employeeCode: newCode, message: `Đã cập nhật Mã nhân viên sang "${newCode}"` });
      }

      if (actionType === 'create_handover') {
        const { assetName, assetType, mentorId, mentorName, note } = payload || {};
        if (!assetName) return err(400, 'Thiếu tên tài sản/dự án bàn giao');
        const r = await env.DB.prepare(`
          INSERT INTO asset_handovers (user_id, asset_name, asset_type, mentor_id, mentor_name, note, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).bind(me.id, assetName, assetType || 'device', mentorId || null, mentorName || null, note || '').run();
        const hid = r.meta.last_row_id;
        await safeBroadcast(env, 'handover', 'handover:created', { id: hid }, { actorId: me.id });
        return json({ ok: true, actionType, handoverId: hid, message: 'Đã tạo biên bản bàn giao thành công' });
      }

      if (actionType === 'confirm_handover') {
        const { handoverId } = payload || {};
        const hid = Number(handoverId);
        await env.DB.prepare("UPDATE asset_handovers SET status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(hid).run();
        await safeBroadcast(env, 'handover', 'handover:confirmed', { id: hid }, { actorId: me.id });
        return json({ ok: true, actionType, handoverId: hid, message: `Đã xác nhận hoàn tất bàn giao #${hid}` });
      }

      return err(400, `Hành động không hợp lệ: ${actionType}`);
    } catch (error) {
      console.error('Confirm AI action error:', error);
      return err(500, error?.message || 'Lỗi thực thi hành động');
    }
  }

  // 5b. Undo AI Action (/api/ai/actions/undo)
  if (path === '/api/ai/actions/undo' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { actionType, payload } = body;
      if (actionType === 'update_task_status') {
        const { taskId, status } = payload || {};
        const tid = Number(taskId);
        if (tid && status) {
          await env.DB.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(status, tid).run();
          await safeBroadcast(env, 'tasks', 'task:updated', { id: tid, status }, { actorId: me.id });
          return json({ ok: true, message: `Đã hoàn tác trạng thái Task #${tid} về "${status}"` });
        }
      }
      if (actionType === 'assign_task') {
        const { taskId, assigneeId } = payload || {};
        const tid = Number(taskId);
        if (tid) {
          await env.DB.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(assigneeId || null, tid).run();
          await safeBroadcast(env, 'tasks', 'task:assigned', { id: tid, assigned_to: assigneeId }, { actorId: me.id });
          return json({ ok: true, message: `Đã hoàn tác người nhận việc cho Task #${tid}` });
        }
      }
      return json({ ok: true, message: 'Đã hoàn tác thao tác thành công' });
    } catch (e) {
      return err(500, e?.message || 'Lỗi hoàn tác');
    }
  }

  // 6. User Feedback (Thumbs Up / Down)
  if (path === '/api/ai/feedback' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { requestId, rating, comment } = body;
      if (!requestId) return err(400, 'Thiếu requestId');

      const isAdmin = me.role === 'admin';
      const r = await env.DB.prepare(`
        UPDATE ai_generation_logs
           SET user_rating = ?, feedback_comment = ?
         WHERE id = ? AND (user_id = ? OR ? = 1)
      `).bind(Number(rating || 0), comment ? String(comment).slice(0, 500) : null, requestId, me.id, isAdmin ? 1 : 0).run();

      if (!r.meta.changes) {
        return err(404, 'Không tìm thấy log yêu cầu hoặc bạn không có quyền đánh giá');
      }

      return json({ ok: true });
    } catch (error) {
      console.error('AI Feedback error:', error);
      return err(500, 'Không thể lưu đánh giá');
    }
  }

  // 7. LLMOps Telemetry Logs for RAG Inspector
  if (path === '/api/ai/logs' && request.method === 'GET') {
    try {
      const requestId = url.searchParams.get('request_id');
      if (requestId) {
        const isAdmin = me.role === 'admin';
        const row = await env.DB.prepare(`
          SELECT * FROM ai_generation_logs
           WHERE id = ? AND (user_id = ? OR ? = 1)
        `).bind(requestId, me.id, isAdmin ? 1 : 0).first();
        if (!row) return err(404, 'Không tìm thấy log yêu cầu hoặc bạn không có quyền truy cập');
        return json({ ok: true, log: row });
      }

      const limit = Math.min(50, Number(url.searchParams.get('limit') || 20));
      const { results: logs = [] } = await env.DB.prepare(`
        SELECT id, user_id, provider, model_name, prompt_tokens, completion_tokens,
               estimated_cost_usd, ttft_ms, total_latency_ms, user_rating, created_at
          FROM ai_generation_logs
         WHERE user_id = ? OR ? = 1
         ORDER BY created_at DESC
         LIMIT ?
      `).bind(me.id, me.role === 'admin' ? 1 : 0, limit).all();

      return json({ ok: true, logs });
    } catch (error) {
      console.error('AI Logs error:', error);
      return err(500, 'Không thể tải telemetry logs');
    }
  }

  return null;
}
