-- 2026-05-09f — Deneme/abonelik bittikten sonra read-only mod (Faz 4)
--
-- Kullanıcı abonelik ödememişse veya deneme bitmiş ve abonelik=suresi_dolmus ise:
--   - Yeni iş emri açılamaz
--   - Yeni araç/sürücü/müşteri eklenemez
--   - MEVCUT veriler okunabilir, mobile takip çalışmaya devam eder
--
-- Mevcut subscription overlay frontend'de zaten gösteriliyor; bu trigger'lar DB
-- seviyesinde sızdırmazlık sağlar (kullanıcı fetch'i bypass etse bile DB engelliyor).
--
-- Korunan tablolar (INSERT bloklanır):
--   is_emirleri, araclar, suruculer, musteriler, surucu_davetleri,
--   yakit_girisleri, harcirah_kayitlari, masraflar
--
-- UPDATE/DELETE serbest kalır — son haftalarda hala düzeltme yapılabilsin.
-- SELECT zaten her zaman okunur.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: kullanıcının firmasının kullanım hakkı var mı?
-- ─────────────────────────────────────────────────────────────────────────────
-- 'aktif' (abonelik aktif + bitiş gelecekte) VEYA 'deneme' (deneme süresi devam)
-- → kullanım var. Diğer durumlar (suresi_dolmus, iptal, odeme_bekliyor) → yasak.
create or replace function public._firma_kullanim_aktif_mi(p_firma_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when f.abonelik_durumu = 'aktif'  and f.abonelik_bitis > now() then true
      when f.abonelik_durumu = 'deneme' and f.deneme_bitis  > now() then true
      else false
    end,
    false
  )
  from public.firmalar f where f.id = p_firma_id;
$$;

grant execute on function public._firma_kullanim_aktif_mi(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: BEFORE INSERT — abonelik kontrolü
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_abonelik_check_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma uuid;
begin
  -- firma_id satırdan oku — tüm korunan tablolar firma_id taşıyor
  v_firma := new.firma_id;
  if v_firma is null then
    return new;  -- firma_id yoksa zaten başka constraint engeller
  end if;

  if not public._firma_kullanim_aktif_mi(v_firma) then
    raise exception
      'Aboneliğiniz aktif değil. Yeni kayıt eklemek için abonelik panelinden plan seçin.'
      using errcode = '53400';   -- "configuration limit exceeded"
  end if;
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tetikleyicileri korunan tablolara bağla
-- ─────────────────────────────────────────────────────────────────────────────

-- is_emirleri
drop trigger if exists trg_abonelik_check_isemri on public.is_emirleri;
create trigger trg_abonelik_check_isemri
  before insert on public.is_emirleri
  for each row execute function public.trg_abonelik_check_insert();

-- araclar
drop trigger if exists trg_abonelik_check_araclar on public.araclar;
create trigger trg_abonelik_check_araclar
  before insert on public.araclar
  for each row execute function public.trg_abonelik_check_insert();

-- suruculer
drop trigger if exists trg_abonelik_check_suruculer on public.suruculer;
create trigger trg_abonelik_check_suruculer
  before insert on public.suruculer
  for each row execute function public.trg_abonelik_check_insert();

-- musteriler
drop trigger if exists trg_abonelik_check_musteriler on public.musteriler;
create trigger trg_abonelik_check_musteriler
  before insert on public.musteriler
  for each row execute function public.trg_abonelik_check_insert();

-- surucu_davetleri (yeni davet açılması)
drop trigger if exists trg_abonelik_check_surucu_davet on public.surucu_davetleri;
create trigger trg_abonelik_check_surucu_davet
  before insert on public.surucu_davetleri
  for each row execute function public.trg_abonelik_check_insert();

-- firma_kullanici_davetleri (ofis ekibi davet)
drop trigger if exists trg_abonelik_check_fk_davet on public.firma_kullanici_davetleri;
create trigger trg_abonelik_check_fk_davet
  before insert on public.firma_kullanici_davetleri
  for each row execute function public.trg_abonelik_check_insert();

-- yakit_girisleri — şoför fiş gönderebilsin DİYE BURASI HARİÇ
-- (saha operasyonu devam edebilir, ödeme sahibinin sorumluluğu)

-- harcirah_kayitlari trigger ile otomatik üretiliyor (iş emri açılırken).
-- iş emri zaten engellendiği için harcırah da otomatik engelli.

-- masraflar — varsa
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='masraflar') then
    execute 'drop trigger if exists trg_abonelik_check_masraflar on public.masraflar';
    execute 'create trigger trg_abonelik_check_masraflar
              before insert on public.masraflar
              for each row execute function public.trg_abonelik_check_insert()';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOĞRULAMA
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Aktif aboneliği olan firmada test:
--    insert into is_emirleri (firma_id, ...) values ('<aktif-firma>', ...);
--    → BAŞARILI olmalı.
--
-- 2. Süresi dolmuş firmada test:
--    update firmalar set abonelik_durumu='suresi_dolmus', abonelik_bitis=now()-interval '1 day',
--           deneme_bitis=now()-interval '1 day'
--     where id='<test-firma>';
--    insert into is_emirleri (firma_id, ...) values ('<test-firma>', ...);
--    → ENGELLENMELİ: "Aboneliğiniz aktif değil..."
--
-- 3. Geri aboneliği aktif et:
--    update firmalar set abonelik_durumu='deneme', deneme_bitis=now()+interval '7 day' where id='<test-firma>';
--    INSERT yine başarılı olmalı.
