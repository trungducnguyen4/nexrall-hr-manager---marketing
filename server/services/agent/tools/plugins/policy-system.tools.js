/**
 * Policy & System Domain Tools
 * Includes: Policy Knowledge RAG Search, Employee Directory Search,
 * Internal Announcements (Summary & Post), Employee Code Update,
 * and System Module Information Guide.
 */
import { hybridSearch } from '../../../rag.service.js';
import { findEmployeeSmart } from '../../directory/employee-matcher.js';
import { safeBroadcast, resolveUser, checkRolePermissions } from '../tool-helpers.js';

export const policySystemTools = [
  {
    name: 'search_policy_knowledge',
    description: 'Tra cứu nội quy lao động, quy định đi muộn, chế độ nghỉ phép, quy trình duyệt đơn và bảo mật công ty.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nội dung hoặc câu hỏi cần tra cứu' },
        category: { type: 'string', enum: ['hr_policy', 'security', 'handbook'], description: 'Danh mục tài liệu' }
      },
      required: ['query']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const { query, category } = args;
      const ragRes = await hybridSearch(env, { query, category, limit: 3 });
      return {
        query,
        chunksFound: ragRes.results.length,
        citations: ragRes.citations,
        contextText: ragRes.contextText
      };
    }
  },
  {
    name: 'search_employee_directory',
    description: 'Tra cứu thông tin đồng nghiệp: họ tên, mã nhân viên, phòng ban, chức vụ, email.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Tên hoặc mã nhân viên cần tìm' }
      },
      required: ['search']
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const isDirector = me.role === 'admin' || me.role === 'director' || me.role === 'manager_director' || me.employee_code === 'BGD-01' || me.employee_code === 'BGD-02' || Boolean(me.isDirectorHau) || (me.department && /giám đốc|ban giám đốc/i.test(me.department));
      const isPrivileged = me.role === 'admin' || isDirector || (me.department && /HCNS|Hành chính/i.test(me.department));
      if (!isPrivileged) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Bảo mật hồ sơ nhân sự: Tra cứu thông tin nhân sự chỉ dành riêng cho Quản trị viên, Ban Giám Đốc và Phòng HCNS.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const match = await findEmployeeSmart(env, args.search);
      if (match.found) {
        if (match.multiple) {
          return { count: match.candidates.length, employees: match.candidates, note: match.note };
        }
        return { count: 1, employees: [match.employee], note: match.note };
      }
      const kw = `%${String(args.search || '').trim()}%`;
      const { results = [] } = await env.DB.prepare(`
        SELECT id, employee_code, full_name, department, position, email, phone
          FROM users
         WHERE is_active = 1 AND (full_name LIKE ? OR employee_code LIKE ? OR department LIKE ?)
         LIMIT 5
      `).bind(kw, kw, kw).all();
      return { count: results.length, employees: results };
    }
  },
  {
    name: 'announcement_post',
    description: 'Đăng thông báo nội bộ mới (dành cho Admin / HCNS).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tiêu đề thông báo' },
        content: { type: 'string', description: 'Nội dung thông báo' },
        priority: { type: 'string', enum: ['normal', 'important'], description: 'Mức độ quan trọng' },
        targetScope: { type: 'string', enum: ['all', 'department'], description: 'Phạm vi gửi' },
        targetDepartment: { type: 'string', description: 'Phòng ban nhận thông báo nếu scope là department' }
      },
      required: ['title', 'content']
    },
    allowedPersonas: ['hr', 'director'],
    authorize: (args, me) => {
      const { isAdmin, isHcns } = checkRolePermissions(me);
      if (!isAdmin && !isHcns) {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Chỉ Quản trị viên và HCNS mới có quyền đăng thông báo nội bộ.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const { isAdmin, isHcns } = checkRolePermissions(me);
      if (!isAdmin && !isHcns) {
        return { error: 'PERMISSION_DENIED', message: 'Chỉ Quản trị viên và HCNS mới có quyền đăng thông báo nội bộ.' };
      }

      if (args.autoExecute === true) {
        const res = await env.DB.prepare(`
          INSERT INTO announcements (title, content, priority, target_scope, target_department, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          args.title,
          args.content || args.title,
          args.priority || 'normal',
          args.targetScope || 'all',
          args.targetDepartment || null,
          me.id
        ).run();
        const newId = res.meta?.last_row_id;
        await safeBroadcast(env, 'announcements', 'announcement:new', { id: newId, title: args.title }, { actorId: me.id });

        return {
          executed: true,
          actionType: 'post_announcement',
          icon: 'megaphone',
          title: 'Đã đăng thông báo mới',
          message: `Thông báo **"${args.title}"** đã được đăng tải thành công tới toàn hệ thống.`,
          details: [
            { label: 'Mã thông báo', value: `#${newId}` },
            { label: 'Tiêu đề', value: args.title },
            { label: 'Phạm vi', value: args.targetScope === 'department' ? `Phòng ${args.targetDepartment}` : 'Toàn công ty' }
          ]
        };
      }

      return {
        isActionCard: true,
        actionType: 'post_announcement',
        icon: 'megaphone',
        title: 'Xác nhận đăng thông báo nội bộ',
        confirmLabel: 'Xác nhận đăng ngay',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Tiêu đề', value: args.title },
          { label: 'Nội dung tóm tắt', value: (args.content || args.title).slice(0, 150) },
          { label: 'Phạm vi gửi', value: args.targetScope === 'department' ? `Phòng ${args.targetDepartment}` : 'Toàn công ty' },
          { label: 'Mức độ', value: args.priority === 'important' ? 'Quan trọng' : 'Bình thường' }
        ],
        payload: {
          title: args.title,
          content: args.content || args.title,
          priority: args.priority || 'normal',
          targetScope: args.targetScope || 'all',
          targetDepartment: args.targetDepartment || null
        }
      };
    }
  },
  {
    name: 'get_announcements_summary',
    description: 'Tra cứu danh sách các thông báo, quyết định nội bộ công ty mới nhất.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Số lượng thông báo tối đa (mặc định 5)' }
      }
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      try {
        const limit = args.limit || 5;
        const { results = [] } = await env.DB.prepare(`
          SELECT id, title, content, priority, target_scope, created_at
            FROM announcements
           ORDER BY id DESC LIMIT ?
        `).bind(limit).all();
        return {
          count: results.length,
          announcements: results.map(a => ({
            id: a.id,
            title: a.title,
            preview: a.content ? a.content.slice(0, 150) + (a.content.length > 150 ? '...' : '') : '',
            priority: a.priority || 'normal',
            createdAt: a.created_at
          }))
        };
      } catch (err) {
        return { count: 0, announcements: [] };
      }
    }
  },
  {
    name: 'employee_update_code',
    description: 'Đổi mã nhân viên cho nhân sự (chỉ dành cho Admin).',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'number', description: 'ID nhân sự' },
        employeeCode: { type: 'string', description: 'Mã nhân viên mới' }
      },
      required: ['userId', 'employeeCode']
    },
    allowedPersonas: ['director'],
    authorize: (args, me) => {
      if (me.role !== 'admin') {
        return {
          allowed: false,
          error: 'PERMISSION_DENIED',
          message: 'Chỉ Quản trị viên hệ thống mới có quyền sửa đổi Mã nhân viên.'
        };
      }
      return { allowed: true };
    },
    execute: async (env, args, me) => {
      const { isAdmin } = checkRolePermissions(me);
      if (!isAdmin) {
        return { error: 'PERMISSION_DENIED', message: 'Chức năng cập nhật Mã nhân viên (employee_code) chỉ dành riêng cho Quản trị viên (Admin).' };
      }

      const target = await resolveUser(env, args.userId || args.employeeName);
      if (!target) return { error: 'NOT_FOUND', message: `Không tìm thấy nhân viên "${args.employeeName || args.userId || ''}".` };

      const newCode = String(args.employeeCode || '').trim().toUpperCase();
      if (!newCode) return { error: 'BAD_REQUEST', message: 'Mã nhân viên mới không được để trống.' };

      return {
        isActionCard: true,
        actionType: 'update_employee_code',
        icon: 'keyRound',
        title: 'Xác nhận đổi mã nhân viên',
        confirmLabel: 'Xác nhận đổi mã',
        cancelLabel: 'Hủy',
        fields: [
          { label: 'Nhân sự', value: target.full_name },
          { label: 'Mã nhân viên cũ', value: target.employee_code || 'Chưa có' },
          { label: 'Mã nhân viên mới', value: newCode },
          { label: 'Phòng ban', value: target.department || 'Chung' }
        ],
        payload: {
          userId: target.id,
          employeeCode: newCode,
          employeeName: target.full_name
        }
      };
    }
  },
  {
    name: 'get_system_module_info',
    description: 'Tra cứu thông tin, hướng dẫn thao tác, quy trình nghiệp vụ cho bất kỳ phân hệ nào trong 12 module của hệ thống.',
    parameters: {
      type: 'object',
      properties: {
        moduleName: { type: 'string', description: 'Tên phân hệ (dashboard, announcements, chat, attendance, leave, tasks, invoices, handover, employees, payroll, locations, settings)' }
      },
      required: ['moduleName']
    },
    allowedPersonas: ['employee', 'hr', 'director'],
    execute: async (env, args, me) => {
      const mod = String(args.moduleName || '').toLowerCase();
      const guides = {
        dashboard: {
          name: 'Dashboard (Tổng quan)',
          menuPath: '#/dashboard',
          features: ['Biểu đồ nhân sự toàn diện', 'Tỷ lệ chấm công đúng giờ / đi muộn hôm nay', 'Danh sách task ưu tiên cần xử lý', 'Lịch sinh nhật và sự kiện công ty trong tháng']
        },
        announcements: {
          name: 'Thông báo (Announcements)',
          menuPath: '#/announcements',
          features: ['Đăng tải và tiếp nhận tin tức, quyết định ban giám đốc', 'Tải tệp đính kèm tài liệu, thông tư', 'Theo dõi danh sách nhân sự đã đọc thông báo']
        },
        chat: {
          name: 'Chat nội bộ',
          menuPath: '#/chat',
          features: ['Kênh thảo luận thời gian thực WebSocket / Durable Object', 'Kênh chat chung toàn công ty và phòng chat riêng theo phòng ban', 'Bình chọn (Poll), ghim tin nhắn, nhắc tên @mention']
        },
        attendance: {
          name: 'Chấm công',
          menuPath: '#/attendance',
          features: ['Check-in / Check-out xác thực GPS geofence văn phòng và WiFi Whitelist', 'Giờ làm việc 08:30 - 17:00 (mốc 08:35 đúng giờ, từ 08:36 tính đi muộn)', 'Miễn phạt 2 lần/tháng đầu tiên, từ lần 3 phạt 20.000đ/lần', 'Tự động checkout hệ thống lúc 17:05 UTC']
        },
        leave: {
          name: 'Nghỉ phép',
          menuPath: '#/leave',
          features: ['Nộp đơn xin nghỉ phép trực tuyến', 'Quy trình phê duyệt 2 bước: Bước 1 (Quản lý trực tiếp) -> Bước 2 (Phòng HCNS duyệt cuối)', 'Quản lý quỹ ngày phép năm (12 ngày/năm), nghỉ ốm, nghỉ không lương']
        },
        tasks: {
          name: 'Công việc (Tasks)',
          menuPath: '#/tasks',
          features: ['Quản lý công việc cá nhân và dự án theo bảng Kanban hoặc Danh sách', 'Gắn nhãn độ ưu tiên (low, medium, high, urgent), hạn chót (due date)', 'Giao việc cho đồng nghiệp, đính kèm tệp và cập nhật tiến độ']
        },
        invoices: {
          name: 'Phiếu lương (Cá nhân)',
          menuPath: '#/invoices',
          features: ['Tra cứu chi tiết phiếu lương cá nhân từng tháng: Lương cơ bản, ngày công thực tế, thưởng KPI, phụ cấp, giảm trừ phạt đi muộn, BHXH, thuế TNCN, thực nhận (Net)', 'Xác nhận phiếu lương hoặc gửi yêu cầu xem lại (Review request) nếu có thắc mắc']
        },
        handover: {
          name: 'Bàn giao dự án & tài khoản',
          menuPath: '#/asset-handover',
          features: ['Bàn giao tài sản thiết bị (laptop, chìa khóa, màn hình)', 'Bàn giao tài khoản hệ thống (hosting, fanpage, email marketing)', 'Bàn giao tiến độ dự án khi luân chuyển công tác hoặc nghỉ việc (Offboarding)']
        },
        employees: {
          name: 'Nhân viên (Hồ sơ nhân sự)',
          menuPath: '#/users',
          features: ['Danh bạ nhân viên nội bộ, số điện thoại, email, phòng ban', 'Quản lý hợp đồng lao động, CCCD, tài khoản ngân hàng, BHXH', 'Phân quyền Admin/HCNS/Manager/Nhân viên. Admin có quyền đổi Mã nhân viên (employee_code)']
        },
        payroll: {
          name: 'Bảng lương (Quản trị)',
          menuPath: '#/payroll',
          features: ['Bảng tính lương tổng hợp toàn công ty dành cho HCNS và Admin', 'Import / Export bảng lương mẫu Excel chuẩn hóa', 'Đồng bộ tự động từ dữ liệu chấm công và KPI', 'AI Anomaly Audit: Kiểm toán AI tự động phát hiện sai lệch ngày công và vi phạm chưa trừ phạt']
        },
        locations: {
          name: 'Địa điểm chấm công',
          menuPath: '#/attendance-locations',
          features: ['Cấu hình tọa độ GPS văn phòng (kinh độ, vĩ độ, bán kính geofence mét)', 'Quản lý danh sách WiFi Whitelist (BSSID, IP) được phép chấm công']
        },
        settings: {
          name: 'Cài đặt & Database Admin',
          menuPath: '#/settings',
          features: ['Cấu hình thời gian làm việc chuẩn (08:30 - 17:00), mốc phạt đi muộn', 'Quản trị cơ sở dữ liệu Cloudflare D1 và sao lưu dự phòng']
        }
      };

      const matchedKey = Object.keys(guides).find(k => mod.includes(k)) || 'dashboard';
      return guides[matchedKey];
    }
  }
];
