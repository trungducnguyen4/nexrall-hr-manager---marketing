import { normalizeDeptName } from '../services/departments.service.js';

/**
 * HCNS (Phòng HCNS) and Ban Giám Đốc (both are DEPARTMENTS, not roles) may edit
 * lifecycle status and fully manage asset handovers. Admin always has owner-level access.
 */
export function isHrOrBod(u) {
  return !!u && (u.role === 'admin' || normalizeDeptName(u.department) === 'Phòng HCNS' || normalizeDeptName(u.department) === 'Ban Giám Đốc');
}

/**
 * Narrower than isHrOrBod — used to tell the HCNS-only actions (Tiếp nhận/Khóa phiếu) apart
 * from the Ban Giám Đốc-only actions (Phê duyệt/Trả lại) in the Đánh giá hiệu suất workflow.
 */
export function isHcns(u) {
  return !!u && (u.role === 'admin' || normalizeDeptName(u.department) === 'Phòng HCNS');
}

export function isBgd(u) {
  return !!u && (u.role === 'admin' || normalizeDeptName(u.department) === 'Ban Giám Đốc');
}

/**
 * Quản lý/Trưởng phòng (role='manager') xử lý tài sản của nhân sự thuộc phòng ban mình phụ trách.
 */
export function isDeptManager(u, ownerDept) {
  return !!u && u.role === 'manager' && !!ownerDept && u.department === ownerDept;
}

export function isDirectorHau(u) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  const code = String(u.employee_code || '').trim().toUpperCase();
  if (code === 'HAUNV') return true;
  const email = String(u.email || '').toLowerCase().trim();
  if (email.startsWith('haunv@')) return true;
  const dept = normalizeDeptName(u.department);
  const pos = String(u.position || '').toLowerCase();
  if (dept === 'Ban Giám Đốc' && (pos.includes('tổng giám đốc') || pos.includes('ceo') || pos.includes('giám đốc'))) {
    return true;
  }
  return false;
}

export function isStep1Approver(u) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (normalizeDeptName(u.department) === 'Phòng HCNS') return true;
  return false;
}
