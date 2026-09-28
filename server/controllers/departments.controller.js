import { json, err } from '../lib/response.js';
import { DepartmentsService } from '../services/departments.service.js';

export const DepartmentsController = {
  async list(ctx) {
    const list = await DepartmentsService.list(ctx.env);
    return json({ departments: list });
  },

  async create(ctx, normalizeDeptNameFn, findDepartmentDuplicateFn, intOrNullFn, isHcnsFn) {
    if (!(ctx.isAdmin || isHcnsFn(ctx.me))) {
      return err(403, 'Chỉ Admin hoặc nhân viên Phòng HCNS mới có quyền thêm phòng ban');
    }
    const b = await ctx.request.json().catch(() => ({}));
    const name = normalizeDeptNameFn(b.name);
    if (!name) return err(400, 'Thiếu tên phòng ban');
    const dup = await findDepartmentDuplicateFn(ctx.env, name);
    if (dup) return err(400, 'Phòng ban này đã tồn tại');

    const managerId = intOrNullFn(b.manager_id);
    const manager = managerId ? await ctx.env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(managerId).first() : null;
    if (managerId && !manager) return err(400, 'Không tìm thấy trưởng phòng');
    const managerName = manager?.full_name || String(b.manager || '').trim();

    try {
      const id = await DepartmentsService.create(ctx.env, {
        name,
        managerName,
        managerId,
        description: b.description,
        userId: ctx.env.USER_ID
      });
      return json({ ok: true, id });
    } catch (e) {
      if (String(e.message || '').toLowerCase().includes('unique')) return err(400, 'Phòng ban này đã tồn tại');
      throw e;
    }
  },

  async update(ctx, id, normalizeDeptNameFn, findDepartmentDuplicateFn, intOrNullFn, isHcnsFn) {
    if (!(ctx.isAdmin || isHcnsFn(ctx.me))) {
      return err(403, 'Chỉ Admin hoặc nhân viên Phòng HCNS mới có quyền sửa phòng ban');
    }
    const b = await ctx.request.json().catch(() => ({}));
    const name = normalizeDeptNameFn(b.name);
    if (!name) return err(400, 'Thiếu tên phòng ban');
    const dup = await findDepartmentDuplicateFn(ctx.env, name, id);
    if (dup) return err(400, 'Phòng ban này đã tồn tại');

    const managerId = intOrNullFn(b.manager_id);
    const manager = managerId ? await ctx.env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(managerId).first() : null;
    if (managerId && !manager) return err(400, 'Không tìm thấy trưởng phòng');
    const managerName = manager?.full_name || String(b.manager || '').trim();

    await DepartmentsService.update(ctx.env, id, {
      name,
      managerName,
      managerId,
      description: b.description
    });
    return json({ ok: true });
  },

  async remove(ctx, id, isHcnsFn) {
    if (!(ctx.isAdmin || isHcnsFn(ctx.me))) {
      return err(403, 'Chỉ Admin hoặc nhân viên Phòng HCNS mới có quyền xóa phòng ban');
    }
    const res = await DepartmentsService.remove(ctx.env, id);
    if (res.error) return err(res.status || 400, res.error);
    return json({ ok: true });
  }
};
