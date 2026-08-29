import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, noop, safeCb, sortVietnameseNames, compareVietnameseNames } from '../utils.js';
import { icon } from '../icons.js';

const DEPT_COLORS = [
  '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
  '#8B5CF6', '#14B8A6', '#F97316', '#EC4899', '#64748B',
];
const DEPT_ICON_NAMES = ['megaphone', 'squarePen', 'search', 'smartPhone', 'sparkles', 'barChart3', 'handshake', 'wifi', 'activity', 'trophy'];

function colorForDept(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length];
}

function iconForDept(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('marketing') || lower.includes('truyền thông')) return icon('megaphone', 'md');
  if (lower.includes('biên tập') || lower.includes('nội dung') || lower.includes('content')) return icon('squarePen', 'md');
  if (lower.includes('hcns') || lower.includes('nhân sự') || lower.includes('hành chính')) return icon('users', 'md');
  if (lower.includes('kế toán') || lower.includes('tài chính') || lower.includes('quỹ')) return icon('banknote', 'md');
  if (lower.includes('tạp vụ') || lower.includes('bảo vệ')) return icon('shield', 'md');
  if (lower.includes('kỹ thuật') || lower.includes('it') || lower.includes('dev')) return icon('wifi', 'md');
  if (lower.includes('sản xuất') || lower.includes('phim') || lower.includes('gameshow')) return icon('activity', 'md');
  if (lower.includes('thực tập sinh') || lower.includes('tts')) return icon('bookOpen', 'md');
  if (lower.includes('giám đốc') || lower.includes('bgd') || lower.includes('ban giám đốc')) return icon('trophy', 'md');
  let h = 0;
  for (let i = 0; i < lower.length; i++) h = (h * 17 + lower.charCodeAt(i)) & 0xffffffff;
  const iconName = DEPT_ICON_NAMES[Math.abs(h) % DEPT_ICON_NAMES.length];
  return icon(iconName, 'md');
}

