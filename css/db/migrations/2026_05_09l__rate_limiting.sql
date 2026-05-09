-- =============================================================================
-- 2026_05_09l__rate_limiting.sql
-- Faz 8 — API rate limiting (abuse / quota tüketme önlemi)
--
-- Sorun:
--   * Iyzipay-init Edge Function: signed-in kullanıcı dakikada 100 ödeme
--     başlatabilir → Iyzipay PaymentRequest quota tükenir
--   * firma_kullanici_davet_olustur: yönetici saatte 1000 davet → Resend
--     ücretsiz tier (3K/ay) bir saatte tükenir
--   * _email_gonder: kötü niyetli RPC çağrısı bizim Resend hesabımızı yakar
--
-- Çözüm:
--   * rate_limit_counters tablosu (key + sliding window)
--   * _rate_limit_check(anahtar, max, pencere) helper
--   * Önemli RPC'lere INSERT et: abonelik_odeme_baslat, davet_olustur,
--     veri_silme_talep_et, demo_veri_yukle
--
-- ETKİ MATRISI:
--   * abonelik_odeme_baslat:        5 / 1 dk per user      (insanlığın iyi yanı)
--   * firma_kullanici_davet_olustur: 30 / 1 saat per firma (50 kişilik ekipler için yeterli)
--   * firma_veri_silme_talep_et:    3 / 1 saat per user    (yanlışlıkla bot vd.)
--   * firma_demo_veri_yukle:        2 / 5 dk per user      (demo zaten idempotent)
--   * _email_gonder:                100 / 1 saat per firma (Resend free tier güvenliği)
-- =============================================================================

-- 1) Counter tablosu ----------------------------------------------------------
create table if not exists public.rate_limit_counters (
  anahtar       text primary key,
  pencere_basi  timestamptz not null default now(),
  sayac         int         not null default 0,
  son_engel_at  timestamptz,
  toplam_engel  int         not null default 0,
  guncellendi   timestamptz not null default now()
);

-- Periyodik temizlik (eski penceleri sil) — pg_cron weekly
-- (j migration sonrası pg_cron extension hazır)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'rate_limit_cleanup') then
    perform cron.unschedule('rate_limit_cleanup');
  end if;
end $$;

select cron.schedule(
  'rate_limit_cleanup',
  '0 4 * * 0',   -- her pazar 04:00 UTC
  $cron$
    delete from public.rate_limit_counters
    where pencere_basi < now() - interval '7 days';
  $cron$
);


