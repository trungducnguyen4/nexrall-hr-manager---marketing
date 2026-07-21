import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML, fmtMoney, noop, safeCb } from '../utils.js';

const CAMPAIGN_TYPES = [
  { value: 'social',    label: 'Social Media',    icon: '📱', color: '#6366F1' },
  { value: 'seo',       label: 'SEO/SEM',          icon: '🔍', color: '#10B981' },
  { value: 'email',     label: 'Email Marketing',  icon: '📧', color: '#3B82F6' },
  { value: 'content',   label: 'Content Marketing',icon: '📝', color: '#F59E0B' },
  { value: 'pr',        label: 'PR & Events',       icon: '🤝', color: '#8B5CF6' },
  { value: 'performance',label:'Performance Ads',   icon: '📊', color: '#EF4444' },
  { value: 'other',     label: 'Khác',             icon: '🎯', color: '#64748B' },
];

const CAMPAIGN_STATUS = [
  { value: 'planning', label: 'Lên kế hoạch', cls: 'badge-gray'   },
  { value: 'active',   label: 'Đang chạy',     cls: 'badge-success' },
  { value: 'paused',   label: 'Tạm dừng',      cls: 'badge-warning' },
  { value: 'done',     label: 'Hoàn thành',    cls: 'badge-info'    },
  { value: 'cancelled',label: 'Hủy',            cls: 'badge-danger'  },
];

function campaignType(v) { return CAMPAIGN_TYPES.find(t => t.value === v) || { label: v, icon: '🎯', color: '#64748B' }; }
function campaignStatus(v) { return CAMPAIGN_STATUS.find(s => s.value === v) || { label: v||'—', cls:'badge-gray' }; }

