/* ===================================================================
   pagination.js — Fleetly pagination helper (Aşama 2)

   Mevcut #pagination-bar render mantığı app-chunk-02.js içindeki
   renderTable() fonksiyonunda inline. Bu helper YENİ tablolar için
   temiz API sağlar; eski mantık olduğu gibi çalışır.

   API:
   FleetlyPagination.render(containerId, opts)
     opts: {
       currentPage: 1,
       totalPages:  10,
       onSelect:    (page) => void,
       maxVisible:  7    // Görünen sayfa numarası adedi (default 7)
     }
   =================================================================== */
(function () {
  const P = {};

  function pageButton(label, page, opts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText =
      'min-width:32px;height:32px;padding:0 10px;' +
      'background:var(--bg-elev);border:1px solid var(--border);color:var(--text);' +
      'border-radius:var(--r-md);font-family:var(--font-body);font-size:12.5px;font-weight:600;' +
      'cursor:pointer;transition:background .15s,border-color .15s,color .15s;' +
      'display:inline-flex;align-items:center;justify-content:center;';
    if (opts && opts.active) {
      btn.style.background = 'var(--accent-500)';
      btn.style.borderColor = 'var(--accent-500)';
      btn.style.color = '#fff';
      btn.setAttribute('aria-current', 'page');
    }
    if (opts && opts.disabled) {
      btn.disabled = true;
      btn.style.opacity = '.4';
      btn.style.cursor = 'not-allowed';
    }
    if (opts && opts.onClick && !opts.disabled) {
      btn.addEventListener('click', opts.onClick);
    }
    return btn;
  }

  function ellipsis() {
    const span = document.createElement('span');
    span.textContent = '…';
    span.style.cssText = 'padding:0 4px;color:var(--text-subtle);font-family:var(--font-mono);';
    return span;
  }

  function visiblePages(current, total, maxVisible) {
    const max = maxVisible || 7;
    if (total <= max) {
      const out = [];
      for (let i = 1; i <= total; i++) out.push(i);
      return out;
    }
    const half = Math.floor(max / 2);
    let start = Math.max(1, current - half);
    let end   = Math.min(total, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    const out = [];
    if (start > 1) {
      out.push(1);
      if (start > 2) out.push('…');
    }
    for (let i = start; i <= end; i++) out.push(i);
    if (end < total) {
      if (end < total - 1) out.push('…');
      out.push(total);
    }
    return out;
  }

  P.render = function (containerOrId, opts) {
    const c = (typeof containerOrId === 'string')
      ? document.getElementById(containerOrId)
      : containerOrId;
    if (!c) return;
    opts = opts || {};
    const cur = opts.currentPage || 1;
    const total = opts.totalPages || 1;
    const onSelect = opts.onSelect || function () {};

    c.innerHTML = '';
    if (total <= 1) return;

    // İlk / önceki
    c.appendChild(pageButton('‹', cur - 1, {
      disabled: cur === 1,
      onClick: function () { onSelect(cur - 1); }
    }));

    visiblePages(cur, total, opts.maxVisible).forEach(function (p) {
      if (p === '…') { c.appendChild(ellipsis()); return; }
      c.appendChild(pageButton(String(p), p, {
        active: p === cur,
        onClick: function () { onSelect(p); }
      }));
    });

    // Sonraki / son
    c.appendChild(pageButton('›', cur + 1, {
      disabled: cur === total,
      onClick: function () { onSelect(cur + 1); }
    }));
  };

  window.FleetlyPagination = P;
})();
