// ── Chat View — Modern Enterprise Work Chat ─────────────────────────
// 2-panel layout: conversation list + main conversation.
// REST for history/actions + Durable Object WebSocket for real-time.
// =====================================================================

import { api } from '../api.js';
import { navigate } from '../app.js';
import { esc, toast, openModal, closeModal, loadingHTML } from '../utils.js';
import { icon } from '../icons.js';

let conversations = [];
let activeConvId = null;
let activeConversation = null;
let messages = [];
let ws = null;
let wsAuthenticated = false;
let wsReconnectTimer = null;
let wsGeneration = 0;
let wsIntentionalClose = false;
let me = null;
let replyTo = null;
let uploading = false;
let loadingMore = false;
let activeTab = 'all';
let selectedMentions = [];
let selectedMentionAll = false;
let conversationRefreshTimer = null;
const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const FALLBACK_PICKER_EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😭','😡','👍','👎','❤️','🎉','✅','🔥','👏','🙏','👀'];

function publishUnreadCount() {
  const count = conversations.reduce((sum, conversation) => sum + (Number(conversation.unread_count) || 0), 0);
  document.dispatchEvent(new CustomEvent('hr-chat-unread-changed', { detail: { count } }));
}

// ── Render entry ────────────────────────────────────────────────────
export async function renderChat(el, user, route = {}) {
  me = user;
  el.innerHTML = `
    <div class="chat-page">
      ${renderPageHeader()}
      <div class="chat-workspace" id="chat-workspace">
        ${renderSidebar()}
        <section class="chat-main" id="chat-conversation">
          ${renderMainEmpty()}
        </section>
      </div>
    </div>`;

  bindGlobalEvents(el);
  loadConversations();
  const [, conversationId, messageId] = route.segments || [];
  if (Number(conversationId)) openConversation(Number(conversationId), Number(messageId) || null);
  conversationRefreshTimer = setInterval(loadConversationsSilently, 10_000);
  el._cleanup = () => {
    disconnectWS();
    if (conversationRefreshTimer) clearInterval(conversationRefreshTimer);
    conversationRefreshTimer = null;
    if (silentLoadTimer) clearTimeout(silentLoadTimer);
    silentLoadTimer = null;
  };
}

// ── Component: Page header ──────────────────────────────────────────
function renderPageHeader() {
  return `
    <div class="page-header chat-page-header">
      <div>
        <div class="page-title">${icon('messageCircle', 'xl')} Chat</div>
        <div class="page-sub">Trao đổi trực tiếp với đồng nghiệp và nhóm làm việc.</div>
      </div>
      <button id="btn-new-conv" class="btn-primary btn-sm">${icon('plus', 'sm')} Tin nhắn mới</button>
    </div>`;
}

// ── Component: Conversation sidebar ─────────────────────────────────
function renderSidebar() {
  return `
    <aside class="chat-list-panel" id="chat-list-panel">
      <div class="chat-list-head">
        <div class="chat-list-title">Tin nhắn</div>
        <button class="chat-icon-btn" id="chat-compose-icon" aria-label="Tạo cuộc trò chuyện">${icon('squarePen', 'sm')}</button>
      </div>
      <div class="chat-search">
        ${icon('search', 'sm')}
        <input type="text" id="chat-search" placeholder="Tìm kiếm cuộc trò chuyện..." />
      </div>
      <div class="chat-segmented" role="tablist" id="chat-tabs">
        <button class="chat-seg-btn active" data-tab="all" role="tab" aria-selected="true">Tất cả</button>
        <button class="chat-seg-btn" data-tab="unread" role="tab" aria-selected="false">Chưa đọc</button>
        <button class="chat-seg-btn" data-tab="direct" role="tab" aria-selected="false">Trực tiếp</button>
      </div>
      <div class="chat-list" id="chat-sidebar-list"></div>
    </aside>`;
}

// ── Component: Main empty state ─────────────────────────────────────
function renderMainEmpty() {
  return `
    <div class="chat-main-empty">
      <div class="chat-main-empty-icon">${icon('messageCircle', 'xl')}</div>
      <div class="chat-main-empty-title">Chọn một cuộc trò chuyện</div>
      <div class="chat-main-empty-sub">Chọn hội thoại ở bên trái<br/>hoặc bắt đầu một cuộc trò chuyện mới.</div>
      <button id="btn-new-conv-main" class="btn-primary btn-sm">${icon('plus', 'sm')} Tin nhắn mới</button>
    </div>`;
}

// ── Global events ───────────────────────────────────────────────────
function bindGlobalEvents(el) {
  document.getElementById('btn-new-conv')?.addEventListener('click', openNewConversation);
  document.getElementById('btn-new-conv-main')?.addEventListener('click', openNewConversation);
  document.getElementById('chat-compose-icon')?.addEventListener('click', openNewConversation);
  document.getElementById('chat-search')?.addEventListener('input', debounce(renderSidebarList, 250));
  el.querySelector('#chat-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.chat-seg-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    el.querySelectorAll('.chat-seg-btn').forEach(b => {
      const isActive = b === btn;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderSidebarList();
  });
}

// ── Load conversations ──────────────────────────────────────────────
async function loadConversations() {
  const list = document.getElementById('chat-sidebar-list');
  if (!list) return;
  list.innerHTML = renderSkeletonList();
  try {
    const { conversations: convs } = await api.get('/api/conversations');
    conversations = convs;
    publishUnreadCount();
    renderSidebarList();
  } catch (e) {
    list.innerHTML = `
      <div class="chat-list-empty">
        <div class="chat-list-empty-icon">${icon('triangleAlert', 'lg')}</div>
        <div class="chat-list-empty-title">Không thể tải cuộc trò chuyện</div>
        <div class="chat-list-empty-sub">${esc(e.message)}</div>
        <button class="btn-secondary btn-sm" id="chat-retry-list">${icon('refreshCw', 'sm')} Thử lại</button>
      </div>`;
    document.getElementById('chat-retry-list')?.addEventListener('click', loadConversations);
  }
}

function renderSkeletonList() {
  return Array.from({ length: 5 }, () => `
    <div class="chat-skel-item">
      <div class="chat-skeleton chat-skel-avatar"></div>
      <div class="chat-skel-lines">
        <div class="chat-skeleton chat-skel-line-sm"></div>
        <div class="chat-skeleton chat-skel-line-xs"></div>
      </div>
    </div>`).join('');
}

function renderSidebarList() {
  const list = document.getElementById('chat-sidebar-list');
  if (!list) return;
  const search = (document.getElementById('chat-search')?.value || '').trim().toLowerCase();
  let filtered = conversations;
  if (activeTab === 'direct') filtered = filtered.filter(c => c.type === 'direct');
  if (activeTab === 'unread') filtered = filtered.filter(c => Number(c.unread_count) > 0);
  if (search) filtered = filtered.filter(c => {
    const names = (c.members || []).map(m => m.full_name || '').join(' ');
    return (c.name || '').toLowerCase().includes(search) || names.toLowerCase().includes(search);
  });

  const dms = filtered.filter(c => c.type === 'direct');
  const channels = filtered.filter(c => c.type !== 'direct');

  if (!filtered.length) {
    list.innerHTML = `
      <div class="chat-list-empty" id="chat-list-empty">
        <div class="chat-list-empty-icon">${icon('messageCircle', 'lg')}</div>
        <div class="chat-list-empty-title">Chưa có cuộc trò chuyện</div>
        <div class="chat-list-empty-sub">Bắt đầu trò chuyện với đồng nghiệp hoặc tạo nhóm làm việc.</div>
        <button class="btn-primary btn-sm" id="chat-list-empty-cta">${icon('plus', 'sm')} Bắt đầu trò chuyện</button>
      </div>`;
    document.getElementById('chat-list-empty-cta')?.addEventListener('click', openNewConversation);
    return;
  }

  let html = '';
  if (dms.length) {
    html += '<div class="chat-list-section">Tin nhắn trực tiếp</div>';
    for (const c of dms) {
      const other = (c.members || []).find(m => m.user_id !== me.id);
      html += renderConvItem(c, other?.full_name || c.name || 'Unknown');
    }
  }
  if (channels.length) {
    html += '<div class="chat-list-section">Nhóm & Kênh</div>';
    for (const c of channels) html += renderConvItem(c, c.name || 'Nhóm');
  }
  list.innerHTML = html;

  list.querySelectorAll('.chat-conv-item').forEach(item => {
    item.addEventListener('click', () => openConversation(Number(item.dataset.convId)));
  });
}

