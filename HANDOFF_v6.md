# Fleetly — Claude Code Handoff Prompt v6 (2026-05-13)

> **Yeni Claude Code sohbetine giriş prompt'u.**
>
> İki repo:
> - `C:\Users\cihan\Desktop\Fleetly-main` — Web yönetici paneli (vanilla HTML/CSS/JS)
> - `C:\Users\cihan\Desktop\Fleetly-Android` — Native Kotlin + Jetpack Compose + Hilt + Room + Supabase
>
> Önce projenin **`CLAUDE.md`** dosyasını oku, sonra bu handoff'u, sonra `HANDOFF_v5.md`'yi (v5 turunda bitmemiş açık görevler aşağıda tekrar edilmiştir).

---

## v5 → v6 (2026-05-13): bu turda yapılanlar

### 🛰️ Şoför GPS / Konum İzleme Revizyon Turu (büyük revizyon)

**Kullanıcı şikayeti:**
> "Şoför konum verisi sağlıklı alınamıyor, güzergah yanlış gösteriyor, hız verisi yanlış. Fabrikadan limana gittim, limanda 3-4 saat dolandım, eve döndüm — sadece ana yollardan geçtiğimi gösteriyor, **liman içi dolaşmaları kayıt bile olmamış**. 90 km/h ile giderken uygulamaya baktığımda **280 km/h** yazıyordu."

**Kök nedenler (3 paralel agent ile uçtan uca tespit):**

1. **Tracking lifecycle eksik** — `LocationService` sadece `Yolda || Fabrikada` durumunda aktifti. Şoför limana varıp `BosAlindi`/`AlimYapildi` (ara durak) durumuna geçtiğinde **GPS servisi tamamen kapanıyordu** → liman içi 3-4 saat dolaşma kayıt dışı. CLAUDE.md'de "ara durakta tracking durur" tasarım kararı vardı, saha gerçeğiyle çatışıyordu.
2. **GPS outlier filtresi 3 katmanda da yok** — Mobile native `Location.getSpeed()` direkt 3.6×'la çarpılıp yazılır (filter yok), backend RPC `sofor_konum_gonder` sadece negatifi 0'a çekiyordu, `filo_trafik_grid` trigger'ı >200 km/h'yi grid'e yazmıyordu **ama `konum_izleri` tablosuna YAZILMIŞTI**. GPS Doppler hatası 90→280 km/h sıçramasının nedeni.
3. **Web polyline simplification ham** — `_opsOsrmMatch` 90 nokta sınırı için basit N-step decimation (Douglas-Peucker değil), liman içi yan asfalt dolaşmaları kırpılıyordu.
4. **Offline queue yok** — RPC fail olunca sample buharlaşıyordu (kapsama dışı / hücre değişimi).

---

### Paket 1 — Android tracking lifecycle (kök sebep)
- `JobStatus.isTracked: Boolean get() = Yolda || Fabrikada || BosAlindi || AlimYapildi`
- `HomeViewModel.activeJob` → `firstOrNull { it.durum.isTracked }` (eski: `Yolda || Fabrikada`)
- `JobDetailViewModel.shouldTrackGps` — 3 yerde `isTracked` (init load, merge, optimistic status update)
- `JobCacheDao.activeTrackingJobId` SQL → `IN ('Yolda','Fabrikada','Boş Alındı','Alım Yapıldı')` (BootReceiver da limanda olan şoförü tekrar başlatır)
- `JobStatus.kt` yorumları güncellendi (BosAlindi/AlimYapildi artık tracking durdurmaz, eski tasarım notu silinmedi sadece "2026_05_13: artık AÇIK kalır" ile genişletildi)

### Paket 2a — Android `LocationService` outlier guard
- `ACCURACY_MAX_METERS = 50f` → 50m+ doğruluklu fix REDDEDİLİR (multipath / GPS warm-up)
- `JUMP_MAX_KMH = 180f` → önceki noktayla implied hız 180 km/h üstü ise REDDEDİLİR; **reddedilen sample'da `lastLocation` GÜNCELLENMEZ** → bir sonraki gerçek sample doğru baz alır
- `SPEED_CAP_KMH = 180f` → hem native `Location.getSpeed()` hem fallback haversine clamp altında. Native cap üstündeyse fallback'e geçiş yapar (önceden filtresizdi)
- Log etiketleri: `[GPS filter]`, `[GPS jump]`, `[speed cap]` (saha teşhisi için)

