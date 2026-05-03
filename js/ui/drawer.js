/* ===================================================================
   drawer.js — Fleetly generic drawer controller (Aşama 2)

   Sağdan açılan panel'ler için. CRM drawer (.crm-drawer) hâlihazırda
   .hidden class ile yönetiliyor; bu controller ESC + backdrop click
   davranışını otomatik ekler ve yeni drawer'lar için temiz API sağlar.

   API:
   FleetlyDrawer.open(idOrEl, opts)
   FleetlyDrawer.close(idOrEl)
   FleetlyDrawer.toggle(idOrEl)
   =================================================================== */
(function () {
  const Drawer = {};
  let lastFocused = null;

  function isOpen(el) {
    if (!el) return false;
    return !el.classList.contains('hidden');
  }

  function getBackdrops() {
    return document.querySelectorAll('.drawer-backdrop, [data-drawer-backdrop]');
  }

  Drawer.open = function (idOrEl) {
    lastFocused = document.activeElement;
    const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
  };

  Drawer.close = function (idOrEl) {
    const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    // Drawer-backdrop'ı da kapat
    const bd = el.previousElementSibling;
    if (bd && bd.classList && bd.classList.contains('drawer-backdrop')) {
      bd.classList.add('hidden');
    }
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus({ preventScroll: true }); } catch (e) {}
    }
  };

  Drawer.toggle = function (idOrEl) {
    const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    if (isOpen(el)) Drawer.close(el);
    else Drawer.open(el);
  };

  Drawer.closeAll = function () {
    document.querySelectorAll('.crm-drawer, [data-drawer]').forEach(function (el) {
      if (isOpen(el)) Drawer.close(el);
    });
  };

  function init() {
    // Backdrop click → drawer kapat
    document.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.classList) return;
      if (!t.classList.contains('drawer-backdrop')) return;
      if (t.classList.contains('hidden')) return;
      Drawer.closeAll();
      t.classList.add('hidden');
    });

    // ESC → açık drawer kapat (modal yoksa)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // Modal varsa onun ESC'i öncelikli
      const openModal = document.querySelector(
        '.modal-backdrop:not(.hidden), .fuel-modal-backdrop:not(.hidden), ' +
        '.maint-modal-backdrop:not(.hidden), .driver-modal-backdrop:not(.hidden), ' +
        '.srm-backdrop:not(.hidden), .vehicle-select-backdrop:not(.hidden)'
      );
      if (openModal) return;
      const opens = document.querySelectorAll('.crm-drawer:not(.hidden), [data-drawer]:not(.hidden)');
      if (!opens.length) return;
      // Son açılanı kapat (basit yaklaşım: hepsi)
      opens.forEach(Drawer.close);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.FleetlyDrawer = Drawer;
})();
