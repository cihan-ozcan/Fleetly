-- =============================================================================
-- FLEETLY  —  2026-05-05f  —  Harcırah: SECURITY DEFINER insert RPC'leri
-- =============================================================================
-- Sorun: client tarafında "new row violates RLS policy" 403 hatası.
-- Sebep: payload'ta firma_id manuel set ediliyor ama oturum/rol bağlamı
--        farklı olduğunda RLS check fail oluyor.
--
-- Çözüm: notify_create benzeri SECURITY DEFINER RPC. Auth.uid() üzerinden
--        firma_id'yi sunucuda otomatik çözer, RLS'i bypass eder ama yetki
--        kontrolü RPC içinde yapılır (sadece firma üyeleri çağırabilir).
--
-- Önkoşul: 2026_05_05d__harcirah_sistemi.sql + 2026_05_05e__harcirah_bolgeler...
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Tarife oluştur RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_tarife_create(
  p_baslik           text,
  p_tutar            numeric,
  p_bolgeler         text[]   DEFAULT NULL,
  p_alim_yeri        text     DEFAULT NULL,
  p_teslim_yeri      text     DEFAULT NULL,
  p_bos_donus_yeri   text     DEFAULT NULL,
  p_kont_tip         text     DEFAULT NULL,
  p_kont_durum       text     DEFAULT NULL,
  p_dorse_tipi       text     DEFAULT NULL,
  p_para_birimi      text     DEFAULT 'TRY',
  p_tahmini_km       numeric  DEFAULT NULL,
  p_tahmini_sure_dk  integer  DEFAULT NULL,
  p_gecerli_baslangic date    DEFAULT NULL,
  p_gecerli_bitis    date     DEFAULT NULL,
  p_aktif_mi         boolean  DEFAULT true,
  p_oncelik          integer  DEFAULT 100,
  p_notlar           text     DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
  v_id       uuid;
BEGIN
  -- Auth user'ın firma_id'sini bul
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici','operasyoncu')
   LIMIT 1;

  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Yetki yok: firma_id bulunamadı veya kullanıcı rolü yetersiz (sahip/yonetici/operasyoncu).'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.harcirah_tarifeleri
    (firma_id, baslik, tutar, bolgeler, alim_yeri, teslim_yeri, bos_donus_yeri,
     kont_tip, kont_durum, dorse_tipi, para_birimi, tahmini_km, tahmini_sure_dk,
     gecerli_baslangic, gecerli_bitis, aktif_mi, oncelik, notlar, created_by)
  VALUES
    (v_firma_id, p_baslik, p_tutar, p_bolgeler, p_alim_yeri, p_teslim_yeri, p_bos_donus_yeri,
     p_kont_tip, p_kont_durum, p_dorse_tipi, p_para_birimi, p_tahmini_km, p_tahmini_sure_dk,
     COALESCE(p_gecerli_baslangic, CURRENT_DATE), p_gecerli_bitis, p_aktif_mi, p_oncelik, p_notlar, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_tarife_create(
  text, numeric, text[], text, text, text, text, text, text, text, numeric, integer, date, date, boolean, integer, text
) TO authenticated;

COMMENT ON FUNCTION public.harcirah_tarife_create IS
  'Tarife oluşturma RPC. firma_id otomatik auth.uid()''den çözülür. Yalnızca sahip/yonetici/operasyoncu rolündeki kullanıcılar çağırabilir.';

-- -----------------------------------------------------------------------------
-- 2) Ek hizmet oluştur RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_ek_hizmet_create(
  p_kod             text,
  p_ad              text,
  p_tutar           numeric,
  p_hesaplama_tipi  text     DEFAULT 'sabit',
  p_aciklama        text     DEFAULT NULL,
  p_aktif_mi        boolean  DEFAULT true,
  p_sira            integer  DEFAULT 100
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
  v_id       uuid;
BEGIN
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici','operasyoncu')
   LIMIT 1;

  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Yetki yok: firma_id bulunamadı veya kullanıcı rolü yetersiz.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.harcirah_ek_hizmetler
    (firma_id, kod, ad, tutar, hesaplama_tipi, aciklama, aktif_mi, sira)
  VALUES
    (v_firma_id, p_kod, p_ad, p_tutar, p_hesaplama_tipi, p_aciklama, p_aktif_mi, p_sira)
  ON CONFLICT (firma_id, kod) DO UPDATE SET
    ad = EXCLUDED.ad,
    tutar = EXCLUDED.tutar,
    hesaplama_tipi = EXCLUDED.hesaplama_tipi,
    aciklama = EXCLUDED.aciklama,
    aktif_mi = EXCLUDED.aktif_mi,
    sira = EXCLUDED.sira,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_ek_hizmet_create(
  text, text, numeric, text, text, boolean, integer
) TO authenticated;

COMMENT ON FUNCTION public.harcirah_ek_hizmet_create IS
  'Ek hizmet oluşturma RPC (upsert: kod aynıysa günceller). firma_id otomatik auth.uid()''den çözülür.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
--   SELECT public.harcirah_tarife_create(
--     'Test Tarife', 500,
--     ARRAY['Çatalca','Hadımköy']::text[]
--   );
-- =============================================================================
