import { api } from '../api.js';
import { esc, taskStatusBadge, priorityBadge, toast, openModal, closeModal, loadingHTML, emptyHTML, today } from '../utils.js';
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
  const canManage = canManageTasks(me);

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

  try { users = (await api.getUsers()).users || []; } catch (_) {}
  try { departments = (await api.getDepartments()).departments || []; } catch (_) {}

  async function loadProjects() {
    const params = {};
    const search = el.querySelector('#project-search')?.value.trim();
    if (search) params.search = search;
    if (canManage && el.querySelector('#project-archived')?.checked) params.include_archived = 1;
    const res = await api.getTaskProjects(params);
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

  function renderProjectsOld() {
    const list = el.querySelector('#project-list');
    if (!list) return;
    list.innerHTML = projects.map(p => `
      <span style="display:inline-flex;gap:4px;align-items:center;">
        <button class="filter-chip ${String(selectedProjectId) === String(p.id) ? 'active' : ''}" data-project="${p.id}" title="${esc(p.description || '')}">
          ${esc(projectLabel(p))}
          <span style="font-size:11px;color:var(--text-2);margin-left:4px;">${Number(p.task_count || 0)} việc</span>
        </button>
        ${canManage ? `<button class="btn-secondary btn-xs project-edit" data-edit-project="${p.id}">Sửa</button>` : ''}
      </span>
    `).join('') || `<span style="font-size:13px;color:var(--text-2);padding:8px 0;">Chưa có Project</span>`;

    list.querySelectorAll('[data-project]').forEach(btn => btn.addEventListener('click', () => {
      selectedProjectId = btn.dataset.project || '';
      currentStatus = '';
      renderProjects();
      loadBoard();
    }));
    list.querySelectorAll('[data-edit-project]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const project = projects.find(p => String(p.id) === btn.dataset.editProject);
      openProjectForm(project, users, departments, refreshProjectsAfterMutation);
    }));
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
      return `
      <section class="task-project-nav-department ${isExpanded ? 'is-expanded' : 'is-collapsed'}">
        <button type="button" class="task-project-nav-department-toggle" data-department-toggle="${esc(department)}" aria-expanded="${isExpanded}" aria-controls="${contentId}">
          <span class="task-project-nav-department-arrow" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
          <span class="task-project-nav-department-title">${esc(department)}</span>
          <span class="task-project-nav-department-count">${departmentProjects.length}</span>
        </button>
        <div id="${contentId}" class="task-project-nav-department-content" ${isExpanded ? '' : 'hidden'}>
        ${departmentProjects.map(p => `
          <div class="task-project-nav-row">
            <button type="button" class="task-project-nav-item ${String(selectedProjectId) === String(p.id) ? 'active' : ''}" data-project="${p.id}" title="${esc(p.description || '')}">
              <span class="task-project-nav-item-title">${esc(projectLabel(p))}</span>
              <span class="task-project-nav-item-meta">${Number(p.task_count || 0)} việc · ${esc(projectStatusText(p.status))}</span>
            </button>
            ${canManage ? `<button type="button" class="btn-secondary btn-xs project-edit" data-edit-project="${p.id}" aria-label="Sửa ${esc(projectLabel(p))}">Sửa</button>` : ''}
          </div>
        `).join('')}
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
    list.querySelectorAll('[data-edit-project]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const project = projects.find(p => String(p.id) === btn.dataset.editProject);
      openProjectForm(project, users, departments, refreshProjectsAfterMutation);
    }));
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
    const params = { project_id: selectedProjectId };
    if (currentStatus) params.status = currentStatus;
    const [groupRes, labelRes, taskRes, memberRes] = await Promise.all([
      api.getTaskGroups({ project_id: selectedProjectId }),
      api.getTaskLabels({ project_id: selectedProjectId }),
      api.getTasks(params),
      api.getTaskProjectMembers(selectedProjectId).catch(() => ({ members: [] })),
    ]);
    groups = groupRes.groups || [];
    labels = labelRes.labels || [];
    tasks = taskRes.tasks || [];
    projectMembers = memberRes.members || [];
    renderBoard();
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

    board.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header" style="gap:10px;flex-wrap:wrap;align-items:center;">
          <div class="task-project-board-title">
            <div class="card-title">${esc(projectLabel(project))}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px;">${esc(project.department || 'Chưa chọn phòng ban')} · ${Number(project.member_count || 0)} thành viên</div>
          </div>
          <button type="button" id="btn-project-members" class="task-project-member-stack" aria-label="Xem thành viên Project">
            ${projectMembers.slice(0, 5).map(memberAvatar).join('') || '<span class="task-project-member-avatar task-project-member-avatar--empty">?</span>'}
            ${projectMembers.length > 5 ? `<span class="task-project-member-more">+${projectMembers.length - 5}</span>` : ''}
            ${canManage ? '<span class="task-project-member-add" aria-hidden="true">+</span>' : ''}
          </button>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
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
      <div class="task-board-wrap">
        ${groups.map((group, index) => renderGroupColumn(group, index, defaultGroup)).join('')}
      </div>
    `;

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
        if (e.target.closest('select,button')) return;
        openTaskPanel(parseInt(card.dataset.tid));
      });
    });
    board.querySelectorAll('#task-status-bar [data-status]').forEach(chip => chip.addEventListener('click', () => {
      currentStatus = chip.dataset.status;
      loadBoard();
    }));
  }

  function renderGroupColumnOld(group, index, defaultGroup) {
    const groupTasks = tasks.filter(t => {
      if (t.group_id) return String(t.group_id) === String(group.id);
      return String(group.id) === String(defaultGroup.id);
    });
    return `
      <section style="min-width:310px;max-width:360px;flex:0 0 330px;background:${esc(groupColor(group, index))};border:1px solid var(--border);border-radius:8px;padding:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <div>
            <div style="font-weight:800;color:var(--text);">${esc(taskGroupLabel(group.name))}</div>
            <div style="font-size:12px;color:var(--text-2);">${groupTasks.length} công việc</div>
          </div>
          ${canManage ? `<div style="display:flex;gap:4px;"><button class="btn-secondary btn-xs" data-edit-group="${group.id}">Sửa</button><button class="btn-outline-danger" data-archive-group="${group.id}">Ẩn</button></div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${groupTasks.map(t => renderTaskCard(t)).join('') || `<div style="font-size:13px;color:var(--text-2);padding:12px;text-align:center;background:rgba(255,255,255,.55);border-radius:8px;">Chưa có task</div>`}
        </div>
        <button class="btn-secondary btn-sm" data-add-task-group="${group.id}" style="width:100%;margin-top:10px;">+ Thêm công việc</button>
      </section>
    `;
  }

  function renderGroupColumn(group, index, defaultGroup) {
    const groupTasks = tasks.filter(t => {
      if (t.group_id) return String(t.group_id) === String(group.id);
      return String(group.id) === String(defaultGroup.id);
    });
    return `
      <section class="task-group-column">
        <div class="task-group-head">
          <div>
            <div class="task-group-title">${esc(taskGroupLabel(group.name))}</div>
            <div class="task-group-count">${groupTasks.length} công việc</div>
          </div>
          ${canManage ? `<div style="display:flex;gap:4px;"><button class="btn-secondary btn-xs" data-edit-group="${group.id}">Sửa</button><button class="btn-outline-danger" data-archive-group="${group.id}">Ẩn</button></div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${groupTasks.map(t => renderTaskCard(t)).join('') || `<div class="task-group-empty">Chưa có task</div>`}
        </div>
        <button class="btn-secondary btn-sm" data-add-task-group="${group.id}" style="width:100%;margin-top:10px;">+ Thêm công việc</button>
      </section>
    `;
  }

  function renderTaskCard(t) {
    const color = t.label_color_real || t.label_color || '#6366F1';
    return `
      <div class="task-card" data-tid="${t.id}" style="border-left-color:${esc(color)};background:#fff;margin:0;">
        <div class="task-card-title">${esc(t.title)}</div>
        ${t.description ? `<div style="font-size:12px;color:var(--text-2);margin:4px 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(richTextToPlainText(t.description))}</div>` : ''}
        <div class="task-card-meta">
          ${taskStatusBadge(t.status)}
          ${priorityBadge(t.priority)}
          ${t.label_name ? `<span class="badge badge-gray" style="display:inline-flex;gap:5px;align-items:center;">${labelDot(color)}${esc(t.label_name)}</span>` : ''}
          ${t.assignee_name ? `<span class="task-card-assignee">👤 ${esc(t.assignee_name)}${t.assignee_code ? ` · ${esc(t.assignee_code)}` : ''}</span>` : ''}
          ${t.due_date ? `<span style="font-size:11px;color:var(--text-2)">Hạn: ${esc(t.due_date)}</span>` : ''}
          ${Number(t.subtask_total) > 0 ? `<span style="font-size:11px;color:var(--text-2)">Subtask: ${Number(t.subtask_done)||0}/${Number(t.subtask_total)||0}</span>` : ''}
          ${Number(t.follower_count) > 0 ? `<span style="font-size:11px;color:var(--text-2)">👁 ${Number(t.follower_count)} theo dõi</span>` : ''}
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
  el.querySelector('#btn-new-project')?.addEventListener('click', () => openProjectForm(null, users, departments, refreshProjectsAfterMutation));
  el.querySelector('#btn-new-task').addEventListener('click', () => {
    const project = selectedProject();
    if (!project) { toast('Vui lòng chọn Project trước khi tạo việc', 'error'); return; }
    openTaskForm(null, users, me, loadBoard, { project, groups, labels, selectedGroupId: groups[0]?.id || '', departments});
  });

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

function openProjectForm(project, users, departments, onDone) {
  const isEdit = !!project;
  const selectedMembers = new Set(String(project?.member_ids || '').split(',').map(x => Number(x)).filter(Boolean));
  const departmentOptions = departments.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');

  openModal(isEdit ? 'Sửa Project' : 'Tạo Project', `
    <div class="project-form-grid">
      <div class="project-form-panel">
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
