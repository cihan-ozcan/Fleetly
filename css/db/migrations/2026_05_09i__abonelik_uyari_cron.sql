-- =============================================================================
-- 2026_05_09i__abonelik_uyari_cron.sql
-- Faz 6 — Abonelik / deneme bitiş uyarı email cron'u:
--
--   * pg_cron extension (Supabase Pro değil, Free tier'da da mevcut)
--   * email_gonderim_log tablosu (idempotency — aynı gün ikinci email YOK)
--   * cron_abonelik_uyari_gonder() RPC — kalan gün ∈ {3, 1} firmalar için email
--   * cron schedule: her gün 06:00 UTC (= 09:00 Europe/Istanbul) çalışır
--
-- DEPLOY ÖNCESİ (h migration yüklü olmalı):
--   - alter database postgres set app.email_endpoint = '...';
--   - alter database postgres set app.email_secret   = '...';
--   - send-email Edge Function deploy edilmiş olmalı.
--
-- TEST:
--   select * from public.cron_abonelik_uyari_gonder();
-- =============================================================================

create extension if not exists pg_cron with schema extensions;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Email gönderim log (idempotency)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.email_gonderim_log (
  id                 bigserial primary key,
  firma_id           uuid not null references public.firmalar(id) on delete cascade,
  template           text not null,
  gun                date not null default current_date,
  alici_email        text not null,
  sent_at            timestamptz not null default now(),
  pg_net_request_id  bigint,
  notlar             text
);

-- Aynı firma/template/gün birden fazla kez insert edilemez
create unique index if not exists idx_email_log_firma_template_gun
  on public.email_gonderim_log (firma_id, template, gun);

create index if not exists idx_email_log_firma_sent
  on public.email_gonderim_log (firma_id, sent_at desc);

-- RLS — yöneticiler firmalarının log'unu okuyabilir
alter table public.email_gonderim_log enable row level security;

drop policy if exists email_log_select on public.email_gonderim_log;
create policy email_log_select on public.email_gonderim_log
  for select to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()));

drop policy if exists email_log_insert on public.email_gonderim_log;
create policy email_log_insert on public.email_gonderim_log
  for insert to authenticated with check (false);   -- yalnızca SECURITY DEFINER RPC

drop policy if exists email_log_update on public.email_gonderim_log;
create policy email_log_update on public.email_gonderim_log
  for update to authenticated using (false);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RPC: cron_abonelik_uyari_gonder
--   Her firma için sahibe email atar. kalan_gun ∈ {3, 1} olanlar tetiklenir.
--   Idempotent: email_gonderim_log unique constraint ile aynı gün skip.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cron_abonelik_uyari_gonder()
returns table (firma_id uuid, alici_email text, tip text, kalan_gun int, gonderildi boolean)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  v_log_id bigint;
  v_req_id bigint;
  v_template text;
  v_tip text;
begin
  for r in (
    select
      f.id              as firma_id,
      f.ad              as firma_ad,
      f.abonelik_durumu as durum,
      f.abonelik_plani  as plan,
      v.kalan_gun       as kalan_gun,
      case
        when f.abonelik_durumu = 'deneme' then f.deneme_bitis
        when f.abonelik_durumu = 'aktif'  then f.abonelik_bitis
        else null
      end as bitis_at,
      u.email::text as alici_email
    from public.firmalar f
    join public.v_abonelik_durumu v on v.firma_id = f.id
    join public.firma_kullanicilar fk on fk.firma_id = f.id and fk.rol = 'sahip'
    join auth.users u on u.id = fk.user_id
    where v.kullanim_aktif = true
      and v.kalan_gun in (1, 3)
      and f.abonelik_durumu in ('deneme', 'aktif')
      -- Silme talebinde olan firmalara uyarı atma (kullanıcı zaten silmek istiyor)
      and (f.silme_kalici_at is null or f.silme_kalici_at > now() + interval '90 days')
  ) loop
    -- tip: 'deneme' veya 'aktif'
    v_tip := r.durum;
    v_template := 'abonelik_uyari_gun_' || r.kalan_gun || '_' || v_tip;

    -- Log INSERT — aynı gün/firma/template ikinci kez çalışırsa conflict, skip.
    insert into public.email_gonderim_log (firma_id, template, alici_email)
    values (r.firma_id, v_template, r.alici_email)
    on conflict (firma_id, template, gun) do nothing
    returning id into v_log_id;

    if v_log_id is null then
      firma_id := r.firma_id;
      alici_email := r.alici_email;
      tip := v_tip;
      kalan_gun := r.kalan_gun;
      gonderildi := false;   -- zaten gönderilmiş
      return next;
      continue;
    end if;

    -- Email tetikle
    select public._email_gonder(
      'abonelik_uyari',
      r.alici_email,
      jsonb_build_object(
        'firma_id',     r.firma_id,
        'firma_ad',     coalesce(r.firma_ad, 'Firmanız'),
        'tip',          v_tip,
        'kalan_gun',    r.kalan_gun,
        'plan',         r.plan,
        'bitis_pretty', to_char(r.bitis_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI')
      )
    ) into v_req_id;

    update public.email_gonderim_log
       set pg_net_request_id = v_req_id
     where id = v_log_id;

    firma_id    := r.firma_id;
    alici_email := r.alici_email;
    tip         := v_tip;
    kalan_gun   := r.kalan_gun;
    gonderildi  := (v_req_id is not null);
    return next;
  end loop;

  return;
end;
$fn$;

revoke all on function public.cron_abonelik_uyari_gonder() from public;
grant execute on function public.cron_abonelik_uyari_gonder() to service_role;

comment on function public.cron_abonelik_uyari_gonder() is
  'Faz 6 — pg_cron daily job. kalan_gun ∈ {3,1} olan firma sahiplerine uyarı emaili.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) pg_cron schedule — günlük 06:00 UTC (= 09:00 TR yaz / 09:00 TR kış)
-- ─────────────────────────────────────────────────────────────────────────────
-- Eski job varsa temizle (re-run idempotency)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'abonelik_uyari_gunluk') then
    perform cron.unschedule('abonelik_uyari_gunluk');
  end if;
end $$;

select cron.schedule(
  'abonelik_uyari_gunluk',
  '0 6 * * *',
  $cron$ select public.cron_abonelik_uyari_gonder(); $cron$
);


-- =============================================================================
-- DOGRULAMA
-- =============================================================================
-- 1) Cron job'u listele:
--    select jobname, schedule, command, active from cron.job where jobname = 'abonelik_uyari_gunluk';
--
-- 2) Manuel test (oturum gerekmez — service_role veya superuser):
--    select * from public.cron_abonelik_uyari_gonder();
--
-- 3) Log incele:
--    select * from public.email_gonderim_log order by sent_at desc limit 20;
--
-- 4) pg_cron last-run durumu:
--    select * from cron.job_run_details
--      where jobid = (select jobid from cron.job where jobname = 'abonelik_uyari_gunluk')
--      order by start_time desc limit 5;
-- =============================================================================
