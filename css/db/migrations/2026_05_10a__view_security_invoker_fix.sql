-- =============================================================================
-- FLEETLY  —  2026-05-10a  —  GÜVENLİK HOTFIX: View'larda security_invoker
-- =============================================================================
-- KRİTİK MULTI-TENANT SIZINTI:
--   PostgreSQL 15+ default davranışında VIEW'lar 'security_definer' modunda
--   çalışır → view'ı oluşturan postgres rolünün yetkileriyle sorgu yapar.
--   Bu durumda underlying tablo üzerindeki RLS politikaları BYPASS edilir.
--
--   Sonuç: Frontend `v_arac_secim?select=*` çağırdığında, kullanıcı KENDİ
--   firmasında olmayan başka tenant'ların araçlarını da görüyordu. Aynı
--   açık `v_surucu_dosyasi`, `v_aktif_eslesmeler`, `v_bildirimler_son`,
--   `v_surucu_feed`, `v_harcirah_haftalik_ozet`, `is_emri_guzergah_ozet`,
--   `v_abonelik_durumu`, `v_bakim_dashboard_ozet`,
--   `v_surucu_belge_uyarilari` view'larında da geçerliydi.
--
-- ÇÖZÜM:
--   ALTER VIEW ... SET (security_invoker = on)  — PostgreSQL 15+ yerleşik
--   özelliği. View sorgusu çağıran kullanıcının yetkileriyle çalışır →
--   underlying tablonun RLS politikaları devreye girer ve firma_id
--   bazlı tenant izolasyonu uygulanır.
--
-- BAĞIMLILIK:
--   2026_05_07b__rls_emergency_fix.sql       (underlying tablolarda RLS açık)
--   2026_05_07g__multi_tenant_audit_fix.sql  (audit tablo RLS)
--
-- TEST:
--   - Kullanıcı A login → SELECT count(DISTINCT firma_id) FROM v_arac_secim
--     -> sadece 1 firma_id dönmeli (yalnızca kendi firması)
-- =============================================================================

begin;

-- v_sefer_detay zaten security_invoker (2026_05_07i'de tanımlandı), yine de
-- idempotent olarak listede tutuyoruz.
alter view if exists public.v_arac_secim                set (security_invoker = on);
alter view if exists public.v_surucu_dosyasi            set (security_invoker = on);
alter view if exists public.v_surucu_belge_uyarilari    set (security_invoker = on);
alter view if exists public.v_aktif_eslesmeler          set (security_invoker = on);
alter view if exists public.v_harcirah_haftalik_ozet    set (security_invoker = on);
alter view if exists public.v_bildirimler_son           set (security_invoker = on);
alter view if exists public.v_surucu_feed               set (security_invoker = on);
alter view if exists public.is_emri_guzergah_ozet       set (security_invoker = on);
alter view if exists public.v_abonelik_durumu           set (security_invoker = on);
alter view if exists public.v_bakim_dashboard_ozet      set (security_invoker = on);
alter view if exists public.v_sefer_detay               set (security_invoker = on);

-- Doğrulama: public şemasındaki tüm view'larda security_invoker=on olduğunu
-- raporla. Yeni eklenen ama bu listede atlanmış bir view varsa WARNING düşer.
do $$
declare
  v record;
  bad_count int := 0;
begin
  for v in
    select c.relname as name, c.reloptions as opts
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'v'
       and n.nspname = 'public'
  loop
    if v.opts is null or not (v.opts @> array['security_invoker=on']) then
      raise warning '⚠ public.% view security_invoker=on degil — opts=%',
        v.name, coalesce(array_to_string(v.opts, ','), '<yok>');
      bad_count := bad_count + 1;
    end if;
  end loop;
  if bad_count > 0 then
    raise warning '⚠ % public view definer modunda — manuel inceleme gerek!', bad_count;
  else
    raise notice '✓ Tum public view''lar security_invoker=on';
  end if;
end $$;

-- PostgREST schema cache'i yenile (Supabase REST API için)
notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA (manuel)
-- =============================================================================
-- 1) Tüm view'ların durumu:
--    SELECT c.relname,
--           COALESCE(array_to_string(c.reloptions, ', '), '<none>') AS opts
--      FROM pg_class c
--      JOIN pg_namespace n ON n.oid = c.relnamespace
--     WHERE c.relkind = 'v' AND n.nspname = 'public'
--     ORDER BY c.relname;
--    Beklenen: hepsinde 'security_invoker=on' görmek.
--
-- 2) Tenant izolasyon testi (ofis kullanıcısı olarak login olduktan sonra):
--    SELECT count(DISTINCT firma_id) FROM v_arac_secim;
--    -> 1 olmalı (sadece kendi firma_id'sini görmeli)
--    SELECT count(*) FROM v_arac_secim;
--    -> kendi firmanızdaki araç sayısı kadar
-- =============================================================================
