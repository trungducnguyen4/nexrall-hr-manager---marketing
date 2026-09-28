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
