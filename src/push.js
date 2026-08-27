// ════════════════════════════════════════════════════════════════════════
//  WEB PUSH NOTIFICATIONS CLIENT HELPER (PWA & Lock Screen)
// ════════════════════════════════════════════════════════════════════════
import { api } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer) {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPushSupported() {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getPushPermission() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function getExistingPushSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (_) {
    return null;
  }
}

export async function subscribePushNotification() {
  if (!isPushSupported()) {
    throw new Error('Trình duyệt hoặc thiết bị này chưa hỗ trợ Web Push Notifications.');
  }

  // 1. Xin quyền thông báo (Direct User Gesture)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Bạn đã chặn quyền thông báo. Vui lòng vào Cài đặt ➔ Thông báo của máy để cho phép.'
        : 'Quyền thông báo chưa được cấp.'
    );
  }

  // 2. Đảm bảo Service Worker sẵn sàng
  const reg = await navigator.serviceWorker.ready;

  // 3. Lấy VAPID public key từ backend
  const { public_key } = await api.get('/api/notifications/push-vapid-public-key');
  if (!public_key) {
    throw new Error('Không lấy được khóa VAPID từ máy chủ.');
  }

  // 4. Đăng ký nhận push với trình duyệt (Apple APNs / Google FCM)
  const applicationServerKey = urlBase64ToUint8Array(public_key);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  // 5. Trích xuất keys an toàn (Tương thích cả Safari iOS và Chrome)
  const subJSON = sub.toJSON ? sub.toJSON() : {};
  let p256dh = subJSON.keys?.p256dh;
  let auth = subJSON.keys?.auth;

  if (!p256dh && typeof sub.getKey === 'function') {
    const rawKey = sub.getKey('p256dh');
    if (rawKey) p256dh = arrayBufferToBase64Url(rawKey);
  }
  if (!auth && typeof sub.getKey === 'function') {
    const rawAuth = sub.getKey('auth');
    if (rawAuth) auth = arrayBufferToBase64Url(rawAuth);
  }

  const endpoint = sub.endpoint || subJSON.endpoint;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Không trích xuất được thông tin xác thực Push từ thiết bị.');
  }

  // 6. Gửi subscription lên máy chủ NetViet HR
  await api.post('/api/notifications/push-subscribe', {
    endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent,
  });

  return sub;
}

export async function unsubscribePushNotification() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try {
        await api.post('/api/notifications/push-unsubscribe', { endpoint });
      } catch (_) {}
    }
    return true;
  } catch (err) {
    console.warn('Lỗi khi hủy đăng ký push:', err);
    return false;
  }
}

export async function testPushNotification() {
  return await api.post('/api/notifications/test-push', {});
}

export async function autoSyncPushSubscription() {
  if (!isPushSupported()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const subJSON = sub.toJSON ? sub.toJSON() : {};
      let p256dh = subJSON.keys?.p256dh;
      let auth = subJSON.keys?.auth;

      if (!p256dh && typeof sub.getKey === 'function') {
        const rawKey = sub.getKey('p256dh');
        if (rawKey) p256dh = arrayBufferToBase64Url(rawKey);
      }
      if (!auth && typeof sub.getKey === 'function') {
        const rawAuth = sub.getKey('auth');
        if (rawAuth) auth = arrayBufferToBase64Url(rawAuth);
      }

      const endpoint = sub.endpoint || subJSON.endpoint;
      if (endpoint && p256dh && auth) {
        await api.post('/api/notifications/push-subscribe', {
          endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent,
        });
      }
    }
  } catch (_) {
    // Silent fail in background sync
  }
}
