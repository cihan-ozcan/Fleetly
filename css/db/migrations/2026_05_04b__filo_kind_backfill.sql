-- =============================================================================
-- FLEETLY  —  2026-05-04b  —  araclar.kind backfill (mevcut tip kolonundan)
-- =============================================================================
-- Karar dokümanı: docs/filo-cekici-dorse.md (Karar 7)
--
-- 2026_05_04 migration'ı tüm mevcut kayıtları DEFAULT 'cekici' ile doldurdu.
-- Bu doğru değil — mevcut araclar.tip kolonu zaten 'Dorse', 'Çekici',
-- 'Kamyonet', 'Binek Araç' gibi değerler içeriyor. Bu migration o değerleri
-- yeni kind kolonuna aktarır.
--
-- Eşleme:
--   tip içerir 'dorse' / 'römork' / 'romork'             → kind = 'dorse'
--   tip içerir 'çekici' / 'cekici' / 'tır' / 'tir'       → kind = 'cekici'
--   tip içerir 'kamyon' / 'kamyonet' / 'binek' / 'oto'   → kind = 'tek_parca'
--   diğer / null / boş                                   → kind = 'cekici' (var olan default)
--
-- Çalıştırma güvenlidir: yalnızca kind hâlâ 'cekici' (default) olan satırlara
-- dokunulur. Manuel olarak farklı kind atanmış kayıtlar korunur.
--
-- Doğrulama (manuel, çalıştırdıktan sonra):
--   SELECT kind, tip, COUNT(*) FROM public.araclar GROUP BY kind, tip ORDER BY kind, tip;
-- =============================================================================

BEGIN;

-- 1) Dorse: tip alanı 'dorse' veya römork türevi içerenler
UPDATE public.araclar
SET kind = 'dorse'
WHERE kind = 'cekici'
  AND tip IS NOT NULL
  AND (
       lower(tip) LIKE '%dorse%'
    OR lower(tip) LIKE '%römork%'
    OR lower(tip) LIKE '%romork%'
    OR lower(tip) LIKE '%treyler%'
    OR lower(tip) LIKE '%trailer%'
  );

-- 2) Tek parça: kamyon, kamyonet, binek araç, otomobil, panelvan vb.
UPDATE public.araclar
SET kind = 'tek_parca'
WHERE kind = 'cekici'
  AND tip IS NOT NULL
  AND (
       lower(tip) LIKE '%kamyonet%'
    OR lower(tip) LIKE '%kamyon%'           -- "Kamyon" başlı başına; "Çekici"yi YAKALAMAZ
    OR lower(tip) LIKE '%binek%'
    OR lower(tip) LIKE '%otomobil%'
    OR lower(tip) LIKE '%panelvan%'
    OR lower(tip) LIKE '%minibüs%'
    OR lower(tip) LIKE '%minibus%'
    OR lower(tip) LIKE '%pickup%'
  );

-- 3) Çekici: kalanların büyük kısmı zaten 'cekici' default'unda. Kontrol amaçlı
--    'tır' / 'çekici' içerenleri açıkça kind='cekici' yap (no-op ama belge).
UPDATE public.araclar
SET kind = 'cekici'
WHERE kind = 'cekici'  -- explicit no-op; idempotency
  AND tip IS NOT NULL
  AND (
       lower(tip) LIKE '%çekici%'
    OR lower(tip) LIKE '%cekici%'
    OR lower(tip) = 'tır'
    OR lower(tip) = 'tir'
  );

COMMIT;

-- =============================================================================
-- DAĞILIM RAPORU (manuel çalıştırılır)
-- =============================================================================
-- SELECT kind, tip, COUNT(*) AS adet
-- FROM public.araclar
-- GROUP BY kind, tip
-- ORDER BY kind, tip;
--
-- Örnek beklenen sonuç:
--   cekici    | Çekici            | 12
--   dorse     | Dorse             | 8
--   dorse     | Yarı Römork       | 3
--   tek_parca | Kamyonet          | 2
--   tek_parca | Binek Araç        | 1
-- =============================================================================
