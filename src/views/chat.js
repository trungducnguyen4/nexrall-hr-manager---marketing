// ── Chat View ───────────────────────────────────────────────────────
// MyXTeam-style 3-column chat: sidebar | conversation | detail panel.
// Uses REST API for history + Durable Object WebSocket for real-time.
// =====================================================================

import { api } from '../api.js';
import { navigate } from '../app.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML } from '../utils.js';

let conversations = [];
let activeConvId = null;
let messages = [];
let ws = null;
let wsReconnectTimer = null;
let me = null;
let detailOpen = false;
let replyTo = null;
let uploading = false;

// ── Render entry ────────────────────────────────────────────────────
export async function renderChat(el, user) {
  me = user;
  el.innerHTML = `<div class="chat-layout" id="chat-layout">
    <div class="chat-sidebar" id="chat-sidebar">
      <div class="chat-sidebar-header">
        <h2>💬 Chat</h2>
        <input class="chat-sidebar-search" id="chat-search" type="text" placeholder="Tìm kiếm hội thoại..." />
      </div>
      <div class="chat-sidebar-tabs" id="chat-tabs">
        <button class="chat-sidebar-tab active" data-tab="all">Tất cả</button>
        <button class="chat-sidebar-tab" data-tab="unread">Chưa đọc</button>
        <button class="chat-sidebar-tab" data-tab="direct">Trực tiếp</button>
      </div>
      <div class="chat-sidebar-list" id="chat-sidebar-list"></div>
    </div>
    <div class="chat-conversation" id="chat-conversation">
      <div class="chat-empty" id="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <div class="chat-empty-text">Chọn một hội thoại để bắt đầu</div>
      </div>
    </div>
    <div class="chat-detail" id="chat-detail">
      <div class="chat-detail-section" id="chat-detail-content"></div>
    </div>
  </div>`;

  loadConversations();
  bindSidebarEvents(el);
  el._cleanup = () => disconnectWS();
}

