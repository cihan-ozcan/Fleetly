# components/

Fleetly projesinde sayfalar arasında tekrar eden HTML parçalarının **canonical (tek doğru) kaynağı** bu klasördür.

## Nasıl include edilir?

Bir sayfanın `<head>` bölümüne include scripti eklenir:

```html
<script src="js/core/include.js" defer></script>
```

Ardından istenilen yere:

```html
<fleetly-include src="components/brand.html"></fleetly-include>
```

Fetch ile component HTML dosyası yüklenir ve `<fleetly-include>` elementinin yerine basılır.

## Dev sunucusu gerekir

Tarayıcıda `file://` açılırsa `fetch` CORS nedeniyle çalışmaz. Şunlardan birini kullanın:

```bash
python3 -m http.server 5173
# veya
npx serve .
```

## Liste

| Dosya | İçerik |
|---|---|
| `brand.html` | Logo SVG (index & register sayfalarındaki brand) |
| `app-header.html` | app.html için üst header + mobil menü (canonical kaynak; app.html şu an inline kullanıyor) |
| `footer.html` | Ortak footer (yıl otomatik) |
| `modal-base.html` | Modal shell şablonu (Phase 4+ için referans) |
| `toast-container.html` | Tek merkezi toast kabı |
| `loading-state.html` | Ortak yükleniyor spinner'ı |
| `error-state.html` | Ortak hata durumu görünümü |

## Migrasyon notu

`app.html`'in kendi inline `<header>` ve modal blokları DEĞİŞTİRİLMEDİ — oradaki inline script'lerin DOM timing'ini bozmamak için. `components/app-header.html` o bloğun canonical kaynağıdır; ileride (Phase 4 sonrası) JS modüler hale geldiğinde `<fleetly-include>` ile değiştirilebilir.
