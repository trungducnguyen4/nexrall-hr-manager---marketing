/**
 * KPI & Performance Evaluations Controller
 * HTTP Endpoints for KPI Templates, Employee KPI Plans, Evidence Audit,
 * Performance Evaluations, Periods, and Leadership Reports & Dashboards
 */
import { json, err } from '../lib/response.js';
import { nowStr, vnDateTimeStr } from '../lib/time.js';
import { safeDownloadName, normalizeVietnameseSearch } from '../lib/string.js';
import {
  evalTotal,
  evalValidatePartial,
  evalValidateComplete,
  validateKpiItems,
  attachKpiEvidence,
  replaceKpiEvidence,
  kpiItemScore,
  group1Total,
  createEvaluationKpiSnapshot,
  groupScores,
  ratingFor,
  safeParseJSON,
  todayStr,
  isBgd,
} from '../services/evaluations.service.js';

export async function handleEvaluationRoutes(request, env, me, path, url, options = {}) {
  const {
    isManager = false,
    isAdmin = false,
    isHcns = () => false,
    broadcastAppEvent = async () => {},
  } = options;

  if (path === '/api/kpi-templates' && request.method === 'GET') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const { results: templates = [] } = await env.DB.prepare('SELECT * FROM kpi_templates ORDER BY id DESC').all();
    for (const t of templates) t.items = (await env.DB.prepare('SELECT * FROM kpi_template_items WHERE template_id=? ORDER BY id').bind(t.id).all()).results || [];
    return json({ templates });
  }

  if (path === '/api/kpi-templates' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({})); const items = b.items || [];
    const error = !String(b.name || '').trim() ? 'Cần nhập tên template' : validateKpiItems(items);
    if (error) return json({ error }, 400);
    const r = await env.DB.prepare('INSERT INTO kpi_templates (name,description,created_by,created_by_name) VALUES (?,?,?,?)').bind(String(b.name).trim(), String(b.description || '').trim(), me.id, me.full_name).run();
    for (const item of items) await env.DB.prepare('INSERT INTO kpi_template_items (template_id,criterion_code,title,description,unit,target_value,weight_percent,affects_group1,requires_evidence) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.meta.last_row_id, item.criterion_code, String(item.title).trim(), String(item.description || '').trim(), String(item.unit || 'đơn vị').trim(), Number(item.target_value), Number(item.weight_percent || 0), Number(item.affects_group1) === 0 ? 0 : 1, Number(item.requires_evidence) ? 1 : 0).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const templateApplyMatch = path.match(/^\/api\/kpi-templates\/(\d+)\/apply$/);
  if (templateApplyMatch && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({})); const templateId = parseInt(templateApplyMatch[1]); const employeeIds = [...new Set((b.employee_ids || []).map(Number).filter(Boolean))];
    const month = parseInt(b.month), year = parseInt(b.year);
    if (!employeeIds.length || !month || !year) return json({ error: 'Cần chọn nhân viên và kỳ KPI' }, 400);
    const { results: items = [] } = await env.DB.prepare('SELECT * FROM kpi_template_items WHERE template_id=? ORDER BY id').bind(templateId).all();
    const error = validateKpiItems(items); if (error) return json({ error }, 400);
    const created = [], skipped = [];
    for (const employeeId of employeeIds) {
      const employee = await env.DB.prepare('SELECT id,full_name FROM users WHERE id=? AND is_active=1').bind(employeeId).first(); if (!employee) { skipped.push({ employee_id: employeeId, reason: 'Không hợp lệ' }); continue; }
      const existing = await env.DB.prepare('SELECT status FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=?').bind(employeeId, month, year).first();
      if (existing) { skipped.push({ employee_id: employeeId, name: employee.full_name, reason: 'Đã có KPI ' + existing.status }); continue; }
      const plan = await env.DB.prepare('INSERT INTO employee_kpi_plans (employee_id,month,year,status,created_by,created_by_name) VALUES (?,?,?,?,?,?)').bind(employeeId, month, year, 'DRAFT', me.id, me.full_name).run();
      for (const item of items) await env.DB.prepare('INSERT INTO employee_kpi_items (plan_id,criterion_code,title,description,unit,target_value,weight_percent,affects_group1,requires_evidence) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(plan.meta.last_row_id, item.criterion_code, item.title, item.description, item.unit, item.target_value, item.weight_percent, item.affects_group1, Number(item.requires_evidence) ? 1 : 0).run();
      created.push({ employee_id: employeeId, name: employee.full_name });
    }
    return json({ ok: true, created, skipped });
  }

  // ── KPI NHÂN VIÊN ───────────────────────────────────────────────────
  if (path === '/api/kpis/dashboard' && request.method === 'GET') {
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
    const canViewAll = isHcns(me) || isBgd(me);
    const rowsSql = canViewAll
      ? `SELECT u.id employee_id,u.full_name,u.department,u.position,p.id plan_id,p.status
         FROM users u LEFT JOIN employee_kpi_plans p ON p.employee_id=u.id AND p.month=? AND p.year=? WHERE u.is_active=1 ORDER BY u.full_name`
      : `SELECT u.id employee_id,u.full_name,u.department,u.position,p.id plan_id,p.status
         FROM users u LEFT JOIN employee_kpi_plans p ON p.employee_id=u.id AND p.month=? AND p.year=? WHERE u.id=?`;
    const { results = [] } = await env.DB.prepare(rowsSql).bind(...(canViewAll ? [month, year] : [month, year, me.id])).all();
    for (const row of results) {
      row.group1_score = null;
      row.item_count = 0;
      if (row.plan_id) {
        const itemCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM employee_kpi_items WHERE plan_id=?').bind(row.plan_id).first();
        row.item_count = Number(itemCount?.count || 0);
      }
      if (row.plan_id && row.status === 'APPROVED') {
        const { results: items = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=?').bind(row.plan_id).all();
        if (items.length) row.group1_score = group1Total(items);
      }
    }
    return json({ month, year, kpis: results });
  }
  if (path === '/api/kpis' && request.method === 'GET') {
    const employeeId = parseInt(url.searchParams.get('employee_id') || String(me.id));
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
    if (employeeId !== me.id && !isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=?').bind(employeeId, month, year).first();
    const items = plan ? (await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=? ORDER BY criterion_code,id').bind(plan.id).all()).results : [];
    await attachKpiEvidence(env, items);
    if (plan?.status === 'APPROVED') plan.group1_total = group1Total(items);
    return json({ plan: plan || null, items: items || [] });
  }
  if (path === '/api/kpis' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS được cấu hình KPI' }, 403);
    const b = await request.json().catch(() => ({})); const employeeId = parseInt(b.employee_id), month = parseInt(b.month), year = parseInt(b.year), items = b.items || [];
    const error = !employeeId || !month || !year ? 'Thiếu nhân viên hoặc kỳ KPI' : validateKpiItems(items);
    if (error) return json({ error }, 400);
    let plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=?').bind(employeeId, month, year).first();
    if (plan && ['SUBMITTED','APPROVED'].includes(plan.status)) return json({ error: 'KPI đã gửi/duyệt, không thể sửa trực tiếp' }, 400);
    if (!plan) { const r = await env.DB.prepare('INSERT INTO employee_kpi_plans (employee_id,month,year,status,created_by,created_by_name) VALUES (?,?,?,?,?,?)').bind(employeeId, month, year, 'DRAFT', me.id, me.full_name).run(); plan = { id: r.meta.last_row_id }; }
    await env.DB.prepare('DELETE FROM employee_kpi_items WHERE plan_id=?').bind(plan.id).run();
    for (const item of items) await env.DB.prepare('INSERT INTO employee_kpi_items (plan_id,criterion_code,title,description,unit,target_value,weight_percent,affects_group1,requires_evidence) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(plan.id, item.criterion_code, String(item.title).trim(), String(item.description || '').trim(), String(item.unit || 'đơn vị').trim(), Number(item.target_value), Number(item.weight_percent || 0), Number(item.affects_group1) === 0 ? 0 : 1, Number(item.requires_evidence) ? 1 : 0).run();
    return json({ ok: true, id: plan.id });
  }
  const kpiEvidenceMatch = path.match(/^\/api\/kpis\/(\d+)\/evidence$/);
  if (kpiEvidenceMatch && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được cập nhật link bằng chứng' }, 403);
    const planId = parseInt(kpiEvidenceMatch[1]), b = await request.json().catch(() => ({}));
    const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE id=?').bind(planId).first();
    if (!plan) return json({ error: 'Không tìm thấy KPI' }, 404);
    const item = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE id=? AND plan_id=?').bind(parseInt(b.item_id), planId).first();
    if (!item) return json({ error: 'Không tìm thấy chỉ tiêu KPI' }, 404);
    const changed = await replaceKpiEvidence(env, plan, item, b.evidence || [], me, 'hr_replace');
    if (changed && ['SUBMITTED','APPROVED'].includes(plan.status)) await env.DB.prepare("UPDATE employee_kpi_plans SET status='RETURNED',reviewed_by=?,reviewed_by_name=?,reviewed_at=datetime('now','localtime'),review_note=?,updated_at=datetime('now','localtime') WHERE id=?")
      .bind(me.id, me.full_name || '', 'HCNS đã cập nhật link bằng chứng, vui lòng xác nhận và gửi lại KPI.', planId).run();
    return json({ ok: true, requires_employee_confirmation: changed && ['SUBMITTED','APPROVED'].includes(plan.status) });
  }
  const kpiSnapshotMatch = path.match(/^\/api\/kpis\/(\d+)\/snapshot$/);
  if (kpiSnapshotMatch && request.method === 'GET') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được in phiếu KPI' }, 403);
    const snapshot = await env.DB.prepare('SELECT * FROM employee_kpi_approval_snapshots_v2 WHERE plan_id=? ORDER BY id DESC LIMIT 1').bind(parseInt(kpiSnapshotMatch[1])).first();
    if (!snapshot) return json({ error: 'KPI chưa được duyệt hoặc chưa có phiếu chốt' }, 404);
    const { results: audit = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_evidence_audit WHERE plan_id=? ORDER BY created_at,id').bind(snapshot.plan_id).all();
    return json({ snapshot: { ...snapshot, payload: JSON.parse(snapshot.snapshot_json) }, audit });
  }
  const kpiActionMatch = path.match(/^\/api\/kpis\/(\d+)\/(submit|review)$/);
  if (kpiActionMatch && request.method === 'POST') {
    const planId = parseInt(kpiActionMatch[1]), action = kpiActionMatch[2], b = await request.json().catch(() => ({}));
    const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE id=?').bind(planId).first();
    if (!plan) return json({ error: 'Không tìm thấy KPI' }, 404);
    if (action === 'submit') {
      if (plan.employee_id !== me.id) return json({ error: 'Không có quyền' }, 403);
      // Nhân viên có thể điều chỉnh KPI đã duyệt. Lần gửi tiếp theo phải được
      // HCNS duyệt lại, do đó trạng thái luôn quay về SUBMITTED bên dưới.
      if (!['DRAFT','RETURNED','APPROVED'].includes(plan.status)) return json({ error: 'KPI không ở trạng thái có thể gửi' }, 400);
      const items = b.items || []; if (!Array.isArray(items) || !items.length) return json({ error: 'Cần nhập kết quả KPI' }, 400);
      for (const item of items) {
        const current = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE id=? AND plan_id=?').bind(parseInt(item.id), planId).first();
        if (!current) return json({ error: 'Có chỉ tiêu KPI không hợp lệ' }, 400);
        const isText = String(current?.unit || '').toLowerCase() === 'text';
        await env.DB.prepare('UPDATE employee_kpi_items SET actual_value=?,actual_text=?, evidence_url=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=? AND plan_id=?')
          .bind(isText ? null : Number(item.actual_value), isText ? String(item.actual_text || '').trim() : null, String(item.evidence_url || '').trim(), parseInt(item.id), planId).run();
        await replaceKpiEvidence(env, plan, current, item.evidence || [], me, 'employee_submit');
      }
      const { results = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=?').bind(planId).all();
      if (results.some(i => String(i.unit).toLowerCase() === 'text' ? !String(i.actual_text || '').trim() : i.actual_value === null)) return json({ error: 'Cần nhập kết quả cho toàn bộ KPI' }, 400);
      for (const item of results.filter(i => Number(i.requires_evidence))) {
        const count = await env.DB.prepare('SELECT COUNT(*) count FROM employee_kpi_evidence WHERE kpi_item_id=?').bind(item.id).first();
        if (!Number(count?.count || 0)) return json({ error: `Chỉ tiêu “${item.title}” cần ít nhất một link bằng chứng` }, 400);
      }
      await env.DB.prepare('UPDATE employee_kpi_plans SET status=?,submitted_at=datetime(\'now\',\'localtime\'),updated_at=datetime(\'now\',\'localtime\') WHERE id=?').bind('SUBMITTED', planId).run();
    } else {
      if (!isHcns(me)) return json({ error: 'Chỉ HCNS được duyệt KPI' }, 403);
      if (b.approve) {
        const { results: textItems = [] } = await env.DB.prepare("SELECT id,criterion_code FROM employee_kpi_items WHERE plan_id=? AND lower(unit)='text'").bind(planId).all();
        const manualScores = b.manual_scores || {};
        for (const item of textItems) {
          const score = Number(manualScores[item.id]);
          if (!Number.isFinite(score) || score < 0 || score > KPI_GROUP1_MAX[item.criterion_code]) return json({ error: `Điểm HCNS cho ${item.criterion_code} phải từ 0 đến ${KPI_GROUP1_MAX[item.criterion_code]}` }, 400);
          await env.DB.prepare('UPDATE employee_kpi_items SET manual_score=? WHERE id=? AND plan_id=?').bind(score, item.id, planId).run();
        }
        await env.DB.prepare('UPDATE employee_kpi_items SET review_note=NULL WHERE plan_id=?').bind(planId).run();
        const { results: approvedItems = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=? ORDER BY criterion_code,id').bind(planId).all();
        await attachKpiEvidence(env, approvedItems);
        const employee = await env.DB.prepare('SELECT id,full_name,employee_code,department,position FROM users WHERE id=?').bind(plan.employee_id).first();
        const payload = { plan: { ...plan, status: 'APPROVED', reviewed_by: me.id, reviewed_by_name: me.full_name, approved_at: new Date().toISOString() }, employee, items: approvedItems, group1_total: group1Total(approvedItems) };
        await env.DB.prepare('INSERT INTO employee_kpi_approval_snapshots_v2 (plan_id,employee_id,month,year,snapshot_json,approved_by,approved_by_name,approved_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\',\'localtime\'))')
          .bind(planId, plan.employee_id, plan.month, plan.year, JSON.stringify(payload), me.id, me.full_name || '').run();
      } else {
        const itemNotes = b.item_notes || {};
        const notes = Object.entries(itemNotes).filter(([, note]) => String(note || '').trim());
        if (!notes.length && !String(b.note || '').trim()) return json({ error: 'Hãy ghi yêu cầu chỉnh sửa cho ít nhất một tiêu chí hoặc ghi chú chung' }, 400);
        await env.DB.prepare('UPDATE employee_kpi_items SET review_note=NULL WHERE plan_id=?').bind(planId).run();
        for (const [itemId, note] of notes) await env.DB.prepare('UPDATE employee_kpi_items SET review_note=? WHERE id=? AND plan_id=?')
          .bind(String(note).trim(), parseInt(itemId), planId).run();
      }
      const status = b.approve ? 'APPROVED' : 'RETURNED';
      await env.DB.prepare('UPDATE employee_kpi_plans SET status=?,reviewed_by=?,reviewed_by_name=?,reviewed_at=datetime(\'now\',\'localtime\'),review_note=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(status, me.id, me.full_name, String(b.note || '').trim(), planId).run();
    }
    return json({ ok: true });
  }

  // ── ĐÁNH GIÁ HIỆU SUẤT (Performance Evaluation) — TTS workflow ─────
  if (path === '/api/eval-periods' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM eval_periods ORDER BY year DESC, month DESC').all();
    return json({ periods: results });
  }
  if (path === '/api/eval-periods' && request.method === 'POST') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = parseInt(b.month), year = parseInt(b.year);
    if (!month || month < 1 || month > 12 || !year) return json({ error: 'Tháng/năm kỳ đánh giá không hợp lệ' }, 400);

    // Fixed monthly cycle: from the 28th of the preceding month through the
    // 3rd of the following month. Derive dates here to keep all new periods
    // consistent; previously saved periods are preserved as-is.
    const pad = (value) => String(value).padStart(2, '0');
    const startMonth = month === 1 ? 12 : month - 1;
    const startYear = month === 1 ? year - 1 : year;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const start = `${startYear}-${pad(startMonth)}-28`;
    const end = `${endYear}-${pad(endMonth)}-03`;
    try {
      const r = await env.DB.prepare(
        'INSERT INTO eval_periods (month,year,start_date,end_date,created_by,created_by_name) VALUES (?,?,?,?,?,?)'
      ).bind(month, year, start, end, me.id, me.full_name).run();
      return json({ ok: true, id: r.meta.last_row_id });
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) return json({ error: 'Kỳ đánh giá tháng này đã tồn tại' }, 400);
      throw e;
    }
  }

  // ── REPORT: Bảng tổng hợp điểm hiệu suất (HCNS/BGD) ──
  if (path === '/api/evaluations/report' && request.method === 'GET') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const periodId = parseInt(url.searchParams.get('period_id') || '0');
    if (!periodId) {
      const latest = await env.DB.prepare('SELECT id FROM eval_periods ORDER BY year DESC, month DESC LIMIT 1').first();
      if (!latest) return json({ report: [], periods: [] });
      return json({ report: [], periods: [] }); // no period = empty report, UI shows "Chưa có kỳ đánh giá"
    }
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);

    const { results: activeUsers } = await env.DB.prepare(
      "SELECT id, employee_code, full_name, department, position, lifecycle_status, employee_type FROM users WHERE is_active=1 ORDER BY full_name"
    ).all();

    const { results: evals } = await env.DB.prepare(
      `SELECT e.*, p.month AS period_month, p.year AS period_year
         FROM evaluations e JOIN eval_periods p ON e.period_id=p.id
        WHERE e.period_id=?`
    ).bind(periodId).all();
    const evalByUser = new Map(evals.map(e => [Number(e.user_id), e]));

    // N1: HS01-HS06 (max 60), N2: VH01-VH04 (max 25), N3: SK01-SK04 (max 15)
    const N1_CODES = new Set(['HS01','HS02','HS03','HS04','HS05','HS06']);
    const N2_CODES = new Set(['VH01','VH02','VH03','VH04']);
    const N3_CODES = new Set(['SK01','SK02','SK03','SK04']);

    function groupScores(evaluation) {
      const ms = safeParseJSON(evaluation?.mentor_scores) || {};
      const ds = safeParseJSON(evaluation?.department_scores) || {};
      const merged = {};
      for (const code of [...N1_CODES, ...N2_CODES, ...N3_CODES]) {
        if (ds[code] !== undefined && ds[code] !== null && ds[code] !== '') merged[code] = Number(ds[code]);
        else if (ms[code] !== undefined && ms[code] !== null && ms[code] !== '') merged[code] = Number(ms[code]);
        else merged[code] = 0;
      }
      const sum = (set) => [...set].reduce((s, c) => s + (merged[c] || 0), 0);
      return { n1: sum(N1_CODES), n2: sum(N2_CODES), n3: sum(N3_CODES), total: sum(N1_CODES) + sum(N2_CODES) + sum(N3_CODES) };
    }

    function ratingFor(total) {
      if (total >= 90) return { label: 'Xuất sắc', cls: 'badge-success', action: 'Xét thưởng, ghi nhận và ưu tiên phát triển' };
      if (total >= 80) return { label: 'Tốt', cls: 'badge-info', action: 'Duy trì và giao mục tiêu cao hơn' };
      if (total >= 65) return { label: 'Đạt', cls: 'badge-gray', action: 'Đáp ứng yêu cầu, tiếp tục theo dõi' };
      if (total >= 50) return { label: 'Dưới chuẩn', cls: 'badge-warning', action: 'Lập kế hoạch cải thiện, đào tạo và đánh giá lại' };
      return { label: 'Yếu', cls: 'badge-danger', action: 'Cảnh báo hiệu suất, đánh giá lại sau thời hạn cải thiện; xem xét điều chuyển hoặc xử lý hợp đồng theo quy định' };
    }

    // Get previous period for comparison
    let prevEvalByUser = new Map();
    if (period.month && period.year) {
      const prevDate = new Date(period.year, period.month - 2, 1);
      const prevMonth = prevDate.getMonth() + 1, prevYear = prevDate.getFullYear();
      const prevPeriod = await env.DB.prepare(
        'SELECT id FROM eval_periods WHERE month=? AND year=?'
      ).bind(prevMonth, prevYear).first();
      if (prevPeriod) {
        const { results: prevEvals } = await env.DB.prepare(
          'SELECT * FROM evaluations WHERE period_id=?'
        ).bind(prevPeriod.id).all();
        for (const pe of prevEvals) prevEvalByUser.set(Number(pe.user_id), pe);
      }
    }

    const report = activeUsers.map(u => {
      const ev = evalByUser.get(Number(u.id));
      const scores = groupScores(ev || null);
      const finalScore = ev?.final_approved_score != null ? Number(ev.final_approved_score) : (ev?.mentor_submitted_at && ev?.department_submitted_at ? scores.total : null);
      const rating = finalScore != null ? ratingFor(finalScore) : null;
      const prevEv = prevEvalByUser.get(Number(u.id));
      const prevScores = groupScores(prevEv || null);
      const prevTotal = prevEv?.final_approved_score != null ? Number(prevEv.final_approved_score) : (prevEv?.mentor_submitted_at && prevEv?.department_submitted_at ? prevScores.total : null);
      return {
        user_id: u.id,
        employee_code: u.employee_code,
        full_name: u.full_name,
        department: u.department,
        position: u.position,
        lifecycle_status: u.lifecycle_status,
        employee_type: u.employee_type,
        has_evaluation: !!ev,
        evaluation_id: ev?.id || null,
        status: ev?.status || null,
        mentor_name: ev?.mentor_name || null,
        department_head_name: ev?.department_head_name || null,
        n1: ev ? scores.n1 : 0,
        n2: ev ? scores.n2 : 0,
        n3: ev ? scores.n3 : 0,
        total: finalScore,
        prev_total: prevTotal,
        rating_label: rating?.label || 'Chưa đánh giá',
        rating_cls: rating?.cls || 'badge-gray',
        action: rating?.action || 'Chưa có đánh giá',
      };
    });

    report.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.full_name.localeCompare(b.full_name));

    const { results: periods } = await env.DB.prepare('SELECT * FROM eval_periods ORDER BY year DESC, month DESC').all();
    return json({ report, periods, selectedPeriod: period });
  }

  // ── DASHBOARD: Báo cáo hiệu suất nhân sự (BGD/HCNS) ──
  if (path === '/api/evaluations/dashboard' && request.method === 'GET') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const periodId = parseInt(url.searchParams.get('period_id') || '0');
    if (!periodId) {
      const latest = await env.DB.prepare('SELECT id FROM eval_periods ORDER BY year DESC, month DESC LIMIT 1').first();
      if (!latest) return json({ dashboard: { total_employees: 0, xuatsac: 0, tot: 0, dat: 0, duoi_chuan: 0, yeu: 0, avg_score: 0, period: null, policy: [] }, periods: [] });
      return json({ dashboard: { total_employees: 0, xuatsac: 0, tot: 0, dat: 0, duoi_chuan: 0, yeu: 0, avg_score: 0, period: null, policy: [] }, periods: [] });
    }
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);

    const { results: activeUsers } = await env.DB.prepare(
      "SELECT id, employee_code, full_name, department FROM users WHERE is_active=1"
    ).all();

    const { results: evals } = await env.DB.prepare(
      'SELECT e.* FROM evaluations e WHERE e.period_id=?'
    ).bind(periodId).all();
    const evalByUser = new Map(evals.map(e => [Number(e.user_id), e]));

    let xuatsac = 0, tot = 0, dat = 0, duoi_chuan = 0, yeu = 0, chua_danh_gia = 0, scoredCount = 0, scoreSum = 0;

    for (const u of activeUsers) {
      const ev = evalByUser.get(Number(u.id));
      const score = ev?.final_approved_score != null ? Number(ev.final_approved_score) : null;
      if (score == null) { chua_danh_gia++; continue; }
      scoredCount++; scoreSum += score;
      if (score >= 90) xuatsac++;
      else if (score >= 80) tot++;
      else if (score >= 65) dat++;
      else if (score >= 50) duoi_chuan++;
      else yeu++;
    }

    const avgScore = scoredCount > 0 ? Math.round(scoreSum / scoredCount) : 0;

    const policy = [
      { grade: 'Xuất sắc', range: '≥ 90 điểm', action: 'Xét thưởng, ghi nhận và ưu tiên phát triển', cls: 'badge-success' },
      { grade: 'Tốt', range: '80–89 điểm', action: 'Duy trì và giao mục tiêu cao hơn', cls: 'badge-info' },
      { grade: 'Đạt', range: '65–79 điểm', action: 'Đáp ứng yêu cầu công việc, tiếp tục theo dõi', cls: 'badge-gray' },
      { grade: 'Dưới chuẩn', range: '50–64 điểm', action: 'Lập kế hoạch cải thiện, đào tạo và đánh giá lại', cls: 'badge-warning' },
      { grade: 'Yếu', range: '< 50 điểm', action: 'Cảnh báo hiệu suất, đánh giá lại sau thời hạn cải thiện; xem xét điều chuyển hoặc xử lý hợp đồng theo quy định', cls: 'badge-danger' },
    ];

    const dashboard = {
      total_employees: activeUsers.length,
      xuatsac, tot, dat, duoi_chuan, yeu, chua_danh_gia,
      avg_score: avgScore,
      period: { month: period.month, year: period.year, start_date: period.start_date, end_date: period.end_date },
      policy,
      hr_note: period.hr_note || '',
      hr_note_by: period.hr_note_by || '',
      hr_note_at: period.hr_note_at || '',
    };

    const { results: periods } = await env.DB.prepare('SELECT * FROM eval_periods ORDER BY year DESC, month DESC').all();
    return json({ dashboard, periods });
  }

  if (path === '/api/evaluations' && request.method === 'GET') {
    const periodId = url.searchParams.get('period_id');
    let q = `SELECT e.*, u.full_name AS user_name, u.employee_code AS user_code, u.department AS user_department, u.position AS user_position, u.lifecycle_status AS user_lifecycle,
                     p.month AS period_month, p.year AS period_year, p.start_date AS period_start, p.end_date AS period_end
              FROM evaluations e LEFT JOIN users u ON e.user_id = u.id LEFT JOIN eval_periods p ON e.period_id = p.id`;
    const params = [];
    const clauses = [];
    if (periodId) { clauses.push('e.period_id=?'); params.push(parseInt(periodId)); }
    if (!isHcns(me) && !isBgd(me)) {
      clauses.push('(e.user_id=? OR e.mentor_id=? OR e.department_head_id=?)');
      params.push(me.id, me.id, me.id);
    }
    if (clauses.length) q += ' WHERE ' + clauses.join(' AND ');
    q += ' ORDER BY e.updated_at DESC';
    const { results } = await env.DB.prepare(q).bind(...params).all();
    return json({ evaluations: results });
  }

  if (path === '/api/evaluations' && request.method === 'POST') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({}));
    const periodId = parseInt(b.period_id), userId = parseInt(b.user_id);
    const mentorId = parseInt(b.mentor_id), deptHeadId = parseInt(b.department_head_id);
    if (!periodId || !userId || !mentorId || !deptHeadId) return json({ error: 'Thiếu thông tin phân công' }, 400);
    if (mentorId === userId || deptHeadId === userId) return json({ error: 'Người đánh giá không thể là chính TTS' }, 400);
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target || !target.is_active) return json({ error: 'Nhân viên không hợp lệ hoặc đã ngừng hoạt động' }, 400);
    const mentor = await env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(mentorId).first();
    const deptHead = await env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(deptHeadId).first();
    const existing = await env.DB.prepare('SELECT * FROM evaluations WHERE period_id=? AND user_id=?').bind(periodId, userId).first();
    if (existing) {
      if (existing.mentor_submitted_at || existing.department_submitted_at) {
        return json({ error: 'Đã có đánh giá đang xử lý, không thể đổi phân công' }, 400);
      }
      await env.DB.prepare('UPDATE evaluations SET mentor_id=?,mentor_name=?,department_head_id=?,department_head_name=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(mentorId, mentor?.full_name || '', deptHeadId, deptHead?.full_name || '', existing.id).run();
      const snapshot = await createEvaluationKpiSnapshot(env, existing.id, userId, period.month, period.year);
      if (snapshot.error) return json({ error: snapshot.error }, 400);
      return json({ ok: true, id: existing.id });
    }
    const r = await env.DB.prepare(
      'INSERT INTO evaluations (period_id,user_id,mentor_id,mentor_name,department_head_id,department_head_name,status) VALUES (?,?,?,?,?,?,?)'
    ).bind(periodId, userId, mentorId, mentor?.full_name || '', deptHeadId, deptHead?.full_name || '', 'MENTOR_REVIEW').run();
    const snapshot = await createEvaluationKpiSnapshot(env, r.meta.last_row_id, userId, period.month, period.year);
    if (snapshot.error) {
      await env.DB.prepare('DELETE FROM evaluations WHERE id=?').bind(r.meta.last_row_id).run();
      return json({ error: snapshot.error }, 400);
    }
    await env.DB.prepare('INSERT INTO evaluation_history (evaluation_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(r.meta.last_row_id, null, 'MENTOR_REVIEW', me.id, me.full_name, 'Phân công Mentor & Trưởng phòng đánh giá').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const evalDetailMatch = path.match(/^\/api\/evaluations\/(\d+)$/);
  if (evalDetailMatch && request.method === 'GET') {
    const evalId = parseInt(evalDetailMatch[1]);
    const ev = await env.DB.prepare(
      `SELECT e.*, u.full_name AS user_name, u.employee_code AS user_code, u.department AS user_department, u.position AS user_position, u.lifecycle_status AS user_lifecycle,
              p.month AS period_month, p.year AS period_year, p.start_date AS period_start, p.end_date AS period_end
       FROM evaluations e LEFT JOIN users u ON e.user_id = u.id LEFT JOIN eval_periods p ON e.period_id = p.id WHERE e.id=?`
    ).bind(evalId).first();
    if (!ev) return json({ error: 'Không tìm thấy phiếu đánh giá' }, 404);
    const allowed = ev.user_id === me.id || ev.mentor_id === me.id || ev.department_head_id === me.id || isHcns(me) || isBgd(me);
    if (!allowed) return json({ error: 'Không có quyền' }, 403);
    try {
      const { results: history } = await env.DB.prepare('SELECT * FROM evaluation_history WHERE evaluation_id=? ORDER BY id ASC').bind(evalId).all();
      const { results: kpi_snapshots } = await env.DB.prepare('SELECT * FROM evaluation_kpi_snapshots WHERE evaluation_id=? ORDER BY criterion_code').bind(evalId).all();
      return json({ evaluation: ev, history, kpi_snapshots });
    } catch (error) {
      console.error('Evaluation detail load failed', { evalId, userId: me.id, message: String(error?.message || error) });
      return json({ error: 'Không thể tải dữ liệu chi tiết của phiếu đánh giá. Vui lòng thử lại sau.', code: 'EVALUATION_DETAIL_LOAD_FAILED' }, 500);
    }
  }

  const evalActionMatch = path.match(/^\/api\/evaluations\/(\d+)\/action$/);
  if (evalActionMatch && request.method === 'POST') {
    const evalId = parseInt(evalActionMatch[1]);
    const ev = await env.DB.prepare('SELECT * FROM evaluations WHERE id=?').bind(evalId).first();
    if (!ev) return json({ error: 'Không tìm thấy phiếu đánh giá' }, 404);
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(ev.period_id).first();
    const b = await request.json().catch(() => ({}));
    const action = String(b.action || '');
    const isMentor = ev.mentor_id === me.id;
    const isDept = ev.department_head_id === me.id;
    const isSelf = ev.user_id === me.id;
    const withinWindow = !!(period && todayStr() >= period.start_date && todayStr() <= period.end_date);
    const canScoreNow = withinWindow || !!ev.window_override;
    const reviewStatuses = ['MENTOR_REVIEW', 'EMPLOYEE_REVISION_REQUESTED', 'CEO_REVISION_REQUESTED'];

    async function applyHistory(toStatus, note) {
      await env.DB.prepare('INSERT INTO evaluation_history (evaluation_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
        .bind(evalId, ev.status, toStatus, me.id, me.full_name, note || null).run();
    }

    if (action === 'mentor_save_draft' || action === 'mentor_submit') {
      if (!isMentor) return json({ error: 'Không có quyền' }, 403);
      if (!reviewStatuses.includes(ev.status)) return json({ error: 'Phiếu không ở trạng thái có thể chấm điểm' }, 400);
      if (!canScoreNow) return json({ error: 'Ngoài thời gian đánh giá của kỳ này' }, 400);
      const scores = b.scores || {}, comments = b.comments || {};
      const err = action === 'mentor_submit' ? evalValidateComplete(scores, comments) : evalValidatePartial(scores, comments);
      if (err) return json({ error: err }, 400);
      const submittedAt = action === 'mentor_submit' ? nowStr() : ev.mentor_submitted_at;
      await env.DB.prepare('UPDATE evaluations SET mentor_scores=?,mentor_comments=?,mentor_submitted_at=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(JSON.stringify(scores), JSON.stringify(comments), submittedAt, evalId).run();
      if (action === 'mentor_submit') {
        if (ev.department_submitted_at) {
          await env.DB.prepare('UPDATE evaluations SET status=? WHERE id=?').bind('EMPLOYEE_CONFIRMATION', evalId).run();
          await applyHistory('EMPLOYEE_CONFIRMATION', 'Mentor & Trưởng phòng đã hoàn tất đánh giá');
        } else {
          await applyHistory(ev.status, 'Mentor đã gửi đánh giá');
        }
      }
      return json({ ok: true });
    }

    if (action === 'dept_save_draft' || action === 'dept_submit') {
      if (!isDept) return json({ error: 'Không có quyền' }, 403);
      if (!reviewStatuses.includes(ev.status)) return json({ error: 'Phiếu không ở trạng thái có thể chấm điểm' }, 400);
      if (!canScoreNow) return json({ error: 'Ngoài thời gian đánh giá của kỳ này' }, 400);
      const scores = b.scores || {}, comments = b.comments || {};
      const err = action === 'dept_submit' ? evalValidateComplete(scores, comments) : evalValidatePartial(scores, comments);
      if (err) return json({ error: err }, 400);
      const submittedAt = action === 'dept_submit' ? nowStr() : ev.department_submitted_at;
      await env.DB.prepare('UPDATE evaluations SET department_scores=?,department_comments=?,department_submitted_at=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(JSON.stringify(scores), JSON.stringify(comments), submittedAt, evalId).run();
      if (action === 'dept_submit') {
        if (ev.mentor_submitted_at) {
          await env.DB.prepare('UPDATE evaluations SET status=? WHERE id=?').bind('EMPLOYEE_CONFIRMATION', evalId).run();
          await applyHistory('EMPLOYEE_CONFIRMATION', 'Mentor & Trưởng phòng đã hoàn tất đánh giá');
        } else {
          await applyHistory(ev.status, 'Trưởng phòng đã gửi đánh giá');
        }
      }
      return json({ ok: true });
    }

    if (action === 'employee_confirm') {
      if (!isSelf) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'EMPLOYEE_CONFIRMATION') return json({ error: 'Phiếu không ở trạng thái chờ xác nhận' }, 400);
      await env.DB.prepare('UPDATE evaluations SET employee_confirmed_at=?,status=? WHERE id=?').bind(nowStr(), 'PENDING_CEO_APPROVAL', evalId).run();
      await applyHistory('PENDING_CEO_APPROVAL', 'TTS đã xác nhận kết quả');
      return json({ ok: true });
    }

    if (action === 'employee_revision') {
      if (!isSelf) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'EMPLOYEE_CONFIRMATION') return json({ error: 'Phiếu không ở trạng thái chờ xác nhận' }, 400);
      const reason = String(b.reason || '').trim();
      if (!reason) return json({ error: 'Vui lòng nhập lý do yêu cầu xem xét lại' }, 400);
      await env.DB.prepare(
        `UPDATE evaluations SET employee_revision_reason=?,employee_revision_evidence=?,employee_revision_at=?,
         status=?,mentor_submitted_at=NULL,department_submitted_at=NULL WHERE id=?`
      ).bind(reason, String(b.evidence || '').trim(), nowStr(), 'EMPLOYEE_REVISION_REQUESTED', evalId).run();
      await applyHistory('EMPLOYEE_REVISION_REQUESTED', reason);
      return json({ ok: true });
    }

    if (action === 'ceo_approve') {
      if (!isBgd(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'PENDING_CEO_APPROVAL') return json({ error: 'Phiếu không ở trạng thái chờ phê duyệt' }, 400);
      const finalScore = Number(b.finalScore);
      if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100) return json({ error: 'Điểm cuối cùng không hợp lệ (0–100)' }, 400);
      const initialScore = b.initialScore !== undefined && b.initialScore !== null ? Number(b.initialScore) : null;
      const adjusted = initialScore !== null && Math.round(initialScore) !== Math.round(finalScore);
      if (adjusted && !String(b.adjustReason || '').trim()) return json({ error: 'Vui lòng nhập lý do điều chỉnh điểm' }, 400);
      await env.DB.prepare(
        `UPDATE evaluations SET final_approved_score=?,final_approved_comment=?,final_score_before_adjust=?,final_adjust_reason=?,
         approved_by=?,approved_by_name=?,approved_at=?,status=? WHERE id=?`
      ).bind(finalScore, String(b.finalComment || '').trim(), adjusted ? initialScore : null, adjusted ? String(b.adjustReason).trim() : null,
             me.id, me.full_name, nowStr(), 'CEO_APPROVED', evalId).run();
      await applyHistory('CEO_APPROVED', adjusted ? `Đã phê duyệt (điều chỉnh điểm: ${initialScore} → ${finalScore})` : 'Đã phê duyệt');
      return json({ ok: true });
    }

    if (action === 'ceo_revision') {
      if (!isBgd(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'PENDING_CEO_APPROVAL') return json({ error: 'Phiếu không ở trạng thái chờ phê duyệt' }, 400);
      const reason = String(b.reason || '').trim();
      if (!reason) return json({ error: 'Vui lòng nhập lý do trả lại đánh giá' }, 400);
      await env.DB.prepare(
        `UPDATE evaluations SET ceo_revision_reason=?,ceo_revision_at=?,status=?,
         mentor_submitted_at=NULL,department_submitted_at=NULL,employee_confirmed_at=NULL WHERE id=?`
      ).bind(reason, nowStr(), 'CEO_REVISION_REQUESTED', evalId).run();
      await applyHistory('CEO_REVISION_REQUESTED', reason);
      return json({ ok: true });
    }

    if (action === 'hr_receive') {
      if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'CEO_APPROVED') return json({ error: 'Phiếu chưa được phê duyệt' }, 400);
      await env.DB.prepare('UPDATE evaluations SET hr_received_by=?,hr_received_by_name=?,hr_received_at=?,status=? WHERE id=?')
        .bind(me.id, me.full_name, nowStr(), 'HR_RECEIVED', evalId).run();
      await applyHistory('HR_RECEIVED', 'HCNS đã tiếp nhận');
      return json({ ok: true });
    }

    if (action === 'hr_lock') {
      if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'HR_RECEIVED') return json({ error: 'Phiếu chưa được HCNS tiếp nhận' }, 400);
      await env.DB.prepare('UPDATE evaluations SET locked_by=?,locked_by_name=?,locked_at=?,status=? WHERE id=?')
        .bind(me.id, me.full_name, nowStr(), 'LOCKED', evalId).run();
      await applyHistory('LOCKED', 'HCNS đã khóa điểm');
      return json({ ok: true });
    }

    if (action === 'hr_reopen') {
      if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.window_override) return json({ ok: true });
      await env.DB.prepare('UPDATE evaluations SET window_override=1 WHERE id=?').bind(evalId).run();
      await applyHistory(ev.status, 'Mở lại ngoài thời gian đánh giá');
      return json({ ok: true });
    }

    return json({ error: 'Hành động không hợp lệ' }, 400);
  }

  // HCNS "Ghi chú & kiến nghị" cho Ban Giám đốc — one note per eval period (report dashboard).
  const evalPeriodNoteMatch = path.match(/^\/api\/eval-periods\/(\d+)\/note$/);
  if (evalPeriodNoteMatch && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const periodId = parseInt(evalPeriodNoteMatch[1]);
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);
    const b = await request.json().catch(() => ({}));
    const note = String(b.note || '').slice(0, 2000);
    await env.DB.prepare('UPDATE eval_periods SET hr_note=?,hr_note_by=?,hr_note_at=? WHERE id=?')
      .bind(note, me.full_name, nowStr(), periodId).run();
    return json({ ok: true });
  }

  return null;
}
