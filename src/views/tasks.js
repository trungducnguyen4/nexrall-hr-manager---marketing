import { api } from '../api.js';
import { esc, taskStatusBadge, taskStatusLabel, priorityBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, today, initials, avatarColor, paginateRows, paginationHTML, bindPagination } from '../utils.js';
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

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">
      <input type="text" id="task-search" placeholder="Tìm tên/mã nhân sự hoặc công việc..."/>
      <select id="task-dept-filter"><option value="">-- Phòng ban --</option></select>
      <select id="task-assignee-filter"><option value="">-- Người thực hiện --</option></select>
      <select id="task-assigner-filter"><option value="">-- Người giao --</option></select>
      <select id="task-priority-filter">
        <option value="">-- Ưu tiên --</option><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option><option value="urgent">Khẩn cấp</option>
      </select>
      <input type="date" id="task-date-filter" title="Ngày công việc"/>
      <input type="date" id="task-created-from" title="Tạo từ ngày"/>
      <input type="date" id="task-created-to" title="Tạo đến ngày"/>
      <input type="date" id="task-due-from" title="Hạn từ ngày"/>
      <input type="date" id="task-due-to" title="Hạn đến ngày"/>
      <select id="task-sort">
        <option value="created_at|desc">Mới tạo trước</option>
        <option value="due_date|asc">Hạn gần trước</option>
        <option value="priority|desc">Ưu tiên cao trước</option>
        <option value="updated_at|desc">Mới cập nhật trước</option>
      </select>
    </div>

    <div id="task-list">${loadingHTML()}</div>
  `;

  let users = [];
  let departments = [];
  try { users = (await api.getUsers()).users || []; } catch(_) {}
  try { departments = (await api.getDepartments()).departments || []; } catch(_) {}
  const assigneeSel = document.getElementById('task-assignee-filter');
  const assignerSel = document.getElementById('task-assigner-filter');
  const deptSel = document.getElementById('task-dept-filter');
  users.forEach(u => {
    const opt1 = document.createElement('option');
    opt1.value = u.id; opt1.textContent = `${u.full_name} (${u.employee_code || ''})`; assigneeSel.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = u.id; opt2.textContent = `${u.full_name} (${u.employee_code || ''})`; assignerSel.appendChild(opt2);
  });
  departments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name; opt.textContent = d.name; deptSel.appendChild(opt);
  });

  let currentStatus = '';
  let allTasks = [];
  let currentPage = 1;

  // Filter bar
  document.getElementById('task-filter-bar').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    document.querySelectorAll('#task-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentStatus = chip.dataset.status;
    renderTaskList();
  });

  ['task-date-filter','task-dept-filter','task-assignee-filter','task-assigner-filter','task-priority-filter','task-created-from','task-created-to','task-due-from','task-due-to','task-sort'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { currentPage = 1; loadTasks(); });
  });
  let searchTimer = null;
  document.getElementById('task-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadTasks(); }, 250);
  });

  async function loadTasks() {
    const listEl = document.getElementById('task-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const params = {};
    const dateVal = document.getElementById('task-date-filter')?.value;
    if (dateVal) params.date = dateVal;
    if (currentStatus) params.status = currentStatus;
    const searchVal = document.getElementById('task-search')?.value.trim();
    if (searchVal) params.search = searchVal;
    const deptVal = document.getElementById('task-dept-filter')?.value;
    if (deptVal) params.department = deptVal;
    const assigneeVal = document.getElementById('task-assignee-filter')?.value;
    if (assigneeVal) params.assignee = assigneeVal;
    const assignerVal = document.getElementById('task-assigner-filter')?.value;
    if (assignerVal) params.assigner = assignerVal;
    const priVal = document.getElementById('task-priority-filter')?.value;
    if (priVal) params.priority = priVal;
    const cf = document.getElementById('task-created-from')?.value;
    const ct = document.getElementById('task-created-to')?.value;
    const df = document.getElementById('task-due-from')?.value;
    const dt = document.getElementById('task-due-to')?.value;
    if (cf) params.created_from = cf;
    if (ct) params.created_to = ct;
    if (df) params.due_from = df;
    if (dt) params.due_to = dt;
    const [sort, order] = (document.getElementById('task-sort')?.value || 'created_at|desc').split('|');
    params.sort = sort; params.order = order;
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
    let tasks = allTasks;
    if (currentStatus) tasks = tasks.filter(t => t.status === currentStatus);
    if (!tasks.length) { listEl.innerHTML = emptyHTML('📋', 'Không có công việc nào'); return; }
    const pageData = paginateRows(tasks, currentPage);
    currentPage = pageData.page;
    listEl.innerHTML = pageData.rows.map(t => `
      <div class="task-card" data-tid="${t.id}" style="border-left-color:${esc(t.label_color||'#6366F1')}">
        <div class="task-card-title">${esc(t.title)}</div>
        ${t.description ? `<div style="font-size:12px;color:var(--text-2);margin:4px 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.description)}</div>` : ''}
        <div class="task-card-meta">
          ${taskStatusBadge(t.status)}
          ${priorityBadge(t.priority)}
          ${t.assignee_name ? `<span class="task-card-assignee">👤 ${esc(t.assignee_name)}${t.assignee_code ? ` · ${esc(t.assignee_code)}` : ''}</span>` : ''}
          ${t.assignee_department ? `<span style="font-size:11px;color:var(--text-2)">🏢 ${esc(t.assignee_department)}</span>` : ''}
          ${t.assigner_name ? `<span style="font-size:11px;color:var(--text-2)">Giao: ${esc(t.assigner_name)}</span>` : ''}
          ${t.created_at ? `<span style="font-size:11px;color:var(--text-2)">Tạo: ${esc(String(t.created_at).slice(0,10))}</span>` : ''}
          ${t.date ? `<span style="font-size:11px;color:var(--text-2)">Ngày: ${esc(t.date)}</span>` : ''}
          ${t.due_date ? `<span style="font-size:11px;color:var(--text-2)">Hạn: ${esc(t.due_date)}</span>` : ''}
          ${t.updated_at ? `<span style="font-size:11px;color:var(--text-2)">Cập nhật: ${esc(String(t.updated_at).slice(0,10))}</span>` : ''}
          ${Number(t.subtask_total) > 0 ? `<span style="font-size:11px;color:var(--text-2)">Tiến độ: ${Number(t.subtask_done)||0}/${Number(t.subtask_total)||0}</span>` : ''}
        </div>
      </div>
    `).join('') + paginationHTML(pageData);
    listEl.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTaskPanel(parseInt(card.dataset.tid)));
    });
    bindPagination(listEl, page => { currentPage = page; renderTaskList(); });
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
    <div class="field"><label>Phòng ban</label><input type="text" id="tf-dept" value="${esc(task?.department||'')}"/></div>
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
