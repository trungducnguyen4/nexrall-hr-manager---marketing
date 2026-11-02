---
name: attack-squad
description: >-
  Chiến dịch Giả lập Tấn công Toàn diện (Pre-Launch Attack Squad) trước mỗi đợt Release/Deploy trong NetViet HR Marketing Pro. Biệt đội 4 Tác nhân (Feature Navigator, Chaos Monkey & Edge Hunter, Performance Profiler, Security Auditor) giả lập các tình huống tấn công: bypass GPS geofence, leo quyền IDOR/Role Matrix, race condition double check-in, rò rỉ bí mật Cloudflare/JWT, và nghẽn tài nguyên.
whenToUse: >-
  Kích hoạt khi: chuẩn bị release phiên bản mới; kiểm tra độ tin cậy bảo mật trước khi bàn giao; giả lập tấn công thử nghiệm hệ thống chấm công, tính lương, duyệt đơn; hoặc khi người dùng yêu cầu "chạy attack squad", "kiểm tra bảo mật", "giả lập tấn công".
---

# Pre-Launch Attack Squad — NetViet HR Marketing Pro

Quy chuẩn kích hoạt **Biệt đội Giả lập Tấn công (Attack Squad)** trước bất kỳ đợt Launch, Release, hoặc Triển khai chính thức nào trên hệ sinh thái **NetViet HR Marketing Pro**. 

Thay vì chỉ kiểm thử đơn vị thông thường (`unit test`), hệ thống phải vượt qua một đợt "tổng tấn công có kiểm soát" từ 4 góc độ mô phỏng các hành vi phá hoại hoặc lỗi thực tế của người dùng cuối.

---

## 1. Bốn Mũi Nhọn Giả Lập Tấn Công (The 4 Attack Vectors)

```
┌────────────────────────────────────────────────────────────────────────┐
│             PRE-LAUNCH ATTACK SQUAD — NETVIET HR                       │
├───────────────────────────────────┬────────────────────────────────────┤
│ 1. 🧭 Feature Navigator           │ 2. 🐒 Chaos Monkey & Edge Hunter   │
│    Rà quét toàn bộ luồng User Flow│    Bẻ gãy trạng thái biên & Race   │
├───────────────────────────────────┼────────────────────────────────────┤
│ 3. ⚡ Performance Profiler        │ 4. 🛡️ Security Auditor             │
│    Đo độ trễ API & Kích thước PWA │    Leo quyền, Fake GPS, Lộ Secret  │
└───────────────────────────────────┴────────────────────────────────────┘
```

### 1. 🧭 Feature Navigator (Rà quét Luồng Người Dùng)
- **Hành vi giả lập**: Đóng vai tất cả các vai trò (Nhân viên, Quản lý, HCNS, Ban Giám Đốc, Admin) và duyệt qua 100% các Hash Route:
  - `#/dashboard`, `#/attendance`, `#/leave`, `#/payroll`, `#/approvals`, `#/users`, `#/chat`, `#/settings`.
- **Mục tiêu phát hiện**:
  - Các liên kết hỏng (`dead links`), nút bấm click không phản hồi.
  - Các thẻ `<a>` vô tình gắn nhầm class hành động khiến AI Copilot trigger nhầm action (`btn-confirm-action` vs `btn-nav-action`).
  - Lỗi màn hình trắng (Blank page) do thiếu data handler hoặc lỗi cú pháp JS client.

### 2. 🐒 Chaos Monkey & Edge Hunter (Tấn công Trạng thái Biên & Xung đột)
- **Hành vi giả lập**:
  - **Tấn công Chấm công liên tiếp (Double Check-in Race Condition)**: Gửi 2–3 request check-in cùng 1 giây xem backend có bị nhân đôi bản ghi công không.
  - **Payload rác & Siêu dài**: Điền vào form xin nghỉ phép lý do dài 10.000 ký tự, chứa emoji, ký tự Unicode đặc biệt hoặc chuỗi HTML (`<script>alert(1)</script>`).
  - **File rác đính kèm**: Upload file 0KB, file giả đuôi ảnh (PDF đổi tên thành `.png`) vào form minh chứng WFH/OT.
  - **Chụp màn hình khi vỡ giao diện**: Phát hiện các lỗi tràn dòng bảng dữ liệu hoặc modal bị kẹt trên mobile.

