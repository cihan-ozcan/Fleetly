/* ============================================================================
   app-chunk-surucu-takip.js — Sürücü Takip Paneli
   Sürücü Belge Yönetimi modalı içinde "📍 Sürücü Takibi" alt sekmesi.
   Sol: sürücü listesi   Sağ: 3 tab (Güzergah, İş Listesi, Foto Galerisi)
   ============================================================================ */

/* Global state — diğer modüllerle çakışmasın diye window'a tek obje */
window.surucuTakipState = {
  suruculer       : [],   // {id, ad, soyad, avatar_url, durum, _aktifIs}
  aktifSurucuId   : null,
  aktifTab        : 'harita',
  isEmirleri      : [],   // seçilen sürücünün son 30 gün iş emirleri
  fotograflar     : [],   // {url, ts, lat, lng, isEmri, ...} düzleştirilmiş
  fotoFilter      : 'all',
  konumIzleri     : [],   // son 24 saat
  realtimeChannel : null,
  refreshTimer    : null,
  // Harita
  map             : null,
  layers          : [],
  // Lightbox
  lightboxIndex   : 0,
  lightboxMap     : null,
  lightboxMarker  : null,
};

const _ST = window.surucuTakipState;

/* ──────────────────────────────────────────────────────────────────────────
   GİRİŞ NOKTASI — switchDsTab('takip') tetiklediğinde
   ──────────────────────────────────────────────────────────────────────── */
async function surucuTakipAc() {
  await surucuTakipSuruculeriYukle();
  surucuTakipRenderListe();
  surucuTakipStartRealtime();
}

function surucuTakipKapat() {
  surucuTakipStopRealtime();
  if (_ST.map)         { try { _ST.map.remove(); } catch {} _ST.map = null; }
  if (_ST.lightboxMap) { try { _ST.lightboxMap.remove(); } catch {} _ST.lightboxMap = null; }
  _ST.layers = [];
}

/* ──────────────────────────────────────────────────────────────────────────
   1) SÜRÜCÜ LİSTESİ — sol panel
   ──────────────────────────────────────────────────────────────────────── */
async function surucuTakipSuruculeriYukle() {
  const sb = (typeof getSB === 'function') ? getSB() : null;
  const firmaId = (typeof currentFirmaId !== 'undefined') ? currentFirmaId : null;
  if (!sb || !firmaId) { _ST.suruculer = []; return; }
  try {
    const { data, error } = await sb
      .from('suruculer')
      .select('id, ad, soyad, avatar_url, durum, telefon_e164')
      .eq('firma_id', firmaId)
      .neq('durum', 'silindi')
      .order('ad', { ascending: true });
    if (error) throw error;
    _ST.suruculer = data || [];

    // Her sürücünün şu an aktif iş emrini bul (badge için)
    if (_ST.suruculer.length) {
      const surucuIds = _ST.suruculer.map(s => s.id);
      const { data: aktifIsler } = await sb
        .from('is_emirleri')
        .select('id, surucu_id, durum')
        .in('surucu_id', surucuIds)
        .in('durum', ['Yolda', 'Fabrikada', 'Bekliyor']);
      const byId = {};
      (aktifIsler || []).forEach(ie => {
        // Her sürücü için en aktif olanı tut (Yolda > Fabrikada > Bekliyor)
        const oncelik = { 'Yolda': 3, 'Fabrikada': 2, 'Bekliyor': 1 };
        const cur = byId[ie.surucu_id];
        if (!cur || (oncelik[ie.durum]||0) > (oncelik[cur.durum]||0)) {
          byId[ie.surucu_id] = ie;
        }
      });
      _ST.suruculer.forEach(s => { s._aktifIs = byId[s.id] || null; });
    }
  } catch (err) {
    console.error('Sürücüler yüklenemedi:', err);
    _ST.suruculer = [];
  }
}

