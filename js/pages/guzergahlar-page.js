/* =============================================================================
 * guzergahlar-page.js — Yönetici güzergah moderasyon sayfası
 * -----------------------------------------------------------------------------
 * Backend: 2026_05_11j/k migration'ları.
 * Bağımlılık: GuzergahAPI (js/integrations/guzergah-api.js), Leaflet (mevcut).
 *
 * Akış:
 *   • openGuzergahlarPage() — DOM dinamik kurulur (ilk açılışta)
 *   • Sol: durum filter + liste
 *   • Sağ: seçili güzergahın haritası + aksiyon butonları
 *   • Alt: top kullanılanlar + top paylaşanlar widget
 * =========================================================================== */

(function () {
  'use strict';

  const PAGE_ID = 'guzergahlar-page';
  let _selected = null;
  let _map = null;
  let _polyline = null;
  let _markers = [];
  let _items = [];
  let _filter = 'aktif';

  // ────────── POLYLINE DECODER (Google encoded) ──────────
  // Spec: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  function decodePolyline(encoded) {
    if (!encoded) return [];
    const points = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
      let b, shift = 0, result = 0;
      do {
        if (index >= len) return points;
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dlat;
      shift = 0; result = 0;
      do {
        if (index >= len) return points;
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lng += dlng;
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }

  // ────────── DOM ──────────

  function ensureDom() {
    let page = document.getElementById(PAGE_ID);
    if (page) return page;
    page = document.createElement('section');
    page.id = PAGE_ID;
    page.className = 'app-page';
    page.style.display = 'none';
    page.innerHTML = `
      <header class="page-header">
        <h1>📍 Paylaşılan Güzergahlar</h1>
        <p class="page-subtitle">Şoförlerin paylaştığı güzergahları yönet — TIR için doğru bilinen yollar.</p>
      </header>

      <div class="guzergah-stats" id="guzergah-stats">
        <div class="guzergah-stat"><span class="num" data-stat="paylasim">—</span><span>Aktif paylaşım</span></div>
        <div class="guzergah-stat"><span class="num" data-stat="kullanim">—</span><span>Toplam kullanım</span></div>
        <div class="guzergah-stat"><span class="num" data-stat="begeni">—</span><span>Toplam beğeni</span></div>
      </div>

      <div class="guzergah-layout">
        <aside class="guzergah-side">
          <div class="guzergah-filters">
            <select id="guzergah-durum-filter">
              <option value="aktif">Aktif</option>
              <option value="reddedildi">Reddedilmiş</option>
            </select>
            <input id="guzergah-hedef-arama" type="search" placeholder="Hedef ara…" />
            <button id="guzergah-refresh" class="btn-secondary">Yenile</button>
          </div>
          <div class="guzergah-list" id="guzergah-list">
            <div class="muted">Yükleniyor…</div>
          </div>
        </aside>
        <main class="guzergah-main">
          <div id="guzergah-map" class="guzergah-map"></div>
          <div class="guzergah-detail" id="guzergah-detail">
            <div class="muted">Sol listeden bir güzergah seç.</div>
          </div>
        </main>
      </div>

      <section class="guzergah-toplistler">
        <div class="card">
          <h3>🏆 En çok kullanılan</h3>
          <ol id="guzergah-top-kullanilan" class="topliste"><li class="muted">—</li></ol>
        </div>
        <div class="card">
          <h3>👤 En çok paylaşan</h3>
          <ol id="guzergah-top-paylasan" class="topliste"><li class="muted">—</li></ol>
        </div>
      </section>
    `;
    const main = document.querySelector('main') || document.body;
    main.appendChild(page);
    bindEvents(page);
    return page;
  }

  function bindEvents(page) {
    page.querySelector('#guzergah-durum-filter').addEventListener('change', (e) => {
      _filter = e.target.value;
      refresh();
    });
    page.querySelector('#guzergah-refresh').addEventListener('click', refresh);
    page.querySelector('#guzergah-hedef-arama').addEventListener('input', renderList);
    page.querySelector('#guzergah-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) selectItem(row.dataset.id);
    });
    page.querySelector('#guzergah-detail').addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]');
      if (!act || !_selected) return;
      const id = _selected.id;
      const action = act.dataset.act;
      if (action === 'onayla') return doDurumDegistir(id, 'aktif', null);
      if (action === 'reddet') {
        const not = window.prompt('Reddetme nedeni (isteğe bağlı):', '');
        return doDurumDegistir(id, 'reddedildi', not || null);
      }
      if (action === 'sil') {
        if (!window.confirm('Bu güzergahı silmek istediğine emin misin?')) return;
        return doDurumDegistir(id, 'silindi', null);
      }
    });
  }

  // ────────── DATA ──────────

  async function refresh() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    page.querySelector('#guzergah-list').innerHTML = '<div class="muted">Yükleniyor…</div>';
    try {
      _items = await window.GuzergahAPI.list({ durum: _filter });
    } catch (err) {
      console.error('[guzergah] list:', err);
      _items = [];
    }
    renderList();
    refreshStats();
    refreshTopListeler();
  }

  function renderList() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    const term = (page.querySelector('#guzergah-hedef-arama').value || '').toLowerCase().trim();
    const filtered = term
      ? _items.filter(i => (i.hedef_ad || '').toLowerCase().includes(term)
        || (i.baslik || '').toLowerCase().includes(term))
      : _items;
    const list = page.querySelector('#guzergah-list');
    if (!filtered.length) {
      list.innerHTML = '<div class="muted">Bu filtreyle eşleşen güzergah yok.</div>';
      return;
    }
    list.innerHTML = filtered.map(i => `
      <div class="guzergah-row${_selected && _selected.id === i.id ? ' sel' : ''}" data-id="${i.id}">
        <div class="guzergah-row-baslik">${esc(i.baslik || i.hedef_ad || '—')}</div>
        <div class="guzergah-row-meta">
          📍 ${esc(i.hedef_ad || '—')} ·
          👤 ${esc(soforAd(i))} ·
          📊 ${i.kullanim_sayisi || 0} ·
          ❤ ${i.begeni_sayisi || 0}
        </div>
      </div>
    `).join('');
  }

  function selectItem(id) {
    _selected = _items.find(i => i.id === id) || null;
    renderList();
    renderDetail();
    drawMap();
  }

  function renderDetail() {
    const page = document.getElementById(PAGE_ID);
    const box = page.querySelector('#guzergah-detail');
    if (!_selected) {
      box.innerHTML = '<div class="muted">Sol listeden bir güzergah seç.</div>';
      return;
    }
    const g = _selected;
    const km = g.mesafe_km != null ? g.mesafe_km.toFixed(0) + ' km' : '—';
    const dk = g.tahmini_sure_dk
      ? (g.tahmini_sure_dk >= 60
        ? Math.floor(g.tahmini_sure_dk / 60) + ' sa ' + (g.tahmini_sure_dk % 60) + ' dk'
        : g.tahmini_sure_dk + ' dk')
      : '—';
    const aktif = g.durum === 'aktif';
    const aksiyon = aktif
      ? `<button class="btn-danger" data-act="reddet">Reddet</button>
         <button class="btn-secondary" data-act="sil">Sil</button>`
      : `<button class="btn-primary" data-act="onayla">Aktifleştir</button>
         <button class="btn-secondary" data-act="sil">Sil</button>`;
    box.innerHTML = `
      <h2>${esc(g.baslik || '—')}</h2>
      <p class="muted">📍 ${esc(g.hedef_ad)} · 👤 ${esc(soforAd(g))}</p>
      <div class="guzergah-detay-stats">
        <span>🛣 ${km}</span>
        <span>⏱ ${dk}</span>
        <span>📊 ${g.kullanim_sayisi || 0} kullanım</span>
        <span>❤ ${g.begeni_sayisi || 0} beğeni</span>
      </div>
      ${g.notlar ? `<div class="guzergah-notlar">${esc(g.notlar)}</div>` : ''}
      ${g.yonetici_notu ? `<div class="guzergah-yonetici-notu">📝 ${esc(g.yonetici_notu)}</div>` : ''}
      <div class="guzergah-aksiyonlar">${aksiyon}</div>
    `;
  }

  // ────────── MAP ──────────

  function ensureMap() {
    if (_map) return _map;
    if (typeof L === 'undefined') return null;  // Leaflet henüz yüklenmemiş
    _map = L.map('guzergah-map').setView([41.0082, 28.9784], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(_map);
    return _map;
  }

  function drawMap() {
    const map = ensureMap();
    if (!map || !_selected) return;
    if (_polyline) { map.removeLayer(_polyline); _polyline = null; }
    _markers.forEach(m => map.removeLayer(m));
    _markers = [];

    const g = _selected;
    if (g.baslangic_lat != null && g.baslangic_lng != null) {
      _markers.push(L.marker([g.baslangic_lat, g.baslangic_lng]).addTo(map).bindPopup('Başlangıç'));
    }
    if (g.bitis_lat != null && g.bitis_lng != null) {
      _markers.push(L.marker([g.bitis_lat, g.bitis_lng]).addTo(map).bindPopup('Bitiş: ' + (g.hedef_ad || '')));
    }
    const pts = decodePolyline(g.polyline_encoded || '');
    if (pts.length >= 2) {
      _polyline = L.polyline(pts, { color: '#FF6E20', weight: 5 }).addTo(map);
      map.fitBounds(_polyline.getBounds().pad(0.1));
    } else if (_markers.length) {
      const grp = L.featureGroup(_markers);
      map.fitBounds(grp.getBounds().pad(0.2));
    }
  }

  // ────────── İSTATİSTİK ──────────

  async function refreshStats() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    try {
      const o = await window.GuzergahAPI.genelOzet();
      page.querySelector('[data-stat="paylasim"]').textContent = o.toplam_paylasim;
      page.querySelector('[data-stat="kullanim"]').textContent = o.toplam_kullanim;
      page.querySelector('[data-stat="begeni"]').textContent   = o.toplam_begeni;
    } catch (err) { console.warn('[guzergah] genelOzet:', err); }
  }

  async function refreshTopListeler() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    try {
      const top = await window.GuzergahAPI.topKullanilanlar(5);
      const elK = page.querySelector('#guzergah-top-kullanilan');
      elK.innerHTML = top.length
        ? top.map(g => `<li><b>${esc(g.baslik)}</b><br><small class="muted">${esc(g.hedef_ad)} · 📊 ${g.kullanim_sayisi}</small></li>`).join('')
        : '<li class="muted">Henüz kullanılan güzergah yok.</li>';
    } catch (err) { console.warn('[guzergah] topKullanilanlar:', err); }
    try {
      const top = await window.GuzergahAPI.topPaylasanlar(5);
      const elP = page.querySelector('#guzergah-top-paylasan');
      elP.innerHTML = top.length
        ? top.map(s => `<li><b>${esc(s.ad)}</b> <small class="muted">${s.paylasim_sayisi} paylaşım</small></li>`).join('')
        : '<li class="muted">Henüz paylaşan şoför yok.</li>';
    } catch (err) { console.warn('[guzergah] topPaylasanlar:', err); }
  }

  // ────────── AKSİYON ──────────

  async function doDurumDegistir(id, durum, not) {
    try {
      await window.GuzergahAPI.durumDegistir(id, durum, not);
      _selected = null;
      await refresh();
      if (typeof window.toast === 'function') window.toast('Güncellendi', 'success');
    } catch (err) {
      console.error('[guzergah] durumDegistir:', err);
      alert('İşlem başarısız: ' + (err.message || err));
    }
  }

  // ────────── HELPERS ──────────

  function soforAd(g) {
    const s = g.suruculer || {};
    const full = ((s.ad || '') + ' ' + (s.soyad || '')).trim();
    return full || 'Şoför';
  }

  function esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ────────── PUBLIC ──────────

  function openGuzergahlarPage() {
    ensureDom();
    // Diğer page'leri gizle, bu sayfayı göster
    document.querySelectorAll('.app-page').forEach(p => p.style.display = 'none');
    const page = document.getElementById(PAGE_ID);
    page.style.display = 'block';
    refresh();
    // Map'i pencere açıldıktan sonra init et (containerin boyutu olsun)
    setTimeout(() => {
      const map = ensureMap();
      if (map) map.invalidateSize();
    }, 100);
  }

  window.openGuzergahlarPage = openGuzergahlarPage;
})();
