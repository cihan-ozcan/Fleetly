/* =============================================================================
 * harcirah-page.js — Harcırah sayfası kontrolcüsü (Paket A)
 * -----------------------------------------------------------------------------
 * Bağımlılıklar (window): HarcirahAPI (harcirah-api.js)
 *
 * Paket A: open/close + sekme switch + Tarifeler sekmesi (CRUD)
 * Paket B: Kayıtlar sekmesi
 * Paket C: Haftalık özet + Arşiv
 * =========================================================================== */

(function () {
  'use strict';

  const state = {
    activeTab: 'tarifeler',
    tarifeler: [],
    ekHizmetler: [],
    kayitlar: [],
    haftalikOzet: [],
    loaded: false,
    // Kayıtlar sekmesi filtre + arama
    kayitFilter: 'aktif',   // 'aktif' | 'beklemede' | 'onayli' | 'itiraz' | 'odendi' | 'tumu'
    kayitArama: ''
  };

  // Durum metaları (renk + ikon)
  const HARC_DURUM_META = {
    beklemede:    { label: 'Beklemede',     icon: '🕐', color: '#f59e0b', bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.30)' },
    sofor_onay:   { label: 'Şoför Onayı',   icon: '✓',  color: '#22c55e', bg: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.30)' },
    sofor_itiraz: { label: 'İtiraz',         icon: '⚠',  color: '#ef4444', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.30)' },
    ops_onay:     { label: 'Ofis Onaylı',   icon: '✓✓', color: '#16a34a', bg: 'rgba(22,163,74,.15)',  border: 'rgba(22,163,74,.35)' },
    odendi:       { label: 'Ödendi',        icon: '💵', color: '#0284c7', bg: 'rgba(2,132,199,.12)',  border: 'rgba(2,132,199,.30)' },
    iptal:        { label: 'İptal',          icon: '✕',  color: 'var(--muted)', bg: 'rgba(148,163,184,.12)', border: 'rgba(148,163,184,.30)' }
  };

  function _$(id) { return document.getElementById(id); }
  function _setVal(id, v) { const el = _$(id); if (el) el.value = (v == null ? '' : v); }
  function _getVal(id) { return (_$(id)?.value || '').trim(); }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

  // ════════════════════════════════════════════════════════
  // Sayfa aç / kapat
  // ════════════════════════════════════════════════════════
  async function openHarcirahPage() {
    const page = _$('harcirah-page');
    if (!page) return;
    page.classList.remove('hidden');
    page.classList.add('open');
    document.body.style.overflow = 'hidden';
    // PDF fontunu arka planda warm-cache (PDF basıldığında anında hazır olsun)
    if (window.PdfFonts && !window.PdfFonts.isCached()) {
      window.PdfFonts.preload();
    }
    await refreshAll();
    _harcStartRealtime();
    switchHarcirahTab(state.activeTab || 'tarifeler');
  }

  function closeHarcirahPage() {
    const page = _$('harcirah-page');
    if (!page) return;
    page.classList.remove('open');
    page.classList.add('hidden');
    document.body.style.overflow = '';
    _harcStopRealtime();
  }

  // ════════════════════════════════════════════════════════
  // REALTIME — harcirah_kayitlari + harcirah_haftalik
  // ════════════════════════════════════════════════════════
  let _harcRealtimeChannel = null;
  let _harcRefreshDebounce = null;

  function _harcDebouncedRefresh() {
    // Kısa burst'leri tek refresh'e indirgemek için 500ms debounce
    if (_harcRefreshDebounce) clearTimeout(_harcRefreshDebounce);
    _harcRefreshDebounce = setTimeout(() => {
      refreshAll().catch(() => {});
    }, 500);
  }

  function _harcStartRealtime() {
    if (_harcRealtimeChannel) return;
    if (typeof getSB !== 'function') return;
    const sb = getSB();
    if (!sb) return;
    try {
      _harcRealtimeChannel = sb
        .channel('harcirah-kayitlari-haftalik')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'harcirah_kayitlari' },
            (payload) => {
              // Kayıt değişti — listeyi tazele (debounced)
              _harcDebouncedRefresh();
              // Eğer onay/itiraz/ödeme aksiyonu varsa toast göster
              if (payload.eventType === 'UPDATE' && payload.new && payload.old) {
                const oldDurum = payload.old.durum;
                const newDurum = payload.new.durum;
                if (oldDurum !== newDurum && typeof toast === 'function') {
                  const msg = ({
                    sofor_onay:   `${payload.new.sofor_ad || 'Şoför'} bir kaydı onayladı`,
                    sofor_itiraz: `${payload.new.sofor_ad || 'Şoför'} bir kaydı itiraz etti ⚠`
                  })[newDurum];
                  if (msg) toast(msg, newDurum === 'sofor_itiraz' ? 'warn' : 'info');
                }
              }
            })
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'harcirah_haftalik' },
            () => { _harcDebouncedRefresh(); })
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'harcirah_tarifeleri' },
            () => { _harcDebouncedRefresh(); })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[Harcırah] Realtime hata — polling fallback devrede');
          }
        });
    } catch (err) {
      console.warn('[Harcırah] Realtime subscribe hata:', err);
    }
  }

  function _harcStopRealtime() {
    if (_harcRefreshDebounce) { clearTimeout(_harcRefreshDebounce); _harcRefreshDebounce = null; }
    if (!_harcRealtimeChannel) return;
    try {
      const sb = getSB();
      sb?.removeChannel?.(_harcRealtimeChannel);
    } catch (_) {}
    _harcRealtimeChannel = null;
  }

  function switchHarcirahTab(name, btn) {
    state.activeTab = name;
    document.querySelectorAll('#harcirah-page .srm-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#harcirah-page .srm-tab').forEach(b => b.classList.remove('active'));
    _$('harc-panel-' + name)?.classList.add('active');
    (btn || _$('harc-tab-' + name))?.classList.add('active');

    const lbl = _$('harcirah-add-btn-label');
    if (lbl) {
      lbl.textContent = ({
        tarifeler: 'Yeni Tarife',
        kayitlar:  'Manuel Kayıt',
        haftalik:  'Hafta Kapat',
        arsiv:     '—'
      })[name] || 'Yeni';
    }
    const btnEl = _$('harcirah-add-btn');
    if (btnEl) btnEl.style.display = (name === 'arsiv') ? 'none' : 'inline-flex';

    // Sekme açılırken o sekmeye özel render
    if (name === 'haftalik') harcRenderHaftalik();
    if (name === 'arsiv')    harcRenderArsiv();
  }

  // "+ Yeni" butonu sekmeye göre handler
  function harcAddBtnClick() {
    if (state.activeTab === 'tarifeler') openHarcirahTarifeModal();
    else if (state.activeTab === 'kayitlar') openHarcirahKayitModal();
    else if (state.activeTab === 'haftalik') openHarcirahHaftaKapatModal(null);
  }

  // Şoför eşleştirmeyi yenile (NULL sofor_user_id'leri davet'ten doldur)
  async function harcSoforEslestir() {
    if (!confirm('Şoför davetlerini mevcut iş emirleri ve harcırah kayıtlarıyla eşleştir?\n\nBu işlem güvenli — yalnızca eksik bağlantılar doldurulur.')) return;
    try {
      const res = await window.HarcirahAPI.soforMatchYenile();
      const ie = res?.isemri_guncellenen || 0;
      const hk = res?.harcirah_guncellenen || 0;
      if (typeof toast === 'function') {
        if (ie === 0 && hk === 0) {
          toast('Eşleştirilecek kayıt yok — tüm bağlantılar zaten kurulu', 'info');
        } else {
          toast(`✓ ${ie} iş emri · ${hk} harcırah kaydı eşleştirildi`, 'success');
        }
      }
      await refreshAll();
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Eşleştirme hatası: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  // Refresh
  // ════════════════════════════════════════════════════════
  async function refreshAll() {
    if (!window.HarcirahAPI) {
      console.warn('[harcirah-page] HarcirahAPI yüklü değil');
      return;
    }
    const safe = async (fn, fallback) => {
      try { return await fn(); }
      catch (err) { console.warn('[harcirah-page]', err.message || err); return fallback; }
    };
    const [tarifeler, ekHizmetler, kayitlar] = await Promise.all([
      safe(() => window.HarcirahAPI.tarifeList(),   []),
      safe(() => window.HarcirahAPI.ekHizmetList(), []),
      safe(() => window.HarcirahAPI.kayitList({}),  [])
    ]);
    state.tarifeler   = tarifeler || [];
    state.ekHizmetler = ekHizmetler || [];
    state.kayitlar    = kayitlar || [];
    state.loaded = true;
    _updateCounts();
    _updateMigrationBanner();
    harcRenderTarifeler();
    harcRenderEkHizmetler();
    harcRenderKayitlar();
    // Bekleme ayarları (Migration 2026_05_06r) — sessiz yükle, hata olursa toast
    if (typeof window.HarcirahAPI.beklemeAyarlariGetir === 'function') {
      try { await harcBeklemeAyarlariYukle(); } catch (e) { console.warn('[bekleme] yükleme:', e); }
    }
  }

  function _updateCounts() {
    const set = (id, n) => { const el = _$(id); if (el) el.textContent = n; };
    set('harc-cnt-tarifeler', state.tarifeler.length);
    set('harc-cnt-kayitlar',  state.kayitlar.length);
    const sum = _$('harcirah-summary');
    if (sum) {
      const aktif    = state.tarifeler.filter(t => t.aktif_mi !== false).length;
      const beklemede = state.kayitlar.filter(k => k.durum === 'beklemede').length;
      const onayli    = state.kayitlar.filter(k => k.durum === 'sofor_onay' || k.durum === 'ops_onay').length;
      sum.textContent = `${state.tarifeler.length} tarife · ${aktif} aktif · ${beklemede} bekleyen · ${onayli} onaylı`;
    }
  }

  function _updateMigrationBanner() {
    const host = _$('harcirah-migration-banner');
    if (!host) return;
    const missing = window.HarcirahAPI?.isMigrationMissing && window.HarcirahAPI.isMigrationMissing();
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
          Harcırah modülü için <code style="font-family:var(--font-mono);background:rgba(0,0,0,.15);padding:1px 5px;border-radius:3px;">2026_05_05d__harcirah_sistemi.sql</code> migration'ı henüz çalıştırılmadı.
          Tarifeler kalıcı olarak kaydedilmeyecek.
        </div>
      </div>
      <button onclick="this.parentElement.style.display='none'" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 4px;flex-shrink:0;">×</button>`;
  }

  // ════════════════════════════════════════════════════════
  // TARİFELER — render
  // ════════════════════════════════════════════════════════
  function harcRenderTarifeler() {
    const tbody = _$('harc-tarife-tbody');
    if (!tbody) return;
    const q = (_$('harc-tarife-search')?.value || '').toLowerCase();
    const aktifFilt = _$('harc-tarife-aktif')?.value || '';

    let filt = state.tarifeler.slice();
    if (aktifFilt === 'aktif') filt = filt.filter(t => t.aktif_mi !== false);
    if (aktifFilt === 'pasif') filt = filt.filter(t => t.aktif_mi === false);
    if (q) {
      filt = filt.filter(t => [t.baslik, t.alim_yeri, t.teslim_yeri, t.kont_tip, t.kont_durum, t.notlar]
        .join(' ').toLowerCase().includes(q));
    }
    _$('harc-tarife-count').textContent = filt.length + ' kayıt';

    if (!filt.length) {
      const empty = state.tarifeler.length === 0
        ? `Henüz tarife yok. <button onclick="openHarcirahTarifeModal()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;">+ İlk tarifeyi ekle</button>`
        : 'Bu filtre için kayıt yok.';
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--muted);">${empty}</td></tr>`;
      return;
    }

    tbody.innerHTML = filt.map(t => {
      const aktif = t.aktif_mi !== false;
      const tutar = Number(t.tutar || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const tipPill = t.kont_tip
        ? `<span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);padding:2px 7px;border-radius:99px;">${_esc(t.kont_tip)}</span>`
        : '<span style="color:var(--muted);font-size:10.5px;">tüm tipler</span>';
      const durumPill = t.kont_durum
        ? `<span style="font-size:10.5px;background:${t.kont_durum === 'Boş' ? 'rgba(148,163,184,.15)' : 'rgba(255,107,31,.12)'};color:${t.kont_durum === 'Boş' ? 'var(--text2)' : 'var(--accent)'};padding:2px 7px;border-radius:99px;font-weight:600;">${_esc(t.kont_durum)}</span>`
        : '<span style="color:var(--muted);font-size:10.5px;">her ikisi</span>';
      const gec = (t.gecerli_baslangic ? new Date(t.gecerli_baslangic).toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—')
                 + (t.gecerli_bitis ? ' → ' + new Date(t.gecerli_bitis).toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : ' →');
      const aktifBadge = aktif
        ? '<span style="font-size:10px;background:rgba(34,197,94,.15);color:#22c55e;padding:2px 8px;border-radius:99px;font-weight:700;">● Aktif</span>'
        : '<span style="font-size:10px;background:rgba(148,163,184,.15);color:var(--muted);padding:2px 8px;border-radius:99px;font-weight:700;">○ Pasif</span>';

      // Bölgeler: pill listesi (en fazla 5 göster, kalanı "+N daha")
      let bolgeHtml;
      if (Array.isArray(t.bolgeler) && t.bolgeler.length) {
        const visible = t.bolgeler.slice(0, 5);
        const fazla   = t.bolgeler.length - visible.length;
        bolgeHtml = `<div style="display:flex;flex-wrap:wrap;gap:3px;max-width:280px;">` +
          visible.map(b => `<span style="font-size:10.5px;background:rgba(56,189,248,.10);color:#38bdf8;padding:2px 7px;border-radius:99px;font-weight:600;border:1px solid rgba(56,189,248,.20);">${_esc(b)}</span>`).join('') +
          (fazla > 0 ? `<span style="font-size:10.5px;color:var(--muted);padding:2px 7px;font-weight:600;" title="${_esc(t.bolgeler.slice(5).join(', '))}">+${fazla} daha</span>` : '') +
        `</div>`;
      } else if (t.teslim_yeri) {
        bolgeHtml = `<span style="font-size:12px;">${_esc(t.teslim_yeri)}</span>`;
      } else {
        bolgeHtml = `<span style="color:var(--muted);font-size:10.5px;">tüm bölgeler</span>`;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700;color:var(--text);font-size:12.5px;">${_esc(t.baslik)}</div>
            ${t.notlar ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;font-style:italic;">${_esc(t.notlar)}</div>` : ''}
          </td>
          <td>${bolgeHtml}</td>
          <td>${tipPill}</td>
          <td>${durumPill}</td>
          <td><span class="mono" style="font-size:13px;font-weight:700;color:#22c55e;">${tutar} ₺</span></td>
          <td><span class="mono" style="font-size:10.5px;color:var(--muted);">${gec}</span></td>
          <td>${aktifBadge}</td>
          <td class="col-islem">
            <div style="display:flex;gap:4px;">
              <button onclick="openHarcirahTarifeEdit('${t.id}')" class="icon-btn" title="Düzenle" style="color:var(--accent);">✎</button>
              <button onclick="harcTarifeAktifToggle('${t.id}')" class="icon-btn" title="${aktif ? 'Pasifleştir' : 'Aktive et'}" style="color:${aktif ? 'var(--muted)' : '#22c55e'};">${aktif ? '⏸' : '▶'}</button>
              <button onclick="harcTarifeDelete('${t.id}')" class="icon-btn del" title="Sil">🗑</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════
  // TARİFE MODAL'I
  // ════════════════════════════════════════════════════════
  const tarifeModalState = { mode: 'create', editingId: null };

  function _resetTarifeForm() {
    ['harc-t-baslik','harc-t-tutar','harc-t-alim','harc-t-teslim','harc-t-bolgeler','harc-t-bos-donus',
     'harc-t-km','harc-t-sure','harc-t-notlar','harc-t-gec-son'].forEach(id => _setVal(id, ''));
    _setVal('harc-t-kont-tip', '');
    _setVal('harc-t-kont-durum', '');
    _setVal('harc-t-oncelik', '100');
    _setVal('harc-t-gec-bas', new Date().toISOString().slice(0, 10));
    const aktif = _$('harc-t-aktif'); if (aktif) aktif.checked = true;
    const err = _$('harc-t-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function openHarcirahTarifeModal() {
    _resetTarifeForm();
    tarifeModalState.mode = 'create';
    tarifeModalState.editingId = null;
    _$('harc-tarife-modal-title').textContent = 'Yeni Tarife';
    _$('harc-tarife-modal-bg')?.classList.remove('hidden');
    setTimeout(() => _$('harc-t-baslik')?.focus(), 50);
  }

  function openHarcirahTarifeEdit(id) {
    const t = state.tarifeler.find(x => x.id === id);
    if (!t) {
      if (typeof toast === 'function') toast('Tarife bulunamadı', 'error');
      return;
    }
    _resetTarifeForm();
    tarifeModalState.mode = 'edit';
    tarifeModalState.editingId = id;
    _$('harc-tarife-modal-title').textContent = 'Tarifeyi Düzenle';
    _setVal('harc-t-baslik',     t.baslik);
    _setVal('harc-t-tutar',      t.tutar);
    _setVal('harc-t-alim',       t.alim_yeri);
    _setVal('harc-t-teslim',     t.teslim_yeri);
    // Bölgeler array'ini virgülle birleştirip textarea'ya yaz
    _setVal('harc-t-bolgeler',   Array.isArray(t.bolgeler) ? t.bolgeler.join(', ') : '');
    _setVal('harc-t-bos-donus',  t.bos_donus_yeri);
    _setVal('harc-t-kont-tip',   t.kont_tip || '');
    _setVal('harc-t-kont-durum', t.kont_durum || '');
    _setVal('harc-t-km',         t.tahmini_km);
    _setVal('harc-t-sure',       t.tahmini_sure_dk);
    _setVal('harc-t-oncelik',    t.oncelik || 100);
    _setVal('harc-t-gec-bas',    t.gecerli_baslangic);
    _setVal('harc-t-gec-son',    t.gecerli_bitis);
    _setVal('harc-t-notlar',     t.notlar);
    const aktif = _$('harc-t-aktif'); if (aktif) aktif.checked = t.aktif_mi !== false;
    _$('harc-tarife-modal-bg')?.classList.remove('hidden');
  }

  function closeHarcirahTarifeModal() {
    _$('harc-tarife-modal-bg')?.classList.add('hidden');
  }

  function _showErr(msg) {
    const el = _$('harc-t-error');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }

  // Otomatik etiket üretme: bölgeler + tutar'dan kısa bir başlık türet
  function _otoBaslikUret() {
    const bolgelerRaw = _getVal('harc-t-bolgeler');
    const tutarRaw    = _getVal('harc-t-tutar');
    const tutarNum    = parseFloat(tutarRaw);
    const tutarTxt    = isFinite(tutarNum) && tutarNum > 0
      ? ` (${tutarNum.toLocaleString('tr-TR')} ₺)`
      : '';
    const bolgeler = bolgelerRaw
      ? bolgelerRaw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
      : [];
    if (bolgeler.length === 0) {
      const alim = _getVal('harc-t-alim');
      if (alim && tutarTxt) return `${alim} → Genel${tutarTxt}`;
      if (tutarTxt) return `Genel Tarife${tutarTxt}`;
      return '';
    }
    if (bolgeler.length === 1) return `${bolgeler[0]}${tutarTxt}`;
    if (bolgeler.length === 2) return `${bolgeler[0]}-${bolgeler[1]}${tutarTxt}`;
    return `${bolgeler[0]}-${bolgeler[1]} +${bolgeler.length - 2}${tutarTxt}`;
  }

  // Bölge/tutar yazılırken başlık BOŞSA placeholder'ı dinamik göster (otomatik öneri)
  function harcOtoBaslik() {
    const inp = _$('harc-t-baslik');
    if (!inp) return;
    const oneri = _otoBaslikUret();
    // Kullanıcı bir şey yazmadıysa placeholder olarak göster
    inp.placeholder = oneri || 'Bölge listesinden otomatik üretilecek…';
  }

  // "Otomatik Üret" butonu: tahmini başlığı doğrudan input'a yaz
  function harcOtoBaslikUret() {
    const inp = _$('harc-t-baslik');
    if (!inp) return;
    const oneri = _otoBaslikUret();
    if (!oneri) {
      if (typeof toast === 'function') toast('Önce tutar ve bölge gir', 'warn');
      else alert('Önce tutar ve bölge gir.');
      return;
    }
    inp.value = oneri;
    inp.focus();
  }

  async function harcTarifeSubmit() {
    _showErr('');
    let baslik   = _getVal('harc-t-baslik');
    const tutar  = _getVal('harc-t-tutar');
    if (!tutar || isNaN(Number(tutar))) { _showErr('Geçerli bir tutar girin.'); _$('harc-t-tutar')?.focus(); return; }
    // Başlık boşsa otomatik üret
    if (!baslik) {
      baslik = _otoBaslikUret() || 'Genel Tarife';
    }

    const bolgelerRaw = _getVal('harc-t-bolgeler');
    const bolgelerArr = bolgelerRaw
      ? bolgelerRaw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
      : null;
    if (!bolgelerArr || !bolgelerArr.length) {
      // Bölge boşsa, eski tek-teslim alanı varsa onu kullan; yoksa uyarı (zorunlu yapmadık ama tipik kullanım için bilgi ver)
      // Yine de devam etmesine izin ver — boş bırakanlar tüm rotalar için varsayılan olabilir
    }

    const payload = {
      baslik,
      tutar:           Number(tutar),
      alim_yeri:       _getVal('harc-t-alim') || null,
      teslim_yeri:     _getVal('harc-t-teslim') || null,
      bolgeler:        bolgelerArr,
      bos_donus_yeri:  _getVal('harc-t-bos-donus') || null,
      kont_tip:        _getVal('harc-t-kont-tip') || null,
      kont_durum:      _getVal('harc-t-kont-durum') || null,
      tahmini_km:      _getVal('harc-t-km') || null,
      tahmini_sure_dk: _getVal('harc-t-sure') || null,
      oncelik:         _getVal('harc-t-oncelik') || 100,
      gecerli_baslangic: _getVal('harc-t-gec-bas') || null,
      gecerli_bitis:     _getVal('harc-t-gec-son') || null,
      aktif_mi:        !!_$('harc-t-aktif')?.checked,
      notlar:          _getVal('harc-t-notlar') || null
    };

    const btn = _$('harc-t-submit-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      if (tarifeModalState.mode === 'edit') {
        await window.HarcirahAPI.tarifeUpdate(tarifeModalState.editingId, payload);
        if (typeof toast === 'function') toast('Tarife güncellendi', 'success');
      } else {
        await window.HarcirahAPI.tarifeCreate(payload);
        if (typeof toast === 'function') toast('Tarife eklendi', 'success');
      }
      closeHarcirahTarifeModal();
      await refreshAll();
    } catch (err) {
      console.error(err);
      _showErr('Kaydedilemedi: ' + (err.message || 'bilinmeyen hata'));
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  async function harcTarifeAktifToggle(id) {
    const t = state.tarifeler.find(x => x.id === id);
    if (!t) return;
    try {
      await window.HarcirahAPI.tarifeUpdate(id, { aktif_mi: !(t.aktif_mi !== false) });
      if (typeof toast === 'function') toast(t.aktif_mi !== false ? 'Pasifleştirildi' : 'Aktive edildi', 'success');
      await refreshAll();
    } catch (err) {
      if (typeof toast === 'function') toast('İşlem başarısız: ' + err.message, 'error');
    }
  }

  async function harcTarifeDelete(id) {
    const t = state.tarifeler.find(x => x.id === id);
    if (!confirm(`"${t?.baslik || id}" tarifesi silinsin mi?\n\nBu tarifeyle eşleşmiş eski harcırah kayıtları etkilenmez (tarife referansı NULL'a düşer).`)) return;
    try {
      await window.HarcirahAPI.tarifeDelete(id);
      if (typeof toast === 'function') toast('Silindi', 'success');
      await refreshAll();
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Silinemedi: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  // KAYITLAR — render + filtre + arama + KPI
  // ════════════════════════════════════════════════════════
  function _kayitKategori(k) {
    if (k.durum === 'iptal') return 'iptal';
    if (k.durum === 'odendi') return 'odendi';
    if (k.durum === 'sofor_itiraz') return 'itiraz';
    if (k.durum === 'sofor_onay' || k.durum === 'ops_onay') return 'onayli';
    return 'beklemede';
  }
  // Aktif = beklemede + sofor_onay + sofor_itiraz + ops_onay (ödenmemiş + iptal değil)
  function _kayitAktifMi(k) {
    return k.durum !== 'odendi' && k.durum !== 'iptal';
  }

  function harcKayitFilterSet(name, btn) {
    state.kayitFilter = name;
    document.querySelectorAll('.harc-kayit-filter').forEach(b => {
      const active = b.dataset.filter === name;
      b.classList.toggle('is-active', active);
      b.style.background = active ? 'var(--accent)' : 'transparent';
      b.style.color      = active ? '#fff' : 'var(--text2)';
    });
    harcRenderKayitlar();
  }

  function harcKayitArama(q) {
    state.kayitArama = (q || '').toLowerCase().trim();
    harcRenderKayitlar();
  }

  // Tutar formatı (1234.5 → "1.234,50 ₺" — TR locale)
  function _fmtTutar(n) {
    const v = Number(n || 0);
    if (v === 0) return '0,00';
    const isWhole = v % 1 === 0;
    if (isWhole) return v.toLocaleString('tr-TR') + ',00';
    return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function harcRenderKayitlar() {
    // KPI rozetleri
    _renderKayitKpi();

    const tbody = _$('harc-kayit-tbody');
    if (!tbody) return;

    // Sayım rozetleri (filtreden bağımsız, toplam üzerinden)
    const sayim = { aktif: 0, beklemede: 0, onayli: 0, itiraz: 0, odendi: 0, tumu: state.kayitlar.length };
    state.kayitlar.forEach(k => {
      sayim[_kayitKategori(k)]++;
      if (_kayitAktifMi(k)) sayim.aktif++;
    });
    Object.keys(sayim).forEach(key => {
      const el = _$('harc-kayit-flt-' + key);
      if (el) el.textContent = sayim[key] ? '· ' + sayim[key] : '';
    });

    // Filtre uygula
    let filt = state.kayitlar.slice();
    if (state.kayitFilter === 'aktif')      filt = filt.filter(_kayitAktifMi);
    else if (state.kayitFilter !== 'tumu')  filt = filt.filter(k => _kayitKategori(k) === state.kayitFilter);

    // Arama
    if (state.kayitArama) {
      const q = state.kayitArama;
      filt = filt.filter(k => [k.sofor_ad, k.arac_plaka, k.aciklama, k.ek_masraf_aciklama, k.is_emri_id]
        .join(' ').toLowerCase().includes(q));
    }
    // Tarihe göre yeniden sırala (en yeni üstte)
    filt.sort((a, b) => (b.is_tarihi || '').localeCompare(a.is_tarihi || ''));

    _$('harc-kayit-count').textContent = filt.length + ' kayıt';

    if (!filt.length) {
      const empty = state.kayitlar.length === 0
        ? `Henüz kayıt yok. İş emri açıldığında tarife eşleşmesi varsa otomatik üretilir.<br><button onclick="openHarcirahKayitModal()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;margin-top:6px;">+ Manuel kayıt ekle</button>`
        : 'Bu filtre için kayıt yok.';
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:36px;color:var(--muted);font-size:12px;line-height:1.6;">${empty}</td></tr>`;
      return;
    }

    tbody.innerHTML = filt.map(k => _kayitRowHtml(k)).join('');
  }

  function _renderKayitKpi() {
    const host = _$('harc-kayit-kpi');
    if (!host) return;
    const beklemede = state.kayitlar.filter(k => k.durum === 'beklemede');
    const onayli    = state.kayitlar.filter(k => k.durum === 'sofor_onay' || k.durum === 'ops_onay');
    const odendi    = state.kayitlar.filter(k => k.durum === 'odendi');

    // Bu hafta toplam (ödenmiş + onaylı + bekleyen — iptal hariç)
    const cur = window.HarcirahAPI?.suandakiHafta ? window.HarcirahAPI.suandakiHafta() : null;
    const buHaftaKayitlar = cur
      ? state.kayitlar.filter(k => k.hafta_no === cur.hafta_no && k.hafta_yili === cur.hafta_yili && k.durum !== 'iptal')
      : [];
    const buHaftaToplam = buHaftaKayitlar.reduce((s, k) => s + Number(k.net_tutar || 0), 0);

    const kart = (lbl, val, sub, color) => `
      <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${color};border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:2px;min-width:140px;flex:0 0 auto;">
        <div style="font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);">${lbl}</div>
        <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:${color};line-height:1.1;">${val}</div>
        ${sub ? `<div style="font-size:10.5px;color:var(--text2);">${sub}</div>` : ''}
      </div>`;

    host.innerHTML = [
      kart('Toplam Kayıt',    state.kayitlar.length,                 'tüm zamanlar',       'var(--accent)'),
      kart('Beklemede',       beklemede.length,                      'şoför onayı bekliyor', '#f59e0b'),
      kart('Onaylı',          onayli.length,                         'ödeme bekliyor',      '#22c55e'),
      kart('Bu Hafta Toplam', _fmtTutar(buHaftaToplam) + ' ₺',       (cur ? `${cur.hafta_yili}/Hafta-${cur.hafta_no}` : ''), '#0284c7'),
      kart('Ödendi',          odendi.length,                         'tamamlandı',          'var(--blue)')
    ].join('');
  }

  function _kayitRowHtml(k) {
    const meta = HARC_DURUM_META[k.durum] || HARC_DURUM_META.beklemede;
    const tarihTxt = k.is_tarihi
      ? new Date(k.is_tarihi).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '—';

    const tutarBase = Number(k.manuel_tutar ?? k.hesaplanan_tutar ?? 0);
    const ekTutar   = Number(k.ek_masraflar || 0);
    const avans     = Number(k.avans_dusum  || 0);
    const net       = Number(k.net_tutar || (tutarBase + ekTutar - avans));

    // Tarife / manuel ayrımı
    const tarifeStr = k.hesaplanan_tutar != null ? _fmtTutar(k.hesaplanan_tutar) : '—';
    const manuelStr = k.manuel_tutar != null
      ? `<span style="color:#0284c7;font-weight:700;">${_fmtTutar(k.manuel_tutar)}</span>`
      : '<span style="color:var(--muted);">—</span>';

    // Müşteri / Rota — şu an is_emri_id'yi gösteriyoruz (ileride join'le doldurulabilir)
    const rotaStr = `<div style="font-size:11px;color:var(--text2);">İş emri <span class="mono" style="color:var(--accent);font-weight:700;">#${k.is_emri_id ?? '?'}</span></div>`;

    // Aksiyon butonları — duruma göre değişir
    let aksiyonlar = '';
    if (k.durum === 'beklemede' || k.durum === 'sofor_onay') {
      aksiyonlar += `<button onclick="harcKayitOpsOnay('${k.id}')" class="icon-btn" title="Operasyon onayla" style="color:#22c55e;">✓</button>`;
    }
    if (k.durum === 'ops_onay') {
      aksiyonlar += `<button onclick="harcKayitOdendi('${k.id}')" class="icon-btn" title="Ödendi işaretle" style="color:#0284c7;">💵</button>`;
    }
    if (k.durum !== 'odendi' && k.durum !== 'iptal') {
      aksiyonlar += `<button onclick="harcKayitIptal('${k.id}')" class="icon-btn" title="İptal et" style="color:#f59e0b;">✕</button>`;
    }
    aksiyonlar += `<button onclick="openHarcirahKayitModal('${k.id}')" class="icon-btn" title="Düzenle" style="color:var(--accent);">✎</button>`;
    aksiyonlar += `<button onclick="harcKayitDelete('${k.id}')" class="icon-btn del" title="Kalıcı sil">🗑</button>`;

    return `
      <tr>
        <td><span class="mono" style="font-size:11.5px;">${tarihTxt}</span></td>
        <td>
          <div style="font-size:12.5px;font-weight:600;color:var(--text);">${_esc(k.sofor_ad || '—')}</div>
          ${k.arac_plaka ? `<div class="mono" style="font-size:11px;color:var(--accent);font-weight:700;margin-top:1px;">${_esc(k.arac_plaka)}</div>` : ''}
        </td>
        <td>${rotaStr}</td>
        <td><span class="mono" style="font-size:11.5px;color:var(--text2);">${tarifeStr}</span></td>
        <td><span class="mono" style="font-size:11.5px;">${manuelStr}</span></td>
        <td>${ekTutar > 0 ? `<span class="mono" style="font-size:11px;color:#f59e0b;font-weight:600;">+${_fmtTutar(ekTutar)}</span>` : '<span style="color:var(--muted);font-size:11px;">—</span>'}</td>
        <td>${avans > 0 ? `<span class="mono" style="font-size:11px;color:#0284c7;font-weight:600;">−${_fmtTutar(avans)}</span>` : '<span style="color:var(--muted);font-size:11px;">—</span>'}</td>
        <td><span class="mono" style="font-size:13px;font-weight:700;color:#22c55e;">${_fmtTutar(net)} ₺</span></td>
        <td><span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;background:${meta.bg};color:${meta.color};border:1px solid ${meta.border};padding:2px 8px;border-radius:99px;">${meta.icon} ${meta.label}</span></td>
        <td><span class="mono" style="font-size:10.5px;color:var(--muted);">${k.hafta_yili ? k.hafta_yili + '/' + k.hafta_no : '—'}</span></td>
        <td class="col-islem"><div style="display:flex;gap:3px;flex-wrap:wrap;">${aksiyonlar}</div></td>
      </tr>`;
  }

  // ── Inline aksiyonlar ─────────────────────────────
  async function harcKayitOpsOnay(id) {
    if (!confirm('Bu kayıt operasyon tarafından onaylansın mı?')) return;
    try {
      await window.HarcirahAPI.kayitOpsOnay(id);
      if (typeof toast === 'function') toast('Onaylandı', 'success');
      await refreshAll();
    } catch (err) {
      if (typeof toast === 'function') toast('Onaylanamadı: ' + err.message, 'error');
    }
  }
  async function harcKayitOdendi(id) {
    const yontem = prompt('Ödeme yöntemi: (Nakit / EFT / Çek / Mahsup)', 'EFT');
    if (yontem == null) return;
    const ref = prompt('Ödeme referans no (opsiyonel):', '') || null;
    try {
      await window.HarcirahAPI.kayitOdendi(id, { yontem: yontem.trim() || 'EFT', referans: ref });
      if (typeof toast === 'function') toast('Ödeme kaydedildi', 'success');
      await refreshAll();
    } catch (err) {
      if (typeof toast === 'function') toast('Kaydedilemedi: ' + err.message, 'error');
    }
  }
  async function harcKayitIptal(id) {
    if (!confirm('Bu harcırah kaydı iptal edilsin mi?\n\n(Kayıt silinmez, durum İptal olur — geçmiş için arşivlenir.)')) return;
    try {
      await window.HarcirahAPI.kayitUpdate(id, { durum: 'iptal' });
      if (typeof toast === 'function') toast('İptal edildi', 'success');
      await refreshAll();
    } catch (err) {
      if (typeof toast === 'function') toast('İptal edilemedi: ' + err.message, 'error');
    }
  }
  async function harcKayitDelete(id) {
    if (!confirm('Bu kayıt KALICI silinsin mi?\n\nİptal etmek yerine silmek geçmiş kaydı yok eder. Devam edilsin mi?')) return;
    try {
      await window.HarcirahAPI.kayitDelete(id);
      if (typeof toast === 'function') toast('Silindi', 'success');
      await refreshAll();
    } catch (err) {
      if (typeof toast === 'function') toast('Silinemedi: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  // MANUEL KAYIT MODALI
  // ════════════════════════════════════════════════════════
  const kayitModalState = { mode: 'create', editingId: null };
  let _harcKayitIsEmriCache = null;
  let _harcKayitSeciliIsEmri = null;

  // İş emirleri operasyon modülünden geliyor (window.isEmirleri); modal açılırken alınır.
  function _loadIsEmirleriCache() {
    try {
      _harcKayitIsEmriCache = (typeof isEmirleri !== 'undefined' && Array.isArray(isEmirleri))
        ? isEmirleri.filter(e => e && e.durum !== 'İptal')
        : [];
    } catch (_) { _harcKayitIsEmriCache = []; }
  }

  function harcKayitIsEmriAra(q) {
    if (_harcKayitIsEmriCache == null) _loadIsEmirleriCache();
    const dd = _$('harc-k-isemri-dropdown');
    if (!dd) return;
    const query = (q || '').toLowerCase().trim();
    const list = (_harcKayitIsEmriCache || []).filter(e => {
      if (!query) return true;
      const blob = [e.id, e.arac_plaka, e.musteri_adi, e.sofor, e.yukle_yeri, e.teslim_yeri, e.konteyner_no]
        .join(' ').toLowerCase();
      return blob.includes(query);
    });
    if (!list.length) {
      dd.style.display = 'none';
      return;
    }
    dd.style.display = 'block';
    dd.innerHTML = list.slice(0, 30).map(e => `
      <div onclick="harcKayitIsEmriSec(${e.id})"
           style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);"
           onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
        <span class="mono" style="font-size:11px;background:rgba(255,107,31,.12);color:var(--accent);padding:2px 7px;border-radius:99px;font-weight:700;">#${e.id}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12.5px;font-weight:700;color:var(--text);">${_esc(e.musteri_adi || '—')}</div>
          <div style="font-size:10.5px;color:var(--muted);">
            ${_esc(e.arac_plaka || '')}${e.sofor ? ' · ' + _esc(e.sofor) : ''}${e.yukle_yeri ? ' · ' + _esc(e.yukle_yeri) + ' → ' + _esc(e.teslim_yeri || '?') : ''}
          </div>
        </div>
      </div>`).join('');
  }

  function harcKayitIsEmriSec(id) {
    const e = (_harcKayitIsEmriCache || []).find(x => x.id === id || x.id === Number(id));
    if (!e) return;
    _harcKayitSeciliIsEmri = e;
    _setVal('harc-k-isemri-id', String(e.id));
    _setVal('harc-k-isemri-search', `#${e.id} · ${e.musteri_adi || ''}${e.arac_plaka ? ' · ' + e.arac_plaka : ''}`);
    // Şoför + plaka + tarih otomatik doldur (boşsa)
    if (!_getVal('harc-k-sofor') && e.sofor) _setVal('harc-k-sofor', e.sofor);
    if (!_getVal('harc-k-plaka') && e.arac_plaka) _setVal('harc-k-plaka', e.arac_plaka);
    if (!_getVal('harc-k-tarih') && e.atama_zamani) {
      _setVal('harc-k-tarih', String(e.atama_zamani).slice(0, 10));
    }
    // Seçili kart — özet bilgi
    const sec = _$('harc-k-isemri-secili');
    if (sec) {
      sec.style.display = 'block';
      sec.innerHTML = `<b style="color:var(--text);">📦 ${_esc(e.konteyner_no || '—').split('\\n')[0]}</b> · ${_esc(e.kont_tip || '')} · ${_esc(e.yukle_yeri || '?')} → ${_esc(e.teslim_yeri || '?')}`;
    }
    const dd = _$('harc-k-isemri-dropdown'); if (dd) dd.style.display = 'none';

    // Tarife match dene
    _harcKayitTarifeOner();
    _harcKayitNetGuncelle();
  }

  // İş emri seçilince tarife match ile öneri tutarı
  async function _harcKayitTarifeOner() {
    const e = _harcKayitSeciliIsEmri;
    if (!e || !window.HarcirahAPI) return;
    if (_getVal('harc-k-tutar')) return; // kullanıcı zaten yazdıysa dokunma
    try {
      const m = await window.HarcirahAPI.tarifeMatch({
        alim_yeri: e.yukle_yeri,
        teslim_yeri: e.teslim_yeri,
        kont_tip: e.kont_tip,
        kont_durum: e.kont_durum
      });
      if (m && m.tutar) {
        _setVal('harc-k-tutar', m.tutar);
        _harcKayitNetGuncelle();
        if (typeof toast === 'function') toast(`Tarife eşleşti: ${m.baslik || m.tutar + '₺'}`, 'info');
      }
    } catch (_) {}
  }

  // Net tutar canlı hesaplama
  function _harcKayitNetGuncelle() {
    const tutar = parseFloat(_getVal('harc-k-tutar'))  || 0;
    const ek    = parseFloat(_getVal('harc-k-ek'))     || 0;
    const avans = parseFloat(_getVal('harc-k-avans'))  || 0;
    const net = tutar + ek - avans;
    const el = _$('harc-k-net-deger');
    if (el) el.textContent = _fmtTutar(net) + ' ₺';
  }

  function _resetKayitForm() {
    ['harc-k-isemri-search','harc-k-isemri-id','harc-k-sofor','harc-k-plaka',
     'harc-k-tutar','harc-k-ek','harc-k-avans','harc-k-ek-aciklama','harc-k-aciklama'].forEach(id => _setVal(id, ''));
    _setVal('harc-k-tarih', new Date().toISOString().slice(0, 10));
    const sec = _$('harc-k-isemri-secili'); if (sec) { sec.style.display = 'none'; sec.innerHTML = ''; }
    const err = _$('harc-k-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
    _harcKayitSeciliIsEmri = null;
    _harcKayitNetGuncelle();
  }

  function openHarcirahKayitModal(kayitId) {
    _loadIsEmirleriCache();
    _resetKayitForm();
    if (kayitId) {
      const k = state.kayitlar.find(x => x.id === kayitId);
      if (!k) { if (typeof toast === 'function') toast('Kayıt bulunamadı', 'error'); return; }
      kayitModalState.mode = 'edit';
      kayitModalState.editingId = kayitId;
      _$('harc-kayit-modal-title').textContent = 'Harcırah Kaydını Düzenle';
      _setVal('harc-k-isemri-id',     String(k.is_emri_id || ''));
      _setVal('harc-k-isemri-search', `#${k.is_emri_id} · ${k.sofor_ad || ''}`);
      _setVal('harc-k-sofor',         k.sofor_ad);
      _setVal('harc-k-plaka',         k.arac_plaka);
      _setVal('harc-k-tarih',         k.is_tarihi);
      _setVal('harc-k-tutar',         k.manuel_tutar ?? k.hesaplanan_tutar ?? '');
      _setVal('harc-k-ek',            k.ek_masraflar || '');
      _setVal('harc-k-avans',         k.avans_dusum  || '');
      _setVal('harc-k-ek-aciklama',   k.ek_masraf_aciklama);
      _setVal('harc-k-aciklama',      k.aciklama);
      _harcKayitNetGuncelle();
    } else {
      kayitModalState.mode = 'create';
      kayitModalState.editingId = null;
      _$('harc-kayit-modal-title').textContent = 'Manuel Harcırah Kaydı';
    }
    // Net canlı güncellensin diye listener ekle (her açılışta — duplicate önle)
    ['harc-k-tutar','harc-k-ek','harc-k-avans'].forEach(id => {
      const el = _$(id);
      if (el && !el.dataset.harcListener) {
        el.dataset.harcListener = '1';
        el.addEventListener('input', _harcKayitNetGuncelle);
      }
    });
    _$('harc-kayit-modal-bg')?.classList.remove('hidden');
    setTimeout(() => _$('harc-k-isemri-search')?.focus(), 50);
  }

  function closeHarcirahKayitModal() {
    _$('harc-kayit-modal-bg')?.classList.add('hidden');
  }

  function _kayitShowErr(msg) {
    const el = _$('harc-k-error');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }

  async function harcKayitSubmit() {
    _kayitShowErr('');
    const isEmriId = _getVal('harc-k-isemri-id');
    const tarih    = _getVal('harc-k-tarih');
    const tutarStr = _getVal('harc-k-tutar');
    if (!isEmriId) { _kayitShowErr('İş emri seçin.'); _$('harc-k-isemri-search')?.focus(); return; }
    if (!tarih)    { _kayitShowErr('Tarih girin.'); return; }
    if (!tutarStr || isNaN(Number(tutarStr))) { _kayitShowErr('Geçerli tutar girin.'); _$('harc-k-tutar')?.focus(); return; }

    const payload = {
      is_emri_id:        parseInt(isEmriId, 10),
      sofor_ad:          _getVal('harc-k-sofor') || null,
      arac_plaka:        _getVal('harc-k-plaka') || null,
      manuel_tutar:      Number(tutarStr),
      hesaplanan_tutar:  null,
      ek_masraflar:      _getVal('harc-k-ek')    ? Number(_getVal('harc-k-ek'))    : 0,
      ek_masraf_aciklama: _getVal('harc-k-ek-aciklama') || null,
      avans_dusum:       _getVal('harc-k-avans') ? Number(_getVal('harc-k-avans')) : 0,
      is_tarihi:         tarih,
      aciklama:          _getVal('harc-k-aciklama') || null,
      durum:             'beklemede'
    };

    const btn = _$('harc-k-submit-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      if (kayitModalState.mode === 'edit') {
        await window.HarcirahAPI.kayitUpdate(kayitModalState.editingId, payload);
        if (typeof toast === 'function') toast('Kayıt güncellendi', 'success');
      } else {
        await window.HarcirahAPI.kayitCreate(payload);
        if (typeof toast === 'function') toast('Manuel kayıt eklendi', 'success');
      }
      closeHarcirahKayitModal();
      await refreshAll();
      // Kayıtlar sekmesine geç
      if (state.activeTab !== 'kayitlar') switchHarcirahTab('kayitlar');
    } catch (err) {
      console.error(err);
      _kayitShowErr('Kaydedilemedi: ' + (err.message || 'bilinmeyen hata'));
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  // ════════════════════════════════════════════════════════
  // EK HİZMETLER — render & CRUD
  // ════════════════════════════════════════════════════════
  function harcRenderEkHizmetler() {
    const host = _$('harc-ek-hiz-list');
    if (!host) return;
    const list = state.ekHizmetler || [];
    if (!list.length) {
      host.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px 12px;font-size:11.5px;">
        Henüz ek hizmet tanımlı değil. <button onclick="harcEkHizmetSeed()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;margin-left:4px;">⭐ Hazır şablonu yükle</button>
        veya <button onclick="openHarcirahEkHizmetModal()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-weight:700;">+ Yeni ek hizmet</button>
      </div>`;
      return;
    }
    const TYPE_LABEL = {
      sabit: 'Sabit', saatlik: 'Saatlik', yarim_tarife: 'Yarı Tarife', yuzde: 'Yüzde'
    };
    host.innerHTML = list.map(h => {
      const aktif = h.aktif_mi !== false;
      const tutarStr = h.hesaplama_tipi === 'yarim_tarife'
        ? '<span style="color:#0284c7;font-weight:700;">Yarı tutar</span>'
        : `<span class="mono" style="font-weight:700;color:#22c55e;">${Number(h.tutar || 0).toLocaleString('tr-TR')} ₺</span>`;
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-sunk);border:1px solid var(--border);border-radius:8px;${!aktif ? 'opacity:.55;' : ''}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:700;color:var(--text);font-size:12.5px;">${_esc(h.ad)}</span>
              <span style="font-family:var(--font-mono);font-size:10px;background:var(--surface3);color:var(--text2);padding:1px 6px;border-radius:4px;">${_esc(h.kod)}</span>
              <span style="font-size:10px;background:rgba(56,189,248,.10);color:#38bdf8;padding:1px 6px;border-radius:4px;font-weight:600;">${TYPE_LABEL[h.hesaplama_tipi] || h.hesaplama_tipi}</span>
              ${!aktif ? '<span style="font-size:10px;background:rgba(148,163,184,.15);color:var(--muted);padding:1px 6px;border-radius:4px;font-weight:600;">PASİF</span>' : ''}
            </div>
            ${h.aciklama ? `<div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${_esc(h.aciklama)}</div>` : ''}
          </div>
          <div style="font-size:13px;">${tutarStr}</div>
          <div style="display:flex;gap:4px;">
            <button onclick="openHarcirahEkHizmetEdit('${h.id}')" class="icon-btn" title="Düzenle" style="color:var(--accent);">✎</button>
            <button onclick="harcEkHizmetDelete('${h.id}')" class="icon-btn del" title="Sil">🗑</button>
          </div>
        </div>`;
    }).join('');
  }

  // Modal-içi state
  const ekHizModalState = { mode: 'create', editingId: null };

  function _resetEkHizForm() {
    ['harc-eh-ad','harc-eh-tutar','harc-eh-kod','harc-eh-aciklama'].forEach(id => _setVal(id, ''));
    _setVal('harc-eh-htipi', 'sabit');
    _setVal('harc-eh-sira',  '100');
    const aktif = _$('harc-eh-aktif'); if (aktif) aktif.checked = true;
    const err = _$('harc-eh-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function openHarcirahEkHizmetModal() {
    _resetEkHizForm();
    ekHizModalState.mode = 'create';
    ekHizModalState.editingId = null;
    _$('harc-ekhiz-modal-title').textContent = 'Yeni Ek Hizmet';
    _$('harc-ekhiz-modal-bg')?.classList.remove('hidden');
    setTimeout(() => _$('harc-eh-ad')?.focus(), 50);
  }

  function openHarcirahEkHizmetEdit(id) {
    const h = state.ekHizmetler.find(x => x.id === id);
    if (!h) {
      if (typeof toast === 'function') toast('Ek hizmet bulunamadı', 'error');
      return;
    }
    _resetEkHizForm();
    ekHizModalState.mode = 'edit';
    ekHizModalState.editingId = id;
    _$('harc-ekhiz-modal-title').textContent = 'Ek Hizmeti Düzenle';
    _setVal('harc-eh-ad',       h.ad);
    _setVal('harc-eh-tutar',    h.tutar);
    _setVal('harc-eh-kod',      h.kod);
    _setVal('harc-eh-htipi',    h.hesaplama_tipi || 'sabit');
    _setVal('harc-eh-aciklama', h.aciklama);
    _setVal('harc-eh-sira',     h.sira || 100);
    const aktif = _$('harc-eh-aktif'); if (aktif) aktif.checked = h.aktif_mi !== false;
    _$('harc-ekhiz-modal-bg')?.classList.remove('hidden');
  }

  function closeHarcirahEkHizmetModal() {
    _$('harc-ekhiz-modal-bg')?.classList.add('hidden');
  }

  function _ekHizShowErr(msg) {
    const el = _$('harc-eh-error');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }

  async function harcEkHizmetSubmit() {
    _ekHizShowErr('');
    const ad    = _getVal('harc-eh-ad');
    const tutar = _getVal('harc-eh-tutar');
    let kod     = _getVal('harc-eh-kod');
    if (!ad)    { _ekHizShowErr('Hizmet adı zorunlu.'); return; }
    if (!tutar || isNaN(Number(tutar))) { _ekHizShowErr('Geçerli tutar girin.'); return; }
    if (!kod) {
      // Adı kod'a çevir (ascii lowercase + tire)
      kod = ad.toLowerCase()
        .replace(/[ıİ]/g,'i').replace(/[şŞ]/g,'s').replace(/[ğĞ]/g,'g')
        .replace(/[üÜ]/g,'u').replace(/[öÖ]/g,'o').replace(/[çÇ]/g,'c')
        .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0, 30);
    }
    const payload = {
      ad, kod, tutar: Number(tutar),
      hesaplama_tipi: _getVal('harc-eh-htipi') || 'sabit',
      aciklama:       _getVal('harc-eh-aciklama') || null,
      sira:           parseInt(_getVal('harc-eh-sira') || '100', 10),
      aktif_mi:       !!_$('harc-eh-aktif')?.checked
    };
    const btn = _$('harc-eh-submit-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      if (ekHizModalState.mode === 'edit') {
        await window.HarcirahAPI.ekHizmetUpdate(ekHizModalState.editingId, payload);
        if (typeof toast === 'function') toast('Ek hizmet güncellendi', 'success');
      } else {
        await window.HarcirahAPI.ekHizmetCreate(payload);
        if (typeof toast === 'function') toast('Ek hizmet eklendi', 'success');
      }
      closeHarcirahEkHizmetModal();
      await refreshAll();
    } catch (err) {
      console.error(err);
      _ekHizShowErr('Kaydedilemedi: ' + (err.message || 'bilinmeyen hata'));
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  async function harcEkHizmetDelete(id) {
    const h = state.ekHizmetler.find(x => x.id === id);
    if (!confirm(`"${h?.ad || id}" ek hizmeti silinsin mi?`)) return;
    try {
      await window.HarcirahAPI.ekHizmetDelete(id);
      if (typeof toast === 'function') toast('Silindi', 'success');
      await refreshAll();
    } catch (err) {
      if (typeof toast === 'function') toast('Silinemedi: ' + err.message, 'error');
    }
  }

  // Hazır şablon: 4 standart ek hizmeti tek tıkla ekle
  async function harcEkHizmetSeed() {
    if (state.ekHizmetler && state.ekHizmetler.length) {
      if (!confirm('Mevcut ek hizmetler var. Eksik olan standart kayıtlar eklensin mi? (Mevcut kayıtlar değişmez.)')) return;
    }
    try {
      await window.HarcirahAPI.ekHizmetSeed();
      if (typeof toast === 'function') toast('Standart ek hizmetler yüklendi', 'success');
      await refreshAll();
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Yüklenemedi: ' + err.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  // BEKLEME AYARLARI (Migration 2026_05_06r + 2026_05_06s)
  // ════════════════════════════════════════════════════════
  // Tarifeler sekmesinin altındaki "⏱ Fabrika Bekleme Ayarları" kartı.
  // Mevcut değerleri form'a doldur ve kullanıcı düzelttiğinde RPC ile kaydet.

  /** Form alanlarını mevcut firma ayarları + ek hizmet 'bekleme' tarifesinden doldur. */
  async function harcBeklemeAyarlariYukle() {
    const elSofor   = _$('harc-bekleme-sofor-saat');
    const elMusteri = _$('harc-bekleme-musteri-saat');
    const elTl      = _$('harc-bekleme-musteri-tl');
    const elTutarInfo = _$('harc-bekleme-sofor-tutar-info');
    if (!elSofor || !elMusteri || !elTl) return;

    try {
      const a = await window.HarcirahAPI.beklemeAyarlariGetir();
      // Eşikleri saat olarak göster (dakika → saat). Tam bölünmezse dakika kalır.
      elSofor.value   = Math.round((a.soforEsikDk || 420) / 60);
      elMusteri.value = Math.round((a.musteriEsikDk || 360) / 60);
      elTl.value      = Number(a.musteriSaatTl || 0);

      if (elTutarInfo) {
        elTutarInfo.textContent = a.soforSabitTl > 0
          ? a.soforSabitTl.toFixed(0) + ' ₺ sabit'
          : '— (Ek Hizmetler\'de "bekleme" kaydı eklenmedi)';
      }
    } catch (err) {
      console.error('[bekleme] yükleme hata:', err);
      if (typeof toast === 'function') toast('Bekleme ayarları yüklenemedi: ' + err.message, 'error');
    }
  }

  /** Form'daki değerleri RPC ile kaydet. */
  async function harcBeklemeAyarlariKaydet() {
    const elSofor   = _$('harc-bekleme-sofor-saat');
    const elMusteri = _$('harc-bekleme-musteri-saat');
    const elTl      = _$('harc-bekleme-musteri-tl');
    if (!elSofor || !elMusteri || !elTl) return;

    const soforSaat   = parseInt(elSofor.value, 10);
    const musteriSaat = parseInt(elMusteri.value, 10);
    const musteriTl   = parseFloat(elTl.value);

    if (!Number.isFinite(soforSaat) || soforSaat < 1) {
      if (typeof toast === 'function') toast('Şoför eşiği en az 1 saat olmalı', 'warning');
      return;
    }
    if (!Number.isFinite(musteriSaat) || musteriSaat < 1) {
      if (typeof toast === 'function') toast('Müşteri eşiği en az 1 saat olmalı', 'warning');
      return;
    }
    if (!Number.isFinite(musteriTl) || musteriTl < 0) {
      if (typeof toast === 'function') toast('Müşteri saatlik ücret negatif olamaz', 'warning');
      return;
    }

    try {
      await window.HarcirahAPI.beklemeAyarlariKaydet({
        soforEsikDk:   soforSaat * 60,
        musteriEsikDk: musteriSaat * 60,
        musteriSaatTl: musteriTl
      });
      if (typeof toast === 'function') toast('✓ Bekleme ayarları kaydedildi', 'success');
      // Mobile uygulamadaki şoförler bir sonraki iş emri reload'unda yeni eşiği görür.
    } catch (err) {
      console.error('[bekleme] kaydetme hata:', err);
      if (typeof toast === 'function') toast('Kayıt başarısız: ' + (err.message || err), 'error');
    }
  }

  // ESC ile modal kapat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const tBg = _$('harc-tarife-modal-bg');
      if (tBg && !tBg.classList.contains('hidden')) { closeHarcirahTarifeModal(); return; }
      const eBg = _$('harc-ekhiz-modal-bg');
      if (eBg && !eBg.classList.contains('hidden')) { closeHarcirahEkHizmetModal(); return; }
      const kBg = _$('harc-kayit-modal-bg');
      if (kBg && !kBg.classList.contains('hidden')) { closeHarcirahKayitModal(); return; }
      const hkBg = _$('harc-hafta-kapat-modal-bg');
      if (hkBg && !hkBg.classList.contains('hidden')) { closeHarcirahHaftaKapatModal(); return; }
      const hoBg = _$('harc-hafta-ode-modal-bg');
      if (hoBg && !hoBg.classList.contains('hidden')) closeHarcirahHaftaOdeModal();
    }
  });

  // ════════════════════════════════════════════════════════
  // Export
  // ════════════════════════════════════════════════════════
  window.openHarcirahPage           = openHarcirahPage;
  window.closeHarcirahPage          = closeHarcirahPage;
  window.switchHarcirahTab          = switchHarcirahTab;
  window.harcAddBtnClick            = harcAddBtnClick;
  window.harcRenderTarifeler        = harcRenderTarifeler;
  window.openHarcirahTarifeModal    = openHarcirahTarifeModal;
  window.openHarcirahTarifeEdit     = openHarcirahTarifeEdit;
  window.closeHarcirahTarifeModal   = closeHarcirahTarifeModal;
  window.harcTarifeSubmit           = harcTarifeSubmit;
  window.harcTarifeAktifToggle      = harcTarifeAktifToggle;
  window.harcTarifeDelete           = harcTarifeDelete;
  // Ek Hizmet
  window.harcRenderEkHizmetler      = harcRenderEkHizmetler;
  window.openHarcirahEkHizmetModal  = openHarcirahEkHizmetModal;
  window.openHarcirahEkHizmetEdit   = openHarcirahEkHizmetEdit;
  window.closeHarcirahEkHizmetModal = closeHarcirahEkHizmetModal;
  window.harcEkHizmetSubmit         = harcEkHizmetSubmit;
  window.harcEkHizmetDelete         = harcEkHizmetDelete;
  window.harcEkHizmetSeed           = harcEkHizmetSeed;
  window.harcOtoBaslik              = harcOtoBaslik;
  window.harcOtoBaslikUret          = harcOtoBaslikUret;
  // Bekleme ayarları (Migration 2026_05_06r + 2026_05_06s)
  window.harcBeklemeAyarlariYukle   = harcBeklemeAyarlariYukle;
  window.harcBeklemeAyarlariKaydet  = harcBeklemeAyarlariKaydet;
  // ════════════════════════════════════════════════════════
  // HAFTALIK ÖZET sekmesi
  // ════════════════════════════════════════════════════════
  let _harcHaftaSeciliYili = null;
  let _harcHaftaSeciliNo   = null;

  function _aktifHaftaSet() {
    const cur = window.HarcirahAPI?.suandakiHafta?.() || null;
    if (cur) {
      _harcHaftaSeciliYili = cur.hafta_yili;
      _harcHaftaSeciliNo   = cur.hafta_no;
    }
  }

  function harcHaftaBugun() {
    _aktifHaftaSet();
    harcRenderHaftalik();
  }

  function harcHaftaPrev() { _shiftHafta(-1); harcRenderHaftalik(); }
  function harcHaftaNext() { _shiftHafta(+1); harcRenderHaftalik(); }

  function _shiftHafta(delta) {
    if (_harcHaftaSeciliYili == null) _aktifHaftaSet();
    let no = _harcHaftaSeciliNo + delta;
    let yil = _harcHaftaSeciliYili;
    if (no < 1)  { no = 52; yil--; }
    if (no > 53) { no = 1;  yil++; }
    _harcHaftaSeciliYili = yil;
    _harcHaftaSeciliNo   = no;
  }

  async function harcRenderHaftalik() {
    if (_harcHaftaSeciliYili == null) _aktifHaftaSet();
    const yil = _harcHaftaSeciliYili;
    const no  = _harcHaftaSeciliNo;

    // Hafta başlık + tarih aralığı
    const baslik = _$('harc-hafta-baslik');
    const aralik = _$('harc-hafta-aralik');
    if (baslik) baslik.textContent = `${yil} / Hafta ${no}`;
    if (aralik && window.HarcirahAPI?.haftaTarihAraligi) {
      const r = window.HarcirahAPI.haftaTarihAraligi(yil, no);
      const fmt = d => d.toLocaleDateString('tr-TR', { day:'2-digit', month:'short' });
      aralik.textContent = `${fmt(r.baslangic)} – ${fmt(r.bitis)}`;
    }

    // O haftaya ait kayıtları filtrele (state.kayitlar üzerinden)
    const kayitlar = (state.kayitlar || []).filter(k =>
      k.hafta_yili === yil && k.hafta_no === no && k.durum !== 'iptal'
    );

    // Şoföre göre grupla
    const grup = new Map();
    kayitlar.forEach(k => {
      const key = (k.sofor_user_id || k.sofor_ad || '—');
      if (!grup.has(key)) {
        grup.set(key, {
          sofor_user_id: k.sofor_user_id,
          sofor_ad: k.sofor_ad || '—',
          arac_plaka: k.arac_plaka,
          kayit_sayisi: 0,
          brut: 0, ek: 0, avans: 0, net: 0,
          beklemede: 0, sofor_onayli: 0, ops_onayli: 0, sofor_itiraz: 0
        });
      }
      const o = grup.get(key);
      o.kayit_sayisi++;
      o.brut  += Number((k.manuel_tutar ?? k.hesaplanan_tutar ?? 0));
      o.ek    += Number(k.ek_masraflar || 0);
      o.avans += Number(k.avans_dusum || 0);
      o.net   += Number(k.net_tutar || 0);
      if (k.durum === 'beklemede')    o.beklemede++;
      if (k.durum === 'sofor_onay')   o.sofor_onayli++;
      if (k.durum === 'ops_onay')     o.ops_onayli++;
      if (k.durum === 'sofor_itiraz') o.sofor_itiraz++;
    });

    // Snapshot bilgisi (haftalik tablosundan kapatılmış haftalar)
    let haftalikSnapshots = [];
    try { haftalikSnapshots = await window.HarcirahAPI.haftalikList({ hafta_yili: yil, hafta_no: no, aktifOnly: true }); }
    catch (_) {}
    const snapByUser = new Map();
    haftalikSnapshots.forEach(h => snapByUser.set(h.sofor_user_id, h));

    // KPI banner
    const totalNet = Array.from(grup.values()).reduce((s, g) => s + g.net, 0);
    const totalKayit = kayitlar.length;
    const kpiEl = _$('harc-hafta-kpi');
    if (kpiEl) {
      kpiEl.innerHTML = totalKayit
        ? `${grup.size} şoför · ${totalKayit} sefer · <b style="color:#22c55e;">${_fmtTutar(totalNet)} ₺</b> net`
        : 'Bu hafta kayıt yok';
    }

    // Toplu kapat barı
    const tobar = _$('harc-hafta-toplu-bar');
    const tomsg = _$('harc-hafta-toplu-msg');
    const tobtn = _$('harc-hafta-toplu-btn');
    const acikSoforler = Array.from(grup.values()).filter(g => !snapByUser.has(g.sofor_user_id));
    if (tobar && tomsg && tobtn) {
      if (acikSoforler.length > 0) {
        tobar.style.display = 'flex';
        const acikNet = acikSoforler.reduce((s, g) => s + g.net, 0);
        tomsg.innerHTML = `<b>${acikSoforler.length}</b> şoförün haftası kapatılmamış · Toplam <b style="color:#22c55e;">${_fmtTutar(acikNet)} ₺</b>`;
        tobtn.disabled = false;
        tobtn.style.opacity = '';
      } else {
        tobar.style.display = grup.size > 0 ? 'flex' : 'none';
        if (grup.size > 0) {
          tomsg.innerHTML = '✓ Bu haftanın tüm şoförleri kapatılmış. Arşiv sekmesinden ödeme işaretleyebilirsiniz.';
          tobtn.disabled = true;
          tobtn.style.opacity = '.5';
        }
      }
    }

    // Tablo render
    const tbody = _$('harc-haftalik-tbody');
    if (!tbody) return;
    if (grup.size === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">
        Bu haftada henüz kayıt yok.<br><span style="font-size:11px;">İş emri açıldığında otomatik üretilir veya manuel ekleyebilirsiniz.</span>
      </td></tr>`;
      return;
    }

    const rows = Array.from(grup.values()).sort((a, b) => (a.sofor_ad || '').localeCompare(b.sofor_ad || ''));
    tbody.innerHTML = rows.map(g => {
      const snap = snapByUser.get(g.sofor_user_id);
      const durumDagilim = `
        ${g.beklemede    > 0 ? `<span title="Beklemede" style="background:rgba(245,158,11,.15);color:#f59e0b;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;margin-right:3px;">🕐 ${g.beklemede}</span>` : ''}
        ${g.sofor_onayli > 0 ? `<span title="Şoför Onayı" style="background:rgba(34,197,94,.15);color:#22c55e;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;margin-right:3px;">✓ ${g.sofor_onayli}</span>` : ''}
        ${g.ops_onayli   > 0 ? `<span title="Ofis Onayı" style="background:rgba(22,163,74,.18);color:#16a34a;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;margin-right:3px;">✓✓ ${g.ops_onayli}</span>` : ''}
        ${g.sofor_itiraz > 0 ? `<span title="İtiraz" style="background:rgba(239,68,68,.15);color:#ef4444;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;margin-right:3px;">⚠ ${g.sofor_itiraz}</span>` : ''}
      `;

      const snapBadge = snap
        ? `<span style="background:${snap.durum === 'odendi' ? 'rgba(2,132,199,.15)' : 'rgba(34,197,94,.15)'};color:${snap.durum === 'odendi' ? '#0284c7' : '#22c55e'};padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;">${snap.durum === 'odendi' ? '💵 Ödendi' : '📋 Kapalı'}</span>`
        : `<span style="color:var(--muted);font-size:10.5px;">— açık</span>`;

      let aksiyonlar;
      if (snap) {
        aksiyonlar = `
          <button onclick="harcHaftaPdfIndir('${snap.id}')" class="icon-btn" title="PDF Bordro İndir" style="color:var(--accent);">📄</button>
          ${snap.durum === 'kapali' ? `<button onclick="openHarcirahHaftaOdeModal('${snap.id}')" class="icon-btn" title="Ödendi İşaretle" style="color:#0284c7;">💵</button>` : ''}
        `;
      } else {
        aksiyonlar = `
          <button onclick="openHarcirahHaftaKapatModal('${g.sofor_user_id || ''}')" class="icon-btn" title="Bu Şoför İçin Kapat" style="color:#22c55e;">📋 Kapat</button>
        `;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700;color:var(--text);font-size:12.5px;">${_esc(g.sofor_ad)}</div>
            ${g.arac_plaka ? `<div class="mono" style="font-size:11px;color:var(--accent);font-weight:700;">${_esc(g.arac_plaka)}</div>` : ''}
          </td>
          <td><span class="mono" style="font-size:13px;font-weight:700;">${g.kayit_sayisi}</span></td>
          <td><span class="mono" style="font-size:11.5px;">${_fmtTutar(g.brut)}</span></td>
          <td>${g.ek > 0 ? `<span class="mono" style="font-size:11px;color:#f59e0b;font-weight:600;">+${_fmtTutar(g.ek)}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
          <td>${g.avans > 0 ? `<span class="mono" style="font-size:11px;color:#0284c7;font-weight:600;">−${_fmtTutar(g.avans)}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
          <td><span class="mono" style="font-size:13px;font-weight:700;color:#22c55e;">${_fmtTutar(g.net)} ₺</span></td>
          <td><div style="display:flex;flex-wrap:wrap;">${durumDagilim}</div></td>
          <td>${snapBadge}</td>
          <td class="col-islem"><div style="display:flex;gap:3px;flex-wrap:wrap;">${aksiyonlar}</div></td>
        </tr>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════
  // HAFTA KAPATMA MODAL (tek şoför veya tümü)
  // ════════════════════════════════════════════════════════
  let _harcHaftaKapatHedef = null;  // { sofor_user_id?: string|null, mod: 'tek'|'tumu' }

  function openHarcirahHaftaKapatModal(soforUserId) {
    if (_harcHaftaSeciliYili == null) _aktifHaftaSet();
    _harcHaftaKapatHedef = { sofor_user_id: soforUserId || null, mod: soforUserId ? 'tek' : 'tumu' };
    _populateKapatModal();
    _$('harc-hafta-kapat-modal-bg')?.classList.remove('hidden');
  }

  function closeHarcirahHaftaKapatModal() {
    _$('harc-hafta-kapat-modal-bg')?.classList.add('hidden');
    _setVal('harc-hafta-kapat-notlar', '');
    const err = _$('harc-hafta-kapat-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function _populateKapatModal() {
    const yil = _harcHaftaSeciliYili;
    const no  = _harcHaftaSeciliNo;
    const sub = _$('harc-hafta-kapat-sub');
    const ozet = _$('harc-hafta-kapat-onizleme');

    const kayitlar = (state.kayitlar || []).filter(k =>
      k.hafta_yili === yil && k.hafta_no === no && k.durum !== 'iptal' &&
      (_harcHaftaKapatHedef.mod === 'tumu' || k.sofor_user_id === _harcHaftaKapatHedef.sofor_user_id)
    );

    if (sub) sub.textContent = `${yil} / Hafta ${no}`;
    if (!ozet) return;

    if (!kayitlar.length) {
      ozet.innerHTML = '<span style="color:var(--red);">⚠ Kapatılacak kayıt yok.</span>';
      return;
    }

    const sofor = new Set(kayitlar.map(k => k.sofor_user_id));
    const totalNet = kayitlar.reduce((s, k) => s + Number(k.net_tutar || 0), 0);

    ozet.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span>Şoför sayısı</span><b style="color:var(--text);">${sofor.size}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span>Sefer / kayıt sayısı</span><b style="color:var(--text);">${kayitlar.length}</b>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span>Beklemede + Şoför Onayı + İtiraz dahil</span><b style="color:var(--text);">${kayitlar.length}</b>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
        <span style="font-weight:700;color:var(--text);">Toplam Net</span>
        <b class="mono" style="font-size:16px;color:#22c55e;">${_fmtTutar(totalNet)} ₺</b>
      </div>`;
  }

  async function harcHaftaKapatOnayla() {
    const err = _$('harc-hafta-kapat-error');
    const btn = _$('harc-hafta-kapat-submit');
    const notlar = _getVal('harc-hafta-kapat-notlar');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      if (_harcHaftaKapatHedef.mod === 'tumu') {
        const count = await window.HarcirahAPI.haftaKapatTumu(_harcHaftaSeciliYili, _harcHaftaSeciliNo);
        if (typeof toast === 'function') toast(`${count} şoförün haftası kapatıldı`, 'success');
      } else {
        await window.HarcirahAPI.haftaKapat(_harcHaftaKapatHedef.sofor_user_id, _harcHaftaSeciliYili, _harcHaftaSeciliNo, notlar || null);
        if (typeof toast === 'function') toast('Hafta kapatıldı', 'success');
      }
      closeHarcirahHaftaKapatModal();
      await refreshAll();
    } catch (e) {
      console.error(e);
      if (err) { err.style.display = 'block'; err.textContent = 'Hata: ' + (e.message || 'kapatılamadı'); }
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  function harcHaftaKapatTumu() { openHarcirahHaftaKapatModal(null); }

  // ════════════════════════════════════════════════════════
  // ARŞİV sekmesi
  // ════════════════════════════════════════════════════════
  let _harcArsivList = [];

  async function harcRenderArsiv() {
    try {
      _harcArsivList = await window.HarcirahAPI.haftalikList({});
    } catch (_) { _harcArsivList = []; }

    // Yıl filtresi (dropdown'u doldur)
    const yilSel = _$('harc-arsiv-yil');
    if (yilSel) {
      const cur = yilSel.value;
      const yillar = [...new Set(_harcArsivList.map(h => h.hafta_yili))].sort((a, b) => b - a);
      yilSel.innerHTML = '<option value="">Tüm Yıllar</option>' + yillar.map(y => `<option value="${y}">${y}</option>`).join('');
      if (cur) yilSel.value = cur;
    }

    const yilFlt   = _$('harc-arsiv-yil')?.value || '';
    const durumFlt = _$('harc-arsiv-durum')?.value || '';

    let filt = _harcArsivList.slice();
    if (yilFlt)   filt = filt.filter(h => String(h.hafta_yili) === yilFlt);
    if (durumFlt) filt = filt.filter(h => h.durum === durumFlt);

    _$('harc-arsiv-count').textContent = filt.length + ' kayıt';

    const tbody = _$('harc-arsiv-tbody');
    if (!tbody) return;
    if (!filt.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">
        Henüz kapanmış hafta yok.<br><span style="font-size:11px;">Haftalık Özet sekmesinden hafta kapatabilirsiniz.</span>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = filt.map(h => {
      const baslangic = h.baslangic_tarih ? new Date(h.baslangic_tarih).toLocaleDateString('tr-TR', { day:'2-digit', month:'short' }) : '—';
      const bitis     = h.bitis_tarih     ? new Date(h.bitis_tarih).toLocaleDateString('tr-TR', { day:'2-digit', month:'short' })     : '—';
      const durumPill = h.durum === 'odendi'
        ? `<span style="background:rgba(2,132,199,.15);color:#0284c7;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;">💵 Ödendi</span>`
        : h.durum === 'iptal'
        ? `<span style="background:rgba(148,163,184,.15);color:var(--muted);padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;">✕ İptal</span>`
        : `<span style="background:rgba(34,197,94,.15);color:#22c55e;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;">📋 Kapalı</span>`;

      const odemeText = h.durum === 'odendi'
        ? `<div style="font-size:11px;color:var(--text);">${_esc(h.odeme_yontemi || '—')}</div>${h.odeme_referans ? `<div style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">${_esc(h.odeme_referans)}</div>` : ''}${h.odeme_at ? `<div style="font-size:10px;color:var(--muted);">${new Date(h.odeme_at).toLocaleDateString('tr-TR')}</div>` : ''}`
        : '<span style="color:var(--muted);font-size:11px;">—</span>';

      let aksiyonlar = `<button onclick="harcHaftaPdfIndir('${h.id}')" class="icon-btn" title="PDF Bordro" style="color:var(--accent);">📄</button>`;
      if (h.durum === 'kapali') {
        aksiyonlar += `<button onclick="openHarcirahHaftaOdeModal('${h.id}')" class="icon-btn" title="Ödendi" style="color:#0284c7;">💵</button>`;
        aksiyonlar += `<button onclick="harcHaftaIptal('${h.id}')" class="icon-btn" title="Hafta kapanışını iptal et" style="color:#f59e0b;">↩</button>`;
      }

      return `
        <tr>
          <td><span class="mono" style="font-weight:700;color:var(--accent);">${h.hafta_yili}/H${h.hafta_no}</span></td>
          <td><span class="mono" style="font-size:11px;">${baslangic} – ${bitis}</span></td>
          <td><div style="font-weight:700;color:var(--text);font-size:12.5px;">${_esc(h.sofor_ad || '—')}</div></td>
          <td><span class="mono" style="font-size:12px;">${h.kayit_sayisi}</span></td>
          <td><span class="mono" style="font-size:13px;font-weight:700;color:#22c55e;">${_fmtTutar(h.toplam_net)} ₺</span></td>
          <td>${durumPill}</td>
          <td>${odemeText}</td>
          <td class="col-islem"><div style="display:flex;gap:3px;">${aksiyonlar}</div></td>
        </tr>`;
    }).join('');
  }

  async function harcHaftaIptal(haftalikId) {
    if (!confirm('Bu hafta kapanışı iptal edilsin mi?\n\n(Snapshot iptal olur, kayıtlar açık kalır — yeniden kapatılabilir.)')) return;
    try {
      await window.HarcirahAPI.haftaIptal(haftalikId);
      if (typeof toast === 'function') toast('Hafta kapanışı iptal edildi', 'success');
      await refreshAll();
    } catch (e) {
      if (typeof toast === 'function') toast('İptal edilemedi: ' + e.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  // HAFTA ÖDEME MODAL
  // ════════════════════════════════════════════════════════
  let _harcOdeHedefId = null;

  async function openHarcirahHaftaOdeModal(haftalikId) {
    _harcOdeHedefId = haftalikId;
    // Haftalık snapshot'ı bul
    const list = await window.HarcirahAPI.haftalikList({});
    const h = list.find(x => x.id === haftalikId);
    if (!h) {
      if (typeof toast === 'function') toast('Hafta kaydı bulunamadı', 'error');
      return;
    }
    _$('harc-hafta-ode-sub').textContent = `${h.sofor_ad || '—'} · ${h.hafta_yili}/H${h.hafta_no}`;
    _$('harc-hafta-ode-tutar').textContent = _fmtTutar(h.toplam_net) + ' ₺';
    _setVal('harc-hafta-ode-yontem', 'EFT');
    _setVal('harc-hafta-ode-ref', '');
    _$('harc-hafta-ode-modal-bg')?.classList.remove('hidden');
  }

  function closeHarcirahHaftaOdeModal() {
    _$('harc-hafta-ode-modal-bg')?.classList.add('hidden');
    _harcOdeHedefId = null;
  }

  async function harcHaftaOdeOnayla() {
    if (!_harcOdeHedefId) return;
    const yontem = _getVal('harc-hafta-ode-yontem');
    const ref    = _getVal('harc-hafta-ode-ref') || null;
    const btn = _$('harc-hafta-ode-submit');
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
    try {
      await window.HarcirahAPI.haftaOden(_harcOdeHedefId, yontem, ref);
      if (typeof toast === 'function') toast('Ödeme kaydedildi', 'success');
      closeHarcirahHaftaOdeModal();
      await refreshAll();
    } catch (e) {
      if (typeof toast === 'function') toast('Kaydedilemedi: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  // ════════════════════════════════════════════════════════
  // PDF BORDRO (jsPDF + autoTable)
  // ════════════════════════════════════════════════════════
  async function harcHaftaPdfIndir(haftalikId) {
    if (typeof window.jspdf === 'undefined') {
      if (typeof toast === 'function') toast('PDF kütüphanesi yüklenmedi — sayfayı yenileyin', 'error');
      return;
    }
    const list = await window.HarcirahAPI.haftalikList({});
    const h = list.find(x => x.id === haftalikId);
    if (!h) { if (typeof toast === 'function') toast('Hafta bulunamadı', 'error'); return; }
    const kayitlar = await window.HarcirahAPI.haftalikKayitlar(h);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    // Türkçe destekli Roboto fontunu yükle (lazy, cache'li)
    let useRoboto = false;
    if (window.PdfFonts) {
      if (typeof toast === 'function' && !window.PdfFonts.isCached()) toast('PDF hazırlanıyor…', 'info');
      useRoboto = await window.PdfFonts.load(doc);
    }
    const FONT = useRoboto ? 'Roboto' : 'helvetica';

    // Roboto yüklenmezse latin-fallback (eski davranış)
    const safe = useRoboto ? (s) => String(s == null ? '' : s) : (s) => String(s == null ? '' : s)
      .replace(/ı/g, 'i').replace(/İ/g, 'I')
      .replace(/ş/g, 's').replace(/Ş/g, 'S')
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
      .replace(/ü/g, 'u').replace(/Ü/g, 'U')
      .replace(/ö/g, 'o').replace(/Ö/g, 'O')
      .replace(/ç/g, 'c').replace(/Ç/g, 'C');

    // HEADER
    doc.setFillColor(255, 107, 31);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15);
    doc.setFont(FONT, 'bold');
    doc.text(safe('FLEETLY · HARCIRAH BORDROSU'), 10, 12);

    doc.setTextColor(60, 60, 60);
    doc.setFontSize(10);
    doc.setFont(FONT, 'normal');
    let y = 28;
    doc.text(safe('Şoför:'), 10, y);
    doc.setFont(FONT, 'bold');
    doc.text(safe(h.sofor_ad || '-'), 30, y);
    doc.setFont(FONT, 'normal');
    doc.text(safe('Hafta:'), pageW - 70, y);
    doc.setFont(FONT, 'bold');
    doc.text(`${h.hafta_yili} / H${h.hafta_no}`, pageW - 50, y);

    y += 6;
    const tarihTxt = (h.baslangic_tarih && h.bitis_tarih)
      ? new Date(h.baslangic_tarih).toLocaleDateString('tr-TR') + ' – ' + new Date(h.bitis_tarih).toLocaleDateString('tr-TR')
      : '-';
    doc.setFont(FONT, 'normal');
    doc.text(safe('Tarih Aralığı:'), 10, y);
    doc.text(safe(tarihTxt), 40, y);

    y += 6;
    doc.text(safe(`Kapatıldı: ${h.kapatildi_at ? new Date(h.kapatildi_at).toLocaleString('tr-TR') : '-'}`), 10, y);
    const durumTxt = h.durum === 'odendi' ? 'Ödendi'
                    : h.durum === 'iptal' ? 'İptal'
                    : 'Kapalı · Ödeme bekliyor';
    doc.text(safe(`Durum: ${durumTxt}`), pageW - 80, y);

    // TABLO
    y += 8;
    const head = [['#', safe('Tarih'), safe('Plaka'), safe('Tarife'), safe('Manuel'), safe('Ek'), safe('Avans'), safe('Net (₺)')]];
    const body = kayitlar.map((k, i) => {
      const tarih = k.is_tarihi ? new Date(k.is_tarihi).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) : '-';
      return [
        String(i + 1),
        tarih,
        safe(k.arac_plaka || '-'),
        k.hesaplanan_tutar != null ? _fmtTutar(k.hesaplanan_tutar) : '-',
        k.manuel_tutar != null ? _fmtTutar(k.manuel_tutar) : '-',
        k.ek_masraflar > 0 ? '+' + _fmtTutar(k.ek_masraflar) : '-',
        k.avans_dusum > 0 ? '−' + _fmtTutar(k.avans_dusum) : '-',
        _fmtTutar(k.net_tutar || 0)
      ];
    });

    if (doc.autoTable) {
      doc.autoTable({
        head, body, startY: y,
        styles: { fontSize: 9, font: FONT },
        headStyles: { fillColor: [248, 250, 252], textColor: [50, 50, 50], fontStyle: 'bold', font: FONT },
        bodyStyles: { font: FONT },
        columnStyles: {
          0: { halign: 'right', cellWidth: 8 },
          7: { halign: 'right', fontStyle: 'bold' }
        },
        margin: { left: 10, right: 10 }
      });
      y = doc.lastAutoTable.finalY + 6;
    } else {
      doc.setFontSize(9);
      kayitlar.forEach((k, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.text(`${i+1}. ${k.is_tarihi || '-'} · ${safe(k.arac_plaka || '-')} · ${_fmtTutar(k.net_tutar)} ₺`, 10, y);
        y += 5;
      });
      y += 4;
    }

    // ÖZET KUTUSU
    doc.setFillColor(248, 250, 252);
    doc.rect(pageW - 90, y, 80, 30, 'F');
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.3);
    doc.rect(pageW - 90, y, 80, 30, 'S');

    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.setFont(FONT, 'normal');
    doc.text(safe('Brüt Toplam'), pageW - 88, y + 6);
    doc.text(_fmtTutar(h.toplam_brut) + ' ₺', pageW - 12, y + 6, { align: 'right' });

    doc.text(safe('Avans Düşüm'), pageW - 88, y + 12);
    doc.text('− ' + _fmtTutar(h.toplam_avans) + ' ₺', pageW - 12, y + 12, { align: 'right' });

    doc.setLineWidth(0.2);
    doc.line(pageW - 88, y + 16, pageW - 12, y + 16);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(34, 197, 94);
    doc.text(safe('NET ÖDENECEK'), pageW - 88, y + 23);
    doc.text(_fmtTutar(h.toplam_net) + ' ₺', pageW - 12, y + 23, { align: 'right' });

    if (h.notlar) {
      y += 36;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(safe('Not: ') + safe(h.notlar), 10, y, { maxWidth: pageW - 20 });
    }

    // FOOTER
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont(FONT, 'normal');
    doc.text(safe(`Oluşturuldu: ${new Date().toLocaleString('tr-TR')} · fleetly.fit`), 10, 290);

    // Dosya adı için ASCII normalize (filesystem güvenli)
    const asciiName = String(h.sofor_ad || 'sofor').toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `harcirah-${asciiName}-${h.hafta_yili}-h${h.hafta_no}.pdf`;
    doc.save(filename);

    if (typeof toast === 'function') toast('PDF indirildi', 'success');
  }

  // Kayıtlar
  window.harcRenderKayitlar         = harcRenderKayitlar;
  window.harcKayitFilterSet         = harcKayitFilterSet;
  window.harcKayitArama             = harcKayitArama;
  window.openHarcirahKayitModal     = openHarcirahKayitModal;
  window.closeHarcirahKayitModal    = closeHarcirahKayitModal;
  window.harcKayitSubmit            = harcKayitSubmit;
  window.harcKayitIsEmriAra         = harcKayitIsEmriAra;
  window.harcKayitIsEmriSec         = harcKayitIsEmriSec;
  window.harcKayitOpsOnay           = harcKayitOpsOnay;
  window.harcKayitOdendi            = harcKayitOdendi;
  window.harcKayitIptal             = harcKayitIptal;
  window.harcKayitDelete            = harcKayitDelete;
  // Haftalık + arşiv + ödeme + PDF
  window.harcRenderHaftalik         = harcRenderHaftalik;
  window.harcHaftaPrev              = harcHaftaPrev;
  window.harcHaftaNext              = harcHaftaNext;
  window.harcHaftaBugun             = harcHaftaBugun;
  window.harcHaftaKapatTumu         = harcHaftaKapatTumu;
  window.openHarcirahHaftaKapatModal  = openHarcirahHaftaKapatModal;
  window.closeHarcirahHaftaKapatModal = closeHarcirahHaftaKapatModal;
  window.harcHaftaKapatOnayla       = harcHaftaKapatOnayla;
  window.harcRenderArsiv            = harcRenderArsiv;
  window.harcHaftaIptal             = harcHaftaIptal;
  window.openHarcirahHaftaOdeModal  = openHarcirahHaftaOdeModal;
  window.closeHarcirahHaftaOdeModal = closeHarcirahHaftaOdeModal;
  window.harcHaftaOdeOnayla         = harcHaftaOdeOnayla;
  window.harcHaftaPdfIndir          = harcHaftaPdfIndir;
  window.harcSoforEslestir          = harcSoforEslestir;
})();
