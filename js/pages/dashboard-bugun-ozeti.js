/* =============================================================================
 * dashboard-bugun-ozeti.js — Anasayfa "Bugünün Operasyonu" kartı
 *
 * 3 sayaç:
 *   - Bekleyen iş emri    → durum = 'Bekliyor' (atanmamış / yola çıkmamış)
 *   - Yolda               → durum IN ('Yolda','Fabrikada','Boş Alındı','Alım Yapıldı')
 *   - Bugün teslim edildi → durum = 'Teslim Edildi' AND teslim_zamani >= bugün 00:00
 *
 * Render hedefi: #bugun-ozet-list (/app/)
 * Multi-tenant: is_emirleri RLS aware (2026_05_07b emergency fix sonrası).
 *
 * Refresh:
 *   - fleetly:bridge-ready event (login sonrası)
 *   - 5 dk timer (dashboard görünür kaldığı sürece)
 *   - Manuel: window.refreshBugunOzeti()
 * =========================================================================== */

(function () {
  'use strict';

  function _renderRow(icon, sevClass, title, sub, value, lbl, valClass) {
    return '<div class="list-row">' +
      '<div class="list-row__icon-box list-row__icon-box--' + sevClass + '" style="font-size:18px;">' + icon + '</div>' +
      '<div class="list-row__main">' +
        '<div class="list-row__title">' + title + '</div>' +
        '<div class="list-row__sub">' + sub + '</div>' +
      '</div>' +
      '<div class="list-row__right">' +
        '<div class="list-row__metric ' + (valClass || '') + '">' + value + '</div>' +
        '<div class="list-row__lbl">' + lbl + '</div>' +
      '</div>' +
    '</div>';
  }

  function _renderError(msg) {
    return '<div class="list-row" style="opacity:.7">' +
      '<div class="list-row__icon-box list-row__icon-box--danger">⚠</div>' +
      '<div class="list-row__main">' +
        '<div class="list-row__title">Veri alınamadı</div>' +
        '<div class="list-row__sub">' + escapeHtml(msg || 'Bilinmeyen hata') + '</div>' +
      '</div>' +
      '<div class="list-row__right">' +
        '<button class="btn--ghost btn--sm" onclick="window.refreshBugunOzeti()" style="font-size:11px;">Tekrar dene</button>' +
      '</div>' +
    '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let _inFlight = false;

  async function refreshBugunOzeti() {
    const list = document.getElementById('bugun-ozet-list');
    if (!list) return;
    if (_inFlight) return;
    _inFlight = true;

    try {
      const sb = (typeof window.getSB === 'function') ? window.getSB() : null;
      if (!sb) {
        list.innerHTML = _renderError('Supabase istemcisi yok');
        return;
      }

      // Bugünün başlangıcı — yerel saatle 00:00:00, sonra ISO'ya çevir
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      // 3 sayaç paralel (count: 'exact', head: true → sadece COUNT, satır transferi yok)
      const [bekliyorRes, yoldaRes, teslimRes] = await Promise.all([
        sb.from('is_emirleri').select('id', { count: 'exact', head: true })
          .eq('durum', 'Bekliyor'),
        sb.from('is_emirleri').select('id', { count: 'exact', head: true })
          .in('durum', ['Yolda', 'Fabrikada', 'Boş Alındı', 'Alım Yapıldı']),
        sb.from('is_emirleri').select('id', { count: 'exact', head: true })
          .eq('durum', 'Teslim Edildi')
          .gte('teslim_zamani', todayISO)
      ]);

      if (bekliyorRes.error) throw bekliyorRes.error;
      if (yoldaRes.error)    throw yoldaRes.error;
      if (teslimRes.error)   throw teslimRes.error;

      const bekliyor = bekliyorRes.count || 0;
      const yolda    = yoldaRes.count    || 0;
      const teslim   = teslimRes.count   || 0;

      list.innerHTML =
        _renderRow('⏳', 'warning', 'Bekleyen iş emri',
                   'Henüz şoföre atanmamış / yola çıkmamış',
                   bekliyor, 'EMİR',
                   bekliyor > 0 ? 'list-row__metric--warning' : '') +
        _renderRow('🚛', 'info', 'Yolda',
                   'Aktif sefer (Yolda · Fabrikada · Alım)',
                   yolda, 'ARAÇ',
                   yolda > 0 ? 'list-row__metric--info' : '') +
        _renderRow('✓', 'success', 'Bugün teslim edildi',
                   'Tamamlanan sefer (bugün 00:00 sonrası)',
                   teslim, 'SEFER',
                   teslim > 0 ? 'list-row__metric--success' : '');
    } catch (err) {
      console.warn('[bugun-ozeti] hata:', (err && err.message) || err);
      list.innerHTML = _renderError((err && err.message) || 'Hata');
    } finally {
      _inFlight = false;
    }
  }

  // 5 dk periyodik refresh — dashboard görünür kaldığı sürece
  let _timer = null;
  function _startTimer() {
    if (_timer) return;
    _timer = setInterval(function () {
      if (document.visibilityState === 'visible') {
        refreshBugunOzeti();
      }
    }, 5 * 60 * 1000);
  }

  // Public
  window.refreshBugunOzeti = refreshBugunOzeti;

  function _init() {
    // İlk yüklemede session varsa hemen çalıştır
    setTimeout(function () {
      if (window._authToken || (window.getSB && typeof window.getSB === 'function')) {
        refreshBugunOzeti();
        _startTimer();
      }
    }, 1500);

    // Login sonrası (auth bridge hazır olunca) bir kez daha refresh
    document.addEventListener('fleetly:bridge-ready', function () {
      setTimeout(refreshBugunOzeti, 500);
      _startTimer();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  console.info('[bugun-ozeti] modül yüklendi');
})();
