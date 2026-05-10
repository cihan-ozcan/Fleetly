-- =============================================================================
-- FLEETLY  —  2026-05-10e  —  GÜVENLİK: Eski RLS policy temizliği
-- =============================================================================
-- 2026_05_10d sonrası arac_arizalari/bakim_kayitlari/surucu_belgeler tablolarında
-- yeni `_v2_*` policy'leri oluşturuldu, ama Supabase Dashboard'dan elle eklenmiş
-- eski policy'ler hâlâ paralel duruyor.
--
-- POSTGRESQL POLICY BIRLESIM MANTIGI:
--   PERMISSIVE → OR ile birleşir (en geniş policy etkili)
--   RESTRICTIVE → AND ile birleşir (hepsinin true dönmesi gerek)
--
-- DROP nedenleri:
--   - {public} rolü = anon dahil → tenant-leak riski
--   - _v2_* policy'leri ile işlevsel olarak duplicate
--   - PERMISSIVE birleşim → fazla policy ek değer eklemiyor, gizli sızıntı kaynağı
--
-- KEEP edilenler (RESTRICTIVE, şoför erişimini sınırlıyor — kritik işlev):
--   - bakim_kayitlari.sofor_gizli_bakim     (şoför bakım kayıtlarını görmesin)
--   - surucu_belgeler.sofor_srcb_select     (şoför sadece kendi belgesini görsün)
--   - surucu_belgeler.sofor_srcb_update     (şoför sadece kendi belgesini güncellesin)
--
-- BAĞIMLILIK: 2026_05_10d (yeni _v2_* policy'leri orada oluşturuldu)
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- arac_arizalari — 4 eski policy DROP (yeni _v2_* aynı işlevi yapıyor)
-- Eski policy'ler authenticated rol; firma_id ve auth_user_id check'leri zaten
-- _v2_* tarafından sağlanıyor (üstelik daha sıkı: muhasebeci de yetkili).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists arac_ariza_surucu_insert  on public.arac_arizalari;
drop policy if exists arac_ariza_surucu_select  on public.arac_arizalari;
drop policy if exists arac_ariza_surucu_update  on public.arac_arizalari;
drop policy if exists arac_ariza_yonetici_all   on public.arac_arizalari;

-- ─────────────────────────────────────────────────────────────────────────────
-- bakim_kayitlari — 3 PERMISSIVE policy DROP, 1 RESTRICTIVE KEEP
-- ─────────────────────────────────────────────────────────────────────────────
-- "Ayni firma bakim": {public} rolü + tanımı bilinmeyen get_firma_id() — riskli
drop policy if exists "Ayni firma bakim"                 on public.bakim_kayitlari;
-- "Kullanici kendi verilerini yonetir": {public} + sadece user_id check (firma izolasyonu yok)
drop policy if exists "Kullanici kendi verilerini yonetir" on public.bakim_kayitlari;
-- "firma_izolasyon": {public} rol + _v2_* ile aynı işlev (duplicate)
drop policy if exists firma_izolasyon                    on public.bakim_kayitlari;
-- KEEP: sofor_gizli_bakim (RESTRICTIVE — şoförleri bakım kayıtlarından engelliyor)

-- ─────────────────────────────────────────────────────────────────────────────
-- surucu_belgeler — 6 PERMISSIVE policy DROP, 2 RESTRICTIVE KEEP
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Firma üyeleri görebilir"         on public.surucu_belgeler;
drop policy if exists "Kullanici kendi suruculerini gorur" on public.surucu_belgeler;
drop policy if exists firma_izolasyon                   on public.surucu_belgeler;
drop policy if exists sofor_kendi_kaydini_okur          on public.surucu_belgeler;
drop policy if exists surucu_select                     on public.surucu_belgeler;
drop policy if exists surucu_upsert                     on public.surucu_belgeler;
-- KEEP:
--   sofor_srcb_select  (RESTRICTIVE — şoför sadece kendi user_id'sine ait belgeleri görür)
--   sofor_srcb_update  (RESTRICTIVE — şoför sadece kendi belgesini günceller)

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Kalan policy listesi:
--    SELECT tablename, policyname, permissive, cmd
--      FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN ('arac_arizalari','bakim_kayitlari','surucu_belgeler')
--     ORDER BY tablename, permissive desc, policyname;
--    Beklenen:
--      arac_arizalari    → 4 _v2_* (PERMISSIVE)
--      bakim_kayitlari   → 2 _v2_* (PERMISSIVE) + sofor_gizli_bakim (RESTRICTIVE)
--      surucu_belgeler   → 2 _v2_* (PERMISSIVE) + sofor_srcb_select / _update (RESTRICTIVE)
--
-- 2) Tenant izolasyon testi (kullanıcı A login):
--    SELECT count(DISTINCT firma_id) FROM bakim_kayitlari;     -- 0 veya 1
--    SELECT count(DISTINCT firma_id) FROM arac_arizalari;
--    SELECT count(DISTINCT firma_id) FROM surucu_belgeler;
--
-- 3) Şoför erişim regression testi (şoför hesabıyla login):
--    SELECT count(*) FROM bakim_kayitlari;
--    -> 0 (sofor_gizli_bakim RESTRICTIVE ile engelleniyor)
--    SELECT count(*) FROM surucu_belgeler;
--    -> sadece kendi user_id'sine ait belgeler (sofor_srcb_select RESTRICTIVE)
-- =============================================================================
