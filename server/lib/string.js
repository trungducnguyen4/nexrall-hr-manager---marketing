/**
 * String and Search Utilities for NetViet HR System
 */

export const VIETNAMESE_SEARCH_REPLACEMENTS = [
  ['a', 'àáạảãâầấậẩẫăằắặẳẵ'],
  ['e', 'èéẹẻẽêềếệểễ'],
  ['i', 'ìíịỉĩ'],
  ['o', 'òóọỏõôồốộổỗơờớợởỡ'],
  ['u', 'ùúụủũưừứựửữ'],
  ['y', 'ỳýỵỷỹ'],
  ['d', 'đĐ'],
];

export function normalizeVietnameseSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();
}

export function vietnameseSearchSql(column) {
  let expression = `COALESCE(${column},'')`;
  for (const [replacement, chars] of VIETNAMESE_SEARCH_REPLACEMENTS) {
    for (const char of chars) {
      expression = `REPLACE(${expression},'${char}','${replacement}')`;
    }
  }
  return `LOWER(${expression})`;
}

export function safeDownloadName(value, fallback = 'document') {
  const cleaned = String(value || fallback).replace(/[\r\n"\\]/g, '_').slice(0, 180);
  return cleaned || fallback;
}

export function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

export function getVietnameseSortKey(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.slice().reverse().join(' ');
}

export function compareVietnameseNames(a, b) {
  const keyA = getVietnameseSortKey(typeof a === 'string' ? a : (a?.full_name || a?.name || a?.employee_name || a?.user_name || ''));
  const keyB = getVietnameseSortKey(typeof b === 'string' ? b : (b?.full_name || b?.name || b?.employee_name || b?.user_name || ''));
  return keyA.localeCompare(keyB, 'vi', { sensitivity: 'accent', numeric: true });
}

export function sortVietnameseNames(list, key = 'full_name') {
  if (!Array.isArray(list)) return [];
  const getValue = typeof key === 'function' ? key : (item => (item && typeof item === 'object' ? item[key] : item));
  return [...list].sort((a, b) => compareVietnameseNames(getValue(a), getValue(b)));
}
