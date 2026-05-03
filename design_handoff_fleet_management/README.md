# Fleetly.fit — Filo Yönetim Sistemi · Tasarım Handoff

## Genel Bakış

Bu paket, **Öner Lojistik Araç ve Bilgi Yönetim Sistemi**'nin yeniden tasarımını içerir. Tasarımın amacı:

1. **Yönetici** ekrana baktığında tüm kritik filo bilgilerini tek bakışta görebilsin
2. **Operasyon ekibi** veri girişi ve takip işlerini hızla, sürtünmesiz yapabilsin
3. Genel görsel kalite "komuta merkezi" hissi versin — müşteriye profesyonel ve değerli bir araç verildiği duygusu

## Bu Paketin İçeriği Hakkında

Bu klasördeki HTML/JSX/CSS dosyaları **tasarım referanslarıdır** — niyetlenen görünümü ve davranışı gösteren prototiplerdir. Production kodu olarak doğrudan kopyalanmaları hedeflenmemiştir.

**Görev:** Bu HTML tasarımlarını **mevcut uygulamanızın teknolojisi içinde yeniden üretmek** — projenizin kullandığı framework (React/Vue/Angular/Blazor/diğer), CSS yaklaşımı (Tailwind, CSS-in-JS, SCSS) ve component kütüphanesi (varsa) ile.

> **Claude Code'a verilecek yönerge:** "Önce projemin mevcut yapısını incele (package.json, tsconfig, component klasörleri, mevcut tema/token sistemi). Ardından bu handoff'taki tasarımı, projenin kendi konvansiyonlarına uyarak yeniden üret. HTML kodunu birebir kopyalama — mevcut component sistemine entegre et."

## Fidelity

**Yüksek fidelity (hi-fi).** Renkler, tipografi, spacing, animasyon süreleri, etkileşim durumları nihai değerlerdir. Pixel-perfect uyarlama hedefleyin. Mevcut tasarım sisteminizdeki token isimleriyle eşleştirin (örn. `--navy-500` → projenizdeki `colors.primary.500`).

---

## Marka & Görsel Kimlik

- **Logo:** Sol üstte SVG olarak çizilmiş bir kamyon-içinde-kutu işareti. Yedek olarak `assets/logo.jpg` orijinal logoyu içerir.
- **Marka adı kullanımı:** "Fleetly.fit" yer yer geçer — bunu kendi marka adınızla (örn. "Öner Lojistik" veya kurumsal isminiz) değiştirin. Logo SVG'yi de kendi logonuzla değiştirin (`components.jsx` içindeki `LogoMark` component'i).

---

## Renk Paleti (Design Tokens)

### Primary — Navy (Mavi)
| Token | Hex | Kullanım |
|---|---|---|
| `--navy-950` | #06111F | Sidebar dark variant |
| `--navy-900` | #0B1A2F | Sidebar arka plan, ana koyu |
| `--navy-800` | #0F2440 | Surface (dark theme) |
| `--navy-700` | #15355C | Sidebar active item |
| `--navy-600` | #1E4A82 | Hover state |
| `--navy-500` | #2C5A9E | **Primary brand color** — butonlar, ana vurgular |
| `--navy-400` | #4A7FC4 | Sparkline, secondary |
| `--navy-300` | #7FA7DC | Light decorations |
| `--navy-200` | #A3C4F0 | Very light accents |
| `--navy-100` | #D4E4F7 | Chip backgrounds |
| `--navy-50`  | #EEF4FB | Hover row, KPI icon bg |

### Accent — Orange (Sadece kritik aksiyonlar / alarmlar)
| Token | Hex | Kullanım |
|---|---|---|
| `--accent-600` | #E55A0F | Hover |
| `--accent-500` | #FF6B1F | **Primary accent** — CTA butonları, alarm pin'leri, aktif sidebar marker |
| `--accent-400` | #FF8C4A | Sinematik banner highlight |
| `--accent-100` | #FFE4D1 | Background tints |

### Semantic
| Token | Hex | Anlam |
|---|---|---|
| `--success` | #16A974 | Hareket halinde, teslim edildi, aktif |
| `--success-bg` | #DCF5E9 | |
| `--warning` | #E5A100 | Rölanti, yaklaşan, dikkat |
| `--warning-bg` | #FFF5D6 | |
| `--danger` | #DC3838 | Alarm, gecikme, ihlal |
| `--danger-bg` | #FBE0E0 | |

