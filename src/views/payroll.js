import { api } from '../api.js?v=20260811-penalty-policy-v3';
import { EventBus } from '../event-bus.js';
import { esc, fmtMoney, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination, avatarColor, initials, isHcnsDepartment, sortVietnameseNames, compareVietnameseNames } from '../utils.js?v=20260811-hr-access-v1';
import { payslipDetailHTML, hydratePayslipAttendance, preparePayslipModal } from './payslip-detail.js?v=20260916-excel-payroll-v1';
import { icon } from '../icons.js';
import { parsePayrollExcelText } from '../excel-payroll-parser.js';

function formatMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return month || '';
  const [year, mm] = month.split('-');
  return `${mm}/${year}`;
}

function payrollStatusBadge(p) {
  const status = p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config');
  return status === 'missing_salary_config'
    ? '<span class="payroll-badge payroll-badge--warn"><span class="payroll-badge-dot"></span><span>Thiếu cấu hình lương</span></span>'
    : '<span class="payroll-badge payroll-badge--ok"><span class="payroll-badge-dot"></span><span>Đủ dữ liệu</span></span>';
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

function getDeptIcon(deptName) {
  const name = String(deptName || '').toLowerCase();
  if (name.includes('marketing') || name.includes('truyền thông')) return icon('megaphone', 'xs');
  if (name.includes('biên tập') || name.includes('nội dung') || name.includes('content')) return icon('squarePen', 'xs');
  if (name.includes('hcns') || name.includes('nhân sự') || name.includes('hành chính')) return icon('users', 'xs');
  if (name.includes('kế toán') || name.includes('tài chính')) return icon('banknote', 'xs');
  if (name.includes('tạp vụ') || name.includes('bảo vệ')) return icon('shield', 'xs');
  if (name.includes('kỹ thuật') || name.includes('it') || name.includes('dev')) return icon('wifi', 'xs');
  if (name.includes('sản xuất') || name.includes('phim') || name.includes('gameshow') || name.includes('game')) return icon('activity', 'xs');
  if (name.includes('thực tập sinh') || name.includes('tts')) return icon('bookOpen', 'xs');
  if (name.includes('giám đốc') || name.includes('bgd') || name.includes('ban giám đốc')) return icon('trophy', 'xs');
  return icon('building2', 'xs');
}

function renderDonutChartSVG(slices, centerTitle, centerVal) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, Number(s.value || 0)), 0);
  const size = 160;
  const radius = 58;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius; // ~364.42

  if (total <= 0) {
    return `
      <svg viewBox="0 0 ${size} ${size}" class="payroll-donut-svg">
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="#E2E8F0" stroke-width="${strokeWidth}" fill="none" />
      </svg>
      <div class="payroll-donut-center">
        <span class="payroll-donut-center-label">${esc(centerTitle)}</span>
        <span class="payroll-donut-center-val" style="color:var(--text-3);font-size:12px;">0</span>
      </div>
    `;
  }

  let accumulatedOffset = 0;
  const circles = slices.filter(s => Number(s.value) > 0).map(slice => {
    const fraction = Number(slice.value) / total;
    const strokeDash = fraction * circumference;
    const gap = circumference - strokeDash;
    const offset = -accumulatedOffset;
    accumulatedOffset += strokeDash;
    return `<circle class="payroll-donut-segment" cx="${size/2}" cy="${size/2}" r="${radius}" stroke="${slice.color}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" fill="none" data-label="${esc(slice.label)}" title="${esc(slice.label)}: ${slice.formattedValue || slice.value} (${(fraction * 100).toFixed(1)}%)"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${size} ${size}" class="payroll-donut-svg">
      ${circles}
    </svg>
    <div class="payroll-donut-center">
      <span class="payroll-donut-center-label">${esc(centerTitle)}</span>
      <span class="payroll-donut-center-val">${esc(centerVal)}</span>
    </div>
  `;
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
      <td class="payroll-col-money payroll-col-net" data-label="Thực lĩnh">${payrollMoney(net, ready)}</td>
    </tr>`;
  payrollRowCache.set(p.id, { sig, html });
  if (payrollRowCache.size > 500) payrollRowCache.delete(payrollRowCache.keys().next().value);
  return html;
}

const fmtNum = (n) => (n ? Number(n).toLocaleString('vi-VN') : '-');
const fmtM = (n) => (n ? fmtMoney(n) : '-');

const PAYROLL_COLUMNS = [
  // 1. THÔNG TIN NHÂN VIÊN (4 columns)
  {
    key: 'stt',
    title: 'TT',
    group: 'THÔNG TIN NHÂN VIÊN',
    width: 44,
    align: 'center',
    sticky: true,
    stickyLeft: 0,
    colClass: 'col-stt',
    render: (r, idx, pageData) => (pageData.page - 1) * pageData.pageSize + idx + 1,
    renderTotal: () => '',
  },
  {
    key: 'employee_name',
    title: 'Họ và tên',
    group: 'THÔNG TIN NHÂN VIÊN',
    width: 180,
    align: 'left',
    sticky: true,
    stickyLeft: 44,
    colClass: 'col-name',
    cellClass: 'font-semibold',
    render: (r) => esc(r.employee_name || '—'),
    renderTotal: (totals, rows) => `CỘNG TỔNG (${rows.length} NV)`,
  },
  {
    key: 'employee_code',
    title: 'Mã NV',
    group: 'THÔNG TIN NHÂN VIÊN',
    width: 90,
    align: 'center',
    sticky: true,
    stickyLeft: 224,
    colClass: 'col-code',
    cellClass: 'font-mono',
    render: (r) => esc(r.employee_code || '—'),
    renderTotal: () => '',
  },
  {
    key: 'department',
    title: 'Phòng ban',
    group: 'THÔNG TIN NHÂN VIÊN',
    width: 130,
    align: 'left',
    sticky: true,
    stickyLeft: 314,
    colClass: 'col-dept',
    render: (r) => esc(r.department || '—'),
    renderTotal: () => '',
  },

  // 2. MỨC LƯƠNG & THƯỞNG HTCV (4 columns)
  {
    key: 'insurance_base',
    title: 'Mức đóng BH',
    group: 'MỨC LƯƠNG & THƯỞNG HTCV',
    groupClass: 'th-group--salary',
    width: 110,
    align: 'right',
    render: (r) => fmtM(r.insurance_base),
    renderTotal: (totals) => fmtM(totals.insurance_base),
  },
  {
    key: 'position_salary',
    title: 'Lương vị trí',
    group: 'MỨC LƯƠNG & THƯỞNG HTCV',
    groupClass: 'th-group--salary',
    width: 110,
    align: 'right',
    render: (r) => fmtM(r.position_salary),
    renderTotal: (totals) => fmtM(totals.position_salary),
  },
  {
    key: 'completion_bonus',
    title: 'Thưởng HTCV',
    group: 'MỨC LƯƠNG & THƯỞNG HTCV',
    groupClass: 'th-group--salary',
    width: 110,
    align: 'right',
    render: (r) => fmtM(r.completion_bonus),
    renderTotal: (totals) => fmtM(totals.completion_bonus),
  },
  {
    key: 'total_income_agreed',
    title: 'Tổng thỏa thuận',
    group: 'MỨC LƯƠNG & THƯỞNG HTCV',
    groupClass: 'th-group--salary',
    width: 125,
    align: 'right',
    headerClass: 'font-semibold',
    cellClass: 'font-semibold',
    render: (r) => fmtM(r.total_income_agreed || r.base_salary),
    renderTotal: (totals) => fmtM(totals.total_income_agreed),
  },

  // 3. NGÀY CÔNG LÀM VIỆC (5 columns)
  {
    key: 'probation_days',
    title: 'Công TV',
    group: 'NGÀY CÔNG LÀM VIỆC',
    groupClass: 'th-group--days',
    width: 65,
    align: 'center',
    render: (r) => fmtNum(r.probation_days),
    renderTotal: (totals) => fmtNum(totals.probation_days),
  },
  {
    key: 'official_days',
    title: 'Công CT',
    group: 'NGÀY CÔNG LÀM VIỆC',
    groupClass: 'th-group--days',
    width: 65,
    align: 'center',
    render: (r) => fmtNum(r.official_days || r.work_days),
    renderTotal: (totals) => fmtNum(totals.official_days),
  },
  {
    key: 'paid_leave_days',
    title: 'Nghỉ phép',
    group: 'NGÀY CÔNG LÀM VIỆC',
    groupClass: 'th-group--days',
    width: 70,
    align: 'center',
    render: (r) => fmtNum(r.paid_leave_days),
    renderTotal: (totals) => fmtNum(totals.paid_leave_days),
  },
  {
    key: 'unpaid_leave_days',
    title: 'Nghỉ KL',
    group: 'NGÀY CÔNG LÀM VIỆC',
    groupClass: 'th-group--days',
    width: 65,
    align: 'center',
    render: (r) => fmtNum(r.unpaid_leave_days),
    renderTotal: (totals) => fmtNum(totals.unpaid_leave_days),
  },
  {
    key: 'work_income',
    title: 'Thu nhập công',
    group: 'NGÀY CÔNG LÀM VIỆC',
    groupClass: 'th-group--days',
    width: 120,
    align: 'right',
    render: (r) => fmtM(r.work_income),
    renderTotal: (totals) => fmtM(totals.work_income),
  },

  // 4. LÀM THÊM GIỜ (OT) (5 columns)
  {
    key: 'ot_normal_hours',
    title: 'Giờ thường',
    group: 'LÀM THÊM GIỜ (OT)',
    groupClass: 'th-group--ot',
    width: 70,
    align: 'center',
    render: (r) => fmtNum(r.ot_normal_hours),
    renderTotal: (totals) => fmtNum(totals.ot_normal_hours),
  },
  {
    key: 'ot_weekend_hours',
    title: 'Giờ nghỉ',
    group: 'LÀM THÊM GIỜ (OT)',
    groupClass: 'th-group--ot',
    width: 70,
    align: 'center',
    render: (r) => fmtNum(r.ot_weekend_hours),
    renderTotal: (totals) => fmtNum(totals.ot_weekend_hours),
  },
  {
    key: 'ot_holiday_hours',
    title: 'Giờ lễ',
    group: 'LÀM THÊM GIỜ (OT)',
    groupClass: 'th-group--ot',
    width: 70,
    align: 'center',
    render: (r) => fmtNum(r.ot_holiday_hours),
    renderTotal: (totals) => fmtNum(totals.ot_holiday_hours),
  },
  {
    key: 'base_hourly_rate',
    title: 'Đơn giá giờ',
    group: 'LÀM THÊM GIỜ (OT)',
    groupClass: 'th-group--ot',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.base_hourly_rate),
    renderTotal: () => '—',
  },
  {
    key: 'ot_total_income',
    title: 'Tiền OT',
    group: 'LÀM THÊM GIỜ (OT)',
    groupClass: 'th-group--ot',
    width: 110,
    align: 'right',
    render: (r) => fmtM(r.ot_total_income || r.overtime_pay),
    renderTotal: (totals) => fmtM(totals.ot_total_income),
  },

  // 5. PHỤ CẤP THEO QUY ĐỊNH (6 columns)
  {
    key: 'parking_allowance',
    title: 'Gửi xe',
    group: 'PHỤ CẤP THEO QUY ĐỊNH',
    groupClass: 'th-group--allowance',
    width: 85,
    align: 'right',
    render: (r) => fmtM(r.parking_allowance),
    renderTotal: (totals) => fmtM(totals.parking_allowance),
  },
  {
    key: 'fuel_allowance',
    title: 'Xăng xe',
    group: 'PHỤ CẤP THEO QUY ĐỊNH',
    groupClass: 'th-group--allowance',
    width: 85,
    align: 'right',
    render: (r) => fmtM(r.fuel_allowance),
    renderTotal: (totals) => fmtM(totals.fuel_allowance),
  },
  {
    key: 'phone_allowance',
    title: 'Điện thoại',
    group: 'PHỤ CẤP THEO QUY ĐỊNH',
    groupClass: 'th-group--allowance',
    width: 85,
    align: 'right',
    render: (r) => fmtM(r.phone_allowance),
    renderTotal: (totals) => fmtM(totals.phone_allowance),
  },
  {
    key: 'attire_allowance',
    title: 'Trang phục',
    group: 'PHỤ CẤP THEO QUY ĐỊNH',
    groupClass: 'th-group--allowance',
    width: 85,
    align: 'right',
    render: (r) => fmtM(r.attire_allowance),
    renderTotal: (totals) => fmtM(totals.attire_allowance),
  },
  {
    key: 'business_trip_allowance',
    title: 'Công tác',
    group: 'PHỤ CẤP THEO QUY ĐỊNH',
    groupClass: 'th-group--allowance',
    width: 85,
    align: 'right',
    render: (r) => fmtM(r.business_trip_allowance),
    renderTotal: (totals) => fmtM(totals.business_trip_allowance),
  },
  {
    key: 'total_allowance',
    title: 'Tổng PC',
    group: 'PHỤ CẤP THEO QUY ĐỊNH',
    groupClass: 'th-group--allowance',
    width: 110,
    align: 'right',
    headerClass: 'font-semibold',
    cellClass: 'font-semibold',
    render: (r) => fmtM(r.total_allowance || r.allowance),
    renderTotal: (totals) => fmtM(totals.total_allowance),
  },

  // 6. THU NHẬP TRƯỚC THUẾ (3 columns)
  {
    key: 'total_income_with_allowance',
    title: 'Tổng TN & PC',
    group: 'THU NHẬP TRƯỚC THUẾ',
    groupClass: 'th-group--pretax',
    width: 125,
    align: 'right',
    render: (r) => fmtM(r.total_income_with_allowance),
    renderTotal: (totals) => fmtM(totals.total_income_with_allowance),
  },
  {
    key: 'kpi_bonus',
    title: 'Thưởng KPI',
    group: 'THU NHẬP TRƯỚC THUẾ',
    groupClass: 'th-group--pretax',
    width: 105,
    align: 'right',
    render: (r) => fmtM(r.kpi_bonus),
    renderTotal: (totals) => fmtM(totals.kpi_bonus),
  },
  {
    key: 'total_pretax_income',
    title: 'Tổng TN trước thuế',
    group: 'THU NHẬP TRƯỚC THUẾ',
    groupClass: 'th-group--pretax',
    width: 135,
    align: 'right',
    headerClass: 'font-bold',
    cellClass: 'font-bold',
    render: (r) => fmtM(r.total_pretax_income),
    renderTotal: (totals) => fmtM(totals.total_pretax_income),
  },

  // 7. CÁC KHOẢN ĐÓNG GÓP NLĐ (4 columns)
  {
    key: 'insurance_social',
    title: 'BHXH (8%)',
    group: 'CÁC KHOẢN ĐÓNG GÓP NLĐ',
    groupClass: 'th-group--insurance',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.insurance_social),
    renderTotal: (totals) => fmtM(totals.insurance_social),
  },
  {
    key: 'insurance_health',
    title: 'BHYT (1.5%)',
    group: 'CÁC KHOẢN ĐÓNG GÓP NLĐ',
    groupClass: 'th-group--insurance',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.insurance_health),
    renderTotal: (totals) => fmtM(totals.insurance_health),
  },
  {
    key: 'insurance_unemployment',
    title: 'BHTN (1%)',
    group: 'CÁC KHOẢN ĐÓNG GÓP NLĐ',
    groupClass: 'th-group--insurance',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.insurance_unemployment),
    renderTotal: (totals) => fmtM(totals.insurance_unemployment),
  },
  {
    key: 'insurance_total',
    title: 'Tổng BH NLĐ',
    group: 'CÁC KHOẢN ĐÓNG GÓP NLĐ',
    groupClass: 'th-group--insurance',
    width: 110,
    align: 'right',
    headerClass: 'font-semibold',
    cellClass: 'font-semibold',
    render: (r) => fmtM(r.insurance || (Number(r.insurance_social || 0) + Number(r.insurance_health || 0) + Number(r.insurance_unemployment || 0))),
    renderTotal: (totals) => fmtM(totals.insurance_total),
  },

  // 8. GIẢM TRỪ GIA CẢNH & THUẾ TNCN (6 columns)
  {
    key: 'personal_deduction',
    title: 'GT Bản thân',
    group: 'GIẢM TRỪ GIA CẢNH & THUẾ TNCN',
    groupClass: 'th-group--tax',
    width: 105,
    align: 'right',
    render: (r) => fmtM(r.personal_deduction),
    renderTotal: (totals) => fmtM(totals.personal_deduction),
  },
  {
    key: 'dependent_deduction',
    title: 'GT Phụ thuộc',
    group: 'GIẢM TRỪ GIA CẢNH & THUẾ TNCN',
    groupClass: 'th-group--tax',
    width: 105,
    align: 'right',
    render: (r) => fmtM(r.dependent_deduction),
    renderTotal: (totals) => fmtM(totals.dependent_deduction),
  },
  {
    key: 'dependent_count',
    title: 'Số người',
    group: 'GIẢM TRỪ GIA CẢNH & THUẾ TNCN',
    groupClass: 'th-group--tax',
    width: 65,
    align: 'center',
    render: (r) => fmtNum(r.dependent_count),
    renderTotal: (totals) => fmtNum(totals.dependent_count),
  },
  {
    key: 'total_family_deduction',
    title: 'Tổng giảm trừ',
    group: 'GIẢM TRỪ GIA CẢNH & THUẾ TNCN',
    groupClass: 'th-group--tax',
    width: 110,
    align: 'right',
    render: (r) => fmtM(r.total_family_deduction),
    renderTotal: (totals) => fmtM(totals.total_family_deduction),
  },
  {
    key: 'taxable_income',
    title: 'TN tính thuế',
    group: 'GIẢM TRỪ GIA CẢNH & THUẾ TNCN',
    groupClass: 'th-group--tax',
    width: 110,
    align: 'right',
    render: (r) => fmtM(r.taxable_income),
    renderTotal: (totals) => fmtM(totals.taxable_income),
  },
  {
    key: 'tax',
    title: 'Thuế TNCN',
    group: 'GIẢM TRỪ GIA CẢNH & THUẾ TNCN',
    groupClass: 'th-group--tax',
    width: 105,
    align: 'right',
    headerClass: 'font-semibold text-danger',
    cellClass: 'font-semibold text-danger',
    render: (r) => fmtM(r.tax),
    renderTotal: (totals) => fmtM(totals.personal_tax),
  },

  // 9. CÁC KHOẢN ĐIỀU CHỈNH (5 columns)
  {
    key: 'net_income_after_tax',
    title: 'Sau thuế',
    group: 'CÁC KHOẢN ĐIỀU CHỈNH',
    groupClass: 'th-group--adjust',
    width: 115,
    align: 'right',
    render: (r) => fmtM(r.net_income_after_tax),
    renderTotal: (totals) => fmtM(totals.net_income_after_tax),
  },
  {
    key: 'tax_withheld',
    title: 'Thuế đã trừ',
    group: 'CÁC KHOẢN ĐIỀU CHỈNH',
    groupClass: 'th-group--adjust',
    width: 105,
    align: 'right',
    render: (r) => fmtM(r.tax_withheld),
    renderTotal: (totals) => fmtM(totals.tax_withheld),
  },
  {
    key: 'meal_allowance',
    title: 'Tiền ăn ca',
    group: 'CÁC KHOẢN ĐIỀU CHỈNH',
    groupClass: 'th-group--adjust',
    width: 105,
    align: 'right',
    headerClass: 'font-semibold text-success',
    cellClass: 'font-semibold text-success',
    render: (r) => fmtM(r.meal_allowance),
    renderTotal: (totals) => fmtM(totals.meal_allowance),
  },
  {
    key: 'arrears_deduction',
    title: 'Truy thu',
    group: 'CÁC KHOẢN ĐIỀU CHỈNH',
    groupClass: 'th-group--adjust',
    width: 100,
    align: 'right',
    cellClass: 'text-danger',
    render: (r) => fmtM(r.arrears_deduction || r.deduction),
    renderTotal: (totals) => fmtM(totals.arrears_deduction),
  },
  {
    key: 'arrears_addition',
    title: 'Truy lĩnh',
    group: 'CÁC KHOẢN ĐIỀU CHỈNH',
    groupClass: 'th-group--adjust',
    width: 100,
    align: 'right',
    cellClass: 'text-success',
    render: (r) => fmtM(r.arrears_addition),
    renderTotal: (totals) => fmtM(totals.arrears_addition),
  },

  // 10. THỰC CHUYỂN (1 column)
  {
    key: 'transfer_amount',
    title: 'Chuyển vào TK NLĐ',
    group: 'THỰC CHUYỂN',
    groupClass: 'th-group--transfer',
    width: 145,
    align: 'right',
    headerClass: 'th-transfer-col',
    cellClass: 'td-transfer-col',
    render: (r) => fmtM(r.transfer_amount || r.net_salary),
    renderTotal: (totals) => fmtM(totals.transfer_amount),
  },

  // 11. CÁC KHOẢN CÔNG TY ĐÓNG (21.5%) (5 columns)
  {
    key: 'comp_insurance_social',
    title: 'BHXH Cty (17%)',
    group: 'CÁC KHOẢN CÔNG TY ĐÓNG (21.5%)',
    groupClass: 'th-group--company',
    width: 105,
    align: 'right',
    render: (r) => fmtM(r.comp_insurance_social),
    renderTotal: (totals) => fmtM(totals.comp_insurance_social),
  },
  {
    key: 'comp_insurance_health',
    title: 'BHYT Cty (3%)',
    group: 'CÁC KHOẢN CÔNG TY ĐÓNG (21.5%)',
    groupClass: 'th-group--company',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.comp_insurance_health),
    renderTotal: (totals) => fmtM(totals.comp_insurance_health),
  },
  {
    key: 'comp_insurance_unemp',
    title: 'BHTN Cty (1%)',
    group: 'CÁC KHOẢN CÔNG TY ĐÓNG (21.5%)',
    groupClass: 'th-group--company',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.comp_insurance_unemp),
    renderTotal: (totals) => fmtM(totals.comp_insurance_unemp),
  },
  {
    key: 'comp_insurance_accident',
    title: 'BHTNLĐ (0.5%)',
    group: 'CÁC KHOẢN CÔNG TY ĐÓNG (21.5%)',
    groupClass: 'th-group--company',
    width: 95,
    align: 'right',
    render: (r) => fmtM(r.comp_insurance_accident),
    renderTotal: (totals) => fmtM(totals.comp_insurance_accident),
  },
  {
    key: 'comp_insurance_total',
    title: 'Tổng BH Cty',
    group: 'CÁC KHOẢN CÔNG TY ĐÓNG (21.5%)',
    groupClass: 'th-group--company',
    width: 115,
    align: 'right',
    headerClass: 'font-semibold',
    cellClass: 'font-semibold',
    render: (r) => fmtM(r.comp_insurance_total),
    renderTotal: (totals) => fmtM(totals.comp_insurance_total),
  },

  // 12. TỔNG QUỸ LƯƠNG (1 column)
  {
    key: 'total_company_cost',
    title: 'Tổng chi phí Cty',
    group: 'TỔNG QUỸ LƯƠNG',
    groupClass: 'th-group--cost',
    width: 145,
    align: 'right',
    headerClass: 'th-cost-col',
    cellClass: 'td-cost-col',
    render: (r) => fmtM(r.total_company_cost),
    renderTotal: (totals) => fmtM(totals.total_company_cost),
  },

  // 13. KHÁC (2 columns)
  {
    key: 'is_signed',
    title: 'Đã ký',
    group: 'KHÁC',
    groupClass: 'th-group--other',
    width: 60,
    align: 'center',
    render: (r) => (r.is_signed ? '<span class="signed-check">✓</span>' : '—'),
    renderTotal: () => '',
  },
  {
    key: 'notes',
    title: 'Ghi chú',
    group: 'KHÁC',
    groupClass: 'th-group--other',
    width: 160,
    align: 'left',
    colClass: 'col-note',
    render: (r) => esc(r.notes || r.note || '—'),
    renderTotal: () => '',
  },
];

function renderFullPayrollTableHTML(pageData, allFilteredRows) {
  const totals = {
    insurance_base: allFilteredRows.reduce((s, r) => s + Number(r.insurance_base || 0), 0),
    position_salary: allFilteredRows.reduce((s, r) => s + Number(r.position_salary || 0), 0),
    completion_bonus: allFilteredRows.reduce((s, r) => s + Number(r.completion_bonus || 0), 0),
    total_income_agreed: allFilteredRows.reduce((s, r) => s + Number(r.total_income_agreed || r.base_salary || 0), 0),
    probation_days: allFilteredRows.reduce((s, r) => s + Number(r.probation_days || 0), 0),
    official_days: allFilteredRows.reduce((s, r) => s + Number(r.official_days || r.work_days || 0), 0),
    paid_leave_days: allFilteredRows.reduce((s, r) => s + Number(r.paid_leave_days || 0), 0),
    unpaid_leave_days: allFilteredRows.reduce((s, r) => s + Number(r.unpaid_leave_days || 0), 0),
    work_income: allFilteredRows.reduce((s, r) => s + Number(r.work_income || 0), 0),
    ot_normal_hours: allFilteredRows.reduce((s, r) => s + Number(r.ot_normal_hours || 0), 0),
    ot_weekend_hours: allFilteredRows.reduce((s, r) => s + Number(r.ot_weekend_hours || 0), 0),
    ot_holiday_hours: allFilteredRows.reduce((s, r) => s + Number(r.ot_holiday_hours || 0), 0),
    ot_total_income: allFilteredRows.reduce((s, r) => s + Number(r.ot_total_income || r.overtime_pay || 0), 0),
    phone_allowance: allFilteredRows.reduce((s, r) => s + Number(r.phone_allowance || 0), 0),
    attire_allowance: allFilteredRows.reduce((s, r) => s + Number(r.attire_allowance || 0), 0),
    parking_allowance: allFilteredRows.reduce((s, r) => s + Number(r.parking_allowance || 0), 0),
    fuel_allowance: allFilteredRows.reduce((s, r) => s + Number(r.fuel_allowance || 0), 0),
    business_trip_allowance: allFilteredRows.reduce((s, r) => s + Number(r.business_trip_allowance || 0), 0),
    total_allowance: allFilteredRows.reduce((s, r) => s + Number(r.total_allowance || r.allowance || 0), 0),
    total_income_with_allowance: allFilteredRows.reduce((s, r) => s + Number(r.total_income_with_allowance || 0), 0),
    kpi_bonus: allFilteredRows.reduce((s, r) => s + Number(r.kpi_bonus || 0), 0),
    total_pretax_income: allFilteredRows.reduce((s, r) => s + Number(r.total_pretax_income || 0), 0),
    insurance_social: allFilteredRows.reduce((s, r) => s + Number(r.insurance_social || 0), 0),
    insurance_health: allFilteredRows.reduce((s, r) => s + Number(r.insurance_health || 0), 0),
    insurance_unemployment: allFilteredRows.reduce((s, r) => s + Number(r.insurance_unemployment || 0), 0),
    insurance_total: allFilteredRows.reduce((s, r) => s + Number(r.insurance || (Number(r.insurance_social || 0) + Number(r.insurance_health || 0) + Number(r.insurance_unemployment || 0))), 0),
    personal_deduction: allFilteredRows.reduce((s, r) => s + Number(r.personal_deduction || 0), 0),
    dependent_deduction: allFilteredRows.reduce((s, r) => s + Number(r.dependent_deduction || 0), 0),
    dependent_count: allFilteredRows.reduce((s, r) => s + Number(r.dependent_count || 0), 0),
    total_family_deduction: allFilteredRows.reduce((s, r) => s + Number(r.total_family_deduction || 0), 0),
    taxable_income: allFilteredRows.reduce((s, r) => s + Number(r.taxable_income || 0), 0),
    personal_tax: allFilteredRows.reduce((s, r) => s + Number(r.tax || 0), 0),
    net_income_after_tax: allFilteredRows.reduce((s, r) => s + Number(r.net_income_after_tax || 0), 0),
    tax_withheld: allFilteredRows.reduce((s, r) => s + Number(r.tax_withheld || 0), 0),
    meal_allowance: allFilteredRows.reduce((s, r) => s + Number(r.meal_allowance || 0), 0),
    arrears_deduction: allFilteredRows.reduce((s, r) => s + Number(r.arrears_deduction || 0), 0),
    arrears_addition: allFilteredRows.reduce((s, r) => s + Number(r.arrears_addition || 0), 0),
    transfer_amount: allFilteredRows.reduce((s, r) => s + Number(r.transfer_amount || r.net_salary || 0), 0),
    comp_insurance_social: allFilteredRows.reduce((s, r) => s + Number(r.comp_insurance_social || 0), 0),
    comp_insurance_health: allFilteredRows.reduce((s, r) => s + Number(r.comp_insurance_health || 0), 0),
    comp_insurance_unemp: allFilteredRows.reduce((s, r) => s + Number(r.comp_insurance_unemp || 0), 0),
    comp_insurance_accident: allFilteredRows.reduce((s, r) => s + Number(r.comp_insurance_accident || 0), 0),
    comp_insurance_total: allFilteredRows.reduce((s, r) => s + Number(r.comp_insurance_total || 0), 0),
    total_company_cost: allFilteredRows.reduce((s, r) => s + Number(r.total_company_cost || 0), 0),
  };

  // Build Groups automatically from PAYROLL_COLUMNS
  const groupOrder = [];
  const groupMap = new Map();

  for (const col of PAYROLL_COLUMNS) {
    if (!groupMap.has(col.group)) {
      groupMap.set(col.group, {
        title: col.group,
        groupClass: col.groupClass,
        sticky: col.sticky,
        count: 0,
        width: 0,
      });
      groupOrder.push(col.group);
    }
    const g = groupMap.get(col.group);
    g.count++;
    g.width += col.width;
  }

  const colgroupHTML = PAYROLL_COLUMNS.map(col =>
    `<col style="width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;" />`
  ).join('');

  const theadRow1HTML = groupOrder.map(gName => {
    const g = groupMap.get(gName);
    const stickyClass = g.sticky ? 'sticky-group-header' : (g.groupClass || '');
    const stickyStyle = g.sticky
      ? `width:${g.width}px;min-width:${g.width}px;max-width:${g.width}px;left:0;`
      : `width:${g.width}px;min-width:${g.width}px;`;
    return `<th colspan="${g.count}" class="${stickyClass}" style="${stickyStyle}">${esc(g.title)}</th>`;
  }).join('');

  const theadRow2HTML = PAYROLL_COLUMNS.map(col => {
    const stickyClass = col.sticky ? `sticky-col ${col.colClass || ''}` : (col.colClass || '');
    const stickyStyle = col.sticky
      ? `left:${col.stickyLeft}px;width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;`
      : `width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;`;
    return `<th class="${stickyClass} text-${col.align} ${col.headerClass || ''}" style="${stickyStyle}">${esc(col.title)}</th>`;
  }).join('');

  const tbodyHTML = pageData.rows.map((r, idx) => {
    const cellsHTML = PAYROLL_COLUMNS.map(col => {
      const val = col.render ? col.render(r, idx, pageData) : (r[col.key] !== undefined ? esc(String(r[col.key])) : '—');
      const stickyClass = col.sticky ? `sticky-col ${col.colClass || ''}` : (col.colClass || '');
      const stickyStyle = col.sticky
        ? `left:${col.stickyLeft}px;width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;`
        : `width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;`;
      const titleAttr = (col.key === 'employee_name' || col.key === 'department' || col.key === 'notes') ? ` title="${esc(String(r[col.key] || ''))}"` : '';
      return `<td class="${stickyClass} text-${col.align} ${col.cellClass || ''}" style="${stickyStyle}"${titleAttr}>${val}</td>`;
    }).join('');
    return `<tr class="payroll-row" data-pid="${r.id}" tabindex="0" role="button" aria-label="Mở phiếu lương của ${esc(r.employee_name || 'nhân viên')}">${cellsHTML}</tr>`;
  }).join('');

  const tfootHTML = PAYROLL_COLUMNS.map(col => {
    const val = col.renderTotal ? col.renderTotal(totals, allFilteredRows) : '';
    const stickyClass = col.sticky ? `sticky-col ${col.colClass || ''}` : (col.colClass || '');
    const stickyStyle = col.sticky
      ? `left:${col.stickyLeft}px;width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;`
      : `width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px;`;
    return `<td class="${stickyClass} text-${col.align} ${col.cellClass || ''} font-bold" style="${stickyStyle}">${val}</td>`;
  }).join('');

  return `
    <div class="payroll-top-scroll" id="payroll-top-scroll">
      <div class="payroll-top-scroll-inner" id="payroll-top-scroll-inner"></div>
    </div>
    <div class="payroll-full-table-wrap" id="payroll-table-wrap">
      <table class="payroll-full-table" id="payroll-full-table">
        <colgroup>${colgroupHTML}</colgroup>
        <thead>
          <tr>${theadRow1HTML}</tr>
          <tr>${theadRow2HTML}</tr>
        </thead>
        <tbody>
          ${tbodyHTML}
        </tbody>
        <tfoot>
          <tr class="payroll-full-tfoot">
            ${tfootHTML}
          </tr>
        </tfoot>
      </table>
    </div>
    ${paginationHTML(pageData)}
  `;
}

function initPayrollTableScrollSync() {
  const topScroll = document.getElementById('payroll-top-scroll');
  const topScrollInner = document.getElementById('payroll-top-scroll-inner');
  const tableWrap = document.getElementById('payroll-table-wrap');
  const table = document.getElementById('payroll-full-table');

  if (!topScroll || !topScrollInner || !tableWrap || !table) return;

  const syncWidth = () => {
    topScrollInner.style.width = table.scrollWidth + 'px';
    if (table.scrollWidth <= tableWrap.clientWidth + 2) {
      topScroll.style.display = 'none';
    } else {
      topScroll.style.display = 'block';
    }
  };
  syncWidth();

  let isSyncingTop = false;
  let isSyncingWrap = false;

  topScroll.addEventListener('scroll', () => {
    if (!isSyncingWrap) {
      isSyncingTop = true;
      tableWrap.scrollLeft = topScroll.scrollLeft;
      requestAnimationFrame(() => { isSyncingTop = false; });
    }
  }, { passive: true });

  tableWrap.addEventListener('scroll', () => {
    if (!isSyncingTop) {
      isSyncingWrap = true;
      topScroll.scrollLeft = tableWrap.scrollLeft;
      requestAnimationFrame(() => { isSyncingWrap = false; });
    }
  }, { passive: true });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => syncWidth());
    ro.observe(table);
    ro.observe(tableWrap);
  }
}

function openImportExcelModal(month, onDone) {
  let parsedResult = null;
  openModal('Nhập bảng lương từ Excel (Chuẩn 51 cột)', `
    <div class="payroll-import-modal-content">
      <div class="payroll-import-banner">
        <strong>${icon('fileSpreadsheet', 'sm')} Chuẩn bảng tính 51 cột NetViet:</strong> Bóc tách tự động mức lương, công thử việc/chính thức, làm thêm giờ, phụ cấp chi tiết, BHXH/BHYT/BHTN, thuế TNCN, tiền ăn ca, truy lĩnh, truy thu và số tiền thực chuyển ngân hàng.
      </div>

      <div class="payroll-import-controls-row" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
        <div class="payroll-import-field">
          <label for="import-excel-month" style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px;">Kỳ lương:</label>
          <input type="month" id="import-excel-month" class="input-sm" value="${esc(month)}" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600;"/>
        </div>
        <div class="payroll-import-field">
          <label for="import-std-days" style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px;">Định mức VP (ngày):</label>
          <input type="number" id="import-std-days" class="input-sm" value="23" style="width:80px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);"/>
        </div>
        <div class="payroll-import-field">
          <label for="import-std-sec" style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px;">Định mức BV (ngày):</label>
          <input type="number" id="import-std-sec" class="input-sm" value="27" style="width:80px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);"/>
        </div>
      </div>

      <div class="payroll-import-tabs" style="display:flex;gap:8px;border-bottom:1px solid var(--border);margin-bottom:12px;">
        <button type="button" class="tab-btn active" id="import-tab-paste" style="padding:8px 16px;font-size:13px;font-weight:600;background:transparent;border:none;border-bottom:2px solid var(--primary);color:var(--primary);cursor:pointer;">1. Dán trực tiếp từ Excel (Ctrl+V)</button>
        <button type="button" class="tab-btn" id="import-tab-file" style="padding:8px 16px;font-size:13px;font-weight:600;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-2);cursor:pointer;">2. Tải tệp Excel (.xlsx / .csv)</button>
      </div>

      <div id="import-pane-paste" class="import-tab-pane">
        <textarea id="import-paste-textarea" rows="7" style="width:100%;box-sizing:border-box;padding:10px;font-family:monospace;font-size:12px;border:1px solid var(--border);border-radius:6px;resize:vertical;" placeholder="Mở file Excel -> Bôi đen toàn bộ dữ liệu (từ dòng tiêu đề tới dòng nhân viên cuối cùng) -> Nhấn Ctrl+C -> Bấm vào ô này và nhấn Ctrl+V..."></textarea>
      </div>

      <div id="import-pane-file" class="import-tab-pane" style="display:none;">
        <div class="file-dropzone" id="import-dropzone" style="border:2px dashed #CBD5E1;border-radius:8px;padding:24px;text-align:center;background:#F8FAFC;cursor:pointer;">
          <input type="file" id="import-file-elem" accept=".xlsx,.xls,.csv,.tsv,.txt" style="display:none;"/>
          <div>${icon('upload', 'lg')}</div>
          <button type="button" class="btn-secondary btn-sm" id="btn-browse-file" style="margin-top:8px;">Chọn tệp Excel từ máy tính</button>
          <p id="import-file-name" style="margin:8px 0 0;font-size:12px;color:var(--text-3);">Hỗ trợ file .xlsx, .xls, .csv, .tsv</p>
        </div>
      </div>

      <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
        <button type="button" class="btn-secondary btn-sm" id="btn-do-parse">${icon('refreshCw', 'xs')} <span>Phân tích dữ liệu</span></button>
        <span id="import-parse-status" style="font-size:12px;color:var(--text-2);">Chưa có dữ liệu phân tích</span>
      </div>

      <div id="import-preview-container" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">
      </div>
    </div>
  `, `
    <button type="button" class="btn-secondary" id="btn-import-cancel">Hủy</button>
    <button type="button" class="btn-primary" id="btn-import-submit" disabled>${icon('check', 'sm')} <span>Lưu bảng lương vào hệ thống</span></button>
  `);

  document.getElementById('modal')?.classList.add('modal--payroll-import');

  const tabPaste = document.getElementById('import-tab-paste');
  const tabFile = document.getElementById('import-tab-file');
  const panePaste = document.getElementById('import-pane-paste');
  const paneFile = document.getElementById('import-pane-file');
  const pasteTextarea = document.getElementById('import-paste-textarea');
  const fileElem = document.getElementById('import-file-elem');
  const btnBrowse = document.getElementById('btn-browse-file');
  const fileNameLabel = document.getElementById('import-file-name');
  const btnDoParse = document.getElementById('btn-do-parse');
  const parseStatus = document.getElementById('import-parse-status');
  const previewContainer = document.getElementById('import-preview-container');
  const btnSubmit = document.getElementById('btn-import-submit');

  tabPaste?.addEventListener('click', () => {
    tabPaste.classList.add('active');
    tabPaste.style.color = 'var(--primary)';
    tabPaste.style.borderBottomColor = 'var(--primary)';
    tabFile.classList.remove('active');
    tabFile.style.color = 'var(--text-2)';
    tabFile.style.borderBottomColor = 'transparent';
    panePaste.style.display = 'block';
    paneFile.style.display = 'none';
  });

  tabFile?.addEventListener('click', () => {
    tabFile.classList.add('active');
    tabFile.style.color = 'var(--primary)';
    tabFile.style.borderBottomColor = 'var(--primary)';
    tabPaste.classList.remove('active');
    tabPaste.style.color = 'var(--text-2)';
    tabPaste.style.borderBottomColor = 'transparent';
    paneFile.style.display = 'block';
    panePaste.style.display = 'none';
  });

  btnBrowse?.addEventListener('click', () => fileElem?.click());
  fileElem?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileNameLabel.textContent = `Đã chọn: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    if (file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt')) {
      const text = await file.text();
      pasteTextarea.value = text;
      runParse(text);
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      parseStatus.textContent = 'Đang đọc tệp Excel...';
      try {
        let XLSX = window.XLSX;
        if (!XLSX) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Không thể nạp thư viện XLSX. Vui lòng dán trực tiếp từ Excel.'));
            document.head.appendChild(script);
          });
          XLSX = window.XLSX;
        }
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' });
        pasteTextarea.value = tsv;
        runParse(tsv);
      } catch (err) {
        parseStatus.textContent = `Lỗi đọc file Excel: ${err.message}`;
        toast(err.message, 'error');
      }
    }
  });

  pasteTextarea?.addEventListener('input', () => {
    if (pasteTextarea.value.trim().length > 100) {
      runParse(pasteTextarea.value);
    }
  });

  btnDoParse?.addEventListener('click', () => {
    runParse(pasteTextarea.value);
  });

  function runParse(text) {
    if (!text || !text.trim()) {
      parseStatus.textContent = 'Vui lòng dán dữ liệu hoặc chọn tệp trước khi phân tích.';
      return;
    }
    try {
      const parsed = parsePayrollExcelText(text);
      if (!parsed.rows.length) {
        throw new Error('Không tìm thấy dòng dữ liệu nhân viên nào hợp lệ trong bảng tính.');
      }
      parsedResult = parsed;
      parseStatus.innerHTML = `<span style="color:var(--success);font-weight:700;">✓ Nhận diện thành công ${parsed.rows.length} nhân sự</span>`;
      btnSubmit.disabled = false;

      if (parsed.standard_days) document.getElementById('import-std-days').value = parsed.standard_days;
      if (parsed.standard_days_security) document.getElementById('import-std-sec').value = parsed.standard_days_security;

      previewContainer.style.display = 'block';
      previewContainer.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(135px, 1fr));gap:8px;margin-bottom:12px;">
          <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:var(--text-3);">Tổng nhân sự</div>
            <div style="font-size:16px;font-weight:800;color:var(--text);">${parsed.rows.length} người</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:var(--text-3);">Tổng TN trước thuế</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);">${fmtMoney(parsed.summary.total_pretax_income)}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:var(--text-3);">Tổng tiền ăn ca</div>
            <div style="font-size:13px;font-weight:700;color:#059669;">${fmtMoney(parsed.summary.total_meal_allowance)}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:var(--text-3);">BHXH NLĐ (10.5%)</div>
            <div style="font-size:13px;font-weight:700;color:#DC2626;">${fmtMoney(parsed.summary.total_insurance)}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:var(--text-3);">Thuế TNCN</div>
            <div style="font-size:13px;font-weight:700;color:#DC2626;">${fmtMoney(parsed.summary.total_tax)}</div>
          </div>
          <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:#047857;font-weight:600;">SỐ TIỀN CHUYỂN VÀO TK</div>
            <div style="font-size:15px;font-weight:800;color:#047857;">${fmtMoney(parsed.summary.total_transfer_amount)}</div>
          </div>
          <div style="background:#F8FAFC;border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:11px;color:var(--text-3);">Tổng quỹ lương Cty</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);">${fmtMoney(parsed.summary.total_company_cost)}</div>
          </div>
        </div>

        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
          <table class="table" style="width:100%;font-size:11px;border-collapse:collapse;">
            <thead style="position:sticky;top:0;background:#F8FAFC;">
              <tr>
                <th style="padding:6px;text-align:center;">TT</th>
                <th style="padding:6px;text-align:left;">Họ và tên</th>
                <th style="padding:6px;text-align:left;">Mã NV</th>
                <th style="padding:6px;text-align:left;">Phòng ban</th>
                <th style="padding:6px;text-align:right;">Mức thỏa thuận</th>
                <th style="padding:6px;text-align:center;">Công</th>
                <th style="padding:6px;text-align:right;">Ăn ca</th>
                <th style="padding:6px;text-align:right;background:#ECFDF5;color:#047857;">Thực chuyển</th>
              </tr>
            </thead>
            <tbody>
              ${parsed.rows.slice(0, 10).map((r, i) => `
                <tr style="border-top:1px solid #F1F5F9;">
                  <td style="padding:5px;text-align:center;">${i + 1}</td>
                  <td style="padding:5px;font-weight:600;">${esc(r.full_name)}</td>
                  <td style="padding:5px;font-family:monospace;">${esc(r.employee_code)}</td>
                  <td style="padding:5px;">${esc(r.department)}</td>
                  <td style="padding:5px;text-align:right;">${fmtMoney(r.total_income_agreed)}</td>
                  <td style="padding:5px;text-align:center;">${r.work_days}</td>
                  <td style="padding:5px;text-align:right;">${fmtMoney(r.meal_allowance)}</td>
                  <td style="padding:5px;text-align:right;font-weight:700;background:#ECFDF5;color:#047857;">${fmtMoney(r.transfer_amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${parsed.rows.length > 10 ? `<div style="text-align:center;padding:6px;font-size:11px;color:var(--text-3);background:#F8FAFC;">... và ${parsed.rows.length - 10} nhân sự khác</div>` : ''}
        </div>
      `;
    } catch (err) {
      parsedResult = null;
      btnSubmit.disabled = true;
      parseStatus.innerHTML = `<span style="color:var(--danger);font-weight:600;">✕ Lỗi: ${esc(err.message)}</span>`;
      previewContainer.style.display = 'none';
    }
  }

  document.getElementById('btn-import-cancel')?.addEventListener('click', closeModal);
  btnSubmit?.addEventListener('click', async () => {
    if (!parsedResult || !parsedResult.rows.length) return;
    const targetMonth = document.getElementById('import-excel-month')?.value || month;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `${icon('refreshCw', 'xs')} <span>Đang lưu dữ liệu...</span>`;
    try {
      const res = await api.importPayrollExcel({
        month: targetMonth,
        rows: parsedResult.rows,
        standard_days: Number(document.getElementById('import-std-days')?.value || 23),
        standard_days_security: Number(document.getElementById('import-std-sec')?.value || 27),
      });
      toast(`Đã import thành công ${res.total} nhân sự cho kỳ ${formatMonth(targetMonth)}!`, 'success');
      closeModal();
      if (typeof onDone === 'function') onDone(targetMonth);
    } catch (err) {
      toast(err.message || 'Lỗi lưu bảng lương', 'error');
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `${icon('check', 'sm')} <span>Lưu bảng lương vào hệ thống</span>`;
    }
  });
}

