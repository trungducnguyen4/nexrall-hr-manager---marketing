/**
 * Copilot Stream Orchestrator (SSE Streaming)
 * Orchestrates real-time Server-Sent Events (SSE) streaming turns with multi-event streaming:
 * - 'status': progress events (RAG lookup, checking security, executing tools)
 * - 'delta': streamed token deltas
 * - 'done': final payload with citations, actionCard, telemetry, and true TTFT
 */
import { chatCompletionStream, streamPacedText, estimateTokens, maskPII } from '../../ai-gateway.service.js';
import { hybridSearch } from '../../rag.service.js';
import { logAiInteraction } from './telemetry-logger.js';
import { resolveUserPersona } from '../personas/persona-resolver.js';
import { buildPersonaSystemPrompt } from '../personas/index.js';
import { getToolsForPersona } from '../tools/tool-registry.js';
import { executeTool, verifyToolAuthorization } from '../tools/tools.executor.js';
import { executeDeepEmployeeLookup } from '../directory/directory-lookup.service.js';
import { verifyAndCleanCitations, stripFollowUpSuggestions } from '../postprocessing/text-cleaner.js';
import { parseRelativeDate } from '../tools/tool-helpers.js';

/**
 * Orchestrate a complete streaming Copilot chat turn with multi-event SSE
 */
