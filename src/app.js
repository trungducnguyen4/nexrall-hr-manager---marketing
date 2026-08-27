// ════════════════════════════════════════════════
//  HR Manager — Main App Entry
// ════════════════════════════════════════════════
import { api, setToken, loadToken, clearCache } from './api.js?v=20260817-geofence-soft-v1';
import { initNativeShell, verifyBiometricIfAvailable } from './native.js';
import { setAvatar, toast, initials, avatarColor, closeModal, isHcnsDepartment, roleLabel } from './utils.js?v=20260826-role-label-fix-v1';
import { icon } from './icons.js';
import { playChatSound, playMentionSound, playTaskSound, isSoundEnabled, toggleSound } from './sound.js';
import { autoSyncPushSubscription } from './push.js';

// ── Lazy view imports ───────────────────────────
let _viewModules = {};
async function getView(name) {
  if (!_viewModules[name]) {
    if (name === 'dashboard')    _viewModules[name] = await import('./views/dashboard.js?v=20260817-dash-geo-v1');
    else if (name === 'attendance')  _viewModules[name] = await import('./views/attendance.js?v=20260817-att-map-v1');
    else if (name === 'tasks')       _viewModules[name] = await import('./views/tasks.js?v=20260826-project-members-picker-v7');
    else if (name === 'invoices')    _viewModules[name] = await import('./views/invoices.js?v=20260730-payslip-detail-v1');
    else if (name === 'users')       _viewModules[name] = await import('./views/users.js?v=20260826-leave-annual-policy-v6');
    else if (name === 'wifi')        _viewModules[name] = await import('./views/wifi.js?v=20260817-geofence-soft-v1');
    else if (name === 'settings')    _viewModules[name] = await import('./views/settings.js?v=20260826-webpush-lockscreen-v25');
    else if (name === 'taskpanel')   _viewModules[name] = await import('./views/taskpanel.js?v=20260826-taskpanel-mention-fix-v10');
    else if (name === 'departments') _viewModules[name] = await import('./views/departments.js');
    else if (name === 'recruitment') _viewModules[name] = await import('./views/recruitment.js');
    else if (name === 'payroll')     _viewModules[name] = await import('./views/payroll.js?v=20260826-dumbbell-and-donut-v14');
    else if (name === 'leave')       _viewModules[name] = await import('./views/leave.js?v=20260826-leave-annual-policy-v6');
    else if (name === 'campaigns')   _viewModules[name] = await import('./views/campaigns.js?v=20260811-hr-access-v1');
    else if (name === 'evaluation')  _viewModules[name] = await import('./views/evaluation.js?v=20260811-penalty-policy-v1');
    else if (name === 'kpis')        _viewModules[name] = await import('./views/kpis.js?v=20260730-manual-kpi');
    else if (name === 'notifications') _viewModules[name] = await import('./views/notifications.js?v=20260826-notification-tabs-count-v15');
    else if (name === 'assets')      _viewModules[name] = await import('./views/assets.js?v=20260804-project-handover-v1');
    else if (name === 'db-admin')    _viewModules[name] = await import('./views/dbadmin.js');
    else if (name === 'chat')        _viewModules[name] = await import('./views/chat.js?v=20260826-audio-notification-chimes-v20');
  }
  return _viewModules[name];
}

// ── State ───────────────────────────────────────
let me = null;
let _currentView = null;
let _appInitialized = false;
let _activeViewNode = null;
let _activeViewCleanup = null;
let _routeGeneration = 0;
let _chatUnreadTimer = null;
let _chatUnreadRequestInFlight = false;
let _chatUnreadWatchersBound = false;

