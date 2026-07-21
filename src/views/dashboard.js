import { api } from '../api.js';
import { esc, fmtMoney, taskStatusBadge, statusBadge, loadingHTML, emptyHTML, today, lifecycleBadge } from '../utils.js';
import { openTaskPanel } from '../app.js';
import { renderAssetSection } from './assets.js';
import { renderEvalDashboardCard } from './evaluation.js';

const DEPT_COLORS = {
  'Content Marketing': '#6366F1',
  'SEO/SEM':           '#10B981',
  'Social Media':      '#F59E0B',
  'Design':            '#EF4444',
  'Performance':       '#3B82F6',
  'PR & Events':       '#8B5CF6',
  'Ban Giám Đốc':      '#0F172A',
};

function deptColor(name) {
  return DEPT_COLORS[name] || '#6366F1';
}

export async function renderDashboard(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';
  const greeting = getGreeting();

  el.innerHTML = `
    <!-- Welcome Banner -->
    <div style="background:linear-gradient(135deg,#1E293B 0%,#0F172A 100%);border-radius:16px;padding:22px 24px;margin-bottom:20px;border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden;">
      <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;border-radius:50%;background:rgba(99,102,241,.15);pointer-events:none;"></div>
      <div style="position:absolute;bottom:-30px;right:60px;width:80px;height:80px;border-radius:50%;background:rgba(244,63,94,.1);pointer-events:none;"></div>
      <div style="font-size:13px;color:#64748B;margin-bottom:4px;">${greeting}</div>
      <div style="font-size:22px;font-weight:800;color:#F1F5F9;letter-spacing:-.3px;">${esc(me.full_name)} 👋</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">${new Date().toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
      <div style="margin-top:14px;font-size:12px;color:#94A3B8;">
        <span style="background:rgba(99,102,241,.2);color:#A5B4FC;padding:4px 10px;border-radius:20px;font-weight:600;">${me.department || 'Marketing'}</span>
        <span style="margin-left:8px;background:rgba(16,185,129,.15);color:#6EE7B7;padding:4px 10px;border-radius:20px;font-weight:600;">${me.position || me.role}</span>
      </div>
      <div style="margin-top:8px;">${lifecycleBadge(me.lifecycle_status)}</div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions" id="dash-quick"></div>

    <!-- Stats -->
    <div class="stats-grid" id="dash-stats">${loadingHTML()}</div>

    <!-- Two-col layout -->
    <div style="display:grid;grid-template-columns:1fr;gap:14px;" id="dash-main">

      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 Công việc đang làm</div>
          <a href="#/tasks" class="card-link">Xem tất cả →</a>
        </div>
        <div id="dash-tasks">${loadingHTML()}</div>
      </div>

      ${isManager ? `
      <div class="card">
        <div class="card-header">
          <div class="card-title">⏱️ Điểm danh hôm nay</div>
          <a href="#/attendance" class="card-link">Chi tiết →</a>
        </div>
        <div id="dash-att">${loadingHTML()}</div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🏖️ Nghỉ phép chờ duyệt</div>
          <a href="#/leave" class="card-link">Quản lý →</a>
        </div>
        <div id="dash-leave">${loadingHTML()}</div>
      </div>
      ` : ''}

      <div id="dash-eval"></div>
      <div id="dash-assets"></div>
    </div>
  `;

  // Quick actions
  const quickEl = document.getElementById('dash-quick');
  const quickItems = [
    { href:'#/attendance', icon:'⏱️', label:'Chấm công', bg:'#EEF2FF', color:'#6366F1' },
    { href:'#/tasks',      icon:'📋', label:'Công việc', bg:'#FEF3C7', color:'#F59E0B' },
    { href:'#/leave',      icon:'🏖️', label:'Nghỉ phép', bg:'#D1FAE5', color:'#10B981' },
    { href:'#/invoices',   icon:'💵', label:'Phiếu lương', bg:'#FEE2E2', color:'#EF4444' },
    ...(isManager ? [
      { href:'#/users',       icon:'👥', label:'Nhân viên',   bg:'#EDE9FE', color:'#7C3AED' },
      { href:'#/campaigns',   icon:'📣', label:'Chiến dịch',  bg:'#CCFBF1', color:'#14B8A6' },
    ] : [
      { href:'#/settings',    icon:'⚙️', label:'Cài đặt',    bg:'#F1F5F9', color:'#64748B' },
    ]),
  ];
  quickEl.innerHTML = quickItems.map(q => `
    <a href="${q.href}" class="quick-btn" style="--quick-bg:${q.bg}">
      <div class="quick-btn-icon" style="background:${q.bg}"><span style="font-size:20px;">${q.icon}</span></div>
      <span class="quick-btn-label">${q.label}</span>
    </a>
  `).join('');

  // Load data
  const [tasksRes, attRes, leaveRes] = await Promise.allSettled([
    api.getTasks({ date: today() }),
    api.getAttendanceToday(),
    isManager ? api.getLeave({ status: 'pending' }) : Promise.resolve({ leave: [] }),
  ]);

  const tasks = tasksRes.status === 'fulfilled' ? (tasksRes.value.tasks || []) : [];
  const att   = attRes.status   === 'fulfilled' ? (attRes.value.attendance || []) : [];
  const leave = leaveRes.status === 'fulfilled' ? (leaveRes.value.leave || []) : [];

  // Đánh giá hiệu suất tháng (TTS) — self-contained, renders nothing if not relevant
  const evalEl = document.getElementById('dash-eval');
  if (evalEl) renderEvalDashboardCard(evalEl, me);

  // Asset handover (Bàn giao tài sản) — self-contained, renders nothing if not relevant
  const assetsEl = document.getElementById('dash-assets');
  if (assetsEl) renderAssetSection(assetsEl, me);

  // Stats
  const doneCount    = tasks.filter(t => t.status === 'done').length;
  const inProg       = tasks.filter(t => t.status === 'in-progress').length;
  const presentCount = att.filter(a => a.checkin_time).length;
  const leaveCount   = leave.length;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card" style="--stat-color:#6366F1;--stat-bg:#EEF2FF;">
      <div class="stat-icon-wrap">📋</div>
      <div class="stat-val">${tasks.length}</div>
      <div class="stat-label">Việc hôm nay</div>
    </div>
    <div class="stat-card" style="--stat-color:#10B981;--stat-bg:#D1FAE5;">
      <div class="stat-icon-wrap">✅</div>
      <div class="stat-val">${doneCount}</div>
      <div class="stat-label">Đã hoàn thành</div>
    </div>
    <div class="stat-card" style="--stat-color:#F59E0B;--stat-bg:#FEF3C7;">
      <div class="stat-icon-wrap">🔄</div>
      <div class="stat-val">${inProg}</div>
      <div class="stat-label">Đang thực hiện</div>
    </div>
    <div class="stat-card" style="--stat-color:${isManager ? '#3B82F6' : '#EF4444'};--stat-bg:${isManager ? '#DBEAFE' : '#FEE2E2'};">
      <div class="stat-icon-wrap">${isManager ? '👥' : '⭐'}</div>
      <div class="stat-val">${isManager ? presentCount : (me.salary ? Math.round(me.salary/1000000)+'M' : '—')}</div>
      <div class="stat-label">${isManager ? 'Đã check-in' : 'Lương cơ bản'}</div>
    </div>
  `;

  // Tasks list
  const dashTasks = document.getElementById('dash-tasks');
  if (!tasks.length) {
    dashTasks.innerHTML = emptyHTML('📋', 'Không có công việc hôm nay', 'Tất cả việc đã xong hoặc chưa có!');
  } else {
    dashTasks.innerHTML = tasks.slice(0, 5).map(t => `
      <div class="task-card" data-tid="${t.id}" style="border-left-color:${esc(t.label_color||'#6366F1')}">
        <div class="task-card-title">${esc(t.title)}</div>
        <div class="task-card-meta">
          ${taskStatusBadge(t.status)}
          ${t.assignee_name ? `<span class="task-card-assignee">👤 ${esc(t.assignee_name)}</span>` : ''}
          ${t.due_date ? `<span style="font-size:11px;color:var(--text-2)">📅 ${t.due_date}</span>` : ''}
          ${t.department ? `<span style="font-size:11px;color:var(--text-3);background:var(--bg);padding:2px 6px;border-radius:4px;">${esc(t.department)}</span>` : ''}
        </div>
      </div>
    `).join('');
    dashTasks.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTaskPanel(parseInt(card.dataset.tid)));
    });
  }

  // Attendance
  const dashAtt = document.getElementById('dash-att');
  if (dashAtt) {
    if (!att.length) {
      dashAtt.innerHTML = emptyHTML('⏱️', 'Chưa có dữ liệu chấm công hôm nay');
    } else {
      dashAtt.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Check-in</th><th>Trạng thái</th></tr></thead>
            <tbody>${att.slice(0, 8).map(a => `
              <tr>
                <td><span style="font-weight:600">${esc(a.full_name)}</span></td>
                <td><span style="font-size:11px;color:var(--text-2)">${esc(a.department||'—')}</span></td>
                <td>${esc(a.checkin_time || '—')}</td>
                <td>${statusBadge(a.status)}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      `;
    }
  }

  // Leave pending
  const dashLeave = document.getElementById('dash-leave');
  if (dashLeave) {
    if (!leave.length) {
      dashLeave.innerHTML = emptyHTML('🏖️', 'Không có đơn nghỉ phép chờ duyệt', 'Mọi đơn đã được xử lý');
    } else {
      dashLeave.innerHTML = leave.slice(0, 4).map(l => `
        <div class="leave-item" style="margin-bottom:8px;">
          <div class="leave-type-icon" style="background:${leaveColor(l.type)}20;">${leaveIcon(l.type)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);">${esc(l.employee_name||'—')}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px;">${leaveTypeLabel(l.type)} · ${esc(l.start_date)} → ${esc(l.end_date)}</div>
          </div>
          <span class="badge badge-warning" style="flex-shrink:0;">Chờ duyệt</span>
        </div>
      `).join('');
    }
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return '☀️ Chào buổi sáng,';
  if (h < 18) return '🌤️ Chào buổi chiều,';
  return '🌙 Chào buổi tối,';
}

function leaveIcon(type) {
  const map = { annual:'🏖️', sick:'🏥', personal:'👤', maternity:'👶', other:'📝' };
  return map[type] || '📝';
}
function leaveColor(type) {
  const map = { annual:'#6366F1', sick:'#EF4444', personal:'#F59E0B', maternity:'#EC4899', other:'#64748B' };
  return map[type] || '#64748B';
}
function leaveTypeLabel(type) {
  const map = { annual:'Phép năm', sick:'Ốm đau', personal:'Việc cá nhân', maternity:'Thai sản', other:'Khác' };
  return map[type] || type || '—';
}