// ── Load conversations ──────────────────────────────────────────────
async function loadConversations() {
  const list = document.getElementById('chat-sidebar-list');
  if (!list) return;
  list.innerHTML = loadingHTML();
  try {
    const { conversations: convs } = await api.get('/api/conversations');
    conversations = convs;
    renderSidebarList();
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(e.message)}</div></div>`;
  }
}

function renderSidebarList() {
  const list = document.getElementById('chat-sidebar-list');
  const tab = document.querySelector('.chat-sidebar-tab.active')?.dataset.tab || 'all';
  const search = (document.getElementById('chat-search')?.value || '').trim().toLowerCase();
  let filtered = conversations;
  if (tab === 'direct') filtered = filtered.filter(c => c.type === 'direct');
  if (tab === 'unread') filtered = filtered.filter(c => Number(c.unread_count) > 0);
  if (search) filtered = filtered.filter(c => {
    const names = (c.members || []).map(m => m.full_name || '').join(' ');
    return (c.name || '').toLowerCase().includes(search) || names.toLowerCase().includes(search);
  });

  const dms = filtered.filter(c => c.type === 'direct');
  const channels = filtered.filter(c => c.type !== 'direct');

  let html = '';
  if (dms.length) {
    html += '<div class="chat-sidebar-section">Tin nhắn trực tiếp</div>';
    for (const c of dms) {
      const other = (c.members || []).find(m => m.user_id !== me.id);
      html += renderConvItem(c, other?.full_name || c.name || 'Unknown', other?.employee_code || '');
    }
  }
  if (channels.length) {
    html += '<div class="chat-sidebar-section">Kênh</div>';
    for (const c of channels) html += renderConvItem(c, c.name || 'Nhóm', '');
  }
  if (!filtered.length) html = emptyHTML('💬', 'Không có hội thoại nào');
  list.innerHTML = html;

  list.querySelectorAll('.chat-conv-item').forEach(item => {
    item.addEventListener('click', () => openConversation(Number(item.dataset.convId)));
  });
}

function renderConvItem(c, name, code) {
  const lastMsg = c.last_message;
  const preview = lastMsg ? (lastMsg.deleted_at ? 'Tin nhắn đã xóa' : (lastMsg.content || '📎 File đính kèm').slice(0, 40)) : 'Chưa có tin nhắn';
  const time = lastMsg ? formatChatTime(lastMsg.created_at) : '';
  const unread = Number(c.unread_count) || 0;
  const active = Number(c.id) === activeConvId ? ' active' : '';
  return `<div class="chat-conv-item${active}" data-conv-id="${c.id}">
    <div class="chat-conv-avatar">${(name || '?')[0].toUpperCase()}</div>
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

function bindSidebarEvents(el) {
  document.getElementById('chat-search')?.addEventListener('input', debounce(renderSidebarList, 250));
  el.querySelector('#chat-tabs')?.addEventListener('click', e => {
    if (!e.target.classList.contains('chat-sidebar-tab')) return;
    el.querySelectorAll('.chat-sidebar-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    renderSidebarList();
  });
}

// ── Open conversation ───────────────────────────────────────────────
async function openConversation(convId) {
  activeConvId = convId;
  replyTo = null;
  messages = [];
  disconnectWS();

  const convEl = document.getElementById('chat-conversation');
  convEl.innerHTML = loadingHTML();

  // Highlight active
  document.querySelectorAll('.chat-conv-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.chat-conv-item[data-conv-id="${convId}"]`)?.classList.add('active');

  try {
    const conv = await api.get(`/api/conversations/${convId}`);
    const { messages: msgs, has_more } = await api.get(`/api/conversations/${convId}/messages?limit=30`);
    messages = msgs;

    renderConversation(conv);
    renderMessages();
    scrollToBottom();
    connectWS(convId);
    loadDetail(conv);
  } catch (e) {
    convEl.innerHTML = `<div class="chat-empty"><div class="chat-empty-icon">⚠️</div><div class="chat-empty-text">${esc(e.message)}</div></div>`;
  }
}

function renderConversation(conv) {
  const otherMembers = (conv.members || []).filter(m => m.user_id !== me.id);
  const name = conv.type === 'direct' ? (otherMembers[0]?.full_name || 'Unknown') : (conv.name || 'Nhóm');
  const sub = conv.type === 'direct' ? '' : `${conv.members.length} thành viên`;

  const convEl = document.getElementById('chat-conversation');
  const emptyEl = document.getElementById('chat-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  convEl.innerHTML = `
    <div class="chat-conv-header">
      <div class="chat-conv-header-left">
        <button class="chat-conv-header-btn" id="chat-back-btn" style="display:none">←</button>
        <div class="chat-conv-avatar" style="width:40px;height:40px">${(name || '?')[0].toUpperCase()}</div>
        <div>
          <div class="chat-conv-header-name">${esc(name)}</div>
          ${sub ? `<div class="chat-conv-header-sub">${esc(sub)}</div>` : ''}
        </div>
      </div>
      <div class="chat-conv-header-actions">
        <button class="chat-conv-header-btn" id="chat-search-btn">🔍</button>
        <button class="chat-conv-header-btn" id="chat-detail-toggle">👥</button>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-composer" id="chat-composer">
      <div class="chat-composer-reply" id="chat-composer-reply" style="display:none"></div>
      <div class="chat-composer-row">
        <button class="chat-composer-btn" id="chat-attach-btn" title="Đính kèm">📎</button>
        <textarea class="chat-composer-input" id="chat-input" rows="1" placeholder="Nhập tin nhắn..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();document.getElementById('chat-send-btn').click();}"></textarea>
        <button class="chat-composer-btn" id="chat-task-btn" title="Gắn task">☑</button>
        <button class="chat-composer-send" id="chat-send-btn" title="Gửi">➤</button>
      </div>
    </div>
  `;

  document.getElementById('chat-back-btn')?.addEventListener('click', () => { activeConvId = null; renderEmptyChat(); });
  document.getElementById('chat-detail-toggle')?.addEventListener('click', toggleDetail);
  document.getElementById('chat-search-btn')?.addEventListener('click', () => openSearchModal());
  document.getElementById('chat-send-btn')?.addEventListener('click', sendMessage);
  document.getElementById('chat-attach-btn')?.addEventListener('click', () => document.getElementById('chat-file-input')?.click());
  document.getElementById('chat-task-btn')?.addEventListener('click', openTaskPicker);

  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'chat-file-input';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', handleFileUpload);
  document.getElementById('chat-composer')?.appendChild(fileInput);

  // Scroll to load more
  document.getElementById('chat-messages')?.addEventListener('scroll', onScrollLoadMore);
}

function renderEmptyChat() {
  disconnectWS();
  document.querySelectorAll('.chat-conv-item').forEach(i => i.classList.remove('active'));
  const convEl = document.getElementById('chat-conversation');
  convEl.innerHTML = `<div class="chat-empty" id="chat-empty"><div class="chat-empty-icon">💬</div><div class="chat-empty-text">Chọn một hội thoại để bắt đầu</div></div>`;
}

// ── Messages ────────────────────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  let html = '';
  let lastDate = '';

  for (const msg of messages) {
    const msgDate = String(msg.created_at || '').slice(0, 10);
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      html += `<div class="chat-date-separator">${formatDate(msgDate)}</div>`;
    }

    const isMe = Number(msg.sender_id) === me.id;
    const deleted = !!msg.deleted_at;
    const edited = !!msg.edited_at;

    // Reply preview
    let replyHtml = '';
    if (msg.reply_to_id && !deleted) {
      const replyMsg = messages.find(m => m.id === msg.reply_to_id);
      if (replyMsg) {
        replyHtml = `<div class="chat-reply-preview" data-scroll-to="${msg.reply_to_id}">
          <div class="chat-reply-preview-sender">↩ ${esc(replyMsg.sender_name || 'Unknown')}</div>
          <div class="chat-reply-preview-text">${esc((replyMsg.content || '📎 File').slice(0, 60))}</div>
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
        attHtml += `<img class="chat-attachment-image" src="${getFileUrl(att.storage_key)}" alt="${esc(att.file_name)}" onclick="this.requestFullscreen?.()" />`;
      } else {
        attHtml += `<div class="chat-attachment" data-key="${att.storage_key}">
          <span class="chat-attachment-icon">📄</span>
          <div><div class="chat-attachment-name">${esc(att.file_name)}</div><div class="chat-attachment-size">${formatSize(att.file_size)}</div></div>
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

    const content = deleted ? '<i>Tin nhắn đã bị xóa</i>' : esc(msg.content || '') + (edited ? '<span class="chat-msg-content edited">(đã sửa)</span>' : '');

    html += `<div class="chat-msg" data-msg-id="${msg.id}">
      <div class="chat-msg-avatar">${(msg.sender_name || '?')[0].toUpperCase()}</div>
      <div class="chat-msg-body">
        <div class="chat-msg-header">
          <span class="chat-msg-sender">${esc(msg.sender_name || 'Unknown')}</span>
          <span class="chat-msg-time">${formatTime(msg.created_at)}</span>
        </div>
        ${replyHtml}
        <div class="chat-msg-content${deleted ? ' deleted' : ''}">${content}</div>
        ${taskHtml}
        ${attHtml}
        ${reactHtml}
        ${!deleted ? `<div class="chat-msg-actions">
          <button class="chat-msg-action-btn" data-action="reply" data-msg-id="${msg.id}">↩</button>
          <button class="chat-msg-action-btn" data-action="react" data-msg-id="${msg.id}">😊</button>
          ${isMe ? `<button class="chat-msg-action-btn" data-action="edit" data-msg-id="${msg.id}">✏️</button>
          <button class="chat-msg-action-btn" data-action="delete" data-msg-id="${msg.id}">🗑</button>` : ''}
        </div>` : ''}
      </div>
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
          r.classList.remove('active');
        } else {
          await api.post(`/api/messages/${msgId}/reactions`, { emoji });
          r.classList.add('active');
        }
        // Refresh messages
        const { messages: msgs } = await api.get(`/api/conversations/${activeConvId}/messages?limit=50`);
        messages = msgs;
        renderMessages();
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
    const payload = { content };
    if (replyTo) payload.reply_to_id = replyTo.id;
    await api.post(`/api/conversations/${activeConvId}/messages`, payload);
    if (input) input.value = '';
    replyTo = null;
    updateReplyPreview();
    await refreshMessages();
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
  el.innerHTML = `<span>↩ Trả lời <strong>${esc(replyTo.sender_name || '?')}</strong>: ${esc((replyTo.content || '').slice(0, 40))}</span>
    <button class="chat-composer-reply-close" onclick="document.getElementById('chat-composer-reply').style.display='none';replyTo=null;">✕</button>`;
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
  openModal('Chọn biểu cảm', `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:16px">
    ${emojis.map(e => `<button class="chat-composer-btn" style="font-size:28px;width:48px;height:48px" onclick="
      (async()=>{
        try{await api.post('/api/messages/${msgId}/reactions',{emoji:'${e}'});closeModal();refreshMessages();}
        catch(err){toast(err.message,'error');}
      })()
    ">${e}</button>`).join('')}
  </div>`);
}

// ── File upload ─────────────────────────────────────────────────────
async function handleFileUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length || !activeConvId) return;
  uploading = true;
  try {
    for (const file of files) {
      const att = await api.uploadFile(`/api/conversations/${activeConvId}/upload`, file);
      await api.post(`/api/conversations/${activeConvId}/messages`, { attachments: [att] });
    }
    await refreshMessages();
  } catch (err) { toast(err.message, 'error'); }
  uploading = false;
  e.target.value = '';
}

// ── Task picker ─────────────────────────────────────────────────────
async function openTaskPicker() {
  openModal('Gắn Task', `${loadingHTML()}`);
  try {
    const { tasks = [] } = await api.get('/api/tasks?limit=20');
    const html = tasks.length ? `<div style="max-height:400px;overflow-y:auto">${tasks.map(t => `
      <div class="chat-conv-item" onclick="(async()=>{
        await api.post('/api/conversations/${activeConvId}/messages',{task_id:${t.id},content:'Đã gắn task #${t.id}'});
        closeModal();
        refreshMessages();
      })()" style="cursor:pointer">
        <div class="chat-conv-avatar">📋</div>
        <div class="chat-conv-info">
          <div class="chat-conv-name">${esc(t.title || 'Untitled')}</div>
          <div class="chat-conv-preview">${esc(t.status || '')} · ${esc(t.priority || '')}</div>
        </div>
      </div>`).join('')}</div>` : '<div class="empty-state">Không có task nào</div>';
    document.getElementById('modal-body').innerHTML = html;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

// ── Search ──────────────────────────────────────────────────────────
function openSearchModal() {
  openModal('Tìm kiếm tin nhắn', `<div style="padding:8px">
    <input id="chat-search-input" class="chat-sidebar-search" type="text" placeholder="Từ khóa..." style="margin-bottom:12px" />
    <div id="chat-search-results"></div>
  </div>`);
  document.getElementById('chat-search-input')?.addEventListener('input', debounce(async () => {
    const q = document.getElementById('chat-search-input')?.value || '';
    const resultsEl = document.getElementById('chat-search-results');
    if (!resultsEl || q.length < 2) { if (resultsEl) resultsEl.innerHTML = ''; return; }
    try {
      const { results } = await api.get(`/api/search/messages?q=${encodeURIComponent(q)}&conversation_id=${activeConvId}&limit=20`);
      resultsEl.innerHTML = results.length ? results.map(r => `
        <div class="chat-conv-item" style="cursor:pointer" onclick="closeModal();document.querySelector('[data-msg-id=&quot;${r.id}&quot;]')?.scrollIntoView({behavior:'smooth',block:'center'})">
          <div class="chat-conv-avatar">${(r.sender_name||'?')[0].toUpperCase()}</div>
          <div class="chat-conv-info">
            <div class="chat-conv-name">${esc(r.sender_name)}</div>
            <div class="chat-conv-preview">${esc((r.content||'').slice(0,60))}</div>
          </div>
        </div>`).join('') : '<div class="empty-state">Không tìm thấy</div>';
    } catch (e) { resultsEl.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
  }, 300));
}

// ── Detail panel ────────────────────────────────────────────────────
function toggleDetail() {
  detailOpen = !detailOpen;
  const detail = document.getElementById('chat-detail');
  const layout = document.getElementById('chat-layout');
  if (detailOpen) { detail.classList.add('open'); layout?.classList.add('no-detail'); }
  else { detail.classList.remove('open'); layout?.classList.remove('no-detail'); }
}

async function loadDetail(conv) {
  const content = document.getElementById('chat-detail-content');
  if (!content) return;
  content.innerHTML = `
    <div class="chat-detail-section">
      <div class="chat-detail-title">Thành viên (${conv.members.length})</div>
      ${conv.members.map(m => `<div class="chat-detail-member">
        <div class="chat-conv-avatar" style="width:30px;height:30px;font-size:12px">${(m.full_name||'?')[0].toUpperCase()}</div>
        <span>${esc(m.full_name)} ${m.role === 'owner' ? '<span class="badge badge-success">Owner</span>' : ''}</span>
      </div>`).join('')}
    </div>
    <div class="chat-detail-section">
      <div class="chat-detail-title">Tệp đính kèm</div>
      <div style="font-size:12px;color:var(--text-2)">Tính năng sắp có</div>
    </div>
  `;
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
        messages.push(data.message);
        renderMessages();
        scrollToBottom();
        markRead(data.message.id);
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

// ── Scroll ──────────────────────────────────────────────────────────
function scrollToBottom() {
  setTimeout(() => {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }, 50);
}

let loadingMore = false;
async function onScrollLoadMore() {
  const container = document.getElementById('chat-messages');
  if (!container || loadingMore) return;
  if (container.scrollTop > 50) return; // Only load more when near top
  loadingMore = true;
  const oldest = messages[0];
  if (!oldest) { loadingMore = false; return; }
  try {
    const { messages: older, has_more } = await api.get(`/api/conversations/${activeConvId}/messages?before=${oldest.id}&limit=30`);
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