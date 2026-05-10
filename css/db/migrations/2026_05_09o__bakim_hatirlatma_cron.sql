-- =============================================================================
-- 2026_05_09o__bakim_hatirlatma_cron.sql
-- Faz 9 — Bakım randevusu hatırlatma cron'u + push.
--
-- AKIŞ (her gün 06:00 UTC / 09:00 TR):
--   1) plan_tarihi geride kalan 'planlandi' kayıtları otomatik 'gecikmis'e çek.
--   2) kalan_gun ∈ {7, 1, 0} olan randevular için:
--        a) hatirlatma_*_at kolonu NULL ise:
--           - bildirimler tablosuna kayıt (yönetici görür — bell icon)
--           - varsa atanmış sürücüye push (notify-driver Edge Function)
--           - hatirlatma_*_at = now() set (idempotent)
--
-- BAĞIMLI:
--   * 2026_05_09n  — bakim_randevulari tablosu
--   * 2026_04_28d  — notify-driver Edge Function (FCM + Web Push)
--   * 2026_05_05   — bildirimler + notify_create
--   * pg_cron extension
-- =============================================================================

create extension if not exists pg_cron with schema extensions;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Helper: _bakim_push_gonder
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._bakim_push_gonder(
  p_surucu_id  uuid,
  p_title      text,
  p_body       text,
  p_arac_id    text,
  p_randevu_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_surl text := current_setting('app.supabase_url',     true);
  v_skey text := current_setting('app.service_role_key', true);
  v_req  bigint;
begin
  if p_surucu_id is null then return null; end if;
  if v_surl is null or v_skey is null then
    raise warning '[_bakim_push_gonder] app.supabase_url / app.service_role_key set edilmemis, atlandi';
    return null;
  end if;

  begin
    select extensions.net.http_post(
      url     := v_surl || '/functions/v1/notify-driver',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_skey
                 ),
      body    := jsonb_build_object(
                   'surucu_id', p_surucu_id::text,
                   'title',     p_title,
                   'body',      p_body,
                   'type',      'bakim_randevu',
                   'url',       '/sofor.html',
                   'arac_id',   p_arac_id,
                   'randevu_id', p_randevu_id
                 ),
      timeout_milliseconds := 5000
    ) into v_req;
    return v_req;
  exception when others then
    raise warning '[_bakim_push_gonder] pg_net hata: %', sqlerrm;
    return null;
  end;
end $fn$;

revoke execute on function public._bakim_push_gonder(uuid, text, text, text, bigint) from public;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Cron RPC: cron_bakim_hatirlatma_gunluk
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cron_bakim_hatirlatma_gunluk()
returns table (
  randevu_id    bigint,
  arac_plaka    text,
  esik          int,           -- 7, 1, 0
  yonetici_bildirim_atildi boolean,
  surucu_push_atildi        boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  v_esik int;
  v_kolon text;
  v_tip_label text;
  v_baslik text;
  v_mesaj  text;
  v_surucu_id uuid;
  v_pg_req bigint;
  v_yon_atildi boolean;
  v_psh_atildi boolean;
begin
  -- 1) Geride kalan planlandi → gecikmis
  update public.bakim_randevulari
  set durum = 'gecikmis'
  where durum = 'planlandi' and plan_tarihi < current_date;

  -- 2) Hatırlatma eşikleri için tara
  for r in (
    select
      br.id, br.firma_id, br.arac_id, br.tip, br.plan_tarihi,
      br.hatirlatma_7gun_at, br.hatirlatma_1gun_at, br.hatirlatma_0gun_at,
      a.plaka as arac_plaka,
      a.birincil_surucu_id as surucu_id,
      (br.plan_tarihi - current_date)::int as kalan_gun
    from public.bakim_randevulari br
    join public.araclar a on a.id = br.arac_id
    where br.durum in ('planlandi', 'gecikmis')
      and (br.plan_tarihi - current_date)::int in (7, 1, 0)
  ) loop
    v_esik := r.kalan_gun;
    v_kolon := 'hatirlatma_' || v_esik || 'gun_at';

    -- Bu eşik için zaten gönderildi mi?
    if (v_esik = 7 and r.hatirlatma_7gun_at is not null) or
       (v_esik = 1 and r.hatirlatma_1gun_at is not null) or
       (v_esik = 0 and r.hatirlatma_0gun_at is not null) then
      continue;
    end if;

    v_tip_label := case r.tip
      when 'muayene'         then 'muayene'
      when 'sigorta'         then 'sigorta yenileme'
      when 'takograf'        then 'takograf kalibrasyonu'
      when 'periyodik_bakim' then 'periyodik bakım'
      when 'lastik'          then 'lastik değişimi'
      else                        r.tip
    end;

    if v_esik = 0 then
      v_baslik := '🛠 ' || r.arac_plaka || ' — bugün ' || v_tip_label;
      v_mesaj  := r.arac_plaka || ' aracın ' || v_tip_label || ' randevusu BUGÜN. Lütfen götürün.';
    elsif v_esik = 1 then
      v_baslik := '⏰ ' || r.arac_plaka || ' — yarın ' || v_tip_label;
      v_mesaj  := r.arac_plaka || ' yarın ' || v_tip_label || ' için servise girecek.';
    else  -- 7
      v_baslik := '📅 ' || r.arac_plaka || ' — 1 hafta sonra ' || v_tip_label;
      v_mesaj  := r.arac_plaka || ' aracın ' || v_tip_label || ' randevusu ' ||
                  to_char(r.plan_tarihi, 'DD.MM.YYYY') || ' (1 hafta).';
    end if;

    v_yon_atildi := false;
    v_psh_atildi := false;

    -- 2a) Yönetici bildirim (bildirimler tablosu — bell icon)
    begin
      perform public.notify_create(
        r.firma_id,
        'genel',
        v_baslik,
        v_mesaj,
        'bakim_randevu',
        r.id::text,
        null,
        'Sistem',
        case when v_esik = 0 then 'kritik'
             when v_esik = 1 then 'yuksek'
             else 'normal' end
      );
      v_yon_atildi := true;
    exception when others then
      raise warning '[cron_bakim_hatirlatma] notify_create hata (% / %): %',
        r.id, v_esik, sqlerrm;
    end;

    -- 2b) Sürücü push (FCM/Web Push) — atanmış sürücü varsa
    if r.surucu_id is not null then
      v_pg_req := public._bakim_push_gonder(
        r.surucu_id,
        v_baslik,
        v_mesaj,
        r.arac_id,
        r.id
      );
      v_psh_atildi := (v_pg_req is not null);
    end if;

    -- 2c) Idempotency flag set
    if v_esik = 7 then
      update public.bakim_randevulari set hatirlatma_7gun_at = now() where id = r.id;
    elsif v_esik = 1 then
      update public.bakim_randevulari set hatirlatma_1gun_at = now() where id = r.id;
    else
      update public.bakim_randevulari set hatirlatma_0gun_at = now() where id = r.id;
    end if;

    randevu_id := r.id;
    arac_plaka := r.arac_plaka;
    esik       := v_esik;
    yonetici_bildirim_atildi := v_yon_atildi;
    surucu_push_atildi       := v_psh_atildi;
    return next;
  end loop;

  return;
