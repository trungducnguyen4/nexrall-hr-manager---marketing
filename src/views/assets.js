// ════════════════════════════════════════════════
//  Asset Handover (Bàn giao tài sản)
//  Rendered inside the Dashboard for: any employee/TTS (declare/update own
//  assets), any Mentor with assets awaiting confirmation, any department
//  Manager (own department's assets), and HCNS/Ban Giám Đốc (full oversight).
//  See server.js /api/assets for permission enforcement.
// ════════════════════════════════════════════════
import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, assetStatusBadge, lifecycleBadge, fmtDate, DEPARTMENTS, noop, safeCb } from '../utils.js';

// HCNS (Phòng HCNS) and Ban Giám Đốc are DEPARTMENTS (not roles).
function isHrOrBod(u) {
  return u.role === 'admin' || u.department === 'Phòng HCNS' || u.department === 'Ban Giám Đốc';
}
function isDeptManager(u) { return u.role === 'manager'; }

export async function renderAssetSection(el, me) {
  const isHr = isHrOrBod(me);
  const isMgr = isDeptManager(me);

  el.innerHTML = loadingHTML();
  let assets = [];
  try {
    assets = (await api.getAssets()).assets || [];
  } catch (e) {
    el.innerHTML = `<div class="card"><div class="card-header"><div class="card-title">🗂️ Bàn giao tài sản</div></div>${emptyHTML('⚠️', 'Không thể tải dữ liệu tài sản')}</div>`;
    return;
  }

  const ownAssets = assets.filter(a => a.user_id === me.id);
  const mentorAssets = assets.filter(a => a.mentor_id === me.id && a.user_id !== me.id);
  const deptAssets = (isMgr && !isHr)
    ? assets.filter(a => a.user_id !== me.id && a.mentor_id !== me.id && a.owner_department === me.department)
    : [];

  const sections = [];

  // ── Dashboard cá nhân: tổng quan tài sản người đăng nhập đang quản lý ──
  sections.push(renderPersonalSummary(ownAssets));

  sections.push(`
    <div class="card-header">
      <div class="card-title">🗂️ Tài sản tôi quản lý</div>
      <button class="btn-primary btn-sm" id="asset-add-own">+ Khai báo</button>
    </div>
    <div id="asset-own-list">${renderAssetList(ownAssets, 'own')}</div>
  `);

  if (mentorAssets.length) {
    sections.push(`
      <div class="card-header"><div class="card-title">👨‍🏫 Cần bạn xác nhận (Mentor)</div></div>
      <div id="asset-mentor-list">${renderAssetList(mentorAssets, 'mentor')}</div>
    `);
  }

  if (deptAssets.length) {
    sections.push(`
      <div class="card-header"><div class="card-title">🏢 Tài sản nhân sự phòng ban</div></div>
      <div id="asset-dept-list">${renderAssetList(deptAssets, 'manage')}</div>
    `);
  }

  if (isHr) {
    sections.push(renderManageSection(assets));
  }

  el.innerHTML = `<div class="card">${sections.join('<div style="border-top:1px solid var(--divider);margin:16px 0;"></div>')}</div>`;
  wireAssetHandlers(el, me, assets);
}

