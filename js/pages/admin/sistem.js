/* =============================================================================
 * admin/sistem.js — Bakım Modu + CMS + Sistem Ayarları
 * ===========================================================================*/

(function () {
  'use strict';

  let _ayarlar = {};
  let _icerikler = [];

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-sistem-content');
    if (!el) return;
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const [ayarlarRes, icerikRes] = await Promise.all([
        T.rpc('admin_ayarlari_listele'),
        window.fetch(
          T.sbUrl('sistem_icerikleri?select=*&order=kod.asc'),
          { headers: T.sbHeaders() }
        ).then(r => r.json()),
      ]);
      _ayarlar = {};
      (ayarlarRes || []).forEach(a => { _ayarlar[a.anahtar] = a; });
      _icerikler = icerikRes || [];
      render();
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-sistem-content');

    const bakim = _ayarlar['bakim_modu_aktif']?.deger === true;
    const bakimMesaj = _ayarlar['bakim_modu_mesaj']?.deger || '';
    const bakimBaslama = _ayarlar['bakim_modu_baslama']?.deger || null;
    const bakimBitis = _ayarlar['bakim_modu_bitis']?.deger || null;
    const kayitAcik = _ayarlar['kayit_acik']?.deger !== false;

    el.innerHTML = `
      <!-- BAKIM MODU -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 01</span>Bakım Modu</h2>
        <span class="meta">${bakim ? 'AKTİF' : 'Pasif'}</span>
      </div>

      <div style="border:1px solid ${bakim ? 'var(--adm-negative)' : 'var(--adm-hairline)'};
                  padding:18px 20px;margin-bottom:30px;
                  background:${bakim ? 'rgba(168,57,44,0.06)' : 'transparent'};">

        <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:14px;">
          <div>
            <div style="font-family:Newsreader,serif;font-size:18px;color:${bakim ? 'var(--adm-negative)' : 'var(--adm-ink)'};margin-bottom:4px;">
              ${bakim ? 'Sistem bakım modunda' : 'Sistem normal çalışıyor'}
            </div>
            <div style="font-size:12px;color:var(--adm-ink-2);">
              Bakım modu aktifken tüm yazma işlemleri engellenir (sadece SELECT serbest).
              Platform admin'ler bypass eder.
            </div>
          </div>
          ${bakim
            ? `<button class="adm-btn" onclick="AdmModule_sistem.bakimKapat()"><i data-icon="check"></i> Bakım Modunu Kapat</button>`
            : `<button class="adm-btn adm-btn-danger" onclick="AdmModule_sistem.bakimAcModal()"><i data-icon="alert-triangle"></i> Bakım Modunu Aç</button>`}
        </div>

        ${bakim ? `
          <div class="adm-detail-row" style="padding:6px 0;">
            <div class="adm-detail-key">Mesaj</div>
            <div class="adm-detail-val">${T.esc(bakimMesaj)}</div>
          </div>
          ${bakimBaslama ? `
            <div class="adm-detail-row" style="padding:6px 0;">
              <div class="adm-detail-key">Başlama</div>
              <div class="adm-detail-val mono">${T.esc(T.fmt.dateTime(bakimBaslama))}</div>
            </div>
          ` : ''}
          ${bakimBitis ? `
            <div class="adm-detail-row" style="padding:6px 0;">
              <div class="adm-detail-key">Tahmini Bitiş</div>
              <div class="adm-detail-val mono">${T.esc(T.fmt.dateTime(bakimBitis))}</div>
            </div>
          ` : ''}
        ` : ''}
      </div>

      <!-- CMS -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 02</span>CMS · Statik İçerikler</h2>
        <span class="meta">${_icerikler.length} içerik</span>
      </div>

      <table class="adm-table" style="margin-bottom:30px;">
        <thead><tr>
          <th>Kod</th><th>Başlık</th><th class="r">Versiyon</th><th>Son Güncelleme</th><th></th>
        </tr></thead>
        <tbody>
          ${_icerikler.map(i => `
            <tr>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(i.kod)}</span></td>
              <td><strong>${T.esc(i.baslik)}</strong>
                <div style="font-size:11px;color:var(--adm-ink-2);margin-top:2px;">
                  ${i.icerik_html ? T.esc(i.icerik_html.replace(/<[^>]*>/g, '').slice(0,80)) + '…' : '<span class="muted">İçerik boş</span>'}
                </div>
              </td>
              <td class="r">${T.fmt.num(i.versiyon)}</td>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(i.son_guncelleme))}</span></td>
              <td>
                <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_sistem.icerikDuzenle('${T.esc(i.kod)}')">
                  <i data-icon="edit"></i> Düzenle
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- KAYIT AÇIK / KAPALI -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 03</span>Kayıt Durumu</h2>
      </div>
      <div style="border:1px solid var(--adm-hairline);padding:18px 20px;margin-bottom:30px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:20px;">
          <div>
            <div style="font-family:Newsreader,serif;font-size:16px;margin-bottom:4px;">
              Yeni firma kaydı ${kayitAcik ? 'açık' : 'kapalı'}
            </div>
            <div style="font-size:12px;color:var(--adm-ink-2);">
              ${kayitAcik
                ? 'Yeni kullanıcılar register.html üzerinden firma kaydı yapabilir.'
                : 'Yeni kayıtlar engellendi. Mevcut kullanıcılar etkilenmez.'}
            </div>
          </div>
          <button class="adm-btn ${kayitAcik ? 'adm-btn-danger' : ''}" onclick="AdmModule_sistem.kayitToggle(${!kayitAcik})">
            ${kayitAcik ? 'Kaydı Kapat' : 'Kaydı Aç'}
          </button>
        </div>
      </div>

      <!-- TÜM AYARLAR -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 04</span>Tüm Sistem Ayarları</h2>
        <span class="meta">${Object.keys(_ayarlar).length} anahtar</span>
      </div>

      <table class="adm-table">
        <thead><tr>
          <th>Anahtar</th><th>Değer</th><th>Açıklama</th><th>Son Güncelleme</th><th></th>
        </tr></thead>
        <tbody>
          ${Object.values(_ayarlar).map(a => `
            <tr>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(a.anahtar)}</span></td>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-positive);">${T.esc(JSON.stringify(a.deger))}</span></td>
              <td><span style="font-size:11.5px;color:var(--adm-ink-2);">${T.esc(a.aciklama || '—')}</span></td>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.relative(a.guncelleme_at))}</span></td>
              <td>
                <button class="adm-icon-btn" title="Düzenle" onclick="AdmModule_sistem.ayarDuzenle('${T.esc(a.anahtar)}')">
                  <i data-icon="edit"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ── Bakım Modu Aç ──
  function bakimAcModal() {
    const T = window.AdmAPI;
    const html = `
      <p style="font-size:13px;color:var(--adm-negative);margin:0 0 16px;">
        <strong>⚠ DİKKAT:</strong> Bakım modu açıldığında <strong>tüm firma kullanıcıları</strong>
        yazma yapamayacak. Sadece okuma (görüntüleme) çalışacak. Sen (platform admin) etkilenmezsin.
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Kullanıcılara gösterilecek mesaj</label>
        <textarea id="adm-bm-mesaj" class="adm-input" style="min-height:80px;">${T.esc(_ayarlar['bakim_modu_mesaj']?.deger || 'Sistem bakımdadır, kısa süre içinde dönecektir.')}</textarea>
      </div>
      <div class="adm-form-row">
        <div class="adm-form-group">
          <label class="adm-label">Başlama Zamanı (opsiyonel)</label>
          <input type="datetime-local" id="adm-bm-baslama" class="adm-input">
        </div>
        <div class="adm-form-group">
          <label class="adm-label">Tahmini Bitiş (opsiyonel)</label>
          <input type="datetime-local" id="adm-bm-bitis" class="adm-input">
        </div>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-danger" onclick="AdmModule_sistem.bakimAcKaydet()">
          <i data-icon="alert-triangle"></i> Bakım Modunu Aç
        </button>
      </div>
    `;
    T.modalAc('Bakım Modunu Aç', html);
  }

  async function bakimAcKaydet() {
    const T = window.AdmAPI;
    const mesaj = document.getElementById('adm-bm-mesaj').value.trim();
    const baslama = document.getElementById('adm-bm-baslama').value;
    const bitis = document.getElementById('adm-bm-bitis').value;
    try {
      await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_aktif', p_deger: true });
      await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_mesaj', p_deger: mesaj });
      if (baslama) await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_baslama', p_deger: new Date(baslama).toISOString() });
      else await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_baslama', p_deger: null });
      if (bitis) await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_bitis', p_deger: new Date(bitis).toISOString() });
      else await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_bitis', p_deger: null });
      T.toast('Bakım modu aktif', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function bakimKapat() {
    const T = window.AdmAPI;
    if (!confirm('Bakım modunu kapatmak istiyor musun?')) return;
    try {
      await T.rpc('admin_ayar_set', { p_anahtar: 'bakim_modu_aktif', p_deger: false });
      T.toast('Bakım modu kapatıldı', 'success');
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function kayitToggle(yeniDurum) {
    const T = window.AdmAPI;
    try {
      await T.rpc('admin_ayar_set', { p_anahtar: 'kayit_acik', p_deger: yeniDurum });
      T.toast('Kayıt ' + (yeniDurum ? 'açıldı' : 'kapatıldı'), 'success');
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  // ── CMS Düzenleme ──
  function icerikDuzenle(kod) {
    const T = window.AdmAPI;
    const item = _icerikler.find(i => i.kod === kod);
    if (!item) return;
    const html = `
      <p style="font-size:12px;color:var(--adm-ink-3);margin-top:0;">
        Kod: <span style="font-family:'Geist Mono',monospace;">${T.esc(item.kod)}</span> ·
        Versiyon: ${item.versiyon}
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Başlık</label>
        <input type="text" id="adm-cms-baslik" class="adm-input" value="${T.esc(item.baslik)}">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">İçerik (HTML)</label>
        <textarea id="adm-cms-html" class="adm-input" style="min-height:280px;font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(item.icerik_html || '')}</textarea>
      </div>
      <p style="font-size:11px;color:var(--adm-ink-3);margin:-8px 0 16px;">
        HTML etiketleri destekli (h1-h6, p, ul, ol, li, strong, em, a, br). Editörü harici bir kaynaktan kopyalayıp yapıştırabilirsin.
      </p>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_sistem.icerikKaydet('${T.esc(kod)}')">
          <i data-icon="save"></i> Kaydet
        </button>
      </div>
    `;
    T.modalAc(item.baslik + ' — Düzenle', html);
  }

  async function icerikKaydet(kod) {
    const T = window.AdmAPI;
    const baslik = document.getElementById('adm-cms-baslik').value.trim();
    const html = document.getElementById('adm-cms-html').value;
    if (!baslik) { T.toast('Başlık gerekli', 'error'); return; }
    try {
      await T.rpc('admin_icerik_kaydet', {
        p_kod: kod,
        p_baslik: baslik,
        p_icerik_html: html,
      });
      T.toast('İçerik kaydedildi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  // ── Ayar Düzenle ──
  function ayarDuzenle(anahtar) {
    const T = window.AdmAPI;
    const item = _ayarlar[anahtar];
    if (!item) return;
    const html = `
      <p style="font-size:12px;color:var(--adm-ink-3);margin-top:0;">
        Anahtar: <span style="font-family:'Geist Mono',monospace;">${T.esc(anahtar)}</span>
      </p>
      <div class="adm-form-group">
        <label class="adm-label">Açıklama</label>
        <div style="font-size:13px;color:var(--adm-ink-2);">${T.esc(item.aciklama || '—')}</div>
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Değer (JSON)</label>
        <textarea id="adm-ay-deger" class="adm-input" style="min-height:100px;font-family:'Geist Mono',monospace;font-size:12px;">${T.esc(JSON.stringify(item.deger, null, 2))}</textarea>
      </div>
      <p style="font-size:11px;color:var(--adm-ink-3);margin:-8px 0 16px;">
        Geçerli JSON gir. Örnek: <code>true</code>, <code>"metin"</code>, <code>123</code>, <code>{"a":1}</code>
      </p>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_sistem.ayarKaydet('${T.esc(anahtar)}')">
          <i data-icon="save"></i> Kaydet
        </button>
      </div>
    `;
    T.modalAc('Ayar: ' + anahtar, html);
  }

  async function ayarKaydet(anahtar) {
    const T = window.AdmAPI;
    const deger = document.getElementById('adm-ay-deger').value;
    let parsed;
    try { parsed = JSON.parse(deger); }
    catch (e) { T.toast('Geçersiz JSON: ' + e.message, 'error'); return; }
    try {
      await T.rpc('admin_ayar_set', { p_anahtar: anahtar, p_deger: parsed });
      T.toast('Ayar kaydedildi', 'success');
      T.modalKapat();
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  window.AdmModule_sistem = {
    init: fetch,
    onShow: fetch,
    bakimAcModal, bakimAcKaydet, bakimKapat, kayitToggle,
    icerikDuzenle, icerikKaydet,
    ayarDuzenle, ayarKaydet,
  };
})();
