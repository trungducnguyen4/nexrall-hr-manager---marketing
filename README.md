# NetViet HR Pro — Hệ Thống Quản Trị Nhân Sự & AI Copilot Doanh Nghiệp

[![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-Cloudflare%20D1%20SQLite-blue.svg)](https://developers.cloudflare.com/d1/)
[![AI Engine](https://img.shields.io/badge/AI-Multi--Provider%20Gateway%20%26%20Agents-green.svg)](https://ai.google.dev/)
[![Live Demo](https://img.shields.io/badge/Demo-hrnetviet.live-red.svg)](https://hrnetviet.live)

Hệ sinh thái quản trị nhân sự toàn diện tích hợp **Enterprise AI Copilot** vận hành trên nền tảng Serverless Edge (Cloudflare Workers + D1 + R2 + Durable Objects).

---

## 🚀 Tài Liệu Hướng Dẫn Nhanh Dành Cho Lập Trình Viên

Nếu bạn vừa được mời vào dự án hoặc vừa kéo mã nguồn về máy:

👉 **Xem tài liệu chi tiết tại đây:** [**`DEVELOPER_GUIDE.md`**](./DEVELOPER_GUIDE.md)

Tài liệu bao gồm:
1. Cách cài đặt môi trường và clone dự án (`git clone`, `npm install`).
2. Hướng dẫn chạy thử trên máy tính cá nhân (`npm run dev`).
3. Cấu trúc thư mục (Quy tắc bắt buộc: sửa code tại `src/` và `styles/`, không sửa `.local-public/`).
4. Bộ lệnh kiểm thử tự động (`npm test`, `npm run test:ai-security`, `npm run test:ai-agent`, `npm run test:ai-stream`).
5. Hướng dẫn deploy lên Cloudflare (`npm run deploy`).
6. Thao tác sao lưu và truy vấn dữ liệu Cloudflare D1 Database.

---

## 🛠️ Các Lệnh Thường Dùng (Quick Commands)

```bash
# 1. Chạy local dev
npm run dev

# 2. Chạy toàn bộ kiểm thử
npm test

# 3. Sao lưu Database D1
npm run backup

# 4. Deploy lên Cloudflare Workers
npm run deploy
```

---

## 📚 Tài Liệu Bàn Giao Kỹ Thuật

* Quy trình chuyển giao quyền sở hữu tài nguyên Cloudflare & Git: [**`docs/HANDOVER_GUIDE.md`**](./docs/HANDOVER_GUIDE.md)
* Báo cáo kiểm toán kiến trúc AI Production-Grade: [**`DEVELOPER_GUIDE.md`**](./DEVELOPER_GUIDE.md)
