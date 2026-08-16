import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML } from '../utils.js';

export async function renderWifi(el, me) {
  if (me.role !== 'admin') {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">Chỉ Admin mới có quyền truy cập</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div class="page-title">📍 Địa điểm chấm công</div>
        <div class="page-sub">Geofence GPS là xác minh chính; Public IP chỉ là tín hiệu quản trị bổ sung.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <div id="gps-constraint-control"></div>
        <button id="btn-check-ip" class="btn-secondary btn-sm">Kiểm tra IP hiện tại</button>
        <button id="btn-add-location" class="btn-primary btn-sm">+ Thêm địa điểm</button>
      </div>
    </div>
    <div id="attendance-location-list" class="attendance-location-grid">${loadingHTML()}</div>
    <div class="card" style="margin:12px 0;background:#FFF7ED;border-color:#FED7AA;">
      <div style="font-size:13px;color:var(--text-2);">Hệ thống kiểm tra Public IP mà backend nhận được, không thể đọc tên Wi-Fi/SSID từ trình duyệt. Nếu IP công khai thay đổi, việc chấm công tại văn phòng có thể bị gián đoạn.</div>
      <div id="wifi-ip-result" style="font-size:12px;color:var(--text-3);margin-top:6px;"></div>
    </div>
    <details class="card"><summary style="cursor:pointer;font-weight:700;">📡 Mạng/IP văn phòng (tín hiệu phụ)</summary><div id="wifi-list" style="margin-top:12px;">${loadingHTML()}</div></details>
  `;

  async function loadWifi() {
    const listEl = el.querySelector('#wifi-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    try {
      const { whitelist } = await api.getWifi();
      if (!whitelist.length) { listEl.innerHTML = emptyHTML('📡', 'Chưa có mạng văn phòng nào được phép chấm công'); return; }
      listEl.innerHTML = whitelist.map(w => `
        <div class="card" style="margin-bottom:10px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
            <div style="flex:1;">
              <div style="font-weight:700;font-size:15px;margin-bottom:4px;">📶 ${esc(w.wifi_name||'Không tên')}</div>
              <div style="font-size:13px;color:var(--text-2);margin-bottom:4px;">IP: <code style="background:var(--bg);padding:2px 6px;border-radius:4px;">${esc(w.ip_range||'*')}</code></div>
              ${w.description ? `<div style="font-size:12px;color:var(--text-2);">${esc(w.description)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              <span class="badge ${w.is_active ? 'badge-success' : 'badge-gray'}">${w.is_active?'✅ Hoạt động':'⛔ Tắt'}</span>
              <button class="btn-icon wifi-edit" data-wid="${w.id}" data-name="${esc(w.wifi_name||'')}" data-ip="${esc(w.ip_range||'')}" data-desc="${esc(w.description||'')}" data-active="${w.is_active}" title="Sửa">✏️</button>
              <button class="btn-icon wifi-del" data-wid="${w.id}" title="Xóa" style="color:var(--danger)">🗑</button>
            </div>
          </div>
        </div>
      `).join('');
      listEl.querySelectorAll('.wifi-edit').forEach(btn => {
        btn.addEventListener('click', () => openWifiForm(btn.dataset, loadWifi));
      });
      listEl.querySelectorAll('.wifi-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Xóa mạng văn phòng này? Nhân viên qua mạng này sẽ không thể chấm công.')) return;
          try { await api.deleteWifi(parseInt(btn.dataset.wid)); toast('Đã xóa', 'success'); loadWifi(); }
          catch(e) { toast(e.message, 'error'); }
        });
      });
    } catch(e) { listEl.innerHTML = emptyHTML('⚠️', e.message); }
  }

  async function loadLocations() {
    const list = el.querySelector('#attendance-location-list');
    try {
      const { locations } = await api.getAttendanceLocations();
      list.innerHTML = locations.length ? locations.map(location => `<article class="card attendance-location-card"><div class="attendance-geofence-map"><span class="attendance-geofence-circle"></span><span class="attendance-geofence-pin">📍</span></div><div style="font-weight:800">${esc(location.name)}</div><div class="attendance-location-meta">${esc(location.address || location.code || 'Chưa có địa chỉ')}<br>Bán kính ${Number(location.radius_meters)} m · GPS tối đa ±${Number(location.max_accuracy_meters)} m</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;"><span class="badge ${location.is_active ? 'badge-success':'badge-gray'}">${location.is_active?'● Hoạt động':'Tạm tắt'}</span><span><button class="btn-secondary btn-xs location-test" data-id="${location.id}">Kiểm tra vị trí</button><button class="btn-secondary btn-xs location-edit" data-id="${location.id}">Sửa</button></span></div></article>`).join('') : emptyHTML('📍','Chưa có địa điểm chấm công','Thêm văn phòng HCM/Hà Nội để bật xác minh GPS.');
      list.querySelectorAll('.location-edit').forEach(button => button.addEventListener('click', () => openLocationForm(locations.find(x => Number(x.id) === Number(button.dataset.id)), loadLocations)));
      list.querySelectorAll('.location-test').forEach(button => button.addEventListener('click', () => testLocation()));
    } catch (error) { list.innerHTML = emptyHTML('⚠️', error.message); }
  }
  async function loadGpsConstraint() {
    const control = el.querySelector('#gps-constraint-control');
    if (!control) return;
    try {
      const { settings } = await api.getSettings();
      const enabled = String(settings.attendance_gps_constraint ?? '1') !== '0';
      control.innerHTML = `<label class="attendance-gps-toggle" title="Bật để bắt buộc xác minh GPS khi chấm công tại văn phòng"><input id="gps-constraint-toggle" type="checkbox" ${enabled ? 'checked' : ''}><span aria-hidden="true"></span><b>Ràng buộc GPS</b><small>${enabled ? 'Đang bật' : 'Đang tắt'}</small></label>`;
      const input = control.querySelector('#gps-constraint-toggle');
      input?.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await api.saveSettings({ attendance_gps_constraint: input.checked ? '1' : '0' });
          toast(input.checked ? 'Đã bật ràng buộc GPS' : 'Đã tắt ràng buộc GPS', 'success');
          loadGpsConstraint();
        } catch (error) {
          input.checked = !input.checked;
          input.disabled = false;
          toast(error.message || 'Không thể cập nhật ràng buộc GPS', 'error');
        }
      });
    } catch (_) {
      control.innerHTML = `<span class="field-hint">Không tải được cấu hình GPS</span>`;
    }
  }
  function testLocation() { navigator.geolocation?.getCurrentPosition(async pos => { try { const r=await api.verifyAttendanceLocation({latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy}); toast(r.status === 'verified' ? `Đang ở ${r.location.name}, cách ${Math.round(r.location.distance_meters)}m` : (r.reason || 'Chưa xác minh được'), r.status === 'verified' ? 'success' : 'error'); } catch(e) { toast(e.message,'error'); } }, () => toast('Hãy cho phép truy cập vị trí GPS', 'error'), {enableHighAccuracy:true,timeout:12000}); }
  el.querySelector('#btn-add-location').addEventListener('click', () => openLocationForm(null, loadLocations));
  el.querySelector('#btn-check-ip').addEventListener('click', async () => {
    const box = el.querySelector('#wifi-ip-result');
    box.textContent = 'Đang kiểm tra...';
    try {
      const r = await api.getIp();
      box.innerHTML = `IP backend nhận được: <code>${esc(r.ip)}</code> ${r.matched ? '(đã khớp whitelist)' : '(chưa khớp whitelist)'}`;
    } catch(e) {
      box.textContent = e.message || 'Không kiểm tra được IP';
    }
  });
  loadLocations(); loadWifi(); loadGpsConstraint();
}

