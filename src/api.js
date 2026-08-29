// ════════════════════════════════════════════════
//  API helpers — all backend calls go through here
// ════════════════════════════════════════════════

import { EventBus } from './event-bus.js';

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
//  In-memory GET cache (Only for static lookups)
// ════════════════════════════════════════════════
// TTL values (ms) per URL prefix
const CACHE_TTL = {
  '/api/integrations/vietqr/banks': 24 * 60 * 60_000,
  '/api/leave-types':               30_000,
  '/api/departments':               30_000,
  '/api/wifi-whitelist':            30_000,
  '/api/attendance-locations':      30_000,
};

// Map of cacheKey → { data, ts, inflight }
export const _cache = new Map();
export function getCache() { return _cache; }

// Topic to cache prefix mappings for real-time invalidation
export const TOPIC_CACHE_MAP = {
  'leave': ['/api/leave-types', '/api/leave'],
  'departments': ['/api/departments'],
  'users': ['/api/departments', '/api/users'],
  'attendance': ['/api/attendance-locations', '/api/wifi-whitelist', '/api/attendance'],
  'wifi': ['/api/wifi-whitelist', '/api/attendance-locations'],
  'location_config': ['/api/wifi-whitelist', '/api/attendance-locations'],
  'tasks': ['/api/tasks', '/api/projects', '/api/task-groups'],
  'chat': ['/api/chat'],
  'notifications': ['/api/notifications'],
  'payroll': ['/api/payroll', '/api/invoices'],
  'invoices': ['/api/invoices', '/api/payroll'],
};

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
let _writeGen = 0;

// Wire EventBus to automatically invalidate related caches upon real-time events
export function setupCacheInvalidation(bus = EventBus) {
  if (!bus || typeof bus.on !== 'function') return () => {};
  return bus.on('*', (event, topic) => {
    _writeGen++;
    const topicKey = event?.topic || (typeof topic === 'string' ? topic.split(':')[0] : null);
    if (topicKey && TOPIC_CACHE_MAP[topicKey]) {
      TOPIC_CACHE_MAP[topicKey].forEach(prefix => invalidateCache(prefix));
    }
    const eventName = event?.event;
    if (eventName && typeof eventName === 'string') {
      const domain = eventName.split(':')[0];
      if (domain && TOPIC_CACHE_MAP[domain]) {
        TOPIC_CACHE_MAP[domain].forEach(prefix => invalidateCache(prefix));
      }
    }
  });
}

setupCacheInvalidation(EventBus);

// ────────────────────────────────────────────────
function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (_token) h['X-Auth-Token'] = _token;
  return h;
}

const _inflightGets = new Map();

async function req(method, path, body) {
  if (method === 'GET') {
    const key = path;
    if (_inflightGets.has(key)) {
      return _inflightGets.get(key);
    }
    const p = (async () => {
      try {
        const opts = { method, headers: headers() };
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
      } finally {
        _inflightGets.delete(key);
      }
    })();
    _inflightGets.set(key, p);
    return p;
  }

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

async function uploadForm(path, fields = {}, file = null) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, value);
  });
  if (file) form.append('file', file);
  const h = {};
  if (_token) h['X-Auth-Token'] = _token;
  const res = await fetch(apiUrl(path), { method: 'POST', headers: h, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Không thể tải tệp lên'), { status: res.status, data });
  return data;
}

async function fetchBlob(path) {
  const h = {};
  if (_token) h['X-Auth-Token'] = _token;
  const res = await fetch(apiUrl(path), { headers: h });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || 'Không thể tải dữ liệu'), { status: res.status, data });
  }
  return {
    blob: await res.blob(),
    filename: decodeURIComponent((res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/i)?.[1] || ''),
  };
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
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('hr-data-mutated', { detail: { prefixes } }));
  }
}

