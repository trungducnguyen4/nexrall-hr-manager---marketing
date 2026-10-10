/**
 * Payroll & Invoices Service
 * Handles salary calculations, payroll adjustments, penalty policy resets,
 * VietQR bank integration, and invoice number sequencing.
 */

import { prevMonthStr, vnTodayStr } from '../lib/time.js';
import { buildMonthlyOvertimeSummary } from './attendance.service.js';

export const PENALTY_POLICY_EFFECTIVE_MONTH = '2026-08';
export const PENALTY_POLICY_RESET_CONFIRMATION = 'RESET_PENALTY_POLICY_2026_08';

export async function ensurePayrollLineChangeLog(env) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_line_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payroll_id INTEGER NOT NULL,
    line_key TEXT NOT NULL,
    line_label TEXT NOT NULL,
    before_value REAL NOT NULL,
    after_value REAL NOT NULL,
    change_note TEXT NOT NULL,
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  try {
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_line_change_log_payroll_created ON payroll_line_change_log(payroll_id,created_at DESC)');
  } catch (_) {}
}

export async function ensurePayrollAdjustmentPolicySchema(env) {
  try { await env.DB.exec('ALTER TABLE payroll_adjustments ADD COLUMN violation_date TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll_adjustments ADD COLUMN policy_month TEXT'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_policy_date ON payroll_adjustments(policy_month,violation_date,employee_id)'); } catch (_) {}
}

export async function ensurePayrollAdjustmentDismissalSchema(env) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_adjustment_dismissals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    source_ref TEXT NOT NULL UNIQUE,
    dismissed_by INTEGER NOT NULL,
    dismissed_by_name TEXT,
    dismissed_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(month, source_ref)
  )`);
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_adjustment_dismissals_month ON payroll_adjustment_dismissals(month,dismissed_at DESC)'); } catch (_) {}
}

export async function ensurePayrollDetailSchema(env) {
  const payrollCols = {
    position_salary: 'REAL DEFAULT 0',
    completion_bonus: 'REAL DEFAULT 0',
    total_income_agreed: 'REAL DEFAULT 0',
    insurance_base: 'REAL DEFAULT 0',
    probation_days: 'REAL DEFAULT 0',
    official_days: 'REAL DEFAULT 0',
    paid_leave_days: 'REAL DEFAULT 0',
    unpaid_leave_days: 'REAL DEFAULT 0',
    work_income: 'REAL DEFAULT 0',
    ot_normal_hours: 'REAL DEFAULT 0',
    ot_weekend_hours: 'REAL DEFAULT 0',
    ot_holiday_hours: 'REAL DEFAULT 0',
    base_hourly_rate: 'REAL DEFAULT 0',
    ot_total_income: 'REAL DEFAULT 0',
    phone_allowance: 'REAL DEFAULT 0',
    attire_allowance: 'REAL DEFAULT 0',
    parking_allowance: 'REAL DEFAULT 0',
    fuel_allowance: 'REAL DEFAULT 0',
    business_trip_allowance: 'REAL DEFAULT 0',
    total_allowance: 'REAL DEFAULT 0',
    total_income_with_allowance: 'REAL DEFAULT 0',
    total_pretax_income: 'REAL DEFAULT 0',
    insurance_social: 'REAL DEFAULT 0',
    insurance_health: 'REAL DEFAULT 0',
    insurance_unemployment: 'REAL DEFAULT 0',
    personal_deduction: 'REAL DEFAULT 0',
    dependent_deduction: 'REAL DEFAULT 0',
    dependent_count: 'INTEGER DEFAULT 0',
    total_family_deduction: 'REAL DEFAULT 0',
    taxable_income: 'REAL DEFAULT 0',
    net_income_after_tax: 'REAL DEFAULT 0',
    tax_withheld: 'REAL DEFAULT 0',
    meal_allowance: 'REAL DEFAULT 0',
    arrears_deduction: 'REAL DEFAULT 0',
    arrears_addition: 'REAL DEFAULT 0',
    transfer_amount: 'REAL DEFAULT 0',
    comp_insurance_social: 'REAL DEFAULT 0',
    comp_insurance_health: 'REAL DEFAULT 0',
    comp_insurance_unemp: 'REAL DEFAULT 0',
    comp_insurance_accident: 'REAL DEFAULT 0',
    comp_insurance_total: 'REAL DEFAULT 0',
    total_company_cost: 'REAL DEFAULT 0',
    is_signed: 'INTEGER DEFAULT 0',
    import_source: "TEXT DEFAULT 'system'",
    raw_data: 'TEXT',
  };

  const invoiceCols = {
    position_salary: 'REAL DEFAULT 0',
    completion_bonus: 'REAL DEFAULT 0',
    total_income_agreed: 'REAL DEFAULT 0',
    insurance_base: 'REAL DEFAULT 0',
    probation_days: 'REAL DEFAULT 0',
    official_days: 'REAL DEFAULT 0',
    paid_leave_days: 'REAL DEFAULT 0',
    unpaid_leave_days: 'REAL DEFAULT 0',
    work_income: 'REAL DEFAULT 0',
    ot_normal_hours: 'REAL DEFAULT 0',
    ot_weekend_hours: 'REAL DEFAULT 0',
    ot_holiday_hours: 'REAL DEFAULT 0',
    base_hourly_rate: 'REAL DEFAULT 0',
    ot_total_income: 'REAL DEFAULT 0',
    phone_allowance: 'REAL DEFAULT 0',
    attire_allowance: 'REAL DEFAULT 0',
    parking_allowance: 'REAL DEFAULT 0',
    fuel_allowance: 'REAL DEFAULT 0',
    business_trip_allowance: 'REAL DEFAULT 0',
    total_allowance: 'REAL DEFAULT 0',
    total_income_with_allowance: 'REAL DEFAULT 0',
    total_pretax_income: 'REAL DEFAULT 0',
    insurance_social: 'REAL DEFAULT 0',
    insurance_health: 'REAL DEFAULT 0',
    insurance_unemployment: 'REAL DEFAULT 0',
    personal_deduction: 'REAL DEFAULT 0',
    dependent_deduction: 'REAL DEFAULT 0',
    dependent_count: 'INTEGER DEFAULT 0',
    total_family_deduction: 'REAL DEFAULT 0',
    taxable_income: 'REAL DEFAULT 0',
    net_income_after_tax: 'REAL DEFAULT 0',
    tax_withheld: 'REAL DEFAULT 0',
    meal_allowance: 'REAL DEFAULT 0',
    arrears_deduction: 'REAL DEFAULT 0',
    arrears_addition: 'REAL DEFAULT 0',
    transfer_amount: 'REAL DEFAULT 0',
    import_source: "TEXT DEFAULT 'system'",
    raw_data: 'TEXT',
  };

  for (const [col, type] of Object.entries(payrollCols)) {
    try { await env.DB.exec(`ALTER TABLE payroll ADD COLUMN ${col} ${type}`); } catch (_) {}
  }
  for (const [col, type] of Object.entries(invoiceCols)) {
    try { await env.DB.exec(`ALTER TABLE invoices ADD COLUMN ${col} ${type}`); } catch (_) {}
  }
}

const VIETQR_BANKS_URL = 'https://api.vietqr.io/v2/banks';
const VIETQR_BANKS_TTL_MS = 24 * 60 * 60 * 1000;
let _vietqrBanksCache = { data: null, expiresAt: 0 };

export async function getVietqrBanks() {
  if (_vietqrBanksCache.data && Date.now() < _vietqrBanksCache.expiresAt) {
    return _vietqrBanksCache.data;
  }
  const response = await fetch(VIETQR_BANKS_URL, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`VietQR responded ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== '00' || !Array.isArray(payload.data)) {
    throw new Error('VietQR returned an invalid bank directory');
  }
  const data = payload.data
    .filter(bank => bank && bank.shortName && bank.name && bank.bin)
    .map(bank => ({
      shortName: String(bank.shortName),
      name: String(bank.name),
      code: String(bank.code || ''),
      bin: String(bank.bin),
      logo: typeof bank.logo === 'string' && bank.logo.startsWith('https://api.vietqr.io/') ? bank.logo : '',
    }))
    .sort((a, b) => a.shortName.localeCompare(b.shortName, 'vi'));
  _vietqrBanksCache = { data, expiresAt: Date.now() + VIETQR_BANKS_TTL_MS };
  return data;
}

