# Fleetly — Claude Code Handoff Prompt v4 (2026-05-08 öğleden sonra)

> **Bu dosyayı yeni Claude Code sohbetine giriş prompt'u olarak yapıştır.**
>
> İki repo birden var:
> - `C:\Users\cihan\Desktop\Fleetly-main` — Web yönetici paneli (vanilla HTML/CSS/JS)
> - `C:\Users\cihan\Desktop\Fleetly-Android` — Native Kotlin + Jetpack Compose + Hilt + Room + Supabase

---

## Bağlam

Fleetly Türkiye'de çalışan bir konteyner taşımacılığı SaaS'ı. ~35 SQL migration, multi-tenant izolasyon (RLS), davet sistemi, sürücü mobile app, Web operasyon panel, FCM push bildirim, otomatik sefer + masraf + yakıt + harcırah entegrasyonu.

**Bir önceki turda (v3, 2026-05-08 sabah)** tamamlananlar v3 dokümanında. Bu v4 yalnızca **bu turda (08 öğleden sonra) eklenenleri + sıradaki açık görevi** kapsar. Yeni sohbet açıldığında v3'ü kullanıcıdan istemeden devam edebilirsin.

---

## v3 sonrası bu turda (2026-05-08 öğleden sonra) eklenenler

### 🔐 1) Sürücü kendi `fcm_token`'ını yazamıyordu — SECURITY DEFINER RPC çözümü

**Migration:** `2026_05_08b__surucu_fcm_token_rpc.sql`

`suruculer` tablosu RLS UPDATE policy'si `_user_firma_yetkili_ids()` kullanıyor — sürücü kendi satırını update edemiyordu. `saveFcmToken` direkt UPDATE atıyordu, RLS engelliyor, `runCatching` hatayı yutuyordu → `fcm_token` NULL kalıyor → tüm push trigger'ları sessiz başarısız oluyordu.

Eklenen 4 RPC (hepsi SECURITY DEFINER):
- `surucu_fcm_token_kaydet(p_token text)`
- `surucu_push_subscription_kaydet(p_subscription jsonb)` — web push için, ileride
- `surucu_son_giris_guncelle()`
- `surucu_profil_guncelle(...)` — `updateProfile` için

**Mobile:** `DriverRepositoryImpl.saveFcmToken` ve `updateProfile` direct UPDATE'ten RPC'ye çevrildi. Logcat tag'i: `Fleetly-FCM`.

**Test edildi ve geçti:** kullanıcı saha testinde "geldi şimdi allah razı olsun" dedi.

> ⚠️ **Yeni sürücü self-write gerekirse her zaman bu pattern:** SECURITY DEFINER RPC ekle, mobile RPC çağır.

### 🚛 2) 3-nokta akışında final faz buton metni bug fix

`JobDetailScreen.kt` ~satır 1100. Önce her iki senaryoda da "Boş konteyneri X'a götür" yazıyordu. Düzeltme: `finalKontDolu = isBosKonteyner` flag eklendi (başta boşsa fabrikada doldu).

| Senaryo | Önce | Sonra |
|---|---|---|
| A — başta dolu (Liman→Fabrika→Boş depo) | "Boş konteyneri Boş depo'ya götür" | Aynı (zaten doğruydu) |
| B — başta boş (Boş depo→Fabrika→Liman) | ❌ "Boş konteyneri Liman'a götür" | ✅ "Dolu konteyneri Liman'a teslim et" |

ViewModel'deki `finalKonteynerDolu` ve TeslimOnayDialog zaten doğru çalışıyordu — sadece üst şerit metni hatalıydı.

### 📍 3) Mobile arka plan konum servisi — kapsamlı kalıcılaştırma

**Sorun:** Logcat'te `MiuiMemoryService(cch-empty)` ile servis sürekli öldürülüyordu. JobDetailScreen'den çıkınca da `LocationService.stop` çağrılıyordu → başka iş "Yolda" iken Bekleyen iş açıldığında servis kapanıyordu.

