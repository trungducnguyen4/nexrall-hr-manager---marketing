import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, paginationHTML, paginateRows, bindPagination, sortVietnameseNames, compareVietnameseNames } from '../utils.js';
import { icon } from '../icons.js';

const FALLBACK_TYPES = [
  { code:'annual', name:'Phép năm', paid_policy:'paid', deducts_annual_leave:1, short_description:'Dùng số ngày phép năm còn lại của bạn', policy_description:'Áp dụng cho nhu cầu nghỉ cá nhân và trừ vào số dư phép năm.' },
  { code:'compensatory', name:'Nghỉ bù', paid_policy:'paid', short_description:'Dùng ngày hoặc giờ nghỉ bù đã tích lũy', policy_description:'Chỉ đăng ký trong phạm vi số dư nghỉ bù hiện có.' },
  { code:'sick', name:'Nghỉ ốm', paid_policy:'paid', requires_evidence:1, short_description:'Nghỉ do ốm đau hoặc điều trị', policy_description:'Có thể yêu cầu giấy khám bệnh hoặc giấy xác nhận y tế.' },
  { code:'personal_paid', name:'Nghỉ việc riêng hưởng lương', paid_policy:'paid', short_description:'Việc cá nhân thuộc trường hợp được hưởng lương', policy_description:'Cần nêu rõ lý do để quản lý xem xét.' },
  { code:'personal', name:'Nghỉ việc riêng không hưởng lương', paid_policy:'unpaid', short_description:'Nghỉ cá nhân không thuộc trường hợp hưởng lương', policy_description:'Thời gian nghỉ không được tính lương.' },
  { code:'unpaid', name:'Nghỉ không hưởng lương', paid_policy:'unpaid', short_description:'Nghỉ cá nhân và không tính lương', policy_description:'Cần cấp có thẩm quyền phê duyệt.' },
  { code:'maternity', name:'Nghỉ thai sản', paid_policy:'paid', requires_evidence:1, requires_bod_approval:1, short_description:'Nghỉ theo chế độ thai sản', policy_description:'Cần thời gian dự kiến nghỉ và tài liệu theo chính sách công ty.' },
  { code:'other', name:'Khác', paid_policy:'configurable', short_description:'Chỉ chọn khi không có loại nghỉ phù hợp', policy_description:'Bắt buộc nhập lý do chi tiết để HCNS kiểm tra và phân loại.' },
];

const paidLabel = type => type.paid_policy === 'unpaid' ? 'Không hưởng lương' : type.paid_policy === 'configurable' ? 'Theo chế độ' : 'Có hưởng lương';
const paidClass = type => type.paid_policy === 'unpaid' ? 'unpaid' : type.paid_policy === 'configurable' ? 'config' : 'paid';
const sessionLabel = value => ({ full:'Cả ngày', morning:'Buổi sáng', afternoon:'Buổi chiều' })[value] || 'Cả ngày';
const statusData = status => ({
  pending: ['pending', 'Chờ duyệt'],
  approved: ['approved', 'Đã duyệt'],
  rejected: ['rejected', 'Từ chối']
}[status] || ['pending', status]);

const daysBetween = (start, end, session = 'full') => {
  if (!start || !end || start > end) return 0;
  let days = 0, cursor = new Date(`${start}T00:00:00`), finish = new Date(`${end}T00:00:00`);
  while (cursor <= finish) { if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days += 1; cursor.setDate(cursor.getDate() + 1); }
  return session === 'full' ? days : (start === end ? 0.5 : 0);
};

