import { api } from '../api.js';
import {
  esc, toast, openModal, closeModal, loadingHTML, emptyHTML, fmtMoney, fmtDate,
  fmtDateTime, initials, avatarColor, lifecycleBadge, LIFECYCLE_STATUSES, safeCb, isHcnsDepartment,
} from '../utils.js?v=20260811-hr-access-v1';
import { icon } from '../icons.js';
import { navigate, invalidateView } from '../app.js';

const FIELD_LABELS = {
  full_name: 'Họ và tên', email: 'Email', phone: 'Số điện thoại', birth_date: 'Ngày sinh',
  gender: 'Giới tính', national_id: 'Số CCCD', national_id_expiry_date: 'Hạn CCCD',
  home_address: 'Địa chỉ liên hệ', school_name: 'Trường học',
  emergency_contact_name: 'Người liên hệ khẩn cấp', emergency_contact_phone: 'SĐT khẩn cấp',
  employee_type: 'Loại nhân sự', position: 'Vị trí', department: 'Phòng ban',
  direct_manager_id: 'Quản lý trực tiếp', work_location: 'Địa điểm làm việc',
  contract_type: 'Loại hợp đồng', hire_date: 'Ngày vào làm',
  contract_start_date: 'Ngày bắt đầu hợp đồng', contract_end_date: 'Ngày hết hạn hợp đồng',
  contract_signed_date: 'Ngày ký hợp đồng', probation_end_date: 'Ngày kết thúc thử việc',
  official_date: 'Ngày chính thức', termination_date: 'Ngày nghỉ việc',
  salary: 'Lương cơ bản', allowance: 'Phụ cấp', insurance_salary: 'Lương đóng BHXH',
  dependent_count: 'Số người phụ thuộc', bank_account: 'Số tài khoản', bank_name: 'Ngân hàng',
  bank_account_holder: 'Chủ tài khoản', tax_code: 'Mã số thuế',
  social_insurance_number: 'Số BHXH', insurance_hospital: 'Nơi đăng ký KCB BHYT',
  lifecycle_status: 'Trạng thái nhân sự',
};

const REQUIRED_PROFILE_FIELDS = [
  'full_name', 'email', 'phone', 'birth_date', 'national_id', 'home_address',
  'position', 'department', 'direct_manager_id', 'work_location', 'contract_type', 'hire_date',
];

const TAB_ITEMS = [
  ['overview', 'Tổng quan'],
  ['employment', 'Công việc & hợp đồng'],
  ['compensation', 'Lương & BHXH'],
  ['documents', 'Tài liệu'],
  ['timeline', 'Timeline'],
  ['audit', 'Nhật ký'],
];

function isHr(user) {
  return user?.role === 'admin' || isHcnsDepartment(user?.department);
}

function avatarMarkup(user, size = 'md') {
  const fallback = `<span class="avatar avatar-${size}" style="background:${esc(user.avatar_color || avatarColor(user.full_name))}">${esc(user.avatar_initials || initials(user.full_name))}</span>`;
  if (!user.avatar_url) return fallback;
  return `<span class="employee-avatar-wrap">${fallback}<img class="employee-avatar-img avatar-${size}" src="${esc(user.avatar_url)}" alt="Ảnh đại diện ${esc(user.full_name)}" loading="lazy" onerror="this.remove()"/></span>`;
}

function valueOrEmpty(value, formatter = null) {
  if (value === null || value === undefined || value === '') return '<span class="profile-empty-value">Chưa cập nhật</span>';
  return esc(formatter ? formatter(value) : value);
}

function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function detailItem(label, value, formatter = null) {
  return `<div class="employee-detail-item"><dt>${esc(label)}</dt><dd>${valueOrEmpty(value, formatter)}</dd></div>`;
}

function profileCompletion(user) {
  const filled = REQUIRED_PROFILE_FIELDS.filter(field => user[field] !== null && user[field] !== undefined && String(user[field]).trim() !== '').length;
  return Math.round((filled / REQUIRED_PROFILE_FIELDS.length) * 100);
}

