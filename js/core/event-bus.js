/* ===================================================================
   event-bus.js — Fleetly merkezi pub/sub
   window.dispatchEvent + addEventListener üzerinde kurulu.
   Topic isimleri tutarlı olsun diye sabitler exports edilir.
   =================================================================== */
(function () {
  const Bus = {
    on: function (topic, handler) {
      window.addEventListener(topic, handler);
      return function off() { window.removeEventListener(topic, handler); };
    },
    once: function (topic, handler) {
      window.addEventListener(topic, handler, { once: true });
    },
    off: function (topic, handler) {
      window.removeEventListener(topic, handler);
    },
    emit: function (topic, detail) {
      try { window.dispatchEvent(new CustomEvent(topic, { detail: detail })); }
      catch (e) {}
    },
  };

  // Standart topic'ler — yeni event isimleri buraya yazılsın
  Bus.Topic = {
    BRIDGE_READY:  'fleetly:bridge-ready',
    THEME_CHANGE:  'fleetly:theme-change',
    SIDEBAR_TOGGLE:'fleetly:sidebar-toggle',
    DATA_REFRESH:  'fleetly:data-refresh',
    INCLUDES_READY:'fleetly:includes-ready',
  };

  window.FleetlyBus = Bus;
})();