export async function renderCampaigns(el, me) {
  const isAdmin = me.role === 'admin' || me.role === 'manager';

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">📣 Chiến dịch Marketing</div>
        <div class="page-sub">Quản lý toàn bộ chiến dịch marketing công ty</div>
      </div>
      ${isAdmin ? `<button id="btn-new-campaign" class="btn-primary btn-sm">+ Tạo chiến dịch</button>` : ''}
    </div>

    <!-- Stats -->
    <div id="campaign-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;">${loadingHTML()}</div>

    <!-- Filter -->
    <div class="filter-bar" id="campaign-filter">
      <span class="filter-chip active" data-status="">Tất cả</span>
      ${CAMPAIGN_STATUS.map(s => `<span class="filter-chip" data-status="${s.value}">${s.label}</span>`).join('')}
    </div>

    <!-- Type filter -->
    <div class="filter-bar" id="campaign-type-filter">
      <span class="filter-chip active" data-type="">Mọi loại</span>
      ${CAMPAIGN_TYPES.map(t => `<span class="filter-chip" data-type="${t.value}">${t.icon} ${t.label}</span>`).join('')}
    </div>

    <div id="campaign-list">${loadingHTML()}</div>
  `;

  if (isAdmin) {
    document.getElementById('btn-new-campaign').addEventListener('click', () => openCampaignForm(null, loadCampaigns));
  }

  document.getElementById('campaign-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('#campaign-filter .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    loadCampaigns();
  });
  document.getElementById('campaign-type-filter').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('#campaign-type-filter .filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    loadCampaigns();
  });

  let allCampaigns = [];

  async function loadCampaigns() {
    const listEl = document.getElementById('campaign-list');
    if (!listEl) return;
    try {
      if (!allCampaigns.length) {
        listEl.innerHTML = loadingHTML();
        const res = await api.getCampaigns();
        allCampaigns = res.campaigns || [];

        // Stats
        const statsEl = document.getElementById('campaign-stats');
        if (statsEl) {
          const active   = allCampaigns.filter(c => c.status === 'active').length;
          const done     = allCampaigns.filter(c => c.status === 'done').length;
          const totalBud = allCampaigns.reduce((s, c) => s + (c.budget||0), 0);
          const totalSpent = allCampaigns.reduce((s, c) => s + (c.spent||0), 0);
          statsEl.innerHTML = `
            <div class="stat-card" style="--stat-color:#6366F1;--stat-bg:#EEF2FF;">
              <div class="stat-icon-wrap">📣</div>
              <div class="stat-val">${allCampaigns.length}</div>
              <div class="stat-label">Tổng chiến dịch</div>
            </div>
            <div class="stat-card" style="--stat-color:#10B981;--stat-bg:#D1FAE5;">
              <div class="stat-icon-wrap">▶️</div>
              <div class="stat-val">${active}</div>
              <div class="stat-label">Đang chạy</div>
            </div>
            <div class="stat-card" style="--stat-color:#3B82F6;--stat-bg:#DBEAFE;">
              <div class="stat-icon-wrap">💰</div>
              <div class="stat-val" style="font-size:14px;">${fmtMoney(totalBud)}</div>
              <div class="stat-label">Tổng ngân sách</div>
            </div>
            <div class="stat-card" style="--stat-color:#F59E0B;--stat-bg:#FEF3C7;">
              <div class="stat-icon-wrap">📊</div>
              <div class="stat-val">${done}</div>
              <div class="stat-label">Đã hoàn thành</div>
            </div>
          `;
        }
      }

      const statusFilter = document.querySelector('#campaign-filter .filter-chip.active')?.dataset.status || '';
      const typeFilter   = document.querySelector('#campaign-type-filter .filter-chip.active')?.dataset.type || '';

      let filtered = allCampaigns;
      if (statusFilter) filtered = filtered.filter(c => c.status === statusFilter);
      if (typeFilter)   filtered = filtered.filter(c => c.type   === typeFilter);

      if (!filtered.length) {
        listEl.innerHTML = emptyHTML('📣', 'Không có chiến dịch nào', isAdmin ? 'Nhấn "+ Tạo chiến dịch" để bắt đầu' : '');
        return;
      }

      listEl.innerHTML = filtered.map(c => {
        const ct     = campaignType(c.type);
        const cs     = campaignStatus(c.status);
        const budget = c.budget || 0;
        const spent  = c.spent  || 0;
        const pct    = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;

        return `
          <div class="campaign-card" data-cid="${c.id}">
            <div style="display:flex;align-items:flex-start;gap:12px;">
              <div style="width:46px;height:46px;border-radius:12px;background:${ct.color}20;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${ct.icon}</div>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                  <span class="campaign-name">${esc(c.name)}</span>
                  <span class="badge ${cs.cls}">${cs.label}</span>
                </div>
                <div class="campaign-meta">
                  <span style="font-size:11px;background:${ct.color}15;color:${ct.color};padding:3px 8px;border-radius:5px;font-weight:600;">${ct.label}</span>
                  ${c.owner_name ? `<span style="font-size:12px;color:var(--text-2);">👤 ${esc(c.owner_name)}</span>` : ''}
                  ${c.start_date ? `<span style="font-size:11px;color:var(--text-3);">📅 ${esc(c.start_date)} → ${esc(c.end_date||'—')}</span>` : ''}
                </div>
                ${c.description ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:8px;">${esc(c.description)}</div>` : ''}
                ${budget > 0 ? `
                  <div style="margin-top:6px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-2);margin-bottom:4px;">
                      <span>Ngân sách: <strong>${fmtMoney(budget)}</strong></span>
                      <span>Chi: <strong style="color:${pct>80?'var(--danger)':'var(--text)'}">${fmtMoney(spent)}</strong> (${pct}%)</span>
                    </div>
                    <div class="kpi-bar"><div class="kpi-fill" style="width:${pct}%;background:${pct>80?'var(--danger)':ct.color};"></div></div>
                  </div>
                ` : ''}
                ${(c.goal_reach||c.goal_leads||c.goal_conversions) ? `
                  <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;">
                    ${c.goal_reach ? `<div style="font-size:11px;color:var(--text-2);">👁️ Reach: <strong>${Number(c.goal_reach).toLocaleString()}</strong></div>` : ''}
                    ${c.goal_leads ? `<div style="font-size:11px;color:var(--text-2);">🎯 Leads: <strong>${Number(c.goal_leads).toLocaleString()}</strong></div>` : ''}
                    ${c.goal_conversions ? `<div style="font-size:11px;color:var(--text-2);">✅ Conv: <strong>${Number(c.goal_conversions).toLocaleString()}</strong></div>` : ''}
                  </div>
                ` : ''}
              </div>
              ${isAdmin ? `
                <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
                  <button class="btn-xs btn-secondary camp-edit" data-cid="${c.id}">✏️</button>
                  <button class="btn-xs btn-danger camp-del" data-cid="${c.id}">🗑</button>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      if (isAdmin) {
        listEl.querySelectorAll('.camp-edit').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const c = allCampaigns.find(x => x.id === parseInt(btn.dataset.cid));
            if (c) { allCampaigns = []; openCampaignForm(c, loadCampaigns); }
          });
        });
        listEl.querySelectorAll('.camp-del').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Xóa chiến dịch này?')) return;
            try {
              await api.deleteCampaign(btn.dataset.cid);
              allCampaigns = allCampaigns.filter(x => x.id !== parseInt(btn.dataset.cid));
              toast('Đã xóa chiến dịch', 'success');
              loadCampaigns();
            } catch(e) { toast(e.message, 'error'); }
          });
        });
      }
    } catch(e) {
      listEl.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  loadCampaigns();
}

function openCampaignForm(c, onRefresh = noop) {
  onRefresh = safeCb(onRefresh);
  const isEdit = !!c;
  openModal(isEdit ? 'Sửa chiến dịch' : 'Tạo chiến dịch mới', `
    <div class="field"><label>Tên chiến dịch *</label>
      <input type="text" id="campf-name" value="${esc(c?.name||'')}" placeholder="Vd: Summer Sale 2025"/>
    </div>
    <div class="input-row">
      <div class="field"><label>Loại</label>
        <select id="campf-type">
          ${CAMPAIGN_TYPES.map(t => `<option value="${t.value}" ${c?.type===t.value?'selected':''}>${t.icon} ${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Trạng thái</label>
        <select id="campf-status">
          ${CAMPAIGN_STATUS.map(s => `<option value="${s.value}" ${c?.status===s.value?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Ngày bắt đầu</label>
        <input type="date" id="campf-start" value="${c?.start_date||''}"/>
      </div>
      <div class="field"><label>Ngày kết thúc</label>
        <input type="date" id="campf-end" value="${c?.end_date||''}"/>
      </div>
    </div>
    <div class="input-row">
      <div class="field"><label>Ngân sách (VNĐ)</label>
        <input type="number" id="campf-budget" value="${c?.budget||0}" min="0" step="100000"/>
      </div>
      <div class="field"><label>Đã chi (VNĐ)</label>
        <input type="number" id="campf-spent" value="${c?.spent||0}" min="0" step="100000"/>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div class="field"><label>Mục tiêu Reach</label>
        <input type="number" id="campf-reach" value="${c?.goal_reach||0}" min="0"/>
      </div>
      <div class="field"><label>Mục tiêu Leads</label>
        <input type="number" id="campf-leads" value="${c?.goal_leads||0}" min="0"/>
      </div>
      <div class="field"><label>Mục tiêu Conv.</label>
        <input type="number" id="campf-conv" value="${c?.goal_conversions||0}" min="0"/>
      </div>
    </div>
    <div class="field"><label>Người phụ trách</label>
      <input type="text" id="campf-owner" value="${esc(c?.owner_name||'')}" placeholder="Tên người phụ trách"/>
    </div>
    <div class="field"><label>Mô tả</label>
      <textarea id="campf-desc" rows="3" placeholder="Mô tả chiến dịch...">${esc(c?.description||'')}</textarea>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="campf-del">Xóa</button>` : ''}
    <button class="btn-primary" id="campf-save">Lưu</button>
  `);

  document.getElementById('campf-save').addEventListener('click', async () => {
    const name = document.getElementById('campf-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên chiến dịch', 'error'); return; }
    const data = {
      name,
      type:             document.getElementById('campf-type').value,
      status:           document.getElementById('campf-status').value,
      start_date:       document.getElementById('campf-start').value,
      end_date:         document.getElementById('campf-end').value,
      budget:           parseFloat(document.getElementById('campf-budget').value)||0,
      spent:            parseFloat(document.getElementById('campf-spent').value)||0,
      goal_reach:       parseInt(document.getElementById('campf-reach').value)||0,
      goal_leads:       parseInt(document.getElementById('campf-leads').value)||0,
      goal_conversions: parseInt(document.getElementById('campf-conv').value)||0,
      owner_name:       document.getElementById('campf-owner').value.trim(),
      description:      document.getElementById('campf-desc').value.trim(),
    };
    try {
      if (isEdit) await api.updateCampaign(c.id, data);
      else await api.createCampaign(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật chiến dịch' : 'Đã tạo chiến dịch', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });

  document.getElementById('campf-del')?.addEventListener('click', async () => {
    if (!confirm(`Xóa chiến dịch "${c.name}"?`)) return;
    try {
      await api.deleteCampaign(c.id);
      closeModal();
      toast('Đã xóa', 'success');
      onRefresh();
    } catch(e) { toast(e.message, 'error'); }
  });
}
