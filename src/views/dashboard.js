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

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Chào buổi sáng', icon: 'sun' };
  if (h < 18) return { text: 'Chào buổi chiều', icon: 'sun' };
  return { text: 'Chào buổi tối', icon: 'moon' };
}

async function renderEmployeeDashboard(el, me) {
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
          <div class="welcome-eyebrow"><span data-icon="${getTimeGreeting().icon}"></span> ${getTimeGreeting().text},</div>
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

const number = value => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const percent = value => `${Number(value || 0).toFixed(0)}%`;
const dashLink = (href, icon, value, title, detail, tone = 'neutral') => `<a class="admin-dash-stat ${tone}" href="${href}"><i data-icon="${icon}"></i><strong>${value}</strong><span>${esc(title)}</span><small>${esc(detail)}</small></a>`;
const progress = (value, tone = '') => `<div class="admin-dash-progress ${tone}" role="progressbar" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div>`;

async function renderAdminDashboard(el, me) {
  el.innerHTML = `<section class="admin-dashboard admin-dashboard-loading"><div class="admin-dash-hero"><div><p>TỔNG QUAN VẬN HÀNH</p><h1>Đang tải dữ liệu vận hành…</h1><small>Dashboard điều hành sử dụng dữ liệu trực tiếp từ hệ thống.</small></div></div><div class="admin-dash-stat-grid">${Array.from({length:5},()=>'<div class="admin-dash-skeleton"></div>').join('')}</div></section>`;
  let data;
  try { data = await api.getAdminDashboard(); } catch (error) { el.innerHTML = `<div class="reference-empty">Không thể tải Dashboard điều hành. ${esc(error.message || 'Vui lòng thử lại.')}</div>`; return; }
  const a=data.attendance,t=data.tasks,k=data.kpi,p=data.people,ap=data.approvals,al=data.employee_alerts;
  const date = new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const actions = data.action_items.length ? data.action_items.map(item=>`<article class="admin-action ${esc(item.severity)}"><span aria-hidden="true"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div><a href="${esc(item.action_url)}" class="btn-secondary btn-sm">${esc(item.action_label || 'Xem')}</a></article>`).join('') : '<p class="reference-empty">Không có hạng mục cần xử lý ngay.</p>';
  const insights = data.insights.map(item=>`<li class="${esc(item.severity)}">${esc(item.text)}</li>`).join('');
  const missing = (a.missing_people||[]).slice(0,4).map(x=>`<li>${esc(x.full_name)} · ${esc(x.department||'Chưa phân phòng')}</li>`).join('') || '<li>Chưa có danh sách chi tiết cần chú ý.</li>';
  const deptBars=(t.overdue_by_department||[]).map(row=>`<div class="admin-row-bar"><span>${esc(row.department)}</span><b>${number(row.count)}</b>${progress(t.overdue?Number(row.count)/t.overdue*100:0,'danger')}</div>`).join('') || '<p class="reference-empty">Chưa có việc quá hạn.</p>';
  const campaigns=(data.campaigns.items||[]).map(c=>`<div class="admin-campaign"><strong>${esc(c.name)}</strong><span>${c.budget?percent(c.spent/c.budget*100):'Chưa có ngân sách'}</span>${progress(c.budget?c.spent/c.budget*100:0,c.spent>c.budget?'danger':'')}<small>${number(c.spent)} / ${number(c.budget)} đ</small></div>`).join('') || '<p class="reference-empty">Chưa có chiến dịch đang chạy.</p>';
  el.innerHTML = `<section class="admin-dashboard"><header class="admin-dash-hero"><div><p>TỔNG QUAN VẬN HÀNH</p><h1>Chào ${esc(me.full_name || 'Admin')}</h1><small>${esc(date)} · Cập nhật ${esc(data.generated_at || '')}</small></div><div class="admin-dash-health"><b>Hệ thống đang hoạt động</b><span>${data.action_items.length ? `${data.action_items.length} vấn đề cần chú ý` : 'Không có vấn đề quan trọng cần xử lý'}</span></div></header><div class="admin-dash-stat-grid">${dashLink('#/users','users',number(p.active),'Nhân sự hoạt động',`${number(p.new_hires_month)} mới · ${number(p.probation)} thử việc · ${number(p.interns)} TTS`)}${dashLink('#/attendance','clock3',`${number(a.checked_in)} / ${number(a.eligible)}`,'Đã check-in',`${percent(a.checkin_rate)} · ${number(a.late)} đi muộn · ${number(a.approved_leave)} nghỉ phép`,a.checkin_rate>=80?'success':'warning')}${dashLink('#/tasks','clipboardList',number(t.overdue),'Việc quá hạn',t.overdue?'Cần theo dõi tiến độ':'Công việc đúng tiến độ',t.overdue?'danger':'success')}${dashLink(ap.leave>=ap.kpi?'#/leave':'#/kpis','circleAlert',number(ap.total),'Chờ xử lý',`${number(ap.leave)} nghỉ phép · ${number(ap.kpi)} KPI · ${number(ap.overtime)} tăng ca`,ap.total?'warning':'success')}${dashLink('#/notifications','bell',number(al.total),'Cảnh báo nhân sự',`${number(al.critical)} khẩn · ${number(al.warning)} cần chú ý`,al.critical?'danger':al.total?'warning':'success')}</div><div class="admin-dash-primary"><article class="admin-dash-panel"><header><h2>Cần xử lý ngay</h2><a href="#/notifications">Xem tất cả</a></header>${actions}</article><article class="admin-dash-panel"><header><h2>Insight hôm nay</h2></header><ul class="admin-insights">${insights}</ul></article></div><div class="admin-dash-grid"><article class="admin-dash-panel"><header><h2>Tình hình chấm công hôm nay</h2><a href="#/attendance">Xem chấm công →</a></header>${progress(a.checkin_rate,'success')}<div class="admin-metric-list"><span>Đã check-in <b>${number(a.checked_in)} · ${percent(a.checkin_rate)}</b></span><span>Đi muộn <b>${number(a.late)}</b></span><span>Nghỉ phép <b>${number(a.approved_leave)}</b></span><span>Chưa check-in <b>${number(a.not_checked_in)}</b></span></div><h3>Chưa check-in</h3><ul class="admin-people">${missing}</ul></article><article class="admin-dash-panel"><header><h2>Tiến độ công việc</h2><a href="#/tasks">Xem công việc →</a></header><div class="admin-metric-list"><span>Đang mở <b>${number(t.open)}</b></span><span>Đang làm <b>${number(t.in_progress)}</b></span><span>Review <b>${number(t.review)}</b></span><span>Hoàn thành 7 ngày <b>${number(t.done_last_7_days)}</b></span></div><h3>Việc quá hạn theo phòng ban</h3>${deptBars}</article><article class="admin-dash-panel"><header><h2>KPI tháng ${k.month}/${k.year}</h2><a href="#/kpis">Xem KPI nhân viên →</a></header><strong class="admin-kpi-coverage">${number(k.with_plan)} / ${number(k.eligible_employees)}</strong><span>Đã có kế hoạch KPI · ${percent(k.coverage_percent)} coverage</span>${progress(k.coverage_percent,'primary')}<div class="admin-metric-list"><span>Chưa thiết lập <b>${number(k.without_plan)}</b></span><span>Đang thực hiện <b>${number(k.draft)}</b></span><span>Chờ review <b>${number(k.submitted)}</b></span><span>Đã duyệt <b>${number(k.approved)}</b></span></div></article><article class="admin-dash-panel"><header><h2>Tuyển dụng</h2><a href="#/recruitment">Xem tuyển dụng →</a></header><div class="admin-metric-list"><span>Đang xử lý <b>${number(data.recruitment.active)}</b></span><span>Phỏng vấn <b>${number(data.recruitment.interview)}</b></span><span>Đang offer <b>${number(data.recruitment.offer)}</b></span><span>Đã tuyển tháng này <b>${number(data.recruitment.hired_this_month)}</b></span></div></article></div><article class="admin-dash-panel admin-campaign-panel"><header><h2>Chiến dịch Marketing</h2><a href="#/campaigns">Xem chiến dịch →</a></header><div class="admin-campaign-summary"><b>${number(data.campaigns.active)} đang chạy</b><span>${number(data.campaigns.spent)} / ${number(data.campaigns.budget)} đ${data.campaigns.spent_percent===null?'':' · '+percent(data.campaigns.spent_percent)}</span></div><div class="admin-campaigns">${campaigns}</div></article></section>`;
}

export async function renderDashboard(el, me) { return me.role === 'admin' ? renderAdminDashboard(el, me) : renderEmployeeDashboard(el, me); }