function bindUnsavedWarning(cancelButtonId) {
  const modalBody = document.getElementById('modal-body');
  const closeButton = document.getElementById('modal-close');
  const cancelButton = document.getElementById(cancelButtonId);
  let dirty = false;
  let committed = false;
  const markDirty = () => { dirty = true; };
  const beforeUnload = event => {
    if (!dirty || committed) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const cleanup = () => {
    modalBody?.removeEventListener('input', markDirty);
    modalBody?.removeEventListener('change', markDirty);
    closeButton?.removeEventListener('click', confirmClose, true);
    cancelButton?.removeEventListener('click', confirmClose, true);
    window.removeEventListener('beforeunload', beforeUnload);
  };
  const confirmClose = event => {
    if (dirty && !committed && !confirm('Bạn có thay đổi chưa lưu. Bạn có chắc muốn đóng?')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    cleanup();
  };
  modalBody?.addEventListener('input', markDirty);
  modalBody?.addEventListener('change', markDirty);
  closeButton?.addEventListener('click', confirmClose, true);
  cancelButton?.addEventListener('click', confirmClose, true);
  window.addEventListener('beforeunload', beforeUnload);
  return {
    commit() {
      committed = true;
      cleanup();
    },
  };
}

export async function renderUsers(el, me, route = {}) {
  const employeeId = Number(route.segments?.[1] || 0);
  if (employeeId) return renderEmployeeProfile(el, me, employeeId, route);
  return renderEmployeeDirectory(el, me);
}

async function renderEmployeeDirectory(el, me) {
  const canOpen = me.role === 'admin' || me.role === 'manager' || isHcnsDepartment(me.department);
  if (!canOpen) {
    el.innerHTML = emptyHTML('', 'Bạn không có quyền truy cập danh sách nhân viên');
    return;
  }

  const state = {
    search: '', department: '', status: '', contract_type: '', position: '',
    page: 1, page_size: 20, loading: false, request: 0,
  };
  let searchTimer = null;
  let filterOptions = { departments: [], positions: [], contract_types: [], statuses: [] };

  el.innerHTML = `
    <section class="employee-directory">
      <header class="employee-page-header">
        <div>
          <p class="employee-page-kicker">Quản lý nhân sự</p>
          <h1>Hồ sơ nhân viên</h1>
          <p>Theo dõi thông tin cá nhân, hợp đồng, lương và hồ sơ đính kèm.</p>
        </div>
        <div class="employee-header-actions">
          ${isHr(me) ? `<button class="btn-secondary" id="employee-export">${icon('arrowDown', 'sm')} Xuất Excel</button>` : ''}
          ${isHr(me) ? `<button class="btn-primary" id="employee-create">${icon('plus', 'sm')} Thêm nhân viên</button>` : ''}
        </div>
      </header>
      <div class="employee-toolbar" aria-label="Tìm kiếm và lọc nhân viên">
        <label class="employee-search">
          <span class="sr-only">Tìm kiếm nhân viên</span>
          ${icon('search', 'sm')}
          <input id="employee-search" type="search" placeholder="Tìm theo tên, mã, email, phòng ban hoặc vị trí" autocomplete="off"/>
        </label>
        <select id="employee-filter-department" aria-label="Lọc theo phòng ban"><option value="">Tất cả phòng ban</option></select>
        <select id="employee-filter-status" aria-label="Lọc theo trạng thái"><option value="">Tất cả trạng thái</option></select>
        <select id="employee-filter-contract" aria-label="Lọc theo loại hợp đồng"><option value="">Tất cả hợp đồng</option></select>
        <select id="employee-filter-position" aria-label="Lọc theo vị trí"><option value="">Tất cả vị trí</option></select>
        <button class="btn-secondary btn-sm" id="employee-filter-reset">${icon('refreshCw', 'sm')} Xóa lọc</button>
      </div>
      <div id="employee-directory-result">${loadingHTML()}</div>
    </section>`;

  const optionHtml = (values, selected) => values.map(value =>
    `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`
  ).join('');

  function syncFilterOptions() {
    const definitions = [
      ['employee-filter-department', 'Tất cả phòng ban', filterOptions.departments, state.department],
      ['employee-filter-status', 'Tất cả trạng thái', filterOptions.statuses, state.status],
      ['employee-filter-contract', 'Tất cả hợp đồng', filterOptions.contract_types, state.contract_type],
      ['employee-filter-position', 'Tất cả vị trí', filterOptions.positions, state.position],
    ];
    definitions.forEach(([id, label, values, selected]) => {
      const select = document.getElementById(id);
      if (select) select.innerHTML = `<option value="">${label}</option>${optionHtml(values, selected)}`;
    });
  }

  async function loadDirectory() {
    const result = document.getElementById('employee-directory-result');
    if (!result) return;
    const requestId = ++state.request;
    state.loading = true;
    result.setAttribute('aria-busy', 'true');
    if (!result.querySelector('.employee-data-table')) result.innerHTML = loadingHTML();
    try {
      const response = await api.getEmployeeDirectory(state);
      if (requestId !== state.request || !result.isConnected) return;
      filterOptions = response.filter_options || filterOptions;
      syncFilterOptions();
      renderRows(response.users || [], response.pagination || {});
    } catch (error) {
      if (requestId === state.request) result.innerHTML = emptyHTML('', error.message, 'Thử tải lại trang hoặc kiểm tra quyền truy cập.');
    } finally {
      if (requestId === state.request) {
        state.loading = false;
        result.removeAttribute('aria-busy');
      }
    }
  }

  function renderRows(users, pagination) {
    const result = document.getElementById('employee-directory-result');
    if (!result) return;
    if (!users.length) {
      result.innerHTML = emptyHTML('', 'Không tìm thấy nhân viên', 'Hãy thay đổi từ khóa hoặc bộ lọc.');
      return;
    }
    result.innerHTML = `
      <div class="employee-table-wrap">
        <table class="employee-data-table">
          <thead><tr>
            <th>Nhân viên</th><th>Loại nhân sự</th><th>Phòng ban</th><th>Vị trí</th>
            <th>Hợp đồng</th><th>Trạng thái</th><th><span class="sr-only">Mở hồ sơ</span></th>
          </tr></thead>
          <tbody>${users.map(user => `
            <tr data-user-id="${user.id}" tabindex="0" role="link" aria-label="Mở hồ sơ ${esc(user.full_name)}">
              <td data-label="Nhân viên">
                <div class="employee-table-person">${avatarMarkup(user)}
                  <div><strong>${esc(user.full_name)}</strong><span>${esc(user.employee_code || '')}<br/>${esc(user.email || '')}</span></div>
                </div>
              </td>
              <td data-label="Loại nhân sự"><span class="employee-type-badge">${user.employee_type === 'TTS' ? 'Thực tập sinh' : 'Nhân viên'}</span></td>
              <td data-label="Phòng ban">${valueOrEmpty(user.department)}</td>
              <td data-label="Vị trí">${valueOrEmpty(user.position)}</td>
              <td data-label="Hợp đồng"><strong class="employee-cell-primary">${valueOrEmpty(user.contract_type)}</strong>${user.contract_end_date ? `<span class="employee-cell-secondary">Đến ${esc(fmtDate(user.contract_end_date))}</span>` : ''}</td>
              <td data-label="Trạng thái">${lifecycleBadge(user.lifecycle_status)}</td>
              <td class="employee-row-action">${icon('arrowRight', 'sm')}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <footer class="employee-pagination">
        <span>${pagination.total || 0} nhân sự, trang ${pagination.page || 1}/${pagination.pages || 1}</span>
        <div>
          <button class="btn-secondary btn-sm" id="employee-prev" ${(pagination.page || 1) <= 1 ? 'disabled' : ''}>Trước</button>
          <button class="btn-secondary btn-sm" id="employee-next" ${(pagination.page || 1) >= (pagination.pages || 1) ? 'disabled' : ''}>Sau</button>
        </div>
      </footer>`;
    result.querySelectorAll('tbody tr[data-user-id]').forEach(row => {
      const open = () => navigate(`#/users/${row.dataset.userId}`);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
    document.getElementById('employee-prev')?.addEventListener('click', () => { state.page--; loadDirectory(); });
    document.getElementById('employee-next')?.addEventListener('click', () => { state.page++; loadDirectory(); });
  }

  document.getElementById('employee-search')?.addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      loadDirectory();
    }, 280);
  });
  [
    ['employee-filter-department', 'department'],
    ['employee-filter-status', 'status'],
    ['employee-filter-contract', 'contract_type'],
    ['employee-filter-position', 'position'],
  ].forEach(([id, field]) => document.getElementById(id)?.addEventListener('change', event => {
    state[field] = event.target.value;
    state.page = 1;
    loadDirectory();
  }));
  document.getElementById('employee-filter-reset')?.addEventListener('click', () => {
    Object.assign(state, { search: '', department: '', status: '', contract_type: '', position: '', page: 1 });
    const search = document.getElementById('employee-search');
    if (search) search.value = '';
    syncFilterOptions();
    loadDirectory();
  });
  document.getElementById('employee-export')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { blob, filename } = await api.exportEmployeeDirectory(state);
      downloadBlob(blob, filename || 'danh-sach-nhan-vien.xls');
      toast('Đã xuất danh sách nhân viên', 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  document.getElementById('employee-create')?.addEventListener('click', async () => {
    try {
      const [people, departments] = await Promise.all([api.getUsersBasic(), api.getDepartments()]);
      openCreateEmployee(people.users || [], departments.departments || [], () => {
        state.page = 1;
        loadDirectory();
      });
    } catch (error) { toast(error.message, 'error'); }
  });

  el._cleanup = () => clearTimeout(searchTimer);
  await loadDirectory();
}