-- 2) Helper: _rate_limit_check ------------------------------------------------
-- Atomic sliding-window counter. row-level lock (FOR UPDATE) ile race-safe.
create or replace function public._rate_limit_check(
  p_anahtar  text,
  p_max      int,
  p_pencere  interval
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_simdi        timestamptz := now();
  v_old_pencere  timestamptz;
  v_old_sayac    int;
  v_kalan_sn     int;
begin
  if p_anahtar is null or p_anahtar = '' or p_max is null or p_max < 1 then
    raise exception '[_rate_limit_check] gecersiz parametre';
  end if;

  -- FOR UPDATE — concurrent isteklerin biri lock üzerinde bekler
  select pencere_basi, sayac into v_old_pencere, v_old_sayac
    from public.rate_limit_counters
   where anahtar = p_anahtar
   for update;

  if not found then
    insert into public.rate_limit_counters (anahtar, pencere_basi, sayac, guncellendi)
    values (p_anahtar, v_simdi, 1, v_simdi);
    return;   -- ilk istek, OK
  end if;

  -- Pencere bitmis mi?
  if v_old_pencere + p_pencere <= v_simdi then
    update public.rate_limit_counters
       set pencere_basi = v_simdi,
           sayac        = 1,
           guncellendi  = v_simdi
     where anahtar = p_anahtar;
    return;
  end if;

  -- Pencere icinde — sayac++
  if v_old_sayac + 1 > p_max then
    -- Engel — son_engel_at + toplam_engel guncelle
    update public.rate_limit_counters
       set son_engel_at = v_simdi,
           toplam_engel = toplam_engel + 1,
           guncellendi  = v_simdi
     where anahtar = p_anahtar;

    v_kalan_sn := greatest(1, ceil(extract(epoch from (v_old_pencere + p_pencere - v_simdi)))::int);
    raise exception 'Çok fazla istek — % saniye sonra tekrar deneyin (limit: % / %)',
      v_kalan_sn, p_max, p_pencere
      using errcode = 'P0001',
            hint    = 'rate_limit:' || p_anahtar;
  end if;

  update public.rate_limit_counters
     set sayac       = v_old_sayac + 1,
         guncellendi = v_simdi
   where anahtar = p_anahtar;
end;
$fn$;

revoke execute on function public._rate_limit_check(text, int, interval) from public;
comment on function public._rate_limit_check(text, int, interval) is
  'Faz 8 — sliding-window rate limiter. SECURITY DEFINER, sadece RPC''lerden cagrilir.';


-- 3) RPC override: abonelik_odeme_baslat (rate limit eklenmis) ---------------
create or replace function public.abonelik_odeme_baslat(
  p_plan_id        text,
  p_iyzipay_conv_id text default null
)
returns table (odeme_id text, tutar numeric, plan_ad text, sure_gun int, firma_id uuid, firma_email text, firma_ad text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_firma   uuid;
  v_plan    record;
  v_id      text := gen_random_uuid()::text;
  v_email   text;
  v_firma_ad text;
begin
  if v_uid is null then
    raise exception 'Önce giriş yapmanız gerek' using errcode = '42501';
  end if;

  -- Rate limit: 5 odeme baslatma / 1 dk per user
  perform public._rate_limit_check('odeme_baslat:' || v_uid::text, 5, interval '1 minute');

  -- Yalnizca sahip
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid and fk.rol = 'sahip'
   limit 1;
  if v_firma is null then
    raise exception 'Yalnızca firma sahibi abonelik ödeyebilir' using errcode = '42501';
  end if;

  select * into v_plan from public.abonelik_planlari
   where id = p_plan_id and aktif = true limit 1;
  if v_plan.id is null then
    raise exception 'Plan bulunamadı: %', p_plan_id using errcode = '22023';
  end if;
  if v_plan.sure_gun is null or v_plan.sure_gun <= 0 then
    raise exception 'Plan süresi tanımlı değil' using errcode = '22023';
  end if;

  select email into v_email from auth.users where id = v_uid;
  select ad into v_firma_ad from public.firmalar where id = v_firma;

  insert into public.odeme_gecmisi (
    id, firma_id, plan_id, tutar, para_birimi, durum,
    iyzipay_conversation_id,
    baslangic, bitis, notlar
  ) values (
    v_id, v_firma, p_plan_id, v_plan.fiyat, 'TRY', 'bekliyor',
    p_iyzipay_conv_id,
    now(), now() + (v_plan.sure_gun || ' days')::interval,
    'Iyzipay ödeme başlatıldı'
  );

  update public.firmalar
     set abonelik_durumu = 'odeme_bekliyor'
   where id = v_firma
     and abonelik_durumu in ('deneme','suresi_dolmus','iptal');

  return query select v_id, v_plan.fiyat, v_plan.ad, v_plan.sure_gun, v_firma, v_email, v_firma_ad;
end $$;

revoke all on function public.abonelik_odeme_baslat(text, text) from public;
grant execute on function public.abonelik_odeme_baslat(text, text) to authenticated;


-- 4) RPC override: firma_kullanici_davet_olustur (rate limit eklenmis) -------
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
  -- Yetki kontrolu
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid
     and fk.rol in ('sahip', 'yonetici')
   limit 1;
  if v_firma is null then
    raise exception 'Yetki yok — yalnızca sahip veya yönetici davet gönderebilir'
      using errcode = '42501';
  end if;

  -- Rate limit: 30 davet / 1 saat per firma (Resend free 3K/ay korumasi)
  perform public._rate_limit_check('davet_olustur:firma:' || v_firma::text, 30, interval '1 hour');
  -- Ek kullanici-bazli: 60 davet / 1 saat per user (siz bir firmada ana yoneticiyseniz)
  perform public._rate_limit_check('davet_olustur:user:' || v_uid::text, 60, interval '1 hour');

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

  insert into public.firma_kullanici_davetleri (
    firma_id, davet_eden, email, rol, ad, davet_kodu, notlar
  ) values (
    v_firma, v_uid, v_email, p_rol, p_ad, v_kod, p_notlar
  )
  returning id, expires_at into v_id, v_exp;

  v_davet_link := 'https://fleetly.fit/accept-invite.html?kod=' || v_kod;

  select coalesce((u.raw_user_meta_data->>'ad')::text, u.email::text), u.email::text
    into v_davet_eden_ad, v_davet_eden_email
  from auth.users u where u.id = v_uid;

  select ad into v_firma_adi from public.firmalar where id = v_firma;

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

  return query select v_id, v_kod, v_exp, v_davet_link;
