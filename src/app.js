// ════════════════════════════════════════════════
//  HR Manager — Main App Entry
// ════════════════════════════════════════════════
import { api, setToken, loadToken, clearCache } from './api.js';
import { setAvatar, toast, initials, avatarColor, closeModal } from './utils.js';

// ── Lazy view imports ───────────────────────────
let _viewModules = {};
async function getView(name) {
  if (!_viewModules[name]) {
    if (name === 'dashboard')    _viewModules[name] = await import('./views/dashboard.js');
    else if (name === 'attendance')  _viewModules[name] = await import('./views/attendance.js');
    else if (name === 'tasks')       _viewModules[name] = await import('./views/tasks.js');
    else if (name === 'invoices')    _viewModules[name] = await import('./views/invoices.js');
    else if (name === 'users')       _viewModules[name] = await import('./views/users.js');
    else if (name === 'wifi')        _viewModules[name] = await import('./views/wifi.js');
    else if (name === 'settings')    _viewModules[name] = await import('./views/settings.js');
    else if (name === 'taskpanel')   _viewModules[name] = await import('./views/taskpanel.js');
    else if (name === 'departments') _viewModules[name] = await import('./views/departments.js');
    else if (name === 'recruitment') _viewModules[name] = await import('./views/recruitment.js');
    else if (name === 'payroll')     _viewModules[name] = await import('./views/payroll.js');
    else if (name === 'leave')       _viewModules[name] = await import('./views/leave.js');
    else if (name === 'campaigns')   _viewModules[name] = await import('./views/campaigns.js');
    else if (name === 'evaluation')  _viewModules[name] = await import('./views/evaluation.js');
  }
  return _viewModules[name];
}

// ── State ───────────────────────────────────────
let me = null;
let _currentView = null;
let _contentCleanup = null;

// DOM view cache — stores { node, cleanup, ts } per view name
// Cached nodes stay in contentEl but are hidden (display:none) when not active
// Switching back to a view is instant (just show the node), no re-render needed
const _viewCache = new Map();
const VIEW_CACHE_TTL = 90_000; // 90 s — force re-render after this long

// Views that must ALWAYS re-render (they have live clocks / realtime state)
const NO_CACHE_VIEWS = new Set(['attendance']);

// ── DOM refs ────────────────────────────────────
const loginScreen  = document.getElementById('login-screen');
const appEl        = document.getElementById('app');
const contentEl    = document.getElementById('content');
const sidebarEl    = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

// ════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════
const loginForm  = document.getElementById('login-form');
const loginUser  = document.getElementById('login-user');
const loginPw    = document.getElementById('login-pw');
const loginError = document.getElementById('login-error');
const loginBtn   = document.getElementById('login-btn');
const pwEye      = document.getElementById('pw-eye');

pwEye.addEventListener('click', () => {
  loginPw.type = loginPw.type === 'password' ? 'text' : 'password';
  pwEye.textContent = loginPw.type === 'password' ? '👁' : '🙈';
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = loginUser.value.trim();
  const pw   = loginPw.value;
  if (!user || !pw) { showLoginError('Vui lòng nhập đầy đủ thông tin'); return; }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Đang đăng nhập...';
  loginError.classList.add('hidden');
  try {
    const { token, user: userData } = await api.login(user, pw);
    setToken(token);
    me = userData;
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    initApp();
  } catch(e) {
    showLoginError(e.message || 'Đăng nhập thất bại');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Đăng nhập';
  }
});

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

