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
let messages = [];
let ws = null;
let wsReconnectTimer = null;
let me = null;
let replyTo = null;
let uploading = false;
let loadingMore = false;
let activeTab = 'all';

// ── Render entry ────────────────────────────────────────────────────
export async function renderChat(el, user) {
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
  el._cleanup = () => disconnectWS();
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
  return `<div class="${cls}" data-conv-id="${c.id}" role="button" tabindex="0" aria-selected="${isActive}">
    <div class="chat-conv-avatar">${(name || '?').charAt(0).toUpperCase()}</div>
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
async function openConversation(convId) {
  activeConvId = convId;
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
    const { messages: msgs } = await api.get(`/api/conversations/${convId}/messages?limit=50`);
    messages = msgs;
    renderConversation(conv);
    renderMessages();
    scrollToBottom();
    connectWS(convId);
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

  const convEl = document.getElementById('chat-conversation');
  convEl.innerHTML = `
    <div class="chat-conv-header">
      <div class="chat-conv-header-left">
        <button class="chat-header-action chat-back-btn" id="chat-back-btn" aria-label="Quay lại">${icon('chevronLeft', 'md')}</button>
        <div class="chat-conv-header-avatar">${(name || '?').charAt(0).toUpperCase()}</div>
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
  document.getElementById('chat-attach-btn')?.addEventListener('click', () => document.getElementById('chat-file-input')?.click());
  document.getElementById('chat-emoji-btn')?.addEventListener('click', openQuickReactionFromComposer);
  document.getElementById('chat-task-btn')?.addEventListener('click', openTaskPicker);
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
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Scroll to load more
  document.getElementById('chat-messages')?.addEventListener('scroll', onScrollLoadMore);
}

function renderComposer() {
  return `
    <div class="chat-composer" id="chat-composer">
      <div class="chat-composer-reply" id="chat-composer-reply" style="display:none">
        <span id="chat-composer-reply-text"></span>
        <button class="chat-composer-reply-close" id="chat-composer-reply-close" aria-label="Hủy trả lời">${icon('x', 'sm')}</button>
      </div>
      <div class="chat-composer-box">
        <button class="chat-composer-btn" id="chat-attach-btn" aria-label="Đính kèm">${icon('paperclip', 'md')}</button>
        <button class="chat-composer-btn" id="chat-emoji-btn" aria-label="Biểu cảm">${icon('smile', 'md')}</button>
        <button class="chat-composer-btn" id="chat-task-btn" aria-label="Gắn task">${icon('clipboardList', 'md')}</button>
        <textarea class="chat-composer-input" id="chat-input" rows="1" placeholder="Nhập tin nhắn..."></textarea>
        <button class="chat-composer-send" id="chat-send-btn" aria-label="Gửi">${icon('send', 'md')}</button>
      </div>
    </div>`;
}

