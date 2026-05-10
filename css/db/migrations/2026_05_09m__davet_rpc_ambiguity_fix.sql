-- =============================================================================
-- 2026_05_09m__davet_rpc_ambiguity_fix.sql
-- Hotfix — "column reference 'expires_at' is ambiguous"
--
-- Hata: firma_kullanici_davet_olustur RPC'sinde RETURNS TABLE içinde
-- expires_at OUT parameter adı ile firma_kullanici_davetleri.expires_at
-- sütunu çakışıyor; INSERT...RETURNING expires_at sırasında PostgreSQL
-- hangisi istendiğini ayırt edemiyor (yeni Postgres versiyonlarında strict).
--
-- Çözüm: v_exp değişkeninde explicit hesapla, INSERT'te explicit yaz,
-- RETURNING yalnız id döndürsün — ambiguity kalkar.
-- =============================================================================

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
  v_uid          uuid := auth.uid();
  v_firma        uuid;
  v_kod          text := upper(substr(md5(gen_random_uuid()::text), 1, 10));
  v_id           bigint;
  v_exp          timestamptz := now() + interval '48 hours';
  v_email        text := lower(trim(p_email));
  v_firma_adi    text;
  v_davet_link   text;
  v_davet_eden_ad   text;
  v_davet_eden_email text;
begin
  -- Yetki: sahip veya yönetici
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid
     and fk.rol in ('sahip', 'yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok — yalnızca sahip veya yönetici davet gönderebilir'
      using errcode = '42501';
  end if;

  -- Faz 8 — rate limit (l migration uygulanmamışsa fail-soft skip)
  if to_regprocedure('public._rate_limit_check(text, integer, interval)') is not null then
    perform public._rate_limit_check('davet_olustur:firma:' || v_firma::text, 30, interval '1 hour');
    perform public._rate_limit_check('davet_olustur:user:' || v_uid::text, 60, interval '1 hour');
  end if;

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Geçersiz email' using errcode = '22023';
  end if;
  if p_rol not in ('yonetici', 'operasyoncu', 'muhasebeci') then
    raise exception 'Geçersiz rol — yonetici / operasyoncu / muhasebeci olmalı'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.firma_kullanicilar fk
    join auth.users u on u.id = fk.user_id
    where fk.firma_id = v_firma and lower(u.email) = v_email
  ) then
    raise exception 'Bu email zaten firmada kayıtlı kullanıcı'
      using errcode = '23505';
  end if;

  update public.firma_kullanici_davetleri
     set iptal_mi = true, iptal_at = now()
   where firma_id = v_firma
     and lower(email) = v_email
     and kullanildi_at is null
     and iptal_mi = false;

  -- expires_at'ı explicit yazıyoruz, RETURNING yalnız id alıyor → ambiguity yok
  insert into public.firma_kullanici_davetleri (
    firma_id, davet_eden, email, rol, ad, davet_kodu, notlar, expires_at
  ) values (
    v_firma, v_uid, v_email, p_rol, p_ad, v_kod, p_notlar, v_exp
  )
  returning id into v_id;

  v_davet_link := 'https://fleetly.fit/accept-invite.html?kod=' || v_kod;

  -- Davet eden + firma bilgileri (email template için)
  select coalesce((u.raw_user_meta_data->>'ad')::text, u.email::text), u.email::text
    into v_davet_eden_ad, v_davet_eden_email
  from auth.users u where u.id = v_uid;

  select ad into v_firma_adi from public.firmalar where id = v_firma;

  -- Email gönder (fail-soft)
  perform public._email_gonder(
    'davet',
    v_email,
    jsonb_build_object(
      'firma_id',          v_firma,
      'firma_ad',          coalesce(v_firma_adi, 'Fleetly'),
      'rol',               p_rol,
      'ad',                p_ad,
      'davet_kodu',        v_kod,
      'davet_link',        v_davet_link,
      'davet_eden_ad',     v_davet_eden_ad,
      'davet_eden_email',  v_davet_eden_email,
      'expires_at_pretty', to_char(v_exp at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI')
    )
  );

  -- OUT parametreleri lokal değişkenlerden döndür
  return query select v_id, v_kod, v_exp, v_davet_link;
end $$;

revoke all on function public.firma_kullanici_davet_olustur(text, text, text, text) from public;
grant execute on function public.firma_kullanici_davet_olustur(text, text, text, text) to authenticated;

comment on function public.firma_kullanici_davet_olustur(text, text, text, text) is
  'Faz 2+6+8 — davet olustur, rate-limit, email tetikle, ambiguity-safe.';

-- =============================================================================
-- DOGRULAMA
-- =============================================================================
-- 1) Yönetici hesabıyla:
--    select * from firma_kullanici_davet_olustur('test@x.com', 'operasyoncu', 'Test');
--
-- 2) Listede görmeli:
--    select * from firma_kullanici_listele();
-- =============================================================================