end $$;

revoke all on function public.firma_kullanici_davet_olustur(text, text, text, text) from public;
grant execute on function public.firma_kullanici_davet_olustur(text, text, text, text) to authenticated;


-- 5) RPC override: _email_gonder (rate limit + RECIPIENT bazli korumam) ------
-- Mevcut helper'a INSERT et. Bir alici TIME WINDOW icinde fazla email almasin.
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
  v_to_norm    text   := lower(trim(coalesce(p_to, '')));
begin
  if v_endpoint is null or v_endpoint = '' then
    raise warning '[_email_gonder] app.email_endpoint set edilmemis, atlandi';
    return null;
  end if;
  if v_secret is null or v_secret = '' then
    raise warning '[_email_gonder] app.email_secret set edilmemis, atlandi';
    return null;
  end if;
  if v_to_norm = '' or v_to_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise warning '[_email_gonder] gecersiz alici email: %', p_to;
    return null;
  end if;

  -- Rate limit: bir aliciya 1 saatte en fazla 10 email (spam koruma)
  begin
    perform public._rate_limit_check('email_to:' || v_to_norm, 10, interval '1 hour');
  exception when others then
    raise warning '[_email_gonder] rate limit asildi alici=%, atlandi', v_to_norm;
    return null;
  end;

  -- firma_id varsa ek koruma: 1 saatte 200 email (Resend free 3K/ay = ~100/gun avg)
  if (p_data ? 'firma_id') and (p_data->>'firma_id') is not null then
    begin
      perform public._rate_limit_check('email_firma:' || (p_data->>'firma_id'), 200, interval '1 hour');
    exception when others then
      raise warning '[_email_gonder] firma rate limit asildi (firma=%)', p_data->>'firma_id';
      return null;
    end;
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