end $fn$;

revoke all on function public.cron_bakim_hatirlatma_gunluk() from public;
grant execute on function public.cron_bakim_hatirlatma_gunluk() to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) pg_cron schedule
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'bakim_hatirlatma_gunluk') then
    perform cron.unschedule('bakim_hatirlatma_gunluk');
  end if;
end $$;

select cron.schedule(
  'bakim_hatirlatma_gunluk',
  '0 6 * * *',  -- her gün 06:00 UTC = 09:00 TR
  $cron$ select public.cron_bakim_hatirlatma_gunluk(); $cron$
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Yeni randevu eklenince ANINDA bilgilendirme trigger'ı
--    "Filo bir randevu eklediği gibi sürücü bunu bilsin" — kullanıcı talebi.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_bakim_randevu_ilk_bildirim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arac_plaka text;
  v_surucu_id  uuid;
  v_tip_label  text;
  v_baslik     text;
  v_mesaj      text;
begin
  -- Yalnızca gerçekten yeni planlandı kayıtlarda (yapildi/iptal değil)
  if NEW.durum not in ('planlandi', 'gecikmis') then
    return NEW;
  end if;

  select a.plaka, a.birincil_surucu_id
    into v_arac_plaka, v_surucu_id
    from public.araclar a where a.id = NEW.arac_id;

  v_tip_label := case NEW.tip
    when 'muayene'         then 'muayene'
    when 'sigorta'         then 'sigorta yenileme'
    when 'takograf'        then 'takograf kalibrasyonu'
    when 'periyodik_bakim' then 'periyodik bakım'
    when 'lastik'          then 'lastik değişimi'
    else                        NEW.tip
  end;

  v_baslik := '📌 Yeni bakım randevusu — ' || coalesce(v_arac_plaka, NEW.arac_id);
  v_mesaj  := coalesce(v_arac_plaka, NEW.arac_id) || ' için ' || v_tip_label ||
              ' randevusu ' || to_char(NEW.plan_tarihi, 'DD.MM.YYYY') || ' tarihine planlandı.';

  -- Yönetici bell icon
  begin
    perform public.notify_create(
      NEW.firma_id,
      'genel',
      v_baslik,
      v_mesaj,
      'bakim_randevu',
      NEW.id::text,
      NEW.olusturan_user_id,
      'Bakım Planlaması',
      'normal'
    );
  exception when others then
    raise warning '[trg_bakim_randevu_ilk_bildirim] notify_create hata: %', sqlerrm;
  end;

  -- Atanmış sürücüye anında push
  if v_surucu_id is not null then
    perform public._bakim_push_gonder(
      v_surucu_id,
      v_baslik,
      v_mesaj,
      NEW.arac_id,
      NEW.id
    );
  end if;

  return NEW;
end $$;

drop trigger if exists trg_bakim_randevu_ilk_bildirim on public.bakim_randevulari;
create trigger trg_bakim_randevu_ilk_bildirim
  after insert on public.bakim_randevulari
  for each row execute function public.trg_bakim_randevu_ilk_bildirim();


-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Cron job:
--    select jobname, schedule, active from cron.job where jobname = 'bakim_hatirlatma_gunluk';
--
-- 2) Manuel cron tetikle:
--    select * from public.cron_bakim_hatirlatma_gunluk();
--
-- 3) Test akışı:
--    -- 7 gün sonrası bir randevu ekle
--    select * from bakim_randevu_olustur('demo_34abc1234', 'muayene', current_date + 7, null, 'test');
--    -- Anında bildirim oluştu mu?
--    select * from bildirimler where ilgili_tur='bakim_randevu' order by created_at desc limit 5;
--    -- Cron'u manuel çalıştır → 7gun hatırlatması eklenmeli
--    select * from cron_bakim_hatirlatma_gunluk();
--    -- Tekrar çalıştır → idempotency, ikinci kez eklemez
--    select * from cron_bakim_hatirlatma_gunluk();
--
-- 4) Push test:
--    Atanmış sürücülü bir araç + plan_tarihi = current_date için randevu ekleyin.
--    cron çalışınca sürücü cihazına FCM bildirimi gelmeli.
-- =============================================================================