// ── DOM refs ────────────────────────────────────
const loginScreen  = document.getElementById('login-screen');
const appEl        = document.getElementById('app');
const contentEl    = document.getElementById('content');
const sidebarEl    = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const isDesktop = () => window.innerWidth >= 768;

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
    await setToken(token);
    me = userData;
    if (me.must_change_password) window.location.hash = '#/settings';
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

  if (!await loadToken()) return;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Đang kiểm tra phiên...';
  loginError.classList.add('hidden');
  try {
    await verifyBiometricIfAvailable();
    const { user: userData } = await api.me();
    me = userData;
    if (me.must_change_password) window.location.hash = '#/settings';
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
    initApp();
  } catch (_) {
    await setToken(null);
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
async function refreshEmployeeAlertBadge() {
  const iconHost = document.getElementById('employee-alert-icon');
  const countHost = document.getElementById('employee-alert-count');
  const bottomBadge = document.getElementById('bottom-nav-notif-badge');
  if (iconHost && !iconHost.firstElementChild) iconHost.innerHTML = icon('bell', 'sm');
  try {
    const response = await api.getNotifications({ window: 30, page: 1, page_size: 10 });
    const count = Number(response.active_total || 0);
    const badgeText = count > 99 ? '99+' : String(count);
    if (countHost) {
      countHost.textContent = badgeText;
      countHost.classList.toggle('hidden', count < 1);
    }
    if (bottomBadge) {
      bottomBadge.textContent = badgeText;
      bottomBadge.classList.toggle('hidden', count < 1);
    }
  } catch (_) {
    if (countHost) countHost.classList.add('hidden');
    if (bottomBadge) bottomBadge.classList.add('hidden');
  }
}

let _lastTaskMentionCount = null;
let _lastChatUnreadCount = null;
let _lastChatMentionKey = null;

async function refreshTaskMentionBadge() {
  const badge = document.getElementById('task-mention-badge');
  if (!badge) return;
  try {
    const { count = 0 } = await api.getUnreadMentionCount();
    const numCount = Number(count || 0);
    if (_lastTaskMentionCount !== null && numCount > _lastTaskMentionCount) {
      playTaskSound();
    }
    _lastTaskMentionCount = numCount;
    badge.textContent = numCount > 99 ? '99+' : String(numCount);
    badge.classList.toggle('hidden', numCount < 1);
  } catch (_) {}
}

let _mentionBadgeTimer = null;

function setChatUnreadBadge(value) {
  const count = Math.max(0, Number(value) || 0);
  const button = document.getElementById('header-chat-button');
  const iconHost = document.getElementById('header-chat-icon');
  const countHost = document.getElementById('header-chat-count');
  if (iconHost && !iconHost.firstElementChild) iconHost.innerHTML = icon('messageCircle', 'sm');
  if (!button || !countHost) return;
  button.classList.remove('hidden');
  countHost.textContent = count > 99 ? '99+' : String(count);
  countHost.classList.toggle('hidden', count < 1);
  button.setAttribute('aria-label', count > 0 ? `Chat, ${count > 99 ? '99+' : count} tin nhắn chưa đọc` : 'Mở Chat');
}

function clearChatAttention() {
  const container = document.getElementById('header-chat-attention');
  const mention = document.getElementById('header-chat-mention');
  const event = document.getElementById('header-chat-event');
  mention?.classList.add('hidden');
  event?.classList.add('hidden');
  container?.classList.add('hidden');
}

function setChatAttention(summary = {}) {
  const container = document.getElementById('header-chat-attention');
  const mentionChip = document.getElementById('header-chat-mention');
  const eventChip = document.getElementById('header-chat-event');
  const mention = summary.mention;
  const upcoming = summary.upcoming_event;
  const setChip = (chip, iconName, text, label, data, className = '') => {
    if (!chip || !data) { chip?.classList.add('hidden'); return; }
    chip.className = `header-attention-chip ${className}`.trim();
    chip.innerHTML = `${icon(iconName, 'sm')}<span></span>`;
    chip.querySelector('span').textContent = text;
    chip.setAttribute('aria-label', label);
    chip.dataset.conversationId = String(data.conversation_id || '');
    chip.dataset.messageId = String(data.message_id || '');
  };
  const mentionText = mention ? (Number(mention.mention_all) ? `@all ${mention.sender_name} đã nhắc cả nhóm` : `${mention.sender_name} đã nhắc bạn`) : '';
  setChip(mentionChip, 'atSign', mentionText, mention ? `${mentionText} trong ${mention.conversation_name || 'Chat'}` : '', mention);
  let eventText = '';
  let eventClass = '';
  if (upcoming) {
    const start = new Date(String(upcoming.start_at || '').replace(' ', 'T'));
    const end = upcoming.end_at ? new Date(String(upcoming.end_at).replace(' ', 'T')) : null;
    const mins = Number.isNaN(start.getTime()) ? null : Math.round((start - new Date()) / 60000);
    if (end && !Number.isNaN(end.getTime()) && start <= new Date() && end >= new Date()) { eventText = `Đang họp · ${upcoming.title}`; eventClass = 'header-attention-chip--active'; }
    else if (mins !== null && mins >= 0 && mins <= 30) { eventText = `Còn ${mins} phút · ${upcoming.title}`; eventClass = 'header-attention-chip--soon'; }
    else eventText = `${start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · ${upcoming.title}`;
  }
  setChip(eventChip, 'calendarDays', eventText, upcoming ? `Lịch họp ${upcoming.title} lúc ${eventText.split(' · ')[0]}` : '', upcoming, eventClass);
  container?.classList.toggle('hidden', !mention && !upcoming);
}

async function refreshChatHeaderSummary() {
  if (!me || _chatUnreadRequestInFlight) return;
  const userIdAtStart = me.id;
  _chatUnreadRequestInFlight = true;
  try {
    const summary = await api.get('/api/chat/header-summary');
    if (!me || Number(me.id) !== Number(userIdAtStart)) return;
    const unread = Number(summary.unread_count || 0);
    const mention = summary.mention;
    const mentionKey = mention ? `${mention.conversation_id}:${mention.message_id}` : null;

    if (mentionKey && mentionKey !== _lastChatMentionKey) {
      if (_lastChatMentionKey !== null) {
        playMentionSound();
      }
      _lastChatMentionKey = mentionKey;
    } else if (!mentionKey) {
      _lastChatMentionKey = null;
    }

    if (_lastChatUnreadCount !== null && unread > _lastChatUnreadCount && !mentionKey) {
      playChatSound();
    }
    _lastChatUnreadCount = unread;

    setChatUnreadBadge(unread);
    setChatAttention(summary);
  } catch (_) {
    // Keep the last known header state when a transient request fails.
  } finally {
    _chatUnreadRequestInFlight = false;
  }
}

function onChatUnreadForeground() {
  if (!document.hidden) {
    refreshChatHeaderSummary();
    refreshTaskMentionBadge();
    refreshEmployeeAlertBadge();
    document.dispatchEvent(new CustomEvent('hr-window-focused'));
  }
}

function onChatUnreadChanged(event) {
  setChatUnreadBadge(event.detail?.count);
  refreshChatHeaderSummary();
}

function onDataMutated() {
  refreshEmployeeAlertBadge();
  refreshTaskMentionBadge();
}

function startChatUnreadWatcher() {
  if (!_chatUnreadWatchersBound) {
    document.addEventListener('visibilitychange', onChatUnreadForeground);
    window.addEventListener('focus', onChatUnreadForeground);
    document.addEventListener('hr-chat-unread-changed', onChatUnreadChanged);
    document.addEventListener('hr-data-mutated', onDataMutated);
    _chatUnreadWatchersBound = true;
  }
  refreshChatHeaderSummary();
  refreshEmployeeAlertBadge();
  refreshTaskMentionBadge();
  if (!_chatUnreadTimer) _chatUnreadTimer = window.setInterval(() => {
    refreshChatHeaderSummary();
    refreshEmployeeAlertBadge();
  }, 10_000);
}

function stopChatUnreadWatcher() {
  if (_chatUnreadTimer) window.clearInterval(_chatUnreadTimer);
  _chatUnreadTimer = null;
  if (_mentionBadgeTimer) window.clearInterval(_mentionBadgeTimer);
  _mentionBadgeTimer = null;
  if (_chatUnreadWatchersBound) {
    document.removeEventListener('visibilitychange', onChatUnreadForeground);
    window.removeEventListener('focus', onChatUnreadForeground);
    document.removeEventListener('hr-chat-unread-changed', onChatUnreadChanged);
    document.removeEventListener('hr-data-mutated', onDataMutated);
    _chatUnreadWatchersBound = false;
  }
  _chatUnreadRequestInFlight = false;
  setChatUnreadBadge(0);
  clearChatAttention();
  document.getElementById('header-chat-button')?.classList.add('hidden');
}

function renderSoundButton() {
  const iconHost = document.getElementById('header-sound-icon');
  const btn = document.getElementById('header-sound-button');
  if (!iconHost || !btn) return;
  const enabled = isSoundEnabled();
  iconHost.innerHTML = icon(enabled ? 'volume2' : 'volumeX', 'sm');
  btn.setAttribute('aria-label', enabled ? 'Đang bật âm thanh thông báo (Bấm để tắt)' : 'Đang tắt âm thanh thông báo (Bấm để bật)');
  btn.setAttribute('title', enabled ? 'Âm thanh thông báo: BẬT (Bấm để tắt)' : 'Âm thanh thông báo: TẮT (Bấm để bật)');
  btn.classList.toggle('header-btn-muted', !enabled);
}

function initApp() {
  normalizeIcons(document);
  setAvatar(document.getElementById('sidebar-av'), me.full_name, me.avatar_color, me.avatar_initials, me.avatar_url);
  document.getElementById('sidebar-name').textContent = me.full_name;
  document.getElementById('sidebar-role').textContent = roleLabel(me.role);
  setAvatar(document.getElementById('header-av'), me.full_name, me.avatar_color, me.avatar_initials, me.avatar_url);
  document.getElementById('sidebar-profile-link').href = `#/users/${me.id}`;
  const bottomProfileLink = document.getElementById('bottom-nav-profile-link');
  if (bottomProfileLink) bottomProfileLink.href = `#/users/${me.id}`;

  // Admin nav visibility
  const isManager = me.role === 'admin' || me.role === 'manager' || isHcnsDepartment(me.department);
  const adminNav = document.getElementById('admin-nav');
  if (!isManager) adminNav.style.display = 'none';
  else adminNav.style.display = '';
  document.getElementById('db-admin-nav-item')?.classList.toggle('hidden', me.role !== 'admin');
  const alertButton = document.getElementById('employee-alert-button');
  alertButton?.classList.remove('hidden');
  renderSoundButton();
  refreshEmployeeAlertBadge();
  refreshTaskMentionBadge();
  if (_mentionBadgeTimer) clearInterval(_mentionBadgeTimer);
  _mentionBadgeTimer = setInterval(refreshTaskMentionBadge, 30000);
  startChatUnreadWatcher();
  autoSyncPushSubscription().catch(() => {});

  // Restore sidebar preference on desktop
  if (isDesktop() && localStorage.getItem('sidebar_collapsed') === '1') {
    appEl.classList.add('sidebar-collapsed');
    document.body.classList.add('sidebar-collapsed');
    document.documentElement.classList.add('sidebar-collapsed');
  }

  if (_appInitialized) {
    route();
    return;
  }
  _appInitialized = true;

  startClock();

  document.getElementById('sidebar-edge-toggle')?.addEventListener('click', toggleSidebar);
  document.getElementById('btn-menu')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', closeMobileSidebar);
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);
  document.getElementById('header-av-btn')?.addEventListener('click', () => navigate(`#/users/${me.id}`));
  document.getElementById('sidebar-profile-link')?.addEventListener('click', closeMobileSidebar);
  document.querySelectorAll('.bottom-nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      closeMobileSidebar();
      const href = link.getAttribute('href');
      if (href) {
        e.preventDefault();
        navigate(href);
      }
    });
  });
  document.addEventListener('hr-avatar-updated', event => {
    const { userId, url } = event.detail || {};
    if (Number(userId) !== Number(me?.id)) return;
    me.avatar_url = url || '';
    setAvatar(document.getElementById('sidebar-av'), me.full_name, me.avatar_color, me.avatar_initials, me.avatar_url);
    setAvatar(document.getElementById('header-av'), me.full_name, me.avatar_color, me.avatar_initials, me.avatar_url);
  });
  document.addEventListener('task-mentions-read', refreshTaskMentionBadge);
  document.getElementById('header-sound-button')?.addEventListener('click', () => {
    const next = toggleSound();
    renderSoundButton();
    toast(next ? 'Đã bật âm thanh thông báo' : 'Đã tắt âm thanh thông báo', 'info');
  });
  document.addEventListener('hr-sound-toggled', renderSoundButton);
  document.getElementById('employee-alert-button')?.addEventListener('click', () => navigate('#/notifications'));
  document.getElementById('header-chat-button')?.addEventListener('click', () => navigate('#/chat'));
  document.getElementById('header-chat-attention')?.addEventListener('click', event => {
    const chip = event.target.closest('.header-attention-chip:not(.hidden)');
    if (!chip?.dataset.conversationId || !chip.dataset.messageId) return;
    navigate(`#/chat/${chip.dataset.conversationId}/${chip.dataset.messageId}`);
  });

  document.querySelectorAll('.nav-item[data-nav]').forEach(link => {
    link.addEventListener('click', closeMobileSidebar);
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      const target = e.target;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!isInput) {
        e.preventDefault();
        toggleSidebar();
      }
    }
  });

  // Mobile virtual keyboard detection (hides bottom nav bar when typing)
  if (window.visualViewport) {
    let initialViewportH = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const isKeyboard = window.visualViewport.height < initialViewportH * 0.82;
      document.body.classList.toggle('keyboard-open', isKeyboard);
    });
  }
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      document.body.classList.add('keyboard-open');
    }
  });
  document.addEventListener('focusout', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && !active.isContentEditable)) {
          document.body.classList.remove('keyboard-open');
        }
      }, 100);
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await api.logout(); } catch(_) {}
    stopChatUnreadWatcher();
    await setToken(null);
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
    closeMobileSidebar();
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

