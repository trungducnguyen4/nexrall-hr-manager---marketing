/**
 * Tasks Controller - HTTP Endpoints for Tasks, Kanban, Projects, Subtasks & Workspaces
 */
import { json, err } from '../lib/response.js';
import { normalizeVietnameseSearch, safeDownloadName } from '../lib/string.js';
import {
  isTaskAdmin,
  intOrNull,
  taskLabelColor,
  canUseTaskProject,
  canUseTaskGroup,
  taskActivityAssignee,
  recordTaskActivity,
  resolveTaskLabel,
  ensureDefaultTaskGroup,
  resolveThuytttUser,
  resolveHaunvUser,
  syncThuytttFollowerToAllProjectsAndTasks,
  ensureEmployeePersonalProject,
  ensureTaskActivityTimelineSchema,
  ensureSubtaskSchema,
  ensureTaskCompletionSubscriptionsSchema,
  ensureMyxteamTaskImportSchema,
  importMyxteamProject,
  normalizeDefaultTaskGroupNames,
} from '../services/tasks.service.js';

export async function handleTaskRoutes(request, env, me, path, url, options = {}) {
  const {
    isManager = false,
    isAdmin = false,
    isHcns = (u) => isTaskAdmin(u),
    broadcastAppEvent = async () => {},
    sendWebPushNotification = async () => {},
  } = options;

  if (path === '/api/task-imports/myxteam/project' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Chỉ Admin/HCNS được nhập dữ liệu MyXteam' }, 403);
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'JSON không hợp lệ' }, 400); }
    const project = body?.project || body;
    const groups = Array.isArray(project?.groups) ? project.groups : [];
    const taskCount = groups.reduce((sum, group) => sum + (Array.isArray(group?.tasks) ? group.tasks.length : 0), 0);
    if (groups.length > 500 || taskCount > 5000) return json({ error: 'Project vượt giới hạn nhập an toàn' }, 413);
    try {
      return json({ ok: true, result: await importMyxteamProject(env, me, project) });
    } catch (error) {
      console.error('MyXteam import failed', error);
      return json({ error: error?.message || 'Không thể nhập Project MyXteam' }, 400);
    }
  }

  if (path === '/api/task-projects' && request.method === 'GET') {
    const includeArchived = url.searchParams.get('include_archived') === '1';
    const search = normalizeVietnameseSearch(url.searchParams.get('search'));
    let q = `SELECT p.*, u.full_name as manager_name,
                    (SELECT COUNT(*) FROM task_project_members m WHERE m.project_id=p.id) as member_count,
                    (SELECT GROUP_CONCAT(user_id) FROM task_project_members m WHERE m.project_id=p.id) as member_ids,
                    (SELECT COUNT(*) FROM tasks t WHERE t.team_project_id=p.id) as task_count
               FROM task_projects p
               LEFT JOIN users u ON p.manager_id=u.id
              WHERE 1=1`;
    const binds = [];
    if (!includeArchived) q += " AND COALESCE(p.status,'active')!='archived'";
    if (!isTaskAdmin(me)) {
      q += ` AND (p.manager_id=? OR EXISTS (
        SELECT 1 FROM task_project_members m WHERE m.project_id=p.id AND m.user_id=?
      ))`;
      binds.push(me.id, me.id);
    }
    q += " ORDER BY CASE COALESCE(p.status,'active') WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.updated_at DESC, p.id DESC";
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    const visibleProjects = search ? results.filter(project => normalizeVietnameseSearch(
      `${project.name || ''} ${project.code || ''} ${project.description || ''} ${project.department || ''}`
    ).includes(search)) : results;
    return json({ projects: visibleProjects, canManage: isTaskAdmin(me) });
  }

  if (path === '/api/task-projects' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json();
    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'Thieu ten Project' }, 400);
    const type = 'project';
    const status = ['active','paused','archived','done'].includes(b.status) ? b.status : 'active';
    const managerId = intOrNull(b.manager_id);
    const r = await env.DB.prepare(
      `INSERT INTO task_projects (workspace_id,name,code,type,description,department,manager_id,status,start_date,end_date,created_by)
       VALUES (1,?,?,?,?,?,?,?,?,?,?)`
    ).bind(name, String(b.code || '').trim(), type, String(b.description || '').trim(), String(b.department || '').trim(), managerId, status, b.start_date || null, b.end_date || null, me.id).run();
    const projectId = r.meta.last_row_id;
    const members = Array.isArray(b.members) ? b.members : [];
    if (managerId && !members.includes(managerId)) members.push(managerId);
    for (const uid of [...new Set(members.map(Number).filter(Boolean))]) {
      await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
        .bind(projectId, uid, uid === managerId ? 'owner' : 'member', me.id).run();
    }
    await ensureDefaultTaskGroup(env, projectId, me.id);
    await broadcastAppEvent(env, 'tasks', 'task_project:created', { id: projectId, name, department: b.department || '' }, { actorId: me.id });
    return json({ ok: true, id: projectId });
  }

  const projectTimelineMatch = path.match(/^\/api\/task-projects\/(\d+)\/timeline$/);
  if (projectTimelineMatch && request.method === 'GET') {
    const projectId = parseInt(projectTimelineMatch[1]);
    const project = await env.DB.prepare(
      'SELECT id,name,code,created_by,manager_id FROM task_projects WHERE id=?'
    ).bind(projectId).first();
    if (!project) return json({ error: 'Khong tim thay Project' }, 404);

    const canView = isTaskAdmin(me)
      || Number(project.created_by) === Number(me.id)
      || Number(project.manager_id) === Number(me.id);
    if (!canView) return json({ error: 'Khong co quyen xem Timeline cua Project nay' }, 403);

    const kind = String(url.searchParams.get('kind') || 'all').toLowerCase();
    const allowedKinds = {
      all: ['task_created', 'task_completed', 'task_reopened', 'subtask_created', 'subtask_completed', 'subtask_reopened', 'created'],
      created: ['task_created', 'subtask_created', 'created'],
      completed: ['task_completed', 'subtask_completed'],
      reopened: ['task_reopened', 'subtask_reopened'],
    };
    const actions = allowedKinds[kind] || allowedKinds.all;
    const requestedLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 50, 100));
    const before = intOrNull(url.searchParams.get('before'));
    const placeholders = actions.map(() => '?').join(',');
    const binds = [projectId, projectId, ...actions];
    let q = `SELECT a.id,a.action,a.detail,a.project_id,a.entity_type,a.entity_id,
                    COALESCE(a.entity_title,t.title) AS entity_title,
                    a.assignee_id,a.assignee_name,a.created_at,
                    COALESCE(a.actor_name,u.full_name,'Nguoi dung') AS actor_name,
                    u.avatar_color,u.avatar_initials
               FROM task_activity a
               LEFT JOIN tasks t ON t.id=a.task_id
               LEFT JOIN users u ON u.id=a.user_id
              WHERE (a.project_id=? OR (a.project_id IS NULL AND t.team_project_id=?))
                AND a.action IN (${placeholders})`;
    if (before) { q += ' AND a.id<?'; binds.push(before); }
    q += ' ORDER BY a.created_at DESC,a.id DESC LIMIT ?';
    binds.push(limit + 1);
    const { results = [] } = await env.DB.prepare(q).bind(...binds).all();
    const hasMore = results.length > limit;
    const events = results.slice(0, limit).map(activity => ({
      ...activity,
      // `created` is the only legacy action exposed. It has no reliable
      // completion state, so never infer one from the current task status.
      action: activity.action === 'created' ? 'task_created' : activity.action,
      entity_type: activity.entity_type || 'task',
      legacy: activity.action === 'created',
    }));
    return json({
      project: { id: project.id, name: project.name, code: project.code },
      events,
      has_more: hasMore,
      next_before: hasMore && events.length ? events[events.length - 1].id : null,
    });
  }

  const projectMatch = path.match(/^\/api\/task-projects\/(\d+)$/);
  if (projectMatch) {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const projectId = parseInt(projectMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      const project = await env.DB.prepare('SELECT * FROM task_projects WHERE id=?').bind(projectId).first();
      if (!project) return json({ error: 'Khong tim thay' }, 404);
      const type = 'project';
      const status = ['active','paused','archived','done'].includes(b.status) ? b.status : project.status;
      await env.DB.prepare(
        `UPDATE task_projects
            SET name=?,code=?,type=?,description=?,department=?,manager_id=?,status=?,start_date=?,end_date=?,updated_at=datetime('now','localtime')
          WHERE id=?`
      ).bind(
        String(b.name || project.name).trim(),
        String(b.code ?? project.code ?? '').trim(),
        type,
        String(b.description ?? project.description ?? '').trim(),
        String(b.department ?? project.department ?? '').trim(),
        intOrNull(b.manager_id) || project.manager_id || null,
        status,
        b.start_date ?? project.start_date ?? null,
        b.end_date ?? project.end_date ?? null,
        projectId
      ).run();
      await broadcastAppEvent(env, 'tasks', 'task_project:updated', { id: projectId, name: b.name || project.name, status }, { actorId: me.id });
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      const permanent = url.searchParams.get('permanent') === '1';
      if (permanent) {
        try {
          const { results: projectTasks = [] } = await env.DB.prepare('SELECT id FROM tasks WHERE team_project_id=?').bind(projectId).all();
          for (const t of projectTasks) {
            try { await env.DB.prepare('DELETE FROM subtasks WHERE task_id=?').bind(t.id).run(); } catch (_) {}
            try { await env.DB.prepare('DELETE FROM task_followers WHERE task_id=?').bind(t.id).run(); } catch (_) {}
            try { await env.DB.prepare('DELETE FROM task_comments WHERE task_id=?').bind(t.id).run(); } catch (_) {}
            try { await env.DB.prepare('DELETE FROM task_activity WHERE task_id=?').bind(t.id).run(); } catch (_) {}
            try { await env.DB.prepare('DELETE FROM task_attachments WHERE task_id=?').bind(t.id).run(); } catch (_) {}
            try { await env.DB.prepare('DELETE FROM task_mention_notifications WHERE task_id=?').bind(t.id).run(); } catch (_) {}
          }
          try { await env.DB.prepare('DELETE FROM tasks WHERE team_project_id=?').bind(projectId).run(); } catch (_) {}
          try { await env.DB.prepare('DELETE FROM task_groups WHERE project_id=?').bind(projectId).run(); } catch (_) {}
          try { await env.DB.prepare('DELETE FROM task_project_members WHERE project_id=?').bind(projectId).run(); } catch (_) {}
          try { await env.DB.prepare('DELETE FROM task_projects WHERE id=?').bind(projectId).run(); } catch (_) {}
        } catch (delErr) {
          return json({ error: delErr.message || 'Không thể xóa dự án' }, 500);
        }
      } else {
        await env.DB.prepare("UPDATE task_projects SET status='archived',updated_at=datetime('now','localtime') WHERE id=?").bind(projectId).run();
      }
      await broadcastAppEvent(env, 'tasks', 'task_project:deleted', { id: projectId, permanent }, { actorId: me.id });
      return json({ ok: true });
    }
  }

  const projectMembersMatch = path.match(/^\/api\/task-projects\/(\d+)\/members$/);
  if (projectMembersMatch && request.method === 'GET') {
    const projectId = parseInt(projectMembersMatch[1]);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    const { results = [] } = await env.DB.prepare(
      `SELECT m.user_id,m.role,m.created_at,u.full_name,u.employee_code,u.department,u.position,u.avatar_color,u.avatar_initials,u.avatar_url
         FROM task_project_members m JOIN users u ON u.id=m.user_id
        WHERE m.project_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.full_name COLLATE NOCASE`
    ).bind(projectId).all();
    return json({ members: results, can_manage: isTaskAdmin(me) });
  }
  if (projectMembersMatch && request.method === 'PUT') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const projectId = parseInt(projectMembersMatch[1]);
    const b = await request.json();
    const project = await env.DB.prepare('SELECT * FROM task_projects WHERE id=?').bind(projectId).first();
    if (!project) return json({ error: 'Khong tim thay' }, 404);
    const members = Array.isArray(b.members) ? b.members.map(Number).filter(Boolean) : [];
    if (project.manager_id && !members.includes(project.manager_id)) members.push(project.manager_id);
    await env.DB.prepare('DELETE FROM task_project_members WHERE project_id=?').bind(projectId).run();
    for (const uid of [...new Set(members)]) {
      await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
        .bind(projectId, uid, uid === Number(project.manager_id) ? 'owner' : 'member', me.id).run();
    }
    await broadcastAppEvent(env, 'tasks', 'task_project:members_updated', { id: projectId, members: [...new Set(members)] }, { actorId: me.id });
    return json({ ok: true });
  }

  if (path === '/api/task-project-groups/members' && request.method === 'PUT') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json();
    const department = String(b.department || '').trim();
    if (!department) return json({ error: 'Thieu ten nhom du an' }, 400);
    const members = Array.isArray(b.members) ? b.members.map(Number).filter(Boolean) : [];
    const { results: groupProjects = [] } = await env.DB.prepare(
      'SELECT id, manager_id FROM task_projects WHERE department=?'
    ).bind(department).all();

    for (const p of groupProjects) {
      const pMembers = [...members];
      if (p.manager_id && !pMembers.includes(Number(p.manager_id))) {
        pMembers.push(Number(p.manager_id));
      }
      await env.DB.prepare('DELETE FROM task_project_members WHERE project_id=?').bind(p.id).run();
      for (const uid of [...new Set(pMembers)]) {
        await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
          .bind(p.id, uid, uid === Number(p.manager_id) ? 'owner' : 'member', me.id).run();
      }
    }
    await broadcastAppEvent(env, 'tasks', 'task_project_group:members_updated', { department, count: groupProjects.length }, { actorId: me.id });
    return json({ ok: true, count: groupProjects.length });
  }

  if (path === '/api/task-projects/sync-all-employees' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const { results: activeUsers = [] } = await env.DB.prepare(
      "SELECT id, full_name, employee_code FROM users WHERE is_active=1 AND COALESCE(lifecycle_status,'') != 'Đã nghỉ' ORDER BY id"
    ).all();
    let synced = 0;
    for (const u of activeUsers) {
      if (u.full_name) {
        await ensureEmployeePersonalProject(env, u, me.id);
        synced++;
      }
    }
    await syncThuytttFollowerToAllProjectsAndTasks(env);
    return json({ ok: true, synced, total: activeUsers.length });
  }

  if (path === '/api/task-groups' && request.method === 'GET') {
    const projectId = intOrNull(url.searchParams.get('project_id'));
    if (!projectId) return json({ error: 'Thieu project_id' }, 400);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    await ensureDefaultTaskGroup(env, projectId, me.id);
    const includeArchived = url.searchParams.get('include_archived') === '1';
    let q = `SELECT g.*,
                    (SELECT COUNT(*) FROM tasks t WHERE t.group_id=g.id OR (g.position=0 AND t.team_project_id=g.project_id AND t.group_id IS NULL)) as task_count
               FROM task_groups g WHERE g.project_id=?`;
    const binds = [projectId];
    if (!includeArchived) q += ' AND g.is_archived=0';
    q += ' ORDER BY g.position ASC, g.id ASC';
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    const canManageGroups = isTaskAdmin(me) || (await canUseTaskProject(env, projectId, me));
    return json({ groups: results, canManage: canManageGroups });
  }

  if (path === '/api/task-groups' && request.method === 'POST') {
    const b = await request.json();
    const projectId = intOrNull(b.project_id);
    const name = String(b.name || '').trim();
    if (!projectId || !name) return json({ error: 'Thieu Project hoac ten nhom' }, 400);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? String(b.color) : '#6366F1';
    const posRow = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM task_groups WHERE project_id=?').bind(projectId).first();
    const position = Number.isFinite(Number(b.position)) ? Number(b.position) : Number(posRow?.next_pos || 0);
    const r = await env.DB.prepare(
      'INSERT INTO task_groups (project_id,name,position,color,created_by) VALUES (?,?,?,?,?)'
    ).bind(projectId, name, position, color, me.id).run();
    const groupId = r.meta.last_row_id;
    await broadcastAppEvent(env, 'tasks', 'task_group:created', { id: groupId, project_id: projectId, name, position, color }, { actorId: me.id });
    return json({ ok: true, id: groupId });
  }

  const groupMatch = path.match(/^\/api\/task-groups\/(\d+)$/);
  if (groupMatch) {
    const groupId = parseInt(groupMatch[1]);
    const group = await env.DB.prepare('SELECT * FROM task_groups WHERE id=?').bind(groupId).first();
    if (!group) return json({ error: 'Khong tim thay' }, 404);
    if (!(await canUseTaskProject(env, group.project_id, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    if (request.method === 'PUT') {
      const b = await request.json();
      const name = String(b.name || group.name || '').trim();
      if (!name) return json({ error: 'Thieu ten nhom' }, 400);
      const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? String(b.color) : group.color;
      const position = Number.isFinite(Number(b.position)) ? Number(b.position) : group.position;
      await env.DB.prepare(
        "UPDATE task_groups SET name=?,position=?,color=?,is_archived=?,updated_at=datetime('now','localtime') WHERE id=?"
      ).bind(name, position, color, b.is_archived ?? group.is_archived ?? 0, groupId).run();
      await broadcastAppEvent(env, 'tasks', 'task_group:updated', { id: groupId, project_id: group.project_id, name, position, color, is_archived: b.is_archived ?? group.is_archived ?? 0 }, { actorId: me.id });
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare("UPDATE task_groups SET is_archived=1,updated_at=datetime('now','localtime') WHERE id=?").bind(groupId).run();
      await broadcastAppEvent(env, 'tasks', 'task_group:deleted', { id: groupId, project_id: group.project_id }, { actorId: me.id });
      return json({ ok: true });
    }
  }

  if (path === '/api/task-labels' && request.method === 'GET') {
    const projectId = intOrNull(url.searchParams.get('project_id'));
    let q = `SELECT l.*, p.name as project_name,
                    (SELECT COUNT(*) FROM tasks t WHERE t.label_id=l.id) as usage_count
               FROM task_labels l
               LEFT JOIN task_projects p ON l.project_id=p.id
              WHERE l.is_active=1 AND (l.project_id IS NULL`;
    const binds = [];
    if (projectId) { q += ' OR l.project_id=?'; binds.push(projectId); }
    q += ')';
    if (!isTaskAdmin(me) && projectId) {
      q += ` AND (l.project_id IS NULL OR EXISTS (
        SELECT 1 FROM task_project_members m WHERE m.project_id=l.project_id AND m.user_id=?
      ) OR EXISTS (SELECT 1 FROM task_projects p2 WHERE p2.id=l.project_id AND p2.manager_id=?))`;
      binds.push(me.id, me.id);
    }
    q += ' ORDER BY l.project_id IS NOT NULL, l.name';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ labels: results, canManage: isTaskAdmin(me) });
  }

  if (path === '/api/task-labels' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json();
    const name = String(b.name || '').trim();
    const color = String(b.color || '').trim();
    if (!name) return json({ error: 'Thieu ten nhan' }, 400);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: 'Mau khong hop le' }, 400);
    const projectId = intOrNull(b.project_id);
    await env.DB.prepare(
      `INSERT INTO task_labels (workspace_id,project_id,name,code,color,description,is_active,created_by)
       VALUES (1,?,?,?,?,?,1,?)`
    ).bind(projectId, name, String(b.code || '').trim(), color, String(b.description || '').trim(), me.id).run();
    return json({ ok: true });
  }

  const labelMatch = path.match(/^\/api\/task-labels\/(\d+)$/);
  if (labelMatch) {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const labelId = parseInt(labelMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      const label = await env.DB.prepare('SELECT * FROM task_labels WHERE id=?').bind(labelId).first();
      if (!label) return json({ error: 'Khong tim thay' }, 404);
      const color = String(b.color || label.color || '').trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: 'Mau khong hop le' }, 400);
      await env.DB.prepare(
        `UPDATE task_labels
            SET name=?,code=?,color=?,description=?,project_id=?,updated_at=datetime('now','localtime')
          WHERE id=?`
      ).bind(
        String(b.name || label.name).trim(),
        String(b.code ?? label.code ?? '').trim(),
        color,
        String(b.description ?? label.description ?? '').trim(),
        intOrNull(b.project_id) || null,
        labelId
      ).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      const used = await env.DB.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE label_id=?').bind(labelId).first();
      if ((used?.cnt || 0) > 0) {
        await env.DB.prepare("UPDATE task_labels SET is_active=0,updated_at=datetime('now','localtime') WHERE id=?").bind(labelId).run();
      } else {
        await env.DB.prepare('DELETE FROM task_labels WHERE id=?').bind(labelId).run();
      }
      return json({ ok: true });
    }
  }

  if (path === '/api/tasks/completion-subscriptions' && request.method === 'GET') {
    try {
      const { results = [] } = await env.DB.prepare(
        'SELECT * FROM task_completion_subscriptions WHERE user_id = ?'
      ).bind(me.id).all();
      return json({ subscriptions: results });
    } catch (_) {
      await ensureTaskCompletionSubscriptionsSchema(env);
      const { results = [] } = await env.DB.prepare(
        'SELECT * FROM task_completion_subscriptions WHERE user_id = ?'
      ).bind(me.id).all().catch(() => ({ results: [] }));
      return json({ subscriptions: results });
    }
  }

  if (path === '/api/tasks/completion-subscriptions/toggle' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const department = String(b.department || '').trim();
    const projectId = intOrNull(b.project_id) || 0;
    try {
      const existing = await env.DB.prepare(
        'SELECT id FROM task_completion_subscriptions WHERE user_id = ? AND department = ? AND project_id = ?'
      ).bind(me.id, department, projectId).first();
      if (existing) {
        await env.DB.prepare('DELETE FROM task_completion_subscriptions WHERE id = ?').bind(existing.id).run();
        return json({ ok: true, subscribed: false });
      } else {
        await env.DB.prepare(
          'INSERT INTO task_completion_subscriptions (user_id, department, project_id) VALUES (?, ?, ?)'
        ).bind(me.id, department, projectId).run();
        return json({ ok: true, subscribed: true });
      }
    } catch (_) {
      try {
        await ensureTaskCompletionSubscriptionsSchema(env);
        const existing = await env.DB.prepare(
          'SELECT id FROM task_completion_subscriptions WHERE user_id = ? AND department = ? AND project_id = ?'
        ).bind(me.id, department, projectId).first();
        if (existing) {
          await env.DB.prepare('DELETE FROM task_completion_subscriptions WHERE id = ?').bind(existing.id).run();
          return json({ ok: true, subscribed: false });
        } else {
          await env.DB.prepare(
            'INSERT INTO task_completion_subscriptions (user_id, department, project_id) VALUES (?, ?, ?)'
          ).bind(me.id, department, projectId).run();
          return json({ ok: true, subscribed: true });
        }
      } catch (err) {
        return json({ error: 'Không thể cập nhật cài đặt thông báo' }, 500);
      }
    }
  }

  if (path === '/api/tasks/completion-subscriptions/save' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const projectIds = Array.isArray(b.project_ids) ? b.project_ids.map(Number).filter(id => id > 0) : [];
    const depts = Array.isArray(b.departments) ? b.departments.map(d => String(d || '').trim()).filter(Boolean) : [];
    try {
      await ensureTaskCompletionSubscriptionsSchema(env);

      await env.DB.prepare('DELETE FROM task_completion_subscriptions WHERE user_id = ?').bind(me.id).run();

      for (const dept of depts) {
        await env.DB.prepare('INSERT OR IGNORE INTO task_completion_subscriptions (user_id, department, project_id) VALUES (?, ?, 0)').bind(me.id, dept).run();
      }
      for (const pid of projectIds) {
        await env.DB.prepare('INSERT OR IGNORE INTO task_completion_subscriptions (user_id, department, project_id) VALUES (?, ?, ?)').bind(me.id, '', pid).run();
      }
      return json({ ok: true, count: projectIds.length + depts.length });
    } catch (err) {
      return json({ error: err.message || 'Không thể lưu cài đặt thông báo' }, 500);
    }
  }

  if (path === '/api/tasks' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    const assignee = url.searchParams.get('assignee');
    const assigner = url.searchParams.get('assigner');
    const taskStatus = url.searchParams.get('status');
    const dept = url.searchParams.get('department');
    const priority = url.searchParams.get('priority');
    const projectId = intOrNull(url.searchParams.get('project_id'));
    const groupId = intOrNull(url.searchParams.get('group_id'));
    const labelId = intOrNull(url.searchParams.get('label_id'));
    const search = String(url.searchParams.get('search') || '').trim();
    const createdFrom = url.searchParams.get('created_from');
    const createdTo = url.searchParams.get('created_to');
    const dueFrom = url.searchParams.get('due_from');
    const dueTo = url.searchParams.get('due_to');
    const requestedSort = url.searchParams.get('sort');
    const sort = requestedSort || 'created_at';
    const order = (url.searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let q = `SELECT t.*, u.full_name as assignee_name, u.employee_code as assignee_code, u.department as assignee_department,
                    u.avatar_color, u.avatar_initials, ab.full_name as assigner_name,
                    p.name as project_name, p.code as project_code, p.type as project_type, p.status as project_status,
                    g.name as group_name, g.position as group_position, g.color as group_color,
                    l.name as label_name, l.color as label_color_real,
                    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id) as subtask_total,
                    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id AND s.is_done=1) as subtask_done,
                    (SELECT COUNT(*) FROM task_followers f WHERE f.task_id=t.id) as follower_count
             FROM tasks t
             LEFT JOIN users u ON t.assigned_to=u.id
             LEFT JOIN users ab ON t.assigned_by=ab.id
             LEFT JOIN task_projects p ON t.team_project_id=p.id
             LEFT JOIN task_groups g ON t.group_id=g.id
             LEFT JOIN task_labels l ON t.label_id=l.id
             WHERE 1=1`;
    const binds = [];
    if (isAdmin || isHcns(me)) {
      // Admin sees all tasks; optional assignee filter
      if (assignee) { q += ' AND t.assigned_to=?'; binds.push(parseInt(assignee)); }
    } else {
      // Managers and employees only see tasks they are assigned to, created, or following
      q += ' AND (t.assigned_to=? OR t.assigned_by=? OR EXISTS (SELECT 1 FROM task_followers f WHERE f.task_id=t.id AND f.user_id=?))';
      binds.push(me.id, me.id, me.id);
      if (assignee) { q += ' AND t.assigned_to=?'; binds.push(parseInt(assignee)); }
    }
    if (date) { q += ' AND t.date=?'; binds.push(date); }
    if (taskStatus) { q += ' AND t.status=?'; binds.push(taskStatus); }
    if (dept) { q += ' AND (t.department=? OR u.department=?)'; binds.push(dept, dept); }
    if (assigner) { q += ' AND t.assigned_by=?'; binds.push(parseInt(assigner)); }
    if (priority) { q += ' AND t.priority=?'; binds.push(priority); }
    if (projectId) { q += ' AND t.team_project_id=?'; binds.push(projectId); }
    if (groupId) { q += ' AND t.group_id=?'; binds.push(groupId); }
    if (labelId) { q += ' AND t.label_id=?'; binds.push(labelId); }
    if (createdFrom) { q += ' AND date(t.created_at)>=date(?)'; binds.push(createdFrom); }
    if (createdTo) { q += ' AND date(t.created_at)<=date(?)'; binds.push(createdTo); }
    if (dueFrom) { q += ' AND date(t.due_date)>=date(?)'; binds.push(dueFrom); }
    if (dueTo) { q += ' AND date(t.due_date)<=date(?)'; binds.push(dueTo); }
    if (search) {
      q += ' AND (lower(t.title) LIKE ? OR lower(t.description) LIKE ? OR lower(u.full_name) LIKE ? OR lower(u.employee_code) LIKE ?)';
      const like = '%' + search.toLowerCase() + '%';
      binds.push(like, like, like, like);
    }
    const sortMap = { due_date: 't.due_date', created_at: 't.created_at', priority: "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END", updated_at: 't.updated_at' };
    if (projectId && !requestedSort) {
      // Prioritize explicit drag-and-drop position if set, then fallback to MyXteam import_position, then created_at DESC
      q += ' ORDER BY CASE WHEN t.position IS NOT NULL THEN 0 WHEN t.import_position IS NOT NULL THEN 1 ELSE 2 END ASC, t.position ASC, t.import_position ASC, t.created_at DESC';
    } else {
      q += ` ORDER BY ${sortMap[sort] || sortMap.created_at} ${order}`;
    }
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ tasks: results });
  }

  if (path === '/api/tasks/reorder' && request.method === 'POST') {
    const b = await request.json();
    const projectId = intOrNull(b.project_id);
    if (projectId && !(await canUseTaskProject(env, projectId, me))) {
      return json({ error: 'Không có quyền với Team/Project này' }, 403);
    }
    const statements = [];
    if (Array.isArray(b.moves) && b.moves.length > 0) {
      for (const move of b.moves) {
        const taskId = intOrNull(move.id || move.task_id);
        if (!taskId) continue;
        const groupId = move.group_id !== undefined ? intOrNull(move.group_id) : undefined;
        const pos = Number.isFinite(Number(move.position)) ? Number(move.position) : 0;
        if (groupId !== undefined) {
          statements.push(env.DB.prepare("UPDATE tasks SET group_id=?, position=?, updated_at=datetime('now') WHERE id=?").bind(groupId, pos, taskId));
        } else {
          statements.push(env.DB.prepare("UPDATE tasks SET position=?, updated_at=datetime('now') WHERE id=?").bind(pos, taskId));
        }
      }
    } else if (Array.isArray(b.task_ids) && b.task_ids.length > 0) {
      const groupId = b.group_id !== undefined ? intOrNull(b.group_id) : undefined;
      b.task_ids.forEach((taskIdRaw, index) => {
        const taskId = intOrNull(taskIdRaw);
        if (!taskId) return;
        const pos = index * 10;
        if (groupId !== undefined) {
          statements.push(env.DB.prepare("UPDATE tasks SET group_id=?, position=?, updated_at=datetime('now') WHERE id=?").bind(groupId, pos, taskId));
        } else {
          statements.push(env.DB.prepare("UPDATE tasks SET position=?, updated_at=datetime('now') WHERE id=?").bind(pos, taskId));
        }
      });
    }
    if (statements.length > 0) {
      await env.DB.batch(statements);
    }
    await broadcastAppEvent(env, 'tasks', 'task:reordered', {
      project_id: projectId,
      moves: b.moves || null,
      task_ids: b.task_ids || null,
      group_id: b.group_id !== undefined ? intOrNull(b.group_id) : null,
    }, { actorId: me.id });
    return json({ ok: true, updated: statements.length });
  }

  if (path === '/api/tasks' && request.method === 'POST') {
    // Allow all authenticated users to create tasks (not just managers)
    const b = await request.json();
    if (!b.title) return json({ error: 'Thiếu tiêu đề' }, 400);
    const status = b.status || 'todo';
    const priority = b.priority || 'normal';
    const projectId = intOrNull(b.team_project_id || b.project_id);
    const groupId = intOrNull(b.group_id);
    const labelId = intOrNull(b.label_id);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Team/Project nay' }, 403);
    if (groupId && !(await canUseTaskGroup(env, groupId, projectId, me))) return json({ error: 'Nhom cong viec khong hop le' }, 400);
    const label = await resolveTaskLabel(env, labelId, projectId);
    if (labelId && !label) return json({ error: 'Nhan cong viec khong hop le' }, 400);
    const labelColor = label ? label.color : taskLabelColor(status, priority, b.label_color);
    const r = await env.DB.prepare(
      'INSERT INTO tasks (title,description,assigned_to,assigned_by,department,date,due_date,status,priority,label_color,checkin_time,checkout_time,workspace_id,team_project_id,group_id,label_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)'
    ).bind(b.title,b.description||'',b.assigned_to||null,me.id,b.department||'',b.date||null,b.due_date||null,status,priority,labelColor,b.checkin_time||null,b.checkout_time||null,projectId,groupId,labelId).run();
    const taskId = r.meta.last_row_id;
    const assignee = await taskActivityAssignee(env, b.assigned_to);
    await recordTaskActivity(env, {
      taskId, projectId, user: me, action: 'task_created',
      entityType: 'task', entityId: taskId, entityTitle: b.title,
      assigneeId: assignee.id, assigneeName: assignee.name,
      detail: 'Tạo công việc: ' + b.title,
    });
    // Default followers: the owner (creator), the assignee, and all project
    // members. New tasks notify everyone in the project by default.
    const { results: projectMembers = [] } = projectId
      ? await env.DB.prepare('SELECT user_id FROM task_project_members WHERE project_id=?').bind(projectId).all()
      : { results: [] };
    const defaultFollowerIds = [...new Set(
      [Number(me.id), Number(b.assigned_to), ...projectMembers.map(m => Number(m.user_id))].filter(Boolean)
    )];
    for (const followerId of defaultFollowerIds) {
      const exists = await env.DB.prepare('SELECT id FROM task_followers WHERE task_id=? AND user_id=?').bind(taskId, followerId).first();
      if (!exists) await env.DB.prepare('INSERT INTO task_followers (task_id,user_id) VALUES (?,?)').bind(taskId, followerId).run();
    }
    await broadcastAppEvent(env, 'tasks', 'task:created', {
      id: taskId,
      title: b.title,
      description: b.description || '',
      status,
      priority,
      assigned_to: b.assigned_to || null,
      assigned_by: me.id,
      department: b.department || '',
      date: b.date || null,
      due_date: b.due_date || null,
      team_project_id: projectId,
      group_id: groupId,
      label_id: labelId,
      label_color: labelColor,
    }, { actorId: me.id });
    return json({ ok: true, id: taskId });
  }

  const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const tid = parseInt(taskMatch[1]);
    if (request.method === 'GET') {
      const task = await env.DB.prepare(
        `SELECT t.*, u.full_name as assignee_name, u.employee_code as assignee_code, u.department as assignee_department,
                u.avatar_color, u.avatar_initials, ab.full_name as assigner_name,
                p.name as project_name, p.code as project_code, p.type as project_type,
                g.name as group_name, g.position as group_position, g.color as group_color,
                l.name as label_name, l.color as label_color_real
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to=u.id
           LEFT JOIN users ab ON t.assigned_by=ab.id
           LEFT JOIN task_projects p ON t.team_project_id=p.id
           LEFT JOIN task_groups g ON t.group_id=g.id
           LEFT JOIN task_labels l ON t.label_id=l.id
          WHERE t.id=?`
      ).bind(tid).first();
      if (!task) return json({ error: 'Không tìm thấy' }, 404);
      // Access: only admins see all tasks; managers and employees can only see
      // tasks they are assigned to, created, or following
      if (!isAdmin && !isHcns(me)) {
        const myId = Number(me.id);
        const isInvolved = Number(task.assigned_to) === myId || Number(task.assigned_by) === myId;
        const follower = isInvolved ? null : await env.DB.prepare('SELECT id FROM task_followers WHERE task_id=? AND user_id=?').bind(tid, myId).first();
        if (!isInvolved && !follower) return json({ error: 'Không tìm thấy' }, 404);
      }
      const { results: subtasks } = await env.DB.prepare(
        'SELECT s.*, u.full_name as assignee_name FROM subtasks s LEFT JOIN users u ON s.assigned_to=u.id WHERE s.task_id=? ORDER BY s.id'
      ).bind(tid).all();
      const { results: followers } = await env.DB.prepare(
        'SELECT f.*, u.full_name, u.avatar_color, u.avatar_initials FROM task_followers f JOIN users u ON f.user_id=u.id WHERE f.task_id=?'
      ).bind(tid).all();
      return json({ task, subtasks, followers });
    }
    if (request.method === 'PUT') {
      const b = await request.json();
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(tid).first();
      if (!task) return json({ error: 'Không tìm thấy' }, 404);
      // Keep Task edit consistent with the UI editor rule (manager OR task assignee
      // OR task creator/assigner) and with Task DELETE below. The project-level gate
      // (canUseTaskProject) below still applies unmodified.
      if (!isManager && task.assigned_to !== me.id && task.assigned_by !== me.id) return json({ error: 'Không có quyền' }, 403);
      const nextStatus = b.status || task.status;
      const nextPriority = b.priority || task.priority;
      const nextProjectId = (b.team_project_id !== undefined || b.project_id !== undefined) ? intOrNull(b.team_project_id || b.project_id) : (task.team_project_id || null);
      const nextGroupId = b.group_id !== undefined ? intOrNull(b.group_id) : (task.group_id || null);
      const nextLabelId = b.label_id !== undefined ? intOrNull(b.label_id) : (task.label_id || null);
      if (!(await canUseTaskProject(env, nextProjectId, me))) return json({ error: 'Khong co quyen voi Team/Project nay' }, 403);
      if (nextGroupId && !(await canUseTaskGroup(env, nextGroupId, nextProjectId, me))) return json({ error: 'Nhom cong viec khong hop le' }, 400);
      const label = await resolveTaskLabel(env, nextLabelId, nextProjectId);
      if (nextLabelId && !label) return json({ error: 'Nhan cong viec khong hop le' }, 400);
      const nextColor = label ? label.color : taskLabelColor(nextStatus, nextPriority, b.label_color || task.label_color);
      const nextTitle = b.title || task.title;
      const nextAssigneeId = b.assigned_to ?? task.assigned_to;
      const nextPosition = b.position !== undefined ? (b.position === null ? null : Number(b.position)) : task.position;
      await env.DB.prepare(
        "UPDATE tasks SET title=?,description=?,assigned_to=?,department=?,date=?,due_date=?,status=?,priority=?,label_color=?,checkin_time=?,checkout_time=?,team_project_id=?,group_id=?,label_id=?,position=?,updated_at=datetime('now') WHERE id=?"
      ).bind(nextTitle,b.description??task.description,nextAssigneeId,b.department??task.department,b.date??task.date,b.due_date??task.due_date,nextStatus,nextPriority,nextColor,b.checkin_time??task.checkin_time,b.checkout_time??task.checkout_time,nextProjectId,nextGroupId,nextLabelId,nextPosition,tid).run();
      for (const followerId of [...new Set([Number(task.assigned_by), Number(nextAssigneeId)].filter(Boolean))]) {
        const exists = await env.DB.prepare('SELECT id FROM task_followers WHERE task_id=? AND user_id=?').bind(tid, followerId).first();
        if (!exists) await env.DB.prepare('INSERT INTO task_followers (task_id,user_id) VALUES (?,?)').bind(tid, followerId).run();
      }
      let activityAction = null;
      if (task.status !== nextStatus && nextStatus === 'done') {
        activityAction = 'task_completed';
        // Dispatch notifications to HR users subscribed to this department group or project
        try {
          const project = nextProjectId ? await env.DB.prepare('SELECT name, department FROM task_projects WHERE id=?').bind(nextProjectId).first() : null;
          const taskDept = b.department || task.department || project?.department || '';
          const projectName = project?.name || 'Dự án';
          const { results: subs = [] } = await env.DB.prepare(
            `SELECT DISTINCT user_id FROM task_completion_subscriptions
             WHERE (project_id = ? AND project_id > 0)
                OR (department = ? AND department != '')`
          ).bind(nextProjectId || 0, taskDept).all();

          const recipientIds = [...new Set(subs.map(s => Number(s.user_id)).filter(Boolean))];
          for (const subUserId of recipientIds) {
            await env.DB.prepare(
              `INSERT INTO task_mention_notifications (user_id, task_id, comment_id, mentioned_by, mentioned_by_name, task_title, comment_snippet)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              subUserId,
              tid,
              0,
              me.id,
              me.full_name || 'Hệ thống',
              nextTitle,
              `[Hoàn thành công việc] ${me.full_name || 'Nhân viên'} đã hoàn thành "${nextTitle}" trong nhóm "${taskDept || projectName}"`
            ).run();
          }

          if (recipientIds.length > 0) {
            await broadcastAppEvent(env, 'tasks', 'task:completed_notif', {
              taskId: tid,
              title: nextTitle,
              completedBy: me.full_name,
              department: taskDept,
              projectName: projectName,
            }, { targetUserIds: recipientIds });

            await sendWebPushNotification(env, recipientIds, {
              title: '✅ Công việc hoàn thành',
              body: `${me.full_name || 'Nhân viên'} đã hoàn thành: ${nextTitle} (${taskDept || projectName})`,
              icon: me.avatar_url || '/icon-192.png',
              badge: '/icon-192.png',
              url: `/#/tasks?project=${nextProjectId || ''}&task=${tid}`,
              tag: `task-done-${tid}`,
            }).catch(() => {});
          }
        } catch (notifErr) {
          console.error('Task completed notification error:', notifErr);
        }
      }
      if (task.status === 'done' && task.status !== nextStatus) activityAction = 'task_reopened';
      if (activityAction) {
        const assignee = await taskActivityAssignee(env, nextAssigneeId);
        await recordTaskActivity(env, {
          taskId: tid, projectId: nextProjectId, user: me, action: activityAction,
          entityType: 'task', entityId: tid, entityTitle: nextTitle,
          assigneeId: assignee.id, assigneeName: assignee.name,
          detail: `${activityAction === 'task_completed' ? 'Hoàn thành' : 'Mở lại'} công việc: ${nextTitle}`,
        });
      }
      await broadcastAppEvent(env, 'tasks', 'task:updated', {
        id: tid,
        title: nextTitle,
        description: b.description ?? task.description,
        status: nextStatus,
        priority: nextPriority,
        assigned_to: nextAssigneeId,
        department: b.department ?? task.department,
        date: b.date ?? task.date,
        due_date: b.due_date ?? task.due_date,
        team_project_id: nextProjectId,
        group_id: nextGroupId,
        label_id: nextLabelId,
        position: nextPosition,
        activity_action: activityAction,
      }, { actorId: me.id });
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isManager) {
        // Allow task creator/assignee to delete their own tasks
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(tid).first();
        if (!task || (task.assigned_to !== me.id && task.assigned_by !== me.id)) {
          return json({ error: 'Không có quyền' }, 403);
        }
      }
      await env.DB.prepare('DELETE FROM tasks WHERE id=?').bind(tid).run();
      await env.DB.prepare('DELETE FROM subtasks WHERE task_id=?').bind(tid).run();
      await env.DB.prepare('DELETE FROM task_comments WHERE task_id=?').bind(tid).run();
      // Retain timeline snapshots for auditability even when the task itself
      // is removed. New rows carry project_id and entity_title explicitly.
      await env.DB.prepare('DELETE FROM task_followers WHERE task_id=?').bind(tid).run();
      await broadcastAppEvent(env, 'tasks', 'task:deleted', { id: tid }, { actorId: me.id });
      return json({ ok: true });
    }
  }

  const subMatch = path.match(/^\/api\/tasks\/(\d+)\/subtasks$/);
  if (subMatch && request.method === 'POST') {
    const tid = parseInt(subMatch[1]);
    const b = await request.json();
    const parent = await env.DB.prepare('SELECT id,title,assigned_to,assigned_by,team_project_id FROM tasks WHERE id=?').bind(tid).first();
    if (!parent) return json({ error: 'Không tìm thấy công việc' }, 404);
    // Keep backend consistent with the Task editor rule exposed by the UI
    // (canEdit: manager OR task assignee OR task creator/assigner). Do NOT widen
    // this to project membership.
    if (!isManager && Number(parent.assigned_to) !== Number(me.id) && Number(parent.assigned_by) !== Number(me.id)) return json({ error: 'Không có quyền' }, 403);
    const title = String(b.title || '').trim();
    if (!title) return json({ error: 'Thiếu tiêu đề công việc con' }, 400);
    let r;
    try {
      r = await env.DB.prepare(
        'INSERT INTO subtasks (task_id,title,description,assigned_to,due_date) VALUES (?,?,?,?,?)'
      ).bind(tid, title, b.description||null, b.assigned_to||null, b.due_date||null).run();
    } catch (error) {
      // Log enough context for debugging without exposing tokens/session/stack
      // to the client. The outer wrapper still returns the generic reference error.
      console.error('Create subtask failed', { taskId: tid, userId: me.id, message: String(error?.message || error) });
      throw error;
    }
    const subtaskId = r.meta.last_row_id;
    const assignee = await taskActivityAssignee(env, b.assigned_to);
    await recordTaskActivity(env, {
      taskId: tid, projectId: parent.team_project_id, user: me, action: 'subtask_created',
      entityType: 'subtask', entityId: subtaskId, entityTitle: title,
      assigneeId: assignee.id, assigneeName: assignee.name,
      detail: `Tạo công việc con: ${title}`,
    });
    await broadcastAppEvent(env, 'tasks', 'subtask:created', {
      id: subtaskId,
      task_id: tid,
      title,
      description: b.description || null,
      assigned_to: b.assigned_to || null,
      due_date: b.due_date || null,
      is_done: 0,
    }, { actorId: me.id });
    return json({ ok: true, id: subtaskId });
  }

  const subtaskMatch = path.match(/^\/api\/subtasks\/(\d+)$/);
  if (subtaskMatch) {
    const sid = parseInt(subtaskMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      const subtask = await env.DB.prepare(
        `SELECT s.*,t.assigned_to AS task_assigned_to,t.assigned_by AS task_assigned_by,t.team_project_id,t.title AS parent_task_title,t.department AS task_department
           FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=?`
      ).bind(sid).first();
      if (!subtask) return json({ error: 'Không tìm thấy công việc con' }, 404);
      if (!isManager && Number(subtask.task_assigned_to) !== Number(me.id) && Number(subtask.task_assigned_by) !== Number(me.id)) return json({ error: 'Không có quyền' }, 403);
      const nextTitle = String(b.title ?? subtask.title).trim();
      if (!nextTitle) return json({ error: 'Thiếu tiêu đề công việc con' }, 400);
      const nextDone = b.is_done === undefined ? Number(subtask.is_done) : (b.is_done ? 1 : 0);
      const nextAssigneeId = b.assigned_to ?? subtask.assigned_to;
      await env.DB.prepare('UPDATE subtasks SET title=?,description=?,is_done=?,assigned_to=?,due_date=? WHERE id=?')
        .bind(nextTitle,b.description ?? subtask.description ?? null,nextDone,nextAssigneeId,b.due_date ?? subtask.due_date ?? null,sid).run();
      let activityAction = null;
      if (!Number(subtask.is_done) && nextDone) activityAction = 'subtask_completed';
      if (Number(subtask.is_done) && !nextDone) activityAction = 'subtask_reopened';
      if (activityAction) {
        const assignee = await taskActivityAssignee(env, nextAssigneeId);
        await recordTaskActivity(env, {
          taskId: subtask.task_id, projectId: subtask.team_project_id, user: me, action: activityAction,
          entityType: 'subtask', entityId: sid, entityTitle: nextTitle,
          assigneeId: assignee.id, assigneeName: assignee.name,
          detail: `${activityAction === 'subtask_completed' ? 'Hoàn thành' : 'Mở lại'} công việc con: ${nextTitle}`,
        });
      }
      if (activityAction === 'subtask_completed') {
        try {
          const project = subtask.team_project_id ? await env.DB.prepare('SELECT name, department FROM task_projects WHERE id=?').bind(subtask.team_project_id).first() : null;
          const taskDept = subtask.task_department || project?.department || '';
          const projectName = project?.name || 'Dự án';
          const parentTitle = subtask.parent_task_title || 'Công việc';
          const { results: subs = [] } = await env.DB.prepare(
            `SELECT DISTINCT user_id FROM task_completion_subscriptions
             WHERE (project_id = ? AND project_id > 0)
                OR (department = ? AND department != '')`
          ).bind(subtask.team_project_id || 0, taskDept).all();

          const recipientIds = [...new Set(subs.map(s => Number(s.user_id)).filter(Boolean))];
          for (const subUserId of recipientIds) {
            await env.DB.prepare(
              `INSERT INTO task_mention_notifications (user_id, task_id, comment_id, mentioned_by, mentioned_by_name, task_title, comment_snippet)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              subUserId,
              subtask.task_id,
              0,
              me.id,
              me.full_name || 'Hệ thống',
              nextTitle,
              `[Hoàn thành subtask] ${me.full_name || 'Nhân viên'} đã hoàn thành subtask "${nextTitle}" trong "${parentTitle}"`
            ).run();
          }

          if (recipientIds.length > 0) {
            await broadcastAppEvent(env, 'tasks', 'task:subtask_completed_notif', {
              taskId: subtask.task_id,
              subtaskId: sid,
              title: nextTitle,
              parentTitle,
              completedBy: me.full_name,
              department: taskDept,
              projectName: projectName,
            }, { targetUserIds: recipientIds });

            await sendWebPushNotification(env, recipientIds, {
              title: '✅ Subtask hoàn thành',
              body: `${me.full_name || 'Nhân viên'} đã hoàn thành subtask: ${nextTitle} (Task: ${parentTitle})`,
              icon: me.avatar_url || '/icon-192.png',
              badge: '/icon-192.png',
              url: `/#/tasks?project=${subtask.team_project_id || ''}&task=${subtask.task_id}`,
              tag: `subtask-done-${sid}`,
            }).catch(() => {});
          }
        } catch (subtaskNotifErr) {
          console.error('Subtask completed notification error:', subtaskNotifErr);
        }
      }
      await broadcastAppEvent(env, 'tasks', 'subtask:updated', {
        id: sid,
        task_id: subtask.task_id,
        title: nextTitle,
        description: b.description ?? subtask.description ?? null,
        is_done: nextDone,
        assigned_to: nextAssigneeId,
        due_date: b.due_date ?? subtask.due_date ?? null,
      }, { actorId: me.id });
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      const owner = await env.DB.prepare(
        `SELECT s.task_id, t.assigned_to AS task_assigned_to, t.assigned_by AS task_assigned_by
           FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=?`
      ).bind(sid).first();
      if (!owner) return json({ error: 'Không tìm thấy công việc con' }, 404);
      if (!isManager && Number(owner.task_assigned_to) !== Number(me.id) && Number(owner.task_assigned_by) !== Number(me.id)) {
        return json({ error: 'Không có quyền' }, 403);
      }
      await env.DB.prepare('DELETE FROM subtasks WHERE id=?').bind(sid).run();
      await broadcastAppEvent(env, 'tasks', 'subtask:deleted', { id: sid, task_id: owner.task_id }, { actorId: me.id });
      return json({ ok: true });
    }
  }

  const commentsMatch = path.match(/^\/api\/tasks\/(\d+)\/comments$/);
  if (commentsMatch) {
    const tid = parseInt(commentsMatch[1]);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT c.*, u.full_name, u.avatar_color, u.avatar_initials FROM task_comments c JOIN users u ON c.user_id=u.id WHERE c.task_id=? ORDER BY c.created_at'
      ).bind(tid).all();
      return json({ comments: results });
    }
    if (request.method === 'POST') {
      const b = await request.json();
      if (!b.content) return json({ error: 'Nội dung không được trống' }, 400);
      const mentions = Array.isArray(b.mentions) ? b.mentions : [];
      const r = await env.DB.prepare('INSERT INTO task_comments (task_id,user_id,content,mentions) VALUES (?,?,?,?)')
        .bind(tid, me.id, b.content, mentions.length ? JSON.stringify(mentions) : null).run();
      const commentId = r.meta.last_row_id;
      let taskTitle = '';
      // Create notifications for each mentioned user (skip self-mention)
      if (mentions.length) {
        const task = await env.DB.prepare('SELECT title FROM tasks WHERE id=?').bind(tid).first();
        taskTitle = task?.title || '';
        for (const m of mentions) {
          if (Number(m.user_id) === Number(me.id)) continue;
          await env.DB.prepare(
            'INSERT INTO task_mention_notifications (user_id,task_id,comment_id,mentioned_by,mentioned_by_name,task_title,comment_snippet) VALUES (?,?,?,?,?,?,?)'
          ).bind(m.user_id, tid, commentId, me.id, me.full_name || '', taskTitle, b.content.slice(0, 120)).run();
        }

        const targetMentionIds = mentions.map(m => Number(m.user_id)).filter(uid => uid && uid !== Number(me.id));
        if (targetMentionIds.length) {
          try {
            await sendWebPushNotification(env, targetMentionIds, {
              title: '🔔 ' + (taskTitle || 'Công việc mới'),
              body: `${me.full_name || 'Đồng nghiệp'} đã nhắc tên bạn: "${b.content.slice(0, 100)}"`,
              icon: me.avatar_url || '/icon-192.png',
              badge: '/icon-192.png',
              url: `/#/tasks?id=${tid}`,
              tag: `task-${tid}-${commentId || Date.now()}`,
            });
          } catch (err) {
            console.warn('Task mention push error:', err);
          }

          // Live notification event targeted to mentioned users
          await broadcastAppEvent(env, 'notifications', 'notification:mention', {
            id: commentId,
            type: 'task_mention',
            task_id: tid,
            task_title: taskTitle,
            mentioned_by: me.id,
            mentioned_by_name: me.full_name || '',
            snippet: b.content.slice(0, 120),
          }, { actorId: me.id, targetUserIds: targetMentionIds });
        }
      }

      // Broadcast comment creation to task watchers / subscribers
      await broadcastAppEvent(env, 'tasks', 'comment:created', {
        id: commentId,
        task_id: tid,
        user_id: me.id,
        full_name: me.full_name,
        avatar_color: me.avatar_color,
        avatar_initials: me.avatar_initials,
        content: b.content,
        mentions,
        created_at: new Date().toISOString(),
      }, { actorId: me.id });

      return json({ ok: true, id: commentId });
    }
  }

  // ── Task attachments ──────────────────────────────────────────────
  const attachMatch = path.match(/^\/api\/tasks\/(\d+)\/attachments(?:\/(\d+))?$/);
  if (attachMatch) {
    const tid = parseInt(attachMatch[1]);
    const attachmentId = attachMatch[2] ? parseInt(attachMatch[2]) : null;
    const task = await env.DB.prepare('SELECT id,team_project_id FROM tasks WHERE id=?').bind(tid).first();
    if (!task || !(await canUseTaskProject(env, task.team_project_id, me))) return json({ error: 'Không có quyền với công việc này' }, 403);

    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM task_attachments WHERE task_id=? ORDER BY created_at'
      ).bind(tid).all();
      return json({ attachments: results });
    }

    if (request.method === 'POST') {
      if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ tài liệu chưa được cấu hình' }, 503);
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!file || typeof file.stream !== 'function') return json({ error: 'Vui lòng chọn tệp đính kèm' }, 400);
      const MAX_BYTES = 10 * 1024 * 1024;
      if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_BYTES) return json({ error: 'Tệp vượt quá 10 MB' }, 400);
      const bytes = await file.arrayBuffer();
      const contentType = String(file.type || 'application/octet-stream');
      const timestamp = Date.now();
      const safeName = safeDownloadName(file.name);
      const storageKey = `task/${tid}/${timestamp}_${safeName}`;
      await env.HR_DOCUMENTS.put(storageKey, bytes, {
        httpMetadata: { contentType, cacheControl: 'private, no-store' },
        customMetadata: { task_id: String(tid), user_id: String(me.id) },
      });
      await env.DB.prepare(
        'INSERT INTO task_attachments (task_id,user_id,original_filename,content_type,byte_size,storage_key) VALUES (?,?,?,?,?,?)'
      ).bind(tid, me.id, safeName, contentType, file.size, storageKey).run();
      return json({ ok: true });
    }

    if (request.method === 'DELETE' && attachmentId) {
      const doc = await env.DB.prepare('SELECT * FROM task_attachments WHERE id=? AND task_id=?').bind(attachmentId, tid).first();
      if (!doc) return json({ error: 'Tập tin không tồn tại' }, 404);
      await env.HR_DOCUMENTS.delete(doc.storage_key).catch(() => {});
      await env.DB.prepare('DELETE FROM task_attachments WHERE id=?').bind(attachmentId).run();
      return json({ ok: true });
    }
  }

  const followMatch = path.match(/^\/api\/tasks\/(\d+)\/followers$/);
  if (followMatch && request.method === 'POST') {
    const tid = parseInt(followMatch[1]);
    const b = await request.json();
    const task = await env.DB.prepare('SELECT id,assigned_by,team_project_id FROM tasks WHERE id=?').bind(tid).first();
    if (!task || !(await canUseTaskProject(env, task.team_project_id, me))) return json({ error: 'Không có quyền với công việc này' }, 403);
    const uid2 = Number(b.user_id || me.id);
    const canManageFollowers = isTaskAdmin(me) || Number(task.assigned_by) === Number(me.id);
    if (uid2 !== Number(me.id) && !canManageFollowers) return json({ error: 'Không có quyền thêm người theo dõi' }, 403);
    const target = await env.DB.prepare('SELECT id FROM users WHERE id=? AND is_active=1').bind(uid2).first();
    if (!target) return json({ error: 'Không tìm thấy nhân sự hợp lệ' }, 404);
    const existingF = await env.DB.prepare('SELECT id FROM task_followers WHERE task_id=? AND user_id=?')
      .bind(tid, uid2).first();
    if (!existingF) {
      await env.DB.prepare('INSERT INTO task_followers (task_id,user_id) VALUES (?,?)').bind(tid, uid2).run();
    }
    await broadcastAppEvent(env, 'tasks', 'task:follower_added', { task_id: tid, user_id: uid2 }, { actorId: me.id });
    return json({ ok: true });
  }
  const followerDeleteMatch = path.match(/^\/api\/tasks\/(\d+)\/followers\/(\d+)$/);
  if (followerDeleteMatch && request.method === 'DELETE') {
    const tid = Number(followerDeleteMatch[1]), followerId = Number(followerDeleteMatch[2]);
    const task = await env.DB.prepare('SELECT id,assigned_by,team_project_id FROM tasks WHERE id=?').bind(tid).first();
    if (!task || !(await canUseTaskProject(env, task.team_project_id, me))) return json({ error: 'Không có quyền với công việc này' }, 403);
    const canManageFollowers = isTaskAdmin(me) || Number(task.assigned_by) === Number(me.id);
    if (followerId !== Number(me.id) && !canManageFollowers) return json({ error: 'Không có quyền bỏ người theo dõi' }, 403);
    await env.DB.prepare('DELETE FROM task_followers WHERE task_id=? AND user_id=?').bind(tid, followerId).run();
    await broadcastAppEvent(env, 'tasks', 'task:follower_removed', { task_id: tid, user_id: followerId }, { actorId: me.id });
    return json({ ok: true });
  }
  return null;
}
