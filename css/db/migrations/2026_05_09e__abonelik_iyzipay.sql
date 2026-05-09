-- 2026-05-09e — Abonelik & Iyzipay entegrasyonu (Faz 4)
--
-- Mevcut yapıya ek:
--   - firmalar.abonelik_durumu: 'deneme' | 'aktif' | 'suresi_dolmus' | 'iptal' | 'odeme_bekliyor'
--   - firmalar.abonelik_plani: 'aylik' | 'yillik'
--   - odeme_gecmisi: tüm ödeme kayıtları (Iyzipay alanları eklenir)
--   - abonelik_planlari: plan kataloğu (seed)
--
-- AKIŞ:
--   1. Yeni firma kaydı → deneme_bitis = +7 gün, abonelik_durumu='deneme'
--   2. Kullanıcı "Plan Seç" → Edge Function iyzipay-init Iyzipay PaymentRequest yaratır
--   3. Frontend Iyzipay paymentPageUrl'e yönlendirilir → kart bilgisi 3DS doğrulama
--   4. Iyzipay → Edge Function iyzipay-callback?token=XXX — retrieve API ile detayları al
--   5. abonelik_iyzipay_aktif_et RPC çağrılır → odeme_gecmisi.durum='basarili',
--      firmalar.abonelik_durumu='aktif', abonelik_bitis = baslangic + plan.sure_gun
--   6. Read-only mod: deneme/abonelik bittikten sonra is_emirleri INSERT bloklanır

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) odeme_gecmisi'ne Iyzipay alanları ekle
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.odeme_gecmisi
  add column if not exists iyzipay_payment_id      text,
  add column if not exists iyzipay_conversation_id text,
  add column if not exists iyzipay_token           text,
  add column if not exists iyzipay_raw             jsonb;

create index if not exists idx_odeme_iyzipay_payment
  on public.odeme_gecmisi (iyzipay_payment_id) where iyzipay_payment_id is not null;
create index if not exists idx_odeme_iyzipay_token
  on public.odeme_gecmisi (iyzipay_token) where iyzipay_token is not null;
create index if not exists idx_odeme_firma_durum
  on public.odeme_gecmisi (firma_id, durum, created_at desc);

-- abonelik_planlari sure_gun kolonu yoksa ekle (seed kontrol)
alter table public.abonelik_planlari
  add column if not exists sure_gun integer;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Plan kataloğu seed — varsa update, yoksa insert
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.abonelik_planlari (id, ad, fiyat, sure_gun, aciklama, aktif)
values
  ('aylik',  'Aylık',    990, 30,  'Aylık yenilenebilir abonelik. İstediğiniz zaman iptal.', true),
  ('yillik', 'Yıllık',  8900, 365, 'Yılda %25 tasarruf — tek seferde ödeme.',                 true)
on conflict (id) do update set
  ad        = excluded.ad,
  fiyat     = excluded.fiyat,
  sure_gun  = excluded.sure_gun,
  aciklama  = excluded.aciklama,
  aktif     = excluded.aktif;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RLS — odeme_gecmisi: yetkili kullanıcı SELECT, INSERT/UPDATE yalnızca RPC
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.odeme_gecmisi enable row level security;

drop policy if exists odeme_select on public.odeme_gecmisi;
create policy odeme_select on public.odeme_gecmisi
  for select to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()));

-- INSERT/UPDATE/DELETE direct yasak; RPC üzerinden (security definer) yapılacak.
drop policy if exists odeme_insert on public.odeme_gecmisi;
create policy odeme_insert on public.odeme_gecmisi
  for insert to authenticated with check (false);