function renderPersonalSummary(ownAssets) {
  const count = (pred) => ownAssets.filter(pred).length;
  const stats = [
    { label: 'Tổng tài sản', value: ownAssets.length, color: 'var(--primary)' },
    { label: 'Chờ kiểm tra', value: count(a => a.status === 'pending_review'), color: '#B45309' },
    { label: 'Cần bổ sung', value: count(a => a.status === 'needs_update'), color: '#D93025' },
    { label: 'Chờ bàn giao', value: count(a => a.status === 'confirmed'), color: '#1D4ED8' },
    { label: 'Đã bàn giao', value: count(a => a.status === 'handed_over'), color: '#047857' },
  ];
  return `
    <div class="card-header"><div class="card-title">📊 Tổng quan tài sản của tôi</div></div>
    <div class="stats-grid" style="grid-template-columns:repeat(5,1fr);gap:8px;">
      ${stats.map(s => `
        <div class="stat-card" style="--stat-color:${s.color};padding:10px 8px;">
          <div style="font-size:18px;line-height:24px;font-weight:800;color:${s.color};">${s.value}</div>
          <div style="font-size:11px;line-height:14px;color:var(--text-3);margin-top:2px;">${esc(s.label)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderManageSection(assets) {
  const deptOptions = DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  const typeOptions = [...new Set(assets.map(a => a.asset_type).filter(Boolean))]
    .map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  return `
    <div class="card-header">
      <div class="card-title">🗂️ Quản lý bàn giao tài sản</div>
      <button class="btn-secondary btn-sm" id="asset-add-hr">+ Thêm hộ</button>
    </div>
    <div class="search-bar"><input type="text" id="asset-search" placeholder="Tìm theo tên hoặc mã nhân sự..."/></div>
    <div class="input-row" style="margin-bottom:10px;">
      <div class="field" style="margin-bottom:0;"><select id="asset-f-dept"><option value="">-- Phòng ban --</option>${deptOptions}</select></div>
      <div class="field" style="margin-bottom:0;"><select id="asset-f-emptype"><option value="">-- Loại nhân sự --</option><option value="NV">Nhân viên</option><option value="TTS">Thực tập sinh</option></select></div>
    </div>
    <div class="input-row" style="margin-bottom:10px;">
      <div class="field" style="margin-bottom:0;"><select id="asset-f-type"><option value="">-- Loại tài sản --</option>${typeOptions}</select></div>
      <div class="field" style="margin-bottom:0;"><select id="asset-f-status">
        <option value="">-- Trạng thái --</option>
        <option value="active">Đang quản lý</option>
        <option value="pending_review">Chờ kiểm tra</option>
        <option value="needs_update">Cần bổ sung</option>
        <option value="confirmed">Đã xác nhận</option>
        <option value="handed_over">Đã bàn giao</option>
      </select></div>
    </div>
    <div class="field"><label>Ngày dự kiến bàn giao (đến ngày)</label><input type="date" id="asset-f-date"/></div>
    <div id="asset-all-list">${renderAssetList(assets, 'manage')}</div>
  `;
}

function renderAssetList(list, mode) {
  if (!list.length) return emptyHTML('🗂️', mode === 'mentor' ? 'Không có tài sản cần xác nhận' : 'Chưa có tài sản nào');
  return list.map(a => `
    <div class="list-item" data-aid="${a.id}">
      <div class="list-item-content">
        <div class="list-item-title">${esc(a.asset_name)}${a.asset_type ? ` <span style="font-size:11px;color:var(--text-3);font-weight:400;">· ${esc(a.asset_type)}</span>` : ''}</div>
        <div class="list-item-sub">${a.owner_name ? `👤 ${esc(a.owner_name)}${a.owner_code ? ` (${esc(a.owner_code)})` : ''}` : ''}${a.owner_department ? ` · ${esc(a.owner_department)}` : ''}${a.platform ? ` · ${esc(a.platform)}` : ''}${a.mentor_name ? ` · Mentor: ${esc(a.mentor_name)}` : ''}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${assetStatusBadge(a.status)}${a.owner_lifecycle_status ? lifecycleBadge(a.owner_lifecycle_status) : ''}${a.expected_handover_date ? `<span style="font-size:11px;color:var(--text-3);">📅 Dự kiến: ${fmtDate(a.expected_handover_date)}</span>` : ''}</div>
      </div>
    </div>
  `).join('');
}

function filterAssets(assets) {
  const search = (document.getElementById('asset-search')?.value || '').toLowerCase();
  const dept = document.getElementById('asset-f-dept')?.value || '';
  const empType = document.getElementById('asset-f-emptype')?.value || '';
  const assetType = document.getElementById('asset-f-type')?.value || '';
  const status = document.getElementById('asset-f-status')?.value || '';
  const beforeDate = document.getElementById('asset-f-date')?.value || '';
  let list = assets;
  if (search) list = list.filter(a =>
    (a.owner_name || '').toLowerCase().includes(search) || (a.owner_code || '').toLowerCase().includes(search)
  );
  if (dept) list = list.filter(a => a.owner_department === dept);
  if (empType) list = list.filter(a => (a.owner_employee_type || 'NV') === empType);
  if (assetType) list = list.filter(a => a.asset_type === assetType);
  if (status) list = list.filter(a => a.status === status);
  if (beforeDate) list = list.filter(a => a.expected_handover_date && a.expected_handover_date <= beforeDate);
  return list;
}

function wireAssetHandlers(el, me, assets) {
  document.getElementById('asset-add-own')?.addEventListener('click', () => {
    openAssetForm(null, me, () => renderAssetSection(el, me), {});
  });
  document.getElementById('asset-add-hr')?.addEventListener('click', () => {
    openAssetForm(null, me, () => renderAssetSection(el, me), { forOwnerPick: true });
  });

  function wireManageListClicks(list) {
    document.getElementById('asset-all-list')?.querySelectorAll('.list-item[data-aid]').forEach(item => {
      item.addEventListener('click', () => {
        const asset = list.find(a => a.id === parseInt(item.dataset.aid));
        if (asset) openAssetDetail(asset, me, () => renderAssetSection(el, me));
      });
    });
  }
  ['asset-search','asset-f-dept','asset-f-emptype','asset-f-type','asset-f-status','asset-f-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const filtered = filterAssets(assets);
      const listEl = document.getElementById('asset-all-list');
      if (listEl) listEl.innerHTML = renderAssetList(filtered, 'manage');
      wireManageListClicks(filtered);
    });
  });

  el.querySelectorAll('.list-item[data-aid]').forEach(item => {
    item.addEventListener('click', () => {
      const asset = assets.find(a => a.id === parseInt(item.dataset.aid));
      if (asset) openAssetDetail(asset, me, () => renderAssetSection(el, me));
    });
  });
}

