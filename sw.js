/* NetViet HR – Marketing – Service Worker (PWA & Web Push) */
const CACHE = 'netviet-hr-v26-push-unique';
const CORE = ['/', '/index.html', '/favicon.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ════════════════════════════════════════════════
//  FETCH / CACHE HANDLING
// ════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Chỉ handle cùng origin
  if (url.origin !== self.location.origin) return;

  // Không cache API - luôn đi network
  if (url.pathname.startsWith('/api/')) return;

  // Điều hướng (SPA): network-first, fallback về index.html khi offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // JS/CSS: network-first để luôn cập nhật code mới nhất
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Asset tĩnh khác (img/font): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ════════════════════════════════════════════════
//  WEB PUSH NOTIFICATIONS (Màn hình khóa & Background)
// ════════════════════════════════════════════════
self.addEventListener('push', (event) => {
  let payload = {
    title: 'NetViet HR',
    body: 'Bạn có thông báo mới',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/#/notifications',
    tag: 'netviet-hr-notification',
  };

  if (event.data) {
    try {
      const json = event.data.json();
      payload = { ...payload, ...json };
    } catch (_) {
      try {
        const text = event.data.text();
        if (text) payload.body = text;
      } catch (__) {}
    }
  }

  const uniqueTag = payload.tag ? `${payload.tag}-${Date.now()}` : `netviet-hr-${Date.now()}`;
  const options = {
    body: payload.body || 'Bạn có thông báo mới',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: uniqueTag,
    renotify: true,
    data: {
      url: payload.url || '/#/notifications',
      timestamp: Date.now(),
    },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'NetViet HR', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';
  const targetAbsoluteUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Nếu đã có cửa sổ PWA đang mở, điều hướng và focus vào cửa sổ đó
      for (const client of clientList) {
        if ('navigate' in client && 'focus' in client) {
          client.navigate(targetAbsoluteUrl);
          return client.focus();
        }
      }
      // Nếu chưa có cửa sổ nào, mở cửa sổ PWA mới
      if (clients.openWindow) {
        return clients.openWindow(targetAbsoluteUrl);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Khi trình duyệt tự làm mới Push Subscription
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription?.options || { userVisibleOnly: true })
      .then((newSubscription) => {
        // Gửi subscription mới lên server
        return fetch('/api/notifications/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSubscription }),
        });
      })
      .catch((err) => console.warn('Failed to renew push subscription:', err))
  );
});
