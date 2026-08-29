import { esc, lifecycleBadge, today, isHcnsDepartment, yieldToMain } from '../utils.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { renderGeoMap, classifyMarker } from '../geo-map.js?v=20260817-dash-geo-v1';
import { openTaskPanel } from '../app.js';

const EVAL_STATUS_META = {
  DRAFT:                       { label: 'Nháp',                       cls: 'badge-gray' },
  MENTOR_REVIEW:               { label: 'Đang đánh giá',              cls: 'badge-info' },
  EMPLOYEE_REVISION_REQUESTED: { label: 'TTS yêu cầu điều chỉnh',     cls: 'badge-warning' },
  CEO_REVISION_REQUESTED:      { label: 'BGĐ yêu cầu đánh giá lại',   cls: 'badge-warning' },
  EMPLOYEE_CONFIRMATION:       { label: 'Chờ TTS xác nhận',           cls: 'badge-info' },
  PENDING_CEO_APPROVAL:        { label: 'Chờ TGĐ phê duyệt',          cls: 'badge-warning' },
  CEO_APPROVED:                { label: 'Đã phê duyệt',               cls: 'badge-success' },
  HR_RECEIVED:                 { label: 'HCNS đã tiếp nhận',          cls: 'badge-success' },
  LOCKED:                      { label: 'Đã khóa',                    cls: 'badge-gray' },
};

function evalStatusLabel(ev) {
  if (!ev) return 'Chưa mở';
  const reviewish = ['MENTOR_REVIEW', 'EMPLOYEE_REVISION_REQUESTED', 'CEO_REVISION_REQUESTED'];
  if (reviewish.includes(ev.status)) {
    if (ev.status === 'EMPLOYEE_REVISION_REQUESTED' && !ev.mentor_submitted_at && !ev.department_submitted_at) return 'TTS yêu cầu điều chỉnh';
    if (ev.status === 'CEO_REVISION_REQUESTED' && !ev.mentor_submitted_at && !ev.department_submitted_at) return 'Chờ đánh giá lại (BGĐ trả về)';
    if (ev.mentor_submitted_at && !ev.department_submitted_at) return 'Mentor đã đánh giá';
    if (!ev.mentor_submitted_at && ev.department_submitted_at) return 'Trưởng phòng đã đánh giá';
    return 'Đang chờ đánh giá';
  }
  return (EVAL_STATUS_META[ev.status] || {}).label || ev.status;
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Chào buổi sáng', icon: '☀️' };
  if (h < 18) return { text: 'Chào buổi chiều', icon: '🌤️' };
  return { text: 'Chào buổi tối', icon: '🌙' };
}