### 3. ⚡ Performance Profiler (Thắt nút Cổ chai & Hiệu năng)
- **Hành vi giả lập**:
  - Đo độ trễ phản hồi của Cloudflare Workers API:
    - `/api/attendance/history`: Target $< 300\text{ms}$.
    - `/api/payroll/summary`: Target $< 400\text{ms}$.
    - `/api/ai/copilot/chat`: Target streaming $< 1.5\text{s}$ phản hồi đầu tiên.
  - Kiểm tra kích thước thư mục tài nguyên tĩnh `.local-public`: Cảnh báo nếu file JS/CSS phình to bất thường do chứa file thừa từ server.
  - Đảm bảo các bảng SQLite trong Cloudflare D1 có chỉ mục (`INDEX`) ở các cột lọc thường xuyên: `user_id`, `department_id`, `date`, `status`.

### 4. 🛡️ Security Auditor (Giả lập Tấn công Xâm nhập & Đánh cắp Dữ liệu)
- **Hành vi giả lập**:
  - **Tấn công Vượt quyền (IDOR & Broken Role Matrix)**:
    - Nhân viên thường (`role: employee`) gửi request sửa bảng lương của người khác: `PUT /api/payroll/576`.
    - Trưởng phòng A phê duyệt đơn xin nghỉ phép của nhân viên phòng B.
    - Token giả mạo hoặc hết hạn: Backend bắt buộc trả về `401 Unauthorized` hoặc `403 Forbidden`.
  - **Giả lập Hack Tọa độ Chấm công (GPS Spoofing)**:
    - Gửi tọa độ nằm ngoài bán kính văn phòng 200m (ví dụ: Hà Nội trong khi văn phòng ở HCM).
    - Hệ thống bắt buộc gắn cờ `flagged_for_review` hoặc từ chối nếu không có đơn WFH được duyệt.
  - **Quét rò rỉ Bí mật (Secret Leaks Scanner)**:
    - Quét toàn bộ thư mục `.local-public`, `src/`, `styles/` để đảm bảo **KHÔNG CÓ**: `CLOUDFLARE_API_TOKEN`, `JWT_SECRET`, `GEMINI_API_KEY`, `wrangler.toml`, `server.js`.

---

## 2. Quy trình Thực thi Lệnh Giả Lập Tấn Công

Bộ script tấn công tự động được tích hợp tại thư mục `scripts/attack/`:

```powershell
# Chạy toàn bộ 4 mũi nhọn giả lập tấn công
node scripts/attack/run-all.mjs

# Hoặc chạy kiểm tra từng mũi nhọn riêng lẻ:
node scripts/attack/audit-features.mjs   # Mũi 1: Feature Navigator
node scripts/attack/audit-chaos.mjs      # Mũi 2: Chaos & Edge
node scripts/attack/audit-perf.mjs       # Mũi 3: Performance Profiler
node scripts/attack/audit-security.mjs   # Mũi 4: Security Auditor
```

---

## 3. Quy tắc Chặn Xuất xưởng (Release Gate Policy)

Kết quả từ Attack Squad quyết định trực tiếp việc triển khai:

| Mức độ | Trạng thái | Hành động bắt buộc |
|---|---|---|
| 🔴 **CRITICAL / HIGH** | **BLOCK (Chặn đứng)** | **Hủy bỏ ngay đợt Release/Deploy.** Lỗ hổng bảo mật (lộ JWT, bypass được GPS, nhân viên xem được lương người khác, crash luồng check-in). Bắt buộc sửa và chạy lại toàn bộ squad. |
| 🟡 **MEDIUM / LOW** | **WARNING (Cảnh báo)** | Ghi nhận vào backlog. Cho phép release nếu người dùng đồng ý và không ảnh hưởng dữ liệu cốt lõi (ví dụ: một thẻ icon căn lệch nhẹ hoặc thời gian phản hồi D1 hơi chậm). |
| 🟢 **ALL CLEAR** | **PASSED (Thông qua)** | Hệ thống đạt tiêu chuẩn kiên cố cao. Đủ điều kiện tạo tag release và đẩy lên production. |

---

## 4. Checklist nghiệm thu sau đợt Tấn công
- [ ] Chạy `node scripts/attack/run-all.mjs` đạt kết quả **PASSED**.
- [ ] Xác nhận không có Secret Token nào lọt vào thư mục web `.local-public`.
- [ ] Kiểm tra cơ chế chống Race Condition check-in hoạt động tốt.
- [ ] Xác minh ma trận phân quyền 5 tầng vai trò không bị rò rỉ dữ liệu.
