/* =============================================================================
 * surucu-paylasim-api.js — Şoför Koordinasyon Modülü (frontend API)
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_05j__surucu_paylasimlari.sql
 * Kararlar:  DECISIONS.md (privacy=firma, dm-moderasyon=tam, geçerlilik=uzun, ...)
 *
 * Kullanım (yönetici paneli):
 *   const list = await SuruciuPaylasimAPI.feedList({ kategori, includeStale })
 *   await SuruciuPaylasimAPI.pinToggle(id, true)
 *   await SuruciuPaylasimAPI.softDelete(id)
 *   await SuruciuPaylasimAPI.create({ kategori, mesaj, baslik, pinned })   // duyuru
 *   const comments = await SuruciuPaylasimAPI.commentList(paylasimId)
 *   await SuruciuPaylasimAPI.commentAdd(paylasimId, mesaj)
 *
 *   const dms  = await SuruciuPaylasimAPI.dmList({ since })   // moderasyon listesi
 *   const stats = await SuruciuPaylasimAPI.dmStats()           // konuşma sayım
 *
 *   SuruciuPaylasimAPI.startPolling(intervalMs)
 *   SuruciuPaylasimAPI.stopPolling()
 *   SuruciuPaylasimAPI.onChange(fn)
 *
 * Tasarım notları:
 *   • Web yönetici paneli realtime KULLANMAZ — bildirim sisteminde olduğu gibi
 *     polling (varsayılan 30sn). Mobile (Android) realtime kullanır.
 *   • _sb() helper'ı 404 / "relation does not exist" durumunda sessizce null döner
 *     (migration eksikse panel kırılmasın).
 * =========================================================================== */

