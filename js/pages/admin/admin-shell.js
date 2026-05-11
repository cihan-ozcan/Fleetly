/* =============================================================================
 * admin-shell.js — Platform admin paneli iskelet
 *
 * Sorumluluklar:
 *   • Supabase session yükle
 *   • _is_platform_admin() RPC ile yetki kontrolü
 *   • Sidebar nav route'ları aç/kapat
 *   • Section değişiminde modül init() çağır
 *   • Toast, Modal, sb yardımcıları (window'a yayın)
 *
 * Diğer admin modülleri (dashboard.js, firmalar.js, ...) bu shell'in API'sini
 * (`window.AdmAPI`) kullanır.
 * ===========================================================================*/

(function () {
  'use strict';

  const CFG = window.FILO_CONFIG || {};
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON) {
    document.getElementById('adm-loading').innerHTML =
      '<div class="adm-loading-inner"><div class="adm-loading-title">Config eksik</div>' +
      '<div class="adm-loading-sub">config.js içinde SUPABASE_URL / SUPABASE_ANON gerekli.</div></div>';
    return;
  }

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  let _user = null;
  let _accessToken = null;
  let _currentSection = 'dashboard';
  const _initializedSections = new Set();

  // ── RPC çağrı yardımcısı (Supabase SDK üzerinden, çünkü Auth otomatik handle ediliyor) ──
  async function rpc(name, params) {
    const { data, error } = await sb.rpc(name, params || {});
    if (error) throw new Error(error.message || error.toString());
    return data;
  }

  // REST sorgular için (PostgREST raw)
  function sbUrl(path) { return CFG.SUPABASE_URL + '/rest/v1/' + path; }
  function sbHeaders() {
    return {
      'Content-Type'  : 'application/json',
      'apikey'        : CFG.SUPABASE_ANON,
      'Authorization' : 'Bearer ' + (_accessToken || CFG.SUPABASE_ANON),
      'Prefer'        : 'return=representation',
    };
  }

  // Edge Function çağrısı
  async function edgeFn(name, body) {
    const url = CFG.SUPABASE_URL + '/functions/v1/' + name;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type'  : 'application/json',
        'apikey'        : CFG.SUPABASE_ANON,
        'Authorization' : 'Bearer ' + (_accessToken || CFG.SUPABASE_ANON),
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || ('Edge fn ' + name + ' HTTP ' + res.status));
    }
    return data;
  }

  // ── Toast ──
  let _toastTimer = null;
  function toast(msg, tip) {
    const el = document.getElementById('adm-toast');
    if (!el) return;
    clearTimeout(_toastTimer);
    el.textContent = msg;
    el.className = 'adm-toast show ' + (tip || '');
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ── Modal ──
  function modalAc(baslik, gövdeHtml, opts) {
    opts = opts || {};
    const el = document.getElementById('adm-modal');
    document.getElementById('adm-modal-title').textContent = baslik;
    document.getElementById('adm-modal-body').innerHTML = gövdeHtml;
    el.classList.remove('hidden');
    if (typeof opts.onOpen === 'function') opts.onOpen();
  }
  function modalKapat() {
    document.getElementById('adm-modal').classList.add('hidden');
    document.getElementById('adm-modal-body').innerHTML = '';
  }
  window.admModalKapat = modalKapat;

  // ── Format yardımcıları ──
  function fmtTRY(n) { return n == null ? '—' : Math.round(n).toLocaleString('tr-TR'); }
  function fmtNum(n, dec) { if (n == null) return '—'; const m = Math.pow(10, dec||0); return (Math.round(n*m)/m).toLocaleString('tr-TR', { maximumFractionDigits: dec||0 }); }
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' });
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function fmtRelative(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'şimdi';
    if (diff < 3600) return Math.floor(diff/60) + ' dk önce';
    if (diff < 86400) return Math.floor(diff/3600) + ' sa önce';
    if (diff < 604800) return Math.floor(diff/86400) + ' gün önce';
    return fmtDate(s);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  // ── Auth flow ──
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) {
      // Login değil → redirect (login formu gösterilebilir burada da)
      window.location.href = '/index.html?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    _user = session.user;
    _accessToken = session.access_token;

    // Platform admin mi?
    let isAdmin = false;
    try {
      isAdmin = await rpc('_is_platform_admin');
    } catch (err) {
      console.error('Platform admin kontrolü başarısız:', err);
    }

    if (!isAdmin) {
      document.getElementById('adm-loading').classList.add('hidden');
      document.getElementById('adm-unauthorized').classList.remove('hidden');
      return;
    }

    // OK — shell'i göster
    document.getElementById('adm-loading').classList.add('hidden');
    document.getElementById('adm-shell').classList.remove('hidden');

    // Kullanıcı kartı
    document.getElementById('adm-user-email').textContent = _user.email || '—';
    document.getElementById('adm-user-name').textContent = (_user.user_metadata?.ad_soyad)
      || (_user.email ? _user.email.split('@')[0] : 'Platform Admin');

    // Nav handler
    document.querySelectorAll('.adm-nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const sec = item.getAttribute('data-section');
        navigate(sec);
      });
    });

    // URL hash desteği
    const initialHash = (location.hash || '').replace('#', '');
    if (initialHash) {
      navigate(initialHash);
    } else {
      navigate('dashboard');
    }
    window.addEventListener('hashchange', () => {
      const h = (location.hash || '').replace('#', '');
      if (h) navigate(h);
    });
  }

  function navigate(section) {
    if (!section || !document.querySelector('.adm-section[data-section="'+section+'"]')) {
      section = 'dashboard';
    }
    _currentSection = section;
    document.querySelectorAll('.adm-nav-item').forEach(n => {
      n.classList.toggle('active', n.getAttribute('data-section') === section);
    });
    document.querySelectorAll('.adm-section').forEach(s => {
      s.classList.toggle('hidden', s.getAttribute('data-section') !== section);
    });
    // Modülün init() fonksiyonunu çağır
    if (!_initializedSections.has(section)) {
      _initializedSections.add(section);
      const moduleName = 'AdmModule_' + section;
      const m = window[moduleName];
      if (m && typeof m.init === 'function') {
        try { m.init(); }
        catch (err) { console.error('Modül init hatası:', section, err); }
      }
    } else {
      // Refresh yerine onShow varsa çağır
      const m = window['AdmModule_' + section];
      if (m && typeof m.onShow === 'function') m.onShow();
    }
    // URL hash güncelle
    if (location.hash !== '#' + section) {
      history.replaceState(null, '', '#' + section);
    }
  }

  // Logout
  async function logout() {
    await sb.auth.signOut();
    window.location.href = '/';
  }
  window.admLogout = logout;

  // ── Public API (modüllerin kullanacağı) ──
  window.AdmAPI = {
    sb, rpc, sbUrl, sbHeaders, edgeFn,
    user: () => _user,
    toast,
    modalAc, modalKapat,
    navigate,
    fmt: { try: fmtTRY, num: fmtNum, date: fmtDate, dateTime: fmtDateTime, relative: fmtRelative },
    esc,
    currentSection: () => _currentSection,
  };

  // Start
  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
