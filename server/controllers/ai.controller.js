/**
 * AI Controller - HTTP Endpoints for Copilot, RAG Knowledge & LLMOps Telemetry
 */
import { json, err } from '../lib/response.js';
import { runCopilotTurn } from '../services/agent.service.js';
import { ingestDocument, seedInitialKnowledge } from '../services/rag.service.js';

export async function handleAiRoutes(request, env, me, path, url) {
  // 1. Chat Completion / Copilot Query
  if (path === '/api/ai/chat' && request.method === 'POST') {
    try {
      const body = await request.json();
      const message = String(body.message || '').trim();
      if (!message) return err(400, 'Thiếu nội dung tin nhắn');

      const conversationHistory = Array.isArray(body.history) ? body.history : [];
      const conversationId = body.conversationId || 'default';

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

  // 5. Human-in-the-Loop Action Confirmation (create task or leave request)
  if (path === '/api/ai/actions/confirm' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { actionType, payload } = body;

      if (actionType === 'create_leave_request') {
        const { leaveType, startDate, endDate, reason } = payload || {};
        if (!startDate || !endDate) return err(400, 'Thiếu ngày nghỉ phép');

        const r = await env.DB.prepare(`
          INSERT INTO requests (
            user_id, employee_id, request_type, type, start_date, end_date, reason,
            status, step1_status, step2_status, created_at, updated_at
          ) VALUES (?, ?, 'leave', ?, ?, ?, ?, 'pending', 'pending', 'pending', datetime('now','localtime'), datetime('now','localtime'))
        `).bind(
          me.id,
          me.id,
          leaveType || 'annual',
          startDate,
          endDate,
          reason || 'Được tạo qua Nexrall AI Copilot'
        ).run();

        return json({ ok: true, actionType, requestId: r.meta.last_row_id, message: 'Đã tạo đơn xin nghỉ phép thành công' });
      }

      if (actionType === 'create_task') {
        const { title, description, priority, dueDate } = payload || {};
        if (!title) return err(400, 'Thiếu tiêu đề công việc');

        const r = await env.DB.prepare(`
          INSERT INTO tasks (
            workspace_id, title, description, priority, status, due_date,
            assigned_to, assigned_by, created_by, created_at, updated_at
          ) VALUES (1, ?, ?, ?, 'todo', ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
        `).bind(
          title,
          description || '',
          priority || 'medium',
          dueDate || null,
          me.id,
          me.id,
          me.id
        ).run();

        return json({ ok: true, actionType, taskId: r.meta.last_row_id, message: 'Đã tạo công việc mới thành công' });
      }

      return err(400, `Hành động không hợp lệ: ${actionType}`);
    } catch (error) {
      console.error('Confirm AI action error:', error);
      return err(500, error?.message || 'Lỗi thực thi hành động');
    }
  }

  // 6. User Feedback (Thumbs Up / Down)
  if (path === '/api/ai/feedback' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { requestId, rating, comment } = body;
      if (!requestId) return err(400, 'Thiếu requestId');

      await env.DB.prepare(`
        UPDATE ai_generation_logs
           SET user_rating = ?, feedback_comment = ?
         WHERE id = ?
      `).bind(Number(rating || 0), comment || null, requestId).run();

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
        const row = await env.DB.prepare('SELECT * FROM ai_generation_logs WHERE id = ?').bind(requestId).first();
        if (!row) return err(404, 'Không tìm thấy log yêu cầu');
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