const isHcnsDepartment = (department) => ['hcns', 'phong hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'].includes(String(department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
const isBodDepartment = (department) => ['ban giam doc', 'bgd', 'giam doc'].includes(String(department || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

function formatDocSize(bytes) {
  const n = Number(bytes || 0);
  if (n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function nameInitials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(-2).join('').toUpperCase();
}

async function previewLeaveDocument(leaveId, docId, docName = 'tai-lieu', contentType = '') {
  try {
    toast('Đang mở tệp đính kèm...', 'info');
    const { blob } = await api.getLeaveDocumentBlob(leaveId, docId, 'inline');
    const mime = contentType || blob.type || '';
    const blobUrl = URL.createObjectURL(blob);
    const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(docName);
    const isPdf = mime.includes('pdf') || /\.pdf$/i.test(docName);

    if (isImage) {
      openModal(docName, `
        <div style="text-align:center;max-height:70vh;overflow:auto;padding:12px 0;">
          <img src="${blobUrl}" style="max-width:100%;max-height:65vh;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);" alt="${esc(docName)}" />
        </div>
      `, `
        <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>
        <a href="${blobUrl}" download="${esc(docName)}" class="btn-primary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">${icon('download', 'xs')} <span>Tải về máy</span></a>
      `);
    } else if (isPdf) {
      openModal(docName, `
        <div style="width:100%;height:68vh;">
          <iframe src="${blobUrl}" style="width:100%;height:100%;border:none;border-radius:8px;"></iframe>
        </div>
      `, `
        <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>
        <a href="${blobUrl}" target="_blank" class="btn-secondary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">${icon('externalLink', 'xs')} <span>Mở tab mới</span></a>
        <a href="${blobUrl}" download="${esc(docName)}" class="btn-primary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">${icon('download', 'xs')} <span>Tải về</span></a>
      `);
    } else {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = docName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
      toast('Đã tải tệp về: ' + docName, 'success');
    }
  } catch (err) {
    toast(err.message || 'Không thể xem tài liệu đính kèm', 'error');
  }
}

export async function renderLeave(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';
  const canConfigure = me.role === 'admin' || isHcnsDepartment(me.department);
  const canReview = canConfigure || isManager || isBodDepartment(me.department);

  let types = FALLBACK_TYPES;
  let currentTab = 'mine'; // 'mine' | 'review'
  let currentStatus = '';
  let currentTypeCode = '';
  let currentPage = 1;
  let cachedLeaveList = [];
  let userBalances = [];

  try {
    const data = await api.getLeaveTypes(false);
    if (data.leaveTypes?.length) types = data.leaveTypes;
  } catch (_) {}

  try {
    const bData = await api.getLeaveBalances({ year: new Date().getFullYear() });
    if (bData.balances) userBalances = bData.balances;
  } catch (_) {}

  const isOfficial = me?.employee_type !== 'TTS' && me?.lifecycle_status !== 'Thử việc' && me?.lifecycle_status !== 'Thực tập' && me?.lifecycle_status !== 'Chờ tiếp nhận' && me?.contract_type !== 'Thử việc' && me?.contract_type !== 'Thỏa thuận TTS';
  const defaultAnnual = isOfficial ? 12 : 0;
  const userAnnualRecord = userBalances.find(x => x.leave_type_code === 'annual');
  const annualBalance = userAnnualRecord ? Number(userAnnualRecord.available_days) : defaultAnnual;

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:18px;">
      <div class="leave-header-title-wrap">
        <div class="leave-title-icon-badge">${icon('calendarDays', 'lg')}</div>
        <div>
          <h1 class="page-title">Nghỉ phép</h1>
          <p class="page-sub">Quản lý đơn xin nghỉ, phê duyệt và theo dõi số dư phép</p>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${canConfigure ? `
          <button id="leave-balance" class="btn-secondary btn-sm" title="Điều chỉnh số dư ngày nghỉ của nhân viên">${icon('tag', 'sm')} <span>Số dư</span></button>
          <button id="leave-policy" class="btn-secondary btn-sm" title="Cấu hình quy định các loại nghỉ phép">${icon('settings', 'sm')} <span>Cấu hình</span></button>
        ` : ''}
        <button id="btn-new-leave" class="btn-primary btn-sm">${icon('plus', 'sm')} <span>Tạo đơn nghỉ</span></button>
      </div>
    </div>

    <!-- Navigation & Filter Toolbar -->
    <div class="leave-main-nav">
      ${canReview ? `
        <div class="leave-scope-tabs" id="leave-scope-tabs">
          <button type="button" class="leave-scope-tab ${currentTab === 'mine' ? 'active' : ''}" data-tab="mine">
            ${icon('pin', 'xs')} <span>Đơn của tôi</span>
          </button>
          <button type="button" class="leave-scope-tab ${currentTab === 'review' ? 'active' : ''}" data-tab="review">
            ${icon('clipboardCheck', 'xs')} <span>Duyệt đơn nhân viên</span>
            <span id="leave-pending-badge" class="leave-counter-pill hidden">0</span>
          </button>
        </div>
      ` : '<div></div>'}

      <div style="font-size:12px;font-weight:600;color:var(--text-3);padding-bottom:6px;">
        Năm ${new Date().getFullYear()}
      </div>
    </div>

    <div class="leave-toolbar">
      <div class="leave-status-segmented" id="leave-status-filters">
        <button type="button" class="leave-status-seg-btn ${currentStatus === '' ? 'active' : ''}" data-status="">
          <span>Tất cả</span><span class="leave-seg-count" id="leave-count-all">0</span>
        </button>
        <button type="button" class="leave-status-seg-btn ${currentStatus === 'pending' ? 'active' : ''}" data-status="pending">
          <span class="leave-seg-dot pending"></span><span>Chờ duyệt</span><span class="leave-seg-count" id="leave-count-pending">0</span>
        </button>
        <button type="button" class="leave-status-seg-btn ${currentStatus === 'approved' ? 'active' : ''}" data-status="approved">
          <span class="leave-seg-dot approved"></span><span>Đã duyệt</span><span class="leave-seg-count" id="leave-count-approved">0</span>
        </button>
        <button type="button" class="leave-status-seg-btn ${currentStatus === 'rejected' ? 'active' : ''}" data-status="rejected">
          <span class="leave-seg-dot rejected"></span><span>Từ chối</span><span class="leave-seg-count" id="leave-count-rejected">0</span>
        </button>
      </div>

      <div class="leave-filters-right">
        <select id="leave-type-filter" class="leave-type-select">
          <option value="">Tất cả loại nghỉ</option>
          ${types.map(t => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join('')}
        </select>
        <div class="leave-search-wrap">
          <span class="leave-search-icon">${icon('search', 'sm')}</span>
          <input id="leave-search" class="leave-search-input" placeholder="Tìm theo tên, mã NV, phòng ban, lý do..."/>
        </div>
      </div>
    </div>

    <!-- Data Table Container -->
    <div id="leave-list">${loadingHTML()}</div>
  `;

  // Bind Header actions
  el.querySelector('#btn-new-leave').addEventListener('click', () => openLeaveForm(me, types, loadLeave));
  el.querySelector('#leave-policy')?.addEventListener('click', () => openPolicyConfig(types, async () => {
    const data = await api.getLeaveTypes(false);
    if (data.leaveTypes?.length) types = data.leaveTypes;
  }));
  el.querySelector('#leave-balance')?.addEventListener('click', () => openBalanceAdjustment());

  // Bind Scope tabs
  el.querySelector('#leave-scope-tabs')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-tab]');
    if (!btn) return;
    currentTab = btn.dataset.tab;
    el.querySelectorAll('#leave-scope-tabs .leave-scope-tab').forEach(x => x.classList.toggle('active', x === btn));
    currentPage = 1;
    loadLeave();
  });

  // Bind Status Segmented buttons
  el.querySelector('#leave-status-filters').addEventListener('click', event => {
    const btn = event.target.closest('.leave-status-seg-btn');
    if (!btn) return;
    currentStatus = btn.dataset.status || '';
    syncFilterButtons();
    currentPage = 1;
    renderLeaveTable();
  });

  function syncFilterButtons() {
    el.querySelectorAll('#leave-status-filters .leave-status-seg-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.status || '') === currentStatus);
    });
  }

  // Bind Search & Type filter
  el.querySelector('#leave-search')?.addEventListener('input', () => {
    currentPage = 1;
    renderLeaveTable();
  });
  el.querySelector('#leave-type-filter')?.addEventListener('change', event => {
    currentTypeCode = event.target.value || '';
    currentPage = 1;
    renderLeaveTable();
  });

  async function updatePendingBadge() {
    if (!canReview) return;
    const badge = el.querySelector('#leave-pending-badge');
    if (!badge) return;
    try {
      const { leave = [] } = await api.getLeave({ scope: 'team', status: 'pending' });
      const pendingCount = leave.length;
      badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
      badge.classList.toggle('hidden', pendingCount < 1);
    } catch (_) {
      badge.classList.add('hidden');
    }
  }

  async function loadLeave() {
    const list = el.querySelector('#leave-list');
    list.innerHTML = loadingHTML();
    try {
      const params = {};
      if (currentTab === 'review' && canReview) {
        params.scope = 'team';
      } else {
        params.self = 1;
      }

      const res = await api.getLeave(params);
      cachedLeaveList = res.leave || [];

      // Update status filter counts
      const pendingCount = cachedLeaveList.filter(x => x.status === 'pending').length;
      const approvedCount = cachedLeaveList.filter(x => x.status === 'approved').length;
      const rejectedCount = cachedLeaveList.filter(x => x.status === 'rejected').length;
      const totalCount = cachedLeaveList.length;

      const cAll = el.querySelector('#leave-count-all');
      const cPending = el.querySelector('#leave-count-pending');
      const cApproved = el.querySelector('#leave-count-approved');
      const cRejected = el.querySelector('#leave-count-rejected');

      if (cAll) cAll.textContent = totalCount;
      if (cPending) cPending.textContent = pendingCount;
      if (cApproved) cApproved.textContent = approvedCount;
      if (cRejected) cRejected.textContent = rejectedCount;

      updatePendingBadge();
      renderLeaveTable();
    } catch (error) {
      list.innerHTML = emptyHTML('triangleAlert', error.message || 'Không thể tải danh sách đơn nghỉ phép.');
    }
  }

  function renderLeaveTable() {
    const list = el.querySelector('#leave-list');
    if (!list) return;

    const search = (el.querySelector('#leave-search')?.value || '').toLocaleLowerCase('vi').trim();
    const filtered = cachedLeaveList.filter(row => {
      if (currentStatus && row.status !== currentStatus) return false;
      if (currentTypeCode && row.type !== currentTypeCode) return false;
      if (search) {
        const haystack = `${row.employee_name || ''} ${row.employee_code || ''} ${row.department || ''} ${row.reason || ''} ${row.type_name || ''}`.toLocaleLowerCase('vi');
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const isReview = currentTab === 'review';
    const displayRows = isReview ? sortVietnameseNames(filtered, 'employee_name') : filtered;
    const page = paginateRows(displayRows, currentPage, 12);
    currentPage = page.page;

    if (!filtered.length) {
      const emptyMsg = isReview ? 'Không có đơn nghỉ phép nào của nhân viên' : 'Bạn chưa có đơn nghỉ phép nào phù hợp';
      list.innerHTML = emptyHTML('plane', emptyMsg, currentTab === 'mine' ? 'Nhấn “+ Tạo đơn nghỉ” để gửi đơn mới' : 'Thử thay đổi bộ lọc trạng thái hoặc từ khóa tìm kiếm.');
      return;
    }

    list.innerHTML = `
      <div class="leave-table-card">
        <div class="leave-table-wrap">
          <table class="leave-table">
            <thead>
              <tr>
                ${isReview ? '<th>Nhân viên</th>' : ''}
                <th>Loại nghỉ</th>
                <th>Thời gian nghỉ</th>
                <th>Lý do & Bàn giao</th>
                <th>Trạng thái</th>
                <th style="text-align:right;">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${page.rows.map(row => {
                const [cls, label] = statusData(row.status);
                const type = types.find(x => x.code === row.type) || row;
                const isApplicant = Number(row.employee_id) === Number(me.id) || String(row.user_id) === String(me.id);
                const docs = Array.isArray(row.documents) ? row.documents : [];
                const initials = nameInitials(row.employee_name);
                const days = row.total_days ?? daysBetween(row.start_date, row.end_date, row.leave_session);

                return `
                  <tr>
                    ${isReview ? `
                      <td>
                        <div class="leave-user-cell">
                          <div class="leave-user-avatar">${esc(initials)}</div>
                          <div>
                            <div class="leave-user-name">${esc(row.employee_name || 'Nhân viên')}</div>
                            <div class="leave-user-meta">${esc([row.employee_code, row.department].filter(Boolean).join(' · '))}</div>
                          </div>
                        </div>
                      </td>
                    ` : ''}
                    <td>
                      <div class="leave-type-cell">
                        <div class="leave-type-pill">
                          <span>${esc(row.type_name || type.name || row.type)}</span>
                        </div>
                        <div>
                          <span class="leave-paid-badge ${paidClass(row)}">${esc(row.paid_label || paidLabel(row))}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="leave-period-text">
                        <span>${esc(row.start_date)}</span>
                        <span style="color:var(--text-3);font-size:12px;">→</span>
                        <span>${esc(row.end_date)}</span>
                      </div>
                      <div class="leave-period-sub">
                        ${sessionLabel(row.leave_session)} · <strong>${days} ngày</strong>
                      </div>
                    </td>
                    <td>
                      <div class="leave-reason-text">
                        ${esc(row.reason || '—')}
                      </div>
                      ${row.handover_user_name ? `
                        <div class="leave-handover-text">
                          <span style="display:inline-flex;align-items:center;gap:4px;opacity:0.8;">${icon('handshake', 'xs')} <span>Bàn giao:</span></span> <strong>${esc(row.handover_user_name)}</strong>
                        </div>
                      ` : ''}
                      ${docs.length ? `
                        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
                          ${docs.map(doc => `
                            <button type="button" class="leave-doc-chip leave-doc-item-btn" data-leave-id="${row.id}" data-doc-id="${doc.id}" data-doc-name="${esc(doc.original_filename)}" data-doc-type="${esc(doc.content_type || '')}">
                              ${icon('paperclip', 'xs')} <span>${esc(doc.original_filename || 'Tệp')}</span> <small style="color:var(--text-3);">(${formatDocSize(doc.byte_size)})</small>
                            </button>
                          `).join('')}
                        </div>
                      ` : (row.document_count ? `
                        <div style="margin-top:6px;">
                          <button type="button" class="leave-doc-chip leave-doc-fetch-btn" data-leave-id="${row.id}">
                            ${icon('paperclip', 'xs')} <span>Xem ${row.document_count} tệp</span>
                          </button>
                        </div>
                      ` : '')}
                    </td>
                    <td>
                      <div class="leave-status-cell">
                        <span class="leave-status-chip ${cls}">
                          <span class="leave-status-dot ${cls}"></span>
                          <span>${label}</span>
                        </span>
                        ${row.status === 'pending' && row.current_approver ? `
                          <div class="leave-approver-hint">
                            Chờ: <em>${esc(row.current_approver)}</em>
                          </div>
                        ` : ''}
                      </div>
                    </td>
                    <td>
                      <div class="leave-actions-cell">
                        ${row.can_action ? `
                          <button class="btn-primary btn-xs leave-approve" data-id="${row.id}" title="Phê duyệt đơn">${icon('check', 'xs')} <span>Duyệt</span></button>
                          <button class="btn-secondary btn-xs leave-reject" data-id="${row.id}" title="Từ chối đơn" style="color:var(--danger);border-color:rgba(239,68,68,0.25);">${icon('x', 'xs')} <span>Từ chối</span></button>
                        ` : ''}
                        ${isApplicant && row.status === 'pending' ? `
                          <button class="btn-secondary btn-xs leave-delete" data-id="${row.id}" title="Hủy đơn xin nghỉ này">${icon('trash2', 'xs')} <span>Hủy đơn</span></button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ${paginationHTML(page)}
    `;

    // Bind document previewers
    list.querySelectorAll('.leave-doc-item-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const leaveId = btn.dataset.leaveId;
      const docId = btn.dataset.docId;
      const docName = btn.dataset.docName;
      const docType = btn.dataset.docType;
      if (leaveId && docId) {
        btn.disabled = true;
        try {
          await previewLeaveDocument(leaveId, docId, docName, docType);
        } finally {
          btn.disabled = false;
        }
      }
    }));

    list.querySelectorAll('.leave-doc-fetch-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const leaveId = btn.dataset.leaveId;
      if (!leaveId) return;
      btn.disabled = true;
      try {
        const { documents = [] } = await api.getLeaveDocuments(leaveId);
        if (!documents.length) {
          toast('Không tìm thấy tệp đính kèm', 'info');
          return;
        }
        if (documents.length === 1) {
          await previewLeaveDocument(leaveId, documents[0].id, documents[0].original_filename, documents[0].content_type);
        } else {
          openModal('Danh sách tệp đính kèm', `
            <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0;">
              ${documents.map(d => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border);">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                    <span style="display:flex;align-items:center;color:var(--text-2);">${icon('paperclip', 'sm')}</span>
                    <div style="min-width:0;">
                      <strong style="font-size:13px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.original_filename)}</strong>
                      <small style="color:var(--text-3);">${formatDocSize(d.byte_size)}</small>
                    </div>
                  </div>
                  <button type="button" class="btn-primary btn-xs preview-modal-doc-btn" data-doc-id="${d.id}" data-doc-name="${esc(d.original_filename)}" data-doc-type="${esc(d.content_type || '')}">Xem / Tải</button>
                </div>
              `).join('')}
            </div>
          `, '<button class="btn-secondary" onclick="document.getElementById(\'modal-overlay\').classList.add(\'hidden\')">Đóng</button>');

          document.querySelectorAll('.preview-modal-doc-btn').forEach(pBtn => pBtn.addEventListener('click', async () => {
            pBtn.disabled = true;
            try {
              await previewLeaveDocument(leaveId, pBtn.dataset.docId, pBtn.dataset.docName, pBtn.dataset.docType);
            } finally {
              pBtn.disabled = false;
            }
          }));
        }
      } catch (err) {
        toast(err.message || 'Không thể tải danh sách tệp đính kèm', 'error');
      } finally {
        btn.disabled = false;
      }
    }));

    // Bind Approvals
    list.querySelectorAll('.leave-approve').forEach(button => button.addEventListener('click', async () => {
      try {
        await api.updateLeave(button.dataset.id, { status: 'approved' });
        toast('Đã phê duyệt đơn nghỉ phép thành công', 'success');
        loadLeave();
      } catch (error) {
        toast(error.message, 'error');
      }
    }));

    list.querySelectorAll('.leave-reject').forEach(button => button.addEventListener('click', async () => {
      const note = prompt('Ghi chú lý do từ chối (không bắt buộc):') || '';
      try {
        await api.updateLeave(button.dataset.id, { status: 'rejected', note });
        toast('Đã từ chối đơn nghỉ phép', 'info');
        loadLeave();
      } catch (error) {
        toast(error.message, 'error');
      }
    }));

    list.querySelectorAll('.leave-delete').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Hủy / xóa đơn nghỉ phép này? Số dư đã giữ chỗ (nếu có) sẽ được hoàn lại.')) return;
      try {
        await api.deleteLeave(button.dataset.id);
        toast('Đã xóa đơn nghỉ phép', 'success');
        loadLeave();
      } catch (error) {
        toast(error.message, 'error');
      }
    }));

    bindPagination(list, next => {
      currentPage = next;
      renderLeaveTable();
    });
  }

  el._cleanup = () => {};

  EventBus.bindView(el, 'leave', () => loadLeave());
  EventBus.bindView(el, 'leave:*', () => loadLeave());

  loadLeave();
}

