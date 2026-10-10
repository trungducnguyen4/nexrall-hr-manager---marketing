/**
 * Announcements Controller - HTTP Endpoints for Company Announcements
 */
import { json, err } from '../lib/response.js';
import { safeDownloadName } from '../lib/string.js';
import {
  ensureAnnouncementsSchema,
  sanitizeAnnouncementHtmlServer,
} from '../services/announcements.service.js';

export async function handleAnnouncementRoutes(request, env, me, path, url, options = {}) {
  const {
    isHcns = () => false,
    isAttendanceHcns = false,
    broadcastAppEvent = async () => {},
  } = options;

  // ── Announcements (Admin / Company Announcements) ────────────────
  const canManageAnnouncements = ['admin', 'director'].includes(me.role) || isHcns(me) || isAttendanceHcns;

  function sanitizeAnnouncementHtmlServer(dirty) {
    if (!dirty || typeof dirty !== 'string') return '';
    let clean = dirty;
    clean = clean.replace(/<(script|style|iframe|object|embed|applet|meta|link|base|form|input|button|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    clean = clean.replace(/<(script|style|iframe|object|embed|applet|meta|link|base|form|input|button|select|textarea)\b[^>]*\/?>/gi, '');
    clean = clean.replace(/\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    clean = clean.replace(/\b(href|src)\s*=\s*["']?\s*(?:javascript|vbscript):[^"'>\s]*/gi, '');
    clean = clean.replace(/\bhref\s*=\s*["']?\s*data:[^"'>\s]*/gi, '');
    return clean;
  }

  if (path.startsWith('/api/announcements')) {
    try { await ensureAnnouncementsSchema(env); } catch (_) {}
  }

  if (path === '/api/announcements/upload' && request.method === 'POST') {
    if (!canManageAnnouncements) {
      return json({ error: 'Chỉ Quản trị viên và HCNS mới có quyền tải tệp lên' }, 403);
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file.stream !== 'function') return json({ error: 'Vui lòng chọn tệp đính kèm' }, 400);

    const maxBytes = 25 * 1024 * 1024; // 25 MB
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > maxBytes) {
      return json({ error: 'Dung lượng tệp tối đa là 25 MB' }, 400);
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
    return json({ ok: true, document_id: documentId, filename, file_url: fileUrl, file_size: file.size });
  }

  const annAttachmentMatch = path.match(/^\/api\/announcements\/attachments\/([0-9a-fA-F-]{36})$/);
  if (annAttachmentMatch && request.method === 'GET') {
    const docId = annAttachmentMatch[1];
    const row = await env.DB.prepare('SELECT * FROM announcement_files WHERE id = ?').bind(docId).first();
    if (!row) return json({ error: 'Tệp không tồn tại' }, 404);

    const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    const filename = safeDownloadName(row.filename || 'attachment');
    const contentType = row.content_type || 'application/octet-stream';

    if (env.HR_DOCUMENTS && row.storage_key) {
      const object = await env.HR_DOCUMENTS.get(row.storage_key);
      if (object) {
        return new Response(object.body, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Cache-Control': 'public, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
          }
        });
      }
    }

    if (row.data_base64) {
      const buf = Buffer.from(row.data_base64, 'base64');
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        }
      });
    }

    return json({ error: 'Nội dung tệp không khả dụng' }, 404);
  }

  if (path === '/api/announcements' && request.method === 'GET') {
    const scopeFilter = url.searchParams.get('scope') || '';
    const priorityFilter = url.searchParams.get('priority') || '';
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();

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

    return json({ announcements: filtered, can_manage: canManageAnnouncements });
  }

  if (path === '/api/announcements/unread-count' && request.method === 'GET') {
    const row = await env.DB.prepare(`
      SELECT COUNT(*) AS unread_count
      FROM announcements a
      WHERE (a.target_scope = 'all' OR a.target_department = ? OR ? = 1)
        AND NOT EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?)
    `).bind(me.department || '', canManageAnnouncements ? 1 : 0, me.id).first();

    return json({ unread_count: Number(row?.unread_count || 0) });
  }

  if (path === '/api/announcements' && request.method === 'POST') {
    if (!canManageAnnouncements) {
      return json({ error: 'Chỉ Quản trị viên và HCNS mới có quyền đăng thông báo' }, 403);
    }
    const b = await request.json().catch(() => ({}));
    const title = String(b.title || '').trim();
    const content = sanitizeAnnouncementHtmlServer(String(b.content || '').trim());
    const priority = ['normal', 'important'].includes(b.priority) ? b.priority : 'normal';
    const targetScope = b.target_scope === 'department' ? 'department' : 'all';
    const targetDepartment = targetScope === 'department' ? String(b.target_department || '').trim() : null;
    const attachmentUrl = b.attachment_url ? String(b.attachment_url).trim() : null;
    const attachmentName = b.attachment_name ? String(b.attachment_name).trim() : null;

    if (!title) return json({ error: 'Tiêu đề thông báo không được để trống' }, 400);
    if (!content) return json({ error: 'Nội dung thông báo không được để trống' }, 400);
    if (targetScope === 'department' && !targetDepartment) {
      return json({ error: 'Vui lòng chọn phòng ban nhận thông báo' }, 400);
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

    await broadcastAppEvent(env, 'announcements', 'announcement:new', {
      announcement: created,
      target_scope: targetScope,
      target_department: targetDepartment,
    }, { actorId: me.id });

    return json({ ok: true, announcement: created });
  }

  const announcementIdMatch = path.match(/^\/api\/announcements\/(\d+)$/);
  if (announcementIdMatch) {
    const annId = parseInt(announcementIdMatch[1], 10);
    const existing = await env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(annId).first();
    if (!existing) return json({ error: 'Không tìm thấy thông báo' }, 404);

    if (request.method === 'GET') {
      const isEligible = existing.target_scope === 'all' || existing.target_department === me.department || canManageAnnouncements;
      if (!isEligible) return json({ error: 'Không có quyền xem thông báo này' }, 403);

      const item = await env.DB.prepare(`
        SELECT a.*, u.full_name AS creator_name, u.avatar_url AS creator_avatar, u.role AS creator_role, u.department AS creator_department,
               EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
        FROM announcements a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = ?
      `).bind(me.id, annId).first();
      return json({ announcement: item });
    }

    if (request.method === 'PUT') {
      const canEdit = ['admin', 'director'].includes(me.role) || (canManageAnnouncements && existing.created_by === me.id);
      if (!canEdit) return json({ error: 'Không có quyền chỉnh sửa thông báo này' }, 403);

      const b = await request.json().catch(() => ({}));
      const title = String(b.title || '').trim();
      const content = sanitizeAnnouncementHtmlServer(String(b.content || '').trim());
      const priority = ['normal', 'important'].includes(b.priority) ? b.priority : (existing.priority || 'normal');
      const targetScope = b.target_scope === 'department' ? 'department' : (b.target_scope === 'all' ? 'all' : existing.target_scope);
      const targetDepartment = targetScope === 'department' ? String(b.target_department || '').trim() : null;
      const attachmentUrl = b.attachment_url !== undefined ? (b.attachment_url ? String(b.attachment_url).trim() : null) : existing.attachment_url;
      const attachmentName = b.attachment_name !== undefined ? (b.attachment_name ? String(b.attachment_name).trim() : null) : existing.attachment_name;

      if (!title) return json({ error: 'Tiêu đề thông báo không được để trống' }, 400);
      if (!content) return json({ error: 'Nội dung thông báo không được để trống' }, 400);

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

      await broadcastAppEvent(env, 'announcements', 'announcement:updated', {
        announcement: updated,
      }, { actorId: me.id });

      return json({ ok: true, announcement: updated });
    }

    if (request.method === 'DELETE') {
      const canDelete = ['admin', 'director'].includes(me.role) || (canManageAnnouncements && existing.created_by === me.id);
      if (!canDelete) return json({ error: 'Không có quyền xóa thông báo này' }, 403);

      await env.DB.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').bind(annId).run();
      await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(annId).run();

      await broadcastAppEvent(env, 'announcements', 'announcement:deleted', {
        id: annId,
      }, { actorId: me.id });

      return json({ ok: true, id: annId });
    }
  }

  if (path.match(/^\/api\/announcements\/(\d+)\/read$/) && request.method === 'POST') {
    const annId = parseInt(path.match(/^\/api\/announcements\/(\d+)\/read$/)[1], 10);
    await env.DB.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)')
      .bind(annId, me.id).run();
    return json({ ok: true, id: annId });
  }

  if (path === '/api/announcements/read-all' && request.method === 'POST') {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id)
      SELECT a.id, ?
      FROM announcements a
      WHERE (a.target_scope = 'all' OR a.target_department = ? OR ? = 1)
    `).bind(me.id, me.department || '', canManageAnnouncements ? 1 : 0).run();
    return json({ ok: true });
  }

  return null;
}
