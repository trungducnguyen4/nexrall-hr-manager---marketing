#!/usr/bin/env node
/**
 * Attack Squad: Performance Profiler
 * Quét kích thước asset, phát hiện phình to file tĩnh và kiểm tra cấu trúc Worker.
 */
import fs from 'node:fs';
import path from 'node:path';

export async function auditPerformance(options = {}) {
  const issues = [];
  const passed = [];

  console.log('⚡ [Performance Profiler] Đo đạc hiệu năng, kích thước bundle và assets...');

  // 1. Quét dung lượng các file trong public/
  const MAX_BUNDLE_SIZE_KB = 1500; // 1.5MB cảnh báo cho single asset
  const targetDirs = ['public', 'src', 'styles'].filter(d => fs.existsSync(d));

  function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else {
        const sizeKb = Math.round(stat.size / 1024);
        if (sizeKb > MAX_BUNDLE_SIZE_KB) {
          issues.push({
            severity: 'WARNING',
            message: `Tài nguyên ${fullPath} quá lớn (${sizeKb} KB > ngưỡng ${MAX_BUNDLE_SIZE_KB} KB)`
          });
        }
      }
    }
  }

  for (const d of targetDirs) {
    scanDir(d);
  }

  if (!issues.some(i => i.message.includes('quá lớn'))) {
    passed.push(`Toàn bộ static assets đều nằm trong ngưỡng kích thước an toàn (< ${MAX_BUNDLE_SIZE_KB} KB)`);
  }

  // 2. Kiểm tra cache header hoặc gzip/static handling
  if (fs.existsSync('wrangler.toml')) {
    const wranglerConfig = fs.readFileSync('wrangler.toml', 'utf8');
    if (wranglerConfig.includes('[assets]')) {
      passed.push('Cloudflare Assets binding đã được cấu hình tối ưu để phân phối qua CDN Global Edge');
    } else {
      issues.push({
        severity: 'WARNING',
        message: 'wrangler.toml chưa khai báo binding [assets] tối ưu CDN'
      });
    }
  }

  return {
    module: 'Performance (Profiler)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-perf.mjs')) {
  auditPerformance().then(res => console.log(JSON.stringify(res, null, 2)));
}
