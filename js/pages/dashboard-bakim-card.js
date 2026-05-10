/* =============================================================================
 * dashboard-bakim-card.js — Anasayfa "Yaklaşan Bakımlar" kartı
 * Faz 9 (post-launch feature)
 *
 * RPC: yaklasan_bakimlar_listele(p_gun)
 *   → bakim_randevulari (tip, plan_tarihi, durum, surucu_ad)
 *
 * Render hedefi: #upcoming-maint-list (app.html line ~1061)
 *
 * Refresh:
 *   - Login sonrası (checkAuth)
 *   - Manuel: window.refreshYaklasanBakimlar()
 *   - 5 dk timer (dashboard görünür kaldığı sürece)
 * =========================================================================== */

(function () {
  'use strict';

  const TIP_LABEL = {
    muayene:         { label: 'Muayene',           icon: '📋' },
    sigorta:         { label: 'Sigorta Yenileme',  icon: '🛡' },
    takograf:        { label: 'Takograf',          icon: '⏱' },
    periyodik_bakim: { label: 'Periyodik Bakım',   icon: '🔧' },
    lastik:          { label: 'Lastik',            icon: '🛞' },
    diger:           { label: 'Diğer',             icon: '🛠' }
  };

  function _kalanLabel(kg) {
    if (kg < 0)        return Math.abs(kg) + ' gün gecikti';
    if (kg === 0)      return 'Bugün';
    if (kg === 1)      return 'Yarın';
    return kg + ' gün';
  }

  function _severity(kg) {
    if (kg < 0)        return 'danger';
    if (kg <= 3)       return 'danger';
    if (kg <= 7)       return 'warning';
    return 'info';
  }

  function _formatTarih(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function _renderRow(row) {
    const sev   = _severity(row.kalan_gun);
    const tip   = TIP_LABEL[row.tip] || TIP_LABEL.diger;
    const kalan = _kalanLabel(row.kalan_gun);
    const sofor = row.surucu_ad ? ` · ${row.surucu_ad.trim()}` : '';
    return `
      <div class="list-row" data-rand-id="${row.id}" style="cursor:pointer"
           onclick="window._openBakimRandevuDetay && window._openBakimRandevuDetay(${row.id})"
           title="Detay için tıklayın">
        <div class="list-row__icon-box list-row__icon-box--${sev}" style="font-size:18px;">
          <span aria-hidden="true">${tip.icon}</span>
        </div>
        <div class="list-row__main">
          <div class="list-row__title">
            ${escapeHtml(row.arac_plaka || row.arac_id)}
            <span class="muted" style="font-weight:400"> · ${escapeHtml(tip.label)}</span>
          </div>
          <div class="list-row__sub">${_formatTarih(row.plan_tarihi)}${escapeHtml(sofor)}</div>
        </div>
        <div class="list-row__right">
          <div class="list-row__metric list-row__metric--${sev === 'info' ? '' : sev}">${escapeHtml(kalan)}</div>
          <div class="list-row__lbl mono" style="text-transform:uppercase;letter-spacing:.04em;">${escapeHtml((row.arac_tip || '').slice(0, 8))}</div>
        </div>
      </div>`;
  }

  function _renderEmpty() {
    return `
      <div class="list-row" style="opacity:.7">
        <div class="list-row__icon-box list-row__icon-box--info">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
        </div>
        <div class="list-row__main">
          <div class="list-row__title">Yaklaşan bakım yok 🎉</div>
          <div class="list-row__sub">Önümüzdeki 30 gün için planlanmış randevu bulunmuyor</div>
        </div>
        <div class="list-row__right">
          <button class="btn--ghost btn--sm" onclick="window._openYeniBakimRandevu && window._openYeniBakimRandevu()" style="font-size:11px;">+ Randevu</button>
        </div>
      </div>`;
  }

  function _renderLoading() {
    return `
      <div class="list-row" style="opacity:.5">
        <div class="list-row__icon-box list-row__icon-box--info">⏳</div>
        <div class="list-row__main">
          <div class="list-row__title">Yükleniyor…</div>
          <div class="list-row__sub">Randevular okunuyor</div>
        </div>
      </div>`;
  }

  function _renderError(msg) {
    return `
      <div class="list-row" style="opacity:.7">
        <div class="list-row__icon-box list-row__icon-box--danger">⚠</div>
        <div class="list-row__main">
          <div class="list-row__title">Veri alınamadı</div>
          <div class="list-row__sub">${escapeHtml(msg || 'Bilinmeyen hata')}</div>
        </div>
        <div class="list-row__right">
          <button class="btn--ghost btn--sm" onclick="window.refreshYaklasanBakimlar()" style="font-size:11px;">Tekrar dene</button>
        </div>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let _inFlight = false;

  async function refreshYaklasanBakimlar() {
    const list = document.getElementById('upcoming-maint-list');
    if (!list) return;
    if (_inFlight) return;
    _inFlight = true;
    list.innerHTML = _renderLoading();

    try {
      const sb = (typeof window.getSB === 'function') ? window.getSB() : null;
      if (!sb) {
        list.innerHTML = _renderError('Supabase istemcisi yok');
        return;
      }
      const { data, error } = await sb.rpc('yaklasan_bakimlar_listele', { p_gun: 30 });
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        list.innerHTML = _renderEmpty();
      } else {
        // Üst 4 satır göster — fazla varsa "Tümü" butonuyla görünsün
        list.innerHTML = rows.slice(0, 4).map(_renderRow).join('');
        if (rows.length > 4) {
          list.insertAdjacentHTML('beforeend', `
            <div class="list-row" style="opacity:.7;cursor:pointer" onclick="window._openBakimRandevuList && window._openBakimRandevuList()">
              <div class="list-row__icon-box list-row__icon-box--info">+</div>
              <div class="list-row__main">
                <div class="list-row__title">${rows.length - 4} randevu daha</div>
                <div class="list-row__sub">Tümünü görmek için tıklayın</div>
              </div>
            </div>`);
        }
      }
    } catch (err) {
      console.warn('[bakim-card] hata:', err?.message || err);
      list.innerHTML = _renderError(err?.message || 'Hata');
    } finally {
      _inFlight = false;
    }
  }

  // 5 dk periyodik refresh — dashboard görünür kaldığı sürece
  let _timer = null;
  function _startTimer() {
    if (_timer) return;
    _timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshYaklasanBakimlar();
      }
    }, 5 * 60 * 1000);
  }

  // Public
  window.refreshYaklasanBakimlar = refreshYaklasanBakimlar;

  // Auth değişikliklerinde otomatik tetikleme
  function _init() {
    // İlk yüklemede session varsa hemen çalıştır
    setTimeout(() => {
      if (window._authToken || (window.getSB && typeof window.getSB === 'function')) {
        refreshYaklasanBakimlar();
        _startTimer();
      }
    }, 1500);

    // checkAuth tetiklendikten sonra (login sonrası) bir kez daha refresh
    document.addEventListener('fleetly:bridge-ready', () => {
      setTimeout(refreshYaklasanBakimlar, 500);
      _startTimer();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  console.info('[bakim-card] modül yüklendi');
})();
