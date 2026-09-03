import { api } from '../api.js?v=20260811-penalty-policy-v3';
import { EventBus } from '../event-bus.js';
import { esc, fmtMoney, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, DEPARTMENTS, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination, avatarColor, initials, isHcnsDepartment, sortVietnameseNames, compareVietnameseNames } from '../utils.js?v=20260811-hr-access-v1';
import { payslipDetailHTML, hydratePayslipAttendance, preparePayslipModal } from './payslip-detail.js?v=20260804-inline-line-notes-v1';
import { icon } from '../icons.js';

function formatMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return month || '';
  const [year, mm] = month.split('-');
  return `${mm}/${year}`;
}

function payrollStatusBadge(p) {
  const status = p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config');
  return status === 'missing_salary_config'
    ? '<span class="payroll-badge payroll-badge--warn"><span class="payroll-badge-dot"></span><span>Thiếu cấu hình lương</span></span>'
    : '<span class="payroll-badge payroll-badge--ok"><span class="payroll-badge-dot"></span><span>Đủ dữ liệu</span></span>';
}

function payrollReady(p) {
  return (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready';
}

function payrollMoney(value, ready) {
  const n = Number(value || 0);
  // Always show non-zero amounts (e.g. deductions applied via adjustments)
  // even when the payroll row is missing salary config.
  if (n === 0) return '—';
  return fmtMoney(n);
}

function getDeptIcon(deptName) {
  const name = String(deptName || '').toLowerCase();
  if (name.includes('marketing') || name.includes('truyền thông')) return icon('megaphone', 'xs');
  if (name.includes('biên tập') || name.includes('nội dung') || name.includes('content')) return icon('squarePen', 'xs');
  if (name.includes('hcns') || name.includes('nhân sự') || name.includes('hành chính')) return icon('users', 'xs');
  if (name.includes('kế toán') || name.includes('tài chính')) return icon('banknote', 'xs');
  if (name.includes('tạp vụ') || name.includes('bảo vệ')) return icon('shield', 'xs');
  if (name.includes('kỹ thuật') || name.includes('it') || name.includes('dev')) return icon('wifi', 'xs');
  if (name.includes('sản xuất') || name.includes('phim') || name.includes('gameshow') || name.includes('game')) return icon('activity', 'xs');
  if (name.includes('thực tập sinh') || name.includes('tts')) return icon('bookOpen', 'xs');
  if (name.includes('giám đốc') || name.includes('bgd') || name.includes('ban giám đốc')) return icon('trophy', 'xs');
  return icon('building2', 'xs');
}

function renderDonutChartSVG(slices, centerTitle, centerVal) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, Number(s.value || 0)), 0);
  const size = 160;
  const radius = 58;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius; // ~364.42

  if (total <= 0) {
    return `
      <svg viewBox="0 0 ${size} ${size}" class="payroll-donut-svg">
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="#E2E8F0" stroke-width="${strokeWidth}" fill="none" />
      </svg>
      <div class="payroll-donut-center">
        <span class="payroll-donut-center-label">${esc(centerTitle)}</span>
        <span class="payroll-donut-center-val" style="color:var(--text-3);font-size:12px;">0</span>
      </div>
    `;
  }

  let accumulatedOffset = 0;
  const circles = slices.filter(s => Number(s.value) > 0).map(slice => {
    const fraction = Number(slice.value) / total;
    const strokeDash = fraction * circumference;
    const gap = circumference - strokeDash;
    const offset = -accumulatedOffset;
    accumulatedOffset += strokeDash;
    return `<circle class="payroll-donut-segment" cx="${size/2}" cy="${size/2}" r="${radius}" stroke="${slice.color}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" fill="none" data-label="${esc(slice.label)}" title="${esc(slice.label)}: ${slice.formattedValue || slice.value} (${(fraction * 100).toFixed(1)}%)"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${size} ${size}" class="payroll-donut-svg">
      ${circles}
    </svg>
    <div class="payroll-donut-center">
      <span class="payroll-donut-center-label">${esc(centerTitle)}</span>
      <span class="payroll-donut-center-val">${esc(centerVal)}</span>
    </div>
  `;
}

// Memoize row HTML per row signature so editing one row doesn't re-render all rows.
const payrollRowCache = new Map();
function payrollRowHTML(p) {
  const ready = payrollReady(p);
  const net = (p.base_salary || 0) + (p.kpi_bonus || 0) + (p.allowance || 0) - (p.deduction || 0);
  const sig = [p.id, p.employee_name, p.employee_code, p.department, p.base_salary, p.kpi_bonus, p.allowance, p.deduction, p.data_status, ready].join('|');
  const cached = payrollRowCache.get(p.id);
  if (cached && cached.sig === sig) return cached.html;
  const color = avatarColor(p.employee_name || '?');
  const ini = initials(p.employee_name || '?');
  const html = `
    <tr class="payroll-row" data-pid="${p.id}" tabindex="0" role="button" aria-label="Mở phiếu lương của ${esc(p.employee_name || 'nhân viên')}">
      <td class="payroll-col-employee" data-label="Nhân viên">
        <div class="payroll-employee">
          <span class="payroll-avatar" style="background:${color};">${ini}</span>
          <div class="payroll-employee-main">
            <div class="payroll-employee-name">${esc(p.employee_name || '—')}</div>
            <div class="payroll-employee-code">${esc(p.employee_code || '')}</div>
            ${payrollStatusBadge(p)}
          </div>
        </div>
      </td>
      <td class="payroll-col-dept" data-label="Phòng ban"><span class="payroll-dept">${esc(p.department || '—')}</span></td>
      <td class="payroll-col-money" data-label="Lương CB">${payrollMoney(p.base_salary, ready)}</td>
      <td class="payroll-col-money payroll-col-net" data-label="Thực lĩnh">${payrollMoney(net, ready)}</td>
    </tr>
  `;
  payrollRowCache.set(p.id, { sig, html });
  if (payrollRowCache.size > 500) payrollRowCache.delete(payrollRowCache.keys().next().value);
  return html;
}

export async function renderPayroll(el, me) {
  const isHr = me.role === 'admin' || me.role === 'manager' || isHcnsDepartment(me.department);
  const canEditPayroll = me.role === 'admin' || isHcnsDepartment(me.department);
  if (!isHr) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('lock', 'lg')}</div><div class="empty-text">Không có quyền truy cập</div></div>`;
    return;
  }

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let adjustmentData = { suggestions: [], approved: [] };
  let adjustmentPage = 1;
  let selectedAdjustmentRefs = new Set();
  const adjustmentAmounts = new Map();
  let latestPayrollRows = [];
  let currentPage = 1;

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:18px;">
      <div class="payroll-header-title-wrap">
        <div class="payroll-title-icon-badge">${icon('banknote', 'lg')}</div>
        <div>
          <h1 class="page-title">Bảng lương</h1>
          <p class="page-sub">Quản lý lương, quỹ phòng ban, chuyên cần và phát hành phiếu lương</p>
        </div>
      </div>
    </div>

    <!-- Month Picker & Action Controls -->
    <div class="payroll-control-bar">
      <div class="payroll-control-left">
        <div class="payroll-month-wrap">
          <span style="color:var(--text-3);display:flex;align-items:center;">${icon('calendarDays', 'xs')}</span>
          <span class="payroll-month-label">Kỳ lương:</span>
          <input type="month" id="payroll-month" class="payroll-month-input" value="${curMonth}"/>
        </div>
      </div>
      <div class="payroll-control-right">
        ${canEditPayroll ? `<button id="btn-sync-payroll" class="btn-secondary btn-sm">${icon('refreshCw', 'sm')} <span>Đồng bộ / Tạo bảng lương</span></button>` : ''}
        <button id="btn-export-payslips" class="btn-primary btn-sm">${icon('fileText', 'sm')} <span>Xuất phiếu lương tháng ${formatMonth(curMonth)}</span></button>
      </div>
    </div>
    <div id="payroll-load-status" class="payroll-status-note"></div>

    <!-- Interactive Charts Grid (Dumbbell Chart, Budget by Dept & Attendance Breakdown) -->
    <div id="payroll-charts-container" class="payroll-charts-grid">
      <div class="payroll-chart-card payroll-dumbbell-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;">Đang tính toán so sánh % Nhân sự ↔ % Quỹ lương...</div>
      <div class="payroll-chart-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;">Đang tính toán phân bổ ngân sách...</div>
      <div class="payroll-chart-card" style="min-height:220px;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;">Đang tính toán cơ cấu chấm công...</div>
    </div>

    <!-- Adjustments Suggestion Panel -->
    <div id="payroll-adjustments"></div>

    <!-- Filter Card Box -->
    <div class="payroll-filter-card">
      <div class="payroll-search-wrap" style="flex:1;min-width:240px;">
        <span class="payroll-search-icon">${icon('search', 'sm')}</span>
        <input type="text" id="payroll-search" class="payroll-search-input" placeholder="Tìm theo tên nhân viên, mã nhân viên..."/>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <select id="payroll-dept-filter" class="payroll-dept-select" style="min-width:180px;">
          <option value="">Tất cả phòng ban</option>
          ${DEPARTMENTS.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
        </select>
        <div id="payroll-filter-count" style="font-size:12px;font-weight:700;color:var(--text-2);padding:7px 12px;background:#F8FAFC;border:1px solid var(--border);border-radius:var(--radius-sm);white-space:nowrap;"></div>
      </div>
    </div>

    <!-- Main Payroll Data Table -->
    <div class="payroll-table-card">
      <div id="payroll-table">${loadingHTML()}</div>
    </div>
  `;

  const monthInput = document.getElementById('payroll-month');
  document.getElementById('btn-export-payslips').addEventListener('click', openExportPayslipsConfirm);
  document.getElementById('btn-sync-payroll')?.addEventListener('click', openCreatePayrollBatchConfirm);
  monthInput.addEventListener('change', () => {
    currentPage = 1;
    updateExportButtonLabel();
    loadPayroll();
  });
  document.getElementById('payroll-search').addEventListener('input', () => { currentPage = 1; loadPayroll(); });
  document.getElementById('payroll-dept-filter').addEventListener('change', () => { currentPage = 1; loadPayroll(); });

  function adjustmentSourceLabel(source) {
    const map = { evaluation: 'Đánh giá', attendance: 'Chấm công', tasks: 'Deadline', manual: 'Thủ công' };
    return map[source] || source || 'Nguồn';
  }

  function adjustmentTypeLabel(type) {
    const map = {
      bonus: 'Thưởng tiền',
      penalty: 'Phạt tiền',
      score_bonus: 'Cộng điểm',
      score_penalty: 'Trừ điểm',
      alert: 'Cảnh báo',
    };
    return map[type] || type || 'Đề xuất';
  }

  // Legacy rows may still contain the date in their saved reason. The date is
  // now presented in its own column, so keep the reason concise on screen.
  function adjustmentReason(reason) {
    return String(reason || '')
      .replace(/\s+ngày\s+\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/\s+trong\s+\d{4}-\d{2}/gi, '');
  }

  function updateExportButtonLabel() {
    const btn = document.getElementById('btn-export-payslips');
    if (btn) btn.textContent = `Xuất phiếu lương tháng ${formatMonth(monthInput.value)}`;
  }

  function approvedAdjustmentTone(a) {
    if (a.type === 'penalty') return { color: 'var(--danger)', bg: '#FEF2F2', border: '#FECACA', sign: '-' };
    if (a.type === 'bonus') return { color: 'var(--success)', bg: '#ECFDF5', border: '#A7F3D0', sign: '+' };
    return { color: 'var(--text-2)', bg: '#F8FAFC', border: 'var(--border)', sign: '' };
  }

  function renderAdjustmentPanel(month) {
    const el = document.getElementById('payroll-adjustments');
    if (!el) return;
    const suggestions = adjustmentData.suggestions || [];
    const approved = adjustmentData.approved || [];
    const pageData = paginateRows(suggestions, adjustmentPage, 10);
    adjustmentPage = pageData.page;
    const totalSuggestedBonus = suggestions.filter(x => x.type === 'bonus').reduce((s, x) => s + Number(x.amount || 0), 0);
    const totalSuggestedPenalty = suggestions.filter(x => x.type === 'penalty').reduce((s, x) => s + Number(x.amount || 0), 0);
    el.innerHTML = `
      <div class="payroll-adjustments-card">
        <div class="payroll-adjustments-header">
          <div>
            <div class="payroll-adjustments-title">Đề xuất thưởng-phạt tháng ${formatMonth(month)}</div>
            <div class="payroll-adjustments-sub">Tự động gợi ý từ đánh giá đã khóa, chấm công và deadline. HCNS xác nhận trước khi cộng/trừ lương.</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${canEditPayroll ? `
              <button class="btn-secondary btn-xs" id="payroll-adjust-manual">${icon('triangleAlert', 'xs')} <span>Phạt thủ công</span></button>
              <button class="btn-secondary btn-xs" id="payroll-policy-reset">${icon('settings', 'xs')} <span>Đổi quy định phạt</span></button>
            ` : ''}
            <button class="btn-secondary btn-xs" id="payroll-adjust-refresh">${icon('refreshCw', 'xs')} <span>Làm mới đề xuất</span></button>
          </div>
        </div>
        <div class="payroll-adjustments-kpis">
          <div class="payroll-adj-kpi-item">
            <span class="payroll-adj-kpi-label">Chưa áp dụng</span>
            <span class="payroll-adj-kpi-val">${suggestions.length}</span>
          </div>
          <div class="payroll-adj-kpi-item">
            <span class="payroll-adj-kpi-label">Thưởng đề xuất</span>
            <span class="payroll-adj-kpi-val" style="color:var(--success);">+${fmtMoney(totalSuggestedBonus)}</span>
          </div>
          <div class="payroll-adj-kpi-item">
            <span class="payroll-adj-kpi-label">Phạt đề xuất</span>
            <span class="payroll-adj-kpi-val" style="color:var(--danger);">-${fmtMoney(totalSuggestedPenalty)}</span>
          </div>
        </div>
        ${suggestions.length ? `
          <div class="table-wrap" style="border:none;border-radius:0;">
            <table>
              <thead><tr><th></th><th>Nhân viên</th><th>Nguồn</th><th>Loại</th><th>Ngày vi phạm</th><th>Tháng áp dụng</th><th>Số tiền</th><th>Điểm</th><th>Lý do</th>${canEditPayroll ? '<th style="text-align:right;">Thao tác</th>' : ''}</tr></thead>
              <tbody>
                ${pageData.rows.map(s => `
                  <tr>
                    <td><input type="checkbox" class="adj-check" data-ref="${esc(s.source_ref)}" ${s.can_apply === false ? 'disabled' : 'checked'} title="${s.can_apply === false ? 'Cần đồng bộ/tạo dòng bảng lương trước' : ''}"></td>
                    <td><strong>${esc(s.employee_name || '—')}</strong><br><span style="font-size:11px;font-family:monospace;color:var(--text-3);">${esc(s.employee_code || '')}</span></td>
                    <td><span class="badge badge-gray">${esc(adjustmentSourceLabel(s.source))}</span></td>
                    <td>${esc(adjustmentTypeLabel(s.type))}</td>
                    <td>${esc(s.violation_date || '—')}</td>
                    <td>${esc(s.policy_month || month)}</td>
                    <td>${s.amount > 0 ? `<input type="number" class="adj-amount" data-ref="${esc(s.source_ref)}" value="${Number(s.amount || 0)}" min="0" step="50000" style="width:120px;padding:4px 8px;border-radius:6px;" ${s.can_apply === false ? 'disabled' : ''}>` : '—'}</td>
                    <td>${s.score_delta ? (s.score_delta > 0 ? '+' : '') + s.score_delta : '—'}</td>
                    <td style="white-space:normal;min-width:220px;font-size:12px;color:var(--text-2);">${esc(adjustmentReason(s.reason))}${s.can_apply === false ? '<br><span style="color:var(--warning);font-weight:700;">Cần đồng bộ/tạo dòng bảng lương trước khi áp dụng tiền.</span>' : ''}</td>
                    ${canEditPayroll ? `<td style="text-align:right;"><button class="btn-secondary btn-xs adj-dismiss" data-ref="${esc(s.source_ref)}" style="color:var(--danger);border-color:rgba(239,68,68,0.25);">${icon('trash2', 'xs')} <span>Xóa</span></button></td>` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${paginationHTML(pageData)}
          <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;background:#FAFBFD;border-top:1px solid var(--border);">
            <button class="btn-primary btn-sm" id="payroll-adjust-apply">${icon('check', 'sm')} <span>Áp dụng đề xuất đã chọn</span></button>
          </div>
        ` : `<div style="padding:16px 20px;color:var(--text-2);font-size:13px;">Chưa có đề xuất mới. Các khoản mềm như sáng kiến/top tuần/báo cáo sẽ nhập thủ công khi có quyết định.</div>`}
        ${approved.length ? `
          <div style="padding:14px 20px 18px;border-top:1px solid var(--divider);">
            <div class="section-title" style="margin:0 0 10px;font-size:13px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.4px;">Đã áp dụng gần đây</div>
            <div style="display:grid;gap:8px;">
              ${approved.slice(0, 6).map(a => {
                const tone = approvedAdjustmentTone(a);
                const hasAmount = Number(a.amount || 0) > 0;
                return `
                  <div style="display:flex;justify-content:space-between;gap:12px;border:1px solid ${tone.border};background:${tone.bg};border-radius:10px;padding:10px 14px;font-size:12.5px;align-items:center;">
                    <span style="color:${tone.color};line-height:1.45;"><strong>${esc(a.employee_name || '—')}</strong> · ${esc(adjustmentSourceLabel(a.source))} · ${a.violation_date ? `Ngày ${esc(a.violation_date)} · ` : ''}Kỳ ${esc(a.policy_month || a.month || month)} · ${esc(adjustmentReason(a.reason))}</span>
                    <span style="white-space:nowrap;color:${tone.color};font-weight:800;font-variant-numeric:tabular-nums;">${hasAmount ? tone.sign + fmtMoney(a.amount) : (a.score_delta || 'audit')}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
    document.getElementById('payroll-adjust-refresh')?.addEventListener('click', () => loadPayroll({ keepStatus: true }));
    document.getElementById('payroll-adjust-manual')?.addEventListener('click', openManualPenalty);
    document.getElementById('payroll-policy-reset')?.addEventListener('click', openPenaltyPolicyReset);
    document.getElementById('payroll-adjust-apply')?.addEventListener('click', applySelectedAdjustments);
    el.querySelectorAll('.adj-check').forEach(check => {
      const ref = check.dataset.ref;
      check.checked = selectedAdjustmentRefs.has(ref);
      check.addEventListener('change', () => {
        if (check.checked) selectedAdjustmentRefs.add(ref);
        else selectedAdjustmentRefs.delete(ref);
      });
    });
    el.querySelectorAll('.adj-amount').forEach(input => {
      const ref = input.dataset.ref;
      if (adjustmentAmounts.has(ref)) input.value = adjustmentAmounts.get(ref);
      input.addEventListener('input', () => adjustmentAmounts.set(ref, Number(input.value || 0)));
    });
    el.querySelectorAll('.adj-dismiss').forEach(button => {
      button.addEventListener('click', async () => {
        const ref = button.dataset.ref;
        if (!ref || !window.confirm('Xóa đề xuất này? Dữ liệu chấm công/công việc gốc sẽ không bị xóa.')) return;
        button.disabled = true;
        try {
          await api.dismissPayrollAdjustment(month, ref);
          selectedAdjustmentRefs.delete(ref);
          adjustmentAmounts.delete(ref);
          toast('Đã xóa đề xuất; dữ liệu nguồn được giữ nguyên.', 'success');
          await loadPayroll({ keepStatus: true });
        } catch (error) {
          toast(error.message || 'Không thể xóa đề xuất', 'error');
          button.disabled = false;
        }
      });
    });
    bindPagination(el, page => {
      adjustmentPage = page;
      renderAdjustmentPanel(month);
    });
  }

  async function applySelectedAdjustments() {
    const month = monthInput.value;
    const selectedRefs = Array.from(selectedAdjustmentRefs);
    if (!selectedRefs.length) { toast('Chọn ít nhất một đề xuất để áp dụng', 'error'); return; }
    const items = selectedRefs.map(ref => {
      const s = adjustmentData.suggestions.find(x => x.source_ref === ref);
      return { source_ref: ref, amount: adjustmentAmounts.has(ref) ? adjustmentAmounts.get(ref) : s?.amount };
    });
    const btn = document.getElementById('payroll-adjust-apply');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang áp dụng...'; }
    try {
      const r = await api.applyPayrollAdjustments(month, items);
      toast(`Đã áp dụng ${r.applied || 0} đề xuất${r.skipped ? `, bỏ qua ${r.skipped}` : ''}`, 'success', 5000);
      await loadPayroll({ keepStatus: true });
    } catch (e) {
      toast(e.message || 'Không áp dụng được đề xuất', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Áp dụng đề xuất đã chọn'; }
    }
  }

  function openManualPenalty() {
    const employees = latestPayrollRows.filter(row => row.employee_id).map(row => `<option value="${row.employee_id}" data-payroll-id="${row.id}">${esc(row.employee_name || '—')} · ${esc(row.employee_code || '')}</option>`).join('');
    if (!employees) return toast('Hãy tải bảng lương trước khi tạo phạt thủ công', 'error');
    openModal('Phạt điểm thủ công', `<div class="field"><label>Nhân sự *</label><select id="manual-penalty-employee"><option value="">Chọn nhân sự</option>${employees}</select></div>
      <div class="field"><label>Vi phạm *</label><select id="manual-penalty-kind"><option value="report">Không chủ động báo cáo — trừ 3 điểm</option><option value="progress">Quản lý phải hỏi tiến độ — trừ 5 điểm</option></select></div>
      <div class="field"><label>Ngày vi phạm</label><input id="manual-penalty-date" type="date" min="${monthInput.value}-01" max="${monthInput.value}-31"></div>
      <div class="field"><label>Ghi chú / căn cứ *</label><textarea id="manual-penalty-reason" rows="3" placeholder="Mô tả sự việc, thời điểm hoặc nguồn xác minh"></textarea></div>`, '<button class="btn-secondary" id="manual-penalty-cancel">Hủy</button><button class="btn-primary" id="manual-penalty-save">Áp dụng</button>');
    document.getElementById('manual-penalty-cancel')?.addEventListener('click', closeModal);
    document.getElementById('manual-penalty-save')?.addEventListener('click', async event => {
      const select = document.getElementById('manual-penalty-employee');
      const kind = document.getElementById('manual-penalty-kind')?.value;
      const violationDate = document.getElementById('manual-penalty-date')?.value || null;
      const reason = document.getElementById('manual-penalty-reason')?.value.trim() || '';
      const employeeId = Number(select?.value || 0);
      const payrollId = Number(select?.selectedOptions?.[0]?.dataset.payrollId || 0) || null;
      const scoreDelta = kind === 'progress' ? -5 : -3;
      if (!employeeId || !reason) return toast('Chọn nhân sự và nhập căn cứ áp dụng', 'error');
      event.currentTarget.disabled = true;
      try {
        await api.applyPayrollAdjustments(monthInput.value, [{ source: 'manual', employee_id: employeeId, payroll_id: payrollId, type: 'score_penalty', amount: 0, score_delta: scoreDelta, violation_date: violationDate, reason }]);
        closeModal();
        toast('Đã lưu phạt điểm thủ công kèm audit', 'success');
        await loadPayroll({ keepStatus: true });
      } catch (error) { toast(error.message || 'Không thể áp dụng phạt thủ công', 'error'); event.currentTarget.disabled = false; }
    });
  }

  async function openPenaltyPolicyReset() {
    try {
      const preview = await api.previewPenaltyPolicyReset();
      if (preview.conflicts?.length) {
        return toast(`Không thể dọn: ${preview.conflicts.length} dòng lương có deduction không khớp.`, 'error', 6000);
      }
      openModal('Cập nhật quy định phạt từ 08/2026', `<div style="display:grid;gap:9px;line-height:1.45;">
        <div class="detail-item"><div class="detail-label">Row phạt sẽ xóa</div><div class="detail-val">${Number(preview.adjustment_count || 0)}</div></div>
        <div class="detail-item"><div class="detail-label">Hoàn deduction / lương</div><div class="detail-val" style="color:var(--success);">${fmtMoney(preview.total_payroll_refund || 0)}</div></div>
        <div class="detail-item"><div class="detail-label">Dòng lương được cập nhật</div><div class="detail-val">${Number(preview.payroll_rows_to_refund || 0)}</div></div>
        <div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;border-radius:8px;padding:10px;font-size:12px;">Thao tác xóa toàn bộ adjustment loại phạt/trừ điểm cũ, hoàn lương tương ứng và ghi audit. Không xóa bảng lương, attendance hay đánh giá.</div>
      </div>`, '<button class="btn-secondary" id="penalty-reset-cancel">Hủy</button><button class="btn-primary" id="penalty-reset-confirm">Xác nhận cập nhật</button>');
      document.getElementById('penalty-reset-cancel')?.addEventListener('click', closeModal);
      document.getElementById('penalty-reset-confirm')?.addEventListener('click', async event => {
        event.currentTarget.disabled = true;
        try {
          const result = await api.resetPenaltyPolicy();
          closeModal();
          toast(`Đã xóa ${result.adjustment_count || 0} row phạt và hoàn ${fmtMoney(result.total_payroll_refund || 0)}.`, 'success', 6000);
          await loadPayroll({ keepStatus: true });
        } catch (error) { toast(error.message || 'Không thể cập nhật quy định phạt', 'error'); event.currentTarget.disabled = false; }
      });
    } catch (error) { toast(error.message || 'Không tải được thống kê dọn dữ liệu', 'error'); }
  }

  async function openCreatePayrollBatchConfirm() {
    const month = monthInput.value;
    if (!month) {
      toast('Vui lòng chọn tháng/năm trước khi tạo bảng lương', 'error');
      return;
    }
    const readyRows = latestPayrollRows.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready').length;
    const missingRows = latestPayrollRows.length - readyRows;

    openModal(`Tạo bảng lương tháng ${formatMonth(month)}`, `
      <div style="display:grid;gap:10px;">
        <div class="detail-item"><div class="detail-label">Dòng lương hiện có</div><div class="detail-val">${latestPayrollRows.length}</div></div>
        <div class="detail-item"><div class="detail-label">Đủ dữ liệu hiện tại</div><div class="detail-val">${readyRows}</div></div>
        <div class="detail-item"><div class="detail-label">Thiếu cấu hình hiện tại</div><div class="detail-val">${missingRows}</div></div>
        <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
          Hệ thống sẽ tạo hoặc cập nhật bảng lương tháng này từ danh sách nhân sự đang hoạt động. Các khoản thưởng/phạt đã áp dụng trên dòng lương hiện có vẫn được giữ lại.
        </div>
      </div>
    `, `
      <button class="btn-secondary" id="payroll-batch-cancel">Hủy</button>
      <button class="btn-primary" id="payroll-batch-create">Tạo bảng lương</button>
    `);

    document.getElementById('payroll-batch-cancel').addEventListener('click', closeModal);
    document.getElementById('payroll-batch-create').addEventListener('click', async () => {
      const btn = document.getElementById('payroll-batch-create');
      btn.disabled = true;
      btn.textContent = 'Đang tạo...';
      try {
        const r = await api.createPayrollBatch(month);
        closeModal();
        toast(`Đã tạo/cập nhật bảng lương tháng ${formatMonth(month)}: tạo mới ${r.created || 0}, cập nhật ${r.updated || 0}.`, 'success', 5000);
        await loadPayroll();
      } catch (e) {
        toast(e.message || 'Không tạo được bảng lương', e.status === 409 ? 'info' : 'error', 5000);
        btn.disabled = false;
        btn.textContent = 'Tạo bảng lương';
      }
    });
  }

  function openExportPayslipsConfirm() {
    const month = monthInput.value;
    const rows = latestPayrollRows || [];
    if (!month) { toast('Vui lòng chọn tháng/năm trước khi xuất phiếu lương', 'error'); return; }
    if (!rows.length) { toast('Chưa có dữ liệu bảng lương để xuất phiếu', 'error'); return; }
    const readyRows = rows.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready' && Number(p.base_salary || 0) > 0);
    const missingRows = rows.length - readyRows.length;
    openModal(`Xuất phiếu lương tháng ${formatMonth(month)}`, `
      <div style="display:grid;gap:12px;">
        <div class="detail-grid">
          <div class="detail-item"><div class="detail-label">Tổng dòng lương</div><div class="detail-val">${rows.length}</div></div>
          <div class="detail-item"><div class="detail-label">Sẵn sàng phát hành</div><div class="detail-val" style="color:var(--success);">${readyRows.length}</div></div>
          <div class="detail-item"><div class="detail-label">Sẽ bỏ qua</div><div class="detail-val" style="color:var(--danger);">${missingRows}</div></div>
        </div>
        <div style="background:#FFF7ED;border:1px solid #FDBA74;color:#9A3412;border-radius:8px;padding:12px;font-size:13px;line-height:1.5;">
          Thao tác này sẽ phát hành phiếu lương vào mục Phiếu lương của từng nhân viên. Phiếu đã trả, đã khóa hoặc đã được nhân viên xác nhận sẽ không bị ghi đè.
        </div>
        <div class="field">
          <label>Gõ <strong>xuatphieuluong</strong> hoặc <strong>XUATPHIEULUONG</strong> để xác nhận</label>
          <input id="export-payslip-confirm" type="text" autocomplete="off" placeholder="xuatphieuluong"/>
        </div>
        <div id="export-payslip-result" style="font-size:12px;color:var(--text-2);min-height:18px;"></div>
      </div>
    `, `
      <button class="btn-secondary" id="export-payslip-cancel">Hủy</button>
      <button class="btn-primary" id="export-payslip-submit" disabled>Xuất phiếu lương</button>
    `);
    const input = document.getElementById('export-payslip-confirm');
    const btn = document.getElementById('export-payslip-submit');
    const isConfirmed = () => (input?.value || '').trim().toLowerCase() === 'xuatphieuluong';
    document.getElementById('export-payslip-cancel')?.addEventListener('click', closeModal);
    input?.addEventListener('input', () => { if (btn) btn.disabled = !isConfirmed(); });
    btn?.addEventListener('click', async () => {
      const result = document.getElementById('export-payslip-result');
      btn.disabled = true;
      btn.textContent = 'Đang xuất...';
      if (result) result.textContent = 'Đang phát hành phiếu lương...';
      try {
        const r = await api.exportPayslips(month, input.value.trim().toLowerCase());
        closeModal();
        toast(`Đã xuất phiếu: tạo mới ${r.created || 0}, cập nhật ${r.updated || 0}, bỏ qua ${r.skipped || 0}.`, 'success', 6000);
        await loadPayroll({ keepStatus: true });
      } catch (e) {
        if (result) result.textContent = e.message || 'Không xuất được phiếu lương';
        toast(e.message || 'Không xuất được phiếu lương', 'error');
        btn.disabled = !isConfirmed();
        btn.textContent = 'Xuất phiếu lương';
      }
    });
  }

  async function loadPayroll(options = {}) {
    const tableEl = document.getElementById('payroll-table');
    const sumEl = document.getElementById('payroll-summary');
    const statusEl = document.getElementById('payroll-load-status');
    if (!tableEl) return;
    tableEl.innerHTML = loadingHTML();
    if (statusEl && !options.keepStatus) statusEl.textContent = 'Đang tải dữ liệu bảng lương...';
    const month = monthInput.value;
    try {
      const payrollRes = await api.getPayroll({ month });
      const payrolls = payrollRes.payroll || [];
      latestPayrollRows = payrolls;
      try {
        adjustmentData = await api.getPayrollAdjustmentSuggestions(month);
        adjustmentPage = 1;
        selectedAdjustmentRefs = new Set((adjustmentData.suggestions || []).filter(s => s.can_apply !== false).map(s => s.source_ref));
        adjustmentAmounts.clear();
      } catch (_) {
        adjustmentData = { suggestions: [], approved: [] };
        adjustmentPage = 1;
        selectedAdjustmentRefs = new Set();
        adjustmentAmounts.clear();
      }
      renderAdjustmentPanel(month);
      const totalBonus = payrolls.reduce((s, p) => s + (p.kpi_bonus || 0) + (p.allowance || 0), 0);
      const totalNet = payrolls.reduce((s, p) => s + (p.net_salary || 0), 0);
      const readyCount = payrolls.filter(p => (p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready').length;
      const missingSalaryCount = payrolls.length - readyCount;
      let filtered = filterBySearch(payrolls, document.getElementById('payroll-search')?.value || '', ['employee_name', 'employee_code']);
      filtered = filterByDepartment(filtered, document.getElementById('payroll-dept-filter')?.value || '', ['department']);
      filtered = sortVietnameseNames(filtered, 'employee_name');
      const pageData = paginateRows(filtered, currentPage);
      currentPage = pageData.page;

      const chartsEl = document.getElementById('payroll-charts-container');
      const countEl = document.getElementById('payroll-filter-count');
      if (countEl) {
        countEl.textContent = `Hiển thị ${filtered.length} / ${payrolls.length} nhân sự`;
      }

      if (chartsEl) {
        if (!payrolls.length) {
          chartsEl.style.display = 'none';
        } else {
          chartsEl.style.display = 'grid';

          // 1. Dumbbell Chart: So sánh % Nhân sự ↔ % Quỹ lương theo phòng ban
          const deptMap = new Map();
          let totalHeadcount = 0;
          let totalPayrollBudget = 0;

          payrolls.forEach(p => {
            const dept = p.department || 'Chưa phân loại';
            const net = (p.base_salary || 0) + (p.kpi_bonus || 0) + (p.allowance || 0) - (p.deduction || 0);
            if (!deptMap.has(dept)) {
              deptMap.set(dept, { count: 0, totalNet: 0 });
            }
            const entry = deptMap.get(dept);
            entry.count += 1;
            entry.totalNet += net;
            totalHeadcount += 1;
            totalPayrollBudget += net;
          });

          const dumbbellRows = Array.from(deptMap.entries()).map(([dept, data]) => {
            const empPct = totalHeadcount > 0 ? (data.count / totalHeadcount) * 100 : 0;
            const budgetPct = totalPayrollBudget > 0 ? (data.totalNet / totalPayrollBudget) * 100 : 0;
            const delta = budgetPct - empPct;
            const avgSalary = data.count > 0 ? data.totalNet / data.count : 0;
            return {
              dept,
              icon: getDeptIcon(dept),
              count: data.count,
              totalNet: data.totalNet,
              avgSalary,
              empPct,
              budgetPct,
              delta,
            };
          }).sort((a, b) => b.totalNet - a.totalNet);

          const rawMax = Math.max(...dumbbellRows.map(r => Math.max(r.empPct, r.budgetPct)), 25);
          const scaleMax = Math.min(100, Math.max(35, Math.ceil((rawMax * 1.25) / 5) * 5));

          const dumbbellRowsHTML = dumbbellRows.map(r => {
            const minVal = Math.min(r.empPct, r.budgetPct);
            const maxVal = Math.max(r.empPct, r.budgetPct);
            const leftPercent = (minVal / scaleMax) * 100;
            const widthPercent = Math.max(1.5, ((maxVal - minVal) / scaleMax) * 100);

            const empLeft = (r.empPct / scaleMax) * 100;
            const budgetLeft = (r.budgetPct / scaleMax) * 100;

            let barClass = 'bar-even';
            let deltaClass = 'delta-even';
            let deltaLabel = `${r.delta.toFixed(1)}%`;
            let tooltipNote = 'Mức chi trả tương xứng quy mô nhân sự';

            if (r.delta > 0.4) {
              barClass = 'bar-high';
              deltaClass = 'delta-high';
              deltaLabel = `+${r.delta.toFixed(1)}%`;
              tooltipNote = 'Lương bình quân cao hơn mặt bằng chung toàn công ty';
            } else if (r.delta < -0.4) {
              barClass = 'bar-low';
              deltaClass = 'delta-low';
              deltaLabel = `${r.delta.toFixed(1)}%`;
              tooltipNote = 'Lương bình quân thấp hơn mặt bằng chung toàn công ty';
            }

            return `
              <div class="payroll-dumbbell-row" data-filter-dept="${esc(r.dept)}" title="${esc(r.dept)}: ${tooltipNote}. Bấm để lọc bảng lương.">
                <div class="dumbbell-td dumbbell-td-dept">
                  <span class="dumbbell-dept-icon">${r.icon}</span>
                  <div class="dumbbell-dept-info">
                    <span class="dumbbell-dept-name">${esc(r.dept)}</span>
                    <span class="dumbbell-dept-meta">${r.count} nhân sự · TB: ${fmtMoney(r.avgSalary)}</span>
                  </div>
                </div>
                <div class="dumbbell-td dumbbell-td-visual">
                  <div class="dumbbell-track">
                    <div class="dumbbell-grid-marks">
                      <span class="dumbbell-mark" style="left: 0%"></span>
                      <span class="dumbbell-mark" style="left: 25%"></span>
                      <span class="dumbbell-mark" style="left: 50%"></span>
                      <span class="dumbbell-mark" style="left: 75%"></span>
                      <span class="dumbbell-mark" style="left: 100%"></span>
                    </div>
                    <div class="dumbbell-bar ${barClass}" style="left: ${leftPercent.toFixed(1)}%; width: ${widthPercent.toFixed(1)}%;"></div>
                    <div class="dumbbell-dot dumbbell-dot-emp" style="left: ${empLeft.toFixed(1)}%;" title="Nhân sự: ${r.empPct.toFixed(1)}% (${r.count} người)">
                      <span class="dumbbell-dot-badge">${icon('user', 'xs')} ${r.empPct.toFixed(1)}%</span>
                    </div>
                    <div class="dumbbell-dot dumbbell-dot-budget" style="left: ${budgetLeft.toFixed(1)}%;" title="Quỹ lương: ${r.budgetPct.toFixed(1)}% (${fmtMoney(r.totalNet)})">
                      <span class="dumbbell-dot-badge">${icon('banknote', 'xs')} ${r.budgetPct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
                <div class="dumbbell-td dumbbell-td-delta">
                  <span class="dumbbell-delta-tag ${deltaClass}">
                    ${deltaLabel}
                  </span>
                </div>
              </div>
            `;
          }).join('');

          // 2. Quỹ lương theo phòng ban (Donut Chart)
          const deptColors = ['#EE4D2D', '#3B82F6', '#0B1F3A', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1'];
          const deptSlices = dumbbellRows.map((r, idx) => ({
            label: r.dept,
            value: r.totalNet,
            formattedValue: fmtMoney(r.totalNet),
            color: deptColors[idx % deptColors.length],
          }));

          const deptLegendHTML = deptSlices.map(s => {
            const pct = totalPayrollBudget > 0 ? ((s.value / totalPayrollBudget) * 100).toFixed(1) : '0';
            return `
              <div class="payroll-legend-item" data-filter-dept="${esc(s.label)}" title="Lọc theo phòng ban ${esc(s.label)}">
                <div class="payroll-legend-left">
                  <span class="payroll-legend-dot" style="background:${s.color};"></span>
                  <span class="payroll-legend-name">${esc(s.label)}</span>
                </div>
                <div class="payroll-legend-right">
                  <span class="payroll-legend-percent">${pct}%</span>
                  <span class="payroll-legend-val">${s.formattedValue}</span>
                </div>
              </div>
            `;
          }).join('');

          // 3. Chuyên cần & Chấm công tháng (tính đến ngày hiện tại là 100%)
          let attRecords = [];
          try {
            const [yearStr, monthStr] = month.split('-');
            const attRes = await api.getAttendance({ month: monthStr, year: yearStr });
            attRecords = attRes.attendance || [];
          } catch (_) {}

          const now = new Date();
          const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const isCurMonth = month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          const relevantAtt = attRecords.filter(a => {
            if (isCurMonth && a.date > todayStr) return false;
            return true;
          });

          let onTimeCount = 0;
          let lateCount = 0;
          let earlyCount = 0;
          let leaveCount = 0;

          relevantAtt.forEach(a => {
            if (a.status === 'leave' || a.status === 'absent') {
              leaveCount++;
            } else if (Number(a.late_minutes || 0) > 0) {
              lateCount++;
            } else if (Number(a.early_minutes || 0) > 0) {
              earlyCount++;
            } else if (a.checkin_time && a.checkout_time) {
              onTimeCount++;
            } else if (a.checkin_time) {
              onTimeCount++;
            }
          });

          const totalAttEvents = onTimeCount + lateCount + earlyCount + leaveCount;
          const onTimeRate = totalAttEvents > 0 ? Math.round((onTimeCount / totalAttEvents) * 100) : (relevantAtt.length ? 100 : 0);

          const attSlices = [
            { label: 'Đúng giờ', value: onTimeCount, formattedValue: `${onTimeCount} ca`, color: '#10B981' },
            { label: 'Đi trễ', value: lateCount, formattedValue: `${lateCount} ca`, color: '#F59E0B' },
            { label: 'Về sớm', value: earlyCount, formattedValue: `${earlyCount} ca`, color: '#EE4D2D' },
            { label: 'Nghỉ / Phép', value: leaveCount, formattedValue: `${leaveCount} ca`, color: '#64748B' },
          ];

          const attLegendHTML = attSlices.map(s => {
            const pct = totalAttEvents > 0 ? ((s.value / totalAttEvents) * 100).toFixed(1) : '0';
            return `
              <div class="payroll-legend-item">
                <div class="payroll-legend-left">
                  <span class="payroll-legend-dot" style="background:${s.color};"></span>
                  <span class="payroll-legend-name">${esc(s.label)}</span>
                </div>
                <div class="payroll-legend-right">
                  <span class="payroll-legend-percent">${pct}%</span>
                  <span class="payroll-legend-val">${s.formattedValue}</span>
                </div>
              </div>
            `;
          }).join('');

          chartsEl.innerHTML = `
            <!-- Chart 1: Dumbbell Chart: % Nhân sự ↔ % Quỹ lương theo phòng ban -->
            <div class="payroll-chart-card payroll-dumbbell-card">
              <div class="payroll-chart-header">
                <div class="payroll-chart-title-wrap">
                  <div class="payroll-chart-icon" style="background:#EFF6FF;color:#2563EB;">${icon('chartLine', 'sm')}</div>
                  <div>
                    <h3 class="payroll-chart-title">So sánh % Nhân sự ↔ % Quỹ lương</h3>
                    <p class="payroll-chart-sub">Dumbbell Chart tương quan quy mô nhân sự & chi phí tháng ${formatMonth(month)}</p>
                  </div>
                </div>
                <div class="payroll-dumbbell-legend">
                  <span class="payroll-dumbbell-legend-item"><span class="dumbbell-legend-dot dumbbell-legend-dot--emp"></span> ${icon('user', 'xs')} % Nhân sự</span>
                  <span class="payroll-dumbbell-legend-item"><span class="dumbbell-legend-dot dumbbell-legend-dot--budget"></span> ${icon('banknote', 'xs')} % Quỹ lương</span>
                </div>
              </div>

              <div class="payroll-dumbbell-table">
                <div class="payroll-dumbbell-thead">
                  <div class="dumbbell-th dumbbell-th-dept">Phòng ban</div>
                  <div class="dumbbell-th dumbbell-th-visual">
                    <span>% Nhân sự ↔ % Quỹ lương</span>
                    <span class="dumbbell-scale-label">0% → ${scaleMax}%</span>
                  </div>
                  <div class="dumbbell-th dumbbell-th-delta">Chênh lệch</div>
                </div>
                <div class="payroll-dumbbell-tbody">
                  ${dumbbellRowsHTML}
                </div>
              </div>

              <div class="payroll-chart-footer-note">
                * <strong>Chênh lệch</strong> = % Quỹ lương − % Nhân sự. Giá trị <strong>(+)</strong> biểu thị lương bình quân phòng ban cao hơn mức trung bình chung toàn công ty.
              </div>
            </div>

            <!-- Chart 2: Quỹ lương theo phòng ban (Donut Chart) -->
            <div class="payroll-chart-card">
              <div class="payroll-chart-header">
                <div class="payroll-chart-title-wrap">
                  <div class="payroll-chart-icon">${icon('banknote', 'sm')}</div>
                  <div>
                    <h3 class="payroll-chart-title">Quỹ lương theo phòng ban</h3>
                    <p class="payroll-chart-sub">Tỷ lệ phân bổ chi phí tháng ${formatMonth(month)}</p>
                  </div>
                </div>
                <span class="payroll-chart-badge">${fmtMoney(totalNet)}</span>
              </div>
              <div class="payroll-chart-body">
                <div class="payroll-donut-wrap">
                  ${renderDonutChartSVG(deptSlices, 'Tổng quỹ', fmtMoney(totalNet))}
                </div>
                <div class="payroll-legend-list">
                  ${deptLegendHTML}
                </div>
              </div>
            </div>

            <!-- Chart 3: Chuyên cần & Chấm công (Donut Chart) -->
            <div class="payroll-chart-card">
              <div class="payroll-chart-header">
                <div class="payroll-chart-title-wrap">
                  <div class="payroll-chart-icon payroll-chart-icon--emerald">${icon('clock3', 'sm')}</div>
                  <div>
                    <h3 class="payroll-chart-title">Chuyên cần & Chấm công</h3>
                    <p class="payroll-chart-sub">Tỷ lệ đúng giờ tính đến hiện tại</p>
                  </div>
                </div>
                <span class="payroll-chart-badge payroll-chart-badge--emerald">${onTimeRate}% đúng giờ</span>
              </div>
              <div class="payroll-chart-body">
                <div class="payroll-donut-wrap">
                  ${renderDonutChartSVG(attSlices, 'Đúng giờ', `${onTimeRate}%`)}
                </div>
                <div class="payroll-legend-list">
                  ${attLegendHTML}
                </div>
              </div>
              <div class="payroll-chart-footer-note">
                * So sánh tính đến ${isCurMonth ? `hôm nay (${todayStr.split('-').reverse().slice(0,2).join('/')}) là 100% kỳ vọng` : `cuối tháng ${formatMonth(month)}`}.
              </div>
            </div>
          `;
          renderDumbbellChart(departmentStats);
        } else {
          chartsEl.innerHTML = '';
        }
      }

      if (!payrolls.length) {
        if (statusEl && !options.keepStatus) statusEl.textContent = `Chưa có dữ liệu bảng lương tháng ${month}.`;
        tableEl.innerHTML = `
          <div style="padding:32px 16px;text-align:center;">
            ${emptyHTML('creditCard', `Chưa có bảng lương tháng ${formatMonth(month)}`, 'Bấm nút "Đồng bộ bảng lương" để tự động tính lương từ chấm công & hợp đồng.')}
            ${isAdmin ? `<button class="btn-primary" id="btn-empty-sync-payroll" style="margin-top:14px;">${icon('refreshCw', 'xs')} <span>Đồng bộ bảng lương tháng ${formatMonth(month)}</span></button>` : ''}
          </div>
        `;
        document.getElementById('btn-empty-sync-payroll')?.addEventListener('click', openCreatePayrollBatchConfirm);
        return;
      }
      if (!filtered.length) {
        if (statusEl && !options.keepStatus) statusEl.textContent = `Không tìm thấy dòng lương phù hợp với bộ lọc.`;
        tableEl.innerHTML = `<div style="padding:24px 16px;">${emptyHTML('search', `Không có dòng lương phù hợp`, 'Thử đổi từ khóa tìm kiếm hoặc chọn phòng ban khác')}</div>`;
        return;
      }
      if (statusEl && !options.keepStatus) statusEl.textContent = `Đã tải ${payrolls.length} dòng bảng lương tháng ${month}. Đang hiển thị ${filtered.length} dòng phù hợp.`;

      tableEl.innerHTML = `
        <div class="table-wrap payroll-table-wrap">
          <table class="payroll-table">
            <colgroup>
              <col class="payroll-width-employee" />
              <col class="payroll-width-dept" />
              <col class="payroll-width-money" />
              <col class="payroll-width-net" />
            </colgroup>
            <thead>
              <tr>
                <th class="payroll-col-employee">Nhân viên</th>
                <th class="payroll-col-dept">Phòng ban</th>
                <th class="payroll-col-money">Lương CB</th>
                <th class="payroll-col-money payroll-col-net">Thực lĩnh</th>
              </tr>
            </thead>
            <tbody>
              ${pageData.rows.map(p => payrollRowHTML(p)).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML(pageData)}
      `;

      tableEl.querySelectorAll('.payroll-row').forEach(row => {
        const open = () => {
          const payroll = payrolls.find(item => item.id === Number(row.dataset.pid));
          if (!payroll) return;
          const showDetails = (editing = false) => {
            openModal('Chi tiết phiếu lương', payslipDetailHTML(payroll, { source: 'payroll', edit: editing }), editing
              ? '<button class="btn-secondary" id="payslip-cancel-edit">Hủy</button><button class="btn-primary" id="payslip-save-edit" disabled>Lưu thay đổi</button>'
              : '<button class="btn-secondary w-full" id="payslip-close">Đóng</button>');
            preparePayslipModal();
            if (editing) {
              bindPayslipInlineEditor(payroll, loadPayroll, () => showDetails(false));
              hydratePayslipAttendance();
              return;
            }
            if (canEditPayroll) {
              const footer = document.getElementById('modal-footer');
              if (footer) footer.insertAdjacentHTML('afterbegin', '<button class="btn-danger" id="payslip-delete">Xóa dòng lương</button><button class="btn-secondary" id="payslip-edit">Sửa trên phiếu</button>');
              document.getElementById('payslip-edit')?.addEventListener('click', () => showDetails(true));
              document.getElementById('payslip-delete')?.addEventListener('click', () => openPayrollDeleteConfirm(payroll, loadPayroll, showDetails));
            }
            document.getElementById('payslip-close')?.addEventListener('click', closeModal);
            hydratePayslipAttendance();
          };
          showDetails();
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
      bindPagination(tableEl, page => { currentPage = page; loadPayroll({ keepStatus: true }); });
    } catch (e) {
      if (statusEl) statusEl.textContent = `Lỗi tải dữ liệu: ${e.message || 'Không xác định'}`;
      tableEl.innerHTML = `<div style="padding:16px;">${emptyHTML('triangleAlert', e.message)}</div>`;
    } finally {
    }
  }

  el._cleanup = () => {
    payrollRowCache.clear();
  };

  EventBus.bindView(el, 'payroll', () => loadPayroll({ keepStatus: true }));
  EventBus.bindView(el, 'payroll:*', () => loadPayroll({ keepStatus: true }));
  EventBus.bindView(el, 'invoices', () => loadPayroll({ keepStatus: true }));
  EventBus.bindView(el, 'invoices:*', () => loadPayroll({ keepStatus: true }));

  loadPayroll();
}

function formatMoneyInput(value) {
  const n = Number(value || 0);
  return n === 0 ? '' : n.toLocaleString('vi-VN');
}

function unformatMoneyInput(str) {
  return parseInt(String(str || '').replace(/[^0-9]/g, ''), 10) || 0;
}

function bindPayslipInlineEditor(payroll, onRefresh = noop, onCancel = closeModal) {
  onRefresh = safeCb(onRefresh);
  const labels = {
    base_salary: 'Mức lương thỏa thuận', allowance: 'Phụ cấp khác', kpi_bonus: 'Thưởng KPI',
    insurance: 'BHXH, BHYT, BHTN người lao động', tax: 'Thuế TNCN', deduction: 'Khấu trừ khác',
  };
  const inputs = [...document.querySelectorAll('[data-payroll-field]')];
  const values = Object.fromEntries(inputs.map(input => [input.dataset.payrollField, Number(input.value || 0)]));
  const initial = Object.fromEntries(inputs.map(input => [input.dataset.payrollField, Number(input.dataset.originalValue || 0)]));
  const overtime = Number(payroll.overtime_pay || 0);
  const saveButton = document.getElementById('payslip-save-edit');

  const changedFields = () => inputs.filter(input => Number(input.value || 0) !== initial[input.dataset.payrollField]);
  const refreshTotals = () => {
    const income = values.base_salary + values.allowance + values.kpi_bonus + overtime;
    const net = income - values.insurance - values.tax - values.deduction;
    const incomeFromWork = document.getElementById('payslip-income-from-work');
    if (incomeFromWork) incomeFromWork.textContent = fmtMoney(values.base_salary);
    document.getElementById('payslip-total-income').textContent = fmtMoney(income);
    document.getElementById('payslip-net').textContent = fmtMoney(net);
    document.getElementById('payslip-net').classList.toggle('payslip-money--negative', net < 0);
  };
  const validate = () => {
    const changed = changedFields();
    let valid = changed.length > 0;
    for (const input of inputs) {
      const field = input.dataset.payrollField;
      const isChanged = Number(input.value || 0) !== initial[field];
      const noteRow = document.querySelector(`[data-payroll-note-row="${field}"]`);
      const note = document.querySelector(`[data-payroll-note="${field}"]`);
      noteRow.hidden = !isChanged;
      if (isChanged && !String(note?.value || '').trim()) valid = false;
      note?.classList.toggle('input-error', isChanged && !String(note?.value || '').trim());
    }
    saveButton.disabled = !valid;
  };
  for (const input of inputs) {
    input.addEventListener('input', () => {
      const field = input.dataset.payrollField;
      values[field] = Math.max(0, Number(input.value || 0));
      refreshTotals();
      validate();
    });
  }
  document.querySelectorAll('[data-payroll-note]').forEach(note => note.addEventListener('input', validate));
  document.getElementById('payslip-cancel-edit')?.addEventListener('click', onCancel);
  saveButton?.addEventListener('click', async () => {
    const changed = changedFields().map(input => {
      const field = input.dataset.payrollField;
      return { field, label: labels[field], old_value: initial[field], new_value: values[field], note: document.querySelector(`[data-payroll-note="${field}"]`)?.value.trim() || '' };
    });
    if (!changed.length || changed.some(item => !item.note)) { validate(); toast('Mỗi dòng đã sửa cần có ghi chú điều chỉnh', 'error'); return; }
    saveButton.disabled = true;
    saveButton.textContent = 'Đang lưu...';
    try {
      const payload = {
        employee_name: payroll.employee_name || '', employee_code: payroll.employee_code || '', department: payroll.department || '',
        month: payroll.month, base_salary: values.base_salary, kpi_bonus: values.kpi_bonus, allowance: values.allowance,
        deduction: values.deduction, overtime_pay: overtime, tax: values.tax, insurance: values.insurance,
        work_days: Number(payroll.work_days || 0), standard_days: Number(payroll.standard_days || 0), note: payroll.note || '',
        line_changes: changed,
      };
      await api.updatePayroll(payroll.id, payload);
      Object.assign(payroll, payload, { net_salary: values.base_salary + values.kpi_bonus + values.allowance + overtime - values.deduction - values.tax - values.insurance });
      await onRefresh();
      toast('Đã lưu điều chỉnh từng dòng lương', 'success');
      onCancel();
    } catch (error) {
      toast(error.message || 'Không thể lưu điều chỉnh', 'error');
      validate();
      saveButton.textContent = 'Lưu thay đổi';
    }
  });
  refreshTotals();
  validate();
}

function openPayrollDeleteConfirm(payroll, onRefresh = noop, onCancel = closeModal) {
  onRefresh = safeCb(onRefresh);
  openModal('Xác nhận xóa dòng lương', `
    <div class="payedit-warn payedit-warn--error" style="display:block;">
      Dòng lương của <b>${esc(payroll.employee_name || 'nhân viên')}</b> trong kỳ <b>${esc(formatMonth(payroll.month))}</b> sẽ bị xóa.
      Thao tác này không thể hoàn tác.
    </div>
    <div class="field" style="margin-top:16px;">
      <label>Nhập <b>XÓA</b> để xác nhận</label>
      <input id="payroll-delete-confirm" autocomplete="off" placeholder="XÓA" />
    </div>
  `, `
    <button class="btn-secondary" id="payroll-delete-cancel">Quay lại</button>
    <button class="btn-danger" id="payroll-delete-submit" disabled>Xóa dòng lương</button>
  `);
  const input = document.getElementById('payroll-delete-confirm');
  const submit = document.getElementById('payroll-delete-submit');
  const confirmed = () => String(input?.value || '').trim().toLocaleUpperCase('vi-VN') === 'XÓA';
  input?.addEventListener('input', () => { submit.disabled = !confirmed(); });
  document.getElementById('payroll-delete-cancel')?.addEventListener('click', onCancel);
  submit?.addEventListener('click', async () => {
    if (!confirmed()) return;
    submit.disabled = true;
    submit.textContent = 'Đang xóa...';
    try {
      await api.deletePayroll(payroll.id);
      await onRefresh();
      closeModal();
      toast('Đã xóa dòng lương', 'success');
    } catch (error) {
      toast(error.message || 'Không thể xóa dòng lương', 'error');
      submit.disabled = false;
      submit.textContent = 'Xóa dòng lương';
    }
  });
}

function openPayrollLineForm(pay, onRefresh = noop, currentMonth = '', options = {}) {
  onRefresh = safeCb(onRefresh);
  const { inline = false, onCancel = closeModal, onSaved = null } = options;
  const now = new Date();
  const defMonth = currentMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isEdit = !!pay;
  const isReady = pay ? (pay.data_status || (Number(pay.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config')) === 'ready' : false;
  const color = avatarColor(pay?.employee_name || '?');
  const ini = initials(pay?.employee_name || '?');

  const baseVal = Number(pay?.base_salary || 0);
  const kpiVal = Number(pay?.kpi_bonus || 0);
  const allowVal = Number(pay?.allowance || 0);
  const deductVal = Number(pay?.deduction || 0);

  const bodyHtml = `
    <!-- Employee Info Card -->
    <div class="payedit-emp">
      <span class="payedit-avatar" style="background:${color};">${ini}</span>
      <div class="payedit-emp-info">
        <div class="payedit-emp-name">${esc(pay?.employee_name || '—')}</div>
        <div class="payedit-emp-meta">${esc(pay?.employee_code || '')} · ${esc(pay?.department || '—')}</div>
        <span class="payroll-badge ${isReady ? 'payroll-badge--ok' : 'payroll-badge--warn'}">${isReady ? 'Đủ dữ liệu' : 'Thiếu cấu hình lương'}</span>
      </div>
    </div>

    <!-- Period -->
    <div class="payedit-section">
      <div class="payedit-section-title">Kỳ lương</div>
      <div class="field">
        <input type="month" id="pf-month" value="${pay?.month || defMonth}" style="max-width:200px;"/>
      </div>
    </div>

    <!-- Income -->
    <div class="payedit-section">
      <div class="payedit-section-title">Khoản thu nhập</div>
      <div class="payedit-grid">
        <div class="field">
          <label>Lương cơ bản</label>
          <input type="text" id="pf-base" class="payedit-money" value="${formatMoneyInput(baseVal)}" placeholder="0" inputmode="numeric"/>
        </div>
        <div class="field">
          <label>KPI bonus</label>
          <input type="text" id="pf-kpi" class="payedit-money" value="${formatMoneyInput(kpiVal)}" placeholder="0" inputmode="numeric"/>
        </div>
        <div class="field">
          <label>Phụ cấp</label>
          <input type="text" id="pf-allow" class="payedit-money" value="${formatMoneyInput(allowVal)}" placeholder="0" inputmode="numeric"/>
        </div>
      </div>
    </div>

    <!-- Deductions -->
    <div class="payedit-section">
      <div class="payedit-section-title">Khoản khấu trừ</div>
      <div class="payedit-grid">
        <div class="field">
          <label>Khấu trừ</label>
          <input type="text" id="pf-deduct" class="payedit-money" value="${formatMoneyInput(deductVal)}" placeholder="0" inputmode="numeric"/>
        </div>
      </div>
    </div>

    ${isEdit ? `
      <div class="payedit-section">
        <div class="payedit-section-title">Ghi chú điều chỉnh <span style="color:var(--danger)">*</span></div>
        <div class="field">
          <label>Nêu rõ lý do sửa dòng lương này</label>
          <textarea id="pf-change-note" rows="3" maxlength="1000" placeholder="Ví dụ: Điều chỉnh phụ cấp tháng do bổ sung chứng từ đã duyệt."></textarea>
          <div style="font-size:12px;color:var(--text-2);margin-top:5px;">Ghi chú, người sửa và giá trị trước/sau sẽ được lưu vào lịch sử điều chỉnh.</div>
        </div>
      </div>
    ` : ''}

    <!-- Warnings -->
    <div id="pf-warnings" style="display:none;"></div>

    <!-- Summary -->
    <div class="payedit-summary" id="pf-summary-box">
      <div class="payedit-summary-row">
        <span>Tổng thu nhập</span>
        <span id="pf-total-income">0 ₫</span>
      </div>
      <div class="payedit-summary-row">
        <span>Tổng khấu trừ</span>
        <span id="pf-total-deduct" class="payedit-summary-val--neg">0 ₫</span>
      </div>
      <div class="payedit-summary-divider"></div>
      <div class="payedit-summary-row payedit-summary-row--net">
        <span>Thực nhận dự kiến</span>
        <span id="pf-net">0 ₫</span>
      </div>
      <div class="payedit-formula">= Lương CB + KPI bonus + Phụ cấp − Khấu trừ</div>
    </div>
  `;
  const footerHtml = `
    <button class="btn-secondary" id="pf-cancel">Hủy</button>
    <button class="btn-primary" id="pf-save">Lưu thay đổi</button>
  `;
  if (inline) {
    document.getElementById('modal-title').textContent = 'Chỉnh sửa phiếu lương';
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
  } else {
    openModal(isEdit ? 'Sửa dòng lương' : 'Thêm dòng lương thủ công', bodyHtml, footerHtml);
  }

  // Apply payroll-edit modal class
  const modalEl = document.getElementById('modal');
  modalEl?.classList.add('modal--payroll-edit');

  document.getElementById('pf-cancel').addEventListener('click', onCancel);

  function readInputs() {
    return {
      base: unformatMoneyInput(document.getElementById('pf-base').value),
      kpi: unformatMoneyInput(document.getElementById('pf-kpi').value),
      allow: unformatMoneyInput(document.getElementById('pf-allow').value),
      deduct: unformatMoneyInput(document.getElementById('pf-deduct').value),
    };
  }

  function writeBack(vals) {
    document.getElementById('pf-base').value = formatMoneyInput(vals.base);
    document.getElementById('pf-kpi').value = formatMoneyInput(vals.kpi);
    document.getElementById('pf-allow').value = formatMoneyInput(vals.allow);
    document.getElementById('pf-deduct').value = formatMoneyInput(vals.deduct);
  }

  function updateNet() {
    const v = readInputs();
    const totalIncome = v.base + v.kpi + v.allow;
    const net = totalIncome - v.deduct;

    document.getElementById('pf-total-income').textContent = fmtMoney(totalIncome);
    document.getElementById('pf-total-deduct').textContent = fmtMoney(v.deduct);
    const netEl = document.getElementById('pf-net');
    netEl.textContent = fmtMoney(net);
    const summaryBox = document.getElementById('pf-summary-box');

    // Color the net based on sign
    if (net < 0) {
      netEl.style.color = 'var(--danger)';
      summaryBox.style.borderColor = '#FECACA';
    } else if (net > 0) {
      netEl.style.color = 'var(--success)';
      summaryBox.style.borderColor = 'var(--border)';
    } else {
      netEl.style.color = 'var(--text-2)';
      summaryBox.style.borderColor = 'var(--border)';
    }

    // Warnings
    const warnings = document.getElementById('pf-warnings');
    let warningHtml = '';
    const saveBtn = document.getElementById('pf-save');

    if (v.base <= 0 && !isReady) {
      warningHtml += `<div class="payedit-warn"><span style="display:inline-flex;align-items:center;">${icon('triangleAlert', 'xs')}</span> Nhân viên chưa có lương cơ bản. Cần <a href="#/users${pay ? '/' + pay.employee_id : ''}" target="_blank">cấu hình lương</a> trước khi chốt bảng lương.</div>`;
    }
    if (net < 0) {
      warningHtml += `<div class="payedit-warn payedit-warn--error"><span style="display:inline-flex;align-items:center;">${icon('circleAlert', 'xs')}</span> Thực nhận đang âm. Vui lòng kiểm tra lại lương cơ bản hoặc khoản khấu trừ.</div>`;
    }
    if (v.deduct > totalIncome && totalIncome > 0) {
      warningHtml += `<div class="payedit-warn"><span style="display:inline-flex;align-items:center;">${icon('triangleAlert', 'xs')}</span> Khấu trừ lớn hơn tổng thu nhập.</div>`;
    }

    warnings.innerHTML = warningHtml;
    warnings.style.display = warningHtml ? 'grid' : 'none';

    // Disable save if base <= 0 (missing salary config) or net < 0
    const invalid = (v.base <= 0 && !isReady) || net < 0;
    saveBtn.disabled = invalid;
    saveBtn.style.opacity = invalid ? '0.5' : '1';
  }

  // Money input formatting: show formatted while typing
  ['pf-base', 'pf-kpi', 'pf-allow', 'pf-deduct'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = el.value.replace(/[^0-9]/g, '');
      const n = parseInt(raw, 10) || 0;
      const cursor = el.selectionStart;
      const before = el.value;
      el.value = n === 0 && raw === '' ? '' : n.toLocaleString('vi-VN');
      // Restore cursor
      const diff = el.value.length - before.length;
      if (diff !== 0 && cursor !== null) {
        el.setSelectionRange(cursor + diff, cursor + diff);
      }
      updateNet();
    });
    el.addEventListener('blur', () => {
      const n = unformatMoneyInput(el.value);
      el.value = n === 0 ? '' : n.toLocaleString('vi-VN');
      updateNet();
    });
    el.addEventListener('keydown', (e) => {
      // Allow: backspace, delete, tab, escape, enter, arrows, home, end
      const allowed = [8, 46, 9, 27, 13, 37, 38, 39, 40, 35, 36];
      if (allowed.includes(e.keyCode) || (e.ctrlKey || e.metaKey)) return;
      // Only allow digits
      if (e.key.length === 1 && !/[0-9]/.test(e.key)) {
        e.preventDefault();
      }
    });
  });
  updateNet();

  let saving = false;
  document.getElementById('pf-save').addEventListener('click', async () => {
    if (saving) return;
    const v = readInputs();
    const net = v.base + v.kpi + v.allow - v.deduct;
    const month = document.getElementById('pf-month').value;
    const changeNote = document.getElementById('pf-change-note')?.value.trim() || '';
    if (isEdit && !changeNote) { toast('Vui lòng nhập ghi chú điều chỉnh', 'error'); return; }
    if (!month) { toast('Vui lòng chọn tháng lương', 'error'); return; }
    if ((v.base <= 0 && !isReady) || net < 0) { toast('Không thể lưu khi dữ liệu không hợp lệ', 'error'); return; }

    saving = true;
    const saveBtn = document.getElementById('pf-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Đang lưu...';

    try {
      const data = {
        employee_name: pay?.employee_name || '',
        month,
        base_salary: v.base,
        kpi_bonus: v.kpi,
        allowance: v.allow,
        deduction: v.deduct,
        net_salary: net,
        change_note: changeNote,
      };
      if (isEdit) await api.updatePayroll(pay.id, data);
      else await api.createPayroll(data);
      if (inline && isEdit) Object.assign(pay, data, { net_salary: net });
      toast(isEdit ? 'Đã cập nhật dòng lương' : 'Đã thêm dòng lương thủ công', 'success');
      await onRefresh();
      if (inline && typeof onSaved === 'function') onSaved();
      else closeModal();
    } catch (e) {
      toast(e.message || 'Không thể cập nhật dòng lương. Vui lòng thử lại.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Lưu thay đổi';
      saving = false;
    }
  });
}
