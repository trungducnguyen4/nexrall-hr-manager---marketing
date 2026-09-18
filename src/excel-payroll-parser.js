// ═════════════════════════════════════════════════════════════════════
//  Excel Payroll Parser – Chuẩn bảng tính lương NetViet (51 cột)
// ═════════════════════════════════════════════════════════════════════

export function parseMoney(val) {
  if (val === undefined || val === null) return 0;
  let s = String(val).trim();
  if (!s || s === '-' || s === '—') return 0;
  // Xử lý số âm kế toán dạng ngoặc đơn: (3,730,000) -> -3730000
  let isNegative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  }
  // Bỏ dấu phẩy ngăn cách hàng nghìn và khoảng trắng
  s = s.replace(/,/g, '').replace(/\s+/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return isNegative ? -Math.abs(n) : n;
}

export function parseNumber(val) {
  if (val === undefined || val === null) return 0;
  const s = String(val).trim().replace(/,/g, '');
  if (!s || s === '-' || s === '—') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeHeader(str) {
  return String(str || '')
    .replace(/\\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectColumnIndices(lines, firstDataIndex, maxCols) {
  // Lọc các dòng tiêu đề đứng trước dòng dữ liệu nhân viên đầu tiên
  const headerLines = lines.slice(0, firstDataIndex).filter(l => {
    const t = l.trim();
    return t && !t.includes('Ngày công định mức') && !t.includes('Ngày trong tháng') && !t.toUpperCase().includes('BAN GIÁM ĐỐC');
  });

  const topGroups = new Array(maxCols).fill('');
  if (headerLines.length > 0) {
    let curGroup = '';
    const topCells = headerLines[0].split('\t');
    for (let c = 0; c < maxCols; c++) {
      const val = (topCells[c] || '').trim().replace(/^"|"$/g, '').replace(/\s+/g, ' ');
      if (val && !val.match(/^\d+$/) && val.length > 2) {
        curGroup = val;
      }
      topGroups[c] = curGroup;
    }
  }

  const colHeaders = [];
  for (let c = 0; c < maxCols; c++) {
    const parts = [];
    for (const hl of headerLines) {
      const cells = hl.split('\t');
      const val = (cells[c] || '').trim().replace(/^"|"$/g, '').replace(/\s+/g, ' ');
      if (val && !parts.includes(val)) parts.push(val);
    }
    if (topGroups[c] && !parts.some(p => p.toLowerCase().includes(topGroups[c].toLowerCase()))) {
      parts.unshift(topGroups[c]);
    }
    colHeaders.push(parts.join(' > '));
  }

  const normHeaders = colHeaders.map(h => normalizeHeader(h));

  function findCol(predicate) {
    for (let i = 0; i < normHeaders.length; i++) {
      if (predicate(normHeaders[i], colHeaders[i], i)) return i;
    }
    return -1;
  }

  const colMap = {};

  // Nhận diện cột thông tin cá nhân
  colMap.tt = findCol(n => n === 'tt' || n === 'stt');
  colMap.fullName = findCol(n => n.includes('ho va ten') || n.includes('ho ten'));
  colMap.employeeCode = findCol(n => n.includes('ma nhan vien') || n.includes('ma nv'));

  // Nhận diện mức lương & thưởng HTCV
  colMap.positionSalary = findCol(n => n.includes('luong vi tri') || n.includes('chuc danh'));
  colMap.completionBonus = findCol(n => n.includes('thuong hoan thanh') || n.includes('htcv'));
  colMap.totalIncomeAgreed = findCol(n => n.includes('tong thu nhap bao gom luong va thuong') || n.includes('tong thu nhap bao gom') || (n.includes('tong thu nhap') && !n.includes('phu cap') && !n.includes('truoc thue') && !n.includes('ngay cong') && !n.includes('ngoai gio')));
  colMap.insuranceBase = findCol(n => n.includes('luong dong bh') || (n.includes('muc luong') && !n.includes('vi tri')));
  if (colMap.insuranceBase === -1 && colMap.positionSalary === -1) {
    colMap.insuranceBase = findCol(n => n.includes('muc luong'));
  }

  // Ngày công làm việc
  colMap.probationDays = findCol(n => n.includes('cong thu viec') || n.includes('thu viec'));
  colMap.officialDays = findCol(n => n.includes('cong chinh thuc') || n.includes('chinh thuc'));
  colMap.paidLeaveDays = findCol(n => n.includes('nghi phep') || n.includes('huong nguyen luong'));
  colMap.unpaidLeaveDays = findCol(n => n.includes('nghi kl') || n.includes('khong luong'));
  colMap.workIncome = findCol(n => n.includes('thu nhap theo ngay cong') || n.includes('ngay cong lam viec thuc te'));

  // Làm thêm giờ (OT)
  colMap.otNormalHours = findCol(n => (n.includes('ngoai gio') || n.includes('lam them')) && (n.includes('ngay thuong') || n === 'ngay thuong'));
  if (colMap.otNormalHours === -1) colMap.otNormalHours = findCol(n => n.includes('ngay thuong'));
  colMap.otWeekendHours = findCol(n => n.includes('ngay nghi') || n.includes('hang tuan'));
  colMap.otHolidayHours = findCol(n => n.includes('ngay le') || n.includes('le tet'));
  colMap.baseHourlyRate = findCol(n => n.includes('theo gio co so') || n.includes('1h lam viec'));
  colMap.otTotalIncome = findCol(n => n.includes('tong thu nhap ngoai gio') || n.includes('thu nhap tu lam them gio'));

  // Phụ cấp
  colMap.phoneAllowance = findCol(n => n.includes('dien thoai'));
  colMap.attireAllowance = findCol(n => n.includes('trang phuc'));
  colMap.parkingAllowance = findCol(n => n.includes('gui xe'));
  colMap.fuelAllowance = findCol(n => n.includes('xang xe') || n.includes('di lai'));
  colMap.businessTripAllowance = findCol(n => n.includes('cong tac'));
  colMap.totalAllowance = findCol(n => (n.includes('thu nhap khac') || n.includes('phu cap')) && n.includes('tong cong'));
  colMap.totalIncomeWithAllowance = findCol(n => n.includes('tong thu nhap & phu cap') || n.includes('tong thu nhap bao gom phu cap'));
  colMap.kpiBonus = findCol(n => n.includes('thuong kpi') || n.includes('kpi'));
  colMap.totalPreTaxIncome = findCol(n => n.includes('tong thu nhap truoc thue') || n.includes('thu nhap truoc thue'));

  // Các khoản NLĐ đóng
  colMap.insuranceSocial = findCol(n => (n.includes('dong gop cua nld') || n.includes('nld')) && n.includes('xa hoi'));
  if (colMap.insuranceSocial === -1) colMap.insuranceSocial = findCol(n => n.includes('xa hoi 8') || n.includes('bhxh 8'));
  colMap.insuranceHealth = findCol(n => (n.includes('dong gop cua nld') || n.includes('nld')) && (n.includes('y te') || n.includes('bhyt')));
  if (colMap.insuranceHealth === -1) colMap.insuranceHealth = findCol(n => n.includes('y te 1 5') || n.includes('bhyt 1 5') || n.includes('y te 15'));
  colMap.insuranceUnemployment = findCol(n => (n.includes('dong gop cua nld') || n.includes('nld')) && (n.includes('that nghiep') || n.includes('bhtn')));
  if (colMap.insuranceUnemployment === -1) colMap.insuranceUnemployment = findCol(n => (n.includes('that nghiep 1') || n.includes('bhtn 1')) && !n.includes('cong ty'));
  colMap.insuranceTotal = findCol(n => (n.includes('dong gop cua nld') || n.includes('nld')) && n.includes('tong cong'));
  if (colMap.insuranceTotal === -1) colMap.insuranceTotal = findCol(n => n.includes('dong gop cua nld'));

  // Thuế TNCN
  colMap.personalDeduction = findCol(n => n.includes('cho ban than') || (n.includes('thue tncn') && n.includes('ban than')));
  colMap.dependentDeduction = findCol(n => n.includes('cho nguoi phu thuoc') || n.includes('nguoi phu thuoc'));
  colMap.dependentCount = findCol(n => n.includes('so luong') && (n.includes('thue') || n.includes('phu thuoc')));
  colMap.totalFamilyDeduction = findCol(n => n.includes('giam tru gia canh'));
  colMap.taxableIncome = findCol(n => n.includes('thu nhap tinh thue'));
  colMap.personalTax = findCol(n => (n === 'thue tncn' || n.endsWith('thue tncn')) && !n.includes('tinh thue') && !n.includes('da khau tru'));
  colMap.netIncomeAfterTax = findCol(n => n.includes('thuc linh sau thue') || n.includes('thu nhap thuc linh'));
  colMap.taxWithheld = findCol(n => n.includes('da khau tru'));

  // Các khoản chi trả / khấu trừ khác
  colMap.mealAllowance = findCol(n => n.includes('tien an ca') || n.includes('an ca'));
  colMap.arrearsRecovery = findCol(n => n.includes('truy thu'));
  colMap.arrearsAddition = findCol(n => n.includes('truy linh'));
  colMap.transferAmount = findCol(n => n.includes('chuyen vao tai khoan') || n.includes('chuyen vao tk') || n.includes('so tien chuyen'));

  // Các khoản Công ty đóng
  colMap.compInsuranceSocial = findCol(n => (n.includes('cong ty') || n.includes('cty')) && (n.includes('xa hoi') || n.includes('bhxh')));
  if (colMap.compInsuranceSocial === -1) colMap.compInsuranceSocial = findCol(n => n.includes('xa hoi 17') || n.includes('bhxh 17'));
  colMap.compInsuranceHealth = findCol(n => (n.includes('cong ty') || n.includes('cty')) && (n.includes('y te 3') || n.includes('bhyt 3') || (n.includes('y te') && n.includes('3'))));
  colMap.compInsuranceUnemp = findCol(n => (n.includes('cong ty') || n.includes('cty')) && (n.includes('that nghiep') || n.includes('bhtn')));
  colMap.compInsuranceAccident = findCol(n => n.includes('tnld') || n.includes('bnn') || n.includes('tai nan'));
  colMap.compInsuranceTotal = findCol(n => (n.includes('dong gop cua cong ty') || n.includes('cong ty')) && n.includes('tong cong'));
  colMap.totalCompanyCost = findCol(n => n.includes('tong quy luong') || n.includes('quy luong thuong cong ty'));

  colMap.isSigned = findCol(n => n.includes('ky nhan'));
  colMap.notes = findCol(n => n.includes('ghi chu'));

  // Kiểm tra độ tin cậy của việc nhận diện: nếu không tìm thấy các cột cốt lõi thì kích hoạt fallback
  const matchedCoreCols = [colMap.fullName, colMap.employeeCode, colMap.transferAmount, colMap.insuranceBase, colMap.totalCompanyCost].filter(c => c >= 0).length;
  if (matchedCoreCols < 2) {
    if (maxCols >= 45) {
      // Fallback cho bảng 51 cột cố định
      colMap.tt = 0; colMap.fullName = 1; colMap.employeeCode = 2;
      colMap.insuranceBase = 3; colMap.positionSalary = 4; colMap.completionBonus = 5; colMap.totalIncomeAgreed = 6;
      colMap.probationDays = 7; colMap.officialDays = 8; colMap.paidLeaveDays = 9; colMap.unpaidLeaveDays = 10; colMap.workIncome = 11;
      colMap.otNormalHours = 12; colMap.otWeekendHours = 13; colMap.otHolidayHours = 14; colMap.baseHourlyRate = 15; colMap.otTotalIncome = 16;
      colMap.phoneAllowance = 17; colMap.attireAllowance = 18; colMap.parkingAllowance = 19; colMap.fuelAllowance = 20; colMap.businessTripAllowance = 21;
      colMap.totalAllowance = 22; colMap.totalIncomeWithAllowance = 23; colMap.kpiBonus = 24; colMap.totalPreTaxIncome = 25;
      colMap.insuranceSocial = 26; colMap.insuranceHealth = 27; colMap.insuranceUnemployment = 28; colMap.insuranceTotal = 29;
      colMap.personalDeduction = 30; colMap.dependentDeduction = 31; colMap.dependentCount = 32; colMap.totalFamilyDeduction = 33;
      colMap.taxableIncome = 34; colMap.personalTax = 35; colMap.netIncomeAfterTax = 36; colMap.taxWithheld = 37;
      colMap.mealAllowance = 38; colMap.arrearsRecovery = 39; colMap.arrearsAddition = 40; colMap.transferAmount = 41;
      colMap.compInsuranceSocial = 42; colMap.compInsuranceHealth = 43; colMap.compInsuranceUnemp = 44; colMap.compInsuranceAccident = 45;
      colMap.compInsuranceTotal = 46; colMap.totalCompanyCost = 47; colMap.isSigned = 48; colMap.notes = 49;
    } else if (maxCols <= 25) {
      // Fallback cho bảng rút gọn 18 cột
      colMap.tt = 0; colMap.fullName = 1; colMap.employeeCode = 2; colMap.insuranceBase = 3;
      colMap.insuranceTotal = 4; colMap.personalDeduction = 5; colMap.dependentDeduction = 6; colMap.dependentCount = 7;
      colMap.totalFamilyDeduction = 8; colMap.taxableIncome = 9; colMap.personalTax = 10; colMap.netIncomeAfterTax = 11;
      colMap.mealAllowance = 12; colMap.arrearsRecovery = 13; colMap.transferAmount = 14; colMap.compInsuranceTotal = 15;
      colMap.totalCompanyCost = 16; colMap.isSigned = 17;
    }
  }

  return { colMap, colHeaders };
}

export function parsePayrollExcelText(text) {
  // Chuẩn hóa: xóa BOM và loại bỏ xuống dòng bên trong dấu ngoặc kép của cell Excel
  let normalizedText = String(text || '').replace(/^\uFEFF/, '');
  normalizedText = normalizedText.replace(/"([^"]*)"/g, (_, content) => {
    return '"' + content.replace(/\r?\n/g, ' ') + '"';
  });

  const lines = normalizedText.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);
  if (!lines.length) throw new Error('Không có dữ liệu bảng lương.');

  let standardDays = 23;
  let standardDaysSecurity = 27;
  let daysInMonth = 30;

  // Quét các dòng header đầu để tìm định mức ngày công
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i];
    if (l.includes('Ngày công định mức bảo vệ')) {
      const match = l.match(/(\d+)/);
      if (match) standardDaysSecurity = Number(match[1]);
    } else if (l.includes('Ngày công định mức')) {
      const parts = l.split('\t').map(p => p.trim()).filter(Boolean);
      const num = parts.find(p => /^\d+$/.test(p));
      if (num) standardDays = Number(num);
    }
    if (l.includes('Ngày trong tháng')) {
      const match = l.match(/(\d+)/);
      if (match) daysInMonth = Number(match[1]);
    }
  }

  // Danh sách phòng ban nhận diện theo dòng tiêu đề nhóm
  const knownDepartments = [
    'BAN GIÁM ĐỐC',
    'PHÒNG HÀNH CHÍNH NHÂN SỰ',
    'PHÒNG KINH DOANH',
    'PHÒNG MARKETING',
    'PHÒNG BIÊN TẬP',
    'PHÒNG SẢN XUẤT PHIM',
    'PHÒNG GAME SHOW',
    'TẠP VỤ + BẢO VỆ',
    'PHÒNG KẾ TOÁN',
    'THỰC TẬP SINH HỒ CHÍ MINH',
    'THỰC TẬP SINH HÀ NỘI',
    'THỰC TẬP SINH',
  ];

  // Tìm dòng dữ liệu nhân viên đầu tiên
  let firstDataIndex = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 3) continue;
    const tt = cells[0];
    const fullName = cells[1];
    const empCode = cells[2];
    if (/^\d+$/.test(tt) && fullName && fullName.length > 2 && !fullName.includes('Họ và tên') && !fullName.includes('Cộng')) {
      if (empCode && /^[A-Za-z0-9_-]{2,25}$/.test(empCode)) {
        firstDataIndex = i;
        break;
      }
    }
  }

  const maxCols = Math.max(...lines.map(l => l.split('\t').length));
  const { colMap } = detectColumnIndices(lines, firstDataIndex, maxCols);

  let currentDept = 'Ban Giám Đốc';
  const rows = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const cells = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 3) continue;

    // Kiểm tra dòng tiêu đề phòng ban
    const lineTextUpper = line.toUpperCase();
    const matchedDept = knownDepartments.find(d => lineTextUpper.includes(d));
    const isRowNumber = colMap.tt >= 0 && cells[colMap.tt] && cells[colMap.tt].match(/^\d+$/);
    const hasEmpCode = colMap.employeeCode >= 0 && cells[colMap.employeeCode] && cells[colMap.employeeCode].match(/^[A-Z0-9_-]+$/i);
    if (matchedDept && !isRowNumber && !hasEmpCode) {
      currentDept = matchedDept;
      continue;
    }

    const tt = colMap.tt >= 0 ? cells[colMap.tt] : cells[0];
    const fullName = colMap.fullName >= 0 ? cells[colMap.fullName] : cells[1];
    const empCode = colMap.employeeCode >= 0 ? cells[colMap.employeeCode] : cells[2];

    // Bỏ qua các dòng tiêu đề cột hoặc dòng tổng cộng
    if (tt === 'TT' || fullName === 'Họ và tên' || empCode === 'Mã nhân viên') continue;
    if (line.includes('Cộng') && (cells[0] === 'Cộng' || cells[1] === 'Cộng' || (colMap.fullName >= 0 && cells[colMap.fullName] === 'Cộng'))) continue;
    if (line.includes('Lương vị trí, chức danh') || line.includes('Tổng thu nhập (bao gồm')) continue;

    if (!fullName || fullName.includes('Họ và tên') || fullName.includes('Cộng')) continue;
    if (!empCode || !/^[A-Za-z0-9_-]{2,25}$/.test(empCode)) continue;

    const getMoney = (idx) => (idx !== undefined && idx >= 0 && idx < cells.length ? parseMoney(cells[idx]) : 0);
    const getNum = (idx) => (idx !== undefined && idx >= 0 && idx < cells.length ? parseNumber(cells[idx]) : 0);
    const getStr = (idx) => (idx !== undefined && idx >= 0 && idx < cells.length ? String(cells[idx] || '').trim() : '');

    const insuranceBase = getMoney(colMap.insuranceBase);
    const positionSalary = getMoney(colMap.positionSalary);
    const completionBonus = getMoney(colMap.completionBonus);
    const totalIncomeAgreed = getMoney(colMap.totalIncomeAgreed) || (positionSalary + completionBonus) || insuranceBase;

    const probationDays = getNum(colMap.probationDays);
    const officialDays = getNum(colMap.officialDays);
    const paidLeaveDays = getNum(colMap.paidLeaveDays);
    const unpaidLeaveDays = getNum(colMap.unpaidLeaveDays);
    const workIncome = getMoney(colMap.workIncome);

    const otNormalHours = getNum(colMap.otNormalHours);
    const otWeekendHours = getNum(colMap.otWeekendHours);
    const otHolidayHours = getNum(colMap.otHolidayHours);
    const baseHourlyRate = getMoney(colMap.baseHourlyRate);
    const otTotalIncome = getMoney(colMap.otTotalIncome);

    const phoneAllowance = getMoney(colMap.phoneAllowance);
    const attireAllowance = getMoney(colMap.attireAllowance);
    const parkingAllowance = getMoney(colMap.parkingAllowance);
    const fuelAllowance = getMoney(colMap.fuelAllowance);
    const businessTripAllowance = getMoney(colMap.businessTripAllowance);
    const totalAllowance = getMoney(colMap.totalAllowance) || (phoneAllowance + attireAllowance + parkingAllowance + fuelAllowance + businessTripAllowance);

    const totalIncomeWithAllowance = getMoney(colMap.totalIncomeWithAllowance);
    const kpiBonus = getMoney(colMap.kpiBonus);
    const totalPreTaxIncome = getMoney(colMap.totalPreTaxIncome);

    // Các khoản NLĐ đóng
    const insuranceSocial = getMoney(colMap.insuranceSocial);
    const insuranceHealth = getMoney(colMap.insuranceHealth);
    const insuranceUnemployment = getMoney(colMap.insuranceUnemployment);
    const insuranceTotal = getMoney(colMap.insuranceTotal) || (insuranceSocial + insuranceHealth + insuranceUnemployment);

    // Thuế TNCN
    const personalDeduction = getMoney(colMap.personalDeduction);
    const dependentDeduction = getMoney(colMap.dependentDeduction);
    const dependentCount = getNum(colMap.dependentCount);
    const totalFamilyDeduction = getMoney(colMap.totalFamilyDeduction);
    const taxableIncome = getMoney(colMap.taxableIncome);
    const personalTax = getMoney(colMap.personalTax);

    const netIncomeAfterTax = getMoney(colMap.netIncomeAfterTax);
    const taxWithheld = getMoney(colMap.taxWithheld);
    const mealAllowance = getMoney(colMap.mealAllowance);
    const arrearsRecovery = getMoney(colMap.arrearsRecovery);
    const arrearsAddition = getMoney(colMap.arrearsAddition);
    const transferAmount = getMoney(colMap.transferAmount);

    // Các khoản Công ty đóng
    const compInsuranceSocial = getMoney(colMap.compInsuranceSocial);
    const compInsuranceHealth = getMoney(colMap.compInsuranceHealth);
    const compInsuranceUnemp = getMoney(colMap.compInsuranceUnemp);
    const compInsuranceAccident = getMoney(colMap.compInsuranceAccident);
    const compInsuranceTotal = getMoney(colMap.compInsuranceTotal);
    const totalCompanyCost = getMoney(colMap.totalCompanyCost);

    const isSignedRaw = getStr(colMap.isSigned);
    const isSigned = isSignedRaw.toLowerCase() === 'x' || isSignedRaw === '1';
    const notes = getStr(colMap.notes);
    const additionalArrears = getMoney(colMap.additionalArrears);

    // Tính định mức chuẩn cho vị trí này
    const isSecurity = currentDept.toUpperCase().includes('BẢO VỆ') || currentDept.toUpperCase().includes('TẠP VỤ') || (fullName && fullName.includes('Ước'));
    const empStandardDays = isSecurity ? standardDaysSecurity : standardDays;

    // Số tiền thực chuyển và lương thực lĩnh: ưu tiên tuyệt đối giá trị transferAmount từ Excel
    const finalNet = (transferAmount > 0) ? transferAmount : (netIncomeAfterTax > 0 ? netIncomeAfterTax : totalIncomeAgreed);

    rows.push({
      stt: parseNumber(tt),
      full_name: fullName,
      employee_code: empCode,
      department: currentDept,
      standard_days: empStandardDays,
      insurance_base: insuranceBase,
      position_salary: positionSalary,
      completion_bonus: completionBonus,
      total_income_agreed: totalIncomeAgreed,
      base_salary: totalIncomeAgreed || insuranceBase || positionSalary,
      probation_days: probationDays,
      official_days: officialDays,
      paid_leave_days: paidLeaveDays,
      unpaid_leave_days: unpaidLeaveDays,
      work_days: (officialDays + probationDays),
      work_income: workIncome,
      ot_normal_hours: otNormalHours,
      ot_weekend_hours: otWeekendHours,
      ot_holiday_hours: otHolidayHours,
      base_hourly_rate: baseHourlyRate,
      ot_total_income: otTotalIncome,
      overtime_pay: otTotalIncome,
      phone_allowance: phoneAllowance,
      attire_allowance: attireAllowance,
      parking_allowance: parkingAllowance,
      fuel_allowance: fuelAllowance,
      business_trip_allowance: businessTripAllowance,
      total_allowance: totalAllowance,
      allowance: totalAllowance,
      total_income_with_allowance: totalIncomeWithAllowance,
      kpi_bonus: kpiBonus,
      bonus: kpiBonus,
      total_pretax_income: totalPreTaxIncome,
      insurance_social: insuranceSocial,
      insurance_health: insuranceHealth,
      insurance_unemployment: insuranceUnemployment,
      insurance: insuranceTotal,
      personal_deduction: personalDeduction,
      dependent_deduction: dependentDeduction,
      dependent_count: dependentCount,
      total_family_deduction: totalFamilyDeduction,
      taxable_income: taxableIncome,
      tax: personalTax,
      net_income_after_tax: netIncomeAfterTax,
      tax_withheld: taxWithheld,
      meal_allowance: mealAllowance,
      arrears_deduction: arrearsRecovery,
      arrears_addition: arrearsAddition || additionalArrears,
      transfer_amount: transferAmount,
      net_salary: finalNet,
      comp_insurance_social: compInsuranceSocial,
      comp_insurance_health: compInsuranceHealth,
      comp_insurance_unemp: compInsuranceUnemp,
      comp_insurance_accident: compInsuranceAccident,
      comp_insurance_total: compInsuranceTotal,
      total_company_cost: totalCompanyCost || finalNet,
      is_signed: isSigned,
      notes: notes + (additionalArrears > 0 ? (notes ? `; Bù lương T7: ${additionalArrears.toLocaleString('vi-VN')} đ` : `Bù lương T7: ${additionalArrears.toLocaleString('vi-VN')} đ`) : ''),
      additional_arrears: additionalArrears,
    });
  }

  return {
    standard_days: standardDays,
    standard_days_security: standardDaysSecurity,
    days_in_month: daysInMonth,
    total_employees: rows.length,
    rows,
    summary: {
      total_pretax_income: rows.reduce((s, r) => s + (r.total_pretax_income || 0), 0),
      total_insurance: rows.reduce((s, r) => s + (r.insurance || 0), 0),
      total_tax: rows.reduce((s, r) => s + (r.tax || 0), 0),
      total_meal_allowance: rows.reduce((s, r) => s + (r.meal_allowance || 0), 0),
      total_arrears_addition: rows.reduce((s, r) => s + (r.arrears_addition || 0), 0),
      total_arrears_deduction: rows.reduce((s, r) => s + (r.arrears_deduction || 0), 0),
      total_transfer_amount: rows.reduce((s, r) => s + (r.transfer_amount || 0), 0),
      total_company_insurance: rows.reduce((s, r) => s + (r.comp_insurance_total || 0), 0),
      total_company_cost: rows.reduce((s, r) => s + (r.total_company_cost || 0), 0),
    }
  };
}
