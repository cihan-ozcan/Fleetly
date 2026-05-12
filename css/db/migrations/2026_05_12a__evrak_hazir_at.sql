-- =============================================================================
-- FLEETLY  —  2026-05-12a  —  Evrak Hazır Bayrağı
-- =============================================================================
-- AÇIK:
--   Operasyon yeni iş emri açtığında şoför mobil "Hazırlanıyor" sekmesinde
--   görüyor ve hemen "Yola Çıktım" diyebiliyor. Ama evrak işleri (gümrük,
--   müşteri talimat, mühür no, vb.) henüz tamamlanmamış olabiliyor. Operasyon
--   "iş hazır" deyene kadar şoför yola çıkmamalı.
--
-- ÇÖZÜM:
--   is_emirleri.evrak_hazir_at timestamptz kolonu:
--     NULL    → operasyon henüz hazır işaretlememiş
--     NOT NULL → evraklar hazır, şoför "Yola Çıktım" diyebilir
--
--   2 RPC (operasyon UI'da kullanılır, SECURITY DEFINER + yetki kontrolü):
--     is_emri_evrak_hazir_isaretle(id) → evrak_hazir_at = now()
--     is_emri_evrak_hazir_geri_al(id)  → evrak_hazir_at = NULL (sadece Bekliyor)
--
--   2 trigger:
--     trg_isemri_evrak_hazir_kontrol  — BEFORE UPDATE; durum Bekliyor→Yolda
--       geçişinde evrak_hazir_at NULL ise reddeder (mobil hile yapsa bile DB
--       garanti verir)
--     trg_isemri_evrak_hazir_push     — AFTER UPDATE OF evrak_hazir_at;
--       NULL→dolu geçişinde şoföre yüksek öncelikli push
--
--   Backfill: mevcut tüm işlere evrak_hazir_at = created_at uygulanır
--   (eski davranış aynen korunur, hiçbir kullanıcı kesintisi yok).
--
-- BAĞIMLILIK:
--   _user_firma_yetkili_ids (2026_05_07b)
--   notify_create           (2026_05_10b)
--   is_emirleri tablosu     (mevcut)
--
-- GERİ ALMA:
--   drop trigger if exists trg_isemri_evrak_hazir_push on public.is_emirleri;
--   drop trigger if exists trg_isemri_evrak_hazir_kontrol on public.is_emirleri;
--   drop function if exists public.trg_isemri_evrak_hazir_push();
--   drop function if exists public.trg_isemri_evrak_hazir_kontrol();
--   drop function if exists public.is_emri_evrak_hazir_isaretle(bigint);
--   drop function if exists public.is_emri_evrak_hazir_geri_al(bigint);
--   drop index if exists idx_isemri_evrak_hazir;
--   alter table public.is_emirleri drop column if exists evrak_hazir_at;
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) KOLON + BACKFILL
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.is_emirleri
  add column if not exists evrak_hazir_at timestamptz;

comment on column public.is_emirleri.evrak_hazir_at is
  'Operasyon evraklarını hazır işaretlediği an. NULL = hazırlanıyor (şoför yola çıkamaz). NOT NULL = hazır (şoför yola çıkabilir).';

-- Mevcut iş emirlerini hazır say (geçiş kesintisiz olsun)
update public.is_emirleri
   set evrak_hazir_at = coalesce(atama_zamani, created_at, now())
 where evrak_hazir_at is null;

