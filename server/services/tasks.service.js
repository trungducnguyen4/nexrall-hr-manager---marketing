/**
 * Tasks & Kanban Service
 * Handles task management, subtasks, projects, groups, activity timeline, MyXteam import, and follower synchronization.
 */

import { normalizeVietnameseSearch } from '../lib/string.js';

export function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function taskLabelColor(status, priority, provided) {
  if (provided) return provided;
  if (priority === 'urgent') return '#EF4444';
  if (priority === 'high') return '#F59E0B';
  if (status === 'done') return '#10B981';
  if (status === 'review') return '#8B5CF6';
  if (status === 'in-progress') return '#3B82F6';
  if (status === 'cancelled') return '#64748B';
  return '#6366F1';
}

export function isTaskAdmin(u) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  const dept = String(u.department || '').trim().toLowerCase();
  return dept === 'phòng hcns' || dept === 'hcns' || dept === 'hành chính nhân sự';
}

export async function canUseTaskProject(env, projectId, me) {
  if (!projectId) return true;
  if (isTaskAdmin(me)) return true;
  const row = await env.DB.prepare(
    `SELECT p.id
       FROM task_projects p
      WHERE p.id=?
        AND (
          p.manager_id=?
          OR EXISTS (
            SELECT 1 FROM task_project_members m WHERE m.project_id=p.id AND m.user_id=?
          )
        )`
  ).bind(projectId, me.id, me.id).first();
  return !!row;
}

export async function canUseTaskGroup(env, groupId, projectId, me) {
  if (!groupId) return true;
  const group = await env.DB.prepare('SELECT * FROM task_groups WHERE id=? AND project_id=? AND is_archived=0')
    .bind(groupId, projectId || 0).first();
  if (!group) return false;
  return canUseTaskProject(env, group.project_id, me);
}

export async function taskActivityAssignee(env, id) {
  if (!id) return { id: null, name: null };
  const user = await env.DB.prepare('SELECT id,full_name FROM users WHERE id=?').bind(id).first();
  return { id, name: user?.full_name || null };
}

