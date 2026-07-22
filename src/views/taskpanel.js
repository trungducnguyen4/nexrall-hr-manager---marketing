import { api } from '../api.js';
import { esc, taskStatusBadge, priorityBadge, toast, loadingHTML, openModal, closeModal } from '../utils.js';
import { openTaskForm, sanitizeRichText } from './tasks.js';

let _currentTaskId = null;
let _users = [];
let _me = null;

export async function openPanel(taskId, me) {
  _currentTaskId = taskId;
  _me = me;
  try { _users = (await api.getUsers()).users || []; } catch (_) {}

  const overlay = document.getElementById('task-panel-overlay');
  const panel = document.getElementById('task-panel');
  overlay.classList.remove('hidden');
  panel.classList.remove('hidden');
  document.getElementById('task-panel-title').textContent = 'Đang tải...';
  document.getElementById('task-panel-body').innerHTML = loadingHTML();

  overlay.onclick = closePanel;
  document.getElementById('task-panel-back').onclick = closePanel;

  await loadTask();
}

function closePanel() {
  document.getElementById('task-panel-overlay').classList.add('hidden');
  document.getElementById('task-panel').classList.add('hidden');
  _currentTaskId = null;
}

async function loadTask() {
  if (!_currentTaskId) return;
  try {
    const { task, subtasks, followers } = await api.getTask(_currentTaskId);
    const { comments } = await api.getComments(_currentTaskId).catch(() => ({ comments: [] }));
    renderPanel(task, subtasks || [], followers || [], comments || []);
  } catch (e) {
    document.getElementById('task-panel-body').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(e.message)}</div></div>`;
  }
}

function renderPanel(task, subtasks, followers, comments) {
  document.getElementById('task-panel-title').textContent = task.title;
  const isManager = _me.role === 'admin' || _me.role === 'manager';
  const canEdit = isManager || task.assigned_to === _me.id || task.assigned_by === _me.id;
  const doneSubs = subtasks.filter(s => s.is_done).length;
  const pct = subtasks.length ? Math.round(doneSubs / subtasks.length * 100) : 0;
  const labelColor = task.label_color_real || task.label_color || '#6366F1';

  const body = document.getElementById('task-panel-body');
  body.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      ${canEdit ? `<button id="tp-edit" class="btn-primary btn-sm">✏️ Sửa</button>` : ''}
      <div style="flex:1;"></div>
      ${taskStatusBadge(task.status)}
      ${priorityBadge(task.priority)}
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px;">${esc(task.title)}</div>
      ${task.description ? `<div class="rich-text-content" style="margin-bottom:12px;">${sanitizeRichText(task.description)}</div>` : ''}
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Giao cho</div><div class="detail-val">${esc(task.assignee_name || '—')}${task.assignee_code ? ` · ${esc(task.assignee_code)}` : ''}</div></div>
        <div class="detail-item"><div class="detail-label">Người giao</div><div class="detail-val">${esc(task.assigner_name || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Project</div><div class="detail-val">${task.project_name ? esc(task.project_name) : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Nhóm công việc</div><div class="detail-val">${task.group_name ? esc(task.group_name) : 'Công việc chung'}</div></div>
        <div class="detail-item"><div class="detail-label">Nhãn</div><div class="detail-val" style="display:flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;border-radius:999px;background:${esc(labelColor)};display:inline-block;"></span>${task.label_name ? esc(task.label_name) : 'Tự suy màu'}</div></div>
        <div class="detail-item"><div class="detail-label">Ngày</div><div class="detail-val">${esc(task.date || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Hạn chót</div><div class="detail-val">${esc(task.due_date || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Phòng ban</div><div class="detail-val">${esc(task.department || task.assignee_department || '—')}</div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <div class="card-title">☑️ Công việc con (${doneSubs}/${subtasks.length})</div>
        ${canEdit ? `<button id="tp-add-sub" class="btn-primary btn-xs">+ Thêm</button>` : ''}
      </div>
      ${subtasks.length ? `<div class="progress-bar" style="margin-bottom:10px;"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      <div id="tp-subtask-list">
        ${subtasks.map(s => `
          <div class="subtask-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <input type="checkbox" class="sub-check" data-sid="${s.id}" data-title="${esc(s.title)}" data-assignee="${s.assigned_to || ''}" data-due="${esc(s.due_date || '')}" ${s.is_done ? 'checked' : ''}/>
            <span style="flex:1;font-size:13px;${s.is_done ? 'text-decoration:line-through;color:var(--text-2)' : ''}">${esc(s.title)}</span>
            ${s.assignee_name ? `<span style="font-size:11px;color:var(--text-2)">👤 ${esc(s.assignee_name)}</span>` : ''}
            ${s.due_date ? `<span style="font-size:11px;color:var(--text-2)">Hạn: ${esc(s.due_date)}</span>` : ''}
            ${canEdit ? `<button class="btn-secondary btn-xs sub-edit" data-sid="${s.id}">Sửa</button>` : ''}
            ${canEdit ? `<button class="btn-icon sub-del" data-sid="${s.id}" style="font-size:14px;width:28px;height:28px;color:var(--danger)">🗑</button>` : ''}
          </div>
        `).join('') || '<div style="font-size:13px;color:var(--text-2);text-align:center;padding:12px 0;">Chưa có subtask</div>'}
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><div class="card-title">💬 Bình luận (${comments.length})</div></div>
      <div id="tp-comments">
        ${comments.map(c => `
          <div class="comment">
            <div class="avatar avatar-sm" style="background:${esc(c.avatar_color || '#4F46E5')};flex-shrink:0;">${esc(c.avatar_initials || c.full_name?.charAt(0) || '?')}</div>
            <div class="comment-body">
              <div class="comment-meta"><b>${esc(c.full_name)}</b> · ${esc(c.created_at?.slice(0,16) || '')}</div>
              <div class="comment-text">${esc(c.content)}</div>
            </div>
          </div>
        `).join('') || '<div style="font-size:13px;color:var(--text-2);text-align:center;padding:8px 0;">Chưa có bình luận</div>'}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="tp-cmt-input" placeholder="Viết bình luận..." style="flex:1;"/>
        <button id="tp-cmt-send" class="btn-primary btn-sm">Gửi</button>
      </div>
    </div>

    ${followers.length ? `
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">👁 Người theo dõi</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${followers.map(f => `<div style="display:flex;align-items:center;gap:4px;font-size:12px;"><div class="avatar avatar-sm" style="background:${esc(f.avatar_color || '#4F46E5')}">${esc(f.avatar_initials || '?')}</div>${esc(f.full_name)}</div>`).join('')}
      </div>
    </div>` : ''}
  `;

  document.getElementById('tp-edit')?.addEventListener('click', async () => {
    const projects = (await api.getTaskProjects().catch(() => ({ projects: [] }))).projects || [];
    const project = projects.find(p => String(p.id) === String(task.team_project_id)) || null;
    const groups = task.team_project_id ? ((await api.getTaskGroups({ project_id: task.team_project_id }).catch(() => ({ groups: [] }))).groups || []) : [];
    const labels = (await api.getTaskLabels(task.team_project_id ? { project_id: task.team_project_id } : {}).catch(() => ({ labels: [] }))).labels || [];
    openTaskForm(task, _users, _me, () => { loadTask(); }, { project, projects, groups, labels });
  });

  document.getElementById('tp-add-sub')?.addEventListener('click', () => openSubtaskForm(task.id));
  body.querySelectorAll('.sub-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtask = subtasks.find(s => Number(s.id) === Number(btn.dataset.sid));
      if (subtask) openSubtaskForm(task.id, subtask);
    });
  });
  body.querySelectorAll('.sub-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      try {
        await api.updateSubtask(parseInt(cb.dataset.sid), {
          title: cb.dataset.title,
          is_done: cb.checked ? 1 : 0,
          assigned_to: parseInt(cb.dataset.assignee) || null,
          due_date: cb.dataset.due || null,
        });
        loadTask();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  body.querySelectorAll('.sub-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Xóa subtask?')) return;
      try { await api.deleteSubtask(parseInt(btn.dataset.sid)); toast('Đã xóa', 'success'); loadTask(); }
      catch (e) { toast(e.message, 'error'); }
    });
  });

  const cmtInput = document.getElementById('tp-cmt-input');
  document.getElementById('tp-cmt-send').addEventListener('click', async () => {
    const content = cmtInput.value.trim();
    if (!content) return;
    try {
      await api.addComment(task.id, content);
      cmtInput.value = '';
      toast('Đã gửi', 'success');
      loadTask();
    } catch (e) { toast(e.message, 'error'); }
  });
  cmtInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('tp-cmt-send').click(); });
}

function openSubtaskForm(taskId, subtask = null) {
  openModal(subtask ? 'Sửa công việc con' : 'Thêm công việc con', `
    <div class="field"><label>Tên subtask *</label><input id="sf-title" value="${esc(subtask?.title || '')}" placeholder="Nhập đầu việc con"/></div>
    <div class="input-row">
      <div class="field"><label>Giao cho</label><select id="sf-assignee"><option value="">-- Chưa giao --</option>${_users.map(u => `<option value="${u.id}" ${subtask?.assigned_to==u.id ? 'selected' : ''}>${esc(u.full_name)}${u.employee_code ? ` · ${esc(u.employee_code)}` : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Hạn chót</label><input type="date" id="sf-due" value="${esc(subtask?.due_date || '')}"/></div>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="sf-save">${subtask ? 'Lưu' : 'Thêm'}</button>
  `);
  document.getElementById('sf-save').addEventListener('click', async () => {
    const title = document.getElementById('sf-title').value.trim();
    if (!title) { toast('Vui lòng nhập tên subtask', 'error'); return; }
    const data = {
      title,
      is_done: subtask?.is_done ?? 0,
      assigned_to: parseInt(document.getElementById('sf-assignee').value) || null,
      due_date: document.getElementById('sf-due').value || null,
    };
    try {
      if (subtask) await api.updateSubtask(subtask.id, data);
      else await api.createSubtask(taskId, data);
      closeModal();
      toast(subtask ? 'Đã cập nhật subtask' : 'Đã thêm subtask', 'success');
      loadTask();
    } catch (e) { toast(e.message, 'error'); }
  });
}
