import { api } from '../api.js';
import { esc, fmtMoney, loadingHTML } from '../utils.js';
import { icon } from '../icons.js';

function monthRange(month, year) {
  const resolvedYear = Number(year || String(month || '').slice(0, 4));
  const resolvedMonth = Number(month && String(month).includes('-') ? String(month).slice(5, 7) : month);
  if (!resolvedYear || !resolvedMonth) return { from: '', to: '' };
  const lastDay = new Date(resolvedYear, resolvedMonth, 0).getDate();
  const mm = String(resolvedMonth).padStart(2, '0');
  return { from: `${resolvedYear}-${mm}-01`, to: `${resolvedYear}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

function payrollPeriod(record) {
  const rawMonth = String(record.month || '').includes('-') ? String(record.month) : `${record.year || ''}-${String(record.month || '').padStart(2, '0')}`;
  const [year, month] = rawMonth.split('-');
  return { month: Number(month || record.month || 0), year: Number(year || record.year || 0), label: `${String(month || record.month || '').padStart(2, '0')}/${year || record.year || ''}` };
}

function number(value) {
  return Number(value || 0);
}

function recordValues(record) {
  const base = number(record.base_salary);
  const bonus = number(record.bonus ?? record.kpi_bonus);
  const allowance = number(record.allowance);
  const overtime = number(record.overtime_pay);
  const deduction = number(record.deduction);
  const tax = number(record.tax);
  const insurance = number(record.insurance);
  const standardDays = number(record.standard_days);
  const workDays = number(record.work_days);
  const paidLeaveDays = number(record.paid_leave_days);
  const effectiveDays = workDays + paidLeaveDays;
  const incomeFromWork = standardDays > 0 && effectiveDays > 0
    ? Math.round(base * Math.min(effectiveDays, standardDays) / standardDays)
    : base;
  const totalIncome = incomeFromWork + overtime + allowance + bonus;
  const calculatedNet = totalIncome - deduction - tax - insurance;
  return {
    base, bonus, allowance, overtime, deduction, tax, insurance, standardDays, workDays, paidLeaveDays,
    incomeFromWork, totalIncome,
    net: record.net_salary === undefined || record.net_salary === null ? calculatedNet : number(record.net_salary),
  };
}

function payslipRow(index, label, days, income = '', deduction = '', note = '', tone = '', options = {}) {
  const { field = '', editable = false, value = 0, column = 'income', valueId = '' } = options;
  const moneyCell = (amount, target) => {
    if (editable && target === column) return `<input class="payslip-inline-input" type="number" min="0" step="1000" inputmode="numeric" data-payroll-field="${field}" data-original-value="${Number(value || 0)}" value="${Number(value || 0)}" aria-label="${esc(label)}"/>`;
    const text = amount === '' ? '' : fmtMoney(amount);
    return valueId && target === 'income' ? `<span id="${valueId}">${text}</span>` : text;
  };
  const row = `<tr class="${tone}" data-payroll-line="${field}">
    <td class="payslip-index">${index}</td>
    <td>${esc(label)}</td>
    <td class="payslip-number">${days === '' ? '' : esc(days)}</td>
    <td class="payslip-money">${moneyCell(income, 'income')}</td>
    <td class="payslip-money">${moneyCell(deduction, 'deduction')}</td>
    <td>${esc(note)}</td>
  </tr>`;
  if (!editable) return row;
  return `${row}<tr class="payslip-line-note" data-payroll-note-row="${field}" hidden><td></td><td colSpan="5"><label>Ghi chú điều chỉnh cho “${esc(label)}” <span>*</span><textarea data-payroll-note="${field}" rows="2" maxlength="1000" placeholder="Nêu rõ lý do điều chỉnh khoản này..."></textarea></label></td></tr>`;
}

export function payslipDetailHTML(record, { source = 'invoice', edit = false } = {}) {
  const period = payrollPeriod(record);
  const values = recordValues(record);
  const employeeId = Number(source === 'payroll' ? record.employee_id : (record.user_id || record.employee_id || 0));
  const type = record.contract_type || (source === 'payroll' ? 'Theo hồ sơ nhân viên' : 'Chưa cập nhật');
  const note = record.note || '';
  return `<div class="payslip-detail-layout">
    <section class="payslip-sheet" aria-label="Phiếu lương chi tiết">
      <header class="payslip-titlebar">
        <strong>CÔNG TY CỔ PHẦN TẬP ĐOÀN CÔNG NGHỆ VÀ TRUYỀN THÔNG NETVIET</strong>
        <h2>PHIẾU LƯƠNG THÁNG ${esc(period.label)}</h2>
      </header>
      <dl class="payslip-identity">
        <div><dt>Họ và tên</dt><dd>${esc(record.full_name || record.employee_name || 'Chưa cập nhật')}</dd></div>
        <div><dt>Mã nhân viên</dt><dd>${esc(record.employee_code || 'Chưa cập nhật')}</dd></div>
        <div><dt>Chức danh</dt><dd>${esc(record.position || 'Chưa cập nhật')}</dd></div>
        <div><dt>Loại HĐ</dt><dd>${esc(type)}</dd></div>
        <div class="payslip-identity-note"><dt>Ghi chú</dt><dd>${esc(note || 'Không có')}</dd></div>
      </dl>
      <div class="payslip-table-wrap">
        <table class="payslip-table${edit ? ' payslip-table--editing' : ''}">
          <thead><tr><th>STT</th><th>NỘI DUNG</th><th>SỐ NGÀY/GIỜ</th><th>THU NHẬP</th><th>KHẤU TRỪ</th><th>GHI CHÚ</th></tr></thead>
          <tbody>
            ${payslipRow(1, 'Mức lương thỏa thuận', '', values.base, '', '', '', { field: 'base_salary', editable: edit, value: values.base })}
            ${payslipRow(2, 'Ngày công thử việc', '0')}
            ${payslipRow(3, 'Ngày công chính thức', values.workDays || '0')}
            ${payslipRow(4, 'Thu nhập theo ngày công', '', values.incomeFromWork, '', '', '', { valueId: 'payslip-income-from-work' })}
            ${payslipRow(5, 'Thu nhập làm thêm giờ', `${(number(record.approved_overtime_minutes) / 60).toFixed(1)} giờ`, values.overtime)}
            ${payslipRow(6, 'Phụ cấp khác', '', values.allowance, '', note ? 'Theo ghi chú phiếu lương' : '', '', { field: 'allowance', editable: edit, value: values.allowance })}
            ${payslipRow(7, 'Thưởng KPI', '', values.bonus, '', '', '', { field: 'kpi_bonus', editable: edit, value: values.bonus })}
            ${payslipRow(8, 'Truy lĩnh lương', '', 0)}
            ${payslipRow(9, 'Tổng thu nhập trước thuế', '', values.totalIncome, '', '', 'payslip-subtotal', { valueId: 'payslip-total-income' })}
            ${payslipRow(10, 'BHXH, BHYT, BHTN người lao động', '', '', values.insurance, '', '', { field: 'insurance', editable: edit, value: values.insurance, column: 'deduction' })}
            ${payslipRow(11, 'Thuế TNCN', '', '', values.tax, '', '', { field: 'tax', editable: edit, value: values.tax, column: 'deduction' })}
            ${payslipRow(12, 'Tiền ăn ca', '', 0)}
            ${payslipRow(13, 'Truy lĩnh khác', '', 0)}
            ${payslipRow(14, 'Khấu trừ khác', '', '', values.deduction, '', '', { field: 'deduction', editable: edit, value: values.deduction, column: 'deduction' })}
          </tbody>
          <tfoot><tr><td colSpan="3">THỰC LĨNH/CHUYỂN KHOẢN</td><td class="payslip-money" id="payslip-net">${fmtMoney(values.net)}</td><td></td><td></td></tr></tfoot>
        </table>
      </div>
    </section>
    <aside class="payslip-attendance-panel" aria-label="Chi tiết chấm công">
      <div class="payslip-attendance-head">
        <div><p>Đối chiếu dữ liệu</p><h2>${icon('calendarDays', 'sm')} Chi tiết chấm công</h2></div>
        <span>${esc(period.label)}</span>
      </div>
      <div id="payslip-attendance-content" data-employee-id="${employeeId}" data-from="${esc(monthRange(period.month, period.year).from)}" data-to="${esc(monthRange(period.month, period.year).to)}">${loadingHTML()}</div>
    </aside>
  </div>`;
}

function attendanceStatus(record) {
  const labels = { present: 'Có mặt', absent: 'Vắng', leave: 'Nghỉ phép', pending: 'Chờ xác nhận' };
  return labels[record.status] || record.status || 'Chưa xác định';
}

export async function hydratePayslipAttendance() {
  const host = document.getElementById('payslip-attendance-content');
  if (!host) return;
  const employeeId = Number(host.dataset.employeeId || 0);
  const from = host.dataset.from || '';
  const to = host.dataset.to || '';
  if (!employeeId || !from || !to) {
    host.innerHTML = '<div class="payslip-attendance-empty">Chưa có nhân viên hoặc kỳ lương để đối chiếu chấm công.</div>';
    return;
  }
  try {
    const data = await api.getEmployeeAttendanceSummary(employeeId, { from, to });
    const summary = data.summary || {};
    const records = data.records || [];
    host.innerHTML = `
      <div class="payslip-attendance-metrics">
        <div><span>Ngày chuẩn</span><strong>${number(summary.standardWorkDays)}</strong></div>
        <div><span>Ngày thực tế</span><strong>${number(summary.actualWorkDays)}</strong></div>
        <div><span>Đi muộn</span><strong>${number(summary.lateMinutes)}p</strong></div>
        <div><span>Vắng</span><strong>${number(summary.absentDays)}</strong></div>
      </div>
      <div class="payslip-attendance-table-wrap">
        <table class="payslip-attendance-table">
          <thead><tr><th>Ngày</th><th>Ca</th><th>Vào</th><th>Ra</th><th>Muộn</th><th>Trạng thái</th></tr></thead>
          <tbody>${records.length ? records.map(item => `<tr>
            <td>${esc(item.date || '')}</td><td>${esc(item.shift || 'Cả ngày')}</td><td>${esc(item.checkin_time || 'Chưa có')}</td><td>${esc(item.checkout_time || 'Chưa có')}</td><td>${number(item.late_minutes) ? `${number(item.late_minutes)}p` : ''}</td><td>${esc(attendanceStatus(item))}</td>
          </tr>`).join('') : '<tr><td colSpan="6" class="payslip-attendance-empty">Chưa có dữ liệu chấm công trong kỳ này.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (error) {
    host.innerHTML = `<div class="payslip-attendance-empty">Không tải được chấm công: ${esc(error.message || 'Lỗi không xác định')}</div>`;
  }
}

export function preparePayslipModal() {
  document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--payslip');
}

export async function renderPayslipDetail(el, me) {
  el._cleanup = () => {};
}

