# Rule: Multi-Agent Pre-Launch Attack Squad

## Core Philosophy
Trước bất kỳ đợt launch, release hoặc merge mã nguồn quan trọng nào, toàn bộ hệ thống phải trải qua một đợt tổng tấn công mô phỏng bởi **Biệt đội 4 Tác nhân (Attack Squad)**.

---

## 4 Attack Angles

```
┌────────────────────────────────────────────────────────┐
│             PRE-LAUNCH ATTACK SQUAD                    │
├──────────────────────────┬─────────────────────────────┤
│ 1. Features              │ 2. Bugs (Chaos & Edge)      │
│    Run every user flow   │    Explore weird states     │
├──────────────────────────┼─────────────────────────────┤
│ 3. Performance           │ 4. Security                 │
│    Profile slow paths    │    Probe inputs, permissions│
└──────────────────────────┴─────────────────────────────┘
```

### 1. 🧭 Feature Navigator
- Chạy qua toàn bộ hành trình người dùng chính (Login, Dashboard, Navigation, Form submissions, Export).
- Phát hiện bất kỳ dead link, nút bấm không hoạt động hoặc trang lỗi nào.

### 2. 🐒 Chaos Monkey & Edge Hunter
- Kiểm tra các trạng thái biên dị thường:
  - Submit form nhiều lần liên tiếp (double click / concurrency).
  - Tải file 0KB, payload unicode siêu dài, ký tự lạ (`<script>`, SQL fragments).
  - BẮT BUỘC chụp Screenshot nếu phát hiện giao diện bị vỡ layout hoặc crash trắng màn hình.

### 3. ⚡ Performance Profiler
- Đo TTFB và độ trễ phản hồi của các API chính (ngưỡng cảnh báo: > 500ms).
- Kiểm tra kích thước asset tĩnh (JS bundles, CSS, ảnh).
- Phát hiện tài nguyên bị phình to hoặc tải chậm bất thường.

### 4. 🛡️ Security Auditor
- Kiểm tra vượt quyền (IDOR / Broken Access Control): User thường không thể gọi endpoint của Admin.
- Fuzzing tham số tìm lỗi SQL Injection / XSS.
- Rà quét tự động chống lộ API Key, Secret Token, Private Credentials trong bundle mã nguồn.

---

## 🚦 Gate Policy (Quy tắc Chặn Release)
- 🔴 **BLOCK (Thất bại / Hủy release)**: Nếu phát hiện bất kỳ lỗi bảo mật High/Critical hoặc sập luồng người dùng cốt lõi.
- 🟡 **WARNING (Cảnh báo)**: Điểm nghẽn hiệu năng hoặc lỗi giao diện nhỏ.
- 🟢 **PASS**: Hoàn thành toàn diện 4 góc tấn công an toàn.
