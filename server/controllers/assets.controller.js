import { json, err } from '../lib/response.js';
import { nowStr } from '../lib/time.js';
import { isHrOrBod } from '../lib/roles.js';
import {
  encryptCred,
  decryptCred,
  recordAssetHistory
} from '../services/assets.service.js';

export const AssetsController = {
  async list({ env, me }) {
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
    const assets = rowsResult.results.map(r => {
      const { credential_enc, ...rest } = r;
      return { ...rest, has_credential: !!credential_enc };
    });
    return json({ assets });
  },

  async create({ env, request, me }) {
    const b = await request.json().catch(() => ({}));
    const assetName = String(b.asset_name || '').trim();
    if (!assetName) return err(400, 'Tên tài sản là bắt buộc');
    let ownerUserId = me.id;
    if (b.user_id && parseInt(b.user_id) !== me.id) {
      if (isHrOrBod(me)) {
        ownerUserId = parseInt(b.user_id);
      } else if (me.role === 'manager') {
        const target = await env.DB.prepare('SELECT department FROM users WHERE id=?').bind(parseInt(b.user_id)).first();
        if (!target || target.department !== me.department) return err(403, 'Chỉ có thể khai báo hộ nhân sự thuộc phòng ban của bạn');
        ownerUserId = parseInt(b.user_id);
      } else {
        return err(403, 'Không có quyền khai báo hộ nhân sự khác');
      }
    }
    const owner = await env.DB.prepare('SELECT employee_type FROM users WHERE id=?').bind(ownerUserId).first();
    const mentorId = b.mentor_id ? parseInt(b.mentor_id) : null;
    if (owner?.employee_type === 'TTS' && !mentorId) return err(400, 'TTS phải chọn Mentor để xác nhận bàn giao');
    if (mentorId === ownerUserId) return err(400, 'Mentor không thể là người bàn giao');
    const credEnc = b.credential ? await encryptCred(env, String(b.credential)) : null;
    if (owner?.employee_type === 'TTS' && !credEnc) return err(400, 'TTS phải nhập email/tài khoản và mật khẩu bàn giao');

    const status = owner?.employee_type === 'TTS' && !isHrOrBod(me)
      ? 'pending_review'
      : (['active', 'pending_review', 'needs_update'].includes(b.status) ? b.status : 'active');
    const expectedDate = b.expected_handover_date ? String(b.expected_handover_date) : null;
    const r = await env.DB.prepare(
      `INSERT INTO asset_handovers (user_id,asset_name,asset_type,platform,link,credential_enc,responsible_name,mentor_id,mentor_name,status,note,expected_handover_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(ownerUserId, assetName, b.asset_type || '', b.platform || '', b.link || '', credEnc, b.responsible_name || me.full_name, mentorId, b.mentor_name || '', status, b.note || '', expectedDate).run();
    await recordAssetHistory(env, r.meta.last_row_id, 'created', me, 'Tạo bàn giao dự án/tài khoản');
    if (credEnc) await recordAssetHistory(env, r.meta.last_row_id, 'credential_set', me, 'Đã lưu thông tin đăng nhập được mã hóa');
    return json({ ok: true, id: r.meta.last_row_id });
  },

  async revealCredential({ env, me }, aid) {
    const asset = await env.DB.prepare(
      `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
    ).bind(aid).first();
    if (!asset) return err(404, 'Không tìm thấy');
    const allowed = asset.user_id === me.id || asset.mentor_id === me.id || isHrOrBod(me);
    if (!allowed) return err(403, 'Không có quyền');
    if (!asset.credential_enc) return json({ credential: '' });
    const plain = await decryptCred(env, asset.credential_enc);
    await env.DB.prepare('INSERT INTO asset_credential_log (asset_id,viewed_by,viewed_by_name) VALUES (?,?,?)').bind(aid, me.id, me.full_name).run();
    await recordAssetHistory(env, aid, 'credential_viewed', me, 'Đã xem thông tin đăng nhập');
    return json({ credential: plain });
  },

  async history({ env, me }, aid) {
    const asset = await env.DB.prepare(
      `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
    ).bind(aid).first();
    if (!asset) return err(404, 'Không tìm thấy');
    if (!(asset.user_id === me.id || asset.mentor_id === me.id || isHrOrBod(me))) return err(403, 'Không có quyền');
    const history = await env.DB.prepare(
      'SELECT id,action,actor_id,actor_name,detail,created_at FROM asset_handover_history WHERE asset_id=? ORDER BY id DESC'
    ).bind(aid).all();
    return json({ history: history.results || [] });
  },

  async update({ env, request, me }, aid) {
    const asset = await env.DB.prepare(
      `SELECT a.*, u.department as owner_department FROM asset_handovers a LEFT JOIN users u ON a.user_id=u.id WHERE a.id=?`
    ).bind(aid).first();
    if (!asset) return err(404, 'Không tìm thấy');
    const isOwner = asset.user_id === me.id;
    const isMentor = asset.mentor_id === me.id;
    const isHr = isHrOrBod(me);

    if (!isOwner && !isMentor && !isHr) return err(403, 'Không có quyền');
    const b = await request.json().catch(() => ({}));

    if (isMentor && !isOwner && !isHr) {
      if (!['confirmed', 'needs_update'].includes(b.status)) return err(403, 'Mentor chỉ có thể xác nhận hoặc yêu cầu bổ sung');
      if (b.status === 'needs_update' && !String(b.note || '').trim()) return err(400, 'Vui lòng nêu nội dung cần bổ sung');
      await env.DB.prepare(
        `UPDATE asset_handovers SET status=?, confirmed_by=?, confirmed_at=?, note=COALESCE(?,note), updated_at=? WHERE id=?`
      ).bind(b.status, b.status === 'confirmed' ? me.id : asset.confirmed_by, b.status === 'confirmed' ? nowStr() : asset.confirmed_at, b.note ?? null, nowStr(), aid).run();
      await recordAssetHistory(env, aid, b.status === 'confirmed' ? 'mentor_confirmed' : 'mentor_requested_update', me, b.note || '');
      return json({ ok: true });
    }

    if (isOwner && !isHr && ['confirmed', 'handed_over'].includes(asset.status)) {
      return err(403, 'Bàn giao đã được xác nhận, chỉ HCNS/Ban giám đốc mới có thể chỉnh sửa');
    }

    const allowedStatuses = isHr
      ? ['active', 'pending_review', 'needs_update', 'confirmed', 'handed_over']
      : ['pending_review', 'needs_update'];
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
  },

  async delete({ env, me }, aid) {
    if (!isHrOrBod(me)) return err(403, 'Không có quyền');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM asset_handovers WHERE id=?').bind(aid),
      env.DB.prepare('DELETE FROM asset_credential_log WHERE asset_id=?').bind(aid),
    ]);
    return json({ ok: true });
  }
};