async function renderEmployeeProfile(el, me, employeeId, route = {}) {
  el.innerHTML = `<section class="employee-profile-page">${loadingHTML()}</section>`;
  let response;
  let basicUsers = [];
  let departments = [];
  try {
    const [profileResult, usersResult, departmentsResult] = await Promise.allSettled([
      api.getEmployeeProfile(employeeId), api.getUsersBasic(), api.getDepartments(),
    ]);
    if (profileResult.status === 'rejected') throw profileResult.reason;
    response = profileResult.value;
    basicUsers = usersResult.status === 'fulfilled' ? (usersResult.value.users || []) : [];
    departments = departmentsResult.status === 'fulfilled' ? (departmentsResult.value.departments || []) : [];
  } catch (error) {
    el.innerHTML = `<section class="employee-profile-page"><button class="employee-back-link" id="employee-back">${icon('arrowLeft', 'sm')} Danh sách nhân viên</button>${emptyHTML('', error.message)}</section>`;
    el.querySelector('#employee-back')?.addEventListener('click', () => navigate('#/users'));
    return;
  }

  const user = response.user;
  const permissions = response.permissions || {};
  const metadata = response.metadata || {};
  const completion = response.completion?.percent ?? (Number(me.id) === Number(user.id) ? profileCompletion(user) : null);
  const requestedTab = String(route.segments?.[2] || 'overview');
  const availableTabs = TAB_ITEMS.filter(([key]) => key !== 'audit' || permissions.can_view_audit)
    .filter(([key]) => key !== 'compensation' || Object.prototype.hasOwnProperty.call(user, 'salary'))
    .map(([key]) => key);
  let activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'overview';

  el.innerHTML = `
    <section class="employee-profile-page" id="employee-print-root">
      <button class="employee-back-link print-hidden" id="employee-back">${icon('arrowLeft', 'sm')} Danh sách nhân viên</button>
      <header class="employee-profile-header">
        <div class="employee-profile-identity">
          <div class="employee-profile-avatar">${avatarMarkup(user, 'lg')}${permissions.can_manage_avatar ? `<button class="employee-avatar-edit print-hidden" id="employee-avatar-edit" aria-label="Cập nhật ảnh đại diện">${icon('pencil', 'xs')}</button>` : ''}</div>
          <div>
            <div class="employee-profile-meta">${esc(user.employee_code || '')} <span>${user.employee_type === 'TTS' ? 'Thực tập sinh' : 'Nhân viên'}</span></div>
            <h1>${esc(user.full_name)}</h1>
            <p>${esc(user.position || 'Chưa cập nhật vị trí')}<br class="profile-mobile-break"/> <span>${esc(user.department || 'Chưa cập nhật phòng ban')}</span></p>
          </div>
        </div>
        <div class="employee-profile-actions print-hidden">
          <button class="btn-secondary" id="employee-print">${icon('fileText', 'sm')} Xuất PDF</button>
          ${isHr(me) ? `<button class="btn-secondary" id="employee-lifecycle">${icon('refreshCw', 'sm')} Đổi trạng thái</button>` : ''}
          ${me.role === 'admin' && Number(user.id) !== Number(me.id) ? `<button class="btn-secondary" id="employee-reset-password">${icon('keyRound', 'sm')} Reset mật khẩu</button>` : ''}
        </div>
        <div class="employee-profile-status">
          <div>${lifecycleBadge(user.lifecycle_status)}</div>
          ${completion === null ? '' : `<div class="employee-completion"><strong>${completion}%</strong><span>hoàn thiện hồ sơ</span></div>`}
        </div>
      </header>
      <nav class="employee-profile-tabs print-hidden" aria-label="Nội dung hồ sơ">
        ${TAB_ITEMS.filter(([key]) => availableTabs.includes(key))
          .map(([key, label]) => `<button data-profile-tab="${key}" class="${key === activeTab ? 'active' : ''}">${esc(label)}</button>`).join('')}
      </nav>
      <div id="employee-profile-content"></div>
    </section>`;

  const $ = selector => el.querySelector(selector);
  const $$ = selector => el.querySelectorAll(selector);
  const managerName = () => basicUsers.find(item => Number(item.id) === Number(user.direct_manager_id))?.full_name || '';

  function renderTab() {
    const content = $('#employee-profile-content');
    if (!content) return;
    $$('[data-profile-tab]').forEach(button => button.classList.toggle('active', button.dataset.profileTab === activeTab));
    if (activeTab === 'overview') {
      content.innerHTML = `
        <div class="employee-profile-section-head"><div><h2>Thông tin cá nhân</h2><p>Thông tin nhận diện và liên hệ của nhân viên.</p></div>
          ${permissions.can_edit_personal ? `<button class="btn-secondary btn-sm print-hidden" id="employee-edit-personal">${icon('pencil', 'sm')} Chỉnh sửa</button>` : ''}</div>
        <dl class="employee-detail-grid">
          ${detailItem('Mã nhân viên', user.employee_code)}
          ${detailItem('Họ và tên', user.full_name)}
          ${detailItem('Email', user.email)}
          ${detailItem('Số điện thoại', user.phone)}
          ${Object.prototype.hasOwnProperty.call(user, 'birth_date') ? detailItem('Ngày sinh', user.birth_date, fmtDate) : ''}
          ${Object.prototype.hasOwnProperty.call(user, 'national_id') ? detailItem('Số CCCD', user.national_id) : ''}
          ${Object.prototype.hasOwnProperty.call(user, 'national_id_expiry_date') ? detailItem('Hạn CCCD', user.national_id_expiry_date, fmtDate) : ''}
          ${Object.prototype.hasOwnProperty.call(user, 'home_address') ? detailItem('Địa chỉ liên hệ', user.home_address) : ''}
          ${user.employee_type === 'TTS' && Object.prototype.hasOwnProperty.call(user, 'school_name') ? detailItem('Trường học', user.school_name) : ''}
          ${Object.prototype.hasOwnProperty.call(user, 'emergency_contact_name') ? detailItem('Liên hệ khẩn cấp', [user.emergency_contact_name, user.emergency_contact_phone].filter(Boolean).join(' - ')) : ''}
        </dl>`;
      $('#employee-edit-personal')?.addEventListener('click', () =>
        openProfileEditor(user, 'personal', { permissions, departments, basicUsers, metadata }, refreshProfile)
      );
      return;
    }
    if (activeTab === 'employment') {
      content.innerHTML = `
        <div class="employee-profile-section-head"><div><h2>Công việc & hợp đồng</h2><p>Thông tin điều động, quản lý và hiệu lực hợp đồng.</p></div>
          ${permissions.can_edit_employment ? `<button class="btn-secondary btn-sm print-hidden" id="employee-edit-employment">${icon('pencil', 'sm')} Chỉnh sửa</button>` : ''}</div>
        <dl class="employee-detail-grid">
          ${detailItem('Loại nhân sự', user.employee_type === 'TTS' ? 'Thực tập sinh' : 'Nhân viên')}
          ${detailItem('Vị trí', user.position)}
          ${detailItem('Phòng ban', user.department)}
          ${detailItem('Quản lý trực tiếp', managerName())}
          ${detailItem('Địa điểm làm việc', user.work_location)}
          ${detailItem('Loại hợp đồng', user.contract_type)}
          ${detailItem('Ngày vào làm', user.hire_date, fmtDate)}
          ${detailItem('Ngày bắt đầu hợp đồng', user.contract_start_date, fmtDate)}
          ${detailItem('Ngày ký hợp đồng', user.contract_signed_date, fmtDate)}
          ${detailItem('Ngày hết hạn hợp đồng', user.contract_end_date, fmtDate)}
          ${detailItem('Kết thúc thử việc', user.probation_end_date, fmtDate)}
          ${detailItem('Ngày chính thức', user.official_date, fmtDate)}
          ${user.lifecycle_status === 'Đã nghỉ' ? detailItem('Ngày nghỉ việc', user.termination_date, fmtDate) : ''}
        </dl>`;
      $('#employee-edit-employment')?.addEventListener('click', () =>
        openProfileEditor(user, 'employment', { permissions, departments, basicUsers, metadata }, refreshProfile)
      );
      return;
    }
    if (activeTab === 'compensation') {
      content.innerHTML = `
        <div class="employee-profile-section-head"><div><h2>Lương, ngân hàng & BHXH</h2><p>Dữ liệu nhạy cảm, chỉ HCNS và Admin được cập nhật.</p></div>
          ${permissions.can_edit_compensation ? `<button class="btn-secondary btn-sm print-hidden" id="employee-edit-compensation">${icon('pencil', 'sm')} Chỉnh sửa</button>` : ''}</div>
        <dl class="employee-detail-grid">
          ${detailItem('Lương cơ bản', user.salary, fmtMoney)}
          ${detailItem('Phụ cấp', user.allowance, fmtMoney)}
          ${detailItem('Tổng thu nhập', Number(user.salary || 0) + Number(user.allowance || 0), fmtMoney)}
          ${detailItem('Lương đóng BHXH', user.insurance_salary, fmtMoney)}
          ${detailItem('Số người phụ thuộc', user.dependent_count)}
          ${detailItem('Số tài khoản', user.bank_account)}
          ${detailItem('Ngân hàng', user.bank_name)}
          ${detailItem('Chủ tài khoản', user.bank_account_holder)}
          ${detailItem('Mã số thuế', user.tax_code)}
          ${detailItem('Số BHXH', user.social_insurance_number)}
          ${detailItem('Nơi đăng ký KCB BHYT', user.insurance_hospital)}
        </dl>`;
      $('#employee-edit-compensation')?.addEventListener('click', () =>
        openProfileEditor(user, 'compensation', { permissions, departments, basicUsers, metadata }, refreshProfile)
      );
      return;
    }
    if (activeTab === 'documents') return renderDocumentsTab(content, user, permissions);
    if (activeTab === 'timeline') return renderTimelineTab(content, user);
    if (activeTab === 'audit') return renderAuditTab(content, user);
  }

  async function refreshProfile() {
    invalidateView('users');
    window.dispatchEvent(new Event('hashchange'));
  }

  $('#employee-back')?.addEventListener('click', () => navigate('#/users'));
  $$('[data-profile-tab]').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.profileTab;
    renderTab();
  }));
  $('#employee-print')?.addEventListener('click', () => {
    const content = $('#employee-profile-content');
    if (!content) return;
    const previousTab = activeTab;
    content.innerHTML = `
      <div class="employee-profile-section-head"><div><h2>Thông tin cá nhân</h2></div></div>
      <dl class="employee-detail-grid">
        ${detailItem('Mã nhân viên', user.employee_code)}${detailItem('Họ và tên', user.full_name)}
        ${detailItem('Email', user.email)}${detailItem('Số điện thoại', user.phone)}
        ${detailItem('Ngày sinh', user.birth_date, fmtDate)}${detailItem('Số CCCD', user.national_id)}
        ${detailItem('Hạn CCCD', user.national_id_expiry_date, fmtDate)}${detailItem('Địa chỉ liên hệ', user.home_address)}
        ${user.employee_type === 'TTS' ? detailItem('Trường học', user.school_name) : ''}
      </dl>
      <div class="employee-profile-section-head employee-print-section"><div><h2>Công việc & hợp đồng</h2></div></div>
      <dl class="employee-detail-grid">
        ${detailItem('Vị trí', user.position)}${detailItem('Phòng ban', user.department)}
        ${detailItem('Quản lý trực tiếp', managerName())}${detailItem('Địa điểm làm việc', user.work_location)}
        ${detailItem('Loại hợp đồng', user.contract_type)}${detailItem('Ngày vào làm', user.hire_date, fmtDate)}
        ${detailItem('Ngày hết hạn hợp đồng', user.contract_end_date, fmtDate)}${detailItem('Ngày chính thức', user.official_date, fmtDate)}
        ${user.lifecycle_status === 'Đã nghỉ' ? detailItem('Ngày nghỉ việc', user.termination_date, fmtDate) : ''}
      </dl>
      ${Object.prototype.hasOwnProperty.call(user, 'salary') ? `
        <div class="employee-profile-section-head employee-print-section"><div><h2>Lương & BHXH</h2></div></div>
        <dl class="employee-detail-grid">
          ${detailItem('Lương cơ bản', user.salary, fmtMoney)}${detailItem('Phụ cấp', user.allowance, fmtMoney)}
          ${detailItem('Lương đóng BHXH', user.insurance_salary, fmtMoney)}${detailItem('Số người phụ thuộc', user.dependent_count)}
          ${detailItem('Ngân hàng', user.bank_name)}${detailItem('Số tài khoản', user.bank_account)}
          ${detailItem('Số BHXH', user.social_insurance_number)}${detailItem('Nơi đăng ký KCB BHYT', user.insurance_hospital)}
        </dl>` : ''}`;
    window.print();
    setTimeout(() => { activeTab = previousTab; renderTab(); }, 0);
  });
  $('#employee-lifecycle')?.addEventListener('click', () => openLifecycleEditor(user, refreshProfile));
  $('#employee-avatar-edit')?.addEventListener('click', () => openAvatarEditor(user, refreshProfile));
  $('#employee-reset-password')?.addEventListener('click', async event => {
    if (!confirm(`Reset mật khẩu của ${user.full_name} về “Pass@123”? Nhân viên sẽ phải đổi mật khẩu sau khi đăng nhập.`)) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.updateUser(user.id, { reset_password: true });
      toast('Đã reset mật khẩu. Nhân viên cần đổi mật khẩu sau khi đăng nhập.', 'success');
    } catch (error) {
      toast(error.message || 'Không thể reset mật khẩu', 'error');
    } finally {
      button.disabled = false;
    }
  });
  renderTab();
}

