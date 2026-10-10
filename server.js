import { WifiController } from './server/controllers/wifi.controller.js';
import { DepartmentsController } from './server/controllers/departments.controller.js';
import { NotificationsController } from './server/controllers/notifications.controller.js';
import { AuthController } from './server/controllers/auth.controller.js';
import { UsersController } from './server/controllers/users.controller.js';
import { AttendanceController } from './server/controllers/attendance.controller.js';
import { LeaveController } from './server/controllers/leave.controller.js';
import { AuditController } from './server/controllers/audit.controller.js';
import { logSecurityEvent, isMonitoredActor } from './server/services/security-audit.service.js';
import { handleAiRoutes } from './server/controllers/ai.controller.js';
import { handleInvoiceRoutes } from './server/controllers/invoices.controller.js';
import { handleAnnouncementRoutes } from './server/controllers/announcements.controller.js';
import { ensureAnnouncementsSchema } from './server/services/announcements.service.js';
import { AssetsController } from './server/controllers/assets.controller.js';
import { recordAssetHistory, encryptCred, decryptCred } from './server/services/assets.service.js';
import {
  STANDARD_DEPARTMENTS,
  deptNormKey,
  DEPT_ALIASES,
  DEPT_LOOKUP,
  normalizeDeptName,
  deptUniqueKey,
  findDepartmentDuplicate,
  DEPT_CODE,
  employeeTypeCode,
  nextEmployeeCode,
  normalizeDepartmentData,
} from './server/services/departments.service.js';
import {
  isHrOrBod,
  isHcns,
  isBgd,
  isDeptManager,
  isDirectorHau,
  isStep1Approver,
} from './server/lib/roles.js';
import { PopupsController } from './server/controllers/popups.controller.js';
import { createEmployeePopup as createEmployeePopupService } from './server/services/popups.service.js';
import { OvertimeController } from './server/controllers/overtime.controller.js';
import { normalizeOvertimeItems, applyCalendarOvertimeCategories } from './server/services/overtime.service.js';
import { broadcastAppEvent } from './server/lib/broadcaster.js';
import { ChatController } from './server/controllers/chat.controller.js';
import {
  chatMember,
  saveMessageMentions,
  saveAllMention,
  hydrateChatMessages,
  getChatMessage,
  broadcastChatUpdate,
  getChatEmojis,
  ensureCompanyChannel,
  ensureChatInteractionSchema,
  attachChatAttachments,
} from './server/services/chat.service.js';

import { handleEvaluationRoutes } from './server/controllers/evaluations.controller.js';

import { handlePayrollRoutes } from './server/controllers/payroll.controller.js';
import {
  ensurePayrollLineChangeLog,
  ensurePayrollAdjustmentPolicySchema,
  ensurePayrollAdjustmentDismissalSchema,
  ensurePayrollDetailSchema,
  nextInvoiceNumber,
  payrollAdjustmentType,
  getPenaltyPolicyResetPreview,
  resetPenaltyPolicyAdjustments,
  buildPayrollAdjustmentSuggestions,
  refreshInvoiceOvertime,
  getVietqrBanks,
  PENALTY_POLICY_EFFECTIVE_MONTH,
  PENALTY_POLICY_RESET_CONFIRMATION,
} from './server/services/payroll.service.js';
import { vnTodayStr, vnTimeStr, vnDateTimeStr, nowStr } from './server/lib/time.js';

import { handleTaskRoutes } from './server/controllers/tasks.controller.js';
import {
  isTaskAdmin,
  canUseTaskProject,
  canUseTaskGroup,
  taskActivityAssignee,
  recordTaskActivity,
  resolveTaskLabel,
  ensureDefaultTaskGroup,
  resolveThuytttUser,
  resolveHaunvUser,
  syncThuytttFollowerToAllProjectsAndTasks,
  ensureEmployeePersonalProject,
  ensureTaskActivityTimelineSchema,
  ensureSubtaskSchema,
  ensureTaskCompletionSubscriptionsSchema,
  ensureMyxteamTaskImportSchema,
  importMyxteamProject,
  normalizeDefaultTaskGroupNames,
  taskLabelColor,
} from './server/services/tasks.service.js';

import {
  LEAVE_DOCUMENT_TYPES,
  LEAVE_DOCUMENT_MAX_BYTES,
  leavePolicyFor,
  leavePaidLabel,
  leaveDaysForSession,
  leaveBalanceType,
  getLeaveBalance,
  canManageLeaveRequest,
  canAdvanceLeaveApproval,
  ensureLeavePolicySchema,
  seedLeaveTypes,
} from './server/services/leave.service.js';
import {
  ATT_STANDARD_SHIFTS,
  ATT_EARLY_CHECKOUT_TOLERANCE_MINUTES,
  geoDistanceMeters,
  geofenceDecision,
  attToMinutes,
  isIsoDate,
  attIsoDate,
  attCountBusinessDays,
  attCountBusinessDaysBetween,
  isAttendanceWorkingDay,
  attBusinessDaysBetweenAsync,
  attShiftBounds,
  attTimeIsValid,
  attEarlyCheckoutMinutes,
  attManualTimingMetrics,
  ensureAttendanceLocationSchema,
  isGpsConstraintEnabled,
  verifyAttendanceGeofence,
  runAutoCheckout,
  syncTodayLateRecords,
  getDynamicShiftBounds,
  buildMonthlyWorkSummary,
  buildMonthlyOvertimeSummary,
} from './server/services/attendance.service.js';

import { ensureAiSchema, cosineSimilarity, generateDeterministicEmbedding } from './server/services/ai-gateway.service.js';
import { seedInitialKnowledge, hybridSearch, chunkMarkdownDocument } from './server/services/rag.service.js';
import { executeTool, runCopilotTurn } from './server/services/agent.service.js';

export {
  geoDistanceMeters,
  geofenceDecision,
  runAutoCheckout,
  syncTodayLateRecords,
  getDynamicShiftBounds,
  ensureAiSchema,
  seedInitialKnowledge,
  hybridSearch,
  chunkMarkdownDocument,
  cosineSimilarity,
  generateDeterministicEmbedding,
  executeTool,
  runCopilotTurn,
  ensureSubtaskSchema,
  ensureTaskCompletionSubscriptionsSchema,
  ensureEmployeePersonalProject,
  syncThuytttFollowerToAllProjectsAndTasks,
  resolveThuytttUser,
  resolveHaunvUser,
  broadcastAppEvent,
  chatMember,
  hydrateChatMessages,
  getChatMessage,
  broadcastChatUpdate,
  ensureChatInteractionSchema,
  ensureCompanyChannel,
};
import { hashPassword, validatePasswordPolicy, genToken, extractHrToken, resolveSession, getPlatformUser } from './server/services/auth.service.js';

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
// Chat interactions self-heal additively before the version fast path below.
// Bumped to re-run additive migrations for WFH approval columns, announcements
// tables, and all other schema additions since the previous version.
const SCHEMA_VERSION = '2026-09-19-two-step-approvals-v1';
const SEED_VERSION = '2026-08-13-add-phong-it-v1';


function getVietnameseSortKey(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.slice().reverse().join(' ');
}

function compareVietnameseNames(a, b) {
  const keyA = getVietnameseSortKey(typeof a === 'string' ? a : (a?.full_name || a?.name || a?.employee_name || a?.user_name || ''));
  const keyB = getVietnameseSortKey(typeof b === 'string' ? b : (b?.full_name || b?.name || b?.employee_name || b?.user_name || ''));
  return keyA.localeCompare(keyB, 'vi', { sensitivity: 'accent', numeric: true });
}

function sortVietnameseNames(list, key = 'full_name') {
  if (!Array.isArray(list)) return [];
  const getValue = typeof key === 'function' ? key : (item => (item && typeof item === 'object' ? item[key] : item));
  return [...list].sort((a, b) => compareVietnameseNames(getValue(a), getValue(b)));
}

async function ensureTwoStepApprovalSchema(env) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS employee_popups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    request_type TEXT NOT NULL,
    request_id INTEGER NOT NULL,
    decision TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    actor_id INTEGER,
    actor_name TEXT,
    is_dismissed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    dismissed_at TEXT
  )`);
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_employee_popups_pending ON employee_popups(user_id, is_dismissed, id ASC)'); } catch (_) {}

  // Overtime requests step 1 fields
  for (const [col, def] of Object.entries({
    step1_reviewer_id: 'INTEGER',
    step1_reviewer_name: 'TEXT',
    step1_reviewed_at: 'TEXT',
    step1_note: 'TEXT',
  })) {
    try { await env.DB.exec(`ALTER TABLE overtime_requests ADD COLUMN ${col} ${def}`); } catch (_) {}
  }

  // Overtime forms step 1 fields
  for (const [col, def] of Object.entries({
    step1_reviewer_id: 'INTEGER',
    step1_reviewer_name: 'TEXT',
    step1_reviewed_at: 'TEXT',
    step1_note: 'TEXT',
  })) {
    try { await env.DB.exec(`ALTER TABLE overtime_forms ADD COLUMN ${col} ${def}`); } catch (_) {}
  }
  try { await env.DB.exec('ALTER TABLE overtime_form_items ADD COLUMN proof_url TEXT'); } catch (_) {}

  // Attendance (WFH) step 1 fields
  for (const [col, def] of Object.entries({
    wfh_step1_reviewer_id: 'INTEGER',
    wfh_step1_reviewer_name: 'TEXT',
    wfh_step1_reviewed_at: 'TEXT',
    wfh_step1_note: 'TEXT',
  })) {
    try { await env.DB.exec(`ALTER TABLE attendance ADD COLUMN ${col} ${def}`); } catch (_) {}
  }

  // Leave requests step 1 fields
  for (const [col, def] of Object.entries({
    step1_reviewer_id: 'INTEGER',
    step1_reviewer_name: 'TEXT',
    step1_reviewed_at: 'TEXT',
    step1_note: 'TEXT',
  })) {
    try { await env.DB.exec(`ALTER TABLE leave_requests ADD COLUMN ${col} ${def}`); } catch (_) {}
  }

  // Notifications table
  try {
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC)');
  } catch (_) {}

  // Ensure national_id_issue_date column exists
  try { await env.DB.exec('ALTER TABLE users ADD COLUMN national_id_issue_date TEXT'); } catch (_) {}
}

// This audit table was introduced after some production databases had already
// reached the schema-version fast path. Keep its creation idempotent and call
// it again immediately before payroll line adjustments so an audit migration
// can never make a successful payroll update look like a failed request.
// ════════════════════════════════════════════════════════════════
//  WEB PUSH NOTIFICATIONS (RFC 8291 / RFC 8292 / VAPID)
// ════════════════════════════════════════════════════════════════
const VAPID_KEYS = {
  publicKey: 'BO1yCyvvHowbl4Vb5fsahzZH1_EScdsychTfuhOrzJOpra52gvz8csTMRYL4CVoztyNTohowAnymlVRuwbzQi0g',
  privateJwk: {
    kty: 'EC',
    crv: 'P-256',
    x: '7XILK-8ejBuXhVvl-xqHNkfX8RJx2zJyFN-6E6vMk6k',
    y: 'ra52gvz8csTMRYL4CVoztyNTohowAnymlVRuwbzQi0g',
    d: 'MwMdsfZHpo_HzYICfQz7q07q19y6B7qb2c9jeYwHDq8'
  },
  subject: 'mailto:admin@netviet.tv'
};

async function ensurePushSchema(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)').run();
  } catch (err) {
    console.error('ensurePushSchema error:', err);
  }
}

function b64Url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + pad).replace(/\-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signVapidJwt(aud) {
  const enc = new TextEncoder();
  const header = b64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64Url(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_KEYS.subject
  })));
  const unsigned = header + '.' + payload;

  const key = await crypto.subtle.importKey(
    'jwk',
    VAPID_KEYS.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    enc.encode(unsigned)
  );

  return unsigned + '.' + b64Url(new Uint8Array(sig));
}

async function hkdfExtract(saltBytes, ikmBytes) {
  const key = await crypto.subtle.importKey('raw', saltBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikmBytes));
}

async function hkdfExpand(prkBytes, infoBytes, length) {
  const key = await crypto.subtle.importKey('raw', prkBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = new Uint8Array(infoBytes.length + 1);
  infoWithCounter.set(infoBytes, 0);
  infoWithCounter[infoBytes.length] = 1;
  const okm = new Uint8Array(await crypto.subtle.sign('HMAC', key, infoWithCounter));
  return okm.slice(0, length);
}

async function encryptWebPushPayload(subscriber, payloadObj) {
  const enc = new TextEncoder();
  const clientPubRaw = b64UrlToBytes(subscriber.p256dh);
  const clientAuth = b64UrlToBytes(subscriber.auth);

  const senderKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPubRaw = await crypto.subtle.exportKey('raw', senderKeys.publicKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const importedClientPub = await crypto.subtle.importKey('raw', clientPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: importedClientPub }, senderKeys.privateKey, 256);

  const infoPrefix = enc.encode('WebPush: info\0');
  const authInfo = new Uint8Array(infoPrefix.length + clientPubRaw.byteLength + senderPubRaw.byteLength);
  authInfo.set(infoPrefix, 0);
  authInfo.set(clientPubRaw, infoPrefix.length);
  authInfo.set(new Uint8Array(senderPubRaw), infoPrefix.length + clientPubRaw.byteLength);

  const prk = await hkdfExtract(clientAuth, new Uint8Array(ecdhSecret));
  const ikm = await hkdfExpand(prk, authInfo, 32);

  const prkSalt = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prkSalt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prkSalt, enc.encode('Content-Encoding: nonce\0'), 12);

  const payloadBytes = enc.encode(JSON.stringify(payloadObj));
  const plaintext = new Uint8Array(payloadBytes.length + 1);
  plaintext.set(payloadBytes, 0);
  plaintext[payloadBytes.length] = 2;

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext);

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false);
  header[20] = 65;
  header.set(new Uint8Array(senderPubRaw), 21);

  const body = new Uint8Array(header.length + ciphertext.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(ciphertext), header.length);

  return body;
}

export async function sendWebPushNotification(env, userIds, payloadObj) {
  if (!env.DB) return { sent: 0, failed: 0, total: 0 };
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(Number).filter(Boolean);
  if (!ids.length) return { sent: 0, failed: 0, total: 0 };

  await ensurePushSchema(env);

  const placeholders = ids.map(() => '?').join(',');
  const { results: subscriptions = [] } = await env.DB.prepare(
    `SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`
  ).bind(...ids).all();

  console.log(`[WebPush] Found ${subscriptions.length} subscription(s) for userIds=[${ids.join(',')}]`);
  if (!subscriptions.length) return { sent: 0, failed: 0, total: 0 };

  let sent = 0, failed = 0;
  const promises = subscriptions.map(async (sub) => {
    try {
      const endpointUrl = new URL(sub.endpoint);
      const aud = endpointUrl.origin;
      const jwt = await signVapidJwt(aud);
      const body = await encryptWebPushPayload(sub, payloadObj);

      console.log(`[WebPush] Sending to user_id=${sub.user_id}, endpoint=${sub.endpoint.slice(0, 60)}...`);

      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `vapid t=${jwt}, k=${VAPID_KEYS.publicKey}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'TTL': '86400',
          'Urgency': 'high',
        },
        body,
      });

      const resBody = await res.text().catch(() => '');
      console.log(`[WebPush] Response: status=${res.status} ${res.statusText}, body=${resBody.slice(0, 200)}`);

      if (res.status >= 200 && res.status < 300) {
        sent++;
      } else if (res.status === 404 || res.status === 410) {
        failed++;
        console.log(`[WebPush] Removing expired subscription for user_id=${sub.user_id}`);
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      console.error('[WebPush] Push delivery error for endpoint:', sub.endpoint?.slice(0, 60), err?.message || err);
    }
  });

  await Promise.allSettled(promises);
  return { sent, failed, total: subscriptions.length };
}

