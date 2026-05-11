/* =============================================================================
 * cms-loader.js — Statik HTML sayfaları için runtime CMS içerik yükleyici
 *
 * Bir sayfada `<article data-cms-kod="kvkk">` ya da herhangi bir elemente
 * `data-cms-kod` attribute'ü konulursa, sayfa yüklendiğinde Supabase'den
 * (anon erişim) o koda ait içerik çekilir ve elementin içine yazılır.
 *
 * DB'de içerik boşsa veya hata olursa mevcut HTML (fallback) korunur.
 *
 * Kullanım:
 *   <article class="doc-card" data-cms-kod="kvkk">
 *     <!-- Fallback içerik buraya -->
 *     <h1>KVKK Aydınlatma Metni</h1>
 *     ...
 *   </article>
 *
 * Şu özellikler de uygulanır:
 *   • Sayfa <title> güncellenmez (SEO için sabit kalır)
 *   • Son güncelleme bilgisi varsa `[data-cms-son-guncelleme]` elementine yazılır
 *   • Yükleme sırasında elemente `cms-loading` class'ı eklenir
 * ===========================================================================*/

(function () {
  'use strict';

  const CFG = window.FILO_CONFIG || {};
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON) return;

  async function fetchIcerik(kod) {
    try {
      const res = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/icerik_getir', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':        CFG.SUPABASE_ANON,
          'Authorization': 'Bearer ' + CFG.SUPABASE_ANON,
        },
        body: JSON.stringify({ p_kod: kod }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.kod ? data : null;
    } catch {
      return null;
    }
  }

  async function loadOne(el) {
    const kod = el.getAttribute('data-cms-kod');
    if (!kod) return;
    el.classList.add('cms-loading');
    const data = await fetchIcerik(kod);
    el.classList.remove('cms-loading');
    if (!data || !data.icerik_html || data.icerik_html.trim().length < 20) {
      // İçerik boş ya da çok kısa → fallback HTML kalır
      return;
    }
    // Replace
    el.innerHTML = data.icerik_html;

    // Son güncelleme info
    document.querySelectorAll('[data-cms-son-guncelleme="' + kod + '"]').forEach(t => {
      if (!data.son_guncelleme) return;
      const d = new Date(data.son_guncelleme);
      t.textContent = d.toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' });
    });

    // Başlık update (opsiyonel)
    document.querySelectorAll('[data-cms-baslik="' + kod + '"]').forEach(t => {
      t.textContent = data.baslik;
    });
  }

  function init() {
    const els = document.querySelectorAll('[data-cms-kod]');
    els.forEach(loadOne);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