function renderConvItem(c, name) {
  const lastMsg = c.last_message;
  const preview = lastMsg ? (lastMsg.deleted_at ? 'Tin nhắn đã xóa' : (lastMsg.content || '📎 File đính kèm').slice(0, 40)) : 'Chưa có tin nhắn';
  const time = lastMsg ? formatChatTime(lastMsg.created_at) : '';
  const unread = Number(c.unread_count) || 0;
  const isActive = Number(c.id) === activeConvId;
  const cls = [
    'chat-conv-item',
    isActive ? 'active' : '',
    unread ? 'unread' : '',
  ].filter(Boolean).join(' ');
  const other = (c.members || []).find(m => m.user_id !== me.id);
  return `<div class="${cls}" data-conv-id="${c.id}" role="button" tabindex="0" aria-selected="${isActive}">
    ${renderChatAvatar(other || c.members?.[0], 44)}
    <div class="chat-conv-info">
      <div class="chat-conv-name">${esc(name)}</div>
      <div class="chat-conv-preview">${esc(preview)}</div>
    </div>
    <div class="chat-conv-meta">
      ${time ? `<span class="chat-conv-time">${time}</span>` : ''}
      ${unread ? `<span class="chat-conv-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
    </div>
  </div>`;
}

// ── Open conversation ───────────────────────────────────────────────
async function openConversation(convId, targetMessageId = null) {
  activeConvId = convId;
  activeConversation = null;
  selectedMentions = [];
  selectedMentionAll = false;
  replyTo = null;
  messages = [];
  disconnectWS();

  // Mobile: switch to conversation view
  const workspace = document.getElementById('chat-workspace');
  workspace?.classList.add('show-conv');

  // Highlight active
  document.querySelectorAll('.chat-conv-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.chat-conv-item[data-conv-id="${convId}"]`)?.classList.add('active');

  const convEl = document.getElementById('chat-conversation');
  convEl.innerHTML = renderSkeletonMain();

  try {
    const conv = await api.get(`/api/conversations/${convId}`);
    activeConversation = conv;
    const targetQuery = targetMessageId ? `&around=${encodeURIComponent(targetMessageId)}` : '';
    const { messages: msgs } = await api.get(`/api/conversations/${convId}/messages?limit=50${targetQuery}`);
    messages = msgs;
    renderConversation(conv);
    renderMessages();
    if (targetMessageId) scrollToMessage(targetMessageId); else scrollToBottom();
    connectWS(convId);

    // Mark all visible as read, then refresh sidebar
    if (msgs.length) {
      const lastMsg = msgs[msgs.length - 1];
      const readOk = await markRead(lastMsg.id);
      if (readOk) {
        const conv = conversations.find(c => c.id === convId);
        if (conv) { conv.unread_count = 0; publishUnreadCount(); renderSidebarList(); }
      }
      loadConversationsSilently();
    }
  } catch (e) {
    convEl.innerHTML = `
      <div class="chat-main-empty">
        <div class="chat-main-empty-icon">${icon('triangleAlert', 'xl')}</div>
        <div class="chat-main-empty-title">Không thể tải cuộc trò chuyện</div>
        <div class="chat-main-empty-sub">${esc(e.message)}</div>
        <button class="btn-secondary btn-sm" id="chat-retry-conv">${icon('refreshCw', 'sm')} Thử lại</button>
      </div>`;
    document.getElementById('chat-retry-conv')?.addEventListener('click', () => openConversation(convId));
  }
}

function renderSkeletonMain() {
  return `
    <div class="chat-conv-header" style="border-bottom:1px solid var(--border)">
      <div class="chat-conv-header-left">
        <div class="chat-skeleton" style="width:42px;height:42px;border-radius:50%"></div>
        <div class="chat-skel-lines">
          <div class="chat-skeleton chat-skel-line-sm"></div>
          <div class="chat-skeleton chat-skel-line-xs"></div>
        </div>
      </div>
    </div>
    <div class="chat-messages">
      ${Array.from({ length: 4 }).map(() => `
        <div class="chat-msg ${Math.random() > .5 ? 'outgoing' : ''}">
          <div class="chat-skeleton" style="width:32px;height:32px;border-radius:50%"></div>
          <div class="chat-skeleton" style="width:${40 + Math.random() * 30}%;height:40px;border-radius:14px"></div>
        </div>`).join('')}
    </div>`;
}

// ── Component: Conversation view ────────────────────────────────────
function renderConversation(conv) {
  const otherMembers = (conv.members || []).filter(m => m.user_id !== me.id);
  const name = conv.type === 'direct' ? (otherMembers[0]?.full_name || 'Unknown') : (conv.name || 'Nhóm');
  const sub = conv.type === 'direct'
    ? '<span class="chat-online-dot"></span> Đang hoạt động'
    : `${icon('users', 'xs')} ${conv.members.length} thành viên`;
  const headerMember = conv.type === 'direct' ? otherMembers[0] : { full_name: name };

  const convEl = document.getElementById('chat-conversation');
  convEl.innerHTML = `
    <div class="chat-conv-header">
      <div class="chat-conv-header-left">
        <button class="chat-header-action chat-back-btn" id="chat-back-btn" aria-label="Quay lại">${icon('chevronLeft', 'md')}</button>
        ${renderChatAvatar(headerMember, 42, 'chat-conv-header-avatar')}
        <div style="min-width:0">
          <div class="chat-conv-header-name">${esc(name)}</div>
          <div class="chat-conv-header-sub">${sub}</div>
        </div>
      </div>
      <div class="chat-conv-header-actions">
        <button class="chat-header-action" id="chat-search-btn" aria-label="Tìm kiếm">${icon('search', 'md')}</button>
        <button class="chat-header-action" id="chat-more-btn" aria-label="Thêm">${icon('moreHorizontal', 'md')}</button>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    ${renderComposer()}
  `;

  document.getElementById('chat-back-btn')?.addEventListener('click', () => {
    activeConvId = null;
    document.getElementById('chat-workspace')?.classList.remove('show-conv');
    renderEmptyChat();
  });
  document.getElementById('chat-search-btn')?.addEventListener('click', openSearchModal);
  document.getElementById('chat-more-btn')?.addEventListener('click', () => openMoreMenu(conv));
  document.getElementById('chat-send-btn')?.addEventListener('click', sendMessage);
  document.querySelectorAll('[data-composer-action]').forEach(button => button.addEventListener('click', () => {
    const menu = document.getElementById('chat-actions-menu');
    if (menu) menu.hidden = true;
    const trigger = document.getElementById('chat-actions-btn');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    runComposerAction(button.dataset.composerAction);
  }));
  document.getElementById('chat-actions-btn')?.addEventListener('click', () => {
    const menu = document.getElementById('chat-actions-menu');
    const trigger = document.getElementById('chat-actions-btn');
    if (!menu || !trigger) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));
  });
  document.getElementById('chat-composer-reply-close')?.addEventListener('click', () => { replyTo = null; updateReplyPreview(); });

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'chat-file-input';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', handleFileUpload);
  document.getElementById('chat-composer')?.appendChild(fileInput);

  // Textarea auto-grow + Enter to send
  const input = document.getElementById('chat-input');
  input?.addEventListener('input', autoGrow);
  input?.addEventListener('input', updateMentionSuggestions);
  input?.addEventListener('keydown', e => {
    if (handleMentionKeydown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Scroll to load more
  document.getElementById('chat-messages')?.addEventListener('scroll', onScrollLoadMore);
}

function renderComposer() {
  const groupOnlyActions = activeConversation?.type === 'direct' ? '' : `
    <button type="button" class="chat-mobile-action" data-composer-action="poll">▥<span>Bình chọn</span></button>
    <button type="button" class="chat-mobile-action" data-composer-action="event">◷<span>Đặt lịch</span></button>`;
  return `
    <div class="chat-composer" id="chat-composer">
      <div class="chat-composer-reply" id="chat-composer-reply" style="display:none">
        <span id="chat-composer-reply-text"></span>
        <button class="chat-composer-reply-close" id="chat-composer-reply-close" aria-label="Hủy trả lời">${icon('x', 'sm')}</button>
      </div>
      <div class="chat-composer-box">
        <button type="button" class="chat-composer-btn chat-composer-tool" data-composer-action="attach" aria-label="Đính kèm">${icon('paperclip', 'md')}</button>
        <button type="button" class="chat-composer-btn chat-composer-tool" data-composer-action="emoji" aria-label="Biểu cảm">${icon('smile', 'md')}</button>
        <button type="button" class="chat-composer-btn chat-composer-tool" data-composer-action="task" aria-label="Gắn task">${icon('clipboardList', 'md')}</button>
        <button type="button" class="chat-composer-btn chat-composer-tool" data-composer-action="mention" aria-label="Tag thành viên">${icon('atSign', 'md')}</button>
        <button type="button" class="chat-composer-btn chat-composer-tool" data-composer-action="poll" aria-label="Tạo bình chọn">▥</button>
        <button type="button" class="chat-composer-btn chat-composer-tool" data-composer-action="event" aria-label="Đặt lịch hẹn">◷</button>
        <button type="button" class="chat-composer-btn chat-composer-actions-trigger" id="chat-actions-btn" aria-label="Thêm công cụ" aria-expanded="false">${icon('plus', 'md')}</button>
        <textarea class="chat-composer-input" id="chat-input" rows="1" placeholder="Nhập tin nhắn..."></textarea>
        <button class="chat-composer-send" id="chat-send-btn" aria-label="Gửi">${icon('send', 'md')}</button>
      </div>
      <div class="chat-actions-menu" id="chat-actions-menu" hidden aria-label="Công cụ trò chuyện">
        <button type="button" class="chat-mobile-action" data-composer-action="attach">${icon('paperclip', 'md')}<span>Đính kèm</span></button>
        <button type="button" class="chat-mobile-action" data-composer-action="emoji">${icon('smile', 'md')}<span>Biểu cảm</span></button>
        <button type="button" class="chat-mobile-action" data-composer-action="task">${icon('clipboardList', 'md')}<span>Gắn công việc</span></button>
        <button type="button" class="chat-mobile-action" data-composer-action="mention">${icon('atSign', 'md')}<span>Tag thành viên</span></button>${groupOnlyActions}
      </div>
      <div class="chat-mention-menu" id="chat-mention-menu" role="listbox" aria-label="Gợi ý thành viên" hidden></div>
      <div class="chat-composer-hint">Gõ <kbd>@</kbd> để tag thành viên. Nhấn Shift + Enter để xuống dòng.</div>
    </div>`;
}

function renderEmptyChat() {
  disconnectWS();
  activeConversation = null;
  selectedMentions = [];
  selectedMentionAll = false;
  document.querySelectorAll('.chat-conv-item').forEach(i => i.classList.remove('active'));
  const convEl = document.getElementById('chat-conversation');
  convEl.innerHTML = renderMainEmpty();
  document.getElementById('btn-new-conv-main')?.addEventListener('click', openNewConversation);
}

// ── Component: Message list ─────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  let html = '';
  let lastDate = '';
  let lastSender = null;
  let lastTime = null;
  // Keep receipts compact like Zalo: only show them under the latest message
  // sent by the current user, while still retaining the full read state.
  const latestOwnMessageId = [...messages].reverse().find(message => Number(message.sender_id) === Number(me.id) && !message.deleted_at)?.id;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgDate = String(msg.created_at || '').slice(0, 10);
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      lastSender = null;
      html += `<div class="chat-date-separator">${formatDate(msgDate)}</div>`;
    }

    const isMe = Number(msg.sender_id) === me.id;
    const deleted = !!msg.deleted_at;
    const edited = !!msg.edited_at;

    // Group consecutive messages from same sender within 5 minutes
    const prev = messages[i - 1];
    const grouped = prev && Number(prev.sender_id) === Number(msg.sender_id)
      && !prev.deleted_at
      && timeDiffMin(prev.created_at, msg.created_at) <= 5
      && msgDate === String(prev.created_at || '').slice(0, 10);

    const cls = ['chat-msg', isMe ? 'outgoing' : '', grouped ? 'chat-msg-grouped' : ''].filter(Boolean).join(' ');

    // Avatar only on first message of a group
    const showAvatar = !grouped;

    // Reply preview
    let replyHtml = '';
    if (msg.reply_to_id && !deleted) {
      const replyMsg = messages.find(m => m.id === msg.reply_to_id);
      if (replyMsg) {
        replyHtml = `<div class="chat-reply-preview" data-scroll-to="${msg.reply_to_id}">
          <div class="chat-reply-preview-sender">${esc(replyMsg.sender_name || 'Unknown')}</div>
          <div class="chat-reply-preview-text">${esc((replyMsg.content || 'File').slice(0, 60))}</div>
        </div>`;
      }
    }

    // Task card
    let taskHtml = '';
    if (msg.task_id && !deleted) {
      taskHtml = `<div class="chat-task-card" data-task-id="${msg.task_id}">
        <div class="chat-task-code">#TASK-${msg.task_id}</div>
        <div class="chat-task-title">📋 Xem task</div>
      </div>`;
    }

    const interactionHtml = !deleted && msg.poll ? renderPollCard(msg, isMe)
      : (!deleted && msg.event ? renderEventCard(msg, isMe) : '');

    // Attachments
    let attHtml = '';
    for (const att of (msg.attachments || [])) {
      if (att.type === 'image') {
        attHtml += `<img class="chat-attachment-image" src="${getFileUrl(att.storage_key)}" alt="${esc(att.file_name)}" />`;
      } else {
        attHtml += `<div class="chat-attachment" data-key="${att.storage_key}">
          <span class="chat-attachment-icon">${icon('fileText', 'md')}</span>
          <div style="min-width:0"><div class="chat-attachment-name">${esc(att.file_name)}</div><div class="chat-attachment-size">${formatSize(att.file_size)}</div></div>
        </div>`;
      }
    }

    // Reactions
    let reactHtml = '';
    if ((msg.reactions || []).length) {
      const grouped = {};
      for (const r of (msg.reactions || [])) { if (!grouped[r.emoji]) grouped[r.emoji] = []; grouped[r.emoji].push(r); }
      reactHtml = '<div class="chat-reactions">';
      for (const [emoji, users] of Object.entries(grouped)) {
        const active = users.some(u => u.user_id === me.id) ? ' active' : '';
        reactHtml += `<span class="chat-reaction${active}" data-msg-id="${msg.id}" data-emoji="${emoji}">${emoji} <span class="chat-reaction-count">${users.length}</span></span>`;
      }
      reactHtml += '</div>';
    }

    const readers = (msg.read_by || []).filter(reader => Number(reader.user_id) !== Number(me.id));
    const showReadReceipt = isMe && !deleted && Number(msg.id) === Number(latestOwnMessageId) && readers.length > 0;
    const shownReaders = readers.slice(0, 5);
    const readerNames = readers.map(reader => reader.full_name || 'Thành viên').join(', ');
    const readReceiptHtml = showReadReceipt ? `<div class="chat-read-receipts" title="Đã xem: ${esc(readerNames)}" aria-label="Đã xem bởi ${esc(readerNames)}">
      ${shownReaders.map(reader => `<span class="chat-read-avatar-wrap" title="${esc(reader.full_name || 'Thành viên')}">${renderChatAvatar(reader, 18, 'chat-read-avatar')}</span>`).join('')}
      ${readers.length > shownReaders.length ? `<span class="chat-read-more">+${readers.length - shownReaders.length}</span>` : ''}
    </div>` : '';

    const content = deleted
      ? '<span class="chat-msg-bubble deleted">Tin nhắn đã bị xóa</span>'
      : `${msg.content ? `<span class="chat-msg-bubble">${renderMessageContent(msg)}</span>` : ''}${edited ? '<span class="chat-msg-edited">(đã sửa)</span>' : ''}`;

    html += `<div class="${cls}${msg.is_pinned ? ' chat-msg-pinned' : ''}" data-msg-id="${msg.id}">
      ${showAvatar ? renderChatAvatar({ full_name: msg.sender_name, avatar_url: msg.sender_avatar }, 32, 'chat-msg-avatar') : '<div class="chat-msg-avatar"></div>'}
      <div class="chat-msg-body">
        ${!grouped ? `<div class="chat-msg-header">
          <span class="chat-msg-sender">${isMe ? 'Bạn' : esc(msg.sender_name || 'Unknown')}</span>
          <span class="chat-msg-time">${formatTime(msg.created_at)}</span>
          ${msg.is_pinned ? `<span class="chat-msg-pin-label">${icon('pin', 'xs')} Đã ghim</span>` : ''}
        </div>` : ''}
        ${replyHtml}
        ${content}
        ${interactionHtml}
        ${taskHtml}
        ${attHtml}
        ${reactHtml}
        ${readReceiptHtml}
        ${!deleted ? `<div class="chat-msg-actions">
          <button class="chat-msg-action-btn" data-action="reply" data-msg-id="${msg.id}" aria-label="Trả lời">${icon('arrowRight', 'sm')}</button>
          <button class="chat-msg-action-btn" data-action="react" data-msg-id="${msg.id}" aria-label="Biểu cảm">${icon('smile', 'sm')}</button>
          <button class="chat-msg-action-btn" data-action="pin" data-msg-id="${msg.id}" aria-label="${msg.is_pinned ? 'Bỏ ghim' : 'Ghim tin nhắn'}">${icon('pin', 'sm')}</button>
          ${isMe ? `<button class="chat-msg-action-btn" data-action="edit" data-msg-id="${msg.id}" aria-label="Sửa">${icon('pencil', 'sm')}</button>
          <button class="chat-msg-action-btn" data-action="delete" data-msg-id="${msg.id}" aria-label="Xóa">${icon('trash2', 'sm')}</button>` : ''}
        </div>` : ''}
      </div>
    </div>`;
  }

  if (!messages.length) {
    html += `<div class="chat-main-empty" style="flex:1">
      <div class="chat-main-empty-icon">${icon('messageCircle', 'lg')}</div>
      <div class="chat-main-empty-title">Chưa có tin nhắn</div>
      <div class="chat-main-empty-sub">Hãy gửi tin nhắn đầu tiên để bắt đầu cuộc trò chuyện.</div>
    </div>`;
  }

  container.innerHTML = html;
  bindMessageActions(container);
}

