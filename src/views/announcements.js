import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { esc, fmtDate, openModal, closeModal, toast } from '../utils.js';
import { icon } from '../icons.js';
import { refreshAnnouncementBadge } from '../app.js';

function announcementSkeleton() {
  return `
    <div class="announcement-list">
      ${Array.from({ length: 3 }, () => `
        <div class="announcement-card" style="opacity:0.6;">
          <div style="height:20px;width:160px;background:var(--border);border-radius:4px;margin-bottom:12px;"></div>
          <div style="height:24px;width:70%;background:var(--border);border-radius:4px;margin-bottom:14px;"></div>
          <div style="height:16px;width:95%;background:var(--border);border-radius:4px;margin-bottom:8px;"></div>
          <div style="height:16px;width:80%;background:var(--border);border-radius:4px;"></div>
        </div>
      `).join('')}
    </div>
  `;
}

export async function renderAnnouncements(el, me, route) {
  let state = {
    announcements: [],
    canManage: false,
    activeTab: 'all', // all | unread | important | dept
    search: '',
    loading: true,
  };

  el.innerHTML = `
    <section class="announcement-container">
      <header class="announcement-page-head">
        <div>
          <p class="employee-page-kicker">Thông tin &amp; Quyết định</p>
          <h1><span data-icon="megaphone" data-icon-size="md"></span> <span>Thông báo nội bộ</span></h1>
          <p>Các thông báo, quyết định và tin tức chính thức từ Ban Quản trị và HCNS.</p>
        </div>
        <div class="announcement-head-actions" id="ann-header-actions">
          <button type="button" class="btn-secondary btn-sm" id="ann-mark-all-read" title="Đánh dấu tất cả thông báo là đã đọc">
            <span data-icon="checkCheck" data-icon-size="sm"></span> <span>Đã đọc tất cả</span>
          </button>
          <button type="button" class="btn-primary btn-sm hidden" id="ann-create-btn">
            <span data-icon="plus" data-icon-size="sm"></span> <span>Đăng thông báo mới</span>
          </button>
        </div>
      </header>

      <!-- Toolbar & Filters -->
      <div class="announcement-toolbar-card">
        <div class="announcement-search-row">
          <div class="announcement-search-box">
            <span class="search-icon"><span data-icon="search" data-icon-size="sm"></span></span>
            <input id="ann-search" type="search" placeholder="Tìm theo tiêu đề, nội dung, người đăng..." autocomplete="off"/>
          </div>
          <button type="button" class="btn-secondary btn-sm" id="ann-refresh-btn" title="Tải lại danh sách">
            <span data-icon="refreshCw" data-icon-size="sm"></span> <span>Làm mới</span>
          </button>
        </div>

        <div class="announcement-tabs-row" id="ann-tabs">
          <button type="button" class="notif-tab-pill active" data-tab="all">
            <span>Tất cả</span>
            <span class="filter-count-badge" id="ann-count-all" style="display:none;">0</span>
          </button>
          <button type="button" class="notif-tab-pill" data-tab="unread">
            <span>Chưa đọc</span>
            <span class="filter-count-badge" id="ann-count-unread" style="display:none;background:#EA580C;color:#FFF;">0</span>
          </button>
          <button type="button" class="notif-tab-pill" data-tab="important">
            <span style="display:inline-flex;align-items:center;gap:4px;">
              <span data-icon="circleAlert" data-icon-size="xs"></span>
              <span>Quan trọng</span>
            </span>
          </button>
          <button type="button" class="notif-tab-pill" data-tab="dept">
            <span>Phòng ban</span>
          </button>
        </div>
      </div>

      <!-- Announcements List Container -->
      <div id="ann-list-wrap">
        ${announcementSkeleton()}
      </div>
    </section>
  `;

  const searchInput = el.querySelector('#ann-search');
  const markAllBtn = el.querySelector('#ann-mark-all-read');
  const createBtn = el.querySelector('#ann-create-btn');
  const refreshBtn = el.querySelector('#ann-refresh-btn');
  const listWrap = el.querySelector('#ann-list-wrap');
  const tabsWrap = el.querySelector('#ann-tabs');

  let searchDebounce = null;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = e.target.value.trim().toLowerCase();
      renderList();
    }, 200);
  });

  tabsWrap?.addEventListener('click', (e) => {
    const pill = e.target.closest('.notif-tab-pill');
    if (!pill) return;
    tabsWrap.querySelectorAll('.notif-tab-pill').forEach(b => b.classList.remove('active'));
    pill.classList.add('active');
    state.activeTab = pill.dataset.tab;
    renderList();
  });

  refreshBtn?.addEventListener('click', () => loadData());

  markAllBtn?.addEventListener('click', async () => {
    try {
      await api.markAllAnnouncementsRead();
      state.announcements.forEach(a => { a.is_read = 1; });
      refreshAnnouncementBadge(true);
      renderList();
      toast('Đã đánh dấu toàn bộ thông báo là đã đọc', 'success');
    } catch (err) {
      toast(err.message || 'Không thể đánh dấu đã đọc', 'error');
    }
  });

  createBtn?.addEventListener('click', () => openCreateModal());

  async function loadData() {
    state.loading = true;
    listWrap.innerHTML = announcementSkeleton();
    try {
      const res = await api.getAnnouncements();
      state.announcements = res.announcements || [];
      state.canManage = !!res.can_manage;
      state.loading = false;

      if (state.canManage && createBtn) {
        createBtn.classList.remove('hidden');
      }

      renderList();
    } catch (err) {
      state.loading = false;
      listWrap.innerHTML = `
        <div class="reference-empty">
          <span data-icon="triangleAlert" data-icon-size="lg"></span>
          <p>Không thể tải danh sách thông báo: ${esc(err.message || 'Lỗi kết nối')}</p>
          <button class="btn-secondary btn-sm" id="ann-retry-btn" style="margin-top:8px;">Thử lại</button>
        </div>
      `;
      listWrap.querySelector('#ann-retry-btn')?.addEventListener('click', () => loadData());
    }
  }

  function renderList() {
    const unreadTotal = state.announcements.filter(a => !a.is_read).length;
    const countAllEl = el.querySelector('#ann-count-all');
    const countUnreadEl = el.querySelector('#ann-count-unread');

    if (countAllEl) {
      countAllEl.textContent = state.announcements.length;
      countAllEl.style.display = state.announcements.length ? 'inline-block' : 'none';
    }
    if (countUnreadEl) {
      countUnreadEl.textContent = unreadTotal;
      countUnreadEl.style.display = unreadTotal > 0 ? 'inline-block' : 'none';
    }

    let filtered = state.announcements;

    if (state.activeTab === 'unread') {
      filtered = filtered.filter(a => !a.is_read);
    } else if (state.activeTab === 'important') {
      filtered = filtered.filter(a => a.priority === 'important');
    } else if (state.activeTab === 'dept') {
      filtered = filtered.filter(a => a.target_scope === 'department');
    }

    if (state.search) {
      filtered = filtered.filter(a =>
        (a.title || '').toLowerCase().includes(state.search) ||
        (a.content || '').toLowerCase().includes(state.search) ||
        (a.creator_name || '').toLowerCase().includes(state.search)
      );
    }

    if (!filtered.length) {
      let emptyMsg = 'Chưa có thông báo nào.';
      if (state.activeTab === 'unread') emptyMsg = 'Tuyệt vời! Bạn đã đọc hết tất cả thông báo.';
      else if (state.activeTab === 'important') emptyMsg = 'Không có thông báo quan trọng nào.';
      else if (state.search) emptyMsg = `Không tìm thấy thông báo phù hợp với "${esc(state.search)}".`;

      listWrap.innerHTML = `
        <div class="reference-empty">
          <span data-icon="megaphone" data-icon-size="lg"></span>
          <p style="margin-top:8px;">${emptyMsg}</p>
        </div>
      `;
      if (window.normalizeIcons) window.normalizeIcons(listWrap);
      return;
    }

    listWrap.innerHTML = `
      <div class="announcement-list">
        ${filtered.map(a => renderCard(a)).join('')}
      </div>
    `;

    if (window.normalizeIcons) window.normalizeIcons(listWrap);
    bindCardEvents();
  }

  function renderCard(a) {
    const isUnread = !a.is_read;
    const isImportant = a.priority === 'important';
    const isScopeAll = a.target_scope === 'all';
    const canEdit = state.canManage || a.created_by === me.id;

    const initials = (a.creator_name || 'AD')
      .split(' ')
      .filter(Boolean)
      .slice(-2)
      .map(w => w[0].toUpperCase())
      .join('');

    const formattedDate = a.created_at ? fmtDate(a.created_at.slice(0, 10)) : '';
    const formattedTime = a.created_at ? a.created_at.slice(11, 16) : '';

    return `
      <article class="announcement-card ${isUnread ? 'is-unread' : ''} ${isImportant ? 'is-important' : ''}" data-id="${a.id}">
        <div class="announcement-card-head">
          <div class="announcement-author-info">
            <div class="avatar avatar-md" style="background:#4F46E5;color:#FFF;font-weight:700;">${initials}</div>
            <div class="announcement-author-meta">
              <span class="announcement-author-name">${esc(a.creator_name || 'Ban Quản Trị')}</span>
              <span class="announcement-author-dept">${esc(a.creator_department || a.creator_role || 'Quản lý')}</span>
            </div>
          </div>

          <div class="announcement-badges">
            ${isUnread ? `<span class="ann-badge ann-badge-new">MỚI</span>` : ''}
            ${isImportant ? `<span class="ann-badge ann-badge-important"><span data-icon="circleAlert" data-icon-size="xs"></span> Quan trọng</span>` : `<span class="ann-badge ann-badge-normal">Thông thường</span>`}
            ${isScopeAll ? `<span class="ann-badge ann-badge-scope-all">Toàn công ty</span>` : `<span class="ann-badge ann-badge-scope-dept">Phòng: ${esc(a.target_department || 'Bộ phận')}</span>`}
            ${canEdit ? `
              <div class="ann-manage-actions" style="margin-left:4px;">
                <button type="button" class="btn-icon btn-sm ann-edit-btn" data-id="${a.id}" title="Chỉnh sửa"><span data-icon="pencil" data-icon-size="xs"></span></button>
                <button type="button" class="btn-icon btn-sm ann-del-btn" data-id="${a.id}" title="Xóa thông báo" style="color:#DC2626;"><span data-icon="trash2" data-icon-size="xs"></span></button>
              </div>
            ` : ''}
          </div>
        </div>

        <h2 class="announcement-card-title">${esc(a.title)}</h2>
        <div class="announcement-card-content">${esc(a.content)}</div>

        ${a.attachment_url ? `
          <div>
            <a href="${esc(a.attachment_url)}" target="_blank" rel="noopener noreferrer" class="announcement-attachment-pill" download="${esc(a.attachment_name || 'tai-lieu')}">
              <span data-icon="paperclip" data-icon-size="sm"></span>
              <span>${esc(a.attachment_name || 'Xem tệp đính kèm')}</span>
            </a>
          </div>
        ` : ''}

        <div class="announcement-card-foot">
          <span class="announcement-time">
            <span data-icon="clock3" data-icon-size="xs"></span>
            <span>${formattedTime ? `${formattedTime}, ` : ''}${formattedDate}</span>
          </span>

          <div class="announcement-foot-actions">
            ${isUnread ? `
              <button type="button" class="btn-secondary btn-sm ann-mark-read-btn" data-id="${a.id}">
                <span data-icon="check" data-icon-size="xs"></span> <span>Đánh dấu đã đọc</span>
              </button>
            ` : `
              <span class="ann-read-status">
                <span data-icon="checkCheck" data-icon-size="xs"></span> <span>Đã đọc</span>
              </span>
            `}
          </div>
        </div>
      </article>
    `;
  }

  function bindCardEvents() {
    listWrap.querySelectorAll('.ann-mark-read-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = parseInt(btn.dataset.id, 10);
        await markSingleRead(id);
      });
    });

    listWrap.querySelectorAll('.ann-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const item = state.announcements.find(a => a.id === id);
        if (item) openEditModal(item);
      });
    });

    listWrap.querySelectorAll('.ann-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        if (!confirm('Bạn có chắc chắn muốn xóa thông báo này không?')) return;
        try {
          await api.deleteAnnouncement(id);
          state.announcements = state.announcements.filter(a => a.id !== id);
          refreshAnnouncementBadge();
          renderList();
          toast('Đã xóa thông báo', 'info');
        } catch (err) {
          toast(err.message || 'Không thể xóa thông báo', 'error');
        }
      });
    });

    listWrap.querySelectorAll('.announcement-card.is-unread').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const id = parseInt(card.dataset.id, 10);
        await markSingleRead(id);
      });
    });
  }

  async function markSingleRead(id) {
    const item = state.announcements.find(a => a.id === id);
    if (!item || item.is_read) return;
    try {
      await api.markAnnouncementRead(id);
      item.is_read = 1;
      refreshAnnouncementBadge();
      renderList();
    } catch (_) {}
  }

  function openCreateModal() {
    const body = `
      <form id="ann-form" style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Tiêu đề thông báo *</label>
          <input id="form-ann-title" type="text" class="input" placeholder="Nhập tiêu đề thông báo ngắn gọn, rõ ràng" required/>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="field">
            <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Mức độ ưu tiên</label>
            <select id="form-ann-priority" class="input">
              <option value="normal" selected>Thông thường</option>
              <option value="important">Quan trọng</option>
            </select>
          </div>

          <div class="field">
            <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Phạm vi gửi</label>
            <select id="form-ann-scope" class="input">
              <option value="all" selected>Toàn công ty</option>
              <option value="department">Theo phòng ban</option>
            </select>
          </div>
        </div>

        <div class="field" id="form-dept-field" style="display:none;">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Chọn phòng ban *</label>
          <select id="form-ann-dept" class="input">
            <option value="Phòng Marketing">Phòng Marketing</option>
            <option value="Phòng HCNS">Phòng HCNS</option>
            <option value="Phòng IT">Phòng IT</option>
            <option value="Ban Giám Đốc">Ban Giám Đốc</option>
            <option value="Thực Tập Sinh">Thực Tập Sinh</option>
          </select>
        </div>

        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Nội dung chi tiết *</label>
          <textarea id="form-ann-content" class="input" rows="7" placeholder="Nhập nội dung thông báo đầy đủ..." required style="resize:vertical;"></textarea>
        </div>

        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Liên kết tệp / Ảnh đính kèm (Tùy chọn)</label>
          <input id="form-ann-attachment-url" type="url" class="input" placeholder="https://drive.google.com/... hoặc đường dẫn tài liệu"/>
        </div>

        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Tên hiển thị của tệp (Tùy chọn)</label>
          <input id="form-ann-attachment-name" type="text" class="input" placeholder="Ví dụ: Quy_dinh_moi_2026.pdf"/>
        </div>
      </form>
    `;

    const footer = `
      <button type="button" class="btn-secondary" id="ann-modal-cancel">Hủy</button>
      <button type="submit" form="ann-form" class="btn-primary" id="ann-modal-submit">Đăng thông báo</button>
    `;

    openModal('Đăng thông báo mới', body, footer);

    const scopeSelect = document.getElementById('form-ann-scope');
    const deptField = document.getElementById('form-dept-field');
    scopeSelect?.addEventListener('change', () => {
      deptField.style.display = scopeSelect.value === 'department' ? 'block' : 'none';
    });

    document.getElementById('ann-modal-cancel')?.addEventListener('click', closeModal);

    document.getElementById('ann-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('form-ann-title')?.value.trim();
      const content = document.getElementById('form-ann-content')?.value.trim();
      const priority = document.getElementById('form-ann-priority')?.value;
      const targetScope = document.getElementById('form-ann-scope')?.value;
      const targetDepartment = targetScope === 'department' ? document.getElementById('form-ann-dept')?.value : null;
      const attachmentUrl = document.getElementById('form-ann-attachment-url')?.value.trim() || null;
      const attachmentName = document.getElementById('form-ann-attachment-name')?.value.trim() || null;

      if (!title || !content) return;
      const submitBtn = document.getElementById('ann-modal-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Đang đăng...'; }

      try {
        const res = await api.createAnnouncement({
          title, content, priority,
          target_scope: targetScope,
          target_department: targetDepartment,
          attachment_url: attachmentUrl,
          attachment_name: attachmentName
        });
        closeModal();
        toast('Đã đăng thông báo thành công!', 'success');
        if (res.announcement) {
          state.announcements.unshift(res.announcement);
          renderList();
        } else {
          loadData();
        }
        refreshAnnouncementBadge(true);
      } catch (err) {
        toast(err.message || 'Lỗi khi tạo thông báo', 'error');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Đăng thông báo'; }
      }
    });
  }

  function openEditModal(item) {
    const isDept = item.target_scope === 'department';
    const body = `
      <form id="ann-edit-form" style="display:flex;flex-direction:column;gap:14px;">
        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Tiêu đề thông báo *</label>
          <input id="form-ann-title" type="text" class="input" value="${esc(item.title)}" required/>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="field">
            <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Mức độ ưu tiên</label>
            <select id="form-ann-priority" class="input">
              <option value="normal" ${item.priority === 'normal' ? 'selected' : ''}>Thông thường</option>
              <option value="important" ${item.priority === 'important' ? 'selected' : ''}>Quan trọng</option>
            </select>
          </div>

          <div class="field">
            <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Phạm vi gửi</label>
            <select id="form-ann-scope" class="input">
              <option value="all" ${!isDept ? 'selected' : ''}>Toàn công ty</option>
              <option value="department" ${isDept ? 'selected' : ''}>Theo phòng ban</option>
            </select>
          </div>
        </div>

        <div class="field" id="form-dept-field" style="display:${isDept ? 'block' : 'none'};">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Chọn phòng ban *</label>
          <select id="form-ann-dept" class="input">
            ${['Phòng Marketing', 'Phòng HCNS', 'Phòng IT', 'Ban Giám Đốc', 'Thực Tập Sinh'].map(d => `
              <option value="${d}" ${item.target_department === d ? 'selected' : ''}>${d}</option>
            `).join('')}
          </select>
        </div>

        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Nội dung chi tiết *</label>
          <textarea id="form-ann-content" class="input" rows="7" required style="resize:vertical;">${esc(item.content)}</textarea>
        </div>

        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Liên kết tệp / Ảnh đính kèm</label>
          <input id="form-ann-attachment-url" type="url" class="input" value="${esc(item.attachment_url || '')}"/>
        </div>

        <div class="field">
          <label style="font-size:12.5px;font-weight:700;margin-bottom:4px;display:block;">Tên hiển thị của tệp</label>
          <input id="form-ann-attachment-name" type="text" class="input" value="${esc(item.attachment_name || '')}"/>
        </div>
      </form>
    `;

    const footer = `
      <button type="button" class="btn-secondary" id="ann-edit-cancel">Hủy</button>
      <button type="submit" form="ann-edit-form" class="btn-primary" id="ann-edit-submit">Lưu thay đổi</button>
    `;

    openModal('Chỉnh sửa thông báo', body, footer);

    const scopeSelect = document.getElementById('form-ann-scope');
    const deptField = document.getElementById('form-dept-field');
    scopeSelect?.addEventListener('change', () => {
      deptField.style.display = scopeSelect.value === 'department' ? 'block' : 'none';
    });

    document.getElementById('ann-edit-cancel')?.addEventListener('click', closeModal);

    document.getElementById('ann-edit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('form-ann-title')?.value.trim();
      const content = document.getElementById('form-ann-content')?.value.trim();
      const priority = document.getElementById('form-ann-priority')?.value;
      const targetScope = document.getElementById('form-ann-scope')?.value;
      const targetDepartment = targetScope === 'department' ? document.getElementById('form-ann-dept')?.value : null;
      const attachmentUrl = document.getElementById('form-ann-attachment-url')?.value.trim() || null;
      const attachmentName = document.getElementById('form-ann-attachment-name')?.value.trim() || null;

      if (!title || !content) return;
      const submitBtn = document.getElementById('ann-edit-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Đang lưu...'; }

      try {
        const res = await api.updateAnnouncement(item.id, {
          title, content, priority,
          target_scope: targetScope,
          target_department: targetDepartment,
          attachment_url: attachmentUrl,
          attachment_name: attachmentName
        });
        closeModal();
        toast('Đã cập nhật thông báo!', 'success');
        if (res.announcement) {
          const idx = state.announcements.findIndex(a => a.id === item.id);
          if (idx >= 0) state.announcements[idx] = res.announcement;
          renderList();
        } else {
          loadData();
        }
      } catch (err) {
        toast(err.message || 'Lỗi khi cập nhật thông báo', 'error');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Lưu thay đổi'; }
      }
    });
  }

  // Reactive real-time sync with EventBus
  EventBus.bindView(el, 'announcements', () => loadData());
  EventBus.bindView(el, 'announcement:*', () => loadData());

  await loadData();
}
