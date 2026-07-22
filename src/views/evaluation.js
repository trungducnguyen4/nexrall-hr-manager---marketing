import { esc, EVAL_GROUPS, EVAL_RATING_SCALE, toast, openModal, closeModal, loadingHTML, emptyHTML, fmtDateTime, noop, safeCb, paginateRows, paginationHTML, bindPagination } from '../utils.js';
import { api } from '../api.js';

// ════════════════════════════════════════════════
//  Đánh giá hiệu suất
//  1) Quy định & Tiêu chí (read-only, policy card — unchanged from before)
//  2) Workflow TTS: Mentor + Trưởng phòng (song song) → TTS xác nhận →
//     TGĐ phê duyệt → HCNS tiếp nhận & khóa. See server.js /api/evaluations*.
// ════════════════════════════════════════════════

export async function renderEvaluation(el, me) {
  const totalMax = EVAL_GROUPS.reduce((s, g) => s + g.maxScore, 0);
  const activeGroup = EVAL_GROUPS[0].key;

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">📈 Đánh giá hiệu suất</div>
        <div class="page-sub">Quy định &amp; tiêu chí đánh giá áp dụng cho nhân viên chính thức và TTS</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <div class="card-title">📋 Quy định &amp; Tiêu chí đánh giá</div>
        <button id="eval-toggle" class="btn-secondary btn-sm" aria-expanded="false">Mở rộng</button>
      </div>

      <div id="eval-policy-body" class="hidden">
        <!-- 1. Tổng quan chính sách -->
        <div class="section-title">Tổng quan chính sách</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px;">
          ${EVAL_GROUPS.map(g => `
            <div class="stat-card" style="--stat-color:${g.color};--stat-bg:${g.color}1A;">
              <div class="stat-icon-wrap" style="color:${g.color};">${g.icon}</div>
              <div class="stat-val" style="color:${g.color};">${g.maxScore} điểm</div>
              <div class="stat-label">${esc(g.label)}</div>
            </div>
          `).join('')}
          <div class="stat-card" style="--stat-color:var(--primary);--stat-bg:var(--primary-light);grid-column:1 / -1;">
            <div class="stat-icon-wrap">🏁</div>
            <div class="stat-val">${totalMax} điểm</div>
            <div class="stat-label">Tổng điểm đánh giá</div>
          </div>
        </div>

        <!-- 2. Thang xếp loại -->
        <div class="section-title">Thang xếp loại</div>
        <div class="table-wrap" style="margin-bottom:10px;">
          <table>
            <thead><tr><th>Xếp loại</th><th>Điểm</th><th>Hành động áp dụng</th></tr></thead>
            <tbody>
              ${EVAL_RATING_SCALE.map(r => `
                <tr>
                  <td><span class="badge ${r.badge}">${esc(r.label)}</span></td>
                  <td>${esc(r.range)}</td>
                  <td style="max-width:220px;">${esc(r.action)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="policy-note">
          ⚠️ Không tự động phạt, cảnh cáo hoặc cho nghỉ. Trường hợp <strong>Dưới chuẩn</strong>/<strong>Yếu</strong> phải qua giải trình,
          HCNS kiểm tra và người có thẩm quyền phê duyệt.
        </div>

        <!-- 3. Checklist 16 tiêu chí -->
        <div class="section-title">Checklist 16 tiêu chí</div>
        <div class="source-tag-row" id="eval-tabs" style="margin-bottom:10px;">
          ${EVAL_GROUPS.map((g, i) => `
            <button class="filter-chip eval-tab${i===0?' active':''}" data-group="${g.key}" type="button">${g.icon} ${esc(g.label)} · ${g.maxScore}đ</button>
          `).join('')}
        </div>
        ${EVAL_GROUPS.map(g => `
          <div class="eval-tab-panel" data-panel="${g.key}" style="${g.key===activeGroup?'':'display:none;'}">
            <div class="table-wrap" style="margin-bottom:8px;">
              <table>
                <thead><tr><th>Mã</th><th>Tiêu chí</th><th>Mô tả</th><th>Điểm</th><th>Thang tham chiếu</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  ${g.criteria.map(c => `
                    <tr>
                      <td><span class="badge badge-gray">${esc(c.code)}</span></td>
                      <td style="font-weight:600;white-space:normal;min-width:140px;">${esc(c.name)}</td>
                      <td style="white-space:normal;min-width:160px;color:var(--text-2);">${esc(c.desc)}</td>
                      <td><span class="badge" style="background:${g.color}1A;color:${g.color};">${c.max}đ</span></td>
                      <td style="white-space:normal;min-width:180px;font-size:12px;color:var(--text-3);">${esc(c.scale)}</td>
                      <td style="white-space:normal;min-width:120px;font-size:12px;color:var(--text-3);">${esc(c.note) || '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}

        <!-- 4. Lưu ý -->
        <div class="section-title">Lưu ý</div>
        <ul style="margin:0 0 4px 18px;padding:0;font-size:13px;line-height:22px;color:var(--text-2);">
          <li>Áp dụng chung cho nhân viên chính thức và TTS.</li>
          <li>Phiếu cần nhân viên, người đánh giá và Ban Giám đốc xác nhận/phê duyệt.</li>
          <li>Điểm sau khi BGĐ duyệt và HCNS khóa là điểm chính thức.</li>
          <li>Phần quy định này chỉ hiển thị để tham khảo, không thể chỉnh sửa tại đây.</li>
        </ul>
      </div>
    </div>

    <div id="eval-workflow"></div>
  `;

  // Collapse/expand toggle
  const toggleBtn = document.getElementById('eval-toggle');
  const bodyEl = document.getElementById('eval-policy-body');
  toggleBtn.addEventListener('click', () => {
    const collapsed = bodyEl.classList.toggle('hidden');
    toggleBtn.textContent = collapsed ? 'Mở rộng' : 'Thu gọn';
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });

  // Checklist tabs
  document.querySelectorAll('.eval-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.eval-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.eval-tab-panel').forEach(p => {
        p.style.display = p.dataset.panel === btn.dataset.group ? '' : 'none';
      });
    });
  });

  // Workflow: assignment/scoring/approval — role-scoped, appended below the policy card
  const workflowEl = document.getElementById('eval-workflow');
  if (workflowEl) renderWorkflowSection(workflowEl, me);
}

