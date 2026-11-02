---
name: context-hygiene
description: >-
  Quản lý context window, tối ưu token, và quyết định thời điểm nên chạy /compact trong Antigravity cho dự án NetViet HR Marketing Pro. Hướng dẫn lưu handoff checkpoint 6 mục ra docs/runs/ hoặc docs/handoffs/, kiểm soát trạng thái Git, Cloudflare Workers, Cloudflare D1 Database trước khi nén hoặc chuyển giao phiên làm việc.
whenToUse: >-
  Kích hoạt khi context dài/phình to, sau khi hoàn thành một feature/fix lớn, trước khi chuyển sang phân hệ mới (ví dụ từ Chấm công sang Tính lương), khi agent bắt đầu quên ràng buộc kiến trúc, hoặc khi user hỏi về việc compact/mở session mới.
---

# Context Hygiene — NetViet HR Marketing Pro

Quản lý ngữ cảnh và tối ưu hóa token cho quy trình Pair-Programming trên nền tảng **Antigravity (Gemini)**. Giữ cho trợ lý luôn nhạy bén, không bị trôi ràng buộc nghiệp vụ HR, bảo toàn thông tin triển khai Cloudflare Workers & D1.

---

## 1. Nguyên tắc cốt lõi (TL;DR)

1. **Auto-compact chỉ là lưới an toàn, KHÔNG PHẢI kế hoạch**: Không chờ ngữ cảnh đầy tới mức mô hình suy giảm khả năng suy luận. Khi phiên làm việc đạt độ dài lớn hoặc vừa xong 1 mốc quan trọng, chủ động chốt handoff.
2. **Agent KHÔNG thể tự động kích hoạt `/compact`**: Lệnh slash command `/compact` là do người dùng gõ trên giao diện chat. Agent có trách nhiệm: **Chuẩn bị handoff bền vững ra file $\rightarrow$ Báo người dùng bấm `/compact` $\rightarrow$ Đối chiếu checkpoint sau khi nén**.
3. **"Nén bằng Artifact/File" trước khi nén hội thoại**: Tất cả thông tin quan trọng (file đã sửa, mã SQL đã chạy trên D1, URL worker demo, diff logic) phải được lưu vào file markdown tại `docs/runs/` hoặc `docs/handoffs/`.
4. **Giữ Git và Workers sạch trước khi compact**: Không bao giờ compact khi đang có file sửa dở chưa test hoặc chưa xác định rõ trạng thái.

---

## 2. Khi nào NÊN đề nghị `/compact`

- **Vừa hoàn thành 1 User Story / Bug Fix**: Ví dụ: Fix xong lỗi Copilot action navigation, chạy `npm test` xanh, deploy demo lên Cloudflare Workers thành công.
- **Chuẩn bị chuyển phân hệ nghiệp vụ lớn**: Ví dụ: Xong phân hệ **Chấm công GPS/Wifi** $\rightarrow$ Chuẩn bị sang phân hệ **Tính lương & BHXH**. Việc nén giúp loại bỏ các log/trace cũ của phân hệ trước.
- **Sau chuỗi thao tác ngốn nhiều token**: Đọc log D1 dài hàng trăm dòng, query SQL lớn, grep toàn bộ thư mục `src/views/` hoặc `server/services/`.
- **Tín hiệu suy giảm nhận thức**: Agent bắt đầu đọc lại file vừa sửa, quên role matrix (admin, BGD, HCNS, manager, employee), hoặc hỏi lại điều người dùng đã xác nhận.

---

## 3. Khi nào KHÔNG NÊN `/compact`

- Đang giữa chừng xử lý lỗi (chưa xác định nguyên nhân hoặc đang sửa dở dang các hàm liên quan).
- Cần đối chiếu nguyên văn chuỗi lỗi, payload API, hoặc token/key vừa sinh ra mà chưa kịp lưu ra file.
- Vừa mới compact xong cách đây vài lượt hội thoại.
- Phiên mới bắt đầu hoặc context còn rất ngắn.

---

