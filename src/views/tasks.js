import { api } from '../api.js';
import { esc, taskStatusBadge, priorityBadge, toast, openModal, closeModal, loadingHTML, emptyHTML, today, normalizeVietnameseSearch } from '../utils.js';
import { openTaskPanel } from '../app.js';

const LABEL_COLORS = ['#6366F1', '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#F97316', '#EF4444', '#64748B'];
const QUICK_LABEL_COLORS = [
  ['#1D4ED8', 'Xanh dương'],
  ['#6366F1', 'Tím'],
  ['#10B981', 'Xanh lá'],
  ['#FACC15', 'Vàng'],
  ['#F97316', 'Cam'],
  ['#EF4444', 'Đỏ'],
  ['#64748B', 'Xám'],
];
const GROUP_COLORS = ['#EEF2FF', '#DBEAFE', '#F3E8FF', '#DCFCE7', '#FEF3C7', '#FFEDD5', '#FEE2E2', '#F1F5F9'];

function canManageTasks(me) {
  return !!me && (me.role === 'admin' || me.department === 'Phòng HCNS');
}


function sortGroupTasks(groupTasks, mentionedTaskIds) {
  const mentioned = [];
  const normal = [];
  for (const t of groupTasks) {
    if (mentionedTaskIds.has(Number(t.id))) {
      mentioned.push(t);
    } else {
      normal.push(t);
    }
  }

  mentioned.sort((a, b) => {
    const isDoneA = (a.status === 'done' || a.status === 'cancelled') ? 1 : 0;
    const isDoneB = (b.status === 'done' || b.status === 'cancelled') ? 1 : 0;
    if (isDoneA !== isDoneB) return isDoneA - isDoneB;

    if (a.due_date && b.due_date) {
      const cmp = a.due_date.localeCompare(b.due_date);
      if (cmp !== 0) return cmp;
    } else if (a.due_date && !b.due_date) {
      return -1;
    } else if (!a.due_date && b.due_date) {
      return 1;
    }

    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    return timeB - timeA;
  });

  return [...mentioned, ...normal];
}

function labelDot(color) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${esc(color || '#6366F1')};border:1px solid rgba(0,0,0,.08);"></span>`;
}

function labelPickerHTML(labels, selectedId = '', selectedColor = '') {
  const activeColor = !selectedId ? String(selectedColor || '').toUpperCase() : '';
  return `
    <input type="hidden" id="tf-label" value="${esc(selectedId || '')}"/>
    <input type="hidden" id="tf-label-color" value="${esc(selectedColor || '')}"/>
    <div class="label-picker" id="tf-label-picker">
      <button type="button" class="label-picker-item ${!selectedId && !selectedColor ? 'active' : ''}" data-label-id="" data-label-color="">
        <span class="label-color-dot" style="background:linear-gradient(135deg,#94A3B8,#CBD5E1);"></span>
        <span class="label-picker-name">Tự suy màu</span>
      </button>
      ${QUICK_LABEL_COLORS.map(([color, name]) => `
        <button type="button" class="label-picker-item label-picker-item--color ${activeColor === color.toUpperCase() ? 'active' : ''}" data-label-id="" data-label-color="${color}">
          <span class="label-color-dot" style="background:${color};"></span>
          <span class="label-picker-name">${name}</span>
        </button>
      `).join('')}
      ${labels.map(l => `
        <button type="button" class="label-picker-item ${String(selectedId || '') === String(l.id) ? 'active' : ''}" data-label-id="${l.id}" data-label-color="" title="${esc(l.project_name || 'Toàn workspace')}">
          <span class="label-color-dot" style="background:${esc(l.color || '#6366F1')};"></span>
          <span class="label-picker-name">${esc(l.name)}</span>
        </button>
      `).join('')}
    </div>
    ${!labels.length ? `<div style="font-size:12px;color:var(--text-2);margin-top:6px;">Có thể tạo nhãn riêng bằng nút “Nhãn màu” ở ngoài board.</div>` : ''}
  `;
}

export function sanitizeRichText(html = '') {
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'A', 'SPAN', 'SUB', 'SUP']);
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  template.content.querySelectorAll('*').forEach(node => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    Array.from(node.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      if (node.tagName === 'A' && name === 'href') {
        const href = node.getAttribute('href') || '';
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
          return;
        }
      }
      node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML.trim();
}

