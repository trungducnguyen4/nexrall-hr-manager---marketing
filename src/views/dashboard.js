import { esc, lifecycleBadge, today } from '../utils.js';
import { api } from '../api.js';
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

async function renderEmployeeDashboard(el, me) {
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
            <div style="text-align:center;padding:16px;color:var(--text-3);">Đang tải biểu đồ công việc...</div>
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
            <div style="text-align:center;padding:16px;color:var(--text-3);">Đang tải dữ liệu kỳ công...</div>
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
            <div style="text-align:center;padding:24px;color:var(--text-3);">Đang tải công việc...</div>
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
            <div style="text-align:center;padding:16px;color:var(--text-3);">Đang tải đơn từ & tăng ca...</div>
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

  await Promise.allSettled([
    loadTodayAttendance(),
    loadTasks(),
    loadRequestsAndOT(),
    loadAttendanceDetails(),
  ]);
}

const number = value => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const percent = value => `${Number(value || 0).toFixed(0)}%`;
const dashLink = (href, icon, value, title, detail, tone = 'neutral') => `<a class="admin-dash-stat ${tone}" href="${href}"><i data-icon="${icon}"></i><strong>${value}</strong><span>${esc(title)}</span><small>${esc(detail)}</small></a>`;
const progress = (value, tone = '') => `<div class="admin-dash-progress ${tone}" role="progressbar" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div>`;

async function renderAdminDashboard(el, me) {
  el.innerHTML = `<section class="admin-dashboard admin-dashboard-loading"><div class="admin-dash-hero"><div><p>TỔNG QUAN VẬN HÀNH</p><h1>Đang tải dữ liệu vận hành…</h1><small>Dashboard điều hành sử dụng dữ liệu trực tiếp từ hệ thống.</small></div></div><div class="admin-dash-stat-grid">${Array.from({length:4},()=>'<div class="admin-dash-skeleton"></div>').join('')}</div></section>`;
  let data;
  try { data = await api.getAdminDashboard(); } catch (error) { el.innerHTML = `<div class="reference-empty">Không thể tải Dashboard điều hành. ${esc(error.message || 'Vui lòng thử lại.')}</div>`; return; }
  const a=data.attendance || {}, p=data.people || {}, ap=data.approvals || {}, al=data.employee_alerts || {};
  const date = new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const actions = data.action_items.length ? data.action_items.map(item=>`<article class="admin-action ${esc(item.severity)}"><span aria-hidden="true"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div><a href="${esc(item.action_url)}" class="btn-secondary btn-sm">${esc(item.action_label || 'Xem')}</a></article>`).join('') : '<p class="reference-empty">Không có hạng mục cần xử lý ngay.</p>';
  const insights = data.insights.map(item=>`<li class="${esc(item.severity)}">${esc(item.text)}</li>`).join('');
  const campaigns=(data.campaigns.items||[]).map(c=>`<div class="admin-campaign"><strong>${esc(c.name)}</strong><span>${c.budget?percent(c.spent/c.budget*100):'Chưa có ngân sách'}</span>${progress(c.budget?c.spent/c.budget*100:0,c.spent>c.budget?'danger':'')}<small>${number(c.spent)} / ${number(c.budget)} đ</small></div>`).join('') || '<p class="reference-empty">Chưa có chiến dịch đang chạy.</p>';

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
          <span>${data.action_items.length ? `${data.action_items.length} vấn đề cần chú ý` : 'Không có vấn đề quan trọng cần xử lý'}</span>
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
          <b>${number(data.campaigns.active)} đang chạy</b>
          <span>${number(data.campaigns.spent)} / ${number(data.campaigns.budget)} đ${data.campaigns.spent_percent===null?'':' · '+percent(data.campaigns.spent_percent)}</span>
        </div>
        <div class="admin-campaigns">${campaigns}</div>
      </article>
    </section>
  `;
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
  if (me.role === 'admin') { await renderAdminDashboard(el, me); void renderAdminGeoPanel(el, me); }
  else await renderEmployeeDashboard(el, me);
}
