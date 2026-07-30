import { handle } from './server.js';

function secureAssetResponse(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (pathname === '/' || pathname.endsWith('.html')) {
    headers.set('Cache-Control', 'no-store, max-age=0');
    // The UI is a module SPA and currently loads a vetted logo from R2.
    headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https://pub-84c3902526ad4c82b488275b43b39e3a.r2.dev https://api.vietqr.io data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handle(request, env);
      } catch (error) {
        const errorId = crypto.randomUUID();
        console.error('Unhandled API error', { errorId, path: url.pathname, message: String(error?.message || error), stack: error?.stack });
        return new Response(JSON.stringify({ error: `Không thể xử lý yêu cầu. Mã tham chiếu: ${errorId}`, code: 'UNEXPECTED_API_ERROR', error_id: errorId }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
          },
        });
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return secureAssetResponse(assetResponse, url.pathname);
    if (url.pathname.includes('.')) return secureAssetResponse(assetResponse, url.pathname);

    const indexUrl = new URL('/index.html', url);
    return secureAssetResponse(await env.ASSETS.fetch(new Request(indexUrl, request)), '/index.html');
  },
};
