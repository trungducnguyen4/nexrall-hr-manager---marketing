#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export async function auditPerformance(options = {}) {
  const issues = [];
  const passed = [];

  console.log('⚡ [Performance Profiler] Đo đạc hiệu năng và kích thước tài nguyên NetViet HR...');

  // 1. Kiểm tra SQLite Indexing trong d1-schema.sql
  if (fs.existsSync('scripts/d1-schema.sql')) {
    const schema = fs.readFileSync('scripts/d1-schema.sql', 'utf8');
    const indexMatches = schema.match(/CREATE INDEX/gi) || [];
    if (indexMatches.length >= 5) {
      passed.push(`Cloudflare D1 Schema đã cấu hình ${indexMatches.length} chỉ mục (INDEX) tăng tốc truy vấn SQLite`);
    } else {
      issues.push({
        severity: 'LOW',
        message: `D1 Schema có ít hơn 5 chỉ mục INDEX (${indexMatches.length}). Cân nhắc thêm INDEX cho các cột tra cứu lớn.`
      });
    }
  }

  // 2. Kiểm tra kích thước tài nguyên public
  const targetDir = fs.existsSync('.local-public') ? '.local-public' : 'public';
  if (fs.existsSync(targetDir)) {
    let totalBytes = 0;
    function calcSize(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          calcSize(full);
        } else {
          totalBytes += fs.statSync(full).size;
        }
      }
    }
    calcSize(targetDir);
    const mbSize = (totalBytes / (1024 * 1024)).toFixed(2);
    if (totalBytes < 15 * 1024 * 1024) {
      passed.push(`Tổng kích thước thư mục web tĩnh (${targetDir}) gọn gàng: ${mbSize} MB (ngưỡng tối đa 15 MB)`);
    } else {
      issues.push({
        severity: 'MEDIUM',
        message: `Thư mục web tĩnh (${targetDir}) hơi lớn (${mbSize} MB), cần kiểm tra xem có lẫn file rác không.`
      });
    }
  }

  // 3. Kiểm tra PWA Service Worker
  if (fs.existsSync('sw.js') || fs.existsSync('.local-public/sw.js')) {
    passed.push('Hệ thống tích hợp PWA Service Worker (sw.js) hỗ trợ caching và offline shell');
  }

  return {
    module: '3. Performance (Profiler & Size)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-perf.mjs')) {
  auditPerformance().then(res => console.log(JSON.stringify(res, null, 2)));
}