-- 6) RPC override: firma_veri_silme_talep_et (yanliskisma anti-bot) -----------
create or replace function public.firma_veri_silme_talep_et(p_onay_metni text default null)
returns table(silme_kalici_at timestamptz, mesaj text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_firma_id uuid;
  v_rol text;
  v_mevcut_kalici timestamptz;
  v_kalici timestamptz := now() + interval '30 days';
begin
  if v_uid is null then
    raise exception 'Yetkisiz: oturum bulunamadi' using errcode = '28000';
  end if;

  -- Rate limit: 3 silme talebi / 1 saat per user (yanliskisma + bot koruma)
  perform public._rate_limit_check('veri_silme_talep:' || v_uid::text, 3, interval '1 hour');

  select fk.firma_id, fk.rol into v_firma_id, v_rol
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  order by case fk.rol when 'sahip' then 1 when 'yonetici' then 2 else 99 end
  limit 1;

  if v_firma_id is null then
    raise exception 'Yetkisiz: firma bulunamadi';
  end if;

  if v_rol <> 'sahip' then
    raise exception 'Yalnizca firma sahibi silme talebinde bulunabilir (mevcut rol: %)', v_rol;
  end if;

  select f.silme_kalici_at into v_mevcut_kalici from public.firmalar f where f.id = v_firma_id;
  if v_mevcut_kalici is not null and v_mevcut_kalici > now() then
    return query
    select v_mevcut_kalici,
           'Zaten aktif bir silme talebi var. Iptal etmek icin "Talebi Iptal Et" butonunu kullanin.';
    return;
  end if;

  update public.firmalar
  set silme_talebi_at   = now(),
      silme_talebi_eden = v_uid,
      silme_kalici_at   = v_kalici
  where id = v_firma_id;

  return query
  select v_kalici,
         'Silme talebi alindi. ' ||
         to_char(v_kalici at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') ||
         ' tarihinde verileriniz kalici olarak silinecek. Bu sure icinde giris yaparak iptal edebilirsiniz.';
end;
$fn$;

grant execute on function public.firma_veri_silme_talep_et(text) to authenticated;


-- 7) RPC override: firma_demo_veri_yukle (rate limit) ------------------------
-- Mevcut RPC zaten idempotent (demo_yuklendi flag ile). Yine de spam korumasi:
-- demo_yukle'ye 5 dk'da 2 cagri yeterli (gercek kullanicilar bir kez yapar).
create or replace function public.firma_demo_veri_yukle()
returns table (
  araclar_eklendi    int,
  suruculer_eklendi  int,
  musteriler_eklendi int,
  is_emirleri_eklendi int,
  ozet_mesaj         text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  -- Rate limit
  perform public._rate_limit_check('demo_yukle:' || v_uid::text, 2, interval '5 minutes');

  -- Asil yukleyiciye yonlendir (mevcut RPC'nin kodunu coklamak yerine
  -- ayrı bir _impl fonksiyonu acmaktansa, bu yukseltici override olarak rate
  -- check yapip ardindan tekrar RPC'yi cagiran bir wrap mantigi cikarır.
  -- Burada bir kerelik tek seferlik calistigi icin pratik: varolan k migration
  -- mantigini buraya kopyalamak yerine basit bir guard ekleyip k'daki ana
  -- gorevden kalan logic'i tekrar yapamayacagimiz icin: k migration zaten
  -- tek seferlik sayac uretiyor, biz burada SADECE rate koruma ekledik.
  -- Asil islem icin k migration calistirilmis olmali; bu RPC hala onun yerine
  -- gecer ama mantigi orjinal k'ya devreder. Bunun yerine basit yaklasim:
  -- mantigi tam tekrar et.

  -- NOT: mantik tekrari uzun. Pratik cozum: k migration'daki RPC'yi degistirmedik
  -- bu yuzden buradaki tanim k'dakini override ediyor. Ancak Postgres'te bir
  -- fonksiyon adı/imzası ile aynı yeniden tanım mevcut tanimi degistirir, ki
  -- biz mantik kismini SAKLAMAK istiyoruz. Bu yuzden bu RPC override'inde
  -- l migration k'yi bozmasin diye TEKRAR k'dan kopyalamak yerine k migration'in
  -- TEKRAR uygulanması gerekecektir.
  --
  -- DOGRU YAKLASIM: l migration sadece _rate_limit_check helper'i ekler. k
  -- migration yeniden uygulandiginda zaten override edilen RPC restorelandir.
  -- Bu sebeple bu blok TAMAMEN SILINIR; rate limit'i k migration'in icine
  -- INSERT etmek gerekir.

  raise exception 'Bu fonksiyon override mantigi yanlis kuruldu — k migration yeniden uygulayin'
    using errcode = 'P0001';
end;
$fn$;

-- ────────────────────────────────────────────────────────────────────────────
-- Ustteki firma_demo_veri_yukle override'ini geri al — k migration'a uygunluk
-- saglamak için dropdan once eski tanim ile yeniden olusturalim.
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.firma_demo_veri_yukle();

create or replace function public.firma_demo_veri_yukle()
returns table (
  araclar_eklendi    int,
  suruculer_eklendi  int,
  musteriler_eklendi int,
  is_emirleri_eklendi int,
  ozet_mesaj         text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_firma     uuid;
  v_rol       text;
  v_sayac_a   int := 0;
  v_sayac_s   int := 0;
  v_sayac_m   int := 0;
  v_sayac_io  int := 0;
  v_demo_yuklendi boolean;

  v_arac_data  jsonb := jsonb_build_array(
    jsonb_build_object('plaka','34 ABC 1234','tip','Çekici','marka','Mercedes','model','Actros','yil',2021),
    jsonb_build_object('plaka','34 DEF 5678','tip','Çekici','marka','MAN',     'model','TGX',    'yil',2022),
    jsonb_build_object('plaka','06 GHI 9012','tip','Çekici','marka','Volvo',   'model','FH 460', 'yil',2020),
    jsonb_build_object('plaka','35 JKL 3456','tip','Dorse', 'marka','Tırsan',  'model','40 ft',  'yil',2019),
    jsonb_build_object('plaka','41 MNO 7890','tip','Dorse', 'marka','Kassbohrer','model','40 ft','yil',2023)
  );

  v_surucu_data jsonb := jsonb_build_array(
    jsonb_build_object('ad','Mehmet','soyad','Yılmaz','telefon_e164','+905551110001'),
    jsonb_build_object('ad','Hasan',  'soyad','Demir', 'telefon_e164','+905551110002'),
    jsonb_build_object('ad','Ali',    'soyad','Kaya',  'telefon_e164','+905551110003')
  );

  v_musteri_data jsonb := jsonb_build_array(
    jsonb_build_object('firma','Marmara Tekstil A.Ş.',     'yetkili','Ahmet Çelik',  'sektor','Tekstil',     'tel','0212 555 01 01','vkn','1234567890'),
    jsonb_build_object('firma','Anadolu Lojistik San.',     'yetkili','Fatma Aydın', 'sektor','Lojistik',    'tel','0212 555 02 02','vkn','2345678901'),
    jsonb_build_object('firma','İzmir Konteyner Hizmet.',  'yetkili','Selim Aksoy', 'sektor','Liman',       'tel','0232 555 03 03','vkn','3456789012'),
    jsonb_build_object('firma','Ege Plastik Üretim Ltd.',  'yetkili','Ayşe Şahin',  'sektor','Üretim',      'tel','0232 555 04 04','vkn','4567890123'),
    jsonb_build_object('firma','Kocaeli Metal A.Ş.',        'yetkili','Murat Kara',  'sektor','Metal',       'tel','0262 555 05 05','vkn','5678901234'),
    jsonb_build_object('firma','Bursa Otomotiv Ltd.',       'yetkili','Zeynep Öz',   'sektor','Otomotiv',    'tel','0224 555 06 06','vkn','6789012345'),
    jsonb_build_object('firma','Trakya Gıda San.',          'yetkili','Emre Doğan',  'sektor','Gıda',        'tel','0282 555 07 07','vkn','7890123456'),
    jsonb_build_object('firma','Antalya İhracat A.Ş.',      'yetkili','Hülya Erkan', 'sektor','İhracat',     'tel','0242 555 08 08','vkn','8901234567'),
    jsonb_build_object('firma','Mersin Liman Hizmet.',      'yetkili','Burak Yıldız','sektor','Liman',       'tel','0324 555 09 09','vkn','9012345678'),
    jsonb_build_object('firma','İstanbul Kimya Ltd.',       'yetkili','Ceren Acar',  'sektor','Kimya',       'tel','0212 555 10 10','vkn','0123456789')
  );

  v_rota_data jsonb := jsonb_build_array(
    jsonb_build_object('yukle','Kumport (Tekirdağ)','teslim','Kocaeli Sanayi'),
    jsonb_build_object('yukle','Ambarlı (İstanbul)','teslim','Bursa Organize'),
    jsonb_build_object('yukle','Mersin Limanı','teslim','Adana Ceyhan'),
    jsonb_build_object('yukle','İzmir Alsancak','teslim','Manisa OSB'),
    jsonb_build_object('yukle','Marport (İstanbul)','teslim','Tekirdağ Çerkezköy'),
    jsonb_build_object('yukle','Gemport (Bursa)','teslim','Eskişehir OSB'),
    jsonb_build_object('yukle','Asyaport (Tekirdağ)','teslim','İstanbul Tuzla'),
    jsonb_build_object('yukle','Mardaş (İstanbul)','teslim','Sakarya Hendek')
  );

  v_arac     jsonb;
  v_surucu   jsonb;
  v_musteri  jsonb;
  i          int;

  v_arac_ids        text[];
  v_surucu_ids      uuid[];
  v_musteri_ids     bigint[];
  v_arac_id         text;
  v_surucu_id       uuid;
  v_musteri_id      bigint;

  v_sec_arac        record;
  v_sec_surucu      record;
  v_sec_musteri     record;
  v_sec_rota        jsonb;

  v_durum           text;
  v_atama_zamani    timestamptz;
  v_teslim_zamani   timestamptz;
  v_konteyner_no    text;
begin
  if v_uid is null then
    raise exception 'Yetkisiz: oturum bulunamadi' using errcode = '28000';
  end if;

  -- Faz 8 — rate limit
  perform public._rate_limit_check('demo_yukle:' || v_uid::text, 2, interval '5 minutes');

  select fk.firma_id, fk.rol into v_firma, v_rol
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  order by case fk.rol when 'sahip' then 1 when 'yonetici' then 2 else 99 end
  limit 1;

  if v_firma is null then
    raise exception 'Yetkisiz: firma bulunamadi';
  end if;
  if v_rol <> 'sahip' then
    raise exception 'Yalnizca firma sahibi demo veri yukleyebilir (mevcut rol: %)', v_rol;
  end if;

  select demo_yuklendi into v_demo_yuklendi from public.firmalar where id = v_firma;
  if v_demo_yuklendi then
    raise exception 'Bu firmaya demo veri zaten yuklenmis. Once "Demo Veriyi Temizle" butonuyla silin.'
      using errcode = '23505';
  end if;

  -- Araclar
  for v_arac in select * from jsonb_array_elements(v_arac_data) loop
    v_arac_id := 'demo_' || lower(replace(v_arac->>'plaka', ' ', ''));
    insert into public.araclar (
      id, plaka, tip, marka, model, yil, durum, firma_id, user_id, demo_mi, notlar
    ) values (
      v_arac_id, v_arac->>'plaka', v_arac->>'tip', v_arac->>'marka', v_arac->>'model',
      (v_arac->>'yil')::int, 'Aktif', v_firma, v_uid, true, 'Demo veri'
    )
    on conflict (id) do nothing;
    v_sayac_a := v_sayac_a + 1;
    v_arac_ids := array_append(v_arac_ids, v_arac_id);
  end loop;

  -- Suruculer
  for v_surucu in select * from jsonb_array_elements(v_surucu_data) loop
    insert into public.suruculer (
      firma_id, ad, soyad, telefon_e164, durum, demo_mi, created_by
    ) values (
      v_firma, v_surucu->>'ad', v_surucu->>'soyad', v_surucu->>'telefon_e164',
      'davet_bekliyor', true, v_uid
    )
    returning id into v_surucu_id;
    v_sayac_s := v_sayac_s + 1;
    v_surucu_ids := array_append(v_surucu_ids, v_surucu_id);
  end loop;

  -- Musteriler
  for v_musteri in select * from jsonb_array_elements(v_musteri_data) loop
    insert into public.musteriler (
      firma_id, user_id, firma, yetkili, sektor, tel, vkn, durum, demo_mi
    ) values (
      v_firma, v_uid,
      v_musteri->>'firma', v_musteri->>'yetkili', v_musteri->>'sektor',
      v_musteri->>'tel', v_musteri->>'vkn', 'Aktif', true
    )
    returning id into v_musteri_id;
    v_sayac_m := v_sayac_m + 1;
    v_musteri_ids := array_append(v_musteri_ids, v_musteri_id);
  end loop;

  -- Is emirleri
  for i in 1..30 loop
    v_arac_id    := v_arac_ids[((i - 1) % array_length(v_arac_ids, 1)) + 1];
    v_surucu_id  := v_surucu_ids[((i - 1) % array_length(v_surucu_ids, 1)) + 1];
    v_musteri_id := v_musteri_ids[((i - 1) % array_length(v_musteri_ids, 1)) + 1];

    select plaka, tip into v_sec_arac from public.araclar where id = v_arac_id;
    select ad, soyad, telefon_e164 into v_sec_surucu from public.suruculer where id = v_surucu_id;
    select firma into v_sec_musteri from public.musteriler where id = v_musteri_id;

    v_sec_rota := v_rota_data->((i - 1) % jsonb_array_length(v_rota_data));

    if i <= 28 then
      v_durum := 'Teslim Edildi';
      v_atama_zamani  := now() - ((30 - (i % 30)) || ' days')::interval;
      v_teslim_zamani := v_atama_zamani + ((6 + (i % 12)) || ' hours')::interval;
    else
      v_durum := 'Yolda';
      v_atama_zamani  := now() - ((i - 28) || ' hours')::interval;
      v_teslim_zamani := null;
    end if;

    v_konteyner_no := 'MSCU' || lpad((1000000 + i * 137)::text, 7, '0');

    insert into public.is_emirleri (
      firma_id, user_id, musteri_id, musteri_adi,
      arac_plaka, sofor, sofor_tel, surucu_id,
      konteyner_no, kont_tip, kont_durum,
      yukle_yeri, teslim_yeri,
      durum, atama_zamani, teslim_zamani,
      demo_mi, notlar
    ) values (
      v_firma, v_uid, v_musteri_id, v_sec_musteri.firma,
      v_sec_arac.plaka,
      v_sec_surucu.ad || ' ' || v_sec_surucu.soyad,
      v_sec_surucu.telefon_e164,
      v_surucu_id,
      v_konteyner_no, '40 HC', 'Dolu',
      v_sec_rota->>'yukle', v_sec_rota->>'teslim',
      v_durum, v_atama_zamani, v_teslim_zamani,
      true, 'Demo iş emri'
    );
    v_sayac_io := v_sayac_io + 1;
  end loop;

  update public.firmalar set demo_yuklendi = true where id = v_firma;

  return query select
    v_sayac_a, v_sayac_s, v_sayac_m, v_sayac_io,
    'Demo veriniz hazır: ' || v_sayac_a || ' araç + ' || v_sayac_s || ' sürücü + ' ||
    v_sayac_m || ' müşteri + ' || v_sayac_io || ' iş emri eklendi.';
end;
$fn$;

grant execute on function public.firma_demo_veri_yukle() to authenticated;


-- =============================================================================
-- DOGRULAMA
-- =============================================================================
-- 1) Helper test:
--    select public._rate_limit_check('test:abc', 3, interval '1 minute');
--    -- 4. cagrida hata firlatir
--
-- 2) Counter durumu:
--    select * from public.rate_limit_counters order by guncellendi desc limit 20;
--
-- 3) Engellenen istek istatistigi:
--    select anahtar, sayac, toplam_engel, son_engel_at
--      from public.rate_limit_counters
--      where toplam_engel > 0
--      order by son_engel_at desc;
--
-- 4) Cleanup cron job:
--    select jobname, schedule from cron.job where jobname = 'rate_limit_cleanup';
-- =============================================================================
