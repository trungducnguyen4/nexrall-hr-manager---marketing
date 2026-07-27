// ════════════════════════════════════════════════
//  HR Manager — Main App Entry
// ════════════════════════════════════════════════
import { api, setToken, loadToken, clearCache } from './api.js?v=20260722-payroll-export-ux';
import { setAvatar, toast, initials, avatarColor, closeModal } from './utils.js?v=20260722-payroll-export-ux';
import { icon } from './icons.js';

// ── Lazy view imports ───────────────────────────
let _viewModules = {};
async function getView(name) {
  if (!_viewModules[name]) {
    if (name === 'dashboard')    _viewModules[name] = await import('./views/dashboard.js');
    else if (name === 'attendance')  _viewModules[name] = await import('./views/attendance.js?v=20260727-employee-summary');
    else if (name === 'tasks')       _viewModules[name] = await import('./views/tasks.js?v=20260722-plain-task-groups');
    else if (name === 'invoices')    _viewModules[name] = await import('./views/invoices.js?v=20260722-payroll-export-ux');
    else if (name === 'users')       _viewModules[name] = await import('./views/users.js?v=20260722-role-label2');
    else if (name === 'wifi')        _viewModules[name] = await import('./views/wifi.js');
    else if (name === 'settings')    _viewModules[name] = await import('./views/settings.js');
    else if (name === 'taskpanel')   _viewModules[name] = await import('./views/taskpanel.js?v=20260722-rich-task-editor');
    else if (name === 'departments') _viewModules[name] = await import('./views/departments.js');
    else if (name === 'recruitment') _viewModules[name] = await import('./views/recruitment.js');
    else if (name === 'payroll')     _viewModules[name] = await import('./views/payroll.js?v=20260722-payroll-export-ux');
    else if (name === 'leave')       _viewModules[name] = await import('./views/leave.js');
    else if (name === 'campaigns')   _viewModules[name] = await import('./views/campaigns.js');
    else if (name === 'evaluation')  _viewModules[name] = await import('./views/evaluation.js?v=20260722-reward-policy');
    else if (name === 'db-admin')    _viewModules[name] = await import('./views/dbadmin.js');
  }
  return _viewModules[name];
}

// ── State ───────────────────────────────────────
let me = null;
let _currentView = null;
let _contentCleanup = null;
let _appInitialized = false;

// DOM view cache — stores { node, cleanup, ts } per view name
// Cached nodes stay in contentEl but are hidden (display:none) when not active
// Switching back to a view is instant (just show the node), no re-render needed
const _viewCache = new Map();
const VIEW_CACHE_TTL = 90_000; // 90 s — force re-render after this long

// Views that must ALWAYS re-render (they have live clocks / realtime state)
const NO_CACHE_VIEWS = new Set(['attendance', 'tasks']);
let _routeGeneration = 0;

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
  loginUser.value = '';
  loginPw.value = '';
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');

  if (!loadToken()) return;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Đang kiểm tra phiên...';
  loginError.classList.add('hidden');
  try {
    const { user: userData } = await api.me();
    me = userData;
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    initApp();
  } catch (_) {
    setToken(null);
    clearCache();
    loginUser.value = '';
    loginPw.value = '';
    loginScreen.classList.remove('hidden');
    appEl.classList.add('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Đăng nhập';
  }
}

// ════════════════════════════════════════════════
//  APP INIT
// ════════════════════════════════════════════════
function initApp() {
  normalizeIcons(document);
  setAvatar(document.getElementById('sidebar-av'), me.full_name, me.avatar_color, me.avatar_initials);
  document.getElementById('sidebar-name').textContent = me.full_name;
  document.getElementById('sidebar-role').textContent = roleLabel(me.role);
  setAvatar(document.getElementById('header-av'), me.full_name, me.avatar_color, me.avatar_initials);

  // Admin nav visibility
  const isManager = me.role === 'admin' || me.role === 'manager';
  const adminNav = document.getElementById('admin-nav');
  if (!isManager) adminNav.style.display = 'none';
  document.getElementById('db-admin-nav-item')?.classList.toggle('hidden', me.role !== 'admin');

  if (_appInitialized) {
    route();
    return;
  }
  _appInitialized = true;

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

  window.addEventListener('hashchange', route);
  route();
}

