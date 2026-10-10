/**
 * Central Tool Registry
 * Aggregates all domain tool plugins and provides O(1) lookup & role filtering.
 */
import { hrAttendanceTools } from './plugins/hr-attendance.tools.js';
import { tasksHandoverTools } from './plugins/tasks-handover.tools.js';
import { executiveTools } from './plugins/executive.tools.js';
import { policySystemTools } from './plugins/policy-system.tools.js';

export const ALL_TOOLS = [
  ...hrAttendanceTools,
  ...tasksHandoverTools,
  ...executiveTools,
  ...policySystemTools
];

export const TOOL_MAP = new Map(ALL_TOOLS.map(t => [t.name, t]));

/**
 * Tool definitions available to Copilot LLM
 */
export const COPILOT_TOOLS = ALL_TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters
}));

/**
 * Filter tool schemas dynamically based on user persona and authorization
 */
export function getToolsForPersona(persona, me) {
  const employeeToolNames = new Set([
    'search_policy_knowledge',
    'get_my_payslip_summary',
    'get_my_attendance_summary',
    'get_leave_balance',
    'list_my_tasks',
    'task_update_status',
    'create_leave_request_draft',
    'create_wfh_request_draft',
    'create_attendance_correction_draft',
    'create_task_draft',
    'get_announcements_summary',
    'payroll_request_review',
    'get_system_module_info',
    'handover_create',
    'handover_confirm',
    'leave_cancel'
  ]);

  const hrExtraToolNames = new Set([
    'search_employee_directory',
    'get_attendance_anomalies',
    'get_daily_attendance_roster',
    'get_contract_expirations',
    'get_company_overtime_summary',
    'get_monthly_hr_summary',
    'get_leave_requests_overview',
    'leave_approve',
    'leave_reject',
    'audit_payroll_anomalies',
    'announcement_post',
    'task_assign',
    'task_update_details',
    'task_delete',
    'get_department_workforce_comparison'
  ]);

  const directorExtraToolNames = new Set([
    'search_employee_directory',
    'get_executive_headcount_turnover',
    'get_department_workforce_comparison',
    'get_overtime_cost_trends',
    'get_company_workforce_briefing',
    'get_attendance_anomalies',
    'get_daily_attendance_roster',
    'get_company_overtime_summary',
    'get_monthly_hr_summary',
    'get_leave_requests_overview',
    'leave_approve',
    'leave_reject',
    'audit_payroll_anomalies',
    'employee_update_code',
    'announcement_post',
    'task_assign',
    'task_update_details',
    'task_delete'
  ]);

  let allowedNames = employeeToolNames;
  if (persona === 'hr') {
    allowedNames = new Set([...employeeToolNames, ...hrExtraToolNames]);
  } else if (persona === 'director') {
    allowedNames = new Set([...employeeToolNames, ...directorExtraToolNames]);
  }

  return COPILOT_TOOLS.filter(t => allowedNames.has(t.name));
}