(function () {
  'use strict';

  const LS_KEY = 'filo_surucu_feed';
  let _cache = [];
  let _pollTimer = null;
  let _listeners = [];
  let _migrationMissing = false;

  function _firmaId() {
    try { return window.currentFirmaId || null; } catch { return null; }
  }
  function _isLocal() {
    return typeof window.isLocalMode === 'function' && window.isLocalMode();
  }
  function _lsLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function _lsSave(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {} }
  function _emit() {
    const snap = _cache.slice();
    _listeners.forEach(fn => { try { fn(snap); } catch (e) { console.warn('[SuruciuPaylasimAPI] listener err', e); } });
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
      if (res.status === 400 && /relation .* does not exist|column .* does not exist|function .* does not exist/i.test(txt)) {
        _migrationMissing = true;
        return null;
      }
      throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + txt);
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // ----------------------------------------------------------------------
  // FEED — paylaşım listeleme / oluşturma / moderasyon
  // ----------------------------------------------------------------------
  async function feedList(opts = {}) {
    const limit = opts.limit || 100;
    const firmaId = _firmaId();
    if (_isLocal()) {
      let l = _lsLoad();
      if (firmaId) l = l.filter(p => !p.firma_id || p.firma_id === firmaId);
      if (opts.kategori && opts.kategori !== 'all') l = l.filter(p => p.kategori === opts.kategori);
      if (!opts.includeStale) {
        const now = Date.now();
        l = l.filter(p => !p.gecerli_bitis || new Date(p.gecerli_bitis).getTime() > now);
      }
      l.sort((a, b) => {
        if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
      _cache = l.slice(0, limit);
      _emit();
      return _cache;
    }

    let q = 'v_surucu_feed?select=*&order=pinned.desc,created_at.desc&limit=' + limit;
    if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
    if (opts.kategori && opts.kategori !== 'all') q += '&kategori=eq.' + encodeURIComponent(opts.kategori);
    if (!opts.includeStale) q += '&suresi_doldu_mu=is.false';
    const data = await _sb('GET', q);
    _cache = data || [];
    _emit();
    return _cache;
  }

  /**
   * Yönetici "duyuru" paylaşımı oluşturur. RPC zaten kaynak_rol='yonetici'
   * ve pinned=true olarak işler (duyuru rozeti). Şoför mobilden bu fonksiyon
   * çağrılmamalı — bu API yönetici paneli içindir.
   */
  async function create(payload) {
    if (!payload || !payload.kategori || !payload.mesaj) {
      throw new Error('kategori ve mesaj zorunlu');
    }
    if (_isLocal()) {
      const row = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        firma_id: _firmaId(),
        kaynak_user_id: window._authUserId || null,
        kaynak_ad: payload.kaynak_ad || 'Yönetici',
        kaynak_rol: 'yonetici',
        kategori: payload.kategori,
        baslik: payload.baslik || null,
        mesaj: payload.mesaj,
        konum_etiket: payload.konum_etiket || null,
        pinned: payload.pinned !== false,
        begeni_sayisi: 0, yorum_sayisi: 0,
        suresi_doldu_mu: false,
        gecerli_bitis: null,
        created_at: new Date().toISOString()
      };
      const list = _lsLoad();
      list.unshift(row);
      _lsSave(list.slice(0, 200));
      _cache = [row, ..._cache].slice(0, 100);
      _emit();
      return row.id;
    }
    return await _sb('POST', 'rpc/surucu_paylasim_create', {
      p_kategori:      payload.kategori,
      p_mesaj:         payload.mesaj,
      p_baslik:        payload.baslik || null,
      p_konum_lat:     payload.konum_lat ?? null,
      p_konum_lng:     payload.konum_lng ?? null,
      p_konum_url:     payload.konum_url || null,
      p_konum_etiket:  payload.konum_etiket || null,
      p_ilgili_isemri: payload.ilgili_isemri || null,
      p_foto_urls:     payload.foto_urls || null,
      p_gecerli_saat:  payload.gecerli_saat ?? null,
      p_pinned:        payload.pinned ?? null
    });
  }

  /** Pinleme — yöneticinin önemli paylaşımları en üste sabitlemesi. */
  async function pinToggle(id, pinned) {
    if (!id) return;
    if (_isLocal()) {
      const list = _lsLoad();
      const i = list.findIndex(p => p.id === id);
      if (i >= 0) { list[i].pinned = !!pinned; _lsSave(list); }
      const c = _cache.find(p => p.id === id);
      if (c) c.pinned = !!pinned;
      _emit();
      return;
    }
    await _sb('PATCH', 'surucu_paylasimlari?id=eq.' + encodeURIComponent(id), { pinned: !!pinned });
    const c = _cache.find(p => p.id === id);
    if (c) c.pinned = !!pinned;
    _emit();
  }

  /** Soft delete — yönetici uygunsuz paylaşımı gizler. */
  async function softDelete(id) {
    if (!id) return;
    if (_isLocal()) {
      const list = _lsLoad();
      const i = list.findIndex(p => p.id === id);
      if (i >= 0) {
        list[i].silindi_mi = true;
        list[i].silinme_at = new Date().toISOString();
        _lsSave(list);
      }
      _cache = _cache.filter(p => p.id !== id);
      _emit();
      return;
    }
    await _sb('PATCH', 'surucu_paylasimlari?id=eq.' + encodeURIComponent(id), {
      silindi_mi: true,
      silinme_at: new Date().toISOString()
    });
    _cache = _cache.filter(p => p.id !== id);
    _emit();
  }

  // ----------------------------------------------------------------------
  // YORUMLAR
  // ----------------------------------------------------------------------
  async function commentList(paylasimId) {
    if (!paylasimId) return [];
    if (_isLocal()) return [];
    const q = 'surucu_paylasim_yorumlari?select=*&paylasim_id=eq.' +
      encodeURIComponent(paylasimId) + '&silindi_mi=eq.false&order=created_at.asc';
    return (await _sb('GET', q)) || [];
  }

  async function commentAdd(paylasimId, mesaj) {
    if (!paylasimId || !mesaj || !mesaj.trim()) throw new Error('Yorum boş olamaz.');
    if (_isLocal()) return null;
    return await _sb('POST', 'rpc/surucu_paylasim_yorum_ekle', {
      p_paylasim_id: paylasimId,
      p_mesaj: mesaj.trim()
    });
  }

  async function commentDelete(yorumId) {
    if (!yorumId) return;
    if (_isLocal()) return;
    await _sb('PATCH', 'surucu_paylasim_yorumlari?id=eq.' + encodeURIComponent(yorumId), {
      silindi_mi: true
    });
  }

  // ----------------------------------------------------------------------
  // KATEGORİ İSTATİSTİKLERİ (yönetici dashboard kartları)
  // ----------------------------------------------------------------------
  async function categoryStats() {
    if (_isLocal()) {
      const stats = { trafik: 0, liman: 0, fabrika: 0, yakit: 0, soru: 0, genel: 0, total: 0 };
      _cache.forEach(p => {
        if (stats[p.kategori] != null) stats[p.kategori]++;
        stats.total++;
      });
      return stats;
    }
    const firmaId = _firmaId();
    const stats = { trafik: 0, liman: 0, fabrika: 0, yakit: 0, soru: 0, genel: 0, total: 0 };
    const cats = ['trafik','liman','fabrika','yakit','soru','genel'];
    // PostgREST count via Prefer: count=exact + Range header gerekir; basit yol: limit=1 + Content-Range
    // Ancak _sb helper'ımız header dönmüyor — pratik çözüm: id only fetch + length say (cap=500).
    for (const cat of cats) {
      let q = 'surucu_paylasimlari?select=id&silindi_mi=eq.false&kategori=eq.' + cat + '&limit=500';
      if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
      const arr = await _sb('GET', q);
      const n = Array.isArray(arr) ? arr.length : 0;
      stats[cat] = n;
      stats.total += n;
    }
    return stats;
  }

  // ----------------------------------------------------------------------
  // DM MODERASYON (DECISIONS.md #2: yönetici tam erişim)
  // ----------------------------------------------------------------------
  async function dmList(opts = {}) {
    const firmaId = _firmaId();
    if (_isLocal()) return [];
    let q = 'surucu_dm_mesajlari?select=*&order=created_at.desc&limit=' + (opts.limit || 200);
    if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
    if (opts.since) q += '&created_at=gte.' + encodeURIComponent(opts.since);
    if (opts.userId) {
      q += '&or=(gonderen_user_id.eq.' + opts.userId + ',alici_user_id.eq.' + opts.userId + ')';
    }
    return (await _sb('GET', q)) || [];
  }

  /**
   * Konuşma sayım meta verisi — A↔B çiftleri için son 30 günün toplam mesajı.
   * UI: yönetici dashboard'unda "kim kiminle ne sıklıkta" göstergesi.
   */
  async function dmStats() {
    const firmaId = _firmaId();
    if (_isLocal()) return [];
    // Postgres tarafında VIEW yok — basit: son 30 gün ham listeyi çek, JS'te gruplandır.
    let q = 'surucu_dm_mesajlari?select=gonderen_user_id,alici_user_id,gonderen_ad,alici_ad,created_at' +
      '&order=created_at.desc&limit=2000';
    if (firmaId) q += '&firma_id=eq.' + encodeURIComponent(firmaId);
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    q += '&created_at=gte.' + encodeURIComponent(cutoff);
    const rows = (await _sb('GET', q)) || [];
    const map = new Map();
    rows.forEach(r => {
      const a = r.gonderen_user_id, b = r.alici_user_id;
      const key = a < b ? a + '|' + b : b + '|' + a;
      const adA = a < b ? r.gonderen_ad : r.alici_ad;
      const adB = a < b ? r.alici_ad : r.gonderen_ad;
      if (!map.has(key)) map.set(key, { a: a < b ? a : b, b: a < b ? b : a, ad_a: adA, ad_b: adB, sayim: 0, son: r.created_at });
      const m = map.get(key);
      m.sayim++;
      if (r.created_at > m.son) m.son = r.created_at;
    });
    return Array.from(map.values()).sort((x, y) => y.sayim - x.sayim);
  }

  // ----------------------------------------------------------------------
  // ROTA MATE — bir iş emrinin eşleştiği şoförleri listele
  // ----------------------------------------------------------------------
  async function rotaMates(isEmriId) {
    if (!isEmriId) return [];
    if (_isLocal()) return [];
    return (await _sb('POST', 'rpc/surucu_rota_mates', { p_isemri_id: Number(isEmriId) })) || [];
  }

  // ----------------------------------------------------------------------
  // POLLING
  // ----------------------------------------------------------------------
  function startPolling(intervalMs) {
    if (_pollTimer) clearInterval(_pollTimer);
    intervalMs = intervalMs || 30000;
    feedList().catch(err => console.warn('[SuruciuPaylasimAPI] ilk çekim:', err.message));
    _pollTimer = setInterval(() => {
      feedList().catch(() => { /* sessiz */ });
    }, intervalMs);
  }
  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    _listeners.push(fn);
    try { fn(_cache.slice()); } catch (_) {}
    return () => { _listeners = _listeners.filter(f => f !== fn); };
  }
  function getCache() { return _cache.slice(); }
  function isMigrationMissing() { return _migrationMissing; }

  // ----------------------------------------------------------------------
  // EXPORT
  // ----------------------------------------------------------------------
  window.SuruciuPaylasimAPI = {
    // feed
    feedList, create, pinToggle, softDelete,
    // yorum
    commentList, commentAdd, commentDelete,
    // istatistik
    categoryStats,
    // dm moderasyon
    dmList, dmStats,
    // rota mate
    rotaMates,
    // polling
    startPolling, stopPolling, onChange, getCache,
    // util
    isMigrationMissing
  };

  if (window.CFG && window.CFG.DEBUG) console.info('[SuruciuPaylasimAPI] hazır');
})();
