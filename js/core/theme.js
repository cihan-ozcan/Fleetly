/* ===================================================================
   theme.js — Fleetly tema yönetimi (Faz 2)
   - FOUC önleme <head> içindeki inline script tarafından (CSS'ten ÖNCE)
     yapılır; bu dosya sadece runtime davranışını yönetir.
   - Karar mantığı:
       1) Kullanıcı manuel seçim yaptıysa (localStorage 'fleetly:theme-manual'='1')
          → 'fleetly:theme' değerini kullan
       2) Aksi halde OS tercihi (prefers-color-scheme: dark) takip edilir
       3) OS tercihi yok/false ise light (varsayılan)
   - Manuel toggle her seferinde 'manual'='1' set eder; sistem tercihinden
     bağımsız olarak kalır.
   - OS tercihi değiştiğinde, kullanıcı manuel yapmadıysa otomatik geçer.
   =================================================================== */
(function () {
  const STORAGE_KEY = 'fleetly:theme';
  const STORAGE_MANUAL = 'fleetly:theme-manual';
  const PREFERS_DARK = '(prefers-color-scheme: dark)';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  function isManual() {
    return safeGet(STORAGE_MANUAL) === '1';
  }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function applyTheme(theme, opts) {
    document.documentElement.setAttribute('data-theme', theme);
    safeSet(STORAGE_KEY, theme);
    if (opts && opts.manual) safeSet(STORAGE_MANUAL, '1');
    updateThemeIcon();
    // Tema değişimini dinleyenlere haber ver (chart, harita gibi tema-bağımlı UI)
    try {
      window.dispatchEvent(new CustomEvent('fleetly:theme-change', { detail: { theme: theme } }));
    } catch (e) {}
  }

  function updateThemeIcon() {
    const t = getTheme();
    const sun  = document.getElementById('theme-icon-light');
    const moon = document.getElementById('theme-icon-dark');
    if (sun)  sun.style.display  = (t === 'dark') ? 'block' : 'none';
    if (moon) moon.style.display = (t === 'dark') ? 'none'  : 'block';
  }

  // Public API
  window.toggleTheme = function () {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark', { manual: true });
  };
  window.applyTheme = applyTheme;
  window.resetThemePreference = function () {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_MANUAL);
    } catch (e) {}
    // Sistem tercihine geri dön
    const sysDark = window.matchMedia && window.matchMedia(PREFERS_DARK).matches;
    document.documentElement.setAttribute('data-theme', sysDark ? 'dark' : 'light');
    updateThemeIcon();
  };

  function init() {
    updateThemeIcon();

    // OS tercihi değişikliğini dinle — kullanıcı manuel yapmadıysa otomatik takip
    if (window.matchMedia) {
      const mql = window.matchMedia(PREFERS_DARK);
      const handler = function (e) {
        if (!isManual()) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      };
      if (mql.addEventListener) mql.addEventListener('change', handler);
      else if (mql.addListener) mql.addListener(handler);   // Safari < 14
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
