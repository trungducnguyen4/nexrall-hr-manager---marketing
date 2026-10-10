/**
 * Security Audit Service
 * Chuyên trách giám sát, ghi nhận và đồng bộ vết hoạt động của tài khoản admin@company.com / ADMIN001
 * giữa Production (hr.netviet.live) và Demo Worker (nexrall-hr-demo).
 */

export const AUDIT_SHARED_SECRET = 'netviet_audit_sec_2026_99x';
export const DEMO_AUDIT_ENDPOINT = 'https://nexrall-hr-demo.netviettv-hr-manager.workers.dev/api/audit/ingest';

/**
 * Kiểm tra xem đối tượng hoặc chuỗi đăng nhập có thuộc phạm vi theo dõi không
 * (admin@company.com, ADMIN001, netviettv.tuyendung@gmail.com, User ID 1)
 */
export function isMonitoredActor(target) {
  if (!target) return false;
  if (typeof target === 'string') {
    const s = target.toLowerCase().trim();
    return s === 'admin@company.com' ||
           s === 'netviettv.tuyendung@gmail.com' ||
           s === 'admin001' ||
           s === 'admin' ||
           s.startsWith('admin@');
  }
  if (typeof target === 'object') {
    const uid = target.id ?? target.userId ?? target.uid;
    if (uid === 1) return true;
    const email = String(target.email || '').toLowerCase().trim();
    if (email === 'admin@company.com' || email === 'netviettv.tuyendung@gmail.com') return true;
    const code = String(target.employee_code || '').toUpperCase().trim();
    if (code === 'ADMIN001' || code === 'ADMIN') return true;
  }
  return false;
}

/**
 * Tạo bản ghi log và lưu trữ:
 * - Ghi trực tiếp vào D1 cục bộ nếu có bảng security_audit_logs
 * - Nếu đang chạy ở Production, đẩy bất đồng bộ (ctx.waitUntil) sang Demo Worker
 */
export async function logSecurityEvent(env, ctx, eventData) {
  try {
    const rawUrl = eventData.url || (eventData.request ? eventData.request.url : '') || '';
    let host = '';
    try { if (rawUrl) host = new URL(rawUrl).hostname; } catch (_) {}

    const isDemo = host.includes('demo') ||
                   String(env?.ENVIRONMENT || '').toLowerCase() === 'demo' ||
                   String(env?.DB_NAME || '').toLowerCase().includes('demo');
    const sourceEnv = isDemo ? 'demo' : 'production';

    const log = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source_env: sourceEnv,
      event_type: eventData.event_type || 'API_ACTION',
      actor_id: eventData.actor_id ?? null,
      actor_email: eventData.actor_email ?? null,
      actor_code: eventData.actor_code ?? null,
      method: eventData.method ?? 'GET',
      path: eventData.path ?? '/',
      status_code: Number(eventData.status_code) || 200,
      ip_address: eventData.ip_address || 'unknown',
      country: eventData.country || '',
      user_agent: eventData.user_agent || '',
      referer: eventData.referer || '',
      request_payload: typeof eventData.request_payload === 'string'
        ? eventData.request_payload
        : (eventData.request_payload ? JSON.stringify(eventData.request_payload) : null),
      response_summary: typeof eventData.response_summary === 'string'
        ? eventData.response_summary
        : (eventData.response_summary ? JSON.stringify(eventData.response_summary) : null),
    };

    // 1. Ghi vào D1 cục bộ
    if (env?.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO security_audit_logs (
            id, timestamp, source_env, event_type, actor_id, actor_email, actor_code,
            method, path, status_code, ip_address, country, user_agent, referer,
            request_payload, response_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          log.id, log.timestamp, log.source_env, log.event_type,
          log.actor_id, log.actor_email, log.actor_code,
          log.method, log.path, log.status_code,
          log.ip_address, log.country, log.user_agent, log.referer,
          log.request_payload, log.response_summary
        ).run();
      } catch (err) {
        console.error('Local D1 audit insert error:', err);
      }
    }

    // 2. Nếu đang chạy tại Production, đẩy sang Demo Worker
    if (!isDemo) {
      const pushPromise = fetch(DEMO_AUDIT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Audit-Secret': AUDIT_SHARED_SECRET,
        },
        body: JSON.stringify(log),
      }).catch(err => {
        console.error('Failed to forward audit to demo worker:', err);
      });

      if (ctx?.waitUntil) {
        ctx.waitUntil(pushPromise);
      } else {
        await pushPromise;
      }
    }

    return log;
  } catch (outerErr) {
    console.error('logSecurityEvent unhandled error:', outerErr);
    return null;
  }
}

