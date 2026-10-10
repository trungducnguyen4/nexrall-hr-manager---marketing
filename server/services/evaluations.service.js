/**
 * KPI & Performance Evaluations (Đánh giá hiệu suất) Service
 */

export const EVAL_CRITERIA_MAX = {
  HS01: 15, HS02: 10, HS03: 10, HS04: 10, HS05: 10, HS06: 5,
  VH01: 7, VH02: 6, VH03: 6, VH04: 6,
  SK01: 5, SK02: 4, SK03: 3, SK04: 3,
};
export const EVAL_COMMENT_REQUIRED_RATIO = 0.6;
export const EVAL_CODES = Object.keys(EVAL_CRITERIA_MAX);
export const MANUAL_EVAL_CODES = EVAL_CODES.filter(code => !code.startsWith('HS'));

export function evalTotal(scores) {
  let sum = 0;
  for (const code of EVAL_CODES) sum += Number(scores?.[code]) || 0;
  return sum;
}

export function evalValidatePartial(scores, comments) {
  for (const code of MANUAL_EVAL_CODES) {
    const v = (scores || {})[code];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    const max = EVAL_CRITERIA_MAX[code];
    if (!Number.isFinite(n) || n < 0 || n > max) return `Điểm ${code} không hợp lệ (0–${max})`;
    if (n < max * EVAL_COMMENT_REQUIRED_RATIO && !String((comments || {})[code] || '').trim()) {
      return `Cần nhận xét khi điểm ${code} thấp hơn mức cấu hình`;
    }
  }
  return null;
}

export function evalValidateComplete(scores, comments) {
  for (const code of MANUAL_EVAL_CODES) {
    const v = (scores || {})[code];
    if (v === undefined || v === null || v === '') return `Vui lòng chấm điểm đầy đủ 14 tiêu chí (còn thiếu ${code})`;
  }
  return evalValidatePartial(scores, comments);
}

export const KPI_GROUP1_CODES = ['HS01', 'HS02', 'HS03', 'HS04', 'HS05', 'HS06'];
export const KPI_GROUP1_MAX = { HS01: 15, HS02: 10, HS03: 10, HS04: 10, HS05: 10, HS06: 5 };

export function kpiScoreForPercent(percent, maxScore) {
  if (percent >= 110) return maxScore;
  if (percent >= 100) return Math.round(maxScore * .9 * 10) / 10;
  if (percent >= 80) return Math.round(maxScore * .75 * 10) / 10;
  if (percent >= 60) return Math.round(maxScore * .5 * 10) / 10;
  if (percent > 0) return Math.round(maxScore * .25 * 10) / 10;
  return 0;
}

export function validateKpiItems(items) {
  if (!Array.isArray(items) || !items.length) return 'Cần khai báo KPI cho 6 tiêu chí Nhóm 1';
  for (const code of KPI_GROUP1_CODES) {
    const rows = items.filter(x => x.criterion_code === code && Number(x.affects_group1) !== 0);
    const totalWeight = rows.reduce((s, x) => s + Number(x.weight_percent || 0), 0);
    if (!rows.length || Math.abs(totalWeight - 100) > .01) return `Tiêu chí ${code} phải có tổng trọng số bằng 100%`;
  }
  for (const x of items) {
    const scored = Number(x.affects_group1) !== 0;
    const textUnit = String(x.unit || '').toLowerCase() === 'text';
    if ((!KPI_GROUP1_CODES.includes(x.criterion_code) && scored) || !String(x.title || '').trim() || (!textUnit && Number(x.target_value) <= 0) || (scored && Number(x.weight_percent) <= 0)) return 'Dữ liệu KPI không hợp lệ';
  }
  return null;
}

export function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(row => ({ label: String(row?.label || '').trim().slice(0, 160), url: String(row?.url || '').trim() }))
    .filter(row => row.url)
    .filter(row => {
      try { const u = new URL(row.url); if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) return false; seen.add(u.href); return true; }
      catch (_) { return false; }
    });
}

export async function attachKpiEvidence(env, items) {
  for (const item of items || []) {
    const { results = [] } = await env.DB.prepare('SELECT id,label,url,created_by,created_by_name,created_at,updated_by,updated_by_name,updated_at FROM employee_kpi_evidence WHERE kpi_item_id=? ORDER BY id').bind(item.id).all();
    item.evidence = results;
    if (!results.length && String(item.evidence_url || '').trim()) item.evidence = [{ id: `legacy-${item.id}`, label: 'Link bằng chứng', url: item.evidence_url }];
  }
  return items;
}

export async function replaceKpiEvidence(env, plan, item, evidence, me, action = 'replace') {
  const normalized = normalizeEvidence(evidence);
  if (Array.isArray(evidence) && evidence.filter(x => x?.url).length !== normalized.length) throw new Error('Mỗi link bằng chứng phải là URL http hoặc https hợp lệ');
  const { results: oldRows = [] } = await env.DB.prepare('SELECT label,url FROM employee_kpi_evidence WHERE kpi_item_id=? ORDER BY id').bind(item.id).all();
  const oldValue = JSON.stringify(oldRows);
  const newValue = JSON.stringify(normalized);
  if (oldValue === newValue) return false;
  await env.DB.prepare('DELETE FROM employee_kpi_evidence WHERE kpi_item_id=?').bind(item.id).run();
  for (const link of normalized) await env.DB.prepare('INSERT INTO employee_kpi_evidence (kpi_item_id,label,url,created_by,created_by_name,updated_by,updated_by_name) VALUES (?,?,?,?,?,?,?)')
    .bind(item.id, link.label, link.url, me.id, me.full_name || '', me.id, me.full_name || '').run();
  await env.DB.prepare('INSERT INTO employee_kpi_evidence_audit (plan_id,kpi_item_id,action,old_value_json,new_value_json,changed_by,changed_by_name) VALUES (?,?,?,?,?,?,?)')
    .bind(plan.id, item.id, action, oldValue, newValue, me.id, me.full_name || '').run();
  return true;
}

