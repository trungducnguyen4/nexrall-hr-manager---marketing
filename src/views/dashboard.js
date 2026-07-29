import { esc, lifecycleBadge } from '../utils.js';

const quickActions = [
  ['#/attendance', 'clock3', 'Chấm công', 'lavender'],
  ['#/tasks', 'clipboardList', 'Công việc', 'butter'],
  ['#/leave', 'calendarDays', 'Nghỉ phép', 'mint'],
  ['#/invoices', 'banknote', 'Phiếu lương', 'rose'],
  ['#/users', 'users', 'Nhân viên', 'violet'],
  ['#/campaigns', 'megaphone', 'Chiến dịch', 'aqua'],
];

const stats = [
  ['clipboardList', '0', 'Việc hôm nay', 'indigo'],
  ['circleCheck', '0', 'Đã hoàn thành', 'emerald'],
  ['refreshCw', '0', 'Đang thực hiện', 'amber'],
  ['users', '0', 'Đã check-in', 'blue'],
];

const kpis = [
  ['Hoàn thành công việc', '87%', '90%', 'Đang tốt', 'emerald', 87],
  ['Chất lượng công việc', '92', '90/100', 'Xuất sắc', 'blue', 92, '/100'],
  ['Tiến độ mục tiêu tháng', '75%', '80%', 'Đang tốt', 'amber', 75],
];

export async function renderDashboard(el, me) {
  const displayName = me.full_name || 'Nguyễn Văn Hậu';
  const department = me.department || 'Ban Giám Đốc';
  const position = me.position || 'Giám đốc';
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

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

        <nav class="reference-actions" aria-label="Điều hướng nhanh">
          ${quickActions.map(([href, icon, label, tone]) => `<a href="${href}" class="reference-action"><i class="action-icon ${tone}" data-icon="${icon}"></i><span>${label}</span></a>`).join('')}
        </nav>

        <div class="reference-stats">
          ${stats.map(([icon, value, label, tone]) => `<article class="reference-stat ${tone}"><i data-icon="${icon}"></i><strong>${value}</strong><span>${label}</span></article>`).join('')}
        </div>

        <div class="dash-bottom-grid">
          <article class="reference-panel"><div class="reference-panel-head"><h2><span data-icon="calendarDays"></span> Lịch làm việc</h2><span class="date-range">28/07 - 03/08/2026</span><a href="#/tasks">Xem tất cả <span data-icon="arrowRight"></span></a></div><div class="reference-empty">Tuần này chưa có lịch làm việc được lên kế hoạch.</div></article>
          <article class="reference-panel"><div class="reference-panel-head"><h2><span data-icon="bell"></span> Thông báo</h2><a href="#/settings">Xem tất cả <span data-icon="arrowRight"></span></a></div><div class="reference-empty">Không có thông báo mới</div></article>
        </div>
      </div>

      <aside class="reference-kpis"><div class="kpi-heading"><span data-icon="target"></span><h2>KPI của bạn</h2><a href="#/evaluation">Xem chi tiết <span data-icon="arrowRight"></span></a></div>
        ${kpis.map(([label, value, target, state, tone, percent, suffix = '']) => `<article class="reference-kpi ${tone}"><p>${label}</p><div class="kpi-value">${value}<small>${suffix}</small></div><div class="reference-progress"><i style="width:${percent}%"></i></div><div class="kpi-foot"><span>Mục tiêu: ${target}</span><b>● ${state}</b></div></article>`).join('')}
        <footer>Cập nhật: 29/07/2026</footer>
      </aside>
    </section>`;
}
