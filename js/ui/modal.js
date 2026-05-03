/* ===================================================================
   modal.js — Fleetly generic modal controller (Aşama 2)
   Mevcut modal'lara dokunmadan ek kullanışlı davranış katmanı:
   - Backdrop click → kapanma (.hidden class veya .open kaldırma)
   - ESC tuşu → en üstteki modal kapanır
   - Focus geri yükleme (modal kapanınca açıldığı butona geri döner)

   Kullanım:
   - Otomatik: tüm `[class$="-backdrop"]` elementlerinde aktif
   - Manuel: FleetlyModal.open(id), FleetlyModal.close(id)

   Not: mevcut close-on-backdrop davranışı bazı modal'larda zaten var;
   bu controller idempotent çalışır — duplicate kapatma sorun çıkarmaz.
   =================================================================== */
(function () {
  const Modal = {};
  let lastFocused = null;

  function isOpen(backdrop) {
    if (!backdrop) return false;
    if (backdrop.classList.contains('hidden')) return false;
    if (backdrop.classList.contains('open')) return true;
    // Default: hidden class yoksa açık say
    return getComputedStyle(backdrop).display !== 'none';
  }

  function findOpenBackdrops() {
    const all = document.querySelectorAll(
      '.modal-backdrop, .fuel-modal-backdrop, .maint-modal-backdrop, ' +
      '.driver-modal-backdrop, .srm-backdrop, .vehicle-select-backdrop, ' +
      '.dash-edit-backdrop, .pod-sheet-bg'
    );
    const open = [];
    all.forEach(function (el) { if (isOpen(el)) open.push(el); });
    return open;
  }

  function tryClose(backdrop) {
    if (!backdrop) return false;
    // pod-sheet özel davranış: .open class kaldırılır (CSS animation tetikler)
    if (backdrop.classList.contains('pod-sheet-bg')) {
      backdrop.classList.remove('open');
      const sheet = document.querySelector('.pod-sheet');
      if (sheet) sheet.classList.remove('open');
      return true;
    }
    backdrop.classList.add('hidden');
    return true;
  }

  Modal.open = function (idOrEl) {
    lastFocused = document.activeElement;
    const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.classList.remove('hidden');
  };

  Modal.close = function (idOrEl) {
    const el = (typeof idOrEl === 'string') ? document.getElementById(idOrEl) : idOrEl;
    tryClose(el);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus({ preventScroll: true }); } catch (e) {}
    }
  };

  Modal.closeTopmost = function () {
    const opens = findOpenBackdrops();
    if (!opens.length) return false;
    // En son açılan = en yüksek z-index
    let top = opens[0];
    let topZ = parseInt(getComputedStyle(top).zIndex || '0', 10);
    for (let i = 1; i < opens.length; i++) {
      const z = parseInt(getComputedStyle(opens[i]).zIndex || '0', 10);
      if (z >= topZ) { top = opens[i]; topZ = z; }
    }
    return tryClose(top);
  };

  function init() {
    // Backdrop click → kapan (eğer click direkt backdrop'a düştüyse, içeri değil)
    document.addEventListener('click', function (e) {
      const target = e.target;
      if (!target || !target.classList) return;

      // Backdrop class'larından biri mi?
      const isBackdrop =
        target.classList.contains('modal-backdrop') ||
        target.classList.contains('fuel-modal-backdrop') ||
        target.classList.contains('maint-modal-backdrop') ||
        target.classList.contains('driver-modal-backdrop') ||
        target.classList.contains('srm-backdrop') ||
        target.classList.contains('vehicle-select-backdrop') ||
        target.classList.contains('pod-sheet-bg');
      if (!isBackdrop) return;
      if (!isOpen(target)) return;
      tryClose(target);
    });

    // ESC → en üstteki modal kapan
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // Sidebar drawer açıksa app-shell.js zaten yakalar
      if (document.body.classList.contains('sidebar-open')) return;
      if (Modal.closeTopmost()) {
        e.stopPropagation();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.FleetlyModal = Modal;
})();
