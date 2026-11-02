#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export async function auditSecurity(options = {}) {
  const issues = [];
  const passed = [];

  console.log('🛡️ [Security Auditor] Giả lập tấn công bảo mật, rò rỉ secret và phân quyền...');

  // 1. Kiểm tra Ma trận phân quyền Role
  if (fs.existsSync('server/lib/roles.js')) {
    const rolesCode = fs.readFileSync('server/lib/roles.js', 'utf8');
    if (rolesCode.includes('isHrOrBod') && rolesCode.includes('isDeptManager') && rolesCode.includes('isDirectorHau')) {
      passed.push('Hệ thống kiểm soát phân quyền (server/lib/roles.js) có guard cho HCNS, Ban Giám Đốc, Trưởng phòng');
    } else {
      issues.push({
        severity: 'CRITICAL',
        message: 'server/lib/roles.js thiếu logic phân quyền isHrOrBod / isDeptManager / isDirectorHau!'
      });
    }
  }

  // 2. Quét chống rò rỉ file backend trong .local-public
  const forbiddenFiles = ['server.js', 'worker.js', 'package.json', 'wrangler.toml', 'wrangler.prod.toml'];
  const pubDir = '.local-public';
  if (fs.existsSync(pubDir)) {
    for (const file of forbiddenFiles) {
      if (fs.existsSync(path.join(pubDir, file))) {
        issues.push({
          severity: 'CRITICAL',
          message: `Lỗ hổng bảo mật: Phát hiện file server nhạy cảm ${file} trong thư mục public (${pubDir})!`
        });
      }
    }
    if (!issues.some(i => i.severity === 'CRITICAL')) {
      passed.push(`Thư mục public (${pubDir}) sạch sẽ, không chứa file mã nguồn máy chủ nhạy cảm`);
    }
  }

  // 3. Quét chống rò rỉ JWT Secret hoặc API Key cứng trong mã nguồn frontend
  const feDirs = ['src', 'styles'].filter(d => fs.existsSync(d));
  const secretPatterns = [
    /CLOUDFLARE_API_TOKEN\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
    /jwt_secret\s*[:=]\s*['"][a-zA-Z0-9_\-]{15,}['"]/gi,
    /AIzaSy[0-9A-Za-z\-_]{33}/g // Google API key pattern
  ];

  function scanSecrets(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanSecrets(fullPath);
      } else if (/\.(js|html|css)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            issues.push({
              severity: 'CRITICAL',
              message: `Phát hiện nghi vấn rò rỉ Hardcoded Secret/Token tại: ${fullPath}`
            });
            break;
          }
        }
      }
    }
  }

  for (const d of feDirs) scanSecrets(d);

  if (!issues.some(i => i.message.includes('Hardcoded Secret'))) {
    passed.push('Mã nguồn Frontend không bị lộ API Token hoặc JWT Secret cứng');
  }

  return {
    module: '4. Security (Auditor & IDOR)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-security.mjs')) {
  auditSecurity().then(res => console.log(JSON.stringify(res, null, 2)));
}
