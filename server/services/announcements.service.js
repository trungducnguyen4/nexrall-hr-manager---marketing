/**
 * Announcements Service
 * Handles company announcements schema, HTML sanitization, data queries, and storage.
 */
import { safeDownloadName } from '../lib/string.js';

export function sanitizeAnnouncementHtmlServer(dirty) {
  if (!dirty || typeof dirty !== 'string') return '';
  let clean = dirty;
  clean = clean.replace(/<(script|style|iframe|object|embed|applet|meta|link|base|form|input|button|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  clean = clean.replace(/<(script|style|iframe|object|embed|applet|meta|link|base|form|input|button|select|textarea)\b[^>]*\/?>/gi, '');
  clean = clean.replace(/\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/\b(href|src)\s*=\s*["']?\s*(?:javascript|vbscript):[^"'>\s]*/gi, '');
  clean = clean.replace(/\bhref\s*=\s*["']?\s*data:[^"'>\s]*/gi, '');
  return clean;
}

export async function ensureAnnouncementsSchema(env) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      target_scope TEXT DEFAULT 'all',
      target_department TEXT,
      attachment_url TEXT,
      attachment_name TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT
    )`).run();
  } catch (error) {
    console.error('ensureAnnouncementsSchema announcements failed', error);
  }

  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (announcement_id, user_id)
    )`).run();
  } catch (error) {
    console.error('ensureAnnouncementsSchema announcement_reads failed', error);
  }

  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS announcement_files (
      id TEXT PRIMARY KEY,
      uploader_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT,
      byte_size INTEGER,
      storage_key TEXT,
      data_base64 TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
  } catch (error) {
    console.error('ensureAnnouncementsSchema announcement_files failed', error);
  }

  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC)').run(); } catch (_) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id, announcement_id)').run(); } catch (_) {}
}

/**
 * Upload an announcement attachment to R2 or D1 base64
 */
export async function uploadAnnouncementAttachment(env, me, file) {
  const maxBytes = 25 * 1024 * 1024; // 25 MB
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > maxBytes) {
    return { error: 'Dung lượng tệp tối đa là 25 MB', status: 400 };
  }

  const filename = safeDownloadName(file.name, 'attachment');
  const contentType = String(file.type || 'application/octet-stream').toLowerCase();
  const documentId = crypto.randomUUID();
  const bytes = await file.arrayBuffer();

  if (env.HR_DOCUMENTS) {
    const storageKey = `announcements/${documentId}/${filename}`;
    await env.HR_DOCUMENTS.put(storageKey, bytes, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=86400' },
      customMetadata: { uploader_id: String(me.id) }
    });
    await env.DB.prepare('INSERT INTO announcement_files (id, uploader_id, filename, content_type, byte_size, storage_key, data_base64) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(documentId, me.id, filename, contentType, file.size, storageKey, null).run();
  } else {
    const b64 = Buffer.from(bytes).toString('base64');
    await env.DB.prepare('INSERT INTO announcement_files (id, uploader_id, filename, content_type, byte_size, storage_key, data_base64) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(documentId, me.id, filename, contentType, file.size, null, b64).run();
  }

  const fileUrl = `/api/announcements/attachments/${documentId}`;
  return { ok: true, document_id: documentId, filename, file_url: fileUrl, file_size: file.size };
}

/**
 * Retrieve announcement attachment record and data
 */
export async function getAnnouncementAttachment(env, docId) {
  const row = await env.DB.prepare('SELECT * FROM announcement_files WHERE id = ?').bind(docId).first();
  if (!row) return null;

  const filename = safeDownloadName(row.filename || 'attachment');
  const contentType = row.content_type || 'application/octet-stream';

  if (env.HR_DOCUMENTS && row.storage_key) {
    const object = await env.HR_DOCUMENTS.get(row.storage_key);
    if (object) {
      return { body: object.body, filename, contentType };
    }
  }

  if (row.data_base64) {
    const buf = Buffer.from(row.data_base64, 'base64');
    return { body: buf, filename, contentType };
  }

  return null;
}

/**
 * List announcements visible to the current user
 */
export async function listAnnouncements(env, me, { scopeFilter, priorityFilter, search }, canManageAnnouncements) {
  const rows = await env.DB.prepare(`
    SELECT a.*, u.full_name AS creator_name, u.avatar_url AS creator_avatar, u.role AS creator_role, u.department AS creator_department,
           EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE (a.target_scope = 'all' OR a.target_department = ? OR ? = 1)
    ORDER BY a.created_at DESC
    LIMIT 100
  `).bind(me.id, me.department || '', canManageAnnouncements ? 1 : 0).all().then(r => r.results || []);

  let filtered = rows;
  if (scopeFilter) filtered = filtered.filter(a => a.target_scope === scopeFilter || a.target_department === scopeFilter);
  if (priorityFilter) filtered = filtered.filter(a => a.priority === priorityFilter);
  if (search) {
    filtered = filtered.filter(a =>
      (a.title || '').toLowerCase().includes(search) ||
      (a.content || '').toLowerCase().includes(search) ||
      (a.creator_name || '').toLowerCase().includes(search)
    );
  }

  return filtered;
}

/**
 * Count unread announcements for user
 */
