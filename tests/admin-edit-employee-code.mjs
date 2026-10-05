import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  UsersService,
  employeeProfilePermissions,
  normalizeEmployeeProfileValue,
  validateEmployeeProfile,
} from '../server/services/users.service.js';

console.log('🧪 Running Test Suite: Admin Edit Employee Code & RBAC Protection...');

function makeD1(db) {
  return {
    async exec(sql) { db.exec(sql); },
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const s = {
        bind(...a) { args = a; return s; },
        async all() { const results = stmt.all(...args); return { results }; },
        async first() { const row = stmt.get(...args); return row ?? null; },
        async run() {
          const info = stmt.run(...args);
          return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
        },
      };
      return s;
    },
    async batch(items) { for (const it of items) await it.run(); },
  };
}

const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT UNIQUE,
    full_name TEXT,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'employee',
    is_admin INTEGER DEFAULT 0,
    is_hcns INTEGER DEFAULT 0,
    department TEXT DEFAULT 'Phòng Kỹ thuật',
    position TEXT DEFAULT 'Kỹ sư',
    direct_manager_id INTEGER,
    work_location TEXT DEFAULT 'Văn phòng chính',
    contract_type TEXT DEFAULT 'HĐCT',
    employee_type TEXT DEFAULT 'NV',
    phone TEXT DEFAULT '0901234567',
    birth_date TEXT DEFAULT '1995-01-01',
    gender TEXT DEFAULT 'Nam',
    national_id TEXT DEFAULT '012345678901',
    national_id_issue_date TEXT DEFAULT '2020-01-01',
    national_id_expiry_date TEXT,
    home_address TEXT DEFAULT 'Hà Nội',
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    school_name TEXT,
    hire_date TEXT DEFAULT '2024-01-01',
    contract_start_date TEXT DEFAULT '2024-01-01',
    contract_end_date TEXT,
    contract_signed_date TEXT,
    official_date TEXT,
    termination_date TEXT,
    salary REAL DEFAULT 15000000,
    allowance REAL DEFAULT 1000000,
    insurance_salary REAL DEFAULT 5000000,
    dependent_count INTEGER DEFAULT 0,
    bank_account TEXT DEFAULT '123456789',
    bank_name TEXT DEFAULT 'Vietcombank',
    bank_account_holder TEXT DEFAULT 'NGUYEN VAN A',
    tax_code TEXT,
    social_insurance_number TEXT,
    insurance_hospital TEXT,
    avatar_color TEXT DEFAULT '#4F46E5',
    avatar_initials TEXT DEFAULT 'A',
    avatar_url TEXT,
    national_id_document_url TEXT,
    degree_document_url TEXT,
    contract_document_url TEXT,
    personnel_decision_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER
  );

  CREATE TABLE employee_profile_audit (
    id TEXT PRIMARY KEY,
    change_set_id TEXT,
    user_id INTEGER,
    action TEXT,
    field_group TEXT,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by INTEGER,
    changed_by_name TEXT,
    changed_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    employee_id INTEGER,
    employee_code TEXT,
    month TEXT,
    base_salary REAL DEFAULT 0
  );
`);

const env = { DB: makeD1(db) };

// Seed Users
db.exec(`
  INSERT INTO users (id, employee_code, full_name, email, role, is_admin)
  VALUES (1, 'ADMIN001', 'Admin Hệ Thống', 'admin@example.com', 'admin', 1);

  INSERT INTO users (id, employee_code, full_name, email, role, is_admin, department)
  VALUES (2, 'HR001', 'Nhân viên HCNS', 'hr@example.com', 'employee', 0, 'Hành chính nhân sự');

  INSERT INTO users (id, employee_code, full_name, email, role, is_admin, department)
  VALUES (3, 'EMP001', 'Nguyễn Văn A', 'nva@example.com', 'employee', 0, 'Phòng Kỹ thuật');

  INSERT INTO users (id, employee_code, full_name, email, role, is_admin, department)
  VALUES (4, 'EMP002', 'Trần Thị B', 'ttb@example.com', 'employee', 0, 'Phòng Marketing');

  INSERT INTO payroll (id, user_id, employee_id, employee_code, month, base_salary)
  VALUES (1, '3', 3, 'EMP001', '2026-09', 15000000);
