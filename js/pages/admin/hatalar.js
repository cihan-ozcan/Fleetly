/* =============================================================================
 * admin/hatalar.js — App errors yönetimi (web/android frontend hata logu)
 * ===========================================================================*/

(function () {
  'use strict';

  const PAGE_SIZE = 30;
  let _state = {
    page: 0,
    arama: '',
    severity: '',
    platform: '',
    resolved: 'false',
    sonGun: 7,
    rows: [],
    toplam: 0,
    secili: new Set(),
  };
  let _ozet = null;

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-hatalar-content');
    if (!el) return;

    if (!_ozet) {
      try { _ozet = await T.rpc('admin_app_errors_ozet', { p_son_gun: _state.sonGun }); }
      catch {}
    }

    try {
      const rows = await T.rpc('admin_app_errors_listele', {
        p_limit: PAGE_SIZE,
        p_offset: _state.page * PAGE_SIZE,
        p_arama: _state.arama || null,
        p_severity: _state.severity || null,
        p_platform: _state.platform || null,
        p_resolved: _state.resolved || null,
        p_son_gun: _state.sonGun,
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
    const el = document.getElementById('adm-hatalar-content');

    const ozetHtml = _ozet ? `
      <div class="adm-kpi-grid" style="margin-bottom:24px;">
        <div class="adm-kpi">
          <div class="adm-kpi-label">Son ${_state.sonGun}g Toplam</div>
          <div class="adm-kpi-value">${T.fmt.num(_ozet.toplam)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(_ozet.cozulmemis)} çözülmemiş</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Son 24 Saat</div>
          <div class="adm-kpi-value ${_ozet.son_24sa > 50 ? '' : ''}">${T.fmt.num(_ozet.son_24sa)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(_ozet.error)} error · ${T.fmt.num(_ozet.warn)} warn</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Platform Dağılımı</div>
          <div class="adm-kpi-value">${T.fmt.num(_ozet.web)}<span class="unit">/${T.fmt.num(_ozet.android)}</span></div>
          <div class="adm-kpi-sub">Web / Android</div>
        </div>
      </div>
    ` : '';

    if (_state.rows.length === 0) {
      el.innerHTML = ozetHtml + '<div class="adm-empty">Filtreyle eşleşen hata yok.</div>';
      return;
    }

    el.innerHTML = `
      ${ozetHtml}

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
          <input type="checkbox" id="adm-hata-tumsec" onchange="AdmModule_hatalar.tumSec(this.checked)">
          <span>Tümünü seç</span>
        </label>
        <span id="adm-hata-secili-info" style="font-size:11.5px;color:var(--adm-ink-3);"></span>
        <div style="flex:1;"></div>
        <button class="adm-btn adm-btn-ghost adm-btn-small" id="adm-hata-toplu-resolve" disabled onclick="AdmModule_hatalar.topluResolve()">
          <i data-icon="check-double"></i> Seçilenleri Çöz
        </button>
      </div>

      <table class="adm-table">
        <thead><tr>
          <th style="width:28px;"></th>
          <th>Mesaj</th>
          <th>Severity</th>
          <th>Platform</th>
          <th>Firma / Kullanıcı</th>
          <th>Tarih</th>
          <th>Durum</th>
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
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_hatalar.prev()" ${_state.page === 0 ? 'disabled' : ''}>
            <i data-icon="chevron-left"></i> Önceki
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_hatalar.next()" ${(_state.page+1)*PAGE_SIZE >= _state.toplam ? 'disabled' : ''}>
            Sonraki <i data-icon="chevron-right"></i>
          </button>
        </div>
      </div>
    `;
    updateSeciliInfo();
  }

  function renderRow(r) {
    const T = window.AdmAPI;
    const sevColor = r.severity === 'error' ? 'adm-badge-danger'
                   : r.severity === 'warn' ? 'adm-badge-warning'
                   : 'adm-badge-info';
    const platBadge = r.platform === 'web'
      ? '<span class="adm-badge adm-badge-info">Web</span>'
      : '<span class="adm-badge">Android</span>';
    const durum = r.resolved
      ? '<span class="adm-badge adm-badge-success">Çözüldü</span>'
      : '<span class="adm-badge adm-badge-danger">Açık</span>';
    return `
      <tr class="clickable">
        <td onclick="event.stopPropagation()">
          <input type="checkbox" class="adm-hata-check" data-id="${r.id}" onchange="AdmModule_hatalar.tekSec(${r.id}, this.checked)" ${_state.secili.has(r.id) ? 'checked' : ''}>
        </td>
        <td onclick="AdmModule_hatalar.detayAc(${r.id})">
          <strong style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc((r.message || '').slice(0, 100))}</strong>
          ${r.source ? `<div style="font-size:10.5px;color:var(--adm-ink-3);margin-top:2px;font-family:'Geist Mono',monospace;">${T.esc(r.source)}</div>` : ''}
        </td>
        <td onclick="AdmModule_hatalar.detayAc(${r.id})"><span class="adm-badge ${sevColor}">${T.esc(r.severity)}</span></td>
        <td onclick="AdmModule_hatalar.detayAc(${r.id})">${platBadge}</td>
        <td onclick="AdmModule_hatalar.detayAc(${r.id})">
          <div style="font-size:11.5px;">${T.esc(r.firma_ad || '—')}</div>
          ${r.user_email ? `<div style="font-size:10.5px;color:var(--adm-ink-3);font-family:'Geist Mono',monospace;">${T.esc(r.user_email)}</div>` : ''}
        </td>
        <td onclick="AdmModule_hatalar.detayAc(${r.id})"><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(r.created_at))}</span></td>
        <td onclick="AdmModule_hatalar.detayAc(${r.id})">${durum}</td>
        <td>
          ${!r.resolved ? `<button class="adm-icon-btn" title="Çözüldü işaretle" onclick="AdmModule_hatalar.tekResolve(${r.id})"><i data-icon="check"></i></button>` : ''}
        </td>
      </tr>
    `;
  }

  function tumSec(checked) {
    _state.secili.clear();
    if (checked) {
      _state.rows.forEach(r => _state.secili.add(r.id));
    }
    document.querySelectorAll('.adm-hata-check').forEach(c => c.checked = checked);
    updateSeciliInfo();
  }

  function tekSec(id, checked) {
    if (checked) _state.secili.add(id);
    else _state.secili.delete(id);
    updateSeciliInfo();
  }

  function updateSeciliInfo() {
    const el = document.getElementById('adm-hata-secili-info');
    const btn = document.getElementById('adm-hata-toplu-resolve');
    if (!el || !btn) return;
    const n = _state.secili.size;
    el.textContent = n > 0 ? `${n} seçili` : '';
    btn.disabled = n === 0;
  }

  async function detayAc(id) {
    const T = window.AdmAPI;
    T.modalAc('Hata Detayı #' + id, '<div class="adm-empty">Yükleniyor…</div>');
    try {
      const d = await T.rpc('admin_app_error_detay', { p_id: id });
      renderDetay(d);
    } catch (err) {
      T.toast('Detay alınamadı: ' + err.message, 'error');
    }
  }

  function renderDetay(d) {
    const T = window.AdmAPI;
    const sevColor = d.severity === 'error' ? 'adm-badge-danger'
                   : d.severity === 'warn' ? 'adm-badge-warning'
                   : 'adm-badge-info';
    const html = `
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <span class="adm-badge ${sevColor}">${T.esc(d.severity)}</span>
        <span class="adm-badge ${d.platform === 'web' ? 'adm-badge-info' : ''}">${T.esc(d.platform)}</span>
        ${d.resolved ? '<span class="adm-badge adm-badge-success">Çözüldü</span>' : '<span class="adm-badge adm-badge-danger">Açık</span>'}
        ${d.benzer_sayi > 0 ? `<span class="adm-badge">+${d.benzer_sayi} benzer</span>` : ''}
      </div>

      <h3 style="font-family:Newsreader,serif;font-weight:400;margin:0 0 8px;font-size:18px;letter-spacing:-.01em;font-family:'Geist Mono',monospace;font-size:13px;">
        ${T.esc(d.message)}
      </h3>

      <div class="adm-detail-row">
        <div class="adm-detail-key">Tarih</div>
        <div class="adm-detail-val mono">${T.esc(T.fmt.dateTime(d.created_at))}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Firma</div>
        <div class="adm-detail-val">${T.esc(d.firma_ad || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Kullanıcı</div>
        <div class="adm-detail-val mono">${T.esc(d.user_email || d.user_id || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">Source</div>
        <div class="adm-detail-val mono">${T.esc(d.source || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">URL / Ekran</div>
        <div class="adm-detail-val mono">${T.esc(d.url || '—')}</div>
      </div>
      <div class="adm-detail-row">
        <div class="adm-detail-key">User Agent</div>
        <div class="adm-detail-val mono" style="font-size:10.5px;">${T.esc((d.user_agent || '—').slice(0, 200))}</div>
      </div>

      ${d.stack ? `
        <div style="margin-top:18px;">
          <div class="adm-label">STACK TRACE</div>
          <pre style="background:var(--adm-paper-2);padding:14px;font-family:'Geist Mono',monospace;font-size:10.5px;border:1px solid var(--adm-hairline);max-height:240px;overflow:auto;margin:0;white-space:pre-wrap;">${T.esc(d.stack)}</pre>
        </div>
      ` : ''}

      ${d.context ? `
        <div style="margin-top:18px;">
          <div class="adm-label">CONTEXT</div>
          <pre style="background:var(--adm-paper-2);padding:14px;font-family:'Geist Mono',monospace;font-size:10.5px;border:1px solid var(--adm-hairline);max-height:200px;overflow:auto;margin:0;">${T.esc(JSON.stringify(d.context, null, 2))}</pre>
        </div>
      ` : ''}

      ${d.resolved ? `
        <div class="adm-detail-row" style="margin-top:18px;">
          <div class="adm-detail-key">Çözüldü</div>
          <div class="adm-detail-val">${T.esc(T.fmt.dateTime(d.resolved_at))} · ${T.esc(d.resolved_note || '—')}</div>
        </div>
      ` : ''}

      <div class="adm-modal-actions">
        ${!d.resolved ? `<button class="adm-btn" onclick="AdmModule_hatalar.resolveModal(${d.id})"><i data-icon="check"></i> Çözüldü İşaretle</button>` : ''}
        <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
      </div>
    `;
    document.getElementById('adm-modal-body').innerHTML = html;
  }

  function resolveModal(id) {
    const T = window.AdmAPI;
    const html = `
      <div class="adm-form-group">
        <label class="adm-label">Not (opsiyonel)</label>
        <textarea id="adm-hata-resolve-not" class="adm-input" placeholder="Örn: v3.0'da düzeltildi"></textarea>
      </div>
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="admModalKapat()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_hatalar.resolveKaydet(${id})">Çözüldü</button>
      </div>
    `;
    T.modalAc('Hata Çözüldü #' + id, html);
  }

  async function resolveKaydet(id) {
    const T = window.AdmAPI;
    const not = document.getElementById('adm-hata-resolve-not').value.trim() || null;
    try {
      await T.rpc('admin_app_error_resolve', { p_id: id, p_note: not });
      T.toast('Hata çözüldü işaretlendi', 'success');
      T.modalKapat();
      _ozet = null;
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function tekResolve(id) {
    const T = window.AdmAPI;
    try {
      await T.rpc('admin_app_error_resolve', { p_id: id, p_note: null });
      T.toast('Çözüldü ✓', 'success');
      _ozet = null;
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  async function topluResolve() {
    const T = window.AdmAPI;
    if (_state.secili.size === 0) return;
    const not = prompt(`${_state.secili.size} hatayı çözüldü işaretle. Not (opsiyonel):`, '');
    if (not === null) return;
    try {
      const count = await T.rpc('admin_app_error_toplu_resolve', {
        p_ids: Array.from(_state.secili),
        p_note: not || null,
      });
      T.toast(`${count} hata çözüldü ✓`, 'success');
      _state.secili.clear();
      _ozet = null;
      fetch();
    } catch (err) { T.toast('Hata: ' + err.message, 'error'); }
  }

  function bindFilters() {
    const els = {
      arama:    document.getElementById('adm-hata-search'),
      severity: document.getElementById('adm-hata-severity'),
      platform: document.getElementById('adm-hata-platform'),
      resolved: document.getElementById('adm-hata-resolved'),
      sonGun:   document.getElementById('adm-hata-songun'),
    };
    let _t = null;
    els.arama?.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _state.arama = els.arama.value.trim(); _state.page = 0; _ozet = null; fetch(); }, 300);
    });
    ['severity', 'platform', 'resolved'].forEach(k => {
      els[k]?.addEventListener('change', () => {
        _state[k] = els[k].value;
        _state.page = 0;
        fetch();
      });
    });
    els.sonGun?.addEventListener('change', () => {
      _state.sonGun = parseInt(els.sonGun.value);
      _state.page = 0;
      _ozet = null;
      fetch();
    });
  }

  window.AdmModule_hatalar = {
    init: () => { bindFilters(); fetch(); },
    onShow: () => { _ozet = null; fetch(); },
    next: () => { _state.page++; fetch(); },
    prev: () => { _state.page = Math.max(0, _state.page-1); fetch(); },
    detayAc, resolveModal, resolveKaydet, tekResolve, topluResolve,
    tumSec, tekSec,
  };
  window.admHatalarYenile = () => { _ozet = null; fetch(); };
})();
