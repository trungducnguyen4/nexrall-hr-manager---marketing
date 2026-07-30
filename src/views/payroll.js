import { api } from '../api.js?v=20260722-payroll-export-ux';
import { esc, fmtMoney, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination } from '../utils.js?v=20260722-payroll-export-ux';
import { payslipDetailHTML, hydratePayslipAttendance, preparePayslipModal } from './payslip-detail.js';

function formatMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return month || '';
  const [year, mm] = month.split('-');
  return `${mm}/${year}`;
}

function payrollStatusBadge(p) {
  const status = p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config');
  if (status === 'missing_salary_config') {
    return `<span style="display:inline-block;margin-top:4px;padding:3px 8px;border-radius:999px;background:#FEF3C7;color:#92400E;font-size:11px;font-weight:700;">Thiếu cấu hình lương</span>`;
  }
  return `<span style="display:inline-block;margin-top:4px;padding:3px 8px;border-radius:999px;background:#D1FAE5;color:#065F46;font-size:11px;font-weight:700;">Đủ dữ liệu</span>`;
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
        <div class="table-wrap" style="border:none;border-radius:var(--radius);">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Phòng ban</th>
                <th>Lương CB</th>
                <th>KPI Bonus</th>
                <th>Phụ cấp</th>
                <th>Khấu trừ</th>
                <th>Thực lĩnh</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${pageData.rows.map(p => {
                const net = (p.base_salary || 0) + (p.kpi_bonus || 0) + (p.allowance || 0) - (p.deduction || 0);
                return `
                  <tr class="payroll-row" data-pid="${p.id}" tabindex="0" role="button" aria-label="Mở phiếu lương của ${esc(p.employee_name || 'nhân viên')}">
                    <td>
                      <span style="font-weight:600;">${esc(p.employee_name || '—')}</span><br>
                      <span style="font-size:11px;color:var(--text-3);">${esc(p.employee_code || '')}</span><br>
                      ${payrollStatusBadge(p)}
                    </td>
                    <td style="font-size:12px;color:var(--text-2);">${esc(p.department || '—')}</td>
                    <td>${fmtMoney(p.base_salary)}</td>
                    <td style="color:var(--success);">+${fmtMoney(p.kpi_bonus)}</td>
                    <td style="color:var(--info);">+${fmtMoney(p.allowance)}</td>
                    <td style="color:var(--danger);">-${fmtMoney(p.deduction)}</td>
                    <td><strong style="color:var(--primary);font-size:13px;">${fmtMoney(net)}</strong></td>
                    <td>
                      <button class="btn-xs btn-secondary pay-edit" data-pid="${p.id}" style="margin-right:4px;">✏️</button>
                      <button class="btn-xs btn-danger pay-del" data-pid="${p.id}">🗑</button>
                    </td>
                  </tr>
                `;
              }).join('')}
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

function openPayrollLineForm(pay, onRefresh = noop, currentMonth = '') {
  onRefresh = safeCb(onRefresh);
  const now = new Date();
  const defMonth = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isEdit = !!pay;

  openModal(isEdit ? 'Sửa dòng lương' : 'Thêm dòng lương thủ công', `
    <div class="input-row">
      <div class="field"><label>Nhân viên (tên)</label>
        <input type="text" id="pf-emp" value="${esc(pay?.employee_name || '')}" placeholder="Tên nhân viên"/>
      </div>
      <div class="field"><label>Tháng</label>
        <input type="month" id="pf-month" value="${pay?.month || defMonth}"/>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Lương cơ bản (VNĐ)</label>
        <input type="number" id="pf-base" value="${pay?.base_salary || 0}" min="0" step="100000"/>
      </div>
      <div class="field"><label>KPI bonus (VNĐ)</label>
        <input type="number" id="pf-kpi" value="${pay?.kpi_bonus || 0}" min="0" step="100000"/>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Phụ cấp (VNĐ)</label>
        <input type="number" id="pf-allow" value="${pay?.allowance || 0}" min="0" step="100000"/>
      </div>
      <div class="field"><label>Khấu trừ (VNĐ)</label>
        <input type="number" id="pf-deduct" value="${pay?.deduction || 0}" min="0" step="100000"/>
      </div>
    </div>
    <div id="pf-preview" style="background:linear-gradient(135deg,var(--primary),#8B5CF6);border-radius:10px;padding:14px;color:#fff;margin-top:6px;">
      <div style="font-size:12px;opacity:.8;">Thực nhận dự kiến</div>
      <div id="pf-net" style="font-size:22px;font-weight:800;">0 ₫</div>
    </div>
  `, `
    <button class="btn-secondary" id="pf-cancel">Hủy</button>
    <button class="btn-primary" id="pf-save">Lưu</button>
  `);

  document.getElementById('pf-cancel').addEventListener('click', closeModal);
  function updateNet() {
    const base = parseFloat(document.getElementById('pf-base').value) || 0;
    const kpi = parseFloat(document.getElementById('pf-kpi').value) || 0;
    const allow = parseFloat(document.getElementById('pf-allow').value) || 0;
    const deduct = parseFloat(document.getElementById('pf-deduct').value) || 0;
    const net = base + kpi + allow - deduct;
    const out = document.getElementById('pf-net');
    if (out) out.textContent = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(net);
  }
  ['pf-base', 'pf-kpi', 'pf-allow', 'pf-deduct'].forEach(id => document.getElementById(id)?.addEventListener('input', updateNet));
  updateNet();

  document.getElementById('pf-save').addEventListener('click', async () => {
    const employee_name = document.getElementById('pf-emp').value.trim();
    const month = document.getElementById('pf-month').value;
    const base_salary = parseFloat(document.getElementById('pf-base').value) || 0;
    const kpi_bonus = parseFloat(document.getElementById('pf-kpi').value) || 0;
    const allowance = parseFloat(document.getElementById('pf-allow').value) || 0;
    const deduction = parseFloat(document.getElementById('pf-deduct').value) || 0;
    const net_salary = base_salary + kpi_bonus + allowance - deduction;
    if (!employee_name || !month) {
      toast('Vui lòng điền đầy đủ thông tin', 'error');
      return;
    }
    try {
      const data = { employee_name, month, base_salary, kpi_bonus, allowance, deduction, net_salary };
      if (isEdit) await api.updatePayroll(pay.id, data);
      else await api.createPayroll(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật dòng lương' : 'Đã thêm dòng lương thủ công', 'success');
      onRefresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}
