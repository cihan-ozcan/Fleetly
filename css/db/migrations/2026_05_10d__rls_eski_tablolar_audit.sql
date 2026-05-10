-- =============================================================================
-- FLEETLY  —  2026-05-10d  —  GÜVENLİK: Eski tablolarda RLS + tarifeler/teklifler şema fix
-- =============================================================================
-- AÇIK 1 — `tarifeler` ve `teklifler` şema uyumsuz:
--   firma_id BIGINT olarak tanımlı, firmalar.id UUID. Foreign key yok, RLS yok.
--   → Her tenant birbirinin tarifelerini/tekliflerini görüyor (sızıntı).
--   → 2026_05_07g notu: "tarifeler şema uyumsuz, ayrı PR" — bu o PR.
--
-- AÇIK 2 — RLS açılmamış kritik tablolar:
--   - bakim_kayitlari    (eski bakım kayıtları, frontend aktif kullanıyor)
--   - arac_arizalari     (sürücü arıza bildirimleri, frontend aktif kullanıyor)
--   - surucu_belgeler    (eski belgeler tablosu — yeni `surucu_belgeleri` ile sync)
--
-- ÇÖZÜM:
--   1) PRE-CHECK: tarifeler/teklifler boş olmalı (BIGINT→UUID dönüşümü kayıp riski)
--   2) tek büyük DO bloğunda: bağımlı view'ları bul/drop/recreate + ALTER COLUMN
--      (TEMP TABLE kullanmıyoruz — Supabase SQL Editor "Run and enable RLS"
--       özelliği transaction'ı parçalayabiliyor; PL/pgSQL local JSONB değişkeni
--       her durumda güvenli.)
--   3) Sonra normal SQL ile RLS + policy ekle
--
-- BAĞIMLILIK:
--   2026_05_07b__rls_emergency_fix.sql (_user_firma_ids, _user_firma_yetkili_ids)
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-CHECK: tarifeler ve teklifler boş olmalı
-- BIGINT→UUID cast deterministik değil; mevcut firma_id değerleri kayıp.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.tarifeler;
  if v_cnt > 0 then
    raise exception 'tarifeler tablosunda % kayıt var — firma_id BIGINT->UUID dönüşümü için önce kayıtları manuel temizleyin veya ayrı strateji belirleyin (veri kaybı riski).', v_cnt;
  end if;

  select count(*) into v_cnt from public.teklifler;
  if v_cnt > 0 then
    raise exception 'teklifler tablosunda % kayıt var — firma_id BIGINT->UUID dönüşümü için önce kayıtları manuel temizleyin veya ayrı strateji belirleyin (veri kaybı riski).', v_cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BÜYÜK DO BLOĞU: View discovery → drop → ALTER COLUMN → view recreate
-- Tek transaction içinde JSONB local variable ile state taşınıyor.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_defs jsonb := '{}'::jsonb;
  r record;
  v_name text;
begin
  -- 0) ÖNCE policy'leri drop et — önceki başarısız çalıştırmadan kalan policy'ler
  --    firma_id kolonuna bağımlı olduğu için ALTER COLUMN reddedilir. Bu adım
  --    idempotent: yoksa drop sessiz geçer.
  for r in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('tarifeler', 'teklifler')
  loop
    execute 'drop policy ' || quote_ident(r.policyname) || ' on public.' || quote_ident(r.tablename);
    raise notice 'Eski policy drop edildi: % on %', r.policyname, r.tablename;
  end loop;

  -- 1) tarifeler.firma_id veya teklifler.firma_id'ye bağımlı view'ları bul
  for r in
    select distinct dv.relname as name,
           pg_get_viewdef(('public.' || dv.relname)::regclass, true) as def
      from pg_depend pd
      join pg_rewrite pr on pd.objid = pr.oid
      join pg_class dv on pr.ev_class = dv.oid
      join pg_class src on pd.refobjid = src.oid
      join pg_attribute pa on pd.refobjid = pa.attrelid
                           and pd.refobjsubid = pa.attnum
      join pg_namespace dn on dv.relnamespace = dn.oid
      join pg_namespace sn on src.relnamespace = sn.oid
     where src.relname in ('teklifler', 'tarifeler')
       and sn.nspname = 'public'
       and pa.attname = 'firma_id'
       and dv.relkind = 'v'
       and dn.nspname = 'public'
  loop
    v_defs := v_defs || jsonb_build_object(r.name, r.def);
    raise notice 'Bagimli view bulundu: public.%', r.name;
  end loop;

  -- 2) Bulunan view'ları drop et (cascade — başka view'lar da bağımlıysa onlar da)
  for v_name in select jsonb_object_keys(v_defs)
  loop
    execute 'drop view if exists public.' || quote_ident(v_name) || ' cascade';
    raise notice 'Drop edildi: public.%', v_name;
  end loop;

  -- 3) tarifeler.firma_id BIGINT → UUID + FK
  execute 'alter table public.tarifeler drop constraint if exists tarifeler_firma_id_fkey';
  execute 'alter table public.tarifeler alter column firma_id type uuid using null';
  execute 'alter table public.tarifeler add constraint tarifeler_firma_id_fkey '
       || 'foreign key (firma_id) references public.firmalar(id) on delete cascade';

  -- 4) teklifler.firma_id BIGINT → UUID + FK
  execute 'alter table public.teklifler drop constraint if exists teklifler_firma_id_fkey';
  execute 'alter table public.teklifler alter column firma_id type uuid using null';
  execute 'alter table public.teklifler add constraint teklifler_firma_id_fkey '
       || 'foreign key (firma_id) references public.firmalar(id) on delete cascade';

  -- 5) View'ları yeniden oluştur + security_invoker=on (2026_05_10a politikası)
  for v_name in select jsonb_object_keys(v_defs)
  loop
    execute 'create view public.' || quote_ident(v_name) || ' as ' || (v_defs->>v_name);
    execute 'alter view public.' || quote_ident(v_name) || ' set (security_invoker = on)';
    execute 'grant select on public.' || quote_ident(v_name) || ' to authenticated';
    raise notice 'Yeniden olusturuldu: public.% (security_invoker=on)', v_name;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) tarifeler — RLS + policy
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.tarifeler enable row level security;

