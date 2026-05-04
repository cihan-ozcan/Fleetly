/* =============================================================================
 * notifications-api.js — Yönetici-yönlü bildirim sistemi (frontend)
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_05__bildirimler.sql
 *
 * Kullanım:
 *   await NotificationsAPI.list({ unreadOnly, limit })  // → [{id, tip, baslik, ...}]
 *   await NotificationsAPI.unreadCount()                // → number
 *   await NotificationsAPI.markRead(id)
 *   await NotificationsAPI.markAllRead()
 *   await NotificationsAPI.create({ tip, baslik, mesaj, ilgili_tur, ilgili_id, oncelik })
 *
 *   NotificationsAPI.startPolling(intervalMs)           // 30sn varsayılan
 *   NotificationsAPI.stopPolling()
 *   NotificationsAPI.onChange(fn)                       // her güncellemede çağrılır
 *
 * Migration eksikse: 404 yakalanır, polling sessizce hata bastırır.
 * =========================================================================== */

(function () {
  'use strict';

  const LS_KEY = 'filo_bildirimler';
  let _cache = [];
  let _pollTimer = null;
  let _listeners = [];
  let _migrationMissing = false;

  function _firmaId() {
    try { return window.currentFirmaId || null; }
    catch (_) { return null; }
  }

  function _lsLoad()      { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function _lsSave(arr)   { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {} }

  function _emit() {
    const snap = _cache.slice();
    _listeners.forEach(fn => { try { fn(snap); } catch (e) { console.warn('[NotifAPI] listener err', e); } });
  }

  function _isLocal() {
    return typeof window.isLocalMode === 'function' && window.isLocalMode();
  }

  async function _sb(method, path, body) {
    if (!window.sbUrl || !window.sbHeaders) throw new Error('Supabase yardımcıları yok');
    const opts = { method, headers: window.sbHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(window.sbUrl(path), opts);
    if (res.status === 404) {
      _migrationMissing = true;
      return null;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 400 && /relation .* does not exist|column .* does not exist/i.test(txt)) {
        _migrationMissing = true;
        return null;
      }
      throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + txt);
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------
  async function list(opts = {}) {
    const limit = opts.limit || 30;
    const firmaId = _firmaId();

    if (_isLocal()) {
      let l = _lsLoad();
      if (firmaId) l = l.filter(b => !b.firma_id || b.firma_id === firmaId);
      if (opts.unreadOnly) l = l.filter(b => !b.okundu_mu);
      l.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      _cache = l.slice(0, limit);
      _emit();
      return _cache;
    }
    let q = 'bildirimler?select=*&order=created_at.desc&limit=' + limit;
    if (opts.unreadOnly) q += '&okundu_mu=eq.false';
    if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
    const data = await _sb('GET', q);
    _cache = data || [];
    _emit();
    return _cache;
  }

  async function unreadCount() {
    if (_isLocal()) {
      const list = _lsLoad();
      return list.filter(b => !b.okundu_mu).length;
    }
    const firmaId = _firmaId();
    let q = 'bildirimler?select=id&okundu_mu=eq.false';
    if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
    // PostgREST: HEAD + Prefer: count=exact verir; Range header da kullanılabilir.
    // Basit yol: id'leri çek ve length say.
    const data = await _sb('GET', q);
    return Array.isArray(data) ? data.length : 0;
  }

  async function markRead(id) {
    if (!id) return;
    if (_isLocal()) {
      const list = _lsLoad();
      const i = list.findIndex(b => b.id === id);
      if (i >= 0) {
        list[i].okundu_mu = true;
        list[i].okundu_at = new Date().toISOString();
        _lsSave(list);
      }
      // Güncelle cache
      const c = _cache.find(b => b.id === id);
      if (c) { c.okundu_mu = true; c.okundu_at = new Date().toISOString(); }
      _emit();
      return;
    }
    await _sb('PATCH', 'bildirimler?id=eq.' + encodeURIComponent(id),
      { okundu_mu: true, okundu_at: new Date().toISOString() });
    const c = _cache.find(b => b.id === id);
    if (c) { c.okundu_mu = true; c.okundu_at = new Date().toISOString(); }
    _emit();
  }

  async function markAllRead() {
    if (_isLocal()) {
      const list = _lsLoad();
      const now = new Date().toISOString();
      list.forEach(b => { if (!b.okundu_mu) { b.okundu_mu = true; b.okundu_at = now; } });
      _lsSave(list);
      _cache.forEach(b => { if (!b.okundu_mu) { b.okundu_mu = true; b.okundu_at = now; } });
      _emit();
      return;
    }
    const firmaId = _firmaId();
    let q = 'bildirimler?okundu_mu=eq.false';
    if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
    await _sb('PATCH', q, { okundu_mu: true, okundu_at: new Date().toISOString() });
    const now = new Date().toISOString();
    _cache.forEach(b => { if (!b.okundu_mu) { b.okundu_mu = true; b.okundu_at = now; } });
    _emit();
  }

  async function create(payload) {
    if (!payload || !payload.tip || !payload.baslik) {
      throw new Error('tip ve baslik zorunlu');
    }
    const firmaId = _firmaId();
    const row = {
      id:             payload.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      firma_id:       firmaId,
      tip:            payload.tip,
      baslik:         payload.baslik,
      mesaj:          payload.mesaj || null,
      ilgili_tur:     payload.ilgili_tur || null,
      ilgili_id:      payload.ilgili_id != null ? String(payload.ilgili_id) : null,
      kaynak_user_id: payload.kaynak_user_id || (window._authUserId || null),
      kaynak_ad:      payload.kaynak_ad || null,
      okundu_mu:      false,
      oncelik:        payload.oncelik || 'normal',
      created_at:     new Date().toISOString()
    };
    if (_isLocal()) {
      const list = _lsLoad();
      list.unshift(row);
      _lsSave(list.slice(0, 200)); // cap
      _cache = [row, ..._cache].slice(0, 30);
      _emit();
      return row;
    }
    // RPC üzerinden insert (SECURITY DEFINER → RLS sorun çıkarmaz)
    const created = await _sb('POST', 'rpc/notify_create', {
      p_firma_id:       firmaId,
      p_tip:            row.tip,
      p_baslik:         row.baslik,
      p_mesaj:          row.mesaj,
      p_ilgili_tur:     row.ilgili_tur,
      p_ilgili_id:      row.ilgili_id,
      p_kaynak_user_id: row.kaynak_user_id,
      p_kaynak_ad:      row.kaynak_ad,
      p_oncelik:        row.oncelik
    });
    // Cache'e ekle (yeniden list() çekmek isteyenler ayrı çağırır)
    list().catch(() => {});
    return created;
  }

  function isMigrationMissing() { return _migrationMissing; }

  // -----------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------
  function startPolling(intervalMs) {
    if (_pollTimer) clearInterval(_pollTimer);
    intervalMs = intervalMs || 30000;
    // İlk çekim
    list().catch(err => console.warn('[NotifAPI] ilk çekim hata:', err.message));
    _pollTimer = setInterval(() => {
      list().catch(() => {/* sessiz */});
    }, intervalMs);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    _listeners.push(fn);
    // Hemen mevcut snapshot'ı tetikle
    try { fn(_cache.slice()); } catch (_) {}
    return () => { _listeners = _listeners.filter(f => f !== fn); };
  }

  function getCache() { return _cache.slice(); }

  // -----------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------
  window.NotificationsAPI = {
    list,
    unreadCount,
    markRead,
    markAllRead,
    create,
    isMigrationMissing,
    startPolling,
    stopPolling,
    onChange,
    getCache
  };

  if (window.CFG && window.CFG.DEBUG) console.info('[NotificationsAPI] hazır');
})();
