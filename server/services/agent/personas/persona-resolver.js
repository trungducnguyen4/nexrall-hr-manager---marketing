/**
 * Role-aware Persona Resolution & RBAC Check for AI HR Assistant
 */

/**
 * Role-aware Persona Resolution for AI HR Assistant
 * 1. Employee: personal assistant (leave, payslip, self attendance, draft requests)
 * 2. HR Copilot: operational HR management (anomalies, daily roster, contracts, OT, policies)
 * 3. Director Insights: executive analytics & strategic insights (headcount, turnover, dept comparison, cost trends)
 */
export function resolveUserPersona(me) {
  const role = String(me?.role || '').toLowerCase();
  const dept = String(me?.department || '').toLowerCase();
  const code = String(me?.employee_code || '').toUpperCase();
  if (role === 'manager_hr' || dept.includes('hcns') || dept.includes('hành chính')) return 'hr';
  const isDirector = role === 'admin' || role === 'director' || role === 'manager_director' || role === 'manager' || code === 'BGD-01' || code === 'BGD-02' || code === 'NV-ADMIN' || code === 'NV-001' || dept.includes('giám đốc') || dept.includes('ban giám đốc') || Boolean(me?.isDirectorHau);

  if (isDirector) return 'director';
  return 'employee';
}

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
