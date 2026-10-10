import { json } from '../lib/response.js';
import { PopupsService } from '../services/popups.service.js';

export const PopupsController = {
  async listPending({ env, me }) {
    const popups = await PopupsService.getPending(env, me.id);
    return json({ popups });
  },

  async dismiss({ env, me }, popupId) {
    await PopupsService.dismiss(env, popupId, me.id);
    return json({ ok: true });
  }
};
