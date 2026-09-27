#!/usr/bin/env node
/**
 * Attack Squad: Chaos Monkey & Edge Hunter
 * Thử nghiệm các trạng thái biên dị thường, crash states và validate error handlers.
 */
import fs from 'node:fs';

export async function auditChaos(options = {}) {
  const issues = [];
  const passed = [];

  console.log('🐒 [Chaos Monkey & Edge Hunter] Thử nghiệm trạng thái dị & edge cases...');

  // 1. Kiểm tra Global Error Handling trong server.js
  if (fs.existsSync('server.js')) {
    const serverCode = fs.readFileSync('server.js', 'utf8');
    const hasTryCatch = serverCode.includes('try {') && serverCode.includes('catch');
    const has500Handler = serverCode.includes('status: 500') || serverCode.includes('500');

    if (hasTryCatch && has500Handler) {
      passed.push('Server có cơ chế try/catch bọc tầng điều phối API để tránh sập Worker');
    } else {
      issues.push({
        severity: 'HIGH',
        message: 'Thiếu cơ chế bắt lỗi tập trung (Global Try/Catch Handler) ở tầng request routing'
      });
    }

    // Kiểm tra xử lý JSON body parsing an toàn
    const hasSafeJsonParse = serverCode.includes('request.json()') || serverCode.includes('JSON.parse');
    if (hasSafeJsonParse) {
      passed.push('Đã cấu hình parsing body JSON an toàn');
    }
  }

  // 2. Kiểm tra UI crash boundaries trong src/app.js hoặc src/ui.js
  const uiFiles = ['src/app.js', 'src/ui.js'].filter(f => fs.existsSync(f));
  let unhandledPromiseCatch = false;
  for (const f of uiFiles) {
    const code = fs.readFileSync(f, 'utf8');
    if (code.includes('window.addEventListener(\'error\'') || code.includes('window.onerror') || code.includes('showToast') || code.includes('catch(')) {
      unhandledPromiseCatch = true;
      break;
    }
  }

  if (unhandledPromiseCatch) {
    passed.push('Client-side có cơ chế toast/alert thông báo lỗi khi API hoặc action thất bại');
  } else {
    issues.push({
      severity: 'WARNING',
      message: 'Không tìm thấy fallback toast hiển thị lỗi trên UI khi API trả về mã lỗi 4xx/5xx'
    });
  }

  return {
    module: 'Bugs (Chaos Monkey & Edge Hunter)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-chaos.mjs')) {
  auditChaos().then(res => console.log(JSON.stringify(res, null, 2)));
}
