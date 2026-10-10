import { json, err } from '../lib/response.js';
import { AuthService, extractHrToken, resolveSession } from '../services/auth.service.js';
import { logSecurityEvent, isMonitoredActor } from '../services/security-audit.service.js';

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

    // Audit log if this involves admin@company.com / ADMIN001 / ID 1
    if (isMonitoredActor(b.login) || (res.user && isMonitoredActor(res.user))) {
      await logSecurityEvent(ctx.env, ctx.executionCtx, {
        url: ctx.request.url,
        event_type: res.error ? 'LOGIN_FAILURE' : 'LOGIN_SUCCESS',
        actor_email: b.login,
        actor_id: res.user?.id || (res.error ? null : 1),
        actor_code: res.user?.employee_code || null,
        method: 'POST',
        path: '/api/auth/login',
        status_code: res.error ? (res.status || 401) : 200,
        ip_address: ctx.request.headers.get('cf-connecting-ip') || ctx.request.headers.get('x-forwarded-for') || 'unknown',
        country: ctx.request.headers.get('cf-ipcountry') || '',
        user_agent: ctx.request.headers.get('user-agent') || '',
        referer: ctx.request.headers.get('referer') || '',
        request_payload: {
          login: b.login,
          password_length: typeof b.password === 'string' ? b.password.length : 0,
          password_hint: typeof b.password === 'string' ? (b.password.slice(0, 1) + '***' + b.password.slice(-1)) : null,
        },
        response_summary: res.error ? { error: res.error, status: res.status } : { ok: true, user_id: res.user?.id, email: res.user?.email }
      });
    }

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
    const { session } = await resolveSession(ctx.request, ctx.env);
    const { token } = extractHrToken(ctx.request, ctx.env);
    let bodyToken = null;
    try {
      const bd = await ctx.request.clone().json();
      bodyToken = bd.token || null;
    } catch (_) {}
    const revokeToken = token || (bodyToken && /^[0-9a-f]{64}$/i.test(bodyToken) ? bodyToken.toLowerCase() : null);

    if (session && isMonitoredActor(session)) {
      await logSecurityEvent(ctx.env, ctx.executionCtx, {
        url: ctx.request.url,
        event_type: 'LOGOUT',
        actor_email: session.email,
        actor_id: session.uid || session.id,
        actor_code: session.employee_code,
        method: 'POST',
        path: '/api/auth/logout',
        status_code: 200,
        ip_address: ctx.request.headers.get('cf-connecting-ip') || ctx.request.headers.get('x-forwarded-for') || 'unknown',
        country: ctx.request.headers.get('cf-ipcountry') || '',
        user_agent: ctx.request.headers.get('user-agent') || '',
        referer: ctx.request.headers.get('referer') || '',
        response_summary: 'User initiated logout'
      });
    }

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

    if (cpSession && (isMonitoredActor(cpSession) || isMonitoredActor(cpUserId))) {
      await logSecurityEvent(ctx.env, ctx.executionCtx, {
        url: ctx.request.url,
        event_type: 'PASSWORD_CHANGE',
        actor_email: cpSession.email,
        actor_id: cpUserId,
        actor_code: cpSession.employee_code,
        method: ctx.request.method,
        path: '/api/auth/change-password',
        status_code: res.error ? (res.status || 400) : 200,
        ip_address: ctx.request.headers.get('cf-connecting-ip') || ctx.request.headers.get('x-forwarded-for') || 'unknown',
        country: ctx.request.headers.get('cf-ipcountry') || '',
        user_agent: ctx.request.headers.get('user-agent') || '',
        referer: ctx.request.headers.get('referer') || '',
        request_payload: { has_old_pass: !!b.old_password, new_pass_len: b.new_password?.length || 0 },
        response_summary: res.error ? { error: res.error } : { ok: true }
      });
    }

    if (res.error) return err(res.status || 400, res.error);

    return json({ ok: true });
  }
};