export async function getUnreadAnnouncementCount(env, me, canManageAnnouncements) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS unread_count
    FROM announcements a
    WHERE (a.target_scope = 'all' OR a.target_department = ? OR ? = 1)
      AND NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?)
  `).bind(me.department || '', canManageAnnouncements ? 1 : 0, me.id).first();

  return Number(row?.unread_count || 0);
}

/**
 * Create a new announcement
 */
export async function createAnnouncement(env, me, payload, { broadcastAppEvent }) {
  const title = String(payload.title || '').trim();
  const content = sanitizeAnnouncementHtmlServer(String(payload.content || '').trim());
  const priority = ['normal', 'important'].includes(payload.priority) ? payload.priority : 'normal';
  const targetScope = payload.target_scope === 'department' ? 'department' : 'all';
  const targetDepartment = targetScope === 'department' ? String(payload.target_department || '').trim() : null;
  const attachmentUrl = payload.attachment_url ? String(payload.attachment_url).trim() : null;
  const attachmentName = payload.attachment_name ? String(payload.attachment_name).trim() : null;

  if (!title) return { error: 'Tiêu đề thông báo không được để trống', status: 400 };
  if (!content) return { error: 'Nội dung thông báo không được để trống', status: 400 };
  if (targetScope === 'department' && !targetDepartment) {
    return { error: 'Vui lòng chọn phòng ban nhận thông báo', status: 400 };
  }

  const res = await env.DB.prepare(`
    INSERT INTO announcements (title, content, priority, target_scope, target_department, attachment_url, attachment_name, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(title, content, priority, targetScope, targetDepartment, attachmentUrl, attachmentName, me.id).run();

  const newId = res.meta?.last_row_id;
  if (newId) {
    await env.DB.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)')
      .bind(newId, me.id).run();
  }

  const created = await env.DB.prepare(`
    SELECT a.*, u.full_name AS creator_name, u.avatar_url AS creator_avatar, u.role AS creator_role, u.department AS creator_department,
           1 AS is_read
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.id = ?
  `).bind(newId).first();

  if (broadcastAppEvent) {
    await broadcastAppEvent(env, 'announcements', 'announcement:new', {
      announcement: created,
      target_scope: targetScope,
      target_department: targetDepartment,
    }, { actorId: me.id });
  }

  return { ok: true, announcement: created };
}

/**
 * Find announcement by ID
 */
export async function getAnnouncementById(env, annId) {
  return env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(annId).first();
}

/**
 * Get detailed announcement with author info and is_read status
 */
export async function getAnnouncementDetail(env, me, annId) {
  return env.DB.prepare(`
    SELECT a.*, u.full_name AS creator_name, u.avatar_url AS creator_avatar, u.role AS creator_role, u.department AS creator_department,
           EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.id = ?
  `).bind(me.id, annId).first();
}

/**
 * Update an existing announcement
 */
export async function updateAnnouncement(env, me, annId, existing, payload, { broadcastAppEvent }) {
  const title = String(payload.title || '').trim();
  const content = sanitizeAnnouncementHtmlServer(String(payload.content || '').trim());
  const priority = ['normal', 'important'].includes(payload.priority) ? payload.priority : (existing.priority || 'normal');
  const targetScope = payload.target_scope === 'department' ? 'department' : (payload.target_scope === 'all' ? 'all' : existing.target_scope);
  const targetDepartment = targetScope === 'department' ? String(payload.target_department || '').trim() : null;
  const attachmentUrl = payload.attachment_url !== undefined ? (payload.attachment_url ? String(payload.attachment_url).trim() : null) : existing.attachment_url;
  const attachmentName = payload.attachment_name !== undefined ? (payload.attachment_name ? String(payload.attachment_name).trim() : null) : existing.attachment_name;

  if (!title) return { error: 'Tiêu đề thông báo không được để trống', status: 400 };
  if (!content) return { error: 'Nội dung thông báo không được để trống', status: 400 };

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare(`
    UPDATE announcements
    SET title = ?, content = ?, priority = ?, target_scope = ?, target_department = ?, attachment_url = ?, attachment_name = ?, updated_at = ?
    WHERE id = ?
  `).bind(title, content, priority, targetScope, targetDepartment, attachmentUrl, attachmentName, now, annId).run();

  const updated = await env.DB.prepare(`
    SELECT a.*, u.full_name AS creator_name, u.avatar_url AS creator_avatar, u.role AS creator_role, u.department AS creator_department,
           EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.id = ?
  `).bind(me.id, annId).first();

  if (broadcastAppEvent) {
    await broadcastAppEvent(env, 'announcements', 'announcement:updated', {
      announcement: updated,
    }, { actorId: me.id });
  }

  return { ok: true, announcement: updated };
}

/**
 * Delete an announcement
 */
export async function deleteAnnouncement(env, me, annId, { broadcastAppEvent }) {
  await env.DB.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').bind(annId).run();
  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(annId).run();

  if (broadcastAppEvent) {
    await broadcastAppEvent(env, 'announcements', 'announcement:deleted', {
      id: annId,
    }, { actorId: me.id });
  }

  return { ok: true, id: annId };
}

/**
 * Mark a single announcement as read
 */
export async function markAnnouncementAsRead(env, me, annId) {
  await env.DB.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)')
    .bind(annId, me.id).run();
  return { ok: true, id: annId };
}

/**
 * Mark all visible announcements as read
 */
export async function markAllAnnouncementsAsRead(env, me, canManageAnnouncements) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id)
    SELECT a.id, ?
    FROM announcements a
    WHERE (a.target_scope = 'all' OR a.target_department = ? OR ? = 1)
  `).bind(me.id, me.department || '', canManageAnnouncements ? 1 : 0).run();
  return { ok: true };
}
