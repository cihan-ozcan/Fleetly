# Fleetly — Refactor Geçiş Kaydı

Bu belge, **Phase 1 – 5** refactor'ında yapılan her değişikliğin özetini içerir. Davranış ve görünüm korunmuştur.

## Özet

| Ölçüm | Önceki | Sonraki | Fark |
|---|---:|---:|---:|
| `app.html` satır sayısı | 18.777 | 3.316 | **−15.461 (%82 azalma)** |
| `app.html` boyutu | 1.4 MB | ~190 KB | **−1.2 MB** |
| Inline `<style>` (tüm sayfalar) | 6 blok, ~200 KB | **0** | tamamı dış dosyada |
| `app.html` inline `<script>` | 6 blok, ~550 KB | **0** | tamamı `js/pages/` içinde |
| Diğer sayfalarda inline `<style>` | var (5 sayfa) | **0** | her biri kendi `css/pages/*.css`'ine taşındı |
| Base64 görseller (`app.html`) | 4 URI | **0** | `assets/img/` altında dosya |
| Service worker cache | `fleetly-v3` | `fleetly-v4` | yeni dosyaları da önbellekler |

## Phase 1 — app.html CSS ayrımı

**Yedek:** `_backup_pre_refactor/app.html` orijinali korundu.

1. `app.html`'in `<head>` kısmındaki büyük `<style>` bloğu (106 KB, 441 selector) şu dosyalara bölündü:
   - **`css/tokens.css`** (~1.2 KB) — `@import` Google Fonts + `:root` CSS custom properties.
   - **`css/reset.css`** (~1.4 KB, yeni) — `*` box-sizing, `body` defaults, `.sr-only`, `prefers-reduced-motion`.
   - **`css/pages/app.css`** (~106 KB) — geri kalan tüm kurallar, birebir sıralama korunarak.
2. `app.html`'in gövdesinin derinlerinde (line ~14.150) bulunan ikinci `<style>` bloğu (`#sofor-app` portalı için) `css/pages/sofor-embedded.css`'e taşındı. Bu blok bir HTML comment işaretiyle değiştirildi; `<head>`'deki `<link>` zinciri artık bu dosyayı da yüklüyor.
3. `<style>` blokları `<link rel="stylesheet">` zinciriyle değiştirildi:
   ```html
   <link rel="stylesheet" href="css/tokens.css" />
   <link rel="stylesheet" href="css/reset.css" />
   <link rel="stylesheet" href="css/pages/app.css" />
   <link rel="stylesheet" href="css/pages/sofor-embedded.css" />
   ```
4. Cascade sırası aynen korundu; tokens → reset → sayfa özel.

## Phase 2 — Ortak bileşenler ve `<fleetly-include>`

