# Sürücü Belge Yönetimi & Portal Entegrasyonu — Refactor Önerisi

**Tarih:** 22 Nisan 2026
**Hedef kapsam:** Tam refactor (araç, iş emri, sefer, yakıt dahil text→FK geçişi) + geriye dönük migration
**İlgili migration:** `db/migrations/2026_04_22__surucu_refactor.sql`

---

## 1. Mevcut durumda tespit edilen kök nedenler

Mevcut şema (`supabase_setup_v2.sql`) ve kod (`app-chunk-02.js`, `portal.html`, `sofor.html`) birlikte incelendiğinde, dört problemin teknik karşılıkları şöyle:

| # | Semptom | Kod hattı | Kök neden |
|---|---------|-----------|-----------|
| 1 | Davette ad-soyad + telefon tekrar manuel giriliyor, mükerrer kayıt | `app-chunk-02.js:4842-4912` `soforDavetOlustur()` | RPC `sofor_davet_olustur` sadece `(ad, telefon)` alıyor; `suruculer` tablosunda **telefonla arama yapılmıyor**. Eşleşme kabul anında (`sofor_davet_kabul`) yapıldığı için çoklu kayıt açılabiliyor. |
| 2 | Ofiste görünen belgeler portalda görünmüyor | `portal.html` tamamen `is_emirleri`/`takip_public` okuyor; `surucu_belgeler`'i hiç sorgulamıyor | Ofis tarafı `surucu_belgeler` tablosundan (bkz. `driverDataYukle()` `4460-4536`) okuyor, ama portal sayfası **aynı veri kaynağına bağlanmıyor**. Tek bir kanonik view yok. |
| 3 | Sürücü portaldan belge güncellese de ofis göremiyor | Yok | Portal → ofis onay akışı için ne tablo (`surucu_belge_onaylari`) ne RPC var. Mevcut kodda belge güncelleme sadece `driverUpsert()` içinde doğrudan `surucu_belgeler` UPDATE'idir. |
| 4 | "34FSB145 - Cihan Özcan" gibi karışık liste | `app-chunk-02.js:4681-4686`, `6135-6140` `_fillDavetAracSelect()` | Araç seçici doğrudan `araclar.sofor` (text) alanını okuyor; "boş mu" bayrağı yok, filtreleme yapılamıyor. |

### Altta yatan tasarım hataları

- `araclar.sofor` + `araclar.telefon` **text** kolonları, `surucu_belgeler.ad` + `.tel` alanlarının **duplicate'ı**. İki yerden yazıldığı için senkron bozuluyor (`saveVehicles()` `622-662`).
- `surucu_belgeler` tablosu tek satırda hem kişi bilgisi hem 5 belgenin bitiş tarihlerini tutuyor → yeni belge türü eklemek kolon ekletiyor, onay durumu tutulamıyor.
- `surucu_belgeler.arac_id` tekil FK → bir sürücünün birden fazla aracı olamıyor, geçmiş tutulamıyor.
- `is_emirleri.sofor_user_id` FK'si var ama `sofor`, `sofor_tel`, `sofor_whatsapp` **text** alanları hâlâ yazılıyor (üçüncü duplicate).

---

## 2. Hedef (to-be) veri modeli

Aşağıdaki model, "her bilgi tek yerde" (single source of truth) prensibini uygular. Arka plan renkleri yeni tabloyu, italikler mevcut tabloda eklenen kolonları gösterir.

```
                       ┌──────────────────────┐
                       │     firmalar         │
                       └──────────┬───────────┘
                                  │ firma_id
                   ┌──────────────┼─────────────────┐
                   │              │                 │
        ┌──────────▼─────────┐    │    ┌────────────▼─────────┐
        │    suruculer       │    │    │      araclar         │
        │  (kanonik sürücü)  │    │    │ + birincil_surucu_id │
        │                    │    │    │   (cache FK)         │
        │ UNIQUE(firma,      │    │    └────────────┬─────────┘
        │        telefon)    │    │                 │
        └──┬───────────┬─────┘    │                 │
           │           │          │                 │
           │           │          │                 │
 auth_user_id FK       │          │                 │
       ──────►         │          │                 │
   auth.users          │          │                 │
                       │          │                 │
       ┌───────────────▼───┐  ┌───▼──────────────────▼────────┐
       │ surucu_belgeleri  │  │   arac_sofor_atamalari        │
       │  (satır-bazlı)    │  │  (başlangıç/bitiş, birincil)  │
       │ UNIQUE(surucu,    │  │  UNIQUE aktif birincil (arac) │
       │        belge_turu)│  └───────────────────────────────┘
       └──────┬────────────┘
              │ belge_turu FK
       ┌──────▼──────────────┐
       │   belge_turleri     │  ('ehliyet','src','psiko',...)
       └─────────────────────┘

       ┌────────────────────────────┐
       │  surucu_belge_onaylari     │  (append-only audit log,
       │  (portal → ofis kuyruğu)   │   belge_id → surucu_belgeleri)
       └────────────────────────────┘

       ┌────────────────────────────┐
       │   surucu_davetleri         │
       │ + surucu_id (FK, dedup)    │
       │ + telefon_e164             │
       │ + davet_durumu             │
       └────────────────────────────┘
```

