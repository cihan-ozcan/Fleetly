-- =============================================================================
-- FLEETLY  —  2026-05-07k  —  Planlanan teslim/randevu zamanı
-- =============================================================================
-- KÖK İHTİYAÇ:
--   Bazı senaryolarda şoför bir gece önce alıp sabah teslim eder. Operasyon
--   örnekleri:
--     • Müşteri 08.05 sabah firmada boş konteyner istiyor → şoför 07.05 akşam
--       limandan boş alır, 08.05 sabah firmada olur.
--     • Operasyon bugün şoföre dolu konteyneri aldırır, ertesi sabah müşteride
--       boşaltma yapılır.
--   Bu senaryolarda TEK bir "planlanan_zaman" yetmez — alım ve teslim ayrı
--   saatlerdedir.
--
-- VERİ MODELİ:
--   • planlanan_zaman          (07j, MEVCUT) → ALIM zamanı
--     Anlamı: şoförün alım noktasında (liman / boş depo) olması istenen tarih+saat.
--
--   • planlanan_teslim_zamani  (BU MIGRATION) → MÜŞTERİ RANDEVU zamanı
--     Anlamı: şoförün müşteri firmasında (fabrika / depo / antrepo) yükleme/
--     boşaltma için olması istenen tarih+saat.
--
--   İkisi de opsiyonel ve bağımsız. Operasyon ihtiyaca göre birini, ikisini
--   veya hiçbirini doldurabilir.
--
-- UI semantik:
--   • Mobile NextStepCard banner — şoförün DURUMUNA göre hangi zamanı göstereceğini
--     seçer:
--       Bekliyor / Yolda(alıma)        → planlanan_zaman (alım)
--       BosAlindi / Yolda(teslime)     → planlanan_teslim_zamani (randevu)
--       Fabrikada / TeslimEdildi       → banner gizli
--   • Operasyon drawer 2 ayrı detay satırı (hangisi doluysa görünür).
-- =============================================================================

BEGIN;

ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS planlanan_teslim_zamani timestamptz;

COMMENT ON COLUMN public.is_emirleri.planlanan_teslim_zamani IS
  'Müşteri randevu saati — şoförün fabrikada/firmada yükleme/boşaltma için olması '
  'istenen tarih+saat. planlanan_zaman (alım) ile beraber kullanılır; ön-planlama '
  'senaryolarında (örn. akşam alıp sabah teslim) iki saat ayrılır.';

-- Index — operasyon "Bugün randevu / Yarın randevu" filtreleri için.
-- Partial: sadece dolu kayıtları indeksle, küçük + hızlı kalır.
CREATE INDEX IF NOT EXISTS idx_isemri_planlanan_teslim
  ON public.is_emirleri (firma_id, planlanan_teslim_zamani)
  WHERE planlanan_teslim_zamani IS NOT NULL;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Kolon eklendi mi:
--    SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='is_emirleri'
--       AND column_name='planlanan_teslim_zamani';
--
-- 2) Senaryo testi: ön-planlama (akşam alım, sabah teslim)
--    UPDATE is_emirleri
--       SET planlanan_zaman          = '2026-05-07 17:00:00+03'::timestamptz,
--           planlanan_teslim_zamani  = '2026-05-08 09:00:00+03'::timestamptz
--     WHERE id = <test_id>;
--    Mobile'da Bekliyor durumunda → "Alım: bugün 17:00", durum BosAlindi'ye
--    geçince → "Randevu: yarın 09:00".
-- =============================================================================
