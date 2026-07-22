import { api } from '../api.js';
import { esc, fmtMoney, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination } from '../utils.js';

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
  let sourceSummary = null;
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
      <button id="btn-payroll-load" class="btn-secondary btn-sm">Đồng bộ dữ liệu</button>
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

    <div class="card" style="padding:0;">
      <div style="display:flex;justify-content:flex-end;padding:12px 12px 0;">
        <button id="btn-manual-payroll" class="btn-secondary btn-sm">+ Thêm dòng lương thủ công</button>
      </div>
      <div id="payroll-table">${loadingHTML()}</div>
    </div>
  `;

  const monthInput = document.getElementById('payroll-month');
  document.getElementById('btn-new-payroll').addEventListener('click', openCreatePayrollBatchConfirm);
  document.getElementById('btn-payroll-load').addEventListener('click', syncPayrollSource);
  document.getElementById('btn-manual-payroll').addEventListener('click', () => openPayrollLineForm(null, loadPayroll, monthInput.value));
  monthInput.addEventListener('change', () => {
    sourceSummary = null;
    currentPage = 1;
    loadPayroll();
  });
  document.getElementById('payroll-search').addEventListener('input', () => { currentPage = 1; loadPayroll(); });
  document.getElementById('payroll-dept-filter').addEventListener('change', () => { currentPage = 1; loadPayroll(); });

  async function syncPayrollSource() {
    const month = monthInput.value;
    const statusEl = document.getElementById('payroll-load-status');
    const loadBtn = document.getElementById('btn-payroll-load');
    if (!month) {
      toast('Vui lòng chọn tháng/năm trước khi đồng bộ dữ liệu', 'error');
      return;
    }
    if (statusEl) statusEl.textContent = 'Đang đồng bộ dữ liệu nguồn cho bảng lương...';
    if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = 'Đang đồng bộ...'; }
    try {
      const r = await api.loadPayrollData(month);
      sourceSummary = r;
      const msg = `Đã đồng bộ tháng ${formatMonth(month)}: ${r.total} nhân sự, ${r.existing || 0} đã có, bổ sung ${r.created || 0}, ${r.complete || 0} đủ dữ liệu, ${r.missing_salary_config || r.missing || 0} thiếu cấu hình lương.`;
      if (statusEl) statusEl.textContent = msg;
      toast(msg, 'success', 5000);
      await loadPayroll({ keepStatus: true });
    } catch (e) {
      sourceSummary = null;
      if (statusEl) statusEl.textContent = `Lỗi đồng bộ dữ liệu: ${e.message || 'Không xác định'}`;
      toast(e.message || 'Không đồng bộ được dữ liệu bảng lương', 'error');
    } finally {
      if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = 'Đồng bộ dữ liệu'; }
    }
  }

  async function openCreatePayrollBatchConfirm() {
    const month = monthInput.value;
    if (!month) {
      toast('Vui lòng chọn tháng/năm trước khi tạo bảng lương', 'error');
      return;
    }
    if (!sourceSummary || sourceSummary.month !== month) {
      toast('Vui lòng đồng bộ dữ liệu trước khi tạo bảng lương.', 'error', 4500);
      const statusEl = document.getElementById('payroll-load-status');
      if (statusEl) statusEl.textContent = 'Vui lòng đồng bộ dữ liệu trước khi tạo bảng lương.';
      return;
    }

    openModal(`Tạo bảng lương tháng ${formatMonth(month)}`, `
      <div style="display:grid;gap:10px;">
        <div class="detail-item"><div class="detail-label">Tổng số nhân sự</div><div class="detail-val">${sourceSummary.total || 0}</div></div>
        <div class="detail-item"><div class="detail-label">Đã có trong bảng</div><div class="detail-val">${sourceSummary.existing || sourceSummary.existing_rows || 0}</div></div>
        <div class="detail-item"><div class="detail-label">Đã bổ sung mới</div><div class="detail-val">${sourceSummary.created || 0}</div></div>
        <div class="detail-item"><div class="detail-label">Số nhân sự đủ dữ liệu</div><div class="detail-val">${sourceSummary.complete || 0}</div></div>
        <div class="detail-item"><div class="detail-label">Thiếu cấu hình lương</div><div class="detail-val">${sourceSummary.missing_salary_config || sourceSummary.missing || 0}</div></div>
        <div class="detail-item"><div class="detail-label">Tổng quỹ lương dự kiến</div><div class="detail-val">${fmtMoney(sourceSummary.estimated_total || 0)}</div></div>
        <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
          Các trường hợp thiếu cấu hình lương cần được xử lý trước khi trình phê duyệt.
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
        toast(`Đã đồng bộ bảng lương tháng ${formatMonth(month)}: bổ sung ${r.created || 0} nhân sự.`, 'success', 5000);
        await loadPayroll();
      } catch (e) {
        toast(e.message || 'Không tạo được bảng lương', e.status === 409 ? 'info' : 'error', 5000);
        btn.disabled = false;
        btn.textContent = 'Tạo bảng lương';
      }
    });
  }

  async function loadPayroll(options = {}) {
    const tableEl = document.getElementById('payroll-table');
    const sumEl = document.getElementById('payroll-summary');
    const statusEl = document.getElementById('payroll-load-status');
    const loadBtn = document.getElementById('btn-payroll-load');
    if (!tableEl) return;
    tableEl.innerHTML = loadingHTML();
    if (statusEl && !options.keepStatus) statusEl.textContent = 'Đang tải dữ liệu bảng lương...';
    if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = 'Đang tải...'; }
    const month = monthInput.value;
    try {
      const payrollRes = await api.getPayroll({ month });
      const payrolls = payrollRes.payroll || [];
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
                  <tr>
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
        btn.addEventListener('click', () => {
          const p = payrolls.find(x => x.id === parseInt(btn.dataset.pid));
          if (p) openPayrollLineForm(p, loadPayroll, month);
        });
      });
      tableEl.querySelectorAll('.pay-del').forEach(btn => {
        btn.addEventListener('click', async () => {
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
      bindPagination(tableEl, page => { currentPage = page; loadPayroll({ keepStatus: true }); });
    } catch (e) {
      if (statusEl) statusEl.textContent = `Lỗi tải dữ liệu: ${e.message || 'Không xác định'}`;
      tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('⚠️', e.message)}</div>`;
    } finally {
      if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = 'Đồng bộ dữ liệu'; }
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
