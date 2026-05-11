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
          <th>Son Giriş</th><th>Kayıt</th><th>Durum</th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => {
            const tipBadge = r.tip === 'ofis'
              ? '<span class="adm-badge adm-badge-info">Ofis</span>'
              : r.tip === 'surucu'
                ? '<span class="adm-badge">Şoför</span>'
                : '<span class="muted">—</span>';
            const aktif = r.aktif
              ? '<span class="adm-badge adm-badge-success">Aktif</span>'
              : '<span class="adm-badge adm-badge-danger">Pasif</span>';
            return `
              <tr>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(r.email || '—')}</span></td>
                <td>${tipBadge}</td>
                <td>${T.esc(r.ad_soyad || '—')}</td>
                <td>${T.esc(r.firma_ad || '—')}</td>
                <td>${r.rol ? '<span class="adm-badge adm-badge-info">' + T.esc(r.rol) + '</span>' : '<span class="muted">—</span>'}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(r.son_giris))}</span></td>
                <td><span style="font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.date(r.kayit_tarihi))}</span></td>
                <td>${aktif}</td>
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

  window.AdmModule_kullanicilar = {
    init: () => { bindFilters(); fetch(); },
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
  };
  window.admKullanicilarYenile = fetch;
})();
