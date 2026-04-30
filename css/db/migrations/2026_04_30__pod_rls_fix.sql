-- =============================================================================
-- FLEETLY  —  2026-04-30  —  POD Storage RLS Fix (Sürücü Erişimi)
-- =============================================================================
-- Önceki migration (2026_04_29c) sadece firma_kullanicilar tablosundaki
-- üyelere yazma izni veriyordu. Sürücüler suruculer.auth_user_id ile
-- bağlanıyor, dolayısıyla yetkisi yoktu → upload başarısız oluyordu.
--
-- Bu migration: sürücüleri (suruculer) ve firma üyelerini (firma_kullanicilar)
-- birlikte yetkilendiriyor.
-- =============================================================================

BEGIN;

-- Eski politikaları temizle
DROP POLICY IF EXISTS pod_docs_select_firma ON storage.objects;
DROP POLICY IF EXISTS pod_docs_insert_firma ON storage.objects;
DROP POLICY IF EXISTS pod_docs_update_firma ON storage.objects;

-- SELECT: firma üyeleri VEYA sürücüler (kendi firmalarının dosyaları)
CREATE POLICY pod_docs_select_firma
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'pod-documents'
    AND (
      EXISTS (
        SELECT 1 FROM public.firma_kullanicilar fk
        WHERE fk.user_id = auth.uid()
          AND fk.firma_id::text = split_part(name, '/', 1)
      )
      OR EXISTS (
        SELECT 1 FROM public.suruculer s
        WHERE s.auth_user_id = auth.uid()
          AND s.firma_id::text = split_part(name, '/', 1)
      )
    )
  );

-- INSERT: aynı kural
CREATE POLICY pod_docs_insert_firma
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pod-documents'
    AND (
      EXISTS (
        SELECT 1 FROM public.firma_kullanicilar fk
        WHERE fk.user_id = auth.uid()
          AND fk.firma_id::text = split_part(name, '/', 1)
      )
      OR EXISTS (
        SELECT 1 FROM public.suruculer s
        WHERE s.auth_user_id = auth.uid()
          AND s.firma_id::text = split_part(name, '/', 1)
      )
    )
  );

-- UPDATE (upsert için gerekli)
CREATE POLICY pod_docs_update_firma
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'pod-documents'
    AND (
      EXISTS (
        SELECT 1 FROM public.firma_kullanicilar fk
        WHERE fk.user_id = auth.uid()
          AND fk.firma_id::text = split_part(name, '/', 1)
      )
      OR EXISTS (
        SELECT 1 FROM public.suruculer s
        WHERE s.auth_user_id = auth.uid()
          AND s.firma_id::text = split_part(name, '/', 1)
      )
    )
  );

COMMIT;

-- =============================================================================
-- TEST
-- =============================================================================
-- Bir sürücünün auth.uid()'siyle test:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" TO '{"sub":"<sürücü-auth-id>"}';
--   SELECT storage.is_admin();  -- false bekleniyor
--   -- INSERT çağrısı policy'den geçmeli
-- =============================================================================
