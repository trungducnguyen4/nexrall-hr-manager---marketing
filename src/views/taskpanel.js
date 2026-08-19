import { api } from '../api.js';
import { esc, taskStatusBadge, priorityBadge, toast, loadingHTML, openModal, closeModal } from '../utils.js';
import { openTaskForm, sanitizeRichText } from './tasks.js';

const QUICK_LABEL_MAP = {
  '#1D4ED8': 'Xanh dương',
  '#6366F1': 'Tím',
  '#10B981': 'Xanh lá',
  '#FACC15': 'Vàng',
  '#F97316': 'Cam',
  '#EF4444': 'Đỏ',
  '#64748B': 'Xám',
};
function quickLabelName(color) {
  if (!color) return '';
  const key = color.trim().toUpperCase();
  // Try exact match, then try adding # prefix
  return QUICK_LABEL_MAP[color] || QUICK_LABEL_MAP['#' + key.replace(/^#/, '')] || '';
}

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
  const panelTitleEl = document.getElementById('task-panel-title');
  if (panelTitleEl) panelTitleEl.textContent = 'Đang tải...';
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
    const memberResponse = task.team_project_id ? await api.getTaskProjectMembers(task.team_project_id).catch(() => ({ members: [] })) : { members: [] };
    renderPanel(task, subtasks || [], followers || [], comments || [], memberResponse.members || []);
  } catch (e) {
    document.getElementById('task-panel-body').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(e.message)}</div></div>`;
  }
}

function renderPanel(task, subtasks, followers, comments, projectMembers = []) {
  const panelTitle = document.getElementById('task-panel-title');
  if (panelTitle) panelTitle.textContent = task.title;
  const isManager = _me.role === 'admin' || _me.role === 'manager';
  const canEdit = isManager || task.assigned_to === _me.id || task.assigned_by === _me.id;
  const doneSubs = subtasks.filter(s => s.is_done).length;
  const pct = subtasks.length ? Math.round(doneSubs / subtasks.length * 100) : 0;
  const labelColor = task.label_color_real || task.label_color || '#6366F1';
  const canManageFollowers = _me.role === 'admin' || _me.department === 'Phòng HCNS' || Number(task.assigned_by) === Number(_me.id);
  const followingIds = new Set(followers.map(follower => Number(follower.user_id)));

  const body = document.getElementById('task-panel-body');
  const FOLLOW_STACK_MAX = 4;
  const followerStack = followers.length ? followers.slice(0, FOLLOW_STACK_MAX).map(f => `<span class="avatar avatar-sm task-follower-avatar" style="background:${esc(f.avatar_color || '#4F46E5')}" title="${esc(f.full_name)}">${esc(f.avatar_initials || f.full_name?.charAt(0) || '?')}</span>`).join('') : '';
  const followerCount = `<span class="task-follower-count">${followers.length}</span>`;
  body.innerHTML = `
    <div class="tp-header">
      <div class="tp-header-main">
        <div class="tp-title">${esc(task.title)}</div>
        <div class="tp-badges">${taskStatusBadge(task.status)}${priorityBadge(task.priority)}</div>
      </div>
      <div class="tp-header-actions">
        <span class="task-follower-stack task-follower-stack-header" title="Người theo dõi (${followers.length})">${followerStack}${followerCount}</span>
        ${canEdit ? `<button id="tp-edit" class="btn-primary btn-sm">✏️ Sửa</button>` : ''}
        ${canEdit ? `<button id="tp-copy" class="btn-secondary btn-sm">⧉ Sao chép</button>` : ''}
      </div>
    </div>

    <div class="task-panel-layout">
    <main class="task-panel-main">

      <div class="card tp-section">
        <div class="tp-section-title"><span class="tp-section-label">Mô tả</span></div>
        ${task.description ? `<div class="rich-text-content">${sanitizeRichText(task.description)}</div>` : '<div class="tp-empty">Chưa có mô tả cho công việc này.</div>'}
      </div>

      <div class="card tp-section">
        <div class="tp-section-title">
          <span class="tp-section-label">☑️ Công việc con</span>
          <span class="tp-sub-count">${doneSubs}/${subtasks.length}</span>
          ${canEdit ? `<button id="tp-add-sub" class="btn-primary btn-xs">+ Thêm</button>` : ''}
        </div>
        ${subtasks.length ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-text">${pct}% hoàn thành</div>` : ''}
        <div id="tp-subtask-list" class="tp-subtask-list">
          ${subtasks.map(s => `
            <div class="subtask-row">
              <span class="subtask-check"><input type="checkbox" class="sub-check" data-sid="${s.id}" data-title="${esc(s.title)}" data-assignee="${s.assigned_to || ''}" data-due="${esc(s.due_date || '')}" ${s.is_done ? 'checked' : ''}/></span>
              <div class="subtask-content">
                <div class="subtask-title${s.is_done ? ' is-done' : ''}">${esc(s.title)}</div>
                ${s.description ? `<div class="subtask-desc${s.is_done ? ' is-done' : ''}">${esc(s.description)}</div>` : ''}
                <div class="subtask-meta">
                  ${s.assignee_name ? `<span class="subtask-meta-chip">👤 ${esc(s.assignee_name)}</span>` : ''}
                  ${s.due_date ? `<span class="subtask-meta-chip">Hạn: ${esc(s.due_date)}</span>` : ''}
                </div>
              </div>
              ${canEdit ? `<div class="subtask-actions"><button class="btn-secondary btn-xs sub-edit" data-sid="${s.id}">Sửa</button><button class="btn-icon sub-del" data-sid="${s.id}" title="Xóa subtask">🗑</button></div>` : ''}
            </div>
          `).join('') || '<div class="tp-empty">Chưa có việc con.</div>'}
        </div>
      </div>

      <div class="card tp-section">
        <div class="tp-section-title"><span class="tp-section-label">💬 Bình luận</span><span class="tp-sub-count">${comments.length}</span></div>
        <div id="tp-comments" class="tp-comments">
          ${comments.map(c => `<div class="comment"><div class="avatar avatar-sm" style="background:${esc(c.avatar_color || '#4F46E5')};flex-shrink:0;">${esc(c.avatar_initials || c.full_name?.charAt(0) || '?')}</div><div class="comment-body"><div class="comment-meta"><b>${esc(c.full_name)}</b><span>${esc(c.created_at?.slice(0,16) || '')}</span></div><div class="comment-text">${esc(c.content)}</div></div></div>`).join('') || '<div class="tp-empty">Chưa có bình luận.</div>'}
        </div>
        <div class="tp-comment-input">
          <textarea id="tp-cmt-input" rows="2" placeholder="Viết bình luận…"></textarea>
          <div class="tp-comment-input-foot"><span class="tp-comment-hint">Shift + Enter để xuống dòng</span><button id="tp-cmt-send" class="btn-primary btn-sm">Gửi</button></div>
        </div>
      </div>

    </main>
    <aside class="task-panel-aside">

      <div class="card tp-section">
        <div class="tp-section-title"><span class="tp-section-label">Thông tin</span></div>
        <div class="tp-meta">
          <div class="detail-item"><div class="detail-label">Giao cho</div><div class="detail-val">${esc(task.assignee_name || '—')}${task.assignee_code ? ` · ${esc(task.assignee_code)}` : ''}</div></div>
          <div class="detail-item"><div class="detail-label">Người giao</div><div class="detail-val">${esc(task.assigner_name || '—')}</div></div>
          <div class="detail-item"><div class="detail-label">Project</div><div class="detail-val">${task.project_name ? esc(task.project_name) : '—'}</div></div>
          <div class="detail-item"><div class="detail-label">Nhóm công việc</div><div class="detail-val">${task.group_name ? esc(task.group_name) : 'Công việc chung'}</div></div>
          <div class="detail-item"><div class="detail-label">Nhãn</div><div class="detail-val" style="display:flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;border-radius:999px;background:${esc(labelColor)};display:inline-block;"></span>${task.label_name ? esc(task.label_name) : (quickLabelName(task.label_color_real || task.label_color) || 'Tự suy màu')}</div></div>
          <div class="detail-item"><div class="detail-label">Ngày</div><div class="detail-val">${esc(task.date || '—')}</div></div>
          <div class="detail-item"><div class="detail-label">Hạn chót</div><div class="detail-val">${esc(task.due_date || '—')}</div></div>
          <div class="detail-item"><div class="detail-label">Phòng ban</div><div class="detail-val">${esc(task.department || task.assignee_department || '—')}</div></div>
        </div>
      </div>

    </aside>
    </div>
  `;

  document.getElementById('tp-edit')?.addEventListener('click', async () => {
    const projects = (await api.getTaskProjects().catch(() => ({ projects: [] }))).projects || [];
    const project = projects.find(p => String(p.id) === String(task.team_project_id)) || null;
    const groups = task.team_project_id ? ((await api.getTaskGroups({ project_id: task.team_project_id }).catch(() => ({ groups: [] }))).groups || []) : [];
    const labels = (await api.getTaskLabels(task.team_project_id ? { project_id: task.team_project_id } : {}).catch(() => ({ labels: [] }))).labels || [];
    const deptRes = await api.getDepartments().catch(() => ({ departments: [] }));
    openTaskForm(task, _users, _me, () => { loadTask(); }, { project, projects, groups, labels, departments: deptRes.departments });
});

  document.getElementById('tp-copy')?.addEventListener('click', () => openCopyModal(task));

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
  cmtInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('tp-cmt-send').click(); }
  });

  document.getElementById('tp-follow-self')?.addEventListener('click', async () => {
    try { await api.addTaskFollower(task.id); toast('Đã theo dõi công việc', 'success'); loadTask(); }
    catch (error) { toast(error.message, 'error'); }
  });
  document.getElementById('tp-follow-add')?.addEventListener('click', () => openFollowerPicker(task, followers, projectMembers));
  body.querySelectorAll('[data-remove-follower]').forEach(button => button.addEventListener('click', async () => {
    try { await api.removeTaskFollower(task.id, Number(button.dataset.removeFollower)); toast('Đã bỏ theo dõi', 'success'); loadTask(); }
    catch (error) { toast(error.message, 'error'); }
  }));
}

function openFollowerPicker(task, followers, projectMembers) {
  const following = new Set(followers.map(follower => Number(follower.user_id)));
  const candidates = projectMembers.filter(member => !following.has(Number(member.user_id)));
  openModal('Thêm người theo dõi', `
    <div class="task-follower-picker">
      ${candidates.map(member => `<button type="button" class="task-follower-picker-row" data-follower-id="${member.user_id}"><span class="avatar avatar-sm" style="background:${esc(member.avatar_color || '#4F46E5')}">${esc(member.avatar_initials || '?')}</span><span><strong>${esc(member.full_name)}</strong><small>${esc(member.employee_code || '')}${member.department ? ` · ${esc(member.department)}` : ''}</small></span><span>+ Theo dõi</span></button>`).join('') || '<div class="task-follower-empty">Mọi thành viên Project đã theo dõi công việc này.</div>'}
    </div>
  `, '<button type="button" class="btn-secondary" id="tp-follower-picker-close">Đóng</button>');
  document.getElementById('tp-follower-picker-close')?.addEventListener('click', closeModal);
  document.querySelectorAll('[data-follower-id]').forEach(button => button.addEventListener('click', async () => {
    try { await api.addTaskFollower(task.id, Number(button.dataset.followerId)); closeModal(); toast('Đã thêm người theo dõi', 'success'); loadTask(); }
    catch (error) { toast(error.message, 'error'); }
  }));
}

function openSubtaskForm(taskId, subtask = null) {
  openModal(subtask ? 'Sửa công việc con' : 'Thêm công việc con', `
    <div class="field"><label>Tiêu đề *</label><input id="sf-title" value="${esc(subtask?.title || '')}" placeholder="Nhập đầu việc con"/></div>
    <div class="field" style="margin-top:10px;"><label>Mô tả</label><textarea id="sf-desc" rows="4" style="min-height:90px;resize:vertical;" placeholder="Mô tả chi tiết công việc con (tuỳ chọn)">${esc(subtask?.description || '')}</textarea></div>
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
    if (!title) { toast('Vui lòng nhập tiêu đề công việc con', 'error'); return; }
    const data = {
      title,
      description: document.getElementById('sf-desc').value,
      is_done: subtask?.is_done ?? 0,
      assigned_to: parseInt(document.getElementById('sf-assignee').value) || null,
      due_date: document.getElementById('sf-due').value || null,
    };
    try {
      if (subtask) await api.updateSubtask(subtask.id, data);
      else await api.createSubtask(taskId, data);
      closeModal();
      toast(subtask ? 'Đã cập nhật công việc con' : 'Đã thêm công việc con', 'success');
      loadTask();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function openCopyModal(task) {
  const defaultTitle = (task.title || '') + ' Bản sao';
  openModal('Sao chép công việc', `
    <div class="field"><label>Tiêu đề *</label><input type="text" id="cp-title" value="${esc(defaultTitle)}" placeholder="Tên công việc"/></div>
    <div style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:6px;font-size:12px;line-height:1.6;">
      <div style="margin-bottom:6px;"><span style="color:var(--text-2);">Project</span><br><strong>${esc(task.project_name || '—')}</strong></div>
      <div><span style="color:var(--text-2);">Nhóm công việc</span><br><strong>${esc(task.group_name || 'Công việc chung')}</strong></div>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="cp-save">Sao chép</button>
  `);
  const input = document.getElementById('cp-title');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('cp-save')?.click(); });
  }
  document.getElementById('cp-save')?.addEventListener('click', async () => {
    const title = document.getElementById('cp-title').value.trim();
    if (!title) { toast('Vui lòng nhập tiêu đề', 'error'); return; }
    const btn = document.getElementById('cp-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang sao chép...'; }
    try {
      await api.createTask({
        title,
        description: task.description || '',
        assigned_to: task.assigned_to || null,
        department: task.department || '',
        date: task.date || null,
        due_date: task.due_date || null,
        status: task.status || 'todo',
        priority: task.priority || 'normal',
        label_id: task.label_id || null,
        label_color: task.label_color || null,
        team_project_id: task.team_project_id,
        group_id: task.group_id,
      });
      closeModal();
      closePanel();
      toast('Đã sao chép công việc', 'success');
      document.dispatchEvent(new CustomEvent('task-copied'));
    } catch (e) {
      toast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Sao chép'; }
    }
  });
}
