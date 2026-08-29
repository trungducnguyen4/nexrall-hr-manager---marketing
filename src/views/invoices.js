import { api } from '../api.js?v=20260722-payroll-export-ux';
import { EventBus } from '../event-bus.js';
import { esc, fmtMoney, fmtDateTime, invStatusBadge, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination, sortVietnameseNames, compareVietnameseNames } from '../utils.js?v=20260722-payroll-export-ux';
import { payslipDetailHTML, hydratePayslipAttendance, preparePayslipModal } from './payslip-detail.js';
import { icon } from '../icons.js';

export async function renderInvoices(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div class="page-title">${icon('creditCard', 'lg')} <span>Phiếu lương</span></div>
        <div class="page-sub">Quản lý phiếu lương nhân viên</div>
      </div>
      ${isManager ? `<button id="btn-new-inv" class="btn-primary btn-sm">${icon('plus', 'xs')} <span>Tạo phiếu</span></button>` : ''}
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
          <option value="issued">Đã phát hành</option>
          <option value="employee_confirmed">Đã xác nhận</option>
          <option value="review_requested">Yêu cầu xem lại</option>
          <option value="paid">Đã trả</option>
        </select>
      ` : ''}
    </div>

    ${isManager ? `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;"><input type="text" id="inv-search" placeholder="Tìm theo tên, mã, email..." style="flex:2;min-width:220px;"/><select id="inv-dept-filter" style="flex:1;min-width:180px;"><option value="">Tất cả phòng ban</option>${DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select></div>` : ''}

    <div id="inv-list">${loadingHTML()}</div>
  `;

  let users = [];
  let currentPage = 1;
  if (isManager) {
    try {
      users = sortVietnameseNames((await api.getUsers()).users || [], 'full_name');
      const sel = document.getElementById('inv-user-filter');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.full_name;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { currentPage = 1; loadInvoices(); });
      document.getElementById('inv-status-filter').addEventListener('change', () => { currentPage = 1; loadInvoices(); });
    } catch(_) {}
  }

  document.getElementById('inv-month-filter').addEventListener('change', () => { currentPage = 1; loadInvoices(); });
  document.getElementById('inv-search')?.addEventListener('input', () => { currentPage = 1; loadInvoices(); });
  document.getElementById('inv-dept-filter')?.addEventListener('change', () => { currentPage = 1; loadInvoices(); });

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
      let filteredInvoices = invoices || [];
      if (isManager) {
        filteredInvoices = filterBySearch(filteredInvoices, document.getElementById('inv-search')?.value || '', ['full_name', 'employee_code', 'invoice_number']);
        filteredInvoices = filterByDepartment(filteredInvoices, document.getElementById('inv-dept-filter')?.value || '', ['department']);
        filteredInvoices = sortVietnameseNames(filteredInvoices, 'full_name');
      }
      const pageData = paginateRows(filteredInvoices, currentPage);
      currentPage = pageData.page;
      if (!filteredInvoices.length) { listEl.innerHTML = emptyHTML('💰', 'Không có phiếu lương nào'); return; }
      listEl.innerHTML = pageData.rows.map(inv => `
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
      `).join('') + paginationHTML(pageData);
      listEl.querySelectorAll('.invoice-card').forEach(card => {
        card.addEventListener('click', () => openInvoiceDetail(parseInt(card.dataset.inv), isManager, users, loadInvoices, me));
      });
      bindPagination(listEl, page => { currentPage = page; loadInvoices(); });
    } catch(e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  document.getElementById('btn-new-inv')?.addEventListener('click', () => {
    openCreateInvoiceModal(users, loadInvoices);
  });

  el._cleanup = () => {};

  EventBus.bindView(el, 'invoices', () => loadInvoices());
  EventBus.bindView(el, 'invoices:*', () => loadInvoices());
  EventBus.bindView(el, 'payroll', () => loadInvoices());
  EventBus.bindView(el, 'payroll:*', () => loadInvoices());

  loadInvoices();
}

function reviewCategoryLabel(category) {
  return {
    attendance: 'Chấm công',
    bonus: 'Thưởng/KPI',
    deduction: 'Khấu trừ',
    base_salary: 'Lương cơ bản',
    bank_info: 'Thông tin ngân hàng',
    other: 'Khác',
  }[category] || category || '—';
}

function openInvoiceReviewModal(inv, onRefresh = noop) {
  openModal('Yêu cầu xem lại phiếu lương', `
    <div style="display:grid;gap:12px;">
      <div style="background:#EEF2FF;border:1px solid #C7D2FE;color:#3730A3;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
        Gửi nội dung cần kiểm tra để HCNS đối chiếu. Phiếu sẽ chuyển sang trạng thái yêu cầu xem lại.
      </div>
      <div class="field">
        <label>Loại vấn đề</label>
        <select id="inv-review-category">
          <option value="attendance">Chấm công</option>
          <option value="bonus">Thưởng/KPI</option>
          <option value="deduction">Khấu trừ</option>
          <option value="base_salary">Lương cơ bản</option>
          <option value="bank_info">Thông tin ngân hàng</option>
          <option value="other">Khác</option>
        </select>
      </div>
      <div class="field">
        <label>Nội dung cần xem lại *</label>
        <textarea id="inv-review-message" rows="4" placeholder="Ví dụ: Em bị tính thiếu 1 ngày công ngày ..."></textarea>
      </div>
      <div class="field">
        <label>Số tiền đề nghị điều chỉnh (nếu có)</label>
        <input id="inv-review-amount" type="number" min="0" step="50000" value="0"/>
      </div>
    </div>
  `, `
    <button class="btn-secondary" id="inv-review-cancel">Hủy</button>
    <button class="btn-primary" id="inv-review-submit">Gửi yêu cầu</button>
  `);
  document.getElementById('inv-review-cancel')?.addEventListener('click', closeModal);
  document.getElementById('inv-review-submit')?.addEventListener('click', async () => {
    const btn = document.getElementById('inv-review-submit');
    const message = document.getElementById('inv-review-message')?.value.trim() || '';
    if (!message) { toast('Vui lòng nhập nội dung cần xem lại', 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';
    try {
      await api.requestInvoiceReview(inv.id, {
        category: document.getElementById('inv-review-category')?.value || 'other',
        message,
        requested_amount: Number(document.getElementById('inv-review-amount')?.value || 0),
      });
      closeModal();
      toast('Đã gửi yêu cầu xem lại phiếu lương', 'success');
      onRefresh();
    } catch (e) {
      toast(e.message || 'Không gửi được yêu cầu', 'error');
      btn.disabled = false;
      btn.textContent = 'Gửi yêu cầu';
    }
  });
}

function openResolveReviewModal(inv, onRefresh = noop) {
  const req = inv.latest_review_request || {};
  openModal('Xử lý yêu cầu xem lại', `
    <div style="display:grid;gap:12px;">
      <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
        <strong>${esc(reviewCategoryLabel(req.category))}</strong><br>
        ${esc(req.message || inv.review_reason || '—')}
        ${Number(req.requested_amount || 0) > 0 ? `<br>Đề nghị điều chỉnh: <strong>${fmtMoney(req.requested_amount)}</strong>` : ''}
      </div>
      <div class="field">
        <label>Kết quả xử lý *</label>
        <textarea id="inv-resolve-note" rows="4" placeholder="Ví dụ: Đã đối chiếu chấm công và cập nhật lại bảng lương."></textarea>
      </div>
      <div class="field">
        <label>Trạng thái sau xử lý</label>
        <select id="inv-resolve-status">
          <option value="issued">Phát hành lại để nhân viên kiểm tra</option>
          <option value="employee_confirmed">Chốt xác nhận, không cần nhân viên xác nhận lại</option>
        </select>
      </div>
    </div>
  `, `
    <button class="btn-secondary" id="inv-resolve-cancel">Hủy</button>
    <button class="btn-primary" id="inv-resolve-submit">Lưu xử lý</button>
  `);
  document.getElementById('inv-resolve-cancel')?.addEventListener('click', closeModal);
  document.getElementById('inv-resolve-submit')?.addEventListener('click', async () => {
    const btn = document.getElementById('inv-resolve-submit');
    const note = document.getElementById('inv-resolve-note')?.value.trim() || '';
    if (!note) { toast('Vui lòng nhập ghi chú xử lý', 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    try {
      await api.resolveInvoiceReview(inv.id, {
        note,
        nextStatus: document.getElementById('inv-resolve-status')?.value || 'issued',
      });
      closeModal();
      toast('Đã xử lý yêu cầu xem lại', 'success');
      onRefresh();
    } catch (e) {
      toast(e.message || 'Không xử lý được yêu cầu', 'error');
      btn.disabled = false;
      btn.textContent = 'Lưu xử lý';
    }
  });
}

function openInvoiceDetail(invId, isManager, users, onRefresh = noop, me = null) {
  onRefresh = safeCb(onRefresh);
  openModal('Chi tiết phiếu lương', loadingHTML(), '');
  preparePayslipModal();
  api.getInvoice(invId).then(({ invoice: inv }) => {
    document.getElementById('modal-body').innerHTML = `
      <div style="text-align:center;padding:8px 0 16px;">
        <div style="font-size:18px;font-weight:800;">${esc(inv.full_name)}</div>
        <div style="font-size:12px;color:var(--text-2);">${esc(inv.invoice_number)} · T${inv.month}/${inv.year}</div>
        <div style="margin-top:6px;">${invStatusBadge(inv.status)}</div>
      </div>
      ${!isManager && inv.status === 'issued' ? `
        <div style="background:#EEF2FF;border:1px solid #C7D2FE;color:#3730A3;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;line-height:1.5;">
          Vui lòng kiểm tra phiếu lương. Nếu số liệu đúng, hãy xác nhận; nếu cần đối chiếu, gửi yêu cầu xem lại cho HCNS.
        </div>
      ` : ''}
      ${inv.status === 'review_requested' ? `
        <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;line-height:1.5;">
          <strong>Yêu cầu xem lại:</strong> ${esc(inv.latest_review_request?.message || inv.review_reason || 'Đang chờ HCNS xử lý.')}
          ${inv.latest_review_request?.category ? `<br>Loại vấn đề: ${esc(reviewCategoryLabel(inv.latest_review_request.category))}` : ''}
        </div>
      ` : ''}
      <div style="background:var(--bg);border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;"><span>Lương cơ bản</span><span style="font-weight:600">${fmtMoney(inv.base_salary)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--success)"><span>Thưởng</span><span>+${fmtMoney(inv.bonus)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--success)"><span>Phụ cấp</span><span>+${fmtMoney(inv.allowance)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--success)"><span>Làm thêm giờ</span><span>+${fmtMoney(inv.overtime_pay || 0)}</span></div>
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
        <div class="detail-item"><div class="detail-label">OT đã duyệt</div><div class="detail-val">${Number(inv.approved_overtime_minutes || 0) / 60} giờ</div></div>
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
    document.getElementById('modal-body').innerHTML = payslipDetailHTML(inv, { source: 'invoice' });
    hydratePayslipAttendance();
    if (isManager && !(inv.locked_at || inv.status === 'paid')) {
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn-danger" id="inv-del-btn">Xóa</button>
        <select id="inv-status-sel" style="flex:1;border:1.5px solid var(--border);border-radius:8px;padding:8px;font-size:13px;">
          <option value="draft" ${inv.status==='draft'?'selected':''}>Nháp</option>
          <option value="pending" ${inv.status==='pending'?'selected':''}>Chờ duyệt</option>
          <option value="approved" ${inv.status==='approved'?'selected':''}>Đã duyệt</option>
          <option value="issued" ${inv.status==='issued'?'selected':''}>Đã phát hành</option>
          <option value="employee_confirmed" ${inv.status==='employee_confirmed'?'selected':''}>Đã xác nhận</option>
          <option value="review_requested" ${inv.status==='review_requested'?'selected':''}>Yêu cầu xem lại</option>
          <option value="paid" ${inv.status==='paid'?'selected':''}>Đã trả</option>
        </select>
        ${inv.status === 'review_requested' ? `<button class="btn-secondary" id="inv-resolve-review">Xử lý yêu cầu</button>` : ''}
        <button class="btn-primary" id="inv-save-status">Lưu</button>
      `;
      document.getElementById('inv-resolve-review')?.addEventListener('click', () => openResolveReviewModal(inv, onRefresh));
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
    } else if (!isManager && inv.status === 'issued') {
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn-secondary" id="inv-review-request-btn">Yêu cầu xem lại</button>
        <button class="btn-primary" id="inv-confirm-btn">Xác nhận đúng</button>
      `;
      document.getElementById('inv-review-request-btn')?.addEventListener('click', () => openInvoiceReviewModal(inv, onRefresh));
      document.getElementById('inv-confirm-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('inv-confirm-btn');
        btn.disabled = true;
        btn.textContent = 'Đang xác nhận...';
        try {
          await api.confirmInvoice(inv.id);
          closeModal();
          toast('Đã xác nhận phiếu lương', 'success');
          onRefresh();
        } catch (e) {
          toast(e.message || 'Không xác nhận được phiếu lương', 'error');
          btn.disabled = false;
          btn.textContent = 'Xác nhận đúng';
        }
      });
    } else if (!isManager && inv.status === 'review_requested') {
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn-secondary w-full" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>
      `;
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
