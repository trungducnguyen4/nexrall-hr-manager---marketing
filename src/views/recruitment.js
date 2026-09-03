import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, DEPARTMENTS, noop, safeCb, filterBySearch, filterByDepartment, paginateRows, paginationHTML, bindPagination, isHcnsDepartment, sortVietnameseNames, compareVietnameseNames } from '../utils.js';
import { icon } from '../icons.js';

const STAGES = [
  { key: 'received',    label: 'Mới tiếp nhận', color: '#64748B', bg: '#F1F5F9' },
  { key: 'screening',   label: 'Sàng lọc',       color: '#3B82F6', bg: '#DBEAFE' },
  { key: 'interview1',  label: 'PV vòng 1',       color: '#F59E0B', bg: '#FEF3C7' },
  { key: 'interview2',  label: 'PV vòng 2',       color: '#F97316', bg: '#FFEDD5' },
  { key: 'offer',       label: 'Đề xuất',         color: '#8B5CF6', bg: '#EDE9FE' },
  { key: 'hired',       label: 'Tuyển dụng ✓',    color: '#10B981', bg: '#D1FAE5' },
  { key: 'rejected',    label: 'Từ chối',         color: '#EF4444', bg: '#FEE2E2' },
];

function stageInfo(key) {
  return STAGES.find(s => s.key === key) || { label: key, color: '#64748B', bg: '#F1F5F9' };
}

const SOURCES = ['LinkedIn','Facebook','Giới thiệu','Website','TopCV','VietnamWorks','Khác'];
const DEPT_LIST = DEPARTMENTS;

