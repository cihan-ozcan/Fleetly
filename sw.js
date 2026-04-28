/* ============================================================
   Fleetly Service Worker  —  PWA + Push Notifications
   ============================================================ */
const CACHE_NAME = 'fleetly-v1';

// ── Kurulum ──
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── Push bildirimi geldi ──
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data?.json() || {}; } catch {}

  const title   = payload.title || '🚛 Fleetly';
  const options = {
    body            : payload.body    || 'Yeni bir iş emri atandı.',
    icon            : '/icon-192.png',
    badge           : '/icon-192.png',
    tag             : payload.tag     || 'fleetly-is-emri',
    data            : { url: payload.url || '/sofor.html' },
    requireInteraction: true,
    vibrate         : [200, 100, 200, 100, 400],
    actions         : [
      { action: 'open',   title: '📋 İş Emrini Aç' },
      { action: 'close',  title: 'Kapat'            }
    ]
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Bildirime tıklandı ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'close') return;

  const targetUrl = e.notification.data?.url || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Açık sekme varsa odaklan
      for (const c of list) {
        if (c.url.includes('sofor.html') && 'focus' in c) return c.focus();
      }
      // Yoksa yeni sekme aç
      return clients.openWindow(targetUrl);
    })
  );
});
