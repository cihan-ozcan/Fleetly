# Fleetly — Mimari Dokümantasyonu

Bu belge, Fleetly kod tabanının refactor sonrası hedeflenen mimarisini ve mevcut durumunu özetler. **Phase 1 – 5 refactor'ından sonra** yazılmıştır.

## 1. Genel Bakış

Fleetly, lojistik firmaları için araç filosu, yakıt, bakım, sefer ve müşteri yönetimini tek çatı altında toplayan bir PWA'dır. Vanilla **HTML / CSS / JavaScript** ile yazılmıştır. Bir framework'e bağımlılık yoktur; Supabase backend olarak kullanılır.

## 2. Sayfa Yapısı

| Sayfa | Rol |
|---|---|
| `index.html` | Tanıtım / landing |
| `register.html` | Kayıt ve Supabase auth |
| `app.html` | Ana uygulama — dashboard, tüm modüller |
| `portal.html` | Dış müşteri için portal görünümü |
| `musteri_takip.html` | Sevkiyat POD takip sayfası |
| `sofor.html` | Şoför iş emri ekranı |

## 3. Klasör Yapısı

```
.
├── *.html                 ← sayfa iskeletleri (JS + CSS artık dışarıda)
├── config.js              ← Supabase env
├── config.example.js
├── manifest.json
├── service-worker.js      ← PWA cache (v4)
├── CNAME, README.md
│
├── components/            ← yeniden kullanılacak HTML parçacıkları (<fleetly-include src="">)
│   ├── app-header.html    ← app.html için canonical header
│   ├── brand.html         ← logo SVG
│   ├── footer.html
│   ├── loading-state.html
│   ├── error-state.html
│   ├── modal-base.html
│   ├── toast-container.html
│   └── README.md
│
├── css/
│   ├── tokens.css         ← :root CSS variables (renk, typography, radius)
│   ├── reset.css          ← minimal normalize
│   └── pages/
│       ├── app.css                ← app.html stilleri
│       ├── sofor-embedded.css     ← app.html içine gömülü sofor modülü stilleri
│       ├── landing.css            ← index.html
│       ├── register.css
│       ├── portal.css
│       ├── musteri-takip.css
│       └── sofor.css
│
├── js/
│   ├── core/
│   │   └── include.js     ← <fleetly-include src="..."> custom element
│   ├── pages/
│   │   ├── app-chunk-01.js  …  app-chunk-06.js   ← app.html'den taşınan inline script'ler
│
├── assets/
│   └── img/
│       ├── favicon.png
│       ├── logo.png
│       └── logo2.png
│
└── docs/
    ├── ARCHITECTURE.md    ← bu dosya
    └── MIGRATION-LOG.md   ← refactor sırasında yapılan değişikliklerin kaydı
```

## 4. Yüklenme Sırası

Her sayfanın `<head>` bölümü aşağıdaki ortak sırayı korur:

1. **Meta etiketleri** (charset, viewport, theme-color, title, PWA manifest referansı)
2. **Fontlar** (Google Fonts preconnect + stylesheet)
3. **Üçüncü parti CSS** (Leaflet, vs. — sadece gereken sayfalarda)
4. **Fleetly CSS zinciri** — `tokens.css` → `reset.css` → sayfa özel CSS
5. **Üçüncü parti JS** (Tailwind CDN, Chart.js, Leaflet, Supabase UMD) — sadece gereken sayfalarda
6. **`config.js`** — Supabase env
7. **`js/core/include.js`** — `<fleetly-include>` desteği (defer)

Cascade ve execution order korunmuştur; refactor görsel veya davranışsal regresyon üretmez.

## 5. Bileşen Stratejisi (components/)

Tekrarlanan HTML parçaları `components/` altında canonical olarak tutulur. Bir sayfaya dahil etmek için:

```html
<script src="js/core/include.js" defer></script>
...
<fleetly-include src="components/brand.html"></fleetly-include>
```

