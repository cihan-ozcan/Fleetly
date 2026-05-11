-- =============================================================================
-- FLEETLY  —  2026-05-11k  —  Şoför Güzergah Paylaşım Sistemi (RPC'ler)
-- =============================================================================
-- AÇIK:
--   2026_05_11j ile şema kuruldu (3 tablo, RLS sadece SELECT açık).
--   INSERT/UPDATE/DELETE direkt kapalı — RPC zorunlu.
--
-- ÇÖZÜM:
--   5 SECURITY DEFINER RPC. Her birinde auth.uid()'den suruculer.auth_user_id
--   üzerinden surucu_id + firma_id çözülür; bu sayede sürücü kendi RLS'inde
--   yazma yetkisi yoksa bile RPC içinden insert/update edebilir
--   (CLAUDE.md "Mobile sürücü self-write" pattern'i).
--
--     1) guzergah_olustur          — şoför paylaşım yaratır (spam guard 60sn/3)
--     2) guzergah_hedef_oner       — hedefe yakın paylaşılmış güzergahları getir
--                                    (PostGIS ST_DWithin, firma içi sınırlı)
--     3) guzergah_kullanildi       — Google Maps'te açıldığında log + sayaç +1
--     4) guzergah_begen            — beğeni toggle, yeni durumu döner
--     5) guzergah_durum_degistir   — yönetici onay/red/sil (sahip/yonetici/operasyoncu)
--
-- BAĞIMLILIK:
--   2026_05_11j__guzergahlar_schema.sql           (tablo + RLS)
--   2026_05_07b__rls_emergency_fix.sql            (_user_firma_ids, _user_firma_yetkili_ids)
--   PostGIS (2026_05_06l)                         (ST_DWithin, geography cast)
--
-- GERİ ALMA:
--   drop function public.guzergah_olustur(uuid, text, double precision, double precision,
--     text, double precision, double precision, text, numeric, integer, text, text);
--   drop function public.guzergah_hedef_oner(double precision, double precision, integer);
--   drop function public.guzergah_kullanildi(uuid, bigint);
--   drop function public.guzergah_begen(uuid);
--   drop function public.guzergah_durum_degistir(uuid, text, text);
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) guzergah_olustur — şoför paylaşım yaratır
-- ─────────────────────────────────────────────────────────────────────────────
-- Gizlilik sabit 'firma' (cross-firma 'platform' UI'da kapalı —
-- bkz. memory: project_guzergah_cross_firma_reddedildi).
create or replace function public.guzergah_olustur(
  p_hedef_liman_id     uuid,
  p_hedef_ad           text,
  p_baslangic_lat      double precision,
  p_baslangic_lng      double precision,
  p_baslangic_ad       text,
  p_bitis_lat          double precision,
  p_bitis_lng          double precision,
  p_polyline_encoded   text,
  p_mesafe_km          numeric,
  p_tahmini_sure_dk    integer,
  p_baslik             text,
  p_notlar             text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_surucu_id  uuid;
  v_firma_id   uuid;
  v_id         uuid;
begin
  if auth.uid() is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;

  -- Şoför bağlamı: auth.uid() → suruculer.auth_user_id
  select s.id, s.firma_id into v_surucu_id, v_firma_id
    from public.suruculer s
   where s.auth_user_id = auth.uid()
   limit 1;

  if v_surucu_id is null then
    raise exception 'Şoför kaydınız bulunamadı; paylaşım oluşturamazsınız.'
      using errcode = '42501';
  end if;

  -- Zorunlu alanlar
  if p_hedef_ad is null or length(trim(p_hedef_ad)) = 0 then
    raise exception 'Hedef adı boş olamaz' using errcode = '23502';
  end if;
  if p_baslik is null or length(trim(p_baslik)) = 0 then
    raise exception 'Başlık boş olamaz' using errcode = '23502';
  end if;
  if p_polyline_encoded is null or length(p_polyline_encoded) < 4 then
    raise exception 'Polyline boş veya geçersiz' using errcode = '22023';
  end if;
  if p_baslangic_lat is null or p_baslangic_lng is null
     or p_bitis_lat is null or p_bitis_lng is null then
    raise exception 'Koordinatlar zorunlu' using errcode = '23502';
  end if;

  -- Hedef liman referansı verildiyse: global (firma_id IS NULL) veya aynı firma olmalı.
  if p_hedef_liman_id is not null then
    perform 1 from public.limanlar l
      where l.id = p_hedef_liman_id
        and (l.firma_id is null or l.firma_id = v_firma_id);
    if not found then
      raise exception 'Hedef liman erişiminizde değil' using errcode = '42501';
    end if;
  end if;

  -- Spam guard: son 60sn 3 paylaşımdan fazla → engelle
  if (
    select count(*) from public.guzergahlar
     where olusturan_surucu_id = v_surucu_id
       and created_at >= now() - interval '60 seconds'
  ) >= 3 then
    raise exception 'Çok hızlı paylaşıyorsunuz. Lütfen biraz bekleyin.'
      using errcode = '54000';
  end if;

  insert into public.guzergahlar (
    firma_id, olusturan_surucu_id,
    hedef_liman_id, hedef_ad,
    baslangic_lat, baslangic_lng, baslangic_ad,
    bitis_lat, bitis_lng,
    polyline_encoded,
    baslik, notlar, mesafe_km, tahmini_sure_dk,
    durum, gizlilik
  ) values (
    v_firma_id, v_surucu_id,
    p_hedef_liman_id, p_hedef_ad,
    p_baslangic_lat, p_baslangic_lng, p_baslangic_ad,
    p_bitis_lat, p_bitis_lng,
    p_polyline_encoded,
    p_baslik, p_notlar, p_mesafe_km, p_tahmini_sure_dk,
    'aktif', 'firma'
  ) returning id into v_id;

  return v_id;
end $$;

grant execute on function public.guzergah_olustur(
  uuid, text, double precision, double precision, text,
  double precision, double precision, text, numeric, integer, text, text
) to authenticated;

comment on function public.guzergah_olustur(uuid, text, double precision, double precision, text, double precision, double precision, text, numeric, integer, text, text) is
  'Şoför yeni güzergah paylaşır. Spam guard 60sn/3. Firma içi sabit; gizlilik=firma sabit.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) guzergah_hedef_oner — hedef koordinatına yakın güzergahları öner
-- ─────────────────────────────────────────────────────────────────────────────
-- PostGIS ST_DWithin geography (metre) ile p_radius_m yarıçap içindeki aktif
-- güzergahları döner. Sıralama: kullanim_sayisi → begeni_sayisi → updated_at.
-- Firma içi (RLS de zaten aynı kısıtı uyguluyor; explicit yazıyoruz).
create or replace function public.guzergah_hedef_oner(
  p_bitis_lat    double precision,
  p_bitis_lng    double precision,
  p_radius_m     integer default 500
) returns table (
  id                  uuid,
  firma_id            uuid,
  olusturan_surucu_id uuid,
  olusturan_ad        text,
  hedef_liman_id      uuid,
  hedef_ad            text,
  baslangic_lat       double precision,
  baslangic_lng       double precision,
  baslangic_ad        text,
  bitis_lat           double precision,
  bitis_lng           double precision,
  polyline_encoded    text,
  baslik              text,
  notlar              text,
  mesafe_km           numeric,
  tahmini_sure_dk     integer,
  begeni_sayisi       integer,
  kullanim_sayisi     integer,
  mesafe_m            double precision,
  created_at          timestamptz,
  updated_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_target geometry := ST_SetSRID(ST_MakePoint(p_bitis_lng, p_bitis_lat), 4326);
  v_radius int := greatest(50, least(coalesce(p_radius_m, 500), 5000));
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  select
    g.id, g.firma_id, g.olusturan_surucu_id,
    coalesce(nullif(trim(coalesce(s.ad,'') || ' ' || coalesce(s.soyad,'')), ''), 'Şoför')
      as olusturan_ad,
    g.hedef_liman_id, g.hedef_ad,
    g.baslangic_lat, g.baslangic_lng, g.baslangic_ad,
    g.bitis_lat, g.bitis_lng,
    g.polyline_encoded,
    g.baslik, g.notlar, g.mesafe_km, g.tahmini_sure_dk,
    g.begeni_sayisi, g.kullanim_sayisi,
    ST_Distance(g.bitis_geo::geography, v_target::geography) as mesafe_m,
    g.created_at, g.updated_at
  from public.guzergahlar g
  left join public.suruculer s on s.id = g.olusturan_surucu_id
  where g.durum = 'aktif'
    and g.firma_id in (select public._user_firma_ids())
    and ST_DWithin(g.bitis_geo::geography, v_target::geography, v_radius)
  order by g.kullanim_sayisi desc, g.begeni_sayisi desc, g.updated_at desc
  limit 50;
end $$;

grant execute on function public.guzergah_hedef_oner(double precision, double precision, integer)
  to authenticated;

comment on function public.guzergah_hedef_oner(double precision, double precision, integer) is
  'Hedef koordinatına p_radius_m içindeki aktif güzergahlar (50-5000m clamp). Firma içi, sıralı.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) guzergah_kullanildi — kullanım kaydı + sayaç +1
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guzergah_kullanildi(
  p_guzergah_id  uuid,
  p_is_emri_id   bigint default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surucu_id  uuid;
  v_firma_id   uuid;
  v_g_firma    uuid;
  v_g_durum    text;
begin
  if auth.uid() is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;

  select s.id, s.firma_id into v_surucu_id, v_firma_id
    from public.suruculer s
   where s.auth_user_id = auth.uid()
   limit 1;

  if v_surucu_id is null then
    raise exception 'Şoför kaydı yok' using errcode = '42501';
  end if;

  select g.firma_id, g.durum into v_g_firma, v_g_durum
    from public.guzergahlar g
   where g.id = p_guzergah_id
   limit 1;

  if v_g_firma is null then
    raise exception 'Güzergah bulunamadı' using errcode = '02000';
  end if;
  if v_g_firma <> v_firma_id then
    raise exception 'Güzergah farklı firmaya ait' using errcode = '42501';
  end if;
  if v_g_durum <> 'aktif' then
    raise exception 'Güzergah aktif değil' using errcode = '22023';
  end if;

  insert into public.guzergah_kullanim_log
    (guzergah_id, surucu_id, firma_id, is_emri_id)
  values
    (p_guzergah_id, v_surucu_id, v_firma_id, p_is_emri_id);

  update public.guzergahlar
     set kullanim_sayisi = kullanim_sayisi + 1
   where id = p_guzergah_id;
end $$;

grant execute on function public.guzergah_kullanildi(uuid, bigint) to authenticated;

comment on function public.guzergah_kullanildi(uuid, bigint) is
  'Şoför güzergahı Google Maps''te açtığında log + sayaç +1.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) guzergah_begen — beğeni toggle
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guzergah_begen(p_guzergah_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surucu_id  uuid;
  v_firma_id   uuid;
  v_g_firma    uuid;
  v_existed    boolean;
begin
  if auth.uid() is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;

  select s.id, s.firma_id into v_surucu_id, v_firma_id
    from public.suruculer s
   where s.auth_user_id = auth.uid()
   limit 1;

  if v_surucu_id is null then
    raise exception 'Şoför kaydı yok' using errcode = '42501';
  end if;

  select g.firma_id into v_g_firma
    from public.guzergahlar g
   where g.id = p_guzergah_id and g.durum = 'aktif'
   limit 1;

  if v_g_firma is null then
    raise exception 'Güzergah bulunamadı veya aktif değil' using errcode = '02000';
  end if;
  if v_g_firma <> v_firma_id then
    raise exception 'Güzergah farklı firmaya ait' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.guzergah_begeniler
     where guzergah_id = p_guzergah_id and surucu_id = v_surucu_id
  ) into v_existed;

  if v_existed then
    delete from public.guzergah_begeniler
     where guzergah_id = p_guzergah_id and surucu_id = v_surucu_id;
    update public.guzergahlar
       set begeni_sayisi = greatest(begeni_sayisi - 1, 0)
     where id = p_guzergah_id;
    return false;
  else
    insert into public.guzergah_begeniler (guzergah_id, surucu_id)
      values (p_guzergah_id, v_surucu_id);
    update public.guzergahlar
       set begeni_sayisi = begeni_sayisi + 1
     where id = p_guzergah_id;
    return true;
  end if;
end $$;

grant execute on function public.guzergah_begen(uuid) to authenticated;

comment on function public.guzergah_begen(uuid) is
  'Beğeni toggle. true=beğenildi, false=geri alındı. Sayaç inc/dec.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) guzergah_durum_degistir — yönetici onay/red/sil
-- ─────────────────────────────────────────────────────────────────────────────
-- Yetki: _user_firma_yetkili_ids (sahip/yonetici/operasyoncu/muhasebeci).
-- Şoför kendi güzergahını silmek isterse ileride ayrı bir RPC eklenebilir;
-- şu an sadece yönetici durum değiştirebilir.
create or replace function public.guzergah_durum_degistir(
  p_id     uuid,
  p_durum  text,
  p_not    text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g_firma   uuid;
begin
  if auth.uid() is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;

  if p_durum not in ('aktif','reddedildi','silindi') then
    raise exception 'Geçersiz durum: %', p_durum using errcode = '22023';
  end if;

  select g.firma_id into v_g_firma
    from public.guzergahlar g
   where g.id = p_id
   limit 1;

  if v_g_firma is null then
    raise exception 'Güzergah bulunamadı' using errcode = '02000';
  end if;

  if v_g_firma not in (select public._user_firma_yetkili_ids()) then
    raise exception 'Yetkisiz: bu firmada güzergah yönetme yetkiniz yok'
      using errcode = '42501';
  end if;

  update public.guzergahlar
     set durum         = p_durum,
         yonetici_notu = coalesce(p_not, yonetici_notu)
   where id = p_id;
end $$;

grant execute on function public.guzergah_durum_degistir(uuid, text, text)
  to authenticated;

comment on function public.guzergah_durum_degistir(uuid, text, text) is
  'Yönetici onay/red/sil. Yetki: _user_firma_yetkili_ids (sahip/yonetici/operasyoncu/muhasebeci).';


notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) RPC'ler tanımlı mı:
--    SELECT proname FROM pg_proc
--     WHERE pronamespace='public'::regnamespace
--       AND proname LIKE 'guzergah%'
--     ORDER BY proname;
--    Beklenen: guzergah_begen, guzergah_durum_degistir, guzergah_hedef_oner,
--              guzergah_kullanildi, guzergah_olustur
--
-- 2) Şoför hesabıyla güzergah oluştur (gerçek auth.uid() ile, mobile'dan):
--    SELECT public.guzergah_olustur(
--      null, 'Aydın Fabrika',
--      41.0082, 28.9784, 'İstanbul/Beylikdüzü',
--      37.8500, 27.8500,
--      '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
--      645.0, 432,
--      'Aydın Fabrika · Otoyol üzeri',
--      'Köprülü kavşaktan değil, alt yoldan dön. Üst geçit 4m sınırı var.'
--    );
--    Beklenen: yeni uuid.
--
-- 3) Hedef öneri (Aydın yakın bir nokta, 1000m yarıçap):
--    SELECT id, baslik, mesafe_m
--      FROM public.guzergah_hedef_oner(37.8500, 27.8500, 1000);
--    Beklenen: yukarıdaki güzergah, mesafe_m ~ 0.
--
-- 4) Kullanım sayacı:
--    SELECT public.guzergah_kullanildi('<guzergah_uuid>', null);
--    SELECT kullanim_sayisi FROM public.guzergahlar WHERE id='<guzergah_uuid>';
--    Beklenen: 1
--
-- 5) Beğeni toggle:
--    SELECT public.guzergah_begen('<guzergah_uuid>');  -- true (beğenildi)
--    SELECT public.guzergah_begen('<guzergah_uuid>');  -- false (geri alındı)
--    SELECT begeni_sayisi FROM public.guzergahlar WHERE id='<guzergah_uuid>';
--    Beklenen: 0
--
-- 6) Yönetici durum değiştir (web yönetici hesabıyla):
--    SELECT public.guzergah_durum_degistir(
--      '<guzergah_uuid>', 'reddedildi', 'TIR için uygun değil — köprü düşük'
--    );
--    SELECT durum, yonetici_notu FROM public.guzergahlar WHERE id='<guzergah_uuid>';
--    Beklenen: reddedildi | TIR için uygun değil — köprü düşük
--
-- 7) Cross-firma yetki testi:
--    Firma B yöneticisi firma A güzergahını değiştirmeye çalışsın
--    → 42501 'Yetkisiz' hata bekleniyor.
--
-- 8) Spam guard:
--    Aynı şoför 60sn içinde 4. paylaşımı denesin
--    → 54000 'Çok hızlı paylaşıyorsunuz' bekleniyor.
-- =============================================================================