function getInitials(name) {
  if (!name) return 'NV';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function renderEmployeeDashboard(el, me, isSwitched = false) {
  const isHrUser = isHcnsDepartment(me.department);
  const displayName = me.full_name || 'Nhân viên';
  const department = me.department || 'Chưa phân phòng';
  const position = me.position || 'Nhân viên';
  const todayStr = today();
  const todayFormatted = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const initials = getInitials(displayName);
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  el.innerHTML = `
    <section class="emp-dashboard">
      ${isHrUser ? `
        <div class="hr-dash-header" style="margin-bottom:18px;">
          <div class="hr-dash-title-box">
            <h1>${icon('user', 'md')} Không Gian Cá Nhân Của Bạn</h1>
            <p>Tiến độ công việc, nhiệm vụ & chấm công cá nhân của bạn</p>
          </div>
          <div class="hr-tab-switcher">
            <button type="button" class="hr-tab-btn" id="tab-btn-back-org">
              ${icon('barChart3', 'xs')} Bảng Điều Hành Nhân Sự & Quản Trị
            </button>
            <button type="button" class="hr-tab-btn active">
              ${icon('user', 'xs')} Không gian cá nhân
            </button>
          </div>
        </div>
      ` : ''}

      <!-- 1. Hero Banner with Quick Attendance Widget (Single clock in header) -->
      <header class="emp-hero">
        <div class="emp-hero-info">
          <div class="emp-hero-greeting">
            <span class="emp-greeting-pill">${getTimeGreeting().icon} ${getTimeGreeting().text}</span>
            <span class="emp-date-pill">${todayFormatted}</span>
          </div>
          <div class="emp-user-card">
            <div class="emp-avatar-circle" style="background:${esc(me.avatar_color || '#4f46e5')}">${esc(initials)}</div>
            <div>
              <h1>${esc(displayName)}</h1>
              <div class="emp-meta-pills">
                <span class="emp-meta-pill dept-pill">🏢 ${esc(department)}</span>
                <span class="emp-meta-pill pos-pill">💼 ${esc(position)}</span>
                <span class="emp-meta-pill">${lifecycleBadge(me.lifecycle_status || 'Chính thức')}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="emp-clock-widget">
          <div class="emp-clock-head">
            <span>⏱️</span>
            <span>Chấm công hôm nay</span>
          </div>
          <div class="emp-clock-status" id="emp-clock-status">
            <span class="dot amber"></span> Đang kết nối GPS...
          </div>
          <div class="emp-clock-action" id="emp-clock-action">
            <a href="#/attendance" class="emp-clock-btn emp-clock-btn--checkin">⚡ Chấm công ngay</a>
          </div>
        </div>
      </header>

      <!-- 2. Main 2x2 Balanced Grid Layout -->
      <div class="emp-dashboard-grid">
        <!-- 1. Top-Left: Task 5-Status Bar Chart -->
        <article class="emp-panel emp-tasks-panel">
          <header class="emp-panel-head">
            <div>
              <h2>📊 Tiến độ & Khối lượng công việc</h2>
              <p>Tổng hợp công việc theo 5 trạng thái</p>
            </div>
            <a href="#/tasks" class="emp-link-subtle">Xem bảng việc →</a>
          </header>
          <div id="emp-task-barchart" class="emp-panel-body">
            <div class="emp-skeleton-chart" aria-hidden="true"></div>
          </div>
        </article>

        <!-- 2. Top-Right: Attendance Monthly Summary Widget: 2 Circular Progress Rings -->
        <article class="emp-panel emp-att-panel">
          <header class="emp-panel-head">
            <div>
              <h2>🗓️ Tổng quan kỳ công T${currentMonth}/${currentYear}</h2>
              <p>Chuyên cần & ngày công thực tế</p>
            </div>
            <a href="#/attendance" class="emp-link-subtle">Lịch sử →</a>
          </header>
          <div id="emp-att-summary-content" class="emp-panel-body">
            <div class="emp-skeleton-rings" aria-hidden="true"></div>
          </div>
        </article>

        <!-- 3. Bottom-Left: Actionable Tasks List -->
        <article class="emp-panel emp-tasks-panel">
          <header class="emp-panel-head">
            <div>
              <h2>📋 Công việc của tôi</h2>
              <p>Nhiệm vụ được giao & bạn đang theo dõi</p>
            </div>
            <div class="emp-panel-actions">
              <div class="emp-tab-pills" id="emp-task-tabs">
                <button type="button" class="emp-tab-pill active" data-tab="active">Cần làm</button>
                <button type="button" class="emp-tab-pill" data-tab="today">Hôm nay / Gấp</button>
                <button type="button" class="emp-tab-pill" data-tab="done">Đã xong</button>
              </div>
              <a href="#/tasks" class="emp-link-subtle">Xem bảng việc →</a>
            </div>
          </header>
          <div id="emp-tasks-list" class="emp-tasks-list emp-panel-body">
            <div class="emp-skeleton-list" aria-hidden="true">
              <div class="emp-skeleton-row"></div>
              <div class="emp-skeleton-row"></div>
              <div class="emp-skeleton-row"></div>
              <div class="emp-skeleton-row"></div>
            </div>
          </div>
        </article>

        <!-- 4. Bottom-Right: Leave & OT Requests Monthly Widget -->
        <article class="emp-panel emp-requests-panel">
          <header class="emp-panel-head">
            <div>
              <h2>🏖️ Đơn nghỉ phép & Tăng ca (OT)</h2>
              <p>Tiến độ duyệt đơn trong tháng ${currentMonth}/${currentYear}</p>
            </div>
            <div style="display:flex;gap:6px;">
              <a href="#/leave" class="btn-secondary btn-xs" style="text-decoration:none;">+ Nghỉ phép</a>
              <a href="#/attendance" class="btn-secondary btn-xs" style="text-decoration:none;">+ Đăng ký OT</a>
            </div>
          </header>
          <div id="emp-requests-content" class="emp-panel-body">
            <div class="emp-skeleton-requests" aria-hidden="true"></div>
          </div>
        </article>
      </div>
    </section>
  `;

  // Parallel load of data
  let userTasks = [];
  let currentTab = 'active';

  // 1. Load Attendance Today Status
  async function loadTodayAttendance() {
    const statusEl = document.getElementById('emp-clock-status');
    const actionEl = document.getElementById('emp-clock-action');
    if (!statusEl) return;
    try {
      const { attendance = [] } = await api.getAttendanceToday();
      const myRow = attendance.find(a => Number(a.user_id) === Number(me.id)) || attendance[0];
      if (myRow && myRow.checkin_time) {
        if (myRow.checkout_time) {
          statusEl.innerHTML = `<span class="dot green"></span> Đã hoàn thành ca: <b>${esc(myRow.checkin_time)} - ${esc(myRow.checkout_time)}</b>`;
          actionEl.innerHTML = `<a href="#/attendance" class="emp-clock-btn emp-clock-btn--done">✓ Đã chấm công về (${esc(myRow.checkout_time)})</a>`;
        } else {
          statusEl.innerHTML = `<span class="dot green"></span> Đang làm việc · Vào lúc <b>${esc(myRow.checkin_time)}</b>`;
          actionEl.innerHTML = `<a href="#/attendance" class="emp-clock-btn emp-clock-btn--checkout">Chấm công về (Check-out)</a>`;
        }
      } else {
        statusEl.innerHTML = `<span class="dot amber"></span> Chưa chấm công hôm nay`;
        actionEl.innerHTML = `<a href="#/attendance" class="emp-clock-btn emp-clock-btn--checkin">⚡ Chấm công ngay (GPS)</a>`;
      }
    } catch (_) {
      statusEl.innerHTML = `<span class="dot gray"></span> Chưa có dữ liệu chấm công`;
      actionEl.innerHTML = `<a href="#/attendance" class="emp-clock-btn emp-clock-btn--checkin">Vào Chấm công</a>`;
    }
  }

  // 2. Render 5-Status Task Bar Chart
  function renderTaskBarChart() {
    const chartHost = document.getElementById('emp-task-barchart');
    if (!chartHost) return;

    let todoCount = 0;
    let inProgressCount = 0;
    let reviewCount = 0;
    let doneCount = 0;
    let cancelledCount = 0;

    for (const t of userTasks) {
      const st = t.status || 'todo';
      if (st === 'todo' || st === 'open') todoCount++;
      else if (st === 'in_progress' || st === 'in-progress') inProgressCount++;
      else if (st === 'review') reviewCount++;
      else if (st === 'done') doneCount++;
      else if (st === 'cancelled') cancelledCount++;
      else todoCount++;
    }

    const total = userTasks.length;
    const maxCount = Math.max(1, todoCount, inProgressCount, reviewCount, doneCount, cancelledCount);
    const doneRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    const todoH = Math.max(8, Math.round((todoCount / maxCount) * 100));
    const inProgH = Math.max(8, Math.round((inProgressCount / maxCount) * 100));
    const reviewH = Math.max(8, Math.round((reviewCount / maxCount) * 100));
    const doneH = Math.max(8, Math.round((doneCount / maxCount) * 100));
    const cancH = Math.max(8, Math.round((cancelledCount / maxCount) * 100));

    chartHost.innerHTML = `
      <div class="emp-barchart-container">
        <div class="emp-barchart-header">
          <div class="emp-barchart-metric">
            <span class="emp-barchart-total">Tổng: <strong>${total}</strong> công việc</span>
            <span class="emp-barchart-rate">Tỷ lệ hoàn thành: <strong>${doneRate}%</strong></span>
          </div>
        </div>

        <div class="emp-barchart-bars">
          <!-- 1. Chờ làm -->
          <a href="#/tasks" class="emp-bar-col" title="Chờ làm: ${todoCount} việc">
            <span class="emp-bar-val" style="color:#3b82f6;">${todoCount}</span>
            <div class="emp-bar-track">
              <div class="emp-bar-fill blue" style="height:${todoCount > 0 ? todoH : 4}%;"></div>
            </div>
            <span class="emp-bar-label">Chờ làm</span>
          </a>

          <!-- 2. Đang làm -->
          <a href="#/tasks" class="emp-bar-col" title="Đang làm: ${inProgressCount} việc">
            <span class="emp-bar-val" style="color:#f59e0b;">${inProgressCount}</span>
            <div class="emp-bar-track">
              <div class="emp-bar-fill amber" style="height:${inProgressCount > 0 ? inProgH : 4}%;"></div>
            </div>
            <span class="emp-bar-label">Đang làm</span>
          </a>

          <!-- 3. Review -->
          <a href="#/tasks" class="emp-bar-col" title="Review: ${reviewCount} việc">
            <span class="emp-bar-val" style="color:#8b5cf6;">${reviewCount}</span>
            <div class="emp-bar-track">
              <div class="emp-bar-fill purple" style="height:${reviewCount > 0 ? reviewH : 4}%;"></div>
            </div>
            <span class="emp-bar-label">Review</span>
          </a>

          <!-- 4. Hoàn thành -->
          <a href="#/tasks" class="emp-bar-col" title="Hoàn thành: ${doneCount} việc">
            <span class="emp-bar-val" style="color:#10b981;">${doneCount}</span>
            <div class="emp-bar-track">
              <div class="emp-bar-fill emerald" style="height:${doneCount > 0 ? doneH : 4}%;"></div>
            </div>
            <span class="emp-bar-label">Hoàn thành</span>
          </a>

          <!-- 5. Hủy -->
          <a href="#/tasks" class="emp-bar-col" title="Hủy: ${cancelledCount} việc">
            <span class="emp-bar-val" style="color:#ef4444;">${cancelledCount}</span>
            <div class="emp-bar-track">
              <div class="emp-bar-fill rose" style="height:${cancelledCount > 0 ? cancH : 4}%;"></div>
            </div>
            <span class="emp-bar-label">Hủy</span>
          </a>
        </div>
      </div>

      <div class="emp-att-details-pills">
        <span class="emp-att-detail-pill"><b style="color:#3b82f6;">●</b> Chờ làm: <b>${todoCount}</b></span>
        <span class="emp-att-detail-pill"><b style="color:#f59e0b;">●</b> Đang làm: <b>${inProgressCount}</b></span>
        <span class="emp-att-detail-pill"><b style="color:#8b5cf6;">●</b> Review: <b>${reviewCount}</b></span>
        <span class="emp-att-detail-pill"><b style="color:#10b981;">●</b> Hoàn thành: <b>${doneCount}</b></span>
        <span class="emp-att-detail-pill"><b style="color:#ef4444;">●</b> Hủy: <b>${cancelledCount}</b></span>
      </div>

      <a href="#/tasks" class="btn-secondary btn-sm" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;text-decoration:none;">Xem bảng công việc Kanban →</a>
    `;
  }

  // 3. Load Tasks
  function renderTaskList() {
    const listEl = document.getElementById('emp-tasks-list');
    if (!listEl) return;

    let filtered = [];
    if (currentTab === 'active') {
      filtered = userTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
    } else if (currentTab === 'today') {
      filtered = userTasks.filter(t => t.status !== 'done' && (t.priority === 'urgent' || t.priority === 'high' || (t.due_date && t.due_date <= todayStr)));
    } else if (currentTab === 'done') {
      filtered = userTasks.filter(t => t.status === 'done');
    }

    if (!filtered.length) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-3);">
          <div style="font-size:28px;margin-bottom:8px;">✨</div>
          <strong style="color:var(--text);display:block;margin-bottom:4px;">
            ${currentTab === 'done' ? 'Chưa có công việc hoàn thành gần đây.' : 'Tuyệt vời! Bạn không có việc nào tồn đọng.'}
          </strong>
          <p style="font-size:12px;margin:0 0 12px;">Mọi đầu việc được giao đã được xử lý xong.</p>
          <a href="#/tasks" class="btn-secondary btn-sm">+ Tạo công việc mới</a>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.slice(0, 8).map(task => {
      const isDone = task.status === 'done';
      let dueBadge = '';
      if (task.due_date) {
        if (isDone) {
          dueBadge = `<span class="emp-due-badge future">Hạn: ${task.due_date}</span>`;
        } else if (task.due_date < todayStr) {
          dueBadge = `<span class="emp-due-badge overdue">⚠️ Quá hạn ${task.due_date}</span>`;
        } else if (task.due_date === todayStr) {
          dueBadge = `<span class="emp-due-badge today">🔥 Hạn hôm nay</span>`;
        } else {
          dueBadge = `<span class="emp-due-badge future">Hạn: ${task.due_date}</span>`;
        }
      }

      const statusMap = {
        todo: { label: 'Chờ làm', cls: 'open' },
        open: { label: 'Chờ làm', cls: 'open' },
        'in-progress': { label: 'Đang làm', cls: 'in_progress' },
        in_progress: { label: 'Đang làm', cls: 'in_progress' },
        review: { label: 'Review', cls: 'review' },
        done: { label: 'Hoàn thành', cls: 'done' },
        cancelled: { label: 'Đã hủy', cls: 'overdue' },
      };
      const st = statusMap[task.status] || { label: task.status || 'Mở', cls: 'open' };

      return `
        <div class="emp-task-item ${task.priority === 'urgent' && !isDone ? 'is-urgent' : ''}" data-task-id="${task.id}">
          <button type="button" class="emp-task-check ${isDone ? 'checked' : ''}" data-action="toggle-task" data-task-id="${task.id}" title="${isDone ? 'Chuyển về đang làm' : 'Đánh dấu hoàn thành'}">
            ${isDone ? '✓' : ''}
          </button>
          <div class="emp-task-content" data-action="open-task" data-task-id="${task.id}">
            <div class="emp-task-title" style="${isDone ? 'text-decoration:line-through;color:var(--text-3);' : ''}">${esc(task.title)}</div>
            <div class="emp-task-meta">
              ${task.project_name ? `<span>📁 ${esc(task.project_name)}</span>` : ''}
              ${task.group_name ? `<span>${esc(task.group_name)}</span>` : ''}
              ${dueBadge}
              ${task.subtask_total ? `<span>☑️ ${task.subtask_done}/${task.subtask_total} việc con</span>` : ''}
            </div>
          </div>
          <span class="emp-task-status-pill ${st.cls}">${st.label}</span>
        </div>
      `;
    }).join('');
  }

  async function loadTasks() {
    try {
      const data = await api.getTasks();
      const all = Array.isArray(data) ? data : (data.tasks || []);
      userTasks = all.filter(t => Number(t.assigned_to) === Number(me.id) || Number(t.assigned_by) === Number(me.id));
      renderTaskBarChart();
      renderTaskList();
    } catch (_) {
      const listEl = document.getElementById('emp-tasks-list');
      if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-3);">Không thể tải danh sách việc.</div>`;
    }
  }

  // 4. Load Monthly Leave & OT Requests Widget (chưa duyệt / đã duyệt)
  async function loadRequestsAndOT() {
    const host = document.getElementById('emp-requests-content');
    if (!host) return;
    try {
      const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      const [leaveRes, otReqRes, otFormRes] = await Promise.allSettled([
        api.getLeave({ self: 1 }),
        api.getOvertimeRequests({ month: monthStr }),
        api.getOvertimeForms({ month: monthStr }),
      ]);

      const allLeaves = (leaveRes.status === 'fulfilled' && leaveRes.value?.leave) ? leaveRes.value.leave : [];
      const monthLeaves = allLeaves.filter(l => {
        if (l.start_date && l.start_date.startsWith(monthStr)) return true;
        if (l.end_date && l.end_date.startsWith(monthStr)) return true;
        if (l.submitted_at && l.submitted_at.startsWith(monthStr)) return true;
        return false;
      });

      const allOtReqs = (otReqRes.status === 'fulfilled' && otReqRes.value?.overtime_requests) ? otReqRes.value.overtime_requests : [];
      const allOtForms = (otFormRes.status === 'fulfilled' && otFormRes.value?.overtime_forms) ? otFormRes.value.overtime_forms : [];

      const pendingLeaves = monthLeaves.filter(l => l.status === 'pending');
      const approvedLeaves = monthLeaves.filter(l => l.status === 'approved');

      const pendingOtReqs = allOtReqs.filter(o => o.status === 'pending');
      const approvedOtReqs = allOtReqs.filter(o => o.status === 'approved');
      const pendingOtForms = allOtForms.filter(f => f.status === 'pending');
      const approvedOtForms = allOtForms.filter(f => f.status === 'approved');

      const pendingOtCount = pendingOtReqs.length + pendingOtForms.length;
      const approvedOtCount = approvedOtReqs.length + approvedOtForms.length;

      const unifiedItems = [
        ...monthLeaves.map(l => ({
          type: 'leave',
          title: l.type_name || 'Nghỉ phép',
          dateStr: l.start_date === l.end_date ? l.start_date : `${l.start_date} → ${l.end_date}`,
          detail: `${l.total_days || 1} ngày · ${l.reason || 'Nghỉ phép cá nhân'}`,
          status: l.status,
          link: '#/leave',
          rawDate: l.start_date || l.submitted_at || '',
        })),
        ...allOtReqs.map(o => ({
          type: 'ot',
          title: 'Tăng ca (Checkout)',
          dateStr: o.work_date,
          detail: `${((o.approved_minutes || o.requested_minutes || 0) / 60).toFixed(1)} giờ · ${o.reason || 'Tăng ca hoàn thành việc'}`,
          status: o.status,
          link: '#/attendance',
          rawDate: o.work_date || o.created_at || '',
        })),
        ...allOtForms.map(f => ({
          type: 'ot',
          title: `Phiếu OT ${f.period_month || monthStr}`,
          dateStr: f.period_month || monthStr,
          detail: `${((f.approved_minutes || f.requested_minutes || 0) / 60).toFixed(1)} giờ (${(f.items || []).length} mục)`,
          status: f.status,
          link: '#/attendance',
          rawDate: f.submitted_at || f.period_month || '',
        })),
      ];

      unifiedItems.sort((a, b) => (b.rawDate || '').localeCompare(a.rawDate || ''));

      host.innerHTML = `
        <div class="emp-requests-summary">
          <div class="emp-req-summary-pill">
            <span>🏖️ Đơn nghỉ phép</span>
            <strong>
              <span class="highlight-pending">${pendingLeaves.length} chờ duyệt</span> ·
              <span class="highlight-approved">${approvedLeaves.length} đã duyệt</span>
            </strong>
          </div>
          <div class="emp-req-summary-pill">
            <span>⏰ Tăng ca (OT)</span>
            <strong>
              <span class="highlight-pending">${pendingOtCount} chờ duyệt</span> ·
              <span class="highlight-approved">${approvedOtCount} đã duyệt</span>
            </strong>
          </div>
        </div>

        ${unifiedItems.length ? `
          <div class="emp-requests-list">
            ${unifiedItems.slice(0, 6).map(item => {
              const statusMap = {
                pending: { label: '⏳ Chờ duyệt', cls: 'badge-warning' },
                approved: { label: '✅ Đã duyệt', cls: 'badge-success' },
                rejected: { label: '❌ Từ chối', cls: 'badge-danger' },
                draft: { label: 'Nháp', cls: 'badge-gray' },
              };
              const st = statusMap[item.status] || { label: item.status, cls: 'badge-gray' };
              const icon = item.type === 'leave' ? '🏖️' : '⏰';

              return `
                <a href="${item.link}" class="emp-req-item">
                  <div class="emp-req-info">
                    <div class="emp-req-head">
                      <span>${icon}</span>
                      <span class="emp-req-type">${esc(item.title)}</span>
                      <span class="badge ${st.cls}" style="font-size:10px;padding:2px 6px;">${st.label}</span>
                    </div>
                    <div class="emp-req-meta">
                      📅 ${esc(item.dateStr)} · ${esc(item.detail)}
                    </div>
                  </div>
                  <span style="color:var(--primary);font-size:12px;font-weight:700;">→</span>
                </a>
              `;
            }).join('')}
          </div>
        ` : `
          <div style="text-align:center;padding:18px 12px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border);">
            <div style="font-size:24px;margin-bottom:4px;">✨</div>
            <strong style="display:block;font-size:13px;color:var(--text);">Chưa có đơn nghỉ phép hay tăng ca nào</strong>
            <p style="font-size:11.5px;color:var(--text-3);margin:4px 0 10px;">Tháng ${currentMonth}/${currentYear} chưa phát sinh yêu cầu mới.</p>
            <div style="display:flex;justify-content:center;gap:8px;">
              <a href="#/leave" class="btn-secondary btn-xs" style="text-decoration:none;">+ Xin nghỉ</a>
              <a href="#/attendance" class="btn-secondary btn-xs" style="text-decoration:none;">+ Báo OT</a>
            </div>
          </div>
        `}
      `;
    } catch (_) {
      host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px;text-align:center;">Không thể tải dữ liệu đơn từ & tăng ca.</div>`;
    }
  }

  // 5. Load Attendance Monthly Summary with 2 Circular Progress Rings
  async function loadAttendanceDetails() {
    const host = document.getElementById('emp-att-summary-content');
    if (!host) return;
    try {
      const data = await api.getEmployeeAttendanceSummary(me.id, { month: currentMonth, year: currentYear });
      const summary = data?.summary || {};
      const standardDays = Number(summary.standardWorkDays || 21);
      const actualWorkDays = Number(summary.actualWorkDays || 0);
      const attendanceRate = summary.attendanceRate != null ? Math.round(Number(summary.attendanceRate)) : (standardDays > 0 ? Math.min(100, Math.round((actualWorkDays / standardDays) * 100)) : 100);
      const daysPercent = standardDays > 0 ? Math.min(100, Math.round((actualWorkDays / standardDays) * 100)) : 0;
      const lateDays = Number(summary.lateDays || 0);
      const paidLeaveDays = Number(summary.paidLeaveDays || 0);
      const officeDays = Number(summary.officeDays || 0);
      const wfhDays = Number(summary.wfhDays || 0);

      const circumference = 251.33;
      const attOffset = (circumference * (1 - Math.min(100, Math.max(0, attendanceRate)) / 100)).toFixed(1);
      const daysOffset = (circumference * (1 - Math.min(100, Math.max(0, daysPercent)) / 100)).toFixed(1);

      host.innerHTML = `
        <div class="emp-circle-charts">
          <!-- 1. Biểu đồ tròn Tỷ lệ chuyên cần -->
          <div class="emp-circle-chart-item">
            <div class="emp-ring-box">
              <svg viewBox="0 0 100 100" class="emp-ring-svg">
                <circle cx="50" cy="50" r="40" class="emp-ring-bg" />
                <circle cx="50" cy="50" r="40" class="emp-ring-fill emerald" style="stroke-dashoffset:${attOffset};" />
              </svg>
              <div class="emp-ring-inner">
                <strong style="color:#10b981;">${attendanceRate}%</strong>
                <small>Chuyên cần</small>
              </div>
            </div>
            <span class="emp-circle-label">Tỷ lệ chuyên cần</span>
          </div>

          <!-- 2. Biểu đồ tròn Số ngày công -->
          <div class="emp-circle-chart-item">
            <div class="emp-ring-box">
              <svg viewBox="0 0 100 100" class="emp-ring-svg">
                <circle cx="50" cy="50" r="40" class="emp-ring-bg" />
                <circle cx="50" cy="50" r="40" class="emp-ring-fill indigo" style="stroke-dashoffset:${daysOffset};" />
              </svg>
              <div class="emp-ring-inner">
                <strong style="color:#6366f1;">${actualWorkDays}<span>/${standardDays}</span></strong>
                <small>Ngày công</small>
              </div>
            </div>
            <span class="emp-circle-label">Số ngày công</span>
          </div>
        </div>

        <div class="emp-att-details-pills">
          <span class="emp-att-detail-pill">🏢 Văn phòng: <b>${officeDays}</b></span>
          <span class="emp-att-detail-pill">🏠 WFH: <b>${wfhDays}</b></span>
          <span class="emp-att-detail-pill" style="${lateDays > 0 ? 'color:#d97706;border-color:rgba(245,158,11,0.3);' : ''}">⏰ Đi muộn: <b>${lateDays} lần</b></span>
          <span class="emp-att-detail-pill">🏖️ Nghỉ phép: <b>${paidLeaveDays} ngày</b></span>
        </div>

        <a href="#/attendance" class="btn-secondary btn-sm" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;text-decoration:none;">Xem lịch sử chấm công →</a>
      `;
    } catch (_) {
      host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px;text-align:center;">Chưa có dữ liệu kỳ công tháng ${currentMonth}/${currentYear}.</div>`;
    }
  }

  // Event Listeners
  document.getElementById('emp-task-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.emp-tab-pill');
    if (!btn) return;
    document.querySelectorAll('#emp-task-tabs .emp-tab-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderTaskList();
  });

  const listElRef = document.getElementById('emp-tasks-list');
  listElRef?.addEventListener('click', async e => {
    const openBtn = e.target.closest('[data-action="open-task"]');
    if (openBtn) {
      const tid = parseInt(openBtn.dataset.taskId, 10);
      if (tid) openTaskPanel(tid);
      return;
    }

    const toggleBtn = e.target.closest('[data-action="toggle-task"]');
    if (toggleBtn) {
      const tid = parseInt(toggleBtn.dataset.taskId, 10);
      const task = userTasks.find(t => t.id === tid);
      if (!task) return;
      const nextStatus = task.status === 'done' ? 'in_progress' : 'done';
      try {
        await api.updateTask(tid, { status: nextStatus });
        task.status = nextStatus;
        renderTaskList();
        renderTaskBarChart();
      } catch (err) {
        alert(err.message || 'Không thể cập nhật trạng thái');
      }
    }
  });

  document.getElementById('tab-btn-back-org')?.addEventListener('click', async (e) => {
    e.target?.closest?.('.hr-tab-btn')?.classList?.add('active');
    localStorage.setItem('hr_dashboard_tab', 'org');
    await yieldToMain();
    await renderHrDashboard(el, me, 'org');
  });

  el._dashUpdaters = {
    type: 'employee',
    loadTodayAttendance,
    loadTasks,
    loadRequestsAndOT,
    loadAttendanceDetails,
    refreshAll: () => Promise.allSettled([
      loadTodayAttendance(),
      loadTasks(),
      loadRequestsAndOT(),
      loadAttendanceDetails(),
    ]),
  };

  await Promise.allSettled([
    loadTodayAttendance(),
    loadTasks(),
    loadRequestsAndOT(),
    loadAttendanceDetails(),
  ]);
}

