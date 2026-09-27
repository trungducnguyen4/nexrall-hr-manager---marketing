# Hướng dẫn Cấu hình GitHub Actions CI/CD cho Dự án NetViet HR

Hệ thống CI/CD đã được cấu hình tự động:
1. **Kiểm thử tự động (CI)**: Mỗi khi tạo Pull Request hoặc Push code, GitHub Actions sẽ tự động kiểm tra cú pháp và chạy bộ kiểm thử (`npm test`).
2. **Triển khai tự động (CD)**: Khi code được merge/push vào nhánh `main` (hoặc khi bấm chạy thủ công), GitHub Actions sẽ tự động build tài nguyên frontend và deploy lên Cloudflare Workers.

Để hoàn tất, bạn chỉ cần thực hiện 2 bước đơn giản bên dưới để cấp quyền deploy cho GitHub.

---

## Bước 1: Tạo Cloudflare API Token

1. Đăng nhập vào [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Nhấp vào biểu tượng tài khoản cá nhân ở góc trên bên phải > chọn **My Profile** (Hồ sơ của tôi).
3. Chọn mục **API Tokens** ở menu bên trái (hoặc truy cập trực tiếp: `https://dash.cloudflare.com/profile/api-tokens`).
4. Nhấp vào nút **Create Token**.
5. Tại mục **Edit Cloudflare Workers**, nhấp chọn **Use template**.
6. Ở phần cấu hình quyền:
   - **Account Resources**: Chọn `All accounts` (hoặc tài khoản chứa Worker dự án NetViet).
   - **Zone Resources**: Chọn `All zones` (hoặc zone tương ứng nếu có).
   - *(Đảm bảo có các quyền Workers Scripts: Edit, D1: Edit, R2: Edit nếu quản trị đa dịch vụ)*.
7. Cuộn xuống cuối trang và nhấp **Continue to summary** > **Create Token**.
8. **Sao chép mã API Token** vừa tạo *(lưu ý Cloudflare chỉ hiển thị mã token này một lần duy nhất)*.

---

## Bước 2: Thêm Secret vào GitHub Repository

1. Mở trang repository GitHub của dự án:
   `https://github.com/trungducnguyen4/nexrall-hr-manager---marketing`
2. Nhấp vào tab **Settings** (Cài đặt) của repository.
3. Ở menu bên trái, tìm mục **Secrets and variables** > nhấp chọn **Actions**.
4. Nhấp vào nút **New repository secret** (màu xanh lá cây).
5. Điền thông tin:
   - **Name**: `CLOUDFLARE_API_TOKEN` *(viết hoa chính xác tên này)*.
   - **Secret**: Dán mã API Token bạn vừa sao chép ở Bước 1 vào đây.
6. Nhấp **Add secret** để lưu lại.

---

## Bước 3: Kiểm tra luồng hoạt động

- **Kích hoạt tự động**: Sau khi cấu hình xong, mỗi lần bạn `git push` code lên nhánh `main`, GitHub Actions sẽ tự động kích hoạt tiến trình Test & Deploy.
- **Kích hoạt thủ công**:
  1. Vào tab **Actions** trên GitHub repository.
  2. Ở danh sách bên trái, chọn workflow **CI/CD Pipeline**.
  3. Nhấp vào nút **Run workflow** > chọn nhánh `main` > nhấp **Run workflow**.
- Bạn có thể xem log trực tiếp và kết quả deploy ngay trên giao diện GitHub.
