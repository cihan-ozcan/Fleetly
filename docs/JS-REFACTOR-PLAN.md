# Fleetly — JS Modülerleştirme Planı

> Faz 5'in son bileşeni. `app-chunk-NN.js` parçaları **olduğu gibi korunarak**
> üst katmana modüler bir altyapı eklendi. Gerçek kod taşıma sonraki turlarda
> yapılacak — bu döküman hedef yapıyı ve aşamalı geçiş yolunu açıklar.

## Mevcut Durum (2026-05)

```
js/
├── core/
│   ├── include.js              ← <fleetly-include> custom element
│   ├── push-notify.js          ← PWA push
│   ├── event-bus.js  (yeni)    ← FleetlyBus.on/once/off/emit
│   ├── dom.js        (yeni)    ← FleetlyDom.qs/qsa/on/ready/...
│   ├── store.js      (yeni)    ← FleetlyStore.snapshot/get/onReady/poll
│   ├── theme.js      (yeni)    ← Tema toggle + persist + OS pref
│   └── app-shell.js  (yeni)    ← Sidebar collapse + mobile drawer
├── ui/
│   └── dashboard-components.js ← Icon/Sparkline/CountUp/Chart/Map + populators
└── pages/                      ← MEVCUT — DEĞİŞMEDİ
    ├── app-chunk-01.js  (kısa boot)
    ├── app-chunk-02.js  (9544 satır — büyük veri/CRUD/UI)
    ├── app-chunk-03..06.js
    ├── app-chunk-kpi-rapor.js
    ├── app-chunk-pod.js
    └── app-chunk-surucu-takip.js
```

## Hedef Klasör Yapısı

```
js/
├── core/                       ← çekirdek altyapı
│   ├── event-bus.js  ✓
│   ├── dom.js        ✓
│   ├── store.js      ✓
│   ├── theme.js      ✓
│   ├── app-shell.js  ✓
│   ├── supabase-client.js  ⏳   ← config.js + supabase init
│   └── include.js    ✓
│
├── ui/                         ← reusable UI bileşenleri
│   ├── components.js (rename'lenebilir; şu an dashboard-components.js)
│   ├── modal.js      ⏳         ← generic modal controller (open/close/back/esc)
│   ├── toast.js      ⏳         ← toast() factory
│   ├── tabs.js       ⏳         ← .srm-tab / #crm tab-bar / .vs-tab generic
│   ├── drawer.js     ⏳         ← CRM drawer + sürücü takip drawer
│   └── pagination.js ⏳         ← #pagination-bar render
│
├── features/                   ← domain modülleri (her biri 200-800 satır)
│   ├── vehicles.js   ⏳         ← araç tablosu, mob-card-list, filo özet
│   ├── drivers.js    ⏳         ← sürücü modal, belgeler, takip
│   ├── maintenance.js⏳         ← bakım modal, plan card, history
│   ├── fuel.js       ⏳         ← yakıt modal, vehicle-select-modal
│   ├── trips.js      ⏳         ← sefer modal (SRM), tabs
│   ├── teklifler.js  ⏳
│   ├── masraflar.js  ⏳
│   ├── crm.js        ⏳         ← #crm-page tüm yapısı
│   ├── operasyon.js  ⏳         ← #operasyon-page kanban
│   ├── reports.js    ⏳         ← rapor modal + export
│   ├── pwa.js        ⏳         ← #pwa-banner + ios-popup
│   ├── auth.js       ⏳         ← login + subscription overlay
│   └── activity.js   ⏳         ← #activity-list log
│
└── integrations/               ← lazy 3rd-party
    ├── pdf.js        ⏳         ← jspdf + html2canvas wrapping
    ├── chart.js      ⏳         ← Chart.js helpers
    ├── leaflet.js    ⏳         ← Leaflet helpers + marker factory
    ├── xlsx.js       ⏳         ← XLSX import/export
    └── qr.js         ⏳         ← qrcode wrapping
```

## Aşamalı Geçiş Planı

### Aşama 1 (TAMAMLANDI ✓) — Çekirdek altyapı
- `event-bus.js`, `dom.js`, `store.js`, `theme.js`, `app-shell.js`
- `app-chunk-02.js` sonuna **bridge expose** eklendi (`window._fleetly.snapshot`)
- Mevcut JS'e dokunmadan modüler ekleme

