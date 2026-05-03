/* ===================================================================
   dom.js — Fleetly DOM yardımcıları
   qs, qsa, on, ready, hide, show, toggle, attr — küçük şeffaf wrap
   =================================================================== */
(function () {
  const D = {
    qs:  function (sel, ctx) { return (ctx || document).querySelector(sel); },
    qsa: function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); },
    on:  function (el, evt, handler, opts) {
      if (!el) return function () {};
      el.addEventListener(evt, handler, opts);
      return function off() { el.removeEventListener(evt, handler, opts); };
    },
    ready: function (cb) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cb, { once: true });
      } else {
        cb();
      }
    },
    show: function (el) { if (el) el.style.display = ''; },
    hide: function (el) { if (el) el.style.display = 'none'; },
    toggle: function (el, force) {
      if (!el) return false;
      const wantHide = (force === undefined) ? (el.style.display !== 'none') : !force;
      el.style.display = wantHide ? 'none' : '';
      return !wantHide;
    },
    text: function (selOrEl, value) {
      const el = (typeof selOrEl === 'string') ? D.qs(selOrEl) : selOrEl;
      if (!el) return null;
      if (value === undefined) return el.textContent;
      el.textContent = value;
      return el;
    },
    addClass: function (el, cls) { if (el) el.classList.add(cls); },
    removeClass: function (el, cls) { if (el) el.classList.remove(cls); },
    toggleClass: function (el, cls, force) {
      if (!el) return false;
      return el.classList.toggle(cls, force);
    },
  };

  window.FleetlyDom = D;
})();