export function richTextToPlainText(html = '') {
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeRichText(html);
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function richEditorHTML(value = '') {
  const content = sanitizeRichText(value).replace(/\n/g, '<br>');
  return `
    <div class="rich-editor">
      <div class="rich-editor-toolbar" id="tf-desc-toolbar" aria-label="Thanh công cụ mô tả">
        <button type="button" data-cmd="bold" title="Bôi đậm"><b>B</b></button>
        <button type="button" data-cmd="italic" title="In nghiêng"><i>I</i></button>
        <button type="button" data-cmd="underline" title="Gạch chân"><u>U</u></button>
        <button type="button" data-cmd="strikeThrough" title="Gạch ngang"><s>S</s></button>
        <span class="toolbar-sep"></span>
        <button type="button" data-cmd="insertUnorderedList" title="Danh sách chấm">•</button>
        <button type="button" data-cmd="insertOrderedList" title="Danh sách số">1.</button>
        <button type="button" data-cmd="formatBlock" data-value="blockquote" title="Trích dẫn">“</button>
        <span class="toolbar-sep"></span>
        <button type="button" data-cmd="createLink" title="Chèn link">🔗</button>
        <button type="button" data-cmd="removeFormat" title="Xóa định dạng">Tx</button>
      </div>
      <div id="tf-desc" class="rich-editor-body" contenteditable="true" data-placeholder="Nhập mô tả, checklist, ghi chú hoặc yêu cầu công việc...">${content}</div>
    </div>
  `;
}

function bindRichEditor() {
  const editor = document.getElementById('tf-desc');
  document.querySelectorAll('#tf-desc-toolbar [data-cmd]').forEach(btn => btn.addEventListener('click', () => {
    editor?.focus();
    const cmd = btn.dataset.cmd;
    let value = btn.dataset.value || null;
    if (cmd === 'createLink') {
      value = prompt('Nhập liên kết bắt đầu bằng https://');
      if (!value) return;
      if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    }
    document.execCommand(cmd, false, value);
  }));
}

function projectLabel(p) {
  return `${p.name}${p.code ? ` · ${p.code}` : ''}`;
}

function taskGroupLabel(name) {
  const value = String(name || '').trim();
  return value.toLocaleLowerCase('vi-VN') === 'cong viec chung' ? 'Công việc chung' : (value || 'Công việc chung');
}

function groupColor(group, index = 0) {
  return group?.color || GROUP_COLORS[index % GROUP_COLORS.length];
}

function projectStatusText(status) {
  return ({ active: 'Đang hoạt động', paused: 'Tạm dừng', done: 'Hoàn tất', archived: 'Lưu trữ' })[status || 'active'] || status || 'active';
}

export async function renderTasks(el, me) {
  let canManage = canManageTasks(me);

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div class="page-title">📋 Công việc</div>
        <div class="page-sub">Project → Nhóm công việc → Task → Subtask</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        ${canManage ? `<button id="btn-import-myxteam" class="btn-secondary btn-sm">Nhập MyXteam</button>` : ''}
        ${canManage ? `<button id="btn-new-project" class="btn-secondary btn-sm">+ Project</button>` : ''}
        <button id="btn-new-task" class="btn-primary btn-sm">+ Tạo việc</button>
      </div>
    </div>

    <div class="task-workspace-shell">
      <aside class="card task-project-navigator" aria-label="Danh sách Project">
      <div class="card-header" style="align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div class="card-title">Workspace NetViet HR</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:2px;">Chọn Project để mở board nhóm công việc.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="project-search" placeholder="Tìm Project..." style="min-width:220px;"/>
          ${canManage ? `<button id="btn-new-project-side" class="btn-primary btn-sm" title="Tạo Project mới">+ Project</button>` : ''}
          ${canManage ? `<button id="btn-new-project-group" class="btn-secondary btn-sm" title="Tạo Nhóm dự án (Project Group/Category)">+ Nhóm dự án</button>` : ''}
          ${canManage ? `<label style="font-size:12px;color:var(--text-2);display:flex;gap:6px;align-items:center;"><input type="checkbox" id="project-archived"/> Hiện lưu trữ</label>` : ''}
        </div>
      </div>
      <div id="project-list">${loadingHTML()}</div>
      </aside>

    <section id="project-board" class="task-project-board" aria-live="polite"></section>
    </div>
  `;

  let users = [];
  let departments = [];
  let projects = [];
  let groups = [];
  let labels = [];
  let tasks = [];
  let projectMembers = [];
  let selectedProjectId = '';
  let currentStatus = '';
  const expandedDepartmentStorageKey = 'tasks-expanded-departments-v1';
  let expandedDepartments = new Set();
  try {
    const savedDepartments = JSON.parse(localStorage.getItem(expandedDepartmentStorageKey) || '[]');
    if (Array.isArray(savedDepartments)) expandedDepartments = new Set(savedDepartments.map(String));
  } catch (_) {}

  function saveExpandedDepartments() {
    try { localStorage.setItem(expandedDepartmentStorageKey, JSON.stringify([...expandedDepartments])); } catch (_) {}
  }

  let mentionedTaskIds = new Set();
  let unreadMentionCountByProject = new Map();

  async function refreshUnreadMentionCount() {
    try {
      // Call both APIs in parallel: one for notifications (to get task_id-level data),
      // one for the pre-aggregated by_project count from the backend JOIN
      const [countRes, mentionRes] = await Promise.all([
        api.getUnreadMentionCount().catch(() => ({ count: 0, by_project: {} })),
        api.getTaskMentions().catch(() => ({ notifications: [] })),
      ]);

      // Build map from notification-level data (most accurate – task → project)
      const unreadMentions = (mentionRes?.notifications || []).filter(n => !n.is_read);
      mentionedTaskIds = new Set(unreadMentions.map(n => Number(n.task_id)));
      const mapFromNotifications = new Map();
      for (const notification of unreadMentions) {
        const projectId = Number(notification.project_id ?? notification.team_project_id);
        if (!projectId) continue;
        mapFromNotifications.set(
          projectId,
          (mapFromNotifications.get(projectId) || 0) + 1
        );
      }

      if (mapFromNotifications.size > 0) {
        // Notifications have project_id – use them directly
        unreadMentionCountByProject = mapFromNotifications;
      } else {
        // Fallback: use server-side aggregated by_project (from backend JOIN)
        const byProject = countRes?.by_project || {};
        unreadMentionCountByProject = new Map(
          Object.entries(byProject).map(([id, cnt]) => [Number(id), Number(cnt)])
        );
      }
    } catch (_) {
      unreadMentionCountByProject = new Map();
      mentionedTaskIds = new Set();
    }
  }

  try { users = (await api.getUsers()).users || []; } catch (_) {}
  try { departments = (await api.getDepartments()).departments || []; } catch (_) {}

  async function loadProjects() {
    const params = {};
    const search = el.querySelector('#project-search')?.value.trim();
    if (search) params.search = search;
    if (canManage && el.querySelector('#project-archived')?.checked) params.include_archived = 1;
    const [res] = await Promise.all([
      api.getTaskProjects(params),
      refreshUnreadMentionCount(),
    ]);
    projects = res.projects || [];
    if (selectedProjectId && !projects.some(p => String(p.id) === String(selectedProjectId))) selectedProjectId = '';
    renderProjects();
    if (selectedProjectId) await loadBoard();
    else renderEmptyBoard();
  }

  async function refreshProjectsAfterMutation(change = {}) {
    if (change.archivedProjectId) {
      const archivedId = String(change.archivedProjectId);
      const archivedFilter = el.querySelector('#project-archived');
      if (archivedFilter) archivedFilter.checked = false;
      projects = projects.filter(project => String(project.id) !== archivedId);
      if (String(selectedProjectId) === archivedId) selectedProjectId = '';
      renderProjects();
      renderEmptyBoard();
    }
    await loadProjects();
  }

  function openMyxteamImport() {
    openModal('Nhập dữ liệu công việc từ MyXteam', `
      <div class="field">
        <label for="myxteam-import-json">Dữ liệu JSON đã xuất từ MyXteam</label>
        <textarea id="myxteam-import-json" rows="12" spellcheck="false" placeholder='{"projects":[...]}' style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical;"></textarea>
      </div>
      <div class="notice notice-info" style="margin:10px 0;">
        Import giữ nguyên dữ liệu hiện có và dùng ID nguồn để chống tạo trùng. Team → phòng ban, Project → Project, cột Kanban → nhóm công việc, card → Task.
      </div>
      <div id="myxteam-import-progress" role="status" aria-live="polite" style="font-size:13px;color:var(--text-2);"></div>
    `, `
      <button type="button" class="btn-secondary" id="myxteam-import-close">Đóng</button>
      <button type="button" class="btn-primary" id="myxteam-import-run">Bắt đầu nhập</button>
    `);
    const closeButton = document.getElementById('myxteam-import-close');
    const runButton = document.getElementById('myxteam-import-run');
    const progress = document.getElementById('myxteam-import-progress');
    closeButton?.addEventListener('click', closeModal);
    runButton?.addEventListener('click', async () => {
      let parsed;
      try { parsed = JSON.parse(document.getElementById('myxteam-import-json')?.value || ''); }
      catch (_) { toast('JSON MyXteam không hợp lệ', 'error'); return; }
      const sourceProjects = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.projects) ? parsed.projects : parsed?.id ? [parsed] : [];
      if (!sourceProjects.length) { toast('Không tìm thấy Project để nhập', 'error'); return; }
      if (sourceProjects.length > 100) { toast('Tối đa 100 Project mỗi lượt nhập', 'error'); return; }
      runButton.disabled = true;
      closeButton.disabled = true;
      const totals = { projects: 0, groups: 0, tasks: 0, skipped: 0, failed: 0 };
      const failures = [];
      for (let index = 0; index < sourceProjects.length; index += 1) {
        const project = sourceProjects[index];
        if (progress) progress.innerHTML = `<strong>Đang nhập ${index + 1}/${sourceProjects.length}</strong> · ${esc(project?.name || project?.id || 'Project')}`;
        try {
          const response = await api.importMyxteamProject(project);
          const result = response.result || {};
          totals.projects += Number(result.project_created || 0);
          totals.groups += Number(result.groups_created || 0);
          totals.tasks += Number(result.tasks_created || 0);
          totals.skipped += Number(result.tasks_skipped || 0);
        } catch (error) {
          totals.failed += 1;
          failures.push(`${project?.name || project?.id || `Project ${index + 1}`}: ${error.message}`);
        }
      }
      if (progress) progress.innerHTML = `
        <strong>Đã xử lý ${sourceProjects.length} Project.</strong><br>
        Tạo mới: ${totals.projects} Project · ${totals.groups} nhóm · ${totals.tasks} task. Bỏ qua do đã có: ${totals.skipped} task.
        ${totals.failed ? `<br><span style="color:var(--danger);">Lỗi ${totals.failed} Project: ${esc(failures.slice(0, 5).join(' | '))}</span>` : ''}
      `;
      closeButton.disabled = false;
      runButton.disabled = false;
      runButton.textContent = 'Nhập lại phần còn thiếu';
      await loadProjects();
      toast(totals.failed ? 'Import hoàn tất nhưng còn Project lỗi' : 'Đã nhập dữ liệu MyXteam', totals.failed ? 'error' : 'success');
    });
  }

  function selectedProject() {
    return projects.find(p => String(p.id) === String(selectedProjectId));
  }

  function canViewProjectTimeline(project) {
    return !!project && (canManage
      || Number(project.created_by) === Number(me.id)
      || Number(project.manager_id) === Number(me.id));
  }

  function openProjectTimeline(project) {
    let kind = 'all';
    let before = null;
    let hasMore = false;

    openModal(`Timeline · ${projectLabel(project)}`, `
      <div class="project-timeline-toolbar">
        <label for="project-timeline-filter">Hiển thị</label>
        <select id="project-timeline-filter" aria-label="Lọc sự kiện Timeline">
          <option value="all">Tất cả hoạt động</option>
          <option value="created">Đã tạo</option>
          <option value="completed">Đã hoàn thành</option>
          <option value="reopened">Đã mở lại</option>
        </select>
      </div>
      <div id="project-timeline-list" class="project-timeline-list">${loadingHTML()}</div>
      <div id="project-timeline-more"></div>
    `, `<button type="button" class="btn-secondary" id="btn-close-project-timeline">Đóng</button>`);
    const modal = document.getElementById('modal');
    modal?.classList.add('modal--project-timeline', 'modal--scroll-fixed');

    const formatDate = value => {
      const date = new Date(String(value || '').replace(' ', 'T'));
      return Number.isNaN(date.getTime()) ? 'Không rõ ngày' : date.toLocaleDateString('vi-VN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    };
    const formatTime = value => {
      const date = new Date(String(value || '').replace(' ', 'T'));
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    };
    const actionText = event => ({
      task_created: 'đã tạo công việc',
      task_completed: 'đã hoàn thành công việc',
      task_reopened: 'đã mở lại công việc',
      subtask_created: 'đã tạo công việc con',
      subtask_completed: 'đã hoàn thành công việc con',
      subtask_reopened: 'đã mở lại công việc con',
    })[event.action] || 'đã cập nhật công việc';
    const renderEvents = events => {
      const list = document.getElementById('project-timeline-list');
      if (!list) return;
      if (!events.length) {
        list.innerHTML = emptyHTML('🕘', 'Chưa có hoạt động phù hợp', 'Timeline bắt đầu ghi chính xác từ lúc tính năng được triển khai.');
        return;
      }
      const groupsByDay = new Map();
      events.forEach(event => {
        const key = String(event.created_at || '').slice(0, 10) || 'unknown';
        if (!groupsByDay.has(key)) groupsByDay.set(key, []);
        groupsByDay.get(key).push(event);
      });
      list.innerHTML = [...groupsByDay.values()].map(group => `
        <section class="project-timeline-day">
          <h4>${esc(formatDate(group[0].created_at))}</h4>
          ${group.map(event => {
            const actor = event.actor_name || 'Người dùng';
            const initials = event.avatar_initials || actor.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join('').toUpperCase() || '?';
            return `<div class="project-timeline-event">
              <div class="project-timeline-avatar" style="background:${esc(event.avatar_color || '#6366F1')}">${esc(initials)}</div>
              <div class="project-timeline-event-copy">
                <div><strong>${esc(actor)}</strong> ${esc(actionText(event))}</div>
                <div class="project-timeline-entity">${esc(event.entity_title || 'Công việc không còn nhận diện được')}</div>
                <time>${esc(formatTime(event.created_at))}${event.legacy ? ' · Dữ liệu cũ' : ''}</time>
              </div>
            </div>`;
          }).join('')}
        </section>
      `).join('');
    };
    const renderMore = () => {
      const more = document.getElementById('project-timeline-more');
      if (!more) return;
      more.innerHTML = hasMore ? '<button type="button" id="btn-project-timeline-more" class="btn-secondary btn-sm" style="width:100%;">Xem thêm</button>' : '';
      more.querySelector('#btn-project-timeline-more')?.addEventListener('click', () => load(true));
    };
    const load = async (append = false) => {
      const list = document.getElementById('project-timeline-list');
      if (!list) return;
      if (!append) list.innerHTML = loadingHTML();
      try {
        const response = await api.getTaskProjectTimeline(project.id, { kind, limit: 40, ...(append && before ? { before } : {}) });
        const previous = append ? (list._timelineEvents || []) : [];
        list._timelineEvents = [...previous, ...(response.events || [])];
        before = response.next_before || null;
        hasMore = !!response.has_more;
        renderEvents(list._timelineEvents);
        renderMore();
      } catch (error) {
        if (error.status === 403) toast('Bạn không có quyền xem Timeline của Project này', 'error');
        list.innerHTML = emptyHTML('⚠️', 'Không thể tải Timeline', error.message || 'Vui lòng thử lại.');
      }
    };
    document.getElementById('project-timeline-filter')?.addEventListener('change', event => {
      kind = event.target.value;
      before = null;
      hasMore = false;
      load(false);
    });
    document.getElementById('btn-close-project-timeline')?.addEventListener('click', closeModal);
    load(false);
  }

  function renderProjects() {
    const list = el.querySelector('#project-list');
    if (!list) return;
    if (!projects.length) {
      list.className = '';
      list.innerHTML = `<span style="font-size:13px;color:var(--text-2);padding:8px 0;display:block;">Chưa có Project</span>`;
      return;
    }
    list.className = 'task-project-nav-list';
    const byDepartment = projects.reduce((result, project) => {
      const department = project.department || 'Khác';
      (result[department] ||= []).push(project);
      return result;
    }, {});
    const hasSearch = !!el.querySelector('#project-search')?.value.trim();
    list.innerHTML = Object.entries(byDepartment).map(([department, departmentProjects], departmentIndex) => {
      const isExpanded = hasSearch || expandedDepartments.has(department);
      const contentId = `task-project-department-${departmentIndex}`;
      const deptMentionCount = departmentProjects.reduce((sum, p) => sum + (unreadMentionCountByProject.get(Number(p.id)) || 0), 0);
      return `
      <section class="task-project-nav-department ${isExpanded ? 'is-expanded' : 'is-collapsed'}">
        <div class="task-project-nav-department-head">
          <button type="button" class="task-project-nav-department-toggle" data-department-toggle="${esc(department)}" aria-expanded="${isExpanded}" aria-controls="${contentId}">
            <span class="task-project-nav-department-arrow" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
            <span class="task-project-nav-department-title">${esc(department)}</span>
            ${deptMentionCount > 0 && !isExpanded ? `<span class="task-project-mention-badge" title="${deptMentionCount} việc cần chú ý / được nhắc">${deptMentionCount > 99 ? '99+' : deptMentionCount}</span>` : ''}
            <span class="task-project-nav-department-count">${departmentProjects.length}</span>
          </button>
          ${canManage ? `
            <div class="project-nav-menu-wrap">
              <button type="button" class="project-nav-gear-btn department-gear-btn" data-department-gear="${departmentIndex}" title="Tùy chọn nhóm dự án" aria-label="Tùy chọn nhóm dự án">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              <div class="project-nav-dropdown" id="department-menu-${departmentIndex}" hidden>
                <button type="button" class="project-nav-dropdown-item" data-action-rename-dept="${esc(department)}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  <span>Đổi tên nhóm</span>
                </button>
                <button type="button" class="project-nav-dropdown-item" data-action-add-project-dept="${esc(department)}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>Thêm dự án vào nhóm</span>
                </button>
                <button type="button" class="project-nav-dropdown-item project-nav-dropdown-item--danger" data-action-delete-dept="${esc(department)}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                  <span>Xóa nhóm dự án</span>
                </button>
              </div>
            </div>
          ` : ''}
        </div>
        <div id="${contentId}" class="task-project-nav-department-content" ${isExpanded ? '' : 'hidden'}>
        ${departmentProjects.map(p => {
          const mentionCount = unreadMentionCountByProject.get(Number(p.id)) || 0;
          return `
          <div class="task-project-nav-row" data-project-row="${p.id}">
            <button type="button" class="task-project-nav-item ${String(selectedProjectId) === String(p.id) ? 'active' : ''}" data-project="${p.id}" title="${esc(p.description || '')}">
              <span class="task-project-nav-item-head">
                <span class="task-project-nav-item-title">${esc(projectLabel(p))}</span>
                ${mentionCount > 0 ? `<span class="task-project-mention-badge" title="Công việc cần chú ý / được nhắc">${mentionCount > 99 ? '99+' : mentionCount}</span>` : ''}
              </span>
              <span class="task-project-nav-item-meta">${Number(p.task_count || 0)} việc · ${esc(projectStatusText(p.status))}</span>
            </button>
            ${canManage ? `
              <div class="project-nav-menu-wrap">
                <button type="button" class="project-nav-gear-btn" data-project-gear="${p.id}" title="Tùy chọn dự án" aria-label="Tùy chọn dự án">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
                <div class="project-nav-dropdown" id="project-nav-menu-${p.id}" hidden>
                  <button type="button" class="project-nav-dropdown-item" data-action-edit-project="${p.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    <span>Sửa tên dự án</span>
                  </button>
                  <button type="button" class="project-nav-dropdown-item project-nav-dropdown-item--danger" data-action-delete-project="${p.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    <span>Xóa dự án</span>
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
          `;
        }).join('')}
        </div>
      </section>
    `; }).join('');

    list.querySelectorAll('[data-department-toggle]').forEach(toggle => toggle.addEventListener('click', () => {
      const department = toggle.dataset.departmentToggle || '';
      if (expandedDepartments.has(department)) expandedDepartments.delete(department);
      else expandedDepartments.add(department);
      saveExpandedDepartments();
      renderProjects();
    }));

    list.querySelectorAll('[data-department-gear]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = btn.dataset.departmentGear;
      const menu = document.getElementById(`department-menu-${idx}`);
      const isCurrentlyOpen = menu && !menu.hidden;
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      if (!isCurrentlyOpen && menu) {
        menu.hidden = false;
      }
    }));

    list.querySelectorAll('[data-action-rename-dept]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      const department = btn.dataset.actionRenameDept;
      renameDepartment(department, refreshProjectsAfterMutation);
    }));

    list.querySelectorAll('[data-action-add-project-dept]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      const department = btn.dataset.actionAddProjectDept;
      openProjectForm(null, users, departments, projects, department, refreshProjectsAfterMutation);
    }));

    list.querySelectorAll('[data-action-delete-dept]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      const department = btn.dataset.actionDeleteDept;
      confirmDeleteDepartment(department, byDepartment[department] || [], refreshProjectsAfterMutation);
    }));

    list.querySelectorAll('[data-project]').forEach(item => item.addEventListener('click', () => {
      selectedProjectId = item.dataset.project || '';
      const project = projects.find(candidate => String(candidate.id) === String(selectedProjectId));
      if (project) {
        expandedDepartments.add(project.department || 'Khác');
        saveExpandedDepartments();
      }
      currentStatus = '';
      renderProjects();
      loadBoard();
    }));

    list.querySelectorAll('[data-project-gear]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const pid = btn.dataset.projectGear;
      const menu = document.getElementById(`project-nav-menu-${pid}`);
      const isCurrentlyOpen = menu && !menu.hidden;
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      if (!isCurrentlyOpen && menu) {
        menu.hidden = false;
      }
    }));

    list.querySelectorAll('[data-action-edit-project]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      const project = projects.find(p => String(p.id) === btn.dataset.actionEditProject);
      openProjectForm(project, users, departments, projects, project?.department || '', refreshProjectsAfterMutation);
    }));

    list.querySelectorAll('[data-action-delete-project]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
      const project = projects.find(p => String(p.id) === btn.dataset.actionDeleteProject);
      if (project) confirmDeleteProject(project, refreshProjectsAfterMutation);
    }));

    document.addEventListener('click', () => {
      document.querySelectorAll('.project-nav-dropdown').forEach(m => m.hidden = true);
    });
  }

  function renameDepartment(oldDepartmentName, onDone) {
    openModal('Đổi tên nhóm dự án', `
      <div class="field"><label>Tên nhóm dự án mới *</label><input id="ren-dept-name" value="${esc(oldDepartmentName)}" placeholder="VD: PHÒNG MARKETING, VP TP.HCM..."/></div>
      <p style="font-size:12px;color:var(--text-2);margin-top:8px;">Hệ thống sẽ cập nhật tên nhóm này cho toàn bộ các dự án thuộc nhóm.</p>
    `, `
      <button type="button" class="btn-secondary" id="ren-dept-cancel">Hủy</button>
      <button type="button" class="btn-primary" id="ren-dept-save">Lưu đổi tên</button>
    `);
    document.getElementById('ren-dept-cancel')?.addEventListener('click', closeModal);
    document.getElementById('ren-dept-save')?.addEventListener('click', async () => {
      const newName = document.getElementById('ren-dept-name')?.value.trim();
      if (!newName) { toast('Vui lòng nhập tên nhóm', 'error'); return; }
      if (newName === oldDepartmentName) { closeModal(); return; }
      const saveBtn = document.getElementById('ren-dept-save');
      if (saveBtn) saveBtn.disabled = true;
      try {
        const deptProjects = projects.filter(p => (p.department || 'Khác') === oldDepartmentName);
        for (const p of deptProjects) {
          await api.updateTaskProject(p.id, {
            name: p.name,
            code: p.code,
            type: p.type || 'project',
            description: p.description,
            department: newName,
            manager_id: p.manager_id,
            status: p.status,
            start_date: p.start_date,
            end_date: p.end_date,
          });
        }
        if (expandedDepartments.has(oldDepartmentName)) {
          expandedDepartments.delete(oldDepartmentName);
          expandedDepartments.add(newName);
          saveExpandedDepartments();
        }
        closeModal();
        toast(`Đã đổi tên nhóm thành "${newName}"`, 'success');
        onDone?.();
      } catch (err) {
        toast(err.message || 'Không thể đổi tên nhóm', 'error');
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  function confirmDeleteDepartment(departmentName, deptProjects, onDone) {
    const targets = (deptProjects && deptProjects.length) ? deptProjects : projects.filter(p => (p.department || 'Khác') === departmentName);
    const totalTasks = targets.reduce((sum, p) => sum + Number(p.task_count || 0), 0);
    openModal('Xác nhận xóa nhóm dự án', `
      <div style="padding:6px 0;">
        <div style="font-size:15px;color:var(--text);margin-bottom:12px;line-height:1.5;">
          Bạn có chắc chắn muốn xóa toàn bộ nhóm dự án <strong>${esc(departmentName)}</strong>?
        </div>
        <div class="notice notice-danger" style="font-size:13px;line-height:1.5;">
          ⚠️ <strong>Cảnh báo:</strong> Toàn bộ <strong>${targets.length} dự án</strong> và <strong>${totalTasks} công việc</strong> trong nhóm này sẽ bị xóa hoàn toàn khỏi hệ thống.
        </div>
      </div>
    `, `
      <button type="button" class="btn-secondary" id="btn-cancel-del-dept">Hủy bỏ</button>
      <button type="button" class="btn-danger" id="btn-confirm-del-dept">Xác nhận xóa nhóm</button>
    `);
    document.getElementById('btn-cancel-del-dept')?.addEventListener('click', closeModal);
    document.getElementById('btn-confirm-del-dept')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-confirm-del-dept');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Đang xóa...';
      }
      try {
        const toDelete = (deptProjects && deptProjects.length) ? deptProjects : projects.filter(p => (p.department || 'Khác') === departmentName);
        for (const p of toDelete) {
          await api.deleteTaskProjectPermanent(p.id);
        }
        expandedDepartments.delete(departmentName);
        saveExpandedDepartments();
        closeModal();
        toast(`Đã xóa nhóm dự án "${departmentName}"`, 'success');
        if (toDelete.some(p => String(p.id) === String(selectedProjectId))) {
          selectedProjectId = '';
        }
        await loadProjects();
        if (selectedProjectId) await loadBoard();
        else renderEmptyBoard();
        onDone?.();
      } catch (err) {
        toast(err.message || 'Không thể xóa nhóm', 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Xác nhận xóa nhóm';
        }
      }
    });
  }

  function confirmDeleteProject(project, onDone) {
    openModal('Xác nhận xóa dự án', `
      <div style="padding:6px 0;">
        <div style="font-size:15px;color:var(--text);margin-bottom:12px;line-height:1.5;">
          Bạn có chắc chắn muốn xóa vĩnh viễn dự án <strong>${esc(project.name)}</strong>?
        </div>
        <div class="notice notice-danger" style="font-size:13px;line-height:1.5;">
          ⚠️ <strong>Cảnh báo:</strong> Toàn bộ <strong>${Number(project.task_count || 0)} công việc</strong> và các nhóm công việc bên trong dự án này sẽ bị xóa hoàn toàn khỏi hệ thống.
        </div>
      </div>
    `, `
      <button type="button" class="btn-secondary" id="btn-cancel-del-proj">Hủy bỏ</button>
      <button type="button" class="btn-danger" id="btn-confirm-del-proj">Xác nhận xóa dự án</button>
    `);
    document.getElementById('btn-cancel-del-proj')?.addEventListener('click', closeModal);
    document.getElementById('btn-confirm-del-proj')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-confirm-del-proj');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Đang xóa...';
      }
      try {
        await api.deleteTaskProjectPermanent(project.id);
        closeModal();
        toast(`Đã xóa dự án "${project.name}"`, 'success');
        if (String(selectedProjectId) === String(project.id)) {
          selectedProjectId = '';
        }
        await loadProjects();
        if (selectedProjectId) await loadBoard();
        else renderEmptyBoard();
        onDone?.({ archivedProjectId: project.id });
      } catch (err) {
        toast(err.message || 'Không thể xóa dự án', 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Xác nhận xóa dự án';
        }
      }
    });
  }

  function renderEmptyBoard() {
    const board = el.querySelector('#project-board');
    board.innerHTML = `
      <div class="card">
        ${emptyHTML('📁', canManage ? 'Chọn hoặc tạo Project để bắt đầu' : 'Chọn Project để xem công việc')}
      </div>
    `;
  }

  async function loadBoard() {
    if (!selectedProjectId) return renderEmptyBoard();
    const board = el.querySelector('#project-board');
    if (board && !board.querySelector('.task-board-wrap')) {
      board.innerHTML = `<div class="card" style="padding:32px 20px;text-align:center;">${loadingHTML()}</div>`;
    }
    const params = { project_id: selectedProjectId };
    if (currentStatus) params.status = currentStatus;
    try {
      const [groupRes, labelRes, taskRes, memberRes] = await Promise.all([
        api.getTaskGroups({ project_id: selectedProjectId }),
        api.getTaskLabels({ project_id: selectedProjectId }),
        api.getTasks(params),
        api.getTaskProjectMembers(selectedProjectId).catch(() => ({ members: [] })),
        refreshUnreadMentionCount(),
      ]);
      groups = groupRes?.groups || [];
      labels = labelRes?.labels || [];
      tasks = taskRes?.tasks || [];
      projectMembers = memberRes?.members || [];
      canManage = !!groupRes?.canManage;
      renderProjects();
      renderBoard();
    } catch (err) {
      console.error('loadBoard error:', err);
      if (board) {
        board.innerHTML = `<div class="card" style="padding:24px 18px;"><div class="notice notice-danger" style="margin:0;">⚠️ <strong>Không thể tải công việc:</strong> ${esc(err.message || 'Lỗi kết nối máy chủ')}</div></div>`;
      }
      toast(err.message || 'Lỗi tải danh sách công việc', 'error');
    }
  }

  function memberAvatar(member) {
    const initials = member.avatar_initials || String(member.full_name || '?').split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join('').toUpperCase();
    return `<span class="task-project-member-avatar" style="background:${esc(member.avatar_color || '#6366F1')}" title="${esc(member.full_name || '')}">${esc(initials || '?')}</span>`;
  }

  function openProjectMembers(project) {
    const selected = new Set(projectMembers.map(member => Number(member.user_id)));
    const render = () => {
      const list = document.getElementById('project-member-modal-list');
      const count = document.getElementById('project-member-modal-count');
      if (count) count.textContent = `${selected.size} thành viên`;
      if (!list) return;
      const candidates = canManage ? users : projectMembers;
      list.innerHTML = candidates.map(user => {
        const id = Number(user.user_id || user.id);
        return `<label class="task-project-member-row">
          ${canManage ? `<input type="checkbox" data-project-member="${id}" ${selected.has(id) ? 'checked' : ''}/>` : ''}
          ${memberAvatar(user)}
          <span><strong>${esc(user.full_name || '')}</strong><small>${esc(user.employee_code || '')}${user.department ? ` · ${esc(user.department)}` : ''}</small></span>
        </label>`;
      }).join('') || '<div class="task-project-member-empty">Chưa có thành viên.</div>';
      list.querySelectorAll('[data-project-member]').forEach(input => input.addEventListener('change', () => {
        const id = Number(input.dataset.projectMember);
        if (input.checked) selected.add(id); else selected.delete(id);
        render();
      }));
    };
    openModal(`Thành viên · ${projectLabel(project)}`, `
      <div class="task-project-member-modal-head"><div id="project-member-modal-count"></div><span>${canManage ? 'Chọn người để thêm hoặc bỏ khỏi Project.' : 'Bạn có thể xem danh sách thành viên Project.'}</span></div>
      <div id="project-member-modal-list" class="task-project-member-list"></div>
    `, `<button type="button" class="btn-secondary" id="project-member-close">Đóng</button>${canManage ? '<button type="button" class="btn-primary" id="project-member-save">Lưu thành viên</button>' : ''}`);
    render();
    document.getElementById('project-member-close')?.addEventListener('click', closeModal);
    document.getElementById('project-member-save')?.addEventListener('click', async () => {
      try { await api.saveTaskProjectMembers(project.id, [...selected]); closeModal(); toast('Đã cập nhật thành viên Project', 'success'); await loadProjects(); }
      catch (error) { toast(error.message, 'error'); }
    });
  }

  function renderBoard() {
    const board = el.querySelector('#project-board');
    const project = selectedProject();
    if (!project) return renderEmptyBoard();
    const defaultGroup = groups[0] || { id: '', name: 'Công việc chung', position: 0, color: '#EEF2FF' };
    const projectMentionCount = unreadMentionCountByProject.get(Number(project.id)) || 0;

    board.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header" style="gap:10px;flex-wrap:wrap;align-items:center;">
          <div class="task-project-board-title">
            <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span>${esc(projectLabel(project))}</span>
              ${projectMentionCount > 0 ? `<span class="task-project-mention-badge" title="Công việc cần chú ý / được nhắc">${projectMentionCount > 99 ? '99+' : projectMentionCount}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px;">${esc(project.department || 'Chưa chọn phòng ban')} · ${Number(project.member_count || 0)} thành viên</div>
          </div>
          <button type="button" id="btn-project-members" class="task-project-member-stack" aria-label="Xem thành viên Project">
            ${projectMembers.slice(0, 5).map(memberAvatar).join('') || '<span class="task-project-member-avatar task-project-member-avatar--empty">?</span>'}
            ${projectMembers.length > 5 ? `<span class="task-project-member-more">+${projectMembers.length - 5}</span>` : ''}
            ${canManage ? '<span class="task-project-member-add" aria-hidden="true">+</span>' : ''}
          </button>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <div class="task-board-nav-pill" title="Điều hướng cuộn cột Kanban">
              <button type="button" id="btn-scroll-board-left" class="board-pill-btn" title="Cuộn sang trái (hoặc Shift + cuộn chuột)" aria-label="Cuộn sang trái">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span class="board-pill-divider"></span>
              <button type="button" id="btn-scroll-board-right" class="board-pill-btn" title="Cuộn sang phải (hoặc Shift + cuộn chuột)" aria-label="Cuộn sang phải">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            ${canViewProjectTimeline(project) ? `<button id="btn-project-timeline" class="btn-secondary btn-sm">🕘 Timeline</button>` : ''}
            ${canManage ? `<button id="btn-new-group" class="btn-primary btn-task-group-create btn-sm">+ Nhóm công việc</button>` : ''}
          </div>
        </div>
        <div class="filter-bar" id="task-status-bar" style="margin-top:8px;margin-bottom:0;">
          <span class="filter-chip ${currentStatus === '' ? 'active' : ''}" data-status="">Tất cả</span>
          <span class="filter-chip ${currentStatus === 'todo' ? 'active' : ''}" data-status="todo">Chờ làm</span>
          <span class="filter-chip ${currentStatus === 'in-progress' ? 'active' : ''}" data-status="in-progress">Đang làm</span>
          <span class="filter-chip ${currentStatus === 'review' ? 'active' : ''}" data-status="review">Review</span>
          <span class="filter-chip ${currentStatus === 'done' ? 'active' : ''}" data-status="done">Hoàn thành</span>
          <span class="filter-chip ${currentStatus === 'cancelled' ? 'active' : ''}" data-status="cancelled">Hủy</span>
        </div>
      </div>
      <div class="task-board-wrap" id="task-board-wrap-el" tabindex="0" aria-label="Bảng Kanban công việc">
        ${groups.map((group, index) => renderGroupColumn(group, index, defaultGroup)).join('')}
      </div>
    `;

    const boardWrap = board.querySelector('#task-board-wrap-el');
    board.querySelector('#btn-scroll-board-left')?.addEventListener('click', () => {
      boardWrap?.scrollBy({ left: -420, behavior: 'smooth' });
    });
    board.querySelector('#btn-scroll-board-right')?.addEventListener('click', () => {
      boardWrap?.scrollBy({ left: 420, behavior: 'smooth' });
    });
    boardWrap?.addEventListener('wheel', e => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && (e.shiftKey || e.altKey)) {
        e.preventDefault();
        boardWrap.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    board.querySelector('#btn-new-group')?.addEventListener('click', () => openGroupForm(null, selectedProjectId, groups.length, loadBoard));
    board.querySelector('#btn-project-members')?.addEventListener('click', () => openProjectMembers(project));
    board.querySelector('#btn-project-timeline')?.addEventListener('click', () => openProjectTimeline(project));
    board.querySelectorAll('[data-edit-group]').forEach(btn => btn.addEventListener('click', () => {
      const group = groups.find(g => String(g.id) === btn.dataset.editGroup);
      openGroupForm(group, selectedProjectId, groups.length, loadBoard);
    }));
    board.querySelectorAll('[data-archive-group]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Lưu trữ nhóm công việc này? Task trong nhóm vẫn còn và có thể xử lý lại sau.')) return;
      try { await api.archiveTaskGroup(btn.dataset.archiveGroup); toast('Đã lưu trữ nhóm', 'success'); loadBoard(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    board.querySelectorAll('[data-add-task-group]').forEach(btn => btn.addEventListener('click', () => {
      const group = groups.find(g => String(g.id) === btn.dataset.addTaskGroup) || defaultGroup;
      openTaskForm(null, users, me, loadBoard, { project, groups, labels, selectedGroupId: group.id, departments });
    }));
    board.querySelectorAll('[data-task-status]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const taskId = btn.dataset.taskStatus;
      const status = btn.dataset.status;
      const task = tasks.find(t => String(t.id) === String(taskId));
      if (!task || task.status === status) return;
      try {
        await api.updateTask(taskId, { ...minimalTaskPayload(task), status, group_id: task.group_id || null, team_project_id: selectedProjectId });
        toast('Đã cập nhật trạng thái công việc', 'success');
        loadBoard();
      } catch (e) { toast(e.message, 'error'); }
    }));
    board.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', e => {
        if (card.classList.contains('is-dragging')) return;
        if (e.target.closest('select,button,.task-card-drag-handle,.task-status-action')) return;
        openTaskPanel(parseInt(card.dataset.tid));
      });
    });
    board.querySelectorAll('#task-status-bar [data-status]').forEach(chip => chip.addEventListener('click', () => {
      currentStatus = chip.dataset.status;
      loadBoard();
    }));

    bindTaskDragAndDrop(board);
  }

  function bindTaskDragAndDrop(boardEl) {
    let draggedCard = null;
    let draggedTaskId = null;
    let sourceGroupId = null;
    let placeholder = null;
    let isDragging = false;
    let touchClone = null;
    let touchOffsetX = 0;
    let touchOffsetY = 0;

    function createPlaceholder() {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'task-drop-placeholder';
      }
      return placeholder;
    }

    function cleanUp() {
      if (draggedCard) {
        draggedCard.classList.remove('is-dragging');
      }
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }
      boardEl.querySelectorAll('.task-group-column.is-drag-over').forEach(col => col.classList.remove('is-drag-over'));
      if (touchClone && touchClone.parentNode) {
        touchClone.parentNode.removeChild(touchClone);
        touchClone = null;
      }
      setTimeout(() => {
        isDragging = false;
        draggedCard = null;
        draggedTaskId = null;
        sourceGroupId = null;
      }, 80);
    }

    async function applyDrop(targetList) {
      if (!draggedCard || !placeholder || !targetList) return;
      const targetCol = targetList.closest('.task-group-column');
      const targetGroupId = targetList.dataset.groupId || '';

      const emptyEl = targetList.querySelector('.task-group-empty');
      if (emptyEl) emptyEl.remove();

      targetList.insertBefore(draggedCard, placeholder);
      placeholder.remove();

      draggedCard.dataset.groupId = targetGroupId;
      draggedCard.classList.remove('is-dragging');

      const sourceList = sourceGroupId !== targetGroupId ? boardEl.querySelector(`.task-card-list[data-group-id="${sourceGroupId}"]`) : null;
      if (sourceList && !sourceList.querySelector('.task-card')) {
        sourceList.innerHTML = `<div class="task-group-empty">Chưa có task</div>`;
      }

      const targetTaskIds = Array.from(targetList.querySelectorAll('.task-card')).map(c => parseInt(c.dataset.tid)).filter(Boolean);
      const moves = [];
      targetTaskIds.forEach((id, idx) => {
        moves.push({ id, group_id: targetGroupId ? parseInt(targetGroupId) : null, position: idx * 10 });
      });

      if (sourceList) {
        const sourceTaskIds = Array.from(sourceList.querySelectorAll('.task-card')).map(c => parseInt(c.dataset.tid)).filter(Boolean);
        sourceTaskIds.forEach((id, idx) => {
          moves.push({ id, group_id: sourceGroupId ? parseInt(sourceGroupId) : null, position: idx * 10 });
        });
      }

      const targetCountEl = targetCol?.querySelector('.task-group-count');
      if (targetCountEl) targetCountEl.textContent = `${targetTaskIds.length} công việc`;
      if (sourceList) {
        const sourceCol = sourceList.closest('.task-group-column');
        const sourceCountEl = sourceCol?.querySelector('.task-group-count');
        if (sourceCountEl) sourceCountEl.textContent = `${sourceList.querySelectorAll('.task-card').length} công việc`;
      }

      const draggedTaskObj = tasks.find(t => String(t.id) === String(draggedTaskId));
      if (draggedTaskObj) {
        draggedTaskObj.group_id = targetGroupId ? parseInt(targetGroupId) : null;
      }

      try {
        await api.reorderTasks({ project_id: selectedProjectId, moves });
      } catch (err) {
        toast('Không thể lưu thứ tự công việc: ' + (err.message || 'Lỗi mạng'), 'error');
        await loadBoard();
      }
    }

    function getDragAfterElement(container, y) {
      const cards = [...container.querySelectorAll('.task-card:not(.is-dragging)')];
      return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        } else {
          return closest;
        }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    boardEl.querySelectorAll('.task-card').forEach(card => {
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', e => {
        if (e.target.closest('button, select, input, a, .task-status-actions')) {
          e.preventDefault();
          return;
        }
        isDragging = true;
        draggedCard = card;
        draggedTaskId = card.dataset.tid;
        sourceGroupId = card.dataset.groupId || '';
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedTaskId);
      });

      card.addEventListener('dragend', () => {
        cleanUp();
      });
    });

    boardEl.querySelectorAll('.task-card-list').forEach(list => {
      list.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!draggedCard) return;

        const col = list.closest('.task-group-column');
        if (col) col.classList.add('is-drag-over');

        const afterElement = getDragAfterElement(list, e.clientY);
        const ph = createPlaceholder();
        if (afterElement == null) {
          list.appendChild(ph);
        } else {
          list.insertBefore(ph, afterElement);
        }
      });

      list.addEventListener('dragleave', e => {
        const col = list.closest('.task-group-column');
        if (col && !col.contains(e.relatedTarget)) {
          col.classList.remove('is-drag-over');
        }
      });

      list.addEventListener('drop', async e => {
        e.preventDefault();
        if (!draggedCard) return;
        await applyDrop(list);
        cleanUp();
      });
    });

    boardEl.querySelectorAll('.task-card-drag-handle').forEach(handle => {
      const card = handle.closest('.task-card');
      if (!card) return;

      handle.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const rect = card.getBoundingClientRect();
        touchOffsetX = touch.clientX - rect.left;
        touchOffsetY = touch.clientY - rect.top;

        isDragging = true;
        draggedCard = card;
        draggedTaskId = card.dataset.tid;
        sourceGroupId = card.dataset.groupId || '';

        touchClone = card.cloneNode(true);
        touchClone.style.position = 'fixed';
        touchClone.style.zIndex = '9999';
        touchClone.style.width = `${rect.width}px`;
        touchClone.style.left = `${touch.clientX - touchOffsetX}px`;
        touchClone.style.top = `${touch.clientY - touchOffsetY}px`;
        touchClone.style.opacity = '0.9';
        touchClone.style.pointerEvents = 'none';
        touchClone.style.boxShadow = '0 12px 30px rgba(0,0,0,0.2)';
        touchClone.style.transform = 'scale(1.02)';
        document.body.appendChild(touchClone);

        draggedCard.classList.add('is-dragging');
      }, { passive: false });

      handle.addEventListener('touchmove', e => {
        if (!isDragging || !touchClone || e.touches.length !== 1) return;
        e.preventDefault();
        const touch = e.touches[0];
        touchClone.style.left = `${touch.clientX - touchOffsetX}px`;
        touchClone.style.top = `${touch.clientY - touchOffsetY}px`;

        const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const list = elemBelow?.closest('.task-card-list') || elemBelow?.closest('.task-group-column')?.querySelector('.task-card-list');
        if (list) {
          boardEl.querySelectorAll('.task-group-column.is-drag-over').forEach(col => col.classList.remove('is-drag-over'));
          list.closest('.task-group-column')?.classList.add('is-drag-over');

          const afterElement = getDragAfterElement(list, touch.clientY);
          const ph = createPlaceholder();
          if (afterElement == null) {
            list.appendChild(ph);
          } else {
            list.insertBefore(ph, afterElement);
          }
        }
      }, { passive: false });

      handle.addEventListener('touchend', async () => {
        if (!isDragging || !draggedCard) return;
        if (placeholder && placeholder.parentNode) {
          const targetList = placeholder.closest('.task-card-list');
          if (targetList) {
            await applyDrop(targetList);
          }
        }
        cleanUp();
      });

      handle.addEventListener('touchcancel', () => {
        cleanUp();
      });
    });
  }

  function renderGroupColumn(group, index, defaultGroup) {
    const rawTasks = tasks.filter(t => {
      if (t.group_id) return String(t.group_id) === String(group.id);
      return String(group.id) === String(defaultGroup.id);
    });
    const groupTasks = sortGroupTasks(rawTasks, mentionedTaskIds);
    return `
      <section class="task-group-column" data-group-id="${group.id || ''}">
        <div class="task-group-head">
          <div>
            <div class="task-group-title">${esc(taskGroupLabel(group.name))}</div>
            <div class="task-group-count">${groupTasks.length} công việc</div>
          </div>
          ${canManage ? `
            <div class="task-group-head-actions">
              <button type="button" class="task-group-head-btn" data-edit-group="${group.id}" title="Đổi tên / sửa nhóm" aria-label="Sửa nhóm">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Sửa</span>
              </button>
              <button type="button" class="task-group-head-btn task-group-head-btn--archive" data-archive-group="${group.id}" title="Ẩn / Lưu trữ nhóm" aria-label="Ẩn nhóm">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                <span>Ẩn</span>
              </button>
            </div>
          ` : ''}
        </div>
        <div class="task-card-list" data-group-id="${group.id || ''}" style="display:flex;flex-direction:column;gap:8px;min-height:48px;">
          ${groupTasks.map(t => renderTaskCard(t)).join('') || `<div class="task-group-empty">Chưa có task</div>`}
        </div>
        <button class="btn-secondary btn-sm" data-add-task-group="${group.id}" style="width:100%;margin-top:10px;">+ Thêm công việc</button>
      </section>
    `;
  }

  function renderTaskCard(t) {
    const color = t.label_color_real || t.label_color || '#6366F1';
    const isMentioned = mentionedTaskIds.has(Number(t.id));
    return `
      <div class="task-card ${isMentioned ? 'task-card--mentioned' : ''}" data-tid="${t.id}" data-group-id="${t.group_id || ''}" draggable="true" style="border-left-color:${esc(color)};">
        ${isMentioned ? `
          <div class="task-card-mention-banner">
            <span class="task-mention-icon" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </span>
            <span>Bạn được nhắc</span>
          </div>
        ` : ''}
        <div class="task-card-header">
          <div class="task-card-title" title="${esc(t.title)}">${esc(t.title)}</div>
          <span class="task-card-drag-handle" title="Nắm kéo để đổi vị trí" aria-label="Nắm kéo vị trí">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>
          </span>
        </div>
        <div class="task-card-meta">
          ${taskStatusBadge(t.status)}
          ${priorityBadge(t.priority)}
          ${t.label_name ? `<span class="badge badge-gray" style="display:inline-flex;gap:5px;align-items:center;">${labelDot(color)}${esc(t.label_name)}</span>` : ''}
          ${t.assignee_name ? `<span class="task-card-assignee" title="Người được giao"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${esc(t.assignee_name)}${t.assignee_code ? ` · ${esc(t.assignee_code)}` : ''}</span>` : ''}
          ${t.due_date ? `<span class="task-card-due" title="Hạn hoàn thành"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${esc(t.due_date)}</span>` : ''}
          ${(Number(t.subtask_total) > 0) ? `<span class="task-card-subtasks" title="Checklist"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> ${Number(t.subtask_done || 0)}/${Number(t.subtask_total)}</span>` : ''}
          ${Number(t.follower_count) > 0 ? `<span class="task-card-followers" title="Người theo dõi"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${Number(t.follower_count)}</span>` : ''}
        </div>
        <div class="task-status-actions" aria-label="Cập nhật trạng thái công việc">
          ${[
            ['todo', 'Chờ làm'],
            ['in-progress', 'Đang làm'],
            ['review', 'Review'],
            ['done', 'Hoàn thành'],
            ['cancelled', 'Hủy'],
          ].map(([status, label]) => `<button type="button" class="task-status-action ${t.status === status ? 'active' : ''}" data-task-status="${t.id}" data-status="${status}" aria-pressed="${t.status === status}">${label}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function minimalTaskPayload(task) {
    return {
      title: task.title,
      description: task.description || '',
      assigned_to: task.assigned_to || null,
      department: task.department || '',
      date: task.date || null,
      due_date: task.due_date || null,
      status: task.status || 'todo',
      priority: task.priority || 'normal',
      label_id: task.label_id || null,
    };
  }

  let searchTimer = null;
  el.querySelector('#project-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadProjects, 250);
  });
  el.querySelector('#project-archived')?.addEventListener('change', loadProjects);
  el.querySelector('#btn-import-myxteam')?.addEventListener('click', openMyxteamImport);
  const prefillProjectGroup = () => { const p = projects.find(c => String(c.id) === String(selectedProjectId)); return p?.department || ''; };
  el.querySelector('#btn-new-project')?.addEventListener('click', () => openProjectForm(null, users, departments, projects, prefillProjectGroup(), refreshProjectsAfterMutation));
  el.querySelector('#btn-new-project-side')?.addEventListener('click', () => openProjectForm(null, users, departments, projects, prefillProjectGroup(), refreshProjectsAfterMutation));
  el.querySelector('#btn-new-project-group')?.addEventListener('click', () => openProjectGroupForm(async createdId => {
    if (createdId) selectedProjectId = String(createdId);
    await loadProjects();
    if (selectedProjectId) await loadBoard(); else renderEmptyBoard();
  }));
  el.querySelector('#btn-new-task').addEventListener('click', () => {
    const project = selectedProject();
    if (!project) { toast('Vui lòng chọn Project trước khi tạo việc', 'error'); return; }
    openTaskForm(null, users, me, loadBoard, { project, groups, labels, selectedGroupId: groups[0]?.id || '', departments});
  });

  document.addEventListener('task-copied', () => { if (selectedProjectId) loadBoard(); }, { once: false });
  document.addEventListener('task-mentions-read', async () => {
    await refreshUnreadMentionCount();
    renderProjects();
    if (selectedProjectId) await loadBoard();
  }, { once: false });

  await loadProjects();
}