async function openLeaveForm(me, types, refresh = noop) {
  refresh = safeCb(refresh);
  const today = new Date().toISOString().slice(0,10);
  const isOfficial = me?.employee_type !== 'TTS' && me?.lifecycle_status !== 'Thử việc' && me?.lifecycle_status !== 'Thực tập' && me?.lifecycle_status !== 'Chờ tiếp nhận' && me?.contract_type !== 'Thử việc' && me?.contract_type !== 'Thỏa thuận TTS';
  const { balances = [] } = await api.getLeaveBalances({ year: new Date().getFullYear() }).catch(() => ({ balances: [] }));
  const { users = [] } = await api.getUsersBasic().catch(() => ({ users: [] }));
  const balanceOf = code => {
    const rec = balances.find(x => x.leave_type_code === code);
    if (rec) return Number(rec.available_days || 0);
    if (code === 'annual') return isOfficial ? 12 : 0;
    return 0;
  };

  const render = selectedCode => {
    const type = types.find(x => x.code === selectedCode);
    const maternity = selectedCode === 'maternity';
    const balanceCode = type?.deducts_annual_leave ? 'annual' : selectedCode === 'compensatory' ? 'compensatory' : null;
    const docText = type?.required_documents || (type?.requires_evidence ? 'Tài liệu minh chứng bắt buộc' : 'Không yêu cầu tài liệu đính kèm');

    return `
      <div class="field">
        <label>Loại nghỉ phép *</label>
        <select id="lf-type">
          <option value="">Chọn loại nghỉ phép phù hợp</option>
          ${types.map(x => {
            const isAnnualType = x.code === 'annual' || x.deducts_annual_leave;
            const suffix = !isOfficial && isAnnualType ? ' (Chỉ dành cho NV chính thức)' : ` — ${paidLabel(x)}`;
            return `<option value="${esc(x.code)}" ${x.code===selectedCode?'selected':''}>${esc(x.name)}${suffix}</option>`;
          }).join('')}
        </select>
      </div>
      ${type ? `
        <div class="card" style="padding:14px 16px;margin:0 0 16px;border-color:rgba(238, 77, 45, 0.2);background:rgba(238, 77, 45, 0.03);border-radius:12px;">
          <div style="display:flex;gap:8px;align-items:center;">
            <strong style="font-size:14px;color:var(--text);">${esc(type.name)}</strong>
            <span class="leave-paid-badge ${paidClass(type)}">${paidLabel(type)}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-2);margin-top:6px;line-height:1.45;">
            ${esc(type.policy_description || type.short_description || 'Theo chính sách công ty.')}
          </div>
          ${!isOfficial && balanceCode === 'annual' ? `
            <div style="display:flex;align-items:flex-start;gap:6px;font-size:12px;color:#d97706;margin-top:8px;padding:8px 12px;background:#FEF3C7;border-radius:8px;font-weight:600;line-height:1.4;">
              ${icon('triangleAlert', 'xs')} <span>Chế độ phép năm chỉ áp dụng cho nhân viên chính thức (12 ngày/năm). Thực tập sinh và nhân viên thử việc vui lòng chọn hình thức nghỉ khác (ví dụ: Nghỉ không lương).</span>
            </div>
          ` : balanceCode ? `<div style="font-size:12.5px;color:var(--text);margin-top:6px;">Số dư hiện có: <strong style="color:var(--primary);">${balanceOf(balanceCode)} ngày</strong></div>` : ''}
          <div style="font-size:11.5px;color:var(--text-3);margin-top:6px;padding-top:6px;border-top:1px dashed rgba(238,77,45,0.15);">
            Hồ sơ: ${esc(docText)} · Luồng duyệt: ${type.approval_flow === 'manager_hr_bgd' || type.requires_bod_approval ? 'Quản lý → HCNS → Ban Giám đốc' : 'Quản lý → HCNS'}${type.notice_hours != null ? ` · Báo trước ${type.notice_hours}h` : ''}
          </div>
        </div>
      ` : ''}
      <div class="input-row">
        <div class="field">
          <label>${maternity ? 'Ngày dự kiến bắt đầu' : 'Từ ngày'} *</label>
          <input type="date" id="lf-start" value="${today}"/>
        </div>
        <div class="field">
          <label>${maternity ? 'Ngày dự kiến kết thúc' : 'Đến ngày'} *</label>
          <input type="date" id="lf-end" value="${today}"/>
        </div>
      </div>
      ${maternity ? '' : `
        <div class="field">
          <label>Ca nghỉ *</label>
          <select id="lf-session">
            <option value="full">Cả ngày</option>
            <option value="morning">Buổi sáng</option>
            <option value="afternoon">Buổi chiều</option>
          </select>
        </div>
      `}
      <div class="field">
        <label>Lý do xin nghỉ *</label>
        <textarea id="lf-reason" rows="3" placeholder="Nhập lý do chi tiết để quản lý xem xét..."></textarea>
      </div>
      <div class="field">
        <label>Tài liệu đính kèm ${type?.requires_evidence ? '*' : ''}</label>
        <input type="file" id="lf-files" accept=".pdf,image/jpeg,image/png,image/webp" multiple/>
        <div class="field-hint" style="font-size:11px;color:var(--text-3);margin-top:3px;">PDF, JPG, PNG hoặc WebP; tối đa 10 MB mỗi tệp.</div>
      </div>
      <div class="field">
        <label>Người nhận bàn giao công việc</label>
        <select id="lf-handover">
          <option value="">Chọn người nhận bàn giao (bắt buộc nếu nghỉ từ 2 ngày)</option>
          ${users.filter(user => Number(user.id)!==Number(me.id)).map(user => `
            <option value="${user.id}">${esc(user.full_name)}${user.employee_code ? ` — ${esc(user.employee_code)}` : ''}</option>
          `).join('')}
        </select>
      </div>
      <div id="lf-total" style="text-align:center;padding:12px;background:#FFF5F2;border:1px solid #FED7AA;border-radius:10px;font-size:13px;font-weight:700;color:var(--primary);"></div>
    `;
  };

  openModal('Đăng ký nghỉ phép', `<div id="leave-form-body">${render('')}</div>`, '<button class="btn-secondary" onclick="document.getElementById(\'modal-overlay\').classList.add(\'hidden\')">Hủy</button><button class="btn-primary" id="lf-save">Gửi đơn xin nghỉ</button>');

  const body = document.getElementById('leave-form-body');
  const bind = () => {
    const typeSelect = document.getElementById('lf-type');
    typeSelect.addEventListener('change', () => { body.innerHTML = render(typeSelect.value); bind(); });
    const updateTotal = () => {
      const days = daysBetween(document.getElementById('lf-start').value, document.getElementById('lf-end').value, document.getElementById('lf-session')?.value || 'full');
      document.getElementById('lf-total').textContent = days ? `Tổng cộng: ${days} ngày nghỉ` : 'Chọn khoảng thời gian hợp lệ';
    };
    document.getElementById('lf-start').addEventListener('change', updateTotal);
    document.getElementById('lf-end').addEventListener('change', updateTotal);
    document.getElementById('lf-session')?.addEventListener('change', updateTotal);
    updateTotal();
  };
  bind();

  document.getElementById('lf-save').addEventListener('click', async () => {
    const type = document.getElementById('lf-type').value;
    const start = document.getElementById('lf-start').value;
    const end = document.getElementById('lf-end').value;
    const session = document.getElementById('lf-session')?.value || 'full';
    const reason = document.getElementById('lf-reason').value.trim();
    const policy = types.find(x => x.code === type);

    if (!type || !start || !end || !reason) {
      toast('Vui lòng chọn loại nghỉ, ngày nghỉ và nhập lý do', 'error');
      return;
    }
    if ((policy?.deducts_annual_leave || type === 'annual') && !isOfficial) {
      toast('Chế độ phép năm chỉ áp dụng cho nhân viên chính thức. Thực tập sinh và nhân viên thử việc vui lòng chọn loại nghỉ khác (ví dụ: Nghỉ không lương).', 'error');
      return;
    }
    if (start > end || (session !== 'full' && start !== end)) {
      toast('Khoảng thời gian hoặc ca nghỉ không hợp lệ', 'error');
      return;
    }

    const button = document.getElementById('lf-save');
    button.disabled = true;
    try {
      const files = [...document.getElementById('lf-files').files];
      if (policy?.requires_evidence && !files.length) throw new Error('Loại nghỉ này yêu cầu tài liệu đính kèm');
      const documentIds = [];
      for (const file of files) {
        const uploaded = await api.uploadLeaveDocument(file);
        documentIds.push(uploaded.id);
      }
      await api.createLeave({
        type,
        start_date: start,
        end_date: end,
        leave_session: session,
        reason,
        handover_user_id: document.getElementById('lf-handover').value || null,
        document_ids: documentIds
      });
      closeModal();
      toast('Đã gửi đơn xin nghỉ phép thành công', 'success');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

function openPolicyConfig(types, onSaved) {
  const show = type => {
    openModal('Cấu hình quy định loại nghỉ', `
      <div class="field">
        <label>Loại nghỉ phép</label>
        <select id="lp-choice">
          ${types.map(x => `<option value="${x.id}" ${x.id===type.id?'selected':''}>${esc(x.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Mô tả ngắn</label>
        <input id="lp-short" value="${esc(type.short_description || '')}"/>
      </div>
      <div class="field">
        <label>Diễn giải chính sách</label>
        <textarea id="lp-detail" rows="3">${esc(type.policy_description || '')}</textarea>
      </div>
      <div class="input-row">
        <div class="field">
          <label>Hạn gửi trước (giờ)</label>
          <input id="lp-notice" type="number" min="0" value="${type.notice_hours ?? ''}" placeholder="Theo chính sách"/>
        </div>
        <div class="field">
          <label>Luồng duyệt</label>
          <select id="lp-flow">
            <option value="manager_hr" ${type.approval_flow==='manager_hr'?'selected':''}>Quản lý → HCNS</option>
            <option value="manager_hr_bgd" ${type.approval_flow==='manager_hr_bgd'?'selected':''}>Quản lý → HCNS → BGD</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>Tài liệu yêu cầu</label>
        <input id="lp-docs" value="${esc(type.required_documents || '')}" placeholder="Ví dụ: Giấy khám bệnh, quyết định y tế..."/>
      </div>
      <label style="display:block;margin:10px 0;font-size:13px;">
        <input id="lp-evidence" type="checkbox" ${type.requires_evidence?'checked':''}/> Bắt buộc đính kèm tài liệu minh chứng
      </label>
      <label style="display:block;margin:10px 0;font-size:13px;">
        <input id="lp-handover" type="checkbox" ${type.requires_handover?'checked':''}/> Luôn yêu cầu người nhận bàn giao công việc
      </label>
    `, '<button class="btn-secondary" onclick="document.getElementById(\'modal-overlay\').classList.add(\'hidden\')">Hủy</button><button class="btn-primary" id="lp-save">Lưu cấu hình</button>');

    document.getElementById('lp-choice').addEventListener('change', event => show(types.find(x => String(x.id)===event.target.value)));
    document.getElementById('lp-save').addEventListener('click', async () => {
      try {
        await api.updateLeaveType(type.id, {
          ...type,
          short_description: document.getElementById('lp-short').value,
          policy_description: document.getElementById('lp-detail').value,
          notice_hours: document.getElementById('lp-notice').value,
          required_documents: document.getElementById('lp-docs').value,
          requires_evidence: document.getElementById('lp-evidence').checked,
          requires_handover: document.getElementById('lp-handover').checked,
          approval_flow: document.getElementById('lp-flow').value
        });
        await onSaved();
        closeModal();
        toast('Đã lưu cấu hình loại nghỉ phép', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };
  show(types[0]);
}

async function openBalanceAdjustment() {
  const { users = [] } = await api.getUsersBasic();
  openModal('Điều chỉnh số dư nghỉ phép', `
    <div class="field">
      <label>Nhân viên *</label>
      <select id="lb-user">
        <option value="">Chọn nhân viên</option>
        ${users.filter(user => user.is_active).map(user => `
          <option value="${user.id}">${esc(user.full_name)}${user.employee_code ? ` — ${esc(user.employee_code)}` : ''}</option>
        `).join('')}
      </select>
    </div>
    <div class="input-row">
      <div class="field">
        <label>Loại số dư</label>
        <select id="lb-type">
          <option value="annual">Phép năm</option>
          <option value="compensatory">Nghỉ bù</option>
        </select>
      </div>
      <div class="field">
        <label>Điều chỉnh (ngày)</label>
        <input id="lb-delta" type="number" step="0.5" placeholder="Ví dụ: +1 hoặc -0.5"/>
      </div>
    </div>
    <div class="field">
      <label>Lý do điều chỉnh *</label>
      <textarea id="lb-note" rows="2" placeholder="Nhập lý do điều chỉnh số dư phép..."></textarea>
    </div>
  `, '<button class="btn-secondary" onclick="document.getElementById(\'modal-overlay\').classList.add(\'hidden\')">Hủy</button><button class="btn-primary" id="lb-save">Lưu điều chỉnh</button>');

  document.getElementById('lb-save').addEventListener('click', async () => {
    try {
      await api.adjustLeaveBalance({
        user_id: Number(document.getElementById('lb-user').value),
        leave_type_code: document.getElementById('lb-type').value,
        delta_days: Number(document.getElementById('lb-delta').value),
        note: document.getElementById('lb-note').value.trim()
      });
      closeModal();
      toast('Đã điều chỉnh số dư thành công', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

