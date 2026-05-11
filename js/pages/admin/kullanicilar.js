/* =============================================================================
 * admin/kullanicilar.js — Tüm auth.users + firma_kullanicilar + suruculer
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 30;
  let _state = { page: 0, arama: '', tip: '', rows: [], toplam: 0 };

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-kullanicilar-content');
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const rows = await T.rpc('admin_kullanicilar_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
        p_arama: _state.arama || null,
        p_tip: _state.tip || null,
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
    const el = document.getElementById('adm-kullanicilar-content');
    if (_state.rows.length === 0) {
      el.innerHTML = '<div class="adm-empty">Kullanıcı bulunamadı.</div>';
      return;
    }

    el.innerHTML = `
      <table class="adm-table">
        <thead><tr>
          <th>E-posta</th><th>Tip</th><th>Ad Soyad</th><th>Firma</th><th>Rol</th>
          <th>Son Giriş</th><th>Kayıt</th><th>Durum</th><th></th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => {
            const tipBadge = r.tip === 'ofis'
              ? '<span class="adm-badge adm-badge-info">Ofis</span>'
              : r.tip === 'surucu'
                ? '<span class="adm-badge">Şoför</span>'
                : '<span class="muted">—</span>';
            let durumBadge;
            if (!r.aktif) durumBadge = '<span class="adm-badge adm-badge-danger">Banlı</span>';
            else if (!r.email_confirmed) durumBadge = '<span class="adm-badge adm-badge-warning">E-posta ✕</span>';
            else durumBadge = '<span class="adm-badge adm-badge-success">Aktif</span>';
            return `
              <tr class="clickable" onclick="AdmModule_kullanicilar.detayAc('${r.user_id}')">
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(r.email || '—')}</span></td>
                <td>${tipBadge}</td>
                <td>${T.esc(r.ad_soyad || '—')}</td>
                <td>${T.esc(r.firma_ad || '—')}</td>
                <td>${r.rol ? '<span class="adm-badge adm-badge-info">' + T.esc(r.rol) + '</span>' : '<span class="muted">—</span>'}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(r.son_giris))}</span></td>
                <td><span style="font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.date(r.kayit_tarihi))}</span></td>
                <td>${durumBadge}</td>
                <td onclick="event.stopPropagation()">
                  <button class="adm-icon-btn" title="Detay" onclick="AdmModule_kullanicilar.detayAc('${r.user_id}')">
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
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_kullanicilar.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_kullanicilar.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  function bindFilters() {
    const sInput = document.getElementById('adm-user-search');
    const tSelect = document.getElementById('adm-user-tip');
    let _t = null;
    sInput?.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _state.arama = sInput.value.trim(); _state.page = 0; fetch(); }, 300);
    });
    tSelect?.addEventListener('change', () => { _state.tip = tSelect.value; _state.page = 0; fetch(); });
  }

  // ── DETAY MODALI ──
  async function detayAc(userId) {
    const T = window.AdmAPI;
    T.modalAc('Kullanıcı Detayı', '<div class="adm-empty">Yükleniyor…</div>');
    try {
      const data = await T.rpc('admin_user_detay', { p_user_id: userId });
      renderDetay(data);
    } catch (err) {
      T.toast('Detay alınamadı: ' + err.message, 'error');
    }
  }

  function renderDetay(d) {
    const T = window.AdmAPI;
    const u = d.user || {};
    const me = T.user();
    const isMe = u.id === me.id;
    const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
    const isAdmin = u.is_platform_admin;

    let durumBadge;
    if (isBanned) durumBadge = '<span class="adm-badge adm-badge-danger">Banlı (' + T.esc(T.fmt.date(u.banned_until)) + ')</span>';
    else if (!u.email_confirmed_at) durumBadge = '<span class="adm-badge adm-badge-warning">E-posta doğrulanmadı</span>';
    else durumBadge = '<span class="adm-badge adm-badge-success">Aktif</span>';

    const firmalarHtml = (d.firmalar || []).length === 0
      ? '<div class="muted" style="padding:8px 0;">Herhangi bir firmaya bağlı değil.</div>'
      : `<table class="adm-table">
          <thead><tr><th>Firma</th><th>Rol</th><th>Abonelik</th><th>Durum</th></tr></thead>
          <tbody>${(d.firmalar||[]).map(f => `
            <tr>
              <td>${T.esc(f.firma_ad || '—')}</td>
              <td><span class="adm-badge adm-badge-info">${T.esc(f.rol || '—')}</span></td>
              <td>${T.esc(f.abonelik_durumu || '—')}</td>
              <td>${f.suspended ? '<span class="adm-badge adm-badge-danger">Suspended</span>' : '<span class="adm-badge adm-badge-success">OK</span>'}</td>
            </tr>
          `).join('')}</tbody>
        </table>`;

    const surucuHtml = d.surucu
      ? `<table class="adm-table">
          <tbody>
            <tr><td>Ad</td><td>${T.esc(d.surucu.ad)} ${T.esc(d.surucu.soyad || '')}</td></tr>
            <tr><td>Telefon</td><td><span style="font-family:'Geist Mono',monospace;">${T.esc(d.surucu.telefon_e164)}</span></td></tr>
            <tr><td>Durum</td><td><span class="adm-badge">${T.esc(d.surucu.durum)}</span></td></tr>
            <tr><td>Son Giriş</td><td>${T.esc(T.fmt.relative(d.surucu.son_giris))}</td></tr>
            <tr><td>FCM Token</td><td>${d.surucu.fcm_token ? '<span class="pos">Var</span>' : '<span class="muted">Yok</span>'}</td></tr>
          </tbody>
        </table>`
      : '<div class="muted" style="padding:8px 0;">Şoför kaydı yok.</div>';

    const html = `
      <h3 style="font-family:Newsreader,serif;font-weight:400;margin:0 0 4px;font-size:22px;letter-spacing:-.01em;">
        ${T.esc(u.email || '—')}
        ${isAdmin ? '<span class="adm-badge adm-badge-fill" style="margin-left:8px;">PLATFORM ADMİN</span>' : ''}
        ${isMe ? '<span class="adm-badge" style="margin-left:6px;">SİZ</span>' : ''}
      </h3>
      <div style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-3);margin-bottom:16px;">${T.esc(u.id)}</div>

      <div style="display:flex;gap:8px;margin-bottom:20px;">${durumBadge}</div>

      <div class="adm-detail-row">
        <div class="adm-detail-key">Kayıt Tarihi</div>
        <div class="adm-detail-val">${T.esc(T.fmt.dateTime(u.created_at))}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Son Giriş</div>
        <div class="adm-detail-val">${T.esc(T.fmt.dateTime(u.last_sign_in_at))}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">E-posta Doğrulandı</div>
        <div class="adm-detail-val">${u.email_confirmed_at ? T.esc(T.fmt.dateTime(u.email_confirmed_at)) : '<span class="neg">Hayır</span>'}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Telefon</div>
        <div class="adm-detail-val mono">${T.esc(u.phone || '—')}</div>
      </div>

      <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:16px;">Bağlı Firmalar (${(d.firmalar||[]).length})</h2></div>
      ${firmalarHtml}

      <div class="adm-subhead" style="margin:24px 0 8px;"><h2 style="font-size:16px;">Şoför Kaydı</h2></div>
      ${surucuHtml}

      <div class="adm-modal-actions" style="flex-wrap:wrap;">
        ${isMe || isAdmin ? '' : `
          ${isBanned
            ? `<button class="adm-btn" onclick="AdmModule_kullanicilar.unban('${u.id}')"><i data-icon="check"></i> Banı Kaldır</button>`
            : `<button class="adm-btn adm-btn-danger" onclick="AdmModule_kullanicilar.banModal('${u.id}', '${T.esc(u.email||u.id)}')"><i data-icon="ban"></i> Banla</button>`}
          ${!u.email_confirmed_at ? `<button class="adm-btn" onclick="AdmModule_kullanicilar.emailConfirm('${u.id}')"><i data-icon="check-circle"></i> E-posta Doğrula</button>` : ''}
          <button class="adm-btn" onclick="AdmModule_kullanicilar.passwordReset('${u.id}', '${T.esc(u.email||'')}')"><i data-icon="key"></i> Şifre Sıfırla</button>
          <button class="adm-btn" onclick="AdmModule_kullanicilar.impersonate('${u.id}', '${T.esc(u.email||'')}')"><i data-icon="log-in"></i> Impersonate</button>
          <button class="adm-btn adm-btn-danger" onclick="AdmModule_kullanicilar.silModal('${u.id}', '${T.esc(u.email||u.id)}')"><i data-icon="trash"></i> Sil (KVKK)</button>
        `}
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;

    document.getElementById('adm-modal-body').innerHTML = html;
  }

  async function unban(userId) {
    const T = window.AdmAPI;
    if (!confirm('Banı kaldırmak istediğine emin misin?')) return;
    try {
      await T.rpc('admin_user_unban', { p_user_id: userId });
      T.toast('Ban kaldırıldı', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function banModal(userId, email) {
    const T = window.AdmAPI;
    const html = `
      <p style="font-size:13px;color:var(--adm-ink-2);margin:0 0 16px;">
        <strong>${T.esc(email)}</strong> banlanacak. Kullanıcı oturum açamayacak, mevcut oturumu da invalide olacak.
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Süre</label>
        <select id="adm-ban-sure" class="adm-input">
          <option value="1d">1 gün</option>
          <option value="7d">7 gün</option>
          <option value="30d">30 gün</option>
          <option value="90d">90 gün</option>
          <option value="" selected>Kalıcı (100 yıl)</option>
        </select>
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Neden (audit log'a yazılır)</label>
        <textarea id="adm-ban-neden" class="adm-input" placeholder="Örn: Çoklu hesap, kötü niyetli kullanım"></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_kullanicilar.banKaydet('${userId}')">Banla</button>
      </div>
    `;
    T.modalAc('Kullanıcıyı Banla', html);
  }

  async function banKaydet(userId) {
    const T = window.AdmAPI;
    const sure = document.getElementById('adm-ban-sure').value;
    const neden = document.getElementById('adm-ban-neden').value.trim() || null;
    let until = null;
    if (sure) {
      const days = parseInt(sure);
      until = new Date(Date.now() + days*86400000).toISOString();
    }
    try {
      await T.rpc('admin_user_ban', { p_user_id: userId, p_until: until, p_neden: neden });
      T.toast('Kullanıcı banlandı', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function emailConfirm(userId) {
    const T = window.AdmAPI;
    if (!confirm('E-postayı manuel olarak doğrulamak istiyor musun?')) return;
    try {
      await T.rpc('admin_user_email_confirm', { p_user_id: userId });
      T.toast('E-posta doğrulandı', 'success');
      detayAc(userId);
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function passwordReset(userId, email) {
    const T = window.AdmAPI;
    if (!confirm(`${email} için şifre sıfırlama linki üretilsin mi?`)) return;
    try {
      const r = await T.edgeFn('admin-password-reset', { target_user_id: userId });
      if (r.recovery_link) {
        // Clipboard'a kopyala + modal aç
        navigator.clipboard?.writeText(r.recovery_link).catch(() => {});
        T.modalAc('Şifre Sıfırlama Linki', `
          <p style="font-size:13px;color:var(--adm-ink-2);">
            Link üretildi (clipboard'a kopyalandı). Kullanıcıya manuel iletebilirsin:
          </p>
          <textarea readonly class="adm-input" style="width:100%;font-family:'Geist Mono',monospace;font-size:11px;min-height:80px;">${T.esc(r.recovery_link)}</textarea>
          <div class="adm-modal-actions">
            <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
          </div>
        `);
        T.toast('Link clipboard\'a kopyalandı', 'success');
      } else {
        T.toast('Link üretilemedi', 'error');
      }
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function impersonate(userId, email) {
    const T = window.AdmAPI;
    const neden = prompt(`"${email}" olarak oturum açacaksın.\nNeden? (audit log'a yazılır):`, '');
    if (neden === null) return;
    if (!confirm('UYARI: ' + email + ' kullanıcısı olarak yeni bir tab\'da oturum açılacak.\nBu işlem audit log\'a kaydedilir. Devam?')) return;
    try {
      const r = await T.edgeFn('admin-impersonate', { target_user_id: userId, neden });
      if (r.magic_link) {
        T.toast('Yeni tab açılıyor…', 'success');
        window.open(r.magic_link, '_blank');
      } else {
        T.toast('Magic link üretilemedi', 'error');
      }
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function silModal(userId, email) {
    const T = window.AdmAPI;
    const html = `
      <p style="font-size:13px;color:var(--adm-negative);margin:0 0 16px;">
        <strong>${T.esc(email)}</strong> ve bağlı tüm veriler kalıcı olarak silinecek. <strong>Geri alınamaz.</strong>
      </p>
      <p style="font-size:12px;color:var(--adm-ink-2);">KVKK uyumlu silme — auth.users + cascade tablolar (firma_kullanicilar, suruculer ilişkisi, vb.).</p>
      <div class="adm-form-group">
        <label class="adm-label">Onay metni (yazın: <code>SİL</code>)</label>
        <input type="text" id="adm-sil-onay" class="adm-input" placeholder="SİL">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Neden</label>
        <textarea id="adm-sil-neden" class="adm-input" placeholder="Kullanıcı talebi (KVKK md. 7)"></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_kullanicilar.silKaydet('${userId}')">Kalıcı Sil</button>
      </div>
    `;
    T.modalAc('Kullanıcıyı Sil (KVKK)', html);
  }

  async function silKaydet(userId) {
    const T = window.AdmAPI;
    const onay = document.getElementById('adm-sil-onay').value.trim();
    const neden = document.getElementById('adm-sil-neden').value.trim() || null;
    if (onay !== 'SİL') { T.toast('Onay metni yanlış. "SİL" yazın.', 'error'); return; }
    try {
      await T.rpc('admin_user_sil', { p_user_id: userId, p_neden: neden });
      T.toast('Kullanıcı silindi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  window.AdmModule_kullanicilar = {
    init: () => { bindFilters(); fetch(); },
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    detayAc, unban, banModal, banKaydet, emailConfirm,
    passwordReset, impersonate, silModal, silKaydet,
  };
  window.admKullanicilarYenile = fetch;
})();
