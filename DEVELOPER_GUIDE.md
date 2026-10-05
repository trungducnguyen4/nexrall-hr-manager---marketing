# 📖 HƯỚNG DẪN DÀNH CHO LẬP TRÌNH VIÊN (DEVELOPER ONBOARDING GUIDE)
## Hệ Thống Quản Trị Nhân Sự & AI Copilot — NetViet HR Pro

Tài liệu này hướng dẫn chi tiết cách tải mã nguồn (clone), thiết lập môi trường, chạy thử (local dev), chỉnh sửa code, kiểm thử (testing) và triển khai (deployment) lên Cloudflare Workers.

---

## 📌 1. YÊU CẦU MÔI TRƯỜNG (PREREQUISITES)

Trước khi bắt đầu, hãy đảm bảo máy tính của bạn đã cài đặt:
* **Node.js**: Phiên bản `v18.x` hoặc `v20.x` LTS trở lên ([Tải tại nodejs.org](https://nodejs.org/)).
* **Git**: Phiên bản mới nhất ([Tải tại git-scm.com](https://git-scm.com/)).
* **Trình soạn thảo mã nguồn**: Khuyên dùng **VS Code** hoặc **Cursor**.
  * *Extensions đề xuất:* Tailwind CSS IntelliSense, SQLite Viewer, Cloudflare Wrangler.
* **Tài khoản Cloudflare**: Được cấp quyền `Super Administrator` hoặc `Administrator` để deploy và tương tác D1/R2.

---

## 🚀 2. TẢI MÃ NGUỒN VÀ CÀI ĐẶT (SETUP IN 3 MINUTES)

### Bước 2.1: Clone repository về máy
Mở Terminal (hoặc PowerShell / Command Prompt) và chạy:
```bash
git clone https://github.com/trungducnguyen4/nexrall-hr-manager---marketing.git
cd nexrall-hr-manager---marketing
```

### Bước 2.2: Cài đặt các gói thư viện
```bash
npm install
```

### Bước 2.3: Đăng nhập Cloudflare Wrangler CLI
Để tương tác với Cloudflare D1 Database và deploy:
```bash
npx wrangler login
```
*(Trình duyệt sẽ tự động mở ra. Đăng nhập tài khoản Cloudflare của bạn và bấm **Allow** để xác thực)*.

Kiểm tra trạng thái đăng nhập thành công:
```bash
npx wrangler whoami
```

---

## 📂 3. CẤU TRÚC THƯ MỤC DỰ ÁN (PROJECT STRUCTURE)

Dự án được xây dựng theo kiến trúc **Serverless Edge SPA + Modular Backend**:

```
nexrall-hr-manager---marketing/
├── src/                         <-- MÃ NGUỒN FRONTEND CHÍNH (SỬA GIAO DIỆN Ở ĐÂY)
│   ├── views/                   <-- Các phân hệ giao diện:
│   │   ├── dashboard.js         <-- Màn hình Tổng quan & Radar GPS
│   │   ├── attendance.js        <-- Màn hình Chấm công
│   │   ├── payroll.js           <-- Màn hình Bảng lương & Phiếu lương
│   │   ├── tasks.js             <-- Màn hình Quản lý công việc (Kanban)
│   │   ├── leave.js             <-- Màn hình Nghỉ phép (Đơn từ)
│   │   ├── users.js             <-- Màn hình Danh bạ & Nhân sự
│   │   ├── notifications.js     <-- Màn hình Thông báo & Web Push
│   │   └── settings.js          <-- Màn hình Cài đặt hệ thống
│   ├── copilot.js               <-- Giao diện Trợ lý ảo AI Copilot & Action Cards
│   ├── api.js                   <-- Lớp giao tiếp API với Backend
│   ├── app.js                   <-- Router và quản lý State toàn ứng dụng
│   ├── chat-room.js             <-- Durable Object: WebSocket Chat thời gian thực
│   └── sync-hub.js              <-- Durable Object: Global Realtime Client Sync
│
├── styles/                      <-- CSS giao diện (Tailwind CSS & custom tokens)
│   └── main.css
│
├── server/                      <-- MÃ NGUỒN BACKEND (SỬA LOGIC API Ở ĐÂY)
│   ├── controllers/             <-- HTTP Controllers tiếp nhận request:
│   │   ├── ai.controller.js     <-- API Chat AI, Rate Limit, HITL Confirm/Undo
│   │   ├── auth.controller.js   <-- API Đăng nhập, Đăng xuất, Session
│   │   ├── users.controller.js  <-- API Hồ sơ nhân viên, Đổi mã NV
│   │   ├── attendance.controller.js <-- API Check-in GPS, Duyệt vị trí
│   │   ├── leave.controller.js  <-- API Nghỉ phép, Duyệt đơn 2 bước
│   │   ├── tasks.controller.js  <-- API Công việc, Kéo thả Kanban
│   │   └── wifi.controller.js   <-- API Quản lý WiFi whitelist
│   │
│   └── services/                <-- Nghiệp vụ lõi (Business Logic):
│       ├── agent.service.js     <-- Lõi Agent: 24 Tools, RBAC, Citation Grounding
│       ├── ai-gateway.service.js<-- AI Gateway: Circuit Breaker, Fallback, SSE
│       ├── auth.service.js      <-- Băm mật khẩu, tạo token session
│       └── users.service.js     <-- Thao tác dữ liệu nhân viên
│
├── worker.js                    <-- Entry point chính của Cloudflare Worker
├── server.js                    <-- Router tổng hợp backend và migration
├── wrangler.toml                <-- Cấu hình Cloudflare (D1, R2, DO, Triggers)
├── tests/                       <-- BỘ TEST SUITE TỰ ĐỘNG (100% Pass)
├── backups/                     <-- Thư mục chứa các bản sao lưu Database D1
├── sync-to-deploy.ps1           <-- Script đồng bộ và deploy lên Cloudflare
└── .local-public/               <-- THƯ MỤC BUILD ĐỒNG BỘ (KHÔNG SỬA TRỰC TIẾP TẠI ĐÂY!)
```

> [!CAUTION]
> **QUY TẮC BẮT BUỘC KHI SỬA CODE FRONTEND:**
> * Bạn **CHỈ CHỈNH SỬA** trong thư mục `src/`, `styles/` và file `index.html`.
> * **TUYỆT ĐỐI KHÔNG** sửa code trực tiếp trong thư mục `.local-public/`! Thư mục `.local-public/` là thư mục build tự động và sẽ bị xóa/ghi đè hoàn toàn mỗi khi chạy lệnh build hoặc deploy.

---

## 💻 4. CHẠY THỬ MÔI TRƯỜNG PHÁT TRIỂN (LOCAL DEVELOPMENT)

### Cách 1: Chạy Local Dev (Khuyên dùng)
```bash
npm run dev
```
Lệnh này sẽ tự động:
1. Đồng bộ tài nguyên từ `src/` và `styles/` sang `.local-public/`.
2. Khởi động máy chủ Cloudflare Worker cục bộ tại địa chỉ `http://localhost:8787`.

### Cách 2: Chạy Local Dev kết nối với D1 Database Remote (Thực tế)
Nếu bạn muốn chạy code trên máy nhưng đọc/ghi trực tiếp vào cơ sở dữ liệu D1 Cloudflare:
```bash
npx wrangler dev --remote
```

---

## 🧪 5. QUY TRÌNH CHẠY KIỂM THỬ (TESTING SUITES)

Trước khi commit hoặc deploy bất kỳ thay đổi nào, bạn **PHẢI CHẠY** các bộ kiểm thử để đảm bảo không bị lỗi logic:

```bash
# 1. Kiểm tra toàn diện hệ thống HR (Geofence, Chấm công, Bảng lương, Cú pháp)
npm test

# 2. Kiểm tra Bảo mật AI (Rate limiting, IDOR, Input guard, Circuit Breaker)
npm run test:ai-security

# 3. Kiểm tra Agentic Tools (24 Tools, Phân quyền RBAC, Citation Grounding)
npm run test:ai-agent

# 4. Kiểm tra Streaming phản hồi thời gian thực (Server-Sent Events)
npm run test:ai-stream
```

*(Tiêu chuẩn: Tất cả các bài kiểm tra phải báo `ok` và không có lỗi `AssertionError`)*.

---

## 🚀 6. TRIỂN KHAI LÊN CLOUDFLARE (DEPLOYMENT)

### Triển khai tự động (Một lệnh duy nhất):
```powershell
npm run deploy
```
*Script sẽ tự động làm sạch `.local-public/`, sao chép toàn bộ mã nguồn mới nhất và thực thi `wrangler deploy` lên Cloudflare Workers.*

### Chỉ đồng bộ file mà chưa deploy ngay:
```powershell
npm run deploy:sync-only
```

---

## 🗄️ 7. THAO TÁC VỚI CƠ SỞ DỮ LIỆU CLOUDFLARE D1

### Sao lưu toàn bộ Database về máy (Backup):
Trước khi can thiệp vào cấu trúc bảng hoặc dữ liệu lớn, hãy sao lưu:
```powershell
npm run backup
```
File sao lưu sẽ được xuất ra tại: `backups/backup_YYYYMMDD_HHmmss/database_d1.sql`.

### Chạy câu lệnh SQL trực tiếp trên D1 Remote:
```bash
# Xem danh sách nhân viên:
npx wrangler d1 execute nexrall-hr-manager-local --remote --command="SELECT id, full_name, role, department FROM users LIMIT 10;"

# Đếm số bản ghi chấm công hôm nay:
npx wrangler d1 execute nexrall-hr-manager-local --remote --command="SELECT COUNT(*) FROM attendance;"
```

### Chạy nạp dữ liệu từ một file SQL vào D1 Remote:
```bash
npx wrangler d1 execute nexrall-hr-manager-local --remote --file=duong_dan_den_file.sql
```

---

## 🔑 8. CẤU HÌNH BIẾN MÔI TRƯỜNG & AI KEYS

Các biến môi trường được khai báo trong file [`wrangler.toml`](./wrangler.toml):

1. **`GEMINI_API_KEY`**: Khóa API Google Gemini dùng cho AI Copilot.
   * Để đổi API key: Chỉnh sửa trực tiếp tại dòng 6 trong `wrangler.toml`, hoặc dùng lệnh:
     ```bash
     npx wrangler secret put GEMINI_API_KEY
     ```
2. **`database_id`**: Định danh D1 Database trên Cloudflare.
   * Không tự ý thay đổi chuỗi ID này trừ khi bạn chuyển sang một Database mới.

---

## 👥 9. TÀI KHOẢN ĐĂNG NHẬP THỬ NGHIỆM

Khi khởi chạy hệ thống, bạn có thể đăng nhập bằng các tài khoản phân quyền mẫu sau:

| Tài khoản | Mật khẩu mặc định | Vai trò (Role) | Chức năng kiểm thử |
| :--- | :--- | :--- | :--- |
| `admin` (hoặc email Admin) | `123456` / `admin123` | **admin** | Toàn quyền cấu hình, chốt bảng lương, đổi mã NV, xem audit AI. |
| `hcns` | `123456` | **hcns** | Quản lý chấm công, duyệt đơn nghỉ phép bước 2, tính lương. |
| `manager` | `123456` | **manager** | Quản lý phòng ban, giao việc Kanban, duyệt đơn bước 1. |
| `nhanvien` | `123456` | **employee** | Check-in GPS, tạo đơn nghỉ phép, chat Copilot, xem phiếu lương cá nhân. |

---

## 🆘 10. NHỮNG LỖI THƯỜNG GẶP & CÁCH KHẮC PHỤC

* **Lỗi 1: `Sửa code trong .local-public nhưng khi deploy bị mất`**
  * *Khắc phục:* Bạn phải sửa trong `src/` và `styles/`, không được sửa trong `.local-public/`.
* **Lỗi 2: `Error: Authentication error (401 / 403)` khi chạy lệnh wrangler**
  * *Khắc phục:* Chạy `npx wrangler logout` rồi chạy lại `npx wrangler login` để đăng nhập lại tài khoản Cloudflare.
* **Lỗi 3: `D1 database not found`**
  * *Khắc phục:* Đảm bảo tài khoản Cloudflare bạn đăng nhập đã được thêm vào Account chứa Database và kiểm tra tên database trong lệnh là `nexrall-hr-manager-local`.

---
Chúc bạn phát triển và mở rộng hệ thống NetViet HR Pro thuận lợi! Mọi thắc mắc kỹ thuật có thể tham khảo thêm tại tài liệu [`docs/HANDOVER_GUIDE.md`](./docs/HANDOVER_GUIDE.md).
