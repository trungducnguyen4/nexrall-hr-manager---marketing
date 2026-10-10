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
