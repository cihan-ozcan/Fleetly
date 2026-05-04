/* =============================================================================
 * filo-page.js — #filo-page sayfa kontrolcüsü
 * -----------------------------------------------------------------------------
 * Paket 1 (bu dosya): open/close, sekme switch, sayım rozetleri, dorse tipi
 *                     filtre dropdown'ı dolumu, render fonksiyonu iskeletleri.
 * Paket 2: filoRenderCekiciler / filoRenderDorseler tabloları + drawer.
 * Paket 3: filoRenderEslesmeler + atama modalı + iş emri form entegrasyonu.
 *
 * Bağımlılıklar (window): FiloAPI (filo-api.js), suruculer (mevcut global)
 * =========================================================================== */

(function () {
  'use strict';

  // -----------------------------------------------------------------
  // State
  // -----------------------------------------------------------------
  const state = {
    activeTab: 'cekiciler',
    dorseTipleri: [],
    cekiciler: [],
    dorseler: [],
    eslesmeler: [],
    loaded: false
  };

  // -----------------------------------------------------------------
  // Sayfa aç / kapat
  // -----------------------------------------------------------------
  async function openFiloPage() {
    const page = document.getElementById('filo-page');
    if (!page) return;
    page.classList.remove('hidden');
    page.classList.add('open');
    document.body.style.overflow = 'hidden';
    // İlk açılışta veriyi yükle
    await refreshAll();
    // Varsayılan sekme
    switchFiloTab(state.activeTab || 'cekiciler');
  }

  function closeFiloPage() {
    const page = document.getElementById('filo-page');
    if (!page) return;
    page.classList.remove('open');
    page.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // -----------------------------------------------------------------
  // Sekme kontrolü
  // -----------------------------------------------------------------
  function switchFiloTab(name, btn) {
    state.activeTab = name;
    document.querySelectorAll('#filo-page .srm-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#filo-page .srm-tab').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('filo-panel-' + name);
    if (panel) panel.classList.add('active');
    const button = btn || document.getElementById('filo-tab-' + name);
    if (button) button.classList.add('active');

    // Üst sağdaki "Yeni …" butonu sekmeye göre değişsin
    const addLabel = document.getElementById('filo-add-btn-label');
    if (addLabel) {
      addLabel.textContent = ({
        cekiciler:  'Yeni Çekici',
        dorseler:   'Yeni Dorse',
        eslesmeler: 'Yeni Eşleştirme',
        bakim:      'Yeni Bakım Kaydı'
      })[name] || 'Yeni';
    }
  }

  // -----------------------------------------------------------------
  // Veri yükleme
  // -----------------------------------------------------------------
  async function refreshAll() {
    if (!window.FiloAPI) {
      console.warn('[filo-page] FiloAPI yüklü değil');
      return;
    }
    // Her endpoint'i ayrı try'la — biri patlasa bile diğerleri çalışsın.
    const safe = async (fn, fallback) => {
      try { return await fn(); }
      catch (err) { console.warn('[filo-page]', err.message || err); return fallback; }
    };
    const [tipler, cekiciler, dorseler, eslesmeler] = await Promise.all([
      safe(() => window.FiloAPI.dorseTipleri(),    []),
      safe(() => window.FiloAPI.cekiciList(),      []),
      safe(() => window.FiloAPI.dorseList(),       []),
      safe(() => window.FiloAPI.aktifEslesmeler(), [])
    ]);
    state.dorseTipleri = tipler || [];
    state.cekiciler    = cekiciler || [];
    state.dorseler     = dorseler || [];
    state.eslesmeler   = eslesmeler || [];
    state.loaded = true;
    _populateDorseTipFilter();
    _updateCounts();
    _updateMigrationBanner();
    filoRenderCekiciler();
    filoRenderDorseler();
    filoRenderEslesmeler();
  }

  // Migration eksikse sayfanın tepesinde uyarı göster
  function _updateMigrationBanner() {
    const host = document.getElementById('filo-migration-banner');
    if (!host) return;
    const missing = window.FiloAPI && window.FiloAPI.isMigrationMissing && window.FiloAPI.isMigrationMissing();
    if (!missing) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = 'flex';
    host.innerHTML = `
      <span style="font-size:18px;flex-shrink:0;">⚠</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;color:var(--yellow);font-size:13px;margin-bottom:2px;">Veritabanı şeması güncel değil</div>
        <div style="font-size:11.5px;color:var(--text2);line-height:1.5;">
          Filo modülü için <code style="font-family:var(--font-mono);background:rgba(0,0,0,.15);padding:1px 5px;border-radius:3px;">2026_05_04__filo_cekici_dorse.sql</code> migration'ı henüz çalıştırılmadı.
          Dorse, eşleşme ve iş emri dorse atama özellikleri kısıtlı çalışacak. Tipler hardcoded seed'den okunuyor.
        </div>
      </div>
      <button onclick="this.parentElement.style.display='none'" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 4px;flex-shrink:0;">×</button>
    `;
  }

  function _populateDorseTipFilter() {
    const sel = document.getElementById('filo-dorse-tip');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Tüm Tipler</option>' +
      state.dorseTipleri.map(t => `<option value="${t.kod}">${t.ad}</option>`).join('');
    if (cur) sel.value = cur;
  }

  function _updateCounts() {
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('filo-cnt-cekiciler', state.cekiciler.length);
    set('filo-cnt-dorseler',  state.dorseler.length);
    set('filo-cnt-eslesmeler', state.eslesmeler.length);
    const sum = document.getElementById('filo-stat-summary');
    if (sum) {
      sum.textContent =
        `${state.cekiciler.length} çekici · ${state.dorseler.length} dorse · ${state.eslesmeler.length} aktif eşleşme`;
    }
  }

  // -----------------------------------------------------------------
  // Tablo render — Paket 1: minimal placeholder (başlığı + boş state)
  //                Paket 2: tam liste + drawer + düzenle/sil
  // -----------------------------------------------------------------
  function filoRenderCekiciler() {
    const tbody = document.getElementById('filo-cekici-tbody');
    if (!tbody) return;
    const q = (document.getElementById('filo-cekici-search')?.value || '').toLowerCase();
    const durF = document.getElementById('filo-cekici-durum')?.value || '';
    const filt = state.cekiciler.filter(v => {
      const m = !q || [v.plaka, v.marka, v.model, v.sofor].join(' ').toLowerCase().includes(q);
      const d = !durF || v.durum === durF;
      return m && d;
    });
    document.getElementById('filo-cekici-count').textContent = filt.length + ' kayıt';

    if (!filt.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--muted);">
        ${state.loaded ? 'Henüz çekici tanımlanmamış.' : 'Yükleniyor…'}
        <button onclick="openFiloAddModal('cekici')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;margin-left:6px;">+ Yeni çekici ekle</button>
      </td></tr>`;
      return;
    }
    // Paket 1 minimal satır (Paket 2'de drawer + ikonlar genişler)
    tbody.innerHTML = filt.map(v => {
      const aktifDorse = state.eslesmeler.find(e => e.cekici_id === v.id && e.birincil_mi)
                      || state.eslesmeler.find(e => e.cekici_id === v.id);
      const dorseHtml = aktifDorse
        ? `<span style="font-family:var(--font-mono);color:var(--blue);font-weight:600;">${aktifDorse.dorse_plaka || '—'}</span>${aktifDorse.dorse_tipi_ad ? `<div style="font-size:10.5px;color:var(--muted);margin-top:1px;">${aktifDorse.dorse_tipi_ad}</div>` : ''}`
        : `<span style="color:var(--muted);">—</span>`;
      const muayeneHtml = v.muayene ? `<span style="font-family:var(--font-mono);font-size:11.5px;">${v.muayene}</span>` : '<span style="color:var(--muted);">—</span>';
      const sigortaHtml = v.sigorta ? `<span style="font-family:var(--font-mono);font-size:11.5px;">${v.sigorta}</span>` : '<span style="color:var(--muted);">—</span>';
      return `
      <tr>
        <td><span class="plate-cell" style="color:var(--accent);font-weight:700;">${v.plaka}</span></td>
        <td>${[v.marka, v.model].filter(Boolean).join(' ') || '—'}</td>
        <td><span class="mono">${v.yil || '—'}</span></td>
        <td>${v.sofor || '<span style="color:var(--muted);">—</span>'}</td>
        <td>${dorseHtml}</td>
        <td><span class="ops-badge ${(v.durum||'').toLowerCase()}">${v.durum || 'Aktif'}</span></td>
        <td>${muayeneHtml}</td>
        <td>${sigortaHtml}</td>
        <td class="col-islem">
          <div style="display:flex;gap:4px;">
            <button onclick="openFiloEslesmeModal('${v.id}')" class="icon-btn" title="Dorse Ata" style="color:var(--blue);">🔗</button>
            <button onclick="openFiloEditModal('${v.id}')" class="icon-btn" title="Düzenle" style="color:var(--accent);">✎</button>
            <button onclick="filoDeleteAract('${v.id}')" class="icon-btn del" title="Sil">🗑</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function filoRenderDorseler() {
    const tbody = document.getElementById('filo-dorse-tbody');
    if (!tbody) return;
    const q = (document.getElementById('filo-dorse-search')?.value || '').toLowerCase();
    const tipF = document.getElementById('filo-dorse-tip')?.value || '';
    const durF = document.getElementById('filo-dorse-durum')?.value || '';
    const filt = state.dorseler.filter(v => {
      const m = !q || [v.plaka, v.marka, v.dorse_tipi].join(' ').toLowerCase().includes(q);
      const t = !tipF || v.dorse_tipi === tipF;
      const d = !durF || v.durum === durF;
      return m && t && d;
    });
    document.getElementById('filo-dorse-count').textContent = filt.length + ' kayıt';

    if (!filt.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--muted);">
        ${state.loaded ? 'Henüz dorse tanımlanmamış.' : 'Yükleniyor…'}
        <button onclick="openFiloAddModal('dorse')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;margin-left:6px;">+ Yeni dorse ekle</button>
      </td></tr>`;
      return;
    }
    const tipMap = Object.fromEntries(state.dorseTipleri.map(t => [t.kod, t.ad]));
    tbody.innerHTML = filt.map(v => {
      const baglı = state.eslesmeler.find(e => e.dorse_id === v.id);
      const baglıHtml = baglı
        ? `<span style="font-family:var(--font-mono);color:var(--accent);font-weight:600;">${baglı.cekici_plaka}</span>`
        : '<span style="color:var(--muted);">— serbest</span>';
      const kapHtml = [];
      if (v.kapasite_m3 != null)  kapHtml.push(`${v.kapasite_m3} m³`);
      if (v.kapasite_ton != null) kapHtml.push(`${v.kapasite_ton} ton`);
      if (v.frigorifik) kapHtml.push('❄️');
      return `
      <tr>
        <td><span class="plate-cell" style="color:var(--blue);font-weight:700;">${v.plaka}</span></td>
        <td>${v.marka || '—'}</td>
        <td>${v.dorse_tipi ? `<span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);padding:2px 8px;border-radius:99px;">${tipMap[v.dorse_tipi] || v.dorse_tipi}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
        <td><span class="mono" style="font-size:11.5px;">${kapHtml.length ? kapHtml.join(' · ') : '—'}</span></td>
        <td><span class="mono">${v.aks_sayisi != null ? v.aks_sayisi : '—'}</span></td>
        <td>${baglıHtml}</td>
        <td><span class="ops-badge ${(v.durum||'').toLowerCase()}">${v.durum || 'Aktif'}</span></td>
        <td class="col-islem">
          <div style="display:flex;gap:4px;">
            <button onclick="openFiloEditModal('${v.id}')" class="icon-btn" title="Düzenle" style="color:var(--accent);">✎</button>
            <button onclick="filoDeleteAract('${v.id}')" class="icon-btn del" title="Sil">🗑</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function filoRenderEslesmeler() {
    const tbody = document.getElementById('filo-eslesme-tbody');
    if (!tbody) return;
    document.getElementById('filo-eslesme-count').textContent = state.eslesmeler.length + ' aktif';

    if (!state.eslesmeler.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--muted);">
        Henüz aktif eşleştirme yok.
        <button onclick="openFiloEslesmeModal()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;margin-left:6px;">+ Yeni eşleştirme</button>
      </td></tr>`;
      return;
    }
    tbody.innerHTML = state.eslesmeler.map(e => {
      const kap = [];
      if (e.kapasite_m3 != null)  kap.push(`${e.kapasite_m3} m³`);
      if (e.kapasite_ton != null) kap.push(`${e.kapasite_ton} ton`);
      const tipKap = [e.dorse_tipi_ad, kap.join(' · ')].filter(Boolean).join(' — ') || '—';
      return `
      <tr>
        <td><span class="plate-cell" style="color:var(--accent);font-weight:700;">${e.cekici_plaka}</span>${e.cekici_marka ? `<div style="font-size:10.5px;color:var(--muted);margin-top:1px;">${[e.cekici_marka, e.cekici_model].filter(Boolean).join(' ')}</div>` : ''}</td>
        <td><span class="plate-cell" style="color:var(--blue);font-weight:700;">${e.dorse_plaka}</span></td>
        <td style="font-size:12px;">${tipKap}</td>
        <td>${e.birincil_mi ? '<span style="background:rgba(255,107,31,.15);color:var(--accent);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">★ Birincil</span>' : '<span style="color:var(--muted);font-size:11px;">—</span>'}</td>
        <td><span class="mono" style="font-size:11.5px;">${e.baslangic ? new Date(e.baslangic).toLocaleDateString('tr-TR') : '—'}</span></td>
        <td style="font-size:11.5px;color:var(--text2);">${e.notlar || '—'}</td>
        <td class="col-islem">
          <button onclick="filoSonlandirAtama('${e.atama_id}')" class="icon-btn" title="Eşleştirmeyi sonlandır" style="color:var(--red);">✕</button>
        </td>
      </tr>`;
    }).join('');
  }

  // -----------------------------------------------------------------
  // Modal: Çekici / Dorse / Tek Parça ekleme & düzenleme
  // Tek modal (#filo-modal-bg), kind'e göre alanlar görünür/gizlenir.
  // -----------------------------------------------------------------
  // Modal-içi state
  const modalState = {
    mode: 'create',   // 'create' | 'edit'
    kind: 'cekici',   // aktif tür
    editingId: null
  };

  function _$(id) { return document.getElementById(id); }
  function _setVal(id, v)   { const el = _$(id); if (el) el.value = (v == null ? '' : v); }
  function _getVal(id)      { return (_$(id)?.value || '').trim(); }
  function _showErr(msg)    { const el = _$('filo-m-error'); if (!el) return; el.style.display = msg ? 'block' : 'none'; el.textContent = msg || ''; }

  function _populateDorseTipiSelect() {
    const sel = _$('filo-m-dorse-tipi');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Seçin…</option>' +
      state.dorseTipleri.map(t => `<option value="${t.kod}" data-m3="${t.varsayilan_kapasite_m3 ?? ''}" data-ton="${t.varsayilan_kapasite_ton ?? ''}" data-frig="${t.has_temperatur ? '1' : ''}">${t.ad}</option>`).join('');
    if (cur) sel.value = cur;
  }

  function _resetForm() {
    ['filo-m-plaka','filo-m-marka','filo-m-model','filo-m-yil','filo-m-sofor','filo-m-telefon',
     'filo-m-muayene','filo-m-sigorta','filo-m-takograf','filo-m-dorse-tipi','filo-m-aks',
     'filo-m-m3','filo-m-ton','filo-m-notlar'].forEach(id => _setVal(id, ''));
    const fr = _$('filo-m-frigorifik'); if (fr) fr.checked = false;
    _setVal('filo-m-durum', 'Aktif');
    _showErr('');
  }

  function _applyKindUI(kind) {
    modalState.kind = kind;
    // Segmented active
    document.querySelectorAll('#filo-m-kind-segmented .filo-seg').forEach(b => {
      b.classList.toggle('active', b.dataset.kind === kind);
    });
    // Bölümler
    const cekiciSec = _$('filo-m-cekici-section');
    const dorseSec  = _$('filo-m-dorse-section');
    if (cekiciSec) cekiciSec.style.display = (kind === 'dorse') ? 'none' : 'flex';
    if (dorseSec)  dorseSec.style.display  = (kind === 'dorse') ? 'flex' : 'none';
    // Header
    const titleEl = _$('filo-modal-title');
    const subEl   = _$('filo-modal-sub');
    const iconEl  = _$('filo-modal-icon');
    const isEdit  = modalState.mode === 'edit';
    if (titleEl) titleEl.textContent =
      (isEdit ? 'Düzenle: ' : 'Yeni ') +
      ({ cekici: 'Çekici', dorse: 'Dorse', tek_parca: 'Tek Parça' })[kind];
    if (subEl) subEl.textContent =
      kind === 'dorse'
        ? 'Dorse plakası, tipi, kapasite ve özellikleri.'
        : 'Plaka, marka/model, sürücü ve belge tarihleri.';
    if (iconEl) iconEl.textContent = kind === 'dorse' ? '📦' : (kind === 'tek_parca' ? '🚐' : '🚛');
  }

  function filoMKindSelect(kind) {
    if (modalState.mode === 'edit') return; // düzenlemede tür değişmez
    _applyKindUI(kind);
  }

  function filoMDorseTipiChange() {
    // Tip seçildiğinde, kapasite alanları boşsa varsayılanı doldur
    const sel = _$('filo-m-dorse-tipi');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    const m3  = opt.dataset.m3;
    const ton = opt.dataset.ton;
    const fr  = opt.dataset.frig === '1';
    if (m3 && !_getVal('filo-m-m3'))   _setVal('filo-m-m3', m3);
    if (ton && !_getVal('filo-m-ton')) _setVal('filo-m-ton', ton);
    const frEl = _$('filo-m-frigorifik');
    if (frEl && fr) frEl.checked = true;
  }

  function _setKindLocked(locked) {
    document.querySelectorAll('#filo-m-kind-segmented .filo-seg').forEach(b => {
      if (locked) b.setAttribute('disabled', 'disabled');
      else        b.removeAttribute('disabled');
    });
  }

  function openFiloAddModal(kindHint) {
    if (!state.dorseTipleri.length && window.FiloAPI) {
      // tipler henüz gelmemişse sıcak yükle
      window.FiloAPI.dorseTipleri().then(t => { state.dorseTipleri = t || []; _populateDorseTipiSelect(); });
    }
    _populateDorseTipiSelect();
    _resetForm();
    modalState.mode = 'create';
    modalState.editingId = null;
    const k = kindHint || (state.activeTab === 'dorseler' ? 'dorse' : (state.activeTab === 'eslesmeler' ? 'cekici' : 'cekici'));
    _applyKindUI(k);
    _setKindLocked(false);
    _$('filo-modal-bg').classList.remove('hidden');
    setTimeout(() => _$('filo-m-plaka')?.focus(), 50);
  }

  function openFiloEditModal(id) {
    if (!id) return;
    const v = state.cekiciler.find(x => x.id === id) || state.dorseler.find(x => x.id === id) || state.tekParca?.find?.(x => x.id === id);
    if (!v) {
      if (typeof toast === 'function') toast('Kayıt bulunamadı', 'error');
      return;
    }
    _populateDorseTipiSelect();
    _resetForm();
    modalState.mode = 'edit';
    modalState.editingId = id;
    const kind = v.kind || 'cekici';
    _applyKindUI(kind);
    _setKindLocked(true); // düzenlemede tür değişmez

    _setVal('filo-m-plaka',    v.plaka);
    _setVal('filo-m-durum',    v.durum || 'Aktif');
    _setVal('filo-m-marka',    v.marka);
    _setVal('filo-m-model',    v.model);
    _setVal('filo-m-yil',      v.yil);
    _setVal('filo-m-notlar',   v.notlar);

    if (kind === 'dorse') {
      _setVal('filo-m-dorse-tipi', v.dorse_tipi);
      _setVal('filo-m-aks',        v.aks_sayisi);
      _setVal('filo-m-m3',         v.kapasite_m3);
      _setVal('filo-m-ton',        v.kapasite_ton);
      const fr = _$('filo-m-frigorifik'); if (fr) fr.checked = !!v.frigorifik;
    } else {
      _setVal('filo-m-sofor',    v.sofor);
      _setVal('filo-m-telefon',  v.telefon);
      _setVal('filo-m-muayene',  v.muayene);
      _setVal('filo-m-sigorta',  v.sigorta);
      _setVal('filo-m-takograf', v.takograf);
    }
    _$('filo-modal-bg').classList.remove('hidden');
    setTimeout(() => _$('filo-m-plaka')?.focus(), 50);
  }

  function closeFiloModal() {
    _$('filo-modal-bg')?.classList.add('hidden');
  }

  async function filoMSubmit() {
    const kind  = modalState.kind;
    const plaka = _getVal('filo-m-plaka').toUpperCase().replace(/\s+/g, ' ');
    if (!plaka) { _showErr('Plaka zorunlu.'); _$('filo-m-plaka')?.focus(); return; }
    if (kind === 'dorse' && !_getVal('filo-m-dorse-tipi')) {
      _showErr('Dorse tipi seçin.'); _$('filo-m-dorse-tipi')?.focus(); return;
    }
    // Plaka tekrarını yerel state'te kontrol (DB tarafında uniq constraint yoksa)
    const allList = [...state.cekiciler, ...state.dorseler];
    const conflict = allList.find(x => x.plaka === plaka && x.id !== modalState.editingId);
    if (conflict) {
      _showErr(`Bu plaka zaten kayıtlı (${conflict.kind === 'dorse' ? 'Dorse' : 'Çekici'}: ${conflict.plaka}).`);
      return;
    }

    const yil = _getVal('filo-m-yil');
    const payload = {
      plaka,
      kind,
      durum:  _getVal('filo-m-durum') || 'Aktif',
      marka:  _getVal('filo-m-marka') || null,
      model:  _getVal('filo-m-model') || null,
      yil:    yil ? parseInt(yil, 10) : null,
      notlar: _getVal('filo-m-notlar') || null
    };
    if (kind === 'dorse') {
      Object.assign(payload, {
        dorse_tipi:   _getVal('filo-m-dorse-tipi') || null,
        aks_sayisi:   _getVal('filo-m-aks') || null,
        kapasite_m3:  _getVal('filo-m-m3') || null,
        kapasite_ton: _getVal('filo-m-ton') || null,
        frigorifik:   !!_$('filo-m-frigorifik')?.checked
      });
    } else {
      Object.assign(payload, {
        sofor:    _getVal('filo-m-sofor') || null,
        telefon:  _getVal('filo-m-telefon') || null,
        muayene:  _getVal('filo-m-muayene') || null,
        sigorta:  _getVal('filo-m-sigorta') || null,
        takograf: _getVal('filo-m-takograf') || null
      });
    }

    const btn = _$('filo-m-submit-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      if (modalState.mode === 'edit') {
        await window.FiloAPI.aractUpdate(modalState.editingId, payload);
        if (typeof toast === 'function') toast('Güncellendi', 'success');
      } else {
        await window.FiloAPI.aractCreate(payload);
        if (typeof toast === 'function') toast('Eklendi', 'success');
      }
      closeFiloModal();
      await refreshAll();
      // Aktif sekmeyi türe göre değiştir (yeni dorse eklenmişse Dorseler'a geç)
      if (modalState.mode === 'create') {
        const targetTab = kind === 'dorse' ? 'dorseler' : 'cekiciler';
        if (state.activeTab !== targetTab) switchFiloTab(targetTab);
      }
    } catch (err) {
      console.error(err);
      _showErr('Kaydedilemedi: ' + (err.message || 'bilinmeyen hata'));
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  // ESC ile kapat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const bg = _$('filo-modal-bg');
      if (bg && !bg.classList.contains('hidden')) closeFiloModal();
    }
  });

  // -----------------------------------------------------------------
  // Eşleştirme Modalı
  // -----------------------------------------------------------------
  function _populateEsCekiciSelect(preselectId) {
    const sel = _$('filo-es-cekici');
    if (!sel) return;
    const opts = state.cekiciler
      .filter(c => (c.durum || 'Aktif') !== 'Pasif')
      .map(c => {
        const aktif = state.eslesmeler.find(e => e.cekici_id === c.id && e.birincil_mi)
                   || state.eslesmeler.find(e => e.cekici_id === c.id);
        const sub = aktif ? ` · şu an: ${aktif.dorse_plaka}` : '';
        return `<option value="${c.id}">${c.plaka}${c.marka ? ' — ' + c.marka : ''}${sub}</option>`;
      }).join('');
    sel.innerHTML = '<option value="">Seçin…</option>' + opts;
    if (preselectId) sel.value = preselectId;
  }

  function _populateEsDorseSelect() {
    const sel = _$('filo-es-dorse');
    if (!sel) return;
    const tipMap = Object.fromEntries(state.dorseTipleri.map(t => [t.kod, t.ad]));
    const opts = state.dorseler
      .filter(d => (d.durum || 'Aktif') !== 'Pasif')
      .map(d => {
        const baglı = state.eslesmeler.find(e => e.dorse_id === d.id);
        const tip = d.dorse_tipi ? tipMap[d.dorse_tipi] || d.dorse_tipi : '';
        const baglıTxt = baglı ? ` · şu an ${baglı.cekici_plaka}'da` : '';
        return `<option value="${d.id}" ${baglı ? 'data-baglı="' + baglı.cekici_plaka + '"' : ''}>${d.plaka}${tip ? ' — ' + tip : ''}${baglıTxt}</option>`;
      }).join('');
    sel.innerHTML = '<option value="">Seçin…</option>' + opts;
  }

  function _esShowWarn(msg) {
    const el = _$('filo-es-warn');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }
  function _esShowErr(msg) {
    const el = _$('filo-es-error');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }

  function openFiloEslesmeModal(cekiciIdHint) {
    if (!state.cekiciler.length) {
      if (typeof toast === 'function') toast('Önce en az bir çekici ekleyin', 'warn');
      else alert('Önce en az bir çekici ekleyin.');
      return;
    }
    if (!state.dorseler.length) {
      if (typeof toast === 'function') toast('Önce en az bir dorse ekleyin', 'warn');
      else alert('Önce en az bir dorse ekleyin.');
      return;
    }
    _populateEsCekiciSelect(cekiciIdHint);
    _populateEsDorseSelect();
    _setVal('filo-es-notlar', '');
    const fr = _$('filo-es-birincil'); if (fr) fr.checked = false;
    _esShowErr(''); _esShowWarn('');
    filoEsCekiciChange();
    filoEsDorseChange();
    _$('filo-eslesme-modal-bg')?.classList.remove('hidden');
  }

  function closeFiloEslesmeModal() {
    _$('filo-eslesme-modal-bg')?.classList.add('hidden');
  }

  function filoEsCekiciChange() {
    const id = _getVal('filo-es-cekici');
    const info = _$('filo-es-cekici-info');
    if (!info) return;
    if (!id) { info.textContent = ''; return; }
    const c = state.cekiciler.find(x => x.id === id);
    const aktifList = state.eslesmeler.filter(e => e.cekici_id === id);
    if (!c) { info.textContent = ''; return; }
    const eklerek = aktifList.length ? `${aktifList.length} aktif dorse: ${aktifList.map(a => a.dorse_plaka + (a.birincil_mi ? '★' : '')).join(', ')}` : 'Henüz dorse atanmamış';
    info.innerHTML = [c.marka, c.model, c.yil].filter(Boolean).join(' ') + ' · <span style="color:var(--text2);">' + eklerek + '</span>';
  }

  function filoEsDorseChange() {
    const id = _getVal('filo-es-dorse');
    const info = _$('filo-es-dorse-info');
    if (!info) return;
    if (!id) { info.textContent = ''; _esShowWarn(''); return; }
    const d = state.dorseler.find(x => x.id === id);
    const baglı = state.eslesmeler.find(e => e.dorse_id === id);
    const kap = [];
    if (d?.kapasite_m3 != null)  kap.push(d.kapasite_m3 + ' m³');
    if (d?.kapasite_ton != null) kap.push(d.kapasite_ton + ' ton');
    if (d?.frigorifik) kap.push('❄️');
    info.textContent = kap.join(' · ') || '—';
    if (baglı) {
      _esShowWarn(`⚠ Bu dorse şu an "${baglı.cekici_plaka}" çekicisine bağlı. Eşleştirilirse o eşleşme otomatik kapatılır.`);
    } else {
      _esShowWarn('');
    }
  }

  async function filoEsSubmit() {
    _esShowErr('');
    const cekiciId = _getVal('filo-es-cekici');
    const dorseId  = _getVal('filo-es-dorse');
    const birincil = !!_$('filo-es-birincil')?.checked;
    const notlar   = _getVal('filo-es-notlar');
    if (!cekiciId) { _esShowErr('Çekici seçin.'); return; }
    if (!dorseId)  { _esShowErr('Dorse seçin.'); return; }

    const btn = _$('filo-es-submit-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      await window.FiloAPI.dorseyiAta(cekiciId, dorseId, { birincilMi: birincil, notlar: notlar || null });
      if (typeof toast === 'function') toast('Eşleştirme oluşturuldu', 'success');
      closeFiloEslesmeModal();
      await refreshAll();
      // Eşleşmeler sekmesine geç
      switchFiloTab('eslesmeler');
    } catch (err) {
      console.error(err);
      _esShowErr('Eşleştirilemedi: ' + (err.message || 'bilinmeyen hata'));
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }
  async function filoSonlandirAtama(atamaId) {
    if (!atamaId) return;
    if (!confirm('Bu eşleştirmeyi sonlandırmak istiyor musunuz?')) return;
    try {
      await window.FiloAPI.atamayiSonlandir(atamaId);
      if (typeof toast === 'function') toast('Eşleştirme sonlandırıldı', 'success');
      await refreshAll();
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Sonlandırılamadı: ' + err.message, 'error');
    }
  }
  async function filoDeleteAract(id) {
    if (!id) return;
    if (!confirm('Bu kaydı silmek istiyor musunuz? Bu işlem geri alınamaz.')) return;
    try {
      await window.FiloAPI.aractDelete(id);
      if (typeof toast === 'function') toast('Silindi', 'success');
      await refreshAll();
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Silinemedi: ' + err.message, 'error');
    }
  }

  // -----------------------------------------------------------------
  // Dışa aç (window üzerinden onclick'lere)
  // -----------------------------------------------------------------
  window.openFiloPage         = openFiloPage;
  window.closeFiloPage        = closeFiloPage;
  window.switchFiloTab        = switchFiloTab;
  window.filoRenderCekiciler  = filoRenderCekiciler;
  window.filoRenderDorseler   = filoRenderDorseler;
  window.filoRenderEslesmeler = filoRenderEslesmeler;
  window.openFiloAddModal     = openFiloAddModal;
  window.openFiloEditModal    = openFiloEditModal;
  window.closeFiloModal       = closeFiloModal;
  window.filoMKindSelect      = filoMKindSelect;
  window.filoMDorseTipiChange = filoMDorseTipiChange;
  window.filoMSubmit          = filoMSubmit;
  window.openFiloEslesmeModal  = openFiloEslesmeModal;
  window.closeFiloEslesmeModal = closeFiloEslesmeModal;
  window.filoEsCekiciChange    = filoEsCekiciChange;
  window.filoEsDorseChange     = filoEsDorseChange;
  window.filoEsSubmit          = filoEsSubmit;
  window.filoSonlandirAtama    = filoSonlandirAtama;
  window.filoDeleteAract       = filoDeleteAract;
})();