function openAssetDetail(asset, me, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const isOwner = asset.user_id === me.id;
  const isMentor = asset.mentor_id === me.id;
  const isHr = isHrOrBod(me);
  const isDeptMgr = me.role === 'manager' && asset.owner_department === me.department;
  const canEditFields = isOwner || isHr || isDeptMgr;
  const canDelete = isHr;
  const canConfirm = isMentor && !['confirmed', 'handed_over'].includes(asset.status);
  const canHandover = isHr && asset.status !== 'handed_over';
  const canReveal = isOwner || isMentor || isHr || isDeptMgr;

  openModal(asset.asset_name, `
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Loại</div><div class="detail-val">${esc(asset.asset_type || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Nền tảng</div><div class="detail-val">${esc(asset.platform || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Link</div><div class="detail-val" style="font-size:12px;word-break:break-all;">${asset.link ? `<a href="${esc(asset.link)}" target="_blank" rel="noopener">${esc(asset.link)}</a>` : '—'}</div></div>
      <div class="detail-item"><div class="detail-label">Người phụ trách</div><div class="detail-val">${esc(asset.responsible_name || asset.owner_name || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Mentor</div><div class="detail-val">${esc(asset.mentor_name || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Trạng thái</div><div class="detail-val">${assetStatusBadge(asset.status)}</div></div>
      <div class="detail-item"><div class="detail-label">Ngày dự kiến bàn giao</div><div class="detail-val">${asset.expected_handover_date ? fmtDate(asset.expected_handover_date) : '—'}</div></div>
    </div>
    <div class="field" style="margin-top:12px;">
      <label>Tài khoản đăng nhập</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <div id="asset-cred-val" style="flex:1;font-size:13px;font-family:monospace;background:var(--surface-2);padding:8px 10px;border-radius:8px;">${asset.has_credential ? '••••••••' : '—'}</div>
        ${asset.has_credential && canReveal ? `<button class="btn-secondary btn-sm" id="asset-cred-reveal">👁 Xem</button>` : ''}
      </div>
    </div>
    ${asset.note ? `<div class="field"><label>Ghi chú</label><div class="detail-val" style="font-weight:400;">${esc(asset.note)}</div></div>` : ''}
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>
    ${canConfirm ? `<button class="btn-primary" id="asset-confirm">✅ Xác nhận</button>` : ''}
    ${canHandover ? `<button class="btn-primary" id="asset-handover">📦 Đã bàn giao</button>` : ''}
    ${canDelete ? `<button class="btn-danger" id="asset-del">Xóa</button>` : ''}
    ${canEditFields ? `<button class="btn-primary" id="asset-edit">✏️ Sửa</button>` : ''}
  `);

  document.getElementById('asset-cred-reveal')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.revealAssetCredential(asset.id);
      document.getElementById('asset-cred-val').textContent = r.credential || '(trống)';
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  document.getElementById('asset-confirm')?.addEventListener('click', async () => {
    try { await api.updateAsset(asset.id, { status: 'confirmed' }); closeModal(); toast('Đã xác nhận', 'success'); onRefresh(); }
    catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('asset-handover')?.addEventListener('click', async () => {
    try { await api.updateAsset(asset.id, { status: 'handed_over' }); closeModal(); toast('Đã đánh dấu bàn giao', 'success'); onRefresh(); }
    catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('asset-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa tài sản "${asset.asset_name}"?`)) return;
    try { await api.deleteAsset(asset.id); closeModal(); toast('Đã xóa', 'success'); onRefresh(); }
    catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('asset-edit')?.addEventListener('click', () => {
    closeModal();
    openAssetForm(asset, me, onRefresh, {});
  });
}

async function openAssetForm(asset, me, onRefresh = noop, opts = {}) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!asset;
  const needOwnerPick = !isEdit && opts.forOwnerPick;
  let people = [];
  try { people = (await api.getUsersBasic()).users || []; } catch (_) {}
  // HCNS/BGĐ may pick anyone; a department manager picking on their behalf is limited
  // server-side to their own department (enforced in server.js), so show everyone here —
  // an out-of-scope pick is rejected on save with a clear error.
  const pickableUsers = people;

  openModal(isEdit ? 'Sửa tài sản' : 'Khai báo tài sản', `
    ${needOwnerPick ? `
    <div class="field"><label>Nhân sự *</label>
      <select id="af-owner">
        <option value="">-- Chọn nhân viên/TTS --</option>
        ${pickableUsers.map(u => `<option value="${u.id}">${esc(u.full_name)}${u.department ? ` (${esc(u.department)})` : ''}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="field"><label>Tên tài sản *</label><input type="text" id="af-name" value="${esc(asset?.asset_name || '')}" placeholder="VD: Fanpage Facebook ABC"/></div>
    <div class="input-row">
      <div class="field"><label>Loại</label><input type="text" id="af-type" value="${esc(asset?.asset_type || '')}" placeholder="Tài khoản MXH, Website..."/></div>
      <div class="field"><label>Nền tảng</label><input type="text" id="af-platform" value="${esc(asset?.platform || '')}" placeholder="Facebook, WordPress..."/></div>
    </div>
    <div class="field"><label>Link</label><input type="text" id="af-link" value="${esc(asset?.link || '')}" placeholder="https://..."/></div>
    <div class="field"><label>Tài khoản đăng nhập</label><input type="text" id="af-cred" placeholder="${isEdit && asset.has_credential ? 'Để trống nếu không đổi' : 'username / password...'}"/></div>
    <div class="field"><label>Người phụ trách</label><input type="text" id="af-resp" value="${esc(asset?.responsible_name || (!isEdit ? me.full_name : ''))}"/></div>
    <div class="field"><label>Mentor</label>
      <select id="af-mentor">
        <option value="">-- Chọn mentor --</option>
        ${people.map(u => `<option value="${u.id}" ${asset?.mentor_id === u.id ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Ngày dự kiến bàn giao</label><input type="date" id="af-expdate" value="${esc(asset?.expected_handover_date || '')}"/></div>
    <div class="field"><label>Trạng thái</label>
      <select id="af-status">
        <option value="active" ${(!asset || asset.status === 'active') ? 'selected' : ''}>Đang quản lý</option>
        <option value="pending_review" ${asset?.status === 'pending_review' ? 'selected' : ''}>Chờ kiểm tra</option>
        <option value="needs_update" ${asset?.status === 'needs_update' ? 'selected' : ''}>Cần bổ sung</option>
      </select>
    </div>
    <div class="field"><label>Ghi chú</label><textarea id="af-note" rows="3">${esc(asset?.note || '')}</textarea></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="af-save">Lưu</button>
  `);

  document.getElementById('af-save').addEventListener('click', async () => {
    const name = document.getElementById('af-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên tài sản', 'error'); return; }
    let ownerId = null;
    if (needOwnerPick) {
      ownerId = document.getElementById('af-owner').value;
      if (!ownerId) { toast('Vui lòng chọn nhân sự', 'error'); return; }
    }
    const mentorSel = document.getElementById('af-mentor');
    const mentorId = mentorSel.value ? parseInt(mentorSel.value) : null;
    const mentorName = mentorId ? mentorSel.options[mentorSel.selectedIndex].textContent : '';
    const cred = document.getElementById('af-cred').value;
    const data = {
      asset_name: name,
      asset_type: document.getElementById('af-type').value.trim(),
      platform: document.getElementById('af-platform').value.trim(),
      link: document.getElementById('af-link').value.trim(),
      responsible_name: document.getElementById('af-resp').value.trim(),
      mentor_id: mentorId,
      mentor_name: mentorName,
      status: document.getElementById('af-status').value,
      note: document.getElementById('af-note').value.trim(),
      expected_handover_date: document.getElementById('af-expdate').value || null,
    };
    if (cred) data.credential = cred;
    if (ownerId) data.user_id = parseInt(ownerId);
    const btn = document.getElementById('af-save');
    btn.disabled = true;
    try {
      if (isEdit) await api.updateAsset(asset.id, data);
      else await api.createAsset(data);
      closeModal(); toast(isEdit ? 'Đã cập nhật' : 'Đã khai báo', 'success'); onRefresh();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });
}
