import { esc, lifecycleBadge } from '../utils.js';
import { api } from '../api.js';

const stats = [
  ['clipboardList', '0', 'Việc hôm nay', 'indigo'],
  ['circleCheck', '0', 'Đã hoàn thành', 'emerald'],
  ['refreshCw', '0', 'Đang thực hiện', 'amber'],
  ['users', '0', 'Đã check-in', 'blue'],
];

const KPI_MAX_SCORES = { HS01: 15, HS02: 10, HS03: 10, HS04: 10, HS05: 10, HS06: 5 };

function dashboardKpiCard(item, index) {
  const isText = String(item.unit || '').toLowerCase() === 'text';
  const maxScore = KPI_MAX_SCORES[item.criterion_code] || 0;
  const actual = isText ? Number(item.manual_score) : Number(item.actual_value);
  const target = isText ? maxScore : Number(item.target_value);
  const hasActual = Number.isFinite(actual) && actual >= 0;
  const percent = hasActual && target > 0 ? Math.max(0, Math.min(100, Math.round((actual / target) * 100))) : 0;
  const tone = ['emerald', 'blue', 'amber'][index % 3];
  const actualLabel = hasActual ? (isText ? `${actual}/${maxScore}` : `${actual} ${item.unit || ''}`.trim()) : 'Chưa cập nhật';
  const targetLabel = isText ? `Mục tiêu: ${maxScore} điểm` : `Mục tiêu: ${item.target_value} ${item.unit || ''}`.trim();
  const state = !hasActual ? 'Chưa cập nhật' : percent >= 100 ? 'Đạt mục tiêu' : 'Đang thực hiện';
  return `<article class="reference-kpi ${tone}"><p>${esc(item.title || item.criterion_code || 'KPI')}</p><div class="kpi-value">${esc(actualLabel)}</div><div class="reference-progress"><i style="width:${percent}%"></i></div><div class="kpi-foot"><span>${esc(targetLabel)}</span><b>● ${esc(state)}</b></div></article>`;
}

export async function renderDashboard(el, me) {
  const displayName = me.full_name || 'Nguyễn Văn Hậu';
  const department = me.department || 'Ban Giám Đốc';
  const position = me.position || 'Giám đốc';
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const isTts = String(me.employee_type || '').toUpperCase() === 'TTS';

  el.innerHTML = `
    <section class="dash-reference">
      <div class="dash-main-column">
        <div class="dash-welcome">
          <div class="welcome-orb welcome-orb-one"></div><div class="welcome-orb welcome-orb-two"></div>
          <div class="welcome-eyebrow"><span data-icon="sun"></span> Chào buổi sáng,</div>
          <h1>${esc(displayName)} <span data-icon="userRound"></span></h1>
          <p>${today}</p>
          <div class="welcome-tags"><span>${esc(department)}</span><span>${esc(position)}</span></div>
          <div class="welcome-status">${lifecycleBadge(me.lifecycle_status || 'Chính thức')}</div>
        </div>

        <div class="reference-stats">
          ${stats.map(([icon, value, label, tone]) => `<article class="reference-stat ${tone}"><i data-icon="${icon}"></i><div><strong>${value}</strong><span>${label}</span></div></article>`).join('')}
        </div>

        <div class="dash-bottom-grid">
          <article class="reference-panel schedule-panel"><div class="reference-panel-head"><h2><span data-icon="calendarDays"></span> Lịch làm việc</h2><span class="date-range">Tuần hiện tại</span><a href="#/tasks">Xem tất cả <span data-icon="arrowRight"></span></a></div><div class="schedule-empty"><span data-icon="calendarDays"></span><strong>Tuần này chưa có lịch làm việc</strong><p>Hiện tại chưa có lịch làm việc nào được lên kế hoạch.</p><a href="#/tasks" class="btn-secondary btn-sm">Xem chi tiết lịch</a></div></article>
          <article class="reference-panel"><div class="reference-panel-head"><h2><span data-icon="bell"></span> Thông báo</h2><a href="#/notifications">Xem tất cả <span data-icon="arrowRight"></span></a></div><div id="dashboard-notifications" class="reference-empty">Đang tải thông báo...</div></article>
        </div>
      </div>

      <aside class="reference-kpis"><div class="kpi-heading"><span data-icon="target"></span><h2>KPI của bạn</h2><a href="#/kpis">Xem chi tiết <span data-icon="arrowRight"></span></a></div>
        <div id="dashboard-kpis" class="reference-empty">Đang tải KPI...</div>
      </aside>
    </section>`;

  const notificationHost = document.getElementById('dashboard-notifications');
  try {
    const data = await api.getNotifications({ window: 30, page: 1, page_size: 10 });
    const items = (data.notifications || []).slice(0, 3);
    if (!notificationHost) return;
    notificationHost.className = items.length ? 'reference-notification-list' : 'reference-empty';
    notificationHost.innerHTML = items.length ? items.map(item => `
      <a href="${esc(item.action_url || '#/notifications')}" class="reference-notification-item">
        <span class="${esc(item.severity || 'info')}"></span>
        <div><strong>${esc(item.title || 'Thông báo')}</strong><small>${esc(item.employee_name || item.message || '')}</small></div>
      </a>`).join('') : 'Không có thông báo cần xử lý';
  } catch (_) {
    if (notificationHost) notificationHost.textContent = 'Không thể tải thông báo';
  }

  const kpiHost = document.getElementById('dashboard-kpis');
  try {
    const now = new Date();
    const { plan, items = [] } = await api.getKpis({ month: now.getMonth() + 1, year: now.getFullYear() });
    if (!kpiHost) return;
    if (!plan || !items.length) {
      kpiHost.className = 'reference-empty';
      kpiHost.textContent = `Chưa có KPI được giao cho tháng ${now.getMonth() + 1}/${now.getFullYear()}.`;
    } else {
      kpiHost.className = '';
      kpiHost.innerHTML = `${items.slice(0, 3).map(dashboardKpiCard).join('')}<footer>Cập nhật: ${esc(plan.reviewed_at || plan.updated_at || plan.created_at || '—')}</footer>`;
    }
  } catch (_) {
    if (kpiHost) { kpiHost.className = 'reference-empty'; kpiHost.textContent = 'Không thể tải KPI.'; }
  }

  if (isTts) {
    try {
      const assets = (await api.getAssets()).assets || [];
      const pending = assets.filter(a => a.user_id === me.id && a.status === 'pending_review').length;
      const host = document.getElementById('asset-pending-count');
      if (host && pending) host.textContent = `(${pending} chờ xác nhận)`;
    } catch (_) {}
  }
}
