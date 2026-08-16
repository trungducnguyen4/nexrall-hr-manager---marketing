-- Thêm tài khoản TTS-28 Nguyễn Quang Huy
-- Mật khẩu mặc định: Pass@123 (sẽ yêu cầu đổi khi đăng nhập lần đầu)
-- Ngày tạo: 2026-08-12

INSERT OR IGNORE INTO users (
  employee_code,
  employee_type,
  full_name,
  email,
  password_hash,
  role,
  department,
  position,
  avatar_color,
  avatar_initials,
  phone,
  is_active,
  lifecycle_status,
  work_location,
  hire_date,
  must_change_password,
  profile_pending
) VALUES (
  'TTS-28',
  'TTS',
  'Nguyễn Quang Huy',
  'tts-28@pending.local',
  'b6bc7b58510319a151d168ba3d5aecb3ac0a9708d06dd930f37fbc89b6cdc697',
  'employee',
  'Phòng Marketing',
  'Thực tập sinh',
  '#4F46E5',
  'NH',
  '',
  1,
  'Thực tập',
  'HN',
  '2026-08-12',
  1,
  1
);