export async function recordTaskActivity(env, {
  taskId, projectId, user, action, entityType, entityId, entityTitle,
  assigneeId = null, assigneeName = null, detail = null,
}) {
  await env.DB.prepare(
    `INSERT INTO task_activity
      (task_id,user_id,action,detail,project_id,entity_type,entity_id,entity_title,assignee_id,assignee_name,actor_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    taskId, user.id, action, detail, intOrNull(projectId), entityType,
    intOrNull(entityId), String(entityTitle || '').trim() || null,
    intOrNull(assigneeId), assigneeName || null, user.full_name || null,
  ).run();
}

export async function resolveTaskLabel(env, labelId, projectId) {
  if (!labelId) return null;
  return await env.DB.prepare(
    'SELECT * FROM task_labels WHERE id=? AND (project_id IS NULL OR project_id=?)'
  ).bind(labelId, projectId || 0).first();
}

export async function ensureDefaultTaskGroup(env, projectId, userId = null) {
  const existing = await env.DB.prepare(
    "SELECT * FROM task_groups WHERE project_id=? AND is_archived=0 ORDER BY position,id LIMIT 1"
  ).bind(projectId).first();
  if (existing) return existing;
  const r = await env.DB.prepare(
    "INSERT INTO task_groups (project_id,name,position,color,created_by) VALUES (?,?,?,?,?)"
  ).bind(projectId, 'Công việc chung', 0, '#6366F1', userId).run();
  return await env.DB.prepare('SELECT * FROM task_groups WHERE id=?').bind(r.meta.last_row_id).first();
}

export async function resolveThuytttUser(env) {
  try {
    const user = await env.DB.prepare(
      `SELECT id, employee_code, full_name, email FROM users 
       WHERE UPPER(employee_code) IN ('THUYTTT', 'THUYDT') 
          OR email LIKE 'thuyttt%' 
          OR email = 'thuydt@netviet.com.vn'
       ORDER BY 
         CASE 
           WHEN UPPER(employee_code) = 'THUYTTT' THEN 0 
           WHEN email LIKE 'thuyttt%' THEN 1
           WHEN UPPER(employee_code) = 'THUYDT' THEN 2 
           ELSE 3 
         END 
       LIMIT 1`
    ).first();
    if (user && user.id) return user;
  } catch (err) {
    console.error('Error resolving THUYTTT user:', err);
  }
  return { id: 531, employee_code: 'THUYTTT', full_name: 'Trần Thị Thanh Thúy' };
}

export async function resolveHaunvUser(env) {
  try {
    const user = await env.DB.prepare(
      `SELECT id, employee_code, full_name, email FROM users 
       WHERE UPPER(employee_code) = 'HAUNV' 
          OR email = 'haunguyen.me@gmail.com'
          OR email LIKE 'haunv%'
       LIMIT 1`
    ).first();
    if (user && user.id) return user;
  } catch (err) {
    console.error('Error resolving HAUNV user:', err);
  }
  return { id: 528, employee_code: 'HAUNV', full_name: 'Nguyễn Văn Hậu' };
}

export async function syncThuytttFollowerToAllProjectsAndTasks(env) {
  try {
    const supervisors = await env.DB.prepare(
      "SELECT id, employee_code FROM users WHERE UPPER(employee_code) IN ('HAUNV', 'THUYTTT', 'THUYDT') OR email IN ('haunguyen.me@gmail.com', 'thuydt@netviet.com.vn') OR email LIKE 'thuyttt%' OR email LIKE 'haunv%'"
    ).all();
    const supervisorIds = new Set((supervisors?.results || []).map(r => Number(r.id)).filter(Boolean));
    supervisorIds.add(528);
    supervisorIds.add(531);

    for (const sId of supervisorIds) {
      try {
        await env.DB.prepare(`
          INSERT INTO task_project_members (project_id, user_id, role, added_by)
          SELECT p.id, ?, 'member', 1
          FROM task_projects p
          WHERE NOT EXISTS (
            SELECT 1 FROM task_project_members m WHERE m.project_id = p.id AND m.user_id = ?
          )
        `).bind(sId, sId).run();
      } catch (_) {}

      try {
        await env.DB.prepare(`
          INSERT INTO task_followers (task_id, user_id)
          SELECT t.id, ?
          FROM tasks t
          WHERE NOT EXISTS (
            SELECT 1 FROM task_followers f WHERE f.task_id = t.id AND f.user_id = ?
          )
        `).bind(sId, sId).run();
      } catch (_) {}
    }

    return { ok: true, syncedIds: Array.from(supervisorIds) };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export async function ensureEmployeePersonalProject(env, user, actorId = 1) {
  if (!user || !user.id || !user.full_name) return null;
  const name = String(user.full_name).trim();
  if (!name) return null;

  let project = await env.DB.prepare(
    "SELECT id, name, department, manager_id FROM task_projects WHERE manager_id = ? OR (name = ? AND department = ?) LIMIT 1"
  ).bind(user.id, name, name).first();

  let projectId;
  if (!project) {
    const code = String(user.employee_code || '').trim();
    const r = await env.DB.prepare(
      `INSERT INTO task_projects (workspace_id, name, code, type, description, department, manager_id, status, created_by, updated_at)
       VALUES (1, ?, ?, 'project', 'Không gian công việc cá nhân', ?, ?, 'active', ?, datetime('now','localtime'))`
    ).bind(name, code, name, user.id, actorId || 1).run();
    projectId = r.meta.last_row_id;
  } else {
    projectId = project.id;
    if (!project.manager_id || Number(project.manager_id) !== Number(user.id)) {
      await env.DB.prepare("UPDATE task_projects SET manager_id = ? WHERE id = ?").bind(user.id, projectId).run();
    }
  }

  await ensureDefaultTaskGroup(env, projectId, actorId || 1);

  const supervisors = await env.DB.prepare(
    "SELECT id FROM users WHERE UPPER(employee_code) IN ('HAUNV', 'THUYTTT', 'THUYDT') OR email IN ('haunguyen.me@gmail.com', 'thuydt@netviet.com.vn') OR email LIKE 'thuyttt%' OR email LIKE 'haunv%'"
  ).all();
  const supervisorIds = new Set((supervisors?.results || []).map(r => Number(r.id)).filter(Boolean));
  if (!supervisorIds.has(528)) supervisorIds.add(528);
  if (!supervisorIds.has(531)) supervisorIds.add(531);

  const targetMembers = [
    { id: Number(user.id), role: 'owner' }
  ];
  for (const sId of supervisorIds) {
    if (sId !== Number(user.id)) {
      targetMembers.push({ id: sId, role: 'member' });
    }
  }

  for (const m of targetMembers) {
    if (m.id) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO task_project_members (project_id, user_id, role, added_by) VALUES (?, ?, ?, ?)"
      ).bind(projectId, m.id, m.role, actorId || 1).run();
    }
  }

  return projectId;
}

export async function ensureTaskActivityTimelineSchema(env) {
  for (const [column, type] of Object.entries({
    project_id: 'INTEGER',
    entity_type: 'TEXT',
    entity_id: 'INTEGER',
    entity_title: 'TEXT',
    assignee_id: 'INTEGER',
    assignee_name: 'TEXT',
    actor_name: 'TEXT',
  })) {
    try { await env.DB.exec(`ALTER TABLE task_activity ADD COLUMN ${column} ${type}`); } catch (_) {}
  }
  try {
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_activity_project_created ON task_activity(project_id,created_at DESC,id DESC)');
  } catch (_) {}
}

export async function ensureSubtaskSchema(env) {
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      is_done INTEGER DEFAULT 0,
      assigned_to INTEGER,
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
  } catch (error) {
    console.error('subtasks table create failed', error);
  }

  const columns = [
    { name: 'description', type: 'TEXT' },
    { name: 'assigned_to', type: 'INTEGER' },
    { name: 'due_date', type: 'TEXT' },
    { name: 'is_done', type: 'INTEGER DEFAULT 0' },
    { name: 'updated_at', type: "TEXT DEFAULT (datetime('now','localtime'))" },
  ];

  for (const col of columns) {
    try {
      await env.DB.prepare(`ALTER TABLE subtasks ADD COLUMN ${col.name} ${col.type}`).run();
    } catch (_) {
      // Column already exists - expected on self-healing retry
    }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_subtasks_task_done ON subtasks(task_id, is_done)',
    'CREATE INDEX IF NOT EXISTS idx_subtasks_assigned ON subtasks(assigned_to)',
  ];

  for (const sql of indexes) {
    try {
      await env.DB.prepare(sql).run();
    } catch (_) {
      // Index already exists
    }
  }
}

export async function ensureTaskCompletionSubscriptionsSchema(env) {
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS task_completion_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, department TEXT DEFAULT \'\', project_id INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))'
    ).run();
  } catch (error) {
    console.error('task_completion_subscriptions table create failed', error);
  }
  try {
    await env.DB.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_task_comp_sub ON task_completion_subscriptions(user_id, department, project_id)'
    ).run();
  } catch (error) {
    console.error('task_completion_subscriptions index create failed', error);
  }
}

export async function ensureMyxteamTaskImportSchema(env) {
  const statements = [
    'ALTER TABLE task_projects ADD COLUMN external_source TEXT',
    'ALTER TABLE task_projects ADD COLUMN external_id TEXT',
    'ALTER TABLE task_groups ADD COLUMN external_source TEXT',
    'ALTER TABLE task_groups ADD COLUMN external_id TEXT',
    'ALTER TABLE tasks ADD COLUMN external_source TEXT',
    'ALTER TABLE tasks ADD COLUMN external_id TEXT',
    'ALTER TABLE tasks ADD COLUMN external_metadata TEXT',
    'ALTER TABLE tasks ADD COLUMN import_position INTEGER',
    'ALTER TABLE tasks ADD COLUMN position REAL',
    'ALTER TABLE subtasks ADD COLUMN external_source TEXT',
    'ALTER TABLE subtasks ADD COLUMN external_id TEXT',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_projects_external ON task_projects(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_task_groups_external ON task_groups(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_subtasks_external ON subtasks(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL",
  ];
  for (const sql of statements) {
    try { await env.DB.exec(sql); } catch (_) {}
  }
}

export function myxteamExternalId(value) {
  return String(value ?? '').trim().slice(0, 120);
}

export function myxteamParseDate(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
    const m = val.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (m && m[3]) {
      const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      return `${String(year).padStart(4, '0')}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    }
  }
  return null;
}

