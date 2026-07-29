import { api } from '../api.js';
import { esc, roleBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, fmtMoney, initials, avatarColor, DEPT_CODE, lifecycleBadge, LIFECYCLE_STATUSES, noop, safeCb, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination } from '../utils.js';

// Preview-only: mirrors server's nextEmployeeCode() logic (server always re-computes
// and confirms the official code on save; this is just live UI feedback).
function previewEmployeeCode(allUsers, type, department) {
  const deptCode = DEPT_CODE[department] || 'KHAC';
  if (!type || !department) return '';
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
    <div class="page-header users-reference-head" style="display:flex;align-items:center;justify-content:space-between;">
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
  let allDepartments = [];
  let currentPage = 1;

  async function loadUsers() {
    const listEl = document.getElementById('user-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    try {
      const [usersRes, deptsRes] = await Promise.allSettled([api.getUsers(), api.getDepartments()]);
      if (usersRes.status === 'rejected') throw usersRes.reason;
      allUsers = usersRes.value.users || [];
      allDepartments = deptsRes.status === 'fulfilled' ? (deptsRes.value.departments || []) : [];
      // Populate dept filter
      const depts = [...new Set([
        ...allDepartments.map(d => d.name).filter(Boolean),
        ...allUsers.map(u => u.department).filter(Boolean),
      ])];
      const filterBar = document.getElementById('user-dept-filter');
      filterBar.innerHTML = '<span class="filter-chip active" data-dept="">Táº¥t cáº£</span>';
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
      <div class="list-item user-reference-row" data-uid="${u.id}" style="${!u.is_active?'opacity:.55':''}">
        <div class="avatar avatar-md" style="background:${esc(u.avatar_color||avatarColor(u.full_name))}">${esc(u.avatar_initials||initials(u.full_name))}</div>
        <div class="list-item-content user-reference-identity">
          <div class="list-item-title">${esc(u.full_name)}</div>
          <div class="list-item-sub">${esc(u.position||u.department||'')} · ${esc(u.employee_code||'')}</div>
          <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">${roleBadge(u.role)}${lifecycleBadge(u.lifecycle_status)}</div>
        </div>
        <div class="user-reference-contact">
          <div style="font-size:12px;color:var(--text-2);margin-bottom:4px;">${esc(u.email)}</div>
          <span class="badge ${u.is_active ? 'badge-success' : 'badge-gray'}" style="font-size:10px;">${u.is_active?'✅ Hoạt động':'⛔ Khóa'}</span>
        </div>
      </div>
    `).join('') + paginationHTML(pageData);
    listEl.querySelectorAll('.list-item').forEach(item => {
      item.addEventListener('click', () => {
        const user = allUsers.find(u => u.id === parseInt(item.dataset.uid));
        if (user) openUserDetail(user, me, loadUsers, allDepartments, allUsers);
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

  document.getElementById('btn-new-user')?.addEventListener('click', () => openUserForm(null, loadUsers, allUsers, allDepartments));

  loadUsers();
}

function openUserDetail(user, me, onRefresh = noop, departments = [], allUsers = []) {
  onRefresh = safeCb(onRefresh);
  const isAdmin = me.role === 'admin';
  const canChangeLifecycle = isHrOrBod(me);
  openModal(user.full_name, `
    <div class="user-profile-hero">
      ${user.avatar_url ? `<img class="user-profile-photo" src="${esc(user.avatar_url)}" alt="Ảnh ${esc(user.full_name)}"/>` : `<div class="avatar avatar-lg" style="background:${esc(user.avatar_color||'#4F46E5')};margin:0 auto 10px;">${esc(user.avatar_initials||initials(user.full_name))}</div>`}
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
    <div class="user-profile-section"><h4>Thông tin cá nhân</h4><div class="detail-grid"><div class="detail-item"><div class="detail-label">Ngày sinh</div><div class="detail-val">${esc(user.birth_date||'—')}</div></div><div class="detail-item"><div class="detail-label">Giới tính</div><div class="detail-val">${esc(user.gender||'—')}</div></div><div class="detail-item"><div class="detail-label">CCCD</div><div class="detail-val">${esc(user.national_id||'—')}</div></div><div class="detail-item"><div class="detail-label">Địa chỉ</div><div class="detail-val">${esc(user.home_address||'—')}</div></div><div class="detail-item"><div class="detail-label">Liên hệ khẩn cấp</div><div class="detail-val">${esc(user.emergency_contact_name||'—')} ${user.emergency_contact_phone ? `· ${esc(user.emergency_contact_phone)}` : ''}</div></div></div></div>
    <div class="user-profile-section"><h4>Công việc & hợp đồng</h4><div class="detail-grid"><div class="detail-item"><div class="detail-label">Quản lý trực tiếp</div><div class="detail-val">${esc(allUsers.find(u=>Number(u.id)===Number(user.direct_manager_id))?.full_name||'—')}</div></div><div class="detail-item"><div class="detail-label">Địa điểm làm việc</div><div class="detail-val">${esc(user.work_location||'—')}</div></div><div class="detail-item"><div class="detail-label">Loại hợp đồng</div><div class="detail-val">${esc(user.contract_type||user.lifecycle_status||'—')}</div></div><div class="detail-item"><div class="detail-label">Ngày ký / thời hạn</div><div class="detail-val">${esc(user.contract_signed_date||'—')} ${user.contract_end_date ? `· đến ${esc(user.contract_end_date)}` : ''}</div></div><div class="detail-item"><div class="detail-label">Ngày chính thức</div><div class="detail-val">${esc(user.official_date||'—')}</div></div><div class="detail-item"><div class="detail-label">Ngày nghỉ</div><div class="detail-val">${esc(user.termination_date||'—')}</div></div></div></div>
    <div class="user-profile-section"><h4>Lương, ngân hàng, thuế & bảo hiểm</h4><div class="detail-grid"><div class="detail-item"><div class="detail-label">Phụ cấp / tổng thu nhập</div><div class="detail-val">${fmtMoney(user.allowance||0)} · ${fmtMoney(Number(user.salary||0)+Number(user.allowance||0))}</div></div><div class="detail-item"><div class="detail-label">Lương đóng BHXH</div><div class="detail-val">${fmtMoney(user.insurance_salary||0)}</div></div><div class="detail-item"><div class="detail-label">Chủ tài khoản</div><div class="detail-val">${esc(user.bank_account_holder||'—')}</div></div><div class="detail-item"><div class="detail-label">Mã số thuế / BHXH</div><div class="detail-val">${esc(user.tax_code||'—')} · ${esc(user.social_insurance_number||'—')}</div></div><div class="detail-item"><div class="detail-label">Nơi KCB BHYT</div><div class="detail-val">${esc(user.insurance_hospital||'—')}</div></div></div></div>
    <div class="user-profile-section"><h4>Hồ sơ đính kèm</h4><div class="user-document-links">${[['CCCD',user.national_id_document_url],['Bằng cấp',user.degree_document_url],['Hợp đồng',user.contract_document_url],['Quyết định nhân sự',user.personnel_decision_url]].map(([label,url]) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : `<span>${label}: Chưa có</span>`).join('')}</div></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>
    ${canChangeLifecycle ? `<button class="btn-secondary" id="ud-lifecycle">🔄 Đổi trạng thái</button>` : ''}
    ${isAdmin ? `<button class="btn-danger" id="ud-lock">${user.is_active ? '🔒 Khóa TK' : '🔓 Mở khóa'}</button>` : ''}
    ${isAdmin ? `<button class="btn-primary" id="ud-edit">✏️ Sửa</button>` : ''}
  `);
  document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--user-detail');
  document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--user-profile');

  document.getElementById('ud-edit')?.addEventListener('click', () => {
    closeModal();
    openUserForm(user, onRefresh, allUsers, departments);
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

function openUserForm(user, onRefresh = noop, allUsers = [], departments = []) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!user;
  const uploadField = (valueId, fileId, label, existing, accept) => `
    <div class="field document-upload-field">
      <label>${label}</label>
      <input type="hidden" id="${valueId}" value="${esc(existing || '')}"/>
      <input type="file" id="${fileId}" accept="${accept}"/>
      <div class="document-upload-status">${existing ? 'Đã lưu trên máy chủ · chọn tệp mới để thay thế' : 'Chưa có tệp'}</div>
    </div>`;
  const departmentNames = [...new Set([
    ...departments.map(d => d.name || d).filter(Boolean),
    ...(user?.department ? [user.department] : []),
  ])].sort((a, b) => String(a).localeCompare(String(b), 'vi'));
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
          ${departmentNames.map(d => `<option value="${esc(d)}" ${user?.department===d?'selected':''}>${esc(d)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Vị trí</label><input type="text" id="uf-pos" value="${esc(user?.position||'')}" placeholder="Designer"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Điện thoại</label><input type="tel" id="uf-phone" value="${esc(user?.phone||'')}"/></div>
      <div class="field"><label>Lương cơ bản</label><input type="number" id="uf-salary" value="${user?.salary||0}"/></div>
    </div>
    <div class="input-row">
      <div class="field user-bank-field">
        <label for="uf-bank">Ngân hàng</label>
        <div class="bank-picker" id="uf-bank-picker">
          <input type="text" id="uf-bank" value="${esc(user?.bank_name||'')}" placeholder="Tìm ngân hàng" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="uf-bank-options"/>
          <div class="bank-picker-menu hidden" id="uf-bank-options" role="listbox" aria-label="Danh sách ngân hàng"></div>
        </div>
      </div>
      <div class="field"><label>Số TK</label><input type="text" inputmode="numeric" id="uf-acc" value="${esc(user?.bank_account||'')}" autocomplete="off"/></div>
    </div>
    <div class="field"><label>Màu avatar</label><input type="color" id="uf-color" value="${user?.avatar_color||'#4F46E5'}"/></div>
    <div class="user-form-section"><h4>Thông tin cá nhân</h4><div class="input-row"><div class="field"><label>Ngày sinh</label><input type="date" id="uf-birth" value="${esc(user?.birth_date||'')}"/></div><div class="field"><label>Giới tính</label><select id="uf-gender"><option value="">-- Chọn --</option>${['Nam','Nữ','Khác'].map(v=>`<option ${user?.gender===v?'selected':''}>${v}</option>`).join('')}</select></div></div><div class="input-row"><div class="field"><label>CCCD</label><input id="uf-national-id" value="${esc(user?.national_id||'')}"/></div>${uploadField('uf-avatar-url', 'uf-avatar-file', 'Ảnh chân dung', user?.avatar_url, 'image/jpeg,image/png,image/webp')}</div><div class="field"><label>Địa chỉ</label><input id="uf-address" value="${esc(user?.home_address||'')}"/></div><div class="input-row"><div class="field"><label>Người liên hệ khẩn cấp</label><input id="uf-emergency-name" value="${esc(user?.emergency_contact_name||'')}"/></div><div class="field"><label>SĐT khẩn cấp</label><input id="uf-emergency-phone" value="${esc(user?.emergency_contact_phone||'')}"/></div></div></div>
    <div class="user-form-section"><h4>Công việc & hợp đồng</h4><div class="input-row"><div class="field"><label>Quản lý trực tiếp</label><select id="uf-manager"><option value="">-- Chưa phân công --</option>${allUsers.filter(u=>Number(u.id)!==Number(user?.id)).map(u=>`<option value="${u.id}" ${Number(user?.direct_manager_id)===Number(u.id)?'selected':''}>${esc(u.full_name)} · ${esc(u.employee_code||'')}</option>`).join('')}</select></div><div class="field"><label>Địa điểm làm việc</label><input id="uf-location" value="${esc(user?.work_location||'')}"/></div></div><div class="input-row"><div class="field"><label>Loại hợp đồng</label><select id="uf-contract-type"><option value="">-- Chọn --</option>${['Thử việc','Cộng tác viên','Chính thức','Thực tập sinh'].map(v=>`<option ${user?.contract_type===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Ngày ký</label><input type="date" id="uf-contract-signed" value="${esc(user?.contract_signed_date||'')}"/></div></div><div class="input-row"><div class="field"><label>Thời hạn đến</label><input type="date" id="uf-contract-end" value="${esc(user?.contract_end_date||'')}"/></div><div class="field"><label>Ngày chuyển chính thức</label><input type="date" id="uf-official-date" value="${esc(user?.official_date||'')}"/></div></div><div class="field"><label>Ngày nghỉ</label><input type="date" id="uf-termination-date" value="${esc(user?.termination_date||'')}"/></div></div>
    <div class="user-form-section"><h4>Lương, ngân hàng, thuế & bảo hiểm</h4><div class="input-row"><div class="field"><label>Phụ cấp</label><input type="number" id="uf-allowance" value="${user?.allowance||0}"/></div><div class="field"><label>Lương đóng BHXH</label><input type="number" id="uf-insurance-salary" value="${user?.insurance_salary||0}"/></div></div><div class="field"><label>Chủ tài khoản</label><input id="uf-bank-holder" value="${esc(user?.bank_account_holder||'')}"/></div><div class="input-row"><div class="field"><label>Mã số thuế</label><input id="uf-tax-code" value="${esc(user?.tax_code||'')}"/></div><div class="field"><label>Mã số BHXH</label><input id="uf-social-insurance" value="${esc(user?.social_insurance_number||'')}"/></div></div><div class="field"><label>Nơi đăng ký KCB</label><input id="uf-insurance-hospital" value="${esc(user?.insurance_hospital||'')}"/></div></div>
    <div class="user-form-section"><h4>Hồ sơ đính kèm</h4><div class="input-row">${uploadField('uf-doc-national', 'uf-doc-national-file', 'CCCD', user?.national_id_document_url, 'application/pdf,image/jpeg,image/png,image/webp')}${uploadField('uf-doc-degree', 'uf-doc-degree-file', 'Bằng cấp', user?.degree_document_url, 'application/pdf,image/jpeg,image/png,image/webp')}</div><div class="input-row">${uploadField('uf-doc-contract', 'uf-doc-contract-file', 'Hợp đồng', user?.contract_document_url, 'application/pdf,image/jpeg,image/png,image/webp')}${uploadField('uf-doc-decision', 'uf-doc-decision-file', 'Quyết định nhân sự', user?.personnel_decision_url, 'application/pdf,image/jpeg,image/png,image/webp')}</div></div>
    ${isEdit ? `<div class="field" style="margin-top:4px;"><label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:500;"><input type="checkbox" id="uf-resetpw"/> Reset mật khẩu về Pass@123</label></div>` : ''}
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="uf-del">Xóa</button>` : ''}
    <button class="btn-primary" id="uf-save">Lưu</button>
  `);
  document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--user-form');
  document.getElementById('modal-overlay')?.classList.add('modal-overlay--desktop-centered');

  const bankInput = document.getElementById('uf-bank');
  const bankPicker = document.getElementById('uf-bank-picker');
  const bankOptions = document.getElementById('uf-bank-options');
  let bankDirectory = [];
  const renderBanks = (query = '') => {
    if (!bankOptions || !bankInput) return;
    const keyword = String(query).trim().toLocaleLowerCase('vi');
    const matches = bankDirectory.filter(bank =>
      !keyword || [bank.shortName, bank.name, bank.code, bank.bin].some(value => String(value || '').toLocaleLowerCase('vi').includes(keyword))
    ).slice(0, 30);
    bankOptions.innerHTML = matches.map(bank => `
      <button type="button" class="bank-picker-option" role="option" data-bank="${esc(bank.shortName)}" aria-selected="${bankInput.value === bank.shortName}">
        ${bank.logo ? `<img src="${esc(bank.logo)}" alt="" loading="lazy"/>` : '<span class="bank-picker-mark" aria-hidden="true">🏦</span>'}
        <strong>${esc(bank.shortName)}</strong>
      </button>`).join('');
    bankOptions.classList.toggle('hidden', matches.length === 0);
    bankInput.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
  };
  const closeBankMenu = () => {
    bankOptions?.classList.add('hidden');
    bankInput?.setAttribute('aria-expanded', 'false');
  };
  api.getVietqrBanks().then(({ banks = [] }) => {
    bankDirectory = banks;
    if (document.activeElement === bankInput) renderBanks(bankInput.value);
  }).catch(() => { bankDirectory = []; });
  bankInput?.addEventListener('focus', () => renderBanks(bankInput.value));
  bankInput?.addEventListener('input', () => renderBanks(bankInput.value));
  bankInput?.addEventListener('keydown', event => { if (event.key === 'Escape') closeBankMenu(); });
  bankOptions?.addEventListener('mousedown', event => {
    const option = event.target.closest('.bank-picker-option');
    if (!option || !bankInput) return;
    event.preventDefault();
    bankInput.value = option.dataset.bank || '';
    closeBankMenu();
  });
  const dismissBankMenu = event => {
    if (!bankPicker?.isConnected) { document.removeEventListener('mousedown', dismissBankMenu); return; }
    if (!bankPicker.contains(event.target)) closeBankMenu();
  };
  document.addEventListener('mousedown', dismissBankMenu);

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
      birth_date: document.getElementById('uf-birth').value,
      gender: document.getElementById('uf-gender').value,
      national_id: document.getElementById('uf-national-id').value,
      home_address: document.getElementById('uf-address').value,
      emergency_contact_name: document.getElementById('uf-emergency-name').value,
      emergency_contact_phone: document.getElementById('uf-emergency-phone').value,
      direct_manager_id: document.getElementById('uf-manager').value || null,
      work_location: document.getElementById('uf-location').value,
      contract_type: document.getElementById('uf-contract-type').value,
      contract_signed_date: document.getElementById('uf-contract-signed').value,
      contract_end_date: document.getElementById('uf-contract-end').value,
      official_date: document.getElementById('uf-official-date').value,
      termination_date: document.getElementById('uf-termination-date').value,
      allowance: parseFloat(document.getElementById('uf-allowance').value) || 0,
      insurance_salary: parseFloat(document.getElementById('uf-insurance-salary').value) || 0,
      bank_account_holder: document.getElementById('uf-bank-holder').value,
      tax_code: document.getElementById('uf-tax-code').value,
      social_insurance_number: document.getElementById('uf-social-insurance').value,
      insurance_hospital: document.getElementById('uf-insurance-hospital').value,
      avatar_url: document.getElementById('uf-avatar-url').value,
      national_id_document_url: document.getElementById('uf-doc-national').value,
      degree_document_url: document.getElementById('uf-doc-degree').value,
      contract_document_url: document.getElementById('uf-doc-contract').value,
      personnel_decision_url: document.getElementById('uf-doc-decision').value,
      is_active: user?.is_active ?? 1,
    };
    if (!isEdit) { const pw = document.getElementById('uf-pw')?.value; if (pw) data.password = pw; }
    if (isEdit) { data.reset_password = document.getElementById('uf-resetpw')?.checked ? 1 : 0; }
    try {
      let targetId = user?.id;
      if (isEdit) await api.updateUser(targetId, data);
      else targetId = (await api.createUser(data)).id;
      const uploads = [
        ['avatar', 'uf-avatar-file'], ['national_id', 'uf-doc-national-file'], ['degree', 'uf-doc-degree-file'],
        ['contract', 'uf-doc-contract-file'], ['decision', 'uf-doc-decision-file'],
      ];
      for (const [kind, fieldId] of uploads) {
        const file = document.getElementById(fieldId)?.files?.[0];
        if (file) await api.uploadUserDocument(targetId, kind, file);
      }
      closeModal(); toast(isEdit ? 'Đã cập nhật' : 'Đã tạo nhân viên', 'success'); onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });

  document.getElementById('uf-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa nhân viên "${user.full_name}"? Hành động này không thể hoàn tác.`)) return;
    try { await api.deleteUser(user.id); closeModal(); toast('Đã xóa', 'success'); onRefresh(); }
    catch(e) { toast(e.message, 'error'); }
  });
}
