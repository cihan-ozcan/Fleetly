-- 2026-05-08b — Sürücü kendi FCM token'ını yazabilsin (SECURITY DEFINER RPC)
--
-- KÖK NEDEN
-- ---------
-- suruculer tablosunda RLS UPDATE policy'si _user_firma_yetkili_ids()
-- kullanıyor — yani sadece sahip/yönetici/operasyoncu rolündeki
-- firma_kullanicilar UPDATE yapabiliyor. Sürücü, kendi satırındaki
-- fcm_token alanını dahi yazamıyor.
--
-- Sonuç: trg_is_emri_atama_push trigger'ı çalışıyor ama
--   select fcm_token into v_token from suruculer where id = NEW.surucu_id;
-- NULL dönüyor → trigger sessizce return ediyor → hiç push gönderilmiyor.
--
-- Aynı durum push_subscription (web push) ve son_giris alanları için de var.
--
-- ÇÖZÜM
-- -----
-- Sürücü için sadece kendi satırını ve sadece şu üç alanı güncelleyebilen
-- SECURITY DEFINER bir RPC ekliyoruz. Mobile bunu çağıracak (direkt UPDATE
-- yerine).

-- --------------------------------------------------------------
-- 1) FCM token kaydetme RPC
-- --------------------------------------------------------------
create or replace function public.surucu_fcm_token_kaydet(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Oturum bulunamadı (auth.uid is null)';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'Token boş olamaz';
  end if;

  update public.suruculer
     set fcm_token = p_token,
         updated_at = now()
   where auth_user_id = v_uid;

  -- son_giris'i de güncelle (mobil heartbeat'i)
  update public.suruculer
     set son_giris = now()
   where auth_user_id = v_uid;
end;
$$;

revoke all on function public.surucu_fcm_token_kaydet(text) from public;
grant execute on function public.surucu_fcm_token_kaydet(text) to authenticated;

-- --------------------------------------------------------------
-- 2) Web Push subscription kaydetme RPC (ileride lazım olur)
-- --------------------------------------------------------------
create or replace function public.surucu_push_subscription_kaydet(p_subscription jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Oturum bulunamadı';
  end if;

  update public.suruculer
     set push_subscription = p_subscription,
         updated_at = now()
   where auth_user_id = v_uid;
end;
$$;

revoke all on function public.surucu_push_subscription_kaydet(jsonb) from public;
grant execute on function public.surucu_push_subscription_kaydet(jsonb) to authenticated;

-- --------------------------------------------------------------
-- 3) Son giriş zamanı güncelleme RPC
-- --------------------------------------------------------------
create or replace function public.surucu_son_giris_guncelle()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  update public.suruculer
     set son_giris = now()
   where auth_user_id = v_uid;
end;
$$;

revoke all on function public.surucu_son_giris_guncelle() from public;
grant execute on function public.surucu_son_giris_guncelle() to authenticated;

-- --------------------------------------------------------------
-- 4) (Opsiyonel) Sürücünün kendi profil alanlarını güncelleme RPC
--    Mobile DriverRepositoryImpl.updateProfile için
-- --------------------------------------------------------------
create or replace function public.surucu_profil_guncelle(
  p_ad text default null,
  p_soyad text default null,
  p_email text default null,
  p_telefon_raw text default null,
  p_dogum_tarihi date default null,
  p_adres text default null,
  p_acil_kontak_ad text default null,
  p_acil_kontak_tel text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Oturum bulunamadı';
  end if;

  update public.suruculer
     set ad               = coalesce(nullif(trim(p_ad), ''), ad),
         soyad            = coalesce(nullif(trim(p_soyad), ''), soyad),
         email            = coalesce(nullif(trim(p_email), ''), email),
         telefon_raw      = coalesce(nullif(trim(p_telefon_raw), ''), telefon_raw),
         dogum_tarihi     = coalesce(p_dogum_tarihi, dogum_tarihi),
         adres            = coalesce(nullif(trim(p_adres), ''), adres),
         acil_kontak_ad   = coalesce(nullif(trim(p_acil_kontak_ad), ''), acil_kontak_ad),
         acil_kontak_tel  = coalesce(nullif(trim(p_acil_kontak_tel), ''), acil_kontak_tel),
         updated_at       = now()
   where auth_user_id = v_uid;
end;
$$;

revoke all on function public.surucu_profil_guncelle(text,text,text,text,date,text,text,text) from public;
grant execute on function public.surucu_profil_guncelle(text,text,text,text,date,text,text,text) to authenticated;

comment on function public.surucu_fcm_token_kaydet(text) is
  'Sürücü kendi suruculer satırına FCM token yazar. RLS bypass (SECURITY DEFINER).';
comment on function public.surucu_push_subscription_kaydet(jsonb) is
  'Sürücü kendi suruculer satırına Web Push subscription yazar.';
comment on function public.surucu_son_giris_guncelle() is
  'Sürücü her oturum açışında çağırır — son_giris alanını günceller.';
comment on function public.surucu_profil_guncelle(text,text,text,text,date,text,text,text) is
  'Sürücü kendi profil bilgilerini güncelleyebilir (sadece kendi satırı).';
