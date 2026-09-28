export function isPrivateNetworkRule(rule) {
  const value = String(rule || '').trim().toLowerCase();
  const base = value.split('/')[0];
  return base === 'localhost' || base === '::1' ||
    base.startsWith('10.') || base.startsWith('127.') ||
    base.startsWith('192.168.') || base.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(base) ||
    base.startsWith('fc') || base.startsWith('fd') || base.startsWith('fe80:');
}

export const WifiService = {
  async getWhitelist(env) {
    const { results } = await env.DB.prepare('SELECT * FROM wifi_whitelist ORDER BY id').all();
    return results || [];
  },

  async addWhitelist(env, { wifi_name, ip_range, description }) {
    const r = await env.DB.prepare(
      'INSERT INTO wifi_whitelist (wifi_name,ip_range,description,is_active) VALUES (?,?,?,1)'
    ).bind(wifi_name || '', ip_range || '', description || '').run();
    return r.meta?.last_row_id;
  },

  async updateWhitelist(env, id, { wifi_name, ip_range, description, is_active }) {
    await env.DB.prepare(
      'UPDATE wifi_whitelist SET wifi_name=?,ip_range=?,description=?,is_active=? WHERE id=?'
    ).bind(wifi_name || '', ip_range || '', description || '', is_active ?? 1, id).run();
  },

  async deleteWhitelist(env, id) {
    await env.DB.prepare('DELETE FROM wifi_whitelist WHERE id=?').bind(id).run();
  }
};
