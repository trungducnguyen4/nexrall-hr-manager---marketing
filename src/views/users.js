import { api } from '../api.js';
import { esc, roleBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, fmtMoney, initials, avatarColor, DEPARTMENTS, DEPT_CODE, lifecycleBadge, LIFECYCLE_STATUSES, noop, safeCb, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination } from '../utils.js';

// Preview-only: mirrors server's nextEmployeeCode() logic (server always re-computes
// and confirms the official code on save; this is just live UI feedback).
function previewEmployeeCode(allUsers, type, department) {
  const deptCode = DEPT_CODE[department];
  if (!type || !deptCode) return '';
  const prefix = `${type}-${deptCode}-`;
  let maxSeq = 0;
  (allUsers||[]).forEach(u => {
    const code = String(u.employee_code||'');
    if (code.startsWith(prefix)) {
      const n = parseInt(code.slice(prefix.length), 10);
      if (!isNaN(n)) maxSeq = Math.max(maxSeq, n);
    }
  });
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

// HCNS (Phòng HCNS) and Ban Giám Đốc are DEPARTMENTS (not roles) that may edit lifecycle status.
function isHrOrBod(u) {
  return u.role === 'admin' || u.department === 'Phòng HCNS' || u.department === 'Ban Giám Đốc';
}

export async function renderUsers(el, me) {
  const isAdmin = me.role === 'admin';
  const isManager = me.role === 'manager' || isAdmin;
  if (!isManager) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">Bạn không có quyền truy cập</div></div>`; return; }

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div class="page-title">👥 Nhân viên</div>
        <div class="page-sub">Quản lý tài khoản nhân viên</div>
      </div>
      ${isAdmin ? `<button id="btn-new-user" class="btn-primary btn-sm">+ Thêm</button>` : ''}
    </div>

    <div class="search-bar"><input type="text" id="user-search" placeholder="Tìm kiếm nhân viên..."/></div>
    <div class="filter-bar" id="user-dept-filter">
      <span class="filter-chip active" data-dept="">Tất cả</span>
    </div>
    <div id="user-list">${loadingHTML()}</div>
  `;

  let allUsers = [];
  let currentPage = 1;

  async function loadUsers() {
    const listEl = document.getElementById('user-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    try {
      allUsers = (await api.getUsers()).users || [];
      // Populate dept filter
      const depts = [...new Set(allUsers.map(u => u.department).filter(Boolean))];
      const filterBar = document.getElementById('user-dept-filter');
      depts.forEach(d => {
        const chip = document.createElement('span');
        chip.className = 'filter-chip';
        chip.dataset.dept = d;
        chip.textContent = d;
        filterBar.appendChild(chip);
      });
      renderList();
    } catch(e) { listEl.innerHTML = emptyHTML('⚠️', e.message); }
  }

  function renderList() {
    const listEl = document.getElementById('user-list');
    if (!listEl) return;
    const search = document.getElementById('user-search')?.value || '';
    const activeDept = document.querySelector('#user-dept-filter .filter-chip.active')?.dataset.dept || '';
    let users = filterByDepartment(allUsers, activeDept, ['department']);
    users = filterBySearch(users, search, ['full_name', 'email', 'employee_code']);
    if (!users.length) { listEl.innerHTML = emptyHTML('👥', 'Không tìm thấy nhân viên'); return; }
    const pageData = paginateRows(users, currentPage);
    currentPage = pageData.page;
    listEl.innerHTML = pageData.rows.map(u => `
      <div class="list-item" data-uid="${u.id}" style="${!u.is_active?'opacity:.55':''}">
        <div class="avatar avatar-md" style="background:${esc(u.avatar_color||avatarColor(u.full_name))}">${esc(u.avatar_initials||initials(u.full_name))}</div>
        <div class="list-item-content">
          <div class="list-item-title">${esc(u.full_name)}</div>
          <div class="list-item-sub">${esc(u.position||u.department||'')} · ${esc(u.employee_code||'')}</div>
          <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">${roleBadge(u.role)}${lifecycleBadge(u.lifecycle_status)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:12px;color:var(--text-2);margin-bottom:4px;">${esc(u.email)}</div>
          <span class="badge ${u.is_active ? 'badge-success' : 'badge-gray'}" style="font-size:10px;">${u.is_active?'✅ Hoạt động':'⛔ Khóa'}</span>
        </div>
      </div>
    `).join('') + paginationHTML(pageData);
    listEl.querySelectorAll('.list-item').forEach(item => {
      item.addEventListener('click', () => {
        const user = allUsers.find(u => u.id === parseInt(item.dataset.uid));
        if (user) openUserDetail(user, me, loadUsers);
      });
    });
    bindPagination(listEl, page => { currentPage = page; renderList(); });
  }

  document.getElementById('user-search').addEventListener('input', () => { currentPage = 1; renderList(); });
  document.getElementById('user-dept-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('#user-dept-filter .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderList();
  });

  document.getElementById('btn-new-user')?.addEventListener('click', () => openUserForm(null, loadUsers, allUsers));

  loadUsers();
}

function openUserDetail(user, me, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const isAdmin = me.role === 'admin';
  const canChangeLifecycle = isHrOrBod(me);
  openModal(user.full_name, `
    <div style="text-align:center;margin-bottom:16px;">
      <div class="avatar avatar-lg" style="background:${esc(user.avatar_color||'#4F46E5')};margin:0 auto 10px;">${esc(user.avatar_initials||initials(user.full_name))}</div>
      <div style="font-size:16px;font-weight:800;">${esc(user.full_name)}</div>
      <div style="font-size:12px;color:var(--text-2);">${esc(user.position||'')} · ${esc(user.department||'')}</div>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Mã NV</div><div class="detail-val">${esc(user.employee_code)}</div></div>
      <div class="detail-item"><div class="detail-label">Email</div><div class="detail-val" style="font-size:12px;word-break:break-all;">${esc(user.email)}</div></div>
      <div class="detail-item"><div class="detail-label">Điện thoại</div><div class="detail-val">${esc(user.phone||'—')}</div></div>
      <div class="detail-item"><div class="detail-label">Lương</div><div class="detail-val">${fmtMoney(user.salary)}</div></div>
      <div class="detail-item"><div class="detail-label">Ngân hàng</div><div class="detail-val" style="font-size:12px;">${esc(user.bank_name||'—')}</div></div>
      <div class="detail-item"><div class="detail-label">STK</div><div class="detail-val" style="font-size:12px;">${esc(user.bank_account||'—')}</div></div>
      <div class="detail-item"><div class="detail-label">Vòng đời nhân sự</div><div class="detail-val">${lifecycleBadge(user.lifecycle_status)}</div></div>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>
    ${canChangeLifecycle ? `<button class="btn-secondary" id="ud-lifecycle">🔄 Đổi trạng thái</button>` : ''}
    ${isAdmin ? `<button class="btn-danger" id="ud-lock">${user.is_active ? '🔒 Khóa TK' : '🔓 Mở khóa'}</button>` : ''}
    ${isAdmin ? `<button class="btn-primary" id="ud-edit">✏️ Sửa</button>` : ''}
  `);

  document.getElementById('ud-edit')?.addEventListener('click', () => {
    closeModal();
    openUserForm(user, onRefresh);
  });
  document.getElementById('ud-lock')?.addEventListener('click', async () => {
    try {
      await api.updateUser(user.id, { ...user, is_active: user.is_active ? 0 : 1 });
      closeModal(); toast(user.is_active ? 'Đã khóa tài khoản' : 'Đã mở khóa', 'success'); onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });
  document.getElementById('ud-lifecycle')?.addEventListener('click', () => {
    closeModal();
    openLifecycleForm(user, onRefresh);
  });
}

function openLifecycleForm(user, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  openModal(`Đổi trạng thái — ${user.full_name}`, `
    <div class="field"><label>Trạng thái hiện tại</label><div style="margin:4px 0;">${lifecycleBadge(user.lifecycle_status)}</div></div>
    <div class="field"><label>Trạng thái mới *</label>
      <select id="lf-status">
        ${LIFECYCLE_STATUSES.map(s => `<option value="${esc(s)}" ${user.lifecycle_status===s?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Lý do *</label><textarea id="lf-reason" rows="3" placeholder="Nhập lý do thay đổi trạng thái..."></textarea></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="lf-save">Lưu</button>
  `);

  document.getElementById('lf-save').addEventListener('click', async () => {
    const status = document.getElementById('lf-status').value;
    const reason = document.getElementById('lf-reason').value.trim();
    if (!reason) { toast('Vui lòng nhập lý do', 'error'); return; }
    const btn = document.getElementById('lf-save');
    btn.disabled = true;
    try {
      await api.changeLifecycleStatus(user.id, status, reason);
      closeModal(); toast('Đã cập nhật trạng thái', 'success'); onRefresh();
    } catch(e) { toast(e.message, 'error'); btn.disabled = false; }
  });
}

function openUserForm(user, onRefresh = noop, allUsers = []) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!user;
  openModal(isEdit ? 'Sửa nhân viên' : 'Thêm nhân viên', `
    <div class="input-row">
      <div class="field"><label>Loại nhân sự *</label>
        <select id="uf-emptype" ${isEdit ? 'disabled' : ''}>
          <option value="NV" ${(!user||(user.employee_type||'NV')==='NV')?'selected':''}>Nhân viên (NV)</option>
          <option value="TTS" ${user?.employee_type==='TTS'?'selected':''}>Thực tập sinh (TTS)</option>
        </select>
      </div>
      <div class="field"><label>Vai trò</label>
        <select id="uf-role">
          <option value="employee" ${(!user||user.role==='employee')?'selected':''}>Nhân viên</option>
          <option value="manager" ${user?.role==='manager'?'selected':''}>Nhân sự</option>
          <option value="admin" ${user?.role==='admin'?'selected':''}>Admin</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Mã NV${!isEdit ? ' <span style="font-weight:400;color:var(--text-2);font-size:12px;">(tự động sinh khi lưu)</span>' : ''}</label><input type="text" id="uf-code" value="${esc(user?.employee_code||'')}" placeholder="-- chọn loại + phòng ban --" readonly disabled/></div>
    <div class="field"><label>Họ tên *</label><input type="text" id="uf-name" value="${esc(user?.full_name||'')}" placeholder="Nguyễn Văn A"/></div>
    <div class="field"><label>Email *</label><input type="email" id="uf-email" value="${esc(user?.email||'')}" placeholder="email@company.com"/></div>
    ${!isEdit ? `<div class="field"><label>Mật khẩu</label><input type="password" id="uf-pw" placeholder="Mặc định: Pass@123"/></div>` : ''}
    <div class="input-row">
      <div class="field"><label>Phòng ban *</label>
        <select id="uf-dept">
          <option value="">-- Chọn phòng ban --</option>
          ${DEPARTMENTS.map(d => `<option value="${esc(d)}" ${user?.department===d?'selected':''}>${esc(d)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Vị trí</label><input type="text" id="uf-pos" value="${esc(user?.position||'')}" placeholder="Designer"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Điện thoại</label><input type="tel" id="uf-phone" value="${esc(user?.phone||'')}"/></div>
      <div class="field"><label>Lương cơ bản</label><input type="number" id="uf-salary" value="${user?.salary||0}"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Ngân hàng</label><input type="text" id="uf-bank" value="${esc(user?.bank_name||'')}"/></div>
      <div class="field"><label>Số TK</label><input type="text" id="uf-acc" value="${esc(user?.bank_account||'')}"/></div>
    </div>
    <div class="field"><label>Màu avatar</label><input type="color" id="uf-color" value="${user?.avatar_color||'#4F46E5'}"/></div>
    ${isEdit ? `<div class="field" style="margin-top:4px;"><label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:500;"><input type="checkbox" id="uf-resetpw"/> Reset mật khẩu về Pass@123</label></div>` : ''}
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="uf-del">Xóa</button>` : ''}
    <button class="btn-primary" id="uf-save">Lưu</button>
  `);

  function refreshCodePreview() {
    if (isEdit) return; // existing code never changes on edit
    const type = document.getElementById('uf-emptype').value;
    const dept = document.getElementById('uf-dept').value;
    document.getElementById('uf-code').value = previewEmployeeCode(allUsers, type, dept) || '';
  }
  document.getElementById('uf-emptype')?.addEventListener('change', refreshCodePreview);
  document.getElementById('uf-dept').addEventListener('change', refreshCodePreview);
  refreshCodePreview();

  document.getElementById('uf-save').addEventListener('click', async () => {
    const name = document.getElementById('uf-name').value.trim();
    const email = document.getElementById('uf-email').value.trim();
    const department = document.getElementById('uf-dept').value;
    if (!name || !email || !department) { toast('Vui lòng điền đầy đủ thông tin bắt buộc', 'error'); return; }
    const data = {
      full_name: name, email,
      employee_type: document.getElementById('uf-emptype').value,
      role: document.getElementById('uf-role').value,
      department,
      position: document.getElementById('uf-pos').value,
      phone: document.getElementById('uf-phone').value,
      salary: parseFloat(document.getElementById('uf-salary').value) || 0,
      bank_name: document.getElementById('uf-bank').value,
      bank_account: document.getElementById('uf-acc').value,
      avatar_color: document.getElementById('uf-color').value,
      is_active: user?.is_active ?? 1,
    };
    if (!isEdit) { const pw = document.getElementById('uf-pw')?.value; if (pw) data.password = pw; }
    if (isEdit) { data.reset_password = document.getElementById('uf-resetpw')?.checked ? 1 : 0; }
    try {
      if (isEdit) await api.updateUser(user.id, data);
      else await api.createUser(data);
      closeModal(); toast(isEdit ? 'Đã cập nhật' : 'Đã tạo nhân viên', 'success'); onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });

  document.getElementById('uf-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa nhân viên "${user.full_name}"? Hành động này không thể hoàn tác.`)) return;
    try { await api.deleteUser(user.id); closeModal(); toast('Đã xóa', 'success'); onRefresh(); }
    catch(e) { toast(e.message, 'error'); }
  });
}
