import { api } from '../api.js?v=20260811-attendance-correction-v1';
import { esc, fmtDate, statusBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, today, initials, avatarColor, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination } from '../utils.js?v=20260811-attendance-registration-v1';
import { attendanceClosingMonth } from '../attendance-period.js';
import { getDeviceLocation } from '../location.js?v=20260816-location-v1';
import { renderGeoMap, classifyMarker } from '../geo-map.js?v=20260817-geofence-soft-v1';

const WORK_TYPE_LABEL = { office: '🏢 Văn phòng', wfh: '🏠 WFH', business: '✈️ Công tác' };
const SHIFT_LABEL = { morning: 'Ca sáng (08:30–12:00)', afternoon: 'Ca chiều (13:30–17:00)', full: 'Cả ngày' };
const SHIFT_LABEL_SHORT = { morning: 'Ca sáng', afternoon: 'Ca chiều', full: 'Cả ngày' };
const isHcnsDepartment = (department) => ['hcns', 'phong hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'].includes(String(department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());


export async function renderAttendance(el, me, route = {}) {
  const isManager = me.role === 'admin' || me.role === 'manager';
  const canManageAttendance = isManager || isHcnsDepartment(me.department);
  const canImportHistorical = me.role === 'admin' || isHcnsDepartment(me.department);
  const routeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(route.segments?.[1] || '')) ? String(route.segments[1]) : '';
  const routeEmployeeId = Number(route.segments?.[2] || 0);
  const closingMonth = attendanceClosingMonth();
  const closingLabel = `Kỳ chốt công: ${closingMonth.slice(5, 7)}/${closingMonth.slice(0, 4)}`;

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
      <div id="att-compliance" aria-live="polite" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px;"></div>

      <div class="att-clock-grid">
        <div class="att-clock-main">

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
        <button id="btn-register" class="att-btn-in" style="width:100%;">📝 Đăng ký & Check In</button>
      </div>

      <div id="att-note-wrap" style="margin-top:10px;display:none;">
        <input id="att-note" type="text" placeholder="Ghi chú (tuỳ chọn)" style="background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.4);color:#fff;border-radius:8px;padding:8px 12px;width:100%;"/>
      </div>
      <div class="att-clock-btns">
        <button id="btn-checkout" class="att-btn-out" disabled>🏁 Check Out</button>
      </div>

        </div><!-- /att-clock-main -->

        <div class="att-clock-geo" id="att-clock-geo">
          <div class="att-clock-geo-head">
            <div class="att-clock-geo-title">📍 Vị trí chấm công</div>
            <div class="att-clock-geo-controls">
              <input type="date" id="att-geo-date" value="${esc(routeDate || today())}"/>
              <select id="att-geo-office"><option value="">Tự động</option></select>
              <button type="button" id="btn-geo-refresh" class="att-geo-refresh" title="Làm mới bản đồ">🔄</button>
            </div>
          </div>
          <div class="att-clock-geo-meta" id="att-geo-meta">Đang tải…</div>
          <div id="att-geo-map"></div>
          <div class="att-clock-geo-legend">
            <span class="att-geo-legend-item"><i class="att-geo-dot" style="background:#3B82F6"></i>Trong phạm vi</span>
            <span class="att-geo-legend-item"><i class="att-geo-dot" style="background:#EF4444"></i>Ngoài phạm vi</span>
            <span class="att-geo-legend-item"><i class="att-geo-dot geo-dot-current"></i>Tôi</span>
          </div>
          <div id="att-geo-my-status" class="att-clock-geo-status">Đang tải trạng thái…</div>
          <div class="att-clock-geo-note">Điểm đánh dấu là vị trí check-in gần nhất của ngày đang xem — không phải theo dõi liên tục.</div>
        </div>

      </div><!-- /att-clock-grid -->
    </div>

    <div class="card" style="margin:14px 0;">
      <div class="card-header"><div class="card-title">📝 Form làm thêm giờ</div><button id="btn-create-ot-form" class="btn-primary btn-sm">+ Tạo form</button></div>
      <div id="ot-form-list">${loadingHTML()}</div>
    </div>

    ${canManageAttendance ? `<div class="card" style="margin:14px 0;">
      <div class="card-header"><div class="card-title">⏱️ Yêu cầu làm thêm giờ</div><select id="ot-status-filter" class="btn-secondary btn-sm"><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Đã từ chối</option><option value="">Tất cả</option></select></div>
      <div id="ot-request-list">${loadingHTML()}</div>
    </div>` : ''}

    <!-- Filter -->
    <div id="att-history-card" class="card" style="margin-bottom:14px;">
      <div class="card-header" style="margin-bottom:10px;">
        <div class="card-title">📅 Lịch sử chấm công</div>
        <div style="display:flex;gap:8px;">
          ${canManageAttendance ? `<button id="btn-att-monthly-board" class="btn-secondary btn-sm">▦ Bảng chấm công tổng hợp</button>` : ''}
          ${!canManageAttendance ? `<button id="btn-my-att-summary" class="btn-secondary btn-sm">Tổng kết của tôi</button>` : ''}
          ${canImportHistorical ? `<button id="btn-import-att" class="btn-secondary btn-sm">⇧ Nhập bảng</button>` : ''}${isManager ? `<button id="btn-add-att" class="btn-primary btn-sm">+ Thêm</button>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <input type="month" id="att-month-filter" class="w-full" style="max-width:180px;" value="${closingMonth}"/>
        <span class="badge badge-info" id="att-closing-period" style="align-self:center;">${closingLabel}</span>
        <input type="date" id="att-date-filter" class="w-full" style="max-width:170px;" title="Lọc theo ngày cụ thể" value="${esc(routeDate)}"/>
          ${canManageAttendance ? `

          <input type="text" id="att-search" placeholder="Tìm theo tên, mã nhân viên..." style="min-width:220px;flex:1;"/>
          <select id="att-dept-filter" style="max-width:220px;">
            <option value="">Tất cả phòng ban</option>
            ${DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
          </select>
          <select id="att-location-filter" style="max-width:120px;">
            <option value="">Tất cả địa điểm</option>
            <option value="hcm">HCM</option>
            <option value="hn">HN</option>
          </select>` : ''}
      </div>
      <div id="att-list">${loadingHTML()}</div>
    </div>
  `;

  // Keep the attendance history immediately below the clock actions, before overtime forms.
  const historyCard = document.getElementById('att-history-card');
  const clockCard = document.getElementById('att-clock-card');
  if (historyCard && clockCard) clockCard.insertAdjacentElement('afterend', historyCard);

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
  el._cleanup = () => { clearInterval(clockInterval); try { geoMap?.destroy(); } catch (_) {} };

  // Load today's record
  let todayRecord = null;
  let regWorkType = 'office';
  let regShifts = new Set(); // subset of {morning, afternoon}
  let submitting = false; // guards against double-click across register/checkin/checkout
  const gpsPayload = () => getDeviceLocation({ purposeLabel: 'chấm công tại văn phòng' });

  // ── Attendance location map panel (Vị trí chấm công) ────────────
  let geoMap = null;
  let geoOffices = [];
  let geoOfficeId = ''; // '' = let the backend resolve the right office
  let geoAutoSelected = false; // only auto-pick the employee's work-location office once

  async function loadGeoOffices() {
    try {
      const { locations = [] } = await api.getAttendanceLocations();
      geoOffices = locations;
      const select = document.getElementById('att-geo-office');
      if (!select) return;
      select.innerHTML = `<option value="">Tự động</option>` + geoOffices.map(location => `<option value="${location.id}">${esc(location.name)}</option>`).join('');
      // Auto-select the office matching the employee's work location (HN/HCM),
      // so e.g. a Hà Nội-based employee sees the Hà Nội geofence, not a default.
      if (!geoAutoSelected && geoOfficeId === '' && me?.work_location) {
        const wl = String(me.work_location).trim().toLowerCase();
        const match = geoOffices.find(location => {
          const code = String(location.code || '').toLowerCase();
          const name = String(location.name || '').toLowerCase();
          if (code && code.includes(wl)) return true;
          if (wl === 'hcm' && (code.includes('hcm') || name.includes('hồ chí minh') || name.includes('ho chi minh'))) return true;
          if (wl === 'hn' && (code.includes('hn') || name.includes('hà nội') || name.includes('ha noi'))) return true;
          return false;
        });
        if (match) { geoOfficeId = String(match.id); geoAutoSelected = true; }
      }
      select.value = geoOfficeId || '';
    } catch (_) { /* office selector is optional */ }
  }

  function markerTooltipHTML(m) {
    const name = esc(m.employee_name || `NV ${m.employee_id}`);
    const timeLine = m.checkin_time ? `<div>Check-in: ${esc(m.checkin_time)}</div>` : '';
    const distLine = m.distance_m != null ? `<div>Khoảng cách: ${Math.round(Number(m.distance_m))} m</div>` : '';
    const accLine = m.checkin_accuracy_meters != null ? `<div>Độ chính xác GPS: ±${Math.round(Number(m.checkin_accuracy_meters))} m</div>` : '';
    const status = m.inside_geofence !== false
      ? '<div class="geo-tooltip-status geo-tooltip-inside">Trong phạm vi</div>'
      : `<div class="geo-tooltip-status geo-tooltip-outside">Ngoài phạm vi · ${m.requires_location_review ? 'Cần xem xét' : ''}</div>`;
    return `<div class="geo-tooltip-name">${name}</div>${timeLine}${distLine}${accLine}${status}`;
  }

  async function loadGeoPanel() {
    const mapEl = document.getElementById('att-geo-map');
    const metaEl = document.getElementById('att-geo-meta');
    if (!mapEl) return;
    const dateVal = document.getElementById('att-geo-date')?.value || today();
    try {
      if (!geoOffices.length) await loadGeoOffices(); // also auto-selects the employee's work-location office
      const data = await api.getAttendanceCheckinPoints({ date: dateVal, office_id: geoOfficeId || '' });
      if (!data.office) {
        if (metaEl) metaEl.textContent = data.reason || 'Chưa cấu hình địa điểm chấm công';
        mapEl.innerHTML = '';
        geoMap = null;
        updateGeoMyStatus(data);
        return;
      }
      const office = data.office;
      if (metaEl) metaEl.innerHTML = `${esc(office.name)} · Bán kính: ${Number(office.radius_meters)} m · ${data.markers.length} điểm chấm công`;
      const markers = (data.markers || []).map(m => ({
        latitude: m.latitude, longitude: m.longitude,
        label: m.employee_name, employee_id: m.employee_id,
        is_current_user: m.is_current_user,
        inside_geofence: m.inside_geofence,
        checkin_time: m.checkin_time,
        checkin_accuracy_meters: m.checkin_accuracy_meters,
        distance_m: m.distance_m,
        kind: classifyMarker(m, me.id),
        tooltipHTML: markerTooltipHTML(m),
      }));
      if (geoMap) {
        geoMap.setOffice({ latitude: Number(office.latitude), longitude: Number(office.longitude) }, Number(office.radius_meters), office.name);
        geoMap.setMarkers(markers, { fit: true });
      } else {
        geoMap = renderGeoMap(mapEl, {
          center: { latitude: Number(office.latitude), longitude: Number(office.longitude) },
          radiusMeters: Number(office.radius_meters || 100),
          officeName: office.name,
          markers,
          theme: 'dark',
          height: 250,
        });
      }
      updateGeoMyStatus(data);
    } catch (e) {
      if (metaEl) metaEl.textContent = e.message || 'Không tải được bản đồ';
    }
  }

  function updateGeoMyStatus(data) {
    const statusEl = document.getElementById('att-geo-my-status');
    if (!statusEl) return;
    const mine = (data?.markers || []).find(m => m.is_current_user);
    if (mine) {
      const acc = mine.checkin_accuracy_meters != null ? ` · Độ chính xác GPS ±${Math.round(Number(mine.checkin_accuracy_meters))} m` : '';
      const inRange = mine.inside_geofence !== false;
      const flag = !inRange && mine.requires_location_review ? ' · cần xem xét' : '';
      statusEl.innerHTML = `<b>${inRange ? '🔵' : '🔴'} Vị trí check-in của bạn</b>: ghi nhận lúc ${esc(mine.checkin_time || '—')} · khoảng cách ${Math.round(Number(mine.distance_m))} m · ${inRange ? 'Trong phạm vi' : 'Ngoài phạm vi'}${flag}${acc}`;
    } else if (data?.office) {
      statusEl.textContent = 'Bạn chưa có điểm check-in GPS trong ngày đang xem. GPS: Không có dữ liệu.';
    }
  }

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
      // Restore chip selection from existing registration so UI matches reality
      if (todayRecord && todayRecord.shift) {
        regShifts.clear();
        if (todayRecord.shift === 'full') { regShifts.add('morning'); regShifts.add('afternoon'); }
        else if (todayRecord.shift === 'morning') regShifts.add('morning');
        else if (todayRecord.shift === 'afternoon') regShifts.add('afternoon');
      }
      if (regShifts.size === 0) { regShifts.add('morning'); regShifts.add('afternoon'); }
      updateShiftChips();
      renderClockState();
      void loadAttendanceCompliance();
      void loadGeoPanel();
    } catch(e) {
      document.getElementById('att-status-line').innerHTML = `<span style="font-size:12px;opacity:.7">Lỗi tải trạng thái</span>`;
    }
  }

  function complianceTile(title, value, detail, tone = 'rgba(255,255,255,.12)') {
    return `<div style="background:${tone};border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:9px 10px;min-width:0;">
      <div style="font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.03em;">${title}</div>
      <div style="font-size:16px;font-weight:800;margin:2px 0 3px;">${value}</div>
      <div style="font-size:11px;line-height:1.35;opacity:.84;">${detail}</div>
    </div>`;
  }

  async function loadAttendanceCompliance() {
    const target = document.getElementById('att-compliance');
    if (!target) return;
    target.innerHTML = complianceTile('Tuân thủ tháng này', 'Đang tải…', 'Đang kiểm tra chấm công tháng hiện tại');
    try {
      const data = await api.getMyAttendanceCompliance();
      if (!data.policy_active) {
        target.innerHTML = complianceTile('Tuân thủ tháng này', 'Chưa áp dụng', `Chế tài hiện hành áp dụng từ ${esc(data.policy?.effective_month || '2026-08')}`);
        return;
      }
      const lateCount = Number(data.late_count || 0);
      const missingCount = Number(data.missing_checkinout_count || 0);
      const lateDetail = lateCount === 0
        ? 'Chưa ghi nhận đi trễ. Bạn được miễn tối đa 2 lần/tháng.'
        : lateCount <= 2
          ? `Lần thứ ${lateCount}; còn miễn ${Number(data.late_free_remaining || 0)} lần trong tháng.`
          : `Lần thứ ${lateCount}; ${Number(data.late_penalty_count || 0)} lần vượt mức, đề xuất ${Number(data.late_penalty_amount || 0).toLocaleString('vi-VN')}đ sau xác nhận HCNS.`;
      const missingDetail = missingCount === 0
        ? 'Chưa có vi phạm đã chốt. Ngày hôm nay chưa được tính.'
        : `${missingCount} lần đã chốt qua ngày kế tiếp; đề xuất ${Number(data.missing_penalty_amount || 0).toLocaleString('vi-VN')}đ (50.000đ/lần) sau xác nhận HCNS.`;
      target.innerHTML =
        complianceTile('Đi trễ', lateCount ? `Lần thứ ${lateCount}` : '0 lần', lateDetail, lateCount > 2 ? 'rgba(198,47,47,.27)' : 'rgba(255,255,255,.12)') +
        complianceTile('Quên check-in/out', `${missingCount} lần`, missingDetail, missingCount ? 'rgba(198,47,47,.27)' : 'rgba(255,255,255,.12)');
    } catch (_) {
      target.innerHTML = complianceTile('Tuân thủ tháng này', 'Chưa tải được', 'Vui lòng tải lại để xem số liệu chế tài.');
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
  const btnOut = document.getElementById('btn-checkout');
  const noteWrap = document.getElementById('att-note-wrap');
  const regWrap = document.getElementById('att-register-wrap');

  const infoLine = todayRecord
    ? `<div style="font-size:12px;opacity:.8;margin-top:2px;">${WORK_TYPE_LABEL[todayRecord.work_type] || WORK_TYPE_LABEL.office} · ${SHIFT_LABEL_SHORT[todayRecord.shift] || SHIFT_LABEL_SHORT.full}${todayRecord.work_type === 'business' ? ` (${esc(todayRecord.expected_start||'—')}–${esc(todayRecord.expected_end||'—')})` : ''}</div>`
    : '';

  if (!todayRecord || !todayRecord.registered) {
    // Chưa đăng ký: hiện form đăng ký + nút "Đăng ký & Check In"
    statusLine.innerHTML = `<span class="badge badge-gray" style="font-size:12px;">📝 Chưa đăng ký hôm nay</span>`;
    btnOut.disabled = true;
    noteWrap.style.display = 'none';
    regWrap.style.display = 'block';
  } else if (todayRecord.checkin_time && todayRecord.checkout_time) {
    // Đã check-out: khóa tất cả
    statusLine.innerHTML = `
      <span class="badge badge-success" style="font-size:12px;">✅ Đã hoàn thành</span>
      <span style="font-size:12px;opacity:.8">${todayRecord.checkin_time} → ${todayRecord.checkout_time} (${(todayRecord.work_hours||0).toFixed(1)}h)</span>
      ${infoLine}${lateEarlyLine(todayRecord)}`;
    btnOut.disabled = true;
    noteWrap.style.display = 'none';
    regWrap.style.display = 'none';
  } else if (todayRecord.checkin_time) {
    // Đã check-in: mở check-out
    statusLine.innerHTML = `
      <span class="badge badge-warning" style="font-size:12px;">🔄 Đang làm</span>
      <span style="font-size:12px;opacity:.8">Vào lúc ${todayRecord.checkin_time}</span>
      ${infoLine}${lateEarlyLine(todayRecord)}`;
    btnOut.disabled = false;
    noteWrap.style.display = 'none';
    regWrap.style.display = 'none';
  } else {
    // Đã đăng ký nhưng chưa check-in (trường hợp hiếm, có thể xảy ra nếu user đăng ký từ nơi khác)
    // Vẫn hiện nút "Đăng ký & Check In" để user có thể check-in
    statusLine.innerHTML = `<span class="badge badge-info" style="font-size:12px;">📍 Đã đăng ký — sẵn sàng check in</span>${infoLine}`;
    btnOut.disabled = true;
    noteWrap.style.display = 'block';
    regWrap.style.display = 'block';
    // Đổi nhãn nút thành "Check In" vì đã đăng ký rồi
    const regBtn = document.getElementById('btn-register');
    if (regBtn) regBtn.textContent = '⏰ Check In';
  }
}

  // Register + checkin (combinend)
  // Register + Check In (combined)
document.getElementById('btn-register').addEventListener('click', async () => {
  if (submitting) return;
  const btn = document.getElementById('btn-register');

  // Nếu đã đăng ký rồi (trường hợp registered=true nhưng chưa checkin)
  // thì chỉ cần check-in, không cần đăng ký lại
  const needsRegistration = !todayRecord || !todayRecord.registered;

  if (needsRegistration && regWorkType === 'business') {
    const s = document.getElementById('att-exp-start').value;
    const en = document.getElementById('att-exp-end').value;
    if (!s || !en) { toast('Vui lòng nhập giờ dự kiến', 'error'); return; }
  }

  // Xác nhận
  const shiftLabel = resolvedShift() === 'full' ? 'Cả ngày' : resolvedShift() === 'morning' ? 'Ca sáng' : 'Ca chiều';
  const workTypeLabel = WORK_TYPE_LABEL[regWorkType] || regWorkType;
  const actionLabel = needsRegistration ? 'Đăng ký & Check In' : 'Check In';
  const confirmMsg = needsRegistration
    ? `Xác nhận ${actionLabel}?\n\n📌 Hình thức: ${workTypeLabel}\n🕐 Ca làm: ${shiftLabel}`
    : `Xác nhận Check In lúc này?`;
  if (!confirm(confirmMsg)) return;

  submitting = true; btn.disabled = true; const oldText = btn.textContent; btn.textContent = 'Đang xử lý...';
  try {
    if (needsRegistration) {
      // Bước 1: Đăng ký
      await api.registerAttendance({
        work_type: regWorkType,
        shift: resolvedShift(),
        expected_start: regWorkType === 'business' ? document.getElementById('att-exp-start').value : undefined,
        expected_end: regWorkType === 'business' ? document.getElementById('att-exp-end').value : undefined,
        note: document.getElementById('att-reg-note')?.value || '',
      });
    }
    // Bước 2: Check In
    const note = document.getElementById('att-note')?.value || '';
    const activeWorkType = todayRecord?.work_type || regWorkType;
    const geo = activeWorkType === 'office' ? await gpsPayload() : {};
    const result = await api.checkin({ note, ...geo });
    const gf = result.geofence;
    if (gf?.status === 'verified' && gf.location) {
      toast(`Check in thành công · ${gf.location.name} · Cách điểm chấm công: ${Math.round(Number(gf.distance_meters ?? gf.location.distance_meters) || 0)} m · Trong phạm vi cho phép`, 'success', 4500);
    } else if (result.geofence_status === 'outside') {
      const dist = Math.round(Number(result.distance_meters ?? gf?.location?.distance_meters) || 0);
      const lim = Math.round(Number(gf?.location?.radius_meters) || 0);
      toast(`Check-in đã được ghi nhận · ⚠ Bạn đang ngoài phạm vi ${gf?.location?.name || 'văn phòng'} — Khoảng cách: ${dist} m · Bán kính cho phép: ${lim} m — Lượt chấm công này sẽ được gửi để quản trị viên xem xét.`, 'warning', 6500);
    } else if (result.requires_location_review) {
      toast(`Check-in đã được ghi nhận · Vị trí đang ở sát biên hoặc độ chính xác GPS chưa đủ — Lượt chấm công này sẽ được gửi để quản trị viên xem xét.`, 'warning', 6500);
    } else {
      toast(needsRegistration ? 'Đăng ký & Check In thành công!' : 'Check in thành công!', 'success');
    }
    await loadTodayStatus();
    loadHistory();
  } catch(e) {
    toast(e.message || 'Lỗi', 'error');
  } finally {
    submitting = false; btn.disabled = false; btn.textContent = oldText;
  }
});

  // Check-out
  document.getElementById('btn-checkout').addEventListener('click', async () => {
    if (submitting) return;
    if (!confirm('Xác nhận Check Out lúc này?')) return;
    const btnOut = document.getElementById('btn-checkout');
    submitting = true; btnOut.disabled = true; btnOut.textContent = '...';
    try {
      const geo = (todayRecord?.work_type || 'office') === 'office' ? await gpsPayload() : {};
      await api.checkout(geo);
      toast('Check out thành công!', 'success');
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
  let otFormPage = 1;
  let overtimeForms = [];

  const formStatus = status => ({
    draft: '<span class="badge badge-gray">Nháp</span>', pending: '<span class="badge badge-warning">Chờ duyệt</span>',
    approved: '<span class="badge badge-success">Đã duyệt</span>', partially_approved: '<span class="badge badge-info">Duyệt một phần</span>',
    rejected: '<span class="badge badge-danger">Từ chối</span>',
  }[status] || esc(status));

  async function loadOvertimeForms() {
    const list = document.getElementById('ot-form-list');
    if (!list) return;
    const month = document.getElementById('att-month-filter')?.value || closingMonth;
    try {
      const { overtime_forms: forms = [] } = await api.getOvertimeForms({ month });
      overtimeForms = forms;
      const pageData = paginateRows(forms, otFormPage);
      otFormPage = pageData.page;
      list.innerHTML = pageData.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Thời gian & lý do</th><th>Đề nghị / duyệt</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${pageData.rows.map(form => {
        const detail = form.items.map(item => `${esc(item.start_at.replace('T', ' '))} → ${esc(item.end_at.replace('T', ' '))}<br><small>${esc(item.reason)} · ${item.time_category === 'holiday' ? 'Ngày lễ' : item.time_category === 'rest_day' ? 'Ngày nghỉ' : 'Ngày thường'}</small>`).join('<hr style="border:0;border-top:1px solid var(--border);margin:7px 0">');
        const minutes = `${(Number(form.requested_minutes || 0) / 60).toFixed(2)}h${form.status !== 'draft' ? ` / ${(Number(form.approved_minutes || 0) / 60).toFixed(2)}h` : ''}`;
        const canDecide = canManageAttendance && form.status === 'pending';
        const canSubmit = Number(form.user_id) === Number(me.id) && form.status === 'draft';
        return `<tr><td><b>${esc(form.full_name)}</b><br><small>${esc(form.employee_code || '')}</small></td><td style="min-width:260px">${detail}</td><td>${minutes}</td><td>${formStatus(form.status)}${form.review_note ? `<br><small>${esc(form.review_note)}</small>` : ''}</td><td>${canDecide ? `<button class="btn-secondary btn-sm ot-form-decide" data-id="${form.id}">Duyệt</button>` : ''}${canSubmit ? `<button class="btn-primary btn-sm ot-form-submit" data-id="${form.id}">Gửi</button>` : ''}${form.reviewer_name ? `<small>${esc(form.reviewer_name)}</small>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>${paginationHTML(pageData)}` : emptyHTML('📝', 'Chưa có form làm thêm giờ trong kỳ này');
      bindPagination(list, page => { otFormPage = page; loadOvertimeForms(); });
      list.querySelectorAll('.ot-form-decide').forEach(button => button.addEventListener('click', () => openOvertimeFormDecision(Number(button.dataset.id))));
      list.querySelectorAll('.ot-form-submit').forEach(button => button.addEventListener('click', async () => {
        try { await api.submitOvertimeForm(button.dataset.id); toast('Đã gửi form OT chờ duyệt', 'success'); loadOvertimeForms(); }
        catch (error) { toast(error.message, 'error'); }
      }));
    } catch (error) { list.innerHTML = emptyHTML('⚠️', error.message || 'Không thể tải form OT'); }
  }

  function openOvertimeFormCreator() {
    let itemIndex = 0;
    const renderItem = () => `<div class="ot-form-item" data-index="${itemIndex++}" style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px"><div class="input-row"><div class="field"><label>Từ *</label><input class="ot-start" type="datetime-local"/></div><div class="field"><label>Đến *</label><input class="ot-end" type="datetime-local"/></div></div><div class="input-row"><div class="field"><label>Thời điểm *</label><select class="ot-category"><option value="workday">Ngày thường</option><option value="rest_day">Ngày nghỉ</option><option value="holiday">Ngày lễ</option></select></div><div class="field" style="flex:2"><label>Lý do *</label><input class="ot-item-reason" maxlength="1000" placeholder="Ví dụ: Theo lịch tổ chức sự kiện"/></div></div><button type="button" class="btn-danger btn-sm ot-remove-row">Xóa dòng</button></div>`;
    openModal('Tạo form làm thêm giờ', `<div class="field"><label>Tháng OT *</label><input id="ot-form-month" type="month" value="${closingMonth}"/></div><p style="font-size:12px;color:var(--text-2)">Có thể thêm nhiều ca, kể cả ca qua ngày. Chỉ giờ được HCNS duyệt mới được tính.</p><div id="ot-form-items">${renderItem()}</div><button id="ot-add-row" type="button" class="btn-secondary btn-sm">+ Thêm ca OT</button>`, '<button class="btn-secondary" id="ot-form-cancel">Hủy</button><button class="btn-primary" id="ot-form-send">Gửi HCNS duyệt</button>');
    const bindRows = () => {
      document.querySelectorAll('.ot-remove-row').forEach(button => button.onclick = () => { const rows = document.querySelectorAll('.ot-form-item'); if (rows.length === 1) { toast('Form cần ít nhất một ca OT', 'error'); return; } button.closest('.ot-form-item').remove(); });
      // Auto-fill "Đến" when "Từ" is filled: same day at 18:00, or start+2h if start >= 18:00
      document.querySelectorAll('.ot-start').forEach(input => {
        input.addEventListener('change', () => {
          const row = input.closest('.ot-form-item');
          const endInput = row.querySelector('.ot-end');
          if (!endInput || endInput.value || !input.value) return;
          const startVal = input.value; // "2026-08-11T17:00"
          const [datePart, timePart] = startVal.split('T');
          const [h, m] = (timePart || '00:00').split(':').map(Number);
          const endH = h >= 18 ? h + 2 : 18;
          const endTime = `${String(Math.min(endH, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          endInput.value = `${datePart}T${endTime}`;
        });
      });
    };
    bindRows();
    document.getElementById('ot-add-row').onclick = () => { document.getElementById('ot-form-items').insertAdjacentHTML('beforeend', renderItem()); bindRows(); };
    document.getElementById('ot-form-cancel').onclick = closeModal;
    document.getElementById('ot-form-send').onclick = async event => {
      const period_month = document.getElementById('ot-form-month').value;
      const items = [...document.querySelectorAll('.ot-form-item')].map(row => ({ start_at: row.querySelector('.ot-start').value, end_at: row.querySelector('.ot-end').value, reason: row.querySelector('.ot-item-reason').value.trim(), time_category: row.querySelector('.ot-category').value }));
      if (!period_month || items.some(item => !item.start_at || !item.end_at || !item.reason)) { toast('Vui lòng nhập đầy đủ thời gian và lý do', 'error'); return; }
      event.currentTarget.disabled = true;
      try { await api.createOvertimeForm({ period_month, items, submit: true }); closeModal(); toast('Đã gửi form OT chờ HCNS duyệt', 'success'); loadOvertimeForms(); }
      catch (error) { toast(error.message, 'error'); event.currentTarget.disabled = false; }
    };
  }

  function openOvertimeFormDecision(formId) {
    const form = overtimeForms.find(item => Number(item.id) === Number(formId));
    if (!form) return;
    const rows = form.items.map(item => `<tr><td>${esc(item.start_at.replace('T', ' '))}<br>${esc(item.end_at.replace('T', ' '))}</td><td>${esc(item.reason)}</td><td>${Number(item.requested_minutes)} phút</td><td><input class="ot-form-approved" data-id="${item.id}" type="number" min="0" max="${item.requested_minutes}" value="${item.requested_minutes}"/></td></tr>`).join('');
    openModal('Duyệt form làm thêm giờ', `<div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Lý do</th><th>Đề nghị</th><th>Duyệt phút</th></tr></thead><tbody>${rows}</tbody></table></div><div class="field"><label>Ghi chú duyệt/từ chối</label><textarea id="ot-form-review-note" rows="3"></textarea></div>`, '<button class="btn-danger" id="ot-form-reject">Từ chối</button><button class="btn-primary" id="ot-form-approve">Duyệt</button>');
    const decide = async action => {
      const review_note = document.getElementById('ot-form-review-note').value.trim();
      if (action === 'reject' && !review_note) { toast('Vui lòng nhập lý do từ chối', 'error'); return; }
      const items = [...document.querySelectorAll('.ot-form-approved')].map(input => ({ id: Number(input.dataset.id), approved_minutes: Number(input.value) }));
      try { await api.decideOvertimeForm(form.id, { action, review_note, items }); closeModal(); toast(action === 'approve' ? 'Đã duyệt form OT' : 'Đã từ chối form OT', 'success'); loadOvertimeForms(); loadHistory(); }
      catch (error) { toast(error.message, 'error'); }
    };
    document.getElementById('ot-form-approve').onclick = () => decide('approve');
    document.getElementById('ot-form-reject').onclick = () => decide('reject');
  }

  function parseHistoricalTimesheet(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    const title = lines.find(line => /Tháng\s+\d+\s+năm\s+\d+/i.test(line));
    const period = title?.match(/Tháng\s+(\d+)\s+năm\s+(\d+)/i);
    const header = lines.findIndex(line => line.includes('Mã NV') && line.includes('Họ và tên'));
    if (!period || header < 0) throw new Error('Tệp cần là bảng TSV có tiêu đề “Mã NV”, “Họ và tên” và tháng/năm.');
    const departmentMap = { 'BAN GIÁM ĐỐC': 'Ban Giám Đốc', 'PHÒNG HÀNH CHÍNH NHÂN SỰ': 'Phòng HCNS', 'PHÒNG KINH DOANH': 'Phòng Kinh Doanh', 'PHÒNG MARKETING': 'Phòng Marketing', 'PHÒNG BIÊN TẬP': 'Phòng Biên Tập', 'PHÒNG SẢN XUẤT PHIM': 'Phòng Sản Xuất Phim', 'PHÒNG GAME SHOW': 'Phòng Gameshow', 'TẠP VỤ + BẢO VỆ': 'Tạp Vụ + Bảo Vệ', 'PHÒNG KẾ TOÁN': 'Phòng Kế Toán', 'THỰC TẬP SINH': 'Thực Tập Sinh' };
    let department = ''; const employees = [];
    for (const line of lines.slice(header + 2)) {
      const cells = line.split('\t').map(value => value.trim());
      const code = cells[2] || ''; const full_name = cells[3] || '';
      if (!full_name) { if (departmentMap[code.toUpperCase()]) department = departmentMap[code.toUpperCase()]; continue; }
      if (!code) continue;
      const days = {};
      for (let day = 1; day <= 31; day++) { const value = cells[5 + day]; if (['0', '0.5', '1'].includes(value)) days[day] = Number(value); }
      employees.push({ employee_code: code, full_name, position: cells[4] || '', work_location: cells[5] || '', department, note: cells[1] || '', employee_type: (cells[4] || '').toUpperCase() === 'TTS' ? 'TTS' : 'NV', days });
    }
    if (!employees.length) throw new Error('Không đọc được nhân sự nào từ bảng.');
    return { source_name: `Bảng chấm công ${period[2]}-${String(period[1]).padStart(2, '0')}`, period_month: `${period[2]}-${String(period[1]).padStart(2, '0')}`, employees };
  }

  function openHistoricalImport() {
    let payload = null;
    openModal('Nhập bảng chấm công lịch sử', `<div class="field"><label>Tệp bảng chấm công TSV/TXT *</label><input id="att-import-file" type="file" accept="text/plain,.txt,.tsv"/><small>Chọn tệp bảng tháng đã gửi. Hệ thống chỉ xem trước trước khi ghi dữ liệu.</small></div><div class="field"><label>OT lịch sử (JSON, không bắt buộc)</label><textarea id="att-import-ot" rows="5" placeholder='[{"employee_code":"TTS-11","reported_hours":4,"items":[{"start_at":"2026-07-12T08:00","end_at":"2026-07-12T12:00","reason":"Theo lịch tổ chức sự kiện","time_category":"rest_day"}]}]'></textarea></div><div id="att-import-result" style="font-size:13px"></div>`, '<button class="btn-secondary" id="att-import-preview">Xem trước</button><button class="btn-primary" id="att-import-commit" disabled>Nhập dữ liệu</button>');
    document.getElementById('att-import-preview').onclick = async () => {
      const file = document.getElementById('att-import-file').files?.[0];
      if (!file) { toast('Vui lòng chọn tệp bảng chấm công', 'error'); return; }
      try {
        payload = parseHistoricalTimesheet(await file.text());
        const otText = document.getElementById('att-import-ot').value.trim();
        if (otText) payload.overtime_forms = JSON.parse(otText);
        const preview = await api.previewAttendanceImport(payload);
        const errors = preview.preview.filter(row => row.errors?.length);
        document.getElementById('att-import-result').innerHTML = `<p><b>${preview.preview.length}</b> nhân sự · ${preview.preview.filter(row => row.account === 'create').length} tài khoản mới · ${preview.preview.reduce((sum, row) => sum + row.attendance_entries, 0)} ô ngày công.</p>${errors.length ? `<p style="color:var(--danger)">Có ${errors.length} dòng lỗi: ${esc(errors.map(row => `${row.employee_code}: ${row.errors.join(', ')}`).join(' | '))}</p>` : '<p style="color:var(--success)">Dữ liệu hợp lệ. Nhấn “Nhập dữ liệu” để tạo lô.</p>'}`;
        document.getElementById('att-import-commit').disabled = !preview.valid;
      } catch (error) { payload = null; document.getElementById('att-import-commit').disabled = true; toast(error.message || 'Không thể đọc bảng', 'error'); }
    };
    document.getElementById('att-import-commit').onclick = async event => {
      if (!payload) return;
      event.currentTarget.disabled = true;
      try { const result = await api.commitAttendanceImport(payload); closeModal(); toast(`Đã nhập ${result.imported_attendance} bản ghi công; ${result.conflicts.length} xung đột được giữ nguyên`, 'success'); loadHistory(); loadOvertimeForms(); }
      catch (error) { toast(error.message || 'Không thể nhập dữ liệu', 'error'); event.currentTarget.disabled = false; }
    };
  }

  async function loadOvertimeRequests() {
    const list = document.getElementById('ot-request-list');
    if (!list) return;
    try {
      const month = document.getElementById('att-month-filter')?.value || closingMonth;
      const status = document.getElementById('ot-status-filter')?.value || '';
      const { overtime_requests: rows = [] } = await api.getOvertimeRequests({ month, status });
      list.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Ngày</th><th>Checkout / hết ca</th><th>Đề nghị</th><th>Lý do</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.full_name)}</b><br><small>${esc(r.employee_code || '')}</small></td><td>${esc(r.work_date)}</td><td>${esc(r.checkout_time)} / ${esc(r.shift_end_time)}</td><td>${r.requested_minutes} phút${r.approved_minutes != null ? `<br><small>Duyệt: ${r.approved_minutes} phút</small>` : ''}</td><td style="max-width:220px;">${esc(r.reason)}</td><td>${r.status === 'pending' ? '<span class="badge badge-warning">Chờ duyệt</span>' : r.status === 'approved' ? '<span class="badge badge-success">Đã duyệt</span>' : '<span class="badge badge-danger">Từ chối</span>'}${r.status === 'rejected' && r.review_note ? `<br><small style="color:var(--danger)">Lý do: ${esc(r.review_note)}</small>` : ''}</td><td>${r.status === 'pending' ? `<button class="btn-secondary btn-sm ot-decide" data-id="${r.id}" data-minutes="${r.requested_minutes}" data-action="approve">Duyệt</button> <button class="btn-danger btn-sm ot-decide" data-id="${r.id}" data-action="reject">Từ chối</button>` : esc(r.reviewer_name || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyHTML('⏱️', 'Không có yêu cầu làm thêm giờ');
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
  document.getElementById('btn-create-ot-form')?.addEventListener('click', openOvertimeFormCreator);
  document.getElementById('btn-import-att')?.addEventListener('click', openHistoricalImport);
  if (canManageAttendance) loadOvertimeRequests();
  loadOvertimeForms();



  // Month filter
  document.getElementById('att-month-filter').addEventListener('change', () => { historyPage = 1; otFormPage = 1; loadHistory(); loadOvertimeForms(); if (canManageAttendance) loadOvertimeRequests(); });
  document.getElementById('att-date-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-search')?.addEventListener('input', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-dept-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-location-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });

  function statusWithMinutes(a) {
    const awaitingCheckin = Number(a.registered) === 1 && !a.checkin_time && !['absent', 'leave', 'cancelled', 'rejected'].includes(a.status);
    const badge = awaitingCheckin ? '<span class="badge badge-info">📝 Đã đăng ký · chưa check-in</span>' : statusBadge(a.status);
    const bits = [];
    if (a.late_minutes > 0) bits.push(`Trễ ${a.late_minutes}p`);
    if (a.early_minutes > 0) bits.push(`Sớm ${a.early_minutes}p`);
    return bits.length ? `${badge}<div style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(bits.join(' · '))}</div>` : badge;
  }

  function employeePeriodStatus(employee) {
    if (employee.period_status === 'no_data') return '<span class="badge badge-gray">Chưa chấm công</span>';
    if (employee.period_status === 'late') return '<span class="badge badge-warning">Có đi muộn</span>';
    return '<span class="badge badge-success">Đủ dữ liệu</span>';
  }

  function attendanceRateBadge(value) {
    const rate = Number(value || 0);
    const tone = rate >= 95 ? 'is-excellent' : rate >= 80 ? 'is-watch' : 'is-low';
    return `<span class="att-attendance-rate ${tone}">${rate.toFixed(1)}%</span>`;
  }

  async function openMonthlyAttendanceBoard() {
    const monthValue = document.getElementById('att-month-filter')?.value || closingMonth;
    const [year, month] = monthValue.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    openModal(`Bảng chấm công tổng hợp ${String(month).padStart(2, '0')}/${year}`, `<div id="att-monthly-board-content">${loadingHTML()}</div>`, `<button class="btn-secondary" id="att-monthly-board-close">Đóng</button>`);
    document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--attendance-board');
    document.getElementById('att-monthly-board-close')?.addEventListener('click', closeModal);
    try {
      const [{ employees = [] }, { attendance = [] }, { overtime_forms: overtimeForms = [] }] = await Promise.all([
        api.getAttendanceEmployees({ month: String(month), year: String(year) }),
        api.getAttendance({ month: String(month), year: String(year) }),
        api.getOvertimeForms({ month: monthValue }),
      ]);
      const byEmployeeDay = new Map(attendance.map(record => [`${record.user_id}:${record.date}`, record]));
      const mark = record => {
        if (!record || ['absent', 'cancelled', 'rejected', 'leave'].includes(record.status)) return '—';
        if (!record.checkin_time || !record.checkout_time) return '•';
        return record.shift === 'morning' || record.shift === 'afternoon' ? '0.5' : '1';
      };
      const content = document.getElementById('att-monthly-board-content');
      if (!content) return;
      const formatOtMoment = value => value ? new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const otStatus = status => ({ draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', partially_approved: 'Duyệt một phần', rejected: 'Từ chối' }[status] || status || '—');
      const overtimeRows = overtimeForms.flatMap(form => (form.items || []).map((item, index) => `<tr>
        <td>${index === 0 ? esc(form.full_name || '—') : ''}</td><td>${index === 0 ? esc(form.employee_code || '—') : ''}</td>
        <td>${formatOtMoment(item.start_at)}</td><td>${formatOtMoment(item.end_at)}</td>
        <td>${(Number(item.requested_minutes || 0) / 60).toFixed(2)}</td><td>${esc(item.reason || '—')}</td>
        <td>${esc(item.time_category === 'holiday' ? 'Ngày lễ' : item.time_category === 'weekend' ? 'Ngày nghỉ' : 'Ngày thường')}</td>
        <td>${index === 0 ? statusBadge(form.status) : ''}</td></tr>`));
      content.innerHTML = `
        <div class="table-wrap att-monthly-board-table"><table><thead><tr><th>Nhân viên</th><th>Mã NV</th>${Array.from({ length: daysInMonth }, (_, index) => `<th>${index + 1}</th>`).join('')}<th>Tổng công</th></tr></thead><tbody>
          ${employees.map(employee => `<tr><td><strong>${esc(employee.full_name)}</strong></td><td>${esc(employee.employee_code || '—')}</td>${Array.from({ length: daysInMonth }, (_, index) => {
            const date = `${monthValue}-${String(index + 1).padStart(2, '0')}`;
            return `<td>${mark(byEmployeeDay.get(`${employee.user_id}:${date}`))}</td>`;
          }).join('')}<td><strong>${Number(employee.actual_work_days || 0)}</strong></td></tr>`).join('') || `<tr><td colspan="${daysInMonth + 3}">Không có nhân viên trong kỳ này.</td></tr>`}
        </tbody></table></div>
        <div class="att-board-section-title">Tổng hợp form làm thêm giờ <span>${String(month).padStart(2, '0')}/${year}</span></div>
        <div class="table-wrap att-overtime-board-table"><table><thead><tr><th>Nhân viên</th><th>Mã NV</th><th>Làm thêm từ</th><th>Làm thêm đến</th><th>Số giờ</th><th>Lý do</th><th>Thời điểm</th><th>Trạng thái</th></tr></thead><tbody>
          ${overtimeRows.join('') || '<tr><td colspan="8">Chưa có form làm thêm giờ trong kỳ này.</td></tr>'}
        </tbody></table></div>`;
    } catch (error) {
      const content = document.getElementById('att-monthly-board-content');
      if (content) content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(error.message || 'Không thể tải bảng chấm công tổng hợp')}</div></div>`;
    }
  }

  async function loadHistory() {
    const listEl = document.getElementById('att-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const monthVal = document.getElementById('att-month-filter')?.value || closingMonth;
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
        const locationFilter = document.getElementById('att-location-filter')?.value || '';
        if (locationFilter) filteredEmployees = filteredEmployees.filter(e => (e.work_location || '').toLowerCase() === locationFilter.toLowerCase());
        const pageData = paginateRows(filteredEmployees, historyPage);
        historyPage = pageData.page;
        if (!filteredEmployees.length) { listEl.innerHTML = emptyHTML('👥', 'Không có nhân viên phù hợp'); return; }
        listEl.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Chức danh</th><th>Địa điểm</th><th>Ngày công<br><span class="att-column-hint">Thực tế / chuẩn</span></th><th>Đi muộn</th><th>Tỉ lệ chuyên cần</th></tr></thead>
              <tbody>
                ${pageData.rows.map(employee => `<tr class="att-employee-row" data-user-id="${employee.user_id}" role="button" tabindex="0" title="Xem tổng kết chấm công">
                  <td><span style="font-weight:600">${esc(employee.full_name)}</span><br><span style="font-size:11px;color:var(--text-2)">${esc(employee.employee_code || '—')}</span></td>
                  <td>${esc(employee.department || '—')}</td><td>${esc(employee.position || '—')}</td>
                  <td>${esc(employee.work_location || '—')}</td>
                  <td><div class="att-workday-pair"><strong>${Number(employee.actual_work_days || 0)}</strong><span>/</span><span>${Number(employee.standard_work_days || 0)}</span></div></td>
                  <td>${
                    Number(employee.late_days || 0)
                      ? `<span style="font-size:12px;${Number(employee.late_days || 0) > 2 ? 'color:#dc2626;font-weight:700' : 'color:var(--text-2)'}">
                          ${Number(employee.late_days || 0)} lần
                        </span>`
                      : '—'
                  }</td>
                  <td>${attendanceRateBadge(employee.attendance_rate)}</td>
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

      // Load personal summary for the overview section
      let summaryHTML = '';
      try {
        const summaryData = await api.getEmployeeAttendanceSummary(me.id, params);
        const s = summaryData.summary;
        const metric = (label, value, tone = '') => `<div class="att-summary-metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
        summaryHTML = `
          <div class="att-summary-section-title"><span>Tổng quan kỳ công</span><small>5 chỉ số chấm công</small></div>
          <div class="att-summary-grid" style="margin-bottom:14px;">
            ${metric('Ngày công', `${s.actualWorkDays} / ${s.standardWorkDays}`, 'metric-primary')}${metric('Văn phòng / WFH / công tác', `${s.officeDays} / ${s.wfhDays} / ${s.businessDays}`)}
            ${metric('Nghỉ phép / Vắng không phép', `${s.paidLeaveDays} / ${s.absentDays}`, s.absentDays ? 'metric-danger' : '')}${metric('Đi muộn / Về sớm', `${s.lateDays || 0} / ${s.earlyDays || 0} lần`, (s.lateDays || s.earlyDays) ? 'metric-warning' : '')}
            ${metric('OT đã duyệt', `${Number(s.approvedOvertimeHours || 0).toFixed(2)} giờ`, 'metric-primary')}${metric('Tỷ lệ chuyên cần', `${s.attendanceRate}%`, 'metric-success')}
          </div>`;
      } catch (_) { /* summary fails silently */ }

      const timeCell = (value, isValid) => {
        const display = value || '—';
        if (!value) return `<span style="color:var(--text-2)">${display}</span>`;
        return isValid ? `<strong style="color:#16a34a">${esc(display)}</strong>` : `<span style="color:#dc2626">${esc(display)}</span>`;
      };
      listEl.innerHTML = `${summaryHTML}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ngày</th><th>Hình thức</th><th>Ca đăng ký</th><th>Vào</th><th>Ra</th><th>Giờ làm</th><th>OT</th><th>Trạng thái</th><th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              ${pageData.rows.map(a => {
                const checkinValid = a.checkin_time && a.late_minutes === 0;
                const checkoutValid = a.checkout_time && a.early_minutes === 0;
                return `
                <tr>
                  <td style="white-space:nowrap">${esc(a.date)}</td>
                  <td style="white-space:nowrap">${esc((WORK_TYPE_LABEL[a.work_type] || WORK_TYPE_LABEL.office))}</td>
                  <td style="white-space:nowrap">${esc(SHIFT_LABEL_SHORT[a.shift] || SHIFT_LABEL_SHORT.full)}${a.work_type === 'business' ? `<br><span style="font-size:11px;color:var(--text-2)">${esc(a.expected_start||'—')}–${esc(a.expected_end||'—')}</span>` : ''}</td>
                  <td>${timeCell(a.checkin_time, checkinValid)}</td>
                  <td>${timeCell(a.checkout_time, checkoutValid)}${Number(a.auto_checkout) ? '<br><span class="att-quen-checkout-tag">Quên checkout</span>' : ''}</td>
                  <td>${a.work_hours ? Number(a.work_hours).toFixed(1)+'h' : '—'}</td>
                  <td>${a.overtime_status === 'approved' ? `<span class="badge badge-success">${Number(a.approved_overtime_minutes || 0) / 60}h duyệt</span>` : a.overtime_status === 'pending' ? '<span class="badge badge-warning">Chờ duyệt</span>' : a.overtime_status === 'rejected' ? `<span class="badge badge-danger">Từ chối</span>${a.overtime_review_note ? `<br><small style="color:var(--danger)">${esc(a.overtime_review_note)}</small>` : ''}` : '—'}</td>
                  <td>${statusWithMinutes(a)}</td>
                  <td style="max-width:140px;">${esc(a.note||'—')}</td>
                </tr>`;
              }).join('')}
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

  function openAttendanceSummary(employeeId, forcedDate = '') {
    const monthValue = document.getElementById('att-month-filter')?.value || closingMonth;
    const dateValue = forcedDate || document.getElementById('att-date-filter')?.value || '';
    const params = dateValue ? { from: dateValue, to: dateValue } : { year: monthValue.slice(0, 4), month: monthValue.slice(5, 7) };
    openModal('Tổng kết chấm công nhân viên', `<div id="att-summary-content">${loadingHTML()}</div>`, `<button class="btn-secondary" id="att-summary-close">Đóng</button>`);
    document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--attendance-summary');
    document.getElementById('att-summary-close')?.addEventListener('click', closeModal);
    api.getEmployeeAttendanceSummary(employeeId, params).then(data => {
      const content = document.getElementById('att-summary-content');
      if (!content) return;
      const s = data.summary;
      const metric = (label, value, tone = '') => `<div class="att-summary-metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
      content.innerHTML = `
        <section class="att-summary-hero">
          <div class="att-summary-person">
            <div>
              <div class="att-summary-eyebrow">TỔNG KẾT NHÂN SỰ</div>
              <div class="att-summary-name">${esc(data.employee.full_name)}</div>
              <div class="att-summary-meta">${esc(data.employee.employee_code || '—')} · ${esc(data.employee.department || 'Chưa có phòng ban')} · ${esc(data.employee.position || 'Nhân viên')}</div>
            </div>
            <span class="badge ${data.employee.is_active ? 'badge-success' : 'badge-gray'}">${data.employee.is_active ? 'Đang làm việc' : 'Ngừng hoạt động'}</span>
          </div>
          <div class="att-summary-period"><span>Kỳ tổng kết</span><strong>${esc(data.period.from)} — ${esc(data.period.to)}</strong></div>
        </section>
        <div class="att-summary-section-title"><span>Tổng quan kỳ công</span><small>5 chỉ số chấm công</small></div>
        <div class="att-summary-grid">
          ${metric('Ngày công', `${s.actualWorkDays} / ${s.standardWorkDays}`, 'metric-primary')}${metric('Văn phòng / WFH / công tác', `${s.officeDays} / ${s.wfhDays} / ${s.businessDays}`)}
          ${metric('Nghỉ phép / Vắng không phép', `${s.paidLeaveDays} / ${s.absentDays}`, s.absentDays ? 'metric-danger' : '')}${metric('Đi muộn / Về sớm', `${s.lateDays || 0} / ${s.earlyDays || 0} lần`, (s.lateDays || s.earlyDays) ? 'metric-warning' : '')}
          ${metric('OT đã duyệt', `${Number(s.approvedOvertimeHours || 0).toFixed(2)} giờ`, 'metric-primary')}${metric('Tỷ lệ chuyên cần', `${s.attendanceRate}%`, 'metric-success')}
        </div>
        <div class="att-summary-detail-head"><h4>Chi tiết theo ngày</h4><div class="att-summary-filters"><select id="att-detail-status"><option value="">Mọi trạng thái</option><option value="late">Đi muộn</option><option value="absent">Vắng</option><option value="leave">Nghỉ phép</option></select><select id="att-detail-work"><option value="">Mọi hình thức</option><option value="office">Văn phòng</option><option value="wfh">WFH</option><option value="business">Công tác</option></select><select id="att-detail-exception"><option value="">Mọi ngoại lệ</option><option value="late">Đi muộn</option><option value="early">Về sớm</option></select></div></div>
        <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Thứ</th><th>Hình thức</th><th>Ca</th><th>Vào</th><th>Ra</th><th>Tổng giờ</th><th>Đi muộn</th><th>Về sớm</th><th>Trạng thái</th><th>Ghi chú</th>${isManager ? '<th>Thao tác</th>' : ''}</tr></thead><tbody id="att-detail-rows"></tbody></table></div>`;
      const renderRows = () => {
        const status = document.getElementById('att-detail-status').value;
        const work = document.getElementById('att-detail-work').value;
        const exception = document.getElementById('att-detail-exception').value;
        const rows = data.records.filter(r => (!status || r.status === status) && (!work || r.work_type === work) && (!exception || (exception === 'late' && r.late_minutes > 0) || (exception === 'early' && r.early_minutes > 0) || (exception === 'missing' && (!r.checkin_time || !r.checkout_time))));
        // Sort newest date first
        rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const timeCell = (value, isValid) => {
          const display = value || '—';
          if (!value) return `<span style="color:var(--text-2)">${display}</span>`;
          return isValid ? `<strong style="color:#16a34a">${esc(display)}</strong>` : `<span style="color:#dc2626">${esc(display)}</span>`;
        };
        document.getElementById('att-detail-rows').innerHTML = rows.length ? rows.map(r => {
          const awaitingCheckin = Number(r.registered) === 1 && !r.checkin_time && !['absent', 'leave', 'cancelled', 'rejected'].includes(r.status);
          const displayStatus = awaitingCheckin ? '<span class="badge badge-info">📝 Chưa check-in</span>' : statusBadge(r.status);
          const checkinValid = r.checkin_time && r.late_minutes === 0;
          const checkoutValid = r.checkout_time && r.early_minutes === 0;
          // Location-review (ngoài phạm vi GPS) indicator + admin action.
          let locReviewHtml = '';
          if (Number(r.checkin_requires_review) && r.checkin_review_status !== 'approved' && r.checkin_review_status !== 'rejected') {
            locReviewHtml = `<div class="att-loc-review att-loc-review--pending"><span>🔴 Ngoài phạm vi · Cần xem xét</span><br><small>${Math.round(Number(r.checkin_distance_meters) || 0)} m / giới hạn ${Math.round(Number(r.checkin_office_radius) || 0)} m${r.checkin_accuracy_meters != null ? ` · GPS ±${Math.round(Number(r.checkin_accuracy_meters))} m` : ''}</small></div>`;
          } else if (r.checkin_review_status === 'approved') {
            locReviewHtml = `<div class="att-loc-review att-loc-review--approved"><span>✅ Đã xác nhận vị trí</span></div>`;
          } else if (r.checkin_review_status === 'rejected') {
            locReviewHtml = `<div class="att-loc-review att-loc-review--rejected"><span>⛔ Vị trí không hợp lệ</span>${r.checkin_review_note ? `<br><small>${esc(r.checkin_review_note)}</small>` : ''}</div>`;
          }
          const actions = [];
          if (isManager) actions.push(`<button class="btn-icon att-summary-edit" data-id="${r.id}" data-checkin="${esc(r.checkin_time || '')}" data-checkout="${esc(r.checkout_time || '')}" data-status="${esc(r.status)}" data-note="${esc(r.note || '')}" data-work-type="${esc(r.work_type || 'office')}" data-shift="${esc(r.shift || 'full')}" data-expected-start="${esc(r.expected_start || '')}" data-expected-end="${esc(r.expected_end || '')}" title="Sửa">✏️</button>`);
          if (isManager && Number(r.checkin_requires_review) && r.checkin_review_status !== 'approved' && r.checkin_review_status !== 'rejected') {
            actions.push(`<button class="btn-secondary btn-xs att-review-btn" data-id="${r.id}" data-decision="approved">✓ Xác nhận</button><button class="btn-danger btn-xs att-review-btn" data-id="${r.id}" data-decision="rejected">✕ Không hợp lệ</button>`);
          }
          return `<tr><td>${esc(r.date)}</td><td>${esc(new Date(r.date + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short' }))}</td><td>${esc(WORK_TYPE_LABEL[r.work_type] || WORK_TYPE_LABEL.office)}</td><td>${esc(SHIFT_LABEL_SHORT[r.shift] || SHIFT_LABEL_SHORT.full)}</td><td>${timeCell(r.checkin_time, checkinValid)}</td><td>${timeCell(r.checkout_time, checkoutValid)}</td><td>${r.work_hours ? Number(r.work_hours).toFixed(1) + 'h' : '—'}</td><td>${r.late_minutes ? r.late_minutes + 'p' : '—'}</td><td>${r.early_minutes ? r.early_minutes + 'p' : '—'}</td><td>${displayStatus}${locReviewHtml}</td><td>${esc(r.note || '—')}</td>${isManager ? `<td style="white-space:nowrap">${actions.join(' ')}</td>` : ''}</tr>`;
        }).join('') : `<tr><td colspan="${isManager ? 12 : 11}" class="att-summary-empty">Không có bản ghi phù hợp.</td></tr>`;
        document.querySelectorAll('.att-summary-edit').forEach(btn => btn.addEventListener('click', () => openEditAttModal(btn.dataset)));
        document.querySelectorAll('.att-review-btn').forEach(btn => btn.addEventListener('click', async () => {
          const aid = btn.dataset.id; const decision = btn.dataset.decision;
          const rec = rows.find(x => String(x.id) === String(aid));
          try {
            await api.reviewAttendanceLocation(aid, { status: decision, note: '' });
            toast(decision === 'approved' ? 'Đã xác nhận vị trí hợp lệ' : 'Đã đánh dấu vị trí không hợp lệ', 'success');
            if (rec) { rec.checkin_review_status = decision; rec.checkin_requires_review = 0; rec.checkin_reviewed_by = me.id; }
            renderRows();
          } catch (error) { toast(error.message || 'Lỗi khi xác nhận', 'error'); }
        }));
      };
      ['att-detail-status', 'att-detail-work', 'att-detail-exception'].forEach(id => document.getElementById(id).addEventListener('change', renderRows));
      renderRows();
    }).catch(error => {
      const content = document.getElementById('att-summary-content');
      if (content) content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(error.message || 'Không thể tải tổng kết chấm công')}</div></div>`;
    });
  }

  document.getElementById('btn-my-att-summary')?.addEventListener('click', () => openAttendanceSummary(me.id));
  document.getElementById('btn-att-monthly-board')?.addEventListener('click', openMonthlyAttendanceBoard);

  function openEditAttModal(data) {
    const standard = { morning: { lateAfter: '08:45', end: '12:00' }, afternoon: { lateAfter: '13:45', end: '17:00' }, full: { lateAfter: '08:45', end: '17:00' } }[data.shift] || { lateAfter: '08:45', end: '17:00' };
    const lateAfter = data.workType === 'business' ? (data.expectedStart || standard.lateAfter) : standard.lateAfter;
    const shiftEnd = data.workType === 'business' ? (data.expectedEnd || standard.end) : standard.end;
    const minutes = value => /^\d{2}:\d{2}$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
    const allowedCheckoutMinutes = Math.max(0, (minutes(shiftEnd) || 0) - 10);
    const allowedCheckout = `${String(Math.floor(allowedCheckoutMinutes / 60)).padStart(2, '0')}:${String(allowedCheckoutMinutes % 60).padStart(2, '0')}`;
    openModal('Sửa chấm công', `
      <div class="field"><label>Check in</label><input type="time" id="edit-ci" value="${esc(data.checkin||'')}"/></div>
      <div class="field"><label>Check out</label><input type="time" id="edit-co" value="${esc(data.checkout||'')}"/></div>
      <div class="field"><label>Hình thức làm việc</label>
        <select id="edit-worktype">
          <option value="office" ${data.workType==='office'?'selected':''}>🏢 Làm tại công ty</option>
          <option value="wfh" ${data.workType==='wfh'?'selected':''}>🏠 WFH</option>
          <option value="business" ${data.workType==='business'?'selected':''}>✈️ Công tác</option>
        </select>
      </div>
      <div class="field"><label>Ca làm việc</label>
        <select id="edit-shift">
          <option value="morning" ${data.shift==='morning'?'selected':''}>Ca sáng (08:30–12:00)</option>
          <option value="afternoon" ${data.shift==='afternoon'?'selected':''}>Ca chiều (13:30–17:00)</option>
          <option value="full" ${(!data.shift || data.shift==='full')?'selected':''}>Cả ngày</option>
        </select>
      </div>
      <div class="field"><label>Trạng thái</label>
        <select id="edit-ast">
          <option value="present" ${data.status==='present'?'selected':''}>Đúng giờ</option>
          <option value="late" ${data.status==='late'?'selected':''}>Đi muộn</option>
          <option value="absent" ${data.status==='absent'?'selected':''}>Vắng</option>
          <option value="leave" ${data.status==='leave'?'selected':''}>Nghỉ phép</option>
        </select>
      </div>
      <div id="edit-att-rule" style="padding:9px 10px;border-radius:8px;background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;font-size:12px;line-height:1.45;">Chọn <b>Đúng giờ</b> chỉ khi check-in không muộn hơn <b>${esc(lateAfter)}</b> và check-out không sớm hơn <b>${esc(allowedCheckout)}</b> (được sớm 10 phút). Hệ thống sẽ tự tính lại phút đi muộn/về sớm theo giờ đã nhập.</div>
      <div class="field"><label>Ghi chú</label><input type="text" id="edit-anote" value="${esc(data.note||'')}"/></div>
    `, `
      <button class="btn-danger" id="delete-att-btn">🗑 Xóa</button>
      <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
      <button class="btn-primary" id="save-att-btn">Lưu</button>
    `);
    let savingEdit = false;
    const activeRule = () => {
      const shift = document.getElementById('edit-shift')?.value || data.shift || 'full';
      const workType = document.getElementById('edit-worktype')?.value || data.workType || 'office';
      const currentStandard = { morning: { lateAfter: '08:45', end: '12:00' }, afternoon: { lateAfter: '13:45', end: '17:00' }, full: { lateAfter: '08:45', end: '17:00' } }[shift] || standard;
      const currentLateAfter = workType === 'business' ? (data.expectedStart || currentStandard.lateAfter) : currentStandard.lateAfter;
      const currentShiftEnd = workType === 'business' ? (data.expectedEnd || currentStandard.end) : currentStandard.end;
      const currentCheckoutMinutes = Math.max(0, (minutes(currentShiftEnd) || 0) - 10);
      return { lateAfter: currentLateAfter, allowedCheckoutMinutes: currentCheckoutMinutes, allowedCheckout: `${String(Math.floor(currentCheckoutMinutes / 60)).padStart(2, '0')}:${String(currentCheckoutMinutes % 60).padStart(2, '0')}` };
    };
    const validatePresentTiming = () => {
      const checkin = minutes(document.getElementById('edit-ci').value);
      const checkout = minutes(document.getElementById('edit-co').value);
      if (checkin === null && checkout === null) return 'Cần nhập ít nhất giờ check-in hoặc check-out.';
      if (document.getElementById('edit-ast').value !== 'present') return '';
      const rule = activeRule();
      if ((checkin !== null && checkin > minutes(rule.lateAfter)) || (checkout !== null && checkout < rule.allowedCheckoutMinutes)) return `Đúng giờ yêu cầu thời điểm đã nhập phải đúng quy định: vào không muộn hơn ${rule.lateAfter}, ra không sớm hơn ${rule.allowedCheckout} (được sớm 10 phút).`;
      return '';
    };
    const refreshRule = () => {
      const rule = document.getElementById('edit-att-rule');
      const error = validatePresentTiming();
      rule.style.background = error ? '#FEF2F2' : '#FFF7ED';
      rule.style.borderColor = error ? '#FECACA' : '#FED7AA';
      rule.style.color = error ? '#991B1B' : '#9A3412';
      const active = activeRule();
      rule.innerHTML = error || `Có thể để trống <b>một</b> trong hai giờ. Với <b>Đúng giờ</b>, thời điểm được nhập phải đúng quy định: vào không muộn hơn <b>${esc(active.lateAfter)}</b>, ra không sớm hơn <b>${esc(active.allowedCheckout)}</b> (được sớm 10 phút). Hệ thống sẽ tự tính lại phút đi muộn/về sớm theo giờ đã nhập.`;
    };
    ['edit-ci', 'edit-co', 'edit-ast', 'edit-worktype', 'edit-shift'].forEach(id => {
      document.getElementById(id).addEventListener('input', refreshRule);
      document.getElementById(id).addEventListener('change', refreshRule);
    });
    refreshRule();
    document.getElementById('save-att-btn').addEventListener('click', async () => {
      if (savingEdit) return;
      const timingError = validatePresentTiming();
      if (timingError) { toast(timingError, 'error'); return; }
      const saveBtn = document.getElementById('save-att-btn');
      savingEdit = true; saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu...';
      try {
        await api.updateAttendance(parseInt(data.id), {
          checkin_time: document.getElementById('edit-ci').value,
          checkout_time: document.getElementById('edit-co').value,
          work_type: document.getElementById('edit-worktype').value,
          shift: document.getElementById('edit-shift').value,
          status: document.getElementById('edit-ast').value,
          note: document.getElementById('edit-anote').value,
        });
        closeModal(); toast('Đã cập nhật', 'success'); loadHistory();
      } catch(e) {
        toast(e.message, 'error');
        savingEdit = false; saveBtn.disabled = false; saveBtn.textContent = 'Lưu';
      }
    });

    // Delete this attendance row — guarded by a double confirmation.
    document.getElementById('delete-att-btn')?.addEventListener('click', async () => {
      if (!confirm('Xóa dòng chấm công này của nhân viên?')) return;
      if (!confirm('Bạn có chắc chắn muốn XÓA nó? Hành động này không thể hoàn tác.')) return;
      try {
        await api.deleteAttendance(parseInt(data.id));
        closeModal(); toast('Đã xóa dòng chấm công', 'success'); loadHistory();
      } catch (error) { toast(error.message || 'Không xóa được', 'error'); }
    });
  }

  // Add attendance in bulk (admin/HCNS) over a date range. The backend skips
  // non-working days (weekends + company holidays) and already-recorded days.
  // The "Dự kiến" preview is computed server-side via dry_run so it always uses
  // the same working-day source as bảng công & tỉ lệ chuyên cần.
  document.getElementById('btn-add-att')?.addEventListener('click', () => {
    openModal('Thêm chấm công hàng loạt', `
      <div class="field"><label>Nhân viên *</label><select id="batch-att-user"><option value="">Đang tải danh sách...</option></select></div>
      <div class="input-row">
        <div class="field"><label>Từ ngày *</label><input type="date" id="batch-att-from" value="${closingMonth}-01"/></div>
        <div class="field"><label>Đến ngày *</label><input type="date" id="batch-att-to" value="${today()}"/></div>
      </div>
      <div class="input-row">
        <div class="field"><label>Check in</label><input type="time" id="batch-att-ci" value="08:30"/></div>
        <div class="field"><label>Check out</label><input type="time" id="batch-att-co" value="17:30"/></div>
      </div>
      <div class="field"><label>Trạng thái</label>
        <select id="batch-att-status"><option value="present">Đúng giờ</option><option value="late">Đi muộn</option><option value="absent">Vắng</option><option value="leave">Nghỉ phép</option></select>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 0 10px;">
        <input type="checkbox" id="batch-att-skip" checked/> Tự động bỏ qua ngày nghỉ
      </label>
      <div id="batch-att-preview" style="font-size:13px;margin-bottom:4px;">Chọn nhân viên và khoảng ngày để xem dự kiến.</div>
    `, `
      <button class="btn-secondary" id="batch-att-cancel">Hủy</button>
      <button class="btn-primary" id="batch-att-save" disabled>Thêm chấm công</button>
    `);

    api.getUsers().then(({ users = [] }) => {
      const active = users.filter(u => Number(u.is_active) !== 0);
      const select = document.getElementById('batch-att-user');
      select.innerHTML = active.length
        ? `<option value="">Chọn nhân viên...</option>` + active.map(u => `<option value="${u.id}">${esc(u.full_name)}${u.employee_code ? ' (' + esc(u.employee_code) + ')' : ''} · ${esc(u.department || '—')}</option>`).join('')
        : `<option value="">Không có nhân viên</option>`;
      refreshBatchPreview();
    }).catch(() => {
      document.getElementById('batch-att-user').innerHTML = `<option value="">Không tải được danh sách</option>`;
    });

    function currentBatchPayload() {
      return {
        user_id: Number(document.getElementById('batch-att-user').value || 0),
        from_date: document.getElementById('batch-att-from').value,
        to_date: document.getElementById('batch-att-to').value,
        checkin_time: document.getElementById('batch-att-ci').value,
        checkout_time: document.getElementById('batch-att-co').value,
        status: document.getElementById('batch-att-status').value,
        skip_non_working_days: document.getElementById('batch-att-skip').checked,
      };
    }

    let previewTimer = null;
    function refreshBatchPreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => {
        const p = currentBatchPayload();
        const preview = document.getElementById('batch-att-preview');
        const saveBtn = document.getElementById('batch-att-save');
        if (!saveBtn) return;
        if (!p.user_id || !p.from_date || !p.to_date || p.from_date > p.to_date) {
          preview.textContent = 'Vui lòng chọn nhân viên và khoảng ngày hợp lệ.';
          saveBtn.disabled = true;
          return;
        }
        try {
          const r = await api.addAttendanceBatch(p, true);
          if (!r.created) preview.textContent = 'Không có ngày nào để thêm.';
          else preview.innerHTML = `Dự kiến: <b>${r.created}</b> ngày được thêm · <b>${r.skipped}</b> ngày nghỉ bỏ qua · <b>${r.exists}</b> ngày đã có dữ liệu.`;
          saveBtn.disabled = !r.created;
        } catch (e) {
          preview.innerHTML = `<span style="color:var(--danger)">${esc(e.message || 'Lỗi')}</span>`;
          saveBtn.disabled = true;
        }
      }, 350);
    }

    ['batch-att-user', 'batch-att-from', 'batch-att-to', 'batch-att-ci', 'batch-att-co', 'batch-att-status', 'batch-att-skip'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener('change', refreshBatchPreview); el.addEventListener('input', refreshBatchPreview); }
    });

    document.getElementById('batch-att-cancel').addEventListener('click', closeModal);

    document.getElementById('batch-att-save').addEventListener('click', async () => {
      const saveBtn = document.getElementById('batch-att-save');
      const original = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Đang thêm...';
      try {
        const r = await api.addAttendanceBatch(currentBatchPayload(), false);
        closeModal();
        toast(`Đã thêm ${r.created} ngày chấm công.` + (r.skipped ? ` Bỏ qua ${r.skipped} ngày nghỉ.` : '') + (r.exists ? ` ${r.exists} ngày đã có dữ liệu, giữ nguyên.` : ''), 'success', 5000);
        loadHistory();
      } catch (e) {
        toast(e.message || 'Không thể thêm chấm công', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = original;
      }
    });
  });

  document.getElementById('att-geo-office')?.addEventListener('change', event => { geoOfficeId = event.target.value || ''; loadGeoPanel(); });
  document.getElementById('att-geo-date')?.addEventListener('change', () => loadGeoPanel());
  document.getElementById('btn-geo-refresh')?.addEventListener('click', () => loadGeoPanel());

  await loadTodayStatus();
  await loadHistory();
  if (routeEmployeeId && (canManageAttendance || routeEmployeeId === Number(me.id))) {
    openAttendanceSummary(routeEmployeeId, routeDate);
  }
}
