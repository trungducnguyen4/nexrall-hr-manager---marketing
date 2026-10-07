/**
 * AI Agent Service - Tool Calling Orchestrator & Copilot Reasoning Engine
 */
import { chatCompletion, chatCompletionStream, streamPacedText, logAiInteraction, estimateTokens, maskPII } from './ai-gateway.service.js';
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
    name: 'get_my_payslip_summary',
    description: 'Tra cứu bảng lương cá nhân, thu nhập thực nhận, chi tiết lương cơ bản, ngày công, thưởng KPI, phụ cấp, giảm trừ/phạt muộn, bảo hiểm và thuế.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần tra cứu dạng YYYY-MM (ví dụ 2026-08)' }
      }
    }
  },
  {
    name: 'audit_payroll_anomalies',
    description: 'Kiểm toán AI tự động phát hiện các bất thường bảng lương: lệch ngày công so với chấm công, đi muộn chưa trừ phạt, sai sót lương/OT (chỉ dành cho Admin/HCNS).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần kiểm toán dạng YYYY-MM' }
      }
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
  },
  {
    name: 'get_announcements_summary',
    description: 'Tra cứu danh sách các thông báo, quyết định nội bộ công ty mới nhất.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Số lượng thông báo tối đa (mặc định 5)' }
      }
    }
  },
  {
    name: 'get_leave_balance',
    description: 'Tra cứu số ngày phép năm còn lại, hạn mức phép năm của bản thân.',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'Năm tra cứu (mặc định năm hiện tại)' }
      }
    }
  },
  {
    name: 'get_system_module_info',
    description: 'Tra cứu thông tin, hướng dẫn thao tác, quy trình nghiệp vụ cho bất kỳ phân hệ nào trong 12 module của hệ thống.',
    parameters: {
      type: 'object',
      properties: {
        moduleName: { type: 'string', description: 'Tên phân hệ (dashboard, announcements, chat, attendance, leave, tasks, invoices, handover, employees, payroll, locations, settings)' }
      },
      required: ['moduleName']
    }
  },
  {
    name: 'task_update_status',
    description: 'Cập nhật trạng thái công việc (todo, in-progress, done, cancelled).',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'done', 'cancelled'], description: 'Trạng thái mới' }
      },
      required: ['taskId', 'status']
    }
  },
  {
    name: 'task_assign',
    description: 'Phân công công việc cho nhân viên khác.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' },
        assigneeName: { type: 'string', description: 'Tên hoặc mã nhân viên người nhận việc' }
      },
      required: ['taskId', 'assigneeName']
    }
  },
  {
    name: 'task_update_details',
    description: 'Cập nhật hạn chót (due date) hoặc mức độ ưu tiên của công việc.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' },
        dueDate: { type: 'string', description: 'Hạn hoàn thành YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Mức độ ưu tiên' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'task_delete',
    description: 'Xóa công việc khỏi hệ thống (cần xác nhận).',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'leave_approve',
    description: 'Phê duyệt đơn xin nghỉ phép (dành cho Quản lý / HCNS / Phó TGĐ / Admin).',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'number', description: 'ID của đơn xin nghỉ phép' },
        note: { type: 'string', description: 'Ghi chú phê duyệt' }
      },
      required: ['requestId']
    }
  },
  {
    name: 'leave_reject',
    description: 'Từ chối đơn xin nghỉ phép kèm lý do (dành cho Quản lý / HCNS / Admin).',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'number', description: 'ID của đơn xin nghỉ phép' },
        reason: { type: 'string', description: 'Lý do từ chối' }
      },
      required: ['requestId']
    }
  },
  {
    name: 'leave_cancel',
    description: 'Hủy đơn xin nghỉ phép đang chờ duyệt của chính mình.',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'number', description: 'ID của đơn xin nghỉ phép' }
      },
      required: ['requestId']
    }
  },
  {
    name: 'announcement_post',
    description: 'Đăng thông báo nội bộ mới (dành cho Admin / HCNS).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tiêu đề thông báo' },
        content: { type: 'string', description: 'Nội dung thông báo' },
        priority: { type: 'string', enum: ['normal', 'important'], description: 'Mức độ quan trọng' },
        targetScope: { type: 'string', enum: ['all', 'department'], description: 'Phạm vi gửi' },
        targetDepartment: { type: 'string', description: 'Phòng ban nhận thông báo nếu scope là department' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'employee_update_code',
    description: 'Đổi mã nhân viên cho nhân sự (chỉ dành cho Admin).',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'number', description: 'ID nhân sự' },
        employeeCode: { type: 'string', description: 'Mã nhân viên mới' }
      },
      required: ['userId', 'employeeCode']
    }
  },
  {
    name: 'payroll_request_review',
    description: 'Gửi yêu cầu giải trình / kiểm tra lại phiếu lương tháng của bản thân tới HCNS.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần xem lại YYYY-MM' },
        message: { type: 'string', description: 'Nội dung thắc mắc / khiếu nại' }
      },
      required: ['month', 'message']
    }
  },
  {
    name: 'handover_create',
    description: 'Tạo phiếu bàn giao tài sản, tài khoản hoặc dự án.',
    parameters: {
      type: 'object',
      properties: {
        assetName: { type: 'string', description: 'Tên tài sản / dự án bàn giao' },
        assetType: { type: 'string', description: 'Loại tài sản' },
        receiverName: { type: 'string', description: 'Người nhận bàn giao' }
      },
      required: ['assetName']
    }
  },
  {
    name: 'handover_confirm',
    description: 'Xác nhận hoàn tất đã nhận bàn giao.',
    parameters: {
      type: 'object',
      properties: {
        handoverId: { type: 'number', description: 'ID của mục bàn giao' }
      },
      required: ['handoverId']
    }
  },
  {
    name: 'get_leave_requests_overview',
    description: 'Thống kê tổng quan và phân tích dữ liệu các đơn xin nghỉ phép thực tế trong hệ thống: lý do nghỉ phép của mọi người, số lượng theo nhóm lý do, trạng thái duyệt.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng lọc YYYY-MM hoặc all' },
        status: { type: 'string', enum: ['all', 'pending', 'approved', 'rejected'], description: 'Trạng thái đơn' }
      }
    }
  }
];

/**
 * RBAC Helper for Agent Execution
 */
export function checkRolePermissions(me) {
  const role = String(me?.role || '').toLowerCase();
  const dept = String(me?.department || '').toLowerCase();
  const code = String(me?.employee_code || '').toUpperCase();
  const isAdmin = role === 'admin' || code === 'BGD-01' || code === 'BGD-02';
  const isHcns = isAdmin || dept.includes('hcns') || dept.includes('hành chính');
  const isManager = isAdmin || isHcns || role === 'manager';
  return { isAdmin, isHcns, isManager };
}

/**
 * Safe broadcast wrapper for live UI sync
 */
export async function safeBroadcast(env, topic, event, payload = {}, options = {}) {
  const syncHubBinding = env?.SYNC_HUB || env?.APP_SYNC_HUB;
  if (!syncHubBinding) return;
  try {
    const id = syncHubBinding.idFromName('global');
    const stub = syncHubBinding.get(id);
    await stub.fetch('http://sync-hub/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        event,
        payload,
        actorId: options.actorId || null,
        timestamp: new Date().toISOString()
      })
    });
  } catch (err) {
    console.warn('[safeBroadcast] Notification broadcast failed:', err?.message);
  }
}

/**
 * Parse relative Vietnamese dates to YYYY-MM-DD
 */
export function parseRelativeDate(text, fallback = null) {
  if (!text) return fallback;
  const s = String(text).toLowerCase().trim();
  const now = new Date();

  if (s.includes('hôm nay')) {
    return now.toISOString().slice(0, 10);
  }
  if (s.includes('ngày mai') || s.includes('mai')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (s.includes('ngày kia') || s.includes('mốt')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }
  const isNextWeek = s.includes('tuần sau') || s.includes('tuần tới');
  const dayMatch = s.match(/(?:thứ|t)\s*([2-7]|hai|ba|tư|bốn|năm|sáu|bảy)|chủ\s*nhật|cn/i);
  if (dayMatch) {
    let targetDay = 1;
    const val = dayMatch[0].toLowerCase();
    if (val.includes('2') || val.includes('hai')) targetDay = 1;
    else if (val.includes('3') || val.includes('ba')) targetDay = 2;
    else if (val.includes('4') || val.includes('tư') || val.includes('bốn')) targetDay = 3;
    else if (val.includes('5') || val.includes('năm')) targetDay = 4;
    else if (val.includes('6') || val.includes('sáu')) targetDay = 5;
    else if (val.includes('7') || val.includes('bảy')) targetDay = 6;
    else if (val.includes('chủ nhật') || val.includes('cn')) targetDay = 0;

    const currentDay = now.getDay();
    let diff = targetDay - currentDay;
    if (isNextWeek) {
      diff += 7;
    } else if (diff <= 0) {
      diff += 7;
    }
    const d = new Date(now);
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  if (s.includes('cuối tháng')) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  }
  const ymd = s.match(/\b(202\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (ymd) return ymd[0];
  const dmy = s.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])(?:[\/\-](202\d))?\b/);
  if (dmy) {
    const day = String(dmy[1]).padStart(2, '0');
    const mon = String(dmy[2]).padStart(2, '0');
    const yr = dmy[3] || now.getFullYear();
    return `${yr}-${mon}-${day}`;
  }

  return fallback || now.toISOString().slice(0, 10);
}

/**
 * Fuzzy resolve user by name, code or ID
 */
export async function resolveUser(env, nameOrCode) {
  if (!nameOrCode || !env?.DB) return null;
  const kw = String(nameOrCode).trim();
  if (/^\d+$/.test(kw)) {
    const byId = await env.DB.prepare('SELECT id, full_name, employee_code, department, role FROM users WHERE id = ?').bind(Number(kw)).first();
    if (byId) return byId;
  }
  const byCode = await env.DB.prepare('SELECT id, full_name, employee_code, department, role FROM users WHERE UPPER(employee_code) = UPPER(?)').bind(kw).first();
  if (byCode) return byCode;

  const byName = await env.DB.prepare('SELECT id, full_name, employee_code, department, role FROM users WHERE is_active = 1 AND full_name LIKE ? ORDER BY id ASC LIMIT 1').bind(`%${kw}%`).first();
  return byName || null;
}

/**
 * Resolve task by ID or title substring
 */
export async function resolveTask(env, ref, me) {
  if (!ref || !env?.DB) return null;
  const kw = String(ref).trim();
  const idMatch = kw.match(/#?(\d+)/);
  if (idMatch) {
    const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(Number(idMatch[1])).first();
    if (task) return task;
  }
  const cleanTitle = kw.replace(/^(task|công việc|nhiệm vụ)\s*/i, '').trim();
  if (cleanTitle) {
    const task = await env.DB.prepare('SELECT * FROM tasks WHERE title LIKE ? ORDER BY id DESC LIMIT 1').bind(`%${cleanTitle}%`).first();
    if (task) return task;
  }
  return null;
}

/**
 * Strict Tool-Layer Authorization Boundary (P1.2, P1.3)
 * Decouples permission enforcement from the LLM prompt.
 * Prevents prompt injection from accessing unauthorized data or executing privileged actions.
 */
export function verifyToolAuthorization(toolName, args = {}, me = {}) {
  const isPrivileged = me.role === 'admin' || (me.department && /HCNS|Hành chính/i.test(me.department));
  const isManager = me.role === 'manager';

  // 1. Payroll audit & anomaly detection: Strict Admin/HCNS only
  if (toolName === 'audit_payroll_anomalies' || toolName === 'payroll_audit') {
    if (!isPrivileged) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: 'Quyền truy cập bị từ chối: Chức năng Kiểm toán Bảng lương AI chỉ dành riêng cho Quản trị viên và Ban HCNS.'
      };
    }
  }

  // 2. Payslip lookup: Self-only unless Admin/HCNS
  if (toolName === 'get_my_payslip_summary') {
    if (args.userId && Number(args.userId) !== Number(me.id) && !isPrivileged) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: 'Bảo mật thông tin: Bạn chỉ được phép tra cứu bảng lương của chính bản thân mình.'
      };
    }
  }

  // 3. Leave approvals: Privileged or Manager only
  if (toolName === 'leave_approve' || toolName === 'leave_reject') {
    if (!isPrivileged && !isManager) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: 'Bạn không có quyền phê duyệt hoặc từ chối đơn xin nghỉ phép này.'
      };
    }
  }

  // 4. Employee code modification: Admin only
  if (toolName === 'employee_update_code') {
    if (me.role !== 'admin') {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: 'Chỉ Quản trị viên hệ thống mới có quyền sửa đổi Mã nhân viên.'
      };
    }
  }

  return { allowed: true };
}

/**
 * Citation Grounding & Anti-Hallucination Verification (P1.4)
 * Ensures any citation tag [1], [2] in LLM output actually maps to an authentic retrieved chunk.
 */
export function verifyAndCleanCitations(text, validCitations = []) {
  if (!text) return '';
  const validIndices = new Set((validCitations || []).map(c => c.index));
  return text.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10);
    return validIndices.has(idx) ? match : '';
  });
}

/**
 * Execute tool call against database
 */
