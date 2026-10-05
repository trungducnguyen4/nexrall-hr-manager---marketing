import assert from 'node:assert/strict';
import {
  verifyToolAuthorization,
  verifyAndCleanCitations,
  executeTool,
  runCopilotTurn,
  COPILOT_TOOLS
} from '../server/services/agent.service.js';

console.log('--- Test Suite: P1 Agentic Architecture, Tool Calling & Citation Grounding ---');

const regularEmployee = {
  id: 10,
  full_name: 'Lê Văn Nhân Viên',
  role: 'employee',
  department: 'Marketing'
};

const adminUser = {
  id: 1,
  full_name: 'Nguyễn Văn Admin',
  role: 'admin',
  department: 'Ban Giám Đốc'
};

const hcnsUser = {
  id: 2,
  full_name: 'Trần Thị HCNS',
  role: 'employee',
  department: 'Phòng HCNS'
};

class MockD1 {
  prepare(sql) {
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes('FROM payroll')) return null;
            return null;
          },
          async all() { return { results: [] }; },
          async run() { return { success: true, meta: { last_row_id: 1 } }; }
        };
      },
      async all() { return { results: [] }; },
      async run() { return { success: true }; }
    };
  }
}

const mockEnv = { DB: new MockD1() };

async function runTests() {
  // Test 1: P1.2 & P1.3 Tool Authorization Guard (Defense in Depth)
  {
    // 1.1 Kiểm toán bảng lương (Chỉ Admin / HCNS)
    const empAudit = verifyToolAuthorization('audit_payroll_anomalies', {}, regularEmployee);
    assert.equal(empAudit.allowed, false, 'Nhân viên thường không được phép kiểm toán bảng lương');
    assert.equal(empAudit.error, 'PERMISSION_DENIED');

    const adminAudit = verifyToolAuthorization('audit_payroll_anomalies', {}, adminUser);
    assert.equal(adminAudit.allowed, true, 'Admin được phép kiểm toán bảng lương');

    const hcnsAudit = verifyToolAuthorization('audit_payroll_anomalies', {}, hcnsUser);
    assert.equal(hcnsAudit.allowed, true, 'Ban HCNS được phép kiểm toán bảng lương');

    // 1.2 Xem bảng lương người khác (Chỉ xem của chính mình)
    const viewOtherPayslip = verifyToolAuthorization('get_my_payslip_summary', { userId: 99 }, regularEmployee);
    assert.equal(viewOtherPayslip.allowed, false, 'Nhân viên thường không được tra cứu bảng lương của ID khác');

    const viewOwnPayslip = verifyToolAuthorization('get_my_payslip_summary', { userId: 10 }, regularEmployee);
    assert.equal(viewOwnPayslip.allowed, true, 'Nhân viên được phép tra cứu bảng lương của chính mình');

    // 1.3 Duyệt đơn nghỉ phép (Chỉ Quản lý / Admin)
    const empApprove = verifyToolAuthorization('leave_approve', { requestId: 5 }, regularEmployee);
    assert.equal(empApprove.allowed, false, 'Nhân viên thường không thể duyệt đơn nghỉ phép');

    const adminApprove = verifyToolAuthorization('leave_approve', { requestId: 5 }, adminUser);
    assert.equal(adminApprove.allowed, true, 'Admin có quyền duyệt đơn');

    console.log('  ok  P1.2/P1.3 Tool Layer Authorization: Strict RBAC independent of prompt context');
  }

  // Test 2: P1.4 Citation Grounding & Anti-Hallucination
  {
    const validCitations = [
      { index: 1, docTitle: 'Quy chế lao động', sectionTitle: 'Điều 1' },
      { index: 2, docTitle: 'Nội quy nghỉ phép', sectionTitle: 'Điều 2' }
    ];

    const inputWithValid = 'Theo quy chế công ty [1] và nội quy nghỉ phép [2], nhân sự được hưởng phép năm.';
    const cleanedValid = verifyAndCleanCitations(inputWithValid, validCitations);
    assert.equal(cleanedValid, inputWithValid, 'Citations hợp lệ [1], [2] phải được giữ nguyên');

    const inputWithHallucinated = 'Theo luật lao động [1], quy định mới [5] và phụ lục mật [9], nhân sự được thưởng.';
    const cleanedHallucinated = verifyAndCleanCitations(inputWithHallucinated, validCitations);
    assert.ok(!cleanedHallucinated.includes('[5]'), 'Citation [5] không có trong context phải bị loại bỏ');
    assert.ok(!cleanedHallucinated.includes('[9]'), 'Citation [9] không có trong context phải bị loại bỏ');
    assert.ok(cleanedHallucinated.includes('[1]'), 'Citation hợp lệ [1] vẫn được giữ nguyên');

    console.log('  ok  P1.4 Citation Grounding: Strips fabricated citation indices not in RAG context');
  }

  // Test 3: Structured Tool Execution (Read vs Write with HITL)
  {
    // Write Tool: create_leave_request_draft phải trả về Action Card Human-in-the-loop
    const leaveDraft = await executeTool(mockEnv, 'create_leave_request_draft', {
      leaveType: 'annual',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      reason: 'Việc gia đình'
    }, regularEmployee);

    assert.ok(leaveDraft.actionCard || leaveDraft.isActionCard, 'Write Tool phải trả về Action Card');
    console.log('  ok  P1.1 Structured Tool Execution: Write tools produce Human-in-the-Loop Action Cards');
  }

  // Test 4: Schema completeness of COPILOT_TOOLS
  {
    assert.ok(COPILOT_TOOLS.length >= 8, 'Hệ thống phải có ít nhất 8 công cụ nghiệp vụ HR');
    for (const tool of COPILOT_TOOLS) {
      assert.ok(tool.name, 'Tool phải có tên');
      assert.ok(tool.description, 'Tool phải có mô tả');
      assert.ok(tool.parameters, 'Tool phải có parameters schema');
      assert.equal(tool.parameters.type, 'object', 'Parameters phải là JSON object schema');
    }
    console.log(`  ok  P1.1 Tool Schema: All ${COPILOT_TOOLS.length} tools adhere to standard OpenAPI/JSON Schema`);
  }

  console.log('\n--- ALL P1 AGENTIC & TOOL CALLING AUDITS PASSED! ---');
}

runTests().catch(err => {
  console.error('P1 Audit failed:', err);
  process.exit(1);
});
