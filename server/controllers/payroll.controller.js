/**
 * Payroll Controller - HTTP Endpoints for Payroll Batches, Line Items,
 * Adjustments, Penalty Policies & VietQR Exports
 */
import { json, err } from '../lib/response.js';
import {
  ensurePayrollLineChangeLog,
  ensurePayrollDetailSchema,
  getPenaltyPolicyResetPreview,
  resetPenaltyPolicyAdjustments,
  buildPayrollAdjustmentSuggestions,
  nextInvoiceNumber,
  payrollAdjustmentType,
  PENALTY_POLICY_EFFECTIVE_MONTH,
  PENALTY_POLICY_RESET_CONFIRMATION,
  getVietqrBanks,
} from '../services/payroll.service.js';
import {
  buildMonthlyOvertimeSummary,
  buildMonthlyWorkSummary,
} from '../services/attendance.service.js';
import { intOrNull } from '../services/tasks.service.js';

export async function handlePayrollRoutes(request, env, me, path, url, options = {}) {
  const {
    isManager = false,
    isAdmin = false,
    isHcns = () => false,
    broadcastAppEvent = async () => {},
  } = options;

  if (path === '/api/integrations/vietqr/banks' && request.method === 'GET') {
    if (!isAdmin && !isHcns(me)) return json({ error: 'Không có quyền truy cập danh mục ngân hàng' }, 403);
    try {
      const banks = await getVietqrBanks();
      return json({ banks });
    } catch (error) {
      console.error('VietQR banks fetch failed', error);
      return json({ error: 'Không thể tải danh mục ngân hàng từ VietQR' }, 502);
    }
  }

  // ── PAYROLL ───────────────────────────────────────────────────────
  if (path === '/api/payroll-adjustments/suggestions' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Khong co quyen' }, 403);
    const month = String(url.searchParams.get('month') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const data = await buildPayrollAdjustmentSuggestions(env, month);
    return json({
      month,
      suggestions: data.suggestions,
      approved: data.approved,
      manual_sources: [{ source: 'manual', label: 'HCNS: báo cáo không chủ động / quản lý phải hỏi tiến độ' }],
    });
  }

  if (path === '/api/payroll-adjustments/dismiss' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được xóa đề xuất' }, 403);
    const body = await request.json().catch(() => ({}));
    const month = String(body.month || '').trim();
    const sourceRef = String(body.source_ref || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month) || !sourceRef || sourceRef.length > 160) {
      return json({ error: 'Dữ liệu xóa đề xuất không hợp lệ' }, 400);
    }
    // Only dismiss a currently valid calculated proposal; never accept an
    // arbitrary reference that could suppress another payroll period.
    const data = await buildPayrollAdjustmentSuggestions(env, month);
    if (!data.suggestions.some(suggestion => suggestion.source_ref === sourceRef)) {
      return json({ error: 'Đề xuất không còn tồn tại hoặc đã được xử lý' }, 404);
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO payroll_adjustment_dismissals (month,source_ref,dismissed_by,dismissed_by_name)
       VALUES (?,?,?,?)`
    ).bind(month, sourceRef, me.id, me.full_name || '').run();
    return json({ ok: true, month, source_ref: sourceRef });
  }

  if (path === '/api/payroll-adjustments/penalty-policy-reset-preview' && request.method === 'GET') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được xem dọn dữ liệu phạt' }, 403);
    const preview = await getPenaltyPolicyResetPreview(env);
    return json({ ...preview.summary, conflicts: preview.conflicts });
  }

  if (path === '/api/payroll-adjustments/penalty-policy-reset' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được cập nhật quy định phạt' }, 403);
    const confirmation = String((await request.json().catch(() => ({}))).confirmation || '');
    if (confirmation !== PENALTY_POLICY_RESET_CONFIRMATION) return json({ error: 'Xác nhận cập nhật quy định phạt không hợp lệ' }, 400);
    try {
      return json({ ok: true, ...await resetPenaltyPolicyAdjustments(env, me) });
    } catch (error) {
      if (error.conflicts) return json({ error: error.message, conflicts: error.conflicts }, 409);
      throw error;
    }
  }

  if (path === '/api/payroll-adjustments/apply' && request.method === 'POST') {
    if (!isManager) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const incoming = Array.isArray(b.items) ? b.items : [];
    if (!incoming.length) return json({ error: 'Chua co de xuat nao duoc chon' }, 400);
    if (incoming.some(item => item?.source === 'manual' || !item?.source_ref) && !isHcns(me)) {
      return json({ error: 'Chỉ HCNS/Admin được tạo phạt thủ công' }, 403);
    }

    const data = await buildPayrollAdjustmentSuggestions(env, month);
    const suggestionByRef = new Map(data.suggestions.map(s => [s.source_ref, s]));
    let applied = 0, skipped = 0;
    const errors = [];

    for (const item of incoming) {
      const isManual = item.source === 'manual' || !item.source_ref;
      const base = isManual ? {
        employee_id: intOrNull(item.employee_id),
        payroll_id: intOrNull(item.payroll_id),
        month,
        type: item.type || payrollAdjustmentType(item.source || 'manual', Number(item.amount || 0), Number(item.score_delta || 0)),
        source: 'manual',
        source_ref: `manual:${month}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        violation_date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.violation_date || '')) ? item.violation_date : null,
        policy_month: month,
        amount: Number(item.amount || 0),
        score_delta: Number(item.score_delta || 0),
        reason: String(item.reason || '').trim(),
      } : suggestionByRef.get(item.source_ref);

      if (!base) { skipped++; errors.push({ source_ref: item.source_ref || null, error: 'De xuat khong con hop le hoac da ap dung' }); continue; }
      if (!base.employee_id || !base.reason) { skipped++; errors.push({ source_ref: item.source_ref || null, error: 'Thieu nhan vien hoac ly do' }); continue; }

      const amount = Math.max(0, Number(item.amount ?? base.amount ?? 0));
      const scoreDelta = Number(item.score_delta ?? base.score_delta ?? 0);
      const type = item.type || base.type || payrollAdjustmentType(base.source, amount, scoreDelta);
      let payroll = base.payroll_id ? await env.DB.prepare('SELECT * FROM payroll WHERE id=?').bind(base.payroll_id).first() : null;
      if (!payroll) payroll = await env.DB.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? LIMIT 1').bind(base.employee_id, month).first();
      if (amount > 0 && !payroll) {
        skipped++;
        errors.push({ source_ref: base.source_ref, error: 'Chua co dong bang luong cho nhan vien nay' });
        continue;
      }

      const existing = base.source_ref ? await env.DB.prepare('SELECT id FROM payroll_adjustments WHERE source_ref=? AND status=?')
        .bind(base.source_ref, 'approved').first() : null;
      if (existing) { skipped++; continue; }

      await env.DB.prepare(
        `INSERT INTO payroll_adjustments (employee_id,payroll_id,month,violation_date,policy_month,type,source,source_ref,amount,score_delta,reason,status,created_by,created_by_name,approved_by,approved_by_name,approved_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'approved',?,?,?,?,datetime('now','localtime'),datetime('now','localtime'))`
      ).bind(base.employee_id, payroll?.id || null, month, base.violation_date || null, base.policy_month || month, type, base.source, base.source_ref, amount, scoreDelta, String(item.reason || base.reason).trim(), me.id, me.full_name || '', me.id, me.full_name || '').run();

      if (amount > 0 && payroll) {
        const nextKpi = Number(payroll.kpi_bonus || 0) + (type === 'bonus' ? amount : 0);
        const nextDeduction = Number(payroll.deduction || 0) + (type === 'penalty' ? amount : 0);
        const nextNet = Number(payroll.base_salary || 0) + nextKpi + Number(payroll.allowance || 0) - nextDeduction;
        await env.DB.prepare("UPDATE payroll SET kpi_bonus=?,deduction=?,net_salary=? WHERE id=?")
          .bind(nextKpi, nextDeduction, nextNet, payroll.id).run();
      }
      applied++;
    }
    await broadcastAppEvent(env, 'payroll', 'payroll:adjusted', {
      month,
      applied,
      skipped,
    }, { actorId: me.id });
    return json({ ok: true, month, applied, skipped, errors });
  }

  if (path === '/api/payroll' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const month = url.searchParams.get('month') || new Date().toISOString().slice(0,7);
    const stmt = env.DB.prepare(`SELECT p.*, u.position, u.contract_type
      FROM payroll p LEFT JOIN users u ON u.id=p.employee_id
      WHERE p.month=?${(!isAdmin && !isHcns(me)) ? ' AND p.department=?' : ''} ORDER BY p.id DESC`);
    const { results } = (!isAdmin && !isHcns(me)) ? await stmt.bind(month, me.department).all() : await stmt.bind(month).all();
    return json({ payroll: results });
  }

  if (path === '/api/payroll/import' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền thực hiện' }, 403);
    try {
      await ensurePayrollDetailSchema(env);
      const b = await request.json().catch(() => ({}));
      const month = String(b.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thiếu hoặc sai định dạng tháng lương (YYYY-MM)' }, 400);

      const batch = await env.DB.prepare('SELECT * FROM payroll_batches WHERE month=?').bind(month).first();
      if (batch && ['locked', 'paid'].includes(String(batch.status || '').toLowerCase())) {
        return json({ error: 'Bảng lương tháng này đã khóa, không thể import đè.' }, 409);
      }

      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return json({ error: 'Không có dữ liệu nhân viên để import' }, 400);

      const [yearStr, mmStr] = month.split('-');
      const invYear = Number(yearStr);
      const invMonth = Number(mmStr);

      const { results: users = [] } = await env.DB.prepare(
        'SELECT id, employee_code, full_name, department, position, contract_type, salary FROM users'
      ).all();

      const userByCode = new Map();
      const userByName = new Map();
      for (const u of users) {
        if (u.employee_code) userByCode.set(String(u.employee_code).trim().toUpperCase(), u);
        if (u.full_name) userByName.set(String(u.full_name).trim().toLowerCase(), u);
      }

      let created = 0, updated = 0, matched = 0;
      const unmatchedCodes = [];

      for (const r of rows) {
        const code = String(r.employee_code || '').trim().toUpperCase();
        const name = String(r.full_name || '').trim();
        const normName = name.toLowerCase();

        const matchedUser = (code && userByCode.get(code)) || userByName.get(normName) || null;
        const employeeId = matchedUser ? matchedUser.id : null;
        if (matchedUser) matched++;
        else if (code) unmatchedCodes.push(`${code} (${name})`);

        const dept = r.department || (matchedUser ? matchedUser.department : '') || '';
        const baseSalary = Number(r.total_income_agreed || r.base_salary || r.position_salary || (matchedUser ? matchedUser.salary : 0) || 0);
        const netSalary = Number(r.transfer_amount || r.net_income_after_tax || r.net_salary || 0);
        const dataStatus = 'ready';
        const dataWarnings = '';

        let existing = null;
        if (employeeId) {
          existing = await env.DB.prepare('SELECT id FROM payroll WHERE month=? AND employee_id=? LIMIT 1')
            .bind(month, employeeId).first();
        }
        if (!existing && code) {
          existing = await env.DB.prepare('SELECT id FROM payroll WHERE month=? AND UPPER(employee_code)=? LIMIT 1')
            .bind(month, code).first();
        }
        if (!existing && name) {
          existing = await env.DB.prepare('SELECT id FROM payroll WHERE month=? AND employee_name=? LIMIT 1')
            .bind(month, name).first();
        }

        let payrollId = null;
        if (existing) {
          payrollId = existing.id;
          await env.DB.prepare(`
            UPDATE payroll SET
              user_id=?, employee_id=?, employee_name=?, employee_code=?, department=?,
              base_salary=?, kpi_bonus=?, allowance=?, deduction=?, overtime_pay=?, tax=?, insurance=?,
              work_days=?, standard_days=?, note=?, net_salary=?, data_status=?, data_warnings=?,
              position_salary=?, completion_bonus=?, total_income_agreed=?, insurance_base=?,
              probation_days=?, official_days=?, paid_leave_days=?, unpaid_leave_days=?, work_income=?,
              ot_normal_hours=?, ot_weekend_hours=?, ot_holiday_hours=?, base_hourly_rate=?, ot_total_income=?,
              phone_allowance=?, attire_allowance=?, parking_allowance=?, fuel_allowance=?, business_trip_allowance=?,
              total_allowance=?, total_income_with_allowance=?, total_pretax_income=?,
              insurance_social=?, insurance_health=?, insurance_unemployment=?,
              personal_deduction=?, dependent_deduction=?, dependent_count=?, total_family_deduction=?,
              taxable_income=?, net_income_after_tax=?, tax_withheld=?,
              meal_allowance=?, arrears_deduction=?, arrears_addition=?, transfer_amount=?,
              comp_insurance_social=?, comp_insurance_health=?, comp_insurance_unemp=?,
              comp_insurance_accident=?, comp_insurance_total=?, total_company_cost=?,
              is_signed=?, import_source='excel', source_synced_at=datetime('now','localtime')
            WHERE id=?
          `).bind(
            String(me.id), employeeId, name, code, dept,
            baseSalary, Number(r.kpi_bonus || 0), Number(r.total_allowance || r.allowance || 0),
            Number(r.arrears_deduction || 0), Number(r.ot_total_income || r.overtime_pay || 0),
            Number(r.tax || 0), Number(r.insurance || 0),
            Number(r.work_days || 0), Number(r.standard_days || 23), r.notes || '', netSalary, dataStatus, dataWarnings,
            Number(r.position_salary || 0), Number(r.completion_bonus || 0), Number(r.total_income_agreed || 0), Number(r.insurance_base || 0),
            Number(r.probation_days || 0), Number(r.official_days || 0), Number(r.paid_leave_days || 0), Number(r.unpaid_leave_days || 0), Number(r.work_income || 0),
            Number(r.ot_normal_hours || 0), Number(r.ot_weekend_hours || 0), Number(r.ot_holiday_hours || 0), Number(r.base_hourly_rate || 0), Number(r.ot_total_income || 0),
            Number(r.phone_allowance || 0), Number(r.attire_allowance || 0), Number(r.parking_allowance || 0), Number(r.fuel_allowance || 0), Number(r.business_trip_allowance || 0),
            Number(r.total_allowance || 0), Number(r.total_income_with_allowance || 0), Number(r.total_pretax_income || 0),
            Number(r.insurance_social || 0), Number(r.insurance_health || 0), Number(r.insurance_unemployment || 0),
            Number(r.personal_deduction || 0), Number(r.dependent_deduction || 0), Number(r.dependent_count || 0), Number(r.total_family_deduction || 0),
            Number(r.taxable_income || 0), Number(r.net_income_after_tax || 0), Number(r.tax_withheld || 0),
            Number(r.meal_allowance || 0), Number(r.arrears_deduction || 0), Number(r.arrears_addition || 0), Number(r.transfer_amount || 0),
            Number(r.comp_insurance_social || 0), Number(r.comp_insurance_health || 0), Number(r.comp_insurance_unemp || 0),
            Number(r.comp_insurance_accident || 0), Number(r.comp_insurance_total || 0), Number(r.total_company_cost || 0),
            r.is_signed ? 1 : 0, existing.id
          ).run();
          updated++;
        } else {
          const ins = await env.DB.prepare(`
            INSERT INTO payroll (
              user_id, employee_id, employee_name, employee_code, department, month,
              base_salary, kpi_bonus, allowance, deduction, overtime_pay, tax, insurance,
              work_days, standard_days, note, net_salary, data_status, data_warnings,
              position_salary, completion_bonus, total_income_agreed, insurance_base,
              probation_days, official_days, paid_leave_days, unpaid_leave_days, work_income,
              ot_normal_hours, ot_weekend_hours, ot_holiday_hours, base_hourly_rate, ot_total_income,
              phone_allowance, attire_allowance, parking_allowance, fuel_allowance, business_trip_allowance,
              total_allowance, total_income_with_allowance, total_pretax_income,
              insurance_social, insurance_health, insurance_unemployment,
              personal_deduction, dependent_deduction, dependent_count, total_family_deduction,
              taxable_income, net_income_after_tax, tax_withheld,
              meal_allowance, arrears_deduction, arrears_addition, transfer_amount,
              comp_insurance_social, comp_insurance_health, comp_insurance_unemp,
              comp_insurance_accident, comp_insurance_total, total_company_cost,
              is_signed, import_source, source_synced_at
            ) VALUES (
              ?,?,?,?,?,?,
              ?,?,?,?,?,?,?,
              ?,?,?,?,?,?,
              ?,?,?,?,
              ?,?,?,?,?,
              ?,?,?,?,?,
              ?,?,?,?,?,
              ?,?,?,
              ?,?,?,
              ?,?,?,?,
              ?,?,?,
              ?,?,?,?,
              ?,?,?,
              ?,?,?,
              ?,'excel',datetime('now','localtime')
            )
          `).bind(
            String(me.id), employeeId, name, code, dept, month,
            baseSalary, Number(r.kpi_bonus || 0), Number(r.total_allowance || r.allowance || 0),
            Number(r.arrears_deduction || 0), Number(r.ot_total_income || r.overtime_pay || 0),
            Number(r.tax || 0), Number(r.insurance || 0),
            Number(r.work_days || 0), Number(r.standard_days || 23), r.notes || '', netSalary, dataStatus, dataWarnings,
            Number(r.position_salary || 0), Number(r.completion_bonus || 0), Number(r.total_income_agreed || 0), Number(r.insurance_base || 0),
            Number(r.probation_days || 0), Number(r.official_days || 0), Number(r.paid_leave_days || 0), Number(r.unpaid_leave_days || 0), Number(r.work_income || 0),
            Number(r.ot_normal_hours || 0), Number(r.ot_weekend_hours || 0), Number(r.ot_holiday_hours || 0), Number(r.base_hourly_rate || 0), Number(r.ot_total_income || 0),
            Number(r.phone_allowance || 0), Number(r.attire_allowance || 0), Number(r.parking_allowance || 0), Number(r.fuel_allowance || 0), Number(r.business_trip_allowance || 0),
            Number(r.total_allowance || 0), Number(r.total_income_with_allowance || 0), Number(r.total_pretax_income || 0),
            Number(r.insurance_social || 0), Number(r.insurance_health || 0), Number(r.insurance_unemployment || 0),
            Number(r.personal_deduction || 0), Number(r.dependent_deduction || 0), Number(r.dependent_count || 0), Number(r.total_family_deduction || 0),
            Number(r.taxable_income || 0), Number(r.net_income_after_tax || 0), Number(r.tax_withheld || 0),
            Number(r.meal_allowance || 0), Number(r.arrears_deduction || 0), Number(r.arrears_addition || 0), Number(r.transfer_amount || 0),
            Number(r.comp_insurance_social || 0), Number(r.comp_insurance_health || 0), Number(r.comp_insurance_unemp || 0),
            Number(r.comp_insurance_accident || 0), Number(r.comp_insurance_total || 0), Number(r.total_company_cost || 0),
            r.is_signed ? 1 : 0
          ).run();
          payrollId = ins.meta.last_row_id;
          created++;
        }

        // Automatically sync invoice (payslip) for employee so they immediately see the clean payslip
        if (employeeId) {
          const existingInv = await env.DB.prepare(
            'SELECT id, status, locked_at FROM invoices WHERE user_id=? AND month=? AND year=? LIMIT 1'
          ).bind(employeeId, invMonth, invYear).first();

          if (existingInv && !existingInv.locked_at && existingInv.status !== 'paid') {
            await env.DB.prepare(`
              UPDATE invoices SET
                payroll_id=?, base_salary=?, bonus=?, allowance=?, deduction=?, tax=?, insurance=?, net_salary=?,
                work_days=?, standard_days=?, note=?,
                position_salary=?, completion_bonus=?, total_income_agreed=?, insurance_base=?,
                probation_days=?, official_days=?, paid_leave_days=?, unpaid_leave_days=?, work_income=?,
                ot_normal_hours=?, ot_weekend_hours=?, ot_holiday_hours=?, base_hourly_rate=?, ot_total_income=?,
                phone_allowance=?, attire_allowance=?, parking_allowance=?, fuel_allowance=?, business_trip_allowance=?,
                total_allowance=?, total_income_with_allowance=?, total_pretax_income=?,
                insurance_social=?, insurance_health=?, insurance_unemployment=?,
                personal_deduction=?, dependent_deduction=?, dependent_count=?, total_family_deduction=?,
                taxable_income=?, net_income_after_tax=?, tax_withheld=?,
                meal_allowance=?, arrears_deduction=?, arrears_addition=?, transfer_amount=?, import_source='excel'
              WHERE id=?
            `).bind(
              payrollId, baseSalary, Number(r.kpi_bonus || 0), Number(r.total_allowance || r.allowance || 0),
              Number(r.arrears_deduction || 0), Number(r.tax || 0), Number(r.insurance || 0), netSalary,
              Number(r.work_days || 0), Number(r.standard_days || 23), r.notes || '',
              Number(r.position_salary || 0), Number(r.completion_bonus || 0), Number(r.total_income_agreed || 0), Number(r.insurance_base || 0),
              Number(r.probation_days || 0), Number(r.official_days || 0), Number(r.paid_leave_days || 0), Number(r.unpaid_leave_days || 0), Number(r.work_income || 0),
              Number(r.ot_normal_hours || 0), Number(r.ot_weekend_hours || 0), Number(r.ot_holiday_hours || 0), Number(r.base_hourly_rate || 0), Number(r.ot_total_income || 0),
              Number(r.phone_allowance || 0), Number(r.attire_allowance || 0), Number(r.parking_allowance || 0), Number(r.fuel_allowance || 0), Number(r.business_trip_allowance || 0),
              Number(r.total_allowance || 0), Number(r.total_income_with_allowance || 0), Number(r.total_pretax_income || 0),
              Number(r.insurance_social || 0), Number(r.insurance_health || 0), Number(r.insurance_unemployment || 0),
              Number(r.personal_deduction || 0), Number(r.dependent_deduction || 0), Number(r.dependent_count || 0), Number(r.total_family_deduction || 0),
              Number(r.taxable_income || 0), Number(r.net_income_after_tax || 0), Number(r.tax_withheld || 0),
              Number(r.meal_allowance || 0), Number(r.arrears_deduction || 0), Number(r.arrears_addition || 0), Number(r.transfer_amount || 0),
              existingInv.id
            ).run();
          } else if (!existingInv) {
            const invNum = await nextInvoiceNumber(env, invYear, invMonth);
            await env.DB.prepare(`
              INSERT INTO invoices (
                invoice_number, user_id, month, year,
                base_salary, bonus, allowance, deduction, tax, insurance, net_salary,
                work_days, standard_days, status, note, payroll_id, issued_at, issued_by, issued_by_name,
                position_salary, completion_bonus, total_income_agreed, insurance_base,
                probation_days, official_days, paid_leave_days, unpaid_leave_days, work_income,
                ot_normal_hours, ot_weekend_hours, ot_holiday_hours, base_hourly_rate, ot_total_income,
                phone_allowance, attire_allowance, parking_allowance, fuel_allowance, business_trip_allowance,
                total_allowance, total_income_with_allowance, total_pretax_income,
                insurance_social, insurance_health, insurance_unemployment,
                personal_deduction, dependent_deduction, dependent_count, total_family_deduction,
                taxable_income, net_income_after_tax, tax_withheld,
                meal_allowance, arrears_deduction, arrears_addition, transfer_amount, import_source
              ) VALUES (
                ?,?,?,?,
                ?,?,?,?,?,?,?,
                ?,?,?,?,?,datetime('now','localtime'),?,?,
                ?,?,?,?,
                ?,?,?,?,?,
                ?,?,?,?,?,
                ?,?,?,?,?,
                ?,?,?,
                ?,?,?,
                ?,?,?,?,
                ?,?,?,
                ?,?,?,?,'excel'
              )
            `).bind(
              invNum, employeeId, invMonth, invYear,
              baseSalary, Number(r.kpi_bonus || 0), Number(r.total_allowance || r.allowance || 0),
              Number(r.arrears_deduction || 0), Number(r.tax || 0), Number(r.insurance || 0), netSalary,
              Number(r.work_days || 0), Number(r.standard_days || 23), 'issued', r.notes || '', payrollId, me.id, me.full_name || '',
              Number(r.position_salary || 0), Number(r.completion_bonus || 0), Number(r.total_income_agreed || 0), Number(r.insurance_base || 0),
              Number(r.probation_days || 0), Number(r.official_days || 0), Number(r.paid_leave_days || 0), Number(r.unpaid_leave_days || 0), Number(r.work_income || 0),
              Number(r.ot_normal_hours || 0), Number(r.ot_weekend_hours || 0), Number(r.ot_holiday_hours || 0), Number(r.base_hourly_rate || 0), Number(r.ot_total_income || 0),
              Number(r.phone_allowance || 0), Number(r.attire_allowance || 0), Number(r.parking_allowance || 0), Number(r.fuel_allowance || 0), Number(r.business_trip_allowance || 0),
              Number(r.total_allowance || 0), Number(r.total_income_with_allowance || 0), Number(r.total_pretax_income || 0),
              Number(r.insurance_social || 0), Number(r.insurance_health || 0), Number(r.insurance_unemployment || 0),
              Number(r.personal_deduction || 0), Number(r.dependent_deduction || 0), Number(r.dependent_count || 0), Number(r.total_family_deduction || 0),
              Number(r.taxable_income || 0), Number(r.net_income_after_tax || 0), Number(r.tax_withheld || 0),
              Number(r.meal_allowance || 0), Number(r.arrears_deduction || 0), Number(r.arrears_addition || 0), Number(r.transfer_amount || 0)
            ).run();
          }
        }
      }

      const estimatedTotal = rows.reduce((s, r) => s + Number(r.transfer_amount || r.net_salary || 0), 0);
      await env.DB.prepare(`
        INSERT INTO payroll_batches (month, status, total_employees, complete_employees, missing_employees, estimated_total, created_by, created_by_name, updated_at)
        VALUES (?,'draft',?,?,0,?,?,?,datetime('now','localtime'))
        ON CONFLICT(month) DO UPDATE SET total_employees=excluded.total_employees, complete_employees=excluded.complete_employees, estimated_total=excluded.estimated_total, updated_at=datetime('now','localtime')
      `).bind(month, rows.length, matched, estimatedTotal, me.id, me.full_name || '').run();

      await broadcastAppEvent(env, 'payroll', 'payroll:imported', {
        month,
        total: rows.length,
        created,
        updated,
        matched,
        unmatched: unmatchedCodes.length,
      }, { actorId: me.id });
      await broadcastAppEvent(env, 'invoices', 'invoices:imported', { month }, { actorId: me.id });

      return json({
        ok: true,
        month,
        total: rows.length,
        created,
        updated,
        matched,
        unmatched_codes: unmatchedCodes,
      });
    } catch (importErr) {
      console.error('Lỗi khi lưu import bảng lương:', importErr);
      return json({ error: `Lỗi lưu bảng lương: ${importErr?.message || importErr}` }, 500);
    }
  }

  if (path === '/api/payroll/load' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const batch = await env.DB.prepare('SELECT * FROM payroll_batches WHERE month=?').bind(month).first();
    if (batch && ['locked','paid'].includes(String(batch.status || '').toLowerCase())) {
      return json({ error: 'Bang luong thang nay da khoa, khong the dong bo du lieu.' }, 409);
    }
    const [yearStr, mmStr] = month.split('-');
    const year = Number(yearStr);
    const invMonth = Number(mmStr);
    const { results: users = [] } = await env.DB.prepare(
      'SELECT id,employee_code,full_name,department,salary FROM users WHERE is_active=1 ORDER BY id'
    ).all();
    const existingRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM payroll WHERE month=?').bind(month).first();
    let created = 0, updated = 0, ready = 0, missingSalary = 0, estimatedTotal = 0;
    for (const u of users) {
      const base = Number(u.salary || 0);
      const status = base > 0 ? 'ready' : 'missing_salary_config';
      const warnings = base > 0 ? '' : 'Thiếu cấu hình lương';
      const workSummary = await buildMonthlyWorkSummary(env, u.id, invMonth, year);
      const overtime = await buildMonthlyOvertimeSummary(env, u.id, invMonth, year, base);
      if (base > 0) {
        ready++;
        estimatedTotal += (base + overtime.overtimePay);
      } else {
        missingSalary++;
      }
      const existing = await env.DB.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? LIMIT 1')
        .bind(u.id, month).first();
      if (existing) {
        const kpi = Number(existing.kpi_bonus || 0);
        const allowance = Number(existing.allowance || 0);
        const deduction = Number(existing.deduction || 0);
        const net = base + kpi + allowance + overtime.overtimePay - deduction;
        await env.DB.prepare(
          `UPDATE payroll SET user_id=?,employee_name=?,employee_code=?,department=?,base_salary=?,kpi_bonus=?,allowance=?,deduction=?,overtime_pay=?,approved_overtime_minutes=?,work_days=?,standard_days=?,paid_leave_days=?,absent_days=?,late_days=?,late_minutes=?,early_leave_minutes=?,missing_checkinout_days=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?`
        ).bind(String(me.id), u.full_name || '', u.employee_code || '', u.department || '', base, kpi, allowance, deduction, overtime.overtimePay, overtime.approvedOvertimeMinutes, workSummary.actualWorkDays, workSummary.standardWorkDays, workSummary.paidLeaveDays, workSummary.absentDays, workSummary.lateDays, workSummary.lateMinutes, workSummary.earlyLeaveMinutes, workSummary.incompleteDays, net, status, warnings, existing.id).run();
        updated++;
      } else {
        const net = base + overtime.overtimePay;
        await env.DB.prepare(
          `INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,overtime_pay,approved_overtime_minutes,work_days,standard_days,paid_leave_days,absent_days,late_days,late_minutes,early_leave_minutes,missing_checkinout_days,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`
        ).bind(String(me.id), u.id, u.full_name || '', u.employee_code || '', u.department || '', month, base, 0, 0, 0, overtime.overtimePay, overtime.approvedOvertimeMinutes, workSummary.actualWorkDays, workSummary.standardWorkDays, workSummary.paidLeaveDays, workSummary.absentDays, workSummary.lateDays, workSummary.lateMinutes, workSummary.earlyLeaveMinutes, workSummary.incompleteDays, net, status, warnings).run();
        created++;
      }
    }
    await env.DB.prepare(
      `INSERT INTO payroll_batches (month,status,total_employees,complete_employees,missing_employees,estimated_total,created_by,created_by_name,updated_at)
       VALUES (?,'draft',?,?,?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(month) DO UPDATE SET total_employees=excluded.total_employees,complete_employees=excluded.complete_employees,missing_employees=excluded.missing_employees,estimated_total=excluded.estimated_total,updated_at=datetime('now','localtime')`
    ).bind(month, users.length, ready, missingSalary, estimatedTotal, me.id, me.full_name || '').run();
    await broadcastAppEvent(env, 'payroll', 'payroll:loaded', {
      month,
      total: users.length,
      created,
      updated,
      ready,
      missing: missingSalary,
    }, { actorId: me.id });
    return json({
      ok: true,
      loaded: true,
      month,
      status: 'draft',
      total: users.length,
      existing: Number(existingRow?.c || 0),
      existing_rows: Number(existingRow?.c || 0),
      created,
      updated,
      complete: ready,
      ready,
      missing: missingSalary,
      missing_salary_config: missingSalary,
      estimated_total: estimatedTotal,
      warning: missingSalary > 0 ? 'Cac truong hop thieu cau hinh luong can duoc xu ly truoc khi trinh phe duyet.' : ''
    });
  }
  if (path === '/api/payroll/batch' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const batch = await env.DB.prepare('SELECT * FROM payroll_batches WHERE month=?').bind(month).first();
    if (batch && ['locked','paid'].includes(String(batch.status || '').toLowerCase())) {
      return json({ error: 'Bang luong thang nay da khoa, khong the dong bo du lieu.' }, 409);
    }
    const { results: users = [] } = await env.DB.prepare(
      'SELECT id,employee_code,full_name,department,salary FROM users WHERE is_active=1 ORDER BY id'
    ).all();
    let created = 0, updated = 0, ready = 0, missing = 0, estimatedTotal = 0;
    for (const u of users) {
      const base = Number(u.salary || 0);
      const status = base > 0 ? 'ready' : 'missing_salary_config';
      const warnings = base > 0 ? '' : 'Thiếu cấu hình lương';
      if (base > 0) { ready++; estimatedTotal += base; }
      else missing++;
      const exists = await env.DB.prepare('SELECT id, import_source, net_salary, base_salary, transfer_amount FROM payroll WHERE employee_id=? AND month=? LIMIT 1')
        .bind(u.id, month).first();
      if (exists) {
        if (exists.import_source === 'excel' || Number(exists.transfer_amount || 0) > 0) {
          // BẢO VỆ DỮ LIỆU EXCEL: Giữ nguyên 100% dữ liệu kế toán đã chốt, không ghi đè lương cơ bản
          ready++;
          estimatedTotal += Number(exists.transfer_amount || exists.net_salary || exists.base_salary || 0);
          continue;
        }
        const row = await env.DB.prepare('SELECT kpi_bonus,allowance,deduction FROM payroll WHERE id=?').bind(exists.id).first();
        const kpi = Number(row?.kpi_bonus || 0), allowance = Number(row?.allowance || 0), deduction = Number(row?.deduction || 0);
        await env.DB.prepare(
          "UPDATE payroll SET user_id=?,employee_name=?,employee_code=?,department=?,base_salary=?,net_salary=?,data_status=?,data_warnings=?,import_source='system',source_synced_at=datetime('now','localtime') WHERE id=?"
        ).bind(String(me.id), u.full_name || '', u.employee_code || '', u.department || '', base, base + kpi + allowance - deduction, status, warnings, exists.id).run();
        updated++;
        continue;
      }
      await env.DB.prepare(
        "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,net_salary,data_status,data_warnings,import_source,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'system',datetime('now','localtime'))"
      ).bind(String(me.id), u.id, u.full_name || '', u.employee_code || '', u.department || '', month, base, 0, 0, 0, base, status, warnings).run();
      created++;
    }
    await env.DB.prepare(
      `INSERT INTO payroll_batches (month,status,total_employees,complete_employees,missing_employees,estimated_total,created_by,created_by_name,updated_at)
       VALUES (?,'draft',?,?,?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(month) DO UPDATE SET status='draft',total_employees=excluded.total_employees,complete_employees=excluded.complete_employees,missing_employees=excluded.missing_employees,estimated_total=excluded.estimated_total,updated_at=datetime('now','localtime')`
    ).bind(month, users.length, ready, missing, estimatedTotal, me.id, me.full_name || '').run();
    await broadcastAppEvent(env, 'payroll', 'payroll:batch_synced', {
      month,
      total: users.length,
      created,
      updated,
      ready,
      missing,
    }, { actorId: me.id });
    return json({ ok: true, status: 'draft', created, updated, missing, missing_salary_config: missing, complete: ready, total: users.length, month, estimated_total: estimatedTotal });
  }
  if (path === '/api/payroll/export-payslips' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    if (String(b.confirmText || '').trim().toLowerCase() !== 'xuatphieuluong') {
      return json({ error: 'Can go dung xuatphieuluong de xuat phieu luong' }, 400);
    }
    try {
    const [yearStr, mmStr] = month.split('-');
    const year = Number(yearStr);
    const invMonth = Number(mmStr);
    const { results: allUsers = [] } = await env.DB.prepare(
      'SELECT id, employee_code, full_name, department, position, salary FROM users'
    ).all();
    const userByCode = new Map();
    const userByName = new Map();
    for (const u of allUsers) {
      if (u.employee_code) userByCode.set(String(u.employee_code).trim().toUpperCase(), u);
      if (u.full_name) userByName.set(String(u.full_name).trim().toLowerCase(), u);
    }

    const { results: rows = [] } = await env.DB.prepare(
      `SELECT p.*, u.id AS real_user_id, u.bank_account, u.bank_name
         FROM payroll p
         LEFT JOIN users u ON u.id=p.employee_id
        WHERE p.month=?
        ORDER BY p.id`
    ).bind(month).all();
    let created = 0, updated = 0, skipped = 0;
    const skippedRows = [];
    for (const p of rows) {
      try {
        let employeeId = Number(p.employee_id || p.real_user_id || 0);
        if (!employeeId) {
          const code = String(p.employee_code || '').trim().toUpperCase();
          const name = String(p.employee_name || '').trim().toLowerCase();
          const matched = (code ? userByCode.get(code) : null) || (name ? userByName.get(name) : null);
          if (matched) {
            employeeId = matched.id;
            try {
              await env.DB.prepare('UPDATE payroll SET employee_id=? WHERE id=?').bind(employeeId, p.id).run();
            } catch (_) {}
          }
        }

        const base = Number(p.base_salary || p.total_income_agreed || p.position_salary || 0);
        const effectivePay = Number(p.transfer_amount || p.net_salary || base || 0);
        const status = p.data_status || (effectivePay > 0 ? 'ready' : 'missing_salary_config');

        if (!employeeId) {
          skipped++;
          skippedRows.push({ payroll_id: p.id, employee_id: null, employee_name: p.employee_name || '', reason: 'no_user_account' });
          continue;
        }

        if (status === 'missing_salary_config' && effectivePay <= 0) {
          skipped++;
          skippedRows.push({ payroll_id: p.id, employee_id: employeeId, employee_name: p.employee_name || '', reason: 'missing_salary_config' });
          continue;
        }

        const bonus = Number(p.kpi_bonus || 0);
        const allowance = Number(p.total_allowance || p.allowance || 0);
        const deduction = Number(p.arrears_deduction || p.deduction || 0);
        const isFromExcel = p.import_source === 'excel' || Number(p.transfer_amount || 0) > 0 || Number(p.work_days || 0) > 0;
        let workSummary = null;
        let overtime = { approvedOvertimeMinutes: 0, overtimePay: Number(p.ot_total_income || p.overtime_pay || 0) };
        let actualWorkDays = Number(p.work_days || (Number(p.official_days || 0) + Number(p.probation_days || 0)) || 0);
        let standardWorkDays = Number(p.standard_days || 23);
        let absentDays = Number(p.unpaid_leave_days || 0);
        let paidLeaveDays = Number(p.paid_leave_days || 0);
        let lateDays = 0, lateMinutes = 0, earlyLeaveMinutes = 0, incompleteDays = 0;

        if (!isFromExcel) {
          // Chỉ chạy logic tính ngày công & OT tự động từ hệ thống chấm công nếu KHÔNG PHẢI dữ liệu kế toán import từ Excel
          workSummary = await buildMonthlyWorkSummary(env, employeeId, invMonth, year);
          overtime = await buildMonthlyOvertimeSummary(env, employeeId, invMonth, year, base);
          if (workSummary && workSummary.actualWorkDays > 0) actualWorkDays = workSummary.actualWorkDays;
          if (workSummary?.standardWorkDays) standardWorkDays = workSummary.standardWorkDays;
          if (workSummary && workSummary.absentDays > 0) absentDays = workSummary.absentDays;
          if (workSummary && workSummary.paidLeaveDays > 0) paidLeaveDays = workSummary.paidLeaveDays;
          lateDays = workSummary ? (workSummary.lateDays || 0) : 0;
          lateMinutes = workSummary ? (workSummary.lateMinutes || 0) : 0;
          earlyLeaveMinutes = workSummary ? (workSummary.earlyLeaveMinutes || 0) : 0;
          incompleteDays = workSummary ? (workSummary.incompleteDays || 0) : 0;
        }

        const net = Number(p.transfer_amount || 0) > 0 
          ? Number(p.transfer_amount) 
          : (Number(p.net_salary || 0) > 0 ? Number(p.net_salary) : Number(base + bonus + allowance + overtime.overtimePay - deduction));

        const existing = await env.DB.prepare(
          'SELECT * FROM invoices WHERE payroll_id=? OR (user_id=? AND month=? AND year=?) ORDER BY id DESC LIMIT 1'
        ).bind(p.id, employeeId, invMonth, year).first();

        if (existing && (existing.locked_at || existing.status === 'paid' || existing.status === 'employee_confirmed' || existing.employee_confirmed_at)) {
          skipped++;
          skippedRows.push({ invoice_id: existing.id, payroll_id: p.id, employee_id: employeeId, employee_name: p.employee_name || '', reason: 'locked_or_confirmed' });
          continue;
        }

        if (existing) {
          const fromStatus = existing.status || null;
          await env.DB.prepare(
            `UPDATE invoices SET payroll_id=?,base_salary=?,bonus=?,allowance=?,deduction=?,tax=?,insurance=?,
               approved_overtime_minutes=?,overtime_pay=?,net_salary=?,
               work_days=?,absent_days=?,late_days=?,standard_days=?,paid_leave_days=?,late_minutes=?,early_leave_minutes=?,missing_checkinout_days=?,
               position_salary=?,completion_bonus=?,total_income_agreed=?,insurance_base=?,
               probation_days=?,official_days=?,unpaid_leave_days=?,work_income=?,
               ot_normal_hours=?,ot_weekend_hours=?,ot_holiday_hours=?,base_hourly_rate=?,ot_total_income=?,
               phone_allowance=?,attire_allowance=?,parking_allowance=?,fuel_allowance=?,business_trip_allowance=?,
               total_allowance=?,total_income_with_allowance=?,total_pretax_income=?,
               insurance_social=?,insurance_health=?,insurance_unemployment=?,
               personal_deduction=?,dependent_deduction=?,dependent_count=?,total_family_deduction=?,
               taxable_income=?,net_income_after_tax=?,tax_withheld=?,
               meal_allowance=?,arrears_deduction=?,arrears_addition=?,transfer_amount=?,import_source=?,
               status='issued',issued_at=datetime('now','localtime'),issued_by=?,issued_by_name=?,
               review_resolved_at=CASE WHEN status='review_requested' THEN datetime('now','localtime') ELSE review_resolved_at END,
               review_status=CASE WHEN status='review_requested' THEN 'resolved' ELSE COALESCE(review_status,'none') END,
               review_note=CASE WHEN status='review_requested' THEN 'Reissued from payroll' ELSE review_note END
             WHERE id=?`
          ).bind(
            p.id, base, bonus, allowance, deduction, Number(p.tax || 0), Number(p.insurance || 0),
            overtime.approvedOvertimeMinutes, overtime.overtimePay, net,
            actualWorkDays, absentDays, lateDays, standardWorkDays, paidLeaveDays, lateMinutes, earlyLeaveMinutes, incompleteDays,
            Number(p.position_salary || 0), Number(p.completion_bonus || 0), Number(p.total_income_agreed || 0), Number(p.insurance_base || 0),
            Number(p.probation_days || 0), Number(p.official_days || 0), Number(p.unpaid_leave_days || 0), Number(p.work_income || 0),
            Number(p.ot_normal_hours || 0), Number(p.ot_weekend_hours || 0), Number(p.ot_holiday_hours || 0), Number(p.base_hourly_rate || 0), Number(p.ot_total_income || 0),
            Number(p.phone_allowance || 0), Number(p.attire_allowance || 0), Number(p.parking_allowance || 0), Number(p.fuel_allowance || 0), Number(p.business_trip_allowance || 0),
            Number(p.total_allowance || 0), Number(p.total_income_with_allowance || 0), Number(p.total_pretax_income || 0),
            Number(p.insurance_social || 0), Number(p.insurance_health || 0), Number(p.insurance_unemployment || 0),
            Number(p.personal_deduction || 0), Number(p.dependent_deduction || 0), Number(p.dependent_count || 0), Number(p.total_family_deduction || 0),
            Number(p.taxable_income || 0), Number(p.net_income_after_tax || 0), Number(p.tax_withheld || 0),
            Number(p.meal_allowance || 0), Number(p.arrears_deduction || 0), Number(p.arrears_addition || 0), Number(p.transfer_amount || 0),
            isFromExcel ? 'excel' : 'system', me.id, me.full_name || '', existing.id
          ).run();
          await env.DB.prepare(
            "UPDATE invoice_review_requests SET status='resolved',handled_by=?,handled_by_name=?,handled_note=COALESCE(handled_note,'Reissued from payroll'),handled_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE invoice_id=? AND status='open'"
          ).bind(me.id, me.full_name || '', existing.id).run();
          await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
            .bind(existing.id, fromStatus, 'issued', me.id, me.full_name || '', fromStatus === 'review_requested' ? 'Reissued payslip after review' : 'Reissued payslip from payroll').run();
          updated++;
        } else {
          const invNum = await nextInvoiceNumber(env, year, invMonth);
          const r = await env.DB.prepare(
            `INSERT INTO invoices (
               invoice_number, user_id, month, year, base_salary, bonus, allowance, deduction, tax, insurance,
               approved_overtime_minutes, overtime_pay, net_salary,
               work_days, absent_days, late_days, standard_days, paid_leave_days, late_minutes, early_leave_minutes, missing_checkinout_days,
               position_salary, completion_bonus, total_income_agreed, insurance_base,
               probation_days, official_days, unpaid_leave_days, work_income,
               ot_normal_hours, ot_weekend_hours, ot_holiday_hours, base_hourly_rate, ot_total_income,
               phone_allowance, attire_allowance, parking_allowance, fuel_allowance, business_trip_allowance,
               total_allowance, total_income_with_allowance, total_pretax_income,
               insurance_social, insurance_health, insurance_unemployment,
               personal_deduction, dependent_deduction, dependent_count, total_family_deduction,
               taxable_income, net_income_after_tax, tax_withheld,
               meal_allowance, arrears_deduction, arrears_addition, transfer_amount, import_source,
               status, note, payroll_id, issued_at, issued_by, issued_by_name, review_status
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?, datetime('now','localtime'), ?, ?, 'none'
             )`
          ).bind(
            invNum, employeeId, invMonth, year, base, bonus, allowance, deduction, Number(p.tax || 0), Number(p.insurance || 0),
            overtime.approvedOvertimeMinutes, overtime.overtimePay, net,
            actualWorkDays, absentDays, lateDays, standardWorkDays, paidLeaveDays, lateMinutes, earlyLeaveMinutes, incompleteDays,
            Number(p.position_salary || 0), Number(p.completion_bonus || 0), Number(p.total_income_agreed || 0), Number(p.insurance_base || 0),
            Number(p.probation_days || 0), Number(p.official_days || 0), Number(p.unpaid_leave_days || 0), Number(p.work_income || 0),
            Number(p.ot_normal_hours || 0), Number(p.ot_weekend_hours || 0), Number(p.ot_holiday_hours || 0), Number(p.base_hourly_rate || 0), Number(p.ot_total_income || 0),
            Number(p.phone_allowance || 0), Number(p.attire_allowance || 0), Number(p.parking_allowance || 0), Number(p.fuel_allowance || 0), Number(p.business_trip_allowance || 0),
            Number(p.total_allowance || 0), Number(p.total_income_with_allowance || 0), Number(p.total_pretax_income || 0),
            Number(p.insurance_social || 0), Number(p.insurance_health || 0), Number(p.insurance_unemployment || 0),
            Number(p.personal_deduction || 0), Number(p.dependent_deduction || 0), Number(p.dependent_count || 0), Number(p.total_family_deduction || 0),
            Number(p.taxable_income || 0), Number(p.net_income_after_tax || 0), Number(p.tax_withheld || 0),
            Number(p.meal_allowance || 0), Number(p.arrears_deduction || 0), Number(p.arrears_addition || 0), Number(p.transfer_amount || 0),
            isFromExcel ? 'excel' : 'system',
            'issued', 'Generated from payroll', p.id, me.id, me.full_name || ''
          ).run();
          await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
            .bind(r.meta.last_row_id, null, 'issued', me.id, me.full_name || '', 'Issued payslip from payroll').run();
          created++;
        }
      } catch (e) {
        console.error(`Export payslip failed for payroll_id=${p.id}, emp=${p.employee_name}:`, e);
        skipped++;
        skippedRows.push({ payroll_id: p.id, employee_id: p.employee_id || null, employee_name: p.employee_name || '', reason: 'row_error', error: String(e?.message || e) });
        continue;
      }
    }
    if (rows.length) {
      await env.DB.prepare(
        "UPDATE payroll_batches SET status='issued',updated_at=datetime('now','localtime') WHERE month=?"
      ).bind(month).run();
    }
    await broadcastAppEvent(env, 'payroll', 'payroll:payslips_exported', {
      month,
      total: rows.length,
      created,
      updated,
      skipped,
    }, { actorId: me.id });
    await broadcastAppEvent(env, 'invoices', 'invoices:batch_issued', {
      month,
      created,
      updated,
    }, { actorId: me.id });
    return json({ ok: true, month, total: rows.length, created, updated, skipped, skippedRows });
    } catch (e) {
      console.error('Export payslips failed', e);
      return json({ error: 'Không thể xuất phiếu lương, vui lòng thử lại sau' }, 500);
    }
  }
  if (path === '/api/payroll' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    // Single row creation
    if (b.employee_name && b.month) {
      const net = (b.base_salary||0) + (b.kpi_bonus||0) + (b.allowance||0) + (b.overtime_pay||0) - (b.deduction||0) - (b.tax||0) - (b.insurance||0);
      const dataStatus = Number(b.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
      const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
      const r = await env.DB.prepare(
        "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,overtime_pay,tax,insurance,work_days,standard_days,note,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))"
      ).bind(String(me.id), b.employee_id||null, b.employee_name, b.employee_code||'', b.department||'', b.month, b.base_salary||0, b.kpi_bonus||0, b.allowance||0, b.deduction||0, b.overtime_pay||0, b.tax||0, b.insurance||0, b.work_days||0, b.standard_days||0, b.note||'', net, dataStatus, dataWarnings).run();
      await broadcastAppEvent(env, 'payroll', 'payroll:created', {
        id: r.meta.last_row_id,
        month: b.month,
        employee_name: b.employee_name,
        employee_code: b.employee_code,
        net_salary: net,
      }, { actorId: me.id });
      return json({ ok: true, id: r.meta.last_row_id });
    }
    // Batch creation (legacy)
    if (b.rows && b.month) {
      await env.DB.batch(b.rows.map(r => {
        const net = (r.base_salary||0) + (r.kpi_bonus||0) + (r.allowance||0) - (r.deduction||0);
        const dataStatus = Number(r.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
        const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
        return env.DB.prepare(
          "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))"
        ).bind(String(me.id), r.employee_id||null, r.employee_name||'', r.employee_code||'', r.department||'', b.month, r.base_salary||0, r.kpi_bonus||0, r.allowance||0, r.deduction||0, net, dataStatus, dataWarnings);
      }));
      await broadcastAppEvent(env, 'payroll', 'payroll:batch_created', {
        month: b.month,
        count: b.rows.length,
      }, { actorId: me.id });
      return json({ ok: true });
    }
    return json({ error: 'Thiếu dữ liệu' }, 400);
  }
  const payrollMatch = path.match(/^\/api\/payroll\/(\d+)$/);
  if (payrollMatch) {
    const id = parseInt(payrollMatch[1]);
    if (request.method === 'PUT') {
      if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
      const b = await request.json();
      const current = await env.DB.prepare('SELECT * FROM payroll WHERE id=?').bind(id).first();
      if (!current) return json({ error: 'Không tìm thấy dòng lương' }, 404);
      const lineChanges = Array.isArray(b.line_changes) ? b.line_changes : [];
      if (lineChanges.length) {
        const allowedLines = new Set(['base_salary', 'allowance', 'kpi_bonus', 'insurance', 'tax', 'deduction']);
        const normalized = [];
        for (const raw of lineChanges) {
          const field = String(raw?.field || '');
          const lineLabel = String(raw?.label || '').trim();
          const changeNote = String(raw?.note || '').trim();
          const nextValue = Number(raw?.new_value);
          if (!allowedLines.has(field) || !lineLabel || !changeNote || changeNote.length > 1000 || !Number.isFinite(nextValue) || nextValue < 0) {
            return json({ error: 'Mỗi dòng điều chỉnh phải hợp lệ và có ghi chú' }, 400);
          }
          const beforeValue = Number(current[field] || 0);
          if (beforeValue !== nextValue) normalized.push({ field, lineLabel, changeNote, beforeValue, nextValue });
        }
        if (!normalized.length) return json({ error: 'Không có thay đổi dòng lương để lưu' }, 400);
        const next = { ...current };
        for (const item of normalized) next[item.field] = item.nextValue;
        const net = Number(next.base_salary || 0) + Number(next.kpi_bonus || 0) + Number(next.allowance || 0) + Number(next.overtime_pay || 0) - Number(next.deduction || 0) - Number(next.tax || 0) - Number(next.insurance || 0);
        const dataStatus = Number(next.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
        const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
        await ensurePayrollLineChangeLog(env);
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE payroll SET base_salary=?,kpi_bonus=?,allowance=?,deduction=?,overtime_pay=?,tax=?,insurance=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?"
          ).bind(next.base_salary || 0, next.kpi_bonus || 0, next.allowance || 0, next.deduction || 0, next.overtime_pay || 0, next.tax || 0, next.insurance || 0, net, dataStatus, dataWarnings, id),
          ...normalized.map(item => env.DB.prepare(
            'INSERT INTO payroll_line_change_log (payroll_id,line_key,line_label,before_value,after_value,change_note,changed_by,changed_by_name) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(id, item.field, item.lineLabel, item.beforeValue, item.nextValue, item.changeNote, me.id, me.full_name || '')),
          env.DB.prepare(
            'INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)'
          ).bind(id, me.id, me.full_name || '', `Điều chỉnh ${normalized.length} dòng lương`, JSON.stringify(current), JSON.stringify({ ...next, net_salary: net })),
        ]);
        await broadcastAppEvent(env, 'payroll', 'payroll:updated', {
          id,
          net_salary: net,
          changed_lines: normalized.length,
        }, { actorId: me.id });
        return json({ ok: true, net_salary: net, changed_lines: normalized.length });
      }
      const changeNote = String(b.change_note || '').trim();
      if (!changeNote) return json({ error: 'Vui lòng nhập ghi chú điều chỉnh' }, 400);
      if (changeNote.length > 1000) return json({ error: 'Ghi chú điều chỉnh không được quá 1000 ký tự' }, 400);
      const net = (b.base_salary||0) + (b.kpi_bonus||0) + (b.allowance||0) + (b.overtime_pay||0) - (b.deduction||0) - (b.tax||0) - (b.insurance||0);
      const dataStatus = Number(b.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
      const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
      await env.DB.prepare(
        "UPDATE payroll SET employee_name=?,employee_code=?,department=?,month=?,base_salary=?,kpi_bonus=?,allowance=?,deduction=?,overtime_pay=?,tax=?,insurance=?,work_days=?,standard_days=?,note=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?"
      ).bind(b.employee_name||'', b.employee_code||'', b.department||'', b.month||'', b.base_salary||0, b.kpi_bonus||0, b.allowance||0, b.deduction||0, b.overtime_pay||0, b.tax||0, b.insurance||0, b.work_days||0, b.standard_days||0, b.note||'', net, dataStatus, dataWarnings, id).run();
      await env.DB.prepare(
        'INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)'
      ).bind(id, me.id, me.full_name || '', changeNote, JSON.stringify(current), JSON.stringify({
        base_salary: b.base_salary||0, kpi_bonus: b.kpi_bonus||0, allowance: b.allowance||0,
        deduction: b.deduction||0, overtime_pay: b.overtime_pay||0, tax: b.tax||0,
        insurance: b.insurance||0, work_days: b.work_days||0, standard_days: b.standard_days||0,
        net_salary: net, note: b.note||''
      })).run();
      await broadcastAppEvent(env, 'payroll', 'payroll:updated', {
        id,
        net_salary: net,
      }, { actorId: me.id });
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
      const current = await env.DB.prepare('SELECT * FROM payroll WHERE id=?').bind(id).first();
      if (!current) return json({ error: 'Không tìm thấy dòng lương' }, 404);
      const issued = await env.DB.prepare(
        "SELECT id FROM invoices WHERE payroll_id=? AND (locked_at IS NOT NULL OR status IN ('issued','paid','employee_confirmed') OR employee_confirmed_at IS NOT NULL) LIMIT 1"
      ).bind(id).first();
      if (issued) return json({ error: 'Không thể xóa dòng lương đã phát hành phiếu lương. Hãy xử lý phiếu đã phát hành trước.' }, 409);
      await env.DB.prepare(
        'INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)'
      ).bind(id, me.id, me.full_name || '', 'Xóa dòng lương', JSON.stringify(current), '{}').run();
      await env.DB.prepare('UPDATE payroll_adjustments SET payroll_id=NULL,updated_at=datetime(\'now\',\'localtime\') WHERE payroll_id=?').bind(id).run();
      await env.DB.prepare('DELETE FROM payroll WHERE id=?').bind(id).run();
      await broadcastAppEvent(env, 'payroll', 'payroll:deleted', {
        id,
      }, { actorId: me.id });
      return json({ ok: true });
    }
  }

  return null;
}
