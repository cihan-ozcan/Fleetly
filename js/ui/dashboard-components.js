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

  // ── DASHBOARD MINI MAP ─────────────────────────────────────
  UI.initDashMap = function () {
    const el = document.getElementById('dashboard-map');
    if (!el || typeof L === 'undefined') return;

    if (UI._dashMap) {
      try { UI._dashMap.remove(); } catch (e) {}
      UI._dashMap = null;
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

    // Mock pin'ler — Faz 4'te canlı araç konumlarıyla değişecek
    const pins = [
      { lat: 41.01, lng: 28.97, color: '#16A974', label: 'İstanbul' },
      { lat: 39.92, lng: 32.85, color: '#16A974', label: 'Ankara' },
      { lat: 38.42, lng: 27.14, color: '#E5A100', label: 'İzmir' },
      { lat: 37.00, lng: 35.32, color: '#FF6B1F', label: 'Adana' },
      { lat: 41.29, lng: 36.33, color: '#16A974', label: 'Samsun' },
      { lat: 36.89, lng: 30.71, color: '#7889A1', label: 'Antalya' },
      { lat: 40.18, lng: 29.07, color: '#16A974', label: 'Bursa' },
    ];
    pins.forEach(function (p) {
      const icon = L.divIcon({
        className: 'dash-map-pin',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:' + p.color + ';border:2px solid #fff;box-shadow:0 0 0 4px ' + p.color + '33,0 2px 6px rgba(0,0,0,.25);"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([p.lat, p.lng], { icon: icon, title: p.label }).addTo(map);
    });
  };

  // Tema değişiminde chart ve harita renklerini senkronla
  window.addEventListener('fleetly:theme-change', function () {
    UI.initRevenueChart();
    UI.initDashMap();
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
