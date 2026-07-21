import { api } from '../api.js';
import { esc, taskStatusBadge, priorityBadge, fmtDateTime, setAvatar, toast, loadingHTML, initials, avatarColor } from '../utils.js';
import { openTaskForm } from './tasks.js';

let _currentTaskId = null;
let _users = [];
let _me = null;

export async function openPanel(taskId, me) {
  _currentTaskId = taskId;
  _me = me;
  try { _users = (await api.getUsers()).users || []; } catch(_) {}

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
  } catch(e) {
    document.getElementById('task-panel-body').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(e.message)}</div></div>`;
  }
}

function renderPanel(task, subtasks, followers, comments) {
  document.getElementById('task-panel-title').textContent = task.title;
  const isManager = _me.role === 'admin' || _me.role === 'manager';
  const canEdit = isManager || task.assigned_to === _me.id || task.assigned_by === _me.id;

  const doneSubs = subtasks.filter(s => s.is_done).length;
  const pct = subtasks.length ? Math.round(doneSubs / subtasks.length * 100) : 0;

  const body = document.getElementById('task-panel-body');
  body.innerHTML = `
    <!-- Top actions -->
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      ${canEdit ? `<button id="tp-edit" class="btn-primary btn-sm">✏️ Sửa</button>` : ''}
      <div style="flex:1;"></div>
      ${taskStatusBadge(task.status)}
      ${priorityBadge(task.priority)}
    </div>

    <!-- Info card -->
    <div class="card" style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px;">${esc(task.title)}</div>
      ${task.description ? `<p style="font-size:13px;color:var(--text-2);margin-bottom:12px;white-space:pre-wrap;">${esc(task.description)}</p>` : ''}
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Giao cho</div><div class="detail-val">${esc(task.assignee_name||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Ngày</div><div class="detail-val">${esc(task.date||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Hạn chót</div><div class="detail-val">${esc(task.due_date||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Phòng ban</div><div class="detail-val">${esc(task.department||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Check in</div><div class="detail-val">${esc(task.checkin_time||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Check out</div><div class="detail-val">${esc(task.checkout_time||'—')}</div></div>
      </div>
      <div style="margin-top:4px;display:flex;align-items:center;gap:6px;">
        <div style="width:16px;height:16px;border-radius:4px;background:${esc(task.label_color||'#6366F1')};flex-shrink:0;"></div>
        <span style="font-size:12px;color:var(--text-2)">Nhãn màu</span>
      </div>
    </div>

    <!-- Subtasks -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <div class="card-title">☑️ Công việc con (${doneSubs}/${subtasks.length})</div>
        ${canEdit ? `<button id="tp-add-sub" class="btn-primary btn-xs">+ Thêm</button>` : ''}
      </div>
      ${subtasks.length ? `<div class="progress-bar" style="margin-bottom:10px;"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      <div id="tp-subtask-list">
        ${subtasks.map(s => `
          <div class="subtask-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <input type="checkbox" class="sub-check" data-sid="${s.id}" data-done="${s.is_done}" ${s.is_done?'checked':''}/>
            <span style="flex:1;font-size:13px;${s.is_done?'text-decoration:line-through;color:var(--text-2)':''}">${esc(s.title)}</span>
            ${s.assignee_name ? `<span style="font-size:11px;color:var(--text-2)">👤${esc(s.assignee_name)}</span>` : ''}
            ${canEdit ? `<button class="btn-icon sub-del" data-sid="${s.id}" style="font-size:14px;width:28px;height:28px;color:var(--danger)">🗑</button>` : ''}
          </div>
        `).join('') || '<div style="font-size:13px;color:var(--text-2);text-align:center;padding:12px 0;">Chưa có subtask</div>'}
      </div>
    </div>

    <!-- Comments -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><div class="card-title">💬 Bình luận (${comments.length})</div></div>
      <div id="tp-comments">
        ${comments.map(c => `
          <div class="comment">
            <div class="avatar avatar-sm" style="background:${esc(c.avatar_color||'#4F46E5')};flex-shrink:0;">${esc(c.avatar_initials||c.full_name?.charAt(0)||'?')}</div>
            <div class="comment-body">
              <div class="comment-meta"><b>${esc(c.full_name)}</b> · ${esc(c.created_at?.slice(0,16)||'')}</div>
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

    <!-- Followers -->
    ${followers.length ? `
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">👁 Người theo dõi</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${followers.map(f => `<div style="display:flex;align-items:center;gap:4px;font-size:12px;"><div class="avatar avatar-sm" style="background:${esc(f.avatar_color||'#4F46E5')}">${esc(f.avatar_initials||'?')}</div>${esc(f.full_name)}</div>`).join('')}
      </div>
    </div>` : ''}
  `;

  // Edit button
  document.getElementById('tp-edit')?.addEventListener('click', () => {
    openTaskForm(task, _users, _me, () => { loadTask(); });
  });

  // Add subtask
  document.getElementById('tp-add-sub')?.addEventListener('click', async () => {
    const title = prompt('Tên subtask:');
    if (!title) return;
    try {
      await api.createSubtask(task.id, { title });
      toast('Đã thêm subtask', 'success');
      loadTask();
    } catch(e) { toast(e.message, 'error'); }
  });

  // Toggle subtask
  body.querySelectorAll('.sub-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      try {
        await api.updateSubtask(parseInt(cb.dataset.sid), { is_done: cb.checked ? 1 : 0, title: cb.closest('.subtask-row').querySelector('span').textContent });
        loadTask();
      } catch(e) { toast(e.message, 'error'); }
    });
  });

  // Delete subtask
  body.querySelectorAll('.sub-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Xóa subtask?')) return;
      try { await api.deleteSubtask(parseInt(btn.dataset.sid)); toast('Đã xóa', 'success'); loadTask(); }
      catch(e) { toast(e.message, 'error'); }
    });
  });

  // Send comment
  const cmtInput = document.getElementById('tp-cmt-input');
  document.getElementById('tp-cmt-send').addEventListener('click', async () => {
    const content = cmtInput.value.trim();
    if (!content) return;
    try {
      await api.addComment(task.id, content);
      cmtInput.value = '';
      toast('Đã gửi', 'success');
      loadTask();
    } catch(e) { toast(e.message, 'error'); }
  });
  cmtInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('tp-cmt-send').click(); });
}