const GLYPH_ICONS = {
  '🏠': 'layoutDashboard',
  '⏱️': 'clock3',
  '⏱': 'clock3',
  '🏖️': 'calendarDays',
  '🏖': 'calendarDays',
  '📋': 'clipboardList',
  '💵': 'banknote',
  '💰': 'banknote',
  '📈': 'barChart3',
  '📊': 'barChart3',
  '👥': 'users',
  '🏢': 'building2',
  '🎯': 'target',
  '📣': 'megaphone',
  '📡': 'wifi',
  '⚙️': 'settings',
  '⚙': 'settings',
  '🔑': 'keyRound',
  '🚪': 'logOut',
  '☰': 'menu',
  '✕': 'x',
  '✖': 'x',
  '←': 'arrowLeft',
  '→': 'arrowRight',
  '✅': 'circleCheck',
  '❌': 'circleX',
  '⚠️': 'triangleAlert',
  '⚠': 'triangleAlert',
  '🔒': 'lock',
  '🔓': 'lockOpen',
  '⛔': 'ban',
  '✏️': 'pencil',
  '✏': 'pencil',
  '🗑️': 'trash2',
  '🗑': 'trash2',
  '🔍': 'search',
  '📅': 'calendarDays',
  '🗓️': 'calendarDays',
  '🗓': 'calendarDays',
  '🕒': 'clock3',
  '⏳': 'clock3',
  '⏰': 'clock3',
  '🔄': 'refreshCw',
  '📌': 'mapPin',
  '➡': 'arrowRight',
  '⬆': 'arrowUp',
  '⬇': 'arrowDown',
  '🔥': 'triangleAlert',
  '💳': 'creditCard',
  '👑': 'shieldAlert',
  '⭐': 'star',
  '👤': 'userRound',
  '🎓': 'badgeCheck',
  '🧪': 'clipboardCheck',
  '📝': 'fileText',
  '🗂️': 'library',
  '🗂': 'library',
  '🎁': 'gift',
  '▶️': 'arrowRight',
  '▶': 'arrowRight',
  '📱': 'smartPhone',
  '📧': 'mail',
  '🤝': 'handshake',
  '👁️': 'eye',
  '👁': 'eye',
  '🏁': 'flag',
  '☑️': 'clipboardCheck',
  '☑': 'clipboardCheck',
  '☀️': 'sun',
  '☀': 'sun',
  '🌤️': 'sun',
  '🌤': 'sun',
  '🌙': 'moon',
  '🏥': 'heartPulse',
  '👶': 'userRound',
  '✈️': 'plane',
  '✈': 'plane',
  '🏃': 'activity',
  '🌓': 'moon',
  '👋': 'userRound',
  '💡': 'lightbulb',
  '🏆': 'trophy',
  '💻': 'notebookTabs',
  '🎨': 'sparkles',
};

function normalizeIcons(root = document) {
  renderDataIcons(root);
  replaceGlyphTextNodes(root);
}

function renderDataIcons(root = document) {
  const nodes = [];
  if (root.nodeType === Node.ELEMENT_NODE && root.matches('[data-icon]')) nodes.push(root);
  if (root.querySelectorAll) nodes.push(...root.querySelectorAll('[data-icon]'));
  nodes.forEach(el => {
    if (el.dataset.iconRendered === '1') return;
    const size = el.dataset.iconSize || (el.classList.contains('nav-icon') ? 'lg' : 'sm');
    el.innerHTML = icon(el.dataset.icon, size);
    el.dataset.iconRendered = '1';
  });
}

function replaceGlyphTextNodes(root = document) {
  if (root.nodeType === Node.TEXT_NODE) {
    replaceGlyphNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const walkerRoot = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  if (!walkerRoot) return;
  const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,option')) return NodeFilter.FILTER_REJECT;
      if (parent.closest('svg,.app-icon')) return NodeFilter.FILTER_REJECT;
      return Object.keys(GLYPH_ICONS).some(glyph => node.nodeValue.includes(glyph))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceGlyphNode);
}

function replaceGlyphNode(textNode) {
  const parent = textNode.parentElement;
  if (!parent || parent.closest('script,style,textarea,option,svg,.app-icon')) return;
  const text = textNode.nodeValue;
  const glyphs = Object.keys(GLYPH_ICONS).filter(glyph => text.includes(glyph));
  if (!glyphs.length) return;
  const pattern = new RegExp(glyphs.map(escapeRegExp).join('|'), 'g');
  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) frag.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const wrap = document.createElement('span');
    wrap.innerHTML = icon(GLYPH_ICONS[match[0]], 'sm');
    frag.append(wrap.firstElementChild);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) frag.append(document.createTextNode(text.slice(lastIndex)));
  textNode.replaceWith(frag);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const iconObserver = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) normalizeIcons(node);
    });
  }
});
iconObserver.observe(document.documentElement, { childList: true, subtree: true });

// ════════════════════════════════════════════════
//  ROUTER  (DOM-level view cache)
// ════════════════════════════════════════════════
async function route() {
  const routeGeneration = ++_routeGeneration;
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

  if (NO_CACHE_VIEWS.has(path)) {
    contentEl.querySelectorAll(':scope > .view-container').forEach(node => node.remove());
    _viewCache.clear();
  }
  contentEl.querySelectorAll(`:scope > .view-container[data-view="${CSS.escape(path)}"]`).forEach(node => node.remove());

  // Create a fresh container node for this view
  const viewNode = document.createElement('div');
  viewNode.className = 'view-container';
  viewNode.dataset.view = path;
  contentEl.appendChild(viewNode);

  // Hide all other cached view nodes
  _viewCache.forEach((entry, name) => {
    if (name !== path) entry.node.style.display = 'none';
  });
  contentEl.querySelectorAll(':scope > .view-container').forEach(node => {
    if (node !== viewNode && node.dataset.view !== path) node.style.display = 'none';
  });

  _currentView = path;

  try {
    const mod = await getView(path);
    if (routeGeneration !== _routeGeneration) {
      viewNode.remove();
      return;
    }
    const fnName = 'render' + path.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    if (mod && typeof mod[fnName] === 'function') {
      await mod[fnName](viewNode, me);
      if (routeGeneration !== _routeGeneration) {
        if (viewNode._cleanup) viewNode._cleanup();
        viewNode.remove();
        return;
      }
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
    manager:  '⭐ Nhân sự',
    employee: '👤 Nhân viên',
  };
  return map[r] || r || '—';
}

// ════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════
window.onerror = (msg, src, line, col, err) => console.error('APP ERROR:', msg, err);
boot();
