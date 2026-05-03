/* ===================================================================
   app-shell.js — Sidebar + topbar app shell davranışları
   - toggleSidebar(): masaüstü = collapse/expand (240px ↔ 72px),
                      mobil    = overlay drawer aç/kapat
   - Mobilde backdrop tıklanınca veya ESC'e basınca kapan
   - <fleetly:includes-ready> yerine doğrudan DOMContentLoaded
   =================================================================== */
(function () {
  const MOBILE_QUERY = '(max-width: 1024px)';

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  window.toggleSidebar = function () {
    const shell = document.querySelector('.app-shell');
    const sidebar = document.getElementById('app-sidebar');
    if (!shell || !sidebar) return;

    if (isMobile()) {
      const open = sidebar.classList.toggle('is-open');
      document.body.classList.toggle('sidebar-open', open);
    } else {
      shell.classList.toggle('is-collapsed');
      // Tercihi hatırla
      try {
        localStorage.setItem(
          'fleetly:sidebar-collapsed',
          shell.classList.contains('is-collapsed') ? '1' : '0'
        );
      } catch (e) {}
    }
  };

  window.closeSidebar = function () {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('is-open');
    document.body.classList.remove('sidebar-open');
  };

  function init() {
    // Masaüstü collapse tercihini geri yükle
    try {
      if (localStorage.getItem('fleetly:sidebar-collapsed') === '1' && !isMobile()) {
        const shell = document.querySelector('.app-shell');
        if (shell) shell.classList.add('is-collapsed');
      }
    } catch (e) {}

    // Backdrop click → mobilde kapan
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', window.closeSidebar);

    // ESC tuşu → mobilde sidebar kapan
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
        window.closeSidebar();
      }
    });

    // Resize edildiğinde mobil → masaüstü geçişte body class temizle
    window.addEventListener('resize', function () {
      if (!isMobile()) {
        document.body.classList.remove('sidebar-open');
        const sb = document.getElementById('app-sidebar');
        if (sb) sb.classList.remove('is-open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
