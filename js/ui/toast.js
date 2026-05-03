/* ===================================================================
   toast.js — Fleetly Toast controller (Aşama 2)
   Mevcut showToast(msg, type) global fonksiyonuna alternatif clean API.
   #toast-container yoksa runtime'da oluşturur.

   API:
   FleetlyToast.show(msg, opts)
   FleetlyToast.success(msg)
   FleetlyToast.error(msg)
   FleetlyToast.info(msg)
   FleetlyToast.warning(msg)

   Mevcut showToast() çağrıları DEĞİŞMEDİ — bu controller paralel çalışır.
   =================================================================== */
(function () {
  const Toast = {};
  const DEFAULT_DURATION = 3500;

  function ensureContainer() {
    let c = document.getElementById('toast-container');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
    return c;
  }

  function iconFor(type) {
    switch (type) {
      case 'success': return '✓';
      case 'error':   return '⚠';
      case 'warning': return '!';
      case 'info':
      default:        return 'ℹ';
    }
  }

  Toast.show = function (msg, opts) {
    opts = opts || {};
    const type = opts.type || 'info';
    const duration = opts.duration || DEFAULT_DURATION;

    const c = ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    const ico = document.createElement('span');
    ico.style.cssText = 'font-size:16px;flex-shrink:0;line-height:1;';
    ico.textContent = iconFor(type);
    el.appendChild(ico);

    const text = document.createElement('span');
    text.style.cssText = 'flex:1;min-width:0';
    text.textContent = String(msg);
    el.appendChild(text);

    c.appendChild(el);

    // Otomatik kapan
    setTimeout(function () {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
    }, duration);

    return el;
  };

  Toast.success = function (msg, opts) { return Toast.show(msg, Object.assign({ type: 'success' }, opts || {})); };
  Toast.error   = function (msg, opts) { return Toast.show(msg, Object.assign({ type: 'error' },   opts || {})); };
  Toast.info    = function (msg, opts) { return Toast.show(msg, Object.assign({ type: 'info' },    opts || {})); };
  Toast.warning = function (msg, opts) { return Toast.show(msg, Object.assign({ type: 'warning' }, opts || {})); };

  window.FleetlyToast = Toast;

  // Mevcut showToast yoksa fallback'i Toast'a delege et
  if (typeof window.showToast !== 'function') {
    window.showToast = function (msg, type) { Toast.show(msg, { type: type || 'info' }); };
  }
})();