drop policy if exists odeme_update on public.odeme_gecmisi;
create policy odeme_update on public.odeme_gecmisi
  for update to authenticated using (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RPC: ödeme başlangıç kaydı (Edge function init aşamasında çağrılır)
-- ─────────────────────────────────────────────────────────────────────────────
-- Edge function iyzipay-init PaymentRequest atmadan ÖNCE bu RPC ile bekleyen
-- bir odeme_gecmisi satırı oluşturur. Sonra Iyzipay'den dönen conversation_id
-- ile bağlanır. Webhook callback geldiğinde aynı satır UPDATE edilir.
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

  -- Yalnızca sahip ödeme yapabilir (abonelik sahibinin sorumluluğu)
  select fk.firma_id into v_firma
    from public.firma_kullanicilar fk
   where fk.user_id = v_uid and fk.rol = 'sahip'
   limit 1;
  if v_firma is null then
    raise exception 'Yalnızca firma sahibi abonelik ödeyebilir' using errcode = '42501';
  end if;

  -- Plan
  select * into v_plan from public.abonelik_planlari
   where id = p_plan_id and aktif = true limit 1;
  if v_plan.id is null then
    raise exception 'Plan bulunamadı: %', p_plan_id using errcode = '22023';
  end if;
  if v_plan.sure_gun is null or v_plan.sure_gun <= 0 then
    raise exception 'Plan süresi tanımlı değil' using errcode = '22023';
  end if;

  -- Email + firma adı (Iyzipay'in faturada kullanması için)
  select email into v_email from auth.users where id = v_uid;
  select ad into v_firma_ad from public.firmalar where id = v_firma;

  -- Bekleyen kayıt oluştur
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

  -- Firma durumu 'odeme_bekliyor'a çek
  update public.firmalar
     set abonelik_durumu = 'odeme_bekliyor'
   where id = v_firma
     and abonelik_durumu in ('deneme','suresi_dolmus','iptal');

  return query select v_id, v_plan.fiyat, v_plan.ad, v_plan.sure_gun, v_firma, v_email, v_firma_ad;
end $$;

revoke all on function public.abonelik_odeme_baslat(text, text) from public;
grant execute on function public.abonelik_odeme_baslat(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPC: Iyzipay başarılı callback — Edge function callback çağırır
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.abonelik_iyzipay_aktif_et(
  p_odeme_id              text,
  p_iyzipay_payment_id    text,
  p_iyzipay_token         text,
  p_iyzipay_raw           jsonb,
  p_tutar                 numeric default null
)
returns table (firma_id uuid, abonelik_bitis timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_odeme   record;
  v_yeni_bitis timestamptz;
begin
  -- Bekleyen ödemeyi bul
  select * into v_odeme from public.odeme_gecmisi
   where id = p_odeme_id and durum = 'bekliyor'
   limit 1;
  if v_odeme.id is null then
    raise exception 'Bekleyen ödeme kaydı bulunamadı: %', p_odeme_id using errcode = '22023';
  end if;

  -- Tutar uyumsuzluğu kontrolü (anti-tampering)
  if p_tutar is not null and abs(p_tutar - v_odeme.tutar) > 0.01 then
    update public.odeme_gecmisi
       set durum = 'tutar_uyumsuz',
           iyzipay_payment_id = p_iyzipay_payment_id,
           iyzipay_token      = p_iyzipay_token,
           iyzipay_raw        = p_iyzipay_raw,
           notlar             = 'Iyzipay tutarı (' || p_tutar || ') beklenenden (' || v_odeme.tutar || ') farklı'
     where id = p_odeme_id;
    raise exception 'Tutar uyumsuzluğu' using errcode = '22023';
  end if;

  -- Ödemeyi başarılı işaretle
  update public.odeme_gecmisi
     set durum                 = 'basarili',
         iyzipay_payment_id    = p_iyzipay_payment_id,
         iyzipay_token         = p_iyzipay_token,
         iyzipay_raw           = p_iyzipay_raw,
         notlar                = 'Iyzipay ödeme başarılı'
   where id = p_odeme_id;

  -- Firma aboneliğini aktive et
  -- Eğer halen aktif bir abonelik varsa bitiş tarihini UZAT (yenileme),
  -- yoksa bugünden başlayan yeni abonelik
  select greatest(coalesce(abonelik_bitis, now()), now()) + (
           (select sure_gun from public.abonelik_planlari where id = v_odeme.plan_id) || ' days'
         )::interval
    into v_yeni_bitis
    from public.firmalar where id = v_odeme.firma_id;

  update public.firmalar
     set abonelik_durumu = 'aktif',
         abonelik_plani  = v_odeme.plan_id,
         abonelik_bitis  = v_yeni_bitis,
         odeme_ref       = p_iyzipay_payment_id
   where id = v_odeme.firma_id;

  return query select v_odeme.firma_id, v_yeni_bitis;
end $$;

-- service_role + authenticated execute (callback edge function service role kullanır)
grant execute on function public.abonelik_iyzipay_aktif_et(text, text, text, jsonb, numeric) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RPC: Iyzipay başarısız callback
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.abonelik_iyzipay_basarisiz(
  p_odeme_id      text,
  p_hata_kodu     text default null,
  p_hata_mesaj    text default null,
  p_iyzipay_raw   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma uuid;
begin
  update public.odeme_gecmisi
     set durum         = 'basarisiz',
         iyzipay_raw   = p_iyzipay_raw,
         notlar        = coalesce(p_hata_kodu || ': ', '') || coalesce(p_hata_mesaj, 'Iyzipay reddetti')
   where id = p_odeme_id and durum = 'bekliyor'
   returning firma_id into v_firma;

  -- Firma 'odeme_bekliyor'da kaldıysa eski durumuna döndür (deneme/suresi_dolmus)
  update public.firmalar
     set abonelik_durumu = case
       when deneme_bitis > now() then 'deneme'
       when abonelik_bitis > now() then 'aktif'
       else 'suresi_dolmus'
     end
   where id = v_firma and abonelik_durumu = 'odeme_bekliyor';
end $$;

grant execute on function public.abonelik_iyzipay_basarisiz(text, text, text, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) View: kullanıcının firmalara ait özet — UI'da plan kartları için
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_abonelik_durumu as
select
  f.id as firma_id,
  f.ad as firma_ad,
  f.abonelik_durumu,
  f.abonelik_plani,
  f.deneme_bitis,
  f.abonelik_bitis,
  case
    when f.abonelik_durumu = 'aktif' and f.abonelik_bitis > now() then
      extract(day from (f.abonelik_bitis - now()))::int
    when f.abonelik_durumu = 'deneme' and f.deneme_bitis > now() then
      extract(day from (f.deneme_bitis - now()))::int
    else 0
  end as kalan_gun,
  case
    when f.abonelik_durumu = 'aktif' and f.abonelik_bitis > now() then true
    when f.abonelik_durumu = 'deneme' and f.deneme_bitis > now() then true
    else false
  end as kullanim_aktif
from public.firmalar f;

grant select on public.v_abonelik_durumu to authenticated;

commit;
