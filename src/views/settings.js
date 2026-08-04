import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML } from '../utils.js';

export async function renderSettings(el, me) {
  const isAdmin = me.role === 'admin';

  el.innerHTML = `
    <div class="page-header">
      <div class="page-title">⚙️ Cài đặt</div>
      <div class="page-sub">Cấu hình hệ thống</div>
    </div>

    <!-- Change password -->
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title" style="margin-bottom:14px;">🔑 Đổi mật khẩu</div>
      <div class="field"><label>Mật khẩu cũ</label>
        <div class="pw-wrap"><input type="password" id="pw-old" placeholder="••••••••"/><button type="button" id="pw-eye-old" class="pw-eye-btn">👁</button></div>
      </div>
      <div class="field"><label>Mật khẩu mới</label>
        <div class="pw-wrap"><input type="password" id="pw-new" placeholder="Tạo mật khẩu mạnh" autocomplete="new-password"/><button type="button" id="pw-eye-new" class="pw-eye-btn">👁</button></div>
        <ul id="pw-rules" class="password-rules" aria-live="polite">
          <li data-rule="length">Từ 8 đến 20 ký tự</li><li data-rule="upper">Có ít nhất 1 chữ in hoa</li>
          <li data-rule="lower">Có ít nhất 1 chữ thường</li><li data-rule="number">Có ít nhất 1 chữ số</li>
          <li data-rule="special">Có ít nhất 1 ký tự đặc biệt, ví dụ: ! @ # $ %</li><li data-rule="space">Không chứa khoảng trắng</li>
        </ul>
      </div>
      <div class="field"><label>Xác nhận mật khẩu mới</label><input type="password" id="pw-confirm" placeholder="Nhập lại mật khẩu mới"/></div>
      <button id="btn-change-pw-save" class="btn-primary w-full">Đổi mật khẩu</button>
    </div>

    <!-- Company settings (admin only) -->
    ${isAdmin ? `
    <div class="card" style="margin-bottom:14px;" id="company-settings-card">
      <div class="card-title" style="margin-bottom:14px;">🏢 Thông tin công ty</div>
      <div id="company-settings-body">${loadingHTML()}</div>
    </div>
    <div class="card" id="work-settings-card">
      <div class="card-title" style="margin-bottom:14px;">🕐 Cấu hình giờ làm</div>
      <div id="work-settings-body">${loadingHTML()}</div>
    </div>
    <div class="card" style="margin-top:14px;" id="holiday-settings-card">
      <div class="card-title" style="margin-bottom:14px;">🎉 Ngày lễ/Tết tính làm thêm giờ</div>
      <div id="holiday-settings-body">${loadingHTML()}</div>
    </div>
    ` : ''}

    <!-- Profile info -->
    <div class="card" style="margin-top:14px;">
      <div class="card-title" style="margin-bottom:12px;">👤 Thông tin cá nhân</div>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Họ tên</div><div class="detail-val">${esc(me.full_name)}</div></div>
        <div class="detail-item"><div class="detail-label">Email</div><div class="detail-val" style="font-size:12px;word-break:break-all;">${esc(me.email)}</div></div>
        <div class="detail-item"><div class="detail-label">Mã NV</div><div class="detail-val">${esc(me.employee_code||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Vị trí</div><div class="detail-val">${esc(me.position||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Phòng ban</div><div class="detail-val">${esc(me.department||'—')}</div></div>
        <div class="detail-item"><div class="detail-label">Lương</div><div class="detail-val">${Number(me.salary||0).toLocaleString('vi-VN')} ₫</div></div>
      </div>
    </div>
  `;

  // Toggle password visibility
  document.getElementById('pw-eye-old').addEventListener('click', () => togglePw('pw-old'));
  document.getElementById('pw-eye-new').addEventListener('click', () => togglePw('pw-new'));

  function togglePw(id) {
    const inp = document.getElementById(id);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }

  function renderPasswordRules(value) {
    const checks = {
      length: value.length >= 8 && value.length <= 20, upper: /[A-Z]/.test(value), lower: /[a-z]/.test(value),
      number: /[0-9]/.test(value), special: /[^A-Za-z0-9\s]/.test(value), space: !/\s/.test(value),
    };
    document.querySelectorAll('#pw-rules [data-rule]').forEach(item => {
      const passed = checks[item.dataset.rule];
      item.classList.toggle('is-valid', passed);
      item.classList.toggle('is-invalid', Boolean(value) && !passed);
    });
    return Object.values(checks).every(Boolean);
  }
  document.getElementById('pw-new').addEventListener('input', event => renderPasswordRules(event.target.value));

  // Change password
  document.getElementById('btn-change-pw-save').addEventListener('click', async () => {
    const old_password = document.getElementById('pw-old').value;
    const new_password = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;
    if (!old_password || !new_password) { toast('Điền đầy đủ thông tin', 'error'); return; }
    if (!renderPasswordRules(new_password)) { toast('Mật khẩu mới chưa đáp ứng đủ quy tắc', 'error'); return; }
    if (new_password !== confirm) { toast('Mật khẩu xác nhận không khớp', 'error'); return; }
    try {
      await api.changePassword(old_password, new_password);
      toast('Đổi mật khẩu thành công!', 'success');
      document.getElementById('pw-old').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
    } catch(e) { toast(e.message, 'error'); }
  });

  // Company & work settings (admin)
  if (isAdmin) {
    try {
      const { settings } = await api.getSettings();
      renderCompanySettings(settings);
      renderWorkSettings(settings);
      renderHolidaySettings();
    } catch(e) {
      document.getElementById('company-settings-body').innerHTML = `<div style="color:var(--danger);font-size:13px;">${esc(e.message)}</div>`;
    }
  }
}

