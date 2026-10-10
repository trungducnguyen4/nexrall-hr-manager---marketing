/**
 * Tools Dispatcher & Authorization Executor
 * Strict Tool-Layer Authorization Boundary (P1.2, P1.3) & O(1) Execution Dispatcher.
 */
import { TOOL_MAP } from './tool-registry.js';

/**
 * Strict Tool-Layer Authorization Boundary (P1.2, P1.3)
 * Decouples permission enforcement from the LLM prompt.
 * Prevents prompt injection from accessing unauthorized data or executing privileged actions.
 */
export function verifyToolAuthorization(toolName, args = {}, me = {}) {
  const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
  const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
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

  // 5. HR Operations tools: Privileged or Manager only
  const hrOpsTools = ['get_attendance_anomalies', 'get_daily_attendance_roster', 'get_company_overtime_summary', 'get_monthly_hr_summary', 'get_department_workforce_comparison'];
  if (hrOpsTools.includes(toolName)) {
    if (!isPrivileged && !isManager) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: `Quyền truy cập bị từ chối: Công cụ quản trị "${toolName}" chỉ dành riêng cho Cán bộ HCNS, Quản lý hoặc Ban Giám Đốc.`
      };
    }
  }

  // 6. Contract Expirations: Admin or HCNS only
  if (toolName === 'get_contract_expirations') {
    if (!isPrivileged) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: 'Bảo mật hồ sơ nhân sự: Danh sách hợp đồng lao động chỉ dành riêng cho Admin và Phòng HCNS.'
      };
    }
  }

  // 7. Director Executive Analytics tools: Admin or Director only
  const directorTools = ['get_executive_headcount_turnover', 'get_overtime_cost_trends', 'get_company_workforce_briefing'];
  if (directorTools.includes(toolName)) {
    if (!isDirector) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: `Bảo mật điều hành cấp cao: Báo cáo "${toolName}" chỉ dành riêng cho Ban Giám Đốc.`
      };
    }
  }

  // 8. Employee directory lookup: Privileged (Admin, Director, HCNS) only
  if (toolName === 'search_employee_directory') {
    if (!isPrivileged) {
      return {
        allowed: false,
        error: 'PERMISSION_DENIED',
        message: 'Bảo mật hồ sơ nhân sự: Tra cứu thông tin nhân sự chỉ dành riêng cho Quản trị viên, Ban Giám Đốc và Phòng HCNS.'
      };
    }
  }

  // Also check tool-specific authorize callback if registered
  const tool = TOOL_MAP.get(toolName);
  if (tool && typeof tool.authorize === 'function') {
    const customAuth = tool.authorize(args, me);
    if (customAuth && !customAuth.allowed) {
      return customAuth;
    }
  }

  return { allowed: true };
}

/**
 * Execute tool call against database with O(1) plugin lookup
 */
export async function executeTool(env, toolName, args = {}, me) {
  if (!env || !env.DB) return { error: 'Database not available' };

  // Tool-level authorization check
  const auth = verifyToolAuthorization(toolName, args, me);
  if (!auth.allowed) {
    return { error: auth.error, message: auth.message, executed: false };
  }

  const tool = TOOL_MAP.get(toolName);
  if (!tool) {
    return { error: `Unknown tool: ${toolName}` };
  }

  return await tool.execute(env, args, me);
}