// ════════════════════════════════════════════════
//  ROLE HELPERS (mirror server.js — HCNS/BGD are DEPARTMENTS, not roles)
// ════════════════════════════════════════════════
function isHr(u) { return u.role === 'admin' || u.department === 'Phòng HCNS'; }
function isCeo(u) { return u.role === 'admin' || u.department === 'Ban Giám Đốc'; }
function isTTSUser(u) { return u.lifecycle_status === 'Thực tập'; }

const STATUS_META = {
  DRAFT:                       { label: 'Nháp',                       cls: 'badge-gray' },
  MENTOR_REVIEW:               { label: 'Đang đánh giá',              cls: 'badge-info' },
  EMPLOYEE_REVISION_REQUESTED: { label: 'TTS yêu cầu điều chỉnh',     cls: 'badge-warning' },
  CEO_REVISION_REQUESTED:      { label: 'BGĐ yêu cầu đánh giá lại',   cls: 'badge-warning' },
  EMPLOYEE_CONFIRMATION:       { label: 'Chờ TTS xác nhận',           cls: 'badge-info' },
  PENDING_CEO_APPROVAL:        { label: 'Chờ TGĐ phê duyệt',          cls: 'badge-warning' },
  CEO_APPROVED:                { label: 'Đã phê duyệt',               cls: 'badge-success' },
  HR_RECEIVED:                 { label: 'HCNS đã tiếp nhận',          cls: 'badge-success' },
  LOCKED:                      { label: 'Đã khóa',                    cls: 'badge-gray' },
};
let evalAdminPage = 1;
let evalAssignedPage = 1;

