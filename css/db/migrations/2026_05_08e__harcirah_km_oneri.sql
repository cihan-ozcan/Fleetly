-- 2026-05-08e — Yakın tarifelerden uzak il TL/km önerisi
--
-- KULLANIM
-- --------
-- Web UI "Uzak İller" sekmesinde kullanıcı yeni bölge tarifesi eklerken
-- "Önerilen TL/km" göstermek için. Mantık:
--
-- 1. Firmanın YAKIN tarifelerinden ortalama TL/km hesapla
--    (örn. Çorlu 600 TL → ~140 km → 4.28 TL/km)
-- 2. Uzak bölge için bu ortalamayı bölge mesafe katsayısıyla çarp:
--      Marmara dışı Anadolu: ~%30 ek
--      Karadeniz / Doğu     : ~%50 ek
-- 3. Sonuç önerilen TL/km — kullanıcı kabul eder veya değiştirir.
--
-- NOTE: Bu fonksiyon "öneri" üretir, otomatik kayıt yapmaz. Web UI öneriyi
-- gösterir, kullanıcı "Bu önerile" tıklarsa harcirah_bolge_tarife'a yazar.

create or replace function public.harcirah_km_birim_oneri(
  p_firma_id uuid,
  p_bolge    text default null    -- null verilirse tüm bölgelerin önerisi döner
)
returns table (
  bolge          text,
  bolge_ad       text,
  onerilen_tl_km numeric,
  yakin_ortalama numeric,
  carpan         numeric,
  hesap_notu     text
)
language plpgsql
stable
as $$
declare
  v_yakin_avg numeric := null;
  v_yakin_n   integer := 0;
begin
  -- Firmanın yakın bölge tarifelerinden ortalama TL/km hesabı
  -- (km verisi yok — yaklaşık 100-200 km menzil varsayımı: tutar / 130 km)
  -- Daha sağlıklı: harcirah_tarifeleri.tahmini_km kolonu varsa onu kullan
  select
    avg(case
      when tahmini_km is not null and tahmini_km > 0 then tutar / tahmini_km
      else tutar / 130.0   -- yakın varsayımı: ortalama 130 km
    end),
    count(*)
  into v_yakin_avg, v_yakin_n
  from public.harcirah_tarifeleri
  where firma_id = p_firma_id and aktif_mi = true and tutar > 0;

  -- Hiç yakın tarife yoksa: piyasa ortalaması 5 TL/km varsayımı
  if v_yakin_avg is null or v_yakin_n = 0 then
    v_yakin_avg := 5.0;
  end if;

  -- Bölge çarpanları (Türkiye coğrafyasına göre kalibrasyon)
  return query
    with bolge_carpan as (
      select * from (values
        ('marmara',       'Marmara',         1.10::numeric),
        ('ege',           'Ege',             1.40::numeric),
        ('akdeniz',       'Akdeniz',         1.30::numeric),
        ('ic_anadolu',    'İç Anadolu',      1.25::numeric),
        ('karadeniz',     'Karadeniz',       1.55::numeric),
        ('dogu_anadolu',  'Doğu Anadolu',    1.75::numeric),
        ('guneydogu',     'Güneydoğu',       1.65::numeric)
      ) as t(bolge, bolge_ad, carpan)
    )
    select
      bc.bolge,
      bc.bolge_ad,
      round(v_yakin_avg * bc.carpan, 1) as onerilen_tl_km,
      round(v_yakin_avg, 2) as yakin_ortalama,
      bc.carpan,
      case
        when v_yakin_n > 0 then
          'Yakın bölge ortalama ' || round(v_yakin_avg, 2)::text || ' TL/km × ' ||
          bc.carpan::text || ' = ' || round(v_yakin_avg * bc.carpan, 1)::text || ' TL/km'
        else
          'Yakın tarife tanımlı değil — piyasa ortalaması varsayımıyla'
      end as hesap_notu
    from bolge_carpan bc
    where p_bolge is null or bc.bolge = p_bolge
    order by case bc.bolge
      when 'marmara'      then 1
      when 'ege'          then 2
      when 'akdeniz'      then 3
      when 'ic_anadolu'   then 4
      when 'karadeniz'    then 5
      when 'dogu_anadolu' then 6
      when 'guneydogu'    then 7
    end;
end $$;

revoke all on function public.harcirah_km_birim_oneri(uuid,text) from public;
grant execute on function public.harcirah_km_birim_oneri(uuid,text) to authenticated;

comment on function public.harcirah_km_birim_oneri(uuid,text) is 'Firmanın yakın bölge tarifelerinden uzak il TL/km önerisi üretir. Web UI "Uzak İller" sekmesinde "Bu öneriyi kabul et" butonu için kullanılır.';
