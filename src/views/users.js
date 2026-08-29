import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
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
  ['overview', 'Tổng quan', 'userRound'],
  ['employment', 'Công việc & hợp đồng', 'briefcaseBusiness'],
  ['compensation', 'Lương & BHXH', 'creditCard'],
  ['documents', 'Tài liệu', 'fileText'],
  ['timeline', 'Timeline', 'clock'],
  ['audit', 'Nhật ký thay đổi', 'history'],
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
  if (value === null || value === undefined || value === '') return '<span class="profile-empty-value">— Chưa cập nhật</span>';
  return esc(formatter ? formatter(value) : value);
}

function renderFieldCell(label, value, options = {}) {
  let formatted = value;
  const isEmpty = value === null || value === undefined || String(value).trim() === '';

  if (isEmpty) {
    formatted = '<span class="emp-val-empty">— Chưa cập nhật</span>';
  } else if (options.formatter) {
    formatted = esc(options.formatter(value));
  } else if (options.isPhone) {
    formatted = `<a href="tel:${esc(value)}" class="emp-val-link" title="Gọi số ${esc(value)}">${esc(value)}</a>`;
  } else if (options.isEmail) {
    formatted = `<a href="mailto:${esc(value)}" class="emp-val-link" title="Gửi email tới ${esc(value)}">${esc(value)}</a>`;
  } else {
    formatted = esc(value);
  }

  const copyButton = (!isEmpty && options.copyable) ? `
    <button type="button" class="emp-val-copy" data-copy="${esc(value)}" title="Sao chép ${esc(label)}" aria-label="Sao chép ${esc(label)}">
      ${icon('copy', 'xs')}
    </button>` : '';

  return `
    <div class="emp-field-cell ${options.fullWidth ? 'emp-field-cell--full' : ''} ${options.highlight ? 'emp-field-cell--highlight' : ''}">
      <span class="emp-field-label">${esc(label)}</span>
      <div class="emp-field-value-wrap">
        <span class="emp-field-value">${formatted}</span>
        ${copyButton}
      </div>
    </div>`;
}