export async function executeTool(env, toolName, args = {}, me) {
  if (!env || !env.DB) return { error: 'Database not available' };

  // Tool-level authorization check
  const auth = verifyToolAuthorization(toolName, args, me);
  if (!auth.allowed) {
    return { error: auth.error, message: auth.message, executed: false };
  }

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

    case 'get_my_payslip_summary': {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let month = args.month || currentMonth;
      if (/^\d{1,2}$/.test(month)) {
        month = `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
      } else if (!/^\d{4}-\d{2}$/.test(month)) {
        month = currentMonth;
      }

      // Security: Strictly enforce user_id = me.id
      const targetUserId = me.id;

      // 1. Query payroll table
      const payrollRow = await env.DB.prepare(`
        SELECT * FROM payroll
         WHERE (employee_id = ? OR user_id = ?) AND month = ?
         ORDER BY id DESC LIMIT 1
      `).bind(targetUserId, String(targetUserId), month).first();

      // 2. Query batch status
      const batchRow = await env.DB.prepare(`
        SELECT status, total_employees, complete_employees FROM payroll_batches WHERE month = ? LIMIT 1
      `).bind(month).first();

      // 3. Fallback: Query invoices if payroll row not found
      let invoiceRow = null;
      if (!payrollRow) {
        const [y, m] = month.split('-');
        invoiceRow = await env.DB.prepare(`
          SELECT * FROM invoices WHERE user_id = ? AND month = ? AND year = ? LIMIT 1
        `).bind(targetUserId, parseInt(m), parseInt(y)).first();
      }

      if (!payrollRow && !invoiceRow) {
        return {
          found: false,
          month,
          employeeName: me.full_name,
          employeeCode: me.employee_code || 'NV',
          message: `Không tìm thấy dữ liệu bảng lương tháng ${month} của bạn trên hệ thống. Có thể kỳ lương này chưa được tạo hoặc phòng HCNS chưa khởi tạo dữ liệu.`
        };
      }

      const batchStatus = String(batchRow?.status || (invoiceRow ? 'published' : 'draft')).toLowerCase();
      const isOfficial = ['published', 'locked', 'paid'].includes(batchStatus);

      const baseSalary = Number(payrollRow?.base_salary || invoiceRow?.base_salary || me.salary || 0);
      const workDays = Number(payrollRow?.work_days || 0);
      const standardDays = Number(payrollRow?.standard_days || 22);
      const kpiBonus = Number(payrollRow?.kpi_bonus || invoiceRow?.bonus || 0);
      const allowance = Number(payrollRow?.allowance || payrollRow?.total_allowance || invoiceRow?.allowance || 0);
      const overtimePay = Number(payrollRow?.overtime_pay || payrollRow?.ot_total_income || invoiceRow?.overtime_pay || 0);
      const deduction = Number(payrollRow?.deduction || payrollRow?.arrears_deduction || invoiceRow?.deduction || 0);
      const insurance = Number(payrollRow?.insurance || (Number(payrollRow?.insurance_social || 0) + Number(payrollRow?.insurance_health || 0) + Number(payrollRow?.insurance_unemployment || 0)) || invoiceRow?.insurance || 0);
      const tax = Number(payrollRow?.tax || payrollRow?.tax_withheld || invoiceRow?.tax || 0);
      const netSalary = Number(payrollRow?.net_salary || payrollRow?.transfer_amount || invoiceRow?.net_salary || (baseSalary + kpiBonus + allowance + overtimePay - deduction - insurance - tax));
      const transferStatus = payrollRow?.transfer_status || invoiceRow?.status || (netSalary > 0 && isOfficial ? 'Chờ chuyển khoản' : 'Tạm tính');

      return {
        found: true,
        month,
        employeeName: me.full_name,
        employeeCode: me.employee_code || 'NV',
        department: me.department || 'Chung',
        batchStatus,
        isOfficial,
        statusNote: isOfficial 
          ? 'Bảng lương chính thức đã được Phòng HCNS phê duyệt.' 
          : `Bảng lương tháng ${month} hiện đang ở trạng thái TẠM TÍNH (Draft) và đang được Phòng HCNS xử lý, chưa công bố chính thức.`,
        financialSummary: {
          baseSalaryVnd: baseSalary,
          workDays: `${workDays}/${standardDays}`,
          kpiBonusVnd: kpiBonus,
          allowanceVnd: allowance,
          overtimePayVnd: overtimePay,
          deductionVnd: deduction,
          insuranceVnd: insurance,
          taxVnd: tax,
          netSalaryVnd: netSalary,
          transferStatus
        }
      };
    }

    case 'audit_payroll_anomalies': {
      const isPrivileged = me.role === 'admin' || (me.department && /HCNS|Hành chính/i.test(me.department));
      if (!isPrivileged) {
        return {
          error: 'PERMISSION_DENIED',
          message: 'Chức năng Kiểm toán Bảng lương AI (AI Payroll Anomaly & Audit) chỉ dành riêng cho Quản trị viên và Ban HCNS.'
        };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let month = args.month || currentMonth;
      if (/^\d{1,2}$/.test(month)) {
        month = `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
      }

      const start = `${month}-01`;
      const end = `${month}-31`;

      // 1. Fetch payroll rows
      const payrollList = await env.DB.prepare(`
        SELECT p.*, u.full_name as u_name, u.employee_code as u_code, u.department as u_dept
          FROM payroll p
          LEFT JOIN users u ON u.id = p.employee_id
         WHERE p.month = ?
      `).bind(month).all();
      const payrollRows = payrollList.results || [];

      // 2. Fetch attendance aggregated
      const attMap = new Map();
      try {
        const attList = await env.DB.prepare(`
          SELECT user_id,
                 COUNT(*) as total_days,
                 SUM(CASE WHEN checkin_time IS NOT NULL THEN 1 ELSE 0 END) as checked_in_days,
                 SUM(CASE WHEN COALESCE(late_minutes, 0) > 0 THEN 1 ELSE 0 END) as late_count
            FROM attendance
           WHERE date >= ? AND date <= ?
           GROUP BY user_id
        `).bind(start, end).all();
        (attList.results || []).forEach(a => attMap.set(Number(a.user_id), a));
      } catch (err) {
        try {
          const attList = await env.DB.prepare(`
            SELECT user_id,
                   COUNT(*) as total_days,
                   SUM(CASE WHEN check_in IS NOT NULL THEN 1 ELSE 0 END) as checked_in_days,
                   SUM(CASE WHEN is_late = 1 OR COALESCE(late_minutes, 0) > 0 THEN 1 ELSE 0 END) as late_count
              FROM attendance
             WHERE work_date >= ? AND work_date <= ?
             GROUP BY user_id
          `).bind(start, end).all();
          (attList.results || []).forEach(a => attMap.set(Number(a.user_id), a));
        } catch (innerErr) {
          console.error('[audit_payroll_anomalies] Error fetching attendance:', innerErr);
        }
      }

      const anomalies = [];

      for (const p of payrollRows) {
        const empId = Number(p.employee_id || p.user_id);
        const empName = p.u_name || p.employee_name || `NV #${empId}`;
        const empCode = p.u_code || p.employee_code || '';
        const att = attMap.get(empId) || { checked_in_days: 0, late_count: 0 };

        // Anomaly 1: Days mismatch (work_days vs checked_in_days)
        const pDays = Number(p.work_days || 0);
        const aDays = Number(att.checked_in_days || 0);
        if (pDays > 0 && Math.abs(pDays - aDays) >= 2) {
          anomalies.push({
            severity: 'HIGH',
            type: 'DAYS_MISMATCH',
            employeeName: empName,
            employeeCode: empCode,
            issue: `Lệch ngày công: Bảng lương tính ${pDays} công, nhưng chấm công thực tế chỉ có ${aDays} ngày check-in (chênh ${Math.abs(pDays - aDays)} ngày).`,
            recommendation: 'Kiểm tra lại đơn xin nghỉ phép đã duyệt hoặc bổ sung công cho nhân viên.'
          });
        }

        // Anomaly 2: Late penalty not deducted (late_count >= 3 but deduction == 0)
        const lateCount = Number(att.late_count || 0);
        const deduction = Number(p.deduction || 0);
        if (lateCount >= 3 && deduction === 0) {
          const expectedFine = (lateCount - 2) * 20000;
          anomalies.push({
            severity: 'MEDIUM',
            type: 'UNPROCESSED_PENALTY',
            employeeName: empName,
            employeeCode: empCode,
            issue: `Đi muộn ${lateCount} lần trong tháng (vượt hạn mức 2 lần miễn phạt). Tiền phạt quy định là ${expectedFine.toLocaleString('vi-VN')} đ nhưng cột giảm trừ đang là 0 đ.`,
            recommendation: `Cập nhật trừ phạt ${expectedFine.toLocaleString('vi-VN')} đ vào bảng lương hoặc xác nhận lý do miễn trừ hợp lệ.`
          });
        }

        // Anomaly 3: Base salary is zero or missing
        if (Number(p.base_salary || 0) === 0 && Number(p.net_salary || 0) === 0) {
          anomalies.push({
            severity: 'LOW',
            type: 'ZERO_SALARY',
            employeeName: empName,
            employeeCode: empCode,
            issue: 'Lương cơ bản và thực nhận bằng 0 đ.',
            recommendation: 'Cấu hình lại mức lương hoặc kiểm tra trạng thái hợp đồng nhân viên.'
          });
        }
      }

      return {
        month,
        totalAudited: payrollRows.length,
        anomalyCount: anomalies.length,
        highRiskCount: anomalies.filter(a => a.severity === 'HIGH').length,
        anomalies: anomalies.slice(0, 15),
        summary: `Hệ thống AI đã kiểm toán ${payrollRows.length} nhân viên trong kỳ lương ${month}. Phát hiện ${anomalies.length} điểm bất thường (${anomalies.filter(a => a.severity === 'HIGH').length} mức độ cao).`
      };
    }

    case 'get_my_attendance_summary': {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = args.month || currentMonth;
      const start = `${month}-01`;
      const end = `${month}-31`;

      let list = [];
      try {
        // 1. Try production schema: date, checkin_time, checkout_time, late_minutes, note
        const rows = await env.DB.prepare(`
          SELECT id, date, checkin_time, checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
            FROM attendance
           WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
             AND date >= ? AND date <= ?
           ORDER BY date ASC
        `).bind(me.id, String(me.id), start, end).all();
        list = (rows.results || []).map(r => ({
          id: r.id,
          date: r.date,
          checkIn: r.checkin_time,
          checkOut: r.checkout_time,
          status: r.status,
          isLate: Number(r.late_minutes) > 0,
          lateMinutes: Number(r.late_minutes || 0),
          note: r.note
        }));
      } catch (err) {
        // 2. Fallback to mock/legacy schema: work_date, check_in, check_out, is_late
        try {
          const rows = await env.DB.prepare(`
            SELECT id, work_date as date, check_in as checkin_time, check_out as checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
              FROM attendance
             WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
               AND work_date >= ? AND work_date <= ?
             ORDER BY work_date ASC
          `).bind(me.id, String(me.id), start, end).all();
          list = (rows.results || []).map(r => ({
            id: r.id,
            date: r.date,
            checkIn: r.checkin_time,
            checkOut: r.checkout_time,
            status: r.status,
            isLate: Number(r.late_minutes) > 0,
            lateMinutes: Number(r.late_minutes || 0),
            note: r.note
          }));
        } catch (innerErr) {
          console.error('[get_my_attendance_summary] Error querying attendance:', innerErr);
        }
      }

      const totalWorked = list.filter(r => r.checkIn).length;
      const lateRecords = list.filter(r => r.isLate || Number(r.lateMinutes) > 0);
      const lateCount = lateRecords.length;
      const penaltyRecords = lateRecords.filter(r => String(r.note || '').includes('Phạt:') || String(r.note || '').includes('20.000'));
      const totalPenaltyVnd = Math.max(0, lateCount - 2) * 20000;

      return {
        month,
        totalDaysWorked: totalWorked,
        lateCount,
        lateFreeCount: Math.min(2, lateCount),
        penaltyCount: Math.max(0, lateCount - 2),
        totalPenaltyVnd,
        lateDetails: lateRecords.map(r => ({
          date: r.date,
          checkIn: r.checkIn,
          lateMinutes: r.lateMinutes,
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

    case 'get_announcements_summary': {
      try {
        const limit = args.limit || 5;
        const { results = [] } = await env.DB.prepare(`
          SELECT id, title, content, priority, target_scope, created_at
            FROM announcements
           ORDER BY id DESC LIMIT ?
        `).bind(limit).all();
        return {
          count: results.length,
          announcements: results.map(a => ({
            id: a.id,
            title: a.title,
            preview: a.content ? a.content.slice(0, 150) + (a.content.length > 150 ? '...' : '') : '',
            priority: a.priority || 'normal',
            createdAt: a.created_at
          }))
        };
      } catch (err) {
        return { count: 0, announcements: [] };
      }
    }

    case 'get_leave_balance': {
      try {
        const curYear = args.year || new Date().getFullYear();
        const row = await env.DB.prepare(`
          SELECT * FROM leave_balances WHERE user_id = ? AND balance_year = ? LIMIT 1
        `).bind(me.id, curYear).first();

        // Count approved leaves
        let usedDays = 0;
        try {
          const usedRow = await env.DB.prepare(`
            SELECT COUNT(*) as used_count
              FROM requests
             WHERE user_id = ? AND status = 'approved' AND (type = 'leave' OR request_type = 'leave')
          `).bind(me.id).first();
          usedDays = Number(usedRow?.used_count || 0);
        } catch (_) {}

        const availableDays = row ? Number(row.available_days || 0) : 12;
        const remainingDays = Math.max(0, availableDays - usedDays);

        return {
          employeeName: me.full_name,
          year: curYear,
          annualLeaveTotal: availableDays,
          annualLeaveUsed: usedDays,
          annualLeaveRemaining: remainingDays,
          note: 'Quy chế công ty: 12 ngày phép/năm (1 ngày/tháng). Nghỉ phép cần duyệt 2 bước (Quản lý -> HCNS).'
        };
      } catch (err) {
        return {
          employeeName: me.full_name,
          year: new Date().getFullYear(),
          annualLeaveTotal: 12,
          annualLeaveUsed: 0,
          annualLeaveRemaining: 12,
          note: 'Tiêu chuẩn phép năm: 12 ngày/năm.'
        };
      }
    }

    case 'get_leave_requests_overview': {
      let rows = [];
      try {
        // 1. Query leave_requests table
        let query = `
          SELECT lr.id, lr.start_date, lr.end_date, lr.reason, lr.status, lr.type,
                 COALESCE(u.full_name, 'Nhân sự') as employee_name,
                 u.department, u.employee_code
            FROM leave_requests lr
            LEFT JOIN users u ON (CAST(lr.user_id AS TEXT) = CAST(u.id AS TEXT) OR lr.user_id = u.employee_code OR lr.employee_id = u.id)
           WHERE 1=1
        `;
        const binds = [];
        if (args.status && args.status !== 'all') {
          query += ' AND lr.status = ?';
          binds.push(args.status);
        }
        if (args.month && args.month !== 'all') {
          query += ' AND (lr.start_date LIKE ? OR lr.end_date LIKE ?)';
          binds.push(`${args.month}%`, `${args.month}%`);
        }
        query += ' ORDER BY lr.id DESC LIMIT 50';
        const res = await env.DB.prepare(query).bind(...binds).all();
        rows = res.results || [];
      } catch (err) {
        // 2. Fallback to requests table
        try {
          let query = `
            SELECT r.id, r.start_date, r.end_date, r.reason, r.status, COALESCE(r.type, r.request_type) as type,
                   COALESCE(u.full_name, 'Nhân sự') as employee_name,
                   u.department, u.employee_code
              FROM requests r
              LEFT JOIN users u ON (CAST(r.user_id AS TEXT) = CAST(u.id AS TEXT) OR r.employee_id = u.id)
             WHERE (r.type = 'leave' OR r.request_type = 'leave')
          `;
          const binds = [];
          if (args.status && args.status !== 'all') {
            query += ' AND r.status = ?';
            binds.push(args.status);
          }
          if (args.month && args.month !== 'all') {
            query += ' AND (r.start_date LIKE ? OR r.end_date LIKE ?)';
            binds.push(`${args.month}%`, `${args.month}%`);
          }
          query += ' ORDER BY r.id DESC LIMIT 50';
          const res = await env.DB.prepare(query).bind(...binds).all();
          rows = res.results || [];
        } catch (_) {}
      }

      if (rows.length === 0) {
        return {
          totalCount: 0,
          summary: 'Hệ thống hiện tại chưa ghi nhận đơn xin nghỉ phép nào trong cơ sở dữ liệu.',
          requests: [],
          categories: {}
        };
      }

      // Group by reason categories
      const categories = {
        'Việc gia đình & Việc riêng': [],
        'Nghỉ ốm & Khám chữa bệnh': [],
        'Du lịch, Về quê & Nghỉ ngơi': [],
        'Nghỉ phép năm & Lý do khác': []
      };

      for (const r of rows) {
        const text = String(r.reason || '').toLowerCase();
        const item = {
          id: r.id,
          employee: r.employee_name,
          department: r.department || 'Chung',
          dates: `${r.start_date} → ${r.end_date}`,
          reason: r.reason || 'Nghỉ phép thường',
          status: r.status === 'approved' ? 'Đã duyệt' : r.status === 'pending' ? 'Chờ duyệt' : 'Từ chối'
        };

        if (/gia đình|việc nhà|việc riêng|con|bố|mẹ|vợ|chồng|cưới|đám|hỷ/i.test(text)) {
          categories['Việc gia đình & Việc riêng'].push(item);
        } else if (/ốm|sốt|bệnh|viện|khám|mệt|sức khỏe|tai nạn|thai/i.test(text)) {
          categories['Nghỉ ốm & Khám chữa bệnh'].push(item);
        } else if (/du lịch|về quê|nghỉ mát|tour|chơi|thăm quê/i.test(text)) {
          categories['Du lịch, Về quê & Nghỉ ngơi'].push(item);
        } else {
          categories['Nghỉ phép năm & Lý do khác'].push(item);
        }
      }

      const statusCounts = {
        approved: rows.filter(r => r.status === 'approved').length,
        pending: rows.filter(r => r.status === 'pending' || r.status === 'pending_director').length,
        rejected: rows.filter(r => r.status === 'rejected').length
      };

      return {
        totalRequests: rows.length,
        statusCounts,
        categoriesCount: {
          familyAndPersonal: categories['Việc gia đình & Việc riêng'].length,
          sickAndHealth: categories['Nghỉ ốm & Khám chữa bệnh'].length,
          travelAndHomecoming: categories['Du lịch, Về quê & Nghỉ ngơi'].length,
          annualAndOther: categories['Nghỉ phép năm & Lý do khác'].length
        },
        sampleReasonsByCategory: {
          'Việc gia đình & Việc riêng': categories['Việc gia đình & Việc riêng'].slice(0, 5),
          'Nghỉ ốm & Khám chữa bệnh': categories['Nghỉ ốm & Khám chữa bệnh'].slice(0, 5),
          'Du lịch, Về quê & Nghỉ ngơi': categories['Du lịch, Về quê & Nghỉ ngơi'].slice(0, 5),
          'Nghỉ phép năm & Lý do khác': categories['Nghỉ phép năm & Lý do khác'].slice(0, 5)
        },
        recentRequests: rows.slice(0, 10).map(r => ({
          id: r.id,
          employee: r.employee_name,
          department: r.department,
          reason: r.reason,
          dates: `${r.start_date} → ${r.end_date}`,
          status: r.status
        }))
      };
    }

    case 'get_system_module_info': {
      const mod = String(args.moduleName || '').toLowerCase();
      const guides = {
        dashboard: {
          name: 'Dashboard (Tổng quan)',
          menuPath: '#/dashboard',
          features: ['Biểu đồ nhân sự toàn diện', 'Tỷ lệ chấm công đúng giờ / đi muộn hôm nay', 'Danh sách task ưu tiên cần xử lý', 'Lịch sinh nhật và sự kiện công ty trong tháng']
        },
        announcements: {
          name: 'Thông báo (Announcements)',
          menuPath: '#/announcements',
          features: ['Đăng tải và tiếp nhận tin tức, quyết định ban giám đốc', 'Tải tệp đính kèm tài liệu, thông tư', 'Theo dõi danh sách nhân sự đã đọc thông báo']
        },
        chat: {
          name: 'Chat nội bộ',
          menuPath: '#/chat',
          features: ['Kênh thảo luận thời gian thực WebSocket / Durable Object', 'Kênh chat chung toàn công ty và phòng chat riêng theo phòng ban', 'Bình chọn (Poll), ghim tin nhắn, nhắc tên @mention']
        },
        attendance: {
          name: 'Chấm công',
          menuPath: '#/attendance',
          features: ['Check-in / Check-out xác thực GPS geofence văn phòng và WiFi Whitelist', 'Giờ làm việc 08:30 - 17:00 (mốc 08:35 đúng giờ, từ 08:36 tính đi muộn)', 'Miễn phạt 2 lần/tháng đầu tiên, từ lần 3 phạt 20.000đ/lần', 'Tự động checkout hệ thống lúc 17:05 UTC']
        },
        leave: {
          name: 'Nghỉ phép',
          menuPath: '#/leave',
          features: ['Nộp đơn xin nghỉ phép trực tuyến', 'Quy trình phê duyệt 2 bước: Bước 1 (Quản lý trực tiếp) -> Bước 2 (Phòng HCNS duyệt cuối)', 'Quản lý quỹ ngày phép năm (12 ngày/năm), nghỉ ốm, nghỉ không lương']
        },
        tasks: {
          name: 'Công việc (Tasks)',
          menuPath: '#/tasks',
          features: ['Quản lý công việc cá nhân và dự án theo bảng Kanban hoặc Danh sách', 'Gắn nhãn độ ưu tiên (low, medium, high, urgent), hạn chót (due date)', 'Giao việc cho đồng nghiệp, đính kèm tệp và cập nhật tiến độ']
        },
        invoices: {
          name: 'Phiếu lương (Cá nhân)',
          menuPath: '#/invoices',
          features: ['Tra cứu chi tiết phiếu lương cá nhân từng tháng: Lương cơ bản, ngày công thực tế, thưởng KPI, phụ cấp, giảm trừ phạt đi muộn, BHXH, thuế TNCN, thực nhận (Net)', 'Xác nhận phiếu lương hoặc gửi yêu cầu xem lại (Review request) nếu có thắc mắc']
        },
        handover: {
          name: 'Bàn giao dự án & tài khoản',
          menuPath: '#/asset-handover',
          features: ['Bàn giao tài sản thiết bị (laptop, chìa khóa, màn hình)', 'Bàn giao tài khoản hệ thống (hosting, fanpage, email marketing)', 'Bàn giao tiến độ dự án khi luân chuyển công tác hoặc nghỉ việc (Offboarding)']
        },
        employees: {
          name: 'Nhân viên (Hồ sơ nhân sự)',
          menuPath: '#/users',
          features: ['Danh bạ nhân viên nội bộ, số điện thoại, email, phòng ban', 'Quản lý hợp đồng lao động, CCCD, tài khoản ngân hàng, BHXH', 'Phân quyền Admin/HCNS/Manager/Nhân viên. Admin có quyền đổi Mã nhân viên (employee_code)']
        },
        payroll: {
          name: 'Bảng lương (Quản trị)',
          menuPath: '#/payroll',
          features: ['Bảng tính lương tổng hợp toàn công ty dành cho HCNS và Admin', 'Import / Export bảng lương mẫu Excel chuẩn hóa', 'Đồng bộ tự động từ dữ liệu chấm công và KPI', 'AI Anomaly Audit: Kiểm toán AI tự động phát hiện sai lệch ngày công và vi phạm chưa trừ phạt']
        },
        locations: {
          name: 'Địa điểm chấm công',
          menuPath: '#/attendance-locations',
          features: ['Cấu hình tọa độ GPS văn phòng (kinh độ, vĩ độ, bán kính geofence mét)', 'Quản lý danh sách WiFi Whitelist (BSSID, IP) được phép chấm công']
        },
        settings: {
          name: 'Cài đặt & Database Admin',
          menuPath: '#/settings',
          features: ['Cấu hình thời gian làm việc chuẩn (08:30 - 17:00), mốc phạt đi muộn', 'Quản trị cơ sở dữ liệu Cloudflare D1 và sao lưu dự phòng']
        }
      };

      const matchedKey = Object.keys(guides).find(k => mod.includes(k)) || 'dashboard';
      return guides[matchedKey];
    }

    case 'task_update_status': {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc tương ứng với mã hoặc tên: "${args.taskId || args.taskRef || ''}".` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_to !== me.id && task.assigned_by !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật trạng thái cho công việc này.' };
      }

      const s = String(args.status || '').toLowerCase();
      const st = (s.includes('done') || s.includes('hoàn thành') || s.includes('xong')) ? 'done'
        : (s.includes('in-progress') || s.includes('đang làm') || s.includes('tiến hành')) ? 'in-progress'
        : (s.includes('cancelled') || s.includes('hủy')) ? 'cancelled' : 'todo';

      const statusLabels = {
        'done': 'Đã hoàn thành (Done)',
        'in-progress': 'Đang thực hiện (In-progress)',
        'todo': 'Chờ thực hiện (Todo)',
        'cancelled': 'Đã hủy (Cancelled)'
      };

      await env.DB.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(st, task.id).run();
      await safeBroadcast(env, 'tasks', 'task:updated', { id: task.id, status: st }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'update_task_status',
        icon: 'clipboardCheck',
        title: 'Cập nhật trạng thái công việc',
        message: `Task #${task.id} "${task.title}" đã được chuyển sang trạng thái "${statusLabels[st]}".`,
        details: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Tiêu đề', value: task.title },
          { label: 'Trạng thái cũ', value: task.status },
          { label: 'Trạng thái mới', value: statusLabels[st] }
        ],
        undoAction: {
          actionType: 'update_task_status',
          payload: { taskId: task.id, status: task.status }
        }
      };
    }

    case 'task_assign': {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc: "${args.taskId || args.taskRef || ''}".` };

      const target = await resolveUser(env, args.assigneeName || args.assigneeId);
      if (!target) return { error: 'USER_NOT_FOUND', message: `Không tìm thấy nhân sự "${args.assigneeName || ''}" để phân công.` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_by !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền phân công lại công việc này.' };
      }

      await env.DB.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(target.id, task.id).run();
      await safeBroadcast(env, 'tasks', 'task:assigned', { id: task.id, assigned_to: target.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'assign_task',
        icon: 'userRound',
        title: 'Phân công công việc',
        message: `Đã phân công Task #${task.id} "${task.title}" cho nhân sự **${target.full_name}** (${target.employee_code || 'NV'}).`,
        details: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Tiêu đề', value: task.title },
          { label: 'Người nhận việc mới', value: `${target.full_name} (${target.employee_code || 'NV'})` }
        ],
        undoAction: {
          actionType: 'assign_task',
          payload: { taskId: task.id, assigneeId: task.assigned_to }
        }
      };
    }

    case 'task_update_details': {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc: "${args.taskId || args.taskRef || ''}".` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_by !== me.id && task.assigned_to !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật công việc này.' };
      }

      const newDueDate = args.dueDate ? parseRelativeDate(args.dueDate, task.due_date) : task.due_date;
      const newPriority = args.priority || task.priority;

      await env.DB.prepare("UPDATE tasks SET due_date = ?, priority = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(newDueDate, newPriority, task.id).run();
      await safeBroadcast(env, 'tasks', 'task:updated', { id: task.id, due_date: newDueDate, priority: newPriority }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'update_task_details',
        icon: 'clipboardList',
        title: 'Cập nhật thông tin công việc',
        message: `Đã cập nhật Task #${task.id} "${task.title}": Hạn chót mới là **${newDueDate || 'Không có'}**, Ưu tiên: **${newPriority}**.`,
        details: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Hạn chót', value: newDueDate || 'N/A' },
          { label: 'Ưu tiên', value: newPriority }
        ]
      };
    }

    case 'task_delete': {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc: "${args.taskId || args.taskRef || ''}".` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_by !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền xóa công việc này.' };
      }

      return {
        isActionCard: true,
        actionType: 'delete_task',
        icon: 'trash2',
        title: `Xác nhận xóa công việc #${task.id}`,
        confirmLabel: 'Xác nhận xóa',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Tiêu đề', value: task.title },
          { label: 'Trạng thái', value: task.status }
        ],
        payload: { taskId: task.id }
      };
    }

    case 'leave_approve': {
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isHcns && !isManager) {
        return { error: 'PERMISSION_DENIED', message: 'Chỉ Quản lý, HCNS hoặc Ban Giám đốc mới có quyền duyệt đơn xin nghỉ phép.' };
      }

      const reqRow = await env.DB.prepare(`
        SELECT r.*, u.full_name as user_name, u.department as user_dept, u.employee_code
          FROM requests r
          LEFT JOIN users u ON u.id = r.user_id
         WHERE r.id = ? OR CAST(r.id AS TEXT) = ?
      `).bind(Number(args.requestId), String(args.requestId)).first();

      if (!reqRow) return { error: 'NOT_FOUND', message: `Không tìm thấy đơn xin nghỉ phép #${args.requestId}.` };

      // Update approval
      await env.DB.prepare(`
        UPDATE requests
           SET status = 'approved', step1_status = 'approved', step2_status = 'approved',
               updated_at = datetime('now','localtime')
         WHERE id = ?
      `).bind(reqRow.id).run();

      await safeBroadcast(env, 'leave', 'leave:approved', { id: reqRow.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'approve_leave_request',
        icon: 'badgeCheck',
        title: 'Phê duyệt đơn xin nghỉ phép',
        message: `Đã phê duyệt đơn xin nghỉ phép #${reqRow.id} của nhân sự **${reqRow.user_name || 'Nhân viên'}** (${reqRow.employee_code || 'NV'}).`,
        details: [
          { label: 'Mã đơn', value: `#${reqRow.id}` },
          { label: 'Nhân sự', value: reqRow.user_name || 'NV' },
          { label: 'Thời gian', value: `${reqRow.start_date} → ${reqRow.end_date}` },
          { label: 'Trạng thái mới', value: 'Đã duyệt (Approved)' }
        ]
      };
    }

    case 'leave_reject': {
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isHcns && !isManager) {
        return { error: 'PERMISSION_DENIED', message: 'Chỉ Quản lý, HCNS hoặc Ban Giám đốc mới có quyền từ chối đơn xin nghỉ phép.' };
      }

      const reqRow = await env.DB.prepare('SELECT id, user_id FROM requests WHERE id = ?').bind(Number(args.requestId)).first();
      if (!reqRow) return { error: 'NOT_FOUND', message: `Không tìm thấy đơn xin nghỉ phép #${args.requestId}.` };

      const rejectReason = args.reason || 'Từ chối bởi Quản lý qua AI Copilot';
      await env.DB.prepare(`
        UPDATE requests
           SET status = 'rejected', step1_status = 'rejected', step2_status = 'rejected',
               updated_at = datetime('now','localtime')
         WHERE id = ?
      `).bind(reqRow.id).run();

      await safeBroadcast(env, 'leave', 'leave:rejected', { id: reqRow.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'reject_leave_request',
        icon: 'circleX',
        title: 'Từ chối đơn xin nghỉ phép',
        message: `Đã từ chối đơn xin nghỉ phép #${reqRow.id}. Lý do: "${rejectReason}".`,
        details: [
          { label: 'Mã đơn', value: `#${reqRow.id}` },
          { label: 'Lý do từ chối', value: rejectReason }
        ]
      };
    }

    case 'leave_cancel': {
      const reqRow = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(Number(args.requestId)).first();
      if (!reqRow) return { error: 'NOT_FOUND', message: `Không tìm thấy đơn xin nghỉ phép #${args.requestId}.` };

      if (reqRow.user_id !== me.id && reqRow.employee_id !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn chỉ có quyền hủy đơn xin nghỉ phép của chính mình.' };
      }
      if (reqRow.status !== 'pending') {
        return { error: 'INVALID_STATUS', message: `Không thể hủy đơn nghỉ phép ở trạng thái "${reqRow.status}". Chỉ có thể hủy đơn đang chờ duyệt.` };
      }

      await env.DB.prepare("UPDATE requests SET status = 'cancelled', updated_at = datetime('now','localtime') WHERE id = ?").bind(reqRow.id).run();
      await safeBroadcast(env, 'leave', 'leave:cancelled', { id: reqRow.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'cancel_leave_request',
        icon: 'circleX',
        title: 'Hủy đơn xin nghỉ phép',
        message: `Đã hủy thành công đơn xin nghỉ phép #${reqRow.id} của bạn.`,
        details: [
          { label: 'Mã đơn', value: `#${reqRow.id}` },
          { label: 'Thời gian', value: `${reqRow.start_date} → ${reqRow.end_date}` },
          { label: 'Trạng thái', value: 'Đã hủy (Cancelled)' }
        ]
      };
    }

    case 'announcement_post': {
      const { isAdmin, isHcns } = checkRolePermissions(me);
      if (!isAdmin && !isHcns) {
        return { error: 'PERMISSION_DENIED', message: 'Chỉ Quản trị viên và HCNS mới có quyền đăng thông báo nội bộ.' };
      }

      if (args.autoExecute === true) {
        const res = await env.DB.prepare(`
          INSERT INTO announcements (title, content, priority, target_scope, target_department, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          args.title,
          args.content || args.title,
          args.priority || 'normal',
          args.targetScope || 'all',
          args.targetDepartment || null,
          me.id
        ).run();
        const newId = res.meta?.last_row_id;
        await safeBroadcast(env, 'announcements', 'announcement:new', { id: newId, title: args.title }, { actorId: me.id });

        return {
          executed: true,
          actionType: 'post_announcement',
          icon: 'megaphone',
          title: 'Đã đăng thông báo mới',
          message: `Thông báo **"${args.title}"** đã được đăng tải thành công tới toàn hệ thống.`,
          details: [
            { label: 'Mã thông báo', value: `#${newId}` },
            { label: 'Tiêu đề', value: args.title },
            { label: 'Phạm vi', value: args.targetScope === 'department' ? `Phòng ${args.targetDepartment}` : 'Toàn công ty' }
          ]
        };
      }

      return {
        isActionCard: true,
        actionType: 'post_announcement',
        icon: 'megaphone',
        title: 'Xác nhận đăng thông báo nội bộ',
        confirmLabel: 'Xác nhận đăng ngay',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Tiêu đề', value: args.title },
          { label: 'Nội dung tóm tắt', value: (args.content || args.title).slice(0, 150) },
          { label: 'Phạm vi gửi', value: args.targetScope === 'department' ? `Phòng ${args.targetDepartment}` : 'Toàn công ty' },
          { label: 'Mức độ', value: args.priority === 'important' ? 'Quan trọng' : 'Bình thường' }
        ],
        payload: {
          title: args.title,
          content: args.content || args.title,
          priority: args.priority || 'normal',
          targetScope: args.targetScope || 'all',
          targetDepartment: args.targetDepartment || null
        }
      };
    }

    case 'employee_update_code': {
      const { isAdmin } = checkRolePermissions(me);
      if (!isAdmin) {
        return { error: 'PERMISSION_DENIED', message: 'Chức năng cập nhật Mã nhân viên (employee_code) chỉ dành riêng cho Quản trị viên (Admin).' };
      }

      const target = await resolveUser(env, args.userId || args.employeeName);
      if (!target) return { error: 'NOT_FOUND', message: `Không tìm thấy nhân viên "${args.employeeName || args.userId || ''}".` };

      const newCode = String(args.employeeCode || '').trim().toUpperCase();
      if (!newCode) return { error: 'BAD_REQUEST', message: 'Mã nhân viên mới không được để trống.' };

      return {
        isActionCard: true,
        actionType: 'update_employee_code',
        icon: 'keyRound',
        title: 'Xác nhận đổi mã nhân viên',
        confirmLabel: 'Xác nhận đổi mã',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Nhân sự', value: target.full_name },
          { label: 'Mã nhân viên cũ', value: target.employee_code || 'Chưa có' },
          { label: 'Mã nhân viên mới', value: newCode },
          { label: 'Phòng ban', value: target.department || 'Chung' }
        ],
        payload: {
          userId: target.id,
          employeeCode: newCode,
          employeeName: target.full_name
        }
      };
    }

    case 'payroll_request_review': {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = args.month || currentMonth;
      const [y, m] = month.split('-');

      const invRow = await env.DB.prepare(`
        SELECT id FROM invoices WHERE user_id = ? AND month = ? AND year = ? LIMIT 1
      `).bind(me.id, parseInt(m), parseInt(y)).first();

      const invoiceId = invRow?.id || 0;
      await env.DB.prepare(`
        INSERT INTO invoice_review_requests (invoice_id, user_id, category, message, requested_amount, status)
        VALUES (?, ?, 'other', ?, ?, 'open')
      `).bind(
        invoiceId,
        me.id,
        args.message || 'Thắc mắc số liệu lương qua AI Copilot',
        Number(args.requestedAmount || 0)
      ).run();

      await safeBroadcast(env, 'payroll', 'payroll:review_requested', { userId: me.id, month }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'request_invoice_review',
        icon: 'banknote',
        title: 'Đã gửi yêu cầu xem lại phiếu lương',
        message: `Yêu cầu phúc tra / giải trình phiếu lương tháng **${month}** đã được gửi tới bộ phận HCNS thành công.`,
        details: [
          { label: 'Kỳ lương', value: `Tháng ${month}` },
          { label: 'Nội dung', value: args.message || 'Được tạo qua Copilot' },
          { label: 'Trạng thái', value: 'Đang chờ HCNS xử lý (Open)' }
        ]
      };
    }

    case 'handover_create': {
      const receiver = args.receiverName ? await resolveUser(env, args.receiverName) : null;
      return {
        isActionCard: true,
        actionType: 'create_handover',
        icon: 'link',
        title: 'Xác nhận tạo biên bản bàn giao',
        confirmLabel: 'Xác nhận bàn giao',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Tài sản / Dự án', value: args.assetName },
          { label: 'Loại', value: args.assetType || 'device' },
          { label: 'Người nhận bàn giao', value: receiver?.full_name || args.receiverName || 'Chưa chỉ định' },
          { label: 'Ghi chú', value: args.note || 'Không có' }
        ],
        payload: {
          assetName: args.assetName,
          assetType: args.assetType || 'device',
          mentorId: receiver?.id || null,
          mentorName: receiver?.full_name || args.receiverName || null,
          note: args.note || ''
        }
      };
    }

    case 'handover_confirm': {
      const row = await env.DB.prepare('SELECT * FROM asset_handovers WHERE id = ?').bind(Number(args.handoverId)).first();
      if (!row) return { error: 'NOT_FOUND', message: `Không tìm thấy mục bàn giao #${args.handoverId}.` };

      await env.DB.prepare("UPDATE asset_handovers SET status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
      await safeBroadcast(env, 'handover', 'handover:confirmed', { id: row.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'confirm_handover',
        icon: 'circleCheck',
        title: 'Xác nhận hoàn tất bàn giao',
        message: `Đã xác nhận hoàn tất bàn giao tài sản/dự án #${row.id} ("${row.asset_name}").`,
        details: [
          { label: 'Mục bàn giao', value: row.asset_name },
          { label: 'Trạng thái', value: 'Đã hoàn thành (Completed)' }
        ]
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Strips follow-up suggestions, chatty closings, or open-ended prompts from the end of AI responses
 */
export function stripFollowUpSuggestions(text) {
  if (!text || typeof text !== 'string') return text;

  const patterns = [
    /\n+\s*(?:bạn|anh|chị|em)?\s*(?:có\s+)?(?:muốn|cần)\s+(?:tôi\s+)?(?:hỗ\s*trợ|giúp|tư\s*vấn|giải\s*đáp|làm\s*gì|tìm\s*hiểu|kiểm\s*tra)[\s\S]*$/i,
    /\n+\s*(?:bạn|anh|chị|em)?\s*(?:có\s+)?(?:câu\s*hỏi|thắc\s*mắc)[\s\S]*$/i,
    /\n+\s*(?:hãy|vui\s+lòng|đừng\s+ngần\s+ngại)[\s\S]*$/i,
    /\n+\s*(?:nếu|khi)\s+(?:(?:bạn|anh|chị|em)\s+)?(?:có|cần|muốn)[\s\S]*$/i,
    /\n+\s*(?:tôi\s+có\s+thể|có\s+thể)\s+giúp\s+gì[\s\S]*$/i,
    /\n+\s*(?:bạn|anh|chị)?\s*đang\s+quan\s+tâm[\s\S]*$/i,
    /\n+\s*(?:bạn|anh|chị)?\s*muốn\s+tra\s+cứu[\s\S]*$/i,
    /\n+\s*bạn\s+cần\s+tôi[\s\S]*$/i,
    /\n+\s*hy\s+vọng[\s\S]*$/i,
    /\n+\s*(?:chúc\s+bạn|chúc\s+anh|chúc\s+chị)[\s\S]*$/i
  ];

  let cleaned = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of patterns) {
      if (pat.test(cleaned)) {
        cleaned = cleaned.replace(pat, '').trimEnd();
        changed = true;
      }
    }
  }
  return cleaned;
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

  // 0. Step 0: Enterprise Privacy Guardrail & PII Shield
  const isSalaryQuery = /lương|thu nhập|tiền lương|bảng lương|phiếu lương|thực nhận/i.test(query);
  const isSelfPayroll = /của tôi|của mình|của em|của anh|của chị|bản thân|lương tôi|lương em|lương anh|lương mình/i.test(query)
    || /^(?:xem|tra cứu|kiểm tra|cho xem|cho hỏi)?\s*(?:bảng\s*)?lương\s*(?:tháng\s*\d+|được không|\?|$)/i.test(query);
  const isAskingOtherSalary = isSalaryQuery && !isSelfPayroll && /(của|cho)\s+(anh|chị|bạn|em|ông|bà|nhân viên|đồng nghiệp)?\s*([a-zA-ZÀ-ỹ0-9_]+)/i.test(query);

  const isPrivileged = me.role === 'admin' || (me.department && /HCNS|Hành chính/i.test(me.department));

  if (isAskingOtherSalary && !isPrivileged) {
    const match = query.match(/(của|cho)\s+(anh|chị|bạn|em|ông|bà|nhân viên|đồng nghiệp)?\s*([a-zA-ZÀ-ỹ0-9_]+)/i);
    const targetName = match ? match[3] : 'người khác';
    const selfLastName = String(me.full_name || '').toLowerCase().split(' ').pop();
    if (!targetName.toLowerCase().includes(selfLastName)) {
      const blockedMsg = `🛡️ **Chính sách Bảo mật Dữ liệu Doanh nghiệp (Enterprise Privacy Guardrail):**\n\nTheo quy định an toàn thông tin nội bộ của NetViet HR, dữ liệu về mức lương, thu nhập và thông tin nhân sự là thông tin mật cấp độ cao.\n\n- Bạn chỉ có quyền tra cứu bảng lương và thông tin cá nhân của chính mình (**${me.full_name}**).\n- Yêu cầu tra cứu thông tin thu nhập của nhân sự khác (**${targetName}**) đã bị hệ thống từ chối.\n\nNếu bạn là cán bộ quản lý cần kiểm tra bảng lương phòng ban, vui lòng liên hệ Ban Giám đốc hoặc Phòng HCNS để được cấp quyền.`;

      // Log privacy guardrail trigger
      await logAiInteraction(env, {
        id: reqId,
        userId: me.id,
        conversationId,
        sessionRole: me.role || 'employee',
        queryText: query,
        responseText: blockedMsg,
        provider: 'privacy-guardrail',
        modelName: 'enterprise-pii-shield',
        promptTokens: estimateTokens(query),
        completionTokens: estimateTokens(blockedMsg),
        estimatedCostUsd: 0,
        ttftMs: 5,
        totalLatencyMs: 15,
        retrievedChunksJson: [],
        toolsCalledJson: [{ name: 'privacy_guardrail_block', args: { target: targetName } }]
      });

      return {
        requestId: reqId,
        content: blockedMsg,
        citations: [],
        actionCard: null,
        telemetry: {
          provider: 'privacy-guardrail',
          model: 'enterprise-pii-shield',
          tokens: { prompt: estimateTokens(query), completion: estimateTokens(blockedMsg), total: estimateTokens(query) + estimateTokens(blockedMsg) },
          cost: { costUsd: 0, costVnd: 0 },
          latencyMs: 15,
          retrievedChunkCount: 0
        }
      };
    }
  }

  const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
  const currentYear = nowVN.getUTCFullYear();
  const currentMonthNum = String(nowVN.getUTCMonth() + 1).padStart(2, '0');
  const currentDayNum = String(nowVN.getUTCDate()).padStart(2, '0');
  const todayYMD = `${currentYear}-${currentMonthNum}-${currentDayNum}`;
  const todayFormatted = `${currentDayNum}/${currentMonthNum}/${currentYear}`;
  const currentTimeStr = `${String(nowVN.getUTCHours()).padStart(2, '0')}:${String(nowVN.getUTCMinutes()).padStart(2, '0')}`;
  const nowFormatted = `${currentTimeStr} ngày ${todayFormatted}`;

  // Helper: Extract month if mentioned (e.g. "tháng 8" -> "2026-08", "tháng 08" -> "2026-08", "08/2026", "2026-08")
  let extractedMonth = null;
  const monthMatch = query.match(/(?:tháng\s*|tháng\s*0?)(\d{1,2})(?:\s*[\/\-]\s*(\d{4})|\s*năm\s*(\d{4}))?/i);
  if (monthMatch) {
    const m = String(monthMatch[1]).padStart(2, '0');
    const y = monthMatch[2] || monthMatch[3] || currentYear;
    extractedMonth = `${y}-${m}`;
  } else {
    const yyyyMm = query.match(/\b(202\d)-(0[1-9]|1[0-2])\b/);
    if (yyyyMm) extractedMonth = yyyyMm[0];
  }
  if (!extractedMonth) {
    extractedMonth = `${currentYear}-${currentMonthNum}`;
  }

  // 0.1 Step 0b: Check-in / Check-out request or attendance status inquiry guardrail
  const isDirectCheckinAttempt = /(?:giúp|hộ|cho|thay|tự động|thực hiện)\s*(?:tôi|em|mình)?\s*(?:check[- ]?in|chấm công|check[- ]?out)|(?:check[- ]?in|chấm công|check[- ]?out)\s*(?:giúp|hộ|cho|thay|hôm nay|bây giờ|ngay|luôn)|^(?:check[- ]?in|chấm công)\s*(?:hôm nay|bây giờ)?$/i.test(query);

  const isTodayAttendanceQuery = /(?:hôm nay|ngày này).*(?:chấm công|check[- ]?in|đi làm chưa)|(?:chấm công|check[- ]?in).*(?:hôm nay|chưa\b)/i.test(query);

  if (isDirectCheckinAttempt || isTodayAttendanceQuery) {
    let todayAtt = null;
    try {
      todayAtt = await env.DB.prepare(`
        SELECT id, date, checkin_time, checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
          FROM attendance
         WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
           AND date = ?
         LIMIT 1
      `).bind(me.id, String(me.id), todayYMD).first();
    } catch (_) {
      try {
        todayAtt = await env.DB.prepare(`
          SELECT id, work_date as date, check_in as checkin_time, check_out as checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
            FROM attendance
           WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
             AND work_date = ?
           LIMIT 1
        `).bind(me.id, String(me.id), todayYMD).first();
      } catch (_) {}
    }

    const hasCheckedIn = Boolean(todayAtt && (todayAtt.checkin_time || todayAtt.check_in));
    let checkinResponseText = '';
    let navCard = null;

    if (hasCheckedIn) {
      const checkinTime = todayAtt.checkin_time || todayAtt.check_in;
      const isLate = Number(todayAtt.late_minutes) > 0;
      const statusText = isLate ? `Đi muộn ${todayAtt.late_minutes} phút` : 'Đúng giờ';
      checkinResponseText = `Hôm nay (**${todayFormatted}**), bạn đã thực hiện Check-in vào lúc **${checkinTime}** với trạng thái **${statusText}**.\n\nHệ thống Chấm công đã ghi nhận đầy đủ dữ liệu của bạn, không cần check-in lại.`;
      if (todayAtt.checkout_time || todayAtt.check_out) {
        checkinResponseText += `\nGiờ Check-out ghi nhận: **${todayAtt.checkout_time || todayAtt.check_out}**.`;
      }
    } else {
      checkinResponseText = `Trợ lý ảo **không thể thực hiện chấm công thay nhân sự**.\n\nTheo quy chế bảo mật và kỷ luật của NetViet HR, thao tác **Check-in / Check-out** bắt buộc phải thực hiện trực tiếp trên thiết bị của bạn nhằm xác thực **tọa độ GPS Geofence văn phòng** (bán kính cho phép) và **mạng WiFi Whitelist** nội bộ.\n\nBạn vui lòng bấm vào nút bên dưới để mở màn hình **Chấm công** và thực hiện Check-in:`;
      navCard = {
        isNavigationCard: true,
        title: 'Màn hình Chấm công',
        icon: 'clock3',
        link: '#/attendance',
        buttonText: 'Mở màn hình Chấm công'
      };
    }

    await logAiInteraction(env, {
      id: reqId,
      userId: me.id,
      conversationId,
      sessionRole: me.role || 'employee',
      queryText: query,
      responseText: checkinResponseText,
      provider: 'edge-guardrail',
      modelName: 'attendance-compliance-guard',
      promptTokens: estimateTokens(query),
      completionTokens: estimateTokens(checkinResponseText),
      estimatedCostUsd: 0,
      ttftMs: 5,
      totalLatencyMs: 15,
      retrievedChunksJson: [],
      toolsCalledJson: [{ name: 'attendance_checkin_compliance', args: { today: todayYMD, hasCheckedIn } }]
    });

    return {
      requestId: reqId,
      content: checkinResponseText,
      citations: [],
      actionCard: navCard,
      telemetry: {
        provider: 'edge-guardrail',
        model: 'attendance-compliance-guard',
        tokens: { prompt: estimateTokens(query), completion: estimateTokens(checkinResponseText), total: estimateTokens(query) + estimateTokens(checkinResponseText) },
        cost: { costUsd: 0, costVnd: 0 },
        latencyMs: 15,
        retrievedChunkCount: 0
      }
    };
  }

  // 1. Step 1: Detect intent & Run Hybrid RAG
  const isPolicyQuery = /muộn|trễ|phạt|giờ làm|quy định|nội quy|nghỉ phép|phép năm|ốm|bảo mật|chính sách|phúc lợi/i.test(query);
  let ragResult = { results: [], contextText: '', citations: [] };
  if (isPolicyQuery) {
    ragResult = await hybridSearch(env, { query, limit: 3 });
  }

  // 2. Step 2: Detect operational commands & query tools
  let toolData = null;
  let toolNameCalled = null;
  let actionCard = null;
  let executedAction = null;

  // 2.1 Action: Update task status (Direct execution)
  const taskStatusMatch = query.match(/(?:hoàn thành|xong|đã xong|done|kết thúc)\s+(?:task|công việc|nhiệm vụ)?\s*#?(\d+)/i)
    || query.match(/(?:đổi|chuyển|cập nhật|set)\s+(?:trạng thái\s+)?(?:task|công việc)?\s*#?(\d+)\s*(?:sang|thành|là)?\s*(hoàn thành|xong|done|đang làm|in-progress|chờ|todo|hủy|cancelled)/i)
    || query.match(/(?:chuyển|đổi)\s+(?:task|công việc)?\s*#?(\d+)\s*(?:sang|thành)\s*(đang làm|in-progress)/i);

  // 2.2 Action: Assign task (Direct execution)
  const taskAssignMatch = query.match(/(?:giao|phân công|chuyển|assign)\s+(?:task|công việc)?\s*#?(\d+)\s+cho\s+([a-zA-ZÀ-ỹ0-9_\s]+)/i);

  // 2.3 Action: Update task deadline or priority (Direct execution)
  const taskDeadlineMatch = query.match(/(?:đổi|sửa|cập nhật|dời)\s+(?:hạn|hạn chót|deadline)\s+(?:task|công việc)?\s*#?(\d+)\s*(?:sang|đến|thành)?\s*([a-zA-ZÀ-ỹ0-9_\s\-\/]+)/i);
  const taskPriorityMatch = query.match(/(?:đổi|sửa|cập nhật)\s+(?:mức độ\s+)?(?:ưu tiên|priority)\s+(?:task|công việc)?\s*#?(\d+)\s*(?:sang|thành)?\s*(khẩn cấp|urgent|cao|high|trung bình|medium|thấp|low)/i);

  // 2.4 Action: Delete task (Confirmation card)
  const taskDeleteMatch = query.match(/(?:xóa|hủy bỏ|delete)\s+(?:task|công việc|nhiệm vụ)\s*#?(\d+)/i);

  // 2.5 Action: Approve/Reject/Cancel Leave request
  const leaveApproveMatch = query.match(/(?:duyệt|phê duyệt|approve)\s+(?:đơn\s+)?(?:nghỉ phép|nghỉ)?\s*#?(\d+)/i);
  const leaveRejectMatch = query.match(/(?:từ chối|reject)\s+(?:đơn\s+)?(?:nghỉ phép|nghỉ)?\s*#?(\d+)(?:\s*(?:vì|lý do)?\s*(.*))?/i);
  const leaveCancelMatch = query.match(/(?:hủy|cancel)\s+(?:đơn\s+)?(?:nghỉ phép|nghỉ)\s*#?(\d+)/i);

  // 2.6 Action: Announcements
  const annPostMatch = query.match(/(?:đăng thông báo|tạo thông báo|phát thông báo)\s*:?\s*(.+)/i);

  // 2.7 Action: Update employee code
  const empCodeMatch = query.match(/(?:đổi|cập nhật|sửa)\s+mã\s+nhân\s+viên\s+của\s+([a-zA-ZÀ-ỹ0-9_\s]+)\s+thành\s+([a-zA-Z0-9_\-]+)/i);

  // 2.8 Action: Payroll Review Request
  const payReviewMatch = query.match(/(?:khiếu nại|xem lại|phúc tra|thắc mắc|sai lệch)\s+(?:bảng lương|phiếu lương|tiền lương)/i);

  // 2.9 Action: Handover
  const handoverConfirmMatch = query.match(/(?:xác nhận bàn giao|đã nhận bàn giao)\s*#?(\d+)/i);
  const handoverCreateMatch = query.match(/(?:tạo biên bản bàn giao|bàn giao tài sản|bàn giao dự án)\s*:?\s*(.+)/i);

  if (taskStatusMatch) {
    toolNameCalled = 'task_update_status';
    const taskId = Number(taskStatusMatch[1]);
    const rawStatus = taskStatusMatch[2] || 'done';
    toolData = await executeTool(env, toolNameCalled, { taskId, status: rawStatus }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskAssignMatch) {
    toolNameCalled = 'task_assign';
    const taskId = Number(taskAssignMatch[1]);
    const assigneeName = String(taskAssignMatch[2]).trim();
    toolData = await executeTool(env, toolNameCalled, { taskId, assigneeName }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskDeadlineMatch) {
    toolNameCalled = 'task_update_details';
    const taskId = Number(taskDeadlineMatch[1]);
    const dueDate = String(taskDeadlineMatch[2]).trim();
    toolData = await executeTool(env, toolNameCalled, { taskId, dueDate }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskPriorityMatch) {
    toolNameCalled = 'task_update_details';
    const taskId = Number(taskPriorityMatch[1]);
    const p = String(taskPriorityMatch[2]).toLowerCase();
    const priority = (p.includes('urgent') || p.includes('khẩn')) ? 'urgent' : (p.includes('high') || p.includes('cao')) ? 'high' : (p.includes('low') || p.includes('thấp')) ? 'low' : 'medium';
    toolData = await executeTool(env, toolNameCalled, { taskId, priority }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskDeleteMatch) {
    toolNameCalled = 'task_delete';
    toolData = await executeTool(env, toolNameCalled, { taskId: Number(taskDeleteMatch[1]) }, me);
    if (toolData.isActionCard) actionCard = toolData;
  } else if (leaveApproveMatch) {
    toolNameCalled = 'leave_approve';
    toolData = await executeTool(env, toolNameCalled, { requestId: Number(leaveApproveMatch[1]) }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (leaveRejectMatch) {
    toolNameCalled = 'leave_reject';
    toolData = await executeTool(env, toolNameCalled, { requestId: Number(leaveRejectMatch[1]), reason: leaveRejectMatch[2] }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (leaveCancelMatch) {
    toolNameCalled = 'leave_cancel';
    toolData = await executeTool(env, toolNameCalled, { requestId: Number(leaveCancelMatch[1]) }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (annPostMatch) {
    toolNameCalled = 'announcement_post';
    const content = annPostMatch[1].trim();
    toolData = await executeTool(env, toolNameCalled, { title: content.slice(0, 50), content }, me);
    if (toolData.isActionCard) actionCard = toolData;
    else if (toolData.executed) executedAction = toolData;
  } else if (empCodeMatch) {
    toolNameCalled = 'employee_update_code';
    toolData = await executeTool(env, toolNameCalled, { employeeName: empCodeMatch[1].trim(), employeeCode: empCodeMatch[2].trim() }, me);
    if (toolData.isActionCard) actionCard = toolData;
  } else if (payReviewMatch) {
    toolNameCalled = 'payroll_request_review';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth, message: query }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (handoverConfirmMatch) {
    toolNameCalled = 'handover_confirm';
    toolData = await executeTool(env, toolNameCalled, { handoverId: Number(handoverConfirmMatch[1]) }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (handoverCreateMatch) {
    toolNameCalled = 'handover_create';
    toolData = await executeTool(env, toolNameCalled, { assetName: handoverCreateMatch[1].trim() }, me);
    if (toolData.isActionCard) actionCard = toolData;
  } else if (/kiểm toán.*lương|audit.*payroll|bất thường.*bảng lương|soát lương/i.test(query)) {
    toolNameCalled = 'audit_payroll_anomalies';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/bảng lương|phiếu lương|tiền lương của tôi|lương tháng|thu nhập của tôi|thực nhận của tôi/i.test(query) || (isSalaryQuery && isSelfPayroll)) {
    toolNameCalled = 'get_my_payslip_summary';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/chấm công|đi muộn|đi trễ|vào muộn|vào trễ|trễ bao nhiêu|muộn bao nhiêu|lần trễ|lần muộn|tiền phạt|bảng công|công tháng|ngày công|lịch sử chấm/i.test(query)) {
    toolNameCalled = 'get_my_attendance_summary';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/quỹ phép|ngày phép còn lại|phép năm còn|hạn mức phép|còn bao nhiêu ngày phép/i.test(query)) {
    toolNameCalled = 'get_leave_balance';
    toolData = await executeTool(env, toolNameCalled, {}, me);
  } else if (/(?:tổng quan|thống kê|xem|tổng hợp|danh sách|lý do|lí do).*mọi người.*nghỉ phép|(?:lý do|lí do).*nghỉ phép.*(mọi người|nhân sự|nhân viên|công ty|phòng ban)|(?:tổng quan|tình hình|ai).*nghỉ phép|mọi người.*nghỉ phép.*vì|lý do.*nghỉ phép/i.test(query)) {
    toolNameCalled = 'get_leave_requests_overview';
    toolData = await executeTool(env, toolNameCalled, { month: 'all', status: 'all' }, me);
  } else if (/thông báo mới|bản tin|tin tức công ty|quyết định mới/i.test(query)) {
    toolNameCalled = 'get_announcements_summary';
    toolData = await executeTool(env, toolNameCalled, { limit: 5 }, me);
  } else if (/hướng dẫn.*(module|phân hệ|chức năng)|(làm sao|cách dùng|chức năng).*(dashboard|chat|bàn giao|địa điểm|cài đặt|nhân viên)/i.test(query)) {
    toolNameCalled = 'get_system_module_info';
    toolData = await executeTool(env, toolNameCalled, { moduleName: query }, me);
  } else if (/task của tôi|công việc của tôi|danh sách task|việc cần làm/i.test(query)) {
    toolNameCalled = 'list_my_tasks';
    toolData = await executeTool(env, toolNameCalled, {}, me);
  } else if (/xin nghỉ phép|tạo đơn nghỉ|đăng ký nghỉ/i.test(query)) {
    toolNameCalled = 'create_leave_request_draft';
    const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || [];
    const startDate = dates[0] || parseRelativeDate(query, new Date().toISOString().slice(0, 10));
    const endDate = dates[1] || startDate;
    toolData = await executeTool(env, toolNameCalled, {
      leaveType: 'annual',
      startDate,
      endDate,
      reason: query
    }, me);
    actionCard = toolData;
  } else if (/tạo task|tạo việc|thêm công việc/i.test(query) && query.length > 5) {
    toolNameCalled = 'create_task_draft';
    const titleMatch = query.replace(/^(tạo task|tạo việc|thêm công việc)\s*:?/i, '').trim();
    const isDirect = /làm luôn|tạo luôn|thêm ngay|lập tức/i.test(query);
    toolData = await executeTool(env, toolNameCalled, {
      title: titleMatch || 'Công việc mới từ AI Copilot',
      priority: 'medium',
      autoExecute: isDirect
    }, me);
    if (toolData.executed) executedAction = toolData;
    else actionCard = toolData;
  }

  // 3. Step 3: Build Grounded System Instruction
  let systemPrompt = `Bạn là Trợ lý ảo HR NetViet - Trợ lý AI chuyên trách nền tảng quản trị nhân sự NetViet HR.
Người dùng hiện tại: ${me.full_name} (Mã NV: ${me.employee_code || 'NV'}, Vai trò: ${me.role || 'employee'}, Phòng ban: ${me.department || 'Chung'}).
THỜI GIAN THỰC TẾ HIỆN TẠI CỦA HỆ THỐNG: ${nowFormatted} (Múi giờ Việt Nam UTC+7).
Năm hiện tại là ${currentYear}. TUYỆT ĐỐI KHÔNG dùng các năm cũ như 2023, 2024.

DANH MỤC 12 PHÂN HỆ HỆ THỐNG:
1. Dashboard: Báo cáo tỷ lệ chuyên cần, quân số đi làm, đi muộn, việc cần làm, sinh nhật.
2. Thông báo: Tin tức, thông tư, quyết định điều động/khen thưởng, file đính kèm, lượt đọc.
3. Chat: Kênh thảo luận thời gian thực WebSocket/Durable Object, chat chung & phòng ban, poll bình chọn, ghim tin nhắn, @mention.
4. Chấm công: Check-in/out GPS geofence văn phòng & WiFi Whitelist, selfie. Chuẩn 08:30 - 17:00 (mốc 08:35 đúng giờ, từ 08:36 tính muộn). Miễn phạt 2 lần/tháng đầu tiên; từ lần 3 phạt 20.000đ/lần. Tự động checkout lúc 17:05 UTC.
5. Nghỉ phép: Quy trình duyệt 2 bước (Bước 1: Quản lý trực tiếp -> Bước 2: HCNS duyệt cuối). Quỹ phép năm 12 ngày/năm (1 ngày/tháng).
6. Công việc (Tasks): Bảng Kanban/Danh sách, mức ưu tiên (low, medium, high, urgent), deadline, giao việc, đính kèm file, cập nhật tiến độ.
7. Phiếu lương (Invoices): Tra cứu phiếu lương cá nhân từng tháng, lương cơ bản, ngày công, thưởng KPI, phụ cấp, giảm trừ phạt đi muộn, bảo hiểm, thuế, thực nhận (Net), xác nhận phiếu hoặc gửi yêu cầu xem lại.
8. Bàn giao: Bàn giao thiết bị tài sản, tài khoản hệ thống và tiến độ dự án khi thôi việc/chuyển công tác.
9. Nhân viên: Danh bạ, hồ sơ hợp đồng, CCCD, phân quyền. Admin có quyền đổi mã nhân viên (employee_code).
10. Bảng lương: Tổng hợp bảng lương công ty (Admin/HCNS), import/export Excel, đồng bộ công, kiểm toán AI bất thường.
11. Địa điểm chấm công: Tọa độ GPS văn phòng, bán kính geofence mét, danh sách WiFi Whitelist.
12. Cài đặt: Giờ làm việc chuẩn, mốc phạt, quản trị database Cloudflare D1.

QUY TẮC XƯNG HÔ VÀ ĐẠI TỪ NHÂN XƯNG (BẮT BUỘC):
- Bạn luôn tự xưng là "Tôi" (Trợ lý AI NetViet).
- Bạn luôn gọi người dùng là "Bạn".
- Xử lý đại từ nhân xưng của người dùng: Người dùng có thể xưng hô tự nhiên như "tôi", "em", "mình", "anh". Khi người dùng hỏi các câu như "lương của em tháng này", "hôm nay anh đã chấm công chưa", "task của mình", BẮT BUỘC hiểu đây là thông tin của chính người dùng hiện tại (${me.full_name}). Tuyệt đối KHÔNG hiểu nhầm là đang hỏi nhân sự khác và KHÔNG từ chối vô lý.

QUY TẮC PHẢN HỒI (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT):
1. PHONG CÁCH: Nghiêm túc, điềm đạm, chuẩn mực hành chính công sở.
2. NGẮN GỌN & ĐI THẲNG VÀO TRỌNG TÂM:
- Đi thẳng vào kết quả hoặc số liệu cốt lõi trong tối đa 1 - 3 câu ngắn hoặc danh sách gạch đầu dòng cô đọng. Tuyệt đối KHÔNG trả lời cụt lủn 1-2 từ.
- TUYỆT ĐỐI KHÔNG chào hỏi mở đầu rườm rà (nghiêm cấm các câu như: "Xin chào bạn, tôi là...", "Chào bạn! Tôi rất vui được hỗ trợ...").
- TUYỆT ĐỐI KHÔNG đưa ra câu kết mớm lời hay câu hỏi thừa thãi (nghiêm cấm: "Nếu bạn cần giúp gì thêm...", "Hy vọng thông tin này giúp ích...", "Bạn có muốn...", "Hãy cho tôi biết nếu..."). Dừng lại ngay lập tức sau khi hoàn thành nội dung.
3. ĐỐI VỚI CÂU HỎI VỀ KIẾN THỨC BÊN NGOÀI: Sẵn sàng giải đáp ngắn gọn, chuẩn xác.
4. QUY TẮC BẢO MẬT: Tuyệt đối không tiết lộ lương, CCCD, thông tin riêng tư của người khác cho tài khoản không có quyền Admin/HCNS.
5. ĐỊNH DẠNG DỮ LIỆU: Luôn in đậm (**...**) các số liệu, ngày tháng, tên người, kết quả và trạng thái quan trọng.
6. TUYỆT ĐỐI KHÔNG GIẢ MẠO CHẤM CÔNG HOẶC HÀNH ĐỘNG HỆ THỐNG:
- Trợ lý AI tuyệt đối KHÔNG giả lập, không bịa đặt hoặc thông báo đã check-in / check-out thành công cho người dùng qua chat. Thao tác chấm công bắt buộc nhân sự phải tự thao tác trên thiết bị cá nhân tại văn phòng để xác thực GPS Geofence và WiFi Whitelist.
7. BẮT BUỘC TRẢ LỜI TỪ DỮ LIỆU THỰC TẾ (GROUNDED DATA):
- Khi người dùng hỏi về lý do nghỉ phép, tình hình công việc, chấm công: BẮT BUỘC trả lời dựa trên số liệu thực tế được cung cấp trong [TOOL DATA].
- TUYỆT ĐỐI KHÔNG trả lời lý thuyết chung chung sách giáo khoa. Phải tổng kết cụ thể số liệu thực tế.
`;

  if (ragResult.contextText) {
    systemPrompt += `\n--- TÀI LIỆU TRI THỨC NỘI QUY TRÍCH XUẤT (RAG CONTEXT) ---\n${ragResult.contextText}\n----------------------------------------------------\n`;
  }

  if (toolData && !actionCard) {
    systemPrompt += `\n--- DỮ LIỆU THỰC TẾ HỆ THỐNG TRÍCH XUẤT (TOOL DATA) ---\n${JSON.stringify(toolData, null, 2)}\n----------------------------------------------------\n`;
  }

  // 4. Step 4: Run Inference via AI Gateway (with Structured Tool Calling)
  const chatMessages = [
    ...conversationHistory.slice(-4),
    { role: 'user', content: query }
  ];

  const completion = await chatCompletion(env, {
    messages: chatMessages,
    systemPrompt,
    tools: COPILOT_TOOLS,
    temperature: 0.1,
    maxTokens: 800,
    toolData
  });

  // Handle LLM Native Tool Calling (P1.1, P1.2, P1.3)
  if (completion.toolCalls && completion.toolCalls.length > 0) {
    const primaryTool = completion.toolCalls[0];
    toolNameCalled = primaryTool.name;
    const auth = verifyToolAuthorization(primaryTool.name, primaryTool.args, me);
    if (!auth.allowed) {
      completion.content = `🛡️ **Từ chối quyền thực thi tác vụ (${primaryTool.name}):**\n\n${auth.message}`;
    } else {
      const res = await executeTool(env, primaryTool.name, primaryTool.args, me);
      if (res.isActionCard) {
        actionCard = res;
      } else if (res.executed) {
        executedAction = res;
      } else {
        toolData = res;
        if (!completion.content || !completion.content.trim()) {
          const followUp = await chatCompletion(env, {
            messages: [
              ...chatMessages,
              { role: 'assistant', content: `[Đã thực thi công cụ ${primaryTool.name}]` },
              { role: 'user', content: `Hãy tổng hợp câu trả lời súc tích dựa trên dữ liệu công cụ sau:\n${JSON.stringify(res)}` }
            ],
            systemPrompt,
            temperature: 0.1,
            maxTokens: 800,
            toolData: res
          });
          if (followUp && followUp.content) {
            completion.content = followUp.content;
          }
        }
      }
    }
  }

  const totalTimeMs = Date.now() - reqStartTime;
  let cleanContent = (executedAction?.message && completion.provider === 'edge-local')
    ? executedAction.message
    : stripFollowUpSuggestions(maskPII(completion.content));

  // P1.4: Citation Grounding & Anti-Hallucination Verification
  cleanContent = verifyAndCleanCitations(cleanContent, ragResult.citations);

  // 5. Step 5: Save Telemetry Log to Database (LLMOps)
  await logAiInteraction(env, {
    id: reqId,
    userId: me.id,
    conversationId,
    sessionRole: me.role || 'employee',
    queryText: query,
    responseText: cleanContent,
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
    content: cleanContent,
    citations: ragResult.citations,
    actionCard,
    executedAction,
    telemetry: {
      provider: completion.provider,
      model: completion.model,
      tokens: completion.tokens,
      cost: completion.cost,
      latencyMs: totalTimeMs,
      retrievedChunkCount: ragResult.results.length,
      debugErrors: isPrivileged ? (completion.debugErrors || []) : undefined
    }
  };
}

/**
 * Orchestrate a complete streaming Copilot chat turn with multi-event SSE
 * Emits:
 * - 'status': progress notification (e.g. searching RAG, executing tool)
 * - 'delta': streamed tokens of content
 * - 'done': final complete metadata payload (citations, actionCard, telemetry)
 */
export async function runCopilotTurnStream(env, {
  userMessage,
  conversationHistory = [],
  me,
  conversationId = 'default',
  onEvent = async () => {}
}) {
  const reqStartTime = Date.now();
  const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const query = String(userMessage || '').trim();

  await onEvent('status', { message: 'Đang kiểm tra bảo mật & an toàn dữ liệu...' });

  // 0. Step 0: Enterprise Privacy Guardrail & PII Shield
  const isSalaryQuery = /lương|thu nhập|tiền lương|bảng lương|phiếu lương|thực nhận/i.test(query);
  const isSelfPayroll = /của tôi|của mình|của em|của anh|của chị|bản thân|lương tôi|lương em|lương anh|lương mình/i.test(query)
    || /^(?:xem|tra cứu|kiểm tra|cho xem|cho hỏi)?\s*(?:bảng\s*)?lương\s*(?:tháng\s*\d+|được không|\?|$)/i.test(query);
  const isAskingOtherSalary = isSalaryQuery && !isSelfPayroll && /(của|cho)\s+(anh|chị|bạn|em|ông|bà|nhân viên|đồng nghiệp)?\s*([a-zA-ZÀ-ỹ0-9_]+)/i.test(query);

  const isPrivileged = me.role === 'admin' || (me.department && /HCNS|Hành chính/i.test(me.department));

  if (isAskingOtherSalary && !isPrivileged) {
    const match = query.match(/(của|cho)\s+(anh|chị|bạn|em|ông|bà|nhân viên|đồng nghiệp)?\s*([a-zA-ZÀ-ỹ0-9_]+)/i);
    const targetName = match ? match[3] : 'người khác';
    const selfLastName = String(me.full_name || '').toLowerCase().split(' ').pop();
    if (!targetName.toLowerCase().includes(selfLastName)) {
      const blockedMsg = `🛡️ **Chính sách Bảo mật Dữ liệu Doanh nghiệp (Enterprise Privacy Guardrail):**\n\nTheo quy định an toàn thông tin nội bộ của NetViet HR, dữ liệu về mức lương, thu nhập và thông tin nhân sự là thông tin mật cấp độ cao.\n\n- Bạn chỉ có quyền tra cứu bảng lương và thông tin cá nhân của chính mình (**${me.full_name}**).\n- Yêu cầu tra cứu thông tin thu nhập của nhân sự khác (**${targetName}**) đã bị hệ thống từ chối.\n\nNếu bạn là cán bộ quản lý cần kiểm tra bảng lương phòng ban, vui lòng liên hệ Ban Giám đốc hoặc Phòng HCNS để được cấp quyền.`;

      await onEvent('status', { message: 'Đang phản hồi...' });
      for await (const chunk of streamPacedText(blockedMsg, 12)) {
        await onEvent('delta', { text: chunk });
      }

      await logAiInteraction(env, {
        id: reqId,
        userId: me.id,
        conversationId,
        sessionRole: me.role || 'employee',
        queryText: query,
        responseText: blockedMsg,
        provider: 'privacy-guardrail',
        modelName: 'enterprise-pii-shield',
        promptTokens: estimateTokens(query),
        completionTokens: estimateTokens(blockedMsg),
        estimatedCostUsd: 0,
        ttftMs: 5,
        totalLatencyMs: 15,
        retrievedChunksJson: [],
        toolsCalledJson: [{ name: 'privacy_guardrail_block', args: { target: targetName } }]
      });

      await onEvent('done', {
        requestId: reqId,
        content: blockedMsg,
        citations: [],
        actionCard: null,
        executedAction: null,
        telemetry: {
          provider: 'privacy-guardrail',
          model: 'enterprise-pii-shield',
          tokens: { prompt: estimateTokens(query), completion: estimateTokens(blockedMsg), total: estimateTokens(query) + estimateTokens(blockedMsg) },
          cost: { costUsd: 0, costVnd: 0 },
          latencyMs: 15,
          retrievedChunkCount: 0
        }
      });
      return;
    }
  }

  const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
  const currentYear = nowVN.getUTCFullYear();
  const currentMonthNum = String(nowVN.getUTCMonth() + 1).padStart(2, '0');
  const currentDayNum = String(nowVN.getUTCDate()).padStart(2, '0');
  const todayYMD = `${currentYear}-${currentMonthNum}-${currentDayNum}`;
  const todayFormatted = `${currentDayNum}/${currentMonthNum}/${currentYear}`;
  const currentTimeStr = `${String(nowVN.getUTCHours()).padStart(2, '0')}:${String(nowVN.getUTCMinutes()).padStart(2, '0')}`;
  const nowFormatted = `${currentTimeStr} ngày ${todayFormatted}`;

  let extractedMonth = null;
  const monthMatch = query.match(/(?:tháng\s*|tháng\s*0?)(\d{1,2})(?:\s*[\/\-]\s*(\d{4})|\s*năm\s*(\d{4}))?/i);
  if (monthMatch) {
    const m = String(monthMatch[1]).padStart(2, '0');
    const y = monthMatch[2] || monthMatch[3] || currentYear;
    extractedMonth = `${y}-${m}`;
  } else {
    const yyyyMm = query.match(/\b(202\d)-(0[1-9]|1[0-2])\b/);
    if (yyyyMm) extractedMonth = yyyyMm[0];
  }
  if (!extractedMonth) {
    extractedMonth = `${currentYear}-${currentMonthNum}`;
  }

  // 0.1 Step 0b: Check-in / Check-out request or attendance status inquiry guardrail
  const isDirectCheckinAttempt = /(?:giúp|hộ|cho|thay|tự động|thực hiện)\s*(?:tôi|em|mình)?\s*(?:check[- ]?in|chấm công|check[- ]?out)|(?:check[- ]?in|chấm công|check[- ]?out)\s*(?:giúp|hộ|cho|thay|hôm nay|bây giờ|ngay|luôn)|^(?:check[- ]?in|chấm công)\s*(?:hôm nay|bây giờ)?$/i.test(query);
  const isTodayAttendanceQuery = /(?:hôm nay|ngày này).*(?:chấm công|check[- ]?in|đi làm chưa)|(?:chấm công|check[- ]?in).*(?:hôm nay|chưa\b)/i.test(query);

  if (isDirectCheckinAttempt || isTodayAttendanceQuery) {
    let todayAtt = null;
    try {
      todayAtt = await env.DB.prepare(`
        SELECT id, date, checkin_time, checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
          FROM attendance
         WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
           AND date = ?
         LIMIT 1
      `).bind(me.id, String(me.id), todayYMD).first();
    } catch (_) {
      try {
        todayAtt = await env.DB.prepare(`
          SELECT id, work_date as date, check_in as checkin_time, check_out as checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
            FROM attendance
           WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
             AND work_date = ?
           LIMIT 1
        `).bind(me.id, String(me.id), todayYMD).first();
      } catch (_) {}
    }

    const hasCheckedIn = Boolean(todayAtt && (todayAtt.checkin_time || todayAtt.check_in));
    let checkinResponseText = '';
    let navCard = null;

    if (hasCheckedIn) {
      const checkinTime = todayAtt.checkin_time || todayAtt.check_in;
      const isLate = Number(todayAtt.late_minutes) > 0;
      const statusText = isLate ? `Đi muộn ${todayAtt.late_minutes} phút` : 'Đúng giờ';
      checkinResponseText = `Hôm nay (**${todayFormatted}**), bạn đã thực hiện Check-in vào lúc **${checkinTime}** với trạng thái **${statusText}**.\n\nHệ thống Chấm công đã ghi nhận đầy đủ dữ liệu của bạn, không cần check-in lại.`;
      if (todayAtt.checkout_time || todayAtt.check_out) {
        checkinResponseText += `\nGiờ Check-out ghi nhận: **${todayAtt.checkout_time || todayAtt.check_out}**.`;
      }
    } else {
      checkinResponseText = `Trợ lý ảo **không thể thực hiện chấm công thay nhân sự**.\n\nTheo quy chế bảo mật và kỷ luật của NetViet HR, thao tác **Check-in / Check-out** bắt buộc phải thực hiện trực tiếp trên thiết bị của bạn nhằm xác thực **tọa độ GPS Geofence văn phòng** (bán kính cho phép) và **mạng WiFi Whitelist** nội bộ.\n\nBạn vui lòng bấm vào nút bên dưới để mở màn hình **Chấm công** và thực hiện Check-in:`;
      navCard = {
        isNavigationCard: true,
        title: 'Màn hình Chấm công',
        icon: 'clock3',
        link: '#/attendance',
        buttonText: 'Mở màn hình Chấm công'
      };
    }

    await onEvent('status', { message: 'Đang phản hồi...' });
    for await (const chunk of streamPacedText(checkinResponseText, 12)) {
      await onEvent('delta', { text: chunk });
    }

    await logAiInteraction(env, {
      id: reqId,
      userId: me.id,
      conversationId,
      sessionRole: me.role || 'employee',
      queryText: query,
      responseText: checkinResponseText,
      provider: 'edge-guardrail',
      modelName: 'attendance-compliance-guard',
      promptTokens: estimateTokens(query),
      completionTokens: estimateTokens(checkinResponseText),
      estimatedCostUsd: 0,
      ttftMs: 5,
      totalLatencyMs: 15,
      retrievedChunksJson: [],
      toolsCalledJson: [{ name: 'attendance_checkin_compliance', args: { today: todayYMD, hasCheckedIn } }]
    });

    await onEvent('done', {
      requestId: reqId,
      content: checkinResponseText,
      citations: [],
      actionCard: navCard,
      executedAction: null,
      telemetry: {
        provider: 'edge-guardrail',
        model: 'attendance-compliance-guard',
        tokens: { prompt: estimateTokens(query), completion: estimateTokens(checkinResponseText), total: estimateTokens(query) + estimateTokens(checkinResponseText) },
        cost: { costUsd: 0, costVnd: 0 },
        latencyMs: 15,
        retrievedChunkCount: 0
      }
    });
    return;
  }

  // 1. Step 1: Detect intent & Run Hybrid RAG
  const isPolicyQuery = /muộn|trễ|phạt|giờ làm|quy định|nội quy|nghỉ phép|phép năm|ốm|bảo mật|chính sách|phúc lợi/i.test(query);
  let ragResult = { results: [], contextText: '', citations: [] };
  if (isPolicyQuery) {
    await onEvent('status', { message: 'Đang tra cứu cơ sở tri thức nội quy RAG...' });
    ragResult = await hybridSearch(env, { query, limit: 3 });
  }

  // 2. Step 2: Detect operational commands & query tools
  let toolData = null;
  let toolNameCalled = null;
  let actionCard = null;
  let executedAction = null;

  const taskStatusMatch = query.match(/(?:hoàn thành|xong|đã xong|done|kết thúc)\s+(?:task|công việc|nhiệm vụ)?\s*#?(\d+)/i)
    || query.match(/(?:đổi|chuyển|cập nhật|set)\s+(?:trạng thái\s+)?(?:task|công việc)?\s*#?(\d+)\s*(?:sang|thành|là)?\s*(hoàn thành|xong|done|đang làm|in-progress|chờ|todo|hủy|cancelled)/i)
    || query.match(/(?:chuyển|đổi)\s+(?:task|công việc)?\s*#?(\d+)\s*(?:sang|thành)\s*(đang làm|in-progress)/i);
  const taskAssignMatch = query.match(/(?:giao|phân công|chuyển|assign)\s+(?:task|công việc)?\s*#?(\d+)\s+cho\s+([a-zA-ZÀ-ỹ0-9_\s]+)/i);
  const taskDeadlineMatch = query.match(/(?:đổi|sửa|cập nhật|dời)\s+(?:hạn|hạn chót|deadline)\s+(?:task|công việc)?\s*#?(\d+)\s*(?:sang|đến|thành)?\s*([a-zA-ZÀ-ỹ0-9_\s\-\/]+)/i);
  const taskPriorityMatch = query.match(/(?:đổi|sửa|cập nhật)\s+(?:mức độ\s+)?(?:ưu tiên|priority)\s+(?:task|công việc)?\s*#?(\d+)\s*(?:sang|thành)?\s*(khẩn cấp|urgent|cao|high|trung bình|medium|thấp|low)/i);
  const taskDeleteMatch = query.match(/(?:xóa|hủy bỏ|delete)\s+(?:task|công việc|nhiệm vụ)\s*#?(\d+)/i);
  const leaveApproveMatch = query.match(/(?:duyệt|phê duyệt|approve)\s+(?:đơn\s+)?(?:nghỉ phép|nghỉ)?\s*#?(\d+)/i);
  const leaveRejectMatch = query.match(/(?:từ chối|reject)\s+(?:đơn\s+)?(?:nghỉ phép|nghỉ)?\s*#?(\d+)(?:\s*(?:vì|lý do)?\s*(.*))?/i);
  const leaveCancelMatch = query.match(/(?:hủy|cancel)\s+(?:đơn\s+)?(?:nghỉ phép|nghỉ)\s*#?(\d+)/i);
  const annPostMatch = query.match(/(?:đăng thông báo|tạo thông báo|phát thông báo)\s*:?\s*(.+)/i);
  const empCodeMatch = query.match(/(?:đổi|cập nhật|sửa)\s+mã\s+nhân\s+viên\s+của\s+([a-zA-ZÀ-ỹ0-9_\s]+)\s+thành\s+([a-zA-Z0-9_\-]+)/i);
  const payReviewMatch = query.match(/(?:khiếu nại|xem lại|phúc tra|thắc mắc|sai lệch)\s+(?:bảng lương|phiếu lương|tiền lương)/i);
  const handoverConfirmMatch = query.match(/(?:xác nhận bàn giao|đã nhận bàn giao)\s*#?(\d+)/i);
  const handoverCreateMatch = query.match(/(?:tạo biên bản bàn giao|bàn giao tài sản|bàn giao dự án)\s*:?\s*(.+)/i);

  if (taskStatusMatch || taskAssignMatch || taskDeadlineMatch || taskPriorityMatch || taskDeleteMatch || leaveApproveMatch || leaveRejectMatch || leaveCancelMatch || annPostMatch || empCodeMatch || payReviewMatch || handoverConfirmMatch || handoverCreateMatch || /kiểm toán.*lương|audit.*payroll/i.test(query) || /bảng lương|phiếu lương|tiền lương của tôi/i.test(query) || /chấm công|đi muộn|đi trễ/i.test(query) || /quỹ phép|ngày phép còn lại/i.test(query) || /(?:tổng quan|thống kê).*nghỉ phép/i.test(query) || /thông báo mới|bản tin/i.test(query) || /hướng dẫn.*module|phân hệ/i.test(query) || /task của tôi|công việc của tôi/i.test(query) || /xin nghỉ phép|tạo đơn nghỉ/i.test(query) || (/tạo task|tạo việc/i.test(query) && query.length > 5)) {
    await onEvent('status', { message: 'Đang kết nối phân hệ nghiệp vụ & kiểm tra dữ liệu...' });
  }

  if (taskStatusMatch) {
    toolNameCalled = 'task_update_status';
    const taskId = Number(taskStatusMatch[1]);
    const rawStatus = taskStatusMatch[2] || 'done';
    toolData = await executeTool(env, toolNameCalled, { taskId, status: rawStatus }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskAssignMatch) {
    toolNameCalled = 'task_assign';
    const taskId = Number(taskAssignMatch[1]);
    const assigneeName = String(taskAssignMatch[2]).trim();
    toolData = await executeTool(env, toolNameCalled, { taskId, assigneeName }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskDeadlineMatch) {
    toolNameCalled = 'task_update_details';
    const taskId = Number(taskDeadlineMatch[1]);
    const dueDate = String(taskDeadlineMatch[2]).trim();
    toolData = await executeTool(env, toolNameCalled, { taskId, dueDate }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskPriorityMatch) {
    toolNameCalled = 'task_update_details';
    const taskId = Number(taskPriorityMatch[1]);
    const p = String(taskPriorityMatch[2]).toLowerCase();
    const priority = (p.includes('urgent') || p.includes('khẩn')) ? 'urgent' : (p.includes('high') || p.includes('cao')) ? 'high' : (p.includes('low') || p.includes('thấp')) ? 'low' : 'medium';
    toolData = await executeTool(env, toolNameCalled, { taskId, priority }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (taskDeleteMatch) {
    toolNameCalled = 'task_delete';
    toolData = await executeTool(env, toolNameCalled, { taskId: Number(taskDeleteMatch[1]) }, me);
    if (toolData.isActionCard) actionCard = toolData;
  } else if (leaveApproveMatch) {
    toolNameCalled = 'leave_approve';
    toolData = await executeTool(env, toolNameCalled, { requestId: Number(leaveApproveMatch[1]) }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (leaveRejectMatch) {
    toolNameCalled = 'leave_reject';
    toolData = await executeTool(env, toolNameCalled, { requestId: Number(leaveRejectMatch[1]), reason: leaveRejectMatch[2] }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (leaveCancelMatch) {
    toolNameCalled = 'leave_cancel';
    toolData = await executeTool(env, toolNameCalled, { requestId: Number(leaveCancelMatch[1]) }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (annPostMatch) {
    toolNameCalled = 'announcement_post';
    const content = annPostMatch[1].trim();
    toolData = await executeTool(env, toolNameCalled, { title: content.slice(0, 50), content }, me);
    if (toolData.isActionCard) actionCard = toolData;
    else if (toolData.executed) executedAction = toolData;
  } else if (empCodeMatch) {
    toolNameCalled = 'employee_update_code';
    toolData = await executeTool(env, toolNameCalled, { employeeName: empCodeMatch[1].trim(), employeeCode: empCodeMatch[2].trim() }, me);
    if (toolData.isActionCard) actionCard = toolData;
  } else if (payReviewMatch) {
    toolNameCalled = 'payroll_request_review';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth, message: query }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (handoverConfirmMatch) {
    toolNameCalled = 'handover_confirm';
    toolData = await executeTool(env, toolNameCalled, { handoverId: Number(handoverConfirmMatch[1]) }, me);
    if (toolData.executed) executedAction = toolData;
  } else if (handoverCreateMatch) {
    toolNameCalled = 'handover_create';
    toolData = await executeTool(env, toolNameCalled, { assetName: handoverCreateMatch[1].trim() }, me);
    if (toolData.isActionCard) actionCard = toolData;
  } else if (/kiểm toán.*lương|audit.*payroll|bất thường.*bảng lương|soát lương/i.test(query)) {
    toolNameCalled = 'audit_payroll_anomalies';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/bảng lương|phiếu lương|tiền lương của tôi|lương tháng|thu nhập của tôi|thực nhận của tôi/i.test(query) || (isSalaryQuery && isSelfPayroll)) {
    toolNameCalled = 'get_my_payslip_summary';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/chấm công|đi muộn|đi trễ|vào muộn|vào trễ|trễ bao nhiêu|muộn bao nhiêu|lần trễ|lần muộn|tiền phạt|bảng công|công tháng|ngày công|lịch sử chấm/i.test(query)) {
    toolNameCalled = 'get_my_attendance_summary';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/quỹ phép|ngày phép còn lại|phép năm còn|hạn mức phép|còn bao nhiêu ngày phép/i.test(query)) {
    toolNameCalled = 'get_leave_balance';
    toolData = await executeTool(env, toolNameCalled, {}, me);
  } else if (/(?:tổng quan|thống kê|xem|tổng hợp|danh sách|lý do|lí do).*mọi người.*nghỉ phép|(?:lý do|lí do).*nghỉ phép.*(mọi người|nhân sự|nhân viên|công ty|phòng ban)|(?:tổng quan|tình hình|ai).*nghỉ phép|mọi người.*nghỉ phép.*vì|lý do.*nghỉ phép/i.test(query)) {
    toolNameCalled = 'get_leave_requests_overview';
    toolData = await executeTool(env, toolNameCalled, { month: 'all', status: 'all' }, me);
  } else if (/thông báo mới|bản tin|tin tức công ty|quyết định mới/i.test(query)) {
    toolNameCalled = 'get_announcements_summary';
    toolData = await executeTool(env, toolNameCalled, { limit: 5 }, me);
  } else if (/hướng dẫn.*(module|phân hệ|chức năng)|(làm sao|cách dùng|chức năng).*(dashboard|chat|bàn giao|địa điểm|cài đặt|nhân viên)/i.test(query)) {
    toolNameCalled = 'get_system_module_info';
    toolData = await executeTool(env, toolNameCalled, { moduleName: query }, me);
  } else if (/task của tôi|công việc của tôi|danh sách task|việc cần làm/i.test(query)) {
    toolNameCalled = 'list_my_tasks';
    toolData = await executeTool(env, toolNameCalled, {}, me);
  } else if (/xin nghỉ phép|tạo đơn nghỉ|đăng ký nghỉ/i.test(query)) {
    toolNameCalled = 'create_leave_request_draft';
    const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || [];
    const startDate = dates[0] || parseRelativeDate(query, new Date().toISOString().slice(0, 10));
    const endDate = dates[1] || startDate;
    toolData = await executeTool(env, toolNameCalled, {
      leaveType: 'annual',
      startDate,
      endDate,
      reason: query
    }, me);
    actionCard = toolData;
  } else if (/tạo task|tạo việc|thêm công việc/i.test(query) && query.length > 5) {
    toolNameCalled = 'create_task_draft';
    const titleMatch = query.replace(/^(tạo task|tạo việc|thêm công việc)\s*:?/i, '').trim();
    const isDirect = /làm luôn|tạo luôn|thêm ngay|lập tức/i.test(query);
    toolData = await executeTool(env, toolNameCalled, {
      title: titleMatch || 'Công việc mới từ AI Copilot',
      priority: 'medium',
      autoExecute: isDirect
    }, me);
    if (toolData.executed) executedAction = toolData;
    else actionCard = toolData;
  }

  // 3. Step 3: Build Grounded System Instruction
  let systemPrompt = `Bạn là Trợ lý ảo HR NetViet - Trợ lý AI chuyên trách nền tảng quản trị nhân sự NetViet HR.
Người dùng hiện tại: ${me.full_name} (Mã NV: ${me.employee_code || 'NV'}, Vai trò: ${me.role || 'employee'}, Phòng ban: ${me.department || 'Chung'}).
THỜI GIAN THỰC TẾ HIỆN TẠI CỦA HỆ THỐNG: ${nowFormatted} (Múi giờ Việt Nam UTC+7).
Năm hiện tại là ${currentYear}. TUYỆT ĐỐI KHÔNG dùng các năm cũ như 2023, 2024.

DANH MỤC 12 PHÂN HỆ HỆ THỐNG:
1. Dashboard: Báo cáo tỷ lệ chuyên cần, quân số đi làm, đi muộn, việc cần làm, sinh nhật.
2. Thông báo: Tin tức, thông tư, quyết định điều động/khen thưởng, file đính kèm, lượt đọc.
3. Chat: Kênh thảo luận thời gian thực WebSocket/Durable Object, chat chung & phòng ban, poll bình chọn, ghim tin nhắn, @mention.
4. Chấm công: Check-in/out GPS geofence văn phòng & WiFi Whitelist, selfie. Chuẩn 08:30 - 17:00 (mốc 08:35 đúng giờ, từ 08:36 tính muộn). Miễn phạt 2 lần/tháng đầu tiên; từ lần 3 phạt 20.000đ/lần. Tự động checkout lúc 17:05 UTC.
5. Nghỉ phép: Quy trình duyệt 2 bước (Bước 1: Quản lý trực tiếp -> Bước 2: HCNS duyệt cuối). Quỹ phép năm 12 ngày/năm (1 ngày/tháng).
6. Công việc (Tasks): Bảng Kanban/Danh sách, mức ưu tiên (low, medium, high, urgent), deadline, giao việc, đính kèm file, cập nhật tiến độ.
7. Phiếu lương (Invoices): Tra cứu phiếu lương cá nhân từng tháng, lương cơ bản, ngày công, thưởng KPI, phụ cấp, giảm trừ phạt đi muộn, bảo hiểm, thuế, thực nhận (Net), xác nhận phiếu hoặc gửi yêu cầu xem lại.
8. Bàn giao: Bàn giao thiết bị tài sản, tài khoản hệ thống và tiến độ dự án khi thôi việc/chuyển công tác.
9. Nhân viên: Danh bạ, hồ sơ hợp đồng, CCCD, phân quyền. Admin có quyền đổi mã nhân viên (employee_code).
10. Bảng lương: Tổng hợp bảng lương công ty (Admin/HCNS), import/export Excel, đồng bộ công, kiểm toán AI bất thường.
11. Địa điểm chấm công: Tọa độ GPS văn phòng, bán kính geofence mét, danh sách WiFi Whitelist.
12. Cài đặt: Giờ làm việc chuẩn, mốc phạt, quản trị database Cloudflare D1.

QUY TẮC XƯNG HÔ VÀ ĐẠI TỪ NHÂN XƯNG (BẮT BUỘC):
- Bạn luôn tự xưng là "Tôi" (Trợ lý AI NetViet).
- Bạn luôn gọi người dùng là "Bạn".
- Xử lý đại từ nhân xưng của người dùng: Người dùng có thể xưng hô tự nhiên như "tôi", "em", "mình", "anh". Khi người dùng hỏi các câu như "lương của em tháng này", "hôm nay anh đã chấm công chưa", "task của mình", BẮT BUỘC hiểu đây là thông tin của chính người dùng hiện tại (${me.full_name}). Tuyệt đối KHÔNG hiểu nhầm là đang hỏi nhân sự khác và KHÔNG từ chối vô lý.

QUY TẮC PHẢN HỒI (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT):
1. PHONG CÁCH: Nghiêm túc, điềm đạm, chuẩn mực hành chính công sở.
2. NGẮN GỌN & ĐI THẲNG VÀO TRỌNG TÂM:
- Đi thẳng vào kết quả hoặc số liệu cốt lõi trong tối đa 1 - 3 câu ngắn hoặc danh sách gạch đầu dòng cô đọng. Tuyệt đối KHÔNG trả lời cụt lủn 1-2 từ.
- TUYỆT ĐỐI KHÔNG chào hỏi mở đầu rườm rà (nghiêm cấm các câu như: "Xin chào bạn, tôi là...", "Chào bạn! Tôi rất vui được hỗ trợ...").
- TUYỆT ĐỐI KHÔNG đưa ra câu kết mớm lời hay câu hỏi thừa thãi (nghiêm cấm: "Nếu bạn cần giúp gì thêm...", "Hy vọng thông tin này giúp ích...", "Bạn có muốn...", "Hãy cho tôi biết nếu..."). Dừng lại ngay lập tức sau khi hoàn thành nội dung.
3. ĐỐI VỚI CÂU HỎI VỀ KIẾN THỨC BÊN NGOÀI: Sẵn sàng giải đáp ngắn gọn, chuẩn xác.
4. QUY TẮC BẢO MẬT: Tuyệt đối không tiết lộ lương, CCCD, thông tin riêng tư của người khác cho tài khoản không có quyền Admin/HCNS.
5. ĐỊNH DẠNG DỮ LIỆU: Luôn in đậm (**...**) các số liệu, ngày tháng, tên người, kết quả và trạng thái quan trọng.
6. TUYỆT ĐỐI KHÔNG GIẢ MẠO CHẤM CÔNG HOẶC HÀNH ĐỘNG HỆ THỐNG:
- Trợ lý AI tuyệt đối KHÔNG giả lập, không bịa đặt hoặc thông báo đã check-in / check-out thành công cho người dùng qua chat. Thao tác chấm công bắt buộc nhân sự phải tự thao tác trên thiết bị cá nhân tại văn phòng để xác thực GPS Geofence và WiFi Whitelist.
7. BẮT BUỘC TRẢ LỜI TỪ DỮ LIỆU THỰC TẾ (GROUNDED DATA):
- Khi người dùng hỏi về lý do nghỉ phép, tình hình công việc, chấm công: BẮT BUỘC trả lời dựa trên số liệu thực tế được cung cấp trong [TOOL DATA].
- TUYỆT ĐỐI KHÔNG trả lời lý thuyết chung chung sách giáo khoa. Phải tổng kết cụ thể số liệu thực tế.
`;

  if (ragResult.contextText) {
    systemPrompt += `\n--- TÀI LIỆU TRI THỨC NỘI QUY TRÍCH XUẤT (RAG CONTEXT) ---\n${ragResult.contextText}\n----------------------------------------------------\n`;
  }

  if (toolData && !actionCard) {
    systemPrompt += `\n--- DỮ LIỆU THỰC TẾ HỆ THỐNG TRÍCH XUẤT (TOOL DATA) ---\n${JSON.stringify(toolData, null, 2)}\n----------------------------------------------------\n`;
  }

  // 4. Step 4: Stream inference
  await onEvent('status', { message: 'Đang tổng hợp và tạo câu trả lời...' });

  const chatMessages = [
    ...conversationHistory.slice(-4),
    { role: 'user', content: query }
  ];

  let accumulatedContent = '';
  let completionInfo = null;
  let firstTokenTime = null;

  for await (const chunk of chatCompletionStream(env, {
    messages: chatMessages,
    systemPrompt,
    tools: COPILOT_TOOLS,
    temperature: 0.1,
    maxTokens: 800,
    toolData
  })) {
    if (chunk.type === 'tool_call') {
      toolNameCalled = chunk.name;
      await onEvent('status', { message: `Đang kết nối phân hệ: ${chunk.name}...` });
      const auth = verifyToolAuthorization(chunk.name, chunk.args, me);
      if (!auth.allowed) {
        const denyText = `🛡️ **Từ chối quyền thực thi tác vụ (${chunk.name}):**\n\n${auth.message}`;
        accumulatedContent += denyText;
        await onEvent('delta', { text: denyText });
      } else {
        const res = await executeTool(env, chunk.name, chunk.args, me);
        if (res.isActionCard) {
          actionCard = res;
          const cardNotice = `Tôi đã chuẩn bị thẻ thao tác bên dưới để bạn kiểm tra và xác nhận:\n\n`;
          accumulatedContent += cardNotice;
          await onEvent('delta', { text: cardNotice });
        } else if (res.executed) {
          executedAction = res;
        } else {
          toolData = res;
        }
      }
    } else if (chunk.type === 'delta') {
      if (!firstTokenTime) {
        firstTokenTime = Date.now();
      }
      accumulatedContent += chunk.text;
      await onEvent('delta', { text: chunk.text });
    } else if (chunk.type === 'done') {
      completionInfo = chunk;
    }
  }

  const totalTimeMs = Date.now() - reqStartTime;
  // True TTFT (Time To First Token) measured on real streamed tokens (P0.7)
  const trueTtftMs = firstTokenTime ? (firstTokenTime - reqStartTime) : Math.round(totalTimeMs * 0.4);
  let cleanContent = (executedAction?.message && completionInfo?.provider === 'edge-local')
    ? executedAction.message
    : stripFollowUpSuggestions(maskPII(accumulatedContent || completionInfo?.content || ''));

  // P1.4: Citation Grounding & Anti-Hallucination Verification
  cleanContent = verifyAndCleanCitations(cleanContent, ragResult.citations);

  // 5. Step 5: Save Telemetry Log to Database (LLMOps)
  await logAiInteraction(env, {
    id: reqId,
    userId: me.id,
    conversationId,
    sessionRole: me.role || 'employee',
    queryText: query,
    responseText: cleanContent,
    provider: completionInfo?.provider || 'edge-local',
    modelName: completionInfo?.model || 'edge-heuristic-v1',
    promptTokens: completionInfo?.tokens?.prompt || estimateTokens(query),
    completionTokens: completionInfo?.tokens?.completion || estimateTokens(cleanContent),
    estimatedCostUsd: completionInfo?.cost?.costUsd || 0,
    ttftMs: trueTtftMs,
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

  await onEvent('done', {
    requestId: reqId,
    content: cleanContent,
    citations: ragResult.citations,
    actionCard,
    executedAction,
    telemetry: {
      provider: completionInfo?.provider || 'edge-local',
      model: completionInfo?.model || 'edge-heuristic-v1',
      tokens: completionInfo?.tokens || { prompt: estimateTokens(query), completion: estimateTokens(cleanContent), total: estimateTokens(query) + estimateTokens(cleanContent) },
      cost: completionInfo?.cost || { costUsd: 0, costVnd: 0 },
      ttftMs: trueTtftMs,
      latencyMs: totalTimeMs,
      retrievedChunkCount: ragResult.results.length,
      debugErrors: isPrivileged ? (completionInfo?.debugErrors || []) : undefined
    }
  });
}