export async function nextInvoiceNumber(env, year, month) {
  const row = await env.DB.prepare(
    "SELECT invoice_number FROM invoices WHERE year=? AND month=? AND invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1"
  ).bind(year, month, `HD-${year}${String(month).padStart(2, '0')}-%`).first();
  const lastSeq = Number(String(row?.invoice_number || '').split('-').pop() || 0);
  const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE year=? AND month=?')
    .bind(year, month).first();
  const seq = String(Math.max(lastSeq, Number(count?.cnt || 0)) + 1).padStart(3, '0');
  return 'HD-' + year + String(month).padStart(2, '0') + '-' + seq;
}

export function payrollAdjustmentType(source, amount, scoreDelta) {
  if (amount > 0 && source !== 'attendance') return 'bonus';
  if (amount > 0 && source === 'attendance') return 'penalty';
  if (scoreDelta > 0) return 'score_bonus';
  if (scoreDelta < 0) return 'score_penalty';
  return 'alert';
}

export async function getPenaltyPolicyResetPreview(env) {
  const { results: adjustments = [] } = await env.DB.prepare(
    `SELECT pa.*,p.id AS payroll_exists,p.deduction AS payroll_deduction,p.base_salary,p.kpi_bonus,p.allowance,p.net_salary
       FROM payroll_adjustments pa
       LEFT JOIN payroll p ON p.id=pa.payroll_id
      WHERE pa.type IN ('penalty','score_penalty')
      ORDER BY pa.month,pa.id`
  ).all();
  const refundsByPayroll = new Map();
  let penaltyRows = 0;
  let scorePenaltyRows = 0;
  let penaltyAmount = 0;
  let scoreDelta = 0;
  let unlinkedApprovedPenaltyRows = 0;
  for (const adjustment of adjustments) {
    if (adjustment.type === 'penalty') {
      penaltyRows++;
      penaltyAmount += Number(adjustment.amount || 0);
      if (adjustment.status === 'approved' && adjustment.payroll_id) {
        const current = refundsByPayroll.get(Number(adjustment.payroll_id)) || { payroll: adjustment, amount: 0, adjustmentIds: [] };
        current.amount += Number(adjustment.amount || 0);
        current.adjustmentIds.push(Number(adjustment.id));
        refundsByPayroll.set(Number(adjustment.payroll_id), current);
      } else if (adjustment.status === 'approved') {
        unlinkedApprovedPenaltyRows++;
      }
    } else {
      scorePenaltyRows++;
      scoreDelta += Number(adjustment.score_delta || 0);
    }
  }
  const payrollRefunds = [...refundsByPayroll.values()];
  const conflicts = payrollRefunds
    .filter(item => !item.payroll.payroll_exists || Number(item.payroll.payroll_deduction || 0) < item.amount)
    .map(item => ({ payroll_id: item.payroll.payroll_id, month: item.payroll.month, deduction: Number(item.payroll.payroll_deduction || 0), refund_amount: item.amount }));
  return {
    adjustments,
    payrollRefunds,
    conflicts,
    summary: {
      adjustment_count: adjustments.length,
      penalty_rows: penaltyRows,
      score_penalty_rows: scorePenaltyRows,
      total_penalty_amount: penaltyAmount,
      total_score_delta: scoreDelta,
      payroll_rows_to_refund: payrollRefunds.length,
      total_payroll_refund: payrollRefunds.reduce((sum, item) => sum + item.amount, 0),
      unlinked_approved_penalty_rows: unlinkedApprovedPenaltyRows,
    },
  };
}

