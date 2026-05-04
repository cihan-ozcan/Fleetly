# Filo — Çekici & Dorse Ayrımı (Decisions)

> Bu doküman, "Filo Yönetimi: çekici-dorse ayrımı + operasyon entegrasyonu" iş paketinin kararlarını kayıt altına alır. Implementasyon bu kararlara göre ilerler. Karar değişirse önce bu doküman güncellenir, sonra kod.

**Tarih**: 2026-05-04
**Durum**: Implementasyon başlıyor — Paket 1: schema + iskelet.

---

## Karar 1 — Veri modeli

**Seçim:** Mevcut `public.araclar` tablosu genişletilir. Yeni `kind` kolonu (`'cekici' | 'dorse' | 'tek_parca'`) ile aynı tabloda tutulur. Dorse-spesifik alanlar nullable.

**Neden:** Mevcut FK'ler (sürücü atama, iş emri, bakım kayıtları, belgeler) `araclar(id)`'ye bağlı. İki tabloya bölmek bu FK'lerin yarısını koparır. Tek tablo + `kind` ayrımı en az migration borcu üretir.

**Sonuç:** Yeni tablo `cekiciler/dorseler` **yok**. `araclar` tablosuna eklenen kolonlar:
- `kind text NOT NULL DEFAULT 'cekici' CHECK (kind IN ('cekici','dorse','tek_parca'))`
- `dorse_tipi text REFERENCES dorse_tipleri(kod)` (sadece dorse için anlamlı)
- `kapasite_m3 numeric` (dorse — hacim, opsiyonel)
- `kapasite_ton numeric` (dorse — yük kapasitesi, opsiyonel)
- `aks_sayisi smallint` (dorse — aks adedi, opsiyonel)
- `frigorifik boolean DEFAULT false` (reefer/frigorifik dorse mi)

## Karar 2 — Çekici ↔ Dorse eşleşmesi

**Seçim:** Zamansal eşleşme tablosu — `arac_dorse_atamalari` (sürücü atamasıyla simetrik).

**Şema:**
```
id, cekici_id, dorse_id, firma_id, baslangic, bitis, birincil_mi, notlar, created_at
```
- Aktif eşleşme = `bitis IS NULL`.
- Bir çekicinin **birden çok aktif dorsesi** olabilir; bunlardan biri `birincil_mi = true`.
- Bir dorsenin aynı anda **tek aktif çekicisi** olabilir (uniq partial index ile zorlanır).

**Neden:** Dorse değişimi günlük iş; geçmiş tutmak gerekir (bir dorse hangi çekicide hangi tarihte taşındı).

## Karar 3 — Dorse tipleri

**Seçim:** Lookup tablosu `dorse_tipleri` (kod, ad, varsayilan_kapasite_m3, varsayilan_kapasite_ton).

**Seed:**

| kod          | ad                       | m³ | ton |
|--------------|--------------------------|----|-----|
| teleskopik   | Teleskopik               |    |     |
| sabit_40     | Sabit 40lık (40 DC)      | 67 | 28  |
| sabit_20     | Sabit 20lik (20 DC)      | 33 | 28  |
| tenteli      | Tenteli (Pillow / Curtain)| 90 | 24 |
| frigorifik   | Frigorifik / Reefer      | 80 | 22  |
| lowbed       | Lowbed                   |    | 40  |
| silobas      | Silobas                  | 60 | 28  |
| kuruyuk      | Kuru Yük (Sabit Kasa)    | 80 | 28  |

Operatör listeyi düzenleyebilir (admin UI ileride; başlangıçta sadece SQL seed).

## Karar 4 — İş emri kaydı

**Seçim:** `is_emirleri.arac_plaka` kolonu **korunur** (display cache). Yanına iki yeni FK eklenir:
- `cekici_id text REFERENCES araclar(id)`
- `dorse_id  text REFERENCES araclar(id)` (nullable — bazı operasyonlarda dorse yok / harici)

**Neden:** Eski kayıtlar `arac_plaka` ile çalışmaya devam eder. Yeni kayıtlarda `arac_plaka` çekici plakasından otomatik doldurulur.

## Karar 5 — Birincil sürücü

**Seçim:** Yalnızca `kind='cekici'` ve `kind='tek_parca'` araçlara sürücü atanır. Dorse'lere sürücü atanmaz.

**Uygulama:** UI tarafında dorse formunda sürücü alanı gizlenir. `arac_sofor_atamalari` tablosu şema değişmez; sadece insert path'leri kontrol eder.

## Karar 6 — Filo sayfası entry point

**Seçim:** Sidebar'a yeni "Filo" item eklenir, mevcut **"Operasyon"** sidebar item'ının altına. Tam sayfa modül (`#filo-page`).

**Neden:** Filo, operasyondan bağımsız bir bakış (envanter, bakım, eşleşme yönetimi). Operasyon sayfasının "Filo Haritası" sekmesi farklı bir görünüm — birlikte yaşar.

## Karar 7 — Mevcut `araclar` kayıtları için backfill

**Seçim:** Migration `kind` kolonunu `'cekici'` default'uyla doldurur. Ek bir UI ekranı **opsiyonel** (Paket 4'te değerlendirilir); ilk fazda kullanıcı manuel düzeltir.

**Neden:** Mevcut veri seti küçük (testler/dev). Üretim kullanımı varsa kullanıcı dump'a göre bireysel düzeltir.

## Karar 8 — Tasarım dili

**Seçim:**
- **Filo sayfası** kendi paletinde: mevcut [css/tokens.css](../css/tokens.css) light/dark theme'i kullanır. Operasyon'un dark-only paleti uygulanmaz.
- **Operasyon iş emri formundaki çekici/dorse seçici** [css/pages/operasyon.css](../css/pages/operasyon.css) içindeki primitive'leri (`.ops-input`, `.ops-search`, `.ops-pill`) kullanır.

## Korunacaklar (kırarsa yeniden yapılır)

- `araclar.id text PK`, `plaka`, `tip`, `marka`, `model`, `yil`, `birincil_surucu_id` aynen kalır.
- `arac_sofor_atamalari` tablosu değişmez.
- `is_emirleri.arac_plaka` aynen kalır.
- `openOperasyonPage()`, `opsRenderTable()`, `opsBuildContainerCard()` imzaları aynı kalır.
- `#ops-arac-dropdown` ID'si korunur.
- [css/tokens.css](../css/tokens.css) **dokunulmaz**.
- Mevcut RLS policy'leri DROP/CHANGE edilmez; yeni tablolara yeni policy yazılır.

## İmplementasyon paketleri

- **Paket 1** *(bu paket)*: DECISIONS + SQL migration + filo-api.js + sidebar item + `#filo-page` iskelet.
- **Paket 2**: Çekiciler tablosu + drawer · Dorseler tablosu + drawer.
- **Paket 3**: Eşleşmeler sekmesi + atama modalı · Operasyon iş emri formuna çekici/dorse iki dropdown · Kanban kart + tablo dorse pill'i.
- **Paket 4** *(opsiyonel)*: Backfill UI · Bakım sekmesi (mevcut `bakim_kayitlari` UI bağlantısı).

## Açık not

İleride 1-1 izolasyon istenirse (ayrı `cekiciler`/`dorseler` tabloları), bu kararı geri çevirmek mümkün — view + trigger köprüsüyle. Şu an kanıt yok, YAGNI.
