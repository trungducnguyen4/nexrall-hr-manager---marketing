import { api } from '../api.js';
import { EventBus } from '../event-bus.js';
import { esc, openModal, closeModal, toast, loadingHTML, emptyHTML, sortVietnameseNames, compareVietnameseNames } from '../utils.js?v=20260729-modal-reset';
import { icon } from '../icons.js';

const SCORED = [
  ['HS01', 'Hoàn thành mục tiêu tháng'], ['HS02', 'Chất lượng đầu ra'],
  ['HS03', 'Tiến độ và ưu tiên'], ['HS04', 'Giải quyết vấn đề'],
  ['HS05', 'Chuyên môn và kỹ thuật'], ['HS06', 'Hiệu quả độc lập'],
];
const KPI_MAX = { HS01: 15, HS02: 10, HS03: 10, HS04: 10, HS05: 10, HS06: 5 };
const status = { DRAFT: 'Chờ nhân viên gửi', SUBMITTED: 'Chờ HCNS duyệt', APPROVED: 'Đã duyệt', RETURNED: 'Cần chỉnh sửa' };
const now = () => ({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });
const hr = user => user.role === 'admin' || user.department === 'Phòng HCNS';

function safeDescriptionHtml(value) {
  if (!String(value || '').trim()) return '<span class="employee-kpi-empty-description">—</span>';
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A']);
  const source = new DOMParser().parseFromString(String(value), 'text/html');
  const clean = document.createElement('div');
  const copy = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (!allowed.has(node.tagName)) { [...node.childNodes].forEach(child => copy(child, parent)); return; }
    const element = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) { element.href = href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
    }
    [...node.childNodes].forEach(child => copy(child, element)); parent.appendChild(element);
  };
  [...source.body.childNodes].forEach(node => copy(node, clean));
  return clean.innerHTML || '<span class="employee-kpi-empty-description">—</span>';
}
function evidenceHtml(item, editable) {
  const links = Array.isArray(item.evidence) ? item.evidence : [];
  if (!editable && !links.length) return item.requires_evidence ? '<span class="kpi-evidence-required">Thiếu link</span>' : '—';
  return `<div class="kpi-evidence" data-item="${item.id}">${links.map(link => editable ? `<div class="kpi-evidence-entry"><input class="kpi-evidence-label" value="${esc(link.label || '')}" placeholder="Tên sản phẩm"><input class="kpi-evidence-url" value="${esc(link.url || '')}" placeholder="https://..."><button type="button" class="kpi-evidence-remove" aria-label="Xóa link">×</button></div>` : `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label || link.url)}</a>`).join('')}${editable ? `<button type="button" class="btn-secondary btn-sm kpi-evidence-add">+ Thêm link</button>` : ''}${item.requires_evidence ? '<small class="kpi-evidence-required">Bắt buộc</small>' : ''}</div>`;
}
function bindEvidenceEditors(root) {
  root.querySelectorAll('.kpi-evidence').forEach(box => {
    const add = () => box.insertAdjacentHTML('beforeend', '<div class="kpi-evidence-entry"><input class="kpi-evidence-label" placeholder="Tên sản phẩm"><input class="kpi-evidence-url" placeholder="https://..."><button type="button" class="kpi-evidence-remove" aria-label="Xóa link">×</button></div>');
    box.querySelector('.kpi-evidence-add')?.addEventListener('click', add);
    box.addEventListener('click', event => { if (event.target.closest('.kpi-evidence-remove')) event.target.closest('.kpi-evidence-entry').remove(); });
  });
}
function readEvidence(root, itemId) {
  return [...root.querySelectorAll(`.kpi-evidence[data-item="${itemId}"] .kpi-evidence-entry`)].map(row => ({ label: row.querySelector('.kpi-evidence-label')?.value.trim() || '', url: row.querySelector('.kpi-evidence-url')?.value.trim() || '' })).filter(link => link.label || link.url);
}
async function printKpiSnapshot(planId) {
  try {
    const { snapshot, audit = [] } = await api.getKpiSnapshot(planId);
    const data = snapshot.payload, employee = data.employee || {}, items = data.items || [];
    const rows = items.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.criterion_code)}</td><td><strong>${esc(item.title)}</strong><div class="description">${safeDescriptionHtml(item.description)}</div></td><td>${esc(item.target_value)} ${esc(item.unit)}</td><td>${String(item.unit || '').toLowerCase() === 'text' ? esc(item.actual_text || '—') : esc(item.actual_value ?? '—')}</td><td>${(item.evidence || []).map(link => `<a href="${esc(link.url)}">${esc(link.label || link.url)}</a>`).join('<br>') || '—'}</td><td>${item.manual_score != null ? `${esc(item.manual_score)}/${KPI_MAX[item.criterion_code] || 0}` : '—'}</td></tr>`).join('');
    const history = audit.length ? `<section><h3>Lịch sử bằng chứng</h3><ul>${audit.map(x => `<li>${esc(x.created_at)} · ${esc(x.changed_by_name || 'Hệ thống')} · ${esc(x.action)}</li>`).join('')}</ul></section>` : '';
    const popup = window.open('', '_blank');
    if (!popup) return toast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.', 'error');
    popup.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu kết quả KPI ${data.plan.month}/${data.plan.year}</title><style>@page{size:A4 landscape;margin:12mm}body{font:12px Arial;color:#172033}h1{text-align:center;margin:0;color:#9E2525;font-size:21px}h2{text-align:center;font-size:15px;margin:7px 0 18px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;padding:12px;border:1px solid #d8dee8;background:#f8fafc}.meta b{color:#111}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#f4a51c;color:#fff;text-align:center}th,td{border:1px solid #d8dee8;padding:7px;vertical-align:top}td:first-child,td:nth-child(2),td:nth-child(4),td:nth-child(7){text-align:center}.description{margin-top:5px;color:#596273;line-height:1.4}.description p{margin:0 0 4px}a{color:#a53c1d;word-break:break-all}h3{font-size:13px;margin:16px 0 5px}ul{margin:0;padding-left:18px}.total{margin-top:13px;padding:10px 14px;background:#fff08a;font-size:15px;font-weight:bold;text-align:right}</style></head><body><h1>CÔNG TY CỔ PHẦN TẬP ĐOÀN CÔNG NGHỆ VÀ TRUYỀN THÔNG NETVIET</h1><h2>PHIẾU KẾT QUẢ KPI THÁNG ${esc(data.plan.month)}/${esc(data.plan.year)}</h2><section class="meta"><div>Họ và tên: <b>${esc(employee.full_name || '—')}</b></div><div>Mã nhân viên: <b>${esc(employee.employee_code || '—')}</b></div><div>Phòng ban: <b>${esc(employee.department || '—')}</b></div><div>Người duyệt: <b>${esc(snapshot.approved_by_name || data.plan.reviewed_by_name || '—')}</b></div><div>Ngày duyệt: <b>${esc(snapshot.approved_at || data.plan.reviewed_at || '—')}</b></div><div>Trạng thái: <b>Đã duyệt</b></div></section><table><thead><tr><th>STT</th><th>Mã</th><th>Chỉ tiêu / Mô tả</th><th>Mục tiêu</th><th>Kết quả</th><th>Link bằng chứng</th><th>Điểm</th></tr></thead><tbody>${rows}</tbody></table><div class="total">TỔNG ĐIỂM NHÓM 1: ${esc(data.group1_total)}/60</div>${history}<script>window.onload=()=>window.print();<\/script></body></html>`);
    popup.document.close();
  } catch (error) { toast(error.message, 'error'); }
}
async function showKpiEvidenceAudit(planId) {
  try {
    const { audit = [] } = await api.getKpiSnapshot(planId);
    openModal('Lịch sử link bằng chứng', audit.length ? `<div class="table-wrap"><table><thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Thao tác</th><th>Dữ liệu mới</th></tr></thead><tbody>${audit.map(row => `<tr><td>${esc(row.created_at)}</td><td>${esc(row.changed_by_name || 'Hệ thống')}</td><td>${esc(row.action)}</td><td><pre class="kpi-audit-value">${esc(row.new_value_json || '—')}</pre></td></tr>`).join('')}</tbody></table></div>` : emptyHTML('🔎', 'Chưa có lịch sử link bằng chứng'));
  } catch (error) { toast(error.message, 'error'); }
}

