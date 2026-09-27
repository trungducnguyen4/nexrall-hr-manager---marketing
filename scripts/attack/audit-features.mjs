#!/usr/bin/env node
/**
 * Attack Squad: Feature Navigator
 * Kiểm tra tính toàn vẹn của tất cả User Flows, routes, static pages và template links.
 */
import fs from 'node:fs';
import path from 'node:path';

export async function auditFeatures(options = {}) {
  const issues = [];
  const passed = [];

  console.log('🧭 [Feature Navigator] Bắt đầu duyệt toàn bộ user flows & routes...');

  // 1. Kiểm tra các file HTML và SPA entry points
  const candidateHtml = fs.existsSync('index.html') ? 'index.html' : 'public/index.html';
  const expectedPages = [
    candidateHtml,
    'src/app.js',
    'src/api.js',
    'server.js'
  ];

  for (const page of expectedPages) {
    if (fs.existsSync(page)) {
      passed.push(`Trang/Module cốt lõi tồn tại: ${page}`);
    } else {
      issues.push({ severity: 'CRITICAL', message: `Thiếu module trọng yếu: ${page}` });
    }
  }

  // 2. Quét các route endpoints được định nghĩa trong server.js
  if (fs.existsSync('server.js')) {
    const serverCode = fs.readFileSync('server.js', 'utf8');
    const routeRegex = /url\.pathname\s*===?\s*['"]([^'"]+)['"]/g;
    let match;
    const detectedRoutes = new Set();
    while ((match = routeRegex.exec(serverCode)) !== null) {
      detectedRoutes.add(match[1]);
    }

    if (detectedRoutes.size > 0) {
      passed.push(`Phát hiện ${detectedRoutes.size} endpoint routes hợp lệ trên server`);
    } else {
      issues.push({ severity: 'HIGH', message: 'Không phát hiện bất kỳ route handler nào trong server.js' });
    }
  }

  // 3. Quét các nút bấm và navigation tabs trong HTML / src
  if (fs.existsSync('public/index.html')) {
    const htmlContent = fs.readFileSync('public/index.html', 'utf8');
    // Kiểm tra thẻ href rỗng hoặc '#' không có handler
    const emptyLinks = (htmlContent.match(/href=["']#["']/g) || []).length;
    if (emptyLinks > 5) {
      issues.push({ severity: 'WARNING', message: `Phát hiện ${emptyLinks} thẻ liên kết dạng href='#' có thể là dead links` });
    } else {
      passed.push('Không có dead links bất thường trong index.html');
    }
  }

  return {
    module: 'Features (User Flow Navigator)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-features.mjs')) {
  auditFeatures().then(res => console.log(JSON.stringify(res, null, 2)));
}
