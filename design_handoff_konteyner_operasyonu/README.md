# Handoff: Konteyner Operasyon Yönetim Modülü — Yeniden Tasarım

> Bu paket Claude Code (veya başka bir geliştiriciye) verilmek üzere hazırlanmıştır. İçeriği bir HTML prototip + tüm tasarım kararlarını içerir.

---

## 0. Bu paketteki dosyalar tasarım referansıdır

`design/` klasöründeki HTML/JSX dosyaları **HTML olarak hazırlanmış görsel referans prototiplerdir** — prodüksiyon kodu değildir. Bu dosyaları doğrudan kopyalamak yerine, **mevcut kod tabanının kendi ortamında (React/Vue/Next/Angular/SwiftUI vs.) yeniden inşa edin**: kendi component kütüphanenizi, design system'inizi, ikon setinizi, state yönetimi yapınızı kullanın. Hiç bir UI framework yoksa, projenin doğasına en uygun olanı seçin.

Tek istisna: token dosyası (`tokens.css`) doğrudan kopyalanabilir — global CSS değişkenleri ya da Tailwind theme extend olarak.

## 1. Genel Bakış
- **Ürün**: Liman → Fabrika konteyner taşıma operasyonu yönetim paneli
- **Kullanıcı**: Operasyon şefleri, dispeçerler, filo yöneticileri
- **Ortam**: Masaüstü ağırlıklı (≥ 1440px), uzun mesai, hızlı karar
- **Dil**: Türkçe (UI metinleri olduğu gibi korunmalı)
- **Tema**: Koyu, derin lacivert tabanlı; marka turuncusu sadece CTA + gerçek "acil" için

## 2. Fidelity
**Hi-fi.** Renkler, tipografi, spacing, durum varyantları nihaidir; pixel-perfect uygulanmalıdır. Component'lerin etiket metni, mono fontla yazılan kimlikler ve durum pill'leri olduğu gibi alınmalı.

## 3. Ekranlar

### 3.1 Üst Çubuk (AppBar)
- Sol: `‹ Ana Sayfa` ghost butonu · marka rozeti (turuncu kare, "K") · başlık `Konteyner Operasyonu` + alt başlık `İş emri yönetimi & saha takibi`
- Sağ: **CANLI** rozeti (yeşil dot + saat) · arama kutusu (placeholder, ⌘K kbd) · `+ İş Emri Oluştur` (primary CTA)
- Yükseklik 56–60px, alt 1px border `border/subtle`

### 3.2 Acil Bandı (Alert Strip)
- **Sadece aktif acil olduğunda** render edilir.
- Sol 3px kırmızı border + soft kırmızı gradient bg
- İçerik: ünlem rozeti · `1 ACİL` etiketi · plaka (mono, kırmızı) · sebep cümlesi · sağda `Sürücüyü Ara` ghost + `Detay` danger butonu + `✕` kapatma
- Tıklanabilir (kart açar). Kapat'a basıldığında dismiss edilir, 4 saat sonra tekrar gösterilir.

### 3.3 KPI Şeridi
- 5 sütun grid, her hücre: büyük mono sayı (28/600) + küçük caps etiket (10/500/letterSpacing 1.4)
- Trend rozeti opsiyonel: `▲ +2 bugün` (yeşil), `▼ 1 acil` (kırmızı/turuncu)
- Aktif sütun (Yolda) hafif mavi tinted bg (`rgba(91,157,249,0.04)`)
- Sağ alt köşede sub-label (`atanmadı`, `aktif sevkiyat`, `tamamlandı`)

### 3.4 Görünüm Sekmeleri (ViewBar)
- `İş Emirleri` · `Canlı Takip` (kırmızı dot, gerçek zamanlı) · `Filo Haritası` · `Arşiv`
- Aktif altında 2px turuncu underline
- Sağda: `Otomatik yenileme 30s` (yeşil mono) · `Filtrele` · `Bugün ▾`

### 3.5 Kanban — Canlı Takip
- 4 kolon eşit grid (`repeat(4, 1fr)`), gap 12px, padding 16/20
- Her kolon: header (status dot · büyük caps başlık · count chip · hint · ⋯ menü) + kart listesi
- Boş kolonlar **empty state** gösterir: ikon + başlık + 1 cümle + ilgili CTA. Asla "Boş" yazısı tek başına durmaz.
- Kart sürüklenip başka kolona bırakılabilir (drag & drop), durum API'sini günceller.
- Bekliyor kolonu altta `+ İş emri ekle` dashed butonu.

### 3.6 Konteyner Kartı (atomik component)
**Anatomi (yukarıdan aşağıya):**
1. Üst satır: plaka (mono 13/600, beyaz) · tip pill (40 DC) · dolu/boş pill · sağda durum-bazlı pill (ACİL / +18dk / ✓ POD)
2. Konteyner satırı: `⬛ <konteyner no>` · müşteri adı (truncate)
3. Sürücü satırı (1px border-top): avatar (initials gradient) · isim + telefon (mono 10) · sağda canlı yeşil dot
4. Rota satırı (yalnız Yolda/Fabrikada): origin → destination · 3px progress bar
5. Metric şeridi: ETA · süre · son ping. Teslim varyantında: km · dönüş km