### Theme Tokens (Light / Dark)
İki tema desteklenir. Ana semantic token'lar:
- `--bg`, `--bg-elev`, `--bg-sunk`
- `--surface`, `--surface-2`
- `--border`, `--border-strong`
- `--text`, `--text-muted`, `--text-subtle`
- Sidebar her zaman koyu (komuta merkezi hissi için).

Tam değerler için `styles.css`'in :root ve `[data-theme="dark"]` bloklarına bakın.

---

## Tipografi

- **Gövde:** `Inter` 400/500/600/700 — Google Fonts
- **Sayısal/monospace:** `JetBrains Mono` 400/500/600/700 — Google Fonts
  - KPI rakamları, tablo numaraları, plakalar, telefon numaraları, KM, fiyatlar
  - `.mono` class veya `font-family: 'JetBrains Mono', monospace`
- `font-feature-settings: 'tnum'` (tabular numbers) — sayıların yan yana hizalanması için kritik

### Tip Ölçeği
| Bağlam | Boyut | Weight | Letter-spacing |
|---|---|---|---|
| KPI rakamı | 28px | 600 | -0.02em |
| Sayfa başlığı | 24px | 700 | -0.02em |
| Card başlığı | 14px | 600 | -0.005em |
| Body | 14px | 400 | normal |
| Tablo başlığı | 11.5px | 600 | 0.04em uppercase |
| Sub/muted | 12-12.5px | 400 | normal |

---

## Spacing, Radius, Shadow

```css
--r-sm: 6px;
--r-md: 10px;   /* button, input default */
--r-lg: 14px;   /* card */
--r-xl: 18px;   /* sinematik banner */

--shadow-xs: 0 1px 2px rgba(11,26,47,0.06);   /* card resting */
--shadow-sm: 0 2px 6px rgba(11,26,47,0.08);
--shadow-md: 0 8px 20px rgba(11,26,47,0.10);  /* card hover */
--shadow-lg: 0 20px 40px rgba(11,26,47,0.14); /* drawer */
--shadow-glow: 0 0 0 4px rgba(44,90,158,0.12); /* input focus ring */

--header-h: 64px;
--sidebar-w: 240px;
--sidebar-w-collapsed: 72px;
```

Spacing genellikle 4px bazlı: 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32.

---

## App Shell Yapısı

```
┌─────────┬─────────────────────────────────┐
│         │   HEADER (64px) — breadcrumb,   │
│         │   page title, search, actions   │
│ SIDEBAR ├─────────────────────────────────┤
│ (240px) │                                 │
│         │   MAIN — page content           │
│         │   (scrollable)                  │
│         │                                 │
└─────────┴─────────────────────────────────┘
```

CSS Grid: `grid-template-areas: "sidebar header" "sidebar main"`. Sidebar daraltıldığında 72px'e iner.

### Sidebar
- Daima koyu (`--nav-bg: #0B1A2F`)
- Logo + marka adı (üstte)
- Kullanıcı kartı (altta — avatar + ad + rol)
- Nav grupları: **Genel** (Dashboard, Harita), **Operasyon** (Araçlar, Sürücüler, Seferler, Bakım), **Analiz** (Yakıt, Raporlar), **Sistem** (Yeni Kayıt, Bildirimler)
- Aktif item: `--nav-active-bg` arka plan + sol kenarda 3px turuncu marker (`::before`)
- Bazı item'lar badge gösterir (örn. Seferler: 7, Bildirimler: 12)

### Header
- Sol: breadcrumb (small muted) + sayfa başlığı (17px 600)
- Orta: arama input'u (`--bg-sunk` zemin, focus'ta primary border + glow ring)
- Sağ: tema toggle (sun/moon ikon), settings ikon, bell ikonu (sağ üstte turuncu nokta var = okunmamış bildirim)

---

## Ekranlar

11 ekran tasarlandı. Her birinin amacı, layout'u ve component'leri:

### 1. Dashboard (Komuta Merkezi)
**Amaç:** Yöneticinin tek bakışta tüm kritik durumu görmesi.