drop policy if exists tarifeler_v2_select on public.tarifeler;
create policy tarifeler_v2_select on public.tarifeler
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists tarifeler_v2_modify on public.tarifeler;
create policy tarifeler_v2_modify on public.tarifeler
  for all to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) teklifler — RLS + policy
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.teklifler enable row level security;

drop policy if exists teklifler_v2_select on public.teklifler;
create policy teklifler_v2_select on public.teklifler
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists teklifler_v2_modify on public.teklifler;
create policy teklifler_v2_modify on public.teklifler
  for all to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) bakim_kayitlari — RLS açılması atlanmıştı
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.bakim_kayitlari enable row level security;

drop policy if exists bakim_kayitlari_v2_select on public.bakim_kayitlari;
create policy bakim_kayitlari_v2_select on public.bakim_kayitlari
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists bakim_kayitlari_v2_modify on public.bakim_kayitlari;
create policy bakim_kayitlari_v2_modify on public.bakim_kayitlari
  for all to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) arac_arizalari — RLS açılması atlanmıştı (frontend aktif kullanıyor)
-- ─────────────────────────────────────────────────────────────────────────────
-- Şoför kendi açtığı arızayı görür/günceller; ofis (yetkili) firma'nın tüm
-- arızalarını yönetir. firma_id NOT NULL.
alter table public.arac_arizalari enable row level security;

drop policy if exists arac_arizalari_v2_select on public.arac_arizalari;
create policy arac_arizalari_v2_select on public.arac_arizalari
  for select to authenticated
  using (
    firma_id in (select public._user_firma_ids())
    or surucu_id in (select id from public.suruculer where auth_user_id = auth.uid())
  );

drop policy if exists arac_arizalari_v2_insert on public.arac_arizalari;
create policy arac_arizalari_v2_insert on public.arac_arizalari
  for insert to authenticated
  with check (
    firma_id in (select public._user_firma_ids())
  );

drop policy if exists arac_arizalari_v2_update on public.arac_arizalari;
create policy arac_arizalari_v2_update on public.arac_arizalari
  for update to authenticated
  using (
    firma_id in (select public._user_firma_yetkili_ids())
    or surucu_id in (select id from public.suruculer where auth_user_id = auth.uid())
  )
  with check (
    firma_id in (select public._user_firma_yetkili_ids())
    or surucu_id in (select id from public.suruculer where auth_user_id = auth.uid())
  );

drop policy if exists arac_arizalari_v2_delete on public.arac_arizalari;
create policy arac_arizalari_v2_delete on public.arac_arizalari
  for delete to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) surucu_belgeler (eski tablo) — RLS açılması atlanmıştı
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT: Bu tablo eski şema; yeni `surucu_belgeleri` ile birlikte kullanılıyor.
-- Frontend hâlâ okuyup yazıyor; tamamen drop etmek refactor gerektirir.
-- Şu an en azından RLS açıp tenant izolasyonu sağlıyoruz. firma_id NULLABLE —
-- NULL satırlar (varsa) policy ile gizlenir (kimseye görünmez).
alter table public.surucu_belgeler enable row level security;

drop policy if exists surucu_belgeler_v2_select on public.surucu_belgeler;
create policy surucu_belgeler_v2_select on public.surucu_belgeler
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists surucu_belgeler_v2_modify on public.surucu_belgeler;
create policy surucu_belgeler_v2_modify on public.surucu_belgeler
  for all to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- PostgREST cache'i yenile
notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Şema dönüşümü:
--    SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema='public' AND column_name='firma_id'
--       AND table_name IN ('tarifeler','teklifler');
--    -> data_type = 'uuid' bekleniyor.
--
-- 2) RLS durumu:
--    SELECT tablename, rowsecurity FROM pg_tables
--     WHERE schemaname='public'
--       AND tablename IN ('tarifeler','teklifler','bakim_kayitlari',
--                         'arac_arizalari','surucu_belgeler');
--    -> hepsi rowsecurity=true bekleniyor.
--
-- 3) Tenant izolasyon testi (kullanıcı A login):
--    SELECT count(DISTINCT firma_id) FROM tarifeler;     -- 0 veya 1 (kendi)
--    SELECT count(DISTINCT firma_id) FROM teklifler;
--    SELECT count(DISTINCT firma_id) FROM bakim_kayitlari;
--    SELECT count(DISTINCT firma_id) FROM arac_arizalari;
--    SELECT count(DISTINCT firma_id) FROM surucu_belgeler;
-- =============================================================================
