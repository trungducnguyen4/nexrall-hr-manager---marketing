// Usage (preview only):
//   $env:HR_TOKEN='...'; node scripts/import-attendance-tsv.mjs <timesheet.tsv>
// Commit after reviewing the preview:
//   $env:HR_TOKEN='...'; node scripts/import-attendance-tsv.mjs <timesheet.tsv> --commit
// The script never sends an import without --commit.
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const filePath = args[0];
const mode = args.includes('--commit') ? '--commit' : '';
const readFlagNumber = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && /^\d+$/.test(args[index + 1] || '') ? Number(args[index + 1]) : fallback;
};
const offset = readFlagNumber('--offset', 0);
const limit = readFlagNumber('--limit', Number.MAX_SAFE_INTEGER);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8787';
const token = process.env.HR_TOKEN;
if (!filePath || !token) throw new Error('Cần đường dẫn bảng TSV và biến môi trường HR_TOKEN.');

const source = await readFile(filePath, 'utf8');
const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
const title = lines.find(line => /Tháng\s+\d+\s+năm\s+\d+/i.test(line));
const match = title?.match(/Tháng\s+(\d+)\s+năm\s+(\d+)/i);
if (!match) throw new Error('Không xác định được tháng/năm trong bảng.');
const period_month = `${match[2]}-${String(match[1]).padStart(2, '0')}`;
const headerIndex = lines.findIndex(line => line.includes('Mã NV') && line.includes('Họ và tên'));
if (headerIndex < 0) throw new Error('Không tìm thấy hàng tiêu đề Mã NV / Họ và tên.');

const departmentMap = {
  'BAN GIÁM ĐỐC': 'Ban Giám Đốc', 'PHÒNG HÀNH CHÍNH NHÂN SỰ': 'Phòng HCNS',
  'PHÒNG KINH DOANH': 'Phòng Kinh Doanh', 'PHÒNG MARKETING': 'Phòng Marketing',
  'PHÒNG BIÊN TẬP': 'Phòng Biên Tập', 'PHÒNG SẢN XUẤT PHIM': 'Phòng Sản Xuất Phim',
  'PHÒNG GAME SHOW': 'Phòng Gameshow', 'TẠP VỤ + BẢO VỆ': 'Tạp Vụ + Bảo Vệ',
  'PHÒNG KẾ TOÁN': 'Phòng Kế Toán', 'THỰC TẬP SINH': 'Thực Tập Sinh',
};
let department = '';
const employees = [];
for (const line of lines.slice(headerIndex + 2)) {
  const cells = line.split('\t').map(value => value.trim());
  const code = cells[2] || '';
  const full_name = cells[3] || '';
  if (!full_name) {
    const heading = departmentMap[code.toUpperCase()];
    if (heading) department = heading;
    continue;
  }
  if (!code) continue;
  const days = {};
  for (let day = 1; day <= 31; day++) {
    const value = cells[5 + day];
    if (value === '0' || value === '0.5' || value === '1') days[day] = Number(value);
  }
  employees.push({
    employee_code: code, full_name, position: cells[4] || '', work_location: cells[5] || '',
    department, note: cells[1] || '', employee_type: (cells[4] || '').toUpperCase() === 'TTS' ? 'TTS' : 'NV', days,
  });
}
const selectedEmployees = employees.slice(offset, offset + limit);
const body = { source_name: `Bảng chấm công ${period_month}${limit !== Number.MAX_SAFE_INTEGER ? ` (lô ${Math.floor(offset / limit) + 1})` : ''}`, period_month, employees: selectedEmployees };
const endpoint = mode === '--commit' ? '/api/attendance-imports/commit' : '/api/attendance-imports/preview';
const response = await fetch(`${baseUrl}${endpoint}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
const data = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`${response.status}: ${data.error || 'Không thể nhập bảng'}`);
console.log(JSON.stringify({ endpoint, period_month, employees: selectedEmployees.length, total_employees: employees.length, offset, result: data }, null, 2));
