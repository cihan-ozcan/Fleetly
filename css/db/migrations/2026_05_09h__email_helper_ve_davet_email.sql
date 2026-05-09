-- =============================================================================
-- 2026_05_09h__email_helper_ve_davet_email.sql
-- Faz 6 — Transactional email altyapısı:
--   1) pg_net extension (Supabase'de zaten gelir, idempotent)
--   2) _email_gonder(template, to, data)  — fail-soft helper
--   3) firma_kullanici_davet_olustur RPC'sini override et — email tetikle
--
-- ÖNEMLİ — DEPLOY ÖNCESİ:
--   1. Edge Function deploy edilmeli:
--        supabase functions deploy send-email --no-verify-jwt
--   2. DB'ye iki ayar set edilmeli (Supabase Dashboard → SQL Editor):
--        alter database postgres
--          set app.email_endpoint = 'https://<PROJECT_REF>.supabase.co/functions/v1/send-email';
--        alter database postgres
--          set app.email_secret   = '<EMAIL_INTERNAL_SECRET>';   -- aynı secret, Edge'in env'inde
--      (set sonrası DB connection'ları yeniden açılınca aktif olur — pgbouncer için
--       birkaç saniye bekleyin veya pg_reload_conf() çalıştırın.)
--
-- DAVRANIŞ:
--   _email_gonder her zaman fail-soft döner — endpoint/secret eksikse veya
--   pg_net hata verirse davet/abonelik akışı kesilmez. Hatalar `raise warning`
--   ile loglanır; gerekirse pg_net.responses tablosundan ayrı incelenebilir.
-- =============================================================================

create extension if not exists pg_net with schema extensions;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Helper: _email_gonder
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._email_gonder(
  p_template text,
  p_to       text,
  p_data     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_endpoint   text   := current_setting('app.email_endpoint', true);
  v_secret     text   := current_setting('app.email_secret',   true);
  v_request_id bigint;
begin
  -- Konfigürasyon yoksa fail-soft (örn. local dev'de)
  if v_endpoint is null or v_endpoint = '' then
    raise warning '[_email_gonder] app.email_endpoint set edilmemis, email atlanildi (template=%, to=%)', p_template, p_to;
    return null;
  end if;
  if v_secret is null or v_secret = '' then
    raise warning '[_email_gonder] app.email_secret set edilmemis, email atlanildi';
    return null;
  end if;
  if p_to is null or p_to = '' or p_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise warning '[_email_gonder] gecersiz alici email: %', p_to;
    return null;
  end if;

  begin
    select extensions.net.http_post(
      url     := v_endpoint,
      body    := jsonb_build_object(
                   'template', p_template,
                   'to',       p_to,
                   'data',     coalesce(p_data, '{}'::jsonb)
                 ),
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_secret,
                   'Content-Type',  'application/json'
                 ),
      timeout_milliseconds := 5000
    ) into v_request_id;
    return v_request_id;
  exception when others then
    raise warning '[_email_gonder] pg_net hata (%): %', sqlstate, sqlerrm;
    return null;
  end;
end;
$fn$;

revoke execute on function public._email_gonder(text, text, jsonb) from public;
comment on function public._email_gonder(text, text, jsonb) is
  'Faz 6 — pg_net ile send-email Edge Function''una POST atar. Fail-soft.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Davet RPC override — email tetikleme eklenmis hali
-- (2026_05_09c'deki orjinal mantik aynen korunur, sona email cagrisi eklenir)
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
  v_uid          uuid := auth.uid();
  v_firma        uuid;
  v_kod          text := upper(substr(md5(gen_random_uuid()::text), 1, 10));
  v_id           bigint;
  v_exp          timestamptz;
  v_email        text := lower(trim(p_email));
  v_firma_adi    text;
  v_davet_link   text;
  v_davet_eden_ad   text;
  v_davet_eden_email text;
begin
  -- Yetki kontrolu: cagiran sahip veya yonetici olmali
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

  -- Ayni email zaten firma_kullanicilar'da mi?
  if exists (
    select 1 from public.firma_kullanicilar fk
    join auth.users u on u.id = fk.user_id
    where fk.firma_id = v_firma and lower(u.email) = v_email
  ) then
    raise exception 'Bu email zaten firmada kayıtlı kullanıcı'
      using errcode = '23505';
  end if;

  -- Ayni email icin aktif davet varsa eskisini iptal et
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

  v_davet_link := 'https://fleetly.fit/accept-invite.html?kod=' || v_kod;

  -- Davet eden + firma bilgileri (email template icin)
  select coalesce((u.raw_user_meta_data->>'ad')::text, u.email::text), u.email::text
    into v_davet_eden_ad, v_davet_eden_email
  from auth.users u where u.id = v_uid;

  select ad into v_firma_adi from public.firmalar where id = v_firma;

  -- Email gonder (fail-soft — davet zaten oluştu)
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

  return query select
    v_id,
    v_kod,
    v_exp,
    v_davet_link;
end $$;

revoke all on function public.firma_kullanici_davet_olustur(text, text, text, text) from public;
grant execute on function public.firma_kullanici_davet_olustur(text, text, text, text) to authenticated;

comment on function public.firma_kullanici_davet_olustur(text, text, text, text) is
  'Faz 2 + Faz 6 — davet olustur, otomatik email gonder (fail-soft).';


-- =============================================================================
-- DOGRULAMA
-- =============================================================================
-- 1) Konfigurasyon kontrolu:
--    select current_setting('app.email_endpoint', true);
--    select current_setting('app.email_secret',   true);
--
-- 2) Manuel test (admin user oturumuyla):
--    select public._email_gonder('davet', 'test@example.com',
--      jsonb_build_object(
--        'firma_ad', 'Test A.S.',
--        'rol', 'operasyoncu',
--        'davet_link', 'https://fleetly.fit/accept-invite.html?kod=TESTKOD'
--      ));
--
-- 3) pg_net response durumu (debug):
--    select id, status_code, error_msg, created
--      from net._http_response
--      order by created desc limit 5;
-- =============================================================================
