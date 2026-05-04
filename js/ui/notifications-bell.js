/* =============================================================================
 * notifications-bell.js — Topbar bildirim zili UI kontrolü
 * -----------------------------------------------------------------------------
 * Bağımlılıklar (window): NotificationsAPI (notifications-api.js)
 *
 * - Polling 30sn, NotificationsAPI.startPolling
 * - onChange hook ile badge ve dropdown otomatik render
 * - Tıklanınca → ilgili kayıt drawer/sayfasına yönlendir
 * =========================================================================== */

(function () {
  'use strict';

  let _filter = 'all';
  let _booted = false;

  function $(id) { return document.getElementById(id); }

  // -----------------------------------------------------------------
  // İkon + renk haritası (tip bazlı)
  // -----------------------------------------------------------------
  const TIP_META = {
    is_emri_durum:  { icon: '📋', color: 'var(--blue)',   label: 'Durum' },
    is_emri_foto:   { icon: '📸', color: 'var(--accent)', label: 'Fotoğraf' },
    is_emri_yola:   { icon: '🚛', color: 'var(--blue)',   label: 'Yola Çıktı' },
    is_emri_teslim: { icon: '✅', color: 'var(--green)',  label: 'Teslim' },
    yakit:          { icon: '⛽', color: 'var(--yellow)', label: 'Yakıt' },
    ariza:          { icon: '⚠',  color: 'var(--red)',    label: 'Arıza' },
    genel:          { icon: '🔔', color: 'var(--text2)',  label: 'Bildirim' }
  };

  function _meta(tip) { return TIP_META[tip] || TIP_META.genel; }

  // -----------------------------------------------------------------
  // Zaman: "5 dk önce", "2 saat önce" vs.
  // -----------------------------------------------------------------
  function _relTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1)  return 'şimdi';
    if (min < 60) return min + ' dk önce';
    const h = Math.floor(min / 60);
    if (h < 24)   return h + ' sa önce';
    const d = Math.floor(h / 24);
    if (d < 7)    return d + ' gün önce';
    return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
  }

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  function _renderBadge(list) {
    const dot = $('topbar-notif-dot');
    const badge = $('topbar-notif-badge');
    const unread = list.filter(b => !b.okundu_mu).length;
    if (badge) {
      if (unread > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = unread > 99 ? '99+' : String(unread);
      } else {
        badge.style.display = 'none';
      }
    }
    if (dot) {
      dot.style.display = unread > 0 ? 'block' : 'none';
    }
  }

  function _renderList(list) {
    const host = $('notif-list');
    if (!host) return;
    const filtered = _filter === 'unread' ? list.filter(b => !b.okundu_mu) : list;

    const cnt = $('notif-panel-count');
    if (cnt) {
      const total = list.length;
      const unread = list.filter(b => !b.okundu_mu).length;
      cnt.textContent = unread > 0 ? `· ${unread} okunmamış / ${total}` : `· ${total} kayıt`;
    }

    const markAllBtn = $('notif-mark-all-btn');
    if (markAllBtn) {
      const hasUnread = list.some(b => !b.okundu_mu);
      markAllBtn.style.display = hasUnread ? 'inline-block' : 'none';
    }

    if (!filtered.length) {
      host.innerHTML = `
        <div style="text-align:center;padding:48px 16px;color:var(--muted);font-size:12.5px;">
          <div style="font-size:32px;opacity:.4;margin-bottom:8px;">🔕</div>
          ${_filter === 'unread' ? 'Okunmamış bildirim yok' : 'Henüz bildirim yok'}
        </div>`;
      return;
    }

    host.innerHTML = filtered.map(b => {
      const m = _meta(b.tip);
      const unread = !b.okundu_mu;
      const oncBordCol = ({
        kritik: 'var(--red)',
        yuksek: 'var(--accent)',
        normal: 'var(--border)',
        dusuk:  'var(--border)'
      })[b.oncelik || 'normal'] || 'var(--border)';

      return `
        <div onclick="notifClickItem('${b.id}','${b.ilgili_tur || ''}','${(b.ilgili_id || '').replace(/'/g,"\\'")}')"
             style="display:flex;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);background:${unread ? 'rgba(255,107,31,.04)' : 'transparent'};border-left:3px solid ${unread ? oncBordCol : 'transparent'};transition:background .12s;"
             onmouseover="this.style.background='var(--surface2)'"
             onmouseout="this.style.background='${unread ? 'rgba(255,107,31,.04)' : 'transparent'}'">
          <div style="width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.04);border-radius:8px;font-size:14px;">${m.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:2px;">
              <span style="font-size:12.5px;font-weight:${unread ? '700' : '600'};color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.baslik || ''}</span>
              <span style="font-size:10px;color:var(--muted);font-family:var(--font-mono);flex-shrink:0;">${_relTime(b.created_at)}</span>
            </div>
            ${b.mesaj ? `<div style="font-size:11.5px;color:var(--text2);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${_esc(b.mesaj)}</div>` : ''}
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <span style="font-size:9.5px;color:${m.color};font-weight:700;letter-spacing:.4px;text-transform:uppercase;">${m.label}</span>
              ${b.kaynak_ad ? `<span style="font-size:10px;color:var(--muted);">· ${_esc(b.kaynak_ad)}</span>` : ''}
              ${b.oncelik === 'kritik' ? '<span style="font-size:9.5px;background:var(--red);color:#fff;padding:1px 6px;border-radius:99px;font-weight:700;">KRİTİK</span>' : ''}
              ${b.oncelik === 'yuksek' && b.tip !== 'is_emri_teslim' ? '<span style="font-size:9.5px;background:rgba(255,107,31,.15);color:var(--accent);padding:1px 6px;border-radius:99px;font-weight:700;">ÖNEMLİ</span>' : ''}
            </div>
          </div>
          ${unread ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;align-self:center;"></div>' : ''}
        </div>`;
    }).join('');
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

  // -----------------------------------------------------------------
  // Panel toggle
  // -----------------------------------------------------------------
  function _isPanelOpen() {
    const p = $('notif-panel');
    return !!p && p.style.display !== 'none' && p.style.display !== '';
  }

  function _openPanel() {
    const p = $('notif-panel');
    const btn = $('topbar-notif');
    if (!p) return;
    p.style.display = 'flex';
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (window.NotificationsAPI) {
      window.NotificationsAPI.list({ limit: 30 }).catch(() => {});
    }
  }

  function _closePanel() {
    const p = $('notif-panel');
    const btn = $('topbar-notif');
    if (!p) return;
    p.style.display = 'none';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function notifTogglePanel(ev) {
    if (ev) {
      // Document click handler bu butona kanal yapmasın diye dur
      try { ev.stopPropagation(); } catch (_) {}
    }
    if (_isPanelOpen()) _closePanel();
    else _openPanel();
  }

  function _closePanelIfOutside(ev) {
    if (!_isPanelOpen()) return;
    const wrap = $('notif-wrap');
    if (wrap && !wrap.contains(ev.target)) _closePanel();
  }

  // ESC ile kapat
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _isPanelOpen()) {
      e.preventDefault();
      _closePanel();
    }
  });

  // -----------------------------------------------------------------
  // Filtre
  // -----------------------------------------------------------------
  function notifSetFilter(name, btn) {
    _filter = name;
    document.querySelectorAll('.notif-tab').forEach(b => {
      const active = b.dataset.filter === name;
      b.classList.toggle('is-active', active);
      b.style.color = active ? 'var(--text)' : 'var(--muted)';
      b.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    });
    if (window.NotificationsAPI) _renderList(window.NotificationsAPI.getCache());
  }

  // -----------------------------------------------------------------
  // Tıklama: kaydı okundu işaretle + ilgili kayda yönlendir
  // -----------------------------------------------------------------
  async function notifClickItem(id, ilgiliTur, ilgiliId) {
    if (!id) return;
    try { await window.NotificationsAPI.markRead(id); } catch (_) {}
    // Yönlendirme
    if (ilgiliTur === 'is_emri' && ilgiliId) {
      // Operasyon sayfası açık değilse aç, sonra drawer aç
      try {
        if (typeof openOperasyonPage === 'function' &&
            !document.getElementById('operasyon-page')?.classList.contains('open')) {
          openOperasyonPage();
        }
        setTimeout(() => {
          if (typeof openOpsDrawer === 'function') openOpsDrawer(parseInt(ilgiliId, 10) || ilgiliId);
        }, 200);
      } catch (e) { console.warn(e); }
    } else if (ilgiliTur === 'bakim') {
      try { if (typeof openFiloPage === 'function') openFiloPage(); } catch (e) {}
    }
    // Paneli kapat
    _closePanel();
  }

  async function notifMarkAllRead() {
    try {
      await window.NotificationsAPI.markAllRead();
      if (typeof toast === 'function') toast('Tüm bildirimler okundu olarak işaretlendi', 'success');
    } catch (err) {
      console.warn(err);
      if (typeof toast === 'function') toast('İşaretlenemedi: ' + err.message, 'error');
    }
  }

  // -----------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------
  function _boot() {
    if (_booted) return;
    if (!window.NotificationsAPI) return;
    _booted = true;
    // onChange hook → her güncellemede badge + liste
    window.NotificationsAPI.onChange(list => {
      _renderBadge(list);
      _renderList(list);
    });
    // Polling başlat
    window.NotificationsAPI.startPolling(30000);
    // Dış tıklama → paneli kapat
    document.addEventListener('click', _closePanelIfOutside);
  }

  // Auth oturumu ya da currentFirmaId set edildikten sonra başlat
  function _tryBoot() {
    // Kullanıcı login değilse veya firma yoksa atla
    if (window.NotificationsAPI && (window.currentFirmaId || (window.isLocalMode && window.isLocalMode()))) {
      _boot();
    }
  }

  // İki kez dener: DOMContentLoaded'da ve login event'i sonrasında
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_tryBoot, 500));
  } else {
    setTimeout(_tryBoot, 500);
  }
  // Login sonrası çağrılabilen genel hook
  window.addEventListener('fleetly:auth-ready', _tryBoot);
  // Yedek: ilk 5 saniye boyunca her saniye dene
  let _retries = 0;
  const _retryTimer = setInterval(() => {
    _retries++;
    if (_booted || _retries > 5) { clearInterval(_retryTimer); return; }
    _tryBoot();
  }, 1000);

  // Global handler'lar (onclick'ler için)
  window.notifTogglePanel  = notifTogglePanel;
  window.notifSetFilter    = notifSetFilter;
  window.notifClickItem    = notifClickItem;
  window.notifMarkAllRead  = notifMarkAllRead;
  window.notifBoot         = _boot; // manuel boot için
})();
