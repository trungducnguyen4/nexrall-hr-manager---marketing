// ════════════════════════════════════════════════
//  Utility helpers
// ════════════════════════════════════════════════

// Standard company department list (8 fixed values). Used by any
// department dropdown/filter (users, departments, recruitment).
export const DEPARTMENTS = [
  'Ban Giám Đốc',
  'Phòng HCNS',
  'Phòng Kinh Doanh',
  'Phòng Marketing',
  'Phòng Biên Tập',
  'Phòng Sản Xuất Phim',
  'Phòng Gameshow',
  'Phòng Kế Toán',
];

// Department code used in the auto-generated employee code: [LOẠI]-[PHÒNG]-[STT].
// Must match DEPT_CODE in server.js exactly.
export const DEPT_CODE = {
  'Ban Giám Đốc': 'BGD',
  'Phòng HCNS': 'HCNS',
  'Phòng Kinh Doanh': 'KD',
  'Phòng Marketing': 'MKT',
  'Phòng Biên Tập': 'BT',
  'Phòng Sản Xuất Phim': 'SXF',
  'Phòng Gameshow': 'GSH',
  'Phòng Kế Toán': 'KT',
};

export function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fmtMoney(n) {
  if (!n && n !== 0) return '—';
  return Number(n).toLocaleString('vi-VN') + ' ₫';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('vi-VN');
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString('vi-VN');
}

export function avatarColor(name) {
  const colors = ['#4F46E5','#7C3AED','#10B981','#F59E0B','#EF4444','#3B82F6','#EC4899','#06B6D4'];
  let h = 0;
  for (const c of (name||'?')) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
}

export function initials(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).slice(-2).join('').toUpperCase();
}

export function setAvatar(el, name, color, ini) {
  if (!el) return;
  el.style.background = color || avatarColor(name || '');
  el.textContent = ini || initials(name || '');
}

