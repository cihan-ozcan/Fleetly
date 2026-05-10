-- =============================================================================
-- FLEETLY  —  2026-05-10c  —  GÜVENLİK: pod_docs_select_anon policy kaldırıldı
-- =============================================================================
-- AÇIK:
--   2026_04_29c migration'ında eklenen `pod_docs_select_anon` policy yalnızca
--   bucket_id eşleşmesini kontrol ediyordu — anon rolündeki herhangi biri
--   pod-documents bucket'taki HER dosyaya erişebilirdi (path/URL'i bilse).
--
--     CREATE POLICY pod_docs_select_anon ON storage.objects FOR SELECT TO anon
--       USING (bucket_id = 'pod-documents');
--
--   Comment "Sofor.html anonim erişimi (token-link) için" diyor; fakat
--   2026_05_07 accept-driver-invite refactor'unda şoförler password-based
--   auth'lu hale geldi. sofor.html ARTIK pod-documents bucket'ını kullanmıyor;
--   yalnızca `operasyon-foto` ve `operasyon-imza` (ayrı public bucket'lar).
--
-- ÇÖZÜM:
--   pod_docs_select_anon policy'sini drop et. Auth'lu erişim
--   2026_04_30__pod_rls_fix.sql'deki üç policy'den sağlanmaya devam eder
--   (pod_docs_select_firma, pod_docs_insert_firma, pod_docs_update_firma —
--   firma_kullanicilar VEYA suruculer.auth_user_id ile path filtreli).
--
-- BAĞIMLILIK:
--   2026_04_29c__pod_sistemi.sql        (bucket + ilk anon policy)
--   2026_04_30__pod_rls_fix.sql         (auth'lu firma path policy'leri)
-- =============================================================================

begin;

drop policy if exists pod_docs_select_anon on storage.objects;

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Anon select policy kalmamış olmalı:
--    SELECT policyname FROM pg_policies
--     WHERE schemaname = 'storage' AND tablename = 'objects'
--       AND policyname LIKE 'pod_docs%';
--    -> Beklenen: pod_docs_select_firma, pod_docs_insert_firma,
--                 pod_docs_update_firma (3 satır, anon yok)
--
-- 2) Anon erişim regression testi (anon API key ile):
--    curl -H "apikey: <ANON_KEY>" \
--      "<SUPABASE_URL>/storage/v1/object/pod-documents/<bilinen-bir-path>"
--    -> 401/403 bekleniyor (eskiden 200 dönüyordu).
--
-- 3) Auth'lu kullanıcı için regression yok:
--    Ofis/şoför login → kendi firma'sının POD belgesini görme akışı
--    pod_docs_select_firma policy ile çalışmaya devam eder.
-- =============================================================================
