-- =============================================================================
-- FLEETLY  —  2026-05-08  —  Yeni durum: 'Alım Yapıldı' (dolu konteyner ara durağı)
-- =============================================================================
-- KÖK SORUN:
--   3-nokta iş akışında DOLU konteyner senaryosunda da "alım yapıldı" ara
--   durağı var (limana var → konteyneri yükle → fabrikaya yola çık). Bu noktada
--   şoför "Kumport'a Vardım" butonuna basınca durum 'Boş Alındı'ya geçiyordu —
--   YANILTICI çünkü dolu konteyner alındı, boş değil. Operasyon panelinde de
--   "Boş Alındı" yazıyordu.
--
-- ÇÖZÜM:
--   Yeni durum: 'Alım Yapıldı'.
--   • kontDurum = 'Boş'  → durum 'Boş Alındı'   (mevcut, korunur)
--   • kontDurum = 'Dolu' → durum 'Alım Yapıldı' (yeni)
--   Davranışsal olarak ikisi de "ara durak" — Yolda → ara → Yolda zinciri
--   aynı. Sadece etiket farklı, semantik doğru olsun diye.
--
-- BAĞIMLI:
--   supabase_setup_v2.sql (is_emirleri.durum CHECK constraint)
--   2026_05_06b__bos_alim_ve_tel_muhur.sql (Boş Alındı eklenen migration)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) durum CHECK constraint genişlet
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri
  DROP CONSTRAINT IF EXISTS is_emirleri_durum_check;

ALTER TABLE public.is_emirleri
  ADD CONSTRAINT is_emirleri_durum_check
  CHECK (durum IN (
    'Bekliyor',
    'Yolda',
    'Boş Alındı',     -- kontDurum=Boş için (mevcut)
    'Alım Yapıldı',   -- kontDurum=Dolu için (yeni 2026-05-08)
    'Fabrikada',
    'Teslim Edildi',
    'İptal'
  ));

-- -----------------------------------------------------------------------------
-- 2) Yorum (dokümantasyon)
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN public.is_emirleri.durum IS
  'İş emri durumu — şoför akışı: '
  'Bekliyor → Yolda → (Boş Alındı | Alım Yapıldı) → Yolda → Fabrikada → Yolda → Teslim Edildi. '
  'Boş Alındı vs Alım Yapıldı: konteyner durumuna göre. '
  'Davranışsal olarak ikisi aynı ara durak — sadece UI etiketi farklı.';

-- -----------------------------------------------------------------------------
-- 3) Mevcut yanlış kayıtları onarma (opsiyonel)
-- -----------------------------------------------------------------------------
-- Eğer kullanıcı önceki sürümde dolu konteynerda durum='Boş Alındı'ya geçtiyse,
-- otomatik düzelt: kont_durum='Dolu' + durum='Boş Alındı' → durum='Alım Yapıldı'
UPDATE public.is_emirleri
   SET durum = 'Alım Yapıldı'
 WHERE durum = 'Boş Alındı'
   AND kont_durum ILIKE 'Dolu';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Constraint güncellendi mi:
--    SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conrelid='public.is_emirleri'::regclass
--       AND contype='c' AND conname LIKE '%durum%';
--
-- 2) Yanlış kayıt düzeltildi mi:
--    SELECT durum, kont_durum, count(*)
--      FROM is_emirleri
--     GROUP BY durum, kont_durum
--     ORDER BY durum;
--    'Boş Alındı' satırlarında SADECE kontDurum='Boş' olmalı.
--    'Alım Yapıldı' satırlarında SADECE kontDurum='Dolu' olmalı.
-- =============================================================================