async function renderHolidaySettings() {
  const el = document.getElementById('holiday-settings-body');
  if (!el) return;
  try {
    const { holidays = [] } = await api.getCompanyHolidays();
    el.innerHTML = `<div class="input-row"><div class="field"><label>Ngày</label><input type="date" id="holiday-date"/></div><div class="field"><label>Tên ngày lễ/Tết</label><input type="text" id="holiday-name" placeholder="Ví dụ: Quốc khánh"/></div></div><button id="holiday-add" class="btn-primary btn-sm">+ Thêm ngày lễ</button><div class="table-wrap" style="margin-top:12px;"><table><thead><tr><th>Ngày</th><th>Tên</th><th>Trạng thái</th><th></th></tr></thead><tbody>${holidays.length ? holidays.map(h => `<tr><td>${esc(h.holiday_date)}</td><td>${esc(h.name)}</td><td>${Number(h.is_active) ? 'Áp dụng 300%' : 'Tạm tắt'}</td><td><button class="btn-icon holiday-edit" data-id="${h.id}" data-date="${esc(h.holiday_date)}" data-name="${esc(h.name)}" data-active="${Number(h.is_active)}" title="Sửa">✏️</button><button class="btn-icon holiday-delete" data-id="${h.id}" title="Xóa">🗑️</button></td></tr>`).join('') : '<tr><td colspan="4">Chưa có ngày lễ/Tết</td></tr>'}</tbody></table></div>`;
    document.getElementById('holiday-add')?.addEventListener('click', async () => {
      const holiday_date = document.getElementById('holiday-date').value; const name = document.getElementById('holiday-name').value.trim();
      if (!holiday_date || !name) { toast('Vui lòng nhập ngày và tên ngày lễ', 'error'); return; }
      try { await api.createCompanyHoliday({ holiday_date, name }); toast('Đã thêm ngày lễ', 'success'); renderHolidaySettings(); } catch (e) { toast(e.message, 'error'); }
    });
    el.querySelectorAll('.holiday-edit').forEach(btn => btn.addEventListener('click', async () => {
      const holiday_date = prompt('Ngày (YYYY-MM-DD):', btn.dataset.date); if (holiday_date === null) return;
      const name = prompt('Tên ngày lễ/Tết:', btn.dataset.name); if (name === null) return;
      try { await api.updateCompanyHoliday(btn.dataset.id, { holiday_date, name, is_active: Number(btn.dataset.active) === 1 }); toast('Đã cập nhật ngày lễ', 'success'); renderHolidaySettings(); } catch (e) { toast(e.message, 'error'); }
    }));
    el.querySelectorAll('.holiday-delete').forEach(btn => btn.addEventListener('click', async () => { if (!confirm('Xóa ngày lễ này?')) return; await api.deleteCompanyHoliday(btn.dataset.id); renderHolidaySettings(); }));
  } catch (e) { el.innerHTML = `<div style="color:var(--danger);font-size:13px;">${esc(e.message)}</div>`; }
}

