/* =============================================================================
 * osrm-helper.js — Mesafe + süre hesaplayıcı (OSRM) + adres geocode (Nominatim)
 * -----------------------------------------------------------------------------
 * Public:
 *   await OsrmHelper.route(lat1, lng1, lat2, lng2)
 *     → { km, sureDk, kaynak: 'osrm' | 'haversine', cached: bool }
 *   await OsrmHelper.geocode(query, opts?)
 *     → [{ display_name, lat, lng, raw }]  (Nominatim, ülke=TR varsayılan)
 *   OsrmHelper.haversine(lat1, lng1, lat2, lng2) → km (kuş uçuşu × 1.3)
 *   OsrmHelper.formatSure(dk) → '7s 12dk'
 *   OsrmHelper.formatKm(km)   → '645'
 *
 * Notlar:
 *   - OSRM public router (router.project-osrm.org) yoğun saatlerde 503 dönebilir.
 *     Hata durumunda haversine fallback'e düşer; UI'da `kaynak` alanı gösterilebilir.
 *   - Cache: localStorage'da 24 saat. Anahtar = yuvarlanmış 4 ondalık koordinat çifti.
 *   - Nominatim policy: 1 req/sn. Autocomplete kullanıyorsan input debounce şart.
 *   - User-Agent header browser'dan override edilemiyor; Origin yeterli.
 * =========================================================================== */

(function () {
  'use strict';

  const OSRM_BASE      = 'https://router.project-osrm.org';
  const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  const CACHE_KEY      = 'fleetly_osrm_cache_v1';
  const CACHE_TTL_MS   = 24 * 60 * 60 * 1000;
  const TIMEOUT_MS     = 8000;

  // ──────────────────────────────────────────────────────────────────
  // Cache
  // ──────────────────────────────────────────────────────────────────
  function _cacheLoad() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch { return {}; }
  }
  function _cacheSave(obj) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch {}
  }
  function _cacheKey(lat1, lng1, lat2, lng2) {
    const r = (n) => Number(n).toFixed(4);
    return r(lat1) + ',' + r(lng1) + '|' + r(lat2) + ',' + r(lng2);
  }
  function _cacheGet(key) {
    const c = _cacheLoad();
    const v = c[key];
    if (!v) return null;
    if (Date.now() - (v.ts || 0) > CACHE_TTL_MS) {
      delete c[key]; _cacheSave(c);
      return null;
    }
    return v;
  }
  function _cacheSet(key, val) {
    const c = _cacheLoad();
    c[key] = { ...val, ts: Date.now() };
    // En fazla 200 girdi tutalım — eski olanları at
    const keys = Object.keys(c);
    if (keys.length > 200) {
      keys
        .map(k => ({ k, ts: c[k].ts || 0 }))
        .sort((a, b) => a.ts - b.ts)
        .slice(0, keys.length - 200)
        .forEach(({ k }) => delete c[k]);
    }
    _cacheSave(c);
  }

  // ──────────────────────────────────────────────────────────────────
  // Haversine (kuş uçuşu × 1.3 → karayolu yaklaşık)
  // ──────────────────────────────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371.0;
    const r = (d) => d * Math.PI / 180;
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
    const dLat = r(lat2 - lat1);
    const dLng = r(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 1.3 * 10) / 10;  // 1 ondalık
  }

  // ──────────────────────────────────────────────────────────────────
  // fetch with timeout
  // ──────────────────────────────────────────────────────────────────
  function _fetchTimeout(url, opts = {}, ms = TIMEOUT_MS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal })
      .finally(() => clearTimeout(t));
  }

  // ──────────────────────────────────────────────────────────────────
  // Ana route fonksiyonu
  // ──────────────────────────────────────────────────────────────────
  async function route(lat1, lng1, lat2, lng2) {
    const lat1n = Number(lat1), lng1n = Number(lng1);
    const lat2n = Number(lat2), lng2n = Number(lng2);
    if (!isFinite(lat1n) || !isFinite(lng1n) || !isFinite(lat2n) || !isFinite(lng2n)) {
      return null;
    }

    const key = _cacheKey(lat1n, lng1n, lat2n, lng2n);
    const cached = _cacheGet(key);
    if (cached) {
      return { km: cached.km, sureDk: cached.sureDk, kaynak: cached.kaynak, cached: true };
    }

    const url = OSRM_BASE + '/route/v1/driving/'
              + lng1n + ',' + lat1n + ';' + lng2n + ',' + lat2n
              + '?overview=false';
    try {
      const res = await _fetchTimeout(url, { method: 'GET' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.code !== 'Ok' || !json.routes || !json.routes[0]) {
        throw new Error('OSRM yanıt geçersiz: ' + (json.code || '?'));
      }
      const r = json.routes[0];
      const km     = Math.round(r.distance / 100) / 10;       // metre → km, 1 ondalık
      const sureDk = Math.round(r.duration / 60);             // sn → dk
      const result = { km, sureDk, kaynak: 'osrm' };
      _cacheSet(key, result);
      return { ...result, cached: false };
    } catch (e) {
      if (window.CFG && window.CFG.DEBUG) {
        console.warn('[OsrmHelper] OSRM çağrısı başarısız, haversine fallback:', e.message);
      }
      const km = haversine(lat1n, lng1n, lat2n, lng2n);
      // Haversine fallback'i de cache'e koyalım — public router 503 sürerken hayatı kolaylaştırır
      const result = { km, sureDk: km != null ? Math.round(km / 70 * 60) : null, kaynak: 'haversine' };
      // Sadece kısa süreli cache (1 saat) — OSRM ayağa kalkınca tekrar denenebilsin
      const c = _cacheLoad();
      c[key] = { ...result, ts: Date.now() - (CACHE_TTL_MS - 60 * 60 * 1000) };
      _cacheSave(c);
      return { ...result, cached: false };
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Nominatim geocode (autocomplete-friendly)
  // ──────────────────────────────────────────────────────────────────
  async function geocode(query, opts) {
    const q = String(query || '').trim();
    if (!q) return [];
    const params = new URLSearchParams({
      q,
      format: 'json',
      countrycodes: (opts && opts.countrycodes) || 'tr',
      limit: String((opts && opts.limit) || 5),
      addressdetails: '0'
    });
    try {
      const res = await _fetchTimeout(NOMINATIM_BASE + '/search?' + params.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data || []).map(r => ({
        display_name: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        raw: r
      })).filter(x => isFinite(x.lat) && isFinite(x.lng));
    } catch (e) {
      if (window.CFG && window.CFG.DEBUG) {
        console.warn('[OsrmHelper] Nominatim hata:', e.message);
      }
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Format helpers
  // ──────────────────────────────────────────────────────────────────
  function formatSure(dk) {
    if (dk == null || !isFinite(dk)) return '—';
    const s = Math.max(0, Math.round(dk));
    const h = Math.floor(s / 60);
    const m = s % 60;
    if (h === 0) return m + 'dk';
    if (m === 0) return h + 's';
    return h + 's ' + m + 'dk';
  }
  function formatKm(km) {
    if (km == null || !isFinite(km)) return '—';
    return Number(km).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  }

  // ──────────────────────────────────────────────────────────────────
  // Cache yönetimi (debug için)
  // ──────────────────────────────────────────────────────────────────
  function cacheClear() {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
  }

  window.OsrmHelper = {
    route,
    geocode,
    haversine,
    formatSure,
    formatKm,
    cacheClear
  };

  if (window.CFG && window.CFG.DEBUG) console.info('[OsrmHelper] hazır');
})();
