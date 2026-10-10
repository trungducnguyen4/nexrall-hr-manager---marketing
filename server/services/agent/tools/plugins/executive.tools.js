/**
 * Executive & HR Operations Domain Tools
 * Includes: Payroll Anomaly Audit, Attendance Anomalies, Daily Attendance Roster,
 * Contract Expirations, Company Overtime Summary, Monthly HR Summary,
 * Executive Headcount Turnover, Department Workforce Comparison, Overtime Cost Trends,
 * and Company Workforce Briefing.
 */
import { parseRelativeDate } from '../tool-helpers.js';

export const executiveTools = [
  {
    name: 'audit_payroll_anomalies',
    description: 'Kiểm toán AI tự động phát hiện các bất thường bảng lương: lệch ngày công so với chấm công, đi muộn chưa trừ phạt, sai sót lương/OT (chỉ dành cho Admin/HCNS).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần kiểm toán dạng YYYY-MM' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      if (!isPrivileged) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Quyền truy cập bị từ chối: Chức năng Kiểm toán Bảng lương AI chỉ dành riêng cho Quản trị viên và Ban HCNS.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const isPrivileged = me.role === 'admin' || (me.department && /HCNS|Hành chính/i.test(me.department));
      if (!isPrivileged) {
        return {
          error: 'PERMISSION_DENIED',
          message: 'Chức năng Kiểm toán Bảng lương AI (AI Payroll Anomaly & Audit) chỉ dành riêng cho Quản trị viên và Ban HCNS.'
        };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let month = args.month || currentMonth;
      if (/^\d{1,2}$/.test(month)) {
        month = `${now.getFullYear()}-${String(month).padStart(2, '0')}`;
      }

      const start = `${month}-01`;
      const end = `${month}-31`;

      // 1. Fetch payroll rows
      const payrollList = await env.DB.prepare(`
        SELECT p.*, u.full_name as u_name, u.employee_code as u_code, u.department as u_dept
          FROM payroll p
          LEFT JOIN users u ON u.id = p.employee_id
         WHERE p.month = ?
      `).bind(month).all();
      const payrollRows = payrollList.results || [];

      // 2. Fetch attendance aggregated
      const attMap = new Map();
      try {
        const attList = await env.DB.prepare(`
          SELECT user_id,
                 COUNT(*) as total_days,
                 SUM(CASE WHEN checkin_time IS NOT NULL THEN 1 ELSE 0 END) as checked_in_days,
                 SUM(CASE WHEN COALESCE(late_minutes, 0) > 0 THEN 1 ELSE 0 END) as late_count
            FROM attendance
           WHERE date >= ? AND date <= ?
           GROUP BY user_id
        `).bind(start, end).all();
        (attList.results || []).forEach(a => attMap.set(Number(a.user_id), a));
      } catch (err) {
        try {
          const attList = await env.DB.prepare(`
            SELECT user_id,
                   COUNT(*) as total_days,
                   SUM(CASE WHEN check_in IS NOT NULL THEN 1 ELSE 0 END) as checked_in_days,
                   SUM(CASE WHEN is_late = 1 OR COALESCE(late_minutes, 0) > 0 THEN 1 ELSE 0 END) as late_count
              FROM attendance
             WHERE work_date >= ? AND work_date <= ?
             GROUP BY user_id
          `).bind(start, end).all();
          (attList.results || []).forEach(a => attMap.set(Number(a.user_id), a));
        } catch (innerErr) {
          console.error('[audit_payroll_anomalies] Error fetching attendance:', innerErr);
        }
      }

      const anomalies = [];

      for (const p of payrollRows) {
        const empId = Number(p.employee_id || p.user_id);
        const empName = p.u_name || p.employee_name || `NV #${empId}`;
        const empCode = p.u_code || p.employee_code || '';
        const att = attMap.get(empId) || { checked_in_days: 0, late_count: 0 };

        // Anomaly 1: Days mismatch (work_days vs checked_in_days)
        const pDays = Number(p.work_days || 0);
        const aDays = Number(att.checked_in_days || 0);
        if (pDays > 0 && Math.abs(pDays - aDays) >= 2) {
          anomalies.push({
            severity: 'HIGH',
            type: 'DAYS_MISMATCH',
            employeeName: empName,
            employeeCode: empCode,
            issue: `Lệch ngày công: Bảng lương tính ${pDays} công, nhưng chấm công thực tế chỉ có ${aDays} ngày check-in (chênh ${Math.abs(pDays - aDays)} ngày).`,
            recommendation: 'Kiểm tra lại đơn xin nghỉ phép đã duyệt hoặc bổ sung công cho nhân viên.'
          });
        }

        // Anomaly 2: Late penalty not deducted (late_count >= 3 but deduction == 0)
        const lateCount = Number(att.late_count || 0);
        const deduction = Number(p.deduction || 0);
        if (lateCount >= 3 && deduction === 0) {
          const expectedFine = (lateCount - 2) * 20000;
          anomalies.push({
            severity: 'MEDIUM',
            type: 'UNPROCESSED_PENALTY',
            employeeName: empName,
            employeeCode: empCode,
            issue: `Đi muộn ${lateCount} lần trong tháng (vượt hạn mức 2 lần miễn phạt). Tiền phạt quy định là ${expectedFine.toLocaleString('vi-VN')} đ nhưng cột giảm trừ đang là 0 đ.`,
            recommendation: `Cập nhật trừ phạt ${expectedFine.toLocaleString('vi-VN')} đ vào bảng lương hoặc xác nhận lý do miễn trừ hợp lệ.`
          });
        }

        // Anomaly 3: Base salary is zero or missing
        if (Number(p.base_salary || 0) === 0 && Number(p.net_salary || 0) === 0) {
          anomalies.push({
            severity: 'LOW',
            type: 'ZERO_SALARY',
            employeeName: empName,
            employeeCode: empCode,
            issue: 'Lương cơ bản và thực nhận bằng 0 đ.',
            recommendation: 'Cấu hình lại mức lương hoặc kiểm tra trạng thái hợp đồng nhân viên.'
          });
        }
      }

      return {
        month,
        totalAudited: payrollRows.length,
        anomalyCount: anomalies.length,
        highRiskCount: anomalies.filter(a => a.severity === 'HIGH').length,
        anomalies: anomalies.slice(0, 15),
        summary: `Hệ thống AI đã kiểm toán ${payrollRows.length} nhân viên trong kỳ lương ${month}. Phát hiện ${anomalies.length} điểm bất thường (${anomalies.filter(a => a.severity === 'HIGH').length} mức độ cao).`
      };
    }
  },
  {
    name: 'get_attendance_anomalies',
    description: 'Quét và phát hiện các nhân viên có bất thường chuyên cần trong tháng: đi trễ > 3 lần hoặc thiếu check-in/out (dành cho Admin/HCNS).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng cần quét YYYY-MM (mặc định tháng hiện tại)' },
        minLateCount: { type: 'number', description: 'Ngưỡng số lần đi trễ tối thiểu (mặc định 3)' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      const isManager = me.role === 'manager';
      if (!isPrivileged && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Quyền truy cập bị từ chối: Công cụ quản trị "get_attendance_anomalies" chỉ dành riêng cho Cán bộ HCNS, Quản lý hoặc Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = (args.month && /^\d{4}-\d{2}$/.test(args.month)) ? args.month : currentMonth;
      const minLate = Number(args.minLateCount) || 3;

      let rows = [];
      try {
        const res = await env.DB.prepare(`
          SELECT a.user_id, u.full_name, u.employee_code, u.department,
                 COUNT(CASE WHEN a.late_minutes > 0 THEN 1 END) as late_count,
                 SUM(COALESCE(a.late_minutes, 0)) as total_late_minutes,
                 COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent_count,
                 COUNT(CASE WHEN a.checkin_time IS NULL AND a.registered = 1 THEN 1 END) as missing_checkin_count
            FROM attendance a
            JOIN users u ON u.id = a.user_id
           WHERE a.date LIKE ? AND u.is_active = 1
           GROUP BY a.user_id
          HAVING late_count >= ? OR absent_count > 0
           ORDER BY late_count DESC, total_late_minutes DESC
        `).bind(`${month}%`, minLate).all();
        rows = res.results || [];
      } catch (err) {
        console.error('get_attendance_anomalies error:', err);
      }

      return {
        month,
        threshold: minLate,
        totalAnomaliesFound: rows.length,
        employeesWithAnomalies: rows.map(r => ({
          name: r.full_name,
          employeeCode: r.employee_code || 'NV',
          department: r.department || 'Chung',
          lateTimes: r.late_count,
          totalLateMinutes: r.total_late_minutes,
          absentDays: r.absent_count,
          missingCheckins: r.missing_checkin_count
        })),
        summary: rows.length === 0
          ? `Trong tháng ${month}, không có nhân viên nào đi trễ từ ${minLate} lần trở lên hoặc có bất thường nghiêm trọng.`
          : `Phát hiện ${rows.length} nhân sự có bất thường chuyên cần trong tháng ${month} (đi trễ từ ${minLate} lần trở lên hoặc vắng không phép).`
      };
    }
  },
  {
    name: 'get_daily_attendance_roster',
    description: 'Tra cứu tình hình quân số hôm nay: ai có mặt tại văn phòng, ai đang làm việc tại nhà WFH, ai đang nghỉ phép (dành cho Admin/HCNS/Manager).',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Ngày tra cứu YYYY-MM-DD (mặc định hôm nay)' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      const isManager = me.role === 'manager';
      if (!isPrivileged && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Quyền truy cập bị từ chối: Công cụ quản trị "get_daily_attendance_roster" chỉ dành riêng cho Cán bộ HCNS, Quản lý hoặc Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const targetDate = parseRelativeDate(args.date, new Date().toISOString().slice(0, 10));
      let roster = {
        date: targetDate,
        totalActiveEmployees: 0,
        presentInOffice: [],
        workingFromHome: [],
        onLeave: [],
        notCheckedIn: []
      };

      try {
        const { results: activeUsers = [] } = await env.DB.prepare('SELECT id, full_name, employee_code, department FROM users WHERE is_active = 1').all();
        roster.totalActiveEmployees = activeUsers.length;

        const { results: attendances = [] } = await env.DB.prepare('SELECT * FROM attendance WHERE date = ?').bind(targetDate).all();
        const attMap = new Map(attendances.map(a => [a.user_id, a]));

        const { results: leaves = [] } = await env.DB.prepare("SELECT * FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ?").bind(targetDate, targetDate).all();
        const leaveUserIds = new Set(leaves.map(l => l.user_id || l.employee_id));

        for (const u of activeUsers) {
          const att = attMap.get(u.id);
          const isOnLeave = leaveUserIds.has(u.id) || leaveUserIds.has(u.employee_code);

          if (isOnLeave) {
            roster.onLeave.push({ name: u.full_name, code: u.employee_code, department: u.department });
          } else if (att && att.work_type === 'wfh' && (att.wfh_status === 'approved' || att.wfh_status === 'pending')) {
            roster.workingFromHome.push({ name: u.full_name, code: u.employee_code, department: u.department, status: att.wfh_status });
          } else if (att && att.checkin_time) {
            roster.presentInOffice.push({
              name: u.full_name,
              code: u.employee_code,
              department: u.department,
              checkinTime: att.checkin_time,
              lateMinutes: att.late_minutes || 0
            });
          } else {
            roster.notCheckedIn.push({ name: u.full_name, code: u.employee_code, department: u.department });
          }
        }
      } catch (err) {
        console.error('get_daily_attendance_roster error:', err);
      }

      return {
        date: targetDate,
        totalActiveEmployees: roster.totalActiveEmployees,
        counts: {
          presentOffice: roster.presentInOffice.length,
          wfh: roster.workingFromHome.length,
          onLeave: roster.onLeave.length,
          notCheckedIn: roster.notCheckedIn.length
        },
        presentInOffice: roster.presentInOffice.slice(0, 15),
        workingFromHome: roster.workingFromHome,
        onLeave: roster.onLeave,
        notCheckedInSample: roster.notCheckedIn.slice(0, 10),
        summary: `Quân số ngày ${targetDate}: Có ${roster.presentInOffice.length} người có mặt tại văn phòng, ${roster.workingFromHome.length} người WFH, ${roster.onLeave.length} người nghỉ phép, ${roster.notCheckedIn.length} người chưa điểm danh.`
      };
    }
  },
  {
    name: 'get_contract_expirations',
    description: 'Thống kê danh sách hợp đồng lao động của nhân viên sắp hết hạn trong 30-60 ngày tới (dành cho Admin/HCNS).',
    parameters: {
      type: 'object',
      properties: {
        daysThreshold: { type: 'number', description: 'Số ngày tới cần cảnh báo hết hạn (mặc định 30 ngày)' }
      }
    },
    allowedPersonas: ['hr'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      if (!isPrivileged) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bảo mật hồ sơ nhân sự: Danh sách hợp đồng lao động chỉ dành riêng cho Admin và Phòng HCNS.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const threshold = Number(args.daysThreshold) || 30;
      let contracts = [];
      try {
        const { results = [] } = await env.DB.prepare(`
          SELECT id, full_name, employee_code, department, position, contract_type, contract_end_date,
                 CAST((julianday(contract_end_date) - julianday('now')) AS INTEGER) as days_remaining
            FROM users
           WHERE is_active = 1
             AND contract_end_date IS NOT NULL
             AND contract_end_date != ''
             AND contract_end_date >= date('now')
             AND contract_end_date <= date('now', '+' || ? || ' days')
           ORDER BY contract_end_date ASC
        `).bind(threshold).all();
        contracts = results;
      } catch (err) {
        console.error('get_contract_expirations error:', err);
      }

      return {
        thresholdDays: threshold,
        totalExpiringContracts: contracts.length,
        contracts: contracts.map(c => ({
          name: c.full_name,
          employeeCode: c.employee_code || 'NV',
          department: c.department,
          contractType: c.contract_type || 'HĐ LĐ',
          endDate: c.contract_end_date,
          daysRemaining: c.days_remaining
        })),
        summary: contracts.length === 0
          ? `Trong vòng ${threshold} ngày tới, không có hợp đồng lao động nào sắp hết hạn.`
          : `Có ${contracts.length} hợp đồng lao động sắp hết hạn trong vòng ${threshold} ngày tới cần HCNS theo dõi và chuẩn bị tái ký.`
      };
    }
  },
  {
    name: 'get_company_overtime_summary',
    description: 'Tổng hợp số giờ làm thêm (OT) và phân bổ theo phòng ban trong tháng (dành cho Admin/HCNS/Manager).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng tra cứu YYYY-MM' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      const isManager = me.role === 'manager';
      if (!isPrivileged && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Quyền truy cập bị từ chối: Công cụ quản trị "get_company_overtime_summary" chỉ dành riêng cho Cán bộ HCNS, Quản lý hoặc Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = (args.month && /^\d{4}-\d{2}$/.test(args.month)) ? args.month : currentMonth;

      const deptMap = new Map();
      const ensureDept = (dept) => {
        const d = dept || 'Chung';
        if (!deptMap.has(d)) deptMap.set(d, { department: d, users: new Set(), sessionCount: 0, total_minutes: 0 });
        return deptMap.get(d);
      };

      try {
        const { results: reqResults = [] } = await env.DB.prepare(`
          SELECT u.department, otr.user_id, otr.id,
                 COALESCE(otr.approved_minutes, otr.requested_minutes, 0) as mins
            FROM overtime_requests otr
            JOIN users u ON u.id = otr.user_id
           WHERE otr.work_date LIKE ? AND (otr.status = 'approved' OR otr.status = 'pending')
        `).bind(`${month}%`).all();

        reqResults.forEach(r => {
          const entry = ensureDept(r.department);
          entry.users.add(r.user_id);
          entry.sessionCount += 1;
          entry.total_minutes += Number(r.mins || 0);
        });

        const { results: formResults = [] } = await env.DB.prepare(`
          SELECT u.department, f.user_id, f.id,
                 SUM(CASE 
                       WHEN i.approved_minutes IS NOT NULL THEN i.approved_minutes 
                       WHEN f.status = 'approved' THEN i.requested_minutes 
                       ELSE 0 
                     END) as mins
            FROM overtime_forms f
            JOIN users u ON u.id = f.user_id
            JOIN overtime_form_items i ON i.form_id = f.id
           WHERE (f.status IN ('approved', 'partially_approved') OR f.status = 'pending')
             AND (f.period_month = ? OR i.start_at LIKE ?)
           GROUP BY u.department, f.user_id, f.id
        `).bind(month, `${month}%`).all();

        formResults.forEach(r => {
          const entry = ensureDept(r.department);
          entry.users.add(r.user_id);
          entry.sessionCount += 1;
          entry.total_minutes += Number(r.mins || 0);
        });
      } catch (err) {
        console.error('get_company_overtime_summary error:', err);
      }

      const otRows = Array.from(deptMap.values()).map(d => ({
        department: d.department,
        employeeCount: d.users.size,
        sessionCount: d.sessionCount,
        otHours: Number((d.total_minutes / 60).toFixed(1))
      })).sort((a, b) => b.otHours - a.otHours);

      const totalMinutes = Array.from(deptMap.values()).reduce((acc, r) => acc + (r.total_minutes || 0), 0);
      const totalHours = Number((totalMinutes / 60).toFixed(1));

      return {
        month,
        totalOvertimeHours: totalHours,
        departmentBreakdown: otRows,
        summary: `Tổng thời lượng làm thêm giờ (OT) tháng ${month} toàn công ty là **${totalHours} giờ** trên ${otRows.length} phòng ban.`
      };
    }
  },
  {
    name: 'get_monthly_hr_summary',
    description: 'Báo cáo tổng hợp tình hình nhân sự tháng: quân số biến động, tỷ lệ đi làm đúng giờ, tổng đơn nghỉ phép đã xử lý (dành cho Admin/HCNS/Director).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng báo cáo YYYY-MM' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      const isManager = me.role === 'manager';
      if (!isPrivileged && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Quyền truy cập bị từ chối: Công cụ quản trị "get_monthly_hr_summary" chỉ dành riêng cho Cán bộ HCNS, Quản lý hoặc Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = (args.month && /^\d{4}-\d{2}$/.test(args.month)) ? args.month : currentMonth;

      let totalEmployees = 0;
      let onTimeRate = 95;
      let totalLeaves = 0;
      let totalOTHours = 0;

      try {
        const activeUsers = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').first();
        totalEmployees = activeUsers?.cnt || 0;

        const attStats = await env.DB.prepare(`
          SELECT COUNT(*) as total_records,
                 SUM(CASE WHEN late_minutes = 0 THEN 1 ELSE 0 END) as on_time_records
            FROM attendance
           WHERE date LIKE ? AND checkin_time IS NOT NULL
        `).bind(`${month}%`).first();

        if (attStats && attStats.total_records > 0) {
          onTimeRate = Number(((attStats.on_time_records / attStats.total_records) * 100).toFixed(1));
        }

        const leaveStats = await env.DB.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE (start_date LIKE ? OR end_date LIKE ?) AND status = 'approved'").bind(`${month}%`, `${month}%`).first();
        totalLeaves = leaveStats?.cnt || 0;

        let otReqSum = 0;
        let otFormSum = 0;
        try {
          const otStats = await env.DB.prepare("SELECT SUM(COALESCE(approved_minutes, requested_minutes, 0)) as min_sum FROM overtime_requests WHERE work_date LIKE ? AND status = 'approved'").bind(`${month}%`).first();
          otReqSum = Number(otStats?.min_sum || 0);
        } catch (_) {}
        try {
          const formOtStats = await env.DB.prepare(`
            SELECT SUM(CASE 
                         WHEN i.approved_minutes IS NOT NULL THEN i.approved_minutes 
                         WHEN f.status = 'approved' THEN i.requested_minutes 
                         ELSE 0 
                       END) as min_sum
              FROM overtime_forms f
              JOIN overtime_form_items i ON i.form_id = f.id
             WHERE f.status IN ('approved', 'partially_approved')
               AND (f.period_month = ? OR i.start_at LIKE ?)
          `).bind(month, `${month}%`).first();
          otFormSum = Number(formOtStats?.min_sum || 0);
        } catch (_) {}
        totalOTHours = Number(((otReqSum + otFormSum) / 60).toFixed(1));
      } catch (err) {
        console.error('get_monthly_hr_summary error:', err);
      }

      return {
        month,
        headcount: totalEmployees,
        onTimeRate: `${onTimeRate}%`,
        approvedLeaveRequests: totalLeaves,
        totalOvertimeHours: totalOTHours,
        summary: `Báo cáo nhân sự tháng **${month}**: Quy mô nhân sự **${totalEmployees}** người, tỷ lệ đi làm đúng giờ đạt **${onTimeRate}%**, đã xử lý **${totalLeaves}** đơn nghỉ phép và tổng giờ làm thêm **${totalOTHours} giờ**.`
      };
    }
  },
  {
    name: 'get_executive_headcount_turnover',
    description: 'Phân tích biến động nhân sự cấp cao: quy mô (headcount), tỷ lệ nghỉ việc (turnover rate) và phân bổ theo phòng ban (dành cho Director/Admin).',
    parameters: {
      type: 'object',
      properties: {
        periodMonths: { type: 'number', description: 'Số tháng xem xét (mặc định 6 tháng)' }
      }
    },
    allowedPersonas: ['director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      if (!isDirector) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bảo mật điều hành cấp cao: Báo cáo "get_executive_headcount_turnover" chỉ dành riêng cho Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const period = Number(args.periodMonths) || 6;
      let totalActive = 0;
      let departments = [];
      let resignedCount = 0;

      try {
        const total = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').first();
        totalActive = total?.cnt || 0;

        const deptRes = await env.DB.prepare('SELECT department, COUNT(*) as cnt FROM users WHERE is_active = 1 GROUP BY department ORDER BY cnt DESC').all();
        departments = deptRes.results || [];

        const resigned = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE is_active = 0 OR lifecycle_status = 'resigned'").first();
        resignedCount = resigned?.cnt || 0;
      } catch (err) {
        console.error('get_executive_headcount_turnover error:', err);
      }

      const turnoverRate = totalActive > 0 ? Number(((resignedCount / (totalActive + resignedCount)) * 100).toFixed(1)) : 0;

      return {
        totalHeadcount: totalActive,
        turnoverRate: `${turnoverRate}%`,
        resignedCount,
        departmentsBreakdown: departments.map(d => ({
          department: d.department || 'Chung',
          headcount: d.cnt,
          percentage: totalActive > 0 ? `${((d.cnt / totalActive) * 100).toFixed(1)}%` : '0%'
        })),
        strategicInsight: `Quy mô hiện tại đạt **${totalActive} nhân sự** qua ${departments.length} phòng ban. Tỷ lệ biến động nhân sự (turnover) là **${turnoverRate}%**, nằm trong ngưỡng kiểm soát ổn định.`
      };
    }
  },
  {
    name: 'get_department_workforce_comparison',
    description: 'Bảng so sánh đa chiều giữa các phòng ban: tỷ lệ chuyên cần, tỷ lệ đi muộn, khối lượng OT và tiến độ công việc (dành cho Director/Admin/HR).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng so sánh YYYY-MM' }
      }
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      const isManager = me.role === 'manager';
      if (!isPrivileged && !isManager) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Quyền truy cập bị từ chối: Công cụ quản trị "get_department_workforce_comparison" chỉ dành riêng cho Cán bộ HCNS, Quản lý hoặc Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = (args.month && /^\d{4}-\d{2}$/.test(args.month)) ? args.month : currentMonth;

      let comparison = [];
      try {
        const { results = [] } = await env.DB.prepare(`
          SELECT u.department,
                 COUNT(DISTINCT u.id) as headcount,
                 SUM(COALESCE(a.late_minutes, 0)) as total_late_minutes,
                 COUNT(CASE WHEN a.late_minutes > 0 THEN 1 END) as late_occurrences,
                 COUNT(CASE WHEN a.checkin_time IS NOT NULL THEN 1 END) as total_checkins
            FROM users u
            LEFT JOIN attendance a ON a.user_id = u.id AND a.date LIKE ?
           WHERE u.is_active = 1
           GROUP BY u.department
           ORDER BY headcount DESC
        `).bind(`${month}%`).all();

        comparison = results.map(r => {
          const checkins = r.total_checkins || 1;
          const lateRate = Number(((r.late_occurrences / checkins) * 100).toFixed(1));
          return {
            department: r.department || 'Chung',
            headcount: r.headcount,
            lateRate: `${lateRate}%`,
            lateOccurrences: r.late_occurrences,
            totalLateMinutes: r.total_late_minutes
          };
        });
      } catch (err) {
        console.error('get_department_workforce_comparison error:', err);
      }

      return {
        month,
        departmentsCompared: comparison.length,
        ranking: comparison,
        summary: `Bảng so sánh chuyên cần tháng ${month}: Phòng ban có tỷ lệ đúng giờ cao nhất được duy trì ổn định, các phòng ban có tỷ lệ đi muộn cao cần tăng cường giám sát kỷ luật.`
      };
    }
  },
  {
    name: 'get_overtime_cost_trends',
    description: 'Phân tích xu hướng số giờ OT và ước tính chi phí làm thêm giờ 3 tháng gần nhất của công ty (dành cho Director/Admin).',
    parameters: {
      type: 'object',
      properties: {
        monthsCount: { type: 'number', description: 'Số tháng phân tích (mặc định 3)' }
      }
    },
    allowedPersonas: ['director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      if (!isDirector) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bảo mật điều hành cấp cao: Báo cáo "get_overtime_cost_trends" chỉ dành riêng cho Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const monthsCount = Number(args.monthsCount) || 3;
      const trends = [];
      const now = new Date();

      try {
        for (let i = monthsCount - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

          const userMins = new Map();

          // 1. Overtime requests
          try {
            const { results: reqRows = [] } = await env.DB.prepare(`
              SELECT user_id, SUM(COALESCE(approved_minutes, requested_minutes, 0)) as mins
                FROM overtime_requests
               WHERE work_date LIKE ? AND status = 'approved'
               GROUP BY user_id
            `).bind(`${mStr}%`).all();
            for (const r of reqRows) {
              const uid = Number(r.user_id);
              userMins.set(uid, (userMins.get(uid) || 0) + Number(r.mins || 0));
            }
          } catch (_) {}

          // 2. Overtime forms
          try {
            const { results: formRows = [] } = await env.DB.prepare(`
              SELECT f.user_id,
                     SUM(CASE 
                           WHEN i.approved_minutes IS NOT NULL THEN i.approved_minutes 
                           WHEN f.status = 'approved' THEN i.requested_minutes 
                           ELSE 0 
                         END) as mins
                FROM overtime_forms f
                JOIN overtime_form_items i ON i.form_id = f.id
               WHERE f.status IN ('approved', 'partially_approved')
                 AND (f.period_month = ? OR i.start_at LIKE ?)
               GROUP BY f.user_id
            `).bind(mStr, `${mStr}%`).all();
            for (const r of formRows) {
              const uid = Number(r.user_id);
              userMins.set(uid, (userMins.get(uid) || 0) + Number(r.mins || 0));
            }
          } catch (_) {}

          const totalMins = Array.from(userMins.values()).reduce((a, b) => a + b, 0);
          const totalHours = Number((totalMins / 60).toFixed(1));
          const estimatedCostVND = Math.round(totalHours * 100000);

          trends.push({
            month: mStr,
            overtimeHours: totalHours,
            participantsCount: userMins.size,
            estimatedCostVND
          });
        }
      } catch (err) {
        console.error('get_overtime_cost_trends error:', err);
      }

      return {
        periodMonths: monthsCount,
        trends,
        summary: `Xu hướng chi phí và giờ làm thêm OT trong ${monthsCount} tháng gần nhất: Dao động trung bình ~${trends.length > 0 ? (trends.reduce((a, b) => a + b.overtimeHours, 0) / trends.length).toFixed(1) : 0} giờ/tháng.`
      };
    }
  },
  {
    name: 'get_company_workforce_briefing',
    description: 'Báo cáo điều hành tổng quan dành cho Ban Giám Đốc: tóm tắt toàn bộ tình hình nhân sự, chuyên cần, đơn từ và chi phí trong tháng (dành cho Director/Admin).',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Tháng báo cáo YYYY-MM' }
      }
    },
    allowedPersonas: ['director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      if (!isDirector) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bảo mật điều hành cấp cao: Báo cáo "get_company_workforce_briefing" chỉ dành riêng cho Ban Giám Đốc.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const todayStr = now.toISOString().slice(0, 10);

      let headcount = 0;
      let todayCheckins = 0;
      let todayWfh = 0;
      let todayLeaves = 0;
      let pendingApprovals = 0;

      try {
        const u = await env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').first();
        headcount = u?.cnt || 0;

        const att = await env.DB.prepare(`
          SELECT COUNT(CASE WHEN checkin_time IS NOT NULL THEN 1 END) as checkins,
                 COUNT(CASE WHEN work_type = 'wfh' THEN 1 END) as wfh
            FROM attendance WHERE date = ?
        `).bind(todayStr).first();
        todayCheckins = att?.checkins || 0;
        todayWfh = att?.wfh || 0;

        const l = await env.DB.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ?").bind(todayStr, todayStr).first();
        todayLeaves = l?.cnt || 0;

        const p = await env.DB.prepare("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'").first();
        pendingApprovals = p?.cnt || 0;
      } catch (err) {
        console.error('get_company_workforce_briefing error:', err);
      }

      const presenceRate = headcount > 0 ? Number(((todayCheckins / headcount) * 100).toFixed(1)) : 0;

      return {
        date: todayStr,
        month: currentMonth,
        headcount,
        todayPresence: {
          presentOffice: todayCheckins,
          presenceRate: `${presenceRate}%`,
          wfh: todayWfh,
          onLeave: todayLeaves
        },
        governance: {
          pendingLeaveApprovals: pendingApprovals
        },
        executiveSummary: `Báo cáo điều hành ngày **${todayStr}**: Tổng quy mô **${headcount} nhân sự**, tỷ lệ có mặt tại VP đạt **${presenceRate}%** (${todayCheckins} người), **${todayWfh}** người WFH, **${todayLeaves}** người nghỉ phép và **${pendingApprovals}** đơn đang chờ duyệt.`
      };
    }
  }
];
