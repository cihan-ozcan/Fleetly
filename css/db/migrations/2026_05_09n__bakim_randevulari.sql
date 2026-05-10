-- =============================================================================
-- 2026_05_09n__bakim_randevulari.sql
-- Faz 9 (post-launch feature) — Araç bakım/muayene randevu yönetimi.
--
-- AMAÇ:
--   * Filo yönetimi araca/dorseye muayene/sigorta/takograf/bakım tarihi planlar
--   * Anasayfa "Yaklaşan Bakımlar" kartı RPC ile populate olur
--   * Sürücü mobil uygulamasında atandığı araç + dorse'un randevuları görür
--   * 7/1/0 gün öncesi sürücüye + yöneticiye otomatik bildirim (cron)
--
-- DESIGN:
--   bakim_kayitlari = YAPILMIŞ bakımlar (mevcut tablo, dokunmuyoruz)
--   bakim_randevulari = PLANLANMIŞ randevular (yeni)
--   "yapildi" işaretlenince ayrıca bakim_kayitlari'na satır atıyoruz (entegrasyon)
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tablo
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.bakim_randevulari (
  id                  bigserial primary key,
  firma_id            uuid not null references public.firmalar(id) on delete cascade,
  arac_id             text not null references public.araclar(id) on delete cascade,
  -- Tip — UI'da renk + ikon ayrımı için (genişletilebilir)
  tip                 text not null check (tip in (
                        'muayene',         -- TÜVTÜRK / ekspertiz
                        'sigorta',         -- trafik + kasko yenileme
                        'takograf',        -- dijital takograf kalibrasyonu
                        'periyodik_bakim', -- yağ + filtre + servis
                        'lastik',          -- lastik değişimi
                        'diger'            -- serbest
                      )),
  plan_tarihi         date not null,
  durum               text not null default 'planlandi' check (durum in (
                        'planlandi', 'yapildi', 'iptal', 'gecikmis'
                      )),
  -- Yapıldığında doldurulur
  gerceklesen_tarih   date,
  gerceklesen_km      numeric,
  servis_adi          text,
  maliyet             numeric default 0,
  bakim_kayit_id      text references public.bakim_kayitlari(id) on delete set null,
  -- Bildirim trace (idempotency: aynı eşik için ikinci kez push gitmez)
  hatirlatma_7gun_at  timestamptz,
  hatirlatma_1gun_at  timestamptz,
  hatirlatma_0gun_at  timestamptz,
  notlar              text,
  iptal_nedeni        text,
  olusturan_user_id   uuid references auth.users(id) on delete set null,
  guncelleyen_user_id uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_bakim_rand_firma_tarih
  on public.bakim_randevulari (firma_id, plan_tarihi);

create index if not exists idx_bakim_rand_arac
  on public.bakim_randevulari (arac_id, plan_tarihi);

create index if not exists idx_bakim_rand_durum_tarih
  on public.bakim_randevulari (firma_id, durum, plan_tarihi)
  where durum in ('planlandi', 'gecikmis');

-- updated_at trigger
create or replace function public._bakim_rand_set_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_bakim_rand_updated on public.bakim_randevulari;
create trigger trg_bakim_rand_updated
  before update on public.bakim_randevulari
  for each row execute function public._bakim_rand_set_updated();

comment on table public.bakim_randevulari is
  'Faz 9 — planlanmış bakım/muayene/sigorta/takograf randevuları. Yapıldığında bakim_kayitlari''na bağlanır.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.bakim_randevulari enable row level security;

-- Yetkili kullanıcılar (sahip/yönetici/operasyoncu/muhasebeci) firma randevularını görür
drop policy if exists bakim_rand_select on public.bakim_randevulari;
create policy bakim_rand_select on public.bakim_randevulari
  for select to authenticated
  using (
    -- ofis ekibi
    firma_id in (select public._user_firma_yetkili_ids())
    or
    -- sürücü kendi atandığı aracın randevularını görür
    exists (
      select 1 from public.araclar a
      join public.suruculer s on s.id = a.birincil_surucu_id
      where a.id = bakim_randevulari.arac_id
        and s.auth_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE yalnızca SECURITY DEFINER RPC üzerinden
drop policy if exists bakim_rand_insert on public.bakim_randevulari;
create policy bakim_rand_insert on public.bakim_randevulari
  for insert to authenticated with check (false);

drop policy if exists bakim_rand_update on public.bakim_randevulari;
create policy bakim_rand_update on public.bakim_randevulari
  for update to authenticated using (false);

drop policy if exists bakim_rand_delete on public.bakim_randevulari;
create policy bakim_rand_delete on public.bakim_randevulari
  for delete to authenticated using (false);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPC: bakim_randevu_olustur
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bakim_randevu_olustur(
  p_arac_id     text,
  p_tip         text,
  p_plan_tarihi date,
  p_servis_adi  text default null,
  p_notlar      text default null
)
returns table (id bigint, durum text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_firma  uuid;
  v_arac_firma uuid;
  v_id     bigint;
  v_durum  text;
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  -- Yetki: sahip/yönetici/operasyoncu randevu oluşturabilir
  select fk.firma_id into v_firma
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
    and fk.rol in ('sahip', 'yonetici', 'operasyoncu')
  limit 1;
  if v_firma is null then
    raise exception 'Yetkisiz: bakım randevusu oluşturma izniniz yok' using errcode = '42501';
  end if;

  -- Araç firma ile eşleşiyor mu?
  select firma_id into v_arac_firma from public.araclar where id = p_arac_id;
  if v_arac_firma is null then
    raise exception 'Araç bulunamadı: %', p_arac_id using errcode = '22023';
  end if;
  if v_arac_firma <> v_firma then
    raise exception 'Bu araç başka firmaya ait' using errcode = '42501';
  end if;

  -- Tip + tarih validasyonu
  if p_tip not in ('muayene','sigorta','takograf','periyodik_bakim','lastik','diger') then
    raise exception 'Geçersiz tip: %', p_tip using errcode = '22023';
  end if;
  if p_plan_tarihi is null then
    raise exception 'Planlanan tarih zorunlu' using errcode = '22023';
  end if;

  -- Durum: tarih bugünden geride ise 'gecikmis', değilse 'planlandi'
  v_durum := case when p_plan_tarihi < current_date then 'gecikmis' else 'planlandi' end;

  insert into public.bakim_randevulari (
    firma_id, arac_id, tip, plan_tarihi, durum,
    servis_adi, notlar, olusturan_user_id
  ) values (
    v_firma, p_arac_id, p_tip, p_plan_tarihi, v_durum,
    p_servis_adi, p_notlar, v_uid
  )
  returning bakim_randevulari.id, bakim_randevulari.durum into v_id, v_durum;

  return query select v_id, v_durum;
end $fn$;

revoke all on function public.bakim_randevu_olustur(text, text, date, text, text) from public;
grant execute on function public.bakim_randevu_olustur(text, text, date, text, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RPC: bakim_randevu_yapildi_isaretle
--   Randevu durumu='yapildi'ya çekilir, bakim_kayitlari'na satır atılır.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bakim_randevu_yapildi_isaretle(
  p_id                bigint,
  p_gerceklesen_tarih date default null,
  p_gerceklesen_km    numeric default null,
  p_maliyet           numeric default null,
  p_servis_adi        text default null,
  p_notlar            text default null
)
returns table (id bigint, bakim_kayit_id text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_firma  uuid;
  v_rand   record;
  v_kayit_id text := 'bk_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
  v_tarih  date;
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  select fk.firma_id into v_firma
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
    and fk.rol in ('sahip', 'yonetici', 'operasyoncu')
  limit 1;
  if v_firma is null then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  select * into v_rand from public.bakim_randevulari where id = p_id and firma_id = v_firma;
  if v_rand.id is null then
    raise exception 'Randevu bulunamadı: %', p_id using errcode = '22023';
  end if;
  if v_rand.durum = 'yapildi' then
    raise exception 'Bu randevu zaten yapıldı işaretli' using errcode = '23505';
  end if;
  if v_rand.durum = 'iptal' then
    raise exception 'İptal edilmiş randevu yapıldı işaretlenemez' using errcode = '22023';
  end if;

  v_tarih := coalesce(p_gerceklesen_tarih, current_date);

  -- bakim_kayitlari'na satır ekle (entegrasyon)
  insert into public.bakim_kayitlari (
    id, user_id, arac_id, tarih, tur, aciklama, km, maliyet, servis, firma_id
  ) values (
    v_kayit_id,
    v_uid,
    v_rand.arac_id,
    v_tarih,
    v_rand.tip,
    coalesce(p_notlar, v_rand.notlar),
    p_gerceklesen_km,
    coalesce(p_maliyet, 0),
    coalesce(p_servis_adi, v_rand.servis_adi),
    v_firma
  );

  -- Randevuyu güncelle
  update public.bakim_randevulari
  set durum               = 'yapildi',
      gerceklesen_tarih   = v_tarih,
      gerceklesen_km      = p_gerceklesen_km,
      maliyet             = coalesce(p_maliyet, maliyet),
      servis_adi          = coalesce(p_servis_adi, servis_adi),
      notlar              = coalesce(p_notlar, notlar),
      bakim_kayit_id      = v_kayit_id,
      guncelleyen_user_id = v_uid
  where id = p_id;

  return query select p_id, v_kayit_id;
end $fn$;

revoke all on function public.bakim_randevu_yapildi_isaretle(bigint, date, numeric, numeric, text, text) from public;
grant execute on function public.bakim_randevu_yapildi_isaretle(bigint, date, numeric, numeric, text, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPC: bakim_randevu_iptal
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bakim_randevu_iptal(
  p_id     bigint,
  p_neden  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_firma uuid;
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  select fk.firma_id into v_firma
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
    and fk.rol in ('sahip', 'yonetici', 'operasyoncu')
  limit 1;
  if v_firma is null then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  update public.bakim_randevulari
  set durum               = 'iptal',
      iptal_nedeni        = p_neden,
      guncelleyen_user_id = v_uid
  where id = p_id and firma_id = v_firma and durum in ('planlandi', 'gecikmis');

  if not found then
    raise exception 'Randevu bulunamadı veya iptal edilemez durumda';
  end if;
end $fn$;

revoke all on function public.bakim_randevu_iptal(bigint, text) from public;
grant execute on function public.bakim_randevu_iptal(bigint, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) RPC: bakim_randevu_listele (yönetici tarafı, full liste)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.bakim_randevu_listele(
  p_durum   text default null,
  p_arac_id text default null,
  p_limit   int  default 100
)
returns table (
  id              bigint,
  arac_id         text,
  arac_plaka      text,
  arac_tip        text,
  tip             text,
  plan_tarihi     date,
  kalan_gun       int,
  durum           text,
  gerceklesen_tarih date,
  servis_adi      text,
  maliyet         numeric,
  notlar          text,
  surucu_ad       text,
  surucu_id       uuid,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_firma uuid;
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  select fk.firma_id into v_firma
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
    and fk.rol in ('sahip', 'yonetici', 'operasyoncu', 'muhasebeci')
  limit 1;
  if v_firma is null then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.arac_id,
    a.plaka,
    a.tip,
    r.tip,
    r.plan_tarihi,
    (r.plan_tarihi - current_date)::int as kalan_gun,
    -- Otomatik gecikmiş statüsü
    case
      when r.durum = 'planlandi' and r.plan_tarihi < current_date then 'gecikmis'
      else r.durum
    end as durum,
    r.gerceklesen_tarih,
    r.servis_adi,
    r.maliyet,
    r.notlar,
    coalesce(s.ad || ' ' || coalesce(s.soyad, ''), '') as surucu_ad,
    a.birincil_surucu_id as surucu_id,
    r.created_at
  from public.bakim_randevulari r
  join public.araclar a on a.id = r.arac_id
  left join public.suruculer s on s.id = a.birincil_surucu_id
  where r.firma_id = v_firma
    and (p_durum is null or
         (p_durum = 'aktif'    and r.durum in ('planlandi','gecikmis')) or
         (p_durum = 'tamamlandi' and r.durum = 'yapildi') or
         r.durum = p_durum)
    and (p_arac_id is null or r.arac_id = p_arac_id)
  order by r.plan_tarihi asc
  limit greatest(p_limit, 1);
end $fn$;

grant execute on function public.bakim_randevu_listele(text, text, int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RPC: yaklasan_bakimlar_listele (anasayfa kartı)
--   30 gün içindeki tüm aktif (planlandi + gecikmis) randevular.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.yaklasan_bakimlar_listele(p_gun int default 30)
returns table (
  id          bigint,
  arac_id     text,
  arac_plaka  text,
  arac_tip    text,
  tip         text,
  plan_tarihi date,
  kalan_gun   int,
  durum       text,
  surucu_ad   text
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_firma uuid;
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  select fk.firma_id into v_firma
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  limit 1;
  if v_firma is null then
    raise exception 'Firma bulunamadı';
  end if;

  return query
  select
    r.id,
    r.arac_id,
    a.plaka,
    a.tip,
    r.tip,
    r.plan_tarihi,
    (r.plan_tarihi - current_date)::int,
    case
      when r.plan_tarihi < current_date then 'gecikmis'
      else 'planlandi'
    end,
    coalesce(s.ad || ' ' || coalesce(s.soyad, ''), '')
  from public.bakim_randevulari r
  join public.araclar a on a.id = r.arac_id
  left join public.suruculer s on s.id = a.birincil_surucu_id
  where r.firma_id = v_firma
    and r.durum in ('planlandi', 'gecikmis')
    and r.plan_tarihi <= current_date + (greatest(p_gun, 1) || ' days')::interval
  order by r.plan_tarihi asc
  limit 100;
end $fn$;

grant execute on function public.yaklasan_bakimlar_listele(int) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8) RPC: surucu_bakim_randevulari (mobile uygulama tarafı)
--   Sürücü auth_user_id'sinden atandığı araç + dorse'un yaklaşan + son 30 gün
--   yapılmış randevularını çeker.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.surucu_bakim_randevulari()
returns table (
  id          bigint,
  arac_id     text,
  arac_plaka  text,
  arac_tip    text,
  tip         text,
  plan_tarihi date,
  kalan_gun   int,
  durum       text,
  servis_adi  text,
  notlar      text,
  gerceklesen_tarih date
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_surucu  uuid;
begin
  if v_uid is null then
    raise exception 'Yetkisiz' using errcode = '28000';
  end if;

  select id into v_surucu from public.suruculer where auth_user_id = v_uid limit 1;
  if v_surucu is null then
    -- Sürücü kaydı yoksa boş dön
    return;
  end if;

  return query
  select
    r.id,
    r.arac_id,
    a.plaka,
    a.tip,
    r.tip,
    r.plan_tarihi,
    (r.plan_tarihi - current_date)::int,
    case
      when r.durum = 'planlandi' and r.plan_tarihi < current_date then 'gecikmis'
      else r.durum
    end,
    r.servis_adi,
    r.notlar,
    r.gerceklesen_tarih
  from public.bakim_randevulari r
  join public.araclar a on a.id = r.arac_id
  where a.birincil_surucu_id = v_surucu
    and (
      -- aktif + gelecek 90 gün
      (r.durum in ('planlandi', 'gecikmis')
        and r.plan_tarihi <= current_date + interval '90 days')
      or
      -- son 30 gün yapılmış
      (r.durum = 'yapildi'
        and r.gerceklesen_tarih >= current_date - interval '30 days')
    )
  order by
    case r.durum when 'gecikmis' then 1 when 'planlandi' then 2 else 3 end,
    r.plan_tarihi asc
  limit 50;
end $fn$;

grant execute on function public.surucu_bakim_randevulari() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9) View: v_bakim_dashboard_ozet (anasayfa stat kartları için)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_bakim_dashboard_ozet as
select
  r.firma_id,
  count(*) filter (where r.durum in ('planlandi','gecikmis') and r.plan_tarihi <= current_date + interval '7 days')  as bu_hafta,
  count(*) filter (where r.durum in ('planlandi','gecikmis') and r.plan_tarihi <= current_date + interval '30 days') as bu_ay,
  count(*) filter (where r.durum = 'gecikmis' or (r.durum = 'planlandi' and r.plan_tarihi < current_date))           as gecikmis,
  count(*) filter (where r.tip = 'muayene' and r.durum in ('planlandi','gecikmis') and r.plan_tarihi <= current_date + interval '30 days') as muayene_yaklasan,
  count(*) filter (where r.tip = 'sigorta' and r.durum in ('planlandi','gecikmis') and r.plan_tarihi <= current_date + interval '30 days') as sigorta_yaklasan
from public.bakim_randevulari r
group by r.firma_id;

grant select on public.v_bakim_dashboard_ozet to authenticated;

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Yeni randevu oluştur (sahip/yönetici hesabıyla):
--    select * from bakim_randevu_olustur(
--      'demo_34abc1234',          -- arac_id (mevcut bir araç)
--      'muayene',
--      current_date + interval '15 days',
--      'TÜVTÜRK Maslak',
--      'Yıllık muayene'
--    );
--
-- 2) Yaklaşan listeyi gör:
--    select * from yaklasan_bakimlar_listele(30);
--
-- 3) Sürücü tarafı (mobile çağırır):
--    select * from surucu_bakim_randevulari();
--
-- 4) Yapıldı işaretle:
--    select * from bakim_randevu_yapildi_isaretle(<id>, current_date, 245000, 850, 'Servis A.Ş.', 'Yağ + filtre değişti');
--
-- 5) Dashboard özeti:
--    select * from v_bakim_dashboard_ozet;
-- =============================================================================