### Paket 2b — Backend `2026_05_13a__konum_outlier_guard.sql`
- `sofor_konum_gonder` RPC güncellendi:
  - `p_dogruluk > 100m` → REJECT (errcode 22023)
  - `p_hiz > 50 m/s (180 km/h)` → `v_hiz = NULL` (konum kabul, hız temizlenir)
- Yeni `trg_konum_izleri_outlier_guard` BEFORE INSERT trigger — doğrudan INSERT (anon link, eski client, manuel migration) için yedek savunma
- DOĞRULAMA bölümünde mevcut bozuk veri sayım sorgusu (silmiyoruz; manuel `update konum_izleri set hiz = null where hiz > 50` ile temizlenebilir)

### Paket 3 — Web Douglas-Peucker + time chunking
- `js/pages/app-chunk-05.js`:
  - `_opsDouglasPeucker(points, tolerance)` — Heron formula tabanlı JS port, O(N log N) ortalama
  - `_opsTimeChunks(samples, gapMs=5min)` — zamansal gruplama helper'ı
  - `_opsOsrmMatch` decimation: step → **DP (tolerance 10m)**, step decimation yedek
- `js/pages/app-chunk-surucu-takip.js`:
  - Sample'lar `_opsTimeChunks` ile 5dk+ ara'da bölünür
  - **Her chunk ayrı OSRM match** — snapped olanlar solid mavi, fail olanlar ham dashed
  - Liman içi 3-4 saatlik bekleme = ayrı chunk → OSRM sapma >75m → otomatik ham GPS gösterilir
- SW cache: v28 → **v29**

### Paket 4a — Android offline location queue
- `PendingActionEntity.TYPE_LOCATION_PUSH` constant eklendi (**Room schema değişmedi** — sadece yeni type, mevcut `pending_sync_queue` tablosu kullanılır)
- `LocationRepositoryImpl`:
  - `SyncManager` inject
  - RPC fail → `syncManager.enqueue(PendingActionEntity(TYPE_LOCATION_PUSH, ...))`
  - `is_emirleri.konum_lat/lng/zaman` UPDATE'i SADECE RPC başarılıysa yapılır (replay yarış engellenir)