### Aşama 2 — Generic UI controller'ları (1-2 commit)
Mevcut modal/toast/tab davranışlarını generic hale getir; mevcut sayfada
yeni kontrollere `data-modal="fuel"` gibi attribute eklenip eski JS'in
inline çağrıları kademeli azaltılabilir.

- `js/ui/modal.js`: `Modal.open(id) / .close(id) / closeOnBackdrop()`
- `js/ui/toast.js`: `Toast.success(msg) / .error(msg) / .info(msg)`
- `js/ui/tabs.js`: `Tabs.init('.srm-tabs') → .activate('seferler')`

Mevcut JS'in çağırdığı `openFuelSummary()` vs. fonksiyonlar **aynı kalır**
(geri uyumluluk); içeride yeni controller'a delege ederler.

### Aşama 3 — Domain feature'larını ayır (4-6 commit)
`app-chunk-02.js`'i parçalara böl. Her özellik için yeni modül oluştur,
mevcut fonksiyonları taşı:

```
app-chunk-02.js (9544 satır)
        ↓
  ┌─────┴─────┬─────┬─────┬─────┐
  vehicles  drivers maint fuel  trips  ...
```

Geri uyumluluk için: taşınan her fonksiyonun **eski global ismi** korunur
(`window.openFuelSummary = Fuel.openSummary`). Inline `onclick="..."`
çağrıları olduğu gibi çalışmaya devam eder.

### Aşama 4 — `data-action` ile inline `onclick` temizliği
HTML'deki 412 inline `onclick` yerine event delegation:

```html
<!-- Önce: -->
<button onclick="openFuelSummary()">Yakıt</button>
<!-- Sonra: -->
<button data-action="fuel:open">Yakıt</button>
```

Tek bir `js/core/actions.js` event delegation ile `data-action` çözümler.
Bu adım büyük HTML rewrite gerektirir; en sona bırakılır.

### Aşama 5 — Lazy loading (entegrasyonlar)
Chart.js, jsPDF, XLSX, Leaflet — sadece açılan sayfa/modal kullanırsa
dinamik `import()` ya da script tag injection. İlk sayfa yükü ~3-4MB'tan
~600KB'a iner.

## Geriye Uyumluluk Kuralları

1. **Asla** mevcut global fonksiyonu (örn. `openFuelSummary`) silme — sadece
   içeriğini delege et.
2. **Asla** mevcut `id` ya da `class` selektörünü değiştirme — yeni isim
   istiyorsan **ek olarak** ver, mevcudunu koru.
3. **Yeni event'ler** `fleetly:` prefix'iyle (`FleetlyBus.Topic` enum'unda
   listele).
4. **Veri akışı**: yazma için mevcut JS'in fonksiyonları, okuma için
   `FleetlyStore.snapshot()`.
5. **CSS değişikliği**: bu refactor sırasında HİÇ CSS dokunulmaz — sadece
   JS yapısı.

## Test Önerisi

Her aşama sonunda manuel smoke test:
- [ ] Login → Dashboard yüklenir
- [ ] Sidebar nav 9 modül açılır
- [ ] Araç tablosu render olur, filtre çalışır
- [ ] Yakıt modal açılır, yeni kayıt eklenir
- [ ] Bakım modal açılır
- [ ] Sefer modal açılır
- [ ] CRM page açılır
- [ ] Tema toggle çalışır
- [ ] Mobile sidebar drawer açılır

## Tahmini İş Yükü

| Aşama | Commit Sayısı | Risk |
|---|---|---|
| 1 — Çekirdek altyapı | 1 (✓) | Düşük |
| 2 — UI controller'lar | 2-3 | Orta |
| 3 — Feature ayrımı | 4-6 | Yüksek |
| 4 — `data-action` | 2-3 | Yüksek (HTML mass change) |
| 5 — Lazy loading | 2-3 | Orta |

Toplam: ~12-18 commit, ~1-2 hafta odaklı çalışma.

---

**Mevcut yaklaşımın getirisi:** Şu hâliyle Fleetly tek-dosya monolit'ten
"core + ui + features" yapısına geçiş için altyapı hazır. Yeni feature
yazılırken eski stilde inline yapmak yerine modüler örüntüyle devam etmek
daha kolay olacak. Eski kod taşınmazsa bile yeni kodlar temiz kalır.
