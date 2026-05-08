-- 2026-05-08h — Harcırah hesabında is_emirleri.tahmini_km öncelikli
--
-- Önce 2026-05-08d'deki harcirah_uzak_hesapla fonksiyonunu drop edip yeniden
-- yaratıyoruz: yeni parametre p_tahmini_km (default null). Verilmezse
-- haversine fallback'e düşer (eski davranış).
--
-- Sonra trg_isemri_harcirah_olustur trigger fonksiyonunu güncelliyoruz: iş emri
-- açılırken frontend OSRM ile gerçek karayolu km'yi tahmini_km kolonuna yazıyor;
-- biz bu değeri öncelikli olarak harcirah_uzak_hesapla'ya iletiyoruz.

-- Eski imzayı drop et (parametre listesi değişiyor, replace yetmez)
drop function if exists public.harcirah_uzak_hesapla(uuid, text, text, double precision, double precision, double precision, double precision, text);

create or replace function public.harcirah_uzak_hesapla(
  p_firma_id    uuid,
  p_yukle_yeri  text,
  p_teslim_yeri text,
  p_yukle_lat   double precision default null,
  p_yukle_lng   double precision default null,
  p_teslim_lat  double precision default null,
  p_teslim_lng  double precision default null,
  p_kont_durum  text             default null,
  p_tahmini_km  numeric          default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_il          text;
  v_bolge       text;
  v_km          numeric;
  v_km_kaynak   text;        -- 'osrm' | 'haversine'
  v_km_birim    numeric;
  v_kaynak      text;        -- 'il' | 'bolge'
  v_sabit       numeric;
  v_kural       record;
  v_brut        numeric := 0;
  v_kademe_ek   numeric := 0;
  v_konaklama   numeric := 0;
  v_toplam      numeric := 0;
  v_kalemler    jsonb := '[]'::jsonb;
  v_not         text := '';
begin
  -- Kural seti yükle (yoksa varsayılanlar)
  select * into v_kural from public.harcirah_kural_seti where firma_id = p_firma_id;
  if v_kural.firma_id is null then
    v_kural.dolu_donus_yuzde     := 50;
    v_kural.bos_donus_yuzde      := 0;
    v_kural.minimum_tutar        := 600;
    v_kural.kademe_500plus_yuzde := 0;
    v_kural.kademe_900plus_yuzde := 0;
    v_kural.konaklama_aktif      := false;
    v_kural.konaklama_min_km     := 900;
    v_kural.konaklama_tutar      := 0;
  end if;

  -- 1) Hedef il tespit
  v_il := public._tr_il_tespit(p_teslim_yeri);
  if v_il is null then
    return jsonb_build_object(
      'basari', false,
      'sebep', 'Hedef il tespit edilemedi: ' || coalesce(p_teslim_yeri, 'boş'),
      'tutar', 0
    );
  end if;
  select bolge into v_bolge from public.tr_il_bolge where il = v_il;

  -- 2) Mesafe — frontend OSRM tahmini varsa onu kullan, yoksa haversine
  if p_tahmini_km is not null and p_tahmini_km > 0 then
    v_km        := round(p_tahmini_km, 1);
    v_km_kaynak := 'osrm';
  else
    v_km        := public._haversine_km(p_yukle_lat, p_yukle_lng, p_teslim_lat, p_teslim_lng);
    v_km_kaynak := 'haversine';
  end if;

  if v_km is null or v_km <= 0 then
    return jsonb_build_object(
      'basari', false,
      'sebep', 'Mesafe hesaplanamadı (yükleme/teslim koordinatları eksik)',
      'tutar', 0,
      'il', v_il, 'bolge', v_bolge
    );
  end if;

  -- 3) Tarife bul: önce il, sonra bölge
  select km_birim, sabit_tutar into v_km_birim, v_sabit
    from public.harcirah_il_tarife
   where firma_id = p_firma_id and il = v_il and aktif_mi = true
   limit 1;

  if v_km_birim is not null or v_sabit is not null then
    v_kaynak := 'il';
  else
    select km_birim into v_km_birim
      from public.harcirah_bolge_tarife
     where firma_id = p_firma_id and bolge = v_bolge and aktif_mi = true
     limit 1;
    if v_km_birim is not null then
      v_kaynak := 'bolge';
    else
      return jsonb_build_object(
        'basari', false,
        'sebep', 'Bu firma için ' || v_il || ' (' || v_bolge || ') tarifesi tanımlı değil. ' ||
                 'Harcırah modülü → Uzak İller sekmesinden ekleyin.',
        'tutar', 0,
        'il', v_il, 'bolge', v_bolge, 'mesafe_km', v_km, 'mesafe_kaynak', v_km_kaynak
      );
    end if;
  end if;

  -- 4) Brüt hesaplama
  if v_sabit is not null then
    v_brut := v_sabit;
    v_kalemler := v_kalemler || jsonb_build_object(
      'tip', 'sabit_il',
      'aciklama', v_il || ' sabit tarife',
      'tutar', v_sabit
    );
  else
    v_brut := v_km * v_km_birim;
    v_kalemler := v_kalemler || jsonb_build_object(
      'tip', 'km_carpim',
      'aciklama', v_km::text || ' km × ' || v_km_birim::text || ' TL/km' ||
                  ' (' || v_kaynak || ': ' || coalesce(v_il, v_bolge) ||
                  ', mesafe: ' || v_km_kaynak || ')',
      'tutar', round(v_brut, 2)
    );
  end if;

  -- 5) Mesafe kademeleri
  if v_km > 900 and v_kural.kademe_900plus_yuzde > 0 then
    v_kademe_ek := round(v_brut * v_kural.kademe_900plus_yuzde / 100.0, 2);
    v_kalemler := v_kalemler || jsonb_build_object(
      'tip', 'kademe', 'aciklama', '900 km üstü kademe (+%' || v_kural.kademe_900plus_yuzde || ')',
      'tutar', v_kademe_ek
    );
  elsif v_km > 500 and v_kural.kademe_500plus_yuzde > 0 then
    v_kademe_ek := round(v_brut * v_kural.kademe_500plus_yuzde / 100.0, 2);
    v_kalemler := v_kalemler || jsonb_build_object(
      'tip', 'kademe', 'aciklama', '500 km üstü kademe (+%' || v_kural.kademe_500plus_yuzde || ')',
      'tutar', v_kademe_ek
    );
  end if;

  -- 6) Konaklama
  if v_kural.konaklama_aktif and v_km >= v_kural.konaklama_min_km and v_kural.konaklama_tutar > 0 then
    v_konaklama := v_kural.konaklama_tutar;
    v_kalemler := v_kalemler || jsonb_build_object(
      'tip', 'konaklama',
      'aciklama', 'Konaklama (≥' || v_kural.konaklama_min_km || ' km)',
      'tutar', v_konaklama
    );
  end if;

  -- 7) Toplam + minimum koruma
  v_toplam := v_brut + v_kademe_ek + v_konaklama;
  if v_toplam < v_kural.minimum_tutar then
    v_kalemler := v_kalemler || jsonb_build_object(
      'tip', 'min_koruma',
      'aciklama', 'Minimum harcırah koruması',
      'tutar', round(v_kural.minimum_tutar - v_toplam, 2)
    );
    v_toplam := v_kural.minimum_tutar;
  end if;

  v_not := 'Otomatik hesap: ' || v_il || ' / ' || coalesce(v_bolge,'?') ||
           ' · ' || v_km::text || ' km (' || v_km_kaynak || ') · ' ||
           coalesce(v_km_birim::text || ' TL/km', v_sabit::text || ' TL sabit');

  return jsonb_build_object(
    'basari', true,
    'tutar', round(v_toplam, 2),
    'il', v_il,
    'bolge', v_bolge,
    'mesafe_km', v_km,
    'mesafe_kaynak', v_km_kaynak,
    'kaynak', v_kaynak,
    'km_birim', v_km_birim,
    'kalemler', v_kalemler,
    'not', v_not,
    'dolu_donus_yuzde', v_kural.dolu_donus_yuzde,
    'bos_donus_yuzde',  v_kural.bos_donus_yuzde
  );