export async function renderPayroll(el, me) {
  const isHr = me.role === 'admin' || me.role === 'manager' || isHcnsDepartment(me.department);
  const canEditPayroll = me.role === 'admin' || isHcnsDepartment(me.department);
  if (!isHr) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('lock', 'lg')}</div><div class="empty-text">Không có quyền truy cập</div></div>`;
    return;
  }

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let adjustmentData = { suggestions: [], approved: [] };
  let adjustmentPage = 1;
  let selectedAdjustmentRefs = new Set();
  const adjustmentAmounts = new Map();
  let latestPayrollRows = [];
  let currentPage = 1;
  let viewMode = localStorage.getItem('payroll_view_mode') || 'full';

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:18px;">
      <div class="payroll-header-title-wrap">
        <div class="payroll-title-icon-badge">${icon('banknote', 'lg')}</div>
        <div>
          <h1 class="page-title">Bảng lương</h1>
          <p class="page-sub">Quản lý lương, quỹ phòng ban, chuyên cần và phát hành phiếu lương</p>
        </div>
      </div>
    </div>

    <!-- Month Picker & Action Controls -->
    <div class="payroll-control-bar">
      <div class="payroll-control-left">
        <div class="payroll-month-wrap">
          <span style="color:var(--text-3);display:flex;align-items:center;">${icon('calendarDays', 'xs')}</span>
          <span class="payroll-month-label">Kỳ lương:</span>
          <input type="month" id="payroll-month" class="payroll-month-input" value="${curMonth}"/>
        </div>
      </div>
      <div class="payroll-control-right">
        ${canEditPayroll ? `<button id="btn-import-excel" class="btn-primary btn-sm">${icon('upload', 'sm')} <span>Nhập từ Excel</span></button>` : ''}
        ${canEditPayroll ? `<button id="btn-sync-payroll" class="btn-secondary btn-sm">${icon('refreshCw', 'sm')} <span>Đồng bộ hệ thống</span></button>` : ''}
        <button id="btn-export-payslips" class="btn-secondary btn-sm">${icon('fileText', 'sm')} <span>Xuất phiếu lương tháng ${formatMonth(curMonth)}</span></button>
      </div>
    </div>
    <div id="payroll-load-status" class="payroll-status-note"></div>

    <!-- Interactive Charts Grid (Dumbbell Chart, Budget by Dept & Attendance Breakdown) -->
    <div id="payroll-charts-container" class="payroll-charts-grid">
      <div class="payroll-chart-card payroll-dumbbell-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;">Đang tính toán so sánh % Nhân sự ↔ % Quỹ lương...</div>
      <div class="payroll-chart-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;">Đang tính toán phân bổ ngân sách...</div>
      <div class="payroll-chart-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;">Đang tính toán cơ cấu chấm công...</div>
    </div>

    <!-- Adjustments Suggestion Panel -->
    <div id="payroll-adjustments"></div>

    <!-- Filter Card Box -->
    <div class="payroll-filter-card">
      <div class="payroll-search-wrap" style="flex:1;min-width:240px;">
        <span class="payroll-search-icon">${icon('search', 'sm')}</span>
        <input type="text" id="payroll-search" class="payroll-search-input" placeholder="Tìm theo tên nhân viên, mã nhân viên..."/>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <div class="payroll-view-mode-toggle" style="display:inline-flex;background:var(--bg-2, #F1F5F9);padding:3px;border-radius:var(--radius-sm, 6px);border:1px solid var(--border);">
          <button type="button" class="btn-view-toggle ${viewMode === 'full' ? 'active' : ''}" data-mode="full" style="padding:4px 10px;font-size:12px;font-weight:600;border:none;border-radius:4px;cursor:pointer;background:${viewMode === 'full' ? 'var(--primary)' : 'transparent'};color:${viewMode === 'full' ? '#fff' : 'var(--text-2)'};">Chuẩn Excel (51 cột)</button>
          <button type="button" class="btn-view-toggle ${viewMode === 'compact' ? 'active' : ''}" data-mode="compact" style="padding:4px 10px;font-size:12px;font-weight:600;border:none;border-radius:4px;cursor:pointer;background:${viewMode === 'compact' ? 'var(--primary)' : 'transparent'};color:${viewMode === 'compact' ? '#fff' : 'var(--text-2)'};">Gọn gàng</button>
        </div>
        <select id="payroll-dept-filter" class="payroll-dept-select" style="min-width:180px;">
          <option value="">Tất cả phòng ban</option>
          ${DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
        </select>
        <div id="payroll-filter-count" style="font-size:12px;font-weight:700;color:var(--text-2);padding:7px 12px;background:#F8FAFC;border:1px solid var(--border);border-radius:var(--radius-sm);white-space:nowrap;"></div>
      </div>
    </div>

    <!-- Main Payroll Data Table -->
    <div class="payroll-table-card">
      <div id="payroll-table">${loadingHTML()}</div>
    </div>
  `;

  const monthInput = document.getElementById('payroll-month');
  document.getElementById('btn-import-excel')?.addEventListener('click', () => {
    openImportExcelModal(monthInput.value, (newMonth) => {
      monthInput.value = newMonth;
      currentPage = 1;
      updateExportButtonLabel();
      loadPayroll();
    });
  });
  document.querySelectorAll('.btn-view-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      localStorage.setItem('payroll_view_mode', viewMode);
      document.querySelectorAll('.btn-view-toggle').forEach(b => {
        const isActive = b.dataset.mode === viewMode;
        b.style.background = isActive ? 'var(--primary)' : 'transparent';
        b.style.color = isActive ? '#fff' : 'var(--text-2)';
      });
      currentPage = 1;
      loadPayroll({ keepStatus: true });
    });
  });
  document.getElementById('btn-export-payslips').addEventListener('click', openExportPayslipsConfirm);
  document.getElementById('btn-sync-payroll')?.addEventListener('click', openCreatePayrollBatchConfirm);
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

  // Legacy rows may still contain the date in their saved reason. The date is
  // now presented in its own column, so keep the reason concise on screen.
  function adjustmentReason(reason) {
    return String(reason || '')
      .replace(/\s+ngày\s+\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/\s+trong\s+\d{4}-\d{2}/gi, '');
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
    const pageData = paginateRows(suggestions, adjustmentPage, 10);
    adjustmentPage = pageData.page;
    const totalSuggestedBonus = suggestions.filter(x => x.type === 'bonus').reduce((s, x) => s + Number(x.amount || 0), 0);
    const totalSuggestedPenalty = suggestions.filter(x => x.type === 'penalty').reduce((s, x) => s + Number(x.amount || 0), 0);
    el.innerHTML = `
      <div class="payroll-adjustments-card">
        <div class="payroll-adjustments-header">
          <div>
            <div class="payroll-adjustments-title">Đề xuất thưởng-phạt tháng ${formatMonth(month)}</div>
            <div class="payroll-adjustments-sub">Tự động gợi ý từ đánh giá đã khóa, chấm công và deadline. HCNS xác nhận trước khi cộng/trừ lương.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${canEditPayroll ? `
              <button class="btn-secondary btn-xs" id="payroll-adjust-manual">${icon('triangleAlert', 'xs')} <span>Phạt thủ công</span></button>
              <button class="btn-secondary btn-xs" id="payroll-policy-reset">${icon('settings', 'xs')} <span>Đổi quy định phạt</span></button>
            ` : ''}
            <button class="btn-secondary btn-xs" id="payroll-adjust-refresh">${icon('refreshCw', 'xs')} <span>Làm mới đề xuất</span></button>
          </div>
        </div>
        <div class="payroll-adjustments-kpis">
          <div class="payroll-adj-kpi-item">
            <span class="payroll-adj-kpi-label">Chưa áp dụng</span>
            <span class="payroll-adj-kpi-val">${suggestions.length}</span>
          </div>
          <div class="payroll-adj-kpi-item">
            <span class="payroll-adj-kpi-label">Thưởng đề xuất</span>
            <span class="payroll-adj-kpi-val" style="color:var(--success);">+${fmtMoney(totalSuggestedBonus)}</span>
          </div>
          <div class="payroll-adj-kpi-item">
            <span class="payroll-adj-kpi-label">Phạt đề xuất</span>
            <span class="payroll-adj-kpi-val" style="color:var(--danger);">-${fmtMoney(totalSuggestedPenalty)}</span>
          </div>
        </div>
        ${suggestions.length ? `
          <div class="table-wrap" style="border:none;border-radius:0;">
            <table>
              <thead><tr><th></th><th>Nhân viên</th><th>Nguồn</th><th>Loại</th><th>Ngày vi phạm</th><th>Tháng áp dụng</th><th>Số tiền</th><th>Điểm</th><th>Lý do</th>${canEditPayroll ? '<th style="text-align:right;">Thao tác</th>' : ''}</tr></thead>
              <tbody>
                ${pageData.rows.map(s => `
                  <tr>
                    <td><input type="checkbox" class="adj-check" data-ref="${esc(s.source_ref)}" ${s.can_apply === false ? 'disabled' : 'checked'} title="${s.can_apply === false ? 'Cần đồng bộ/tạo dòng bảng lương trước' : ''}"></td>
                    <td><strong>${esc(s.employee_name || '—')}</strong><br><span style="font-size:11px;font-family:monospace;color:var(--text-3);">${esc(s.employee_code || '')}</span></td>
                    <td><span class="badge badge-gray">${esc(adjustmentSourceLabel(s.source))}</span></td>
                    <td>${esc(adjustmentTypeLabel(s.type))}</td>
                    <td>${esc(s.violation_date || '—')}</td>
                    <td>${esc(s.policy_month || month)}</td>
                    <td>${s.amount > 0 ? `<input type="number" class="adj-amount" data-ref="${esc(s.source_ref)}" value="${Number(s.amount || 0)}" min="0" step="50000" style="width:120px;padding:4px 8px;border-radius:6px;" ${s.can_apply === false ? 'disabled' : ''}>` : '—'}</td>
                    <td>${s.score_delta ? (s.score_delta > 0 ? '+' : '') + s.score_delta : '—'}</td>
                    <td style="white-space:normal;min-width:220px;font-size:12px;color:var(--text-2);">${esc(adjustmentReason(s.reason))}${s.can_apply === false ? '<br><span style="color:var(--warning);font-weight:700;">Cần đồng bộ/tạo dòng bảng lương trước khi áp dụng tiền.</span>' : ''}</td>
                    ${canEditPayroll ? `<td style="text-align:right;"><button class="btn-secondary btn-xs adj-dismiss" data-ref="${esc(s.source_ref)}" style="color:var(--danger);border-color:rgba(239,68,68,0.25);">${icon('trash2', 'xs')} <span>Xóa</span></button></td>` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${paginationHTML(pageData)}
          <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;background:#FAFBFD;border-top:1px solid var(--border);">
            <button class="btn-primary btn-sm" id="payroll-adjust-apply">${icon('check', 'sm')} <span>Áp dụng đề xuất đã chọn</span></button>
          </div>
        ` : `<div style="padding:16px 20px;color:var(--text-2);font-size:13px;">Chưa có đề xuất mới. Các khoản mềm như sáng kiến/top tuần/báo cáo sẽ nhập thủ công khi có quyết định.</div>`}
        ${approved.length ? `
          <div style="padding:14px 20px 18px;border-top:1px solid var(--divider);">
            <div class="section-title" style="margin:0 0 10px;font-size:13px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.4px;">Đã áp dụng gần đây</div>
            <div style="display:grid;gap:8px;">
              ${approved.slice(0, 6).map(a => {
                const tone = approvedAdjustmentTone(a);
                const hasAmount = Number(a.amount || 0) > 0;
                return `
                  <div style="display:flex;justify-content:space-between;gap:12px;border:1px solid ${tone.border};background:${tone.bg};border-radius:10px;padding:10px 14px;font-size:12.5px;align-items:center;">
                    <span style="color:${tone.color};line-height:1.45;"><strong>${esc(a.employee_name || '—')}</strong> · ${esc(adjustmentSourceLabel(a.source))} · ${a.violation_date ? `Ngày ${esc(a.violation_date)} · ` : ''}Kỳ ${esc(a.policy_month || a.month || month)} · ${esc(adjustmentReason(a.reason))}</span>
                    <span style="white-space:nowrap;color:${tone.color};font-weight:800;font-variant-numeric:tabular-nums;">${hasAmount ? tone.sign + fmtMoney(a.amount) : (a.score_delta || 'audit')}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
    document.getElementById('payroll-adjust-refresh')?.addEventListener('click', () => loadPayroll({ keepStatus: true }));
    document.getElementById('payroll-adjust-manual')?.addEventListener('click', openManualPenalty);
    document.getElementById('payroll-policy-reset')?.addEventListener('click', openPenaltyPolicyReset);
    document.getElementById('payroll-adjust-apply')?.addEventListener('click', applySelectedAdjustments);
    el.querySelectorAll('.adj-check').forEach(check => {
      const ref = check.dataset.ref;
      check.checked = selectedAdjustmentRefs.has(ref);
      check.addEventListener('change', () => {
        if (check.checked) selectedAdjustmentRefs.add(ref);
        else selectedAdjustmentRefs.delete(ref);
      });
    });
    el.querySelectorAll('.adj-amount').forEach(input => {
      const ref = input.dataset.ref;
      if (adjustmentAmounts.has(ref)) input.value = adjustmentAmounts.get(ref);
      input.addEventListener('input', () => adjustmentAmounts.set(ref, Number(input.value || 0)));
    });
    el.querySelectorAll('.adj-dismiss').forEach(button => {
      button.addEventListener('click', async () => {
        const ref = button.dataset.ref;
        if (!ref || !window.confirm('Xóa đề xuất này? Dữ liệu chấm công/công việc gốc sẽ không bị xóa.')) return;
        button.disabled = true;
        try {
          await api.dismissPayrollAdjustment(month, ref);
          selectedAdjustmentRefs.delete(ref);
          adjustmentAmounts.delete(ref);
          toast('Đã xóa đề xuất; dữ liệu nguồn được giữ nguyên.', 'success');
          await loadPayroll({ keepStatus: true });
        } catch (error) {
          toast(error.message || 'Không thể xóa đề xuất', 'error');
          button.disabled = false;
        }
      });
    });
    bindPagination(el, page => {
      adjustmentPage = page;
      renderAdjustmentPanel(month);
    });
  }

  async function applySelectedAdjustments() {
    const month = monthInput.value;
    const selectedRefs = Array.from(selectedAdjustmentRefs);
    if (!selectedRefs.length) { toast('Chọn ít nhất một đề xuất để áp dụng', 'error'); return; }
    const items = selectedRefs.map(ref => {
      const s = adjustmentData.suggestions.find(x => x.source_ref === ref);
      return { source_ref: ref, amount: adjustmentAmounts.has(ref) ? adjustmentAmounts.get(ref) : s?.amount };
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

  function openManualPenalty() {
    const employees = latestPayrollRows.filter(row => row.employee_id).map(row => `<option value="${row.employee_id}" data-payroll-id="${row.id}">${esc(row.employee_name || '—')} · ${esc(row.employee_code || '')}</option>`).join('');
    if (!employees) return toast('Hãy tải bảng lương trước khi tạo phạt thủ công', 'error');
    openModal('Phạt điểm thủ công', `<div class="field"><label>Nhân sự *</label><select id="manual-penalty-employee"><option value="">Chọn nhân sự</option>${employees}</select></div>
      <div class="field"><label>Vi phạm *</label><select id="manual-penalty-kind"><option value="report">Không chủ động báo cáo — trừ 3 điểm</option><option value="progress">Quản lý phải hỏi tiến độ — trừ 5 điểm</option></select></div>
      <div class="field"><label>Ngày vi phạm</label><input id="manual-penalty-date" type="date" min="${monthInput.value}-01" max="${monthInput.value}-31"></div>
      <div class="field"><label>Ghi chú / căn cứ *</label><textarea id="manual-penalty-reason" rows="3" placeholder="Mô tả sự việc, thời điểm hoặc nguồn xác minh"></textarea></div>`, '<button class="btn-secondary" id="manual-penalty-cancel">Hủy</button><button class="btn-primary" id="manual-penalty-save">Áp dụng</button>');
    document.getElementById('manual-penalty-cancel')?.addEventListener('click', closeModal);
    document.getElementById('manual-penalty-save')?.addEventListener('click', async event => {
      const select = document.getElementById('manual-penalty-employee');
      const kind = document.getElementById('manual-penalty-kind')?.value;
      const violationDate = document.getElementById('manual-penalty-date')?.value || null;
      const reason = document.getElementById('manual-penalty-reason')?.value.trim() || '';
      const employeeId = Number(select?.value || 0);
      const payrollId = Number(select?.selectedOptions?.[0]?.dataset.payrollId || 0) || null;
      const scoreDelta = kind === 'progress' ? -5 : -3;
      if (!employeeId || !reason) return toast('Chọn nhân sự và nhập căn cứ áp dụng', 'error');
      event.currentTarget.disabled = true;
      try {
        await api.applyPayrollAdjustments(monthInput.value, [{ source: 'manual', employee_id: employeeId, payroll_id: payrollId, type: 'score_penalty', amount: 0, score_delta: scoreDelta, violation_date: violationDate, reason }]);
        closeModal();
        toast('Đã lưu phạt điểm thủ công kèm audit', 'success');
        await loadPayroll({ keepStatus: true });
      } catch (error) { toast(error.message || 'Không thể áp dụng phạt thủ công', 'error'); event.currentTarget.disabled = false; }
    });
  }

  async function openPenaltyPolicyReset() {
    try {
      const preview = await api.previewPenaltyPolicyReset();
      if (preview.conflicts?.length) {
        return toast(`Không thể dọn: ${preview.conflicts.length} dòng lương có deduction không khớp.`, 'error', 6000);
      }
      openModal('Cập nhật quy định phạt từ 08/2026', `<div style="display:grid;gap:9px;line-height:1.45;">
        <div class="detail-item"><div class="detail-label">Row phạt sẽ xóa</div><div class="detail-val">${Number(preview.adjustment_count || 0)}</div></div>
        <div class="detail-item"><div class="detail-label">Hoàn deduction / lương</div><div class="detail-val" style="color:var(--success);">${fmtMoney(preview.total_payroll_refund || 0)}</div></div>
        <div class="detail-item"><div class="detail-label">Dòng lương được cập nhật</div><div class="detail-val">${Number(preview.payroll_rows_to_refund || 0)}</div></div>
        <div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;border-radius:8px;padding:10px;font-size:12px;">Thao tác xóa toàn bộ adjustment loại phạt/trừ điểm cũ, hoàn lương tương ứng và ghi audit. Không xóa bảng lương, attendance hay đánh giá.</div>
      </div>`, '<button class="btn-secondary" id="penalty-reset-cancel">Hủy</button><button class="btn-primary" id="penalty-reset-confirm">Xác nhận cập nhật</button>');
      document.getElementById('penalty-reset-cancel')?.addEventListener('click', closeModal);
      document.getElementById('penalty-reset-confirm')?.addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        try {
          const result = await api.resetPenaltyPolicy();
          closeModal();
          toast(`Đã xóa ${result.adjustment_count || 0} row phạt và hoàn ${fmtMoney(result.total_payroll_refund || 0)}.`, 'success', 6000);
          await loadPayroll({ keepStatus: true });
        } catch (error) { toast(error.message || 'Không thể cập nhật quy định phạt', 'error'); event.currentTarget.disabled = false; }
      });
    } catch (error) { toast(error.message || 'Không tải được thống kê dọn dữ liệu', 'error'); }
  }

  async function openCreatePayrollBatchConfirm() {
    const month = monthInput.value;
    if (!month) {
      toast('Vui lòng chọn tháng/năm trước khi tạo bảng lương', 'error');
      return;
    }
    const readyRows = latestPayrollRows.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready').length;
    const missingRows = latestPayrollRows.length - readyRows;
    const hasExcelRows = latestPayrollRows.some(p => p.import_source === 'excel' || Number(p.transfer_amount || 0) > 0);

    openModal(`Tạo bảng lương tháng ${formatMonth(month)}`, `
      <div style="display:grid;gap:10px;">
        <div class="detail-item"><div class="detail-label">Dòng lương hiện có</div><div class="detail-val">${latestPayrollRows.length}</div></div>
        <div class="detail-item"><div class="detail-label">Đủ dữ liệu hiện tại</div><div class="detail-val">${readyRows}</div></div>
        <div class="detail-item"><div class="detail-label">Thiếu cấu hình hiện tại</div><div class="detail-val">${missingRows}</div></div>
        ${hasExcelRows ? `
          <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.5;">
            <strong>ℹ Bảng lương chứa dữ liệu nạp từ Excel:</strong> Hệ thống đang bảo vệ dữ liệu chốt của kế toán. Thao tác này sẽ <strong>KHÔNG</strong> ghi đè số liệu các nhân sự đã import từ Excel.
          </div>
        ` : ''}
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
        adjustmentPage = 1;
        selectedAdjustmentRefs = new Set((adjustmentData.suggestions || []).filter(s => s.can_apply !== false).map(s => s.source_ref));
        adjustmentAmounts.clear();
      } catch (_) {
        adjustmentData = { suggestions: [], approved: [] };
        adjustmentPage = 1;
        selectedAdjustmentRefs = new Set();
        adjustmentAmounts.clear();
      }
      renderAdjustmentPanel(month);
      const totalBonus = payrolls.reduce((s, p) => s + (p.kpi_bonus || 0) + (p.allowance || 0), 0);
      const totalNet = payrolls.reduce((s, p) => s + (p.net_salary || 0), 0);
      const readyCount = payrolls.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready').length;
      const missingSalaryCount = payrolls.length - readyCount;
      let filtered = filterBySearch(payrolls, document.getElementById('payroll-search')?.value || '', ['employee_name', 'employee_code']);
      filtered = filterByDepartment(filtered, document.getElementById('payroll-dept-filter')?.value || '', ['department']);
      filtered = sortVietnameseNames(filtered, 'employee_name');
      const pageSize = viewMode === 'full' ? 50 : 15;
      const pageData = paginateRows(filtered, currentPage, pageSize);
      currentPage = pageData.page;

      const chartsEl = document.getElementById('payroll-charts-container');
      const countEl = document.getElementById('payroll-filter-count');
      if (countEl) {
        countEl.textContent = `Hiển thị ${filtered.length} / ${payrolls.length} nhân sự`;
      }

      if (chartsEl) {
        if (!payrolls.length) {
          chartsEl.style.display = 'none';
        } else {
          chartsEl.style.display = 'grid';

          // 1. Dumbbell Chart: So sánh % Nhân sự ↔ % Quỹ lương theo phòng ban
          const deptMap = new Map();
          let totalHeadcount = 0;
          let totalPayrollBudget = 0;

          payrolls.forEach(p => {
            const dept = p.department || 'Chưa phân loại';
            const net = (p.base_salary || 0) + (p.kpi_bonus || 0) + (p.allowance || 0) - (p.deduction || 0);
            if (!deptMap.has(dept)) {
              deptMap.set(dept, { count: 0, totalNet: 0 });
            }
            const entry = deptMap.get(dept);
            entry.count += 1;
            entry.totalNet += net;
            totalHeadcount += 1;
            totalPayrollBudget += net;
          });

          const dumbbellRows = Array.from(deptMap.entries()).map(([dept, data]) => {
            const empPct = totalHeadcount > 0 ? (data.count / totalHeadcount) * 100 : 0;
            const budgetPct = totalPayrollBudget > 0 ? (data.totalNet / totalPayrollBudget) * 100 : 0;
            const delta = budgetPct - empPct;
            const avgSalary = data.count > 0 ? data.totalNet / data.count : 0;
            return {
              dept,
              icon: getDeptIcon(dept),
              count: data.count,
              totalNet: data.totalNet,
              avgSalary,
              empPct,
              budgetPct,
              delta,
            };
          }).sort((a, b) => b.totalNet - a.totalNet);

          const rawMax = Math.max(...dumbbellRows.map(r => Math.max(r.empPct, r.budgetPct)), 25);
          const scaleMax = Math.min(100, Math.max(35, Math.ceil((rawMax * 1.25) / 5) * 5));

          const dumbbellRowsHTML = dumbbellRows.map(r => {
            const minVal = Math.min(r.empPct, r.budgetPct);
            const maxVal = Math.max(r.empPct, r.budgetPct);
            const leftPercent = (minVal / scaleMax) * 100;
            const widthPercent = Math.max(1.5, ((maxVal - minVal) / scaleMax) * 100);

            const empLeft = (r.empPct / scaleMax) * 100;
            const budgetLeft = (r.budgetPct / scaleMax) * 100;

            let barClass = 'bar-even';
            let deltaClass = 'delta-even';
            let deltaLabel = `${r.delta.toFixed(1)}%`;
            let tooltipNote = 'Mức chi trả tương xứng quy mô nhân sự';

            if (r.delta > 0.4) {
              barClass = 'bar-high';
              deltaClass = 'delta-high';
              deltaLabel = `+${r.delta.toFixed(1)}%`;
              tooltipNote = 'Lương bình quân cao hơn mặt bằng chung toàn công ty';
            } else if (r.delta < -0.4) {
              barClass = 'bar-low';
              deltaClass = 'delta-low';
              deltaLabel = `${r.delta.toFixed(1)}%`;
              tooltipNote = 'Lương bình quân thấp hơn mặt bằng chung toàn công ty';
            }

            return `
              <div class="payroll-dumbbell-row" data-filter-dept="${esc(r.dept)}" title="${esc(r.dept)}: ${tooltipNote}. Bấm để lọc bảng lương.">
                <div class="dumbbell-td dumbbell-td-dept">
                  <span class="dumbbell-dept-icon">${r.icon}</span>
                  <div class="dumbbell-dept-info">
                    <span class="dumbbell-dept-name">${esc(r.dept)}</span>
                    <span class="dumbbell-dept-meta">${r.count} nhân sự · TB: ${fmtMoney(r.avgSalary)}</span>
                  </div>
                </div>
                <div class="dumbbell-td dumbbell-td-visual">
                  <div class="dumbbell-track">
                    <div class="dumbbell-grid-marks">
                      <span class="dumbbell-mark" style="left: 0%"></span>
                      <span class="dumbbell-mark" style="left: 25%"></span>
                      <span class="dumbbell-mark" style="left: 50%"></span>
                      <span class="dumbbell-mark" style="left: 75%"></span>
                      <span class="dumbbell-mark" style="left: 100%"></span>
                    </div>
                    <div class="dumbbell-bar ${barClass}" style="left: ${leftPercent.toFixed(1)}%; width: ${widthPercent.toFixed(1)}%;"></div>
                    <div class="dumbbell-dot dumbbell-dot-emp" style="left: ${empLeft.toFixed(1)}%;" title="Nhân sự: ${r.empPct.toFixed(1)}% (${r.count} người)">
                      <span class="dumbbell-dot-badge">${icon('user', 'xs')} ${r.empPct.toFixed(1)}%</span>
                    </div>
                    <div class="dumbbell-dot dumbbell-dot-budget" style="left: ${budgetLeft.toFixed(1)}%;" title="Quỹ lương: ${r.budgetPct.toFixed(1)}% (${fmtMoney(r.totalNet)})">
                      <span class="dumbbell-dot-badge">${icon('banknote', 'xs')} ${r.budgetPct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
                <div class="dumbbell-td dumbbell-td-delta">
                  <span class="dumbbell-delta-tag ${deltaClass}">
                    ${deltaLabel}
                  </span>
                </div>
              </div>
            `;
          }).join('');

          // 2. Quỹ lương theo phòng ban (Donut Chart)
          const deptColors = ['#EE4D2D', '#3B82F6', '#0B1F3A', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1'];
          const deptSlices = dumbbellRows.map((r, idx) => ({
            label: r.dept,
            value: r.totalNet,
            formattedValue: fmtMoney(r.totalNet),
            color: deptColors[idx % deptColors.length],
          }));

          const deptLegendHTML = deptSlices.map(s => {
            const pct = totalPayrollBudget > 0 ? ((s.value / totalPayrollBudget) * 100).toFixed(1) : '0';
            return `
              <div class="payroll-legend-item" data-filter-dept="${esc(s.label)}" title="Lọc theo phòng ban ${esc(s.label)}">
                <div class="payroll-legend-left">
                  <span class="payroll-legend-dot" style="background:${s.color};"></span>
                  <span class="payroll-legend-name">${esc(s.label)}</span>
                </div>
                <div class="payroll-legend-right">
                  <span class="payroll-legend-percent">${pct}%</span>
                  <span class="payroll-legend-val">${s.formattedValue}</span>
                </div>
              </div>
            `;
          }).join('');

          // 3. Chuyên cần & Chấm công tháng (tính đến ngày hiện tại là 100%)
          let attRecords = [];
          try {
            const [yearStr, monthStr] = month.split('-');
            const attRes = await api.getAttendance({ month: monthStr, year: yearStr });
            attRecords = attRes.attendance || [];
          } catch (_) {}

          const now = new Date();
          const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const isCurMonth = month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          const relevantAtt = attRecords.filter(a => {
            if (isCurMonth && a.date > todayStr) return false;
            return true;
          });

          let onTimeCount = 0;
          let lateCount = 0;
          let earlyCount = 0;
          let leaveCount = 0;

          relevantAtt.forEach(a => {
            if (a.status === 'leave' || a.status === 'absent') {
              leaveCount++;
            } else if (Number(a.late_minutes || 0) > 0) {
              lateCount++;
            } else if (Number(a.early_minutes || 0) > 0) {
              earlyCount++;
            } else if (a.checkin_time && a.checkout_time) {
              onTimeCount++;
            } else if (a.checkin_time) {
              onTimeCount++;
            }
          });

          const totalAttEvents = onTimeCount + lateCount + earlyCount + leaveCount;
          const onTimeRate = totalAttEvents > 0 ? Math.round((onTimeCount / totalAttEvents) * 100) : (relevantAtt.length ? 100 : 0);

          const attSlices = [
            { label: 'Đúng giờ', value: onTimeCount, formattedValue: `${onTimeCount} ca`, color: '#10B981' },
            { label: 'Đi trễ', value: lateCount, formattedValue: `${lateCount} ca`, color: '#F59E0B' },
            { label: 'Về sớm', value: earlyCount, formattedValue: `${earlyCount} ca`, color: '#EE4D2D' },
            { label: 'Nghỉ / Phép', value: leaveCount, formattedValue: `${leaveCount} ca`, color: '#64748B' },
          ];

          const attLegendHTML = attSlices.map(s => {
            const pct = totalAttEvents > 0 ? ((s.value / totalAttEvents) * 100).toFixed(1) : '0';
            return `
              <div class="payroll-legend-item">
                <div class="payroll-legend-left">
                  <span class="payroll-legend-dot" style="background:${s.color};"></span>
                  <span class="payroll-legend-name">${esc(s.label)}</span>
                </div>
                <div class="payroll-legend-right">
                  <span class="payroll-legend-percent">${pct}%</span>
                  <span class="payroll-legend-val">${s.formattedValue}</span>
                </div>
              </div>
            `;
          }).join('');

          chartsEl.innerHTML = `
            <!-- Chart 1: Dumbbell Chart: % Nhân sự ↔ % Quỹ lương theo phòng ban -->
            <div class="payroll-chart-card payroll-dumbbell-card">
              <div class="payroll-chart-header">
                <div class="payroll-chart-title-wrap">
                  <div class="payroll-chart-icon" style="background:#EFF6FF;color:#2563EB;">${icon('chartLine', 'sm')}</div>
                  <div>
                    <h3 class="payroll-chart-title">So sánh % Nhân sự ↔ % Quỹ lương</h3>
                    <p class="payroll-chart-sub">Dumbbell Chart tương quan quy mô nhân sự & chi phí tháng ${formatMonth(month)}</p>
                  </div>
                </div>
                <div class="payroll-dumbbell-legend">
                  <span class="payroll-dumbbell-legend-item"><span class="dumbbell-legend-dot dumbbell-legend-dot--emp"></span> ${icon('user', 'xs')} % Nhân sự</span>
                  <span class="payroll-dumbbell-legend-item"><span class="dumbbell-legend-dot dumbbell-legend-dot--budget"></span> ${icon('banknote', 'xs')} % Quỹ lương</span>
                </div>
              </div>

              <div class="payroll-dumbbell-table">
                <div class="payroll-dumbbell-thead">
                  <div class="dumbbell-th dumbbell-th-dept">Phòng ban</div>
                  <div class="dumbbell-th dumbbell-th-visual">
                    <span>% Nhân sự ↔ % Quỹ lương</span>
                    <span class="dumbbell-scale-label">0% → ${scaleMax}%</span>
                  </div>
                  <div class="dumbbell-th dumbbell-th-delta">Chênh lệch</div>
                </div>
                <div class="payroll-dumbbell-tbody">
                  ${dumbbellRowsHTML}
                </div>
              </div>

              <div class="payroll-chart-footer-note">
                * <strong>Chênh lệch</strong> = % Quỹ lương − % Nhân sự. Giá trị <strong>(+)</strong> biểu thị lương bình quân phòng ban cao hơn mức trung bình chung toàn công ty.
              </div>
            </div>

            <!-- Chart 2: Quỹ lương theo phòng ban (Donut Chart) -->
            <div class="payroll-chart-card">
              <div class="payroll-chart-header">
                <div class="payroll-chart-title-wrap">
                  <div class="payroll-chart-icon">${icon('banknote', 'sm')}</div>
                  <div>
                    <h3 class="payroll-chart-title">Quỹ lương theo phòng ban</h3>
                    <p class="payroll-chart-sub">Tỷ lệ phân bổ chi phí tháng ${formatMonth(month)}</p>
                  </div>
                </div>
                <span class="payroll-chart-badge">${fmtMoney(totalNet)}</span>
              </div>
              <div class="payroll-chart-body">
                <div class="payroll-donut-wrap">
                  ${renderDonutChartSVG(deptSlices, 'Tổng quỹ', fmtMoney(totalNet))}
                </div>
                <div class="payroll-legend-list">
                  ${deptLegendHTML}
                </div>
              </div>
            </div>

            <!-- Chart 3: Chuyên cần & Chấm công (Donut Chart) -->
            <div class="payroll-chart-card">
              <div class="payroll-chart-header">
                <div class="payroll-chart-title-wrap">
                  <div class="payroll-chart-icon payroll-chart-icon--emerald">${icon('clock3', 'sm')}</div>
                  <div>
                    <h3 class="payroll-chart-title">Chuyên cần & Chấm công</h3>
                    <p class="payroll-chart-sub">Tỷ lệ đúng giờ tính đến hiện tại</p>
                  </div>
                </div>
                <span class="payroll-chart-badge payroll-chart-badge--emerald">${onTimeRate}% đúng giờ</span>
              </div>
              <div class="payroll-chart-body">
                <div class="payroll-donut-wrap">
                  ${renderDonutChartSVG(attSlices, 'Đúng giờ', `${onTimeRate}%`)}
                </div>
                <div class="payroll-legend-list">
                  ${attLegendHTML}
                </div>
              </div>
              <div class="payroll-chart-footer-note">
                * So sánh tính đến ${isCurMonth ? `hôm nay (${todayStr.split('-').reverse().slice(0,2).join('/')}) là 100% kỳ vọng` : `cuối tháng ${formatMonth(month)}`}.
              </div>
            </div>
          `;
        }
      }

      if (!payrolls.length) {
        if (statusEl && !options.keepStatus) statusEl.textContent = `Chưa có dữ liệu bảng lương tháng ${month}.`;
        tableEl.innerHTML = `
          <div style="padding:32px 16px;text-align:center;">
            ${emptyHTML('creditCard', `Chưa có bảng lương tháng ${formatMonth(month)}`, 'Bấm nút "Đồng bộ bảng lương" để tự động tính lương từ chấm công & hợp đồng.')}
            ${isAdmin ? `<button class="btn-primary" id="btn-empty-sync-payroll" style="margin-top:14px;">${icon('refreshCw', 'xs')} <span>Đồng bộ bảng lương tháng ${formatMonth(month)}</span></button>` : ''}
          </div>
        `;
        document.getElementById('btn-empty-sync-payroll')?.addEventListener('click', openCreatePayrollBatchConfirm);
        return;
      }
      if (!filtered.length) {
        if (statusEl && !options.keepStatus) statusEl.textContent = `Không tìm thấy dòng lương phù hợp với bộ lọc.`;
        tableEl.innerHTML = `<div style="padding:24px 16px;">${emptyHTML('search', `Không có dòng lương phù hợp`, 'Thử đổi từ khóa tìm kiếm hoặc chọn phòng ban khác')}</div>`;
        return;
      }
      if (statusEl && !options.keepStatus) {
        const hasExcel = payrolls.some(p => p.import_source === 'excel' || Number(p.transfer_amount || 0) > 0);
        statusEl.innerHTML = `
          <span>Đã tải ${payrolls.length} dòng bảng lương tháng ${month}. Đang hiển thị ${filtered.length} dòng phù hợp.</span>
          ${hasExcel ? `<span style="margin-left:8px;padding:2px 8px;background:#ECFDF5;color:#047857;border:1px solid #A7F3D0;border-radius:4px;font-size:11px;font-weight:700;">✓ Dữ liệu chốt từ Excel (Bảo vệ không ghi đè)</span>` : ''}
        `;
      }

      if (viewMode === 'full') {
        tableEl.innerHTML = renderFullPayrollTableHTML(pageData, filtered);
        initPayrollTableScrollSync();
      } else {
        tableEl.innerHTML = `
          <div class="table-wrap payroll-table-wrap">
            <table class="payroll-table">
              <colgroup>
                <col class="payroll-width-employee" />
                <col class="payroll-width-dept" />
                <col class="payroll-width-money" />
                <col class="payroll-width-net" />
              </colgroup>
              <thead>
                <tr>
                  <th class="payroll-col-employee">Nhân viên</th>
                  <th class="payroll-col-dept">Phòng ban</th>
                  <th class="payroll-col-money">Lương CB</th>
                  <th class="payroll-col-money payroll-col-net">Thực lĩnh</th>
                </tr>
              </thead>
              <tbody>
                ${pageData.rows.map(p => payrollRowHTML(p)).join('')}
              </tbody>
            </table>
          </div>
          ${paginationHTML(pageData)}
        `;
      }

      tableEl.querySelectorAll('.payroll-row').forEach(row => {
        const open = () => {
          const payroll = payrolls.find(item => item.id === Number(row.dataset.pid));
          if (!payroll) return;
          const showDetails = (editing = false) => {
            openModal('Chi tiết phiếu lương', payslipDetailHTML(payroll, { source: 'payroll', edit: editing }), editing
              ? '<button class="btn-secondary" id="payslip-cancel-edit">Hủy</button><button class="btn-primary" id="payslip-save-edit" disabled>Lưu thay đổi</button>'
              : '<button class="btn-secondary w-full" id="payslip-close">Đóng</button>');
            preparePayslipModal();
            if (editing) {
              bindPayslipInlineEditor(payroll, loadPayroll, () => showDetails(false));
              hydratePayslipAttendance();
              return;
            }
            if (canEditPayroll) {
              const footer = document.getElementById('modal-footer');
              if (footer) footer.insertAdjacentHTML('afterbegin', '<button class="btn-danger" id="payslip-delete">Xóa dòng lương</button><button class="btn-secondary" id="payslip-edit">Sửa trên phiếu</button>');
              document.getElementById('payslip-edit')?.addEventListener('click', () => showDetails(true));
              document.getElementById('payslip-delete')?.addEventListener('click', () => openPayrollDeleteConfirm(payroll, loadPayroll, showDetails));
            }
            document.getElementById('payslip-close')?.addEventListener('click', closeModal);
            hydratePayslipAttendance();
          };
          showDetails();
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
      tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('triangleAlert', e.message)}</div>`;
    } finally {
    }
  }

  el._cleanup = () => {
    payrollRowCache.clear();
  };

  EventBus.bindView(el, 'payroll', () => loadPayroll({ keepStatus: true }));
  EventBus.bindView(el, 'payroll:*', () => loadPayroll({ keepStatus: true }));
  EventBus.bindView(el, 'invoices', () => loadPayroll({ keepStatus: true }));
  EventBus.bindView(el, 'invoices:*', () => loadPayroll({ keepStatus: true }));

  loadPayroll();
}

function formatMoneyInput(value) {
  const n = Number(value || 0);
  return n === 0 ? '' : n.toLocaleString('vi-VN');
}

function unformatMoneyInput(str) {
  return parseInt(String(str || '').replace(/[^0-9]/g, ''), 10) || 0;
}

function bindPayslipInlineEditor(payroll, onRefresh = noop, onCancel = closeModal) {
  onRefresh = safeCb(onRefresh);
  const labels = {
    base_salary: 'Mức lương thỏa thuận', allowance: 'Phụ cấp khác', kpi_bonus: 'Thưởng KPI',
    insurance: 'BHXH, BHYT, BHTN người lao động', tax: 'Thuế TNCN', deduction: 'Khấu trừ khác',
  };
  const inputs = [...document.querySelectorAll('[data-payroll-field]')];
  const values = Object.fromEntries(inputs.map(input => [input.dataset.payrollField, Number(input.value || 0)]));
  const initial = Object.fromEntries(inputs.map(input => [input.dataset.payrollField, Number(input.dataset.originalValue || 0)]));
  const overtime = Number(payroll.overtime_pay || 0);
  const saveButton = document.getElementById('payslip-save-edit');

  const changedFields = () => inputs.filter(input => Number(input.value || 0) !== initial[input.dataset.payrollField]);
  const refreshTotals = () => {
    const income = values.base_salary + values.allowance + values.kpi_bonus + overtime;
    const net = income - values.insurance - values.tax - values.deduction;
    const incomeFromWork = document.getElementById('payslip-income-from-work');
    if (incomeFromWork) incomeFromWork.textContent = fmtMoney(values.base_salary);
    document.getElementById('payslip-total-income').textContent = fmtMoney(income);
    document.getElementById('payslip-net').textContent = fmtMoney(net);
    document.getElementById('payslip-net').classList.toggle('payslip-money--negative', net < 0);
  };
  const validate = () => {
    const changed = changedFields();
    let valid = changed.length > 0;
    for (const input of inputs) {
      const field = input.dataset.payrollField;
      const isChanged = Number(input.value || 0) !== initial[field];
      const noteRow = document.querySelector(`[data-payroll-note-row="${field}"]`);
      const note = document.querySelector(`[data-payroll-note="${field}"]`);
      noteRow.hidden = !isChanged;
      if (isChanged && !String(note?.value || '').trim()) valid = false;
      note?.classList.toggle('input-error', isChanged && !String(note?.value || '').trim());
    }
    saveButton.disabled = !valid;
  };
  for (const input of inputs) {
    input.addEventListener('input', () => {
      const field = input.dataset.payrollField;
      values[field] = Math.max(0, Number(input.value || 0));
      refreshTotals();
      validate();
    });
  }
  document.querySelectorAll('[data-payroll-note]').forEach(note => note.addEventListener('input', validate));
  document.getElementById('payslip-cancel-edit')?.addEventListener('click', onCancel);
  saveButton?.addEventListener('click', async () => {
    const changed = changedFields().map(input => {
      const field = input.dataset.payrollField;
      return { field, label: labels[field], old_value: initial[field], new_value: values[field], note: document.querySelector(`[data-payroll-note="${field}"]`)?.value.trim() || '' };
    });
    if (!changed.length || changed.some(item => !item.note)) { validate(); toast('Mỗi dòng đã sửa cần có ghi chú điều chỉnh', 'error'); return; }
    saveButton.disabled = true;
    saveButton.textContent = 'Đang lưu...';
    try {
      const payload = {
        employee_name: payroll.employee_name || '', employee_code: payroll.employee_code || '', department: payroll.department || '',
        month: payroll.month, base_salary: values.base_salary, kpi_bonus: values.kpi_bonus, allowance: values.allowance,
        deduction: values.deduction, overtime_pay: overtime, tax: values.tax, insurance: values.insurance,
        work_days: Number(payroll.work_days || 0), standard_days: Number(payroll.standard_days || 0), note: payroll.note || '',
        line_changes: changed,
      };
      await api.updatePayroll(payroll.id, payload);
      Object.assign(payroll, payload, { net_salary: values.base_salary + values.kpi_bonus + values.allowance + overtime - values.deduction - values.tax - values.insurance });
      await onRefresh();
      toast('Đã lưu điều chỉnh từng dòng lương', 'success');
      onCancel();
    } catch (error) {
      toast(error.message || 'Không thể lưu điều chỉnh', 'error');
      validate();
      saveButton.textContent = 'Lưu thay đổi';
    }
  });
  refreshTotals();
  validate();
}

function openPayrollDeleteConfirm(payroll, onRefresh = noop, onCancel = closeModal) {
  onRefresh = safeCb(onRefresh);
  openModal('Xác nhận xóa dòng lương', `
    <div class="payedit-warn payedit-warn--error" style="display:block;">
      Dòng lương của <b>${esc(payroll.employee_name || 'nhân viên')}</b> trong kỳ <b>${esc(formatMonth(payroll.month))}</b> sẽ bị xóa.
      Thao tác này không thể hoàn tác.
    </div>
    <div class="field" style="margin-top:16px;">
      <label>Nhập <b>XÓA</b> để xác nhận</label>
      <input id="payroll-delete-confirm" autocomplete="off" placeholder="XÓA" />
    </div>
  `, `
    <button class="btn-secondary" id="payroll-delete-cancel">Quay lại</button>
    <button class="btn-danger" id="payroll-delete-submit" disabled>Xóa dòng lương</button>
  `);
  const input = document.getElementById('payroll-delete-confirm');
  const submit = document.getElementById('payroll-delete-submit');
  const confirmed = () => String(input?.value || '').trim().toLocaleUpperCase('vi-VN') === 'XÓA';
  input?.addEventListener('input', () => { submit.disabled = !confirmed(); });
  document.getElementById('payroll-delete-cancel')?.addEventListener('click', onCancel);
  submit?.addEventListener('click', async () => {
    if (!confirmed()) return;
    submit.disabled = true;
    submit.textContent = 'Đang xóa...';
    try {
      await api.deletePayroll(payroll.id);
      await onRefresh();
      closeModal();
      toast('Đã xóa dòng lương', 'success');
    } catch (error) {
      toast(error.message || 'Không thể xóa dòng lương', 'error');
      submit.disabled = false;
      submit.textContent = 'Xóa dòng lương';
    }
  });
}

function openPayrollLineForm(pay, onRefresh = noop, currentMonth = '', options = {}) {
  onRefresh = safeCb(onRefresh);
  const { inline = false, onCancel = closeModal, onSaved = null } = options;
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

  const bodyHtml = `
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

    ${isEdit ? `
      <div class="payedit-section">
        <div class="payedit-section-title">Ghi chú điều chỉnh <span style="color:var(--danger)">*</span></div>
        <div class="field">
          <label>Nêu rõ lý do sửa dòng lương này</label>
          <textarea id="pf-change-note" rows="3" maxlength="1000" placeholder="Ví dụ: Điều chỉnh phụ cấp tháng do bổ sung chứng từ đã duyệt."></textarea>
          <div style="font-size:12px;color:var(--text-2);margin-top:5px;">Ghi chú, người sửa và giá trị trước/sau sẽ được lưu vào lịch sử điều chỉnh.</div>
        </div>
      </div>
    ` : ''}

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
  `;
  const footerHtml = `
    <button class="btn-secondary" id="pf-cancel">Hủy</button>
    <button class="btn-primary" id="pf-save">Lưu thay đổi</button>
  `;
  if (inline) {
    document.getElementById('modal-title').textContent = 'Chỉnh sửa phiếu lương';
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
  } else {
    openModal(isEdit ? 'Sửa dòng lương' : 'Thêm dòng lương thủ công', bodyHtml, footerHtml);
  }

  // Apply payroll-edit modal class
  const modalEl = document.getElementById('modal');
  modalEl?.classList.add('modal--payroll-edit');

  document.getElementById('pf-cancel').addEventListener('click', onCancel);

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
      warningHtml += `<div class="payedit-warn"><span style="display:inline-flex;align-items:center;">${icon('triangleAlert', 'xs')}</span> Nhân viên chưa có lương cơ bản. Cần <a href="#/users${pay ? '/' + pay.employee_id : ''}" target="_blank">cấu hình lương</a> trước khi chốt bảng lương.</div>`;
    }
    if (net < 0) {
      warningHtml += `<div class="payedit-warn payedit-warn--error"><span style="display:inline-flex;align-items:center;">${icon('circleAlert', 'xs')}</span> Thực nhận đang âm. Vui lòng kiểm tra lại lương cơ bản hoặc khoản khấu trừ.</div>`;
    }
    if (v.deduct > totalIncome && totalIncome > 0) {
      warningHtml += `<div class="payedit-warn"><span style="display:inline-flex;align-items:center;">${icon('triangleAlert', 'xs')}</span> Khấu trừ lớn hơn tổng thu nhập.</div>`;
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
    const changeNote = document.getElementById('pf-change-note')?.value.trim() || '';
    if (isEdit && !changeNote) { toast('Vui lòng nhập ghi chú điều chỉnh', 'error'); return; }
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
        change_note: changeNote,
      };
      if (isEdit) await api.updatePayroll(pay.id, data);
      else await api.createPayroll(data);
      if (inline && isEdit) Object.assign(pay, data, { net_salary: net });
      toast(isEdit ? 'Đã cập nhật dòng lương' : 'Đã thêm dòng lương thủ công', 'success');
      await onRefresh();
      if (inline && typeof onSaved === 'function') onSaved();
      else closeModal();
    } catch (e) {
      toast(e.message || 'Không thể cập nhật dòng lương. Vui lòng thử lại.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Lưu thay đổi';
      saving = false;
    }
  });
}
