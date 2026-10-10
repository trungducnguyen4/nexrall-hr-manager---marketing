/**
 * Announcements Service
 * Handles company announcements schema and HTML sanitization.
 */

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