async function renderDocumentsTab(content, user, permissions) {
  content.innerHTML = `<div class="employee-profile-section-head"><div><h2>Hồ sơ đính kèm</h2><p>PDF, JPG, PNG hoặc WebP, tối đa 10 MB mỗi tệp.</p></div>
    ${permissions.can_manage_documents ? `<button class="btn-primary btn-sm print-hidden" id="employee-document-add">${icon('plus', 'sm')} Thêm tài liệu</button>` : ''}</div>
    <div id="employee-documents-list">${loadingHTML()}</div>`;
  const list = content.querySelector('#employee-documents-list');
  try {
    const response = await api.getEmployeeDocuments(user.id);
    const documents = response.documents || [];
    if (!documents.length) {
      list.innerHTML = emptyHTML('', 'Chưa có tài liệu', permissions.can_manage_documents ? 'Chọn “Thêm tài liệu” để tải hồ sơ lên.' : '');
    } else {
      list.innerHTML = `<div class="employee-document-list">${documents.map(document => `
        <article class="employee-document-row">
          <div class="employee-document-icon">${icon('fileText', 'md')}</div>
          <div class="employee-document-info"><strong>${esc(document.title || document.category_label)}</strong>
            <span>${esc(document.original_filename)}<br/>${Math.max(1, Math.round(Number(document.byte_size || 0) / 1024))} KB, tải lên ${esc(fmtDateTime(document.uploaded_at))}</span>
            ${document.expires_on ? `<em>Hết hạn ${esc(fmtDate(document.expires_on))}</em>` : ''}
          </div>
          <div class="employee-document-actions print-hidden">
            <button class="btn-secondary btn-sm" data-doc-preview="${document.id}">${icon('eye', 'sm')} Xem</button>
            <button class="btn-secondary btn-sm" data-doc-download="${document.id}">${icon('arrowDown', 'sm')} Tải</button>
            ${permissions.can_manage_documents ? `<button class="btn-danger btn-sm" data-doc-delete="${document.id}" data-doc-name="${esc(document.original_filename)}">${icon('trash2', 'sm')} Xóa</button>` : ''}
          </div>
        </article>`).join('')}</div>`;
    }
    list.querySelectorAll('[data-doc-preview]').forEach(button => button.addEventListener('click', async () => {
      const previewWindow = window.open('', '_blank');
      if (previewWindow) previewWindow.opener = null;
      button.disabled = true;
      try {
        const { blob } = await api.getEmployeeDocumentBlob(user.id, button.dataset.docPreview, 'inline');
        const href = URL.createObjectURL(blob);
        if (previewWindow) previewWindow.location.replace(href);
        else window.location.assign(href);
        setTimeout(() => URL.revokeObjectURL(href), 60000);
      } catch (error) {
        previewWindow?.close();
        toast(error.message, 'error');
      }
      finally { button.disabled = false; }
    }));
    list.querySelectorAll('[data-doc-download]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const document = documents.find(item => item.id === button.dataset.docDownload);
        const { blob, filename } = await api.getEmployeeDocumentBlob(user.id, button.dataset.docDownload, 'attachment');
        downloadBlob(blob, filename || document?.original_filename || 'tai-lieu');
      } catch (error) { toast(error.message, 'error'); }
      finally { button.disabled = false; }
    }));
    list.querySelectorAll('[data-doc-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm(`Xóa tài liệu "${button.dataset.docName}"? Tệp sẽ bị xóa khỏi kho lưu trữ và thao tác được ghi vào nhật ký.`)) return;
      button.disabled = true;
      try {
        await api.deleteEmployeeDocument(user.id, button.dataset.docDelete);
        toast('Đã xóa tài liệu', 'success');
        renderDocumentsTab(content, user, permissions);
      } catch (error) { toast(error.message, 'error'); button.disabled = false; }
    }));
    content.querySelector('#employee-document-add')?.addEventListener('click', () =>
      openDocumentUpload(user, response.categories || {}, () => renderDocumentsTab(content, user, permissions))
    );
  } catch (error) {
    list.innerHTML = emptyHTML('', error.message);
  }
}

