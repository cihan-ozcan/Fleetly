/* =============================================================================
 * admin/limanlar.js — Sistem limanları (global polygon'lar) yönetimi
 *
 * Tüm firmalara yansır. Sadece platform admin değişiklik yapabilir.
 * Leaflet + Leaflet.draw ile polygon çizim/düzenleme.
 * ===========================================================================*/

(function () {
  'use strict';

  let _map = null;
  let _polygons = [];           // [{ liman, layer }]
  let _draftLayer = null;       // Leaflet.draw geçici polygon
  let _editingLimanId = null;   // null = yeni; uuid = düzenleme
  let _editHandler = null;      // mevcut polygon için edit handler
  let _selectedId = null;

  const RENK = {
    'liman':    '#15181c',
    'fabrika':  '#3f444b',
    'terminal': '#1f6e44',
    'depo':     '#a8392c',
    'servis':   '#8b8f96',
  };
  const TIP_LABEL = {
    'liman':    'Liman',
    'fabrika':  'Fabrika',
    'terminal': 'Terminal',
    'depo':     'Depo',
    'servis':   'Servis',
  };

  async function fetch() {
    const T = window.AdmAPI;
    const listEl = document.getElementById('adm-liman-list');
    listEl.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      // Sadece global limanları çek (firma_id IS NULL)
      const res = await window.fetch(
        T.sbUrl('limanlar?firma_id=is.null&select=*&order=ad.asc'),
        { headers: T.sbHeaders() }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      renderList(rows);
      renderMap(rows);
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function renderList(rows) {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-liman-list');
    if (!rows.length) {
      el.innerHTML = '<div class="adm-empty">Sistem limanı yok. + Yeni Liman ile ekleyin.</div>';
      return;
    }
    el.innerHTML = rows.map(l => `
      <div class="adm-liman-card ${l.id === _selectedId ? 'active' : ''}" data-id="${l.id}" onclick="AdmModule_limanlar.sec('${l.id}')">
        <div class="adm-liman-card-head">
          <i data-icon="anchor"></i>
          <span class="adm-liman-card-name">${T.esc(l.ad)}</span>
          <span class="adm-badge ${l.aktif ? 'adm-badge-success' : 'adm-badge-danger'}">
            ${l.aktif ? 'aktif' : 'pasif'}
          </span>
        </div>
        <div class="adm-liman-card-meta">
          ${T.esc(TIP_LABEL[l.tip] || l.tip)} ·
          ${l.merkez_lat ? l.merkez_lat.toFixed(4) + ', ' + l.merkez_lng.toFixed(4) : '—'}
        </div>
        ${l.notlar ? `<div class="adm-liman-card-meta" style="margin-top:4px;">${T.esc(l.notlar.slice(0,80))}</div>` : ''}
        <div class="adm-liman-card-actions" onclick="event.stopPropagation()">
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_limanlar.duzenle('${l.id}')">
            <i data-icon="edit"></i> Düzenle
          </button>
          <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_limanlar.adDegistir('${l.id}', '${T.esc(l.ad)}')">
            <i data-icon="pencil"></i> Ad/Tip
          </button>
          <button class="adm-btn adm-btn-danger adm-btn-small" onclick="AdmModule_limanlar.sil('${l.id}', '${T.esc(l.ad)}')">
            <i data-icon="trash"></i>
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderMap(rows) {
    if (!_map) initMap();
    // Eski polygon'ları temizle
    _polygons.forEach(p => _map.removeLayer(p.layer));
    _polygons = [];

    if (!rows.length) return;

    const fg = L.featureGroup();
    rows.forEach(l => {
      if (!l.poligon) return;
      try {
        // Supabase'den poligon GeoJSON olarak gelmiyor; ST_AsGeoJSON ile select edilmemiş.
        // Alternatif: ayrı RPC ile geometry json çekeriz. Şimdilik merkez koordinattan
        // küçük bir kutucuk oluşturalım (asıl polygon edit modunda detaylı işlenir).
        // Daha doğru: backend'de bir view oluştur veya poligon select listesini geojson formatında dön.
      } catch {}
    });

    // Tüm limanları geojson olarak almak için ayrı bir REST sorgusu:
    // PostgREST select=poligon dönüyor, ama geometry text formatında.
    // Alternatif: yeni RPC ekleyebiliriz; şimdilik aşağıda fallback.
    fetchPolygonsGeoJSON(rows);
  }

  async function fetchPolygonsGeoJSON(rows) {
    const T = window.AdmAPI;
    // PostgREST'te geometry → text gelir. ST_AsGeoJSON ile select etmek gerek.
    // RPC ile alalım (yoksa REST'te `?select=id,ad,tip,poligon::text` ile WKT).
    // En basit: REST select=*,ST_AsGeoJSON(poligon)... → PostgREST direct fonksiyon çağrısı zor.
    // Pratik: her liman için RPC yok; ama mevcut sistemde liman_polygon_geojson RPC'si veya
    // direct SQL view gerek. Geçici çözüm: WKT'yi parse et.
    //
    // PostgREST default: poligon → 'POLYGON((28.66 40.97, ...))' text döner.
    const fg = L.featureGroup();
    rows.forEach(l => {
      const wkt = l.poligon;
      if (!wkt) return;
      const coords = parseWKTPolygon(wkt);
      if (!coords) return;
      const layer = L.polygon(coords, {
        color: RENK[l.tip] || RENK.liman,
        weight: 2,
        fillOpacity: 0.18,
        fillColor: RENK[l.tip] || RENK.liman,
      });
      layer.bindTooltip(l.ad, { permanent: false, direction: 'top' });
      layer.on('click', () => sec(l.id));
      _polygons.push({ liman: l, layer });
      layer.addTo(_map);
      fg.addLayer(layer);
    });
    if (fg.getLayers().length > 0) {
      _map.fitBounds(fg.getBounds(), { padding: [40, 40], maxZoom: 13 });
    }
  }

  function parseWKTPolygon(wkt) {
    // 'POLYGON((28.66 40.97,28.68 40.97,...))' veya 'SRID=4326;POLYGON((...))'
    if (!wkt || typeof wkt !== 'string') return null;
    const m = wkt.match(/POLYGON\s*\(\s*\(([^)]+)\)\s*\)/i);
    if (!m) return null;
    return m[1].split(',').map(p => {
      const [lng, lat] = p.trim().split(/\s+/).map(Number);
      return [lat, lng];
    });
  }

  function initMap() {
    _map = L.map('adm-liman-map', { zoomControl: true, attributionControl: true })
      .setView([40.97, 28.7], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(_map);
  }

  function sec(id) {
    _selectedId = id;
    document.querySelectorAll('.adm-liman-card').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-id') === id);
    });
    const found = _polygons.find(p => p.liman.id === id);
    if (found && _map) {
      _map.fitBounds(found.layer.getBounds(), { padding: [40, 40], maxZoom: 14 });
    }
  }

  // Yeni liman çiz
  function yeni() {
    const T = window.AdmAPI;
    _editingLimanId = null;
    cizimIptal();
    if (!L.Control.Draw) {
      T.toast('Leaflet.draw eklentisi yüklenmedi', 'error');
      return;
    }
    const drawer = new L.Draw.Polygon(_map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: '#15181c', weight: 2, fillOpacity: 0.15 },
    });
    drawer.enable();
    T.toast('Polygon çiz, son noktayı tıkla; tamamlanınca form açılır.', 'info');

    _map.once(L.Draw.Event.CREATED, e => {
      _draftLayer = e.layer;
      _draftLayer.addTo(_map);
      formAc({ yeni: true });
    });
  }

  // Düzenleme
  function duzenle(id) {
    const T = window.AdmAPI;
    const found = _polygons.find(p => p.liman.id === id);
    if (!found) { T.toast('Liman bulunamadı', 'error'); return; }
    _editingLimanId = id;
    _editHandler = new L.EditToolbar.Edit(_map, {
      featureGroup: L.featureGroup([found.layer]),
      selectedPathOptions: { dashArray: '4 4' },
    });
    _editHandler.enable();
    sec(id);
    T.toast('Polygon kenarlarını sürükle, sonra Kaydet', 'info');
    formAc({ liman: found.liman, edit: true });
  }

  function formAc(opts) {
    const T = window.AdmAPI;
    opts = opts || {};
    const l = opts.liman || {};
    const baslik = opts.yeni ? 'Yeni Sistem Limanı' : 'Liman Düzenle: ' + (l.ad || '—');
    const html = `
      <p style="font-size:13px;color:var(--adm-ink-2);margin:0 0 16px;">
        ${opts.yeni
          ? 'Yeni global liman oluşturuluyor. <strong>Tüm firmalar</strong> bu sınırı görecek.'
          : 'Mevcut global liman düzenleniyor. Polygon harita üzerinde, ad/tip aşağıda.'}
      </p>
      <div class="adm-form-row">
        <div class="adm-form-group">
          <label class="adm-label">Liman Adı</label>
          <input type="text" id="adm-fl-ad" class="adm-input" value="${T.esc(l.ad || '')}" placeholder="Örn: Marport">
        </div>
        <div class="adm-form-group">
          <label class="adm-label">Tip</label>
          <select id="adm-fl-tip" class="adm-input">
            <option value="liman"${l.tip==='liman'?' selected':''}>Liman</option>
            <option value="fabrika"${l.tip==='fabrika'?' selected':''}>Fabrika</option>
            <option value="terminal"${l.tip==='terminal'?' selected':''}>Terminal</option>
            <option value="depo"${l.tip==='depo'?' selected':''}>Depo</option>
            <option value="servis"${l.tip==='servis'?' selected':''}>Servis</option>
          </select>
        </div>
      </div>
      <div class="adm-form-group">
        <label class="adm-label">Notlar (opsiyonel)</label>
        <textarea id="adm-fl-not" class="adm-input">${T.esc(l.notlar || '')}</textarea>
      </div>
      ${opts.edit ? `
        <div class="adm-form-group">
          <label class="adm-label">Durum</label>
          <select id="adm-fl-aktif" class="adm-input">
            <option value="true"${l.aktif !== false ? ' selected' : ''}>Aktif</option>
            <option value="false"${l.aktif === false ? ' selected' : ''}>Pasif (gizlendi)</option>
          </select>
        </div>
      ` : ''}
      <div class="adm-modal-actions">
        <button class="adm-btn adm-btn-ghost" onclick="AdmModule_limanlar.cizimIptal()">İptal</button>
        <button class="adm-btn adm-btn-primary" onclick="AdmModule_limanlar.kaydet(${opts.yeni ? 'true' : 'false'})">Kaydet</button>
      </div>
    `;
    T.modalAc(baslik, html);
  }

  async function kaydet(yeni) {
    const T = window.AdmAPI;
    const ad = document.getElementById('adm-fl-ad').value.trim();
    const tip = document.getElementById('adm-fl-tip').value;
    const not = document.getElementById('adm-fl-not').value.trim() || null;
    const aktifSelect = document.getElementById('adm-fl-aktif');
    const aktif = aktifSelect ? aktifSelect.value === 'true' : null;

    if (!ad) { T.toast('Ad gerekli', 'error'); return; }

    try {
      if (yeni) {
        if (!_draftLayer) { T.toast('Polygon çizilmedi', 'error'); return; }
        const geojson = _draftLayer.toGeoJSON().geometry;
        await T.rpc('liman_olustur', {
          p_ad: ad,
          p_tip: tip,
          p_poligon_geojson: JSON.stringify(geojson),
          p_global: true,
          p_notlar: not,
        });
        T.toast('Sistem limanı oluşturuldu', 'success');
      } else {
        const polyOpts = { p_id: _editingLimanId, p_ad: ad, p_tip: tip, p_notlar: not };
        if (aktif !== null) polyOpts.p_aktif = aktif;
        // Eğer edit handler aktifse, layer'ı al ve geojson yolla
        const found = _polygons.find(p => p.liman.id === _editingLimanId);
        if (_editHandler && found) {
          const geojson = found.layer.toGeoJSON().geometry;
          polyOpts.p_poligon_geojson = JSON.stringify(geojson);
        }
        await T.rpc('liman_guncelle', polyOpts);
        T.toast('Liman güncellendi', 'success');
      }
      cizimIptal();
      T.modalKapat();
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  function cizimIptal() {
    if (_draftLayer && _map) {
      _map.removeLayer(_draftLayer);
      _draftLayer = null;
    }
    if (_editHandler) {
      _editHandler.disable();
      _editHandler = null;
    }
    _editingLimanId = null;
  }

  async function sil(id, ad) {
    const T = window.AdmAPI;
    if (!confirm(`"${ad}" limanını silmek istediğine emin misin?\n\nTüm ziyaret kayıtları ve yoğunluk verisi de silinecek. Bu işlem geri alınamaz.`)) {
      return;
    }
    try {
      await T.rpc('liman_sil', { p_id: id });
      T.toast(`"${ad}" silindi`, 'success');
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  async function adDegistir(id, mevcutAd) {
    const T = window.AdmAPI;
    const yeni = prompt('Yeni ad:', mevcutAd);
    if (!yeni || yeni === mevcutAd) return;
    try {
      await T.rpc('liman_guncelle', { p_id: id, p_ad: yeni });
      T.toast('Ad güncellendi', 'success');
      fetch();
    } catch (err) {
      T.toast('Hata: ' + err.message, 'error');
    }
  }

  // "Yeni Liman" butonu
  function bindButons() {
    document.getElementById('adm-liman-yeni')?.addEventListener('click', yeni);
  }

  window.AdmModule_limanlar = {
    init: () => { bindButons(); fetch(); },
    onShow: fetch,
    sec, duzenle, sil, adDegistir, yeni, kaydet, cizimIptal,
  };
  window.admLimanlarYenile = fetch;
})();
