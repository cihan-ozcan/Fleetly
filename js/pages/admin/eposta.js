/* =============================================================================
 * admin/eposta.js — Toplu e-posta kampanyası
 * ===========================================================================*/

(function () {
  'use strict';

  let _adayPreview = null;

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-eposta-content');
    if (!el) return;

    el.innerHTML = `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 01</span>Toplu E-posta Kampanyası</h2>
      </div>

      <div style="border:1px solid var(--adm-hairline);padding:24px;margin-bottom:24px;">
        <p style="font-size:13px;color:var(--adm-ink-2);margin-top:0;">
          Filtreyle hedef kitle seç, e-posta konusu ve HTML içeriği gir, gönder.
          Resend üzerinden iletilir; her gönderim audit log'a kaydedilir.
        </p>

        <div class="adm-form-row" style="margin-top:18px;">
          <div class="adm-form-group">
            <label class="adm-label">Alıcı Tipi</label>
            <select id="adm-em-tip" class="adm-input">
              <option value="ofis">Sadece Ofis Kullanıcıları</option>
              <option value="surucu">Sadece Şoförler</option>
              <option value="hepsi">Tümü (Ofis + Şoför)</option>
            </select>
          </div>
          <div class="adm-form-group">
            <label class="adm-label">Abonelik Durumu Filtresi</label>
            <select id="adm-em-durum" class="adm-input" multiple style="min-height:90px;">
              <option value="aktif" selected>Aktif</option>
              <option value="deneme" selected>Deneme</option>
              <option value="suresi_dolmus">Süresi Dolmuş</option>
              <option value="odeme_bekliyor">Ödeme Bekliyor</option>
              <option value="iptal">İptal</option>
            </select>
            <div style="font-size:11px;color:var(--adm-ink-3);margin-top:4px;">
              Ctrl/Cmd ile çoklu seç; boş bırakırsan tüm durumlar.
            </div>
          </div>
        </div>

        <div class="adm-form-group">
          <label class="adm-label">Konu</label>
          <input type="text" id="adm-em-konu" class="adm-input" placeholder="Fleetly v3.0 yayınlandı">
        </div>

        <div class="adm-form-group">
          <label class="adm-label">HTML İçerik</label>
          <textarea id="adm-em-html" class="adm-input" style="min-height:240px;font-family:'Geist Mono',monospace;font-size:11.5px;"
                    placeholder="<h1>Merhaba,</h1><p>Yeni özellikler...</p><p><a href='https://fleetly.fit'>Giriş yap</a></p>"></textarea>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">
          <button class="adm-btn adm-btn-ghost" onclick="AdmModule_eposta.onizle()">
            <i data-icon="eye"></i> Önizle
          </button>
          <button class="adm-btn adm-btn-ghost" onclick="AdmModule_eposta.aliciSay()">
            <i data-icon="users"></i> Alıcı Sayısını Tahmin Et
          </button>
          <div style="flex:1;"></div>
          <button class="adm-btn adm-btn-primary" onclick="AdmModule_eposta.gonder()">
            <i data-icon="send"></i> Gönder
          </button>
        </div>
      </div>

      <!-- SON KAMPANYALAR -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 02</span>Son Kampanyalar</h2>
        <span class="meta">Audit log'tan</span>
      </div>
      <div id="adm-eposta-tarihce"><div class="adm-empty">Yükleniyor…</div></div>
    `;

    fetchTarihce();
  }

  function selectedDurumlar() {
    const sel = document.getElementById('adm-em-durum');
    if (!sel) return [];
    return Array.from(sel.selectedOptions).map(o => o.value);
  }

  function topla() {
    const tip = document.getElementById('adm-em-tip').value;
    const durumlar = selectedDurumlar();
    const konu = document.getElementById('adm-em-konu').value.trim();
    const html = document.getElementById('adm-em-html').value;
    const filtre = { tip };
    if (durumlar.length > 0) filtre.abonelik_durumu = durumlar;
    return { konu, html, filtre };
  }

  function onizle() {
    const T = window.AdmAPI;
    const { konu, html } = topla();
    if (!konu || !html) { T.toast('Konu ve içerik gerekli', 'error'); return; }
    const ozet = `
      <p style="font-size:12px;color:var(--adm-ink-3);margin-top:0;">
        Bu, alıcının e-posta istemcisinde nasıl görüneceğini gösterir (yaklaşık).
      </p>
      <div style="background:white;color:#15181c;border:1px solid var(--adm-hairline);">
        <div style="padding:12px 16px;border-bottom:1px solid var(--adm-hairline-2);font-size:11.5px;color:var(--adm-ink-2);">
          <strong>Konu:</strong> ${T.esc(konu)}
        </div>
        <div style="padding:18px 20px;font-family:system-ui,-apple-system,sans-serif;">
          ${html}
        </div>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;
    T.modalAc('E-posta Önizleme', ozet);
  }

  async function aliciSay() {
    const T = window.AdmAPI;
    const { filtre } = topla();
    T.toast('Alıcı sayısı hesaplanıyor…', 'info');
    // Basit yaklaşım: edge function'a "saysana?" ile sor (henüz endpoint yok)
    // Şimdilik kaba tahmin: kullanıcı listesini çek (büyük listede yavaş olabilir)
    try {
      let count = 0;
      if (filtre.tip === 'ofis' || filtre.tip === 'hepsi') {
        // Toplam ofis kullanıcısı sayısı (RPC olmadığı için kaba)
        const r = await window.fetch(
          T.sbUrl('firma_kullanicilar?select=user_id'),
          { headers: { ...T.sbHeaders(), 'Prefer': 'count=exact', 'Range': '0-0' } }
        );
        const total = parseInt((r.headers.get('content-range') || '0/0').split('/')[1]) || 0;
        count += total;
      }
      if (filtre.tip === 'surucu' || filtre.tip === 'hepsi') {
        const r = await window.fetch(
          T.sbUrl("suruculer?email=not.is.null&durum=neq.silindi&select=id"),
          { headers: { ...T.sbHeaders(), 'Prefer': 'count=exact', 'Range': '0-0' } }
        );
        const total = parseInt((r.headers.get('content-range') || '0/0').split('/')[1]) || 0;
        count += total;
      }
      T.toast(`Tahmini alıcı sayısı: ~${count} (filtre öncesi)`, 'info');
    } catch (err) {
      T.toast('Hesaplanamadı: ' + err.message, 'error');
    }
  }

  async function gonder() {
    const T = window.AdmAPI;
    const { konu, html, filtre } = topla();
    if (!konu || !html) { T.toast('Konu ve içerik gerekli', 'error'); return; }
    if (!confirm(`Toplu e-posta gönderilecek.\n\nKonu: ${konu}\nFiltre: ${JSON.stringify(filtre)}\n\nDevam edilsin mi?`)) return;

    T.toast('Gönderiliyor… Bu birkaç dakika sürebilir.', 'info');
    try {
      const r = await T.edgeFn('admin-toplu-email', { konu, html, filtre });
      T.toast(`✓ Gönderildi: ${r.gonderildi}/${r.alici_sayisi} (${r.basarisiz} hata)`, 'success');
      // Tarihçeyi yenile
      fetchTarihce();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  async function fetchTarihce() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-eposta-tarihce');
    try {
      const rows = await T.rpc('platform_audit_log_listele', {
        p_limit: 20, p_offset: 0, p_islem_tipi: 'toplu_email',
      });
      if (!rows || rows.length === 0) {
        el.innerHTML = '<div class="adm-empty">Henüz toplu e-posta gönderilmedi.</div>';
        return;
      }
      el.innerHTML = `
        <table class="adm-table">
          <thead><tr>
            <th>Tarih</th><th>Admin</th><th>Konu</th><th class="r">Alıcı</th><th class="r">Başarılı</th><th class="r">Hata</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.dateTime(r.created_at))}</span></td>
                <td>${T.esc(r.user_email || '—')}</td>
                <td>${T.esc(r.detay?.konu || r.ozet)}</td>
                <td class="r">${T.fmt.num(r.detay?.alici_sayisi)}</td>
                <td class="r pos">${T.fmt.num(r.detay?.gonderildi)}</td>
                <td class="r ${(r.detay?.basarisiz||0) > 0 ? 'neg' : ''}">${T.fmt.num(r.detay?.basarisiz)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Tarihçe yüklenemedi.</div>';
    }
  }

  window.AdmModule_eposta = {
    init: render,
    onShow: render,
    onizle, aliciSay, gonder,
  };
})();