function renderInfoCard(title, subtitle, iconName, fieldsHtml, actionBtnId = null, actionBtnText = 'Chỉnh sửa') {
  return `
    <div class="emp-info-card">
      <div class="emp-info-card-header">
        <div class="emp-info-card-title-group">
          <div class="emp-info-card-icon">${icon(iconName || 'fileText', 'sm')}</div>
          <div>
            <h3 class="emp-info-card-title">${esc(title)}</h3>
            ${subtitle ? `<p class="emp-info-card-subtitle">${esc(subtitle)}</p>` : ''}
          </div>
        </div>
        ${actionBtnId ? `<button type="button" class="btn-secondary btn-xs emp-info-card-action print-hidden" id="${actionBtnId}">${icon('pencil', 'xs')} <span>${esc(actionBtnText)}</span></button>` : ''}
      </div>
      <div class="emp-info-card-body">
        <div class="emp-field-grid">
          ${fieldsHtml}
        </div>
      </div>
    </div>`;
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
  el._cleanup = () => {};
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
    search: '', department: '', status: '', work_location: '', position: '',
    page: 1, page_size: 20, loading: false, request: 0,
  };
  let searchTimer = null;
  let filterOptions = { departments: [], positions: [], work_locations: [], statuses: [] };

  el.innerHTML = `
    <section class="employee-directory">
      <header class="employee-page-header">
        <div class="employee-header-title-wrap">
          <div class="employee-title-icon-badge">${icon('users', 'lg')}</div>
          <div>
            <h1>Hồ sơ nhân viên</h1>
            <p>Theo dõi thông tin cá nhân, hợp đồng, lương và hồ sơ đính kèm</p>
          </div>
        </div>
        <div class="employee-header-actions">
          ${isHr(me) ? `<button class="btn-secondary btn-sm" id="employee-export">${icon('arrowDown', 'sm')} <span>Xuất Excel</span></button>` : ''}
          ${isHr(me) ? `<button class="btn-primary btn-sm" id="employee-create">${icon('plus', 'sm')} <span>Thêm nhân viên</span></button>` : ''}
        </div>
      </header>
      <div class="employee-toolbar" aria-label="Tìm kiếm và lọc nhân viên">
        <label class="employee-search">
          <span class="sr-only">Tìm kiếm nhân viên</span>
          ${icon('search', 'sm')}
          <input id="employee-search" type="search" placeholder="Tìm theo tên, mã, email, phòng ban hoặc vị trí..." autocomplete="off"/>
        </label>
        <select id="employee-filter-department" aria-label="Lọc theo phòng ban"><option value="">Tất cả phòng ban</option></select>
        <select id="employee-filter-status" aria-label="Lọc theo trạng thái"><option value="">Tất cả trạng thái</option></select>
        <select id="employee-filter-location" aria-label="Lọc theo địa điểm làm việc"><option value="">Tất cả địa điểm</option></select>
        <select id="employee-filter-position" aria-label="Lọc theo vị trí"><option value="">Tất cả vị trí</option></select>
        <button class="btn-secondary btn-sm" id="employee-filter-reset">${icon('refreshCw', 'xs')} <span>Xóa lọc</span></button>
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
      ['employee-filter-location', 'Tất cả địa điểm', filterOptions.work_locations, state.work_location],
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
            <th>Địa điểm làm việc</th><th><span class="sr-only">Mở hồ sơ</span></th>
          </tr></thead>
          <tbody>${users.map(user => `
            <tr data-user-id="${user.id}" tabindex="0" role="link" aria-label="Mở hồ sơ ${esc(user.full_name)}">
              <td data-label="Nhân viên">
                <div class="employee-table-person">
                  ${avatarMarkup(user)}
                  <div>
                    <strong>${esc(user.full_name)}</strong>
                    <span>
                      ${user.employee_code ? `<span class="employee-code-chip">${esc(user.employee_code)}</span>` : ''}
                      ${esc(user.email || '')}
                    </span>
                  </div>
                </div>
              </td>
              <td data-label="Loại nhân sự">
                <span class="employee-type-badge ${user.employee_type === 'TTS' ? 'employee-type-badge--tts' : 'employee-type-badge--staff'}">
                  ${user.employee_type === 'TTS' ? 'Thực tập sinh' : 'Nhân viên'}
                </span>
              </td>
              <td data-label="Phòng ban"><span style="font-weight:600;color:var(--text);">${valueOrEmpty(user.department)}</span></td>
              <td data-label="Vị trí"><span style="color:var(--text-2);">${valueOrEmpty(user.position)}</span></td>
              <td data-label="Địa điểm làm việc"><span class="employee-cell-primary">${valueOrEmpty(user.work_location)}</span></td>
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
    ['employee-filter-location', 'work_location'],
    ['employee-filter-position', 'position'],
  ].forEach(([id, field]) => document.getElementById(id)?.addEventListener('change', event => {
    state[field] = event.target.value;
    state.page = 1;
    loadDirectory();
  }));
  document.getElementById('employee-filter-reset')?.addEventListener('click', () => {
    Object.assign(state, { search: '', department: '', status: '', work_location: '', position: '', page: 1 });
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

  EventBus.bindView(el, 'users', () => loadDirectory());
  EventBus.bindView(el, 'users:*', () => loadDirectory());
  EventBus.bindView(el, 'user:*', () => loadDirectory());

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
  const completionColorClass = (completion >= 80) ? 'emp-prog--high' : ((completion >= 50) ? 'emp-prog--mid' : 'emp-prog--low');

  el.innerHTML = `
    <section class="employee-profile-page" id="employee-print-root">
      <div class="emp-profile-topbar print-hidden">
        <button class="employee-back-link" id="employee-back">${icon('arrowLeft', 'sm')} <span>Danh sách nhân viên</span></button>
      </div>

      <!-- Modern Hero Card -->
      <header class="emp-hero-card">
        <div class="emp-hero-banner"></div>
        <div class="emp-hero-body">
          <div class="emp-hero-left">
            <div class="emp-hero-avatar-wrap">
              ${avatarMarkup(user, 'lg')}
              ${permissions.can_manage_avatar ? `<button class="emp-avatar-edit-badge print-hidden" id="employee-avatar-edit" title="Cập nhật ảnh đại diện" aria-label="Cập nhật ảnh đại diện">${icon('pencil', 'xs')}</button>` : ''}
            </div>
            <div class="emp-hero-details">
              <div class="emp-hero-pills">
                <span class="emp-pill emp-pill--code">${esc(user.employee_code || 'NV')}</span>
                <span class="emp-pill ${user.employee_type === 'TTS' ? 'emp-pill--tts' : 'emp-pill--staff'}">${user.employee_type === 'TTS' ? 'Thực tập sinh' : 'Chính thức'}</span>
                ${lifecycleBadge(user.lifecycle_status)}
              </div>
              <h1 class="emp-hero-fullname">${esc(user.full_name)}</h1>
              <div class="emp-hero-meta-items">
                <span class="emp-meta-item">🏢 <strong>${esc(user.department || 'Chưa phân phòng')}</strong></span>
                <span class="emp-meta-dot">•</span>
                <span class="emp-meta-item">💼 ${esc(user.position || 'Chưa cập nhật vị trí')}</span>
                ${user.work_location ? `<span class="emp-meta-dot">•</span><span class="emp-meta-item">📍 ${esc(user.work_location)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="emp-hero-right print-hidden">
            ${completion === null ? '' : `
              <div class="emp-completion-widget">
                <div class="emp-completion-top">
                  <span class="emp-completion-title">Hồ sơ hoàn thiện</span>
                  <span class="emp-completion-pct ${completionColorClass}">${completion}%</span>
                </div>
                <div class="emp-completion-track">
                  <div class="emp-completion-bar ${completionColorClass}" style="width: ${completion}%;"></div>
                </div>
                <span class="emp-completion-hint">${completion === 100 ? '✅ Đã hoàn tất thông tin' : 'Cần bổ sung các mục còn thiếu'}</span>
              </div>
            `}

            <div class="emp-hero-actions">
              <button class="btn-secondary btn-sm emp-action-btn" id="employee-print" title="Xuất PDF">${icon('fileText', 'sm')} <span>Xuất PDF</span></button>
              ${isHr(me) ? `<button class="btn-secondary btn-sm emp-action-btn" id="employee-lifecycle" title="Đổi trạng thái">${icon('refreshCw', 'sm')} <span>Đổi trạng thái</span></button>` : ''}
              ${me.role === 'admin' && Number(user.id) !== Number(me.id) ? `<button class="btn-secondary btn-sm emp-action-btn" id="employee-reset-password" title="Reset mật khẩu">${icon('keyRound', 'sm')} <span>Reset mật khẩu</span></button>` : ''}
              ${isHr(me) && Number(user.id) !== Number(me.id) ? `<button class="btn-danger btn-sm emp-action-btn" id="employee-delete-account" title="Xóa tài khoản">${icon('trash2', 'sm')} <span>Xóa tài khoản</span></button>` : ''}
            </div>
          </div>
        </div>
      </header>

      <!-- Modern Tabs Navigation -->
      <nav class="emp-tabs-nav print-hidden" aria-label="Nội dung hồ sơ">
        <div class="emp-tabs-track">
          ${TAB_ITEMS.filter(([key]) => availableTabs.includes(key))
            .map(([key, label, tabIcon]) => `
              <button type="button" data-profile-tab="${key}" class="emp-tab-item ${key === activeTab ? 'active' : ''}">
                <span class="emp-tab-item-icon">${icon(tabIcon || 'fileText', 'xs')}</span>
                <span>${esc(label)}</span>
              </button>
            `).join('')}
        </div>
      </nav>

      <div id="employee-profile-content" class="emp-profile-content"></div>
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
        <div class="emp-cards-stack">
          ${renderInfoCard(
            'Thông tin định danh & Liên hệ',
            'Các thông tin cơ bản phục vụ nhận diện và liên lạc của nhân viên',
            'userRound',
            `
              ${renderFieldCell('Mã nhân viên', user.employee_code, { copyable: true })}
              ${renderFieldCell('Họ và tên', user.full_name)}
              ${renderFieldCell('Email liên hệ', user.email, { isEmail: true, copyable: true })}
              ${renderFieldCell('Số điện thoại', user.phone, { isPhone: true, copyable: true })}
              ${Object.prototype.hasOwnProperty.call(user, 'birth_date') ? renderFieldCell('Ngày sinh', user.birth_date, { formatter: fmtDate }) : ''}
              ${renderFieldCell('Giới tính', user.gender)}
              ${user.employee_type === 'TTS' && Object.prototype.hasOwnProperty.call(user, 'school_name') ? renderFieldCell('Trường học / Cơ sở đào tạo', user.school_name) : ''}
              ${Object.prototype.hasOwnProperty.call(user, 'home_address') ? renderFieldCell('Địa chỉ thường trú / Liên hệ', user.home_address, { fullWidth: true }) : ''}
            `,
            permissions.can_edit_personal ? 'employee-edit-personal' : null
          )}

          ${renderInfoCard(
            'Căn cước công dân (CCCD)',
            'Giấy tờ tùy thân để khai báo thuế và bảo hiểm',
            'badgeCheck',
            `
              ${Object.prototype.hasOwnProperty.call(user, 'national_id') ? renderFieldCell('Số CCCD / CMND', user.national_id, { copyable: true }) : ''}
              ${Object.prototype.hasOwnProperty.call(user, 'national_id_expiry_date') ? renderFieldCell('Hạn sử dụng CCCD', user.national_id_expiry_date, { formatter: fmtDate }) : ''}
            `,
            permissions.can_edit_personal ? 'employee-edit-personal-cccd' : null
          )}

          ${(Object.prototype.hasOwnProperty.call(user, 'emergency_contact_name') || Object.prototype.hasOwnProperty.call(user, 'emergency_contact_phone')) ? renderInfoCard(
            'Liên hệ khẩn cấp',
            'Người thân liên hệ khi có sự cố khẩn cấp',
            'shieldAlert',
            `
              ${renderFieldCell('Người liên hệ', user.emergency_contact_name)}
              ${renderFieldCell('Số điện thoại khẩn cấp', user.emergency_contact_phone, { isPhone: true, copyable: true })}
            `,
            permissions.can_edit_personal ? 'employee-edit-personal-emergency' : null
          ) : ''}
        </div>
      `;
      $('#employee-edit-personal')?.addEventListener('click', () => openProfileEditor(user, 'personal', { permissions, departments, basicUsers, metadata }, refreshProfile));
      $('#employee-edit-personal-cccd')?.addEventListener('click', () => openProfileEditor(user, 'personal', { permissions, departments, basicUsers, metadata }, refreshProfile));
      $('#employee-edit-personal-emergency')?.addEventListener('click', () => openProfileEditor(user, 'personal', { permissions, departments, basicUsers, metadata }, refreshProfile));
      return;
    }

    if (activeTab === 'employment') {
      content.innerHTML = `
        <div class="emp-cards-stack">
          ${renderInfoCard(
            'Vị trí & Tổ chức làm việc',
            'Cơ cấu nhân sự, bộ phận và cấp quản lý trực tiếp',
            'building2',
            `
              ${renderFieldCell('Loại nhân sự', user.employee_type === 'TTS' ? 'Thực tập sinh' : 'Nhân viên chính thức')}
              ${renderFieldCell('Vị trí công việc', user.position)}
              ${renderFieldCell('Phòng ban', user.department)}
              ${renderFieldCell('Quản lý trực tiếp', managerName())}
              ${renderFieldCell('Địa điểm làm việc', user.work_location, { fullWidth: true })}
            `,
            permissions.can_edit_employment ? 'employee-edit-employment' : null
          )}

          ${renderInfoCard(
            'Hợp đồng & Thời hạn làm việc',
            'Thông tin pháp lý hợp đồng, thời gian thử việc và hiệu lực',
            'handshake',
            `
              ${renderFieldCell('Loại hợp đồng', user.contract_type)}
              ${(() => {
                const isTts = user.employee_type === 'TTS';
                const isProbation = user.lifecycle_status === 'Thử việc' || user.contract_type === 'Thử việc' || user.contract_type === 'Thỏa thuận TTS';
                const isOfficial = !isTts && !isProbation;
                const leaveText = isTts
                  ? '0 ngày (Chưa áp dụng cho TTS)'
                  : isProbation
                    ? '0 ngày (Thử việc - cấp 12 ngày sau khi chính thức)'
                    : '12 ngày / năm';
                return renderFieldCell('Phép năm', leaveText, { highlight: isOfficial });
              })()}
              ${renderFieldCell('Ngày vào làm việc', user.hire_date, { formatter: fmtDate })}
              ${renderFieldCell('Ngày bắt đầu HĐ', user.contract_start_date, { formatter: fmtDate })}
              ${renderFieldCell('Ngày ký hợp đồng', user.contract_signed_date, { formatter: fmtDate })}
              ${renderFieldCell('Ngày hết hạn HĐ', user.contract_end_date, { formatter: fmtDate })}
              ${renderFieldCell('Kết thúc thử việc', user.probation_end_date, { formatter: fmtDate })}
              ${renderFieldCell('Ngày chính thức', user.official_date, { formatter: fmtDate })}
              ${user.lifecycle_status === 'Đã nghỉ' ? renderFieldCell('Ngày nghỉ việc', user.termination_date, { formatter: fmtDate }) : ''}
            `,
            permissions.can_edit_employment ? 'employee-edit-employment-contract' : null
          )}
        </div>
      `;
      $('#employee-edit-employment')?.addEventListener('click', () => openProfileEditor(user, 'employment', { permissions, departments, basicUsers, metadata }, refreshProfile));
      $('#employee-edit-employment-contract')?.addEventListener('click', () => openProfileEditor(user, 'employment', { permissions, departments, basicUsers, metadata }, refreshProfile));
      return;
    }

    if (activeTab === 'compensation') {
      const totalIncome = Number(user.salary || 0) + Number(user.allowance || 0);
      content.innerHTML = `
        <div class="emp-cards-stack">
          ${renderInfoCard(
            'Thu nhập & Giảm trừ gia cảnh',
            'Chế độ đãi ngộ hàng tháng và thông tin thuế TNCN',
            'banknote',
            `
              ${renderFieldCell('Lương cơ bản', user.salary, { formatter: fmtMoney })}
              ${renderFieldCell('Phụ cấp', user.allowance, { formatter: fmtMoney })}
              ${renderFieldCell('Tổng thu nhập hàng tháng', totalIncome, { formatter: fmtMoney, highlight: true })}
              ${renderFieldCell('Mã số thuế cá nhân', user.tax_code, { copyable: true })}
              ${renderFieldCell('Số người phụ thuộc', user.dependent_count)}
            `,
            permissions.can_edit_compensation ? 'employee-edit-compensation' : null
          )}

          ${renderInfoCard(
            'Tài khoản ngân hàng nhận lương',
            'Tài khoản thanh toán lương tự động hàng tháng',
            'creditCard',
            `
              ${renderFieldCell('Ngân hàng', user.bank_name)}
              ${renderFieldCell('Số tài khoản', user.bank_account, { copyable: true })}
              ${renderFieldCell('Chủ tài khoản', user.bank_account_holder)}
            `,
            permissions.can_edit_compensation ? 'employee-edit-compensation-bank' : null
          )}

          ${renderInfoCard(
            'Bảo hiểm xã hội & BHYT',
            'Thông tin tham gia bảo hiểm bắt buộc theo luật lao động',
            'heartPulse',
            `
              ${renderFieldCell('Lương đóng BHXH', user.insurance_salary, { formatter: fmtMoney })}
              ${renderFieldCell('Số sổ BHXH', user.social_insurance_number, { copyable: true })}
              ${renderFieldCell('Nơi đăng ký KCB BHYT', user.insurance_hospital, { fullWidth: true })}
            `,
            permissions.can_edit_compensation ? 'employee-edit-compensation-ins' : null
          )}
        </div>
      `;
      $('#employee-edit-compensation')?.addEventListener('click', () => openProfileEditor(user, 'compensation', { permissions, departments, basicUsers, metadata }, refreshProfile));
      $('#employee-edit-compensation-bank')?.addEventListener('click', () => openProfileEditor(user, 'compensation', { permissions, departments, basicUsers, metadata }, refreshProfile));
      $('#employee-edit-compensation-ins')?.addEventListener('click', () => openProfileEditor(user, 'compensation', { permissions, departments, basicUsers, metadata }, refreshProfile));
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

  el.addEventListener('click', e => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const text = copyBtn.dataset.copy;
      if (text) {
        navigator.clipboard?.writeText?.(text).then(() => {
          toast(`Đã sao chép: ${text}`, 'success');
        }).catch(() => {
          toast('Đã chọn: ' + text, 'info');
        });
      }
    }
  });

  $('#employee-print')?.addEventListener('click', () => {
    const content = $('#employee-profile-content');
    if (!content) return;
    const previousTab = activeTab;
    const totalIncome = Number(user.salary || 0) + Number(user.allowance || 0);
    content.innerHTML = `
      <div class="emp-cards-stack">
        ${renderInfoCard('Thông tin cá nhân & Liên hệ', '', 'userRound', `
          ${renderFieldCell('Mã nhân viên', user.employee_code)}
          ${renderFieldCell('Họ và tên', user.full_name)}
          ${renderFieldCell('Email', user.email)}
          ${renderFieldCell('Số điện thoại', user.phone)}
          ${renderFieldCell('Ngày sinh', user.birth_date, { formatter: fmtDate })}
          ${renderFieldCell('Số CCCD', user.national_id)}
          ${renderFieldCell('Hạn CCCD', user.national_id_expiry_date, { formatter: fmtDate })}
          ${renderFieldCell('Địa chỉ liên hệ', user.home_address, { fullWidth: true })}
          ${user.employee_type === 'TTS' ? renderFieldCell('Trường học', user.school_name) : ''}
        `)}
        ${renderInfoCard('Công việc & Hợp đồng', '', 'briefcaseBusiness', `
          ${renderFieldCell('Vị trí', user.position)}
          ${renderFieldCell('Phòng ban', user.department)}
          ${renderFieldCell('Quản lý trực tiếp', managerName())}
          ${renderFieldCell('Địa điểm làm việc', user.work_location)}
          ${renderFieldCell('Loại hợp đồng', user.contract_type)}
          ${renderFieldCell('Ngày vào làm', user.hire_date, { formatter: fmtDate })}
          ${renderFieldCell('Ngày hết hạn hợp đồng', user.contract_end_date, { formatter: fmtDate })}
          ${renderFieldCell('Ngày chính thức', user.official_date, { formatter: fmtDate })}
          ${user.lifecycle_status === 'Đã nghỉ' ? renderFieldCell('Ngày nghỉ việc', user.termination_date, { formatter: fmtDate }) : ''}
        `)}
        ${Object.prototype.hasOwnProperty.call(user, 'salary') ? renderInfoCard('Lương & BHXH', '', 'creditCard', `
          ${renderFieldCell('Lương cơ bản', user.salary, { formatter: fmtMoney })}
          ${renderFieldCell('Phụ cấp', user.allowance, { formatter: fmtMoney })}
          ${renderFieldCell('Tổng thu nhập', totalIncome, { formatter: fmtMoney })}
          ${renderFieldCell('Lương đóng BHXH', user.insurance_salary, { formatter: fmtMoney })}
          ${renderFieldCell('Số người phụ thuộc', user.dependent_count)}
          ${renderFieldCell('Ngân hàng', user.bank_name)}
          ${renderFieldCell('Số tài khoản', user.bank_account)}
          ${renderFieldCell('Số BHXH', user.social_insurance_number)}
          ${renderFieldCell('Nơi đăng ký KCB BHYT', user.insurance_hospital, { fullWidth: true })}
        `) : ''}
      </div>
    `;
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
  $('#employee-delete-account')?.addEventListener('click', async event => {
    if (!confirm(`Bạn có chắc chắn muốn XÓA VĨNH VIỄN tài khoản của ${user.full_name} (${user.employee_code || ''})?\n\nHành động này sẽ xóa hồ sơ nhân viên và dữ liệu liên quan. Không thể hoàn tác!`)) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Đang xóa...';
    try {
      await api.deleteUser(user.id);
      toast(`Đã xóa tài khoản ${user.full_name}`, 'success');
      navigate('#/users');
    } catch (error) {
      toast(error.message || 'Không thể xóa tài khoản', 'error');
      button.disabled = false;
      button.innerHTML = `${icon('trash2', 'sm')} <span>Xóa tài khoản</span>`;
    }
  });

  el._cleanup = () => {};

  EventBus.bindView(el, 'users', () => refreshProfile());
  EventBus.bindView(el, 'user:*', (data) => {
    if (!data?.id || Number(data.id) === employeeId) refreshProfile();
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
      <label class="field"><span>Địa điểm làm việc *</span><select id="ep-location" required>
        <option value="HCM" ${user.work_location === 'HCM' ? 'selected' : ''}>HCM</option>
        <option value="HN" ${user.work_location === 'HN' ? 'selected' : ''}>HN</option>
        <option value="Phim trường Netviet" ${user.work_location === 'Phim trường Netviet' ? 'selected' : ''}>Phim trường Netviet</option>
      </select></label>
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

  openModal('Thêm nhân viên mới', `
    <div class="employee-create-form" style="display:flex;flex-direction:column;gap:16px;">
      <div style="background:#FFF5F2;border:1px solid #FED7AA;border-radius:12px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;">
        <span style="color:var(--primary);margin-top:2px;">${icon('info', 'sm') || 'ℹ️'}</span>
        <div style="font-size:12.5px;color:var(--text-2);line-height:1.45;">
          Chỉ cần nhập <strong>Mã nhân viên</strong> và <strong>Họ và tên đầy đủ</strong> để khởi tạo tài khoản nhanh. Mật khẩu đăng nhập mặc định là <strong style="color:var(--primary);">Pass@123</strong>.
        </div>
      </div>

      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12.5px;font-weight:700;margin-bottom:6px;display:block;">Mã nhân viên <span style="color:var(--danger);">*</span></label>
        <input id="new-code" type="text" placeholder="Ví dụ: TTS-33 hoặc NV-10" style="height:44px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;" required autocomplete="off" />
      </div>

      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12.5px;font-weight:700;margin-bottom:6px;display:block;">Họ và tên đầy đủ <span style="color:var(--danger);">*</span></label>
        <input id="new-name" type="text" placeholder="Ví dụ: Nguyễn Văn Siu" style="height:44px;font-weight:600;" required autocomplete="off" />
      </div>

      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12.5px;font-weight:700;margin-bottom:6px;display:block;">Phòng ban</label>
        <select id="new-department" style="height:44px;font-weight:600;">
          <option value="">Tự động chọn theo mã (hoặc chọn bên dưới)</option>
          ${departmentOptions}
        </select>
      </div>

      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12.5px;font-weight:700;margin-bottom:6px;display:block;">Địa điểm làm việc</label>
        <select id="new-location" style="height:44px;font-weight:600;">
          <option value="HCM" selected>HCM</option>
          <option value="HN">HN</option>
          <option value="Phim trường Netviet">Phim trường Netviet</option>
        </select>
      </div>

      <div id="new-create-error" style="color:var(--danger);font-size:12.5px;font-weight:600;min-height:16px;"></div>
    </div>
  `, `
    <button class="btn-secondary" id="new-cancel">Hủy</button>
    <button class="btn-primary" id="new-save">${icon('plus', 'sm')} <span>Tạo nhân viên</span></button>
  `);

  document.getElementById('modal')?.classList.add('modal--employee-create');
  document.getElementById('new-cancel')?.addEventListener('click', closeModal);
  const unsavedGuard = bindUnsavedWarning('new-cancel');

  const codeInput = document.getElementById('new-code');
  const nameInput = document.getElementById('new-name');
  const deptSelect = document.getElementById('new-department');
  const locSelect = document.getElementById('new-location');
  const errorEl = document.getElementById('new-create-error');
  const saveBtn = document.getElementById('new-save');

  // Auto-suggest department when user types TTS
  codeInput?.addEventListener('input', () => {
    const val = (codeInput.value || '').trim().toUpperCase();
    if (val.startsWith('TTS')) {
      if (deptSelect && !deptSelect.value) {
        const ttsOpt = Array.from(deptSelect.options).find(o => o.value.toLowerCase().includes('thực tập'));
        if (ttsOpt) deptSelect.value = ttsOpt.value;
      }
    }
  });

  saveBtn?.addEventListener('click', async () => {
    const code = (codeInput?.value || '').trim().toUpperCase();
    const name = (nameInput?.value || '').trim();
    if (!code) {
      codeInput?.focus();
      if (errorEl) errorEl.textContent = 'Vui lòng nhập mã nhân viên (ví dụ: TTS-33)';
      return;
    }
    if (!name) {
      nameInput?.focus();
      if (errorEl) errorEl.textContent = 'Vui lòng nhập họ và tên đầy đủ';
      return;
    }
    if (errorEl) errorEl.textContent = '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang tạo...';

    const isTts = code.startsWith('TTS');
    let dept = deptSelect?.value || (isTts ? 'Thực Tập Sinh' : 'Phòng Marketing');
    let location = locSelect?.value || (dept.toLowerCase().includes('gameshow') ? 'Phim trường Netviet' : 'HCM');

    const data = {
      employee_code: code,
      full_name: name,
      department: dept,
      work_location: location,
      employee_type: isTts ? 'TTS' : 'NV',
      password: 'Pass@123',
    };

    try {
      await api.createUser(data);
      unsavedGuard.commit();
      closeModal();
      toast(`Đã tạo nhân viên ${code} - ${name} thành công! (Mật khẩu: Pass@123)`, 'success', 5000);
      onSaved();
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message || 'Lỗi khi tạo nhân viên';
      toast(error.message || 'Lỗi khi tạo nhân viên', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = `${icon('plus', 'sm')} <span>Tạo nhân viên</span>`;
    }
  });
}
