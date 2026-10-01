/**
 * AI Agent Service - Tool Calling Orchestrator & Copilot Reasoning Engine
 */
import { chatCompletion, logAiInteraction, estimateTokens } from './ai-gateway.service.js';
import { hybridSearch } from './rag.service.js';

/**
 * Tool definitions available to the Copilot
 */
export const COPILOT_TOOLS = [
  {
    name: 'search_policy_knowledge',
    description: 'Tra cứu nội quy lao động, quy định đi muộn, chế độ nghỉ phép, quy trình duyệt đơn và bảo mật công ty.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nội dung hoặc câu hỏi cần tra cứu' },
        category: { type: 'string', enum: ['hr_policy', 'security', 'handbook'], description: 'Danh mục tài liệu' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_my_attendance_summary',
    description: 'Tra cứu thống kê chấm công, số ngày làm việc, số lần đi muộn và tiền phạt trong tháng của bản thân.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần tra cứu dạng YYYY-MM (mặc định tháng hiện tại)' }
      }
    }
  },
  {
    name: 'list_my_tasks',
    description: 'Tra cứu danh sách công việc được giao của tôi theo trạng thái hoặc mức độ ưu tiên.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'todo', 'in-progress', 'done'], description: 'Trạng thái công việc' },
        limit: { type: 'number', description: 'Số lượng task tối đa' }
      }
    }
  },
  {
    name: 'search_employee_directory',
    description: 'Tra cứu thông tin đồng nghiệp: họ tên, mã nhân viên, phòng ban, chức vụ, email.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Tên hoặc mã nhân viên cần tìm' }
      },
      required: ['search']
    }
  },
  {
    name: 'create_leave_request_draft',
    description: 'Soạn thảo đơn xin nghỉ phép (tạo thẻ xác nhận Human-in-the-loop để người dùng duyệt trước khi gửi).',
    parameters: {
      type: 'object',
      properties: {
        leaveType: { type: 'string', enum: ['annual', 'unpaid', 'sick', 'maternity'], description: 'Loại nghỉ phép' },
        startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD' },
        reason: { type: 'string', description: 'Lý do xin nghỉ' }
      },
      required: ['startDate', 'endDate', 'reason']
    }
  },
  {
    name: 'create_task_draft',
    description: 'Soạn thảo công việc mới (tạo thẻ xác nhận để người dùng kiểm tra trước khi thêm vào DB).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tiêu đề công việc' },
        description: { type: 'string', description: 'Mô tả chi tiết' },
        dueDate: { type: 'string', description: 'Hạn hoàn thành YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Mức độ ưu tiên' }
      },
      required: ['title']
    }
  }
];

/**
 * Execute tool call against database
 */
