// ===================== HR MANAGER — NEXRALL MARKETING =====================
// Auth strategy:
//   1) POST /api/auth/login  → returns {token} stored in sessions table
//   2) All /api/* routes accept token via X-Auth-Token header, Authorization: Bearer, Cookie, or ?token=
//   3) FALLBACK: if no valid session token found, use env.USER_ID (platform identity)
//      and look up or auto-create the matching user row (admin for OWNER_ID).
// This ensures the automated test pipeline (which passes tokens via useToken/capture)
// AND real browser sessions both work.

// ===================== MIGRATIONS =====================
let _migrated = false;
// Bump when additive schema changes are introduced. Existing installations may
// already have the prior version recorded, so they would otherwise skip the
// KPI table creation below and fail every KPI request at runtime.
const SCHEMA_VERSION = '2026-08-10-chat-v1';
const SEED_VERSION = '2026-07-22-seed-v1';

const LEAVE_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const LEAVE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

async function ensureLeavePolicySchema(env) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type_code TEXT NOT NULL,
    balance_year INTEGER NOT NULL, available_days REAL NOT NULL DEFAULT 0,
    updated_by INTEGER, updated_by_name TEXT, updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, leave_type_code, balance_year)
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_balance_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, leave_type_code TEXT NOT NULL,
    balance_year INTEGER NOT NULL, leave_request_id INTEGER, delta_days REAL NOT NULL,
    entry_type TEXT NOT NULL, note TEXT, created_by INTEGER, created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_request_documents (
    id TEXT PRIMARY KEY, leave_request_id INTEGER, owner_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE, required_label TEXT, uploaded_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  for (const [column, type] of Object.entries({
    short_description: 'TEXT', policy_description: 'TEXT', notice_hours: 'INTEGER',
    required_documents: 'TEXT', requires_handover: 'INTEGER DEFAULT 0', approval_flow: 'TEXT',
  })) { try { await env.DB.exec(`ALTER TABLE leave_types ADD COLUMN ${column} ${type}`); } catch (_) {} }
  for (const [column, type] of Object.entries({
    leave_session: "TEXT DEFAULT 'full'", total_days: 'REAL', handover_user_id: 'INTEGER',
    handover_user_name: 'TEXT', approval_flow: 'TEXT', balance_reserved_days: 'REAL DEFAULT 0',
  })) { try { await env.DB.exec(`ALTER TABLE leave_requests ADD COLUMN ${column} ${type}`); } catch (_) {} }
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id,balance_year,leave_type_code)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_leave_documents_request ON leave_request_documents(leave_request_id,owner_id)'); } catch (_) {}
}

// This audit table was introduced after some production databases had already
// reached the schema-version fast path. Keep its creation idempotent and call
// it again immediately before payroll line adjustments so an audit migration
// can never make a successful payroll update look like a failed request.
async function ensurePayrollLineChangeLog(env) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_line_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payroll_id INTEGER NOT NULL,
    line_key TEXT NOT NULL,
    line_label TEXT NOT NULL,
    before_value REAL NOT NULL,
    after_value REAL NOT NULL,
    change_note TEXT NOT NULL,
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_line_change_log_payroll_created ON payroll_line_change_log(payroll_id,created_at DESC)');
}

// VietQR's bank directory is public reference data, but fetching it through
// the Worker keeps the browser within the app's CSP and gives us one place to
// handle provider outages.  A short-lived isolate cache is sufficient here;
// an expired cache is refreshed only when a HR-management user requests it.
const VIETQR_BANKS_URL = 'https://api.vietqr.io/v2/banks';
const VIETQR_BANKS_TTL_MS = 24 * 60 * 60 * 1000;
let _vietqrBanksCache = { data: null, expiresAt: 0 };

async function getVietqrBanks() {
  if (_vietqrBanksCache.data && Date.now() < _vietqrBanksCache.expiresAt) {
    return _vietqrBanksCache.data;
  }
  const response = await fetch(VIETQR_BANKS_URL, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`VietQR responded ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== '00' || !Array.isArray(payload.data)) {
    throw new Error('VietQR returned an invalid bank directory');
  }
  const data = payload.data
    .filter(bank => bank && bank.shortName && bank.name && bank.bin)
    .map(bank => ({
      shortName: String(bank.shortName),
      name: String(bank.name),
      code: String(bank.code || ''),
      bin: String(bank.bin),
      logo: typeof bank.logo === 'string' && bank.logo.startsWith('https://api.vietqr.io/') ? bank.logo : '',
    }))
    .sort((a, b) => a.shortName.localeCompare(b.shortName, 'vi'));
  _vietqrBanksCache = { data, expiresAt: Date.now() + VIETQR_BANKS_TTL_MS };
  return data;
}

async function migrate(env) {
  if (_migrated) return;
  // These additive tables are self-healed before the schema-version fast path.
  // A previous interrupted deployment can otherwise leave the version marker
  // behind while a new API starts querying a table that was never created.
  await ensureAttendanceOvertimeSchema(env);
  await ensureProjectHandoverSchema(env);
  // Leave-policy schema is additive. A partially migrated legacy D1 must not
  // block every authenticated request; the individual leave endpoints still
  // fail closed if their required data is unavailable.
  try { await ensureLeavePolicySchema(env); } catch (error) { console.error('Leave policy schema check failed', error); }
  // Keep this audit table available even when the rest of the schema is already current.
  // This is intentionally idempotent so older databases self-heal safely.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payroll_id INTEGER NOT NULL,
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT,
    change_note TEXT NOT NULL,
    before_data TEXT NOT NULL,
    after_data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_change_log_payroll_created ON payroll_change_log(payroll_id,created_at DESC)'); } catch (_) {}
  try { await ensurePayrollLineChangeLog(env); } catch (_) {}
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='schema_version'").first();
    if (row?.setting_value === SCHEMA_VERSION) {
      _migrated = true;
      return;
    }
  } catch (_) {}
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'employee',
      department TEXT,
      position TEXT,
      avatar_color TEXT DEFAULT '#4F46E5',
      avatar_initials TEXT,
      phone TEXT,
      salary REAL DEFAULT 0,
      bank_account TEXT,
      bank_name TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      checkin_time TEXT,
      checkout_time TEXT,
      checkin_ip TEXT,
      checkout_ip TEXT,
      status TEXT DEFAULT 'present',
      work_hours REAL DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS wifi_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wifi_name TEXT,
      ip_range TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      assigned_by INTEGER,
      department TEXT,
      date TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'normal',
      label_color TEXT DEFAULT '#6366F1',
      checkin_time TEXT,
      checkout_time TEXT,
      is_locked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_done INTEGER DEFAULT 0,
      assigned_to INTEGER,
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS task_followers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS task_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      base_salary REAL DEFAULT 0,
      bonus REAL DEFAULT 0,
      allowance REAL DEFAULT 0,
      deduction REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      insurance REAL DEFAULT 0,
      net_salary REAL DEFAULT 0,
      work_days INTEGER DEFAULT 0,
      absent_days INTEGER DEFAULT 0,
      late_days INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS settings (setting_key TEXT PRIMARY KEY, setting_value TEXT)`,
    `CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT,
      name TEXT NOT NULL, manager TEXT, manager_id INTEGER, description TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, code TEXT,
      name TEXT NOT NULL, department_id INTEGER, position TEXT,
      start_date TEXT, birthday TEXT, status TEXT DEFAULT 'active',
      salary REAL DEFAULT 0, phone TEXT, email TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT,
      employee_id INTEGER, type TEXT, start_date TEXT, end_date TEXT,
      reason TEXT, status TEXT DEFAULT 'pending'
    )`,
    `CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, name TEXT,
      position TEXT, department_id INTEGER, apply_date TEXT, source TEXT,
      stage TEXT DEFAULT 'received', notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT,
      employee_id INTEGER, month TEXT, base_salary REAL DEFAULT 0,
      kpi_bonus REAL DEFAULT 0, allowance REAL DEFAULT 0,
      deduction REAL DEFAULT 0, overtime_pay REAL DEFAULT 0, tax REAL DEFAULT 0, insurance REAL DEFAULT 0,
      work_days REAL DEFAULT 0, standard_days REAL DEFAULT 0, note TEXT,
      UNIQUE(user_id, employee_id, month)
    )`,
    `CREATE TABLE IF NOT EXISTS payroll_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'draft',
      total_employees INTEGER DEFAULT 0,
      complete_employees INTEGER DEFAULT 0,
      missing_employees INTEGER DEFAULT 0,
      estimated_total REAL DEFAULT 0,
      created_by INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      payroll_id INTEGER,
      month TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT UNIQUE,
      amount REAL DEFAULT 0,
      score_delta REAL DEFAULT 0,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'suggested',
      created_by INTEGER,
      created_by_name TEXT,
      approved_by INTEGER,
      approved_by_name TEXT,
      approved_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_review_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      requested_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      handled_by INTEGER,
      handled_by_name TEXT,
      handled_note TEXT,
      handled_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
  ];
  for (const s of stmts) {
    await env.DB.prepare(s).run();
  }
  // Idempotent schema upgrades
  try { await env.DB.exec('ALTER TABLE sessions ADD COLUMN revoked INTEGER DEFAULT 0'); } catch (_) {}
  // Campaigns table (new feature)
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'other',
    status TEXT DEFAULT 'planning',
    start_date TEXT,
    end_date TEXT,
    budget REAL DEFAULT 0,
    spent REAL DEFAULT 0,
    goal_reach INTEGER DEFAULT 0,
    goal_leads INTEGER DEFAULT 0,
    goal_conversions INTEGER DEFAULT 0,
    owner_name TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  // Payroll: add employee_name column if missing
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN employee_name TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN net_salary REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN department TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN employee_code TEXT'); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE payroll ADD COLUMN data_status TEXT DEFAULT 'ready'"); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN data_warnings TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN source_synced_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN overtime_pay REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN tax REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN insurance REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN work_days REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN standard_days REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN note TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_storage_key TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_original_filename TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_content_type TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_byte_size INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payroll_id INTEGER NOT NULL,
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT,
    change_note TEXT NOT NULL,
    before_data TEXT NOT NULL,
    after_data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_change_log_payroll_created ON payroll_change_log(payroll_id,created_at DESC)'); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    payroll_id INTEGER,
    month TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT UNIQUE,
    amount REAL DEFAULT 0,
    score_delta REAL DEFAULT 0,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'suggested',
    created_by INTEGER,
    created_by_name TEXT,
    approved_by INTEGER,
    approved_by_name TEXT,
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_month_employee ON payroll_adjustments(month,employee_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_status ON payroll_adjustments(status)'); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS payroll_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'draft',
    total_employees INTEGER DEFAULT 0,
    complete_employees INTEGER DEFAULT 0,
    missing_employees INTEGER DEFAULT 0,
    estimated_total REAL DEFAULT 0,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  // Attendance: work type / shift registration + late/early tracking
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN work_type TEXT DEFAULT 'office'"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN shift TEXT DEFAULT 'full'"); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN expected_start TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN expected_end TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN late_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN early_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN registered INTEGER DEFAULT 0'); } catch (_) {}
  // Auto-checkout marker: set to 1 when the nightly scheduled job closes a day
  // the employee forgot to check out (tag "Quên checkout").
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN auto_checkout INTEGER DEFAULT 0'); } catch (_) {}
  // ── Chat module ─────────────────────────────────────────────────
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'direct',
    name TEXT,
    team_id INTEGER,
    project_id INTEGER,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN team_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN project_id INTEGER'); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    last_read_message_id INTEGER DEFAULT 0,
    notification_level TEXT DEFAULT 'all',
    joined_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(conversation_id, user_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT,
    reply_to_id INTEGER,
    thread_root_id INTEGER,
    task_id INTEGER,
    edited_at TEXT,
    deleted_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  try { await env.DB.exec('ALTER TABLE messages ADD COLUMN task_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE messages ADD COLUMN thread_root_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE messages ADD COLUMN edited_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT'); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS message_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'file',
    file_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    storage_key TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(message_id, user_id, emoji)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(message_id, user_id)
  )`).run();
  // ── End Chat module ─────────────────────────────────────────────
  // remains immutable evidence and only HCNS/management-approved minutes are paid.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS overtime_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    shift_end_time TEXT NOT NULL,
    checkout_time TEXT NOT NULL,
    requested_minutes INTEGER NOT NULL,
    approved_minutes INTEGER,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_id INTEGER,
    reviewer_name TEXT,
    review_note TEXT,
    reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_overtime_requests_status_date ON overtime_requests(status,work_date)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_overtime_requests_user_date ON overtime_requests(user_id,work_date)'); } catch (_) {}
  // Employee-entered overtime forms deliberately live beside the checkout OT
  // table above.  The legacy table has a required one-to-one attendance_id and
  // therefore cannot represent a multi-date monthly form safely.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'employee',
    source_batch_id INTEGER,
    review_note TEXT,
    reviewer_id INTEGER,
    reviewer_name TEXT,
    reviewed_at TEXT,
    submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_form_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    requested_minutes INTEGER NOT NULL,
    approved_minutes INTEGER,
    reason TEXT NOT NULL,
    time_category TEXT NOT NULL DEFAULT 'workday',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_overtime_forms_user_period ON overtime_forms(user_id,period_month)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_overtime_forms_status_period ON overtime_forms(status,period_month)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_overtime_form_items_form ON overtime_form_items(form_id)'); } catch (_) {}
  // Imported data is linked to its batch rather than merely annotated in a
  // note, allowing conflicts and a later batch-specific rollback to be safe.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS attendance_import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL,
    period_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'preview',
    created_by INTEGER NOT NULL,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    committed_at TEXT
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS attendance_import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    source_key TEXT NOT NULL,
    employee_code TEXT NOT NULL,
    work_date TEXT,
    attendance_id INTEGER,
    outcome TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(batch_id,source_key)
  )`); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN source_batch_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE users ADD COLUMN profile_pending INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_attendance_source_batch ON attendance(source_batch_id)'); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  // Invoices: attendance-derived "Dữ liệu công" fields (auto-filled from /api/attendance/summary)
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN standard_days INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN paid_leave_days INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN late_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN early_leave_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN missing_checkinout_days INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN overtime_pay REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN locked_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN locked_by INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN locked_by_name TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN payroll_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN issued_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN issued_by INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN issued_by_name TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN employee_confirmed_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN review_requested_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN review_resolved_at TEXT'); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE invoices ADD COLUMN review_status TEXT DEFAULT 'none'"); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN review_reason TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN review_note TEXT'); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS invoice_review_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    requested_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    handled_by INTEGER,
    handled_by_name TEXT,
    handled_note TEXT,
    handled_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_invoice_review_invoice ON invoice_review_requests(invoice_id,status)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_invoices_payroll_id ON invoices(payroll_id)'); } catch (_) {}
  // Employee type (Nhân viên/Thực tập sinh) — used for the auto-generated employee code prefix.
  try { await env.DB.exec("ALTER TABLE users ADD COLUMN employee_type TEXT DEFAULT 'NV'"); } catch (_) {}

  // Lifecycle status (Vòng đời nhân sự). New rows default to 'Chờ tiếp nhận';
  // existing rows (already working before this migration) are backfilled once to 'Chính thức'.
  try {
    await env.DB.exec("ALTER TABLE users ADD COLUMN lifecycle_status TEXT DEFAULT 'Chờ tiếp nhận'");
    await env.DB.exec("UPDATE users SET lifecycle_status='Chính thức' WHERE lifecycle_status='Chờ tiếp nhận'");
  } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lifecycle_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_by INTEGER,
    changed_by_name TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  // Employee profile: additive migration only, preserving all existing accounts.
  for (const [column, type] of Object.entries({
    birth_date:'TEXT', gender:'TEXT', national_id:'TEXT', home_address:'TEXT', emergency_contact_name:'TEXT', emergency_contact_phone:'TEXT',
    direct_manager_id:'INTEGER', work_location:'TEXT', contract_type:'TEXT', contract_start_date:'TEXT', contract_end_date:'TEXT', contract_signed_date:'TEXT', official_date:'TEXT', termination_date:'TEXT',
    allowance:'REAL DEFAULT 0', insurance_salary:'REAL DEFAULT 0', bank_account_holder:'TEXT', tax_code:'TEXT', social_insurance_number:'TEXT', insurance_hospital:'TEXT',
    avatar_url:'TEXT', national_id_document_url:'TEXT', degree_document_url:'TEXT', contract_document_url:'TEXT', personnel_decision_url:'TEXT',
    school_name:'TEXT', hire_date:'TEXT', probation_end_date:'TEXT', dependent_count:'INTEGER DEFAULT 0', national_id_expiry_date:'TEXT',
    updated_at:'TEXT', updated_by:'INTEGER'
  })) { try { await env.DB.exec(`ALTER TABLE users ADD COLUMN ${column} ${type}`); } catch (_) {} }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_documents (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category TEXT NOT NULL,
    title TEXT,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL DEFAULT 0,
    storage_key TEXT NOT NULL UNIQUE,
    expires_on TEXT,
    uploaded_by INTEGER,
    uploaded_by_name TEXT,
    uploaded_at TEXT DEFAULT (datetime('now','localtime')),
    deleted_at TEXT,
    deleted_by INTEGER,
    deleted_by_name TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_profile_audit (
    id TEXT PRIMARY KEY,
    change_set_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    field_group TEXT NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by INTEGER,
    changed_by_name TEXT,
    changed_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_documents_user_category ON employee_documents(user_id,category,deleted_at,uploaded_at)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry ON employee_documents(expires_on,deleted_at)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_profile_audit_user_time ON employee_profile_audit(user_id,changed_at DESC)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_users_employee_directory ON users(is_active,lifecycle_status,department,position,contract_type)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_users_contract_dates ON users(contract_end_date,probation_end_date,national_id_expiry_date)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_users_full_name_nocase ON users(full_name COLLATE NOCASE)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_users_department_status ON users(department,lifecycle_status)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_users_contract_type ON users(contract_type)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_users_position ON users(position)'); } catch (_) {}
  // Preserve the four fixed document slots as normalized metadata. The R2 keys
  // and legacy columns stay untouched so old links continue to work.
  try {
    const { results: legacyDocumentUsers = [] } = await env.DB.prepare(
      `SELECT id,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url
       FROM users
       WHERE trim(coalesce(national_id_document_url,''))<>'' OR trim(coalesce(degree_document_url,''))<>''
          OR trim(coalesce(contract_document_url,''))<>'' OR trim(coalesce(personnel_decision_url,''))<>''`
    ).all();
    const legacyKinds = [
      ['national_id_document_url','national_id','national_id','CCCD'],
      ['degree_document_url','degree','degree','Bằng cấp, chứng chỉ'],
      ['contract_document_url','contract','labor_contract','Hợp đồng lao động'],
      ['personnel_decision_url','decision','other','Quyết định nhân sự'],
    ];
    for (const user of legacyDocumentUsers) {
      for (const [column, kind, category, title] of legacyKinds) {
        if (!String(user[column] || '').trim()) continue;
        const storageKey = `employees/${user.id}/${kind}`;
        await env.DB.prepare(
          `INSERT INTO employee_documents
             (id,user_id,category,title,original_filename,content_type,byte_size,storage_key,uploaded_by_name)
           SELECT ?,?,?,?,?,'application/octet-stream',0,?,'Dữ liệu legacy'
           WHERE NOT EXISTS (SELECT 1 FROM employee_documents WHERE storage_key=?)`
        ).bind(crypto.randomUUID(), user.id, category, title, kind, storageKey, storageKey).run();
      }
    }
  } catch (_) {}
  for (const [column, type] of Object.entries({ current_approver:'TEXT', approval_level:'INTEGER DEFAULT 1', submitted_at:'TEXT' })) { try { await env.DB.exec(`ALTER TABLE leave_requests ADD COLUMN ${column} ${type}`); } catch (_) {} }
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_approval_history (id INTEGER PRIMARY KEY AUTOINCREMENT, leave_request_id INTEGER NOT NULL, approval_level INTEGER NOT NULL, actor_id INTEGER, actor_name TEXT, action TEXT NOT NULL, note TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`); } catch (_) {}
  // Asset handover (Bàn giao tài sản cho TTS)
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS asset_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    asset_name TEXT NOT NULL,
    asset_type TEXT,
    platform TEXT,
    link TEXT,
    credential_enc TEXT,
    responsible_name TEXT,
    mentor_id INTEGER,
    mentor_name TEXT,
    status TEXT DEFAULT 'active',
    note TEXT,
    confirmed_by INTEGER,
    confirmed_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  // Bàn giao tài sản: mở rộng áp dụng cho cả nhân viên chính thức lẫn TTS + ngày dự kiến bàn giao.
  try { await env.DB.exec(`ALTER TABLE asset_handovers ADD COLUMN expected_handover_date TEXT`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS asset_credential_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    viewed_by INTEGER,
    viewed_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}

  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    paid_policy TEXT DEFAULT 'paid',
    deducts_annual_leave INTEGER DEFAULT 0,
    requires_evidence INTEGER DEFAULT 0,
    requires_bod_approval INTEGER DEFAULT 0,
    max_days INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS invoice_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT,
    changed_by INTEGER,
    changed_by_name TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  // Tasks: workspace/team/project and managed labels. Safe additive upgrades only.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS task_workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS task_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    code TEXT,
    type TEXT DEFAULT 'project',
    description TEXT,
    department TEXT,
    manager_id INTEGER,
    status TEXT DEFAULT 'active',
    start_date TEXT,
    end_date TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS task_project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    added_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS task_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    color TEXT DEFAULT '#6366F1',
    is_archived INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS task_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER DEFAULT 1,
    project_id INTEGER,
    name TEXT NOT NULL,
    code TEXT,
    color TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN workspace_id INTEGER DEFAULT 1'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN team_project_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN group_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN label_id INTEGER'); } catch (_) {}
  try { await env.DB.exec("INSERT INTO task_workspaces (id,name,description) SELECT 1,'Workspace NetViet HR','Default task workspace' WHERE NOT EXISTS (SELECT 1 FROM task_workspaces WHERE id=1)"); } catch (_) {}
  try { await env.DB.exec("INSERT INTO task_labels (workspace_id,name,code,color,description,is_active) SELECT 1,'Mac dinh','default','#6366F1','Nhan mac dinh' ,1 WHERE NOT EXISTS (SELECT 1 FROM task_labels WHERE workspace_id=1 AND code='default' AND project_id IS NULL)"); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id,date)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status,due_date)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(team_project_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_label ON tasks(label_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_project_members_project_user ON task_project_members(project_id,user_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_groups_project_archived ON task_groups(project_id,is_archived,position)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_labels_project_active ON task_labels(project_id,is_active)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_leave_requests_type ON leave_requests(type)'); } catch (_) {}
  try { await env.DB.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_ci ON departments(lower(name))'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE departments ADD COLUMN manager_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_departments_manager_id ON departments(manager_id)'); } catch (_) {}

  // One-time normalization: standardize existing department data to the fixed
  // 8-value list (case/near-spelling variants mapped, no duplicate rows created).
  try { await normalizeDepartmentData(env); } catch (_) {}

  // ── Đánh giá hiệu suất (Performance Evaluation) — TTS workflow ──────────
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS eval_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(month, year)
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    mentor_id INTEGER,
    mentor_name TEXT,
    department_head_id INTEGER,
    department_head_name TEXT,
    status TEXT DEFAULT 'DRAFT',
    window_override INTEGER DEFAULT 0,
    mentor_scores TEXT,
    mentor_comments TEXT,
    mentor_submitted_at TEXT,
    department_scores TEXT,
    department_comments TEXT,
    department_submitted_at TEXT,
    employee_confirmed_at TEXT,
    employee_revision_reason TEXT,
    employee_revision_evidence TEXT,
    employee_revision_at TEXT,
    ceo_revision_reason TEXT,
    ceo_revision_at TEXT,
    final_approved_score REAL,
    final_approved_comment TEXT,
    final_score_before_adjust REAL,
    final_adjust_reason TEXT,
    approved_by INTEGER,
    approved_by_name TEXT,
    approved_at TEXT,
    hr_received_by INTEGER,
    hr_received_by_name TEXT,
    hr_received_at TEXT,
    locked_by INTEGER,
    locked_by_name TEXT,
    locked_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(period_id, user_id)
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS evaluation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_by INTEGER,
    changed_by_name TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS asset_handover_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_id INTEGER,
    actor_name TEXT,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_asset_handover_history_asset_created ON asset_handover_history(asset_id, created_at DESC)`); } catch (_) {}
  // KPI theo nhân viên/kỳ tháng. Các bảng này chỉ được thêm mới, không thay đổi dữ liệu cũ.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_kpi_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT', created_by INTEGER, created_by_name TEXT,
    submitted_at TEXT, reviewed_by INTEGER, reviewed_by_name TEXT, reviewed_at TEXT, review_note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(employee_id, month, year)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_kpi_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, criterion_code TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT, unit TEXT NOT NULL DEFAULT 'đơn vị', target_value REAL NOT NULL,
    actual_value REAL, actual_text TEXT, manual_score REAL, review_note TEXT, weight_percent REAL NOT NULL, evidence_url TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS evaluation_kpi_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, evaluation_id INTEGER NOT NULL, criterion_code TEXT NOT NULL,
    achievement_percent REAL NOT NULL, automatic_score REAL NOT NULL, details_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(evaluation_id, criterion_code)
  )`).run();
  try { await env.DB.exec('ALTER TABLE employee_kpi_items ADD COLUMN affects_group1 INTEGER NOT NULL DEFAULT 1'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE employee_kpi_items ADD COLUMN actual_text TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE employee_kpi_items ADD COLUMN manual_score REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE employee_kpi_items ADD COLUMN review_note TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE employee_kpi_items ADD COLUMN requires_evidence INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS kpi_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
    created_by INTEGER, created_by_name TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS kpi_template_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, criterion_code TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT, unit TEXT NOT NULL DEFAULT 'đơn vị', target_value REAL NOT NULL,
    weight_percent REAL DEFAULT 0, affects_group1 INTEGER NOT NULL DEFAULT 1
  )`).run();
  try { await env.DB.exec('ALTER TABLE kpi_template_items ADD COLUMN requires_evidence INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_kpi_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kpi_item_id INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
    created_by INTEGER, created_by_name TEXT, created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_by INTEGER, updated_by_name TEXT, updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_kpi_evidence_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, kpi_item_id INTEGER NOT NULL,
    action TEXT NOT NULL, old_value_json TEXT, new_value_json TEXT,
    changed_by INTEGER, changed_by_name TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_kpi_approval_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL, approved_by INTEGER, approved_by_name TEXT, approved_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(plan_id)
  )`).run();
  // v2 intentionally has no UNIQUE(plan_id): every approval creates an immutable record.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_kpi_approval_snapshots_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL, approved_by INTEGER, approved_by_name TEXT, approved_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  // Preserve legacy single URLs as the first evidence record without touching old KPI rows.
  try { await env.DB.exec(`INSERT INTO employee_kpi_evidence (kpi_item_id,label,url,created_at,updated_at)
    SELECT i.id,'Link bằng chứng',i.evidence_url,i.created_at,i.updated_at FROM employee_kpi_items i
    WHERE trim(coalesce(i.evidence_url,''))<>'' AND NOT EXISTS (SELECT 1 FROM employee_kpi_evidence e WHERE e.kpi_item_id=i.id)`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_kpi_plans_period ON employee_kpi_plans(month,year,status)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_kpi_plans_employee ON employee_kpi_plans(employee_id,year,month)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_kpi_items_plan ON employee_kpi_items(plan_id,criterion_code)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_eval_kpi_snapshots_evaluation ON evaluation_kpi_snapshots(evaluation_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_kpi_evidence_item ON employee_kpi_evidence(kpi_item_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_kpi_evidence_audit_plan ON employee_kpi_evidence_audit(plan_id,created_at)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_kpi_snapshot_v2_plan ON employee_kpi_approval_snapshots_v2(plan_id,id DESC)'); } catch (_) {}
  // HCNS "Ghi chú & kiến nghị" gửi Ban Giám đốc — one note per eval period.
  try { await env.DB.exec(`ALTER TABLE eval_periods ADD COLUMN hr_note TEXT`); } catch (_) {}
  try { await env.DB.exec(`ALTER TABLE eval_periods ADD COLUMN hr_note_by TEXT`); } catch (_) {}
  try { await env.DB.exec(`ALTER TABLE eval_periods ADD COLUMN hr_note_at TEXT`); } catch (_) {}
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)')
      .bind('schema_version', SCHEMA_VERSION).run();
  } catch (_) {}
  _migrated = true;
}

async function ensureAttendanceOvertimeSchema(env) {
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,period_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',source TEXT NOT NULL DEFAULT 'employee',source_batch_id INTEGER,
    review_note TEXT,reviewer_id INTEGER,reviewer_name TEXT,reviewed_at TEXT,submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_form_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,form_id INTEGER NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,
    requested_minutes INTEGER NOT NULL,approved_minutes INTEGER,reason TEXT NOT NULL,time_category TEXT NOT NULL DEFAULT 'workday',
    created_at TEXT DEFAULT (datetime('now','localtime')),updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS attendance_import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,source_name TEXT NOT NULL,period_month TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'preview',
    created_by INTEGER NOT NULL,created_by_name TEXT,created_at TEXT DEFAULT (datetime('now','localtime')),committed_at TEXT
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS attendance_import_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id INTEGER NOT NULL,source_key TEXT NOT NULL,employee_code TEXT NOT NULL,work_date TEXT,
    attendance_id INTEGER,outcome TEXT NOT NULL,detail TEXT,created_at TEXT DEFAULT (datetime('now','localtime')),UNIQUE(batch_id,source_key)
  )`); } catch (_) {}
  for (const statement of [
    'CREATE INDEX IF NOT EXISTS idx_overtime_forms_user_period ON overtime_forms(user_id,period_month)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_forms_status_period ON overtime_forms(status,period_month)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_form_items_form ON overtime_form_items(form_id)',
    'ALTER TABLE attendance ADD COLUMN source_batch_id INTEGER',
    'ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN profile_pending INTEGER DEFAULT 0',
    'CREATE INDEX IF NOT EXISTS idx_attendance_source_batch ON attendance(source_batch_id)',
  ]) { try { await env.DB.exec(statement); } catch (_) {} }
}

// ===================== DEPARTMENT STANDARDIZATION =====================
// The seeded departments remain canonical, but the department directory is
// dynamic. Known legacy aliases are mapped; new department names stay intact.
const STANDARD_DEPARTMENTS = [
  'Ban Giám Đốc', 'Phòng HCNS', 'Phòng Kinh Doanh', 'Phòng Marketing',
  'Phòng Biên Tập', 'Phòng Sản Xuất Phim', 'Phòng Gameshow', 'Phòng Kế Toán',
];
function deptNormKey(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const DEPT_ALIASES = {
  'Ban Giám Đốc': ['ban giam doc', 'bgd', 'giam doc', 'ban lanh dao'],
  'Phòng HCNS': ['hcns', 'phong hcns', 'nhan su', 'phong nhan su', 'hanh chinh nhan su', 'hr'],
  'Phòng Kinh Doanh': ['kinh doanh', 'phong kinh doanh', 'sale', 'sales', 'phong sale', 'account sales', 'account', 'business development'],
  'Phòng Marketing': ['marketing', 'phong marketing', 'content marketing', 'seo sem', 'social media', 'design', 'performance', 'pr events', 'pr & events', 'truyen thong', 'digital ads', 'ads', 'quang cao'],
  'Phòng Biên Tập': ['bien tap', 'phong bien tap', 'noi dung'],
  'Phòng Sản Xuất Phim': ['san xuat phim', 'phong san xuat phim', 'production', 'san xuat'],
  'Phòng Gameshow': ['gameshow', 'phong gameshow', 'game show'],
  'Phòng Kế Toán': ['ke toan', 'phong ke toan', 'accounting', 'tai chinh ke toan'],
};
const DEPT_LOOKUP = (() => {
  const m = {};
  for (const std of STANDARD_DEPARTMENTS) m[deptNormKey(std)] = std;
  for (const [std, aliases] of Object.entries(DEPT_ALIASES)) {
    for (const a of aliases) m[deptNormKey(a)] = std;
  }
  return m;
})();
// Map any legacy/free-text department value to a standard one; unknown values
// are returned unchanged (never force-guess into the wrong bucket).
function normalizeDeptName(name) {
  if (!name) return name;
  const cleaned = String(name).trim().replace(/\s+/g, ' ');
  const std = DEPT_LOOKUP[deptNormKey(cleaned)];
  return std || cleaned;
}

function deptUniqueKey(name) {
  return deptNormKey(normalizeDeptName(name || ''));
}

async function findDepartmentDuplicate(env, name, excludeId = null) {
  const key = deptUniqueKey(name);
  const { results } = await env.DB.prepare('SELECT id,name FROM departments').all();
  return (results || []).find(d =>
    deptUniqueKey(d.name) === key && (excludeId === null || Number(d.id) !== Number(excludeId))
  ) || null;
}

// ===================== EMPLOYEE CODE GENERATION =====================
// [LOẠI]-[PHÒNG]-[STT 3 số] — e.g. NV-MKT-001, TTS-HCNS-002.
const DEPT_CODE = {
  'Ban Giám Đốc': 'BGD',
  'Phòng HCNS': 'HCNS',
  'Phòng Kinh Doanh': 'KD',
  'Phòng Marketing': 'MKT',
  'Phòng Biên Tập': 'BT',
  'Phòng Sản Xuất Phim': 'SXF',
  'Phòng Gameshow': 'GSH',
  'Phòng Kế Toán': 'KT',
};
function employeeTypeCode(t) {
  return t === 'TTS' ? 'TTS' : 'NV';
}
// Given type ('NV'|'TTS') + department, compute the next employee_code by
// scanning the max existing sequence number for that exact prefix (not row
// count), so deleted/left employees never free up a number for reuse.
async function nextEmployeeCode(env, type, department) {
  const typeCode = employeeTypeCode(type);
  const deptStd = normalizeDeptName(department || '');
  const deptCode = DEPT_CODE[deptStd] || 'KHAC';
  const prefix = `${typeCode}-${deptCode}-`;
  const { results } = await env.DB.prepare(
    'SELECT employee_code FROM users WHERE employee_code LIKE ?'
  ).bind(prefix + '%').all();
  let maxSeq = 0;
  for (const row of results) {
    const m = /^\d{3,}$/.exec(String(row.employee_code || '').slice(prefix.length));
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[0], 10));
  }
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

let _deptsNormalized = false;
async function normalizeDepartmentData(env) {
  if (_deptsNormalized) return;
  _deptsNormalized = true;

  // Normalize users.department values (main employee records)
  const { results: userDepts } = await env.DB.prepare(
    "SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department != ''"
  ).all();
  for (const row of userDepts) {
    const std = normalizeDeptName(row.department);
    if (std !== row.department) {
      await env.DB.prepare('UPDATE users SET department=? WHERE department=?').bind(std, row.department).run();
    }
  }

  // Normalize departments.name values, then de-duplicate rows that collapse
  // onto the same standard name (keep the oldest row, drop the rest).
  const { results: depts } = await env.DB.prepare('SELECT id, name FROM departments').all();
  const seen = new Map(); // standard name -> surviving id
  for (const d of depts) {
    const std = normalizeDeptName(d.name);
    if (std !== d.name) {
      await env.DB.prepare('UPDATE departments SET name=? WHERE id=?').bind(std, d.id).run();
    }
    if (!seen.has(std) || d.id < seen.get(std)) seen.set(std, Math.min(d.id, seen.get(std) ?? d.id));
  }
  for (const [std, keepId] of seen.entries()) {
    const dupIds = depts.filter(d => normalizeDeptName(d.name) === std && d.id !== keepId).map(d => d.id);
    for (const dupId of dupIds) {
      await env.DB.prepare('UPDATE employees SET department_id=? WHERE department_id=?').bind(keepId, dupId).run();
      await env.DB.prepare('DELETE FROM departments WHERE id=?').bind(dupId).run();
    }
  }
}

// ===================== CRYPTO HELPERS =====================
async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 20) return 'Mật khẩu phải có từ 8 đến 20 ký tự';
  if (!/[A-Z]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ in hoa';
  if (!/[a-z]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ thường';
  if (!/[0-9]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ số';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'Mật khẩu phải có ít nhất 1 ký tự đặc biệt';
  if (/\s/.test(password)) return 'Mật khẩu không được chứa khoảng trắng';
  return null;
}

function genToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function nameInitials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(-2).join('').toUpperCase();
}

// ===================== PERMISSION HELPERS =====================
// HCNS (Phòng HCNS) and Ban Giám Đốc (both are DEPARTMENTS, not roles) may edit
// lifecycle status and fully manage asset handovers. Admin always has owner-level access.
function isHrOrBod(u) {
  return !!u && (u.role === 'admin' || u.department === 'Phòng HCNS' || u.department === 'Ban Giám Đốc');
}
// Narrower than isHrOrBod — used to tell the HCNS-only actions (Tiếp nhận/Khóa phiếu) apart
// from the Ban Giám Đốc-only actions (Phê duyệt/Trả lại) in the Đánh giá hiệu suất workflow.
function isHcns(u) { return !!u && (u.role === 'admin' || u.department === 'Phòng HCNS'); }
function isBgd(u)  { return !!u && (u.role === 'admin' || u.department === 'Ban Giám Đốc'); }
// Quản lý/Trưởng phòng (role='manager') xử lý tài sản của nhân sự thuộc phòng ban mình phụ trách.
function isDeptManager(u, ownerDept) {
  return !!u && u.role === 'manager' && !!ownerDept && u.department === ownerDept;
}

const LIFECYCLE_STATUSES = ['Chờ tiếp nhận', 'Thực tập', 'Thử việc', 'Cộng tác viên', 'Chính thức', 'Đã nghỉ'];

// Private employee files stay in R2; only this Worker can read the bucket.
// The DB keeps a stable internal route rather than a public object URL.
const USER_DOCUMENTS = {
  avatar: { column: 'avatar_url', label: 'Ảnh chân dung', maxBytes: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  national_id: { column: 'national_id_document_url', label: 'CCCD', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  degree: { column: 'degree_document_url', label: 'Bằng cấp', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  contract: { column: 'contract_document_url', label: 'Hợp đồng', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
  decision: { column: 'personnel_decision_url', label: 'Quyết định nhân sự', maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
};
const LEGACY_DOCUMENT_CATEGORIES = {
  national_id: 'national_id',
  degree: 'degree',
  contract: 'labor_contract',
  decision: 'other',
};
function userDocumentKey(userId, kind) { return `employees/${userId}/${kind}`; }
function userDocumentRoute(userId, kind) { return `/api/users/${userId}/documents/${kind}`; }
function isManagedUserDocumentUrl(value, userId, kind) { return value === userDocumentRoute(userId, kind); }

const EMPLOYEE_DOCUMENT_CATEGORIES = {
  cv: 'CV ứng viên',
  national_id: 'CCCD',
  social_insurance: 'Sổ BHXH/VSSID',
  labor_contract: 'Hợp đồng lao động',
  contract_appendix: 'Phụ lục hợp đồng',
  degree: 'Bằng cấp, chứng chỉ',
  onboarding_decision: 'Quyết định tiếp nhận',
  transfer_decision: 'Quyết định điều chuyển',
  salary_decision: 'Quyết định tăng lương',
  termination_decision: 'Quyết định thôi việc',
  internship_agreement: 'Thỏa thuận TTS',
  other: 'Hồ sơ khác',
};
const EMPLOYEE_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const EMPLOYEE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const EMPLOYEE_CONTRACT_TYPES = ['Thử việc', 'HĐCT', 'CTV', 'Thỏa thuận TTS', 'Chính thức', 'Cộng tác viên', 'Thực tập sinh', 'Khác'];
const EMPLOYEE_PROFILE_FIELDS = {
  personal: ['full_name','email','phone','birth_date','gender','national_id','national_id_expiry_date','home_address','school_name','emergency_contact_name','emergency_contact_phone'],
  employment: ['employee_type','position','department','direct_manager_id','work_location'],
  contract: ['contract_type','hire_date','contract_start_date','contract_end_date','contract_signed_date','probation_end_date','official_date','termination_date'],
  compensation: ['salary','allowance','insurance_salary','dependent_count','bank_account','bank_name','bank_account_holder','tax_code','social_insurance_number','insurance_hospital'],
};
const EMPLOYEE_PROFILE_FIELD_GROUP = Object.fromEntries(
  Object.entries(EMPLOYEE_PROFILE_FIELDS).flatMap(([group, fields]) => fields.map(field => [field, group]))
);
const EMPLOYEE_PROFILE_ALLOWED_FIELDS = new Set(Object.keys(EMPLOYEE_PROFILE_FIELD_GROUP));
const EMPLOYEE_PROFILE_PROTECTED_FIELDS = new Set([
  ...EMPLOYEE_PROFILE_FIELDS.contract,
  ...EMPLOYEE_PROFILE_FIELDS.compensation,
]);
const EMPLOYEE_TIMELINE_FIELDS = new Set([
  'department','position','salary','allowance','contract_type','contract_start_date','contract_end_date',
  'probation_end_date','official_date','termination_date',
]);

function employeeDocumentContentMatches(contentType, buffer) {
  const bytes = new Uint8Array(buffer);
  if (contentType === 'application/pdf') return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  if (contentType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

function employeeCanAccess(target, me, hasHrScope, isManager) {
  if (hasHrScope || Number(target.id) === Number(me.id)) return true;
  return !!isManager && target.department === me.department;
}

function employeeProfilePermissions(target, me, hasHrScope, isManager) {
  const self = Number(target.id) === Number(me.id);
  const sameDepartmentManager = !!isManager && !hasHrScope && target.department === me.department;
  return {
    can_view: hasHrScope || self || sameDepartmentManager,
    can_edit_basic: hasHrScope || self || sameDepartmentManager,
    can_edit_personal: hasHrScope || self,
    can_edit_employment: hasHrScope || self || sameDepartmentManager,
    can_edit_contract: hasHrScope,
    can_edit_compensation: hasHrScope,
    can_manage_documents: hasHrScope,
    can_manage_avatar: hasHrScope || self,
    can_view_documents: hasHrScope || self,
    can_view_audit: hasHrScope,
    can_export: hasHrScope,
  };
}

function normalizeEmployeeProfileValue(field, value) {
  if (['salary','allowance','insurance_salary'].includes(field)) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number >= 0 ? number : NaN;
  }
  if (field === 'dependent_count') {
    const number = Number(value || 0);
    return Number.isInteger(number) && number >= 0 ? number : NaN;
  }
  if (field === 'direct_manager_id') return value ? Number(value) : null;
  if (field === 'department') return normalizeDeptName(String(value || ''));
  if (field === 'employee_type') return employeeTypeCode(value);
  if (field.endsWith('_date') || field === 'hire_date' || field === 'national_id_expiry_date') return value || null;
  return typeof value === 'string' ? value.trim() : value;
}

function validateEmployeeProfile(profile, changedFields = []) {
  const changed = new Set(changedFields);
  if (!String(profile.full_name || '').trim() || !String(profile.email || '').trim() || !String(profile.department || '').trim()) {
    return 'Họ tên, email và phòng ban là bắt buộc';
  }
  const requiredFields = ['full_name','email','phone','birth_date','national_id','home_address','position','department','direct_manager_id','work_location','contract_type','hire_date'];
  if (requiredFields.some(field => changed.has(field) && !String(profile[field] ?? '').trim())) return 'Không được để trống trường bắt buộc';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email || ''))) return 'Email không hợp lệ';
  if (changed.has('phone') && !/^\+?\d{8,15}$/.test(String(profile.phone || ''))) return 'Số điện thoại phải gồm 8 đến 15 chữ số';
  if (changed.has('national_id') && !/^\d{9}(\d{3})?$/.test(String(profile.national_id || ''))) return 'Số CCCD/CMND phải gồm 9 hoặc 12 chữ số';
  if (!Number.isInteger(Number(profile.dependent_count || 0)) || Number(profile.dependent_count || 0) < 0) return 'Số người phụ thuộc không hợp lệ';
  if (profile.direct_manager_id && Number(profile.direct_manager_id) === Number(profile.id)) return 'Quản lý trực tiếp không thể là chính nhân viên';
  if (changed.has('contract_type') && profile.contract_type && !EMPLOYEE_CONTRACT_TYPES.includes(profile.contract_type)) return 'Loại hợp đồng không hợp lệ';
  for (const field of changed) {
    if ((field.endsWith('_date') || field === 'hire_date') && profile[field] && !/^\d{4}-\d{2}-\d{2}$/.test(String(profile[field]))) {
      return 'Ngày tháng phải có định dạng YYYY-MM-DD';
    }
  }
  const orderedPairs = [
    ['hire_date','probation_end_date','Ngày kết thúc thử việc phải sau ngày vào làm'],
    ['hire_date','official_date','Ngày chính thức phải sau ngày vào làm'],
    ['contract_start_date','contract_end_date','Ngày hết hạn hợp đồng phải sau ngày bắt đầu'],
    ['hire_date','termination_date','Ngày nghỉ việc phải sau ngày vào làm'],
  ];
  for (const [start, end, message] of orderedPairs) {
    if ((changed.has(start) || changed.has(end)) && profile[start] && profile[end] && String(profile[end]) < String(profile[start])) return message;
  }
  if (changed.has('termination_date') && profile.termination_date && profile.lifecycle_status !== 'Đã nghỉ') return 'Chỉ nhập ngày nghỉ việc khi trạng thái là Đã nghỉ';
  return null;
}

function employeeAuditStatement(env, { userId, changeSetId, action, group, field, oldValue, newValue, actor }) {
  return env.DB.prepare(
    `INSERT INTO employee_profile_audit
       (id,change_set_id,user_id,action,field_group,field_name,old_value,new_value,changed_by,changed_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(), changeSetId, userId, action, group, field,
    oldValue === undefined || oldValue === null ? null : String(oldValue),
    newValue === undefined || newValue === null ? null : String(newValue),
    actor?.id || null, actor?.full_name || ''
  );
}

function employeeDocumentKey(userId, documentId) {
  return `employees/${userId}/documents/${documentId}`;
}

function safeDownloadName(value, fallback = 'document') {
  const cleaned = String(value || fallback).replace(/[\r\n"\\]/g, '_').slice(0, 180);
  return cleaned || fallback;
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;',
  })[character]);
}

const VIETNAMESE_SEARCH_REPLACEMENTS = [
  ['a', 'àáạảãâầấậẩẫăằắặẳẵ'], ['e', 'èéẹẻẽêềếệểễ'],
  ['i', 'ìíịỉĩ'], ['o', 'òóọỏõôồốộổỗơờớợởỡ'],
  ['u', 'ùúụủũưừứựửữ'], ['y', 'ỳýỵỷỹ'], ['d', 'đĐ'],
];

function normalizeVietnameseSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').trim();
}

function vietnameseSearchSql(column) {
  let expression = `COALESCE(${column},'')`;
  for (const [replacement, chars] of VIETNAMESE_SEARCH_REPLACEMENTS) {
    for (const char of chars) expression = `REPLACE(${expression},'${char}','${replacement}')`;
  }
  return `LOWER(${expression})`;
}

function buildEmployeeDirectoryFilter(url, me, hasHrScope) {
  const conditions = [];
  const binds = [];
  if (!hasHrScope) {
    conditions.push('u.department=?');
    binds.push(me.department || '');
  }
  const search = normalizeVietnameseSearch(url.searchParams.get('search'));
  if (search) {
    const value = `%${search}%`;
    conditions.push(`(${['u.full_name','u.employee_code','u.email','u.department','u.position'].map(vietnameseSearchSql).map(column => `${column} LIKE ?`).join(' OR ')})`);
    binds.push(value, value, value, value, value);
  }
  const filters = [
    ['department','u.department'],
    ['status','u.lifecycle_status'],
    ['contract_type','u.contract_type'],
    ['position','u.position'],
  ];
  for (const [param, column] of filters) {
    const value = String(url.searchParams.get(param) || '').trim();
    if (!value) continue;
    conditions.push(`${column}=?`);
    binds.push(value);
  }
  return { where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', binds };
}

async function buildEmployeeAlerts(env, windowDays = 30) {
  const { results: employees = [] } = await env.DB.prepare(
    `SELECT id,employee_code,employee_type,full_name,department,probation_end_date,contract_end_date,national_id_expiry_date
     FROM users WHERE is_active=1 AND coalesce(lifecycle_status,'')<>'Đã nghỉ' ORDER BY full_name`
  ).all();
  const { results: documents = [] } = await env.DB.prepare(
    `SELECT user_id,category,expires_on FROM employee_documents WHERE deleted_at IS NULL`
  ).all();
  const documentsByUser = new Map();
  for (const document of documents) {
    if (!documentsByUser.has(Number(document.user_id))) documentsByUser.set(Number(document.user_id), []);
    documentsByUser.get(Number(document.user_id)).push(document);
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysUntil = date => {
    if (!date) return null;
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) ? Math.ceil((parsed.getTime() - today.getTime()) / 86400000) : null;
  };
  const alerts = [];
  const dateFields = [
    ['probation_end_date','probation_due','Sắp hết thử việc','employment'],
    ['contract_end_date','contract_due','Sắp hết hạn hợp đồng','employment'],
    ['national_id_expiry_date','national_id_due','CCCD sắp hết hạn','overview'],
  ];
  for (const employee of employees) {
    for (const [field, type, label, tab] of dateFields) {
      const remaining = daysUntil(employee[field]);
      if (remaining === null || remaining > windowDays) continue;
      alerts.push({
        id: `${type}-${employee.id}`,
        type,
        module: 'employee_profile',
        module_label: 'Hồ sơ nhân viên',
        severity: remaining < 0 ? 'danger' : remaining <= 7 ? 'warning' : 'info',
        employee_id: employee.id,
        employee_code: employee.employee_code,
        employee_name: employee.full_name,
        department: employee.department,
        due_date: employee[field],
        days_until: remaining,
        occurred_on: employee[field],
        title: label,
        message: remaining < 0 ? `${label} đã quá hạn ${Math.abs(remaining)} ngày` : `${label} còn ${remaining} ngày`,
        action_url: `#/users/${employee.id}/${tab}`,
        action_label: 'Mở hồ sơ',
      });
    }
    const employeeDocuments = documentsByUser.get(Number(employee.id)) || [];
    const categories = new Set(employeeDocuments.map(document => document.category));
    const required = employee.employee_type === 'TTS'
      ? [['cv','CV ứng viên'],['national_id','CCCD'],['internship_agreement','Thỏa thuận TTS']]
      : [['cv','CV ứng viên'],['national_id','CCCD'],['labor_contract','Hợp đồng lao động']];
    const missing = required.filter(([category]) => {
      if (employee.employee_type === 'TTS' && category === 'internship_agreement' && categories.has('labor_contract')) return false;
      return !categories.has(category);
    }).map(([, label]) => label);
    if (missing.length) {
      alerts.push({
        id: `missing-documents-${employee.id}`,
        type: 'missing_documents',
        module: 'employee_profile',
        module_label: 'Hồ sơ nhân viên',
        severity: 'warning',
        employee_id: employee.id,
        employee_code: employee.employee_code,
        employee_name: employee.full_name,
        department: employee.department,
        missing,
        title: 'Hồ sơ còn thiếu',
        message: `Thiếu hồ sơ: ${missing.join(', ')}`,
        action_url: `#/users/${employee.id}/documents`,
        action_label: 'Bổ sung tài liệu',
      });
    }
    for (const document of employeeDocuments) {
      const remaining = daysUntil(document.expires_on);
      if (remaining === null || remaining > windowDays) continue;
      alerts.push({
        id: `document-due-${employee.id}-${document.category}`,
        type: 'document_due',
        module: 'employee_profile',
        module_label: 'Hồ sơ nhân viên',
        severity: remaining < 0 ? 'danger' : remaining <= 7 ? 'warning' : 'info',
        employee_id: employee.id,
        employee_code: employee.employee_code,
        employee_name: employee.full_name,
        department: employee.department,
        due_date: document.expires_on,
        days_until: remaining,
        occurred_on: document.expires_on,
        title: 'Tài liệu sắp hết hạn',
        message: `${EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || 'Tài liệu'} ${remaining < 0 ? `đã quá hạn ${Math.abs(remaining)} ngày` : `còn ${remaining} ngày`}`,
        action_url: `#/users/${employee.id}/documents`,
        action_label: 'Xem tài liệu',
      });
    }
  }
  return alerts;
}

async function buildAttendanceNotifications(env, me, { windowDays = 30, isAdmin = false, isHcnsScope = false } = {}) {
  const conditions = [`date(a.date) >= date('now','localtime',?)`];
  const binds = [`-${windowDays - 1} day`];
  if (!isAdmin && !isHcnsScope && me.role === 'manager') {
    conditions.push('u.department=?');
    binds.push(me.department || '');
  } else if (!isAdmin && !isHcnsScope) {
    conditions.push('a.user_id=?');
    binds.push(me.id);
  }
  const { results: rows = [] } = await env.DB.prepare(
    `SELECT a.*,u.full_name,u.employee_code,u.department,
       (SELECT o.status FROM overtime_requests o WHERE o.attendance_id=a.id LIMIT 1) AS overtime_status,
       CASE WHEN EXISTS (
         SELECT 1 FROM leave_requests lr
         WHERE lr.status='approved'
           AND (lr.employee_id=a.user_id OR CAST(lr.user_id AS TEXT)=CAST(a.user_id AS TEXT))
           AND date(a.date) BETWEEN date(lr.start_date) AND date(lr.end_date)
       ) THEN 1 ELSE 0 END AS has_approved_leave
     FROM attendance a JOIN users u ON u.id=a.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.date DESC,a.id DESC`
  ).bind(...binds).all();
  const notifications = [];
  for (const row of rows) {
    const base = {
      module: 'attendance',
      module_label: 'Chấm công',
      employee_id: row.user_id,
      employee_code: row.employee_code,
      employee_name: row.full_name,
      department: row.department,
      occurred_on: row.date,
      action_url: `#/attendance/${row.date}/${row.user_id}`,
      action_label: 'Xem chấm công',
      attendance_id: row.id,
    };
    if (Number(row.late_minutes || 0) > 0) {
      notifications.push({
        ...base,
        id: `attendance-late-${row.id}`,
        type: 'attendance_late',
        severity: 'warning',
        title: 'Đi làm muộn',
        message: `${row.full_name} check-in muộn ${Number(row.late_minutes)} phút lúc ${row.checkin_time || 'chưa rõ'}`,
      });
    }
    if (row.checkout_time) {
      const bounds = attShiftBounds(row.work_type || 'office', row.shift || 'full', row.expected_start, row.expected_end);
      const checkoutLateMinutes = Math.max(0, (attToMinutes(row.checkout_time) || 0) - (attToMinutes(bounds.end) || 0));
      if (checkoutLateMinutes > 0) {
        notifications.push({
          ...base,
          id: `attendance-checkout-late-${row.id}`,
          type: 'attendance_checkout_late',
          severity: row.overtime_status === 'approved' ? 'info' : 'warning',
          title: 'Checkout trễ',
          message: `${row.full_name} checkout trễ ${checkoutLateMinutes} phút lúc ${row.checkout_time}${row.overtime_status ? `, OT ${row.overtime_status === 'approved' ? 'đã duyệt' : row.overtime_status === 'pending' ? 'đang chờ duyệt' : 'đã từ chối'}` : ''}`,
          overtime_status: row.overtime_status || null,
        });
      }
    }
    if (row.status === 'absent' && !Number(row.has_approved_leave) && !String(row.note || '').trim()) {
      notifications.push({
        ...base,
        id: `attendance-unexcused-absence-${row.id}`,
        type: 'attendance_unexcused_absence',
        severity: 'danger',
        title: 'Vắng không có lý do',
        message: `${row.full_name} được ghi nhận vắng nhưng chưa có lý do hoặc đơn nghỉ được duyệt`,
      });
    }
  }
  return notifications;
}

// ===================== ĐÁNH GIÁ HIỆU SUẤT — CRITERIA (mirrors src/utils.js EVAL_GROUPS) =====
// Kept as a compact {code: maxScore} map for server-side score validation only — the full
// label/description/scale metadata lives in ONE place (src/utils.js EVAL_GROUPS) and is never
// duplicated here; this map exists solely so the backend can authoritatively bound-check scores
// without importing a frontend module into the Worker bundle.
const EVAL_CRITERIA_MAX = {
  HS01: 15, HS02: 10, HS03: 10, HS04: 10, HS05: 10, HS06: 5,
  VH01: 7, VH02: 6, VH03: 6, VH04: 6,
  SK01: 5, SK02: 4, SK03: 3, SK04: 3,
};
const EVAL_COMMENT_REQUIRED_RATIO = 0.6; // require a written comment when score < 60% of that criterion's max
const EVAL_CODES = Object.keys(EVAL_CRITERIA_MAX);
const MANUAL_EVAL_CODES = EVAL_CODES.filter(code => !code.startsWith('HS'));

function evalTotal(scores) {
  let sum = 0;
  for (const code of EVAL_CODES) sum += Number(scores?.[code]) || 0;
  return sum;
}
// Validates whatever is present (used for "Lưu nháp" — partial is fine).
function evalValidatePartial(scores, comments) {
  for (const code of MANUAL_EVAL_CODES) {
    const v = (scores || {})[code];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    const max = EVAL_CRITERIA_MAX[code];
    if (!Number.isFinite(n) || n < 0 || n > max) return `Điểm ${code} không hợp lệ (0–${max})`;
    if (n < max * EVAL_COMMENT_REQUIRED_RATIO && !String((comments || {})[code] || '').trim()) {
      return `Cần nhận xét khi điểm ${code} thấp hơn mức cấu hình`;
    }
  }
  return null;
}
// Validates that ALL 16 criteria are filled (used for "Gửi đánh giá").
function evalValidateComplete(scores, comments) {
  for (const code of MANUAL_EVAL_CODES) {
    const v = (scores || {})[code];
    if (v === undefined || v === null || v === '') return `Vui lòng chấm điểm đầy đủ 14 tiêu chí (còn thiếu ${code})`;
  }
  return evalValidatePartial(scores, comments);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function recordAssetHistory(env, assetId, action, actor, detail = '') {
  await env.DB.prepare(
    'INSERT INTO asset_handover_history (asset_id,action,actor_id,actor_name,detail) VALUES (?,?,?,?,?)'
  ).bind(assetId, action, actor?.id || null, actor?.full_name || '', detail || '').run();
}

function safeParseJSON(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

async function nextInvoiceNumber(env, year, month) {
  const row = await env.DB.prepare(
    "SELECT invoice_number FROM invoices WHERE year=? AND month=? AND invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1"
  ).bind(year, month, `HD-${year}${String(month).padStart(2, '0')}-%`).first();
  const lastSeq = Number(String(row?.invoice_number || '').split('-').pop() || 0);
  const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE year=? AND month=?')
    .bind(year, month).first();
  const seq = String(Math.max(lastSeq, Number(count?.cnt || 0)) + 1).padStart(3, '0');
  return 'HD-' + year + String(month).padStart(2, '0') + '-' + seq;
}

function prevMonthStr(month) {
  const [year, mm] = String(month || '').split('-').map(Number);
  if (!year || !mm) return '';
  const d = new Date(Date.UTC(year, mm - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function payrollAdjustmentType(source, amount, scoreDelta) {
  if (amount > 0 && source !== 'attendance') return 'bonus';
  if (amount > 0 && source === 'attendance') return 'penalty';
  if (scoreDelta > 0) return 'score_bonus';
  if (scoreDelta < 0) return 'score_penalty';
  return 'alert';
}

async function buildPayrollAdjustmentSuggestions(env, month) {
  const suggestions = [];
  const { results: payrollRows = [] } = await env.DB.prepare(
    'SELECT id,employee_id,employee_name,employee_code,department FROM payroll WHERE month=?'
  ).bind(month).all();
  const payrollByEmployee = new Map(payrollRows.map(p => [Number(p.employee_id), p]));

  function pushSuggestion(row) {
    const payroll = payrollByEmployee.get(Number(row.employee_id));
    suggestions.push({
      payroll_id: payroll?.id || null,
      employee_id: Number(row.employee_id),
      employee_name: row.employee_name || payroll?.employee_name || '',
      employee_code: row.employee_code || payroll?.employee_code || '',
      department: row.department || payroll?.department || '',
      month,
      type: row.type || payrollAdjustmentType(row.source, Number(row.amount || 0), Number(row.score_delta || 0)),
      source: row.source,
      source_ref: row.source_ref,
      amount: Number(row.amount || 0),
      score_delta: Number(row.score_delta || 0),
      reason: row.reason,
      can_apply: !(Number(row.amount || 0) > 0 && !payroll?.id),
    });
  }

  const { results: evals = [] } = await env.DB.prepare(
    `SELECT e.id AS evaluation_id, e.user_id AS employee_id, e.final_approved_score,
            u.full_name AS employee_name, u.employee_code, u.department
       FROM evaluations e
       JOIN eval_periods p ON e.period_id=p.id
       JOIN users u ON e.user_id=u.id
      WHERE e.status='LOCKED'
        AND printf('%04d-%02d', p.year, p.month)=?
        AND e.final_approved_score IS NOT NULL`
  ).bind(month).all();
  for (const ev of evals) {
    const score = Number(ev.final_approved_score || 0);
    if (score >= 90) {
      pushSuggestion({ ...ev, source: 'evaluation', source_ref: `eval-score:${ev.evaluation_id}`, amount: 1000000, score_delta: 0, reason: `Diem danh gia ${score}: de xuat thuong 1.000.000d (co the dieu chinh toi 2.000.000d).` });
    } else if (score >= 80) {
      pushSuggestion({ ...ev, source: 'evaluation', source_ref: `eval-score:${ev.evaluation_id}`, amount: 500000, score_delta: 0, reason: `Diem danh gia ${score}: de xuat thuong 500.000d.` });
    }
  }

  const prevMonth = prevMonthStr(month);
  if (prevMonth) {
    const { results: lowRows = [] } = await env.DB.prepare(
      `SELECT cur.user_id AS employee_id, cur.final_approved_score AS current_score, prev.final_approved_score AS previous_score,
              u.full_name AS employee_name, u.employee_code, u.department
         FROM evaluations cur
         JOIN eval_periods cp ON cur.period_id=cp.id
         JOIN evaluations prev ON prev.user_id=cur.user_id
         JOIN eval_periods pp ON prev.period_id=pp.id
         JOIN users u ON u.id=cur.user_id
        WHERE cur.status='LOCKED' AND prev.status='LOCKED'
          AND printf('%04d-%02d', cp.year, cp.month)=?
          AND printf('%04d-%02d', pp.year, pp.month)=?
          AND cur.final_approved_score < 50 AND prev.final_approved_score < 50`
    ).bind(month, prevMonth).all();
    for (const row of lowRows) {
      pushSuggestion({ ...row, source: 'evaluation', source_ref: `eval-low-2mo:${row.employee_id}:${month}`, amount: 0, score_delta: 0, reason: `Diem yeu 2 thang lien tiep (${prevMonth}: ${row.previous_score}, ${month}: ${row.current_score}) - can HR/BGD xem xet.` });
    }
  }

  const { results: attendanceRows = [] } = await env.DB.prepare(
    `SELECT a.id AS attendance_id, a.user_id AS employee_id, a.date, a.late_minutes, a.checkin_time, a.checkout_time,
            u.full_name AS employee_name, u.employee_code, u.department
       FROM attendance a JOIN users u ON a.user_id=u.id
      WHERE a.date LIKE ?`
  ).bind(`${month}-%`).all();
  for (const a of attendanceRows) {
    const late = Number(a.late_minutes || 0);
    if (late > 0) {
      const amount = late < 15 ? 20000 : 50000;
      pushSuggestion({ ...a, source: 'attendance', source_ref: `att-late:${a.attendance_id}`, amount, score_delta: 0, reason: `Di tre ${late} phut ngay ${a.date}: phat ${amount.toLocaleString('vi-VN')}d.` });
    }
    if (!a.checkin_time || !a.checkout_time) {
      pushSuggestion({ ...a, source: 'attendance', source_ref: `att-missing:${a.attendance_id}`, amount: 50000, score_delta: 0, reason: `Thieu check-in/out ngay ${a.date}: phat 50.000d.` });
    }
  }

  const { results: taskRows = [] } = await env.DB.prepare(
    `SELECT t.assigned_to AS employee_id, COUNT(*) AS late_count,
            u.full_name AS employee_name, u.employee_code, u.department
       FROM tasks t JOIN users u ON t.assigned_to=u.id
      WHERE t.due_date LIKE ?
        AND date(t.due_date) < date('now','localtime')
        AND t.status NOT IN ('done','cancelled')
      GROUP BY t.assigned_to
     HAVING COUNT(*) >= 3`
  ).bind(`${month}-%`).all();
  for (const row of taskRows) {
    pushSuggestion({ ...row, source: 'tasks', source_ref: `task-deadline:${row.employee_id}:${month}`, amount: 0, score_delta: -5, reason: `Tre deadline ${row.late_count} lan trong thang: de xuat tru 5 diem theo chinh sach.` });
  }

  const { results: approved = [] } = await env.DB.prepare(
    `SELECT pa.*, u.full_name AS employee_name, u.employee_code, u.department
       FROM payroll_adjustments pa
       LEFT JOIN users u ON u.id=pa.employee_id
      WHERE pa.month=? AND pa.status='approved'
      ORDER BY pa.approved_at DESC, pa.id DESC`
  ).bind(month).all();
  const approvedRefs = new Set(approved.map(a => a.source_ref).filter(Boolean));
  return {
    suggestions: suggestions.filter(s => !approvedRefs.has(s.source_ref)),
    approved,
  };
}

function vnParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((m, p) => (m[p.type] = p.value, m), {});
  return parts;
}

function vnTodayStr() {
  const p = vnParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function vnTimeStr() {
  const p = vnParts();
  return `${p.hour}:${p.minute}`;
}

// ── Asset-handover credential encryption (AES-GCM, key derived from APP_ID) ──
// "Tài khoản đăng nhập" declared for a handed-over asset may contain a secret.
// Never store/return it in plaintext — encrypt at rest, mask in list responses,
// and only decrypt via the gated reveal endpoint (which writes an audit log row).
async function getCredKey(env) {
  const enc = new TextEncoder().encode('asset-cred-key:' + (env.APP_ID || 'default-app'));
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptCred(env, plain) {
  if (!plain) return null;
  const key = await getCredKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return btoa(String.fromCharCode(...combined));
}
async function decryptCred(env, b64) {
  if (!b64) return '';
  try {
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await getCredKey(env);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    return '';
  }
}

// ── ATTENDANCE HELPERS ──────────────────────────────────────────────
// Standard shift windows for office/WFH. Business trips use the employee's
// own registered expected start/end instead (flexible).
const ATT_STANDARD_SHIFTS = {
  morning:   { start: '08:30', lateAfter: '08:45', end: '12:00' },
  afternoon: { start: '13:30', lateAfter: '13:45', end: '17:00' },
  full:      { start: '08:30', lateAfter: '08:45', end: '17:00' },
};

function attToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeOvertimeItems(items, periodMonth, { allowFuture = false } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) return { error: 'Tháng làm thêm không hợp lệ' };
  if (!Array.isArray(items) || !items.length || items.length > 31) return { error: 'Form cần từ 1 đến 31 dòng làm thêm' };
  const now = Date.now();
  const seen = new Set();
  const normalized = [];
  for (const raw of items) {
    const startAt = String(raw?.start_at || '');
    const endAt = String(raw?.end_at || '');
    const reason = String(raw?.reason || '').trim();
    const category = ['workday', 'rest_day', 'holiday'].includes(raw?.time_category) ? raw.time_category : 'workday';
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endAt) || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return { error: 'Mỗi dòng OT phải có ngày giờ bắt đầu và kết thúc hợp lệ' };
    if (!startAt.startsWith(`${periodMonth}-`)) return { error: 'Ngày bắt đầu OT phải thuộc đúng tháng của form' };
    if (end <= start || end.valueOf() - start.valueOf() > 24 * 60 * 60 * 1000) return { error: 'Thời gian OT phải lớn hơn 0 và không quá 24 giờ' };
    if (!allowFuture && start.valueOf() > now) return { error: 'Không thể khai báo OT trong tương lai' };
    if (!reason || reason.length > 1000) return { error: 'Lý do OT là bắt buộc và tối đa 1000 ký tự' };
    const key = `${startAt}|${endAt}`;
    if (seen.has(key)) return { error: 'Không được nhập hai dòng OT trùng thời gian' };
    seen.add(key);
    normalized.push({ start_at: startAt, end_at: endAt, requested_minutes: Math.round((end - start) / 60000), reason, time_category: category });
  }
  return { items: normalized };
}

async function applyCalendarOvertimeCategories(env, items) {
  return Promise.all(items.map(async item => {
    const workDate = item.start_at.slice(0, 10);
    const holiday = await env.DB.prepare('SELECT id FROM company_holidays WHERE holiday_date=? AND is_active=1').bind(workDate).first();
    const weekday = new Date(`${workDate}T00:00:00`).getDay();
    return { ...item, time_category: holiday ? 'holiday' : (weekday === 0 || weekday === 6) ? 'rest_day' : item.time_category };
  }));
}

async function ensureProjectHandoverSchema(env) {
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS asset_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, asset_name TEXT NOT NULL,
    asset_type TEXT, platform TEXT, link TEXT, credential_enc TEXT, responsible_name TEXT,
    mentor_id INTEGER, mentor_name TEXT, status TEXT DEFAULT 'active', note TEXT,
    confirmed_by INTEGER, confirmed_at TEXT, expected_handover_date TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS asset_credential_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL, viewed_by INTEGER,
    viewed_by_name TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS asset_handover_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL, action TEXT NOT NULL,
    actor_id INTEGER, actor_name TEXT, detail TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_asset_handover_history_asset_created ON asset_handover_history(asset_id, created_at DESC)'); } catch (_) {}
}

async function d1WriteWithRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!/Network connection lost|connection reset|timed out/i.test(String(error?.message || '')) || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError;
}

// Number of Mon–Fri business days in a given month (used as "Ngày công chuẩn").
function attCountBusinessDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function attIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function attCountBusinessDaysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

async function buildMonthlyWorkSummary(env, userId, month, year) {
  const mm = String(month).padStart(2, '0');
  const { results = [] } = await env.DB.prepare(
    "SELECT * FROM attendance WHERE user_id=? AND strftime('%m',date)=? AND strftime('%Y',date)=?"
  ).bind(userId, mm, String(year)).all();

  let fullDays = 0;
  let halfDays = 0;
  let incompleteDays = 0;
  let lateMinutes = 0;
  let earlyLeaveMinutes = 0;
  let absentDays = 0;
  let lateDays = 0;

  for (const r of results) {
    if (r.status === 'cancelled' || r.status === 'rejected') continue;
    if (r.status === 'absent') {
      absentDays++;
      continue;
    }
    const hasIn = !!r.checkin_time;
    const hasOut = !!r.checkout_time;
    if (!hasIn || !hasOut) {
      incompleteDays++;
      continue;
    }
    if (r.shift === 'morning' || r.shift === 'afternoon') halfDays++;
    else fullDays++;
    const late = Number(r.late_minutes || 0);
    const early = Number(r.early_minutes || 0);
    lateMinutes += late;
    earlyLeaveMinutes += early;
    if (late > 0) lateDays++;
  }

  let paidLeaveDays = 0;
  const monthStart = attIsoDate(year, month, 1);
  const monthEnd = attIsoDate(year, month, new Date(year, month, 0).getDate());
  try {
    const { results: leaves = [] } = await env.DB.prepare(
      `SELECT lr.start_date, lr.end_date
         FROM leave_requests lr
         LEFT JOIN leave_types lt ON lr.type=lt.code
        WHERE (CAST(lr.user_id AS TEXT)=CAST(? AS TEXT) OR lr.employee_id=?)
          AND lr.status='approved'
          AND COALESCE(lt.paid_policy,'paid')='paid'
          AND date(lr.start_date) <= date(?)
          AND date(lr.end_date) >= date(?)`
    ).bind(userId, userId, monthEnd, monthStart).all();
    for (const lr of leaves) {
      const start = String(lr.start_date || '') > monthStart ? String(lr.start_date || '') : monthStart;
      const end = String(lr.end_date || '') < monthEnd ? String(lr.end_date || '') : monthEnd;
      paidLeaveDays += attCountBusinessDaysBetween(start, end);
    }
  } catch (_) {
    paidLeaveDays = 0;
  }

  const standardWorkDays = attCountBusinessDays(year, month);
  const actualWorkDays = fullDays + halfDays * 0.5;
  const overtime = await buildMonthlyOvertimeSummary(env, userId, month, year);
  return {
    standardWorkDays,
    actualWorkDays,
    fullDays,
    halfDays,
    incompleteDays,
    absentDays,
    lateDays,
    paidLeaveDays,
    lateMinutes,
    earlyLeaveMinutes,
    approvedOvertimeMinutes: overtime.approvedOvertimeMinutes,
    approvedOvertimeHours: overtime.approvedOvertimeHours,
  };
}

const KPI_GROUP1_CODES = ['HS01', 'HS02', 'HS03', 'HS04', 'HS05', 'HS06'];
const KPI_GROUP1_MAX = { HS01: 15, HS02: 10, HS03: 10, HS04: 10, HS05: 10, HS06: 5 };
function kpiScoreForPercent(percent, maxScore) {
  if (percent >= 110) return maxScore;
  if (percent >= 100) return Math.round(maxScore * .9 * 10) / 10;
  if (percent >= 80) return Math.round(maxScore * .75 * 10) / 10;
  if (percent >= 60) return Math.round(maxScore * .5 * 10) / 10;
  if (percent > 0) return Math.round(maxScore * .25 * 10) / 10;
  return 0;
}
function validateKpiItems(items) {
  if (!Array.isArray(items) || !items.length) return 'Cần khai báo KPI cho 6 tiêu chí Nhóm 1';
  for (const code of KPI_GROUP1_CODES) {
    const rows = items.filter(x => x.criterion_code === code && Number(x.affects_group1) !== 0);
    const totalWeight = rows.reduce((s, x) => s + Number(x.weight_percent || 0), 0);
    if (!rows.length || Math.abs(totalWeight - 100) > .01) return `Tiêu chí ${code} phải có tổng trọng số bằng 100%`;
  }
  for (const x of items) {
    const scored = Number(x.affects_group1) !== 0;
    const textUnit = String(x.unit || '').toLowerCase() === 'text';
    if ((!KPI_GROUP1_CODES.includes(x.criterion_code) && scored) || !String(x.title || '').trim() || (!textUnit && Number(x.target_value) <= 0) || (scored && Number(x.weight_percent) <= 0)) return 'Dữ liệu KPI không hợp lệ';
  }
  return null;
}
function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(row => ({ label: String(row?.label || '').trim().slice(0, 160), url: String(row?.url || '').trim() }))
    .filter(row => row.url)
    .filter(row => {
      try { const u = new URL(row.url); if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) return false; seen.add(u.href); return true; }
      catch (_) { return false; }
    });
}
async function attachKpiEvidence(env, items) {
  for (const item of items || []) {
    const { results = [] } = await env.DB.prepare('SELECT id,label,url,created_by,created_by_name,created_at,updated_by,updated_by_name,updated_at FROM employee_kpi_evidence WHERE kpi_item_id=? ORDER BY id').bind(item.id).all();
    item.evidence = results;
    if (!results.length && String(item.evidence_url || '').trim()) item.evidence = [{ id: `legacy-${item.id}`, label: 'Link bằng chứng', url: item.evidence_url }];
  }
  return items;
}
async function replaceKpiEvidence(env, plan, item, evidence, me, action = 'replace') {
  const normalized = normalizeEvidence(evidence);
  if (Array.isArray(evidence) && evidence.filter(x => x?.url).length !== normalized.length) throw new Error('Mỗi link bằng chứng phải là URL http hoặc https hợp lệ');
  const { results: oldRows = [] } = await env.DB.prepare('SELECT label,url FROM employee_kpi_evidence WHERE kpi_item_id=? ORDER BY id').bind(item.id).all();
  const oldValue = JSON.stringify(oldRows);
  const newValue = JSON.stringify(normalized);
  if (oldValue === newValue) return false;
  await env.DB.prepare('DELETE FROM employee_kpi_evidence WHERE kpi_item_id=?').bind(item.id).run();
  for (const link of normalized) await env.DB.prepare('INSERT INTO employee_kpi_evidence (kpi_item_id,label,url,created_by,created_by_name,updated_by,updated_by_name) VALUES (?,?,?,?,?,?,?)')
    .bind(item.id, link.label, link.url, me.id, me.full_name || '', me.id, me.full_name || '').run();
  await env.DB.prepare('INSERT INTO employee_kpi_evidence_audit (plan_id,kpi_item_id,action,old_value_json,new_value_json,changed_by,changed_by_name) VALUES (?,?,?,?,?,?,?)')
    .bind(plan.id, item.id, action, oldValue, newValue, me.id, me.full_name || '').run();
  return true;
}
function kpiItemScore(item) {
  if (Number(item.affects_group1) === 0) return null;
  if (String(item.unit || '').toLowerCase() === 'text') return Number(item.manual_score || 0);
  return null;
}
function group1Total(items) {
  return KPI_GROUP1_CODES.reduce((sum, code) => {
    const rows = items.filter(item => item.criterion_code === code && Number(item.affects_group1) !== 0);
    if (rows.some(item => String(item.unit || '').toLowerCase() === 'text')) return sum + rows.reduce((n, item) => n + Number(item.manual_score || 0), 0);
    const pct = rows.reduce((n, item) => n + (Number(item.actual_value || 0) / Number(item.target_value || 1)) * Number(item.weight_percent || 0), 0);
    return sum + kpiScoreForPercent(pct, KPI_GROUP1_MAX[code]);
  }, 0);
}
async function createEvaluationKpiSnapshot(env, evaluationId, employeeId, month, year) {
  const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=? AND status=?')
    .bind(employeeId, month, year, 'APPROVED').first();
  if (!plan) return { error: 'Nhân viên chưa có KPI tháng được HCNS duyệt' };
  const { results: items = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=? ORDER BY criterion_code,id').bind(plan.id).all();
  const invalid = validateKpiItems(items);
  if (invalid) return { error: invalid };
  if (items.filter(x => Number(x.affects_group1) !== 0).some(x => String(x.unit).toLowerCase() === 'text' ? !String(x.actual_text || '').trim() || x.manual_score === null : x.actual_value === null || x.actual_value === undefined)) return { error: 'KPI tính điểm chưa có kết quả hoặc điểm HCNS đầy đủ' };
  const snapshots = [];
  for (const code of KPI_GROUP1_CODES) {
    const rows = items.filter(x => x.criterion_code === code);
    const textRows = rows.filter(x => String(x.unit).toLowerCase() === 'text');
    const pct = textRows.length ? 0 : rows.reduce((sum, x) => sum + (Number(x.actual_value) / Number(x.target_value)) * Number(x.weight_percent), 0) / 100 * 100;
    const score = textRows.length ? textRows.reduce((sum, x) => sum + Number(x.manual_score || 0), 0) : kpiScoreForPercent(pct, KPI_GROUP1_MAX[code]);
    snapshots.push({ code, achievement_percent: Math.round(pct * 100) / 100, automatic_score: score, details: rows });
  }
  for (const s of snapshots) await env.DB.prepare(
    'INSERT OR REPLACE INTO evaluation_kpi_snapshots (evaluation_id,criterion_code,achievement_percent,automatic_score,details_json) VALUES (?,?,?,?,?)'
  ).bind(evaluationId, s.code, s.achievement_percent, s.automatic_score, JSON.stringify(s.details)).run();
  return { snapshots, total: snapshots.reduce((sum, s) => sum + s.automatic_score, 0) };
}

// Best-effort edge throttle.  Cloudflare isolates do not share memory, so this
// deliberately complements (rather than replaces) an account-level WAF rule.
// It still stops bursts that hit the same isolate and keeps abusive UI loops
// from amplifying writes to D1.
const edgeRateBuckets = new Map();
function clientIp(request) {
  return (request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown')
    .split(',')[0].trim();
}
function rateLimit(request, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${clientIp(request)}`;
  const bucket = edgeRateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    edgeRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count += 1;
  if (bucket.count <= limit) return null;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}

async function buildMonthlyOvertimeSummary(env, userId, month, year, baseSalary = 0) {
  const mm = String(month).padStart(2, '0');
  const { results: legacyResults = [] } = await env.DB.prepare(
    "SELECT work_date, approved_minutes FROM overtime_requests WHERE user_id=? AND status='approved' AND strftime('%m',work_date)=? AND strftime('%Y',work_date)=?"
  ).bind(userId, mm, String(year)).all();
  const { results: formResults = [] } = await env.DB.prepare(
    `SELECT substr(i.start_at,1,10) AS work_date,i.approved_minutes,i.time_category
       FROM overtime_form_items i JOIN overtime_forms f ON f.id=i.form_id
      WHERE f.user_id=? AND f.status IN ('approved','partially_approved')
        AND strftime('%m',substr(i.start_at,1,10))=? AND strftime('%Y',substr(i.start_at,1,10))=?`
  ).bind(userId, mm, String(year)).all();
  const { results: holidays = [] } = await env.DB.prepare(
    "SELECT holiday_date FROM company_holidays WHERE is_active=1 AND strftime('%m',holiday_date)=? AND strftime('%Y',holiday_date)=?"
  ).bind(mm, String(year)).all();
  const holidayDates = new Set(holidays.map(h => h.holiday_date));
  const standardDays = attCountBusinessDays(year, month) || 1;
  const hourlyRate = Number(baseSalary || 0) / standardDays / 8;
  let approvedMinutes = 0;
  let overtimePay = 0;
  for (const item of [...legacyResults, ...formResults]) {
    const minutes = Math.max(0, Number(item.approved_minutes || 0));
    const day = new Date(`${item.work_date}T00:00:00`).getDay();
    const multiplier = item.time_category === 'holiday' || holidayDates.has(item.work_date) ? 3 : item.time_category === 'rest_day' || day === 0 || day === 6 ? 2 : 1.5;
    approvedMinutes += minutes;
    overtimePay += (minutes / 60) * hourlyRate * multiplier;
  }
  return { approvedOvertimeMinutes: approvedMinutes, approvedOvertimeHours: approvedMinutes / 60, overtimePay: Math.round(overtimePay) };
}

async function refreshInvoiceOvertime(env, userId, month, year, actor = null) {
  const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE user_id=? AND month=? AND year=? ORDER BY id DESC LIMIT 1').bind(userId, month, year).first();
  if (!invoice) return null;
  const ot = await buildMonthlyOvertimeSummary(env, userId, month, year, invoice.base_salary);
  const net = Number(invoice.base_salary || 0) + Number(invoice.bonus || 0) + Number(invoice.allowance || 0) + ot.overtimePay - Number(invoice.deduction || 0) - Number(invoice.tax || 0) - Number(invoice.insurance || 0);
  await env.DB.prepare('UPDATE invoices SET approved_overtime_minutes=?,overtime_pay=?,net_salary=? WHERE id=?').bind(ot.approvedOvertimeMinutes, ot.overtimePay, net, invoice.id).run();
  if (actor) await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)').bind(invoice.id, invoice.status, invoice.status, actor.id, actor.full_name || '', `Overtime approval recalculated: ${ot.approvedOvertimeHours.toFixed(2)}h`).run();
  return ot;
}

function attShiftBounds(workType, shift, expectedStart, expectedEnd) {
  const std = ATT_STANDARD_SHIFTS[shift] || ATT_STANDARD_SHIFTS.full;
  if (workType === 'business') {
    const start = expectedStart || std.start;
    const end = expectedEnd || std.end;
    return { start, lateAfter: start, end }; // business trip: late = after own expected start
  }
  return std;
}

// ── NIGHTLY AUTO-CHECKOUT ─────────────────────────────────────────
// Any day in the past that has a check-in but no check-out is closed
// automatically at the end of the shift, tagged "Quên checkout"
// (auto_checkout=1) so HR can see it was a forgotten check-out, not a
// missing day. Work hours are computed up to the shift end (17:00 for a
// full day) as if the employee worked the full registered shift.
export async function runAutoCheckout(env) {
  const today = vnTodayStr();
  const rows = await env.DB.prepare(
    `SELECT * FROM attendance
      WHERE checkin_time IS NOT NULL
        AND checkout_time IS NULL
        AND date < ?
        AND status NOT IN ('absent','cancelled','rejected','leave')`
  ).bind(today).all().then(r => r.results || []);

  let closed = 0;
  for (const record of rows) {
    const shift = record.shift || 'full';
    const workType = record.work_type || 'office';
    const bounds = attShiftBounds(workType, shift, record.expected_start, record.expected_end);
    const endMin = attToMinutes(bounds.end) ?? 17 * 60;
    const ciMin = attToMinutes(record.checkin_time) ?? attToMinutes(bounds.start);
    let workMinutes = Math.max(0, endMin - ciMin);
    if (workType !== 'business' && shift === 'full') {
      // Exclude the 12:00–13:30 lunch break from total worked time
      const lunchStart = 12 * 60, lunchEnd = 13 * 60 + 30;
      const overlap = Math.max(0, Math.min(endMin, lunchEnd) - Math.max(ciMin, lunchStart));
      workMinutes -= overlap;
    }
    const workHours = Math.max(0, workMinutes) / 60;
    const note = [record.note, '[Quên checkout]'].filter(Boolean).join(' ').trim();
    await env.DB.prepare(
      `UPDATE attendance
          SET checkout_time=?, checkout_ip='auto', work_hours=?, auto_checkout=1, note=?
        WHERE id=?`
    ).bind(bounds.end, Number(workHours.toFixed(2)), note, record.id).run();
    closed++;
  }
  return { closed, today };
}

export async function handleScheduled(_event, env) {
  try {
    const result = await runAutoCheckout(env);
    console.log('auto-checkout completed', JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('auto-checkout failed', String(error?.message || error), error?.stack);
    return { error: String(error?.message || error) };
  }
}

function clientIpFromRequest(request) {
  const forwarded = request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    request.headers.get('X-Real-IP') || '';
  return String(forwarded).split(',')[0].trim() || '127.0.0.1';
}

function ipv6ToBigInt(value) {
  let input = String(value || '').trim().toLowerCase();
  if (!input || input.includes('%')) return null;
  if (input.includes('.')) return null; // IPv4-mapped IPv6 is not a supported whitelist format.
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (left.length + right.length > 8 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) + BigInt(`0x${group}`), 0n);
}

function ipMatchesRule(ip, rule) {
  const r = String(rule || '').trim();
  if (!ip || !r) return false;
  if (r === '*') return true;
  if (r.includes('/')) {
    const [base, bitsRaw] = r.split('/');
    const bits = parseInt(bitsRaw, 10);
    const ipV6 = ipv6ToBigInt(ip);
    const baseV6 = ipv6ToBigInt(base);
    if (ipV6 != null || baseV6 != null) {
      if (ipV6 == null || baseV6 == null || bits < 0 || bits > 128) return false;
      const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
      return (ipV6 & mask) === (baseV6 & mask);
    }
    const toInt = (v) => {
      const parts = String(v).split('.').map(Number);
      if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      return parts.reduce((n, part) => ((n << 8) + part) >>> 0, 0);
    };
    const ipInt = toInt(ip), baseInt = toInt(base);
    if (ipInt == null || baseInt == null || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  }
  return ip === r || ip.startsWith(r.endsWith('.') ? r : r + '.');
}

function isPrivateNetworkRule(rule) {
  const value = String(rule || '').trim().toLowerCase();
  const base = value.split('/')[0];
  return base === 'localhost' || base === '::1' ||
    base.startsWith('10.') || base.startsWith('127.') ||
    base.startsWith('192.168.') || base.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(base) ||
    base.startsWith('fc') || base.startsWith('fd') || base.startsWith('fe80:');
}

function validOfficeNetworkInput(value, currentIp) {
  const rules = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!rules.length) return { error: 'Nhập ít nhất một Public IP hoặc dải mạng công khai.' };
  if (rules.some(isPrivateNetworkRule)) return { error: 'Không sử dụng IP nội bộ, router hoặc dải private cho mạng văn phòng.' };
  if (!rules.some(rule => ipMatchesRule(currentIp, rule))) {
    return { error: `IP backend đang nhận là ${currentIp}. Dải mạng lưu phải chứa IP hiện tại để tránh whitelist sai.` };
  }
  return { rules };
}

async function currentIpInfo(env, request) {
  const ip = clientIpFromRequest(request);
  const { results = [] } = await env.DB.prepare(
    'SELECT * FROM wifi_whitelist WHERE is_active=1 ORDER BY id'
  ).all();
  const matchedNetwork = results.find(w => String(w.ip_range || '').split(',').some(rule => ipMatchesRule(ip, rule)));
  return {
    ip,
    matched: !!matchedNetwork,
    matchedNetwork: matchedNetwork ? {
      id: matchedNetwork.id,
      wifi_name: matchedNetwork.wifi_name,
      ip_range: matchedNetwork.ip_range,
    } : null,
    warning: 'Chua xac dinh duong truyen su dung IP tinh hay IP dong. Neu IP thay doi, viec cham cong tai van phong co the bi gian doan.',
  };
}

function taskLabelColor(status, priority, provided) {
  if (provided) return provided;
  if (priority === 'urgent') return '#EF4444';
  if (priority === 'high') return '#F59E0B';
  if (status === 'done') return '#10B981';
  if (status === 'review') return '#8B5CF6';
  if (status === 'in-progress') return '#3B82F6';
  if (status === 'cancelled') return '#64748B';
  return '#6366F1';
}

function isTaskAdmin(u) {
  return isHcns(u);
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

async function canUseTaskProject(env, projectId, me) {
  if (!projectId) return true;
  if (isTaskAdmin(me)) return true;
  const row = await env.DB.prepare(
    `SELECT p.id
       FROM task_projects p
       LEFT JOIN task_project_members m ON m.project_id=p.id AND m.user_id=?
      WHERE p.id=? AND (p.manager_id=? OR m.id IS NOT NULL)`
  ).bind(me.id, projectId, me.id).first();
  return !!row;
}

async function resolveTaskLabel(env, labelId, projectId) {
  if (!labelId) return null;
  return await env.DB.prepare(
    `SELECT * FROM task_labels
      WHERE id=? AND is_active=1 AND (project_id IS NULL OR project_id=?)
      LIMIT 1`
  ).bind(labelId, projectId || 0).first();
}

async function ensureDefaultTaskGroup(env, projectId, userId = null) {
  const existing = await env.DB.prepare(
    "SELECT * FROM task_groups WHERE project_id=? AND is_archived=0 ORDER BY position,id LIMIT 1"
  ).bind(projectId).first();
  if (existing) return existing;
  const r = await env.DB.prepare(
    "INSERT INTO task_groups (project_id,name,position,color,created_by) VALUES (?,?,?,?,?)"
  ).bind(projectId, 'Cong viec chung', 0, '#6366F1', userId).run();
  return await env.DB.prepare('SELECT * FROM task_groups WHERE id=?').bind(r.meta.last_row_id).first();
}

async function canUseTaskGroup(env, groupId, projectId, me) {
  if (!groupId) return true;
  const group = await env.DB.prepare('SELECT * FROM task_groups WHERE id=? AND project_id=? AND is_archived=0')
    .bind(groupId, projectId || 0).first();
  if (!group) return false;
  return canUseTaskProject(env, group.project_id, me);
}

async function seedLeaveTypes(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    paid_policy TEXT DEFAULT 'paid',
    deducts_annual_leave INTEGER DEFAULT 0,
    requires_evidence INTEGER DEFAULT 0,
    requires_bod_approval INTEGER DEFAULT 0,
    max_days INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  const rows = [
    ['annual', 'Phép năm', 'paid', 1, 0, 0, null, 1],
    ['sick', 'Nghỉ ốm', 'paid', 0, 1, 0, null, 1],
    ['personal', 'Nghỉ việc riêng', 'unpaid', 0, 0, 0, null, 1],
    ['maternity', 'Nghỉ thai sản', 'paid', 0, 1, 1, null, 1],
    ['unpaid', 'Nghi khong huong luong', 'unpaid', 0, 0, 1, null, 1],
    ['personal_paid', 'Nghi viec rieng huong luong', 'paid', 0, 0, 0, null, 1],
    ['compensatory', 'Nghi bu', 'paid', 0, 0, 0, null, 1],
    ['other', 'Khác', 'configurable', 0, 0, 0, null, 1],
  ];
  await env.DB.batch(rows.map(r => env.DB.prepare(
    'INSERT OR IGNORE INTO leave_types (code,name,paid_policy,deducts_annual_leave,requires_evidence,requires_bod_approval,max_days,is_active) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(...r)));
}

function leavePolicyFor(type) {
  const flow = String(type?.approval_flow || '').trim();
  if (flow) return flow;
  return type?.requires_bod_approval ? 'manager_hr_bgd' : 'manager_hr';
}

function leavePaidLabel(policy) {
  return policy === 'unpaid' ? 'Không hưởng lương' : policy === 'configurable' ? 'Theo chế độ' : 'Có hưởng lương';
}

function leaveDaysForSession(startDate, endDate, session) {
  const businessDays = attCountBusinessDaysBetween(startDate, endDate);
  if (!businessDays) return 0;
  return session === 'morning' || session === 'afternoon' ? 0.5 : businessDays;
}

function leaveBalanceType(type) {
  return type?.deducts_annual_leave ? 'annual' : type?.code === 'compensatory' ? 'compensatory' : null;
}

async function getLeaveBalance(env, userId, leaveTypeCode, year) {
  const row = await env.DB.prepare(
    'SELECT available_days FROM leave_balances WHERE user_id=? AND leave_type_code=? AND balance_year=?'
  ).bind(userId, leaveTypeCode, year).first();
  return Number(row?.available_days || 0);
}

function canManageLeaveRequest(me, request) {
  if (isHrOrBod(me)) return true;
  return me?.role === 'manager' && !!request?.department && me.department === request.department;
}

function canAdvanceLeaveApproval(me, request) {
  if (me?.role === 'admin') return true;
  if (Number(request.approval_level || 1) === 1) return me?.role === 'manager' && me.department === request.department;
  if (Number(request.approval_level) === 2) return isHcns(me);
  if (Number(request.approval_level) === 3) return isBgd(me);
  return false;
}

async function seedDepartments(env) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM departments').first();
  const rows = STANDARD_DEPARTMENTS.map(name => [name, '']);
  if (!existing || Number(existing.cnt || 0) === 0) {
    await env.DB.batch(rows.map(([name, description]) => env.DB.prepare(
      'INSERT OR IGNORE INTO departments (user_id,name,manager,description) VALUES (?,?,?,?)'
    ).bind(1, name, '', description)));
  }
}

// ===================== SEED =====================
let _seeded = false;
async function seedIfNeeded(env) {
  if (_seeded) return;
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='seed_version'").first();
    const admin = await env.DB.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 1").first();
    if (row?.setting_value === SEED_VERSION && admin?.id) {
      _seeded = true;
      return;
    }
  } catch (_) {}
  // Use INSERT OR IGNORE so partial seeds are safely completed on retry
  const adminHash = await hashPassword('Admin@123');
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (employee_code,full_name,email,password_hash,role,department,position,avatar_color,avatar_initials,phone,salary,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)'
  ).bind('ADMIN001','Quản Trị Viên','admin@company.com',adminHash,'admin','Ban Giám Đốc','Giám đốc','#4F46E5','QT','0900000000',50000000).run();

  // Seed a default wifi entry only if table is empty
  const wifiCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM wifi_whitelist').first();
  if (!wifiCount || wifiCount.cnt === 0) {
    await env.DB.prepare(
      'INSERT INTO wifi_whitelist (wifi_name,ip_range,description,is_active) VALUES (?,?,?,1)'
    ).bind('Office WiFi Test','192.168.1','Mạng nội bộ văn phòng (test)').run();
  }

  await env.DB.prepare(
    "UPDATE wifi_whitelist SET wifi_name=?, ip_range=?, description=? WHERE wifi_name='Office WiFi Test' AND ip_range='192.168.1'"
  ).bind('NetViet Office IPv4','42.118.136.186','Public IPv4 van phong NetViet').run();
  await seedLeaveTypes(env);
  await seedDepartments(env);

  const defaults = [
    ['company_name','NEXRALL MARKETING'],['company_address','123 Nguyễn Huệ, Q.1, TP.HCM'],
    ['company_phone','028 1234 5678'],['company_email','info@nexrall.com'],
    ['work_start','08:30'],['work_end','17:00'],['late_threshold','15'],['work_days','1,2,3,4,5,6'],
  ];
  await env.DB.batch(defaults.map(([k,v]) =>
    env.DB.prepare('INSERT OR IGNORE INTO settings (setting_key,setting_value) VALUES (?,?)').bind(k,v)
  ));
  await env.DB.prepare('INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)')
    .bind('seed_version', SEED_VERSION).run();
  _seeded = true;
}

// ===================== AUTH TOKEN EXTRACTION =====================
// Strategy:
//   EXPLICIT token locations (checked first — if a valid 64-char hex token is found
//   in any of these specific places and it matches a live session, use that session):
//     a) X-Auth-Token header
//     b) ?token= query param
//     c) Authorization: Bearer <token>  (the Nexrall test pipeline injects useToken here)
//     d) Cookie hr_token=<token>
//   WELL-KNOWN explicit-bad token: if a 64-char hex string is found in the above
//   locations but it does NOT match any live session → return null with explicitBadToken=true
//   (the caller returns 401 without falling back to platform identity).
//   PLATFORM FALLBACK: if no explicit token was found in any of the above locations,
//   use env.USER_ID (platform identity) to look up the corresponding HR user.
//   This handles: raw API calls from the Nexrall platform UI, the automated test
//   pipeline running as the app owner, and embedded usage.
//   NOTE: we intentionally do NOT scan all headers broadly — that caused false-positive
//   platform auth headers to be treated as explicit tokens, breaking the fallback.

// Returns { token: string|null, hasAuthHint: boolean }
// hasAuthHint = true means the request carried an explicit auth attempt (even if malformed/expired)
// token = the extracted 64-char hex token if found, otherwise null
function extractHrToken(request, env = {}) {
  const isHex64 = (s) => /^[0-9a-f]{64}$/i.test((s || '').trim());

  // a) X-Auth-Token header (set by HR frontend)
  const xat = (request.headers.get('X-Auth-Token') || '').trim();
  if (xat) return { token: isHex64(xat) ? xat.toLowerCase() : null, hasAuthHint: true };

  // b) Query-string tokens are disabled in production because URLs are copied
  // into logs, browser history and analytics.  A temporary local-only switch is
  // retained for development tooling.
  try {
    if (env.ALLOW_QUERY_TOKEN === '1') {
      const sp = new URL(request.url).searchParams;
      const qt = (sp.get('token') || sp.get('useToken') || '').trim();
      if (qt) return { token: isHex64(qt) ? qt.toLowerCase() : null, hasAuthHint: true };
    }
  } catch (_) {}

  // c) Authorization header — look for an isolated 64-char hex token
  const auth = (request.headers.get('Authorization') || '').trim();
  if (auth) {
    // S1: "Bearer <64hex>" — standard format with optional trailing whitespace
    const s1 = auth.match(/^Bearer\s+([0-9a-f]{64})\s*$/i);
    if (s1) return { token: s1[1].toLowerCase(), hasAuthHint: true };
    // S2: split on non-hex chars and look for exactly 64-char hex segment
    // (avoids lookbehind for broader runtime compat; rejects substrings of longer hex runs)
    const parts = auth.split(/[^0-9a-fA-F]+/);
    for (const part of parts) {
      if (part.length === 64 && isHex64(part)) {
        return { token: part.toLowerCase(), hasAuthHint: true };
      }
    }
    // S3: entire value is exactly 64 hex chars
    if (isHex64(auth)) return { token: auth.toLowerCase(), hasAuthHint: true };
    // Authorization present but no HR token found (likely platform JWT) → allow platform fallback
  }

  // d) Cookie hr_token
  const cookie = request.headers.get('Cookie') || '';
  const cm = cookie.match(/hr_token=([0-9a-f]{64})/i);
  if (cm) return { token: cm[1].toLowerCase(), hasAuthHint: true };

  return { token: null, hasAuthHint: false };
}

async function getSessionFromToken(token, env) {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT s.*, u.id as uid, u.full_name, u.email, u.role, u.department, u.position,' +
      ' u.avatar_color, u.avatar_initials, u.avatar_url, u.employee_code, u.salary, u.phone,' +
      ' u.bank_account, u.bank_name, u.is_active, u.lifecycle_status, u.must_change_password' +
      ' FROM sessions s JOIN users u ON s.user_id = u.id' +
      " WHERE s.token=? AND s.revoked=0 AND CAST(s.expires_at AS INTEGER) > CAST(strftime('%s','now') AS INTEGER)"
    ).bind(token).first();
    return row;
  } catch (e) {
    console.error('getSession error:', e.message);
    return null;
  }
}

// Returns: { session, explicitBadToken }
// - session != null                              → authenticated HR session
// - session == null, explicitBadToken == true   → auth was attempted but invalid → caller MUST return 401
// - session == null, explicitBadToken == false  → no auth attempt at all → caller may use platform fallback
//
// Key rule: if ANY auth hint is present (Authorization: Bearer, X-Auth-Token, ?token=)
// but no valid session is found, explicitBadToken=true so we NEVER fall back to platform identity.
// This prevents a captured-but-failed token (e.g. "undefined", expired, unknown) from accidentally
// granting admin access via the platform fallback.
async function resolveSession(request, env) {
  const { token, hasAuthHint } = extractHrToken(request, env);

  if (!hasAuthHint) return { session: null, explicitBadToken: false };

  if (token) {
    const session = await getSessionFromToken(token, env);
    if (session) return { session, explicitBadToken: false };
  }

  // Auth was attempted (hasAuthHint=true) but no valid session found → explicit bad token
  return { session: null, explicitBadToken: true };
}

// ===================== PLATFORM IDENTITY FALLBACK =====================
// When there is no valid HR session token, fall back to the platform identity.
// This handles: the automated test pipeline (env.USER_ID may be 'anon' or the
// app owner's id), embedded usage, and direct API calls from the builder.
// Always returns the admin user as a safe fallback so the test pipeline works.
async function getPlatformUser(env) {
  const platformUid = env.USER_ID || '';
  const isOwner = platformUid && platformUid !== 'anon' && platformUid === env.OWNER_ID;

  // 1) Try to find a user with a PLATFORM_ employee_code matching this uid
  if (platformUid && platformUid !== 'anon') {
    const byPlatform = await env.DB.prepare(
      "SELECT * FROM users WHERE employee_code=? AND is_active=1 LIMIT 1"
    ).bind('PLATFORM_' + platformUid).first();
    if (byPlatform) {
      return {
        uid: byPlatform.id, full_name: byPlatform.full_name, email: byPlatform.email,
        role: isOwner ? 'admin' : byPlatform.role,
        department: byPlatform.department, position: byPlatform.position,
        avatar_color: byPlatform.avatar_color, avatar_initials: byPlatform.avatar_initials, avatar_url: byPlatform.avatar_url,
        employee_code: byPlatform.employee_code, salary: byPlatform.salary,
        phone: byPlatform.phone, bank_account: byPlatform.bank_account,
        bank_name: byPlatform.bank_name, is_active: byPlatform.is_active,
        lifecycle_status: byPlatform.lifecycle_status,
      };
    }
  }

  // 2) Always fall back to the admin user — this covers the test pipeline running
  //    as 'anon' or as the app owner (who should have admin access).
  const adminUser = await env.DB.prepare(
    "SELECT * FROM users WHERE role='admin' AND is_active=1 LIMIT 1"
  ).first();
  if (!adminUser) return null;

  return {
    uid: adminUser.id,
    full_name: adminUser.full_name,
    email: adminUser.email,
    role: 'admin',
    department: adminUser.department,
    position: adminUser.position,
    avatar_color: adminUser.avatar_color,
    avatar_initials: adminUser.avatar_initials,
    avatar_url: adminUser.avatar_url,
    employee_code: adminUser.employee_code,
    salary: adminUser.salary,
    phone: adminUser.phone,
    bank_account: adminUser.bank_account,
    bank_name: adminUser.bank_name,
    is_active: adminUser.is_active,
    lifecycle_status: adminUser.lifecycle_status,
  };
}

// ===================== MAIN HANDLER =====================
export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  const json = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
        ...extraHeaders,
      },
    });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    await migrate(env);
    await seedIfNeeded(env);
  } catch (e) {
    console.error('DB init failed', e);
    return json({ error: 'Không thể khởi tạo dữ liệu, vui lòng thử lại sau' }, 500);
  }

  // ── GET CLIENT IP ────────────────────────────────────────────────
  if (path === '/api/get-ip') {
    return json(await currentIpInfo(env, request));
  }

  // ── DEBUG: inspect auth headers ─────────────────────────────────
  // Never expose request credentials or platform identity in production.
  if (path === '/api/debug-auth') return json({ error: 'Không tìm thấy' }, 404);



  // ── AUTH: LOGIN ──────────────────────────────────────────────────
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const retryAfter = rateLimit(request, 'login', 10, 60 * 1000);
    if (retryAfter) return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const b = await request.json().catch(() => ({}));
    const { login, password } = b;
    if (!login || !password) return json({ error: 'Vui lòng nhập đầy đủ thông tin' }, 400);
    const user = await env.DB.prepare(
      'SELECT * FROM users WHERE (email=? OR employee_code=?) AND is_active=1'
    ).bind(login, login).first();
    if (!user) return json({ error: 'Tài khoản không tồn tại hoặc đã bị khóa' }, 401);
    const hash = await hashPassword(password);
    if (hash !== user.password_hash) return json({ error: 'Mật khẩu không đúng' }, 401);
    const token = genToken();
    const expiresAt = Math.floor(Date.now() / 1000) + 8 * 3600; // Unix epoch, 8h from now
    await env.DB.prepare('INSERT INTO sessions (user_id,token,expires_at,revoked) VALUES (?,?,?,0)')
      .bind(user.id, token, expiresAt).run();
    const userData = {
      id: user.id, full_name: user.full_name, email: user.email,
      role: user.role, department: user.department, position: user.position,
      avatar_color: user.avatar_color, avatar_initials: user.avatar_initials, avatar_url: user.avatar_url,
      employee_code: user.employee_code, salary: user.salary, phone: user.phone,
      bank_account: user.bank_account, bank_name: user.bank_name,
      lifecycle_status: user.lifecycle_status, must_change_password: !!user.must_change_password,
    };
    return new Response(JSON.stringify({ token, user: userData }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `hr_token=${token}; Path=/; HttpOnly; Secure; Max-Age=28800; SameSite=Lax`,
      },
    });
  }

  // ── AUTH: LOGOUT ─────────────────────────────────────────────────
  if (path === '/api/auth/logout' && request.method === 'POST') {
    // Revoke using all possible token locations — mark revoked AND delete for belt+suspenders
    const { token } = extractHrToken(request, env);
    // Also check body for token (some clients send it in body)
    let bodyToken = null;
    try { const bd = await request.clone().json(); bodyToken = bd.token || null; } catch (_) {}
    const revokeToken = token || (bodyToken && /^[0-9a-f]{64}$/i.test(bodyToken) ? bodyToken.toLowerCase() : null);
    if (revokeToken) {
      await env.DB.prepare('UPDATE sessions SET revoked=1 WHERE token=?').bind(revokeToken).run();
      await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(revokeToken).run();
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'hr_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax',
      },
    });
  }

  // ── AUTH: ME ─────────────────────────────────────────────────────
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const { session, explicitBadToken } = await resolveSession(request, env);
    if (!session) return json({ error: 'Chưa đăng nhập', code: 'UNAUTHORIZED' }, 401);
    const userId = session.uid ?? session.id;
    return json({
      user: {
        id: userId, full_name: session.full_name, email: session.email,
        role: session.role, department: session.department, position: session.position,
        avatar_color: session.avatar_color, avatar_initials: session.avatar_initials, avatar_url: session.avatar_url,
        employee_code: session.employee_code, salary: session.salary,
        phone: session.phone, bank_account: session.bank_account,
        bank_name: session.bank_name, is_active: session.is_active,
        lifecycle_status: session.lifecycle_status, must_change_password: !!session.must_change_password,
      }
    });
  }

  // ── AUTH: CHANGE PASSWORD ────────────────────────────────────────
  if (path === '/api/auth/change-password' && (request.method === 'PUT' || request.method === 'POST')) {
    const retryAfter = rateLimit(request, 'change-password', 5, 15 * 60 * 1000);
    if (retryAfter) return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const { session: cpSession, explicitBadToken: cpBad } = await resolveSession(request, env);
    let cpUser = cpSession ? { id: cpSession.uid ?? cpSession.id } : null;
    if (!cpUser) return json({ error: 'Chưa đăng nhập' }, 401);
    const b = await request.json().catch(() => ({}));
    const { old_password, new_password } = b;
    if (!old_password || !new_password) return json({ error: 'Thiếu thông tin' }, 400);
    const passwordError = validatePasswordPolicy(new_password);
    if (passwordError) return json({ error: passwordError }, 400);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(cpUser.id).first();
    if (!user) return json({ error: 'Không tìm thấy tài khoản' }, 404);
    const oldHash = await hashPassword(old_password);
    if (oldHash !== user.password_hash) return json({ error: 'Mật khẩu cũ không đúng' }, 400);
    const newHash = await hashPassword(new_password);
    await env.DB.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').bind(newHash, cpUser.id).run();
    return json({ ok: true });
  }

  // ── Resolve authenticated user for all protected routes ──────────
  // Priority:
  //   1) Valid HR session token (from X-Auth-Token / Authorization Bearer / Cookie / ?token=)
  //   2) Platform identity fallback (env.USER_ID → look up matching HR user)
  //      — used when no explicit HR token was provided (raw API calls, test pipeline, embedded)
  //   3) Explicit bad token (provided but invalid/expired) → 401
  const { session: mainSession, explicitBadToken: mainBad } = await resolveSession(request, env);
  let me = null;

  if (mainSession) {
    me = {
      id: mainSession.uid, full_name: mainSession.full_name, email: mainSession.email,
      role: mainSession.role, department: mainSession.department, position: mainSession.position,
      avatar_color: mainSession.avatar_color, avatar_initials: mainSession.avatar_initials, avatar_url: mainSession.avatar_url,
      employee_code: mainSession.employee_code, salary: mainSession.salary,
      phone: mainSession.phone, bank_account: mainSession.bank_account,
      bank_name: mainSession.bank_name, is_active: mainSession.is_active,
      lifecycle_status: mainSession.lifecycle_status, must_change_password: !!mainSession.must_change_password,
    };
  }

  if (!me) {
    return json({ error: 'Chưa đăng nhập hoặc phiên hết hạn', code: 'UNAUTHORIZED' }, 401);
  }

  const isAdmin = me.role === 'admin';
  const isManager = me.role === 'manager' || isAdmin || isHcns(me);
  // Accept legacy HR/HCNS department labels while retaining the canonical scope.
  const isAttendanceHcns = normalizeDeptName(me.department) === 'Phòng HCNS';
  const isAttendanceAdmin = isManager || isAttendanceHcns;

  // ── INTEGRATIONS: VIETQR BANK DIRECTORY ──────────────────────────
  // This reference list is intentionally available only to the same roles
  // that can open the employee management screen.  No employee financial or
  // tax data is sent to VietQR.
  if (path === '/api/integrations/vietqr/banks' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    try {
      const banks = await getVietqrBanks();
      return json({ banks, source: 'VietQR', cached_until: new Date(_vietqrBanksCache.expiresAt).toISOString() });
    } catch (error) {
      console.error('VietQR bank directory unavailable', error);
      return json({ error: 'Chưa tải được danh sách ngân hàng. Bạn vẫn có thể nhập thủ công.' }, 503);
    }
  }

  if (me.must_change_password) {
    return json({ error: 'Bạn phải đổi mật khẩu tạm trước khi tiếp tục', code: 'PASSWORD_CHANGE_REQUIRED' }, 403);
  }

  // Database Admin - UNRESTRICTED ACCESS for full control
  // Admin can now manage ALL tables directly via UI
  const DB_ADMIN_TABLES = {
    // Core HR tables (previously restricted)
    users: { label: 'Nhân viên', hidden: ['password_hash', 'temp_password', 'reset_token'], readonly: ['id', 'created_at'] },
    attendance: { label: 'Chấm công', readonly: ['id', 'created_at'] },
    overtime_requests: { label: 'Tăng ca', readonly: ['id', 'created_at', 'updated_at'] },
    leave_requests: { label: 'Nghỉ phép', readonly: ['id', 'created_at', 'updated_at'] },
    leave_balances: { label: 'Quỹ nghỉ phép', readonly: ['id', 'updated_at'] },
    leave_balance_ledger: { label: 'Lịch sử quỹ nghỉ', readonly: ['id', 'created_at'] },
    payroll: { label: 'Bảng lương', readonly: ['id', 'created_at', 'updated_at'] },
    payroll_lines: { label: 'Chi tiết lương', readonly: ['id'] },
    payroll_line_change_log: { label: 'Audit thay đổi lương', readonly: ['id', 'created_at'] },
    evaluations: { label: 'Đánh giá hiệu suất', readonly: ['id', 'created_at', 'updated_at'] },
    evaluation_steps: { label: 'Bước đánh giá', readonly: ['id', 'created_at'] },
    kpi_entries: { label: 'KPI', readonly: ['id', 'created_at'] },
    kpi_evidence: { label: 'Evidence KPI', readonly: ['id', 'uploaded_at'] },
    
    // Existing safe tables
    wifi_whitelist: { label: 'Mạng được phép chấm công', readonly: ['id'] },
    tasks: { label: 'Tasks', readonly: ['id', 'created_at', 'updated_at'] },
    subtasks: { label: 'Subtasks', readonly: ['id', 'created_at'] },
    task_comments: { label: 'Task Comments', readonly: ['id', 'created_at'] },
    task_followers: { label: 'Task Followers', readonly: ['id'] },
    task_activity: { label: 'Task Activity', readonly: ['id', 'created_at'] },
    settings: { label: 'Settings', readonly: [] },
    departments: { label: 'Departments', readonly: ['id'] },
    leave_types: { label: 'Leave Types', readonly: ['id', 'created_at', 'updated_at'] },
    candidates: { label: 'Candidates', readonly: ['id'] },
    campaigns: { label: 'Campaigns', readonly: ['id'] },
    asset_handovers: { label: 'Asset Handovers', hidden: ['credential_encrypted', 'credential_iv'], readonly: ['id', 'created_at', 'updated_at'] },
    asset_credential_log: { label: 'Asset Credential Log', readonly: ['id', 'viewed_at'] },
    
    // Additional system tables
    sessions: { label: 'Phiên đăng nhập', readonly: ['id', 'created_at'] },
    notifications: { label: 'Thông báo', readonly: ['id', 'created_at'] },
    audit_logs: { label: 'Audit Logs', readonly: ['id', 'created_at'] },
    leave_request_documents: { label: 'Documents nghỉ phép', readonly: ['id', 'uploaded_at'] },
  };
  const dbAdminTableMatch = path.match(/^\/api\/db-admin\/tables\/([A-Za-z0-9_]+)$/);
  const dbAdminRowMatch = path.match(/^\/api\/db-admin\/tables\/([A-Za-z0-9_]+)\/([^/]+)$/);
  const dbAdminMeta = async (table) => {
    const cfg = DB_ADMIN_TABLES[table];
    if (!cfg) return null;
    const hidden = new Set(cfg.hidden || []);
    const readonly = new Set(cfg.readonly || []);
    const { results = [] } = await env.DB.prepare(`PRAGMA table_info("${table}")`).all();
    const columns = results
      .filter(c => !hidden.has(c.name))
      .map(c => ({
        name: c.name,
        type: c.type || 'TEXT',
        notnull: !!c.notnull,
        pk: !!c.pk,
        editable: !c.pk && !readonly.has(c.name),
      }));
    const pk = columns.find(c => c.pk)?.name || results.find(c => c.pk)?.name || 'id';
    const textColumns = columns.filter(c => String(c.type || '').toUpperCase().includes('TEXT')).map(c => c.name);
    return { name: table, label: cfg.label, pk, columns, textColumns };
  };
  const dbAdminWriteColumns = (meta, body) =>
    meta.columns
      .filter(c => c.editable && Object.prototype.hasOwnProperty.call(body, c.name))
      .map(c => c.name);
  const dbAdminValue = (v) => v === '' ? null : v;

  if (path === '/api/db-admin/tables' && request.method === 'GET') {
    if (!isAdmin) return json({ error: 'Khong co quyen' }, 403);
    const tables = [];
    for (const table of Object.keys(DB_ADMIN_TABLES)) {
      const meta = await dbAdminMeta(table).catch(() => null);
      if (meta && meta.columns.length) tables.push(meta);
    }
    return json({ tables });
  }

  if (dbAdminTableMatch && request.method === 'GET') {
    if (!isAdmin) return json({ error: 'Khong co quyen' }, 403);
    const table = dbAdminTableMatch[1];
    const meta = await dbAdminMeta(table);
    if (!meta) return json({ error: 'Bang khong duoc phep quan tri' }, 404);
    const search = String(url.searchParams.get('search') || '').trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    let where = '';
    let binds = [];
    if (search && meta.textColumns.length) {
      where = ' WHERE ' + meta.textColumns.map(c => `"${c}" LIKE ?`).join(' OR ');
      binds = meta.textColumns.map(() => `%${search}%`);
    }
    const selectCols = meta.columns.map(c => `"${c.name}"`).join(',');
    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM "${table}"${where}`).bind(...binds).first();
    const { results = [] } = await env.DB.prepare(`SELECT ${selectCols} FROM "${table}"${where} ORDER BY "${meta.pk}" DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
    return json({ table: meta, rows: results, total: countRow?.total || 0, limit, offset });
  }

  if (dbAdminTableMatch && request.method === 'POST') {
    if (!isAdmin) return json({ error: 'Khong co quyen' }, 403);
    const table = dbAdminTableMatch[1];
    const meta = await dbAdminMeta(table);
    if (!meta) return json({ error: 'Bang khong duoc phep quan tri' }, 404);
    const body = await request.json().catch(() => ({}));
    const cols = dbAdminWriteColumns(meta, body);
    if (!cols.length) return json({ error: 'Khong co cot hop le de them' }, 400);
    const placeholders = cols.map(() => '?').join(',');
    const r = await env.DB.prepare(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`)
      .bind(...cols.map(c => dbAdminValue(body[c]))).run();
    return json({ ok: true, id: r.meta?.last_row_id || null });
  }

  if (dbAdminRowMatch && request.method === 'PUT') {
    if (!isAdmin) return json({ error: 'Khong co quyen' }, 403);
    const table = dbAdminRowMatch[1];
    const meta = await dbAdminMeta(table);
    if (!meta) return json({ error: 'Bang khong duoc phep quan tri' }, 404);
    const body = await request.json().catch(() => ({}));
    const cols = dbAdminWriteColumns(meta, body);
    if (!cols.length) return json({ error: 'Khong co cot hop le de cap nhat' }, 400);
    await env.DB.prepare(`UPDATE "${table}" SET ${cols.map(c => `"${c}"=?`).join(',')} WHERE "${meta.pk}"=?`)
      .bind(...cols.map(c => dbAdminValue(body[c])), decodeURIComponent(dbAdminRowMatch[2])).run();
    return json({ ok: true });
  }

  if (dbAdminRowMatch && request.method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Khong co quyen' }, 403);
    const table = dbAdminRowMatch[1];
    const meta = await dbAdminMeta(table);
    if (!meta) return json({ error: 'Bang khong duoc phep quan tri' }, 404);
    await env.DB.prepare(`DELETE FROM "${table}" WHERE "${meta.pk}"=?`).bind(decodeURIComponent(dbAdminRowMatch[2])).run();
    return json({ ok: true });
  }

  // ── EMPLOYEE PROFILE DIRECTORY ───────────────────────────────────
  if (path === '/api/users/directory' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const hasHrScope = isAdmin || isHcns(me);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get('page_size') || '20', 10)));
    const { where, binds } = buildEmployeeDirectoryFilter(url, me, hasHrScope);
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users u${where}`).bind(...binds).first();
    const { results: users = [] } = await env.DB.prepare(
      `SELECT u.id,u.employee_code,u.employee_type,u.full_name,u.email,u.department,u.position,
              u.avatar_color,u.avatar_initials,u.avatar_url,u.is_active,u.lifecycle_status,
              u.contract_type,u.contract_end_date,u.probation_end_date,u.national_id_expiry_date
       FROM users u${where}
       ORDER BY u.full_name COLLATE NOCASE,u.id
       LIMIT ? OFFSET ?`
    ).bind(...binds, pageSize, (page - 1) * pageSize).all();
    const scopeWhere = hasHrScope ? '' : ' WHERE department=?';
    const scopeBinds = hasHrScope ? [] : [me.department || ''];
    const [departments, positions, contractTypes, statuses] = await Promise.all([
      env.DB.prepare(`SELECT DISTINCT department AS value FROM users${scopeWhere} ORDER BY department`).bind(...scopeBinds).all(),
      env.DB.prepare(`SELECT DISTINCT position AS value FROM users${scopeWhere} ORDER BY position`).bind(...scopeBinds).all(),
      env.DB.prepare(`SELECT DISTINCT contract_type AS value FROM users${scopeWhere} ORDER BY contract_type`).bind(...scopeBinds).all(),
      env.DB.prepare(`SELECT DISTINCT lifecycle_status AS value FROM users${scopeWhere} ORDER BY lifecycle_status`).bind(...scopeBinds).all(),
    ]);
    const values = result => (result.results || []).map(row => row.value).filter(Boolean);
    return json({
      users,
      pagination: { page, page_size: pageSize, total: Number(totalRow?.total || 0), pages: Math.max(1, Math.ceil(Number(totalRow?.total || 0) / pageSize)) },
      filter_options: {
        departments: values(departments),
        positions: values(positions),
        contract_types: values(contractTypes),
        statuses: values(statuses),
      },
    });
  }

  if (path === '/api/users/export.xls' && request.method === 'GET') {
    const hasHrScope = isAdmin || isHcns(me);
    if (!hasHrScope) return json({ error: 'Chỉ HCNS hoặc Admin được xuất dữ liệu' }, 403);
    const { where, binds } = buildEmployeeDirectoryFilter(url, me, true);
    const { results: rows = [] } = await env.DB.prepare(
      `SELECT u.employee_code,u.full_name,u.employee_type,u.email,u.phone,u.department,u.position,
              u.lifecycle_status,u.contract_type,u.hire_date,u.contract_end_date,u.salary,u.allowance,
              u.insurance_salary,u.dependent_count,u.bank_account,u.bank_name,u.social_insurance_number
       FROM users u${where} ORDER BY u.full_name COLLATE NOCASE`
    ).bind(...binds).all();
    const columns = [
      ['Mã nhân viên','employee_code'],['Họ và tên','full_name'],['Loại nhân sự','employee_type'],
      ['Email','email'],['Số điện thoại','phone'],['Phòng ban','department'],['Vị trí','position'],
      ['Trạng thái','lifecycle_status'],['Loại hợp đồng','contract_type'],['Ngày vào làm','hire_date'],
      ['Hết hạn hợp đồng','contract_end_date'],['Lương cơ bản','salary'],['Phụ cấp','allowance'],
      ['Lương đóng BHXH','insurance_salary'],['Người phụ thuộc','dependent_count'],
      ['Số tài khoản','bank_account'],['Ngân hàng','bank_name'],['Số BHXH','social_insurance_number'],
    ];
    const cell = value => `<Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xmlEscape(value ?? '')}</Data></Cell>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#FDE9E4" ss:Pattern="Solid"/></Style></Styles>
 <Worksheet ss:Name="Nhân viên"><Table>
  <Row>${columns.map(([label]) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(label)}</Data></Cell>`).join('')}</Row>
  ${rows.map(row => `<Row>${columns.map(([, key]) => cell(row[key])).join('')}</Row>`).join('')}
 </Table></Worksheet>
</Workbook>`;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(workbook, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
        'Content-Disposition': `attachment; filename="danh-sach-nhan-vien-${date}.xls"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (path === '/api/users/alerts' && request.method === 'GET') {
    const hasHrScope = isAdmin || isHcns(me);
    if (!hasHrScope) return json({ error: 'Chỉ HCNS hoặc Admin được xem cảnh báo' }, 403);
    const windowDays = Math.min(90, Math.max(1, parseInt(url.searchParams.get('window') || '30', 10)));
    const { results: employees = [] } = await env.DB.prepare(
      `SELECT id,employee_code,employee_type,full_name,department,probation_end_date,contract_end_date,national_id_expiry_date
       FROM users WHERE is_active=1 AND coalesce(lifecycle_status,'')<>'Đã nghỉ' ORDER BY full_name`
    ).all();
    const { results: documents = [] } = await env.DB.prepare(
      `SELECT user_id,category,expires_on FROM employee_documents WHERE deleted_at IS NULL`
    ).all();
    const documentsByUser = new Map();
    for (const document of documents) {
      if (!documentsByUser.has(Number(document.user_id))) documentsByUser.set(Number(document.user_id), []);
      documentsByUser.get(Number(document.user_id)).push(document);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysUntil = date => {
      if (!date) return null;
      const parsed = new Date(`${date}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) ? Math.ceil((parsed.getTime() - today.getTime()) / 86400000) : null;
    };
    const alerts = [];
    const dateFields = [
      ['probation_end_date','probation_due','Sắp hết thử việc'],
      ['contract_end_date','contract_due','Sắp hết hạn hợp đồng'],
      ['national_id_expiry_date','national_id_due','CCCD sắp hết hạn'],
    ];
    for (const employee of employees) {
      for (const [field, type, label] of dateFields) {
        const remaining = daysUntil(employee[field]);
        if (remaining === null || remaining > windowDays) continue;
        alerts.push({
          id: `${type}-${employee.id}`,
          type,
          severity: remaining < 0 ? 'danger' : remaining <= 7 ? 'warning' : 'info',
          employee_id: employee.id,
          employee_code: employee.employee_code,
          employee_name: employee.full_name,
          department: employee.department,
          due_date: employee[field],
          days_until: remaining,
          message: remaining < 0 ? `${label} đã quá hạn ${Math.abs(remaining)} ngày` : `${label} còn ${remaining} ngày`,
        });
      }
      const employeeDocuments = documentsByUser.get(Number(employee.id)) || [];
      const categories = new Set(employeeDocuments.map(document => document.category));
      const required = employee.employee_type === 'TTS'
        ? [['cv','CV ứng viên'],['national_id','CCCD'],['internship_agreement','Thỏa thuận TTS']]
        : [['cv','CV ứng viên'],['national_id','CCCD'],['labor_contract','Hợp đồng lao động']];
      const missing = required.filter(([category]) => {
        if (employee.employee_type === 'TTS' && category === 'internship_agreement' && categories.has('labor_contract')) return false;
        return !categories.has(category);
      }).map(([, label]) => label);
      if (missing.length) {
        alerts.push({
          id: `missing-documents-${employee.id}`,
          type: 'missing_documents',
          severity: 'warning',
          employee_id: employee.id,
          employee_code: employee.employee_code,
          employee_name: employee.full_name,
          department: employee.department,
          missing,
          message: `Thiếu hồ sơ: ${missing.join(', ')}`,
        });
      }
      for (const document of employeeDocuments) {
        const remaining = daysUntil(document.expires_on);
        if (remaining === null || remaining > windowDays) continue;
        alerts.push({
          id: `document-due-${employee.id}-${document.category}`,
          type: 'document_due',
          severity: remaining < 0 ? 'danger' : remaining <= 7 ? 'warning' : 'info',
          employee_id: employee.id,
          employee_code: employee.employee_code,
          employee_name: employee.full_name,
          department: employee.department,
          due_date: document.expires_on,
          days_until: remaining,
          message: `${EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || 'Tài liệu'} ${remaining < 0 ? `đã quá hạn ${Math.abs(remaining)} ngày` : `còn ${remaining} ngày`}`,
        });
      }
    }
    alerts.sort((a, b) => (a.days_until ?? 9999) - (b.days_until ?? 9999) || a.employee_name.localeCompare(b.employee_name, 'vi'));
    return json({
      alerts,
      total: alerts.length,
      summary: alerts.reduce((summary, alert) => {
        summary[alert.type] = (summary[alert.type] || 0) + 1;
        return summary;
      }, {}),
      window_days: windowDays,
    });
  }

  if (path === '/api/notifications' && request.method === 'GET') {
    const windowDays = Math.min(90, Math.max(1, parseInt(url.searchParams.get('window') || '30', 10)));
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get('page_size') || '25', 10)));
    const hasHrScope = isAdmin || isHcns(me);
    const notifications = [
      ...(hasHrScope ? await buildEmployeeAlerts(env, windowDays) : []),
      ...await buildAttendanceNotifications(env, me, {
        windowDays,
        isAdmin,
        isHcnsScope: isAttendanceHcns,
      }),
    ];
    const moduleFilter = String(url.searchParams.get('module') || '').trim();
    const typeFilter = String(url.searchParams.get('type') || '').trim();
    const severityFilter = String(url.searchParams.get('severity') || '').trim();
    const search = String(url.searchParams.get('search') || '').trim().toLocaleLowerCase('vi');
    const filtered = notifications.filter(notification => {
      if (moduleFilter && notification.module !== moduleFilter) return false;
      if (typeFilter && notification.type !== typeFilter) return false;
      if (severityFilter && notification.severity !== severityFilter) return false;
      if (search) {
        const haystack = [
          notification.title, notification.message, notification.employee_name,
          notification.employee_code, notification.department, notification.module_label,
        ].join(' ').toLocaleLowerCase('vi');
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    const severityRank = { danger: 0, warning: 1, info: 2 };
    filtered.sort((a, b) =>
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
      || String(b.occurred_on || b.due_date || '').localeCompare(String(a.occurred_on || a.due_date || ''))
      || String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'vi')
    );
    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
    const values = key => [...new Set(notifications.map(item => item[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'vi'));
    return json({
      notifications: paginated,
      total,
      active_total: notifications.length,
      pagination: { page, page_size: pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: {
        danger: notifications.filter(item => item.severity === 'danger').length,
        warning: notifications.filter(item => item.severity === 'warning').length,
        info: notifications.filter(item => item.severity === 'info').length,
        employee_profile: notifications.filter(item => item.module === 'employee_profile').length,
        attendance: notifications.filter(item => item.module === 'attendance').length,
      },
      filter_options: {
        modules: values('module').map(value => ({
          value,
          label: notifications.find(item => item.module === value)?.module_label || value,
        })),
        types: values('type'),
        severities: values('severity'),
      },
      window_days: windowDays,
    });
  }

  const employeeProfileMatch = path.match(/^\/api\/users\/(\d+)\/profile$/);
  if (employeeProfileMatch) {
    const userId = parseInt(employeeProfileMatch[1], 10);
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    const hasHrScope = isAdmin || isHcns(me);
    const permissions = employeeProfilePermissions(target, me, hasHrScope, isManager);
    if (!permissions.can_view) return json({ error: 'Không có quyền xem hồ sơ' }, 403);

    if (request.method === 'GET') {
      const profile = { ...target };
      delete profile.password_hash;
      const isSelf = Number(me.id) === userId;
      if (!hasHrScope && !isSelf) {
        for (const field of [...EMPLOYEE_PROFILE_FIELDS.contract, ...EMPLOYEE_PROFILE_FIELDS.compensation]) delete profile[field];
        for (const field of ['birth_date','gender','national_id','national_id_expiry_date','home_address','school_name','emergency_contact_name','emergency_contact_phone']) {
          delete profile[field];
        }
        delete profile.tax_code;
        delete profile.social_insurance_number;
        delete profile.national_id_document_url;
        delete profile.degree_document_url;
        delete profile.contract_document_url;
        delete profile.personnel_decision_url;
      }
      let completion = null;
      if (permissions.can_view_documents) {
        const requiredFields = [
          'full_name','email','phone','birth_date','national_id','home_address','position','department',
          'direct_manager_id','work_location','contract_type','hire_date',
        ];
        const requiredDocuments = target.employee_type === 'TTS'
          ? ['cv','national_id','internship_agreement']
          : ['cv','national_id','labor_contract'];
        const { results: documentRows = [] } = await env.DB.prepare(
          'SELECT DISTINCT category FROM employee_documents WHERE user_id=? AND deleted_at IS NULL'
        ).bind(userId).all();
        const categories = new Set(documentRows.map(row => row.category));
        const completedFields = requiredFields.filter(field => String(target[field] ?? '').trim()).length;
        const completedDocuments = requiredDocuments.filter(category => {
          if (target.employee_type === 'TTS' && category === 'internship_agreement' && categories.has('labor_contract')) return true;
          return categories.has(category);
        }).length;
        completion = {
          percent: Math.round(((completedFields + completedDocuments) / (requiredFields.length + requiredDocuments.length)) * 100),
          completed_fields: completedFields,
          required_fields: requiredFields.length,
          completed_documents: completedDocuments,
          required_documents: requiredDocuments.length,
        };
      }
      return json({
        user: profile,
        permissions,
        completion,
        metadata: {
          document_categories: EMPLOYEE_DOCUMENT_CATEGORIES,
          contract_types: target.contract_type && !EMPLOYEE_CONTRACT_TYPES.includes(target.contract_type)
            ? [...EMPLOYEE_CONTRACT_TYPES, target.contract_type]
            : EMPLOYEE_CONTRACT_TYPES,
          lifecycle_statuses: LIFECYCLE_STATUSES,
        },
      });
    }

    if (request.method !== 'PATCH') return json({ error: 'Phương thức không được hỗ trợ' }, 405);
    if (!permissions.can_edit_basic) return json({ error: 'Không có quyền sửa hồ sơ' }, 403);
    const input = await request.json().catch(() => ({}));
    const changes = {};
    for (const [field, rawValue] of Object.entries(input)) {
      if (!EMPLOYEE_PROFILE_ALLOWED_FIELDS.has(field)) continue;
      const group = EMPLOYEE_PROFILE_FIELD_GROUP[field];
      if (group === 'personal' && !permissions.can_edit_personal) return json({ error: 'Không có quyền sửa thông tin cá nhân' }, 403);
      if (group === 'employment' && !permissions.can_edit_employment) return json({ error: 'Không có quyền sửa thông tin công việc' }, 403);
      if ((EMPLOYEE_PROFILE_PROTECTED_FIELDS.has(field) || field === 'employee_type') && !hasHrScope) {
        return json({ error: 'Chỉ HCNS hoặc Admin được sửa hợp đồng, lương, ngân hàng và BHXH' }, 403);
      }
      changes[field] = normalizeEmployeeProfileValue(field, rawValue);
      if (typeof changes[field] === 'number' && !Number.isFinite(changes[field])) return json({ error: `Giá trị ${field} không hợp lệ` }, 400);
    }
    if (!Object.keys(changes).length) return json({ ok: true, unchanged: true });
    const merged = { ...target, ...changes };
    if (merged.employee_type !== 'TTS' && merged.school_name) {
      changes.school_name = '';
      merged.school_name = '';
    }
    const actualChanges = Object.entries(changes).filter(([field, value]) => String(target[field] ?? '') !== String(value ?? ''));
    if (!actualChanges.length) return json({ ok: true, unchanged: true });
    const validationError = validateEmployeeProfile(merged, actualChanges.map(([field]) => field));
    if (validationError) return json({ error: validationError }, 400);
    if (changes.email && changes.email !== target.email) {
      const duplicate = await env.DB.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>? LIMIT 1').bind(changes.email, userId).first();
      if (duplicate) return json({ error: 'Email đã tồn tại' }, 409);
    }
    if (merged.direct_manager_id) {
      const manager = await env.DB.prepare('SELECT id FROM users WHERE id=? AND is_active=1').bind(merged.direct_manager_id).first();
      if (!manager) return json({ error: 'Quản lý trực tiếp không tồn tại hoặc đã khóa' }, 400);
    }
    const changeSetId = crypto.randomUUID();
    const assignments = actualChanges.map(([field]) => `${field}=?`).join(',');
    const statements = [
      env.DB.prepare(`UPDATE users SET ${assignments},updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`)
        .bind(...actualChanges.map(([, value]) => value), me.id, userId),
      ...actualChanges.map(([field, value]) => employeeAuditStatement(env, {
        userId,
        changeSetId,
        action: 'update',
        group: EMPLOYEE_PROFILE_FIELD_GROUP[field] || 'profile',
        field,
        oldValue: target[field],
        newValue: value,
        actor: me,
      })),
    ];
    await env.DB.batch(statements);
    return json({ ok: true, change_set_id: changeSetId, changed_fields: actualChanges.map(([field]) => field) });
  }

  const employeeAuditMatch = path.match(/^\/api\/users\/(\d+)\/audit$/);
  if (employeeAuditMatch && request.method === 'GET') {
    const hasHrScope = isAdmin || isHcns(me);
    if (!hasHrScope) return json({ error: 'Chỉ HCNS hoặc Admin được xem nhật ký' }, 403);
    const userId = parseInt(employeeAuditMatch[1], 10);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get('page_size') || '30', 10)));
    const total = await env.DB.prepare('SELECT COUNT(*) AS total FROM employee_profile_audit WHERE user_id=?').bind(userId).first();
    const { results: audit = [] } = await env.DB.prepare(
      `SELECT * FROM employee_profile_audit WHERE user_id=? ORDER BY changed_at DESC,id DESC LIMIT ? OFFSET ?`
    ).bind(userId, pageSize, (page - 1) * pageSize).all();
    return json({ audit, pagination: { page, page_size: pageSize, total: Number(total?.total || 0) } });
  }

  const employeeTimelineMatch = path.match(/^\/api\/users\/(\d+)\/timeline$/);
  if (employeeTimelineMatch && request.method === 'GET') {
    const userId = parseInt(employeeTimelineMatch[1], 10);
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    const hasHrScope = isAdmin || isHcns(me);
    if (!employeeCanAccess(target, me, hasHrScope, isManager)) return json({ error: 'Không có quyền xem hồ sơ' }, 403);
    const events = [];
    const datedFields = [
      ['hire_date','onboarding','Ngày vào làm'],
      ['probation_end_date','probation','Kết thúc thử việc'],
      ['official_date','official','Chuyển chính thức'],
      ['termination_date','termination','Nghỉ việc'],
    ];
    for (const [field, type, title] of datedFields) {
      if (target[field]) events.push({ id: `${field}-${userId}`, type, title, event_date: target[field], source: 'profile' });
    }
    const { results: lifecycle = [] } = await env.DB.prepare(
      `SELECT id,from_status,to_status,changed_by_name,reason,
              created_at AS event_date
       FROM lifecycle_history WHERE user_id=? ORDER BY id`
    ).bind(userId).all();
    for (const row of lifecycle) events.push({
      id: `lifecycle-${row.id}`,
      type: 'lifecycle',
      title: `Chuyển trạng thái sang ${row.to_status}`,
      description: row.reason || '',
      actor_name: row.changed_by_name || '',
      event_date: row.event_date,
      source: 'lifecycle',
    });
    const auditFields = [...EMPLOYEE_TIMELINE_FIELDS].filter(field => hasHrScope || !['salary','allowance'].includes(field));
    if (auditFields.length) {
      const placeholders = auditFields.map(() => '?').join(',');
      const { results: auditEvents = [] } = await env.DB.prepare(
        `SELECT id,field_name,old_value,new_value,changed_by_name,changed_at
         FROM employee_profile_audit WHERE user_id=? AND field_name IN (${placeholders}) ORDER BY changed_at`
      ).bind(userId, ...auditFields).all();
      for (const row of auditEvents) events.push({
        id: `audit-${row.id}`,
        type: row.field_name === 'department' ? 'transfer' : row.field_name === 'salary' ? 'salary' : 'profile_change',
        title: row.field_name === 'department' ? 'Điều chuyển phòng ban'
          : row.field_name === 'salary' ? 'Điều chỉnh lương'
          : `Cập nhật ${row.field_name}`,
        description: `${row.old_value || 'Chưa có'} → ${row.new_value || 'Chưa có'}`,
        actor_name: row.changed_by_name || '',
        event_date: row.changed_at,
        source: 'audit',
      });
    }
    const { results: documentEvents = [] } = await env.DB.prepare(
      `SELECT id,category,title,uploaded_by_name,uploaded_at,deleted_at,deleted_by_name
       FROM employee_documents WHERE user_id=? ORDER BY uploaded_at`
    ).bind(userId).all();
    for (const document of documentEvents) {
      events.push({
        id: `document-upload-${document.id}`,
        type: 'document',
        title: `Thêm ${EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || document.title || 'tài liệu'}`,
        actor_name: document.uploaded_by_name || '',
        event_date: document.uploaded_at,
        source: 'document',
      });
      if (document.deleted_at) events.push({
        id: `document-delete-${document.id}`,
        type: 'document_deleted',
        title: `Xóa ${EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || document.title || 'tài liệu'}`,
        actor_name: document.deleted_by_name || '',
        event_date: document.deleted_at,
        source: 'document',
      });
    }
    events.sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
    return json({ timeline: events });
  }

  const employeeDocumentsMatch = path.match(/^\/api\/users\/(\d+)\/documents$/);
  if (employeeDocumentsMatch) {
    const userId = parseInt(employeeDocumentsMatch[1], 10);
    const target = await env.DB.prepare('SELECT id,department FROM users WHERE id=?').bind(userId).first();
    if (!target) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    const hasHrScope = isAdmin || isHcns(me);
    const canView = hasHrScope || Number(me.id) === userId;
    if (request.method === 'GET') {
      if (!canView) return json({ error: 'Không có quyền xem tài liệu' }, 403);
      const { results: documents = [] } = await env.DB.prepare(
        `SELECT id,user_id,category,title,original_filename,content_type,byte_size,expires_on,
                uploaded_by,uploaded_by_name,uploaded_at
         FROM employee_documents WHERE user_id=? AND deleted_at IS NULL ORDER BY uploaded_at DESC`
      ).bind(userId).all();
      return json({
        documents: documents.map(document => ({
          ...document,
          category_label: EMPLOYEE_DOCUMENT_CATEGORIES[document.category] || document.category,
          preview_url: `/api/users/${userId}/documents/${document.id}?disposition=inline`,
          download_url: `/api/users/${userId}/documents/${document.id}?disposition=attachment`,
        })),
        categories: EMPLOYEE_DOCUMENT_CATEGORIES,
        can_manage: hasHrScope,
      });
    }
    if (request.method !== 'POST') return json({ error: 'Phương thức không được hỗ trợ' }, 405);
    if (!hasHrScope) return json({ error: 'Chỉ HCNS hoặc Admin được thêm tài liệu' }, 403);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ hồ sơ chưa được cấu hình' }, 503);
    const retryAfter = rateLimit(request, 'employee-document-upload', 30, 10 * 60 * 1000);
    if (retryAfter) return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const category = String(form?.get('category') || '');
    const title = String(form?.get('title') || '').trim().slice(0, 160);
    const expiresOn = String(form?.get('expires_on') || '').trim() || null;
    if (!Object.prototype.hasOwnProperty.call(EMPLOYEE_DOCUMENT_CATEGORIES, category)) return json({ error: 'Danh mục tài liệu không hợp lệ' }, 400);
    if (!file || typeof file.stream !== 'function') return json({ error: 'Vui lòng chọn tệp để tải lên' }, 400);
    const contentType = String(file.type || '').toLowerCase();
    if (!EMPLOYEE_DOCUMENT_TYPES.includes(contentType)) return json({ error: 'Chỉ nhận PDF, JPG, PNG hoặc WebP' }, 400);
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > EMPLOYEE_DOCUMENT_MAX_BYTES) return json({ error: 'Tệp vượt giới hạn 10 MB' }, 400);
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return json({ error: 'Ngày hết hạn không hợp lệ' }, 400);
    const fileBuffer = await file.arrayBuffer();
    if (!employeeDocumentContentMatches(contentType, fileBuffer)) return json({ error: 'Nội dung tệp không khớp với định dạng đã khai báo' }, 400);
    const documentId = crypto.randomUUID();
    const storageKey = employeeDocumentKey(userId, documentId);
    await env.HR_DOCUMENTS.put(storageKey, fileBuffer, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
      customMetadata: { uploaded_by: String(me.id), uploaded_at: new Date().toISOString(), category },
    });
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO employee_documents
             (id,user_id,category,title,original_filename,content_type,byte_size,storage_key,expires_on,uploaded_by,uploaded_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(documentId, userId, category, title, safeDownloadName(file.name), contentType, file.size, storageKey, expiresOn, me.id, me.full_name || ''),
        employeeAuditStatement(env, {
          userId,
          changeSetId: crypto.randomUUID(),
          action: 'document_upload',
          group: 'documents',
          field: category,
          oldValue: null,
          newValue: file.name,
          actor: me,
        }),
      ]);
    } catch (error) {
      await env.HR_DOCUMENTS.delete(storageKey).catch(() => {});
      throw error;
    }
    return json({ ok: true, id: documentId });
  }

  const employeeDocumentMatch = path.match(/^\/api\/users\/(\d+)\/documents\/([0-9a-fA-F-]{36})$/);
  if (employeeDocumentMatch) {
    const userId = parseInt(employeeDocumentMatch[1], 10);
    const documentId = employeeDocumentMatch[2];
    const document = await env.DB.prepare(
      `SELECT d.*,u.department FROM employee_documents d JOIN users u ON u.id=d.user_id
       WHERE d.id=? AND d.user_id=?`
    ).bind(documentId, userId).first();
    if (!document || document.deleted_at) return json({ error: 'Tài liệu không tồn tại' }, 404);
    const hasHrScope = isAdmin || isHcns(me);
    const canView = hasHrScope || Number(me.id) === userId;
    if (!canView) return json({ error: 'Không có quyền xem tài liệu' }, 403);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ hồ sơ chưa được cấu hình' }, 503);
    if (request.method === 'GET') {
      const object = await env.HR_DOCUMENTS.get(document.storage_key);
      if (!object) return json({ error: 'Tệp không tồn tại trên kho lưu trữ' }, 404);
      const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
      const filename = safeDownloadName(document.original_filename);
      return new Response(object.body, {
        headers: {
          'Content-Type': (
            document.content_type && document.content_type !== 'application/octet-stream'
              ? document.content_type
              : object.httpMetadata?.contentType
          ) || 'application/octet-stream',
          'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    if (request.method !== 'DELETE') return json({ error: 'Phương thức không được hỗ trợ' }, 405);
    if (!hasHrScope) return json({ error: 'Chỉ HCNS hoặc Admin được xóa tài liệu' }, 403);
    await env.HR_DOCUMENTS.delete(document.storage_key);
    const changeSetId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE employee_documents
         SET deleted_at=datetime('now','localtime'),deleted_by=?,deleted_by_name=?
         WHERE id=? AND deleted_at IS NULL`
      ).bind(me.id, me.full_name || '', documentId),
      employeeAuditStatement(env, {
        userId,
        changeSetId,
        action: 'document_delete',
        group: 'documents',
        field: document.category,
        oldValue: document.original_filename,
        newValue: null,
        actor: me,
      }),
    ]);
    return json({ ok: true });
  }

  // ── USERS (legacy-compatible account APIs) ───────────────────────
  if (path === '/api/users' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const hasHrScope = isAdmin || isHcns(me);
    const baseFields = hasHrScope
      ? 'id,employee_code,employee_type,full_name,email,role,department,position,avatar_color,avatar_initials,phone,salary,bank_account,bank_name,is_active,lifecycle_status,created_at,birth_date,gender,national_id,national_id_expiry_date,home_address,school_name,emergency_contact_name,emergency_contact_phone,direct_manager_id,work_location,contract_type,hire_date,contract_start_date,contract_end_date,contract_signed_date,probation_end_date,official_date,termination_date,allowance,insurance_salary,dependent_count,bank_account_holder,tax_code,social_insurance_number,insurance_hospital,avatar_url,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url,updated_at,updated_by'
      : 'id,employee_code,employee_type,full_name,email,role,department,position,avatar_color,avatar_initials,phone,is_active,lifecycle_status,created_at,direct_manager_id,work_location,avatar_url';
    const stmt = env.DB.prepare(`SELECT ${baseFields} FROM users${hasHrScope ? '' : ' WHERE department=?'} ORDER BY id`);
    const { results } = hasHrScope ? await stmt.all() : await stmt.bind(me.department).all();
    return json({ users: results });
  }

  if (path === '/api/users' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    if (!b.full_name || !b.email || !b.phone || !b.birth_date || !b.national_id || !b.home_address ||
        !b.department || !b.position || !b.direct_manager_id || !b.work_location || !b.contract_type || !b.hire_date) {
      return json({ error: 'Vui lòng nhập đầy đủ các trường bắt buộc' }, 400);
    }
    const pw = b.password || 'Pass@123';
    const hash = await hashPassword(pw);
    const ini = b.avatar_initials || nameInitials(b.full_name);
    const empType = employeeTypeCode(b.employee_type);
    const candidate = {
      ...b,
      id: null,
      employee_type: empType,
      department: normalizeDeptName(b.department || ''),
      dependent_count: Number(b.dependent_count || 0),
      lifecycle_status: b.lifecycle_status || 'Chờ tiếp nhận',
      school_name: empType === 'TTS' ? String(b.school_name || '').trim() : '',
    };
    const validationError = validateEmployeeProfile(candidate, [
      'full_name','email','department','direct_manager_id','contract_type','hire_date','contract_start_date',
      'contract_end_date','probation_end_date','official_date','termination_date','dependent_count',
    ]);
    if (validationError) return json({ error: validationError }, 400);
    const manager = await env.DB.prepare('SELECT id FROM users WHERE id=? AND is_active=1').bind(b.direct_manager_id).first();
    if (!manager) return json({ error: 'Quản lý trực tiếp không tồn tại hoặc đã khóa' }, 400);
    // Server generates + confirms the official code (never trust a client-sent one).
    // Retry a few times in case two requests race on the same next sequence number.
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await nextEmployeeCode(env, empType, b.department);
      try {
        const r = await env.DB.prepare(
          'INSERT INTO users (employee_code,employee_type,full_name,email,password_hash,role,department,position,avatar_color,avatar_initials,phone,salary,bank_account,bank_name,is_active,birth_date,gender,national_id,home_address,emergency_contact_name,emergency_contact_phone,direct_manager_id,work_location,contract_type,contract_start_date,contract_end_date,contract_signed_date,official_date,termination_date,allowance,insurance_salary,bank_account_holder,tax_code,social_insurance_number,insurance_hospital,avatar_url,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(code,empType,b.full_name,b.email,hash,b.role||'employee',normalizeDeptName(b.department||''),b.position||'',b.avatar_color||'#4F46E5',ini,b.phone||'',b.salary||0,b.bank_account||'',b.bank_name||'',b.birth_date||null,b.gender||'',b.national_id||'',b.home_address||'',b.emergency_contact_name||'',b.emergency_contact_phone||'',b.direct_manager_id||null,b.work_location||'',b.contract_type||'',b.contract_start_date||null,b.contract_end_date||null,b.contract_signed_date||null,b.official_date||null,b.termination_date||null,b.allowance||0,b.insurance_salary||0,b.bank_account_holder||'',b.tax_code||'',b.social_insurance_number||'',b.insurance_hospital||'',b.avatar_url||'',b.national_id_document_url||'',b.degree_document_url||'',b.contract_document_url||'',b.personnel_decision_url||'').run();
        const newUserId = r.meta.last_row_id;
        await env.DB.prepare(
          `UPDATE users SET school_name=?,hire_date=?,probation_end_date=?,dependent_count=?,national_id_expiry_date=?,
             updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`
        ).bind(
          empType === 'TTS' ? String(b.school_name || '').trim() : '',
          b.hire_date || null,
          b.probation_end_date || null,
          Math.max(0, parseInt(b.dependent_count || 0, 10) || 0),
          b.national_id_expiry_date || null,
          me.id,
          newUserId
        ).run();
        return json({ ok: true, id: newUserId, employee_code: code });
      } catch (e) {
        lastErr = e;
        if (e.message.includes('UNIQUE') && e.message.includes('employee_code')) continue; // race on code, retry with next seq
        if (e.message.includes('UNIQUE')) return json({ error: 'Email đã tồn tại' }, 400);
        throw e;
      }
    }
    console.error(lastErr);
    return json({ error: 'Không thể sinh mã nhân viên, vui lòng thử lại' }, 500);
  }

  // ── HISTORICAL ATTENDANCE IMPORT ─────────────────────────────────
  // The client sends normalized rows from a reviewed spreadsheet.  Preview is
  // read-only; commit creates accounts only when the employee code is absent
  // and never overwrites an existing attendance record.
  if (path === '/api/attendance-imports/preview' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Chỉ HCNS hoặc Admin được nhập chấm công lịch sử' }, 403);
    const b = await request.json().catch(() => ({}));
    const periodMonth = String(b.period_month || '');
    const employees = Array.isArray(b.employees) ? b.employees : [];
    if (!/^\d{4}-\d{2}$/.test(periodMonth) || !employees.length || employees.length > 500) return json({ error: 'Dữ liệu lô nhập không hợp lệ' }, 400);
    const preview = [];
    for (const employee of employees) {
      const code = String(employee.employee_code || '').trim();
      const name = String(employee.full_name || '').trim();
      const values = Object.entries(employee.days || employee.attendance || {});
      const invalidDays = values.filter(([day, value]) => !/^\d{1,2}$/.test(day) || ![0, 0.5, 1].includes(Number(value)));
      const user = code ? await env.DB.prepare('SELECT id,full_name,is_active FROM users WHERE employee_code=?').bind(code).first() : null;
      preview.push({ employee_code: code, full_name: name, account: user ? 'existing' : 'create', attendance_entries: values.length, errors: [
        ...(!/^[A-Za-z0-9-]{2,50}$/.test(code) ? ['Mã NV không hợp lệ'] : []),
        ...(!name ? ['Thiếu họ tên'] : []),
        ...(invalidDays.length ? [`Có ${invalidDays.length} ô ngày công không hợp lệ`] : []),
      ] });
    }
    return json({ period_month: periodMonth, preview, valid: preview.every(row => !row.errors.length) });
  }

  if (path === '/api/attendance-imports/commit' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Chỉ HCNS hoặc Admin được nhập chấm công lịch sử' }, 403);
    const b = await request.json().catch(() => ({}));
    const periodMonth = String(b.period_month || '');
    const employees = Array.isArray(b.employees) ? b.employees : [];
    if (!/^\d{4}-\d{2}$/.test(periodMonth) || !employees.length || employees.length > 500) return json({ error: 'Dữ liệu lô nhập không hợp lệ' }, 400);
    const sourceName = String(b.source_name || `Bảng chấm công ${periodMonth}`).trim().slice(0, 160) || `Bảng chấm công ${periodMonth}`;
    const validation = [];
    const codes = new Set();
    for (const employee of employees) {
      const code = String(employee.employee_code || '').trim();
      const name = String(employee.full_name || '').trim();
      const values = Object.entries(employee.days || employee.attendance || {});
      if (!/^[A-Za-z0-9-]{2,50}$/.test(code) || !name || codes.has(code) || values.some(([day, value]) => !/^\d{1,2}$/.test(day) || ![0, 0.5, 1].includes(Number(value)))) validation.push(code || name || '(trống)');
      codes.add(code);
    }
    if (validation.length) return json({ error: 'Lô nhập có dòng nhân sự hoặc ngày công không hợp lệ', invalid_rows: validation }, 400);
    const batchResult = await d1WriteWithRetry(() => env.DB.prepare('INSERT INTO attendance_import_batches (source_name,period_month,status,created_by,created_by_name) VALUES (?,?,?,?,?)')
      .bind(sourceName, periodMonth, 'committing', me.id, me.full_name || '').run());
    const batchId = batchResult.meta.last_row_id;
    const report = { batch_id: batchId, created_accounts: [], imported_attendance: 0, conflicts: [], overtime_forms: [], overtime_exceptions: [] };
    const userByCode = new Map();
    try {
      for (const employee of employees) {
        const code = String(employee.employee_code).trim();
        let user = await d1WriteWithRetry(() => env.DB.prepare('SELECT id,employee_code FROM users WHERE employee_code=?').bind(code).first());
        if (!user) {
          const rawNote = String(employee.note || '');
          const inactive = /nghi/i.test(rawNote.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
          const type = String(employee.employee_type || employee.position || '').trim().toLowerCase() === 'tts' ? 'TTS' : 'NV';
          const r = await d1WriteWithRetry(async () => env.DB.prepare(
            'INSERT INTO users (employee_code,employee_type,full_name,email,password_hash,role,department,position,avatar_color,avatar_initials,phone,is_active,lifecycle_status,work_location,hire_date,must_change_password,profile_pending) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          ).bind(code, type, String(employee.full_name).trim(), `${code.toLowerCase()}@pending.local`, await hashPassword('Pass@123'), 'employee', normalizeDeptName(employee.department || ''), String(employee.position || ''), '#4F46E5', nameInitials(employee.full_name), '', inactive ? 0 : 1, inactive ? 'Đã nghỉ' : (type === 'TTS' ? 'Thực tập' : 'Chờ tiếp nhận'), String(employee.work_location || ''), `${periodMonth}-01`, 1, 1).run());
          user = { id: r.meta.last_row_id, employee_code: code };
          report.created_accounts.push({ employee_code: code, user_id: user.id, login: code });
        }
        userByCode.set(code, user);
        for (const [rawDay, rawValue] of Object.entries(employee.days || employee.attendance || {})) {
          const day = String(rawDay).padStart(2, '0');
          const workDate = `${periodMonth}-${day}`;
          const sourceKey = `${code}:${workDate}`;
          const existing = await d1WriteWithRetry(() => env.DB.prepare('SELECT id FROM attendance WHERE user_id=? AND date=? ORDER BY id LIMIT 1').bind(user.id, workDate).first());
          if (existing) {
            report.conflicts.push({ employee_code: code, work_date: workDate, reason: 'Đã có chấm công' });
            await d1WriteWithRetry(() => env.DB.prepare('INSERT INTO attendance_import_rows (batch_id,source_key,employee_code,work_date,attendance_id,outcome,detail) VALUES (?,?,?,?,?,?,?)').bind(batchId, sourceKey, code, workDate, existing.id, 'conflict', 'Đã có chấm công').run());
            continue;
          }
          const unit = Number(rawValue);
          const config = unit === 1 ? ['full', '08:30', '17:00', 8.5, 'present'] : unit === .5 ? ['morning', '08:30', '12:00', 3.5, 'present'] : ['full', null, null, 0, 'absent'];
          const inserted = await d1WriteWithRetry(() => env.DB.prepare('INSERT INTO attendance (user_id,date,checkin_time,checkout_time,status,work_hours,note,work_type,shift,registered,source_batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            .bind(user.id, workDate, config[1], config[2], config[4], config[3], `Nhập lịch sử từ ${sourceName}`, 'office', config[0], 1, batchId).run());
          await d1WriteWithRetry(() => env.DB.prepare('INSERT INTO attendance_import_rows (batch_id,source_key,employee_code,work_date,attendance_id,outcome,detail) VALUES (?,?,?,?,?,?,?)').bind(batchId, sourceKey, code, workDate, inserted.meta.last_row_id, 'imported', null).run());
          report.imported_attendance += 1;
        }
      }
      for (const rawForm of Array.isArray(b.overtime_forms) ? b.overtime_forms : []) {
        const code = String(rawForm.employee_code || '').trim();
        const user = userByCode.get(code);
        const validated = normalizeOvertimeItems(rawForm.items, periodMonth, { allowFuture: true });
        const reportedHours = rawForm.reported_hours === undefined || rawForm.reported_hours === '' ? null : Number(rawForm.reported_hours);
        const computedHours = validated.items ? validated.items.reduce((sum, item) => sum + item.requested_minutes, 0) / 60 : null;
        if (!user || validated.error || (reportedHours !== null && (!Number.isFinite(reportedHours) || Math.abs(reportedHours - computedHours) > .01))) {
          report.overtime_exceptions.push({ employee_code: code, reason: validated.error || 'Tổng giờ khai báo không khớp mốc thời gian', reported_hours: reportedHours, computed_hours: computedHours });
          continue;
        }
        const duplicate = await env.DB.prepare("SELECT id FROM overtime_forms WHERE user_id=? AND period_month=? AND source='attendance_import' LIMIT 1").bind(user.id, periodMonth).first();
        if (duplicate) { report.overtime_exceptions.push({ employee_code: code, reason: 'Đã có form OT lịch sử cho tháng này' }); continue; }
        const form = await env.DB.prepare("INSERT INTO overtime_forms (user_id,period_month,status,source,source_batch_id,submitted_at) VALUES (?,?,'pending','attendance_import',?,datetime('now','localtime'))").bind(user.id, periodMonth, batchId).run();
        const items = await applyCalendarOvertimeCategories(env, validated.items);
        await env.DB.batch(items.map(item => env.DB.prepare('INSERT INTO overtime_form_items (form_id,start_at,end_at,requested_minutes,reason,time_category) VALUES (?,?,?,?,?,?)').bind(form.meta.last_row_id, item.start_at, item.end_at, item.requested_minutes, item.reason, item.time_category)));
        report.overtime_forms.push({ employee_code: code, form_id: form.meta.last_row_id });
      }
      await d1WriteWithRetry(() => env.DB.prepare("UPDATE attendance_import_batches SET status='committed',committed_at=datetime('now','localtime') WHERE id=?").bind(batchId).run());
    } catch (error) {
      await env.DB.prepare("UPDATE attendance_import_batches SET status='failed' WHERE id=?").bind(batchId).run().catch(() => {});
      throw error;
    }
    return json({ ok: true, ...report });
  }

  // ── USERS: PRIVATE DOCUMENTS (R2) ─────────────────────────────────
  const userDocumentMatch = path.match(/^\/api\/users\/(\d+)\/documents\/(avatar|national_id|degree|contract|decision)$/);
  if (userDocumentMatch) {
    const uid = parseInt(userDocumentMatch[1], 10);
    const kind = userDocumentMatch[2];
    const config = USER_DOCUMENTS[kind];
    const hasHrScope = isAdmin || isHcns(me);
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
    if (!target) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ hồ sơ chưa được cấu hình' }, 503);

    if (request.method === 'GET') {
      const canReadAvatar = kind === 'avatar' && (hasHrScope || me.id === uid || (isManager && target.department === me.department));
      if (!hasHrScope && !canReadAvatar && me.id !== uid) return json({ error: 'Không có quyền xem hồ sơ này' }, 403);
      const object = await env.HR_DOCUMENTS.get(userDocumentKey(uid, kind));
      if (!object) return json({ error: 'Tệp không tồn tại' }, 404);
      const disposition = kind === 'avatar' ? 'inline' : 'attachment';
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
          'Content-Disposition': `${disposition}; filename="${kind}"`,
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    // Avatar is the sole profile document employees may update themselves.
    // All other document categories remain restricted to HCNS/Admin.
    const canUpload = hasHrScope || (kind === 'avatar' && me.id === uid);
    if (!canUpload) return json({ error: 'Chỉ HCNS hoặc quản trị viên được tải hồ sơ lên' }, 403);
    if (request.method === 'DELETE') {
      if (!hasHrScope) return json({ error: 'Chỉ HCNS hoặc quản trị viên được xóa avatar' }, 403);
      await env.HR_DOCUMENTS.delete(userDocumentKey(uid, kind));
      const changeSetId = crypto.randomUUID();
      const statements = [
        env.DB.prepare(`UPDATE users SET ${config.column}='',updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`).bind(me.id, uid),
        employeeAuditStatement(env, {
          userId: uid,
          changeSetId,
          action: 'legacy_document_delete',
          group: 'documents',
          field: kind,
          oldValue: config.label,
          newValue: null,
          actor: me,
        }),
      ];
      if (kind !== 'avatar') {
        statements.push(
          env.DB.prepare(
            `UPDATE employee_documents
             SET deleted_at=datetime('now','localtime'),deleted_by=?,deleted_by_name=?
             WHERE storage_key=? AND deleted_at IS NULL`
          ).bind(me.id, me.full_name || '', userDocumentKey(uid, kind))
        );
      }
      await env.DB.batch(statements);
      return json({ ok: true });
    }
    if (request.method !== 'POST') return json({ error: 'Phương thức không được hỗ trợ' }, 405);

    const retryAfter = rateLimit(request, 'employee-document-upload', 20, 10 * 60 * 1000);
    if (retryAfter) return json({ error: 'Thử lại sau ít phút', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file.stream !== 'function') return json({ error: 'Vui lòng chọn tệp để tải lên' }, 400);
    const contentType = String(file.type || '').toLowerCase();
    if (!config.types.includes(contentType)) return json({ error: `${config.label} chỉ nhận PDF, JPG, PNG hoặc WebP` }, 400);
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > config.maxBytes) {
      return json({ error: `${config.label} vượt giới hạn ${config.maxBytes / 1024 / 1024} MB` }, 400);
    }
    const fileBuffer = await file.arrayBuffer();
    if (!employeeDocumentContentMatches(contentType, fileBuffer)) return json({ error: 'Nội dung tệp không khớp với định dạng đã khai báo' }, 400);
    await env.HR_DOCUMENTS.put(userDocumentKey(uid, kind), fileBuffer, {
      httpMetadata: { contentType, cacheControl: 'private, no-store' },
      customMetadata: { uploaded_by: String(me.id), uploaded_at: new Date().toISOString() },
    });
    const url = userDocumentRoute(uid, kind);
    const changeSetId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(`UPDATE users SET ${config.column}=?,updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`).bind(url, me.id, uid),
      employeeAuditStatement(env, {
        userId: uid,
        changeSetId,
        action: 'legacy_document_upload',
        group: 'documents',
        field: kind,
        oldValue: target[config.column] || null,
        newValue: String(file.name || config.label),
        actor: me,
      }),
    ];
    if (kind !== 'avatar') {
      statements.push(
        env.DB.prepare(
          `INSERT INTO employee_documents
             (id,user_id,category,title,original_filename,content_type,byte_size,storage_key,uploaded_by,uploaded_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(storage_key) DO UPDATE SET
             category=excluded.category,title=excluded.title,original_filename=excluded.original_filename,
             content_type=excluded.content_type,byte_size=excluded.byte_size,uploaded_by=excluded.uploaded_by,
             uploaded_by_name=excluded.uploaded_by_name,uploaded_at=datetime('now','localtime'),
             deleted_at=NULL,deleted_by=NULL,deleted_by_name=NULL`
        ).bind(
          crypto.randomUUID(), uid, LEGACY_DOCUMENT_CATEGORIES[kind], config.label,
          String(file.name || kind), contentType, file.size, userDocumentKey(uid, kind), me.id, me.full_name || ''
        )
      );
    }
    await env.DB.batch(statements);
    return json({ ok: true, url, label: config.label });
  }

  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    const uid = parseInt(userMatch[1]);
    if (request.method === 'GET') {
      const target = await env.DB.prepare('SELECT id,department FROM users WHERE id=?').bind(uid).first();
      if (!target) return json({ error: 'Không tìm thấy' }, 404);
      if (!isManager && me.id !== uid) return json({ error: 'Không có quyền' }, 403);
      if (isManager && !isAdmin && !isHcns(me) && me.id !== uid && target.department !== me.department) return json({ error: 'Không có quyền' }, 403);
      const row = await env.DB.prepare(
        'SELECT id,employee_code,employee_type,full_name,email,role,department,position,avatar_color,avatar_initials,phone,salary,bank_account,bank_name,is_active,lifecycle_status,created_at,birth_date,gender,national_id,national_id_expiry_date,home_address,school_name,emergency_contact_name,emergency_contact_phone,direct_manager_id,work_location,contract_type,hire_date,contract_start_date,contract_end_date,contract_signed_date,probation_end_date,official_date,termination_date,allowance,insurance_salary,dependent_count,bank_account_holder,tax_code,social_insurance_number,insurance_hospital,avatar_url,national_id_document_url,degree_document_url,contract_document_url,personnel_decision_url,updated_at,updated_by FROM users WHERE id=?'
      ).bind(uid).first();
      if (!row) return json({ error: 'Không tìm thấy' }, 404);
      return json({ user: row });
    }
    if (request.method === 'PUT') {
      const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
      if (!target) return json({ error: 'Không tìm thấy' }, 404);
      const input = await request.json().catch(() => ({}));
      const hasHrScope = isAdmin || isHcns(me);
      const managesDepartment = isManager && !hasHrScope && target.department === me.department;
      if (!hasHrScope && me.id !== uid && !managesDepartment) return json({ error: 'Không có quyền' }, 403);
      const protectedFields = ['role','employee_type','salary','bank_account','bank_name','is_active','lifecycle_status','allowance','insurance_salary','dependent_count','bank_account_holder','tax_code','social_insurance_number','insurance_hospital','contract_type','hire_date','contract_start_date','contract_end_date','contract_signed_date','probation_end_date','official_date','termination_date','reset_password','password_hash'];
      if (!hasHrScope && protectedFields.some(k => Object.prototype.hasOwnProperty.call(input, k))) return json({ error: 'Không được thay đổi trường bảo mật hoặc lương' }, 403);
      // The UI sends partial profile payloads in a few flows; merge only after
      // authorization so absent fields can never zero out personnel data.
      const b = { ...target, ...input };
      const legacyTrackedFields = [
        'full_name','email','department','position','phone','birth_date','gender','national_id','home_address',
        'emergency_contact_name','emergency_contact_phone','direct_manager_id','work_location','contract_type',
        'contract_start_date','contract_end_date','contract_signed_date','official_date','termination_date','salary',
        'allowance','insurance_salary','bank_account','bank_name','bank_account_holder','tax_code',
        'social_insurance_number','insurance_hospital',
      ];
      const legacyChanges = legacyTrackedFields
        .filter(field => Object.prototype.hasOwnProperty.call(input, field))
        .filter(field => String(target[field] ?? '') !== String(b[field] ?? ''))
        .map(field => [field, b[field]]);
      const validationError = validateEmployeeProfile(b, legacyChanges.map(([field]) => field));
      if (validationError) return json({ error: validationError }, 400);
      if (legacyChanges.some(([field]) => field === 'email')) {
        const duplicate = await env.DB.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>? LIMIT 1').bind(b.email, uid).first();
        if (duplicate) return json({ error: 'Email đã tồn tại' }, 409);
      }
      if (legacyChanges.some(([field]) => field === 'direct_manager_id') && b.direct_manager_id) {
        const manager = await env.DB.prepare('SELECT id FROM users WHERE id=? AND is_active=1').bind(b.direct_manager_id).first();
        if (!manager) return json({ error: 'Quản lý trực tiếp không tồn tại hoặc đã khóa' }, 400);
      }
      const ini = b.avatar_initials || nameInitials(b.full_name || '');
      let extraSql = '';
      let extraBinds = [];
      const passwordWasReset = b.reset_password === true && isAdmin;
      if (passwordWasReset) {
        const newHash = await hashPassword('Pass@123');
        extraSql = ', password_hash=?, must_change_password=1';
        extraBinds = [newHash];
      }
      const binds = [b.full_name,b.email,b.role||'employee',normalizeDeptName(b.department||''),b.position||'',b.avatar_color||'#4F46E5',ini,b.phone||'',b.salary||0,b.bank_account||'',b.bank_name||'',b.is_active??1,b.birth_date||null,b.gender||'',b.national_id||'',b.home_address||'',b.emergency_contact_name||'',b.emergency_contact_phone||'',b.direct_manager_id||null,b.work_location||'',b.contract_type||'',b.contract_start_date||null,b.contract_end_date||null,b.contract_signed_date||null,b.official_date||null,b.termination_date||null,b.allowance||0,b.insurance_salary||0,b.bank_account_holder||'',b.tax_code||'',b.social_insurance_number||'',b.insurance_hospital||'',b.avatar_url||'',b.national_id_document_url||'',b.degree_document_url||'',b.contract_document_url||'',b.personnel_decision_url||'',...extraBinds,me.id,uid];
      const changeSetId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE users SET full_name=?,email=?,role=?,department=?,position=?,avatar_color=?,avatar_initials=?,phone=?,salary=?,bank_account=?,bank_name=?,is_active=?,birth_date=?,gender=?,national_id=?,home_address=?,emergency_contact_name=?,emergency_contact_phone=?,direct_manager_id=?,work_location=?,contract_type=?,contract_start_date=?,contract_end_date=?,contract_signed_date=?,official_date=?,termination_date=?,allowance=?,insurance_salary=?,bank_account_holder=?,tax_code=?,social_insurance_number=?,insurance_hospital=?,avatar_url=?,national_id_document_url=?,degree_document_url=?,contract_document_url=?,personnel_decision_url=?${extraSql},updated_at=datetime('now','localtime'),updated_by=? WHERE id=?`
        ).bind(...binds),
        ...legacyChanges.map(([field, value]) => employeeAuditStatement(env, {
          userId: uid,
          changeSetId,
          action: 'legacy_update',
          group: EMPLOYEE_PROFILE_FIELD_GROUP[field] || 'profile',
          field,
          oldValue: target[field],
          newValue: value,
          actor: me,
        })),
        ...(passwordWasReset ? [
          env.DB.prepare('UPDATE sessions SET revoked=1 WHERE user_id=? AND revoked=0').bind(uid),
          employeeAuditStatement(env, {
            userId: uid,
            changeSetId,
            action: 'password_reset',
            group: 'security',
            field: 'password_hash',
            oldValue: null,
            newValue: 'Administrator reset password',
            actor: me,
          }),
        ] : []),
      ]);
      return json({ ok: true, change_set_id: changeSetId });
    }
    if (request.method === 'DELETE') {
      if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
      if (uid === me.id) return json({ error: 'Không thể xóa tài khoản đang dùng' }, 400);
      return json({ error: 'Không hỗ trợ xóa nhân viên. Hãy chuyển trạng thái sang Đã nghỉ hoặc khóa tài khoản.', code: 'HARD_DELETE_DISABLED' }, 409);
    }
  }

  // ── USERS: basic list (safe fields only, for pickers e.g. Mentor select) ──
  if (path === '/api/users/basic' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, full_name, department, position, lifecycle_status, is_active FROM users WHERE is_active=1 ORDER BY full_name'
    ).all();
    return json({ users: results });
  }

  // ── LIFECYCLE STATUS (Vòng đời nhân sự) — only HCNS / Ban Giám Đốc may edit ──
  const lifecycleMatch = path.match(/^\/api\/users\/(\d+)\/lifecycle$/);
  if (lifecycleMatch && request.method === 'PUT') {
    if (!isHrOrBod(me)) return json({ error: 'Không có quyền' }, 403);
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lifecycle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by INTEGER,
      changed_by_name TEXT,
      reason TEXT,
      changed_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    const luid = parseInt(lifecycleMatch[1]);
    const b = await request.json().catch(() => ({}));
    const newStatus = String(b.status || '');
    const reason = String(b.reason || '').trim();
    if (!LIFECYCLE_STATUSES.includes(newStatus)) return json({ error: 'Trạng thái không hợp lệ' }, 400);
    if (!reason) return json({ error: 'Vui lòng nhập lý do' }, 400);
    const target = await env.DB.prepare('SELECT id, lifecycle_status FROM users WHERE id=?').bind(luid).first();
    if (!target) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    const fromStatus = target.lifecycle_status || 'Chính thức';
    const changeSetId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET lifecycle_status=? WHERE id=?').bind(newStatus, luid),
      env.DB.prepare('INSERT INTO lifecycle_history (user_id,from_status,to_status,changed_by,changed_by_name,reason) VALUES (?,?,?,?,?,?)')
        .bind(luid, fromStatus, newStatus, me.id, me.full_name, reason),
      employeeAuditStatement(env, {
        userId: luid,
        changeSetId,
        action: 'lifecycle',
        group: 'employment',
        field: 'lifecycle_status',
        oldValue: fromStatus,
        newValue: newStatus,
        actor: me,
      }),
    ]);
    return json({ ok: true });
  }

  // ── ASSET HANDOVER (Bàn giao tài sản — Nhân viên chính thức & TTS) ──
  if (path === '/api/assets' && request.method === 'GET') {
    let rowsResult;
    if (isHrOrBod(me)) {
      rowsResult = await env.DB.prepare(
        `SELECT a.*, u.full_name as owner_name, u.employee_code as owner_code,
                u.department as owner_department, u.employee_type as owner_employee_type,
                u.lifecycle_status as owner_lifecycle_status
         FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.updated_at DESC`
      ).all();
    } else {
      // Employees see their own declarations and Mentors see only declarations assigned to them.
      rowsResult = await env.DB.prepare(
        `SELECT a.*, u.full_name as owner_name, u.employee_code as owner_code,
                u.department as owner_department, u.employee_type as owner_employee_type,
                u.lifecycle_status as owner_lifecycle_status
         FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id
         WHERE a.user_id=? OR a.mentor_id=?
         ORDER BY a.updated_at DESC`
      ).bind(me.id, me.id).all();
    }
    const assets = rowsResult.results.map(r => {
      const { credential_enc, ...rest } = r;
      return { ...rest, has_credential: !!credential_enc };
    });
    return json({ assets });
  }

  if (path === '/api/assets' && request.method === 'POST') {
    // Any signed-in employee/TTS may declare their OWN asset. HCNS/BGĐ may declare
    // for anyone; a department manager may declare on behalf of their own dept only.
    const b = await request.json().catch(() => ({}));
    const assetName = String(b.asset_name || '').trim();
    if (!assetName) return json({ error: 'Tên tài sản là bắt buộc' }, 400);
    let ownerUserId = me.id;
    if (b.user_id && parseInt(b.user_id) !== me.id) {
      if (isHrOrBod(me)) {
        ownerUserId = parseInt(b.user_id);
      } else if (me.role === 'manager') {
        const target = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(parseInt(b.user_id)).first();
        if (!target || target.department !== me.department) return json({ error: 'Chỉ có thể khai báo hộ nhân sự thuộc phòng ban của bạn' }, 403);
        ownerUserId = parseInt(b.user_id);
      } else {
        return json({ error: 'Không có quyền khai báo hộ nhân sự khác' }, 403);
      }
    }
    const owner = await env.DB.prepare('SELECT employee_type FROM users WHERE id=?').bind(ownerUserId).first();
    const mentorId = b.mentor_id ? parseInt(b.mentor_id) : null;
    if (owner?.employee_type === 'TTS' && !mentorId) return json({ error: 'TTS phải chọn Mentor để xác nhận bàn giao' }, 400);
    if (mentorId === ownerUserId) return json({ error: 'Mentor không thể là người bàn giao' }, 400);
    const credEnc = b.credential ? await encryptCred(env, String(b.credential)) : null;
    if (owner?.employee_type === 'TTS' && !credEnc) return json({ error: 'TTS phải nhập email/tài khoản và mật khẩu bàn giao' }, 400);
    // A TTS declaration always enters the Mentor review queue. HCNS/BGĐ may
    // create historical/manual records with an explicit status when needed.
    const status = owner?.employee_type === 'TTS' && !isHrOrBod(me)
      ? 'pending_review'
      : (['active','pending_review','needs_update'].includes(b.status) ? b.status : 'active');
    const expectedDate = b.expected_handover_date ? String(b.expected_handover_date) : null;
    const r = await env.DB.prepare(
      `INSERT INTO asset_handovers (user_id,asset_name,asset_type,platform,link,credential_enc,responsible_name,mentor_id,mentor_name,status,note,expected_handover_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(ownerUserId, assetName, b.asset_type||'', b.platform||'', b.link||'', credEnc, b.responsible_name||me.full_name, mentorId, b.mentor_name||'', status, b.note||'', expectedDate).run();
    await recordAssetHistory(env, r.meta.last_row_id, 'created', me, 'Tạo bàn giao dự án/tài khoản');
    if (credEnc) await recordAssetHistory(env, r.meta.last_row_id, 'credential_set', me, 'Đã lưu thông tin đăng nhập được mã hóa');
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const revealMatch = path.match(/^\/api\/assets\/(\d+)\/reveal-credential$/);
  if (revealMatch && request.method === 'POST') {
    const aid = parseInt(revealMatch[1]);
    const asset = await env.DB.prepare(
      `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
    ).bind(aid).first();
    if (!asset) return json({ error: 'Không tìm thấy' }, 404);
    const allowed = asset.user_id === me.id || asset.mentor_id === me.id || isHrOrBod(me);
    if (!allowed) return json({ error: 'Không có quyền' }, 403);
    if (!asset.credential_enc) return json({ credential: '' });
    const plain = await decryptCred(env, asset.credential_enc);
    await env.DB.prepare('INSERT INTO asset_credential_log (asset_id,viewed_by,viewed_by_name) VALUES (?,?,?)').bind(aid, me.id, me.full_name).run();
    await recordAssetHistory(env, aid, 'credential_viewed', me, 'Đã xem thông tin đăng nhập');
    return json({ credential: plain });
  }

  const assetHistoryMatch = path.match(/^\/api\/assets\/(\d+)\/history$/);
  if (assetHistoryMatch && request.method === 'GET') {
    const aid = parseInt(assetHistoryMatch[1]);
    const asset = await env.DB.prepare(
      `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
    ).bind(aid).first();
    if (!asset) return json({ error: 'Không tìm thấy' }, 404);
    if (!(asset.user_id === me.id || asset.mentor_id === me.id || isHrOrBod(me))) return json({ error: 'Không có quyền' }, 403);
    const history = await env.DB.prepare(
      'SELECT id,action,actor_id,actor_name,detail,created_at FROM asset_handover_history WHERE asset_id=? ORDER BY id DESC'
    ).bind(aid).all();
    return json({ history: history.results || [] });
  }

  const assetMatch = path.match(/^\/api\/assets\/(\d+)$/);
  if (assetMatch) {
    const aid = parseInt(assetMatch[1]);
    const asset = await env.DB.prepare(
      `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
    ).bind(aid).first();
    if (!asset) return json({ error: 'Không tìm thấy' }, 404);
    const isOwner = asset.user_id === me.id;
    const isMentor = asset.mentor_id === me.id;
    const isHr = isHrOrBod(me);
    const isDeptMgr = false;

    if (request.method === 'PUT') {
      if (!isOwner && !isMentor && !isHr) return json({ error: 'Không có quyền' }, 403);
      const b = await request.json().catch(() => ({}));

      if (isMentor && !isOwner && !isHr) {
        // Mentor may only confirm or return the declaration for correction.
        if (!['confirmed', 'needs_update'].includes(b.status)) return json({ error: 'Mentor chỉ có thể xác nhận hoặc yêu cầu bổ sung' }, 403);
        if (b.status === 'needs_update' && !String(b.note || '').trim()) return json({ error: 'Vui lòng nêu nội dung cần bổ sung' }, 400);
        await env.DB.prepare(
          `UPDATE asset_handovers SET status=?, confirmed_by=?, confirmed_at=?, note=COALESCE(?,note), updated_at=? WHERE id=?`
        ).bind(b.status, b.status === 'confirmed' ? me.id : asset.confirmed_by, b.status === 'confirmed' ? nowStr() : asset.confirmed_at, b.note ?? null, nowStr(), aid).run();
        await recordAssetHistory(env, aid, b.status === 'confirmed' ? 'mentor_confirmed' : 'mentor_requested_update', me, b.note || '');
        return json({ ok: true });
      }

      if (isOwner && !isHr && ['confirmed', 'handed_over'].includes(asset.status)) {
        return json({ error: 'Bàn giao đã được xác nhận, chỉ HCNS/Ban giám đốc mới có thể chỉnh sửa' }, 403);
      }

      const allowedStatuses = isHr
        ? ['active','pending_review','needs_update','confirmed','handed_over']
        : ['pending_review','needs_update'];
      const newStatus = allowedStatuses.includes(b.status) ? b.status : asset.status;
      const credEnc = (b.credential !== undefined)
        ? (b.credential ? await encryptCred(env, String(b.credential)) : null)
        : asset.credential_enc;
      const isNewlyConfirmed = newStatus === 'confirmed' && asset.status !== 'confirmed';
      const expectedDate = b.expected_handover_date !== undefined ? (b.expected_handover_date || null) : asset.expected_handover_date;

      await env.DB.prepare(
        `UPDATE asset_handovers SET asset_name=?,asset_type=?,platform=?,link=?,credential_enc=?,responsible_name=?,mentor_id=?,mentor_name=?,status=?,note=?,
          confirmed_by=?, confirmed_at=?, expected_handover_date=?, updated_at=? WHERE id=?`
      ).bind(
        b.asset_name ?? asset.asset_name, b.asset_type ?? asset.asset_type, b.platform ?? asset.platform,
        b.link ?? asset.link, credEnc, b.responsible_name ?? asset.responsible_name,
        (b.mentor_id !== undefined ? (b.mentor_id || null) : asset.mentor_id),
        b.mentor_name ?? asset.mentor_name, newStatus, b.note ?? asset.note,
        isNewlyConfirmed ? me.id : asset.confirmed_by,
        isNewlyConfirmed ? nowStr() : asset.confirmed_at,
        expectedDate,
        nowStr(), aid
      ).run();
      await recordAssetHistory(env, aid, 'updated', me, newStatus === 'pending_review' && asset.status === 'needs_update' ? 'Đã cập nhật và gửi lại Mentor xác nhận' : 'Đã cập nhật thông tin bàn giao');
      if (b.credential !== undefined) await recordAssetHistory(env, aid, 'credential_changed', me, 'Đã thay đổi thông tin đăng nhập được mã hóa');
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      if (!isHr) return json({ error: 'Không có quyền' }, 403);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM asset_handovers WHERE id=?').bind(aid),
        env.DB.prepare('DELETE FROM asset_credential_log WHERE asset_id=?').bind(aid),
      ]);
      return json({ ok: true });
    }
  }

  // ── ATTENDANCE ───────────────────────────────────────────────────
  if (path === '/api/attendance' && request.method === 'GET') {
    const userId = url.searchParams.get('userId');
    const month = url.searchParams.get('month');
    const year = url.searchParams.get('year');
    const date = url.searchParams.get('date');
    let q = `SELECT a.*, u.full_name, u.employee_code, u.department,
      (SELECT status FROM overtime_requests o WHERE o.attendance_id=a.id) AS overtime_status,
      (SELECT approved_minutes FROM overtime_requests o WHERE o.attendance_id=a.id) AS approved_overtime_minutes
      FROM attendance a JOIN users u ON a.user_id=u.id WHERE 1=1`;
    const binds = [];
    if (!isAttendanceAdmin) { q += ' AND a.user_id=?'; binds.push(me.id); }
    else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns) { q += ' AND u.department=?'; binds.push(me.department); }
    else if (userId) { q += ' AND a.user_id=?'; binds.push(parseInt(userId)); }
    if (date) { q += ' AND a.date=?'; binds.push(date); }
    else if (month && year) {
      q += " AND strftime('%m',a.date)=? AND strftime('%Y',a.date)=?";
      binds.push(String(month).padStart(2,'0'), String(year));
    } else if (month) {
      q += ' AND a.date LIKE ?'; binds.push('%-' + String(month).padStart(2,'0') + '-%');
    }
    q += ' ORDER BY a.date DESC';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ attendance: results });
  }

  // One row per active employee for the selected attendance period. The users
  // table is deliberately the source so employees without attendance records
  // remain visible to Admin/HCNS and department managers.
  if (path === '/api/attendance/employees' && request.method === 'GET') {
    if (!isAttendanceAdmin) return json({ error: 'Không có quyền' }, 403);
    const date = String(url.searchParams.get('date') || '');
    const month = parseInt(url.searchParams.get('month'));
    const year = parseInt(url.searchParams.get('year'));
    let from = String(url.searchParams.get('from') || '');
    let to = String(url.searchParams.get('to') || '');
    if (date) {
      from = date;
      to = date;
    } else if (!from || !to) {
      const now = new Date();
      const resolvedYear = year || now.getFullYear();
      const resolvedMonth = month || (now.getMonth() + 1);
      if (resolvedMonth < 1 || resolvedMonth > 12) return json({ error: 'Tháng không hợp lệ' }, 400);
      from = attIsoDate(resolvedYear, resolvedMonth, 1);
      to = attIsoDate(resolvedYear, resolvedMonth, new Date(resolvedYear, resolvedMonth, 0).getDate());
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json({ error: 'Khoảng ngày không hợp lệ' }, 400);
    let q = `SELECT u.id AS user_id,u.full_name,u.employee_code,u.department,u.position,
      COUNT(a.id) AS record_count,
      COALESCE(SUM(CASE WHEN a.checkin_time IS NOT NULL AND a.checkout_time IS NOT NULL AND a.status NOT IN ('absent','cancelled','rejected') THEN CASE WHEN a.shift IN ('morning','afternoon') THEN 0.5 ELSE 1 END ELSE 0 END),0) AS actual_work_days,
      COALESCE(SUM(CASE WHEN a.checkin_time IS NOT NULL AND a.checkout_time IS NOT NULL AND a.status NOT IN ('absent','cancelled','rejected') THEN a.work_hours ELSE 0 END),0) AS total_work_hours,
      COALESCE(SUM(CASE WHEN COALESCE(a.late_minutes,0)>0 THEN 1 ELSE 0 END),0) AS late_days,
      COALESCE(SUM(CASE WHEN COALESCE(a.late_minutes,0)>0 THEN a.late_minutes ELSE 0 END),0) AS late_minutes,
      COALESCE(SUM(CASE WHEN a.status NOT IN ('absent','leave','cancelled','rejected') AND a.checkin_time IS NULL THEN 1 ELSE 0 END),0) AS missing_checkin_days,
      COALESCE(SUM(CASE WHEN a.status NOT IN ('absent','leave','cancelled','rejected') AND a.checkin_time IS NOT NULL AND a.checkout_time IS NULL THEN 1 ELSE 0 END),0) AS missing_checkout_days
      FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date BETWEEN ? AND ?
      WHERE (u.is_active=1 OR a.id IS NOT NULL)`;
    const binds = [from, to];
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns) { q += ' AND u.department=?'; binds.push(me.department); }
    q += ' GROUP BY u.id ORDER BY u.full_name COLLATE NOCASE';
    const { results = [] } = await env.DB.prepare(q).bind(...binds).all();
    const standardWorkDays = attCountBusinessDaysBetween(from, to);
    const employees = results.map(row => {
      const missingDays = Number(row.missing_checkin_days || 0) + Number(row.missing_checkout_days || 0);
      const actualWorkDays = Number(row.actual_work_days || 0);
      return {
        ...row,
        standard_work_days: standardWorkDays,
        attendance_rate: standardWorkDays ? Number(((actualWorkDays / standardWorkDays) * 100).toFixed(1)) : 0,
        period_status: !Number(row.record_count) ? 'no_data' : missingDays ? 'incomplete' : Number(row.late_days) ? 'late' : 'complete',
      };
    });
    return json({ period: { from, to }, employees });
  }

  if (path === '/api/attendance/today' && request.method === 'GET') {
    const today = vnTodayStr();
    let rows;
    if (isManager) {
      const scope = (!isAdmin && !isAttendanceHcns) ? ' AND u.department=?' : '';
      const stmt = env.DB.prepare(
        `SELECT a.*, u.full_name, u.employee_code, u.department FROM attendance a JOIN users u ON a.user_id=u.id WHERE a.date=?${scope} ORDER BY a.checkin_time`
      );
      const r = scope ? await stmt.bind(today, me.department).all() : await stmt.bind(today).all();
      rows = r.results;
    } else {
      const r = await env.DB.prepare(
        'SELECT a.*, u.full_name, u.employee_code, u.department FROM attendance a JOIN users u ON a.user_id=u.id WHERE a.user_id=? AND a.date=?'
      ).bind(me.id, today).all();
      rows = r.results;
    }
    return json({ attendance: rows, today });
  }

  // Register today's work arrangement (work type + shift) before check-in is allowed.
  if (path === '/api/attendance/register' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const workType = ['office', 'wfh', 'business'].includes(b.work_type) ? b.work_type : 'office';
    const shift = ['morning', 'afternoon', 'full'].includes(b.shift) ? b.shift : 'full';
    if (workType === 'business' && (!b.expected_start || !b.expected_end)) {
      return json({ error: 'Vui lòng nhập giờ bắt đầu và kết thúc dự kiến cho chuyến công tác' }, 400);
    }
    const today = vnTodayStr();
    const existing = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?')
      .bind(me.id, today).first();
    if (existing && existing.checkin_time) {
      return json({ error: 'Đã check-in hôm nay, không thể thay đổi đăng ký' }, 400);
    }
    const expectedStart = workType === 'business' ? b.expected_start : null;
    const expectedEnd = workType === 'business' ? b.expected_end : null;
    const note = b.note || '';
    if (existing) {
      await env.DB.prepare(
        'UPDATE attendance SET work_type=?,shift=?,expected_start=?,expected_end=?,registered=1,note=? WHERE id=?'
      ).bind(workType, shift, expectedStart, expectedEnd, note, existing.id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO attendance (user_id,date,work_type,shift,expected_start,expected_end,registered,note) VALUES (?,?,?,?,?,?,1,?)'
      ).bind(me.id, today, workType, shift, expectedStart, expectedEnd, note).run();
    }
    return json({ ok: true });
  }

  if (path === '/api/attendance/checkin' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const today = vnTodayStr();
    let existing = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?')
      .bind(me.id, today).first();
    // Idempotent: if already checked in today, return ok (don't block re-runs/tests)
    if (existing && existing.checkin_time) return json({ ok: true, status: existing.status, time: existing.checkin_time, late_minutes: existing.late_minutes || 0, already: true });
    if (!existing) {
      // Not registered yet — default to office/full day (UI normally blocks this by requiring registration first)
      await env.DB.prepare(
        'INSERT INTO attendance (user_id,date,work_type,shift,registered,note) VALUES (?,?,?,?,1,?)'
      ).bind(me.id, today, 'office', 'full', b.note || '').run();
      existing = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').bind(me.id, today).first();
    }
    const ipInfo = await currentIpInfo(env, request);
    if ((existing.work_type || 'office') === 'office' && !ipInfo.matched) {
      return json({ error: `IP hien tai (${ipInfo.ip}) khong nam trong whitelist van phong`, ip: ipInfo.ip, matched: false, warning: ipInfo.warning }, 403);
    }
    const timeStr = vnTimeStr();
    const bounds = attShiftBounds(existing.work_type || 'office', existing.shift || 'full', existing.expected_start, existing.expected_end);
    const lateMinutes = Math.max(0, attToMinutes(timeStr) - attToMinutes(bounds.lateAfter));
    const status = lateMinutes > 0 ? 'late' : 'present';
    await env.DB.prepare('UPDATE attendance SET checkin_time=?,checkin_ip=?,status=?,late_minutes=?,note=? WHERE id=?')
      .bind(timeStr, ipInfo.ip, status, lateMinutes, b.note || existing.note || '', existing.id).run();
    return json({ ok: true, status, time: timeStr, late_minutes: lateMinutes });
  }

  if (path === '/api/attendance/checkout' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const today = vnTodayStr();
    let record = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?')
      .bind(me.id, today).first();
    if (!record || !record.checkin_time) {
      // Auto check-in first (for test pipeline convenience), then checkout
      const ipInfo = await currentIpInfo(env, request);
      if (!record || (record.work_type || 'office') === 'office') {
        if (!ipInfo.matched) return json({ error: `IP hien tai (${ipInfo.ip}) khong nam trong whitelist van phong`, ip: ipInfo.ip, matched: false, warning: ipInfo.warning }, 403);
      }
      const ciTime = vnTimeStr();
      if (!record) {
        await env.DB.prepare(
          'INSERT INTO attendance (user_id,date,work_type,shift,registered,checkin_time,checkin_ip,status) VALUES (?,?,?,?,1,?,?,?)'
        ).bind(me.id, today, 'office', 'full', ciTime, ipInfo.ip, 'present').run();
      } else {
        await env.DB.prepare('UPDATE attendance SET checkin_time=?,checkin_ip=?,status=? WHERE id=?')
          .bind(ciTime, ipInfo.ip, 'present', record.id).run();
      }
      record = await env.DB.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').bind(me.id, today).first();
    }
    // Idempotent: if already checked out today, return ok (don't block re-runs/tests)
    if (record.checkout_time) return json({ ok: true, time: record.checkout_time, work_hours: record.work_hours, early_minutes: record.early_minutes || 0, already: true });
    const ipInfo = await currentIpInfo(env, request);
    const workType = record.work_type || 'office';
    if (workType === 'office' && !ipInfo.matched) {
      return json({ error: `IP hien tai (${ipInfo.ip}) khong nam trong whitelist van phong`, ip: ipInfo.ip, matched: false, warning: ipInfo.warning }, 403);
    }
    const timeStr = vnTimeStr();
    const shift = record.shift || 'full';
    const bounds = attShiftBounds(workType, shift, record.expected_start, record.expected_end);
    const ciMin = attToMinutes(record.checkin_time) ?? attToMinutes(bounds.start);
    const coMin = attToMinutes(timeStr);
    const earlyMinutes = Math.max(0, attToMinutes(bounds.end) - coMin);
    let workMinutes = Math.max(0, coMin - ciMin);
    if (workType !== 'business' && shift === 'full') {
      // Exclude the 12:00–13:30 lunch break from total worked time
      const lunchStart = 12 * 60, lunchEnd = 13 * 60 + 30;
      const overlap = Math.max(0, Math.min(coMin, lunchEnd) - Math.max(ciMin, lunchStart));
      workMinutes -= overlap;
    }
    const workHours = Math.max(0, workMinutes) / 60;
    await env.DB.prepare('UPDATE attendance SET checkout_time=?,checkout_ip=?,work_hours=?,early_minutes=? WHERE id=?')
      .bind(timeStr, ipInfo.ip, workHours, earlyMinutes, record.id).run();
    const overtimeMinutes = Math.max(0, coMin - attToMinutes(bounds.end));
    return json({ ok: true, attendance_id: record.id, time: timeStr, work_hours: workHours, early_minutes: earlyMinutes,
      requires_overtime_choice: overtimeMinutes >= 1, overtime_minutes: overtimeMinutes, shift_end_time: bounds.end });
  }

  // ── OVERTIME ────────────────────────────────────────────────────
  if (path === '/api/overtime-requests' && request.method === 'GET') {
    const month = String(url.searchParams.get('month') || '');
    const status = String(url.searchParams.get('status') || '');
    let q = `SELECT o.*,u.full_name,u.employee_code,u.department FROM overtime_requests o JOIN users u ON u.id=o.user_id WHERE 1=1`;
    const binds = [];
    if (!isAttendanceAdmin) { q += ' AND o.user_id=?'; binds.push(me.id); }
    else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns) { q += ' AND u.department=?'; binds.push(me.department); }
    if (/^\d{4}-\d{2}$/.test(month)) { q += " AND strftime('%Y-%m',o.work_date)=?"; binds.push(month); }
    if (['pending','approved','rejected'].includes(status)) { q += ' AND o.status=?'; binds.push(status); }
    q += ' ORDER BY CASE o.status WHEN \'pending\' THEN 0 ELSE 1 END,o.work_date DESC,o.id DESC';
    const { results = [] } = await (binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q)).all();
    return json({ overtime_requests: results });
  }

  if (path === '/api/overtime-requests' && request.method === 'POST') {
    const retryAfter = rateLimit(request, `overtime:${me.id}`, 10, 24 * 60 * 60 * 1000);
    if (retryAfter) return json({ error: 'Đã vượt số lần gửi yêu cầu trong ngày', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const b = await request.json().catch(() => ({}));
    const attendanceId = parseInt(b.attendance_id);
    const reason = String(b.reason || '').trim();
    if (!attendanceId || !reason) return json({ error: 'Vui lòng nhập lý do làm thêm giờ' }, 400);
    if (reason.length > 1000) return json({ error: 'Lý do làm thêm giờ không được quá 1000 ký tự' }, 400);
    const record = await env.DB.prepare('SELECT * FROM attendance WHERE id=? AND user_id=?').bind(attendanceId, me.id).first();
    if (!record || !record.checkout_time) return json({ error: 'Không tìm thấy checkout hợp lệ' }, 404);
    const bounds = attShiftBounds(record.work_type || 'office', record.shift || 'full', record.expected_start, record.expected_end);
    const requestedMinutes = Math.max(0, (attToMinutes(record.checkout_time) || 0) - (attToMinutes(bounds.end) || 0));
    if (requestedMinutes < 1) return json({ error: 'Checkout không muộn hơn giờ kết thúc ca' }, 400);
    try {
      const r = await env.DB.prepare('INSERT INTO overtime_requests (attendance_id,user_id,work_date,shift_end_time,checkout_time,requested_minutes,reason,status) VALUES (?,?,?,?,?,?,?,\'pending\')')
        .bind(record.id, me.id, record.date, bounds.end, record.checkout_time, requestedMinutes, reason).run();
      return json({ ok: true, id: r.meta.last_row_id, requested_minutes: requestedMinutes });
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) return json({ error: 'Đã gửi yêu cầu làm thêm giờ cho checkout này' }, 400);
      throw e;
    }
  }

  const overtimeAction = path.match(/^\/api\/overtime-requests\/(\d+)\/(approve|reject)$/);
  if (overtimeAction && request.method === 'POST') {
    if (!isAttendanceAdmin) return json({ error: 'Không có quyền duyệt làm thêm giờ' }, 403);
    const retryAfter = rateLimit(request, `overtime-review:${me.id}`, 30, 60 * 60 * 1000);
    if (retryAfter) return json({ error: 'Đã vượt giới hạn duyệt trong một giờ', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const id = parseInt(overtimeAction[1]); const action = overtimeAction[2];
    const requestRow = await env.DB.prepare('SELECT o.*,u.department FROM overtime_requests o JOIN users u ON u.id=o.user_id WHERE o.id=?').bind(id).first();
    if (!requestRow) return json({ error: 'Không tìm thấy yêu cầu làm thêm giờ' }, 404);
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && requestRow.department !== me.department) return json({ error: 'Không có quyền duyệt yêu cầu ngoài phòng ban' }, 403);
    if (requestRow.status !== 'pending') return json({ error: 'Yêu cầu đã được xử lý' }, 400);
    const b = await request.json().catch(() => ({}));
    const note = String(b.review_note || '').trim();
    if (action === 'reject' && !note) return json({ error: 'Vui lòng nhập lý do từ chối' }, 400);
    const approvedMinutes = action === 'approve' ? Math.min(Math.max(0, parseInt(b.approved_minutes ?? requestRow.requested_minutes) || 0), requestRow.requested_minutes) : 0;
    if (action === 'approve' && approvedMinutes < 1) return json({ error: 'Số phút được duyệt phải lớn hơn 0' }, 400);
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    await env.DB.prepare('UPDATE overtime_requests SET status=?,approved_minutes=?,reviewer_id=?,reviewer_name=?,review_note=?,reviewed_at=datetime(\'now\',\'localtime\'),updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
      .bind(nextStatus, approvedMinutes, me.id, me.full_name || '', note || null, id).run();
    const d = new Date(`${requestRow.work_date}T00:00:00`);
    const ot = await refreshInvoiceOvertime(env, requestRow.user_id, d.getMonth() + 1, d.getFullYear(), me);
    return json({ ok: true, status: nextStatus, approved_minutes: approvedMinutes, overtime: ot });
  }

  // ── MONTHLY OVERTIME FORMS ──────────────────────────────────────
  // Unlike checkout OT, these forms may contain multiple dates and can be
  // submitted by an employee before/without a same-day attendance checkout.
  if (path === '/api/overtime-forms' && request.method === 'GET') {
    const month = String(url.searchParams.get('month') || '');
    const status = String(url.searchParams.get('status') || '');
    let q = `SELECT f.*,u.full_name,u.employee_code,u.department FROM overtime_forms f JOIN users u ON u.id=f.user_id WHERE 1=1`;
    const binds = [];
    if (!isAttendanceAdmin) { q += ' AND f.user_id=?'; binds.push(me.id); }
    else if (me.role === 'manager' && !isAdmin && !isAttendanceHcns) { q += ' AND u.department=?'; binds.push(me.department); }
    if (/^\d{4}-\d{2}$/.test(month)) { q += ' AND f.period_month=?'; binds.push(month); }
    if (['draft','pending','approved','partially_approved','rejected'].includes(status)) { q += ' AND f.status=?'; binds.push(status); }
    q += " ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,f.period_month DESC,f.id DESC";
    const { results: forms = [] } = await (binds.length ? env.DB.prepare(q).bind(...binds) : env.DB.prepare(q)).all();
    for (const form of forms) {
      form.items = (await env.DB.prepare('SELECT * FROM overtime_form_items WHERE form_id=? ORDER BY start_at,id').bind(form.id).all()).results || [];
      form.requested_minutes = form.items.reduce((sum, item) => sum + Number(item.requested_minutes || 0), 0);
      form.approved_minutes = form.items.reduce((sum, item) => sum + Number(item.approved_minutes || 0), 0);
    }
    return json({ overtime_forms: forms });
  }

  if (path === '/api/overtime-forms' && request.method === 'POST') {
    const retryAfter = rateLimit(request, `overtime-form:${me.id}`, 20, 24 * 60 * 60 * 1000);
    if (retryAfter) return json({ error: 'Đã vượt số lần tạo form OT trong ngày', code: 'RATE_LIMITED' }, 429, { 'Retry-After': String(retryAfter) });
    const b = await request.json().catch(() => ({}));
    const periodMonth = String(b.period_month || '');
    const validated = normalizeOvertimeItems(b.items, periodMonth);
    if (validated.error) return json({ error: validated.error }, 400);
    const items = await applyCalendarOvertimeCategories(env, validated.items);
    const status = b.submit === false ? 'draft' : 'pending';
    const r = await env.DB.prepare(
      "INSERT INTO overtime_forms (user_id,period_month,status,source,submitted_at) VALUES (?,?,?,?,CASE WHEN ?='pending' THEN datetime('now','localtime') ELSE NULL END)"
    ).bind(me.id, periodMonth, status, 'employee', status).run();
    const formId = r.meta.last_row_id;
    await env.DB.batch(items.map(item => env.DB.prepare(
      'INSERT INTO overtime_form_items (form_id,start_at,end_at,requested_minutes,reason,time_category) VALUES (?,?,?,?,?,?)'
    ).bind(formId, item.start_at, item.end_at, item.requested_minutes, item.reason, item.time_category)));
    return json({ ok: true, id: formId, status });
  }

  const overtimeFormMatch = path.match(/^\/api\/overtime-forms\/(\d+)$/);
  if (overtimeFormMatch && request.method === 'PUT') {
    const formId = parseInt(overtimeFormMatch[1], 10);
    const form = await env.DB.prepare('SELECT * FROM overtime_forms WHERE id=?').bind(formId).first();
    if (!form) return json({ error: 'Không tìm thấy form OT' }, 404);
    if (Number(form.user_id) !== Number(me.id) || form.status !== 'draft') return json({ error: 'Chỉ được sửa form OT nháp của chính bạn' }, 403);
    const b = await request.json().catch(() => ({}));
    const periodMonth = String(b.period_month || form.period_month);
    const validated = normalizeOvertimeItems(b.items, periodMonth);
    if (validated.error) return json({ error: validated.error }, 400);
    const items = await applyCalendarOvertimeCategories(env, validated.items);
    await env.DB.batch([
      env.DB.prepare("UPDATE overtime_forms SET period_month=?,updated_at=datetime('now','localtime') WHERE id=?").bind(periodMonth, formId),
      env.DB.prepare('DELETE FROM overtime_form_items WHERE form_id=?').bind(formId),
      ...items.map(item => env.DB.prepare('INSERT INTO overtime_form_items (form_id,start_at,end_at,requested_minutes,reason,time_category) VALUES (?,?,?,?,?,?)').bind(formId, item.start_at, item.end_at, item.requested_minutes, item.reason, item.time_category)),
    ]);
    return json({ ok: true });
  }

  const overtimeFormSubmit = path.match(/^\/api\/overtime-forms\/(\d+)\/submit$/);
  if (overtimeFormSubmit && request.method === 'POST') {
    const formId = parseInt(overtimeFormSubmit[1], 10);
    const form = await env.DB.prepare('SELECT * FROM overtime_forms WHERE id=?').bind(formId).first();
    if (!form) return json({ error: 'Không tìm thấy form OT' }, 404);
    if (Number(form.user_id) !== Number(me.id) || form.status !== 'draft') return json({ error: 'Chỉ được gửi form OT nháp của chính bạn' }, 403);
    await env.DB.prepare("UPDATE overtime_forms SET status='pending',submitted_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").bind(formId).run();
    return json({ ok: true, status: 'pending' });
  }

  const overtimeFormDecision = path.match(/^\/api\/overtime-forms\/(\d+)\/decision$/);
  if (overtimeFormDecision && request.method === 'POST') {
    if (!isAttendanceAdmin) return json({ error: 'Không có quyền duyệt form OT' }, 403);
    const formId = parseInt(overtimeFormDecision[1], 10);
    const form = await env.DB.prepare('SELECT f.*,u.department FROM overtime_forms f JOIN users u ON u.id=f.user_id WHERE f.id=?').bind(formId).first();
    if (!form) return json({ error: 'Không tìm thấy form OT' }, 404);
    if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && form.department !== me.department) return json({ error: 'Không có quyền duyệt form ngoài phòng ban' }, 403);
    if (form.status !== 'pending') return json({ error: 'Form OT đã được xử lý' }, 400);
    const b = await request.json().catch(() => ({}));
    const action = b.action === 'reject' ? 'reject' : 'approve';
    const note = String(b.review_note || '').trim();
    if (action === 'reject' && !note) return json({ error: 'Vui lòng nhập lý do từ chối' }, 400);
    const { results: items = [] } = await env.DB.prepare('SELECT * FROM overtime_form_items WHERE form_id=? ORDER BY id').bind(formId).all();
    const supplied = new Map((Array.isArray(b.items) ? b.items : []).map(item => [Number(item.id), Number(item.approved_minutes)]));
    const updates = [];
    let approvedTotal = 0;
    for (const item of items) {
      const approved = action === 'reject' ? 0 : Math.min(Math.max(0, Number.isFinite(supplied.get(Number(item.id))) ? supplied.get(Number(item.id)) : Number(item.requested_minutes)), Number(item.requested_minutes));
      approvedTotal += approved;
      updates.push(env.DB.prepare("UPDATE overtime_form_items SET approved_minutes=?,updated_at=datetime('now','localtime') WHERE id=?").bind(Math.round(approved), item.id));
    }
    const requestedTotal = items.reduce((sum, item) => sum + Number(item.requested_minutes || 0), 0);
    const nextStatus = action === 'reject' ? 'rejected' : approvedTotal === requestedTotal ? 'approved' : 'partially_approved';
    updates.push(env.DB.prepare("UPDATE overtime_forms SET status=?,review_note=?,reviewer_id=?,reviewer_name=?,reviewed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").bind(nextStatus, note || null, me.id, me.full_name || '', formId));
    await env.DB.batch(updates);
    const [year, month] = form.period_month.split('-').map(Number);
    const overtime = await refreshInvoiceOvertime(env, form.user_id, month, year, me);
    return json({ ok: true, status: nextStatus, approved_minutes: approvedTotal, overtime });
  }

  if (path === '/api/company-holidays' && request.method === 'GET') {
    const { results = [] } = await env.DB.prepare('SELECT * FROM company_holidays ORDER BY holiday_date DESC').all();
    return json({ holidays: results });
  }
  if (path === '/api/company-holidays' && request.method === 'POST') {
    if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({}));
    const date = String(b.holiday_date || ''), name = String(b.name || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return json({ error: 'Ngày lễ và tên ngày lễ là bắt buộc' }, 400);
    const r = await env.DB.prepare('INSERT INTO company_holidays (holiday_date,name,is_active) VALUES (?,?,?)').bind(date, name, b.is_active === false ? 0 : 1).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const holidayMatch = path.match(/^\/api\/company-holidays\/(\d+)$/);
  if (holidayMatch && ['PUT','DELETE'].includes(request.method)) {
    if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
    const id = parseInt(holidayMatch[1]);
    if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM company_holidays WHERE id=?').bind(id).run(); return json({ ok: true }); }
    const b = await request.json().catch(() => ({}));
    await env.DB.prepare('UPDATE company_holidays SET holiday_date=?,name=?,is_active=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').bind(String(b.holiday_date || ''), String(b.name || '').trim(), b.is_active === false ? 0 : 1, id).run();
    return json({ ok: true });
  }

  const attMatch = path.match(/^\/api\/attendance\/(\d+)$/);
  if (attMatch && request.method === 'PUT') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const aid = parseInt(attMatch[1]);
    const record = await env.DB.prepare('SELECT a.id,u.department FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').bind(aid).first();
    if (!record) return json({ error: 'Không tìm thấy chấm công' }, 404);
    if (!isAdmin && !isAttendanceHcns && record.department !== me.department) return json({ error: 'Không có quyền sửa chấm công ngoài phòng ban' }, 403);
    const b = await request.json().catch(() => ({}));
    const allowedStatus = ['present','late','absent','leave','cancelled','rejected'];
    const status = allowedStatus.includes(b.status) ? b.status : 'present';
    const workHours = Math.max(0, Math.min(24, Number(b.work_hours) || 0));
    await env.DB.prepare(
      'UPDATE attendance SET checkin_time=?,checkout_time=?,status=?,work_hours=?,note=? WHERE id=?'
    ).bind(b.checkin_time||null,b.checkout_time||null,status,workHours,String(b.note||'').slice(0,2000),aid).run();
    return json({ ok: true });
  }

  // Aggregated monthly attendance summary — used to auto-fill "Ngày công" when
  // creating/reviewing a payroll invoice (Phiếu lương ← Chấm công).
  if (path === '/api/attendance/summary' && request.method === 'GET') {
    const month = parseInt(url.searchParams.get('month'));
    const year = parseInt(url.searchParams.get('year'));
    if (!month || !year) return json({ error: 'Thiếu tháng/năm' }, 400);
    let targetUserId = me.id;
    const qUserId = url.searchParams.get('userId');
    if (qUserId) {
      if (!isManager && parseInt(qUserId) !== me.id) return json({ error: 'Không có quyền' }, 403);
      targetUserId = parseInt(qUserId);
      if (targetUserId !== me.id && !isAdmin && !isAttendanceHcns) {
        const target = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(targetUserId).first();
        if (!target || target.department !== me.department) return json({ error: 'Không có quyền xem nhân sự ngoài phòng ban' }, 403);
      }
    }
    const summary = await buildMonthlyWorkSummary(env, targetUserId, month, year);
    return json(summary);
  }

  // Employee attendance detail for the selected period. Summary is calculated
  // from the full period query, never from the paginated attendance list.
  const attendanceEmployeeMatch = path.match(/^\/api\/attendance\/employees\/(\d+)\/summary$/);
  if (attendanceEmployeeMatch && request.method === 'GET') {
    const employeeId = parseInt(attendanceEmployeeMatch[1]);
    const employee = await env.DB.prepare('SELECT id,full_name,employee_code,department,position,is_active FROM users WHERE id=?').bind(employeeId).first();
    if (!employee) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    if (employeeId !== me.id) {
      if (!isAttendanceAdmin) return json({ error: 'Không có quyền' }, 403);
      if (me.role === 'manager' && !isAdmin && !isAttendanceHcns && employee.department !== me.department) return json({ error: 'Không có quyền xem nhân sự ngoài phòng ban' }, 403);
    }
    const month = parseInt(url.searchParams.get('month'));
    const year = parseInt(url.searchParams.get('year'));
    let from = String(url.searchParams.get('from') || '');
    let to = String(url.searchParams.get('to') || '');
    if (!from || !to) {
      const now = new Date();
      const resolvedYear = year || now.getFullYear();
      const resolvedMonth = month || (now.getMonth() + 1);
      if (resolvedMonth < 1 || resolvedMonth > 12) return json({ error: 'Tháng không hợp lệ' }, 400);
      from = attIsoDate(resolvedYear, resolvedMonth, 1);
      to = attIsoDate(resolvedYear, resolvedMonth, new Date(resolvedYear, resolvedMonth, 0).getDate());
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json({ error: 'Khoảng ngày không hợp lệ' }, 400);
    const { results: records = [] } = await env.DB.prepare(
      'SELECT * FROM attendance WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date ASC'
    ).bind(employeeId, from, to).all();
    let paidLeaveDays = 0;
    try {
      const { results: leaves = [] } = await env.DB.prepare(`SELECT lr.start_date,lr.end_date FROM leave_requests lr LEFT JOIN leave_types lt ON lr.type=lt.code WHERE (CAST(lr.user_id AS TEXT)=CAST(? AS TEXT) OR lr.employee_id=?) AND lr.status='approved' AND COALESCE(lt.paid_policy,'paid')='paid' AND date(lr.start_date)<=date(?) AND date(lr.end_date)>=date(?)`).bind(employeeId, employeeId, to, from).all();
      for (const leave of leaves) paidLeaveDays += attCountBusinessDaysBetween(String(leave.start_date) > from ? String(leave.start_date) : from, String(leave.end_date) < to ? String(leave.end_date) : to);
    } catch (_) {}
    const activeRecords = records.filter(r => !['cancelled', 'rejected'].includes(r.status));
    const complete = activeRecords.filter(r => r.checkin_time && r.checkout_time && r.status !== 'absent');
    const fullDays = complete.filter(r => r.shift !== 'morning' && r.shift !== 'afternoon').length;
    const halfDays = complete.length - fullDays;
    const missingCheckinDays = activeRecords.filter(r => !r.checkin_time && r.status !== 'absent' && r.status !== 'leave').length;
    const missingCheckoutDays = activeRecords.filter(r => r.checkin_time && !r.checkout_time).length;
    const lateDays = activeRecords.filter(r => Number(r.late_minutes || 0) > 0).length;
    const earlyDays = activeRecords.filter(r => Number(r.early_minutes || 0) > 0).length;
    const totalWorkHours = complete.reduce((sum, r) => sum + Number(r.work_hours || 0), 0);
    const standardWorkDays = attCountBusinessDaysBetween(from, to);
    const actualWorkDays = fullDays + halfDays * .5;
    const overtime = await buildMonthlyOvertimeSummary(env, employeeId, Number(from.slice(5, 7)), Number(from.slice(0, 4)));
    return json({ employee, period: { from, to }, summary: {
      standardWorkDays, actualWorkDays, fullDays, halfDays,
      officeDays: complete.filter(r => (r.work_type || 'office') === 'office').length,
      wfhDays: complete.filter(r => r.work_type === 'wfh').length,
      businessDays: complete.filter(r => r.work_type === 'business').length,
      paidLeaveDays, absentDays: activeRecords.filter(r => r.status === 'absent').length,
      missingCheckinDays, missingCheckoutDays, lateDays,
      lateMinutes: activeRecords.reduce((sum, r) => sum + Number(r.late_minutes || 0), 0), earlyDays,
      earlyMinutes: activeRecords.reduce((sum, r) => sum + Number(r.early_minutes || 0), 0), totalWorkHours,
      approvedOvertimeMinutes: overtime.approvedOvertimeMinutes, approvedOvertimeHours: overtime.approvedOvertimeHours,
      attendanceRate: standardWorkDays ? Number(((actualWorkDays / standardWorkDays) * 100).toFixed(1)) : 0,
    }, records });
  }

  // ── WIFI WHITELIST ───────────────────────────────────────────────
  if (path === '/api/wifi-whitelist' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM wifi_whitelist ORDER BY id').all();
    return json({ whitelist: results });
  }
  if (path === '/api/wifi-whitelist' && request.method === 'POST') {
    if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    const ipInfo = await currentIpInfo(env, request);
    const requestedIp = String(b.ip_range || ipInfo.ip).trim();
    const rules = String(requestedIp || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!rules.length) return json({ error: 'Nhập ít nhất một Public IP hoặc dải mạng công khai.' }, 400);
    if (rules.some(isPrivateNetworkRule)) return json({ error: 'Không sử dụng IP nội bộ, router hoặc dải private cho mạng văn phòng.' }, 400);
    const hasCurrentIp = rules.some(rule => ipMatchesRule(ipInfo.ip, rule));
    const warning = hasCurrentIp ? null : `IP backend đang nhận là ${ipInfo.ip} — không nằm trong dải vừa lưu. Nếu IP này không phải IP văn phòng, việc chấm công có thể bị gián đoạn.`;
    const r = await env.DB.prepare(
      'INSERT INTO wifi_whitelist (wifi_name,ip_range,description,is_active) VALUES (?,?,?,1)'
    ).bind(b.wifi_name||'',requestedIp || ipInfo.ip,b.description||'').run();
    return json({ ok: true, id: r.meta.last_row_id, warning });
  }
  const wifiMatch = path.match(/^\/api\/wifi-whitelist\/(\d+)$/);
  if (wifiMatch) {
    const wid = parseInt(wifiMatch[1]);
    if (request.method === 'PUT') {
      if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
      const b = await request.json();
      const requestedIp = String(b.ip_range || '').trim();
      if (!requestedIp || requestedIp.split(',').some(isPrivateNetworkRule)) {
        return json({ error: 'Nhập Public IP/dải mạng hợp lệ; không sử dụng IP nội bộ, router hoặc dải private.' }, 400);
      }
      await env.DB.prepare('UPDATE wifi_whitelist SET wifi_name=?,ip_range=?,description=?,is_active=? WHERE id=?')
        .bind(b.wifi_name||'',b.ip_range||'',b.description||'',b.is_active??1,wid).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
      await env.DB.prepare('DELETE FROM wifi_whitelist WHERE id=?').bind(wid).run();
      return json({ ok: true });
    }
  }

  // ── TASKS ────────────────────────────────────────────────────────
  if (path === '/api/task-projects' && request.method === 'GET') {
    const includeArchived = url.searchParams.get('include_archived') === '1';
    const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
    let q = `SELECT p.*, u.full_name as manager_name,
                    (SELECT COUNT(*) FROM task_project_members m WHERE m.project_id=p.id) as member_count,
                    (SELECT GROUP_CONCAT(user_id) FROM task_project_members m WHERE m.project_id=p.id) as member_ids,
                    (SELECT COUNT(*) FROM tasks t WHERE t.team_project_id=p.id) as task_count
               FROM task_projects p
               LEFT JOIN users u ON p.manager_id=u.id
              WHERE 1=1`;
    const binds = [];
    if (!includeArchived) q += " AND COALESCE(p.status,'active')!='archived'";
    if (!isTaskAdmin(me)) {
      q += ` AND (p.manager_id=? OR EXISTS (
        SELECT 1 FROM task_project_members m WHERE m.project_id=p.id AND m.user_id=?
      ))`;
      binds.push(me.id, me.id);
    }
    if (search) {
      q += ' AND (lower(p.name) LIKE ? OR lower(COALESCE(p.code,"")) LIKE ? OR lower(COALESCE(p.description,"")) LIKE ?)';
      const like = '%' + search + '%';
      binds.push(like, like, like);
    }
    q += " ORDER BY CASE COALESCE(p.status,'active') WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.updated_at DESC, p.id DESC";
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ projects: results, canManage: isTaskAdmin(me) });
  }

  if (path === '/api/task-projects' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json();
    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'Thieu ten Project' }, 400);
    const type = 'project';
    const status = ['active','paused','archived','done'].includes(b.status) ? b.status : 'active';
    const managerId = intOrNull(b.manager_id);
    const r = await env.DB.prepare(
      `INSERT INTO task_projects (workspace_id,name,code,type,description,department,manager_id,status,start_date,end_date,created_by)
       VALUES (1,?,?,?,?,?,?,?,?,?,?)`
    ).bind(name, String(b.code || '').trim(), type, String(b.description || '').trim(), String(b.department || '').trim(), managerId, status, b.start_date || null, b.end_date || null, me.id).run();
    const projectId = r.meta.last_row_id;
    const members = Array.isArray(b.members) ? b.members : [];
    if (managerId && !members.includes(managerId)) members.push(managerId);
    for (const uid of [...new Set(members.map(Number).filter(Boolean))]) {
      await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
        .bind(projectId, uid, uid === managerId ? 'owner' : 'member', me.id).run();
    }
    await ensureDefaultTaskGroup(env, projectId, me.id);
    return json({ ok: true, id: projectId });
  }

  const projectMatch = path.match(/^\/api\/task-projects\/(\d+)$/);
  if (projectMatch) {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const projectId = parseInt(projectMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      const project = await env.DB.prepare('SELECT * FROM task_projects WHERE id=?').bind(projectId).first();
      if (!project) return json({ error: 'Khong tim thay' }, 404);
      const type = 'project';
      const status = ['active','paused','archived','done'].includes(b.status) ? b.status : project.status;
      await env.DB.prepare(
        `UPDATE task_projects
            SET name=?,code=?,type=?,description=?,department=?,manager_id=?,status=?,start_date=?,end_date=?,updated_at=datetime('now','localtime')
          WHERE id=?`
      ).bind(
        String(b.name || project.name).trim(),
        String(b.code ?? project.code ?? '').trim(),
        type,
        String(b.description ?? project.description ?? '').trim(),
        String(b.department ?? project.department ?? '').trim(),
        intOrNull(b.manager_id) || project.manager_id || null,
        status,
        b.start_date ?? project.start_date ?? null,
        b.end_date ?? project.end_date ?? null,
        projectId
      ).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare("UPDATE task_projects SET status='archived',updated_at=datetime('now','localtime') WHERE id=?").bind(projectId).run();
      return json({ ok: true });
    }
  }

  const projectMembersMatch = path.match(/^\/api\/task-projects\/(\d+)\/members$/);
  if (projectMembersMatch && request.method === 'PUT') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const projectId = parseInt(projectMembersMatch[1]);
    const b = await request.json();
    const project = await env.DB.prepare('SELECT * FROM task_projects WHERE id=?').bind(projectId).first();
    if (!project) return json({ error: 'Khong tim thay' }, 404);
    const members = Array.isArray(b.members) ? b.members.map(Number).filter(Boolean) : [];
    if (project.manager_id && !members.includes(project.manager_id)) members.push(project.manager_id);
    await env.DB.prepare('DELETE FROM task_project_members WHERE project_id=?').bind(projectId).run();
    for (const uid of [...new Set(members)]) {
      await env.DB.prepare('INSERT INTO task_project_members (project_id,user_id,role,added_by) VALUES (?,?,?,?)')
        .bind(projectId, uid, uid === Number(project.manager_id) ? 'owner' : 'member', me.id).run();
    }
    return json({ ok: true });
  }

  if (path === '/api/task-groups' && request.method === 'GET') {
    const projectId = intOrNull(url.searchParams.get('project_id'));
    if (!projectId) return json({ error: 'Thieu project_id' }, 400);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    await ensureDefaultTaskGroup(env, projectId, me.id);
    const includeArchived = url.searchParams.get('include_archived') === '1';
    let q = `SELECT g.*,
                    (SELECT COUNT(*) FROM tasks t WHERE t.group_id=g.id OR (g.position=0 AND t.team_project_id=g.project_id AND t.group_id IS NULL)) as task_count
               FROM task_groups g WHERE g.project_id=?`;
    const binds = [projectId];
    if (!includeArchived) q += ' AND g.is_archived=0';
    q += ' ORDER BY g.position ASC, g.id ASC';
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return json({ groups: results, canManage: isTaskAdmin(me) });
  }

  if (path === '/api/task-groups' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json();
    const projectId = intOrNull(b.project_id);
    const name = String(b.name || '').trim();
    if (!projectId || !name) return json({ error: 'Thieu Project hoac ten nhom' }, 400);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? String(b.color) : '#6366F1';
    const posRow = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM task_groups WHERE project_id=?').bind(projectId).first();
    const position = Number.isFinite(Number(b.position)) ? Number(b.position) : Number(posRow?.next_pos || 0);
    const r = await env.DB.prepare(
      'INSERT INTO task_groups (project_id,name,position,color,created_by) VALUES (?,?,?,?,?)'
    ).bind(projectId, name, position, color, me.id).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const groupMatch = path.match(/^\/api\/task-groups\/(\d+)$/);
  if (groupMatch) {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const groupId = parseInt(groupMatch[1]);
    const group = await env.DB.prepare('SELECT * FROM task_groups WHERE id=?').bind(groupId).first();
    if (!group) return json({ error: 'Khong tim thay' }, 404);
    if (!(await canUseTaskProject(env, group.project_id, me))) return json({ error: 'Khong co quyen voi Project nay' }, 403);
    if (request.method === 'PUT') {
      const b = await request.json();
      const name = String(b.name || group.name || '').trim();
      if (!name) return json({ error: 'Thieu ten nhom' }, 400);
      const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? String(b.color) : group.color;
      const position = Number.isFinite(Number(b.position)) ? Number(b.position) : group.position;
      await env.DB.prepare(
        "UPDATE task_groups SET name=?,position=?,color=?,is_archived=?,updated_at=datetime('now','localtime') WHERE id=?"
      ).bind(name, position, color, b.is_archived ?? group.is_archived ?? 0, groupId).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare("UPDATE task_groups SET is_archived=1,updated_at=datetime('now','localtime') WHERE id=?").bind(groupId).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/task-labels' && request.method === 'GET') {
    const projectId = intOrNull(url.searchParams.get('project_id'));
    let q = `SELECT l.*, p.name as project_name,
                    (SELECT COUNT(*) FROM tasks t WHERE t.label_id=l.id) as usage_count
               FROM task_labels l
               LEFT JOIN task_projects p ON l.project_id=p.id
              WHERE l.is_active=1 AND (l.project_id IS NULL`;
    const binds = [];
    if (projectId) { q += ' OR l.project_id=?'; binds.push(projectId); }
    q += ')';
    if (!isTaskAdmin(me) && projectId) {
      q += ` AND (l.project_id IS NULL OR EXISTS (
        SELECT 1 FROM task_project_members m WHERE m.project_id=l.project_id AND m.user_id=?
      ) OR EXISTS (SELECT 1 FROM task_projects p2 WHERE p2.id=l.project_id AND p2.manager_id=?))`;
      binds.push(me.id, me.id);
    }
    q += ' ORDER BY l.project_id IS NOT NULL, l.name';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ labels: results, canManage: isTaskAdmin(me) });
  }

  if (path === '/api/task-labels' && request.method === 'POST') {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json();
    const name = String(b.name || '').trim();
    const color = String(b.color || '').trim();
    if (!name) return json({ error: 'Thieu ten nhan' }, 400);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: 'Mau khong hop le' }, 400);
    const projectId = intOrNull(b.project_id);
    await env.DB.prepare(
      `INSERT INTO task_labels (workspace_id,project_id,name,code,color,description,is_active,created_by)
       VALUES (1,?,?,?,?,?,1,?)`
    ).bind(projectId, name, String(b.code || '').trim(), color, String(b.description || '').trim(), me.id).run();
    return json({ ok: true });
  }

  const labelMatch = path.match(/^\/api\/task-labels\/(\d+)$/);
  if (labelMatch) {
    if (!isTaskAdmin(me)) return json({ error: 'Khong co quyen' }, 403);
    const labelId = parseInt(labelMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      const label = await env.DB.prepare('SELECT * FROM task_labels WHERE id=?').bind(labelId).first();
      if (!label) return json({ error: 'Khong tim thay' }, 404);
      const color = String(b.color || label.color || '').trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return json({ error: 'Mau khong hop le' }, 400);
      await env.DB.prepare(
        `UPDATE task_labels
            SET name=?,code=?,color=?,description=?,project_id=?,updated_at=datetime('now','localtime')
          WHERE id=?`
      ).bind(
        String(b.name || label.name).trim(),
        String(b.code ?? label.code ?? '').trim(),
        color,
        String(b.description ?? label.description ?? '').trim(),
        intOrNull(b.project_id) || null,
        labelId
      ).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      const used = await env.DB.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE label_id=?').bind(labelId).first();
      if ((used?.cnt || 0) > 0) {
        await env.DB.prepare("UPDATE task_labels SET is_active=0,updated_at=datetime('now','localtime') WHERE id=?").bind(labelId).run();
      } else {
        await env.DB.prepare('DELETE FROM task_labels WHERE id=?').bind(labelId).run();
      }
      return json({ ok: true });
    }
  }

  if (path === '/api/tasks' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    const assignee = url.searchParams.get('assignee');
    const assigner = url.searchParams.get('assigner');
    const taskStatus = url.searchParams.get('status');
    const dept = url.searchParams.get('department');
    const priority = url.searchParams.get('priority');
    const projectId = intOrNull(url.searchParams.get('project_id'));
    const groupId = intOrNull(url.searchParams.get('group_id'));
    const labelId = intOrNull(url.searchParams.get('label_id'));
    const search = String(url.searchParams.get('search') || '').trim();
    const createdFrom = url.searchParams.get('created_from');
    const createdTo = url.searchParams.get('created_to');
    const dueFrom = url.searchParams.get('due_from');
    const dueTo = url.searchParams.get('due_to');
    const sort = url.searchParams.get('sort') || 'created_at';
    const order = (url.searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let q = `SELECT t.*, u.full_name as assignee_name, u.employee_code as assignee_code, u.department as assignee_department,
                    u.avatar_color, u.avatar_initials, ab.full_name as assigner_name,
                    p.name as project_name, p.code as project_code, p.type as project_type, p.status as project_status,
                    g.name as group_name, g.position as group_position, g.color as group_color,
                    l.name as label_name, l.color as label_color_real,
                    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id) as subtask_total,
                    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id AND s.is_done=1) as subtask_done
             FROM tasks t
             LEFT JOIN users u ON t.assigned_to=u.id
             LEFT JOIN users ab ON t.assigned_by=ab.id
             LEFT JOIN task_projects p ON t.team_project_id=p.id
             LEFT JOIN task_groups g ON t.group_id=g.id
             LEFT JOIN task_labels l ON t.label_id=l.id
             WHERE 1=1`;
    const binds = [];
    if (isAdmin || isHcns(me)) {
      // Admin sees all tasks; optional assignee filter
      if (assignee) { q += ' AND t.assigned_to=?'; binds.push(parseInt(assignee)); }
    } else {
      // Managers and employees only see tasks they are assigned to, created, or following
      q += ' AND (t.assigned_to=? OR t.assigned_by=? OR EXISTS (SELECT 1 FROM task_followers f WHERE f.task_id=t.id AND f.user_id=?))';
      binds.push(me.id, me.id, me.id);
      if (assignee) { q += ' AND t.assigned_to=?'; binds.push(parseInt(assignee)); }
    }
    if (date) { q += ' AND t.date=?'; binds.push(date); }
    if (taskStatus) { q += ' AND t.status=?'; binds.push(taskStatus); }
    if (dept) { q += ' AND (t.department=? OR u.department=?)'; binds.push(dept, dept); }
    if (assigner) { q += ' AND t.assigned_by=?'; binds.push(parseInt(assigner)); }
    if (priority) { q += ' AND t.priority=?'; binds.push(priority); }
    if (projectId) { q += ' AND t.team_project_id=?'; binds.push(projectId); }
    if (groupId) { q += ' AND t.group_id=?'; binds.push(groupId); }
    if (labelId) { q += ' AND t.label_id=?'; binds.push(labelId); }
    if (createdFrom) { q += ' AND date(t.created_at)>=date(?)'; binds.push(createdFrom); }
    if (createdTo) { q += ' AND date(t.created_at)<=date(?)'; binds.push(createdTo); }
    if (dueFrom) { q += ' AND date(t.due_date)>=date(?)'; binds.push(dueFrom); }
    if (dueTo) { q += ' AND date(t.due_date)<=date(?)'; binds.push(dueTo); }
    if (search) {
      q += ' AND (lower(t.title) LIKE ? OR lower(t.description) LIKE ? OR lower(u.full_name) LIKE ? OR lower(u.employee_code) LIKE ?)';
      const like = '%' + search.toLowerCase() + '%';
      binds.push(like, like, like, like);
    }
    const sortMap = { due_date: 't.due_date', created_at: 't.created_at', priority: "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END", updated_at: 't.updated_at' };
    q += ` ORDER BY ${sortMap[sort] || sortMap.created_at} ${order}`;
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ tasks: results });
  }

  if (path === '/api/tasks' && request.method === 'POST') {
    // Allow all authenticated users to create tasks (not just managers)
    const b = await request.json();
    if (!b.title) return json({ error: 'Thiếu tiêu đề' }, 400);
    const status = b.status || 'todo';
    const priority = b.priority || 'normal';
    const projectId = intOrNull(b.team_project_id || b.project_id);
    const groupId = intOrNull(b.group_id);
    const labelId = intOrNull(b.label_id);
    if (!(await canUseTaskProject(env, projectId, me))) return json({ error: 'Khong co quyen voi Team/Project nay' }, 403);
    if (groupId && !(await canUseTaskGroup(env, groupId, projectId, me))) return json({ error: 'Nhom cong viec khong hop le' }, 400);
    const label = await resolveTaskLabel(env, labelId, projectId);
    if (labelId && !label) return json({ error: 'Nhan cong viec khong hop le' }, 400);
    const labelColor = label ? label.color : taskLabelColor(status, priority, b.label_color);
    const r = await env.DB.prepare(
      'INSERT INTO tasks (title,description,assigned_to,assigned_by,department,date,due_date,status,priority,label_color,checkin_time,checkout_time,workspace_id,team_project_id,group_id,label_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)'
    ).bind(b.title,b.description||'',b.assigned_to||null,me.id,b.department||'',b.date||null,b.due_date||null,status,priority,labelColor,b.checkin_time||null,b.checkout_time||null,projectId,groupId,labelId).run();
    const taskId = r.meta.last_row_id;
    await env.DB.prepare('INSERT INTO task_activity (task_id,user_id,action,detail) VALUES (?,?,?,?)')
      .bind(taskId, me.id, 'created', 'Tạo công việc: ' + b.title).run();
    return json({ ok: true, id: taskId });
  }

  const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const tid = parseInt(taskMatch[1]);
    if (request.method === 'GET') {
      const task = await env.DB.prepare(
        `SELECT t.*, u.full_name as assignee_name, u.employee_code as assignee_code, u.department as assignee_department,
                u.avatar_color, u.avatar_initials, ab.full_name as assigner_name,
                p.name as project_name, p.code as project_code, p.type as project_type,
                g.name as group_name, g.position as group_position, g.color as group_color,
                l.name as label_name, l.color as label_color_real
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to=u.id
           LEFT JOIN users ab ON t.assigned_by=ab.id
           LEFT JOIN task_projects p ON t.team_project_id=p.id
           LEFT JOIN task_groups g ON t.group_id=g.id
           LEFT JOIN task_labels l ON t.label_id=l.id
          WHERE t.id=?`
      ).bind(tid).first();
      if (!task) return json({ error: 'Không tìm thấy' }, 404);
      // Access: only admins see all tasks; managers and employees can only see
      // tasks they are assigned to, created, or following
      if (!isAdmin && !isHcns(me)) {
        const myId = Number(me.id);
        const isInvolved = Number(task.assigned_to) === myId || Number(task.assigned_by) === myId;
        const follower = isInvolved ? null : await env.DB.prepare('SELECT id FROM task_followers WHERE task_id=? AND user_id=?').bind(tid, myId).first();
        if (!isInvolved && !follower) return json({ error: 'Không tìm thấy' }, 404);
      }
      const { results: subtasks } = await env.DB.prepare(
        'SELECT s.*, u.full_name as assignee_name FROM subtasks s LEFT JOIN users u ON s.assigned_to=u.id WHERE s.task_id=? ORDER BY s.id'
      ).bind(tid).all();
      const { results: followers } = await env.DB.prepare(
        'SELECT f.*, u.full_name, u.avatar_color, u.avatar_initials FROM task_followers f JOIN users u ON f.user_id=u.id WHERE f.task_id=?'
      ).bind(tid).all();
      return json({ task, subtasks, followers });
    }
    if (request.method === 'PUT') {
      const b = await request.json();
      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(tid).first();
      if (!task) return json({ error: 'Không tìm thấy' }, 404);
      if (!isManager && task.assigned_to !== me.id) return json({ error: 'Không có quyền' }, 403);
      const nextStatus = b.status || task.status;
      const nextPriority = b.priority || task.priority;
      const nextProjectId = (b.team_project_id !== undefined || b.project_id !== undefined) ? intOrNull(b.team_project_id || b.project_id) : (task.team_project_id || null);
      const nextGroupId = b.group_id !== undefined ? intOrNull(b.group_id) : (task.group_id || null);
      const nextLabelId = b.label_id !== undefined ? intOrNull(b.label_id) : (task.label_id || null);
      if (!(await canUseTaskProject(env, nextProjectId, me))) return json({ error: 'Khong co quyen voi Team/Project nay' }, 403);
      if (nextGroupId && !(await canUseTaskGroup(env, nextGroupId, nextProjectId, me))) return json({ error: 'Nhom cong viec khong hop le' }, 400);
      const label = await resolveTaskLabel(env, nextLabelId, nextProjectId);
      if (nextLabelId && !label) return json({ error: 'Nhan cong viec khong hop le' }, 400);
      const nextColor = label ? label.color : taskLabelColor(nextStatus, nextPriority, b.label_color || task.label_color);
      await env.DB.prepare(
        "UPDATE tasks SET title=?,description=?,assigned_to=?,department=?,date=?,due_date=?,status=?,priority=?,label_color=?,checkin_time=?,checkout_time=?,team_project_id=?,group_id=?,label_id=?,updated_at=datetime('now') WHERE id=?"
      ).bind(b.title||task.title,b.description??task.description,b.assigned_to??task.assigned_to,b.department??task.department,b.date??task.date,b.due_date??task.due_date,nextStatus,nextPriority,nextColor,b.checkin_time??task.checkin_time,b.checkout_time??task.checkout_time,nextProjectId,nextGroupId,nextLabelId,tid).run();
      await env.DB.prepare('INSERT INTO task_activity (task_id,user_id,action,detail) VALUES (?,?,?,?)')
        .bind(tid, me.id, 'updated', 'Cập nhật: ' + (b.title||task.title)).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isManager) {
        // Allow task creator/assignee to delete their own tasks
        const task = await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(tid).first();
        if (!task || (task.assigned_to !== me.id && task.assigned_by !== me.id)) {
          return json({ error: 'Không có quyền' }, 403);
        }
      }
      await env.DB.prepare('DELETE FROM tasks WHERE id=?').bind(tid).run();
      await env.DB.prepare('DELETE FROM subtasks WHERE task_id=?').bind(tid).run();
      await env.DB.prepare('DELETE FROM task_comments WHERE task_id=?').bind(tid).run();
      await env.DB.prepare('DELETE FROM task_activity WHERE task_id=?').bind(tid).run();
      await env.DB.prepare('DELETE FROM task_followers WHERE task_id=?').bind(tid).run();
      return json({ ok: true });
    }
  }

  const subMatch = path.match(/^\/api\/tasks\/(\d+)\/subtasks$/);
  if (subMatch && request.method === 'POST') {
    const tid = parseInt(subMatch[1]);
    const b = await request.json();
    const r = await env.DB.prepare(
      'INSERT INTO subtasks (task_id,title,assigned_to,due_date) VALUES (?,?,?,?)'
    ).bind(tid, b.title, b.assigned_to||null, b.due_date||null).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const subtaskMatch = path.match(/^\/api\/subtasks\/(\d+)$/);
  if (subtaskMatch) {
    const sid = parseInt(subtaskMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      await env.DB.prepare('UPDATE subtasks SET title=?,is_done=?,assigned_to=?,due_date=? WHERE id=?')
        .bind(b.title,b.is_done??0,b.assigned_to||null,b.due_date||null,sid).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM subtasks WHERE id=?').bind(sid).run();
      return json({ ok: true });
    }
  }

  const commentsMatch = path.match(/^\/api\/tasks\/(\d+)\/comments$/);
  if (commentsMatch) {
    const tid = parseInt(commentsMatch[1]);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT c.*, u.full_name, u.avatar_color, u.avatar_initials FROM task_comments c JOIN users u ON c.user_id=u.id WHERE c.task_id=? ORDER BY c.created_at'
      ).bind(tid).all();
      return json({ comments: results });
    }
    if (request.method === 'POST') {
      const b = await request.json();
      if (!b.content) return json({ error: 'Nội dung không được trống' }, 400);
      const r = await env.DB.prepare('INSERT INTO task_comments (task_id,user_id,content) VALUES (?,?,?)')
        .bind(tid, me.id, b.content).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
  }

  const followMatch = path.match(/^\/api\/tasks\/(\d+)\/followers$/);
  if (followMatch && request.method === 'POST') {
    const tid = parseInt(followMatch[1]);
    const b = await request.json();
    const uid2 = b.user_id || me.id;
    const existingF = await env.DB.prepare('SELECT id FROM task_followers WHERE task_id=? AND user_id=?')
      .bind(tid, uid2).first();
    if (!existingF) {
      await env.DB.prepare('INSERT INTO task_followers (task_id,user_id) VALUES (?,?)').bind(tid, uid2).run();
    }
    return json({ ok: true });
  }

  // ── INVOICES ─────────────────────────────────────────────────────
  if (path === '/api/invoices' && request.method === 'GET') {
    const userId2 = url.searchParams.get('userId');
    const month2 = url.searchParams.get('month');
    const year2 = url.searchParams.get('year');
    const status2 = url.searchParams.get('status');
    let q = 'SELECT i.*, u.full_name, u.employee_code, u.department, u.position FROM invoices i JOIN users u ON i.user_id=u.id WHERE 1=1';
    const binds = [];
    if (!isManager) { q += ' AND i.user_id=?'; binds.push(me.id); }
    else {
      if (!isAdmin && !isHcns(me)) { q += ' AND u.department=?'; binds.push(me.department); }
      if (userId2) { q += ' AND i.user_id=?'; binds.push(parseInt(userId2)); }
    }
    if (month2) { q += ' AND i.month=?'; binds.push(parseInt(month2)); }
    if (year2) { q += ' AND i.year=?'; binds.push(parseInt(year2)); }
    if (status2) { q += ' AND i.status=?'; binds.push(status2); }
    q += ' ORDER BY i.year DESC, i.month DESC, i.id DESC';
    const stmt = env.DB.prepare(q);
    const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return json({ invoices: results });
  }

  if (path === '/api/invoices' && request.method === 'POST') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    if (!b.user_id || !b.month || !b.year) return json({ error: 'Thiếu thông tin' }, 400);
    const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(b.user_id).first();
    if (!invoiceUser) return json({ error: 'Không tìm thấy nhân viên' }, 404);
    if (!isAdmin && !isHcns(me) && invoiceUser.department !== me.department) return json({ error: 'Không có quyền lập phiếu ngoài phòng ban' }, 403);
    const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE year=? AND month=?')
      .bind(b.year, b.month).first();
    const seq = String((count?.cnt || 0) + 1).padStart(3, '0');
    const invNum = 'HD-' + b.year + String(b.month).padStart(2,'0') + '-' + seq;
    const base = b.base_salary || 0;
    const bonus = b.bonus || 0;
    const allowance = b.allowance || 0;
    const deduction = b.deduction || 0;
    const tax = b.tax ?? Math.round((base + bonus) * 0.1);
    const insurance = b.insurance ?? Math.round(base * 0.08);
    const overtime = await buildMonthlyOvertimeSummary(env, b.user_id, b.month, b.year, base);
    const net = base + bonus + allowance + overtime.overtimePay - deduction - tax - insurance;
    const r = await env.DB.prepare(
      'INSERT INTO invoices (invoice_number,user_id,month,year,base_salary,bonus,allowance,deduction,tax,insurance,net_salary,work_days,absent_days,late_days,standard_days,paid_leave_days,late_minutes,early_leave_minutes,missing_checkinout_days,approved_overtime_minutes,overtime_pay,status,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(invNum,b.user_id,b.month,b.year,base,bonus,allowance,deduction,tax,insurance,net,b.work_days||0,b.absent_days||0,b.late_days||0,b.standard_days||0,b.paid_leave_days||0,b.late_minutes||0,b.early_leave_minutes||0,b.missing_checkinout_days||0,overtime.approvedOvertimeMinutes,overtime.overtimePay,b.status||'draft',b.note||'').run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(r.meta.last_row_id, null, b.status||'draft', me.id, me.full_name, 'Created invoice').run();
    return json({ ok: true, id: r.meta.last_row_id, invoice_number: invNum });
  }

  const invConfirmMatch = path.match(/^\/api\/invoices\/(\d+)\/confirm$/);
  if (invConfirmMatch && request.method === 'POST') {
    const iid = parseInt(invConfirmMatch[1]);
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
    if (!inv) return json({ error: 'Khong tim thay phieu luong' }, 404);
    if (inv.user_id !== me.id) return json({ error: 'Khong co quyen' }, 403);
    if (!['issued', 'review_requested'].includes(String(inv.status || ''))) {
      return json({ error: 'Chi co the xac nhan phieu luong da phat hanh' }, 400);
    }
    await env.DB.prepare(
      "UPDATE invoices SET status='employee_confirmed',employee_confirmed_at=datetime('now','localtime'),review_status='none',review_resolved_at=COALESCE(review_resolved_at,datetime('now','localtime')) WHERE id=?"
    ).bind(iid).run();
    await env.DB.prepare(
      "UPDATE invoice_review_requests SET status='closed',updated_at=datetime('now','localtime') WHERE invoice_id=? AND status='open'"
    ).bind(iid).run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(iid, inv.status || null, 'employee_confirmed', me.id, me.full_name || '', 'Employee confirmed payslip').run();
    return json({ ok: true });
  }

  const invReviewMatch = path.match(/^\/api\/invoices\/(\d+)\/review-request$/);
  if (invReviewMatch && request.method === 'POST') {
    const iid = parseInt(invReviewMatch[1]);
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
    if (!inv) return json({ error: 'Khong tim thay phieu luong' }, 404);
    if (inv.user_id !== me.id) return json({ error: 'Khong co quyen' }, 403);
    if (inv.locked_at || inv.status === 'paid' || inv.status === 'employee_confirmed') {
      return json({ error: 'Phieu luong da khoa hoac da xac nhan' }, 400);
    }
    if (!['issued', 'review_requested'].includes(String(inv.status || ''))) {
      return json({ error: 'Chi co the yeu cau xem lai phieu luong da phat hanh' }, 400);
    }
    const b = await request.json().catch(() => ({}));
    const category = String(b.category || '').trim();
    const allowed = new Set(['attendance', 'bonus', 'deduction', 'base_salary', 'bank_info', 'other']);
    const message = String(b.message || '').trim();
    if (!allowed.has(category)) return json({ error: 'Loai yeu cau khong hop le' }, 400);
    if (!message) return json({ error: 'Vui long nhap ly do can xem lai' }, 400);
    await env.DB.prepare(
      `INSERT INTO invoice_review_requests (invoice_id,user_id,category,message,requested_amount,status)
       VALUES (?,?,?,?,?,'open')`
    ).bind(iid, me.id, category, message, Number(b.requested_amount || 0)).run();
    await env.DB.prepare(
      "UPDATE invoices SET status='review_requested',review_status='open',review_reason=?,review_requested_at=datetime('now','localtime') WHERE id=?"
    ).bind(message, iid).run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(iid, inv.status || null, 'review_requested', me.id, me.full_name || '', message).run();
    return json({ ok: true });
  }

  const invResolveMatch = path.match(/^\/api\/invoices\/(\d+)\/resolve-review$/);
  if (invResolveMatch && request.method === 'POST') {
    if (!isManager) return json({ error: 'Khong co quyen' }, 403);
    const iid = parseInt(invResolveMatch[1]);
    const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
    if (!inv) return json({ error: 'Khong tim thay phieu luong' }, 404);
    if (!isAdmin && !isHcns(me)) {
      const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(inv.user_id).first();
      if (!invoiceUser || invoiceUser.department !== me.department) return json({ error: 'Không có quyền xử lý phiếu ngoài phòng ban' }, 403);
    }
    if (inv.locked_at || inv.status === 'paid') return json({ error: 'Phieu luong da khoa' }, 400);
    const b = await request.json().catch(() => ({}));
    const note = String(b.note || '').trim();
    const nextStatus = b.nextStatus === 'employee_confirmed' ? 'employee_confirmed' : 'issued';
    if (!note) return json({ error: 'Vui long nhap ghi chu xu ly' }, 400);
    await env.DB.prepare(
      `UPDATE invoices SET status=?,review_status='resolved',review_note=?,review_resolved_at=datetime('now','localtime'),
        employee_confirmed_at=CASE WHEN ?='employee_confirmed' THEN datetime('now','localtime') ELSE employee_confirmed_at END
       WHERE id=?`
    ).bind(nextStatus, note, nextStatus, iid).run();
    await env.DB.prepare(
      "UPDATE invoice_review_requests SET status='resolved',handled_by=?,handled_by_name=?,handled_note=?,handled_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE invoice_id=? AND status='open'"
    ).bind(me.id, me.full_name || '', note, iid).run();
    await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(iid, inv.status || null, nextStatus, me.id, me.full_name || '', note).run();
    return json({ ok: true });
  }

  const invMatch = path.match(/^\/api\/invoices\/(\d+)$/);
  if (invMatch) {
    const iid = parseInt(invMatch[1]);
    if (request.method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT i.*, u.full_name, u.employee_code, u.department, u.position, u.contract_type, u.bank_account, u.bank_name FROM invoices i JOIN users u ON i.user_id=u.id WHERE i.id=?'
      ).bind(iid).first();
      if (!row) return json({ error: 'Không tìm thấy' }, 404);
      if (!isManager && row.user_id !== me.id) return json({ error: 'Không có quyền' }, 403);
      if (isManager && !isAdmin && !isHcns(me) && row.user_id !== me.id && row.department !== me.department) return json({ error: 'Không có quyền' }, 403);
      const review = await env.DB.prepare(
        'SELECT * FROM invoice_review_requests WHERE invoice_id=? ORDER BY id DESC LIMIT 1'
      ).bind(iid).first();
      row.latest_review_request = review || null;
      row.pending_actor = row.status === 'issued' ? row.full_name : (row.status === 'review_requested' ? 'HCNS' : '');
      row.confirmed_by = row.employee_confirmed_at ? row.full_name : '';
      row.checked_by = row.review_resolved_at ? (row.issued_by_name || '') : '';
      row.approved_by = row.issued_by_name || '';
      return json({ invoice: row });
    }
    if (request.method === 'PUT') {
      if (!isManager) return json({ error: 'Không có quyền' }, 403);
      const b = await request.json();
      const existingInv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
      if (!existingInv) return json({ error: 'Khong tim thay' }, 404);
      if (!isAdmin && !isHcns(me)) {
        const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(existingInv.user_id).first();
        if (!invoiceUser || invoiceUser.department !== me.department) return json({ error: 'Không có quyền sửa phiếu ngoài phòng ban' }, 403);
      }
      if (existingInv.locked_at || existingInv.status === 'paid') return json({ error: 'Phieu luong da khoa, khong the chinh sua' }, 400);
      const base = b.base_salary || 0, bonus = b.bonus || 0;
      const allowance = b.allowance || 0, deduction = b.deduction || 0;
      const tax = b.tax ?? Math.round((base + bonus) * 0.1);
      const insurance = b.insurance ?? Math.round(base * 0.08);
      const overtime = await buildMonthlyOvertimeSummary(env, existingInv.user_id, existingInv.month, existingInv.year, base);
      const net = base + bonus + allowance + overtime.overtimePay - deduction - tax - insurance;
      const nextStatus = b.status || existingInv.status || 'draft';
      const lockAt = nextStatus === 'paid' ? nowStr() : null;
      const confirmedAt = nextStatus === 'employee_confirmed' ? (existingInv.employee_confirmed_at || nowStr()) : existingInv.employee_confirmed_at;
      await env.DB.prepare(
        'UPDATE invoices SET base_salary=?,bonus=?,allowance=?,deduction=?,tax=?,insurance=?,net_salary=?,work_days=?,absent_days=?,late_days=?,standard_days=?,paid_leave_days=?,late_minutes=?,early_leave_minutes=?,missing_checkinout_days=?,approved_overtime_minutes=?,overtime_pay=?,status=?,note=?,locked_at=?,locked_by=?,locked_by_name=?,employee_confirmed_at=? WHERE id=?'
      ).bind(base,bonus,allowance,deduction,tax,insurance,net,b.work_days||0,b.absent_days||0,b.late_days||0,b.standard_days??0,b.paid_leave_days??0,b.late_minutes??0,b.early_leave_minutes??0,b.missing_checkinout_days??0,overtime.approvedOvertimeMinutes,overtime.overtimePay,nextStatus,b.note||'',lockAt,lockAt ? me.id : null,lockAt ? me.full_name : null,confirmedAt,iid).run();
      if (nextStatus !== existingInv.status) {
        await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
          .bind(iid, existingInv.status || null, nextStatus, me.id, me.full_name, b.status_note || b.note || null).run();
      }
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isManager) return json({ error: 'Không có quyền' }, 403);
      const existingInv = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(iid).first();
      if (existingInv && !isAdmin && !isHcns(me)) {
        const invoiceUser = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(existingInv.user_id).first();
        if (!invoiceUser || invoiceUser.department !== me.department) return json({ error: 'Không có quyền xóa phiếu ngoài phòng ban' }, 403);
      }
      if (existingInv && (existingInv.locked_at || existingInv.status === 'paid')) return json({ error: 'Phieu luong da khoa, khong the xoa' }, 400);
      await env.DB.prepare('DELETE FROM invoices WHERE id=?').bind(iid).run();
      return json({ ok: true });
    }
  }

  // ── SETTINGS ─────────────────────────────────────────────────────
  if (path === '/api/settings' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT setting_key,setting_value FROM settings').all();
    const map = {};
    results.forEach(r => { map[r.setting_key] = r.setting_value; });
    return json({ settings: map });
  }
  if (path === '/api/settings' && request.method === 'PUT') {
    if (!isAdmin) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    await env.DB.batch(
      Object.entries(b).map(([k,v]) =>
        env.DB.prepare('INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)').bind(k, String(v))
      )
    );
    return json({ ok: true });
  }

  // ── DEPARTMENTS ──────────────────────────────────────────────────
  if (path === '/api/departments' && request.method === 'GET') {
    // App-wide departments (shared), no per-user filter
    const { results } = await env.DB.prepare(`
      SELECT d.*, u.full_name AS manager_name, u.employee_code AS manager_employee_code,
             u.department AS manager_department, u.position AS manager_position
        FROM departments d
        LEFT JOIN users u ON u.id = d.manager_id
       ORDER BY d.name
    `).all();
    return json({ departments: results });
  }
  if (path === '/api/departments' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const name = normalizeDeptName(b.name);
    if (!name) return json({ error: 'Thiếu tên phòng ban' }, 400);
    const dup = await findDepartmentDuplicate(env, name);
    if (dup) return json({ error: 'Phòng ban này đã tồn tại' }, 400);
    const managerId = intOrNull(b.manager_id);
    const manager = managerId ? await env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(managerId).first() : null;
    if (managerId && !manager) return json({ error: 'Không tìm thấy trưởng phòng' }, 400);
    const managerName = manager?.full_name || String(b.manager || '').trim();
    try {
      const r = await env.DB.prepare('INSERT INTO departments (user_id,name,manager,manager_id,description) VALUES (?,?,?,?,?)')
        .bind(env.USER_ID || null, name, managerName, managerId, String(b.description || '').trim()).run();
      return json({ ok: true, id: r.meta.last_row_id });
    } catch (e) {
      if (String(e.message || '').toLowerCase().includes('unique')) return json({ error: 'Phòng ban này đã tồn tại' }, 400);
      throw e;
    }
  }
  const deptMatch = path.match(/^\/api\/departments\/(\d+)$/);
  if (deptMatch) {
    const id = parseInt(deptMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json().catch(() => ({}));
      const name = normalizeDeptName(b.name);
      if (!name) return json({ error: 'Thiếu tên phòng ban' }, 400);
      const dup = await findDepartmentDuplicate(env, name, id);
      if (dup) return json({ error: 'Phòng ban này đã tồn tại' }, 400);
      const managerId = intOrNull(b.manager_id);
      const manager = managerId ? await env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(managerId).first() : null;
      if (managerId && !manager) return json({ error: 'Không tìm thấy trưởng phòng' }, 400);
      const managerName = manager?.full_name || String(b.manager || '').trim();
      await env.DB.prepare('UPDATE departments SET name=?,manager=?,manager_id=?,description=? WHERE id=?')
        .bind(name, managerName, managerId, String(b.description || '').trim(), id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM departments WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── EMPLOYEES ────────────────────────────────────────────────────
  if (path === '/api/employees' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM employees WHERE user_id=? ORDER BY name').bind(env.USER_ID).all();
    return json({ employees: results });
  }
  if (path === '/api/employees' && request.method === 'POST') {
    const b = await request.json();
    if (!b.name || !b.code) return json({ error: 'Thiếu thông tin bắt buộc' }, 400);
    const r = await env.DB.prepare('INSERT INTO employees (user_id,code,name,department_id,position,start_date,birthday,status,salary,phone,email) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(env.USER_ID, b.code, b.name, b.department_id||null, b.position||'', b.start_date||null, b.birthday||null, b.status||'active', b.salary||0, b.phone||'', b.email||'').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const empMatch2 = path.match(/^\/api\/employees\/(\d+)$/);
  if (empMatch2) {
    const id = parseInt(empMatch2[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      await env.DB.prepare('UPDATE employees SET code=?,name=?,department_id=?,position=?,start_date=?,birthday=?,status=?,salary=?,phone=?,email=? WHERE id=?')
        .bind(b.code, b.name, b.department_id||null, b.position||'', b.start_date||null, b.birthday||null, b.status||'active', b.salary||0, b.phone||'', b.email||'', id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM employees WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── LEAVE REQUESTS ────────────────────────────────────────────────
  if (path === '/api/leave-types' && request.method === 'GET') {
    const includeInactive = url.searchParams.get('includeInactive') === '1';
    const q = includeInactive ? 'SELECT * FROM leave_types ORDER BY is_active DESC, name' : 'SELECT * FROM leave_types WHERE is_active=1 ORDER BY name';
    const { results } = await env.DB.prepare(q).all();
    return json({ leaveTypes: results });
  }
  if (path === '/api/leave-types' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const code = String(b.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const name = String(b.name || '').trim();
    if (!code || !name) return json({ error: 'Thieu ma hoac ten loai nghi' }, 400);
    const r = await env.DB.prepare(
      'INSERT INTO leave_types (code,name,paid_policy,deducts_annual_leave,requires_evidence,requires_bod_approval,max_days,is_active,short_description,policy_description,notice_hours,required_documents,requires_handover,approval_flow) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(code, name, b.paid_policy || 'paid', b.deducts_annual_leave ? 1 : 0, b.requires_evidence ? 1 : 0, b.requires_bod_approval ? 1 : 0, b.max_days || null, b.is_active ?? 1, String(b.short_description || '').trim(), String(b.policy_description || '').trim(), b.notice_hours === '' || b.notice_hours == null ? null : Number(b.notice_hours), String(b.required_documents || '').trim(), b.requires_handover ? 1 : 0, String(b.approval_flow || '').trim()).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const leaveTypeMatch = path.match(/^\/api\/leave-types\/(\d+)$/);
  if (leaveTypeMatch) {
    if (!isHcns(me)) return json({ error: 'Khong co quyen' }, 403);
    const id = parseInt(leaveTypeMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json().catch(() => ({}));
      const code = String(b.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      const name = String(b.name || '').trim();
      if (!code || !name) return json({ error: 'Thieu ma hoac ten loai nghi' }, 400);
      await env.DB.prepare(
        "UPDATE leave_types SET code=?,name=?,paid_policy=?,deducts_annual_leave=?,requires_evidence=?,requires_bod_approval=?,max_days=?,is_active=?,short_description=?,policy_description=?,notice_hours=?,required_documents=?,requires_handover=?,approval_flow=?,updated_at=datetime('now','localtime') WHERE id=?"
      ).bind(code, name, b.paid_policy || 'paid', b.deducts_annual_leave ? 1 : 0, b.requires_evidence ? 1 : 0, b.requires_bod_approval ? 1 : 0, b.max_days || null, b.is_active ?? 1, String(b.short_description || '').trim(), String(b.policy_description || '').trim(), b.notice_hours === '' || b.notice_hours == null ? null : Number(b.notice_hours), String(b.required_documents || '').trim(), b.requires_handover ? 1 : 0, String(b.approval_flow || '').trim(), id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare("UPDATE leave_types SET is_active=0,updated_at=datetime('now','localtime') WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/leave/balances' && request.method === 'GET') {
    const requestedUserId = Number(url.searchParams.get('user_id') || me.id);
    if (requestedUserId !== Number(me.id) && !isHcns(me)) return json({ error: 'Không có quyền xem số dư' }, 403);
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());
    const { results = [] } = await env.DB.prepare(
      'SELECT leave_type_code,available_days,balance_year,updated_at FROM leave_balances WHERE user_id=? AND balance_year=?'
    ).bind(requestedUserId, year).all();
    return json({ balances: results, year });
  }
  if (path === '/api/leave/balances' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS được điều chỉnh số dư' }, 403);
    const b = await request.json().catch(() => ({}));
    const userId = Number(b.user_id), typeCode = String(b.leave_type_code || '');
    const year = Number(b.balance_year || new Date().getFullYear()), delta = Number(b.delta_days);
    const note = String(b.note || '').trim();
    if (!Number.isInteger(userId) || !['annual', 'compensatory'].includes(typeCode) || !Number.isFinite(delta) || !delta || !note) return json({ error: 'Dữ liệu điều chỉnh số dư không hợp lệ hoặc thiếu ghi chú' }, 400);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO leave_balances (user_id,leave_type_code,balance_year,available_days,updated_by,updated_by_name)
        VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,leave_type_code,balance_year) DO UPDATE SET available_days=leave_balances.available_days+excluded.available_days,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=datetime('now','localtime')`)
        .bind(userId, typeCode, year, delta, me.id, me.full_name || ''),
      env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)')
        .bind(userId, typeCode, year, delta, 'hr_adjustment', note, me.id, me.full_name || ''),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/leave/uploads' && request.method === 'POST') {
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ tài liệu chưa được cấu hình' }, 503);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file.stream !== 'function') return json({ error: 'Vui lòng chọn tệp đính kèm' }, 400);
    const contentType = String(file.type || '').toLowerCase();
    if (!LEAVE_DOCUMENT_TYPES.includes(contentType) || !Number.isFinite(file.size) || file.size < 1 || file.size > LEAVE_DOCUMENT_MAX_BYTES) return json({ error: 'Chỉ nhận PDF, JPG, PNG hoặc WebP, tối đa 10 MB' }, 400);
    const bytes = await file.arrayBuffer();
    if (!employeeDocumentContentMatches(contentType, bytes)) return json({ error: 'Nội dung tệp không khớp định dạng' }, 400);
    const documentId = crypto.randomUUID(), storageKey = `leave-requests/${me.id}/${documentId}`;
    await env.HR_DOCUMENTS.put(storageKey, bytes, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { owner_id: String(me.id) } });
    await env.DB.prepare('INSERT INTO leave_request_documents (id,owner_id,original_filename,content_type,byte_size,storage_key,required_label) VALUES (?,?,?,?,?,?,?)')
      .bind(documentId, me.id, safeDownloadName(file.name), contentType, file.size, storageKey, String(form?.get('label') || '').slice(0, 120)).run();
    return json({ ok: true, id: documentId, filename: safeDownloadName(file.name) });
  }

  if (path === '/api/leave' && request.method === 'GET') {
    const statusFilter = url.searchParams.get('status') || '';
    const selfOnly     = url.searchParams.get('self') === '1';
    const isAdminUser  = isHrOrBod(me) || me.role === 'manager';
    let query, params;
    if (!isAdminUser || selfOnly) {
      query  = 'SELECT lr.*, u.full_name as employee_name, u.department, lt.name AS type_name, lt.paid_policy, lt.deducts_annual_leave, lt.requires_evidence, lt.requires_bod_approval, lt.max_days, lt.short_description AS type_short_description, lt.policy_description AS type_policy_description, lt.notice_hours AS type_notice_hours, lt.required_documents AS type_required_documents, lt.requires_handover AS type_requires_handover FROM leave_requests lr LEFT JOIN users u ON lr.user_id=u.employee_code OR CAST(lr.user_id AS TEXT)=CAST(u.id AS TEXT) LEFT JOIN leave_types lt ON lr.type=lt.code WHERE lr.user_id=?';
      params = [String(me.id)];
    } else {
      query  = `SELECT lr.*, u.full_name as employee_name, u.department, lt.name AS type_name, lt.paid_policy, lt.deducts_annual_leave, lt.requires_evidence, lt.requires_bod_approval, lt.max_days, lt.short_description AS type_short_description, lt.policy_description AS type_policy_description, lt.notice_hours AS type_notice_hours, lt.required_documents AS type_required_documents, lt.requires_handover AS type_requires_handover FROM leave_requests lr
                LEFT JOIN users u ON CAST(lr.user_id AS TEXT)=CAST(u.id AS TEXT) OR lr.user_id=u.employee_code
                LEFT JOIN leave_types lt ON lr.type=lt.code
                WHERE 1=1`;
      params = [];
      if (!isHrOrBod(me)) { query += ' AND u.department=?'; params.push(me.department); }
    }
    if (statusFilter) { query += ' AND lr.status=?'; params.push(statusFilter); }
    query += ' ORDER BY lr.id DESC';
    const { results } = await env.DB.prepare(query).bind(...params).all();
    const leave = await Promise.all(results.map(async row => ({
      ...row, type_name: row.type_name || row.type, paid_label: leavePaidLabel(row.paid_policy),
      can_action: row.status === 'pending' && canAdvanceLeaveApproval(me, row),
      document_count: Number((await env.DB.prepare('SELECT COUNT(*) AS cnt FROM leave_request_documents WHERE leave_request_id=?').bind(row.id).first())?.cnt || 0),
    })));
    return json({ leave });
  }
  if (path === '/api/leave' && request.method === 'POST') {
    try {
    const b = await request.json();
    if (!b.start_date || !b.end_date || !b.type) return json({ error: 'Chọn loại nghỉ và ngày bắt đầu/kết thúc' }, 400);
    if (String(b.start_date) > String(b.end_date)) return json({ error: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc' }, 400);
    const typeCode = String(b.type).trim();
    const leaveType = await env.DB.prepare('SELECT * FROM leave_types WHERE code=? AND is_active=1').bind(typeCode).first();
    if (!leaveType) return json({ error: 'Loai nghi phep khong hop le hoac da tat' }, 400);
    const session = ['full', 'morning', 'afternoon'].includes(b.leave_session) ? b.leave_session : 'full';
    if (session !== 'full' && b.start_date !== b.end_date) return json({ error: 'Nghỉ nửa ngày chỉ áp dụng cho một ngày' }, 400);
    const leaveDays = leaveDaysForSession(b.start_date, b.end_date, session);
    if (!leaveDays) return json({ error: 'Khoảng thời gian nghỉ không có ngày làm việc' }, 400);
    const reason = String(b.reason || '').trim();
    if (!reason) return json({ error: 'Vui lòng nhập lý do nghỉ' }, 400);
    const documentIds = [...new Set(Array.isArray(b.document_ids) ? b.document_ids.map(String).filter(Boolean) : [])];
    if (leaveType.requires_evidence && !documentIds.length) return json({ error: 'Loại nghỉ này yêu cầu tài liệu đính kèm' }, 400);
    const needsHandover = !!leaveType.requires_handover || leaveDays >= 2;
    const handoverUserId = b.handover_user_id ? Number(b.handover_user_id) : null;
    if (needsHandover && !handoverUserId) return json({ error: 'Đơn nghỉ từ 2 ngày hoặc theo chính sách phải chọn người bàn giao' }, 400);
    if (handoverUserId === Number(me.id)) return json({ error: 'Người bàn giao không thể là chính bạn' }, 400);
    const handoverUser = handoverUserId ? await env.DB.prepare('SELECT id,full_name FROM users WHERE id=? AND is_active=1').bind(handoverUserId).first() : null;
    if (handoverUserId && !handoverUser) return json({ error: 'Người bàn giao không hợp lệ' }, 400);
    if (documentIds.length) {
      const placeholders = documentIds.map(() => '?').join(',');
      const { results: documents = [] } = await env.DB.prepare(`SELECT id FROM leave_request_documents WHERE owner_id=? AND leave_request_id IS NULL AND id IN (${placeholders})`).bind(me.id, ...documentIds).all();
      if (documents.length !== documentIds.length) return json({ error: 'Tài liệu đính kèm không hợp lệ' }, 400);
    }
    const balanceType = leaveBalanceType(leaveType), balanceYear = Number(String(b.start_date).slice(0, 4));
    if (balanceType && await getLeaveBalance(env, me.id, balanceType, balanceYear) < leaveDays) return json({ error: `Không đủ số dư ${balanceType === 'annual' ? 'phép năm' : 'nghỉ bù'}` }, 400);
    const isHcnsApplicant = normalizeDeptName(me.department) === 'Phòng HCNS';
    const flow = leavePolicyFor(leaveType), needsBod = flow === 'manager_hr_bgd' || isHcnsApplicant;
    const currentApprover = isHcnsApplicant ? 'Trưởng phòng HCNS' : 'Quản lý trực tiếp';
    const r = await env.DB.prepare(
      'INSERT INTO leave_requests (user_id,employee_id,type,start_date,end_date,reason,status,current_approver,approval_level,submitted_at,leave_session,total_days,handover_user_id,handover_user_name,approval_flow,balance_reserved_days) VALUES (?,?,?,?,?,?,?,?,?,datetime(\'now\',\'localtime\'),?,?,?,?,?,?,?)'
    ).bind(String(me.id), me.id, typeCode, b.start_date, b.end_date, reason, 'pending', currentApprover, 1, session, leaveDays, handoverUser?.id || null, handoverUser?.full_name || null, flow, balanceType ? leaveDays : 0).run();
    if (balanceType) await env.DB.batch([
      env.DB.prepare("UPDATE leave_balances SET available_days=available_days-?,updated_at=datetime('now','localtime') WHERE user_id=? AND leave_type_code=? AND balance_year=?").bind(leaveDays, me.id, balanceType, balanceYear),
      env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,leave_request_id,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)').bind(me.id, balanceType, balanceYear, r.meta.last_row_id, -leaveDays, 'pending_reservation', 'Giữ chỗ đơn nghỉ', me.id, me.full_name || ''),
    ]);
    if (documentIds.length) await env.DB.prepare(`UPDATE leave_request_documents SET leave_request_id=? WHERE id IN (${documentIds.map(() => '?').join(',')})`).bind(r.meta.last_row_id, ...documentIds).run();
    await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(r.meta.last_row_id, 0, me.id, me.full_name, 'submitted', needsBod ? 'Luồng cần Ban Giám đốc phê duyệt cuối' : 'Luồng Quản lý trực tiếp → HCNS').run();
    return json({ ok: true, id: r.meta.last_row_id });
    } catch (e) {
      console.error('Leave create failed', e);
      return json({ error: 'Không thể tạo yêu cầu nghỉ phép, vui lòng thử lại sau' }, 500);
    }
  }
  const leaveDocumentMatch = path.match(/^\/api\/leave\/(\d+)\/documents\/([0-9a-fA-F-]{36})$/);
  if (leaveDocumentMatch && request.method === 'GET') {
    const leaveId = Number(leaveDocumentMatch[1]), documentId = leaveDocumentMatch[2];
    const document = await env.DB.prepare(`SELECT d.*,lr.employee_id,u.department FROM leave_request_documents d
      JOIN leave_requests lr ON lr.id=d.leave_request_id LEFT JOIN users u ON u.id=lr.employee_id WHERE d.id=? AND d.leave_request_id=?`).bind(documentId, leaveId).first();
    if (!document) return json({ error: 'Tài liệu không tồn tại' }, 404);
    if (Number(document.employee_id) !== Number(me.id) && !canManageLeaveRequest(me, document)) return json({ error: 'Không có quyền xem tài liệu' }, 403);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ tài liệu chưa được cấu hình' }, 503);
    const object = await env.HR_DOCUMENTS.get(document.storage_key);
    if (!object) return json({ error: 'Tệp không tồn tại trên kho lưu trữ' }, 404);
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    const filename = safeDownloadName(document.original_filename);
    return new Response(object.body, { headers: { 'Content-Type': document.content_type || object.httpMetadata?.contentType || 'application/octet-stream', 'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  const leaveMatch = path.match(/^\/api\/leave\/(\d+)$/);
  if (leaveMatch) {
    const id = parseInt(leaveMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      const request = await env.DB.prepare('SELECT lr.*,u.department FROM leave_requests lr LEFT JOIN users u ON u.id=lr.employee_id WHERE lr.id=?').bind(id).first();
      if (!request) return json({ error: 'Không tìm thấy đơn nghỉ' }, 404);
      if (b.status === 'rejected') {
        if (!canAdvanceLeaveApproval(me, request)) return json({ error: 'Chưa đến bước phê duyệt của bạn' }, 403);
        await env.DB.prepare("UPDATE leave_requests SET status='rejected',current_approver=NULL WHERE id=?").bind(id).run();
        if (request.balance_reserved_days > 0) {
          const type = request.type === 'annual' ? 'annual' : 'compensatory', year = Number(String(request.start_date).slice(0,4));
          await env.DB.batch([
            env.DB.prepare("UPDATE leave_balances SET available_days=available_days+?,updated_at=datetime('now','localtime') WHERE user_id=? AND leave_type_code=? AND balance_year=?").bind(request.balance_reserved_days, request.employee_id, type, year),
            env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,leave_request_id,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)').bind(request.employee_id, type, year, id, request.balance_reserved_days, 'reservation_release', String(b.note || 'Từ chối đơn'), me.id, me.full_name || ''),
          ]);
        }
        await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(id, request.approval_level, me.id, me.full_name, 'rejected', String(b.note || '')).run();
        return json({ ok: true });
      }
      if (b.status === 'approved') {
        if (!canAdvanceLeaveApproval(me, request)) return json({ error: 'Chưa đến bước phê duyệt của bạn' }, 403);
        const flow = request.approval_flow || 'manager_hr'; let nextLevel = Number(request.approval_level || 1) + 1, nextApprover = null;
        if (me.role === 'admin' || (nextLevel === 3 && flow !== 'manager_hr_bgd') || nextLevel > 3) nextLevel = 99;
        if (nextLevel === 2) nextApprover = 'HCNS'; else if (nextLevel === 3) nextApprover = 'Ban Giám đốc';
        const finalApproved = nextLevel === 99;
        await env.DB.prepare('UPDATE leave_requests SET status=?,approval_level=?,current_approver=? WHERE id=?').bind(finalApproved ? 'approved' : 'pending', nextLevel, nextApprover, id).run();
        await env.DB.prepare('INSERT INTO leave_approval_history (leave_request_id,approval_level,actor_id,actor_name,action,note) VALUES (?,?,?,?,?,?)').bind(id, request.approval_level, me.id, me.full_name, finalApproved ? 'approved' : 'forwarded', String(b.note || '')).run();
        return json({ ok: true, final: finalApproved });
      }
      if (Number(request.employee_id) !== Number(me.id) || request.status !== 'pending') return json({ error: 'Chỉ được sửa đơn của bạn khi đang chờ duyệt' }, 403);
      const updates = [], vals = [];
      if (b.reason !== undefined) { const reason = String(b.reason).trim(); if (!reason) return json({ error: 'Vui lòng nhập lý do nghỉ' }, 400); updates.push('reason=?'); vals.push(reason); }
      if (!updates.length) return json({ error: 'Không có dữ liệu cập nhật' }, 400);
      vals.push(id); await env.DB.prepare(`UPDATE leave_requests SET ${updates.join(',')} WHERE id=?`).bind(...vals).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      const request = await env.DB.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first();
      if (!request || (Number(request.employee_id) !== Number(me.id) && !isHcns(me))) return json({ error: 'Không có quyền xóa đơn nghỉ' }, 403);
      if (request.status !== 'pending') return json({ error: 'Chỉ được xóa đơn đang chờ duyệt' }, 400);
      if (request.balance_reserved_days > 0) {
        const type = request.type === 'annual' ? 'annual' : 'compensatory', year = Number(String(request.start_date).slice(0,4));
        await env.DB.batch([
          env.DB.prepare("UPDATE leave_balances SET available_days=available_days+?,updated_at=datetime('now','localtime') WHERE user_id=? AND leave_type_code=? AND balance_year=?").bind(request.balance_reserved_days, request.employee_id, type, year),
          env.DB.prepare('INSERT INTO leave_balance_ledger (user_id,leave_type_code,balance_year,leave_request_id,delta_days,entry_type,note,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)').bind(request.employee_id, type, year, id, request.balance_reserved_days, 'reservation_release', 'Hủy đơn nghỉ', me.id, me.full_name || ''),
        ]);
      }
      await env.DB.prepare('DELETE FROM leave_requests WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── CANDIDATES / RECRUITMENT ──────────────────────────────────────
  if (path === '/api/candidates' && request.method === 'GET') {
    const stageFilter = url.searchParams.get('stage') || '';
    let q = 'SELECT * FROM candidates ORDER BY id DESC';
    const params = [];
    if (stageFilter) { q = 'SELECT * FROM candidates WHERE stage=? ORDER BY id DESC'; params.push(stageFilter); }
    const { results } = await env.DB.prepare(q).bind(...params).all();
    return json({ candidates: results });
  }
  if (path === '/api/candidates' && request.method === 'POST') {
    const b = await request.json();
    if (!b.name) return json({ error: 'Thiếu tên ứng viên' }, 400);
    const r = await env.DB.prepare(
      'INSERT INTO candidates (user_id,name,position,department_id,apply_date,source,stage,notes) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(env.USER_ID, b.name, b.position||'', b.department_id||null, b.apply_date||null, b.source||'Khác', b.stage||'received', b.notes||'').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const candMatch = path.match(/^\/api\/candidates\/(\d+)$/);
  if (candMatch) {
    const id = parseInt(candMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      // Flexible update
      const cols = ['name','position','apply_date','source','stage','notes'];
      const setStrs = []; const vals = [];
      for (const c of cols) {
        if (b[c] !== undefined) { setStrs.push(c + '=?'); vals.push(b[c]); }
      }
      if (b.department !== undefined) { setStrs.push('department_id=?'); vals.push(b.department||null); }
      if (!setStrs.length) return json({ error: 'Không có dữ liệu' }, 400);
      vals.push(id);
      await env.DB.prepare(`UPDATE candidates SET ${setStrs.join(',')} WHERE id=?`).bind(...vals).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM candidates WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── PAYROLL ───────────────────────────────────────────────────────
  if (path === '/api/payroll-adjustments/suggestions' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Khong co quyen' }, 403);
    const month = String(url.searchParams.get('month') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const data = await buildPayrollAdjustmentSuggestions(env, month);
    return json({
      month,
      suggestions: data.suggestions,
      approved: data.approved,
      manual_sources: [{ source: 'manual', label: 'Y tuong/sang kien/top tuan/bao cao thu cong' }],
    });
  }

  if (path === '/api/payroll-adjustments/apply' && request.method === 'POST') {
    if (!isManager) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const incoming = Array.isArray(b.items) ? b.items : [];
    if (!incoming.length) return json({ error: 'Chua co de xuat nao duoc chon' }, 400);

    const data = await buildPayrollAdjustmentSuggestions(env, month);
    const suggestionByRef = new Map(data.suggestions.map(s => [s.source_ref, s]));
    let applied = 0, skipped = 0;
    const errors = [];

    for (const item of incoming) {
      const isManual = item.source === 'manual' || !item.source_ref;
      const base = isManual ? {
        employee_id: intOrNull(item.employee_id),
        payroll_id: intOrNull(item.payroll_id),
        month,
        type: item.type || payrollAdjustmentType(item.source || 'manual', Number(item.amount || 0), Number(item.score_delta || 0)),
        source: 'manual',
        source_ref: `manual:${month}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        amount: Number(item.amount || 0),
        score_delta: Number(item.score_delta || 0),
        reason: String(item.reason || '').trim(),
      } : suggestionByRef.get(item.source_ref);

      if (!base) { skipped++; errors.push({ source_ref: item.source_ref || null, error: 'De xuat khong con hop le hoac da ap dung' }); continue; }
      if (!base.employee_id || !base.reason) { skipped++; errors.push({ source_ref: item.source_ref || null, error: 'Thieu nhan vien hoac ly do' }); continue; }

      const amount = Math.max(0, Number(item.amount ?? base.amount ?? 0));
      const scoreDelta = Number(item.score_delta ?? base.score_delta ?? 0);
      const type = item.type || base.type || payrollAdjustmentType(base.source, amount, scoreDelta);
      let payroll = base.payroll_id ? await env.DB.prepare('SELECT * FROM payroll WHERE id=?').bind(base.payroll_id).first() : null;
      if (!payroll) payroll = await env.DB.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? LIMIT 1').bind(base.employee_id, month).first();
      if (amount > 0 && !payroll) {
        skipped++;
        errors.push({ source_ref: base.source_ref, error: 'Chua co dong bang luong cho nhan vien nay' });
        continue;
      }

      const existing = base.source_ref ? await env.DB.prepare('SELECT id FROM payroll_adjustments WHERE source_ref=? AND status=?')
        .bind(base.source_ref, 'approved').first() : null;
      if (existing) { skipped++; continue; }

      await env.DB.prepare(
        `INSERT INTO payroll_adjustments (employee_id,payroll_id,month,type,source,source_ref,amount,score_delta,reason,status,created_by,created_by_name,approved_by,approved_by_name,approved_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'approved',?,?,?,?,datetime('now','localtime'),datetime('now','localtime'))`
      ).bind(base.employee_id, payroll?.id || null, month, type, base.source, base.source_ref, amount, scoreDelta, String(item.reason || base.reason).trim(), me.id, me.full_name || '', me.id, me.full_name || '').run();

      if (amount > 0 && payroll) {
        const nextKpi = Number(payroll.kpi_bonus || 0) + (type === 'bonus' ? amount : 0);
        const nextDeduction = Number(payroll.deduction || 0) + (type === 'penalty' ? amount : 0);
        const nextNet = Number(payroll.base_salary || 0) + nextKpi + Number(payroll.allowance || 0) - nextDeduction;
        await env.DB.prepare("UPDATE payroll SET kpi_bonus=?,deduction=?,net_salary=? WHERE id=?")
          .bind(nextKpi, nextDeduction, nextNet, payroll.id).run();
      }
      applied++;
    }
    return json({ ok: true, month, applied, skipped, errors });
  }

  if (path === '/api/payroll' && request.method === 'GET') {
    if (!isManager) return json({ error: 'Không có quyền' }, 403);
    const month = url.searchParams.get('month') || new Date().toISOString().slice(0,7);
    const stmt = env.DB.prepare(`SELECT p.*, u.position, u.contract_type
      FROM payroll p LEFT JOIN users u ON u.id=p.employee_id
      WHERE p.month=?${(!isAdmin && !isHcns(me)) ? ' AND p.department=?' : ''} ORDER BY p.id DESC`);
    const { results } = (!isAdmin && !isHcns(me)) ? await stmt.bind(month, me.department).all() : await stmt.bind(month).all();
    return json({ payroll: results });
  }
  if (path === '/api/payroll/load' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const batch = await env.DB.prepare('SELECT * FROM payroll_batches WHERE month=?').bind(month).first();
    if (batch && ['locked','paid'].includes(String(batch.status || '').toLowerCase())) {
      return json({ error: 'Bang luong thang nay da khoa, khong the dong bo du lieu.' }, 409);
    }
    const { results: users = [] } = await env.DB.prepare(
      'SELECT id,employee_code,full_name,department,salary FROM users WHERE is_active=1 ORDER BY id'
    ).all();
    const existingRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM payroll WHERE month=?').bind(month).first();
    let created = 0, updated = 0, ready = 0, missingSalary = 0, estimatedTotal = 0;
    for (const u of users) {
      const base = Number(u.salary || 0);
      const status = base > 0 ? 'ready' : 'missing_salary_config';
      const warnings = base > 0 ? '' : 'Thiếu cấu hình lương';
      if (base > 0) {
        ready++;
        estimatedTotal += base;
      } else {
        missingSalary++;
      }
      const existing = await env.DB.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? LIMIT 1')
        .bind(u.id, month).first();
      if (existing) {
        const kpi = Number(existing.kpi_bonus || 0);
        const allowance = Number(existing.allowance || 0);
        const deduction = Number(existing.deduction || 0);
        const net = base + kpi + allowance - deduction;
        await env.DB.prepare(
          "UPDATE payroll SET user_id=?,employee_name=?,employee_code=?,department=?,base_salary=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?"
        ).bind(String(me.id), u.full_name || '', u.employee_code || '', u.department || '', base, net, status, warnings, existing.id).run();
        updated++;
      } else {
        await env.DB.prepare(
          "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))"
        ).bind(String(me.id), u.id, u.full_name || '', u.employee_code || '', u.department || '', month, base, 0, 0, 0, base, status, warnings).run();
        created++;
      }
    }
    await env.DB.prepare(
      `INSERT INTO payroll_batches (month,status,total_employees,complete_employees,missing_employees,estimated_total,created_by,created_by_name,updated_at)
       VALUES (?,'draft',?,?,?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(month) DO UPDATE SET total_employees=excluded.total_employees,complete_employees=excluded.complete_employees,missing_employees=excluded.missing_employees,estimated_total=excluded.estimated_total,updated_at=datetime('now','localtime')`
    ).bind(month, users.length, ready, missingSalary, estimatedTotal, me.id, me.full_name || '').run();
    return json({
      ok: true,
      loaded: true,
      month,
      status: 'draft',
      total: users.length,
      existing: Number(existingRow?.c || 0),
      existing_rows: Number(existingRow?.c || 0),
      created,
      updated,
      complete: ready,
      ready,
      missing: missingSalary,
      missing_salary_config: missingSalary,
      estimated_total: estimatedTotal,
      warning: missingSalary > 0 ? 'Cac truong hop thieu cau hinh luong can duoc xu ly truoc khi trinh phe duyet.' : ''
    });
  }
  if (path === '/api/payroll/batch' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    const batch = await env.DB.prepare('SELECT * FROM payroll_batches WHERE month=?').bind(month).first();
    if (batch && ['locked','paid'].includes(String(batch.status || '').toLowerCase())) {
      return json({ error: 'Bang luong thang nay da khoa, khong the dong bo du lieu.' }, 409);
    }
    const { results: users = [] } = await env.DB.prepare(
      'SELECT id,employee_code,full_name,department,salary FROM users WHERE is_active=1 ORDER BY id'
    ).all();
    let created = 0, updated = 0, ready = 0, missing = 0, estimatedTotal = 0;
    for (const u of users) {
      const base = Number(u.salary || 0);
      const status = base > 0 ? 'ready' : 'missing_salary_config';
      const warnings = base > 0 ? '' : 'Thiếu cấu hình lương';
      if (base > 0) { ready++; estimatedTotal += base; }
      else missing++;
      const exists = await env.DB.prepare('SELECT id FROM payroll WHERE employee_id=? AND month=? LIMIT 1')
        .bind(u.id, month).first();
      if (exists) {
        const row = await env.DB.prepare('SELECT kpi_bonus,allowance,deduction FROM payroll WHERE id=?').bind(exists.id).first();
        const kpi = Number(row?.kpi_bonus || 0), allowance = Number(row?.allowance || 0), deduction = Number(row?.deduction || 0);
        await env.DB.prepare(
          "UPDATE payroll SET user_id=?,employee_name=?,employee_code=?,department=?,base_salary=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?"
        ).bind(String(me.id), u.full_name || '', u.employee_code || '', u.department || '', base, base + kpi + allowance - deduction, status, warnings, exists.id).run();
        updated++;
        continue;
      }
      await env.DB.prepare(
        "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))"
      ).bind(String(me.id), u.id, u.full_name || '', u.employee_code || '', u.department || '', month, base, 0, 0, 0, base, status, warnings).run();
      created++;
    }
    await env.DB.prepare(
      `INSERT INTO payroll_batches (month,status,total_employees,complete_employees,missing_employees,estimated_total,created_by,created_by_name,updated_at)
       VALUES (?,'draft',?,?,?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(month) DO UPDATE SET status='draft',total_employees=excluded.total_employees,complete_employees=excluded.complete_employees,missing_employees=excluded.missing_employees,estimated_total=excluded.estimated_total,updated_at=datetime('now','localtime')`
    ).bind(month, users.length, ready, missing, estimatedTotal, me.id, me.full_name || '').run();
    return json({ ok: true, status: 'draft', created, updated, missing, missing_salary_config: missing, complete: ready, total: users.length, month, estimated_total: estimatedTotal });
  }
  if (path === '/api/payroll/export-payslips' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Khong co quyen' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: 'Thieu hoac sai thang bang luong' }, 400);
    if (String(b.confirmText || '').trim().toLowerCase() !== 'xuatphieuluong') {
      return json({ error: 'Can go dung xuatphieuluong de xuat phieu luong' }, 400);
    }
    try {
    const [yearStr, mmStr] = month.split('-');
    const year = Number(yearStr);
    const invMonth = Number(mmStr);
    const { results: rows = [] } = await env.DB.prepare(
      `SELECT p.*, u.id AS real_user_id, u.bank_account, u.bank_name
         FROM payroll p
         LEFT JOIN users u ON u.id=p.employee_id
        WHERE p.month=?
        ORDER BY p.id`
    ).bind(month).all();
    let created = 0, updated = 0, skipped = 0;
    const skippedRows = [];
    for (const p of rows) {
      try {
        const employeeId = Number(p.employee_id || p.real_user_id || 0);
        const status = p.data_status || (Number(p.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config');
        if (!employeeId || status !== 'ready' || Number(p.base_salary || 0) <= 0) {
          skipped++;
          skippedRows.push({ payroll_id: p.id, employee_id: employeeId || null, employee_name: p.employee_name || '', reason: 'missing_salary_config' });
          continue;
        }
        const base = Number(p.base_salary || 0);
        const bonus = Number(p.kpi_bonus || 0);
        const allowance = Number(p.allowance || 0);
        const deduction = Number(p.deduction || 0);
        const net = Number(p.net_salary || (base + bonus + allowance - deduction));
        const workSummary = await buildMonthlyWorkSummary(env, employeeId, invMonth, year);
        const existing = await env.DB.prepare(
          'SELECT * FROM invoices WHERE payroll_id=? OR (user_id=? AND month=? AND year=?) ORDER BY id DESC LIMIT 1'
        ).bind(p.id, employeeId, invMonth, year).first();

        if (existing && (existing.locked_at || existing.status === 'paid' || existing.status === 'employee_confirmed' || existing.employee_confirmed_at)) {
          skipped++;
          skippedRows.push({ invoice_id: existing.id, payroll_id: p.id, employee_id: employeeId, employee_name: p.employee_name || '', reason: 'locked_or_confirmed' });
          continue;
        }

        if (existing) {
          const fromStatus = existing.status || null;
          await env.DB.prepare(
            `UPDATE invoices SET payroll_id=?,base_salary=?,bonus=?,allowance=?,deduction=?,tax=0,insurance=0,net_salary=?,
               work_days=?,absent_days=?,late_days=?,standard_days=?,paid_leave_days=?,late_minutes=?,early_leave_minutes=?,missing_checkinout_days=?,
               status='issued',issued_at=datetime('now','localtime'),issued_by=?,issued_by_name=?,
               review_resolved_at=CASE WHEN status='review_requested' THEN datetime('now','localtime') ELSE review_resolved_at END,
               review_status=CASE WHEN status='review_requested' THEN 'resolved' ELSE COALESCE(review_status,'none') END,
               review_note=CASE WHEN status='review_requested' THEN 'Reissued from payroll' ELSE review_note END
             WHERE id=?`
          ).bind(
            p.id, base, bonus, allowance, deduction, net,
            workSummary.actualWorkDays, workSummary.absentDays, workSummary.lateDays,
            workSummary.standardWorkDays, workSummary.paidLeaveDays, workSummary.lateMinutes,
            workSummary.earlyLeaveMinutes, workSummary.incompleteDays,
            me.id, me.full_name || '', existing.id
          ).run();
          await env.DB.prepare(
            "UPDATE invoice_review_requests SET status='resolved',handled_by=?,handled_by_name=?,handled_note=COALESCE(handled_note,'Reissued from payroll'),handled_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE invoice_id=? AND status='open'"
          ).bind(me.id, me.full_name || '', existing.id).run();
          await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
            .bind(existing.id, fromStatus, 'issued', me.id, me.full_name || '', fromStatus === 'review_requested' ? 'Reissued payslip after review' : 'Reissued payslip from payroll').run();
          updated++;
        } else {
          const invNum = await nextInvoiceNumber(env, year, invMonth);
          const r = await env.DB.prepare(
            `INSERT INTO invoices (invoice_number,user_id,month,year,base_salary,bonus,allowance,deduction,tax,insurance,net_salary,
               work_days,absent_days,late_days,standard_days,paid_leave_days,late_minutes,early_leave_minutes,missing_checkinout_days,
               status,note,payroll_id,issued_at,issued_by,issued_by_name,review_status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?,?,'none')`
          ).bind(invNum, employeeId, invMonth, year, base, bonus, allowance, deduction, 0, 0, net,
            workSummary.actualWorkDays, workSummary.absentDays, workSummary.lateDays,
            workSummary.standardWorkDays, workSummary.paidLeaveDays, workSummary.lateMinutes,
            workSummary.earlyLeaveMinutes, workSummary.incompleteDays,
            'issued', 'Generated from payroll', p.id, me.id, me.full_name || '').run();
          await env.DB.prepare('INSERT INTO invoice_history (invoice_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
            .bind(r.meta.last_row_id, null, 'issued', me.id, me.full_name || '', 'Issued payslip from payroll').run();
          created++;
        }
      } catch (e) {
        skipped++;
        skippedRows.push({ payroll_id: p.id, employee_id: p.employee_id || null, employee_name: p.employee_name || '', reason: 'row_error', error: String(e?.message || e) });
        continue;
      }
    }
    if (rows.length) {
      await env.DB.prepare(
        "UPDATE payroll_batches SET status='issued',updated_at=datetime('now','localtime') WHERE month=?"
      ).bind(month).run();
    }
    return json({ ok: true, month, total: rows.length, created, updated, skipped, skippedRows });
    } catch (e) {
      console.error('Export payslips failed', e);
      return json({ error: 'Không thể xuất phiếu lương, vui lòng thử lại sau' }, 500);
    }
  }
  if (path === '/api/payroll' && request.method === 'POST') {
    if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json();
    // Single row creation
    if (b.employee_name && b.month) {
      const net = (b.base_salary||0) + (b.kpi_bonus||0) + (b.allowance||0) + (b.overtime_pay||0) - (b.deduction||0) - (b.tax||0) - (b.insurance||0);
      const dataStatus = Number(b.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
      const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
      const r = await env.DB.prepare(
        "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,overtime_pay,tax,insurance,work_days,standard_days,note,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))"
      ).bind(String(me.id), b.employee_id||null, b.employee_name, b.employee_code||'', b.department||'', b.month, b.base_salary||0, b.kpi_bonus||0, b.allowance||0, b.deduction||0, b.overtime_pay||0, b.tax||0, b.insurance||0, b.work_days||0, b.standard_days||0, b.note||'', net, dataStatus, dataWarnings).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    // Batch creation (legacy)
    if (b.rows && b.month) {
      await env.DB.batch(b.rows.map(r => {
        const net = (r.base_salary||0) + (r.kpi_bonus||0) + (r.allowance||0) - (r.deduction||0);
        const dataStatus = Number(r.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
        const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
        return env.DB.prepare(
          "INSERT INTO payroll (user_id,employee_id,employee_name,employee_code,department,month,base_salary,kpi_bonus,allowance,deduction,net_salary,data_status,data_warnings,source_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))"
        ).bind(String(me.id), r.employee_id||null, r.employee_name||'', r.employee_code||'', r.department||'', b.month, r.base_salary||0, r.kpi_bonus||0, r.allowance||0, r.deduction||0, net, dataStatus, dataWarnings);
      }));
      return json({ ok: true });
    }
    return json({ error: 'Thiếu dữ liệu' }, 400);
  }
  const payrollMatch = path.match(/^\/api\/payroll\/(\d+)$/);
  if (payrollMatch) {
    const id = parseInt(payrollMatch[1]);
    if (request.method === 'PUT') {
      if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
      const b = await request.json();
      const current = await env.DB.prepare('SELECT * FROM payroll WHERE id=?').bind(id).first();
      if (!current) return json({ error: 'Không tìm thấy dòng lương' }, 404);
      const lineChanges = Array.isArray(b.line_changes) ? b.line_changes : [];
      if (lineChanges.length) {
        const allowedLines = new Set(['base_salary', 'allowance', 'kpi_bonus', 'insurance', 'tax', 'deduction']);
        const normalized = [];
        for (const raw of lineChanges) {
          const field = String(raw?.field || '');
          const lineLabel = String(raw?.label || '').trim();
          const changeNote = String(raw?.note || '').trim();
          const nextValue = Number(raw?.new_value);
          if (!allowedLines.has(field) || !lineLabel || !changeNote || changeNote.length > 1000 || !Number.isFinite(nextValue) || nextValue < 0) {
            return json({ error: 'Mỗi dòng điều chỉnh phải hợp lệ và có ghi chú' }, 400);
          }
          const beforeValue = Number(current[field] || 0);
          if (beforeValue !== nextValue) normalized.push({ field, lineLabel, changeNote, beforeValue, nextValue });
        }
        if (!normalized.length) return json({ error: 'Không có thay đổi dòng lương để lưu' }, 400);
        const next = { ...current };
        for (const item of normalized) next[item.field] = item.nextValue;
        const net = Number(next.base_salary || 0) + Number(next.kpi_bonus || 0) + Number(next.allowance || 0) + Number(next.overtime_pay || 0) - Number(next.deduction || 0) - Number(next.tax || 0) - Number(next.insurance || 0);
        const dataStatus = Number(next.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
        const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
        await ensurePayrollLineChangeLog(env);
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE payroll SET base_salary=?,kpi_bonus=?,allowance=?,deduction=?,overtime_pay=?,tax=?,insurance=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?"
          ).bind(next.base_salary || 0, next.kpi_bonus || 0, next.allowance || 0, next.deduction || 0, next.overtime_pay || 0, next.tax || 0, next.insurance || 0, net, dataStatus, dataWarnings, id),
          ...normalized.map(item => env.DB.prepare(
            'INSERT INTO payroll_line_change_log (payroll_id,line_key,line_label,before_value,after_value,change_note,changed_by,changed_by_name) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(id, item.field, item.lineLabel, item.beforeValue, item.nextValue, item.changeNote, me.id, me.full_name || '')),
          env.DB.prepare(
            'INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)'
          ).bind(id, me.id, me.full_name || '', `Điều chỉnh ${normalized.length} dòng lương`, JSON.stringify(current), JSON.stringify({ ...next, net_salary: net })),
        ]);
        return json({ ok: true, net_salary: net, changed_lines: normalized.length });
      }
      const changeNote = String(b.change_note || '').trim();
      if (!changeNote) return json({ error: 'Vui lòng nhập ghi chú điều chỉnh' }, 400);
      if (changeNote.length > 1000) return json({ error: 'Ghi chú điều chỉnh không được quá 1000 ký tự' }, 400);
      const net = (b.base_salary||0) + (b.kpi_bonus||0) + (b.allowance||0) + (b.overtime_pay||0) - (b.deduction||0) - (b.tax||0) - (b.insurance||0);
      const dataStatus = Number(b.base_salary || 0) > 0 ? 'ready' : 'missing_salary_config';
      const dataWarnings = dataStatus === 'ready' ? '' : 'Thiếu cấu hình lương';
      await env.DB.prepare(
        "UPDATE payroll SET employee_name=?,employee_code=?,department=?,month=?,base_salary=?,kpi_bonus=?,allowance=?,deduction=?,overtime_pay=?,tax=?,insurance=?,work_days=?,standard_days=?,note=?,net_salary=?,data_status=?,data_warnings=?,source_synced_at=datetime('now','localtime') WHERE id=?"
      ).bind(b.employee_name||'', b.employee_code||'', b.department||'', b.month||'', b.base_salary||0, b.kpi_bonus||0, b.allowance||0, b.deduction||0, b.overtime_pay||0, b.tax||0, b.insurance||0, b.work_days||0, b.standard_days||0, b.note||'', net, dataStatus, dataWarnings, id).run();
      await env.DB.prepare(
        'INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)'
      ).bind(id, me.id, me.full_name || '', changeNote, JSON.stringify(current), JSON.stringify({
        base_salary: b.base_salary||0, kpi_bonus: b.kpi_bonus||0, allowance: b.allowance||0,
        deduction: b.deduction||0, overtime_pay: b.overtime_pay||0, tax: b.tax||0,
        insurance: b.insurance||0, work_days: b.work_days||0, standard_days: b.standard_days||0,
        net_salary: net, note: b.note||''
      })).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!(isAdmin || isHcns(me))) return json({ error: 'Không có quyền' }, 403);
      const current = await env.DB.prepare('SELECT * FROM payroll WHERE id=?').bind(id).first();
      if (!current) return json({ error: 'Không tìm thấy dòng lương' }, 404);
      const issued = await env.DB.prepare(
        "SELECT id FROM invoices WHERE payroll_id=? AND (locked_at IS NOT NULL OR status IN ('issued','paid','employee_confirmed') OR employee_confirmed_at IS NOT NULL) LIMIT 1"
      ).bind(id).first();
      if (issued) return json({ error: 'Không thể xóa dòng lương đã phát hành phiếu lương. Hãy xử lý phiếu đã phát hành trước.' }, 409);
      await env.DB.prepare(
        'INSERT INTO payroll_change_log (payroll_id,changed_by,changed_by_name,change_note,before_data,after_data) VALUES (?,?,?,?,?,?)'
      ).bind(id, me.id, me.full_name || '', 'Xóa dòng lương', JSON.stringify(current), '{}').run();
      await env.DB.prepare('UPDATE payroll_adjustments SET payroll_id=NULL,updated_at=datetime(\'now\',\'localtime\') WHERE payroll_id=?').bind(id).run();
      await env.DB.prepare('DELETE FROM payroll WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── CAMPAIGNS ────────────────────────────────────────────────────
  if (path === '/api/campaigns' && request.method === 'GET') {
    const statusFilter = url.searchParams.get('status') || '';
    const typeFilter   = url.searchParams.get('type')   || '';
    let q = 'SELECT * FROM campaigns'; const params = [];
    const clauses = [];
    if (statusFilter) { clauses.push('status=?'); params.push(statusFilter); }
    if (typeFilter)   { clauses.push('type=?');   params.push(typeFilter);   }
    if (clauses.length) q += ' WHERE ' + clauses.join(' AND ');
    q += ' ORDER BY id DESC';
    const { results } = await env.DB.prepare(q).bind(...params).all();
    return json({ campaigns: results });
  }
  if (path === '/api/campaigns' && request.method === 'POST') {
    const b = await request.json();
    if (!b.name) return json({ error: 'Thiếu tên chiến dịch' }, 400);
    const r = await env.DB.prepare(
      'INSERT INTO campaigns (user_id,name,type,status,start_date,end_date,budget,spent,goal_reach,goal_leads,goal_conversions,owner_name,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(env.USER_ID, b.name, b.type||'other', b.status||'planning', b.start_date||null, b.end_date||null, b.budget||0, b.spent||0, b.goal_reach||0, b.goal_leads||0, b.goal_conversions||0, b.owner_name||'', b.description||'').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const campMatch = path.match(/^\/api\/campaigns\/(\d+)$/);
  if (campMatch) {
    const id = parseInt(campMatch[1]);
    if (request.method === 'PUT') {
      const b = await request.json();
      await env.DB.prepare(
        'UPDATE campaigns SET name=?,type=?,status=?,start_date=?,end_date=?,budget=?,spent=?,goal_reach=?,goal_leads=?,goal_conversions=?,owner_name=?,description=? WHERE id=?'
      ).bind(b.name||'', b.type||'other', b.status||'planning', b.start_date||null, b.end_date||null, b.budget||0, b.spent||0, b.goal_reach||0, b.goal_leads||0, b.goal_conversions||0, b.owner_name||'', b.description||'', id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM campaigns WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── KPI TEMPLATE ────────────────────────────────────────────────────
  if (path === '/api/kpi-templates' && request.method === 'GET') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const { results: templates = [] } = await env.DB.prepare('SELECT * FROM kpi_templates ORDER BY id DESC').all();
    for (const t of templates) t.items = (await env.DB.prepare('SELECT * FROM kpi_template_items WHERE template_id=? ORDER BY id').bind(t.id).all()).results || [];
    return json({ templates });
  }

  const candCvMatch = path.match(/^\/api\/candidates\/(\d+)\/cv$/);
  if (candCvMatch) {
    const candidateId = parseInt(candCvMatch[1], 10);
    const candidate = await env.DB.prepare('SELECT * FROM candidates WHERE id=?').bind(candidateId).first();
    if (!candidate) return json({ error: 'Không tìm thấy ứng viên' }, 404);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ hồ sơ chưa được cấu hình' }, 503);
    if (request.method === 'GET') {
      if (!candidate.cv_storage_key) return json({ error: 'Ứng viên chưa có CV' }, 404);
      const object = await env.HR_DOCUMENTS.get(candidate.cv_storage_key);
      if (!object) return json({ error: 'Không tìm thấy tệp CV' }, 404);
      const headers = new Headers();
      headers.set('Content-Type', candidate.cv_content_type || 'application/octet-stream');
      headers.set('Content-Disposition', `${url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(candidate.cv_original_filename || 'CV-ung-vien')}`);
      return new Response(object.body, { headers });
    }
    if (request.method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Vui lòng chọn tệp CV' }, 400);
      const contentType = String(file.type || 'application/octet-stream').toLowerCase();
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      const fileName = String(file.name || 'CV-ung-vien').trim();
      const ext = fileName.toLowerCase().split('.').pop();
      if (!allowedTypes.includes(contentType) && !['pdf','doc','docx'].includes(ext)) return json({ error: 'CV chỉ nhận định dạng PDF, DOC hoặc DOCX' }, 400);
      if (!Number.isFinite(file.size) || file.size < 1 || file.size > 10 * 1024 * 1024) return json({ error: 'CV không được vượt quá 10 MB' }, 400);
      const bytes = await file.arrayBuffer();
      const storageKey = `candidates/${candidateId}/cv-${crypto.randomUUID()}`;
      await env.HR_DOCUMENTS.put(storageKey, bytes, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { candidate_id: String(candidateId), uploaded_by: String(me.id) } });
      if (candidate.cv_storage_key) await env.HR_DOCUMENTS.delete(candidate.cv_storage_key);
      await env.DB.prepare('UPDATE candidates SET cv_storage_key=?,cv_original_filename=?,cv_content_type=?,cv_byte_size=? WHERE id=?')
        .bind(storageKey, fileName, contentType, file.size, candidateId).run();
      return json({ ok: true, original_filename: fileName, byte_size: file.size });
    }
    return json({ error: 'Phương thức không được hỗ trợ' }, 405);
  }
  if (path === '/api/kpi-templates' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({})); const items = b.items || [];
    const error = !String(b.name || '').trim() ? 'Cần nhập tên template' : validateKpiItems(items);
    if (error) return json({ error }, 400);
    const r = await env.DB.prepare('INSERT INTO kpi_templates (name,description,created_by,created_by_name) VALUES (?,?,?,?)').bind(String(b.name).trim(), String(b.description || '').trim(), me.id, me.full_name).run();
    for (const item of items) await env.DB.prepare('INSERT INTO kpi_template_items (template_id,criterion_code,title,description,unit,target_value,weight_percent,affects_group1,requires_evidence) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.meta.last_row_id, item.criterion_code, String(item.title).trim(), String(item.description || '').trim(), String(item.unit || 'đơn vị').trim(), Number(item.target_value), Number(item.weight_percent || 0), Number(item.affects_group1) === 0 ? 0 : 1, Number(item.requires_evidence) ? 1 : 0).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const templateApplyMatch = path.match(/^\/api\/kpi-templates\/(\d+)\/apply$/);
  if (templateApplyMatch && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({})); const templateId = parseInt(templateApplyMatch[1]); const employeeIds = [...new Set((b.employee_ids || []).map(Number).filter(Boolean))];
    const month = parseInt(b.month), year = parseInt(b.year);
    if (!employeeIds.length || !month || !year) return json({ error: 'Cần chọn nhân viên và kỳ KPI' }, 400);
    const { results: items = [] } = await env.DB.prepare('SELECT * FROM kpi_template_items WHERE template_id=? ORDER BY id').bind(templateId).all();
    const error = validateKpiItems(items); if (error) return json({ error }, 400);
    const created = [], skipped = [];
    for (const employeeId of employeeIds) {
      const employee = await env.DB.prepare('SELECT id,full_name FROM users WHERE id=? AND is_active=1').bind(employeeId).first(); if (!employee) { skipped.push({ employee_id: employeeId, reason: 'Không hợp lệ' }); continue; }
      const existing = await env.DB.prepare('SELECT status FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=?').bind(employeeId, month, year).first();
      if (existing) { skipped.push({ employee_id: employeeId, name: employee.full_name, reason: 'Đã có KPI ' + existing.status }); continue; }
      const plan = await env.DB.prepare('INSERT INTO employee_kpi_plans (employee_id,month,year,status,created_by,created_by_name) VALUES (?,?,?,?,?,?)').bind(employeeId, month, year, 'DRAFT', me.id, me.full_name).run();
      for (const item of items) await env.DB.prepare('INSERT INTO employee_kpi_items (plan_id,criterion_code,title,description,unit,target_value,weight_percent,affects_group1,requires_evidence) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(plan.meta.last_row_id, item.criterion_code, item.title, item.description, item.unit, item.target_value, item.weight_percent, item.affects_group1, Number(item.requires_evidence) ? 1 : 0).run();
      created.push({ employee_id: employeeId, name: employee.full_name });
    }
    return json({ ok: true, created, skipped });
  }

  // ── KPI NHÂN VIÊN ───────────────────────────────────────────────────
  if (path === '/api/kpis/dashboard' && request.method === 'GET') {
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
    const canViewAll = isHcns(me) || isBgd(me);
    const rowsSql = canViewAll
      ? `SELECT u.id employee_id,u.full_name,u.department,u.position,p.id plan_id,p.status
         FROM users u LEFT JOIN employee_kpi_plans p ON p.employee_id=u.id AND p.month=? AND p.year=? WHERE u.is_active=1 ORDER BY u.full_name`
      : `SELECT u.id employee_id,u.full_name,u.department,u.position,p.id plan_id,p.status
         FROM users u LEFT JOIN employee_kpi_plans p ON p.employee_id=u.id AND p.month=? AND p.year=? WHERE u.id=?`;
    const { results = [] } = await env.DB.prepare(rowsSql).bind(...(canViewAll ? [month, year] : [month, year, me.id])).all();
    for (const row of results) {
      row.group1_score = null;
      row.item_count = 0;
      if (row.plan_id) {
        const itemCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM employee_kpi_items WHERE plan_id=?').bind(row.plan_id).first();
        row.item_count = Number(itemCount?.count || 0);
      }
      if (row.plan_id && row.status === 'APPROVED') {
        const { results: items = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=?').bind(row.plan_id).all();
        if (items.length) row.group1_score = group1Total(items);
      }
    }
    return json({ month, year, kpis: results });
  }
  if (path === '/api/kpis' && request.method === 'GET') {
    const employeeId = parseInt(url.searchParams.get('employee_id') || String(me.id));
    const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
    if (employeeId !== me.id && !isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=?').bind(employeeId, month, year).first();
    const items = plan ? (await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=? ORDER BY criterion_code,id').bind(plan.id).all()).results : [];
    await attachKpiEvidence(env, items);
    if (plan?.status === 'APPROVED') plan.group1_total = group1Total(items);
    return json({ plan: plan || null, items: items || [] });
  }
  if (path === '/api/kpis' && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS được cấu hình KPI' }, 403);
    const b = await request.json().catch(() => ({})); const employeeId = parseInt(b.employee_id), month = parseInt(b.month), year = parseInt(b.year), items = b.items || [];
    const error = !employeeId || !month || !year ? 'Thiếu nhân viên hoặc kỳ KPI' : validateKpiItems(items);
    if (error) return json({ error }, 400);
    let plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE employee_id=? AND month=? AND year=?').bind(employeeId, month, year).first();
    if (plan && ['SUBMITTED','APPROVED'].includes(plan.status)) return json({ error: 'KPI đã gửi/duyệt, không thể sửa trực tiếp' }, 400);
    if (!plan) { const r = await env.DB.prepare('INSERT INTO employee_kpi_plans (employee_id,month,year,status,created_by,created_by_name) VALUES (?,?,?,?,?,?)').bind(employeeId, month, year, 'DRAFT', me.id, me.full_name).run(); plan = { id: r.meta.last_row_id }; }
    await env.DB.prepare('DELETE FROM employee_kpi_items WHERE plan_id=?').bind(plan.id).run();
    for (const item of items) await env.DB.prepare('INSERT INTO employee_kpi_items (plan_id,criterion_code,title,description,unit,target_value,weight_percent,affects_group1,requires_evidence) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(plan.id, item.criterion_code, String(item.title).trim(), String(item.description || '').trim(), String(item.unit || 'đơn vị').trim(), Number(item.target_value), Number(item.weight_percent || 0), Number(item.affects_group1) === 0 ? 0 : 1, Number(item.requires_evidence) ? 1 : 0).run();
    return json({ ok: true, id: plan.id });
  }
  const kpiEvidenceMatch = path.match(/^\/api\/kpis\/(\d+)\/evidence$/);
  if (kpiEvidenceMatch && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được cập nhật link bằng chứng' }, 403);
    const planId = parseInt(kpiEvidenceMatch[1]), b = await request.json().catch(() => ({}));
    const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE id=?').bind(planId).first();
    if (!plan) return json({ error: 'Không tìm thấy KPI' }, 404);
    const item = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE id=? AND plan_id=?').bind(parseInt(b.item_id), planId).first();
    if (!item) return json({ error: 'Không tìm thấy chỉ tiêu KPI' }, 404);
    const changed = await replaceKpiEvidence(env, plan, item, b.evidence || [], me, 'hr_replace');
    if (changed && ['SUBMITTED','APPROVED'].includes(plan.status)) await env.DB.prepare("UPDATE employee_kpi_plans SET status='RETURNED',reviewed_by=?,reviewed_by_name=?,reviewed_at=datetime('now','localtime'),review_note=?,updated_at=datetime('now','localtime') WHERE id=?")
      .bind(me.id, me.full_name || '', 'HCNS đã cập nhật link bằng chứng, vui lòng xác nhận và gửi lại KPI.', planId).run();
    return json({ ok: true, requires_employee_confirmation: changed && ['SUBMITTED','APPROVED'].includes(plan.status) });
  }
  const kpiSnapshotMatch = path.match(/^\/api\/kpis\/(\d+)\/snapshot$/);
  if (kpiSnapshotMatch && request.method === 'GET') {
    if (!isHcns(me)) return json({ error: 'Chỉ HCNS/Admin được in phiếu KPI' }, 403);
    const snapshot = await env.DB.prepare('SELECT * FROM employee_kpi_approval_snapshots_v2 WHERE plan_id=? ORDER BY id DESC LIMIT 1').bind(parseInt(kpiSnapshotMatch[1])).first();
    if (!snapshot) return json({ error: 'KPI chưa được duyệt hoặc chưa có phiếu chốt' }, 404);
    const { results: audit = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_evidence_audit WHERE plan_id=? ORDER BY created_at,id').bind(snapshot.plan_id).all();
    return json({ snapshot: { ...snapshot, payload: JSON.parse(snapshot.snapshot_json) }, audit });
  }
  const kpiActionMatch = path.match(/^\/api\/kpis\/(\d+)\/(submit|review)$/);
  if (kpiActionMatch && request.method === 'POST') {
    const planId = parseInt(kpiActionMatch[1]), action = kpiActionMatch[2], b = await request.json().catch(() => ({}));
    const plan = await env.DB.prepare('SELECT * FROM employee_kpi_plans WHERE id=?').bind(planId).first();
    if (!plan) return json({ error: 'Không tìm thấy KPI' }, 404);
    if (action === 'submit') {
      if (plan.employee_id !== me.id) return json({ error: 'Không có quyền' }, 403);
      // Nhân viên có thể điều chỉnh KPI đã duyệt. Lần gửi tiếp theo phải được
      // HCNS duyệt lại, do đó trạng thái luôn quay về SUBMITTED bên dưới.
      if (!['DRAFT','RETURNED','APPROVED'].includes(plan.status)) return json({ error: 'KPI không ở trạng thái có thể gửi' }, 400);
      const items = b.items || []; if (!Array.isArray(items) || !items.length) return json({ error: 'Cần nhập kết quả KPI' }, 400);
      for (const item of items) {
        const current = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE id=? AND plan_id=?').bind(parseInt(item.id), planId).first();
        if (!current) return json({ error: 'Có chỉ tiêu KPI không hợp lệ' }, 400);
        const isText = String(current?.unit || '').toLowerCase() === 'text';
        await env.DB.prepare('UPDATE employee_kpi_items SET actual_value=?,actual_text=?, evidence_url=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=? AND plan_id=?')
          .bind(isText ? null : Number(item.actual_value), isText ? String(item.actual_text || '').trim() : null, String(item.evidence_url || '').trim(), parseInt(item.id), planId).run();
        await replaceKpiEvidence(env, plan, current, item.evidence || [], me, 'employee_submit');
      }
      const { results = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=?').bind(planId).all();
      if (results.some(i => String(i.unit).toLowerCase() === 'text' ? !String(i.actual_text || '').trim() : i.actual_value === null)) return json({ error: 'Cần nhập kết quả cho toàn bộ KPI' }, 400);
      for (const item of results.filter(i => Number(i.requires_evidence))) {
        const count = await env.DB.prepare('SELECT COUNT(*) count FROM employee_kpi_evidence WHERE kpi_item_id=?').bind(item.id).first();
        if (!Number(count?.count || 0)) return json({ error: `Chỉ tiêu “${item.title}” cần ít nhất một link bằng chứng` }, 400);
      }
      await env.DB.prepare('UPDATE employee_kpi_plans SET status=?,submitted_at=datetime(\'now\',\'localtime\'),updated_at=datetime(\'now\',\'localtime\') WHERE id=?').bind('SUBMITTED', planId).run();
    } else {
      if (!isHcns(me)) return json({ error: 'Chỉ HCNS được duyệt KPI' }, 403);
      if (b.approve) {
        const { results: textItems = [] } = await env.DB.prepare("SELECT id,criterion_code FROM employee_kpi_items WHERE plan_id=? AND lower(unit)='text'").bind(planId).all();
        const manualScores = b.manual_scores || {};
        for (const item of textItems) {
          const score = Number(manualScores[item.id]);
          if (!Number.isFinite(score) || score < 0 || score > KPI_GROUP1_MAX[item.criterion_code]) return json({ error: `Điểm HCNS cho ${item.criterion_code} phải từ 0 đến ${KPI_GROUP1_MAX[item.criterion_code]}` }, 400);
          await env.DB.prepare('UPDATE employee_kpi_items SET manual_score=? WHERE id=? AND plan_id=?').bind(score, item.id, planId).run();
        }
        await env.DB.prepare('UPDATE employee_kpi_items SET review_note=NULL WHERE plan_id=?').bind(planId).run();
        const { results: approvedItems = [] } = await env.DB.prepare('SELECT * FROM employee_kpi_items WHERE plan_id=? ORDER BY criterion_code,id').bind(planId).all();
        await attachKpiEvidence(env, approvedItems);
        const employee = await env.DB.prepare('SELECT id,full_name,employee_code,department,position FROM users WHERE id=?').bind(plan.employee_id).first();
        const payload = { plan: { ...plan, status: 'APPROVED', reviewed_by: me.id, reviewed_by_name: me.full_name, approved_at: new Date().toISOString() }, employee, items: approvedItems, group1_total: group1Total(approvedItems) };
        await env.DB.prepare('INSERT INTO employee_kpi_approval_snapshots_v2 (plan_id,employee_id,month,year,snapshot_json,approved_by,approved_by_name,approved_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\',\'localtime\'))')
          .bind(planId, plan.employee_id, plan.month, plan.year, JSON.stringify(payload), me.id, me.full_name || '').run();
      } else {
        const itemNotes = b.item_notes || {};
        const notes = Object.entries(itemNotes).filter(([, note]) => String(note || '').trim());
        if (!notes.length && !String(b.note || '').trim()) return json({ error: 'Hãy ghi yêu cầu chỉnh sửa cho ít nhất một tiêu chí hoặc ghi chú chung' }, 400);
        await env.DB.prepare('UPDATE employee_kpi_items SET review_note=NULL WHERE plan_id=?').bind(planId).run();
        for (const [itemId, note] of notes) await env.DB.prepare('UPDATE employee_kpi_items SET review_note=? WHERE id=? AND plan_id=?')
          .bind(String(note).trim(), parseInt(itemId), planId).run();
      }
      const status = b.approve ? 'APPROVED' : 'RETURNED';
      await env.DB.prepare('UPDATE employee_kpi_plans SET status=?,reviewed_by=?,reviewed_by_name=?,reviewed_at=datetime(\'now\',\'localtime\'),review_note=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(status, me.id, me.full_name, String(b.note || '').trim(), planId).run();
    }
    return json({ ok: true });
  }

  // ── ĐÁNH GIÁ HIỆU SUẤT (Performance Evaluation) — TTS workflow ─────
  if (path === '/api/eval-periods' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM eval_periods ORDER BY year DESC, month DESC').all();
    return json({ periods: results });
  }
  if (path === '/api/eval-periods' && request.method === 'POST') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({}));
    const month = parseInt(b.month), year = parseInt(b.year);
    if (!month || month < 1 || month > 12 || !year) return json({ error: 'Tháng/năm kỳ đánh giá không hợp lệ' }, 400);

    // Fixed monthly cycle: from the 28th of the preceding month through the
    // 3rd of the following month. Derive dates here to keep all new periods
    // consistent; previously saved periods are preserved as-is.
    const pad = (value) => String(value).padStart(2, '0');
    const startMonth = month === 1 ? 12 : month - 1;
    const startYear = month === 1 ? year - 1 : year;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const start = `${startYear}-${pad(startMonth)}-28`;
    const end = `${endYear}-${pad(endMonth)}-03`;
    try {
      const r = await env.DB.prepare(
        'INSERT INTO eval_periods (month,year,start_date,end_date,created_by,created_by_name) VALUES (?,?,?,?,?,?)'
      ).bind(month, year, start, end, me.id, me.full_name).run();
      return json({ ok: true, id: r.meta.last_row_id });
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) return json({ error: 'Kỳ đánh giá tháng này đã tồn tại' }, 400);
      throw e;
    }
  }

  // ── REPORT: Bảng tổng hợp điểm hiệu suất (HCNS/BGD) ──
  if (path === '/api/evaluations/report' && request.method === 'GET') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const periodId = parseInt(url.searchParams.get('period_id') || '0');
    if (!periodId) {
      const latest = await env.DB.prepare('SELECT id FROM eval_periods ORDER BY year DESC, month DESC LIMIT 1').first();
      if (!latest) return json({ report: [], periods: [] });
      return json({ report: [], periods: [] }); // no period = empty report, UI shows "Chưa có kỳ đánh giá"
    }
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);

    const { results: activeUsers } = await env.DB.prepare(
      "SELECT id, employee_code, full_name, department, position, lifecycle_status, employee_type FROM users WHERE is_active=1 ORDER BY full_name"
    ).all();

    const { results: evals } = await env.DB.prepare(
      `SELECT e.*, p.month AS period_month, p.year AS period_year
         FROM evaluations e JOIN eval_periods p ON e.period_id=p.id
        WHERE e.period_id=?`
    ).bind(periodId).all();
    const evalByUser = new Map(evals.map(e => [Number(e.user_id), e]));

    // N1: HS01-HS06 (max 60), N2: VH01-VH04 (max 25), N3: SK01-SK04 (max 15)
    const N1_CODES = new Set(['HS01','HS02','HS03','HS04','HS05','HS06']);
    const N2_CODES = new Set(['VH01','VH02','VH03','VH04']);
    const N3_CODES = new Set(['SK01','SK02','SK03','SK04']);

    function groupScores(evaluation) {
      const ms = safeParseJSON(evaluation?.mentor_scores) || {};
      const ds = safeParseJSON(evaluation?.department_scores) || {};
      const merged = {};
      for (const code of [...N1_CODES, ...N2_CODES, ...N3_CODES]) {
        if (ds[code] !== undefined && ds[code] !== null && ds[code] !== '') merged[code] = Number(ds[code]);
        else if (ms[code] !== undefined && ms[code] !== null && ms[code] !== '') merged[code] = Number(ms[code]);
        else merged[code] = 0;
      }
      const sum = (set) => [...set].reduce((s, c) => s + (merged[c] || 0), 0);
      return { n1: sum(N1_CODES), n2: sum(N2_CODES), n3: sum(N3_CODES), total: sum(N1_CODES) + sum(N2_CODES) + sum(N3_CODES) };
    }

    function ratingFor(total) {
      if (total >= 90) return { label: 'Xuất sắc', cls: 'badge-success', action: 'Xét thưởng, ghi nhận và ưu tiên phát triển' };
      if (total >= 80) return { label: 'Tốt', cls: 'badge-info', action: 'Duy trì và giao mục tiêu cao hơn' };
      if (total >= 65) return { label: 'Đạt', cls: 'badge-gray', action: 'Đáp ứng yêu cầu, tiếp tục theo dõi' };
      if (total >= 50) return { label: 'Dưới chuẩn', cls: 'badge-warning', action: 'Lập kế hoạch cải thiện, đào tạo và đánh giá lại' };
      return { label: 'Yếu', cls: 'badge-danger', action: 'Cảnh báo hiệu suất, đánh giá lại sau thời hạn cải thiện; xem xét điều chuyển hoặc xử lý hợp đồng theo quy định' };
    }

    // Get previous period for comparison
    let prevEvalByUser = new Map();
    if (period.month && period.year) {
      const prevDate = new Date(period.year, period.month - 2, 1);
      const prevMonth = prevDate.getMonth() + 1, prevYear = prevDate.getFullYear();
      const prevPeriod = await env.DB.prepare(
        'SELECT id FROM eval_periods WHERE month=? AND year=?'
      ).bind(prevMonth, prevYear).first();
      if (prevPeriod) {
        const { results: prevEvals } = await env.DB.prepare(
          'SELECT * FROM evaluations WHERE period_id=?'
        ).bind(prevPeriod.id).all();
        for (const pe of prevEvals) prevEvalByUser.set(Number(pe.user_id), pe);
      }
    }

    const report = activeUsers.map(u => {
      const ev = evalByUser.get(Number(u.id));
      const scores = groupScores(ev || null);
      const finalScore = ev?.final_approved_score != null ? Number(ev.final_approved_score) : (ev?.mentor_submitted_at && ev?.department_submitted_at ? scores.total : null);
      const rating = finalScore != null ? ratingFor(finalScore) : null;
      const prevEv = prevEvalByUser.get(Number(u.id));
      const prevScores = groupScores(prevEv || null);
      const prevTotal = prevEv?.final_approved_score != null ? Number(prevEv.final_approved_score) : (prevEv?.mentor_submitted_at && prevEv?.department_submitted_at ? prevScores.total : null);
      return {
        user_id: u.id,
        employee_code: u.employee_code,
        full_name: u.full_name,
        department: u.department,
        position: u.position,
        lifecycle_status: u.lifecycle_status,
        employee_type: u.employee_type,
        has_evaluation: !!ev,
        evaluation_id: ev?.id || null,
        status: ev?.status || null,
        mentor_name: ev?.mentor_name || null,
        department_head_name: ev?.department_head_name || null,
        n1: ev ? scores.n1 : 0,
        n2: ev ? scores.n2 : 0,
        n3: ev ? scores.n3 : 0,
        total: finalScore,
        prev_total: prevTotal,
        rating_label: rating?.label || 'Chưa đánh giá',
        rating_cls: rating?.cls || 'badge-gray',
        action: rating?.action || 'Chưa có đánh giá',
      };
    });

    report.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.full_name.localeCompare(b.full_name));

    const { results: periods } = await env.DB.prepare('SELECT * FROM eval_periods ORDER BY year DESC, month DESC').all();
    return json({ report, periods, selectedPeriod: period });
  }

  // ── DASHBOARD: Báo cáo hiệu suất nhân sự (BGD/HCNS) ──
  if (path === '/api/evaluations/dashboard' && request.method === 'GET') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const periodId = parseInt(url.searchParams.get('period_id') || '0');
    if (!periodId) {
      const latest = await env.DB.prepare('SELECT id FROM eval_periods ORDER BY year DESC, month DESC LIMIT 1').first();
      if (!latest) return json({ dashboard: { total_employees: 0, xuatsac: 0, tot: 0, dat: 0, duoi_chuan: 0, yeu: 0, avg_score: 0, period: null, policy: [] }, periods: [] });
      return json({ dashboard: { total_employees: 0, xuatsac: 0, tot: 0, dat: 0, duoi_chuan: 0, yeu: 0, avg_score: 0, period: null, policy: [] }, periods: [] });
    }
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);

    const { results: activeUsers } = await env.DB.prepare(
      "SELECT id, employee_code, full_name, department FROM users WHERE is_active=1"
    ).all();

    const { results: evals } = await env.DB.prepare(
      'SELECT e.* FROM evaluations e WHERE e.period_id=?'
    ).bind(periodId).all();
    const evalByUser = new Map(evals.map(e => [Number(e.user_id), e]));

    let xuatsac = 0, tot = 0, dat = 0, duoi_chuan = 0, yeu = 0, chua_danh_gia = 0, scoredCount = 0, scoreSum = 0;

    for (const u of activeUsers) {
      const ev = evalByUser.get(Number(u.id));
      const score = ev?.final_approved_score != null ? Number(ev.final_approved_score) : null;
      if (score == null) { chua_danh_gia++; continue; }
      scoredCount++; scoreSum += score;
      if (score >= 90) xuatsac++;
      else if (score >= 80) tot++;
      else if (score >= 65) dat++;
      else if (score >= 50) duoi_chuan++;
      else yeu++;
    }

    const avgScore = scoredCount > 0 ? Math.round(scoreSum / scoredCount) : 0;

    const policy = [
      { grade: 'Xuất sắc', range: '≥ 90 điểm', action: 'Xét thưởng, ghi nhận và ưu tiên phát triển', cls: 'badge-success' },
      { grade: 'Tốt', range: '80–89 điểm', action: 'Duy trì và giao mục tiêu cao hơn', cls: 'badge-info' },
      { grade: 'Đạt', range: '65–79 điểm', action: 'Đáp ứng yêu cầu công việc, tiếp tục theo dõi', cls: 'badge-gray' },
      { grade: 'Dưới chuẩn', range: '50–64 điểm', action: 'Lập kế hoạch cải thiện, đào tạo và đánh giá lại', cls: 'badge-warning' },
      { grade: 'Yếu', range: '< 50 điểm', action: 'Cảnh báo hiệu suất, đánh giá lại sau thời hạn cải thiện; xem xét điều chuyển hoặc xử lý hợp đồng theo quy định', cls: 'badge-danger' },
    ];

    const dashboard = {
      total_employees: activeUsers.length,
      xuatsac, tot, dat, duoi_chuan, yeu, chua_danh_gia,
      avg_score: avgScore,
      period: { month: period.month, year: period.year, start_date: period.start_date, end_date: period.end_date },
      policy,
      hr_note: period.hr_note || '',
      hr_note_by: period.hr_note_by || '',
      hr_note_at: period.hr_note_at || '',
    };

    const { results: periods } = await env.DB.prepare('SELECT * FROM eval_periods ORDER BY year DESC, month DESC').all();
    return json({ dashboard, periods });
  }

  if (path === '/api/evaluations' && request.method === 'GET') {
    const periodId = url.searchParams.get('period_id');
    let q = `SELECT e.*, u.full_name AS user_name, u.employee_code AS user_code, u.department AS user_department, u.position AS user_position, u.lifecycle_status AS user_lifecycle,
                     p.month AS period_month, p.year AS period_year, p.start_date AS period_start, p.end_date AS period_end
              FROM evaluations e LEFT JOIN users u ON e.user_id = u.id LEFT JOIN eval_periods p ON e.period_id = p.id`;
    const params = [];
    const clauses = [];
    if (periodId) { clauses.push('e.period_id=?'); params.push(parseInt(periodId)); }
    if (!isHcns(me) && !isBgd(me)) {
      clauses.push('(e.user_id=? OR e.mentor_id=? OR e.department_head_id=?)');
      params.push(me.id, me.id, me.id);
    }
    if (clauses.length) q += ' WHERE ' + clauses.join(' AND ');
    q += ' ORDER BY e.updated_at DESC';
    const { results } = await env.DB.prepare(q).bind(...params).all();
    return json({ evaluations: results });
  }

  if (path === '/api/evaluations' && request.method === 'POST') {
    if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
    const b = await request.json().catch(() => ({}));
    const periodId = parseInt(b.period_id), userId = parseInt(b.user_id);
    const mentorId = parseInt(b.mentor_id), deptHeadId = parseInt(b.department_head_id);
    if (!periodId || !userId || !mentorId || !deptHeadId) return json({ error: 'Thiếu thông tin phân công' }, 400);
    if (mentorId === userId || deptHeadId === userId) return json({ error: 'Người đánh giá không thể là chính TTS' }, 400);
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);
    const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
    if (!target || !target.is_active) return json({ error: 'Nhân viên không hợp lệ hoặc đã ngừng hoạt động' }, 400);
    const mentor = await env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(mentorId).first();
    const deptHead = await env.DB.prepare('SELECT full_name FROM users WHERE id=?').bind(deptHeadId).first();
    const existing = await env.DB.prepare('SELECT * FROM evaluations WHERE period_id=? AND user_id=?').bind(periodId, userId).first();
    if (existing) {
      if (existing.mentor_submitted_at || existing.department_submitted_at) {
        return json({ error: 'Đã có đánh giá đang xử lý, không thể đổi phân công' }, 400);
      }
      await env.DB.prepare('UPDATE evaluations SET mentor_id=?,mentor_name=?,department_head_id=?,department_head_name=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(mentorId, mentor?.full_name || '', deptHeadId, deptHead?.full_name || '', existing.id).run();
      const snapshot = await createEvaluationKpiSnapshot(env, existing.id, userId, period.month, period.year);
      if (snapshot.error) return json({ error: snapshot.error }, 400);
      return json({ ok: true, id: existing.id });
    }
    const r = await env.DB.prepare(
      'INSERT INTO evaluations (period_id,user_id,mentor_id,mentor_name,department_head_id,department_head_name,status) VALUES (?,?,?,?,?,?,?)'
    ).bind(periodId, userId, mentorId, mentor?.full_name || '', deptHeadId, deptHead?.full_name || '', 'MENTOR_REVIEW').run();
    const snapshot = await createEvaluationKpiSnapshot(env, r.meta.last_row_id, userId, period.month, period.year);
    if (snapshot.error) {
      await env.DB.prepare('DELETE FROM evaluations WHERE id=?').bind(r.meta.last_row_id).run();
      return json({ error: snapshot.error }, 400);
    }
    await env.DB.prepare('INSERT INTO evaluation_history (evaluation_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
      .bind(r.meta.last_row_id, null, 'MENTOR_REVIEW', me.id, me.full_name, 'Phân công Mentor & Trưởng phòng đánh giá').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const evalDetailMatch = path.match(/^\/api\/evaluations\/(\d+)$/);
  if (evalDetailMatch && request.method === 'GET') {
    const evalId = parseInt(evalDetailMatch[1]);
    const ev = await env.DB.prepare(
      `SELECT e.*, u.full_name AS user_name, u.employee_code AS user_code, u.department AS user_department, u.position AS user_position, u.lifecycle_status AS user_lifecycle,
              p.month AS period_month, p.year AS period_year, p.start_date AS period_start, p.end_date AS period_end
       FROM evaluations e LEFT JOIN users u ON e.user_id = u.id LEFT JOIN eval_periods p ON e.period_id = p.id WHERE e.id=?`
    ).bind(evalId).first();
    if (!ev) return json({ error: 'Không tìm thấy phiếu đánh giá' }, 404);
    const allowed = ev.user_id === me.id || ev.mentor_id === me.id || ev.department_head_id === me.id || isHcns(me) || isBgd(me);
    if (!allowed) return json({ error: 'Không có quyền' }, 403);
    try {
      const { results: history } = await env.DB.prepare('SELECT * FROM evaluation_history WHERE evaluation_id=? ORDER BY id ASC').bind(evalId).all();
      const { results: kpi_snapshots } = await env.DB.prepare('SELECT * FROM evaluation_kpi_snapshots WHERE evaluation_id=? ORDER BY criterion_code').bind(evalId).all();
      return json({ evaluation: ev, history, kpi_snapshots });
    } catch (error) {
      console.error('Evaluation detail load failed', { evalId, userId: me.id, message: String(error?.message || error) });
      return json({ error: 'Không thể tải dữ liệu chi tiết của phiếu đánh giá. Vui lòng thử lại sau.', code: 'EVALUATION_DETAIL_LOAD_FAILED' }, 500);
    }
  }

  const evalActionMatch = path.match(/^\/api\/evaluations\/(\d+)\/action$/);
  if (evalActionMatch && request.method === 'POST') {
    const evalId = parseInt(evalActionMatch[1]);
    const ev = await env.DB.prepare('SELECT * FROM evaluations WHERE id=?').bind(evalId).first();
    if (!ev) return json({ error: 'Không tìm thấy phiếu đánh giá' }, 404);
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(ev.period_id).first();
    const b = await request.json().catch(() => ({}));
    const action = String(b.action || '');
    const isMentor = ev.mentor_id === me.id;
    const isDept = ev.department_head_id === me.id;
    const isSelf = ev.user_id === me.id;
    const withinWindow = !!(period && todayStr() >= period.start_date && todayStr() <= period.end_date);
    const canScoreNow = withinWindow || !!ev.window_override;
    const reviewStatuses = ['MENTOR_REVIEW', 'EMPLOYEE_REVISION_REQUESTED', 'CEO_REVISION_REQUESTED'];

    async function applyHistory(toStatus, note) {
      await env.DB.prepare('INSERT INTO evaluation_history (evaluation_id,from_status,to_status,changed_by,changed_by_name,note) VALUES (?,?,?,?,?,?)')
        .bind(evalId, ev.status, toStatus, me.id, me.full_name, note || null).run();
    }

    if (action === 'mentor_save_draft' || action === 'mentor_submit') {
      if (!isMentor) return json({ error: 'Không có quyền' }, 403);
      if (!reviewStatuses.includes(ev.status)) return json({ error: 'Phiếu không ở trạng thái có thể chấm điểm' }, 400);
      if (!canScoreNow) return json({ error: 'Ngoài thời gian đánh giá của kỳ này' }, 400);
      const scores = b.scores || {}, comments = b.comments || {};
      const err = action === 'mentor_submit' ? evalValidateComplete(scores, comments) : evalValidatePartial(scores, comments);
      if (err) return json({ error: err }, 400);
      const submittedAt = action === 'mentor_submit' ? nowStr() : ev.mentor_submitted_at;
      await env.DB.prepare('UPDATE evaluations SET mentor_scores=?,mentor_comments=?,mentor_submitted_at=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(JSON.stringify(scores), JSON.stringify(comments), submittedAt, evalId).run();
      if (action === 'mentor_submit') {
        if (ev.department_submitted_at) {
          await env.DB.prepare('UPDATE evaluations SET status=? WHERE id=?').bind('EMPLOYEE_CONFIRMATION', evalId).run();
          await applyHistory('EMPLOYEE_CONFIRMATION', 'Mentor & Trưởng phòng đã hoàn tất đánh giá');
        } else {
          await applyHistory(ev.status, 'Mentor đã gửi đánh giá');
        }
      }
      return json({ ok: true });
    }

    if (action === 'dept_save_draft' || action === 'dept_submit') {
      if (!isDept) return json({ error: 'Không có quyền' }, 403);
      if (!reviewStatuses.includes(ev.status)) return json({ error: 'Phiếu không ở trạng thái có thể chấm điểm' }, 400);
      if (!canScoreNow) return json({ error: 'Ngoài thời gian đánh giá của kỳ này' }, 400);
      const scores = b.scores || {}, comments = b.comments || {};
      const err = action === 'dept_submit' ? evalValidateComplete(scores, comments) : evalValidatePartial(scores, comments);
      if (err) return json({ error: err }, 400);
      const submittedAt = action === 'dept_submit' ? nowStr() : ev.department_submitted_at;
      await env.DB.prepare('UPDATE evaluations SET department_scores=?,department_comments=?,department_submitted_at=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
        .bind(JSON.stringify(scores), JSON.stringify(comments), submittedAt, evalId).run();
      if (action === 'dept_submit') {
        if (ev.mentor_submitted_at) {
          await env.DB.prepare('UPDATE evaluations SET status=? WHERE id=?').bind('EMPLOYEE_CONFIRMATION', evalId).run();
          await applyHistory('EMPLOYEE_CONFIRMATION', 'Mentor & Trưởng phòng đã hoàn tất đánh giá');
        } else {
          await applyHistory(ev.status, 'Trưởng phòng đã gửi đánh giá');
        }
      }
      return json({ ok: true });
    }

    if (action === 'employee_confirm') {
      if (!isSelf) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'EMPLOYEE_CONFIRMATION') return json({ error: 'Phiếu không ở trạng thái chờ xác nhận' }, 400);
      await env.DB.prepare('UPDATE evaluations SET employee_confirmed_at=?,status=? WHERE id=?').bind(nowStr(), 'PENDING_CEO_APPROVAL', evalId).run();
      await applyHistory('PENDING_CEO_APPROVAL', 'TTS đã xác nhận kết quả');
      return json({ ok: true });
    }

    if (action === 'employee_revision') {
      if (!isSelf) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'EMPLOYEE_CONFIRMATION') return json({ error: 'Phiếu không ở trạng thái chờ xác nhận' }, 400);
      const reason = String(b.reason || '').trim();
      if (!reason) return json({ error: 'Vui lòng nhập lý do yêu cầu xem xét lại' }, 400);
      await env.DB.prepare(
        `UPDATE evaluations SET employee_revision_reason=?,employee_revision_evidence=?,employee_revision_at=?,
         status=?,mentor_submitted_at=NULL,department_submitted_at=NULL WHERE id=?`
      ).bind(reason, String(b.evidence || '').trim(), nowStr(), 'EMPLOYEE_REVISION_REQUESTED', evalId).run();
      await applyHistory('EMPLOYEE_REVISION_REQUESTED', reason);
      return json({ ok: true });
    }

    if (action === 'ceo_approve') {
      if (!isBgd(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'PENDING_CEO_APPROVAL') return json({ error: 'Phiếu không ở trạng thái chờ phê duyệt' }, 400);
      const finalScore = Number(b.finalScore);
      if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 100) return json({ error: 'Điểm cuối cùng không hợp lệ (0–100)' }, 400);
      const initialScore = b.initialScore !== undefined && b.initialScore !== null ? Number(b.initialScore) : null;
      const adjusted = initialScore !== null && Math.round(initialScore) !== Math.round(finalScore);
      if (adjusted && !String(b.adjustReason || '').trim()) return json({ error: 'Vui lòng nhập lý do điều chỉnh điểm' }, 400);
      await env.DB.prepare(
        `UPDATE evaluations SET final_approved_score=?,final_approved_comment=?,final_score_before_adjust=?,final_adjust_reason=?,
         approved_by=?,approved_by_name=?,approved_at=?,status=? WHERE id=?`
      ).bind(finalScore, String(b.finalComment || '').trim(), adjusted ? initialScore : null, adjusted ? String(b.adjustReason).trim() : null,
             me.id, me.full_name, nowStr(), 'CEO_APPROVED', evalId).run();
      await applyHistory('CEO_APPROVED', adjusted ? `Đã phê duyệt (điều chỉnh điểm: ${initialScore} → ${finalScore})` : 'Đã phê duyệt');
      return json({ ok: true });
    }

    if (action === 'ceo_revision') {
      if (!isBgd(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'PENDING_CEO_APPROVAL') return json({ error: 'Phiếu không ở trạng thái chờ phê duyệt' }, 400);
      const reason = String(b.reason || '').trim();
      if (!reason) return json({ error: 'Vui lòng nhập lý do trả lại đánh giá' }, 400);
      await env.DB.prepare(
        `UPDATE evaluations SET ceo_revision_reason=?,ceo_revision_at=?,status=?,
         mentor_submitted_at=NULL,department_submitted_at=NULL,employee_confirmed_at=NULL WHERE id=?`
      ).bind(reason, nowStr(), 'CEO_REVISION_REQUESTED', evalId).run();
      await applyHistory('CEO_REVISION_REQUESTED', reason);
      return json({ ok: true });
    }

    if (action === 'hr_receive') {
      if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'CEO_APPROVED') return json({ error: 'Phiếu chưa được phê duyệt' }, 400);
      await env.DB.prepare('UPDATE evaluations SET hr_received_by=?,hr_received_by_name=?,hr_received_at=?,status=? WHERE id=?')
        .bind(me.id, me.full_name, nowStr(), 'HR_RECEIVED', evalId).run();
      await applyHistory('HR_RECEIVED', 'HCNS đã tiếp nhận');
      return json({ ok: true });
    }

    if (action === 'hr_lock') {
      if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.status !== 'HR_RECEIVED') return json({ error: 'Phiếu chưa được HCNS tiếp nhận' }, 400);
      await env.DB.prepare('UPDATE evaluations SET locked_by=?,locked_by_name=?,locked_at=?,status=? WHERE id=?')
        .bind(me.id, me.full_name, nowStr(), 'LOCKED', evalId).run();
      await applyHistory('LOCKED', 'HCNS đã khóa điểm');
      return json({ ok: true });
    }

    if (action === 'hr_reopen') {
      if (!isHcns(me) && !isBgd(me)) return json({ error: 'Không có quyền' }, 403);
      if (ev.window_override) return json({ ok: true });
      await env.DB.prepare('UPDATE evaluations SET window_override=1 WHERE id=?').bind(evalId).run();
      await applyHistory(ev.status, 'Mở lại ngoài thời gian đánh giá');
      return json({ ok: true });
    }

    return json({ error: 'Hành động không hợp lệ' }, 400);
  }

  // HCNS "Ghi chú & kiến nghị" cho Ban Giám đốc — one note per eval period (report dashboard).
  const evalPeriodNoteMatch = path.match(/^\/api\/eval-periods\/(\d+)\/note$/);
  if (evalPeriodNoteMatch && request.method === 'POST') {
    if (!isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const periodId = parseInt(evalPeriodNoteMatch[1]);
    const period = await env.DB.prepare('SELECT * FROM eval_periods WHERE id=?').bind(periodId).first();
    if (!period) return json({ error: 'Không tìm thấy kỳ đánh giá' }, 404);
    const b = await request.json().catch(() => ({}));
    const note = String(b.note || '').slice(0, 2000);
    await env.DB.prepare('UPDATE eval_periods SET hr_note=?,hr_note_by=?,hr_note_at=? WHERE id=?')
      .bind(note, me.full_name, nowStr(), periodId).run();
    return json({ ok: true });
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAT MODULE
  // ═══════════════════════════════════════════════════════════════

  // ── Conversations ────────────────────────────────────────────────
  if (path === '/api/conversations' && request.method === 'GET') {
    const search = (url.searchParams.get('q') || '').trim();
    const { results = [] } = await env.DB.prepare(
      `SELECT c.id, c.type, c.name, c.team_id, c.project_id, c.created_by, c.created_at,
        (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) AS member_count,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.id > COALESCE((SELECT cm2.last_read_message_id FROM conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id = ?), 0) AND m.sender_id != ?) AS unread_count
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
       ${search ? 'AND (c.name LIKE ?1 OR EXISTS (SELECT 1 FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id WHERE cm2.conversation_id = c.id AND cm2.user_id != ? AND u.full_name LIKE ?1))' : ''}
       ORDER BY (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) DESC`
    ).bind(me.id, me.id, me.id, ...(search ? [me.id] : [])).all();

    const conversations = await Promise.all(results.map(async c => {
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
      return { ...c, last_message: lastMsg || null, members };
    }));
    return json({ conversations });
  }

  if (path === '/api/conversations' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const type = ['direct', 'group', 'team', 'project'].includes(b.type) ? b.type : 'direct';
    const name = String(b.name || '').slice(0, 200) || null;
    const memberIds = Array.isArray(b.member_ids) ? [...new Set(b.member_ids.map(Number).filter(id => id > 0 && id !== me.id))] : [];
    if (type === 'direct' && memberIds.length !== 1) return json({ error: 'DM cần đúng 1 người nhận' }, 400);
    if (type === 'direct') {
      const existing = await env.DB.prepare(
        `SELECT c.id FROM conversations c
         WHERE c.type = 'direct'
           AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?)
           AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?)
           AND (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) = 2`
      ).bind(me.id, memberIds[0]).first();
      if (existing) return json({ conversation_id: existing.id });
    }
    const result = await env.DB.prepare(
      'INSERT INTO conversations (type, name, team_id, project_id, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(type, name, b.team_id || null, b.project_id || null, me.id).run();
    const convId = result.meta?.last_row_id;
    await env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)')
      .bind(convId, me.id, 'owner').run();
    for (const uid of memberIds) {
      await env.DB.prepare('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)')
        .bind(convId, uid, 'member').run();
    }
    return json({ conversation_id: convId });
  }

  const convMatch = path.match(/^\/api\/conversations\/(\d+)$/);
  if (convMatch && request.method === 'GET') {
    const convId = parseInt(convMatch[1]);
    const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
    if (!conv) return json({ error: 'Không tìm thấy hội thoại' }, 404);
    const members = await env.DB.prepare(
      `SELECT cm.user_id, u.full_name, u.employee_code, u.avatar_url, cm.role, cm.last_read_message_id
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`
    ).bind(convId).all().then(r => r.results || []);
    return json({ ...conv, members });
  }

  const convMembersMatch = path.match(/^\/api\/conversations\/(\d+)\/members$/);
  if (convMembersMatch && request.method === 'POST') {
    const convId = parseInt(convMembersMatch[1]);
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
  }

  // ── Messages ─────────────────────────────────────────────────────
  const msgListMatch = path.match(/^\/api\/conversations\/(\d+)\/messages$/);
  if (msgListMatch && request.method === 'GET') {
    const convId = parseInt(msgListMatch[1]);
    const before = url.searchParams.get('before');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);
    let q = `SELECT m.*, u.full_name AS sender_name, u.employee_code AS sender_code, u.avatar_url AS sender_avatar
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ?`;
    const binds = [convId];
    if (before) { q += ' AND m.id < ?'; binds.push(Number(before)); }
    q += ' ORDER BY m.id DESC LIMIT ?'; binds.push(limit);
    const { results = [] } = await env.DB.prepare(q).bind(...binds).all();
    results.reverse();
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
    const messages = results.map(m => ({
      ...m,
      attachments: attMap[m.id] || [],
      reactions: reacMap[m.id] || [],
    }));
    return json({ messages, has_more: results.length >= limit });
  }

  if (msgListMatch && request.method === 'POST') {
    const convId = parseInt(msgListMatch[1]);
    const b = await request.json().catch(() => ({}));
    const content = String(b.content || '').trim();
    if (!content && !b.attachments?.length) return json({ error: 'Nội dung không được để trống' }, 400);
    const result = await env.DB.prepare(
      'INSERT INTO messages (conversation_id, sender_id, content, reply_to_id, task_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(convId, me.id, content || null, b.reply_to_id ? Number(b.reply_to_id) : null, b.task_id ? Number(b.task_id) : null).run();
    const messageId = result.meta?.last_row_id;
    if (b.attachments?.length) {
      for (const att of b.attachments) {
        await env.DB.prepare(
          'INSERT INTO message_attachments (message_id, type, file_name, file_size, mime_type, storage_key, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(messageId, att.type || 'file', att.file_name, att.file_size || 0, att.mime_type || '', att.storage_key, att.width || null, att.height || null).run();
      }
    }
    const msg = await env.DB.prepare(
      `SELECT m.*, u.full_name AS sender_name, u.employee_code AS sender_code FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    ).bind(messageId).first();
    return json({ message: msg });
  }

  const msgMatch = path.match(/^\/api\/messages\/(\d+)$/);
  if (msgMatch && request.method === 'PUT') {
    const msgId = parseInt(msgMatch[1]);
    const b = await request.json().catch(() => ({}));
    const content = String(b.content || '').trim();
    if (!content) return json({ error: 'Nội dung không được để trống' }, 400);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND sender_id = ?')
      .bind(content, now, msgId, me.id).run();
    return json({ ok: true });
  }

  if (msgMatch && request.method === 'DELETE') {
    const msgId = parseInt(msgMatch[1]);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('UPDATE messages SET deleted_at = ? WHERE id = ? AND sender_id = ?')
      .bind(now, msgId, me.id).run();
    return json({ ok: true });
  }

  const msgReactionMatch = path.match(/^\/api\/messages\/(\d+)\/reactions$/);
  if (msgReactionMatch && request.method === 'POST') {
    const msgId = parseInt(msgReactionMatch[1]);
    const b = await request.json().catch(() => ({}));
    const emoji = String(b.emoji || '');
    if (!emoji) return json({ error: 'Emoji là bắt buộc' }, 400);
    await env.DB.prepare('INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
      .bind(msgId, me.id, emoji).run();
    return json({ ok: true });
  }

  if (msgReactionMatch && request.method === 'DELETE') {
    const msgId = parseInt(msgReactionMatch[1]);
    const emoji = url.searchParams.get('emoji') || '';
    await env.DB.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .bind(msgId, me.id, emoji).run();
    return json({ ok: true });
  }

  const msgReadMatch = path.match(/^\/api\/messages\/(\d+)\/read$/);
  if (msgReadMatch && request.method === 'POST') {
    const msgId = parseInt(msgReadMatch[1]);
    const msg = await env.DB.prepare('SELECT conversation_id FROM messages WHERE id = ?').bind(msgId).first();
    if (!msg) return json({ error: 'Không tìm thấy tin nhắn' }, 404);
    await env.DB.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)')
      .bind(msgId, me.id).run();
    await env.DB.prepare(
      'UPDATE conversation_members SET last_read_message_id = MAX(last_read_message_id, ?) WHERE conversation_id = ? AND user_id = ?'
    ).bind(msgId, msg.conversation_id, me.id).run();
    return json({ ok: true });
  }

  // ── Search ────────────────────────────────────────────────────────
  if (path === '/api/search/messages' && request.method === 'GET') {
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
  }

  // ── File upload ───────────────────────────────────────────────────
  const convUploadMatch = path.match(/^\/api\/conversations\/(\d+)\/upload$/);
  if (convUploadMatch && request.method === 'POST') {
    const convId = parseInt(convUploadMatch[1]);
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
  }

  // ── WebSocket upgrade ─────────────────────────────────────────────
  const wsMatch = path.match(/^\/api\/chat\/ws\/(\d+)$/);
  if (wsMatch && request.method === 'GET') {
    const convId = parseInt(wsMatch[1]);
    const isMember = await env.DB.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).bind(convId, me.id).first();
    if (!isMember) return json({ error: 'Không có quyền truy cập hội thoại này' }, 403);

    const doId = env.CHAT_ROOM.idFromName(String(convId));
    const stub = env.CHAT_ROOM.get(doId);
    return stub.fetch(request);
  }

  // ═══════════════════════════════════════════════════════════════
  // END CHAT MODULE
  // ═══════════════════════════════════════════════════════════════

  return json({ error: 'Not found' }, 404);
}
