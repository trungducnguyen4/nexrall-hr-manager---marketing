/**
 * Announcements Controller - HTTP Endpoints for Company Announcements
 */
import { json } from '../lib/response.js';
import {
  ensureAnnouncementsSchema,
  uploadAnnouncementAttachment,
  getAnnouncementAttachment,
  listAnnouncements,
  getUnreadAnnouncementCount,
  createAnnouncement,
  getAnnouncementById,
  getAnnouncementDetail,
  updateAnnouncement,
  deleteAnnouncement,
  markAnnouncementAsRead,
  markAllAnnouncementsAsRead,
} from '../services/announcements.service.js';

export async function handleAnnouncementRoutes(request, env, me, path, url, options = {}) {
  const {
    isHcns = () => false,
    isAttendanceHcns = false,
    broadcastAppEvent = async () => {},
  } = options;

  const canManageAnnouncements = ['admin', 'director'].includes(me.role) || isHcns(me) || isAttendanceHcns;

  if (path.startsWith('/api/announcements')) {
    try { await ensureAnnouncementsSchema(env); } catch (_) {}
  }

  // Upload attachment
  if (path === '/api/announcements/upload' && request.method === 'POST') {
    if (!canManageAnnouncements) {
      return json({ error: 'Chỉ Quản trị viên và HCNS mới có quyền tải tệp lên' }, 403);
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file.stream !== 'function') {
      return json({ error: 'Vui lòng chọn tệp đính kèm' }, 400);
    }
    const result = await uploadAnnouncementAttachment(env, me, file);
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json(result);
  }

  // Download / view attachment
  const annAttachmentMatch = path.match(/^\/api\/announcements\/attachments\/([0-9a-fA-F-]{36})$/);
  if (annAttachmentMatch && request.method === 'GET') {
    const docId = annAttachmentMatch[1];
    const fileData = await getAnnouncementAttachment(env, docId);
    if (!fileData) return json({ error: 'Tệp không tồn tại' }, 404);

    const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
    return new Response(fileData.body, {
      headers: {
        'Content-Type': fileData.contentType,
        'Content-Disposition': `${disposition}; filename="${fileData.filename}"; filename*=UTF-8''${encodeURIComponent(fileData.filename)}`,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  }

  // List announcements
  if (path === '/api/announcements' && request.method === 'GET') {
    const scopeFilter = url.searchParams.get('scope') || '';
    const priorityFilter = url.searchParams.get('priority') || '';
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const filtered = await listAnnouncements(env, me, { scopeFilter, priorityFilter, search }, canManageAnnouncements);
    return json({ announcements: filtered, can_manage: canManageAnnouncements });
  }

  // Unread count
  if (path === '/api/announcements/unread-count' && request.method === 'GET') {
    const unreadCount = await getUnreadAnnouncementCount(env, me, canManageAnnouncements);
    return json({ unread_count: unreadCount });
  }

  // Create announcement
  if (path === '/api/announcements' && request.method === 'POST') {
    if (!canManageAnnouncements) {
      return json({ error: 'Chỉ Quản trị viên và HCNS mới có quyền đăng thông báo' }, 403);
    }
    const b = await request.json().catch(() => ({}));
    const result = await createAnnouncement(env, me, b, { broadcastAppEvent });
    if (result.error) return json({ error: result.error }, result.status || 400);
    return json(result);
  }

  // Get, update, delete single announcement
  const announcementIdMatch = path.match(/^\/api\/announcements\/(\d+)$/);
  if (announcementIdMatch) {
    const annId = parseInt(announcementIdMatch[1], 10);
    const existing = await getAnnouncementById(env, annId);
    if (!existing) return json({ error: 'Không tìm thấy thông báo' }, 404);

    if (request.method === 'GET') {
      const isEligible = existing.target_scope === 'all' || existing.target_department === me.department || canManageAnnouncements;
      if (!isEligible) return json({ error: 'Không có quyền xem thông báo này' }, 403);

      const item = await getAnnouncementDetail(env, me, annId);
      return json({ announcement: item });
    }

    if (request.method === 'PUT') {
      const canEdit = ['admin', 'director'].includes(me.role) || (canManageAnnouncements && existing.created_by === me.id);
      if (!canEdit) return json({ error: 'Không có quyền chỉnh sửa thông báo này' }, 403);

      const b = await request.json().catch(() => ({}));
      const result = await updateAnnouncement(env, me, annId, existing, b, { broadcastAppEvent });
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }

    if (request.method === 'DELETE') {
      const canDelete = ['admin', 'director'].includes(me.role) || (canManageAnnouncements && existing.created_by === me.id);
      if (!canDelete) return json({ error: 'Không có quyền xóa thông báo này' }, 403);

      const result = await deleteAnnouncement(env, me, annId, { broadcastAppEvent });
      return json(result);
    }
  }

  // Mark single as read
  if (path.match(/^\/api\/announcements\/(\d+)\/read$/) && request.method === 'POST') {
    const annId = parseInt(path.match(/^\/api\/announcements\/(\d+)\/read$/)[1], 10);
    const result = await markAnnouncementAsRead(env, me, annId);
    return json(result);
  }

  // Mark all as read
  if (path === '/api/announcements/read-all' && request.method === 'POST') {
    const result = await markAllAnnouncementsAsRead(env, me, canManageAnnouncements);
    return json(result);
  }

  return null;
}
