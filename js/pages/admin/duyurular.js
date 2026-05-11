/* =============================================================================
 * admin/duyurular.js — Platform duyuruları listele + oluştur + sil
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 30;
  let _state = { page: 0, rows: [], toplam: 0 };

  const TIP_BADGE = {
    'bilgi':         '<span class="adm-badge adm-badge-info">Bilgi</span>',
    'uyari':         '<span class="adm-badge adm-badge-warning">Uyarı</span>',
    'bakim':         '<span class="adm-badge adm-badge-danger">Bakım</span>',
    'yeni_ozellik':  '<span class="adm-badge adm-badge-success">Yeni Özellik</span>',
    'kampanya':      '<span class="adm-badge adm-badge-fill">Kampanya</span>',
  };

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-duyurular-content');
    if (!el) return;
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const rows = await T.rpc('admin_duyurular_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
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
    const el = document.getElementById('adm-duyurular-content');
    if (_state.rows.length === 0) {
      el.innerHTML = '<div class="adm-empty">Henüz duyuru yok. + Yeni Duyuru ile başla.</div>';
      return;
    }
    el.innerHTML = `
      <table class="adm-table">
        <thead><tr>
          <th>Başlık</th>
          <th>Tip</th>
          <th>Hedef</th>
          <th>Geçerlilik</th>
          <th class="r">Kapatan</th>
          <th>Durum</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => {
            const hedef = r.hedef_filtre
              ? (r.hedef_filtre.firma_id ? r.hedef_filtre.firma_id.length + ' firma seçili'
                : r.hedef_filtre.abonelik_durumu ? 'Plan: ' + r.hedef_filtre.abonelik_durumu.join(', ')
                : 'Filtreli')
              : '<span style="color:var(--adm-positive);">Tüm firmalar</span>';
            const gecerlilik = T.fmt.date(r.baslangic) + (r.bitis ? ' → ' + T.fmt.date(r.bitis) : ' → süresiz');
            const aktifBadge = r.aktif
              ? '<span class="adm-badge adm-badge-success">Aktif</span>'
              : '<span class="adm-badge">Pasif</span>';
            return `
              <tr>
                <td><strong>${T.esc(r.baslik)}</strong>
                  <div style="font-size:11px;color:var(--adm-ink-2);margin-top:2px;">${T.esc((r.icerik||'').slice(0,80))}${(r.icerik||'').length > 80 ? '…' : ''}</div>
                </td>
                <td>${TIP_BADGE[r.tip] || T.esc(r.tip)}</td>
                <td><span style="font-size:11.5px;">${hedef}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${gecerlilik}</span></td>
                <td class="r">${T.fmt.num(r.okundu_sayisi)}</td>
                <td>${aktifBadge}</td>
                <td>
                  <div style="display:flex;gap:4px;">
                    ${r.aktif
                      ? `<button class="adm-icon-btn" title="Durdur" onclick="AdmModule_duyurular.aktiflik('${r.id}', false)"><i data-icon="ban"></i></button>`
                      : `<button class="adm-icon-btn" title="Aktifleştir" onclick="AdmModule_duyurular.aktiflik('${r.id}', true)"><i data-icon="check"></i></button>`}
                    <button class="adm-icon-btn" title="Sil" onclick="AdmModule_duyurular.sil('${r.id}', '${T.esc(r.baslik)}')"><i data-icon="trash"></i></button>
                  </div>
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
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_duyurular.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_duyurular.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  function yeniModal() {
    const T = window.AdmAPI;
    const today = new Date().toISOString().slice(0,16);
    const html = `
      <p style="font-size:13px;color:var(--adm-ink-2);margin-top:0;">
        Tüm aktif firmalara veya filtreli hedef kitleye duyuru gönder.
      </p>

      <div class="adm-form-group">
        <label class="adm-label">Başlık</label>
        <input type="text" id="adm-du-baslik" class="adm-input" placeholder="Örn: Sistem v3.0 yayınlandı">
      </div>
      <div class="adm-form-group">
        <label class="adm-label">İçerik (Markdown destekli)</label>
        <textarea id="adm-du-icerik" class="adm-input" style="min-height:120px;" placeholder="Yeni dashboard, daha hızlı raporlar..."></textarea>
      </div>

      <div class="adm-form-row">
        <div class="adm-form-group">
          <label class="adm-label">Tip</label>
          <select id="adm-du-tip" class="adm-input">
            <option value="bilgi">Bilgi</option>
            <option value="uyari">Uyarı</option>
            <option value="bakim">Bakım</option>
            <option value="yeni_ozellik">Yeni Özellik</option>
            <option value="kampanya">Kampanya</option>
          </select>
        </div>
        <div class="adm-form-group">
          <label class="adm-label">Kapatılabilir mi?</label>
          <select id="adm-du-kapatilabilir" class="adm-input">
            <option value="true">Evet — kullanıcı dismiss edebilir</option>
            <option value="false">Hayır — sabit (kritik)</option>
          </select>
        </div>
      </div>

      <div class="adm-form-row">
        <div class="adm-form-group">
          <label class="adm-label">Başlangıç</label>
          <input type="datetime-local" id="adm-du-baslangic" class="adm-input" value="${today}">
        </div>
        <div class="adm-form-group">
          <label class="adm-label">Bitiş (opsiyonel)</label>
          <input type="datetime-local" id="adm-du-bitis" class="adm-input">
        </div>
      </div>

      <div class="adm-form-group">
        <label class="adm-label">Hedef</label>
        <select id="adm-du-hedef" class="adm-input">
          <option value="">Tüm aktif firmalar</option>
          <option value="aktif">Sadece aktif aboneliği olanlar</option>
          <option value="deneme">Sadece deneme süresindekiler</option>
          <option value="suresi_dolmus">Süresi dolmuş aboneler</option>
          <option value="odeme_bekliyor">Ödeme bekleyenler</option>
        </select>
      </div>

      <div class="adm-form-row">
        <div class="adm-form-group">
          <label class="adm-label">Link (opsiyonel)</label>
          <input type="url" id="adm-du-link" class="adm-input" placeholder="https://fleetly.fit/...">
        </div>
        <div class="adm-form-group">
          <label class="adm-label">Link metni</label>
          <input type="text" id="adm-du-link-text" class="adm-input" placeholder="Detay">
        </div>
      </div>

      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_duyurular.yeniKaydet()">
          <i data-icon="megaphone"></i> Yayınla
        </button>
      </div>
    `;
    T.modalAc('Yeni Duyuru', html);
  }

  async function yeniKaydet() {
    const T = window.AdmAPI;
    const baslik = document.getElementById('adm-du-baslik').value.trim();
    const icerik = document.getElementById('adm-du-icerik').value.trim();
    const tip = document.getElementById('adm-du-tip').value;
    const kapatilabilir = document.getElementById('adm-du-kapatilabilir').value === 'true';
    const baslangic = document.getElementById('adm-du-baslangic').value;
    const bitis = document.getElementById('adm-du-bitis').value || null;
    const hedef = document.getElementById('adm-du-hedef').value || null;
    const link = document.getElementById('adm-du-link').value.trim() || null;
    const linkText = document.getElementById('adm-du-link-text').value.trim() || null;

    if (!baslik || !icerik) {
      T.toast('Başlık ve içerik gerekli', 'error');
      return;
    }

    const hedefFiltre = hedef ? { abonelik_durumu: [hedef] } : null;

    try {
      await T.rpc('admin_duyuru_olustur', {
        p_baslik: baslik,
        p_icerik: icerik,
        p_tip: tip,
        p_hedef_filtre: hedefFiltre,
        p_baslangic: baslangic ? new Date(baslangic).toISOString() : new Date().toISOString(),
        p_bitis: bitis ? new Date(bitis).toISOString() : null,
        p_kapatilabilir: kapatilabilir,
        p_link_url: link,
        p_link_text: linkText,
      });
      T.toast('Duyuru yayınlandı', 'success');
      T.modalKapat();
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  async function aktiflik(id, aktif) {
    const T = window.AdmAPI;
    try {
      await T.rpc('admin_duyuru_aktiflik', { p_id: id, p_aktif: aktif });
      T.toast(aktif ? 'Duyuru aktif' : 'Duyuru durduruldu', 'success');
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function sil(id, baslik) {
    const T = window.AdmAPI;
    if (!confirm(`"${baslik}" duyurusunu silmek istiyor musun?`)) return;
    try {
      await T.rpc('admin_duyuru_sil', { p_id: id });
      T.toast('Duyuru silindi', 'success');
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function bindButtons() {
    document.getElementById('adm-duyuru-yeni')?.addEventListener('click', yeniModal);
  }

  window.AdmModule_duyurular = {
    init: () => { bindButtons(); fetch(); },
    onShow: fetch,
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    yeniModal, yeniKaydet, aktiflik, sil,
  };
  window.admDuyurularYenile = fetch;
})();
