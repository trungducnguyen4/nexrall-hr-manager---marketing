// ══════════════════════════════════════════════════════════════
//  Nexrall AI Copilot - Floating Widget, RAG & LLMOps Inspector
// ══════════════════════════════════════════════════════════════
import { api } from './api.js';
import { toast, esc } from './utils.js';

let _isOpen = false;
let _history = [];
let _activeConversationId = 'conv_' + Date.now();
let _lastRequestId = null;
let _lastTelemetry = null;
let _lastCitations = [];

/**
 * Initialize the Floating Copilot Widget
 */
export function initCopilot(me) {
  if (!me || me.role !== 'admin') {
    document.getElementById('ai-copilot-root')?.remove();
    return;
  }
  if (document.getElementById('ai-copilot-root')) return;

  const root = document.createElement('div');
  root.id = 'ai-copilot-root';
  root.innerHTML = `
    <!-- Floating Trigger Button -->
    <button id="ai-copilot-btn" class="ai-floating-trigger" title="Nexrall AI Copilot (Tra cứu nội quy, RAG & Tự động hóa)">
      <div class="ai-trigger-sparkle">✨</div>
      <span class="ai-trigger-label">AI Copilot</span>
    </button>

    <!-- Copilot Chat Window -->
    <div id="ai-copilot-window" class="ai-window-container hidden">
      <!-- Window Header -->
      <div class="ai-window-header">
        <div class="ai-header-title">
          <div class="ai-avatar-badge">✨</div>
          <div>
            <div class="ai-title-text">Nexrall AI Copilot</div>
            <div class="ai-subtitle-text">Edge RAG • Policy & HR Assistant</div>
          </div>
        </div>
        <div class="ai-header-actions">
          <button id="ai-btn-inspector-header" class="ai-icon-btn" title="RAG & LLMOps Inspector">🔍</button>
          <button id="ai-btn-close" class="ai-icon-btn" title="Đóng">✕</button>
        </div>
      </div>

      <!-- Quick Suggestion Chips -->
      <div class="ai-chips-bar">
        <button class="ai-chip" data-prompt="Quy định đi muộn sau 8h35 và mức phạt thế nào?">⏰ Đi muộn 8h35</button>
        <button class="ai-chip" data-prompt="Quy định nghỉ phép năm và quy trình duyệt 2 bước?">🏖️ Phép năm & Duyệt 2 bước</button>
        <button class="ai-chip" data-prompt="Thống kê chấm công và tiền phạt của tôi tháng này?">📊 Chấm công của tôi</button>
        <button class="ai-chip" data-prompt="Danh sách task công việc cần làm của tôi?">📋 Task của tôi</button>
      </div>

      <!-- Messages Area -->
      <div id="ai-messages-list" class="ai-messages-scroll">
        <div class="ai-message assistant">
          <div class="ai-msg-avatar">✨</div>
          <div class="ai-msg-body">
            <p>Xin chào <strong>${esc(me?.full_name || 'bạn')}</strong>! Tôi là <strong>Nexrall AI Copilot</strong>.</p>
            <p>Tôi có thể hỗ trợ bạn:</p>
            <ul>
              <li>📖 <strong>Tra cứu RAG Nội quy:</strong> Mốc giờ 8h35, chính sách phạt 20k, chế độ nghỉ phép 2 bước, bảo mật dữ liệu.</li>
              <li>📊 <strong>Chấm công & Công việc:</strong> Kiểm tra số lần đi muộn, thống kê task ưu tiên.</li>
              <li>⚡ <strong>Tác vụ nhanh:</strong> Soạn thảo đơn xin nghỉ phép, tạo task mới với thẻ xác nhận an toàn.</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Input Bar -->
      <div class="ai-input-wrapper">
        <textarea id="ai-input-text" class="ai-input-field" rows="1" placeholder="Hỏi nội quy, chấm công, hoặc tạo task..."></textarea>
        <button id="ai-btn-send" class="ai-send-btn" title="Gửi tin nhắn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>

    <!-- RAG Inspector Modal -->
    <div id="ai-inspector-modal" class="ai-modal-overlay hidden">
      <div class="ai-inspector-content">
        <div class="ai-inspector-header">
          <h3>🔍 RAG & LLMOps Telemetry Inspector</h3>
          <button id="ai-inspector-close" class="ai-icon-btn">✕</button>
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
 * Send user message to AI Copilot
 */
async function sendMessage(text) {
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

  // Append typing indicator
  const loadingEl = document.createElement('div');
  loadingEl.className = 'ai-message assistant loading-turn';
  loadingEl.innerHTML = `
    <div class="ai-msg-avatar">✨</div>
    <div class="ai-msg-body">
      <div class="ai-typing-dots"><span></span><span></span><span></span></div>
      <span class="ai-typing-text">Đang truy vấn tri thức RAG & tính toán...</span>
    </div>
  `;
  list.appendChild(loadingEl);
  list.scrollTop = list.scrollHeight;

  const sendBtn = document.getElementById('ai-btn-send');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await api.aiChat(message, _history, _activeConversationId);
    loadingEl.remove();

    if (res && res.ok) {
      _lastRequestId = res.requestId;
      _lastTelemetry = res.telemetry;
      _lastCitations = res.citations || [];

      _history.push({ role: 'user', content: message });
      _history.push({ role: 'assistant', content: res.content });

      const assistantEl = document.createElement('div');
      assistantEl.className = 'ai-message assistant';

      // Format markdown-like content with bold, lists, and citation links
      const formattedHtml = formatAiMarkdown(res.content, res.citations || []);

      let actionCardHtml = '';
      if (res.actionCard && res.actionCard.isActionCard) {
        const p = res.actionCard.payload;
        if (res.actionCard.actionType === 'create_leave_request') {
          actionCardHtml = `
            <div class="ai-action-card" id="card-${res.requestId}">
              <div class="ai-card-title">📝 ${esc(res.actionCard.title)}</div>
              <div class="ai-card-field"><strong>Loại nghỉ:</strong> ${esc(p.leaveTypeLabel || p.leaveType)}</div>
              <div class="ai-card-field"><strong>Thời gian:</strong> ${esc(p.startDate)} → ${esc(p.endDate)}</div>
              <div class="ai-card-field"><strong>Lý do:</strong> ${esc(p.reason)}</div>
              <div class="ai-card-actions">
                <button class="btn-confirm-action" data-type="create_leave_request" data-payload='${JSON.stringify(p)}'>✅ Xác nhận gửi đơn</button>
                <button class="btn-cancel-action">❌ Hủy</button>
              </div>
            </div>
          `;
        } else if (res.actionCard.actionType === 'create_task') {
          actionCardHtml = `
            <div class="ai-action-card" id="card-${res.requestId}">
              <div class="ai-card-title">📋 ${esc(res.actionCard.title)}</div>
              <div class="ai-card-field"><strong>Tiêu đề:</strong> ${esc(p.title)}</div>
              ${p.dueDate ? `<div class="ai-card-field"><strong>Hạn chót:</strong> ${esc(p.dueDate)}</div>` : ''}
              <div class="ai-card-field"><strong>Ưu tiên:</strong> ${esc(p.priority)}</div>
              <div class="ai-card-actions">
                <button class="btn-confirm-action" data-type="create_task" data-payload='${JSON.stringify(p)}'>✅ Xác nhận tạo task</button>
                <button class="btn-cancel-action">❌ Hủy</button>
              </div>
            </div>
          `;
        }
      }

      // Telemetry & Feedback bar
      const tel = res.telemetry || {};
      const telHtml = `
        <div class="ai-msg-footer">
          <div class="ai-tel-stats">
            <span class="ai-tag">${esc(tel.provider || 'edge')}</span>
            <span class="ai-stat">${tel.latencyMs || 0}ms</span>
            <span class="ai-stat">${tel.tokens?.total || 0} tokens</span>
            ${tel.cost?.costVnd ? `<span class="ai-stat">~${tel.cost.costVnd}đ</span>` : ''}
          </div>
          <div class="ai-feedback-actions">
            <button class="btn-feedback" data-req="${res.requestId}" data-rating="1" title="Hữu ích">👍</button>
            <button class="btn-feedback" data-req="${res.requestId}" data-rating="-1" title="Chưa chính xác">👎</button>
            <button class="btn-inspect-msg" data-req="${res.requestId}" title="Xem RAG Inspector">🔍</button>
          </div>
        </div>
      `;

      assistantEl.innerHTML = `
        <div class="ai-msg-avatar">✨</div>
        <div class="ai-msg-body">
          ${formattedHtml}
          ${actionCardHtml}
          ${telHtml}
        </div>
      `;

      list.appendChild(assistantEl);
      bindMessageEvents(assistantEl);
    } else {
      const errorEl = document.createElement('div');
      errorEl.className = 'ai-message assistant error';
      errorEl.innerHTML = `
        <div class="ai-msg-avatar">⚠️</div>
        <div class="ai-msg-body"><p>${esc(res?.error || 'Không thể kết nối đến AI Gateway.')}</p></div>
      `;
      list.appendChild(errorEl);
    }
  } catch (err) {
    loadingEl.remove();
    const errorEl = document.createElement('div');
    errorEl.className = 'ai-message assistant error';
    errorEl.innerHTML = `
      <div class="ai-msg-avatar">⚠️</div>
      <div class="ai-msg-body"><p>Lỗi kết nối: ${esc(err?.message || 'Vui lòng thử lại sau')}</p></div>
    `;
    list.appendChild(errorEl);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    list.scrollTop = list.scrollHeight;
  }
}

/**
 * Format markdown text with citation popovers
 */
function formatAiMarkdown(text, citations = []) {
  if (!text) return '';
  let html = esc(text);

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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
            card.innerHTML = `<div class="ai-card-success">✅ ${esc(res.message || 'Đã thực thi thành công!')}</div>`;
          }
        } else {
          toast(res?.error || 'Thao tác thất bại', 'error');
          btn.disabled = false;
          btn.textContent = '✅ Thử lại';
        }
      } catch (e) {
        toast('Lỗi: ' + e?.message, 'error');
        btn.disabled = false;
        btn.textContent = '✅ Thử lại';
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
            <h4>📊 LLMOps Performance Metrics</h4>
            <div class="ai-metric-row"><span>Request ID:</span> <code>${esc(log.id)}</code></div>
            <div class="ai-metric-row"><span>Provider / Model:</span> <strong>${esc(log.provider)}</strong> / <code>${esc(log.model_name)}</code></div>
            <div class="ai-metric-row"><span>Total Latency:</span> <strong>${log.total_latency_ms} ms</strong> (TTFT: ${log.ttft_ms} ms)</div>
            <div class="ai-metric-row"><span>Prompt / Completion Tokens:</span> ${log.prompt_tokens} in / ${log.completion_tokens} out (Total: ${log.prompt_tokens + log.completion_tokens})</div>
            <div class="ai-metric-row"><span>Estimated Cost:</span> $${log.estimated_cost_usd} (~${Math.round(log.estimated_cost_usd * 25400)} VNĐ)</div>
          </div>

          <div class="ai-inspector-card">
            <h4>📚 Hybrid RAG Retrieved Chunks (${retrievedChunks.length})</h4>
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
              <h4>🛠️ Tool Calls Executed</h4>
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
  document.getElementById('ai-btn-inspector-header')?.addEventListener('click', () => openRAGInspector(_lastRequestId));
  document.getElementById('ai-inspector-close')?.addEventListener('click', () => {
    document.getElementById('ai-inspector-modal')?.classList.add('hidden');
  });

  // Chips
  document.querySelectorAll('.ai-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt) sendMessage(prompt);
    });
  });

  // Send button
  document.getElementById('ai-btn-send')?.addEventListener('click', () => sendMessage());

  // Input Enter key
  const input = document.getElementById('ai-input-text');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
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
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%);
      color: #fff;
      border: none;
      box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.5), 0 8px 10px -6px rgba(79, 70, 229, 0.3);
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .ai-floating-trigger:hover {
      transform: translateY(-2px) scale(1.03);
      box-shadow: 0 14px 28px -4px rgba(79, 70, 229, 0.6);
    }
    .ai-trigger-sparkle {
      font-size: 16px;
      animation: ai-pulse 2s infinite;
    }
    @keyframes ai-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.8; }
    }
    .ai-window-container {
      position: fixed;
      bottom: 84px;
      right: 24px;
      width: 400px;
      max-width: calc(100vw - 32px);
      height: 560px;
      max-height: calc(100vh - 110px);
      background: #ffffff;
      border-radius: 18px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08);
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
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ai-header-title { display: flex; align-items: center; gap: 10px; }
    .ai-avatar-badge {
      width: 32px; height: 32px;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #ec4899);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    .ai-title-text { font-weight: 700; font-size: 15px; }
    .ai-subtitle-text { font-size: 11px; opacity: 0.8; }
    .ai-header-actions { display: flex; gap: 6px; }
    .ai-icon-btn {
      background: rgba(255, 255, 255, 0.15);
      border: none;
      color: #fff;
      border-radius: 8px;
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: background 0.15s;
    }
    .ai-icon-btn:hover { background: rgba(255, 255, 255, 0.3); }
    .ai-chips-bar {
      padding: 8px 12px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
    }
    .ai-chip {
      background: #fff;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s;
    }
    .ai-chip:hover {
      background: #e0e7ff;
      border-color: #818cf8;
      color: #3730a3;
    }
    .ai-messages-scroll {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #f8fafc;
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
      background: #e0e7ff;
      color: #4f46e5;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .ai-msg-body {
      background: #ffffff;
      padding: 10px 14px;
      border-radius: 14px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
      font-size: 13px;
      line-height: 1.5;
      color: #1e293b;
    }
    .ai-message.user .ai-msg-body {
      background: #4f46e5;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }
    .ai-message.assistant .ai-msg-body {
      border-bottom-left-radius: 4px;
    }
    .ai-citation-tag {
      display: inline-block;
      background: #dbeafe;
      color: #1e40af;
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
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      font-size: 12px;
    }
    .ai-card-title { font-weight: 700; color: #0f172a; margin-bottom: 6px; }
    .ai-card-field { margin-bottom: 3px; color: #334155; }
    .ai-card-actions { display: flex; gap: 6px; margin-top: 8px; }
    .btn-confirm-action {
      background: #10b981; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer;
    }
    .btn-cancel-action {
      background: #e2e8f0; color: #475569; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer;
    }
    .ai-card-success { color: #059669; font-weight: 600; padding: 6px; background: #ecfdf5; border-radius: 6px; }
    .ai-msg-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #f1f5f9;
      font-size: 10px;
      color: #64748b;
    }
    .ai-tel-stats { display: flex; gap: 6px; align-items: center; }
    .ai-tag { background: #e2e8f0; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
    .ai-feedback-actions { display: flex; gap: 4px; }
    .btn-feedback, .btn-inspect-msg {
      background: none; border: 1px solid #e2e8f0; border-radius: 4px; padding: 2px 5px; cursor: pointer; font-size: 11px;
    }
    .btn-feedback:hover, .btn-inspect-msg:hover { background: #f1f5f9; }
    .btn-feedback.active { background: #e0e7ff; border-color: #6366f1; }
    .ai-input-wrapper {
      padding: 10px 12px;
      background: #fff;
      border-top: 1px solid #e2e8f0;
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }
    .ai-input-field {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 13px;
      resize: none;
      outline: none;
      max-height: 100px;
    }
    .ai-input-field:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15); }
    .ai-send-btn {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: #4f46e5;
      color: #fff;
      border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .ai-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .ai-typing-dots {
      display: inline-flex; gap: 4px; align-items: center; margin-right: 6px;
    }
    .ai-typing-dots span {
      width: 5px; height: 5px; background: #6366f1; border-radius: 50%; animation: ai-bounce 1.4s infinite ease-in-out;
    }
    .ai-typing-dots span:nth-child(1) { animation-delay: -0.32s; }
    .ai-typing-dots span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes ai-bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
    .ai-modal-overlay {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 9999;
      display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .ai-inspector-content {
      background: #fff; width: 680px; max-width: 100%; max-height: 85vh;
      border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    .ai-inspector-header {
      padding: 16px 20px; background: #1e1b4b; color: #fff; display: flex; justify-content: space-between; align-items: center;
    }
    .ai-inspector-body { padding: 20px; overflow-y: auto; flex: 1; }
    .ai-inspector-grid { display: flex; flex-direction: column; gap: 16px; }
    .ai-inspector-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
    .ai-inspector-card h4 { margin: 0 0 10px 0; font-size: 13px; color: #0f172a; }
    .ai-metric-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
    .ai-chunk-item { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; margin-top: 6px; }
    .ai-chunk-header { display: flex; justify-content: space-between; font-size: 12px; }
    .ai-similarity-badge { background: #dcfce7; color: #15803d; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .ai-code-block { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 8px; font-size: 11px; overflow-x: auto; }
  `;
  document.head.appendChild(style);
}