**Yeni dosyalar:**
- `util/LocationGate.kt` — sistem GPS / izin / battery muafiyet kontrol util
- `service/BootReceiver.kt` — cihaz açıldığında aktif iş varsa servisi başlatır
- `presentation/ui/home/HomeTrackingGate.kt` — tracking yaşam döngüsü Composable + ViewModel
- `data/local/dao/JobCacheDao.activeTrackingJobId()` — boot receiver için sorgu

**Manifest:**
- `RECEIVE_BOOT_COMPLETED` + `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` izinleri
- `<receiver android:name=".service.BootReceiver">` + intent-filter

**`PreferencesRepository.batteryOptPromptShown`** flag — bir kez sorulur sonra rahatsız etmez.

**JobDetailScreen.kt bug fix:** `LocationService.stop` çağrısı **kaldırıldı**. Artık:
- `state.activeJob` (Yolda || Fabrikada) varsa → `HomeScreen` LaunchedEffect → start
- `state.activeJob` null olunca → stop
- JobDetail sayfasından çıkmak servisi öldürmez (önceki bug)

**Sistem GPS kapalıysa engelleyici dialog** + Battery muafiyet diyaloğu ilk açılışta.

### 🎨 4) Müşteri takip HTML — eski CSS savaşı

`musteri_takip.html` dosyasının 23. satırındaki `<link rel="stylesheet" href="css/pages/musteri-takip.css">` **kaldırıldı**. Yeni HTML 1000+ satır self-contained inline CSS'le geliyordu, eski stylesheet hero-title'ı `var(--text)` (siyah) yapıyor + `hero-durum.bekliyor` arka planını krem yapıyordu — okunamayan ekran çıkıyordu.

### 🌐 5) Web operasyon realtime kanal otomatik yeniden bağlanma

**Kök sorun:** `app-chunk-05.js` `opsStartRealtime` fonksiyonu `CHANNEL_ERROR/TIMED_OUT/CLOSED` durumunda sadece `console.warn` yazıyor, kanalı yeniden açmıyor → mobile UPDATE'leri DB'ye düşüyor ama web'e yansımıyor → şoför "süreç güncellenmiyor" şikayeti → Ctrl+F5 yapınca düzeliyordu.

**Düzeltme:**
- `_opsConnectChannel()` helper — status callback ile `_opsScheduleReconnect()` çağırır
- Exponential backoff: 1s, 2s, 4s, 8s... max 30s
- Polling fallback 30sn → **10sn**
- `visibilitychange`, `focus`, `online` event listener'ları → kanal yoksa yeniden bağlan + fresh fetch

