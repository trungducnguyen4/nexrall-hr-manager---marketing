import { api } from '../api.js?v=20260722-payroll-export-ux';
import { esc, fmtMoney, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination, avatarColor, initials } from '../utils.js?v=20260722-payroll-export-ux';
import { payslipDetailHTML, hydratePayslipAttendance, preparePayslipModal } from './payslip-detail.js';

function formatMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return month || '';
  const [year, mm] = month.split('-');
  return `${mm}/${year}`;
}

function payrollStatusBadge(p) {
  const status = p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config');
  return status === 'missing_salary_config'
    ? '<span class="payroll-badge payroll-badge--warn">Thiếu cấu hình lương</span>'
    : '<span class="payroll-badge payroll-badge--ok">Đủ dữ liệu</span>';
}

function payrollReady(p) {
  return (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready';
}

function payrollMoney(value, ready) {
  const n = Number(value || 0);
  // Always show non-zero amounts (e.g. deductions applied via adjustments)
  // even when the payroll row is missing salary config.
  if (n === 0) return '—';
  return fmtMoney(n);
}

// Memoize row HTML per row signature so editing one row doesn't re-render all rows.
const payrollRowCache = new Map();
function payrollRowHTML(p) {
  const ready = payrollReady(p);
  const net = (p.base_salary || 0) + (p.kpi_bonus || 0) + (p.allowance || 0) - (p.deduction || 0);
  const sig = [p.id, p.employee_name, p.employee_code, p.department, p.base_salary, p.kpi_bonus, p.allowance, p.deduction, p.data_status, ready].join('|');
  const cached = payrollRowCache.get(p.id);
  if (cached && cached.sig === sig) return cached.html;
  const color = avatarColor(p.employee_name || '?');
  const ini = initials(p.employee_name || '?');
  const html = `
    <tr class="payroll-row" data-pid="${p.id}" tabindex="0" role="button" aria-label="Mở phiếu lương của ${esc(p.employee_name || 'nhân viên')}">
      <td class="payroll-col-employee" data-label="Nhân viên">
        <div class="payroll-employee">
          <span class="payroll-avatar" style="background:${color};">${ini}</span>
          <div class="payroll-employee-main">
            <div class="payroll-employee-name">${esc(p.employee_name || '—')}</div>
            <div class="payroll-employee-code">${esc(p.employee_code || '')}</div>
            ${payrollStatusBadge(p)}
          </div>
        </div>
      </td>
      <td class="payroll-col-dept" data-label="Phòng ban"><span class="payroll-dept">${esc(p.department || '—')}</span></td>
      <td class="payroll-col-money" data-label="Lương CB">${payrollMoney(p.base_salary, ready)}</td>
      <td class="payroll-col-money payroll-col-money--pos" data-label="KPI Bonus">${payrollMoney(p.kpi_bonus, ready)}</td>
      <td class="payroll-col-money payroll-col-money--pos" data-label="Phụ cấp">${payrollMoney(p.allowance, ready)}</td>
      <td class="payroll-col-money payroll-col-money--neg" data-label="Khấu trừ">${payrollMoney(p.deduction, ready)}</td>
      <td class="payroll-col-money payroll-col-net" data-label="Thực lĩnh"><strong>${payrollMoney(net, ready)}</strong></td>
      <td class="payroll-col-actions" data-label="">
        <button class="btn-xs btn-secondary pay-edit" data-pid="${p.id}" title="Sửa dòng lương" style="margin-right:4px;">✏️</button>
        <button class="btn-xs btn-danger pay-del" data-pid="${p.id}" title="Xóa dòng lương">🗑</button>
      </td>
    </tr>
  `;
  payrollRowCache.set(p.id, { sig, html });
  if (payrollRowCache.size > 500) payrollRowCache.delete(payrollRowCache.keys().next().value);
  return html;
}

export async function renderPayroll(el, me) {
  const isHr = me.role === 'admin' || me.role === 'manager';
  if (!isHr) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">Không có quyền truy cập</div></div>`;
    return;
  }

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let adjustmentData = { suggestions: [], approved: [] };
  let latestPayrollRows = [];
  let currentPage = 1;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">💰 Bảng lương</div>
        <div class="page-sub">Quản lý lương và KPI nhân viên</div>
      </div>
      <button id="btn-new-payroll" class="btn-primary btn-sm">+ Tạo bảng lương</button>
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <label style="font-size:13px;font-weight:600;color:var(--text-2);">Tháng:</label>
      <input type="month" id="payroll-month" value="${curMonth}" style="max-width:160px;font-weight:600;"/>
      <button id="btn-export-payslips" class="btn-primary" style="font-size:14px;font-weight:800;padding:11px 18px;min-height:44px;">Xuất phiếu lương tháng ${formatMonth(curMonth)}</button>
    </div>
    <div id="payroll-load-status" style="min-height:18px;font-size:12px;color:var(--text-2);margin:-8px 0 12px;"></div>

    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <input type="text" id="payroll-search" placeholder="Tìm theo tên, mã nhân viên..." style="flex:2;min-width:220px;"/>
      <select id="payroll-dept-filter" style="flex:1;min-width:180px;">
        <option value="">Tất cả phòng ban</option>
        ${DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
      </select>
    </div>

    <div id="payroll-summary" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px;"></div>
    <div id="payroll-adjustments" style="margin-bottom:18px;"></div>

    <div class="card" style="padding:0;">
      <div style="display:flex;justify-content:flex-end;padding:12px 12px 0;">
        <button id="btn-manual-payroll" class="btn-secondary btn-sm">+ Thêm dòng lương thủ công</button>
      </div>
      <div id="payroll-table">${loadingHTML()}</div>
    </div>
  `;

  const monthInput = document.getElementById('payroll-month');
  document.getElementById('btn-new-payroll').addEventListener('click', openCreatePayrollBatchConfirm);
  document.getElementById('btn-export-payslips').addEventListener('click', openExportPayslipsConfirm);
  document.getElementById('btn-manual-payroll').addEventListener('click', () => openPayrollLineForm(null, loadPayroll, monthInput.value));
  monthInput.addEventListener('change', () => {
    currentPage = 1;
    updateExportButtonLabel();
    loadPayroll();
  });
  document.getElementById('payroll-search').addEventListener('input', () => { currentPage = 1; loadPayroll(); });
  document.getElementById('payroll-dept-filter').addEventListener('change', () => { currentPage = 1; loadPayroll(); });

  function adjustmentSourceLabel(source) {
    const map = { evaluation: 'Đánh giá', attendance: 'Chấm công', tasks: 'Deadline', manual: 'Thủ công' };
    return map[source] || source || 'Nguồn';
  }

  function adjustmentTypeLabel(type) {
    const map = {
      bonus: 'Thưởng tiền',
      penalty: 'Phạt tiền',
      score_bonus: 'Cộng điểm',
      score_penalty: 'Trừ điểm',
      alert: 'Cảnh báo',
    };
    return map[type] || type || 'Đề xuất';
  }

  function updateExportButtonLabel() {
    const btn = document.getElementById('btn-export-payslips');
    if (btn) btn.textContent = `Xuất phiếu lương tháng ${formatMonth(monthInput.value)}`;
  }

  function approvedAdjustmentTone(a) {
    if (a.type === 'penalty') return { color: 'var(--danger)', bg: '#FEF2F2', border: '#FECACA', sign: '-' };
    if (a.type === 'bonus') return { color: 'var(--success)', bg: '#ECFDF5', border: '#A7F3D0', sign: '+' };
    return { color: 'var(--text-2)', bg: '#F8FAFC', border: 'var(--border)', sign: '' };
  }

  function renderAdjustmentPanel(month) {
    const el = document.getElementById('payroll-adjustments');
    if (!el) return;
    const suggestions = adjustmentData.suggestions || [];
    const approved = adjustmentData.approved || [];
    const totalSuggestedBonus = suggestions.filter(x => x.type === 'bonus').reduce((s, x) => s + Number(x.amount || 0), 0);
    const totalSuggestedPenalty = suggestions.filter(x => x.type === 'penalty').reduce((s, x) => s + Number(x.amount || 0), 0);
    el.innerHTML = `
      <div class="card" style="padding:0;">
        <div class="card-header" style="padding:12px 14px;border-bottom:1px solid var(--border);">
          <div>
            <div class="card-title">Đề xuất thưởng-phạt tháng ${formatMonth(month)}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px;">Tự động gợi ý từ đánh giá đã khóa, chấm công và deadline. HCNS xác nhận trước khi cộng/trừ lương.</div>
          </div>
          <button class="btn-secondary btn-sm" id="payroll-adjust-refresh">Làm mới đề xuất</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);">
          <div class="detail-item"><div class="detail-label">Chưa áp dụng</div><div class="detail-val">${suggestions.length}</div></div>
          <div class="detail-item"><div class="detail-label">Thưởng đề xuất</div><div class="detail-val" style="color:var(--success);">+${fmtMoney(totalSuggestedBonus)}</div></div>
          <div class="detail-item"><div class="detail-label">Phạt đề xuất</div><div class="detail-val" style="color:var(--danger);">-${fmtMoney(totalSuggestedPenalty)}</div></div>
        </div>
        ${suggestions.length ? `
          <div class="table-wrap" style="border:none;border-radius:0;">
            <table>
              <thead><tr><th></th><th>Nhân viên</th><th>Nguồn</th><th>Loại</th><th>Số tiền</th><th>Điểm</th><th>Lý do</th></tr></thead>
              <tbody>
                ${suggestions.map(s => `
                  <tr>
                    <td><input type="checkbox" class="adj-check" data-ref="${esc(s.source_ref)}" ${s.can_apply === false ? 'disabled' : 'checked'} title="${s.can_apply === false ? 'Cần đồng bộ/tạo dòng bảng lương trước' : ''}"></td>
                    <td><strong>${esc(s.employee_name || '—')}</strong><br><span style="font-size:11px;color:var(--text-3);">${esc(s.employee_code || '')}</span></td>
                    <td><span class="badge badge-gray">${esc(adjustmentSourceLabel(s.source))}</span></td>
                    <td>${esc(adjustmentTypeLabel(s.type))}</td>
                    <td>${s.amount > 0 ? `<input type="number" class="adj-amount" data-ref="${esc(s.source_ref)}" value="${Number(s.amount || 0)}" min="0" step="50000" style="width:120px;" ${s.can_apply === false ? 'disabled' : ''}>` : '—'}</td>
                    <td>${s.score_delta ? (s.score_delta > 0 ? '+' : '') + s.score_delta : '—'}</td>
                    <td style="white-space:normal;min-width:220px;font-size:12px;color:var(--text-2);">${esc(s.reason)}${s.can_apply === false ? '<br><span style="color:var(--warning);font-weight:700;">Cần đồng bộ/tạo dòng bảng lương trước khi áp dụng tiền.</span>' : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;">
            <button class="btn-primary btn-sm" id="payroll-adjust-apply">Áp dụng đề xuất đã chọn</button>
          </div>
        ` : `<div style="padding:14px;color:var(--text-2);font-size:13px;">Chưa có đề xuất mới. Các khoản mềm như sáng kiến/top tuần/báo cáo sẽ nhập thủ công khi có quyết định.</div>`}
        ${approved.length ? `
          <div style="padding:0 14px 14px;">
            <div class="section-title" style="margin-top:4px;">Đã áp dụng</div>
            <div style="display:grid;gap:6px;">
              ${approved.slice(0, 6).map(a => {
                const tone = approvedAdjustmentTone(a);
                const hasAmount = Number(a.amount || 0) > 0;
                return `
                  <div style="display:flex;justify-content:space-between;gap:12px;border:1px solid ${tone.border};background:${tone.bg};border-radius:8px;padding:9px 11px;font-size:12px;align-items:flex-start;">
                    <span style="color:${tone.color};line-height:1.45;"><strong>${esc(a.employee_name || '—')}</strong> · ${esc(adjustmentSourceLabel(a.source))} · ${esc(a.reason)}</span>
                    <span style="white-space:nowrap;color:${tone.color};font-weight:800;">${hasAmount ? tone.sign + fmtMoney(a.amount) : (a.score_delta || 'audit')}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
    document.getElementById('payroll-adjust-refresh')?.addEventListener('click', () => loadPayroll({ keepStatus: true }));
    document.getElementById('payroll-adjust-apply')?.addEventListener('click', applySelectedAdjustments);
  }

  async function applySelectedAdjustments() {
    const month = monthInput.value;
    const selectedRefs = Array.from(document.querySelectorAll('.adj-check:checked')).map(cb => cb.dataset.ref);
    if (!selectedRefs.length) { toast('Chọn ít nhất một đề xuất để áp dụng', 'error'); return; }
    const items = selectedRefs.map(ref => {
      const s = adjustmentData.suggestions.find(x => x.source_ref === ref);
      const amountInput = document.querySelector(`.adj-amount[data-ref="${CSS.escape(ref)}"]`);
      return { source_ref: ref, amount: amountInput ? Number(amountInput.value || 0) : s?.amount };
    });
    const btn = document.getElementById('payroll-adjust-apply');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang áp dụng...'; }
    try {
      const r = await api.applyPayrollAdjustments(month, items);
      toast(`Đã áp dụng ${r.applied || 0} đề xuất${r.skipped ? `, bỏ qua ${r.skipped}` : ''}`, 'success', 5000);
      await loadPayroll({ keepStatus: true });
    } catch (e) {
      toast(e.message || 'Không áp dụng được đề xuất', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Áp dụng đề xuất đã chọn'; }
    }
  }

  async function openCreatePayrollBatchConfirm() {
    const month = monthInput.value;
    if (!month) {
      toast('Vui lòng chọn tháng/năm trước khi tạo bảng lương', 'error');
      return;
    }
    const readyRows = latestPayrollRows.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready').length;
    const missingRows = latestPayrollRows.length - readyRows;

    openModal(`Tạo bảng lương tháng ${formatMonth(month)}`, `
      <div style="display:grid;gap:10px;">
        <div class="detail-item"><div class="detail-label">Dòng lương hiện có</div><div class="detail-val">${latestPayrollRows.length}</div></div>
        <div class="detail-item"><div class="detail-label">Đủ dữ liệu hiện tại</div><div class="detail-val">${readyRows}</div></div>
        <div class="detail-item"><div class="detail-label">Thiếu cấu hình hiện tại</div><div class="detail-val">${missingRows}</div></div>
        <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
          Hệ thống sẽ tạo hoặc cập nhật bảng lương tháng này từ danh sách nhân sự đang hoạt động. Các khoản thưởng/phạt đã áp dụng trên dòng lương hiện có vẫn được giữ lại.
        </div>
      </div>
    `, `
      <button class="btn-secondary" id="payroll-batch-cancel">Hủy</button>
      <button class="btn-primary" id="payroll-batch-create">Tạo bảng lương</button>
    `);

    document.getElementById('payroll-batch-cancel').addEventListener('click', closeModal);
    document.getElementById('payroll-batch-create').addEventListener('click', async () => {
      const btn = document.getElementById('payroll-batch-create');
      btn.disabled = true;
      btn.textContent = 'Đang tạo...';
      try {
        const r = await api.createPayrollBatch(month);
        closeModal();
        toast(`Đã tạo/cập nhật bảng lương tháng ${formatMonth(month)}: tạo mới ${r.created || 0}, cập nhật ${r.updated || 0}.`, 'success', 5000);
        await loadPayroll();
      } catch (e) {
        toast(e.message || 'Không tạo được bảng lương', e.status === 409 ? 'info' : 'error', 5000);
        btn.disabled = false;
        btn.textContent = 'Tạo bảng lương';
      }
    });
  }

  function openExportPayslipsConfirm() {
    const month = monthInput.value;
    const rows = latestPayrollRows || [];
    if (!month) { toast('Vui lòng chọn tháng/năm trước khi xuất phiếu lương', 'error'); return; }
    if (!rows.length) { toast('Chưa có dữ liệu bảng lương để xuất phiếu', 'error'); return; }
    const readyRows = rows.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready' && Number(p.base_salary || 0) > 0);
    const missingRows = rows.length - readyRows.length;
    openModal(`Xuất phiếu lương tháng ${formatMonth(month)}`, `
      <div style="display:grid;gap:12px;">
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">Tổng dòng lương</div><div class="detail-val">${rows.length}</div></div>
          <div class="detail-item"><div class="detail-label">Sẵn sàng phát hành</div><div class="detail-val" style="color:var(--success);">${readyRows.length}</div></div>
          <div class="detail-item"><div class="detail-label">Sẽ bỏ qua</div><div class="detail-val" style="color:var(--danger);">${missingRows}</div></div>
        </div>
        <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
          Thao tác này sẽ phát hành phiếu lương vào mục Phiếu lương của từng nhân viên. Phiếu đã trả, đã khóa hoặc đã được nhân viên xác nhận sẽ không bị ghi đè.
        </div>
        <div class="field">
          <label>Gõ <strong>xuatphieuluong</strong> hoặc <strong>XUATPHIEULUONG</strong> để xác nhận</label>
          <input id="export-payslip-confirm" type="text" autocomplete="off" placeholder="xuatphieuluong"/>
        </div>
        <div id="export-payslip-result" style="font-size:12px;color:var(--text-2);min-height:18px;"></div>
      </div>
    `, `
      <button class="btn-secondary" id="export-payslip-cancel">Hủy</button>
      <button class="btn-primary" id="export-payslip-submit" disabled>Xuất phiếu lương</button>
    `);
    const input = document.getElementById('export-payslip-confirm');
    const btn = document.getElementById('export-payslip-submit');
    const isConfirmed = () => (input?.value || '').trim().toLowerCase() === 'xuatphieuluong';
    document.getElementById('export-payslip-cancel')?.addEventListener('click', closeModal);
    input?.addEventListener('input', () => { if (btn) btn.disabled = !isConfirmed(); });
    btn?.addEventListener('click', async () => {
      const result = document.getElementById('export-payslip-result');
      btn.disabled = true;
      btn.textContent = 'Đang xuất...';
      if (result) result.textContent = 'Đang phát hành phiếu lương...';
      try {
        const r = await api.exportPayslips(month, input.value.trim().toLowerCase());
        closeModal();
        toast(`Đã xuất phiếu: tạo mới ${r.created || 0}, cập nhật ${r.updated || 0}, bỏ qua ${r.skipped || 0}.`, 'success', 6000);
        await loadPayroll({ keepStatus: true });
      } catch (e) {
        if (result) result.textContent = e.message || 'Không xuất được phiếu lương';
        toast(e.message || 'Không xuất được phiếu lương', 'error');
        btn.disabled = !isConfirmed();
        btn.textContent = 'Xuất phiếu lương';
      }
    });
  }

  async function loadPayroll(options = {}) {
    const tableEl = document.getElementById('payroll-table');
    const sumEl = document.getElementById('payroll-summary');
    const statusEl = document.getElementById('payroll-load-status');
    if (!tableEl) return;
    tableEl.innerHTML = loadingHTML();
    if (statusEl && !options.keepStatus) statusEl.textContent = 'Đang tải dữ liệu bảng lương...';
    const month = monthInput.value;
    try {
      const payrollRes = await api.getPayroll({ month });
      const payrolls = payrollRes.payroll || [];
      latestPayrollRows = payrolls;
      try {
        adjustmentData = await api.getPayrollAdjustmentSuggestions(month);
      } catch (_) {
        adjustmentData = { suggestions: [], approved: [] };
      }
      renderAdjustmentPanel(month);
      const totalBonus = payrolls.reduce((s, p) => s + (p.kpi_bonus || 0) + (p.allowance || 0), 0);
      const totalNet = payrolls.reduce((s, p) => s + (p.net_salary || 0), 0);
      const readyCount = payrolls.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready').length;
      const missingSalaryCount = payrolls.length - readyCount;
      let filtered = filterBySearch(payrolls, document.getElementById('payroll-search')?.value || '', ['employee_name', 'employee_code']);
      filtered = filterByDepartment(filtered, document.getElementById('payroll-dept-filter')?.value || '', ['department']);
      const pageData = paginateRows(filtered, currentPage);
      currentPage = pageData.page;

      if (sumEl) {
        sumEl.innerHTML = `
          <div class="stat-card" style="--stat-color:#6366F1;--stat-bg:#EEF2FF;">
            <div class="stat-icon-wrap">👥</div>
            <div class="stat-val">${payrolls.length}</div>
            <div class="stat-label">Nhân sự tháng ${month}</div>
          </div>
          <div class="stat-card" style="--stat-color:#10B981;--stat-bg:#D1FAE5;">
            <div class="stat-icon-wrap">💵</div>
            <div class="stat-val" style="font-size:16px;">${fmtMoney(totalNet)}</div>
            <div class="stat-label">Tổng thực lĩnh</div>
          </div>
          <div class="stat-card" style="--stat-color:#F59E0B;--stat-bg:#FEF3C7;">
            <div class="stat-icon-wrap">⚠️</div>
            <div class="stat-val" style="font-size:16px;">${missingSalaryCount}</div>
            <div class="stat-label">Thiếu cấu hình lương</div>
          </div>
        `;
      }

      if (!filtered.length) {
        if (statusEl && !options.keepStatus) statusEl.textContent = `Không có dữ liệu bảng lương tháng ${month}.`;
        tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('💰', `Không có dòng lương phù hợp`, 'Thử đổi từ khóa hoặc phòng ban')}</div>`;
        return;
      }
      if (statusEl && !options.keepStatus) statusEl.textContent = `Đã tải ${payrolls.length} dòng bảng lương tháng ${month}. Đang hiển thị ${filtered.length} dòng phù hợp.`;

      tableEl.innerHTML = `
        <div class="table-wrap payroll-table-wrap">
          <table class="payroll-table">
            <thead>
              <tr>
                <th class="payroll-col-employee">Nhân viên</th>
                <th class="payroll-col-dept">Phòng ban</th>
                <th class="payroll-col-money">Lương CB</th>
                <th class="payroll-col-money">KPI Bonus</th>
                <th class="payroll-col-money">Phụ cấp</th>
                <th class="payroll-col-money">Khấu trừ</th>
                <th class="payroll-col-money payroll-col-net">Thực lĩnh</th>
                <th class="payroll-col-actions">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${pageData.rows.map(p => payrollRowHTML(p)).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML(pageData)}
      `;

      tableEl.querySelectorAll('.pay-edit').forEach(btn => {
        btn.addEventListener('click', event => {
          event.stopPropagation();
          const p = payrolls.find(x => x.id === parseInt(btn.dataset.pid));
          if (p) openPayrollLineForm(p, loadPayroll, month);
        });
      });
      tableEl.querySelectorAll('.pay-del').forEach(btn => {
        btn.addEventListener('click', async event => {
          event.stopPropagation();
          if (!confirm('Xóa dòng lương này?')) return;
          try {
            await api.deletePayroll(btn.dataset.pid);
            toast('Đã xóa', 'success');
            loadPayroll();
          } catch (e) {
            toast(e.message, 'error');
          }
        });
      });
      tableEl.querySelectorAll('.payroll-row').forEach(row => {
        const open = () => {
          const payroll = payrolls.find(item => item.id === Number(row.dataset.pid));
          if (!payroll) return;
          openModal('Chi tiết phiếu lương', payslipDetailHTML(payroll, { source: 'payroll' }), '<button class="btn-secondary w-full" id="payslip-close">Đóng</button>');
          preparePayslipModal();
          document.getElementById('payslip-close')?.addEventListener('click', closeModal);
          hydratePayslipAttendance();
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
      bindPagination(tableEl, page => { currentPage = page; loadPayroll({ keepStatus: true }); });
    } catch (e) {
      if (statusEl) statusEl.textContent = `Lỗi tải dữ liệu: ${e.message || 'Không xác định'}`;
      tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('⚠️', e.message)}</div>`;
    } finally {
    }
  }

  loadPayroll();
}

function formatMoneyInput(value) {
  const n = Number(value || 0);
  return n === 0 ? '' : n.toLocaleString('vi-VN');
}

function unformatMoneyInput(str) {
  return parseInt(String(str || '').replace(/[^0-9]/g, ''), 10) || 0;
}

function openPayrollLineForm(pay, onRefresh = noop, currentMonth = '') {
  onRefresh = safeCb(onRefresh);
  const now = new Date();
  const defMonth = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isEdit = !!pay;
  const isReady = pay ? (pay.data_status || (Number(pay.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready' : false;
  const color = avatarColor(pay?.employee_name || '?');
  const ini = initials(pay?.employee_name || '?');

  const baseVal = Number(pay?.base_salary || 0);
  const kpiVal = Number(pay?.kpi_bonus || 0);
  const allowVal = Number(pay?.allowance || 0);
  const deductVal = Number(pay?.deduction || 0);

  openModal(isEdit ? 'Sửa dòng lương' : 'Thêm dòng lương thủ công', `
    <!-- Employee Info Card -->
    <div class="payedit-emp">
      <span class="payedit-avatar" style="background:${color};">${ini}</span>
      <div class="payedit-emp-info">
        <div class="payedit-emp-name">${esc(pay?.employee_name || '—')}</div>
        <div class="payedit-emp-meta">${esc(pay?.employee_code || '')} · ${esc(pay?.department || '—')}</div>
        <span class="payroll-badge ${isReady ? 'payroll-badge--ok' : 'payroll-badge--warn'}">${isReady ? 'Đủ dữ liệu' : 'Thiếu cấu hình lương'}</span>
      </div>
    </div>

    <!-- Period -->
    <div class="payedit-section">
      <div class="payedit-section-title">Kỳ lương</div>
      <div class="field">
        <input type="month" id="pf-month" value="${pay?.month || defMonth}" style="max-width:200px;"/>
      </div>
    </div>

    <!-- Income -->
    <div class="payedit-section">
      <div class="payedit-section-title">Khoản thu nhập</div>
      <div class="payedit-grid">
        <div class="field">
          <label>Lương cơ bản</label>
          <input type="text" id="pf-base" class="payedit-money" value="${formatMoneyInput(baseVal)}" placeholder="0" inputmode="numeric"/>
        </div>
        <div class="field">
          <label>KPI bonus</label>
          <input type="text" id="pf-kpi" class="payedit-money" value="${formatMoneyInput(kpiVal)}" placeholder="0" inputmode="numeric"/>
        </div>
        <div class="field">
          <label>Phụ cấp</label>
          <input type="text" id="pf-allow" class="payedit-money" value="${formatMoneyInput(allowVal)}" placeholder="0" inputmode="numeric"/>
        </div>
      </div>
    </div>

    <!-- Deductions -->
    <div class="payedit-section">
      <div class="payedit-section-title">Khoản khấu trừ</div>
      <div class="payedit-grid">
        <div class="field">
          <label>Khấu trừ</label>
          <input type="text" id="pf-deduct" class="payedit-money" value="${formatMoneyInput(deductVal)}" placeholder="0" inputmode="numeric"/>
        </div>
      </div>
    </div>

    <!-- Warnings -->
    <div id="pf-warnings" style="display:none;"></div>

    <!-- Summary -->
    <div class="payedit-summary" id="pf-summary-box">
      <div class="payedit-summary-row">
        <span>Tổng thu nhập</span>
        <span id="pf-total-income">0 ₫</span>
      </div>
      <div class="payedit-summary-row">
        <span>Tổng khấu trừ</span>
        <span id="pf-total-deduct" class="payedit-summary-val--neg">0 ₫</span>
      </div>
      <div class="payedit-summary-divider"></div>
      <div class="payedit-summary-row payedit-summary-row--net">
        <span>Thực nhận dự kiến</span>
        <span id="pf-net">0 ₫</span>
      </div>
      <div class="payedit-formula">= Lương CB + KPI bonus + Phụ cấp − Khấu trừ</div>
    </div>
  `, `
    <button class="btn-secondary" id="pf-cancel">Hủy</button>
    <button class="btn-primary" id="pf-save">Lưu thay đổi</button>
  `);

  // Apply payroll-edit modal class
  const modalEl = document.getElementById('modal');
  modalEl?.classList.add('modal--payroll-edit');

  document.getElementById('pf-cancel').addEventListener('click', closeModal);

  function readInputs() {
    return {
      base: unformatMoneyInput(document.getElementById('pf-base').value),
      kpi: unformatMoneyInput(document.getElementById('pf-kpi').value),
      allow: unformatMoneyInput(document.getElementById('pf-allow').value),
      deduct: unformatMoneyInput(document.getElementById('pf-deduct').value),
    };
  }

  function writeBack(vals) {
    document.getElementById('pf-base').value = formatMoneyInput(vals.base);
    document.getElementById('pf-kpi').value = formatMoneyInput(vals.kpi);
    document.getElementById('pf-allow').value = formatMoneyInput(vals.allow);
    document.getElementById('pf-deduct').value = formatMoneyInput(vals.deduct);
  }

  function updateNet() {
    const v = readInputs();
    const totalIncome = v.base + v.kpi + v.allow;
    const net = totalIncome - v.deduct;

    document.getElementById('pf-total-income').textContent = fmtMoney(totalIncome);
    document.getElementById('pf-total-deduct').textContent = fmtMoney(v.deduct);
    const netEl = document.getElementById('pf-net');
    netEl.textContent = fmtMoney(net);
    const summaryBox = document.getElementById('pf-summary-box');

    // Color the net based on sign
    if (net < 0) {
      netEl.style.color = 'var(--danger)';
      summaryBox.style.borderColor = '#FECACA';
    } else if (net > 0) {
      netEl.style.color = 'var(--success)';
      summaryBox.style.borderColor = 'var(--border)';
    } else {
      netEl.style.color = 'var(--text-2)';
      summaryBox.style.borderColor = 'var(--border)';
    }

    // Warnings
    const warnings = document.getElementById('pf-warnings');
    let warningHtml = '';
    const saveBtn = document.getElementById('pf-save');

    if (v.base <= 0 && !isReady) {
      warningHtml += `<div class="payedit-warn"><span>⚠️</span> Nhân viên chưa có lương cơ bản. Cần <a href="#/users${pay ? '/' + pay.employee_id : ''}" target="_blank">cấu hình lương</a> trước khi chốt bảng lương.</div>`;
    }
    if (net < 0) {
      warningHtml += `<div class="payedit-warn payedit-warn--error"><span>❌</span> Thực nhận đang âm. Vui lòng kiểm tra lại lương cơ bản hoặc khoản khấu trừ.</div>`;
    }
    if (v.deduct > totalIncome && totalIncome > 0) {
      warningHtml += `<div class="payedit-warn"><span>⚠️</span> Khấu trừ lớn hơn tổng thu nhập.</div>`;
    }

    warnings.innerHTML = warningHtml;
    warnings.style.display = warningHtml ? 'grid' : 'none';

    // Disable save if base <= 0 (missing salary config) or net < 0
    const invalid = (v.base <= 0 && !isReady) || net < 0;
    saveBtn.disabled = invalid;
    saveBtn.style.opacity = invalid ? '0.5' : '1';
  }

  // Money input formatting: show formatted while typing
  ['pf-base', 'pf-kpi', 'pf-allow', 'pf-deduct'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = el.value.replace(/[^0-9]/g, '');
      const n = parseInt(raw, 10) || 0;
      const cursor = el.selectionStart;
      const before = el.value;
      el.value = n === 0 && raw === '' ? '' : n.toLocaleString('vi-VN');
      // Restore cursor
      const diff = el.value.length - before.length;
      if (diff !== 0 && cursor !== null) {
        el.setSelectionRange(cursor + diff, cursor + diff);
      }
      updateNet();
    });
    el.addEventListener('blur', () => {
      const n = unformatMoneyInput(el.value);
      el.value = n === 0 ? '' : n.toLocaleString('vi-VN');
      updateNet();
    });
    el.addEventListener('keydown', (e) => {
      // Allow: backspace, delete, tab, escape, enter, arrows, home, end
      const allowed = [8, 46, 9, 27, 13, 37, 38, 39, 40, 35, 36];
      if (allowed.includes(e.keyCode) || (e.ctrlKey || e.metaKey)) return;
      // Only allow digits
      if (e.key.length === 1 && !/[0-9]/.test(e.key)) {
        e.preventDefault();
      }
    });
  });
  updateNet();

  let saving = false;
  document.getElementById('pf-save').addEventListener('click', async () => {
    if (saving) return;
    const v = readInputs();
    const net = v.base + v.kpi + v.allow - v.deduct;
    const month = document.getElementById('pf-month').value;
    if (!month) { toast('Vui lòng chọn tháng lương', 'error'); return; }
    if ((v.base <= 0 && !isReady) || net < 0) { toast('Không thể lưu khi dữ liệu không hợp lệ', 'error'); return; }

    saving = true;
    const saveBtn = document.getElementById('pf-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu...';

    try {
      const data = {
        employee_name: pay?.employee_name || '',
        month,
        base_salary: v.base,
        kpi_bonus: v.kpi,
        allowance: v.allow,
        deduction: v.deduct,
        net_salary: net,
      };
      if (isEdit) await api.updatePayroll(pay.id, data);
      else await api.createPayroll(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật dòng lương' : 'Đã thêm dòng lương thủ công', 'success');
      onRefresh();
    } catch (e) {
      toast(e.message || 'Không thể cập nhật dòng lương. Vui lòng thử lại.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Lưu thay đổi';
      saving = false;
    }
  });
}
