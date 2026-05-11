/* =============================================================================
 * guzergah-api.js — Şoför Güzergah Paylaşım Sistemi (frontend API)
 * -----------------------------------------------------------------------------
 * Migrations:
 *   css/db/migrations/2026_05_11j__guzergahlar_schema.sql
 *   css/db/migrations/2026_05_11k__guzergahlar_rpc.sql
 *
 * Pattern: harcirah-api.js (REST + window.sbUrl/sbHeaders, IIFE + window.X).
 *
 * Kullanım:
 *   await GuzergahAPI.list({ durum: 'aktif' })           // tüm aktif paylaşımlar
 *   await GuzergahAPI.list({ durum: 'reddedildi' })      // reddedilmişler (moderasyon)
 *   await GuzergahAPI.get(id)                            // tek güzergah
 *   await GuzergahAPI.durumDegistir(id, 'reddedildi', not)
 *   await GuzergahAPI.topKullanilanlar(5)                // istatistik kart
 *   await GuzergahAPI.topPaylasanlar(5)
 *   await GuzergahAPI.genelOzet()                        // toplam_paylasim/kullanim/begeni
 * =========================================================================== */

(function () {
  'use strict';

  let _migMissing = false;
  function _isLocal() { return typeof window.isLocalMode === 'function' && window.isLocalMode(); }
  function _firmaId() { try { return window.currentFirmaId || null; } catch { return null; } }
  function isMigrationMissing() { return _migMissing; }

  async function _sb(method, path, body) {
    if (!window.sbUrl || !window.sbHeaders) throw new Error('Supabase yardımcıları yok');
    const opts = { method, headers: window.sbHeaders() };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(window.sbUrl(path), opts);
    if (res.status === 404) { _migMissing = true; return null; }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 400 && /relation .* does not exist|function .* does not exist/i.test(txt)) {
        _migMissing = true;
        return null;
      }
      throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + txt);
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // ────────── LİSTE / DETAY ──────────

  /**
   * Güzergah listesi (firma içi, durum filtresine göre).
   * opts: { durum?, hedef?, limit?, soforId? }
   */
  async function list(opts) {
    opts = opts || {};
    if (_isLocal()) return [];
    const fid = _firmaId();
    if (!fid) return [];
    const params = new URLSearchParams();
    params.set('select', '*,suruculer!olusturan_surucu_id(id,ad,soyad)');
    params.set('firma_id', 'eq.' + fid);
    if (opts.durum) params.set('durum', 'eq.' + opts.durum);
    if (opts.hedef) params.set('hedef_ad', 'ilike.*' + opts.hedef + '*');
    if (opts.soforId) params.set('olusturan_surucu_id', 'eq.' + opts.soforId);
    params.set('order', 'created_at.desc');
    params.set('limit', String(opts.limit || 200));
    return (await _sb('GET', 'guzergahlar?' + params.toString())) || [];
  }

  async function get(id) {
    if (_isLocal()) return null;
    const result = await _sb('GET',
      'guzergahlar?select=*,suruculer!olusturan_surucu_id(id,ad,soyad)' +
      '&id=eq.' + encodeURIComponent(id) + '&limit=1'
    );
    return Array.isArray(result) && result[0] ? result[0] : null;
  }

  // ────────── YÖNETİM ──────────

  /** Yönetici onay/red/sil. p_durum: aktif | reddedildi | silindi. */
  async function durumDegistir(id, durum, not) {
    return await _sb('POST', 'rpc/guzergah_durum_degistir', {
      p_id: id,
      p_durum: durum,
      p_not: not || null
    });
  }

  // ────────── İSTATİSTİK ──────────

  /** En çok kullanılan güzergahlar (durum=aktif). */
  async function topKullanilanlar(limit) {
    limit = limit || 5;
    if (_isLocal()) return [];
    const fid = _firmaId();
    if (!fid) return [];
    return (await _sb('GET',
      'guzergahlar?select=id,baslik,hedef_ad,kullanim_sayisi,begeni_sayisi,' +
      'suruculer!olusturan_surucu_id(ad,soyad)' +
      '&firma_id=eq.' + fid +
      '&durum=eq.aktif' +
      '&order=kullanim_sayisi.desc' +
      '&limit=' + limit
    )) || [];
  }

  /** En çok paylaşan şoförler (client-side aggregation, max 1000 kayıt). */
  async function topPaylasanlar(limit) {
    limit = limit || 5;
    if (_isLocal()) return [];
    const fid = _firmaId();
    if (!fid) return [];
    const items = await _sb('GET',
      'guzergahlar?select=olusturan_surucu_id,suruculer!olusturan_surucu_id(ad,soyad)' +
      '&firma_id=eq.' + fid +
      '&durum=eq.aktif' +
      '&limit=1000'
    );
    if (!Array.isArray(items)) return [];
    const grouped = {};
    items.forEach(i => {
      const key = i.olusturan_surucu_id;
      if (!grouped[key]) {
        const s = i.suruculer || {};
        grouped[key] = {
          surucu_id: key,
          ad: ((s.ad || '') + ' ' + (s.soyad || '')).trim() || 'Şoför',
          paylasim_sayisi: 0
        };
      }
      grouped[key].paylasim_sayisi += 1;
    });
    return Object.values(grouped)
      .sort((a, b) => b.paylasim_sayisi - a.paylasim_sayisi)
      .slice(0, limit);
  }

  /** Genel özet: toplam paylaşım/kullanım/beğeni (durum=aktif). */
  async function genelOzet() {
    const empty = { toplam_paylasim: 0, toplam_kullanim: 0, toplam_begeni: 0 };
    if (_isLocal()) return empty;
    const fid = _firmaId();
    if (!fid) return empty;
    const items = await _sb('GET',
      'guzergahlar?select=kullanim_sayisi,begeni_sayisi,durum&firma_id=eq.' + fid + '&limit=2000'
    );
    if (!Array.isArray(items)) return empty;
    const aktif = items.filter(i => i.durum === 'aktif');
    return {
      toplam_paylasim: aktif.length,
      toplam_kullanim: aktif.reduce((s, i) => s + (i.kullanim_sayisi || 0), 0),
      toplam_begeni:   aktif.reduce((s, i) => s + (i.begeni_sayisi || 0), 0)
    };
  }

  // ────────── PUBLIC ──────────

  window.GuzergahAPI = {
    list,
    get,
    durumDegistir,
    topKullanilanlar,
    topPaylasanlar,
    genelOzet,
    isMigrationMissing
  };
})();
