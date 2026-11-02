---
name: release-versioning
description: >-
  Quy trình đóng gói phiên bản, cập nhật CHANGELOG.md, đặt tên commit chuẩn, gắn git tag và xác minh triển khai Cloudflare Workers & D1 trong NetViet HR Marketing Pro. PHẢI dùng khi user yêu cầu "tạo version mới", "bump version", "release", "gắn tag version", hoặc chuẩn bị phát hành một bản cập nhật chính thức.
whenToUse: >-
  Kích hoạt khi người dùng yêu cầu bump version, release bản build mới, hoặc đóng gói các tính năng/sửa lỗi thành version chính thức. Không dùng cho các commit sửa code thường ngày.
---

# Release & Versioning — NetViet HR Marketing Pro

Quy trình quản lý phiên bản phần mềm (`MAJOR.MINOR.PATCH`), đồng bộ cơ sở dữ liệu Cloudflare D1, cập nhật lịch sử thay đổi `CHANGELOG.md`, và gắn Git Tag cho hệ thống **NetViet HR Marketing Pro**.

> **Lưu ý quan trọng**: Không tự tiện bump version sau mỗi lần sửa một hàm hay chỉnh sửa nhỏ. Chỉ kích hoạt khi hoàn thành một cụm tính năng hoặc khi người dùng chủ động yêu cầu "tạo version mới", "release", "bump version".

---

## 0. Quy tắc Commit & Tác quyền (Bắt buộc)

- **TUYỆT ĐỐI KHÔNG thêm `Co-Authored-By` hay bất kỳ dòng ghi công AI/trợ lý nào vào commit message.** Mọi commit đều đứng tên người dùng độc lập.
- **Mặc định push lên remote luôn** sau khi commit và tạo tag (cả commit code thường lẫn commit `Release vX.Y.Z`), trừ khi người dùng nói rõ "khoan push".
- **Thứ tự chuẩn cho 1 đợt release**:
  1. Commit code tính năng/sửa lỗi đã hoàn thiện và push.
  2. Chạy đủ 4 bước kiểm tra xác minh ở Mục 2 cho tới khi PASS 100%.
  3. Cập nhật `package.json` và `CHANGELOG.md` ở gốc repo.
  4. Tạo commit `Release vX.Y.Z: <mô tả>` chứa `CHANGELOG.md` và `package.json`.
  5. Gắn annotated git tag `vX.Y.Z` và push cả commit lẫn tag lên remote.

---

## 1. Nguyên tắc tăng số Version

Tuân thủ chuẩn Semantic Versioning:
- **Tăng MINOR** (`1.2.0` $\rightarrow$ `1.3.0`): Có tính năng mới lớn (ví dụ: thêm phân hệ Đánh giá KPI, thêm module Check-in AI Selfie), hoặc có thay đổi schema D1 (thêm bảng, đổi cấu trúc cột).
- **Tăng PATCH** (`1.2.0` $\rightarrow$ `1.2.1`): Sửa lỗi logic, vá bảo mật, tối ưu UI/UX, cải thiện hiệu năng truy vấn SQLite, sửa file cấu hình.
- **Tăng MAJOR** (`1.0.0` $\rightarrow$ `2.0.0`): Thay đổi kiến trúc nền tảng mang tính phá vỡ tương thích ngược (breaking changes). Phải có sự đồng thuận rõ ràng của người dùng.

---

## 2. Bắt buộc kiểm tra THẬT trước khi Release

Tuyệt đối không commit "Release vX.Y.Z" dựa trên suy đoán "code chắc chắn chạy được". Bắt buộc chạy và ghi nhận kết quả thật:

### Bước 2.1: Chạy bộ kiểm thử tự động
```powershell
npm test
```
Tất cả các bài kiểm thử (`geofence.test.js`, `attendance-period.test.js`, `multi-proof.test.js`, `security-audit.test.js`) phải hiển thị **PASS 100%**. Nếu có test fail, phải sửa triệt để trước khi sang bước tiếp.

### Bước 2.2: Đồng bộ tài nguyên Frontend
```powershell
node scripts/sync-public.mjs
```
Đảm bảo toàn bộ tài nguyên web (`src/`, `styles/`, `index.html`, `manifest.webmanifest`, `sw.js`) được sao chép sạch sẽ vào thư mục `.local-public`. Script này cũng tự động loại trừ các file server nhạy cảm (`server.js`, `worker.js`, `wrangler.toml`).

### Bước 2.3: Kiểm tra Cơ sở dữ liệu Cloudflare D1
Nếu bản phát hành có cập nhật schema SQLite D1:
- Xác nhận câu lệnh D1 syntax hợp lệ với SQLite engine.
- Chạy thử lệnh kiểm tra bảng trên D1 demo:
  ```powershell
  npx wrangler d1 execute nexrall-hr-demo --command="SELECT COUNT(*) FROM users;"
  ```

### Bước 2.4: Triển khai & Health Check trên Cloudflare Workers
Triển khai lên Cloudflare Workers môi trường thật:
```powershell
npx wrangler deploy
# hoặc chạy: .\sync-to-deploy.ps1
```
Sau khi wrangler in ra Version ID và URL worker, thực hiện kiểm tra endpoint health:
```powershell
curl https://nexrall-hr-demo.netviet-hr-ios.workers.dev/api/health
```
Phải nhận được HTTP 200 kèm phản hồi trạng thái `{"status": "ok", ...}` hoặc tương đương.

---

## 3. Cập nhật `CHANGELOG.md` & `package.json`

Cập nhật trường `"version": "X.Y.Z"` trong `package.json`.
Mở file `CHANGELOG.md` ở gốc thư mục dự án và thêm mục mới nhất lên đầu danh sách:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Thay đổi
- Mô tả ngắn gọn từng tính năng/bug fix đã làm, kèm file chính đã sửa.
- Ví dụ: Sửa cơ chế click action của AI Copilot trong `src/copilot.js`.

### Cơ sở dữ liệu (Cloudflare D1)
- **Không thay đổi.** (hoặc: Thêm bảng `kpi_evaluations` qua `scripts/d1-schema.sql`).

### Triển khai (Cloudflare Workers)
- Đã sync tài nguyên vào `.local-public` và deploy Worker thành công (Version ID: `<hash>`).
```

---

## 4. Tạo Commit Release

Tạo commit riêng biệt chứa các file cập nhật version:
```powershell
git add package.json CHANGELOG.md
git commit -m "Release vX.Y.Z: <mô tả ngắn gọn>"
```
*Ví dụ*: `Release v1.1.0: Nang cap AI Copilot va dong bo giao dien cham cong mobile`

---

## 5. Gắn Git Tag & Đẩy lên Remote

Gắn tag có chú thích (`annotated tag`), trỏ đúng vào commit release vừa tạo:
```powershell
git tag -a vX.Y.Z -m "Release version X.Y.Z"
git push
git push origin vX.Y.Z
```

- Nếu phát hiện tag sai khi chưa push: `git tag -d vX.Y.Z` và tag lại.
- Nếu tag đã push lên GitHub, phải báo người dùng trước khi xóa/thay đổi tag từ xa.

---

## 6. Thông báo nghiệm thu

Sau khi hoàn tất, báo cáo rõ ràng cho người dùng:
1. Version mới: `vX.Y.Z`
2. Commit hash & Git tag tương ứng.
3. Trạng thái Cloudflare Workers deployment (Version ID & Live URL).
4. Lưu ý nếu người dùng cần cập nhật cấu hình môi trường hoặc phân quyền tài khoản.
