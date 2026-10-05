/**
 * Users & Employee Profiles Service
 * Quản lý danh bạ, xuất excel, hồ sơ nhân sự, tài liệu CCCD/hợp đồng, nhật ký thay đổi và vòng đời nhân sự
 */

export const LIFECYCLE_STATUSES = ['Chờ tiếp nhận', 'Thực tập', 'Thử việc', 'Cộng tác viên', 'Chính thức', 'Đã nghỉ'];

export const USER_DOCUMENTS = {
  avatar: { column: 'avatar_url', label: 'Ảnh chân dung', maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  national_id: { column: 'national_id_document_url', label: 'CCCD', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  degree: { column: 'degree_document_url', label: 'Bằng cấp', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  contract: { column: 'contract_document_url', label: 'Hợp đồng', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  decision: { column: 'personnel_decision_url', label: 'Quyết định nhân sự', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
};

export const LEGACY_DOCUMENT_CATEGORIES = {
  national_id: 'national_id',
  degree: 'degree',
  contract: 'labor_contract',
  decision: 'other',
};

export const EMPLOYEE_DOCUMENT_CATEGORIES = {
  cv: 'CV ứng viên',
  national_id: 'CCCD',
  social_insurance: 'Sổ BHXH/VSSID',
  labor_contract: 'Hợp đồng lao động',
  contract_appendix: 'Phụ lục hợp đồng',
  degree: 'Bằng cấp, chứng chỉ',
  onboarding_decision: 'Quyết định tiếp nhận',
  transfer_decision: 'Quyết định điều chuyển',
  salary_decision: 'Quyết định tăng lương',
  termination_decision: 'Quyết định thôi việc',
  internship_agreement: 'Thỏa thuận TTS',
  other: 'Hồ sơ khác',
};

export const EMPLOYEE_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const EMPLOYEE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const EMPLOYEE_CONTRACT_TYPES = ['Thử việc', 'HĐCT', 'CTV', 'Thỏa thuận TTS', 'Chính thức', 'Cộng tác viên', 'Thực tập sinh', 'Khác'];

export const EMPLOYEE_PROFILE_FIELDS = {
  personal: ['employee_code','full_name','email','phone','birth_date','gender','national_id','national_id_issue_date','national_id_expiry_date','home_address','school_name','emergency_contact_name','emergency_contact_phone'],
  employment: ['employee_type','position','department','direct_manager_id','work_location'],
  contract: ['contract_type','hire_date','contract_start_date','contract_end_date','contract_signed_date','probation_end_date','official_date','termination_date'],
  compensation: ['salary','allowance','insurance_salary','dependent_count','bank_account','bank_name','bank_account_holder','tax_code','social_insurance_number','insurance_hospital'],
};

export const EMPLOYEE_PROFILE_FIELD_GROUP = Object.fromEntries(
  Object.entries(EMPLOYEE_PROFILE_FIELDS).flatMap(([group, fields]) => fields.map(field => [field, group]))
);
export const EMPLOYEE_PROFILE_ALLOWED_FIELDS = new Set(Object.keys(EMPLOYEE_PROFILE_FIELD_GROUP));
export const EMPLOYEE_PROFILE_PROTECTED_FIELDS = new Set([
  'employee_code',
  ...EMPLOYEE_PROFILE_FIELDS.contract,
  ...EMPLOYEE_PROFILE_FIELDS.compensation,
]);
export const EMPLOYEE_TIMELINE_FIELDS = new Set([
  'department','position','salary','allowance','contract_type','contract_start_date','contract_end_date',
  'probation_end_date','official_date','termination_date',
]);

export const VALID_WORK_LOCATIONS = ['HCM', 'HN', 'Phim trường Netviet'];

export function userDocumentKey(userId, kind) { return `employees/${userId}/${kind}`; }
export function userDocumentRoute(userId, kind) { return `/api/users/${userId}/documents/${kind}`; }
export function isManagedUserDocumentUrl(value, userId, kind) { return value === userDocumentRoute(userId, kind); }

export function employeeDocumentKey(userId, documentId) {
  return `employees/${userId}/documents/${documentId}`;
}

export function safeDownloadName(value, fallback = 'document') {
  const cleaned = String(value || fallback).replace(/[\r\n"\\]/g, '_').slice(0, 180);
  return cleaned || fallback;
}

export function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;',
  })[character]);
}

const VIETNAMESE_SEARCH_REPLACEMENTS = [
  ['a', 'àáạảãâầấậẩẫăằắặẳẵ'], ['e', 'èéẹẻẽêềếệểễ'],
  ['i', 'ìíịỉĩ'], ['o', 'òóọỏõôồốộổỗơờớợởỡ'],
  ['u', 'ùúụủũưừứựửữ'], ['y', 'ỳýỵỷỹ'], ['d', 'đĐ'],
];

export function normalizeVietnameseSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').trim();
}

export function vietnameseSearchSql(column) {
  let expression = `COALESCE(${column},'')`;
  for (const [replacement, chars] of VIETNAMESE_SEARCH_REPLACEMENTS) {
    for (const char of chars) expression = `REPLACE(${expression},'${char}','${replacement}')`;
  }
  return `LOWER(${expression})`;
}

export function employeeDocumentContentMatches(contentType, buffer) {
  const bytes = new Uint8Array(buffer);
  if (contentType === 'application/pdf') return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  if (contentType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

export function employeeCanAccess(target, me, hasHrScope, isManager) {
  if (hasHrScope || Number(target.id) === Number(me.id)) return true;
  return !!isManager && target.department === me.department;
}

export function employeeProfilePermissions(target, me, hasHrScope, isManager) {
  const self = Number(target.id) === Number(me.id);
  const sameDepartmentManager = !!isManager && !hasHrScope && target.department === me.department;
  const isAdmin = !!me && (me.role === 'admin' || me.is_admin === true);
  return {
    is_admin: isAdmin,
    can_edit_employee_code: isAdmin,
    can_view: hasHrScope || self || sameDepartmentManager,
    can_edit_basic: hasHrScope || self || sameDepartmentManager,
    can_edit_personal: hasHrScope || self,
    can_edit_employment: hasHrScope || self || sameDepartmentManager,
    can_edit_contract: hasHrScope,
    can_edit_compensation: hasHrScope,
    can_manage_documents: hasHrScope,
    can_manage_avatar: hasHrScope || self,
    can_view_documents: hasHrScope || self,
    can_view_audit: hasHrScope,
    can_export: hasHrScope,
  };
}

export function normalizeEmployeeProfileValue(field, value, normalizeDeptNameFn, employeeTypeCodeFn, normalizeWorkLocationFn) {
  if (field === 'employee_code') return String(value || '').trim().toUpperCase();
  if (['salary','allowance','insurance_salary'].includes(field)) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number >= 0 ? number : NaN;
  }
  if (field === 'dependent_count') {
    const number = Number(value || 0);
    return Number.isInteger(number) && number >= 0 ? number : NaN;
  }
  if (field === 'direct_manager_id') return value ? Number(value) : null;
  if (field === 'department') return normalizeDeptNameFn ? normalizeDeptNameFn(String(value || '')) : String(value || '').trim();
  if (field === 'employee_type') return employeeTypeCodeFn ? employeeTypeCodeFn(value) : String(value || '').trim();
  if (field === 'work_location') return normalizeWorkLocationFn ? normalizeWorkLocationFn(value) : String(value || '').trim();
  if (field.endsWith('_date') || field === 'hire_date' || field === 'national_id_expiry_date') {
    if (!value || value === '—' || value === '-' || value === 'null' || value === 'undefined' || value === '') return null;
    const str = String(value).trim();
    const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const dmyDash = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyDash) return `${dmyDash[3]}-${dmyDash[2].padStart(2, '0')}-${dmyDash[1].padStart(2, '0')}`;
    return str;
  }
  return typeof value === 'string' ? value.trim() : value;
}

export function validateEmployeeProfile(profile, changedFields = []) {
  const changed = new Set(changedFields);
  if (!String(profile.full_name || '').trim() || !String(profile.email || '').trim() || !String(profile.department || '').trim()) {
    return 'Họ tên, email và phòng ban là bắt buộc';
  }
  if (changed.has('employee_code')) {
    const code = String(profile.employee_code || '').trim().toUpperCase();
    if (!code) return 'Mã nhân viên không được để trống';
    if (!/^[A-Z0-9_\-\.]{2,50}$/.test(code)) {
      return 'Mã nhân viên không hợp lệ (tối thiểu 2 ký tự, chỉ gồm chữ cái, số, dấu gạch nối hoặc gạch dưới)';
    }
  }
  const requiredFields = ['full_name','email','phone','birth_date','national_id','national_id_issue_date','home_address','position','department','direct_manager_id','work_location','contract_type'];
  if (requiredFields.some(field => changed.has(field) && !String(profile[field] ?? '').trim())) return 'Không được để trống trường bắt buộc';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email || ''))) return 'Email không hợp lệ';
  if (changed.has('phone') && !/^\+?\d{8,15}$/.test(String(profile.phone || ''))) return 'Số điện thoại phải gồm 8 đến 15 chữ số';
  if (changed.has('national_id') && !/^\d{9}(\d{3})?$/.test(String(profile.national_id || ''))) return 'Số CCCD/CMND phải gồm 9 hoặc 12 chữ số';
  if (!Number.isInteger(Number(profile.dependent_count || 0)) || Number(profile.dependent_count || 0) < 0) return 'Số người phụ thuộc không hợp lệ';
  if (profile.direct_manager_id && Number(profile.direct_manager_id) === Number(profile.id)) return 'Quản lý trực tiếp không thể là chính nhân viên';
  if (changed.has('contract_type') && profile.contract_type && !EMPLOYEE_CONTRACT_TYPES.includes(profile.contract_type)) return 'Loại hợp đồng không hợp lệ';
  for (const field of changed) {
    if (field.endsWith('_date') || field === 'hire_date') {
      const raw = profile[field];
      if (raw === '—' || raw === '-' || raw === 'null' || raw === 'undefined' || raw === '' || raw === null || raw === undefined) {
        profile[field] = null;
        continue;
      }
      const str = String(raw).trim();
      const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        profile[field] = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      } else if (/^(\d{1,2})-(\d{1,2})-(\d{4})$/.test(str)) {
        const dmyDash = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        profile[field] = `${dmyDash[3]}-${dmyDash[2].padStart(2, '0')}-${dmyDash[1].padStart(2, '0')}`;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return 'Ngày tháng không đúng định dạng (dd/mm/yyyy)';
      }
    }
  }
  const orderedPairs = [
    ['national_id_issue_date','national_id_expiry_date','Hạn CCCD phải sau ngày cấp CCCD'],
    ['probation_end_date','contract_signed_date','Ngày kết thúc thử việc phải trước hoặc bằng ngày ký hợp đồng'],
    ['probation_end_date','official_date','Ngày chính thức phải sau ngày kết thúc thử việc'],
    ['contract_start_date','contract_end_date','Ngày hết hạn hợp đồng phải sau ngày bắt đầu'],
    ['contract_signed_date','contract_end_date','Ngày hết hạn hợp đồng phải sau ngày ký hợp đồng'],
    ['contract_signed_date','termination_date','Ngày nghỉ việc phải sau ngày ký hợp đồng'],
  ];
  for (const [start, end, message] of orderedPairs) {
    if ((changed.has(start) || changed.has(end)) && profile[start] && profile[end] && String(profile[end]) < String(profile[start])) return message;
  }
  if (changed.has('termination_date') && profile.termination_date && profile.lifecycle_status !== 'Đã nghỉ') return 'Chỉ nhập ngày nghỉ việc khi trạng thái là Đã nghỉ';
  return null;
}

