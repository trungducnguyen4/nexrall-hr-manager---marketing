import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, filterBySearch, paginateRows, paginationHTML, bindPagination } from '../utils.js';

const DEPT_COLORS = [
  '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
  '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#64748B',
];
const DEPT_ICONS = ['📣', '📝', '🔍', '📱', '🎨', '📊', '🤝', '💻', '📡', '🏆'];

function colorForDept(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length];
}

function iconForDept(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 17 + name.charCodeAt(i)) & 0xffffffff;
  return DEPT_ICONS[Math.abs(h) % DEPT_ICONS.length];
}

export async function renderDepartments(el, me) {
  const isAdmin = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">🏢 Phòng ban</div>
        <div class="page-sub">Cơ cấu tổ chức công ty marketing</div>
      </div>
      ${isAdmin ? '<button id="btn-new-dept" class="btn-primary btn-sm">+ Thêm phòng ban</button>' : ''}
    </div>

    <div class="search-bar" style="margin-bottom:12px;">
      <span class="search-icon">🔍</span>
      <input type="text" id="dept-search" placeholder="Tìm theo tên phòng ban, trưởng phòng..."/>
    </div>

    <div id="dept-list">${loadingHTML()}</div>
    <div id="dept-employees" style="margin-top:20px;"></div>
  `;

  let currentDepts = [];
  let currentUsers = [];
  let currentPage = 1;

  document.getElementById('btn-new-dept')?.addEventListener('click', () => openDeptForm(null, loadDepts, currentDepts, currentUsers));
  document.getElementById('dept-search')?.addEventListener('input', () => {
    currentPage = 1;
    renderDeptList();
  });

  async function loadDepts() {
    const listEl = document.getElementById('dept-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    try {
      const [deptsRes, usersRes] = await Promise.allSettled([api.getDepartments(), api.getUsers()]);
      currentDepts = deptsRes.status === 'fulfilled'
        ? (deptsRes.value.departments || []).map(d => ({ ...d, manager: d.manager_name || d.manager || '' }))
        : [];
      currentUsers = usersRes.status === 'fulfilled' ? (usersRes.value.users || []) : [];
      renderDeptList();
    } catch (e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  function renderDeptList() {
    const listEl = document.getElementById('dept-list');
    const empEl = document.getElementById('dept-employees');
    if (!listEl) return;

    const filtered = filterBySearch(currentDepts, document.getElementById('dept-search')?.value || '', ['name', 'manager', 'manager_name', 'description']);
    if (!filtered.length) {
      listEl.innerHTML = emptyHTML('🏢', 'Không tìm thấy phòng ban', isAdmin ? 'Nhấn + Thêm phòng ban để bắt đầu' : '');
      if (empEl) empEl.innerHTML = '';
      return;
    }

    const countMap = {};
    currentUsers.forEach(u => {
      if (u.department) countMap[u.department] = (countMap[u.department] || 0) + 1;
    });

    const pageData = paginateRows(filtered, currentPage);
    currentPage = pageData.page;
    listEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr;gap:10px;">
        ${pageData.rows.map(d => deptCardHTML(d, countMap[d.name] || 0, isAdmin)).join('')}
      </div>
      ${paginationHTML(pageData)}
    `;
    bindPagination(listEl, page => {
      currentPage = page;
      renderDeptList();
    });

    if (empEl) empEl.innerHTML = employeesByDeptHTML(currentUsers);

    if (isAdmin) {
      listEl.querySelectorAll('.dept-edit').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const d = currentDepts.find(x => x.id === parseInt(btn.dataset.did, 10));
          if (d) openDeptForm(d, loadDepts, currentDepts, currentUsers);
        });
      });
      listEl.querySelectorAll('.dept-del').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const d = currentDepts.find(x => x.id === parseInt(btn.dataset.did, 10));
          if (!d || !confirm(`Xóa phòng ban "${d.name}"?`)) return;
          try {
            await api.deleteDepartment(d.id);
            toast('Đã xóa phòng ban', 'success');
            loadDepts();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    }
  }

  loadDepts();
}

