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
  const base = number(record.total_income_agreed || record.base_salary);
  const positionSalary = number(record.position_salary);
  const completionBonus = number(record.completion_bonus);
  const probationDays = number(record.probation_days);
  const officialDays = number(record.official_days || record.work_days);
  const paidLeaveDays = number(record.paid_leave_days);
  const unpaidLeaveDays = number(record.unpaid_leave_days);
  const standardDays = number(record.standard_days) || 23;

  const effectiveDays = officialDays + paidLeaveDays;
  const incomeFromWork = number(record.work_income) || (
    standardDays > 0 && (effectiveDays + probationDays) > 0
      ? Math.round(base * Math.min(effectiveDays + probationDays, standardDays) / standardDays)
      : base
  );

  const otHours = number(record.ot_normal_hours) + number(record.ot_weekend_hours) + number(record.ot_holiday_hours) || (number(record.approved_overtime_minutes) / 60);
  const overtime = number(record.ot_total_income || record.overtime_pay);

  const parkingAllowance = number(record.parking_allowance);
  const fuelAllowance = number(record.fuel_allowance);
  const phoneAllowance = number(record.phone_allowance);
  const attireAllowance = number(record.attire_allowance);
  const totalAllowance = number(record.total_allowance || record.allowance) || (parkingAllowance + fuelAllowance + phoneAllowance + attireAllowance);

  const bonus = number(record.kpi_bonus ?? record.bonus);
  const totalPretaxIncome = number(record.total_pretax_income) || (incomeFromWork + overtime + totalAllowance + bonus);

  const insuranceSocial = number(record.insurance_social);
  const insuranceHealth = number(record.insurance_health);
  const insuranceUnemployment = number(record.insurance_unemployment);
  const insurance = number(record.insurance) || (insuranceSocial + insuranceHealth + insuranceUnemployment);

  const tax = number(record.tax);
  const mealAllowance = number(record.meal_allowance);
  const arrearsAddition = number(record.arrears_addition);
  const arrearsDeduction = number(record.arrears_deduction || record.deduction);

  const netIncomeAfterTax = number(record.net_income_after_tax) || (totalPretaxIncome - insurance - tax);
  const transferAmount = number(record.transfer_amount) || (netIncomeAfterTax + mealAllowance + arrearsAddition - arrearsDeduction);

  return {
    base,
    positionSalary,
    completionBonus,
    probationDays,
    officialDays,
    paidLeaveDays,
    unpaidLeaveDays,
    standardDays,
    incomeFromWork,
    otHours,
    overtime,
    parkingAllowance,
    fuelAllowance,
    phoneAllowance,
    attireAllowance,
    totalAllowance,
    bonus,
    totalPretaxIncome,
    insuranceSocial,
    insuranceHealth,
    insuranceUnemployment,
    insurance,
    tax,
    mealAllowance,
    arrearsAddition,
    arrearsDeduction,
    netIncomeAfterTax,
    transferAmount,
    net: transferAmount || number(record.net_salary),
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
    <td class="payslip-note-col">${esc(note)}</td>
  </tr>`;
  if (!editable) return row;
  return `${row}<tr class="payslip-line-note" data-payroll-note-row="${field}" hidden><td></td><td colSpan="5"><label>Ghi chú điều chỉnh cho “${esc(label)}” <span>*</span><textarea data-payroll-note="${field}" rows="2" maxlength="1000" placeholder="Nêu rõ lý do điều chỉnh khoản này..."></textarea></label></td></tr>`;
}

export function payslipDetailHTML(record, { source = 'invoice', edit = false } = {}) {
  const period = payrollPeriod(record);
  const values = recordValues(record);
  const employeeId = Number(source === 'payroll' ? record.employee_id : (record.user_id || record.employee_id || 0));
  const type = record.contract_type || (source === 'payroll' ? 'Theo hồ sơ nhân viên' : 'Chưa cập nhật');
  const note = record.note || record.notes || '';

  const allowanceNoteParts = [];
  if (values.parkingAllowance) allowanceNoteParts.push(`Gửi xe: ${fmtMoney(values.parkingAllowance)}`);
  if (values.fuelAllowance) allowanceNoteParts.push(`Xăng: ${fmtMoney(values.fuelAllowance)}`);
  if (values.phoneAllowance) allowanceNoteParts.push(`ĐT: ${fmtMoney(values.phoneAllowance)}`);
  const allowanceNote = allowanceNoteParts.length ? allowanceNoteParts.join(' | ') : '';

  const baseSalaryNote = values.positionSalary > 0
    ? `Vị trí: ${fmtMoney(values.positionSalary)}${values.completionBonus > 0 ? ` + HTCV: ${fmtMoney(values.completionBonus)}` : ''}`
    : '';

  return `<div class="payslip-detail-layout">
    <section class="payslip-sheet" aria-label="Phiếu lương chi tiết">
      <header class="payslip-titlebar">
        <strong>CÔNG TY CỔ PHẦN TẬP ĐOÀN CÔNG NGHỆ VÀ TRUYỀN THÔNG NETVIET</strong>
        <h2>PHIẾU LƯƠNG THÁNG ${esc(period.label)}</h2>
      </header>
      <dl class="payslip-identity">
        <div><dt>Họ và tên</dt><dd><strong>${esc(record.full_name || record.employee_name || 'Chưa cập nhật')}</strong></dd></div>
        <div><dt>Mã nhân viên</dt><dd>${esc(record.employee_code || 'Chưa cập nhật')}</dd></div>
        <div><dt>Phòng ban</dt><dd>${esc(record.department || 'Chưa cập nhật')}</dd></div>
        <div><dt>Chức danh</dt><dd>${esc(record.position || 'Chưa cập nhật')}</dd></div>
        <div><dt>Loại HĐ</dt><dd>${esc(type)}</dd></div>
        <div class="payslip-identity-note"><dt>Ghi chú</dt><dd>${esc(note || 'Không có')}</dd></div>
      </dl>
      <div class="payslip-table-wrap">
        <table class="payslip-table${edit ? ' payslip-table--editing' : ''}">
          <thead><tr><th>STT</th><th>NỘI DUNG</th><th>SỐ NGÀY/GIỜ</th><th>THU NHẬP</th><th>KHẤU TRỪ</th><th>GHI CHÚ</th></tr></thead>
          <tbody>
            ${payslipRow(1, 'Mức lương thỏa thuận', '', values.base, '', baseSalaryNote, '', { field: 'base_salary', editable: edit, value: values.base })}
            ${payslipRow(2, 'Ngày công thử việc', values.probationDays ? `${values.probationDays} công` : '0')}
            ${payslipRow(3, 'Ngày công chính thức', values.officialDays ? `${values.officialDays} công` : '0', '', '', values.paidLeaveDays > 0 ? `Phép: ${values.paidLeaveDays}` : '')}
            ${payslipRow(4, 'Thu nhập theo ngày công', '', values.incomeFromWork, '', `Định mức ${values.standardDays} công`, '', { valueId: 'payslip-income-from-work' })}
            ${payslipRow(5, 'Thu nhập làm thêm giờ (OT)', values.otHours > 0 ? `${values.otHours.toFixed(1)} giờ` : '', values.overtime, '', '')}
            ${payslipRow(6, 'Phụ cấp (Gửi xe, Xăng xe, ĐT...)', '', values.totalAllowance, '', allowanceNote, '', { field: 'allowance', editable: edit, value: values.totalAllowance })}
            ${payslipRow(7, 'Thưởng KPI / Hiệu suất', '', values.bonus, '', '', '', { field: 'kpi_bonus', editable: edit, value: values.bonus })}
            ${payslipRow(8, 'Tổng thu nhập trước thuế', '', values.totalPretaxIncome, '', '', 'payslip-subtotal', { valueId: 'payslip-total-income' })}
            ${payslipRow(9, 'BHXH, BHYT, BHTN người lao động', '', '', values.insurance, values.insuranceSocial > 0 ? 'BHXH 8%, BHYT 1.5%, BHTN 1%' : '', '', { field: 'insurance', editable: edit, value: values.insurance, column: 'deduction' })}
            ${payslipRow(10, 'Thuế TNCN', '', '', values.tax, '', '', { field: 'tax', editable: edit, value: values.tax, column: 'deduction' })}
            ${payslipRow(11, 'Tiền ăn ca', '', values.mealAllowance, '', values.mealAllowance > 0 ? 'Ăn ca theo ngày công' : '')}
            ${payslipRow(12, 'Truy lĩnh / Bù lương', '', values.arrearsAddition, '', values.arrearsAddition > 0 ? 'Bù lương / Truy lĩnh' : '')}
            ${payslipRow(13, 'Truy thu / Khấu trừ khác', '', '', values.arrearsDeduction, '', '', { field: 'deduction', editable: edit, value: values.arrearsDeduction, column: 'deduction' })}
          </tbody>
          <tfoot>
            <tr class="payslip-foot-highlight">
              <td colSpan="3"><strong>SỐ TIỀN CHUYỂN VÀO TÀI KHOẢN (THỰC NHẬN)</strong></td>
              <td class="payslip-money payslip-money--highlight" id="payslip-net" colSpan="3">
                <span class="payslip-transfer-badge">${fmtMoney(values.transferAmount)}</span>
              </td>
            </tr>
          </tfoot>
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