export function statusBadge(status) {
  const map = {
    present: ['badge-success', '✅ Đúng giờ'],
    late: ['badge-warning', '⏰ Đi muộn'],
    absent: ['badge-danger', '❌ Vắng'],
    leave: ['badge-info', '🏖 Nghỉ phép'],
    'half-day': ['badge-gray', '🌓 Nửa ngày'],
  };
  const [cls, label] = map[status] || ['badge-gray', status || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function taskStatusBadge(s) {
  const map = {
    todo: ['badge-gray', '📌 Chờ làm'],
    'in-progress': ['badge-info', '🔄 Đang làm'],
    done: ['badge-success', '✅ Hoàn thành'],
    cancelled: ['badge-danger', '❌ Hủy'],
    review: ['badge-warning', '🔍 Review'],
  };
  const [cls, label] = map[s] || ['badge-gray', s || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function taskStatusLabel(s) {
  const map = { todo: 'Chờ làm', 'in-progress': 'Đang làm', done: 'Hoàn thành', cancelled: 'Hủy', review: 'Review' };
  return map[s] || s || '—';
}

export function priorityBadge(p) {
  const map = {
    low: ['badge-gray', '⬇ Thấp'],
    normal: ['badge-info', '➡ Bình thường'],
    high: ['badge-warning', '⬆ Cao'],
    urgent: ['badge-danger', '🔥 Khẩn cấp'],
  };
  const [cls, label] = map[p] || ['badge-gray', p || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function invStatusBadge(s) {
  const map = {
    draft: ['badge-gray', 'Nháp'],
    pending: ['badge-warning', '⏳ Chờ duyệt'],
    approved: ['badge-success', '✅ Đã duyệt'],
    paid: ['badge-info', '💳 Đã trả'],
  };
  const [cls, label] = map[s] || ['badge-gray', s || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function roleBadge(r) {
  const map = {
    admin: ['badge-danger', '👑 Admin'],
    manager: ['badge-warning', '⭐ Nhân sự'],
    employee: ['badge-gray', '👤 Nhân viên'],
  };
  const [cls, label] = map[r] || ['badge-gray', r || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ── Vòng đời nhân sự (lifecycle status) ─────────────────────────
export const LIFECYCLE_STATUSES = ['Chờ tiếp nhận', 'Thực tập', 'Thử việc', 'Chính thức', 'Đã nghỉ'];

export function lifecycleBadge(status) {
  const map = {
    'Chờ tiếp nhận': ['badge-gray', '🕓 Chờ tiếp nhận'],
    'Thực tập':      ['badge-info', '🎓 Thực tập'],
    'Thử việc':      ['badge-warning', '🧪 Thử việc'],
    'Chính thức':    ['badge-success', '✅ Chính thức'],
    'Đã nghỉ':       ['badge-danger', '🚪 Đã nghỉ'],
  };
  const [cls, label] = map[status] || ['badge-gray', status || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ── Bàn giao tài sản (asset handover) ───────────────────────────
export function assetStatusLabel(s) {
  const map = {
    active: 'Đang quản lý',
    pending_review: 'Chờ kiểm tra',
    needs_update: 'Cần bổ sung',
    confirmed: 'Đã xác nhận',
    handed_over: 'Đã bàn giao',
  };
  return map[s] || s || '—';
}
export function assetStatusBadge(s) {
  const map = {
    active: 'badge-info',
    pending_review: 'badge-warning',
    needs_update: 'badge-danger',
    confirmed: 'badge-success',
    handed_over: 'badge-gray',
  };
  return `<span class="badge ${map[s] || 'badge-gray'}">${esc(assetStatusLabel(s))}</span>`;
}

// ── Quy định & Tiêu chí đánh giá hiệu suất (config dùng chung) ──
// Single source of truth cho trang Đánh giá hiệu suất — không hard-code lại nơi khác.
export const EVAL_GROUPS = [
  {
    key: 'chuyen_mon', label: 'Nhóm 1 – Hiệu suất chuyên môn', maxScore: 60, color: '#EE4D2D', icon: '🎯',
    criteria: [
      { code: 'HS01', name: 'Hoàn thành KPI/Mục tiêu tháng', desc: 'Mức độ hoàn thành các mục tiêu/KPI được giao trong tháng.', max: 12, scale: '12: vượt KPI · 8-11: đạt KPI · 4-7: đạt một phần · 0-3: không đạt', note: 'Đối chiếu số liệu KPI thực tế của tháng đánh giá.' },
      { code: 'HS02', name: 'Chất lượng sản phẩm/đầu ra', desc: 'Độ chính xác, hoàn thiện của sản phẩm/công việc bàn giao.', max: 10, scale: '9-10: xuất sắc · 6-8: tốt · 3-5: cần sửa nhiều · 0-2: không đạt', note: '' },
      { code: 'HS03', name: 'Tiến độ, đúng deadline', desc: 'Mức độ hoàn thành công việc đúng hoặc trước hạn.', max: 10, scale: '9-10: luôn đúng hạn · 6-8: trễ ít · 3-5: trễ nhiều lần · 0-2: thường xuyên trễ', note: '' },
      { code: 'HS04', name: 'Năng lực giải quyết vấn đề', desc: 'Khả năng xử lý tình huống phát sinh, ra quyết định phù hợp.', max: 10, scale: '9-10: chủ động xử lý tốt · 6-8: xử lý được · 3-5: cần hỗ trợ nhiều · 0-2: không xử lý được', note: '' },
      { code: 'HS05', name: 'Chuyên môn và kỹ thuật', desc: 'Mức độ vững chuyên môn, kỹ năng nghiệp vụ theo vị trí.', max: 10, scale: '9-10: vững chuyên môn · 6-8: đáp ứng · 3-5: còn hạn chế · 0-2: yếu', note: '' },
      { code: 'HS06', name: 'Hiệu quả làm việc độc lập', desc: 'Khả năng tự tổ chức và hoàn thành công việc không cần giám sát sát sao.', max: 5, scale: '5: rất tốt · 3-4: tốt · 1-2: cần nhắc nhở · 0: kém', note: '' },
      { code: 'HS07', name: 'Quản lý thời gian và ưu tiên', desc: 'Sắp xếp thứ tự ưu tiên công việc hợp lý, đúng hạn.', max: 3, scale: '3: rất tốt · 2: tốt · 1: trung bình · 0: kém', note: '' },
    ],
  },
  {
    key: 'van_hoa', label: 'Nhóm 2 – Văn hóa, thái độ, kỷ luật', maxScore: 25, color: '#1D4ED8', icon: '🤝',
    criteria: [
      { code: 'VH01', name: 'Thái độ và tinh thần làm việc', desc: 'Tinh thần tích cực, trách nhiệm với công việc chung.', max: 6, scale: '6: rất tốt · 4-5: tốt · 2-3: trung bình · 0-1: kém', note: '' },
      { code: 'VH02', name: 'Làm việc nhóm và hỗ trợ đồng nghiệp', desc: 'Phối hợp, hỗ trợ đồng nghiệp trong công việc chung.', max: 6, scale: '6: rất tốt · 4-5: tốt · 2-3: trung bình · 0-1: kém', note: '' },
      { code: 'VH03', name: 'Tuân thủ quy trình và kỷ luật', desc: 'Chấp hành nội quy, quy trình, giờ giấc làm việc.', max: 5, scale: '5: tuân thủ tốt · 3-4: vi phạm nhỏ · 1-2: vi phạm nhiều lần · 0: vi phạm nghiêm trọng', note: 'Đối chiếu dữ liệu chấm công/kỷ luật nếu có.' },
      { code: 'VH04', name: 'Giao tiếp và báo cáo kịp thời', desc: 'Báo cáo tiến độ, vấn đề phát sinh kịp thời, rõ ràng.', max: 4, scale: '4: rất tốt · 3: tốt · 1-2: chưa đầy đủ · 0: không báo cáo', note: '' },
      { code: 'VH05', name: 'Cam kết và giữ lời hứa', desc: 'Thực hiện đúng những gì đã cam kết với quản lý/đồng nghiệp.', max: 4, scale: '4: rất tốt · 3: tốt · 1-2: đôi khi thất hứa · 0: thường xuyên thất hứa', note: '' },
    ],
  },
  {
    key: 'sang_tao', label: 'Nhóm 3 – Sáng tạo, cải tiến, chủ động', maxScore: 15, color: '#047857', icon: '💡',
    criteria: [
      { code: 'SK01', name: 'Sáng kiến và đề xuất cải tiến', desc: 'Đưa ra ý tưởng/đề xuất cải tiến quy trình, công việc.', max: 6, scale: '6: nhiều sáng kiến giá trị · 3-5: có đề xuất · 1-2: hiếm khi · 0: không có', note: '' },
      { code: 'SK02', name: 'Tự học và nâng cao năng lực', desc: 'Chủ động học hỏi, nâng cao kỹ năng chuyên môn.', max: 4, scale: '4: rất chủ động · 2-3: có cố gắng · 1: ít · 0: không', note: '' },
      { code: 'SK03', name: 'Áp dụng công nghệ và công cụ mới', desc: 'Ứng dụng công cụ/công nghệ mới để tăng hiệu quả công việc.', max: 3, scale: '3: áp dụng tốt · 2: có áp dụng · 1: hạn chế · 0: không', note: '' },
      { code: 'SK04', name: 'Chủ động và vượt kỳ vọng', desc: 'Chủ động nhận thêm việc, tạo giá trị vượt mong đợi.', max: 2, scale: '2: vượt kỳ vọng · 1: đạt kỳ vọng · 0: chưa đạt', note: '' },
    ],
  },
];

export const EVAL_RATING_SCALE = [
  { label: 'Xuất sắc', range: '≥ 90', min: 90, max: 100, badge: 'badge-success', action: 'Ghi nhận, xem xét khen thưởng theo chính sách hiện có.' },
  { label: 'Tốt', range: '80 – 89', min: 80, max: 89, badge: 'badge-info', action: 'Ghi nhận, duy trì và phát huy.' },
  { label: 'Đạt', range: '65 – 79', min: 65, max: 79, badge: 'badge-gray', action: 'Đáp ứng yêu cầu công việc, tiếp tục theo dõi.' },
  { label: 'Dưới chuẩn', range: '50 – 64', min: 50, max: 64, badge: 'badge-warning', action: 'Cần giải trình; HCNS kiểm tra trước khi trình phê duyệt.' },
  { label: 'Yếu', range: '< 50', min: 0, max: 49, badge: 'badge-danger', action: 'Cần giải trình; HCNS kiểm tra và người có thẩm quyền phê duyệt hướng xử lý.' },
];

/** No-op — shared default for optional callback params (e.g. onRefresh) so every
 *  view can fall back to a single reference instead of a fresh `() => {}` per file. */
export function noop() {}

/** Guards an optional callback param (e.g. onRefresh) against an explicit
 *  null/non-function being passed — a default parameter alone only covers
 *  the `undefined` case. Replaces the repeated
 *  `if (typeof X !== 'function') X = noop;` line duplicated across every view. */
export function safeCb(fn) { return typeof fn === 'function' ? fn : noop; }

export const PAGE_SIZE = 10;

export function filterBySearch(rows, search, fields = []) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return rows || [];
  return (rows || []).filter(row => fields.some(field => String(row?.[field] ?? '').toLowerCase().includes(q)));
}

export function filterByDepartment(rows, department, fields = ['department']) {
  if (!department) return rows || [];
  return (rows || []).filter(row => fields.some(field => String(row?.[field] ?? '') === String(department)));
}

export function paginateRows(rows, page = 1, pageSize = PAGE_SIZE) {
  const total = (rows || []).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: (rows || []).slice(start, start + pageSize), page: safePage, total, totalPages, pageSize };
}

export function paginationHTML({ page = 1, total = 0, pageSize = PAGE_SIZE } = {}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return '';
  return `
    <div class="pagination" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px;flex-wrap:wrap;">
      <button class="btn-secondary btn-sm" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''}>Trước</button>
      <span style="font-size:12px;color:var(--text-2);">Trang ${page}/${totalPages} · ${total} dòng</span>
      <button class="btn-secondary btn-sm" data-page="${Math.min(totalPages, page + 1)}" ${page >= totalPages ? 'disabled' : ''}>Sau</button>
    </div>
  `;
}

export function bindPagination(container, onPageChange) {
  container?.querySelectorAll('.pagination [data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page, 10);
      if (!btn.disabled && page) onPageChange(page);
    });
  });
}

export function today() {
  return new Date().toLocaleDateString('en-CA');
}

export function thisMonth() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

/** Show toast message */
export function toast(msg, type = 'info', dur = 3000) {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, dur);
}

/** Open modal */
export function openModal(title, bodyHtml, footerHtml = '') {
  const ov = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml;
  document.getElementById('modal')?.classList.remove('modal--scroll-fixed', 'modal--project');
  ov.classList.remove('hidden');
}

export function closeModal() {
  document.getElementById('modal-overlay')?.classList.add('hidden');
}

/** Loading/empty helpers */
export function loadingHTML() {
  return `<div class="loading-state"><div class="spinner"></div>Đang tải...</div>`;
}
export function emptyHTML(icon, text, hint = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-text">${esc(text)}</div>${hint ? `<div class="empty-hint">${esc(hint)}</div>` : ''}</div>`;
}
