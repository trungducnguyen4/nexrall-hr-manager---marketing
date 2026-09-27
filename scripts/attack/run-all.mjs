#!/usr/bin/env node
/**
 * Attack Squad: Master Orchestrator
 * Điều phối đồng thời 4 mũi nhọn (Features, Bugs, Performance, Security)
 * và quyết định Release Gate (PASS / BLOCK).
 */
import { auditFeatures } from './audit-features.mjs';
import { auditChaos } from './audit-chaos.mjs';
import { auditPerformance } from './audit-perf.mjs';
import { auditSecurity } from './audit-security.mjs';
import fs from 'node:fs';

async function runAttackSquad() {
  console.log('========================================================');
  console.log('🚀 [ATTACK SQUAD] KHỞI ĐỘNG CHIẾN DỊCH TỔNG TẤN CÔNG PRE-LAUNCH');
  console.log('========================================================\n');

  const [featuresRes, chaosRes, perfRes, secRes] = await Promise.all([
    auditFeatures(),
    auditChaos(),
    auditPerformance(),
    auditSecurity()
  ]);

  const allResults = [featuresRes, chaosRes, perfRes, secRes];

  let hasCriticalOrHigh = false;
  let markdownSummary = `# 🛡️ Attack Squad Pre-Launch Report\n\n`;
  markdownSummary += `> **Thời gian thực hiện**: ${new Date().toISOString()}\n\n`;
  markdownSummary += `| Mũi nhọn (Vector) | Trạng thái | Đạt tiêu chuẩn | Vấn đề phát hiện |\n`;
  markdownSummary += `| :--- | :--- | :--- | :--- |\n`;

  for (const res of allResults) {
    const icon = res.status === 'PASSED' ? '✅' : (res.status === 'WARNING' ? '⚠️' : '❌');
    const passedCount = res.passed.length;
    const issuesCount = res.issues.length;
    markdownSummary += `| ${res.module} | ${icon} **${res.status}** | ${passedCount} tiêu chí | ${issuesCount} vấn đề |\n`;

    if (res.issues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')) {
      hasCriticalOrHigh = true;
    }
  }

  markdownSummary += `\n## 📝 Chi tiết đánh giá 4 Mũi Nhọn\n\n`;

  for (const res of allResults) {
    markdownSummary += `### ${res.module}\n`;
    if (res.passed.length > 0) {
      markdownSummary += `**✅ Đạt chuẩn:**\n`;
      for (const p of res.passed) markdownSummary += `- ${p}\n`;
    }
    if (res.issues.length > 0) {
      markdownSummary += `\n**⚠️ Vấn đề cần chú ý:**\n`;
      for (const iss of res.issues) {
        markdownSummary += `- [**${iss.severity}**] ${iss.message}\n`;
      }
    }
    markdownSummary += `\n`;
  }

  console.log(markdownSummary);

  console.log('\n========================================================');
  console.log('📊 KẾT QUẢ ĐÁNH GIÁ RELEASE GATE:');
  if (hasCriticalOrHigh) {
    console.error('❌ RELEASE GATE: BỊ CHẶN (BLOCKED)!');
    console.error('Phát hiện lỗi nghiêm trọng (Critical/High). Hủy quy trình Deploy!');
    markdownSummary += `\n> [!CAUTION]\n> **RELEASE GATE: BLOCKED!** Phát hiện lỗi nghiêm trọng (Critical/High). Hủy bỏ quyền triển khai sản phẩm.\n`;
  } else {
    console.log('✅ RELEASE GATE: ĐẠT TIÊU CHUẨN (PASSED)!');
    console.log('Hệ thống an toàn để tiến hành Launch / Release.');
    markdownSummary += `\n> [!NOTE]\n> **RELEASE GATE: PASSED!** Hệ thống đạt tiêu chuẩn xuất xưởng an toàn.\n`;
  }
  console.log('========================================================\n');

  // Nếu chạy trong môi trường GitHub Actions, ghi vào Step Summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary);
      console.log('Đã xuất báo cáo vào GitHub Step Summary.');
    } catch (e) {
      console.error('Không thể ghi vào GITHUB_STEP_SUMMARY:', e.message);
    }
  }

  if (hasCriticalOrHigh) {
    process.exit(1);
  }
}

runAttackSquad();
