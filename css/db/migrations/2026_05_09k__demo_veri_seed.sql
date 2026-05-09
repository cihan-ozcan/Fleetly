-- =============================================================================
-- 2026_05_09k__demo_veri_seed.sql
-- Faz 7 — "Tek tıkla örnek veri yükle" (Pazara çıkış / onboarding deneyimi)
--
-- AMAÇ:
--   Yeni firma sahibi sisteme giriş yaptıktan sonra "Bu sistemi gerçek veride
--   nasıl deneyebilirim?" düşüncesinde olur. Bu RPC tek bir tıkla:
--     - 5 araç (çekici/dorse karışık, gerçekçi plakalar)
--     - 3 sürücü (davet beklemiyor — DEMO durumda)
--     - 10 müşteri (TR sektörlerinden)
--     - 30 iş emri (28 tamamlanmış + 2 yolda; son 60 günde dağılır)
--   ekler ki kullanıcı dashboard'da gerçek veri görür, listeleri/raporları
--   gerçek hisle deneyebilir.
--
-- IDEMPOTENT:
--   - firmalar.demo_yuklendi boolean ile track edilir.
--   - İkinci çağrıda exception fırlatır.
--
-- TEMİZLEME:
--   firma_demo_veri_temizle() — yalnızca demo_user/demo_arac flag'li satırları
--   siler. Gerçek veriler bozulmaz.
-- =============================================================================

-- 1) firmalar tablosuna demo_yuklendi flag'i ----------------------------------
alter table public.firmalar
  add column if not exists demo_yuklendi boolean not null default false;

-- Demo verisini etiketlemek için tablolara `demo_mi` boolean ekle (idempotent).
-- Mevcut araclar/suruculer/musteriler/is_emirleri'nde yokken default false.
alter table public.araclar
  add column if not exists demo_mi boolean not null default false;
alter table public.suruculer
  add column if not exists demo_mi boolean not null default false;
alter table public.musteriler
  add column if not exists demo_mi boolean not null default false;
alter table public.is_emirleri
  add column if not exists demo_mi boolean not null default false;


-- 2) RPC: firma_demo_veri_yukle ----------------------------------------------
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

  -- Önceden hazırlanmış demo veri arrayleri
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

  -- 30 iş emri — yukle/teslim çiftleri
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
  v_rota     jsonb;
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
    raise exception 'Yetkisiz: oturum bulunamadı' using errcode = '28000';
  end if;

  -- Sahip rolü gerekli (firma sahibi onayıyla yükleme)
  select fk.firma_id, fk.rol into v_firma, v_rol
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  order by case fk.rol when 'sahip' then 1 when 'yonetici' then 2 else 99 end
  limit 1;

  if v_firma is null then
    raise exception 'Yetkisiz: firma bulunamadı';
  end if;
  if v_rol <> 'sahip' then
    raise exception 'Yalnızca firma sahibi demo veri yükleyebilir (mevcut rol: %)', v_rol;
  end if;

  -- Idempotency
  select demo_yuklendi into v_demo_yuklendi from public.firmalar where id = v_firma;
  if v_demo_yuklendi then
    raise exception 'Bu firmaya demo veri zaten yüklenmiş. Önce "Demo Veriyi Temizle" butonuyla silin.'
      using errcode = '23505';
  end if;

  -- ── Araçlar ────────────────────────────────────────────────────────────
  for v_arac in select * from jsonb_array_elements(v_arac_data) loop
    v_arac_id := 'demo_' || lower(replace(v_arac->>'plaka', ' ', ''));
    insert into public.araclar (
      id, plaka, tip, marka, model, yil, durum, firma_id, user_id, demo_mi, notlar
    ) values (
      v_arac_id,
      v_arac->>'plaka',
      v_arac->>'tip',
      v_arac->>'marka',
      v_arac->>'model',
      (v_arac->>'yil')::int,
      'Aktif',
      v_firma,
      v_uid,
      true,
      'Demo veri — Faz 7 onboarding'
    )
    on conflict (id) do nothing;
    v_sayac_a := v_sayac_a + 1;
    v_arac_ids := array_append(v_arac_ids, v_arac_id);
  end loop;

  -- ── Sürücüler ──────────────────────────────────────────────────────────
  for v_surucu in select * from jsonb_array_elements(v_surucu_data) loop
    insert into public.suruculer (
      firma_id, ad, soyad, telefon_e164, durum, demo_mi, created_by
    ) values (
      v_firma,
      v_surucu->>'ad',
      v_surucu->>'soyad',
      v_surucu->>'telefon_e164',
      'davet_bekliyor',  -- demo sürücüler aktif değil; sahibi gerçek davet etmeden önce mockup
      true,
      v_uid
    )
    returning id into v_surucu_id;
    v_sayac_s := v_sayac_s + 1;
    v_surucu_ids := array_append(v_surucu_ids, v_surucu_id);
  end loop;

  -- ── Müşteriler ─────────────────────────────────────────────────────────
  for v_musteri in select * from jsonb_array_elements(v_musteri_data) loop
    insert into public.musteriler (
      firma_id, user_id, firma, yetkili, sektor, tel, vkn, durum, demo_mi
    ) values (
      v_firma, v_uid,
      v_musteri->>'firma',
      v_musteri->>'yetkili',
      v_musteri->>'sektor',
      v_musteri->>'tel',
      v_musteri->>'vkn',
      'Aktif',
      true
    )
    returning id into v_musteri_id;
    v_sayac_m := v_sayac_m + 1;
    v_musteri_ids := array_append(v_musteri_ids, v_musteri_id);
  end loop;

  -- ── İş emirleri (30 adet — son 60 gün dağıtık) ─────────────────────────
  for i in 1..30 loop
    -- Round-robin araç + sürücü + müşteri seçimi
    v_arac_id    := v_arac_ids[((i - 1) % array_length(v_arac_ids, 1)) + 1];
    v_surucu_id  := v_surucu_ids[((i - 1) % array_length(v_surucu_ids, 1)) + 1];
    v_musteri_id := v_musteri_ids[((i - 1) % array_length(v_musteri_ids, 1)) + 1];

    select plaka, tip into v_sec_arac
      from public.araclar where id = v_arac_id;
    select ad, soyad, telefon_e164 into v_sec_surucu
      from public.suruculer where id = v_surucu_id;
    select firma into v_sec_musteri
      from public.musteriler where id = v_musteri_id;

    v_sec_rota := v_rota_data->((i - 1) % jsonb_array_length(v_rota_data));

    -- Durum dağılımı: ilk 28 tamamlanmış, son 2 yolda
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
      v_sec_rota->>'yukle',
      v_sec_rota->>'teslim',
      v_durum, v_atama_zamani, v_teslim_zamani,
      true, 'Demo iş emri'
    );
    v_sayac_io := v_sayac_io + 1;
  end loop;

  -- ── Flag'i set et ──────────────────────────────────────────────────────
  update public.firmalar set demo_yuklendi = true where id = v_firma;

  return query select
    v_sayac_a, v_sayac_s, v_sayac_m, v_sayac_io,
    'Demo veriniz hazır: ' || v_sayac_a || ' araç + ' || v_sayac_s || ' sürücü + ' ||
    v_sayac_m || ' müşteri + ' || v_sayac_io || ' iş emri eklendi.';
