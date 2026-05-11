/* =============================================================================
 * platform-banner.js — Platform admin duyuru + bakım modu banner sistemi
 *
 * Ana app (app.html), sofor.html, portal.html üzerinde çalışır.
 * Login sonrası ve periyodik olarak (5 dk) RPC'leri çağırır.
 * ===========================================================================*/

(function () {
  'use strict';

  if (window.PlatformBanner) return;   // tek init

  const POLL_MS = 5 * 60 * 1000;       // 5 dakika
  let _container = null;
  let _timer = null;

  // CSS enjeksiyon
  function injectStyle() {
    if (document.getElementById('platform-banner-style')) return;
    const s = document.createElement('style');
    s.id = 'platform-banner-style';
    s.textContent = `
      #platform-banner-host {
        position: fixed; top: 0; left: 0; right: 0;
        z-index: 9998;
        display: flex; flex-direction: column;
        pointer-events: none;
      }
      .pb-item {
        pointer-events: auto;
        font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
        font-size: 13px; line-height: 1.45;
        padding: 10px 18px;
        background: #15181c; color: #faf7f0;
        border-bottom: 1px solid rgba(255,255,255,.08);
        display: flex; align-items: center; gap: 12px;
        animation: pb-slide-in .25s ease-out;
      }
      @keyframes pb-slide-in {
        from { transform: translateY(-100%); opacity: 0; }
        to   { transform: translateY(0); opacity: 1; }
      }
      .pb-item.pb-bakim    { background: #a8392c; }
      .pb-item.pb-uyari    { background: #b87333; }
      .pb-item.pb-bilgi    { background: #15181c; }
      .pb-item.pb-kampanya { background: #1f6e44; }
      .pb-item.pb-yeni_ozellik { background: #1f6e44; }

      .pb-item-icon { flex-shrink: 0; opacity: .9; }
      .pb-item-body { flex: 1; min-width: 0; }
      .pb-item-title { font-weight: 600; margin-right: 6px; }
      .pb-item-text { opacity: .92; }
      .pb-item-link {
        display: inline-block;
        margin-left: 8px;
        padding: 3px 10px;
        background: rgba(255,255,255,.15);
        color: inherit;
        text-decoration: none;
        font-size: 11.5px;
        font-weight: 500;
        border-radius: 2px;
        border: 1px solid rgba(255,255,255,.25);
      }
      .pb-item-link:hover { background: rgba(255,255,255,.25); }
      .pb-item-close {
        flex-shrink: 0;
        background: transparent; border: none; color: inherit;
        cursor: pointer; padding: 4px 8px; font-size: 16px; opacity: .7;
      }
      .pb-item-close:hover { opacity: 1; }

      /* Sayfa içeriği için top offset (banner sayısına göre body padding-top) */
      body.pb-active { transition: padding-top .25s; }
    `;
    document.head.appendChild(s);
  }

  function ensureContainer() {
    if (_container) return _container;
    _container = document.createElement('div');
    _container.id = 'platform-banner-host';
    document.body.insertBefore(_container, document.body.firstChild);
    return _container;
  }

  function updateBodyOffset() {
    if (!_container) return;
    const visible = _container.querySelectorAll('.pb-item:not(.pb-closing)').length;
    document.body.classList.toggle('pb-active', visible > 0);
    if (visible > 0) {
      // Banner gerçek yüksekliği
      requestAnimationFrame(() => {
        document.body.style.paddingTop = _container.offsetHeight + 'px';
      });
    } else {
      document.body.style.paddingTop = '';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  function renderItem(d) {
    const cls = 'pb-' + (d.tip || 'bilgi');
    const div = document.createElement('div');
    div.className = 'pb-item ' + cls;
    div.dataset.id = d.id;

    const iconName = {
      'bakim':         'tools',
      'uyari':         'alert-triangle',
      'bilgi':         'info',
      'yeni_ozellik':  'sparkles',
      'kampanya':      'megaphone',
    }[d.tip] || 'info';

    div.innerHTML = `
      <span class="pb-item-icon">${window.FleetlyIcons ? window.FleetlyIcons.html(iconName, { size: 18 }) : ''}</span>
      <div class="pb-item-body">
        <span class="pb-item-title">${esc(d.baslik)}</span>
        <span class="pb-item-text">${esc(d.icerik)}</span>
        ${d.link_url ? `<a class="pb-item-link" href="${esc(d.link_url)}" target="_blank" rel="noopener">${esc(d.link_text || 'Detay')}</a>` : ''}
      </div>
      ${d.kapatilabilir ? `<button class="pb-item-close" title="Kapat" aria-label="Kapat">✕</button>` : ''}
    `;

    if (d.kapatilabilir) {
      div.querySelector('.pb-item-close').addEventListener('click', () => kapat(d.id, div));
    }
    return div;
  }

  async function kapat(duyuruId, el) {
    el.classList.add('pb-closing');
    el.style.maxHeight = el.offsetHeight + 'px';
    requestAnimationFrame(() => {
      el.style.transition = 'max-height .25s, padding .25s, opacity .25s';
      el.style.maxHeight = '0';
      el.style.padding = '0 18px';
      el.style.opacity = '0';
    });
    setTimeout(() => { el.remove(); updateBodyOffset(); }, 280);

    // Backend'e kapatma kaydı
    try {
      if (window.getSB) {
        const sb = window.getSB();
        await sb?.rpc('duyuru_kapat', { p_duyuru_id: duyuruId });
      } else if (window.sbUrl && window.sbHeaders) {
        await fetch(window.sbUrl('rpc/duyuru_kapat'), {
          method: 'POST',
          headers: { ...window.sbHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_duyuru_id: duyuruId }),
        });
      }
    } catch {}
  }

  function renderBakim(bakimAyari) {
    // Bakım modu (kalıcı, kapatılamaz) — özel item
    if (!bakimAyari?.aktif) return null;
    const div = document.createElement('div');
    div.className = 'pb-item pb-bakim';
    div.dataset.id = '__bakim__';
    div.innerHTML = `
      <span class="pb-item-icon">${window.FleetlyIcons ? window.FleetlyIcons.html('tools', { size: 18 }) : ''}</span>
      <div class="pb-item-body">
        <span class="pb-item-title">⚠ Sistem Bakımda</span>
        <span class="pb-item-text">${esc(bakimAyari.mesaj || 'Yazma işlemleri geçici olarak kapalıdır.')}</span>
        ${bakimAyari.bitis ? `<span class="pb-item-text" style="opacity:.7;margin-left:6px;">Tahmini bitiş: ${new Date(bakimAyari.bitis).toLocaleString('tr-TR')}</span>` : ''}
      </div>
    `;
    return div;
  }

  async function refresh() {
    injectStyle();
    const container = ensureContainer();

    let session;
    let sb;
    if (window.supabase && window.FILO_CONFIG) {
      sb = window.supabase.createClient(window.FILO_CONFIG.SUPABASE_URL, window.FILO_CONFIG.SUPABASE_ANON);
      session = (await sb.auth.getSession()).data.session;
    }

    // Bakım modu kontrolü (anon bile çağırabilir)
    let bakimAyari = null;
    try {
      const sbAnon = sb || window.supabase?.createClient(window.FILO_CONFIG?.SUPABASE_URL, window.FILO_CONFIG?.SUPABASE_ANON);
      if (sbAnon) {
        const aktifRes = await sbAnon.rpc('ayar_get', { p_anahtar: 'bakim_modu_aktif' });
        const mesajRes = await sbAnon.rpc('ayar_get', { p_anahtar: 'bakim_modu_mesaj' });
        const bitisRes = await sbAnon.rpc('ayar_get', { p_anahtar: 'bakim_modu_bitis' });
        if (aktifRes.data === true) {
          bakimAyari = {
            aktif: true,
            mesaj: mesajRes.data || 'Sistem bakımda',
            bitis: bitisRes.data || null,
          };
        }
      }
    } catch {}

    // Duyuruları çek (login gerekli)
    let duyurular = [];
    if (session && sb) {
      try {
        const { data } = await sb.rpc('kullanici_aktif_duyurular');
        duyurular = (data || []).filter(d => !d.zaten_kapatildi);
      } catch {}
    }

    // Render
    container.innerHTML = '';
    if (bakimAyari) {
      container.appendChild(renderBakim(bakimAyari));
    }
    duyurular.forEach(d => container.appendChild(renderItem(d)));
    updateBodyOffset();
  }

  function start() {
    refresh();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(refresh, POLL_MS);
    // Görünür olunca refresh
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });
  }

  // Public API
  window.PlatformBanner = { refresh, start };

  // Otomatik başlat (DOMContentLoaded sonrası)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