export async function executeTool(env, toolName, args = {}, me) {
  if (!env || !env.DB) return { error: 'Database not available' };

  switch (toolName) {
    case 'search_policy_knowledge': {
      const { query, category } = args;
      const ragRes = await hybridSearch(env, { query, category, limit: 3 });
      return {
        query,
        chunksFound: ragRes.results.length,
        citations: ragRes.citations,
        contextText: ragRes.contextText
      };
    }

    case 'get_my_attendance_summary': {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = args.month || currentMonth;
      const start = `${month}-01`;
      const end = `${month}-31`;

      const rows = await env.DB.prepare(`
        SELECT id, work_date, check_in, check_out, status, is_late, late_minutes, note
          FROM attendance
         WHERE user_id = ? AND work_date >= ? AND work_date <= ?
         ORDER BY work_date ASC
      `).bind(me.id, start, end).all();

      const list = rows.results || [];
      const totalWorked = list.filter(r => r.check_in).length;
      const lateRecords = list.filter(r => r.is_late || Number(r.late_minutes) > 0);
      const lateCount = lateRecords.length;
      const penaltyRecords = lateRecords.filter(r => String(r.note || '').includes('Phạt:'));
      const totalPenaltyVnd = penaltyRecords.length * 20000;

      return {
        month,
        totalDaysWorked: totalWorked,
        lateCount,
        lateFreeCount: Math.min(2, lateCount),
        penaltyCount: penaltyRecords.length,
        totalPenaltyVnd,
        lateDetails: lateRecords.map(r => ({
          date: r.work_date,
          checkIn: r.check_in,
          lateMinutes: r.late_minutes,
          note: r.note
        }))
      };
    }

    case 'list_my_tasks': {
      const statusFilter = args.status && args.status !== 'all' ? args.status : null;
      let sql = `
        SELECT id, title, description, status, priority, due_date
          FROM tasks
         WHERE assigned_to = ?
      `;
      const binds = [me.id];
      if (statusFilter) {
        sql += ' AND status = ?';
        binds.push(statusFilter);
      }
      sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC LIMIT ?";
      binds.push(args.limit || 5);

      const { results = [] } = await env.DB.prepare(sql).bind(...binds).all();
      return { count: results.length, tasks: results };
    }

    case 'search_employee_directory': {
      const kw = `%${String(args.search || '').trim()}%`;
      const { results = [] } = await env.DB.prepare(`
        SELECT id, employee_code, full_name, department, position, email, phone
          FROM users
         WHERE is_active = 1 AND (full_name LIKE ? OR employee_code LIKE ? OR department LIKE ?)
         LIMIT 5
      `).bind(kw, kw, kw).all();
      return { count: results.length, employees: results };
    }

    case 'create_leave_request_draft': {
      // Return confirmation card structure (Action Card for Human-in-the-loop)
      return {
        isActionCard: true,
        actionType: 'create_leave_request',
        title: 'Xác nhận gửi Đơn xin nghỉ phép',
        payload: {
          leaveType: args.leaveType || 'annual',
          leaveTypeLabel: args.leaveType === 'sick' ? 'Nghỉ ốm' : args.leaveType === 'unpaid' ? 'Nghỉ không lương' : 'Nghỉ phép năm',
          startDate: args.startDate,
          endDate: args.endDate,
          reason: args.reason,
          applicantName: me.full_name,
          applicantId: me.id
        }
      };
    }

    case 'create_task_draft': {
      // Return confirmation card structure (Action Card for Human-in-the-loop)
      return {
        isActionCard: true,
        actionType: 'create_task',
        title: 'Xác nhận tạo Công việc mới',
        payload: {
          title: args.title,
          description: args.description || '',
          dueDate: args.dueDate || null,
          priority: args.priority || 'medium',
          assigneeId: me.id,
          assigneeName: me.full_name
        }
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Orchestrate a complete Copilot chat turn with RAG, Tool Execution & Telemetry
 */
export async function runCopilotTurn(env, {
  userMessage,
  conversationHistory = [],
  me,
  conversationId = 'default'
}) {
  const reqStartTime = Date.now();
  const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const query = String(userMessage || '').trim();

  // 1. Step 1: Detect intent & Run Hybrid RAG
  const isPolicyQuery = /muộn|trễ|phạt|giờ làm|quy định|nội quy|nghỉ phép|phép năm|ốm|bảo mật|lương|phúc lợi/i.test(query);
  let ragResult = { results: [], contextText: '', citations: [] };
  if (isPolicyQuery) {
    ragResult = await hybridSearch(env, { query, limit: 3 });
  }

  // 2. Step 2: Detect if user wants personal attendance or task stats
  let toolData = null;
  let toolNameCalled = null;
  let actionCard = null;

  if (/chấm công|đi muộn của tôi|bảng công|tiền phạt của tôi|công tháng/i.test(query)) {
    toolNameCalled = 'get_my_attendance_summary';
    toolData = await executeTool(env, toolNameCalled, {}, me);
  } else if (/task của tôi|công việc của tôi|danh sách task|việc cần làm/i.test(query)) {
    toolNameCalled = 'list_my_tasks';
    toolData = await executeTool(env, toolNameCalled, {}, me);
  } else if (/xin nghỉ phép|tạo đơn nghỉ|đăng ký nghỉ/i.test(query) && /ngày|tháng|lý do/i.test(query)) {
    toolNameCalled = 'create_leave_request_draft';
    const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || [];
    const startDate = dates[0] || new Date().toISOString().slice(0, 10);
    const endDate = dates[1] || startDate;
    toolData = await executeTool(env, toolNameCalled, {
      leaveType: 'annual',
      startDate,
      endDate,
      reason: query
    }, me);
    actionCard = toolData;
  } else if (/tạo task|tạo việc|thêm công việc/i.test(query) && query.length > 10) {
    toolNameCalled = 'create_task_draft';
    const titleMatch = query.replace(/^(tạo task|tạo việc|thêm công việc)\s*:?/i, '').trim();
    toolData = await executeTool(env, toolNameCalled, {
      title: titleMatch || 'Công việc mới từ AI Copilot',
      priority: 'medium'
    }, me);
    actionCard = toolData;
  }

  // 3. Step 3: Build Grounded System Instruction
  let systemPrompt = `Bạn là Nexrall AI Copilot - Trợ lý thông minh cao cấp được tích hợp trong hệ sinh thái quản trị nhân sự & công việc của doanh nghiệp.
Người dùng hiện tại: ${me.full_name} (Mã NV: ${me.employee_code || 'NV'}, Phòng ban: ${me.department || 'Chung'}).

Nguyên tắc phản hồi cốt lõi:
1. Nghiêm túc, súc tích, chuyên nghiệp và có căn cứ rõ ràng. Định dạng Markdown đẹp mắt (dùng bold, list, bullet).
2. Khi trả lời về Nội quy, Quy chế hoặc Pháp lý, BẮT BUỘC phải trích dẫn số hiệu nguồn [1], [2] tương ứng với tài liệu bên dưới.
3. Tuyệt đối KHÔNG tự bịa đặt quy định không có trong tài liệu nguồn. Nếu tài liệu không đề cập, hãy thông báo rõ ràng cho nhân viên và hướng dẫn liên hệ Phòng HCNS.
4. Mốc thời gian làm việc tiêu chuẩn: Bắt đầu 08:30 (Đúng giờ: <= 08:35; Đi muộn: >= 08:36). Đi muộn miễn phạt 2 lần/tháng đầu tiên; từ lần 3 phạt 20.000đ/lần.
`;

  if (ragResult.contextText) {
    systemPrompt += `\n--- TÀI LIỆU TRI THỨC NỘI QUY TRÍCH XUẤT (RAG CONTEXT) ---\n${ragResult.contextText}\n----------------------------------------------------\n`;
  }

  if (toolData && !actionCard) {
    systemPrompt += `\n--- DỮ LIỆU THỰC TẾ HỆ THỐNG TRÍCH XUẤT (TOOL DATA) ---\n${JSON.stringify(toolData, null, 2)}\n----------------------------------------------------\n`;
  }

  // 4. Step 4: Run Inference via AI Gateway
  const chatMessages = [
    ...conversationHistory.slice(-4),
    { role: 'user', content: query }
  ];

  const completion = await chatCompletion(env, {
    messages: chatMessages,
    systemPrompt,
    temperature: 0.2,
    maxTokens: 1200
  });

  const totalTimeMs = Date.now() - reqStartTime;

  // 5. Step 5: Save Telemetry Log to Database (LLMOps)
  await logAiInteraction(env, {
    id: reqId,
    userId: me.id,
    conversationId,
    sessionRole: me.role || 'employee',
    queryText: query,
    responseText: completion.content,
    provider: completion.provider,
    modelName: completion.model,
    promptTokens: completion.tokens.prompt,
    completionTokens: completion.tokens.completion,
    estimatedCostUsd: completion.cost.costUsd,
    ttftMs: Math.round(totalTimeMs * 0.4),
    totalLatencyMs: totalTimeMs,
    retrievedChunksJson: ragResult.results.map(r => ({
      docTitle: r.docTitle,
      section: r.section,
      vectorScore: Number(r.vectorScore.toFixed(3)),
      keywordScore: Number(r.keywordScore.toFixed(3)),
      combinedScore: Number(r.combinedScore.toFixed(4))
    })),
    toolsCalledJson: toolNameCalled ? [{ name: toolNameCalled, args: toolData }] : null
  });

  return {
    requestId: reqId,
    content: completion.content,
    citations: ragResult.citations,
    actionCard,
    telemetry: {
      provider: completion.provider,
      model: completion.model,
      tokens: completion.tokens,
      cost: completion.cost,
      latencyMs: totalTimeMs,
      retrievedChunkCount: ragResult.results.length
    }
  };
}
