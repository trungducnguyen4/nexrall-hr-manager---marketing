// ══════════════════════════════════════════════════════════════
//  Trợ lý ảo HR NetViet - Floating Widget, RAG & LLMOps Inspector
// ══════════════════════════════════════════════════════════════
import { api } from './api.js';
import { toast, esc } from './utils.js';
import { icon } from './icons.js';

let _isOpen = false;
let _history = [];
let _activeConversationId = 'conv_' + Date.now();
let _lastRequestId = null;
let _lastTelemetry = null;
let _lastCitations = [];
let _currentUserId = null;
let _currentUser = null;
let _abortController = null;

function getWelcomeHtml(userName) {
  return `
    <div class="ai-message assistant">
      <div class="ai-msg-avatar">${icon('bot', 'sm')}</div>
      <div class="ai-msg-body">
        <p>Xin chào <strong>${esc(userName || 'bạn')}</strong>. Tôi là <strong>Trợ lý ảo HR NetViet</strong>.</p>
        <p>Hệ thống hỗ trợ tra cứu nội quy, chấm công, phiếu lương, công việc và 12 phân hệ nghiệp vụ NetViet HR.</p>
      </div>
    </div>
  `;
}

/**
 * Clear current conversation history and restart fresh
 */
export function clearConversation() {
  if (_abortController) {
    try { _abortController.abort(); } catch (_) {}
    _abortController = null;
  }
  _history = [];
  _activeConversationId = 'conv_' + Date.now();
  _lastRequestId = null;
  _lastTelemetry = null;
  _lastCitations = [];

  const list = document.getElementById('ai-messages-list');
  if (list) {
    list.innerHTML = getWelcomeHtml(_currentUser?.full_name);
  }
  const input = document.getElementById('ai-input-text');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
}

/**
 * Completely reset Copilot state and remove from DOM (e.g. on logout or user switch)
 */
export function resetCopilot() {
  if (_abortController) {
    try { _abortController.abort(); } catch (_) {}
    _abortController = null;
  }
  _isOpen = false;
  _history = [];
  _activeConversationId = 'conv_' + Date.now();
  _lastRequestId = null;
  _lastTelemetry = null;
  _lastCitations = [];
  _currentUserId = null;
  _currentUser = null;
  document.getElementById('ai-copilot-root')?.remove();
}

/**
 * Initialize the Floating Copilot Widget
 */
