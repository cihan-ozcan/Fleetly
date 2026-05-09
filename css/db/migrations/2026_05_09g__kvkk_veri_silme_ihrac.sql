-- =============================================================================
-- 2026_05_09g__kvkk_veri_silme_ihrac.sql
-- Faz 5 — KVKK & Yasal:
--   * 6698 sayılı KVKK madde 7  → silme hakkı   (30 gün soft-delete)
--   * 6698 sayılı KVKK madde 11 → veri taşınabilirlik (JSON ihraç)
--
-- Eklemeler:
--   1) firmalar tablosuna soft-delete sütunları
--   2) _firma_tablo_jsonb(firma_id, table_name)  — dinamik tablo dump helper
--   3) firma_veri_ihrac()         — JSON ile veri ihracı (sahip|yönetici)
--   4) firma_veri_silme_talep_et(p_onay_metni)   — 30 gün soft-delete (sahip)
--   5) firma_veri_silme_iptal()   — silme talebini iptal eder (sahip)
--   6) firma_veri_silme_durum()   — UI için durum/banner sorgusu
--
-- Kalıcı silme uygulamasını (silme_kalici_at < now() satırlarını silmek) bu
-- migration kurmaz; sonradan pg_cron veya Edge Function ile bağlanır.
-- =============================================================================

-- 1) Firmalar tablosuna soft-delete sütunları --------------------------------
alter table public.firmalar
  add column if not exists silme_talebi_at   timestamptz,
  add column if not exists silme_talebi_eden uuid,
  add column if not exists silme_kalici_at   timestamptz;

create index if not exists idx_firmalar_silme_kalici_at
  on public.firmalar(silme_kalici_at)
  where silme_kalici_at is not null;

comment on column public.firmalar.silme_talebi_at is
  'Sahip KVKK silme talebinde bulundugu an (now())';
comment on column public.firmalar.silme_kalici_at is
  'silme_talebi_at + 30 gun — bu tarihten sonra fiziksel silme cron uygular';
comment on column public.firmalar.silme_talebi_eden is
  'Talebi yapan auth.users.id (audit izi)';


-- 2) Helper: dinamik tablo dump ---------------------------------------------
-- firma_id sütunu olmayan veya tabloda olmayan tablolar için null döner.
-- Yalnızca SECURITY DEFINER fonksiyonlardan kullanılır (public revoke).
create or replace function public._firma_tablo_jsonb(p_firma_id uuid, p_table_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_full_name text := 'public.' || p_table_name;
  v_result jsonb;
begin
  if to_regclass(v_full_name) is null then
    return null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = p_table_name
      and column_name  = 'firma_id'
  ) then
    return null;
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.firma_id = $1',
    p_table_name
  ) into v_result using p_firma_id;

  return v_result;
end;
$fn$;

revoke execute on function public._firma_tablo_jsonb(uuid, text) from public;


-- 3) RPC: firma_veri_ihrac — KVKK madde 11 ----------------------------------
create or replace function public.firma_veri_ihrac()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_firma_id uuid;
  v_rol text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Yetkisiz: oturum bulunamadi' using errcode = '28000';
  end if;

  select fk.firma_id, fk.rol into v_firma_id, v_rol
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  order by case fk.rol
    when 'sahip'       then 1
    when 'yonetici'    then 2
    when 'operasyoncu' then 3
    when 'muhasebeci'  then 4
    else 99
  end
  limit 1;

  if v_firma_id is null then
    raise exception 'Yetkisiz: firma bulunamadi';
  end if;

  if v_rol not in ('sahip', 'yonetici') then
    raise exception 'Bu islem icin sahip veya yonetici rolu gerekir (mevcut: %)', v_rol;
  end if;

  v_result := jsonb_build_object(
    'meta', jsonb_build_object(
      'firma_id',         v_firma_id,
      'kullanici_id',     v_uid,
      'olusturma_zamani', now(),
      'kvkk_madde',       '6698 sayili Kanun madde 11/f',
      'aciklama',         'Veri tasinabilirlik hakki — Fleetly.fit veri ihraci'
    ),
    'firma', (select to_jsonb(f.*) from public.firmalar f where f.id = v_firma_id),
    'firma_kullanicilar',        _firma_tablo_jsonb(v_firma_id, 'firma_kullanicilar'),
    'firma_kullanici_davetleri', _firma_tablo_jsonb(v_firma_id, 'firma_kullanici_davetleri'),
    'araclar',                   _firma_tablo_jsonb(v_firma_id, 'araclar'),
    'suruculer',                 _firma_tablo_jsonb(v_firma_id, 'suruculer'),
    'surucu_davetleri',          _firma_tablo_jsonb(v_firma_id, 'surucu_davetleri'),
    'musteriler',                _firma_tablo_jsonb(v_firma_id, 'musteriler'),
    'is_emirleri',               _firma_tablo_jsonb(v_firma_id, 'is_emirleri'),
    'seferler',                  _firma_tablo_jsonb(v_firma_id, 'seferler'),
    'yakit_girisleri',           _firma_tablo_jsonb(v_firma_id, 'yakit_girisleri'),
    'harcirah_kayitlari',        _firma_tablo_jsonb(v_firma_id, 'harcirah_kayitlari'),
    'harcirah_haftalar',         _firma_tablo_jsonb(v_firma_id, 'harcirah_haftalar'),
    'pod_kayitlari',             _firma_tablo_jsonb(v_firma_id, 'pod_kayitlari'),
    'belgeler',                  _firma_tablo_jsonb(v_firma_id, 'belgeler'),
    'limanlar',                  _firma_tablo_jsonb(v_firma_id, 'limanlar'),
    'liman_ziyaretleri',         _firma_tablo_jsonb(v_firma_id, 'liman_ziyaretleri'),
    'fabrika_bekleme',           _firma_tablo_jsonb(v_firma_id, 'fabrika_bekleme'),
    'duraksamalar',              _firma_tablo_jsonb(v_firma_id, 'duraksamalar'),
    'bildirimler',               _firma_tablo_jsonb(v_firma_id, 'bildirimler'),
    'odeme_gecmisi',             _firma_tablo_jsonb(v_firma_id, 'odeme_gecmisi')
  );

  -- Konum izleri özet (volumetri büyük olabilir; detay için ayrı talep gerek)
  v_result := v_result || jsonb_build_object(
    'konum_izleri_ozet', case
      when to_regclass('public.konum_izleri') is not null then (
        select jsonb_build_object(
          'kayit_sayisi', count(*),
          'en_eski',      min(created_at),
          'en_yeni',      max(created_at),
          'not',          'Konum izleri detayli export icin destek@fleetly.fit'
        )
        from public.konum_izleri where firma_id = v_firma_id
      )
      else jsonb_build_object('kayit_sayisi', 0)
    end
  );

  return v_result;