function openLocationForm(location, refresh) {
  const edit = !!location;
  openModal(edit ? 'Sửa địa điểm chấm công' : 'Thêm địa điểm chấm công', `<div class="field"><label>Tên *</label><input id="al-name" value="${esc(location?.name||'')}" placeholder="Văn phòng Hồ Chí Minh"/></div><div class="field"><label>Mã</label><input id="al-code" value="${esc(location?.code||'')}" placeholder="HCM"/></div><div class="field"><label>Địa chỉ</label><input id="al-address" value="${esc(location?.address||'')}"/></div><div class="input-row"><div class="field"><label>Latitude *</label><input type="number" step="any" id="al-lat" value="${esc(location?.latitude||'')}"/></div><div class="field"><label>Longitude *</label><input type="number" step="any" id="al-lng" value="${esc(location?.longitude||'')}"/></div></div><button type="button" class="btn-secondary btn-sm" id="al-current">Lấy vị trí hiện tại</button><div class="input-row"><div class="field"><label>Bán kính (m)</label><input type="number" id="al-radius" value="${esc(location?.radius_meters||100)}"/></div><div class="field"><label>GPS tối đa (m)</label><input type="number" id="al-accuracy" value="${esc(location?.max_accuracy_meters||100)}"/></div></div>`, `<button class="btn-secondary" id="al-cancel">Hủy</button>${edit?'<button class="btn-danger" id="al-delete">Xóa</button>':''}<button class="btn-primary" id="al-save">Lưu</button>`);
  document.getElementById('al-cancel').onclick=closeModal;
  document.getElementById('al-current').onclick=()=>navigator.geolocation?.getCurrentPosition(p=>{document.getElementById('al-lat').value=p.coords.latitude;document.getElementById('al-lng').value=p.coords.longitude;},()=>toast('Không lấy được GPS','error'),{enableHighAccuracy:true});
  document.getElementById('al-save').onclick=async()=>{const data={name:document.getElementById('al-name').value,code:document.getElementById('al-code').value,address:document.getElementById('al-address').value,latitude:Number(document.getElementById('al-lat').value),longitude:Number(document.getElementById('al-lng').value),radius_meters:Number(document.getElementById('al-radius').value),max_accuracy_meters:Number(document.getElementById('al-accuracy').value)};try{edit?await api.updateAttendanceLocation(location.id,data):await api.createAttendanceLocation(data);closeModal();refresh();}catch(e){toast(e.message,'error')}};
  document.getElementById('al-delete')?.addEventListener('click',async()=>{if(!confirm('Xóa địa điểm này?'))return;try{await api.deleteAttendanceLocation(location.id);closeModal();refresh();}catch(e){toast(e.message,'error')}});
}

