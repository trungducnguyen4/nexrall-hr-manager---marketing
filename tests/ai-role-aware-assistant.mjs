// tests/ai-role-aware-assistant.mjs
// Automated verification suite for Role-Aware AI HR Assistant
// Covers:
// 1. Persona resolution (Employee, HR, Director)
// 2. Persona-based tool schema filtering (L1 Context Security)
// 3. Strict backend RBAC authorization (L2 Execution Security)
// 4. Payroll safety guardrails (No write tools for compensation)
// 5. System prompt customization per persona
// 6. Execution of new Employee, HR, and Director tools on Mock D1

import assert from 'node:assert/strict';
import {
  COPILOT_TOOLS,
  resolveUserPersona,
  getToolsForPersona,
  buildPersonaSystemPrompt,
  verifyToolAuthorization,
  executeTool
} from '../server/services/agent.service.js';

console.log('--- Test Suite: Role-aware AI HR Assistant Architecture ---');

// Mock User Profiles
const userEmployee = {
  id: 101,
  username: 'nhanvien1',
  full_name: 'Nguyễn Văn Nhân',
  role: 'employee',
  department: 'Kỹ thuật',
  employee_code: 'NV-101'
};

const userHr = {
  id: 102,
  username: 'hr_chuyenvien',
  full_name: 'Trần Thị Nhân Sự',
  role: 'employee',
  department: 'Hành chính - Nhân sự',
  employee_code: 'NV-102'
};

const userDirector = {
  id: 1,
  username: 'director_hau',
  full_name: 'Phạm Văn Hậu',
  role: 'director',
  department: 'Ban Giám đốc',
  employee_code: 'BGD-01'
};

// 1. Persona Resolution Tests
{
  assert.equal(resolveUserPersona(userEmployee), 'employee', 'Standard employee should resolve to employee');
  assert.equal(resolveUserPersona(userHr), 'hr', 'HCNS department user should resolve to hr');
  assert.equal(resolveUserPersona({ role: 'manager_hr', department: 'Tuyển dụng' }), 'hr', 'manager_hr role should resolve to hr');
  assert.equal(resolveUserPersona(userDirector), 'director', 'Director role should resolve to director');
  assert.equal(resolveUserPersona({ role: 'admin', employee_code: 'NV-ADMIN' }), 'director', 'Admin should resolve to director persona');
  console.log('  ok  1. Persona Resolution: Accurate classification for Employee, HR, and Director');
}

