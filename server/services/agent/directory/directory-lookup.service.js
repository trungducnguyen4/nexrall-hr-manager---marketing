/**
 * Deep Multi-dimensional Employee Directory Lookup Engine
 * Executes rich adaptive queries with attendance, leave balances, and lifecycle metrics.
 */
import { streamPacedText, logAiInteraction, estimateTokens } from '../../ai-gateway.service.js';
import {
  stripVietnameseAccents,
  extractEmployeeLookupIntent,
  findEmployeesByNameGroup,
  findEmployeeSmart
} from './employee-matcher.js';

export async function executeDeepEmployeeLookup(env, {
  query,
  me,
  conversationId = 'default',
  reqId,
  todayYMD,
  todayFormatted,
  currentYear,
  currentMonthNum,
  onEvent = null,
  isStream = false
}) {
  const intent = extractEmployeeLookupIntent(query, me);
  if (!intent) return null;

  const role = String(me?.role || '').toLowerCase();
  const dept = String(me?.department || '').toLowerCase();
  const code = String(me?.employee_code || '').toUpperCase();
  const isDirectorOrAdmin = role === 'admin' || role === 'director' || role === 'manager_director' || code === 'BGD-01' || code === 'BGD-02' || code === 'NV-ADMIN' || code === 'NV-001' || dept.includes('giám đốc') || dept.includes('ban giám đốc') || Boolean(me?.isDirectorHau);
  const isHcns = role === 'manager_hr' || dept.includes('hcns') || dept.includes('hành chính');
  const isPrivileged = isDirectorOrAdmin || isHcns;
  const isManager = role === 'manager' && !isPrivileged;
  const isSelf = intent.type === 'self';

  // 1. Enterprise Privacy Guardrail Check
  if (!isPrivileged && !isManager && !isSelf) {
    const targetDesc = intent.nameTarget || intent.departmentTarget || intent.title || 'đồng nghiệp';
    const blockedMsg = `🛡️ **Chính sách Bảo mật Dữ liệu Doanh nghiệp (Enterprise Privacy Guardrail):**\n\nTheo quy định an toàn thông tin nội bộ của NetViet HR, dữ liệu hồ sơ và thông tin nhân sự là thông tin nội bộ được phân quyền bảo mật nghiêm ngặt.\n\n- Bạn chỉ có quyền tra cứu thông tin và hồ sơ cá nhân của chính mình (**${me.full_name}**).\n- Yêu cầu tra cứu thông tin nhân sự toàn công ty (**${targetDesc}**) đã bị hệ thống từ chối.\n\nQuyền hạn tra cứu danh bạ và nhân sự chuyên sâu chỉ được cấp cho **Quản trị viên (Admin)**, **Ban Giám Đốc** và bộ phận **Hành chính Nhân sự (HCNS)**.\n\nNếu bạn cần liên hệ công việc với đồng nghiệp, vui lòng trao đổi qua kênh Chat nội bộ hoặc liên hệ phòng HCNS.`;

    if (isStream && onEvent) {
      await onEvent('status', { message: 'Đang phản hồi...' });
      for await (const chunk of streamPacedText(blockedMsg, 12)) {
        await onEvent('delta', { text: chunk });
      }
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
      return { handled: true };
    }

    return {
      handled: true,
      blocked: true,
      result: {
        requestId: reqId,
        content: blockedMsg,
        blocked: true,
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
      }
    };
  }

  // 2. Manager Department Scope Check
  if (isManager && !isPrivileged && intent.type === 'department') {
    const normReqDept = stripVietnameseAccents(intent.departmentTarget);
    const normMgrDept = stripVietnameseAccents(me.department || '');
    if (!normMgrDept.includes(normReqDept) && !normReqDept.includes(normMgrDept)) {
      const scopeMsg = `🛡️ **Giới hạn Phạm vi Quản lý (Department Scope):**\n\nBạn là Cán bộ Quản lý của phòng ban **${me.department}**.\n\nTheo chính sách phân quyền dữ liệu của NetViet HR, Trưởng phòng chỉ có quyền tra cứu nhân sự và dữ liệu chuyên sâu thuộc phòng ban do mình phụ trách.\n\nĐể tra cứu nhân sự phòng **${intent.departmentTarget}**, vui lòng liên hệ Ban Giám đốc hoặc Phòng HCNS.`;

      if (isStream && onEvent) {
        await onEvent('status', { message: 'Đang phản hồi...' });
        for await (const chunk of streamPacedText(scopeMsg, 12)) {
          await onEvent('delta', { text: chunk });
        }
        await onEvent('done', {
          requestId: reqId,
          content: scopeMsg,
          citations: [],
          actionCard: null,
          executedAction: null,
          telemetry: {
            provider: 'privacy-guardrail',
            model: 'manager-scope-shield',
            tokens: { prompt: estimateTokens(query), completion: estimateTokens(scopeMsg), total: estimateTokens(query) + estimateTokens(scopeMsg) },
            cost: { costUsd: 0, costVnd: 0 },
            latencyMs: 15,
            retrievedChunkCount: 0
          }
        });
        return { handled: true };
      }

      return {
        handled: true,
        blocked: true,
        result: {
          requestId: reqId,
          content: scopeMsg,
          blocked: true,
          citations: [],
          actionCard: null,
          telemetry: {
            provider: 'privacy-guardrail',
            model: 'manager-scope-shield',
            tokens: { prompt: estimateTokens(query), completion: estimateTokens(scopeMsg), total: estimateTokens(query) + estimateTokens(scopeMsg) },
            cost: { costUsd: 0, costVnd: 0 },
            latencyMs: 15,
            retrievedChunkCount: 0
          }
        }
      };
    }
  }

  // 3. Query Users from D1
  let allUsers = [];
  try {
    const res = await env.DB.prepare(`
      SELECT id, employee_code, full_name, department, position, email, phone, 
             role, is_active, lifecycle_status, contract_type, contract_end_date, 
             hire_date, work_location, created_at, avatar_url
        FROM users
       WHERE is_active = 1
    `).all();
    allUsers = res.results || [];
  } catch (err) {
    console.error('executeDeepEmployeeLookup users query error:', err);
    return null;
  }

  let candidates = [];
  let noteText = null;

  if (intent.type === 'self') {
    candidates = allUsers.filter(u => u.id === me.id);
  } else if (intent.type === 'name') {
    if (intent.isGroup) {
      candidates = findEmployeesByNameGroup(allUsers, intent.nameTarget);
    } else {
      const match = await findEmployeeSmart(env, intent.nameTarget);
      if (match.found) {
        if (match.multiple) candidates = match.candidates;
        else candidates = [match.employee];
        noteText = match.note;
      }
    }
  } else if (intent.type === 'department') {
    const normDept = stripVietnameseAccents(intent.departmentTarget);
    candidates = allUsers.filter(u => u.department && stripVietnameseAccents(u.department).includes(normDept));
  } else if (intent.type === 'attendance_today') {
    let attRows = [];
    let leaveRows = [];
    try {
      const attRes = await env.DB.prepare(`
        SELECT user_id, checkin_time, checkout_time, work_type, status, late_minutes 
          FROM attendance 
         WHERE date = ?
      `).bind(todayYMD).all();
      attRows = attRes.results || [];
    } catch (_) {}

    try {
      const leaveRes = await env.DB.prepare(`
        SELECT user_id, leave_type 
          FROM leave_requests 
         WHERE ? BETWEEN start_date AND end_date AND status = 'approved'
      `).bind(todayYMD).all();
      leaveRows = leaveRes.results || [];
    } catch (_) {}

    if (intent.subType === 'late') {
      const lateIds = new Set(attRows.filter(a => Number(a.late_minutes) > 0).map(a => String(a.user_id)));
      candidates = allUsers.filter(u => lateIds.has(String(u.id)));
    } else if (intent.subType === 'wfh') {
      const wfhIds = new Set(attRows.filter(a => a.work_type === 'wfh').map(a => String(a.user_id)));
      candidates = allUsers.filter(u => wfhIds.has(String(u.id)));
    } else if (intent.subType === 'on_leave') {
      const leaveIds = new Set(leaveRows.map(l => String(l.user_id)));
      candidates = allUsers.filter(u => leaveIds.has(String(u.id)));
    } else if (intent.subType === 'not_checked_in') {
      const checkedIds = new Set(attRows.filter(a => a.checkin_time || a.work_type === 'wfh').map(a => String(a.user_id)));
      const leaveIds = new Set(leaveRows.map(l => String(l.user_id)));
      candidates = allUsers.filter(u => !checkedIds.has(String(u.id)) && !leaveIds.has(String(u.id)));
    }
  } else if (intent.type === 'lifecycle') {
    if (intent.subType === 'probation') {
      candidates = allUsers.filter(u => /thử việc/i.test(u.lifecycle_status || '') || /thử việc/i.test(u.contract_type || ''));
    } else if (intent.subType === 'intern') {
      candidates = allUsers.filter(u => /thực tập/i.test(u.lifecycle_status || '') || /thực tập/i.test(u.contract_type || '') || /tts/i.test(u.position || ''));
    } else if (intent.subType === 'official') {
      candidates = allUsers.filter(u => /chính thức/i.test(u.lifecycle_status || '') || /chính thức/i.test(u.contract_type || ''));
    } else if (intent.subType === 'expiring') {
      candidates = allUsers.filter(u => {
        if (!u.contract_end_date) return false;
        const diffDays = Math.ceil((new Date(u.contract_end_date).getTime() - Date.now()) / (86400000));
        return diffDays >= 0 && diffDays <= 30;
      });
    }
  }

  // Manager Department Filter (if manager queried)
  if (isManager && !isPrivileged && intent.type !== 'self') {
    candidates = candidates.filter(u => u.department === me.department);
  }

  // 4. Data Enrichment for Each Candidate
  const enrichedCandidates = await Promise.all(candidates.slice(0, 15).map(async (emp) => {
    let todayAtt = null;
    let todayLeave = null;
    let monthStats = { days_worked: 0, late_count: 0, total_late_minutes: 0 };
    let leaveBalance = null;

    try {
      todayAtt = await env.DB.prepare(`
        SELECT checkin_time, checkout_time, work_type, status, COALESCE(late_minutes, 0) as late_minutes
          FROM attendance
         WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT)) AND date = ?
         LIMIT 1
      `).bind(emp.id, String(emp.id), todayYMD).first();
    } catch (_) {}

    try {
      todayLeave = await env.DB.prepare(`
        SELECT leave_type, reason
          FROM leave_requests
         WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
           AND ? BETWEEN start_date AND end_date
           AND status = 'approved'
         LIMIT 1
      `).bind(emp.id, String(emp.id), todayYMD).first();
    } catch (_) {}

    try {
      const monthPrefix = `${currentYear}-${currentMonthNum}-%`;
      const mRow = await env.DB.prepare(`
        SELECT COUNT(CASE WHEN checkin_time IS NOT NULL OR work_type = 'wfh' THEN 1 END) as days_worked,
               COUNT(CASE WHEN late_minutes > 0 THEN 1 END) as late_count,
               SUM(COALESCE(late_minutes, 0)) as total_late_minutes
          FROM attendance
         WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
           AND date LIKE ?
      `).bind(emp.id, String(emp.id), monthPrefix).first();
      if (mRow) {
        monthStats = {
          days_worked: Number(mRow.days_worked || 0),
          late_count: Number(mRow.late_count || 0),
          total_late_minutes: Number(mRow.total_late_minutes || 0)
        };
      }
    } catch (_) {}

    try {
      const balRow = await env.DB.prepare(`
        SELECT available_days 
          FROM leave_balances 
         WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT)) 
           AND balance_year = ?
         LIMIT 1
      `).bind(emp.id, String(emp.id), currentYear).first();
      if (balRow && balRow.available_days != null) {
        leaveBalance = balRow.available_days;
      }
    } catch (_) {}

    return {
      ...emp,
      todayAtt,
      todayLeave,
      monthStats,
      leaveBalance
    };
  }));

  // 5. Adaptive Layout Formatting
  let responseContent = '';
  let responseActionCard = null;

  if (enrichedCandidates.length === 0) {
    responseContent = `Tôi không tìm thấy thông tin nhân sự phù hợp với yêu cầu: **"${query}"**.\n\n💡 *Gợi ý: Quý Anh/Chị có thể kiểm tra lại tên gọi, mã nhân viên (ví dụ: \`THUYDT\`, \`VCTH\`) hoặc tên phòng ban.*`;
  } else if (enrichedCandidates.length === 1) {
    const emp = enrichedCandidates[0];
    const statusLabel = emp.lifecycle_status || (emp.is_active ? 'Đang làm việc' : 'Đã nghỉ việc');

    let attText = '⚪ Chưa check-in hôm nay';
    if (emp.todayAtt?.checkin_time) {
      const isLate = Number(emp.todayAtt.late_minutes) > 0;
      attText = isLate 
        ? `🟡 Đã check-in lúc **${emp.todayAtt.checkin_time}** (Trễ ${emp.todayAtt.late_minutes} phút)` 
        : `🟢 Đã check-in lúc **${emp.todayAtt.checkin_time}** (Đúng giờ)`;
      if (emp.todayAtt.checkout_time) attText += ` • Check-out lúc **${emp.todayAtt.checkout_time}**`;
    } else if (emp.todayAtt?.work_type === 'wfh') {
      attText = '🏠 Làm việc tại nhà (WFH)';
    } else if (emp.todayLeave) {
      attText = `🏖️ Nghỉ phép (**${emp.todayLeave.leave_type || 'Đã duyệt'}**)`;
    }

    const loc = emp.work_location || (/HCM/i.test(emp.department || '') ? 'TP. Hồ Chí Minh (HCM)' : 'Hà Nội (HN)');

    responseContent = `${noteText ? `💡 *${noteText}*\n\n` : ''}👤 **Hồ sơ Nhân sự 360°: ${emp.full_name}**

📌 **1. Thông tin công tác:**
- **Họ và tên:** **${emp.full_name}**
- **Mã nhân viên:** \`${emp.employee_code || '—'}\`
- **Phòng ban:** ${emp.department || 'Chưa phân bổ'}
- **Chức vụ:** ${emp.position || 'Nhân viên'}
- **Địa điểm làm việc:** ${loc}
- **Email:** ${emp.email || 'Chưa cập nhật'}
- **Số điện thoại:** ${emp.phone || 'Chưa cập nhật'}

📄 **2. Hợp đồng & Vòng đời:**
- **Loại hợp đồng:** ${emp.contract_type || 'Chính thức'}
- **Trạng thái:** ${emp.is_active ? '🟢 Đang làm việc' : '🔴 Đã nghỉ việc'} (${statusLabel})
- **Ngày vào làm:** ${emp.hire_date || '—'}${emp.contract_end_date ? ` • Hạn HĐ: ${emp.contract_end_date}` : ''}

⏰ **3. Chấm công hôm nay (${todayFormatted}):**
- **Tình trạng:** ${attText}

📊 **4. Chuyên cần tháng ${currentMonthNum}/${currentYear}:**
- **Ngày công thực tế:** **${emp.monthStats.days_worked}/22** ngày công
- **Đi muộn:** ${emp.monthStats.late_count > 0 ? `**${emp.monthStats.late_count} lần** (Tổng trễ ${emp.monthStats.total_late_minutes} phút)` : '0 lần (Đúng giờ 100%)'}

🏖️ **5. Quỹ phép năm:**
- **Số ngày phép còn lại:** **${emp.leaveBalance != null ? `${emp.leaveBalance} ngày` : '12 ngày'}**`;

    responseActionCard = {
      isActionCard: false,
      isNavigationCard: true,
      actionType: 'view_employee_profile',
      icon: 'userCheck',
      title: `Hồ sơ chi tiết: ${emp.full_name}`,
      link: `#/users/${emp.id}`,
      buttonIcon: 'user',
      buttonText: 'Xem hồ sơ chi tiết'
    };
  } else {
    // Multiple candidates (>= 2)
    const titleText = intent.title || `Tìm thấy ${enrichedCandidates.length} nhân sự phù hợp:`;
    responseContent = `🔍 **${titleText}**\n\n`;
    responseContent += `| STT | Họ và tên | Mã NV | Phòng ban | Chức danh | Nơi LV | Chấm công hôm nay | Ngày công | Đi muộn |\n`;
    responseContent += `|:---:|:---|:---:|:---|:---|:---:|:---|:---:|:---:|\n`;

    let checkedCount = 0;
    enrichedCandidates.forEach((cand, idx) => {
      let todayStatus = '⚪ Chưa check-in';
      if (cand.todayAtt?.checkin_time) {
        checkedCount++;
        const isLate = Number(cand.todayAtt.late_minutes) > 0;
        todayStatus = isLate ? `🟡 Đã vào (${cand.todayAtt.checkin_time} - Trễ ${cand.todayAtt.late_minutes}p)` : `🟢 Đã vào (${cand.todayAtt.checkin_time})`;
      } else if (cand.todayAtt?.work_type === 'wfh') {
        checkedCount++;
        todayStatus = '🏠 WFH';
      } else if (cand.todayLeave) {
        todayStatus = '🏖️ Nghỉ phép';
      }

      const loc = cand.work_location || (/HCM/i.test(cand.department || '') ? 'HCM' : 'HN');
      responseContent += `| ${idx + 1} | **${cand.full_name}** | \`${cand.employee_code || '—'}\` | ${cand.department || '—'} | ${cand.position || 'Nhân viên'} | ${loc} | ${todayStatus} | ${cand.monthStats.days_worked}/22 | ${cand.monthStats.late_count > 0 ? `${cand.monthStats.late_count} lần` : '0'} |\n`;
    });

    responseContent += `\n💡 **Phân tích tổng quan:**\n`;
    responseContent += `- **Tổng số nhân sự:** **${enrichedCandidates.length}** nhân viên.\n`;
    responseContent += `- **Tình hình có mặt hôm nay (${todayFormatted}):** **${checkedCount}/${enrichedCandidates.length}** nhân sự đã điểm danh / làm việc.\n`;
    responseContent += `\n👉 *Gợi ý: Quý Anh/Chị có thể hỏi chi tiết theo Mã nhân viên (ví dụ: \`${enrichedCandidates[0]?.employee_code || 'MÃ_NV'} là ai\`) để xem Full Dossier 360° gồm hợp đồng và quỹ phép.*`;

    responseActionCard = {
      isActionCard: false,
      isNavigationCard: true,
      actionType: 'view_employee_directory',
      icon: 'users',
      title: `Danh sách ${enrichedCandidates.length} nhân sự khớp yêu cầu`,
      link: `#/users`,
      buttonIcon: 'users',
      buttonText: 'Mở danh sách nhân sự'
    };
  }

  // 6. Log AI Interaction
  await logAiInteraction(env, {
    id: reqId,
    userId: me.id,
    conversationId,
    sessionRole: me.role || 'employee',
    queryText: query,
    responseText: responseContent,
    provider: 'edge-directory',
    modelName: 'smart-employee-matcher',
    promptTokens: estimateTokens(query),
    completionTokens: estimateTokens(responseContent),
    estimatedCostUsd: 0,
    ttftMs: 5,
    totalLatencyMs: 15,
    retrievedChunksJson: [],
    toolsCalledJson: [{ name: 'smart_employee_lookup', args: { query, count: enrichedCandidates.length } }]
  });

  // 7. Return Result (Streaming or Non-streaming)
  if (isStream && onEvent) {
    await onEvent('status', { message: 'Đang phản hồi...' });
    for await (const chunk of streamPacedText(responseContent, 12)) {
      await onEvent('delta', { text: chunk });
    }
    await onEvent('done', {
      requestId: reqId,
      content: responseContent,
      citations: [],
      actionCard: responseActionCard,
      executedAction: null,
      telemetry: {
        provider: 'edge-directory',
        model: 'smart-employee-matcher',
        tokens: { prompt: estimateTokens(query), completion: estimateTokens(responseContent), total: estimateTokens(query) + estimateTokens(responseContent) },
        cost: { costUsd: 0, costVnd: 0 },
        latencyMs: 15,
        retrievedChunkCount: 0
      }
    });
    return { handled: true };
  }

  return {
    handled: true,
    blocked: false,
    count: enrichedCandidates.length,
    result: {
      requestId: reqId,
      content: responseContent,
      blocked: false,
      count: enrichedCandidates.length,
      citations: [],
      actionCard: responseActionCard,
      telemetry: {
        provider: 'edge-directory',
        model: 'smart-employee-matcher',
        tokens: { prompt: estimateTokens(query), completion: estimateTokens(responseContent), total: estimateTokens(query) + estimateTokens(responseContent) },
        cost: { costUsd: 0, costVnd: 0 },
        latencyMs: 15,
        retrievedChunkCount: 0
      }
    }
  };
}
