#!/usr/bin/env node
import fs from 'node:fs';

export async function auditFeatures(options = {}) {
  const issues = [];
  const passed = [];

  console.log('🧭 [Feature Navigator] Rà quét luồng tính năng và giao diện NetViet HR...');

  // 1. Kiểm tra các views cốt lõi ở Frontend
  const coreViews = [
    'src/app.js',
    'src/views/dashboard.js',
    'src/views/attendance.js',
    'src/views/leave.js',
    'src/views/payroll.js',
    'src/views/users.js',
    'src/views/tasks.js',
    'src/views/departments.js',
    'src/views/settings.js',
    'src/copilot.js',
    'styles/main.css'
  ];

  for (const viewPath of coreViews) {
    if (fs.existsSync(viewPath)) {
      passed.push(`View/Module cốt lõi tồn tại: ${viewPath}`);
    } else {
      issues.push({ severity: 'HIGH', message: `Thiếu view/module cốt lõi: ${viewPath}` });
    }
  }

  // 2. Kiểm tra điều hướng và phòng vệ click copilot
  if (fs.existsSync('src/copilot.js')) {
    const copilotCode = fs.readFileSync('src/copilot.js', 'utf8');
    if (copilotCode.includes('btn-confirm-action') && !copilotCode.includes('btn-nav-action')) {
      issues.push({
        severity: 'HIGH',
        message: 'Cảnh báo: copilot.js có thể đang dùng class btn-confirm-action cho thẻ điều hướng a href.'
      });
    } else {
      passed.push('Copilot action handlers được phân định rõ ràng (btn-nav-action vs btn-confirm-action)');
    }
  }

  // 3. Kiểm tra các backend controllers
  const backendControllers = [
    'server/controllers/attendance.controller.js',
    'server/controllers/leave.controller.js',
    'server/controllers/payroll.controller.js',
    'server/controllers/ai.controller.js',
    'server/controllers/users.controller.js',
    'server/controllers/auth.controller.js'
  ];

  for (const c of backendControllers) {
    if (fs.existsSync(c)) {
      passed.push(`Backend controller sẵn sàng: ${c}`);
    } else {
      issues.push({ severity: 'CRITICAL', message: `Thiếu backend controller: ${c}` });
    }
  }

  return {
    module: '1. Features (User Flow & Nav)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-features.mjs')) {
  auditFeatures().then(res => console.log(JSON.stringify(res, null, 2)));
}