export async function migrate(env) {
  if (_migrated) return;
  try { await ensureAnnouncementsSchema(env); } catch (error) { console.error('Announcements schema check failed', error); }
  try { await ensureTwoStepApprovalSchema(env); } catch (error) { console.error('Two-step approval schema check failed', error); }
  try { await syncThuytttFollowerToAllProjectsAndTasks(env); } catch (error) { console.error('THUYTTT follower sync check failed', error); }
  try { await ensureAiSchema(env); await seedInitialKnowledge(env); } catch (error) { console.error('AI schema check failed', error); }
  try {
    const row = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='schema_version'").first();
    if (row?.setting_value === SCHEMA_VERSION) {
      _migrated = true;
      return;
    }
  } catch (_) {}

  try { await ensurePushSchema(env); } catch (error) { console.error('Push schema check failed', error); }
  try { await ensureAttendanceOvertimeSchema(env); } catch (error) { console.error('Attendance schema check failed', error); }
  try { await ensureAttendanceLocationSchema(env); } catch (error) { console.error('Attendance location schema check failed', error); }
  try { await ensureProjectHandoverSchema(env); } catch (error) { console.error('Handover schema check failed', error); }
  try { await ensureTTSAccounts(env); } catch (error) { console.error('TTS accounts check failed', error); }
  try { await ensureWorkLocationStandardization(env); } catch (error) { console.error('Work location standardization check failed', error); }
  try { await ensureLeaveBalancesMigration(env); } catch (error) { console.error('Leave balance migration failed', error); }
  // Timeline columns are additive and must exist before the version fast path:
  // production databases may already carry an older matching schema marker.
  try { await ensureTaskActivityTimelineSchema(env); } catch (error) { console.error('Task timeline schema check failed', error); }
  // Subtask description column must exist before the version fast path: a production
  // database already on the current schema marker would otherwise skip the ALTER and
  // break create-subtask. Keep this idempotent and additive.
  try { await ensureSubtaskSchema(env); } catch (error) { console.error('Subtask schema check failed', error); }
  try { await ensureMyxteamTaskImportSchema(env); } catch (error) { console.error('MyXteam import schema check failed', error); }
  try { await ensureChatInteractionSchema(env); } catch (error) { console.error('Chat interaction schema check failed', error); }
  try { await ensureTaskCompletionSubscriptionsSchema(env); } catch (error) { console.error('Task completion subscriptions schema check failed', error); }
  try { await ensurePerformanceIndexes(env); } catch (error) { console.error('Performance indexes check failed', error); }
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS dissolved_conversations (
    conversation_id INTEGER PRIMARY KEY,
    dissolved_by INTEGER NOT NULL,
    dissolved_by_name TEXT,
    dissolved_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (error) { console.error('Dissolved conversation schema check failed', error); }
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
  try { await ensurePayrollAdjustmentPolicySchema(env); } catch (error) { console.error('Payroll adjustment policy schema check failed', error); }
  try { await ensurePayrollAdjustmentDismissalSchema(env); } catch (error) { console.error('Payroll adjustment dismissal schema check failed', error); }
  try { await ensurePayrollDetailSchema(env); } catch (error) { console.error('Payroll detail schema check failed', error); }
  // Repair the old unaccented default label without touching custom group names.
  try { await normalizeDefaultTaskGroupNames(env); } catch (error) { console.error('Task group label repair failed', error); }
  try { await env.DB.exec(`ALTER TABLE task_comments ADD COLUMN mentions TEXT`); } catch (_) {}
  try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_mention_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    mentioned_by INTEGER NOT NULL,
    mentioned_by_name TEXT,
    task_title TEXT,
    comment_snippet TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run(); } catch (error) { console.error('Task mention notification schema check failed', error); }
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_task_mention_notif_user_read ON task_mention_notifications(user_id,is_read,created_at DESC)').run(); } catch (_) {}
  try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS task_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run(); } catch (error) { console.error('Task attachment schema check failed', error); }
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id,created_at)').run(); } catch (_) {}
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
      description TEXT,
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
      project_id INTEGER,
      entity_type TEXT,
      entity_id INTEGER,
      entity_title TEXT,
      assignee_id INTEGER,
      assignee_name TEXT,
      actor_name TEXT,
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
      violation_date TEXT,
      policy_month TEXT,
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
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN paid_leave_days REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN absent_days REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN late_days INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN late_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN early_leave_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN missing_checkinout_days INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN tax REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN insurance REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN work_days REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN standard_days REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll ADD COLUMN note TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE invoices ADD COLUMN overtime_pay REAL DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_storage_key TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_original_filename TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_content_type TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN cv_byte_size INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN department TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN email TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE candidates ADD COLUMN phone TEXT'); } catch (_) {}
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
    violation_date TEXT,
    policy_month TEXT,
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
  // Keep the policy period distinct from the actual violation date for payroll audit/reporting.
  // These upgrades are additive so existing adjustments remain intact.
  try { await env.DB.exec('ALTER TABLE payroll_adjustments ADD COLUMN violation_date TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE payroll_adjustments ADD COLUMN policy_month TEXT'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_policy_date ON payroll_adjustments(policy_month,violation_date,employee_id)'); } catch (_) {}
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
  // Auto-checkout marker: set to 1 when the nightly scheduled job closes a day
  // the employee forgot to check out (tag "Tự động checkout").
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN auto_checkout INTEGER DEFAULT 0'); } catch (_) {}
  try {
    await env.DB.exec(`UPDATE attendance SET note = replace(replace(replace(note, '[Quên checkout]', 'Tự động checkout'), '[quên checkout]', 'Tự động checkout'), 'quên checkout', 'Tự động checkout') WHERE note LIKE '%quên checkout%' OR note LIKE '%Quên checkout%'`);
  } catch (_) {}
  // WFH approval, reason, and proof columns
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_status TEXT DEFAULT NULL"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_reason TEXT"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_proof_url TEXT"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_proof_filename TEXT"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_proof_document_id TEXT"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_reviewer_id INTEGER"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_reviewer_name TEXT"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_review_note TEXT"); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN wfh_reviewed_at TEXT"); } catch (_) {}
  try { await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_attendance_wfh_status ON attendance(wfh_status)"); } catch (_) {}
  try { await env.DB.exec("CREATE TABLE IF NOT EXISTS wfh_proof_files (id TEXT PRIMARY KEY, user_id INTEGER, filename TEXT, content_type TEXT, byte_size INTEGER, data_base64 TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))"); } catch (_) {}
  try { await env.DB.exec("UPDATE attendance SET wfh_status = 'approved' WHERE work_type = 'wfh' AND wfh_status IS NULL"); } catch (_) {}
  try {
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS announcements (
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
    )`);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (announcement_id, user_id)
    )`);
    await env.DB.exec(`CREATE TABLE IF NOT EXISTS announcement_files (
      id TEXT PRIMARY KEY,
      uploader_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT,
      byte_size INTEGER,
      storage_key TEXT,
      data_base64 TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id, announcement_id)');
  } catch (_) {}
  // Additive GPS/geofence audit. Existing IP-based attendance remains readable.
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS attendance_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, address TEXT,
    latitude REAL NOT NULL, longitude REAL NOT NULL, radius_meters INTEGER NOT NULL DEFAULT 100,
    max_accuracy_meters INTEGER NOT NULL DEFAULT 100, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_locations_code ON attendance_locations(code) WHERE code IS NOT NULL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_location_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_location_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_distance_meters REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_distance_meters REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_accuracy_meters REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_accuracy_meters REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_verification_method TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_verification_method TEXT'); } catch (_) {}
  // Raw GPS coordinates recorded at the moment of check-in/check-out — audit data,
  // NOT continuous tracking. Old rows remain readable without these columns.
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_lat REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_lng REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_lat REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_lng REAL'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_geofence_status TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_geofence_status TEXT'); } catch (_) {}
  // Soft geofence policy: outside-radius check-ins are kept but flagged for Admin review.
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_requires_review INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN checkin_review_status TEXT DEFAULT 'none'"); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_reviewed_by INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_review_note TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkin_reviewed_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_requires_review INTEGER DEFAULT 0'); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE attendance ADD COLUMN checkout_review_status TEXT DEFAULT 'none'"); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_reviewed_by INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_review_note TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE attendance ADD COLUMN checkout_reviewed_at TEXT'); } catch (_) {}
  try { await env.DB.prepare('ALTER TABLE subtasks ADD COLUMN description TEXT').run(); } catch (_) {}
  // ── Chat module ─────────────────────────────────────────────────
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'direct',
    name TEXT,
    team_id INTEGER,
    project_id INTEGER,
    created_by INTEGER NOT NULL,
    dissolved_at TEXT,
    dissolved_by INTEGER,
    dissolved_by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN team_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN project_id INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN dissolved_at TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN dissolved_by INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE conversations ADD COLUMN dissolved_by_name TEXT'); } catch (_) {}
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
    message_type TEXT NOT NULL DEFAULT 'text',
    edited_at TEXT,
    deleted_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  try { await env.DB.exec('ALTER TABLE messages ADD COLUMN task_id INTEGER'); } catch (_) {}
  try { await env.DB.exec("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'"); } catch (_) {}
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
  // Mentions are stored separately from message text so they remain queryable
  // and can never point to a user outside of the conversation.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS message_mentions (
    message_id INTEGER NOT NULL,
    mentioned_user_id INTEGER NOT NULL,
    mentioned_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(message_id, mentioned_user_id)
  )`).run();
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_message_mentions_user ON message_mentions(mentioned_user_id,message_id DESC)'); } catch (_) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pinned_messages (
    conversation_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    pinned_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(conversation_id, message_id)
  )`).run();
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_pinned_messages_conversation ON pinned_messages(conversation_id,created_at DESC)'); } catch (_) {}
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
  try { await env.DB.exec('ALTER TABLE overtime_forms ADD COLUMN proof_url TEXT'); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_form_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    requested_minutes INTEGER NOT NULL,
    approved_minutes INTEGER,
    reason TEXT NOT NULL,
    time_category TEXT NOT NULL DEFAULT 'workday',
    proof_url TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE overtime_form_items ADD COLUMN proof_url TEXT'); } catch (_) {}
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
  for (const [column, type] of Object.entries({
    current_approver:'TEXT', approval_level:'INTEGER DEFAULT 1', submitted_at:'TEXT',
    approved_by:'INTEGER', approved_by_name:'TEXT', approved_at:'TEXT',
    rejected_by:'INTEGER', rejected_by_name:'TEXT', rejected_at:'TEXT',
    rejection_note:'TEXT',
  })) { try { await env.DB.exec(`ALTER TABLE leave_requests ADD COLUMN ${column} ${type}`); } catch (_) {} }
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
  // Provenance for safe, repeatable imports from the legacy MyXteam workspace.
  // These columns are additive: existing Projects, groups and tasks are untouched.
  try { await env.DB.exec('ALTER TABLE task_projects ADD COLUMN external_source TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE task_projects ADD COLUMN external_id TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE task_groups ADD COLUMN external_source TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE task_groups ADD COLUMN external_id TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN external_source TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN external_id TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN external_metadata TEXT'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN import_position INTEGER'); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE tasks ADD COLUMN position REAL'); } catch (_) {}
  try { await env.DB.exec("INSERT INTO task_workspaces (id,name,description) SELECT 1,'Workspace NetViet HR','Default task workspace' WHERE NOT EXISTS (SELECT 1 FROM task_workspaces WHERE id=1)"); } catch (_) {}
  try { await env.DB.exec("INSERT INTO task_labels (workspace_id,name,code,color,description,is_active) SELECT 1,'Mac dinh','default','#6366F1','Nhan mac dinh' ,1 WHERE NOT EXISTS (SELECT 1 FROM task_labels WHERE workspace_id=1 AND code='default' AND project_id IS NULL)"); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id,date)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status,due_date)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(team_project_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_label ON tasks(label_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project_group_pos ON tasks(team_project_id,group_id,position)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_project_members_project_user ON task_project_members(project_id,user_id)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_groups_project_archived ON task_groups(project_id,is_archived,position)'); } catch (_) {}
  try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_task_labels_project_active ON task_labels(project_id,is_active)'); } catch (_) {}
  try { await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_task_projects_external ON task_projects(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL"); } catch (_) {}
  try { await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_task_groups_external ON task_groups(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL"); } catch (_) {}
  try { await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_source,external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL"); } catch (_) {}
  try { await ensureTaskCompletionSubscriptionsSchema(env); } catch (_) {}
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
  // Ensure TTS-31 and TTS-32 accounts exist
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)')
      .bind('schema_version', SCHEMA_VERSION).run();
  } catch (_) {}
  _migrated = true;
}

async function ensureTTSAccounts(env) {
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO users (
      employee_code, employee_type, full_name, email, password_hash, role, department, position,
      avatar_color, avatar_initials, phone, is_active, lifecycle_status, work_location, hire_date,
      must_change_password, profile_pending
    ) VALUES 
    (
      'TTS-31', 'TTS', 'Nguyễn Thị Thu Phương', 'tts-31@pending.local',
      'b6bc7b58510319a151d168ba3d5aecb3ac0a9708d06dd930f37fbc89b6cdc697',
      'employee', 'Thực Tập Sinh', 'TTS', '#4F46E5', 'TP', '', 1, 'Thực tập', 'HN', '2026-08-22', 1, 1
    ),
    (
      'TTS-32', 'TTS', 'Kim Đức Long', 'tts-32@pending.local',
      'b6bc7b58510319a151d168ba3d5aecb3ac0a9708d06dd930f37fbc89b6cdc697',
      'employee', 'Thực Tập Sinh', 'TTS', '#0EA5E9', 'DL', '', 1, 'Thực tập', 'HN', '2026-08-22', 1, 1
    )`).run();
  } catch (err) {
    console.error('ensureTTSAccounts error:', err);
  }
}

