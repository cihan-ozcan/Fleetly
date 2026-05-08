-- =============================================================================
-- FLEETLY  —  2026-05-07l  —  Şoför yakıt fişi bildirimi (basit mod)
-- =============================================================================
-- KÖK İHTİYAÇ:
--   Sahada şoförler yakıt fişini WhatsApp'a fiş + kadran fotoğrafı olarak atıyor;
--   detayları (litre, tutar, istasyon, fiş no...) elle girmek istemiyor → mevcut
--   yakıt giriş formu KULLANILMIYOR. Yeni akış:
--     1) Şoför sadece 2 FOTOĞRAF çeker (fiş + kadran) + opsiyonel kısa not
--     2) Kayıt durum='beklemede' olarak gelir
--     3) Operasyon foto'ları açıp detayları doldurur, "Onayla" → durum='onayli'
--     4) Onayla sonrası mevcut yakit_girisleri akışı (yakıt cache, sefer chart) çalışır
--
-- VERİ MODELİ — yakit_girisleri tablosuna eklenir (yeni tablo değil — sadelik):
--   • durum            'beklemede' | 'onayli' | 'red'
--                      DEFAULT 'onayli' → geriye dönük tüm kayıtlar onaylı sayılır
--   • fis_url          (MEVCUT) — fiş fotoğrafı URL'si, basit mod bunu kullanır
--   • foto_kadran_url  (YENİ)  — kadran fotoğrafı URL'si (km göstergesi)
--   • sofor_user_id    (YENİ)  — şoförün auth user_id'si (RLS için)
--   • is_emri_id       (YENİ)  — bağlı iş emri (varsa, otomatik aktif iş)
--   • onay_at, onay_user_id, red_neden  — operasyon onay akışı
--
-- RLS:
--   • Şoför INSERT: kendi sofor_user_id'si + durum='beklemede' zorunlu
--   • Şoför SELECT: zaten firma_id üzerinden gözüküyor (_user_firma_ids
--     suruculer'ı da kapsıyor — 07b)
--   • Operasyon UPDATE: yetkili rol (mevcut yakit_v2_modify policy'si yeterli)
--
-- BAĞIMLI: 2026_05_07b__rls_emergency_fix (helper fonksiyonlar)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Yeni kolonlar — yakit_girisleri
-- -----------------------------------------------------------------------------
ALTER TABLE public.yakit_girisleri
  ADD COLUMN IF NOT EXISTS durum           text NOT NULL DEFAULT 'onayli'
                            CHECK (durum IN ('beklemede','onayli','red')),
  ADD COLUMN IF NOT EXISTS foto_kadran_url text,
  ADD COLUMN IF NOT EXISTS sofor_user_id   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_emri_id      bigint REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS onay_at         timestamptz,
  ADD COLUMN IF NOT EXISTS onay_user_id    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS red_neden       text;

COMMENT ON COLUMN public.yakit_girisleri.durum IS
  'beklemede=şoför fiş bildirdi, operasyon detay girmesini bekliyor; '
  'onayli=geçerli yakıt girişi (yakıt cache + sefer maliyet hesabına dahil); '
  'red=operasyon reddetti (red_neden dolu).';
COMMENT ON COLUMN public.yakit_girisleri.foto_kadran_url IS
  'Şoförün çektiği araç kadranı fotoğrafı (km göstergesi). fis_url ile birlikte '
  'operasyonun detayları doldurması için referans.';

-- Index — operasyon "onay bekleyen" filtresi için
CREATE INDEX IF NOT EXISTS idx_yakit_firma_durum
  ON public.yakit_girisleri (firma_id, durum)
  WHERE durum = 'beklemede';

-- -----------------------------------------------------------------------------
-- 2) RLS — şoföre INSERT izni (sadece kendi user_id + beklemede)
-- -----------------------------------------------------------------------------
-- Mevcut policy'ler (07b'de eklenen):
--   yakit_v2_select  — firma_id IN (_user_firma_ids()) → şoför kendi firmasının
--                      kayıtlarını okur, sorun yok
--   yakit_v2_modify  — firma_id IN (_user_firma_yetkili_ids()) → ofis yetkisi
--                      şoför burada yok → INSERT yapamaz!
--
-- Yeni policy: şoför kendi adına 'beklemede' kayıt INSERT edebilir.
DROP POLICY IF EXISTS yakit_v2_sofor_insert ON public.yakit_girisleri;
CREATE POLICY yakit_v2_sofor_insert ON public.yakit_girisleri
  FOR INSERT TO authenticated
  WITH CHECK (
    sofor_user_id = auth.uid()
    AND durum = 'beklemede'
    AND firma_id IN (SELECT public._user_firma_ids())
  );

-- Şoför kendi kayıtlarını sonradan UPDATE edemez (ofis yetkisi gerek), DELETE de yok.
-- Operasyon mevcut yakit_v2_modify ile her şey yapabilir (UPDATE durum='onayli' dahil).

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Yeni kolonlar:
--    SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='yakit_girisleri'
--       AND column_name IN ('durum','foto_kadran_url','sofor_user_id',
--                           'is_emri_id','onay_at','onay_user_id','red_neden');
--
-- 2) Şoför INSERT testi (mobile'dan otomatik gelecek):
--    SET request.jwt.claim.sub = '<sofor_auth_uid>';
--    INSERT INTO yakit_girisleri (id, arac_id, tarih, km, litre, fiyat,
--                                 user_id, firma_id, sofor_user_id, durum)
--    VALUES ('test-1', '34ABC123', CURRENT_DATE, 0, 0, 0,
--            '<sofor_auth_uid>', '<firma_id>', '<sofor_auth_uid>', 'beklemede');
--    → Başarılı olmalı.
--
--    Aynı INSERT durum='onayli' ile → RLS ENGEL (yakit_v2_sofor_insert WITH CHECK fail).
--
-- 3) Operasyon onay akışı (web tarafı):
--    UPDATE yakit_girisleri
--       SET durum='onayli',
--           litre=237.21, fiyat=17069.63, ...,
--           onay_at=now(), onay_user_id=auth.uid()
--     WHERE id='<bildirim_id>';
-- =============================================================================