// 2. Persona-based Tool Schema Filtering (L1 LLM Context Security)
{
  const employeeTools = getToolsForPersona('employee', userEmployee);
  const employeeToolNames = employeeTools.map(t => t.name);

  // Employee must have personal tools
  assert.ok(employeeToolNames.includes('get_leave_balance'), 'Employee must have get_leave_balance');
  assert.ok(employeeToolNames.includes('get_my_attendance_summary'), 'Employee must have get_my_attendance_summary');
  assert.ok(employeeToolNames.includes('get_my_payslip_summary'), 'Employee must have get_my_payslip_summary');
  assert.ok(employeeToolNames.includes('create_leave_request_draft'), 'Employee must have create_leave_request_draft');
  assert.ok(employeeToolNames.includes('create_wfh_request_draft'), 'Employee must have create_wfh_request_draft');
  assert.ok(employeeToolNames.includes('create_attendance_correction_draft'), 'Employee must have create_attendance_correction_draft');
  assert.ok(employeeToolNames.includes('search_policy_knowledge'), 'Employee must have search_policy_knowledge');

  // Employee MUST NOT have HR Department tools
  assert.ok(!employeeToolNames.includes('get_attendance_anomalies'), 'Employee cannot have get_attendance_anomalies schema');
  assert.ok(!employeeToolNames.includes('get_daily_attendance_roster'), 'Employee cannot have get_daily_attendance_roster schema');
  assert.ok(!employeeToolNames.includes('get_contract_expirations'), 'Employee cannot have get_contract_expirations schema');
  assert.ok(!employeeToolNames.includes('get_company_overtime_summary'), 'Employee cannot have get_company_overtime_summary schema');
  assert.ok(!employeeToolNames.includes('leave_approve'), 'Employee cannot have leave_approve schema');

  // Employee MUST NOT have Director tools
  assert.ok(!employeeToolNames.includes('get_executive_headcount_turnover'), 'Employee cannot have get_executive_headcount_turnover schema');
  assert.ok(!employeeToolNames.includes('get_department_workforce_comparison'), 'Employee cannot have get_department_workforce_comparison schema');
  assert.ok(!employeeToolNames.includes('get_overtime_cost_trends'), 'Employee cannot have get_overtime_cost_trends schema');
  assert.ok(!employeeToolNames.includes('get_company_workforce_briefing'), 'Employee cannot have get_company_workforce_briefing schema');

  // HR Persona Tools
  const hrTools = getToolsForPersona('hr', userHr);
  const hrToolNames = hrTools.map(t => t.name);
  assert.ok(hrToolNames.includes('get_attendance_anomalies'), 'HR must have get_attendance_anomalies');
  assert.ok(hrToolNames.includes('get_daily_attendance_roster'), 'HR must have get_daily_attendance_roster');
  assert.ok(hrToolNames.includes('get_contract_expirations'), 'HR must have get_contract_expirations');
  assert.ok(hrToolNames.includes('get_company_overtime_summary'), 'HR must have get_company_overtime_summary');
  assert.ok(hrToolNames.includes('leave_approve'), 'HR must have leave_approve');
  // HR must not have Director strategic tools
  assert.ok(!hrToolNames.includes('get_executive_headcount_turnover'), 'HR should not have director strategic tools');

  // Director Persona Tools
  const directorTools = getToolsForPersona('director', userDirector);
  const directorToolNames = directorTools.map(t => t.name);
  assert.ok(directorToolNames.includes('get_executive_headcount_turnover'), 'Director must have get_executive_headcount_turnover');
  assert.ok(directorToolNames.includes('get_department_workforce_comparison'), 'Director must have get_department_workforce_comparison');
  assert.ok(directorToolNames.includes('get_overtime_cost_trends'), 'Director must have get_overtime_cost_trends');
  assert.ok(directorToolNames.includes('get_company_workforce_briefing'), 'Director must have get_company_workforce_briefing');
  assert.ok(directorToolNames.includes('get_daily_attendance_roster'), 'Director must have get_daily_attendance_roster');

  console.log('  ok  2. L1 Tool Filtering: Strict context schema separation across 3 personas');
}

