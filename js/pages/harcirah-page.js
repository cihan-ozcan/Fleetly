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
    kayitlar: [],
    haftalikOzet: [],
    loaded: false
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
    await refreshAll();
    switchHarcirahTab(state.activeTab || 'tarifeler');
  }

  function closeHarcirahPage() {
    const page = _$('harcirah-page');
    if (!page) return;
    page.classList.remove('open');
    page.classList.add('hidden');
    document.body.style.overflow = '';
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
  }

  // "+ Yeni" butonu sekmeye göre handler
  function harcAddBtnClick() {
    if (state.activeTab === 'tarifeler') openHarcirahTarifeModal();
    else if (state.activeTab === 'kayitlar') {
      if (typeof toast === 'function') toast('Manuel kayıt formu Paket B\'de gelecek.', 'info');
    } else if (state.activeTab === 'haftalik') {
      if (typeof toast === 'function') toast('Hafta kapatma Paket C\'de gelecek.', 'info');
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
    const tarifeler = await safe(() => window.HarcirahAPI.tarifeList(), []);
    state.tarifeler = tarifeler || [];
    state.loaded = true;
    _updateCounts();
    _updateMigrationBanner();
    harcRenderTarifeler();
  }

  function _updateCounts() {
    const set = (id, n) => { const el = _$(id); if (el) el.textContent = n; };
    set('harc-cnt-tarifeler', state.tarifeler.length);
    set('harc-cnt-kayitlar',  '');
    const sum = _$('harcirah-summary');
    if (sum) {
      const aktif = state.tarifeler.filter(t => t.aktif_mi !== false).length;
      sum.textContent = `${state.tarifeler.length} tarife · ${aktif} aktif`;
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
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--muted);">${empty}</td></tr>`;
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

      return `
        <tr>
          <td>
            <div style="font-weight:700;color:var(--text);font-size:12.5px;">${_esc(t.baslik)}</div>
            ${t.notlar ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;font-style:italic;">${_esc(t.notlar)}</div>` : ''}
          </td>
          <td style="font-size:12px;">${t.alim_yeri ? _esc(t.alim_yeri) : '<span style="color:var(--muted);">—</span>'}</td>
          <td style="font-size:12px;">${t.teslim_yeri ? _esc(t.teslim_yeri) : '<span style="color:var(--muted);">—</span>'}</td>
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
    ['harc-t-baslik','harc-t-tutar','harc-t-alim','harc-t-teslim','harc-t-bos-donus',
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

  async function harcTarifeSubmit() {
    _showErr('');
    const baslik = _getVal('harc-t-baslik');
    const tutar  = _getVal('harc-t-tutar');
    if (!baslik) { _showErr('Başlık zorunlu.'); _$('harc-t-baslik')?.focus(); return; }
    if (!tutar || isNaN(Number(tutar))) { _showErr('Geçerli bir tutar girin.'); _$('harc-t-tutar')?.focus(); return; }

    const payload = {
      baslik,
      tutar:           Number(tutar),
      alim_yeri:       _getVal('harc-t-alim') || null,
      teslim_yeri:     _getVal('harc-t-teslim') || null,
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

  // ESC ile modal kapat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const bg = _$('harc-tarife-modal-bg');
      if (bg && !bg.classList.contains('hidden')) closeHarcirahTarifeModal();
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
})();
