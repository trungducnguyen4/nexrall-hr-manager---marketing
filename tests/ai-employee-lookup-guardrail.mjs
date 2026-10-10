// tests/ai-employee-lookup-guardrail.mjs
// Automated verification suite for Smart Employee Lookup & Enterprise Privacy Guardrail
import assert from 'node:assert/strict';
import {
  stripVietnameseAccents,
  extractEmployeeLookupTarget,
  isSelfLookup,
  findEmployeeSmart,
  verifyToolAuthorization,
  getToolsForPersona,
  runCopilotTurn
} from '../server/services/agent.service.js';

console.log('--- Test Suite: Smart Employee Lookup & Privacy Guardrails ---');

// Mock Users
const mockUsers = [
  {
    id: 531,
    employee_code: 'THUYDT',
    full_name: 'Doãn Thị Thủy',
    department: 'Phòng HCNS',
    position: 'Chuyên viên HCNS',
    email: 'thuy.doan@netviet.live',
    phone: '0912345678',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'employee',
    contract_type: 'Chính thức'
  },
  {
    id: 532,
    employee_code: 'THUYTTT',
    full_name: 'Trần Thị Thanh Thùy',
    department: 'Phòng HCNS',
    position: 'Chuyên viên Tuyển dụng',
    email: 'thuy.tran@netviet.live',
    phone: '0912999888',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'employee',
    contract_type: 'Chính thức'
  },
  {
    id: 533,
    employee_code: 'VYNNT',
    full_name: 'Nguyễn Ngọc Thủy Vy',
    department: 'Phòng HCNS',
    position: 'Thực tập sinh HCNS',
    email: 'vy.nguyen@netviet.live',
    phone: '0912111222',
    is_active: 1,
    lifecycle_status: 'Thử việc',
    role: 'employee',
    contract_type: 'Thực tập'
  },
  {
    id: 530,
    employee_code: 'DUCNT',
    full_name: 'Nguyễn Trung Đức',
    department: 'Phòng IT',
    position: 'Trưởng phòng IT',
    email: 'duc.nguyen@netviet.live',
    phone: '0987654321',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'manager',
    contract_type: 'Chính thức'
  },
  {
    id: 101,
    employee_code: 'NV-101',
    full_name: 'Nguyễn Văn Nhân',
    department: 'Phòng Marketing',
    position: 'Nhân viên Marketing',
    email: 'nhan.nguyen@netviet.live',
    phone: '0901112233',
    is_active: 1,
    lifecycle_status: 'Thử việc',
    role: 'employee',
    contract_type: 'Thử việc'
  }
];

// Mock Sessions
const userAdmin = {
  id: 1,
  employee_code: 'ADMIN001',
  full_name: 'Quản trị viên',
  role: 'admin',
  department: 'Ban Giám Đốc'
};

const userHr = {
  id: 531,
  employee_code: 'THUYDT',
  full_name: 'Doãn Thị Thủy',
  role: 'employee',
  department: 'Phòng HCNS'
};

const userEmployee = {
  id: 101,
  employee_code: 'NV-101',
  full_name: 'Nguyễn Văn Nhân',
  role: 'employee',
  department: 'Phòng Marketing'
};

// Mock D1 Environment
function createMockEnv() {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async all() {
                if (sql.includes('FROM users')) {
                  return { results: mockUsers };
                }
                if (sql.includes('FROM attendance')) {
                  const uid = Number(args[0]);
                  if (uid === 531) {
                    return {
                      results: [{
                        checkin_time: '08:15',
                        checkout_time: null,
                        work_type: 'office',
                        status: 'present',
                        late_minutes: 0
                      }]
                    };
                  }
                  return { results: [] };
                }
                return { results: [] };
              },
              async first() {
                if (sql.includes('FROM attendance')) {
                  const uid = Number(args[0]);
                  if (uid === 531) {
                    return {
                      checkin_time: '08:15',
                      checkout_time: null,
                      work_type: 'office',
                      status: 'present',
                      late_minutes: 0
                    };
                  }
                  return null;
                }
                if (sql.includes('FROM leave_requests')) {
                  return null;
                }
                return null;
              },
              async run() {
                return { success: true };
              }
            };
          },
          async all() {
            if (sql.includes('FROM users')) {
              return { results: mockUsers };
            }
            return { results: [] };
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true };
          }
        };
      }
    }
  };
}

