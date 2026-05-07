/* ===================================================================
   dashboard-components.js — Fleetly Dashboard UI helper'ları (Faz 3)
   - FleetlyUI.icon(name, size)        : Lucide-style SVG ikon
   - FleetlyUI.sparkline(data, opts)   : Mini SVG çizgi grafiği
   - FleetlyUI.countUp(el, target)     : Sayaç animasyonu (RAF)
   - FleetlyUI.statusDot(status)       : Durum noktası HTML'i
   - FleetlyUI.refreshBannerTime()     : Sinematik banner saat / selamlama

   Mevcut JS'in stat-* ID'lerini güncelleme akışı KORUNUR. Bu dosya
   sadece görsel yardımcılar sağlar; veri çekmez.
   =================================================================== */
(function () {
  const UI = window.FleetlyUI || (window.FleetlyUI = {});

  // ── ICON KÜTÜPHANESİ ──────────────────────────────────────
  const ICONS = {
    plus:        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    download:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    arrowRight:  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    arrowUp:     '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    arrowDown:   '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    package:     '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    route:       '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    fuel:        '<path d="M3 22h12M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M14 7h2a3 3 0 0 1 3 3v6a1.5 1.5 0 0 1-3 0V12h-1"/>',
    money:       '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    wrench:      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    bell:        '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    activity:    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    truck:       '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  };

  UI.icon = function (name, size) {
    size = size || 18;
    const path = ICONS[name] || '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  };

  // ── SPARKLINE ─────────────────────────────────────────────
  UI.sparkline = function (data, opts) {
    opts = opts || {};
    const w = opts.width || 90;
    const h = opts.height || 28;
    const stroke = opts.stroke || 'currentColor';
    const fill = opts.fill || 'none';
    if (!data || !data.length) return '';
    const min = Math.min.apply(null, data);
    const max = Math.max.apply(null, data);
    const range = (max - min) || 1;
    const step = w / Math.max(data.length - 1, 1);
    const pts = data.map(function (v, i) {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const lastIdx = data.length - 1;
    const lastX = lastIdx * step;
    const lastY = h - ((data[lastIdx] - min) / range) * h;
    return '<svg class="sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<polyline points="' + pts + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="2" fill="' + stroke + '"/>' +
    '</svg>';
  };

  // ── COUNT UP ──────────────────────────────────────────────
  UI.countUp = function (el, target, opts) {
    if (!el) return;
    opts = opts || {};
    const duration = opts.duration || 900;
    const start = parseFloat(el.getAttribute('data-current') || '0');
    const isInt = Number.isInteger(target);
    const formatter = opts.format || function (v) {
      return isInt
        ? Math.round(v).toLocaleString('tr-TR')
        : v.toFixed(1);
    };
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);   // easeOutCubic
      const v = start + (target - start) * eased;
      el.textContent = (opts.prefix || '') + formatter(v) + (opts.suffix || '');
      if (t < 1) requestAnimationFrame(tick);
      else el.setAttribute('data-current', target);
    }
    requestAnimationFrame(tick);
  };

  // ── STATUS DOT ────────────────────────────────────────────
  UI.statusDot = function (status, label) {
    const map = {
      moving:       { color: 'var(--success)',     label: 'Hareket' },
      'in-transit': { color: 'var(--success)',     label: 'Yolda' },
      idle:         { color: 'var(--warning)',     label: 'Rölanti' },
      stopped:      { color: 'var(--text-subtle)', label: 'Park' },
      maint:        { color: 'var(--accent-500)',  label: 'Bakım' },
      alarm:        { color: 'var(--danger)',      label: 'Alarm' },
      delayed:      { color: 'var(--danger)',      label: 'Gecikti' },
      delivered:    { color: 'var(--success)',     label: 'Teslim' },
    };
    const s = map[status] || { color: 'var(--text-subtle)', label: status };
    return '<span class="status-dot"><span class="dot" style="background:' + s.color + '"></span>' + (label || s.label) + '</span>';
  };

  // ── BANNER SAAT / SELAMLAMA ───────────────────────────────
  UI.refreshBannerTime = function () {
    const now = new Date();
    const dateEl = document.getElementById('cine-banner-date');
    const greetEl = document.getElementById('cine-banner-greeting');
    if (dateEl) {
      const opts = { day: 'numeric', month: 'long', weekday: 'long' };
      const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      dateEl.textContent = now.toLocaleDateString('tr-TR', opts) + ' · ' + time;
    }
    if (greetEl && !greetEl.dataset.userOverride) {
      const h = now.getHours();
      let greet = 'Merhaba';
      if (h >= 5 && h < 12) greet = 'Günaydın';
      else if (h >= 12 && h < 18) greet = 'İyi günler';
      else if (h >= 18 && h < 22) greet = 'İyi akşamlar';
      else greet = 'İyi geceler';
      const userName = (greetEl.getAttribute('data-user-name') || '').trim();
      greetEl.textContent = greet + (userName ? ', ' + userName : '') + ' 👋';
    }
  };

  // ── MIRROR SYNC ───────────────────────────────────────────
  // Mevcut JS eski #stat-* ID'lerini güncelliyor. Yeni banner/KPI
  // alanları onları MutationObserver ile dinler; JS'e dokunmadan
  // çift kaynak senkronize olur.
  const MIRROR_PAIRS = [
    // Banner status strip
    ['stat-toplam',       'banner-stat-toplam'],
    ['stat-cekici',       'banner-stat-cekici'],
    ['stat-dorse',        'banner-stat-dorse'],
    ['stat-diger',        'banner-stat-diger'],
    ['stat-muayene',      'banner-stat-muayene'],
    ['stat-sigorta',      'banner-stat-sigorta'],
    // KPI satırı
    ['stat-sefer-toplam', 'kpi-sefer-val'],
    ['trend-sefer',       'kpi-sefer-delta'],
    ['stat-sefer-km',     'kpi-km-val'],
    ['stat-yakit',        'kpi-yakit-val'],
    ['trend-yakit',       'kpi-yakit-delta'],
    ['stat-rapor-kar',    'kpi-kar-val'],
    ['stat-rapor-ciro',   'kpi-kar-ciro'],
  ];

  function setupMirror(srcId, dstId) {
    const src = document.getElementById(srcId);
    const dst = document.getElementById(dstId);
    if (!src || !dst) return;
    // İlk değeri kopyala
    if (src.textContent && src.textContent.trim()) {
      dst.textContent = src.textContent;
    }
    // Sonraki güncellemeleri dinle
    const obs = new MutationObserver(function () {
      dst.textContent = src.textContent;
    });
    obs.observe(src, { childList: true, characterData: true, subtree: true });
  }

  function setupMirrors() {
    if (!('MutationObserver' in window)) return;
    MIRROR_PAIRS.forEach(function (p) { setupMirror(p[0], p[1]); });
  }

  // ── REVENUE CHART (30 gün — gelir / maliyet / km) ─────────
  // Statik mock veri ile ilk render. Faz 4'te canlı veriye bağlanacak.
  UI.initRevenueChart = function () {
    const canvas = document.getElementById('revenue-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    // 30 gün etiket
    const labels = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      labels.push(d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }));
    }
    // Mock dalgalı seri
    const revenue = [], cost = [], km = [];
    for (let i = 0; i < 30; i++) {
      revenue.push(Math.round(45000 + 25000 * Math.sin(i * 0.4) + i * 800));
      cost.push(Math.round(28000 + 12000 * Math.sin(i * 0.5 + 1) + i * 400));
      km.push(Math.round(8000 + 3000 * Math.cos(i * 0.3) + i * 80));
    }

    const css = getComputedStyle(document.documentElement);
    const navyColor    = css.getPropertyValue('--navy-500').trim()    || '#2C5A9E';
    const accentColor  = css.getPropertyValue('--accent-500').trim()  || '#FF6B1F';
    const successColor = css.getPropertyValue('--success').trim()     || '#16A974';
    const textMuted    = css.getPropertyValue('--text-muted').trim()  || '#5B6B82';
    const borderColor  = css.getPropertyValue('--border').trim()      || '#E1E7F0';

    if (UI._revenueChart) {
      try { UI._revenueChart.destroy(); } catch (e) {}
    }

    function hexAlpha(hex, alpha) {
      // hex'i rgba'ya çevir
      const h = hex.replace('#', '');
      if (h.length !== 6) return hex;
      const r = parseInt(h.substr(0, 2), 16);
      const g = parseInt(h.substr(2, 2), 16);
      const b = parseInt(h.substr(4, 2), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    UI._revenueChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Gelir',
            data: revenue,
            borderColor: navyColor,
            backgroundColor: hexAlpha(navyColor, 0.14),
            fill: true,
            tension: 0.32,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'Maliyet',
            data: cost,
            borderColor: accentColor,
            backgroundColor: hexAlpha(accentColor, 0.12),
            fill: true,
            tension: 0.32,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'KM',
            data: km,
            borderColor: successColor,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.32,
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F2440',
            titleColor: '#fff',
            bodyColor: '#C8D3E2',
            borderColor: 'rgba(255,255,255,.10)',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: function (ctx) {
                const l = ctx.dataset.label;
                const v = ctx.parsed.y;
                if (l === 'KM') return l + ': ' + v.toLocaleString('tr-TR') + ' km';
                return l + ': ₺' + v.toLocaleString('tr-TR');
              }
            }
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textMuted, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            border: { color: borderColor },
          },
          y: {
            grid: { color: borderColor, drawBorder: false },
            ticks: {
              color: textMuted,
              font: { size: 10 },
              callback: function (v) { return '₺' + (v / 1000).toFixed(0) + 'k'; }
            },
            border: { display: false },
          },
          y2: {
            position: 'right',
            grid: { display: false },
            ticks: {
              color: textMuted,
              font: { size: 10 },
              callback: function (v) { return (v / 1000).toFixed(0) + 'k'; }
            },
            border: { display: false },
          },
        },
      },
    });
  };

  // ── DASHBOARD CANLI KONUM HARİTASI ─────────────────────────
  // Aktif iş emirlerinden (Yolda/Fabrikada) konum_lat/lng dolu olanları
  // çeker, harita üzerine renk-kodlu pin koyar. 30sn'de bir + Supabase
  // Realtime ile güncel kalır. Pin'e tıklayınca operasyon drawer'ı açılır.
  UI._liveMarkers = UI._liveMarkers || {};   // jobId → marker
  UI._liveRefreshTimer = UI._liveRefreshTimer || null;
  UI._liveRealtimeChannel = UI._liveRealtimeChannel || null;

  UI.initDashMap = function () {
    const el = document.getElementById('dashboard-map');
    if (!el || typeof L === 'undefined') return;

    if (UI._dashMap) {
      try { UI._dashMap.remove(); } catch (e) {}
      UI._dashMap = null;
      UI._liveMarkers = {};
      UI._liveBoundsApplied = false;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const map = L.map(el, {
      center: [39.4, 35.0],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    });
    UI._dashMap = map;

    const tileUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, { maxZoom: 19, subdomains: 'abcd' }).addTo(map);

    // Marker cluster — kalabalık dashboard haritasında gruplandırır (2026_05_06j)
    if (typeof L.markerClusterGroup === 'function') {
      UI._dashCluster = L.markerClusterGroup({
        maxClusterRadius: 50,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        chunkedLoading: true
      });
      map.addLayer(UI._dashCluster);
    } else {
      UI._dashCluster = null;
    }
    // Liman polygon overlay — Phase 2 (2026_05_06l)
    if (typeof _limanOverlayBaslat === 'function') {
      _limanOverlayBaslat(map, 'dashboard');
    }

    // İlk fetch + periyodik yenileme + realtime
    UI.refreshLiveDriverMap();
    // İlk yenilemede firmaId/auth henüz yüklenmemiş olabilir; ilk 60 sn'de
    // 5 sn'lik "boost" polling, sonra normal 30 sn ritmine geç.
    if (UI._liveBoostTimer) clearInterval(UI._liveBoostTimer);
    let boostTicks = 0;
    UI._liveBoostTimer = setInterval(function () {
      UI.refreshLiveDriverMap();
      if (++boostTicks >= 12) { clearInterval(UI._liveBoostTimer); UI._liveBoostTimer = null; }
    }, 5000);
    if (UI._liveRefreshTimer) clearInterval(UI._liveRefreshTimer);
    UI._liveRefreshTimer = setInterval(UI.refreshLiveDriverMap, 30000);
    UI._subscribeLiveDrivers();
  };

  // Renk paleti — durum + son sinyal yaşı
  function _liveColor(durum, ageMinutes) {
    if (ageMinutes != null && ageMinutes > 15) return '#7889A1'; // gri — sinyal eski
    switch (durum) {
      case 'Yolda':     return '#16A974'; // yeşil
      case 'Fabrikada': return '#FF6B1F'; // turuncu
      case 'Bekliyor':  return '#E5A100'; // sarı
      default:          return '#7889A1';
    }
  }

  function _ageMinutes(ts) {
    if (!ts) return null;
    const dt = new Date(ts);
    if (isNaN(dt)) return null;
    return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 60000));
  }

  function _ageLabel(min) {
    if (min == null) return 'bilinmiyor';
    if (min < 1)  return 'şimdi';
    if (min < 60) return min + ' dk önce';
    const h = Math.floor(min / 60);
    return h + ' sa önce';
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  UI.refreshLiveDriverMap = async function () {
    const map = UI._dashMap;
    if (!map) return;
    const sb = (typeof getSB === 'function') ? getSB()
              : (window.getSB ? window.getSB() : null);
    if (!sb) { console.warn('[live-map] Supabase client yok'); return; }

    // currentFirmaId'ye birkaç yoldan eriş (let global IIFE'den okunamayabiliyor)
    let firmaId = null;
    try { if (typeof currentFirmaId !== 'undefined') firmaId = currentFirmaId; } catch (e) {}
    if (!firmaId && window.currentFirmaId) firmaId = window.currentFirmaId;
    if (!firmaId) {
      // Auth'tan tazeliyebiliyorsak çek
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          const { data: fk } = await sb.from('firma_kullanicilar')
            .select('firma_id').eq('user_id', user.id).limit(1).maybeSingle();
          if (fk && fk.firma_id) {
            firmaId = fk.firma_id;
            window.currentFirmaId = firmaId;
          }
        }
      } catch (e) { /* yutuyoruz */ }
    }

    let rows = [];
    try {
      let q = sb
        .from('is_emirleri')
        .select('id, durum, konum_lat, konum_lng, konum_zaman, surucu_id, sofor_user_id, sofor, sofor_tel, arac_plaka, musteri_adi, yukle_yeri, teslim_yeri, firma_id')
        .in('durum', ['Yolda', 'Fabrikada'])
        .not('konum_lat', 'is', null)
        .not('konum_lng', 'is', null)
        .order('konum_zaman', { ascending: false })
        .limit(200);
      // Firma filtresi: ops modülü gibi firma_id eşleşen VEYA NULL olanları al
      if (firmaId) q = q.or('firma_id.eq.' + firmaId + ',firma_id.is.null');
      const { data, error } = await q;
      if (error) throw error;
      rows = data || [];
      console.log('[live-map] aktif sürücü/iş emri:', rows.length, '(firmaId=' + firmaId + ')');
    } catch (err) {
      console.warn('[live-map] iş emri çekilemedi:', err);
      return;
    }

    // Snapshot'tan sürücü/araç eşleşmesi (tooltip için)
    const snap = (window._fleetly && window._fleetly.snapshot) || {};
    const driverById = {};
    (snap.driverData || []).forEach(function (d) { if (d) driverById[d.id] = d; });
    // is_emirleri'nde arac_id yok; plakaya göre eşle
    const vehByPlate = {};
    (snap.vehicles || []).forEach(function (v) {
      if (v && (v.plaka || v.plate)) vehByPlate[(v.plaka || v.plate)] = v;
    });

    const seen = {};
    const bounds = [];

    rows.forEach(function (e) {
      const lat = +e.konum_lat;
      const lng = +e.konum_lng;
      if (!isFinite(lat) || !isFinite(lng)) return;
      seen[e.id] = true;

      const drv  = e.surucu_id ? driverById[e.surucu_id] : null;
      const drvName = (drv ? ((drv.ad || '') + ' ' + (drv.soyad || '')).trim() : null)
                  || e.sofor || '—';
      const plaka = e.arac_plaka || '—';
      const ageMin = _ageMinutes(e.konum_zaman);
      const color  = _liveColor(e.durum, ageMin);

      // Hover tooltip — kısa info
      const tooltipHtml =
        '<div style="font:600 12px/1.4 system-ui,sans-serif;min-width:160px">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + '"></span>' +
            '<b>' + _esc(drvName) + '</b>' +
            '<span style="margin-left:auto;font-weight:500;color:#7889A1">#' + e.id + '</span>' +
          '</div>' +
          '<div style="color:#7889A1;font-weight:500">' + _esc(plaka) + ' • ' + _esc(e.durum) + '</div>' +
          (e.musteri_adi ? '<div style="margin-top:2px">' + _esc(e.musteri_adi) + '</div>' : '') +
          '<div style="margin-top:4px;color:#7889A1;font-size:11px">' + _ageLabel(ageMin) + '</div>' +
        '</div>';

      // Click popup — 2 buton: "Rotayı Göster" (focus modu) + "Detayı aç" (operasyon page)
      const popupHtml =
        '<div style="font:600 12px/1.4 system-ui,sans-serif;min-width:200px;">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + '"></span>' +
            '<b>' + _esc(drvName) + '</b>' +
          '</div>' +
          '<div style="color:#7889A1;font-weight:500;margin-bottom:2px;">' + _esc(plaka) + ' • ' + _esc(e.durum) + '</div>' +
          (e.musteri_adi ? '<div style="font-size:11px;color:#7889A1;margin-bottom:2px;">' + _esc(e.musteri_adi) + '</div>' : '') +
          '<div style="font-size:11px;color:#7889A1;margin-bottom:8px;">' + _ageLabel(ageMin) + '</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<button style="flex:1;background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;" ' +
              'onclick="FleetlyUI._dashFocusGoster(' + e.id + ')">🛣️ Rotayı Göster</button>' +
            '<button style="flex:1;background:transparent;color:inherit;border:1px solid #ccc;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;" ' +
              'onclick="FleetlyUI._dashFocusDetay(' + e.id + ')">Detay →</button>' +
          '</div>' +
        '</div>';

      const existing = UI._liveMarkers[e.id];
      if (existing) {
        existing.setLatLng([lat, lng]);
        existing.setIcon(_liveDivIcon(color, e.durum));
        existing.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -8], opacity: 0.95 });
        existing.bindPopup(popupHtml, { maxWidth: 260, closeButton: true });
      } else {
        const marker = L.marker([lat, lng], {
          icon: _liveDivIcon(color, e.durum),
          riseOnHover: true,
          title: drvName + ' — ' + plaka
        });
        marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -8], opacity: 0.95 });
        marker.bindPopup(popupHtml, { maxWidth: 260, closeButton: true });
        // Cluster grubu varsa ona ekle, yoksa direkt haritaya
        if (UI._dashCluster) UI._dashCluster.addLayer(marker);
        else marker.addTo(map);
        UI._liveMarkers[e.id] = marker;
      }
      bounds.push([lat, lng]);
    });

    // Artık aktif olmayan markerları kaldır (cluster varsa cluster'dan kaldır)
    Object.keys(UI._liveMarkers).forEach(function (id) {
      if (!seen[id]) {
        try {
          if (UI._dashCluster) UI._dashCluster.removeLayer(UI._liveMarkers[id]);
          else map.removeLayer(UI._liveMarkers[id]);
        } catch (e) {}
        delete UI._liveMarkers[id];
      }
    });

    // Yalnız ilk fetch'te ve harita varsayılan görünümünde fitBounds yap
    // (kullanıcı zoom yaptıysa ezme)
    if (bounds.length && !UI._liveBoundsApplied) {
      try { map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 }); } catch (e) {}
      UI._liveBoundsApplied = true;
    }
  };

  function _liveDivIcon(color, durum) {
    const pulse = (durum === 'Yolda');
    return L.divIcon({
      className: 'dash-map-pin' + (pulse ? ' dash-map-pin--pulse' : ''),
      html: '<div style="position:relative;width:14px;height:14px">' +
              (pulse ? '<div class="live-pin-pulse" style="background:' + color + '33"></div>' : '') +
              '<div style="position:relative;width:14px;height:14px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 0 0 4px ' + color + '33,0 2px 6px rgba(0,0,0,.25)"></div>' +
            '</div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  // Dashboard map odak modu — popup butonu "Rotayı Göster" tıklayınca:
  // app-chunk-05.js'teki _haritaFocusGir helper'ı çağrılır. Diğer marker'lar
  // sönükleşir, seçilen aracın rotası + duraksamaları + yükle/teslim pinleri
  // çizilir, üstte "Tümünü Göster" banner'ı belirir.
  UI._dashFocusGoster = function (jobId) {
    const map = UI._dashMap;
    if (!map || typeof _haritaFocusGir !== 'function') return;
    map.closePopup();
    // _liveMarkers map { jobId → marker }; ortak helper [{marker, jobId}] format ister
    const all = Object.entries(UI._liveMarkers || {}).map(function (entry) {
      return { marker: entry[1], jobId: parseInt(entry[0], 10) };
    });
    const banner = document.getElementById('dashboard-focus-banner');
    _haritaFocusGir({ id: 'dashboard', map: map, allMarkers: all, banner: banner }, jobId);
  };

  UI._dashFocusDetay = function (jobId) {
    if (UI._dashMap) UI._dashMap.closePopup();
    if (typeof openOperasyonPage === 'function') {
      openOperasyonPage();
      setTimeout(function () {
        if (typeof openOpsDrawer === 'function') openOpsDrawer(jobId);
      }, 600);
    }
  };

  UI._subscribeLiveDrivers = function () {
    const sb = (typeof getSB === 'function') ? getSB() : null;
    if (!sb || UI._liveRealtimeChannel) return;
    try {
      UI._liveRealtimeChannel = sb
        .channel('dash-live-locations')
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'is_emirleri' },
            function () { UI.refreshLiveDriverMap(); })
        .subscribe();
    } catch (err) {
      console.warn('[live-map] realtime kurulamadı, polling devam:', err);
    }
  };

  // Tema değişiminde chart ve harita renklerini senkronla
  window.addEventListener('fleetly:theme-change', function () {
    UI.initRevenueChart();
    UI._liveBoundsApplied = false;
    UI.initDashMap();
  });

  // Bridge hazır olduğunda (driver/vehicle snapshot) tooltip'leri tazele
  window.addEventListener('fleetly:bridge-ready', function () {
    if (UI._dashMap) UI.refreshLiveDriverMap();
  });

  // ── CANLI VERİ POPULATE (Faz 5) ───────────────────────────
  // Mevcut JS verilerine window._fleetly.snapshot üzerinden okuma
  // ile erişir; Top Sürücüler, Yaklaşan Bakımlar, Son Seferler
  // dashboard satırlarını günceller.

  function getSnapshot() {
    try { return (window._fleetly && window._fleetly.snapshot) || null; }
    catch (e) { return null; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function initialsOf(name) {
    if (!name) return '–';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '–';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (a + b).toUpperCase();
  }

  function plateOf(vehicleId, vehicles) {
    if (!vehicles || !Array.isArray(vehicles)) return '';
    const v = vehicles.find(function (x) { return x && (x.id === vehicleId || x.id == vehicleId); });
    return v ? (v.plaka || v.plate || v.kod || '') : '';
  }

  // Top Sürücüler — sefer sayısına göre sırala
  UI.populateTopDrivers = function (snapshot) {
    const root = document.getElementById('top-drivers-list');
    if (!root) return;
    const drivers = snapshot && snapshot.driverData;
    const seferler = snapshot && snapshot.seferData;
    if (!Array.isArray(drivers) || drivers.length === 0) return; // mock kalır

    // Her sürücüye sefer sayısı / km hesapla
    const stats = drivers.map(function (d) {
      const driverSeferleri = Array.isArray(seferler)
        ? seferler.filter(function (s) {
            return s && (
              s.surucu_id === d.id ||
              s.driver_id === d.id ||
              s.surucu === d.ad ||
              s.surucuAdi === d.ad
            );
          })
        : [];
      const totalKm = driverSeferleri.reduce(function (sum, s) {
        return sum + (parseFloat(s.km) || 0);
      }, 0);
      return {
        name: d.ad || '–',
        initials: initialsOf(d.ad),
        trips: driverSeferleri.length,
        km: totalKm,
        score: Math.min(100, Math.round(60 + (driverSeferleri.length * 4) + (totalKm > 0 ? 10 : 0))),
      };
    });
    stats.sort(function (a, b) { return b.trips - a.trips || b.km - a.km; });
    const top = stats.slice(0, 5);
    if (!top.length) return;

    let html = '';
    top.forEach(function (d, i) {
      const goldStyle = (i === 0)
        ? 'background:linear-gradient(135deg,#FFD93D,#F4A300)'
        : '';
      const star = (i === 0) ? ' ⭐' : '';
      const scoreClass = d.score >= 85 ? 'list-row__metric--success'
                       : d.score >= 70 ? 'list-row__metric--warning'
                       : '';
      html += '<div class="list-row">' +
        '<div class="list-row__rank">#' + (i + 1) + '</div>' +
        '<div class="list-row__avatar"' + (goldStyle ? ' style="' + goldStyle + '"' : '') + '>' + escapeHtml(d.initials) + '</div>' +
        '<div class="list-row__main">' +
          '<div class="list-row__title">' + escapeHtml(d.name) + star + '</div>' +
          '<div class="list-row__sub">' + d.trips + ' sefer · ' + (d.km ? d.km.toLocaleString('tr-TR') + ' km' : '–') + '</div>' +
        '</div>' +
        '<div class="list-row__right">' +
          '<div class="list-row__metric ' + scoreClass + '">' + d.score + '</div>' +
          '<div class="list-row__lbl">SKOR</div>' +
        '</div>' +
      '</div>';
    });
    root.innerHTML = html;
  };

  // Yaklaşan Bakımlar — maintData içindeki sonraki_tarih'lere göre
  UI.populateUpcomingMaint = function (snapshot) {
    const root = document.getElementById('upcoming-maint-list');
    if (!root) return;
    const maint = snapshot && snapshot.maintData;
    const vehicles = snapshot && snapshot.vehicles;
    if (!maint || typeof maint !== 'object') return;

    const items = [];
    const today = new Date();
    Object.keys(maint).forEach(function (vehId) {
      const records = maint[vehId];
      if (!Array.isArray(records)) return;
      records.forEach(function (r) {
        if (!r) return;
        const sonraki = r.sonraki_tarih || r.sonrakiTarih;
        if (!sonraki) return;
        const due = new Date(sonraki);
        if (isNaN(due.getTime())) return;
        const daysLeft = Math.round((due - today) / (1000 * 60 * 60 * 24));
        if (daysLeft > 60) return; // önümüzdeki 60 gün
        items.push({
          plate: plateOf(vehId, vehicles),
          type: r.tur || r.aciklama || 'Bakım',
          dueDate: due.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }),
          daysLeft: daysLeft,
          cost: parseFloat(r.maliyet) || 0,
        });
      });
    });
    items.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
    if (!items.length) return;

    let html = '';
    items.slice(0, 6).forEach(function (m) {
      const tone = m.daysLeft < 0 ? 'danger' : m.daysLeft < 7 ? 'warning' : 'info';
      const metricClass = m.daysLeft < 0 ? 'list-row__metric--danger'
                       : m.daysLeft < 7 ? 'list-row__metric--warning'
                       : '';
      const dayText = m.daysLeft < 0 ? Math.abs(m.daysLeft) + ' gün gecikti' : m.daysLeft + ' gün';
      html += '<div class="list-row">' +
        '<div class="list-row__icon-box list-row__icon-box--' + tone + '">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>' +
        '</div>' +
        '<div class="list-row__main">' +
          '<div class="list-row__title">' + escapeHtml(m.plate || '—') + ' <span class="muted" style="font-weight:400">· ' + escapeHtml(m.type) + '</span></div>' +
          '<div class="list-row__sub">' + escapeHtml(m.dueDate) + '</div>' +
        '</div>' +
        '<div class="list-row__right">' +
          '<div class="list-row__metric ' + metricClass + '">' + dayText + '</div>' +
          (m.cost ? '<div class="list-row__lbl mono">~₺' + m.cost.toLocaleString('tr-TR') + '</div>' : '') +
        '</div>' +
      '</div>';
    });
    if (!html) return;
    root.innerHTML = html;
  };

  // Son Seferler — seferData üzerinden son 5 sefer
  // 2026_05_07i: kolonlar zenginleştirildi — Tarih · Plaka · Güzergah · Yakıt · Masraf · Ücret
  // (eski mock kolonları "İlerleme/Durum" kaldırıldı — tamamlanan sefer her zaman %100/teslim olduğundan anlamsızdı)
  UI.populateRecentTrips = function (snapshot) {
    const table = document.getElementById('recent-trips-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const seferler = snapshot && snapshot.seferData;
    if (!Array.isArray(seferler) || seferler.length === 0) return;

    function fmtTarih(d) {
      if (!d) return '—';
      // ISO veya dd-mm formatı geleblir; basit normalize
      const s = String(d);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const p = s.split('T')[0].split('-');
        return p[2] + '.' + p[1] + '.' + p[0].slice(2);
      }
      return s;
    }
    function fmtTl(n) {
      const v = +n || 0;
      if (v <= 0) return '—';
      return '₺' + v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    }

    // Yeniden eskiye sırala
    const sorted = [].concat(seferler).sort(function (a, b) {
      const ad = new Date(a.tarih || a.created_at || 0).getTime();
      const bd = new Date(b.tarih || b.created_at || 0).getTime();
      return bd - ad;
    });

    let html = '';
    sorted.slice(0, 5).forEach(function (s) {
      const tarih = fmtTarih(s.tarih);
      const plaka = s.plaka || s.plate || '—';
      const from  = s.kalkis || s.from || '';
      const to    = s.varis  || s.to   || '';
      const yakit  = fmtTl(s.yakit_tutar);
      const masraf = fmtTl(s.masraf_toplam_tl);
      const ucret  = fmtTl(s.ucret);
      const masrafAdet = +(s.masraf_adet || 0);
      const masrafCell = masraf === '—'
        ? '<span class="muted">—</span>'
        : '<span style="color:#f59e0b;font-weight:600">' + masraf + '</span>' +
          (masrafAdet > 0 ? ' <span style="font-size:9px;background:rgba(245,158,11,.18);border-radius:7px;padding:1px 5px;color:#f59e0b;">' + masrafAdet + '</span>' : '');
      const yakitCell = yakit === '—'
        ? '<span class="muted">—</span>'
        : '<span style="color:#22d3ee;font-weight:600">' + yakit + '</span>';
      const ucretCell = ucret === '—'
        ? '<span class="muted">—</span>'
        : '<span style="color:#22c55e;font-weight:700">' + ucret + '</span>';
      html += '<tr>' +
        '<td class="muted" style="font-size:11.5px;white-space:nowrap;">' + escapeHtml(tarih) + '</td>' +
        '<td class="tbl__num fw-6">' + escapeHtml(plaka) + '</td>' +
        '<td style="font-size:11.5px;"><span class="muted">' + escapeHtml(from) + '</span> → <b>' + escapeHtml(to) + '</b></td>' +
        '<td class="mono" style="font-size:11.5px;">' + yakitCell + '</td>' +
        '<td class="mono" style="font-size:11.5px;">' + masrafCell + '</td>' +
        '<td class="mono" style="font-size:12px;">' + ucretCell + '</td>' +
      '</tr>';
    });
    if (!html) return;
    tbody.innerHTML = html;
  };

  UI.refreshDashboardData = function () {
    const snap = getSnapshot();
    if (!snap) return;
    UI.populateTopDrivers(snap);
    UI.populateUpcomingMaint(snap);
    UI.populateRecentTrips(snap);
  };

  // Bridge hazır olduğunda + periyodik refresh
  window.addEventListener('fleetly:bridge-ready', function () {
    UI.refreshDashboardData();
    // Veriler async yüklendiği için 2-3 sn aralıkla 3 deneme
    setTimeout(UI.refreshDashboardData, 1500);
    setTimeout(UI.refreshDashboardData, 4000);
    setTimeout(UI.refreshDashboardData, 8000);
  });

  // ── INIT ──────────────────────────────────────────────────
  function init() {
    UI.refreshBannerTime();
    // Saati her dakika güncelle
    setInterval(UI.refreshBannerTime, 60 * 1000);

    // KPI sparkline'ları doldur (statik mock — Faz 4'te canlı veri bağlanacak)
    document.querySelectorAll('[data-sparkline]').forEach(function (el) {
      try {
        const raw = el.getAttribute('data-sparkline');
        const data = raw.split(',').map(function (n) { return parseFloat(n); }).filter(function (n) { return !isNaN(n); });
        if (data.length) {
          el.innerHTML = UI.sparkline(data, {
            width: parseInt(el.getAttribute('data-width') || '90', 10),
            height: parseInt(el.getAttribute('data-height') || '28', 10),
            stroke: el.getAttribute('data-color') || 'currentColor',
          });
        }
      } catch (e) {}
    });

    // Banner / KPI mirror sync (eski stat-* ID → yeni banner/KPI)
    setupMirrors();

    // Faz 3 genişletme: harita + chart
    UI.initDashMap();
    UI.initRevenueChart();

    // Faz 5: Eğer bridge zaten hazırsa hemen veri yükle
    UI.refreshDashboardData();

    // Sayfa girişi animasyonu
    const main = document.querySelector('.app-shell main');
    if (main) main.classList.add('is-entered');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
