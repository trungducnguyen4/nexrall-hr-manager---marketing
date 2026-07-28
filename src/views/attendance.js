import { api } from '../api.js';
import { esc, fmtDate, statusBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, today, initials, avatarColor, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination } from '../utils.js';

const WORK_TYPE_LABEL = { office: '🏢 Văn phòng', wfh: '🏠 WFH', business: '✈️ Công tác' };
const SHIFT_LABEL = { morning: 'Ca sáng (08:30–12:00)', afternoon: 'Ca chiều (13:30–17:00)', full: 'Cả ngày' };
const SHIFT_LABEL_SHORT = { morning: 'Ca sáng', afternoon: 'Ca chiều', full: 'Cả ngày' };
const isHcnsDepartment = (department) => ['hcns', 'phong hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'].includes(String(department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

export async function renderAttendance(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';
  const canManageAttendance = isManager || isHcnsDepartment(me.department);

  el.innerHTML = `
    <div class="page-header">
      <div class="page-title">⏱️ Chấm công</div>
    </div>

    <!-- Clock-in card -->
    <div class="att-clock-card" id="att-clock-card">
      <div class="att-clock-time" id="att-live-time">--:--:--</div>
      <div class="att-clock-date" id="att-live-date"></div>
      <div class="att-clock-status" id="att-status-line">
        <span style="font-size:13px;opacity:.8">Đang tải...</span>
      </div>

      <!-- Registration form (shown when not yet registered today) -->
      <div id="att-register-wrap" style="display:none;margin-top:14px;">
        <div class="field" style="margin-bottom:10px;">
          <label style="color:rgba(255,255,255,.7)">Hình thức làm việc</label>
          <div class="att-chip-row" id="att-worktype-row">
            <button type="button" class="att-chip" data-worktype="office">🏢 Văn phòng</button>
            <button type="button" class="att-chip" data-worktype="wfh">🏠 WFH</button>
            <button type="button" class="att-chip" data-worktype="business">✈️ Công tác</button>
          </div>
        </div>
        <div class="field" id="att-shift-field" style="margin-bottom:10px;">
          <label style="color:rgba(255,255,255,.7)">Ca làm việc</label>
          <div class="att-chip-row" id="att-shift-row">
            <button type="button" class="att-chip" data-shift="morning">Sáng 08:30–12:00</button>
            <button type="button" class="att-chip" data-shift="afternoon">Chiều 13:30–17:00</button>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:6px;">Chọn cả hai ca = làm cả ngày. Chỉ check-in đầu ngày và check-out cuối ngày.</div>
        </div>
        <div id="att-business-time" style="display:none;gap:10px;" class="flex">
          <div class="field" style="flex:1;margin-bottom:10px;">
            <label style="color:rgba(255,255,255,.7)">Giờ bắt đầu dự kiến</label>
            <input type="time" id="att-exp-start" value="08:30"/>
          </div>
          <div class="field" style="flex:1;margin-bottom:10px;">
            <label style="color:rgba(255,255,255,.7)">Giờ kết thúc dự kiến</label>
            <input type="time" id="att-exp-end" value="17:00"/>
          </div>
        </div>
        <div class="field" style="margin-bottom:10px;">
          <label style="color:rgba(255,255,255,.7)">Ghi chú (tuỳ chọn)</label>
          <input id="att-reg-note" type="text" placeholder="Ghi chú..." style="background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.4);color:#fff;"/>
        </div>
        <button id="btn-register" class="att-btn-in" style="width:100%;">📝 Đăng ký chấm công hôm nay</button>
      </div>

      <div id="att-note-wrap" style="margin-top:10px;display:none;">
        <input id="att-note" type="text" placeholder="Ghi chú (tuỳ chọn)" style="background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.4);color:#fff;border-radius:8px;padding:8px 12px;width:100%;"/>
      </div>
      <div class="att-clock-btns">
        <button id="btn-checkin" class="att-btn-in" disabled>⏰ Check In</button>
        <button id="btn-checkout" class="att-btn-out" disabled>🏁 Check Out</button>
      </div>
    </div>

    ${canManageAttendance ? `<div class="card" style="margin:14px 0;">
      <div class="card-header"><div class="card-title">⏱️ Yêu cầu làm thêm giờ</div><select id="ot-status-filter" class="btn-secondary btn-sm"><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Đã từ chối</option><option value="">Tất cả</option></select></div>
      <div id="ot-request-list">${loadingHTML()}</div>
    </div>` : ''}

    <!-- Filter -->
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header" style="margin-bottom:10px;">
        <div class="card-title">📅 Lịch sử chấm công</div>
        <div style="display:flex;gap:8px;">
          ${!canManageAttendance ? `<button id="btn-my-att-summary" class="btn-secondary btn-sm">Tổng kết của tôi</button>` : ''}
          ${isManager ? `<button id="btn-add-att" class="btn-primary btn-sm">+ Thêm</button>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <input type="month" id="att-month-filter" class="w-full" style="max-width:180px;" value="${new Date().toISOString().slice(0,7)}"/>
        <input type="date" id="att-date-filter" class="w-full" style="max-width:170px;" title="Lọc theo ngày cụ thể"/>
          ${canManageAttendance ? `

          <input type="text" id="att-search" placeholder="Tìm theo tên, mã nhân viên..." style="min-width:220px;flex:1;"/>
          <select id="att-dept-filter" style="max-width:220px;">
            <option value="">Tất cả phòng ban</option>
            ${DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
          </select>` : ''}
      </div>
      <div id="att-list">${loadingHTML()}</div>
    </div>
  `;

  // Live clock
  const liveTime = document.getElementById('att-live-time');
  const liveDate = document.getElementById('att-live-date');
  function tickClock() {
    const now = new Date();
    liveTime.textContent = now.toLocaleTimeString('vi-VN');
    liveDate.textContent = now.toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }
  tickClock();
  const clockInterval = setInterval(tickClock, 1000);
  // Clean up on next navigation
  el._cleanup = () => clearInterval(clockInterval);

  // Load today's record
  let todayRecord = null;
  let regWorkType = 'office';
  let regShifts = new Set(); // subset of {morning, afternoon}
  let submitting = false; // guards against double-click across register/checkin/checkout

  // ── Registration form interactivity ──
  function updateWorktypeChips() {
    document.querySelectorAll('#att-worktype-row .att-chip').forEach(b => {
      b.classList.toggle('active', b.dataset.worktype === regWorkType);
    });
    document.getElementById('att-business-time').style.display = regWorkType === 'business' ? 'flex' : 'none';
  }
  function updateShiftChips() {
    document.querySelectorAll('#att-shift-row .att-chip').forEach(b => {
      b.classList.toggle('active', regShifts.has(b.dataset.shift));
    });
  }
  document.querySelectorAll('#att-worktype-row .att-chip').forEach(btn => {
    btn.addEventListener('click', () => { regWorkType = btn.dataset.worktype; updateWorktypeChips(); });
  });
  document.querySelectorAll('#att-shift-row .att-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.shift;
      if (regShifts.has(s)) regShifts.delete(s); else regShifts.add(s);
      if (regShifts.size === 0) regShifts.add('morning'); // always keep at least one selected
      updateShiftChips();
    });
  });
  regShifts.add('morning'); regShifts.add('afternoon'); // default: full day
  updateWorktypeChips(); updateShiftChips();

  function resolvedShift() {
    if (regShifts.has('morning') && regShifts.has('afternoon')) return 'full';
    if (regShifts.has('afternoon')) return 'afternoon';
    return 'morning';
  }

  async function loadTodayStatus() {
    try {
      const { attendance } = await api.getAttendanceToday();
      const mine = attendance.find(a => a.user_id === me.id) || (attendance.length === 1 ? attendance[0] : null);
      todayRecord = mine || null;
      renderClockState();
    } catch(e) {
      document.getElementById('att-status-line').innerHTML = `<span style="font-size:12px;opacity:.7">Lỗi tải trạng thái</span>`;
    }
  }

  function lateEarlyLine(rec) {
    const parts = [];
    if (rec.late_minutes > 0) parts.push(`<span style="color:#FFB88C">⏰ Trễ ${rec.late_minutes} phút</span>`);
    if (rec.early_minutes > 0) parts.push(`<span style="color:#FFD08A">🏃 Về sớm ${rec.early_minutes} phút</span>`);
    return parts.length ? `<div style="font-size:12px;margin-top:4px;">${parts.join(' · ')}</div>` : '';
  }

  function renderClockState() {
    const statusLine = document.getElementById('att-status-line');
    const btnIn = document.getElementById('btn-checkin');
    const btnOut = document.getElementById('btn-checkout');
    const noteWrap = document.getElementById('att-note-wrap');
    const regWrap = document.getElementById('att-register-wrap');

    const infoLine = todayRecord
      ? `<div style="font-size:12px;opacity:.8;margin-top:2px;">${WORK_TYPE_LABEL[todayRecord.work_type] || WORK_TYPE_LABEL.office} · ${SHIFT_LABEL_SHORT[todayRecord.shift] || SHIFT_LABEL_SHORT.full}${todayRecord.work_type === 'business' ? ` (${esc(todayRecord.expected_start||'—')}–${esc(todayRecord.expected_end||'—')})` : ''}</div>`
      : '';

    if (!todayRecord || !todayRecord.registered) {
      // Chưa đăng ký: khóa cả hai nút, hiện form đăng ký
      statusLine.innerHTML = `<span class="badge badge-gray" style="font-size:12px;">📝 Chưa đăng ký hôm nay</span>`;
      btnIn.disabled = true; btnOut.disabled = true; noteWrap.style.display = 'none';
      regWrap.style.display = 'block';
    } else if (todayRecord.checkin_time && todayRecord.checkout_time) {
      // Đã check-out: khóa cả hai
      statusLine.innerHTML = `
        <span class="badge badge-success" style="font-size:12px;">✅ Đã hoàn thành</span>
        <span style="font-size:12px;opacity:.8">${todayRecord.checkin_time} → ${todayRecord.checkout_time} (${(todayRecord.work_hours||0).toFixed(1)}h)</span>
        ${infoLine}${lateEarlyLine(todayRecord)}`;
      btnIn.disabled = true; btnOut.disabled = true; noteWrap.style.display = 'none';
      regWrap.style.display = 'none';
    } else if (todayRecord.checkin_time) {
      // Đã check-in: khóa check-in, mở check-out
      statusLine.innerHTML = `
        <span class="badge badge-warning" style="font-size:12px;">🔄 Đang làm</span>
        <span style="font-size:12px;opacity:.8">Vào lúc ${todayRecord.checkin_time}</span>
        ${infoLine}${lateEarlyLine(todayRecord)}`;
      btnIn.disabled = true; btnOut.disabled = false; noteWrap.style.display = 'none';
      regWrap.style.display = 'none';
    } else {
      // Đã đăng ký: mở check-in
      statusLine.innerHTML = `<span class="badge badge-info" style="font-size:12px;">📍 Đã đăng ký — sẵn sàng check in</span>${infoLine}`;
      btnIn.disabled = false; btnOut.disabled = true; noteWrap.style.display = 'block';
      regWrap.style.display = 'none';
    }
  }

  // Register
  document.getElementById('btn-register').addEventListener('click', async () => {
    if (submitting) return;
    const btn = document.getElementById('btn-register');
    if (regWorkType === 'business') {
      const s = document.getElementById('att-exp-start').value;
      const en = document.getElementById('att-exp-end').value;
      if (!s || !en) { toast('Vui lòng nhập giờ dự kiến', 'error'); return; }
    }
    submitting = true; btn.disabled = true; const oldText = btn.textContent; btn.textContent = 'Đang đăng ký...';
    try {
      await api.registerAttendance({
        work_type: regWorkType,
        shift: resolvedShift(),
        expected_start: regWorkType === 'business' ? document.getElementById('att-exp-start').value : undefined,
        expected_end: regWorkType === 'business' ? document.getElementById('att-exp-end').value : undefined,
        note: document.getElementById('att-reg-note')?.value || '',
      });
      toast('Đăng ký thành công!', 'success');
      await loadTodayStatus();
    } catch(e) {
      toast(e.message || 'Lỗi đăng ký', 'error');
    } finally {
      submitting = false; btn.disabled = false; btn.textContent = oldText;
    }
  });

  // Check-in
  document.getElementById('btn-checkin').addEventListener('click', async () => {
    if (submitting) return;
    const note = document.getElementById('att-note')?.value || '';
    const btnIn = document.getElementById('btn-checkin');
    submitting = true; btnIn.disabled = true; btnIn.textContent = '...';
    try {
      await api.checkin({ note });
      toast('Check in thành công!', 'success');
      await loadTodayStatus();
      loadHistory();
    } catch(e) {
      toast(e.message || 'Lỗi check in', 'error');
      btnIn.disabled = false; btnIn.textContent = '⏰ Check In';
    } finally {
      submitting = false;
    }
  });

  // Check-out
  document.getElementById('btn-checkout').addEventListener('click', async () => {
    if (submitting) return;
    const btnOut = document.getElementById('btn-checkout');
    submitting = true; btnOut.disabled = true; btnOut.textContent = '...';
    try {
      const result = await api.checkout({});
      if (result.requires_overtime_choice) {
        openModal('Checkout muộn', `<p>Bạn checkout lúc <b>${esc(result.time)}</b>, muộn hơn giờ kết thúc ca <b>${esc(result.shift_end_time)}</b> ${result.overtime_minutes} phút.</p><p>Chọn “Làm thêm giờ” nếu cần gửi HCNS/quản lý xác nhận. Chỉ thời gian được duyệt mới tính là OT.</p><div class="field"><label>Lý do làm thêm giờ</label><textarea id="ot-reason" rows="3" placeholder="Nhập lý do nếu gửi yêu cầu OT..."></textarea></div>`, `<button class="btn-secondary" id="ot-late-checkout">Checkout trễ</button><button class="btn-primary" id="ot-submit">Gửi yêu cầu làm thêm giờ</button>`);
        document.getElementById('ot-late-checkout')?.addEventListener('click', () => { closeModal(); toast('Đã ghi nhận checkout trễ, không tạo yêu cầu OT', 'success'); });
        document.getElementById('ot-submit')?.addEventListener('click', async () => {
          const reason = document.getElementById('ot-reason')?.value.trim();
          if (!reason) { toast('Vui lòng nhập lý do làm thêm giờ', 'error'); return; }
          try { await api.createOvertimeRequest({ attendance_id: result.attendance_id, reason }); closeModal(); toast('Đã gửi yêu cầu làm thêm giờ chờ duyệt', 'success'); loadOvertimeRequests(); }
          catch (e) { toast(e.message || 'Không thể gửi yêu cầu OT', 'error'); }
        });
      } else toast('Check out thành công!', 'success');
      await loadTodayStatus();
      loadHistory();
    } catch(e) {
      toast(e.message || 'Lỗi check out', 'error');
      btnOut.disabled = false; btnOut.textContent = '🏁 Check Out';
    } finally {
      submitting = false;
    }
  });

  let historyPage = 1;

  async function loadOvertimeRequests() {
    const list = document.getElementById('ot-request-list');
    if (!list) return;
    try {
      const month = document.getElementById('att-month-filter')?.value || new Date().toISOString().slice(0, 7);
      const status = document.getElementById('ot-status-filter')?.value || '';
      const { overtime_requests: rows = [] } = await api.getOvertimeRequests({ month, status });
      list.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Ngày</th><th>Checkout / hết ca</th><th>Đề nghị</th><th>Lý do</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.full_name)}</b><br><small>${esc(r.employee_code || '')}</small></td><td>${esc(r.work_date)}</td><td>${esc(r.checkout_time)} / ${esc(r.shift_end_time)}</td><td>${r.requested_minutes} phút${r.approved_minutes != null ? `<br><small>Duyệt: ${r.approved_minutes} phút</small>` : ''}</td><td style="max-width:220px;">${esc(r.reason)}</td><td>${r.status === 'pending' ? '<span class="badge badge-warning">Chờ duyệt</span>' : r.status === 'approved' ? '<span class="badge badge-success">Đã duyệt</span>' : '<span class="badge badge-danger">Từ chối</span>'}</td><td>${r.status === 'pending' ? `<button class="btn-secondary btn-sm ot-decide" data-id="${r.id}" data-minutes="${r.requested_minutes}" data-action="approve">Duyệt</button> <button class="btn-danger btn-sm ot-decide" data-id="${r.id}" data-action="reject">Từ chối</button>` : esc(r.reviewer_name || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyHTML('⏱️', 'Không có yêu cầu làm thêm giờ');
      list.querySelectorAll('.ot-decide').forEach(btn => btn.addEventListener('click', () => openOvertimeDecision(btn.dataset)));
    } catch (e) { list.innerHTML = emptyHTML('⚠️', e.message || 'Không thể tải yêu cầu OT'); }
  }

  function openOvertimeDecision(data) {
    const approving = data.action === 'approve';
    openModal(approving ? 'Duyệt làm thêm giờ' : 'Từ chối làm thêm giờ', `${approving ? `<div class="field"><label>Số phút được duyệt</label><input type="number" id="ot-approved-minutes" min="1" max="${data.minutes}" value="${data.minutes}"/></div>` : ''}<div class="field"><label>${approving ? 'Ghi chú (tuỳ chọn)' : 'Lý do từ chối'}</label><textarea id="ot-review-note" rows="3"></textarea></div>`, `<button class="btn-secondary" id="ot-cancel">Hủy</button><button class="btn-primary" id="ot-confirm">${approving ? 'Duyệt OT' : 'Từ chối'}</button>`);
    document.getElementById('ot-cancel')?.addEventListener('click', closeModal);
    document.getElementById('ot-confirm')?.addEventListener('click', async () => {
      const review_note = document.getElementById('ot-review-note')?.value.trim() || '';
      if (!approving && !review_note) { toast('Vui lòng nhập lý do từ chối', 'error'); return; }
      try { await api.decideOvertimeRequest(data.id, data.action, { approved_minutes: approving ? Number(document.getElementById('ot-approved-minutes').value) : 0, review_note }); closeModal(); toast(approving ? 'Đã duyệt làm thêm giờ' : 'Đã từ chối yêu cầu', 'success'); loadOvertimeRequests(); loadHistory(); }
      catch (e) { toast(e.message || 'Không thể xử lý yêu cầu OT', 'error'); }
    });
  }
  document.getElementById('ot-status-filter')?.addEventListener('change', loadOvertimeRequests);
  if (canManageAttendance) loadOvertimeRequests();



  // Month filter
  document.getElementById('att-month-filter').addEventListener('change', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-date-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-search')?.addEventListener('input', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-dept-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });

  function statusWithMinutes(a) {
    const badge = statusBadge(a.status);
    const bits = [];
    if (a.late_minutes > 0) bits.push(`Trễ ${a.late_minutes}p`);
    if (a.early_minutes > 0) bits.push(`Sớm ${a.early_minutes}p`);
    return bits.length ? `${badge}<div style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(bits.join(' · '))}</div>` : badge;
  }

  function employeePeriodStatus(employee) {
    if (employee.period_status === 'no_data') return '<span class="badge badge-gray">Chưa chấm công</span>';
    if (employee.period_status === 'incomplete') return '<span class="badge badge-warning">Thiếu check-in/out</span>';
    if (employee.period_status === 'late') return '<span class="badge badge-warning">Có đi muộn</span>';
    return '<span class="badge badge-success">Đủ dữ liệu</span>';
  }

  async function loadHistory() {
    const listEl = document.getElementById('att-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const monthVal = document.getElementById('att-month-filter')?.value || new Date().toISOString().slice(0,7);
    const [yr, mo] = monthVal.split('-');
    const params = { month: mo, year: yr };
    const dateVal = document.getElementById('att-date-filter')?.value || '';
    if (dateVal) {
      params.date = dateVal;
      delete params.month;
      delete params.year;
    }
    try {
      if (canManageAttendance) {
        const { employees = [] } = await api.getAttendanceEmployees(params);
        let filteredEmployees = filterBySearch(employees, document.getElementById('att-search')?.value || '', ['full_name', 'employee_code']);
        filteredEmployees = filterByDepartment(filteredEmployees, document.getElementById('att-dept-filter')?.value || '', ['department']);
        const pageData = paginateRows(filteredEmployees, historyPage);
        historyPage = pageData.page;
        if (!filteredEmployees.length) { listEl.innerHTML = emptyHTML('👥', 'Không có nhân viên phù hợp'); return; }
        listEl.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Chức danh</th><th>Ngày công</th><th>Tổng giờ</th><th>Đi muộn</th><th>Thiếu check-in/out</th><th>Trạng thái kỳ</th></tr></thead>
              <tbody>
                ${pageData.rows.map(employee => `<tr class="att-employee-row" data-user-id="${employee.user_id}" role="button" tabindex="0" title="Xem tổng kết chấm công">
                  <td><span style="font-weight:600">${esc(employee.full_name)}</span><br><span style="font-size:11px;color:var(--text-2)">${esc(employee.employee_code || '—')}</span></td>
                  <td>${esc(employee.department || '—')}</td><td>${esc(employee.position || '—')}</td>
                  <td>${Number(employee.actual_work_days || 0)}</td><td>${Number(employee.total_work_hours || 0).toFixed(1)}h</td>
                  <td>${employee.late_days ? `${employee.late_days} ngày · ${employee.late_minutes}p` : '—'}</td>
                  <td>${Number(employee.missing_checkin_days || 0)} / ${Number(employee.missing_checkout_days || 0)}</td><td>${employeePeriodStatus(employee)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${paginationHTML(pageData)}
        `;
        listEl.querySelectorAll('.att-employee-row').forEach(row => {
          const open = () => openAttendanceSummary(parseInt(row.dataset.userId));
          row.addEventListener('click', open);
          row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        });
        bindPagination(listEl, page => { historyPage = page; loadHistory(); });
        return;
      }
      const { attendance } = await api.getAttendance(params);
      let filteredAttendance = attendance || [];
      const pageData = paginateRows(filteredAttendance, historyPage);
      historyPage = pageData.page;
      if (!filteredAttendance.length) { listEl.innerHTML = emptyHTML('📅', 'Không có dữ liệu chấm công'); return; }
      listEl.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ngày</th><th>Hình thức</th><th>Ca đăng ký</th><th>Vào</th><th>Ra</th><th>Giờ làm</th><th>OT</th><th>Trạng thái</th><th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              ${pageData.rows.map(a => `
                <tr>
                  <td style="white-space:nowrap">${esc(a.date)}</td>
                  <td style="white-space:nowrap">${esc((WORK_TYPE_LABEL[a.work_type] || WORK_TYPE_LABEL.office))}</td>
                  <td style="white-space:nowrap">${esc(SHIFT_LABEL_SHORT[a.shift] || SHIFT_LABEL_SHORT.full)}${a.work_type === 'business' ? `<br><span style="font-size:11px;color:var(--text-2)">${esc(a.expected_start||'—')}–${esc(a.expected_end||'—')}</span>` : ''}</td>
                  <td>${esc(a.checkin_time||'—')}</td>
                  <td>${esc(a.checkout_time||'—')}</td>
                  <td>${a.work_hours ? Number(a.work_hours).toFixed(1)+'h' : '—'}</td>
                  <td>${a.overtime_status === 'approved' ? `<span class="badge badge-success">${Number(a.approved_overtime_minutes || 0) / 60}h duyệt</span>` : a.overtime_status === 'pending' ? '<span class="badge badge-warning">Chờ duyệt</span>' : a.overtime_status === 'rejected' ? '<span class="badge badge-danger">Từ chối</span>' : '—'}</td>
                  <td>${statusWithMinutes(a)}</td>
                  <td style="max-width:140px;">${esc(a.note||'—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML(pageData)}
      `;
      bindPagination(listEl, page => { historyPage = page; loadHistory(); });
    } catch(e) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(e.message)}</div></div>`;
    }
  }

  function openAttendanceSummary(employeeId) {
    const monthValue = document.getElementById('att-month-filter')?.value || new Date().toISOString().slice(0, 7);
    const dateValue = document.getElementById('att-date-filter')?.value || '';
    const params = dateValue ? { from: dateValue, to: dateValue } : { year: monthValue.slice(0, 4), month: monthValue.slice(5, 7) };
    openModal('Tổng kết chấm công nhân viên', `<div id="att-summary-content">${loadingHTML()}</div>`, `<button class="btn-secondary" id="att-summary-close">Đóng</button>`);
    document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--attendance-summary');
    document.getElementById('att-summary-close')?.addEventListener('click', closeModal);
    api.getEmployeeAttendanceSummary(employeeId, params).then(data => {
      const content = document.getElementById('att-summary-content');
      if (!content) return;
      const s = data.summary;
      const metric = (label, value) => `<div class="att-summary-metric"><span>${label}</span><strong>${value}</strong></div>`;
      content.innerHTML = `
        <div class="att-summary-person">
          <div><div class="att-summary-name">${esc(data.employee.full_name)}</div><div class="att-summary-meta">${esc(data.employee.employee_code || '—')} · ${esc(data.employee.department || 'Chưa có phòng ban')} · ${esc(data.employee.position || 'Nhân viên')}</div></div>
          <span class="badge ${data.employee.is_active ? 'badge-success' : 'badge-gray'}">${data.employee.is_active ? 'Đang làm việc' : 'Ngừng hoạt động'}</span>
        </div>
        <div class="att-summary-period">Kỳ tổng kết: ${esc(data.period.from)} đến ${esc(data.period.to)}</div>
        <div class="att-summary-grid">
          ${metric('Ngày công chuẩn', s.standardWorkDays)}${metric('Ngày công thực tế', s.actualWorkDays)}${metric('Đủ ngày / nửa ngày', `${s.fullDays} / ${s.halfDays}`)}${metric('Văn phòng / WFH / công tác', `${s.officeDays} / ${s.wfhDays} / ${s.businessDays}`)}
          ${metric('Nghỉ phép có duyệt', s.paidLeaveDays)}${metric('Vắng không phép', s.absentDays)}${metric('Thiếu vào / ra', `${s.missingCheckinDays} / ${s.missingCheckoutDays}`)}${metric('Đi muộn', `${s.lateDays} ngày · ${s.lateMinutes} phút`)}
          ${metric('Về sớm', `${s.earlyDays} ngày · ${s.earlyMinutes} phút`)}${metric('OT đã duyệt', `${Number(s.approvedOvertimeHours || 0).toFixed(2)} giờ`)}${metric('Tổng giờ làm', `${s.totalWorkHours.toFixed(1)} giờ`)}${metric('Tỷ lệ chuyên cần', `${s.attendanceRate}%`)}
        </div>
        <div class="att-summary-detail-head"><h4>Chi tiết theo ngày</h4><div class="att-summary-filters"><select id="att-detail-status"><option value="">Mọi trạng thái</option><option value="late">Đi muộn</option><option value="absent">Vắng</option><option value="leave">Nghỉ phép</option></select><select id="att-detail-work"><option value="">Mọi hình thức</option><option value="office">Văn phòng</option><option value="wfh">WFH</option><option value="business">Công tác</option></select><select id="att-detail-exception"><option value="">Mọi ngoại lệ</option><option value="late">Đi muộn</option><option value="early">Về sớm</option><option value="missing">Thiếu check-in/out</option></select></div></div>
        <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Thứ</th><th>Hình thức</th><th>Ca</th><th>Vào</th><th>Ra</th><th>Tổng giờ</th><th>Đi muộn</th><th>Về sớm</th><th>Trạng thái</th><th>Ghi chú</th>${isManager ? '<th>Thao tác</th>' : ''}</tr></thead><tbody id="att-detail-rows"></tbody></table></div>`;
      const renderRows = () => {
        const status = document.getElementById('att-detail-status').value;
        const work = document.getElementById('att-detail-work').value;
        const exception = document.getElementById('att-detail-exception').value;
        const rows = data.records.filter(r => (!status || r.status === status) && (!work || r.work_type === work) && (!exception || (exception === 'late' && r.late_minutes > 0) || (exception === 'early' && r.early_minutes > 0) || (exception === 'missing' && (!r.checkin_time || !r.checkout_time))));
        document.getElementById('att-detail-rows').innerHTML = rows.length ? rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(new Date(r.date + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short' }))}</td><td>${esc(WORK_TYPE_LABEL[r.work_type] || WORK_TYPE_LABEL.office)}</td><td>${esc(SHIFT_LABEL_SHORT[r.shift] || SHIFT_LABEL_SHORT.full)}</td><td>${esc(r.checkin_time || '—')}</td><td>${esc(r.checkout_time || '—')}</td><td>${r.work_hours ? Number(r.work_hours).toFixed(1) + 'h' : '—'}</td><td>${r.late_minutes ? r.late_minutes + 'p' : '—'}</td><td>${r.early_minutes ? r.early_minutes + 'p' : '—'}</td><td>${statusBadge(r.status)}</td><td>${esc(r.note || '—')}</td>${isManager ? `<td><button class="btn-icon att-summary-edit" data-id="${r.id}" data-checkin="${esc(r.checkin_time || '')}" data-checkout="${esc(r.checkout_time || '')}" data-status="${esc(r.status)}" data-note="${esc(r.note || '')}" title="Sửa">✏️</button></td>` : ''}</tr>`).join('') : `<tr><td colspan="${isManager ? 12 : 11}" class="att-summary-empty">Không có bản ghi phù hợp.</td></tr>`;
        document.querySelectorAll('.att-summary-edit').forEach(btn => btn.addEventListener('click', () => openEditAttModal(btn.dataset)));
      };
      ['att-detail-status', 'att-detail-work', 'att-detail-exception'].forEach(id => document.getElementById(id).addEventListener('change', renderRows));
      renderRows();
    }).catch(error => {
      const content = document.getElementById('att-summary-content');
      if (content) content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(error.message || 'Không thể tải tổng kết chấm công')}</div></div>`;
    });
  }

  document.getElementById('btn-my-att-summary')?.addEventListener('click', () => openAttendanceSummary(me.id));

  function openEditAttModal(data) {
    openModal('Sửa chấm công', `
      <div class="field"><label>Check in</label><input type="time" id="edit-ci" value="${esc(data.checkin||'')}"/></div>
      <div class="field"><label>Check out</label><input type="time" id="edit-co" value="${esc(data.checkout||'')}"/></div>
      <div class="field"><label>Trạng thái</label>
        <select id="edit-ast">
          <option value="present" ${data.status==='present'?'selected':''}>Đúng giờ</option>
          <option value="late" ${data.status==='late'?'selected':''}>Đi muộn</option>
          <option value="absent" ${data.status==='absent'?'selected':''}>Vắng</option>
          <option value="leave" ${data.status==='leave'?'selected':''}>Nghỉ phép</option>
        </select>
      </div>
      <div class="field"><label>Ghi chú</label><input type="text" id="edit-anote" value="${esc(data.note||'')}"/></div>
    `, `
      <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
      <button class="btn-primary" id="save-att-btn">Lưu</button>
    `);
    let savingEdit = false;
    document.getElementById('save-att-btn').addEventListener('click', async () => {
      if (savingEdit) return;
      const saveBtn = document.getElementById('save-att-btn');
      savingEdit = true; saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu...';
      try {
        await api.updateAttendance(parseInt(data.id), {
          checkin_time: document.getElementById('edit-ci').value,
          checkout_time: document.getElementById('edit-co').value,
          status: document.getElementById('edit-ast').value,
          note: document.getElementById('edit-anote').value,
        });
        closeModal(); toast('Đã cập nhật', 'success'); loadHistory();
      } catch(e) {
        toast(e.message, 'error');
        savingEdit = false; saveBtn.disabled = false; saveBtn.textContent = 'Lưu';
      }
    });
  }

  // Add attendance (admin)
  document.getElementById('btn-add-att')?.addEventListener('click', () => {
    openModal('Thêm chấm công', `
      <div class="field"><label>Nhân viên ID</label><input type="number" id="new-att-uid" placeholder="User ID"/></div>
      <div class="field"><label>Ngày</label><input type="date" id="new-att-date" value="${today()}"/></div>
      <div class="field"><label>Check in</label><input type="time" id="new-att-ci" value="08:30"/></div>
      <div class="field"><label>Check out</label><input type="time" id="new-att-co" value="17:30"/></div>
      <div class="field"><label>Trạng thái</label>
        <select id="new-att-status"><option value="present">Đúng giờ</option><option value="late">Đi muộn</option></select>
      </div>
    `, `
      <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
      <button class="btn-primary" id="save-new-att">Lưu</button>
    `);
    document.getElementById('save-new-att').addEventListener('click', async () => {
      toast('Tính năng thêm thủ công đang phát triển', 'info');
      closeModal();
    });
  });

  await loadTodayStatus();
  loadHistory();
}