// 1. Vietnamese Accent Removal & Normalization
{
  assert.equal(stripVietnameseAccents('Đoàn thị thủy'), 'doan thi thuy');
  assert.equal(stripVietnameseAccents('Doãn Thị Thủy'), 'doan thi thuy');
  assert.equal(stripVietnameseAccents('Nguyễn Trung Đức'), 'nguyen trung duc');
  assert.equal(stripVietnameseAccents('Đào Quý Vương'), 'dao quy vuong');
  assert.equal(stripVietnameseAccents('Đoàn thị thủy'), stripVietnameseAccents('Doãn Thị Thủy'));
  console.log('  ok  1. stripVietnameseAccents: Perfect normalization across Vietnamese diacritics');
}

// 2. Intent Target Extraction
{
  assert.equal(extractEmployeeLookupTarget('Đoàn thị thủy là ai'), 'Đoàn thị thủy');
  assert.equal(extractEmployeeLookupTarget('Đoàn thị thủy là ai?'), 'Đoàn thị thủy');
  assert.equal(extractEmployeeLookupTarget('Doãn Thị Thủy là ai thế'), 'Doãn Thị Thủy');
  assert.equal(extractEmployeeLookupTarget('ai là Doãn Thị Thủy'), 'Doãn Thị Thủy');
  assert.equal(extractEmployeeLookupTarget('thông tin về Doãn Thị Thủy'), 'Doãn Thị Thủy');
  assert.equal(extractEmployeeLookupTarget('hồ sơ của THUYDT'), 'THUYDT');
  assert.equal(extractEmployeeLookupTarget('số điện thoại của Doãn Thị Thủy'), 'Doãn Thị Thủy');
  assert.equal(extractEmployeeLookupTarget('tìm nhân viên Doãn Thị Thủy'), 'Doãn Thị Thủy');
  assert.equal(extractEmployeeLookupTarget('tra cứu nhân sự Nguyễn Trung Đức'), 'Nguyễn Trung Đức');
  assert.equal(extractEmployeeLookupTarget('DUCNT là ai'), 'DUCNT');
  console.log('  ok  2. extractEmployeeLookupTarget: Accurately parses natural language employee queries');
}

// 3. Smart Employee Matching
{
  const env = createMockEnv();

  // Test 3a: "Đoàn thị thủy" matches "Doãn Thị Thủy" (Tier 3: unaccented full name)
  const match1 = await findEmployeeSmart(env, 'Đoàn thị thủy');
  assert.equal(match1.found, true, 'Should find employee for Đoàn thị thủy');
  assert.equal(match1.employee.id, 531);
  assert.equal(match1.employee.employee_code, 'THUYDT');
  assert.equal(match1.employee.full_name, 'Doãn Thị Thủy');
  assert.ok(match1.note, 'Should have note clarifying exact name');

  // Test 3b: Exact Code Match "THUYDT"
  const match2 = await findEmployeeSmart(env, 'THUYDT');
  assert.equal(match2.found, true);
  assert.equal(match2.employee.id, 531);
  assert.equal(match2.matchedVia, 'code');

  // Test 3c: First Name Match "Thủy" (exact accented among candidates)
  const match3 = await findEmployeeSmart(env, 'Thủy');
  assert.equal(match3.found, true);
  assert.equal(match3.employee.id, 531);
  assert.equal(match3.employee.full_name, 'Doãn Thị Thủy');

  // Test 3d: First Name Match "Thùy" (exact accented among candidates)
  const match4 = await findEmployeeSmart(env, 'Thùy');
  assert.equal(match4.found, true);
  assert.equal(match4.employee.id, 532);
  assert.equal(match4.employee.full_name, 'Trần Thị Thanh Thùy');

  // Test 3e: Unaccented First Name "thuy" -> Ambiguous, returns multiple candidates
  const match5 = await findEmployeeSmart(env, 'thuy');
  assert.equal(match5.found, true);
  assert.equal(match5.multiple, true);
  assert.equal(match5.candidates.length, 2);
  assert.ok(match5.candidates.some(c => c.employee_code === 'THUYDT'));
  assert.ok(match5.candidates.some(c => c.employee_code === 'THUYTTT'));

  // Test 3f: Middle/Full Match "Thủy Vy"
  const match6 = await findEmployeeSmart(env, 'Thủy Vy');
  assert.equal(match6.found, true);
  assert.equal(match6.employee.id, 533);
  assert.equal(match6.employee.full_name, 'Nguyễn Ngọc Thủy Vy');

  // Test 3g: Non-existent employee
  const match7 = await findEmployeeSmart(env, 'Người Không Tồn Tại 12345');
  assert.equal(match7.found, false);

  console.log('  ok  3. findEmployeeSmart: Multi-tier matching handles exact, unaccented, accented disambiguation, and multiple candidates');
}

