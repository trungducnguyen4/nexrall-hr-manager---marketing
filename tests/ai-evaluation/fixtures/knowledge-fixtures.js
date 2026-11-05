/**
 * Reproducible HR Knowledge Fixtures for Offline Evaluation
 */

export const FIXTURE_DOCUMENTS = [
  {
    id: 1,
    doc_id: 'doc-001',
    title: 'Quy chế nội quy lao động & Kỷ luật giờ làm 2026',
    category: 'hr_policy',
    visibility: 'public',
    allowed_roles: '["all"]',
    chunks: [
      {
        id: 1,
        section_title: 'Điều 1: Thời gian làm việc tiêu chuẩn',
        content: 'Giờ làm việc hành chính từ Thứ 2 đến Thứ 6 hàng tuần: Buổi sáng: 08:30 - 12:00, Nghỉ trưa: 12:00 - 13:30, Buổi chiều: 13:30 - 17:30. Địa điểm làm việc: Trụ sở chính công ty tại Hà Nội và Chi nhánh TP. Hồ Chí Minh.'
      },
      {
        id: 2,
        section_title: 'Điều 2: Mốc giờ chấm công và tính đi muộn',
        content: 'Mốc thời gian bắt đầu tính muộn: 08:35 sáng. Nhân viên chấm công check-in từ 08:35 trở về trước được tính là Đúng giờ (On-time). Nhân viên chấm công check-in từ 08:36 trở đi được hệ thống tự động ghi nhận là Đi muộn (Late).'
      },
      {
        id: 3,
        section_title: 'Điều 3: Chính sách xử phạt vi phạm đi muộn',
        content: 'Chế độ miễn phạt: Mỗi nhân viên được miễn phạt tối đa 2 lần đi muộn trong một tháng. Kể từ lần đi muộn thứ 3 trở đi trong tháng, áp dụng mức phạt 20.000 VNĐ / lần. Số tiền phạt sẽ được HCNS tổng hợp và duyệt trừ vào lương thực nhận tại kỳ chốt Bảng lương hàng tháng.'
      },
      {
        id: 4,
        section_title: 'Điều 4: Quy chế làm việc từ xa WFH',
        content: 'Nhân viên có nhu cầu làm việc từ xa cần tạo đơn đăng ký WFH trên hệ thống trước ít nhất 12 giờ. Đơn WFH phải được Quản lý trực tiếp phê duyệt trước khi bắt đầu ca làm việc. Khi WFH được duyệt, nhân viên chấm công không bị ràng buộc bởi Geofence GPS của văn phòng.'
      }
    ]
  },
  {
    id: 2,
    doc_id: 'doc-002',
    title: 'Quy định chế độ nghỉ phép & Phúc lợi',
    category: 'hr_policy',
    visibility: 'public',
    allowed_roles: '["all"]',
    chunks: [
      {
        id: 5,
        section_title: 'Điều 1: Tiêu chuẩn ngày phép năm',
        content: 'Nhân viên ký hợp đồng lao động chính thức được hưởng 12 ngày nghỉ phép năm có hưởng lương / năm. Nhân viên làm việc đủ 05 năm tại công ty được cộng thêm 01 ngày phép năm. Phép năm chưa sử dụng hết trong năm được bảo lưu chuyển sang quý 1 năm tiếp theo (hạn chót sử dụng là 31/03).'
      },
      {
        id: 6,
        section_title: 'Điều 2: Quy trình phê duyệt đơn xin nghỉ phép 2 bước',
        content: 'Quy trình phê duyệt gồm 2 bước nghiêm ngặt: Bước 1: Quản lý trực tiếp (Direct Manager) xem xét khối lượng công việc và duyệt sơ bộ. Bước 2: Phòng Hành chính Nhân sự (HCNS) kiểm tra quỹ phép thực tế và ra quyết định phê duyệt chính thức (Final Approval). Đơn nghỉ chỉ có hiệu lực khi hoàn tất cả 2 bước phê duyệt.'
      },
      {
        id: 7,
        section_title: 'Điều 3: Nghỉ việc riêng hưởng nguyên lương',
        content: 'Kết hôn: Nghỉ 03 ngày nguyên lương. Con đẻ, con nuôi kết hôn: Nghỉ 01 ngày. Tứ thân phụ mẫu hoặc vợ/chồng, con qua đời: Nghỉ 03 ngày hưởng nguyên lương.'
      }
    ]
  },
  {
    id: 3,
    doc_id: 'doc-003',
    title: 'Quy định quản lý công việc & Bảo mật dữ liệu',
    category: 'security',
    visibility: 'public',
    allowed_roles: '["all"]',
    chunks: [
      {
        id: 8,
        section_title: 'Điều 1: Quản lý Không gian làm việc cá nhân & Dự án',
        content: 'Mỗi nhân sự khi gia nhập công ty được hệ thống cấp một Không gian công việc cá nhân. Ban Giám đốc và Trưởng phòng HCNS được cấu hình mặc định là người theo dõi để phối hợp và hỗ trợ công việc. Mọi công việc (Task) cần cập nhật đầy đủ tiêu đề, mô tả, mức độ ưu tiên, hạn hoàn thành (Due date) và phân công người phụ trách.'
      },
      {
        id: 9,
        section_title: 'Điều 2: Bảo mật thông tin & Tài khoản hệ thống',
        content: 'Nhân viên có trách nhiệm bảo mật thông tin đăng nhập tài khoản hệ thống nội bộ, không chia sẻ mật khẩu cho người khác. Mật khẩu phải đáp ứng chính sách bảo mật tối thiểu 8 ký tự. Mọi dữ liệu khách hàng, tài liệu nhân sự và hóa đơn tài chính là tài sản mật của doanh nghiệp.'
      }
    ]
  },
  {
    id: 4,
    doc_id: 'doc-004',
    title: 'Chính sách đãi ngộ & Lương thưởng Ban Giám Đốc',
    category: 'executive',
    visibility: 'confidential',
    allowed_roles: '["director","admin"]',
    chunks: [
      {
        id: 10,
        section_title: 'Chế độ bồi thường và cổ phần Ban Giám Đốc',
        content: 'Chính sách bảo mật cấp cao: Thưởng quý cố định của Thành viên Ban Giám Đốc và Phó Tổng Giám Đốc là 100.000.000 VNĐ kèm quyền chọn cổ phần ESOP theo hiệu quả tăng trưởng doanh thu hàng năm.'
      }
    ]
  }
];