end $$;

revoke all on function public.harcirah_uzak_hesapla(uuid,text,text,double precision,double precision,double precision,double precision,text,numeric) from public;
grant execute on function public.harcirah_uzak_hesapla(uuid,text,text,double precision,double precision,double precision,double precision,text,numeric) to authenticated;

comment on function public.harcirah_uzak_hesapla(uuid,text,text,double precision,double precision,double precision,double precision,text,numeric) is 'Uzak il harcırahı otomatik hesabı. p_tahmini_km verilirse (frontend OSRM) önceliklidir, yoksa haversine. JSON döner: tutar + kalemler + mesafe_kaynak.';

-- ════════════════════════════════════════════════════════════
-- Trigger: NEW.tahmini_km parametresini iletecek şekilde güncellendi
-- ════════════════════════════════════════════════════════════
create or replace function public.trg_isemri_harcirah_olustur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tarife        record;
  v_kayit_id      uuid;
  v_dorse_tipi    text;
  v_is_tarihi     date;
  v_arac_plaka    text;
  v_baslik        text;
  v_mesaj         text;
  v_sofor_user_id uuid;
  v_uzak          jsonb;
begin
  if new.firma_id is null then return new; end if;
  if new.durum = 'İptal' then return new; end if;

  if exists (select 1 from public.harcirah_kayitlari where is_emri_id = new.id) then
    return new;
  end if;

  v_is_tarihi  := coalesce(new.atama_zamani::date, new.created_at::date, current_date);
  v_arac_plaka := coalesce(new.arac_plaka, '');
  v_sofor_user_id := public._is_emri_sofor_user_id(new);

  v_dorse_tipi := null;
  if new.dorse_id is not null then
    select a.dorse_tipi into v_dorse_tipi
      from public.araclar a where a.id = new.dorse_id limit 1;
  end if;

  -- Katman 1: Sabit tarife
  begin
    select * into v_tarife from public.harcirah_tarife_bul(
      new.firma_id, new.yukle_yeri, new.teslim_yeri, new.kont_tip, new.kont_durum,
      v_dorse_tipi, v_is_tarihi
    ) limit 1;
  exception when others then v_tarife := null;
  end;

  if v_tarife.id is not null then
    insert into public.harcirah_kayitlari (
      firma_id, is_emri_id, sofor_user_id, sofor_ad, arac_id, arac_plaka,
      tarife_id, hesaplanan_tutar, is_tarihi, durum
    ) values (
      new.firma_id, new.id, v_sofor_user_id, new.sofor,
      coalesce(new.cekici_id, null), v_arac_plaka,
      v_tarife.id, v_tarife.tutar, v_is_tarihi, 'beklemede'
    ) returning id into v_kayit_id;

    v_baslik := coalesce(v_arac_plaka, '#' || new.id::text) || ' — Harcırah hesaplandı: ' ||
                to_char(v_tarife.tutar, 'FM999G999D90') || ' ₺';
    v_mesaj  := coalesce(v_tarife.baslik, '') ||
                case when v_tarife.eslesen_bolge is not null then ' · Bölge: ' || v_tarife.eslesen_bolge else '' end ||
                ' · ' || coalesce(new.musteri_adi, 'Müşteri');
    begin
      perform public.notify_create(new.firma_id, 'genel', v_baslik, v_mesaj,
        'is_emri', new.id::text, v_sofor_user_id,
        coalesce(new.sofor, v_arac_plaka), 'normal');
    exception when others then null; end;
    return new;
  end if;

  -- Katman 2: Uzak il fallback (2026-05-08d) + tahmini_km öncelikli (2026-05-08h)
  v_uzak := public.harcirah_uzak_hesapla(
    new.firma_id, new.yukle_yeri, new.teslim_yeri,
    new.yukle_lat, new.yukle_lng, new.teslim_lat, new.teslim_lng,
    new.kont_durum,
    new.tahmini_km
  );

  if (v_uzak->>'basari')::boolean = true then
    insert into public.harcirah_kayitlari (
      firma_id, is_emri_id, sofor_user_id, sofor_ad, arac_id, arac_plaka,
      tarife_id, hesaplanan_tutar, is_tarihi, durum, aciklama
    ) values (
      new.firma_id, new.id, v_sofor_user_id, new.sofor,
      coalesce(new.cekici_id, null), v_arac_plaka,
      null,
      (v_uzak->>'tutar')::numeric,
      v_is_tarihi, 'beklemede',
      v_uzak->>'not'
    ) returning id into v_kayit_id;

    v_baslik := coalesce(v_arac_plaka, '#' || new.id::text) ||
                ' — Otomatik harcırah: ' ||
                to_char((v_uzak->>'tutar')::numeric, 'FM999G999D90') || ' ₺ (' ||
                (v_uzak->>'il') || ')';
    v_mesaj  := v_uzak->>'not';
    begin
      perform public.notify_create(new.firma_id, 'genel', v_baslik, v_mesaj,
        'is_emri', new.id::text, v_sofor_user_id,
        coalesce(new.sofor, v_arac_plaka), 'normal');
    exception when others then null; end;
  else
    v_baslik := coalesce(v_arac_plaka, '#' || new.id::text) || ' — Tarife eşleşmedi';
    v_mesaj  := coalesce(v_uzak->>'sebep',
                'Bu rota için tarife bulunamadı: ' ||
                coalesce(new.yukle_yeri, '?') || ' → ' || coalesce(new.teslim_yeri, '?') ||
                '. Harcırah modülünden manuel girilebilir.');
    begin
      perform public.notify_create(new.firma_id, 'genel', v_baslik, v_mesaj,
        'is_emri', new.id::text, null,
        coalesce(new.sofor, v_arac_plaka), 'normal');
    exception when others then null; end;
  end if;

  return new;
exception when others then
  raise warning 'trg_isemri_harcirah_olustur hata: %', sqlerrm;
  return new;
end $$;
