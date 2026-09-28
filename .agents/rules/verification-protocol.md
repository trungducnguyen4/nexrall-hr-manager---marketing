# Rule: Verification Protocol — "Prove the Change and Report Confidence"

## Core Philosophy
Every code modification, feature addition, or bugfix must be proved before being declared complete.
Never say "it should work" or assume success without tangible evidence.

After completing any change, the agent must output a structured verification report matching the **4 Pillars**:

---

## The 4 Pillars Format

### 1. Tests (Focused Logic and Integration Checks)
- **Syntax Check**: Full project check via `node --check` across key entry points.
- **Unit & Smoke Tests**: Results of `npm test` or specific subsystem test suites.
- State clearly: Total assertions passed, execution duration, and zero regression.

### 2. Runtime (Use the Actual Feature End to End)
- Execute real backend APIs or local runtime functions.
- Verify status codes (e.g. HTTP 200/201), response times, and payloads.
- Verify database state/persistence (query D1/SQLite to confirm data was actually written).

### 3. Visual (Inspect What the User Will See)
- **Chỉnh sửa Giao diện / Component (UI Changes)**:
  - **BẮT BUỘC chụp ảnh màn hình (Screenshot)** đính kèm vào báo cáo.
  - Kiểm tra và thể hiện rõ các trạng thái: Normal, Empty state, Loading, Active, Mobile responsive.
- **Luồng người dùng / Quy trình nhiều bước (User Flows / Multi-step Journey)**:
  - **BẮT BUỘC quay video màn hình (Screen Recording Video / GIF)** hoặc carousel tuần tự các bước thể hiện trọn vẹn hành trình người dùng (thao tác click, mở modal, submit, chuyển trang, thông báo thành công).
- **Chỉnh sửa Backend / API thuần (Backend only)**:
  - Mô tả hoặc minh họa chính xác thành phần giao diện bị tác động (Toast thông báo, Modal cảnh báo, cột dữ liệu cập nhật trên bảng).

### 4. Confidence (State What Was Verified — and What Was Not)
- **Confidence Level**: High / Medium / Low with explicit justification.
- **What Was Verified**: Bullet points of concrete behaviors proven with evidence.
- **What Was NOT Verified**: Unproven boundary conditions, hardware-dependent features (e.g. real GPS on physical mobile device, iOS Capacitor push token, camera permissions), or third-party dependencies requiring manual operator action.

---

---

## 🧐 Fresh-Context AI Code Review (Review Độc Lập Ngăn Chặn Confirmation Bias)
Trước khi commit & push, bắt buộc phải có một bước review bằng **Fresh Context** (ngữ cảnh sạch hoàn toàn độc lập với agent viết code):
- **Cơ chế**: Spawn một Subagent Reviewer độc lập (hoặc reviewer prompt biệt lập) chỉ nhận 2 đầu vào: **Yêu cầu của người dùng** và **Bản `git diff` thực tế**.
- **Tiêu chí phản biện khắt khe**:
  1. **Logic & Regressions**: Có thay đổi nào vô tình làm vỡ các module lân cận không?
  2. **Security & Secrets**: Có lộ biến môi trường, private keys, API tokens hay tạo lỗ hổng SQLi/XSS không?
  3. **Code Cleanliness**: Có console.log rác, mock data tạm thời chưa xóa hay code thừa không?
- **Quy tắc Gate**: Nếu Reviewer phát hiện lỗi (`REQUEST_CHANGES`), agent viết code phải khắc phục trước. Chỉ khi Reviewer xác nhận `APPROVED` thì mới đủ điều kiện bước sang Commit & Push.

---

## Delivery Channels & Workflow
Quy trình này phải được thực thi khép kín:
1. Xuất báo cáo 4 Trụ Cột (Tests, Runtime, Visual [ảnh/video], Confidence).
2. **AI REVIEW IN FRESH CONTEXT**: Chạy kiểm duyệt độc lập trên bản `git diff` để đảm bảo 0 lỗi hồi quy và 0 lỗ hổng bảo mật.
3. Cập nhật artifact `walkthrough.md` (đính kèm Screenshots/Video & kết luận của Reviewer).
4. **TỰ ĐỘNG COMMIT & PUSH**: Sau khi đã PASS cả 4 Trụ Cột và được Fresh-Context Reviewer `APPROVED`, AI BẮT BUỘC commit với conventional message và push trực tiếp lên repository (`origin main`).
5. Điền nội dung báo cáo vào GitHub Pull Request description nếu tạo PR (theo mẫu `.github/PULL_REQUEST_TEMPLATE.md`).
