/* =============================================================================
 * error-logger.js — DIY hata toplayıcı (Sentry alternatifi, ücretsiz)
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_09__app_errors_logger.sql
 *
 * Yakaladığı hatalar:
 *   1. window.onerror — yakalanmayan synchronous JS hataları
 *   2. unhandledrejection — yakalanmayan Promise rejection'ları
 *   3. console.error — kasıtlı debug logları (severity='warn' olarak)
 *
 * Hatalar Supabase'de `app_errors` tablosuna otomatik yazılır.
 * Yönetici Supabase Dashboard > Table Editor > app_errors üzerinden inceler.
 *
 * Anti-flood:
 *   - Aynı kaynak (file:line) hatası 60sn'de en fazla 3 kez yazılır
 *   - 60sn içinde 50'den fazla log → logger geçici olarak kapanır (1 dk)
 *   - app_errors POST'unun kendisi hata olursa SUSAR (sonsuz döngü engeli)
 *
 * Bağımlılıklar:
 *   - window.sbUrl, window.sbHeaders (app-chunk-02.js sonrası yüklenmeli)
 *   - window.currentFirmaId (kullanıcı firmasına bağlandıktan sonra dolar)
 * =========================================================================== */

(function() {
  'use strict';
  if (window._fleetlyLoggerActive) return;  // çift yükleme koruması
  window._fleetlyLoggerActive = true;

  // ──────────────────────────────────────────────────────────────────────────
  // Anti-flood
  // ──────────────────────────────────────────────────────────────────────────
  let _logCount = 0;
  let _flooded = false;
  const _seenKey = new Map();   // key → count (60sn pencere)
  setInterval(() => {
    _logCount = 0;
    _seenKey.clear();
    if (_flooded) {
      _flooded = false;
      console.info('[error-logger] flood koruması kapandı');
    }
  }, 60000);

  function _shouldLog(key) {
    if (_flooded) return false;
    _logCount++;
    if (_logCount > 50) {
      _flooded = true;
      console.warn('[error-logger] flood — 60sn boyunca log atılmayacak');
      return false;
    }
    if (key) {
      const c = (_seenKey.get(key) || 0) + 1;
      _seenKey.set(key, c);
      if (c > 3) return false;   // aynı kaynak max 3 kez
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Logger — Supabase REST POST. Recursion engeli için orijinal fetch.
  // ──────────────────────────────────────────────────────────────────────────
  // app-chunk-02.js fetch'i sarmalıyor (401 handler). Logger kendi POST'unu
  // sarmalanmamış orijinal fetch ile atsın ki app_errors'a 401 dönerse sonsuz
  // döngü olmasın. Patch'ten önce yüklenirsek sarmalanmamış fetch kullanırız.
  const _rawFetch = window.fetch.bind(window);

  function _logToDb(payload) {
    try {
      if (!window.sbUrl || !window.sbHeaders) return;
      // Auth bozuk durumdaysa yine deneyelim — anon key ile gider, RLS authenticated
      // istediği için fail edebilir; o zaman sessizce vazgeç.
      const body = JSON.stringify({
        firma_id   : window.currentFirmaId || null,
        user_id    : (window._authUserId)  || null,
        user_email : (window._authUserEmail) || null,
        platform   : 'web',
        severity   : payload.severity || 'error',
        message    : (payload.message || '').slice(0, 4000),
        stack      : (payload.stack   || '').slice(0, 8000),
        source     : (payload.source  || '').slice(0, 500),
        url        : (location.href   || '').slice(0, 1000),
        user_agent : (navigator.userAgent || '').slice(0, 500),
        context    : payload.context || null
      });
      // Header'a Prefer ekleme — boş response yeter (bandwidth tasarrufu)
      const headers = window.sbHeaders();
      headers['Prefer'] = 'return=minimal';
      _rawFetch(window.sbUrl('app_errors'), {
        method: 'POST',
        headers,
        body,
        keepalive: true   // sayfa kapanırken bile gönder
      }).catch(() => {});  // sessiz: app_errors POST hatasını TEKRAR loglamayalım
    } catch (_) {
      // Logger'ın kendisi patlamasın
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1) Synchronous hatalar — window.onerror
  // ──────────────────────────────────────────────────────────────────────────
  window.addEventListener('error', (e) => {
    // Resource yükleme hataları (img/script 404) için target tag tipi belli
    if (e.target && e.target !== window && e.target.tagName) {
      const key = `RES:${e.target.tagName}:${e.target.src || e.target.href || ''}`;
      if (!_shouldLog(key)) return;
      _logToDb({
        severity: 'warn',
        message: `Resource yüklenemedi: ${e.target.tagName} ${e.target.src || e.target.href || ''}`,
        source: e.target.tagName,
        context: { kind: 'resource' }
      });
      return;
    }
    const msg = e.message || (e.error?.message) || 'Unknown error';
    const src = e.filename ? `${e.filename}:${e.lineno || 0}:${e.colno || 0}` : '';
    if (!_shouldLog(`JS:${src}:${msg.slice(0, 50)}`)) return;
    _logToDb({
      severity: 'error',
      message: msg,
      stack: e.error?.stack || '',
      source: src
    });
  }, true);

  // ──────────────────────────────────────────────────────────────────────────
  // 2) Promise rejection — unhandledrejection
  // ──────────────────────────────────────────────────────────────────────────
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = (r && (r.message || r.toString())) || 'Unhandled rejection';
    const stack = r?.stack || '';
    if (!_shouldLog(`PR:${msg.slice(0, 100)}`)) return;
    _logToDb({
      severity: 'error',
      message: 'Unhandled promise: ' + msg,
      stack
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3) console.error patch — kasıtlı log'lar (severity='warn')
  // ──────────────────────────────────────────────────────────────────────────
  const _origConsoleError = console.error.bind(console);
  console.error = function(...args) {
    _origConsoleError(...args);
    try {
      const msg = args.map(a => {
        if (a == null) return String(a);
        if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(' ');
      const errArg = args.find(a => a instanceof Error);
      if (!_shouldLog(`CE:${msg.slice(0, 80)}`)) return;
      _logToDb({
        severity: 'warn',
        message: msg.slice(0, 2000),
        stack: errArg?.stack || ''
      });
    } catch (_) {}
  };

  console.info('[error-logger] aktif — hatalar app_errors tablosuna yazılır');
})();
