// tests/ai-deep-employee-lookup.mjs
// Comprehensive test suite for Deep Multi-dimensional Employee Directory Lookup Engine
import assert from 'node:assert/strict';
import {
  extractEmployeeLookupIntent,
  findEmployeesByNameGroup,
  executeDeepEmployeeLookup
} from '../server/services/agent.service.js';

console.log('--- Test Suite: Deep Multi-dimensional Employee Lookup Engine ---');

// Mock User Directory matching actual NetViet environment
const mockUsers = [
  {
    id: 101,
    employee_code: 'VY-CTH',
    full_name: 'Chu Thị Hà Vy',
    department: 'Phòng Marketing',
    position: 'Content Specialist',
    email: 'vy.chuthiha@netviet.live',
    phone: '0901234567',
    office_location: 'HN',
    is_active: 1,
    lifecycle_status: 'Thử việc',
    role: 'employee',
    contract_type: 'Thử việc',
    contract_end_date: '2026-11-01'
  },
  {
    id: 102,
    employee_code: 'VY-LLK',
    full_name: 'Lê Lâm Khánh Vy',
    department: 'Phòng Marketing',
    position: 'Account Executive',
    email: 'vy.lelamkhanh@netviet.live',
    phone: '0907654321',
    office_location: 'HCM',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'employee',
    contract_type: 'Chính thức',
    contract_end_date: '2027-05-15'
  },
  {
    id: 103,
    employee_code: 'VY-NNT',
    full_name: 'Nguyễn Ngọc Thủy Vy',
    department: 'Phòng HCNS',
    position: 'Thực tập sinh HCNS',
    email: 'vy.nguyenngocthuy@netviet.live',
    phone: '0912111222',
    office_location: 'HN',
    is_active: 1,
    lifecycle_status: 'Thử việc',
    role: 'employee',
    contract_type: 'Thực tập',
    contract_end_date: '2026-10-25' // Expiring soon (<30 days)
  },
  {
    id: 104,
    employee_code: 'THUYDT',
    full_name: 'Doãn Thị Thủy',
    department: 'Phòng HCNS',
    position: 'Chuyên viên HCNS',
    email: 'thuy.doan@netviet.live',
    phone: '0912345678',
    office_location: 'HN',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'employee',
    contract_type: 'Chính thức',
    contract_end_date: '2028-01-01'
  },
  {
    id: 105,
    employee_code: 'DUCNT',
    full_name: 'Nguyễn Trung Đức',
    department: 'Phòng IT',
    position: 'Trưởng phòng IT',
    email: 'duc.nguyen@netviet.live',
    phone: '0987654321',
    office_location: 'HN',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'manager',
    contract_type: 'Chính thức',
    contract_end_date: '2028-01-01'
  },
  {
    id: 106,
    employee_code: 'DEV01',
    full_name: 'Trần Văn Lập Trình',
    department: 'Phòng IT',
    position: 'Frontend Developer',
    email: 'laptrinh.tran@netviet.live',
    phone: '0933112233',
    office_location: 'HN',
    is_active: 1,
    lifecycle_status: 'Chính thức',
    role: 'employee',
    contract_type: 'Chính thức',
    contract_end_date: '2027-12-31'
  }
];

// Mock Session Personas
const sessionAdmin = {
  id: 1,
  employee_code: 'BGD-01',
  full_name: 'Giám Đốc Điều Hành',
  role: 'admin',
  department: 'Ban Giám Đốc'
};

const sessionManagerIT = {
  id: 105,
  employee_code: 'DUCNT',
  full_name: 'Nguyễn Trung Đức',
  role: 'manager',
  department: 'Phòng IT'
};

const sessionEmployee = {
  id: 101,
  employee_code: 'VY-CTH',
  full_name: 'Chu Thị Hà Vy',
  role: 'employee',
  department: 'Phòng Marketing'
};

