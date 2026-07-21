import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, fmtDate, noop, safeCb } from '../utils.js';

const LEAVE_TYPES = [
  { value: 'annual',   label: 'Phép năm',       icon: '🏖️', color: '#6366F1' },
  { value: 'sick',     label: 'Ốm đau',          icon: '🏥', color: '#EF4444' },
  { value: 'personal', label: 'Việc cá nhân',    icon: '👤', color: '#F59E0B' },
  { value: 'maternity',label: 'Thai sản',         icon: '👶', color: '#EC4899' },
  { value: 'other',    label: 'Khác',            icon: '📝', color: '#64748B' },
];

function leaveType(t) { return LEAVE_TYPES.find(x => x.value === t) || { label: t, icon: '📝', color: '#64748B' }; }

function daysBetween(a, b) {
  const ms = Math.abs(new Date(b) - new Date(a));
  return Math.ceil(ms / 86400000) + 1;
}

export async function renderLeave(el, me) {
  const isManager = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">🏖️ Nghỉ phép</div>
        <div class="page-sub">${isManager ? 'Quản lý đơn nghỉ phép toàn công ty' : 'Xin nghỉ và theo dõi lịch sử'}</div>
      </div>
      <button id="btn-new-leave" class="btn-primary btn-sm">+ Xin nghỉ</button>
    </div>

    <div class="filter-bar">
      <span class="filter-chip active" data-status="">Tất cả</span>
      <span class="filter-chip" data-status="pending">⏳ Chờ duyệt</span>
      <span class="filter-chip" data-status="approved">✅ Đã duyệt</span>
      <span class="filter-chip" data-status="rejected">❌ Từ chối</span>
    </div>

    <div id="leave-list">${loadingHTML()}</div>
  `;

  document.getElementById('btn-new-leave').addEventListener('click', () => openLeaveForm(null, me, loadLeave));

  document.querySelector('.filter-bar').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('.filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    loadLeave();
  });

  async function loadLeave() {
    const listEl = document.getElementById('leave-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    const status = document.querySelector('.filter-bar .filter-chip.active')?.dataset.status || '';
    const params = {};
    if (status) params.status = status;
    if (!isManager) params.self = '1';

    try {
      const { leave = [] } = await api.getLeave(params);
      if (!leave.length) {
        listEl.innerHTML = emptyHTML('🏖️', 'Không có đơn nghỉ phép nào', 'Nhấn "+ Xin nghỉ" để tạo đơn mới');
        return;
      }

      listEl.innerHTML = leave.map(l => {
        const lt = leaveType(l.type);
        const days = daysBetween(l.start_date, l.end_date);
        const statusInfo = statusData(l.status);
        return `
          <div class="leave-item" data-lid="${l.id}">
            <div class="leave-type-icon" style="background:${lt.color}18;">${lt.icon}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                <span style="font-size:14px;font-weight:700;color:var(--text);">${lt.label}</span>
                <span class="badge ${statusInfo.cls}">${statusInfo.label}</span>
              </div>
              ${isManager && l.employee_name ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:3px;">👤 ${esc(l.employee_name)} · ${esc(l.department||'')}</div>` : ''}
              <div style="font-size:12px;color:var(--text-2);">📅 ${esc(l.start_date)} → ${esc(l.end_date)} <strong>(${days} ngày)</strong></div>
              ${l.reason ? `<div style="font-size:12px;color:var(--text-3);margin-top:4px;">${esc(l.reason)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0;">
              ${isManager && l.status === 'pending' ? `
                <button class="btn-xs btn-primary leave-approve" data-lid="${l.id}" style="background:#10B981;font-size:11px;">✅ Duyệt</button>
                <button class="btn-xs btn-danger leave-reject" data-lid="${l.id}" style="font-size:11px;">❌ Từ chối</button>
              ` : ''}
              ${(!isManager && l.status === 'pending') || isManager ? `
                <button class="btn-xs btn-secondary leave-del" data-lid="${l.id}" style="font-size:11px;">🗑</button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.leave-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.updateLeave(btn.dataset.lid, { status: 'approved' });
            toast('Đã duyệt đơn nghỉ phép', 'success');
            loadLeave();
          } catch(e) { toast(e.message, 'error'); }
        });
      });

      listEl.querySelectorAll('.leave-reject').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.updateLeave(btn.dataset.lid, { status: 'rejected' });
            toast('Đã từ chối đơn nghỉ', 'info');
            loadLeave();
          } catch(e) { toast(e.message, 'error'); }
        });
      });

      listEl.querySelectorAll('.leave-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Xóa đơn nghỉ phép này?')) return;
          try {
            await api.deleteLeave(btn.dataset.lid);
            toast('Đã xóa', 'success');
            loadLeave();
          } catch(e) { toast(e.message, 'error'); }
        });
      });

    } catch(e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  loadLeave();
}

function statusData(s) {
  return {
    pending:  { cls: 'badge-warning', label: '⏳ Chờ duyệt' },
    approved: { cls: 'badge-success', label: '✅ Đã duyệt' },
    rejected: { cls: 'badge-danger',  label: '❌ Từ chối' },
  }[s] || { cls: 'badge-gray', label: s };
}

function openLeaveForm(leave, me, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const today = new Date().toISOString().slice(0,10);
  openModal('Đăng ký nghỉ phép', `
    <div class="field"><label>Loại nghỉ phép *</label>
      <select id="lf-type">
        ${LEAVE_TYPES.map(t => `<option value="${t.value}" ${leave?.type===t.value?'selected':''}>${t.icon} ${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="input-row">
      <div class="field"><label>Ngày bắt đầu *</label>
        <input type="date" id="lf-start" value="${leave?.start_date||today}"/>
      </div>
      <div class="field"><label>Ngày kết thúc *</label>
        <input type="date" id="lf-end" value="${leave?.end_date||today}"/>
      </div>
    </div>
    <div class="field"><label>Lý do</label>
      <textarea id="lf-reason" rows="3" placeholder="Mô tả lý do xin nghỉ...">${esc(leave?.reason||'')}</textarea>
    </div>
    <div id="lf-days" style="text-align:center;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13px;font-weight:600;color:var(--primary);"></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="lf-save">Gửi đơn</button>
  `);

  function updateDays() {
    const s = document.getElementById('lf-start').value;
    const e = document.getElementById('lf-end').value;
    if (s && e) {
      const days = daysBetween(s, e);
      document.getElementById('lf-days').textContent = `📅 Tổng cộng: ${days} ngày nghỉ`;
    }
  }
  document.getElementById('lf-start').addEventListener('change', updateDays);
  document.getElementById('lf-end').addEventListener('change', updateDays);
  updateDays();

  document.getElementById('lf-save').addEventListener('click', async () => {
    const type       = document.getElementById('lf-type').value;
    const start_date = document.getElementById('lf-start').value;
    const end_date   = document.getElementById('lf-end').value;
    const reason     = document.getElementById('lf-reason').value.trim();
    if (!start_date || !end_date) { toast('Vui lòng chọn ngày', 'error'); return; }
    if (start_date > end_date) { toast('Ngày bắt đầu phải trước ngày kết thúc', 'error'); return; }
    try {
      await api.createLeave({ type, start_date, end_date, reason });
      closeModal();
      toast('Đã gửi đơn nghỉ phép', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });
}