function runComposerAction(action) {
  if (action === 'attach') return document.getElementById('chat-file-input')?.click();
  if (action === 'emoji') return openEmojiPicker();
  if (action === 'task') return openTaskPicker();
  if (action === 'mention') return insertMentionTrigger();
  if (action === 'poll') return openPollComposer();
  if (action === 'event') return openEventComposer();
}

function renderPollCard(message, isOwner) {
  const poll = message.poll;
  const selected = new Set((poll.voted_option_ids || []).map(Number));
  const total = (poll.options || []).reduce((sum, option) => sum + Number(option.vote_count || 0), 0);
  return `<section class="chat-interaction-card chat-poll-card" data-poll-message-id="${message.id}">
    <div class="chat-card-kicker">▥ BÌNH CHỌN ${poll.is_closed ? '· ĐÃ ĐÓNG' : ''}</div>
    <div class="chat-card-title">${esc(poll.question)}</div>
    <div class="chat-card-sub">Chọn nhiều phương án · ${total} lượt chọn</div>
    <div class="chat-poll-options">${(poll.options || []).map(option => {
      const checked = selected.has(Number(option.id));
      return `<label class="chat-poll-option${checked ? ' selected' : ''}">
        <input type="checkbox" data-poll-option="${option.id}" ${checked ? 'checked' : ''} ${poll.is_closed ? 'disabled' : ''}/>
        <span>${esc(option.option_text)}</span><b>${Number(option.vote_count || 0)}</b>
      </label>`;
    }).join('')}</div>
    ${!poll.is_closed ? `<div class="chat-card-actions"><button class="btn-secondary btn-xs" data-save-poll="${message.id}">Lưu lựa chọn</button>${isOwner ? `<button class="btn-secondary btn-xs" data-close-poll="${message.id}">Đóng poll</button>` : ''}</div>` : ''}
  </section>`;
}

function renderEventCard(message, isOwner) {
  const event = message.event;
  const when = formatChatDateTime(event.start_at) + (event.end_at ? ` – ${formatTime(event.end_at)}` : '');
  const responseLabels = { going: '✓ Tham gia', declined: 'Từ chối' };
  return `<section class="chat-interaction-card chat-event-card${event.cancelled_at ? ' cancelled' : ''}" data-event-message-id="${message.id}">
    <div class="chat-card-kicker">◷ SỰ KIỆN ${event.cancelled_at ? '· ĐÃ HỦY' : ''}</div>
    <div class="chat-card-title">${esc(event.title)}</div>
    <div class="chat-event-when">${esc(when)}</div>
    ${event.location ? `<div class="chat-event-detail">📍 ${esc(event.location)}</div>` : ''}
    ${event.meeting_url ? `<a class="chat-event-link" href="${esc(event.meeting_url)}" target="_blank" rel="noopener noreferrer">Mở link họp</a>` : ''}
    ${event.description ? `<div class="chat-event-detail">${esc(event.description)}</div>` : ''}
    <div class="chat-card-sub">${Number(event.going_count || 0)} tham gia · ${Number(event.attendee_count || 0)} người được mời</div>
    ${!event.cancelled_at ? `<div class="chat-card-actions">
      ${Object.entries(responseLabels).map(([value, label]) => `<button class="btn-secondary btn-xs ${event.my_response === value ? 'active' : ''}" data-event-response="${value}" data-event-message="${message.id}">${label}</button>`).join('')}
      ${isOwner ? `<button class="btn-secondary btn-xs" data-edit-event="${message.id}">Sửa</button><button class="btn-secondary btn-xs" data-cancel-event="${message.id}">Hủy sự kiện</button>` : ''}
    </div>` : ''}
  </section>`;
}

