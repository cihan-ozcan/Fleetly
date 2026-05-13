# Fleetly — Claude Code Handoff Prompt v5 (2026-05-12)

> **Yeni Claude Code sohbetine giriş prompt'u.**
>
> İki repo:
> - `C:\Users\cihan\Desktop\Fleetly-main` — Web yönetici paneli (vanilla HTML/CSS/JS)
> - `C:\Users\cihan\Desktop\Fleetly-Android` — Native Kotlin + Jetpack Compose + Hilt + Room + Supabase
>
> Önce projenin **`CLAUDE.md`** dosyasını oku (proje yönergesi tüm pattern'leri içerir). Sonra bu handoff'u.
> v3/v4'teki tamamlananlar burada tekrar edilmiyor — sadece **v4 sonrası bu turda (2026-05-11/12)** eklenenler + **açık görevler**.

---

## v4 → v5: bu turda (2026-05-11/12) yapılanlar

### 🚛 1) Şoför Güzergah Paylaşım Sistemi (büyük modül)

TIR için doğru bilinen yolları şoför firma içi paylaşır. Yeni iş emri aynı hedefe gelince başka şoför Google Maps'le navigasyon başlatır.

**Backend:**
- `2026_05_11j__guzergahlar_schema.sql` — 3 tablo (`guzergahlar`, `guzergah_kullanim_log`, `guzergah_begeniler`) + 6 indeks + PostGIS generated `bitis_geo` (ST_DWithin için) + RLS (sadece SELECT firma içi) + realtime publication
- `2026_05_11k__guzergahlar_rpc.sql` — 5 SECURITY DEFINER RPC:
  - `guzergah_olustur(...)` — şoför paylaşım yaratır, spam guard 60sn/3
  - `guzergah_hedef_oner(lat, lng, radius_m=500)` — ST_DWithin geography, sıralı
  - `guzergah_kullanildi(id, is_emri_id)` — sayaç +1
  - `guzergah_begen(id)` — toggle, yeni durumu döner
  - `guzergah_durum_degistir(id, durum, not)` — yönetici onay/red

**Tasarım kararı:** Cross-firma `gizlilik='platform'` opsiyonu **reddedildi**. Enum'da kalır ama UI'da kapalı. RLS sadece firma içi. (Memory: `project_guzergah_cross_firma_reddedildi.md`)

**Android (yeni klasör `presentation/ui/guzergah/`):**
- 15 yeni dosya: Domain (Guzergah, GuzergahRepository), Data (DTO, RepositoryImpl), Util (PolylineEncoder Google algoritması, PolylineSimplify Douglas-Peucker, GoogleMapsIntent)
- 3 ekran: `GuzergahPaylasScreen` + ViewModel, `GuzergahListScreen` + ViewModel, `GuzergahDetayScreen` + ViewModel
- Component: `GuzergahKart`
- `JobDetailGuzergahBolumu` — JobDetailScreen'e gömülen Composable (tamamlanmış işte paylaş butonu, aktif işte öneri banner)
- Düzenlenenler: `RepositoryModule` (Hilt bindGuzergah), `PreferencesRepository` (KVKK onam flag), `JobDetailScreen` (2 callback), `AppNavGraph` (3 yeni route)

**Web:**
- `js/integrations/guzergah-api.js` — REST pattern (window.sbUrl + sbHeaders + fetch)
- `js/pages/guzergahlar-page.js` — yönetici moderasyon sayfası (fullscreen overlay)
- `css/pages/guzergahlar.css`
- `app.html`'e sidebar nav öğesi + CSS link + script tag

---

### 🌐 2) URL refactor (.html → klasör pattern, profesyonel URL'ler)

Kullanıcı `.html` uzantıları profesyonel görünmüyor diye **B seçeneği** (temiz geçiş) seçti. 12 statik HTML dosyası klasör pattern'ine taşındı.

| Eski | Yeni |
|---|---|
| `app.html` | `/app/` |
| `admin.html` | `/admin/` |
| `musteri_takip.html` | `/takip/` |
| `portal.html` | `/portal/` |
| `register.html` | `/kayit/` |
| `sofor.html` | `/sofor/` |
| `sofor-profil.html` | `/profil/` |
| `reset-password.html` | `/sifre-sifirla/` |
| `accept-invite.html` | `/davet/` |
| `abonelik-sonuc.html` | `/abonelik/` |
| `kvkk-aydinlatma.html` | `/kvkk/` |
| `kullanim-sartlari.html` | `/kullanim/` |
| `index.html` | `/` (değişmedi) |

**Yapılanlar:**
1. 13 HTML'de relative path'ler absolute hale getirildi (`css/...` → `/css/...`, `js/...` → `/js/...`, vb.) — PowerShell ile toplu replace
2. 12 dosya klasör pattern'ine taşındı (`Move-Item`)
3. **51 dosyada** `.html` referansları yeni URL'lere dönüştürüldü (HTML, JS, CSS, Edge Functions, sitemap.xml, robots.txt, manifest.json, service-worker.js, config.js)
4. `service-worker.js` CACHE_NAME v24 → v25 → v26 → v27 → v28 (her büyük JS değişikliğinde bump)
5. **Migration `2026_05_11l__url_yapisi_temizleme.sql`** — pg_proc taraması ile DB içindeki RPC/trigger fonksiyon body'lerindeki hardcoded URL'leri otomatik günceller (davet email link, harcırah itiraz push URL, vb.). Her fonksiyon definition'ı string replace + EXECUTE ile yeniden yaratılır.
   - İlk versiyon `array_agg is an aggregate function` hatası verdi → düzeltildi: sadece `prokind = 'f'` (normal function) tara, her def çağrısı exception ile sarılı.

**Kabul edilen risk (B seçeneği):** Eski sent davet/şifre email link'leri kırıldı. Yeni davetler doğru URL gider.

---

### 📋 3) Evrak Hazır Bayrağı (operasyon kontrol)

**Problem:** Operasyon yeni iş emri açtığında şoför mobile "Hazırlanıyor" sekmesinde görüyor ve **hemen "Yola Çıktım" diyebiliyordu**. Ama gümrük evrakı, mühür no gibi işler henüz tamamlanmamış olabiliyor. Operasyon "hazır" deyene kadar şoför yola çıkmamalı.

**Migration `2026_05_12a__evrak_hazir_at.sql`:**
- Yeni kolon: `is_emirleri.evrak_hazir_at timestamptz` (NULL = hazırlanıyor, dolu = hazır)
- Backfill: mevcut tüm işler `coalesce(atama_zamani, created_at, now())` ile dolduruldu — geçişin kesintisiz olması için
- 2 RPC: `is_emri_evrak_hazir_isaretle(id)`, `is_emri_evrak_hazir_geri_al(id)` (SECURITY DEFINER + `_user_firma_yetkili_ids` yetki kontrolü)
- 2 trigger:
  - `trg_isemri_evrak_hazir_kontrol` — BEFORE UPDATE; durum Bekliyor→Yolda geçişinde `evrak_hazir_at IS NULL` ise reddet (mobil hile yapılsa bile DB garanti verir)
  - `trg_isemri_evrak_hazir_push` — NULL→dolu geçişinde şoföre **yüksek öncelikli push**

**Web (`app-chunk-05.js`):**
- Kanban Bekliyor kartlarında `✅ Hazır` veya `⏳ Hazırlanıyor` pill rozeti (`opsBuildContainerCard`'da)
- Drawer "Detaylar" sekmesinde `📋 Evrak Durumu` satırı + duruma göre "✓ Hazır İşaretle" (yeşil) veya "↩ Geri Al" butonu (sadece Bekliyor iken)
- Global `opsEvrakHazirIsaretle(id)` ve `opsEvrakHazirGeriAl(id)` — local state güncelleyici, RPC çağrılı (`opsRenderKanban` öncesinde tanımlı)

**Android:**
- `JobOrder.evrakHazirAt: Instant?` field
- `JobOrderDto`, `JobCacheEntity`, `Mappers`, `CacheMappers` — `evrak_hazir_at` mapping
- `FleetlyDatabase` v10 → **v11** (fallbackToDestructiveMigration aktif)
- `HomeViewModel` — sekme adı **"Bekleyen"** + 2 yeni computed: `pendingJobsHazir`, `pendingJobsHazirlaniyor`
- `HomeScreen` — sekme label "Bekleyen" + iki bölümlü liste:
  - 🟢 **Hazır — yola çıkabilirsin** (üst, vurgulu)
  - ⏳ **Operasyon hazırlıyor — biraz bekle** (alt, soluk `alpha 0.55`)
- `JobDetailScreen` — primary CTA `evrakHazirAt == null` ise gri/disable + label "⏳ Evraklar Hazırlanıyor" + altında "📋 Operasyon evrak hazırlığını tamamlamalı — biraz bekle"
- "Aktif" sekmesindeki "Sıradaki" iş sadece **hazır olanlardan** seçiliyor (hazırlanıyor olanı "sıradaki" göstermek yanıltıcı)

---

### 🐛 4) Bu turun bug fix'leri

**a) Drawer widget'ları "Yükleniyor..." kilitli kalıyordu** (operasyon iş detayında):
- `_opsDrawerRender` içinde sıralı async çağrılar (`opsBenzerSeferleriYukle`, `opsDrawerMasrafYukle`, `_opsDrawerHarcirahRender`) — biri **sync hata** atarsa diğerleri atlanıyordu, "Yükleniyor..." DOM'u kalıyordu. F5 ile düzeliyordu.
- **Çözüm:** `openOpsDrawer` içine **defansif setTimeout 120ms** — widget'ları drawer dışından `Promise.resolve().then(...).catch(...)` ile garanti tetikle. Hata loglanır (`console.info '✓'` veya `'✗'`), sessiz yutulmaz.
- **Kök sebep tam belirlenmedi** — defansif fix ile semptom çözüldü. (Aşağıdaki açık görevler listesinde.)

**b) `body.style.overflow = 'hidden'` kalıcı kilitleniyordu:**
- `openGuzergahlarPage` (benim eklediğim) ve `openLimanlarPage` page açılışında `body.style.overflow='hidden'` set ediyordu. X butonuna basmadan başka sidebar item'ına geçildiğinde scroll kilitli kalıyordu → Operasyon kanban'ı scroll edemiyordu.
- **Çözüm:** İki dosyada da `body.style.overflow='hidden'` satırı kaldırıldı. Page zaten `position:fixed; inset:0` overlay olduğu için body kilidi gereksiz. `closeXxxPage` yine de `''` reset eder (yedek).