export async function renderRecruitment(el, me) {
  const isAdmin = me.role === 'admin' || me.role === 'manager' || isHcnsDepartment(me.department);

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">${icon('userPlus', 'lg')} <span>Tuyển dụng</span></div>
        <div class="page-sub">Quản lý ứng viên theo từng giai đoạn</div>
      </div>
      ${isAdmin ? `<button id="btn-new-cand" class="btn-primary btn-sm">${icon('plus', 'xs')} <span>Thêm ứng viên</span></button>` : ''}
    </div>

    <!-- Stats -->
    <div id="recruit-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;">${loadingHTML()}</div>

    <!-- Filter -->
    <div class="filter-bar" id="recruit-filter">
      <span class="filter-chip active" data-stage="">Tất cả</span>
      ${STAGES.map(s => `<span class="filter-chip" data-stage="${s.key}" style="--chip-color:${s.color}">${s.label}</span>`).join('')}
    </div>

    <div class="search-bar">
      <span class="search-icon">${icon('search', 'sm')}</span>
      <input type="text" id="recruit-search" placeholder="Tìm tên, vị trí ứng tuyển..."/>
      <select id="recruit-dept-filter" style="max-width:220px;"><option value="">Tất cả phòng ban</option>${DEPT_LIST.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
    </div>

    <div id="recruit-list">${loadingHTML()}</div>
  `;

  if (isAdmin) {
    document.getElementById('btn-new-cand').addEventListener('click', () => openCandidateForm(null, loadCandidates));
  }

  let allCandidates = [];
  let currentPage = 1;

  document.getElementById('recruit-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('#recruit-filter .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentPage = 1;
    loadCandidates();
  });

  document.getElementById('recruit-search').addEventListener('input', () => { currentPage = 1; loadCandidates(); });
  document.getElementById('recruit-dept-filter')?.addEventListener('change', () => { currentPage = 1; loadCandidates(); });


  async function loadCandidates() {
    const listEl = document.getElementById('recruit-list');
    if (!listEl) return;

    try {
      if (!allCandidates.length) {
        listEl.innerHTML = loadingHTML();
        const res = await api.getCandidates();
        allCandidates = res.candidates || [];

        // Update stats
        const statsEl = document.getElementById('recruit-stats');
        if (statsEl) {
          const total     = allCandidates.length;
          const active    = allCandidates.filter(c => !['hired','rejected'].includes(c.stage)).length;
          const hired     = allCandidates.filter(c => c.stage === 'hired').length;
          statsEl.innerHTML = `
            <div class="stat-card" style="--stat-color:#6366F1;--stat-bg:#EEF2FF;padding:14px;">
              <div class="stat-icon-wrap" style="width:36px;height:36px;margin-bottom:8px;">${icon('target', 'sm')}</div>
              <div class="stat-val" style="font-size:22px;">${total}</div>
              <div class="stat-label">Tổng ứng viên</div>
            </div>
            <div class="stat-card" style="--stat-color:#F59E0B;--stat-bg:#FEF3C7;padding:14px;">
              <div class="stat-icon-wrap" style="width:36px;height:36px;margin-bottom:8px;">${icon('refreshCw', 'sm')}</div>
              <div class="stat-val" style="font-size:22px;">${active}</div>
              <div class="stat-label">Đang xử lý</div>
            </div>
            <div class="stat-card" style="--stat-color:#10B981;--stat-bg:#D1FAE5;padding:14px;">
              <div class="stat-icon-wrap" style="width:36px;height:36px;margin-bottom:8px;">${icon('circleCheck', 'sm')}</div>
              <div class="stat-val" style="font-size:22px;">${hired}</div>
              <div class="stat-label">Đã tuyển</div>
            </div>
          `;
        }
      }

      const stageFilter  = document.querySelector('#recruit-filter .filter-chip.active')?.dataset.stage || '';
      const searchFilter = (document.getElementById('recruit-search')?.value || '').toLowerCase();

      let filtered = allCandidates;
      if (stageFilter) filtered = filtered.filter(c => c.stage === stageFilter);
      filtered = filterBySearch(filtered, searchFilter, ['name', 'position', 'email', 'phone']);
      filtered = filterByDepartment(filtered, document.getElementById('recruit-dept-filter')?.value || '', ['department']);
      filtered = sortVietnameseNames(filtered, 'name');
      const pageData = paginateRows(filtered, currentPage);
      currentPage = pageData.page;
      if (!filtered.length) {
        listEl.innerHTML = emptyHTML('target', 'Không có ứng viên nào', 'Hãy thêm ứng viên mới');
        return;
      }

      listEl.innerHTML = pageData.rows.map(c => {
        const stage = stageInfo(c.stage);
        return `
          <div class="list-item" data-cid="${c.id}">
            <div style="width:44px;height:44px;border-radius:12px;background:${stage.bg};color:${stage.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon('user', 'md')}</div>
            <div class="list-item-content">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="list-item-title">${esc(c.name)}</span>
                <span class="badge" style="background:${stage.bg};color:${stage.color};font-size:10px;">${stage.label}</span>
              </div>
              <div class="list-item-sub">${esc(c.position||'—')} · ${esc(c.department||'—')}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:2px;">
                ${icon('calendarDays', 'xs')} ${esc(c.apply_date||'—')} · Nguồn: ${esc(c.source||'—')}
              </div>
            </div>
            ${isAdmin ? `
              <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
                <select class="stage-select" data-cid="${c.id}" style="font-size:11px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);">
                  ${STAGES.map(s => `<option value="${s.key}" ${c.stage===s.key?'selected':''}>${s.label}</option>`).join('')}
                </select>
                <div style="display:flex;gap:4px;">
                  <button class="btn-xs btn-secondary cand-edit" data-cid="${c.id}" title="Sửa">${icon('pencil', 'xs')}</button>
                  <button class="btn-xs btn-danger cand-del" data-cid="${c.id}" title="Xóa">${icon('trash2', 'xs')}</button>
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('') + paginationHTML(pageData);

      if (isAdmin) {
        listEl.querySelectorAll('.stage-select').forEach(sel => {
          sel.addEventListener('change', async () => {
            const cid = sel.dataset.cid;
            try {
              await api.updateCandidate(cid, { stage: sel.value });
              const c = allCandidates.find(x => x.id === parseInt(cid));
              if (c) c.stage = sel.value;
              toast('Đã cập nhật giai đoạn', 'success');
            } catch(e) { toast(e.message, 'error'); }
          });
        });
        listEl.querySelectorAll('.cand-edit').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const c = allCandidates.find(x => x.id === parseInt(btn.dataset.cid));
            if (c) { allCandidates = []; openCandidateForm(c, loadCandidates); }
          });
        });
        listEl.querySelectorAll('.cand-del').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Xóa ứng viên này?')) return;
            try {
              await api.deleteCandidate(btn.dataset.cid);
              allCandidates = allCandidates.filter(x => x.id !== parseInt(btn.dataset.cid));
              toast('Đã xóa', 'success');
              loadCandidates();
            } catch(e) { toast(e.message, 'error'); }
          });
        });
      }
      bindPagination(listEl, page => { currentPage = page; loadCandidates(); });
    } catch(e) {
      listEl.innerHTML = emptyHTML('triangleAlert', e.message);
    }
  }

  el._cleanup = () => {};

  EventBus.bindView(el, 'recruitment', () => loadCandidates());
  EventBus.bindView(el, 'recruitment:*', () => loadCandidates());
  EventBus.bindView(el, 'candidate:*', () => loadCandidates());

  loadCandidates();
}

function openCandidateForm(cand, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!cand;
  openModal(isEdit ? 'Sửa ứng viên' : 'Thêm ứng viên mới', `
    <div class="field"><label>Họ tên *</label>
      <input type="text" id="cf-name" value="${esc(cand?.name||'')}" placeholder="Nguyễn Văn A"/>
    </div>
    <div class="input-row">
      <div class="field"><label>Vị trí ứng tuyển</label>
        <input type="text" id="cf-position" value="${esc(cand?.position||'')}" placeholder="Content Writer"/>
      </div>
      <div class="field"><label>Phòng ban</label>
        <select id="cf-dept">
          <option value="">-- Chọn phòng ban --</option>
          ${DEPT_LIST.map(d => `<option value="${d}" ${cand?.department===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Ngày ứng tuyển</label>
        <input type="date" id="cf-date" value="${cand?.apply_date||new Date().toISOString().slice(0,10)}"/>
      </div>
      <div class="field"><label>Nguồn</label>
        <select id="cf-source">
          ${SOURCES.map(s => `<option value="${s}" ${cand?.source===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field"><label>Giai đoạn</label>
      <select id="cf-stage">
        ${STAGES.map(s => `<option value="${s.key}" ${cand?.stage===s.key?'selected':''}>${s.label}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Ghi chú</label>
      <textarea id="cf-notes" rows="3" placeholder="Ghi chú về ứng viên...">${esc(cand?.notes||'')}</textarea>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="cf-del">Xóa</button>` : ''}
    <button class="btn-primary" id="cf-save">Lưu</button>
  `);

  document.getElementById('cf-save').addEventListener('click', async () => {
    const name = document.getElementById('cf-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên ứng viên', 'error'); return; }
    const data = {
      name,
      position:   document.getElementById('cf-position').value.trim(),
      department: document.getElementById('cf-dept').value,
      apply_date: document.getElementById('cf-date').value,
      source:     document.getElementById('cf-source').value,
      stage:      document.getElementById('cf-stage').value,
      notes:      document.getElementById('cf-notes').value.trim(),
    };
    try {
      if (isEdit) await api.updateCandidate(cand.id, data);
      else await api.createCandidate(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật ứng viên' : 'Đã thêm ứng viên', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });

  document.getElementById('cf-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa ứng viên "${cand.name}"?`)) return;
    try {
      await api.deleteCandidate(cand.id);
      closeModal();
      toast('Đã xóa', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });
}