function renderCompanySettings(s) {
  const el = document.getElementById('company-settings-body');
  if (!el) return;
  el.innerHTML = `
    <div class="field"><label>Tên công ty</label><input type="text" id="cs-name" value="${esc(s.company_name||'')}"/></div>
    <div class="field"><label>Địa chỉ</label><input type="text" id="cs-addr" value="${esc(s.company_address||'')}"/></div>
    <div class="input-row">
      <div class="field"><label>Điện thoại</label><input type="text" id="cs-phone" value="${esc(s.company_phone||'')}"/></div>
      <div class="field"><label>Email</label><input type="email" id="cs-email" value="${esc(s.company_email||'')}"/></div>
    </div>
    <button id="save-company" class="btn-primary w-full">Lưu thông tin công ty</button>
  `;
  document.getElementById('save-company').addEventListener('click', async () => {
    try {
      await api.saveSettings({
        company_name: document.getElementById('cs-name').value,
        company_address: document.getElementById('cs-addr').value,
        company_phone: document.getElementById('cs-phone').value,
        company_email: document.getElementById('cs-email').value,
      });
      toast('Đã lưu thông tin công ty', 'success');
    } catch(e) { toast(e.message, 'error'); }
  });
}

function renderWorkSettings(s) {
  const el = document.getElementById('work-settings-body');
  if (!el) return;
  el.innerHTML = `
    <div class="input-row">
      <div class="field"><label>Giờ vào làm</label><input type="time" id="ws-start" value="${esc(s.work_start||'08:30')}"/></div>
      <div class="field"><label>Giờ tan làm</label><input type="time" id="ws-end" value="${esc(s.work_end||'17:00')}"/></div>
    </div>
    <div class="field"><label>Ngưỡng đi muộn (phút)</label><input type="number" id="ws-late" value="${esc(s.late_threshold||'15')}" min="0" max="60"/></div>
    <div class="field"><label>Ngày làm việc</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
        ${['CN','T2','T3','T4','T5','T6','T7'].map((d,i)=>`
          <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
            <input type="checkbox" data-dow="${i}" ${(s.work_days||'1,2,3,4,5,6').split(',').includes(String(i))?'checked':''}/>
            ${d}
          </label>
        `).join('')}
      </div>
    </div>
    <button id="save-work" class="btn-primary w-full">Lưu cấu hình giờ làm</button>
  `;
  document.getElementById('save-work').addEventListener('click', async () => {
    const dows = [...document.querySelectorAll('[data-dow]:checked')].map(c => c.dataset.dow);
    try {
      await api.saveSettings({
        work_start: document.getElementById('ws-start').value,
        work_end: document.getElementById('ws-end').value,
        late_threshold: document.getElementById('ws-late').value,
        work_days: dows.join(','),
      });
      toast('Đã lưu cấu hình giờ làm', 'success');
    } catch(e) { toast(e.message, 'error'); }
  });
}