-- Mobil sekme filtresi için indeks
create index if not exists idx_isemri_evrak_hazir
  on public.is_emirleri (sofor_user_id, evrak_hazir_at)
  where durum = 'Bekliyor';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RPC: Operasyon "Hazır işaretle"
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_emri_evrak_hazir_isaretle(p_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma_id uuid;
  v_existing timestamptz;
  v_now      timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;

  select firma_id, evrak_hazir_at into v_firma_id, v_existing
    from public.is_emirleri where id = p_id;
  if v_firma_id is null then
    raise exception 'İş emri bulunamadı' using errcode = '02000';
  end if;
  if v_firma_id not in (select public._user_firma_yetkili_ids()) then
    raise exception 'Yetkisiz: bu firmada evrak işaretleme yetkiniz yok'
      using errcode = '42501';
  end if;

  -- Zaten hazır ise tekrar set etme (push trigger gereksiz yere tetiklenmesin)
  if v_existing is not null then
    return v_existing;
  end if;

  update public.is_emirleri
     set evrak_hazir_at = v_now
   where id = p_id;

  return v_now;
end $$;

grant execute on function public.is_emri_evrak_hazir_isaretle(bigint) to authenticated;

comment on function public.is_emri_evrak_hazir_isaretle(bigint) is
  'Operasyon evrakları hazır işaretler. Sadece sahip/yonetici/operasyoncu/muhasebeci.
   Zaten hazırsa no-op (idempotent). evrak_hazir_at timestamp döner.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPC: Operasyon "Hazır geri al"
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_emri_evrak_hazir_geri_al(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma_id uuid;
  v_durum    text;
begin
  if auth.uid() is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;

  select firma_id, durum into v_firma_id, v_durum
    from public.is_emirleri where id = p_id;
  if v_firma_id is null then
    raise exception 'İş emri bulunamadı' using errcode = '02000';
  end if;
  if v_firma_id not in (select public._user_firma_yetkili_ids()) then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  -- Şoför yola çıktıysa geri alınamaz
  if v_durum is distinct from 'Bekliyor' then
    raise exception 'İş zaten "%" durumunda — hazır geri alınamaz', v_durum
      using errcode = '22023';
  end if;

  update public.is_emirleri
     set evrak_hazir_at = null
   where id = p_id;
end $$;

grant execute on function public.is_emri_evrak_hazir_geri_al(bigint) to authenticated;

comment on function public.is_emri_evrak_hazir_geri_al(bigint) is
  'Operasyon yanlış hazır işaretlediyse geri al. Sadece durum=Bekliyor iken çalışır.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) TRIGGER: Bekliyor→Yolda geçişinde evrak_hazir_at NULL ise reddet
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_isemri_evrak_hazir_kontrol()
returns trigger
language plpgsql
as $$
begin
  -- Sadece Bekliyor → Yolda geçişinde kontrol et
  if new.durum = 'Yolda'
     and old.durum is distinct from new.durum
     and (old.durum = 'Bekliyor' or old.durum is null)
     and old.evrak_hazir_at is null
  then
    raise exception 'Evraklar henüz hazır değil — operasyon hazır işaretlemeli'
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_isemri_evrak_hazir_kontrol on public.is_emirleri;
create trigger trg_isemri_evrak_hazir_kontrol
  before update on public.is_emirleri
  for each row
  when (new.durum is distinct from old.durum)
  execute function public.trg_isemri_evrak_hazir_kontrol();

comment on function public.trg_isemri_evrak_hazir_kontrol() is
  'Bekliyor→Yolda geçişinde evrak_hazir_at NULL ise UPDATE''i reddeder. Mobil
   tarafta buton disable olsa bile DB tarafında garanti.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) TRIGGER: evrak_hazir_at NULL→dolu olunca şoföre yüksek öncelikli push
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_isemri_evrak_hazir_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.evrak_hazir_at is not null
     and old.evrak_hazir_at is null
     and new.sofor_user_id is not null
  then
    perform public.notify_create(
      new.firma_id,
      'is_emri_durum',
      '🚛 Yeni iş hazır',
      'Evraklar tamamlandı — yola çıkabilirsin: ' ||
        coalesce(new.teslim_yeri, 'İş #' || new.id),
      'is_emri',
      new.id::text,
      null,
      'Sistem',
      'yuksek'
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_isemri_evrak_hazir_push on public.is_emirleri;
create trigger trg_isemri_evrak_hazir_push
  after update of evrak_hazir_at on public.is_emirleri
  for each row execute function public.trg_isemri_evrak_hazir_push();

comment on function public.trg_isemri_evrak_hazir_push() is
  'evrak_hazir_at NULL→dolu geçişinde şoföre yüksek öncelikli FCM push.';

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Kolon eklendi mi:
--    select column_name, data_type from information_schema.columns
--     where table_schema='public' and table_name='is_emirleri'
--       and column_name='evrak_hazir_at';
--    Beklenen: 1 satır, timestamp with time zone.
--
-- 2) Backfill başarılı mı (hiç NULL kalmamalı):
--    select count(*) from public.is_emirleri where evrak_hazir_at is null;
--    Beklenen: 0 (mevcut tüm işler hazır).
--
-- 3) RPC'ler tanımlı:
--    select proname from pg_proc
--     where pronamespace='public'::regnamespace
--       and proname like 'is_emri_evrak_hazir%';
--    Beklenen: is_emri_evrak_hazir_geri_al, is_emri_evrak_hazir_isaretle.
--
-- 4) Trigger'lar tanımlı:
--    select tgname from pg_trigger
--     where tgrelid = 'public.is_emirleri'::regclass
--       and tgname like 'trg_isemri_evrak_hazir%';
--    Beklenen 2: trg_isemri_evrak_hazir_kontrol, trg_isemri_evrak_hazir_push.
--
-- 5) Yetki kontrolü (web operasyoncu hesabıyla):
--    select public.is_emri_evrak_hazir_isaretle(<test_iş_id>);
--    Beklenen: timestamp döner. Tekrar çağrılırsa aynı timestamp (idempotent).
--
-- 6) Hazır geri al:
--    select public.is_emri_evrak_hazir_geri_al(<test_iş_id>);
--    Beklenen: ok. Eğer iş Bekliyor değilse: 22023 hata.
--
-- 7) Yola çıkma kontrolü (şoför hesabıyla, evrak_hazir_at NULL bir iş için):
--    update public.is_emirleri set durum='Yolda' where id=<test_id>;
--    Beklenen: 22023 'Evraklar henüz hazır değil' hata.
-- =============================================================================
