/**
 * HR & Attendance Domain Tools
 * Includes: Payslip, Attendance Summary, Leave Balances, Leave Requests Overview,
 * Draft Requests (Leave, WFH, Correction), Approvals (Approve, Reject, Cancel),
 * and Payroll Review.
 */
import { safeBroadcast, parseRelativeDate, checkRolePermissions } from '../tool-helpers.js';

export const hrAttendanceTools = [
  {
    name: 'get_my_payslip_summary',
    description: 'Tra cứu bảng lương cá nhân, thu nhập thực nhận, chi tiết lương cơ bản, ngày công, thưởng KPI, phụ cấp, giảm trừ/phạt muộn, bảo hiểm và thuế.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần tra cứu dạng YYYY-MM (ví dụ 2026-08)' }
      }
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      if (args.userId && Number(args.userId) !== Number(me.id) && !isPrivileged) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bảo mật thông tin: Bạn chỉ được phép tra cứu bảng lương của chính bản thân mình.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let month = args.month || currentMonth;
      if (/^\d{1,2}$/.test(month)) {
        month = `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
      } else if (!/^\d{4}-\d{2}$/.test(month)) {
        month = currentMonth;
      }

      const targetUserId = me.id;

      // 1. Query payroll table
      const payrollRow = await env.DB.prepare(`
        SELECT * FROM payroll
         WHERE (employee_id = ? OR user_id = ?) AND month = ?
         ORDER BY id DESC LIMIT 1
      `).bind(targetUserId, String(targetUserId), month).first();

      // 2. Query batch status
      const batchRow = await env.DB.prepare(`
        SELECT status, total_employees, complete_employees FROM payroll_batches WHERE month = ? LIMIT 1
      `).bind(month).first();

      // 3. Fallback: Query invoices if payroll row not found
      let invoiceRow = null;
      if (!payrollRow) {
        const [y, m] = month.split('-');
        invoiceRow = await env.DB.prepare(`
          SELECT * FROM invoices WHERE user_id = ? AND month = ? AND year = ? LIMIT 1
        `).bind(targetUserId, parseInt(m), parseInt(y)).first();
      }

      if (!payrollRow && !invoiceRow) {
        return {
          found: false,
          month,
          employeeName: me.full_name,
          employeeCode: me.employee_code || 'NV',
          message: `Không tìm thấy dữ liệu bảng lương tháng ${month} của bạn trên hệ thống. Có thể kỳ lương này chưa được tạo hoặc phòng HCNS chưa khởi tạo dữ liệu.`
        };
      }

      const batchStatus = String(batchRow?.status || (invoiceRow ? 'published' : 'draft')).toLowerCase();
      const isOfficial = ['published', 'locked', 'paid'].includes(batchStatus);

      const baseSalary = Number(payrollRow?.base_salary || invoiceRow?.base_salary || me.salary || 0);
      const workDays = Number(payrollRow?.work_days || 0);
      const standardDays = Number(payrollRow?.standard_days || 22);
      const kpiBonus = Number(payrollRow?.kpi_bonus || invoiceRow?.bonus || 0);
      const allowance = Number(payrollRow?.allowance || payrollRow?.total_allowance || invoiceRow?.allowance || 0);
      const overtimePay = Number(payrollRow?.overtime_pay || payrollRow?.ot_total_income || invoiceRow?.overtime_pay || 0);
      const deduction = Number(payrollRow?.deduction || payrollRow?.arrears_deduction || invoiceRow?.deduction || 0);
      const insurance = Number(payrollRow?.insurance || (Number(payrollRow?.insurance_social || 0) + Number(payrollRow?.insurance_health || 0) + Number(payrollRow?.insurance_unemployment || 0)) || invoiceRow?.insurance || 0);
      const tax = Number(payrollRow?.tax || payrollRow?.tax_withheld || invoiceRow?.tax || 0);
      const netSalary = Number(payrollRow?.net_salary || payrollRow?.transfer_amount || invoiceRow?.net_salary || (baseSalary + kpiBonus + allowance + overtimePay - deduction - insurance - tax));
      const transferStatus = payrollRow?.transfer_status || invoiceRow?.status || (netSalary > 0 && isOfficial ? 'Chờ chuyển khoản' : 'Tạm tính');

      return {
        found: true,
        month,
        employeeName: me.full_name,
        employeeCode: me.employee_code || 'NV',
        department: me.department || 'Chung',
        batchStatus,
        isOfficial,
        statusNote: isOfficial 
          ? 'Bảng lương chính thức đã được Phòng HCNS phê duyệt.' 
          : `Bảng lương tháng ${month} hiện đang ở trạng thái TẠM TÍNH (Draft) và đang được Phòng HCNS xử lý, chưa công bố chính thức.`,
        financialSummary: {
          baseSalaryVnd: baseSalary,
          workDays: `${workDays}/${standardDays}`,
          kpiBonusVnd: kpiBonus,
          allowanceVnd: allowance,
          overtimePayVnd: overtimePay,
          deductionVnd: deduction,
          insuranceVnd: insurance,
          taxVnd: tax,
          netSalaryVnd: netSalary,
          transferStatus
        }
      };
    }
  },
  {
    name: 'get_my_attendance_summary',
    description: 'Tra cứu thống kê chấm công, số ngày làm việc, số lần đi muộn và tiền phạt trong tháng của bản thân.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần tra cứu dạng YYYY-MM (mặc định tháng hiện tại)' }
      }
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = args.month || currentMonth;
      const start = `${month}-01`;
      const end = `${month}-31`;

      let list = [];
      try {
        const rows = await env.DB.prepare(`
          SELECT id, date, checkin_time, checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
            FROM attendance
           WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
             AND date >= ? AND date <= ?
           ORDER BY date ASC
        `).bind(me.id, String(me.id), start, end).all();
        list = (rows.results || []).map(r => ({
          id: r.id,
          date: r.date,
          checkIn: r.checkin_time,
          checkOut: r.checkout_time,
          status: r.status,
          isLate: Number(r.late_minutes) > 0,
          lateMinutes: Number(r.late_minutes || 0),
          note: r.note
        }));
      } catch (err) {
        try {
          const rows = await env.DB.prepare(`
            SELECT id, work_date as date, check_in as checkin_time, check_out as checkout_time, status, COALESCE(late_minutes, 0) as late_minutes, note
              FROM attendance
             WHERE (user_id = ? OR CAST(user_id AS TEXT) = CAST(? AS TEXT))
               AND work_date >= ? AND work_date <= ?
             ORDER BY work_date ASC
          `).bind(me.id, String(me.id), start, end).all();
          list = (rows.results || []).map(r => ({
            id: r.id,
            date: r.date,
            checkIn: r.checkin_time,
            checkOut: r.checkout_time,
            status: r.status,
            isLate: Number(r.late_minutes) > 0,
            lateMinutes: Number(r.late_minutes || 0),
            note: r.note
          }));
        } catch (innerErr) {
          console.error('[get_my_attendance_summary] Error querying attendance:', innerErr);
        }
      }

      const totalWorked = list.filter(r => r.checkIn).length;
      const lateRecords = list.filter(r => r.isLate || Number(r.lateMinutes) > 0);
      const lateCount = lateRecords.length;
      const totalPenaltyVnd = Math.max(0, lateCount - 2) * 20000;

      return {
        month,
        totalDaysWorked: totalWorked,
        lateCount,
        lateFreeCount: Math.min(2, lateCount),
        penaltyCount: Math.max(0, lateCount - 2),
        totalPenaltyVnd,
        lateDetails: lateRecords.map(r => ({
          date: r.date,
          checkIn: r.checkIn,
          lateMinutes: r.lateMinutes,
          note: r.note
        }))
      };
    }
  },
  {
    name: 'get_leave_balance',
    description: 'Tra cứu số ngày phép năm còn lại, hạn mức phép năm của bản thân.',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'Năm tra cứu (mặc định năm hiện tại)' }
      }
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      try {
        const curYear = args.year || new Date().getFullYear();
        const row = await env.DB.prepare(`
          SELECT * FROM leave_balances WHERE user_id = ? AND balance_year = ? LIMIT 1
        `).bind(me.id, curYear).first();

        let usedDays = 0;
        try {
          const usedRow = await env.DB.prepare(`
            SELECT COUNT(*) as used_count
              FROM requests
             WHERE user_id = ? AND status = 'approved' AND (type = 'leave' OR request_type = 'leave')
          `).bind(me.id).first();
          usedDays = Number(usedRow?.used_count || 0);
        } catch (_) {}

        const availableDays = row ? Number(row.available_days || 0) : 12;
        const remainingDays = Math.max(0, availableDays - usedDays);

        return {
          employeeName: me.full_name,
          year: curYear,
          annualLeaveTotal: availableDays,
          annualLeaveUsed: usedDays,
          annualLeaveRemaining: remainingDays,
          note: 'Quy chế công ty: 12 ngày phép/năm (1 ngày/tháng). Nghỉ phép cần duyệt 2 bước (Quản lý -> HCNS).'
        };
      } catch (err) {
        return {
          employeeName: me.full_name,
          year: new Date().getFullYear(),
          annualLeaveTotal: 12,
          annualLeaveUsed: 0,
          annualLeaveRemaining: 12,
          note: 'Tiêu chuẩn phép năm: 12 ngày/năm.'
        };
      }
    }
  },
  {
    name: 'get_leave_requests_overview',
    description: 'Thống kê tổng quan và phân tích dữ liệu các đơn xin nghỉ phép thực tế trong hệ thống: lý do nghỉ phép của mọi người, số lượng theo nhóm lý do, trạng thái duyệt.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng lọc YYYY-MM hoặc all' },
        status: { type: 'string', enum: ['all', 'pending', 'approved', 'rejected'], description: 'Trạng thái đơn' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    execute: async (env, args, me) => {
      let rows = [];
      try {
        let query = `
          SELECT lr.id, lr.start_date, lr.end_date, lr.reason, lr.status, lr.type,
                 COALESCE(u.full_name, 'Nhân sự') as employee_name,
                 u.department, u.employee_code
            FROM leave_requests lr
            LEFT JOIN users u ON (CAST(lr.user_id AS TEXT) = CAST(u.id AS TEXT) OR lr.user_id = u.employee_code OR lr.employee_id = u.id)
           WHERE 1=1
        `;
        const binds = [];
        if (args.status && args.status !== 'all') {
          query += ' AND lr.status = ?';
          binds.push(args.status);
        }
        if (args.month && args.month !== 'all') {
          query += ' AND (lr.start_date LIKE ? OR lr.end_date LIKE ?)';
          binds.push(`${args.month}%`, `${args.month}%`);
        }
        query += ' ORDER BY lr.id DESC LIMIT 300';
        const res = await env.DB.prepare(query).bind(...binds).all();
        rows = res.results || [];
      } catch (err) {
        try {
          let query = `
            SELECT r.id, r.start_date, r.end_date, r.reason, r.status, COALESCE(r.type, r.request_type) as type,
                   COALESCE(u.full_name, 'Nhân sự') as employee_name,
                   u.department, u.employee_code, r.user_id
              FROM requests r
              LEFT JOIN users u ON (CAST(r.user_id AS TEXT) = CAST(u.id AS TEXT) OR r.employee_id = u.id)
             WHERE (r.type = 'leave' OR r.request_type = 'leave')
          `;
          const binds = [];
          if (args.status && args.status !== 'all') {
            query += ' AND r.status = ?';
            binds.push(args.status);
          }
          if (args.month && args.month !== 'all') {
            query += ' AND (r.start_date LIKE ? OR r.end_date LIKE ?)';
            binds.push(`${args.month}%`, `${args.month}%`);
          }
          query += ' ORDER BY r.id DESC LIMIT 300';
          const res = await env.DB.prepare(query).bind(...binds).all();
          rows = res.results || [];
        } catch (_) {}
      }

      if (rows.length === 0) {
        return {
          month: args.month || 'all',
          totalRequests: 0,
          totalCount: 0,
          summary: 'Hệ thống hiện tại chưa ghi nhận đơn xin nghỉ phép nào trong cơ sở dữ liệu.',
          requests: [],
          topLeaveEmployees: [],
          mostLeaveEmployee: null,
          categories: {}
        };
      }

      const calcDays = (start, end) => {
        if (!start) return 1;
        if (!end || end === start) return 1;
        const d1 = new Date(start);
        const d2 = new Date(end);
        const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
        return isNaN(diff) || diff < 1 ? 1 : diff;
      };

      const employeeMap = new Map();
      for (const r of rows) {
        const key = String(r.user_id || r.employee_code || r.employee_name);
        if (!employeeMap.has(key)) {
          employeeMap.set(key, {
            name: r.employee_name || 'Nhân sự',
            employeeCode: r.employee_code || 'NV',
            department: r.department || 'Chung',
            leaveCount: 0,
            totalDays: 0,
            reasons: [],
            statuses: []
          });
        }
        const emp = employeeMap.get(key);
        emp.leaveCount += 1;
        const days = calcDays(r.start_date, r.end_date);
        emp.totalDays += days;
        if (r.reason && !emp.reasons.includes(r.reason)) {
          emp.reasons.push(r.reason);
        }
        if (r.status && !emp.statuses.includes(r.status)) {
          emp.statuses.push(r.status);
        }
      }

      const topLeaveEmployees = Array.from(employeeMap.values())
        .sort((a, b) => b.totalDays - a.totalDays || b.leaveCount - a.leaveCount)
        .map((e, idx) => ({
          rank: idx + 1,
          name: e.name,
          employeeCode: e.employeeCode,
          department: e.department,
          leaveCount: e.leaveCount,
          totalDays: e.totalDays,
          reasonsSummary: e.reasons.slice(0, 3).join('; ')
        }));

      const categories = {
        'Việc gia đình & Việc riêng': [],
        'Nghỉ ốm & Khám chữa bệnh': [],
        'Du lịch, Về quê & Nghỉ ngơi': [],
        'Nghỉ phép năm & Lý do khác': []
      };

      for (const r of rows) {
        const text = String(r.reason || '').toLowerCase();
        const item = {
          id: r.id,
          employee: r.employee_name,
          department: r.department || 'Chung',
          dates: `${r.start_date} → ${r.end_date}`,
          reason: r.reason || 'Nghỉ phép thường',
          status: r.status === 'approved' ? 'Đã duyệt' : (r.status === 'pending' || r.status === 'pending_director') ? 'Chờ duyệt' : 'Từ chối'
        };

        if (/gia đình|việc nhà|việc riêng|con|bố|mẹ|vợ|chồng|cưới|đám|hỷ/i.test(text)) {
          categories['Việc gia đình & Việc riêng'].push(item);
        } else if (/ốm|sốt|bệnh|viện|khám|mệt|sức khỏe|tai nạn|thai/i.test(text)) {
          categories['Nghỉ ốm & Khám chữa bệnh'].push(item);
        } else if (/du lịch|về quê|nghỉ mát|tour|chơi|thăm quê/i.test(text)) {
          categories['Du lịch, Về quê & Nghỉ ngơi'].push(item);
        } else {
          categories['Nghỉ phép năm & Lý do khác'].push(item);
        }
      }

      const statusCounts = {
        approved: rows.filter(r => r.status === 'approved').length,
        pending: rows.filter(r => r.status === 'pending' || r.status === 'pending_director').length,
        rejected: rows.filter(r => r.status === 'rejected').length
      };

      const top1 = topLeaveEmployees[0];
      const monthLabel = args.month && args.month !== 'all' ? `tháng ${args.month}` : 'toàn thời gian';
      let summary = '';
      if (top1) {
        summary = `Trong ${monthLabel}, nhân viên xin nghỉ nhiều nhất là **${top1.name} (Mã NV: ${top1.employeeCode})** thuộc phòng ban **${top1.department}** với tổng cộng **${top1.totalDays} ngày nghỉ** (qua ${top1.leaveCount} đơn). Tổng số đơn xin nghỉ trong kỳ là **${rows.length} đơn**.`;
      } else {
        summary = `Hệ thống hiện tại chưa ghi nhận đơn xin nghỉ phép nào trong ${monthLabel}.`;
      }

      return {
        month: args.month || 'all',
        totalRequests: rows.length,
        totalCount: rows.length,
        totalLeaveEmployees: topLeaveEmployees.length,
        topLeaveEmployees: topLeaveEmployees.slice(0, 10),
        mostLeaveEmployee: top1 || null,
        statusCounts,
        categoriesCount: {
          familyAndPersonal: categories['Việc gia đình & Việc riêng'].length,
          sickAndHealth: categories['Nghỉ ốm & Khám chữa bệnh'].length,
          travelAndHomecoming: categories['Du lịch, Về quê & Nghỉ ngơi'].length,
          annualAndOther: categories['Nghỉ phép năm & Lý do khác'].length
        },
        sampleReasonsByCategory: {
          'Việc gia đình & Việc riêng': categories['Việc gia đình & Việc riêng'].slice(0, 5),
          'Nghỉ ốm & Khám chữa bệnh': categories['Nghỉ ốm & Khám chữa bệnh'].slice(0, 5),
          'Du lịch, Về quê & Nghỉ ngơi': categories['Du lịch, Về quê & Nghỉ ngơi'].slice(0, 5),
          'Nghỉ phép năm & Lý do khác': categories['Nghỉ phép năm & Lý do khác'].slice(0, 5)
        },
        recentRequests: rows.slice(0, 10).map(r => ({
          id: r.id,
          employee: r.employee_name,
          department: r.department,
          reason: r.reason,
          dates: `${r.start_date} → ${r.end_date}`,
          status: r.status
        })),
        requests: rows,
        categories,
        summary
      };
    }
  },
  {
    name: 'create_leave_request_draft',
    description: 'Soạn thảo đơn xin nghỉ phép (tạo thẻ xác nhận Human-in-the-loop để người dùng duyệt trước khi gửi).',
    parameters: {
      type: 'object',
      properties: {
        leaveType: { type: 'string', enum: ['annual', 'unpaid', 'sick', 'maternity'], description: 'Loại nghỉ phép' },
        startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD' },
        reason: { type: 'string', description: 'Lý do xin nghỉ' }
      },
      required: ['startDate', 'endDate', 'reason']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      return {
        isActionCard: true,
        actionType: 'create_leave_request',
        title: 'Xác nhận gửi Đơn xin nghỉ phép',
        payload: {
          leaveType: args.leaveType || 'annual',
          leaveTypeLabel: args.leaveType === 'sick' ? 'Nghỉ ốm' : args.leaveType === 'unpaid' ? 'Nghỉ không lương' : 'Nghỉ phép năm',
          startDate: args.startDate,
          endDate: args.endDate,
          reason: args.reason,
          applicantName: me.full_name,
          applicantId: me.id
        }
      };
    }
  },
  {
    name: 'create_wfh_request_draft',
    description: 'Soạn thảo đơn xin làm việc tại nhà WFH (tạo thẻ xác nhận Human-in-the-loop để người dùng duyệt trước khi gửi).',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Ngày làm việc tại nhà YYYY-MM-DD' },
        shift: { type: 'string', enum: ['full', 'morning', 'afternoon'], description: 'Ca làm việc' },
        reason: { type: 'string', description: 'Lý do xin làm việc tại nhà' }
      },
      required: ['date', 'reason']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const targetDate = parseRelativeDate(args.date, new Date().toISOString().slice(0, 10));
      const shiftMap = { full: 'Cả ngày', morning: 'Ca sáng (08:30 - 12:00)', afternoon: 'Ca chiều (13:30 - 17:00)' };
      const shiftLabel = shiftMap[args.shift] || 'Cả ngày';
      const cleanReason = String(args.reason || 'Làm việc từ xa').trim().slice(0, 500);

      if (args.autoExecute === true) {
        const existing = await env.DB.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').bind(me.id, targetDate).first();
        if (existing) {
          await env.DB.prepare("UPDATE attendance SET work_type = 'wfh', shift = ?, wfh_status = 'pending', wfh_reason = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(args.shift || 'full', cleanReason, existing.id).run();
        } else {
          await env.DB.prepare("INSERT INTO attendance (user_id, date, work_type, shift, registered, status, wfh_status, wfh_reason, created_at) VALUES (?, ?, 'wfh', ?, 1, 'registered', 'pending', ?, datetime('now','localtime'))").bind(me.id, targetDate, args.shift || 'full', cleanReason).run();
        }
        await safeBroadcast(env, 'attendance', 'attendance:wfh_requested', { user_id: me.id, date: targetDate }, { actorId: me.id });
        return {
          executed: true,
          actionType: 'create_wfh_request',
          icon: 'home',
          title: 'Đã nộp đơn làm việc tại nhà (WFH)',
          message: `Đơn xin làm việc tại nhà ngày **${targetDate}** (${shiftLabel}) đã được gửi tới quản lý phê duyệt.`,
          details: [
            { label: 'Ngày làm việc', value: targetDate },
            { label: 'Ca làm việc', value: shiftLabel },
            { label: 'Lý do', value: cleanReason },
            { label: 'Trạng thái', value: 'Chờ duyệt (Pending)' }
          ]
        };
      }

      return {
        isActionCard: true,
        actionType: 'create_wfh_request',
        icon: 'home',
        title: 'Xác nhận nộp đơn làm việc tại nhà (WFH)',
        confirmLabel: 'Xác nhận nộp đơn',
        cancelLabel: 'Hủy bỏ',
        fields: [
          { label: 'Hình thức', value: 'Làm việc tại nhà (WFH)' },
          { label: 'Ngày làm việc', value: targetDate },
          { label: 'Ca làm việc', value: shiftLabel },
          { label: 'Lý do', value: cleanReason }
        ],
        payload: {
          date: targetDate,
          shift: args.shift || 'full',
          reason: cleanReason
        }
      };
    }
  },
  {
    name: 'create_attendance_correction_draft',
    description: 'Soạn thảo đơn giải trình / yêu cầu chỉnh công quên check-in (tạo thẻ xác nhận Human-in-the-loop để người dùng duyệt trước khi gửi).',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Ngày làm việc cần chỉnh công YYYY-MM-DD' },
        actualCheckin: { type: 'string', description: 'Giờ check-in thực tế HH:MM' },
        actualCheckout: { type: 'string', description: 'Giờ check-out thực tế HH:MM' },
        reason: { type: 'string', description: 'Lý do quên check-in hoặc yêu cầu chỉnh công' }
      },
      required: ['date', 'reason']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const targetDate = parseRelativeDate(args.date, new Date().toISOString().slice(0, 10));
      const actualIn = args.actualCheckin || '08:30';
      const actualOut = args.actualCheckout || '17:00';
      const cleanReason = String(args.reason || 'Quên check-in / xin chỉnh công').trim().slice(0, 500);

      if (args.autoExecute === true) {
        const existing = await env.DB.prepare('SELECT id FROM attendance WHERE user_id = ? AND date = ?').bind(me.id, targetDate).first();
        if (existing) {
          await env.DB.prepare("UPDATE attendance SET checkin_requires_review = 1, checkin_review_status = 'pending', checkin_review_note = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?").bind(cleanReason, `Giải trình AI: ${cleanReason}`, existing.id).run();
        } else {
          await env.DB.prepare("INSERT INTO attendance (user_id, date, checkin_time, checkout_time, status, work_hours, checkin_requires_review, checkin_review_status, checkin_review_note, note, created_at) VALUES (?, ?, ?, ?, 'present', 8.5, 1, 'pending', ?, ?, datetime('now','localtime'))").bind(me.id, targetDate, actualIn, actualOut, cleanReason, `Giải trình AI: ${cleanReason}`).run();
        }
        await safeBroadcast(env, 'attendance', 'attendance:correction_requested', { user_id: me.id, date: targetDate }, { actorId: me.id });
        return {
          executed: true,
          actionType: 'create_attendance_correction',
          icon: 'clock3',
          title: 'Đã gửi yêu cầu chỉnh công / giải trình',
          message: `Yêu cầu chỉnh công ngày **${targetDate}** đã được gửi tới quản lý và HCNS để xác nhận.`,
          details: [
            { label: 'Ngày công', value: targetDate },
            { label: 'Giờ check-in đề xuất', value: actualIn },
            { label: 'Giờ check-out đề xuất', value: actualOut },
            { label: 'Lý do giải trình', value: cleanReason }
          ]
        };
      }

      return {
        isActionCard: true,
        actionType: 'create_attendance_correction',
        icon: 'clock3',
        title: 'Xác nhận gửi giải trình / chỉnh công',
        confirmLabel: 'Xác nhận gửi duyệt',
        cancelLabel: 'Hủy bỏ',
        fields: [
          { label: 'Ngày cần chỉnh', value: targetDate },
          { label: 'Giờ check-in đề xuất', value: actualIn },
          { label: 'Giờ check-out đề xuất', value: actualOut },
          { label: 'Lý do giải trình', value: cleanReason }
        ],
        payload: {
          date: targetDate,
          actualCheckin: actualIn,
          actualCheckout: actualOut,
          reason: cleanReason
        }
      };
    }
  },
  {
    name: 'leave_approve',
    description: 'Phê duyệt đơn xin nghỉ phép (dành cho Quản lý / HCNS / Phó TGĐ / Admin).',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'number', description: 'ID của đơn xin nghỉ phép' },
        note: { type: 'string', description: 'Ghi chú phê duyệt' }
      },
      required: ['requestId']
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isHcns && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bạn không có quyền phê duyệt hoặc từ chối đơn xin nghỉ phép này.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isHcns && !isManager) {
        return { error: 'PERMISSION_DENIED', message: 'Chỉ Quản lý, HCNS hoặc Ban Giám đốc mới có quyền duyệt đơn xin nghỉ phép.' };
      }

      const reqRow = await env.DB.prepare(`
        SELECT r.*, u.full_name as user_name, u.department as user_dept, u.employee_code
          FROM requests r
          LEFT JOIN users u ON u.id = r.user_id
         WHERE r.id = ? OR CAST(r.id AS TEXT) = ?
      `).bind(Number(args.requestId), String(args.requestId)).first();

      if (!reqRow) return { error: 'NOT_FOUND', message: `Không tìm thấy đơn xin nghỉ phép #${args.requestId}.` };

      await env.DB.prepare(`
        UPDATE requests
           SET status = 'approved', step1_status = 'approved', step2_status = 'approved',
               updated_at = datetime('now','localtime')
         WHERE id = ?
      `).bind(reqRow.id).run();

      await safeBroadcast(env, 'leave', 'leave:approved', { id: reqRow.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'approve_leave_request',
        icon: 'badgeCheck',
        title: 'Phê duyệt đơn xin nghỉ phép',
        message: `Đã phê duyệt đơn xin nghỉ phép #${reqRow.id} của nhân sự **${reqRow.user_name || 'Nhân viên'}** (${reqRow.employee_code || 'NV'}).`,
        details: [
          { label: 'Mã đơn', value: `#${reqRow.id}` },
          { label: 'Nhân sự', value: reqRow.user_name || 'NV' },
          { label: 'Thời gian', value: `${reqRow.start_date} → ${reqRow.end_date}` },
          { label: 'Trạng thái mới', value: 'Đã duyệt (Approved)' }
        ]
      };
    }
  },
  {
    name: 'leave_reject',
    description: 'Từ chối đơn xin nghỉ phép kèm lý do (dành cho Quản lý / HCNS / Admin).',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'number', description: 'ID của đơn xin nghỉ phép' },
        reason: { type: 'string', description: 'Lý do từ chối' }
      },
      required: ['requestId']
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isHcns && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bạn không có quyền phê duyệt hoặc từ chối đơn xin nghỉ phép này.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const { isAdmin, isHcns, isManager } = checkRolePermissions(me);
      if (!isAdmin && !isHcns && !isManager) {
        return { error: 'PERMISSION_DENIED', message: 'Chỉ Quản lý, HCNS hoặc Ban Giám đốc mới có quyền từ chối đơn xin nghỉ phép.' };
      }

      const reqRow = await env.DB.prepare('SELECT id, user_id FROM requests WHERE id = ?').bind(Number(args.requestId)).first();
      if (!reqRow) return { error: 'NOT_FOUND', message: `Không tìm thấy đơn xin nghỉ phép #${args.requestId}.` };

      const rejectReason = args.reason || 'Từ chối bởi Quản lý qua AI Copilot';
      await env.DB.prepare(`
        UPDATE requests
           SET status = 'rejected', step1_status = 'rejected', step2_status = 'rejected',
               updated_at = datetime('now','localtime')
         WHERE id = ?
      `).bind(reqRow.id).run();

      await safeBroadcast(env, 'leave', 'leave:rejected', { id: reqRow.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'reject_leave_request',
        icon: 'circleX',
        title: 'Từ chối đơn xin nghỉ phép',
        message: `Đã từ chối đơn xin nghỉ phép #${reqRow.id}. Lý do: "${rejectReason}".`,
        details: [
          { label: 'Mã đơn', value: `#${reqRow.id}` },
          { label: 'Lý do từ chối', value: rejectReason }
        ]
      };
    }
  },
  {
    name: 'leave_cancel',
    description: 'Hủy đơn xin nghỉ phép đang chờ duyệt của chính mình.',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'number', description: 'ID của đơn xin nghỉ phép' }
      },
      required: ['requestId']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const reqRow = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(Number(args.requestId)).first();
      if (!reqRow) return { error: 'NOT_FOUND', message: `Không tìm thấy đơn xin nghỉ phép #${args.requestId}.` };

      if (reqRow.user_id !== me.id && reqRow.employee_id !== me.id) {
        return { error: 'PERMISSION_DENIED', message: 'Bạn chỉ có quyền hủy đơn xin nghỉ phép của chính mình.' };
      }
      if (reqRow.status !== 'pending') {
        return { error: 'INVALID_STATUS', message: `Không thể hủy đơn nghỉ phép ở trạng thái "${reqRow.status}". Chỉ có thể hủy đơn đang chờ duyệt.` };
      }

      await env.DB.prepare("UPDATE requests SET status = 'cancelled', updated_at = datetime('now','localtime') WHERE id = ?").bind(reqRow.id).run();
      await safeBroadcast(env, 'leave', 'leave:cancelled', { id: reqRow.id }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'cancel_leave_request',
        icon: 'circleX',
        title: 'Hủy đơn xin nghỉ phép',
        message: `Đã hủy thành công đơn xin nghỉ phép #${reqRow.id} của bạn.`,
        details: [
          { label: 'Mã đơn', value: `#${reqRow.id}` },
          { label: 'Thời gian', value: `${reqRow.start_date} → ${reqRow.end_date}` },
          { label: 'Trạng thái', value: 'Đã hủy (Cancelled)' }
        ]
      };
    }
  },
  {
    name: 'payroll_request_review',
    description: 'Gửi yêu cầu giải trình / kiểm tra lại phiếu lương tháng của bản thân tới HCNS.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần xem lại YYYY-MM' },
        message: { type: 'string', description: 'Nội dung thắc mắc / khiếu nại' }
      },
      required: ['month', 'message']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = args.month || currentMonth;
      const [y, m] = month.split('-');

      const invRow = await env.DB.prepare(`
        SELECT id FROM invoices WHERE user_id = ? AND month = ? AND year = ? LIMIT 1
      `).bind(me.id, parseInt(m), parseInt(y)).first();

      const invoiceId = invRow?.id || 0;
      await env.DB.prepare(`
        INSERT INTO invoice_review_requests (invoice_id, user_id, category, message, requested_amount, status)
        VALUES (?, ?, 'other', ?, ?, 'open')
      `).bind(
        invoiceId,
        me.id,
        args.message || 'Thắc mắc số liệu lương qua AI Copilot',
        Number(args.requestedAmount || 0)
      ).run();

      await safeBroadcast(env, 'payroll', 'payroll:review_requested', { userId: me.id, month }, { actorId: me.id });

      return {
        executed: true,
        actionType: 'request_invoice_review',
        icon: 'banknote',
        title: 'Đã gửi yêu cầu xem lại phiếu lương',
        message: `Yêu cầu phúc tra / giải trình phiếu lương tháng **${month}** đã được gửi tới bộ phận HCNS thành công.`,
        details: [
          { label: 'Kỳ lương', value: `Tháng ${month}` },
          { label: 'Nội dung', value: args.message || 'Được tạo qua Copilot' },
          { label: 'Trạng thái', value: 'Đang chờ HCNS xử lý (Open)' }
        ]
      };
    }
  }
];