**Layout (yukarıdan aşağı):**
1. **Sinematik Banner** (full-width, dark gradient, grid pattern overlay)
   - Sol: "Canlı" pill + tarih/saat, "Günaydın, [Ad]" başlık (28px), özet cümle (HTML highlight'larıyla)
   - Sağ: "Günlük Rapor" outline button + "Yeni Sefer" turuncu CTA
   - Alt: 5 kolonlu durum şeridi (Hareket / Rölanti / Park / Bakımda / Alarm) — her biri renkli pulse dot + büyük mono rakam + total
2. **KPI Row (4 kolon):** Bugün Tamamlanan / Toplam KM / Yakıt / Aylık Net Kâr
   - Her KPI: label (uppercase) + ikon + count-up animasyonlu büyük rakam + delta (yukarı/aşağı yeşil/kırmızı) + sağ alt köşede sparkline
3. **Ana satır (1.6fr / 1fr):**
   - Sol: **Canlı Konum Haritası** card (380px yükseklik) — pin'ler, "Canlı · N hareket" pill'i
   - Sağ: **Aktif Uyarılar** listesi (renkli ikon kutuları + başlık + alt + zaman)
4. **Grafik satırı (1.6fr / 1fr):**
   - Sol: 30 gün gelir/maliyet/km area chart
   - Sağ: Yaklaşan bakımlar listesi
5. **Alt satır (1fr / 1.6fr):**
   - Sol: En İyi Sürücüler (top 5, 1.'de altın yıldız rozeti)
   - Sağ: Son Seferler tablosu

### 2. Canlı Filo Haritası
- 320px sol panel + tam ekran harita
- Sol panel: filtreler (Tümü/Hareket/Rölanti/Bakım/Alarm), araç listesi (sol kenarda renkli durum çubuğu)
- Harita: stylized SVG (grid + Türkiye benzeri kara parçası + nokta-çizgi rotalar + şehir etiketleri). **Production'da gerçek harita kütüphanesi kullanın** (Mapbox/Leaflet/Google Maps). Mevcut SVG sadece görsel mock.
- Pin'ler: durum rengine göre, hareket halinde olanlar pulse animasyonlu

### 3. Araçlar
- Üstte filtreler (arama input + tip chip'leri)
- Tablo kolonları: Plaka (mono), Tip/Marka, Sürücü, Durum (renkli dot), Hız, Konum→Hedef, Yakıt (progress bar + %), KM, Sonraki Bakım, chevron
- Satıra tıklanınca **VehicleDrawer** açılır (sağdan slide-in, 540px genişlik)
  - Drawer içinde: 8 detay stat (2x4 grid), 24h hız profili area chart, bakım ve belge kartları, alt aksiyon butonları

### 4. Sürücüler
- Üstte 3 podium kart (top 3 skor) — büyük avatar, 1.'de altın yıldız rozeti, 3 stat (skor/sefer/km)
- Tablo: avatar+ad, telefon, ehliyet (chip + tarih), aktif araç, ay sefer/km, skor (progress bar + sayı), durum

### 5. Seferler
- Sekmeli üst (Tümü / Yolda / Yükleme / Planlı / Tamamlandı / Gecikme — sayaçlı)
- Tablo: sefer no, plaka, sürücü, güzergah (from→to), yük (tip + ton), ilerleme (progress bar + %), ETA, ciro, durum

### 6. Bakım Planlama
- Üstte 3 KPI (Gecikti / 2 Hafta İçinde / Tahmini Maliyet)
- 3 kolonlu Kanban: Gecikti (kırmızı) / Yaklaşan (sarı) / Planlı (mavi)
- Her kart: plaka + gün sayısı, bakım tipi, tarih + ₺ tutar

### 7. Yakıt & Maliyet
- 4 KPI + tarih range select
- 30 gün line/area chart
- Alt: araç bazlı tüketim listesi (turuncu progress bar) + maliyet kırılımı (renkli kategoriler, % dağılım)

### 8. Raporlar
- 2-kolon grid card'lar — her rapor için: ikon + ad + açıklama + tip chip (PDF/XLSX) + son tarih + Önizle/İndir aksiyonları

### 9. Yeni Kayıt
- Sol panel: 6 kayıt türü (Araç/Sürücü/Sefer/Bakım/Yakıt/Gider) — seçili olanın sol kenarında turuncu 3px çubuk
- Sağ: ilgili form (grid layout, field'lar — label uppercase muted + input). Alt aksiyon barı: İptal / Taslak / Kaydet & Devam

### 10. Bildirim Merkezi
- Liste: ikon kutusu (severity'e göre renkli) + başlık + alt + zaman + okunmamış nokta

### 11. Vehicle Detail (Drawer)
- Bağımsız sayfa değil, sağdan açılan drawer (540px). Detaylar yukarıda Araçlar bölümünde.

---

## Etkileşimler & Animasyonlar

| Element | Animasyon | Süre / Easing |
|---|---|---|
| Sayfa girişi | Fade + 8px slide-up | 400ms `cubic-bezier(.16,1,.3,1)` |
| KPI sayıları | Count-up 0 → değer | 900ms cubic ease-out |
| KPI card hover | translateY(-2px) + shadow-md | 200ms |
| Pulse dot (canlı) | scale 0.8 → 2.5 + opacity fade | 2.4s loop |
| Pin glow | radial pulse | 2.4s loop |
| Sidebar toggle | grid-template-columns transition | 300ms |
| Drawer open | translateX(100% → 0) | 300ms |
| Tablo satır hover | background `--bg-sunk` | 120ms |
| Tab değişimi | border-bottom-color | 150ms |
| Button hover | background shift | 150ms |
| Theme switch | data-theme attr → CSS variable swap | anlık (CSS) |

---

## State Yönetimi

Üst seviye state (App component):
- `page: string` — aktif sayfa id (router'a bağlanabilir)
- `collapsed: boolean` — sidebar
- `selectedVehicle: Vehicle | null` — drawer için
- `theme: 'light' | 'dark'` — localStorage'a persist edilmeli

Sayfa içi state:
- Filtre/arama/sekme state'leri her sayfada local

Veri (production'da):
- Vehicles, drivers, trips, maintenance, alerts — backend API'den
- Mock veri yapısı için `data.js` referans alınabilir
- Real-time için WebSocket / SSE öneriyorum (canlı durum, hız, alarm)

---

## Erişilebilirlik

- Tüm icon button'lara `title` attribute eklenmiş — production'da `aria-label`'a çevirin
- Renkler: WCAG AA için kontrast kontrol edildi. Sarı (warning) zemin yerine her zaman koyu sarı (#E5A100) text + açık sarı zemin kullanılıyor.
- Focus ring: `--shadow-glow` (4px primary alpha)
- Tablo satırları keyboard navigable yapılmalı (production'da)

---

## Dosyalar

| Dosya | İçerik |
|---|---|
| `index.html` | Entry point — script tag'leri, fontlar |
| `styles.css` | Tüm tasarım sistemi — token'lar, atom'lar, layout, animasyonlar |
| `data.js` | Mock veri (gerçek API ile değiştirilecek) |
| `components.jsx` | `Icon`, `LogoMark`, `CountUp`, `Sparkline`, `StatusDot` |
| `chart.jsx` | `BigChart` — 30 günlük çoklu line/area chart |
| `shell.jsx` | `Sidebar`, `Header`, nav config, page title map |
| `page-dashboard.jsx` | Dashboard + `KPICard` |
| `page-map.jsx` | `MiniMap`, `MapPage`, `VehiclePin`, harita SVG'leri |
| `page-ops.jsx` | `VehiclesPage`, `VehicleDrawer`, `DriversPage`, `TripsPage` |
| `page-rest.jsx` | Bakım, Yakıt, Raporlar, Yeni Kayıt, Bildirimler |
| `app.jsx` | Ana App component, routing |
| `tweaks-panel.jsx` | Geliştirici tweak panel (production'a alınmaz) |

`Fleetly.fit Filo Yönetim Sistemi.html` — tüm asset'ler gömülü standalone versiyon (browser'da açıp inceleyebilirsiniz).

---

## Claude Code'a Önerilen Akış

Aşağıdaki gibi adım adım komut verin:

1. **Keşif:** "Bu projenin yapısını incele. package.json, framework, mevcut component sistemi, state management, CSS yaklaşımı ve mevcut tasarım token'ları varsa onları raporla."
2. **Token mapping:** "Handoff'taki design tokens'ı projenin mevcut token sistemine eşleştir. Eksik olanları (örn. JetBrains Mono fontu, navy/accent tonları) projeye ekle."
3. **App shell:** "Önce sidebar + header layout'unu mevcut routing ve auth sistemine entegre ederek kur. Tema toggle'ını localStorage'a persist eden context ile yap."
4. **Sayfa sayfa:** "Dashboard'tan başla. Mock veriyi mevcut API client'ı ile değiştir. Component'leri projenin pattern'ine uyarla (Hooks/Service/Store ne kullanılıyorsa)."
5. **Harita:** "Mock SVG harita yerine Mapbox GL veya Leaflet entegre et. Pin componentini stilize et (pulse + glow korunsun)."
6. **Test:** "Her sayfa için en az bir snapshot/E2E test ekle."

İyi çalışmalar!
