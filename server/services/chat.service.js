export async function saveMessageMentions(env, { conversationId, messageId, mentionedBy, mentionIds }) {
  const requestedIds = [...new Set((Array.isArray(mentionIds) ? mentionIds : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0 && id !== mentionedBy))].slice(0, 25);
  if (!requestedIds.length) return [];

  const placeholders = requestedIds.map(() => '?').join(',');
  const { results = [] } = await env.DB.prepare(
    `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id IN (${placeholders})`
  ).bind(conversationId, ...requestedIds).all();
  const validIds = results.map(row => Number(row.user_id));
  for (const userId of validIds) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO message_mentions (message_id, mentioned_user_id, mentioned_by) VALUES (?, ?, ?)'
    ).bind(messageId, userId, mentionedBy).run();
  }
  return validIds;
}

export async function chatMember(env, conversationId, userId) {
  const baseSql = `SELECT cm.role,c.type FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id
      WHERE cm.conversation_id=? AND cm.user_id=?`;
  try {
    return await env.DB.prepare(
      `${baseSql} AND NOT EXISTS (SELECT 1 FROM dissolved_conversations dc WHERE dc.conversation_id=c.id)`
    ).bind(conversationId, userId).first();
  } catch (error) {
    console.error('Conversation dissolve membership filter unavailable; using legacy membership check', error);
    return await env.DB.prepare(baseSql).bind(conversationId, userId).first();
  }
}

export async function saveAllMention(env, { conversationId, messageId, mentionedBy, requested, content }) {
  if (!requested) return false;
  const member = await chatMember(env, conversationId, mentionedBy);
  if (!member || member.type === 'direct' || !/(^|\s)@all\b/i.test(String(content || ''))) {
    throw new Error('@all chỉ dùng được trong nhóm');
  }
  await env.DB.prepare('INSERT OR IGNORE INTO message_all_mentions (message_id,mentioned_by) VALUES (?,?)')
    .bind(messageId, mentionedBy).run();
  return true;
}

