/* ═══════════════════════════════════════════════════
   Fleetly — Service Worker
   Önbellek stratejisi:
   - Uygulama kabuğu (HTML/CSS/JS) → Cache First
   - Supabase API istekleri → Network First (canlı veri)
   - Fontlar / CDN kaynakları → Cache First
═══════════════════════════════════════════════════ */

// NOT: Uygulama kabuğu (app.html vb.) değişince CACHE_NAME sürümünü bump'la.
// Aksi halde tarayıcı/PWA eski sayfayı cache'ten yükler ve yeni davet-link
// düzeltmesi gibi değişiklikler son kullanıcıya ulaşmaz.
// Phase 1-5 refactor: CSS / JS dosyaları ayrıldı → cache shell'i güncellendi.
// Sürüm bump: v3 → v4 (eski cache otomatik temizlenir).
const CACHE_NAME = 'fleetly-v4';
const CACHE_NAME_CDN = 'fleetly-cdn-v4';

/* Uygulama kabuğu — her zaman önbellekle */
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/register.html',
  '/portal.html',
  '/musteri_takip.html',
  '/sofor.html',
  '/config.js',
  '/manifest.json',

  // ── CSS dosyaları (Phase 1 + Phase 3 refactor) ──
  '/css/tokens.css',
  '/css/reset.css',
  '/css/pages/app.css',
  '/css/pages/sofor-embedded.css',
  '/css/pages/landing.css',
  '/css/pages/register.css',
  '/css/pages/portal.css',
  '/css/pages/musteri-takip.css',
  '/css/pages/sofor.css',

  // ── JS dosyaları (Phase 4 refactor) ──
  '/js/core/include.js',
  '/js/pages/app-chunk-01.js',
  '/js/pages/app-chunk-02.js',
  '/js/pages/app-chunk-03.js',
  '/js/pages/app-chunk-04.js',
  '/js/pages/app-chunk-05.js',
  '/js/pages/app-chunk-06.js',

  // ── Görseller (Phase 4: base64 çıkarıldı) ──
  '/assets/img/favicon.png',
  '/assets/img/logo.png',
  '/assets/img/logo2.png',
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

  /* HTML (navigate) istekleri → Network-First (yeni sürüm hemen yansısın) */
  // Önceden "cache-first" idi; ancak tek bir app.html eskidiğinde kullanıcının
  // elle cache temizlemesi gerekiyordu (davet linki gibi değişiklikler yansımıyordu).
  // Artık HTML her zaman önce ağdan alınır, ağ yoksa cache'den dönülür.
  const istekHtmlMi =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (istekHtmlMi) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(c => c || caches.match('/app.html') || caches.match('/index.html'))
      )
    );
    return;
  }

  /* Diğer uygulama kabuğu kaynakları (CSS/JS/resim) → önce önbellek, yoksa ağdan */
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
