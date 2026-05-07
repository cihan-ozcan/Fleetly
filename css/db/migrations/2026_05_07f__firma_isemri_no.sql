-- =============================================================================
-- FLEETLY  —  2026-05-07f  —  Firma bazlı iş emri numarası
-- =============================================================================
-- SORUN:
--   `is_emirleri.id` global PostgreSQL bigserial sequence. Tüm firmalar tek
--   havuzdan numara alıyor → yeni açılan firma 51. INSERT olduğunda id=51
--   görüyor. Kullanıcı "kendi firmamın iş emri 1'den başlasın" diye haklı
--   olarak şikayet ediyor.
--
-- ÇÖZÜM:
--   Yeni `firma_isemri_no INT` kolonu. BEFORE INSERT trigger ile her firma
--   için 1'den başlatıp artırır. Mevcut `id` (PK) global kalır — foreign
--   key'ler, mobile cache, realtime hep çalışmaya devam eder.
--
--   Concurrent INSERT'lerde aynı no'yu üretmemek için pg_advisory_xact_lock
--   ile firma bazlı sıralama. Ek güvenlik: composite UNIQUE index.
--
--   Backfill: tüm mevcut iş emirleri her firma için id sırasına göre 1'den
--   numaralandırılır (eski test firmalarınız da 1'den başlar — yeni numara
--   düzenli görünüm).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Yeni kolon
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS firma_isemri_no INT;

-- -----------------------------------------------------------------------------
-- 2) Trigger fonksiyonu — her firma için ayrı sıra
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_firma_isemri_no_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.firma_isemri_no IS NULL AND NEW.firma_id IS NOT NULL THEN
    -- Aynı firma için concurrent insert'leri sıralar (transaction-scoped lock,
    -- transaction sonunda otomatik release). Farklı firma → farklı hash → bloklanmaz.
    PERFORM pg_advisory_xact_lock(hashtext('isemri_no_' || NEW.firma_id::text));

    SELECT COALESCE(MAX(firma_isemri_no), 0) + 1
      INTO NEW.firma_isemri_no
      FROM public.is_emirleri
     WHERE firma_id = NEW.firma_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS firma_isemri_no_assign ON public.is_emirleri;
CREATE TRIGGER firma_isemri_no_assign
BEFORE INSERT ON public.is_emirleri
FOR EACH ROW EXECUTE FUNCTION public.trg_firma_isemri_no_assign();

-- -----------------------------------------------------------------------------
-- 3) Backfill — mevcut kayıtları her firma için id sırasına göre 1'den numaralandır
-- -----------------------------------------------------------------------------
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY firma_id ORDER BY id) AS sn
    FROM public.is_emirleri
   WHERE firma_id IS NOT NULL
)
UPDATE public.is_emirleri ie
   SET firma_isemri_no = n.sn
  FROM numbered n
 WHERE ie.id = n.id
   AND ie.firma_isemri_no IS NULL;

-- -----------------------------------------------------------------------------
-- 4) Composite UNIQUE — aynı firma içinde iki kayıtta aynı no olamaz
-- -----------------------------------------------------------------------------
-- Concurrent INSERT'lerde advisory lock yarış kazanırsa burada sigorta olarak
-- patlar; uygulama retry yapabilir.
CREATE UNIQUE INDEX IF NOT EXISTS is_emirleri_firma_no_uq
  ON public.is_emirleri (firma_id, firma_isemri_no)
  WHERE firma_id IS NOT NULL AND firma_isemri_no IS NOT NULL;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Her firma için 1'den artıyor mu:
--    SELECT firma_id, MIN(firma_isemri_no), MAX(firma_isemri_no), COUNT(*)
--      FROM is_emirleri
--     GROUP BY firma_id;
--    Her satırda MIN=1 olmalı, MAX=COUNT olmalı (boşluk yok).
--
-- 2) Yeni firma test:
--    Web'de yeni iş emri yarat → firma_isemri_no = 1 (firmadaki ilk kayıtsa)
--                            = MAX(önceki)+1 (sonraki kayıtlar)
--
-- 3) UI değişikliği gerekiyor:
--    Web: js/pages/app-chunk-05.js, app-chunk-pod.js, musteri_takip.html
--      `İŞ EMRİ #${e.id}` → `İŞ EMRİ #${e.firma_isemri_no ?? e.id}`
--    Mobile: JobOrder.firmaIsemriNo + JobDetailScreen header
-- =============================================================================