export async function hydrateChatMessages(env, messageRows, viewerId) {
  const ids = messageRows.map(row => Number(row.id)).filter(Boolean);
  if (!ids.length) return messageRows;
  const placeholders = ids.map(() => '?').join(',');
  const [attachmentsResult, reactionsResult, mentionsResult, allMentionsResult, pollsResult, optionsResult, eventsResult, attendeeResult, readersResult] = await Promise.all([
    env.DB.prepare(`SELECT * FROM message_attachments WHERE message_id IN (${placeholders}) ORDER BY id`).bind(...ids).all(),
    env.DB.prepare(`SELECT mr.message_id,mr.emoji,mr.user_id,u.full_name AS user_name FROM message_reactions mr JOIN users u ON u.id=mr.user_id WHERE mr.message_id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT mm.message_id,mm.mentioned_user_id AS user_id,u.full_name FROM message_mentions mm JOIN users u ON u.id=mm.mentioned_user_id WHERE mm.message_id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT message_id FROM message_all_mentions WHERE message_id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT * FROM chat_polls WHERE message_id IN (${placeholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT o.id,o.message_id,o.option_text,o.position,COUNT(v.user_id) AS vote_count
                      FROM chat_poll_options o LEFT JOIN chat_poll_votes v ON v.option_id=o.id
                     WHERE o.message_id IN (${placeholders}) GROUP BY o.id ORDER BY o.position,o.id`).bind(...ids).all(),
    env.DB.prepare(`SELECT e.*,COUNT(a.user_id) AS attendee_count,
                      SUM(CASE WHEN a.response='going' THEN 1 ELSE 0 END) AS going_count
                      FROM chat_events e LEFT JOIN chat_event_attendees a ON a.message_id=e.message_id
                     WHERE e.message_id IN (${placeholders}) GROUP BY e.message_id`).bind(...ids).all(),
    env.DB.prepare(`SELECT message_id,response FROM chat_event_attendees WHERE user_id=? AND message_id IN (${placeholders})`).bind(viewerId, ...ids).all(),
    env.DB.prepare(`SELECT m.id AS message_id,cm.user_id,u.full_name,u.avatar_url
                      FROM messages m
                      JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
                      JOIN users u ON u.id=cm.user_id
                     WHERE m.id IN (${placeholders})
                       AND cm.user_id != m.sender_id
                       AND COALESCE(cm.last_read_message_id,0) >= m.id`).bind(...ids).all(),
  ]);
  const mapBy = (rows, key) => rows.reduce((map, row) => { (map[row[key]] ||= []).push(row); return map; }, {});
  const attachments = mapBy(attachmentsResult.results || [], 'message_id');
  const reactions = mapBy(reactionsResult.results || [], 'message_id');
  const mentions = mapBy(mentionsResult.results || [], 'message_id');
  const allMentionIds = new Set((allMentionsResult.results || []).map(row => Number(row.message_id)));
  const pollByMessage = Object.fromEntries((pollsResult.results || []).map(row => [row.message_id, { ...row, options: [] }]));
  for (const option of optionsResult.results || []) if (pollByMessage[option.message_id]) pollByMessage[option.message_id].options.push(option);
  const eventByMessage = Object.fromEntries((eventsResult.results || []).map(row => [row.message_id, row]));
  const responseByEvent = Object.fromEntries((attendeeResult.results || []).map(row => [row.message_id, row.response]));
  const readers = mapBy(readersResult.results || [], 'message_id');
  for (const poll of Object.values(pollByMessage)) {
    const optionIds = poll.options.map(option => option.id);
    if (!optionIds.length) { poll.voted_option_ids = []; continue; }
    const own = await env.DB.prepare(`SELECT option_id FROM chat_poll_votes WHERE user_id=? AND option_id IN (${optionIds.map(() => '?').join(',')})`)
      .bind(viewerId, ...optionIds).all();
    poll.voted_option_ids = (own.results || []).map(row => row.option_id);
  }
  return messageRows.map(row => ({
    ...row,
    attachments: attachments[row.id] || [],
    reactions: reactions[row.id] || [],
    mentions: mentions[row.id] || [],
    mention_all: allMentionIds.has(Number(row.id)),
    read_by: readers[row.id] || [],
    poll: pollByMessage[row.id] || null,
    event: eventByMessage[row.id] ? { ...eventByMessage[row.id], my_response: responseByEvent[row.id] || null } : null,
  }));
}

export async function getChatMessage(env, messageId, viewerId) {
  const row = await env.DB.prepare(
    `SELECT m.*,u.full_name AS sender_name,u.employee_code AS sender_code,u.avatar_url AS sender_avatar,
       EXISTS(SELECT 1 FROM pinned_messages pm WHERE pm.message_id=m.id) AS is_pinned
       FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`
  ).bind(messageId).first();
  return row ? (await hydrateChatMessages(env, [row], viewerId))[0] : null;
}

export async function broadcastChatUpdate(env, conversationId, payload) {
  if (!env.CHAT_ROOM) return;
  try {
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(String(conversationId)));
    await stub.fetch('https://chat-room.internal/broadcast', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) { console.warn('Chat broadcast failed', error?.message || error); }
}

const CHAT_EMOJI_FALLBACK = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😭','😡','👍','👎','❤️','🎉','✅','🔥','👏','🙏','👀'];
let _chatEmojiCache = { expiresAt: 0, emojis: CHAT_EMOJI_FALLBACK };