function openWifiForm(data, refreshFn) {
  const isEdit = !!data?.wid;
  openModal(isEdit ? 'Sửa mạng văn phòng' : 'Thêm mạng văn phòng', `
    <div class="field"><label>Tên mạng văn phòng *</label><input type="text" id="wf-name" value="${esc(data?.name||'')}" placeholder="Văn phòng NetViet"/></div>
    <div class="field"><label>IP hoặc dải mạng công khai *</label><input type="text" id="wf-ip" value="${esc(data?.ip||'')}" placeholder="42.118.136.186 hoặc 2405:4802:....::/64"/></div>
    <div class="field-hint">Có thể nhập nhiều IP/dải, ngăn cách bằng dấu phẩy. Không nhập IP nội bộ như 192.168.x.x.</div>
    ${!isEdit ? `<button type="button" class="btn-secondary btn-sm" id="wf-use-current" style="margin-bottom:10px;">Dùng IP backend hiện tại</button>` : ''}
    <div class="field"><label>Mô tả</label><input type="text" id="wf-desc" value="${esc(data?.desc||data?.description||'')}" placeholder="Văn phòng tầng 2"/></div>
    <div class="field"><label>Trạng thái</label>
      <select id="wf-active">
        <option value="1" ${(data?.active==='1'||data?.active===1||!isEdit)?'selected':''}>Hoạt động</option>
        <option value="0" ${(data?.active==='0'||data?.active===0)?'selected':''}>Tắt</option>
      </select>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="wf-save">Lưu</button>
  `);
  document.getElementById('wf-use-current')?.addEventListener('click', async () => {
    try {
      const r = await api.getIp();
      document.getElementById('wf-ip').value = r.ip || '';
      if (r.warning) toast(r.warning, 'info', 5000);
    } catch(e) { toast(e.message || 'Không lấy được IP', 'error'); }
  });
  document.getElementById('wf-save').addEventListener('click', async () => {
    const wifi_name = document.getElementById('wf-name').value.trim();
    if (!wifi_name) { toast('Nhập tên mạng văn phòng', 'error'); return; }
    const d = {
      wifi_name,
      ip_range: document.getElementById('wf-ip').value,
      description: document.getElementById('wf-desc').value,
      is_active: parseInt(document.getElementById('wf-active').value),
    };
    try {
      if (isEdit) await api.updateWifi(parseInt(data.wid), d);
      else {
        const result = await api.createWifi(d);
        if (result.warning) toast(result.warning, 'info', 8000);
      }
      closeModal(); toast('Đã lưu', 'success'); refreshFn();
    } catch(e) { toast(e.message, 'error'); }
  });
}
