-- 2026-05-09c — Ofis kullanıcı davet sistemi (Faz 2)
--
-- AMAÇ:
--   Sahip / yönetici, ofis ekibini (operasyoncu, muhasebeci, başka yönetici)
--   email + rol ile davet edebilsin. Davet edilen kişi davet linkini alır,
--   sayfaya gelir, email + şifre + ad ile signUp yapar, sonra RPC ile
--   firma_kullanicilar tablosuna ilgili rol ile eklenir.
--
-- AKIŞ:
--   1. Yönetici "Davet Oluştur" → RPC firma_kullanici_davet_olustur
--      → davet_kodu üretilir, expires_at = +48h
--      → frontend davet linki gösterir, yönetici WhatsApp/email ile gönderir
--   2. Davet edilen accept-invite.html?kod=XXX'e gelir
--      → email + şifre + ad gir → supabase.auth.signUp()
--      → RPC firma_kullanici_davet_kabul_et(p_kod) çağrılır
--      → firma_kullanicilar(user_id, firma_id, rol) INSERT
--      → davet kullanildi_at = now()
--   3. Ekip yönetim paneli (Faz 2 UI):
--      → firma_kullanici_listele — aktif + bekleyenler
--      → firma_kullanici_rol_degistir
--      → firma_kullanici_kaldir
--
-- NOT: Sahip rolü atanamaz (sahibi tek olmalı, transfer ayrı bir akış).
-- Roller: yonetici, operasyoncu, muhasebeci (sürücü ayrı sistemi var).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tablo
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.firma_kullanici_davetleri (
  id               bigserial primary key,
  firma_id         uuid not null references public.firmalar(id) on delete cascade,
  davet_eden       uuid not null references auth.users(id) on delete set null,
  email            text not null,
  rol              text not null check (rol in ('yonetici', 'operasyoncu', 'muhasebeci')),
  ad               text,
  davet_kodu       text not null unique,
  expires_at       timestamptz not null default (now() + interval '48 hours'),
  kullanildi_at    timestamptz,
  kullanan_user_id uuid references auth.users(id) on delete set null,
  iptal_mi         boolean not null default false,
  iptal_at         timestamptz,
  notlar           text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_fkd_firma_created
  on public.firma_kullanici_davetleri (firma_id, created_at desc);

create unique index if not exists idx_fkd_kod
  on public.firma_kullanici_davetleri (davet_kodu);

-- Aynı email için aktif (kullanılmamış+iptal değil) tek davet
create unique index if not exists idx_fkd_aktif_email
  on public.firma_kullanici_davetleri (firma_id, lower(email))
  where kullanildi_at is null and iptal_mi = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS — RPC'ler SECURITY DEFINER, ama doğrudan SELECT için politika lazım
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.firma_kullanici_davetleri enable row level security;

drop policy if exists fkd_select on public.firma_kullanici_davetleri;
create policy fkd_select on public.firma_kullanici_davetleri
  for select to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()));

-- INSERT/UPDATE/DELETE yalnızca SECURITY DEFINER RPC üzerinden
drop policy if exists fkd_insert on public.firma_kullanici_davetleri;
create policy fkd_insert on public.firma_kullanici_davetleri
  for insert to authenticated
  with check (false);   -- direct INSERT yasak, RPC zorunlu

