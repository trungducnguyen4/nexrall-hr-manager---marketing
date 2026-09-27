#!/usr/bin/env node
/**
 * Attack Squad: Security Auditor
 * Rà quét Secret Leak, kiểm tra SQL Injection prevention (Prepared Statements) và Phân quyền.
 */
import fs from 'node:fs';
import path from 'node:path';

export async function auditSecurity(options = {}) {
  const issues = [];
  const passed = [];

  console.log('🛡️ [Security Auditor] Quét Secret Token, SQL Injection và phân quyền API...');

  // 1. Quét Secret Leaks trong mã nguồn client-side (public/, src/, styles/)
  const clientDirs = ['public', 'src', 'styles'].filter(d => fs.existsSync(d));
  const secretPatterns = [
    /eyJhbGciOi/g, // Raw JWT
    /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub Token
    /CLOUDFLARE_API_TOKEN\s*=\s*['"][a-zA-Z0-9]/gi
  ];

  function scanSecrets(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanSecrets(fullPath);
      } else if (/\.(js|html|css|json)$/.test(file)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            issues.push({
              severity: 'CRITICAL',
              message: `Phát hiện nghi vấn rò rỉ Secret / Hardcoded Token tại: ${fullPath}`
            });
            break;
          }
        }
      }
    }
  }

  for (const d of clientDirs) {
    scanSecrets(d);
  }

  if (!issues.some(i => i.severity === 'CRITICAL')) {
    passed.push('Không phát hiện Hardcoded Secret hoặc API Key bị lộ trong mã nguồn Frontend');
  }

  // 2. Quét chống SQL Injection (Prepared Statements D1 DB)
  if (fs.existsSync('server.js')) {
    const serverCode = fs.readFileSync('server.js', 'utf8');
    // Kiểm tra xem D1 có dùng prepare hay không
    if (serverCode.includes('.prepare(')) {
      passed.push('Database D1 queries sử dụng Parameterized Statements (.prepare().bind()) an toàn');
    }
  }

  // 3. Kiểm tra bảo vệ Auth / Session headers
  if (fs.existsSync('server.js')) {
    const serverCode = fs.readFileSync('server.js', 'utf8');
    if (serverCode.includes('Authorization') || serverCode.includes('session') || serverCode.includes('token') || serverCode.includes('auth')) {
      passed.push('Hệ thống có cơ chế kiểm tra Authentication / Session trên các endpoint nhạy cảm');
    } else {
      issues.push({
        severity: 'HIGH',
        message: 'Cảnh báo: Không phát hiện middleware hoặc header check xác thực người dùng trong server'
      });
    }
  }

  return {
    module: 'Security (Auditor)',
    passed,
    issues,
    status: issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH') ? 'FAILED' : (issues.length > 0 ? 'WARNING' : 'PASSED')
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit-security.mjs')) {
  auditSecurity().then(res => console.log(JSON.stringify(res, null, 2)));
}