function renderEmptyChat() {
  disconnectWS();
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

    const content = deleted
      ? '<span class="chat-msg-bubble deleted">Tin nhắn đã bị xóa</span>'
      : `<span class="chat-msg-bubble">${esc(msg.content || '')}</span>${edited ? '<span class="chat-msg-edited">(đã sửa)</span>' : ''}`;

    html += `<div class="${cls}" data-msg-id="${msg.id}">
      ${showAvatar ? `<div class="chat-msg-avatar">${(msg.sender_name || '?').charAt(0).toUpperCase()}</div>` : '<div class="chat-msg-avatar"></div>'}
      <div class="chat-msg-body">
        ${!grouped ? `<div class="chat-msg-header">
          <span class="chat-msg-sender">${isMe ? 'Bạn' : esc(msg.sender_name || 'Unknown')}</span>
          <span class="chat-msg-time">${formatTime(msg.created_at)}</span>
        </div>` : ''}
        ${replyHtml}
        ${content}
        ${taskHtml}
        ${attHtml}
        ${reactHtml}
        ${!deleted ? `<div class="chat-msg-actions">
          <button class="chat-msg-action-btn" data-action="reply" data-msg-id="${msg.id}" aria-label="Trả lời">${icon('arrowRight', 'sm')}</button>
          <button class="chat-msg-action-btn" data-action="react" data-msg-id="${msg.id}" aria-label="Biểu cảm">${icon('smile', 'sm')}</button>
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
  try {
    const payload = { type: 'message:send', content };
    if (replyTo) payload.reply_to_id = replyTo.id;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      await api.post(`/api/conversations/${activeConvId}/messages`, { content, reply_to_id: replyTo?.id });
    }

    if (input) { input.value = ''; autoGrow(input); }
    replyTo = null;
    updateReplyPreview();
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false;
  input?.focus();
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

// ── Quick reaction ──────────────────────────────────────────────────
function openQuickReaction(msgId) {
  const emojis = ['👍', '❤️', '😄', '🎉', '👀', '✅', '👎', '🔥'];
  openModal('Biểu cảm', `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:16px">
    ${emojis.map(e => `<button class="chat-composer-btn" style="font-size:26px;width:48px;height:48px" data-emoji="${e}">${e}</button>`).join('')}
  </div>`);
  document.querySelectorAll('#modal [data-emoji]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.post(`/api/messages/${msgId}/reactions`, { emoji: btn.dataset.emoji });
        closeModal();
        await refreshMessages();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function openQuickReactionFromComposer() {
  if (!activeConvId) return;
  openQuickReaction(messages[messages.length - 1]?.id || 0);
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
  const members = (conv.members || []).map(m => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
      <div class="chat-conv-avatar" style="width:34px;height:34px;font-size:13px">${(m.full_name || '?').charAt(0).toUpperCase()}</div>
      <span style="font-size:13.5px;font-weight:500;color:var(--text)">${esc(m.full_name || '')}</span>
      ${m.role === 'owner' ? '<span class="badge badge-success">Owner</span>' : ''}
    </div>`).join('');

  const actions = !isDM ? `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn-secondary btn-sm" id="chat-rename-btn">${icon('pencil', 'sm')} Đổi tên</button>
      <button class="btn-secondary btn-sm" id="chat-add-member-btn">${icon('userPlus', 'sm')} Thêm</button>
    </div>` : '';

  openModal('Thông tin cuộc trò chuyện', `
    <div style="padding:4px">
      ${actions}
      <div style="font-size:12px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Thành viên (${conv.members.length})</div>
      <div>${members}</div>
    </div>`,
    '<button class="btn-secondary" id="chat-more-close">Đóng</button>');
  document.getElementById('chat-more-close')?.addEventListener('click', closeModal);

  document.getElementById('chat-rename-btn')?.addEventListener('click', () => renameConversation(conv));
  document.getElementById('chat-add-member-btn')?.addEventListener('click', () => addMemberFlow(conv));
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
          <div class="chat-conv-avatar" style="width:38px;height:38px;font-size:15px">${(u.full_name || '?').charAt(0).toUpperCase()}</div>
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
          <div class="chat-conv-avatar" style="width:38px;height:38px;font-size:15px">${(u.full_name || '?').charAt(0).toUpperCase()}</div>
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

  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, user_id: me.id }));
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message:new') {
        if (Number(data.message.conversation_id) === activeConvId) {
          messages.push(data.message);
          renderMessages();
          scrollToBottom();
          markRead(data.message.id);
          loadConversationsSilently();
        }
      } else if (data.type === 'message:edit' || data.type === 'message:delete') {
        refreshMessages();
      } else if (data.type === 'reaction:update') {
        const msg = messages.find(m => m.id === data.message_id);
        if (msg) { msg.reactions = data.reactions; renderMessages(); }
      }
    };
    ws.onclose = () => { wsReconnectTimer = setTimeout(() => { if (activeConvId) connectWS(activeConvId); }, 3000); };
    ws.onerror = () => ws?.close();
  } catch (_) { /* WebSocket not available */ }
}

function disconnectWS() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
}

async function markRead(msgId) {
  try { await api.post(`/api/messages/${msgId}/read`, {}); } catch (_) {}
}

let silentLoadTimer = null;
function loadConversationsSilently() {
  if (silentLoadTimer) clearTimeout(silentLoadTimer);
  silentLoadTimer = setTimeout(() => {
    api.get('/api/conversations').then(({ conversations: convs }) => {
      conversations = convs;
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
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hôm nay';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
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