export async function renderKpis(el, me) {
  const d = now(), admin = hr(me);
  el.innerHTML = `<div class="page-header"><div><div class="page-title">${icon('target', 'lg')} <span>KPI nhân viên</span></div><div class="page-sub">KPI theo nhân viên, template và điểm Nhóm 1 tự động.</div></div>${admin ? `<button id="kpi-new" class="btn-primary">${icon('plus', 'xs')} <span>Tạo KPI tháng</span></button>` : ''}</div><div class="filter-bar"><label>Tháng <input id="kpi-month" type="number" min="1" max="12" value="${d.month}" style="width:70px"></label><label>Năm <input id="kpi-year" type="number" value="${d.year}" style="width:90px"></label><button id="kpi-load" class="btn-secondary btn-sm">Xem</button></div><div id="kpi-table">${loadingHTML()}</div>`;
  async function load() {
    const month = +el.querySelector('#kpi-month').value, year = +el.querySelector('#kpi-year').value, box = el.querySelector('#kpi-table');
    box.innerHTML = loadingHTML();
    if (!admin) return renderEmployeeKpi(box, month, year, load);
    try {
      const { kpis = [] } = await api.getKpiDashboard({ month, year });
      const sortedKpis = sortVietnameseNames(kpis, 'full_name');
      box.innerHTML = sortedKpis.length ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Trạng thái</th><th>Chỉ tiêu</th><th>Nhóm 1</th></tr></thead><tbody>${sortedKpis.map(r => `<tr class="kpi-dashboard-row" tabindex="0" role="button" aria-label="Mở KPI của ${esc(r.full_name)}" data-id="${r.employee_id}"><td><strong>${esc(r.full_name)}</strong></td><td>${esc(r.department || '—')}</td><td><span class="badge ${r.status === 'APPROVED' ? 'badge-success' : r.status === 'SUBMITTED' ? 'badge-warning' : 'badge-gray'}">${esc(status[r.status] || 'Chưa cấu hình')}</span></td><td>${r.item_count || 0}</td><td>${r.group1_score == null ? '—' : r.group1_score + '/60'}</td></tr>`).join('')}</tbody></table></div></div>` : emptyHTML('🎯', 'Chưa có KPI tháng');
      box.querySelectorAll('.kpi-dashboard-row').forEach(row => { const open = () => detail(+row.dataset.id, month, year, me, load); row.onclick = open; row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }; });
    } catch (error) { box.innerHTML = emptyHTML('⚠️', error.message); }
  }
  el.querySelector('#kpi-load').onclick = load;
  el.querySelector('#kpi-new')?.addEventListener('click', () => editor(me, load));

  el._cleanup = () => {};

  EventBus.bindView(el, 'kpis', () => load());
  EventBus.bindView(el, 'kpi:*', () => load());

  await load();
}

async function renderEmployeeKpi(box, month, year, refresh) {
  try {
    const { plan, items = [] } = await api.getKpis({ month, year });
    if (!plan || !items.length) { box.innerHTML = emptyHTML('🎯', 'Bạn chưa có KPI trong tháng này'); return; }
    const editable = ['DRAFT', 'RETURNED', 'APPROVED'].includes(plan.status);
    const resubmitting = plan.status === 'APPROVED';
    box.innerHTML = `<section class="employee-kpi-page"><div class="employee-kpi-head"><div><h2>KPI tháng ${month}/${year}</h2><p>${esc(status[plan.status] || plan.status)}</p></div>${editable ? `<span class="employee-kpi-hint">${resubmitting ? 'Cập nhật xong sẽ gửi HCNS duyệt lại' : 'Nhập kết quả thực hiện cho từng chỉ tiêu'}</span>` : ''}</div><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Chỉ tiêu</th><th>Mục tiêu</th><th>Kết quả</th><th>Bằng chứng sản phẩm</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.criterion_code)}</strong>${!item.affects_group1 ? ' <small>(theo dõi)</small>' : ''}</td><td>${esc(item.title)}</td><td>${item.target_value} ${esc(item.unit)}</td><td>${editable ? `<input class="employee-kpi-actual" data-id="${item.id}" type="number" min="0" value="${item.actual_value ?? ''}" placeholder="Nhập kết quả">` : (item.actual_value ?? '—')}</td><td>${evidenceHtml(item, editable)}</td></tr>`).join('')}</tbody></table></div>${editable ? `<div class="employee-kpi-actions"><button class="btn-primary" id="employee-kpi-submit">${resubmitting ? 'Cập nhật & gửi duyệt lại' : 'Gửi duyệt'}</button></div>` : ''}</section>`;
    const table = box.querySelector('table');
    table.querySelectorAll('tbody tr').forEach((row, index) => {
      const item = items[index], isText = String(item.unit || '').toLowerCase() === 'text';
      if (!isText) return;
      row.children[2].innerHTML = '<span class="employee-kpi-manual">HCNS chấm điểm</span>';
      row.children[3].innerHTML = editable
        ? `<textarea class="employee-kpi-actual-text" data-id="${item.id}" placeholder="Nhập phần thực hiện">${esc(item.actual_text || '')}</textarea>`
        : `<div class="employee-kpi-text-result">${esc(item.actual_text || '—')}</div>`;
    });
    if (plan.status === 'RETURNED' && plan.review_note) {
      const feedback = document.createElement('section'); feedback.className = 'employee-kpi-feedback';
      feedback.innerHTML = `<div><strong>Phản hồi từ HCNS</strong><span>${esc(plan.reviewed_by_name || 'HCNS')}${plan.reviewed_at ? ` · ${esc(plan.reviewed_at)}` : ''}</span></div><p>${esc(plan.review_note || 'HCNS yêu cầu bạn rà soát và cập nhật lại KPI trước khi gửi duyệt.')}</p>`;
      table.parentElement.insertAdjacentElement('beforebegin', feedback);
    }
    table.querySelector('thead tr').children[2].insertAdjacentHTML('beforebegin', '<th>Mô tả</th>');
    table.querySelectorAll('tbody tr').forEach((row, index) => {
      const cell = document.createElement('td'); cell.className = 'employee-kpi-description';
      const item = items[index];
      cell.innerHTML = safeDescriptionHtml(item?.description) + (plan.status === 'RETURNED' && item?.review_note ? `<div class="employee-kpi-item-feedback"><strong>HCNS cần chỉnh sửa</strong><p>${esc(item.review_note)}</p></div>` : '');
      row.insertBefore(cell, row.children[2]);
    });
    bindEvidenceEditors(box);
    box.querySelector('#employee-kpi-submit')?.addEventListener('click', async () => {
      try {
        const values = items.map(item => {
          const isText = String(item.unit || '').toLowerCase() === 'text';
          return { id: item.id, actual_value: isText ? null : box.querySelector(`.employee-kpi-actual[data-id="${item.id}"]`).value, actual_text: isText ? box.querySelector(`.employee-kpi-actual-text[data-id="${item.id}"]`).value : '', evidence: readEvidence(box, item.id) };
        });
        await api.submitKpis(plan.id, values); toast('Đã gửi KPI để duyệt', 'success'); refresh();
      } catch (error) { toast(error.message, 'error'); }
    });
  } catch (error) { box.innerHTML = emptyHTML('⚠️', error.message); }
}

