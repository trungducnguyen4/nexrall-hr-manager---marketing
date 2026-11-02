---
name: design-taste-frontend
description: >-
  Chuẩn mực thiết kế Frontend cao cấp, chống AI-slop cho hệ thống NetViet HR Marketing Pro. Tối ưu cho kiến trúc Vanilla JS SPA, Modern CSS Variables, giao diện Enterprise HR & Marketing trực quan, tinh gọn, micro-interactions mượt mà, layout thích ứng desktop/mobile PWA, đồng bộ bảng màu thương hiệu NetViet Orange (#EE4D2D).
whenToUse: >-
  Kích hoạt khi xây dựng hoặc tinh chỉnh giao diện người dùng (views, components, modals, tables, forms, charts, widgets); nâng cấp thẩm mỹ UI/UX; thiết kế các màn hình chấm công, tính lương, quản trị nhân sự, marketing campaign, hoặc AI assistant drawer.
---

# Design Taste Frontend — NetViet HR Marketing Pro

Bộ quy chuẩn thiết kế giao diện doanh nghiệp cao cấp, loại bỏ hoàn toàn các lỗi thiết kế rập khuôn của AI (AI-slop), tối ưu hóa trải nghiệm người dùng (UX) cho cán bộ nhân viên và ban lãnh đạo trong hệ sinh thái **NetViet HR Marketing Pro**.

---

## 0. Đọc vị ngữ cảnh thiết kế (Brief Inference)

Trước khi viết bất kỳ dòng mã HTML/CSS nào, xác định rõ:
1. **Đối tượng sử dụng**: Nhân viên văn phòng, thực tập sinh chấm công mobile, trưởng bộ phận duyệt đơn nhanh, hay Ban Giám Đốc/HCNS cần xem bảng lương và báo cáo phân tích tổng thể.
2. **Loại màn hình**:
   - **Data-Dense Enterprise View**: Bảng lương (Payroll), Bảng chấm công (Attendance), Báo cáo hiệu suất (KPI) $\rightarrow$ Yêu cầu độ tương phản cao, số liệu dạng tabular, khoảng cách khoa học, bộ lọc tức thì.
   - **Interactive User Flow**: Xin nghỉ phép, check-in GPS/Wifi, chỉnh sửa hồ sơ nhân viên $\rightarrow$ Yêu cầu form trực quan, validation inline rõ ràng, phản hồi xúc giác (tactile feedback).
   - **Communication & AI**: Realtime chat, Floating AI Copilot drawer $\rightarrow$ Hiện đại, phân tách rõ tin nhắn người/bot, micro-action buttons tiện dụng.
3. **Bộ nhận diện NetViet**:
   - **Màu thương hiệu chủ đạo**: NetViet Orange (`#EE4D2D` / `#FF5722`).
   - **Màu trung tính cơ sở**: Slate dark (`#0f172a`, `#1e293b`), Light surface (`#f8fafc`, `#ffffff`), Đường viền mềm (`#e2e8f0`, `#cbd5e1`).

---

## 1. Ba núm xoay thiết kế (The Three Dials)

Định hình phong cách qua 3 chỉ số cốt lõi:
- **`DESIGN_VARIANCE: 4`** (Chuẩn mực doanh nghiệp: 1 = Đối xứng tuyệt đối, 10 = Nghệ thuật tự do. Với hệ thống HR nội bộ, giữ ở mức 3–5 để đảm bảo tính nhất quán và dễ sử dụng).
- **`MOTION_INTENSITY: 5`** (Độ động giao diện: 1 = Tĩnh, 10 = Điện ảnh. Giữ mức 4–5: mượt mà, phản hồi tức thì với CSS transitions 150ms–250ms, không lạm dụng hiệu ứng làm chậm thao tác người dùng).
- **`VISUAL_DENSITY: 7`** (Mật độ thông tin: 1 = Rộng rãi kiểu portfolio, 10 = Buồng lái máy bay/Terminal. Màn hình HR cần mật độ 6–8 để hiển thị đầy đủ thông tin mà không gây ngợp thị giác).

---

## 2. Các quy tắc "Anti-Slop" (Loại bỏ tàn tích AI cẩu thả)

### 2.1 Bảng màu & Bề mặt (Color & Surface Calibration)
- 🚫 **CẤM gradient tím/xanh ngẫu nhiên ("AI Purple glow")**: Tuyệt đối không dùng gradient màu tím hồng generic vào các nút bấm hay tiêu đề của NetViet HR.
- ✅ **Khóa bảng màu nhất quán**:
  - Primary Accent: `#EE4D2D` (Shopee/NetViet Orange). Hover: `#D73211`. Active: `#BA2B0E`.
  - Secondary / Supporting: Emerald `#10b981` (Duyệt/Thành công/Đúng giờ), Amber `#f59e0b` (Chờ duyệt/Cảnh báo/Đi muộn), Rose `#ef4444` (Từ chối/Lỗi/Nghỉ không phép), Blue `#3b82f6` (Thông tin/Công việc).
  - Background Light: `#f8fafc` (Page background), `#ffffff` (Card surface).
  - Background Dark (nếu kích hoạt dark mode): `#0f172a` (Page background), `#1e293b` (Card surface).
- 🚫 **CẤM đổ bóng đen kịt 100% opacity**: Đổ bóng phải mềm mại, hòa sắc với nền:
  ```css
  /* Chuẩn bóng đổ NetViet */
  --shadow-sm: 0 1px 2px 0 rgba(15, 23, 42, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04);
  --shadow-lg: 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.03);
  ```

### 2.2 Typography & Định dạng dữ liệu (Data Typography)
- **Font chữ chuẩn**: Hệ thống ưu tiên Sans-serif hiện đại, hỗ trợ dấu tiếng Việt hoàn hảo (`Inter`, `Plus Jakarta Sans`, `system-ui`).
- **Tabular Numbers cho số liệu**: Bảng chấm công, giờ làm việc, cột tiền tệ VND, mã số nhân viên **bắt buộc** dùng:
  ```css
  font-variant-numeric: tabular-nums;
  ```
  giúp các con số thẳng hàng hoàn hảo khi hiển thị theo cột.
- **Căn lề chuẩn mực trong Data Table**:
  - Cột văn bản (Tên, Email, Chức vụ, Phòng ban): Căn trái (`text-align: left`).
  - Cột số liệu (Ngày công, Số giờ OT, Tiền lương, Phụ cấp): Căn phải (`text-align: right`).
  - Cột trạng thái, Checkbox, Avatar, Action: Căn giữa (`text-align: center`).
- **Định dạng tiền tệ và thời gian chuẩn Việt Nam**:
  - Tiền tệ: `new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount)` (ví dụ `15.000.000 ₫`).
  - Ngày tháng: `new Intl.DateTimeFormat('vi-VN').format(date)` (ví dụ `02/11/2026`).

### 2.3 Phân cấp bố cục & Layout (Layout Structure)
- **Shell layout hoàn chỉnh**:
  - Desktop: Sidebar điều hướng cố định bên trái (`width: 240px` - `260px`), Header thanh mảnh trên cùng (`height: 60px`), Vùng nội dung có `max-width: 1400px` và đệm lề chuẩn (`padding: 1.5rem`).
  - Mobile / PWA Viewport: Ẩn sidebar desktop $\rightarrow$ Hiển thị Header nhỏ gọn kèm nút Hamburger/Avatar + Bottom Navigation Bar cố định ở đáy màn hình với các tab chính (Tổng quan, Chấm công, Đơn từ, Tin nhắn, Cá nhân).
- 🚫 **Tránh lỗi Viewport Jump trên điện thoại**: Luôn dùng `min-height: 100dvh` thay vì `100vh` cho các màn hình full-screen hoặc backdrop modal.
- **Bán kính bo góc (Border Radius) đồng nhất**:
  - Card & Container: `rounded-xl` (`12px`).
  - Input & Button: `rounded-lg` (`8px`).
  - Tag / Badge trạng thái: `rounded-full` hoặc `rounded-md` (`6px`).
  - Tuyệt đối không phối hợp lộn xộn giữa nút vuông chằn chặn và card bo tròn quá đà trên cùng 1 view.

### 2.4 Trạng thái tương tác & Phản hồi (States & Feedback)
- **Nút bấm (Buttons)**:
  - Trạng thái `:hover`: Đổi tông màu nhẹ (`filter: brightness(0.95)` hoặc màu hover định danh) kèm nâng nhẹ `-translate-y-[1px]`.
  - Trạng thái `:active`: Nhấn chìm vật lý `transform: scale(0.98)` để mang lại cảm giác bấm thực tế trên cả chuột và màn hình cảm ứng.
  - Trạng thái `:disabled`: Độ mờ `opacity: 0.6`, `cursor: not-allowed`, loại bỏ con trỏ pointer.
- **Skeleton Loaders thay cho Spinner vô nghĩa**:
  - Khi tải danh sách nhân viên hoặc bảng lương, hiển thị khung xương xám nhấp nháy nhẹ (`animation: pulse 1.5s infinite ease-in-out`) đúng với hình dạng dòng dữ liệu thay vì một vòng tròn xoay giữa màn hình trắng xóa.
- **Empty States chỉn chu**:
  - Không để màn hình trống trơn khi danh sách rỗng (ví dụ: "Chưa có đơn xin nghỉ phép nào"). Thiết kế một minh họa icon nhẹ nhàng kèm câu hướng dẫn và nút tạo nhanh: "Tạo đơn xin nghỉ đầu tiên".

---

## 3. Quy chuẩn cho các thành phần đặc thù NetViet HR

### 3.1 Thẻ trạng thái phê duyệt (Status Badges)
Mọi badge phải có màu nền pastel nhạt + chữ đậm tương phản cao:
- **Đã duyệt / Hợp lệ**: `background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0;`
- **Chờ duyệt / Đang xử lý**: `background: #fffbeb; color: #92400e; border: 1px solid #fde68a;`
- **Từ chối / Vi phạm**: `background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;`
- **Nháp / Chưa gửi**: `background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;`

### 3.2 Modal & Slide-Over Drawer (Đặc biệt là AI Copilot)
- Phải có lớp nền mờ (`backdrop-filter: blur(4px); background: rgba(15, 23, 42, 0.4);`).
- Hỗ trợ đóng bằng phím ESC và bấm ra ngoài backdrop.
- Khóa thanh cuộn của `<body>` khi modal mở (`overflow: hidden`).
- Với AI Copilot: Giữ ở góc dưới bên phải màn hình desktop, cho phép thu nhỏ (`minimize`), phóng to (`expand`), hoặc ẩn/hiện mà không làm mất hội thoại đang dở.

### 3.3 Form & Input trong quy trình HR
- Luôn đặt `<label>` rõ ràng ở phía trên ô nhập liệu (không dùng placeholder thay thế cho label).
- Ô bắt buộc phải có dấu sao đỏ (`<span class="text-danger">*</span>`).
- Hiển thị thông báo lỗi (Error message) ngay bên dưới trường dữ liệu vi phạm với màu chữ rõ ràng (`#ef4444`).

---

## 4. Pre-Flight Checklist trước khi nghiệm thu Frontend

Trước khi commit bất kỳ thay đổi UI nào:
- [ ] Giao diện có giữ đúng màu chủ đạo `#EE4D2D` và không xuất hiện gradient tím rác của AI không?
- [ ] Các con số tiền tệ, ngày công, mã nhân viên đã được định dạng chuẩn tabular và căn lề đúng chưa?
- [ ] Màn hình đã được kiểm tra trên cả Desktop (`1440px`) và Mobile (`390px`) chưa?
- [ ] Các nút bấm và tương tác có hiệu ứng hover/active vật lý rõ ràng không?
- [ ] Đã có trạng thái Empty State và Skeleton Loading khi dữ liệu đang tải chưa?
- [ ] Độ tương phản chữ (contrast ratio) đạt chuẩn tối thiểu WCAG AA (đọc rõ ràng, không bị chìm màu)?