export function myxteamDateRange(value) {
  const text = String(value || '');
  const match = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*-\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?/);
  const namedDate = text.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/i);
  if (!match && !namedDate) return { date: null, dueDate: null };
  const iso = (day, month, year) => {
    const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
    return `${String(fullYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  if (namedDate) {
    const date = iso(namedDate[1], namedDate[2], namedDate[3]);
    return { date, dueDate: date };
  }
  if (!match[3] && !match[4]) return { date: null, dueDate: null };
  const defaultYear = new Date().getUTCFullYear();
  const firstYear = match[3] || defaultYear;
  const date = iso(match[1], match[2], firstYear);
  const dueDate = match[4] ? iso(match[4], match[5], match[6] || firstYear) : date;
  return { date, dueDate };
}

export function myxteamDescription(task) {
  const fields = [task.description, task.desc, task.detail, task.content, task.note, task.body];
  for (const f of fields) {
    if (typeof f === 'string' && f.trim()) return f.trim();
  }
  if (typeof task.text === 'string' && task.text.trim()) {
    const text = task.text.trim();
    if (!/^\d{1,2}\/\d{1,2}(\/\d{2,4})?(\s*-\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?)?$/.test(text) &&
        !/^\d+\/\d+$/.test(text) &&
        !/^ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}$/i.test(text)) {
      return text;
    }
  }
  return '';
}

export function myxteamSubtasks(task) {
  const list = [];
  const candidates = [
    task.checklists,
    task.checklist,
    task.subtasks,
    task.sub_tasks,
    task.todos,
    task.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      for (const item of c) {
        if (!item) continue;
        if (Array.isArray(item.items)) {
          for (const subItem of item.items) {
            if (subItem) list.push(subItem);
          }
        } else if (typeof item === 'string' && item.trim()) {
          list.push({ name: item.trim() });
        } else if (typeof item === 'object') {
          list.push(item);
        }
      }
    }
  }
  return list;
}

export function myxteamPersonKey(value) {
  return normalizeVietnameseSearch(String(value || '')
    .replace(/\(deleted\)/ig, '')
    .replace(/\s+/g, ' ')
    .trim());
}

export async function importMyxteamProject(env, me, payload) {
  await ensureMyxteamTaskImportSchema(env);
  const source = 'myxteam';
  const externalId = myxteamExternalId(payload?.id);
  const name = String(payload?.name || payload?.title || '').trim().slice(0, 500);
  const department = String(payload?.team || 'MyXteam').trim().slice(0, 255) || 'MyXteam';
  const sourceGroups = Array.isArray(payload?.groups) ? payload.groups.slice(0, 500) : [];
  if (!externalId || !name) throw new Error('Project MyXteam thiếu ID hoặc tên');

  const projectInsert = await env.DB.prepare(
    `INSERT OR IGNORE INTO task_projects
      (workspace_id,name,code,type,description,department,manager_id,status,created_by,external_source,external_id)
     VALUES (1,?,?,?,?,?,?,?, ?,?,?)`
  ).bind(
    name, '', 'project',
    `Dữ liệu được nhập an toàn từ MyXteam (Project ${externalId}).`,
    department, me.id, 'active', me.id, source, externalId,
  ).run();
  const project = await env.DB.prepare(
    'SELECT id FROM task_projects WHERE external_source=? AND external_id=? LIMIT 1'
  ).bind(source, externalId).first();
  if (!project) throw new Error('Không thể tạo hoặc nhận diện Project đã nhập');

  const memberExists = await env.DB.prepare(
    'SELECT id FROM task_project_members WHERE project_id=? AND user_id=? LIMIT 1'
  ).bind(project.id, me.id).first();
  if (!memberExists) {
    await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
      .bind(project.id, me.id, 'owner', me.id).run();
  }

  let createdGroups = 0;
  for (let index = 0; index < sourceGroups.length; index += 1) {
    const group = sourceGroups[index] || {};
    const groupExternalId = myxteamExternalId(group.externalId || `${externalId}:group:${index}`);
    const groupName = String(group.name || `Nhóm công việc ${index + 1}`).trim().slice(0, 500);
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO task_groups
        (project_id,name,position,color,is_archived,created_by,external_source,external_id)
       VALUES (?,?,?,?,0,?,?,?)`
    ).bind(project.id, groupName, index, '#EEF2FF', me.id, source, groupExternalId).run();
    createdGroups += Number(result?.meta?.changes || 0);
  }

  const { results: importedGroups = [] } = await env.DB.prepare(
    'SELECT id,external_id FROM task_groups WHERE project_id=? AND external_source=?'
  ).bind(project.id, source).all();
  const groupIds = new Map(importedGroups.map(group => [String(group.external_id), Number(group.id)]));
  const { results: activeUsers = [] } = await env.DB.prepare(
    'SELECT id,full_name FROM users WHERE COALESCE(is_active,1)=1'
  ).all();
  const usersByName = new Map();
  for (const user of activeUsers) {
    const key = myxteamPersonKey(user.full_name);
    if (key && !usersByName.has(key)) usersByName.set(key, user);
  }

  const taskStatements = [];
  const taskBackfillStatements = [];
  const matchedMemberIds = new Set([Number(me.id)]);
  const unmatchedNames = new Set();
  let suppliedTasks = 0;
  for (let groupIndex = 0; groupIndex < sourceGroups.length; groupIndex += 1) {
    const sourceGroup = sourceGroups[groupIndex] || {};
    const groupExternalId = myxteamExternalId(sourceGroup.externalId || `${externalId}:group:${groupIndex}`);
    const groupId = groupIds.get(groupExternalId);
    if (!groupId) continue;
    const sourceTasks = Array.isArray(sourceGroup.tasks) ? sourceGroup.tasks.slice(0, 2000) : [];
    for (let taskIndex = 0; taskIndex < sourceTasks.length; taskIndex += 1) {
      const task = sourceTasks[taskIndex] || {};
      const taskExternalId = myxteamExternalId(task.externalId || `${groupExternalId}:task:${taskIndex}`);
      const title = String(task.name || task.title || '').trim().slice(0, 1000);
      if (!taskExternalId || !title) continue;
      suppliedTasks += 1;
      const assigneeNames = Array.isArray(task.assignees) ? task.assignees.map(String) : (task.assignee ? [String(task.assignee)] : []);
      let assigneeId = null;
      for (const assigneeName of assigneeNames) {
        const key = myxteamPersonKey(assigneeName);
        if (!key || key === 'netviet tv' || /deleted/i.test(assigneeName)) continue;
        const user = usersByName.get(key);
        if (user) {
          matchedMemberIds.add(Number(user.id));
          if (!assigneeId) assigneeId = Number(user.id);
        } else {
          unmatchedNames.add(String(assigneeName).trim());
        }
      }
      const range = myxteamDateRange(task.text);
      const description = myxteamDescription(task);
      const metadata = JSON.stringify({
        source: 'MyXteam', project_id: externalId, group_id: groupExternalId,
        pinned: !!task.pinned, source_text: String(task.text || '').slice(0, 4000), assignees: assigneeNames.slice(0, 50),
      });

      taskStatements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO tasks
          (title,description,assigned_to,assigned_by,department,date,due_date,status,priority,label_color,
           workspace_id,team_project_id,group_id,external_source,external_id,external_metadata,import_position)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`
      ).bind(
        title, description, assigneeId, me.id, department, range.date, range.dueDate,
        task.done ? 'done' : 'todo', 'normal', task.done ? '#10B981' : '#6366F1',
        project.id, groupId, source, taskExternalId, metadata, taskIndex,
      ));
      if (description) {
        taskBackfillStatements.push(env.DB.prepare(
          `UPDATE tasks SET description=CASE WHEN description IS NULL OR description='' THEN ? ELSE description END
            WHERE external_source=? AND external_id=?`
        ).bind(description, source, taskExternalId));
      }
      if (range.date || range.dueDate) {
        taskBackfillStatements.push(env.DB.prepare(
          `UPDATE tasks SET date=COALESCE(date,?),due_date=COALESCE(due_date,?)
            WHERE external_source=? AND external_id=?`
        ).bind(range.date, range.dueDate, source, taskExternalId));
      }
    }
  }

  let createdTasks = 0;
  for (let offset = 0; offset < taskStatements.length; offset += 50) {
    const results = await env.DB.batch(taskStatements.slice(offset, offset + 50));
    createdTasks += results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
  }
  for (let offset = 0; offset < taskBackfillStatements.length; offset += 50) {
    await env.DB.batch(taskBackfillStatements.slice(offset, offset + 50));
  }

  const { results: importedTasks = [] } = await env.DB.prepare(
    'SELECT id,external_id FROM tasks WHERE team_project_id=? AND external_source=?'
  ).bind(project.id, source).all();
  const tasksByExternalId = new Map(importedTasks.map(t => [String(t.external_id), Number(t.id)]));

  const subtaskStatements = [];
  const subtaskBackfillStatements = [];
  let suppliedSubtasks = 0;

  for (let groupIndex = 0; groupIndex < sourceGroups.length; groupIndex += 1) {
    const sourceGroup = sourceGroups[groupIndex] || {};
    const groupExternalId = myxteamExternalId(sourceGroup.externalId || `${externalId}:group:${groupIndex}`);
    const sourceTasks = Array.isArray(sourceGroup.tasks) ? sourceGroup.tasks.slice(0, 2000) : [];
    for (let taskIndex = 0; taskIndex < sourceTasks.length; taskIndex += 1) {
      const task = sourceTasks[taskIndex] || {};
      const taskExternalId = myxteamExternalId(task.externalId || `${groupExternalId}:task:${taskIndex}`);
      const taskId = tasksByExternalId.get(taskExternalId);
      if (!taskId) continue;

      const rawSubtasks = myxteamSubtasks(task);
      for (let subIndex = 0; subIndex < rawSubtasks.length; subIndex += 1) {
        const sub = rawSubtasks[subIndex] || {};
        const subTitle = String(sub.name || sub.title || sub.text || sub.content || '').trim().slice(0, 1000);
        if (!subTitle) continue;
        suppliedSubtasks += 1;
        const subExternalId = myxteamExternalId(sub.externalId || sub.id || `${taskExternalId}:sub:${subIndex}`);
        const subDesc = String(sub.description || sub.desc || sub.detail || '').trim();
        const isDone = (sub.done || sub.is_done || sub.completed || sub.status === 'done') ? 1 : 0;
        
        let subAssigneeId = null;
        const subAssignees = Array.isArray(sub.assignees) ? sub.assignees : (sub.assignee ? [sub.assignee] : (sub.assigned_to ? [sub.assigned_to] : []));
        for (const sa of subAssignees) {
          const saName = typeof sa === 'string' ? sa : (sa?.name || sa?.full_name || '');
          const key = myxteamPersonKey(saName);
          if (!key || key === 'netviet tv' || /deleted/i.test(key)) continue;
          const user = usersByName.get(key);
          if (user) {
            matchedMemberIds.add(Number(user.id));
            subAssigneeId = Number(user.id);
            break;
          }
        }
        const subDueDate = myxteamParseDate(sub.due_date || sub.dueDate || sub.due || sub.date);

        subtaskStatements.push(env.DB.prepare(
          `INSERT OR IGNORE INTO subtasks
            (task_id,title,description,is_done,assigned_to,due_date,external_source,external_id)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(taskId, subTitle, subDesc, isDone, subAssigneeId, subDueDate, source, subExternalId));

        if (subDesc) {
          subtaskBackfillStatements.push(env.DB.prepare(
            `UPDATE subtasks SET description=CASE WHEN description IS NULL OR description='' THEN ? ELSE description END
              WHERE external_source=? AND external_id=?`
          ).bind(subDesc, source, subExternalId));
        }
        if (subDueDate) {
          subtaskBackfillStatements.push(env.DB.prepare(
            `UPDATE subtasks SET due_date=COALESCE(due_date,?)
              WHERE external_source=? AND external_id=?`
          ).bind(subDueDate, source, subExternalId));
        }
      }
    }
  }

  let createdSubtasks = 0;
  for (let offset = 0; offset < subtaskStatements.length; offset += 50) {
    const results = await env.DB.batch(subtaskStatements.slice(offset, offset + 50));
    createdSubtasks += results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
  }
  for (let offset = 0; offset < subtaskBackfillStatements.length; offset += 50) {
    await env.DB.batch(subtaskBackfillStatements.slice(offset, offset + 50));
  }

  for (const userId of matchedMemberIds) {
    const exists = await env.DB.prepare(
      'SELECT id FROM task_project_members WHERE project_id=? AND user_id=? LIMIT 1'
    ).bind(project.id, userId).first();
    if (!exists) {
      await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
        .bind(project.id, userId, userId === Number(me.id) ? 'owner' : 'member', me.id).run();
    }
  }
  await env.DB.prepare("UPDATE task_projects SET updated_at=datetime('now','localtime') WHERE id=?").bind(project.id).run();
  return {
    project_id: project.id,
    project_created: Number(projectInsert?.meta?.changes || 0),
    groups_created: createdGroups,
    tasks_created: createdTasks,
    tasks_skipped: Math.max(0, suppliedTasks - createdTasks),
    subtasks_created: createdSubtasks,
    subtasks_supplied: suppliedSubtasks,
    matched_members: matchedMemberIds.size,
    unmatched_assignees: [...unmatchedNames].filter(Boolean).slice(0, 100),
  };
}

export async function normalizeDefaultTaskGroupNames(env) {
  await env.DB.prepare(
    "UPDATE task_groups SET name='Công việc chung' WHERE lower(trim(name))='cong viec chung'"
  ).run();
}