async function detail(employeeId, month, year, me, refresh) {
  try {
    const { plan, items } = await api.getKpis({ employee_id: employeeId, month, year });
    if (!plan) { if (hr(me)) return editor(me, refresh, employeeId, month, year); openModal('KPI tháng', emptyHTML('🎯', 'Chưa có KPI')); return; }
    const own = employeeId === me.id && !hr(me);
    const total = plan.status === 'APPROVED' ? Number(plan.group1_total || 0) : null;
    openModal('KPI tháng', `<div class="policy-note"><strong>${esc(status[plan.status] || plan.status)}</strong>${total !== null ? ` · Điểm văn bản đã chấm: ${total}/60` : ''}</div><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Chỉ tiêu</th><th>Mô tả & bằng chứng</th><th>Mục tiêu</th><th>Kết quả</th></tr></thead><tbody>${items.map(item => `<tr><td>${esc(item.criterion_code)}${!item.affects_group1 ? ' <small>(theo dõi)</small>' : ''}</td><td>${esc(item.title)}</td><td class="kpi-detail-description">${safeDescriptionHtml(item.description)}<div class="kpi-detail-evidence">${evidenceHtml(item, hr(me))}</div>${plan.status === 'RETURNED' && item.review_note ? `<div class="employee-kpi-item-feedback"><strong>HCNS cần chỉnh sửa</strong><p>${esc(item.review_note)}</p></div>` : ''}</td><td>${item.target_value} ${esc(item.unit)}</td><td>${own && ['DRAFT', 'RETURNED', 'APPROVED'].includes(plan.status) ? `<input class="actual" data-id="${item.id}" type="number" value="${item.actual_value ?? ''}">` : (String(item.unit || '').toLowerCase() === 'text' ? esc(item.actual_text || '—') : (item.actual_value ?? '—'))}${item.manual_score != null ? `<small class="kpi-manual-score-result">Điểm: ${item.manual_score}/${KPI_MAX[item.criterion_code] || 0}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`, own && ['DRAFT', 'RETURNED', 'APPROVED'].includes(plan.status) ? '<button class="btn-primary" id="send-kpi">Cập nhật & gửi duyệt lại</button>' : '');
    document.getElementById('modal-overlay').classList.add('modal-overlay--desktop-centered');
    document.getElementById('modal').classList.add('modal--kpi-detail', 'modal--scroll-fixed');
    const canReview = hr(me) && plan.status === 'SUBMITTED';
    bindEvidenceEditors(document.getElementById('modal-body'));
    const detailRows = document.querySelectorAll('#modal-body tbody tr');
    detailRows.forEach((row, index) => {
      const item = items[index];
      if (canReview) row.children[2].insertAdjacentHTML('beforeend', `<label class="kpi-item-review-note"><span>Yêu cầu chỉnh sửa mục này</span><textarea data-id="${item.id}" placeholder="Ghi rõ phần cần nhân viên cập nhật..."></textarea></label>`);
      if (String(item.unit || '').toLowerCase() !== 'text') return;
      row.children[3].innerHTML = '<span class="employee-kpi-manual">HCNS chấm điểm</span>';
      const max = KPI_MAX[item.criterion_code] || 0;
      row.children[4].innerHTML = `<div class="employee-kpi-text-result">${esc(item.actual_text || '—')}</div>${canReview ? `<label class="kpi-manual-score">Điểm HCNS (tối đa ${max})<input class="kpi-manual-score-input" data-id="${item.id}" type="number" min="0" max="${max}" step="0.01" value="${item.manual_score ?? ''}"></label>` : (item.manual_score != null ? `<small class="kpi-manual-score-result">HCNS chấm: ${item.manual_score}/${max} điểm</small>` : '')}`;
    });
    if (hr(me)) {
      const footer = document.getElementById('modal-footer');
      if (plan.status === 'APPROVED') footer.insertAdjacentHTML('beforeend', '<button class="btn-secondary" id="kpi-print">In phiếu kết quả KPI</button>');
      if (me.role === 'admin') footer.insertAdjacentHTML('beforeend', '<button class="btn-secondary" id="kpi-audit">Lịch sử link</button>');
      footer.insertAdjacentHTML('beforeend', '<button class="btn-secondary" id="kpi-save-evidence">Lưu link bằng chứng</button>');
      document.getElementById('kpi-save-evidence').onclick = async () => {
        try {
          for (const item of items) await api.saveKpiEvidence(plan.id, item.id, readEvidence(document.getElementById('modal-body'), item.id));
          toast('Đã lưu link bằng chứng. Nhân viên cần xác nhận lại nếu KPI đã gửi/duyệt.', 'success'); closeModal(); refresh();
        } catch (error) { toast(error.message, 'error'); }
      };
      document.getElementById('kpi-print')?.addEventListener('click', () => printKpiSnapshot(plan.id));
      document.getElementById('kpi-audit')?.addEventListener('click', () => showKpiEvidenceAudit(plan.id));
    }
    if (canReview) {
      const footer = document.getElementById('modal-footer');
      footer.innerHTML = '<button class="btn-secondary" id="kpi-return">Yêu cầu chỉnh sửa</button><button class="btn-primary" id="kpi-approve">Duyệt KPI</button>';
      document.getElementById('kpi-approve').onclick = async () => {
        const button = document.getElementById('kpi-approve'); button.disabled = true;
        try {
          const manualScores = Object.fromEntries([...document.querySelectorAll('.kpi-manual-score-input')].map(input => [input.dataset.id, input.value]));
          await api.reviewKpis(plan.id, true, '', manualScores); toast('Đã duyệt KPI', 'success'); closeModal(); refresh();
        }
        catch (error) { toast(`Không thể duyệt KPI: ${error.message}`, 'error'); button.disabled = false; }
      };
      document.getElementById('kpi-return').onclick = async () => {
        const button = document.getElementById('kpi-return'); button.disabled = true;
        try {
          const itemNotes = Object.fromEntries([...document.querySelectorAll('.kpi-item-review-note textarea')].filter(input => input.value.trim()).map(input => [input.dataset.id, input.value.trim()]));
          await api.reviewKpis(plan.id, false, '', {}, itemNotes); toast('Đã trả KPI để nhân viên chỉnh sửa', 'success'); closeModal(); refresh();
        }
        catch (error) { toast(`Không thể trả KPI: ${error.message}`, 'error'); button.disabled = false; }
      };
    }
    document.querySelector('#send-kpi')?.addEventListener('click', async () => { try { await api.submitKpis(plan.id, items.map(item => ({ id: item.id, actual_value: document.querySelector(`.actual[data-id="${item.id}"]`).value }))); closeModal(); refresh(); } catch (error) { toast(error.message, 'error'); } });
  } catch (error) { toast(error.message, 'error'); }
}

async function editor(me, refresh, presetId = '', presetMonth = now().month, presetYear = now().year) {
  let users = [], templates = [];
  try { [users, templates] = await Promise.all([api.getUsersBasic().then(r => r.users || []), api.getKpiTemplates().then(r => r.templates || [])]); }
  catch (error) { toast(error.message, 'error'); return; }
  const depts = [...new Set(users.map(user => user.department).filter(Boolean))];
  const selectedEmployee = presetId ? users.find(user => +user.id === +presetId) : null;
  const isSingleEmployee = Boolean(selectedEmployee);
  const row = (code, title, custom = false, description = '', unit = '%', requiresEvidence = false) => `<tr data-custom="${custom ? 1 : 0}"><td><strong>${code}</strong>${KPI_MAX[code] ? ` <small class="kpi-max-score">(tối đa ${KPI_MAX[code]}đ)</small>` : ''}<input class="code" type="hidden" value="${code}"></td><td><input class="title" value="${esc(title)}"></td><td><select class="unit"><option value="number" ${unit === 'number' ? 'selected' : ''}>Số</option><option value="%" ${unit === '%' ? 'selected' : ''}>%</option><option value="text" ${unit === 'text' ? 'selected' : ''}>Văn bản</option></select></td><td><input class="target" type="number" min="0" value="${unit === 'text' ? 0 : 100}"></td><input class="weight" type="hidden" value="${custom ? 0 : 100}"><td><input class="desc" type="hidden" value="${esc(description)}"><button type="button" class="kpi-description-btn">${description ? 'Chỉnh sửa mô tả' : 'Soạn mô tả'}</button></td><td><label class="kpi-evidence-switch"><input class="requires-evidence" type="checkbox" ${requiresEvidence ? 'checked' : ''}> Yêu cầu link</label></td><td>${custom ? '<button class="btn-secondary btn-sm remove-row">Xóa</button>' : ''}</td></tr>`;
  openModal('Tạo KPI tháng', `${isSingleEmployee ? `<div class="kpi-selected-employee"><span>Nhân viên</span><strong>${esc(selectedEmployee.full_name)}</strong><small>${esc(selectedEmployee.employee_code || '')}${selectedEmployee.department ? ` · ${esc(selectedEmployee.department)}` : ''}</small></div>` : `<div class="kpi-picker"><div class="field"><label>Tìm nhân viên</label><input id="user-search" placeholder="Tên hoặc mã nhân viên"></div><div class="field"><label>Phòng ban</label><select id="dept-filter"><option value="">Tất cả phòng ban</option>${depts.map(dept => `<option>${esc(dept)}</option>`).join('')}</select></div><div class="field"><label>Template</label><select id="template-select"><option value="">Tạo mới thủ công</option>${templates.map(template => `<option value="${template.id}">${esc(template.name)}</option>`).join('')}</select></div></div><label class="kpi-select-all"><input id="select-all" type="checkbox"> Chọn tất cả kết quả lọc <span id="selected-count">0 người</span></label><div id="user-pick-list" class="kpi-user-list"></div><div id="user-pagination" class="kpi-user-pagination"></div>`}${isSingleEmployee ? `<div class="kpi-template-single field"><label>Template</label><select id="template-select"><option value="">Tạo mới thủ công</option>${templates.map(template => `<option value="${template.id}">${esc(template.name)}</option>`).join('')}</select></div>` : ''}<div class="kpi-period-picker"><div class="field"><label>Tháng</label><input id="form-month" type="number" min="1" max="12" value="${presetMonth}"></div><div class="field"><label>Năm</label><input id="form-year" type="number" min="2020" value="${presetYear}"></div></div><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Chỉ tiêu</th><th>Đơn vị</th><th>Mục tiêu</th><th>Mô tả</th><th>Bằng chứng</th><th></th></tr></thead><tbody id="rows">${SCORED.map(item => row(...item)).join('')}</tbody></table></div>`, '<button class="btn-secondary" id="add-custom">+ Thêm chỉ tiêu</button><button class="btn-secondary" id="save-template">Lưu template</button><button class="btn-primary" id="save-kpi">Áp dụng KPI</button>');
  document.getElementById('modal-overlay').classList.add('modal-overlay--desktop-centered');
  document.getElementById('modal').classList.add('modal--kpi-editor', 'modal--scroll-fixed');
  const selected = new Set(presetId ? [+presetId] : []);
  if (!isSingleEmployee) {
  const list = document.querySelector('#user-pick-list'), pager = document.querySelector('#user-pagination');
  const pageSize = 10; let page = 1;
  const filteredUsers = () => {
    const query = document.querySelector('#user-search').value.trim().toLowerCase(), dept = document.querySelector('#dept-filter').value;
    return users.filter(user => (!dept || user.department === dept) && (`${user.full_name} ${user.employee_code || ''}`).toLowerCase().includes(query));
  };
  const count = () => { document.querySelector('#selected-count').textContent = `${selected.size} người`; };
  function renderUsers() {
    const visible = filteredUsers(), pages = Math.max(1, Math.ceil(visible.length / pageSize)); page = Math.min(page, pages);
    const pageUsers = visible.slice((page - 1) * pageSize, page * pageSize);
    list.innerHTML = pageUsers.map(user => `<label class="kpi-user-option"><input class="pick-user" type="checkbox" value="${user.id}" ${selected.has(+user.id) ? 'checked' : ''}><span class="kpi-user-info"><strong>${esc(user.full_name)}</strong><small>${esc(user.department || 'Chưa có phòng ban')}</small></span></label>`).join('') || '<div class="muted">Không tìm thấy nhân viên</div>';
    const selectAll = document.querySelector('#select-all'); selectAll.checked = visible.length > 0 && visible.every(user => selected.has(+user.id)); selectAll.indeterminate = !selectAll.checked && visible.some(user => selected.has(+user.id));
    pager.innerHTML = visible.length > pageSize ? `<button class="btn-secondary btn-sm kpi-page" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>← Trước</button><span>${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, visible.length)} / ${visible.length}</span><button class="btn-secondary btn-sm kpi-page" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Sau →</button>` : (visible.length ? `<span>Hiển thị ${visible.length} người</span>` : '');
    list.querySelectorAll('.pick-user').forEach(input => input.onchange = () => { input.checked ? selected.add(+input.value) : selected.delete(+input.value); count(); renderUsers(); });
    pager.querySelectorAll('.kpi-page').forEach(button => button.onclick = () => { page = +button.dataset.page; renderUsers(); });
  }
  document.querySelector('#user-search').oninput = () => { page = 1; renderUsers(); };
  document.querySelector('#dept-filter').onchange = () => { page = 1; renderUsers(); };
  document.querySelector('#select-all').onchange = event => { filteredUsers().forEach(user => event.target.checked ? selected.add(+user.id) : selected.delete(+user.id)); count(); renderUsers(); };
  renderUsers(); count();
  }

  function bindDescriptionEditors() {
    document.querySelectorAll('.kpi-description-btn').forEach(button => button.onclick = () => {
      const ownerRow = button.closest('tr');
      document.querySelectorAll('.kpi-description-editor-row').forEach(row => { if (row.previousElementSibling !== ownerRow) row.remove(); });
      const existing = ownerRow.nextElementSibling;
      if (existing?.classList.contains('kpi-description-editor-row')) { existing.remove(); return; }
      const description = ownerRow.querySelector('.desc');
      ownerRow.insertAdjacentHTML('afterend', `<tr class="kpi-description-editor-row"><td colspan="7"><div class="kpi-rich-editor"><div class="kpi-rich-toolbar" role="toolbar" aria-label="Định dạng mô tả"><button type="button" data-command="bold" title="In đậm"><strong>B</strong></button><button type="button" data-command="italic" title="In nghiêng"><em>I</em></button><button type="button" data-command="underline" title="Gạch chân"><u>U</u></button><button type="button" data-command="strikeThrough" title="Gạch ngang"><s>S</s></button><span></span><button type="button" data-command="insertUnorderedList" title="Danh sách dấu chấm">•</button><button type="button" data-command="insertOrderedList" title="Danh sách đánh số">1.</button><button type="button" data-command="formatBlock" data-value="blockquote" title="Trích dẫn">“</button><span></span><button type="button" data-command="createLink" title="Chèn liên kết">🔗</button><button type="button" data-command="removeFormat" title="Xóa định dạng">Tx</button></div><div class="kpi-rich-content" contenteditable="true" data-placeholder="Nhập mô tả, checklist, ghi chú hoặc yêu cầu công việc..."></div></div></td></tr>`);
      const editorRow = ownerRow.nextElementSibling, content = editorRow.querySelector('.kpi-rich-content');
      content.innerHTML = description.value;
      const update = () => { description.value = content.innerHTML.trim(); button.textContent = content.textContent.trim() ? 'Chỉnh sửa mô tả' : 'Soạn mô tả'; };
      content.addEventListener('input', update);
      editorRow.querySelectorAll('[data-command]').forEach(tool => tool.onclick = () => {
        content.focus(); const command = tool.dataset.command;
        if (command === 'createLink') { const url = prompt('Dán liên kết:'); if (!url || !/^https?:\/\//i.test(url)) return; document.execCommand(command, false, url); }
        else if (command === 'formatBlock') document.execCommand(command, false, tool.dataset.value);
        else document.execCommand(command, false, null);
        update();
      });
      content.focus();
    });
  }
  function bindUnitControls() {
    document.querySelectorAll('#rows tr').forEach(item => {
      const unit = item.querySelector('.unit'), target = item.querySelector('.target');
      const sync = () => { const isText = unit.value === 'text'; target.disabled = isText; target.value = isText ? 0 : (target.value || 100); target.placeholder = isText ? 'HCNS chấm điểm' : ''; };
      unit.onchange = sync; sync();
    });
  }
  bindDescriptionEditors();
  bindUnitControls();

  const items = () => [...document.querySelectorAll('#rows tr:not(.kpi-description-editor-row)')].map(item => ({ criterion_code: item.querySelector('.code').value, title: item.querySelector('.title').value, unit: item.querySelector('.unit').value, target_value: item.querySelector('.target').value, weight_percent: item.querySelector('.weight').value, description: item.querySelector('.desc').value, requires_evidence: item.querySelector('.requires-evidence').checked ? 1 : 0, affects_group1: item.dataset.custom === '1' ? 0 : 1 }));
  document.querySelector('#add-custom').onclick = () => { const nums = [...document.querySelectorAll('.code')].map(input => +(input.value.match(/^HS(\d+)$/) || [, 0])[1]); const code = 'HS' + String(Math.max(...nums) + 1).padStart(2, '0'); document.querySelector('#rows').insertAdjacentHTML('beforeend', row(code, 'Chỉ tiêu theo dõi', true)); document.querySelectorAll('.remove-row').forEach(button => button.onclick = () => button.closest('tr').remove()); bindDescriptionEditors(); bindUnitControls(); };
  document.querySelector('#template-select').onchange = () => { const template = templates.find(item => item.id === +document.querySelector('#template-select').value); if (template) { document.querySelector('#rows').innerHTML = template.items.map(item => row(item.criterion_code, item.title, !item.affects_group1, item.description || '', item.unit || '%', !!item.requires_evidence)).join(''); bindDescriptionEditors(); bindUnitControls(); } };
  document.querySelector('#save-template').onclick = async () => { const name = prompt('Tên template KPI:'); if (!name) return; try { await api.saveKpiTemplate({ name, items: items() }); toast('Đã lưu template', 'success'); } catch (error) { toast(error.message, 'error'); } };
  document.querySelector('#save-kpi').onclick = async () => { if (!selected.size) return toast('Hãy chọn ít nhất một nhân viên', 'error'); try { const templateId = +document.querySelector('#template-select').value, period = { month: +document.querySelector('#form-month').value, year: +document.querySelector('#form-year').value }; if (templateId) { const result = await api.applyKpiTemplate(templateId, { employee_ids: [...selected], ...period }); toast(`Đã tạo ${result.created.length} KPI, bỏ qua ${result.skipped.length}`, 'success'); } else { for (const employee_id of selected) await api.saveKpis({ employee_id, ...period, items: items() }); toast('Đã áp dụng KPI', 'success'); } closeModal(); refresh(); } catch (error) { toast(error.message, 'error'); } };
}