const VALID_WORK_LOCATIONS = ['HCM', 'HN', 'Phim trường Netviet'];

function normalizeWorkLocation(loc, dept = '') {
  const s = String(loc || '').trim();
  const d = String(dept || '').trim().toLowerCase();
  if (d.includes('gameshow')) return 'Phim trường Netviet';
  if (/phim trường/i.test(s)) return 'Phim trường Netviet';
  if (/^(hn|hà nội|ha noi)$/i.test(s)) return 'HN';
  if (/^(hcm|tphcm|tp\.hcm|tp hcm|hồ chí minh|ho chi minh|180|h)$/i.test(s) || s.includes('Điện Biên Phủ') || s.includes('HCM')) return 'HCM';
  if (VALID_WORK_LOCATIONS.includes(s)) return s;
  return s ? s : 'HCM';
}

async function ensureWorkLocationStandardization(env) {
  try {
    await env.DB.prepare(
      `UPDATE users SET work_location = 'Phim trường Netviet'
       WHERE (department LIKE '%Gameshow%' OR department LIKE '%gameshow%')
         AND (work_location != 'Phim trường Netviet' OR work_location IS NULL)`
    ).run();

    await env.DB.prepare(
      `UPDATE users SET work_location = 'HCM'
       WHERE (work_location LIKE '%Điện Biên Phủ%' OR work_location IN ('TPHCM', 'tp.hcm', 'H', 'hcm', 'Hồ Chí Minh', 'Văn phòng') OR work_location IS NULL OR work_location = '')
         AND department NOT LIKE '%Gameshow%' AND department NOT LIKE '%gameshow%'`
    ).run();

    await env.DB.prepare(
      `UPDATE users SET work_location = 'HN'
       WHERE work_location IN ('Hà Nội', 'ha noi', 'hn')
         AND department NOT LIKE '%Gameshow%' AND department NOT LIKE '%gameshow%'`
    ).run();
  } catch (err) {
    console.error('ensureWorkLocationStandardization error:', err);
  }
}

async function ensureLeaveBalancesMigration(env) {
  try {
    // Set 0 annual leave balance for all TTS / Probation users
    await env.DB.prepare(
      `UPDATE leave_balances SET available_days = 0, updated_at = datetime('now','localtime')
       WHERE leave_type_code = 'annual'
         AND user_id IN (
           SELECT id FROM users
           WHERE employee_type = 'TTS'
              OR contract_type = 'Thử việc'
              OR contract_type = 'Thỏa thuận TTS'
              OR lifecycle_status = 'Thử việc'
              OR lifecycle_status = 'Thực tập'
         )`
    ).run();

    // Ensure official employees have 12 annual leave days by default
    const currentYear = new Date().getFullYear();
    const officialUsers = await env.DB.prepare(
      `SELECT id FROM users
       WHERE (employee_type IS NULL OR employee_type != 'TTS')
         AND (contract_type IS NULL OR contract_type NOT IN ('Thử việc', 'Thỏa thuận TTS'))
         AND (lifecycle_status IS NULL OR lifecycle_status NOT IN ('Thử việc', 'Thực tập', 'Đã nghỉ'))
         AND is_active = 1`
    ).all().then(r => r.results || []);

    for (const u of officialUsers) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO leave_balances (user_id, leave_type_code, balance_year, available_days)
         VALUES (?, 'annual', ?, 12)`
      ).bind(u.id, currentYear).run();
    }
  } catch (err) {
    console.error('ensureLeaveBalancesMigration error:', err);
  }
}

async function ensureAttendanceOvertimeSchema(env) {
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,period_month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',source TEXT NOT NULL DEFAULT 'employee',source_batch_id INTEGER,
    review_note TEXT,reviewer_id INTEGER,reviewer_name TEXT,reviewed_at TEXT,submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`); } catch (_) {}
  try { await env.DB.exec('ALTER TABLE overtime_forms ADD COLUMN proof_url TEXT'); } catch (_) {}
  try { await env.DB.exec(`CREATE TABLE IF NOT EXISTS overtime_form_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,form_id INTEGER NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,
    requested_minutes INTEGER NOT NULL,approved_minutes INTEGER,reason TEXT NOT NULL,time_category TEXT NOT NULL DEFAULT 'workday',
    proof_url TEXT,
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
    'ALTER TABLE overtime_form_items ADD COLUMN proof_url TEXT',
    'ALTER TABLE attendance ADD COLUMN source_batch_id INTEGER',
    'ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN profile_pending INTEGER DEFAULT 0',
    'CREATE INDEX IF NOT EXISTS idx_attendance_source_batch ON attendance(source_batch_id)',
  ]) { try { await env.DB.exec(statement); } catch (_) {} }
}



// (hashPassword, validatePasswordPolicy, genToken are imported from ./server/services/auth.service.js)

function nameInitials(name) {
  return (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(-2).join('').toUpperCase();
}

function avatarColor(name) {
  const colors = ['#4F46E5', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899', '#06B6D4'];
  let h = 0;
  for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
}



async function createEmployeePopup(env, opts) {
  return createEmployeePopupService(env, { broadcastAppEvent, ...opts });
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
  personal: ['full_name','email','phone','birth_date','gender','national_id','national_id_issue_date','national_id_expiry_date','home_address','school_name','emergency_contact_name','emergency_contact_phone'],
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
  if (field === 'work_location') return normalizeWorkLocation(value);
  if (field.endsWith('_date') || field === 'hire_date' || field === 'national_id_expiry_date') {
    if (!value || value === '—' || value === '-' || value === 'null' || value === 'undefined' || value === '') return null;
    const str = String(value).trim();
    const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const dmyDash = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyDash) return `${dmyDash[3]}-${dmyDash[2].padStart(2, '0')}-${dmyDash[1].padStart(2, '0')}`;
    return str;
  }
  return typeof value === 'string' ? value.trim() : value;
}

function validateEmployeeProfile(profile, changedFields = []) {
  const changed = new Set(changedFields);
  if (!String(profile.full_name || '').trim() || !String(profile.email || '').trim() || !String(profile.department || '').trim()) {
    return 'Họ tên, email và phòng ban là bắt buộc';
  }
  const requiredFields = ['full_name','email','phone','birth_date','national_id','national_id_issue_date','home_address','position','department','direct_manager_id','work_location','contract_type'];
  if (requiredFields.some(field => changed.has(field) && !String(profile[field] ?? '').trim())) return 'Không được để trống trường bắt buộc';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email || ''))) return 'Email không hợp lệ';
  if (changed.has('phone') && !/^\+?\d{8,15}$/.test(String(profile.phone || ''))) return 'Số điện thoại phải gồm 8 đến 15 chữ số';
  if (changed.has('national_id') && !/^\d{9}(\d{3})?$/.test(String(profile.national_id || ''))) return 'Số CCCD/CMND phải gồm 9 hoặc 12 chữ số';
  if (!Number.isInteger(Number(profile.dependent_count || 0)) || Number(profile.dependent_count || 0) < 0) return 'Số người phụ thuộc không hợp lệ';
  if (profile.direct_manager_id && Number(profile.direct_manager_id) === Number(profile.id)) return 'Quản lý trực tiếp không thể là chính nhân viên';
  if (changed.has('contract_type') && profile.contract_type && !EMPLOYEE_CONTRACT_TYPES.includes(profile.contract_type)) return 'Loại hợp đồng không hợp lệ';
  for (const field of changed) {
    if (field.endsWith('_date') || field === 'hire_date') {
      const raw = profile[field];
      if (raw === '—' || raw === '-' || raw === 'null' || raw === 'undefined' || raw === '' || raw === null || raw === undefined) {
        profile[field] = null;
        continue;
      }
      const str = String(raw).trim();
      const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        profile[field] = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      } else if (/^(\d{1,2})-(\d{1,2})-(\d{4})$/.test(str)) {
        const dmyDash = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        profile[field] = `${dmyDash[3]}-${dmyDash[2].padStart(2, '0')}-${dmyDash[1].padStart(2, '0')}`;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return 'Ngày tháng không đúng định dạng (dd/mm/yyyy)';
      }
    }
  }
  const orderedPairs = [
    ['national_id_issue_date','national_id_expiry_date','Hạn CCCD phải sau ngày cấp CCCD'],
    ['probation_end_date','contract_signed_date','Ngày kết thúc thử việc phải trước hoặc bằng ngày ký hợp đồng'],
    ['probation_end_date','official_date','Ngày chính thức phải sau ngày kết thúc thử việc'],
    ['contract_start_date','contract_end_date','Ngày hết hạn hợp đồng phải sau ngày bắt đầu'],
    ['contract_signed_date','contract_end_date','Ngày hết hạn hợp đồng phải sau ngày ký hợp đồng'],
    ['contract_signed_date','termination_date','Ngày nghỉ việc phải sau ngày ký hợp đồng'],
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
    ['work_location','u.work_location'],
    ['location','u.work_location'],
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
  const cutoffDate = new Date(Date.now() - (windowDays - 1) * 86400 * 1000).toISOString().slice(0, 10);
  const conditions = ['a.date >= ?'];
  const binds = [cutoffDate];
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
           AND (lr.employee_id=a.user_id OR lr.user_id=a.user_id)
           AND a.date >= lr.start_date AND a.date <= lr.end_date
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
    if (Number(row.early_minutes || 0) > 0) {
      notifications.push({
        ...base,
        id: `attendance-early-${row.id}`,
        type: 'attendance_early',
        severity: 'warning',
        title: 'Đi về sớm',
        message: `${row.full_name} về sớm ${Number(row.early_minutes)} phút lúc ${row.checkout_time || 'chưa rõ'}`,
      });
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



// Project timeline is built on top of the existing task_activity audit table.
// Keep this strictly additive: old rows remain valid and are only joined to a
// Project when their task can still be identified.
export async function ensurePerformanceIndexes(env) {
  const indexSqls = [
    // 1. Tasks, Subtasks & Followers
    'CREATE INDEX IF NOT EXISTS idx_subtasks_task_done ON subtasks(task_id, is_done)',
    'CREATE INDEX IF NOT EXISTS idx_task_followers_task_user ON task_followers(task_id, user_id)',
    'CREATE INDEX IF NOT EXISTS idx_task_followers_user ON task_followers(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_task_comments_task_created ON task_comments(task_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_task_activity_task_created ON task_activity(task_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_task_activity_project_created ON task_activity(project_id, created_at DESC, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_team_project_group ON tasks(team_project_id, group_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_dept_status ON tasks(department, status)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status ON tasks(assigned_to, status)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_task_mention_notif_user_read ON task_mention_notifications(user_id, is_read, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, created_at)',

    // 2. Chat & Messages
    'CREATE INDEX IF NOT EXISTS idx_messages_convo_id ON messages(conversation_id, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_members_convo_user ON conversation_members(conversation_id, user_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id, last_read_message_id, conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_message_mentions_user ON message_mentions(mentioned_user_id, message_id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_pinned_messages_conversation ON pinned_messages(conversation_id, created_at DESC)',

    // 3. Attendance & Overtime
    'CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)',
    'CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date)',
    'CREATE INDEX IF NOT EXISTS idx_attendance_checkout_checkin ON attendance(checkout_time, checkin_time, date, status)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_requests_att_id ON overtime_requests(attendance_id)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_requests_user_status ON overtime_requests(user_id, status, work_date)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_forms_user_period ON overtime_forms(user_id, period_month)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_forms_status_period ON overtime_forms(status, period_month)',

    // 4. Leave
    'CREATE INDEX IF NOT EXISTS idx_leave_requests_user_status ON leave_requests(user_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_leave_requests_status_dates ON leave_requests(status, start_date, end_date)',
    'CREATE INDEX IF NOT EXISTS idx_leave_requests_approved_user ON leave_requests(status, user_id, start_date, end_date)',
    'CREATE INDEX IF NOT EXISTS idx_leave_requests_approved_emp ON leave_requests(status, employee_id, start_date, end_date)',
    'CREATE INDEX IF NOT EXISTS idx_leave_requests_dept ON leave_requests(department, status)',
    'CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id, balance_year, leave_type_code)',

    // 5. Payroll & Invoices
    'CREATE INDEX IF NOT EXISTS idx_payroll_month_user ON payroll(month, user_id)',
    'CREATE INDEX IF NOT EXISTS idx_payroll_batch ON payroll(batch_id)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_year_month ON invoices(year, month)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_employee_status ON invoices(employee_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_month_employee ON payroll_adjustments(month, employee_id)',

    // 6. Users & Sessions
    'CREATE INDEX IF NOT EXISTS idx_users_active_code ON users(is_active, employee_code)',
    'CREATE INDEX IF NOT EXISTS idx_users_active_dept ON users(is_active, department)',
    'CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at, revoked)',
  ];

  for (const sql of indexSqls) {
    try {
      await env.DB.prepare(sql).run();
    } catch (_) {
      // Idempotent: ignore if table does not exist or index already created
    }
  }
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



// ── AUTOMATED MONTHLY BACKUP TO CLOUDFLARE R2 ─────────────────────
// Complete snapshot of all SQLite/D1 tables and schemas saved directly
// to R2 bucket under backups/db/ with indefinite retention.
export async function runMonthlyBackup(env, options = {}) {
  const isManual = !!options.manual;
  const triggeredBy = options.triggeredBy || 'system_cron';
  const now = new Date(Date.now() + 7 * 3600000); // VN Time UTC+7
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const filename = `backup_${timestamp}.json`;
  const storageKey = `backups/db/${filename}`;

  // 1. Get all tables in D1 database
  const { results: tableRows = [] } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();

  const backupData = {
    version: 1,
    appName: 'nexrall-hr-manager',
    createdAt: now.toISOString(),
    createdAtVN: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`,
    triggeredBy,
    isManual,
    tableCount: tableRows.length,
    tables: {},
  };

  let totalRows = 0;
  for (const row of tableRows) {
    const tableName = row.name;
    try {
      const { results: rows = [] } = await env.DB.prepare(`SELECT * FROM "${tableName}"`).all();
      backupData.tables[tableName] = rows;
      totalRows += rows.length;
    } catch (err) {
      console.error(`Failed to export table ${tableName}`, err);
      backupData.tables[tableName] = { error: String(err?.message || err) };
    }
  }

  backupData.totalRows = totalRows;

  // 2. Put snapshot into R2 Bucket
  let sizeBytes = 0;
  if (env.HR_DOCUMENTS) {
    const jsonStr = JSON.stringify(backupData);
    sizeBytes = jsonStr.length;
    await env.HR_DOCUMENTS.put(storageKey, jsonStr, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        totalRows: String(totalRows),
        tableCount: String(tableRows.length),
        createdAt: backupData.createdAt,
        triggeredBy,
        isManual: String(isManual),
      },
    });
  }

  return {
    success: true,
    storageKey,
    filename,
    tableCount: tableRows.length,
    totalRows,
    sizeBytes,
    createdAt: backupData.createdAt,
    createdAtVN: backupData.createdAtVN,
  };
}