**Önemli ders:** Mobile UPDATE'leri DB'ye düzgün düşüyordu, baştan beri öyleydi. **Yanlış teşhis koyulmuştu** (mobile'da sessiz fail aranıyordu). `JobRepositoryImpl.performStatusUpdate`'e eklenen `select() + 0-satır error` revert edildi — gereksizdi.

### 💰 6) Harcırah modülü — uzak il otomatik hesaplama (büyük iş)

**4 SQL migration** (sırayla çalıştırılmalı):
1. `2026_05_08c__harcirah_uzak_il_otomatik.sql` — 4 yeni tablo + 81 il seed + RLS
   - `tr_il_bolge` (sistem geneli, 81 il → 7 bölge eşlemesi seed)
   - `harcirah_bolge_tarife` (firma + bölge → km_birim)
   - `harcirah_il_tarife` (firma + il → km_birim VEYA sabit_tutar, bölgeyi override)
   - `harcirah_kural_seti` (firma → dolu/boş %, kademe %, konaklama, minimum)
2. `2026_05_08d__harcirah_uzak_hesap_fonk.sql` — `harcirah_uzak_hesapla()` JSON kalemli + `_tr_il_tespit()` + `_haversine_km()` + `trg_isemri_harcirah_olustur` güncelleme (fallback eklendi)
3. `2026_05_08e__harcirah_km_oneri.sql` — `harcirah_km_birim_oneri()` RPC (yakın tarifelerden bölge × katsayı)
4. `2026_05_08f__harcirah_itiraz_push.sql` — itirazda yönetici/sahip/operasyoncu push trigger

> ⚠️ **PostgreSQL `comment on ... is` operatörü `||` desteklemez.** Migration yazarken comment'ler tek satır literal olmalı. v3'te 4 migration bu yüzden hata verdi, düzeltildi.

**Web UI:**
- `app.html` — 2 yeni sekme paneli (Uzak İller + Ayarlar) + İl modal + Kullanım kılavuzu modal + "💡 Nasıl Kullanılır?" butonu
- `js/pages/harcirah-uzak-iller.js` — yeni IIFE modülü (REST pattern, **`getSB()` DEĞİL**, `window.sbUrl()` + `window.sbHeaders()` + `window.currentFirmaId`)
- `js/pages/harcirah-page.js` `switchHarcirahTab` 2 yeni sekme tetikleyicisi

> ⚠️ **Web pattern dersi:** Mevcut sistem Supabase JS SDK kullanmıyor — REST fetch + `sbUrl`/`sbHeaders` + `window.currentFirmaId`. Yeni JS modülleri yazarken **HarcirahAPI pattern'ini izle** (`harcirah-api.js`).

**Mobile:**
- `HarcirahKaydi.aciklama: String?` field
- `HarcirahKaydiDto.aciklama` mapping
- `JobDetailScreen.HarcirahCard` — mavi info kutucuğunda otomatik hesap notu (📐 emoji)

**Kalibrasyon ölçütü (test edildi):** Aydın 645 km × 7 TL = **4.515 TL** ≈ sektör pratiğindeki 4.500 TL (%99 uyum).

**Bölge varsayılan çarpan tablosu (Türkiye için):**
| Bölge | Çarpan (yakın ortalamaya göre) |
|---|---|
| Marmara | 1.10 |
| Ege | 1.40 |
| Akdeniz | 1.30 |
| İç Anadolu | 1.25 |
| Karadeniz | 1.55 |
| Doğu Anadolu | 1.75 |
| Güneydoğu | 1.65 |

> Yakın bölge ortalaması ~5 TL/km ise: Ege ≈ 7 TL, Karadeniz ≈ 7.75 TL, Doğu ≈ 8.75 TL.

---

## ⏳ AÇIK GÖREV — yeni sohbette başlanacak

### 🎯 OSRM Mesafe Hesaplayıcı Paketi (Paket "C")

Kullanıcı **C alternatifini seçti, B en acil**. İçerik:

#### Alt-Görev B (acil — iş emri formu otomatik km)

**Sorun:** İş açılırken pazarlık başlıyor — yukle/teslim yer seçilince ne kadar km olduğunu işveren bilemediği için tarife belirsizleşiyor.

**Yapılacak:**

1. **Migration:** `2026_05_08g__isemri_tahmini_km.sql`
   ```sql
   alter table public.is_emirleri
     add column if not exists tahmini_km numeric,
     add column if not exists tahmini_sure_dk integer;
   ```

2. **OSRM API entegrasyonu** (frontend):
   - Endpoint: `https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=false`
   - CORS açık, ücretsiz, Türkiye iyi destek
   - Response: `routes[0].distance` (metre) + `routes[0].duration` (saniye)
   - Helper'ı `js/integrations/osrm-helper.js` olarak ayır (yeni dosya)
   - Cache: aynı koordinat çiftleri için localStorage 24 saat

3. **Web — yeni operasyon iş emri formu:**
   - `app-chunk-05.js` içinde "Yeni Operasyon" formu (`open*Modal` veya benzeri)
   - yukle_yeri/teslim_yeri için autocomplete + Nominatim ile koordinat çekimi
   - Koordinatlar belli olunca otomatik OSRM çağrısı → `tahmini_km` kolonuna yaz
   - UI: form altında **"📍 Tahmini: 645 km · ~7 saat 12 dk · Harcırah ~4.515 TL"** badge
   - "Harcırah ~4.515 TL" hesabı için frontend `harcirah_uzak_hesapla` RPC'sini çağırabilir

4. **Trigger güncelleme:** `harcirah_uzak_hesapla` fonksiyonu zaten `p_yukle_lat/lng + p_teslim_lat/lng` kabul ediyor. **Daha hassas mesafe için iş emrindeki `tahmini_km` öncelikli olsun:**
   ```sql
   v_km := COALESCE(NEW.tahmini_km, public._haversine_km(...));
   ```

#### Alt-Görev A (hızlı — standalone hesaplayıcı)

**Konum:** Harcırah modülünde 7. sekme: **🧮 Mesafe Hesabı**

```
┌─ Mesafe Hesabı ─────────────────────────────┐
│ Yükleme:  [_______________] 🔍 (Nominatim)  │
│ Teslim:   [_______________] 🔍              │
│ [Hesapla]                                   │
│                                             │
│ 📍 645 km · ~7 saat 12 dakika              │
│ 💰 Tahmini harcırah: 4.515 TL              │
│   (Ege bölgesi · 7 TL/km — Otomatik hesap) │
│ [İl tarifesine ekle]  [İş emri aç]         │
└─────────────────────────────────────────────┘
```

İki buton:
- **"İl tarifesine ekle"** → ilgili il için harcirah_il_tarife önerisi
- **"İş emri aç"** → form'u yukle/teslim doldurulmuş halde aç

#### Alt-Görev C-mobil (orta seviye — şoför detayında gerçek karayolu km)

`JobDetailScreen.HarcirahCard`'da şu an haversine ile yaklaşık km görünüyor. `is_emirleri.tahmini_km` dolu olunca **gerçek karayolu km** gösterilsin. JobOrder DTO + cache + mapper güncellemesi gerekir.

**Mobil cache version:** Room v9 → **v10**'a artırılmalı (`fallbackToDestructiveMigration` aktif olduğu için sorunsuz).

#### Bonus

- Nominatim için günlük ~1 istek limiti **abuse policy** (https://operations.osmfoundation.org/policies/nominatim/) — yoğun kullanımda kendi instance'ı veya Mapbox/Google'a geçiş düşünülebilir. Şimdilik OK.
- OSRM için aynı: public router yoğun saatlerde 503 dönebilir → fallback olarak haversine devreye girsin.

---

## 🚀 Yeni sohbette ilk eylem

1. **Bu prompt'u oku.**
2. Kullanıcıya: **"v3 + v4 handoff'u devraldım. Açık görev: OSRM mesafe paketi (B alt-görev önce). Migration `2026_05_08g__isemri_tahmini_km.sql` ile başlayayım mı?"** diye sor.
3. Onay alınca:
   - **Önce migration** (`is_emirleri.tahmini_km` + `tahmini_sure_dk`)
   - **Sonra `js/integrations/osrm-helper.js`** (yeni dosya, OSRM + Nominatim helper)
   - **Sonra iş emri formu entegrasyonu** (`app-chunk-05.js`)
   - **Sonra `harcirah_uzak_hesapla` küçük güncelleme** (NEW.tahmini_km öncelikli)
   - **Sonra standalone hesaplayıcı sekmesi** (`harcirah-uzak-iller.js`'e veya yeni dosyaya)
   - **En son mobile** (cache v10 + JobOrder DTO + UI gösterim)

## ⚠️ Dikkat edilecek mimari kararlar (v3'ten devralındı + bu turda eklenenler)

### Web JS pattern (kritik)
- ❌ `getSB()` veya `supabase.from()` kullanma (SDK yüklü değil)
- ✅ `window.sbUrl(path)` + `window.sbHeaders()` + `fetch()`
- ✅ Aktif firma: `window.currentFirmaId`
- ✅ UPSERT için `Prefer: resolution=merge-duplicates,return=representation`
- Pattern referansı: `harcirah-api.js`, `harcirah-uzak-iller.js`

### Mobile sürücü self-write (kritik)
- ❌ Direkt UPDATE atma — RLS engeller (sessiz)
- ✅ SECURITY DEFINER RPC ekle, RPC çağır
- Mevcut RPC'ler: `surucu_fcm_token_kaydet`, `surucu_push_subscription_kaydet`, `surucu_son_giris_guncelle`, `surucu_profil_guncelle`

### PostgreSQL `comment on ... is` (önemli tuzak)
- ❌ `comment on ... is 'çok' || ' satır';`  → syntax error
- ✅ Tek satır literal: `comment on ... is 'tek satır metin';`

### Mobile UPDATE'ler DB'ye düşüyor (yanlış teşhis tuzağı)
- v3'te "süreç güncellenmiyor" şikayeti çıktı, mobile'da sessiz fail arandı
- **Gerçek sorun web realtime kanalı kopmasıydı** — mobile UPDATE her zaman çalışıyordu
- Yeni şikayetlerde önce **DB'de gerçekten güncellenmiş mi?** SQL ile bak. Güncellenmişse sorun **web tarafında**.

### Tracking yaşam döngüsü
- `LocationService.start/stop` SADECE `HomeScreen.HomeTrackingGate` Composable'ı yönetir
- JobDetailScreen `start` çağırabilir (izin akışı), ama `stop` ÇAĞIRMAZ
- `state.activeJob` (Yolda || Fabrikada) → tracking aktif

### MIUI / Xiaomi sahaya çıkmadan
- Pil tasarrufu muafiyeti otomatik istenir
- Otomatik başlatma izni MIUI'da API'den açılamıyor — kullanıcıya manuel söylenir
  - Ayarlar → Uygulamalar → Fleetly → Otomatik başlatma: AÇIK

---

## SQL migration sırası (v3 sonu + bu tur eklemeleri)

v3'tekiler aynen + bu turda eklenenler:

```
... (v3 listesi) ...
2026_05_08__alim_yapildi_durum.sql                    ← v3
2026_05_08b__surucu_fcm_token_rpc.sql                 ← v3 sonu
2026_05_08c__harcirah_uzak_il_otomatik.sql            ← bu tur
2026_05_08d__harcirah_uzak_hesap_fonk.sql             ← bu tur
2026_05_08e__harcirah_km_oneri.sql                    ← bu tur
2026_05_08f__harcirah_itiraz_push.sql                 ← bu tur
2026_05_08g__isemri_tahmini_km.sql                    ← AÇIK GÖREV (yapılacak)
```

**Cache: Room v9 (mobile).** Açık görevde v10'a artırılacak.

---

## Saha test durumu (kullanıcı)

✅ Çalışıyor, doğrulandı:
- FCM push (yönetici→şoför) — saha onayı: "geldi şimdi allah razı olsun"
- Mobile→DB UPDATE (Yola Çıktım vs.) — DB'de doğru görüldü
- Manuel harcırah yakın tarife giriş

⏳ Kullanıcı kuracak / test edecek:
- Web operasyon realtime auto-reconnect (Ctrl+F5'te aktif)
- Pil muafiyet diyaloğu (yeni APK'da test)
- BootReceiver (cihaz reboot testi)
- Harcırah uzak il otomatik hesabı (test iş emri Aydın'a)
- Kullanım kılavuzu modal'ı

🎯 Yeni sohbette başlanacak:
- OSRM Mesafe Hesaplayıcı paketi (Paket C, B önce)

---

## Kullanıcı çalışma stili (v3'ten devam)

- Türkçe konuşur
- Hata raporlarında ekran görüntüsü + JSON/console paylaşır
- Migration'ları kendisi Supabase Dashboard SQL Editor'a yapıştırarak çalıştırır
- Mobile'ı Android Studio'dan Run'la test eder
- Web'i Ctrl+F5 ile cache tazeleyerek test eder
- "İlk önce şu sorunu çöz, sonra yenisine geç" sıralı çalışır
- Bazen migration uygulamadığını sandığı şeyleri zaten uygulamıştır — önce sor
- Plan/scope sorduğunda "hepsini yap" cevabı verirse otonom devam beklenir
- "Çalışan uygulama çalışmaz oldu" şikayetinde panik etme — büyük ihtimalle eskiden de bozuktu, gizliydi