function deptCardHTML(d, empCount, isAdmin) {
  const color = colorForDept(d.name);
  const icon = iconForDept(d.name);
  return `
    <div class="dept-card" style="--dept-color:${color}" data-did="${d.id}">
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <div style="width:48px;height:48px;border-radius:12px;background:${color}20;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div class="dept-card-name">${esc(d.name)}</div>
          ${d.manager ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:6px;">👤 Trưởng phòng: <strong>${esc(d.manager)}</strong></div>` : ''}
          ${d.description ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:8px;">${esc(d.description)}</div>` : ''}
          <div class="dept-card-meta">
            <span class="dept-card-stat" style="background:${color}15;padding:3px 8px;border-radius:6px;color:${color};font-weight:600;">👥 ${empCount} nhân viên</span>
          </div>
        </div>
        ${isAdmin ? `
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn-xs btn-secondary dept-edit" data-did="${d.id}">✏️</button>
            <button class="btn-xs btn-danger dept-del" data-did="${d.id}">🗑</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function employeesByDeptHTML(users) {
  if (!users.length) return '';
  const byDept = {};
  users.forEach(u => {
    const key = u.department || 'Không có phòng ban';
    if (!byDept[key]) byDept[key] = [];
    byDept[key].push(u);
  });

  return `
    <div class="section-title">Nhân viên theo phòng ban</div>
    ${Object.entries(byDept).map(([dept, members]) => {
      const color = colorForDept(dept);
      return `
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header">
            <div class="card-title" style="color:${color}">${iconForDept(dept)} ${esc(dept)}</div>
            <span class="badge" style="background:${color}20;color:${color};">${members.length} người</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${members.map(u => `
              <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
                <div class="avatar avatar-sm" style="background:${esc(u.avatar_color || color)}">${esc(u.avatar_initials || u.full_name.charAt(0))}</div>
                <div>
                  <div style="font-size:12px;font-weight:600;color:var(--text);">${esc(u.full_name)}</div>
                  <div style="font-size:11px;color:var(--text-3);">${esc(u.position || '—')}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function openDeptForm(dept, onRefresh = noop, existingDepts = [], users = []) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!dept;
  const managerOptions = users.map(u => {
    const label = `${u.full_name}${u.department ? ' - ' + u.department : ''}${u.position ? ' (' + u.position + ')' : ''}`;
    return `<option value="${u.id}" ${Number(dept?.manager_id) === Number(u.id) ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
  openModal(isEdit ? 'Sửa phòng ban' : 'Thêm phòng ban', `
    <div class="field"><label>Tên phòng ban *</label>
      <input type="text" id="df-name" value="${esc(dept?.name || '')}" placeholder="Nhập tên phòng ban"/>
    </div>
    <div class="field"><label>Trưởng phòng</label>
      <select id="df-manager-id">
        <option value="">-- Chưa chọn --</option>
        ${managerOptions}
      </select>
    </div>
    <div class="field"><label>Mô tả</label>
      <textarea id="df-desc" rows="3" placeholder="Mô tả hoạt động của phòng ban...">${esc(dept?.description || '')}</textarea>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="df-save">Lưu</button>
  `);

  document.getElementById('df-save').addEventListener('click', async () => {
    const name = document.getElementById('df-name').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Vui lòng nhập tên phòng ban', 'error'); return; }
    const dup = existingDepts.some(d => String(d.name || '').trim().replace(/\s+/g, ' ').toLowerCase() === name.toLowerCase() && (!isEdit || d.id !== dept.id));
    if (dup) { toast('Phòng ban này đã tồn tại', 'error'); return; }
    const data = {
      name,
      manager_id: document.getElementById('df-manager-id').value || null,
      description: document.getElementById('df-desc').value.trim(),
    };
    try {
      if (isEdit) await api.updateDepartment(dept.id, data);
      else await api.createDepartment(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật phòng ban' : 'Đã tạo phòng ban', 'success');
      onRefresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}