1. **`js/core/include.js`** yazıldı. `<fleetly-include src="...">` custom element'i tanımlar; fetch ile HTML dosyasını çeker, elementin yerine basar, `<script>` tag'lerini yeniden üreterek çalıştırır ve tüm include'lar bittiğinde `fleetly:includes-ready` event'i dispatch eder.
2. `components/` klasörü oluşturuldu. Canonical kaynak dosyalar:
   - `brand.html` — Fleetly logo SVG (daha önce index + register'da duplike idi).
   - `app-header.html` — app.html'in üst header'ı + mobil menü (orijinal yerinde duruyor, bu dosya canonical kaynak).
   - `footer.html` — ortak footer, yıl JS ile.
   - `loading-state.html` — ortak spinner (3 sayfada kopya vardı).
   - `error-state.html` — ortak hata görünümü.
   - `modal-base.html` — modal shell şablonu (gelecekteki 14 modal'ın ortak iskeleti).
   - `toast-container.html` — `aria-live="polite"` toast kabı.
   - `README.md` — kullanım notları.

> **Neden app.html içindeki blokları include ile değiştirmedim?** Oradaki inline `<script>` blokları DOM elemanlarına doğrudan erişiyor (ör. `document.getElementById('settings-dropdown')`). Async include ile DOM tam hazır olmadan bu çağrılar null döner. Include mekanizması **Phase 4 sonrası JS modüler hale gelince** güvenle devreye alınabilir. Şu an için `components/app-header.html`, bir kod kokusu olarak değil, gelecekteki single-source-of-truth olarak konumlandı.

## Phase 3 — Diğer sayfaları sadeleştir

Her biri için:

| Sayfa | Satır önce | Satır sonra | Taşınan CSS |
|---|---:|---:|---|
| `index.html` | 1.890 | **648** | `css/pages/landing.css` (30 KB) |
| `register.html` | 1.109 | **430** | `css/pages/register.css` (17 KB) |
| `musteri_takip.html` | 1.364 | **1.060** | `css/pages/musteri-takip.css` (19 KB) |
| `portal.html` | 876 | **648** | `css/pages/portal.css` (12 KB) |
| `sofor.html` | 889 | **652** | `css/pages/sofor.css` (19 KB) |

- Her sayfadaki `<style>` bloğu olduğu gibi dış dosyaya taşındı; selectors ve değerler birebir korundu.
- Her sayfanın `<head>`'ine `<script src="js/core/include.js" defer>` eklendi.
- Duplicate `:root` token'larının unifikasyonu **bilinçli olarak** ertelendi: sayfalar arası değerler (örn. `--surface`) tam aynı değildi; mekanik birleştirme görsel kaymaya yol açardı.

## Phase 4 — app.html inline script'lerini taşı

`app.html` içindeki 6 inline `<script>` bloğu, sıra korunarak dış dosyalara taşındı:

| Dosya | Satır (original konum) | Boyut |
|---|---:|---:|
| `js/pages/app-chunk-01.js` | ilk inline | 2 KB |
| `js/pages/app-chunk-02.js` | ana script | **389 KB** (8.727 satır) |
| `js/pages/app-chunk-03.js` | 3. inline | 5 KB |
| `js/pages/app-chunk-04.js` | 4. inline | <1 KB |
| `js/pages/app-chunk-05.js` | 5. inline | 113 KB |
| `js/pages/app-chunk-06.js` | son inline | 50 KB |

- Her chunk'ın başına iz sürülebilirlik için comment başlığı eklendi.
- Global değişkenler, fonksiyon isimleri, execution order **aynen** korundu.
- `app.html` body'sindeki bloklar yerine `<script src="...">` tag'leri bırakıldı.
- **Ek:** `app.html`'deki 4 adet base64 görsel dışarı çıkarıldı:
  - `assets/img/favicon.png` (~112 KB) — her iki `<link rel="icon">` referansı buna işaret ediyor.
  - `assets/img/logo.png` (~98 KB) — header'daki küçük logo.
  - `assets/img/logo2.png` (~112 KB) — diğer konumdaki logo.

## Phase 5 — Erişilebilirlik ve performans

1. **Service worker bump:** `fleetly-v3` → `fleetly-v4`. `APP_SHELL`'e tüm yeni CSS/JS dosyaları ve resimler eklendi; eski cache otomatik temizlenir.
2. **ARIA eklemeleri (`app.html`):**
   - `#mob-menu-btn` → `aria-expanded="false"` + `aria-controls="mob-menu"`
   - `#settings-btn` → `aria-haspopup="true"` + `aria-expanded="false"` + `aria-controls="settings-dropdown"`
   - 13 adet `.modal-close` → `aria-label="Kapat"`
   - `#mob-menu` → `role="menu"` + `aria-hidden="true"`
3. **Reset.css ile `prefers-reduced-motion`** desteği (animasyonlar istenmediği zaman devre dışı).

## Riskler ve Koruma Önlemleri

- **Cascade sırası riski:** `<style>` bloklarını dış dosyalara mekanik taşıdık. Orijinal `<style>` konumları `<link>` ile aynı sırada tutuldu; başka stil dosyası araya sokulmadı.
- **Execution order riski:** 6 inline `<script>` bloğu external oldu ama sıra korundu. `defer`/`async` eklenmedi — senkron yükleme devam ediyor (refactor amacı global'leri taşımaktı, timing'i değil).
- **PWA cache riski:** Service worker `CACHE_NAME` bump edildi → eski kullanıcılar yeni sürümü yeniden alır.
- **Yedek:** `_backup_pre_refactor/` altında orijinal HTML + SW tutuldu. Sorun olursa geri dönüş kolay.

## Test Önerisi (manuel smoke)

1. `python3 -m http.server 5173` ile sun.
2. Chrome DevTools → Application → Service Workers → "Update on reload" açık.
3. Sırayla dolaş:
   - **index.html** — landing, CTA'lar, scroll
   - **register.html** — form çalışıyor mu, Supabase hata vermiyor mu
   - **app.html** — giriş, dashboard, araç ekle modalı, yakıt modalı, bakım modalı, sefer, teklif, rapor PDF, mobil hamburger, ayarlar dropdown
   - **portal.html** — örnek portal linki
   - **musteri_takip.html** — örnek POD linki
   - **sofor.html** — örnek iş emri linki
4. Network sekmesi → CSS dosyaları 200 dönüyor, sıralama doğru.
5. Console temiz (referans hata yok).
6. Lighthouse: Accessibility ve Best Practices skorlarını baseline olarak kaydet.

## Sonraki Fazlar İçin Yapılacaklar Listesi

- [ ] `app.html`'deki 14 modal'ı `<fleetly-include src="components/modal-base.html">` ile ortak şablona bağla (JS modülerleşmesinden sonra).
- [ ] `js/core/store.js` + `event-bus.js` + `supabase-client.js` oluştur.
- [ ] `js/features/{vehicles,fuel,maintenance,drivers,trips,quotes,expenses,reports,crm,operations,dashboard,subscription}.js`'e `app-chunk-02.js`'i böl.
- [ ] Inline `onclick` handler'larını `data-action` + event delegation'a çevir (412 nokta).
- [ ] Inline `style=""` değerlerini (989 nokta) CSS sınıflarına veya custom property'lere çıkar.
- [ ] Tailwind CDN'i kaldır veya PurgeCSS build'i ekle.
- [ ] Lazy import: Chart.js / Leaflet / jsPDF sadece tetiklendiklerinde yüklensin.
- [ ] `:root` token'larını tüm sayfalarda tokens.css'e birleştir (değer farklılıklarını uzlaştırarak).
- [ ] Tüm modal'lara focus trap + ESC yakalama (merkezi `js/ui/modal.js`).
- [ ] Lighthouse Accessibility ≥ 95; axe-core ile tarama.
