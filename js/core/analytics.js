/* =============================================================================
 * analytics.js — Google Analytics 4 (Faz 7, 2026-05-09)
 * -----------------------------------------------------------------------------
 * GA4_ID config.js'den okunur. Boş ise hiçbir şey yüklenmez.
 *
 * Cookie consent integrasyonu:
 *   - Kullanıcı "Tümünü Kabul Et"  → GA4 yüklenir
 *   - Kullanıcı "Yalnızca Zorunlu" → GA4 yüklenmez (KVKK uyumu)
 *   - Henüz karar verilmemişse     → bekler; consent değiştiğinde aktive edilir
 *
 * Public API:
 *   window.fleetlyTrack(eventName, params?)
 *     — örn. fleetlyTrack('signup_started', { plan: 'aylik' });
 *
 * Sahaya çıkmadan önce config.js'e GA4_ID girilmesi yeterli; tracking otomatik
 * başlar. Cookie banner zaten çerez politikasını anlatıyor.
 * =========================================================================== */

(function () {
  'use strict';

  const CFG = window.FILO_CONFIG || {};
  const GA4_ID = (CFG.GA4_ID || '').trim();

  // GA4 ID yoksa modül no-op
  if (!GA4_ID || !/^G-[A-Z0-9]+$/i.test(GA4_ID)) {
    window.fleetlyTrack = function () { /* no-op */ };
    if (GA4_ID) console.warn('[analytics] GA4_ID format hatalı, atlandı:', GA4_ID);
    return;
  }

  let _loaded = false;
  let _queue  = [];

  function _consentAllows() {
    // Cookie consent yüklenmemişse veya 'all' değilse: hayır
    const cc = window.cookieConsent;
    if (!cc || typeof cc.allows !== 'function') return false;
    return cc.allows('analytics');
  }

  function _loadGA4() {
    if (_loaded) return;
    _loaded = true;

    // gtag stub
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID, {
      anonymize_ip: true,                     // KVKK için IP maskelendirilmeli
      send_page_view: true,
      cookie_flags: 'SameSite=Strict;Secure'
    });

    // GA4 script tag
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`;
    document.head.appendChild(s);

    // Kuyrukta bekleyen event'ler
    while (_queue.length) {
      const [name, params] = _queue.shift();
      window.gtag('event', name, params || {});
    }
    console.info('[analytics] GA4 yüklendi:', GA4_ID);
  }

  // Public track
  window.fleetlyTrack = function (eventName, params) {
    if (!eventName) return;
    if (_loaded) {
      try { window.gtag('event', eventName, params || {}); } catch (_) {}
      return;
    }
    _queue.push([eventName, params || {}]);
    // Tetikleme — consent varsa yükle
    if (_consentAllows()) _loadGA4();
  };

  // İlk yükleme: consent zaten 'all' ise hemen yükle
  function _init() {
    if (_consentAllows()) {
      _loadGA4();
    }
    // Banner kapanışını bekleyen poll — kullanıcı butona basınca consent set olur
    // ama event yok; basit poll (3 saniye, 2 saniye aralıkla 12 deneme = 24 sn)
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (_consentAllows()) {
        clearInterval(t);
        _loadGA4();
      } else if (tries > 30) {
        // 30 deneme × 2 sn = 60 saniye sonra durdur
        clearInterval(t);
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  console.info('[analytics] modül hazır (GA4_ID=' + GA4_ID + ')');
})();
