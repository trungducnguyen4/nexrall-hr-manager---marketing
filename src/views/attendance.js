import { api } from '../api.js';
import { esc, fmtDate, statusBadge, setAvatar, toast, openModal, closeModal, loadingHTML, emptyHTML, today, initials, avatarColor } from '../utils.js';

const WORK_TYPE_LABEL = { office: '🏢 Văn phòng', wfh: '🏠 WFH', business: '✈️ Công tác' };
const SHIFT_LABEL = { morning: 'Ca sáng (08:30–12:00)', afternoon: 'Ca chiều (13:30–17:00)', full: 'Cả ngày' };
const SHIFT_LABEL_SHORT = { morning: 'Ca sáng', afternoon: 'Ca chiều', full: 'Cả ngày' };

export async function renderAttendance(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';

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

    <!-- Filter -->
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header" style="margin-bottom:10px;">
        <div class="card-title">📅 Lịch sử chấm công</div>
        ${isManager ? `<button id="btn-add-att" class="btn-primary btn-sm">+ Thêm</button>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <input type="month" id="att-month-filter" class="w-full" style="max-width:180px;" value="${new Date().toISOString().slice(0,7)}"/>
        ${isManager ? `
          <select id="att-user-filter" style="max-width:200px;">
            <option value="">-- Tất cả nhân viên --</option>
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
      let ip = '';
      try { const r = await api.getIp(); ip = r.ip || ''; } catch(_) {}
      await api.checkin({ note, ip });
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
      let ip = '';
      try { const r = await api.getIp(); ip = r.ip || ''; } catch(_) {}
      await api.checkout({ ip });
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

  // Load users for filter
  if (isManager) {
    try {
      const { users } = await api.getUsers();
      const sel = document.getElementById('att-user-filter');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.full_name;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', loadHistory);
    } catch(_) {}
  }

  // Month filter
  document.getElementById('att-month-filter').addEventListener('change', loadHistory);

  function statusWithMinutes(a) {
    const badge = statusBadge(a.status);
    const bits = [];
    if (a.late_minutes > 0) bits.push(`Trễ ${a.late_minutes}p`);
    if (a.early_minutes > 0) bits.push(`Sớm ${a.early_minutes}p`);
    return bits.length ? `${badge}<div style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(bits.join(' · '))}</div>` : badge;
  }

  async function loadHistory() {
    const listEl = document.getElementById('att-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const monthVal = document.getElementById('att-month-filter')?.value || new Date().toISOString().slice(0,7);
    const [yr, mo] = monthVal.split('-');
    const params = { month: mo, year: yr };
    if (isManager) {
      const uid = document.getElementById('att-user-filter')?.value;
      if (uid) params.userId = uid;
    }
    try {
      const { attendance } = await api.getAttendance(params);
      if (!attendance.length) { listEl.innerHTML = emptyHTML('📅', 'Không có dữ liệu chấm công'); return; }
      listEl.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                ${isManager ? '<th>Nhân viên</th>' : ''}
                <th>Ngày</th><th>Hình thức</th><th>Ca đăng ký</th><th>Vào</th><th>Ra</th><th>Giờ làm</th><th>Trạng thái</th><th>Ghi chú</th>
                ${isManager ? '<th>Thao tác</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${attendance.map(a => `
                <tr>
                  ${isManager ? `<td><span style="font-weight:600">${esc(a.full_name)}</span><br><span style="font-size:11px;color:var(--text-2)">${esc(a.department||'')}</span></td>` : ''}
                  <td style="white-space:nowrap">${esc(a.date)}</td>
                  <td style="white-space:nowrap">${esc((WORK_TYPE_LABEL[a.work_type] || WORK_TYPE_LABEL.office))}</td>
                  <td style="white-space:nowrap">${esc(SHIFT_LABEL_SHORT[a.shift] || SHIFT_LABEL_SHORT.full)}${a.work_type === 'business' ? `<br><span style="font-size:11px;color:var(--text-2)">${esc(a.expected_start||'—')}–${esc(a.expected_end||'—')}</span>` : ''}</td>
                  <td>${esc(a.checkin_time||'—')}</td>
                  <td>${esc(a.checkout_time||'—')}</td>
                  <td>${a.work_hours ? Number(a.work_hours).toFixed(1)+'h' : '—'}</td>
                  <td>${statusWithMinutes(a)}</td>
                  <td style="max-width:140px;">${esc(a.note||'—')}</td>
                  ${isManager ? `<td><button class="btn-icon btn-edit-att" data-id="${a.id}" data-checkin="${esc(a.checkin_time||'')}" data-checkout="${esc(a.checkout_time||'')}" data-status="${esc(a.status)}" data-note="${esc(a.note||'')}" title="Sửa">✏️</button></td>` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      listEl.querySelectorAll('.btn-edit-att').forEach(btn => {
        btn.addEventListener('click', () => openEditAttModal(btn.dataset));
      });
    } catch(e) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(e.message)}</div></div>`;
    }
  }

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
