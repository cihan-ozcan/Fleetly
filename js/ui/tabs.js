/* ===================================================================
   tabs.js — Fleetly generic tab controller (Aşama 2)

   `data-tabs` özniteliğine sahip bir container'ı ve içindeki
   `data-tab="<id>"` butonlarını + `data-tab-panel="<id>"` panellerini
   otomatik bağlar.

   Mevcut tab sistemleri (.srm-tabs, #crm-page .tab-bar, .filter-tabs, vs.)
   olduğu gibi çalışmaya devam eder — onlara dokunulmaz. Bu controller
   YENİ tablo/panel'ler için temiz bir API sağlar.

   Örnek HTML:
     <div class="srm-tabs" data-tabs>
       <button class="srm-tab" data-tab="seferler">Seferler</button>
       <button class="srm-tab" data-tab="rota">Rota</button>
     </div>
     <div data-tab-panel="seferler" class="srm-panel">…</div>
     <div data-tab-panel="rota"     class="srm-panel">…</div>

   API:
   FleetlyTabs.activate(containerOrSelector, tabId)
   FleetlyTabs.bind(container)   — manuel bind (auto-bind sonrası dinamik)
   =================================================================== */
(function () {
  const Tabs = {};

  function activate(container, tabId) {
    if (!container) return;
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return;
    const buttons = container.querySelectorAll('[data-tab]');
    buttons.forEach(function (b) {
      const isActive = b.getAttribute('data-tab') === tabId;
      b.classList.toggle('active', isActive);
      b.classList.toggle('is-active', isActive);
      if (isActive) b.setAttribute('aria-selected', 'true');
      else b.setAttribute('aria-selected', 'false');
    });
    // Panelleri global ya da container'ın parent'ından bul
    const scope = container.closest('[data-tab-scope]') || document;
    const panels = scope.querySelectorAll('[data-tab-panel]');
    panels.forEach(function (p) {
      const isActive = p.getAttribute('data-tab-panel') === tabId;
      p.classList.toggle('active', isActive);
      p.classList.toggle('is-active', isActive);
      p.hidden = !isActive;
    });
  }

  function bind(container) {
    if (!container) return;
    container.setAttribute('role', 'tablist');
    const buttons = container.querySelectorAll('[data-tab]');
    buttons.forEach(function (b) {
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function (e) {
        e.preventDefault();
        activate(container, b.getAttribute('data-tab'));
      });
      // Klavye navigasyonu
      b.addEventListener('keydown', function (e) {
        const list = Array.prototype.slice.call(buttons);
        const i = list.indexOf(b);
        if (i < 0) return;
        let target = null;
        if (e.key === 'ArrowRight') target = list[(i + 1) % list.length];
        else if (e.key === 'ArrowLeft') target = list[(i - 1 + list.length) % list.length];
        else if (e.key === 'Home') target = list[0];
        else if (e.key === 'End')  target = list[list.length - 1];
        if (target) {
          e.preventDefault();
          target.focus();
          activate(container, target.getAttribute('data-tab'));
        }
      });
    });
    // İlk açılışta aktif olanı uyumla
    const active = container.querySelector('[data-tab].active, [data-tab].is-active');
    if (active) activate(container, active.getAttribute('data-tab'));
  }

  function autoBind() {
    document.querySelectorAll('[data-tabs]').forEach(bind);
  }

  Tabs.activate = activate;
  Tabs.bind = bind;
  Tabs.autoBind = autoBind;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBind);
  } else {
    autoBind();
  }

  window.FleetlyTabs = Tabs;
})();
