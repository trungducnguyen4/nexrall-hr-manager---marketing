import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, DEPARTMENTS, noop, safeCb } from '../utils.js';

const DEPT_COLORS = [
  '#6366F1','#10B981','#F59E0B','#EF4444','#3B82F6',
  '#8B5CF6','#14B8A6','#F97316','#EC4899','#64748B',
];
const DEPT_ICONS = [
  '📣','📝','🔍','📱','🎨','📊','🤝','💻','📡','🏆',
];

function colorForDept(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length];
}
function iconForDept(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 17 + name.charCodeAt(i)) & 0xffffffff;
  return DEPT_ICONS[Math.abs(h) % DEPT_ICONS.length];
}

export async function renderDepartments(el, me) {
  const isAdmin = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">🏢 Phòng ban</div>
        <div class="page-sub">Cơ cấu tổ chức công ty marketing</div>
      </div>
      ${isAdmin ? `<button id="btn-new-dept" class="btn-primary btn-sm">+ Thêm phòng ban</button>` : ''}
    </div>

    <!-- Org overview cards -->
    <div id="dept-list">${loadingHTML()}</div>

    <!-- Employees per dept -->
    <div id="dept-employees" style="margin-top:20px;"></div>
  `;

  let currentDepts = [];

  if (isAdmin) {
    document.getElementById('btn-new-dept').addEventListener('click', () => openDeptForm(null, loadDepts, currentDepts));
  }

  async function loadDepts() {
    const listEl = document.getElementById('dept-list');
    if (!listEl) return;
    listEl.innerHTML = loadingHTML();
    try {
      const [deptsRes, usersRes] = await Promise.allSettled([
        api.getDepartments(),
        api.getUsers(),
      ]);
      const depts = deptsRes.status === 'fulfilled' ? (deptsRes.value.departments || []) : [];
      const users = usersRes.status === 'fulfilled' ? (usersRes.value.users || []) : [];
      currentDepts = depts;

      if (!depts.length) {
        listEl.innerHTML = emptyHTML('🏢', 'Chưa có phòng ban nào', isAdmin ? 'Nhấn + Thêm phòng ban để bắt đầu' : '');
        return;
      }

      // Count employees per department
      const countMap = {};
      users.forEach(u => {
        if (u.department) countMap[u.department] = (countMap[u.department] || 0) + 1;
      });

      listEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr;gap:10px;">
          ${depts.map(d => {
            const color = colorForDept(d.name);
            const icon = iconForDept(d.name);
            const empCount = countMap[d.name] || 0;
            return `
              <div class="dept-card" style="--dept-color:${color}" data-did="${d.id}">
                <div style="display:flex;align-items:flex-start;gap:14px;">
                  <div style="width:48px;height:48px;border-radius:12px;background:${color}20;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">${icon}</div>
                  <div style="flex:1;min-width:0;">
                    <div class="dept-card-name">${esc(d.name)}</div>
                    ${d.manager ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:6px;">👤 Trưởng phòng: <strong>${esc(d.manager)}</strong></div>` : ''}
                    ${d.description ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:8px;">${esc(d.description)}</div>` : ''}
                    <div class="dept-card-meta">
                      <span class="dept-card-stat" style="background:${color}15;padding:3px 8px;border-radius:6px;color:${color};font-weight:600;">
                        👥 ${empCount} nhân viên
                      </span>
                    </div>
                  </div>
                  ${isAdmin ? `
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                      <button class="btn-xs btn-secondary dept-edit" data-did="${d.id}">✏️</button>
                      <button class="btn-xs btn-danger dept-del" data-did="${d.id}">🗑</button>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Show employees per department
      const empEl = document.getElementById('dept-employees');
      if (users.length) {
        const byDept = {};
        users.forEach(u => {
          const key = u.department || 'Không có phòng ban';
          if (!byDept[key]) byDept[key] = [];
          byDept[key].push(u);
        });

        empEl.innerHTML = `
          <div class="section-title">Nhân viên theo phòng ban</div>
          ${Object.entries(byDept).map(([dept, members]) => {
            const color = colorForDept(dept);
            return `
              <div class="card" style="margin-bottom:12px;">
                <div class="card-header">
                  <div class="card-title" style="color:${color}">${iconForDept(dept)} ${esc(dept)}</div>
                  <span class="badge" style="background:${color}20;color:${color};">${members.length} người</span>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${members.map(u => `
                    <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
                      <div class="avatar avatar-sm" style="background:${esc(u.avatar_color||color)}">${esc(u.avatar_initials||u.full_name.charAt(0))}</div>
                      <div>
                        <div style="font-size:12px;font-weight:600;color:var(--text);">${esc(u.full_name)}</div>
                        <div style="font-size:11px;color:var(--text-3);">${esc(u.position||'—')}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        `;
      }

      if (isAdmin) {
        listEl.querySelectorAll('.dept-edit').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const d = depts.find(x => x.id === parseInt(btn.dataset.did));
            if (d) openDeptForm(d, loadDepts, currentDepts);
          });
        });
        listEl.querySelectorAll('.dept-del').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const d = depts.find(x => x.id === parseInt(btn.dataset.did));
            if (!d || !confirm(`Xóa phòng ban "${d.name}"?`)) return;
            try {
              await api.deleteDepartment(d.id);
              toast('Đã xóa phòng ban', 'success');
              loadDepts();
            } catch(err) { toast(err.message, 'error'); }
          });
        });
      }
    } catch(e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  loadDepts();
}

function openDeptForm(dept, onRefresh = noop, existingDepts = []) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!dept;
  openModal(isEdit ? 'Sửa phòng ban' : 'Thêm phòng ban', `
    <div class="field"><label>Tên phòng ban *</label>
      <select id="df-name">
        <option value="">-- Chọn phòng ban --</option>
        ${DEPARTMENTS.map(d => `<option value="${esc(d)}" ${dept?.name===d?'selected':''}>${esc(d)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Trưởng phòng</label>
      <input type="text" id="df-manager" value="${esc(dept?.manager||'')}" placeholder="Nguyễn Văn A"/>
    </div>
    <div class="field"><label>Mô tả</label>
      <textarea id="df-desc" rows="3" placeholder="Mô tả hoạt động của phòng ban...">${esc(dept?.description||'')}</textarea>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="df-save">Lưu</button>
  `);

  document.getElementById('df-save').addEventListener('click', async () => {
    const name = document.getElementById('df-name').value;
    if (!name) { toast('Vui lòng chọn phòng ban', 'error'); return; }
    const dup = existingDepts.some(d => d.name === name && (!isEdit || d.id !== dept.id));
    if (dup) { toast('Phòng ban này đã tồn tại', 'error'); return; }
    const data = {
      name,
      manager: document.getElementById('df-manager').value.trim(),
      description: document.getElementById('df-desc').value.trim(),
    };
    try {
      if (isEdit) await api.updateDepartment(dept.id, data);
      else await api.createDepartment(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật phòng ban' : 'Đã tạo phòng ban', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });
}
