/**
 * Auth Service
 * Xử lý băm mật khẩu, token, session, và xác thực người dùng
 */

export async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 20) return 'Mật khẩu phải có từ 8 đến 20 ký tự';
  if (!/[A-Z]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ in hoa';
  if (!/[a-z]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ thường';
  if (!/[0-9]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ số';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'Mật khẩu phải có ít nhất 1 ký tự đặc biệt';
  if (/\s/.test(password)) return 'Mật khẩu không được chứa khoảng trắng';
  return null;
}

export function genToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function extractHrToken(request, env = {}) {
  const isHex64 = (s) => /^[0-9a-f]{64}$/i.test((s || '').trim());

  // a) X-Auth-Token header
  const xat = (request.headers.get('X-Auth-Token') || '').trim();
  if (xat) return { token: isHex64(xat) ? xat.toLowerCase() : null, hasAuthHint: true };

  // b) Query-string tokens (development only)
  try {
    if (env.ALLOW_QUERY_TOKEN === '1') {
      const sp = new URL(request.url).searchParams;
      const qt = (sp.get('token') || sp.get('useToken') || '').trim();
      if (qt) return { token: isHex64(qt) ? qt.toLowerCase() : null, hasAuthHint: true };
    }
  } catch (_) {}

  // c) Authorization header
  const auth = (request.headers.get('Authorization') || '').trim();
  if (auth) {
    const s1 = auth.match(/^Bearer\s+([0-9a-f]{64})\s*$/i);
    if (s1) return { token: s1[1].toLowerCase(), hasAuthHint: true };
    const parts = auth.split(/[^0-9a-fA-F]+/);
    for (const part of parts) {
      if (part.length === 64 && isHex64(part)) {
        return { token: part.toLowerCase(), hasAuthHint: true };
      }
    }
    if (isHex64(auth)) return { token: auth.toLowerCase(), hasAuthHint: true };
  }

  // d) Cookie hr_token
  const cookie = request.headers.get('Cookie') || '';
  const cm = cookie.match(/hr_token=([0-9a-f]{64})/i);
  if (cm) return { token: cm[1].toLowerCase(), hasAuthHint: true };

  return { token: null, hasAuthHint: false };
}

export async function getSessionFromToken(token, env) {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT s.*, u.id as uid, u.full_name, u.email, u.role, u.department, u.position,' +
      ' u.avatar_color, u.avatar_initials, u.avatar_url, u.work_location, u.employee_code, u.salary, u.phone,' +
      ' u.bank_account, u.bank_name, u.is_active, u.lifecycle_status, u.must_change_password' +
      ' FROM sessions s JOIN users u ON s.user_id = u.id' +
      " WHERE s.token=? AND s.revoked=0 AND CAST(s.expires_at AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)"
    ).bind(token).first();
    return row;
  } catch (e) {
    console.error('getSession error:', e.message);
    return null;
  }
}

export async function resolveSession(request, env) {
  const { token, hasAuthHint } = extractHrToken(request, env);

  if (!hasAuthHint) return { session: null, explicitBadToken: false };

  if (token) {
    const session = await getSessionFromToken(token, env);
    if (session) return { session, explicitBadToken: false };
  }

  return { session: null, explicitBadToken: true };
}

export async function getPlatformUser(env) {
  const platformUid = env.USER_ID || '';
  const isOwner = platformUid && platformUid !== 'anon' && platformUid === env.OWNER_ID;

  if (platformUid && platformUid !== 'anon') {
    const byPlatform = await env.DB.prepare(
      "SELECT * FROM users WHERE employee_code=? AND is_active=1 LIMIT 1"
    ).bind('PLATFORM_' + platformUid).first();
    if (byPlatform) {
      return {
        uid: byPlatform.id, full_name: byPlatform.full_name, email: byPlatform.email,
        role: isOwner ? 'admin' : byPlatform.role,
        department: byPlatform.department, position: byPlatform.position,
        avatar_color: byPlatform.avatar_color, avatar_initials: byPlatform.avatar_initials, avatar_url: byPlatform.avatar_url,
        employee_code: byPlatform.employee_code, salary: byPlatform.salary,
        phone: byPlatform.phone, bank_account: byPlatform.bank_account,
        bank_name: byPlatform.bank_name, is_active: byPlatform.is_active,
        lifecycle_status: byPlatform.lifecycle_status,
      };
    }
  }

  const adminUser = await env.DB.prepare(
    "SELECT * FROM users WHERE role='admin' AND is_active=1 LIMIT 1"
  ).first();
  if (!adminUser) return null;

  return {
    uid: adminUser.id,
    full_name: adminUser.full_name,
    email: adminUser.email,
    role: 'admin',
    department: adminUser.department,
    position: adminUser.position,
    avatar_color: adminUser.avatar_color,
    avatar_initials: adminUser.avatar_initials,
    avatar_url: adminUser.avatar_url,
    employee_code: adminUser.employee_code,
    salary: adminUser.salary,
    phone: adminUser.phone,
    bank_account: adminUser.bank_account,
    bank_name: adminUser.bank_name,
    is_active: adminUser.is_active,
    lifecycle_status: adminUser.lifecycle_status,
  };
}

export const AuthService = {
  async login(env, { login, password }) {
    if (!login || !password) return { error: 'Vui lòng nhập đầy đủ thông tin', status: 400 };
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE (email=? OR employee_code=?) AND is_active=1'
    ).bind(login, login).first();
    if (!user) return { error: 'Tài khoản không tồn tại hoặc đã bị khóa', status: 401 };

    const hash = await hashPassword(password);
    if (hash !== user.password_hash) return { error: 'Mật khẩu không đúng', status: 401 };

    const token = genToken();
    const expiresAt = Math.floor(Date.now() / 1000) + 8 * 3600; // Unix epoch, 8h from now
    await env.DB.prepare('INSERT INTO sessions (user_id,token,expires_at,revoked) VALUES (?,?,?,0)')
      .bind(user.id, token, expiresAt).run();

    const userData = {
      id: user.id, full_name: user.full_name, email: user.email,
      role: user.role, department: user.department, position: user.position,
      avatar_color: user.avatar_color, avatar_initials: user.avatar_initials, avatar_url: user.avatar_url,
      employee_code: user.employee_code, work_location: user.work_location, salary: user.salary, phone: user.phone,
      bank_account: user.bank_account, bank_name: user.bank_name,
      lifecycle_status: user.lifecycle_status, must_change_password: !!user.must_change_password,
    };

    return { token, user: userData };
  },

  async logout(env, revokeToken) {
    if (revokeToken) {
      await env.DB.prepare('UPDATE sessions SET revoked=1 WHERE token=?').bind(revokeToken).run();
      await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(revokeToken).run();
    }
    return { ok: true };
  },

  async changePassword(env, userId, { old_password, new_password }) {
    if (!old_password || !new_password) return { error: 'Thiếu thông tin', status: 400 };
    const passwordError = validatePasswordPolicy(new_password);
    if (passwordError) return { error: passwordError, status: 400 };

    const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!user) return { error: 'Không tìm thấy tài khoản', status: 404 };

    const oldHash = await hashPassword(old_password);
    if (oldHash !== user.password_hash) return { error: 'Mật khẩu cũ không đúng', status: 400 };

    const newHash = await hashPassword(new_password);
    await env.DB.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').bind(newHash, userId).run();
    return { ok: true };
  }
};