export function employeeAuditStatement(env, { userId, changeSetId, action, group, field, oldValue, newValue, actor }) {
  return env.DB.prepare(
    `INSERT INTO employee_profile_audit
       (id,change_set_id,user_id,action,field_group,field_name,old_value,new_value,changed_by,changed_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(), changeSetId, userId, action, group, field,
    oldValue === undefined || oldValue === null ? null : String(oldValue),
    newValue === undefined || newValue === null ? null : String(newValue),
    actor?.id || null, actor?.full_name || ''
  );
}

export function buildEmployeeDirectoryFilter(url, me, hasHrScope) {
  const conditions = [];
  const binds = [];
  if (!hasHrScope) {
    conditions.push('u.department=?');
    binds.push(me.department || '');
  }
  const search = normalizeVietnameseSearch(url.searchParams.get('search'));
  if (search) {
    const value = `%${search}%`;
    conditions.push(`(${['u.full_name','u.employee_code','u.email','u.department','u.position'].map(vietnameseSearchSql).map(column => `${column} LIKE ?`).join(' OR ')})`);
    binds.push(value, value, value, value, value);
  }
  const filters = [
    ['department','u.department'],
    ['status','u.lifecycle_status'],
    ['work_location','u.work_location'],
    ['location','u.work_location'],
    ['contract_type','u.contract_type'],
    ['position','u.position'],
  ];
  for (const [param, column] of filters) {
    const value = String(url.searchParams.get(param) || '').trim();
    if (!value) continue;
    conditions.push(`${column}=?`);
    binds.push(value);
  }
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', binds };
}

export async function checkUserDeletionEligibility(env, userId) {
  const user = await env.DB.prepare(
    'SELECT id, full_name, employee_code, termination_date, hire_date, created_at FROM users WHERE id=?'
  ).bind(userId).first();
  if (!user) return { eligible: false, error: 'Không tìm thấy tài khoản nhân viên' };

  // Check if account has any attendance, payroll or invoice records at all
  const attCountRow = await env.DB.prepare('SELECT COUNT(*) as c FROM attendance WHERE user_id=?').bind(userId).first();
  const payrollCountRow = await env.DB.prepare('SELECT COUNT(*) as c FROM payroll WHERE employee_id=? OR user_id=?').bind(userId, String(userId)).first();
  const invoiceCountRow = await env.DB.prepare('SELECT COUNT(*) as c FROM invoices WHERE user_id=?').bind(userId).first();

  const totalAtt = Number(attCountRow?.c || 0);
  const totalPayroll = Number(payrollCountRow?.c || 0);
  const totalInvoices = Number(invoiceCountRow?.c || 0);

  // Accidental / test account with 0 work/salary activity
  if (totalAtt === 0 && totalPayroll === 0 && totalInvoices === 0) {
    return { eligible: true, is_test_account: true };
  }

  // Determine target final working month & year
  let targetMonth = null;
  let targetYear = null;

  // 1. Check termination_date first
  if (user.termination_date) {
    const raw = String(user.termination_date).trim();
    if (/^\d{4}-\d{2}/.test(raw)) {
      const parts = raw.split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
      const parts = raw.split('/');
      targetMonth = parseInt(parts[1], 10);
      targetYear = parseInt(parts[2], 10);
    }
  }

  // 2. If no valid termination_date, check latest attendance date
  if (!targetMonth || !targetYear) {
    const latestAtt = await env.DB.prepare(
      'SELECT MAX(date) as max_date FROM attendance WHERE user_id=?'
    ).bind(userId).first();
    if (latestAtt?.max_date) {
      const raw = String(latestAtt.max_date).trim();
      if (/^\d{4}-\d{2}/.test(raw)) {
        const parts = raw.split('-');
        targetYear = parseInt(parts[0], 10);
        targetMonth = parseInt(parts[1], 10);
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
        const parts = raw.split('/');
        targetMonth = parseInt(parts[1], 10);
        targetYear = parseInt(parts[2], 10);
      }
    }
  }

  // 3. If still no date, check latest payroll or invoice month
  if (!targetMonth || !targetYear) {
    const latestInv = await env.DB.prepare(
      'SELECT year, month FROM invoices WHERE user_id=? ORDER BY year DESC, month DESC LIMIT 1'
    ).bind(userId).first();
    if (latestInv) {
      targetYear = Number(latestInv.year);
      targetMonth = Number(latestInv.month);
    }
  }

  // 4. Fallback: if user is active up to now, previous month relative to now (Vietnam time UTC+7)
  const now = new Date(Date.now() + 7 * 3600000);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-12

  if (!targetMonth || !targetYear) {
    if (currentMonth === 1) {
      targetMonth = 12;
      targetYear = currentYear - 1;
    } else {
      targetMonth = currentMonth - 1;
      targetYear = currentYear;
    }
  }

  // Format month string for display: e.g. "09/2026"
  const monthStr = `${String(targetMonth).padStart(2, '0')}/${targetYear}`;

  // Check the invoice for targetMonth/targetYear
  const invoice = await env.DB.prepare(
    'SELECT id, invoice_number, status, employee_confirmed_at FROM invoices WHERE user_id=? AND month=? AND year=? LIMIT 1'
  ).bind(userId, targetMonth, targetYear).first();

  if (!invoice) {
    return {
      eligible: false,
      target_month: targetMonth,
      target_year: targetYear,
      month_str: monthStr,
      has_invoice: false,
      is_confirmed: false,
      reason: `Chưa có phiếu lương tháng ${monthStr} trên hệ thống.`
    };
  }

  const isConfirmed = !!(invoice.employee_confirmed_at || invoice.status === 'employee_confirmed' || invoice.status === 'paid');

  if (!isConfirmed) {
    return {
      eligible: false,
      target_month: targetMonth,
      target_year: targetYear,
      month_str: monthStr,
      has_invoice: true,
      invoice_number: invoice.invoice_number,
      is_confirmed: false,
      reason: `Nhân viên chưa bấm xác nhận phiếu lương tháng ${monthStr} (${invoice.invoice_number}) trên ứng dụng.`
    };
  }

  return {
    eligible: true,
    target_month: targetMonth,
    target_year: targetYear,
    month_str: monthStr,
    has_invoice: true,
    invoice_number: invoice.invoice_number,
    is_confirmed: true
  };
}

export const UsersService = {
  async getDirectory(env, url, me, hasHrScope, isManager, sortVietnameseNamesFn, ensureWorkLocationStandardizationFn) {
    if (typeof ensureWorkLocationStandardizationFn === 'function') {
      await ensureWorkLocationStandardizationFn(env).catch(() => {});
    }
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') || '20', 10)));
    const { where, binds } = buildEmployeeDirectoryFilter(url, me, hasHrScope);
    const { results: allUsers = [] } = await env.DB.prepare(
      `SELECT u.id,u.employee_code,u.employee_type,u.full_name,u.email,u.department,u.position,
              u.avatar_color,u.avatar_initials,u.avatar_url,u.is_active,u.lifecycle_status,
              u.work_location,u.contract_type,u.contract_end_date,u.probation_end_date,u.national_id_issue_date,u.national_id_expiry_date
       FROM users u${where}`
    ).bind(...binds).all();

    const sortedUsers = typeof sortVietnameseNamesFn === 'function' ? sortVietnameseNamesFn(allUsers, 'full_name') : allUsers;
    const total = sortedUsers.length;
    const users = sortedUsers.slice((page - 1) * pageSize, page * pageSize);
    const scopeWhere = hasHrScope ? '' : ' WHERE department=?';
    const scopeBinds = hasHrScope ? [] : [me.department || ''];
    const [departments, positions, workLocations, statuses] = await Promise.all([
      env.DB.prepare(`SELECT DISTINCT department AS value FROM users${scopeWhere} ORDER BY department`).bind(...scopeBinds).all(),
      env.DB.prepare(`SELECT DISTINCT position AS value FROM users${scopeWhere} ORDER BY position`).bind(...scopeBinds).all(),
      env.DB.prepare(`SELECT DISTINCT work_location AS value FROM users${scopeWhere} ORDER BY work_location`).bind(...scopeBinds).all(),
      env.DB.prepare(`SELECT DISTINCT lifecycle_status AS value FROM users${scopeWhere} ORDER BY lifecycle_status`).bind(...scopeBinds).all(),
    ]);
    const values = result => (result.results || []).map(row => row.value).filter(Boolean);
    return {
      users,
      pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      filter_options: {
        departments: values(departments),
        positions: values(positions),
        work_locations: Array.from(new Set([...VALID_WORK_LOCATIONS, ...values(workLocations)])).filter(Boolean),
        statuses: values(statuses),
      },
    };
  },

  async exportXls(env, url, me, sortVietnameseNamesFn) {
    const { where, binds } = buildEmployeeDirectoryFilter(url, me, true);
    const { results: rows = [] } = await env.DB.prepare(
      `SELECT u.employee_code,u.full_name,u.employee_type,u.email,u.phone,u.department,u.position,
              u.lifecycle_status,u.contract_type,u.hire_date,u.contract_end_date,u.salary,u.allowance,
              u.insurance_salary,u.dependent_count,u.bank_account,u.bank_name,u.social_insurance_number
       FROM users u${where}`
    ).bind(...binds).all();
    const sortedRows = typeof sortVietnameseNamesFn === 'function' ? sortVietnameseNamesFn(rows, 'full_name') : rows;
    const columns = [
      ['Mã nhân viên','employee_code'],['Họ và tên','full_name'],['Loại nhân sự','employee_type'],
      ['Email','email'],['Số điện thoại','phone'],['Phòng ban','department'],['Vị trí','position'],
      ['Trạng thái','lifecycle_status'],['Loại hợp đồng','contract_type'],['Ngày vào làm','hire_date'],
      ['Hết hạn hợp đồng','contract_end_date'],['Lương cơ bản','salary'],['Phụ cấp','allowance'],
      ['Lương đóng BHXH','insurance_salary'],['Người phụ thuộc','dependent_count'],
      ['Số tài khoản','bank_account'],['Ngân hàng','bank_name'],['Số BHXH','social_insurance_number'],
    ];
    const cell = value => `<Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xmlEscape(value ?? '')}</Data></Cell>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#FDE9E4" ss:Pattern="Solid"/></Style></Styles>
 <Worksheet ss:Name="Nhân viên"><Table>
  <Row>${columns.map(([label]) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(label)}</Data></Cell>`).join('')}</Row>
  ${sortedRows.map(row => `<Row>${columns.map(([, key]) => cell(row[key])).join('')}</Row>`).join('')}
 </Table></Worksheet>
</Workbook>`;
    return workbook;
  },

  async getProfile(env, userId, me, hasHrScope, isManager) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    const permissions = employeeProfilePermissions(target, me, hasHrScope, isManager);
    if (!permissions.can_view) return { error: 'Không có quyền xem hồ sơ', status: 403 };

    const profile = { ...target };
    delete profile.password_hash;
    const isSelf = Number(me.id) === userId;
    if (!hasHrScope && !isSelf) {
      for (const field of [...EMPLOYEE_PROFILE_FIELDS.contract, ...EMPLOYEE_PROFILE_FIELDS.compensation]) delete profile[field];
      for (const field of ['birth_date','gender','national_id','national_id_issue_date','national_id_expiry_date','home_address','school_name','emergency_contact_name','emergency_contact_phone']) {
        delete profile[field];
      }
      delete profile.tax_code;
      delete profile.social_insurance_number;
      delete profile.national_id_document_url;
      delete profile.degree_document_url;
      delete profile.contract_document_url;
      delete profile.personnel_decision_url;
    }
    let completion = null;
    if (permissions.can_view_documents) {
      const requiredFields = [
        'full_name','email','phone','birth_date','national_id','national_id_issue_date','home_address','position','department',
        'direct_manager_id','work_location','contract_type',
      ];
      const requiredDocuments = target.employee_type === 'TTS'
        ? ['cv','national_id','internship_agreement']
        : ['cv','national_id','labor_contract'];
      const { results: documentRows = [] } = await env.DB.prepare(
        'SELECT DISTINCT category FROM employee_documents WHERE user_id=? AND deleted_at IS NULL'
      ).bind(userId).all();
      const categories = new Set(documentRows.map(row => row.category));
      const completedFields = requiredFields.filter(field => String(target[field] ?? '').trim()).length;
      const completedDocuments = requiredDocuments.filter(category => {
        if (target.employee_type === 'TTS' && category === 'internship_agreement' && categories.has('labor_contract')) return true;
        return categories.has(category);
      }).length;
      completion = {
        percent: Math.round(((completedFields + completedDocuments) / (requiredFields.length + requiredDocuments.length)) * 100),
        completed_fields: completedFields,
        required_fields: requiredFields.length,
        completed_documents: completedDocuments,
        required_documents: requiredDocuments.length,
      };
    }
    return {
      user: profile,
      permissions,
      completion,
      metadata: {
        document_categories: EMPLOYEE_DOCUMENT_CATEGORIES,
        contract_types: target.contract_type && !EMPLOYEE_CONTRACT_TYPES.includes(target.contract_type)
          ? [...EMPLOYEE_CONTRACT_TYPES, target.contract_type]
          : EMPLOYEE_CONTRACT_TYPES,
        lifecycle_statuses: LIFECYCLE_STATUSES,
      },
    };
  },

  async updateProfile(env, userId, input, me, hasHrScope, isManager, broadcastAppEventFn, helpers = {}) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    const permissions = employeeProfilePermissions(target, me, hasHrScope, isManager);
    if (!permissions.can_edit_basic) return { error: 'Không có quyền sửa hồ sơ', status: 403 };

    const { normalizeDeptNameFn, employeeTypeCodeFn, normalizeWorkLocationFn } = helpers;
    const isAdmin = helpers.isAdmin ?? (!!me && (me.role === 'admin' || me.is_admin === true));
    const changes = {};
    for (const [field, rawValue] of Object.entries(input || {})) {
      if (!EMPLOYEE_PROFILE_ALLOWED_FIELDS.has(field)) continue;
      const group = EMPLOYEE_PROFILE_FIELD_GROUP[field];
      if (group === 'personal' && !permissions.can_edit_personal) return { error: 'Không có quyền sửa thông tin cá nhân', status: 403 };
      if (group === 'employment' && !permissions.can_edit_employment) return { error: 'Không có quyền sửa thông tin công việc', status: 403 };
      if (field === 'employee_code' && !isAdmin) {
        return { error: 'Chỉ Admin mới có quyền sửa Mã nhân viên', status: 403 };
      }
      if ((EMPLOYEE_PROFILE_PROTECTED_FIELDS.has(field) || field === 'employee_type') && !hasHrScope) {
        return { error: 'Chỉ HCNS hoặc Admin được sửa hợp đồng, lương, ngân hàng và BHXH', status: 403 };
      }
      changes[field] = normalizeEmployeeProfileValue(field, rawValue, normalizeDeptNameFn, employeeTypeCodeFn, normalizeWorkLocationFn);
      if (typeof changes[field] === 'number' && !Number.isFinite(changes[field])) return { error: `Giá trị ${field} không hợp lệ`, status: 400 };
    }
    if (!Object.keys(changes).length) return { ok: true, unchanged: true };
    if (changes.contract_type !== undefined) {
      const ctLower = String(changes.contract_type || '').toLowerCase();
      changes.employee_type = (ctLower.includes('thực tập') || ctLower.includes('tts')) ? 'TTS' : 'NV';
    }
    if (changes.contract_signed_date !== undefined) {
      changes.hire_date = changes.contract_signed_date || changes.contract_start_date || null;
    } else if (changes.contract_start_date !== undefined && !target.hire_date) {
      changes.hire_date = changes.contract_start_date;
    }
    const merged = { ...target, ...changes };
    if (merged.employee_type !== 'TTS' && merged.school_name) {
      changes.school_name = '';
      merged.school_name = '';
    }
    const actualChanges = Object.entries(changes).filter(([field, value]) => String(target[field] ?? '') !== String(value ?? ''));
    if (!actualChanges.length) return { ok: true, unchanged: true };
    const validationError = validateEmployeeProfile(merged, actualChanges.map(([field]) => field));
    if (validationError) return { error: validationError, status: 400 };
    if (changes.employee_code && changes.employee_code !== target.employee_code) {
      const duplicate = await env.DB.prepare('SELECT id FROM users WHERE UPPER(employee_code)=UPPER(?) AND id<>? LIMIT 1').bind(changes.employee_code, userId).first();
      if (duplicate) return { error: `Mã nhân viên "${changes.employee_code}" đã tồn tại trong hệ thống`, status: 409 };
    }
    if (changes.email && changes.email !== target.email) {
      const duplicate = await env.DB.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>? LIMIT 1').bind(changes.email, userId).first();
      if (duplicate) return { error: 'Email đã tồn tại', status: 409 };
    }
    if (merged.direct_manager_id) {
      const manager = await env.DB.prepare('SELECT id FROM users WHERE id=? AND is_active=1').bind(merged.direct_manager_id).first();
      if (!manager) return { error: 'Quản lý trực tiếp không tồn tại hoặc đã khóa', status: 400 };
    }
    const changeSetId = crypto.randomUUID();
    const assignments = actualChanges.map(([field]) => `${field}=?`).join(',');
    const statements = [
      env.DB.prepare(`UPDATE users SET ${assignments},updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`)
        .bind(...actualChanges.map(([, value]) => value), me.id, userId),
      ...actualChanges.map(([field, value]) => employeeAuditStatement(env, {
        userId,
        changeSetId,
        action: 'update',
        group: EMPLOYEE_PROFILE_FIELD_GROUP[field] || 'profile',
        field,
        oldValue: target[field],
        newValue: value,
        actor: me,
      })),
    ];
    if (actualChanges.some(([field]) => field === 'employee_code')) {
      statements.push(
        env.DB.prepare('UPDATE payroll SET employee_code=? WHERE employee_id=? OR user_id=?').bind(changes.employee_code, userId, String(userId))
      );
    }
    await env.DB.batch(statements);
    if (typeof broadcastAppEventFn === 'function') {
      await broadcastAppEventFn(env, 'users', 'user:profile_updated', {
        id: userId,
        employee_code: changes.employee_code || target.employee_code,
        changed_fields: actualChanges.map(([field]) => field),
      }, { actorId: me.id });
    }
    return { ok: true, change_set_id: changeSetId, changed_fields: actualChanges.map(([field]) => field) };
  },

  async checkDeleteEligibility(env, userId) {
    return checkUserDeletionEligibility(env, userId);
  },

  async deleteUser(env, userId, me, broadcastAppEventFn) {
    const target = await env.DB.prepare('SELECT id, full_name, employee_code FROM users WHERE id=?').bind(userId).first();
    if (!target) return { error: 'Không tìm thấy tài khoản nhân viên', status: 404 };

    const eligibility = await checkUserDeletionEligibility(env, userId);
    if (!eligibility.eligible) {
      return {
        error: `Không thể xóa tài khoản của ${target.full_name}: ${eligibility.reason || 'Nhân viên chưa xác nhận phiếu lương tháng làm việc cuối cùng trên ứng dụng.'}`,
        eligibility,
        status: 400
      };
    }

    try {
      const cleanupQueries = [
        env.DB.prepare('DELETE FROM employee_profile_audit WHERE user_id=? OR changed_by=?').bind(userId, userId),
        env.DB.prepare('DELETE FROM employee_documents WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM attendance WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM task_mention_notifications WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM task_followers WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM tasks WHERE assignee_id=?').bind(userId),
        env.DB.prepare('DELETE FROM leave_balance_ledger WHERE employee_id=?').bind(userId),
        env.DB.prepare('DELETE FROM leave_requests WHERE user_id=? OR employee_id=?').bind(userId, userId),
        env.DB.prepare('DELETE FROM leave_balances WHERE user_id=? OR employee_id=?').bind(userId, userId),
        env.DB.prepare('DELETE FROM conversation_members WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM overtime_forms WHERE user_id=?').bind(userId),
        env.DB.prepare('DELETE FROM overtime_requests WHERE user_id=?').bind(userId),
      ];

      for (const q of cleanupQueries) {
        try { await q.run(); } catch (_) {}
      }

      await env.DB.prepare('DELETE FROM users WHERE id=?').bind(userId).run();

      if (typeof broadcastAppEventFn === 'function') {
        await broadcastAppEventFn(env, 'users', 'user:deleted', {
          id: userId,
          employee_code: target.employee_code,
          full_name: target.full_name,
        }, { actorId: me.id });
      }

      return { ok: true, message: `Đã xóa tài khoản nhân viên ${target.full_name}` };
    } catch (err) {
      return { error: err?.message || 'Không thể xóa tài khoản nhân viên', status: 500 };
    }
  },

  async getAudit(env, userId, page = 1, pageSize = 30) {
    const total = await env.DB.prepare('SELECT COUNT(*) AS total FROM employee_profile_audit WHERE user_id=?').bind(userId).first();
    const { results: audit = [] } = await env.DB.prepare(
      `SELECT * FROM employee_profile_audit WHERE user_id=? ORDER BY changed_at DESC,id DESC LIMIT ? OFFSET ?`
    ).bind(userId, pageSize, (page - 1) * pageSize).all();
    return { audit, pagination: { page, page_size: pageSize, total: Number(total?.total || 0) } };
  },

  async getTimeline(env, userId, me, hasHrScope, isManager) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (!employeeCanAccess(target, me, hasHrScope, isManager)) return { error: 'Không có quyền xem hồ sơ', status: 403 };

    const events = [];
    const datedFields = [
      ['hire_date','onboarding','Ngày vào làm'],
      ['probation_end_date','probation','Kết thúc thử việc'],
      ['official_date','official','Chuyển chính thức'],
      ['termination_date','termination','Nghỉ việc'],
    ];
    for (const [field, type, title] of datedFields) {
      if (target[field]) events.push({ id: `${field}-${userId}`, type, title, event_date: target[field], source: 'profile' });
    }
    let lifecycle = [];
    try {
      const r = await env.DB.prepare(
        `SELECT id,from_status,to_status,changed_by_name,reason,
                created_at AS event_date
         FROM lifecycle_history WHERE user_id=? ORDER BY id`
      ).bind(userId).all();
      lifecycle = r.results || [];
    } catch (_) {}

    for (const row of lifecycle) events.push({
      id: `lifecycle-${row.id}`,
      type: 'lifecycle',
      title: `Chuyển trạng thái sang ${row.to_status}`,
      description: row.reason || '',
      actor_name: row.changed_by_name || '',
      event_date: row.event_date,
      source: 'lifecycle',
    });

    const auditFields = [...EMPLOYEE_TIMELINE_FIELDS].filter(field => hasHrScope || !['salary','allowance'].includes(field));
    if (auditFields.length) {
      let auditEvents = [];
      try {
        const placeholders = auditFields.map(() => '?').join(',');
        const r = await env.DB.prepare(
          `SELECT id,field_name,old_value,new_value,changed_by_name,changed_at
           FROM employee_profile_audit WHERE user_id=? AND field_name IN (${placeholders}) ORDER BY changed_at`
        ).bind(userId, ...auditFields).all();
        auditEvents = r.results || [];
      } catch (_) {}

      for (const row of auditEvents) events.push({
        id: `audit-${row.id}`,
        type: row.field_name === 'department' ? 'transfer' : row.field_name === 'salary' ? 'salary' : 'profile_change',
        title: row.field_name === 'department' ? 'Điều chuyển phòng ban'
          : row.field_name === 'salary' ? 'Điều chỉnh lương'
          : `Cập nhật ${row.field_name}`,
        description: `${row.old_value || 'Chưa có'} → ${row.new_value || 'Chưa có'}`,
        actor_name: row.changed_by_name || '',
        event_date: row.changed_at,
        source: 'audit',
      });
    }

    let documentEvents = [];
    try {
      const r = await env.DB.prepare(
        `SELECT id,category,title,uploaded_by_name,uploaded_at,deleted_at,deleted_by_name
         FROM employee_documents WHERE user_id=? ORDER BY uploaded_at`
      ).bind(userId).all();
      documentEvents = r.results || [];
    } catch (_) {}

    for (const document of documentEvents) {
      events.push({
        id: `document-upload-${document.id}`,
        type: 'document',
        title: `Thêm ${EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || document.title || 'tài liệu'}`,
        actor_name: document.uploaded_by_name || '',
        event_date: document.uploaded_at,
        source: 'document',
      });
      if (document.deleted_at) events.push({
        id: `document-delete-${document.id}`,
        type: 'document_deleted',
        title: `Xóa ${EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || document.title || 'tài liệu'}`,
        actor_name: document.deleted_by_name || '',
        event_date: document.deleted_at,
        source: 'document',
      });
    }
    events.sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
    return { timeline: events };
  },

  async getDocuments(env, userId, me, hasHrScope) {
    const target = await env.DB.prepare('SELECT id,department FROM users WHERE id=?').bind(userId).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    const canView = hasHrScope || Number(me.id) === userId;
    if (!canView) return { error: 'Không có quyền xem tài liệu', status: 403 };

    const { results: documents = [] } = await env.DB.prepare(
      `SELECT id,user_id,category,title,original_filename,content_type,byte_size,expires_on,
              uploaded_by,uploaded_by_name,uploaded_at
       FROM employee_documents WHERE user_id=? AND deleted_at IS NULL ORDER BY uploaded_at DESC`
    ).bind(userId).all();

    return {
      documents: documents.map(document => ({
        ...document,
        category_label: EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || document.category,
        preview_url: `/api/users/${userId}/documents/${document.id}?disposition=inline`,
        download_url: `/api/users/${userId}/documents/${document.id}?disposition=attachment`,
      })),
      categories: EMPLOYEE_DOCUMENT_CATEGORIES,
      can_manage: hasHrScope,
    };
  },

  async uploadDocument(env, userId, form, me, hasHrScope) {
    const target = await env.DB.prepare('SELECT id,department FROM users WHERE id=?').bind(userId).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (!hasHrScope) return { error: 'Chỉ HCNS hoặc Admin được thêm tài liệu', status: 403 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ hồ sơ chưa được cấu hình', status: 503 };

    const file = form?.get('file');
    const category = String(form?.get('category') || '');
    const title = String(form?.get('title') || '').trim().slice(0, 160);
    const expiresOn = String(form?.get('expires_on') || '').trim() || null;
    if (!Object.prototype.hasOwnProperty.call(EMPLOYEE_DOCUMENT_CATEGORIES, category)) return { error: 'Danh mục tài liệu không hợp lệ', status: 400 };
    if (!file || typeof file.stream !== 'function') return { error: 'Vui lòng chọn tệp để tải lên', status: 400 };
    const contentType = String(file.type || '').toLowerCase();
    if (!EMPLOYEE_DOCUMENT_TYPES.includes(contentType)) return { error: 'Chỉ nhận PDF, JPG, PNG hoặc WebP', status: 400 };
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > EMPLOYEE_DOCUMENT_MAX_BYTES) return { error: 'Tệp vượt giới hạn 10 MB', status: 400 };
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return { error: 'Ngày hết hạn không hợp lệ', status: 400 };
    const fileBuffer = await file.arrayBuffer();
    if (!employeeDocumentContentMatches(contentType, fileBuffer)) return { error: 'Nội dung tệp không khớp với định dạng đã khai báo', status: 400 };
    const documentId = crypto.randomUUID();
    const storageKey = employeeDocumentKey(userId, documentId);
    await env.HR_DOCUMENTS.put(storageKey, fileBuffer, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
      customMetadata: { uploaded_by: String(me.id), uploaded_at: new Date().toISOString(), category },
    });
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO employee_documents
             (id,user_id,category,title,original_filename,content_type,byte_size,storage_key,expires_on,uploaded_by,uploaded_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(documentId, userId, category, title, safeDownloadName(file.name), contentType, file.size, storageKey, expiresOn, me.id, me.full_name || ''),
        employeeAuditStatement(env, {
          userId,
          changeSetId: crypto.randomUUID(),
          action: 'document_upload',
          group: 'documents',
          field: category,
          oldValue: null,
          newValue: file.name,
          actor: me,
        }),
      ]);
    } catch (error) {
      await env.HR_DOCUMENTS.delete(storageKey).catch(() => {});
      throw error;
    }
    return { ok: true, id: documentId };
  },

  async getDocumentFile(env, userId, documentId, me, hasHrScope, dispositionParam = 'inline') {
    const document = await env.DB.prepare(
      `SELECT d.*,u.department FROM employee_documents d JOIN users u ON u.id=d.user_id
       WHERE d.id=? AND d.user_id=?`
    ).bind(documentId, userId).first();
    if (!document || document.deleted_at) return { error: 'Tài liệu không tồn tại', status: 404 };
    const canView = hasHrScope || Number(me.id) === userId;
    if (!canView) return { error: 'Không có quyền xem tài liệu', status: 403 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ hồ sơ chưa được cấu hình', status: 503 };

    const object = await env.HR_DOCUMENTS.get(document.storage_key);
    if (!object) return { error: 'Tệp không tồn tại trên kho lưu trữ', status: 404 };
    const disposition = dispositionParam === 'attachment' ? 'attachment' : 'inline';
    const filename = safeDownloadName(document.original_filename);

    return new Response(object.body, {
      headers: {
        'Content-Type': (
          document.content_type && document.content_type !== 'application/octet-stream'
            ? document.content_type
            : object.httpMetadata?.contentType
        ) || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  },

  async deleteDocument(env, userId, documentId, me, hasHrScope) {
    const document = await env.DB.prepare(
      `SELECT d.*,u.department FROM employee_documents d JOIN users u ON u.id=d.user_id
       WHERE d.id=? AND d.user_id=?`
    ).bind(documentId, userId).first();
    if (!document || document.deleted_at) return { error: 'Tài liệu không tồn tại', status: 404 };
    if (!hasHrScope) return { error: 'Chỉ HCNS hoặc Admin được xóa tài liệu', status: 403 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ hồ sơ chưa được cấu hình', status: 503 };

    await env.HR_DOCUMENTS.delete(document.storage_key);
    const changeSetId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE employee_documents
         SET deleted_at=datetime('now','localtime'),deleted_by=?,deleted_by_name=?
         WHERE id=? AND deleted_at IS NULL`
      ).bind(me.id, me.full_name || '', documentId),
      employeeAuditStatement(env, {
        userId,
        changeSetId,
        action: 'document_delete',
        group: 'documents',
        field: document.category,
        oldValue: document.original_filename,
        newValue: null,
        actor: me,
      }),
    ]);
    return { ok: true };
  },

  async getLegacyDocument(env, uid, kind, me, hasHrScope) {
    const config = USER_DOCUMENTS[kind];
    if (!config) return { error: 'Loại tài liệu không hợp lệ', status: 400 };
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ hồ sơ chưa được cấu hình', status: 503 };

    const canReadAvatar = kind === 'avatar';
    const canReadSensitive = hasHrScope || me.id === uid;
    if (kind === 'avatar' ? !canReadAvatar : !canReadSensitive && me.id !== uid) {
      return { error: 'Không có quyền xem hồ sơ này', status: 403 };
    }
    const object = await env.HR_DOCUMENTS.get(userDocumentKey(uid, kind));
    if (!object) return { error: 'Tệp không tồn tại', status: 404 };
    const disposition = kind === 'avatar' ? 'inline' : 'attachment';
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${kind}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  },

  async uploadLegacyDocument(env, uid, kind, form, me, hasHrScope) {
    const config = USER_DOCUMENTS[kind];
    if (!config) return { error: 'Loại tài liệu không hợp lệ', status: 400 };
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ hồ sơ chưa được cấu hình', status: 503 };

    const canUpload = hasHrScope || (kind === 'avatar' && me.id === uid);
    if (!canUpload) return { error: 'Chỉ HCNS hoặc quản trị viên được tải hồ sơ lên', status: 403 };

    const file = form?.get('file');
    if (!file || typeof file.stream !== 'function') return { error: 'Vui lòng chọn tệp để tải lên', status: 400 };
    const contentType = String(file.type || '').toLowerCase();
    if (!config.types.includes(contentType)) return { error: `${config.label} chỉ nhận PDF, JPG, PNG hoặc WebP`, status: 400 };
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > config.maxBytes) {
      return { error: `${config.label} vượt giới hạn ${config.maxBytes / 1024 / 1024} MB`, status: 400 };
    }
    const fileBuffer = await file.arrayBuffer();
    if (!employeeDocumentContentMatches(contentType, fileBuffer)) return { error: 'Nội dung tệp không khớp với định dạng đã khai báo', status: 400 };
    await env.HR_DOCUMENTS.put(userDocumentKey(uid, kind), fileBuffer, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
      customMetadata: { uploaded_by: String(me.id), uploaded_at: new Date().toISOString() },
    });
    const url = userDocumentRoute(uid, kind);
    const changeSetId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(`UPDATE users SET ${config.column}=?,updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`).bind(url, me.id, uid),
      employeeAuditStatement(env, {
        userId: uid,
        changeSetId,
        action: 'legacy_document_upload',
        group: 'documents',
        field: kind,
        oldValue: target[config.column] || null,
        newValue: String(file.name || config.label),
        actor: me,
      }),
    ];
    if (kind !== 'avatar') {
      statements.push(
        env.DB.prepare(
          `INSERT INTO employee_documents
             (id,user_id,category,title,original_filename,content_type,byte_size,storage_key,uploaded_by,uploaded_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(storage_key) DO UPDATE SET
             category=excluded.category,title=excluded.title,original_filename=excluded.original_filename,
             content_type=excluded.content_type,byte_size=excluded.byte_size,uploaded_by=excluded.uploaded_by,
             uploaded_by_name=excluded.uploaded_by_name,uploaded_at=datetime('now','localtime'),
             deleted_at=NULL,deleted_by=NULL,deleted_by_name=NULL`
        ).bind(
          crypto.randomUUID(), uid, LEGACY_DOCUMENT_CATEGORIES[kind], config.label,
          String(file.name || kind), contentType, file.size, userDocumentKey(uid, kind), me.id, me.full_name || ''
        )
      );
    }
    await env.DB.batch(statements);
    return { ok: true, url, label: config.label };
  },

  async deleteLegacyDocument(env, uid, kind, me, hasHrScope) {
    const config = USER_DOCUMENTS[kind];
    if (!config) return { error: 'Loại tài liệu không hợp lệ', status: 400 };
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    if (!env.HR_DOCUMENTS) return { error: 'Lưu trữ hồ sơ chưa được cấu hình', status: 503 };

    if (!hasHrScope) return { error: 'Chỉ HCNS hoặc quản trị viên được xóa avatar', status: 403 };
    await env.HR_DOCUMENTS.delete(userDocumentKey(uid, kind));
    const changeSetId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(`UPDATE users SET ${config.column}='',updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`).bind(me.id, uid),
      employeeAuditStatement(env, {
        userId: uid,
        changeSetId,
        action: 'legacy_document_delete',
        group: 'documents',
        field: kind,
        oldValue: config.label,
        newValue: null,
        actor: me,
      }),
    ];
    if (kind !== 'avatar') {
      statements.push(
        env.DB.prepare(
          `UPDATE employee_documents
           SET deleted_at=datetime('now','localtime'),deleted_by=?,deleted_by_name=?
           WHERE storage_key=? AND deleted_at IS NULL`
        ).bind(me.id, me.full_name || '', userDocumentKey(uid, kind))
      );
    }
    await env.DB.batch(statements);
    return { ok: true };
  },

  async listUsers(env, me, hasHrScope, isManager, sortVietnameseNamesFn) {
    if (!isManager) return { error: 'Không có quyền', status: 403 };
    const baseFields = hasHrScope
      ? 'id,employee_code,employee_type,full_name,email,role,department,position,avatar_color,avatar_initials,phone,salary,bank_account,bank_name,is_active,lifecycle_status,created_at,birth_date,gender,national_id,national_id_issue_date,national_id_expiry_date,home_address,school_name,emergency_contact_name,emergency_contact_phone,direct_manager_id,work_location,contract_type,hire_date,contract_start_date,contract_end_date,contract_signed_date,probation_end_date,official_date,termination_date,allowance,insurance_salary,dependent_count,bank_account_holder,tax_code,social_insurance_number,insurance_hospital,avatar_url,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url,updated_at,updated_by'
      : 'id,employee_code,employee_type,full_name,email,role,department,position,avatar_color,avatar_initials,phone,is_active,lifecycle_status,created_at,direct_manager_id,work_location,avatar_url';
    const stmt = env.DB.prepare(`SELECT ${baseFields} FROM users${hasHrScope ? '' : ' WHERE department=?'} ORDER BY id`);
    const { results } = hasHrScope ? await stmt.all() : await stmt.bind(me.department).all();
    const sorted = typeof sortVietnameseNamesFn === 'function' ? sortVietnameseNamesFn(results || [], 'full_name') : (results || []);
    return { users: sorted };
  },

  async createUser(env, data, me, hasHrScope, helpers = {}) {
    if (!hasHrScope) return { error: 'Không có quyền', status: 403 };
    const {
      employeeTypeCodeFn, normalizeDeptNameFn, nextEmployeeCodeFn,
      hashPasswordFn, nameInitialsFn, vnTodayStrFn, avatarColorFn,
      normalizeWorkLocationFn, ensureCompanyChannelFn,
      ensureEmployeePersonalProjectFn, broadcastAppEventFn
    } = helpers;

    const b = data || {};
    const fullName = String(b.full_name || '').trim();
    if (!fullName) {
      return { error: 'Vui lòng nhập họ và tên nhân viên', status: 400 };
    }
    let code = String(b.employee_code || '').trim().toUpperCase();
    const ctLower = String(b.contract_type || '').toLowerCase();
    const isTts = code.startsWith('TTS') || b.employee_type === 'TTS' || ctLower.includes('thực tập') || ctLower.includes('tts');
    const empType = isTts ? 'TTS' : (employeeTypeCodeFn ? employeeTypeCodeFn(b.employee_type || 'NV') : 'NV');
    const dept = normalizeDeptNameFn ? normalizeDeptNameFn(b.department || (isTts ? 'Thực Tập Sinh' : 'Phòng Marketing')) : (b.department || 'Phòng Marketing');

    if (code) {
      const existing = await env.DB.prepare('SELECT id FROM users WHERE UPPER(employee_code)=?').bind(code).first();
      if (existing) return { error: `Mã nhân viên "${code}" đã tồn tại`, status: 400 };
    } else if (typeof nextEmployeeCodeFn === 'function') {
      code = await nextEmployeeCodeFn(env, empType, dept);
    }

    const email = String(b.email || '').trim() || `${code.toLowerCase().replace(/[^a-z0-9]/g, '')}@pending.local`;
    const pw = b.password || 'Pass@123';
    const hash = typeof hashPasswordFn === 'function' ? await hashPasswordFn(pw) : pw;
    const ini = b.avatar_initials || (typeof nameInitialsFn === 'function' ? nameInitialsFn(fullName) : fullName.slice(0, 2).toUpperCase());
    const today = typeof vnTodayStrFn === 'function' ? vnTodayStrFn() : new Date().toISOString().slice(0, 10);
    const position = b.position || (isTts ? 'TTS' : 'Nhân viên');
    const contractType = b.contract_type || (isTts ? 'Thỏa thuận TTS' : 'Thử việc');
    const directManagerId = b.direct_manager_id ? parseInt(b.direct_manager_id) : (me.id || null);
    const workLoc = typeof normalizeWorkLocationFn === 'function' ? normalizeWorkLocationFn(b.work_location, dept) : (b.work_location || 'HCM');
    const avColor = b.avatar_color || (typeof avatarColorFn === 'function' ? avatarColorFn(fullName) : '#4F46E5');

    try {
      const r = await env.DB.prepare(
        'INSERT INTO users (employee_code,employee_type,full_name,email,password_hash,role,department,position,avatar_color,avatar_initials,phone,salary,bank_account,bank_name,is_active,birth_date,gender,national_id,home_address,emergency_contact_name,emergency_contact_phone,direct_manager_id,work_location,contract_type,contract_start_date,contract_end_date,contract_signed_date,official_date,termination_date,allowance,insurance_salary,bank_account_holder,tax_code,social_insurance_number,insurance_hospital,avatar_url,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url,lifecycle_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(
        code, empType, fullName, email, hash, b.role || 'employee', dept, position,
        avColor, ini, b.phone || '', b.salary || 0,
        b.bank_account || '', b.bank_name || '', b.birth_date || null, b.gender || '',
        b.national_id || '', b.home_address || '', b.emergency_contact_name || '',
        b.emergency_contact_phone || '', directManagerId, workLoc,
        contractType, b.contract_start_date || null, b.contract_end_date || null,
        b.contract_signed_date || null, b.official_date || null, b.termination_date || null,
        b.allowance || 0, b.insurance_salary || 0, b.bank_account_holder || '',
        b.tax_code || '', b.social_insurance_number || '', b.insurance_hospital || '',
        b.avatar_url || '', b.national_id_document_url || '', b.degree_document_url || '',
        b.contract_document_url || '', b.personnel_decision_url || '',
        b.lifecycle_status || (isTts ? 'Thực tập' : 'Chính thức')
      ).run();
      const newUserId = r.meta.last_row_id;
      if (typeof ensureCompanyChannelFn === 'function') {
        try {
          const companyChannelId = await ensureCompanyChannelFn(env);
          if (companyChannelId) {
            await env.DB.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)')
              .bind(companyChannelId, newUserId, b.role === 'manager' ? 'admin' : (['admin', 'director'].includes(b.role) ? 'owner' : 'member')).run();
          }
        } catch (_) {}
      }
      if (typeof ensureEmployeePersonalProjectFn === 'function') {
        try {
          await ensureEmployeePersonalProjectFn(env, { id: newUserId, full_name: fullName, employee_code: code }, me.id);
        } catch (_) {}
      }
      if (typeof broadcastAppEventFn === 'function') {
        await broadcastAppEventFn(env, 'users', 'user:created', {
          id: newUserId,
          employee_code: code,
          employee_type: empType,
          full_name: fullName,
          email,
          department: dept,
          position,
          role: b.role || 'employee',
          lifecycle_status: b.lifecycle_status || (isTts ? 'Thực tập' : 'Chính thức'),
        }, { actorId: me.id });
      }
      return { ok: true, id: newUserId, employee_code: code };
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE') && e.message.includes('email')) {
        return { error: 'Email đã tồn tại', status: 400 };
      }
      if (e.message && e.message.includes('UNIQUE') && e.message.includes('employee_code')) {
        return { error: 'Mã nhân viên đã tồn tại', status: 400 };
      }
      return { error: e.message || 'Lỗi tạo nhân viên', status: 500 };
    }
  },

  async getUser(env, uid, me, isManager, isAdmin, isHcnsFn) {
    const target = await env.DB.prepare('SELECT id,department FROM users WHERE id=?').bind(uid).first();
    if (!target) return { error: 'Không tìm thấy', status: 404 };
    const hasHrScope = isAdmin || (typeof isHcnsFn === 'function' && isHcnsFn(me));
    if (!isManager && me.id !== uid) return { error: 'Không có quyền', status: 403 };
    if (isManager && !hasHrScope && me.id !== uid && target.department !== me.department) return { error: 'Không có quyền', status: 403 };
    const row = await env.DB.prepare(
      'SELECT id,employee_code,employee_type,full_name,email,role,department,position,avatar_color,avatar_initials,phone,salary,bank_account,bank_name,is_active,lifecycle_status,created_at,birth_date,gender,national_id,national_id_issue_date,national_id_expiry_date,home_address,school_name,emergency_contact_name,emergency_contact_phone,direct_manager_id,work_location,contract_type,hire_date,contract_start_date,contract_end_date,contract_signed_date,probation_end_date,official_date,termination_date,allowance,insurance_salary,dependent_count,bank_account_holder,tax_code,social_insurance_number,insurance_hospital,avatar_url,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url,updated_at,updated_by FROM users WHERE id=?'
    ).bind(uid).first();
    if (!row) return { error: 'Không tìm thấy', status: 404 };
    return { user: row };
  },

  async updateUser(env, uid, input, me, isManager, isAdmin, isHcnsFn, helpers = {}) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
    if (!target) return { error: 'Không tìm thấy', status: 404 };
    const hasHrScope = isAdmin || (typeof isHcnsFn === 'function' && isHcnsFn(me));
    const managesDepartment = isManager && !hasHrScope && target.department === me.department;
    if (!hasHrScope && me.id !== uid && !managesDepartment) return { error: 'Không có quyền', status: 403 };
    const protectedFields = ['role','employee_type','salary','bank_account','bank_name','is_active','lifecycle_status','allowance','insurance_salary','dependent_count','bank_account_holder','tax_code','social_insurance_number','insurance_hospital','contract_type','hire_date','contract_start_date','contract_end_date','contract_signed_date','probation_end_date','official_date','termination_date','reset_password','password_hash'];
    if (!hasHrScope && protectedFields.some(k => Object.prototype.hasOwnProperty.call(input, k))) return { error: 'Không được thay đổi trường bảo mật hoặc lương', status: 403 };

    const { normalizeDeptNameFn, hashPasswordFn, nameInitialsFn, broadcastAppEventFn } = helpers;
    const b = { ...target, ...input };
    const legacyTrackedFields = [
      'full_name','email','department','position','phone','birth_date','gender','national_id','national_id_issue_date','national_id_expiry_date','home_address',
      'emergency_contact_name','emergency_contact_phone','direct_manager_id','work_location','contract_type',
      'contract_start_date','contract_end_date','contract_signed_date','official_date','termination_date','salary',
      'allowance','insurance_salary','bank_account','bank_name','bank_account_holder','tax_code',
      'social_insurance_number','insurance_hospital',
    ];
    const legacyChanges = legacyTrackedFields
      .filter(field => Object.prototype.hasOwnProperty.call(input, field))
      .filter(field => String(target[field] ?? '') !== String(b[field] ?? ''))
      .map(field => [field, b[field]]);
    const validationError = validateEmployeeProfile(b, legacyChanges.map(([field]) => field));
    if (validationError) return { error: validationError, status: 400 };
    if (legacyChanges.some(([field]) => field === 'email')) {
      const duplicate = await env.DB.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>? LIMIT 1').bind(b.email, uid).first();
      if (duplicate) return { error: 'Email đã tồn tại', status: 409 };
    }
    if (legacyChanges.some(([field]) => field === 'direct_manager_id') && b.direct_manager_id) {
      const manager = await env.DB.prepare('SELECT id FROM users WHERE id=? AND is_active=1').bind(b.direct_manager_id).first();
      if (!manager) return { error: 'Quản lý trực tiếp không tồn tại hoặc đã khóa', status: 400 };
    }
    const ini = b.avatar_initials || (typeof nameInitialsFn === 'function' ? nameInitialsFn(b.full_name || '') : '');
    let extraSql = '';
    let extraBinds = [];
    const passwordWasReset = b.reset_password === true && isAdmin;
    if (passwordWasReset) {
      const newHash = typeof hashPasswordFn === 'function' ? await hashPasswordFn('Pass@123') : 'Pass@123';
      extraSql = ', password_hash=?, must_change_password=1';
      extraBinds = [newHash];
    }
    if (Object.prototype.hasOwnProperty.call(input, 'employee_code')) {
      if (!isAdmin) return { error: 'Chỉ Admin mới có quyền sửa Mã nhân viên', status: 403 };
      const newCode = String(input.employee_code || '').trim().toUpperCase();
      if (!newCode) return { error: 'Mã nhân viên không được để trống', status: 400 };
      if (!/^[A-Z0-9_\-\.]{2,50}$/.test(newCode)) {
        return { error: 'Mã nhân viên không hợp lệ (tối thiểu 2 ký tự, chỉ gồm chữ cái, số, dấu gạch nối hoặc gạch dưới)', status: 400 };
      }
      if (newCode !== String(target.employee_code || '').toUpperCase()) {
        const duplicate = await env.DB.prepare('SELECT id FROM users WHERE UPPER(employee_code)=UPPER(?) AND id<>? LIMIT 1').bind(newCode, uid).first();
        if (duplicate) return { error: `Mã nhân viên "${newCode}" đã tồn tại trong hệ thống`, status: 409 };
        extraSql += ', employee_code=?';
        extraBinds.push(newCode);
        legacyChanges.push(['employee_code', newCode]);
        b.employee_code = newCode;
      }
    }
    const dept = typeof normalizeDeptNameFn === 'function' ? normalizeDeptNameFn(b.department || '') : (b.department || '');
    const binds = [b.full_name,b.email,b.role||'employee',dept,b.position||'',b.avatar_color||'#4F46E5',ini,b.phone||'',b.salary||0,b.bank_account||'',b.bank_name||'',b.is_active??1,b.birth_date||null,b.gender||'',b.national_id||'',b.national_id_issue_date||null,b.national_id_expiry_date||null,b.home_address||'',b.emergency_contact_name||'',b.emergency_contact_phone||'',b.direct_manager_id||null,b.work_location||'',b.contract_type||'',b.contract_start_date||null,b.contract_end_date||null,b.contract_signed_date||null,b.official_date||null,b.termination_date||null,b.allowance||0,b.insurance_salary||0,b.bank_account_holder||'',b.tax_code||'',b.social_insurance_number||'',b.insurance_hospital||'',b.avatar_url||'',b.national_id_document_url||'',b.degree_document_url||'',b.contract_document_url||'',b.personnel_decision_url||'',...extraBinds,me.id,uid];
    const changeSetId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET full_name=?,email=?,role=?,department=?,position=?,avatar_color=?,avatar_initials=?,phone=?,salary=?,bank_account=?,bank_name=?,is_active=?,birth_date=?,gender=?,national_id=?,national_id_issue_date=?,national_id_expiry_date=?,home_address=?,emergency_contact_name=?,emergency_contact_phone=?,direct_manager_id=?,work_location=?,contract_type=?,contract_start_date=?,contract_end_date=?,contract_signed_date=?,official_date=?,termination_date=?,allowance=?,insurance_salary=?,bank_account_holder=?,tax_code=?,social_insurance_number=?,insurance_hospital=?,avatar_url=?,national_id_document_url=?,degree_document_url=?,contract_document_url=?,personnel_decision_url=?${extraSql},updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`
      ).bind(...binds),
      ...legacyChanges.map(([field, value]) => employeeAuditStatement(env, {
        userId: uid,
        changeSetId,
        action: 'legacy_update',
        group: EMPLOYEE_PROFILE_FIELD_GROUP[field] || 'profile',
        field,
        oldValue: target[field],
        newValue: value,
        actor: me,
      })),
      ...(passwordWasReset ? [
        env.DB.prepare('UPDATE sessions SET revoked=1 WHERE user_id=? AND revoked=0').bind(uid),
        employeeAuditStatement(env, {
          userId: uid,
          changeSetId,
          action: 'password_reset',
          group: 'security',
          field: 'password_hash',
          oldValue: null,
          newValue: 'Administrator reset password',
          actor: me,
        }),
      ] : []),
    ]);
    if (legacyChanges.some(([field]) => field === 'employee_code')) {
      try {
        await env.DB.prepare('UPDATE payroll SET employee_code=? WHERE employee_id=? OR user_id=?').bind(b.employee_code, uid, String(uid)).run();
      } catch (_) {}
    }
    if (typeof broadcastAppEventFn === 'function') {
      await broadcastAppEventFn(env, 'users', 'user:updated', {
        id: uid,
        employee_code: b.employee_code,
        full_name: b.full_name,
        department: b.department,
        position: b.position,
        role: b.role,
        is_active: b.is_active,
      }, { actorId: me.id });
    }
    return { ok: true, change_set_id: changeSetId };
  },

  async deleteUserAccount(env, uid, me, isAdmin) {
    if (!isAdmin) return { error: 'Không có quyền', status: 403 };
    if (uid === me.id) return { error: 'Không thể xóa tài khoản đang dùng', status: 400 };
    return { error: 'Không hỗ trợ xóa nhân viên. Hãy chuyển trạng thái sang Đã nghỉ hoặc khóa tài khoản.', code: 'HARD_DELETE_DISABLED', status: 409 };
  },

  async getBasic(env, sortVietnameseNamesFn) {
    const { results } = await env.DB.prepare(
      'SELECT id, full_name, department, position, lifecycle_status, is_active FROM users WHERE is_active=1 ORDER BY full_name'
    ).all();
    return typeof sortVietnameseNamesFn === 'function' ? sortVietnameseNamesFn(results || [], 'full_name') : (results || []);
  },

  async updateLifecycle(env, luid, input, me, isHrOrBodFn, broadcastAppEventFn) {
    if (typeof isHrOrBodFn === 'function' && !isHrOrBodFn(me)) return { error: 'Không có quyền', status: 403 };
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lifecycle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      changed_by_name TEXT,
      reason TEXT,
      changed_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const b = input || {};
    const newStatus = String(b.status || '');
    const reason = String(b.reason || '').trim();
    if (!LIFECYCLE_STATUSES.includes(newStatus)) return { error: 'Trạng thái không hợp lệ', status: 400 };
    if (!reason) return { error: 'Vui lòng nhập lý do', status: 400 };
    const target = await env.DB.prepare('SELECT id, lifecycle_status FROM users WHERE id=?').bind(luid).first();
    if (!target) return { error: 'Không tìm thấy nhân viên', status: 404 };
    const fromStatus = target.lifecycle_status || 'Chính thức';
    const changeSetId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET lifecycle_status=? WHERE id=?').bind(newStatus, luid),
      env.DB.prepare('INSERT INTO lifecycle_history (user_id,from_status,to_status,changed_by,changed_by_name,reason) VALUES (?,?,?,?,?,?)')
        .bind(luid, fromStatus, newStatus, me.id, me.full_name, reason),
      employeeAuditStatement(env, {
        userId: luid,
        changeSetId,
        action: 'lifecycle',
        group: 'employment',
        field: 'lifecycle_status',
        oldValue: fromStatus,
        newValue: newStatus,
        actor: me,
      }),
    ]);
    if (typeof broadcastAppEventFn === 'function') {
      await broadcastAppEventFn(env, 'users', 'user:lifecycle_changed', {
        id: luid,
        from_status: fromStatus,
        to_status: newStatus,
        reason,
      }, { actorId: me.id });
    }
    return { ok: true };
  }
};
