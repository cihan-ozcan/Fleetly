/* =============================================================================
 * filo-api.js — Filo Yönetimi: Çekici / Dorse / Eşleşme API katmanı
 * -----------------------------------------------------------------------------
 * Karar dokümanı: docs/filo-cekici-dorse.md
 * Migration:      css/db/migrations/2026_05_04__filo_cekici_dorse.sql
 *
 * Bu modül `araclar`, `dorse_tipleri`, `arac_dorse_atamalari` ve
 * `v_aktif_eslesmeler` üzerinde okuma/yazma yapar. Local mode'da (Supabase URL
 * girilmemişken) localStorage cache'ten okur, yazma çağrıları sessizce başarılı
 * olur — UI testleri için.
 *
 * Bağımlılıklar (window scope):
 *   sbUrl, sbHeaders, isLocalMode      → js/pages/app-chunk-02.js
 *   currentFirmaId                      → js/core/store.js
 *   _authToken                          → auth chain
 *
 * Kullanım:
 *   await FiloAPI.cekiciList()                         // [{id, plaka, ...}]
 *   await FiloAPI.dorseList()                          // [{id, plaka, dorse_tipi, kapasite_m3, ...}]
 *   await FiloAPI.dorseTipleri()                       // [{kod, ad, ...}]
 *   await FiloAPI.aractCreate({plaka, kind, ...})      // çekici/dorse/tek_parca
 *   await FiloAPI.aractUpdate(id, patch)
 *   await FiloAPI.aractDelete(id)
 *   await FiloAPI.dorseyiAta(cekiciId, dorseId, {birincilMi, notlar})
 *   await FiloAPI.atamayiSonlandir(atamaId, {bitis})   // bitis default = now()
 *   await FiloAPI.aktifEslesmeler({cekiciId})          // optional filter
 *   await FiloAPI.cekicininDorseleri(cekiciId)         // aktif eşleşmeli dorseler
 * ===========================================================================*/