export async function resetPenaltyPolicyAdjustments(env, actor) {
  const preview = await getPenaltyPolicyResetPreview(env);
  if (preview.conflicts.length) {
    const error = new Error('Không thể hoàn phạt vì deduction hiện tại không khớp các row phạt đã duyệt');
    error.conflicts = preview.conflicts;
    throw error;
  }
  const statements = [];
  for (const item of preview.payrollRefunds) {
    const payroll = item.payroll;
    const before = {
      deduction: Number(payroll.payroll_deduction || 0),
      net_salary: Number(payroll.net_salary || 0),
    };
    const nextDeduction = before.deduction - item.amount;
    const nextNet = Number(payroll.base_salary || 0) + Number(payroll.kpi_bonus || 0) + Number(payroll.allowance || 0) - nextDeduction;
    const after = { ...before, deduction: nextDeduction, net_salary: nextNet };
    statements.push(
      env.DB.prepare('UPDATE payroll SET deduction=?,net_salary=? WHERE id=?').bind(nextDeduction, nextNet, payroll.payroll_id),
      env.DB.prepare('INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)')
        .bind(payroll.payroll_id, actor.id, actor.full_name || '', `Hoàn ${item.amount.toLocaleString('vi-VN')}đ do thay quy định phạt từ ${PENALTY_POLICY_EFFECTIVE_MONTH}`, JSON.stringify(before), JSON.stringify(after))
    );
  }
  statements.push(env.DB.prepare("DELETE FROM payroll_adjustments WHERE type IN ('penalty','score_penalty')"));
  if (statements.length) await env.DB.batch(statements);
  return preview.summary;
}

