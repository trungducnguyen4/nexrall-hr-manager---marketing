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

## Delivery Channels
This report must be provided:
1. In the agent's final chat response to the user.
2. In the `walkthrough.md` artifact (embedding screenshots or video links).
3. In any GitHub Pull Request description (following `.github/PULL_REQUEST_TEMPLATE.md`).