function surucuTakipRenderListe() {
  const list = document.getElementById('st-driver-list');
  if (!list) return;
  const q = (document.getElementById('st-search')?.value || '').toLowerCase().trim();
  const filtered = _ST.suruculer.filter(s => {
    if (!q) return true;
    const tam = `${s.ad||''} ${s.soyad||''}`.toLowerCase();
    return tam.includes(q) || (s.telefon_e164||'').includes(q);
  });
  if (!filtered.length) {
    list.innerHTML = `<div class="st-empty">${q ? '🔍 Sürücü bulunamadı' : '👤 Henüz sürücü yok'}</div>`;
    return;
  }
  list.innerHTML = filtered.map(s => {
    const tam = `${s.ad || ''} ${s.soyad || ''}`.trim() || 'İsimsiz';
    const aktif = _ST.aktifSurucuId === s.id ? 'active' : '';
    const aktifIs = s._aktifIs;
    let badge;
    if (aktifIs?.durum === 'Yolda')          badge = '<span class="badge st-badge-yolda">🟢 Yolda</span>';
    else if (aktifIs?.durum === 'Fabrikada') badge = '<span class="badge st-badge-yolda">🏭 Fabrikada</span>';
    else if (aktifIs?.durum === 'Bekliyor')  badge = '<span class="badge st-badge-bekliyor">🟡 Bekliyor</span>';
    else if (s.durum === 'aktif')            badge = '<span class="badge st-badge-teslim">✓ Müsait</span>';
    else                                      badge = '<span class="badge st-badge-pasif">⚫ Pasif</span>';
    const av = s.avatar_url
      ? `<img src="${s.avatar_url}" alt="${tam}" onerror="this.style.display='none';this.parentNode.textContent='👤';">`
      : '👤';
    return `
      <div class="st-driver-card ${aktif}" onclick="surucuTakipSurucuSec('${s.id}')">
        <div class="av">${av}</div>
        <div class="info">
          <div class="name">${_stEsc(tam)}</div>
          <div class="meta">${badge}</div>
        </div>
      </div>`;
  }).join('');
}

async function surucuTakipSurucuSec(surucuId) {
  _ST.aktifSurucuId = surucuId;
  _ST.aktifTab = 'harita';
  surucuTakipRenderListe(); // active highlight
  await surucuTakipDetayYukle();
  surucuTakipRenderTabs();
  // İlk açılışta haritayı render et
  setTimeout(() => surucuTakipTabAc('harita'), 60);
}

/* ──────────────────────────────────────────────────────────────────────────
   2) DETAY VERİLERİ — seçilen sürücü için iş emirleri + konum izleri
   ──────────────────────────────────────────────────────────────────────── */
async function surucuTakipDetayYukle() {
  if (!_ST.aktifSurucuId) return;
  const sb = getSB();
  const firmaId = currentFirmaId;
  if (!sb || !firmaId) return;

  // Son 30 gün iş emirleri
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: ies, error: e1 } = await sb
      .from('is_emirleri')
      .select('id, musteri_adi, arac_plaka, durum, fotograflar, yukle_yeri, teslim_yeri, yukle_lat, yukle_lng, teslim_lat, teslim_lng, konum_lat, konum_lng, konum_zaman, atama_zamani, yola_zaman, teslim_zamani, baslangic_km, bitis_km, created_at')
      .eq('firma_id', firmaId)
      .eq('surucu_id', _ST.aktifSurucuId)
      .gte('atama_zamani', cutoff)
      .order('atama_zamani', { ascending: false });
    if (e1) throw e1;
    _ST.isEmirleri = ies || [];

    // Fotoğrafları düzleştir
    _ST.fotograflar = [];
    _ST.isEmirleri.forEach(ie => {
      let fotos = [];
      try {
        fotos = typeof ie.fotograflar === 'string' ? JSON.parse(ie.fotograflar || '[]')
              : Array.isArray(ie.fotograflar) ? ie.fotograflar : [];
      } catch { fotos = []; }
      fotos.forEach(f => {
        if (!f?.url) return;
        // Fotoğrafın konumu yoksa iş emrinin teslim/konum koordinatlarına fallback
        const lat = f.lat ?? ie.konum_lat ?? ie.teslim_lat ?? null;
        const lng = f.lng ?? ie.konum_lng ?? ie.teslim_lng ?? null;
        _ST.fotograflar.push({
          url: f.url,
          tip: f.tip || 'Diğer',
          ts:  f.ts  || ie.atama_zamani,
          lat, lng,
          is_emri_id: ie.id,
          musteri:  ie.musteri_adi || '',
          plaka:    ie.arac_plaka  || '',
          adres:    ie.teslim_yeri || ie.yukle_yeri || '',
          durum:    ie.durum
        });
      });
    });
    // Yeni fotolar üstte
    _ST.fotograflar.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  } catch (err) {
    console.error('İş emirleri yüklenemedi:', err);
    _ST.isEmirleri = [];
    _ST.fotograflar = [];
  }

  // Son 24 saat konum izleri
  const dunIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    // Konum izleri user_id ile değil is_emri_id ile bağlı, sürücünün son 24 saatlik
    // tüm iş emirlerinden gelen izler:
    const isIds = _ST.isEmirleri.map(ie => ie.id);
    if (isIds.length) {
      const { data: izler } = await sb
        .from('konum_izleri')
        .select('lat, lng, hiz, ts, is_emri_id')
        .in('is_emri_id', isIds)
        .gte('ts', dunIso)
        .order('ts', { ascending: true });
      _ST.konumIzleri = izler || [];
    } else {
      _ST.konumIzleri = [];
    }
  } catch (err) {
    console.error('Konum izleri yüklenemedi:', err);
    _ST.konumIzleri = [];
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   3) SAĞ PANEL — header + tabs render
   ──────────────────────────────────────────────────────────────────────── */