async function renderTimelineTab(content, user) {
  content.innerHTML = `<div class="employee-profile-section-head"><div><h2>Timeline nhân sự</h2><p>Lịch sử từ ngày vào làm đến các thay đổi nhân sự.</p></div></div>
    <div id="employee-timeline">${loadingHTML()}</div>`;
  const target = content.querySelector('#employee-timeline');
  try {
    const { timeline = [] } = await api.getEmployeeTimeline(user.id);
    target.innerHTML = timeline.length ? `<ol class="employee-timeline">${timeline.map(event => `
      <li><div class="employee-timeline-date">${esc(fmtDateTime(event.event_date))}</div>
        <div><strong>${esc(event.title)}</strong>${event.description ? `<p>${esc(event.description)}</p>` : ''}
        ${event.actor_name ? `<span>Thực hiện bởi ${esc(event.actor_name)}</span>` : ''}</div></li>`).join('')}</ol>`
      : emptyHTML('', 'Chưa có sự kiện trong timeline');
  } catch (error) { target.innerHTML = emptyHTML('', error.message); }
}

async function renderAuditTab(content, user) {
  content.innerHTML = `<div class="employee-profile-section-head"><div><h2>Nhật ký thay đổi</h2><p>Mỗi trường chỉnh sửa được ghi cùng người thực hiện và thời gian.</p></div></div>
    <div id="employee-audit">${loadingHTML()}</div>`;
  const target = content.querySelector('#employee-audit');
  try {
    const { audit = [] } = await api.getEmployeeAudit(user.id);
    target.innerHTML = audit.length ? `<div class="employee-audit-list">${audit.map(entry => `
      <article><div><strong>${esc(FIELD_LABELS[entry.field_name] || entry.field_name)}</strong>
        <span>${esc(entry.changed_by_name || 'Hệ thống')}, ${esc(fmtDateTime(entry.changed_at))}</span></div>
        <div class="employee-audit-change"><span>${valueOrEmpty(entry.old_value)}</span>${icon('arrowRight', 'sm')}<strong>${valueOrEmpty(entry.new_value)}</strong></div>
      </article>`).join('')}</div>` : emptyHTML('', 'Chưa có thay đổi được ghi nhận');
  } catch (error) { target.innerHTML = emptyHTML('', error.message); }
}

