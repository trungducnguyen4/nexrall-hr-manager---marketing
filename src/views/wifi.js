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
        <div class="page-title">📡 WiFi Whitelist</div>
        <div class="page-sub">Quản lý mạng WiFi được phép chấm công</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="btn-check-ip" class="btn-secondary btn-sm">Kiểm tra IP hiện tại</button>
        <button id="btn-add-wifi" class="btn-primary btn-sm">+ Thêm WiFi</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:12px;background:#FFF7ED;border-color:#FED7AA;">
      <div style="font-size:13px;color:var(--text-2);">Chưa xác định đường truyền sử dụng IP tĩnh hay IP động. Nếu IP thay đổi, việc chấm công tại văn phòng có thể bị gián đoạn.</div>
      <div id="wifi-ip-result" style="font-size:12px;color:var(--text-3);margin-top:6px;"></div>
    </div>
    <div id="wifi-list">${loadingHTML()}</div>
  `;

  async function loadWifi() {
    const listEl = document.getElementById('wifi-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    try {
      const { whitelist } = await api.getWifi();
      if (!whitelist.length) { listEl.innerHTML = emptyHTML('📡', 'Chưa có WiFi nào trong whitelist'); return; }
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
          if (!confirm('Xóa WiFi này?')) return;
          try { await api.deleteWifi(parseInt(btn.dataset.wid)); toast('Đã xóa', 'success'); loadWifi(); }
          catch(e) { toast(e.message, 'error'); }
        });
      });
    } catch(e) { listEl.innerHTML = emptyHTML('⚠️', e.message); }
  }

  document.getElementById('btn-add-wifi').addEventListener('click', () => openWifiForm(null, loadWifi));
  document.getElementById('btn-check-ip').addEventListener('click', async () => {
    const box = document.getElementById('wifi-ip-result');
    box.textContent = 'Đang kiểm tra...';
    try {
      const r = await api.getIp();
      box.innerHTML = `IP backend nhận được: <code>${esc(r.ip)}</code> ${r.matched ? '(đã khớp whitelist)' : '(chưa khớp whitelist)'}`;
    } catch(e) {
      box.textContent = e.message || 'Không kiểm tra được IP';
    }
  });
  loadWifi();
}

function openWifiForm(data, refreshFn) {
  const isEdit = !!data?.wid;
  openModal(isEdit ? 'Sửa WiFi' : 'Thêm WiFi', `
    <div class="field"><label>Tên WiFi *</label><input type="text" id="wf-name" value="${esc(data?.name||'')}" placeholder="Office WiFi"/></div>
    <div class="field"><label>Public IPv4</label><input type="text" id="wf-ip" value="${esc(data?.ip||'')}" placeholder="42.118.136.186"/></div>
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
    if (!wifi_name) { toast('Nhập tên WiFi', 'error'); return; }
    const d = {
      wifi_name,
      ip_range: document.getElementById('wf-ip').value,
      description: document.getElementById('wf-desc').value,
      is_active: parseInt(document.getElementById('wf-active').value),
    };
    try {
      if (isEdit) await api.updateWifi(parseInt(data.wid), d);
      else await api.createWifi(d);
      closeModal(); toast('Đã lưu', 'success'); refreshFn();
    } catch(e) { toast(e.message, 'error'); }
  });
}