export function initCopilot(me) {
  if (!me || !me.id) {
    resetCopilot();
    return;
  }

  // If user changed (logged in as different account), reset previous session
  if (_currentUserId && _currentUserId !== me.id) {
    resetCopilot();
  }
  _currentUserId = me.id;
  _currentUser = me;

  if (document.getElementById('ai-copilot-root')) return;

  const root = document.createElement('div');
  root.id = 'ai-copilot-root';
  root.innerHTML = `
    <!-- Floating Trigger Button -->
    <button id="ai-copilot-btn" class="ai-floating-trigger" title="Trợ lý ảo HR NetViet (Tra cứu nội quy, RAG & Tự động hóa)">
      <span class="ai-trigger-sparkle">${icon('sparkles', 'sm')}</span>
      <span class="ai-trigger-label">Trợ lý ảo NetViet</span>
    </button>

    <!-- Copilot Chat Window -->
    <div id="ai-copilot-window" class="ai-window-container hidden">
      <!-- Window Header -->
      <div class="ai-window-header">
        <div class="ai-header-title">
          <div class="ai-avatar-badge">${icon('bot', 'md')}</div>
          <div>
            <div class="ai-title-text">Trợ lý ảo HR NetViet</div>
            <div class="ai-subtitle-text">NetViet HR • Policy & AI Assistant</div>
          </div>
        </div>
        <div class="ai-header-actions">
          <button id="ai-btn-reset-chat" class="ai-icon-btn" title="Tạo phiên chat mới / Xóa hội thoại" aria-label="Làm mới">${icon('refreshCw', 'sm')}</button>
          <button id="ai-btn-inspector-header" class="ai-icon-btn" title="RAG & LLMOps Inspector" aria-label="Kiểm toán RAG">${icon('search', 'sm')}</button>
          <button id="ai-btn-close" class="ai-icon-btn" title="Đóng" aria-label="Đóng">${icon('x', 'sm')}</button>
        </div>
      </div>

      <!-- Quick Suggestion Chips (Styled like sidebar navigation) -->
      <div class="ai-chips-bar">
        <button class="ai-chip" data-prompt="Hướng dẫn cho tôi các phân hệ chính trong hệ thống HR này">${icon('layoutDashboard', 'xs')} <span>12 phân hệ</span></button>
        <button class="ai-chip" data-prompt="Bảng lương tháng này của tôi thế nào?">${icon('banknote', 'xs')} <span>Phiếu lương</span></button>
        <button class="ai-chip" data-prompt="Thống kê chấm công và tiền phạt của tôi tháng này?">${icon('clock3', 'xs')} <span>Chấm công</span></button>
        <button class="ai-chip" data-prompt="Quy định nghỉ phép năm và quy trình duyệt 2 bước?">${icon('calendarDays', 'xs')} <span>Nghỉ phép</span></button>
        <button class="ai-chip" data-prompt="Danh sách task công việc cần làm của tôi?">${icon('clipboardList', 'xs')} <span>Công việc</span></button>
        <button class="ai-chip" data-prompt="Có thông báo mới nào từ công ty không?">${icon('megaphone', 'xs')} <span>Thông báo</span></button>
        <button class="ai-chip" data-prompt="Kiểm toán bất thường bảng lương tháng này">${icon('shieldAlert', 'xs')} <span>Kiểm toán lương AI</span></button>
        <button class="ai-chip" data-prompt="Quy trình bàn giao dự án và tài khoản như thế nào?">${icon('link', 'xs')} <span>Bàn giao dự án</span></button>
      </div>

      <!-- Messages Area -->
      <div id="ai-messages-list" class="ai-messages-scroll">
        ${getWelcomeHtml(me?.full_name)}
      </div>

      <!-- Input Bar -->
      <div class="ai-input-wrapper">
        <textarea id="ai-input-text" class="ai-input-field" rows="1" placeholder="Nhập câu hỏi hoặc yêu cầu cần tra cứu..."></textarea>
        <button id="ai-btn-send" class="ai-send-btn" title="Gửi tin nhắn" aria-label="Gửi tin nhắn">
          ${icon('send', 'sm')}
        </button>
      </div>
    </div>

    <!-- RAG Inspector Modal -->
    <div id="ai-inspector-modal" class="ai-modal-overlay hidden">
      <div class="ai-inspector-content">
        <div class="ai-inspector-header">
          <div style="display:flex;align-items:center;gap:8px;">${icon('search', 'md')} <h3>RAG & LLMOps Telemetry Inspector</h3></div>
          <button id="ai-inspector-close" class="ai-icon-btn" aria-label="Đóng">${icon('x', 'sm')}</button>
        </div>
        <div id="ai-inspector-body" class="ai-inspector-body">
          <div class="ai-empty-state">Chưa có dữ liệu truy vấn gần đây. Hãy gửi một câu hỏi để kiểm tra RAG retrieval!</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  injectCopilotStyles();
  attachCopilotEvents();
}

/**
 * Toggle window open/close
 */
function toggleCopilot(forceState = null) {
  _isOpen = forceState !== null ? forceState : !_isOpen;
  const win = document.getElementById('ai-copilot-window');
  if (win) {
    if (_isOpen) {
      win.classList.remove('hidden');
      document.getElementById('ai-input-text')?.focus();
    } else {
      win.classList.add('hidden');
    }
  }
}

/**
 * Smooth Stream Renderer (Typewriter queue)
 * Ensures text animates character-by-character / word-by-word even if packets arrive in chunks
 */
class SmoothStreamRenderer {
  constructor(onTick, onComplete, speed = 14) {
    this.onTick = onTick;
    this.onComplete = onComplete;
    this.speed = speed;
    this.targetText = '';
    this.renderedText = '';
    this.isDone = false;
    this.timer = null;
  }

  append(chunk) {
    if (!chunk) return;
    this.targetText += chunk;
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), this.speed);
    }
  }

  tick() {
    if (this.renderedText.length < this.targetText.length) {
      const remaining = this.targetText.length - this.renderedText.length;
      const step = remaining > 150 ? 6 : remaining > 60 ? 3 : remaining > 20 ? 2 : 1;
      this.renderedText += this.targetText.slice(this.renderedText.length, this.renderedText.length + step);
      if (this.onTick) this.onTick(this.renderedText);
    } else if (this.isDone) {
      this.stop();
      if (this.onComplete) this.onComplete(this.renderedText);
    }
  }

  finish() {
    this.isDone = true;
    if (this.renderedText.length >= this.targetText.length) {
      this.stop();
      if (this.onComplete) this.onComplete(this.renderedText);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Send user message to AI Copilot with live SSE streaming
 */
async function sendMessage(text) {
  if (_abortController) {
    try { _abortController.abort(); } catch (_) {}
    _abortController = null;
    return;
  }

  const input = document.getElementById('ai-input-text');
  const message = text || input?.value.trim();
  if (!message) return;

  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  const list = document.getElementById('ai-messages-list');

  // Append user message to UI
  const userEl = document.createElement('div');
  userEl.className = 'ai-message user';
  userEl.innerHTML = `<div class="ai-msg-body"><p>${esc(message)}</p></div>`;
  list.appendChild(userEl);

  // Append streaming assistant container
  const assistantEl = document.createElement('div');
  assistantEl.className = 'ai-message assistant streaming';
  assistantEl.innerHTML = `
    <div class="ai-msg-avatar">${icon('bot', 'sm')}</div>
    <div class="ai-msg-body">
      <div class="ai-stream-status"><span class="ai-status-pulse"></span> <span class="ai-status-text">Đang kết nối trí tuệ nhân tạo...</span></div>
      <div class="ai-stream-content"></div>
    </div>
  `;
  list.appendChild(assistantEl);
  list.scrollTop = list.scrollHeight;

  const sendBtn = document.getElementById('ai-btn-send');
  if (sendBtn) {
    sendBtn.className = 'ai-stop-btn';
    sendBtn.title = 'Dừng tạo câu trả lời';
    sendBtn.innerHTML = icon('square', 'xs');
    sendBtn.disabled = false;
  }

  _abortController = new AbortController();
  let finalResult = null;
  const contentEl = assistantEl.querySelector('.ai-stream-content');
  const statusBox = assistantEl.querySelector('.ai-stream-status');

  let streamCompletionResolve;
  const streamCompletionPromise = new Promise(res => { streamCompletionResolve = res; });

  const typewriter = new SmoothStreamRenderer(
    (currentText) => {
      if (statusBox && !statusBox.classList.contains('hidden')) {
        statusBox.classList.add('hidden');
      }
      if (contentEl) {
        contentEl.innerHTML = formatAiMarkdown(currentText, [], true);
      }
      list.scrollTop = list.scrollHeight;
    },
    (finalText) => {
      streamCompletionResolve(finalText);
    },
    12
  );

  try {
    const onEvent = (event, data) => {
      if (event === 'status') {
        const statusEl = assistantEl.querySelector('.ai-status-text');
        if (statusEl && data?.message) {
          statusEl.textContent = data.message;
        }
      } else if (event === 'delta') {
        typewriter.append(data?.text || '');
      } else if (event === 'done') {
        finalResult = data;
        typewriter.finish();
      } else if (event === 'error') {
        throw new Error(data?.message || 'Lỗi xử lý luồng streaming');
      }
    };

    try {
      await api.aiChatStream(message, _history, _activeConversationId, onEvent, _abortController.signal);
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') throw streamErr;
      console.warn('aiChatStream failed, fallback to aiChat:', streamErr.message);
      const res = await api.aiChat(message, _history, _activeConversationId);
      if (res && res.ok) {
        finalResult = res;
        typewriter.append(res.content || '');
      } else {
        throw new Error(res?.error || streamErr.message);
      }
    }

    typewriter.finish();
    const contentToUse = await streamCompletionPromise;
    if (contentToUse) {
      _lastRequestId = finalResult?.requestId || `req_${Date.now()}`;
      _lastTelemetry = finalResult?.telemetry || null;
      _lastCitations = finalResult?.citations || [];

      _history.push({ role: 'user', content: message });
      _history.push({ role: 'assistant', content: contentToUse });

      // Format markdown-like content with bold, lists, and citation links
      const formattedHtml = formatAiMarkdown(contentToUse, finalResult?.citations || []);

      // Render Executed Action Result Card (Direct execution mode)
      let executedHtml = '';
      if (finalResult?.executedAction && finalResult.executedAction.executed) {
        const act = finalResult.executedAction;
        executedHtml = `
          <div class="ai-executed-card">
            <div class="ai-card-title success">${icon(act.icon || 'circleCheck', 'xs')} <span>${esc(act.title || 'Đã hoàn tất thao tác')}</span></div>
            <p class="ai-executed-msg">${esc(act.message || '')}</p>
            ${act.details && act.details.length > 0 ? `
              <div class="ai-card-fields-grid">
                ${act.details.map(d => `<div class="ai-card-field"><strong>${esc(d.label)}:</strong> <span>${esc(d.value)}</span></div>`).join('')}
              </div>
            ` : ''}
            ${act.undoAction ? `
              <div class="ai-card-actions">
                <button class="btn-undo-action" data-type="${esc(act.undoAction.actionType)}" data-payload='${JSON.stringify(act.undoAction.payload)}'>${icon('undo', 'xs')} <span>Hoàn tác (Undo)</span></button>
              </div>
            ` : ''}
          </div>
        `;
      }

      // Render Dynamic Human-in-the-loop Action Card
      let actionCardHtml = '';
      if (finalResult?.actionCard && finalResult.actionCard.isActionCard) {
        const ac = finalResult.actionCard;
        const p = ac.payload || {};
        const fields = ac.fields || [];

        let fieldsHtml = '';
        if (fields.length > 0) {
          fieldsHtml = fields.map(f => `<div class="ai-card-field"><strong>${esc(f.label)}:</strong> <span>${esc(f.value)}</span></div>`).join('');
        } else if (ac.actionType === 'create_leave_request') {
          fieldsHtml = `
            <div class="ai-card-field"><strong>Loại nghỉ:</strong> <span>${esc(p.leaveTypeLabel || p.leaveType || 'annual')}</span></div>
            <div class="ai-card-field"><strong>Thời gian:</strong> <span>${esc(p.startDate)} → ${esc(p.endDate)}</span></div>
            <div class="ai-card-field"><strong>Lý do:</strong> <span>${esc(p.reason || '')}</span></div>
          `;
        } else if (ac.actionType === 'create_task') {
          fieldsHtml = `
            <div class="ai-card-field"><strong>Tiêu đề:</strong> <span>${esc(p.title || '')}</span></div>
            ${p.dueDate ? `<div class="ai-card-field"><strong>Hạn chót:</strong> <span>${esc(p.dueDate)}</span></div>` : ''}
            <div class="ai-card-field"><strong>Ưu tiên:</strong> <span>${esc(p.priority || 'medium')}</span></div>
          `;
        }

        actionCardHtml = `
          <div class="ai-action-card" id="card-${finalResult.requestId}">
            <div class="ai-card-title">${icon(ac.icon || 'clipboardList', 'xs')} <span>${esc(ac.title || 'Xác nhận thao tác')}</span></div>
            <div class="ai-card-fields-grid">${fieldsHtml}</div>
            <div class="ai-card-actions">
              <button class="btn-confirm-action" data-type="${esc(ac.actionType)}" data-payload='${JSON.stringify(p)}'>${icon('check', 'xs')} <span>${esc(ac.confirmLabel || 'Xác nhận thực hiện')}</span></button>
              <button class="btn-cancel-action">${icon('x', 'xs')} <span>${esc(ac.cancelLabel || 'Hủy')}</span></button>
            </div>
          </div>
        `;
      } else if (finalResult?.actionCard && finalResult.actionCard.isNavigationCard) {
        const ac = finalResult.actionCard;
        actionCardHtml = `
          <div class="ai-action-card" id="card-${finalResult.requestId}">
            <div class="ai-card-title">${icon(ac.icon || 'doorOpen', 'xs')} <span>${esc(ac.title || 'Điều hướng')}</span></div>
            <div class="ai-card-actions">
              <a href="${esc(ac.link || '#/attendance')}" class="btn-confirm-action" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                ${icon(ac.buttonIcon || 'externalLink', 'xs')} <span>${esc(ac.buttonText || 'Mở màn hình')}</span>
              </a>
            </div>
          </div>
        `;
      }

      // Telemetry & Feedback bar
      const tel = finalResult?.telemetry || {};
      const telHtml = `
        <div class="ai-msg-footer">
          <div class="ai-tel-stats">
            <span class="ai-tag">${esc(tel.provider || 'edge')}</span>
            <span class="ai-stat">${tel.latencyMs || 0}ms</span>
            <span class="ai-stat">${tel.tokens?.total || 0} tokens</span>
            ${tel.cost?.costVnd ? `<span class="ai-stat">~${tel.cost.costVnd}đ</span>` : ''}
          </div>
          <div class="ai-feedback-actions">
            <button class="btn-feedback" data-req="${_lastRequestId}" data-rating="1" title="Hữu ích">${icon('thumbsUp', 'xs')}</button>
            <button class="btn-feedback" data-req="${_lastRequestId}" data-rating="-1" title="Chưa chính xác">${icon('thumbsDown', 'xs')}</button>
            <button class="btn-inspect-msg" data-req="${_lastRequestId}" title="Xem RAG Inspector">${icon('search', 'xs')}</button>
          </div>
        </div>
      `;

      assistantEl.className = 'ai-message assistant';
      assistantEl.innerHTML = `
        <div class="ai-msg-avatar">${icon('bot', 'sm')}</div>
        <div class="ai-msg-body">
          ${formattedHtml}
          ${executedHtml}
          ${actionCardHtml}
          ${telHtml}
        </div>
      `;
      bindMessageEvents(assistantEl);
    } else {
      assistantEl.className = 'ai-message assistant error';
      assistantEl.innerHTML = `
        <div class="ai-msg-avatar">${icon('circleAlert', 'sm')}</div>
        <div class="ai-msg-body"><p>Không nhận được phản hồi từ AI Gateway.</p></div>
      `;
    }
  } catch (err) {
    typewriter.stop();
    if (streamCompletionResolve) streamCompletionResolve(typewriter.renderedText);
    assistantEl.querySelector('.ai-typing-cursor')?.remove();
    const statusBox = assistantEl.querySelector('.ai-stream-status');
    if (statusBox) statusBox.remove();

    if (err.name === 'AbortError') {
      if (typewriter.renderedText) {
        const contentEl = assistantEl.querySelector('.ai-stream-content');
        if (contentEl) {
          contentEl.innerHTML = formatAiMarkdown(typewriter.renderedText, [], false) + '<span class="ai-stopped-notice"><em>(Đã dừng tạo câu trả lời)</em></span>';
        }
        _history.push({ role: 'user', content: message });
        _history.push({ role: 'assistant', content: typewriter.renderedText + ' (Đã dừng)' });
      } else {
        assistantEl.remove();
      }
    } else {
      assistantEl.className = 'ai-message assistant error';
      assistantEl.innerHTML = `
        <div class="ai-msg-avatar">${icon('circleAlert', 'sm')}</div>
        <div class="ai-msg-body"><p>Lỗi kết nối: ${esc(err?.message || 'Vui lòng thử lại sau')}</p></div>
      `;
    }
  } finally {
    _abortController = null;
    if (sendBtn) {
      sendBtn.className = 'ai-send-btn';
      sendBtn.title = 'Gửi tin nhắn';
      sendBtn.innerHTML = icon('send', 'sm');
      sendBtn.disabled = false;
    }
    list.scrollTop = list.scrollHeight;
  }
}

/**
 * Format markdown text with citation popovers
 */
function formatAiMarkdown(text, citations = [], isStreaming = false) {
  if (!text) return '';
  let content = text;
  if (isStreaming) {
    const boldCount = (content.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) {
      content += '**';
    }
  }
  let html = esc(content);

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Markdown links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="ai-md-link" target="_blank" rel="noopener">$1</a>');
  // Bullet lists
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  // Newlines to <br> or paragraphs
  html = html.split('\n\n').map(p => p.startsWith('<ul>') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  // Replace [1], [2] with interactive citation chips
  html = html.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10);
    const cite = citations.find(c => c.index === idx);
    if (cite) {
      return `<span class="ai-citation-tag" title="${esc(cite.docTitle)}: ${esc(cite.sectionTitle)} (${Math.round(cite.confidenceScore * 100)}% match)">[${idx}]</span>`;
    }
    return match;
  });

  if (isStreaming) {
    if (html.endsWith('</p>')) {
      html = html.slice(0, -4) + '<span class="ai-typing-cursor"></span></p>';
    } else {
      html += '<span class="ai-typing-cursor"></span>';
    }
  }

  return html;
}

/**
 * Bind interactive events for action cards, feedback and inspector
 */
function bindMessageEvents(el) {
  // Confirm action button
  el.querySelectorAll('.btn-confirm-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      let payload = {};
      try { payload = JSON.parse(btn.dataset.payload); } catch (_) {}
      btn.disabled = true;
      btn.textContent = 'Đang xử lý...';
      try {
        const res = await api.aiConfirmAction(type, payload);
        if (res && res.ok) {
          toast(res.message || 'Thực hiện thành công', 'success');
          const card = btn.closest('.ai-action-card');
          if (card) {
            card.innerHTML = `<div class="ai-card-success">${icon('circleCheck', 'xs')} <span>${esc(res.message || 'Đã thực thi thành công!')}</span></div>`;
          }
          window.dispatchEvent(new CustomEvent('hr:data-changed', { detail: { actionType: type } }));
        } else {
          toast(res?.error || 'Thao tác thất bại', 'error');
          btn.disabled = false;
          btn.innerHTML = `${icon('refreshCw', 'xs')} <span>Thử lại</span>`;
        }
      } catch (e) {
        toast('Lỗi: ' + e?.message, 'error');
        btn.disabled = false;
        btn.innerHTML = `${icon('refreshCw', 'xs')} <span>Thử lại</span>`;
      }
    });
  });

  // Undo action button
  el.querySelectorAll('.btn-undo-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      let payload = {};
      try { payload = JSON.parse(btn.dataset.payload); } catch (_) {}
      btn.disabled = true;
      btn.textContent = 'Đang hoàn tác...';
      try {
        const res = await api.aiUndoAction(type, payload);
        if (res && res.ok) {
          toast(res.message || 'Đã hoàn tác thành công', 'success');
          const card = btn.closest('.ai-executed-card');
          if (card) {
            card.innerHTML = `<div class="ai-card-success">${icon('undo', 'xs')} <span>${esc(res.message || 'Đã hoàn tác!')}</span></div>`;
          }
          window.dispatchEvent(new CustomEvent('hr:data-changed', { detail: { actionType: type, undo: true } }));
        } else {
          toast(res?.error || 'Hoàn tác thất bại', 'error');
          btn.disabled = false;
          btn.innerHTML = `${icon('undo', 'xs')} <span>Thử lại</span>`;
        }
      } catch (e) {
        toast('Lỗi: ' + e?.message, 'error');
        btn.disabled = false;
        btn.innerHTML = `${icon('undo', 'xs')} <span>Thử lại</span>`;
      }
    });
  });

  // Cancel action button
  el.querySelectorAll('.btn-cancel-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.ai-action-card');
      if (card) card.remove();
      toast('Đã hủy thao tác', 'info');
    });
  });

  // Feedback buttons
  el.querySelectorAll('.btn-feedback').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reqId = btn.dataset.req;
      const rating = parseInt(btn.dataset.rating, 10);
      try {
        await api.aiFeedback(reqId, rating);
        toast('Cảm ơn bạn đã phản hồi chất lượng!', 'success');
        btn.parentElement.querySelectorAll('.btn-feedback').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      } catch (_) {}
    });
  });

  // Message Inspector button
  el.querySelectorAll('.btn-inspect-msg').forEach(btn => {
    btn.addEventListener('click', () => {
      openRAGInspector(btn.dataset.req);
    });
  });
}

/**
 * Open RAG Inspector modal
 */
async function openRAGInspector(requestId) {
  const modal = document.getElementById('ai-inspector-modal');
  const body = document.getElementById('ai-inspector-body');
  if (!modal || !body) return;

  modal.classList.remove('hidden');
  body.innerHTML = '<div class="ai-typing-dots"><span></span><span></span><span></span></div> Đang tải telemetry log...';

  try {
    const res = await api.aiGetLogs(requestId || _lastRequestId);
    if (res && res.ok && res.log) {
      const log = res.log;
      let retrievedChunks = [];
      try { retrievedChunks = JSON.parse(log.retrieved_chunks_json || '[]'); } catch (_) {}
      let toolsCalled = [];
      try { toolsCalled = JSON.parse(log.tools_called_json || '[]'); } catch (_) {}

      body.innerHTML = `
        <div class="ai-inspector-grid">
          <div class="ai-inspector-card">
            <h4>${icon('barChart3', 'xs')} <span>LLMOps Performance Metrics</span></h4>
            <div class="ai-metric-row"><span>Request ID:</span> <code>${esc(log.id)}</code></div>
            <div class="ai-metric-row"><span>Provider / Model:</span> <strong>${esc(log.provider)}</strong> / <code>${esc(log.model_name)}</code></div>
            <div class="ai-metric-row"><span>Total Latency:</span> <strong>${log.total_latency_ms} ms</strong> (TTFT: ${log.ttft_ms} ms)</div>
            <div class="ai-metric-row"><span>Prompt / Completion Tokens:</span> ${log.prompt_tokens} in / ${log.completion_tokens} out (Total: ${log.prompt_tokens + log.completion_tokens})</div>
            <div class="ai-metric-row"><span>Estimated Cost:</span> $${log.estimated_cost_usd} (~${Math.round(log.estimated_cost_usd * 25400)} VNĐ)</div>
          </div>

          <div class="ai-inspector-card">
            <h4>${icon('bookOpen', 'xs')} <span>Hybrid RAG Retrieved Chunks (${retrievedChunks.length})</span></h4>
            ${retrievedChunks.length === 0 ? '<div class="text-muted">Không có chunk RAG nào được nạp vào context cho câu hỏi này.</div>' : ''}
            ${retrievedChunks.map((c, i) => `
              <div class="ai-chunk-item">
                <div class="ai-chunk-header">
                  <strong>[${i+1}] ${esc(c.docTitle)} - ${esc(c.section)}</strong>
                  <span class="ai-similarity-badge">Sim: ${Math.round(c.vectorScore * 100)}% | RRF: ${c.combinedScore}</span>
                </div>
              </div>
            `).join('')}
          </div>

          ${toolsCalled.length > 0 ? `
            <div class="ai-inspector-card">
              <h4>${icon('settings', 'xs')} <span>Tool Calls Executed</span></h4>
              <pre class="ai-code-block">${esc(JSON.stringify(toolsCalled, null, 2))}</pre>
            </div>
          ` : ''}
        </div>
      `;
    } else {
      body.innerHTML = '<div class="ai-empty-state">Không tìm thấy telemetry log cho yêu cầu này.</div>';
    }
  } catch (e) {
    body.innerHTML = `<div class="ai-empty-state">Lỗi tải dữ liệu: ${esc(e.message)}</div>`;
  }
}

/**
 * Attach global event listeners
 */
function attachCopilotEvents() {
  document.getElementById('ai-copilot-btn')?.addEventListener('click', () => toggleCopilot());
  document.getElementById('ai-btn-close')?.addEventListener('click', () => toggleCopilot(false));
  document.getElementById('ai-btn-reset-chat')?.addEventListener('click', () => {
    clearConversation();
    toast('Đã tạo phiên chat mới', 'info');
  });
  document.getElementById('ai-btn-inspector-header')?.addEventListener('click', () => openRAGInspector(_lastRequestId));
  document.getElementById('ai-inspector-close')?.addEventListener('click', () => {
    document.getElementById('ai-inspector-modal')?.classList.add('hidden');
  });

  // Chips
  document.querySelectorAll('.ai-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (_abortController) return;
      const prompt = chip.dataset.prompt;
      if (prompt) sendMessage(prompt);
    });
  });

  // Send / Stop button
  document.getElementById('ai-btn-send')?.addEventListener('click', () => {
    if (_abortController) {
      _abortController.abort();
      _abortController = null;
      return;
    }
    sendMessage();
  });

  // Input Enter key
  const input = document.getElementById('ai-input-text');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (_abortController) return;
        sendMessage();
      }
    });

    // Auto-grow textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(100, input.scrollHeight) + 'px';
    });
  }

  // Global shortcut (Ctrl + / or Cmd + /)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      toggleCopilot();
    }
  });
}

/**
 * Inject Copilot CSS styles dynamically
 */
function injectCopilotStyles() {
  if (document.getElementById('ai-copilot-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-copilot-styles';
  style.textContent = `
    .ai-floating-trigger {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9990;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 9999px;
      background: var(--primary-gradient, linear-gradient(135deg, #EE4D2D 0%, #FF643D 100%));
      color: #fff;
      border: none;
      box-shadow: 0 10px 25px -5px rgba(238, 77, 45, 0.45), 0 8px 10px -6px rgba(11, 31, 58, 0.12);
      cursor: pointer;
      font-weight: 700;
      font-size: 13.5px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .ai-floating-trigger:hover {
      transform: translateY(-2px) scale(1.03);
      background: linear-gradient(135deg, #D73211 0%, #EE4D2D 100%);
      box-shadow: 0 14px 28px -4px rgba(238, 77, 45, 0.55);
    }
    .ai-trigger-sparkle {
      font-size: 16px;
      animation: ai-pulse 2s infinite;
    }
    @keyframes ai-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.85; }
    }
    .ai-window-container {
      position: fixed;
      bottom: 84px;
      right: 24px;
      width: 410px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 110px);
      background: var(--surface, #ffffff);
      border-radius: 18px;
      box-shadow: 0 20px 45px -12px rgba(11, 31, 58, 0.25), 0 0 0 1px var(--border, #E2E8F0);
      display: flex;
      flex-direction: column;
      z-index: 9991;
      overflow: hidden;
      animation: ai-slide-up 0.25s ease-out;
    }
    @keyframes ai-slide-up {
      from { opacity: 0; transform: translateY(16px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .ai-window-container.hidden { display: none; }
    .ai-window-header {
      padding: 14px 16px;
      background: linear-gradient(135deg, #0B1F3A 0%, #14294A 100%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ai-header-title { display: flex; align-items: center; gap: 10px; }
    .ai-avatar-badge {
      width: 32px; height: 32px;
      border-radius: 10px;
      background: var(--primary-gradient, linear-gradient(135deg, #EE4D2D 0%, #FF643D 100%));
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      box-shadow: 0 2px 6px rgba(238, 77, 45, 0.35);
    }
    .ai-title-text { font-weight: 700; font-size: 15px; color: #FFFFFF; }
    .ai-subtitle-text { font-size: 11px; color: #CBD5E1; }
    .ai-header-actions { display: flex; gap: 6px; }
    .ai-icon-btn {
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #fff;
      border-radius: 8px;
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: background 0.15s;
    }
    .ai-icon-btn:hover { background: rgba(255, 255, 255, 0.22); color: #fff; }
    .ai-chips-bar {
      padding: 8px 12px;
      background: var(--surface-2, #f8fafc);
      border-bottom: 1px solid var(--border, #e2e8f0);
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
    }
    .ai-chip {
      background: var(--surface, #fff);
      border: 1px solid var(--border-2, #cbd5e1);
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-2, #334155);
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
    }
    .ai-chip:hover {
      background: var(--primary-light, #FDEEE8);
      border-color: #FF8A5C;
      color: var(--primary-text, #C8371A);
      box-shadow: 0 1px 3px rgba(238, 77, 45, 0.12);
    }
    .ai-messages-scroll {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: var(--bg, #f8fafc);
    }
    .ai-message {
      display: flex;
      gap: 10px;
      max-width: 90%;
    }
    .ai-message.user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .ai-message.assistant { align-self: flex-start; }
    .ai-msg-avatar {
      width: 28px; height: 28px;
      border-radius: 8px;
      background: var(--primary-light, #FDEEE8);
      color: var(--primary, #EE4D2D);
      border: 1px solid #F8D9CE;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .ai-msg-body {
      background: var(--surface, #ffffff);
      padding: 11px 15px;
      border-radius: 14px;
      box-shadow: var(--shadow-sm, 0 1px 2px rgba(11, 31, 58, 0.04));
      border: 1px solid var(--border, #e2e8f0);
      font-family: var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
      font-size: 13.5px;
      line-height: 1.5;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: var(--text, #0f172a);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    .ai-message.user .ai-msg-body {
      background: var(--primary-gradient, linear-gradient(135deg, #EE4D2D 0%, #FF643D 100%));
      color: #ffffff;
      border: none;
      border-bottom-right-radius: 4px;
      font-weight: 400;
      box-shadow: 0 2px 8px rgba(238, 77, 45, 0.25);
    }
    .ai-message.user .ai-msg-body p {
      font-weight: 400;
      margin: 0;
      color: #ffffff;
      line-height: 1.5;
    }
    .ai-message.assistant .ai-msg-body {
      border-bottom-left-radius: 4px;
      font-weight: 400;
      color: var(--text, #0f172a);
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #e2e8f0);
    }
    .ai-message.assistant .ai-msg-body p {
      font-weight: 400;
      margin: 0 0 6px 0;
      line-height: 1.5;
    }
    .ai-message.assistant .ai-msg-body p:last-child {
      margin-bottom: 0;
    }
    .ai-message.assistant .ai-msg-body ul,
    .ai-message.assistant .ai-msg-body ol {
      margin: 6px 0;
      padding-left: 20px;
    }
    .ai-message.assistant .ai-msg-body li {
      font-weight: 400;
      margin-bottom: 3px;
      line-height: 1.5;
    }
    .ai-message.assistant .ai-msg-body strong,
    .ai-message.assistant .ai-msg-body b {
      font-weight: 600;
      color: var(--text, #0f172a);
    }
    .ai-message.assistant .ai-msg-body h3,
    .ai-message.assistant .ai-msg-body h4 {
      font-weight: 700;
      color: var(--accent, #0B1F3A);
      margin: 8px 0 4px 0;
      font-size: 14px;
    }
    .ai-citation-tag {
      display: inline-block;
      background: var(--primary-light, #FDEEE8);
      color: var(--primary-text, #C8371A);
      border: 1px solid #F8D9CE;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 2px;
      cursor: help;
    }
    .ai-action-card {
      margin-top: 10px;
      padding: 10px;
      background: var(--surface-2, #f1f5f9);
      border: 1px solid var(--border-2, #cbd5e1);
      border-radius: 10px;
      font-size: 12px;
    }
    .ai-executed-card {
      margin-top: 10px;
      padding: 10px 12px;
      background: var(--surface-2, #f1f5f9);
      border: 1px solid var(--border-2, #cbd5e1);
      border-left: 3px solid var(--success, #047857);
      border-radius: 10px;
      font-size: 12px;
    }
    .ai-executed-msg {
      margin: 4px 0 8px 0;
      color: var(--text-2, #475569);
      font-size: 12px;
    }
    .ai-card-fields-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--surface, #ffffff);
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border, #e2e8f0);
      margin: 6px 0;
    }
    .ai-card-title {
      font-weight: 700;
      color: var(--text, #0f172a);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ai-card-title.success {
      color: var(--success, #047857);
    }
    .ai-md-link {
      color: var(--primary, #EE4D2D);
      font-weight: 600;
      text-decoration: underline;
    }
    .ai-card-field { margin-bottom: 3px; color: var(--text-2, #334155); }
    .ai-card-actions { display: flex; gap: 6px; margin-top: 8px; }
    .btn-confirm-action {
      background: var(--success, #047857);
      color: #fff;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn-cancel-action {
      background: var(--border, #e2e8f0);
      color: var(--text-2, #475569);
      border: none;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn-undo-action {
      background: var(--surface, #ffffff);
      color: var(--text-2, #475569);
      border: 1px solid var(--border-2, #cbd5e1);
      padding: 5px 10px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      transition: all 0.15s ease;
    }
    .btn-undo-action:hover:not(:disabled) {
      background: var(--surface-2, #f8fafc);
      border-color: var(--primary, #EE4D2D);
      color: var(--primary, #EE4D2D);
    }
    .btn-undo-action:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .ai-card-success {
      color: var(--success, #047857);
      font-weight: 600;
      padding: 6px;
      background: #ecfdf5;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ai-msg-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--surface-2, #f1f5f9);
      font-size: 10px;
      color: var(--text-3, #94A3B8);
      font-weight: 400;
    }
    .ai-tel-stats { display: flex; gap: 6px; align-items: center; }
    .ai-tag { background: var(--surface-2, #e2e8f0); color: var(--text-2, #475569); padding: 1px 5px; border-radius: 4px; font-weight: 600; border: 1px solid var(--border, #e2e8f0); }
    .ai-feedback-actions { display: flex; gap: 4px; }
    .btn-feedback, .btn-inspect-msg {
      background: none;
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 4px;
      padding: 2px 5px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-2, #475569);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      min-height: 22px;
    }
    .btn-feedback:hover, .btn-inspect-msg:hover { background: var(--surface-2, #f1f5f9); border-color: var(--border-hover, #94a3b8); }
    .btn-feedback.active { background: var(--primary-light, #FDEEE8); border-color: var(--primary, #EE4D2D); color: var(--primary-text, #C8371A); }
    .ai-input-wrapper {
      padding: 10px 12px;
      background: var(--surface, #fff);
      border-top: 1px solid var(--border, #e2e8f0);
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }
    .ai-input-field {
      flex: 1;
      border: 1px solid var(--border-2, #cbd5e1);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      outline: none;
      max-height: 100px;
      color: var(--text, #0f172a);
      background: var(--surface, #ffffff);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .ai-input-field:focus { border-color: var(--primary, #EE4D2D); box-shadow: 0 0 0 3px rgba(238, 77, 45, 0.18); }
    .ai-send-btn {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: var(--primary-gradient, linear-gradient(135deg, #EE4D2D 0%, #FF643D 100%));
      color: #fff;
      border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
      box-shadow: 0 2px 6px rgba(238, 77, 45, 0.3);
    }
    .ai-send-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #D73211 0%, #EE4D2D 100%);
      transform: scale(1.04);
    }
    .ai-send-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
    .ai-stop-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #EF4444;
      color: #fff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
      box-shadow: 0 2px 6px rgba(239, 68, 68, 0.35);
    }
    .ai-stop-btn:hover {
      background: #DC2626;
      transform: scale(1.04);
    }
    .ai-typing-cursor {
      display: inline-block;
      width: 7px;
      height: 14px;
      background: var(--primary, #EE4D2D);
      vertical-align: middle;
      margin-left: 2px;
      animation: ai-cursor-blink 0.8s infinite;
      border-radius: 1px;
    }
    @keyframes ai-cursor-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .ai-stream-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--text-2, #64748b);
      margin-bottom: 6px;
      padding: 3px 8px;
      background: var(--surface-2, #f8fafc);
      border-radius: 6px;
      border-left: 2px solid var(--primary, #EE4D2D);
    }
    .ai-stream-status.hidden { display: none; }
    .ai-status-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--primary, #EE4D2D);
      animation: ai-pulse 1.2s infinite;
      flex-shrink: 0;
    }
    .ai-stopped-notice {
      color: var(--text-3, #94a3b8);
      font-size: 12px;
      margin-left: 4px;
    }
    .ai-typing-dots {
      display: inline-flex; gap: 4px; align-items: center; margin-right: 6px;
    }
    .ai-typing-dots span {
      width: 5px; height: 5px; background: var(--primary, #EE4D2D); border-radius: 50%; animation: ai-bounce 1.4s infinite ease-in-out;
    }
    .ai-typing-dots span:nth-child(1) { animation-delay: -0.32s; }
    .ai-typing-dots span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes ai-bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
    .ai-modal-overlay {
      position: fixed; inset: 0; background: rgba(11, 31, 58, 0.6); z-index: 9999;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      backdrop-filter: blur(2px);
    }
    .ai-inspector-content {
      background: var(--surface, #fff); width: 680px; max-width: 100%; max-height: 85vh;
      border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(11, 31, 58, 0.3);
    }
    .ai-inspector-header {
      padding: 16px 20px; background: linear-gradient(135deg, #0B1F3A 0%, #14294A 100%); color: #fff; display: flex; justify-content: space-between; align-items: center;
    }
    .ai-inspector-body { padding: 20px; overflow-y: auto; flex: 1; }
    .ai-inspector-grid { display: flex; flex-direction: column; gap: 16px; }
    .ai-inspector-card { background: var(--surface-2, #f8fafc); border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 14px; }
    .ai-inspector-card h4 {
      margin: 0 0 10px 0;
      font-size: 13px;
      color: var(--text, #0f172a);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ai-metric-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; border-bottom: 1px solid var(--divider, #f1f5f9); }
    .ai-chunk-item { background: var(--surface, #fff); border: 1px solid var(--border-2, #cbd5e1); border-radius: 8px; padding: 8px 10px; margin-top: 6px; }
    .ai-chunk-header { display: flex; justify-content: space-between; font-size: 12px; }
    .ai-similarity-badge { background: #dcfce7; color: var(--success, #047857); font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .ai-code-block { background: var(--secondary-navy, #0B1F3A); color: #e2e8f0; padding: 10px; border-radius: 8px; font-size: 11px; overflow-x: auto; }
  `;
  document.head.appendChild(style);
}