## 4. Quy trình bàn giao trước khi Compact (Bắt buộc)

Trước khi đề xuất người dùng gõ `/compact`, Agent **bắt buộc thực hiện 4 bước sau**:

### Bước 1: Kiểm tra trạng thái Git & Build
```powershell
git status
npm test
```
Đảm bảo các file đã sửa chạy test không bị break, xác định rõ file nào đã commit, file nào còn uncommitted.

### Bước 2: Kiểm tra trạng thái Cloudflare Workers & D1
- Nếu có sửa đổi file frontend (`src/`, `styles/`, `index.html`), ghi chú xem đã chạy `node scripts/sync-public.mjs` chưa.
- Nếu có cập nhật schema SQLite D1, ghi chú rõ tên migration file hoặc script (`scripts/d1-schema.sql`, `scripts/seed-d1.sql`).
- Ghi nhận URL worker demo hiện tại (`https://nexrall-hr-demo.netviet-hr-ios.workers.dev`).

### Bước 3: Ghi nhận Handoff Checkpoint vào file
Tạo hoặc cập nhật file: `docs/runs/<YYYY-MM-DD>-<task-name>.md` theo khuôn 6 mục chuẩn:

```markdown
# Handoff: [Tên Task / Bug Fix] - [YYYY-MM-DD]

## 1. Mục tiêu công việc
- Tóm tắt mục tiêu ngắn gọn trong 1-2 câu.

## 2. Việc đã hoàn thành & Minh chứng xác minh
- Danh sách công việc đã làm.
- Minh chứng lệnh: `npm test` (kết quả pass/fail), HTTP status API, URL màn hình test.

## 3. Quyết định kiến trúc & Lưu ý đặc thù
- Giải thích vì sao chọn cách giải quyết này (ví dụ: dùng Event Delegation trong Vanilla JS thay vì addEventListener rời; fallback R2 khi thiếu bucket).
- Ràng buộc nghiệp vụ HR (phân quyền Role, logic chấm công 0.5/1 công, geofence radius).

## 4. Danh sách file chính xác đã sửa / tạo mới
- `src/copilot.js`: ...
- `server/services/attendance.service.js`: ...
- `scripts/sync-public.mjs`: ...

## 5. Trạng thái hiện tại & Lỗi đang mở (nếu có)
- Trạng thái git (commit hash, branch).
- Bất kỳ lỗi nào còn tồn đọng hoặc cảnh báo cần xử lý tiếp.

## 6. Bước hành động tiếp theo duy nhất
- Nhiệm vụ cụ thể, rõ ràng cho lượt làm việc kế tiếp.
```

### Bước 4: Thông báo cho Người dùng
Xuất thông điệp ngắn gọn:
> *"Tôi đã ghi nhận toàn bộ tiến độ, quyết định kiến trúc và danh sách file đã sửa vào `docs/runs/<filename>.md`. Ngữ cảnh phiên đã tương đối dài, bạn có thể gõ `/compact` để làm gọn bộ nhớ và tiếp tục bước tiếp theo."*

---

## 5. Kiểm tra sau khi Compact (Post-Compaction Checkpoint)

Ngay sau khi người dùng compact, Agent phải:
1. Đọc lại nội dung tóm tắt trong ngữ cảnh.
2. Nếu tóm tắt thiếu các ràng buộc quan trọng (Role Matrix, Cloudflare Worker binding, D1 Database ID), trích xuất nhanh từ file handoff vừa ghi để khôi phục trạng thái chuẩn xác.
3. Không tự ý thực hiện hành động phá hủy (`git reset --hard`, xóa database tables) nếu chưa xác minh lại trạng thái với handoff file.

---

## 6. Checklist nhanh
- [ ] `git status` được kiểm tra rõ ràng.
- [ ] `npm test` đã chạy và xác nhận kết quả.
- [ ] File handoff tại `docs/runs/<date>-<task>.md` đã ghi đủ 6 mục.
- [ ] Nhắc người dùng gõ `/compact`.
- [ ] Khôi phục định hướng ngay sau khi nén thành công.