// Mock D1 Database
function createMockDb() {
  return {
    prepare(sql) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      let boundArgs = [];
      const execObj = {
        bind(...args) {
          boundArgs = args;
          return execObj;
        },
        async all() {
          const targetUid = boundArgs.length > 0 ? boundArgs[0] : null;
          // 1. Users query
          if (cleanSql.includes('FROM users')) {
            return { results: [...mockUsers] };
          }
          // 2. Attendance today
          if (cleanSql.includes('FROM attendance') && cleanSql.includes('date = ?')) {
            const list = [
              { user_id: 101, checkin_time: '08:45', checkout_time: null, work_type: 'office', late_minutes: 15 },
              { user_id: 102, checkin_time: null, checkout_time: null, work_type: 'wfh', late_minutes: 0 },
              { user_id: 104, checkin_time: '08:15', checkout_time: null, work_type: 'office', late_minutes: 0 },
              { user_id: 105, checkin_time: '08:28', checkout_time: null, work_type: 'office', late_minutes: 0 }
            ];
            if (cleanSql.includes('user_id = ?')) {
              const targetUid = boundArgs[0];
              return { results: list.filter(r => r.user_id === Number(targetUid)) };
            }
            return { results: list };
          }
          // 3. Attendance monthly summary
          if (cleanSql.includes('FROM attendance') && cleanSql.includes('date LIKE ?')) {
            const list = [
              { user_id: 101, days_worked: 18, late_count: 2, total_late_minutes: 30 },
              { user_id: 102, days_worked: 20, late_count: 0, total_late_minutes: 0 },
              { user_id: 103, days_worked: 15, late_count: 1, total_late_minutes: 10 },
              { user_id: 104, days_worked: 21, late_count: 0, total_late_minutes: 0 },
              { user_id: 105, days_worked: 22, late_count: 0, total_late_minutes: 0 },
              { user_id: 106, days_worked: 19, late_count: 1, total_late_minutes: 5 }
            ];
            if (cleanSql.includes('user_id = ?')) {
              const targetUid = boundArgs[0];
              return { results: list.filter(r => r.user_id === Number(targetUid)) };
            }
            return { results: list };
          }
          // 4. Leave requests today
          if (cleanSql.includes('FROM leave_requests')) {
            const list = [
              { user_id: 103, leave_type: 'Nghỉ phép năm', status: 'approved' }
            ];
            if (cleanSql.includes('user_id = ?')) {
              const targetUid = boundArgs[0];
              return { results: list.filter(r => r.user_id === Number(targetUid)) };
            }
            return { results: list };
          }
          // 5. Leave balances
          if (cleanSql.includes('FROM leave_balances')) {
            const list = [
              { user_id: 101, available_days: 3.5 },
              { user_id: 102, available_days: 12.0 },
              { user_id: 103, available_days: 1.0 },
              { user_id: 104, available_days: 8.5 }
            ];
            const filtered = targetUid ? list.filter(r => r.user_id === Number(targetUid)) : list;
            return { results: filtered };
          }
          return { results: [] };
        },
        async first() {
          const res = await this.all();
          return res.results?.[0] || null;
        },
        async run() {
          return { success: true };
        }
      };
      return execObj;
    }
  };
}

