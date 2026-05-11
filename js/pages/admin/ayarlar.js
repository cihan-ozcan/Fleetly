/* =============================================================================
 * admin/ayarlar.js — Platform admin listesi + sistem ayarları
 * ===========================================================================*/

(function () {
  'use strict';

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-ayarlar-content');
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const adminler = await T.rpc('platform_adminler_listele');
      render(adminler);
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function render(adminler) {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-ayarlar-content');
    const me = T.user();

    el.innerHTML = `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 01</span>Platform Adminler</h2>
        <button class="adm-btn adm-btn-ghost" onclick="AdmModule_ayarlar.adminEkleModal()">
          <i data-icon="user-plus"></i> Yeni Admin
        </button>
      </div>

      <table class="adm-table">
        <thead><tr>
          <th>E-posta</th><th>Ad Soyad</th><th>Durum</th><th>Eklenme</th><th>Notlar</th><th></th>
        </tr></thead>
        <tbody>
          ${(adminler || []).map(a => `
            <tr>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(a.email || '—')}</span>
                ${a.user_id === me.id ? '<span class="adm-badge adm-badge-fill" style="margin-left:6px;">SİZ</span>' : ''}
              </td>
              <td>${T.esc(a.ad_soyad || '—')}</td>
              <td>${a.aktif ? '<span class="adm-badge adm-badge-success">Aktif</span>' : '<span class="adm-badge adm-badge-danger">Pasif</span>'}</td>
              <td><span style="font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.dateTime(a.eklenme_tarihi))}</span></td>
              <td><span class="muted">${T.esc(a.notlar || '—')}</span></td>
              <td>
                ${a.user_id === me.id
                  ? '<span class="muted">—</span>'
                  : a.aktif
                    ? `<button class="adm-btn adm-btn-danger adm-btn-small" onclick="AdmModule_ayarlar.adminKaldir('${a.user_id}', '${T.esc(a.email || a.user_id)}')">Kaldır</button>`
                    : '<span class="muted">Pasif</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="adm-subhead" style="margin-top:40px;">
        <h2><span class="adm-num-prefix">§ 02</span>Sistem Bilgisi</h2>
      </div>

      <div class="adm-detail-row">
        <div class="adm-detail-key">Sürüm</div>
        <div class="adm-detail-val mono">Fleetly Platform Admin v1.0</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Supabase</div>
        <div class="adm-detail-val mono">${T.esc((window.FILO_CONFIG?.SUPABASE_URL || '').replace(/^https?:\/\//, ''))}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Build</div>
        <div class="adm-detail-val mono">${T.esc(new Date().toISOString().slice(0,10))}</div>
      </div>
    `;
  }

  function adminEkleModal() {
    const T = window.AdmAPI;
    const html = `
      <p style="font-size:13px;color:var(--adm-ink-2);margin-top:0;">
        Yeni platform admin ekle. Kullanıcının önce normal kayıt olmuş olması gerek
        (auth.users içinde olmalı). E-posta yerine doğrudan user_id (UUID) kullan.
      </p>
      <div class="adm-form-group">
        <label class="adm-label">E-posta</label>
        <input type="email" id="adm-admin-email" class="adm-input" placeholder="ornek@fleetly.fit">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Ad Soyad</label>
        <input type="text" id="adm-admin-ad" class="adm-input" placeholder="Cihan Özcan">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Notlar</label>
        <textarea id="adm-admin-not" class="adm-input"></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_ayarlar.adminEkleKaydet()">Ekle</button>
      </div>
    `;
    T.modalAc('Yeni Platform Admin', html);
  }

  async function adminEkleKaydet() {
    const T = window.AdmAPI;
    const email = document.getElementById('adm-admin-email').value.trim();
    const ad = document.getElementById('adm-admin-ad').value.trim();
    const not = document.getElementById('adm-admin-not').value.trim() || null;
    if (!email) { T.toast('E-posta gerekli', 'error'); return; }

    try {
      // Önce email'den user_id bul (auth.users sorgusu için ayrı RPC gerek olur)
      // Şimdilik direct REST ile auth schema'ya erişim yok. Kullanıcıya user_id gir desinler veya
      // RPC eklemek için bir migration daha gerek.
      // Pratik: önce mevcut auth.users tablosunda email ile sorgu yap (admin API yetkisi gerekli).
      // Çözüm: yeni RPC: admin_user_lookup_by_email
      const lookup = await T.rpc('admin_user_lookup_by_email', { p_email: email }).catch(() => null);
      if (!lookup) {
        T.toast('Bu e-postaya sahip kullanıcı bulunamadı veya RPC eksik. Önce kullanıcının kayıt olması gerekir.', 'error');
        return;
      }
      await T.rpc('platform_admin_ekle', {
        p_user_id: lookup,
        p_ad_soyad: ad || null,
        p_notlar: not,
      });
      T.toast('Platform admin eklendi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  async function adminKaldir(userId, email) {
    const T = window.AdmAPI;
    if (!confirm(`"${email}" platform admin yetkisini kaldırmak istiyor musun?`)) return;
    try {
      await T.rpc('platform_admin_kaldir', { p_user_id: userId });
      T.toast('Admin kaldırıldı', 'success');
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  window.AdmModule_ayarlar = {
    init: fetch,
    onShow: fetch,
    adminEkleModal, adminEkleKaydet, adminKaldir,
  };
})();