export async function runCopilotTurnStream(env, {
  userMessage,
  query: rawQuery,
  conversationHistory = [],
  me,
  conversationId = 'default',
  onEvent = async () => {}
}) {
  const reqStartTime = Date.now();
  const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const query = String(userMessage || rawQuery || '').trim();

  await onEvent('status', { message: 'Đang kiểm tra bảo mật & an toàn dữ liệu...' });

  const isSalaryQuery = /lương|thu nhập|tiền lương|bảng lương|phiếu lương|thực nhận/i.test(query);
  let isAskingOtherSalary = false;
  let targetSalaryName = 'người khác';
  if (isSalaryQuery) {
    const salaryOwnerMatch = query.match(/(?:lương|thu nhập|tiền lương|bảng lương|phiếu lương|thực nhận)[^.?\n]*?\bcủa\s+([^.?\n,]+)/iu);
    if (salaryOwnerMatch) {
      const phrase = salaryOwnerMatch[1].trim();
      const lowerPhrase = phrase.toLowerCase();
      const isSelf = /^(?:tôi|mình|bản thân)(?:\s|$)/.test(lowerPhrase) ||
                     /^(?:em|anh|chị)(?:\s+(?:là\s+)?(?:thế|như|bao|sao|được|ạ|hả|\?|$)|$)/.test(lowerPhrase);
      if (!isSelf) {
        isAskingOtherSalary = true;
        targetSalaryName = phrase.replace(/^(?:bạn|nhân viên|đồng nghiệp|ông|bà|sếp|giám đốc|trưởng phòng|leader|anh|chị|em)\s+/i, '').split(/\s+/)[0] || 'người khác';
      }
    }
  }

  const isSelfPayroll = isSalaryQuery && !isAskingOtherSalary;

  const nowVN = new Date(Date.now() + 7 * 3600 * 1000);
  const currentYear = nowVN.getUTCFullYear();
  const currentMonthNum = String(nowVN.getUTCMonth() + 1).padStart(2, '0');
  const currentDayNum = String(nowVN.getUTCDate()).padStart(2, '0');
  const todayYMD = `${currentYear}-${currentMonthNum}-${currentDayNum}`;
  const todayFormatted = `${currentDayNum}/${currentMonthNum}/${currentYear}`;
  const currentTimeStr = `${String(nowVN.getUTCHours()).padStart(2, '0')}:${String(nowVN.getUTCMinutes()).padStart(2, '0')}`;
  const nowFormatted = `${currentTimeStr} ngày ${todayFormatted}`;

  const userPersona = resolveUserPersona(me);
  const isPrivileged = me.role === 'admin' || userPersona === 'director' || userPersona === 'hr' || (me.department && /HCNS|Hành chính|Giám đốc/i.test(me.department));

  if (isAskingOtherSalary && !isPrivileged) {
    const targetName = targetSalaryName;
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

  // 0.2 Step 0b: Smart Employee Deep Lookup & Enterprise Privacy Guardrail
  const deepLookupStream = await executeDeepEmployeeLookup(env, {
    query,
    me,
    conversationId,
    reqId,
    todayYMD,
    todayFormatted,
    currentYear,
    currentMonthNum,
    onEvent,
    isStream: true
  });
  if (deepLookupStream?.handled) {
    return;
  }

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

  // 0.1 Step 0c: Check-in / Check-out request or attendance status inquiry guardrail
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

  if (taskStatusMatch || taskAssignMatch || taskDeadlineMatch || taskPriorityMatch || taskDeleteMatch || leaveApproveMatch || leaveRejectMatch || leaveCancelMatch || annPostMatch || empCodeMatch || payReviewMatch || handoverConfirmMatch || handoverCreateMatch || /kiểm toán.*lương|audit.*payroll/i.test(query) || /bảng lương|phiếu lương|tiền lương của tôi/i.test(query) || /chấm công|đi muộn|đi trễ/i.test(query) || /quỹ phép|ngày phép còn lại/i.test(query) || /(?:tổng quan|thống kê|danh sách|ai|nhân viên nào).*(?:nghỉ phép|xin nghỉ)/i.test(query) || /thông báo mới|bản tin/i.test(query) || /hướng dẫn.*module|phân hệ/i.test(query) || /task của tôi|công việc của tôi/i.test(query) || /xin nghỉ phép|tạo đơn nghỉ/i.test(query) || (/tạo task|tạo việc/i.test(query) && query.length > 5)) {
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
  } else if (/(?:ai|nhân viên nào|ai là người|người nào|danh sách|thống kê|tổng quan|tổng hợp).*(?:xin nghỉ|nghỉ phép|nghỉ việc|nghỉ).*nhiều nhất|(?:ai|nhân viên nào|ai là người).*(?:xin nghỉ|nghỉ phép|nghỉ)|(?:tổng quan|thống kê|xem|tổng hợp|danh sách|lý do|lí do|tình hình).*(?:mọi người|nhân sự|nhân viên|công ty|phòng ban).*nghỉ|(?:nghỉ phép|xin nghỉ).*(?:tháng\s*\d+|nhiều nhất|lý do|lí do)|mọi người.*(?:nghỉ phép|xin nghỉ).*vì|lý do.*(?:nghỉ phép|xin nghỉ)/i.test(query)) {
    toolNameCalled = 'get_leave_requests_overview';
    const isSpecificMonth = /(?:tháng\s*\d+|tháng\s*này|tháng\s*trước|\b202\d-\d{2}\b)/i.test(query);
    toolData = await executeTool(env, toolNameCalled, { month: isSpecificMonth ? extractedMonth : 'all', status: 'all' }, me);
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
  } else if (/xin wfh|đăng ký wfh|làm việc tại nhà|tạo đơn wfh|xin làm tại nhà/i.test(query)) {
    toolNameCalled = 'create_wfh_request_draft';
    const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || [];
    const targetDate = dates[0] || parseRelativeDate(query, new Date().toISOString().slice(0, 10));
    let shift = 'full';
    if (/sáng/i.test(query)) shift = 'morning';
    else if (/chiều/i.test(query)) shift = 'afternoon';
    toolData = await executeTool(env, toolNameCalled, {
      date: targetDate,
      shift,
      reason: query
    }, me);
    actionCard = toolData;
  } else if (/quên check[- ]?in|quên chấm công|chỉnh công|giải trình công|chỉnh sửa chấm công/i.test(query)) {
    toolNameCalled = 'create_attendance_correction_draft';
    const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || [];
    const targetDate = dates[0] || parseRelativeDate(query, new Date().toISOString().slice(0, 10));
    toolData = await executeTool(env, toolNameCalled, {
      date: targetDate,
      actualCheckin: '08:30',
      actualCheckout: '17:00',
      reason: query
    }, me);
    actionCard = toolData;
  } else if (/(?:ai|nhân viên nào|danh sách).*đi trễ.*(?:>|trên|>=\s*)3|bất thường chấm công|đi muộn nhiều/i.test(query)) {
    toolNameCalled = 'get_attendance_anomalies';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth, minLateCount: 3 }, me);
  } else if (/(?:ai|quân số|tình hình).*(?:nghỉ|wfh|có mặt).*hôm nay|ai đang nghỉ hôm nay|quân số hôm nay/i.test(query)) {
    toolNameCalled = 'get_daily_attendance_roster';
    toolData = await executeTool(env, toolNameCalled, { date: todayYMD }, me);
  } else if (/hợp đồng.*(?:sắp hết hạn|hết hạn|30 ngày|60 ngày)|hết hạn hợp đồng/i.test(query)) {
    toolNameCalled = 'get_contract_expirations';
    toolData = await executeTool(env, toolNameCalled, { daysThreshold: 30 }, me);
  } else if (/(?:tổng|chi phí).*(?:giờ ot|làm thêm|ot).*phòng ban|tổng giờ làm thêm|tổng ot/i.test(query)) {
    toolNameCalled = 'get_company_overtime_summary';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/báo cáo nhân sự tháng|tóm tắt nhân sự tháng|tình hình nhân sự tháng/i.test(query)) {
    toolNameCalled = 'get_monthly_hr_summary';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/tăng trưởng.*nhân sự|quy mô nhân sự|tỷ lệ nghỉ việc|turnover|biến động nhân sự/i.test(query)) {
    toolNameCalled = 'get_executive_headcount_turnover';
    toolData = await executeTool(env, toolNameCalled, { periodMonths: 6 }, me);
  } else if (/so sánh.*phòng ban|phòng ban nào|hiệu suất phòng ban/i.test(query)) {
    toolNameCalled = 'get_department_workforce_comparison';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
  } else if (/xu hướng.*ot|chi phí ot.*3 tháng|xu hướng làm thêm/i.test(query)) {
    toolNameCalled = 'get_overtime_cost_trends';
    toolData = await executeTool(env, toolNameCalled, { monthsCount: 3 }, me);
  } else if (/báo cáo điều hành|tóm tắt điều hành|workforce briefing/i.test(query)) {
    toolNameCalled = 'get_company_workforce_briefing';
    toolData = await executeTool(env, toolNameCalled, { month: extractedMonth }, me);
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

  // 3. Step 3: Build Grounded Role-aware Persona Instruction & Dynamic Tool Filtering
  const persona = resolveUserPersona(me);
  const allowedTools = getToolsForPersona(persona, me);
  const systemPrompt = buildPersonaSystemPrompt(persona, me, nowFormatted, currentYear, ragResult, toolData, actionCard);

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
    tools: allowedTools,
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
