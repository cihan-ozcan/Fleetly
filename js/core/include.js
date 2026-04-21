/* ===================================================================
   include.js — <fleetly-include src="path/to/component.html">
   --------------------------------------------------------------------
   Çok hafif bir "HTML include" mekaniği. Derleme adımı gerektirmez.

   Nasıl çalışır
   -------------
   1. <fleetly-include src="components/header.html"></fleetly-include>
      şeklinde yazın.
   2. connectedCallback içinde HTML fetch edilir ve outerHTML olarak
      element yerine basılır.
   3. Tüm include'lar bittiğinde document seviyesinde
      `fleetly:includes-ready` custom event'i atılır.

   Bağımlılık
   -----------
   Dev sunucusu gerekir (file:// protokolünde fetch çalışmaz).
   Kök klasörde: `python3 -m http.server 5173` veya benzeri.

   İleri geliştirme
   ----------------
   - data-slot="name" ile slot desteği (ileride).
   - Basit istemci-tarafı cache (aynı src tekrar çağrılırsa sessionStorage).

   Not
   ----
   app.html'in kendi iç <header>/modal blokları şu an bu mekanizma ile
   DEĞİŞTİRİLMEDİ. Oradaki inline script timing'ini korumak için,
   app.html içeriği yerinde bırakıldı. components/app-header.html gibi
   dosyalar canonical kaynak görevi görür; gelecekte app.html de bu
   include mekaniğine bağlanabilir.
   =================================================================== */

(function () {
  'use strict';

  var PENDING = 0;
  var READY_FIRED = false;
  var CACHE = Object.create(null);

  function maybeFireReady() {
    if (PENDING === 0 && !READY_FIRED) {
      READY_FIRED = true;
      document.dispatchEvent(new CustomEvent('fleetly:includes-ready'));
    }
  }

  function injectHTML(element, html) {
    // Create a temporary container, parse HTML, then move children.
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var frag = tpl.content;

    // <script> tags coming from the fetched HTML must be re-created to execute.
    var scripts = frag.querySelectorAll('script');
    scripts.forEach(function (oldScript) {
      var newScript = document.createElement('script');
      // Preserve attributes
      for (var i = 0; i < oldScript.attributes.length; i++) {
        var a = oldScript.attributes[i];
        newScript.setAttribute(a.name, a.value);
      }
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });

    element.replaceWith(frag);
  }

  function fetchHTML(src) {
    if (CACHE[src]) {
      return Promise.resolve(CACHE[src]);
    }
    return fetch(src, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) {
          throw new Error('Include fetch failed: ' + src + ' (' + r.status + ')');
        }
        return r.text();
      })
      .then(function (txt) {
        CACHE[src] = txt;
        return txt;
      });
  }

  /* ─── Custom Element ────────────────────────────────────────── */
  if (!customElements.get('fleetly-include')) {
    customElements.define(
      'fleetly-include',
      class FleetlyInclude extends HTMLElement {
        connectedCallback() {
          var src = this.getAttribute('src');
          if (!src) {
            console.warn('[fleetly-include] src attribute missing');
            this.remove();
            return;
          }

          PENDING++;
          fetchHTML(src)
            .then(function (html) {
              injectHTML(this, html);
            }.bind(this))
            .catch(function (err) {
              console.error('[fleetly-include]', err);
              // Hata durumunda element'i boş bırakma, açıklayıcı placeholder yerleştir
              var warn = document.createElement('div');
              warn.setAttribute('data-include-error', src);
              warn.style.cssText =
                'background:#7f1d1d;color:#fff;padding:8px 12px;border-radius:6px;font:12px monospace';
              warn.textContent = '[fleetly-include] ' + src + ' yüklenemedi';
              this.replaceWith(warn);
            }.bind(this))
            .then(function () {
              PENDING--;
              maybeFireReady();
            });
        }
      }
    );
  }

  /* ─── DOMContentLoaded sonrası hiçbir include yoksa ready'yi tetikle ── */
  document.addEventListener('DOMContentLoaded', function () {
    // connectedCallback'ler DOMContentLoaded'dan önce çalışır, ancak emin olalım.
    setTimeout(maybeFireReady, 0);
  });
})();
