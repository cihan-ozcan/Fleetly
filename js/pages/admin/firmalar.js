/* =============================================================================
 * admin/firmalar.js — Tüm firmaları listele + detay + suspend + abonelik
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 25;
  let _state = {
    page: 0,
    arama: '',
    durum: '',
    rows: [],
    toplam: 0,
  };

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-firmalar-content');
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const rows = await T.rpc('admin_firmalar_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
        p_arama: _state.arama || null,
        p_durum: _state.durum || null,
      });
      _state.rows = rows || [];
      _state.toplam = rows && rows.length ? Number(rows[0].toplam) : 0;
      render();
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="adm-empty">Firma listesi alınamadı: ' + T.esc(err.message) + '</div>';
    }
  }

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-firmalar-content');
    if (_state.rows.length === 0) {
      el.innerHTML = '<div class="adm-empty">Kayıt bulunamadı.</div>';
      return;
    }

    const html = `
      <table class="adm-table">
        <thead><tr>
          <th>Firma</th>
          <th>Plan</th>
          <th>Durum</th>
          <th class="r">Kullanıcı</th>
          <th class="r">Şoför</th>
          <th class="r">Araç</th>
          <th class="r">30g Sefer</th>
          <th>Son Giriş</th>
          <th>Kayıt</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => renderRow(r)).join('')}
        </tbody>
      </table>
      <div class="adm-pagination">
        <span class="adm-pagination-info">
          ${_state.page * PAGE_SIZE + 1}–${Math.min((_state.page+1) * PAGE_SIZE, _state.toplam)} / ${_state.toplam}
        </span>
        <div class="adm-pagination-controls">
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_firmalar.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_firmalar.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
    el.innerHTML = html;
  }

  function renderRow(r) {
    const T = window.AdmAPI;
    let durumBadge = '<span class="adm-badge adm-badge-success">Aktif</span>';
    if (r.suspended) durumBadge = '<span class="adm-badge adm-badge-danger">Askıda</span>';
    else if (r.is_demo) durumBadge = '<span class="adm-badge adm-badge-info">Demo</span>';

    let planBadge = '<span class="muted">—</span>';
    if (r.abonelik_plan) {
      const t = r.abonelik_durum === 'aktif' ? 'adm-badge-fill' : 'adm-badge-info';
      planBadge = `<span class="adm-badge ${t}">${T.esc(r.abonelik_plan)}</span>`;
    }

    return `
      <tr class="clickable" onclick="AdmModule_firmalar.detayAc('${r.id}')">
        <td><strong>${T.esc(r.ad)}</strong></td>
        <td>${planBadge}</td>
        <td>${durumBadge}</td>
        <td class="r">${T.fmt.num(r.kullanici_sayisi)}</td>
        <td class="r">${T.fmt.num(r.surucu_sayisi)}</td>
        <td class="r">${T.fmt.num(r.arac_sayisi)}</td>
        <td class="r">${T.fmt.num(r.sefer_30g)}</td>
        <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(r.son_giris))}</span></td>
        <td><span style="font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.date(r.kayit_tarihi))}</span></td>
        <td onclick="event.stopPropagation()">
          <button class="adm-icon-btn" title="Detay" onclick="AdmModule_firmalar.detayAc('${r.id}')">
            <i data-icon="chevron-right"></i>
          </button>
        </td>
      </tr>
    `;
  }

  async function detayAc(firmaId) {
    const T = window.AdmAPI;
    T.modalAc('Firma Detayı', '<div class="adm-empty">Yükleniyor…</div>');
    try {
      const data = await T.rpc('admin_firma_detay', { p_firma_id: firmaId });
      renderDetay(data);
    } catch (err) {
      T.toast('Detay alınamadı: ' + err.message, 'error');
    }
  }

  function renderDetay(d) {
    const T = window.AdmAPI;
    const f = d.firma || {};
    const ab = d.abonelik || null;
    const kullanicilar = d.kullanicilar || [];
    const suruculer = d.suruculer || [];

    let durumBadge = '<span class="adm-badge adm-badge-success">Aktif</span>';
    if (f.suspended) durumBadge = '<span class="adm-badge adm-badge-danger">Askıda</span>';
    else if (f.is_demo) durumBadge = '<span class="adm-badge adm-badge-info">Demo</span>';

    const html = `
      <h3 style="font-family:Newsreader,serif;font-weight:400;margin:0 0 4px;font-size:24px;letter-spacing:-.01em;">${T.esc(f.ad)}</h3>
      <div style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-3);margin-bottom:16px;">${T.esc(f.id)}</div>

      <div style="display:flex;gap:8px;margin-bottom:20px;">${durumBadge}
        ${ab ? `<span class="adm-badge adm-badge-fill">${T.esc(ab.plan_kodu || 'plan')}</span>` : ''}
      </div>

      <div class="adm-detail-row">
        <div class="adm-detail-key">Kayıt Tarihi</div>
        <div class="adm-detail-val">${T.esc(T.fmt.dateTime(f.created_at))}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Vergi No</div>
        <div class="adm-detail-val mono">${T.esc(f.vergi_no || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Adres</div>
        <div class="adm-detail-val">${T.esc(f.adres || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">İletişim</div>
        <div class="adm-detail-val">${T.esc(f.telefon || '')} ${f.eposta ? '· ' + T.esc(f.eposta) : ''}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Filo</div>
        <div class="adm-detail-val">${T.fmt.num(d.arac_sayisi)} araç · ${kullanicilar.length} ofis · ${suruculer.length} şoför</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Sefer Hacmi</div>
        <div class="adm-detail-val">${T.fmt.num(d.sefer_30g)} (30 gün) · ${T.fmt.num(d.sefer_90g)} (90 gün)</div>
      </div>

      ${ab ? `
        <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:16px;">Abonelik</h2></div>
        <div class="adm-detail-row">
          <div class="adm-detail-key">Plan</div>
          <div class="adm-detail-val">${T.esc(ab.plan_kodu || '—')}</div>
        </div>
        <div class="adm-detail-row">
          <div class="adm-detail-key">Durum</div>
          <div class="adm-detail-val">${T.esc(ab.durum || '—')}</div>
        </div>
        <div class="adm-detail-row">
          <div class="adm-detail-key">Başlangıç</div>
          <div class="adm-detail-val">${T.esc(T.fmt.dateTime(ab.baslangic_tarihi))}</div>
        </div>
        <div class="adm-detail-row">
          <div class="adm-detail-key">Bitiş</div>
          <div class="adm-detail-val">${T.esc(T.fmt.dateTime(ab.bitis_tarihi))}</div>
        </div>
      ` : ''}

      ${kullanicilar.length > 0 ? `
        <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:16px;">Ofis Kullanıcıları</h2></div>
        <table class="adm-table">
          <thead><tr><th>E-posta</th><th>Rol</th><th>Son Giriş</th></tr></thead>
          <tbody>
            ${kullanicilar.map(u => `
              <tr>
                <td>${T.esc(u.email || '—')}</td>
                <td><span class="adm-badge adm-badge-info">${T.esc(u.rol || '—')}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(u.son_giris))}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}

      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="AdmModule_firmalar.abonelikUzatModal('${f.id}', '${ab?.plan_kodu||''}', '${ab?.bitis_tarihi||''}')">
          <i data-icon="calendar"></i> Abonelik Uzat
        </button>
        ${f.suspended
          ? `<button class="adm-btn" onclick="AdmModule_firmalar.suspendToggle('${f.id}', false)"><i data-icon="check"></i> Aktifleştir</button>`
          : `<button class="adm-btn adm-btn-danger" onclick="AdmModule_firmalar.suspendToggle('${f.id}', true)"><i data-icon="ban"></i> Askıya Al</button>`}
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;

    document.getElementById('adm-modal-body').innerHTML = html;
  }

  async function suspendToggle(firmaId, suspend) {
    const T = window.AdmAPI;
    const neden = suspend ? prompt('Askıya alma nedeni (opsiyonel):') : null;
    if (suspend && neden === null) return; // iptal
    try {
      await T.rpc('admin_firma_suspend', { p_firma_id: firmaId, p_suspended: suspend, p_neden: neden });
      T.toast(suspend ? 'Firma askıya alındı' : 'Firma aktifleştirildi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  function abonelikUzatModal(firmaId, plan, bitis) {
    const T = window.AdmAPI;
    const bitisISO = bitis ? new Date(bitis).toISOString().slice(0,10) : '';
    const html = `
      <p style="font-size:13px;color:var(--adm-ink-2);margin-top:0;">
        Bu firmanın aboneliğini manuel olarak uzat. Yeni bitiş tarihi tüm sistemde geçerli olur.
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Yeni Bitiş Tarihi</label>
        <input type="date" id="adm-ab-bitis" class="adm-input" value="${bitisISO}" min="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Plan (opsiyonel)</label>
        <select id="adm-ab-plan" class="adm-input">
          <option value="">— Mevcut planı koru —</option>
          <option value="free"${plan==='free'?' selected':''}>Free</option>
          <option value="pro"${plan==='pro'?' selected':''}>Pro</option>
          <option value="premium"${plan==='premium'?' selected':''}>Premium</option>
          <option value="kurumsal"${plan==='kurumsal'?' selected':''}>Kurumsal</option>
        </select>
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Not (audit log'a yazılır)</label>
        <textarea id="adm-ab-not" class="adm-input" placeholder="Örn: Müşteri talebi ile 1 ay hediye verildi"></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_firmalar.abonelikUzatKaydet('${firmaId}')">Uzat</button>
      </div>
    `;
    T.modalAc('Abonelik Uzat', html);
  }

  async function abonelikUzatKaydet(firmaId) {
    const T = window.AdmAPI;
    const bitis = document.getElementById('adm-ab-bitis').value;
    const plan = document.getElementById('adm-ab-plan').value || null;
    const not = document.getElementById('adm-ab-not').value || null;
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
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  // Search/filter event'leri
  function bindFilters() {
    const sInput = document.getElementById('adm-firma-search');
    const dSelect = document.getElementById('adm-firma-durum');
    let _t = null;
    sInput?.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => {
        _state.arama = sInput.value.trim();
        _state.page = 0;
        fetch();
      }, 300);
    });
    dSelect?.addEventListener('change', () => {
      _state.durum = dSelect.value;
      _state.page = 0;
      fetch();
    });
  }

  window.AdmModule_firmalar = {
    init: () => { bindFilters(); fetch(); },
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    detayAc, suspendToggle, abonelikUzatModal, abonelikUzatKaydet,
  };
  window.admFirmalarYenile = fetch;
})();