export async function buildPayrollAdjustmentSuggestions(env, month) {
  const suggestions = [];
  const { results: payrollRows = [] } = await env.DB.prepare(
    'SELECT id,employee_id,employee_name,employee_code,department FROM payroll WHERE month=?'
  ).bind(month).all();
  const payrollByEmployee = new Map(payrollRows.map(p => [Number(p.employee_id), p]));

  function pushSuggestion(row) {
    const payroll = payrollByEmployee.get(Number(row.employee_id));
    suggestions.push({
      payroll_id: payroll?.id || null,
      employee_id: Number(row.employee_id),
      employee_name: row.employee_name || payroll?.employee_name || '',
      employee_code: row.employee_code || payroll?.employee_code || '',
      department: row.department || payroll?.department || '',
      month,
      violation_date: row.violation_date || row.date || null,
      policy_month: row.policy_month || month,
      type: row.type || payrollAdjustmentType(row.source, Number(row.amount || 0), Number(row.score_delta || 0)),
      source: row.source,
      source_ref: row.source_ref,
      amount: Number(row.amount || 0),
      score_delta: Number(row.score_delta || 0),
      reason: row.reason,
      can_apply: !(Number(row.amount || 0) > 0 && !payroll?.id),
    });
  }

  const { results: evals = [] } = await env.DB.prepare(
    `SELECT e.id AS evaluation_id, e.user_id AS employee_id, e.final_approved_score,
            u.full_name AS employee_name, u.employee_code, u.department
       FROM evaluations e
       JOIN eval_periods p ON e.period_id=p.id
       JOIN users u ON e.user_id=u.id
      WHERE e.status='LOCKED'
        AND printf('%04d-%02d', p.year, p.month)=?
        AND e.final_approved_score IS NOT NULL`
  ).bind(month).all();
  for (const ev of evals) {
    const score = Number(ev.final_approved_score || 0);
    if (score >= 90) {
      pushSuggestion({ ...ev, source: 'evaluation', source_ref: `eval-score:${ev.evaluation_id}`, amount: 1000000, score_delta: 0, reason: `Diem danh gia ${score}: de xuat thuong 1.000.000d (co the dieu chinh toi 2.000.000d).` });
    } else if (score >= 80) {
      pushSuggestion({ ...ev, source: 'evaluation', source_ref: `eval-score:${ev.evaluation_id}`, amount: 500000, score_delta: 0, reason: `Diem danh gia ${score}: de xuat thuong 500.000d.` });
    }
  }

  const prevMonth = prevMonthStr(month);
  if (prevMonth) {
    const { results: lowRows = [] } = await env.DB.prepare(
      `SELECT cur.user_id AS employee_id, cur.final_approved_score AS current_score, prev.final_approved_score AS previous_score,
              u.full_name AS employee_name, u.employee_code, u.department
         FROM evaluations cur
         JOIN eval_periods cp ON cur.period_id=cp.id
         JOIN evaluations prev ON prev.user_id=cur.user_id
         JOIN eval_periods pp ON prev.period_id=pp.id
         JOIN users u ON u.id=cur.user_id
        WHERE cur.status='LOCKED' AND prev.status='LOCKED'
          AND printf('%04d-%02d', cp.year, cp.month)=?
          AND printf('%04d-%02d', pp.year, pp.month)=?
          AND cur.final_approved_score < 50 AND prev.final_approved_score < 50`
    ).bind(month, prevMonth).all();
    for (const row of lowRows) {
      pushSuggestion({ ...row, source: 'evaluation', source_ref: `eval-low-2mo:${row.employee_id}:${month}`, amount: 0, score_delta: 0, reason: `Diem yeu 2 thang lien tiep (${prevMonth}: ${row.previous_score}, ${month}: ${row.current_score}) - can HR/BGD xem xet.` });
    }
  }

  const policyIsActive = month >= PENALTY_POLICY_EFFECTIVE_MONTH;
  const { results: attendanceRows = [] } = policyIsActive ? await env.DB.prepare(
    `SELECT a.id AS attendance_id, a.user_id AS employee_id, a.date, a.late_minutes, a.checkin_time, a.checkout_time,
            u.full_name AS employee_name, u.employee_code, u.department
       FROM attendance a JOIN users u ON a.user_id=u.id
      WHERE a.date LIKE ? ORDER BY a.user_id,a.date,a.id`
  ).bind(`${month}-%`).all() : { results: [] };
  const lateCountByEmployee = new Map();
  for (const a of attendanceRows) {
    const late = Number(a.late_minutes || 0);
    if (late > 0) {
      const lateCount = (lateCountByEmployee.get(Number(a.employee_id)) || 0) + 1;
      lateCountByEmployee.set(Number(a.employee_id), lateCount);
      if (lateCount >= 3) {
        pushSuggestion({ ...a, violation_date: a.date, policy_month: month, source: 'attendance', source_ref: `att-late:${a.attendance_id}`, amount: 20000, score_delta: 0, reason: `Đi trễ lần thứ ${lateCount} trong ${month}: phạt 20.000đ theo quy định.` });
      }
    }
    if (a.date < vnTodayStr() && (!a.checkin_time || !a.checkout_time)) {
      pushSuggestion({ ...a, violation_date: a.date, policy_month: month, source: 'attendance', source_ref: `att-missing:${a.attendance_id}`, amount: 50000, score_delta: 0, reason: 'Thiếu check-in/out: phạt 50.000đ.' });
    }
  }

  const { results: taskRows = [] } = policyIsActive ? await env.DB.prepare(
    `SELECT t.assigned_to AS employee_id, COUNT(*) AS late_count,
            u.full_name AS employee_name, u.employee_code, u.department
       FROM tasks t JOIN users u ON t.assigned_to=u.id
      WHERE t.due_date LIKE ?
        AND date(t.due_date) < date('now','localtime')
        AND t.status NOT IN ('done','cancelled')
      GROUP BY t.assigned_to
     HAVING COUNT(*) >= 3`
  ).bind(`${month}-%`).all() : { results: [] };
  for (const row of taskRows) {
    pushSuggestion({ ...row, source: 'tasks', source_ref: `task-deadline:${row.employee_id}:${month}`, amount: 0, score_delta: -5, reason: `Tre deadline ${row.late_count} lan trong thang: de xuat tru 5 diem theo chinh sach.` });
  }

  const { results: approved = [] } = await env.DB.prepare(
    `SELECT pa.*, u.full_name AS employee_name, u.employee_code, u.department
       FROM payroll_adjustments pa
       LEFT JOIN users u ON u.id=pa.employee_id
      WHERE pa.month=? AND pa.status='approved'
      ORDER BY pa.approved_at DESC, pa.id DESC`
  ).bind(month).all();
  const approvedRefs = new Set(approved.map(a => a.source_ref).filter(Boolean));
  const { results: dismissed = [] } = await env.DB.prepare(
    'SELECT source_ref FROM payroll_adjustment_dismissals WHERE month=?'
  ).bind(month).all();
  const dismissedRefs = new Set(dismissed.map(row => row.source_ref));
  return {
    suggestions: suggestions.filter(s => !approvedRefs.has(s.source_ref) && !dismissedRefs.has(s.source_ref)),
    approved,
  };
}

