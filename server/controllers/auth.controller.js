import { json, err } from '../lib/response.js';
import { AuthService, extractHrToken, resolveSession } from '../services/auth.service.js';

export const AuthController = {
  async login(ctx, rateLimitFn) {
    if (typeof rateLimitFn === 'function') {
      const retryAfter = rateLimitFn(ctx.request, 'login', 10, 60 * 1000);
      if (retryAfter) {
        return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
      }
    }
    const b = await ctx.request.json().catch(() => ({}));
    const res = await AuthService.login(ctx.env, b);
    if (res.error) return err(res.status || 400, res.error);

    const loginHeaders = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    loginHeaders.append('Set-Cookie', `hr_token=${res.token}; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`);
    loginHeaders.append('Set-Cookie', `hr_token=${res.token}; Domain=.netviet.live; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`);
    loginHeaders.append('Set-Cookie', `hr_sso_active=1; Domain=.netviet.live; Path=/; Secure; Max-Age=2592000; SameSite=Lax`);

    return new Response(JSON.stringify(res), { headers: loginHeaders });
  },

  async logout(ctx) {
    const { token } = extractHrToken(ctx.request, ctx.env);
    let bodyToken = null;
    try {
      const bd = await ctx.request.clone().json();
      bodyToken = bd.token || null;
    } catch (_) {}
    const revokeToken = token || (bodyToken && /^[0-9a-f]{64}$/i.test(bodyToken) ? bodyToken.toLowerCase() : null);

    await AuthService.logout(ctx.env, revokeToken);

    const logoutHeaders = new Headers({
      'Content-Type': 'application/json',
    });
    logoutHeaders.append('Set-Cookie', 'hr_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    logoutHeaders.append('Set-Cookie', 'hr_token=; Domain=.netviet.live; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    logoutHeaders.append('Set-Cookie', 'hr_sso_active=; Domain=.netviet.live; Path=/; Max-Age=0; SameSite=Lax');

    return new Response(JSON.stringify({ ok: true }), { headers: logoutHeaders });
  },

  async me(ctx) {
    const { session } = await resolveSession(ctx.request, ctx.env);
    if (!session) return json({ error: 'Chưa đăng nhập', code: 'UNAUTHORIZED' }, 401);

    const userId = session.uid ?? session.id;
    const { token: currentToken } = extractHrToken(ctx.request, ctx.env);

    const meHeaders = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    if (currentToken && /^[0-9a-f]{64}$/i.test(currentToken)) {
      meHeaders.append('Set-Cookie', `hr_token=${currentToken}; Domain=.netviet.live; Path=/; HttpOnly; Secure; Max-Age=2592000; SameSite=Lax`);
      meHeaders.append('Set-Cookie', `hr_sso_active=1; Domain=.netviet.live; Path=/; Secure; Max-Age=2592000; SameSite=Lax`);
    }

    return new Response(JSON.stringify({
      user: {
        id: userId, full_name: session.full_name, email: session.email,
        role: session.role, department: session.department, position: session.position,
        avatar_color: session.avatar_color, avatar_initials: session.avatar_initials, avatar_url: session.avatar_url,
        employee_code: session.employee_code, work_location: session.work_location, salary: session.salary,
        phone: session.phone, bank_account: session.bank_account,
        bank_name: session.bank_name, is_active: session.is_active,
        lifecycle_status: session.lifecycle_status, must_change_password: !!session.must_change_password,
      }
    }), { headers: meHeaders });
  },

  async changePassword(ctx, rateLimitFn) {
    if (typeof rateLimitFn === 'function') {
      const retryAfter = rateLimitFn(ctx.request, 'change-password', 5, 15 * 60 * 1000);
      if (retryAfter) {
        return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
      }
    }
    const { session: cpSession } = await resolveSession(ctx.request, ctx.env);
    const cpUserId = cpSession ? (cpSession.uid ?? cpSession.id) : null;
    if (!cpUserId) return json({ error: 'Chưa đăng nhập' }, 401);

    const b = await ctx.request.json().catch(() => ({}));
    const res = await AuthService.changePassword(ctx.env, cpUserId, b);
    if (res.error) return err(res.status || 400, res.error);

    return json({ ok: true });
  }
};
