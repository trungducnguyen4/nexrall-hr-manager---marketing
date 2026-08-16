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
  'Phòng IT',
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
  'Phòng IT': 'IT',
};

// Legacy employee data may still contain "Nhân sự", "HR" or an unaccented
// variant instead of the canonical "Phòng HCNS". Keep the client-side access
// check aligned with the Worker permission helper without changing user data.
export function isHcnsDepartment(department) {
  const key = String(department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return ['phong hcns', 'hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'].includes(key);
}

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

export function setAvatar(el, name, color, ini, imageUrl = '') {
  if (!el) return;
  el.style.background = color || avatarColor(name || '');
  el.textContent = ini || initials(name || '');
  el.querySelector('.app-avatar-image')?.remove();
  if (!imageUrl) return;
  const image = document.createElement('img');
  image.className = 'app-avatar-image';
  image.src = imageUrl;
  image.alt = '';
  image.addEventListener('error', () => image.remove(), { once: true });
  el.appendChild(image);
}

export function statusBadge(status) {
  const map = {
    present: ['badge-success', '✅ Đúng giờ'],
    registered: ['badge-info', '📝 Chờ check-in'],
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
    issued: ['badge-info', 'Đã phát hành'],
    employee_confirmed: ['badge-success', 'Đã xác nhận'],
    review_requested: ['badge-warning', 'Yêu cầu xem lại'],
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
export const LIFECYCLE_STATUSES = ['Chờ tiếp nhận', 'Thực tập', 'Thử việc', 'Cộng tác viên', 'Chính thức', 'Đã nghỉ'];

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
    key: 'chuyen_mon', label: 'Nhóm 1 – Kết quả và năng lực thực hiện công việc', maxScore: 60, color: '#EE4D2D', icon: '🎯', evidenceHeader: 'Căn cứ đánh giá',
    criteria: [
      { code: 'HS01', name: 'Hoàn thành KPI/Mục tiêu tháng', desc: 'Mức độ hoàn thành các mục tiêu, KPI được giao trong tháng.', max: 15, scale: '15: ≥110% KPI; 13–14: 100–<110%; 10–12: 80–<100%; 6–9: 60–<80%; 1–5: <60%; 0: Không thực hiện', note: 'Số liệu KPI thực tế' },
      { code: 'HS02', name: 'Chất lượng sản phẩm/đầu ra', desc: 'Độ chính xác, hoàn thiện và mức độ đáp ứng yêu cầu của công việc bàn giao.', max: 10, scale: '9–10: Chất lượng xuất sắc, hầu như không có lỗi; 7–8: Đáp ứng tốt, có lỗi nhỏ; 4–6: Còn nhiều điểm cần sửa; 1–3: Chất lượng thấp; 0: Không đạt yêu cầu', note: 'Sản phẩm bàn giao, tỷ lệ lỗi, phản hồi của quản lý' },
      { code: 'HS03', name: 'Quản lý tiến độ, thời gian và ưu tiên công việc', desc: 'Khả năng lập kế hoạch, xác định thứ tự ưu tiên, phân bổ thời gian và hoàn thành đúng hạn.', max: 10, scale: '9–10: Luôn đúng hoặc trước hạn, ưu tiên hợp lý; 7–8: Phần lớn đúng hạn; 4–6: Có chậm hạn, cần nhắc nhở; 1–3: Thường xuyên chậm hoặc bỏ sót; 0: Không kiểm soát được tiến độ', note: 'Tiến độ công việc, số lần chậm hạn, mức độ chủ động' },
      { code: 'HS04', name: 'Năng lực giải quyết vấn đề', desc: 'Khả năng nhận diện, xử lý tình huống phát sinh và đưa ra phương án phù hợp.', max: 10, scale: '9–10: Chủ động xử lý hiệu quả; 7–8: Xử lý tốt các vấn đề thông thường; 4–6: Cần hỗ trợ trong nhiều trường hợp; 1–3: Khả năng xử lý hạn chế; 0: Không xử lý được', note: 'Tình huống thực tế và kết quả xử lý' },
      { code: 'HS05', name: 'Chuyên môn và kỹ thuật', desc: 'Mức độ vững chuyên môn, kỹ năng nghiệp vụ theo vị trí.', max: 10, scale: '9–10: Thành thạo, có thể hướng dẫn người khác; 7–8: Đáp ứng tốt yêu cầu; 4–6: Còn hạn chế, cần đào tạo thêm; 1–3: Chuyên môn yếu; 0: Không đáp ứng yêu cầu vị trí', note: 'Chất lượng chuyên môn, kết quả công việc' },
      { code: 'HS06', name: 'Hiệu quả làm việc độc lập', desc: 'Khả năng tự tổ chức và hoàn thành công việc mà không cần giám sát thường xuyên.', max: 5, scale: '5: Hoàn toàn chủ động; 4: Làm việc độc lập tốt; 2–3: Đôi lúc cần hỗ trợ hoặc nhắc nhở; 1: Phụ thuộc nhiều vào quản lý; 0: Không thể tự hoàn thành công việc', note: 'Mức độ chủ động, số lần cần hỗ trợ' },
    ],
  },
  {
    key: 'van_hoa', label: 'Nhóm 2 – Văn hóa, thái độ, kỷ luật', maxScore: 25, color: '#1D4ED8', icon: '🤝', evidenceHeader: 'Ghi chú/Minh chứng',
    criteria: [
      { code: 'VH01', name: 'Tinh thần trách nhiệm và thái độ làm việc', desc: 'Chủ động, tích cực, nghiêm túc và chịu trách nhiệm đối với công việc được giao.', max: 7, scale: '7: Luôn chủ động, trách nhiệm cao; 5–6: Thực hiện tốt, ít cần nhắc nhở; 3–4: Đáp ứng cơ bản nhưng đôi lúc thiếu chủ động; 1–2: Thường xuyên cần nhắc nhở; 0: Thiếu trách nhiệm nghiêm trọng', note: 'Nhận xét của quản lý, kết quả thực hiện công việc' },
      { code: 'VH02', name: 'Phối hợp và hỗ trợ đồng nghiệp', desc: 'Hợp tác, chia sẻ thông tin và hỗ trợ các thành viên để hoàn thành mục tiêu chung.', max: 6, scale: '6: Phối hợp rất tốt, chủ động hỗ trợ; 4–5: Hợp tác tốt; 2–3: Phối hợp chưa thường xuyên hoặc còn bị động; 1: Khó phối hợp; 0: Không hợp tác, gây ảnh hưởng công việc chung', note: 'Phản hồi của đồng nghiệp, quản lý và các bộ phận liên quan' },
      { code: 'VH03', name: 'Tuân thủ nội quy, quy trình và kỷ luật', desc: 'Chấp hành thời gian làm việc, nội quy, quy trình nghiệp vụ và yêu cầu quản lý.', max: 6, scale: '6: Tuân thủ đầy đủ, không vi phạm; 4–5: Có vi phạm nhỏ nhưng khắc phục ngay; 2–3: Vi phạm hoặc bị nhắc nhở nhiều lần; 1: Vi phạm nghiêm trọng; 0: Vi phạm đặc biệt nghiêm trọng hoặc tái phạm', note: 'Dữ liệu chấm công, biên bản và lịch sử nhắc nhở' },
      { code: 'VH04', name: 'Giao tiếp, báo cáo và thực hiện cam kết', desc: 'Trao đổi rõ ràng, báo cáo kịp thời, thực hiện đúng nội dung và thời hạn đã cam kết.', max: 6, scale: '6: Luôn báo cáo đúng hạn, thực hiện đầy đủ cam kết; 4–5: Cơ bản đầy đủ, đôi lúc cần nhắc; 2–3: Báo cáo chậm hoặc không hoàn thành một số cam kết; 1: Thường xuyên chậm, thiếu báo cáo; 0: Không báo cáo, không thực hiện cam kết, gây ảnh hưởng nghiêm trọng', note: 'Báo cáo công việc, email, lịch sử giao việc và xác nhận tiến độ' },
    ],
  },
  {
    key: 'sang_tao', label: 'Nhóm 3 – Sáng tạo, cải tiến, chủ động', maxScore: 15, color: '#047857', icon: '💡', evidenceHeader: 'Căn cứ đánh giá',
    criteria: [
      { code: 'SK01', name: 'Sáng kiến và đề xuất cải tiến', desc: 'Đưa ra ý tưởng, giải pháp cải tiến quy trình, sản phẩm hoặc phương pháp làm việc.', max: 5, scale: '5: Có sáng kiến giá trị, được áp dụng và tạo hiệu quả; 4: Có đề xuất thiết thực, có khả năng áp dụng; 2–3: Có ý tưởng nhưng tính ứng dụng hoặc hiệu quả còn hạn chế; 1: Ít đề xuất; 0: Không có đề xuất', note: 'Nội dung đề xuất, kết quả áp dụng và xác nhận của quản lý' },
      { code: 'SK02', name: 'Tự học và nâng cao năng lực', desc: 'Chủ động học hỏi, cập nhật kiến thức và phát triển kỹ năng phục vụ công việc.', max: 4, scale: '4: Chủ động học tập và áp dụng hiệu quả; 3: Có học hỏi thường xuyên, có tiến bộ; 1–2: Có học nhưng chưa đều hoặc ít áp dụng; 0: Không có tinh thần học hỏi', note: 'Khóa học, chứng chỉ, nội dung tự học và kết quả áp dụng' },
      { code: 'SK03', name: 'Ứng dụng công nghệ và công cụ mới', desc: 'Chủ động sử dụng công nghệ, AI hoặc công cụ phù hợp nhằm nâng cao năng suất và chất lượng công việc.', max: 3, scale: '3: Áp dụng hiệu quả, tạo cải thiện rõ ràng; 2: Có áp dụng và mang lại kết quả; 1: Áp dụng còn hạn chế hoặc cần hỗ trợ; 0: Không áp dụng', note: 'Công cụ đã sử dụng, sản phẩm và hiệu quả thực tế' },
      { code: 'SK04', name: 'Tinh thần chủ động và tạo giá trị gia tăng', desc: 'Chủ động nhận diện công việc cần thực hiện, đề xuất hỗ trợ và tạo kết quả vượt yêu cầu thông thường.', max: 3, scale: '3: Thường xuyên chủ động, tạo giá trị vượt mong đợi; 2: Chủ động tốt, đôi khi vượt yêu cầu; 1: Hoàn thành yêu cầu nhưng còn bị động; 0: Không chủ động hoặc thường xuyên chờ giao việc', note: 'Kết quả phát sinh ngoài nhiệm vụ chính, phản hồi của quản lý' },
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

export function normalizeVietnameseSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').trim();
}

export function filterBySearch(rows, search, fields = []) {
  const q = normalizeVietnameseSearch(search);
  if (!q) return rows || [];
  return (rows || []).filter(row => fields.some(field => normalizeVietnameseSearch(row?.[field]).includes(q)));
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
  document.getElementById('modal')?.classList.remove('modal--scroll-fixed', 'modal--project', 'modal--project-timeline', 'modal--attendance-summary', 'modal--user-detail', 'modal--user-profile', 'modal--user-form', 'modal--payslip', 'modal--avatar-crop', 'modal--payroll-edit');
  ov?.classList.remove('modal-overlay--desktop-centered');
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