export async function renderDepartments(el, me) {
  const isAdmin = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <section class="departments-page">
      <!-- Header -->
      <div class="departments-header">
        <div class="departments-header-left">
          <h1 class="departments-title">${icon('building2', 'lg')} <span>Phòng ban & Cơ cấu tổ chức</span></h1>
          <p class="departments-sub">Quản lý sơ đồ phòng ban, trưởng bộ phận và phân bổ nhân sự toàn công ty</p>
        </div>
        ${isAdmin ? `<button id="btn-new-dept" class="btn-primary btn-sm dept-add-btn">${icon('plus', 'sm')} <span>Thêm phòng ban</span></button>` : ''}
      </div>

      <!-- Top KPI Metrics -->
      <div id="dept-metrics" class="dept-metrics-grid">
        <div class="dept-metric-card dept-metric-skeleton"></div>
        <div class="dept-metric-card dept-metric-skeleton"></div>
        <div class="dept-metric-card dept-metric-skeleton"></div>
        <div class="dept-metric-card dept-metric-skeleton"></div>
      </div>

      <!-- Controls & Filter Toolbar -->
      <div class="dept-toolbar">
        <div class="dept-search-box">
          <span class="dept-search-icon">${icon('search', 'sm')}</span>
          <input type="text" id="dept-search" placeholder="Tìm theo tên phòng ban, trưởng phòng, nhân sự..."/>
        </div>
        <div class="dept-filter-tabs" id="dept-filter-tabs">
          <button class="dept-filter-btn active" data-filter="all">Tất cả</button>
          <button class="dept-filter-btn" data-filter="has-manager">Đã có trưởng phòng</button>
          <button class="dept-filter-btn" data-filter="no-manager">Chưa có trưởng phòng</button>
        </div>
      </div>

      <!-- Main Department Grid -->
      <div id="dept-grid-container">${loadingHTML()}</div>

      <!-- Unassigned Employees Section (if any) -->
      <div id="dept-unassigned-section" class="dept-unassigned-wrap"></div>
    </section>
  `;

  let currentDepts = [];
  let currentUsers = [];
  let activeFilter = 'all';

  document.getElementById('btn-new-dept')?.addEventListener('click', () => openDeptForm(null, loadDepts, currentDepts, currentUsers));
  
  document.getElementById('dept-search')?.addEventListener('input', () => {
    renderDeptDashboard();
  });

  document.getElementById('dept-filter-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (btn) {
      document.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderDeptDashboard();
    }
  });

  async function loadDepts() {
    const gridEl = document.getElementById('dept-grid-container');
    if (!gridEl) return;
    gridEl.innerHTML = loadingHTML();
    try {
      const [deptsRes, usersRes] = await Promise.allSettled([api.getDepartments(), api.getUsers()]);
      currentDepts = deptsRes.status === 'fulfilled'
        ? (deptsRes.value.departments || []).map(d => ({ ...d, manager: d.manager_name || d.manager || '' }))
        : [];
      currentUsers = usersRes.status === 'fulfilled' ? sortVietnameseNames(usersRes.value.users || [], 'full_name') : [];
      renderDeptDashboard();
    } catch (e) {
      gridEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  function renderDeptDashboard() {
    const gridEl = document.getElementById('dept-grid-container');
    const metricsEl = document.getElementById('dept-metrics');
    const unassignedEl = document.getElementById('dept-unassigned-section');
    if (!gridEl) return;

    // Group users by department
    const byDept = {};
    const unassignedUsers = [];
    currentUsers.forEach(u => {
      if (u.department && u.department.trim()) {
        const dName = u.department.trim();
        if (!byDept[dName]) byDept[dName] = [];
        byDept[dName].push(u);
      } else {
        unassignedUsers.push(u);
      }
    });

    // Render Metrics
    const totalDepts = currentDepts.length;
    const totalAssignedUsers = currentUsers.length - unassignedUsers.length;
    const deptsWithManager = currentDepts.filter(d => d.manager_id || (d.manager && d.manager.trim())).length;

    if (metricsEl) {
      metricsEl.innerHTML = `
        <div class="dept-metric-card">
          <div class="dept-metric-icon dept-metric-icon--blue">${icon('building2', 'md')}</div>
          <div class="dept-metric-data">
            <span class="dept-metric-val">${totalDepts}</span>
            <span class="dept-metric-lbl">Phòng ban hoạt động</span>
          </div>
        </div>
        <div class="dept-metric-card">
          <div class="dept-metric-icon dept-metric-icon--green">${icon('users', 'md')}</div>
          <div class="dept-metric-data">
            <span class="dept-metric-val">${totalAssignedUsers}</span>
            <span class="dept-metric-lbl">Nhân sự đã phân bổ</span>
          </div>
        </div>
        <div class="dept-metric-card">
          <div class="dept-metric-icon dept-metric-icon--purple">${icon('userRound', 'md')}</div>
          <div class="dept-metric-data">
            <span class="dept-metric-val">${deptsWithManager} <small style="font-size:12px;font-weight:600;color:var(--text-3);">/ ${totalDepts}</small></span>
            <span class="dept-metric-lbl">Đã bổ nhiệm trưởng phòng</span>
          </div>
        </div>
        <div class="dept-metric-card ${unassignedUsers.length > 0 ? 'dept-metric-card--warn' : ''}">
          <div class="dept-metric-icon ${unassignedUsers.length > 0 ? 'dept-metric-icon--amber' : 'dept-metric-icon--slate'}">
            ${unassignedUsers.length > 0 ? icon('triangleAlert', 'md') : icon('circleCheck', 'md')}
          </div>
          <div class="dept-metric-data">
            <span class="dept-metric-val">${unassignedUsers.length}</span>
            <span class="dept-metric-lbl">Chưa xếp phòng ban</span>
          </div>
        </div>
      `;
    }

    // Filter departments
    const query = (document.getElementById('dept-search')?.value || '').trim();
    let filtered = currentDepts;

    if (query) {
      const qLower = query.toLowerCase();
      filtered = filtered.filter(d => {
        const dName = (d.name || '').toLowerCase();
        const dMgr = (d.manager || d.manager_name || '').toLowerCase();
        const dDesc = (d.description || '').toLowerCase();
        const members = byDept[d.name] || [];
        const memberMatch = members.some(m => (m.full_name || '').toLowerCase().includes(qLower));
        return dName.includes(qLower) || dMgr.includes(qLower) || dDesc.includes(qLower) || memberMatch;
      });
    }

    if (activeFilter === 'has-manager') {
      filtered = filtered.filter(d => Boolean(d.manager_id || (d.manager && d.manager.trim())));
    } else if (activeFilter === 'no-manager') {
      filtered = filtered.filter(d => !d.manager_id && (!d.manager || !d.manager.trim()));
    }

    if (!filtered.length) {
      gridEl.innerHTML = emptyHTML('🏢', 'Không tìm thấy phòng ban phù hợp', isAdmin ? 'Nhấn “+ Thêm phòng ban” để tạo mới.' : '');
      if (unassignedEl) unassignedEl.innerHTML = '';
      return;
    }

    gridEl.innerHTML = `
      <div class="dept-hub-grid">
        ${filtered.map(d => deptHubCardHTML(d, byDept[d.name] || [], currentUsers, isAdmin)).join('')}
      </div>
    `;

    // Bind Expandable Members toggle
    gridEl.querySelectorAll('[data-toggle-members]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const card = btn.closest('.dept-hub-card');
        const list = card.querySelector('.dept-extra-members');
        if (list) {
          const isHidden = list.classList.toggle('hidden');
          btn.innerHTML = isHidden 
            ? `<span>+${btn.dataset.count} thành viên khác ▾</span>` 
            : `<span>Thu gọn ▴</span>`;
        }
      });
    });

    // Bind Edit and Delete buttons
    if (isAdmin) {
      gridEl.querySelectorAll('.dept-hub-edit').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const d = currentDepts.find(x => x.id === parseInt(btn.dataset.did, 10));
          if (d) openDeptForm(d, loadDepts, currentDepts, currentUsers);
        });
      });

      gridEl.querySelectorAll('.dept-hub-del').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const d = currentDepts.find(x => x.id === parseInt(btn.dataset.did, 10));
          if (!d || !confirm(`Bạn có chắc chắn muốn xóa phòng ban "${d.name}"?`)) return;
          try {
            await api.deleteDepartment(d.id);
            toast('Đã xóa phòng ban thành công', 'success');
            loadDepts();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    }

    // Render Unassigned Employees Section
    if (unassignedEl) {
      if (unassignedUsers.length > 0) {
        unassignedEl.innerHTML = `
          <div class="dept-unassigned-card">
            <div class="dept-unassigned-head">
              <div class="dept-unassigned-title-group">
                <span class="dept-unassigned-icon">⚠️</span>
                <div>
                  <h3 class="dept-unassigned-title">Nhân sự chưa phân bổ phòng ban (${unassignedUsers.length} người)</h3>
                  <p class="dept-unassigned-sub">Nhấn vào nhân sự để cập nhật phòng ban công tác</p>
                </div>
              </div>
            </div>
            <div class="dept-unassigned-body">
              <div class="dept-members-chip-list">
                ${unassignedUsers.map(u => memberChipHTML(u, '#f59e0b')).join('')}
              </div>
            </div>
          </div>
        `;
      } else {
        unassignedEl.innerHTML = '';
      }
    }
  }

  el._cleanup = () => {};

  EventBus.bindView(el, 'departments', () => loadDepts());
  EventBus.bindView(el, 'department:*', () => loadDepts());
  EventBus.bindView(el, 'users', () => loadDepts());
  EventBus.bindView(el, 'user:*', () => loadDepts());

  loadDepts();
}

function memberChipHTML(u, deptColor = '#6366F1') {
  const avColor = u.avatar_color || colorForDept(u.full_name || 'NV');
  const avInitials = u.avatar_initials || (u.full_name ? u.full_name.charAt(0) : 'NV');
  return `
    <a href="#/users/${u.id}" class="dept-member-chip" title="Xem hồ sơ ${esc(u.full_name)}">
      <span class="avatar avatar-xs" style="background:${esc(avColor)};">${esc(avInitials)}</span>
      <div class="dept-member-chip-info">
        <span class="dept-member-chip-name">${esc(u.full_name)}</span>
        ${u.position ? `<span class="dept-member-chip-pos">${esc(u.position)}</span>` : ''}
      </div>
    </a>
  `;
}

function deptHubCardHTML(d, members, allUsers, isAdmin) {
  const color = colorForDept(d.name);
  const iconChar = iconForDept(d.name);
  const memberCount = members.length;
  
  // Find manager object if available
  let managerObj = null;
  if (d.manager_id) {
    managerObj = allUsers.find(u => Number(u.id) === Number(d.manager_id));
  }
  const managerName = managerObj ? managerObj.full_name : (d.manager || d.manager_name || '');
  const managerPos = managerObj ? (managerObj.position || 'Trưởng phòng') : 'Trưởng phòng';
  const managerAvColor = managerObj?.avatar_color || color;
  const managerAvInitials = managerObj?.avatar_initials || (managerName ? managerName.charAt(0) : 'TP');

  const INITIAL_SHOW = 6;
  const initialMembers = members.slice(0, INITIAL_SHOW);
  const remainingMembers = members.slice(INITIAL_SHOW);

  return `
    <div class="dept-hub-card" style="--dept-theme-color:${color}" data-did="${d.id}">
      <!-- Card Header -->
      <div class="dept-hub-header">
        <div class="dept-hub-identity">
          <div class="dept-hub-icon-box" style="background:${color}18; color:${color};">
            ${iconChar}
          </div>
          <div class="dept-hub-title-box">
            <h2 class="dept-hub-name">${esc(d.name)}</h2>
            ${d.description ? `<p class="dept-hub-desc" title="${esc(d.description)}">${esc(d.description)}</p>` : `<p class="dept-hub-desc dept-hub-desc--empty">Chưa có mô tả chức năng</p>`}
          </div>
        </div>

        ${isAdmin ? `
          <div class="dept-hub-actions print-hidden">
            <button class="dept-hub-action-btn dept-hub-edit" data-did="${d.id}" title="Chỉnh sửa phòng ban" aria-label="Chỉnh sửa">${icon('pencil', 'xs')}</button>
            <button class="dept-hub-action-btn dept-hub-del dept-hub-action-btn--danger" data-did="${d.id}" title="Xóa phòng ban" aria-label="Xóa">${icon('trash2', 'xs')}</button>
          </div>
        ` : ''}
      </div>

      <!-- Manager Row -->
      <div class="dept-hub-manager-strip">
        ${managerName ? `
          <div class="dept-hub-manager-info">
            <span class="avatar avatar-sm dept-hub-mgr-avatar" style="background:${esc(managerAvColor)};">${esc(managerAvInitials)}</span>
            <div class="dept-hub-mgr-details">
              <div class="dept-hub-mgr-header">
                <span class="dept-hub-mgr-name">${esc(managerName)}</span>
                <span class="dept-hub-mgr-tag">Trưởng bộ phận</span>
              </div>
              <span class="dept-hub-mgr-sub">${esc(managerPos)}</span>
            </div>
          </div>
        ` : `
          <div class="dept-hub-manager-unassigned">
            <span class="dept-hub-unassigned-icon">${icon('user', 'xs')}</span>
            <span class="dept-hub-unassigned-text">Chưa bổ nhiệm trưởng phòng</span>
          </div>
        `}
      </div>

      <!-- Members Section -->
      <div class="dept-hub-members-section">
        <div class="dept-hub-members-head">
          <span class="dept-hub-members-title">
            ${icon('users', 'xs')} <span>Danh sách nhân sự</span>
          </span>
          <span class="dept-hub-member-badge" style="background:${color}15; color:${color};">
            ${memberCount} thành viên
          </span>
        </div>

        ${memberCount === 0 ? `
          <div class="dept-hub-empty-members">
            Chưa có nhân sự nào trong phòng ban này
          </div>
        ` : `
          <div class="dept-members-chip-list">
            ${initialMembers.map(u => memberChipHTML(u, color)).join('')}
          </div>
          ${remainingMembers.length > 0 ? `
            <div class="dept-extra-members hidden">
              <div class="dept-members-chip-list" style="margin-top:6px;">
                ${remainingMembers.map(u => memberChipHTML(u, color)).join('')}
              </div>
            </div>
            <button type="button" class="dept-more-members-btn" data-toggle-members data-count="${remainingMembers.length}">
              <span>+${remainingMembers.length} thành viên khác ▾</span>
            </button>
          ` : ''}
        `}
      </div>
    </div>
  `;
}

function openDeptForm(dept, onRefresh = noop, existingDepts = [], users = []) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!dept;
  const managerOptions = users.map(u => {
    const label = `${u.full_name}${u.department ? ' - ' + u.department : ''}${u.position ? ' (' + u.position + ')' : ''}`;
    return `<option value="${u.id}" ${Number(dept?.manager_id) === Number(u.id) ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');

  openModal(isEdit ? 'Sửa thông tin phòng ban' : 'Thêm phòng ban mới', `
    <div class="field">
      <label>Tên phòng ban *</label>
      <input type="text" id="df-name" value="${esc(dept?.name || '')}" placeholder="Ví dụ: Phòng Marketing, Phòng Kỹ thuật..."/>
    </div>
    <div class="field">
      <label>Trưởng bộ phận / Quản lý</label>
      <select id="df-manager-id">
        <option value="">-- Chưa bổ nhiệm trưởng phòng --</option>
        ${managerOptions}
      </select>
    </div>
    <div class="field">
      <label>Mô tả chức năng & nhiệm vụ</label>
      <textarea id="df-desc" rows="3" placeholder="Mô tả chức năng hoạt động, nhiệm vụ của phòng ban...">${esc(dept?.description || '')}</textarea>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="df-save">Lưu phòng ban</button>
  `);

  const deptNormKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const deptAliases = {
    'ban giam doc': 'ban giam doc', bgd: 'ban giam doc', 'giam doc': 'ban giam doc', 'ban lanh dao': 'ban giam doc',
    hcns: 'phong hcns', 'phong hcns': 'phong hcns', 'nhan su': 'phong hcns', 'phong nhan su': 'phong hcns', 'hanh chinh nhan su': 'phong hcns', hr: 'phong hcns',
    'kinh doanh': 'phong kinh doanh', 'phong kinh doanh': 'phong kinh doanh', sale: 'phong kinh doanh', sales: 'phong kinh doanh', 'phong sale': 'phong kinh doanh', 'account sales': 'phong kinh doanh', account: 'phong kinh doanh', 'business development': 'phong kinh doanh',
    marketing: 'phong marketing', 'phong marketing': 'phong marketing', 'content marketing': 'phong marketing', 'seo sem': 'phong marketing', 'social media': 'phong marketing', design: 'phong marketing', performance: 'phong marketing', 'pr events': 'phong marketing', 'pr & events': 'phong marketing', 'truyen thong': 'phong marketing', 'digital ads': 'phong marketing', ads: 'phong marketing', 'quang cao': 'phong marketing',
    'bien tap': 'phong bien tap', 'phong bien tap': 'phong bien tap', 'noi dung': 'phong bien tap',
    'san xuat phim': 'phong san xuat phim', 'phong san xuat phim': 'phong san xuat phim', production: 'phong san xuat phim', 'san xuat': 'phong san xuat phim',
    gameshow: 'phong gameshow', 'phong gameshow': 'phong gameshow', 'game show': 'phong gameshow',
    'ke toan': 'phong ke toan', 'phong ke toan': 'phong ke toan', accounting: 'phong ke toan', 'tai chinh ke toan': 'phong ke toan',
  };
  const deptUniqueKey = (name) => {
    const key = deptNormKey(String(name || '').trim().replace(/\s+/g, ' '));
    return deptAliases[key] || key;
  };

  document.getElementById('df-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('df-save');
    const name = document.getElementById('df-name').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Vui lòng nhập tên phòng ban', 'error'); return; }
    const dup = existingDepts.some(d => deptUniqueKey(d.name) === deptUniqueKey(name) && (!isEdit || Number(d.id) !== Number(dept.id)));
    if (dup) { toast('Phòng ban này đã tồn tại', 'error'); return; }
    const data = {
      name,
      manager_id: document.getElementById('df-manager-id').value || null,
      description: document.getElementById('df-desc').value.trim(),
    };
    try {
      saveBtn.disabled = true;
      if (isEdit) await api.updateDepartment(dept.id, data);
      else await api.createDepartment(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật phòng ban' : 'Đã tạo phòng ban thành công', 'success');
      onRefresh();
    } catch (e) {
      toast(e.message, 'error');
      saveBtn.disabled = false;
    }
  });
}
