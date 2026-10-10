/**
 * Tasks & Handover Domain Tools
 * Includes: Personal Task List, Draft Task, Task Status Update, Task Assign,
 * Task Details Update, Task Delete, Handover Create, and Handover Confirm.
 */
import { safeBroadcast, parseRelativeDate, resolveUser, resolveTask, checkRolePermissions } from '../tool-helpers.js';

export const tasksHandoverTools = [
  {
    name: 'list_my_tasks',
    description: 'Tra cứu danh sách công việc được giao của tôi theo trạng thái hoặc mức độ ưu tiên.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'todo', 'in-progress', 'done'], description: 'Trạng thái công việc' },
        limit: { type: 'number', description: 'Số lượng task tối đa' }
      }
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const statusFilter = args.status && args.status !== 'all' ? args.status : null;
      let sql = `
        SELECT id, title, description, status, priority, due_date
          FROM tasks
         WHERE assigned_to = ?
      `;
      const binds = [me.id];
      if (statusFilter) {
        sql += ' AND status = ?';
        binds.push(statusFilter);
      }
      sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC LIMIT ?";
      binds.push(args.limit || 5);

      const { results = [] } = await env.DB.prepare(sql).bind(...binds).all();
      return { count: results.length, tasks: results };
    }
  },
  {
    name: 'create_task_draft',
    description: 'Soạn thảo công việc mới (tạo thẻ xác nhận để người dùng kiểm tra trước khi thêm vào DB).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tiêu đề công việc' },
        description: { type: 'string', description: 'Mô tả chi tiết' },
        dueDate: { type: 'string', description: 'Hạn hoàn thành YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Mức độ ưu tiên' }
      },
      required: ['title']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      if (args.autoExecute === true) {
        const title = args.title || 'Công việc mới';
        const desc = args.description || '';
        const due = args.dueDate || null;
        const prio = args.priority || 'medium';
        const res = await env.DB.prepare(`
          INSERT INTO tasks (title, description, due_date, priority, assigned_to, assigned_by, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'todo', datetime('now','localtime'), datetime('now','localtime'))
        `).bind(title, desc, due, prio, me.id, me.id).run();
        const newId = res.meta?.last_row_id;
        await safeBroadcast(env, 'tasks', 'task:created', { id: newId, title }, { actorId: me.id });
        return {
          executed: true,
          actionType: 'create_task',
          icon: 'clipboardPlus',
          title: 'Đã tạo công việc mới',
          message: `Đã tạo thành công Task #${newId} "${title}".`,
          details: [
            { label: 'Mã task', value: `#${newId}` },
            { label: 'Tiêu đề', value: title },
            { label: 'Ưu tiên', value: prio },
            { label: 'Hạn chót', value: due || 'Không có' }
          ]
        };
      }

      return {
        isActionCard: true,
        actionType: 'create_task',
        title: 'Xác nhận tạo Công việc mới',
        payload: {
          title: args.title,
          description: args.description || '',
          dueDate: args.dueDate || null,
          priority: args.priority || 'medium',
          assigneeId: me.id,
          assigneeName: me.full_name
        }
      };
    }
  },
  {
    name: 'task_update_status',
    description: 'Cập nhật trạng thái công việc (todo, in-progress, done, cancelled).',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'done', 'cancelled'], description: 'Trạng thái mới' }
      },
      required: ['taskId', 'status']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc tương ứng với mã hoặc tên: "${args.taskId || args.taskRef || ''}".` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_to !== me.id && task.assigned_by !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật trạng thái cho công việc này.' };
      }

      const s = String(args.status || '').toLowerCase();
      const st = (s.includes('done') || s.includes('hoàn thành') || s.includes('xong')) ? 'done'
        : (s.includes('in-progress') || s.includes('đang làm') || s.includes('tiến hành')) ? 'in-progress'
        : (s.includes('cancelled') || s.includes('hủy')) ? 'cancelled' : 'todo';

      const statusLabels = {
        'done': 'Đã hoàn thành (Done)',
        'in-progress': 'Đang thực hiện (In-progress)',
        'todo': 'Chờ thực hiện (Todo)',
        'cancelled': 'Đã hủy (Cancelled)'
      };

      await env.DB.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(st, task.id).run();
      await safeBroadcast(env, 'tasks', 'task:updated', { id: task.id, status: st }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'update_task_status',
        icon: 'clipboardCheck',
        title: 'Cập nhật trạng thái công việc',
        message: `Task #${task.id} "${task.title}" đã được chuyển sang trạng thái "${statusLabels[st]}".`,
        details: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Tiêu đề', value: task.title },
          { label: 'Trạng thái cũ', value: task.status },
          { label: 'Trạng thái mới', value: statusLabels[st] }
        ],
        undoAction: {
          actionType: 'update_task_status',
          payload: { taskId: task.id, status: task.status }
        }
      };
    }
  },
  {
    name: 'task_assign',
    description: 'Phân công công việc cho nhân viên khác.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' },
        assigneeName: { type: 'string', description: 'Tên hoặc mã nhân viên người nhận việc' }
      },
      required: ['taskId', 'assigneeName']
    },
    allowedPersonas: ['hr', 'director'],
    execute: async (env, args, me) => {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc: "${args.taskId || args.taskRef || ''}".` };

      const target = await resolveUser(env, args.assigneeName || args.assigneeId);
      if (!target) return { error: 'USER_NOT_FOUND', message: `Không tìm thấy nhân sự "${args.assigneeName || ''}" để phân công.` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_by !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền phân công lại công việc này.' };
      }

      await env.DB.prepare("UPDATE tasks SET assigned_to = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(target.id, task.id).run();
      await safeBroadcast(env, 'tasks', 'task:assigned', { id: task.id, assigned_to: target.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'assign_task',
        icon: 'userRound',
        title: 'Phân công công việc',
        message: `Đã phân công Task #${task.id} "${task.title}" cho nhân sự **${target.full_name}** (${target.employee_code || 'NV'}).`,
        details: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Tiêu đề', value: task.title },
          { label: 'Người nhận việc mới', value: `${target.full_name} (${target.employee_code || 'NV'})` }
        ],
        undoAction: {
          actionType: 'assign_task',
          payload: { taskId: task.id, assigneeId: task.assigned_to }
        }
      };
    }
  },
  {
    name: 'task_update_details',
    description: 'Cập nhật hạn chót (due date) hoặc mức độ ưu tiên của công việc.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' },
        dueDate: { type: 'string', description: 'Hạn hoàn thành YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Mức độ ưu tiên' }
      },
      required: ['taskId']
    },
    allowedPersonas: ['hr', 'director'],
    execute: async (env, args, me) => {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc: "${args.taskId || args.taskRef || ''}".` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_by !== me.id && task.assigned_to !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền cập nhật công việc này.' };
      }

      const newDueDate = args.dueDate ? parseRelativeDate(args.dueDate, task.due_date) : task.due_date;
      const newPriority = args.priority || task.priority;

      await env.DB.prepare("UPDATE tasks SET due_date = ?, priority = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(newDueDate, newPriority, task.id).run();
      await safeBroadcast(env, 'tasks', 'task:updated', { id: task.id, due_date: newDueDate, priority: newPriority }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'update_task_details',
        icon: 'clipboardList',
        title: 'Cập nhật thông tin công việc',
        message: `Đã cập nhật Task #${task.id} "${task.title}": Hạn chót mới là **${newDueDate || 'Không có'}**, Ưu tiên: **${newPriority}**.`,
        details: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Hạn chót', value: newDueDate || 'N/A' },
          { label: 'Ưu tiên', value: newPriority }
        ]
      };
    }
  },
  {
    name: 'task_delete',
    description: 'Xóa công việc khỏi hệ thống (cần xác nhận).',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'ID của task' }
      },
      required: ['taskId']
    },
    allowedPersonas: ['hr', 'director'],
    execute: async (env, args, me) => {
      const task = await resolveTask(env, args.taskId || args.taskRef, me);
      if (!task) return { error: 'NOT_FOUND', message: `Không tìm thấy công việc: "${args.taskId || args.taskRef || ''}".` };

      const { isAdmin, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isManager && task.assigned_by !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn không có quyền xóa công việc này.' };
      }

      return {
        isActionCard: true,
        actionType: 'delete_task',
        icon: 'trash2',
        title: `Xác nhận xóa công việc #${task.id}`,
        confirmLabel: 'Xác nhận xóa',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Mã task', value: `#${task.id}` },
          { label: 'Tiêu đề', value: task.title },
          { label: 'Trạng thái', value: task.status }
        ],
        payload: { taskId: task.id }
      };
    }
  },
  {
    name: 'handover_create',
    description: 'Tạo phiếu bàn giao tài sản, tài khoản hoặc dự án.',
    parameters: {
      type: 'object',
      properties: {
        assetName: { type: 'string', description: 'Tên tài sản / dự án bàn giao' },
        assetType: { type: 'string', description: 'Loại tài sản' },
        receiverName: { type: 'string', description: 'Người nhận bàn giao' }
      },
      required: ['assetName']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const receiver = args.receiverName ? await resolveUser(env, args.receiverName) : null;
      return {
        isActionCard: true,
        actionType: 'create_handover',
        icon: 'link',
        title: 'Xác nhận tạo biên bản bàn giao',
        confirmLabel: 'Xác nhận bàn giao',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Tài sản / Dự án', value: args.assetName },
          { label: 'Loại', value: args.assetType || 'device' },
          { label: 'Người nhận bàn giao', value: receiver?.full_name || args.receiverName || 'Chưa chỉ định' },
          { label: 'Ghi chú', value: args.note || 'Không có' }
        ],
        payload: {
          assetName: args.assetName,
          assetType: args.assetType || 'device',
          mentorId: receiver?.id || null,
          mentorName: receiver?.full_name || args.receiverName || null,
          note: args.note || ''
        }
      };
    }
  },
  {
    name: 'handover_confirm',
    description: 'Xác nhận hoàn tất đã nhận bàn giao.',
    parameters: {
      type: 'object',
      properties: {
        handoverId: { type: 'number', description: 'ID của mục bàn giao' }
      },
      required: ['handoverId']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const row = await env.DB.prepare('SELECT * FROM asset_handovers WHERE id = ?').bind(Number(args.handoverId)).first();
      if (!row) return { error: 'NOT_FOUND', message: `Không tìm thấy mục bàn giao #${args.handoverId}.` };

      await env.DB.prepare("UPDATE asset_handovers SET status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(row.id).run();
      await safeBroadcast(env, 'handover', 'handover:confirmed', { id: row.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'confirm_handover',
        icon: 'circleCheck',
        title: 'Xác nhận hoàn tất bàn giao',
        message: `Đã xác nhận hoàn tất bàn giao tài sản/dự án #${row.id} ("${row.asset_name}").`,
        details: [
          { label: 'Mục bàn giao', value: row.asset_name },
          { label: 'Trạng thái', value: 'Đã hoàn thành (Completed)' }
        ]
      };
    }
  }
];