export function openTaskForm(task, users, me, onDone, options = {}) {
  const isEdit = !!task;
  const project = options.project || null;
  const projects = options.projects || (project ? [project] : []);
  const groups = options.groups || [];
  const departments = options.departments || [];
  const labels = options.labels || [];
  const selectedProjectId = task?.team_project_id || project?.id || '';
  const selectedGroupId = task?.group_id || options.selectedGroupId || groups[0]?.id || '';
  const projectOptions = projects.map(p => `<option value="${p.id}" ${String(selectedProjectId) === String(p.id) ? 'selected' : ''}>${esc(projectLabel(p))}</option>`).join('');
  const groupOptions = groups.map(g => `<option value="${g.id}" ${String(selectedGroupId) === String(g.id) ? 'selected' : ''}>${esc(taskGroupLabel(g.name))}</option>`).join('');
  const selectedLabelId = task?.label_id || '';
  const selectedLabelColor = selectedLabelId ? '' : (task?.label_color || '');

  openModal(isEdit ? 'Sửa công việc' : 'Tạo công việc mới', `
    <div class="task-form-grid">
      <div class="task-form-panel">
        <div class="field"><label>Tiêu đề *</label><input type="text" id="tf-title" value="${esc(task?.title||'')}" placeholder="Tên công việc"/></div>
        <div class="field"><label>Mô tả</label>${richEditorHTML(task?.description || '')}</div>
      </div>
      <div class="task-form-panel task-form-panel-muted">
        <div class="input-row">
          <div class="field"><label>Project</label><select id="tf-project" ${project ? 'disabled' : ''}>${projectOptions || '<option value="">-- Chưa gán --</option>'}</select></div>
          <div class="field"><label>Nhóm công việc</label><select id="tf-group">${groupOptions}</select></div>
        </div>
        <div class="field"><label>Giao cho</label><select id="tf-assignee"><option value="">-- Chưa giao --</option>${users.map(u => `<option value="${u.id}" ${task?.assigned_to==u.id?'selected':''}>${esc(u.full_name)}${u.employee_code ? ` · ${esc(u.employee_code)}` : ''}</option>`).join('')}</select></div>
        <div class="input-row">
          <div class="field"><label>Ngày</label><input type="date" id="tf-date" value="${esc(task?.date||today())}"/></div>
          <div class="field"><label>Hạn chót</label><input type="date" id="tf-due" value="${esc(task?.due_date||'')}"/></div>
        </div>
        <div class="input-row">
          <div class="field"><label>Ưu tiên</label><select id="tf-priority"><option value="low" ${task?.priority==='low'?'selected':''}>Thấp</option><option value="normal" ${(!task||task?.priority==='normal')?'selected':''}>Bình thường</option><option value="high" ${task?.priority==='high'?'selected':''}>Cao</option><option value="urgent" ${task?.priority==='urgent'?'selected':''}>Khẩn cấp</option></select></div>
          <div class="field"><label>Trạng thái</label><select id="tf-status"><option value="todo" ${(!task||task?.status==='todo')?'selected':''}>Chờ làm</option><option value="in-progress" ${task?.status==='in-progress'?'selected':''}>Đang làm</option><option value="review" ${task?.status==='review'?'selected':''}>Review</option><option value="done" ${task?.status==='done'?'selected':''}>Hoàn thành</option><option value="cancelled" ${task?.status==='cancelled'?'selected':''}>Hủy</option></select></div>
        </div>
<div class="field"><label>Phòng ban</label><select id="tf-dept"><option value="">-- Chưa chọn --</option>${departments.map(d => `<option value="${esc(d.name)}" ${(task?.department||project?.department||'')===d.name?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>      </div>
    </div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="tf-delete">Xóa</button>` : ''}
    <button class="btn-primary" id="tf-save">Lưu</button>
  `);

  document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--task');
  bindRichEditor();

  document.getElementById('tf-save').addEventListener('click', async () => {
    const title = document.getElementById('tf-title').value.trim();
    const projectId = parseInt(document.getElementById('tf-project').value) || null;
    const groupId = parseInt(document.getElementById('tf-group').value) || null;
    if (!title) { toast('Vui lòng nhập tiêu đề', 'error'); return; }
    if (!projectId) { toast('Vui lòng chọn Project', 'error'); return; }
    if (!groupId) { toast('Vui lòng chọn nhóm công việc', 'error'); return; }
    const data = {
      title,
      description: sanitizeRichText(document.getElementById('tf-desc').innerHTML),
      team_project_id: projectId,
      group_id: groupId,
      date: document.getElementById('tf-date').value || null,
      due_date: document.getElementById('tf-due').value || null,
      priority: document.getElementById('tf-priority').value,
      status: document.getElementById('tf-status').value,
      assigned_to: parseInt(document.getElementById('tf-assignee').value) || null,
      department: document.getElementById('tf-dept').value,
    };
    try {
      if (isEdit) await api.updateTask(task.id, data);
      else await api.createTask(data);
      closeModal();
      toast(isEdit ? 'Đã cập nhật' : 'Đã tạo công việc', 'success');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('tf-delete')?.addEventListener('click', async () => {
    if (!confirm('Xóa công việc này?')) return;
    try { await api.deleteTask(task.id); closeModal(); toast('Đã xóa', 'success'); onDone?.(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

function openProjectFormOld(project, users, departments, onDone) {
  const isEdit = !!project;
  const memberIds = new Set(String(project?.member_ids || '').split(',').map(x => Number(x)).filter(Boolean));
  openModal(isEdit ? 'Sửa Project' : 'Tạo Project', `
    <div class="input-row">
      <div class="field"><label>Tên *</label><input id="pf-name" value="${esc(project?.name || '')}" placeholder="VD: Chiến dịch Marketing tháng 7"/></div>
      <div class="field"><label>Mã</label><input id="pf-code" value="${esc(project?.code || '')}" placeholder="VD: MKT-0726"/></div>
    </div>
    <div class="input-row">
      <div class="field"><label>Trạng thái</label><select id="pf-status"><option value="active" ${(!project||project.status==='active')?'selected':''}>Đang hoạt động</option><option value="paused" ${project?.status==='paused'?'selected':''}>Tạm dừng</option><option value="done" ${project?.status==='done'?'selected':''}>Hoàn tất</option><option value="archived" ${project?.status==='archived'?'selected':''}>Lưu trữ</option></select></div>
      <div class="field"><label>Phòng ban</label><select id="pf-dept"><option value="">-- Chưa chọn --</option>${departments.map(d => `<option value="${esc(d.name)}" ${project?.department===d.name?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Quản lý</label><select id="pf-manager"><option value="">-- Chưa chọn --</option>${users.map(u => `<option value="${u.id}" ${project?.manager_id==u.id?'selected':''}>${esc(u.full_name)}${u.employee_code ? ` · ${esc(u.employee_code)}` : ''}</option>`).join('')}</select></div>
    <div class="input-row">
      <div class="field"><label>Bắt đầu</label><input type="date" id="pf-start" value="${esc(project?.start_date || '')}"/></div>
      <div class="field"><label>Kết thúc</label><input type="date" id="pf-end" value="${esc(project?.end_date || '')}"/></div>
    </div>
    <div class="field"><label>Mô tả</label><textarea id="pf-desc">${esc(project?.description || '')}</textarea></div>
    <div class="field"><label>Thành viên</label><select id="pf-members" multiple size="7">${users.map(u => `<option value="${u.id}" ${memberIds.has(Number(u.id)) ? 'selected' : ''}>${esc(u.full_name)}${u.employee_code ? ` · ${esc(u.employee_code)}` : ''}</option>`).join('')}</select></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="pf-archive">Lưu trữ</button>` : ''}
    <button class="btn-primary" id="pf-save">Lưu</button>
  `);

  document.getElementById('pf-save').addEventListener('click', async () => {
    const name = document.getElementById('pf-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên Project', 'error'); return; }
    const members = Array.from(document.getElementById('pf-members').selectedOptions).map(o => parseInt(o.value)).filter(Boolean);
    const data = {
      name,
      code: document.getElementById('pf-code').value,
      type: 'project',
      status: document.getElementById('pf-status').value,
      department: document.getElementById('pf-dept').value,
      manager_id: parseInt(document.getElementById('pf-manager').value) || null,
      start_date: document.getElementById('pf-start').value || null,
      end_date: document.getElementById('pf-end').value || null,
      description: document.getElementById('pf-desc').value,
      members,
    };
    try {
      if (isEdit) {
        await api.updateTaskProject(project.id, data);
        await api.saveTaskProjectMembers(project.id, members);
      } else {
        await api.createTaskProject(data);
      }
      closeModal();
      toast('Đã lưu Project', 'success');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('pf-archive')?.addEventListener('click', async () => {
    if (!confirm('Lưu trữ Project này?')) return;
    try {
      await api.archiveTaskProject(project.id);
      closeModal();
      toast('Đã lưu trữ', 'success');
      onDone?.({ archivedProjectId: project.id });
    }
    catch (e) { toast(e.message, 'error'); }
  });
}

function openProjectGroupForm(onDone) {
  // A "Project Group / Category" in the left navigator is simply the grouping
  // label (project.department) shared by Projects (e.g. BOD, HC-NS THÔNG BÁO,
  // vp-hcm). It is NOT the HR department entity. Creating a group here creates
  // the first Project carrying that label so the group becomes visible.
  openModal('Tạo Nhóm dự án (Project Group)', `
    <div class="field"><label>Tên nhóm dự án *</label><input id="pg-name" placeholder="VD: vp-hcm, THỰC TẬP SINH, PHÒNG MARKETING"/></div>
    <div class="field" style="margin-top:10px;"><label>Tên Project khởi tạo trong nhóm</label><input id="pg-project-name" placeholder="Để trống = trùng tên nhóm"/></div>
    <p style="font-size:12px;color:var(--text-2);margin-top:8px;">Nhóm dự án chỉ là nhãn phân loại tự do để gom các Project (VD: vp-hcm, THỰC TẬP SINH, PHÒNG MARKETING). Không cần trùng với phòng ban HR. Hệ thống sẽ tạo một Project đầu tiên mang nhãn này để nhóm xuất hiện trên board bên trái.</p>
  `, `
    <button class="btn-secondary" id="pg-cancel">Hủy</button>
    <button class="btn-primary" id="pg-save">Tạo nhóm</button>
  `);
  document.getElementById('pg-cancel').addEventListener('click', closeModal);
  document.getElementById('pg-save').addEventListener('click', async () => {
    const groupName = document.getElementById('pg-name').value.trim();
    if (!groupName) { toast('Vui lòng nhập tên nhóm dự án', 'error'); return; }
    const projectName = document.getElementById('pg-project-name').value.trim() || groupName;
    const saveBtn = document.getElementById('pg-save');
    saveBtn.disabled = true;
    try {
      const created = await api.createTaskProject({ name: projectName, code: '', type: 'project', status: 'active', department: groupName, description: '', start_date: null, end_date: null, members: [] });
      closeModal();
      toast(`Đã tạo nhóm dự án "${groupName}" (kèm Project "${projectName}")`, 'success');
      onDone?.(created?.id || null);
    } catch (e) { toast(e.message || 'Không tạo được nhóm dự án', 'error'); saveBtn.disabled = false; }
  });
}

function openProjectForm(project, users, departments, projects, prefillGroup, onDone) {
  const isEdit = !!project;
  const selectedMembers = new Set(String(project?.member_ids || '').split(',').map(x => Number(x)).filter(Boolean));
  const departmentOptions = departments.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  const groupSet = new Set((projects || []).map(p => (p.department || '').trim()).filter(Boolean));
  const groupOptions = [...groupSet].sort((a, b) => String(a).localeCompare(String(b), 'vi', { sensitivity: 'base' }));

  openModal(isEdit ? 'Sửa Project' : 'Tạo Project', `
    <div class="project-form-grid">
      <div class="project-form-panel">
        <div class="input-row">
          <div class="field"><label>Tên *</label><input id="pf-name" value="${esc(project?.name || '')}" placeholder="VD: Chiến dịch Marketing tháng 7"/></div>
          <div class="field"><label>Mã</label><input id="pf-code" value="${esc(project?.code || '')}" placeholder="VD: MKT-0726"/></div>
        </div>
        <div class="input-row">
          <div class="field"><label>Trạng thái</label><select id="pf-status"><option value="active" ${(!project||project.status==='active')?'selected':''}>Đang hoạt động</option><option value="paused" ${project?.status==='paused'?'selected':''}>Tạm dừng</option><option value="done" ${project?.status==='done'?'selected':''}>Hoàn tất</option><option value="archived" ${project?.status==='archived'?'selected':''}>Lưu trữ</option></select></div>
          <div class="field"><label>Nhóm / Danh mục</label><input id="pf-dept" list="pf-dept-list" value="${esc(project?.department || prefillGroup || '')}" placeholder="Chọn hoặc gõ tên nhóm dự án"/><datalist id="pf-dept-list">${groupOptions.map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
        </div>
        <div class="field"><label>Quản lý</label><select id="pf-manager"><option value="">-- Chưa chọn --</option>${users.map(u => `<option value="${u.id}" ${project?.manager_id==u.id?'selected':''}>${esc(u.full_name)}${u.employee_code ? ` · ${esc(u.employee_code)}` : ''}</option>`).join('')}</select></div>
        <div class="input-row">
          <div class="field"><label>Bắt đầu</label><input type="date" id="pf-start" value="${esc(project?.start_date || '')}"/></div>
          <div class="field"><label>Kết thúc</label><input type="date" id="pf-end" value="${esc(project?.end_date || '')}"/></div>
        </div>
        <div class="field"><label>Mô tả</label><textarea id="pf-desc" style="min-height:132px;">${esc(project?.description || '')}</textarea></div>
      </div>

      <div class="project-form-panel project-form-panel-muted">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:14px;font-weight:800;color:var(--text);">Thành viên Project</div>
            <div id="pf-member-count" style="font-size:12px;color:var(--text-2);margin-top:2px;"></div>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn-secondary btn-xs" id="pf-select-visible">Chọn trang</button>
            <button type="button" class="btn-secondary btn-xs" id="pf-clear-visible">Bỏ chọn</button>
          </div>
        </div>
        <div class="member-picker-tools">
          <input type="text" id="pf-member-search" placeholder="Tìm tên, mã NV, email..."/>
          <select id="pf-member-dept"><option value="">Tất cả phòng ban</option>${departmentOptions}</select>
        </div>
        <div id="pf-member-list" class="member-picker-list"></div>
      </div>
    </div>
  `, `
    <button class="btn-secondary" id="pf-cancel">Hủy</button>
    ${isEdit ? `<button class="btn-danger" id="pf-archive">Lưu trữ</button>` : ''}
    <button class="btn-primary" id="pf-save">Lưu</button>
  `);

  document.getElementById('modal')?.classList.add('modal--scroll-fixed', 'modal--project');

  const normalized = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function filteredUsers() {
    const q = normalized(document.getElementById('pf-member-search')?.value);
    const dept = document.getElementById('pf-member-dept')?.value || '';
    return users.filter(u => {
      const haystack = normalized(`${u.full_name || ''} ${u.employee_code || ''} ${u.email || ''} ${u.department || ''}`);
      const matchesSearch = !q || haystack.includes(q);
      const matchesDept = !dept || u.department === dept;
      return matchesSearch && matchesDept;
    });
  }
  function renderMemberPicker() {
    const visible = filteredUsers();
    const list = document.getElementById('pf-member-list');
    const count = document.getElementById('pf-member-count');
    if (count) count.textContent = `${selectedMembers.size} đã chọn · ${visible.length} đang hiển thị`;
    if (!list) return;
    list.innerHTML = visible.map(u => `
      <label class="member-picker-row">
        <input type="checkbox" class="pf-member-check" value="${u.id}" ${selectedMembers.has(Number(u.id)) ? 'checked' : ''}/>
        <span>
          <span class="member-picker-name">${esc(u.full_name || '')}</span>
          <span class="member-picker-meta">${esc(u.employee_code || 'Chưa có mã')} · ${esc(u.department || 'Chưa có phòng ban')}</span>
          <span class="member-picker-meta">${esc(u.email || '')}</span>
        </span>
      </label>
    `).join('') || `<div class="task-group-empty">Không tìm thấy thành viên phù hợp</div>`;
    list.querySelectorAll('.pf-member-check').forEach(cb => cb.addEventListener('change', () => {
      const id = Number(cb.value);
      if (cb.checked) selectedMembers.add(id);
      else selectedMembers.delete(id);
      renderMemberPicker();
    }));
  }

  document.getElementById('pf-member-search')?.addEventListener('input', renderMemberPicker);
  document.getElementById('pf-member-dept')?.addEventListener('change', renderMemberPicker);
  document.getElementById('pf-select-visible')?.addEventListener('click', () => {
    filteredUsers().forEach(u => selectedMembers.add(Number(u.id)));
    renderMemberPicker();
  });
  document.getElementById('pf-clear-visible')?.addEventListener('click', () => {
    filteredUsers().forEach(u => selectedMembers.delete(Number(u.id)));
    renderMemberPicker();
  });
  document.getElementById('pf-cancel')?.addEventListener('click', closeModal);
  renderMemberPicker();

  document.getElementById('pf-save').addEventListener('click', async () => {
    const name = document.getElementById('pf-name').value.trim();
    if (!name) { toast('Vui lòng nhập tên Project', 'error'); return; }
    const members = Array.from(selectedMembers).filter(Boolean);
    const data = {
      name,
      code: document.getElementById('pf-code').value,
      type: 'project',
      status: document.getElementById('pf-status').value,
      department: document.getElementById('pf-dept').value,
      manager_id: parseInt(document.getElementById('pf-manager').value) || null,
      start_date: document.getElementById('pf-start').value || null,
      end_date: document.getElementById('pf-end').value || null,
      description: document.getElementById('pf-desc').value,
      members,
    };
    try {
      if (isEdit) {
        await api.updateTaskProject(project.id, data);
        await api.saveTaskProjectMembers(project.id, members);
      } else {
        await api.createTaskProject(data);
      }
      closeModal();
      toast('Đã lưu Project', 'success');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('pf-archive')?.addEventListener('click', async () => {
    if (!confirm('Lưu trữ Project này?')) return;
    try {
      await api.archiveTaskProject(project.id);
      closeModal();
      toast('Đã lưu trữ', 'success');
      onDone?.({ archivedProjectId: project.id });
    }
    catch (e) { toast(e.message, 'error'); }
  });
}

function openGroupForm(group, projectId, groupCount, onDone) {
  const isEdit = !!group;
  openModal(isEdit ? 'Sửa nhóm công việc' : 'Tạo nhóm công việc', `
    <div class="field"><label>Tên nhóm *</label><input id="gf-name" value="${esc(group?.name || '')}" placeholder="VD: Thiết kế 2D"/></div>
    <div class="field"><label>Thứ tự</label><input type="number" id="gf-position" value="${esc(group?.position ?? groupCount ?? 0)}"/></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="gf-save">Lưu</button>
  `);
  document.getElementById('gf-save').addEventListener('click', async () => {
    const data = {
      project_id: projectId,
      name: document.getElementById('gf-name').value.trim(),
      position: Number(document.getElementById('gf-position').value || 0),
      color: '#FFFFFF',
    };
    if (!data.name) { toast('Vui lòng nhập tên nhóm', 'error'); return; }
    try {
      if (isEdit) await api.updateTaskGroup(group.id, data);
      else await api.createTaskGroup(data);
      closeModal();
      toast('Đã lưu nhóm công việc', 'success');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function openLabelManager(labels, projects, onDone) {
  const rows = labels.map(l => `
    <div class="label-manager-row">
      <div class="label-manager-swatch" style="background:${esc(l.color || '#6366F1')};"></div>
      <div>
        <div class="label-manager-title">${esc(l.name)}</div>
        <div class="label-manager-meta">${l.project_name ? esc(l.project_name) : 'Toàn workspace'} · ${Number(l.usage_count || 0)} task</div>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;">
        <button class="btn-secondary btn-xs edit-label" data-id="${l.id}">Sửa</button>
        <button class="btn-danger btn-xs del-label" data-id="${l.id}">Xóa</button>
      </div>
    </div>
  `).join('');

  openModal('Quản lý nhãn màu', `
    <div class="label-manager-head">
      <div style="font-size:13px;color:var(--text-2);">Chọn màu để đánh dấu nhanh mức độ, nhóm việc hoặc loại chiến dịch.</div>
      <button id="lm-new" class="btn-primary btn-sm">+ Thêm nhãn</button>
    </div>
    <div class="label-manager-list">${rows || '<div class="label-picker-empty">Chưa có nhãn màu</div>'}</div>
  `, `<button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Đóng</button>`);

  document.getElementById('lm-new').addEventListener('click', () => openLabelForm(null, projects, onDone));
  document.querySelectorAll('.edit-label').forEach(btn => btn.addEventListener('click', () => openLabelForm(labels.find(l => String(l.id) === btn.dataset.id), projects, onDone)));
  document.querySelectorAll('.del-label').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Xóa nhãn này? Task đã dùng nhãn sẽ giữ màu hiện tại.')) return;
    try { await api.deleteTaskLabel(btn.dataset.id); closeModal(); toast('Đã xóa nhãn', 'success'); onDone?.(); }
    catch (e) { toast(e.message, 'error'); }
  }));
}

function openLabelForm(label, projects, onDone) {
  openModal(label ? 'Sửa nhãn' : 'Thêm nhãn', `
    <div class="field"><label>Tên *</label><input id="lf-name" value="${esc(label?.name || '')}" placeholder="VD: Ưu tiên thiết kế"/></div>
    <div class="field"><label>Phạm vi</label><select id="lf-project"><option value="">Toàn workspace</option>${projects.map(p => `<option value="${p.id}" ${label?.project_id==p.id?'selected':''}>${esc(projectLabel(p))}</option>`).join('')}</select></div>
    <div class="field"><label>Màu</label><div class="label-form-colors">${LABEL_COLORS.map(c => `<label class="label-color-option"><input type="radio" name="lf-color" value="${c}" ${(label?.color || '#6366F1') === c ? 'checked' : ''}/><span style="background:${c};"></span></label>`).join('')}</div></div>
    <div class="field"><label>Mô tả</label><textarea id="lf-desc">${esc(label?.description || '')}</textarea></div>
  `, `
    <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
    <button class="btn-primary" id="lf-save">Lưu</button>
  `);

  document.getElementById('lf-save').addEventListener('click', async () => {
    const data = {
      name: document.getElementById('lf-name').value.trim(),
      project_id: parseInt(document.getElementById('lf-project').value) || null,
      color: document.querySelector('input[name="lf-color"]:checked')?.value || '#6366F1',
      description: document.getElementById('lf-desc').value,
    };
    if (!data.name) { toast('Vui lòng nhập tên nhãn', 'error'); return; }
    try {
      if (label) await api.updateTaskLabel(label.id, data);
      else await api.createTaskLabel(data);
      closeModal();
      toast('Đã lưu nhãn', 'success');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  });
}
