/* ===================================================================
   app-chunk-04.js — /app/ içinden otomatik taşındı (Phase 4, mekanik)
   Orijinal konum: 11. <script> tag'i (/app/).
   İçerik AYNEN korunur; global değişkenler, fonksiyon isimleri,
   yükleme sırası değiştirilmedi. İleride modülerleştirilecek.
   ================================================================= */

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        // Eski deploy artığı broken SW'leri temizle — /onerfilotakip/ alt-path'te
        // kayıtlı olanlar 404 veriyor ama hala fetch intercept ediyor olabilir.
        // Bu intercept "CORS request did not succeed (status=null)" hatasına yol açar.
        navigator.serviceWorker.getRegistrations().then(regs => {
          regs.forEach(r => {
            const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
            if (url.includes('/onerfilotakip/')) {
              r.unregister().then(() => console.log('[SW] Eski broken SW kaldırıldı:', url));
            }
          });
        }).catch(() => {});
        // Doğru path — service-worker.js projenin kökünde
        navigator.serviceWorker.register('/service-worker.js')
          .then(reg => console.log('[SW] kayıtlı:', reg.scope))
          .catch(err => console.warn('[SW] hatası:', err));
      });
    }
  