Çalışma zamanında `fetch()` ile yüklenip `<fleetly-include>` elementinin yerine basılır. Tüm include'lar bittiğinde `document` üzerinde `fleetly:includes-ready` custom event'i tetiklenir.

> **Not:** `file://` protokolünde `fetch()` çalışmaz. Lokal geliştirme için `python3 -m http.server 5173` gibi bir sunucu kullanın.

## 6. CSS Mimarisi

**tokens.css** tek doğru değer kaynağıdır; tüm renk, radius, font token'ları `:root` altında CSS Custom Properties olarak tanımlıdır.

**reset.css** tarayıcı farklılıklarını sıfırlar, `prefers-reduced-motion` desteği ekler ve `.sr-only` helper'ı sunar.

**css/pages/\*.css** her sayfaya özel stilleri içerir. Sayfalar arasındaki duplicate stil birleştirme işi **Phase 5+ (gelecek faz)** olarak planlanmıştır; ilk refactor'da cascade riskini önlemek için her sayfa kendi stil dosyasına mekanik taşındı.

## 7. JavaScript Mimarisi

`app.html` içindeki 6 inline `<script>` bloğu, sıra ve davranış korunarak `js/pages/app-chunk-NN.js` dosyalarına taşındı. İçerikte **hiçbir değişiklik yapılmadı**; global değişkenler aynı, fonksiyon tanımları aynı.

**Gelecek modernizasyon (sonraki faz):**

- `js/core/` altında `store.js`, `event-bus.js`, `supabase-client.js`, `dom.js` gibi çekirdek yardımcılar
- `js/features/` altında domain modülleri (`vehicles.js`, `fuel.js`, `maintenance.js`, …)
- `js/ui/` altında `modal.js`, `toast.js`, `tabs.js`, `drawer.js` — tüm modalları ve tab sistemlerini tek yerden yöneten generic controller'lar
- `js/integrations/` altında `pdf.js`, `chart.js`, `map.js` — lazy import ile ilk yüklemeyi hızlandırma
- Inline `onclick` handler'larını `data-action` + event delegation'a çevirme

## 8. PWA ve Service Worker

`service-worker.js` (CACHE_NAME `fleetly-v4`) yeni CSS/JS yollarını **APP_SHELL**'e ekler. Strateji:

- HTML istekleri → **Network-First** (yeni sürüm hemen yansısın)
- CSS/JS/resimler → **Cache-First** (ağ yoksa cache'den)
- Supabase API → daima ağdan (canlı veri)
- CDN kaynakları → ayrı cache (`fleetly-cdn-v4`)

## 9. Erişilebilirlik (a11y)

Phase 5'te düşük riskli ARIA eklendi:

- Mobil hamburger butonu → `aria-expanded` + `aria-controls`
- Ayarlar butonu → `aria-haspopup` + `aria-expanded` + `aria-controls`
- 13 adet modal close butonu → `aria-label="Kapat"`
- `#mob-menu` → `role="menu"` + `aria-hidden="true"`

**Gelecek faz** için bekleyenler: odak yönetimi (focus trap), `<div onclick>`'lerin `<button>`'a dönüştürülmesi, ekran okuyucu etiketlemeleri, kontrast testi (WCAG AA).

## 10. Bilinen Sınırlar

- `app.html` içindeki `<header>` ve modal blokları hâlâ inline; bunlar canonical olarak `components/app-header.html` içinde de tutuluyor ama `<fleetly-include>`'a geçiş **JS modülerleşmesinden sonra** yapılmalı (DOM timing'i).
- 412 adet inline `onclick` ve 989 adet inline `style` hâlâ duruyor; bunlar Phase 4/5'in ileri adımı.
- Tailwind CDN hâlâ yüklü (el yazması CSS'le paralel). Purge & build adımı ile tek tasarım sistemine indirilebilir.