async function runTests() {
  console.log('\n--- 1. Test Natural Language Intent Extraction ---');
  
  // 1a. Group Name Queries
  const i1 = extractEmployeeLookupIntent('những ai tên vy', sessionAdmin);
  assert.equal(i1?.type, 'name');
  assert.equal(i1?.nameTarget, 'vy');
  assert.equal(i1?.isGroup, true);
  console.log('✔ Intent: "những ai tên vy" -> group name "vy"');

  const i2 = extractEmployeeLookupIntent('ai tên Thủy', sessionAdmin);
  assert.equal(i2?.type, 'name');
  assert.equal(i2?.nameTarget, 'Thủy');
  assert.equal(i2?.isGroup, true);
  console.log('✔ Intent: "ai tên Thủy" -> group name "Thủy"');

  // 1b. Department Queries
  const i3 = extractEmployeeLookupIntent('phòng Marketing có những ai', sessionAdmin);
  assert.equal(i3?.type, 'department');
  assert.equal(i3?.departmentTarget, 'Marketing');
  console.log('✔ Intent: "phòng Marketing có những ai" -> department "Marketing"');

  // 1c. Attendance Today Queries
  const i4 = extractEmployeeLookupIntent('hôm nay những ai đi muộn?', sessionAdmin);
  assert.equal(i4?.type, 'attendance_today');
  assert.equal(i4?.subType, 'late');
  console.log('✔ Intent: "hôm nay những ai đi muộn?" -> attendance_today: late');

  const i5 = extractEmployeeLookupIntent('ai làm WFH hôm nay', sessionAdmin);
  assert.equal(i5?.type, 'attendance_today');
  assert.equal(i5?.subType, 'wfh');
  console.log('✔ Intent: "ai làm WFH hôm nay" -> attendance_today: wfh');

  const i6 = extractEmployeeLookupIntent('ai đang nghỉ phép hôm nay', sessionAdmin);
  assert.equal(i6?.type, 'attendance_today');
  assert.equal(i6?.subType, 'on_leave');
  console.log('✔ Intent: "ai đang nghỉ phép hôm nay" -> attendance_today: on_leave');

  // 1d. Lifecycle Queries
  const i7 = extractEmployeeLookupIntent('những ai đang thử việc', sessionAdmin);
  assert.equal(i7?.type, 'lifecycle');
  assert.equal(i7?.subType, 'probation');
  console.log('✔ Intent: "những ai đang thử việc" -> lifecycle: probation');

  const i8 = extractEmployeeLookupIntent('hợp đồng sắp hết hạn', sessionAdmin);
  assert.equal(i8?.type, 'lifecycle');
  assert.equal(i8?.subType, 'expiring');
  console.log('✔ Intent: "hợp đồng sắp hết hạn" -> lifecycle: expiring');

  // 1e. Single Dossier & Self
  const i9 = extractEmployeeLookupIntent('Chu Thị Hà Vy là ai', sessionAdmin);
  assert.equal(i9?.type, 'name');
  assert.equal(i9?.nameTarget, 'Chu Thị Hà Vy');
  assert.equal(i9?.isGroup, false);
  console.log('✔ Intent: "Chu Thị Hà Vy là ai" -> single dossier "Chu Thị Hà Vy"');

  const i10 = extractEmployeeLookupIntent('tôi là ai', sessionEmployee);
  assert.equal(i10?.type, 'self');
  console.log('✔ Intent: "tôi là ai" -> self lookup');

  console.log('\n--- 2. Test Smart Group Name Matching ---');
  // Target "vy" should match Chu Thị Hà Vy, Lê Lâm Khánh Vy, and Nguyễn Ngọc Thủy Vy
  const vys = findEmployeesByNameGroup(mockUsers, 'vy');
  assert.equal(vys.length, 3, `Expected 3 Vys, got ${vys.length}`);
  const vyNames = vys.map(u => u.full_name);
  assert.ok(vyNames.includes('Chu Thị Hà Vy'));
  assert.ok(vyNames.includes('Lê Lâm Khánh Vy'));
  assert.ok(vyNames.includes('Nguyễn Ngọc Thủy Vy'));
  console.log(`✔ findEmployeesByNameGroup("vy") matches all 3 Vys: ${vyNames.join(', ')}`);

  // Target "thủy" should match Doãn Thị Thủy, but NOT Nguyễn Ngọc Thủy Vy (whose first name is Vy)
  const thuys = findEmployeesByNameGroup(mockUsers, 'thủy');
  assert.equal(thuys.length, 1);
  assert.equal(thuys[0].full_name, 'Doãn Thị Thủy');
  console.log(`✔ findEmployeesByNameGroup("thủy") matches exactly Doãn Thị Thủy (not Nguyễn Ngọc Thủy Vy)`);

  console.log('\n--- 3. Test Deep Directory Engine Execution & Presentation ---');
  const env = { DB: createMockDb() };
  const getContent = res => res?.result?.content || res?.reply || '';
  const getCount = res => res?.count ?? res?.result?.count ?? res?.data?.count;
  const getActionCard = res => res?.result?.actionCard || res?.actionCard;

  // 3a. Admin queries "những ai tên vy" -> Expects 3 Vys in Markdown Comparison Table
  const resVy = await executeDeepEmployeeLookup(env, {
    query: 'những ai tên vy',
    me: sessionAdmin,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });

  assert.ok(resVy, 'Expected result for "những ai tên vy"');
  assert.equal(getCount(resVy), 3);
  const textVy = getContent(resVy);
  assert.ok(textVy.includes('Chu Thị Hà Vy'));
  assert.ok(textVy.includes('Lê Lâm Khánh Vy'));
  assert.ok(textVy.includes('Nguyễn Ngọc Thủy Vy'));
  // Check Markdown Table columns
  assert.ok(textVy.includes('| STT | Họ và tên | Mã NV | Phòng ban | Chức danh | Nơi LV | Chấm công hôm nay | Ngày công | Đi muộn |'));
  assert.ok(textVy.includes('Trễ 15p')); // Chu Thị Hà Vy
  assert.ok(textVy.includes('WFH')); // Lê Lâm Khánh Vy
  assert.ok(textVy.includes('Nghỉ phép')); // Nguyễn Ngọc Thủy Vy
  assert.equal(getActionCard(resVy)?.link, '#/users');
  console.log('✔ "những ai tên vy" successfully generated rich Markdown comparison table with attendance metrics');

  // 3b. Admin queries single person "Chu Thị Hà Vy là ai" -> Expects Full Dossier 360°
  const resSingle = await executeDeepEmployeeLookup(env, {
    query: 'Chu Thị Hà Vy là ai',
    me: sessionAdmin,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });

  assert.ok(resSingle);
  assert.equal(getCount(resSingle), 1);
  const textSingle = getContent(resSingle);
  assert.ok(textSingle.includes('Hồ sơ Nhân sự 360°: Chu Thị Hà Vy'));
  assert.ok(textSingle.includes('Thông tin công tác'));
  assert.ok(textSingle.includes('Hợp đồng & Vòng đời'));
  assert.ok(textSingle.includes('Chấm công hôm nay'));
  assert.ok(textSingle.includes('Chuyên cần tháng'));
  assert.ok(textSingle.includes('Quỹ phép năm'));
  console.log('✔ "Chu Thị Hà Vy là ai" successfully generated Full Dossier 360°');

  console.log('\n--- 4. Test Enterprise RBAC & Privacy Guardrails ---');
  
  // 4a. Regular Employee queries colleagues -> BLOCKED by Enterprise Privacy Guardrail
  const resBlocked = await executeDeepEmployeeLookup(env, {
    query: 'những ai tên vy',
    me: sessionEmployee,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });

  assert.ok(resBlocked);
  assert.equal(resBlocked.blocked, true);
  const textBlocked = getContent(resBlocked);
  assert.ok(textBlocked.includes('Chính sách Bảo mật Dữ liệu Doanh nghiệp'));
  assert.ok(textBlocked.includes('Bạn chỉ có quyền tra cứu thông tin và hồ sơ cá nhân của chính mình'));
  console.log('✔ Regular employee query blocked by Enterprise Privacy Guardrail');

  // 4b. Regular Employee queries self -> ALLOWED
  const resSelf = await executeDeepEmployeeLookup(env, {
    query: 'tôi là ai',
    me: sessionEmployee,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });

  assert.ok(resSelf);
  assert.equal(resSelf.blocked, false);
  const textSelf = getContent(resSelf);
  assert.ok(textSelf.includes('Chu Thị Hà Vy'));
  assert.ok(textSelf.includes('Hồ sơ Nhân sự 360°'));
  console.log('✔ Regular employee self lookup allowed');

  // 4c. Manager queries within department (Phòng IT) -> ALLOWED
  const resDeptAllowed = await executeDeepEmployeeLookup(env, {
    query: 'phòng IT có những ai',
    me: sessionManagerIT,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });

  assert.ok(resDeptAllowed);
  assert.equal(resDeptAllowed.blocked, false);
  assert.equal(getCount(resDeptAllowed), 2);
  const textDeptAllowed = getContent(resDeptAllowed);
  assert.ok(textDeptAllowed.includes('Nguyễn Trung Đức'));
  assert.ok(textDeptAllowed.includes('Trần Văn Lập Trình'));
  console.log('✔ Manager querying their own department (Phòng IT) allowed');

  // 4d. Manager queries outside department (Phòng Marketing) -> SCOPED RESTRICTION
  const resDeptRestricted = await executeDeepEmployeeLookup(env, {
    query: 'phòng Marketing có những ai',
    me: sessionManagerIT,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });

  assert.ok(resDeptRestricted);
  assert.equal(resDeptRestricted.blocked, true);
  const textDeptRestricted = getContent(resDeptRestricted);
  assert.ok(textDeptRestricted.includes('Giới hạn Phạm vi Quản lý'));
  assert.ok(textDeptRestricted.includes('Phòng IT'));
  console.log('✔ Manager querying outside department correctly limited with scope notice');

  console.log('\n--- 5. Test Attendance & Lifecycle Direct Filters ---');
  
  // 5a. Late Today
  const resLate = await executeDeepEmployeeLookup(env, {
    query: 'hôm nay những ai đi muộn?',
    me: sessionAdmin,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });
  assert.ok(resLate);
  assert.equal(getCount(resLate), 1);
  assert.ok(getContent(resLate).includes('Chu Thị Hà Vy'));
  console.log('✔ "hôm nay những ai đi muộn" correctly lists late employees');

  // 5b. WFH Today
  const resWfh = await executeDeepEmployeeLookup(env, {
    query: 'ai làm WFH hôm nay',
    me: sessionAdmin,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });
  assert.ok(resWfh);
  assert.equal(getCount(resWfh), 1);
  assert.ok(getContent(resWfh).includes('Lê Lâm Khánh Vy'));
  console.log('✔ "ai làm WFH hôm nay" correctly lists WFH employees');

  // 5c. Probation Lifecycle
  const resProbation = await executeDeepEmployeeLookup(env, {
    query: 'những ai đang thử việc',
    me: sessionAdmin,
    todayYMD: '2026-10-10',
    todayFormatted: '10/10/2026',
    currentYear: 2026,
    currentMonthNum: 10
  });
  assert.ok(resProbation);
  assert.equal(getCount(resProbation), 2);
  const textProbation = getContent(resProbation);
  assert.ok(textProbation.includes('Chu Thị Hà Vy'));
  assert.ok(textProbation.includes('Nguyễn Ngọc Thủy Vy'));
  console.log('✔ "những ai đang thử việc" correctly lists probation employees');

  console.log('\n======================================================');
  console.log('🎉 ALL DEEP EMPLOYEE LOOKUP TESTS PASSED WITH 100% SUCCESS!');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
