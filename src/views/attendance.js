import { api } from '../api.js?v=20260811-attendance-registration-v1';
import { EventBus } from '../event-bus.js';
import { esc, fmtDate, statusBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, today, initials, avatarColor, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination, sortVietnameseNames, compareVietnameseNames } from '../utils.js?v=20260811-attendance-registration-v1';
import { attendanceClosingMonth } from '../attendance-period.js';
import { getDeviceLocation } from '../location.js?v=20260816-location-v1';
import { renderGeoMap, classifyMarker } from '../geo-map.js?v=20260817-geofence-soft-v1';
import { icon } from '../icons.js';

const WORK_TYPE_LABEL = { office: 'Văn phòng', wfh: 'WFH', business: 'Công tác' };
const SHIFT_LABEL = { morning: 'Ca sáng (08:30–12:00)', afternoon: 'Ca chiều (13:30–17:00)', full: 'Cả ngày' };
const SHIFT_LABEL_SHORT = { morning: 'Ca sáng', afternoon: 'Ca chiều', full: 'Cả ngày' };
const isHcnsDepartment = (department) => ['hcns', 'phong hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'].includes(String(department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

function formatAttendanceNote(note) {
  if (!note) return '—';
  return esc(note)
    .replace(/\[Quên checkout\]/gi, 'Tự động checkout')
    .replace(/quên checkout/gi, 'Tự động checkout');
}

export async function renderAttendance(el, me, route = {}) {
  const isDirectorHau = (u) => {
    if (!u) return false;
    if (u.role === 'admin') return true;
    const code = String(u.employee_code || '').trim().toUpperCase();
    if (code === 'HAUNV') return true;
    const email = String(u.email || '').toLowerCase().trim();
    if (email.startsWith('haunv@')) return true;
    const dept = String(u.department || '').toLowerCase();
    const pos = String(u.position || '').toLowerCase();
    return dept.includes('ban giám đốc') && (pos.includes('tổng giám đốc') || pos.includes('ceo') || pos.includes('giám đốc'));
  };
  const isHau = isDirectorHau(me);
  const isHcns = isHcnsDepartment(me.department) || me.role === 'admin';
  const isManager = me.role === 'admin' || me.role === 'manager';
  const canManageAttendance = isManager || isHcns || isHau;
  const canImportHistorical = isHcns;
  const routeEmployeeId = /^\d+$/.test(String(route.segments?.[1] || '')) ? Number(route.segments[1]) : null;
  const routeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(route.segments?.[2] || route.segments?.[1] || '')) ? String(route.segments[2] || route.segments[1]) : '';
  const closingMonth = attendanceClosingMonth();
  const closingLabel = `Kỳ chốt công: ${closingMonth.slice(5, 7)}/${closingMonth.slice(0, 4)}`;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-title">${icon('clock3', 'lg')} <span>Chấm công</span></div>
    </div>

    <!-- Clock-in card -->
    <div class="att-clock-card" id="att-clock-card">
      <div class="att-clock-grid">
        <div class="att-clock-main">
          <div class="att-clock-time" id="att-live-time">--:--:--</div>
          <div class="att-clock-date" id="att-live-date"></div>
          <div class="att-clock-status" id="att-status-line">
            <span style="font-size:13px;opacity:.8">Đang tải...</span>
          </div>

        <!-- Registration form (shown when not yet registered today) -->
        <div id="att-register-wrap" style="display:none;margin-top:14px;">
        <div class="field" style="margin-bottom:10px;">
          <label style="color:#e2e8f0;font-weight:650;">Hình thức làm việc</label>
          <div class="att-chip-row" id="att-worktype-row">
            <button type="button" class="att-chip" data-worktype="office">${icon('building2', 'xs')} <span>Văn phòng</span></button>
            <button type="button" class="att-chip" data-worktype="wfh">${icon('home', 'xs')} <span>WFH</span></button>
            <button type="button" class="att-chip" data-worktype="business">${icon('plane', 'xs')} <span>Công tác</span></button>
          </div>
        </div>
        <div class="field" id="att-shift-field" style="margin-bottom:10px;">
          <label style="color:#e2e8f0;font-weight:650;">Ca làm việc</label>
          <div class="att-chip-row" id="att-shift-row">
            <button type="button" class="att-chip" data-shift="morning">Sáng 08:30–12:00</button>
            <button type="button" class="att-chip" data-shift="afternoon">Chiều 13:30–17:00</button>
          </div>
          <div style="font-size:12px;color:#cbd5e1;margin-top:6px;line-height:1.4;">Chọn cả hai ca = làm cả ngày. Chỉ check-in đầu ngày và check-out cuối ngày.</div>
        </div>
        <div id="att-wfh-extra" style="display:none;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,0.08);border-radius:8px;border:1px solid rgba(255,255,255,0.18);">
          <div class="field" style="margin-bottom:8px;">
            <label style="color:#fef08a;font-weight:650;display:flex;align-items:center;gap:4px;">
              ${icon('fileText', 'xs')} <span>Lý do WFH *</span>
            </label>
            <input id="att-wfh-reason" type="text" placeholder="Nhập lý do làm việc tại nhà (bắt buộc)..." style="background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.4);color:#fff;width:100%;border-radius:6px;padding:7px 10px;"/>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="color:rgba(255,255,255,.85);font-size:12px;display:flex;align-items:center;gap:4px;">
              ${icon('paperclip', 'xs')} <span>Minh chứng WFH (ảnh chụp, tài liệu hoặc link)</span>
            </label>
            <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
              <label class="btn-secondary btn-sm" style="cursor:pointer;margin:0;background:rgba(255,255,255,0.2);color:#fff;border-color:rgba(255,255,255,0.35);font-size:12px;padding:5px 10px;display:inline-flex;align-items:center;gap:4px;">
                ${icon('upload', 'xs')} <span id="att-wfh-file-label">Chọn tệp / ảnh</span>
                <input type="file" id="att-wfh-file" accept="image/*,application/pdf" style="display:none;"/>
              </label>
              <input type="text" id="att-wfh-proof-url" placeholder="Hoặc dán link tài liệu minh chứng..." style="flex:1;min-width:180px;background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;"/>
            </div>
            <div id="att-wfh-uploaded-hint" style="display:none;font-size:11.5px;color:#86efac;margin-top:4px;"></div>
          </div>
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
      </div>

      <div id="att-note-wrap" style="margin-top:10px;display:none;">
        <input id="att-note" type="text" placeholder="Ghi chú (tuỳ chọn)" style="background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.4);color:#fff;border-radius:8px;padding:8px 12px;width:100%;"/>
      </div>
      <div class="att-clock-btns">
        <button id="btn-register" class="att-btn-in">${icon('clock3', 'sm')} <span>Đăng ký & Check In</span></button>
        <button id="btn-checkout" class="att-btn-out" disabled>${icon('logOut', 'sm')} <span>Check Out</span></button>
      </div>

        </div><!-- /att-clock-main -->

        <div class="att-clock-geo" id="att-clock-geo">
          <div class="att-clock-geo-head">
            <div class="att-clock-geo-title">${icon('mapPin', 'xs')} <span>Vị trí chấm công</span></div>
            <div class="att-clock-geo-controls">
              <input type="date" id="att-geo-date" value="${esc(routeDate || today())}"/>
              <select id="att-geo-office"><option value="">Tự động</option></select>
              <button type="button" id="btn-geo-refresh" class="att-geo-refresh" title="Làm mới bản đồ">${icon('refreshCw', 'xs')}</button>
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

    <!-- 2. Attendance History (Placed in its natural DOM position to eliminate CLS) -->
    <div id="att-history-card" class="card" style="margin-bottom:14px;">
      <div class="card-header" style="margin-bottom:10px;">
        <div class="card-title">${icon('calendarDays', 'sm')} <span>Lịch sử chấm công</span></div>
        <div style="display:flex;gap:8px;">
          ${canManageAttendance ? `<button id="btn-att-monthly-board" class="btn-secondary btn-sm">${icon('clipboardList', 'xs')} <span>Bảng chấm công tổng hợp</span></button>` : ''}
          ${!canManageAttendance ? `<button id="btn-my-att-summary" class="btn-secondary btn-sm">${icon('user', 'xs')} <span>Tổng kết của tôi</span></button>` : ''}
          ${canImportHistorical ? `<button id="btn-import-att" class="btn-secondary btn-sm">${icon('upload', 'xs')} <span>Nhập bảng</span></button>` : ''}${isManager ? `<button id="btn-add-att" class="btn-primary btn-sm">${icon('plus', 'xs')} <span>Thêm</span></button>` : ''}
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

    <!-- 3. Overtime Forms -->
    <div class="card" style="margin:14px 0;">
      <div class="card-header">
        <div class="card-title">${icon('squarePen', 'sm')} <span>Form làm thêm giờ</span></div>
        <div style="display:flex;gap:8px;">
          <button id="btn-ot-summary-board" class="btn-secondary btn-sm">${icon('clipboardList', 'xs')} <span>Bảng tổng hợp OT</span></button>
          <button id="btn-create-ot-form" class="btn-primary btn-sm">${icon('plus', 'xs')} <span>Tạo form</span></button>
        </div>
      </div>
      <div id="ot-form-list">${loadingHTML()}</div>
    </div>

    ${canManageAttendance ? `<div class="card" style="margin:14px 0;">
      <div class="card-header">
        <div class="card-title">${icon('home', 'sm')} <span>Yêu cầu duyệt WFH</span></div>
        <select id="wfh-status-filter" class="btn-secondary btn-sm">
          <option value="">Tất cả trạng thái</option>
          <option value="pending">Chờ duyệt B1 (HCNS)</option>
          <option value="pending_director">Chờ duyệt B2 (Anh Hậu)</option>
          <option value="approved">Đã duyệt</option>
          <option value="rejected">Đã từ chối</option>
        </select>
      </div>
      <div id="wfh-request-list">${loadingHTML()}</div>
    </div>` : ''}

    ${canManageAttendance ? `<div class="card" style="margin:14px 0;">
      <div class="card-header"><div class="card-title">${icon('clock3', 'sm')} <span>Yêu cầu làm thêm giờ</span></div><select id="ot-status-filter" class="btn-secondary btn-sm"><option value="">Tất cả trạng thái</option><option value="pending">Chờ duyệt B1 (HCNS)</option><option value="pending_director">Chờ duyệt B2 (Anh Hậu)</option><option value="approved">Đã duyệt</option><option value="rejected">Đã từ chối</option></select></div>
      <div id="ot-request-list">${loadingHTML()}</div>
    </div>` : ''}
  `;

  // Live clock
  const liveTime = el.querySelector('#att-live-time') || document.getElementById('att-live-time');
  const liveDate = el.querySelector('#att-live-date') || document.getElementById('att-live-date');
  function tickClock() {
    const now = new Date();
    if (liveTime) liveTime.textContent = now.toLocaleTimeString('vi-VN');
    if (liveDate) liveDate.textContent = now.toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
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
      // Auto-select the office matching the employee's work location (HN/HCM/Q9),
      // so e.g. a Hà Nội-based employee sees the Hà Nội geofence, not a default.
      if (!geoAutoSelected && geoOfficeId === '' && me?.work_location) {
        const wl = String(me.work_location).trim().toLowerCase();
        const match = geoOffices.find(location => {
          const code = String(location.code || '').toLowerCase();
          const name = String(location.name || '').toLowerCase();
          if (code && code.includes(wl)) return true;
          if (wl === 'hcm' && (code.includes('hcm') || name.includes('hồ chí minh') || name.includes('ho chi minh'))) return true;
          if (wl === 'hn' && (code.includes('hn') || name.includes('hà nội') || name.includes('ha noi'))) return true;
          if ((wl.includes('q9') || wl.includes('quận 9') || wl.includes('quan 9') || wl.includes('phim trường') || wl.includes('studio')) && (code.includes('q9') || name.includes('q9') || name.includes('phim trường'))) return true;
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
      statusEl.innerHTML = `<b>${icon(inRange ? 'circleCheck' : 'circleAlert', 'xs')} Vị trí check-in của bạn</b>: ghi nhận lúc ${esc(mine.checkin_time || '—')} · khoảng cách ${Math.round(Number(mine.distance_m))} m · ${inRange ? 'Trong phạm vi' : 'Ngoài phạm vi'}${flag}${acc}`;
    } else if (data?.office) {
      statusEl.textContent = 'Bạn chưa có điểm check-in GPS trong ngày đang xem. GPS: Không có dữ liệu.';
    }
  }

  // ── Registration form interactivity ──
  let pendingWfhProof = null;
  function updateWorktypeChips() {
    document.querySelectorAll('#att-worktype-row .att-chip').forEach(b => {
      b.classList.toggle('active', b.dataset.worktype === regWorkType);
    });
    const bTime = document.getElementById('att-business-time');
    if (bTime) bTime.style.display = regWorkType === 'business' ? 'flex' : 'none';
    const wfhExtra = document.getElementById('att-wfh-extra');
    if (wfhExtra) wfhExtra.style.display = regWorkType === 'wfh' ? 'block' : 'none';
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

  const wfhFileInput = document.getElementById('att-wfh-file');
  if (wfhFileInput) {
    wfhFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const label = document.getElementById('att-wfh-file-label');
      const hint = document.getElementById('att-wfh-uploaded-hint');
      if (label) label.textContent = 'Đang tải lên...';
      try {
        const res = await api.uploadWfhProof(file);
        pendingWfhProof = res;
        if (label) label.textContent = 'Đổi tệp khác';
        if (hint) {
          hint.style.display = 'block';
          hint.innerHTML = `${icon('circleCheck', 'xs')} Đã đính kèm: <b>${esc(res.filename)}</b>`;
        }
        toast('Đã tải minh chứng lên thành công', 'success');
      } catch (err) {
        if (label) label.textContent = 'Chọn tệp / ảnh';
        toast(err.message || 'Lỗi tải tệp lên', 'error');
      }
    });
  }

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
      if (todayRecord && todayRecord.work_type) {
        regWorkType = todayRecord.work_type;
        updateWorktypeChips();
        if (todayRecord.wfh_reason) {
          const rInput = document.getElementById('att-wfh-reason');
          if (rInput && !rInput.value) rInput.value = todayRecord.wfh_reason;
        }
        if (todayRecord.wfh_proof_url) {
          const pInput = document.getElementById('att-wfh-proof-url');
          if (pInput && !pInput.value) pInput.value = todayRecord.wfh_proof_url;
        }
      }
      if (regShifts.size === 0) { regShifts.add('morning'); regShifts.add('afternoon'); }
      updateShiftChips();
      renderClockState();
    } catch(e) {
      document.getElementById('att-status-line').innerHTML = `<span style="font-size:12px;opacity:.7">Lỗi tải trạng thái</span>`;
    }
  }

  function lateEarlyLine(r) {
    const bits = [];
    if (r.late_minutes > 0) bits.push(`<span style="color:#d97706">${icon('clock3', 'xs')} Đi trễ ${r.late_minutes} phút</span>`);
    if (r.early_minutes > 0) bits.push(`<span style="color:#f59e0b">${icon('clock3', 'xs')} Về sớm ${r.early_minutes} phút</span>`);
    return bits.length ? `<div style="font-size:12px;margin-top:2px;">${bits.join(' · ')}</div>` : '';
  }

  function renderClockState() {
  const statusLine = document.getElementById('att-status-line');
  const btnOut = document.getElementById('btn-checkout');
  const noteWrap = document.getElementById('att-note-wrap');
  const regWrap = document.getElementById('att-register-wrap');

  const infoLine = todayRecord
    ? `<div style="font-size:12px;opacity:.8;margin-top:2px;">${WORK_TYPE_LABEL[todayRecord.work_type] || WORK_TYPE_LABEL.office} · ${SHIFT_LABEL_SHORT[todayRecord.shift] || SHIFT_LABEL_SHORT.full}${todayRecord.work_type === 'business' ? ` (${esc(todayRecord.expected_start||'—')}–${esc(todayRecord.expected_end||'—')})` : ''}</div>`
    : '';

  const btnIn = document.getElementById('btn-register');

  const wfhStatusBadge = (r) => {
    if (!r || r.work_type !== 'wfh') return '';
    const st = r.wfh_status || 'approved';
    if (st === 'approved') return `<span class="badge badge-success" style="font-size:11px;padding:3px 8px;">${icon('circleCheck', 'xs')} WFH Đã duyệt${r.wfh_reviewer_name ? ` · ${esc(r.wfh_reviewer_name)}` : ''}</span>`;
    if (st === 'rejected') return `<span class="badge badge-danger" style="font-size:11px;padding:3px 8px;">${icon('circleX', 'xs')} WFH Bị từ chối</span>`;
    return `<span class="badge badge-warning" style="font-size:11px;padding:3px 8px;">${icon('hourglass', 'xs')} WFH Chờ duyệt</span>`;
  };

  const wfhFooterSection = (r) => {
    if (!r || r.work_type !== 'wfh') return '';
    return `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.15);text-align:left;">
        ${r.wfh_reason ? `<div style="font-size:12px;color:#fef08a;margin-bottom:4px;"><b>Lý do WFH:</b> ${esc(r.wfh_reason)}</div>` : ''}
        ${r.wfh_review_note && r.wfh_status === 'rejected' ? `<div style="font-size:12px;color:#fca5a5;margin-bottom:4px;"><b>Lý do từ chối:</b> ${esc(r.wfh_review_note)}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          ${r.wfh_proof_url ? `<button type="button" class="btn-secondary btn-xs btn-view-today-wfh-proof" style="display:inline-flex;align-items:center;gap:4px;">${icon('paperclip', 'xs')} <span>Xem minh chứng</span></button>` : ''}
          <button type="button" class="btn-secondary btn-xs btn-edit-today-wfh-proof" style="display:inline-flex;align-items:center;gap:4px;">${icon('pencil', 'xs')} <span>${r.wfh_proof_url ? 'Cập nhật minh chứng / lý do' : 'Bổ sung minh chứng WFH'}</span></button>
        </div>
      </div>
    `;
  };

  if (!todayRecord || !todayRecord.registered) {
    // Chưa đăng ký: hiện form đăng ký + nút "Đăng ký & Check In"
    statusLine.innerHTML = `<span class="badge badge-gray" style="font-size:12px;">${icon('fileText', 'xs')} Chưa đăng ký hôm nay</span>`;
    if (btnIn) { btnIn.disabled = false; btnIn.style.display = 'inline-flex'; btnIn.innerHTML = `${icon('clock3', 'sm')} <span>Đăng ký & Check In</span>`; }
    btnOut.disabled = true;
    noteWrap.style.display = 'none';
    regWrap.style.display = 'block';
  } else if (todayRecord.checkin_time && todayRecord.checkout_time) {
    // Đã check-out: khóa tất cả
    const workHours = (todayRecord.work_hours || 0).toFixed(1);
    statusLine.innerHTML = `
      <div class="att-checked-card">
        <div class="att-checked-head">
          <span class="badge badge-success" style="font-size:12px;padding:4px 10px;">${icon('circleCheck', 'xs')} Đã hoàn thành ca làm</span>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span class="att-checked-badge">${esc(WORK_TYPE_LABEL[todayRecord.work_type] || 'Văn phòng')} · ${esc(SHIFT_LABEL_SHORT[todayRecord.shift] || 'Cả ngày')}</span>
            ${wfhStatusBadge(todayRecord)}
          </div>
        </div>
        <div class="att-checked-body">
          <div class="att-checked-stat">
            <span>Giờ vào</span>
            <strong>${todayRecord.checkin_time}</strong>
          </div>
          <div class="att-checked-divider">→</div>
          <div class="att-checked-stat">
            <span>Giờ ra</span>
            <strong>${todayRecord.checkout_time}</strong>
          </div>
          <div class="att-checked-divider">·</div>
          <div class="att-checked-stat">
            <span>Tổng giờ làm</span>
            <strong style="color:#10b981;">${workHours} giờ</strong>
          </div>
        </div>
        ${wfhFooterSection(todayRecord)}
        ${lateEarlyLine(todayRecord)}
      </div>`;
    if (btnIn) { btnIn.disabled = true; btnIn.style.display = 'inline-flex'; btnIn.innerHTML = `${icon('circleCheck', 'sm')} <span>Đã Check In</span>`; }
    btnOut.disabled = true;
    noteWrap.style.display = 'none';
    regWrap.style.display = 'none';
  } else if (todayRecord.checkin_time) {
    // Đã check-in: mở check-out, hiển thị thẻ thông tin ca làm việc sang trọng
    statusLine.innerHTML = `
      <div class="att-checked-card">
        <div class="att-checked-head">
          <span class="badge badge-warning" style="font-size:12px;padding:4px 10px;">${icon('clock3', 'xs')} Đang trong ca làm việc</span>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span class="att-checked-badge">${esc(WORK_TYPE_LABEL[todayRecord.work_type] || 'Văn phòng')} · ${esc(SHIFT_LABEL_SHORT[todayRecord.shift] || 'Cả ngày')}</span>
            ${wfhStatusBadge(todayRecord)}
          </div>
        </div>
        <div class="att-checked-body">
          <div class="att-checked-stat">
            <span>Giờ check-in</span>
            <strong style="color:#38bdf8;">${todayRecord.checkin_time}</strong>
          </div>
          <div class="att-checked-stat">
            <span>Hình thức</span>
            <strong>${esc(WORK_TYPE_LABEL[todayRecord.work_type] || 'Văn phòng')}</strong>
          </div>
          <div class="att-checked-stat">
            <span>Ca làm</span>
            <strong>${esc(SHIFT_LABEL_SHORT[todayRecord.shift] || 'Cả ngày')}</strong>
          </div>
        </div>
        <div class="att-checked-footer">
          <small>● Bạn đã hoàn thành chấm công đầu ngày. Bấm <b>Check Out</b> bên dưới khi kết thúc ca làm.</small>
          ${wfhFooterSection(todayRecord)}
        </div>
        ${lateEarlyLine(todayRecord)}
      </div>`;
    if (btnIn) { btnIn.disabled = true; btnIn.style.display = 'inline-flex'; btnIn.innerHTML = `${icon('circleCheck', 'sm')} <span>Đã Check In</span>`; }
    btnOut.disabled = false;
    noteWrap.style.display = 'none';
    regWrap.style.display = 'none';
  } else {
    // Đã đăng ký nhưng chưa check-in
    statusLine.innerHTML = `<span class="badge badge-info" style="font-size:12px;">${icon('mapPin', 'xs')} Đã đăng ký — sẵn sàng check in</span>${infoLine}`;
    if (btnIn) { btnIn.disabled = false; btnIn.style.display = 'inline-flex'; btnIn.innerHTML = `${icon('clock3', 'sm')} <span>Check In</span>`; }
    btnOut.disabled = true;
    noteWrap.style.display = 'block';
    regWrap.style.display = 'block';
  }

  statusLine.querySelector('.btn-view-today-wfh-proof')?.addEventListener('click', () => {
    viewProofModal(todayRecord.wfh_proof_url, todayRecord.wfh_proof_filename);
  });
  statusLine.querySelector('.btn-edit-today-wfh-proof')?.addEventListener('click', () => {
    openWfhProofModal(todayRecord);
  });
}

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
  if (needsRegistration && regWorkType === 'wfh') {
    const wfhReason = document.getElementById('att-wfh-reason')?.value?.trim();
    if (!wfhReason) {
      toast('Vui lòng nhập lý do làm việc tại nhà (WFH)', 'error');
      document.getElementById('att-wfh-reason')?.focus();
      return;
    }
  }

  // Xác nhận
  const shiftLabel = resolvedShift() === 'full' ? 'Cả ngày' : resolvedShift() === 'morning' ? 'Ca sáng' : 'Ca chiều';
  const workTypeLabel = WORK_TYPE_LABEL[regWorkType] || regWorkType;
  const actionLabel = needsRegistration ? 'Đăng ký & Check In' : 'Check In';
  const confirmMsg = needsRegistration
    ? `Xác nhận ${actionLabel}?\n\nHình thức: ${workTypeLabel}\nCa làm: ${shiftLabel}${regWorkType === 'wfh' ? '\n(Yêu cầu WFH sẽ được gửi cho HR/Quản lý phê duyệt)' : ''}`
    : `Xác nhận Check In lúc này?`;
  if (!confirm(confirmMsg)) return;

  submitting = true; btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    if (needsRegistration) {
      // Bước 1: Đăng ký
      const wfhReason = regWorkType === 'wfh' ? document.getElementById('att-wfh-reason')?.value?.trim() : undefined;
      const wfhProofUrl = regWorkType === 'wfh' ? (document.getElementById('att-wfh-proof-url')?.value?.trim() || pendingWfhProof?.file_url || undefined) : undefined;
      const wfhProofFilename = regWorkType === 'wfh' ? (pendingWfhProof?.filename || undefined) : undefined;
      const wfhProofDocId = regWorkType === 'wfh' ? (pendingWfhProof?.document_id || undefined) : undefined;
      await api.registerAttendance({
        work_type: regWorkType,
        shift: resolvedShift(),
        expected_start: regWorkType === 'business' ? document.getElementById('att-exp-start').value : undefined,
        expected_end: regWorkType === 'business' ? document.getElementById('att-exp-end').value : undefined,
        wfh_reason: wfhReason,
        wfh_proof_url: wfhProofUrl,
        wfh_proof_filename: wfhProofFilename,
        wfh_proof_document_id: wfhProofDocId,
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
      toast(`Check-in đã được ghi nhận · Bạn đang ngoài phạm vi ${gf?.location?.name || 'văn phòng'} — Khoảng cách: ${dist} m · Bán kính cho phép: ${lim} m — Lượt chấm công này sẽ được gửi để quản trị viên xem xét.`, 'warning', 6500);
    } else {
      toast(needsRegistration ? 'Đăng ký & Check In thành công!' : 'Check in thành công!', 'success');
    }
    await loadTodayStatus();
    loadHistory();
  } catch(e) {
    toast(e.message || 'Lỗi', 'error');
    btn.disabled = false;
    btn.innerHTML = `${icon('clock3', 'sm')} <span>${actionLabel}</span>`;
  } finally {
    submitting = false;
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
      btnOut.disabled = false; btnOut.innerHTML = `${icon('logOut', 'sm')} <span>Check Out</span>`;
    } finally {
      submitting = false;
    }
  });

  let historyPage = 1;
  let otFormPage = 1;
  let overtimeForms = [];

  const formStatus = status => ({
    draft: '<span class="badge badge-gray">Nháp</span>',
    pending: '<span class="badge badge-step1">Chờ HCNS duyệt (B1)</span>',
    pending_director: '<span class="badge badge-step2">Chờ anh Hậu duyệt (B2)</span>',
    approved: '<span class="badge badge-success">Đã duyệt</span>',
    partially_approved: '<span class="badge badge-info">Duyệt một phần</span>',
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
        const detail = form.items.map(item => `
          <div class="ot-item-cell" style="display:flex;flex-direction:column;gap:3px;max-width:380px;">
            <div style="font-weight:600;font-size:12.5px;color:var(--text);">${esc(item.start_at.replace('T', ' '))} → ${esc(item.end_at.replace('T', ' '))}</div>
            <div style="font-size:12px;color:var(--text-2);line-height:1.4;">${esc(item.reason)} · <span class="badge badge-gray" style="font-size:11px;padding:1px 6px;">${item.time_category === 'holiday' ? 'Ngày lễ' : item.time_category === 'rest_day' ? 'Ngày nghỉ' : 'Ngày thường'}</span></div>
          </div>
        `).join('<hr style="border:0;border-top:1px solid var(--border);margin:7px 0">');
        const minutes = `${(Number(form.requested_minutes || 0) / 60).toFixed(2)}h${form.status !== 'draft' ? ` / ${(Number(form.approved_minutes || 0) / 60).toFixed(2)}h` : ''}`;
        const isPendingB1 = form.status === 'pending';
        const isPendingB2 = form.status === 'pending_director';
        const canSubmit = Number(form.user_id) === Number(me.id) && form.status === 'draft';
        
        let actionButtons = '';
        if (isPendingB1) {
          if (isHau) {
            actionButtons = `<button class="btn-primary btn-sm ot-form-decide" data-id="${form.id}" data-step="director" title="Duyệt thẳng (TGĐ)">Duyệt chốt</button>`;
          } else if (canManageAttendance) {
            actionButtons = `<button class="btn-secondary btn-sm ot-form-decide" data-id="${form.id}" data-step="step1" title="Duyệt Bước 1">Duyệt B1</button>`;
          }
        } else if (isPendingB2) {
          if (isHau) {
            actionButtons = `<button class="btn-primary btn-sm ot-form-decide" data-id="${form.id}" data-step="director" title="Phê duyệt cuối cùng">Duyệt B2 (Chốt)</button>`;
          } else {
            actionButtons = `<span style="color:var(--text-3);font-size:12px;">Chờ anh Hậu duyệt</span>`;
          }
        }
        if (canSubmit) {
          actionButtons += `${actionButtons ? ' ' : ''}<button class="btn-primary btn-sm ot-form-submit" data-id="${form.id}">Gửi</button>`;
        }
        if (form.reviewer_name) {
          actionButtons += `<small style="color:var(--text-2);display:block;margin-top:2px;">Duyệt: ${esc(form.reviewer_name)}</small>`;
        } else if (form.step1_reviewer_name) {
          actionButtons += `<small style="color:var(--text-2);display:block;margin-top:2px;">B1: ${esc(form.step1_reviewer_name)}</small>`;
        }

        return `<tr><td><b>${esc(form.full_name)}</b><br><small style="color:var(--text-2);font-size:11.5px;">${esc(form.employee_code || '')}</small></td><td>${detail}</td><td><strong>${minutes}</strong></td><td>${formStatus(form.status)}${form.review_note ? `<br><small style="color:var(--text-2);">${esc(form.review_note)}</small>` : ''}</td><td>${actionButtons || '—'}</td></tr>`;
      }).join('')}</tbody></table></div>${paginationHTML(pageData)}` : emptyHTML('fileText', 'Chưa có form làm thêm giờ trong kỳ này');
      bindPagination(list, page => { otFormPage = page; loadOvertimeForms(); });
      list.querySelectorAll('.ot-form-decide').forEach(button => button.addEventListener('click', () => openOvertimeFormDecision(Number(button.dataset.id))));
      list.querySelectorAll('.ot-form-submit').forEach(button => button.addEventListener('click', async () => {
        try { await api.submitOvertimeForm(button.dataset.id); toast('Đã gửi form OT chờ duyệt', 'success'); loadOvertimeForms(); }
        catch (error) { toast(error.message, 'error'); }
      }));
    } catch (error) { list.innerHTML = emptyHTML('triangleAlert', error.message || 'Không thể tải form OT'); }
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
    const isPendingB1 = form.status === 'pending';
    const isFinalStep = form.status === 'pending_director' || isHau;
    const modalTitle = isFinalStep ? 'Phê duyệt cuối cùng (Phó Tổng Giám Đốc) - Form OT' : 'Duyệt Bước 1 (HCNS) - Form OT';
    const approveBtnLabel = isFinalStep ? 'Phê duyệt chốt' : 'Duyệt Bước 1';

    const rows = form.items.map(item => `<tr><td>${esc(item.start_at.replace('T', ' '))}<br>${esc(item.end_at.replace('T', ' '))}</td><td>${esc(item.reason)}</td><td>${Number(item.requested_minutes)} phút</td><td><input class="ot-form-approved" data-id="${item.id}" type="number" min="0" max="${item.requested_minutes}" value="${item.requested_minutes}"/></td></tr>`).join('');
    openModal(modalTitle, `<div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Lý do</th><th>Đề nghị</th><th>Duyệt phút</th></tr></thead><tbody>${rows}</tbody></table></div><div class="field"><label>Ghi chú duyệt/từ chối</label><textarea id="ot-form-review-note" rows="3"></textarea></div>`, `<button class="btn-danger" id="ot-form-reject">Từ chối</button><button class="btn-primary" id="ot-form-approve">${approveBtnLabel}</button>`);
    const decide = async action => {
      const review_note = document.getElementById('ot-form-review-note').value.trim();
      if (action === 'reject' && !review_note) { toast('Vui lòng nhập lý do từ chối', 'error'); return; }
      const items = [...document.querySelectorAll('.ot-form-approved')].map(input => ({ id: Number(input.dataset.id), approved_minutes: Number(input.value) }));
      try {
        const res = await api.decideOvertimeForm(form.id, { action, review_note, items });
        closeModal();
        if (res.final === false) {
          toast('Đã duyệt bước 1 (HCNS), chuyển tiếp tới anh Hậu duyệt chốt', 'success');
        } else {
          toast(action === 'approve' ? 'Đã phê duyệt hoàn tất form OT' : 'Đã từ chối form OT', 'success');
        }
        loadOvertimeForms();
        loadHistory();
      } catch (error) { toast(error.message, 'error'); }
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

  function viewProofModal(url, filename) {
    if (!url) return;
    const isImage = /\.(jpeg|jpg|png|webp|gif)($|\?)/i.test(url) || /\/wfh-proof\/[0-9a-fA-F-]+$/i.test(url);
    const isPdf = /\.pdf($|\?)/i.test(url);
    const isExternal = /^https?:\/\//i.test(url) && !url.includes(location.host);

    if (isExternal) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    openModal(`Minh chứng WFH: ${esc(filename || 'Tài liệu')}`, `
      <div style="text-align:center;max-height:70vh;overflow:auto;padding:10px;">
        ${isPdf
          ? `<iframe src="${esc(url)}" style="width:100%;height:500px;border:none;border-radius:6px;"></iframe>`
          : `<img src="${esc(url)}" alt="Minh chứng" style="max-width:100%;max-height:65vh;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);" onerror="this.outerHTML='<p style=\\'color:var(--text-2)\\'>Không thể hiển thị ảnh trực tiếp. <a href=\\'${esc(url)}\\' target=\\'_blank\\' class=\\'btn-secondary btn-sm\\' style=\\'margin-top:8px;display:inline-block;\\'>Mở trong tab mới</a></p>'"/>`
        }
      </div>
    `, `<a href="${esc(url)}" target="_blank" download="${esc(filename || 'minh-chung')}" class="btn-secondary">${icon('download', 'xs')} <span>Tải xuống</span></a><button class="btn-primary" id="wfh-proof-close">Đóng</button>`);
    document.getElementById('wfh-proof-close')?.addEventListener('click', closeModal);
  }

  function openWfhProofModal(record) {
    if (!record) return;
    let newUploadProof = null;
    const isReapplying = record.wfh_status === 'rejected';
    openModal(
      isReapplying ? `Bổ sung giải trình WFH - Ngày ${record.date}` : `Cập nhật minh chứng WFH - Ngày ${record.date}`,
      `
        ${isReapplying ? `<div class="alert alert-warning" style="margin-bottom:12px;font-size:12.5px;padding:8px 12px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:6px;color:#fef08a;">
          ${icon('triangleAlert', 'xs')} <b>Đơn này đã bị từ chối</b>: ${esc(record.wfh_review_note || 'Chưa rõ lý do')}. Bạn có thể cập nhật lại lý do và bổ sung minh chứng để gửi HR xem xét lại.
        </div>` : ''}
        <div class="field" style="margin-bottom:10px;">
          <label style="font-weight:600;">Lý do WFH *</label>
          <textarea id="modal-wfh-reason" rows="3" placeholder="Nhập lý do làm việc tại nhà..." style="width:100%;padding:8px 10px;border-radius:6px;">${esc(record.wfh_reason || '')}</textarea>
        </div>
        <div class="field" style="margin-bottom:10px;">
          <label style="font-weight:600;">Minh chứng đính kèm</label>
          ${record.wfh_proof_url ? `
            <div style="margin-bottom:6px;font-size:12px;">
              Đang có: <button type="button" class="btn-secondary btn-xs" id="modal-wfh-view-current">${icon('paperclip', 'xs')} <span>Xem tệp hiện tại (${esc(record.wfh_proof_filename || 'Tài liệu')})</span></button>
            </div>
          ` : ''}
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <label class="btn-secondary btn-sm" style="cursor:pointer;margin:0;display:inline-flex;align-items:center;gap:4px;">
              ${icon('upload', 'xs')} <span id="modal-wfh-file-label">Tải lên tệp mới</span>
              <input type="file" id="modal-wfh-file" accept="image/*,application/pdf" style="display:none;"/>
            </label>
            <input type="text" id="modal-wfh-proof-url" value="${esc(record.wfh_proof_url || '')}" placeholder="Hoặc dán link tài liệu..." style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;"/>
          </div>
          <div id="modal-wfh-hint" style="display:none;font-size:11.5px;color:var(--success);margin-top:4px;"></div>
        </div>
      `,
      `<button class="btn-secondary" id="modal-wfh-cancel">Hủy</button><button class="btn-primary" id="modal-wfh-save">${isReapplying ? 'Gửi duyệt lại' : 'Lưu thay đổi'}</button>`
    );
    document.getElementById('modal-wfh-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-wfh-view-current')?.addEventListener('click', () => {
      viewProofModal(record.wfh_proof_url, record.wfh_proof_filename);
    });
    document.getElementById('modal-wfh-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const label = document.getElementById('modal-wfh-file-label');
      const hint = document.getElementById('modal-wfh-hint');
      if (label) label.textContent = 'Đang tải lên...';
      try {
        const res = await api.uploadWfhProof(file);
        newUploadProof = res;
        if (label) label.textContent = 'Đổi tệp';
        if (hint) {
          hint.style.display = 'block';
          hint.innerHTML = `${icon('circleCheck', 'xs')} Đã tải lên: <b>${esc(res.filename)}</b>`;
        }
        toast('Đã tải minh chứng lên thành công', 'success');
      } catch (err) {
        if (label) label.textContent = 'Tải lên tệp mới';
        toast(err.message || 'Lỗi tải tệp lên', 'error');
      }
    });
    document.getElementById('modal-wfh-save')?.addEventListener('click', async () => {
      const reason = document.getElementById('modal-wfh-reason')?.value.trim() || '';
      if (!reason) { toast('Vui lòng nhập lý do WFH', 'error'); return; }
      const proofUrl = newUploadProof?.file_url || document.getElementById('modal-wfh-proof-url')?.value.trim() || record.wfh_proof_url || null;
      const proofFilename = newUploadProof?.filename || record.wfh_proof_filename || null;
      const proofDocId = newUploadProof?.document_id || record.wfh_proof_document_id || null;
      try {
        await api.updateWfhProof(record.id, {
          wfh_reason: reason,
          wfh_proof_url: proofUrl,
          wfh_proof_filename: proofFilename,
          wfh_proof_document_id: proofDocId,
        });
        closeModal();
        toast(isReapplying ? 'Đã gửi lại yêu cầu WFH để HR xem xét' : 'Đã cập nhật minh chứng WFH', 'success');
        loadTodayStatus();
        loadHistory();
        if (canManageAttendance) loadWfhRequests();
      } catch (err) {
        toast(err.message || 'Không thể cập nhật', 'error');
      }
    });
  }

  async function loadWfhRequests() {
    const list = document.getElementById('wfh-request-list');
    if (!list) return;
    try {
      const month = document.getElementById('att-month-filter')?.value || closingMonth;
      const status = document.getElementById('wfh-status-filter')?.value || '';
      const { wfh_requests: rows = [] } = await api.getWfhRequests({ month, status });
      list.innerHTML = rows.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Ngày & Ca</th>
                <th>Check-in / Check-out</th>
                <th>Giờ làm</th>
                <th>Lý do WFH</th>
                <th>Minh chứng</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const shiftText = SHIFT_LABEL_SHORT[r.shift] || SHIFT_LABEL_SHORT.full;
                const hoursText = r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : '—';
                const inOutText = `${esc(r.checkin_time || '—')} / ${esc(r.checkout_time || '—')}`;
                const proofHtml = r.wfh_proof_url
                  ? `<button type="button" class="btn-secondary btn-xs btn-wfh-table-proof" data-url="${esc(r.wfh_proof_url)}" data-filename="${esc(r.wfh_proof_filename || 'Minh chứng')}" style="display:inline-flex;align-items:center;gap:4px;">${icon('paperclip', 'xs')} <span>Xem minh chứng</span></button>`
                  : '<span style="color:var(--text-3);font-size:12px;">Không có</span>';
                
                let statusBadgeHtml = '';
                if (r.wfh_status === 'pending') {
                  statusBadgeHtml = '<span class="badge badge-step1">Chờ duyệt B1 (HCNS)</span>';
                } else if (r.wfh_status === 'pending_director') {
                  statusBadgeHtml = `<span class="badge badge-step2">Chờ anh Hậu duyệt (B2)</span>${r.wfh_step1_reviewer_name ? `<br><small style="color:var(--text-2);font-size:11px;">B1: ${esc(r.wfh_step1_reviewer_name)}</small>` : ''}`;
                } else if (r.wfh_status === 'approved') {
                  statusBadgeHtml = `<span class="badge badge-success">Đã duyệt</span>${r.wfh_reviewer_name ? `<br><small style="color:var(--text-2);font-size:11px;">${esc(r.wfh_reviewer_name)}</small>` : ''}`;
                } else {
                  statusBadgeHtml = `<span class="badge badge-danger">Từ chối</span>${r.wfh_review_note ? `<br><small style="color:var(--danger);font-size:11px;">Lý do: ${esc(r.wfh_review_note)}</small>` : ''}`;
                }

                let actionHtml = '';
                if (r.wfh_status === 'pending') {
                  if (isHau) {
                    actionHtml = `<button class="btn-primary btn-sm wfh-decide" data-id="${r.id}" data-status="pending" data-action="approve">Duyệt chốt</button> <button class="btn-danger btn-sm wfh-decide" data-id="${r.id}" data-status="pending" data-action="reject">Từ chối</button>`;
                  } else {
                    actionHtml = `<button class="btn-secondary btn-sm wfh-decide" data-id="${r.id}" data-status="pending" data-action="approve">Duyệt B1</button> <button class="btn-danger btn-sm wfh-decide" data-id="${r.id}" data-status="pending" data-action="reject">Từ chối</button>`;
                  }
                } else if (r.wfh_status === 'pending_director') {
                  if (isHau) {
                    actionHtml = `<button class="btn-primary btn-sm wfh-decide" data-id="${r.id}" data-status="pending_director" data-action="approve">Duyệt B2 (Chốt)</button> <button class="btn-danger btn-sm wfh-decide" data-id="${r.id}" data-status="pending_director" data-action="reject">Từ chối</button>`;
                  } else {
                    actionHtml = `<span style="color:var(--text-3);font-size:12px;">Chờ anh Hậu duyệt</span> <button class="btn-danger btn-xs wfh-decide" data-id="${r.id}" data-status="pending_director" data-action="reject" title="Từ chối">Từ chối</button>`;
                  }
                } else {
                  if (isHau || me.role === 'admin') {
                    actionHtml = `<button class="btn-secondary btn-xs wfh-decide" data-id="${r.id}" data-status="${r.wfh_status}" data-action="${r.wfh_status === 'approved' ? 'reject' : 'approve'}" title="Đổi quyết định">${r.wfh_status === 'approved' ? 'Hủy duyệt' : 'Duyệt lại'}</button>`;
                  } else {
                    actionHtml = `<span style="color:var(--text-3);font-size:12px;">—</span>`;
                  }
                }

                return `
                  <tr>
                    <td><b>${esc(r.full_name)}</b><br><small style="color:var(--text-2);font-size:11.5px;">${esc(r.employee_code || '')} · ${esc(r.department || '')}</small></td>
                    <td style="white-space:nowrap;"><b>${esc(fmtDate(r.date))}</b><br><small style="color:var(--text-2);">${esc(shiftText)}</small></td>
                    <td style="white-space:nowrap;">${inOutText}</td>
                    <td><strong>${hoursText}</strong></td>
                    <td style="max-width:240px;word-break:break-word;">${esc(r.wfh_reason || '—')}</td>
                    <td>${proofHtml}</td>
                    <td>${statusBadgeHtml}</td>
                    <td style="white-space:nowrap;">${actionHtml}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : emptyHTML('home', 'Không có yêu cầu duyệt WFH');
      list.querySelectorAll('.btn-wfh-table-proof').forEach(btn => {
        btn.addEventListener('click', () => viewProofModal(btn.dataset.url, btn.dataset.filename));
      });
      list.querySelectorAll('.wfh-decide').forEach(btn => {
        btn.addEventListener('click', () => openWfhDecision(btn.dataset));
      });
    } catch (e) {
      list.innerHTML = emptyHTML('triangleAlert', e.message || 'Không thể tải yêu cầu WFH');
    }
  }

  function openWfhDecision(data) {
    const approving = data.action === 'approve';
    const isStep1 = data.status === 'pending' && !isHau;
    const title = approving
      ? (isStep1 ? 'Duyệt bước 1 (HCNS) yêu cầu WFH' : 'Duyệt chốt (Anh Hậu) yêu cầu WFH')
      : 'Từ chối yêu cầu WFH';
    const confirmText = approving
      ? (isStep1 ? 'Xác nhận duyệt B1' : 'Phê duyệt chốt')
      : 'Từ chối WFH';
    openModal(
      title,
      `
        <div class="field">
          <label style="font-weight:600;">${approving ? 'Ghi chú phê duyệt (tuỳ chọn)' : 'Lý do từ chối *'}</label>
          <textarea id="wfh-review-note" rows="3" placeholder="${approving ? (isStep1 ? 'Ghi chú chuyển tiếp tới anh Hậu / nhân viên...' : 'Ghi chú thêm cho nhân viên nếu có...') : 'Nhập lý do từ chối yêu cầu WFH (bắt buộc)...'}"></textarea>
        </div>
      `,
      `<button class="btn-secondary" id="wfh-decision-cancel">Hủy</button><button class="${approving ? 'btn-primary' : 'btn-danger'}" id="wfh-decision-confirm">${confirmText}</button>`
    );
    document.getElementById('wfh-decision-cancel')?.addEventListener('click', closeModal);
    document.getElementById('wfh-decision-confirm')?.addEventListener('click', async () => {
      const review_note = document.getElementById('wfh-review-note')?.value.trim() || '';
      if (!approving && !review_note) {
        toast('Vui lòng nhập lý do từ chối WFH', 'error');
        return;
      }
      try {
        const res = await api.decideWfhRequest(data.id, { action: data.action, review_note });
        closeModal();
        if (approving) {
          if (res?.final === false) {
            toast('Đã duyệt bước 1 (HCNS), đã chuyển tiếp tới anh Hậu duyệt chốt', 'success');
          } else {
            toast('Đã phê duyệt chốt yêu cầu WFH thành công', 'success');
          }
        } else {
          toast('Đã từ chối yêu cầu WFH', 'success');
        }
        loadWfhRequests();
        loadHistory();
      } catch (e) {
        toast(e.message || 'Không thể xử lý yêu cầu WFH', 'error');
      }
    });
  }

  async function loadOvertimeRequests() {
    const list = document.getElementById('ot-request-list');
    if (!list) return;
    try {
      const month = document.getElementById('att-month-filter')?.value || closingMonth;
      const status = document.getElementById('ot-status-filter')?.value || '';
      const { overtime_requests: rows = [] } = await api.getOvertimeRequests({ month, status });
      list.innerHTML = rows.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Ngày</th>
                <th>Checkout / hết ca</th>
                <th>Đề nghị</th>
                <th>Lý do</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                let statusBadgeHtml = '';
                if (r.status === 'pending') {
                  statusBadgeHtml = '<span class="badge badge-step1">Chờ duyệt B1 (HCNS)</span>';
                } else if (r.status === 'pending_director') {
                  statusBadgeHtml = `<span class="badge badge-step2">Chờ anh Hậu duyệt (B2)</span>${r.step1_reviewer_name ? `<br><small style="color:var(--text-2);font-size:11px;">B1: ${esc(r.step1_reviewer_name)}</small>` : ''}`;
                } else if (r.status === 'approved') {
                  statusBadgeHtml = `<span class="badge badge-success">Đã duyệt</span>${r.reviewer_name ? `<br><small style="color:var(--text-2);font-size:11px;">${esc(r.reviewer_name)}</small>` : ''}`;
                } else {
                  statusBadgeHtml = `<span class="badge badge-danger">Từ chối</span>${r.review_note ? `<br><small style="color:var(--danger);font-size:11px;">Lý do: ${esc(r.review_note)}</small>` : ''}`;
                }

                let actionHtml = '';
                if (r.status === 'pending') {
                  if (isHau) {
                    actionHtml = `<button class="btn-primary btn-sm ot-decide" data-id="${r.id}" data-status="pending" data-minutes="${r.requested_minutes}" data-action="approve">Duyệt chốt</button> <button class="btn-danger btn-sm ot-decide" data-id="${r.id}" data-status="pending" data-minutes="${r.requested_minutes}" data-action="reject">Từ chối</button>`;
                  } else {
                    actionHtml = `<button class="btn-secondary btn-sm ot-decide" data-id="${r.id}" data-status="pending" data-minutes="${r.requested_minutes}" data-action="approve">Duyệt B1</button> <button class="btn-danger btn-sm ot-decide" data-id="${r.id}" data-status="pending" data-minutes="${r.requested_minutes}" data-action="reject">Từ chối</button>`;
                  }
                } else if (r.status === 'pending_director') {
                  if (isHau) {
                    actionHtml = `<button class="btn-primary btn-sm ot-decide" data-id="${r.id}" data-status="pending_director" data-minutes="${r.requested_minutes}" data-action="approve">Duyệt B2 (Chốt)</button> <button class="btn-danger btn-sm ot-decide" data-id="${r.id}" data-status="pending_director" data-action="reject">Từ chối</button>`;
                  } else {
                    actionHtml = `<span style="color:var(--text-3);font-size:12px;">Chờ anh Hậu duyệt</span> <button class="btn-danger btn-xs ot-decide" data-id="${r.id}" data-status="pending_director" data-action="reject" title="Từ chối">Từ chối</button>`;
                  }
                } else {
                  actionHtml = esc(r.reviewer_name || '—');
                }

                return `
                  <tr>
                    <td><b>${esc(r.full_name)}</b><br><small style="color:var(--text-2);font-size:11.5px;">${esc(r.employee_code || '')} · ${esc(r.department || '')}</small></td>
                    <td style="white-space:nowrap;">${esc(fmtDate(r.work_date))}</td>
                    <td style="white-space:nowrap;">${esc(r.checkout_time)} / ${esc(r.shift_end_time)}</td>
                    <td>${r.requested_minutes} phút${r.approved_minutes != null ? `<br><small style="color:var(--success);font-size:11px;">Duyệt: ${r.approved_minutes} phút</small>` : ''}</td>
                    <td style="max-width:220px;word-break:break-word;">${esc(r.reason)}</td>
                    <td>${statusBadgeHtml}</td>
                    <td style="white-space:nowrap;">${actionHtml}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : emptyHTML('clock3', 'Không có yêu cầu làm thêm giờ');
      list.querySelectorAll('.ot-decide').forEach(btn => btn.addEventListener('click', () => openOvertimeDecision(btn.dataset)));
    } catch (e) { list.innerHTML = emptyHTML('triangleAlert', e.message || 'Không thể tải yêu cầu OT'); }
  }

  function openOvertimeDecision(data) {
    const approving = data.action === 'approve';
    const isStep1 = data.status === 'pending' && !isHau;
    const title = approving
      ? (isStep1 ? 'Duyệt bước 1 (HCNS) làm thêm giờ' : 'Duyệt chốt (Anh Hậu) làm thêm giờ')
      : 'Từ chối làm thêm giờ';
    const confirmText = approving
      ? (isStep1 ? 'Duyệt B1' : 'Duyệt OT (Chốt)')
      : 'Từ chối';

    openModal(
      title,
      `${approving ? `<div class="field"><label style="font-weight:600;">Số phút được duyệt</label><input type="number" id="ot-approved-minutes" min="1" max="${data.minutes}" value="${data.minutes}"/></div>` : ''}<div class="field"><label style="font-weight:600;">${approving ? 'Ghi chú (tuỳ chọn)' : 'Lý do từ chối *'}</label><textarea id="ot-review-note" rows="3" placeholder="${approving ? (isStep1 ? 'Ghi chú chuyển anh Hậu / nhân viên...' : 'Ghi chú...') : 'Lý do từ chối (bắt buộc)...'}"></textarea></div>`,
      `<button class="btn-secondary" id="ot-cancel">Hủy</button><button class="${approving ? 'btn-primary' : 'btn-danger'}" id="ot-confirm">${confirmText}</button>`
    );
    document.getElementById('ot-cancel')?.addEventListener('click', closeModal);
    document.getElementById('ot-confirm')?.addEventListener('click', async () => {
      const review_note = document.getElementById('ot-review-note')?.value.trim() || '';
      if (!approving && !review_note) { toast('Vui lòng nhập lý do từ chối', 'error'); return; }
      try {
        const res = await api.decideOvertimeRequest(data.id, data.action, {
          approved_minutes: approving ? Number(document.getElementById('ot-approved-minutes')?.value || data.minutes) : 0,
          review_note,
        });
        closeModal();
        if (approving) {
          if (res?.final === false) {
            toast('Đã duyệt bước 1 (HCNS), chuyển tới anh Hậu duyệt chốt', 'success');
          } else {
            toast('Đã duyệt làm thêm giờ thành công', 'success');
          }
        } else {
          toast('Đã từ chối yêu cầu làm thêm giờ', 'success');
        }
        loadOvertimeRequests();
        loadHistory();
      } catch (e) {
        toast(e.message || 'Không thể xử lý yêu cầu OT', 'error');
      }
    });
  }
  document.getElementById('wfh-status-filter')?.addEventListener('change', loadWfhRequests);
  document.getElementById('ot-status-filter')?.addEventListener('change', loadOvertimeRequests);
  document.getElementById('btn-create-ot-form')?.addEventListener('click', openOvertimeFormCreator);
  document.getElementById('btn-import-att')?.addEventListener('click', openHistoricalImport);
  if (canManageAttendance) { loadOvertimeRequests(); loadWfhRequests(); }
  loadOvertimeForms();



  // Month filter
  document.getElementById('att-month-filter').addEventListener('change', () => { historyPage = 1; otFormPage = 1; loadHistory(); loadOvertimeForms(); if (canManageAttendance) { loadOvertimeRequests(); loadWfhRequests(); } });
  document.getElementById('att-date-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-search')?.addEventListener('input', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-dept-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });
  document.getElementById('att-location-filter')?.addEventListener('change', () => { historyPage = 1; loadHistory(); });

  function statusWithMinutes(a) {
    const awaitingCheckin = Number(a.registered) === 1 && !a.checkin_time && !['absent', 'leave', 'cancelled', 'rejected'].includes(a.status);
    const badge = awaitingCheckin ? `<span class="badge badge-info">${icon('fileText', 'xs')} Đã đăng ký · chưa check-in</span>` : statusBadge(a.status);
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
      if (content) content.innerHTML = emptyHTML('triangleAlert', error.message || 'Không thể tải bảng chấm công tổng hợp');
    }
  }

  async function openOvertimeSummaryBoard() {
    const monthValue = document.getElementById('att-month-filter')?.value || closingMonth;
    const [year, month] = monthValue.split('-').map(Number);
    openModal(`Bảng tổng hợp làm thêm giờ (OT) Tháng ${String(month).padStart(2, '0')}/${year}`, `<div id="ot-summary-board-content">${loadingHTML()}</div>`, `<button class="btn-secondary" id="ot-summary-board-close">Đóng</button>`);
    document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--attendance-board');
    document.getElementById('ot-summary-board-close')?.addEventListener('click', closeModal);

    try {
      const { overtime_forms: forms = [] } = await api.getOvertimeForms({ month: monthValue });
      const content = document.getElementById('ot-summary-board-content');
      if (!content) return;

      if (!forms.length) {
        content.innerHTML = emptyHTML('fileText', `Chưa có dữ liệu làm thêm giờ trong tháng ${String(month).padStart(2, '0')}/${year}`);
        return;
      }

      // Aggregate by user
      const userMap = new Map();
      let grandTotalRequestedMinutes = 0;
      let grandTotalApprovedMinutes = 0;

      forms.forEach(form => {
        const uid = Number(form.user_id);
        if (!userMap.has(uid)) {
          userMap.set(uid, {
            userId: uid,
            fullName: form.full_name || '—',
            employeeCode: form.employee_code || '—',
            department: form.department || '—',
            totalForms: 0,
            approvedForms: 0,
            pendingForms: 0,
            rejectedForms: 0,
            draftForms: 0,
            totalRequestedMinutes: 0,
            totalApprovedMinutes: 0,
            workdayApprovedMinutes: 0,
            restdayApprovedMinutes: 0,
            holidayApprovedMinutes: 0,
            forms: [],
          });
        }
        const u = userMap.get(uid);
        u.totalForms++;
        if (form.status === 'approved' || form.status === 'partially_approved') u.approvedForms++;
        else if (form.status === 'pending') u.pendingForms++;
        else if (form.status === 'rejected') u.rejectedForms++;
        else if (form.status === 'draft') u.draftForms++;

        const reqMin = Number(form.requested_minutes || 0);
        const appMin = Number(form.approved_minutes || 0);
        u.totalRequestedMinutes += reqMin;
        u.totalApprovedMinutes += appMin;
        grandTotalRequestedMinutes += reqMin;
        grandTotalApprovedMinutes += appMin;

        (form.items || []).forEach(item => {
          const itemAppMin = Number(item.approved_minutes || 0);
          if (itemAppMin > 0) {
            if (item.time_category === 'holiday') u.holidayApprovedMinutes += itemAppMin;
            else if (item.time_category === 'rest_day' || item.time_category === 'weekend') u.restdayApprovedMinutes += itemAppMin;
            else u.workdayApprovedMinutes += itemAppMin;
          }
        });

        u.forms.push(form);
      });

      const userList = Array.from(userMap.values()).sort((a, b) => b.totalApprovedMinutes - a.totalApprovedMinutes || compareVietnameseNames(a.fullName, b.fullName));

      const formatHours = min => (Number(min || 0) / 60).toFixed(2) + 'h';
      const formatTime = v => v ? new Date(v).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const timeCatLabel = c => c === 'holiday' ? '<span class="badge badge-danger">Ngày lễ</span>' : c === 'rest_day' || c === 'weekend' ? '<span class="badge badge-warning">Ngày nghỉ</span>' : '<span class="badge badge-gray">Ngày thường</span>';

      const renderBoard = (filterText = '', deptFilter = '') => {
        let filtered = userList;
        if (filterText) {
          const s = filterText.toLowerCase();
          filtered = filtered.filter(u => u.fullName.toLowerCase().includes(s) || u.employeeCode.toLowerCase().includes(s));
        }
        if (deptFilter) {
          filtered = filtered.filter(u => u.department === deptFilter);
        }

        const uniqueDepts = [...new Set(userList.map(u => u.department).filter(Boolean))];

        content.innerHTML = `
          <div class="att-board-note" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px;padding:12px 16px;background:linear-gradient(135deg, rgba(79,70,229,0.05) 0%, rgba(59,130,246,0.08) 100%);border:1px solid rgba(79,70,229,0.15);border-radius:10px;">
            <div style="display:flex;gap:18px;flex-wrap:wrap;">
              <div><small style="color:var(--text-2);display:block">Tổng nhân sự có OT</small><strong style="font-size:18px;color:var(--text)">${userList.length}</strong></div>
              <div><small style="color:var(--text-2);display:block">Tổng số form OT</small><strong style="font-size:18px;color:var(--text)">${forms.length}</strong></div>
              <div><small style="color:var(--text-2);display:block">Tổng giờ đề nghị</small><strong style="font-size:18px;color:var(--primary)">${formatHours(grandTotalRequestedMinutes)}</strong></div>
              <div><small style="color:var(--text-2);display:block">Tổng giờ đã duyệt</small><strong style="font-size:18px;color:#10B981">${formatHours(grandTotalApprovedMinutes)}</strong></div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input type="text" id="ot-summary-search" placeholder="Tìm theo tên, mã NV..." value="${esc(filterText)}" style="padding:6px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border);min-width:180px;background:var(--surface);"/>
              ${uniqueDepts.length > 1 ? `
                <select id="ot-summary-dept" style="padding:6px 10px;font-size:13px;border-radius:6px;border:1px solid var(--border);background:var(--surface);">
                  <option value="">Tất cả phòng ban</option>
                  ${uniqueDepts.map(d => `<option value="${esc(d)}" ${d === deptFilter ? 'selected' : ''}>${esc(d)}</option>`).join('')}
                </select>
              ` : ''}
            </div>
          </div>

          <div class="table-wrap att-overtime-board-table" style="max-height:60vh;">
            <table>
              <thead>
                <tr style="background:var(--surface-2);">
                  <th style="width:40px;text-align:center;">#</th>
                  <th>Nhân viên</th>
                  <th>Phòng ban</th>
                  <th style="text-align:center;">Số form</th>
                  <th style="text-align:right;">Ngày thường</th>
                  <th style="text-align:right;">Ngày nghỉ</th>
                  <th style="text-align:right;">Ngày lễ</th>
                  <th style="text-align:right;">Tổng đề nghị</th>
                  <th style="text-align:right;color:#10B981;font-weight:700;">Tổng đã duyệt</th>
                  <th style="text-align:center;width:90px;">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.length ? filtered.map((u, idx) => `
                  <tr class="ot-summary-main-row" data-user-id="${u.userId}" style="cursor:pointer;">
                    <td style="text-align:center;color:var(--text-2);">${idx + 1}</td>
                    <td>
                      <strong>${esc(u.fullName)}</strong>
                      <br><small style="color:var(--text-2);">${esc(u.employeeCode)}</small>
                    </td>
                    <td>${esc(u.department)}</td>
                    <td style="text-align:center;">
                      <span class="badge ${u.approvedForms > 0 ? 'badge-success' : 'badge-gray'}">${u.totalForms} form</span>
                      ${u.pendingForms > 0 ? `<br><small style="color:var(--warning)">(${u.pendingForms} chờ duyệt)</small>` : ''}
                    </td>
                    <td style="text-align:right;">${u.workdayApprovedMinutes > 0 ? `<span style="color:var(--text)">${formatHours(u.workdayApprovedMinutes)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
                    <td style="text-align:right;">${u.restdayApprovedMinutes > 0 ? `<span style="color:#D97706;font-weight:600">${formatHours(u.restdayApprovedMinutes)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
                    <td style="text-align:right;">${u.holidayApprovedMinutes > 0 ? `<span style="color:#DC2626;font-weight:600">${formatHours(u.holidayApprovedMinutes)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
                    <td style="text-align:right;color:var(--text-2);">${formatHours(u.totalRequestedMinutes)}</td>
                    <td style="text-align:right;">
                      <strong style="color:#10B981;font-size:13.5px;background:rgba(16,185,129,0.1);padding:3px 8px;border-radius:6px;">${formatHours(u.totalApprovedMinutes)}</strong>
                    </td>
                    <td style="text-align:center;">
                      <button class="btn-secondary btn-sm ot-toggle-detail-btn" data-user-id="${u.userId}" style="padding:3px 8px;font-size:11.5px;">
                        ▼ Xem
                      </button>
                    </td>
                  </tr>
                  <tr class="ot-summary-detail-row" id="ot-detail-row-${u.userId}" style="display:none;background:var(--surface-2);">
                    <td colspan="10" style="padding:12px 16px;">
                      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;">
                        <div style="font-weight:650;font-size:13px;margin-bottom:8px;color:var(--text);display:flex;align-items:center;gap:6px;">
                          ${icon('clipboardList', 'xs')} Chi tiết ${u.forms.length} form OT của ${esc(u.fullName)} (${esc(u.employeeCode)})
                        </div>
                        <table style="width:100%;font-size:12px;border-collapse:collapse;">
                          <thead>
                            <tr style="border-bottom:1px solid var(--border);color:var(--text-2);text-align:left;">
                              <th style="padding:6px 8px;">Form ID</th>
                              <th style="padding:6px 8px;">Thời gian ca OT</th>
                              <th style="padding:6px 8px;">Thời điểm</th>
                              <th style="padding:6px 8px;">Lý do</th>
                              <th style="padding:6px 8px;text-align:right;">Đề nghị</th>
                              <th style="padding:6px 8px;text-align:right;">Đã duyệt</th>
                              <th style="padding:6px 8px;text-align:center;">Trạng thái</th>
                              <th style="padding:6px 8px;">Ghi chú / Người duyệt</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${u.forms.map(form => {
                              const items = form.items && form.items.length ? form.items : [{
                                start_at: '—', end_at: '—', reason: '—', time_category: 'workday',
                                requested_minutes: form.requested_minutes, approved_minutes: form.approved_minutes
                              }];
                              return items.map((item, itIdx) => `
                                <tr style="border-bottom:1px dashed var(--border);">
                                  <td style="padding:6px 8px;color:var(--text-2);">${itIdx === 0 ? `#${form.id}` : ''}</td>
                                  <td style="padding:6px 8px;">${formatTime(item.start_at)}<br>→ ${formatTime(item.end_at)}</td>
                                  <td style="padding:6px 8px;">${timeCatLabel(item.time_category)}</td>
                                  <td style="padding:6px 8px;max-width:200px;">${esc(item.reason || '—')}</td>
                                  <td style="padding:6px 8px;text-align:right;">${(Number(item.requested_minutes || 0) / 60).toFixed(2)}h</td>
                                  <td style="padding:6px 8px;text-align:right;color:#10B981;font-weight:600;">${(Number(item.approved_minutes || 0) / 60).toFixed(2)}h</td>
                                  <td style="padding:6px 8px;text-align:center;">${itIdx === 0 ? formStatus(form.status) : ''}</td>
                                  <td style="padding:6px 8px;font-size:11px;color:var(--text-2);">${itIdx === 0 ? `${esc(form.review_note || '')}${form.reviewer_name ? ` · ${esc(form.reviewer_name)}` : ''}` : ''}</td>
                                </tr>
                              `).join('');
                            }).join('')}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                `).join('') : `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-2);">Không tìm thấy nhân viên phù hợp</td></tr>`}
              </tbody>
            </table>
          </div>
        `;

        // Bind search & filter events
        const searchInput = document.getElementById('ot-summary-search');
        if (searchInput) {
          searchInput.addEventListener('input', e => renderBoard(e.target.value, document.getElementById('ot-summary-dept')?.value || ''));
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
        const deptSelect = document.getElementById('ot-summary-dept');
        if (deptSelect) {
          deptSelect.addEventListener('change', e => renderBoard(document.getElementById('ot-summary-search')?.value || '', e.target.value));
        }

        // Bind row toggle buttons
        content.querySelectorAll('.ot-toggle-detail-btn, .ot-summary-main-row').forEach(el => {
          el.addEventListener('click', e => {
            // Prevent double toggle if clicking button directly
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            const uid = el.dataset.userId;
            const detailRow = document.getElementById(`ot-detail-row-${uid}`);
            const btn = content.querySelector(`.ot-toggle-detail-btn[data-user-id="${uid}"]`);
            if (detailRow) {
              const isHidden = detailRow.style.display === 'none';
              detailRow.style.display = isHidden ? 'table-row' : 'none';
              if (btn) btn.textContent = isHidden ? '▲ Đóng' : '▼ Xem';
            }
          });
        });
      };

      renderBoard();

    } catch (error) {
      const content = document.getElementById('ot-summary-board-content');
      if (content) content.innerHTML = emptyHTML('triangleAlert', error.message || 'Không thể tải bảng tổng hợp làm thêm giờ');
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
        filteredEmployees = sortVietnameseNames(filteredEmployees, 'full_name');
        const pageData = paginateRows(filteredEmployees, historyPage);
        historyPage = pageData.page;
        if (!filteredEmployees.length) { listEl.innerHTML = emptyHTML('users', 'Không có nhân viên phù hợp'); return; }
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
      if (!filteredAttendance.length) { listEl.innerHTML = emptyHTML('calendarDays', 'Không có dữ liệu chấm công'); return; }

      // Load personal summary for the overview section
      let summaryHTML = '';
      try {
        const summaryData = await api.getEmployeeAttendanceSummary(me.id, params);
        const s = summaryData.summary;
        const metric = (label, value, tone = '') => `<div class="att-summary-metric ${tone}" title="${esc(label)}: ${esc(value)}"><span title="${esc(label)}">${label}</span><strong>${value}</strong></div>`;
        summaryHTML = `
          <div class="att-summary-section-title"><span>Tổng quan kỳ công</span><small>6 chỉ số chấm công</small></div>
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
                const wfhBadge = a.work_type === 'wfh'
                  ? (a.wfh_status === 'approved'
                      ? `<br><span class="badge badge-success" style="font-size:10px;padding:2px 6px;margin-top:2px;display:inline-block;" title="${esc(a.wfh_review_note ? `Ghi chú: ${a.wfh_review_note}` : 'Đã duyệt')}">${icon('circleCheck', 'xs')} Đã duyệt${a.wfh_reviewer_name ? ` · ${esc(a.wfh_reviewer_name)}` : ''}</span>`
                      : a.wfh_status === 'rejected'
                        ? `<br><span class="badge badge-danger" style="font-size:10px;padding:2px 6px;margin-top:2px;display:inline-block;" title="Lý do: ${esc(a.wfh_review_note || '')}">${icon('circleX', 'xs')} Từ chối${a.wfh_review_note ? ` · ${esc(a.wfh_review_note)}` : ''}</span><br><button type="button" class="btn-secondary btn-xs btn-history-wfh-proof" data-id="${a.id}" style="margin-top:2px;font-size:10px;padding:1px 5px;">Bổ sung giải trình</button>`
                        : `<br><span class="badge badge-warning" style="font-size:10px;padding:2px 6px;margin-top:2px;display:inline-block;">${icon('hourglass', 'xs')} Chờ duyệt</span>`)
                  : '';
                const wfhProofLink = (a.work_type === 'wfh' && a.wfh_proof_url)
                  ? `<br><button type="button" class="btn-secondary btn-xs btn-history-view-proof" data-url="${esc(a.wfh_proof_url)}" data-filename="${esc(a.wfh_proof_filename || 'Minh chứng')}" style="margin-top:2px;font-size:10px;padding:1px 5px;display:inline-flex;align-items:center;gap:2px;">${icon('paperclip', 'xs')} <span>Xem minh chứng</span></button>`
                  : '';
                return `
                <tr>
                  <td style="white-space:nowrap">${esc(fmtDate(a.date))}</td>
                  <td style="white-space:nowrap"><b>${esc((WORK_TYPE_LABEL[a.work_type] || WORK_TYPE_LABEL.office))}</b>${wfhBadge}${wfhProofLink}</td>
                  <td style="white-space:nowrap">${esc(SHIFT_LABEL_SHORT[a.shift] || SHIFT_LABEL_SHORT.full)}${a.work_type === 'business' ? `<br><span style="font-size:11px;color:var(--text-2)">${esc(a.expected_start||'—')}–${esc(a.expected_end||'—')}</span>` : ''}</td>
                  <td>${timeCell(a.checkin_time, checkinValid)}</td>
                  <td>${timeCell(a.checkout_time, checkoutValid)}${Number(a.auto_checkout) ? '<br><span class="att-quen-checkout-tag">Tự động checkout</span>' : ''}</td>
                  <td>${a.work_hours ? Number(a.work_hours).toFixed(1)+'h' : '—'}</td>
                  <td>${a.overtime_status === 'approved' ? `<span class="badge badge-success">${Number(a.approved_overtime_minutes || 0) / 60}h duyệt</span>` : a.overtime_status === 'pending' ? '<span class="badge badge-warning">Chờ duyệt</span>' : a.overtime_status === 'rejected' ? `<span class="badge badge-danger">Từ chối</span>${a.overtime_review_note ? `<br><small style="color:var(--danger)">${esc(a.overtime_review_note)}</small>` : ''}` : '—'}</td>
                  <td>${statusWithMinutes(a)}</td>
                  <td style="max-width:140px;">${formatAttendanceNote(a.note)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML(pageData)}
      `;
      listEl.querySelectorAll('.btn-history-view-proof').forEach(btn => {
        btn.addEventListener('click', () => viewProofModal(btn.dataset.url, btn.dataset.filename));
      });
      listEl.querySelectorAll('.btn-history-wfh-proof').forEach(btn => {
        btn.addEventListener('click', () => {
          const rec = filteredAttendance.find(x => String(x.id) === String(btn.dataset.id));
          if (rec) openWfhProofModal(rec);
        });
      });
      bindPagination(listEl, page => { historyPage = page; loadHistory(); });
    } catch(e) {
      listEl.innerHTML = emptyHTML('triangleAlert', e.message);
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
      const metric = (label, value, tone = '') => `<div class="att-summary-metric ${tone}" title="${esc(label)}: ${esc(value)}"><span title="${esc(label)}">${label}</span><strong>${value}</strong></div>`;
      content.innerHTML = `
        <div class="att-summary-top-row">
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
          <section class="att-summary-stats-panel">
            <div class="att-summary-section-title"><span>Tổng quan kỳ công</span><small>6 chỉ số chấm công</small></div>
            <div class="att-summary-grid">
              ${metric('Ngày công', `${s.actualWorkDays} / ${s.standardWorkDays}`, 'metric-primary')}${metric('Văn phòng / WFH / CT', `${s.officeDays} / ${s.wfhDays} / ${s.businessDays}`)}
              ${metric('Nghỉ phép / Vắng KP', `${s.paidLeaveDays} / ${s.absentDays}`, s.absentDays ? 'metric-danger' : '')}${metric('Đi muộn / Về sớm', `${s.lateDays || 0} / ${s.earlyDays || 0} lần`, (s.lateDays || s.earlyDays) ? 'metric-warning' : '')}
              ${metric('OT đã duyệt', `${Number(s.approvedOvertimeHours || 0).toFixed(2)} giờ`, 'metric-primary')}${metric('Tỷ lệ chuyên cần', `${s.attendanceRate}%`, 'metric-success')}
            </div>
          </section>
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
          const displayStatus = awaitingCheckin ? `<span class="badge badge-info">${icon('fileText', 'xs')} Chưa check-in</span>` : statusBadge(r.status);
          const checkinValid = r.checkin_time && r.late_minutes === 0;
          const checkoutValid = r.checkout_time && r.early_minutes === 0;
          // Location-review (ngoài phạm vi GPS) indicator + admin action.
          let locReviewHtml = '';
          const radiusLimit = Number(r.checkin_office_radius) || 150;
          const distMeters = r.checkin_distance_meters != null ? Number(r.checkin_distance_meters) : null;
          const isStrictlyOutside = distMeters != null ? distMeters > radiusLimit : true;
          if (Number(r.checkin_requires_review) && isStrictlyOutside && r.checkin_review_status !== 'approved' && r.checkin_review_status !== 'rejected') {
            locReviewHtml = `<div class="att-loc-review att-loc-review--pending"><span>${icon('triangleAlert', 'xs')} Ngoài phạm vi · Cần xem xét</span><br><small>${Math.round(distMeters || 0)} m / giới hạn ${Math.round(radiusLimit)} m${r.checkin_accuracy_meters != null ? ` · GPS ±${Math.round(Number(r.checkin_accuracy_meters))} m` : ''}</small></div>`;
          } else if (r.checkin_review_status === 'approved') {
            locReviewHtml = `<div class="att-loc-review att-loc-review--approved"><span>${icon('circleCheck', 'xs')} Đã xác nhận vị trí</span></div>`;
          } else if (r.checkin_review_status === 'rejected') {
            locReviewHtml = `<div class="att-loc-review att-loc-review--rejected"><span>${icon('ban', 'xs')} Vị trí không hợp lệ</span>${r.checkin_review_note ? `<br><small>${esc(r.checkin_review_note)}</small>` : ''}</div>`;
          }
          const actions = [];
          if (isManager) actions.push(`<button class="btn-icon att-summary-edit" data-id="${r.id}" data-checkin="${esc(r.checkin_time || '')}" data-checkout="${esc(r.checkout_time || '')}" data-status="${esc(r.status)}" data-note="${esc(r.note || '')}" data-work-type="${esc(r.work_type || 'office')}" data-shift="${esc(r.shift || 'full')}" data-expected-start="${esc(r.expected_start || '')}" data-expected-end="${esc(r.expected_end || '')}" title="Sửa">${icon('pencil', 'xs')}</button>`);
          if (isManager && Number(r.checkin_requires_review) && isStrictlyOutside && r.checkin_review_status !== 'approved' && r.checkin_review_status !== 'rejected') {
            actions.push(`<button class="btn-secondary btn-xs att-review-btn" data-id="${r.id}" data-decision="approved" style="display:inline-flex;align-items:center;gap:4px;">${icon('check', 'xs')} <span>Xác nhận</span></button><button class="btn-danger btn-xs att-review-btn" data-id="${r.id}" data-decision="rejected" style="display:inline-flex;align-items:center;gap:4px;">${icon('x', 'xs')} <span>Không hợp lệ</span></button>`);
          }
          let wfhDetailHtml = '';
          if (r.work_type === 'wfh') {
            const st = r.wfh_status || 'approved';
            const badge = st === 'approved'
              ? `<span class="badge badge-success" style="font-size:10px;padding:1px 5px;" title="${esc(r.wfh_review_note ? `Ghi chú: ${r.wfh_review_note}` : 'Đã duyệt')}">${icon('circleCheck', 'xs')} Đã duyệt${r.wfh_reviewer_name ? ` · ${esc(r.wfh_reviewer_name)}` : ''}</span>`
              : st === 'rejected'
                ? `<span class="badge badge-danger" style="font-size:10px;padding:1px 5px;" title="Lý do: ${esc(r.wfh_review_note || '')}">${icon('circleX', 'xs')} Từ chối${r.wfh_review_note ? ` · ${esc(r.wfh_review_note)}` : ''}</span>`
                : `<span class="badge badge-warning" style="font-size:10px;padding:1px 5px;">${icon('hourglass', 'xs')} Chờ duyệt</span>`;
            const proofBtn = r.wfh_proof_url
              ? `<br><button type="button" class="btn-secondary btn-xs btn-summary-view-proof" data-url="${esc(r.wfh_proof_url)}" data-filename="${esc(r.wfh_proof_filename || 'Minh chứng')}" style="margin-top:2px;font-size:10px;padding:1px 5px;display:inline-flex;align-items:center;gap:2px;">${icon('paperclip', 'xs')} <span>Xem minh chứng</span></button>`
              : '';
            const reasonLine = r.wfh_reason ? `<small style="display:block;color:var(--text-2);font-size:11px;max-width:160px;white-space:normal;line-height:1.2;margin-top:2px;">Lý do: ${esc(r.wfh_reason)}</small>` : '';
            wfhDetailHtml = `<div style="margin-top:2px;">${badge}${proofBtn}${reasonLine}</div>`;
          }
          return `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(new Date(r.date + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short' }))}</td><td><b>${esc(WORK_TYPE_LABEL[r.work_type] || WORK_TYPE_LABEL.office)}</b>${wfhDetailHtml}</td><td>${esc(SHIFT_LABEL_SHORT[r.shift] || SHIFT_LABEL_SHORT.full)}</td><td>${timeCell(r.checkin_time, checkinValid)}</td><td>${timeCell(r.checkout_time, checkoutValid)}</td><td>${r.work_hours ? Number(r.work_hours).toFixed(1) + 'h' : '—'}</td><td>${r.late_minutes ? r.late_minutes + 'p' : '—'}</td><td>${r.early_minutes ? r.early_minutes + 'p' : '—'}</td><td>${displayStatus}${locReviewHtml}</td><td>${formatAttendanceNote(r.note)}</td>${isManager ? `<td style="white-space:nowrap">${actions.join(' ')}</td>` : ''}</tr>`;
        }).join('') : `<tr><td colspan="${isManager ? 12 : 11}" class="att-summary-empty">Không có bản ghi phù hợp.</td></tr>`;
        document.querySelectorAll('.btn-summary-view-proof').forEach(btn => btn.addEventListener('click', () => viewProofModal(btn.dataset.url, btn.dataset.filename)));
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
      if (content) content.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('triangleAlert', 'lg')}</div><div class="empty-text">${esc(error.message || 'Không thể tải tổng kết chấm công')}</div></div>`;
    });
  }

  document.getElementById('btn-my-att-summary')?.addEventListener('click', () => openAttendanceSummary(me.id));
  document.getElementById('btn-att-monthly-board')?.addEventListener('click', openMonthlyAttendanceBoard);
  document.getElementById('btn-ot-summary-board')?.addEventListener('click', openOvertimeSummaryBoard);

  function openEditAttModal(data) {
    const curWorkType = data.workType || 'office';
    const curShift = (!data.shift || data.shift === 'full') ? 'full' : data.shift;
    const curStatus = data.status || 'present';
    const standard = { morning: { lateAfter: '08:45', end: '12:00' }, afternoon: { lateAfter: '13:45', end: '17:00' }, full: { lateAfter: '08:45', end: '17:00' } }[curShift] || { lateAfter: '08:45', end: '17:00' };
    const lateAfter = curWorkType === 'business' ? (data.expectedStart || standard.lateAfter) : standard.lateAfter;
    const shiftEnd = curWorkType === 'business' ? (data.expectedEnd || standard.end) : standard.end;
    const minutes = value => /^\d{2}:\d{2}$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
    const allowedCheckoutMinutes = Math.max(0, (minutes(shiftEnd) || 0) - 10);
    const allowedCheckout = `${String(Math.floor(allowedCheckoutMinutes / 60)).padStart(2, '0')}:${String(allowedCheckoutMinutes % 60).padStart(2, '0')}`;
    openModal('Sửa chấm công', `
      <div class="input-row" style="margin-bottom:14px;">
        <div class="field" style="margin-bottom:0;"><label>Check in</label><input type="time" id="edit-ci" value="${esc(data.checkin||'')}"/></div>
        <div class="field" style="margin-bottom:0;"><label>Check out</label><input type="time" id="edit-co" value="${esc(data.checkout||'')}"/></div>
      </div>
      <div class="field"><label>Hình thức làm việc</label>
        <input type="hidden" id="edit-worktype" value="${esc(curWorkType)}"/>
        <div class="att-segmented-group" data-target="edit-worktype">
          <button type="button" class="att-seg-btn ${curWorkType==='office'?'active':''}" data-val="office">Làm tại công ty</button>
          <button type="button" class="att-seg-btn ${curWorkType==='wfh'?'active':''}" data-val="wfh">WFH</button>
          <button type="button" class="att-seg-btn ${curWorkType==='business'?'active':''}" data-val="business">Công tác</button>
        </div>
      </div>
      <div class="field"><label>Ca làm việc</label>
        <input type="hidden" id="edit-shift" value="${esc(curShift)}"/>
        <div class="att-segmented-group" data-target="edit-shift">
          <button type="button" class="att-seg-btn ${curShift==='full'?'active':''}" data-val="full" title="08:30–17:00">Cả ngày</button>
          <button type="button" class="att-seg-btn ${curShift==='morning'?'active':''}" data-val="morning" title="08:30–12:00">Ca sáng</button>
          <button type="button" class="att-seg-btn ${curShift==='afternoon'?'active':''}" data-val="afternoon" title="13:30–17:00">Ca chiều</button>
        </div>
      </div>
      <div class="field"><label>Trạng thái</label>
        <input type="hidden" id="edit-ast" value="${esc(curStatus)}"/>
        <div class="att-segmented-group" data-target="edit-ast">
          <button type="button" class="att-seg-btn ${curStatus==='present'?'active':''}" data-val="present">
            <span class="att-seg-dot present"></span> Đúng giờ
          </button>
          <button type="button" class="att-seg-btn ${curStatus==='late'?'active':''}" data-val="late">
            <span class="att-seg-dot late"></span> Đi muộn
          </button>
          <button type="button" class="att-seg-btn ${curStatus==='absent'?'active':''}" data-val="absent">
            <span class="att-seg-dot absent"></span> Vắng
          </button>
          <button type="button" class="att-seg-btn ${curStatus==='leave'?'active':''}" data-val="leave">
            <span class="att-seg-dot leave"></span> Nghỉ phép
          </button>
        </div>
      </div>
      <div id="edit-att-rule" style="padding:9px 10px;border-radius:8px;background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;font-size:12px;line-height:1.45;">Chọn <b>Đúng giờ</b> chỉ khi check-in không muộn hơn <b>${esc(lateAfter)}</b> và check-out không sớm hơn <b>${esc(allowedCheckout)}</b> (được sớm 10 phút). Hệ thống sẽ tự tính lại phút đi muộn/về sớm theo giờ đã nhập.</div>
      <div class="field" style="margin-top:14px;"><label>Ghi chú</label><input type="text" id="edit-anote" value="${esc(data.note||'')}"/></div>
    `, `
      <button class="btn-danger" id="delete-att-btn" style="display:inline-flex;align-items:center;gap:4px;">${icon('trash2', 'xs')} <span>Xóa</span></button>
      <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
      <button class="btn-primary" id="save-att-btn">Lưu</button>
    `);
    let savingEdit = false;

    // Segmented button events
    document.querySelectorAll('.att-segmented-group').forEach(group => {
      const targetId = group.dataset.target;
      const targetInput = document.getElementById(targetId);
      group.querySelectorAll('.att-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('.att-seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (targetInput) {
            targetInput.value = btn.dataset.val;
            targetInput.dispatchEvent(new Event('change'));
          }
        });
      });
    });

    const activeRule = () => {
      const shift = document.getElementById('edit-shift')?.value || curShift;
      const workType = document.getElementById('edit-worktype')?.value || curWorkType;
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

  let attEventTimer = null;
  function handleAttendanceEvent() {
    if (attEventTimer) clearTimeout(attEventTimer);
    attEventTimer = setTimeout(() => {
      if (!el.isConnected) return;
      loadTodayStatus();
      loadHistory();
      loadGeoPanel();
      if (canManageAttendance) {
        loadOvertimeRequests();
        loadWfhRequests();
      }
    }, 250);
  }

  const prevCleanup = el._cleanup;
  el._cleanup = () => {
    if (attEventTimer) clearTimeout(attEventTimer);
    if (typeof prevCleanup === 'function') prevCleanup();
  };

  EventBus.bindView(el, 'attendance', handleAttendanceEvent);
  EventBus.bindView(el, 'attendance:*', handleAttendanceEvent);

  await Promise.allSettled([
    loadTodayStatus(),
    loadHistory(),
    loadGeoPanel(),
    canManageAttendance ? loadOvertimeRequests() : Promise.resolve(),
    canManageAttendance ? loadWfhRequests() : Promise.resolve(),
    loadOvertimeForms(),
  ]);
  if (routeEmployeeId && (canManageAttendance || routeEmployeeId === Number(me.id))) {
    openAttendanceSummary(routeEmployeeId, routeDate);
  }
}
