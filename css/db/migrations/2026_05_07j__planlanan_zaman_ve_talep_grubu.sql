-- =============================================================================
-- FLEETLY  —  2026-05-07j  —  Planlanmış başlangıç zamanı + müşteri talep serisi
-- =============================================================================
-- HEDEF:
--   Müşteri "3 gün üst üste, her gün sabah 9'da bir konteyner" gibi serili
--   talepler verebilsin. Ayrıca her iş emrinin "şoför kaçta orada olmalı"
--   bilgisi tutulsun (mevcut atama_zamani sadece operasyonun ne zaman
--   atadığını gösterir, planlama bilgisi DEĞİL).
--
-- YENİ ALANLAR:
--   1) is_emirleri.planlanan_zaman timestamptz
--      Şoförün alım/yükleme noktasında olması beklenen tarih+saat.
--      NULL = belirtilmemiş (geri uyumlu).
--
--   2) is_emirleri.talep_grup_no text
--      Aynı müşteri talebinin parçası olan iş emirlerini bağlar (örn. 3 gün
--      üst üste 3 ayrı iş emri = aynı talep_grup_no). Operasyon "Birden fazla
--      tarihte" formunu submit ettiğinde otomatik üretilir.
--      Format önerisi: 'TG-YYMMDD-HHMM' (operasyonun yarattığı an) ya da
--      uygulama serbest. NULL = tek seferlik iş.
--
-- MEVCUT KAVRAMLARDAN FARK:
--   • grup_id (06f migration): AYNI GÜN çoklu konteyner / araç (paralel sevkiyat)
--   • talep_grup_no (bu migration): FARKLI GÜNLERDE aynı müşteri talebi (serili)
--   İki kavram BAĞIMSIZ — bir iş emri her ikisine de sahip olabilir.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Yeni kolonlar
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS planlanan_zaman timestamptz,
  ADD COLUMN IF NOT EXISTS talep_grup_no   text;

COMMENT ON COLUMN public.is_emirleri.planlanan_zaman IS
  'Şoförün alım/yükleme noktasında olması beklenen tarih+saat. NULL=belirtilmemiş. '
  'Mobile NextStepCard banner ve operasyon "Planlanan" kolonu bunu okur.';

COMMENT ON COLUMN public.is_emirleri.talep_grup_no IS
  'Aynı müşteri talep serisindeki iş emirlerini bağlar (farklı günlerde aynı talep). '
  'Operasyon "Birden fazla tarihte" formuyla N iş emri yaratır, hepsine aynı kod yapışır. '
  'grup_id''den FARK: grup_id aynı günde paralel araç, talep_grup_no farklı günlerde seri.';

-- -----------------------------------------------------------------------------
-- 2) Index'ler
-- -----------------------------------------------------------------------------
-- Operasyon "Bugün planlanan / Yarın / Bu hafta" filtreleri için: firma içinde
-- planlanan zamana göre sıralı tarama. Partial index — NULL kayıtları dışarıda
-- bırakır, küçük + hızlı kalır.
CREATE INDEX IF NOT EXISTS idx_isemri_planlanan
  ON public.is_emirleri (firma_id, planlanan_zaman)
  WHERE planlanan_zaman IS NOT NULL;

-- Talep serisi lookup ("aynı seriden başka iş var mı"): firma içinde grup no
-- ile arama. Drawer'daki "Bu Talep Serisinin Parçaları" kartı bunu okur.
CREATE INDEX IF NOT EXISTS idx_isemri_talep_grup
  ON public.is_emirleri (firma_id, talep_grup_no)
  WHERE talep_grup_no IS NOT NULL;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Kolonlar eklendi mi:
--    SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='is_emirleri'
--       AND column_name IN ('planlanan_zaman','talep_grup_no');
--
-- 2) Index'ler oluştu mu:
--    SELECT indexname FROM pg_indexes
--     WHERE schemaname='public' AND tablename='is_emirleri'
--       AND indexname IN ('idx_isemri_planlanan','idx_isemri_talep_grup');
--
-- 3) Test ekleme (manuel SQL — UI hazırlanmadan önce):
--    UPDATE is_emirleri SET planlanan_zaman = '2026-05-08 09:00:00+03'::timestamptz
--      WHERE id = <test_id>;
--    Sonra mobile'da o iş emrine girince banner görünmeli (1D fazından sonra).
-- =============================================================================
