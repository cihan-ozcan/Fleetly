/* =============================================================================
 * impersonate-banner.js — Platform admin impersonation farkındalık bandı
 *
 * Bir platform admin başka bir kullanıcı adına oturum açtığında (magic link
 * üzerinden), o kullanıcı tab'ında üst bant gösterilir:
 *   "👁 Platform admin tarafından gözlemleniyorsunuz · Çık"
 *
 * Aktifasyon: URL'de ?impersonate=1 ile gelinir (admin-impersonate edge function
 * redirect_to'ya bu parametreyi koyar). Banner gösterilir + localStorage'a flag
 * yazılır → sayfa yenilemelerinde de görünür.
 *
 * Çıkış: signOut + localStorage temizle → ana siteye yönlendir.
 * ===========================================================================*/

(function () {
  'use strict';

  if (window.ImpersonateBanner) return;
  const STORAGE_KEY = '_fleetly_impersonating';

  // URL'den ?impersonate=1 parametresini al ve localStorage'a kaydet
  function check() {
    const url = new URL(window.location.href);
    const isImpersonate = url.searchParams.get('impersonate') === '1';
    const adminEmail    = url.searchParams.get('admin_email') || '';

    if (isImpersonate) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          admin_email: adminEmail,
          opened_at: new Date().toISOString(),
        }));
      } catch {}
      // Query parametresini URL'den temizle (görüntü kirliliği)
      url.searchParams.delete('impersonate');
      url.searchParams.delete('admin_email');
      history.replaceState(null, '', url.toString());
    }

    let state = null;
    try { state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
    if (!state) return;

    // 6 saatten eski impersonate session'ları otomatik temizle
    const opened = new Date(state.opened_at);
    if (Date.now() - opened.getTime() > 6 * 3600 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    inject(state);
  }

  function inject(state) {
    if (document.getElementById('imp-banner')) return;

    // CSS
    if (!document.getElementById('imp-banner-style')) {
      const s = document.createElement('style');
      s.id = 'imp-banner-style';
      s.textContent = `
        #imp-banner {
          position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
          background: repeating-linear-gradient(45deg, #b87333 0 10px, #a8392c 10px 20px);
          color: #faf7f0;
          font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
          font-size: 13px;
          padding: 10px 18px;
          display: flex; align-items: center; gap: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,.3);
          animation: imp-slide-down .25s ease-out;
        }
        @keyframes imp-slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        #imp-banner .imp-icon {
          width: 22px; height: 22px; flex-shrink: 0;
          background: rgba(255,255,255,.18);
          border: 1px solid rgba(255,255,255,.35);
          border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 13px;
        }
        #imp-banner .imp-body { flex: 1; min-width: 0; }
        #imp-banner .imp-title { font-weight: 700; letter-spacing: .04em; }
        #imp-banner .imp-text { opacity: .92; }
        #imp-banner .imp-text strong { font-weight: 600; }
        #imp-banner button {
          background: rgba(0,0,0,.25);
          color: inherit;
          border: 1px solid rgba(255,255,255,.4);
          padding: 6px 14px;
          font: inherit; font-size: 12px; font-weight: 600;
          cursor: pointer;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        #imp-banner button:hover {
          background: rgba(0,0,0,.45);
        }
        body.imp-active { padding-top: 44px; transition: padding-top .25s; }
      `;
      document.head.appendChild(s);
    }

    const banner = document.createElement('div');
    banner.id = 'imp-banner';
    banner.innerHTML = `
      <span class="imp-icon">👁</span>
      <div class="imp-body">
        <span class="imp-title">IMPERSONATE MODU</span>
        <span class="imp-text">
          Bu oturumu bir <strong>platform yöneticisi</strong> destek amacıyla başlattı${state.admin_email ? ' (' + esc(state.admin_email) + ')' : ''}.
          Yaptığınız işlemler audit log'a kaydedilir.
        </span>
      </div>
      <button onclick="ImpersonateBanner.exit()">Çıkış Yap</button>
    `;
    document.body.insertBefore(banner, document.body.firstChild);
    document.body.classList.add('imp-active');

    // Genel banner ile çakışma: platform-banner.js'in offset'i bunu da hesaba katsın
    // Şu an basitçe: imp-banner üstte, platform-banner onun altında biner.
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  async function exit() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    // Supabase signOut (varsa)
    try {
      if (window.supabase && window.FILO_CONFIG) {
        const sb = window.supabase.createClient(
          window.FILO_CONFIG.SUPABASE_URL,
          window.FILO_CONFIG.SUPABASE_ANON
        );
        await sb.auth.signOut();
      }
      if (window.getSB) {
        const sb = window.getSB();
        await sb?.auth?.signOut?.();
      }
    } catch {}
    window.location.href = '/';
  }

  window.ImpersonateBanner = { check, exit };

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check, { once: true });
  } else {
    check();
  }
})();
