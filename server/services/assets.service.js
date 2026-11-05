import { nowStr } from '../lib/time.js';
import { isHrOrBod } from '../lib/roles.js';

export async function recordAssetHistory(env, assetId, action, actor, detail = '') {
  await env.DB.prepare(
    'INSERT INTO asset_handover_history (asset_id,action,actor_id,actor_name,detail) VALUES (?,?,?,?,?)'
  ).bind(assetId, action, actor?.id || null, actor?.full_name || '', detail || '').run();
}

export async function getCredKey(env) {
  const enc = new TextEncoder().encode('asset-cred-key:' + (env.APP_ID || 'default-app'));
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCred(env, plain) {
  if (!plain) return null;
  const key = await getCredKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptCred(env, b64) {
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

/**
 * List assets accessible by user
 */
export async function listAssets(env, me) {
  let rowsResult;
  if (isHrOrBod(me)) {
    rowsResult = await env.DB.prepare(
      `SELECT a.*, u.full_name as owner_name, u.employee_code as owner_code,
              u.department as owner_department, u.employee_type as owner_employee_type,
              u.lifecycle_status as owner_lifecycle_status
       FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.updated_at DESC`
    ).all();
  } else {
    rowsResult = await env.DB.prepare(
      `SELECT a.*, u.full_name as owner_name, u.employee_code as owner_code,
              u.department as owner_department, u.employee_type as owner_employee_type,
              u.lifecycle_status as owner_lifecycle_status
       FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id
       WHERE a.user_id=? OR a.mentor_id=?
       ORDER BY a.updated_at DESC`
    ).bind(me.id, me.id).all();
  }
  return (rowsResult?.results || []).map(r => {
    const { credential_enc, ...rest } = r;
    return { ...rest, has_credential: !!credential_enc };
  });
}

/**
 * Create a new asset handover
 */
export async function createAsset(env, me, data) {
  const assetName = String(data.asset_name || '').trim();
  if (!assetName) return { error: 'Tên tài sản là bắt buộc', status: 400 };

  let ownerUserId = me.id;
  if (data.user_id && parseInt(data.user_id) !== me.id) {
    if (isHrOrBod(me)) {
      ownerUserId = parseInt(data.user_id);
    } else if (me.role === 'manager') {
      const target = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(parseInt(data.user_id)).first();
      if (!target || target.department !== me.department) {
        return { error: 'Chỉ có thể khai báo hộ nhân sự thuộc phòng ban của bạn', status: 403 };
      }
      ownerUserId = parseInt(data.user_id);
    } else {
      return { error: 'Không có quyền khai báo hộ nhân sự khác', status: 403 };
    }
  }

  const owner = await env.DB.prepare('SELECT employee_type FROM users WHERE id=?').bind(ownerUserId).first();
  const mentorId = data.mentor_id ? parseInt(data.mentor_id) : null;
  if (owner?.employee_type === 'TTS' && !mentorId) {
    return { error: 'TTS phải chọn Mentor để xác nhận bàn giao', status: 400 };
  }
  if (mentorId === ownerUserId) {
    return { error: 'Mentor không thể là người bàn giao', status: 400 };
  }

  const credEnc = data.credential ? await encryptCred(env, String(data.credential)) : null;
  if (owner?.employee_type === 'TTS' && !credEnc) {
    return { error: 'TTS phải nhập email/tài khoản và mật khẩu bàn giao', status: 400 };
  }

  const status = owner?.employee_type === 'TTS' && !isHrOrBod(me)
    ? 'pending_review'
    : (['active', 'pending_review', 'needs_update'].includes(data.status) ? data.status : 'active');
  const expectedDate = data.expected_handover_date ? String(data.expected_handover_date) : null;

  const r = await env.DB.prepare(
    `INSERT INTO asset_handovers (user_id,asset_name,asset_type,platform,link,credential_enc,responsible_name,mentor_id,mentor_name,status,note,expected_handover_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ownerUserId, assetName, data.asset_type || '', data.platform || '', data.link || '', credEnc, data.responsible_name || me.full_name, mentorId, data.mentor_name || '', status, data.note || '', expectedDate).run();

  const newId = r.meta.last_row_id;
  await recordAssetHistory(env, newId, 'created', me, 'Tạo bàn giao dự án/tài khoản');
  if (credEnc) {
    await recordAssetHistory(env, newId, 'credential_set', me, 'Đã lưu thông tin đăng nhập được mã hóa');
  }

  return { ok: true, id: newId };
}

/**
 * Reveal encrypted credential for authorized user
 */
export async function revealAssetCredential(env, me, aid) {
  const asset = await env.DB.prepare(
    `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
  ).bind(aid).first();
  if (!asset) return { error: 'Không tìm thấy', status: 404 };

  const allowed = asset.user_id === me.id || asset.mentor_id === me.id || isHrOrBod(me);
  if (!allowed) return { error: 'Không có quyền', status: 403 };
  if (!asset.credential_enc) return { credential: '' };

  const plain = await decryptCred(env, asset.credential_enc);
  await env.DB.prepare('INSERT INTO asset_credential_log (asset_id,viewed_by,viewed_by_name) VALUES (?,?,?)').bind(aid, me.id, me.full_name).run();
  await recordAssetHistory(env, aid, 'credential_viewed', me, 'Đã xem thông tin đăng nhập');
  return { credential: plain };
}

/**
 * Get audit history of asset
 */
export async function getAssetHistory(env, me, aid) {
  const asset = await env.DB.prepare(
    `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
  ).bind(aid).first();
  if (!asset) return { error: 'Không tìm thấy', status: 404 };

  const allowed = asset.user_id === me.id || asset.mentor_id === me.id || isHrOrBod(me);
  if (!allowed) return { error: 'Không có quyền', status: 403 };

  const history = await env.DB.prepare(
    'SELECT id,action,actor_id,actor_name,detail,created_at FROM asset_handover_history WHERE asset_id=? ORDER BY id DESC'
  ).bind(aid).all();

  return { history: history.results || [] };
}

/**
 * Update asset handover record
 */
export async function updateAsset(env, me, aid, data) {
  const asset = await env.DB.prepare(
    `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
  ).bind(aid).first();
  if (!asset) return { error: 'Không tìm thấy', status: 404 };

  const isOwner = asset.user_id === me.id;
  const isMentor = asset.mentor_id === me.id;
  const isHr = isHrOrBod(me);

  if (!isOwner && !isMentor && !isHr) return { error: 'Không có quyền', status: 403 };

  if (isMentor && !isOwner && !isHr) {
    if (!['confirmed', 'needs_update'].includes(data.status)) {
      return { error: 'Mentor chỉ có thể xác nhận hoặc yêu cầu bổ sung', status: 403 };
    }
    if (data.status === 'needs_update' && !String(data.note || '').trim()) {
      return { error: 'Vui lòng nêu nội dung cần bổ sung', status: 400 };
    }
    await env.DB.prepare(
      `UPDATE asset_handovers SET status=?, confirmed_by=?, confirmed_at=?, note=COALESCE(?,note), updated_at=? WHERE id=?`
    ).bind(data.status, data.status === 'confirmed' ? me.id : asset.confirmed_by, data.status === 'confirmed' ? nowStr() : asset.confirmed_at, data.note ?? null, nowStr(), aid).run();
    await recordAssetHistory(env, aid, data.status === 'confirmed' ? 'mentor_confirmed' : 'mentor_requested_update', me, data.note || '');
    return { ok: true };
  }

  if (isOwner && !isHr && ['confirmed', 'handed_over'].includes(asset.status)) {
    return { error: 'Bàn giao đã được xác nhận, chỉ HCNS/Ban giám đốc mới có thể chỉnh sửa', status: 403 };
  }

  const allowedStatuses = isHr
    ? ['active', 'pending_review', 'needs_update', 'confirmed', 'handed_over']
    : ['pending_review', 'needs_update'];
  const newStatus = allowedStatuses.includes(data.status) ? data.status : asset.status;
  const credEnc = (data.credential !== undefined)
    ? (data.credential ? await encryptCred(env, String(data.credential)) : null)
    : asset.credential_enc;
  const isNewlyConfirmed = newStatus === 'confirmed' && asset.status !== 'confirmed';
  const expectedDate = data.expected_handover_date !== undefined ? (data.expected_handover_date || null) : asset.expected_handover_date;

  await env.DB.prepare(
    `UPDATE asset_handovers SET asset_name=?,asset_type=?,platform=?,link=?,credential_enc=?,responsible_name=?,mentor_id=?,mentor_name=?,status=?,note=?,
      confirmed_by=?, confirmed_at=?, expected_handover_date=?, updated_at=? WHERE id=?`
  ).bind(
    data.asset_name ?? asset.asset_name, data.asset_type ?? asset.asset_type, data.platform ?? asset.platform,
    data.link ?? asset.link, credEnc, data.responsible_name ?? asset.responsible_name,
    (data.mentor_id !== undefined ? (data.mentor_id || null) : asset.mentor_id),
    data.mentor_name ?? asset.mentor_name, newStatus, data.note ?? asset.note,
    isNewlyConfirmed ? me.id : asset.confirmed_by,
    isNewlyConfirmed ? nowStr() : asset.confirmed_at,
    expectedDate,
    nowStr(), aid
  ).run();

  await recordAssetHistory(env, aid, 'updated', me, newStatus === 'pending_review' && asset.status === 'needs_update' ? 'Đã cập nhật và gửi lại Mentor xác nhận' : 'Đã cập nhật thông tin bàn giao');
  if (data.credential !== undefined) {
    await recordAssetHistory(env, aid, 'credential_changed', me, 'Đã thay đổi thông tin đăng nhập được mã hóa');
  }

  return { ok: true };
}

/**
 * Delete asset handover
 */
export async function deleteAsset(env, me, aid) {
  if (!isHrOrBod(me)) return { error: 'Không có quyền', status: 403 };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM asset_handovers WHERE id=?').bind(aid),
    env.DB.prepare('DELETE FROM asset_credential_log WHERE asset_id=?').bind(aid),
  ]);
  return { ok: true };
}