function bindMessageActions(container) {
  container.querySelectorAll('.chat-msg-action-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const msgId = Number(btn.dataset.msgId);
      const action = btn.dataset.action;
      const msg = messages.find(m => m.id === msgId);
      if (!msg) return;

      if (action === 'reply') setReplyTo(msg);
      else if (action === 'react') openQuickReaction(msgId);
      else if (action === 'pin') togglePinMessage(msg);
      else if (action === 'edit') editMessage(msg);
      else if (action === 'delete') deleteMessage(msgId);
    });
  });

  container.querySelectorAll('.chat-reaction').forEach(r => {
    r.addEventListener('click', async () => {
      const msgId = Number(r.dataset.msgId);
      const emoji = r.dataset.emoji;
      try {
        if (r.classList.contains('active')) {
          await api.delete(`/api/messages/${msgId}/reactions?emoji=${encodeURIComponent(emoji)}`);
        } else {
          await api.post(`/api/messages/${msgId}/reactions`, { emoji });
        }
        await refreshMessages();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  container.querySelectorAll('[data-save-poll]').forEach(btn => btn.addEventListener('click', async event => {
    event.stopPropagation();
    const messageId = Number(btn.dataset.savePoll);
    const card = btn.closest('[data-poll-message-id]');
    const option_ids = [...(card?.querySelectorAll('[data-poll-option]:checked') || [])].map(input => Number(input.dataset.pollOption));
    try {
      const { poll } = await api.put(`/api/messages/${messageId}/poll-votes`, { option_ids });
      const message = messages.find(item => Number(item.id) === messageId);
      if (message) { message.poll = poll; renderMessages(); }
    } catch (error) { toast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-close-poll]').forEach(btn => btn.addEventListener('click', async event => {
    event.stopPropagation();
    try {
      const { poll } = await api.post(`/api/messages/${Number(btn.dataset.closePoll)}/poll/close`, {});
      const message = messages.find(item => Number(item.id) === Number(btn.dataset.closePoll));
      if (message) { message.poll = poll; renderMessages(); }
    } catch (error) { toast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-event-response]').forEach(btn => btn.addEventListener('click', async event => {
    event.stopPropagation();
    const messageId = Number(btn.dataset.eventMessage);
    try {
      const { event: eventData } = await api.put(`/api/messages/${messageId}/event-response`, { response: btn.dataset.eventResponse });
      const message = messages.find(item => Number(item.id) === messageId);
      if (message) { message.event = eventData; renderMessages(); }
      publishUnreadCount();
    } catch (error) { toast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-edit-event]').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    const message = messages.find(item => Number(item.id) === Number(btn.dataset.editEvent));
    if (message?.event) editEvent(message);
  }));
  container.querySelectorAll('[data-cancel-event]').forEach(btn => btn.addEventListener('click', async event => {
    event.stopPropagation();
    if (!confirm('Hủy sự kiện này?')) return;
    try {
      const { event: eventData } = await api.delete(`/api/messages/${Number(btn.dataset.cancelEvent)}/event`);
      const message = messages.find(item => Number(item.id) === Number(btn.dataset.cancelEvent));
      if (message) { message.event = eventData; renderMessages(); }
      publishUnreadCount();
    } catch (error) { toast(error.message, 'error'); }
  }));

  container.querySelectorAll('.chat-reply-preview').forEach(r => {
    r.addEventListener('click', () => {
      const targetId = Number(r.dataset.scrollTo);
      const el = document.querySelector(`.chat-msg[data-msg-id="${targetId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  container.querySelectorAll('.chat-attachment').forEach(a => {
    a.addEventListener('click', () => {
      const key = a.dataset.key;
      if (key) window.open(getFileUrl(key), '_blank');
    });
  });

  container.querySelectorAll('.chat-attachment-image').forEach(img => {
    img.addEventListener('click', () => {
      if (img.requestFullscreen) img.requestFullscreen();
    });
  });

  container.querySelectorAll('.chat-task-card').forEach(card => {
    card.addEventListener('click', () => {
      const taskId = Number(card.dataset.taskId);
      if (taskId) navigate(`#/taskpanel/${taskId}`);
    });
  });
}

// ── Send message ────────────────────────────────────────────────────
async function sendMessage() {
  if (!activeConvId) return;
  const input = document.getElementById('chat-input');
  const content = (input?.value || '').trim();
  if (!content && !uploading) return;

  const btn = document.getElementById('chat-send-btn');
  btn.disabled = true;
  const success = await trySend(content);
  if (success) {
    if (input) { input.value = ''; autoGrow(input); }
    selectedMentions = [];
    selectedMentionAll = false;
    closeMentionMenu();
    replyTo = null;
    updateReplyPreview();
  }
  btn.disabled = false;
  input?.focus();
}

async function trySend(content) {
  const mention_ids = selectedMentions
    .filter(member => content.includes(`@${member.full_name}`))
    .map(member => Number(member.user_id));
  const mention_all = /(^|\s)@all\b/i.test(content);
  const payload = { type: 'message:send', content, mention_ids, mention_all };
  if (replyTo) payload.reply_to_id = replyTo.id;

  // @all needs an authoritative REST response so the sender sees a clear
  // permission error in a direct conversation instead of clearing the draft.
  if (!mention_all && ws && ws.readyState === WebSocket.OPEN && wsAuthenticated) {
    ws.send(JSON.stringify(payload));
    return true;
  }

  if (ws && ws.readyState === WebSocket.OPEN && !wsAuthenticated) {
    await waitForWsAuth(3000);
    if (wsAuthenticated && !mention_all) {
      ws.send(JSON.stringify(payload));
      return true;
    }
  }

  try {
    const { message } = await api.post(`/api/conversations/${activeConvId}/messages`, { content, reply_to_id: replyTo?.id, mention_ids, mention_all });
    if (message && !messages.find(m => m.id === message.id)) {
      messages.push(message);
      renderMessages();
      scrollToBottom();
    }
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

function waitForWsAuth(ms) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (wsAuthenticated) return resolve();
      if (Date.now() - start > ms) return resolve();
      setTimeout(check, 50);
    };
    check();
  });
}

async function refreshMessages() {
  const { messages: msgs } = await api.get(`/api/conversations/${activeConvId}/messages?limit=50`);
  messages = msgs;
  renderMessages();
  scrollToBottom();
}

// ── Reply ───────────────────────────────────────────────────────────
function setReplyTo(msg) {
  replyTo = msg;
  updateReplyPreview();
  document.getElementById('chat-input')?.focus();
}

function updateReplyPreview() {
  const el = document.getElementById('chat-composer-reply');
  if (!el) return;
  if (!replyTo) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  document.getElementById('chat-composer-reply-text').innerHTML =
    `Trả lời <strong>${esc(replyTo.sender_name || '?')}</strong>: ${esc((replyTo.content || '').slice(0, 40))}`;
}

// ── Edit / Delete ───────────────────────────────────────────────────
async function editMessage(msg) {
  const newContent = prompt('Sửa tin nhắn:', msg.content || '');
  if (!newContent || newContent === msg.content) return;
  try {
    await api.put(`/api/messages/${msg.id}`, { content: newContent });
    await refreshMessages();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteMessage(msgId) {
  if (!confirm('Xóa tin nhắn này?')) return;
  try {
    await api.delete(`/api/messages/${msgId}`);
    await refreshMessages();
  } catch (e) { toast(e.message, 'error'); }
}

async function togglePinMessage(message) {
  try {
    if (message.is_pinned) await api.delete(`/api/messages/${message.id}/pin`);
    else await api.post(`/api/messages/${message.id}/pin`, {});
    await refreshMessages();
    toast(message.is_pinned ? 'Đã bỏ ghim tin nhắn' : 'Đã ghim tin nhắn', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ── Quick reaction ──────────────────────────────────────────────────
async function openQuickReaction(msgId) {
  await openEmojiPicker(msgId);
}

async function openEmojiPicker(reactionMessageId = null) {
  let emojis = FALLBACK_PICKER_EMOJIS;
  try {
    const response = await api.get('/api/chat/emojis');
    emojis = [...new Set([...DEFAULT_REACTION_EMOJIS, ...(response.emojis || [])])].slice(0, 120);
  } catch (_) {}
  openModal(reactionMessageId ? 'Biểu cảm tin nhắn' : 'Chọn emoji', `<div class="chat-emoji-picker">
    <div class="chat-emoji-defaults">${DEFAULT_REACTION_EMOJIS.map(emoji => `<button type="button" data-chat-emoji="${emoji}">${emoji}</button>`).join('')}</div>
    <div class="chat-emoji-grid">${emojis.map(emoji => `<button type="button" data-chat-emoji="${emoji}">${emoji}</button>`).join('')}</div>
  </div>`);
  document.querySelectorAll('#modal [data-chat-emoji]').forEach(btn => btn.addEventListener('click', async () => {
    const emoji = btn.dataset.chatEmoji;
    if (!reactionMessageId) {
      const input = document.getElementById('chat-input');
      if (input) {
        input.setRangeText(emoji, input.selectionStart || 0, input.selectionEnd || 0, 'end');
        input.focus(); autoGrow(input);
      }
      closeModal();
      return;
    }
    try {
      await api.post(`/api/messages/${reactionMessageId}/reactions`, { emoji });
      closeModal();
      await refreshMessages();
    } catch (error) { toast(error.message, 'error'); }
  }));
}

function openPollComposer() {
  if (activeConversation?.type === 'direct') return toast('Bình chọn chỉ dùng trong nhóm', 'info');
  openModal('Tạo cuộc bình chọn', `<div class="field"><label>Câu hỏi *</label><textarea id="chat-poll-question" rows="3" placeholder="Bạn muốn hỏi điều gì?"></textarea></div>
    <div class="field"><label>Lựa chọn (chọn nhiều đáp án)</label>
      <div id="chat-poll-options" class="chat-poll-options">
        <input class="chat-poll-input" placeholder="Lựa chọn 1"/><input class="chat-poll-input" placeholder="Lựa chọn 2"/>
      </div>
      <button type="button" class="chat-poll-add-option" id="chat-poll-add-option">+ Thêm lựa chọn</button>
      <div class="chat-poll-option-note">Tối thiểu 2, tối đa 10 lựa chọn.</div>
    </div>`, '<button class="btn-secondary" id="chat-poll-cancel">Hủy</button><button class="btn-primary" id="chat-poll-create">Tạo bình chọn</button>');
  const optionsEl = document.getElementById('chat-poll-options');
  const addOptionBtn = document.getElementById('chat-poll-add-option');
  const addOption = () => {
    const count = optionsEl?.querySelectorAll('.chat-poll-input').length || 0;
    if (!optionsEl || count >= 10) return;
    const input = document.createElement('input');
    input.className = 'chat-poll-input';
    input.placeholder = `Lựa chọn ${count + 1}${count > 1 ? ' (không bắt buộc)' : ''}`;
    optionsEl.append(input);
    input.focus();
    if (addOptionBtn) addOptionBtn.disabled = count + 1 >= 10;
  };
  addOptionBtn?.addEventListener('click', addOption);
  document.getElementById('chat-poll-cancel')?.addEventListener('click', closeModal);
  document.getElementById('chat-poll-create')?.addEventListener('click', async event => {
    const submitButton = event.currentTarget;
    const question = document.getElementById('chat-poll-question')?.value.trim() || '';
    const options = [...document.querySelectorAll('.chat-poll-input')].map(input => input.value.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      toast('Poll cần câu hỏi và ít nhất 2 lựa chọn', 'error');
      (!question ? document.getElementById('chat-poll-question') : document.querySelector('.chat-poll-input'))?.focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Đang tạo...';
    try {
      const { message } = await api.post(`/api/conversations/${activeConvId}/messages`, { message_type: 'poll', poll: { question, options } });
      if (message && !messages.some(item => item.id === message.id)) { messages.push(message); renderMessages(); scrollToBottom(); }
      closeModal();
    } catch (error) { toast(error.message, 'error'); }
    finally { if (submitButton?.isConnected) { submitButton.disabled = false; submitButton.textContent = 'Tạo bình chọn'; } }
  });
}

function setEventFieldError(input, message) {
  if (!input) return;
  const field = input.closest('.field');
  input.setAttribute('aria-invalid', 'true');
  field?.classList.add('chat-event-field-invalid');
  let help = field?.querySelector('.chat-event-field-error');
  if (!help && field) { help = document.createElement('div'); help.className = 'chat-event-field-error'; field.append(help); }
  if (help) help.textContent = message;
}

function clearEventFieldError(input) {
  if (!input) return;
  input.removeAttribute('aria-invalid');
  const field = input.closest('.field');
  field?.classList.remove('chat-event-field-invalid');
  field?.querySelector('.chat-event-field-error')?.remove();
}

function eventFormPayload(prefix) {
  const locationInput = document.getElementById(`${prefix}-location`);
  const rawLocation = locationInput?.value.trim() || '';
  const normalizedUrl = /^www\./i.test(rawLocation) ? `https://${rawLocation}` : rawLocation;
  const isUrl = /^https?:\/\//i.test(normalizedUrl);
  return { event: {
    title: document.getElementById(`${prefix}-title`)?.value.trim() || '',
    start_at: document.getElementById(`${prefix}-start`)?.value || '',
    end_at: document.getElementById(`${prefix}-end`)?.value || '',
    location: isUrl ? '' : rawLocation,
    meeting_url: isUrl ? normalizedUrl : '',
    description: document.getElementById(`${prefix}-description`)?.value.trim() || '',
    attendee_ids: [...document.querySelectorAll('.chat-event-invitee input:checked')].map(input => Number(input.value)),
  }};
}

function validateEventForm(prefix) {
  const title = document.getElementById(`${prefix}-title`);
  const start = document.getElementById(`${prefix}-start`);
  const end = document.getElementById(`${prefix}-end`);
  const location = document.getElementById(`${prefix}-location`);
  const description = document.getElementById(`${prefix}-description`);
  [title, start, end, location, description].forEach(clearEventFieldError);
  const fail = (input, message) => { setEventFieldError(input, message); input?.focus(); return false; };
  if (!title?.value.trim()) return fail(title, 'Vui lòng nhập tiêu đề');
  if (title.value.trim().length > 200) return fail(title, 'Tiêu đề tối đa 200 ký tự');
  const startTime = start?.value ? new Date(start.value) : null;
  if (!startTime || Number.isNaN(startTime.getTime())) return fail(start, 'Vui lòng nhập thời gian bắt đầu hợp lệ');
  if (end?.value) {
    const endTime = new Date(end.value);
    if (Number.isNaN(endTime.getTime()) || endTime < startTime) return fail(end, 'Thời gian kết thúc phải sau hoặc bằng thời gian bắt đầu');
  }
  const rawLocation = location?.value.trim() || '';
  if (/^(https?:\/\/|www\.)/i.test(rawLocation)) {
    try { const url = new URL(/^www\./i.test(rawLocation) ? `https://${rawLocation}` : rawLocation); if (!/^https?:$/.test(url.protocol)) throw new Error('protocol'); }
    catch (_) { return fail(location, 'Link họp phải là URL http hoặc https hợp lệ'); }
  }
  if (rawLocation.length > 500) return fail(location, 'Địa điểm hoặc link họp tối đa 500 ký tự');
  if ((description?.value || '').trim().length > 2000) return fail(description, 'Mô tả tối đa 2.000 ký tự');
  return true;
}

function bindEventErrorClearing(prefix) {
  ['title', 'start', 'end', 'location', 'description'].forEach(name => {
    const input = document.getElementById(`${prefix}-${name}`);
    input?.addEventListener(name === 'start' || name === 'end' ? 'change' : 'input', () => clearEventFieldError(input));
  });
}

function openEventComposer() {
  if (activeConversation?.type === 'direct') return toast('Sự kiện chỉ dùng trong nhóm', 'info');
  const members = activeConversation.members || [];
  const memberRows = members.map(member => `<label class="chat-event-invitee"><input type="checkbox" value="${member.user_id}" checked/> ${esc(member.full_name || '')}</label>`).join('');
  openModal('Đặt lịch trong nhóm', `<div class="field"><label>Tiêu đề *</label><input id="chat-event-title" placeholder="Ví dụ: Họp cập nhật tiến độ"/></div>
    <div class="input-row"><div class="field"><label>Bắt đầu *</label><input id="chat-event-start" type="datetime-local"/></div><div class="field"><label>Kết thúc</label><input id="chat-event-end" type="datetime-local"/></div></div>
    <div class="field"><label>Địa điểm hoặc link họp</label><input id="chat-event-location" placeholder="Phòng họp / https://..."/></div>
    <div class="field"><label>Mô tả</label><textarea id="chat-event-description" rows="3"></textarea></div>
    <div class="field"><label>Mời thành viên</label><div class="chat-event-invitees">${memberRows}</div></div>`, '<button class="btn-secondary" id="chat-event-cancel">Hủy</button><button class="btn-primary" id="chat-event-create">Tạo sự kiện</button>');
  document.getElementById('chat-event-cancel')?.addEventListener('click', closeModal);
  bindEventErrorClearing('chat-event');
  document.getElementById('chat-event-create')?.addEventListener('click', async event => {
    const submitButton = event.currentTarget;
    if (!validateEventForm('chat-event')) return;
    const payload = { message_type: 'event', ...eventFormPayload('chat-event') };
    submitButton.disabled = true;
    submitButton.textContent = 'Đang tạo...';
    try {
      const { message } = await api.post(`/api/conversations/${activeConvId}/messages`, payload);
      if (message && !messages.some(item => item.id === message.id)) { messages.push(message); renderMessages(); scrollToBottom(); }
      publishUnreadCount();
      closeModal();
    } catch (error) { toast(error.message, 'error'); }
    finally { if (submitButton?.isConnected) { submitButton.disabled = false; submitButton.textContent = 'Tạo sự kiện'; } }
  });
}

function editEvent(message) {
  const existing = message.event;
  const toLocalValue = value => value ? String(value).replace(' ', 'T').slice(0, 16) : '';
  openModal('Sửa sự kiện', `<div class="field"><label>Tiêu đề *</label><input id="chat-event-edit-title" value="${esc(existing.title || '')}"/></div>
    <div class="input-row"><div class="field"><label>Bắt đầu *</label><input id="chat-event-edit-start" type="datetime-local" value="${esc(toLocalValue(existing.start_at))}"/></div><div class="field"><label>Kết thúc</label><input id="chat-event-edit-end" type="datetime-local" value="${esc(toLocalValue(existing.end_at))}"/></div></div>
    <div class="field"><label>Địa điểm hoặc link họp</label><input id="chat-event-edit-location" value="${esc(existing.meeting_url || existing.location || '')}"/></div>
    <div class="field"><label>Mô tả</label><textarea id="chat-event-edit-description" rows="3">${esc(existing.description || '')}</textarea></div>`, '<button class="btn-secondary" id="chat-event-edit-cancel">Hủy</button><button class="btn-primary" id="chat-event-edit-save">Lưu thay đổi</button>');
  document.getElementById('chat-event-edit-cancel')?.addEventListener('click', closeModal);
  bindEventErrorClearing('chat-event-edit');
  document.getElementById('chat-event-edit-save')?.addEventListener('click', async event => {
    const submitButton = event.currentTarget;
    if (!validateEventForm('chat-event-edit')) return;
    const payload = eventFormPayload('chat-event-edit');
    delete payload.event.attendee_ids;
    submitButton.disabled = true;
    submitButton.textContent = 'Đang lưu...';
    try {
      const { event: eventData } = await api.put(`/api/messages/${message.id}/event`, payload);
      const current = messages.find(item => Number(item.id) === Number(message.id));
      if (current) { current.event = eventData; renderMessages(); }
      publishUnreadCount();
      closeModal();
    } catch (error) { toast(error.message, 'error'); }
    finally { if (submitButton?.isConnected) { submitButton.disabled = false; submitButton.textContent = 'Lưu thay đổi'; } }
  });
}

// ── File upload ─────────────────────────────────────────────────────
async function handleFileUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length || !activeConvId) return;
  uploading = true;
  try {
    for (const file of files) {
      const att = await api.uploadFile(`/api/conversations/${activeConvId}/upload`, file);
      await api.post(`/api/conversations/${activeConvId}/messages`, { content: '', attachments: [att] });
    }
    await refreshMessages();
  } catch (err) { toast(err.message, 'error'); }
  uploading = false;
  e.target.value = '';
}

// ── Task picker ─────────────────────────────────────────────────────
async function openTaskPicker() {
  openModal('Gắn Task', `<div id="chat-task-picker">${loadingHTML()}</div>`);
  try {
    const { tasks = [] } = await api.get('/api/tasks?limit=20');
    const html = tasks.length
      ? `<div style="max-height:400px;overflow-y:auto">${tasks.map(t => `
        <div class="chat-new-user" data-task-id="${t.id}" data-task-title="${esc(t.title || '')}">
          <div class="chat-conv-avatar" style="width:36px;height:36px;font-size:14px">${icon('clipboardList', 'sm')}</div>
          <div style="min-width:0">
            <div class="chat-conv-name" style="font-size:13px">${esc(t.title || 'Untitled')}</div>
            <div class="chat-conv-preview">${esc(t.status || '')} · ${esc(t.priority || '')}</div>
          </div>
        </div>`).join('')}</div>`
      : '<div class="empty-state">Không có task nào</div>';
    document.getElementById('chat-task-picker').innerHTML = html;
    document.querySelectorAll('#chat-task-picker .chat-new-user').forEach(item => {
      item.addEventListener('click', async () => {
        try {
          await api.post(`/api/conversations/${activeConvId}/messages`, { task_id: Number(item.dataset.taskId), content: '' });
          closeModal();
          await refreshMessages();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  } catch (e) {
    document.getElementById('chat-task-picker').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

// ── Conversation search modal ───────────────────────────────────────
function openSearchModal() {
  openModal('Tìm kiếm tin nhắn', `<div style="padding:4px">
    <input id="chat-search-input" class="chat-new-search" type="text" placeholder="Tìm kiếm tin nhắn..." />
    <div id="chat-search-results"></div>
  </div>`);
  document.getElementById('chat-search-input')?.addEventListener('input', debounce(async () => {
    const q = document.getElementById('chat-search-input')?.value || '';
    const resultsEl = document.getElementById('chat-search-results');
    if (!resultsEl || q.length < 2) { if (resultsEl) resultsEl.innerHTML = ''; return; }
    try {
      const { results } = await api.get(`/api/search/messages?q=${encodeURIComponent(q)}&conversation_id=${activeConvId}&limit=20`);
      resultsEl.innerHTML = results.length ? results.map(r => `
        <div class="chat-new-user" data-search-msg="${r.id}">
          <div class="chat-conv-avatar" style="width:36px;height:36px;font-size:14px">${(r.sender_name || '?').charAt(0).toUpperCase()}</div>
          <div style="min-width:0">
            <div class="chat-conv-name" style="font-size:13px">${esc(r.sender_name)}</div>
            <div class="chat-conv-preview">${esc((r.content || '').slice(0, 60))}</div>
          </div>
        </div>`).join('') : '<div class="empty-state">Không tìm thấy</div>';
      document.querySelectorAll('#chat-search-results [data-search-msg]').forEach(item => {
        item.addEventListener('click', () => {
          closeModal();
          const el = document.querySelector(`.chat-msg[data-msg-id="${Number(item.dataset.searchMsg)}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    } catch (e) { resultsEl.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
  }, 300));
}

// ── More menu ───────────────────────────────────────────────────────
function openMoreMenu(conv) {
  const isDM = conv.type === 'direct';
  const attachmentCount = messages.reduce((total, message) => total + (message.attachments || []).length, 0);
  const latestMessage = messages[messages.length - 1];
  const summary = `
    <div class="chat-info-hero">
      ${renderChatAvatar(isDM ? (conv.members || []).find(m => m.user_id !== me.id) : { full_name: conv.name || 'Nhóm' }, 54, 'chat-info-avatar')}
      <div><strong>${esc(isDM ? ((conv.members || []).find(m => m.user_id !== me.id)?.full_name || 'Hội thoại trực tiếp') : (conv.name || 'Nhóm làm việc'))}</strong>
      <span>${isDM ? 'Hội thoại trực tiếp' : `Nhóm làm việc · ${conv.members.length} thành viên`}</span></div>
    </div>
    <div class="chat-info-stats">
      <div><strong>${conv.members.length}</strong><span>Thành viên</span></div>
      <div><strong>${attachmentCount}</strong><span>Tệp gần đây</span></div>
      <div><strong>${latestMessage ? formatChatTime(latestMessage.created_at) : '—'}</strong><span>Hoạt động cuối</span></div>
    </div>`;
  const members = (conv.members || []).map(m => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
      ${renderChatAvatar(m, 34)}
      <span style="font-size:13.5px;font-weight:500;color:var(--text)">${esc(m.full_name || '')}</span>
      ${m.role === 'owner' ? '<span class="badge badge-success">Owner</span>' : ''}
    </div>`).join('');

  const isOwner = !isDM && (conv.members || []).some(member => Number(member.user_id) === Number(me.id) && member.role === 'owner');
  const actions = !isDM ? `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn-secondary btn-sm" id="chat-rename-btn">${icon('pencil', 'sm')} Đổi tên</button>
      <button class="btn-secondary btn-sm" id="chat-add-member-btn">${icon('userPlus', 'sm')} Thêm</button>
      ${isOwner ? `<button class="btn-danger btn-sm" id="chat-dissolve-btn">${icon('trash2', 'sm')} Giải tán nhóm</button>` : ''}
    </div>` : '';

  openModal('Thông tin cuộc trò chuyện', `
    <div style="padding:4px">
      ${summary}
      ${actions}
      <div id="chat-shared-panel" class="chat-shared-panel">${loadingHTML()}</div>
      <div style="font-size:12px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Thành viên (${conv.members.length})</div>
      <div>${members}</div>
    </div>`,
    '<button class="btn-secondary" id="chat-more-close">Đóng</button>');
  document.getElementById('chat-more-close')?.addEventListener('click', closeModal);

  document.getElementById('chat-rename-btn')?.addEventListener('click', () => renameConversation(conv));
  document.getElementById('chat-add-member-btn')?.addEventListener('click', () => addMemberFlow(conv));
  document.getElementById('chat-dissolve-btn')?.addEventListener('click', () => dissolveConversation(conv));
  loadConversationInfoPanel(conv.id);
}

async function dissolveConversation(conv) {
  const confirmation = window.prompt(`Giải tán nhóm “${conv.name || 'Nhóm làm việc'}”?\n\nToàn bộ thành viên sẽ mất quyền truy cập. Nhập GIẢI TÁN để xác nhận:`);
  if (confirmation !== 'GIẢI TÁN') return;
  try {
    await api.delete(`/api/conversations/${conv.id}`);
    closeModal();
    if (Number(activeConvId) === Number(conv.id)) renderEmptyChat();
    conversations = conversations.filter(item => Number(item.id) !== Number(conv.id));
    renderSidebarList();
    toast('Nhóm đã được giải tán. Lịch sử được lưu audit.', 'success');
  } catch (error) {
    toast(error.message || 'Không thể giải tán nhóm', 'error');
  }
}

async function loadConversationInfoPanel(conversationId) {
  const panel = document.getElementById('chat-shared-panel');
  if (!panel) return;
  try {
    const [pinned, images, files, links] = await Promise.all([
      api.get(`/api/conversations/${conversationId}/pinned`),
      api.get(`/api/conversations/${conversationId}/shared/images?limit=12`),
      api.get(`/api/conversations/${conversationId}/shared/files?limit=6`),
      api.get(`/api/conversations/${conversationId}/shared/links?limit=30`),
    ]);
    const linkItems = (links.items || []).flatMap(item => extractLinks(item.content).map(url => ({ ...item, url }))).slice(0, 6);
    panel.innerHTML = `
      ${renderPinnedSection(pinned.messages || [])}
      ${renderSharedImages(images.items || [])}
      ${renderSharedFiles(files.items || [])}
      ${renderSharedLinks(linkItems)}
    `;
    bindSharedPanelActions(panel, { pinned: pinned.messages || [], images: images.items || [], files: files.items || [], links: linkItems });
  } catch (error) {
    panel.innerHTML = `<div class="chat-shared-error">Không thể tải nội dung đã chia sẻ: ${esc(error.message)}</div>`;
  }
}

function renderPinnedSection(items) {
  return `<section class="chat-info-section">
    <div class="chat-info-section-head"><span>${icon('pin', 'sm')} Tin nhắn đã ghim</span><span class="chat-info-count">${items.length}</span></div>
    ${items.length ? `<div class="chat-pinned-list">${items.slice(0, 3).map(item => `
      <button class="chat-pinned-item" data-jump-message="${item.id}">
        <strong>${esc(item.sender_name || 'Thành viên')}</strong><span>${esc((item.content || (item.attachments?.length ? 'Tệp đính kèm' : 'Tin nhắn')).slice(0, 86))}</span>
      </button>`).join('')}</div>` : '<div class="chat-shared-empty">Chưa có tin nhắn nào được ghim.</div>'}
  </section>`;
}

function renderSharedImages(items) {
  return `<section class="chat-info-section">
    <div class="chat-info-section-head"><span>${icon('image', 'sm')} Ảnh</span>${items.length > 6 ? '<button class="chat-info-all" data-shared-all="images">Xem tất cả</button>' : ''}</div>
    ${items.length ? `<div class="chat-media-grid">${items.slice(0, 6).map(item => `
      <button class="chat-media-thumb" data-open-image="${esc(item.storage_key)}" aria-label="Mở ${esc(item.file_name)}"><img src="${getFileUrl(item.storage_key)}" alt="${esc(item.file_name)}" /></button>`).join('')}</div>` : '<div class="chat-shared-empty">Chưa có ảnh hoặc video được chia sẻ.</div>'}
  </section>`;
}

function renderSharedFiles(items) {
  return `<section class="chat-info-section">
    <div class="chat-info-section-head"><span>${icon('fileText', 'sm')} File</span>${items.length > 3 ? '<button class="chat-info-all" data-shared-all="files">Xem tất cả</button>' : ''}</div>
    ${items.length ? `<div class="chat-shared-file-list">${items.slice(0, 3).map(item => `
      <button class="chat-shared-file" data-open-file="${esc(item.storage_key)}">
        <span class="chat-shared-file-icon">${icon('fileText', 'md')}</span><span><strong>${esc(item.file_name || 'Tệp đính kèm')}</strong><small>${formatSize(item.file_size)} · ${formatChatTime(item.message_created_at)}</small></span>
      </button>`).join('')}</div>` : '<div class="chat-shared-empty">Chưa có file được chia sẻ.</div>'}
  </section>`;
}

function renderSharedLinks(items) {
  return `<section class="chat-info-section">
    <div class="chat-info-section-head"><span>${icon('link', 'sm')} Link</span>${items.length > 3 ? '<button class="chat-info-all" data-shared-all="links">Xem tất cả</button>' : ''}</div>
    ${items.length ? `<div class="chat-shared-link-list">${items.slice(0, 3).map(item => `
      <a class="chat-shared-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span class="chat-shared-link-icon">${icon('link', 'sm')}</span><span><strong>${esc(linkLabel(item.url))}</strong><small>${esc(linkDomain(item.url))} · ${formatChatTime(item.message_created_at)}</small></span></a>`).join('')}</div>` : '<div class="chat-shared-empty">Chưa có link được chia sẻ.</div>'}
  </section>`;
}

function bindSharedPanelActions(panel, data) {
  panel.querySelectorAll('[data-jump-message]').forEach(button => button.addEventListener('click', () => {
    closeModal();
    const target = document.querySelector(`.chat-msg[data-msg-id="${Number(button.dataset.jumpMessage)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast('Tin nhắn này nằm ngoài lịch sử đang tải.', 'info');
  }));
  panel.querySelectorAll('[data-open-image]').forEach(button => button.addEventListener('click', () => window.open(getFileUrl(button.dataset.openImage), '_blank', 'noopener')));
  panel.querySelectorAll('[data-open-file]').forEach(button => button.addEventListener('click', () => window.open(getFileUrl(button.dataset.openFile), '_blank', 'noopener')));
  panel.querySelectorAll('[data-shared-all]').forEach(button => button.addEventListener('click', () => openSharedItemsModal(button.dataset.sharedAll, data)));
}

function openSharedItemsModal(kind, data) {
  const items = data[kind] || [];
  const title = kind === 'images' ? 'Ảnh đã chia sẻ' : kind === 'files' ? 'File đã chia sẻ' : 'Link đã chia sẻ';
  const content = kind === 'images' ? `<div class="chat-media-grid chat-media-grid-all">${items.map(item => `<button class="chat-media-thumb" data-open-image="${esc(item.storage_key)}"><img src="${getFileUrl(item.storage_key)}" alt="${esc(item.file_name)}" /></button>`).join('')}</div>`
    : kind === 'files' ? `<div class="chat-shared-file-list">${items.map(item => `<button class="chat-shared-file" data-open-file="${esc(item.storage_key)}"><span class="chat-shared-file-icon">${icon('fileText', 'md')}</span><span><strong>${esc(item.file_name || 'Tệp đính kèm')}</strong><small>${formatSize(item.file_size)} · ${formatChatTime(item.message_created_at)}</small></span></button>`).join('')}</div>`
    : `<div class="chat-shared-link-list">${items.map(item => `<a class="chat-shared-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span class="chat-shared-link-icon">${icon('link', 'sm')}</span><span><strong>${esc(linkLabel(item.url))}</strong><small>${esc(linkDomain(item.url))} · ${formatChatTime(item.message_created_at)}</small></span></a>`).join('')}</div>`;
  openModal(title, `<div class="chat-shared-all-modal">${content || '<div class="chat-shared-empty">Chưa có nội dung để hiển thị.</div>'}</div>`);
  document.querySelectorAll('#modal [data-open-image]').forEach(button => button.addEventListener('click', () => window.open(getFileUrl(button.dataset.openImage), '_blank', 'noopener')));
  document.querySelectorAll('#modal [data-open-file]').forEach(button => button.addEventListener('click', () => window.open(getFileUrl(button.dataset.openFile), '_blank', 'noopener')));
}

function extractLinks(content) { return String(content || '').match(/https?:\/\/[^\s<]+/g) || []; }
function linkDomain(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; } }
function linkLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}` || url;
  } catch (_) { return url; }
}

async function renameConversation(conv) {
  const name = prompt('Nhập tên mới:', conv.name || '');
  if (!name || name === conv.name) return;
  try {
    await api.put(`/api/conversations/${conv.id}`, { name });
    closeModal();
    await loadConversations();
    openConversation(conv.id);
  } catch (e) { toast(e.message, 'error'); }
}

async function addMemberFlow(conv) {
  closeModal();
  openModal('Thêm thành viên', `
    <input id="chat-add-user-search" class="chat-new-search" type="text" placeholder="Tìm nhân viên..." autocomplete="off" />
    <div style="height:5px"></div>
    <div id="chat-add-users">${loadingHTML()}</div>`,
    '<button class="btn-secondary" id="chat-add-close">Đóng</button>');
  document.getElementById('chat-add-close')?.addEventListener('click', closeModal);

  let allUsers = [];
  const renderUsers = async () => {
    const q = (document.getElementById('chat-add-user-search')?.value || '').trim().toLowerCase();
    const usersEl = document.getElementById('chat-add-users');
    try {
      if (!allUsers.length) { const { users = [] } = await api.get('/api/users'); allUsers = users; }
      const existingIds = new Set((conv.members || []).map(m => m.user_id));
      const filtered = q ? allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(q) && !existingIds.has(u.id)
      ) : allUsers.filter(u => !existingIds.has(u.id));
      usersEl.innerHTML = filtered.length ? filtered.map(u => `
        <div class="chat-new-user" data-uid="${u.id}">
          ${renderChatAvatar(u, 38)}
          <div style="min-width:0">
            <div class="chat-conv-name" style="font-size:13.5px">${esc(u.full_name || '')}</div>
            <div class="chat-conv-preview">${esc(u.department || '')} · ${esc(u.position || '')}</div>
          </div>
        </div>`).join('') : '<div class="empty-state">Không tìm thấy</div>';
      usersEl.querySelectorAll('.chat-new-user').forEach(item => {
        item.addEventListener('click', async () => {
          try {
            await api.post(`/api/conversations/${conv.id}/members`, { action: 'add', user_ids: [Number(item.dataset.uid)] });
            closeModal();
            await loadConversations();
            openConversation(conv.id);
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (e) { usersEl.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
  };
  document.getElementById('chat-add-user-search')?.addEventListener('input', debounce(renderUsers, 250));
  renderUsers();
}

// ── New conversation flow ───────────────────────────────────────────
async function openNewConversation() {
  openModal('Tạo cuộc trò chuyện', `
    <input id="chat-new-search" class="chat-new-search" type="text" placeholder="Tìm nhân viên..." autocomplete="off" />
    <div style="height:5px"></div>
    <div id="chat-new-users">${loadingHTML()}</div>`,
    '<button class="btn-primary" id="chat-new-start" disabled>Bắt đầu</button>');
  const selected = new Set();
  let allUsers = [];

  const renderUsers = async () => {
    const q = (document.getElementById('chat-new-search')?.value || '').trim().toLowerCase();
    const usersEl = document.getElementById('chat-new-users');
    try {
      if (!allUsers.length) {
        const { users = [] } = await api.get('/api/users');
        allUsers = users;
      }
      const filtered = q ? allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.position || '').toLowerCase().includes(q)
      ) : allUsers;
      usersEl.innerHTML = filtered.length ? filtered.map(u => `
        <div class="chat-new-user${selected.has(u.id) ? ' selected' : ''}" data-uid="${u.id}">
          ${renderChatAvatar(u, 38)}
          <div style="min-width:0">
            <div class="chat-conv-name" style="font-size:13.5px">${esc(u.full_name || '')}</div>
            <div class="chat-conv-preview">${esc(u.department || '')} · ${esc(u.position || '')}</div>
          </div>
        </div>`).join('') : '<div class="empty-state">Không tìm thấy nhân viên</div>';
      document.querySelectorAll('#chat-new-users .chat-new-user').forEach(item => {
        item.addEventListener('click', () => {
          const uid = Number(item.dataset.uid);
          if (selected.has(uid)) selected.delete(uid);
          else selected.add(uid);
          item.classList.toggle('selected', selected.has(uid));
          document.getElementById('chat-new-start').disabled = selected.size === 0;
        });
      });
    } catch (e) {
      usersEl.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  };

  document.getElementById('chat-new-search')?.addEventListener('input', debounce(renderUsers, 250));
  renderUsers();

  document.getElementById('chat-new-start')?.addEventListener('click', async () => {
    const ids = [...selected];
    const type = ids.length === 1 ? 'direct' : 'group';
    try {
      const { conversation_id } = await api.post('/api/conversations', { type, member_ids: ids });
      closeModal();
      await loadConversations();
      openConversation(conversation_id);
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ── WebSocket ───────────────────────────────────────────────────────
function connectWS(convId) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('hr_token') || '';
  const wsUrl = `${protocol}//${location.host}/api/chat/ws/${convId}`;

  wsAuthenticated = false;
  wsIntentionalClose = false;
  const gen = ++wsGeneration;
  const connectionConvId = convId;
  let reconnectDelay = 1000;

  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, user_id: me.id }));
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    };
    ws.onmessage = (event) => {
      if (gen !== wsGeneration) return; // stale connection
      const data = JSON.parse(event.data);
      if (data.type === 'auth:ok') {
        wsAuthenticated = true;
        reconnectDelay = 1000;
      } else if (data.type === 'auth:error') {
        console.warn('Chat WS auth failed:', data.message);
        wsAuthenticated = false;
        if (data.message === 'Not a member' || data.message === 'Invalid token') {
          wsIntentionalClose = true;
          ws.close();
        }
      } else if (data.type === 'message:new') {
        if (Number(data.message.conversation_id) === activeConvId) {
          if (!messages.find(m => m.id === data.message.id)) {
            messages.push(data.message);
            renderMessages();
            scrollToBottom();
            markRead(data.message.id);
            loadConversationsSilently();
          }
        }
      } else if (data.type === 'conversation:dissolved') {
        toast('Nhóm này đã được Owner giải tán.', 'info');
        renderEmptyChat();
        loadConversationsSilently();
      } else if (data.type === 'message:edit' || data.type === 'message:delete') {
        refreshMessages();
      } else if (data.type === 'conversation:read') {
        applyReadReceipt(data);
      } else if (data.type === 'reaction:update') {
        const msg = messages.find(m => m.id === data.message_id);
        if (msg) { msg.reactions = data.reactions; renderMessages(); }
      } else if (data.type === 'poll:update') {
        refreshMessages();
      } else if (data.type === 'event:update') {
        refreshMessages();
        publishUnreadCount();
      }
    };
    ws.onclose = () => {
      wsAuthenticated = false;
      if (wsIntentionalClose || gen !== wsGeneration) return;
      wsReconnectTimer = setTimeout(() => {
        if (activeConvId === connectionConvId && gen === wsGeneration) {
          connectWS(connectionConvId);
        }
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
    ws.onerror = () => { wsAuthenticated = false; ws?.close(); };
  } catch (_) { wsAuthenticated = false; }
}

function disconnectWS() {
  wsAuthenticated = false;
  wsIntentionalClose = true;
  wsGeneration = Math.max(0, wsGeneration - 1);
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
}

async function markRead(msgId) {
  try {
    await api.post(`/api/messages/${msgId}/read`, {});
    return true;
  } catch (e) {
    console.warn('markRead failed:', e.message);
    return false;
  }
}

let silentLoadTimer = null;
function loadConversationsSilently() {
  if (silentLoadTimer) clearTimeout(silentLoadTimer);
  silentLoadTimer = setTimeout(() => {
    api.get('/api/conversations').then(({ conversations: convs }) => {
      conversations = convs;
      publishUnreadCount();
      renderSidebarList();
    }).catch(() => {});
  }, 800);
}

// ── Scroll ──────────────────────────────────────────────────────────
function scrollToBottom() {
  setTimeout(() => {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }, 50);
}

function scrollToMessage(messageId) {
  setTimeout(() => {
    const target = document.querySelector(`.chat-msg[data-msg-id="${Number(messageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('chat-msg-highlight');
    setTimeout(() => target.classList.remove('chat-msg-highlight'), 1800);
  }, 80);
}

async function onScrollLoadMore() {
  const container = document.getElementById('chat-messages');
  if (!container || loadingMore) return;
  if (container.scrollTop > 60) return;
  loadingMore = true;
  const oldest = messages[0];
  if (!oldest) { loadingMore = false; return; }
  try {
    const { messages: older } = await api.get(`/api/conversations/${activeConvId}/messages?before=${oldest.id}&limit=30`);
    if (older.length) {
      const prevHeight = container.scrollHeight;
      messages = [...older, ...messages];
      renderMessages();
      container.scrollTop = container.scrollHeight - prevHeight;
    }
  } catch (_) {}
  loadingMore = false;
}

// ── Helpers ─────────────────────────────────────────────────────────
function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function applyReadReceipt(data) {
  if (Number(data.user_id) === Number(me.id) || !data.message_id) return;
  const reader = activeConversation?.members?.find(member => Number(member.user_id) === Number(data.user_id));
  if (!reader) return;
  let changed = false;
  for (const message of messages) {
    if (Number(message.sender_id) !== Number(me.id) || Number(message.id) > Number(data.message_id)) continue;
    message.read_by ||= [];
    if (!message.read_by.some(item => Number(item.user_id) === Number(reader.user_id))) {
      message.read_by.push(reader);
      changed = true;
    }
  }
  if (changed) renderMessages();
}
function renderMessageContent(message) {
  let html = esc(message.content || '');
  if (message.mention_all) html = html.replace(/(^|\s)(@all)\b/gi, '$1<mark class="chat-mention chat-mention-all">$2</mark>');
  for (const mention of (message.mentions || [])) {
    const label = `@${mention.full_name || ''}`;
    if (!mention.full_name) continue;
    const escapedLabel = esc(label);
    html = html.split(escapedLabel).join(`<mark class="chat-mention" title="Đã tag ${esc(mention.full_name)}">${escapedLabel}</mark>`);
  }
  return html;
}
function timeDiffMin(a, b) {
  const da = new Date(a.endsWith('Z') ? a : a + 'Z');
  const db = new Date(b.endsWith('Z') ? b : b + 'Z');
  return Math.abs((db - da) / 60000);
}
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
function formatChatDateTime(value) {
  if (!value) return '';
  const date = new Date(String(value).endsWith('Z') ? value : String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hôm nay';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function renderChatAvatar(member, size = 44, extraClass = 'chat-conv-avatar') {
  if (!member) return `<div class="${extraClass}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px">?</div>`;
  const avatarUrl = member.avatar_url || '';
  const initial = (member.full_name || '?').charAt(0).toUpperCase();
  if (avatarUrl) {
    return `<div class="${extraClass} chat-avatar-img" style="width:${size}px;height:${size}px">
      <img src="${avatarUrl}" alt="${esc(member.full_name || '')}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover" />
    </div>`;
  }
  return `<div class="${extraClass}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.36)}px">${initial}</div>`;
}

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function getFileUrl(storageKey) {
  return `/api/documents/${encodeURIComponent(storageKey)}`;
}
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

let mentionState = null;

function insertMentionTrigger() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const start = input.selectionStart || 0;
  const prefix = start && !/\s/.test(input.value[start - 1]) ? ' ' : '';
  input.setRangeText(`${prefix}@`, start, input.selectionEnd || start, 'end');
  input.focus();
  autoGrow(input);
  updateMentionSuggestions();
}

function updateMentionSuggestions() {
  const input = document.getElementById('chat-input');
  const menu = document.getElementById('chat-mention-menu');
  if (!input || !menu || !activeConversation) return;
  const cursor = input.selectionStart || 0;
  const beforeCursor = input.value.slice(0, cursor);
  const match = /(^|\s)@([^@\n]*)$/.exec(beforeCursor);
  if (!match) return closeMentionMenu();
  const query = match[2].trim();
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const candidates = (activeConversation.members || [])
    .filter(member => Number(member.user_id) !== Number(me.id))
    .filter(member => !query || normalize(member.full_name).includes(normalize(query)))
    .slice(0, 6);
  if (activeConversation.type !== 'direct' && (!query || 'all'.startsWith(normalize(query)))) {
    candidates.unshift({ user_id: 'all', full_name: 'All', department: 'Thông báo toàn bộ nhóm', mention_all: true });
  }
  if (!candidates.length) return closeMentionMenu();
  mentionState = { start: cursor - match[2].length - 1, end: cursor, candidates, index: 0 };
  renderMentionMenu();
}

function renderMentionMenu() {
  const menu = document.getElementById('chat-mention-menu');
  if (!menu || !mentionState) return;
  menu.hidden = false;
  menu.innerHTML = `<div class="chat-mention-title">Tag thành viên</div>${mentionState.candidates.map((member, index) => `
    <button class="chat-mention-option${index === mentionState.index ? ' active' : ''}" data-mention-index="${index}" role="option" aria-selected="${index === mentionState.index}">
      ${member.mention_all ? '<div class="chat-mention-avatar chat-mention-all">@</div>' : renderChatAvatar(member, 30, 'chat-mention-avatar')}
      <span><strong>${esc(member.full_name || '')}</strong><small>${esc(member.department || member.employee_code || 'Thành viên')}</small></span>
    </button>`).join('')}`;
  menu.querySelectorAll('[data-mention-index]').forEach(option => option.addEventListener('mousedown', event => {
    event.preventDefault();
    chooseMention(Number(option.dataset.mentionIndex));
  }));
}

function handleMentionKeydown(event) {
  if (!mentionState) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const size = mentionState.candidates.length;
    mentionState.index = (mentionState.index + (event.key === 'ArrowDown' ? 1 : size - 1)) % size;
    renderMentionMenu();
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    chooseMention(mentionState.index);
    return true;
  }
  if (event.key === 'Escape') { event.preventDefault(); closeMentionMenu(); return true; }
  return false;
}

function chooseMention(index) {
  const input = document.getElementById('chat-input');
  const member = mentionState?.candidates[index];
  if (!input || !member || !mentionState) return;
  input.setRangeText(`@${member.full_name} `, mentionState.start, mentionState.end, 'end');
  if (member.mention_all) selectedMentionAll = true;
  else selectedMentions = [...selectedMentions.filter(item => item.user_id !== member.user_id), member];
  closeMentionMenu();
  input.focus();
  autoGrow(input);
}

function closeMentionMenu() {
  mentionState = null;
  const menu = document.getElementById('chat-mention-menu');
  if (menu) { menu.hidden = true; menu.innerHTML = ''; }
}
