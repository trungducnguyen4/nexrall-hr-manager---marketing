import { json, err } from '../lib/response.js';
import {
  listAssets,
  createAsset,
  revealAssetCredential,
  getAssetHistory,
  updateAsset,
  deleteAsset,
} from '../services/assets.service.js';

export const AssetsController = {
  async list({ env, me }) {
    const assets = await listAssets(env, me);
    return json({ assets });
  },

  async create({ env, request, me }) {
    const b = await request.json().catch(() => ({}));
    const result = await createAsset(env, me, b);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async revealCredential({ env, me }, aid) {
    const result = await revealAssetCredential(env, me, aid);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async history({ env, me }, aid) {
    const result = await getAssetHistory(env, me, aid);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async update({ env, request, me }, aid) {
    const b = await request.json().catch(() => ({}));
    const result = await updateAsset(env, me, aid, b);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  },

  async delete({ env, me }, aid) {
    const result = await deleteAsset(env, me, aid);
    if (result.error) return err(result.status || 400, result.error);
    return json(result);
  }
};
