/**
 * Tool Execution Helpers
 * Utility functions for agent tools: date parsing, broadcasting, user/task resolution, and permission checking.
 */
import { checkRolePermissions } from '../personas/persona-resolver.js';

export { checkRolePermissions };

/**
 * Safe broadcast wrapper for live UI sync
 */
export async function safeBroadcast(env, topic, event, payload = {}, options = {}) {
  const syncHubBinding = env?.SYNC_HUB || env?.APP_SYNC_HUB;
  if (!syncHubBinding) return;
  try {
    const id = syncHubBinding.idFromName('global');
    const stub = syncHubBinding.get(id);
    await stub.fetch('http://sync-hub/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        event,
        payload,
        actorId: options.actorId || null,
        timestamp: new Date().toISOString()
      })
    });
  } catch (err) {
    console.warn('[safeBroadcast] Notification broadcast failed:', err?.message);
  }
}

/**
 * Parse relative Vietnamese dates to YYYY-MM-DD
 */
export function parseRelativeDate(text, fallback = null) {
  if (!text) return fallback;
  const s = String(text).toLowerCase().trim();
  const now = new Date();

  if (s.includes('hôm nay')) {
    return now.toISOString().slice(0, 10);
  }
  if (s.includes('ngày mai') || s.includes('mai')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (s.includes('ngày kia') || s.includes('mốt')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }
  const isNextWeek = s.includes('tuần sau') || s.includes('tuần tới');
  const dayMatch = s.match(/(?:thứ|t)\s*([2-7]|hai|ba|tư|bốn|năm|sáu|bảy)|chủ\s*nhật|cn/i);
  if (dayMatch) {
    let targetDay = 1;
    const val = dayMatch[0].toLowerCase();
    if (val.includes('2') || val.includes('hai')) targetDay = 1;
    else if (val.includes('3') || val.includes('ba')) targetDay = 2;
    else if (val.includes('4') || val.includes('tư') || val.includes('bốn')) targetDay = 3;
    else if (val.includes('5') || val.includes('năm')) targetDay = 4;
    else if (val.includes('6') || val.includes('sáu')) targetDay = 5;
    else if (val.includes('7') || val.includes('bảy')) targetDay = 6;
    else if (val.includes('chủ nhật') || val.includes('cn')) targetDay = 0;

    const currentDay = now.getDay();
    let diff = targetDay - currentDay;
    if (isNextWeek) {
      diff += 7;
    } else if (diff <= 0) {
      diff += 7;
    }
    const d = new Date(now);
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  if (s.includes('cuối tháng')) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  }
  const ymd = s.match(/\b(202\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (ymd) return ymd[0];
  const dmy = s.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])(?:[\/\-](202\d))?\b/);
  if (dmy) {
    const day = String(dmy[1]).padStart(2, '0');
    const mon = String(dmy[2]).padStart(2, '0');
    const yr = dmy[3] || now.getFullYear();
    return `${yr}-${mon}-${day}`;
  }

  return fallback || now.toISOString().slice(0, 10);
}

/**
 * Fuzzy resolve user by name, code or ID
 */
export async function resolveUser(env, nameOrCode) {
  if (!nameOrCode || !env?.DB) return null;
  const kw = String(nameOrCode).trim();
  if (/^\d+$/.test(kw)) {
    const byId = await env.DB.prepare('SELECT id, full_name, employee_code, department, role FROM users WHERE id = ?').bind(Number(kw)).first();
    if (byId) return byId;
  }
  const byCode = await env.DB.prepare('SELECT id, full_name, employee_code, department, role FROM users WHERE UPPER(employee_code) = UPPER(?)').bind(kw).first();
  if (byCode) return byCode;

  const byName = await env.DB.prepare('SELECT id, full_name, employee_code, department, role FROM users WHERE is_active = 1 AND full_name LIKE ? ORDER BY id ASC LIMIT 1').bind(`%${kw}%`).first();
  return byName || null;
}

/**
 * Resolve task by ID or title substring
 */
export async function resolveTask(env, ref, me) {
  if (!ref || !env?.DB) return null;
  const kw = String(ref).trim();
  const idMatch = kw.match(/#?(\d+)/);
  if (idMatch) {
    const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(Number(idMatch[1])).first();
    if (task) return task;
  }
  const cleanTitle = kw.replace(/^(task|công việc|nhiệm vụ)\s*/i, '').trim();
  if (cleanTitle) {
    const task = await env.DB.prepare('SELECT * FROM tasks WHERE title LIKE ? ORDER BY id DESC LIMIT 1').bind(`%${cleanTitle}%`).first();
    if (task) return task;
  }
  return null;
}