function syncBottomNav(hash, path, segments) {
  const isSelfProfile = path === 'users' && segments[1] && String(segments[1]) === String(me?.id);
  let activeNav = '';
  if (path === 'dashboard') activeNav = 'dashboard';
  else if (path === 'attendance') activeNav = 'attendance';
  else if (path === 'notifications') activeNav = 'notifications';
  else if (isSelfProfile) activeNav = 'profile';
  else if (path === 'users') activeNav = 'users';

  document.querySelectorAll('.bottom-nav-item[data-bottom-nav]').forEach(item => {
    item.classList.toggle('active', item.dataset.bottomNav === activeNav);
  });
}

// ════════════════════════════════════════════════
//  ROUTER  (DOM-level view cache)
// ════════════════════════════════════════════════
async function route() {
  const routeGeneration = ++_routeGeneration;
  const hash = location.hash || '#/dashboard';
  const routeKey = hash.replace('#/', '').replace(/^\/+|\/+$/g, '') || 'dashboard';
  const segments = routeKey.split('/').filter(Boolean);
  const path = segments[0] || 'dashboard';

  document.querySelectorAll('.nav-item[data-nav]').forEach(link => {
    link.classList.toggle('active', link.dataset.nav === path);
  });

  syncBottomNav(hash, path, segments);

  // Keep exactly one route view in the DOM. Views contain repeated element IDs
  // and some legacy global selectors; retaining hidden route DOM lets events
  // bind to a stale instance and is the root cause of the "refresh to use" bug.
  if (_activeViewCleanup) {
    try { _activeViewCleanup(); } catch (error) { console.warn('View cleanup failed', error); }
  }
  _activeViewCleanup = null;
  if (_activeViewNode) _activeViewNode.remove();
  _activeViewNode = null;
  contentEl.querySelectorAll(':scope > .view-container').forEach(node => node.remove());

  // Create a fresh container node for this view
  const viewNode = document.createElement('div');
  viewNode.className = 'view-container';
  viewNode.dataset.view = routeKey;
  contentEl.appendChild(viewNode);

  _currentView = routeKey;

  try {
    const mod = await getView(path);
    if (routeGeneration !== _routeGeneration) {
      if (viewNode._cleanup) viewNode._cleanup();
      viewNode.remove();
      return;
    }
    const fnName = 'render' + path.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    if (mod && typeof mod[fnName] === 'function') {
      await mod[fnName](viewNode, me, { hash, routeKey, segments });
      if (routeGeneration !== _routeGeneration) {
        if (viewNode._cleanup) viewNode._cleanup();
        viewNode.remove();
        return;
      }
      _activeViewNode = viewNode;
      _activeViewCleanup = viewNode._cleanup || null;
      viewNode._cleanup = null;
    } else {
      viewNode.innerHTML = `<div class="empty-state"><div class="empty-icon">404</div><div class="empty-text">Trang không tìm thấy</div></div>`;
      _activeViewNode = viewNode;
    }
  } catch(e) {
    console.error('Route error:', e);
    viewNode.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
    _activeViewNode = viewNode;
  }
}