function openProfileEditor(user, section, context, onSaved) {
  onSaved = safeCb(onSaved);
  const { permissions, departments, basicUsers, metadata } = context;
  const departmentNames = departments.map(item => item.name).filter(Boolean);
  const field = (id, label, type = 'text', value = '', extra = '') => `
    <label class="field"><span>${esc(label)}</span><input id="${id}" type="${type}" value="${esc(value ?? '')}" ${extra}/><small class="field-error" data-error-for="${id}"></small></label>`;
  let body = '';
  if (section === 'personal') {
    body = `<div class="employee-edit-grid">
      ${field('ep-full-name','Họ và tên *','text',user.full_name,'required')}
      ${field('ep-email','Email *','email',user.email,'required')}
      ${field('ep-phone','Số điện thoại *','tel',user.phone,'required inputmode="tel"')}
      ${field('ep-birth','Ngày sinh *','date',user.birth_date,'required')}
      <label class="field"><span>Giới tính</span><select id="ep-gender"><option value="">Chọn</option>${['Nam','Nữ','Khác'].map(value => `<option ${user.gender === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      ${field('ep-national-id','Số CCCD *','text',user.national_id,'required inputmode="numeric"')}
      ${field('ep-national-expiry','Hạn CCCD','date',user.national_id_expiry_date)}
      ${field('ep-address','Địa chỉ liên hệ *','text',user.home_address,'required')}
      ${user.employee_type === 'TTS' ? field('ep-school','Trường học','text',user.school_name) : ''}
      ${field('ep-emergency-name','Người liên hệ khẩn cấp','text',user.emergency_contact_name)}
      ${field('ep-emergency-phone','SĐT khẩn cấp','tel',user.emergency_contact_phone)}
    </div>`;
  } else if (section === 'employment') {
    body = `<div class="employee-edit-grid">
      ${permissions.can_edit_contract ? `<label class="field"><span>Loại nhân sự *</span><select id="ep-type"><option value="NV" ${user.employee_type !== 'TTS' ? 'selected' : ''}>Nhân viên</option><option value="TTS" ${user.employee_type === 'TTS' ? 'selected' : ''}>Thực tập sinh</option></select></label>` : ''}
      ${field('ep-position','Vị trí *','text',user.position,'required')}
      <label class="field"><span>Phòng ban *</span><select id="ep-department" required><option value="">Chọn phòng ban</option>${departmentNames.map(value => `<option value="${esc(value)}" ${user.department === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>
      <label class="field"><span>Quản lý trực tiếp *</span><select id="ep-manager" required><option value="">Chọn quản lý</option>${basicUsers.filter(item => Number(item.id) !== Number(user.id)).map(item => `<option value="${item.id}" ${Number(user.direct_manager_id) === Number(item.id) ? 'selected' : ''}>${esc(item.full_name)} - ${esc(item.position || '')}</option>`).join('')}</select></label>
      ${field('ep-location','Địa điểm làm việc *','text',user.work_location,'required')}
      ${permissions.can_edit_contract ? `<label class="field"><span>Loại hợp đồng *</span><select id="ep-contract-type" required><option value="">Chọn hợp đồng</option>${(metadata.contract_types || []).map(value => `<option value="${esc(value)}" ${user.contract_type === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>
      ${field('ep-hire-date','Ngày vào làm *','date',user.hire_date,'required')}
      ${field('ep-contract-start','Ngày bắt đầu hợp đồng','date',user.contract_start_date)}
      ${field('ep-contract-signed','Ngày ký hợp đồng','date',user.contract_signed_date)}
      ${field('ep-contract-end','Ngày hết hạn hợp đồng','date',user.contract_end_date)}
      ${field('ep-probation-end','Ngày kết thúc thử việc','date',user.probation_end_date)}
      ${field('ep-official-date','Ngày chính thức','date',user.official_date)}
      ${user.lifecycle_status === 'Đã nghỉ' ? field('ep-termination-date','Ngày nghỉ việc','date',user.termination_date) : ''}` : ''}
    </div>`;
  } else {
    body = `<div class="employee-edit-grid">
      ${field('ep-salary','Lương cơ bản','number',user.salary,'min="0" step="1000"')}
      ${field('ep-allowance','Phụ cấp','number',user.allowance,'min="0" step="1000"')}
      ${field('ep-insurance-salary','Lương đóng BHXH','number',user.insurance_salary,'min="0" step="1000"')}
      ${field('ep-dependent-count','Số người phụ thuộc','number',user.dependent_count,'min="0" step="1"')}
      ${field('ep-bank-account','Số tài khoản','text',user.bank_account,'inputmode="numeric"')}
      ${field('ep-bank-name','Ngân hàng','text',user.bank_name)}
      ${field('ep-bank-holder','Chủ tài khoản','text',user.bank_account_holder)}
      ${field('ep-tax-code','Mã số thuế','text',user.tax_code)}
      ${field('ep-social-insurance','Số BHXH','text',user.social_insurance_number)}
      ${field('ep-insurance-hospital','Nơi đăng ký KCB BHYT','text',user.insurance_hospital)}
    </div>`;
  }
  openModal(`Chỉnh sửa ${section === 'personal' ? 'thông tin cá nhân' : section === 'employment' ? 'công việc & hợp đồng' : 'lương & BHXH'}`, body, `
    <button class="btn-secondary" id="ep-cancel">Hủy</button><button class="btn-primary" id="ep-save">Lưu thay đổi</button>`);
  document.getElementById('modal')?.classList.add('modal--employee-editor');
  document.getElementById('ep-cancel')?.addEventListener('click', closeModal);
  const unsavedGuard = bindUnsavedWarning('ep-cancel');
  document.getElementById('ep-save')?.addEventListener('click', async event => {
    const value = id => document.getElementById(id)?.value?.trim() ?? '';
    let data;
    if (section === 'personal') data = {
      full_name: value('ep-full-name'), email: value('ep-email'), phone: value('ep-phone'),
      birth_date: value('ep-birth'), gender: value('ep-gender'), national_id: value('ep-national-id'),
      national_id_expiry_date: value('ep-national-expiry'), home_address: value('ep-address'),
      school_name: value('ep-school'), emergency_contact_name: value('ep-emergency-name'),
      emergency_contact_phone: value('ep-emergency-phone'),
    };
    else if (section === 'employment') data = {
      ...(permissions.can_edit_contract ? { employee_type: value('ep-type') } : {}),
      position: value('ep-position'), department: value('ep-department'),
      direct_manager_id: value('ep-manager') || null, work_location: value('ep-location'),
      ...(permissions.can_edit_contract ? {
        contract_type: value('ep-contract-type'), hire_date: value('ep-hire-date'),
        contract_start_date: value('ep-contract-start'), contract_signed_date: value('ep-contract-signed'),
        contract_end_date: value('ep-contract-end'), probation_end_date: value('ep-probation-end'),
        official_date: value('ep-official-date'), termination_date: value('ep-termination-date'),
      } : {}),
    };
    else data = {
      salary: Number(value('ep-salary') || 0), allowance: Number(value('ep-allowance') || 0),
      insurance_salary: Number(value('ep-insurance-salary') || 0), dependent_count: Number(value('ep-dependent-count') || 0),
      bank_account: value('ep-bank-account'), bank_name: value('ep-bank-name'),
      bank_account_holder: value('ep-bank-holder'), tax_code: value('ep-tax-code'),
      social_insurance_number: value('ep-social-insurance'), insurance_hospital: value('ep-insurance-hospital'),
    };
    const required = [...document.querySelectorAll('#modal-body [required]')];
    let invalid = false;
    required.forEach(input => {
      const error = document.querySelector(`[data-error-for="${input.id}"]`);
      if (!input.value.trim()) { invalid = true; input.setAttribute('aria-invalid', 'true'); if (error) error.textContent = 'Trường này là bắt buộc'; }
      else { input.removeAttribute('aria-invalid'); if (error) error.textContent = ''; }
    });
    if (invalid) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.updateEmployeeProfile(user.id, data);
      unsavedGuard.commit();
      closeModal();
      toast('Đã cập nhật hồ sơ', 'success');
      onSaved();
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
}

function openDocumentUpload(user, categories, onSaved) {
  const categoryOptions = Object.entries(categories).map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  openModal('Thêm tài liệu', `
    <div class="employee-edit-grid">
      <label class="field"><span>Danh mục *</span><select id="document-category" required><option value="">Chọn danh mục</option>${categoryOptions}</select></label>
      <label class="field"><span>Tên hiển thị</span><input id="document-title" type="text" maxlength="160"/></label>
      <label class="field"><span>Ngày hết hạn</span><input id="document-expiry" type="date"/></label>
      <label class="field employee-file-field"><span>Tệp *</span><input id="document-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required/><small>PDF, JPG, PNG hoặc WebP, tối đa 10 MB.</small></label>
    </div>`, `<button class="btn-secondary" id="document-cancel">Hủy</button><button class="btn-primary" id="document-save">Tải lên</button>`);
  document.getElementById('document-cancel')?.addEventListener('click', closeModal);
  const unsavedGuard = bindUnsavedWarning('document-cancel');
  document.getElementById('document-save')?.addEventListener('click', async event => {
    const category = document.getElementById('document-category').value;
    const file = document.getElementById('document-file').files?.[0];
    if (!category || !file) { toast('Vui lòng chọn danh mục và tệp', 'error'); return; }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.uploadEmployeeDocument(user.id, {
        category,
        title: document.getElementById('document-title').value.trim(),
        expires_on: document.getElementById('document-expiry').value,
      }, file);
      unsavedGuard.commit();
      closeModal();
      toast('Đã thêm tài liệu', 'success');
      onSaved();
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
}

function openLifecycleEditor(user, onSaved) {
  openModal('Đổi trạng thái nhân sự', `
    <label class="field"><span>Trạng thái mới *</span><select id="employee-lifecycle-value">${LIFECYCLE_STATUSES.map(status => `<option value="${esc(status)}" ${status === user.lifecycle_status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></label>
    <label class="field"><span>Lý do *</span><textarea id="employee-lifecycle-reason" rows="4" placeholder="Nhập lý do thay đổi trạng thái"></textarea></label>`,
    `<button class="btn-secondary" id="employee-lifecycle-cancel">Hủy</button><button class="btn-primary" id="employee-lifecycle-save">Lưu</button>`);
  document.getElementById('employee-lifecycle-cancel')?.addEventListener('click', closeModal);
  document.getElementById('employee-lifecycle-save')?.addEventListener('click', async event => {
    const reason = document.getElementById('employee-lifecycle-reason').value.trim();
    if (!reason) { toast('Vui lòng nhập lý do', 'error'); return; }
    event.currentTarget.disabled = true;
    try {
      await api.changeLifecycleStatus(user.id, document.getElementById('employee-lifecycle-value').value, reason);
      closeModal();
      toast('Đã cập nhật trạng thái', 'success');
      onSaved();
    } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; }
  });
}

function openAvatarEditor(user, onSaved) {
  let cropper = null, objectUrl = null, initialZoom = 1;
  const dispose = () => { cropper?.destroy(); cropper = null; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
  const close = () => { dispose(); closeModal(); };
  openModal('Cắt ảnh đại diện', `
    <p class="avatar-crop-intro">Chọn vùng ảnh bạn muốn sử dụng làm ảnh đại diện.</p>
    <label class="field employee-file-field"><span>Chọn ảnh chân dung</span><input id="employee-avatar-file" type="file" accept="image/jpeg,image/png,image/webp"/><small>JPG, PNG hoặc WebP, tối đa 5 MB.</small></label>
    <section id="avatar-cropper" class="avatar-cropper hidden">
      <div class="avatar-crop-workspace"><div class="avatar-crop-stage"><img id="avatar-crop-image" alt="Ảnh cần cắt"/></div><aside class="avatar-crop-preview"><span>Xem trước</span><div id="avatar-crop-preview-image" class="avatar-crop-preview-image"></div></aside></div>
      <label class="avatar-crop-zoom"><span>Thu nhỏ</span><input id="avatar-crop-zoom" type="range" min="0" max="100" value="0"/><span>Phóng to</span></label>
      <p class="avatar-crop-help">Kéo ảnh trong khung vuông. Preview tròn là phần ảnh sẽ hiển thị sau khi lưu.</p>
    </section>`,
    `<button class="btn-secondary" id="employee-avatar-cancel">Hủy</button><button class="btn-secondary" id="employee-avatar-reset" disabled>Đặt lại</button><button class="btn-primary" id="employee-avatar-save" disabled>Lưu ảnh</button>`);
  document.getElementById('modal')?.classList.add('modal--avatar-crop');
  const fileInput = document.getElementById('employee-avatar-file');
  const cropperHost = document.getElementById('avatar-cropper');
  const image = document.getElementById('avatar-crop-image');
  const preview = document.getElementById('avatar-crop-preview-image');
  const zoom = document.getElementById('avatar-crop-zoom');
  const save = document.getElementById('employee-avatar-save');
  const reset = document.getElementById('employee-avatar-reset');
  const updatePreview = () => {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({ width: 192, height: 192, imageSmoothingQuality: 'high' });
    if (canvas) preview.style.backgroundImage = `url(${canvas.toDataURL('image/webp', .9)})`;
  };
  const resetCrop = () => {
    if (!cropper) return;
    cropper.reset(); zoom.value = '0'; initialZoom = cropper.getImageData().width / cropper.getImageData().naturalWidth; updatePreview();
  };
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast('Chỉ nhận ảnh JPG, PNG hoặc WebP', 'error'); fileInput.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { toast('Ảnh tối đa 5 MB', 'error'); fileInput.value = ''; return; }
    dispose(); objectUrl = URL.createObjectURL(file); image.src = objectUrl;
    image.onload = () => {
      if (!globalThis.Cropper) { toast('Không thể tải công cụ crop ảnh', 'error'); return; }
      cropper = new globalThis.Cropper(image, {
        aspectRatio: 1, viewMode: 1, dragMode: 'move', autoCropArea: 1, responsive: true,
        background: false, guides: false, center: true, highlight: false, movable: true, zoomable: true,
        ready() { initialZoom = cropper.getImageData().width / cropper.getImageData().naturalWidth; cropperHost.classList.remove('hidden'); reset.disabled = false; save.disabled = false; updatePreview(); },
        crop: updatePreview,
      });
    };
    image.onerror = () => { dispose(); toast('Không thể đọc ảnh đã chọn', 'error'); };
  });
  zoom.addEventListener('input', () => { if (cropper) cropper.zoomTo(initialZoom * (1 + Number(zoom.value) / 100 * 2)); });
  reset.addEventListener('click', resetCrop);
  document.getElementById('employee-avatar-cancel')?.addEventListener('click', close);
  document.getElementById('modal-close')?.addEventListener('click', dispose, { once: true });
  save.addEventListener('click', async event => {
    if (!cropper) return;
    event.currentTarget.disabled = true; event.currentTarget.textContent = 'Đang lưu...';
    try {
      const canvas = cropper.getCroppedCanvas({ width: 512, height: 512, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
      const blob = await new Promise((resolve, reject) => canvas?.toBlob(value => value ? resolve(value) : reject(new Error('Không thể tạo ảnh đã crop')), 'image/webp', .9));
      const uploaded = await api.uploadUserDocument(user.id, 'avatar', new File([blob], 'avatar.webp', { type: 'image/webp' }));
      document.dispatchEvent(new CustomEvent('hr-avatar-updated', { detail: { userId: user.id, url: uploaded.url || '' } }));
      close(); toast('Đã cập nhật ảnh đại diện', 'success'); onSaved();
    } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; event.currentTarget.textContent = 'Lưu ảnh'; }
  });
}

function openCreateEmployee(users, departments, onSaved) {
  const departmentOptions = departments.map(item => item.name).filter(Boolean).map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
  const managerOptions = users.map(item => `<option value="${item.id}">${esc(item.full_name)} - ${esc(item.position || '')}</option>`).join('');
  const input = (id, label, type = 'text', required = false) => `<label class="field"><span>${esc(label)}${required ? ' *' : ''}</span><input id="${id}" type="${type}" ${required ? 'required' : ''}/></label>`;
  openModal('Thêm nhân viên', `
    <div class="employee-create-form">
      <h4>Thông tin cá nhân</h4><div class="employee-edit-grid">
        ${input('new-name','Họ và tên','text',true)}${input('new-email','Email','email',true)}
        ${input('new-phone','Số điện thoại','tel',true)}${input('new-birth','Ngày sinh','date',true)}
        ${input('new-national-id','Số CCCD','text',true)}${input('new-national-expiry','Hạn CCCD','date')}
        ${input('new-address','Địa chỉ liên hệ','text',true)}
        <label class="field"><span>Loại nhân sự *</span><select id="new-type"><option value="NV">Nhân viên</option><option value="TTS">Thực tập sinh</option></select></label>
        <label class="field hidden" id="new-school-field"><span>Trường học</span><input id="new-school" type="text"/></label>
      </div>
      <h4>Công việc & hợp đồng</h4><div class="employee-edit-grid">
        ${input('new-position','Vị trí','text',true)}
        <label class="field"><span>Phòng ban *</span><select id="new-department" required><option value="">Chọn phòng ban</option>${departmentOptions}</select></label>
        <label class="field"><span>Quản lý trực tiếp *</span><select id="new-manager" required><option value="">Chọn quản lý</option>${managerOptions}</select></label>
        ${input('new-location','Địa điểm làm việc','text',true)}
        <label class="field"><span>Loại hợp đồng *</span><select id="new-contract-type" required><option value="">Chọn hợp đồng</option>${['Thử việc','HĐCT','CTV','Thỏa thuận TTS','Khác'].map(value => `<option>${value}</option>`).join('')}</select></label>
        ${input('new-hire-date','Ngày vào làm','date',true)}${input('new-probation-end','Ngày kết thúc thử việc','date')}
        ${input('new-contract-end','Ngày hết hạn hợp đồng','date')}${input('new-official-date','Ngày chính thức','date')}
      </div>
      <h4>Lương, ngân hàng & BHXH</h4><div class="employee-edit-grid">
        ${input('new-salary','Lương cơ bản','number')}${input('new-allowance','Phụ cấp','number')}
        ${input('new-insurance-salary','Lương đóng BHXH','number')}${input('new-dependent-count','Số người phụ thuộc','number')}
        ${input('new-bank-account','Số tài khoản')}${input('new-bank-name','Ngân hàng')}
        ${input('new-social-insurance','Số BHXH')}${input('new-insurance-hospital','Nơi đăng ký KCB BHYT')}
      </div>
    </div>`, `<button class="btn-secondary" id="new-cancel">Hủy</button><button class="btn-primary" id="new-save">Tạo nhân viên</button>`);
  document.getElementById('modal')?.classList.add('modal--employee-create');
  document.getElementById('new-cancel')?.addEventListener('click', closeModal);
  const unsavedGuard = bindUnsavedWarning('new-cancel');
  document.getElementById('new-type')?.addEventListener('change', event => document.getElementById('new-school-field').classList.toggle('hidden', event.target.value !== 'TTS'));
  document.getElementById('new-save')?.addEventListener('click', async event => {
    const required = [...document.querySelectorAll('#modal-body [required]')];
    const missing = required.find(input => !input.value.trim());
    if (missing) { missing.focus(); toast('Vui lòng nhập đầy đủ các trường bắt buộc', 'error'); return; }
    const value = id => document.getElementById(id)?.value?.trim() || '';
    const data = {
      full_name: value('new-name'), email: value('new-email'), phone: value('new-phone'),
      birth_date: value('new-birth'), national_id: value('new-national-id'),
      national_id_expiry_date: value('new-national-expiry'), home_address: value('new-address'),
      employee_type: value('new-type'), school_name: value('new-school'), position: value('new-position'),
      department: value('new-department'), direct_manager_id: value('new-manager'), work_location: value('new-location'),
      contract_type: value('new-contract-type'), hire_date: value('new-hire-date'),
      probation_end_date: value('new-probation-end'), contract_end_date: value('new-contract-end'),
      official_date: value('new-official-date'), role: 'employee',
      salary: Number(value('new-salary') || 0), allowance: Number(value('new-allowance') || 0),
      insurance_salary: Number(value('new-insurance-salary') || 0), dependent_count: Number(value('new-dependent-count') || 0),
      bank_account: value('new-bank-account'), bank_name: value('new-bank-name'),
      social_insurance_number: value('new-social-insurance'), insurance_hospital: value('new-insurance-hospital'),
    };
    event.currentTarget.disabled = true;
    try {
      await api.createUser(data);
      unsavedGuard.commit();
      closeModal();
      toast('Đã tạo nhân viên', 'success');
      onSaved();
    } catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; }
  });
}