drop policy if exists fkd_update on public.firma_kullanici_davetleri;
create policy fkd_update on public.firma_kullanici_davetleri
  for update to authenticated
  using (false);   -- direct UPDATE yasak, RPC zorunlu

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPC — davet oluştur
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.firma_kullanici_davet_olustur(
  p_email text,
  p_rol   text,
  p_ad    text default null,
  p_notlar text default null
)
returns table (davet_id bigint, davet_kodu text, expires_at timestamptz, davet_link text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_firma  uuid;
  v_kod    text := upper(substr(md5(gen_random_uuid()::text), 1, 10));
  v_id     bigint;
  v_exp    timestamptz;
  v_email  text := lower(trim(p_email));
begin
  -- Yetki kontrolü: çağıran sahip veya yönetici olmalı
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid
     and fk.rol in ('sahip', 'yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok — yalnızca sahip veya yönetici davet gönderebilir'
      using errcode = '42501';
  end if;

  -- Email + rol validasyonu
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Geçersiz email' using errcode = '22023';
  end if;
  if p_rol not in ('yonetici', 'operasyoncu', 'muhasebeci') then
    raise exception 'Geçersiz rol — yonetici / operasyoncu / muhasebeci olmalı'
      using errcode = '22023';
  end if;

  -- Aynı email zaten firma_kullanicilar'da mı?
  if exists (
    select 1 from public.firma_kullanicilar fk
    join auth.users u on u.id = fk.user_id
    where fk.firma_id = v_firma and lower(u.email) = v_email
  ) then
    raise exception 'Bu email zaten firmada kayıtlı kullanıcı'
      using errcode = '23505';
  end if;

  -- Aynı email için aktif davet varsa eskisini iptal et
  update public.firma_kullanici_davetleri
     set iptal_mi = true, iptal_at = now()
   where firma_id = v_firma
     and lower(email) = v_email
     and kullanildi_at is null
     and iptal_mi = false;

  -- Yeni davet
  insert into public.firma_kullanici_davetleri (
    firma_id, davet_eden, email, rol, ad, davet_kodu, notlar
  ) values (
    v_firma, v_uid, v_email, p_rol, p_ad, v_kod, p_notlar
  )
  returning id, expires_at into v_id, v_exp;

  return query select
    v_id,
    v_kod,
    v_exp,
    'https://fleetly.fit/accept-invite.html?kod=' || v_kod;
end $$;

revoke all on function public.firma_kullanici_davet_olustur(text, text, text, text) from public;
grant execute on function public.firma_kullanici_davet_olustur(text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RPC — davet kabul et
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.firma_kullanici_davet_kabul_et(
  p_kod text
)
returns table (firma_id uuid, rol text, firma_adi text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_davet  public.firma_kullanici_davetleri%rowtype;
  v_firma_adi text;
begin
  if v_uid is null then
    raise exception 'Önce giriş yapmanız gerekiyor' using errcode = '42501';
  end if;

  -- Kullanıcının email'i lazım — auth.users'tan al
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'Kullanıcı email bulunamadı' using errcode = '42501';
  end if;

  -- Daveti bul
  select * into v_davet
    from public.firma_kullanici_davetleri
   where davet_kodu = upper(trim(p_kod))
   limit 1;
  if v_davet.id is null then
    raise exception 'Davet kodu bulunamadı' using errcode = '22023';
  end if;
  if v_davet.iptal_mi then
    raise exception 'Davet iptal edilmiş' using errcode = '22023';
  end if;
  if v_davet.kullanildi_at is not null then
    raise exception 'Davet zaten kullanılmış' using errcode = '22023';
  end if;
  if v_davet.expires_at < now() then
    raise exception 'Davet süresi dolmuş — yeni davet isteyin' using errcode = '22023';
  end if;

  -- Email eşleşme kontrolü (case-insensitive)
  if lower(v_davet.email) <> lower(v_email) then
    raise exception 'Bu davet farklı bir email için oluşturulmuş (% / %)', v_davet.email, v_email
      using errcode = '42501';
  end if;

  -- firma_kullanicilar'a ekle (aynı firma_id + user_id varsa rol UPDATE et)
  insert into public.firma_kullanicilar (user_id, firma_id, rol)
  values (v_uid, v_davet.firma_id, v_davet.rol)
  on conflict (user_id, firma_id) do update
     set rol = excluded.rol;

  -- Daveti kullanıldı işaretle
  update public.firma_kullanici_davetleri
     set kullanildi_at    = now(),
         kullanan_user_id = v_uid
   where id = v_davet.id;

  -- Firma adını döndür
  select ad into v_firma_adi from public.firmalar where id = v_davet.firma_id;

  return query select v_davet.firma_id, v_davet.rol, coalesce(v_firma_adi, 'Firma');
end $$;

revoke all on function public.firma_kullanici_davet_kabul_et(text) from public;
grant execute on function public.firma_kullanici_davet_kabul_et(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPC — kullanıcı listesi (aktif + bekleyen davet)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.firma_kullanici_listele()
returns table (
  user_id    uuid,
  email      text,
  ad         text,
  rol        text,
  durum      text,        -- 'aktif' | 'davet_bekliyor'
  davet_id   bigint,
  davet_kodu text,
  davet_link text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_firma uuid;
begin
  -- Yetki kontrolü
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid
     and fk.rol in ('sahip', 'yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok' using errcode = '42501';
  end if;

  return query
  -- Aktif kullanıcılar
  select
    fk.user_id,
    u.email::text,
    coalesce((u.raw_user_meta_data->>'ad')::text, u.email::text) as ad,
    fk.rol,
    'aktif'::text                  as durum,
    null::bigint                   as davet_id,
    null::text                     as davet_kodu,
    null::text                     as davet_link,
    null::timestamptz              as expires_at,
    u.created_at
  from public.firma_kullanicilar fk
  join auth.users u on u.id = fk.user_id
  where fk.firma_id = v_firma
  union all
  -- Bekleyen davetler
  select
    null::uuid                     as user_id,
    d.email,
    d.ad,
    d.rol,
    'davet_bekliyor'::text         as durum,
    d.id                           as davet_id,
    d.davet_kodu,
    'https://fleetly.fit/accept-invite.html?kod=' || d.davet_kodu as davet_link,
    d.expires_at,
    d.created_at
  from public.firma_kullanici_davetleri d
  where d.firma_id = v_firma
    and d.kullanildi_at is null
    and d.iptal_mi = false
    and d.expires_at > now()
  order by created_at desc;
end $$;

revoke all on function public.firma_kullanici_listele() from public;
grant execute on function public.firma_kullanici_listele() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RPC — rol değiştir
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.firma_kullanici_rol_degistir(
  p_user_id uuid,
  p_yeni_rol text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_firma  uuid;
  v_eski_rol text;
begin
  -- Yetki: sahip veya yönetici
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid and fk.rol in ('sahip','yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok' using errcode = '42501';
  end if;

  -- Yeni rol kontrolü — sahip rolü atanamaz (transfer ayrı akış)
  if p_yeni_rol not in ('yonetici','operasyoncu','muhasebeci') then
    raise exception 'Rol yalnızca yonetici / operasyoncu / muhasebeci olabilir'
      using errcode = '22023';
  end if;

  -- Hedef kullanıcının mevcut rolünü oku
  select rol into v_eski_rol
    from public.firma_kullanicilar
   where user_id = p_user_id and firma_id = v_firma;
  if v_eski_rol is null then
    raise exception 'Kullanıcı bu firmada bulunamadı' using errcode = '22023';
  end if;
  if v_eski_rol = 'sahip' then
    raise exception 'Sahibinin rolü değiştirilemez' using errcode = '42501';
  end if;
  -- Yönetici başka bir yöneticinin rolünü değiştiremez (sadece sahip)
  if v_eski_rol = 'yonetici' then
    if not exists (
      select 1 from public.firma_kullanicilar
      where user_id = v_uid and firma_id = v_firma and rol = 'sahip'
    ) then
      raise exception 'Yöneticinin rolünü yalnızca sahip değiştirebilir'
        using errcode = '42501';
    end if;
  end if;

  update public.firma_kullanicilar
     set rol = p_yeni_rol
   where user_id = p_user_id and firma_id = v_firma;
end $$;

revoke all on function public.firma_kullanici_rol_degistir(uuid, text) from public;
grant execute on function public.firma_kullanici_rol_degistir(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RPC — kullanıcı kaldır (firma'dan çıkar)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.firma_kullanici_kaldir(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_firma  uuid;
  v_target_rol text;
begin
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid and fk.rol in ('sahip','yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok' using errcode = '42501';
  end if;

  -- Kendini silemez
  if p_user_id = v_uid then
    raise exception 'Kendinizi kaldıramazsınız' using errcode = '42501';
  end if;

  select rol into v_target_rol
    from public.firma_kullanicilar
   where user_id = p_user_id and firma_id = v_firma;
  if v_target_rol is null then
    raise exception 'Kullanıcı bu firmada yok' using errcode = '22023';
  end if;
  if v_target_rol = 'sahip' then
    raise exception 'Sahibi kaldırılamaz' using errcode = '42501';
  end if;
  -- Yönetici başka yöneticiyi kaldıramaz (sadece sahip)
  if v_target_rol = 'yonetici' then
    if not exists (
      select 1 from public.firma_kullanicilar
      where user_id = v_uid and firma_id = v_firma and rol = 'sahip'
    ) then
      raise exception 'Yöneticiyi yalnızca sahip kaldırabilir'
        using errcode = '42501';
    end if;
  end if;

  delete from public.firma_kullanicilar
   where user_id = p_user_id and firma_id = v_firma;
end $$;

revoke all on function public.firma_kullanici_kaldir(uuid) from public;
grant execute on function public.firma_kullanici_kaldir(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) RPC — daveti iptal et (kullanılmadan önce)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.firma_kullanici_davet_iptal(
  p_davet_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_firma  uuid;
begin
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid and fk.rol in ('sahip','yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok' using errcode = '42501';
  end if;

  update public.firma_kullanici_davetleri
     set iptal_mi = true, iptal_at = now()
   where id = p_davet_id
     and firma_id = v_firma
     and kullanildi_at is null
     and iptal_mi = false;
end $$;

revoke all on function public.firma_kullanici_davet_iptal(bigint) from public;
grant execute on function public.firma_kullanici_davet_iptal(bigint) to authenticated;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOĞRULAMA
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Yönetici hesabıyla davet oluştur:
--    select * from firma_kullanici_davet_olustur('test@x.com', 'operasyoncu', 'Mehmet');
-- 2. Davet listesini gör:
--    select * from firma_kullanici_listele();
-- 3. test@x.com hesabı oluştur (signup), accept-invite.html?kod=XXX ile gel:
--    select * from firma_kullanici_davet_kabul_et('XXX');
-- 4. Listeyi tekrar gör — yeni kullanıcı 'aktif' olmuş olmalı.
