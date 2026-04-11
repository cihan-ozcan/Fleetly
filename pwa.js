  (function() {
    var DISMISSED_KEY = 'fleetly_pwa_dismissed';
    var deferredPrompt = null;
    var ua = navigator.userAgent;
    var isIOS = /iphone|ipad|ipod/i.test(ua);
    var isAndroid = /android/i.test(ua);
    var isMobile = isIOS || isAndroid;
    var isInStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || window.navigator.standalone === true;

    var banner     = document.getElementById('pwa-banner');
    var subText    = document.getElementById('pwa-banner-sub');
    var installBtn = document.getElementById('pwa-install-btn');

    function showBanner() {
      if (!banner || isInStandalone) return;
      if (localStorage.getItem(DISMISSED_KEY)) return;
      banner.classList.add('visible');
    }

    /* ── Android: Chrome beforeinstallprompt ── */
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredPrompt = e;
      if (subText) subText.textContent = 'Tek tikla uygulama olarak kurun';
      if (installBtn) installBtn.textContent = 'Yukle';
      setTimeout(showBanner, 1500);
    });

    /* ── iOS Safari — event yok, elle goster ── */
    if (isIOS && !isInStandalone) {
      if (installBtn) installBtn.textContent = 'Nasil Kurulur?';
      if (subText) subText.textContent = "Safari Ana Ekrana ekle ile kullanin";
      setTimeout(showBanner, 1500);
    }

    /* ── Android fallback: 4sn sonra hala prompt gelmediyse ── */
    if (isAndroid && !isInStandalone) {
      setTimeout(function() {
        if (!deferredPrompt && !localStorage.getItem(DISMISSED_KEY)) {
          if (installBtn) installBtn.textContent = 'Nasil Kurulur?';
          if (subText) subText.textContent = 'Chrome menusu ile ana ekrana ekleyebilirsiniz';
          showBanner();
        }
      }, 4000);
    }

    /* ── Masaustu: artik buton gosterilmiyor ── */
    if (!isMobile) {
      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        // masaustunde hicbir sey gosterme
      });
    }

    /* ── Mobil: ayarlar menusundeki butonu goster ── */
    function maybeShowSettingsPwaItem() {
      if (!isMobile || isInStandalone) return;
      var item = document.getElementById('settings-pwa-item');
      var sep  = document.getElementById('settings-pwa-sep');
      if (item) item.style.display = '';
      if (sep)  sep.style.display  = '';
    }
    // DOM hazir oldugunda calistir
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', maybeShowSettingsPwaItem);
    } else {
      maybeShowSettingsPwaItem();
    }

    window.pwaInstall = function() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(r) {
          if (r.outcome === 'accepted') pwaDismiss();
          deferredPrompt = null;
        });
        return;
      }
      var popup = document.getElementById('pwa-ios-popup');
      if (!popup) return;
      var title = popup.querySelector('.ios-popup-title');
      var steps = popup.querySelectorAll('.ios-popup-step span');
      if (isAndroid) {
        if (title) title.textContent = 'Ana Ekrana Ekle — Android';
        if (steps[0]) steps[0].innerHTML = 'Chrome sag ust <strong style="color:var(--accent)">3 nokta menusu</strong>ne basin';
        if (steps[1]) steps[1].innerHTML = '<strong style="color:var(--accent)">Ana ekrana ekle</strong> secenegini secin';
        if (steps[2]) steps[2].innerHTML = '<strong style="color:var(--accent)">Ekle</strong>\'ye basin, hazir!';
      } else if (isIOS) {
        if (title) title.textContent = 'Ana Ekrana Ekle — iPhone';
        if (steps[0]) steps[0].innerHTML = 'Alttaki <strong style="color:var(--accent)">Paylasim</strong> butonuna basin';
        if (steps[1]) steps[1].innerHTML = '<strong style="color:var(--accent)">Ana Ekrana Ekle</strong> secenegini secin';
        if (steps[2]) steps[2].innerHTML = 'Sag ustten <strong style="color:var(--accent)">Ekle</strong>\'ye basin';
      } else {
        if (title) title.textContent = 'Mobil Uygulama Olarak Kullanin';
        if (steps[0]) steps[0].innerHTML = '<strong style="color:var(--accent)">Android:</strong> Chrome menusu ile Ana Ekrana Ekle';
        if (steps[1]) steps[1].innerHTML = '<strong style="color:var(--accent)">iPhone:</strong> Safari Paylas → Ana Ekrana Ekle';
        if (steps[2]) steps[2].innerHTML = 'Uygulama gibi tam ekran acilir';
      }
      popup.classList.add('show');
    };

    window.pwaDismiss = function() {
      if (banner) banner.classList.remove('visible');
      localStorage.setItem(DISMISSED_KEY, '1');
    };

    window.pwaShowInfo = function() {
      window.pwaInstall();
    };

    window.addEventListener('appinstalled', pwaDismiss);
  })();