end;
$fn$;

grant execute on function public.firma_demo_veri_yukle() to authenticated;
comment on function public.firma_demo_veri_yukle() is
  'Faz 7 — Yeni firma için tek tıkla 5 araç + 3 sürücü + 10 müşteri + 30 iş emri demo verisi.';


-- 3) RPC: firma_demo_veri_temizle --------------------------------------------
create or replace function public.firma_demo_veri_temizle()
returns table (
  araclar_silindi    int,
  suruculer_silindi  int,
  musteriler_silindi int,
  is_emirleri_silindi int,
  ozet_mesaj         text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_firma   uuid;
  v_rol     text;
  v_sa      int;
  v_ss      int;
  v_sm      int;
  v_sio     int;
begin
  if v_uid is null then
    raise exception 'Yetkisiz: oturum bulunamadı' using errcode = '28000';
  end if;

  select fk.firma_id, fk.rol into v_firma, v_rol
  from public.firma_kullanicilar fk
  where fk.user_id = v_uid
  order by case fk.rol when 'sahip' then 1 when 'yonetici' then 2 else 99 end
  limit 1;

  if v_firma is null then
    raise exception 'Yetkisiz: firma bulunamadı';
  end if;
  if v_rol <> 'sahip' then
    raise exception 'Yalnızca firma sahibi demo veriyi temizleyebilir';
  end if;

  -- İş emirlerini önce sil (FK)
  with d as (
    delete from public.is_emirleri
    where firma_id = v_firma and demo_mi = true
    returning 1
  )
  select count(*)::int into v_sio from d;

  -- Müşteriler
  with d as (
    delete from public.musteriler
    where firma_id = v_firma and demo_mi = true
    returning 1
  )
  select count(*)::int into v_sm from d;

  -- Araçlar (birincil_surucu_id'yi temizle ki FK patlamasın)
  update public.araclar set birincil_surucu_id = null
  where firma_id = v_firma and demo_mi = true;

  with d as (
    delete from public.araclar
    where firma_id = v_firma and demo_mi = true
    returning 1
  )
  select count(*)::int into v_sa from d;

  -- Sürücüler
  with d as (
    delete from public.suruculer
    where firma_id = v_firma and demo_mi = true
    returning 1
  )
  select count(*)::int into v_ss from d;

  -- Flag reset
  update public.firmalar set demo_yuklendi = false where id = v_firma;

  return query select
    v_sa, v_ss, v_sm, v_sio,
    'Demo veri temizlendi: ' || v_sa || ' araç + ' || v_ss || ' sürücü + ' ||
    v_sm || ' müşteri + ' || v_sio || ' iş emri silindi.';
end;
$fn$;

grant execute on function public.firma_demo_veri_temizle() to authenticated;
comment on function public.firma_demo_veri_temizle() is
  'Faz 7 — Demo veriyi siler (yalnızca demo_mi=true satırlar).';


-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Yükle:
--    select * from public.firma_demo_veri_yukle();
--
-- 2) İkinci yükleme denemesi (hata fırlatmalı):
--    select * from public.firma_demo_veri_yukle();
--
-- 3) Veriyi gör:
--    select count(*) from araclar where demo_mi;
--    select count(*) from is_emirleri where demo_mi;
--
-- 4) Temizle:
--    select * from public.firma_demo_veri_temizle();
-- =============================================================================
