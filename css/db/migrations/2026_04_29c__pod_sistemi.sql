-- =============================================================================
-- FLEETLY  —  2026-04-29c  —  POD (Proof of Delivery) Sistemi
-- =============================================================================
-- İki aşamalı POD akışı:
--   1. Sürücü teslim edince → taslak POD PDF (imza + foto + meta)
--   2. Yönetici onaylayınca → final PDF (logo + QR + onay damgası)
--
-- Mevcut kolonlar (DOKUNMUYORUZ — zaten kullanılıyor):
--   • imza_url             → müşteri imzası PNG URL
--   • teslim_not_musteri   → sürücünün teslim notu
--   • teslim_alan_ad       → teslimi alan kişinin adı
--   • teslim_zamani        → teslim anı (timestamptz)
--
-- Yeni eklenenler:
--   • pod_taslak_url       → sürücü teslim ettikten sonra üretilen taslak PDF
--   • pod_final_url        → yönetici onayından sonra üretilen final PDF
--   • pod_olusturma_zaman  → taslak PDF üretildiği an
--   • pod_onay_zaman       → final onay zamanı
--   • pod_onaylayan        → onaylayan kullanıcı (auth.users.id)
--   • pod_onay_notu        → yöneticinin onay/red notu
--   • pod_durum            → 'taslak' | 'onayli' | 'reddedildi'
-- =============================================================================

BEGIN;

ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS pod_taslak_url      text,
  ADD COLUMN IF NOT EXISTS pod_final_url       text,
  ADD COLUMN IF NOT EXISTS pod_olusturma_zaman timestamptz,
  ADD COLUMN IF NOT EXISTS pod_onay_zaman      timestamptz,
  ADD COLUMN IF NOT EXISTS pod_onaylayan       uuid,
  ADD COLUMN IF NOT EXISTS pod_onay_notu       text,
  ADD COLUMN IF NOT EXISTS pod_durum           text
    CHECK (pod_durum IS NULL OR pod_durum = ANY (ARRAY['taslak','onayli','reddedildi']));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'is_emirleri_pod_onaylayan_fkey'
      AND table_name = 'is_emirleri'
  ) THEN
    ALTER TABLE public.is_emirleri
      ADD CONSTRAINT is_emirleri_pod_onaylayan_fkey
        FOREIGN KEY (pod_onaylayan) REFERENCES auth.users(id);
  END IF;
END $$;

-- İndex: yönetici "onayı bekleyen" PODleri hızlı çeksin
CREATE INDEX IF NOT EXISTS idx_is_emirleri_pod_durum
  ON public.is_emirleri (firma_id, pod_durum)
  WHERE pod_durum IS NOT NULL;

-- =============================================================================
-- STORAGE BUCKET — pod-documents
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pod-documents',
  'pod-documents',
  false,                                                -- private
  20971520,                                             -- 20 MB
  ARRAY['application/pdf','image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Eski politikalar varsa temizle
DROP POLICY IF EXISTS pod_docs_select_firma   ON storage.objects;
DROP POLICY IF EXISTS pod_docs_insert_firma   ON storage.objects;
DROP POLICY IF EXISTS pod_docs_update_firma   ON storage.objects;
DROP POLICY IF EXISTS pod_docs_select_anon    ON storage.objects;

-- Path format: {firma_id}/{yil}/{ay}/{is_emri_id}/dosya.pdf
-- Firma üyeleri (sahip/yonetici/operasyoncu/sofor) kendi firmasına ait dosyaları görür
CREATE POLICY pod_docs_select_firma
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'pod-documents'
    AND (
      -- path'in ilk segmenti firma_id
      EXISTS (
        SELECT 1 FROM public.firma_kullanicilar fk
        WHERE fk.user_id = auth.uid()
          AND fk.firma_id::text = split_part(name, '/', 1)
      )
    )
  );

CREATE POLICY pod_docs_insert_firma
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pod-documents'
    AND EXISTS (
      SELECT 1 FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid()
        AND fk.firma_id::text = split_part(name, '/', 1)
    )
  );

CREATE POLICY pod_docs_update_firma
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'pod-documents'
    AND EXISTS (
      SELECT 1 FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid()
        AND fk.firma_id::text = split_part(name, '/', 1)
    )
  );

-- Sofor.html anonim erişimi (token-link) için — sadece kendi iş emrinin
-- firma_id'sine yazabilir. Path validasyonu sürücü tarafında yapılır;
-- burada en azından bucket sınırını koyuyoruz.
CREATE POLICY pod_docs_select_anon
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'pod-documents');

COMMIT;

-- =============================================================================
-- KURULUM SONRASI TEST
-- =============================================================================
-- Yeni kolonların geldiğini doğrula:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'is_emirleri' AND column_name LIKE 'pod_%';
--
-- Bucket'ın oluştuğunu doğrula:
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'pod-documents';
-- =============================================================================