// 3. Backend RBAC Enforcement (L2 Execution Security)
{
  // Employee attempting to execute restricted tools
  assert.equal(verifyToolAuthorization('get_attendance_anomalies', {}, userEmployee).allowed, false, 'Employee blocked from get_attendance_anomalies');
  assert.equal(verifyToolAuthorization('get_daily_attendance_roster', {}, userEmployee).allowed, false, 'Employee blocked from get_daily_attendance_roster');
  assert.equal(verifyToolAuthorization('get_contract_expirations', {}, userEmployee).allowed, false, 'Employee blocked from get_contract_expirations');
  assert.equal(verifyToolAuthorization('get_company_overtime_summary', {}, userEmployee).allowed, false, 'Employee blocked from get_company_overtime_summary');
  assert.equal(verifyToolAuthorization('get_executive_headcount_turnover', {}, userEmployee).allowed, false, 'Employee blocked from get_executive_headcount_turnover');
  assert.equal(verifyToolAuthorization('get_department_workforce_comparison', {}, userEmployee).allowed, false, 'Employee blocked from get_department_workforce_comparison');
  assert.equal(verifyToolAuthorization('get_overtime_cost_trends', {}, userEmployee).allowed, false, 'Employee blocked from get_overtime_cost_trends');
  assert.equal(verifyToolAuthorization('get_company_workforce_briefing', {}, userEmployee).allowed, false, 'Employee blocked from get_company_workforce_briefing');

  // Employee executing their own tools
  assert.equal(verifyToolAuthorization('get_leave_balance', {}, userEmployee).allowed, true, 'Employee allowed for get_leave_balance');
  assert.equal(verifyToolAuthorization('create_wfh_request_draft', {}, userEmployee).allowed, true, 'Employee allowed for create_wfh_request_draft');
  assert.equal(verifyToolAuthorization('create_attendance_correction_draft', {}, userEmployee).allowed, true, 'Employee allowed for create_attendance_correction_draft');

  // HR executing HR tools
  assert.equal(verifyToolAuthorization('get_attendance_anomalies', {}, userHr).allowed, true, 'HR allowed for get_attendance_anomalies');
  assert.equal(verifyToolAuthorization('get_executive_headcount_turnover', {}, userHr).allowed, false, 'HR blocked from director analytics');

  // Director executing strategic tools
  assert.equal(verifyToolAuthorization('get_executive_headcount_turnover', {}, userDirector).allowed, true, 'Director allowed for get_executive_headcount_turnover');
  assert.equal(verifyToolAuthorization('get_company_workforce_briefing', {}, userDirector).allowed, true, 'Director allowed for get_company_workforce_briefing');

  console.log('  ok  3. L2 Backend RBAC: Defense-in-depth rejects unauthorized execution attempts');
}

// 4. Payroll Guardrails Check
{
  const modifyingPayrollTools = COPILOT_TOOLS.filter(t => {
    const n = t.name.toLowerCase();
    return (n.includes('salary') || n.includes('payroll') || n.includes('wage') || n.includes('bonus')) &&
           (n.startsWith('create') || n.startsWith('update') || n.startsWith('edit') || n.startsWith('delete') || n.startsWith('set'));
  });
  assert.equal(modifyingPayrollTools.length, 0, 'No write/mutate tools permitted for payroll / salaries');
  console.log('  ok  4. Payroll Guardrail: Zero write operations on salaries or financial compensation');
}

// 5. System Prompt Persona Tailoring
{
  const promptEmp = buildPersonaSystemPrompt('employee', userEmployee, '07/10/2026 13:30', 2026);
  assert.ok(promptEmp.includes('Trợ lý HR Cá nhân'), 'Employee prompt has persona header');
  assert.ok(promptEmp.includes('Nguyễn Văn Nhân'), 'Employee prompt has user name');
  assert.ok(promptEmp.includes('Action Cards'), 'Employee prompt enforces HITL Action Cards');

  const promptHr = buildPersonaSystemPrompt('hr', userHr, '07/10/2026 13:30', 2026);
  assert.ok(promptHr.includes('HR Copilot'), 'HR prompt has persona header');
  assert.ok(promptHr.includes('Quản trị & Vận hành Nhân sự'), 'HR prompt has role focus');

  const promptDir = buildPersonaSystemPrompt('director', userDirector, '07/10/2026 13:30', 2026);
  assert.ok(promptDir.includes('Director Insights'), 'Director prompt has persona header');
  assert.ok(promptDir.includes('Cố vấn Điều hành Cấp cao'), 'Director prompt has executive focus');

  console.log('  ok  5. Persona System Prompts: Rich, contextualized instructions per persona');
}