function statusBadgeHtml(status) {
  const m = STATUS_META[status] || { label: status || '—', cls: 'badge-gray' };
  return `<span class="badge ${m.cls}">${esc(m.label)}</span>`;
}
// TTS-facing label — during the parallel review phase, distinguishes who has scored so far.
function ttsStatusLabel(ev) {
  if (!ev) return 'Chưa mở';
  const reviewish = ['MENTOR_REVIEW', 'EMPLOYEE_REVISION_REQUESTED', 'CEO_REVISION_REQUESTED'];
  if (reviewish.includes(ev.status)) {
    if (ev.status === 'EMPLOYEE_REVISION_REQUESTED' && !ev.mentor_submitted_at && !ev.department_submitted_at) return 'TTS yêu cầu điều chỉnh';
    if (ev.status === 'CEO_REVISION_REQUESTED' && !ev.mentor_submitted_at && !ev.department_submitted_at) return 'Chờ đánh giá lại (BGĐ trả về)';
    if (ev.mentor_submitted_at && !ev.department_submitted_at) return 'Mentor đã đánh giá';
    if (!ev.mentor_submitted_at && ev.department_submitted_at) return 'Trưởng phòng đã đánh giá';
    return 'Đang chờ đánh giá';
  }
  return (STATUS_META[ev.status] || {}).label || ev.status;
}
function ttsStatusBadge(ev) {
  const label = ttsStatusLabel(ev);
  const cls = ev && STATUS_META[ev.status] ? STATUS_META[ev.status].cls : 'badge-gray';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
function groupTotal(scores, group) { return group.criteria.reduce((s, c) => s + (Number((scores || {})[c.code]) || 0), 0); }
function grandTotal(scores) { return EVAL_GROUPS.reduce((s, g) => s + groupTotal(scores, g), 0); }
function ratingFor(total) { return EVAL_RATING_SCALE.find(r => total >= r.min && total <= r.max) || EVAL_RATING_SCALE[EVAL_RATING_SCALE.length - 1]; }
function withinPeriodWindow(ev) {
  if (!ev.period_start || !ev.period_end) return false;
  const t = new Date().toISOString().slice(0, 10);
  return t >= ev.period_start && t <= ev.period_end;
}

// ════════════════════════════════════════════════
//  WORKFLOW SECTION — role-scoped, rendered below the policy card
// ════════════════════════════════════════════════
async function renderWorkflowSection(el, me) {
  el.innerHTML = loadingHTML();
  const hr = isHr(me), ceo = isCeo(me);
  let evaluations = [], periods = [], basicUsers = [];
  try {
    const [evR, pR] = await Promise.all([api.getEvaluations(), api.getEvalPeriods()]);
    evaluations = evR.evaluations || [];
    periods = pR.periods || [];
    if (hr || ceo) basicUsers = (await api.getUsersBasic()).users || [];
  } catch (e) {
    el.innerHTML = `<div class="card">${emptyHTML('⚠️', 'Không thể tải dữ liệu đánh giá hiệu suất')}</div>`;
    return;
  }

  const latestPeriod = periods[0] || null;
  const sections = [];

  if (hr || ceo) sections.push(adminSectionHtml(periods, evaluations, basicUsers, latestPeriod));

  const assignedToMe = evaluations.filter(e => (e.mentor_id === me.id || e.department_head_id === me.id) && e.user_id !== me.id);
  if (assignedToMe.length) sections.push(assignedSectionHtml(assignedToMe));

  if (isTTSUser(me) && !hr && !ceo) {
    const own = evaluations.find(e => e.user_id === me.id) || null;
    sections.push(ttsSectionHtml(own));
  }

  if (!sections.length) { el.innerHTML = ''; return; }
  el.innerHTML = sections.join('');
  wireWorkflowHandlers(el, me, { evaluations, periods, basicUsers });
}

function adminSectionHtml(periods, evaluations, basicUsers, latestPeriod) {
  const ttsUsers = basicUsers.filter(u => u.lifecycle_status === 'Thực tập');
  const assignedUserIds = new Set(evaluations.filter(e => latestPeriod && e.period_id === latestPeriod.id).map(e => e.user_id));
  const unassigned = ttsUsers.filter(u => !assignedUserIds.has(u.id));

  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header">
      <div class="card-title">🗓️ Kỳ đánh giá hiệu suất</div>
      <button class="btn-secondary btn-sm" id="eval-period-new-btn">+ Mở kỳ mới</button>
    </div>
    ${latestPeriod ? `
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Kỳ gần nhất</div><div class="detail-val">Tháng ${latestPeriod.month}/${latestPeriod.year}</div></div>
        <div class="detail-item"><div class="detail-label">Thời gian</div><div class="detail-val">${esc(latestPeriod.start_date)} → ${esc(latestPeriod.end_date)}</div></div>
      </div>` : `<div style="font-size:13px;color:var(--text-3);padding:6px 0;">Chưa có kỳ đánh giá nào được mở.</div>`}
    <div id="eval-period-form-wrap" class="hidden" style="margin-top:10px;border-top:1px solid var(--divider);padding-top:10px;">
      <div class="input-row">
        <div class="field"><label>Tháng</label><input type="number" id="ep-month" min="1" max="12" value="${new Date().getMonth() + 1}"></div>
        <div class="field"><label>Năm</label><input type="number" id="ep-year" value="${new Date().getFullYear()}"></div>
      </div>
      <div class="input-row">
        <div class="field"><label>Ngày bắt đầu</label><input type="date" id="ep-start"></div>
        <div class="field"><label>Ngày kết thúc (5–7 ngày)</label><input type="date" id="ep-end"></div>
      </div>
      <button class="btn-primary btn-sm" id="ep-save">Lưu kỳ đánh giá</button>
    </div>
  </div>

  ${latestPeriod ? `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header"><div class="card-title">🧭 Phân công đánh giá — Tháng ${latestPeriod.month}/${latestPeriod.year}</div></div>
    ${unassigned.length ? `
      <div class="input-row">
        <div class="field"><label>TTS</label><select id="asg-tts"><option value="">-- Chọn TTS --</option>${unassigned.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select></div>
        <div class="field"><label>Mentor</label><select id="asg-mentor"><option value="">-- Chọn mentor --</option>${basicUsers.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Trưởng phòng</label><select id="asg-dept"><option value="">-- Chọn trưởng phòng --</option>${basicUsers.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select></div>
      <button class="btn-primary btn-sm" id="asg-save">Phân công</button>
    ` : `<div style="font-size:13px;color:var(--text-3);">Đã phân công cho tất cả TTS trong kỳ này.</div>`}
  </div>` : ''}

  <div class="card" style="margin-bottom:16px;">
    <div class="card-header"><div class="card-title">📑 Tất cả phiếu đánh giá</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>TTS</th><th>Kỳ</th><th>Mentor</th><th>Trưởng phòng</th><th>Trạng thái</th></tr></thead>
        <tbody>
          ${evaluations.length ? paginateRows(evaluations, evalAdminPage).rows.map(e => `
            <tr class="eval-row" data-id="${e.id}" style="cursor:pointer;">
              <td>${esc(e.user_name || '—')}</td>
              <td>${e.period_month || '—'}/${e.period_year || ''}</td>
              <td>${esc(e.mentor_name || '—')}</td>
              <td>${esc(e.department_head_name || '—')}</td>
              <td>${statusBadgeHtml(e.status)}</td>
            </tr>
          `).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text-3);">Chưa có phiếu đánh giá nào</td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="eval-admin-pagination">${paginationHTML(paginateRows(evaluations, evalAdminPage))}</div>
  </div>`;
}

function assignedSectionHtml(list) {
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header"><div class="card-title">📋 Đánh giá được phân công</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>TTS</th><th>Mã NV</th><th>Phòng ban</th><th>Vị trí</th><th>Kỳ</th><th>Thời hạn</th><th>Trạng thái</th></tr></thead>
        <tbody>
          ${paginateRows(list, evalAssignedPage).rows.map(e => `
            <tr class="eval-row" data-id="${e.id}" style="cursor:pointer;">
              <td>${esc(e.user_name || '—')}</td>
              <td>${esc(e.user_code || '—')}</td>
              <td>${esc(e.user_department || '—')}</td>
              <td>${esc(e.user_position || '—')}</td>
              <td>${e.period_month || '—'}/${e.period_year || ''}</td>
              <td style="font-size:12px;">${esc(e.period_start || '')} → ${esc(e.period_end || '')}</td>
              <td>${statusBadgeHtml(e.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div id="eval-assigned-pagination">${paginationHTML(paginateRows(list, evalAssignedPage))}</div>
  </div>`;
}

function ttsSectionHtml(ev) {
  const daysLeft = ev && ev.period_end ? Math.ceil((new Date(ev.period_end) - new Date()) / 86400000) : null;
  return `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header"><div class="card-title">📈 Đánh giá hiệu suất tháng</div></div>
    ${ev ? `
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Tháng đánh giá</div><div class="detail-val">${ev.period_month}/${ev.period_year}</div></div>
        <div class="detail-item"><div class="detail-label">Thời gian</div><div class="detail-val">${esc(ev.period_start || '')} → ${esc(ev.period_end || '')}</div></div>
        <div class="detail-item"><div class="detail-label">Còn lại</div><div class="detail-val">${daysLeft != null ? (daysLeft >= 0 ? daysLeft + ' ngày' : 'Đã kết thúc') : '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Mentor</div><div class="detail-val">${esc(ev.mentor_name || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Trưởng phòng</div><div class="detail-val">${esc(ev.department_head_name || '—')}</div></div>
        <div class="detail-item"><div class="detail-label">Trạng thái</div><div class="detail-val">${ttsStatusBadge(ev)}</div></div>
      </div>
      <button class="btn-primary btn-sm" style="margin-top:10px;" id="tts-eval-view">Xem phiếu đánh giá</button>
    ` : `<div style="font-size:13px;color:var(--text-3);padding:6px 0;">Chưa mở kỳ đánh giá cho tháng này.</div>`}
  </div>`;
}

function wireWorkflowHandlers(el, me, ctx) {
  const refresh = () => renderWorkflowSection(el, me);
  bindPagination(document.getElementById('eval-admin-pagination'), page => { evalAdminPage = page; refresh(); });
  bindPagination(document.getElementById('eval-assigned-pagination'), page => { evalAssignedPage = page; refresh(); });

  document.getElementById('eval-period-new-btn')?.addEventListener('click', () => {
    document.getElementById('eval-period-form-wrap')?.classList.toggle('hidden');
  });

  document.getElementById('ep-save')?.addEventListener('click', async () => {
    const month = parseInt(document.getElementById('ep-month').value, 10);
    const year = parseInt(document.getElementById('ep-year').value, 10);
    const start = document.getElementById('ep-start').value;
    const end = document.getElementById('ep-end').value;
    if (!month || !year || !start || !end) { toast('Vui lòng nhập đầy đủ thông tin kỳ đánh giá', 'error'); return; }
    const btn = document.getElementById('ep-save');
    btn.disabled = true;
    try { await api.createEvalPeriod({ month, year, start_date: start, end_date: end }); toast('Đã mở kỳ đánh giá', 'success'); refresh(); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });

  document.getElementById('asg-save')?.addEventListener('click', async () => {
    const ttsId = document.getElementById('asg-tts').value;
    const mentorId = document.getElementById('asg-mentor').value;
    const deptId = document.getElementById('asg-dept').value;
    if (!ttsId || !mentorId || !deptId) { toast('Vui lòng chọn đầy đủ TTS, Mentor và Trưởng phòng', 'error'); return; }
    const latest = ctx.periods[0];
    const btn = document.getElementById('asg-save');
    btn.disabled = true;
    try {
      await api.assignEvaluation({ period_id: latest.id, user_id: parseInt(ttsId, 10), mentor_id: parseInt(mentorId, 10), department_head_id: parseInt(deptId, 10) });
      toast('Đã phân công đánh giá', 'success'); refresh();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });

  el.querySelectorAll('.eval-row').forEach(row => {
    row.addEventListener('click', () => openEvaluationDetail(parseInt(row.dataset.id, 10), me, refresh));
  });

  document.getElementById('tts-eval-view')?.addEventListener('click', () => {
    const own = ctx.evaluations.find(e => e.user_id === me.id);
    if (own) openEvaluationDetail(own.id, me, refresh);
  });
}

// ════════════════════════════════════════════════
//  DASHBOARD CARD (TTS) — reuses ttsSectionHtml + the same detail modal
// ════════════════════════════════════════════════
export async function renderEvalDashboardCard(el, me) {
  if (!isTTSUser(me)) { el.innerHTML = ''; return; }
  el.innerHTML = loadingHTML();
  try {
    const evR = await api.getEvaluations();
    const own = (evR.evaluations || []).find(e => e.user_id === me.id) || null;
    el.innerHTML = ttsSectionHtml(own);
    document.getElementById('tts-eval-view')?.addEventListener('click', () => {
      if (own) openEvaluationDetail(own.id, me, () => renderEvalDashboardCard(el, me));
    });
  } catch (e) {
    el.innerHTML = '';
  }
}

// ════════════════════════════════════════════════
//  DETAIL MODAL — criteria scoring (Mentor/Trưởng phòng), TTS confirm/revision,
//  TGĐ approval, HCNS receive/lock. Same modal for every role — actions shown
//  differ by role + current status (no free-choice status dropdown anywhere).
// ════════════════════════════════════════════════
export async function openEvaluationDetail(evalId, me, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  let data;
  try { data = await api.getEvaluation(evalId); }
  catch (e) { toast(e.message, 'error'); return; }
  renderEvalModal(data.evaluation, data.history || [], me, onRefresh);
}

function buildCriteriaTable(mentorScores, mentorComments, deptScores, deptComments, canEditMentor, canEditDept) {
  return EVAL_GROUPS.map(g => `
    <div class="section-title" style="margin-top:14px;">${g.icon} ${esc(g.label)} · ${g.maxScore}đ</div>
    <div class="table-wrap" style="margin-bottom:8px;">
      <table>
        <thead><tr>
          <th>Mã</th><th>Tiêu chí</th><th>Tối đa</th>
          <th>Điểm Mentor</th><th>NX Mentor</th>
          <th>Điểm Trưởng phòng</th><th>NX Trưởng phòng</th>
        </tr></thead>
        <tbody>
          ${g.criteria.map(c => `
            <tr>
              <td><span class="badge badge-gray">${esc(c.code)}</span></td>
              <td style="white-space:normal;min-width:140px;font-weight:600;">${esc(c.name)}</td>
              <td>${c.max}đ</td>
              <td style="min-width:60px;">${canEditMentor
                ? `<input type="number" class="ev-input" data-role="mentor" data-field="score" data-code="${c.code}" min="0" max="${c.max}" value="${mentorScores[c.code] ?? ''}" style="width:52px;">`
                : (mentorScores[c.code] !== undefined ? `<span class="badge" style="background:${g.color}1A;color:${g.color};">${esc(String(mentorScores[c.code]))}đ</span>` : '—')}
              </td>
              <td style="min-width:130px;">${canEditMentor
                ? `<input type="text" class="ev-input" data-role="mentor" data-field="comment" data-code="${c.code}" value="${esc(mentorComments[c.code] || '')}" placeholder="Nhận xét...">`
                : `<span style="font-size:12px;color:var(--text-2);">${esc(mentorComments[c.code] || '—')}</span>`}
              </td>
              <td style="min-width:60px;">${canEditDept
                ? `<input type="number" class="ev-input" data-role="dept" data-field="score" data-code="${c.code}" min="0" max="${c.max}" value="${deptScores[c.code] ?? ''}" style="width:52px;">`
                : (deptScores[c.code] !== undefined ? `<span class="badge" style="background:${g.color}1A;color:${g.color};">${esc(String(deptScores[c.code]))}đ</span>` : '—')}
              </td>
              <td style="min-width:130px;">${canEditDept
                ? `<input type="text" class="ev-input" data-role="dept" data-field="comment" data-code="${c.code}" value="${esc(deptComments[c.code] || '')}" placeholder="Nhận xét...">`
                : `<span style="font-size:12px;color:var(--text-2);">${esc(deptComments[c.code] || '—')}</span>`}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');
}

function statusHistoryLabel(status) { return (STATUS_META[status] || {}).label || status; }

function renderEvalModal(ev, history, me, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const isSelf = ev.user_id === me.id;
  const isMentor = ev.mentor_id === me.id;
  const isDept = ev.department_head_id === me.id;
  const hr = isHr(me), ceo = isCeo(me);

  const mentorScores = JSON.parse(ev.mentor_scores || '{}');
  const mentorComments = JSON.parse(ev.mentor_comments || '{}');
  const deptScores = JSON.parse(ev.department_scores || '{}');
  const deptComments = JSON.parse(ev.department_comments || '{}');

  const reviewStatuses = ['MENTOR_REVIEW', 'EMPLOYEE_REVISION_REQUESTED', 'CEO_REVISION_REQUESTED'];
  const inWindow = withinPeriodWindow(ev) || !!ev.window_override;
  const canEditMentor = isMentor && reviewStatuses.includes(ev.status) && !ev.mentor_submitted_at && inWindow;
  const canEditDept = isDept && reviewStatuses.includes(ev.status) && !ev.department_submitted_at && inWindow;
  const mentorReadyButBlocked = isMentor && reviewStatuses.includes(ev.status) && !ev.mentor_submitted_at && !inWindow;
  const deptReadyButBlocked = isDept && reviewStatuses.includes(ev.status) && !ev.department_submitted_at && !inWindow;

  const mentorTotal = grandTotal(mentorScores);
  const deptTotal = grandTotal(deptScores);
  const suggestedScore = ev.mentor_submitted_at && ev.department_submitted_at ? Math.round((mentorTotal + deptTotal) / 2) : (mentorTotal || deptTotal || 0);
  const finalRating = ev.final_approved_score != null ? ratingFor(ev.final_approved_score) : null;

  const body = `
    <div class="detail-grid" style="margin-bottom:6px;">
      <div class="detail-item"><div class="detail-label">TTS</div><div class="detail-val">${esc(ev.user_name || '—')}${ev.user_code ? ` <span style="font-weight:400;color:var(--text-3);">(${esc(ev.user_code)})</span>` : ''}</div></div>
      <div class="detail-item"><div class="detail-label">Phòng ban / Vị trí</div><div class="detail-val">${esc(ev.user_department || '—')} · ${esc(ev.user_position || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Mentor</div><div class="detail-val">${esc(ev.mentor_name || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Trưởng phòng</div><div class="detail-val">${esc(ev.department_head_name || '—')}</div></div>
      <div class="detail-item"><div class="detail-label">Kỳ đánh giá</div><div class="detail-val">${ev.period_month || '—'}/${ev.period_year || ''} (${esc(ev.period_start || '')} → ${esc(ev.period_end || '')})</div></div>
      <div class="detail-item"><div class="detail-label">Trạng thái</div><div class="detail-val">${isSelf && !hr && !ceo && !isMentor && !isDept ? ttsStatusBadge(ev) : statusBadgeHtml(ev.status)}</div></div>
    </div>

    ${ev.status === 'EMPLOYEE_REVISION_REQUESTED' && ev.employee_revision_reason ? `
      <div class="policy-note" style="border-left:3px solid var(--warning);">
        ⚠️ <strong>TTS yêu cầu xem xét lại:</strong> ${esc(ev.employee_revision_reason)}
        ${ev.employee_revision_evidence ? `<br>Minh chứng: <a href="${esc(ev.employee_revision_evidence)}" target="_blank" rel="noopener">${esc(ev.employee_revision_evidence)}</a>` : ''}
      </div>` : ''}
    ${ev.status === 'CEO_REVISION_REQUESTED' && ev.ceo_revision_reason ? `
      <div class="policy-note" style="border-left:3px solid var(--warning);">⚠️ <strong>Ban Giám đốc yêu cầu đánh giá lại:</strong> ${esc(ev.ceo_revision_reason)}</div>` : ''}
    ${(mentorReadyButBlocked || deptReadyButBlocked) ? `
      <div class="policy-note" style="border-left:3px solid var(--warning);">
        ⏰ Ngoài thời gian đánh giá của kỳ này (${esc(ev.period_start || '')} → ${esc(ev.period_end || '')}).
        ${hr || ceo ? `<button class="btn-secondary btn-sm" id="ev-reopen" style="margin-top:6px;">Mở lại để chấm điểm</button>` : 'Vui lòng liên hệ HCNS/Ban Giám đốc để được mở lại.'}
      </div>` : ''}

    ${buildCriteriaTable(mentorScores, mentorComments, deptScores, deptComments, canEditMentor, canEditDept)}

    <div class="detail-grid" style="margin-top:4px;">
      <div class="detail-item"><div class="detail-label">Tổng điểm Mentor</div><div class="detail-val" style="font-size:18px;font-weight:800;">${ev.mentor_submitted_at ? mentorTotal : '—'}</div></div>
      <div class="detail-item"><div class="detail-label">Tổng điểm Trưởng phòng</div><div class="detail-val" style="font-size:18px;font-weight:800;">${ev.department_submitted_at ? deptTotal : '—'}</div></div>
    </div>

    ${['PENDING_CEO_APPROVAL', 'CEO_APPROVED', 'HR_RECEIVED', 'LOCKED'].includes(ev.status) ? `
      <div class="section-title">Điểm cuối cùng (TGĐ phê duyệt)</div>
      <div class="field">
        <label>Tổng điểm chính thức</label>
        ${ceo && ev.status === 'PENDING_CEO_APPROVAL'
          ? `<input type="number" id="ev-final-score" min="0" max="100" value="${suggestedScore}" data-initial="${suggestedScore}">`
          : `<div class="detail-val" style="font-size:22px;font-weight:800;color:var(--primary);">${ev.final_approved_score != null ? ev.final_approved_score : '—'}${finalRating ? ` <span class="badge ${finalRating.badge}">${esc(finalRating.label)}</span>` : ''}</div>`}
      </div>
      ${ceo && ev.status === 'PENDING_CEO_APPROVAL' ? `
        <div class="field"><label>Nhận xét của TGĐ</label><textarea id="ev-final-comment" rows="2">${esc(ev.final_approved_comment || '')}</textarea></div>
        <div class="field" id="ev-adjust-wrap" style="display:none;"><label>Lý do điều chỉnh điểm *</label><textarea id="ev-adjust-reason" rows="2" placeholder="Bắt buộc nếu thay đổi điểm gợi ý"></textarea></div>
      ` : (ev.final_approved_comment ? `<div class="field"><label>Nhận xét của TGĐ</label><div class="detail-val" style="font-weight:400;">${esc(ev.final_approved_comment)}</div></div>` : '')}
      ${ev.final_adjust_reason ? `<div class="policy-note">Điểm đã điều chỉnh từ <strong>${esc(String(ev.final_score_before_adjust))}</strong> → <strong>${esc(String(ev.final_approved_score))}</strong>. Lý do: ${esc(ev.final_adjust_reason)}</div>` : ''}
    ` : ''}

    ${ev.status === 'EMPLOYEE_CONFIRMATION' && isSelf ? `
      <div class="field" id="ev-revision-wrap" style="display:none;">
        <label>Lý do yêu cầu xem xét lại *</label>
        <textarea id="ev-revision-reason" rows="2"></textarea>
        <label style="margin-top:8px;">Link minh chứng (nếu có)</label>
        <input type="text" id="ev-revision-evidence" placeholder="https://...">
      </div>
    ` : ''}

    <div class="section-title">Lịch sử xử lý</div>
    ${history.length ? history.map(h => `
      <div class="list-item" style="cursor:default;">
        <div class="list-item-content">
          <div class="list-item-title">${esc(statusHistoryLabel(h.to_status))}</div>
          <div class="list-item-sub">${esc(h.changed_by_name || '—')} · ${fmtDateTime(h.created_at)}${h.note ? ' · ' + esc(h.note) : ''}</div>
        </div>
      </div>
    `).join('') : emptyHTML('🕒', 'Chưa có lịch sử xử lý')}
  `;

  const footer = [];
  footer.push(`<button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>`);
  if (canEditMentor) { footer.push(`<button class="btn-secondary" id="ev-mentor-draft">Lưu nháp</button>`); footer.push(`<button class="btn-primary" id="ev-mentor-submit">Gửi đánh giá</button>`); }
  if (canEditDept) { footer.push(`<button class="btn-secondary" id="ev-dept-draft">Lưu nháp</button>`); footer.push(`<button class="btn-primary" id="ev-dept-submit">Gửi đánh giá</button>`); }
  if (ev.status === 'EMPLOYEE_CONFIRMATION' && isSelf) { footer.push(`<button class="btn-secondary" id="ev-request-revision">Yêu cầu xem xét lại</button>`); footer.push(`<button class="btn-primary" id="ev-confirm">Xác nhận kết quả</button>`); }
  if (ev.status === 'PENDING_CEO_APPROVAL' && ceo) { footer.push(`<button class="btn-secondary" id="ev-ceo-revision">Trả lại để đánh giá lại</button>`); footer.push(`<button class="btn-primary" id="ev-ceo-approve">Phê duyệt</button>`); }
  if (ev.status === 'CEO_APPROVED' && hr) footer.push(`<button class="btn-primary" id="ev-hr-receive">Tiếp nhận</button>`);
  if (ev.status === 'HR_RECEIVED' && hr) footer.push(`<button class="btn-primary" id="ev-hr-lock">Khóa phiếu</button>`);

  openModal(`Phiếu đánh giá — ${ev.user_name || ''}`, body, footer.join(''));
  document.getElementById('modal')?.classList.add('modal--scroll-fixed');

  function collect(role) {
    const scores = {}, comments = {};
    document.querySelectorAll(`.ev-input[data-role="${role}"][data-field="score"]`).forEach(inp => { if (inp.value !== '') scores[inp.dataset.code] = Number(inp.value); });
    document.querySelectorAll(`.ev-input[data-role="${role}"][data-field="comment"]`).forEach(inp => { if (inp.value.trim()) comments[inp.dataset.code] = inp.value.trim(); });
    return { scores, comments };
  }
  async function runAction(action, extra, btn) {
    if (btn) btn.disabled = true;
    try { await api.evalAction(ev.id, { action, ...extra }); toast('Đã lưu', 'success'); closeModal(); onRefresh(); }
    catch (e) { toast(e.message, 'error'); if (btn) btn.disabled = false; }
  }

  document.getElementById('ev-reopen')?.addEventListener('click', (e) => runAction('hr_reopen', {}, e.currentTarget));
  document.getElementById('ev-mentor-draft')?.addEventListener('click', (e) => { const { scores, comments } = collect('mentor'); runAction('mentor_save_draft', { scores, comments }, e.currentTarget); });
  document.getElementById('ev-mentor-submit')?.addEventListener('click', (e) => { const { scores, comments } = collect('mentor'); runAction('mentor_submit', { scores, comments }, e.currentTarget); });
  document.getElementById('ev-dept-draft')?.addEventListener('click', (e) => { const { scores, comments } = collect('dept'); runAction('dept_save_draft', { scores, comments }, e.currentTarget); });
  document.getElementById('ev-dept-submit')?.addEventListener('click', (e) => { const { scores, comments } = collect('dept'); runAction('dept_submit', { scores, comments }, e.currentTarget); });

  document.getElementById('ev-confirm')?.addEventListener('click', (e) => runAction('employee_confirm', {}, e.currentTarget));
  document.getElementById('ev-request-revision')?.addEventListener('click', (e) => {
    const wrap = document.getElementById('ev-revision-wrap');
    if (wrap.style.display === 'none') { wrap.style.display = ''; return; }
    const reason = document.getElementById('ev-revision-reason').value.trim();
    if (!reason) { toast('Vui lòng nhập lý do yêu cầu xem xét lại', 'error'); return; }
    const evidence = document.getElementById('ev-revision-evidence').value.trim();
    runAction('employee_revision', { reason, evidence }, e.currentTarget);
  });

  document.getElementById('ev-final-score')?.addEventListener('input', (e) => {
    const initial = Number(e.target.dataset.initial);
    const wrap = document.getElementById('ev-adjust-wrap');
    if (wrap) wrap.style.display = Number(e.target.value) !== initial ? '' : 'none';
  });
  document.getElementById('ev-ceo-approve')?.addEventListener('click', (e) => {
    const scoreInput = document.getElementById('ev-final-score');
    const finalScore = Number(scoreInput.value);
    const initialScore = Number(scoreInput.dataset.initial);
    const finalComment = document.getElementById('ev-final-comment')?.value.trim() || '';
    const adjustReason = document.getElementById('ev-adjust-reason')?.value.trim() || '';
    if (Number.isNaN(finalScore) || finalScore < 0 || finalScore > 100) { toast('Điểm cuối cùng không hợp lệ (0–100)', 'error'); return; }
    if (finalScore !== initialScore && !adjustReason) { toast('Vui lòng nhập lý do điều chỉnh điểm', 'error'); return; }
    runAction('ceo_approve', { finalScore, initialScore, finalComment, adjustReason }, e.currentTarget);
  });
  document.getElementById('ev-ceo-revision')?.addEventListener('click', (e) => {
    const reason = prompt('Lý do trả lại để đánh giá lại:');
    if (reason === null) return;
    if (!reason.trim()) { toast('Vui lòng nhập lý do', 'error'); return; }
    runAction('ceo_revision', { reason: reason.trim() }, e.currentTarget);
  });

  document.getElementById('ev-hr-receive')?.addEventListener('click', (e) => runAction('hr_receive', {}, e.currentTarget));
  document.getElementById('ev-hr-lock')?.addEventListener('click', (e) => {
    if (!confirm('Khóa phiếu đánh giá này? Sau khi khóa, tất cả chỉ có thể xem.')) return;
    runAction('hr_lock', {}, e.currentTarget);
  });
}
