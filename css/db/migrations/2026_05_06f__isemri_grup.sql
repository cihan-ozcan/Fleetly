-- =============================================================================
-- FLEETLY  —  2026-05-06f  —  İş Emri Grubu (Çoklu Konteyner / Çoklu Şoför)
-- =============================================================================
-- Operasyon 5 konteyneri tek formda girip her birine ayrı şoför + araç atayabilsin.
-- Senaryoyu N ayrı is_emirleri satırı + ortak grup_id ile çözüyoruz; mevcut
-- realtime/RLS/POD/harcırah pipelines tek-satır mantığını korur.
--
-- Geri alma: kolon DROP — veriye etki etmez.
-- =============================================================================

BEGIN;

ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS grup_id uuid;

CREATE INDEX IF NOT EXISTS idx_isemri_grup
  ON public.is_emirleri(grup_id) WHERE grup_id IS NOT NULL;

COMMENT ON COLUMN public.is_emirleri.grup_id IS
  'Aynı sevkiyat grubundaki iş emirlerini bağlar (web form çoklu konteyner kaydında doldurur). NULL = tek başına.';

COMMIT;
