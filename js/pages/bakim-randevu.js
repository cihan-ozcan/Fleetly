/* =============================================================================
 * bakim-randevu.js — Bakım randevu CRUD UI (Faz 9)
 * -----------------------------------------------------------------------------
 * Modal'lar: yeni randevu, detay+düzenle, tam liste.
 * RPC'ler:
 *   - bakim_randevu_olustur(arac_id, tip, plan_tarihi, servis_adi, notlar)
 *   - bakim_randevu_listele(durum, arac_id, limit)
 *   - bakim_randevu_yapildi_isaretle(id, gerceklesen_tarih, km, maliyet, servis_adi, notlar)
 *   - bakim_randevu_iptal(id, neden)
 *
 * Tetikleyiciler:
 *   window._openYeniBakimRandevu(arac_id?)
 *   window._openBakimRandevuDetay(id)
 *   window._openBakimRandevuList(durum?)
 * =========================================================================== */

(function () {
  'use strict';

  const TIP_LABEL = {
    muayene:         'Muayene (TÜVTÜRK)',
    sigorta:         'Sigorta Yenileme',
    takograf:        'Takograf Kalibrasyonu',
    periyodik_bakim: 'Periyodik Bakım',
    lastik:          'Lastik Değişimi / Rotasyon',
    diger:           'Diğer'
  };
  const TIP_ICON = {
    muayene: '📋', sigorta: '🛡', takograf: '⏱',
    periyodik_bakim: '🔧', lastik: '🛞', diger: '🛠'
  };
  const DURUM_LABEL = {
    planlandi:  '📅 Planlandı',
    gecikmis:   '⚠ Gecikmiş',
    yapildi:    '✅ Yapıldı',
    iptal:      '❌ İptal'
  };
  const DURUM_COLOR = {
    planlandi: '#3b82f6', gecikmis: '#dc2626',
    yapildi:   '#10b981', iptal:    '#64748b'
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Yardımcılar
  // ────────────────────────────────────────────────────────────────────────────
  const _esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const _toast = (m, k) =>
    (typeof window.showToast === 'function') ? window.showToast(m, k) : console.log(`[${k||'info'}]`, m);

  const _sb = () => (typeof window.getSB === 'function') ? window.getSB() : null;

  function _formatTarih(iso) {
    if (!iso) return '—';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function _kalanLabel(kg) {
    if (kg < 0)  return Math.abs(kg) + ' gün gecikti';
    if (kg === 0) return 'Bugün';
    if (kg === 1) return 'Yarın';
    return kg + ' gün kaldı';
  }

  let _araclarCache = null;
  let _aracCacheAt  = 0;

  async function _araclarYukle() {
    if (_araclarCache && Date.now() - _aracCacheAt < 60_000) return _araclarCache;
    const sb = _sb();
    if (!sb) return [];
    const { data, error } = await sb.from('araclar')
      .select('id, plaka, tip, marka, model')
      .eq('durum', 'Aktif')
      .order('plaka', { ascending: true });
    if (error) {
      console.warn('[bakim-randevu] araç listesi:', error.message);
      return [];
    }
    _araclarCache = data || [];
    _aracCacheAt = Date.now();
    return _araclarCache;
  }

  function _renderAracOptions(selectedId) {
    if (!_araclarCache) return '<option value="">Yükleniyor…</option>';
    const opts = ['<option value="">Araç seçin…</option>'];
    _araclarCache.forEach(a => {
      const sel = a.id === selectedId ? ' selected' : '';
      const aciklama = [a.tip, a.marka, a.model].filter(Boolean).join(' · ');
      opts.push(`<option value="${_esc(a.id)}"${sel}>${_esc(a.plaka)} — ${_esc(aciklama || '—')}</option>`);
    });
    return opts.join('');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Genel modal kabuğu (DOM dinamik)
  // ────────────────────────────────────────────────────────────────────────────
  function _ensureModalRoot() {
    let root = document.getElementById('bakim-rand-modal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'bakim-rand-modal-root';
      document.body.appendChild(root);
    }
    return root;
  }

  function _renderModal(id, title, bodyHtml, footerHtml, opts = {}) {
    const width = opts.width || '560px';
    const root = _ensureModalRoot();
    root.innerHTML = `
      <div id="${id}-bg" style="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;z-index:11000;padding:48px 16px;overflow:auto;">
        <div style="background:var(--surface);border-radius:14px;width:100%;max-width:${width};box-shadow:0 24px 64px rgba(0,0,0,.35);border:1px solid var(--border);overflow:hidden;animation:bakimRandFade .15s ease-out;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;background:linear-gradient(135deg,#0B1A2F 0%,#234A85 100%);color:#fff;">
            <div style="font-weight:700;font-size:15.5px;letter-spacing:-0.005em;">${title}</div>
            <button type="button" onclick="window._closeBakimRandModal('${id}')" style="background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:4px 10px;border-radius:6px;" aria-label="Kapat">×</button>
          </div>
          <div style="padding:20px 22px;max-height:calc(100vh - 200px);overflow:auto;">
            ${bodyHtml}
          </div>
          ${footerHtml ? `<div style="padding:14px 22px 18px;border-top:1px solid var(--border);background:var(--surface2);display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">${footerHtml}</div>` : ''}
        </div>
      </div>
      <style>@keyframes bakimRandFade{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}</style>
    `;
  }

  window._closeBakimRandModal = function (id) {
    const bg = document.getElementById(id + '-bg');
    if (bg) bg.remove();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // 1) YENİ RANDEVU
  // ────────────────────────────────────────────────────────────────────────────
  async function openYeniBakimRandevu(p_arac_id) {
    const today = new Date();
    const minDate = today.toISOString().slice(0, 10);
    const defaultDate = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

    const tipOpts = Object.entries(TIP_LABEL)
      .map(([k, v]) => `<option value="${k}">${TIP_ICON[k]} ${v}</option>`).join('');

    const body = `
      <div style="display:grid;gap:14px;">
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase;">Araç *</label>
          <select id="brand-yeni-arac" style="width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;">
            <option value="">Yükleniyor…</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase;">Tip *</label>
            <select id="brand-yeni-tip" style="width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;">
              ${tipOpts}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase;">Plan Tarihi *</label>
            <input id="brand-yeni-tarih" type="date" min="${_esc(minDate)}" value="${_esc(defaultDate)}"
              style="width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;" />
          </div>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase;">Servis / Yer (opsiyonel)</label>
          <input id="brand-yeni-servis" type="text" placeholder="örn. TÜVTÜRK Maslak, MAN Yetkili Servis"
            style="width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase;">Notlar (opsiyonel)</label>
          <textarea id="brand-yeni-not" rows="3" placeholder="Servise giderken dikkat edilecek konular…"
            style="width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:14px;resize:vertical;"></textarea>
        </div>
        <div id="brand-yeni-err" style="display:none;color:var(--danger);font-size:13px;background:rgba(220,56,56,.08);border:1px solid rgba(220,56,56,.25);padding:10px 12px;border-radius:8px;"></div>
        <div style="background:rgba(255,107,31,.06);border-left:3px solid var(--accent);padding:10px 12px;border-radius:6px;font-size:12.5px;color:var(--text-muted);line-height:1.6;">
          📌 Randevu oluşturulduğunda atanmış sürücüye anında bildirim gönderilir.
          Ayrıca <strong>7 gün, 1 gün ve aynı gün</strong> sabahında otomatik hatırlatma yapılır.
        </div>
      </div>
    `;
    const footer = `
      <button type="button" onclick="window._closeBakimRandModal('brand-yeni')" style="padding:10px 18px;border:1px solid var(--border);background:transparent;color:var(--text);border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;">Vazgeç</button>
      <button type="button" id="brand-yeni-kaydet" onclick="window._submitYeniBakimRandevu()" style="padding:10px 22px;background:var(--accent);color:#fff;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;">📅 Randevu Oluştur</button>
    `;

    _renderModal('brand-yeni', '📌 Yeni Bakım Randevusu', body, footer);

    // Araç listesini doldur
    await _araclarYukle();
    const sel = document.getElementById('brand-yeni-arac');
    if (sel) sel.innerHTML = _renderAracOptions(p_arac_id);
  }

  window._submitYeniBakimRandevu = async function () {
    const errEl = document.getElementById('brand-yeni-err');
    const btn   = document.getElementById('brand-yeni-kaydet');
    const setErr = m => { if (errEl) { errEl.textContent = m; errEl.style.display = m ? 'block' : 'none'; } };
    setErr('');

    const arac   = document.getElementById('brand-yeni-arac').value;
    const tip    = document.getElementById('brand-yeni-tip').value;
    const tarih  = document.getElementById('brand-yeni-tarih').value;
    const servis = document.getElementById('brand-yeni-servis').value.trim() || null;
    const not    = document.getElementById('brand-yeni-not').value.trim() || null;

    if (!arac)  return setErr('Araç seçin');
    if (!tip)   return setErr('Tip seçin');
    if (!tarih) return setErr('Tarih seçin');

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Kaydediliyor…'; }
    try {
      const sb = _sb();
      if (!sb) throw new Error('Supabase istemcisi yok');
      const { data, error } = await sb.rpc('bakim_randevu_olustur', {
        p_arac_id: arac, p_tip: tip, p_plan_tarihi: tarih,
        p_servis_adi: servis, p_notlar: not
      });
      if (error) throw error;
      const row = Array.isArray(data) && data[0];
      _toast('✅ Randevu oluşturuldu' + (row?.durum === 'gecikmis' ? ' (geride bir tarih girdiniz, "gecikmis" işaretlendi)' : ''), 'success');
      window._closeBakimRandModal('brand-yeni');
      if (typeof window.refreshYaklasanBakimlar === 'function') window.refreshYaklasanBakimlar();
    } catch (err) {
      setErr('Hata: ' + (err?.message || err));
      if (btn) { btn.disabled = false; btn.textContent = '📅 Randevu Oluştur'; }
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // 2) DETAY MODAL
  // ────────────────────────────────────────────────────────────────────────────
  async function openBakimRandevuDetay(p_id) {
    _renderModal('brand-detay', '🔧 Randevu Detayı', '<div style="text-align:center;padding:40px 20px;color:var(--text-muted);">⏳ Yükleniyor…</div>', '');
    try {
      const sb = _sb();
      if (!sb) throw new Error('Supabase istemcisi yok');
      const { data, error } = await sb.rpc('bakim_randevu_listele', { p_durum: null, p_arac_id: null, p_limit: 200 });
      if (error) throw error;
      const row = (Array.isArray(data) ? data : []).find(r => r.id === p_id);
      if (!row) throw new Error('Randevu bulunamadı (id: ' + p_id + ')');

      const aktif = ['planlandi', 'gecikmis'].includes(row.durum);
      const body = `
        <div style="display:grid;gap:16px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Araç</div>
              <div style="font-size:16px;font-weight:700;">${_esc(row.arac_plaka)}</div>
              <div style="font-size:12.5px;color:var(--text-muted);">${_esc(row.arac_tip || '—')}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Tip</div>
              <div style="font-size:16px;font-weight:700;">${TIP_ICON[row.tip] || ''} ${_esc(TIP_LABEL[row.tip] || row.tip)}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Planlanan</div>
              <div style="font-size:15px;font-weight:600;">${_esc(_formatTarih(row.plan_tarihi))}</div>
              <div style="font-size:12.5px;color:${row.kalan_gun < 0 ? 'var(--danger)' : 'var(--text-muted)'};font-weight:600;">${_esc(_kalanLabel(row.kalan_gun))}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Durum</div>
              <span style="display:inline-block;padding:4px 11px;border-radius:999px;background:${DURUM_COLOR[row.durum] || '#64748b'};color:#fff;font-size:12px;font-weight:700;">${DURUM_LABEL[row.durum] || row.durum}</span>
            </div>
          </div>
          ${row.servis_adi ? `<div style="background:var(--surface2);padding:11px 14px;border-radius:10px;font-size:13.5px;"><strong>Servis:</strong> ${_esc(row.servis_adi)}</div>` : ''}
          ${row.notlar ? `<div style="background:var(--surface2);padding:11px 14px;border-radius:10px;font-size:13.5px;line-height:1.55;"><strong>Notlar:</strong><br>${_esc(row.notlar)}</div>` : ''}
          ${row.surucu_ad ? `<div style="font-size:13px;color:var(--text-muted);">👤 Atanmış sürücü: <strong style="color:var(--text);">${_esc(row.surucu_ad)}</strong></div>` : ''}
          ${row.gerceklesen_tarih ? `
            <div style="background:rgba(16,169,116,.08);border-left:3px solid var(--success);padding:11px 14px;border-radius:6px;font-size:13.5px;line-height:1.6;">
              <strong>✅ Yapıldı:</strong> ${_esc(_formatTarih(row.gerceklesen_tarih))}
              ${row.maliyet ? ` · ₺${Number(row.maliyet).toLocaleString('tr-TR')}` : ''}
            </div>` : ''}
        </div>
      `;

      const footer = aktif ? `
        <button type="button" onclick="window._openBakimIptalModal(${row.id})" style="padding:10px 18px;border:1px solid var(--border);background:transparent;color:var(--danger);border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;">❌ İptal Et</button>
        <button type="button" onclick="window._openBakimYapildiModal(${row.id}, '${_esc(row.servis_adi || '')}')" style="padding:10px 22px;background:var(--success,#10b981);color:#fff;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;">✅ Yapıldı İşaretle</button>
      ` : `
        <button type="button" onclick="window._closeBakimRandModal('brand-detay')" style="padding:10px 22px;background:var(--accent);color:#fff;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;">Kapat</button>
      `;

      _renderModal('brand-detay', '🔧 Randevu Detayı', body, footer);
    } catch (err) {
      _toast('Detay açılamadı: ' + (err?.message || err), 'error');
      window._closeBakimRandModal('brand-detay');
    }
  }

  // 2a) YAPILDI MODAL
  window._openBakimYapildiModal = function (p_id, p_servis_default) {
    const today = new Date().toISOString().slice(0, 10);
    const body = `
      <input type="hidden" id="brand-yapildi-id" value="${p_id}" />
      <div style="display:grid;gap:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;">Gerçekleşen Tarih *</label>
            <input id="brand-yapildi-tarih" type="date" max="${_esc(today)}" value="${_esc(today)}" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);" />
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;">KM Sayacı</label>
            <input id="brand-yapildi-km" type="number" min="0" step="1" placeholder="örn. 245000" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;">Maliyet (₺)</label>
            <input id="brand-yapildi-maliyet" type="number" min="0" step="0.01" placeholder="0" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);" />
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;">Servis</label>
            <input id="brand-yapildi-servis" type="text" value="${_esc(p_servis_default)}" placeholder="Servis/yer adı" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);" />
          </div>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;">Notlar</label>
          <textarea id="brand-yapildi-not" rows="3" placeholder="Yapılan işlemler, parça vd." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);resize:vertical;"></textarea>
        </div>
        <div id="brand-yapildi-err" style="display:none;color:var(--danger);font-size:13px;background:rgba(220,56,56,.08);border:1px solid rgba(220,56,56,.25);padding:10px 12px;border-radius:8px;"></div>
        <div style="font-size:12.5px;color:var(--text-muted);background:rgba(16,169,116,.06);border-left:3px solid var(--success,#10b981);padding:10px 12px;border-radius:6px;line-height:1.55;">
          ℹ Yapıldı işaretlendiğinde otomatik olarak <strong>bakım kayıtlarına</strong> da bir satır eklenir.
        </div>
      </div>
    `;
    const footer = `
      <button type="button" onclick="window._closeBakimRandModal('brand-yapildi')" style="padding:10px 18px;border:1px solid var(--border);background:transparent;color:var(--text);border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;">Vazgeç</button>
      <button type="button" id="brand-yapildi-kaydet" onclick="window._submitBakimYapildi()" style="padding:10px 22px;background:var(--success,#10b981);color:#fff;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;">✅ Yapıldı Olarak Kaydet</button>
    `;
    _renderModal('brand-yapildi', '✅ Bakım Yapıldı İşaretle', body, footer);
  };

  window._submitBakimYapildi = async function () {
    const errEl = document.getElementById('brand-yapildi-err');
    const btn   = document.getElementById('brand-yapildi-kaydet');
    const setErr = m => { if (errEl) { errEl.textContent = m; errEl.style.display = m ? 'block' : 'none'; } };
    setErr('');
    const id      = parseInt(document.getElementById('brand-yapildi-id').value, 10);
    const tarih   = document.getElementById('brand-yapildi-tarih').value || null;
    const km      = document.getElementById('brand-yapildi-km').value;
    const maliyet = document.getElementById('brand-yapildi-maliyet').value;
    const servis  = document.getElementById('brand-yapildi-servis').value.trim() || null;
    const notlar  = document.getElementById('brand-yapildi-not').value.trim() || null;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Kaydediliyor…'; }
    try {
      const sb = _sb();
      const { error } = await sb.rpc('bakim_randevu_yapildi_isaretle', {
        p_id: id,
        p_gerceklesen_tarih: tarih,
        p_gerceklesen_km: km ? Number(km) : null,
        p_maliyet: maliyet ? Number(maliyet) : null,
        p_servis_adi: servis,
        p_notlar: notlar
      });
      if (error) throw error;
      _toast('✅ Bakım yapıldı olarak işaretlendi', 'success');
      window._closeBakimRandModal('brand-yapildi');
      window._closeBakimRandModal('brand-detay');
      if (typeof window.refreshYaklasanBakimlar === 'function') window.refreshYaklasanBakimlar();
    } catch (err) {
      setErr('Hata: ' + (err?.message || err));
      if (btn) { btn.disabled = false; btn.textContent = '✅ Yapıldı Olarak Kaydet'; }
    }
  };

  // 2b) İPTAL MODAL
  window._openBakimIptalModal = function (p_id) {
    const body = `
      <input type="hidden" id="brand-iptal-id" value="${p_id}" />
      <div style="display:grid;gap:14px;">
        <div style="background:rgba(220,56,56,.06);border-left:3px solid var(--danger);padding:11px 14px;border-radius:6px;font-size:13.5px;line-height:1.55;">
          ⚠ Bu randevuyu iptal etmek üzeresiniz. İptal edilince ileri tarihte tekrar planlamak için yeni randevu oluşturmanız gerekir.
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em;">İptal Nedeni</label>
          <textarea id="brand-iptal-neden" rows="3" placeholder="örn. Servis yer değiştirdi, yeni randevu alınacak" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);resize:vertical;"></textarea>
        </div>
        <div id="brand-iptal-err" style="display:none;color:var(--danger);font-size:13px;background:rgba(220,56,56,.08);border:1px solid rgba(220,56,56,.25);padding:10px 12px;border-radius:8px;"></div>
      </div>
    `;
    const footer = `
      <button type="button" onclick="window._closeBakimRandModal('brand-iptal')" style="padding:10px 18px;border:1px solid var(--border);background:transparent;color:var(--text);border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;">Vazgeç</button>
      <button type="button" id="brand-iptal-kaydet" onclick="window._submitBakimIptal()" style="padding:10px 22px;background:var(--danger);color:#fff;border:0;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:700;">❌ Randevuyu İptal Et</button>
    `;
    _renderModal('brand-iptal', '❌ Randevu İptal', body, footer);
  };

  window._submitBakimIptal = async function () {
    const errEl = document.getElementById('brand-iptal-err');
    const btn   = document.getElementById('brand-iptal-kaydet');
    const setErr = m => { if (errEl) { errEl.textContent = m; errEl.style.display = m ? 'block' : 'none'; } };
    setErr('');
    const id    = parseInt(document.getElementById('brand-iptal-id').value, 10);
    const neden = document.getElementById('brand-iptal-neden').value.trim() || null;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ İptal ediliyor…'; }
    try {
      const sb = _sb();
      const { error } = await sb.rpc('bakim_randevu_iptal', { p_id: id, p_neden: neden });
      if (error) throw error;
      _toast('Randevu iptal edildi', 'success');
      window._closeBakimRandModal('brand-iptal');
      window._closeBakimRandModal('brand-detay');
      if (typeof window.refreshYaklasanBakimlar === 'function') window.refreshYaklasanBakimlar();
    } catch (err) {
      setErr('Hata: ' + (err?.message || err));
      if (btn) { btn.disabled = false; btn.textContent = '❌ Randevuyu İptal Et'; }
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // 3) TAM LİSTE
  // ────────────────────────────────────────────────────────────────────────────
  async function openBakimRandevuList(p_durum) {
    const filter = p_durum || 'aktif';
    const body = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <button class="brand-fil-btn" data-fil="aktif"      onclick="window._brandSetFilter('aktif')"      style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:12.5px;font-weight:600;">⏳ Aktif</button>
        <button class="brand-fil-btn" data-fil="tamamlandi" onclick="window._brandSetFilter('tamamlandi')" style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:12.5px;font-weight:600;">✅ Tamamlanmış</button>
        <button class="brand-fil-btn" data-fil="iptal"      onclick="window._brandSetFilter('iptal')"      style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:12.5px;font-weight:600;">❌ İptal</button>
        <button class="brand-fil-btn" data-fil=""           onclick="window._brandSetFilter('')"           style="padding:6px 14px;border-radius:999px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:12.5px;font-weight:600;">Tümü</button>
        <span style="flex:1;"></span>
        <button onclick="window._openYeniBakimRandevu()" style="padding:8px 14px;background:var(--accent);color:#fff;border:0;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;">+ Yeni Randevu</button>
      </div>
      <div id="brand-list-tbody" style="border-radius:10px;border:1px solid var(--border);overflow:hidden;">
        <div style="padding:30px;text-align:center;color:var(--text-muted);">⏳ Yükleniyor…</div>
      </div>
    `;
    _renderModal('brand-list', '🔧 Bakım Randevuları', body, '', { width: '880px' });
    setTimeout(() => window._brandSetFilter(filter), 50);
  }

  window._brandSetFilter = async function (fil) {
    document.querySelectorAll('.brand-fil-btn').forEach(b => {
      const active = b.getAttribute('data-fil') === fil;
      b.style.background = active ? 'var(--accent)' : 'transparent';
      b.style.color = active ? '#fff' : 'var(--text)';
      b.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    });

    const tbody = document.getElementById('brand-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);">⏳ Yükleniyor…</div>';

    try {
      const sb = _sb();
      if (!sb) throw new Error('Supabase yok');
      const { data, error } = await sb.rpc('bakim_randevu_listele', {
        p_durum: fil || null, p_arac_id: null, p_limit: 200
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];

      if (!rows.length) {
        tbody.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted);">📭 Bu filtreye uygun randevu yok</div>`;
        return;
      }

      const html = `
        <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
          <thead>
            <tr style="background:var(--surface2);text-align:left;">
              <th style="padding:10px 14px;font-weight:600;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">Araç</th>
              <th style="padding:10px 14px;font-weight:600;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">Tip</th>
              <th style="padding:10px 14px;font-weight:600;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">Plan Tarihi</th>
              <th style="padding:10px 14px;font-weight:600;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">Kalan</th>
              <th style="padding:10px 14px;font-weight:600;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">Durum</th>
              <th style="padding:10px 14px;font-weight:600;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);">Sürücü</th>
              <th style="padding:10px 14px;border-bottom:1px solid var(--border);"></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr style="cursor:pointer;border-bottom:1px solid var(--border);" onclick="window._openBakimRandevuDetay(${r.id})" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'">
                <td style="padding:10px 14px;font-weight:600;">${_esc(r.arac_plaka)}<div style="font-size:11px;color:var(--text-muted);font-weight:400;">${_esc(r.arac_tip || '')}</div></td>
                <td style="padding:10px 14px;">${TIP_ICON[r.tip] || ''} ${_esc(TIP_LABEL[r.tip] || r.tip)}</td>
                <td style="padding:10px 14px;font-variant-numeric:tabular-nums;">${_esc(_formatTarih(r.plan_tarihi))}</td>
                <td style="padding:10px 14px;font-weight:600;color:${r.kalan_gun < 0 ? 'var(--danger)' : (r.kalan_gun <= 7 ? 'var(--warning,#E5A100)' : 'var(--text)')};">${_esc(_kalanLabel(r.kalan_gun))}</td>
                <td style="padding:10px 14px;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${DURUM_COLOR[r.durum] || '#64748b'};color:#fff;font-size:11px;font-weight:700;">${DURUM_LABEL[r.durum] || r.durum}</span></td>
                <td style="padding:10px 14px;color:var(--text-muted);font-size:12.5px;">${_esc(r.surucu_ad || '—')}</td>
                <td style="padding:10px 14px;text-align:right;color:var(--text-muted);font-size:18px;">›</td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;
      tbody.innerHTML = html;
    } catch (err) {
      tbody.innerHTML = `<div style="padding:30px;text-align:center;color:var(--danger);">⚠ ${_esc(err?.message || err)}</div>`;
    }
  };

  // Public API
  window._openYeniBakimRandevu  = openYeniBakimRandevu;
  window._openBakimRandevuDetay = openBakimRandevuDetay;
  window._openBakimRandevuList  = openBakimRandevuList;

  console.info('[bakim-randevu] modül yüklendi');
})();
