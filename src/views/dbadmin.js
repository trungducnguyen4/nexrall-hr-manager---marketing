import { api } from '../api.js';
import { esc, toast, openModal, closeModal, loadingHTML, emptyHTML } from '../utils.js';

const PAGE_SIZE = 10;

export async function renderDbAdmin(el, me) {
  if (me.role !== 'admin') {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-text">Chỉ Admin mới có quyền truy cập</div></div>`;
    return;
  }

  let tables = [];
  let currentTable = '';
  let currentMeta = null;
  let rows = [];
  let total = 0;
  let offset = 0;
  let search = '';

  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div class="page-title">🗂️ Database Admin</div>
        <div class="page-sub">Xem và chỉnh sửa dữ liệu hệ thống ở chế độ admin an toàn</div>
      </div>
      <button id="db-refresh" class="btn-secondary btn-sm">🔄 Làm mới</button>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <select id="db-table-select" style="flex:1;min-width:180px;"></select>
        <input id="db-search" type="text" placeholder="Tìm kiếm..." style="flex:2;min-width:180px;"/>
        <button id="db-add" class="btn-primary btn-sm">+ Thêm dòng</button>
        <button id="db-export" class="btn-secondary btn-sm">⬇ Export CSV</button>
      </div>
    </div>

    <div id="db-meta" class="policy-note" style="display:none;"></div>
    <div id="db-content">${loadingHTML()}</div>
  `;

  const tableSelect = document.getElementById('db-table-select');
  const searchInput = document.getElementById('db-search');

  document.getElementById('db-refresh').addEventListener('click', () => loadRows());
  document.getElementById('db-add').addEventListener('click', () => openRowForm(null));
  document.getElementById('db-export').addEventListener('click', exportCsv);
  tableSelect.addEventListener('change', () => {
    currentTable = tableSelect.value;
    offset = 0;
    loadRows();
  });
  searchInput.addEventListener('input', debounce(() => {
    search = searchInput.value.trim();
    offset = 0;
    loadRows();
  }, 250));

  async function loadTables() {
    const content = document.getElementById('db-content');
    content.innerHTML = loadingHTML();
    try {
      tables = (await api.getDbTables()).tables || [];
      tableSelect.innerHTML = tables.map(t => `<option value="${esc(t.name)}">${esc(t.label)} (${esc(t.name)})</option>`).join('');
      currentTable = tables[0]?.name || '';
      if (!currentTable) {
        content.innerHTML = emptyHTML('🗂️', 'Không có bảng nào có thể quản trị');
        return;
      }
      await loadRows();
    } catch (e) {
      content.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  async function loadRows() {
    const content = document.getElementById('db-content');
    if (!currentTable) return;
    content.innerHTML = loadingHTML();
    try {
      const data = await api.getDbRows(currentTable, { search, limit: PAGE_SIZE, offset });
      currentMeta = data.table;
      rows = data.rows || [];
      total = data.total || 0;
      renderMeta();
      renderRows();
    } catch (e) {
      content.innerHTML = emptyHTML('⚠️', e.message);
    }
  }

  function renderMeta() {
    const meta = document.getElementById('db-meta');
    const editable = currentMeta.columns.filter(c => c.editable).length;
    meta.style.display = 'block';
    meta.textContent = `${currentMeta.label} · ${currentMeta.columns.length} cột hiển thị · ${editable} cột có thể sửa · Primary key: ${currentMeta.pk}`;
  }

  function renderRows() {
    const content = document.getElementById('db-content');
    if (!rows.length) {
      content.innerHTML = emptyHTML('🗂️', 'Không có dữ liệu phù hợp');
      return;
    }
    const cols = currentMeta.columns;
    content.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${cols.map(c => `<th>${esc(c.name)}</th>`).join('')}
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, idx) => `
              <tr>
                ${cols.map(c => `<td>${formatCell(row[c.name])}</td>`).join('')}
                <td style="white-space:nowrap;">
                  <button class="btn-xs btn-secondary db-edit" data-idx="${idx}">✏️</button>
                  <button class="btn-xs btn-danger db-delete" data-idx="${idx}">🗑</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;">
        <button id="db-prev" class="btn-secondary btn-sm" ${offset <= 0 ? 'disabled' : ''}>← Trước</button>
        <div style="font-size:12px;color:var(--text-2);font-weight:600;">${offset + 1}-${Math.min(offset + rows.length, total)} / ${total}</div>
        <button id="db-next" class="btn-secondary btn-sm" ${offset + rows.length >= total ? 'disabled' : ''}>Sau →</button>
      </div>
    `;
    content.querySelectorAll('.db-edit').forEach(btn => {
      btn.addEventListener('click', () => openRowForm(rows[parseInt(btn.dataset.idx, 10)]));
    });
    content.querySelectorAll('.db-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteRow(rows[parseInt(btn.dataset.idx, 10)]));
    });
    document.getElementById('db-prev').addEventListener('click', () => {
      offset = Math.max(0, offset - PAGE_SIZE);
      loadRows();
    });
    document.getElementById('db-next').addEventListener('click', () => {
      offset += PAGE_SIZE;
      loadRows();
    });
  }

  function openRowForm(row) {
    if (!currentMeta) return;
    const isEdit = !!row;
    const editableCols = currentMeta.columns.filter(c => c.editable);
    if (!editableCols.length) {
      toast('Bảng này không có cột có thể chỉnh sửa', 'warning');
      return;
    }
    openModal(isEdit ? `Sửa ${currentMeta.label}` : `Thêm dòng vào ${currentMeta.label}`, `
      ${editableCols.map(c => formField(c, row?.[c.name])).join('')}
    `, `
      <button class="btn-secondary" onclick="document.getElementById('modal-overlay').classList.add('hidden')">Hủy</button>
      <button class="btn-primary" id="db-save-row">Lưu</button>
    `);
    document.getElementById('db-save-row').addEventListener('click', async () => {
      const payload = {};
      editableCols.forEach(c => {
        const field = document.getElementById(`dbf-${c.name}`);
        payload[c.name] = field ? field.value : '';
      });
      try {
        if (isEdit) await api.updateDbRow(currentMeta.name, row[currentMeta.pk], payload);
        else await api.createDbRow(currentMeta.name, payload);
        closeModal();
        toast('Đã lưu dữ liệu', 'success');
        loadRows();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  async function deleteRow(row) {
    const id = row?.[currentMeta.pk];
    if (id == null) {
      toast('Không tìm thấy primary key để xóa', 'error');
      return;
    }
    if (!confirm(`Xóa dòng ${currentMeta.pk}=${id} trong bảng ${currentMeta.name}?`)) return;
    try {
      await api.deleteDbRow(currentMeta.name, id);
      toast('Đã xóa dòng', 'success');
      if (rows.length === 1 && offset > 0) offset = Math.max(0, offset - PAGE_SIZE);
      loadRows();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function exportCsv() {
    if (!currentMeta || !rows.length) {
      toast('Không có dữ liệu để export', 'warning');
      return;
    }
    const cols = currentMeta.columns.map(c => c.name);
    const csv = [
      cols.map(csvValue).join(','),
      ...rows.map(row => cols.map(c => csvValue(row[c])).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentMeta.name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  loadTables();
}

function formField(col, value) {
  const val = value == null ? '' : String(value);
  const type = String(col.type || '').toUpperCase();
  const name = col.name.toLowerCase();
  const inputType = type.includes('INT') || type.includes('REAL') || type.includes('NUM') ? 'number' : (name.includes('date') ? 'date' : 'text');
  if (val.length > 80 || name.includes('note') || name.includes('description') || name.includes('comment')) {
    return `<div class="field"><label>${esc(col.name)}</label><textarea id="dbf-${esc(col.name)}" rows="3">${esc(val)}</textarea></div>`;
  }
  return `<div class="field"><label>${esc(col.name)}</label><input id="dbf-${esc(col.name)}" type="${inputType}" value="${esc(val)}"/></div>`;
}

function formatCell(value) {
  if (value == null || value === '') return '<span style="color:var(--text-3);">—</span>';
  const s = String(value);
  return esc(s.length > 120 ? s.slice(0, 117) + '...' : s);
}

function csvValue(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