// ════════════════════════════════════════════════
export const api = {
  // Raw (bypass cache — for non-GET or special cases)
  get:    (path) => req('GET', path),
  post:   (path, body) => req('POST', path, body),
  put:    (path, body) => req('PUT', path, body),
  patch:  (path, body) => req('PATCH', path, body),
  delete: (path) => req('DELETE', path),
  uploadFile: (path, file) => uploadFile(path, file),

  // Auth (never cached)
  login:          (login, password) => req('POST', '/api/auth/login', { login, password }),
  me:             () => req('GET', '/api/auth/me'),
  logout:         () => req('POST', '/api/auth/logout'),
  changePassword: (old_password, new_password) =>
    req('PUT', '/api/auth/change-password', { old_password, new_password }),

  // Users
  getUsers:   () => req('GET', '/api/users'),
  getEmployeeDirectory: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined)).toString();
    return req('GET', '/api/users/directory' + (q ? '?' + q : ''));
  },
  getEmployeeProfile: (id) => req('GET', `/api/users/${id}/profile`),
  updateEmployeeProfile: (id, data) =>
    req('PATCH', `/api/users/${id}/profile`, data).then(r => { inv('/api/users', '/api/employees', '/api/attendance', '/api/tasks', '/api/invoices'); return r; }),
  getEmployeeTimeline: (id) => req('GET', `/api/users/${id}/timeline`),
  getEmployeeAudit: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/api/users/${id}/audit` + (q ? '?' + q : ''));
  },
  getEmployeeDocuments: (id) => req('GET', `/api/users/${id}/documents`),
  uploadEmployeeDocument: (id, data, file) =>
    uploadForm(`/api/users/${id}/documents`, data, file).then(r => { inv('/api/users'); return r; }),
  deleteEmployeeDocument: (id, documentId) =>
    req('DELETE', `/api/users/${id}/documents/${documentId}`).then(r => { inv('/api/users'); return r; }),
  getEmployeeDocumentBlob: (id, documentId, disposition = 'inline') =>
    fetchBlob(`/api/users/${id}/documents/${documentId}?disposition=${encodeURIComponent(disposition)}`),
  getEmployeeAlerts: (windowDays = 30) => req('GET', `/api/users/alerts?window=${encodeURIComponent(windowDays)}`),
  getNotifications: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined)).toString();
    return req('GET', '/api/notifications' + (q ? '?' + q : ''));
  },
  exportEmployeeDirectory: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined)).toString();
    return fetchBlob('/api/users/export.xls' + (q ? '?' + q : ''));
  },
  createUser: (d) => req('POST', '/api/users', d).then(r => { inv('/api/users', '/api/employees'); return r; }),
  updateUser: (id, d) => req('PUT', `/api/users/${id}`, d).then(r => { inv('/api/users', '/api/employees', '/api/attendance', '/api/tasks', '/api/invoices'); return r; }),
  uploadUserDocument: (id, kind, file) => uploadFile(`/api/users/${id}/documents/${kind}`, file).then(r => { inv('/api/users'); return r; }),
  deleteUserDocument: (id, kind) => req('DELETE', `/api/users/${id}/documents/${kind}`).then(r => { inv('/api/users'); return r; }),
  deleteUser: (id) => req('DELETE', `/api/users/${id}`).then(r => { inv('/api/users', '/api/employees', '/api/attendance', '/api/tasks', '/api/invoices'); return r; }),
  // Safe minimal user fields
  getUsersBasic: () => req('GET', '/api/users/basic'),
  // Public reference data is fetched through our Worker
  getVietqrBanks: () => cachedGet('/api/integrations/vietqr/banks'),
  // Lifecycle status
  changeLifecycleStatus: (id, status, reason) =>
    req('PUT', `/api/users/${id}/lifecycle`, { status, reason }).then(r => { inv('/api/users'); return r; }),

  // Asset handover
  getAssets: () => req('GET', '/api/assets'),
  createAsset: (d) => req('POST', '/api/assets', d).then(r => { inv('/api/assets'); return r; }),
  updateAsset: (id, d) => req('PUT', `/api/assets/${id}`, d).then(r => { inv('/api/assets'); return r; }),
  deleteAsset: (id) => req('DELETE', `/api/assets/${id}`).then(r => { inv('/api/assets'); return r; }),
  revealAssetCredential: (id) => req('POST', `/api/assets/${id}/reveal-credential`),
  getAssetHistory: (id) => req('GET', `/api/assets/${id}/history`),

  // Attendance
  getAttendance: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/attendance' + (q ? '?' + q : ''));
  },
  getAttendanceToday: () => req('GET', '/api/attendance/today'),
  getAttendanceCheckinPoints: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined)).toString();
    return req('GET', '/api/attendance/checkin-points' + (q ? '?' + q : ''));
  },
  getMyAttendanceCompliance: (month = '') => req('GET', '/api/attendance/my-compliance' + (month ? `?month=${encodeURIComponent(month)}` : '')),
  getAttendanceSummary: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/attendance/summary' + (q ? '?' + q : ''));
  },
  getAttendanceEmployees: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/attendance/employees' + (q ? '?' + q : ''));
  },
  getEmployeeAttendanceSummary: (employeeId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/api/attendance/employees/${employeeId}/summary` + (q ? '?' + q : ''));
  },
  registerAttendance: (body) => req('POST', '/api/attendance/register', body).then(r => { inv('/api/attendance'); return r; }),
  checkin:  (body) => req('POST', '/api/attendance/checkin', body).then(r => { inv('/api/attendance'); return r; }),
  checkout: (body) => req('POST', '/api/attendance/checkout', body).then(r => { inv('/api/attendance'); return r; }),
  reviewAttendanceLocation: (id, data) => req('POST', `/api/attendance/${id}/location-review`, data).then(r => { inv('/api/attendance'); return r; }),
  updateAttendance: (id, d) => req('PUT', `/api/attendance/${id}`, d).then(r => { inv('/api/attendance'); return r; }),
  deleteAttendance: (id) => req('DELETE', `/api/attendance/${id}`).then(r => { inv('/api/attendance'); return r; }),
  addAttendanceBatch: (d, dryRun = false) =>
    req('POST', '/api/attendance/batch' + (dryRun ? '?dry_run=1' : ''), d).then(r => { inv('/api/attendance', '/api/attendance/employees', '/api/invoices'); return r; }),
  getOvertimeRequests: (params = {}) => { const q = new URLSearchParams(params).toString(); return req('GET', '/api/overtime-requests' + (q ? '?' + q : '')); },
  createOvertimeRequest: (d) => req('POST', '/api/overtime-requests', d).then(r => { inv('/api/attendance'); return r; }),
  decideOvertimeRequest: (id, action, d = {}) => req('POST', `/api/overtime-requests/${id}/${action}`, d).then(r => { inv('/api/attendance', '/api/invoices'); return r; }),
  getOvertimeForms: (params = {}) => { const q = new URLSearchParams(params).toString(); return req('GET', '/api/overtime-forms' + (q ? '?' + q : '')); },
  createOvertimeForm: (d) => req('POST', '/api/overtime-forms', d).then(r => { inv('/api/attendance', '/api/invoices'); return r; }),
  updateOvertimeForm: (id, d) => req('PUT', `/api/overtime-forms/${id}`, d).then(r => { inv('/api/attendance'); return r; }),
  submitOvertimeForm: (id) => req('POST', `/api/overtime-forms/${id}/submit`, {}).then(r => { inv('/api/attendance'); return r; }),
  decideOvertimeForm: (id, d) => req('POST', `/api/overtime-forms/${id}/decision`, d).then(r => { inv('/api/attendance', '/api/invoices'); return r; }),
  previewAttendanceImport: (d) => req('POST', '/api/attendance-imports/preview', d),
  commitAttendanceImport: (d) => req('POST', '/api/attendance-imports/commit', d).then(r => { inv('/api/users', '/api/employees', '/api/attendance', '/api/invoices'); return r; }),
  getCompanyHolidays: () => req('GET', '/api/company-holidays'),
  createCompanyHoliday: (d) => req('POST', '/api/company-holidays', d),
  updateCompanyHoliday: (id, d) => req('PUT', `/api/company-holidays/${id}`, d),
  deleteCompanyHoliday: (id) => req('DELETE', `/api/company-holidays/${id}`),

  // WiFi
  getWifi:    () => cachedGet('/api/wifi-whitelist'),
  createWifi: (d) => req('POST', '/api/wifi-whitelist', d).then(r => { inv('/api/wifi-whitelist'); return r; }),
  updateWifi: (id, d) => req('PUT', `/api/wifi-whitelist/${id}`, d).then(r => { inv('/api/wifi-whitelist'); return r; }),
  deleteWifi: (id) => req('DELETE', `/api/wifi-whitelist/${id}`).then(r => { inv('/api/wifi-whitelist'); return r; }),
  getAttendanceLocations: () => cachedGet('/api/attendance-locations'),
  verifyAttendanceLocation: (d) => req('POST', '/api/attendance-locations/verify', d),
  createAttendanceLocation: (d) => req('POST', '/api/attendance-locations', d).then(r => { inv('/api/attendance-locations'); return r; }),
  updateAttendanceLocation: (id, d) => req('PUT', `/api/attendance-locations/${id}`, d).then(r => { inv('/api/attendance-locations'); return r; }),
  deleteAttendanceLocation: (id) => req('DELETE', `/api/attendance-locations/${id}`).then(r => { inv('/api/attendance-locations'); return r; }),

  // Database Admin
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
    return req('GET', '/api/tasks' + (q ? '?' + q : ''));
  },
  getTaskProjects: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/task-projects' + (q ? '?' + q : ''));
  },
  getTaskProjectTimeline: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', `/api/task-projects/${id}/timeline` + (q ? '?' + q : ''));
  },
  createTaskProject: (d) => req('POST', '/api/task-projects', d).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  updateTaskProject: (id, d) => req('PUT', `/api/task-projects/${id}`, d).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  archiveTaskProject: (id) => req('DELETE', `/api/task-projects/${id}`).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  deleteTaskProjectPermanent: (id) => req('DELETE', `/api/task-projects/${id}?permanent=1`).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  saveTaskProjectMembers: (id, members) => req('PUT', `/api/task-projects/${id}/members`, { members }).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  saveTaskProjectGroupMembers: (department, members) => req('PUT', '/api/task-project-groups/members', { department, members }).then(r => { inv('/api/task-projects', '/api/tasks'); return r; }),
  getTaskProjectMembers: (id) => req('GET', `/api/task-projects/${id}/members`),
  importMyxteamProject: (project) => req('POST', '/api/task-imports/myxteam/project', { project }).then(r => {
    inv('/api/task-projects', '/api/task-groups', '/api/tasks');
    return r;
  }),
  getTaskGroups: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/task-groups' + (q ? '?' + q : ''));
  },
  createTaskGroup: (d) => req('POST', '/api/task-groups', d).then(r => { inv('/api/task-groups', '/api/tasks'); return r; }),
  updateTaskGroup: (id, d) => req('PUT', `/api/task-groups/${id}`, d).then(r => { inv('/api/task-groups', '/api/tasks'); return r; }),
  archiveTaskGroup: (id) => req('DELETE', `/api/task-groups/${id}`).then(r => { inv('/api/task-groups', '/api/tasks'); return r; }),
  getTaskLabels: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/task-labels' + (q ? '?' + q : ''));
  },
  createTaskLabel: (d) => req('POST', '/api/task-labels', d).then(r => { inv('/api/task-labels', '/api/tasks'); return r; }),
  updateTaskLabel: (id, d) => req('PUT', `/api/task-labels/${id}`, d).then(r => { inv('/api/task-labels', '/api/tasks'); return r; }),
  deleteTaskLabel: (id) => req('DELETE', `/api/task-labels/${id}`).then(r => { inv('/api/task-labels', '/api/tasks'); return r; }),
  getTask:    (id) => req('GET', `/api/tasks/${id}`),
  createTask: (d) => req('POST', '/api/tasks', d).then(r => { inv('/api/tasks'); return r; }),
  updateTask: (id, d) => req('PUT', `/api/tasks/${id}`, d).then(r => { inv('/api/tasks'); return r; }),
  deleteTask: (id) => req('DELETE', `/api/tasks/${id}`).then(r => { inv('/api/tasks'); return r; }),
  reorderTasks: (d) => req('POST', '/api/tasks/reorder', d).then(r => { inv('/api/tasks'); return r; }),
  createSubtask: (taskId, d) => req('POST', `/api/tasks/${taskId}/subtasks`, d).then(r => { inv('/api/tasks'); return r; }),
  updateSubtask: (id, d) => req('PUT', `/api/subtasks/${id}`, d).then(r => { inv('/api/tasks'); return r; }),
  getComments: (taskId) => req('GET', `/api/tasks/${taskId}/comments`),
  addComment:  (taskId, content, mentions) => req('POST', `/api/tasks/${taskId}/comments`, { content, mentions: mentions || [] }).then(r => { inv('/api/tasks'); return r; }),
  getTaskCompletionSubscriptions: () => req('GET', '/api/tasks/completion-subscriptions'),
  toggleTaskCompletionSubscription: (d) => req('POST', '/api/tasks/completion-subscriptions/toggle', d),
  addTaskFollower: (taskId, userId) => req('POST', `/api/tasks/${taskId}/followers`, userId ? { user_id: userId } : {}).then(r => { inv('/api/tasks'); return r; }),
  removeTaskFollower: (taskId, userId) => req('DELETE', `/api/tasks/${taskId}/followers/${userId}`).then(r => { inv('/api/tasks'); return r; }),
  getUnreadMentionCount: () => req('GET', '/api/notifications/task-mentions/unread-count'),
  getTaskMentions: () => req('GET', '/api/notifications/task-mentions'),
  markMentionRead: (id) => req('PATCH', `/api/notifications/task-mentions/${id}/read`),

  // Task attachments
  getTaskAttachments: (taskId) => req('GET', `/api/tasks/${taskId}/attachments`),
  uploadTaskAttachment: async (taskId, file) => {
    const form = new FormData();
    form.append('file', file);
    const opts = { method: 'POST', headers: {} };
    if (_token) opts.headers['X-Auth-Token'] = _token;
    opts.body = form;
    const r = await fetch(apiUrl(`/api/tasks/${taskId}/attachments`), opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Upload thất bại');
    inv('/api/tasks');
    return data;
  },
  deleteTaskAttachment: (taskId, attachmentId) => req('DELETE', `/api/tasks/${taskId}/attachments/${attachmentId}`).then(r => { inv('/api/tasks'); return r; }),

  // Invoices
  getInvoices: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/invoices' + (q ? '?' + q : ''));
  },
  getInvoice:    (id) => req('GET', `/api/invoices/${id}`),
  createInvoice: (d) => req('POST', '/api/invoices', d).then(r => { inv('/api/invoices'); return r; }),
  updateInvoice: (id, d) => req('PUT', `/api/invoices/${id}`, d).then(r => { inv('/api/invoices'); return r; }),
  deleteInvoice: (id) => req('DELETE', `/api/invoices/${id}`).then(r => { inv('/api/invoices'); return r; }),
  confirmInvoice: (id) => req('POST', `/api/invoices/${id}/confirm`).then(r => { inv('/api/invoices'); return r; }),
  requestInvoiceReview: (id, d) => req('POST', `/api/invoices/${id}/review-request`, d).then(r => { inv('/api/invoices'); return r; }),
  resolveInvoiceReview: (id, d) => req('POST', `/api/invoices/${id}/resolve-review`, d).then(r => { inv('/api/invoices'); return r; }),

  // Settings
  getSettings:  () => req('GET', '/api/settings'),
  saveSettings: (d) => req('PUT', '/api/settings', d).then(r => { inv('/api/settings'); return r; }),

  // IP
  getIp: () => req('GET', '/api/get-ip'),

  // Departments
  getDepartments:   () => cachedGet('/api/departments'),
  createDepartment: (d) => req('POST', '/api/departments', d).then(r => { inv('/api/departments', '/api/employees'); return r; }),
  updateDepartment: (id, d) => req('PUT', `/api/departments/${id}`, d).then(r => { inv('/api/departments', '/api/employees'); return r; }),
  deleteDepartment: (id) => req('DELETE', `/api/departments/${id}`).then(r => { inv('/api/departments', '/api/employees'); return r; }),

  // Employees
  getEmployees:   () => req('GET', '/api/employees'),
  createEmployee: (d) => req('POST', '/api/employees', d).then(r => { inv('/api/employees'); return r; }),
  updateEmployee: (id, d) => req('PUT', `/api/employees/${id}`, d).then(r => { inv('/api/employees'); return r; }),
  deleteEmployee: (id) => req('DELETE', `/api/employees/${id}`).then(r => { inv('/api/employees'); return r; }),

  // Leave requests
  getLeave: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/leave' + (q ? '?' + q : ''));
  },
  createLeave: (d) => req('POST', '/api/leave', d).then(r => { inv('/api/leave', '/api/attendance', '/api/payroll'); return r; }),
  updateLeave: (id, d) => req('PUT', `/api/leave/${id}`, d).then(r => { inv('/api/leave', '/api/attendance', '/api/payroll'); return r; }),
  deleteLeave: (id) => req('DELETE', `/api/leave/${id}`).then(r => { inv('/api/leave', '/api/attendance', '/api/payroll'); return r; }),
  getLeaveTypes: (includeInactive = false) => cachedGet('/api/leave-types' + (includeInactive ? '?includeInactive=1' : '')),
  createLeaveType: (d) => req('POST', '/api/leave-types', d).then(r => { inv('/api/leave-types'); return r; }),
  updateLeaveType: (id, d) => req('PUT', `/api/leave-types/${id}`, d).then(r => { inv('/api/leave-types'); return r; }),
  deleteLeaveType: (id) => req('DELETE', `/api/leave-types/${id}`).then(r => { inv('/api/leave-types'); return r; }),
  getLeaveBalances: (params = {}) => { const q = new URLSearchParams(params).toString(); return req('GET', '/api/leave/balances' + (q ? '?' + q : '')); },
  adjustLeaveBalance: (d) => req('POST', '/api/leave/balances', d).then(r => { inv('/api/leave', '/api/attendance', '/api/payroll'); return r; }),
  uploadLeaveDocument: (file, label = '') => uploadForm('/api/leave/uploads', { label }, file),
  getLeaveDocuments: (leaveId) => req('GET', `/api/leave/${leaveId}/documents`),
  getLeaveDocumentBlob: (leaveId, documentId, disposition = 'inline') => fetchBlob(`/api/leave/${leaveId}/documents/${documentId}?disposition=${encodeURIComponent(disposition)}`),

  // Candidates / Recruitment
  getCandidates: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/candidates' + (q ? '?' + q : ''));
  },
  createCandidate: (d) => req('POST', '/api/candidates', d).then(r => { inv('/api/candidates'); return r; }),
  updateCandidate: (id, d) => req('PUT', `/api/candidates/${id}`, d).then(r => { inv('/api/candidates'); return r; }),
  deleteCandidate: (id) => req('DELETE', `/api/candidates/${id}`).then(r => { inv('/api/candidates'); return r; }),

  // Payroll
  getPayroll: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/payroll' + (q ? '?' + q : ''));
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
  dismissPayrollAdjustment: (month, sourceRef) =>
    req('POST', '/api/payroll-adjustments/dismiss', { month, source_ref: sourceRef }).then(r => { inv('/api/payroll'); return r; }),
  previewPenaltyPolicyReset: () => req('GET', '/api/payroll-adjustments/penalty-policy-reset-preview'),
  resetPenaltyPolicy: () => req('POST', '/api/payroll-adjustments/penalty-policy-reset', { confirmation: 'RESET_PENALTY_POLICY_2026_08' }).then(r => { inv('/api/payroll'); return r; }),

  // Campaigns
  getCampaigns: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/campaigns' + (q ? '?' + q : ''));
  },
  createCampaign: (d) => req('POST', '/api/campaigns', d).then(r => { inv('/api/campaigns'); return r; }),
  updateCampaign: (id, d) => req('PUT', `/api/campaigns/${id}`, d).then(r => { inv('/api/campaigns'); return r; }),
  deleteCampaign: (id) => req('DELETE', `/api/campaigns/${id}`).then(r => { inv('/api/campaigns'); return r; }),

  // Performance Evaluation
  getEvalPeriods:   () => req('GET', '/api/eval-periods'),
  createEvalPeriod: (d) => req('POST', '/api/eval-periods', d).then(r => { inv('/api/eval-periods'); return r; }),
  getEvaluations: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/evaluations' + (q ? '?' + q : ''));
  },
  getEvaluation:     (id) => req('GET', `/api/evaluations/${id}`),
  assignEvaluation:  (d) => req('POST', '/api/evaluations', d).then(r => { inv('/api/evaluations'); return r; }),
  evalAction: (id, body) => req('POST', `/api/evaluations/${id}/action`, body).then(r => { inv('/api/evaluations'); return r; }),
  saveEvalPeriodNote: (id, note) => req('POST', `/api/eval-periods/${id}/note`, { note }).then(r => { inv('/api/eval-periods'); return r; }),
  getEvalReport: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/evaluations/report' + (q ? '?' + q : ''));
  },
  getEvalDashboard: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('GET', '/api/evaluations/dashboard' + (q ? '?' + q : ''));
  },
  getAdminDashboard: () => req('GET', '/api/dashboard/admin'),
  // KPIs
  getKpiDashboard: (params = {}) => { const q = new URLSearchParams(params).toString(); return req('GET', '/api/kpis/dashboard' + (q ? '?' + q : '')); },
  getKpis: (params = {}) => { const q = new URLSearchParams(params).toString(); return req('GET', '/api/kpis' + (q ? '?' + q : '')); },
  saveKpis: (data) => req('POST', '/api/kpis', data).then(r => { inv('/api/kpis'); return r; }),
  submitKpis: (id, items) => req('POST', `/api/kpis/${id}/submit`, { items }).then(r => { inv('/api/kpis'); return r; }),
  reviewKpis: (id, approve, note = '', manual_scores = {}, item_notes = {}) => req('POST', `/api/kpis/${id}/review`, { approve, note, manual_scores, item_notes }).then(r => { inv('/api/kpis'); return r; }),
  saveKpiEvidence: (planId, itemId, evidence) => req('POST', `/api/kpis/${planId}/evidence`, { item_id: itemId, evidence }).then(r => { inv('/api/kpis'); return r; }),
  getKpiSnapshot: (planId) => req('GET', `/api/kpis/${planId}/snapshot`),
  getKpiTemplates: () => req('GET', '/api/kpi-templates'),
  saveKpiTemplate: (data) => req('POST', '/api/kpi-templates', data).then(r => { inv('/api/kpi-templates'); return r; }),
  applyKpiTemplate: (id, data) => req('POST', `/api/kpi-templates/${id}/apply`, data).then(r => { inv('/api/kpis'); return r; }),
};
