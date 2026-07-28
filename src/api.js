// ════════════════════════════════════════════════
//  API helpers — all backend calls go through here
// ════════════════════════════════════════════════

let _token = null;
const NATIVE_API_ORIGIN = 'https://nexrall-hr-manager-marketing.netviettv-hr-manager.workers.dev';
const isNativeApp = () => !!globalThis.Capacitor?.isNativePlatform?.();
const apiUrl = (path) => isNativeApp() ? NATIVE_API_ORIGIN + path : path;

async function nativeTokenStore(value) {
  const plugin = globalThis.Capacitor?.Plugins?.SecureStoragePlugin;
  if (!plugin) return false;
  try {
    if (value) await plugin.set({ key: 'hr_token', value });
    else await plugin.remove({ key: 'hr_token' });
    return true;
  } catch (_) { return false; }
}

export async function setToken(t) {
  _token = t || null;
  if (isNativeApp()) { await nativeTokenStore(_token); return; }
  if (_token) localStorage.setItem('hr_token', _token); else localStorage.removeItem('hr_token');
}
export async function loadToken() {
  if (isNativeApp()) {
    try { _token = (await globalThis.Capacitor?.Plugins?.SecureStoragePlugin?.get({ key: 'hr_token' }))?.value || null; }
    catch (_) { _token = null; }
    return _token;
  }
  _token = localStorage.getItem('hr_token') || null;
  return _token;
}
export function getToken() { return _token; }

// ════════════════════════════════════════════════
//  In-memory GET cache (stale-while-revalidate)
// ════════════════════════════════════════════════
// TTL values (ms) per URL prefix
const CACHE_TTL = {
  '/api/users':            60_000,   // 60 s — users rarely change
  '/api/departments':      60_000,
  '/api/employees':        60_000,
  '/api/settings':        120_000,   // 2 min
  '/api/wifi-whitelist':   60_000,
  '/api/campaigns':        30_000,
  '/api/tasks':            30_000,
  '/api/task-projects':     30_000,
  '/api/task-groups':       30_000,
  '/api/task-labels':       30_000,
  '/api/attendance':       20_000,
  '/api/leave':            30_000,
  '/api/leave-types':      60_000,
  '/api/candidates':       30_000,
  '/api/payroll':          30_000,
  '/api/invoices':         30_000,
  '/api/users/basic':      60_000,
  '/api/integrations/vietqr/banks': 24 * 60 * 60_000,
  '/api/assets':           20_000,
  '/api/eval-periods':     60_000,
  '/api/evaluations':      20_000,
  '/api/evaluations/report':    20_000,
  '/api/evaluations/dashboard': 20_000,
};

// Map of cacheKey → { data, ts, inflight }
const _cache = new Map();

function ttlFor(path) {
  for (const [prefix, ttl] of Object.entries(CACHE_TTL)) {
    if (path.startsWith(prefix)) return ttl;
  }
  return 0; // don't cache
}

// Invalidate all cache entries whose key starts with a given prefix
export function invalidateCache(prefix) {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

export function clearCache() { _cache.clear(); }

// A monotonic write-generation counter — incremented by every inv() call.
// Each inflight bg-revalidation captures the generation at launch; if the
// generation has changed by the time it resolves, the result is discarded
// instead of being written back into the cache (which would overwrite fresh data).
let _writeGen = 0;

// ────────────────────────────────────────────────
function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (_token) h['X-Auth-Token'] = _token;
  return h;
}

async function req(method, path, body) {
  const opts = { method, headers: headers() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(apiUrl(path), opts);
  const text = await res.text().catch(() => '');
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch (_) { data = { error: text }; }
  }
  const message = data.error || data.message || (res.statusText ? `${res.status} ${res.statusText}` : `HTTP ${res.status}`);
  if (!res.ok) throw Object.assign(new Error(message), { status: res.status, data });
  return data;
}

