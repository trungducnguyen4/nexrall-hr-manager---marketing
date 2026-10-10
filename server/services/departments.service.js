export const STANDARD_DEPARTMENTS = [
  'Ban Giám Đốc', 'Phòng HCNS', 'Phòng Kinh Doanh', 'Phòng Marketing',
  'Phòng Biên Tập', 'Phòng Sản Xuất Phim', 'Phòng Gameshow', 'Phòng Kế Toán', 'Phòng IT',
];

export function deptNormKey(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export const DEPT_ALIASES = {
  'Ban Giám Đốc': ['ban giam doc', 'bgd', 'giam doc', 'ban lanh dao'],
  'Phòng HCNS': ['hcns', 'phong hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'],
  'Phòng Kinh Doanh': ['kinh doanh', 'phong kinh doanh', 'sale', 'sales', 'phong sale', 'account sales', 'account', 'business development'],
  'Phòng Marketing': ['marketing', 'phong marketing', 'content marketing', 'seo sem', 'social media', 'design', 'performance', 'pr events', 'pr & events', 'truyen thong', 'digital ads', 'ads', 'quang cao'],
  'Phòng Biên Tập': ['bien tap', 'phong bien tap', 'noi dung'],
  'Phòng Sản Xuất Phim': ['san xuat phim', 'phong san xuat phim', 'production', 'san xuat'],
  'Phòng Gameshow': ['gameshow', 'phong gameshow', 'game show'],
  'Phòng Kế Toán': ['ke toan', 'phong ke toan', 'accounting', 'tai chinh ke toan'],
};

export const DEPT_LOOKUP = (() => {
  const m = {};
  for (const std of STANDARD_DEPARTMENTS) m[deptNormKey(std)] = std;
  for (const [std, aliases] of Object.entries(DEPT_ALIASES)) {
    for (const a of aliases) m[deptNormKey(a)] = std;
  }
  return m;
})();

export function normalizeDeptName(name) {
  if (!name) return name;
  const cleaned = String(name).trim().replace(/\s+/g, ' ');
  const std = DEPT_LOOKUP[deptNormKey(cleaned)];
  return std || cleaned;
}

export function deptUniqueKey(name) {
  return deptNormKey(normalizeDeptName(name || ''));
}

export async function findDepartmentDuplicate(env, name, excludeId = null) {
  const key = deptUniqueKey(name);
  const { results } = await env.DB.prepare('SELECT id,name FROM departments').all();
  return (results || []).find(d =>
    deptUniqueKey(d.name) === key && (excludeId === null || Number(d.id) !== Number(excludeId))
  ) || null;
}

export const DEPT_CODE = {
  'Ban Giám Đốc': 'BGD',
  'Phòng HCNS': 'HCNS',
  'Phòng Kinh Doanh': 'KD',
  'Phòng Marketing': 'MKT',
  'Phòng Biên Tập': 'BT',
  'Phòng Sản Xuất Phim': 'SXF',
  'Phòng Gameshow': 'GSH',
  'Phòng Kế Toán': 'KT',
  'Phòng IT': 'IT',
};

export function employeeTypeCode(t) {
  return t === 'TTS' ? 'TTS' : 'NV';
}

export async function nextEmployeeCode(env, type, department) {
  const typeCode = employeeTypeCode(type);
  const deptStd = normalizeDeptName(department || '');
  const deptCode = DEPT_CODE[deptStd] || 'KHAC';
  const prefix = `${typeCode}-${deptCode}-`;
  const { results } = await env.DB.prepare(
    'SELECT employee_code FROM users WHERE employee_code LIKE ?'
  ).bind(prefix + '%').all();
  let maxSeq = 0;
  for (const row of results) {
    const m = /^\d{3,}$/.exec(String(row.employee_code || '').slice(prefix.length));
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[0], 10));
  }
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

let _deptsNormalized = false;
export async function normalizeDepartmentData(env) {
  if (_deptsNormalized) return;
  _deptsNormalized = true;

  const { results: userDepts } = await env.DB.prepare(
    "SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department != ''"
  ).all();
  for (const row of userDepts) {
    const std = normalizeDeptName(row.department);
    if (std !== row.department) {
      await env.DB.prepare('UPDATE users SET department=? WHERE department=?').bind(std, row.department).run();
    }
  }

  const { results: depts } = await env.DB.prepare('SELECT id, name FROM departments').all();
  const seen = new Map();
  for (const d of depts) {
    const std = normalizeDeptName(d.name);
    if (std !== d.name) {
      await env.DB.prepare('UPDATE departments SET name=? WHERE id=?').bind(std, d.id).run();
    }
    if (!seen.has(std) || d.id < seen.get(std)) seen.set(std, Math.min(d.id, seen.get(std) ?? d.id));
  }
  for (const [std, keepId] of seen.entries()) {
    const dupIds = depts.filter(d => normalizeDeptName(d.name) === std && d.id !== keepId).map(d => d.id);
    for (const dupId of dupIds) {
      await env.DB.prepare('UPDATE employees SET department_id=? WHERE department_id=?').bind(keepId, dupId).run();
      await env.DB.prepare('DELETE FROM departments WHERE id=?').bind(dupId).run();
    }
  }
}

export const DepartmentsService = {
  async list(env) {
    const { results } = await env.DB.prepare(`
      SELECT d.*, u.full_name AS manager_name, u.employee_code AS manager_employee_code,
             u.department AS manager_department, u.position AS manager_position,
             (SELECT count(*) FROM users u2 WHERE lower(trim(u2.department)) = lower(trim(d.name)) AND u2.is_active=1) as employee_count
        FROM departments d
        LEFT JOIN users u ON u.id = d.manager_id
       ORDER BY d.name
    `).all();
    return results || [];
  },

  async create(env, { name, managerName, managerId, description, userId }) {
    const r = await env.DB.prepare('INSERT INTO departments (user_id,name,manager,manager_id,description) VALUES (?,?,?,?,?)')
      .bind(userId || null, name, managerName, managerId, String(description || '').trim()).run();
    return r.meta?.last_row_id;
  },

  async update(env, id, { name, managerName, managerId, description }) {
    await env.DB.prepare('UPDATE departments SET name=?,manager=?,manager_id=?,description=? WHERE id=?')
      .bind(name, managerName, managerId, String(description || '').trim(), id).run();
  },

  async remove(env, id) {
    const dept = await env.DB.prepare('SELECT name FROM departments WHERE id=?').bind(id).first();
    if (!dept) return { error: 'Không tìm thấy phòng ban', status: 404 };
    const inUse = await env.DB.prepare('SELECT count(*) as total FROM users WHERE lower(trim(department))=lower(trim(?)) AND is_active=1').bind(dept.name).first();
    if (inUse && inUse.total > 0) {
      return {
        error: `Không thể xóa phòng ban "${dept.name}" vì đang có ${inUse.total} nhân sự trực thuộc. Vui lòng chuyển nhân sự sang phòng ban khác trước!`,
        status: 400
      };
    }
    await env.DB.prepare('DELETE FROM departments WHERE id=?').bind(id).run();
    return { ok: true };
  }
};
