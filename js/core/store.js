/* ===================================================================
   store.js — Fleetly veri store wrapper
   window._fleetly.snapshot üzerinden mevcut JS'in let-scoped
   verilerine read-only erişim sağlar. Subscribe API ile periyodik
   ya da event-driven güncellemeler dinlenebilir.

   Mevcut JS'e dokunmadan: app-chunk-02.js sonundaki "bridge expose"
   bu store'un veri kaynağıdır. Yazma operasyonu yoktur — sadece read.
   =================================================================== */
(function () {
  const Store = {
    /** Mevcut snapshot'ı döner (vehicles, drivers, maint, sefer, ...) */
    snapshot: function () {
      try { return (window._fleetly && window._fleetly.snapshot) || null; }
      catch (e) { return null; }
    },
    /** Bir alanı doğrudan döner; bridge yok ise null */
    get: function (key) {
      const s = this.snapshot();
      return s ? s[key] : null;
    },
    /** Bridge hazır olduğunda callback */
    onReady: function (cb) {
      try {
        const s = this.snapshot();
        if (s) { cb(s); return; }
      } catch (e) {}
      window.addEventListener('fleetly:bridge-ready', function once() {
        window.removeEventListener('fleetly:bridge-ready', once);
        cb(Store.snapshot());
      });
    },
    /** Periyodik refresh — her N ms'de bir cb(snapshot) çağırır */
    poll: function (cb, intervalMs) {
      const ms = intervalMs || 5000;
      const id = setInterval(function () {
        const s = Store.snapshot();
        if (s) cb(s);
      }, ms);
      return function stop() { clearInterval(id); };
    },
  };

  window.FleetlyStore = Store;
})();
