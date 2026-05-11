/* =============================================================================
 * cookie-consent.js — KVKK / Çerez Onay Banner'ı (Faz 5)
 * -----------------------------------------------------------------------------
 * Tüm sayfalara tek <script src="js/core/cookie-consent.js" defer> ile dahil
 * edilir. localStorage'a 'fleetly-cookie-consent' = 'all' | 'essential' yazar.
 *
 * Davranış:
 *   - Onay yoksa sayfa yüklendikten 600ms sonra alt-orta/alt-sağda banner
 *   - "Tümünü Kabul Et"  → all
 *   - "Yalnızca Zorunlu" → essential
 *   - "Detay"            → /kvkk/ sekmesi
 *
 * Yeniden açma:
 *   - window.openCookieSettings() global fonksiyon (footer linkten çağrılabilir)
 *
 * ÖNEMLİ:
 *   - Şu an Fleetly yalnızca zorunlu çerezler kullanıyor (oturum + tema).
 *   - "Tümünü Kabul" olmasa bile uygulama çalışır; banner sadece KVKK uyumu.
 *   - Yarın 3. taraf analitik (GA4, Pixel) eklendiğinde, bu modül üzerinden
 *     gating yapılır:  if (window.cookieConsent?.allows('analytics')) { ... }
 * =========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEY = 'fleetly-cookie-consent';
  const VERSION     = '1';                              // Politika değişirse bump et — eski onay sıfırlanır
  const VERSION_KEY = 'fleetly-cookie-consent-version';

  function getConsent() {
    try {
      const v = localStorage.getItem(VERSION_KEY);
      if (v !== VERSION) return null;                   // sürüm uyuşmazsa onay geçersiz
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch (_) { return null; }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
      localStorage.setItem(VERSION_KEY, VERSION);
    } catch (_) {}
  }

  // Public API — analytics/marketing eklenince burayı kullan
  window.cookieConsent = {
    get: () => getConsent(),
    allows: (category) => {
      const c = getConsent();
      if (c === 'all') return true;
      if (c === 'essential') return category === 'essential';
      return false;
    }
  };

  function injectStyles() {
    if (document.getElementById('fl-cc-styles')) return;
    const s = document.createElement('style');
    s.id = 'fl-cc-styles';
    s.textContent = `
      .fl-cc-overlay{
        position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
        z-index:2147483600;
        max-width:560px;width:calc(100% - 24px);
        background:#0B1A2F;color:#fff;
        border:1px solid rgba(255,255,255,.08);
        border-radius:14px;
        box-shadow:0 20px 50px rgba(0,0,0,.40), 0 0 0 1px rgba(255,107,31,.18);
        font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
        font-size:14px;line-height:1.55;
        padding:18px 20px 16px;
        animation:fl-cc-in .35s ease-out both;
      }
      @keyframes fl-cc-in{
        from{opacity:0;transform:translate(-50%,16px)}
        to  {opacity:1;transform:translate(-50%,0)}
      }
      .fl-cc-title{
        font-weight:700;font-size:15px;color:#fff;
        margin:0 0 6px;display:flex;align-items:center;gap:8px;
      }
      .fl-cc-title .fl-cc-emoji{font-size:18px}
      .fl-cc-body{color:#C7D7EC;margin:0 0 14px}
      .fl-cc-body a{color:#FF6B1F;text-decoration:underline;text-underline-offset:2px}
      .fl-cc-body a:hover{color:#FFB07A}
      .fl-cc-actions{
        display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;
      }
      .fl-cc-btn{
        font:inherit;border:none;cursor:pointer;
        padding:9px 14px;border-radius:8px;
        font-weight:600;font-size:13.5px;
        transition:transform .12s, background .15s, border-color .15s;
      }
      .fl-cc-btn:focus-visible{outline:2px solid #FF6B1F;outline-offset:2px}
      .fl-cc-btn--primary{
        background:#FF6B1F;color:#fff;
        box-shadow:0 4px 12px rgba(255,107,31,.30);
      }
      .fl-cc-btn--primary:hover{background:#E55A0F;transform:translateY(-1px)}
      .fl-cc-btn--ghost{
        background:transparent;color:#C7D7EC;
        border:1px solid rgba(255,255,255,.16);
      }
      .fl-cc-btn--ghost:hover{background:rgba(255,255,255,.06);color:#fff}
      .fl-cc-btn--link{
        background:transparent;color:#9DB1CC;text-decoration:underline;
        text-underline-offset:3px;padding:9px 6px;
      }
      .fl-cc-btn--link:hover{color:#fff}
      @media (max-width:520px){
        .fl-cc-overlay{left:8px;right:8px;bottom:8px;transform:none;width:auto;max-width:none;padding:16px}
        .fl-cc-actions{flex-direction:column-reverse;align-items:stretch}
        .fl-cc-btn{width:100%;text-align:center}
      }
      @keyframes fl-cc-out{
        from{opacity:1;transform:translate(-50%,0)}
        to  {opacity:0;transform:translate(-50%,12px)}
      }
      .fl-cc-overlay.fl-cc-leaving{animation:fl-cc-out .25s ease-in forwards}
    `;
    document.head.appendChild(s);
  }

  function show() {
    if (document.getElementById('fl-cc-banner')) return;
    injectStyles();

    const wrap = document.createElement('div');
    wrap.id = 'fl-cc-banner';
    wrap.className = 'fl-cc-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Çerez onayı');
    wrap.innerHTML = `
      <div class="fl-cc-title">
        <span class="fl-cc-emoji">🍪</span>
        <span>Çerez Tercihleriniz</span>
      </div>
      <div class="fl-cc-body">
        Fleetly.fit, oturum yönetimi ve tema tercihiniz için
        <strong>yalnızca zorunlu çerezler</strong> kullanır. Pazarlama veya
        üçüncü taraf takip çerezi yoktur. Detay için
        <a href="/kvkk/" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>'mizi inceleyebilirsiniz.
      </div>
      <div class="fl-cc-actions">
        <button type="button" class="fl-cc-btn fl-cc-btn--link"  data-cc="detail">Detay</button>
        <button type="button" class="fl-cc-btn fl-cc-btn--ghost" data-cc="essential">Yalnızca Zorunlu</button>
        <button type="button" class="fl-cc-btn fl-cc-btn--primary" data-cc="all">Tümünü Kabul Et</button>
      </div>
    `;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cc]');
      if (!btn) return;
      const action = btn.getAttribute('data-cc');
      if (action === 'detail') {
        window.open('/kvkk/', '_blank', 'noopener');
        return;
      }
      setConsent(action);
      hide();
    });
  }

  function hide() {
    const w = document.getElementById('fl-cc-banner');
    if (!w) return;
    w.classList.add('fl-cc-leaving');
    setTimeout(() => w.remove(), 260);
  }

  // Footer linkleri için: sayfanın herhangi bir yerinden tekrar açılabilir
  window.openCookieSettings = function () {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(VERSION_KEY);
    } catch (_) {}
    show();
  };

  function init() {
    if (getConsent()) return;          // zaten karar verilmiş — banner çıkmaz
    // Robots/SEO bot'larında banner çıkmasın (basit user-agent kontrolü)
    if (/bot|crawler|spider|crawling/i.test(navigator.userAgent || '')) return;
    // Sayfa hazır olunca, küçük gecikme ile (UX — ilk paint'i bozmasın)
    setTimeout(show, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