// Destroy all cached view nodes (e.g. on logout)
function _destroyAllViews() {
  if (_activeViewCleanup) _activeViewCleanup();
  _activeViewCleanup = null;
  if (_activeViewNode) _activeViewNode.remove();
  _activeViewNode = null;
  contentEl.querySelectorAll(':scope > .view-container').forEach(node => node.remove());
  _currentView = null;
}

// Invalidate a specific view's DOM cache so it re-renders fresh on next visit
export function invalidateView(_name) {
  // Route DOM is not cached: the next hashchange always renders a fresh view.
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
export function toggleSidebar(e) {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  const app = document.getElementById('app') || document.body;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;

  if (isDesktop) {
    // Desktop: toggle collapsed state
    const isCollapsed = app.classList.toggle('sidebar-collapsed');
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
    document.documentElement.classList.toggle('sidebar-collapsed', isCollapsed);
    try { localStorage.setItem('sidebar_collapsed', isCollapsed ? '1' : '0'); } catch(_) {}
    sidebar?.classList.remove('open');
    overlay?.classList.remove('active');
  } else {
    // Mobile: toggle open drawer
    app.classList.remove('sidebar-collapsed');
    document.body.classList.remove('sidebar-collapsed');
    document.documentElement.classList.remove('sidebar-collapsed');
    const willOpen = !sidebar?.classList.contains('open');
    if (willOpen) {
      sidebar?.classList.add('open');
      overlay?.classList.add('active');
    } else {
      sidebar?.classList.remove('open');
      overlay?.classList.remove('active');
    }
  }
}

export function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const app = document.getElementById('app') || document.body;
  app.classList.remove('sidebar-collapsed');
  document.body.classList.remove('sidebar-collapsed');
  document.documentElement.classList.remove('sidebar-collapsed');
  sidebar?.classList.add('open');
  overlay?.classList.add('active');
}

export function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar?.classList.remove('open');
  overlay?.classList.remove('active');
}

window.addEventListener('resize', () => {
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (window.innerWidth >= 768) {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('active');
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === '1';
    app?.classList.toggle('sidebar-collapsed', isCollapsed);
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
    document.documentElement.classList.toggle('sidebar-collapsed', isCollapsed);
  } else {
    app?.classList.remove('sidebar-collapsed');
    document.body.classList.remove('sidebar-collapsed');
    document.documentElement.classList.remove('sidebar-collapsed');
  }
});

window.toggleSidebar = toggleSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.openMobileSidebar = openMobileSidebar;

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
//  START
// ════════════════════════════════════════════════
window.onerror = (msg, src, line, col, err) => console.error('APP ERROR:', msg, err);
initNativeShell();
boot();
