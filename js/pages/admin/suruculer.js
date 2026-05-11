/* =============================================================================
 * admin/suruculer.js — Tüm şoförler liste + detay + durum + sil
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 30;
  let _state = { page: 0, arama: '', durum: '', firmaId: null, rows: [], toplam: 0 };

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-suruculer-content');
    if (!el) return;
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const rows = await T.rpc('admin_suruculer_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
        p_arama: _state.arama || null,
        p_durum: _state.durum || null,
        p_firma_id: _state.firmaId || null,
      });
      _state.rows = rows || [];
      _state.toplam = rows && rows.length ? Number(rows[0].toplam) : 0;
      render();
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-suruculer-content');
    if (_state.rows.length === 0) {
      el.innerHTML = '<div class="adm-empty">Şoför bulunamadı.</div>';
      return;
    }
    el.innerHTML = `
      <table class="adm-table">
        <thead><tr>
          <th>Ad Soyad</th>
          <th>Telefon</th>
          <th>Firma</th>
          <th>Durum</th>
          <th>Hesap</th>
          <th class="r">Belge</th>
          <th>Son Giriş</th>
          <th>Kayıt</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => {
            let durumBadge;
            if (r.durum === 'aktif')             durumBadge = '<span class="adm-badge adm-badge-success">Aktif</span>';
            else if (r.durum === 'pasif')        durumBadge = '<span class="adm-badge adm-badge-danger">Pasif</span>';
            else if (r.durum === 'davet_bekliyor') durumBadge = '<span class="adm-badge adm-badge-warning">Davet</span>';
            else                                  durumBadge = '<span class="adm-badge adm-badge-info">' + T.esc(r.durum) + '</span>';
            return `
              <tr class="clickable" onclick="AdmModule_suruculer.detayAc('${r.id}')">
                <td><strong>${T.esc(r.ad || '')} ${T.esc(r.soyad || '')}</strong></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(r.telefon || '—')}</span></td>
                <td>${T.esc(r.firma_ad || '—')}</td>
                <td>${durumBadge}</td>
                <td>${r.auth_email ? '<span class="pos"><i data-icon="check"></i></span> <span style="font-size:11px;font-family:Geist Mono,monospace;">' + T.esc(r.auth_email) + '</span>' : '<span class="muted">—</span>'}</td>
                <td class="r">${T.fmt.num(r.belge_sayisi)}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(r.son_giris))}</span></td>
                <td><span style="font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.date(r.kayit_tarihi))}</span></td>
                <td onclick="event.stopPropagation()">
                  <button class="adm-icon-btn" title="Detay" onclick="AdmModule_suruculer.detayAc('${r.id}')">
                    <i data-icon="chevron-right"></i>
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <div class="adm-pagination">
        <span class="adm-pagination-info">
          ${_state.page * PAGE_SIZE + 1}–${Math.min((_state.page+1) * PAGE_SIZE, _state.toplam)} / ${_state.toplam}
        </span>
        <div class="adm-pagination-controls">
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_suruculer.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_suruculer.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  async function detayAc(surucuId) {
    const T = window.AdmAPI;
    T.modalAc('Şoför Detayı', '<div class="adm-empty">Yükleniyor…</div>');
    try {
      const d = await T.rpc('admin_surucu_detay', { p_surucu_id: surucuId });
      renderDetay(d);
    } catch (err) {
      T.toast('Detay alınamadı: ' + err.message, 'error');
    }
  }

  function renderDetay(d) {
    const T = window.AdmAPI;
    const s = d.surucu || {};
    const f = d.firma  || {};

    let durumBadge;
    if (s.durum === 'aktif')               durumBadge = '<span class="adm-badge adm-badge-success">Aktif</span>';
    else if (s.durum === 'pasif')          durumBadge = '<span class="adm-badge adm-badge-danger">Pasif</span>';
    else if (s.durum === 'davet_bekliyor') durumBadge = '<span class="adm-badge adm-badge-warning">Davet Bekliyor</span>';
    else                                    durumBadge = '<span class="adm-badge">' + T.esc(s.durum || '—') + '</span>';

    const belgelerHtml = (d.belgeler || []).length === 0
      ? '<div class="muted" style="padding:8px 0;">Belge yüklenmemiş.</div>'
      : `<table class="adm-table">
          <thead><tr><th>Tür</th><th>Numara</th><th>Bitiş</th><th>Durum</th></tr></thead>
          <tbody>${(d.belgeler||[]).map(b => {
            const dl = b.bitis_tarihi ? Math.floor((new Date(b.bitis_tarihi) - new Date())/86400000) : null;
            let bd = '<span class="muted">—</span>';
            if (dl != null) {
              bd = dl < 0
                ? `<span class="neg">${Math.abs(dl)} gün geç</span>`
                : dl <= 30
                  ? `<span class="adm-badge adm-badge-warning">${dl} gün</span>`
                  : `<span class="pos">${dl} gün</span>`;
            }
            return `
              <tr>
                <td>${T.esc(b.tur_kod || b.tur || '—')}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(b.numara || '—')}</span></td>
                <td>${T.esc(T.fmt.date(b.bitis_tarihi))}</td>
                <td>${bd}</td>
              </tr>
            `;
          }).join('')}</tbody>
        </table>`;

    const seferlerHtml = (d.son_seferler || []).length === 0
      ? '<div class="muted" style="padding:8px 0;">Sefer kaydı yok.</div>'
      : `<table class="adm-table">
          <thead><tr><th>Tarih</th><th>Durum</th><th>Müşteri</th><th>Rota</th></tr></thead>
          <tbody>${(d.son_seferler||[]).map(ie => `
            <tr>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.date(ie.tarih))}</span></td>
              <td><span class="adm-badge adm-badge-info">${T.esc(ie.durum)}</span></td>
              <td>${T.esc(ie.musteri || '—')}</td>
              <td>${T.esc((ie.yukle || '—'))} → ${T.esc((ie.teslim || '—'))}</td>
            </tr>
          `).join('')}</tbody>
        </table>`;

    const html = `
      <h3 style="font-family:Newsreader,serif;font-weight:400;margin:0 0 4px;font-size:22px;letter-spacing:-.01em;">
        ${T.esc(s.ad || '')} ${T.esc(s.soyad || '')}
      </h3>
      <div style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-3);margin-bottom:16px;">${T.esc(s.id)}</div>

      <div style="display:flex;gap:8px;margin-bottom:20px;">${durumBadge}</div>

      <div class="adm-detail-row">
        <div class="adm-detail-key">Telefon</div>
        <div class="adm-detail-val mono">${T.esc(s.telefon_e164 || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">E-posta</div>
        <div class="adm-detail-val mono">${T.esc(s.email || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Firma</div>
        <div class="adm-detail-val">${T.esc(f.ad || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Hesap Bağlantısı</div>
        <div class="adm-detail-val">${s.auth_user_id ? '<span class="pos">Aktif</span> <span class="mono" style="margin-left:8px;">' + T.esc(s.auth_user_id) + '</span>' : '<span class="muted">Davet bekleniyor</span>'}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Son Giriş</div>
        <div class="adm-detail-val">${T.esc(T.fmt.dateTime(s.son_giris))}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">FCM Push Token</div>
        <div class="adm-detail-val">${s.fcm_token ? '<span class="pos">Var</span>' : '<span class="muted">Yok</span>'}</div>
      </div>

      <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:16px;">Belgeler (${(d.belgeler||[]).length})</h2></div>
      ${belgelerHtml}

      <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:16px;">Son Seferler</h2></div>
      ${seferlerHtml}

      <div class="adm-modal-actions" style="flex-wrap:wrap;">
        ${s.durum === 'aktif'
          ? `<button class="adm-btn adm-btn-danger" onclick="AdmModule_suruculer.durumDegistir('${s.id}', 'pasif')"><i data-icon="ban"></i> Pasifleştir</button>`
          : `<button class="adm-btn" onclick="AdmModule_suruculer.durumDegistir('${s.id}', 'aktif')"><i data-icon="check"></i> Aktifleştir</button>`}
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_suruculer.silModal('${s.id}', '${T.esc(s.ad + ' ' + (s.soyad||''))}')"><i data-icon="trash"></i> Sil</button>
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;

    document.getElementById('adm-modal-body').innerHTML = html;
  }

  async function durumDegistir(surucuId, durum) {
    const T = window.AdmAPI;
    const neden = prompt('Neden? (audit log\'a yazılır)', '');
    if (neden === null) return;
    try {
      await T.rpc('admin_surucu_durum_degistir', {
        p_surucu_id: surucuId, p_durum: durum, p_neden: neden,
      });
      T.toast('Durum güncellendi', 'success');
      detayAc(surucuId);
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function silModal(surucuId, ad) {
    const T = window.AdmAPI;
    const html = `
      <p style="font-size:13px;color:var(--adm-negative);margin:0 0 16px;">
        <strong>${T.esc(ad)}</strong> şoför kaydı durumu "silindi" olacak.
        Veriler korunur (ziyaret geçmişi, belgeler vs.) — sadece artık görünmez.
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Neden</label>
        <textarea id="adm-surucu-sil-neden" class="adm-input"></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_suruculer.silKaydet('${surucuId}')">Sil</button>
      </div>
    `;
    T.modalAc('Şoför Sil', html);
  }

  async function silKaydet(surucuId) {
    const T = window.AdmAPI;
    const neden = document.getElementById('adm-surucu-sil-neden').value.trim() || null;
    try {
      await T.rpc('admin_surucu_durum_degistir', {
        p_surucu_id: surucuId, p_durum: 'silindi', p_neden: neden,
      });
      T.toast('Şoför silindi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function bindFilters() {
    const sInput = document.getElementById('adm-surucu-search');
    const dSelect = document.getElementById('adm-surucu-durum');
    let _t = null;
    sInput?.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _state.arama = sInput.value.trim(); _state.page = 0; fetch(); }, 300);
    });
    dSelect?.addEventListener('change', () => { _state.durum = dSelect.value; _state.page = 0; fetch(); });
  }

  window.AdmModule_suruculer = {
    init: () => { bindFilters(); fetch(); },
    onShow: fetch,
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    detayAc, durumDegistir, silModal, silKaydet,
  };
  window.admSuruculerYenile = fetch;
})();
