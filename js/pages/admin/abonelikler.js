/* =============================================================================
 * admin/abonelikler.js — Tüm firma abonelikleri + manuel aksiyon
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 40;
  let _state = { page: 0, arama: '', durum: '', rows: [], toplam: 0 };

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-abonelikler-content');
    if (!el) return;
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const rows = await T.rpc('admin_abonelikler_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
        p_arama: _state.arama || null,
        p_durum: _state.durum || null,
      });
      _state.rows = rows || [];
      _state.toplam = rows && rows.length ? Number(rows[0].toplam) : 0;
      render();
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function durumBadge(d) {
    const T = window.AdmAPI;
    const map = {
      'aktif':           'adm-badge-success',
      'deneme':          'adm-badge-info',
      'odeme_bekliyor':  'adm-badge-warning',
      'suresi_dolmus':   'adm-badge-danger',
      'iptal':           'adm-badge-danger',
    };
    return `<span class="adm-badge ${map[d]||'adm-badge-info'}">${T.esc(d || '—')}</span>`;
  }

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-abonelikler-content');
    if (_state.rows.length === 0) {
      el.innerHTML = '<div class="adm-empty">Abonelik kaydı yok.</div>';
      return;
    }

    el.innerHTML = `
      <table class="adm-table">
        <thead><tr>
          <th>Firma</th>
          <th>E-posta</th>
          <th>Plan</th>
          <th>Durum</th>
          <th>Bitiş / Deneme</th>
          <th class="r">Kalan Gün</th>
          <th>Son Ödeme</th>
          <th class="r">Son Tutar</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => {
            const bitis = r.durum === 'deneme' ? r.deneme_bitis : r.bitis_tarihi;
            return `
              <tr class="clickable" onclick="AdmModule_abonelikler.aksiyonMenu('${r.firma_id}', '${T.esc(r.firma_ad)}', '${T.esc(r.plan||'')}', '${bitis||''}')">
                <td><strong>${T.esc(r.firma_ad)}</strong></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(r.iletisim_email || '—')}</span></td>
                <td>${r.plan ? '<span class="adm-badge adm-badge-fill">' + T.esc(r.plan) + '</span>' : '<span class="muted">—</span>'}</td>
                <td>${durumBadge(r.durum)}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(T.fmt.date(bitis))}</span></td>
                <td class="r ${r.kalan_gun > 7 ? 'pos' : r.kalan_gun > 0 ? '' : 'neg'}">${r.kalan_gun != null ? r.kalan_gun + ' gün' : '—'}</td>
                <td><span style="font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(r.son_odeme_tarihi))}</span></td>
                <td class="r">${r.son_odeme_tutar ? T.fmt.try(r.son_odeme_tutar) + ' TL' : '<span class="muted">—</span>'}</td>
                <td onclick="event.stopPropagation()">
                  <button class="adm-icon-btn" title="Aksiyonlar" onclick="AdmModule_abonelikler.aksiyonMenu('${r.firma_id}', '${T.esc(r.firma_ad)}', '${T.esc(r.plan||'')}', '${bitis||''}')">
                    <i data-icon="more-vertical"></i>
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
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_abonelikler.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_abonelikler.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  function aksiyonMenu(firmaId, firmaAd, plan, bitis) {
    const T = window.AdmAPI;
    const bitisISO = bitis ? new Date(bitis).toISOString().slice(0,10) : '';
    const html = `
      <h3 style="font-family:Newsreader,serif;font-weight:400;margin:0 0 16px;font-size:20px;">${T.esc(firmaAd)}</h3>
      <p style="font-size:13px;color:var(--adm-ink-2);margin-bottom:20px;">
        Bu firmanın aboneliği için manuel aksiyon seç.
      </p>

      <div class="adm-subhead" style="margin:0 0 8px;"><h2 style="font-size:14px;">Abonelik Uzat</h2></div>
      <div class="adm-form-row">
        <div class="adm-form-group">
          <label class="adm-label">Yeni Bitiş</label>
          <input type="date" id="adm-ab-yeni-bitis" class="adm-input" value="${bitisISO}" min="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="adm-form-group">
          <label class="adm-label">Plan</label>
          <select id="adm-ab-yeni-plan" class="adm-input">
            <option value="">— Mevcut planı koru —</option>
            <option value="free"${plan==='free'?' selected':''}>Free</option>
            <option value="pro"${plan==='pro'?' selected':''}>Pro</option>
            <option value="premium"${plan==='premium'?' selected':''}>Premium</option>
            <option value="kurumsal"${plan==='kurumsal'?' selected':''}>Kurumsal</option>
          </select>
        </div>
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Not (audit log)</label>
        <textarea id="adm-ab-yeni-not" class="adm-input" placeholder="Manuel uzatma sebebi"></textarea>
      </div>
      <button class="adm-btn adm-btn-primary" style="width:100%;" onclick="AdmModule_abonelikler.uzatKaydet('${firmaId}')">
        <i data-icon="calendar"></i> Aboneliği Uzat
      </button>

      <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:14px;">Diğer Aksiyonlar</h2></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_abonelikler.iptal('${firmaId}', '${T.esc(firmaAd)}')">
          <i data-icon="ban"></i> Aboneliği İptal Et
        </button>
        <button class="adm-btn adm-btn-ghost" onclick="AdmModule_abonelikler.iadeModal('${firmaId}', '${T.esc(firmaAd)}')">
          <i data-icon="banknote"></i> İade Kaydı
        </button>
      </div>

      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;
    T.modalAc('Abonelik: ' + firmaAd, html);
  }

  async function uzatKaydet(firmaId) {
    const T = window.AdmAPI;
    const bitis = document.getElementById('adm-ab-yeni-bitis').value;
    const plan = document.getElementById('adm-ab-yeni-plan').value || null;
    const not = document.getElementById('adm-ab-yeni-not').value || null;
    if (!bitis) { T.toast('Bitiş tarihi gerekli', 'error'); return; }
    try {
      await T.rpc('admin_abonelik_uzat', {
        p_firma_id: firmaId,
        p_yeni_bitis: new Date(bitis + 'T23:59:59').toISOString(),
        p_plan: plan,
        p_not: not,
      });
      T.toast('Abonelik uzatıldı', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function iptal(firmaId, firmaAd) {
    const T = window.AdmAPI;
    const neden = prompt(`"${firmaAd}" aboneliğini iptal et. Neden?`, '');
    if (neden === null) return;
    if (!confirm(`"${firmaAd}" aboneliği iptal edilecek. Emin misin?`)) return;
    try {
      await T.rpc('admin_abonelik_iptal', { p_firma_id: firmaId, p_neden: neden });
      T.toast('Abonelik iptal edildi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function iadeModal(firmaId, firmaAd) {
    const T = window.AdmAPI;
    const html = `
      <p style="font-size:13px;color:var(--adm-ink-2);margin:0 0 16px;">
        <strong>${T.esc(firmaAd)}</strong> için iade kaydı.
        Bu işlem iyzipay'ı tetiklemez — sadece sistemde "iade" işaretler.
        Para iadesini iyzipay panelinden manuel yapın.
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Tutar (TL)</label>
        <input type="number" id="adm-iade-tutar" class="adm-input" step="0.01" placeholder="Örn: 499.00">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Neden</label>
        <textarea id="adm-iade-neden" class="adm-input" placeholder="Müşteri talebi / hatalı ödeme / ..."></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_abonelikler.iadeKaydet('${firmaId}')">İade Kaydet</button>
      </div>
    `;
    T.modalAc('İade Kaydı', html);
  }

  async function iadeKaydet(firmaId) {
    const T = window.AdmAPI;
    const tutar = parseFloat(document.getElementById('adm-iade-tutar').value);
    const neden = document.getElementById('adm-iade-neden').value.trim() || null;
    if (!tutar || tutar <= 0) { T.toast('Geçerli tutar gerekli', 'error'); return; }
    try {
      await T.rpc('admin_abonelik_iade', {
        p_firma_id: firmaId, p_tutar: tutar, p_neden: neden,
      });
      T.toast('İade kaydedildi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function bindFilters() {
    const sInput = document.getElementById('adm-ab-search');
    const dSelect = document.getElementById('adm-ab-durum');
    let _t = null;
    sInput?.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _state.arama = sInput.value.trim(); _state.page = 0; fetch(); }, 300);
    });
    dSelect?.addEventListener('change', () => { _state.durum = dSelect.value; _state.page = 0; fetch(); });
  }

  window.AdmModule_abonelikler = {
    init: () => { bindFilters(); fetch(); },
    onShow: fetch,
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    aksiyonMenu, uzatKaydet, iptal, iadeModal, iadeKaydet,
  };
  window.admAboneliklerYenile = fetch;
})();