export async function getChatEmojis() {
  if (_chatEmojiCache.expiresAt > Date.now()) return _chatEmojiCache.emojis;
  try {
    const response = await fetch('https://emojihub.yurace.pro/api/all', { cf: { cacheTtl: 86400, cacheEverything: true } });
    const data = await response.json();
    const emojis = [...new Set((Array.isArray(data) ? data : []).map(item => String(item.htmlCode?.[0] || '')
      .replace(/&#x([0-9a-f]+);|&#(\d+);/gi, (_, hex, decimal) => String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10)))).filter(Boolean))].slice(0, 400);
    if (emojis.length) _chatEmojiCache = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, emojis };
  } catch (_) { _chatEmojiCache = { expiresAt: Date.now() + 5 * 60 * 1000, emojis: CHAT_EMOJI_FALLBACK }; }
  return _chatEmojiCache.emojis;
}

export async function ensureCompanyChannel(env) {
  let conv = await env.DB.prepare("SELECT id, name, type FROM conversations WHERE type = 'company' LIMIT 1").first();
  if (!conv) {
    conv = await env.DB.prepare("SELECT id, name, type FROM conversations WHERE name = 'Kênh chung công ty' LIMIT 1").first();
    if (conv) {
      await env.DB.prepare("UPDATE conversations SET type = 'company' WHERE id = ?").bind(conv.id).run();
    } else {
      const ins = await env.DB.prepare(
        "INSERT INTO conversations (type, name, created_by) VALUES ('company', 'Kênh chung công ty', 1)"
      ).run();
      conv = { id: ins.meta?.last_row_id };
    }
  }
  if (conv && conv.id) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role)
       SELECT ?, id, CASE WHEN role IN ('admin','director') THEN 'owner' WHEN role = 'manager' THEN 'admin' ELSE 'member' END
       FROM users WHERE is_active = 1`
    ).bind(conv.id).run();
    return conv.id;
  }
  return null;
}

export async function ensureChatInteractionSchema(env) {
  try { await env.DB.exec("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'"); } catch (_) {}
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS message_all_mentions (
    message_id INTEGER PRIMARY KEY,
    mentioned_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS chat_polls (
    message_id INTEGER PRIMARY KEY,
    question TEXT NOT NULL,
    allows_multiple INTEGER NOT NULL DEFAULT 1,
    is_closed INTEGER NOT NULL DEFAULT 0,
    closed_by INTEGER,
    closed_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS chat_poll_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    option_text TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS chat_poll_votes (
    option_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(option_id,user_id)
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS chat_events (
    message_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT,
    description TEXT,
    location TEXT,
    meeting_url TEXT,
    cancelled_at TEXT,
    cancelled_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS chat_event_attendees (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    response TEXT NOT NULL DEFAULT 'invited',
    responded_at TEXT,
    UNIQUE(message_id,user_id)
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS dissolved_conversations (
    conversation_id INTEGER PRIMARY KEY,
    dissolved_by INTEGER NOT NULL,
    dissolved_by_name TEXT,
    dissolved_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  for (const statement of [
    'CREATE INDEX IF NOT EXISTS idx_chat_poll_options_message ON chat_poll_options(message_id,position,id)',
    'CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_option ON chat_poll_votes(option_id,user_id)',
    'CREATE INDEX IF NOT EXISTS idx_chat_event_attendees_user ON chat_event_attendees(user_id,message_id)',
  ]) { try { await env.DB.exec(statement); } catch (_) {} }
  for (const [column, type] of Object.entries({
    dissolved_at: 'TEXT', dissolved_by: 'INTEGER', dissolved_by_name: 'TEXT',
  })) { try { await env.DB.exec(`ALTER TABLE conversations ADD COLUMN ${column} ${type}`); } catch (_) {} }
  try { await ensureCompanyChannel(env); } catch (_) {}
}

export async function attachChatAttachments(env, messageRows) {
  const ids = messageRows.map(row => Number(row.id)).filter(Boolean);
  if (!ids.length) return messageRows;
  const placeholders = ids.map(() => '?').join(',');
  const { results = [] } = await env.DB.prepare(
    `SELECT * FROM message_attachments WHERE message_id IN (${placeholders}) ORDER BY id ASC`
  ).bind(...ids).all();
  const byMessage = {};
  for (const attachment of results) (byMessage[attachment.message_id] ||= []).push(attachment);
  return messageRows.map(row => ({ ...row, attachments: byMessage[row.id] || [] }));
}
