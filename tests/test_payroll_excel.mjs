const excelText = `	Ngày công định mức		23	23	Ngày trong tháng			30																																										
	Ngày công định mức bảo vệ			27																																														
TT	Họ và tên	Mã nhân viên	Mức lương	Thu nhập trước thuế của người lao động																						Các khoản đóng góp của NLĐ				Thuế TNCN						"Thu nhập \nthực lĩnh \nsau thuế"	Thuế TNCN đã khấu trừ	Tiền ăn ca	Truy thu	Truy lĩnh	" Số tiền \nchuyển \nvào \ntài khoản \nNLĐ "	Các khoản đóng góp của Công ty					"Tổng \nquỹ lương, \nthưởng \nCông ty"			
																																																		
				Tổng thu nhập (bao gồm lương và thưởng hoàn thành công việc)			Ngày công làm việc				"Tổng thu \nnhập theo \nngày công\n làm việc"	Thu nhập ngoài giờ					Các khoản thu nhập khác theo QĐ						"Tổng \nthu nhập \n& phụ cấp"	Thưởng KPI	"Tổng \nthu nhập \ntrước thuế"	Bảo hiểm xã hội (8%)	Bảo hiểm Y tế  (1,5%)	Bảo hiểm thất nghiệp (1%)	Tổng cộng 	"Cho \nbản thân"	"Cho \nngười\nphụ thuộc"	"Số \nlượng"	"Giảm trừ \ngia cảnh \n(bản thân \nvà người \nphụ thuộc)"	"Thu nhập\ntính \nthuế \nTNCN"	"Thuế \nTNCN"							"Bảo hiểm \nxã hội \n(17%)"	"Bảo hiểm \nY tế  \n(3%)"	"Bảo hiểm \nthất \nnghiệp \n(1%)"	"Bảo hiểm \nTNLĐ - BNN\n(0,5%)"	 Tổng cộng  				
				Lương vị trí, chức danh	Thưởng hoàn thành công việc	"Tổng \nthu nhập"	"Công \nthử \nviệc"	Công chính thức	Nghỉ phép, việc riêng 	Nghỉ KL; BHXH		Ngày thường	Ngày nghỉ	"Ngày \nlễ"	"Thu \nnhập \ntheo giờ\ncơ sở"	" Tổng \nthu nhập \nngoài giờ "	Điện thoại	Trang phục	Gửi xe	Xăng xe	Hỗ trợ công tác	Tổng cộng																												 35,279,000   
																																																		 121,616,061   
	BAN GIÁM ĐỐC		5,000,000																																															
1	Nguyễn Văn Hậu	HAUNV	5,000,000	 8,000,000 	 (3,730,000)	 4,270,000 	23	0	0	0	 4,270,000 				 27,174 	 -   						 -   	 4,270,000 		 4,270,000 				 -   		 6,200,000 		 -   	 5,000,000 	 500,000 	 3,770,000 		 730,000 			 4,500,000 					 -   	 5,000,000 	 Lương của anh Hậu Thử việc vẫn 100% lương  		
2	Nguyễn Thu Hương	HUONGNT	5,000,000	 8,000,000 	 (3,730,000)	 4,270,000 	0	23	0	0	 4,270,000 				 27,174 	 -   			150,000			 150,000 	 4,420,000 		 4,420,000 	 640,000 	 120,000 	 80,000 	 840,000 	 15,500,000 	 6,200,000 		 15,500,000 	 -   	 -   	 3,580,000 		 730,000 			 4,310,000 	 1,360,000 	 240,000 	 80,000 	 40,000 	 1,720,000 	 6,870,000 			
`;

const lines = excelText.split('\n');
const row2 = lines.find(l => l.includes('Nguyễn Thu Hương'));
import { parsePayrollExcelText } from '../src/excel-payroll-parser.js';

const result = parsePayrollExcelText(excelText);
console.log('Total parsed rows:', result.rows.length);
console.log('Standard days:', result.standard_days);
console.log('Summary:', result.summary);

if (result.rows.length !== 2) {
  console.error('Expected 2 rows in sample snippet, got', result.rows.length);
  process.exit(1);
}

const hau = result.rows.find(r => r.employee_code === 'HAUNV');
if (!hau) {
  console.error('HAUNV not found!');
  process.exit(1);
}
console.log('✓ HAUNV parsed correctly:', {
  name: hau.full_name,
  code: hau.employee_code,
  dept: hau.department,
  work_days: hau.work_days,
  transfer_amount: hau.transfer_amount,
  total_pretax: hau.total_pretax_income,
});

const huong = result.rows.find(r => r.employee_code === 'HUONGNT');
if (!huong) {
  console.error('HUONGNT not found!');
  process.exit(1);
}
console.log('✓ HUONGNT parsed correctly:', {
  name: huong.full_name,
  code: huong.employee_code,
  parking: huong.parking_allowance,
  meal: huong.meal_allowance,
  insurance: huong.insurance,
  transfer_amount: huong.transfer_amount,
});

if (huong.transfer_amount !== 4310000) {
  console.error('HUONGNT transfer_amount mismatch! Expected 4310000, got', huong.transfer_amount);
  process.exit(1);
}
if (huong.parking_allowance !== 150000) {
  console.error('HUONGNT parking_allowance mismatch! Expected 150000, got', huong.parking_allowance);
  process.exit(1);
}
if (huong.insurance !== 840000) {
  console.error('HUONGNT insurance mismatch! Expected 840000, got', huong.insurance);
  process.exit(1);
}

console.log('All tests passed successfully!');
