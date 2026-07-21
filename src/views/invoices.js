import { api } from '../api.js';
import { esc, fmtMoney, fmtDateTime, invStatusBadge, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb } from '../utils.js';
import { navigate } from '../app.js';

export async function renderInvoices(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div class="page-title">💰 Phiếu lương</div>
        <div class="page-sub">Quản lý phiếu lương nhân viên</div>
      </div>
      ${isManager ? `<button id="btn-new-inv" class="btn-primary btn-sm">+ Tạo phiếu</button>` : ''}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <input type="month" id="inv-month-filter" value="${new Date().toISOString().slice(0,7)}" style="flex:1;min-width:140px;"/>
      ${isManager ? `
        <select id="inv-user-filter" style="flex:2;min-width:160px;">
          <option value="">-- Tất cả --</option>
        </select>
        <select id="inv-status-filter" style="flex:1;min-width:120px;">
          <option value="">-- Trạng thái --</option>
          <option value="draft">Nháp</option>
          <option value="pending">Chờ duyệt</option>
          <option value="approved">Đã duyệt</option>
          <option value="paid">Đã trả</option>
        </select>
      ` : ''}
    </div>

    <div id="inv-list">${loadingHTML()}</div>
  `;

  let users = [];
  if (isManager) {
    try {
      users = (await api.getUsers()).users || [];
      const sel = document.getElementById('inv-user-filter');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.full_name;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', loadInvoices);
      document.getElementById('inv-status-filter').addEventListener('change', loadInvoices);
    } catch(_) {}
  }

  document.getElementById('inv-month-filter').addEventListener('change', loadInvoices);

  async function loadInvoices() {
    const listEl = document.getElementById('inv-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const monthVal = document.getElementById('inv-month-filter')?.value || '';
    const [year, month] = monthVal.split('-');
    const params = {};
    if (month) params.month = month;
    if (year) params.year = year;
    if (isManager) {
      const uid = document.getElementById('inv-user-filter')?.value;
      const status = document.getElementById('inv-status-filter')?.value;
      if (uid) params.userId = uid;
      if (status) params.status = status;
    }
    try {
      const { invoices } = await api.getInvoices(params);
      if (!invoices.length) { listEl.innerHTML = emptyHTML('💰', 'Không có phiếu lương nào'); return; }
      listEl.innerHTML = invoices.map(inv => `
        <div class="invoice-card" data-inv="${inv.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
            <div>
              <div style="font-weight:700;font-size:14px;">${esc(inv.full_name)}</div>
              <div class="invoice-number">${esc(inv.invoice_number)}</div>
            </div>
            ${invStatusBadge(inv.status)}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="invoice-amount">${fmtMoney(inv.net_salary)}</div>
            <div class="invoice-meta">T${inv.month}/${inv.year} · ${inv.work_days||0} ngày</div>
          </div>
          ${inv.department ? `<div style="font-size:11px;color:var(--text-2);margin-top:4px;">${esc(inv.department)} · ${esc(inv.position||'')}</div>` : ''}
        </div>
      `).join('');
      listEl.querySelectorAll('.invoice-card').forEach(card => {
        card.addEventListener('click', () => openInvoiceDetail(parseInt(card.dataset.inv), isManager, users, loadInvoices));
      });
    } catch(e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  document.getElementById('btn-new-inv')?.addEventListener('click', () => {
    openCreateInvoiceModal(users, loadInvoices);
  });

  loadInvoices();
}

function openInvoiceDetail(invId, isManager, users, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  openModal('Chi tiết phiếu lương', loadingHTML(), '');
  document.getElementById('modal')?.classList.add('modal--scroll-fixed');
  api.getInvoice(invId).then(({ invoice: inv }) => {
    document.getElementById('modal-body').innerHTML = `
      <div style="text-align:center;padding:8px 0 16px;">
        <div style="font-size:18px;font-weight:800;">${esc(inv.full_name)}</div>
        <div style="font-size:12px;color:var(--text-2);">${esc(inv.invoice_number)} · T${inv.month}/${inv.year}</div>
        <div style="margin-top:6px;">${invStatusBadge(inv.status)}</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;"><span>Lương cơ bản</span><span style="font-weight:600">${fmtMoney(inv.base_salary)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--success)"><span>Thưởng</span><span>+${fmtMoney(inv.bonus)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--success)"><span>Phụ cấp</span><span>+${fmtMoney(inv.allowance)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--danger)"><span>Khấu trừ</span><span>-${fmtMoney(inv.deduction)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--danger)"><span>Thuế TNCN (10%)</span><span>-${fmtMoney(inv.tax)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:0;font-size:13px;color:var(--danger)"><span>BHXH/BHYT (8%)</span><span>-${fmtMoney(inv.insurance)}</span></div>
        <div style="border-top:2px solid var(--border);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;"><span style="font-weight:700;font-size:14px;">Thực nhận</span><span style="font-weight:800;font-size:18px;color:var(--primary)">${fmtMoney(inv.net_salary)}</span></div>
      </div>
      <div class="modal-section-title">Dữ liệu công</div>
      <div class="detail-grid" style="margin-bottom:10px;">
        <div class="detail-item"><div class="detail-label">Ngày công chuẩn</div><div class="detail-val">${inv.standard_days ?? '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Ngày công thực tế</div><div class="detail-val">${inv.work_days ?? '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Nghỉ có phép</div><div class="detail-val">${inv.paid_leave_days ?? '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Nghỉ không phép</div><div class="detail-val">${inv.absent_days ?? '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Số phút đi muộn</div><div class="detail-val">${inv.late_minutes ?? '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Số phút về sớm</div><div class="detail-val">${inv.early_leave_minutes ?? '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Thiếu check-in/out</div><div class="detail-val">${inv.missing_checkinout_days ?? '—'}</div></div>
      </div>
      <div class="source-tag-row">
        <span class="source-tag">Chấm công <span class="badge-auto">Tự động</span></span>
        <span class="source-tag">Nghỉ phép <span class="badge-auto">Tự động</span></span>
        <span class="source-tag">Hợp đồng <span class="badge-auto">Tự động</span></span>
        <span class="source-tag">Đánh giá <span class="badge-auto">Tự động</span></span>
      </div>
      <button class="btn-secondary btn-sm" id="inv-view-attendance" style="margin-bottom:4px;">📅 Xem chi tiết chấm công</button>
      ${inv.bank_account ? `<div style="font-size:12px;color:var(--text-2);background:var(--bg);padding:10px;border-radius:8px;margin-top:6px;">🏦 ${esc(inv.bank_name||'')} · ${esc(inv.bank_account)}</div>` : ''}
      ${inv.note ? `<div style="font-size:12px;color:var(--text-2);margin-top:8px;">📝 ${esc(inv.note)}</div>` : ''}

      <div class="modal-section-title">Quy trình xử lý</div>
      <div>
        <div class="workflow-row"><span class="wf-label">Trạng thái hiện tại</span><span class="wf-val">${invStatusBadge(inv.status)}</span></div>
        <div class="workflow-row"><span class="wf-label">Người đang cần xử lý</span><span class="wf-val">${esc(inv.pending_actor || '—')}</span></div>
        <div class="workflow-row"><span class="wf-label">Người xác nhận</span><span class="wf-val">${esc(inv.confirmed_by || '—')}</span></div>
        <div class="workflow-row"><span class="wf-label">Người kiểm tra</span><span class="wf-val">${esc(inv.checked_by || '—')}</span></div>
        <div class="workflow-row"><span class="wf-label">Người phê duyệt</span><span class="wf-val">${esc(inv.approved_by || '—')}</span></div>
        <div class="workflow-row"><span class="wf-label">Thời gian thao tác</span><span class="wf-val">${inv.created_at ? fmtDateTime(inv.created_at) : '—'}</span></div>
      </div>
    `;
    document.getElementById('inv-view-attendance')?.addEventListener('click', () => {
      closeModal();
      navigate('#/attendance');
    });
    if (isManager) {
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn-danger" id="inv-del-btn">Xóa</button>
        <select id="inv-status-sel" style="flex:1;border:1.5px solid var(--border);border-radius:8px;padding:8px;font-size:13px;">
          <option value="draft" ${inv.status==='draft'?'selected':''}>Nháp</option>
          <option value="pending" ${inv.status==='pending'?'selected':''}>Chờ duyệt</option>
          <option value="approved" ${inv.status==='approved'?'selected':''}>Đã duyệt</option>
          <option value="paid" ${inv.status==='paid'?'selected':''}>Đã trả</option>
        </select>
        <button class="btn-primary" id="inv-save-status">Lưu</button>
      `;
      document.getElementById('inv-save-status').addEventListener('click', async () => {
        try {
          await api.updateInvoice(invId, { ...inv, status: document.getElementById('inv-status-sel').value });
          closeModal(); toast('Đã cập nhật', 'success'); onRefresh();
        } catch(e) { toast(e.message, 'error'); }
      });
      document.getElementById('inv-del-btn').addEventListener('click', async () => {
        if (!confirm('Xóa phiếu lương này?')) return;
        try { await api.deleteInvoice(invId); closeModal(); toast('Đã xóa', 'success'); onRefresh(); }
        catch(e) { toast(e.message, 'error'); }
      });
    } else {
      document.getElementById('modal-footer').innerHTML = `<button class="btn-secondary w-full" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>`;
    }
  }).catch(e => {
    document.getElementById('modal-body').innerHTML = emptyHTML('⚠️', e.message);
  });
}

