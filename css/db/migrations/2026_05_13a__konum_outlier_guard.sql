-- =============================================================================
-- FLEETLY  —  2026-05-13a  —  Konum İzleri Outlier Guard
-- =============================================================================
-- AÇIK:
--   Şoför "90 km/h ile giderken uygulamada 280 km/h yazıyordu" şikayeti.
--   Saha incelemesinde:
--     - sofor_konum_gonder RPC hız değerini filtre etmeden direkt yazıyordu
--       (negatif kontrolü hariç).
--     - Mobile Android Location.getSpeed() GPS Doppler hatalarında 50+ m/s
--       saçma değer üretebiliyor (eski cihaz / multipath / hücre kulesi atması).
--     - filo_trafik_grid trigger zaten >200 km/h'yi grid'e yazmıyordu AMA
--       konum_izleri tablosuna outlier KAYIT EDİLİYORDU → yanlış raporlama.
--     - Yüksek accuracy değerli (dogruluk > 100m) sample'lar harita izini
--       yan sokaklara sıçratıyordu (multipath jitter).
--
-- ÇÖZÜM:
--   2 katman defansif filtreleme:
--
--   1) sofor_konum_gonder RPC güncellenir:
--      - p_dogruluk > 100m → REJECT (errcode 22023)
--        (mobile zaten 50m üstünü atıyor; server tarafı 100m yedek savunma)
--      - p_hiz > 50 m/s (180 km/h) → v_hiz = NULL (konum kabul, hız NULL'a çekilir)
--      - p_hiz < 0 → 0 (mevcut davranış korunur)
--
--   2) Yeni BEFORE INSERT trigger: trg_konum_izleri_outlier_guard
--      - Doğrudan INSERT (anon link, eski client'lar) için yedek katman.
--      - RPC kullanılmadan giren sample'ı da temizler.
--
--   Mevcut bozuk veri SİLİNMEZ — sadece DOĞRULAMA bölümünde sayım sorgusu var.
--   Kullanıcı isterse manuel temizleme yapılabilir.
--
-- BAĞIMLILIK:
--   2026_04_29__konum_izleri_guzergah.sql  (konum_izleri tablo)
--   2026_05_06d__konum_hiz_canli.sql       (mevcut sofor_konum_gonder canonical)
--
-- GERİ ALMA:
--   drop trigger if exists trg_konum_izleri_outlier_guard on public.konum_izleri;
--   drop function if exists public.trg_konum_izleri_outlier_guard();
--   -- sofor_konum_gonder eski sürümüne dönmek için 2026_05_06d yeniden çalıştır.
--
-- TANI EŞİKLERİ (kalibre edilmiş):
--   ACCURACY_MAX = 100m   — mobile 50m üstünü atar, server 100m gevşek yedek
--   SPEED_MAX_MS = 50 m/s — 180 km/h, TIR için fiziksel olarak ulaşılamaz
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) RPC güncelleme: sofor_konum_gonder — outlier reject + hız clamp
-- ─────────────────────────────────────────────────────────────────────────────
-- İmza 2026_05_06d ile birebir aynı (overload yaratmamak için). REPLACE edilir.
create or replace function public.sofor_konum_gonder(
  p_lat       double precision,
  p_lng       double precision,
  p_dogruluk  double precision default null,
  p_hiz       numeric          default null,   -- m/s — Android Location.speed
  p_batarya   integer          default null,
  p_is_emri   bigint           default null,
  p_tip       text             default 'auto'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_ize_id bigint;
  v_kmh    numeric;
  v_hiz    numeric;
begin
  if v_uid is null then
    raise exception 'Authenticated user required';
  end if;

  -- 2026_05_13: Accuracy outlier reject — 100m+ doğruluklu fix = parazit.
  -- (Mobile zaten 50m üstünü kesiyor; bu yedek savunma direkt INSERT'lere karşı.)
  if p_dogruluk is not null and p_dogruluk > 100 then
    raise exception 'Konum doğruluğu çok düşük (% m) — sample reddedildi', p_dogruluk
      using errcode = '22023';
  end if;

  -- 2026_05_13: Hız outlier — 50 m/s (180 km/h) üstü TIR için fiziksel olarak
  -- ulaşılamaz. Konum sample'ı korunur ama hız NULL'a çekilir (yanlış değer
  -- yerine "bilinmiyor" daha doğru).
  v_hiz := case
    when p_hiz is null then null
    when p_hiz < 0    then 0
    when p_hiz > 50   then null   -- outlier: hızı temizle
    else p_hiz
  end;

  insert into public.konum_izleri
    (is_emri_id, lat, lng, hiz, dogruluk, tip, batarya, user_id, ts)
  values
    (p_is_emri, p_lat, p_lng, v_hiz, p_dogruluk,
     coalesce(p_tip, 'auto'), p_batarya, v_uid, now())
  returning id into v_ize_id;

  -- m/s → km/sa (sadece geçerli aralık)
  v_kmh := case
    when v_hiz is null then null
    else round((v_hiz * 3.6)::numeric, 1)
  end;

  if p_is_emri is not null then
    update public.is_emirleri
       set konum_lat   = p_lat,
           konum_lng   = p_lng,
           konum_zaman = now(),
           konum_hiz   = v_kmh
     where id = p_is_emri
       and (sofor_user_id = v_uid or user_id = v_uid or firma_id in (
             select firma_id from public.firma_kullanicilar where user_id = v_uid
           ));
  end if;

  return v_ize_id;
end $$;

grant execute on function public.sofor_konum_gonder(
  double precision, double precision, double precision, numeric,
  integer, bigint, text
) to authenticated;

comment on function public.sofor_konum_gonder(double precision, double precision, double precision, numeric, integer, bigint, text) is
  'Şoför konum sample kaydı. 2026_05_13: accuracy>100m reddedilir, hız>50 m/s (180 km/h) NULL''a çekilir.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) BEFORE INSERT trigger: doğrudan INSERT'leri de filtrele (yedek savunma)
-- ─────────────────────────────────────────────────────────────────────────────
-- RPC kullanmayan kod yolları (anon link davet, eski client, manuel INSERT)
-- için aynı eşikleri uygula. RPC'de zaten temizlenmiş veri için no-op.
create or replace function public.trg_konum_izleri_outlier_guard()
returns trigger
language plpgsql
as $$
begin
  -- Accuracy 100m üstü → REJECT (sample tamamen iptal)
  if new.dogruluk is not null and new.dogruluk > 100 then
    raise exception 'Konum doğruluğu çok düşük (% m) — outlier guard', new.dogruluk
      using errcode = '22023';
  end if;

  -- Hız outlier — 50 m/s (180 km/h) üstü = sensor hatası → NULL
  if new.hiz is not null and new.hiz > 50 then
    new.hiz := null;
  end if;

  -- Negatif hız → 0 (defansif; RPC'de zaten clamp'liyor)
  if new.hiz is not null and new.hiz < 0 then
    new.hiz := 0;
  end if;

  return new;
end $$;

drop trigger if exists trg_konum_izleri_outlier_guard on public.konum_izleri;
create trigger trg_konum_izleri_outlier_guard
  before insert on public.konum_izleri
  for each row execute function public.trg_konum_izleri_outlier_guard();

comment on function public.trg_konum_izleri_outlier_guard() is
  'konum_izleri tablo BEFORE INSERT outlier savunması. Accuracy>100m reddedilir, hız>50 m/s NULL''a çekilir, negatif hız 0.';

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) RPC güncellenmiş mi:
--    select pg_get_functiondef(p.oid)
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'sofor_konum_gonder';
--    Beklenen: gövdede 'p_dogruluk > 100' ve 'p_hiz > 50' geçer.
--
-- 2) Trigger oluştu mu:
--    select tgname from pg_trigger
--     where tgrelid = 'public.konum_izleri'::regclass
--       and tgname = 'trg_konum_izleri_outlier_guard';
--    Beklenen: 1 satır.
--
-- 3) Mevcut bozuk veri sayımı (raporlama amaçlı — silmiyoruz):
--    select count(*) as bozuk_hiz_kayit_sayisi,
--           max(hiz)  as max_hiz_ms,
--           round(max(hiz) * 3.6, 1) as max_hiz_kmh
--      from public.konum_izleri
--     where hiz > 50;
--    Beklenen: birkaç düzine kayıt (saha şikayeti = 280 km/h). Eğer yüksek
--    sayıdaysa manuel temizleme önerilir:
--      update public.konum_izleri set hiz = null where hiz > 50;
--      (geri alınamaz — önce yedek alın)
--
-- 4) Düşük doğruluk kayıt sayımı:
--    select count(*) as dusuk_dogruluk_kayit_sayisi,
--           max(dogruluk) as max_dogruluk_m
--      from public.konum_izleri
--     where dogruluk > 100;
--    Beklenen: nadir (tünel/multipath durumları). Çok yüksekse mobile tarafında
--    izin/MIUI sorunu olabilir.
--
-- 5) RPC outlier reject testi (180 km/h üstü):
--    select public.sofor_konum_gonder(40.0, 29.0, 5.0, 100, 80, null, 'test');
--    Beklenen: insert eder ama konum_izleri.hiz = null.
--
-- 6) RPC accuracy reject testi:
--    select public.sofor_konum_gonder(40.0, 29.0, 250, 20, 80, null, 'test');
--    Beklenen: 22023 'Konum doğruluğu çok düşük (250 m)' hata.
--
-- 7) Normal sample (20 m/s = 72 km/h, accuracy 8m):
--    select public.sofor_konum_gonder(40.0, 29.0, 8, 20, 80, null, 'test');
--    Beklenen: id döner, kayıt eklenir, hiz=20, konum_izleri normal.
-- =============================================================================