export async function refreshInvoiceOvertime(env, userId, month, year, actor = null) {
  const mm = String(month).padStart(2, '0');
  const monthKey = `${year}-${mm}`;
  const user = await env.DB.prepare('SELECT salary FROM users WHERE id=?').bind(userId).first();
  const baseSalary = Number(user?.salary || 0);
  const ot = await buildMonthlyOvertimeSummary(env, userId, month, year, baseSalary);

  const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE user_id=? AND month=? AND year=? ORDER BY id DESC LIMIT 1').bind(userId, month, year).first();
  if (invoice) {
    const net = Number(invoice.base_salary || baseSalary) + Number(invoice.bonus || 0) + Number(invoice.allowance || 0) + ot.overtimePay - Number(invoice.deduction || 0) - Number(invoice.tax || 0) - Number(invoice.insurance || 0);
    await env.DB.prepare('UPDATE invoices SET approved_overtime_minutes=?,overtime_pay=?,net_salary=? WHERE id=?').bind(ot.approvedOvertimeMinutes, ot.overtimePay, net, invoice.id).run();
    if (actor) await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)').bind(invoice.id, invoice.status, invoice.status, actor.id, actor.full_name || '', `Overtime approval recalculated: ${ot.approvedOvertimeHours.toFixed(2)}h`).run();
  }

  const payroll = await env.DB.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? LIMIT 1').bind(userId, monthKey).first();
  if (payroll) {
    const pNet = Number(payroll.base_salary || baseSalary) + Number(payroll.kpi_bonus || 0) + Number(payroll.allowance || 0) + ot.overtimePay - Number(payroll.deduction || 0) - Number(payroll.tax || 0) - Number(payroll.insurance || 0);
    await env.DB.prepare('UPDATE payroll SET approved_overtime_minutes=?,overtime_pay=?,net_salary=? WHERE id=?').bind(ot.approvedOvertimeMinutes, ot.overtimePay, pNet, payroll.id).run();
  }
  return ot;
}