export function kpiItemScore(item) {
  if (Number(item.affects_group1) === 0) return null;
  if (String(item.unit || '').toLowerCase() === 'text') return Number(item.manual_score || 0);
  return null;
}

export function group1Total(items) {
  return KPI_GROUP1_CODES.reduce((sum, code) => {
    const rows = items.filter(item => item.criterion_code === code && Number(item.affects_group1) !== 0);
    if (rows.some(item => String(item.unit || '').toLowerCase() === 'text')) return sum + rows.reduce((n, item) => n + Number(item.manual_score || 0), 0);
    const pct = rows.reduce((n, item) => n + (Number(item.actual_value || 0) / Number(item.target_value || 1)) * Number(item.weight_percent || 0), 0);
    return sum + kpiScoreForPercent(pct, KPI_GROUP1_MAX[code]);
  }, 0);
}

export async function createEvaluationKpiSnapshot(env, evaluationId, employeeId, month, year) {
  const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=? AND status=?')
    .bind(employeeId, month, year, 'APPROVED').first();
  if (!plan) return { error: 'Nhân viên chưa có KPI tháng được HCNS duyệt' };
  const { results: items = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=? ORDER BY criterion_code,id').bind(plan.id).all();
  const invalid = validateKpiItems(items);
  if (invalid) return { error: invalid };
  if (items.filter(x => Number(x.affects_group1) !== 0).some(x => String(x.unit).toLowerCase() === 'text' ? !String(x.actual_text || '').trim() || x.manual_score === null : x.actual_value === null || x.actual_value === undefined)) return { error: 'KPI tính điểm chưa có kết quả hoặc điểm HCNS đầy đủ' };
  const snapshots = [];
  for (const code of KPI_GROUP1_CODES) {
    const rows = items.filter(x => x.criterion_code === code);
    const textRows = rows.filter(x => String(x.unit).toLowerCase() === 'text');
    const pct = textRows.length ? 0 : rows.reduce((sum, x) => sum + (Number(x.actual_value) / Number(x.target_value)) * Number(x.weight_percent), 0) / 100 * 100;
    const score = textRows.length ? textRows.reduce((sum, x) => sum + Number(x.manual_score || 0), 0) : kpiScoreForPercent(pct, KPI_GROUP1_MAX[code]);
    snapshots.push({ code, achievement_percent: Math.round(pct * 100) / 100, automatic_score: score, details: rows });
  }
  for (const s of snapshots) await env.DB.prepare(
    'INSERT OR REPLACE INTO evaluation_kpi_snapshots (evaluation_id,criterion_code,achievement_percent,automatic_score,details_json) VALUES (?,?,?,?,?)'
  ).bind(evaluationId, s.code, s.achievement_percent, s.automatic_score, JSON.stringify(s.details)).run();
  return { snapshots, total: snapshots.reduce((sum, s) => sum + s.automatic_score, 0) };
}

export function groupScores(evaluation) {
  if (!evaluation) return { n1: 0, n2: 0, n3: 0, total: 0 };
  const n1 = (Number(evaluation.score_hs01) || 0) + (Number(evaluation.score_hs02) || 0) +
             (Number(evaluation.score_hs03) || 0) + (Number(evaluation.score_hs04) || 0) +
             (Number(evaluation.score_hs05) || 0) + (Number(evaluation.score_hs06) || 0);
  const n2 = (Number(evaluation.score_vh01) || 0) + (Number(evaluation.score_vh02) || 0) +
             (Number(evaluation.score_vh03) || 0) + (Number(evaluation.score_vh04) || 0);
  const n3 = (Number(evaluation.score_sk01) || 0) + (Number(evaluation.score_sk02) || 0) +
             (Number(evaluation.score_sk03) || 0) + (Number(evaluation.score_sk04) || 0);
  return { n1, n2, n3, total: n1 + n2 + n3 };
}

export function ratingFor(total) {
  if (total == null) return null;
  const t = Number(total);
  if (t >= 85) return { label: 'Xuất sắc', cls: 'badge-green', action: 'Khen thưởng / Xem xét lên chính thức' };
  if (t >= 70) return { label: 'Đạt yêu cầu', cls: 'badge-blue', action: 'Tiếp tục theo dõi / Gia hạn thực tập' };
  if (t >= 50) return { label: 'Cần cải thiện', cls: 'badge-yellow', action: 'Kế hoạch cải thiện hiệu suất (PIP)' };
  return { label: 'Không đạt', cls: 'badge-red', action: 'Xem xét chấm dứt hợp đồng thực tập' };
}

export function safeParseJSON(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function isBgd(u) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  const dept = String(u.department || '').trim().toLowerCase();
  return dept === 'ban giám đốc' || dept === 'ban giam doc';
}