export async function handleScheduled(event, env) {
  const results = {};
  try {
    results.autoCheckout = await runAutoCheckout(env);
    console.log('auto-checkout completed', JSON.stringify(results.autoCheckout));
  } catch (error) {
    console.error('auto-checkout failed', String(error?.message || error), error?.stack);
    results.autoCheckout = { error: String(error?.message || error) };
  }

  // Monthly backup: triggers on day 1 of month or when matched by monthly cron
  try {
    const vnDate = new Date(Date.now() + 7 * 3600000);
    const isFirstDayOfMonth = vnDate.getUTCDate() === 1;
    const cronSchedule = event?.cron;
    if (isFirstDayOfMonth || cronSchedule === '0 18 1 * *') {
      results.monthlyBackup = await runMonthlyBackup(env, { triggeredBy: `cron:${cronSchedule || 'day_1'}` });
      console.log('monthly-backup completed', JSON.stringify(results.monthlyBackup));
    }
  } catch (backupError) {
    console.error('monthly-backup failed', String(backupError?.message || backupError), backupError?.stack);
    results.monthlyBackup = { error: String(backupError?.message || backupError) };
  }

  return results;
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

async function checkUserDeletionEligibility(env, userId) {
  const user = await env.DB.prepare(
    'SELECT id, full_name, employee_code, termination_date, hire_date, created_at FROM users WHERE id=?'
  ).bind(userId).first();
  if (!user) return { eligible: false, error: 'Không tìm thấy tài khoản nhân viên' };

  // Check if account has any attendance, payroll or invoice records at all
  const attCountRow = await env.DB.prepare('SELECT COUNT(*) as c FROM attendance WHERE user_id=?').bind(userId).first();
  const payrollCountRow = await env.DB.prepare('SELECT COUNT(*) as c FROM payroll WHERE employee_id=? OR user_id=?').bind(userId, String(userId)).first();
  const invoiceCountRow = await env.DB.prepare('SELECT COUNT(*) as c FROM invoices WHERE user_id=?').bind(userId).first();

  const totalAtt = Number(attCountRow?.c || 0);
  const totalPayroll = Number(payrollCountRow?.c || 0);
  const totalInvoices = Number(invoiceCountRow?.c || 0);

  // Accidental / test account with 0 work/salary activity
  if (totalAtt === 0 && totalPayroll === 0 && totalInvoices === 0) {
    return { eligible: true, is_test_account: true };
  }

  // Determine target final working month & year
  let targetMonth = null;
  let targetYear = null;

  // 1. Check termination_date first
  if (user.termination_date) {
    const raw = String(user.termination_date).trim();
    if (/^\d{4}-\d{2}/.test(raw)) {
      const parts = raw.split('-');
      targetYear = parseInt(parts[0], 10);
      targetMonth = parseInt(parts[1], 10);
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
      const parts = raw.split('/');
      targetMonth = parseInt(parts[1], 10);
      targetYear = parseInt(parts[2], 10);
    }
  }

  // 2. If no valid termination_date, check latest attendance date
  if (!targetMonth || !targetYear) {
    const latestAtt = await env.DB.prepare(
      'SELECT MAX(date) as max_date FROM attendance WHERE user_id=?'
    ).bind(userId).first();
    if (latestAtt?.max_date) {
      const raw = String(latestAtt.max_date).trim();
      if (/^\d{4}-\d{2}/.test(raw)) {
        const parts = raw.split('-');
        targetYear = parseInt(parts[0], 10);
        targetMonth = parseInt(parts[1], 10);
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
        const parts = raw.split('/');
        targetMonth = parseInt(parts[1], 10);
        targetYear = parseInt(parts[2], 10);
      }
    }
  }

  // 3. If still no date, check latest payroll or invoice month
  if (!targetMonth || !targetYear) {
    const latestInv = await env.DB.prepare(
      'SELECT year, month FROM invoices WHERE user_id=? ORDER BY year DESC, month DESC LIMIT 1'
    ).bind(userId).first();
    if (latestInv) {
      targetYear = Number(latestInv.year);
      targetMonth = Number(latestInv.month);
    }
  }

  // 4. Fallback: if user is active up to now, previous month relative to now (Vietnam time UTC+7)
  const now = new Date(Date.now() + 7 * 3600000);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-12

  if (!targetMonth || !targetYear) {
    if (currentMonth === 1) {
      targetMonth = 12;
      targetYear = currentYear - 1;
    } else {
      targetMonth = currentMonth - 1;
      targetYear = currentYear;
    }
  }

  // Format month string for display: e.g. "09/2026"
  const monthStr = `${String(targetMonth).padStart(2, '0')}/${targetYear}`;

  // Check the invoice for targetMonth/targetYear
  const invoice = await env.DB.prepare(
    'SELECT id, invoice_number, status, employee_confirmed_at FROM invoices WHERE user_id=? AND month=? AND year=? LIMIT 1'
  ).bind(userId, targetMonth, targetYear).first();

  if (!invoice) {
    return {
      eligible: false,
      target_month: targetMonth,
      target_year: targetYear,
      month_str: monthStr,
      has_invoice: false,
      is_confirmed: false,
      reason: `Chưa có phiếu lương tháng ${monthStr} trên hệ thống.`
    };
  }

  const isConfirmed = !!(invoice.employee_confirmed_at || invoice.status === 'employee_confirmed' || invoice.status === 'paid');

  if (!isConfirmed) {
    return {
      eligible: false,
      target_month: targetMonth,
      target_year: targetYear,
      month_str: monthStr,
      has_invoice: true,
      invoice_number: invoice.invoice_number,
      is_confirmed: false,
      reason: `Nhân viên chưa bấm xác nhận phiếu lương tháng ${monthStr} (${invoice.invoice_number}) trên ứng dụng.`
    };
  }

  return {
    eligible: true,
    target_month: targetMonth,
    target_year: targetYear,
    month_str: monthStr,
    has_invoice: true,
    invoice_number: invoice.invoice_number,
    is_confirmed: true
  };
}

async function seedDepartments(env) {
  const rows = STANDARD_DEPARTMENTS.map(name => [name, '']);
  // Always INSERT OR IGNORE so newly added standard departments (e.g. Phòng IT)
  // are created even when the table already has data.
  await env.DB.batch(rows.map(([name, description]) => env.DB.prepare(
    'INSERT OR IGNORE INTO departments (user_id,name,manager,description) VALUES (?,?,?,?)'
  ).bind(1, name, '', description)));
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
    ['work_start','08:30'],['work_end','17:00'],['late_threshold','5'],['work_days','1,2,3,4,5,6'],
    ['attendance_gps_constraint','1'],
  ];
  await env.DB.batch(defaults.map(([k,v]) =>
    env.DB.prepare('INSERT OR IGNORE INTO settings (setting_key,setting_value) VALUES (?,?)').bind(k,v)
  ));
  await env.DB.prepare('INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)')
    .bind('seed_version', SEED_VERSION).run();
  _seeded = true;
}

// (extractHrToken, getSessionFromToken, resolveSession, getPlatformUser are imported from ./server/services/auth.service.js)

