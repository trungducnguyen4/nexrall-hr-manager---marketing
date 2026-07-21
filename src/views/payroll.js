import { api } from '../api.js';
import { esc, fmtMoney, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb } from '../utils.js';

export async function renderPayroll(el, me) {
  const isAdmin = me.role === 'admin' || me.role === 'manager';
  if (!isAdmin) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">Không có quyền truy cập</div></div>`;
    return;
  }

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">💰 Bảng lương</div>
        <div class="page-sub">Quản lý lương và KPI nhân viên</div>
      </div>
      <button id="btn-new-payroll" class="btn-primary btn-sm">+ Tạo bảng lương</button>
    </div>

    <!-- Month picker -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <label style="font-size:13px;font-weight:600;color:var(--text-2);">Tháng:</label>
      <input type="month" id="payroll-month" value="${curMonth}" style="max-width:160px;font-weight:600;"/>
      <button id="btn-payroll-load" class="btn-secondary btn-sm">Tải dữ liệu</button>
    </div>

    <!-- Summary -->
    <div id="payroll-summary" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px;"></div>

    <!-- Table -->
    <div class="card" style="padding:0;">
      <div id="payroll-table">${loadingHTML()}</div>
    </div>
  `;

  document.getElementById('btn-new-payroll').addEventListener('click', () => openPayrollForm(null, loadPayroll));
  document.getElementById('btn-payroll-load').addEventListener('click', loadPayroll);

  async function loadPayroll() {
    const tableEl = document.getElementById('payroll-table');
    const sumEl   = document.getElementById('payroll-summary');
    if (!tableEl) return;
    tableEl.innerHTML = loadingHTML();
    const month = document.getElementById('payroll-month').value;
    try {
      const [payrollRes, usersRes] = await Promise.allSettled([
        api.getPayroll({ month }),
        api.getUsers(),
      ]);
      const payrolls = payrollRes.status === 'fulfilled' ? (payrollRes.value.payroll || []) : [];
      const users    = usersRes.status === 'fulfilled'   ? (usersRes.value.users || []) : [];

      // Summary
      const totalBase   = payrolls.reduce((s, p) => s + (p.base_salary||0), 0);
      const totalBonus  = payrolls.reduce((s, p) => s + (p.kpi_bonus||0) + (p.allowance||0), 0);
      const totalDeduct = payrolls.reduce((s, p) => s + (p.deduction||0), 0);
      const totalNet    = payrolls.reduce((s, p) => s + (p.net_salary||0), 0);
      const headcount   = payrolls.length;

      if (sumEl) {
        sumEl.innerHTML = `
          <div class="stat-card" style="--stat-color:#6366F1;--stat-bg:#EEF2FF;">
            <div class="stat-icon-wrap">👥</div>
            <div class="stat-val">${headcount}</div>
            <div class="stat-label">Nhân viên tháng ${month}</div>
          </div>
          <div class="stat-card" style="--stat-color:#10B981;--stat-bg:#D1FAE5;">
            <div class="stat-icon-wrap">💵</div>
            <div class="stat-val" style="font-size:16px;">${fmtMoney(totalNet)}</div>
            <div class="stat-label">Tổng thực lĩnh</div>
          </div>
          <div class="stat-card" style="--stat-color:#F59E0B;--stat-bg:#FEF3C7;">
            <div class="stat-icon-wrap">🎁</div>
            <div class="stat-val" style="font-size:16px;">${fmtMoney(totalBonus)}</div>
            <div class="stat-label">Thưởng + Phụ cấp</div>
          </div>
        `;
      }

      if (!payrolls.length) {
        tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('💰', `Chưa có bảng lương tháng ${month}`, 'Nhấn "+ Tạo bảng lương" để bắt đầu')}</div>`;
        return;
      }

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
              ${payrolls.map(p => {
                const net = (p.base_salary||0) + (p.kpi_bonus||0) + (p.allowance||0) - (p.deduction||0);
                return `
                  <tr>
                    <td><span style="font-weight:600;">${esc(p.employee_name||'—')}</span><br><span style="font-size:11px;color:var(--text-3);">${esc(p.employee_code||'')}</span></td>
                    <td style="font-size:12px;color:var(--text-2);">${esc(p.department||'—')}</td>
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
      `;

      tableEl.querySelectorAll('.pay-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = payrolls.find(x => x.id === parseInt(btn.dataset.pid));
          if (p) openPayrollForm(p, loadPayroll);
        });
      });
      tableEl.querySelectorAll('.pay-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Xóa dòng lương này?')) return;
          try {
            await api.deletePayroll(btn.dataset.pid);
            toast('Đã xóa', 'success');
            loadPayroll();
          } catch(e) { toast(e.message, 'error'); }
        });
      });
    } catch(e) {
      tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('⚠️', e.message)}</div>`;
    }
  }

  loadPayroll();
}

function openPayrollForm(pay, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const now    = new Date();
  const defMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const isEdit = !!pay;

  openModal(isEdit ? 'Sửa bảng lương' : 'Tạo bảng lương', `
    <div class="input-row">
      <div class="field"><label>Nhân viên (tên)</label>
        <input type="text" id="pf-emp" value="${esc(pay?.employee_name||'')}" placeholder="Tên nhân viên"/>
      </div>
      <div class="field"><label>Tháng</label>
        <input type="month" id="pf-month" value="${pay?.month||defMonth}"/>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Lương cơ bản (VNĐ)</label>
        <input type="number" id="pf-base" value="${pay?.base_salary||0}" min="0" step="100000"/>
      </div>
      <div class="field"><label>KPI Bonus (VNĐ)</label>
        <input type="number" id="pf-kpi" value="${pay?.kpi_bonus||0}" min="0" step="100000"/>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Phụ cấp (VNĐ)</label>
        <input type="number" id="pf-allow" value="${pay?.allowance||0}" min="0" step="100000"/>
      </div>
      <div class="field"><label>Khấu trừ (VNĐ)</label>
        <input type="number" id="pf-deduct" value="${pay?.deduction||0}" min="0" step="100000"/>
      </div>
    </div>
    <div id="pf-preview" style="background:linear-gradient(135deg,var(--primary),#8B5CF6);border-radius:10px;padding:14px;color:#fff;margin-top:6px;">
      <div style="font-size:12px;opacity:.8;">Thực lĩnh dự kiến</div>
      <div id="pf-net" style="font-size:22px;font-weight:800;">0 ₫</div>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="pf-save">Lưu</button>
  `);

  function updateNet() {
    const base   = parseFloat(document.getElementById('pf-base').value)   || 0;
    const kpi    = parseFloat(document.getElementById('pf-kpi').value)    || 0;
    const allow  = parseFloat(document.getElementById('pf-allow').value)  || 0;
    const deduct = parseFloat(document.getElementById('pf-deduct').value) || 0;
    const net = base + kpi + allow - deduct;
    const el = document.getElementById('pf-net');
    if (el) el.textContent = new Intl.NumberFormat('vi-VN', { style:'currency', currency:'VND' }).format(net);
  }
  ['pf-base','pf-kpi','pf-allow','pf-deduct'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateNet);
  });
  updateNet();

  document.getElementById('pf-save').addEventListener('click', async () => {
    const employee_name = document.getElementById('pf-emp').value.trim();
    const month         = document.getElementById('pf-month').value;
    const base_salary   = parseFloat(document.getElementById('pf-base').value) || 0;
    const kpi_bonus     = parseFloat(document.getElementById('pf-kpi').value)  || 0;
    const allowance     = parseFloat(document.getElementById('pf-allow').value)|| 0;
    const deduction     = parseFloat(document.getElementById('pf-deduct').value)||0;
    const net_salary    = base_salary + kpi_bonus + allowance - deduction;
    if (!employee_name || !month) { toast('Vui lòng điền đầy đủ thông tin', 'error'); return; }
    try {
      const data = { employee_name, month, base_salary, kpi_bonus, allowance, deduction, net_salary };
      if (isEdit) await api.updatePayroll(pay.id, data);
      else await api.createPayroll(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật' : 'Đã tạo bảng lương', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });
}