function fmtMoneyShort(val) {
  const num = Number(val || 0);
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + ' tỷ';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(0) + ' tr';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + ' k';
  return new Intl.NumberFormat('vi-VN').format(num) + ' đ';
}

const number = value => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const percent = value => `${Number(value || 0).toFixed(1)}%`;
const dashLink = (href, icon, value, title, detail, tone = 'neutral') => `<a class="admin-dash-stat ${tone}" href="${href}"><i data-icon="${icon}"></i><strong>${value}</strong><span>${esc(title)}</span><small>${esc(detail)}</small></a>`;
const progress = (value, tone = '') => `<div class="admin-dash-progress ${tone}" role="progressbar" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div>`;

// ── 1. ORIGINAL ADMIN DASHBOARD (TỔNG QUAN VẬN HÀNH CHO ADMIN) ──
async function renderAdminDashboard(el, me) {
  el.innerHTML = `<section class="admin-dashboard admin-dashboard-loading"><div class="admin-dash-hero"><div><p>TỔNG QUAN VẬN HÀNH</p><h1>Đang tải dữ liệu vận hành…</h1><small>Dashboard điều hành sử dụng dữ liệu trực tiếp từ hệ thống.</small></div></div><div class="admin-dash-stat-grid">${Array.from({length:4},()=>'<div class="admin-dash-skeleton"></div>').join('')}</div></section>`;
  let data;
  try { data = await api.getAdminDashboard(); } catch (error) { el.innerHTML = `<div class="reference-empty">Không thể tải Dashboard điều hành. ${esc(error.message || 'Vui lòng thử lại.')}</div>`; return; }
  const a = data.attendance || {}, p = data.people || {}, ap = data.approvals || {}, al = data.employee_alerts || {};
  const date = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const actions = (data.action_items || []).length ? data.action_items.map(item => `<article class="admin-action ${esc(item.severity)}"><span aria-hidden="true"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div><a href="${esc(item.action_url)}" class="admin-action-btn btn-secondary btn-sm">${esc(item.action_label || 'Xem')}</a></article>`).join('') : '<p class="reference-empty">Không có hạng mục cần xử lý ngay.</p>';
  const insights = (data.insights || []).map(item => `<li class="${esc(item.severity)}">${esc(item.text)}</li>`).join('');
  const campaigns = (data.campaigns?.items || []).map(c => `<div class="admin-campaign"><strong>${esc(c.name)}</strong><span>${c.budget ? percent(c.spent / c.budget * 100) : 'Chưa có ngân sách'}</span>${progress(c.budget ? c.spent / c.budget * 100 : 0, c.spent > c.budget ? 'danger' : '')}<small>${number(c.spent)} / ${number(c.budget)} đ</small></div>`).join('') || '<p class="reference-empty">Chưa có chiến dịch đang chạy.</p>';

  const checkedIn = Number(a.checked_in || 0);
  const eligible = Number(a.eligible || 0);
  const checkinRate = a.checkin_rate != null ? Math.round(Number(a.checkin_rate)) : (eligible > 0 ? Math.min(100, Math.round((checkedIn / eligible) * 100)) : 0);
  const circumference = 251.33;
  const checkinOffset = (circumference * (1 - Math.min(100, Math.max(0, checkinRate)) / 100)).toFixed(1);

  const missingPeople = a.missing_people || [];
  const missingChips = missingPeople.length
    ? missingPeople.slice(0, 6).map(x => `<span class="admin-att-missing-chip">👤 ${esc(x.full_name)} <small>(${esc(x.department || 'Chưa phân phòng')})</small></span>`).join('')
    : '';

  el.innerHTML = `
    <section class="admin-dashboard">
      <header class="admin-dash-hero">
        <div>
          <p>TỔNG QUAN VẬN HÀNH</p>
          <h1>Chào ${esc(me.full_name || 'Admin')}</h1>
          <small>${esc(date)} · Cập nhật ${esc(data.generated_at || '')}</small>
        </div>
        <div class="admin-dash-health">
          <b>Hệ thống đang hoạt động</b>
          <span>${(data.action_items || []).length ? `${data.action_items.length} vấn đề cần chú ý` : 'Không có vấn đề quan trọng cần xử lý'}</span>
        </div>
      </header>

      <!-- ── DASHBOARD TOP SPLIT: TỶ LỆ CHECK-IN (50% TRÁI) + TỔNG QUAN NHÂN SỰ (50% PHẢI) ── -->
      <div class="admin-dash-top-split">
        <!-- Attendance Circular Donut Ring & Stats Overview (50% TRÁI) -->
        <div class="admin-att-summary-row">
          <div class="admin-att-ring-card">
            <div class="emp-ring-box" style="width:105px;height:105px;">
              <svg viewBox="0 0 100 100" class="emp-ring-svg">
                <circle cx="50" cy="50" r="40" class="emp-ring-bg" style="stroke:rgba(0,0,0,0.06);stroke-width:9;" />
                <circle cx="50" cy="50" r="40" class="emp-ring-fill emerald" style="stroke:#10b981;stroke-width:9;stroke-dasharray:251.33;stroke-dashoffset:${checkinOffset};" />
              </svg>
              <div class="emp-ring-inner">
                <strong style="font-size:20px;color:#10b981;">${checkinRate}%</strong>
                <small style="font-size:10px;color:var(--text-2);font-weight:600;">${number(checkedIn)}/${number(eligible)}</small>
              </div>
            </div>
            <div class="admin-att-ring-label">
              <strong>Tỷ lệ Check-in</strong>
              <span class="admin-att-status-badge ${checkinRate >= 80 ? 'good' : 'warn'}">${checkinRate >= 80 ? '🟢 Tốt' : '🟡 Cần lưu ý'}</span>
            </div>
          </div>

          <div class="admin-att-stats-col">
            <div class="admin-att-stats-grid">
              <div class="admin-att-stat-item is-checkin">
                <span class="admin-att-stat-icon">🏢</span>
                <div class="admin-att-stat-body">
                  <strong class="admin-att-stat-val">${number(checkedIn)}</strong>
                  <span class="admin-att-stat-lbl">Đã check-in (${percent(checkinRate)})</span>
                </div>
              </div>

              <div class="admin-att-stat-item ${a.late > 0 ? 'is-late' : ''}">
                <span class="admin-att-stat-icon">⏰</span>
                <div class="admin-att-stat-body">
                  <strong class="admin-att-stat-val">${number(a.late)}</strong>
                  <span class="admin-att-stat-lbl">Đi muộn</span>
                </div>
              </div>

              <div class="admin-att-stat-item is-leave">
                <span class="admin-att-stat-icon">🏖️</span>
                <div class="admin-att-stat-body">
                  <strong class="admin-att-stat-val">${number(a.approved_leave)}</strong>
                  <span class="admin-att-stat-lbl">Nghỉ phép</span>
                </div>
              </div>

              <div class="admin-att-stat-item ${a.not_checked_in > 0 ? 'is-missing' : ''}">
                <span class="admin-att-stat-icon">❌</span>
                <div class="admin-att-stat-body">
                  <strong class="admin-att-stat-val">${number(a.not_checked_in)}</strong>
                  <span class="admin-att-stat-lbl">Chưa check-in</span>
                </div>
              </div>
            </div>

            <!-- Missing List -->
            <div class="admin-att-missing-section">
              <span class="admin-att-missing-title">Chưa check-in:</span>
              <div class="admin-att-missing-chips">
                ${missingChips ? missingChips : '<span class="admin-att-missing-empty">✅ Tất cả nhân sự đã check-in hoặc có đơn nghỉ phép</span>'}
                ${missingPeople.length > 6 ? `<span class="admin-att-missing-more">+${missingPeople.length - 6} người khác</span>` : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- 4 KPI Summary Cards (50% PHẢI) -->
        <div class="admin-dash-stat-grid admin-dash-stat-grid--split">
          ${dashLink('#/users','users',number(p.active),'Nhân sự hoạt động',`${number(p.new_hires_month)} mới · ${number(p.probation)} thử việc · ${number(p.interns)} TTS`)}
          ${dashLink('#/attendance','clock3',`${number(checkedIn)} / ${number(eligible)}`,'Đã check-in',`${percent(checkinRate)} · ${number(a.late)} đi muộn · ${number(a.approved_leave)} nghỉ phép`,checkinRate>=80?'success':'warning')}
          ${dashLink(ap.leave>=ap.kpi?'#/leave':'#/kpis','circleAlert',number(ap.total),'Chờ xử lý',`${number(ap.leave)} nghỉ phép · ${number(ap.kpi)} KPI · ${number(ap.overtime)} tăng ca`,ap.total?'warning':'success')}
          ${dashLink('#/notifications','bell',number(al.total),'Cảnh báo nhân sự',`${number(al.critical)} khẩn · ${number(al.warning)} cần chú ý`,al.critical?'danger':al.total?'warning':'success')}
        </div>
      </div>

      <!-- ── GEOFENCE RADAR PANEL (BẢN ĐỒ GPS) ── -->
      <article class="admin-dash-panel admin-att-unified-panel">
        <header class="admin-att-unified-head">
          <div class="admin-att-unified-title">
            <h2>📍 Vị trí & Bản đồ radar check-in GPS hôm nay</h2>
            <p>Bản đồ check-in GPS đa địa điểm (TP.HCM, Hà Nội, Phim trường Q9...)</p>
          </div>
          <div class="admin-att-unified-controls">
            <button type="button" id="dash-geo-refresh" class="admin-geo-btn-refresh">🔄 Làm mới</button>
            <select id="dash-geo-office" class="admin-geo-select-office"><option value="all">Tất cả địa điểm</option></select>
            <a href="#/attendance" class="admin-att-link">Xem bảng công →</a>
          </div>
        </header>

        <!-- Geo Maps Section -->
        <div class="admin-att-geo-section">
          <div class="admin-att-geo-subhead">
            <div id="dash-geo-meta" class="admin-att-geo-meta">Đang tải danh sách địa điểm...</div>
            <div class="att-clock-geo-legend">
              <span class="att-geo-legend-item"><i class="att-geo-dot" style="background:#3B82F6"></i>Trong phạm vi</span>
              <span class="att-geo-legend-item"><i class="att-geo-dot" style="background:#EF4444"></i>Ngoài phạm vi</span>
              <span class="att-geo-legend-item"><i class="att-geo-dot geo-dot-current"></i>Tôi</span>
            </div>
          </div>
          <div id="dash-geo-container" class="admin-dash-geo-grid"></div>
          <div class="admin-att-geo-footer">
            <span>Điểm đánh dấu là vị trí check-in gần nhất của ngày hôm nay — không phải theo dõi liên tục.</span>
          </div>
        </div>
      </article>

      <!-- ── PRIMARY ACTION & INSIGHTS ── -->
      <div class="admin-dash-primary">
        <article class="admin-dash-panel">
          <header>
            <h2>Cần xử lý ngay</h2>
            <a href="#/notifications">Xem tất cả</a>
          </header>
          ${actions}
        </article>
        <article class="admin-dash-panel">
          <header>
            <h2>Insight hôm nay</h2>
          </header>
          <ul class="admin-insights">${insights}</ul>
        </article>
      </div>

      <!-- ── MARKETING CAMPAIGNS ── -->
      <article class="admin-dash-panel admin-campaign-panel">
        <header>
          <h2>Chiến dịch Marketing</h2>
          <a href="#/campaigns">Xem chiến dịch →</a>
        </header>
        <div class="admin-campaign-summary">
          <b>${number(data.campaigns?.active || 0)} đang chạy</b>
          <span>${number(data.campaigns?.spent || 0)} / ${number(data.campaigns?.budget || 0)} đ${data.campaigns?.spent_percent===null?'':' · '+percent(data.campaigns?.spent_percent)}</span>
        </div>
        <div class="admin-campaigns">${campaigns}</div>
      </article>
    </section>
  `;
}

