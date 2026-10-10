import { json } from '../lib/response.js';
import { vnDateTimeStr } from '../lib/time.js';
import { safeDownloadName } from '../lib/string.js';
import { broadcastAppEvent } from '../lib/broadcaster.js';
import {
  chatMember,
  saveMessageMentions,
  saveAllMention,
  hydrateChatMessages,
  getChatMessage,
  broadcastChatUpdate,
  getChatEmojis,
  ensureCompanyChannel,
  attachChatAttachments,
} from '../services/chat.service.js';

export const ChatController = {
  async getEmojis() {
    return json({ emojis: await getChatEmojis(), source: 'emojihub-with-unicode-fallback' });
  },

  async getHeaderSummary({ env, me }) {
    try {
      const nowHcm = vnDateTimeStr();
      const dissolvedFilter = 'NOT EXISTS (SELECT 1 FROM dissolved_conversations dc WHERE dc.conversation_id=c.id)';
      const unread = await env.DB.prepare(
        `SELECT COUNT(*) AS unread_count
           FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
           JOIN conversations c ON c.id=m.conversation_id
          WHERE m.deleted_at IS NULL AND m.sender_id != ?
            AND m.id > COALESCE(cm.last_read_message_id,0) AND ${dissolvedFilter}`
      ).bind(me.id, me.id).first();

      const mentionCountRow = await env.DB.prepare(
        `SELECT COUNT(DISTINCT m.id) AS mention_count
           FROM messages m
           JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
           JOIN conversations c ON c.id=m.conversation_id
           LEFT JOIN message_mentions mm ON mm.message_id=m.id AND mm.mentioned_user_id=?
           LEFT JOIN message_all_mentions ma ON ma.message_id=m.id
          WHERE m.deleted_at IS NULL AND m.sender_id != ?
            AND m.id > COALESCE(cm.last_read_message_id,0)
            AND (mm.mentioned_user_id IS NOT NULL OR ma.message_id IS NOT NULL)
            AND ${dissolvedFilter}`
      ).bind(me.id, me.id, me.id).first();

      const mention = await env.DB.prepare(
        `SELECT m.id AS message_id,m.conversation_id,c.name AS conversation_name,m.sender_id,u.full_name AS sender_name,
                m.content AS preview,m.created_at,CASE WHEN ma.message_id IS NULL THEN 0 ELSE 1 END AS mention_all
           FROM messages m
           JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
           JOIN conversations c ON c.id=m.conversation_id
           JOIN users u ON u.id=m.sender_id
           LEFT JOIN message_mentions mm ON mm.message_id=m.id AND mm.mentioned_user_id=?
           LEFT JOIN message_all_mentions ma ON ma.message_id=m.id
          WHERE m.deleted_at IS NULL AND m.sender_id != ?
            AND m.id > COALESCE(cm.last_read_message_id,0)
            AND (mm.mentioned_user_id IS NOT NULL OR ma.message_id IS NOT NULL)
            AND ${dissolvedFilter}
          ORDER BY m.id DESC LIMIT 1`
      ).bind(me.id, me.id, me.id).first();

      const upcomingEvent = await env.DB.prepare(
        `SELECT e.message_id,m.conversation_id,c.name AS conversation_name,e.title,e.start_at,e.end_at,e.location,e.meeting_url,a.response
           FROM chat_events e
           JOIN messages m ON m.id=e.message_id
           JOIN chat_event_attendees a ON a.message_id=e.message_id AND a.user_id=?
           JOIN conversations c ON c.id=m.conversation_id
           JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
          WHERE e.cancelled_at IS NULL AND m.deleted_at IS NULL AND a.response != 'declined'
            AND ${dissolvedFilter}
            AND datetime(COALESCE(e.end_at, datetime(e.start_at,'+2 hours'))) >= datetime(?)
            AND datetime(e.start_at) <= datetime(?,'+1 day')
          ORDER BY CASE WHEN datetime(e.start_at) <= datetime(?) THEN 0
                        WHEN datetime(e.start_at) <= datetime(?,'+30 minutes') THEN 1 ELSE 2 END,
                   datetime(e.start_at) ASC LIMIT 1`
      ).bind(me.id, me.id, nowHcm, nowHcm, nowHcm, nowHcm).first();

      return json({
        unread_count: Number(unread?.unread_count || 0),
        mention_count: Number(mentionCountRow?.mention_count || 0),
        mention: mention || null,
        upcoming_event: upcomingEvent || null,
      });
    } catch (_) {
      return json({ unread_count: 0, mention_count: 0, mention: null, upcoming_event: null });
    }
  },

  async listConversations({ env, me }) {
    const companyChannelId = await ensureCompanyChannel(env);
    if (!companyChannelId) return json({ conversations: [] });

    const c = await env.DB.prepare(
      `SELECT c.id, c.type, c.name, c.team_id, c.project_id, c.created_by, c.created_at,
        (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE((SELECT cm2.last_read_message_id FROM conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id = ?), 0) AND m.sender_id != ?) AS unread_count
       FROM conversations c
       WHERE c.id = ?`
    ).bind(me.id, me.id, companyChannelId).first();

    if (!c) return json({ conversations: [] });

    const lastMsg = await env.DB.prepare(
      `SELECT m.id, m.content, m.created_at, m.sender_id, u.full_name AS sender_name, m.deleted_at
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`
    ).bind(c.id).first();

    const members = await env.DB.prepare(
      `SELECT cm.user_id, u.full_name, u.employee_code, u.avatar_url, cm.role
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ?`
    ).bind(c.id).all().then(r => r.results || []);

    return json({ conversations: [{ ...c, last_message: lastMsg || null, members }] });
  },

  async createConversation() {
    return json({ error: 'Hệ thống sử dụng một kênh trao đổi chung duy nhất cho toàn công ty, không hỗ trợ tạo hội thoại riêng.' }, 403);
  },

  async getConversation({ env, me }, convId) {
    if (!(await chatMember(env, convId, me.id))) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);
    const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
    if (!conv) return json({ error: 'Không tìm thấy hội thoại' }, 404);
    const members = await env.DB.prepare(
      `SELECT cm.user_id, u.full_name, u.employee_code, u.avatar_url, cm.role, cm.last_read_message_id
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`
    ).bind(convId).all().then(r => r.results || []);
    return json({ ...conv, members });
  },

  async updateConversation({ env, request, me }, convId) {
    const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
    if (!conv) return json({ error: 'Không tìm thấy hội thoại' }, 404);
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'Tên không được để trống' }, 400);
    if (name.length > 200) return json({ error: 'Tên quá dài (tối đa 200 ký tự)' }, 400);
    await env.DB.prepare('UPDATE conversations SET name = ? WHERE id = ?').bind(name, convId).run();
    await broadcastChatUpdate(env, convId, { type: 'conversation:update', conversation_id: convId, name });
    await broadcastAppEvent(env, 'chat', 'chat:conversation_updated', { conversation_id: convId, name }, { actorId: me.id });
    return json({ ok: true, name });
  },

  async dissolveConversation({ env, me }, convId) {
    const conv = await env.DB.prepare(
      `SELECT c.id,c.type,c.name,cm.role,
              EXISTS(SELECT 1 FROM dissolved_conversations dc WHERE dc.conversation_id=c.id) AS is_dissolved
         FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
        WHERE c.id=? AND cm.user_id=?`
    ).bind(convId, me.id).first();
    if (!conv) return json({ error: 'Không tìm thấy nhóm' }, 404);
    if (conv.type === 'company' || conv.name === 'Kênh chung công ty') return json({ error: 'Không thể giải tán kênh chung công ty' }, 400);
    if (conv.type === 'direct') return json({ error: 'Hội thoại trực tiếp không thể giải tán' }, 400);
    if (conv.is_dissolved) return json({ error: 'Nhóm này đã được giải tán' }, 400);
    if (conv.role !== 'owner') return json({ error: 'Chỉ Owner mới được giải tán nhóm' }, 403);
    await env.DB.prepare(
      'INSERT INTO dissolved_conversations (conversation_id,dissolved_by,dissolved_by_name) VALUES (?,?,?)'
    ).bind(convId, me.id, me.full_name || '').run();
    await broadcastChatUpdate(env, convId, { type: 'conversation:dissolved', conversation_id: convId });
    await broadcastAppEvent(env, 'chat', 'chat:conversation_dissolved', { conversation_id: convId }, { actorId: me.id });
    return json({ ok: true, dissolved: true });
  },

  async manageMembers({ env, request }, convId) {
    const b = await request.json().catch(() => ({}));
    const action = b.action || 'add';
    const userIds = Array.isArray(b.user_ids) ? b.user_ids.map(Number) : [];
    if (action === 'add') {
      for (const uid of userIds) {
        await env.DB.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)')
          .bind(convId, uid, 'member').run();
      }
    } else if (action === 'remove') {
      for (const uid of userIds) {
        await env.DB.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND role != ?')
          .bind(convId, uid, 'owner').run();
      }
    }
    return json({ ok: true });
  },

  async listMessages({ env, url, me }, convId) {
    if (!(await chatMember(env, convId, me.id))) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);
    const before = url.searchParams.get('before');
    const around = Number(url.searchParams.get('around') || 0);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);
    let q = `SELECT m.*, u.full_name AS sender_name, u.employee_code AS sender_code, u.avatar_url AS sender_avatar,
       EXISTS(SELECT 1 FROM pinned_messages pm WHERE pm.message_id = m.id) AS is_pinned
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ?`;
    const binds = [convId];
    if (around > 0) { q += ' AND m.id >= ? ORDER BY m.id ASC LIMIT ?'; binds.push(around, limit); }
    else { if (before) { q += ' AND m.id < ?'; binds.push(Number(before)); } q += ' ORDER BY m.id DESC LIMIT ?'; binds.push(limit); }
    const { results = [] } = await env.DB.prepare(q).bind(...binds).all();
    if (!around) results.reverse();
    const messageIds = results.map(r => r.id);
    let attachments = [];
    let reactions = [];
    if (messageIds.length) {
      const placeholders = messageIds.map(() => '?').join(',');
      const { results: atts = [] } = await env.DB.prepare(
        `SELECT * FROM message_attachments WHERE message_id IN (${placeholders})`
      ).bind(...messageIds).all();
      attachments = atts;
      const { results: reacs = [] } = await env.DB.prepare(
        `SELECT mr.message_id, mr.emoji, mr.user_id, u.full_name AS user_name
         FROM message_reactions mr JOIN users u ON u.id = mr.user_id
         WHERE mr.message_id IN (${placeholders})`
      ).bind(...messageIds).all();
      reactions = reacs;
    }
    const attMap = {};
    for (const a of attachments) { if (!attMap[a.message_id]) attMap[a.message_id] = []; attMap[a.message_id].push(a); }
    const reacMap = {};
    for (const r of reactions) { if (!reacMap[r.message_id]) reacMap[r.message_id] = []; reacMap[r.message_id].push(r); }
    let mentions = [];
    if (messageIds.length) {
      const placeholders = messageIds.map(() => '?').join(',');
      const { results = [] } = await env.DB.prepare(
        `SELECT mm.message_id, mm.mentioned_user_id AS user_id, u.full_name
         FROM message_mentions mm JOIN users u ON u.id = mm.mentioned_user_id
         WHERE mm.message_id IN (${placeholders})`
      ).bind(...messageIds).all();
      mentions = results;
    }
    const mentionMap = {};
    for (const mention of mentions) { if (!mentionMap[mention.message_id]) mentionMap[mention.message_id] = []; mentionMap[mention.message_id].push(mention); }
    const messages = await hydrateChatMessages(env, results.map(m => ({
      ...m,
      attachments: attMap[m.id] || [],
      reactions: reacMap[m.id] || [],
      mentions: mentionMap[m.id] || [],
    })), me.id);
    return json({ messages, has_more: results.length >= limit });
  },

  async createMessage({ env, request, me }, convId, { sendWebPushNotification }) {
    const b = await request.json().catch(() => ({}));
    const content = String(b.content || '').trim();
    const messageType = ['text', 'poll', 'event'].includes(String(b.message_type || 'text')) ? String(b.message_type || 'text') : 'text';
    const member = await chatMember(env, convId, me.id);
    if (!member) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);
    if (messageType !== 'text' && member.type === 'direct') return json({ error: 'Poll và sự kiện chỉ dùng trong nhóm' }, 400);
    if (b.mention_all && (member.type === 'direct' || !/(^|\s)@all\b/i.test(content))) return json({ error: '@all chỉ dùng được trong nhóm' }, 400);
    if (messageType === 'text' && !content && !b.attachments?.length) return json({ error: 'Nội dung không được để trống' }, 400);
    const poll = b.poll && typeof b.poll === 'object' ? b.poll : null;
    const event = b.event && typeof b.event === 'object' ? b.event : null;
    if (messageType === 'poll') {
      const question = String(poll?.question || '').trim();
      const options = Array.isArray(poll?.options) ? poll.options.map(value => String(value || '').trim()).filter(Boolean) : [];
      if (!question || question.length > 500 || options.length < 2 || options.length > 10 || options.some(value => value.length > 200)) {
        return json({ error: 'Poll cần câu hỏi và từ 2 đến 10 lựa chọn hợp lệ' }, 400);
      }
    }
    if (messageType === 'event') {
      const title = String(event?.title || '').trim();
      const description = String(event?.description || '').trim();
      const location = String(event?.location || '').trim();
      const meetingUrl = String(event?.meeting_url || '').trim();
      const startAt = new Date(event?.start_at || '');
      const endAt = event?.end_at ? new Date(event.end_at) : null;
      if (!title || title.length > 200 || description.length > 2000 || location.length > 500 || (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) || Number.isNaN(startAt.getTime()) || (endAt && (Number.isNaN(endAt.getTime()) || endAt < startAt))) {
        return json({ error: 'Thông tin thời gian sự kiện không hợp lệ' }, 400);
      }
    }
    const result = await env.DB.prepare(
      'INSERT INTO messages (conversation_id, sender_id, content, reply_to_id, task_id, message_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(convId, me.id, content || null, b.reply_to_id ? Number(b.reply_to_id) : null, b.task_id ? Number(b.task_id) : null, messageType).run();
    const messageId = result.meta?.last_row_id;
    const mentionedUserIds = await saveMessageMentions(env, {
      conversationId: convId, messageId, mentionedBy: me.id, mentionIds: b.mention_ids,
    });
    await saveAllMention(env, { conversationId: convId, messageId, mentionedBy: me.id, requested: !!b.mention_all, content });
    if (messageType === 'poll') {
      await env.DB.prepare('INSERT INTO chat_polls (message_id,question,allows_multiple) VALUES (?,?,1)')
        .bind(messageId, String(poll.question).trim()).run();
      const options = poll.options.map(value => String(value || '').trim()).filter(Boolean);
      for (let index = 0; index < options.length; index++) {
        await env.DB.prepare('INSERT INTO chat_poll_options (message_id,option_text,position) VALUES (?,?,?)')
          .bind(messageId, options[index], index).run();
      }
    }
    if (messageType === 'event') {
      await env.DB.prepare(
        'INSERT INTO chat_events (message_id,title,start_at,end_at,description,location,meeting_url) VALUES (?,?,?,?,?,?,?)'
      ).bind(messageId, String(event.title).trim(), event.start_at, event.end_at || null, String(event.description || '').trim() || null, String(event.location || '').trim() || null, String(event.meeting_url || '').trim() || null).run();
      const { results: members } = await env.DB.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').bind(convId).all();
      const requested = Array.isArray(event.attendee_ids) ? new Set(event.attendee_ids.map(Number).filter(Boolean)) : null;
      for (const attendee of members) {
        if (!requested || requested.has(Number(attendee.user_id))) {
          await env.DB.prepare('INSERT INTO chat_event_attendees (message_id,user_id,response) VALUES (?,?,?)')
            .bind(messageId, attendee.user_id, Number(attendee.user_id) === Number(me.id) ? 'going' : 'invited').run();
        }
      }
    }
    if (b.attachments?.length) {
      for (const att of b.attachments) {
        await env.DB.prepare(
          'INSERT INTO message_attachments (message_id, type, file_name, file_size, mime_type, storage_key, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(messageId, att.type || 'file', att.file_name, att.file_size || 0, att.mime_type || '', att.storage_key, att.width || null, att.height || null).run();
      }
    }
    const message = await getChatMessage(env, messageId, me.id);
    await broadcastChatUpdate(env, convId, { type: 'message:new', message });

    let recipientIds = [];
    try {
      const { results: memberRows = [] } = await env.DB.prepare(
        'SELECT user_id FROM conversation_members WHERE conversation_id = ?'
      ).bind(convId).all();
      recipientIds = memberRows
        .map(r => Number(r.user_id))
        .filter(uid => uid && uid !== Number(me.id));
      if (recipientIds.length && typeof sendWebPushNotification === 'function') {
        const convRow = await env.DB.prepare('SELECT name, type FROM conversations WHERE id = ?').bind(convId).first();
        const senderName = message.sender_name || me.full_name || 'NetViet Chat';
        const isGroup = convRow?.type !== 'direct';
        const title = isGroup && convRow?.name ? `${convRow.name} (${senderName})` : senderName;
        const preview = message.content || (message.attachments?.length ? '📎 [Tệp đính kèm]' : (message.poll ? '📊 [Cuộc bình chọn]' : (message.event ? '📅 [Sự kiện]' : 'Đã gửi một tin nhắn')));
        await sendWebPushNotification(env, recipientIds, {
          title,
          body: preview,
          icon: message.sender_avatar || '/icon-192.png',
          badge: '/icon-192.png',
          url: `/#/chat/${convId}/${messageId}`,
          tag: `chat-${convId}-${messageId || Date.now()}`,
        });
      }
    } catch (pushErr) {
      console.warn('Failed to dispatch chat push notification:', pushErr);
    }

    await broadcastAppEvent(env, 'chat', 'chat:message_created', {
      conversation_id: convId,
      message,
    }, {
      actorId: me.id,
      targetUserIds: recipientIds.concat(Number(me.id)),
    });

    return json({ message, mentioned_user_ids: mentionedUserIds });
  },

  async getPinnedMessages({ env, me }, convId) {
    const member = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(convId, me.id).first();
    if (!member) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);
    const { results = [] } = await env.DB.prepare(
      `SELECT m.*, u.full_name AS sender_name, u.avatar_url AS sender_avatar, pm.pinned_by, pm.created_at AS pinned_at,
       1 AS is_pinned FROM pinned_messages pm JOIN messages m ON m.id = pm.message_id
       JOIN users u ON u.id = m.sender_id WHERE pm.conversation_id = ? AND m.deleted_at IS NULL
       ORDER BY pm.created_at DESC LIMIT 30`
    ).bind(convId).all();
    return json({ messages: await attachChatAttachments(env, results) });
  },

  async getSharedContent({ env, url, me }, convId, kind) {
    const member = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(convId, me.id).first();
    if (!member) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 24), 1), 100);
    if (kind === 'images' || kind === 'files') {
      const attachmentFilter = kind === 'images' ? "a.type = 'image'" : "a.type != 'image'";
      const { results = [] } = await env.DB.prepare(
        `SELECT a.*, m.id AS message_id, m.sender_id, m.created_at AS message_created_at, u.full_name AS sender_name
         FROM message_attachments a JOIN messages m ON m.id = a.message_id JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND ${attachmentFilter}
         ORDER BY a.id DESC LIMIT ?`
      ).bind(convId, limit).all();
      return json({ items: results });
    }
    const { results = [] } = await env.DB.prepare(
      `SELECT m.id AS message_id, m.content, m.created_at AS message_created_at, u.full_name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.content LIKE '%http%'
       ORDER BY m.id DESC LIMIT ?`
    ).bind(convId, limit).all();
    return json({ items: results });
  },

  async votePoll({ env, request, me }, messageId) {
    const message = await env.DB.prepare('SELECT conversation_id FROM messages WHERE id=? AND message_type=? AND deleted_at IS NULL')
      .bind(messageId, 'poll').first();
    if (!message) return json({ error: 'Không tìm thấy poll' }, 404);
    if (!(await chatMember(env, message.conversation_id, me.id))) return json({ error: 'Không có quyền' }, 403);
    const poll = await env.DB.prepare('SELECT is_closed FROM chat_polls WHERE message_id=?').bind(messageId).first();
    if (!poll || poll.is_closed) return json({ error: 'Poll đã đóng' }, 400);
    const body = await request.json().catch(() => ({}));
    const optionIds = [...new Set((Array.isArray(body.option_ids) ? body.option_ids : []).map(Number).filter(Number.isInteger))];
    const { results: options } = await env.DB.prepare('SELECT id FROM chat_poll_options WHERE message_id=?').bind(messageId).all();
    const validIds = new Set(options.map(option => Number(option.id)));
    if (optionIds.some(id => !validIds.has(id))) return json({ error: 'Lựa chọn không thuộc poll này' }, 400);
    await env.DB.prepare('DELETE FROM chat_poll_votes WHERE user_id=? AND option_id IN (SELECT id FROM chat_poll_options WHERE message_id=?)')
      .bind(me.id, messageId).run();
    for (const optionId of optionIds) {
      await env.DB.prepare('INSERT OR IGNORE INTO chat_poll_votes (option_id,user_id) VALUES (?,?)').bind(optionId, me.id).run();
    }
    const updated = await getChatMessage(env, messageId, me.id);
    await broadcastChatUpdate(env, message.conversation_id, { type: 'poll:update', message_id: messageId, poll: updated?.poll });
    await broadcastAppEvent(env, 'chat', 'chat:poll_updated', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      poll: updated?.poll,
    }, { actorId: me.id });
    return json({ poll: updated?.poll || null });
  },

  async closePoll({ env, me }, messageId) {
    const message = await env.DB.prepare('SELECT conversation_id,sender_id FROM messages WHERE id=? AND message_type=? AND deleted_at IS NULL')
      .bind(messageId, 'poll').first();
    if (!message) return json({ error: 'Không tìm thấy poll' }, 404);
    if (Number(message.sender_id) !== Number(me.id)) return json({ error: 'Chỉ người tạo được đóng poll' }, 403);
    await env.DB.prepare("UPDATE chat_polls SET is_closed=1,closed_by=?,closed_at=datetime('now','localtime') WHERE message_id=?")
      .bind(me.id, messageId).run();
    const updated = await getChatMessage(env, messageId, me.id);
    await broadcastChatUpdate(env, message.conversation_id, { type: 'poll:update', message_id: messageId, poll: updated?.poll });
    await broadcastAppEvent(env, 'chat', 'chat:poll_updated', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      poll: updated?.poll,
    }, { actorId: me.id });
    return json({ poll: updated?.poll || null });
  },

  async updateEvent({ env, request, me }, messageId) {
    const message = await env.DB.prepare('SELECT conversation_id,sender_id FROM messages WHERE id=? AND message_type=? AND deleted_at IS NULL')
      .bind(messageId, 'event').first();
    if (!message) return json({ error: 'Không tìm thấy sự kiện' }, 404);
    if (Number(message.sender_id) !== Number(me.id)) return json({ error: 'Chỉ người tạo được sửa sự kiện' }, 403);
    const event = (await request.json().catch(() => ({}))).event || {};
    const title = String(event.title || '').trim();
    const description = String(event.description || '').trim();
    const location = String(event.location || '').trim();
    const meetingUrl = String(event.meeting_url || '').trim();
    const startAt = new Date(event.start_at || '');
    const endAt = event.end_at ? new Date(event.end_at) : null;
    if (!title || title.length > 200 || description.length > 2000 || location.length > 500 || (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) || Number.isNaN(startAt.getTime()) || (endAt && (Number.isNaN(endAt.getTime()) || endAt < startAt))) {
      return json({ error: 'Thông tin thời gian sự kiện không hợp lệ' }, 400);
    }
    await env.DB.prepare('UPDATE chat_events SET title=?,start_at=?,end_at=?,description=?,location=?,meeting_url=? WHERE message_id=? AND cancelled_at IS NULL')
      .bind(title, event.start_at, event.end_at || null, description || null, location || null, meetingUrl || null, messageId).run();
    const updated = await getChatMessage(env, messageId, me.id);
    await broadcastChatUpdate(env, message.conversation_id, { type: 'event:update', message_id: messageId, event: updated?.event });
    await broadcastAppEvent(env, 'chat', 'chat:event_updated', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      event: updated?.event,
    }, { actorId: me.id });
    return json({ event: updated?.event || null });
  },

  async respondEvent({ env, request, me }, messageId) {
    const message = await env.DB.prepare('SELECT conversation_id FROM messages WHERE id=? AND message_type=? AND deleted_at IS NULL')
      .bind(messageId, 'event').first();
    if (!message || !(await chatMember(env, message.conversation_id, me.id))) return json({ error: 'Không có quyền hoặc sự kiện không tồn tại' }, 403);
    const response = String((await request.json().catch(() => ({}))).response || '');
    if (!['going', 'declined'].includes(response)) return json({ error: 'Phản hồi không hợp lệ' }, 400);
    const invited = await env.DB.prepare('SELECT 1 FROM chat_event_attendees WHERE message_id=? AND user_id=?').bind(messageId, me.id).first();
    if (!invited) return json({ error: 'Bạn không nằm trong danh sách mời' }, 403);
    await env.DB.prepare("UPDATE chat_event_attendees SET response=?,responded_at=datetime('now','localtime') WHERE message_id=? AND user_id=?")
      .bind(response, messageId, me.id).run();
    const updated = await getChatMessage(env, messageId, me.id);
    await broadcastChatUpdate(env, message.conversation_id, { type: 'event:update', message_id: messageId, event: updated?.event });
    await broadcastAppEvent(env, 'chat', 'chat:event_updated', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      event: updated?.event,
    }, { actorId: me.id });
    return json({ event: updated?.event || null });
  },

  async cancelEvent({ env, me }, messageId) {
    const message = await env.DB.prepare('SELECT conversation_id,sender_id FROM messages WHERE id=? AND message_type=? AND deleted_at IS NULL')
      .bind(messageId, 'event').first();
    if (!message) return json({ error: 'Không tìm thấy sự kiện' }, 404);
    if (Number(message.sender_id) !== Number(me.id)) return json({ error: 'Chỉ người tạo được hủy sự kiện' }, 403);
    await env.DB.prepare("UPDATE chat_events SET cancelled_at=datetime('now','localtime'),cancelled_by=? WHERE message_id=?")
      .bind(me.id, messageId).run();
    const updated = await getChatMessage(env, messageId, me.id);
    await broadcastChatUpdate(env, message.conversation_id, { type: 'event:update', message_id: messageId, event: updated?.event });
    await broadcastAppEvent(env, 'chat', 'chat:event_updated', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      event: updated?.event,
    }, { actorId: me.id });
    return json({ event: updated?.event || null });
  },

  async updateMessage({ env, request, me }, msgId) {
    const existing = await env.DB.prepare(
      'SELECT conversation_id, sender_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(msgId).first();
    if (!existing) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    if (Number(existing.sender_id) !== Number(me.id)) {
      return json({ error: 'Chỉ người gửi mới được sửa tin nhắn' }, 403);
    }
    const b = await request.json().catch(() => ({}));
    const content = String(b.content || '').trim();
    if (!content) return json({ error: 'Nội dung không được để trống' }, 400);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND sender_id = ?')
      .bind(content, now, msgId, me.id).run();
    const updated = await getChatMessage(env, msgId, me.id);
    await broadcastChatUpdate(env, existing.conversation_id, { type: 'message:edit', message: updated });
    await broadcastAppEvent(env, 'chat', 'chat:message_edited', {
      conversation_id: existing.conversation_id,
      message_id: msgId,
      message: updated,
    }, { actorId: me.id });
    return json({ ok: true, message: updated });
  },

  async deleteMessage({ env, me }, msgId, { isAttendanceHcns }) {
    const existing = await env.DB.prepare(
      'SELECT conversation_id, sender_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(msgId).first();
    if (!existing) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    const canModerate = ['admin', 'director', 'manager'].includes(me.role) || isAttendanceHcns;
    if (Number(existing.sender_id) !== Number(me.id) && !canModerate) {
      return json({ error: 'Chỉ người gửi hoặc Quản lý/Quản trị viên mới được xóa tin nhắn' }, 403);
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?')
      .bind(now, msgId).run();
    await broadcastChatUpdate(env, existing.conversation_id, {
      type: 'message:delete',
      message_id: msgId,
      deleted_at: now,
    });
    await broadcastAppEvent(env, 'chat', 'chat:message_deleted', {
      conversation_id: existing.conversation_id,
      message_id: msgId,
      deleted_at: now,
    }, { actorId: me.id });
    return json({ ok: true, message_id: msgId, deleted_at: now });
  },

  async pinMessage({ env, request, me }, messageId, { isAttendanceHcns }) {
    const message = await env.DB.prepare('SELECT id, conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL').bind(messageId).first();
    if (!message) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    const member = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(message.conversation_id, me.id).first();
    if (!member) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);

    const isPinning = request.method === 'POST';
    const canPin = ['admin', 'director', 'manager'].includes(me.role) || isAttendanceHcns;
    if (isPinning && !canPin) {
      return json({ error: 'Chỉ Quản trị viên và Quản lý mới có quyền ghim thông báo' }, 403);
    }
    if (isPinning) {
      await env.DB.prepare('INSERT OR IGNORE INTO pinned_messages (conversation_id, message_id, pinned_by) VALUES (?, ?, ?)')
        .bind(message.conversation_id, messageId, me.id).run();
    } else {
      await env.DB.prepare('DELETE FROM pinned_messages WHERE conversation_id = ? AND message_id = ?')
        .bind(message.conversation_id, messageId).run();
    }
    await broadcastChatUpdate(env, message.conversation_id, {
      type: 'message:pin',
      message_id: messageId,
      conversation_id: message.conversation_id,
      is_pinned: isPinning,
      pinned_by: me.id,
    });
    await broadcastAppEvent(env, 'chat', 'chat:message_pinned', {
      conversation_id: message.conversation_id,
      message_id: messageId,
      is_pinned: isPinning,
      pinned_by: me.id,
    }, { actorId: me.id });
    return json({ ok: true, pinned: isPinning, message_id: messageId });
  },

  async toggleReaction({ env, request, url, me }, msgId) {
    const message = await env.DB.prepare(
      'SELECT id, conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL'
    ).bind(msgId).first();
    if (!message) return json({ error: 'Không tìm thấy tin nhắn' }, 404);

    const isMember = await chatMember(env, message.conversation_id, me.id);
    if (!isMember) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);

    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const emoji = String(b.emoji || '').trim();
      if (!emoji) return json({ error: 'Emoji là bắt buộc' }, 400);
      await env.DB.prepare('INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
        .bind(msgId, me.id, emoji).run();
    } else {
      const emoji = url.searchParams.get('emoji') || '';
      if (emoji) {
        await env.DB.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
          .bind(msgId, me.id, emoji).run();
      } else {
        await env.DB.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?')
          .bind(msgId, me.id).run();
      }
    }

    const { results: reactions = [] } = await env.DB.prepare(
      `SELECT mr.emoji, mr.user_id, u.full_name AS user_name
       FROM message_reactions mr JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = ?`
    ).bind(msgId).all();

    await broadcastChatUpdate(env, message.conversation_id, {
      type: 'reaction:update',
      message_id: msgId,
      conversation_id: message.conversation_id,
      reactions,
    });
    await broadcastAppEvent(env, 'chat', 'chat:reaction_updated', {
      conversation_id: message.conversation_id,
      message_id: msgId,
      reactions,
    }, { actorId: me.id });

    return json({ ok: true, reactions });
  },

  async markRead({ env, me }, msgId) {
    const msg = await env.DB.prepare('SELECT conversation_id FROM messages WHERE id = ?').bind(msgId).first();
    if (!msg) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    const isMember = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(msg.conversation_id, me.id).first();
    if (!isMember) return json({ error: 'Không có quyền' }, 403);
    await env.DB.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)')
      .bind(msgId, me.id).run();
    await env.DB.prepare(
      'UPDATE conversation_members SET last_read_message_id = MAX(COALESCE(last_read_message_id,0), ?) WHERE conversation_id = ? AND user_id = ?'
    ).bind(msgId, msg.conversation_id, me.id).run();
    await broadcastChatUpdate(env, msg.conversation_id, { type: 'conversation:read', user_id: me.id, message_id: msgId });
    return json({ ok: true });
  },

  async searchMessages({ env, url, me }) {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length < 2) return json({ error: 'Từ khóa tối thiểu 2 ký tự' }, 400);
    const convId = url.searchParams.get('conversation_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    let sql = `SELECT m.*, u.full_name AS sender_name, c.name AS conversation_name, c.type AS conversation_type
       FROM messages m JOIN users u ON u.id = m.sender_id
       JOIN conversations c ON c.id = m.conversation_id
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
       WHERE m.content LIKE ?1 AND m.deleted_at IS NULL`;
    const binds = [me.id];
    if (convId) { sql += ' AND m.conversation_id = ?'; binds.push(Number(convId)); }
    sql += ' ORDER BY m.id DESC LIMIT ?'; binds.push(limit);
    const { results = [] } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ results });
  },

  async serveDocument({ env, url, me }, storageKey) {
    if (!storageKey.startsWith('chat/')) return json({ error: 'Không tìm thấy tệp' }, 404);
    const attachment = await env.DB.prepare(
      `SELECT a.file_name, a.mime_type, m.conversation_id
       FROM message_attachments a JOIN messages m ON m.id = a.message_id
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
       WHERE a.storage_key = ? AND m.deleted_at IS NULL LIMIT 1`
    ).bind(me.id, storageKey).first();
    if (!attachment) return json({ error: 'Không có quyền truy cập tệp này' }, 403);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ tệp chat chưa được cấu hình' }, 503);
    const object = await env.HR_DOCUMENTS.get(storageKey);
    if (!object) return json({ error: 'Tệp không tồn tại trên kho lưu trữ' }, 404);
    const filename = safeDownloadName(attachment.file_name || storageKey.split('/').pop() || 'download');
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    return new Response(object.body, { headers: {
      'Content-Type': attachment.mime_type || object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  },

  async uploadDocument({ env, request, me }, convId) {
    const isMember = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(convId, me.id).first();
    if (!isMember) return json({ error: 'Không có quyền tải tệp lên hội thoại này' }, 403);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file.name !== 'string') return json({ error: 'Vui lòng chọn file' }, 400);
    const buffer = await file.arrayBuffer();
    const key = `chat/${convId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await env.HR_DOCUMENTS.put(key, buffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    const isImage = String(file.type || '').startsWith('image/');
    return json({
      storage_key: key,
      file_name: file.name,
      file_size: buffer.byteLength,
      mime_type: file.type || 'application/octet-stream',
      type: isImage ? 'image' : 'file',
    });
  },

  async upgradeWebSocket({ env, request, me }, convId) {
    const isMember = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(convId, me.id).first();
    if (!isMember) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);

    const doId = env.CHAT_ROOM.idFromName(String(convId));
    const stub = env.CHAT_ROOM.get(doId);
    const wsUrl = new URL(request.url);
    wsUrl.searchParams.set('conv', String(convId));
    return stub.fetch(new Request(wsUrl.toString(), request));
  }
};