// ════════════════════════════════════════════════
//  BOOT — try resuming session
// ════════════════════════════════════════════════
async function boot() {
  loadToken();
  try {
    const { user } = await api.me();
    me = user;
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    initApp();
  } catch(_) {
    loginScreen.classList.remove('hidden');
    appEl.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════
//  APP INIT
// ════════════════════════════════════════════════
function initApp() {
  setAvatar(document.getElementById('sidebar-av'), me.full_name, me.avatar_color, me.avatar_initials);
  document.getElementById('sidebar-name').textContent = me.full_name;
  document.getElementById('sidebar-role').textContent = roleLabel(me.role);
  setAvatar(document.getElementById('header-av'), me.full_name, me.avatar_color, me.avatar_initials);

  // Admin nav visibility
  const isManager = me.role === 'admin' || me.role === 'manager';
  const adminNav = document.getElementById('admin-nav');
  if (!isManager) adminNav.style.display = 'none';

  startClock();

  document.getElementById('btn-menu').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);
  document.getElementById('header-av-btn').addEventListener('click', () => navigate('#/settings'));

  document.querySelectorAll('.nav-item[data-nav]').forEach(link => {
    link.addEventListener('click', closeSidebar);
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await api.logout(); } catch(_) {}
    setToken(null);
    me = null;
    // Clear all caches on logout
    clearCache();
    _destroyAllViews();
    appEl.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginUser.value = '';
    loginPw.value = '';
  });

  document.getElementById('btn-change-pw').addEventListener('click', () => {
    closeSidebar();
    navigate('#/settings');
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  window.addEventListener('hashchange', route);
  route();
}

// ════════════════════════════════════════════════
//  ROUTER  (DOM-level view cache)
// ════════════════════════════════════════════════
async function route() {
  const hash = location.hash || '#/dashboard';
  const path = hash.replace('#/', '').split('/')[0] || 'dashboard';

  document.querySelectorAll('.nav-item[data-nav]').forEach(link => {
    link.classList.toggle('active', link.dataset.nav === path);
  });

  // Hide the currently visible view node (keep it alive in DOM)
  if (_currentView && _currentView !== path) {
    const prev = _viewCache.get(_currentView);
    if (prev) prev.node.style.display = 'none';
  }

  const now = Date.now();
  const cached = _viewCache.get(path);
  const isFresh = cached && !NO_CACHE_VIEWS.has(path) && (now - cached.ts) < VIEW_CACHE_TTL;

  if (isFresh) {
    // Instant — just show the cached node, no fetch needed
    cached.node.style.display = '';
    _contentCleanup = cached.cleanup || null;
    _currentView = path;
    return;
  }

  // Stale or missing — tear down old node for this view if it exists
  if (cached) {
    if (cached.cleanup) cached.cleanup();
    cached.node.remove();
    _viewCache.delete(path);
  }

  // Create a fresh container node for this view
  const viewNode = document.createElement('div');
  viewNode.className = 'view-container';
  contentEl.appendChild(viewNode);

  // Hide all other cached view nodes
  _viewCache.forEach((entry, name) => {
    if (name !== path) entry.node.style.display = 'none';
  });

  _currentView = path;

  try {
    const mod = await getView(path);
    const fnName = 'render' + path.charAt(0).toUpperCase() + path.slice(1);
    if (mod && typeof mod[fnName] === 'function') {
      await mod[fnName](viewNode, me);
      const cleanup = viewNode._cleanup || null;
      viewNode._cleanup = null;
      _contentCleanup = cleanup;
      _viewCache.set(path, { node: viewNode, cleanup, ts: Date.now() });
    } else {
      viewNode.innerHTML = `<div class="empty-state"><div class="empty-icon">404</div><div class="empty-text">Trang không tìm thấy</div></div>`;
      _viewCache.set(path, { node: viewNode, cleanup: null, ts: Date.now() });
    }
  } catch(e) {
    console.error('Route error:', e);
    viewNode.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
    _viewCache.set(path, { node: viewNode, cleanup: null, ts: Date.now() });
  }
}

// Destroy all cached view nodes (e.g. on logout)
function _destroyAllViews() {
  _viewCache.forEach(entry => {
    if (entry.cleanup) entry.cleanup();
    entry.node.remove();
  });
  _viewCache.clear();
  _currentView = null;
  _contentCleanup = null;
}

// Invalidate a specific view's DOM cache so it re-renders fresh on next visit
export function invalidateView(name) {
  const entry = _viewCache.get(name);
  if (entry) {
    if (entry.cleanup) entry.cleanup();
    entry.node.remove();
    _viewCache.delete(name);
  }
}

export function navigate(hash) {
  location.hash = hash;
}

// ════════════════════════════════════════════════
//  TASK PANEL
// ════════════════════════════════════════════════
export async function openTaskPanel(taskId) {
  const mod = await getView('taskpanel');
  mod.openPanel(taskId, me);
}

// ════════════════════════════════════════════════
//  SIDEBAR
// ════════════════════════════════════════════════
function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarOverlay.classList.add('active');
}
function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

// ════════════════════════════════════════════════
//  CLOCK
// ════════════════════════════════════════════════
function startClock() {
  const dateEl  = document.getElementById('header-date');
  const clockEl = document.getElementById('header-clock');
  function tick() {
    const now = new Date();
    if (dateEl)  dateEl.textContent  = now.toLocaleDateString('vi-VN', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function roleLabel(r) {
  const map = {
    admin:    '👑 Quản trị viên',
    manager:  '⭐ Quản lý',
    employee: '👤 Nhân viên',
  };
  return map[r] || r || '—';
}

// ════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════
window.onerror = (msg, src, line, col, err) => console.error('APP ERROR:', msg, err);
boot();