`);

let passedTests = 0;
function testPassed(msg) {
  passedTests++;
  console.log(`  ✓ ${msg}`);
}

async function run() {
  const adminUser = { id: 1, role: 'admin', is_admin: 1, full_name: 'Admin Hệ Thống', department: 'Ban Giám đốc' };
  const hrUser = { id: 2, role: 'employee', is_admin: 0, is_hcns: 1, full_name: 'Nhân viên HCNS', department: 'Hành chính nhân sự' };
  const empUser = { id: 3, role: 'employee', is_admin: 0, full_name: 'Nguyễn Văn A', department: 'Phòng Kỹ thuật' };

  // 1. RBAC Permissions Check
  const adminPerms = employeeProfilePermissions({ id: 3, department: 'Phòng Kỹ thuật' }, adminUser, true, false);
  assert.equal(adminPerms.can_edit_employee_code, true, 'Admin must have can_edit_employee_code = true');
  assert.equal(adminPerms.is_admin, true);

  const hrPerms = employeeProfilePermissions({ id: 3, department: 'Phòng Kỹ thuật' }, hrUser, true, false);
  assert.equal(hrPerms.can_edit_employee_code, false, 'HCNS (non-admin) must have can_edit_employee_code = false');

  const empPerms = employeeProfilePermissions({ id: 3, department: 'Phòng Kỹ thuật' }, empUser, false, false);
  assert.equal(empPerms.can_edit_employee_code, false, 'Regular Employee must have can_edit_employee_code = false');
  testPassed('employeeProfilePermissions correctly grants can_edit_employee_code only to Admin');

  // 2. Normalization & Validation Helper Checks
  const normalized = normalizeEmployeeProfileValue('employee_code', '  nv_999  ');
  assert.equal(normalized, 'NV_999', 'Employee code must be trimmed and uppercased');

  const baseProfile = { full_name: 'Nguyễn Văn A', email: 'nva@example.com', department: 'Phòng Kỹ thuật' };
  const emptyErr = validateEmployeeProfile({ ...baseProfile, employee_code: '' }, ['employee_code']);
  assert.match(emptyErr, /không được để trống/i);

  const invalidCharErr = validateEmployeeProfile({ ...baseProfile, employee_code: 'NV@123!' }, ['employee_code']);
  assert.match(invalidCharErr, /không hợp lệ/i);

  const validErr = validateEmployeeProfile({ full_name: 'A', email: 'a@b.com', department: 'Tech', employee_code: 'NV-123_A.B' }, ['employee_code']);
  assert.equal(validErr, null);
  testPassed('Normalization & validation functions enforce uppercase and format rules');

  // 3. Security: Non-admin calling UsersService.updateProfile() with employee_code
  const empAttempt = await UsersService.updateProfile(env, 3, { employee_code: 'HACKED01' }, empUser, false, false, null, { isAdmin: false });
  assert.equal(empAttempt.status, 403);
  assert.match(empAttempt.error, /Chỉ Admin mới có quyền sửa Mã nhân viên/i);

  const hrAttempt = await UsersService.updateProfile(env, 3, { employee_code: 'HR_EDIT_01' }, hrUser, true, false, null, { isAdmin: false });
  assert.equal(hrAttempt.status, 403);
  assert.match(hrAttempt.error, /Chỉ Admin mới có quyền sửa Mã nhân viên/i);
  testPassed('UsersService.updateProfile() strictly blocks non-admin updates (403)');

  // 4. Duplicate Check: Admin attempts to set employee_code that already belongs to user 4 (EMP002)
  const dupAttempt = await UsersService.updateProfile(env, 3, { employee_code: 'EMP002' }, adminUser, true, false, null, { isAdmin: true });
  assert.equal(dupAttempt.status, 409);
  assert.match(dupAttempt.error, /đã tồn tại trong hệ thống/i);
  testPassed('UsersService.updateProfile() detects and blocks duplicate employee_code (409)');

  // 5. Successful Admin Update via updateProfile()
  let broadcastEvent = null;
  const mockBroadcast = async (env, scope, event, payload) => {
    broadcastEvent = { scope, event, payload };
  };

  const updateRes = await UsersService.updateProfile(
    env,
    3,
    { employee_code: 'emp_001_new' },
    adminUser,
    true,
    false,
    mockBroadcast,
    { isAdmin: true }
  );

  assert.equal(updateRes.ok, true);
  assert.ok(updateRes.changed_fields.includes('employee_code'));

  // Verify DB user record
  const updatedUser = db.prepare('SELECT employee_code FROM users WHERE id=3').get();
  assert.equal(updatedUser.employee_code, 'EMP_001_NEW');

  // Verify Audit log in employee_profile_audit
  const auditRow = db.prepare("SELECT * FROM employee_profile_audit WHERE user_id=3 AND field_name='employee_code' ORDER BY changed_at DESC LIMIT 1").get();
  assert.ok(auditRow, 'Audit log row must exist');
  assert.equal(auditRow.old_value, 'EMP001');
  assert.equal(auditRow.new_value, 'EMP_001_NEW');
  assert.equal(auditRow.changed_by, 1);

  // Verify payroll synchronization
  const payrollRow = db.prepare('SELECT employee_code FROM payroll WHERE employee_id=3').get();
  assert.equal(payrollRow.employee_code, 'EMP_001_NEW', 'Payroll record must be synchronized with new employee_code');

  // Verify broadcast event
  assert.ok(broadcastEvent);
  assert.equal(broadcastEvent.event, 'user:profile_updated');
  assert.equal(broadcastEvent.payload.employee_code, 'EMP_001_NEW');
  testPassed('UsersService.updateProfile() successfully updates employee_code, creates audit trail, syncs payroll, and broadcasts event');

  // 6. Security: Non-admin calling UsersService.updateUser()
  const updateUserEmpAttempt = await UsersService.updateUser(
    env,
    3,
    { employee_code: 'FAIL01' },
    empUser,
    false,
    false,
    () => false,
    {}
  );
  assert.equal(updateUserEmpAttempt.status, 403);
  testPassed('UsersService.updateUser() strictly blocks non-admin updates (403)');

  // 7. Successful Admin update via updateUser()
  const updateUserAdminRes = await UsersService.updateUser(
    env,
    3,
    {
      full_name: 'Nguyễn Văn A',
      email: 'nva@example.com',
      employee_code: 'DEV_SENIOR_01',
      department: 'Phòng Kỹ thuật',
      position: 'Kỹ sư',
      role: 'employee',
      phone: '0901234567',
    },
    adminUser,
    false,
    true,
    () => false,
    { broadcastAppEventFn: mockBroadcast }
  );

  assert.equal(updateUserAdminRes.ok, true);
  const recheckedUser = db.prepare('SELECT employee_code FROM users WHERE id=3').get();
  assert.equal(recheckedUser.employee_code, 'DEV_SENIOR_01');
  const recheckedPayroll = db.prepare('SELECT employee_code FROM payroll WHERE employee_id=3').get();
  assert.equal(recheckedPayroll.employee_code, 'DEV_SENIOR_01');
  testPassed('UsersService.updateUser() allows admin to update employee_code and syncs to payroll');

  console.log(`\n🎉 All ${passedTests} tests passed successfully!`);
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