function surucuTakipRenderTabs() {
  const host = document.getElementById('st-right');
  if (!host) return;
  const s = _ST.suruculer.find(x => x.id === _ST.aktifSurucuId);
  if (!s) {
    host.innerHTML = `<div class="st-empty-detail"><div class="icon">👈</div>Soldan bir sürücü seçin.</div>`;
    return;
  }
  const tam = `${s.ad || ''} ${s.soyad || ''}`.trim() || 'İsimsiz';
  const aktifIs = _ST.isEmirleri.find(ie => ['Yolda','Fabrikada'].includes(ie.durum));
  const sonKonum = aktifIs?.konum_zaman ? _stRelTime(aktifIs.konum_zaman) : '—';
  const aktifPlaka = aktifIs?.arac_plaka || '—';

  host.innerHTML = `
    <div class="st-right-header">
      <div class="title">📍 ${_stEsc(tam)}<span style="font-size:11px;font-weight:500;color:var(--muted);margin-left:6px;">${_stEsc(aktifPlaka)}</span></div>
      <div class="live-stats">
        <span title="Aktif iş emri">${aktifIs ? `🚛 İş #${aktifIs.id}` : '— iş yok'}</span>
        <span title="Son konum güncellemesi">📡 ${sonKonum}</span>
      </div>
    </div>
    <div class="st-tabs">
      <button class="st-tab ${_ST.aktifTab==='harita'?'active':''}" data-tab="harita" onclick="surucuTakipTabAc('harita')">🗺️ Güzergah & Konum</button>
      <button class="st-tab ${_ST.aktifTab==='isler'?'active':''}"  data-tab="isler"  onclick="surucuTakipTabAc('isler')">📋 İş Listesi</button>
      <button class="st-tab ${_ST.aktifTab==='foto'?'active':''}"   data-tab="foto"   onclick="surucuTakipTabAc('foto')">📸 Fotoğraflar</button>
    </div>
    <div class="st-tab-panel ${_ST.aktifTab==='harita'?'active':''}" id="st-panel-harita">
      <div id="st-map" class="st-map"></div>
    </div>
    <div class="st-tab-panel ${_ST.aktifTab==='isler'?'active':''}" id="st-panel-isler"></div>
    <div class="st-tab-panel ${_ST.aktifTab==='foto'?'active':''}"   id="st-panel-foto"></div>
  `;
}

function surucuTakipTabAc(name) {
  _ST.aktifTab = name;
  document.querySelectorAll('#st-right .st-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('#st-right .st-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'st-panel-' + name));
  if (name === 'harita') surucuTakipRenderHarita();
  if (name === 'isler')  surucuTakipRenderIsler();
  if (name === 'foto')   surucuTakipRenderFotolar();
}

/* ──────────────────────────────────────────────────────────────────────────
   TAB 1: HARİTA — son konum + aktif rota + 24h iz
   ──────────────────────────────────────────────────────────────────────── */
function surucuTakipRenderHarita() {
  const el = document.getElementById('st-map');
  if (!el || typeof L === 'undefined') return;
  if (!_ST.map) {
    _ST.map = L.map(el, { zoomControl: true, attributionControl: false }).setView([39.9, 32.8], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_ST.map);
    L.control.attribution({ prefix: '© OpenStreetMap' }).addTo(_ST.map);
  }
  setTimeout(() => _ST.map.invalidateSize(), 60);

  // Eski katmanları temizle
  _ST.layers.forEach(l => { try { _ST.map.removeLayer(l); } catch {} });
  _ST.layers = [];

  const aktifIs = _ST.isEmirleri.find(ie => ['Yolda','Fabrikada'].includes(ie.durum));
  const bounds = [];

  // 24 saat iz — Google Maps stili (beyaz halo + canlı mavi)
  // Önce ham GPS izi (dashed, "yükleniyor" sinyali), sonra OSRM snap ile değiştirilir.
  if (_ST.konumIzleri.length) {
    const rawLatlngs = _ST.konumIzleri.map(p => [p.lat, p.lng]);
    const drawTrail = (pts, dashed) => {
      const halo = L.polyline(pts, {
        color: '#ffffff', weight: 9, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round'
      }).addTo(_ST.map);
      const main = L.polyline(pts, {
        color: '#1a73e8', weight: 5, opacity: 1,
        lineCap: 'round', lineJoin: 'round',
        ...(dashed ? { dashArray: '8,6' } : {})
      }).addTo(_ST.map);
      _ST.layers.push(halo, main);
      return main;
    };
    drawTrail(rawLatlngs, true);
    bounds.push(...rawLatlngs);

    // OSRM snap (chunk-05.js'te tanımlı _opsOsrmMatch global olarak erişilebilir)
    if (typeof _opsOsrmMatch === 'function') {
      _opsOsrmMatch(rawLatlngs).then(snapped => {
        if (!snapped) return;
        // Önceki polyline'ları çıkar (marker'lar kalsın)
        _ST.layers = _ST.layers.filter(layer => {
          if (layer instanceof L.Polyline) {
            try { _ST.map.removeLayer(layer); } catch {}
            return false;
          }
          return true;
        });
        drawTrail(snapped, false);
      });
    }
  }

  // Aktif rotayı çiz (yükle → teslim)
  // NOT: isFinite(null) === true + typeof null === 'object' → L.latLng([null,null])
  // sessizce null döner ve _project patlar. parseFloat + Number.isFinite ile guard.
  if (aktifIs) {
    const aYL = parseFloat(aktifIs.yukle_lat),  aYG = parseFloat(aktifIs.yukle_lng);
    const aTL = parseFloat(aktifIs.teslim_lat), aTG = parseFloat(aktifIs.teslim_lng);
    const aKL = parseFloat(aktifIs.konum_lat),  aKG = parseFloat(aktifIs.konum_lng);
    const yukleOk  = Number.isFinite(aYL) && Number.isFinite(aYG);
    const teslimOk = Number.isFinite(aTL) && Number.isFinite(aTG);
    const konumOk  = Number.isFinite(aKL) && Number.isFinite(aKG);

    if (yukleOk && teslimOk) {
      const route = L.polyline(
        [[aYL, aYG], [aTL, aTG]],
        { color: '#38bdf8', weight: 4, opacity: .85 }
      ).addTo(_ST.map);
      _ST.layers.push(route);
      bounds.push([aYL, aYG], [aTL, aTG]);
    }
    // Yükle (yeşil)
    if (yukleOk) {
      const m = L.marker([aYL, aYG], {
        icon: _stIcon('#22c55e', 'Y'), title: 'Yükleme: ' + (aktifIs.yukle_yeri || '')
      }).addTo(_ST.map);
      _ST.layers.push(m);
    }
    // Teslim (kırmızı)
    if (teslimOk) {
      const m = L.marker([aTL, aTG], {
        icon: _stIcon('#ef4444', 'T'), title: 'Teslim: ' + (aktifIs.teslim_yeri || '')
      }).addTo(_ST.map);
      _ST.layers.push(m);
    }
    // Son canlı konum (mavi puls)
    if (konumOk) {
      const m = L.marker([aKL, aKG], {
        icon: _stIcon('#38bdf8', '●', true), title: 'Son konum: ' + _stRelTime(aktifIs.konum_zaman)
      }).addTo(_ST.map);
      _ST.layers.push(m);
      bounds.push([aKL, aKG]);
    }
  }

  if (bounds.length) {
    _ST.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  } else {
    el.insertAdjacentHTML('beforeend',
      `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;background:rgba(8,9,26,.6);pointer-events:none;">
         📍 Bu sürücü için son 24 saatte konum kaydı yok.
       </div>`);
  }
}

function _stIcon(color, label, pulse) {
  const pulseStyle = pulse
    ? `box-shadow:0 0 0 0 ${color}cc;animation:stPulse 1.4s infinite;`
    : '';
  return L.divIcon({
    className: 'st-leaf-icon',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.5);${pulseStyle}">${label}</div>`,
    iconSize: [22,22], iconAnchor: [11,11]
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   TAB 2: İŞ LİSTESİ
   ──────────────────────────────────────────────────────────────────────── */
function surucuTakipRenderIsler() {
  const host = document.getElementById('st-panel-isler');
  if (!host) return;
  const ies = _ST.isEmirleri;
  const toplam = ies.length;
  const tamamlanan = ies.filter(ie => ie.durum === 'Teslim Edildi').length;
  const yuzde = toplam ? Math.round((tamamlanan / toplam) * 100) : 0;
  const buAyKm = ies
    .filter(ie => ie.bitis_km != null && ie.baslangic_km != null && new Date(ie.atama_zamani) > new Date(Date.now() - 30*24*3600*1000))
    .reduce((sum, ie) => sum + Math.max(0, +ie.bitis_km - +ie.baslangic_km), 0);

  if (!ies.length) {
    host.innerHTML = `<div class="st-jobs-empty">📋 Son 30 günde iş emri yok.</div>`;
    return;
  }

  host.innerHTML = `
    <div class="st-jobs">
      <div class="st-jobs-stats">
        <div class="st-jobs-stat"><div class="v">${toplam}</div><div class="l">Toplam İş</div></div>
        <div class="st-jobs-stat"><div class="v" style="color:var(--green);">${tamamlanan}</div><div class="l">Tamamlanan</div></div>
        <div class="st-jobs-stat"><div class="v" style="color:var(--blue);">${yuzde}%</div><div class="l">Başarı Oranı</div></div>
        <div class="st-jobs-stat"><div class="v" style="color:var(--accent);">${Math.round(buAyKm).toLocaleString('tr-TR')}</div><div class="l">30 Gün Km</div></div>
      </div>
      <table class="st-jobs-table">
        <thead><tr>
          <th>Tarih</th><th>Müşteri</th><th>Nereden</th><th>Nereye</th>
          <th>Durum</th><th style="text-align:right;">Foto</th>
        </tr></thead>
        <tbody>
          ${ies.map(ie => {
            let fotoCount = 0;
            try {
              const f = typeof ie.fotograflar === 'string' ? JSON.parse(ie.fotograflar||'[]') : (ie.fotograflar||[]);
              fotoCount = Array.isArray(f) ? f.length : 0;
            } catch {}
            return `
              <tr onclick="surucuTakipIsTikla(${ie.id})">
                <td><span style="font-family:var(--font-mono);font-size:11.5px;">${_stTarih(ie.atama_zamani)}</span></td>
                <td>${_stEsc(ie.musteri_adi || '—')}</td>
                <td style="font-size:12px;color:var(--text2);">${_stEsc(ie.yukle_yeri || '—')}</td>
                <td style="font-size:12px;color:var(--text2);">${_stEsc(ie.teslim_yeri || '—')}</td>
                <td>${_stDurumBadge(ie.durum)}</td>
                <td style="text-align:right;">${fotoCount ? `<span style="background:var(--surface3);padding:2px 8px;border-radius:99px;font-family:var(--font-mono);font-size:10.5px;">📸 ${fotoCount}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function _stDurumBadge(d) {
  const map = {
    'Bekliyor':       { c: 'var(--yellow)', bg: 'rgba(212,168,71,.14)' },
    'Yolda':          { c: 'var(--blue)',   bg: 'rgba(56,189,248,.14)' },
    'Fabrikada':      { c: 'var(--accent)', bg: 'rgba(232,82,26,.14)' },
    'Teslim Edildi':  { c: 'var(--green)',  bg: 'rgba(34,197,94,.14)' },
    'İptal':          { c: 'var(--red)',    bg: 'rgba(239,68,68,.14)' }
  };
  const x = map[d] || map['Bekliyor'];
  return `<span style="font-size:10.5px;font-weight:700;color:${x.c};background:${x.bg};border:1px solid ${x.c}40;padding:2px 8px;border-radius:99px;">${d}</span>`;
}

function surucuTakipIsTikla(isId) {
  // O iş emrinin fotolarına atla
  surucuTakipTabAc('foto');
  setTimeout(() => {
    const idx = _ST.fotograflar.findIndex(f => f.is_emri_id === isId);
    if (idx >= 0) surucuTakipLightboxAc(idx);
  }, 100);
}

/* ──────────────────────────────────────────────────────────────────────────
   TAB 3: FOTOĞRAF GALERİSİ
   ──────────────────────────────────────────────────────────────────────── */
function surucuTakipRenderFotolar() {
  const host = document.getElementById('st-panel-foto');
  if (!host) return;
  const all = _ST.fotograflar;
  const filt = _ST.fotoFilter;
  const now = Date.now();
  const filtered = all.filter(f => {
    const age = now - new Date(f.ts).getTime();
    if (filt === 'hafta') return age <= 7  * 24 * 3600 * 1000;
    if (filt === 'ay')    return age <= 30 * 24 * 3600 * 1000;
    return true;
  });

  host.innerHTML = `
    <div class="st-photos-toolbar">
      <select id="st-foto-filter" onchange="surucuTakipFotoFiltreDegistir(this.value)">
        <option value="all"   ${filt==='all'?'selected':''}>Tümü</option>
        <option value="hafta" ${filt==='hafta'?'selected':''}>Bu hafta</option>
        <option value="ay"    ${filt==='ay'?'selected':''}>Bu ay</option>
      </select>
      <span style="color:var(--muted);font-size:12px;">${filtered.length} fotoğraf</span>
      <button class="st-btn-download" id="st-foto-zip" onclick="surucuTakipFotoZipIndir()" ${filtered.length?'':'disabled'}>📥 Tümünü İndir</button>
    </div>
    <div class="st-photos-grid">
      ${filtered.length ? filtered.map((f, i) => `
        <div class="st-photo-card" onclick="surucuTakipLightboxAc(${all.indexOf(f)})">
          <img class="st-photo-thumb" src="${f.url}" alt="${_stEsc(f.tip)}" loading="lazy" onerror="this.style.background='var(--red-dim)';this.alt='⚠ Yüklenemedi';">
          <div class="st-photo-meta">
            <div class="when">${_stTarih(f.ts)} · ${_stEsc(f.tip||'Foto')}</div>
            <div class="where">📍 ${_stEsc(f.adres || '—')}</div>
          </div>
        </div>`).join('') : `<div class="st-photos-empty">📸 Bu zaman aralığında fotoğraf yok.</div>`}
    </div>`;
}

function surucuTakipFotoFiltreDegistir(v) {
  _ST.fotoFilter = v;
  surucuTakipRenderFotolar();
}

/* ──────────────────────────────────────────────────────────────────────────
   LIGHTBOX
   ──────────────────────────────────────────────────────────────────────── */
function surucuTakipLightboxAc(index) {
  if (index < 0 || index >= _ST.fotograflar.length) return;
  _ST.lightboxIndex = index;
  const lb = document.getElementById('surucu-foto-modal');
  if (!lb) return;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  surucuTakipLightboxRender();
  document.addEventListener('keydown', _stLightboxKey);
}

function surucuTakipLightboxKapat() {
  const lb = document.getElementById('surucu-foto-modal');
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _stLightboxKey);
  if (_ST.lightboxMap) {
    try { _ST.lightboxMap.remove(); } catch {}
    _ST.lightboxMap = null;
    _ST.lightboxMarker = null;
  }
}

function surucuTakipLightboxIleri() {
  if (_ST.lightboxIndex < _ST.fotograflar.length - 1) {
    _ST.lightboxIndex++;
    surucuTakipLightboxRender();
  }
}
function surucuTakipLightboxGeri() {
  if (_ST.lightboxIndex > 0) {
    _ST.lightboxIndex--;
    surucuTakipLightboxRender();
  }
}

function _stLightboxKey(ev) {
  if (ev.key === 'ArrowRight') surucuTakipLightboxIleri();
  if (ev.key === 'ArrowLeft')  surucuTakipLightboxGeri();
  if (ev.key === 'Escape')     surucuTakipLightboxKapat();
}

function surucuTakipLightboxRender() {
  const f = _ST.fotograflar[_ST.lightboxIndex];
  if (!f) return;
  const img    = document.getElementById('st-lb-img');
  const side   = document.getElementById('st-lb-side');
  const cnt    = document.getElementById('st-lb-counter');
  const prev   = document.getElementById('st-lb-prev');
  const next   = document.getElementById('st-lb-next');
  if (img)  img.src = f.url;
  if (cnt)  cnt.textContent = `${_ST.lightboxIndex+1} / ${_ST.fotograflar.length}`;
  if (prev) prev.disabled = _ST.lightboxIndex === 0;
  if (next) next.disabled = _ST.lightboxIndex === _ST.fotograflar.length - 1;
  if (side) {
    side.innerHTML = `
      <h3>${_stEsc(f.tip || 'Fotoğraf')}</h3>
      <div class="st-lightbox-row"><span class="k">Tarih</span><span class="v">${_stTarih(f.ts)}</span></div>
      <div class="st-lightbox-row"><span class="k">İş Emri</span><span class="v">#${f.is_emri_id}</span></div>
      <div class="st-lightbox-row"><span class="k">Müşteri</span><span class="v">${_stEsc(f.musteri || '—')}</span></div>
      <div class="st-lightbox-row"><span class="k">Plaka</span><span class="v">${_stEsc(f.plaka || '—')}</span></div>
      <div class="st-lightbox-row"><span class="k">Adres</span><span class="v">${_stEsc(f.adres || '—')}</span></div>
      <div class="st-lightbox-row"><span class="k">Durum</span><span class="v">${_stEsc(f.durum || '—')}</span></div>
      ${(isFinite(f.lat) && isFinite(f.lng)) ? `
        <div class="st-lightbox-row"><span class="k">GPS</span><span class="v">${(+f.lat).toFixed(5)}, ${(+f.lng).toFixed(5)}</span></div>
        <div id="st-lb-map" class="st-lightbox-mini-map"></div>
      ` : `<div style="color:var(--muted);font-size:11.5px;text-align:center;padding:12px;">📍 Konum bilgisi yok</div>`}
    `;
    if (isFinite(f.lat) && isFinite(f.lng)) setTimeout(() => _stLightboxMapInit(+f.lat, +f.lng), 60);
  }
}

function _stLightboxMapInit(lat, lng) {
  const el = document.getElementById('st-lb-map');
  if (!el || typeof L === 'undefined') return;
  if (_ST.lightboxMap) {
    try { _ST.lightboxMap.remove(); } catch {}
  }
  _ST.lightboxMap = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_ST.lightboxMap);
  _ST.lightboxMarker = L.marker([lat, lng], { icon: _stIcon('#38bdf8', '●') }).addTo(_ST.lightboxMap);
  setTimeout(() => _ST.lightboxMap.invalidateSize(), 80);
}

/* ──────────────────────────────────────────────────────────────────────────
   ZIP İNDİR — JSZip ile
   ──────────────────────────────────────────────────────────────────────── */
async function surucuTakipFotoZipIndir() {
  if (typeof JSZip === 'undefined') {
    alert('Fotoğraf indirme kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.');
    return;
  }
  const filt = _ST.fotoFilter;
  const now = Date.now();
  const fotos = _ST.fotograflar.filter(f => {
    const age = now - new Date(f.ts).getTime();
    if (filt === 'hafta') return age <= 7  * 24 * 3600 * 1000;
    if (filt === 'ay')    return age <= 30 * 24 * 3600 * 1000;
    return true;
  });
  if (!fotos.length) return;

  const btn = document.getElementById('st-foto-zip');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor (0/' + fotos.length + ')'; }

  const zip = new JSZip();
  const sur = _ST.suruculer.find(s => s.id === _ST.aktifSurucuId);
  const klas = `${(sur?.ad || 'sofor').replace(/[^a-z0-9]/gi,'_')}_${new Date().toISOString().slice(0,10)}`;

  let basarili = 0;
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i];
    try {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
      const ad = `${i+1}_${(f.tip||'foto').replace(/[^a-z0-9]/gi,'_')}_is${f.is_emri_id}.${ext}`;
      zip.file(`${klas}/${ad}`, blob);
      basarili++;
    } catch (err) {
      console.warn('Foto indirilemedi:', f.url, err);
    }
    if (btn) btn.textContent = `⏳ Hazırlanıyor (${i+1}/${fotos.length})`;
  }

  // Manifest dosyası
  const manifest = fotos.map((f, i) => ({
    sira: i+1,
    tarih: f.ts,
    is_emri: f.is_emri_id,
    musteri: f.musteri,
    plaka: f.plaka,
    adres: f.adres,
    gps: (isFinite(f.lat) && isFinite(f.lng)) ? `${f.lat},${f.lng}` : null,
    url: f.url
  }));
  zip.file(`${klas}/manifest.json`, JSON.stringify(manifest, null, 2));

  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${klas}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    if (btn) btn.textContent = `✓ ${basarili}/${fotos.length} indirildi`;
  } catch (err) {
    console.error('ZIP oluşturma hatası:', err);
    if (btn) btn.textContent = '⚠ Hata';
  } finally {
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '📥 Tümünü İndir'; } }, 3500);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   GERÇEK ZAMANLI — realtime + 30sn polling fallback
   ──────────────────────────────────────────────────────────────────────── */
function surucuTakipStartRealtime() {
  const sb = getSB();
  if (!sb) return;
  // Realtime — is_emirleri değişimleri (durum/konum)
  if (!_ST.realtimeChannel) {
    try {
      _ST.realtimeChannel = sb.channel('surucu-takip')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'is_emirleri' }, () => {
          surucuTakipPaneliTazele();
        })
        .subscribe();
    } catch {}
  }
  // 30sn polling fallback
  if (!_ST.refreshTimer) {
    _ST.refreshTimer = setInterval(() => {
      // Sadece sürücü takip paneli açıkken çalış
      if (!document.getElementById('dspanel-takip')?.classList.contains('active')) return;
      surucuTakipPaneliTazele();
    }, 30000);
  }
}

function surucuTakipStopRealtime() {
  if (_ST.realtimeChannel) {
    try { getSB()?.removeChannel(_ST.realtimeChannel); } catch {}
    _ST.realtimeChannel = null;
  }
  if (_ST.refreshTimer) {
    clearInterval(_ST.refreshTimer);
    _ST.refreshTimer = null;
  }
}

async function surucuTakipPaneliTazele() {
  await surucuTakipSuruculeriYukle();
  surucuTakipRenderListe();
  if (_ST.aktifSurucuId) {
    await surucuTakipDetayYukle();
    // Sadece header + canlı stat'ları yenile (tab içeriği aktifse onu da)
    surucuTakipRenderTabs();
    setTimeout(() => surucuTakipTabAc(_ST.aktifTab), 60);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   YARDIMCILAR
   ──────────────────────────────────────────────────────────────────────── */
function _stEsc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function _stTarih(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'2-digit' })
    + ' ' + d.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
}
function _stRelTime(iso) {
  if (!iso) return 'bilinmiyor';
  const dk = Math.round((Date.now() - new Date(iso)) / 60000);
  if (!isFinite(dk) || dk < 0) return 'bilinmiyor';
  if (dk < 1)  return 'az önce';
  if (dk < 60) return dk + ' dk önce';
  const h = Math.floor(dk/60), m = dk%60;
  if (h < 24) return m ? `${h}s ${m}dk önce` : `${h}s önce`;
  return Math.floor(h/24) + ' gün önce';
}

/* ──────────────────────────────────────────────────────────────────────────
   STİL KEYFRAMES (puls için)
   ──────────────────────────────────────────────────────────────────────── */
(function _stInjectKeyframes() {
  if (document.getElementById('st-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'st-keyframes';
  s.textContent = `@keyframes stPulse { 0% { box-shadow: 0 0 0 0 rgba(56,189,248,.55); } 70% { box-shadow: 0 0 0 14px rgba(56,189,248,0); } 100% { box-shadow: 0 0 0 0 rgba(56,189,248,0); } }`;
  document.head.appendChild(s);
})();
