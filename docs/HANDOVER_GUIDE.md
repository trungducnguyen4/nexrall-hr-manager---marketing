# Hướng Dẫn Bàn Giao Kỹ Thuật Hệ Thống HR NetViet
*(Chuyển quyền sở hữu từ Tài khoản Cá nhân sang Tài khoản Công ty)*

Tài liệu này hướng dẫn đầy đủ quy trình kỹ thuật để chuyển giao toàn bộ mã nguồn, cơ sở dữ liệu D1, lưu trữ R2, Cloudflare Worker và tên miền sang tài khoản chính thức của công ty.

---

## 1. Hiện trạng tài nguyên đang gắn với tài khoản cá nhân

1. **Git Remote**: `https://github.com/trungducnguyen4/nexrall-hr-manager---marketing.git`
2. **Cloudflare Worker**: `nexrall-hr-manager-marketing`
3. **Cloudflare D1 Database**: `nexrall-hr-manager-local` (ID: `1e0eeebd-82fa-4c10-a079-97d35308a58b`)
4. **Cloudflare R2 Bucket**: `netviet-hr-documents`
5. **Durable Objects**: `ChatRoom` và `AppSyncHub` (Yêu cầu tài khoản Cloudflare bật gói **Workers Paid** $5/tháng)
6. **Custom Domain**: `hrnetviet.live`
7. **Gemini API Key**: Cấu hình trong `wrangler.toml`

---

## 2. Các bước thực hiện bàn giao chi tiết

### BƯỚC 1: Sao lưu toàn vẹn dữ liệu hiện tại
Trước khi thao tác bất kỳ điều gì, hãy xuất toàn bộ dữ liệu SQLite từ D1 Remote về máy:
```powershell
powershell -ExecutionPolicy Bypass -File backup.ps1
```
File SQL sẽ được lưu tại `backups/backup_YYYYMMDD_HHmmss/database_d1.sql`.

---

### BƯỚC 2: Chuyển giao Repository GitHub
- **Cách khuyên dùng (Transfer Ownership)**:
  1. Vào `github.com/trungducnguyen4/nexrall-hr-manager---marketing` -> **Settings**.
  2. Kéo xuống mục **Danger Zone** -> chọn **Transfer ownership**.
  3. Nhập tên tài khoản hoặc Organization GitHub của công ty (ví dụ: `netviettv`).
  4. Xác nhận chuyển giao.
  *(Cách này giữ nguyên 100% commit history, PR, issue và link cũ tự động redirect)*.

- **Đổi remote trên máy**:
  ```powershell
  git remote set-url origin https://github.com/<company-org>/nexrall-hr-manager---marketing.git
  ```

---

### BƯỚC 3: Khởi tạo tài nguyên trên Cloudflare Công ty
1. **Đăng nhập Wrangler bằng tài khoản Cloudflare công ty**:
   ```powershell
   npx wrangler logout
   npx wrangler login
   ```
2. **Tạo Database D1 mới**:
   ```powershell
   npx wrangler d1 create nexrall-hr-manager-prod
   ```
   *Lưu lại `database_id` mới vừa được in ra trên màn hình.*

3. **Tạo R2 Bucket mới**:
   ```powershell
   npx wrangler r2 bucket create netviet-hr-documents
   ```

4. **Cập nhật file `wrangler.toml`**:
   - Cập nhật `database_id` thành ID vừa tạo.
   - Thay `GEMINI_API_KEY` bằng key từ Google AI Studio / Google Cloud của công ty.

5. **Phục hồi dữ liệu vào D1 mới**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File restore.ps1 -DatabaseName nexrall-hr-manager-prod
   ```

6. **Triển khai hệ thống lên Cloudflare công ty**:
   ```powershell
   npm run deploy
   ```

---

### BƯỚC 4: Chuyển Domain & Thu hồi quyền cá nhân
1. **Cấu hình Custom Domain**:
   - Trong dashboard Cloudflare công ty: Vào Worker vừa deploy -> **Settings** -> **Domains & Routes** -> Thêm domain `hrnetviet.live`.
2. **Dọn dẹp tài khoản cá nhân**:
   - Sau khi hệ thống công ty chạy ổn định, xóa Worker, D1 và R2 cũ trên Cloudflare cá nhân để tránh phát sinh chi phí.
   - Xóa thông tin git trên máy nếu bàn giao laptop:
     ```powershell
     git config --global --unset user.name
     git config --global --unset user.email
     ```
3. **Bàn giao tài khoản Admin tối cao**: Bàn giao mật khẩu tài khoản quản trị hệ thống trên web cho Ban Giám Đốc hoặc HCNS.