async function uploadFile(path, file) {
  const form = new FormData();
  form.append('file', file);
  const h = {};
  if (_token) h['X-Auth-Token'] = _token;
  const res = await fetch(apiUrl(path), { method: 'POST', headers: h, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Không thể tải tệp lên'), { status: res.status, data });
  return data;
}

// Cached GET — returns cached value immediately if fresh, else fetches.
// If stale but present: returns stale data instantly AND kicks off bg refresh.
async function cachedGet(path) {
  const ttl = ttlFor(path);
  if (!ttl) return req('GET', path); // uncacheable (e.g. /api/auth/me, /api/get-ip)

  const entry = _cache.get(path);
  const now = Date.now();

  if (entry) {
    const age = now - entry.ts;
    if (age < ttl) {
      // Fresh — return immediately
      return entry.data;
    }
    // Stale — return immediately AND revalidate in background.
    // Capture the write-generation at launch; if inv() fires before this
    // resolves (i.e. a write happened), discard the result so we never
    // repopulate the cache with pre-write data.
    if (!entry.inflight) {
      const genAtLaunch = _writeGen;
      entry.inflight = req('GET', path).then(data => {
        if (_writeGen !== genAtLaunch) return; // a write happened — drop stale result
        _cache.set(path, { data, ts: Date.now(), inflight: null });
      }).catch(() => {
        if (_cache.has(path)) _cache.get(path).inflight = null;
      });
    }
    return entry.data; // serve stale while revalidating
  }

  // Cache miss — fetch, store, return
  const data = await req('GET', path);
  _cache.set(path, { data, ts: now, inflight: null });
  return data;
}

// Invalidation helper — call after any write that changes a resource.
// Also bumps _writeGen so any in-flight bg revalidation launched BEFORE this
// write will discard its (now-stale) result instead of repopulating the cache.
function inv(...prefixes) {
  _writeGen++;
  prefixes.forEach(p => invalidateCache(p));
}

// ════════════════════════════════════════════════
export const api = {
  // Raw (bypass cache — for non-GET or special cases)
  get:    (path) => cachedGet(path),
  post:   (path, body) => req('POST', path, body),
  put:    (path, body) => req('PUT', path, body),
  delete: (path) => req('DELETE', path),

  // Auth (never cached)
  login:          (login, password) => req('POST', '/api/auth/login', { login, password }),
  me:             () => req('GET', '/api/auth/me'),
  logout:         () => req('POST', '/api/auth/logout'),
  changePassword: (old_password, new_password) =>
    req('PUT', '/api/auth/change-password', { old_password, new_password }),

  // Users — user records are JOINed into attendance, tasks, and invoices
  // (full_name, department, position), so writes must cross-invalidate those caches too.
  getUsers:   () => cachedGet('/api/users'),
  createUser: (d) => req('POST', '/api/users', d).then(r => { inv('/api/users', '/api/employees'); return r; }),
  updateUser: (id, d) => req('PUT', `/api/users/${id}`, d).then(r => { inv('/api/users', '/api/employees', '/api/attendance', '/api/tasks', '/api/invoices'); return r; }),
  uploadUserDocument: (id, kind, file) => uploadFile(`/api/users/${id}/documents/${kind}`, file).then(r => { inv('/api/users'); return r; }),
  deleteUserDocument: (id, kind) => req('DELETE', `/api/users/${id}/documents/${kind}`).then(r => { inv('/api/users'); return r; }),
  deleteUser: (id) => req('DELETE', `/api/users/${id}`).then(r => { inv('/api/users', '/api/employees', '/api/attendance', '/api/tasks', '/api/invoices'); return r; }),
  // Safe minimal user fields (for pickers, e.g. Mentor select) — any authenticated user may call
  getUsersBasic: () => cachedGet('/api/users/basic'),
  // Public reference data is fetched through our Worker so provider calls do
  // not receive any employee financial or tax information.
  getVietqrBanks: () => cachedGet('/api/integrations/vietqr/banks'),
  // Lifecycle status (Vòng đời nhân sự) — HCNS/Ban Giám Đốc only (enforced server-side)
  changeLifecycleStatus: (id, status, reason) =>
    req('PUT', `/api/users/${id}/lifecycle`, { status, reason }).then(r => { inv('/api/users'); return r; }),

  // Asset handover (Bàn giao tài sản cho TTS)
  getAssets: () => cachedGet('/api/assets'),
  createAsset: (d) => req('POST', '/api/assets', d).then(r => { inv('/api/assets'); return r; }),
  updateAsset: (id, d) => req('PUT', `/api/assets/${id}`, d).then(r => { inv('/api/assets'); return r; }),
  deleteAsset: (id) => req('DELETE', `/api/assets/${id}`).then(r => { inv('/api/assets'); return r; }),
  revealAssetCredential: (id) => req('POST', `/api/assets/${id}/reveal-credential`),

  // Attendance
  getAttendance: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/attendance' + (q ? '?' + q : ''));
  },
  getAttendanceToday: () => cachedGet('/api/attendance/today'),
  // Not cached — used to auto-fill "Ngày công" right before creating a payroll invoice,
  // must always reflect the latest attendance data (and support an explicit retry on error).
  getAttendanceSummary: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/attendance/summary' + (q ? '?' + q : ''));
  },
  getAttendanceEmployees: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/attendance/employees' + (q ? '?' + q : ''));
  },
  getEmployeeAttendanceSummary: (employeeId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/api/attendance/employees/${employeeId}/summary` + (q ? '?' + q : ''));
  },
  registerAttendance: (body) => req('POST', '/api/attendance/register', body).then(r => { inv('/api/attendance'); return r; }),
  checkin:  (body) => req('POST', '/api/attendance/checkin', body).then(r => { inv('/api/attendance'); return r; }),
  checkout: (body) => req('POST', '/api/attendance/checkout', body).then(r => { inv('/api/attendance'); return r; }),
  updateAttendance: (id, d) => req('PUT', `/api/attendance/${id}`, d).then(r => { inv('/api/attendance'); return r; }),
  getOvertimeRequests: (params = {}) => { const q = new URLSearchParams(params).toString(); return req('GET', '/api/overtime-requests' + (q ? '?' + q : '')); },
  createOvertimeRequest: (d) => req('POST', '/api/overtime-requests', d).then(r => { inv('/api/attendance'); return r; }),
  decideOvertimeRequest: (id, action, d = {}) => req('POST', `/api/overtime-requests/${id}/${action}`, d).then(r => { inv('/api/attendance', '/api/invoices'); return r; }),
  getCompanyHolidays: () => req('GET', '/api/company-holidays'),
  createCompanyHoliday: (d) => req('POST', '/api/company-holidays', d),
  updateCompanyHoliday: (id, d) => req('PUT', `/api/company-holidays/${id}`, d),
  deleteCompanyHoliday: (id) => req('DELETE', `/api/company-holidays/${id}`),

  // WiFi
  getWifi:    () => cachedGet('/api/wifi-whitelist'),
  createWifi: (d) => req('POST', '/api/wifi-whitelist', d).then(r => { inv('/api/wifi-whitelist'); return r; }),
  updateWifi: (id, d) => req('PUT', `/api/wifi-whitelist/${id}`, d).then(r => { inv('/api/wifi-whitelist'); return r; }),
  deleteWifi: (id) => req('DELETE', `/api/wifi-whitelist/${id}`).then(r => { inv('/api/wifi-whitelist'); return r; }),

  // Database Admin (admin only, never cached)
  getDbTables: () => req('GET', '/api/db-admin/tables'),
  getDbRows: (table, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/api/db-admin/tables/${encodeURIComponent(table)}` + (q ? '?' + q : ''));
  },
  createDbRow: (table, data) => req('POST', `/api/db-admin/tables/${encodeURIComponent(table)}`, data),
  updateDbRow: (table, id, data) => req('PUT', `/api/db-admin/tables/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, data),
  deleteDbRow: (table, id) => req('DELETE', `/api/db-admin/tables/${encodeURIComponent(table)}/${encodeURIComponent(id)}`),

  // Tasks
  getTasks: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/tasks' + (q ? '?' + q : ''));
  },
  getTaskProjects: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/task-projects' + (q ? '?' + q : ''));
  },
  createTaskProject: (d) => req('POST', '/api/task-projects', d).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  updateTaskProject: (id, d) => req('PUT', `/api/task-projects/${id}`, d).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  archiveTaskProject: (id) => req('DELETE', `/api/task-projects/${id}`).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  saveTaskProjectMembers: (id, members) => req('PUT', `/api/task-projects/${id}/members`, { members }).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  getTaskGroups: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/task-groups' + (q ? '?' + q : ''));
  },
  createTaskGroup: (d) => req('POST', '/api/task-groups', d).then(r => { inv('/api/task-groups', '/api/tasks'); return r; }),
  updateTaskGroup: (id, d) => req('PUT', `/api/task-groups/${id}`, d).then(r => { inv('/api/task-groups', '/api/tasks'); return r; }),
  archiveTaskGroup: (id) => req('DELETE', `/api/task-groups/${id}`).then(r => { inv('/api/task-groups', '/api/tasks'); return r; }),
  getTaskLabels: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/task-labels' + (q ? '?' + q : ''));
  },
  createTaskLabel: (d) => req('POST', '/api/task-labels', d).then(r => { inv('/api/task-labels', '/api/tasks'); return r; }),
  updateTaskLabel: (id, d) => req('PUT', `/api/task-labels/${id}`, d).then(r => { inv('/api/task-labels', '/api/tasks'); return r; }),
  deleteTaskLabel: (id) => req('DELETE', `/api/task-labels/${id}`).then(r => { inv('/api/task-labels', '/api/tasks'); return r; }),
  getTask:    (id) => req('GET', `/api/tasks/${id}`), // single task detail — bypass cache (task panel needs fresh)
  createTask: (d) => req('POST', '/api/tasks', d).then(r => { inv('/api/tasks'); return r; }),
  updateTask: (id, d) => req('PUT', `/api/tasks/${id}`, d).then(r => { inv('/api/tasks'); return r; }),
  deleteTask: (id) => req('DELETE', `/api/tasks/${id}`).then(r => { inv('/api/tasks'); return r; }),
  // Subtask/comment writes change task data that is included in the task list response,
  // so invalidate /api/tasks to prevent the list from serving stale subtask counts.
  createSubtask: (taskId, d) => req('POST', `/api/tasks/${taskId}/subtasks`, d).then(r => { inv('/api/tasks'); return r; }),
  updateSubtask: (id, d) => req('PUT', `/api/subtasks/${id}`, d).then(r => { inv('/api/tasks'); return r; }),
  deleteSubtask: (id) => req('DELETE', `/api/subtasks/${id}`).then(r => { inv('/api/tasks'); return r; }),
  getComments: (taskId) => req('GET', `/api/tasks/${taskId}/comments`), // always fresh (no cache)
  addComment:  (taskId, content) => req('POST', `/api/tasks/${taskId}/comments`, { content }).then(r => { inv('/api/tasks'); return r; }),

  // Invoices
  getInvoices: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/invoices' + (q ? '?' + q : ''));
  },
  getInvoice:    (id) => req('GET', `/api/invoices/${id}`),
  createInvoice: (d) => req('POST', '/api/invoices', d).then(r => { inv('/api/invoices'); return r; }),
  updateInvoice: (id, d) => req('PUT', `/api/invoices/${id}`, d).then(r => { inv('/api/invoices'); return r; }),
  deleteInvoice: (id) => req('DELETE', `/api/invoices/${id}`).then(r => { inv('/api/invoices'); return r; }),
  confirmInvoice: (id) => req('POST', `/api/invoices/${id}/confirm`).then(r => { inv('/api/invoices'); return r; }),
  requestInvoiceReview: (id, d) => req('POST', `/api/invoices/${id}/review-request`, d).then(r => { inv('/api/invoices'); return r; }),
  resolveInvoiceReview: (id, d) => req('POST', `/api/invoices/${id}/resolve-review`, d).then(r => { inv('/api/invoices'); return r; }),

  // Settings
  getSettings:  () => cachedGet('/api/settings'),
  saveSettings: (d) => req('PUT', '/api/settings', d).then(r => { inv('/api/settings'); return r; }),

  // IP (never cached — it's a live lookup)
  getIp: () => req('GET', '/api/get-ip'),

  // Departments — employees reference department_id so cross-invalidate that cache too
  getDepartments:   () => cachedGet('/api/departments'),
  createDepartment: (d) => req('POST', '/api/departments', d).then(r => { inv('/api/departments', '/api/employees'); return r; }),
  updateDepartment: (id, d) => req('PUT', `/api/departments/${id}`, d).then(r => { inv('/api/departments', '/api/employees'); return r; }),
  deleteDepartment: (id) => req('DELETE', `/api/departments/${id}`).then(r => { inv('/api/departments', '/api/employees'); return r; }),

  // Employees (extended profile)
  getEmployees:   () => cachedGet('/api/employees'),
  createEmployee: (d) => req('POST', '/api/employees', d).then(r => { inv('/api/employees'); return r; }),
  updateEmployee: (id, d) => req('PUT', `/api/employees/${id}`, d).then(r => { inv('/api/employees'); return r; }),
  deleteEmployee: (id) => req('DELETE', `/api/employees/${id}`).then(r => { inv('/api/employees'); return r; }),

  // Leave requests
  getLeave: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/leave' + (q ? '?' + q : ''));
  },
  createLeave: (d) => req('POST', '/api/leave', d).then(r => { inv('/api/leave'); return r; }),
  updateLeave: (id, d) => req('PUT', `/api/leave/${id}`, d).then(r => { inv('/api/leave'); return r; }),
  deleteLeave: (id) => req('DELETE', `/api/leave/${id}`).then(r => { inv('/api/leave'); return r; }),
  getLeaveTypes: (includeInactive = false) => cachedGet('/api/leave-types' + (includeInactive ? '?includeInactive=1' : '')),
  createLeaveType: (d) => req('POST', '/api/leave-types', d).then(r => { inv('/api/leave-types'); return r; }),
  updateLeaveType: (id, d) => req('PUT', `/api/leave-types/${id}`, d).then(r => { inv('/api/leave-types'); return r; }),
  deleteLeaveType: (id) => req('DELETE', `/api/leave-types/${id}`).then(r => { inv('/api/leave-types'); return r; }),

  // Candidates / Recruitment
  getCandidates: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/candidates' + (q ? '?' + q : ''));
  },
  createCandidate: (d) => req('POST', '/api/candidates', d).then(r => { inv('/api/candidates'); return r; }),
  updateCandidate: (id, d) => req('PUT', `/api/candidates/${id}`, d).then(r => { inv('/api/candidates'); return r; }),
  deleteCandidate: (id) => req('DELETE', `/api/candidates/${id}`).then(r => { inv('/api/candidates'); return r; }),

  // Payroll
  getPayroll: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/payroll' + (q ? '?' + q : ''));
  },
  createPayroll: (d) => req('POST', '/api/payroll', d).then(r => { inv('/api/payroll'); return r; }),
  loadPayrollData: (month) => req('POST', '/api/payroll/load', { month }).then(r => { inv('/api/payroll'); return r; }),
  createPayrollBatch: (month) => req('POST', '/api/payroll/batch', { month }).then(r => { inv('/api/payroll'); return r; }),
  exportPayslips: (month, confirmText) =>
    req('POST', '/api/payroll/export-payslips', { month, confirmText }).then(r => { inv('/api/payroll', '/api/invoices'); return r; }),
  updatePayroll: (id, d) => req('PUT', `/api/payroll/${id}`, d).then(r => { inv('/api/payroll'); return r; }),
  deletePayroll: (id) => req('DELETE', `/api/payroll/${id}`).then(r => { inv('/api/payroll'); return r; }),
  getPayrollAdjustmentSuggestions: (month) => req('GET', `/api/payroll-adjustments/suggestions?month=${encodeURIComponent(month)}`),
  applyPayrollAdjustments: (month, items) =>
    req('POST', '/api/payroll-adjustments/apply', { month, items }).then(r => { inv('/api/payroll'); return r; }),

  // Campaigns (marketing specific)
  getCampaigns: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/campaigns' + (q ? '?' + q : ''));
  },
  createCampaign: (d) => req('POST', '/api/campaigns', d).then(r => { inv('/api/campaigns'); return r; }),
  updateCampaign: (id, d) => req('PUT', `/api/campaigns/${id}`, d).then(r => { inv('/api/campaigns'); return r; }),
  deleteCampaign: (id) => req('DELETE', `/api/campaigns/${id}`).then(r => { inv('/api/campaigns'); return r; }),

  // Đánh giá hiệu suất (Performance Evaluation) — TTS workflow
  getEvalPeriods:   () => cachedGet('/api/eval-periods'),
  createEvalPeriod: (d) => req('POST', '/api/eval-periods', d).then(r => { inv('/api/eval-periods'); return r; }),
  getEvaluations: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/evaluations' + (q ? '?' + q : ''));
  },
  getEvaluation:     (id) => req('GET', `/api/evaluations/${id}`), // always fresh (workflow detail)
  assignEvaluation:  (d) => req('POST', '/api/evaluations', d).then(r => { inv('/api/evaluations'); return r; }),
  evalAction: (id, body) => req('POST', `/api/evaluations/${id}/action`, body).then(r => { inv('/api/evaluations'); return r; }),
  saveEvalPeriodNote: (id, note) => req('POST', `/api/eval-periods/${id}/note`, { note }).then(r => { inv('/api/eval-periods'); return r; }),
  getEvalReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/evaluations/report' + (q ? '?' + q : ''));
  },
  getEvalDashboard: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return cachedGet('/api/evaluations/dashboard' + (q ? '?' + q : ''));
  },
};