### Temel kurallar

1. **Kişi kimliği** yalnızca `suruculer` tablosunda tutulur. Aynı firmada aynı telefon iki kez bulunamaz (`UNIQUE(firma_id, telefon_e164)`).
2. **Belgeler** satır-bazlıdır; `belge_turleri` sözlüğünden türetilir. Yeni belge türü eklemek için kolon açmak gerekmez.
3. **Araç↔sürücü** ilişkisi `arac_sofor_atamalari` tablosunda **zaman eksenli** tutulur; "geçmişte X aracı şu şofördeymiş" sorgusu tek sorguda çalışır. `araclar.birincil_surucu_id` sadece hızlı okuma için cache'tir ve trigger ile otomatik güncellenir.
4. **Onay akışı** `surucu_belge_onaylari` tablosunda append-only audit log olarak tutulur. Portal'dan gelen her değişiklik önce onay kuyruğuna düşer.

---

## 3. İş akışları (workflow)

### 3.1 Davet akışı — telefon-first dedup

```
Ofis çalışanı "Davet oluştur" butonuna basar
        │
        ▼
[Frontend] telefon_e164 normalize edilir (+905321234567)
        │
        ▼
[Frontend] v_arac_secim üzerinden araç listesi yüklenir (aşağıda 3.4)
        │
        ▼
[Frontend] telefon blur olayında RPC: sofor_ara_by_telefon(firma_id, tel)
        │
        ├── Bulundu ─► Form read-only doldurulur: "Cihan Özcan (mevcut sürücü)"
        │                       │
        │                       ▼
        │              Ad alanı kilitli; yalnızca araç/not değiştirilebilir.
        │
        └── Bulunamadı ─► Form açık, ad girilir.
        │
        ▼
RPC: sofor_davet_olustur_v2(firma, ad, telefon, arac_id, not)
        │
        ├── suruculer'da telefon varsa o kullanılır (yeni_sofor = false)
        └── Yoksa "davet_bekliyor" statüsünde yeni suruculer kaydı yaratılır
        │
        ▼
surucu_davetleri satırı yaratılır (surucu_id FK dolu)
        │
        ▼
SMS/WhatsApp ile davet kodu sürücüye gider
        │
        ▼
Sürücü kayıt olur → sofor_davet_kabul_v2(kod)
        │
        ▼
suruculer.auth_user_id = auth.uid(), durum = 'aktif'
        │
        ▼
Davette arac_id varsa arac_sofor_atamalari açılır (varsa eski birincil kapanır)
```

**Anahtar değişiklik:** Aynı telefondan ikinci kez davet oluşturulduğunda ikinci `suruculer` satırı açılmaz; UI de bunu önceden bildirir.

### 3.2 Belge güncelleme onay akışı

```
Sürücü portalında belge formu (ehliyet_no, bitiş, vs.)
        │
        ▼
RPC: surucu_belge_guncelle(belge_turu, veri_json)
        │
        ▼
surucu_belgeleri satırı UPSERT edilir
  - onay_durumu = 'bekliyor'
  - kaynak      = 'portal'
        │
        ▼
surucu_belge_onaylari append (eski_veri, yeni_veri snapshot'ı)
        │
        ▼
[Ofis paneli] "Onay Kuyruğu" sekmesinde liste:
        SELECT * FROM surucu_belge_onaylari WHERE karar IS NULL AND firma_id = ...
        │
        ▼
Ofis çalışanı Onayla / Reddet
        │
        ▼
RPC: surucu_belge_onayla(onay_id, 'onayli'|'reddedildi', not)
        │
        ├── onayli  → surucu_belgeleri.onay_durumu = 'onayli'
        └── reddedildi → onay_durumu = 'reddedildi', red_nedeni = not
                           → sürücü portalda sebep görür, yeniden gönderebilir.
```

