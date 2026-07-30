import { api } from '../api.js';
import { esc, emptyHTML, fmtDate } from '../utils.js';
import { icon } from '../icons.js';
import { navigate } from '../app.js';

const TYPE_LABELS = {
  probation_due: 'Thử việc sắp hết hạn',
  contract_due: 'Hợp đồng sắp hết hạn',
  national_id_due: 'CCCD sắp hết hạn',
  missing_documents: 'Hồ sơ còn thiếu',
  document_due: 'Tài liệu sắp hết hạn',
  attendance_late: 'Đi làm muộn',
  attendance_checkout_late: 'Checkout trễ',
  attendance_unexcused_absence: 'Vắng không có lý do',
};

const SEVERITY_LABELS = {
  danger: 'Khẩn cấp',
  warning: 'Cần xử lý',
  info: 'Thông tin',
};

const SEVERITY_ICONS = {
  danger: 'triangleAlert',
  warning: 'clock3',
  info: 'circleInfo',
};

function notificationSkeleton() {
  return `<div class="notification-skeleton" aria-label="Đang tải thông báo">
    ${Array.from({ length: 4 }, () => '<div><i></i><span><b></b><em></em></span></div>').join('')}
  </div>`;
}

export async function renderNotifications(el) {
  const state = {
    search: '',
    module: '',
    type: '',
    severity: '',
    window: 30,
    page: 1,
    page_size: 25,
  };
  let requestId = 0;
  let searchTimer = null;

  el.innerHTML = `
    <section class="notification-center">
      <header class="notification-page-head">
        <div>
          <p class="employee-page-kicker">Trung tâm xử lý</p>
          <h1>Thông báo</h1>
          <p>Theo dõi cảnh báo hồ sơ và bất thường chấm công theo đúng phạm vi quyền.</p>
        </div>
        <button class="btn-secondary" id="notification-refresh">${icon('refreshCw', 'sm')} Làm mới</button>
      </header>
      <div id="notification-summary" class="notification-summary" aria-live="polite"></div>
      <div class="notification-toolbar" aria-label="Tìm kiếm và lọc thông báo">
        <label class="notification-search">
          <span class="sr-only">Tìm thông báo</span>${icon('search', 'sm')}
          <input id="notification-search" type="search" placeholder="Tìm theo nhân viên, mã, phòng ban hoặc nội dung" autocomplete="off"/>
        </label>
        <select id="notification-module" aria-label="Lọc theo nghiệp vụ"><option value="">Tất cả nghiệp vụ</option></select>
        <select id="notification-type" aria-label="Lọc theo loại thông báo"><option value="">Tất cả loại</option></select>
        <select id="notification-severity" aria-label="Lọc theo mức độ">
          <option value="">Tất cả mức độ</option>
          <option value="danger">Khẩn cấp</option>
          <option value="warning">Cần xử lý</option>
          <option value="info">Thông tin</option>
        </select>
        <select id="notification-window" aria-label="Khoảng thời gian">
          <option value="7">7 ngày</option>
          <option value="30" selected>30 ngày</option>
          <option value="90">90 ngày</option>
        </select>
        <button class="btn-secondary btn-sm" id="notification-reset">${icon('refreshCw', 'sm')} Xóa lọc</button>
      </div>
      <div id="notification-result">${notificationSkeleton()}</div>
    </section>`;

  const setOptions = (id, values, selected, label) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = `<option value="">${label}</option>${values.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const text = typeof item === 'string' ? (TYPE_LABELS[item] || item) : item.label;
      return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`;
    }).join('')}`;
  };

  function renderSummary(data) {
    const summary = data.summary || {};
    const host = document.getElementById('notification-summary');
    if (!host) return;
    host.innerHTML = `
      <article><span class="notification-summary-icon">${icon('bell', 'md')}</span><div><strong>${Number(data.active_total || 0)}</strong><span>Tổng thông báo</span></div></article>
      <article class="danger"><span class="notification-summary-icon">${icon('triangleAlert', 'md')}</span><div><strong>${Number(summary.danger || 0)}</strong><span>Khẩn cấp</span></div></article>
      <article class="warning"><span class="notification-summary-icon">${icon('clock3', 'md')}</span><div><strong>${Number(summary.warning || 0)}</strong><span>Cần xử lý</span></div></article>
      <article><span class="notification-summary-icon">${icon('activity', 'md')}</span><div><strong>${Number(summary.attendance || 0)}</strong><span>Bất thường chấm công</span></div></article>`;
  }

  function renderNotifications(data) {
    const host = document.getElementById('notification-result');
    if (!host) return;
    const items = data.notifications || [];
    if (!items.length) {
      host.innerHTML = emptyHTML('', 'Không có thông báo phù hợp', 'Hãy thay đổi bộ lọc hoặc khoảng thời gian.');
      return;
    }
    const pagination = data.pagination || {};
    host.innerHTML = `
      <div class="notification-list">
        ${items.map(item => `
          <article class="notification-item notification-item--${esc(item.severity || 'info')}">
            <span class="notification-item-icon">${icon(SEVERITY_ICONS[item.severity] || 'circleInfo', 'md')}</span>
            <div class="notification-item-body">
              <div class="notification-item-meta">
                <span>${esc(item.module_label || '')}</span>
                <span>${esc(SEVERITY_LABELS[item.severity] || 'Thông tin')}</span>
                ${item.occurred_on || item.due_date ? `<time datetime="${esc(item.occurred_on || item.due_date)}">${esc(fmtDate(item.occurred_on || item.due_date))}</time>` : ''}
              </div>
              <h2>${esc(item.title || TYPE_LABELS[item.type] || 'Thông báo')}</h2>
              <p>${esc(item.message || '')}</p>
              <div class="notification-person">
                <strong>${esc(item.employee_name || '')}</strong>
                <span>${esc([item.employee_code, item.department].filter(Boolean).join(' · '))}</span>
              </div>
            </div>
            <div class="notification-item-action">
              <button class="btn-secondary btn-sm" data-notification-url="${esc(item.action_url || '')}">
                ${esc(item.action_label || 'Mở chức năng')} ${icon('arrowRight', 'sm')}
              </button>
            </div>
          </article>`).join('')}
      </div>
      <footer class="employee-pagination">
        <span>${Number(pagination.total || 0)} thông báo, trang ${Number(pagination.page || 1)}/${Number(pagination.pages || 1)}</span>
        <div>
          <button class="btn-secondary btn-sm" id="notification-prev" ${Number(pagination.page || 1) <= 1 ? 'disabled' : ''}>Trước</button>
          <button class="btn-secondary btn-sm" id="notification-next" ${Number(pagination.page || 1) >= Number(pagination.pages || 1) ? 'disabled' : ''}>Sau</button>
        </div>
      </footer>`;
    host.querySelectorAll('[data-notification-url]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.notificationUrl) navigate(button.dataset.notificationUrl);
      });
    });
    document.getElementById('notification-prev')?.addEventListener('click', () => {
      state.page = Math.max(1, state.page - 1);
      load();
    });
    document.getElementById('notification-next')?.addEventListener('click', () => {
      state.page += 1;
      load();
    });
  }

  async function load() {
    const currentRequest = ++requestId;
    const host = document.getElementById('notification-result');
    if (!host) return;
    host.setAttribute('aria-busy', 'true');
    if (!host.querySelector('.notification-list')) host.innerHTML = notificationSkeleton();
    try {
      const data = await api.getNotifications(state);
      if (currentRequest !== requestId || !host.isConnected) return;
      renderSummary(data);
      setOptions('notification-module', data.filter_options?.modules || [], state.module, 'Tất cả nghiệp vụ');
      setOptions('notification-type', data.filter_options?.types || [], state.type, 'Tất cả loại');
      renderNotifications(data);
    } catch (error) {
      if (currentRequest === requestId) host.innerHTML = `<div class="employee-inline-error">${esc(error.message)}</div>`;
    } finally {
      if (currentRequest === requestId) host.removeAttribute('aria-busy');
    }
  }

  document.getElementById('notification-search')?.addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      load();
    }, 280);
  });
  [
    ['notification-module', 'module'],
    ['notification-type', 'type'],
    ['notification-severity', 'severity'],
    ['notification-window', 'window'],
  ].forEach(([id, key]) => document.getElementById(id)?.addEventListener('change', event => {
    state[key] = key === 'window' ? Number(event.target.value) : event.target.value;
    state.page = 1;
    load();
  }));
  document.getElementById('notification-reset')?.addEventListener('click', () => {
    Object.assign(state, { search: '', module: '', type: '', severity: '', window: 30, page: 1 });
    document.getElementById('notification-search').value = '';
    document.getElementById('notification-severity').value = '';
    document.getElementById('notification-window').value = '30';
    load();
  });
  document.getElementById('notification-refresh')?.addEventListener('click', load);

  await load();
}