**c) `opsSaveLocal` localStorage quota dolu olunca çöküyordu:**
- Hızlı müşteri ekleme + yeni iş emri kaydetme `DOMException: The quota has been exceeded` ile fail oluyordu (Cihan'ın tarayıcısında biriken cache).
- **Çözüm:** `opsSaveLocal` 3 kademeli defansif:
  1. Normal kayıt
  2. Quota dolarsa: aktif işler + son 50 tamamlanmış kayıt tut (eski kapalı işleri kırp)
  3. Hâlâ dolarsa: sadece aktif işler
  4. En kötü: `removeItem` ile sil (bellekte kayıt durur, F5 sonra DB'den fresh gelir)

**d) `opsRowToObj` `evrak_hazir_at` field'ını okumuyordu:**
- DB satırını uygulama objesine dönüştüren `opsRowToObj` her field tek tek listede. Yeni `evrak_hazir_at` kolonu ekleme unutulmuş → DB'de dolu olsa bile frontend'de `e.evrak_hazir_at = undefined` → kart "⏳ Hazırlanıyor" gözüküyordu (F5 sonrası da).
- **Çözüm:** `opsRowToObj`'a `evrak_hazir_at: r.evrak_hazir_at || null` satırı eklendi.

**e) `parseInstant` Postgres timestamp varyantlarını parse edemiyordu (Android):**
- Java `Instant.parse()` strict ISO 8601 ister: `"2026-05-12T11:06:07.048984+00:00"`.
- PostgREST bazen `"2026-05-12 11:06:07.048984+00"` döndürüyor (boşluk separator + 2 haneli kısa offset).
- Bu varyant parse fail → `evrakHazirAt = null` → mobile "Hazırlanıyor" gösteriyordu (DB'de dolu olduğu halde).
- **Çözüm:** `Mappers.kt` `parseInstant` 4 kademeli fallback:
  1. Strict ISO 8601
  2. Boşluk → T + `+HH` → `+HH:00` normalize
  3. OffsetDateTime ile esnek parse
  4. Offset yoksa UTC kabul
- Bu fix `atamaZamani`, `konumZaman`, `gumrukMuhurZaman` gibi tüm timestamp field'larını da etkiler — sağlamlık genel.

---

## ⏳ AÇIK GÖREVLER — yeni sohbette başlanacak

### 🎯 1) Drawer "Yükleniyor..." root-cause analizi (DEFANSIF FIX UYGULANDI)

`openOpsDrawer` içine eklenen `setTimeout(120ms)` defansif fix **semptomu çözdü** ama **kök sebep tam belli değil**. Cihan'ın probe-v2 testinde Promise.then ile sarılı çağrılar `[ops-drawer] ✓ harcirah / ✓ benzer seferleri / ✓ masraflar` log'larını atıyor — yani **defansif setTimeout sırasında widget'lar çalışıyor**. 

Demek `_opsDrawerRender` içindeki sıralı çağrılar başarısız oluyor olmalı. Hipotez (kanıtlanmadı): `_opsYakitGpsKarsilastirmaYukle` veya `_opsRenderPOD` gibi bir helper bir noktada **sync exception** fırlatıyor, geri kalan satırlar (4361/4364/4398) atlanıyor.

**Yapılabilir:** `_opsDrawerRender` içinde 4347-4398 arası tüm sıralı çağrıları **`try/catch` ile sar** veya `Promise.resolve().then()` ile bağımsız zincirle. Sonra `console.error` ile hangi adımın patladığını net görmek için global error handler ekle.

### 🎯 2) Diğer sayfalarda aynı "Yükleniyor..." pattern (Ekip Yönetimi / Belge / Arıza)

Cihan ilk teşhiste **Ekip Yönetimi, Sürücü Belge Yönetimi, Arıza Talepleri** sayfalarında da "Yükleniyor..." kaldığını söylemişti. **Bu sayfalarda defansif fix uygulanmadı** — drawer'la sınırlı kaldı.

Bu sayfaların ortak özelliği: `currentFirmaId` async olarak set ediliyor; sayfa açma fonksiyonu çağrıldığında null olabilir. Network log'unda `firma_id=eq.null` (HTTP 400) görüldü. F5 ile düzelmesi → `currentFirmaId` yeniden senkronize oluyor.

**Yapılabilir:** Page açma fonksiyonlarının başında `currentFirmaId` kontrolü + null ise `loadFirmaId()` await et + sonra render et. Veya küçük bir helper `waitForFirmaId()` yaz, tüm page açıcılarda kullan.

### 🎯 3) Evrak Hazır — backfill nedeniyle push gelmiyor (yeni işler için OK)

Migration backfill mevcut tüm iş emirlerini `evrak_hazir_at = atama_zamani` ile doldurdu (geçişin kesintisiz olması için). Bu yüzden:
- **Eski iş emirleri** için "Hazır İşaretle" tıklanınca RPC `v_existing IS NOT NULL` → idempotent → UPDATE yok → push trigger çalışmaz → şoföre push gelmez. **Doğru davranış** (zaten hazır).
- **Yeni iş emirleri** için `evrak_hazir_at = NULL` (default) → RPC gerçek UPDATE yapar → trigger çalışır → push gider.

Cihan'ın testinde iş #73 yeni açıldı, RPC UPDATE yaptı, push gönderildi (varsayım). Cihan **push gelmedi** demişti ama belki:
- Şoför app açıkken bildirim sessiz geliyor
- Şoför FCM token yok/expired
- Veya `notify_create` çağrısı tetiklendi ama gerçek FCM push gönderme adımında problem

**Yapılabilir:** Bir test iş emri ile uçtan uca push akışı doğrula:
1. SQL: `select fcm_token from suruculer where id = ...` → dolu mu?
2. Trigger sonrası `select * from bildirimler order by created_at desc limit 5` → kayıt oluştu mu?
3. Bildirimler tablosundaki tetikleyici FCM Edge Function'ı çağırıyor mu?
4. Edge Function logs'unda hata var mı?

### 🎯 4) Evrak Hazır — mobile son test (parseInstant fix sonrası)

`parseInstant` 4 kademeli fallback fix'i uygulandı + `Build → Clean Project → Rebuild → Run` ile APK yeniden derlenmesi gerek. Cihan henüz **test sonucunu bildirmedi**.

**Beklenen:** Şoför uygulamasında iş #73 "Bekleyen" sekmesi **🟢 Hazır** bölümünde gözükmeli, JobDetail'de "Yola Çıktım" butonu **turuncu/aktif** olmalı.

### 🎯 5) Service worker install hatası

Cihan'ın console log'unda görülen:
```
[SW] hatası: TypeError: ServiceWorker script at https://fleetly.fit/service-worker.js for scope https://fleetly.fit/ encountered an error during installation.
```

Bu service worker'ı invalidate etti olabilir → eski cache atılamadı, yeni de yüklenemedi. URL refactor sırasında `APP_SHELL` listesinde olmayan bir asset (örn. `landing.css`, `favicon.png`) cache'lenmeye çalışıyor olabilir, fetch fail → install fail.

**Yapılabilir:** `service-worker.js` APP_SHELL listesini gözden geçir, var olmayan path'leri kaldır. Veya `cache.addAll` yerine her bir asset için tek tek `cache.add` (biri fail etsin diğerleri devam etsin).

---

## 📦 Migration sırası (v4 sonu + bu tur)

v4'tekiler aynen + bu turda eklenenler:

```
… (v3+v4 listesi: 2026_05_08'e kadar)
2026_05_11a..i — Platform admin sistemi (önceden var, bu turla alakasız)
2026_05_11j__guzergahlar_schema.sql                  ← bu tur (güzergah)
2026_05_11k__guzergahlar_rpc.sql                     ← bu tur (güzergah)
2026_05_11l__url_yapisi_temizleme.sql                ← bu tur (URL refactor — pg_proc dynamic)
2026_05_12a__evrak_hazir_at.sql                      ← bu tur (evrak hazır)
```

**Cache:** Room v10 → **v11** (mobile, `fallbackToDestructiveMigration` aktif).
**Service worker:** v24 → **v28** (web, her büyük JS değişikliğinde bump'landı).

---

## ⚠️ Yeni öğrenilen tuzaklar (CLAUDE.md'ye eklenebilir)

### a) `pg_get_functiondef` aggregate fonksiyonlarda patlar
`pg_proc`'u dolaşıp `pg_get_functiondef` ile body'yi alıp string replace yapmak istediğinde, **aggregate ('a'), window ('w'), procedure ('p')** üzerinde fonksiyon hata atar (`"X" is an aggregate function`). Çözüm: `where p.prokind = 'f'` filtreleyerek sadece normal fonksiyonları tara + her def çağrısını `exception when others` ile sar.

### b) Java `Instant.parse` Postgres timestamp varyantlarını reddeder
PostgREST'in dönüş formatı tutarsız:
- `"2026-05-12T11:06:07.048986+00:00"` — strict ISO (OK)
- `"2026-05-12 11:06:07.048986+00"` — boşluk + kısa offset (FAIL)

Android `Mappers.kt` artık 4 kademeli fallback ile her ikisini de parse eder. Yeni timestamp field'larını domain modeline eklerken `parseInstant` üzerinden geçtiğinden emin ol (direkt `Instant.parse` kullanma).

### c) `body.style.overflow = 'hidden'` page açıcılarda kötü pattern
Fullscreen overlay page'lerinde body kilidi gerek değil (page zaten `position:fixed; inset:0`). Kilit X'siz çıkışta kalıcı oluyor → diğer sayfaların scroll'unu bozuyor. Yeni page'lerde bu pattern'i kullanma.

### d) `opsRowToObj` her yeni `is_emirleri` kolonu için güncellenmeli
DB satırını uygulama objesine dönüştüren `opsRowToObj(r)` her field'ı tek tek listede. **SELECT * yaparsa bile** bu function listelenmeyen field'ı obj'ye taşımıyor. Yeni kolon eklerken bu fonksiyonu da güncelle.

### e) localStorage kotası dolabilir — defansif kayıt pattern'i
Browser localStorage 5-10 MB. Çok fazla iş emri + foto referansı biriktiğinde `QuotaExceededError`. Yazma fonksiyonları **3 kademeli defansif** olmalı: kırpma → minimum kayıt → en kötü `removeItem`. Tek `setItem(...)` çağrısı production'da kırılgan.

### f) Realtime payload kolon eksikliği (potansiyel — kanıtlanmadı)
PostgreSQL `REPLICA IDENTITY` ayarına göre UPDATE event'inde sadece değişen field'lar yayınlanabilir. Yeni eklenen kolon realtime publication'da olsa bile UPDATE'in **eski** payload'unda olmayabilir. DTO'da `default null` ile parse OK olsa da, eski payload yeni değeri ezerse problem. **Şüphelenirsen** her UPDATE sonrası fresh fetch yap (mobile'da bu zaten yapılıyor — `listJobs` poll 30sn).

---

## 🧭 Kullanıcı çalışma stili (devamlılık)

- **Türkçe konuşur**, kısa-net cevaplar bekler
- "Plan yap" demediği sürece doğrudan implementasyon onayı vermez — büyük değişiklikler için **mutlaka önce plan paylaş**
- Migration'ları **kendisi** Supabase Dashboard SQL Editor'a yapıştırır — sen `psql` çalıştırma
- Mobile testi: Android Studio Run (APK rebuild gerekirse `Build → Clean Project → Rebuild`)
- Web testi: Ctrl+Shift+R (hard reload, service worker cache)
- "Geri kanalını sana bırakıyorum" / "ne yapıyo olduğunu bilen sensin" — otonom çalışma onayı
- "Buna sonra bakarız" → konuyu kapat, ilerle (notu HANDOFF'a düş)
- Bug raporlarında F12 Console + Network paylaşır (bazen yarım — soruları net yönlendir)
- Sahaya çıkmadan onay bekler ("geldi şimdi allah razı olsun" tarzı doğrulama)

---

## 🚀 Yeni sohbette ilk eylem

1. **`Fleetly-main/CLAUDE.md`'yi oku** — proje yönergesi (pattern, schema, RPC listesi, kurallar)
2. **Bu dosyayı (`HANDOFF_v5.md`) oku** — son durum
3. Kullanıcıya: **"v5 handoff'u devraldım. Açık görevler: Drawer kök sebep / diğer sayfaların aynı pattern'i / evrak hazır push doğrulama / mobile parseInstant test / service worker install fix. Hangisinden başlayayım?"** diye sor
4. Beklenmedik bir konu gelirse: **plan paylaş + onay al** sonra yap

---

## 📚 Referans dosyalar (bu turla alakalı)

### Web
- `js/pages/app-chunk-05.js` — operasyon ana script (drawer, kanban, evrak hazır, defansif setTimeout)
- `js/pages/guzergahlar-page.js` — güzergah yönetici sayfası
- `js/integrations/guzergah-api.js` — REST helper
- `service-worker.js` — APP_SHELL + CACHE_NAME v28
- `css/db/migrations/2026_05_11j__guzergahlar_schema.sql`
- `css/db/migrations/2026_05_11k__guzergahlar_rpc.sql`
- `css/db/migrations/2026_05_11l__url_yapisi_temizleme.sql` — dynamic pg_proc tarayıcı
- `css/db/migrations/2026_05_12a__evrak_hazir_at.sql`

### Android
- `presentation/ui/guzergah/` — 7 dosya (3 ekran + 3 ViewModel + 1 component + JobDetailGuzergahBolumu)
- `util/PolylineEncoder.kt`, `PolylineSimplify.kt`, `GoogleMapsIntent.kt`
- `data/mapper/Mappers.kt` — **`parseInstant` 4 kademeli fallback** (yeni)
- `presentation/ui/home/HomeViewModel.kt` — sekme "Bekleyen" + pendingJobsHazir/Hazirlaniyor
- `presentation/ui/home/HomeScreen.kt` — iki bölümlü PendingTabContent
- `presentation/ui/job/JobDetailScreen.kt` — evrakBekleniyor disable
- `data/local/FleetlyDatabase.kt` — Room v11

### Memory (auto-memory)
- `project_guzergah_cross_firma_reddedildi.md` — cross-firma `gizlilik='platform'` reddedildi kararı

---

**Bu turun teması:** Şoför operasyon zinciri tamamlandı (evrak hazır + güzergah paylaşım). URL ve SW altyapısı profesyonel hâle getirildi. Birkaç eski silent-fail bug'ı (drawer widget, localStorage, body overflow, Instant parse) defansif yamalarla bastırıldı. Kök sebebler için iz bırakıldı, sonraki tur derin teşhis yapacak.
