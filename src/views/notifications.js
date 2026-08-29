import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
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
  attendance_early: 'Đi về sớm',
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
  let isDrawerOpen = false;

  el.innerHTML = `
    <section class="notification-center">
      <header class="notification-page-head">
        <div>
          <p class="employee-page-kicker">Trung tâm xử lý</p>
          <h1>🔔 Thông báo & Cảnh báo</h1>
          <p>Theo dõi các vấn đề cần xử lý, cảnh báo hồ sơ nhân sự và bất thường chấm công.</p>
        </div>
        <div class="notification-head-actions">
          <button class="btn-secondary btn-sm" id="notification-refresh">${icon('refreshCw', 'sm')} <span>Làm mới</span></button>
        </div>
      </header>

      <!-- Modern Toolbar Card -->
      <div class="notification-toolbar-card" aria-label="Tìm kiếm và lọc thông báo">
        <div class="notification-search-row">
          <div class="notification-search-box">
            <span class="search-icon">${icon('search', 'sm')}</span>
            <input id="notification-search" type="search" placeholder="Tìm theo tên nhân viên, mã số, phòng ban, nội dung..." autocomplete="off"/>
          </div>

          <div class="notification-quick-actions">
            <div class="notification-window-select">
              <select id="notification-window" aria-label="Khoảng thời gian">
                <option value="7">7 ngày</option>
                <option value="30" selected>30 ngày</option>
                <option value="90">90 ngày</option>
              </select>
            </div>
            <button type="button" class="btn-secondary btn-sm" id="notification-filter-toggle">
              <span>⚙️ Bộ lọc</span>
              <span id="notification-active-filter-badge" class="filter-count-badge" style="display:none;">0</span>
            </button>
            <button type="button" class="btn-secondary btn-sm" id="notification-reset" title="Xóa toàn bộ bộ lọc">
              ${icon('refreshCw', 'sm')} <span>Xóa lọc</span>
            </button>
          </div>
        </div>

        <!-- Quick Severity Tabs with Direct Counts -->
        <div class="notification-tabs-row" id="notification-severity-tabs">
          <button type="button" class="notif-tab-pill active" data-severity=""><span>Tất cả</span></button>
          <button type="button" class="notif-tab-pill danger" data-severity="danger"><span>🚨 Khẩn cấp</span></button>
          <button type="button" class="notif-tab-pill warning" data-severity="warning"><span>🕒 Cần xử lý</span></button>
          <button type="button" class="notif-tab-pill info" data-severity="info"><span>ℹ️ Thông tin</span></button>
        </div>

        <!-- Collapsible Advanced Filter Drawer -->
        <div class="notification-drawer" id="notification-filter-drawer" style="display:none;">
          <div class="notification-drawer-grid">
            <div class="field">
              <label>Phân loại nghiệp vụ</label>
              <select id="notification-module"><option value="">Tất cả nghiệp vụ</option></select>
            </div>
            <div class="field">
              <label>Loại thông báo</label>
              <select id="notification-type"><option value="">Tất cả loại thông báo</option></select>
            </div>
          </div>
        </div>
      </div>

      <!-- Results Container -->
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

  function updateActiveFilterBadge() {
    const badge = document.getElementById('notification-active-filter-badge');
    let count = 0;
    if (state.module) count++;
    if (state.type) count++;
    if (state.search) count++;
    if (state.window !== 30) count++;
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function renderSummary(data) {
    const summary = data.summary || {};
    const total = Number(data.active_total || 0);
    const danger = Number(summary.danger || 0);
    const warning = Number(summary.warning || 0);
    const info = Number(summary.info || 0);

    const tabs = document.getElementById('notification-severity-tabs');
    if (tabs) {
      const allBtn = tabs.querySelector('[data-severity=""]');
      const dangerBtn = tabs.querySelector('[data-severity="danger"]');
      const warningBtn = tabs.querySelector('[data-severity="warning"]');
      const infoBtn = tabs.querySelector('[data-severity="info"]');

      if (allBtn) allBtn.innerHTML = `<span>Tất cả</span> <span class="notif-pill-count">${total}</span>`;
      if (dangerBtn) dangerBtn.innerHTML = `<span>🚨 Khẩn cấp</span> <span class="notif-pill-count">${danger}</span>`;
      if (warningBtn) warningBtn.innerHTML = `<span>🕒 Cần xử lý</span> <span class="notif-pill-count">${warning}</span>`;
      if (infoBtn) infoBtn.innerHTML = `<span>ℹ️ Thông tin</span> <span class="notif-pill-count">${info}</span>`;
    }
  }

  function syncTabButtons() {
    document.querySelectorAll('#notification-severity-tabs .notif-tab-pill').forEach(btn => {
      if ((btn.dataset.severity || '') === (state.severity || '')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    updateActiveFilterBadge();
  }

  function renderNotifications(data) {
    const host = document.getElementById('notification-result');
    if (!host) return;
    const items = data.notifications || [];
    if (!items.length) {
      host.innerHTML = emptyHTML('', 'Không có thông báo nào phù hợp', 'Hãy thử thay đổi từ khóa hoặc bộ lọc thời gian.');
      return;
    }
    const pagination = data.pagination || {};
    host.innerHTML = `
      <div class="notification-list">
        ${items.map(item => {
          const sev = item.severity || 'info';
          const sevLabel = SEVERITY_LABELS[sev] || 'Thông tin';
          const sevIconName = SEVERITY_ICONS[sev] || 'circleInfo';
          const initial = (item.employee_name || '?').trim().charAt(0).toUpperCase();

          return `
            <article class="notification-item notification-item--${esc(sev)}">
              <div class="notification-item-icon-box">
                <span class="notification-item-icon">${icon(sevIconName, 'md')}</span>
              </div>
              <div class="notification-item-body">
                <div class="notification-item-meta">
                  ${item.module_label ? `<span class="notif-module-badge">${esc(item.module_label)}</span>` : ''}
                  <span class="notif-severity-badge ${esc(sev)}">${esc(sevLabel)}</span>
                  ${item.occurred_on || item.due_date ? `<span class="notif-time-badge">📅 ${esc(fmtDate(item.occurred_on || item.due_date))}</span>` : ''}
                </div>
                <h2 class="notification-item-title">${esc(item.title || TYPE_LABELS[item.type] || 'Thông báo')}</h2>
                <p class="notification-item-desc">${esc(item.message || '')}</p>
                ${(item.employee_name || item.department) ? `
                  <div class="notification-person-pill">
                    <span class="notif-avatar-sm">${esc(initial)}</span>
                    <strong>${esc(item.employee_name || '')}</strong>
                    <span class="notif-person-sub">${esc([item.employee_code, item.department].filter(Boolean).join(' · '))}</span>
                  </div>
                ` : ''}
              </div>
              <div class="notification-item-action">
                <button class="btn-primary btn-sm notif-action-btn" data-notification-url="${esc(item.action_url || '')}">
                  <span>${esc(item.action_label || 'Xử lý ngay')}</span> ${icon('arrowRight', 'sm')}
                </button>
              </div>
            </article>
          `;
        }).join('')}
      </div>
      <footer class="employee-pagination">
        <span>${Number(pagination.total || 0)} thông báo · Trang ${Number(pagination.page || 1)} / ${Number(pagination.pages || 1)}</span>
        <div style="display:flex;gap:6px;">
          <button class="btn-secondary btn-sm" id="notification-prev" ${Number(pagination.page || 1) <= 1 ? 'disabled' : ''}>← Trước</button>
          <button class="btn-secondary btn-sm" id="notification-next" ${Number(pagination.page || 1) >= Number(pagination.pages || 1) ? 'disabled' : ''}>Sau →</button>
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
      setOptions('notification-type', data.filter_options?.types || [], state.type, 'Tất cả loại thông báo');
      renderNotifications(data);
      syncTabButtons();
    } catch (error) {
      if (currentRequest === requestId) host.innerHTML = `<div class="employee-inline-error">${esc(error.message)}</div>`;
    } finally {
      if (currentRequest === requestId) host.removeAttribute('aria-busy');
    }
  }

  // Event Listeners
  document.getElementById('notification-search')?.addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      updateActiveFilterBadge();
      load();
    }, 280);
  });

  // Severity Tabs
  document.getElementById('notification-severity-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.notif-tab-pill');
    if (!btn) return;
    state.severity = btn.dataset.severity || '';
    state.page = 1;
    syncTabButtons();
    load();
  });

  // Filter Drawer Toggle
  document.getElementById('notification-filter-toggle')?.addEventListener('click', () => {
    const drawer = document.getElementById('notification-filter-drawer');
    if (!drawer) return;
    isDrawerOpen = !isDrawerOpen;
    drawer.style.display = isDrawerOpen ? 'block' : 'none';
  });

  // Select filters
  [
    ['notification-module', 'module'],
    ['notification-type', 'type'],
    ['notification-window', 'window'],
  ].forEach(([id, key]) => document.getElementById(id)?.addEventListener('change', event => {
    state[key] = key === 'window' ? Number(event.target.value) : event.target.value;
    state.page = 1;
    updateActiveFilterBadge();
    load();
  }));

  // Reset filter
  document.getElementById('notification-reset')?.addEventListener('click', () => {
    Object.assign(state, { search: '', module: '', type: '', severity: '', window: 30, page: 1 });
    const searchInput = document.getElementById('notification-search');
    if (searchInput) searchInput.value = '';
    const winSelect = document.getElementById('notification-window');
    if (winSelect) winSelect.value = '30';
    const modSelect = document.getElementById('notification-module');
    if (modSelect) modSelect.value = '';
    const typeSelect = document.getElementById('notification-type');
    if (typeSelect) typeSelect.value = '';
    syncTabButtons();
    load();
  });

  document.getElementById('notification-refresh')?.addEventListener('click', load);

  el._cleanup = () => {
    if (searchTimer) clearTimeout(searchTimer);
  };

  EventBus.bindView(el, 'notifications', () => load());
  EventBus.bindView(el, 'notification:*', () => load());

  await load();
}