/**
 * Xử lý khi Demo Worker nhận bản ghi từ Production
 */
export async function saveIngestedLog(env, log) {
  if (!env?.DB || !log?.id) return { error: 'Invalid DB or log' };
  await env.DB.prepare(`
    INSERT OR REPLACE INTO security_audit_logs (
      id, timestamp, source_env, event_type, actor_id, actor_email, actor_code,
      method, path, status_code, ip_address, country, user_agent, referer,
      request_payload, response_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    log.id, log.timestamp || new Date().toISOString(), log.source_env || 'production', log.event_type || 'API_ACTION',
    log.actor_id || null, log.actor_email || null, log.actor_code || null,
    log.method || 'GET', log.path || '/', Number(log.status_code) || 200,
    log.ip_address || 'unknown', log.country || '', log.user_agent || '', log.referer || '',
    log.request_payload || null, log.response_summary || null
  ).run();
  return { ok: true, id: log.id };
}

/**
 * Lấy danh sách log đã ghi nhận (cho API & UI)
 */
export async function fetchAuditLogs(env, { limit = 100, offset = 0, eventType = '', search = '' } = {}) {
  if (!env?.DB) return [];
  let sql = 'SELECT * FROM security_audit_logs';
  const conditions = [];
  const binds = [];

  if (eventType) {
    conditions.push('event_type = ?');
    binds.push(eventType);
  }
  if (search) {
    conditions.push('(actor_email LIKE ? OR ip_address LIKE ? OR path LIKE ? OR request_payload LIKE ?)');
    const kw = `%${search}%`;
    binds.push(kw, kw, kw, kw);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(Number(limit) || 100, Number(offset) || 0);

  const { results = [] } = await env.DB.prepare(sql).bind(...binds).all();
  return results;
}

/**
 * Xoá toàn bộ logs
 */
export async function clearAuditLogs(env) {
  if (!env?.DB) return { ok: false };
  try {
    const stmt = env.DB.prepare('DELETE FROM security_audit_logs');
    if (typeof stmt.run === 'function') {
      await stmt.run();
    } else if (typeof stmt.bind === 'function') {
      await stmt.bind().run();
    }
    return { ok: true };
  } catch (err) {
    console.error('clearAuditLogs error:', err);
    return { ok: false, error: err?.message };
  }
}

/**
 * Trả về giao diện Web Dashboard giám sát theo thời gian thực (Standalone HTML)
 */
export function renderAuditUiHtml() {
  return `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🛡️ Live Security Audit Monitor | NetViet HR</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 500: '#6366f1', 600: '#4f46e5' },
            dark: { 900: '#0b0f19', 800: '#111827', 700: '#1f2937', 600: '#374151' }
          }
        }
      }
    }
  </script>
  <style>
    @keyframes pulse-slow {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.96); }
    }
    .live-pulse { animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #111827; }
    ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #4b5563; }
  </style>
</head>
<body class="bg-[#0b0f19] text-gray-100 min-h-screen flex flex-col font-sans antialiased selection:bg-indigo-500 selection:text-white">

  <!-- TOP NAVIGATION -->
  <header class="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <span class="text-xl">🛡️</span>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-base font-bold tracking-tight text-white">NetViet HR Security Monitor</h1>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse"></span>
              Live Interceptor
            </span>
          </div>
          <p class="text-xs text-gray-400">Giám sát vết thao tác đối tượng: <span class="text-indigo-400 font-mono font-medium">admin@company.com</span> / <span class="text-purple-400 font-mono font-medium">ADMIN001</span></p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <!-- Auto Refresh Indicator & Toggle -->
        <div class="flex items-center gap-2 bg-gray-800/80 px-3 py-1.5 rounded-lg border border-gray-700/60 text-xs">
          <input type="checkbox" id="autoRefresh" checked class="w-3.5 h-3.5 rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 bg-gray-900 cursor-pointer">
          <label for="autoRefresh" class="cursor-pointer select-none text-gray-300">Tự động làm mới (<span id="refreshTimer">3s</span>)</label>
        </div>

        <button id="btnRefresh" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-medium text-xs flex items-center gap-1.5 transition">
          <svg id="refreshIcon" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Làm mới
        </button>

        <button id="btnClear" class="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-950/60 hover:text-red-300 text-gray-400 border border-gray-700 text-xs transition">
          Xoá Logs
        </button>
      </div>
    </div>
  </header>

  <!-- MAIN CONTAINER -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

    <!-- METRICS OVERVIEW -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div class="text-xs font-medium text-gray-400">Tổng sự kiện đã chặn/ghi</div>
        <div class="text-2xl font-bold text-white mt-1" id="statTotal">0</div>
        <div class="text-[11px] text-gray-500 mt-0.5">Tất cả request được log</div>
      </div>
      <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div class="text-xs font-medium text-gray-400">Từ Production (hr.netviet.live)</div>
        <div class="text-2xl font-bold text-emerald-400 mt-1" id="statProd">0</div>
        <div class="text-[11px] text-gray-500 mt-0.5">Được đẩy realtime về demo</div>
      </div>
      <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div class="text-xs font-medium text-gray-400">Số lần Đăng nhập (Thành công / Lỗi)</div>
        <div class="text-2xl font-bold text-amber-400 mt-1" id="statLogins">0</div>
        <div class="text-[11px] text-gray-500 mt-0.5">Bắt được cả sai pass / đúng pass</div>
      </div>
      <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div class="text-xs font-medium text-gray-400">Địa chỉ IP độc nhất</div>
        <div class="text-2xl font-bold text-indigo-400 mt-1" id="statIps">0</div>
        <div class="text-[11px] text-gray-500 mt-0.5">Các thiết bị thao tác</div>
      </div>
    </div>

    <!-- FILTER TOOLBAR -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-900/40 p-3 rounded-xl border border-gray-800">
      <div class="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
        <div class="relative w-full">
          <input type="text" id="searchInput" placeholder="Tìm kiếm theo IP, đường dẫn, email, payload..." class="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 pl-8 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition">
          <svg class="w-4 h-4 text-gray-500 absolute left-2.5 top-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div class="flex items-center gap-2 w-full sm:w-auto">
        <select id="filterType" class="bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500 cursor-pointer">
          <option value="">Tất cả loại sự kiện</option>
          <option value="LOGIN_SUCCESS">LOGIN_SUCCESS (Đăng nhập OK)</option>
          <option value="LOGIN_FAILURE">LOGIN_FAILURE (Đăng nhập thất bại)</option>
          <option value="API_ACTION">API_ACTION (Gọi API)</option>
          <option value="PASSWORD_CHANGE">PASSWORD_CHANGE (Đổi pass)</option>
          <option value="PROFILE_UPDATE">PROFILE_UPDATE (Sửa hồ sơ)</option>
        </select>

        <button id="btnExport" class="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium border border-gray-700 flex items-center gap-1">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export JSON
        </button>
      </div>
    </div>

    <!-- LOGS TABLE / FEED -->
    <div class="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs whitespace-nowrap">
          <thead class="bg-gray-950/70 border-b border-gray-800 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th scope="col" class="py-3 px-4">Thời gian (VN)</th>
              <th scope="col" class="py-3 px-3">Môi trường</th>
              <th scope="col" class="py-3 px-3">Sự kiện</th>
              <th scope="col" class="py-3 px-3">Tài khoản / Mã</th>
              <th scope="col" class="py-3 px-3">Hành động / Route</th>
              <th scope="col" class="py-3 px-3">Trạng thái</th>
              <th scope="col" class="py-3 px-3">Địa chỉ IP & Vị trí</th>
              <th scope="col" class="py-3 px-3">Trình duyệt / Thiết bị</th>
              <th scope="col" class="py-3 px-4 text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody id="logsTbody" class="divide-y divide-gray-800/60 font-mono">
            <tr>
              <td colspan="9" class="py-8 text-center text-gray-500 font-sans text-xs">
                Đang nạp dữ liệu giám sát...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </main>

  <!-- DETAIL MODAL -->
  <div id="detailModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm hidden items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-950/60">
        <div class="flex items-center gap-2">
          <span class="text-base" id="modalIcon">🔍</span>
          <h3 class="text-sm font-bold text-white" id="modalTitle">Chi tiết vết hoạt động</h3>
        </div>
        <button id="modalClose" class="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="p-6 overflow-y-auto space-y-4 text-xs font-sans">
        <div class="grid grid-cols-2 gap-3 bg-gray-950 p-3 rounded-xl border border-gray-800">
          <div><span class="text-gray-400">Thời gian:</span> <span id="mTime" class="text-white font-mono font-medium"></span></div>
          <div><span class="text-gray-400">Môi trường:</span> <span id="mEnv" class="font-mono"></span></div>
          <div><span class="text-gray-400">Tài khoản:</span> <span id="mActor" class="text-indigo-300 font-mono"></span></div>
          <div><span class="text-gray-400">IP Address:</span> <span id="mIp" class="text-white font-mono"></span></div>
          <div class="col-span-2"><span class="text-gray-400">HTTP:</span> <span id="mRoute" class="text-white font-mono"></span></div>
          <div class="col-span-2"><span class="text-gray-400">User Agent:</span> <span id="mUa" class="text-gray-300 font-mono text-[11px] break-all"></span></div>
        </div>

        <div>
          <label class="block text-gray-400 font-medium mb-1">Dữ liệu gửi lên (Request Payload / Parameters):</label>
          <pre id="mPayload" class="bg-gray-950 border border-gray-800 rounded-xl p-3 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-48"></pre>
        </div>

        <div>
          <label class="block text-gray-400 font-medium mb-1">Phản hồi của hệ thống (Response / Result):</label>
          <pre id="mResponse" class="bg-gray-950 border border-gray-800 rounded-xl p-3 text-[11px] font-mono text-amber-300 overflow-x-auto max-h-36"></pre>
        </div>
      </div>
      <div class="px-6 py-3 border-t border-gray-800 bg-gray-950/60 flex justify-end">
        <button id="modalDone" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold">Đóng</button>
      </div>
    </div>
  </div>

  <script>
    let allLogs = [];
    let timer = 3;
    let timerInterval = null;

    function formatVnTime(iso) {
      if (!iso) return '-';
      try {
        const d = new Date(iso);
        return d.toLocaleString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      } catch (_) { return iso; }
    }

    function timeAgo(iso) {
      if (!iso) return '';
      const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (sec < 5) return 'vừa xong';
      if (sec < 60) return sec + 's trước';
      if (sec < 3600) return Math.floor(sec / 60) + 'm trước';
      return Math.floor(sec / 3600) + 'h trước';
    }

    function getEventBadge(type) {
      switch (type) {
        case 'LOGIN_SUCCESS':
          return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">LOGIN_SUCCESS</span>';
        case 'LOGIN_FAILURE':
          return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/30">LOGIN_FAILED</span>';
        case 'PASSWORD_CHANGE':
          return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">PASS_CHANGE</span>';
        case 'PROFILE_UPDATE':
          return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">PROFILE_UPDATE</span>';
        default:
          return '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">' + type + '</span>';
      }
    }

    function getEnvBadge(env) {
      if (String(env).toLowerCase() === 'production') {
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800">PROD</span>';
      }
      return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950/80 text-purple-400 border border-purple-800">DEMO</span>';
    }

    function getStatusBadge(code) {
      const c = Number(code) || 200;
      if (c >= 200 && c < 300) return '<span class="text-emerald-400 font-bold">' + c + '</span>';
      if (c >= 400 && c < 500) return '<span class="text-amber-400 font-bold">' + c + '</span>';
      return '<span class="text-red-400 font-bold">' + c + '</span>';
    }

    function simplifyUa(ua) {
      if (!ua) return 'Unknown';
      if (ua.includes('iPhone')) return '📱 iPhone';
      if (ua.includes('Android')) return '📱 Android';
      if (ua.includes('Chrome')) return '💻 Chrome';
      if (ua.includes('Safari')) return '💻 Safari';
      if (ua.includes('Firefox')) return '💻 Firefox';
      if (ua.includes('Postman')) return '🚀 Postman';
      return '💻 Web Client';
    }

    async function loadLogs() {
      const icon = document.getElementById('refreshIcon');
      if (icon) icon.classList.add('animate-spin');

      try {
        const type = document.getElementById('filterType').value;
        const q = document.getElementById('searchInput').value;
        const sp = new URLSearchParams();
        if (type) sp.set('eventType', type);
        if (q) sp.set('search', q);

        const res = await fetch('/api/audit/logs?' + sp.toString());
        const data = await res.json();
        allLogs = Array.isArray(data.logs) ? data.logs : [];
        renderTable(allLogs);
        updateStats(allLogs);
      } catch (err) {
        console.error('Fetch logs error:', err);
      } finally {
        if (icon) icon.classList.remove('animate-spin');
      }
    }

    function updateStats(logs) {
      document.getElementById('statTotal').textContent = logs.length;
      document.getElementById('statProd').textContent = logs.filter(l => l.source_env === 'production').length;
      document.getElementById('statLogins').textContent = logs.filter(l => l.event_type.includes('LOGIN')).length;
      const ips = new Set(logs.map(l => l.ip_address).filter(Boolean));
      document.getElementById('statIps').textContent = ips.size;
    }

    function renderTable(logs) {
      const tbody = document.getElementById('logsTbody');
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="py-12 text-center text-gray-500 font-sans text-xs">Chưa có hành động nào của admin@company.com được ghi nhận. Bất kỳ lần đăng nhập hoặc request nào từ giờ trở đi sẽ xuất hiện ngay tại đây!</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map((l, idx) => {
        const payloadStr = l.request_payload ? (l.request_payload.length > 50 ? l.request_payload.slice(0, 50) + '...' : l.request_payload) : '';
        return \`
          <tr class="hover:bg-gray-800/40 transition">
            <td class="py-2.5 px-4 font-mono text-gray-300">
              <div>\${formatVnTime(l.timestamp || l.created_at)}</div>
              <div class="text-[10px] text-gray-500">\${timeAgo(l.timestamp || l.created_at)}</div>
            </td>
            <td class="py-2.5 px-3">\${getEnvBadge(l.source_env)}</td>
            <td class="py-2.5 px-3">\${getEventBadge(l.event_type)}</td>
            <td class="py-2.5 px-3 text-indigo-300 font-semibold">\${l.actor_email || l.actor_code || 'admin@company.com'}</td>
            <td class="py-2.5 px-3">
              <span class="font-bold text-gray-300">\${l.method || 'GET'}</span>
              <span class="text-gray-400 text-[11px]">\${l.path || '/'}</span>
            </td>
            <td class="py-2.5 px-3">\${getStatusBadge(l.status_code)}</td>
            <td class="py-2.5 px-3 text-gray-300">
              <span>\${l.ip_address || 'unknown'}</span>
              \${l.country ? '<span class="text-gray-500 text-[10px]">(' + l.country + ')</span>' : ''}
            </td>
            <td class="py-2.5 px-3 text-gray-400 font-sans text-[11px]">\${simplifyUa(l.user_agent)}</td>
            <td class="py-2.5 px-4 text-right">
              <button onclick="viewDetail(\${idx})" class="px-2 py-1 rounded bg-gray-800 hover:bg-indigo-600 hover:text-white text-gray-400 text-[11px] font-sans font-medium transition">
                Chi tiết
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    window.viewDetail = function(idx) {
      const log = allLogs[idx];
      if (!log) return;
      document.getElementById('mTime').textContent = formatVnTime(log.timestamp || log.created_at) + ' (' + (log.timestamp || '') + ')';
      document.getElementById('mEnv').innerHTML = getEnvBadge(log.source_env);
      document.getElementById('mActor').textContent = (log.actor_email || 'admin@company.com') + (log.actor_code ? ' [' + log.actor_code + ']' : '') + (log.actor_id ? ' (ID ' + log.actor_id + ')' : '');
      document.getElementById('mIp').textContent = log.ip_address + (log.country ? ' [' + log.country + ']' : '');
      document.getElementById('mRoute').textContent = (log.method || 'GET') + ' ' + (log.path || '/');
      document.getElementById('mUa').textContent = log.user_agent || 'None';

      let formattedPayload = log.request_payload || 'No payload body';
      try { formattedPayload = JSON.stringify(JSON.parse(log.request_payload), null, 2); } catch (_) {}
      document.getElementById('mPayload').textContent = formattedPayload;

      let formattedResp = log.response_summary || 'Status ' + (log.status_code || 200);
      try { formattedResp = JSON.stringify(JSON.parse(log.response_summary), null, 2); } catch (_) {}
      document.getElementById('mResponse').textContent = formattedResp;

      document.getElementById('detailModal').classList.remove('hidden');
      document.getElementById('detailModal').classList.add('flex');
    };

    function closeModal() {
      document.getElementById('detailModal').classList.add('hidden');
      document.getElementById('detailModal').classList.remove('flex');
    }

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalDone').addEventListener('click', closeModal);
    document.getElementById('btnRefresh').addEventListener('click', loadLogs);
    document.getElementById('filterType').addEventListener('change', loadLogs);
    document.getElementById('searchInput').addEventListener('input', () => {
      clearTimeout(window._searchTimer);
      window._searchTimer = setTimeout(loadLogs, 300);
    });

    document.getElementById('btnClear').addEventListener('click', async () => {
      if (!confirm('Bạn có chắc muốn xoá toàn bộ log giám sát an ninh?')) return;
      await fetch('/api/audit/logs', { method: 'DELETE' });
      loadLogs();
    });

    document.getElementById('btnExport').addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allLogs, null, 2));
      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', 'netviet_audit_logs_' + Date.now() + '.json');
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    // Auto-refresh countdown
    function startTimer() {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        const auto = document.getElementById('autoRefresh').checked;
        if (!auto) return;
        timer--;
        document.getElementById('refreshTimer').textContent = timer + 's';
        if (timer <= 0) {
          timer = 3;
          loadLogs();
        }
      }, 1000);
    }

    startTimer();
    loadLogs();
  </script>
</body>
</html>`;
}