end;
$fn$;

grant execute on function public.firma_veri_ihrac() to authenticated;
comment on function public.firma_veri_ihrac() is
  'KVKK madde 11 — veri tasinabilirlik. Sahip|yonetici cagirabilir, JSON doner.';


-- 4) RPC: firma_veri_silme_talep_et — 30 gün soft-delete --------------------
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

  -- Mevcut talep varsa idempotent davran — yeniden 30 güne uzatma
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
comment on function public.firma_veri_silme_talep_et(text) is
  'KVKK madde 7 — silme hakki. 30 gun soft-delete; sahip rolu gerek.';


-- 5) RPC: firma_veri_silme_iptal — talep iptal -------------------------------
create or replace function public.firma_veri_silme_iptal()
returns table(iptal_at timestamptz, mesaj text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_firma_id uuid;
  v_rol text;
begin
  if v_uid is null then
    raise exception 'Yetkisiz: oturum bulunamadi' using errcode = '28000';
  end if;

  select fk.firma_id, fk.rol into v_firma_id, v_rol
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  order by case fk.rol when 'sahip' then 1 when 'yonetici' then 2 else 99 end
  limit 1;

  if v_firma_id is null then
    raise exception 'Yetkisiz: firma bulunamadi';
  end if;

  if v_rol <> 'sahip' then
    raise exception 'Yalnizca firma sahibi silme iptali yapabilir (mevcut: %)', v_rol;
  end if;

  update public.firmalar
  set silme_talebi_at   = null,
      silme_talebi_eden = null,
      silme_kalici_at   = null
  where id = v_firma_id;

  return query select now(), 'Silme talebi iptal edildi. Hesabiniz aktif olarak devam ediyor.';
end;
$fn$;

grant execute on function public.firma_veri_silme_iptal() to authenticated;
comment on function public.firma_veri_silme_iptal() is
  'KVKK silme talebini iptal eder. Sahip rolu gerek.';


-- 6) RPC: firma_veri_silme_durum — UI banner sorgusu -------------------------
create or replace function public.firma_veri_silme_durum()
returns table(
  silme_aktif boolean,
  talep_at    timestamptz,
  kalici_at   timestamptz,
  kalan_gun   int
)
language sql
security definer
set search_path = public
as $fn$
  select
    (f.silme_kalici_at is not null and f.silme_kalici_at > now()) as silme_aktif,
    f.silme_talebi_at,
    f.silme_kalici_at,
    case
      when f.silme_kalici_at is null then null
      else greatest(0, extract(day from (f.silme_kalici_at - now()))::int)
    end as kalan_gun
  from public.firmalar f
  join public.firma_kullanicilar fk on fk.firma_id = f.id
  where fk.user_id = auth.uid()
  limit 1;
$fn$;

grant execute on function public.firma_veri_silme_durum() to authenticated;
comment on function public.firma_veri_silme_durum() is
  'KVKK silme talep durumu — banner ve buton state icin.';


-- =============================================================================
-- KULLANIM ÖRNEKLERI
-- =============================================================================
-- Veri ihraci (sahip|yonetici):
--   select firma_veri_ihrac();
--
-- Silme talebi (sahip):
--   select * from firma_veri_silme_talep_et('SIRKET ADIMI ONAYLIYORUM');
--
-- Iptal:
--   select * from firma_veri_silme_iptal();
--
-- Durum:
--   select * from firma_veri_silme_durum();
-- =============================================================================