**Önemli:** Belge satırı her durumda tek bir canlı kayıttır (`UNIQUE(surucu_id, belge_turu)`). Onay kuyruğu ayrı bir tablodur, asla upsert yapılmaz; her değişiklik yeni bir satırdır → denetim izi.

### 3.3 Araç-sürücü atama değişikliği

```
[Ofis] Araç kartında "Sürücü değiştir"
        │
        ▼
RPC: arac_sofor_ata(arac_id, yeni_surucu_id NULL-able)
        │
        ├── Mevcut aktif birincil atama (bitis IS NULL) kapatılır (bitis=now())
        ├── Yeni birincil atama INSERT edilir (birincil_mi=true)
        └── Trigger `asa_arac_cache` araclar.birincil_surucu_id'yi günceller
        │
        ▼
Trigger `araclar_sofor_sync` ESKI araclar.sofor / araclar.telefon text
alanlarını otomatik doldurur → Eski kod bozulmaz (Faz 3).
```

### 3.4 Araç seçim listesi (UI)

Artık frontend `araclar.sofor` text alanını okumaz; bunun yerine `v_arac_secim` view'ından:

```sql
SELECT id, plaka, gosterim_adi, bos_mu, surucu_id, sofor_ad
FROM v_arac_secim
WHERE firma_id = :firma_id
ORDER BY plaka;
```

`gosterim_adi` UI'da direkt basılabilir (`"34FSB145 — Cihan Özcan"` veya boşsa `"34FSB145 (boş)"`). `bos_mu` bayrağı ile "sadece boş araçlar" filtresi tek checkbox ile yapılır.

---

## 4. Migration stratejisi (geriye dönük, 4 fazlı)

Migration **tek SQL dosyası** olarak hazırlandı fakat **aşamalı deploy** önerilir:

| Faz | Ne yapılır | Kırılma riski | Geri dönüş |
|-----|-----------|---------------|------------|
| **1** | Yeni tablo/kolonlar eklenir. Eski yapı aynen çalışır. | Yok | `DROP TABLE` ile geri |
| **2** | Eski text alanlardan yeni yapılara backfill. İdempotent (`ON CONFLICT DO NOTHING`). | Yok (read-mostly) | Yeni satırları sil |
| **3** | Senkron trigger'ları kurulur. Eski kod yeni veriyi görür, yeni kod eski veriyi yazmadan çalışır. | Çok düşük — sadece INSERT/UPDATE tetikleyicileri. | `DROP TRIGGER` |
| **4** | Frontend/RPC geçişi bittikten sonra eski kolonları drop et. Staging'de 2 sprint beklet. | Yüksek | Kolon restore edilmez; migration öncesi snapshot şart. |

Migration detayları: `db/migrations/2026_04_22__surucu_refactor.sql`.

### Faz 2 öne çıkan backfill noktaları

