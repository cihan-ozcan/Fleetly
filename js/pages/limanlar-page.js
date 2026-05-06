/* =============================================================================
 * limanlar-page.js — Limanlar / Fabrikalar yöneticisi (Phase 2 — 2026_05_06l)
 * -----------------------------------------------------------------------------
 * Özellikler:
 *   • Tüm tanımlı limanları liste + harita üstünde polygon olarak göster
 *   • "Yeni Liman Çiz" → Leaflet.draw ile polygon çizim
 *   • Form: ad, tip, görünürlük (global/firma), notlar → liman_olustur RPC
 *   • Mevcut polygon'a tıkla → düzenle (ileride implement edilebilir)
 *   • Liman seçilince yan panele aktif yoğunluk (içeride X araç, ort. Y dk)
 *
 * RPC'ler:
 *   • limanlari_listele() → tüm görünür limanlar (GeoJSON polygon)
 *   • liman_olustur(ad, tip, geojson, firma_ozel, notlar) → uuid
 *   • liman_guncelle(id, ...) → void
 *   • liman_aktif_yogunluk(liman_id) → ziyaret özeti
 *
 * Tasarım:
 *   • Ana harita Leaflet, Türkiye merkezli
 *   • Polygon stili: tip'e göre renk (liman=mavi, fabrika=mor, terminal=yeşil...)
 *   • Aktif yoğunluğa göre highlight (yoğunsa kalın kenarlık)
 * =============================================================================
 */