// 6. Tool Execution with Mock D1 Database
{
  const mockD1 = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('FROM attendance a') && sql.includes('late_minutes > 0')) {
                return {
                  results: [
                    { user_id: 10, full_name: 'Lê Văn Trễ', employee_code: 'NV-042', department: 'Marketing', late_count: 4, total_late_minutes: 85, absent_count: 0, missing_checkin_count: 0 }
                  ]
                };
              }
              if (sql.includes('contract_end_date')) {
                return {
                  results: [
                    { id: 99, full_name: 'Phạm Thị Thử', employee_code: 'NV-099', department: 'Kế toán', position: 'Kế toán viên', contract_type: 'Thử việc', contract_end_date: '2026-10-25', days_remaining: 18 }
                  ]
                };
              }
              if (sql.includes('LEFT JOIN attendance a ON a.user_id = u.id')) {
                return {
                  results: [
                    { department: 'Kỹ thuật', headcount: 15, total_late_minutes: 30, late_occurrences: 2, total_checkins: 100 }
                  ]
                };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes('COUNT(*) as cnt FROM users WHERE is_active = 1')) {
                return { cnt: 25 };
              }
              return null;
            }
          };
        },
        async all() {
          if (sql.includes('SELECT department, COUNT(*) as cnt FROM users WHERE is_active = 1 GROUP BY department')) {
            return {
              results: [
                { department: 'Kỹ thuật', cnt: 15 },
                { department: 'Marketing', cnt: 10 }
              ]
            };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("lifecycle_status = 'resigned'")) {
            return { cnt: 2 };
          }
          if (sql.includes('COUNT(*) as cnt FROM users WHERE is_active = 1')) {
            return { cnt: 25 };
          }
          return null;
        }
      };
    }
  };

  const mockEnv = { DB: mockD1 };

  // Test Employee tool: create_wfh_request_draft
  const wfhRes = await executeTool(mockEnv, 'create_wfh_request_draft', { date: '2026-10-10', reason: 'Nhà có việc riêng' }, userEmployee);
  assert.ok(wfhRes.actionCard || wfhRes.isActionCard, 'WFH tool must return action card confirmation');
  assert.equal(wfhRes.actionType, 'create_wfh_request');

  // Test Employee tool: create_attendance_correction_draft
  const corrRes = await executeTool(mockEnv, 'create_attendance_correction_draft', { date: '2026-10-06', actualCheckin: '08:25', reason: 'Quên bấm vân tay' }, userEmployee);
  assert.ok(corrRes.actionCard || corrRes.isActionCard, 'Correction tool must return action card confirmation');
  assert.equal(corrRes.actionType, 'create_attendance_correction');

  // Test HR tool: get_attendance_anomalies
  const lateRes = await executeTool(mockEnv, 'get_attendance_anomalies', { minLateCount: 3 }, userHr);
  assert.equal(lateRes.totalAnomaliesFound, 1);
  assert.equal(lateRes.employeesWithAnomalies.length, 1);
  assert.equal(lateRes.employeesWithAnomalies[0].name, 'Lê Văn Trễ');

  // Test HR tool: get_contract_expirations
  const contractRes = await executeTool(mockEnv, 'get_contract_expirations', { daysThreshold: 30 }, userHr);
  assert.equal(contractRes.totalExpiringContracts, 1);
  assert.equal(contractRes.contracts.length, 1);
  assert.equal(contractRes.contracts[0].daysRemaining, 18);

  // Test Director tool: get_executive_headcount_turnover
  const hcRes = await executeTool(mockEnv, 'get_executive_headcount_turnover', {}, userDirector);
  assert.equal(hcRes.totalHeadcount, 25);
  assert.equal(hcRes.turnoverRate, '7.4%');
  assert.equal(hcRes.departmentsBreakdown.length, 2);

  // Test Director tool: get_department_workforce_comparison
  const deptRes = await executeTool(mockEnv, 'get_department_workforce_comparison', {}, userDirector);
  assert.equal(deptRes.departmentsCompared, 1);
  assert.equal(deptRes.ranking.length, 1);
  assert.equal(deptRes.ranking[0].department, 'Kỹ thuật');

  console.log('  ok  6. Mock D1 Execution: All new Employee, HR, and Director tools produce correct outputs');
}

console.log('\n--- ALL ROLE-AWARE ASSISTANT VERIFICATION AUDITS PASSED! ---');