// ── 2. HR MANAGEMENT DASHBOARD (DÀNH RIÊNG CHO PHÒNG HCNS / NHÂN SỰ) ──
function renderMonthlyAttendanceLineChart(monthlyData = []) {
  if (!monthlyData.length) {
    return `<div style="text-align:center;padding:24px;color:var(--text-3);">Chưa có dữ liệu chuyên cần theo tháng</div>`;
  }
  const W = 600;
  const H = 175;
  const padL = 42;
  const padR = 30;
  const padT = 22;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const N = monthlyData.length;

  const points = monthlyData.map((m, i) => {
    const x = N > 1 ? padL + (i * innerW) / (N - 1) : padL + innerW / 2;
    const clampedRate = Math.max(0, Math.min(100, Number(m.rate || 0)));
    const y = padT + (1 - clampedRate / 100) * innerH;
    return { 
      x: Math.round(x * 10) / 10, 
      y: Math.round(y * 10) / 10, 
      rate: clampedRate, 
      label: m.label, 
      month: m.month, 
      days: m.working_days || 0,
      checkins: m.checkins || 0
    };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`;

  // Grid levels: 100, 75, 50, 25, 0
  const gridLevels = [100, 75, 50, 25, 0];
  const gridSvg = gridLevels.map(lvl => {
    const y = padT + (1 - lvl / 100) * innerH;
    return `
      <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="${lvl === 0 || lvl === 100 ? '0' : '4,4'}" opacity="0.6" />
      <text x="${padL - 8}" y="${y + 3.5}" text-anchor="end" font-size="10" font-weight="600" fill="var(--text-3)">${lvl}%</text>
    `;
  }).join('');

  const dotsSvg = points.map(p => `
    <g class="hr-line-point" title="${esc(p.month)}: ${p.rate}% (${number(p.checkins)} lượt / ${p.days} ngày làm việc)">
      <circle cx="${p.x}" cy="${p.y}" r="5" fill="#10B981" stroke="#ffffff" stroke-width="2" />
      <text x="${p.x}" y="${Math.max(14, p.y - 8)}" text-anchor="middle" font-size="11" font-weight="800" fill="#10B981">${p.rate}%</text>
      <text x="${p.x}" y="${H - 12}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text-2)">${esc(p.label)}</text>
    </g>
  `).join('');

  return `
    <div class="hr-att-linechart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="hr-att-linechart-svg">
        <defs>
          <linearGradient id="attLineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10B981" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#10B981" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        ${gridSvg}
        <path d="${areaPath}" fill="url(#attLineGrad)" />
        <path d="${linePath}" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        ${dotsSvg}
      </svg>
    </div>
  `;
}

// ── 2. HR MANAGEMENT DASHBOARD (DÀNH RIÊNG CHO PHÒNG HCNS / NHÂN SỰ) ──
async function renderHrDashboard(el, me, activeTab = 'org') {
  el.innerHTML = `
    <section class="admin-dashboard admin-dashboard-loading">
      <div class="hr-dash-header">
        <div class="hr-dash-title-box">
          <h1>${icon('layoutDashboard', 'md')} Bảng Điều Hành Nhân Sự & Quản Trị</h1>
          <p>Đang tải dữ liệu tổng quan toàn công ty…</p>
        </div>
      </div>
      <div class="hr-dash-grid-2">
        <div class="admin-dash-skeleton" style="height:280px;border-radius:14px;"></div>
        <div class="admin-dash-skeleton" style="height:280px;border-radius:14px;"></div>
      </div>
    </section>
  `;

  let data;
  try {
    data = await api.getAdminDashboard();
  } catch (error) {
    el.innerHTML = `<div class="reference-empty">Không thể tải Dashboard nhân sự. ${esc(error.message || 'Vui lòng thử lại.')}</div>`;
    return;
  }

  const p = data.people || {};
  const a = data.attendance || {};
  const ot = data.ot_stats || {};
  const lv = data.leave_stats || {};
  const rec = data.recruitment || {};
  const depts = data.departments || [];
  const totalPayroll = data.total_payroll || 0;
  const actions = data.action_items || [];
  const monthlyAtt = a.monthly_trend || [];
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  // Compute max for recruitment funnel
  const maxRec = Math.max(1, rec.active || 0, rec.received || 0);

  const getActionIcon = (act) => {
    if (act.action_url?.includes('leave')) return 'plane';
    if (act.action_url?.includes('attendance') && act.title?.toLowerCase().includes('ot')) return 'timer';
    if (act.action_url?.includes('attendance') && act.title?.toLowerCase().includes('vị trí')) return 'mapPin';
    if (act.action_url?.includes('users') || act.title?.toLowerCase().includes('hợp đồng')) return 'fileText';
    if (act.action_url?.includes('kpis') || act.title?.toLowerCase().includes('kpi')) return 'target';
    return 'circleHelp';
  };

  const getActionSeverityTag = (sev) => {
    if (sev === 'danger') return '<span class="hr-action-tag" style="background:#FEE2E2;color:#DC2626;border-color:#FCA5A5;">🔴 Khẩn cấp</span>';
    if (sev === 'warning') return '<span class="hr-action-tag" style="background:#FEF3C7;color:#D97706;border-color:#FCD34D;">🟡 Cần phê duyệt</span>';
    return '<span class="hr-action-tag" style="background:#E0E7FF;color:#4F46E5;border-color:#C7D2FE;">🔵 Cần xử lý</span>';
  };

  el.innerHTML = `
    <section class="admin-dashboard">
      <!-- ── DASHBOARD HEADER & TAB SWITCHER ── -->
      <header class="hr-dash-header">
        <div class="hr-dash-title-box">
          <h1>${icon('layoutDashboard', 'md')} Bảng Điều Hành Nhân Sự & Quản Trị</h1>
          <p>Toàn công ty · ${esc(dateFormatted)} · Cập nhật ${esc(data.generated_at ? data.generated_at.slice(11, 19) : '')}</p>
        </div>
        <div class="hr-tab-switcher">
          <button type="button" class="hr-tab-btn ${activeTab === 'org' ? 'active' : ''}" id="tab-btn-org">
            ${icon('barChart3', 'xs')} Bảng Điều Hành Nhân Sự & Quản Trị
          </button>
          <button type="button" class="hr-tab-btn ${activeTab === 'me' ? 'active' : ''}" id="tab-btn-me">
            ${icon('user', 'xs')} Không gian cá nhân
          </button>
        </div>
      </header>

      <!-- ── 1. HÀNG 1: VIỆC CẦN XỬ LÝ NGAY (ACTION CENTER LÊN ĐẦU TIÊN VỚI ĐẦY ĐỦ THÔNG TIN) ── -->
      <div style="margin-bottom:20px;">
        <article class="hr-panel">
          <div class="hr-panel-head">
            <div class="hr-panel-title">
              ${icon('shieldAlert', 'sm')} Việc cần xử lý ngay
              <span class="badge badge-danger" style="margin-left:6px;font-size:12px;padding:2px 8px;">${actions.length} việc cần xử lý</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:12px;color:var(--text-2);">Tập trung giải quyết các tác vụ tồn đọng để hệ thống vận hành thông suốt</span>
              <a href="#/notifications" class="hr-panel-link">Xem tất cả thông báo ${icon('arrowRight', 'xs')}</a>
            </div>
          </div>

          <div class="hr-action-list">
            ${actions.length ? actions.map(act => `
              <div class="hr-action-item ${esc(act.severity || 'warning')}">
                <div class="hr-action-icon-wrap">${icon(getActionIcon(act), 'md')}</div>
                <div class="hr-action-body">
                  <div class="hr-action-title">
                    <span>${esc(act.title)}</span>
                    ${getActionSeverityTag(act.severity)}
                  </div>
                  <div class="hr-action-detail">${esc(act.detail)}</div>
                  <div class="hr-action-tags">
                    <span class="hr-action-tag">${icon('clock3', 'xs')} Hôm nay</span>
                    <span class="hr-action-tag">Toàn công ty</span>
                  </div>
                </div>
                <a href="${esc(act.action_url || '#')}" class="btn-primary hr-action-btn">
                  ${esc(act.action_label || 'Xử lý ngay')} ${icon('arrowRight', 'xs')}
                </a>
              </div>
            `).join('') : `
              <div class="empty-state" style="padding:32px 16px;grid-column:1/-1;">
                <div class="empty-icon">${icon('checkCheck', 'lg')}</div>
                <div class="empty-text" style="font-size:14px;font-weight:600;color:var(--text);">Tuyệt vời! Không có hạng mục nào cần xử lý khẩn cấp hôm nay.</div>
                <p style="font-size:12px;color:var(--text-3);margin-top:4px;">Tất cả đơn nghỉ phép, làm thêm giờ, đánh giá KPI và chấm công đều đã được duyệt hoàn tất.</p>
              </div>
            `}
          </div>
        </article>
      </div>

      <!-- ── 2. HÀNG 2: TỶ LỆ CHẤM CÔNG PHÒNG BAN + XU HƯỚNG CHUYÊN CẦN THEO THÁNG ── -->
      <div class="hr-dash-grid-2">
        <!-- Cột 1: Tỷ lệ chấm công theo phòng ban hôm nay -->
        <article class="hr-panel">
          <div class="hr-panel-head">
            <div class="hr-panel-title">
              ${icon('building2', 'sm')} Tỷ lệ chấm công theo phòng ban hôm nay
            </div>
            <a href="#/attendance" class="hr-panel-link">Xem bảng công ${icon('arrowRight', 'xs')}</a>
          </div>
          <div class="hr-dept-rings-grid">
            ${depts.map(d => {
              const rate = d.checkin_rate != null ? Number(d.checkin_rate) : 0;
              const circumference = 251.33;
              const offset = (circumference * (1 - Math.min(100, Math.max(0, rate)) / 100)).toFixed(1);
              const color = rate >= 80 ? '#10B981' : rate >= 50 ? '#F59E0B' : rate > 0 ? '#EF4444' : '#94A3B8';
              return `
                <div class="hr-dept-ring-card">
                  <div class="hr-dept-ring-name" title="${esc(d.department)}">${esc(d.department)}</div>
                  <div class="hr-dept-donut-box">
                    <svg viewBox="0 0 100 100" class="hr-dept-donut-svg">
                      <circle cx="50" cy="50" r="40" class="hr-donut-bg" />
                      <circle cx="50" cy="50" r="40" class="hr-donut-fill" style="stroke:${color}; stroke-dasharray: 251.33; stroke-dashoffset: ${offset};" />
                    </svg>
                    <div class="hr-dept-donut-inner">
                      <strong style="color:${color};">${rate}%</strong>
                      <small>${number(d.checked_in)}/${number(d.headcount)}</small>
                    </div>
                  </div>
                  <div class="hr-dept-ring-meta">
                    <span class="badge ${rate >= 80 ? 'badge-success' : rate >= 50 ? 'badge-warning' : rate > 0 ? 'badge-danger' : 'badge-gray'}">
                      ${rate === 100 ? '🟢 Đủ 100%' : rate >= 80 ? '🟢 Tốt' : rate > 0 ? `🟡 Vắng ${d.not_checked_in}` : '⚪ Chưa chấm'}
                    </span>
                  </div>
                </div>
              `;
            }).join('') || '<div style="text-align:center;padding:24px;color:var(--text-3);width:100%;">Chưa có dữ liệu phòng ban</div>'}
          </div>
        </article>

        <!-- Cột 2: Tình hình chấm công & Xu hướng chuyên cần theo từng tháng (Thu nhỏ) -->
        <article class="hr-panel">
          <div class="hr-panel-head">
            <div class="hr-panel-title">
              ${icon('calendarDays', 'sm')} Xu hướng chuyên cần theo tháng
            </div>
            <span style="font-size:11.5px;color:var(--text-3);font-style:italic;">* Loại trừ ngày nghỉ</span>
          </div>
          
          <!-- Hôm nay quick summary -->
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--surface-2);border-radius:10px;margin-bottom:12px;flex-wrap:wrap;gap:6px;">
            <div>
              <strong style="font-size:15px;color:#10B981;">${number(a.checked_in)}/${number(a.eligible)}</strong>
              <span style="font-size:12px;color:var(--text-2);margin-left:4px;">(${percent(a.checkin_rate)})</span>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              <span class="badge badge-info" style="font-size:11px;padding:2px 6px;">VP: ${number(a.office)}</span>
              ${a.wfh > 0 ? `<span class="badge badge-primary" style="font-size:11px;padding:2px 6px;">WFH: ${number(a.wfh)}</span>` : ''}
              ${a.late > 0 ? `<span class="badge badge-warning" style="font-size:11px;padding:2px 6px;">Muộn: ${number(a.late)}</span>` : ''}
              ${a.not_checked_in > 0 ? `<span class="badge badge-danger" style="font-size:11px;padding:2px 6px;">Vắng: ${number(a.not_checked_in)}</span>` : ''}
            </div>
          </div>

          <!-- Monthly Line Chart -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-2);">Tỷ lệ có mặt / ngày làm việc</span>
            <span style="font-size:11px;color:#10B981;font-weight:700;">● Chuyên cần (%)</span>
          </div>
          ${renderMonthlyAttendanceLineChart(monthlyAtt)}
        </article>
      </div>

      <!-- ── 3. HÀNG 3: NGHỈ PHÉP & TĂNG CA + TUYỂN DỤNG ── -->
      <div class="hr-dash-grid-2 equal">
        <!-- Nghỉ phép & Tăng ca toàn công ty -->
        <article class="hr-panel">
          <div class="hr-panel-head">
            <div class="hr-panel-title">
              ${icon('clipboardCheck', 'sm')} Nghỉ phép & Tăng ca (OT) toàn công ty
            </div>
            <div style="display:flex;gap:8px;">
              <a href="#/leave" class="hr-panel-link">Nghỉ phép ${icon('arrowRight', 'xs')}</a>
              <a href="#/attendance" class="hr-panel-link">Tăng ca ${icon('arrowRight', 'xs')}</a>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <!-- Cột Nghỉ phép -->
            <div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;">
              <div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                ${icon('plane', 'xs')} Nghỉ phép
              </div>
              <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:4px;">
                ${number(lv.today_leave_count)} <small style="font-size:12px;font-weight:550;color:var(--text-2);">hôm nay</small>
              </div>
              <div style="font-size:11.5px;color:var(--text-2);display:flex;flex-direction:column;gap:3px;">
                <span>⏳ <strong>${number(lv.pending_count)}</strong> đơn chờ duyệt</span>
                <span>📅 <strong>${number(lv.month_total_approved)}</strong> lượt nghỉ tháng này</span>
              </div>
            </div>

            <!-- Cột Tăng ca -->
            <div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;">
              <div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                ${icon('timer', 'xs')} Tăng ca (OT)
              </div>
              <div style="font-size:18px;font-weight:800;color:#6366F1;margin-bottom:4px;">
                ${number(ot.ot_month_hours)}h <small style="font-size:12px;font-weight:550;color:var(--text-2);">tháng này</small>
              </div>
              <div style="font-size:11.5px;color:var(--text-2);display:flex;flex-direction:column;gap:3px;">
                <span>⏳ <strong>${number(ot.pending_count)}</strong> phiếu chờ duyệt</span>
                <span>👥 <strong>${number(ot.ot_employee_count)}</strong> nhân sự làm OT (${ot.ot_form_count} form)</span>
              </div>
            </div>
          </div>
        </article>

        <!-- Tuyển dụng & Phễu ứng viên -->
        <article class="hr-panel">
          <div class="hr-panel-head">
            <div class="hr-panel-title">
              ${icon('funnel', 'sm')} Tuyển dụng & Phễu ứng viên
            </div>
            <a href="#/recruitment" class="hr-panel-link">Xem tuyển dụng ${icon('arrowRight', 'xs')}</a>
          </div>

          <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong style="font-size:15px;color:var(--text);">${number(rec.open_positions)} vị trí đang tuyển</strong>
              <span style="font-size:12px;color:var(--text-2);margin-left:6px;">(${number(rec.active)} ứng viên)</span>
            </div>
            <span class="badge badge-success">+${number(rec.hired_this_month)} đã nhận việc</span>
          </div>

          <div class="hr-funnel-container">
            <div class="hr-funnel-step">
              <span class="hr-funnel-label">1. Ứng tuyển (${number(rec.received)})</span>
              <div class="hr-funnel-bar-wrap">
                <div class="hr-funnel-bar-fill" style="width:${Math.max(12, Math.min(100, Math.round((rec.received / maxRec) * 100)))}%;">
                  ${number(rec.received)}
                </div>
              </div>
            </div>

            <div class="hr-funnel-step">
              <span class="hr-funnel-label">2. Sàng lọc (${number(rec.screening)})</span>
              <div class="hr-funnel-bar-wrap">
                <div class="hr-funnel-bar-fill" style="width:${Math.max(12, Math.min(100, Math.round((rec.screening / maxRec) * 100)))}%;background:linear-gradient(90deg, #3B82F6 0%, #2563EB 100%);">
                  ${number(rec.screening)}
                </div>
              </div>
            </div>

            <div class="hr-funnel-step">
              <span class="hr-funnel-label">3. Phỏng vấn (${number(rec.interview)})</span>
              <div class="hr-funnel-bar-wrap">
                <div class="hr-funnel-bar-fill" style="width:${Math.max(12, Math.min(100, Math.round((rec.interview / maxRec) * 100)))}%;background:linear-gradient(90deg, #F59E0B 0%, #D97706 100%);">
                  ${number(rec.interview)}
                </div>
              </div>
            </div>

            <div class="hr-funnel-step">
              <span class="hr-funnel-label">4. Offer (${number(rec.offer)})</span>
              <div class="hr-funnel-bar-wrap">
                <div class="hr-funnel-bar-fill" style="width:${Math.max(12, Math.min(100, Math.round((rec.offer / maxRec) * 100)))}%;background:linear-gradient(90deg, #10B981 0%, #059669 100%);">
                  ${number(rec.offer)}
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  `;

  // Bind tab switching events
  document.getElementById('tab-btn-me')?.addEventListener('click', async () => {
    document.querySelectorAll('.hr-tab-btn').forEach(btn => btn.classList.toggle('active', btn.id === 'tab-btn-me'));
    localStorage.setItem('hr_dashboard_tab', 'me');
    await yieldToMain();
    await renderEmployeeDashboard(el, me, true);
  });
  document.getElementById('tab-btn-org')?.addEventListener('click', async () => {
    document.querySelectorAll('.hr-tab-btn').forEach(btn => btn.classList.toggle('active', btn.id === 'tab-btn-org'));
    localStorage.setItem('hr_dashboard_tab', 'org');
    await yieldToMain();
    await renderHrDashboard(el, me, 'org');
  });
}

// ── Admin dashboard: today's attendance location map (geofence viz) ──
// Renders responsive multi-office grid (HCM, HN, Phim trường Q9, etc.)
// directly inside the unified attendance & geo panel.
async function renderAdminGeoPanel(el, me) {
  const container = document.getElementById('dash-geo-container');
  const metaEl = document.getElementById('dash-geo-meta');
  const officeSelect = document.getElementById('dash-geo-office');
  const refreshBtn = document.getElementById('dash-geo-refresh');
  const todayStr = today();
  let allLocations = [];

  if (refreshBtn) {
    refreshBtn.onclick = () => loadPanel();
  }
  if (officeSelect) {
    officeSelect.onchange = () => loadPanel();
  }

  async function loadOffices() {
    try {
      const { locations = [] } = await api.getAttendanceLocations();
      allLocations = locations.filter(l => l.is_active !== false && l.is_active !== 0);
      if (officeSelect) {
        officeSelect.innerHTML = `<option value="all">Tất cả địa điểm (${allLocations.length})</option>` +
          allLocations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
      }
    } catch (_) { /* optional */ }
  }
  await loadOffices();

  async function loadPanel() {
    if (!container) return;
    const selectedOfficeId = officeSelect?.value || 'all';
    const targetLocations = selectedOfficeId === 'all'
      ? allLocations
      : allLocations.filter(l => String(l.id) === String(selectedOfficeId));

    if (!targetLocations.length) {
      container.innerHTML = `<div class="task-group-empty" style="padding:24px;text-align:center;color:var(--text-3);">Chưa có cấu hình địa điểm chấm công.</div>`;
      if (metaEl) metaEl.textContent = 'Chưa có địa điểm';
      return;
    }

    if (metaEl) {
      metaEl.textContent = `Đang theo dõi ${targetLocations.length} địa điểm chấm công (TP.HCM, Hà Nội, Phim trường Q9...)`;
    }

    // Render cards scaffolding
    container.innerHTML = targetLocations.map(loc => {
      const isStudio = String(loc.name || '').toLowerCase().includes('phim trường') || String(loc.name || '').toLowerCase().includes('studio');
      const icon = isStudio ? '🎬' : '🏢';
      return `
        <div class="admin-dash-geo-card" data-office-id="${loc.id}">
          <div class="admin-dash-geo-card-head">
            <div class="admin-dash-geo-card-title">
              <span style="font-size:18px;">${icon}</span>
              <div>
                <strong>${esc(loc.name)}</strong>
                ${loc.address ? `<div style="font-size:11px;color:var(--text-3);font-weight:normal;margin-top:1px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(loc.address)}">${esc(loc.address)}</div>` : ''}
              </div>
            </div>
            <div class="admin-dash-geo-card-badges">
              <span class="admin-dash-geo-badge" id="dash-geo-badge-${loc.id}">0 điểm check-in</span>
              <span class="admin-dash-geo-badge admin-dash-geo-badge--muted">Bán kính: ${Number(loc.radius_meters || 100)} m</span>
            </div>
          </div>
          <div id="dash-geo-map-${loc.id}" class="dash-geo-office-map" style="height:270px;"></div>
          <div class="admin-dash-geo-card-foot" id="dash-geo-status-${loc.id}">Đang kết nối dữ liệu GPS...</div>
        </div>
      `;
    }).join('');

    // Fetch and render radar map for each office
    await Promise.all(targetLocations.map(async loc => {
      const mapEl = document.getElementById(`dash-geo-map-${loc.id}`);
      const badgeEl = document.getElementById(`dash-geo-badge-${loc.id}`);
      const statusEl = document.getElementById(`dash-geo-status-${loc.id}`);
      if (!mapEl) return;

      try {
        const data = await api.getAttendanceCheckinPoints({ date: todayStr, office_id: loc.id });
        const office = data.office || loc;
        const markers = (data.markers || []).map(m => ({
          latitude: m.latitude, longitude: m.longitude,
          label: m.employee_name, employee_id: m.employee_id,
          is_current_user: m.is_current_user, inside_geofence: m.inside_geofence,
          requires_location_review: m.requires_location_review,
          checkin_time: m.checkin_time, checkin_accuracy_meters: m.checkin_accuracy_meters,
          distance_m: m.distance_m, kind: classifyMarker(m, me.id),
          tooltipHTML: `<div class="geo-tooltip-name">${esc(m.employee_name || `NV ${m.employee_id}`)}</div>${m.checkin_time ? `<div>Check-in: ${esc(m.checkin_time)}</div>` : ''}${m.distance_m != null ? `<div>Khoảng cách: ${Math.round(Number(m.distance_m))} m</div>` : ''}${m.inside_geofence !== false ? '<div class="geo-tooltip-status geo-tooltip-inside">Trong phạm vi</div>' : '<div class="geo-tooltip-status geo-tooltip-outside">Ngoài phạm vi · Cần xem xét</div>'}`,
        }));

        if (badgeEl) {
          badgeEl.textContent = `${markers.length} điểm check-in`;
        }

        renderGeoMap(mapEl, {
          center: { latitude: Number(office.latitude), longitude: Number(office.longitude) },
          radiusMeters: Number(office.radius_meters || 100),
          officeName: office.name,
          markers,
          theme: 'light',
          height: 270,
        });

        if (statusEl) {
          const mine = markers.find(m => m.is_current_user);
          statusEl.textContent = mine
            ? `Bạn: check-in lúc ${mine.checkin_time || '—'} · cách ${Math.round(Number(mine.distance_m))} m · ${mine.inside_geofence !== false ? 'Trong phạm vi' : 'Ngoài phạm vi'}${mine.requires_location_review ? ' · cần xem xét' : ''}`
            : `Chưa có lượt check-in của bạn tại ${office.name} hôm nay.`;
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Không tải được dữ liệu điểm chấm công.';
      }
    }));
  }

  await loadPanel();
}

export async function renderDashboard(el, me) {
  const isHrUser = isHcnsDepartment(me.department);
  const isAdmin = me.role === 'admin';

  let refreshTimer = null;
  const handleDashboardEvent = (data, topic = '') => {
    if (!el.isConnected) return;
    const updaters = el._dashUpdaters;

    // Granular in-place updates for Employee Dashboard without wiping DOM or causing layout shift
    if (updaters && updaters.type === 'employee') {
      const top = String(topic || '').toLowerCase();
      if (top.startsWith('task') || top.startsWith('subtask') || top.startsWith('comment')) {
        updaters.loadTasks?.();
        return;
      }
      if (top.startsWith('attendance')) {
        updaters.loadTodayAttendance?.();
        updaters.loadAttendanceDetails?.();
        return;
      }
      if (top.startsWith('leave') || top.startsWith('ot')) {
        updaters.loadRequestsAndOT?.();
        return;
      }
      if (top.startsWith('notification') || top.startsWith('user') || top.startsWith('payroll')) {
        updaters.refreshAll?.();
        return;
      }
      return;
    }

    // Debounced refresh for HR / Admin dashboards
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      if (!el.isConnected) return;
      if (isHrUser) {
        const currentTab = localStorage.getItem('hr_dashboard_tab') || 'org';
        if (currentTab === 'org') {
          await renderHrDashboard(el, me, 'org');
        } else {
          await renderEmployeeDashboard(el, me, true);
        }
      } else if (isAdmin) {
        await renderAdminDashboard(el, me);
        void renderAdminGeoPanel(el, me);
      } else {
        await renderEmployeeDashboard(el, me, false);
      }
    }, 250);
  };

  el._cleanup = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    el._dashUpdaters = null;
  };

  EventBus.bindView(el, 'tasks', (data) => handleDashboardEvent(data, 'tasks'));
  EventBus.bindView(el, 'task:*', (data, topic) => handleDashboardEvent(data, topic));
  EventBus.bindView(el, 'subtask:*', (data, topic) => handleDashboardEvent(data, topic));
  EventBus.bindView(el, 'attendance', (data) => handleDashboardEvent(data, 'attendance'));
  EventBus.bindView(el, 'attendance:*', (data, topic) => handleDashboardEvent(data, topic));
  EventBus.bindView(el, 'leave', (data) => handleDashboardEvent(data, 'leave'));
  EventBus.bindView(el, 'leave:*', (data, topic) => handleDashboardEvent(data, topic));
  EventBus.bindView(el, 'users', (data) => handleDashboardEvent(data, 'users'));
  EventBus.bindView(el, 'user:*', (data, topic) => handleDashboardEvent(data, topic));
  EventBus.bindView(el, 'payroll', (data) => handleDashboardEvent(data, 'payroll'));
  EventBus.bindView(el, 'payroll:*', (data, topic) => handleDashboardEvent(data, topic));
  EventBus.bindView(el, 'notifications', (data) => handleDashboardEvent(data, 'notifications'));
  EventBus.bindView(el, 'notification:*', (data, topic) => handleDashboardEvent(data, topic));

  if (isHrUser) {
    const currentTab = localStorage.getItem('hr_dashboard_tab') || 'org';
    if (currentTab === 'org') {
      await renderHrDashboard(el, me, 'org');
    } else {
      await renderEmployeeDashboard(el, me, true);
    }
  } else if (isAdmin) {
    await renderAdminDashboard(el, me);
    void renderAdminGeoPanel(el, me);
  } else {
    await renderEmployeeDashboard(el, me, false);
  }
}