(function () {
  'use strict';

  let _limanMap = null;
  let _limanPolygons = [];          // {liman, layer}
  let _limanSeciliId = null;
  let _limanCizimKatmani = null;    // Leaflet.draw'in geçici editable layer'ı
  let _limanCizimAktif = false;
  let _limanList = [];

  const _LIMAN_RENK = {
    'liman':    '#1a73e8',
    'fabrika':  '#9c27b0',
    'terminal': '#22c55e',
    'depo':     '#f59e0b',
    'servis':   '#7a8299'
  };
  const _LIMAN_EMOJI = {
    'liman': '⚓', 'fabrika': '🏭', 'terminal': '🚉', 'depo': '📦', 'servis': '🔧'
  };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  // ────────────────────────────────────────────────────────────
  // Sayfa aç / kapat
  // ────────────────────────────────────────────────────────────
  async function openLimanlarPage() {
    const page = document.getElementById('limanlar-page');
    if (!page) return;
    page.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    _limanInitMap();
    await limanlarYukle();
  }

  function closeLimanlarPage() {
    const page = document.getElementById('limanlar-page');
    if (page) page.classList.add('hidden');
    document.body.style.overflow = '';
    if (_limanCizimAktif) _limanCizimIptal();
    document.getElementById('limanlar-form-panel')?.classList.add('hidden');
  }

  // ────────────────────────────────────────────────────────────
  // Harita init
  // ────────────────────────────────────────────────────────────
  function _limanInitMap() {
    if (_limanMap) {
      setTimeout(() => _limanMap.invalidateSize(), 60);
      return;
    }
    const el = document.getElementById('limanlar-map');
    if (!el || typeof L === 'undefined') return;

    _limanMap = L.map(el, { zoomControl: true, attributionControl: false })
      .setView([41.0, 28.95], 10);   // İstanbul merkez
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
      .addTo(_limanMap);
    L.control.attribution({ prefix: '© OpenStreetMap' }).addTo(_limanMap);
    setTimeout(() => _limanMap.invalidateSize(), 100);
  }

  // ────────────────────────────────────────────────────────────
  // Liman listesi yükle (RPC + harita render)
  // ────────────────────────────────────────────────────────────
  async function limanlarYukle() {
    const sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) return;

    const listEl = document.getElementById('limanlar-list');
    const cntEl = document.getElementById('limanlar-count');
    if (listEl) listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Yükleniyor…</div>';

    let rows;
    try {
      const { data, error } = await sb.rpc('limanlari_listele');
      if (error) throw error;
      rows = data || [];
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div style="padding:20px;color:#ef4444;font-size:12px;">Yüklenemedi: ${_esc(err?.message || err)}</div>`;
      return;
    }
    _limanList = rows;

    // Yoğunluk özeti (aktif sayısı + ort. bekleme)
    let yogunluk = {};
    try {
      const { data } = await sb.rpc('limanlar_yogunluk_ozet');
      (data || []).forEach(d => { yogunluk[d.liman_id] = d; });
    } catch {}

    // Liste render
    if (cntEl) cntEl.textContent = rows.length ? `(${rows.length})` : '';
    if (!rows.length) {
      if (listEl) listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">
        Henüz tanımlı liman yok.<br><br>
        <span style="font-size:11px;">Yukarıdan "+ Yeni Liman Çiz" butonuyla başla.</span>
      </div>`;
    } else {
      listEl.innerHTML = rows.map(l => {
        const y = yogunluk[l.id] || {};
        const aktif = y.icerideki || 0;
        const ortDk = y.ort_bekleme_son1sa_dk;
        const sel = (_limanSeciliId === l.id) ? 'is-active' : '';
        const emoji = _LIMAN_EMOJI[l.tip] || '📍';
        const renk = _LIMAN_RENK[l.tip] || '#7a8299';
        return `
          <div class="liman-row ${sel}" onclick="_limanSec('${l.id}')">
            <div class="top">
              <span style="font-size:14px;">${emoji}</span>
              <span class="ad">${_esc(l.ad)}</span>
              ${l.firma_id ? '<span style="font-size:9px;color:var(--text-muted);">🔒</span>' : '<span style="font-size:9px;color:#22c55e;">🌐</span>'}
            </div>
            <div class="meta">${_esc(l.tip)}${l.notlar ? ' · ' + _esc((l.notlar+'').slice(0,30)) : ''}</div>
            <div class="stats">
              <span class="pill" style="background:${aktif>0?'rgba(245,158,11,.15)':'rgba(148,163,184,.10)'};color:${aktif>0?'#f59e0b':'var(--text-muted)'};">
                🅿️ ${aktif} araç içeride
              </span>
              ${ortDk ? `<span class="pill" style="background:rgba(34,197,94,.10);color:#22c55e;">⏱ ${ortDk} dk ort.</span>` : ''}
            </div>
          </div>`;
      }).join('');
    }

    // Harita polygon'ları
    _limanPolygonlariCiz();
  }

  function _limanPolygonlariCiz() {
    if (!_limanMap) return;
    // Eski polygon'ları temizle
    _limanPolygons.forEach(({ layer }) => { try { _limanMap.removeLayer(layer); } catch {} });
    _limanPolygons = [];

    const bounds = [];
    _limanList.forEach(l => {
      if (!l.poligon_geojson) return;
      try {
        const geo = JSON.parse(l.poligon_geojson);
        const renk = _LIMAN_RENK[l.tip] || '#7a8299';
        const layer = L.geoJSON(geo, {
          style: () => ({
            color: renk, weight: 2, opacity: 0.9,
            fillColor: renk, fillOpacity: 0.18
          })
        }).bindTooltip(`${_LIMAN_EMOJI[l.tip] || '📍'} <b>${_esc(l.ad)}</b>`, { sticky: true }).addTo(_limanMap);
        layer.on('click', () => _limanSec(l.id));
        _limanPolygons.push({ liman: l, layer });
        // Bounds için her latlng
        layer.eachLayer(l2 => {
          if (l2.getBounds) {
            const b = l2.getBounds();
            bounds.push([b.getNorth(), b.getEast()]);
            bounds.push([b.getSouth(), b.getWest()]);
          }
        });
      } catch (err) { console.warn('Polygon parse hata:', l.ad, err); }
    });

    if (bounds.length && !_limanCizimAktif) {
      try { _limanMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 }); } catch {}
    }
  }

  // ────────────────────────────────────────────────────────────
  // Liman seç (liste veya harita tıklayınca)
  // ────────────────────────────────────────────────────────────
  window._limanSec = function (id) {
    _limanSeciliId = id;
    // Liste highlight
    document.querySelectorAll('.liman-row').forEach(r => r.classList.remove('is-active'));
    // Harita zoom
    const item = _limanPolygons.find(p => p.liman.id === id);
    if (item && _limanMap) {
      try {
        const b = item.layer.getBounds();
        _limanMap.fitBounds(b, { padding: [60, 60], maxZoom: 16 });
      } catch {}
    }
    // Sadece bu satırı active yap
    setTimeout(() => {
      const row = Array.from(document.querySelectorAll('.liman-row')).find(r =>
        r.getAttribute('onclick')?.includes(id)
      );
      if (row) row.classList.add('is-active');
    }, 50);
  };

  // ────────────────────────────────────────────────────────────
  // Yeni liman çizme (Leaflet.draw)
  // ────────────────────────────────────────────────────────────
  function limanlarYeniBaslat() {
    if (!_limanMap || typeof L.Draw === 'undefined') {
      alert('Çizim aracı yüklenemedi (Leaflet.draw).');
      return;
    }
    if (_limanCizimAktif) return;
    _limanCizimAktif = true;
    document.getElementById('limanlar-yeni-btn').textContent = 'Çizim aktif — haritaya tıkla';
    document.getElementById('limanlar-yeni-btn').setAttribute('disabled', 'true');

    const drawer = new L.Draw.Polygon(_limanMap, {
      shapeOptions: {
        color: '#f97316', weight: 2, opacity: 1,
        fillColor: '#f97316', fillOpacity: 0.25
      },
      allowIntersection: false,
      showArea: true
    });
    drawer.enable();

    _limanMap.once(L.Draw.Event.CREATED, function (event) {
      _limanCizimKatmani = event.layer;
      _limanMap.addLayer(_limanCizimKatmani);
      // Form paneli aç — kullanıcı ad/tip girip kaydetsin
      document.getElementById('limanlar-form-panel').classList.remove('hidden');
      document.getElementById('limanlar-form-baslik').textContent = 'Yeni Liman';
      document.getElementById('liman-form-ad').focus();
      // Çizim butonu reset
      document.getElementById('limanlar-yeni-btn').textContent = '+ Yeni Liman Çiz';
      document.getElementById('limanlar-yeni-btn').removeAttribute('disabled');
    });
  }

  function _limanCizimIptal() {
    if (_limanCizimKatmani && _limanMap) {
      try { _limanMap.removeLayer(_limanCizimKatmani); } catch {}
    }
    _limanCizimKatmani = null;
    _limanCizimAktif = false;
    document.getElementById('limanlar-yeni-btn').textContent = '+ Yeni Liman Çiz';
    document.getElementById('limanlar-yeni-btn').removeAttribute('disabled');
  }

  function limanFormKapat() {
    document.getElementById('limanlar-form-panel').classList.add('hidden');
    _limanCizimIptal();
    // Form alanlarını temizle
    ['ad','notlar'].forEach(k => {
      const el = document.getElementById('liman-form-' + k);
      if (el) el.value = '';
    });
  }

  async function limanFormKaydet() {
    if (!_limanCizimKatmani) {
      alert('Önce haritaya polygon çizin.');
      return;
    }
    const ad     = (document.getElementById('liman-form-ad')?.value || '').trim();
    const tip    = document.getElementById('liman-form-tip')?.value || 'liman';
    const ozel   = document.getElementById('liman-form-firma-ozel')?.value === 'true';
    const notlar = (document.getElementById('liman-form-notlar')?.value || '').trim() || null;

    if (!ad) { alert('Liman adı zorunlu.'); return; }

    // GeoJSON üret
    const geoStr = JSON.stringify(_limanCizimKatmani.toGeoJSON().geometry);

    const sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb) { alert('Supabase yok.'); return; }
    try {
      const { data, error } = await sb.rpc('liman_olustur', {
        p_ad: ad,
        p_tip: tip,
        p_poligon_geojson: geoStr,
        p_firma_ozel: ozel,
        p_notlar: notlar
      });
      if (error) throw error;
      if (typeof showToast === 'function') showToast(`✓ "${ad}" eklendi`, 'success');
      limanFormKapat();
      await limanlarYukle();
    } catch (err) {
      alert('Kayıt hatası: ' + (err?.message || err));
    }
  }

  // ────────────────────────────────────────────────────────────
  // Export
  // ────────────────────────────────────────────────────────────
  window.openLimanlarPage = openLimanlarPage;
  window.closeLimanlarPage = closeLimanlarPage;
  window.limanlarYukle = limanlarYukle;
  window.limanlarYeniBaslat = limanlarYeniBaslat;
  window.limanFormKapat = limanFormKapat;
  window.limanFormKaydet = limanFormKaydet;

  if (window.CFG && window.CFG.DEBUG) console.info('[Limanlar] hazır');
})();
