import { api } from '../api.js';
import { esc, taskStatusBadge, taskStatusLabel, priorityBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, today, initials, avatarColor } from '../utils.js';
import { openTaskPanel } from '../app.js';

export async function renderTasks(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header flex justify-between items-center" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div class="page-title">📋 Công việc</div>
        <div class="page-sub">Quản lý tasks & dự án</div>
      </div>
      <button id="btn-new-task" class="btn-primary btn-sm">+ Tạo việc</button>
    </div>

    <div class="filter-bar" id="task-filter-bar">
      <span class="filter-chip active" data-status="">Tất cả</span>
      <span class="filter-chip" data-status="todo">Chờ làm</span>
      <span class="filter-chip" data-status="in-progress">Đang làm</span>
      <span class="filter-chip" data-status="review">Review</span>
      <span class="filter-chip" data-status="done">Hoàn thành</span>
      <span class="filter-chip" data-status="cancelled">Hủy</span>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <input type="date" id="task-date-filter" style="flex:1;min-width:130px;" placeholder="Lọc ngày"/>
      <input type="text" id="task-search" style="flex:2;min-width:160px;" placeholder="🔍 Tìm kiếm..."/>
    </div>

    <div id="task-list">${loadingHTML()}</div>
  `;

  let users = [];
  try { users = (await api.getUsers()).users || []; } catch(_) {}

  let currentStatus = '';
  let allTasks = [];

  // Filter bar
  document.getElementById('task-filter-bar').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    document.querySelectorAll('#task-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentStatus = chip.dataset.status;
    renderTaskList();
  });

  document.getElementById('task-date-filter').addEventListener('change', loadTasks);
  document.getElementById('task-search').addEventListener('input', renderTaskList);

  async function loadTasks() {
    const listEl = document.getElementById('task-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const params = {};
    const dateVal = document.getElementById('task-date-filter')?.value;
    if (dateVal) params.date = dateVal;
    if (currentStatus) params.status = currentStatus;
    try {
      allTasks = (await api.getTasks(params)).tasks || [];
      renderTaskList();
    } catch(e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  function renderTaskList() {
    const listEl = document.getElementById('task-list');
    if (!listEl) return;
    const search = document.getElementById('task-search')?.value.toLowerCase() || '';
    let tasks = allTasks;
    if (currentStatus) tasks = tasks.filter(t => t.status === currentStatus);
    if (search) tasks = tasks.filter(t => (t.title||'').toLowerCase().includes(search) || (t.assignee_name||'').toLowerCase().includes(search));
    if (!tasks.length) { listEl.innerHTML = emptyHTML('📋', 'Không có công việc nào'); return; }
    listEl.innerHTML = tasks.map(t => `
      <div class="task-card" data-tid="${t.id}" style="border-left-color:${esc(t.label_color||'#6366F1')}">
        <div class="task-card-title">${esc(t.title)}</div>
        ${t.description ? `<div style="font-size:12px;color:var(--text-2);margin:4px 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.description)}</div>` : ''}
        <div class="task-card-meta">
          ${taskStatusBadge(t.status)}
          ${priorityBadge(t.priority)}
          ${t.assignee_name ? `<span class="task-card-assignee">👤 ${esc(t.assignee_name)}</span>` : ''}
          ${t.date ? `<span style="font-size:11px;color:var(--text-2)">📅 ${esc(t.date)}</span>` : ''}
          ${t.due_date ? `<span style="font-size:11px;color:var(--text-2)">⏰ ${esc(t.due_date)}</span>` : ''}
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTaskPanel(parseInt(card.dataset.tid)));
    });
  }

  // New task
  document.getElementById('btn-new-task').addEventListener('click', () => openTaskForm(null, users, me, loadTasks));

  loadTasks();
}

export function openTaskForm(task, users, me, onDone) {
  const isEdit = !!task;
  openModal(isEdit ? 'Sửa công việc' : 'Tạo công việc mới', `
    <div class="field"><label>Tiêu đề *</label><input type="text" id="tf-title" value="${esc(task?.title||'')}" placeholder="Tên công việc"/></div>
    <div class="field"><label>Mô tả</label><textarea id="tf-desc">${esc(task?.description||'')}</textarea></div>
    <div class="input-row">
      <div class="field"><label>Ngày</label><input type="date" id="tf-date" value="${esc(task?.date||today())}"/></div>
      <div class="field"><label>Hạn chót</label><input type="date" id="tf-due" value="${esc(task?.due_date||'')}"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Ưu tiên</label>
        <select id="tf-priority">
          <option value="low" ${task?.priority==='low'?'selected':''}>Thấp</option>
          <option value="normal" ${(!task||task?.priority==='normal')?'selected':''}>Bình thường</option>
          <option value="high" ${task?.priority==='high'?'selected':''}>Cao</option>
          <option value="urgent" ${task?.priority==='urgent'?'selected':''}>Khẩn cấp</option>
        </select>
      </div>
      <div class="field"><label>Trạng thái</label>
        <select id="tf-status">
          <option value="todo" ${(!task||task?.status==='todo')?'selected':''}>Chờ làm</option>
          <option value="in-progress" ${task?.status==='in-progress'?'selected':''}>Đang làm</option>
          <option value="review" ${task?.status==='review'?'selected':''}>Review</option>
          <option value="done" ${task?.status==='done'?'selected':''}>Hoàn thành</option>
          <option value="cancelled" ${task?.status==='cancelled'?'selected':''}>Hủy</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Giao cho</label>
      <select id="tf-assignee">
        <option value="">-- Chưa giao --</option>
        ${users.map(u => `<option value="${u.id}" ${task?.assigned_to==u.id?'selected':''}>${esc(u.full_name)}</option>`).join('')}
      </select>
    </div>
    <div class="input-row">
      <div class="field"><label>Màu nhãn</label><input type="color" id="tf-color" value="${task?.label_color||'#6366F1'}"/></div>
      <div class="field"><label>Phòng ban</label><input type="text" id="tf-dept" value="${esc(task?.department||'')}"/></div>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="tf-delete">Xóa</button>` : ''}
    <button class="btn-primary" id="tf-save">Lưu</button>
  `);

  document.getElementById('tf-save').addEventListener('click', async () => {
    const title = document.getElementById('tf-title').value.trim();
    if (!title) { toast('Vui lòng nhập tiêu đề', 'error'); return; }
    const data = {
      title,
      description: document.getElementById('tf-desc').value,
      date: document.getElementById('tf-date').value || null,
      due_date: document.getElementById('tf-due').value || null,
      priority: document.getElementById('tf-priority').value,
      status: document.getElementById('tf-status').value,
      assigned_to: parseInt(document.getElementById('tf-assignee').value) || null,
      label_color: document.getElementById('tf-color').value,
      department: document.getElementById('tf-dept').value,
    };
    try {
      if (isEdit) await api.updateTask(task.id, data);
      else await api.createTask(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật' : 'Đã tạo công việc', 'success');
      onDone();
    } catch(e) { toast(e.message, 'error'); }
  });

  if (isEdit) {
    document.getElementById('tf-delete')?.addEventListener('click', async () => {
      if (!confirm('Xóa công việc này?')) return;
      try {
        await api.deleteTask(task.id);
        closeModal(); toast('Đã xóa', 'success'); onDone();
      } catch(e) { toast(e.message, 'error'); }
    });
  }
}
