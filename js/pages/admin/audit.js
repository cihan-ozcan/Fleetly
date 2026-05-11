/* =============================================================================
 * admin/audit.js — Platform aksiyonları denetim logu
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 50;
  let _state = { page: 0, arama: '', tip: '', rows: [], toplam: 0 };

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-audit-content');
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const rows = await T.rpc('platform_audit_log_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
        p_arama: _state.arama || null,
        p_islem_tipi: _state.tip || null,
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
    const el = document.getElementById('adm-audit-content');
    if (_state.rows.length === 0) {
      el.innerHTML = '<div class="adm-empty">Log kaydı yok.</div>';
      return;
    }
    el.innerHTML = `
      <table class="adm-table">
        <thead><tr>
          <th>Zaman</th><th>Admin</th><th>İşlem</th><th>Hedef</th><th>Özet</th><th>Durum</th>
        </tr></thead>
        <tbody>
          ${_state.rows.map(r => `
            <tr ${r.detay ? `class="clickable" onclick='AdmModule_audit.detay(${JSON.stringify(r.detay).replace(/"/g, "&quot;")})'` : ''}>
              <td>
                <span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.dateTime(r.created_at))}</span>
              </td>
              <td>${T.esc(r.user_ad || r.user_email || '—')}</td>
              <td><span class="adm-badge ${r.basarili ? 'adm-badge-info' : 'adm-badge-danger'}">${T.esc(r.islem_tipi)}</span></td>
              <td>
                ${r.hedef_tip ? `<span class="muted">${T.esc(r.hedef_tip)}</span>` : '<span class="muted">—</span>'}
                ${r.hedef_id ? `<br><span style="font-family:'Geist Mono',monospace;font-size:10px;color:var(--adm-ink-3);">${T.esc(r.hedef_id.slice(0, 12))}…</span>` : ''}
              </td>
              <td>${T.esc(r.ozet || '—')}</td>
              <td>
                ${r.basarili
                  ? '<span class="pos"><i data-icon="check"></i></span>'
                  : '<span class="neg" title="' + T.esc(r.hata_mesaji || '') + '"><i data-icon="x"></i></span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="adm-pagination">
        <span class="adm-pagination-info">
          ${_state.page * PAGE_SIZE + 1}–${Math.min((_state.page+1) * PAGE_SIZE, _state.toplam)} / ${_state.toplam}
        </span>
        <div class="adm-pagination-controls">
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_audit.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_audit.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  function detay(detayObj) {
    const T = window.AdmAPI;
    const html = `
      <pre style="background:var(--adm-paper-2);padding:16px;font-family:'Geist Mono',monospace;font-size:11.5px;border:1px solid var(--adm-hairline);max-height:400px;overflow:auto;">${T.esc(JSON.stringify(detayObj, null, 2))}</pre>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;
    T.modalAc('Audit Detay', html);
  }

  function bindFilters() {
    const sInput = document.getElementById('adm-audit-search');
    const tSelect = document.getElementById('adm-audit-tip');
    let _t = null;
    sInput?.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _state.arama = sInput.value.trim(); _state.page = 0; fetch(); }, 300);
    });
    tSelect?.addEventListener('change', () => { _state.tip = tSelect.value; _state.page = 0; fetch(); });
  }

  window.AdmModule_audit = {
    init: () => { bindFilters(); fetch(); },
    onShow: fetch,
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    detay,
  };
  window.admAuditYenile = fetch;
})();