function openCreateInvoiceModal(users, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  openModal('Tạo phiếu lương', `
    <div class="field"><label>Nhân viên *</label>
      <select id="ci-user">
        <option value="">-- Chọn nhân viên --</option>
        ${users.map(u => `<option value="${u.id}" data-salary="${u.salary||0}">${esc(u.full_name)}</option>`).join('')}
      </select>
    </div>
    <div class="input-row">
      <div class="field"><label>Tháng *</label><input type="number" id="ci-month" value="${new Date().getMonth()+1}" min="1" max="12"/></div>
      <div class="field"><label>Năm *</label><input type="number" id="ci-year" value="${new Date().getFullYear()}"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Lương cơ bản</label><input type="number" id="ci-base" value="0"/></div>
      <div class="field"><label>Thưởng</label><input type="number" id="ci-bonus" value="0"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Phụ cấp</label><input type="number" id="ci-allow" value="0"/></div>
      <div class="field"><label>Khấu trừ</label><input type="number" id="ci-deduct" value="0"/></div>
    </div>
    <div class="input-row">
      <div class="field">
        <label>Ngày công <span style="font-weight:400;color:var(--text-2);font-size:11px;">(Tự động từ chấm công)</span></label>
        <input type="text" id="ci-wdays-display" value="—" readonly disabled style="background:var(--bg);color:var(--text-2);"/>
      </div>
      <div class="field"><label>Ngày vắng</label><input type="number" id="ci-adays" value="0"/></div>
    </div>
    <div id="ci-att-summary" style="margin:-6px 0 4px;font-size:12px;min-height:16px;"></div>
    <div class="field"><label>Ghi chú</label><input type="text" id="ci-note" placeholder=""/></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="ci-save">Tạo phiếu</button>
  `);

  // Auto-filled from GET /api/attendance/summary — null until a valid load completes.
  let attSummary = null;
  let attLoading = false;

  function setSaveEnabled() {
    const btn = document.getElementById('ci-save');
    if (btn) btn.disabled = attLoading || !attSummary;
  }

  async function loadAttendanceSummary() {
    const userId = document.getElementById('ci-user').value;
    const month = parseInt(document.getElementById('ci-month').value);
    const year = parseInt(document.getElementById('ci-year').value);
    const box = document.getElementById('ci-att-summary');
    const disp = document.getElementById('ci-wdays-display');
    attSummary = null;
    if (!userId || !month || !year) {
      if (box) box.innerHTML = '';
      if (disp) disp.value = '—';
      setSaveEnabled();
      return;
    }
    attLoading = true;
    setSaveEnabled();
    if (disp) disp.value = 'Đang tải…';
    if (box) box.innerHTML = `<span style="color:var(--text-2);">⏳ Đang tải dữ liệu chấm công…</span>`;
    try {
      const s = await api.getAttendanceSummary({ userId, month, year });
      attSummary = s;
      if (disp) disp.value = `${s.actualWorkDays} / ${s.standardWorkDays} công`;
      if (box) {
        box.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;color:var(--text-2);">
          <span>Đủ ngày: <strong style="color:var(--text);">${s.fullDays}</strong></span>
          <span>Nửa ngày: <strong style="color:var(--text);">${s.halfDays}</strong></span>
          <span>Đi muộn: <strong style="color:var(--text);">${s.lateMinutes}p</strong></span>
          <span>Về sớm: <strong style="color:var(--text);">${s.earlyLeaveMinutes}p</strong></span>
          ${s.incompleteDays > 0 ? `<span style="color:var(--danger);font-weight:600;width:100%;">⚠️ ${s.incompleteDays} ngày thiếu check-in/out — Cần HCNS kiểm tra</span>` : ''}
        </div>`;
      }
    } catch (e) {
      attSummary = null;
      if (disp) disp.value = '—';
      if (box) box.innerHTML = `<span style="color:var(--danger);">⚠️ Không thể tải dữ liệu chấm công</span> <button type="button" class="btn-xs btn-secondary" id="ci-att-retry">Thử lại</button>`;
      document.getElementById('ci-att-retry')?.addEventListener('click', loadAttendanceSummary);
    }
    attLoading = false;
    setSaveEnabled();
  }

  // Auto-fill salary + attendance data
  document.getElementById('ci-user').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    document.getElementById('ci-base').value = opt.dataset.salary || 0;
    loadAttendanceSummary();
  });
  document.getElementById('ci-month').addEventListener('change', loadAttendanceSummary);
  document.getElementById('ci-year').addEventListener('change', loadAttendanceSummary);
  setSaveEnabled();

  document.getElementById('ci-save').addEventListener('click', async () => {
    const userId = document.getElementById('ci-user').value;
    const month = parseInt(document.getElementById('ci-month').value);
    const year = parseInt(document.getElementById('ci-year').value);
    if (!userId) { toast('Chọn nhân viên', 'error'); return; }
    if (!attSummary) { toast('Vui lòng chờ tải dữ liệu chấm công trước khi tạo phiếu', 'error'); return; }
    const btn = document.getElementById('ci-save');
    if (btn) btn.disabled = true;
    try {
      await api.createInvoice({
        user_id: parseInt(userId),
        month, year,
        base_salary: parseFloat(document.getElementById('ci-base').value) || 0,
        bonus: parseFloat(document.getElementById('ci-bonus').value) || 0,
        allowance: parseFloat(document.getElementById('ci-allow').value) || 0,
        deduction: parseFloat(document.getElementById('ci-deduct').value) || 0,
        work_days: attSummary.actualWorkDays,
        standard_days: attSummary.standardWorkDays,
        late_minutes: attSummary.lateMinutes,
        early_leave_minutes: attSummary.earlyLeaveMinutes,
        missing_checkinout_days: attSummary.incompleteDays,
        absent_days: parseInt(document.getElementById('ci-adays').value) || 0,
        note: document.getElementById('ci-note').value,
        status: 'draft',
      });
      closeModal(); toast('Đã tạo phiếu lương', 'success'); onRefresh();
    } catch(e) {
      toast(e.message, 'error');
      if (btn) btn.disabled = false;
    }
  });
}
