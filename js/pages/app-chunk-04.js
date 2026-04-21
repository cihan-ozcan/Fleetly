/* ===================================================================
   app-chunk-04.js — app.html içinden otomatik taşındı (Phase 4, mekanik)
   Orijinal konum: 11. <script> tag'i (app.html).
   İçerik AYNEN korunur; global değişkenler, fonksiyon isimleri,
   yükleme sırası değiştirilmedi. İleride modülerleştirilecek.
   ================================================================= */

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/onerfilotakip/service-worker.js')
          .then(reg => console.log('SW kayıtlı:', reg.scope))
          .catch(err => console.warn('SW hatası:', err));
      });
    }
  