**Aciliyet kuralları (kart kenarı):**
- `normal` → 2px sol bar, status rengi
- `delayed` (gecikme > 15dk) → 2px `warning` (#E5A24B), border 40% opacity
- `urgent` (sinyal kaybı > 20dk veya manuel ACİL) → 3px `danger` (#F26B5E), gradient bg, ekstra glow shadow

**Varyantlar (6):** Bekliyor · Yolda Normal · Yolda Gecikme · Yolda ACİL · Fabrikada · Teslim+POD

### 3.7 İş Emirleri Tablosu
- Sticky header, 10/500 caps muted etiketler
- Satır yüksekliği ≈ 40px, `border-top` 1px, alternating bg (`#0A0E1A` / `#0C1220`)
- Sol kenar: aciliyet rengi (transparent/warning/danger), 2px
- Plaka sütunu: turuncu mono · konteyner no: beyaz mono · müşteri: regular
- Durum pill'i renkli dot + label + opsiyonel `· ACİL` / `· +18dk`
- Yola çıkış sütunu: ana mono saat + alt satırda `12s 32dk önce` (aciliyete göre renk)
- Bekleme > 30dk → warning rengi
- Sağda 3 ikon: Detay (↗), Düzenle (✎), Duraklat (⏸). Hepsi tooltip'li, klavye odaklanabilir.

### 3.8 Yeni İş Emri Modal (4 Adımlı Stepper)
- **Width 720px**, `bg/elevated` (#151D31), border `border/strong`
- Header: turuncu `+` rozet · başlık + alt başlık (`taslak otomatik kaydediliyor`) · ✕
- Stepper rail: 4 adım. Tamamlanan = yeşil ✓, aktif = turuncu numara + halka, gelecek = nötr
- Adımlar:
  1. **Müşteri & Konteyner**: müşteri seçimi · konteyner no(lar) (textarea, satır başına bir) · konteyner durumu (Dolu/Boş)
  2. **Sürücü & Araç** *(görseldeki aktif adım)*: plaka/isim/telefon araması + canlı suggestion dropdown · sürücü adı · telefon · konteyner tipi (segmented: 20 DC / 40 DC / 40 HC / Reefer)
  3. **Rota**: alım noktası · teslim yeri · Google Maps share linki yapıştırma alanları · referans no · mühür no
  4. **Onay**: özet kartı · bildirim ayarları
- Footer: `⌘+Enter ile sonraki adım` ipucu · `İptal` / `← Geri` / `Sonraki →` (primary)
- ESC ile kapanır, dış tıklama da kapatır ama önce taslak kaydı uyarısı verir

### 3.9 Detay Drawer
- Sağdan slide-in, **440px genişlik**, `bg/elevated` arka plan
- Header: durum pill'leri · ✕ / ⤢ / ↻ ikon butonları · büyük başlık (konteyner no + plaka) · özet satır · 3 birincil aksiyon (`📞 Sürücüyü Ara` primary · `📍 Konum` · `↻ Yenile`)
- **En üstte canlı rota timeline'ı** (vertikal): durak ismi + saat + alt detay; tamamlanan ✓ yeşil, aktif renkli halka, gelecek nötr. Aktif adım acil ise kırmızı.
- Tabs: `Detaylar` (varsayılan), `Olay Akışı`, `Belgeler`, `Yakıt`
- Detaylar: 3 grup (`Durum & Konteyner`, `Belgeler & Referans`, `Süre & Mesafe`) — key/value satırlar; identifier ve sayılar mono.

## 4. Etkileşim & Davranış
- **Otomatik yenileme**: 30 saniyede bir kanban + KPI fetch (manuel yenile butonu da var). Sayfa visible değilse pause.
- **Drag & drop**: kart kolon değiştirdiğinde optimistic update + sunucu çağrısı, hata olursa geri al + toast.
- **Acil hesaplama**: `urgent = lastPingAgo > 20min || manualUrgent`. `delayed = etaDelta > 15min && etaDelta <= 60min`.
- **Animasyonlar**: 200–300ms, sadece state geçişlerinde (drawer in/out, modal scale-in, kart durum değişikliği fade). Hover'da renk geçişi 150ms.
- **Klavye**:
  - `⌘K` → arama
  - `N` → yeni iş emri
  - `Esc` → açık modal/drawer kapat
  - `←/→` → drawer açıkken önceki/sonraki kayıt
  - Tablo satırı odaklıyken `Enter` → drawer aç
- **Erişilebilirlik**: tüm interaktif elementlerin focus-visible state'i (2px turuncu outline). Renk-only bilgi yasak — durumlar ayrıca metin/ikon ile de gösterilir.
- **Mobil/Responsive**: < 1024px'de kanban yatay scroll'a düşer, kartlar tam genişlik. Tablo `overflow-x: auto` + sticky ID kolonu. KPI 5'li grid → 2 satır 2/3 grid.

## 5. State
**Global state (örn. Zustand/Redux/Context):**
```ts
type WorkOrder = {
  id: string;
  customer: string;
  driver: { name: string; phone: string; online: boolean } | null;
  vehiclePlate: string | null;
  containerNo: string;
  containerType: '20 DC' | '40 DC' | '40 HC' | 'Reefer';
  loaded: boolean;
  status: 'bekliyor' | 'yolda' | 'fabrikada' | 'teslim';
  urgency: 'normal' | 'delayed' | 'urgent';
  etaAt: string;       // ISO
  startedAt: string | null;
  lastPingAt: string | null;
  origin: string;
  destination: string;
  progress: number;    // 0..1
  km: number;
  pod: boolean;
  delayMin?: number;
};
```

## 6. Design Tokens — `tokens.css`
Aşağıdaki dosyayı doğrudan kullanabilirsiniz (CSS variables) ya da Tailwind `theme.extend`'e taşıyabilirsiniz. Tüm renkler WCAG AA hedefi gözetilerek seçildi.

| Token | Hex | Kullanım |
|---|---|---|
| `--bg-base` | `#0A0E1A` | Sayfa arkaplan |
| `--bg-raised` | `#0F1524` | Kart, panel |
| `--bg-elevated` | `#151D31` | Modal, drawer |
| `--bg-hover` | `#1A2238` | Hover, satır |
| `--border-subtle` | `#1E2740` | Bölücü çizgi |
| `--border-strong` | `#2A3553` | Vurgulu çerçeve |
| `--text-primary` | `#E8ECF5` | Ana metin |
| `--text-secondary` | `#A4ADC2` | Yardımcı |
| `--text-muted` | `#6B7490` | Etiket |
| `--text-dim` | `#4A5269` | Pasif |
| `--danger` | `#F26B5E` | Acil, gecikme |
| `--warning` | `#E5A24B` | Uyarı, yavaşlama |
| `--success` | `#4ADE80` | Teslim, OK |
| `--info` | `#5B9DF9` | Yolda, devam |
| `--neutral` | `#7A8299` | Bekliyor |
| `--brand` | `#FF7A45` | CTA, marka — nadir kullanılır |
| `--purple` | `#9F7AEA` | Fabrikada |

**Tipografi:**
- Inter (400/500/600), JetBrains Mono (500/600) — Google Fonts.
- `display`: 32/40/600 · `h1`: 22/30/600 · `h2`: 16/22/600 · `body`: 13/18/400 · `caption`: 11/14/500 caps letterSpacing 1.4 · `mono`: 12/16/500 (identifier ve sayılar için).

**Spacing**: 4px grid → 4, 8, 12, 16, 24, 32, 48.

**Radius**: 4 (chip), 6 (input/button), 8 (kart), 10 (modal/panel).

**Shadow**:
- `card`: `0 2px 6px rgba(0,0,0,0.25)`
- `card-urgent`: `0 0 0 1px rgba(242,107,94,0.12), 0 8px 20px rgba(0,0,0,0.30)`
- `modal`: `0 30px 80px rgba(0,0,0,0.5)`
- `drawer`: `-30px 0 80px rgba(0,0,0,0.45)`

## 7. Assets
- Marka rozet: gradient kare (45° turuncu → koyu turuncu), içinde "K" — SVG olarak yeniden çizilebilir, asset gerekmiyor.
- İkonografi: Lucide veya Heroicons (line-style). Mevcut prototipte unicode kullanıldı; gerçek implementasyonda ikon kütüphanesi tercih edin.
- Avatar: kullanıcı initials, lacivert gradient bg.

## 8. Bu paketteki dosyalar
- `README.md` — bu doküman
- `tokens.css` — kullanıma hazır CSS variables
- `design/Konteyner Operasyonu - Yeniden Tasarım.html` — tüm canvas (yedi artboard)
- `design/*.jsx` — modüler React/Babel kaynak dosyaları (referans amaçlı)

## 9. Önerilen implementasyon sırası
1. Token'ları yerleştir (`tokens.css`).
2. `Pill`, `Button`, `IconButton`, `Field`, `Input` atomic primitive'leri.
3. `ContainerCard` — bütün varyantları + Storybook/test.
4. KPI bar + Alert strip + AppBar + ViewBar.
5. Kanban kolonu + drag & drop.
6. Tablo + filtre toolbar + satır aksiyonları.
7. Stepper modal (form state + validasyon).
8. Drawer + canlı rota timeline.
9. Otomatik yenileme + websocket entegrasyonu.
10. Mobil responsive ayarlamalar + erişilebilirlik denetimi.