- `PendingSyncWorker`:
  - `SupabaseClient` inject (LOCATION_PUSH replay için)
  - `TYPE_LOCATION_PUSH` case eklendi
  - **Replay'de `p_is_emri = null` geçilir** — `is_emirleri.konum_*`'a dokunulmaz (eski replay sample fresh sample'ı yarış sonucu ezmesin). Sample sadece `konum_izleri` history'sine kaydolur (is_emri_id NULL → o sample'lar geçmiş güzergah view'da görünmez ama analytics akar)
- 10 retry sonra prune (mevcut Worker davranışı)

### Paket 4b — `2026_05_13b__konum_izleri_realtime.sql`
- `konum_izleri` supabase_realtime publication'a eklendi
- Web canlı takip için altyapı hazır (subscribe Faz 5+'ta)
- Idempotent pattern (`2026_05_11j`'deki gibi `duplicate_object` exception yutulur)

### 🚫 Bu turda bilerek atlananlar
- **Liman polygon içinde grid hücre incelmesi (50m)** — saha şikayetiyle direkt alakası yok, ana sorun Paket 1+2 ile çözüldü; aşırı mühendislik
- **Web hız renklendirme outlier marker** — mobile + backend filtre yeterli; geçmiş kayıtlardaki bozuk değerler audit query ile manuel temizlenebilir
- **Bekliyor durumunda tracking aç** — atlandı; tek aktif iş seçimi ambiguous olur (birden fazla Bekliyor mümkün), şoför "Yola Çıktım" demeden konum yararsız

---

## ⏳ AÇIK GÖREVLER — saha doğrulaması + v5 kalanları

### 🎯 1) **Saha testi (kullanıcı)** — ÖNCELİK 1
1. **APK rebuild**: Android Studio `Build → Clean Project → Rebuild Project`, cihaza yükle
2. **Web cache**: Ctrl+Shift+R (SW v29 cache yenile)
3. **Migration'ları SQL Editor'da çalıştır**:
   - `2026_05_13a__konum_outlier_guard.sql`
   - `2026_05_13b__konum_izleri_realtime.sql`
4. **Test senaryosu**:
   - Yolda → "Boş Aldım" geçişi yap, **konum izleme bildiriminin sabit kaldığını** doğrula (foreground service notification görünür)
   - Limanda 30dk+ dolaşma simülasyonu (yürüyerek olabilir)
   - Web sürücü-takip sayfasında **liman içi yan dolaşmalar** görünmeli (ham GPS, dashed) + ana yol kısmı snapped solid
   - Hız okuması bir kez bile 200 km/h üstüne çıkmamalı (filter testi)
5. **Bozuk geçmiş veri temizleme (opsiyonel)**:
   ```sql
   select count(*), max(hiz)*3.6 from konum_izleri where hiz > 50;  -- önce bak
   update konum_izleri set hiz = null where hiz > 50;                 -- isteğe bağlı
   ```

### 🎯 2) v5 turundan kalan açık görevler (henüz dokunulmadı)
- **Drawer "Yükleniyor..." kök sebep** — defansif setTimeout fix uygulandı, kök neden açık (`_opsDrawerRender` sıralı çağrılarında hangi adım silent fail ediyor?)
- **Diğer sayfaların aynı pattern** — Ekip Yönetimi / Belge / Arıza: muhtemelen `currentFirmaId` null race (HTTP 400 `firma_id=eq.null`)
- **Evrak Hazır push doğrulama** — yeni iş #73 push gelmedi şikayeti, FCM token / bildirimler / Edge Function zinciri test edilmeli
- **Service worker install hatası** — `[SW] hatası: TypeError ... installation` — APP_SHELL audit gerek (var olmayan asset?)

### 🎯 3) GPS revizyon ileri iyileştirmeler (öncelik düşük)
- **Web realtime subscribe** — Operasyon canlı takip sayfası `konum_izleri` INSERT'lerine subscribe edip polyline'a online ekleme (alt yapı v6'da hazır, şimdi polling)
- **Outbox sample TTL** — Şoför uzun süre kapsama dışı kalırsa outbox şişer; 30dk+ eski sample'ları prune et (PendingSyncWorker'da)
- **Liman polygon görselleştirme** — operasyon canlı takipte polygon çiz (DB'de var, görselleştirme yok)
- **Geçmiş bozuk veri purge** — `update konum_izleri set hiz = null where hiz > 50` (kullanıcı talep edince)

---

## ⚠️ Yeni öğrenilen tuzaklar (CLAUDE.md'ye eklenebilir)

### a) Tracking lifecycle "ara durak" tasarım kararı saha realitesiyle çatışır
Şoför limana varır → ara durağa (BosAlindi/AlimYapildi) geçer → 3-4 saat liman içinde dolanır. Eski kod tracking'i kapatıyordu (DECISIONS.md'de "ön-faz / dinlenme" gerekçesi). Saha realitesinde **liman içi her hareket önemli** (KVKK + sigorta + operasyon planlama). Yeni kural: tracking SADECE terminal durumlarda (TeslimEdildi, Iptal) ve `Bekliyor`'da kapanır. `JobStatus.isTracked` helper'ı tüm kararları merkezleştirdi.

### b) `JobStatus.isTracked` + `JobCacheDao` SQL listesi senkron tutulmalı
İki yerde aynı küme: Kotlin enum extension (`isTracked`) ve Room `@Query` SQL string (`IN ('Yolda','Fabrikada','Boş Alındı','Alım Yapıldı')`). Birinde durum eklenir/çıkarılırsa diğerinde de güncellenmeli (BootReceiver yanlış davranır).

### c) GPS outlier 3 katmanda defansif olmalı
Tek bir katmana güvenmek yeterli değil:
- **Mobile**: ham GPS hatalı (Doppler, multipath, hücre kulesi atması) — burada yakalanırsa ağa hiç gönderilmez
- **Backend RPC**: anon link / eski client / mobile filter bypass — yedek savunma
- **Backend trigger**: doğrudan INSERT (manuel migration vs.) için son katman

### d) Outbox replay'de live UPDATE'ler yarışmamalı
Offline sample'ların replay'i sırasında `is_emirleri.konum_*` UPDATE'i fresh sample'la yarışırsa eski konum kazanır (kısa süreli operasyon yanlış görür). Çözüm: replay'de `p_is_emri = null` (sample sadece `konum_izleri` history'sine yazılır). Trade-off: o sample'lar geçmiş güzergah view'da görünmez (is_emri_id NULL).

### e) Web polyline simplification: Douglas-Peucker > step decimation
Step decimation (her N. nokta) köşeleri kaybeder. DP tolerance'ı dönüş şiddetine göre noktalar seçer — kentsel/liman içi dolaşmalarda detayı korur, doğrusal otoban kısımlarında nokta sayısını düşürür. OSRM 100 nokta sınırı için DP + step decimation kombosu güvenli.

### f) Time-based chunking uzun bekleme senaryolarında zorunlu
Liman içi 3-4 saatlik bekleme → tek bir polyline'da gösterilirse "limana giden + limandan dönen" izler düz bir çizgi gibi birleşir. 5dk+ boşluk varsa polyline'ı böl (her chunk ayrı OSRM match). `_opsTimeChunks` helper'ı bunu yapıyor.

---

## 📦 Migration sırası (v5 sonu + bu tur)

```
… (v3+v4+v5 listesi: 2026_05_12'ye kadar)
2026_05_13a__konum_outlier_guard.sql          ← bu tur (RPC + trigger)
2026_05_13b__konum_izleri_realtime.sql        ← bu tur (realtime publication)
```

**Cache:** Room v11 — **DEĞİŞMEDİ** (TYPE_LOCATION_PUSH için sadece yeni const, schema aynı).
**Service worker:** v28 → **v29** (web JS değişiklikleri için bump zorunlu).

---

## 🧭 Kullanıcı çalışma stili (devamlılık)

- **Türkçe konuşur**, kısa-net cevaplar bekler
- Büyük değişiklikler için **mutlaka önce plan paylaş**
- "Plan/scope sorduğunda 'hepsini yap' otonom devam onayıdır"
- Migration'ları **kendisi** Supabase Dashboard SQL Editor'a yapıştırır
- Saha testi: Ctrl+Shift+R (web) / Android Studio Run (mobile)
- "Geldi şimdi allah razı olsun" tarzı doğrulama bekler
- `git push`, force operasyonları **mutlaka** önce sor

---

## 🚀 Yeni sohbette ilk eylem

1. **`Fleetly-main/CLAUDE.md`'yi oku** — proje yönergesi (pattern, schema, RPC listesi)
2. **Bu dosyayı (`HANDOFF_v6.md`) oku** — GPS revizyon turu durumu
3. Gerekirse **`HANDOFF_v5.md`** — v5'ten kalan görevlerin tam bağlamı
4. Kullanıcıya: **"v6 handoff'u devraldım. GPS revizyon turu kod tarafında tamam — saha testi bekliyor (migration + APK rebuild + Ctrl+Shift+R). v5'ten devam eden 4 görev var: drawer kök sebep / diğer sayfaların firma_id race / evrak hazır push doğrulama / SW install fix. Saha testi sonucunu mu bekleyelim, yoksa v5 kalanlarından birine geçelim mi?"** diye sor

---

## 📚 Referans dosyalar (bu turla alakalı)

### Web (Fleetly-main/)
- `service-worker.js` — CACHE_NAME v29
- `js/pages/app-chunk-05.js` — `_opsDouglasPeucker`, `_opsTimeChunks`, `_opsOsrmMatch` revize
- `js/pages/app-chunk-surucu-takip.js` — time chunking + chunk-bazlı OSRM match
- `css/db/migrations/2026_05_13a__konum_outlier_guard.sql` — RPC + trigger
- `css/db/migrations/2026_05_13b__konum_izleri_realtime.sql` — realtime publication

### Android (Fleetly-Android/)
- `domain/model/JobStatus.kt` — `isTracked` helper + güncellenmiş yorumlar
- `presentation/ui/home/HomeViewModel.kt` — `activeJob` getter
- `presentation/ui/job/JobDetailViewModel.kt` — `shouldTrackGps` 3 yer
- `data/local/dao/JobCacheDao.kt` — `activeTrackingJobId` SQL
- `service/LocationService.kt` — outlier filter (accuracy/jump/speed cap)
- `data/local/entity/PendingActionEntity.kt` — TYPE_LOCATION_PUSH
- `data/repository/LocationRepositoryImpl.kt` — SyncManager inject + outbox
- `service/sync/PendingSyncWorker.kt` — LOCATION_PUSH replay case

---

**Bu turun teması:** Saha şikayetinden başlayıp 4 katmanda (Android tracking + filter, Backend outlier guard, Web polyline simplification, Offline queue) defansif iyileştirme. Mimari karar değişti: ara duraklarda tracking artık AÇIK. Outbox pattern'i konum sample'larına genişledi (Room schema değişikliği olmadan — TYPE_LOCATION_PUSH constant'la).