// 4. RBAC Tool Filtering & Execution Authorization
{
  // L1: Tool filtering - regular employee must NOT have search_employee_directory
  const empTools = getToolsForPersona('employee', userEmployee).map(t => t.name);
  assert.equal(empTools.includes('search_employee_directory'), false, 'Employee must NOT have search_employee_directory schema');

  const hrTools = getToolsForPersona('hr', userHr).map(t => t.name);
  assert.equal(hrTools.includes('search_employee_directory'), true, 'HR must have search_employee_directory schema');

  const dirTools = getToolsForPersona('director', userAdmin).map(t => t.name);
  assert.equal(dirTools.includes('search_employee_directory'), true, 'Director must have search_employee_directory schema');

  // L2: Backend authorization check
  assert.equal(verifyToolAuthorization('search_employee_directory', { search: 'Thủy' }, userEmployee).allowed, false, 'Employee rejected from executing search_employee_directory');
  assert.equal(verifyToolAuthorization('search_employee_directory', { search: 'Thủy' }, userAdmin).allowed, true, 'Admin allowed to execute search_employee_directory');
  assert.equal(verifyToolAuthorization('search_employee_directory', { search: 'Thủy' }, userHr).allowed, true, 'HR allowed to execute search_employee_directory');

  console.log('  ok  4. RBAC Defense-in-depth: L1 Schema separation & L2 Backend authorization verified');
}

// 5. End-to-End Chat Turn: Privacy Guardrail vs Admin Lookup
{
  const env = createMockEnv();

  // Test 5a: Regular employee asks "Đoàn thị thủy là ai" -> MUST BE BLOCKED
  const empTurn = await runCopilotTurn(env, {
    userMessage: 'Đoàn thị thủy là ai',
    me: userEmployee,
    conversationId: 'test_emp'
  });
  assert.ok(empTurn.content.includes('Chính sách Bảo mật Dữ liệu Doanh nghiệp'), 'Employee request must be intercepted by privacy guardrail');
  assert.ok(empTurn.content.includes('từ chối'), 'Must explicitly mention rejection of looking up others');
  assert.ok(!empTurn.content.includes('0912345678'), 'Must NOT leak phone number');
  assert.ok(!empTurn.content.includes('thuy.doan@netviet.live'), 'Must NOT leak email');
  assert.equal(empTurn.actionCard, null, 'Must NOT provide profile card to regular employee');

  // Test 5b: Admin asks "Đoàn thị thủy là ai" -> MUST BE ALLOWED & RETURN PROFILE
  const adminTurn = await runCopilotTurn(env, {
    userMessage: 'Đoàn thị thủy là ai',
    me: userAdmin,
    conversationId: 'test_admin'
  });
  assert.ok(adminTurn.content.includes('Doãn Thị Thủy'), 'Admin response must contain Doãn Thị Thủy');
  assert.ok(adminTurn.content.includes('THUYDT'), 'Admin response must contain employee code');
  assert.ok(adminTurn.content.includes('Phòng HCNS'), 'Admin response must contain department');
  assert.ok(adminTurn.content.includes('thuy.doan@netviet.live'), 'Admin response must contain email');
  assert.ok(adminTurn.content.includes('0912345678'), 'Admin response must contain phone');
  assert.ok(adminTurn.actionCard, 'Admin response must provide action/navigation card');
  assert.equal(adminTurn.actionCard.link, '#/users/531', 'Action card must link directly to #/users/531');

  // Test 5c: Admin asks ambiguous "thuy là ai" -> MUST RETURN LIST OF CANDIDATES
  const adminMultiTurn = await runCopilotTurn(env, {
    userMessage: 'thuy là ai',
    me: userAdmin,
    conversationId: 'test_admin_multi'
  });
  assert.ok(adminMultiTurn.content.includes('Doãn Thị Thủy'), 'Multi response must include Doãn Thị Thủy');
  assert.ok(adminMultiTurn.content.includes('Trần Thị Thanh Thùy'), 'Multi response must include Trần Thị Thanh Thùy');
  assert.equal(adminMultiTurn.actionCard.link, '#/users', 'Action card must link to #/users directory');

  // Test 5d: Self Lookup for Regular Employee ("Tôi là ai" / "thông tin của tôi")
  const selfTurn = await runCopilotTurn(env, {
    userMessage: 'tôi là ai',
    me: userEmployee,
    conversationId: 'test_self'
  });
  assert.ok(!selfTurn.content.includes('từ chối'), 'Self inquiry must not be rejected');
  assert.ok(selfTurn.content.includes('Nguyễn Văn Nhân'), 'Self inquiry must identify current user');

  console.log('  ok  5. End-to-End Chat Turns: Privacy guardrail strictly enforced for employees, single & multi profiles for Admin/HCNS');
}

console.log('\nAll 5 tests PASSED successfully!');
