import { json, err } from '../lib/response.js';
import { WifiService, isPrivateNetworkRule } from '../services/wifi.service.js';

export const WifiController = {
  async list(ctx) {
    const list = await WifiService.getWhitelist(ctx.env);
    return json({ whitelist: list });
  },

  async create(ctx, currentIpInfoFn, ipMatchesRuleFn) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const ipInfo = await currentIpInfoFn(ctx.env, ctx.request);
    const requestedIp = String(b.ip_range || ipInfo.ip).trim();
    const rules = String(requestedIp || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!rules.length) return err(400, 'Nhập ít nhất một Public IP hoặc dải mạng công khai.');
    if (rules.some(isPrivateNetworkRule)) return err(400, 'Không sử dụng IP nội bộ, router hoặc dải private cho mạng văn phòng.');
    const hasCurrentIp = rules.some(rule => ipMatchesRuleFn(ipInfo.ip, rule));
    const warning = hasCurrentIp ? null : `IP backend đang nhận là ${ipInfo.ip} — không nằm trong dải vừa lưu. Nếu IP này không phải IP văn phòng, việc chấm công có thể bị gián đoạn.`;
    
    const id = await WifiService.addWhitelist(ctx.env, {
      wifi_name: b.wifi_name,
      ip_range: requestedIp || ipInfo.ip,
      description: b.description
    });
    return json({ ok: true, id, warning });
  },

  async update(ctx, id) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    const b = await ctx.request.json().catch(() => ({}));
    const requestedIp = String(b.ip_range || '').trim();
    if (!requestedIp || requestedIp.split(',').some(isPrivateNetworkRule)) {
      return err(400, 'Nhập Public IP/dải mạng hợp lệ; không sử dụng IP nội bộ, router hoặc dải private.');
    }
    await WifiService.updateWhitelist(ctx.env, id, b);
    return json({ ok: true });
  },

  async remove(ctx, id) {
    if (!ctx.isAdmin) return err(403, 'Không có quyền');
    await WifiService.deleteWhitelist(ctx.env, id);
    return json({ ok: true });
  }
};
