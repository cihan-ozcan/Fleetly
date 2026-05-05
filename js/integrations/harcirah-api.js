/* =============================================================================
 * harcirah-api.js — Harcırah sistemi (frontend API)
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_05d__harcirah_sistemi.sql
 *
 * Kullanım:
 *   await HarcirahAPI.tarifeList()                    // [{id, baslik, tutar, ...}]
 *   await HarcirahAPI.tarifeCreate({...})
 *   await HarcirahAPI.tarifeUpdate(id, patch)
 *   await HarcirahAPI.tarifeDelete(id)
 *   await HarcirahAPI.tarifeMatch({alim_yeri, teslim_yeri, kont_tip, kont_durum})
 *
 *   await HarcirahAPI.kayitList({hafta_no, hafta_yili, sofor, durum})
 *   await HarcirahAPI.kayitCreate({is_emri_id, ...})
 *   await HarcirahAPI.kayitUpdate(id, patch)
 *   await HarcirahAPI.kayitDelete(id)
 *
 *   await HarcirahAPI.haftalikOzet({hafta_yili, hafta_no})
 *   await HarcirahAPI.haftaKapat({sofor_user_id, hafta_yili, hafta_no})
 * =========================================================================== */

(function () {
  'use strict';

  const LS = {
    tarifeler: 'filo_harcirah_tarifeleri',
    kayitlar:  'filo_harcirah_kayitlari',
    haftalik:  'filo_harcirah_haftalik'
  };

  let _migMissing = false;
  function _isLocal() { return typeof window.isLocalMode === 'function' && window.isLocalMode(); }
  function _firmaId() { try { return window.currentFirmaId || null; } catch { return null; } }
  function _ls(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } }
  function _saveLs(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  function _newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  async function _sb(method, path, body) {
    if (!window.sbUrl || !window.sbHeaders) throw new Error('Supabase yardımcıları yok');
    const opts = { method, headers: window.sbHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(window.sbUrl(path), opts);
    if (res.status === 404) {
      _migMissing = true;
      return null;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 400 && /relation .* does not exist|column .* does not exist/i.test(txt)) {
        _migMissing = true;
        return null;
      }
      throw new Error(method + ' ' + path + ' → ' + res.status + ' ' + txt);
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  function isMigrationMissing() { return _migMissing; }

  // ════════════════════════════════════════════════════════
  // TARİFELER (rate card)
  // ════════════════════════════════════════════════════════
  async function tarifeList(opts = {}) {
    if (_isLocal()) {
      let l = _ls(LS.tarifeler);
      if (opts.aktifOnly) l = l.filter(t => t.aktif_mi !== false);
      return l.sort((a, b) => (a.baslik || '').localeCompare(b.baslik || ''));
    }
    let q = 'harcirah_tarifeleri?select=*&order=oncelik.asc,baslik.asc';
    if (opts.aktifOnly) q += '&aktif_mi=eq.true';
    return (await _sb('GET', q)) || [];
  }

  function _validateTarife(p) {
    if (!p || !p.baslik) throw new Error('Başlık zorunlu.');
    if (p.tutar == null || isNaN(Number(p.tutar))) throw new Error('Tutar geçerli olmalı.');
    if (Number(p.tutar) < 0) throw new Error('Tutar negatif olamaz.');
  }

  async function tarifeCreate(payload) {
    _validateTarife(payload);
    const firmaId = _firmaId();
    const row = {
      id:              payload.id || (window.crypto?.randomUUID ? crypto.randomUUID() : _newId('trf')),
      firma_id:        firmaId,
      baslik:          payload.baslik.trim(),
      alim_yeri:       payload.alim_yeri || null,
      teslim_yeri:     payload.teslim_yeri || null,
      bos_donus_yeri:  payload.bos_donus_yeri || null,
      kont_tip:        payload.kont_tip || null,
      kont_durum:      payload.kont_durum || null,
      dorse_tipi:      payload.dorse_tipi || null,
      tutar:           Number(payload.tutar),
      para_birimi:     payload.para_birimi || 'TRY',
      tahmini_km:      payload.tahmini_km != null && payload.tahmini_km !== '' ? Number(payload.tahmini_km) : null,
      tahmini_sure_dk: payload.tahmini_sure_dk != null && payload.tahmini_sure_dk !== '' ? parseInt(payload.tahmini_sure_dk, 10) : null,
      gecerli_baslangic: payload.gecerli_baslangic || new Date().toISOString().slice(0,10),
      gecerli_bitis:   payload.gecerli_bitis || null,
      aktif_mi:        payload.aktif_mi !== false,
      oncelik:         payload.oncelik != null ? parseInt(payload.oncelik, 10) : 100,
      notlar:          payload.notlar || null,
      created_by:      window._authUserId || null
    };
    if (_isLocal()) {
      const list = _ls(LS.tarifeler);
      list.push({ ...row, created_at: new Date().toISOString() });
      _saveLs(LS.tarifeler, list);
      return row;
    }
    const created = await _sb('POST', 'harcirah_tarifeleri', row);
    return Array.isArray(created) ? created[0] : created;
  }

  async function tarifeUpdate(id, patch) {
    if (!id) throw new Error('id zorunlu.');
    if (_isLocal()) {
      const list = _ls(LS.tarifeler);
      const i = list.findIndex(t => t.id === id);
      if (i < 0) throw new Error('Tarife bulunamadı: ' + id);
      list[i] = { ...list[i], ...patch, updated_at: new Date().toISOString() };
      _saveLs(LS.tarifeler, list);
      return list[i];
    }
    const out = await _sb('PATCH', 'harcirah_tarifeleri?id=eq.' + encodeURIComponent(id), {
      ...patch, updated_at: new Date().toISOString()
    });
    return Array.isArray(out) ? out[0] : out;
  }

  async function tarifeDelete(id) {
    if (!id) throw new Error('id zorunlu.');
    if (_isLocal()) {
      const list = _ls(LS.tarifeler).filter(t => t.id !== id);
      _saveLs(LS.tarifeler, list);
      return true;
    }
    return _sb('DELETE', 'harcirah_tarifeleri?id=eq.' + encodeURIComponent(id));
  }

  // Tarife match — Paket B trigger'ı bu RPC'yi server-side çağıracak.
  // Şimdilik client-side yardımcı (manuel kayıt formunda otomatik tutar önerme):
  async function tarifeMatch(criteria) {
    const { alim_yeri, teslim_yeri, kont_tip, kont_durum, dorse_tipi } = criteria || {};
    if (_isLocal()) {
      const list = _ls(LS.tarifeler).filter(t => t.aktif_mi !== false);
      const a = (alim_yeri || '').toLowerCase();
      const b = (teslim_yeri || '').toLowerCase();
      const candidates = list.filter(t => {
        const ta = (t.alim_yeri || '').toLowerCase();
        const tt = (t.teslim_yeri || '').toLowerCase();
        if (t.alim_yeri && a && !(a.includes(ta) || ta.includes(a))) return false;
        if (t.teslim_yeri && b && !(b.includes(tt) || tt.includes(b))) return false;
        if (t.kont_tip && kont_tip && t.kont_tip !== kont_tip) return false;
        if (t.kont_durum && kont_durum && t.kont_durum !== kont_durum) return false;
        if (t.dorse_tipi && dorse_tipi && t.dorse_tipi !== dorse_tipi) return false;
        return true;
      });
      // En spesifik olanı seç
      candidates.sort((x, y) => {
        const sX = (x.alim_yeri ? 0 : 1) + (x.teslim_yeri ? 0 : 1) + (x.kont_tip ? 0 : 1) + (x.kont_durum ? 0 : 1);
        const sY = (y.alim_yeri ? 0 : 1) + (y.teslim_yeri ? 0 : 1) + (y.kont_tip ? 0 : 1) + (y.kont_durum ? 0 : 1);
        return sX - sY || (x.oncelik || 100) - (y.oncelik || 100);
      });
      return candidates[0] || null;
    }
    // Cloud — RPC çağrısı
    const res = await _sb('POST', 'rpc/harcirah_tarife_bul', {
      p_firma_id:    _firmaId(),
      p_alim_yeri:   alim_yeri || null,
      p_teslim_yeri: teslim_yeri || null,
      p_kont_tip:    kont_tip || null,
      p_kont_durum:  kont_durum || null,
      p_dorse_tipi:  dorse_tipi || null
    });
    return Array.isArray(res) && res.length ? res[0] : null;
  }

  // ════════════════════════════════════════════════════════
  // KAYITLAR
  // ════════════════════════════════════════════════════════
  async function kayitList(opts = {}) {
    if (_isLocal()) {
      let l = _ls(LS.kayitlar);
      if (opts.hafta_no != null)   l = l.filter(k => k.hafta_no === opts.hafta_no);
      if (opts.hafta_yili != null) l = l.filter(k => k.hafta_yili === opts.hafta_yili);
      if (opts.sofor)              l = l.filter(k => k.sofor_user_id === opts.sofor || k.sofor_ad === opts.sofor);
      if (opts.durum)              l = l.filter(k => k.durum === opts.durum);
      return l.sort((a, b) => (b.is_tarihi || '').localeCompare(a.is_tarihi || ''));
    }
    let q = 'harcirah_kayitlari?select=*&order=is_tarihi.desc,created_at.desc&limit=500';
    if (opts.hafta_no   != null) q += '&hafta_no=eq.'   + opts.hafta_no;
    if (opts.hafta_yili != null) q += '&hafta_yili=eq.' + opts.hafta_yili;
    if (opts.sofor)              q += '&sofor_user_id=eq.' + encodeURIComponent(opts.sofor);
    if (opts.durum)              q += '&durum=eq.' + encodeURIComponent(opts.durum);
    return (await _sb('GET', q)) || [];
  }

  async function kayitCreate(payload) {
    if (!payload) throw new Error('payload zorunlu');
    const firmaId = _firmaId();
    const row = {
      id:                payload.id || (window.crypto?.randomUUID ? crypto.randomUUID() : _newId('hrc')),
      firma_id:          firmaId,
      is_emri_id:        payload.is_emri_id || null,
      sofor_user_id:     payload.sofor_user_id || null,
      sofor_ad:          payload.sofor_ad || null,
      arac_id:           payload.arac_id || null,
      arac_plaka:        payload.arac_plaka || null,
      tarife_id:         payload.tarife_id || null,
      hesaplanan_tutar:  payload.hesaplanan_tutar != null ? Number(payload.hesaplanan_tutar) : null,
      manuel_tutar:      payload.manuel_tutar != null && payload.manuel_tutar !== '' ? Number(payload.manuel_tutar) : null,
      ek_masraflar:      Number(payload.ek_masraflar || 0),
      ek_masraf_aciklama: payload.ek_masraf_aciklama || null,
      avans_dusum:       Number(payload.avans_dusum || 0),
      durum:             payload.durum || 'beklemede',
      is_tarihi:         payload.is_tarihi || new Date().toISOString().slice(0, 10),
      aciklama:          payload.aciklama || null
    };
    if (_isLocal()) {
      const tarih = new Date(row.is_tarihi);
      row.hafta_no   = _isoWeek(tarih);
      row.hafta_yili = _isoYear(tarih);
      row.net_tutar  = (row.manuel_tutar ?? row.hesaplanan_tutar ?? 0) + row.ek_masraflar - row.avans_dusum;
      const list = _ls(LS.kayitlar);
      list.push({ ...row, created_at: new Date().toISOString() });
      _saveLs(LS.kayitlar, list);
      return row;
    }
    const created = await _sb('POST', 'harcirah_kayitlari', row);
    return Array.isArray(created) ? created[0] : created;
  }

  async function kayitUpdate(id, patch) {
    if (!id) throw new Error('id zorunlu');
    if (_isLocal()) {
      const list = _ls(LS.kayitlar);
      const i = list.findIndex(k => k.id === id);
      if (i < 0) throw new Error('Kayıt bulunamadı: ' + id);
      list[i] = { ...list[i], ...patch };
      // net_tutar recompute
      list[i].net_tutar = (list[i].manuel_tutar ?? list[i].hesaplanan_tutar ?? 0)
                       + Number(list[i].ek_masraflar || 0)
                       - Number(list[i].avans_dusum || 0);
      _saveLs(LS.kayitlar, list);
      return list[i];
    }
    const out = await _sb('PATCH', 'harcirah_kayitlari?id=eq.' + encodeURIComponent(id), patch);
    return Array.isArray(out) ? out[0] : out;
  }

  async function kayitDelete(id) {
    if (!id) throw new Error('id zorunlu');
    if (_isLocal()) {
      const list = _ls(LS.kayitlar).filter(k => k.id !== id);
      _saveLs(LS.kayitlar, list);
      return true;
    }
    return _sb('DELETE', 'harcirah_kayitlari?id=eq.' + encodeURIComponent(id));
  }

  // Şoför onayı (kendi kaydında durum: beklemede → sofor_onay)
  async function kayitSoforOnay(id) {
    return kayitUpdate(id, { durum: 'sofor_onay', sofor_onay_at: new Date().toISOString() });
  }
  // Operasyon onayı (durum: sofor_onay → ops_onay)
  async function kayitOpsOnay(id) {
    return kayitUpdate(id, {
      durum: 'ops_onay',
      ops_onay_at: new Date().toISOString(),
      ops_onay_user_id: window._authUserId || null
    });
  }
  // Ödendi işaretle
  async function kayitOdendi(id, opts = {}) {
    return kayitUpdate(id, {
      durum: 'odendi',
      odeme_at: new Date().toISOString(),
      odeme_user_id: window._authUserId || null,
      odeme_yontemi: opts.yontem || 'EFT',
      odeme_referans: opts.referans || null
    });
  }
  // İtiraz et (şoför)
  async function kayitItiraz(id, opts) {
    if (!opts || opts.tutar == null) throw new Error('İtiraz tutarı zorunlu.');
    return kayitUpdate(id, {
      durum: 'sofor_itiraz',
      itiraz_tutar: Number(opts.tutar),
      itiraz_aciklama: opts.aciklama || null
    });
  }

  // ════════════════════════════════════════════════════════
  // HAFTALIK ÖZET
  // ════════════════════════════════════════════════════════
  async function haftalikOzet(opts = {}) {
    const { hafta_yili, hafta_no } = opts;
    if (_isLocal()) {
      const kay = _ls(LS.kayitlar).filter(k =>
        (hafta_yili == null || k.hafta_yili === hafta_yili) &&
        (hafta_no   == null || k.hafta_no   === hafta_no)
      );
      // Şoför bazında grup
      const map = new Map();
      kay.forEach(k => {
        const key = (k.sofor_user_id || k.sofor_ad || '—');
        if (!map.has(key)) map.set(key, {
          sofor_user_id: k.sofor_user_id, sofor_ad: k.sofor_ad,
          hafta_yili: k.hafta_yili, hafta_no: k.hafta_no,
          kayit_sayisi: 0, toplam_brut: 0, toplam_ek: 0, toplam_avans: 0, toplam_net: 0,
          beklemede: 0, sofor_onayli: 0, ops_onayli: 0, odendi: 0
        });
        const o = map.get(key);
        o.kayit_sayisi++;
        o.toplam_brut += (k.manuel_tutar ?? k.hesaplanan_tutar ?? 0);
        o.toplam_ek    += Number(k.ek_masraflar || 0);
        o.toplam_avans += Number(k.avans_dusum || 0);
        o.toplam_net   += Number(k.net_tutar || 0);
        if (k.durum === 'beklemede')   o.beklemede++;
        if (k.durum === 'sofor_onay')  o.sofor_onayli++;
        if (k.durum === 'ops_onay')    o.ops_onayli++;
        if (k.durum === 'odendi')      o.odendi++;
      });
      return Array.from(map.values());
    }
    let q = 'v_harcirah_haftalik_ozet?select=*&order=sofor_ad.asc';
    if (hafta_yili != null) q += '&hafta_yili=eq.' + hafta_yili;
    if (hafta_no   != null) q += '&hafta_no=eq.'   + hafta_no;
    return (await _sb('GET', q)) || [];
  }

  // ════════════════════════════════════════════════════════
  // Yardımcı: ISO hafta numarası
  // ════════════════════════════════════════════════════════
  function _isoWeek(d) {
    d = new Date(d);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }
  function _isoYear(d) {
    d = new Date(d);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    return d.getFullYear();
  }
  function suandakiHafta() {
    const now = new Date();
    return { hafta_no: _isoWeek(now), hafta_yili: _isoYear(now) };
  }
  function haftaTarihAraligi(hafta_yili, hafta_no) {
    // ISO: pazartesi günü 1, pazar günü 7
    const simple = new Date(hafta_yili, 0, 1 + (hafta_no - 1) * 7);
    const dow = simple.getDay();
    const monday = new Date(simple);
    if (dow <= 4) monday.setDate(simple.getDate() - simple.getDay() + 1);
    else          monday.setDate(simple.getDate() + 8 - simple.getDay());
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { baslangic: monday, bitis: sunday };
  }

  // ════════════════════════════════════════════════════════
  // Export
  // ════════════════════════════════════════════════════════
  window.HarcirahAPI = {
    isMigrationMissing,
    // Tarife
    tarifeList, tarifeCreate, tarifeUpdate, tarifeDelete, tarifeMatch,
    // Kayıt
    kayitList, kayitCreate, kayitUpdate, kayitDelete,
    kayitSoforOnay, kayitOpsOnay, kayitOdendi, kayitItiraz,
    // Haftalık
    haftalikOzet,
    // Yardımcılar
    suandakiHafta, haftaTarihAraligi, isoWeek: _isoWeek, isoYear: _isoYear
  };

  if (window.CFG && window.CFG.DEBUG) console.info('[HarcirahAPI] hazır');
})();