// ===================== MAIN HANDLER =====================
export async function handle(request, env, ctx) {
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

  // ── AUDIT: DASHBOARD UI & INGESTION (CHỈ MỞ TRÊN DEMO WORKER) ────
  const isAuditDemo = url.hostname.includes('demo') || String(env?.ENVIRONMENT || '').toLowerCase() === 'demo';
  if (isAuditDemo) {
    if (path === '/audit' || path === '/audit/' || path === '/admin-audit') {
      return AuditController.renderUi();
    }
    if (path === '/api/audit/ingest' && request.method === 'POST') {
      return AuditController.ingest({ env, request, executionCtx: ctx });
    }
    if (path === '/api/audit/logs' && request.method === 'GET') {
      return AuditController.getLogs({ env, request });
    }
    if (path === '/api/audit/logs' && request.method === 'DELETE') {
      return AuditController.clearLogs({ env, request });
    }
  } else {
    // Production hoàn toàn không mở route audit nào
    if (path === '/audit' || path === '/audit/' || path === '/admin-audit' || path.startsWith('/api/audit/')) {
      return json({ error: 'Không tìm thấy' }, 404);
    }
  }

  try {
    await migrate(env);
    // Seed data is already versioned. Never make an operational API request
    // fail merely because a legacy seed repair cannot run on this database.
    try { await seedIfNeeded(env); } catch (error) { console.error('Seed check failed', error); }
  } catch (e) {
    console.error('DB init failed', e);
    return json({ error: 'Không thể khởi tạo dữ liệu, vui lòng thử lại sau' }, 500);
  }

  // ── GET CLIENT IP ────────────────────────────────────────────────
  if (path === '/api/get-ip') {
    return json(await currentIpInfo(env, request));
  }

  // ── REAL-TIME SYNC HUB (WebSocket, SSE & Stats) ───────────────────
  if (path === '/api/realtime/ws' || path === '/api/realtime/events' || path === '/api/realtime/stats') {
    const hubBinding = env?.SYNC_HUB || env?.APP_SYNC_HUB;
    if (!hubBinding) return json({ error: 'AppSyncHub chưa được cấu hình' }, 503);
    const doId = hubBinding.idFromName('global');
    const stub = hubBinding.get(doId);
    return stub.fetch(request);
  }

  // ── DEBUG: inspect auth headers ─────────────────────────────────
  // Never expose request credentials or platform identity in production.
  if (path === '/api/debug-auth') return json({ error: 'Không tìm thấy' }, 404);



  // ── AUTH: LOGIN ──────────────────────────────────────────────────
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    return AuthController.login({ env, request, executionCtx: ctx }, rateLimit);
  }

  // ── AUTH: LOGOUT ─────────────────────────────────────────────────
  if (path === '/api/auth/logout' && request.method === 'POST') {
    return AuthController.logout({ env, request, executionCtx: ctx });
  }

  // ── AUTH: ME ─────────────────────────────────────────────────────
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    return AuthController.me({ env, request });
  }

  // ── AUTH: CHANGE PASSWORD ────────────────────────────────────────
  if (path === '/api/auth/change-password' && (request.method === 'PUT' || request.method === 'POST')) {
    return AuthController.changePassword({ env, request, executionCtx: ctx }, rateLimit);
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
      employee_code: mainSession.employee_code, work_location: mainSession.work_location, salary: mainSession.salary,
      phone: mainSession.phone, bank_account: mainSession.bank_account,
      bank_name: mainSession.bank_name, is_active: mainSession.is_active,
      lifecycle_status: mainSession.lifecycle_status, must_change_password: !!mainSession.must_change_password,
    };
  }

  if (!me) {
    return json({ error: 'Chưa đăng nhập hoặc phiên hết hạn', code: 'UNAUTHORIZED' }, 401);
  }

  // ── LOG ALL ACTIONS OF MONITORED ADMIN ─────────────────────────────
  if (me && isMonitoredActor(me) && !path.startsWith('/api/audit/')) {
    logSecurityEvent(env, ctx, {
      url: request.url,
      event_type: 'API_ACTION',
      actor_id: me.id,
      actor_email: me.email,
      actor_code: me.employee_code,
      method: request.method,
      path: url.pathname + (url.search || ''),
      status_code: 200,
      ip_address: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown',
      country: request.headers.get('cf-ipcountry') || '',
      user_agent: request.headers.get('user-agent') || '',
      referer: request.headers.get('referer') || '',
      response_summary: `API call by monitored admin: ${me.email} (${me.employee_code})`
    });
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

  // ── EMPLOYEE DECISION POPUPS ─────────────────────────────────────
  if (path === '/api/employee/popups/pending' && request.method === 'GET') {
    return PopupsController.listPending({ env, me });
  }

  const dismissPopupMatch = path.match(/^\/api\/employee\/popups\/(\d+)\/dismiss$/);
  if (dismissPopupMatch && request.method === 'POST') {
    return PopupsController.dismiss({ env, me }, parseInt(dismissPopupMatch[1], 10));
  }

  // Executive dashboard deliberately returns aggregates only.  It is an Admin
  // surface, so no salary, identity or private document data is exposed.
  // Executive HR & Management Dashboard (Organization-wide metrics)
  // Executive HR & Management Dashboard (Organization-wide metrics)
  if (path === '/api/dashboard/admin' && request.method === 'GET') {
    if (!isAdmin && !isManager && !isHcns(me)) return json({ error: 'Không có quyền' }, 403);
    const today = vnTodayStr();
    const [year, month] = today.slice(0, 7).split('-').map(Number);

    // Compute last 6 months list
    const last6Months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `T${d.getMonth() + 1}`;
      last6Months.push({ month: mStr, label });
    }

    try {
      const [
        peopleRow,
        prevPeopleRow,
        attendanceRow,
        attTrendRows,
        deptSalaryRows,
        approvalRow,
        kpiRow,
        recruitmentRow,
        campaignRow,
        campaignItems,
        alerts,
        expiringContractsRows,
        otFormsMonthRow,
        otTodayRow,
        monthLeaveRows
      ] = await Promise.all([
        // Current active headcount & hires
        env.DB.prepare(`SELECT 
          COUNT(*) active, 
          SUM(CASE WHEN employee_type='TTS' THEN 1 ELSE 0 END) interns, 
          SUM(CASE WHEN lower(coalesce(lifecycle_status,'')) LIKE '%thử việc%' THEN 1 ELSE 0 END) probation, 
          SUM(CASE WHEN hire_date LIKE ? THEN 1 ELSE 0 END) new_hires_month,
          (SELECT COUNT(*) FROM users WHERE is_active=0 OR lower(coalesce(lifecycle_status,'')) LIKE '%nghỉ việc%') departures_month
        FROM users WHERE is_active=1`).bind(`${today.slice(0,7)}-%`).first().catch(() => ({ active: 0 })),

        // Previous month active headcount (to compute growth %)
        env.DB.prepare(`SELECT COUNT(*) total_prev FROM users WHERE is_active=1 AND (hire_date IS NULL OR hire_date < ?)`).bind(`${today.slice(0,7)}-01`).first().catch(() => ({ total_prev: 0 })),

        // Today attendance breakdown
        env.DB.prepare(`SELECT 
          COUNT(DISTINCT u.id) eligible, 
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NOT NULL THEN u.id END) checked_in, 
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NOT NULL AND a.work_type='office' THEN u.id END) office,
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NOT NULL AND a.work_type='wfh' THEN u.id END) wfh,
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NOT NULL AND a.work_type='business' THEN u.id END) business,
          COUNT(DISTINCT CASE WHEN coalesce(a.late_minutes,0)>0 THEN u.id END) late, 
          COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN u.id END) approved_leave, 
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NULL AND l.id IS NULL THEN u.id END) not_checked_in,
          COUNT(DISTINCT CASE WHEN a.checkin_requires_review=1 OR a.checkin_review_status='pending' THEN u.id END) unreviewed_checkins
        FROM users u 
        LEFT JOIN attendance a ON a.user_id=u.id AND a.date=? 
        LEFT JOIN leave_requests l ON l.employee_id=u.id AND l.status='approved' AND date(l.start_date)<=date(?) AND date(l.end_date)>=date(?) 
        WHERE u.is_active=1`).bind(today,today,today).first().catch(() => ({})),

        // 7-day attendance trend
        env.DB.prepare(`SELECT a.date, COUNT(DISTINCT a.user_id) count
        FROM attendance a 
        WHERE a.date >= date(?,'-6 day') AND a.checkin_time IS NOT NULL
        GROUP BY a.date ORDER BY a.date ASC`).bind(today).all().catch(() => ({ results: [] })),

        // Department headcount & attendance metrics
        env.DB.prepare(`SELECT 
          coalesce(nullif(u.department,''), 'Chưa phân phòng') department, 
          COUNT(DISTINCT u.id) headcount, 
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NOT NULL THEN u.id END) checked_in,
          COUNT(DISTINCT CASE WHEN coalesce(a.late_minutes,0) > 0 THEN u.id END) late,
          COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN u.id END) approved_leave,
          COUNT(DISTINCT CASE WHEN a.checkin_time IS NULL AND l.id IS NULL THEN u.id END) not_checked_in,
          COALESCE(SUM(u.salary), 0) total_salary 
        FROM users u 
        LEFT JOIN attendance a ON a.user_id=u.id AND a.date=?
        LEFT JOIN leave_requests l ON l.employee_id=u.id AND l.status='approved' AND date(l.start_date)<=date(?) AND date(l.end_date)>=date(?)
        WHERE u.is_active=1 
        GROUP BY coalesce(nullif(u.department,''), 'Chưa phân phòng') 
        ORDER BY headcount DESC`).bind(today, today, today).all().catch(() => ({ results: [] })),

        // Pending approvals
        env.DB.prepare(`SELECT 
          (SELECT COUNT(*) FROM leave_requests WHERE status='pending') leave_count, 
          (SELECT (SELECT COUNT(*) FROM overtime_requests WHERE status='pending') + (SELECT COUNT(*) FROM overtime_forms WHERE status='pending')) overtime_count, 
          (SELECT COUNT(*) FROM employee_kpi_plans WHERE month=? AND year=? AND status='SUBMITTED') kpi_count,
          (SELECT COUNT(*) FROM evaluations WHERE status IN ('MENTOR_REVIEW','EMPLOYEE_REVISION_REQUESTED','CEO_REVISION_REQUESTED','PENDING_CEO_APPROVAL')) eval_count
        `).bind(month,year).first().catch(() => ({})),

        // KPI coverage
        env.DB.prepare(`SELECT COUNT(*) eligible_employees, 
          SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) with_plan, 
          SUM(CASE WHEN p.status='DRAFT' THEN 1 ELSE 0 END) draft, 
          SUM(CASE WHEN p.status='SUBMITTED' THEN 1 ELSE 0 END) submitted, 
          SUM(CASE WHEN p.status='APPROVED' THEN 1 ELSE 0 END) approved, 
          SUM(CASE WHEN p.status='RETURNED' THEN 1 ELSE 0 END) returned 
        FROM users u 
        LEFT JOIN employee_kpi_plans p ON p.employee_id=u.id AND p.month=? AND p.year=? 
        WHERE u.is_active=1`).bind(month,year).first().catch(() => ({})),

        // Recruitment pipeline
        env.DB.prepare(`SELECT 
          SUM(CASE WHEN stage NOT IN ('hired','rejected') THEN 1 ELSE 0 END) active, 
          SUM(CASE WHEN stage='received' THEN 1 ELSE 0 END) received, 
          SUM(CASE WHEN stage='screening' THEN 1 ELSE 0 END) screening, 
          SUM(CASE WHEN stage IN ('interview1','interview2') THEN 1 ELSE 0 END) interview, 
          SUM(CASE WHEN stage='offer' THEN 1 ELSE 0 END) offer, 
          SUM(CASE WHEN stage='hired' AND apply_date LIKE ? THEN 1 ELSE 0 END) hired_this_month 
        FROM candidates`).bind(`${today.slice(0,7)}-%`).first().catch(() => ({})),

        // Campaigns
        env.DB.prepare(`SELECT COUNT(*) active, COALESCE(SUM(budget),0) budget, COALESCE(SUM(spent),0) spent FROM campaigns WHERE status='active'`).first().catch(() => ({ active: 0 })),
        env.DB.prepare(`SELECT id,name,budget,spent,goal_leads,goal_conversions FROM campaigns WHERE status='active' ORDER BY CASE WHEN budget>0 THEN spent*1.0/budget ELSE 0 END DESC,id DESC LIMIT 3`).all().catch(() => ({ results: [] })),
        buildEmployeeAlerts(env, 30).catch(() => []),

        // Expiring contracts within 30 days
        env.DB.prepare(`SELECT id, full_name, employee_code, department, contract_end_date, contract_type
        FROM users 
        WHERE is_active=1 AND contract_end_date IS NOT NULL 
          AND date(contract_end_date) BETWEEN date('now') AND date('now', '+30 day')
        ORDER BY contract_end_date ASC LIMIT 8`).all().catch(() => ({ results: [] })),

        // OT forms approved minutes in current month
        env.DB.prepare(`SELECT 
          COALESCE(SUM(i.approved_minutes), 0) approved_minutes,
          COALESCE(SUM(i.requested_minutes), 0) requested_minutes,
          COUNT(DISTINCT f.user_id) employee_count,
          COUNT(DISTINCT f.id) form_count
        FROM overtime_forms f 
        JOIN overtime_form_items i ON i.form_id=f.id 
        WHERE f.period_month=? AND f.status IN ('approved','partially_approved')`).bind(today.slice(0,7)).first().catch(() => ({})),

        // OT today count (from overtime_requests and overtime_forms)
        env.DB.prepare(`SELECT COUNT(DISTINCT user_id) count FROM overtime_forms f JOIN overtime_form_items i ON i.form_id=f.id WHERE f.status IN ('approved','partially_approved') AND date(i.start_at)=?`).bind(today).first().catch(() => ({ count: 0 })),

        // Month total approved leaves
        env.DB.prepare(`SELECT COUNT(*) total_leave_count FROM leave_requests WHERE status='approved' AND (start_date LIKE ? OR end_date LIKE ?)`).bind(`${today.slice(0,7)}-%`, `${today.slice(0,7)}-%`).first().catch(() => ({ total_leave_count: 0 }))
      ]);

      // 6-Month Fluctuation data
      const fluctuationPromises = last6Months.map(async item => {
        try {
          const hires = await env.DB.prepare(`SELECT COUNT(*) c FROM users WHERE hire_date LIKE ?`).bind(`${item.month}-%`).first().catch(() => ({ c: 0 }));
          const leaves = await env.DB.prepare(`SELECT COUNT(*) c FROM users WHERE is_active=0 AND created_at LIKE ?`).bind(`${item.month}-%`).first().catch(() => ({ c: 0 }));
          return {
            month: item.month,
            label: item.label,
            hires: Number(hires?.c || 0),
            departures: Number(leaves?.c || 0)
          };
        } catch (_) {
          return { month: item.month, label: item.label, hires: 0, departures: 0 };
        }
      });
      const fluctuationData = await Promise.all(fluctuationPromises);

      // Calculate People KPIs
      const activeHeadcount = Number(peopleRow?.active || 0);
      const prevTotal = Number(prevPeopleRow?.total_prev || activeHeadcount);
      const growthPercent = prevTotal > 0 ? Number(((activeHeadcount - prevTotal) / prevTotal * 100).toFixed(1)) : 0;
      const people = {
        active: activeHeadcount,
        prev_total: prevTotal,
        growth_percent: growthPercent,
        interns: Number(peopleRow?.interns || 0),
        probation: Number(peopleRow?.probation || 0),
        new_hires_month: Number(peopleRow?.new_hires_month || 0),
        departures_month: Number(peopleRow?.departures_month || 0)
      };

      // Calculate Turnover Rate for current month
      const turnoverRate = activeHeadcount > 0 ? Number((people.departures_month / activeHeadcount * 100).toFixed(2)) : 0;

      // Monthly Attendance Trend (Excluding Sundays / non-working days)
      const monthlyAttendancePromises = last6Months.map(async item => {
        try {
          const [y, m] = item.month.split('-').map(Number);
          const isCurrentMonth = item.month === today.slice(0, 7);
          const lastDay = isCurrentMonth ? Number(today.slice(8, 10)) : new Date(y, m, 0).getDate();
          
          let workingDaysCount = 0;
          for (let d = 1; d <= lastDay; d++) {
            const dayOfWeek = new Date(y, m - 1, d).getDay();
            if (dayOfWeek !== 0) { // Exclude Sunday
              workingDaysCount++;
            }
          }
          workingDaysCount = Math.max(1, workingDaysCount);

          const attCountRow = await env.DB.prepare(`
            SELECT 
              COUNT(DISTINCT a.user_id || '_' || a.date) as checkins,
              COUNT(DISTINCT a.date) as active_dates
            FROM attendance a
            WHERE a.date LIKE ? 
              AND a.checkin_time IS NOT NULL
              AND strftime('%w', a.date) != '0'
          `).bind(`${item.month}-%`).first().catch(() => ({ checkins: 0, active_dates: 0 }));

          const checkins = Number(attCountRow?.checkins || 0);
          const activeDates = Number(attCountRow?.active_dates || 0);
          let rate = 0;
          if (activeHeadcount > 0 && activeDates > 0) {
            rate = Math.min(100, Math.round((checkins / (activeDates * activeHeadcount)) * 100));
          } else if (activeHeadcount > 0 && isCurrentMonth) {
            rate = Math.round(checkinRate);
          }

          return {
            month: item.month,
            label: item.label,
            working_days: workingDaysCount,
            active_dates: activeDates,
            checkins,
            rate: rate || (isCurrentMonth ? Math.round(checkinRate) : 0)
          };
        } catch (_) {
          return { month: item.month, label: item.label, working_days: 26, checkins: 0, rate: 0 };
        }
      });
      const monthlyAttendance = await Promise.all(monthlyAttendancePromises);

      // Attendance Data
      const checkedIn = Number(attendanceRow?.checked_in || 0);
      const eligible = Number(attendanceRow?.eligible || activeHeadcount);
      const checkinRate = eligible ? Number((checkedIn / eligible * 100).toFixed(1)) : 0;
      const attendance = {
        date: today,
        eligible,
        checked_in: checkedIn,
        office: Number(attendanceRow?.office || (checkedIn - Number(attendanceRow?.wfh || 0))),
        wfh: Number(attendanceRow?.wfh || 0),
        business: Number(attendanceRow?.business || 0),
        late: Number(attendanceRow?.late || 0),
        approved_leave: Number(attendanceRow?.approved_leave || 0),
        not_checked_in: Number(attendanceRow?.not_checked_in || Math.max(0, eligible - checkedIn - Number(attendanceRow?.approved_leave || 0))),
        unreviewed_checkins: Number(attendanceRow?.unreviewed_checkins || 0),
        checkin_rate: checkinRate,
        monthly_trend: monthlyAttendance,
        trend: (attTrendRows?.results || []).map(r => ({
          date: r.date,
          day: r.date.slice(8, 10),
          checked_in: Number(r.count || 0),
          rate: eligible > 0 ? Math.round(Number(r.count || 0) / eligible * 100) : 0
        }))
      };

      // Department Headcount & Attendance Metrics
      const depts = (deptSalaryRows?.results || []).map(d => {
        const hc = Number(d.headcount || 0);
        const ci = Number(d.checked_in || 0);
        const rate = hc > 0 ? Math.round((ci / hc) * 100) : 0;
        return {
          department: d.department,
          headcount: hc,
          checked_in: ci,
          late: Number(d.late || 0),
          approved_leave: Number(d.approved_leave || 0),
          not_checked_in: Number(d.not_checked_in || Math.max(0, hc - ci - Number(d.approved_leave || 0))),
          checkin_rate: rate,
          total_salary: Number(d.total_salary || 0),
          headcount_percent: activeHeadcount > 0 ? Number((hc / activeHeadcount * 100).toFixed(1)) : 0
        };
      });
      const totalPayroll = depts.reduce((sum, d) => sum + d.total_salary, 0);
      depts.forEach(d => {
        d.salary_percent = totalPayroll > 0 ? Number((d.total_salary / totalPayroll * 100).toFixed(1)) : 0;
        d.avg_salary = d.headcount > 0 ? Math.round(d.total_salary / d.headcount) : 0;
      });

      // Approvals & Action Items
      const approvals = {
        leave: Number(approvalRow?.leave_count || 0),
        overtime: Number(approvalRow?.overtime_count || 0),
        kpi: Number(approvalRow?.kpi_count || 0),
        eval: Number(approvalRow?.eval_count || 0)
      };
      approvals.total = approvals.leave + approvals.overtime + approvals.kpi + approvals.eval;

      const expiringContracts = expiringContractsRows?.results || [];

      // Action Center Items
      const action_items = [];
      if (approvals.leave > 0) {
        action_items.push({
          severity: 'danger',
          icon: '🏖️',
          title: `${approvals.leave} đơn nghỉ phép chờ duyệt`,
          detail: 'Cần HCNS / Quản lý phê duyệt để cập nhật lịch công.',
          action_url: '#/leave',
          action_label: 'Duyệt nghỉ phép'
        });
      }
      if (approvals.overtime > 0) {
        action_items.push({
          severity: 'warning',
          icon: '⏱️',
          title: `${approvals.overtime} yêu cầu & form OT chờ duyệt`,
          detail: 'Phiếu làm thêm giờ cần xác nhận số giờ làm thực tế.',
          action_url: '#/attendance',
          action_label: 'Duyệt OT'
        });
      }
      if (expiringContracts.length > 0) {
        action_items.push({
          severity: 'danger',
          icon: '📝',
          title: `${expiringContracts.length} hợp đồng sắp hết hạn trong 30 ngày`,
          detail: `${expiringContracts.slice(0, 3).map(c => c.full_name).join(', ')}${expiringContracts.length > 3 ? '...' : ''}`,
          action_url: '#/users',
          action_label: 'Xem hợp đồng'
        });
      }
      if (attendance.unreviewed_checkins > 0) {
        action_items.push({
          severity: 'warning',
          icon: '📍',
          title: `${attendance.unreviewed_checkins} chấm công cần duyệt vị trí`,
          detail: 'Nhân viên check-in ngoài phạm vi văn phòng / địa điểm quy định.',
          action_url: '#/attendance',
          action_label: 'Xem vị trí'
        });
      }
      if (attendance.not_checked_in > 0) {
        action_items.push({
          severity: 'info',
          icon: '❓',
          title: `${attendance.not_checked_in} nhân viên chưa chấm công hôm nay`,
          detail: 'Chưa có check-in và không có đơn nghỉ phép được duyệt.',
          action_url: '#/attendance',
          action_label: 'Kiểm tra'
        });
      }
      if (approvals.kpi > 0 || approvals.eval > 0) {
        action_items.push({
          severity: 'info',
          icon: '🎯',
          title: `${approvals.kpi + approvals.eval} đánh giá KPI & hiệu suất cần xử lý`,
          detail: 'Kế hoạch KPI và phiếu đánh giá định kỳ đang chờ xác nhận.',
          action_url: '#/kpis',
          action_label: 'Xem KPI'
        });
      }

      // Overtime Company Stats
      const otStats = {
        pending_count: approvals.overtime,
        ot_today_count: Number(otTodayRow?.count || 0),
        ot_month_hours: Number((Number(otFormsMonthRow?.approved_minutes || 0) / 60).toFixed(1)),
        ot_month_requested_hours: Number((Number(otFormsMonthRow?.requested_minutes || 0) / 60).toFixed(1)),
        ot_employee_count: Number(otFormsMonthRow?.employee_count || 0),
        ot_form_count: Number(otFormsMonthRow?.form_count || 0)
      };

      // Leave Company Stats
      const leaveStats = {
        pending_count: approvals.leave,
        today_leave_count: attendance.approved_leave,
        month_total_approved: Number(monthLeaveRows?.total_leave_count || 0)
      };

      // Recruitment Stats
      const recruitment = {
        active: Number(recruitmentRow?.active || 0),
        received: Number(recruitmentRow?.received || 0),
        screening: Number(recruitmentRow?.screening || 0),
        interview: Number(recruitmentRow?.interview || 0),
        offer: Number(recruitmentRow?.offer || 0),
        hired_this_month: Number(recruitmentRow?.hired_this_month || 0),
        open_positions: Number(campaignRow?.active || 0)
      };

      const kpi = {
        month,
        year,
        eligible_employees: Number(kpiRow?.eligible_employees || 0),
        with_plan: Number(kpiRow?.with_plan || 0),
        draft: Number(kpiRow?.draft || 0),
        submitted: Number(kpiRow?.submitted || 0),
        approved: Number(kpiRow?.approved || 0),
        returned: Number(kpiRow?.returned || 0),
        coverage_percent: Number(kpiRow?.eligible_employees ? (Number(kpiRow.with_plan) / Number(kpiRow.eligible_employees) * 100).toFixed(1) : 0)
      };

      return json({
        generated_at: `${today} ${vnTimeStr()}`,
        scope: 'organization',
        people,
        turnover_rate: turnoverRate,
        attendance,
        departments: depts,
        total_payroll: totalPayroll,
        fluctuation: fluctuationData,
        ot_stats: otStats,
        leave_stats: leaveStats,
        recruitment,
        kpi,
        action_items,
        expiring_contracts: expiringContracts
      });
    } catch (err) {
      console.error('getAdminDashboard error:', err?.message || err);
      return json({ error: err?.message || 'Lỗi xử lý dữ liệu dashboard' }, 500);
    }
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
    return UsersController.directory({ env, request, isAdmin, me }, {
      sortVietnameseNames,
      ensureWorkLocationStandardization,
      isManager,
      isHcns
    });
  }

  if (path === '/api/users/export.xls' && request.method === 'GET') {
    return UsersController.exportXls({ env, request, isAdmin, me }, {
      sortVietnameseNames,
      isHcns
    });
  }

  if (path === '/api/users/alerts' && request.method === 'GET') {
    return UsersController.alerts({ env, request, isAdmin, me }, {
      isHcns,
      buildEmployeeAlerts
    });
  }

  // ── Web Push Notification Endpoints (PWA / Lock Screen) ────────────
  if (path === '/api/notifications/push-vapid-public-key' && request.method === 'GET') {
    return NotificationsController.getPushVapidPublicKey({ env, request, isAdmin, me }, VAPID_KEYS.publicKey);
  }

  if (path === '/api/notifications/push-subscribe' && request.method === 'POST') {
    return NotificationsController.pushSubscribe({ env, request, isAdmin, me }, ensurePushSchema);
  }

  if (path === '/api/notifications/push-unsubscribe' && request.method === 'POST') {
    return NotificationsController.pushUnsubscribe({ env, request, isAdmin, me }, ensurePushSchema);
  }

  if (path === '/api/notifications/test-push' && request.method === 'POST') {
    return NotificationsController.testPush({ env, request, isAdmin, me }, sendWebPushNotification, ensurePushSchema);
  }

  if (path === '/api/notifications/task-mentions/unread-count' && request.method === 'GET') {
    return NotificationsController.getTaskMentionsUnreadCount({ env, request, isAdmin, me });
  }

  if (path === '/api/notifications/task-mentions' && request.method === 'GET') {
    return NotificationsController.getTaskMentions({ env, request, isAdmin, me });
  }

  const mentionReadMatch = path.match(/^\/api\/notifications\/task-mentions\/(\d+)\/read$/);
  if (mentionReadMatch && request.method === 'PATCH') {
    return NotificationsController.markTaskMentionRead({ env, request, isAdmin, me }, parseInt(mentionReadMatch[1]), broadcastAppEvent);
  }

  if (path === '/api/notifications' && request.method === 'GET') {
    const triggerAutoCheckout = (e) => {
      const now = Date.now();
      if (now - _lastAutoCheckoutRun > 6 * 3600 * 1000) {
        _lastAutoCheckoutRun = now;
        runAutoCheckout(e).catch(() => {});
      }
    };
    return NotificationsController.list({ env, request, isAdmin, me }, {
      triggerAutoCheckout,
      buildEmployeeAlerts,
      buildAttendanceNotifications,
      isAttendanceHcns,
      isHcns
    });
  }

  // ── ANNOUNCEMENTS ────────────────────────────────────────────────
  if (path.startsWith('/api/announcements')) {
    const annRes = await handleAnnouncementRoutes(request, env, me, path, url, {
      isHcns,
      isAttendanceHcns,
      broadcastAppEvent,
    });
    if (annRes) return annRes;
  }

  const employeeProfileMatch = path.match(/^\/api\/users\/(\d+)\/profile$/);
  if (employeeProfileMatch) {
    const userId = parseInt(employeeProfileMatch[1], 10);
    if (request.method === 'GET') {
      return UsersController.getProfile({ env, request, isAdmin, me }, userId, { isManager, isHcns });
    }
    if (request.method === 'PATCH') {
      return UsersController.updateProfile({ env, request, isAdmin, me }, userId, {
        isManager,
        isHcns,
        broadcastAppEvent,
        normalizeDeptName,
        employeeTypeCode,
        normalizeWorkLocation
      });
    }
    return json({ error: 'Phương thức không được hỗ trợ' }, 405);
  }

  const userDeleteEligibilityMatch = path.match(/^\/api\/users\/(\d+)\/delete-eligibility$/);
  if (userDeleteEligibilityMatch && request.method === 'GET') {
    const userId = parseInt(userDeleteEligibilityMatch[1], 10);
    return UsersController.checkDeleteEligibility({ env, request, isAdmin, me }, userId, { isHcns });
  }

  const userDeleteMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userDeleteMatch && request.method === 'DELETE') {
    const userId = parseInt(userDeleteMatch[1], 10);
    return UsersController.deleteUser({ env, request, isAdmin, me }, userId, { isHcns, broadcastAppEvent });
  }

  const employeeAuditMatch = path.match(/^\/api\/users\/(\d+)\/audit$/);
  if (employeeAuditMatch && request.method === 'GET') {
    const userId = parseInt(employeeAuditMatch[1], 10);
    return UsersController.audit({ env, request, isAdmin, me }, userId, { isHcns });
  }

  const employeeTimelineMatch = path.match(/^\/api\/users\/(\d+)\/timeline$/);
  if (employeeTimelineMatch && request.method === 'GET') {
    const userId = parseInt(employeeTimelineMatch[1], 10);
    return UsersController.timeline({ env, request, isAdmin, me }, userId, { isManager, isHcns });
  }

  const employeeDocumentsMatch = path.match(/^\/api\/users\/(\d+)\/documents$/);
  if (employeeDocumentsMatch) {
    const userId = parseInt(employeeDocumentsMatch[1], 10);
    if (request.method === 'GET') {
      return UsersController.getDocuments({ env, request, isAdmin, me }, userId, { isHcns });
    }
    if (request.method === 'POST') {
      return UsersController.uploadDocument({ env, request, isAdmin, me }, userId, { isHcns, rateLimit });
    }
    return json({ error: 'Phương thức không được hỗ trợ' }, 405);
  }

  const employeeDocumentMatch = path.match(/^\/api\/users\/(\d+)\/documents\/([0-9a-fA-F-]{36})$/);
  if (employeeDocumentMatch) {
    const userId = parseInt(employeeDocumentMatch[1], 10);
    const documentId = employeeDocumentMatch[2];
    if (request.method === 'GET') {
      return UsersController.getDocumentFile({ env, request, isAdmin, me }, userId, documentId, { isHcns });
    }
    if (request.method === 'DELETE') {
      return UsersController.deleteDocument({ env, request, isAdmin, me }, userId, documentId, { isHcns });
    }
    return json({ error: 'Phương thức không được hỗ trợ' }, 405);
  }

  // ── USERS (legacy-compatible account APIs) ───────────────────────
  if (path === '/api/users' && request.method === 'GET') {
    return UsersController.listUsers({ env, request, isAdmin, me }, { isManager, isHcns, sortVietnameseNames });
  }

  if (path === '/api/users' && request.method === 'POST') {
    return UsersController.createUser({ env, request, isAdmin, me }, {
      isHcns,
      employeeTypeCode,
      normalizeDeptName,
      nextEmployeeCode,
      hashPassword,
      nameInitials,
      vnTodayStr,
      avatarColor,
      normalizeWorkLocation,
      ensureCompanyChannel,
      ensureEmployeePersonalProject,
      broadcastAppEvent
    });
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
        await env.DB.batch(items.map(item => env.DB.prepare('INSERT INTO overtime_form_items (form_id,start_at,end_at,requested_minutes,reason,time_category,proof_url) VALUES (?,?,?,?,?,?,?)').bind(form.meta.last_row_id, item.start_at, item.end_at, item.requested_minutes, item.reason, item.time_category, item.proof_url || null)));
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
    if (request.method === 'GET') {
      return UsersController.getLegacyDocument({ env, request, isAdmin, me }, uid, kind, { isHcns });
    }
    if (request.method === 'POST') {
      return UsersController.uploadLegacyDocument({ env, request, isAdmin, me }, uid, kind, { isHcns, rateLimit });
    }
    if (request.method === 'DELETE') {
      return UsersController.deleteLegacyDocument({ env, request, isAdmin, me }, uid, kind, { isHcns });
    }
    return json({ error: 'Phương thức không được hỗ trợ' }, 405);
  }

  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    const uid = parseInt(userMatch[1]);
    if (request.method === 'GET') {
      return UsersController.getUser({ env, request, isAdmin, me }, uid, { isManager, isHcns });
    }
    if (request.method === 'PUT') {
      return UsersController.updateUser({ env, request, isAdmin, me }, uid, {
        isManager,
        isHcns,
        normalizeDeptName,
        hashPassword,
        nameInitials,
        broadcastAppEvent
      });
    }
    if (request.method === 'DELETE') {
      return UsersController.deleteUserAccount({ env, request, isAdmin, me }, uid);
    }
  }

  // ── USERS: basic list (safe fields only, for pickers e.g. Mentor select) ──
  if (path === '/api/users/basic' && request.method === 'GET') {
    return UsersController.basic({ env, request, isAdmin, me }, { sortVietnameseNames });
  }

  // ── LIFECYCLE STATUS (Vòng đời nhân sự) — only HCNS / Ban Giám Đốc may edit ──
  const lifecycleMatch = path.match(/^\/api\/users\/(\d+)\/lifecycle$/);
  if (lifecycleMatch && request.method === 'PUT') {
    const luid = parseInt(lifecycleMatch[1]);
    return UsersController.updateLifecycle({ env, request, isAdmin, me }, luid, { isHrOrBod, broadcastAppEvent });
  }

  // ── ASSET HANDOVER (Bàn giao tài sản — Nhân viên chính thức & TTS) ──
  // ── ASSET HANDOVER (Bàn giao tài sản — Nhân viên chính thức & TTS) ──
  if (path === '/api/assets' && request.method === 'GET') {
    return AssetsController.list({ env, me });
  }
  if (path === '/api/assets' && request.method === 'POST') {
    return AssetsController.create({ env, request, me });
  }
  const revealMatch = path.match(/^\/api\/assets\/(\d+)\/reveal-credential$/);
  if (revealMatch && request.method === 'POST') {
    return AssetsController.revealCredential({ env, me }, parseInt(revealMatch[1]));
  }
  const assetHistoryMatch = path.match(/^\/api\/assets\/(\d+)\/history$/);
  if (assetHistoryMatch && request.method === 'GET') {
    return AssetsController.history({ env, me }, parseInt(assetHistoryMatch[1]));
  }
  const assetMatch = path.match(/^\/api\/assets\/(\d+)$/);
  if (assetMatch) {
    const aid = parseInt(assetMatch[1]);
    if (request.method === 'PUT') {
      return AssetsController.update({ env, request, me }, aid);
    }
    if (request.method === 'DELETE') {
      return AssetsController.delete({ env, me }, aid);
    }
  }

  // ── ATTENDANCE ───────────────────────────────────────────────────
  if (path === '/api/attendance' && request.method === 'GET') {
    return AttendanceController.list({ env, request, isAdmin, me }, { isAttendanceAdmin, isAdmin, isAttendanceHcns });
  }

  if (path === '/api/attendance/employees' && request.method === 'GET') {
    return AttendanceController.listEmployees({ env, request, isAdmin, me }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, sortVietnameseNames, vnTodayStr });
  }

  if (path === '/api/attendance/my-compliance' && request.method === 'GET') {
    return AttendanceController.myCompliance({ env, request, isAdmin, me }, { vnTodayStr, penaltyPolicyEffectiveMonth: PENALTY_POLICY_EFFECTIVE_MONTH });
  }

  if (path === '/api/attendance/today' && request.method === 'GET') {
    return AttendanceController.today({ env, request, isAdmin, me }, { isManager, isAdmin, isAttendanceHcns, vnTodayStr });
  }

  if (path === '/api/attendance/register' && request.method === 'POST') {
    return AttendanceController.register({ env, request, isAdmin, me }, { vnTodayStr, broadcastAppEvent });
  }

  if (path === '/api/attendance/checkin' && request.method === 'POST') {
    return AttendanceController.checkin({ env, request, isAdmin, me }, { vnTodayStr, vnTimeStr, currentIpInfo, broadcastAppEvent });
  }

  if (path === '/api/attendance/checkout' && request.method === 'POST') {
    return AttendanceController.checkout({ env, request, isAdmin, me }, { vnTodayStr, vnTimeStr, currentIpInfo, broadcastAppEvent });
  }

  if (path === '/api/attendance/checkin-points' && request.method === 'GET') {
    return AttendanceController.checkinPoints({ env, request, isAdmin, me }, { isAdmin, isAttendanceHcns, vnTodayStr });
  }

  const attendanceReviewMatch = path.match(/^\/api\/attendance\/(\d+)\/location-review$/);
  if (attendanceReviewMatch && request.method === 'POST') {
    return AttendanceController.locationReview({ env, request, isAdmin, me }, Number(attendanceReviewMatch[1]), { isAttendanceAdmin, isAdmin, isAttendanceHcns, broadcastAppEvent });
  }

  if (path === '/api/attendance/wfh-proof-upload' && request.method === 'POST') {
    return AttendanceController.uploadWfhProof({ env, request, isAdmin, me }, { safeDownloadName });
  }

  const wfhProofServeMatch = path.match(/^\/api\/attendance\/wfh-proof\/([0-9a-fA-F-]{36})$/);
  if (wfhProofServeMatch && request.method === 'GET') {
    return AttendanceController.serveWfhProof({ env, request, isAdmin, me }, wfhProofServeMatch[1], { isAttendanceAdmin, safeDownloadName, isDirectorHau });
  }

  const wfhProofUpdateMatch = path.match(/^\/api\/attendance\/(\d+)\/wfh-proof$/);
  if (wfhProofUpdateMatch && request.method === 'POST') {
    return AttendanceController.updateWfhProof({ env, request, isAdmin, me }, parseInt(wfhProofUpdateMatch[1]), { broadcastAppEvent });
  }

  if (path === '/api/attendance/wfh-requests' && request.method === 'GET') {
    return AttendanceController.listWfhRequests({ env, request, isAdmin, me }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau });
  }

  const wfhDecisionMatch = path.match(/^\/api\/attendance\/(\d+)\/wfh-decision$/);
  if (wfhDecisionMatch && request.method === 'POST') {
    return AttendanceController.decideWfh({ env, request, isAdmin, me }, parseInt(wfhDecisionMatch[1]), { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau, createEmployeePopup, broadcastAppEvent });
  }

  // ── OVERTIME ────────────────────────────────────────────────────
  if (path === '/api/overtime-requests' && request.method === 'GET') {
    return OvertimeController.listRequests({ env, url, me }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau });
  }

  if (path === '/api/overtime-requests' && request.method === 'POST') {
    return OvertimeController.createRequest({ env, request, me }, { rateLimit, attShiftBounds, attToMinutes, broadcastAppEvent });
  }

  const overtimeAction = path.match(/^\/api\/overtime-requests\/(\d+)\/(approve|reject)$/);
  if (overtimeAction && request.method === 'POST') {
    return OvertimeController.actionRequest({ env, request, me }, parseInt(overtimeAction[1]), overtimeAction[2], { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau, rateLimit, refreshInvoiceOvertime, createEmployeePopup, broadcastAppEvent });
  }

  // ── MONTHLY OVERTIME FORMS ──────────────────────────────────────
  if (path === '/api/overtime-forms' && request.method === 'GET') {
    return OvertimeController.listForms({ env, url, me }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau });
  }

  if (path === '/api/overtime-forms' && request.method === 'POST') {
    return OvertimeController.createForm({ env, request, me }, { rateLimit, broadcastAppEvent });
  }

  const overtimeFormMatch = path.match(/^\/api\/overtime-forms\/(\d+)$/);
  if (overtimeFormMatch && request.method === 'PUT') {
    return OvertimeController.updateForm({ env, request, me }, parseInt(overtimeFormMatch[1], 10), { broadcastAppEvent });
  }

  const overtimeFormSubmit = path.match(/^\/api\/overtime-forms\/(\d+)\/submit$/);
  if (overtimeFormSubmit && request.method === 'POST') {
    return OvertimeController.submitForm({ env, me }, parseInt(overtimeFormSubmit[1], 10), { broadcastAppEvent });
  }

  const overtimeFormDecision = path.match(/^\/api\/overtime-forms\/(\d+)\/decision$/);
  if (overtimeFormDecision && request.method === 'POST') {
    return OvertimeController.decisionForm({ env, request, me }, parseInt(overtimeFormDecision[1], 10), { isAttendanceAdmin, isAdmin, isAttendanceHcns, isDirectorHau, refreshInvoiceOvertime, createEmployeePopup, broadcastAppEvent });
  }

  if (path === '/api/company-holidays' && request.method === 'GET') {
    return LeaveController.listHolidays({ env, request, isAdmin, me });
  }
  if (path === '/api/company-holidays' && request.method === 'POST') {
    return LeaveController.createHoliday({ env, request, isAdmin, me });
  }
  const holidayMatch = path.match(/^\/api\/company-holidays\/(\d+)$/);
  if (holidayMatch && request.method === 'PUT') {
    return LeaveController.updateHoliday({ env, request, isAdmin, me }, parseInt(holidayMatch[1]));
  }
  if (holidayMatch && request.method === 'DELETE') {
    return LeaveController.deleteHoliday({ env, request, isAdmin, me }, parseInt(holidayMatch[1]));
  }

  const attMatch = path.match(/^\/api\/attendance\/(\d+)$/);
  if (attMatch && request.method === 'PUT') {
    return AttendanceController.updateRecord({ env, request, isAdmin, me }, parseInt(attMatch[1]), { isManager, isAdmin, isAttendanceHcns, broadcastAppEvent });
  }

  if (attMatch && request.method === 'DELETE') {
    return AttendanceController.deleteRecord({ env, request, isAdmin, me }, parseInt(attMatch[1]), { isManager, isAdmin, isAttendanceHcns, broadcastAppEvent });
  }

  if (path === '/api/attendance/summary' && request.method === 'GET') {
    return AttendanceController.summary({ env, request, isAdmin, me }, { isManager, isAdmin, isAttendanceHcns });
  }

  const attendanceEmployeeMatch = path.match(/^\/api\/attendance\/employees\/(\d+)\/summary$/);
  if (attendanceEmployeeMatch && request.method === 'GET') {
    return AttendanceController.employeeSummary({ env, request, isAdmin, me }, parseInt(attendanceEmployeeMatch[1]), { isAttendanceAdmin, isAdmin, isAttendanceHcns, vnTodayStr, buildMonthlyOvertimeSummary });
  }

  if (path === '/api/attendance/batch' && request.method === 'POST') {
    return AttendanceController.batchAdd({ env, request, isAdmin, me }, { isAttendanceAdmin, isAdmin, isAttendanceHcns, d1WriteWithRetry, broadcastAppEvent });
  }

  if (path === '/api/attendance-locations' && request.method === 'GET') {
    return AttendanceController.listLocations({ env, request, isAdmin, me });
  }
  if (path === '/api/attendance-locations/verify' && request.method === 'POST') {
    return AttendanceController.verifyLocation({ env, request, isAdmin, me });
  }
  if (path === '/api/attendance-locations' && request.method === 'POST') {
    return AttendanceController.createLocation({ env, request, isAdmin, me }, { broadcastAppEvent });
  }
  const attendanceLocationMatch = path.match(/^\/api\/attendance-locations\/(\d+)$/);
  if (attendanceLocationMatch && request.method === 'PUT') {
    return AttendanceController.updateLocation({ env, request, isAdmin, me }, Number(attendanceLocationMatch[1]), { broadcastAppEvent });
  }
  if (attendanceLocationMatch && request.method === 'DELETE') {
    return AttendanceController.deleteLocation({ env, request, isAdmin, me }, Number(attendanceLocationMatch[1]), { broadcastAppEvent });
  }

  // ── WIFI WHITELIST ───────────────────────────────────────────────
  if (path === '/api/wifi-whitelist' && request.method === 'GET') {
    return WifiController.list({ env, request, isAdmin, me });
  }
  if (path === '/api/wifi-whitelist' && request.method === 'POST') {
    return WifiController.create({ env, request, isAdmin, me }, currentIpInfo, ipMatchesRule);
  }
  const wifiMatch = path.match(/^\/api\/wifi-whitelist\/(\d+)$/);
  if (wifiMatch) {
    const wid = parseInt(wifiMatch[1]);
    if (request.method === 'PUT') {
      return WifiController.update({ env, request, isAdmin, me }, wid);
    }
    if (request.method === 'DELETE') {
      return WifiController.remove({ env, request, isAdmin, me }, wid);
    }
  }

  // ── AI COPILOT & RAG KNOWLEDGE ────────────────────────────────────
  if (path.startsWith('/api/ai/')) {
    const aiRes = await handleAiRoutes(request, env, me, path, url);
    if (aiRes) return aiRes;
  }

  // ── TASKS & KANBAN ────────────────────────────────────────────────
  if (path.startsWith('/api/task') || path.startsWith('/api/subtasks')) {
    const taskRes = await handleTaskRoutes(request, env, me, path, url, {
      isManager,
      isAdmin,
      isHcns,
      broadcastAppEvent,
      sendWebPushNotification,
    });
    if (taskRes) return taskRes;
  }

  // ── INVOICES ─────────────────────────────────────────────────────
  if (path.startsWith('/api/invoices')) {
    const invRes = await handleInvoiceRoutes(request, env, me, path, url, {
      isManager,
      isAdmin,
      isHcns,
      broadcastAppEvent,
    });
    if (invRes) return invRes;
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

  // ── BACKUP & DISASTER RECOVERY ───────────────────────────────────
  if (path === '/api/admin/backups' && request.method === 'GET') {
    if (!isAdmin && !isHcns(me)) return json({ error: 'Không có quyền truy cập sao lưu' }, 403);
    if (!env.HR_DOCUMENTS) return json({ backups: [] });
    try {
      const listed = await env.HR_DOCUMENTS.list({ prefix: 'backups/db/' });
      const backups = (listed.objects || []).map(obj => ({
        key: obj.key,
        filename: obj.key.replace(/^backups\/db\//, ''),
        size: obj.size,
        uploaded: obj.uploaded,
        customMetadata: obj.customMetadata || {},
      })).sort((a, b) => new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime());
      return json({ backups });
    } catch (e) {
      console.error('Failed to list backups', e);
      return json({ error: 'Không thể lấy danh sách bản sao lưu: ' + String(e?.message || e) }, 500);
    }
  }

  if (path === '/api/admin/backups/create' && request.method === 'POST') {
    if (!isAdmin && !isHcns(me)) return json({ error: 'Không có quyền tạo bản sao lưu' }, 403);
    try {
      const backupResult = await runMonthlyBackup(env, {
        manual: true,
        triggeredBy: `${me.full_name} (${me.employee_code || me.id})`,
      });
      return json({ ok: true, backup: backupResult });
    } catch (e) {
      console.error('Manual backup failed', e);
      return json({ error: 'Không thể tạo bản sao lưu: ' + String(e?.message || e) }, 500);
    }
  }

  if (path === '/api/admin/backups/download' && request.method === 'GET') {
    if (!isAdmin && !isHcns(me)) return json({ error: 'Không có quyền tải bản sao lưu' }, 403);
    const key = url.searchParams.get('key');
    if (!key || !key.startsWith('backups/db/')) {
      return json({ error: 'Đường dẫn tệp sao lưu không hợp lệ' }, 400);
    }
    if (!env.HR_DOCUMENTS) return json({ error: 'Dịch vụ lưu trữ R2 chưa sẵn sàng' }, 503);
    const object = await env.HR_DOCUMENTS.get(key);
    if (!object) return json({ error: 'Không tìm thấy tệp sao lưu' }, 404);
    const filename = key.split('/').pop() || 'backup.json';
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  // ── DEPARTMENTS ──────────────────────────────────────────────────
  if (path === '/api/departments' && request.method === 'GET') {
    return DepartmentsController.list({ env, request, isAdmin, me });
  }
  if (path === '/api/departments' && request.method === 'POST') {
    return DepartmentsController.create({ env, request, isAdmin, me }, normalizeDeptName, findDepartmentDuplicate, intOrNull, isHcns);
  }
  const deptMatch = path.match(/^\/api\/departments\/(\d+)$/);
  if (deptMatch) {
    const id = parseInt(deptMatch[1]);
    if (request.method === 'PUT') {
      return DepartmentsController.update({ env, request, isAdmin, me }, id, normalizeDeptName, findDepartmentDuplicate, intOrNull, isHcns);
    }
    if (request.method === 'DELETE') {
      return DepartmentsController.remove({ env, request, isAdmin, me }, id, isHcns);
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
    return LeaveController.listTypes({ env, request, isAdmin, me });
  }
  if (path === '/api/leave-types' && request.method === 'POST') {
    return LeaveController.createType({ env, request, isAdmin, me }, { isHcns });
  }
  const leaveTypeMatch = path.match(/^\/api\/leave-types\/(\d+)$/);
  if (leaveTypeMatch && request.method === 'PUT') {
    return LeaveController.updateType({ env, request, isAdmin, me }, parseInt(leaveTypeMatch[1]), { isHcns });
  }
  if (leaveTypeMatch && request.method === 'DELETE') {
    return LeaveController.deleteType({ env, request, isAdmin, me }, parseInt(leaveTypeMatch[1]), { isHcns });
  }

  if (path === '/api/leave/balances' && request.method === 'GET') {
    return LeaveController.getBalances({ env, request, isAdmin, me }, { isHcns });
  }
  if (path === '/api/leave/balances' && request.method === 'POST') {
    return LeaveController.adjustBalance({ env, request, isAdmin, me }, { isHcns, broadcastAppEvent });
  }

  if (path === '/api/leave/uploads' && request.method === 'POST') {
    return LeaveController.uploadDocument({ env, request, isAdmin, me }, { safeDownloadName, employeeDocumentContentMatches });
  }

  if (path === '/api/leave' && request.method === 'GET') {
    return LeaveController.listRequests({ env, request, isAdmin, me }, { isHrOrBod, isDirectorHau, isStep1Approver, normalizeDeptName });
  }
  if (path === '/api/leave' && request.method === 'POST') {
    return LeaveController.createRequest({ env, request, isAdmin, me }, { normalizeDeptName, broadcastAppEvent });
  }
  const leaveDocumentsListMatch = path.match(/^\/api\/leave\/(\d+)\/documents$/);
  if (leaveDocumentsListMatch && request.method === 'GET') {
    return LeaveController.listDocuments({ env, request, isAdmin, me }, Number(leaveDocumentsListMatch[1]), { isHrOrBod });
  }
  const leaveDocumentMatch = path.match(/^\/api\/leave\/(\d+)\/documents\/([0-9a-fA-F-]{36})$/);
  if (leaveDocumentMatch && request.method === 'GET') {
    return LeaveController.getDocumentFile({ env, request, isAdmin, me }, Number(leaveDocumentMatch[1]), leaveDocumentMatch[2], { isHrOrBod, safeDownloadName });
  }
  const leaveMatch = path.match(/^\/api\/leave\/(\d+)$/);
  if (leaveMatch && request.method === 'PUT') {
    return LeaveController.updateRequest({ env, request, isAdmin, me }, parseInt(leaveMatch[1]), { isDirectorHau, isStep1Approver, normalizeDeptName, createEmployeePopup, broadcastAppEvent });
  }
  if (leaveMatch && request.method === 'DELETE') {
    return LeaveController.deleteRequest({ env, request, isAdmin, me }, parseInt(leaveMatch[1]), { isHcns, broadcastAppEvent });
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
    if (!isAdmin && !isManager && !isHcns(me)) return json({ error: 'Không có quyền quản lý ứng viên' }, 403);
    const b = await request.json();
    if (!b.name) return json({ error: 'Thiếu tên ứng viên' }, 400);
    const dept = b.department || b.department_id || '';
    const r = await env.DB.prepare(
      'INSERT INTO candidates (user_id,name,position,department,department_id,apply_date,source,stage,notes,email,phone) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(env.USER_ID || me?.id, b.name, b.position||'', dept, b.department_id||null, b.apply_date||null, b.source||'Khác', b.stage||'received', b.notes||'', b.email||'', b.phone||'').run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const candMatch = path.match(/^\/api\/candidates\/(\d+)$/);
  if (candMatch) {
    const id = parseInt(candMatch[1]);
    if (request.method === 'PUT') {
      if (!isAdmin && !isManager && !isHcns(me)) return json({ error: 'Không có quyền chỉnh sửa ứng viên' }, 403);
      const b = await request.json();
      // Flexible update
      const cols = ['name','position','department','apply_date','source','stage','notes','email','phone'];
      const setStrs = []; const vals = [];
      for (const c of cols) {
        if (b[c] !== undefined) { setStrs.push(c + '=?'); vals.push(b[c]); }
      }
      if (b.department_id !== undefined) { setStrs.push('department_id=?'); vals.push(b.department_id||null); }
      if (!setStrs.length) return json({ error: 'Không có dữ liệu' }, 400);
      vals.push(id);
      await env.DB.prepare(`UPDATE candidates SET ${setStrs.join(',')} WHERE id=?`).bind(...vals).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isAdmin && !isManager && !isHcns(me)) return json({ error: 'Không có quyền xóa ứng viên' }, 403);
      await env.DB.prepare('DELETE FROM candidates WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
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

  // ── PAYROLL ───────────────────────────────────────────────────────
  if (path.startsWith('/api/payroll') || path === '/api/integrations/vietqr/banks') {
    const payRes = await handlePayrollRoutes(request, env, me, path, url, {
      isManager,
      isAdmin,
      isHcns,
      broadcastAppEvent,
    });
    if (payRes) return payRes;
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
    if (!isManager) return json({ error: 'Chỉ HCNS, quản lý hoặc Admin được quản lý chiến dịch' }, 403);
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
      if (!isManager) return json({ error: 'Chỉ HCNS, quản lý hoặc Admin được quản lý chiến dịch' }, 403);
      const b = await request.json();
      await env.DB.prepare(
        'UPDATE campaigns SET name=?,type=?,status=?,start_date=?,end_date=?,budget=?,spent=?,goal_reach=?,goal_leads=?,goal_conversions=?,owner_name=?,description=? WHERE id=?'
      ).bind(b.name||'', b.type||'other', b.status||'planning', b.start_date||null, b.end_date||null, b.budget||0, b.spent||0, b.goal_reach||0, b.goal_leads||0, b.goal_conversions||0, b.owner_name||'', b.description||'', id).run();
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!isManager) return json({ error: 'Chỉ HCNS, quản lý hoặc Admin được quản lý chiến dịch' }, 403);
      await env.DB.prepare('DELETE FROM campaigns WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ── KPI & PERFORMANCE EVALUATIONS ────────────────────────────────
  if (
    path.startsWith('/api/kpi') ||
    path.startsWith('/api/evaluations') ||
    path.startsWith('/api/eval-periods') ||
    path.startsWith('/api/performance')
  ) {
    const evalRes = await handleEvaluationRoutes(request, env, me, path, url, {
      isManager,
      isAdmin,
      isHcns,
      broadcastAppEvent,
    });
    if (evalRes) return evalRes;
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAT MODULE
  // ═══════════════════════════════════════════════════════════════

  if (path === '/api/chat/emojis' && request.method === 'GET') {
    return ChatController.getEmojis();
  }

  if (path === '/api/chat/header-summary' && request.method === 'GET') {
    return ChatController.getHeaderSummary({ env, me });
  }

  if (path === '/api/conversations' && request.method === 'GET') {
    return ChatController.listConversations({ env, me });
  }

  if (path === '/api/conversations' && request.method === 'POST') {
    return ChatController.createConversation();
  }

  const convMatch = path.match(/^\/api\/conversations\/(\d+)$/);
  if (convMatch && request.method === 'GET') {
    return ChatController.getConversation({ env, me }, parseInt(convMatch[1]));
  }

  if (convMatch && request.method === 'DELETE') {
    return ChatController.dissolveConversation({ env, me }, parseInt(convMatch[1]));
  }

  if (convMatch && request.method === 'PUT') {
    return ChatController.updateConversation({ env, request, me }, parseInt(convMatch[1]));
  }

  const convMembersMatch = path.match(/^\/api\/conversations\/(\d+)\/members$/);
  if (convMembersMatch && request.method === 'POST') {
    return ChatController.manageMembers({ env, request }, parseInt(convMembersMatch[1]));
  }

  const msgListMatch = path.match(/^\/api\/conversations\/(\d+)\/messages$/);
  if (msgListMatch && request.method === 'GET') {
    return ChatController.listMessages({ env, url, me }, parseInt(msgListMatch[1]));
  }

  if (msgListMatch && request.method === 'POST') {
    return ChatController.createMessage({ env, request, me }, parseInt(msgListMatch[1]), { sendWebPushNotification });
  }

  const convPinnedMatch = path.match(/^\/api\/conversations\/(\d+)\/pinned$/);
  if (convPinnedMatch && request.method === 'GET') {
    return ChatController.getPinnedMessages({ env, me }, Number(convPinnedMatch[1]));
  }

  const convSharedMatch = path.match(/^\/api\/conversations\/(\d+)\/shared\/(images|files|links)$/);
  if (convSharedMatch && request.method === 'GET') {
    return ChatController.getSharedContent({ env, url, me }, Number(convSharedMatch[1]), convSharedMatch[2]);
  }

  const pollVoteMatch = path.match(/^\/api\/messages\/(\d+)\/poll-votes$/);
  if (pollVoteMatch && request.method === 'PUT') {
    return ChatController.votePoll({ env, request, me }, Number(pollVoteMatch[1]));
  }

  const pollCloseMatch = path.match(/^\/api\/messages\/(\d+)\/poll\/close$/);
  if (pollCloseMatch && request.method === 'POST') {
    return ChatController.closePoll({ env, me }, Number(pollCloseMatch[1]));
  }

  const eventUpdateMatch = path.match(/^\/api\/messages\/(\d+)\/event$/);
  if (eventUpdateMatch && request.method === 'PUT') {
    return ChatController.updateEvent({ env, request, me }, Number(eventUpdateMatch[1]));
  }

  const eventResponseMatch = path.match(/^\/api\/messages\/(\d+)\/event-response$/);
  if (eventResponseMatch && request.method === 'PUT') {
    return ChatController.respondEvent({ env, request, me }, Number(eventResponseMatch[1]));
  }

  const eventCancelMatch = path.match(/^\/api\/messages\/(\d+)\/event$/);
  if (eventCancelMatch && request.method === 'DELETE') {
    return ChatController.cancelEvent({ env, me }, Number(eventCancelMatch[1]));
  }

  const msgMatch = path.match(/^\/api\/messages\/(\d+)$/);
  if (msgMatch && request.method === 'PUT') {
    return ChatController.updateMessage({ env, request, me }, parseInt(msgMatch[1]));
  }

  if (msgMatch && request.method === 'DELETE') {
    return ChatController.deleteMessage({ env, me }, parseInt(msgMatch[1]), { isAttendanceHcns });
  }

  const msgPinMatch = path.match(/^\/api\/messages\/(\d+)\/pin$/);
  if (msgPinMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    return ChatController.pinMessage({ env, request, me }, Number(msgPinMatch[1]), { isAttendanceHcns });
  }

  const msgReactionMatch = path.match(/^\/api\/messages\/(\d+)\/reactions$/);
  if (msgReactionMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    return ChatController.toggleReaction({ env, request, url, me }, parseInt(msgReactionMatch[1]));
  }

  const msgReadMatch = path.match(/^\/api\/messages\/(\d+)\/read$/);
  if (msgReadMatch && request.method === 'POST') {
    return ChatController.markRead({ env, me }, parseInt(msgReadMatch[1]));
  }

  if (path === '/api/search/messages' && request.method === 'GET') {
    return ChatController.searchMessages({ env, url, me });
  }

  const chatDocumentMatch = path.match(/^\/api\/documents\/(.+)$/);
  if (chatDocumentMatch && request.method === 'GET') {
    let storageKey = '';
    try { storageKey = decodeURIComponent(chatDocumentMatch[1]); } catch (_) { return json({ error: 'Đường dẫn tệp không hợp lệ' }, 400); }
    if (storageKey.startsWith('chat/')) {
      return ChatController.serveDocument({ env, url, me }, storageKey);
    }
  }

  const convUploadMatch = path.match(/^\/api\/conversations\/(\d+)\/upload$/);
  if (convUploadMatch && request.method === 'POST') {
    return ChatController.uploadDocument({ env, request, me }, parseInt(convUploadMatch[1]));
  }

  const wsMatch = path.match(/^\/api\/chat\/ws\/(\d+)$/);
  if (wsMatch && request.method === 'GET') {
    return ChatController.upgradeWebSocket({ env, request, me }, parseInt(wsMatch[1]));
  }

  // ═══════════════════════════════════════════════════════════════
  // END CHAT MODULE
  // ═══════════════════════════════════════════════════════════════

  // ── Serve stored documents (task attachments, etc.) ──────────────
  const docServeMatch = path.match(/^\/api\/documents\/(.+)$/);
  if (docServeMatch && request.method === 'GET') {
    const storageKey = decodeURIComponent(docServeMatch[1]);
    if (!env.HR_DOCUMENTS) return json({ error: 'Lưu trữ tài liệu chưa được cấu hình' }, 503);
    const object = await env.HR_DOCUMENTS.get(storageKey);
    if (!object) return json({ error: 'Tệp không tồn tại' }, 404);
    const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
    const filename = storageKey.split('/').pop() || 'document';
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return json({ error: 'Not found' }, 404);
}