(function () {
  'use strict';

  // -----------------------------------------------------------------
  // Yardımcılar
  // -----------------------------------------------------------------
  const LS_KEYS = {
    araclar:      'filo_araclar',
    dorseTipleri: 'filo_dorse_tipleri',
    atamalar:     'filo_arac_dorse_atamalari'
  };

  function _firmaId() {
    try { return (window.currentFirmaId || (window.store && window.store.firmaId) || null); }
    catch (_) { return null; }
  }

  function _newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function _lsLoad(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function _lsSave(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
  }

  // _migrationMissing: 404 (tablo yok) ya da 400 + "column does not exist" (kolon yok)
  // tespit edildiğinde true olur. UI bunu izleyip banner gösterir.
  let _migrationMissing = false;
  function _markMigrationMissing(reason) {
    if (_migrationMissing) return;
    _migrationMissing = true;
    console.warn('[FiloAPI] Veritabanı şeması güncel değil:', reason);
    try {
      window.dispatchEvent(new CustomEvent('filo:migration-missing', { detail: { reason } }));
    } catch (_) {}
  }
  function isMigrationMissing() { return _migrationMissing; }

  async function _sbGet(path, opts = {}) {
    if (!window.sbUrl || !window.sbHeaders) throw new Error('Supabase yardımcıları yüklenmedi');
    const res = await fetch(window.sbUrl(path), { headers: window.sbHeaders() });
    if (res.status === 404) {
      _markMigrationMissing('GET ' + path + ' → 404 (tablo/view yok)');
      if (opts.fallbackOn404 !== undefined) return opts.fallbackOn404;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      // PostgREST: 400 + "column ... does not exist"
      if (res.status === 400 && /column .* does not exist/i.test(txt)) {
        _markMigrationMissing('GET ' + path + ' → 400 ' + txt);
        if (opts.fallbackOn404 !== undefined) return opts.fallbackOn404;
      }
      throw new Error('GET ' + path + ' → ' + res.status + (txt ? ' ' + txt : ''));
    }
    return res.json();
  }
  async function _sbPost(path, body) {
    const res = await fetch(window.sbUrl(path), {
      method: 'POST', headers: window.sbHeaders(), body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 404 || (res.status === 400 && /column .* does not exist|relation .* does not exist/i.test(txt))) {
        _markMigrationMissing('POST ' + path + ' → ' + res.status + ' ' + txt);
      }
      throw new Error('POST ' + path + ' → ' + res.status + ' ' + txt);
    }
    return res.json();
  }
  async function _sbPatch(path, body) {
    const res = await fetch(window.sbUrl(path), {
      method: 'PATCH', headers: window.sbHeaders(), body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 404 || (res.status === 400 && /column .* does not exist|relation .* does not exist/i.test(txt))) {
        _markMigrationMissing('PATCH ' + path + ' → ' + res.status + ' ' + txt);
      }
      throw new Error('PATCH ' + path + ' → ' + res.status + ' ' + txt);
    }
    return res.json();
  }
  async function _sbDelete(path) {
    const res = await fetch(window.sbUrl(path), { method: 'DELETE', headers: window.sbHeaders() });
    if (!res.ok) throw new Error('DELETE ' + path + ' → ' + res.status);
    return true;
  }

  // -----------------------------------------------------------------
  // Lookup: dorse tipleri
  // -----------------------------------------------------------------
  let _dorseTipleriCache = null;

  // Migration tablosu yoksa kullanılacak hardcoded seed (SQL ile aynı)
  const _DORSE_TIPLERI_SEED = [
    { kod: 'teleskopik', ad: 'Teleskopik',                varsayilan_kapasite_m3: null, varsayilan_kapasite_ton: null, has_temperatur: false, sira: 10 },
    { kod: 'sabit_40',   ad: 'Sabit 40lık (40 DC)',         varsayilan_kapasite_m3: 67,   varsayilan_kapasite_ton: 28,   has_temperatur: false, sira: 20 },
    { kod: 'sabit_20',   ad: 'Sabit 20lik (20 DC)',         varsayilan_kapasite_m3: 33,   varsayilan_kapasite_ton: 28,   has_temperatur: false, sira: 30 },
    { kod: 'tenteli',    ad: 'Tenteli (Pillow / Curtain)',  varsayilan_kapasite_m3: 90,   varsayilan_kapasite_ton: 24,   has_temperatur: false, sira: 40 },
    { kod: 'frigorifik', ad: 'Frigorifik / Reefer',         varsayilan_kapasite_m3: 80,   varsayilan_kapasite_ton: 22,   has_temperatur: true,  sira: 50 },
    { kod: 'lowbed',     ad: 'Lowbed',                      varsayilan_kapasite_m3: null, varsayilan_kapasite_ton: 40,   has_temperatur: false, sira: 60 },
    { kod: 'silobas',    ad: 'Silobas',                     varsayilan_kapasite_m3: 60,   varsayilan_kapasite_ton: 28,   has_temperatur: false, sira: 70 },
    { kod: 'kuruyuk',    ad: 'Kuru Yük (Sabit Kasa)',       varsayilan_kapasite_m3: 80,   varsayilan_kapasite_ton: 28,   has_temperatur: false, sira: 80 }
  ];

  async function dorseTipleri(force = false) {
    if (_dorseTipleriCache && !force) return _dorseTipleriCache;
    if (window.isLocalMode && window.isLocalMode()) {
      _dorseTipleriCache = _lsLoad(LS_KEYS.dorseTipleri);
      if (!_dorseTipleriCache.length) {
        _dorseTipleriCache = _DORSE_TIPLERI_SEED.slice();
        _lsSave(LS_KEYS.dorseTipleri, _dorseTipleriCache);
      }
      return _dorseTipleriCache;
    }
    // Cloud — 404 ise seed'e düş
    const data = await _sbGet('dorse_tipleri?select=*&order=sira.asc', { fallbackOn404: null });
    _dorseTipleriCache = (data && data.length) ? data : _DORSE_TIPLERI_SEED.slice();
    return _dorseTipleriCache;
  }

  // -----------------------------------------------------------------
  // Listeleme — kind'e göre
  // -----------------------------------------------------------------
  async function _aractList(kind) {
    if (window.isLocalMode && window.isLocalMode()) {
      const all = _lsLoad(LS_KEYS.araclar);
      const norm = all.map(v => ({ kind: 'cekici', ...v }));
      return kind ? norm.filter(v => v.kind === kind) : norm;
    }
    // Migration eksikse `kind` kolonu yok → kind=eq filtresi 400 verir.
    // Bu durumda tüm araclar'ı çekip JS'te filtrele.
    const fullPath = kind ? `araclar?select=*&kind=eq.${kind}&order=plaka.asc` : 'araclar?select=*&order=plaka.asc';
    let data = await _sbGet(fullPath, { fallbackOn404: null });
    if (data == null) {
      // kind kolonu yok → tümünü çek, kind eksiklerini 'cekici' say
      data = await _sbGet('araclar?select=*&order=plaka.asc', { fallbackOn404: [] }) || [];
      data = data.map(v => ({ kind: 'cekici', ...v }));
      if (kind) data = data.filter(v => v.kind === kind);
    }
    return data || [];
  }

  function cekiciList()  { return _aractList('cekici'); }
  function dorseList()   { return _aractList('dorse'); }
  function tekParcaList(){ return _aractList('tek_parca'); }
  function aractListAll(){ return _aractList(null); }
  // Motorlu araçlar = çekici + tek_parca (dorse hariç). Filo "Çekiciler" sekmesinde kullanılır.
  async function motorluList() {
    const all = await _aractList(null);
    return all.filter(v => v.kind === 'cekici' || v.kind === 'tek_parca');
  }

  // -----------------------------------------------------------------
  // CRUD — araç (çekici / dorse / tek_parca ortak path)
  // -----------------------------------------------------------------
  function _validateAract(payload) {
    if (!payload || !payload.plaka) throw new Error('Plaka zorunlu.');
    if (!['cekici', 'dorse', 'tek_parca'].includes(payload.kind || 'cekici')) {
      throw new Error('Geçersiz araç türü (kind).');
    }
    if (payload.kind === 'dorse' && payload.birincil_surucu_id) {
      throw new Error('Dorseye sürücü atanamaz (Karar 5).');
    }
  }

  async function aractCreate(payload) {
    _validateAract(payload);
    const firmaId = _firmaId();
    const row = {
      id: payload.id || _newId(payload.kind || 'arac'),
      plaka: payload.plaka.trim().toUpperCase(),
      kind: payload.kind || 'cekici',
      tip: payload.tip || null,
      marka: payload.marka || null,
      model: payload.model || null,
      yil: payload.yil || null,
      esleme: payload.esleme || null,
      sofor: payload.sofor || null,
      telefon: payload.telefon || null,
      durum: payload.durum || 'Aktif',
      muayene: payload.muayene || null,
      sigorta: payload.sigorta || null,
      takograf: payload.takograf || null,
      notlar: payload.notlar || null,
      birincil_surucu_id: payload.birincil_surucu_id || null,
      // Dorse-spesifik
      dorse_tipi: payload.kind === 'dorse' ? (payload.dorse_tipi || null) : null,
      kapasite_m3: payload.kind === 'dorse' ? (payload.kapasite_m3 != null ? Number(payload.kapasite_m3) : null) : null,
      kapasite_ton: payload.kind === 'dorse' ? (payload.kapasite_ton != null ? Number(payload.kapasite_ton) : null) : null,
      aks_sayisi: payload.kind === 'dorse' ? (payload.aks_sayisi != null ? parseInt(payload.aks_sayisi, 10) : null) : null,
      frigorifik: payload.kind === 'dorse' ? Boolean(payload.frigorifik) : false,
      firma_id: firmaId,
      user_id: payload.user_id || (window._authUserId || null)
    };

    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.araclar);
      list.push(row);
      _lsSave(LS_KEYS.araclar, list);
      return row;
    }
    const created = await _sbPost('araclar', row);
    return Array.isArray(created) ? created[0] : created;
  }

  async function aractUpdate(id, patch) {
    if (!id) throw new Error('id zorunlu.');
    // dorse-spesifik alanlar yalnızca kind=dorse'de patch'lenmeli — UI tarafında zaten kısıtlı
    if (patch && patch.kind === 'dorse' && patch.birincil_surucu_id) {
      throw new Error('Dorseye sürücü atanamaz.');
    }
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.araclar);
      const i = list.findIndex(v => v.id === id);
      if (i < 0) throw new Error('Bulunamadı: ' + id);
      list[i] = { ...list[i], ...patch };
      _lsSave(LS_KEYS.araclar, list);
      return list[i];
    }
    const out = await _sbPatch(`araclar?id=eq.${encodeURIComponent(id)}`, patch);
    return Array.isArray(out) ? out[0] : out;
  }

  async function aractDelete(id) {
    if (!id) throw new Error('id zorunlu.');
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.araclar).filter(v => v.id !== id);
      _lsSave(LS_KEYS.araclar, list);
      // Local atamaları da temizle
      const at = _lsLoad(LS_KEYS.atamalar).filter(a => a.cekici_id !== id && a.dorse_id !== id);
      _lsSave(LS_KEYS.atamalar, at);
      return true;
    }
    return _sbDelete(`araclar?id=eq.${encodeURIComponent(id)}`);
  }

  // -----------------------------------------------------------------
  // Çekici ↔ Dorse atama
  // -----------------------------------------------------------------
  async function dorseyiAta(cekiciId, dorseId, opts = {}) {
    if (!cekiciId || !dorseId) throw new Error('cekici_id ve dorse_id zorunlu.');
    if (cekiciId === dorseId) throw new Error('Aynı kayıt çekici ve dorse olamaz.');

    // Önce dorseyi başka çekiciden çek (uniq partial index zorlar — preemptive temizlik)
    await _dorseyiSerbestBirak(dorseId);

    // Eğer birincil_mi=true geliyorsa, çekicinin önceki birincilini düşür
    if (opts.birincilMi) await _cekicinincBirincilDuzelt(cekiciId);

    const firmaId = _firmaId();
    const row = {
      id: _newId('atama'),
      cekici_id: cekiciId,
      dorse_id: dorseId,
      firma_id: firmaId,
      baslangic: new Date().toISOString(),
      bitis: null,
      birincil_mi: !!opts.birincilMi,
      notlar: opts.notlar || null,
      atayan: window._authUserId || null
    };

    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.atamalar);
      list.push(row);
      _lsSave(LS_KEYS.atamalar, list);
      return row;
    }
    // Supabase tarafı: id'yi DB üretsin
    const dbRow = { ...row };
    delete dbRow.id;
    const created = await _sbPost('arac_dorse_atamalari', dbRow);
    return Array.isArray(created) ? created[0] : created;
  }

  async function atamayiSonlandir(atamaId, opts = {}) {
    if (!atamaId) throw new Error('atama_id zorunlu.');
    const bitis = opts.bitis || new Date().toISOString();
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.atamalar);
      const i = list.findIndex(a => a.id === atamaId);
      if (i < 0) throw new Error('Atama bulunamadı: ' + atamaId);
      list[i].bitis = bitis;
      _lsSave(LS_KEYS.atamalar, list);
      return list[i];
    }
    const out = await _sbPatch(`arac_dorse_atamalari?id=eq.${encodeURIComponent(atamaId)}`, { bitis });
    return Array.isArray(out) ? out[0] : out;
  }

  async function _dorseyiSerbestBirak(dorseId) {
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.atamalar);
      const now = new Date().toISOString();
      let touched = false;
      list.forEach(a => {
        if (a.dorse_id === dorseId && !a.bitis) { a.bitis = now; touched = true; }
      });
      if (touched) _lsSave(LS_KEYS.atamalar, list);
      return touched;
    }
    return _sbPatch(
      `arac_dorse_atamalari?dorse_id=eq.${encodeURIComponent(dorseId)}&bitis=is.null`,
      { bitis: new Date().toISOString() }
    ).catch(() => null);
  }

  async function _cekicinincBirincilDuzelt(cekiciId) {
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEYS.atamalar);
      let touched = false;
      list.forEach(a => {
        if (a.cekici_id === cekiciId && !a.bitis && a.birincil_mi) {
          a.birincil_mi = false; touched = true;
        }
      });
      if (touched) _lsSave(LS_KEYS.atamalar, list);
      return touched;
    }
    return _sbPatch(
      `arac_dorse_atamalari?cekici_id=eq.${encodeURIComponent(cekiciId)}&bitis=is.null&birincil_mi=eq.true`,
      { birincil_mi: false }
    ).catch(() => null);
  }

  // -----------------------------------------------------------------
  // Eşleşme okuma
  // -----------------------------------------------------------------
  async function aktifEslesmeler(opts = {}) {
    if (window.isLocalMode && window.isLocalMode()) {
      const at = _lsLoad(LS_KEYS.atamalar).filter(a => !a.bitis);
      const ar = _lsLoad(LS_KEYS.araclar);
      const tp = await dorseTipleri();
      const filtered = opts.cekiciId ? at.filter(a => a.cekici_id === opts.cekiciId) : at;
      return filtered.map(a => {
        const c = ar.find(v => v.id === a.cekici_id) || {};
        const d = ar.find(v => v.id === a.dorse_id) || {};
        const t = tp.find(x => x.kod === d.dorse_tipi) || null;
        return {
          atama_id: a.id,
          cekici_id: a.cekici_id, cekici_plaka: c.plaka, cekici_marka: c.marka, cekici_model: c.model,
          dorse_id: a.dorse_id,   dorse_plaka: d.plaka,  dorse_marka: d.marka,
          dorse_tipi: d.dorse_tipi, dorse_tipi_ad: t ? t.ad : null,
          kapasite_m3: d.kapasite_m3, kapasite_ton: d.kapasite_ton,
          frigorifik: d.frigorifik,
          birincil_mi: a.birincil_mi,
          baslangic: a.baslangic,
          firma_id: a.firma_id
        };
      });
    }
    let q = 'v_aktif_eslesmeler?select=*&order=cekici_plaka.asc,birincil_mi.desc';
    if (opts.cekiciId) q += `&cekici_id=eq.${encodeURIComponent(opts.cekiciId)}`;
    return (await _sbGet(q, { fallbackOn404: [] })) || [];
  }

  function cekicininDorseleri(cekiciId) { return aktifEslesmeler({ cekiciId }); }

  // -----------------------------------------------------------------
  // Bakım kayıtları (bakim_kayitlari tablosu)
  // -----------------------------------------------------------------
  const LS_KEY_BAKIM = 'filo_bakim_kayitlari';

  async function bakimList(opts = {}) {
    if (window.isLocalMode && window.isLocalMode()) {
      let list = _lsLoad(LS_KEY_BAKIM);
      if (opts.aracId) list = list.filter(b => b.arac_id === opts.aracId);
      return list.sort((a, b) => (b.tarih || '').localeCompare(a.tarih || ''));
    }
    let q = 'bakim_kayitlari?select=*&order=tarih.desc';
    if (opts.aracId) q += `&arac_id=eq.${encodeURIComponent(opts.aracId)}`;
    return (await _sbGet(q, { fallbackOn404: [] })) || [];
  }

  function _validateBakim(payload) {
    if (!payload || !payload.arac_id) throw new Error('Araç zorunlu.');
    if (!payload.tarih) throw new Error('Tarih zorunlu.');
    if (!payload.tur) throw new Error('Tür zorunlu.');
  }

  async function bakimCreate(payload) {
    _validateBakim(payload);
    const firmaId = _firmaId();
    const row = {
      id:            payload.id || _newId('bakim'),
      arac_id:       payload.arac_id,
      tarih:         payload.tarih,
      tur:           payload.tur,
      aciklama:      payload.aciklama || null,
      km:            payload.km != null && payload.km !== '' ? Number(payload.km) : null,
      maliyet:       payload.maliyet != null && payload.maliyet !== '' ? Number(payload.maliyet) : 0,
      sonraki_tarih: payload.sonraki_tarih || null,
      sonraki_km:    payload.sonraki_km != null && payload.sonraki_km !== '' ? Number(payload.sonraki_km) : null,
      servis:        payload.servis || null,
      firma_id:      firmaId,
      user_id:       payload.user_id || (window._authUserId || null)
    };
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEY_BAKIM);
      list.push(row);
      _lsSave(LS_KEY_BAKIM, list);
      return row;
    }
    const created = await _sbPost('bakim_kayitlari', row);
    return Array.isArray(created) ? created[0] : created;
  }

  async function bakimUpdate(id, patch) {
    if (!id) throw new Error('id zorunlu.');
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEY_BAKIM);
      const i = list.findIndex(b => b.id === id);
      if (i < 0) throw new Error('Bakım kaydı bulunamadı: ' + id);
      list[i] = { ...list[i], ...patch };
      _lsSave(LS_KEY_BAKIM, list);
      return list[i];
    }
    const out = await _sbPatch(`bakim_kayitlari?id=eq.${encodeURIComponent(id)}`, patch);
    return Array.isArray(out) ? out[0] : out;
  }

  async function bakimDelete(id) {
    if (!id) throw new Error('id zorunlu.');
    if (window.isLocalMode && window.isLocalMode()) {
      const list = _lsLoad(LS_KEY_BAKIM).filter(b => b.id !== id);
      _lsSave(LS_KEY_BAKIM, list);
      return true;
    }
    return _sbDelete(`bakim_kayitlari?id=eq.${encodeURIComponent(id)}`);
  }

  // -----------------------------------------------------------------
  // Dışa aç
  // -----------------------------------------------------------------
  window.FiloAPI = {
    // Lookup
    dorseTipleri,
    // Listeleme
    cekiciList, dorseList, tekParcaList, aractListAll, motorluList,
    // CRUD
    aractCreate, aractUpdate, aractDelete,
    // Atama
    dorseyiAta, atamayiSonlandir,
    aktifEslesmeler, cekicininDorseleri,
    // Bakım
    bakimList, bakimCreate, bakimUpdate, bakimDelete,
    // Schema durumu
    isMigrationMissing
  };

  // İsteğe bağlı debug log
  if (window.CFG && window.CFG.DEBUG) console.info('[FiloAPI] hazır');
})();
