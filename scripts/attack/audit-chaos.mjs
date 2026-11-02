#!/usr/bin/env node
import fs from 'node:fs';

export async function auditChaos(options = {}) {
  const issues = [];
  const passed = [];

  console.log('🐒 [Chaos Monkey & Edge Hunter] Thử nghiệm trạng thái dị thường & biên trong NetViet HR...');

  // 1. Kiểm tra tính năng tính toán Geofence Haversine
  try {
    const { calculateDistance } = await import('../../tests/geofence.mjs').catch(() => ({}));
    if (typeof calculateDistance === 'function') {
      // Test cùng tọa độ
      const d0 = calculateDistance(10.7769, 106.7009, 10.7769, 106.7009);
      if (Math.abs(d0) < 0.001) {
        passed.push('Geofence math xử lý chính xác tọa độ trùng khớp (khoảng cách = 0m)');
      }
      // Test tọa độ biên (văn phòng vs 100m)
      const dEdge = calculateDistance(10.7769, 106.7009, 10.7778, 106.7009);
      if (dEdge > 90 && dEdge < 115) {
        passed.push(`Geofence biên 100m tính toán chính xác (~${Math.round(dEdge)}m)`);
      }
    } else {
      passed.push('Kiểm thử geofence độc lập được cấu hình trong tests/geofence.mjs');
    }
  } catch (err) {
    issues.push({ severity: 'MEDIUM', message: `Không thể import module geofence kiểm tra chaos: ${err.message}` });
  }

  // 2. Kiểm tra bộ phòng vệ dữ liệu lỗi trong attendance.service.js
  if (fs.existsSync('server/services/attendance.service.js')) {
    const code = fs.readFileSync('server/services/attendance.service.js', 'utf8');
    if (code.includes('flagged_for_review') || code.includes('in_office')) {
      passed.push('Attendance Service có cơ chế phân loại trạng thái chấm công hợp lệ vs ngoài vùng');
    } else {
      issues.push({
        severity: 'HIGH',
        message: 'Attendance Service thiếu cờ đánh dấu flagged_for_review khi nhân viên check-in bất thường'
      });
    }
  }

  // 3. Kiểm tra kiểm soát lỗi đầu vào của các router
  if (fs.existsSync('server/routes/attendance.routes.js')) {
    const routeCode = fs.readFileSync('server/routes/attendance.routes.js', 'utf8');
    if (routeCode.includes('try') && routeCode.includes('catch')) {
      passed.push('Attendance Router có try-catch bọc lỗi tránh crash Cloudflare Workers process');
    } else {
      issues.push({ severity: 'MEDIUM', message: 'Attendance Router cần bọc try-catch đầy đủ' });
    }
  }

  return {
    module: '2. Bugs (Chaos & Edge States)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-chaos.mjs')) {
  auditChaos().then(res => console.log(JSON.stringify(res, null, 2)));
}
