/* ═══════════════════════════════════════════════════
   Fleetly — Service Worker
   Önbellek stratejisi:
   - Uygulama kabuğu (HTML/CSS/JS) → Cache First
   - Supabase API istekleri → Network First (canlı veri)
   - Fontlar / CDN kaynakları → Cache First
═══════════════════════════════════════════════════ */

const CACHE_NAME = 'fleetly-v1';
const CACHE_NAME_CDN = 'fleetly-cdn-v1';

/* Uygulama kabuğu — her zaman önbellekle */
const APP_SHELL = [
  '/onerfilotakip/',
  '/onerfilotakip/index.html',
  '/onerfilotakip/config.js',
  '/onerfilotakip/manifest.json',
];

/* CDN kaynakları — önbellekte tut */
const CDN_ORIGINS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

/* ── Install ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CACHE_NAME_CDN)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Supabase API → daima ağdan al (canlı veri) */
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Çevrimdışısınız' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  /* CDN kaynakları → önce önbellek */
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(
      caches.open(CACHE_NAME_CDN).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  /* Uygulama kabuğu → önce önbellek, yoksa ağdan */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache =>
            cache.put(event.request, response.clone())
          );
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