- `surucu_belgeler.tel` → `suruculer.telefon_e164` (fn_normalize_tel ile +90 prefix'i)
- `araclar.sofor/telefon` → eğer `surucu_belgeler`'de yoksa `suruculer('davet_bekliyor')` olarak açılır (phantom kişiler kaybolmaz)
- `surucu_belgeler.{ehliyet,src,psiko,takograf,saglik}_*` → `surucu_belgeleri` satırlarına (her belge türü bir satır)
- `is_emirleri.sofor_user_id` veya `sofor_tel` → `is_emirleri.surucu_id` FK'si

---

## 5. Kod tarafı refactor checklist

Migration deploy edildikten sonra frontend/RPC değişiklikleri aşağıdaki sıra ile yapılmalı. Her madde atomik commit, feature flag arkasında.

### 5.1 Araç seçim listesi (quick win, 1 saat)

- [ ] `app-chunk-02.js:4681-4686` `_fillDavetAracSelect()` — kaynağı `v_arac_secim`'e çevir; `option.text = row.gosterim_adi`.
- [ ] `app-chunk-02.js:6135-6140` `_fillSeferAracSelect()` — aynı.
- [ ] Davet modalına "Sadece boş araçlar" checkbox'ı: `WHERE bos_mu = true` filtresi.

### 5.2 Davet akışı

- [ ] `app-chunk-02.js:4842-4912` `soforDavetOlustur()`:
  - Telefon `blur` event'ine `rpc('sofor_ara_by_telefon')` ekle.
  - Eşleşme varsa ad alanını disable + "mevcut sürücü" rozeti göster.
  - RPC adını `sofor_davet_olustur` → `sofor_davet_olustur_v2` olarak değiştir, `firma_id` parametresini ekle.
- [ ] `app-chunk-06.js` `sofor_davet_kabul` → `_v2` varyantına geç.

### 5.3 Sürücü dosyası (ofis)

- [ ] `app-chunk-02.js:4460-4536` `driverDataYukle()` — iki kaynaklı dedup mantığını sil. Tek sorgu:
  ```js
  supabase.from('v_surucu_dosyasi').select('*').eq('firma_id', firmaId)
  ```
- [ ] `driverUpsert()` — belge alanlarını ayrı RPC'ye böl:
  - Kişi alanları → `suruculer` UPDATE
  - Belge alanları (ehliyet, src, …) → her biri için `surucu_belgeleri` UPSERT

### 5.4 Şoför portalı (YENİ)

- [ ] `portal.html` — yalnızca sevkiyat takibi olduğu için ona dokunma, ama **sürücüye özel** yeni bir sayfa/route (`/sofor/profil`) aç:
  - `v_surucu_dosyasi` view'ından kendi satırını çeker (RLS ile kilitli).
  - `belgeler` jsonb array'i — her belge için kart + "Güncelle" butonu.
  - Güncelle → `rpc('surucu_belge_guncelle', ...)`.
- [ ] Karttaki durum rozeti: `onay_durumu = 'bekliyor'` → "Onay bekliyor", `'reddedildi'` → kırmızı + `red_nedeni`.

### 5.5 Ofis onay kuyruğu (YENİ)

- [ ] `app.html` sürücü sekmesine "Onay Kuyruğu" tab'ı ekle. Veri:
  ```js
  supabase.from('surucu_belge_onaylari')
    .select('*, surucu:suruculer(ad, telefon_e164)')
    .is('karar', null)
    .eq('firma_id', firmaId)
    .order('talep_zamani', { ascending: false });
  ```
- [ ] Satırda "Eski → Yeni" diff görünümü (`eski_veri` vs `yeni_veri` JSON'u).
- [ ] Onayla/Reddet butonları → `rpc('surucu_belge_onayla', id, karar, not)`.

### 5.6 İş emri / sefer / yakıt

- [ ] `is_emirleri` yazımında `surucu_id`'yi doldur (kod zaten `sofor_user_id`'yi yazıyor; FK var). Eski text alanlar trigger ile dolar.
- [ ] `seferler` ve `yakit_girisleri` benzer şekilde — `v_surucu_dosyasi` üzerinden sürücü seçimi tek kaynaktan.

### 5.7 Drop eski kolonlar (Faz 4 — tüm geçiş bittikten sonra)

- [ ] Tüm kodun yeni yapıya geçtiğini prod'da 2 sprint gözlemle.
- [ ] Ayrı migration dosyası: `2026_05_XX__drop_legacy_text_columns.sql`.
- [ ] `araclar.sofor`, `araclar.telefon`, `is_emirleri.sofor`, `is_emirleri.sofor_tel`, `seferler.sofor`, `seferler.plaka`, `yakit_girisleri.sofor` DROP.
- [ ] `surucu_belgeler` tablosu → `_arsiv_surucu_belgeler` rename; 30 gün sonra drop.

---

## 6. Problem–çözüm eşleşme tablosu

| Problem | Çözümün hangi parçası |
|---------|-----------------------|
| (1) Davette mükerrer kayıt | `UNIQUE(firma_id, telefon_e164)` + `sofor_davet_olustur_v2` dedup mantığı + telefon blur lookup (§5.2) |
| (2) Portaldaki belge boşluğu | `v_surucu_dosyasi` (tek veri kaynağı) + sürücüye özel profil sayfası (§5.4) |
| (3) Çift yönlü veri akışı yok | `surucu_belge_onaylari` tablosu + `surucu_belge_guncelle` / `surucu_belge_onayla` RPC çifti + ofis Onay Kuyruğu sekmesi (§5.5) |
| (4) Araç seçim listesi karmaşası | `v_arac_secim` view'ı + `gosterim_adi` + `bos_mu` filtresi (§3.4, §5.1) |

---

## 7. Riskler ve açık kararlar

1. **Telefon normalizasyonu.** `fn_normalize_tel` TR varsayılanıyla yazıldı. Yurtdışı şoförlerle çalışılıyorsa +90 default'u kaldırılmalı; form seviyesinde ülke kodu seçtirilmeli.
2. **Sürücü birden fazla firmada çalışıyorsa.** Mevcut model `UNIQUE(firma_id, telefon_e164)` — iki ayrı firmada aynı sürücü iki ayrı kayıt olur. `auth_user_id` üzerinden ortak "kişi" görünümü istenirse ek bir `kisiler` tablosu gerekir (bu scope dışı tutuldu).
3. **RLS policy'leri** migration'da minimal yazıldı. Production'a geçmeden önce `rol IN ('operasyoncu')` kullanıcısının hangi yazma haklarına sahip olacağı netleştirilmeli (örn. belge onaylayabilir mi, yoksa sadece yonetici+sahip mi?).
4. **`is_emirleri.sofor_whatsapp`** text alanı — bu kişiye özel değil cihaza özel; yeni modelde `suruculer.ayarlar->>'whatsapp'` altında tutulabilir, yoksa `suruculer.whatsapp_tel` kolonu açılabilir. Kapsam kararı bekliyor.
5. **Portal'ın mevcut hali** (`portal.html`) **müşteri takip** sayfasıdır, sürücü portali değil. "Şoför Portalı" derken ne kastedildiği netleşmeli — talep, sürücüye özel bir profil/belge sayfası eklenmesi olarak yorumlandı (§5.4).

---

## 8. Deploy sırası önerisi

```
Sprint N:
  ├─ Gün 1:  Migration FAZ 1+2+3 staging'e → smoke test
  ├─ Gün 2:  Migration production'a (sadece FAZ 1+2+3; Faz 4 YOK)
  ├─ Gün 3:  §5.1 (araç seçici) + §5.2 (davet)  — feature flag
  ├─ Gün 4:  §5.3 (ofis sürücü dosyası)
  └─ Gün 5:  §5.4 + §5.5 (portal + onay kuyruğu)

Sprint N+1:
  └─ §5.6 (iş emri/sefer/yakıt referansları)

Sprint N+2:
  └─ §5.7 (Faz 4: legacy kolonların drop'u)
```

---

**Ekler**
- Migration: `db/migrations/2026_04_22__surucu_refactor.sql`
- Architecture referansı: `docs/ARCHITECTURE.md`

---

## 9. Uygulanan kod değişiklikleri (22 Nisan 2026)

| # | Dosya | Fonksiyon / bölüm | Durum |
|---|-------|-------------------|-------|
| §5.1 | `js/pages/app-chunk-02.js` | `loadVehicles()` — v_arac_secim fallback | ✅ |
| §5.1 | `js/pages/app-chunk-02.js` | `_aracSecimOption()`, `_filteredVehicles()` helper'lar | ✅ yeni |
| §5.1 | `js/pages/app-chunk-02.js` | `_fillDriverPlacaSelect`, `_fillDavetAracSelect`, `_fillSeferAracSelect`, `_fillMasrafAracSelect` | ✅ |
| §5.1 | `app.html` | Davet modalında "Sadece boş araçlar" checkbox | ✅ |
| §5.2 | `js/pages/app-chunk-02.js` | `_telNormalize()`, `soforDavetTelLookup()` | ✅ yeni |
| §5.2 | `js/pages/app-chunk-02.js` | `soforDavetOlustur()` — v2 RPC + v1 fallback | ✅ |
| §5.2 | `js/pages/app-chunk-06.js` | `soforOtpDogrula()` — kabul v2 + v1 fallback | ✅ |
| §5.3 | `js/pages/app-chunk-02.js` | `loadDriverData()` — v_surucu_dosyasi + fallback | ✅ |
| §5.3 | `js/pages/app-chunk-02.js` | `saveDriverEntryCloud()` — yeni/eski split yazım | ✅ |
| §5.4 | `sofor-profil.html` | YENİ sayfa — belge görüntü + onaya gönderme | ✅ yeni |
| §5.4 | `sofor.html` | "👤 Profilim" link ekleme | ✅ |
| §5.5 | `app.html` | Onay Kuyruğu sekmesi + badge | ✅ yeni |
| §5.5 | `js/pages/app-chunk-02.js` | `onayKuyruguYukle()`, `_onayKartiHtml()`, `onayKarar()` | ✅ yeni |
| §5.5 | `js/pages/app-chunk-02.js` | `switchDsTab()` — 'onay' vakası eklendi | ✅ |
| §5.6 | `js/pages/app-chunk-02.js` | `saveVehicles()` — `birincil_surucu_id` conditional yazım | ✅ |

**Deploy dışı kalan bölümler** (kasıtlı):
- §5.7 **Faz 4 DROP migration** — ayrı dosyada, en erken 2 sprint sonra çalıştırılmalı.
- `is_emirleri` / `seferler` / `yakit_girisleri` kod tarafı — migration trigger'ları eski text alanları zaten senkron tuttuğu için acil değil; rafine iş emri formu ayrı task.

**Geriye dönük güvenlik stratejisi:**
Tüm yeni kod `v2 RPC' → `v1 RPC' fallback pattern'i kullanır; `v_arac_secim`/`v_surucu_dosyasi` view'ları yoksa eski `araclar`/`surucu_belgeler` tablolarından okur. Migration çalıştırılmadan önce de, çalıştırıldıktan sonra da frontend bozulmaz. Migration sırasında kısa bir "karışık veri" penceresinde bile kullanıcı gözünden görünür bir kırılma olmaz.

---

## 10. HOTFIX — 2026-04-22b (deploy sonrası düzeltmeler)

Ana migration (`2026_04_22__surucu_refactor.sql`) deploy edildikten sonra üç
üretim hatası çıktı. `css/db/migrations/2026_04_22b__hotfix_views_and_rpc.sql`
tümünü tek transaction'da düzeltir, idempotenttir.

| # | Belirti | Kök neden | Düzeltme |
|---|---------|-----------|----------|
| B1 | "Tek sürücü çekici+dorsede kayıtlıysa listede iki kez gözüküyor, sürücü sayısı şişiyor." | `v_surucu_dosyasi` view'ı `LEFT JOIN arac_sofor_atamalari … birincil_mi=true` kullanıyordu. Bir sürücü iki araca birincil_mi=true atandığında JOIN her araç için yeni satır üretti. | View yeniden yazıldı: ana kaynak `suruculer`, araç atamaları scalar subquery ile tekilleştirildi. Ek alanlar: `arac_plakalari text[]`, `arac_sayisi int`. Bir sürücü = bir satır garantisi. |
| B2 | "Kayıtlı muayene/sigorta/takograf bitiş tarihleri panelde gözükmüyor." | `v_arac_secim` view'ı `muayene/sigorta/takograf/esleme/notlar` sütunlarını expose etmiyordu. `loadVehicles()` view yolunu tercih edince bu alanlar `undefined` olup boş string atandı. | View'a eksik 5 sütun eklendi: `a.muayene, a.sigorta, a.takograf, a.esleme, a.notlar`. |
| B3 | SMS OTP sonrası giriş: `column reference "firma_id" is ambiguous`. | `sofor_davet_kabul_v2` fonksiyonu `RETURNS TABLE(surucu_id uuid, firma_id uuid)` OUT parametreleriyle tanımlıydı. `RETURNING id, firma_id INTO surucu_id, firma_id` ifadesinde OUT param ↔ `suruculer.firma_id` sütunu çakıştı (PG 42702). | `DROP FUNCTION` + yeniden oluştur. OUT isimleri `out_surucu_id`, `out_firma_id` olarak değiştirildi; RETURNING iç değişkenlere (`v_surucu_id`, `v_firma_id`) yazıyor; tablo-nitelikli `s.firma_id` kullanıldı. Frontend `.rpc()` çağrısı dönen data yapısını okumuyor, sadece `error` kontrol ediyor → breaking change değil. |

**Deploy adımı:** Supabase SQL editor'da `2026_04_22b__hotfix_views_and_rpc.sql`
içeriğini aç-yapıştır-çalıştır. Tek `BEGIN…COMMIT` işlemdir; herhangi bir
statement düşerse tüm değişiklikler rollback edilir. Frontend değişikliği
gerektirmez.
