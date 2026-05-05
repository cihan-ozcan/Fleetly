-- =============================================================================
-- FLEETLY  —  2026-05-05h  —  Harcırah Paket C: Hafta kapatma RPC
-- =============================================================================
-- Yönetici "Hafta Kapat" dediğinde:
--   • Belirtilen şoförün (veya tüm şoförlerin) belirtilen haftadaki
--     iptal olmayan harcırah kayıtları toplanır.
--   • harcirah_haftalik tablosuna özet snapshot yazılır (UNIQUE: firma+sofor+hafta).
--   • Bildirim: "X. hafta kapatıldı: N kayıt · Y₺"
--
-- Önkoşullar:
--   2026_05_05d, 2026_05_05e, 2026_05_05f, 2026_05_05g
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Bir şoför için tek hafta kapatma
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_hafta_kapat(
  p_sofor_user_id uuid,
  p_hafta_yili    integer,
  p_hafta_no      integer,
  p_notlar        text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id      uuid;
  v_yetki         text;
  v_haftalik_id   uuid;
  v_sofor_ad      text;
  v_kayit_sayisi  integer;
  v_brut          numeric(12,2);
  v_avans         numeric(12,2);
  v_net           numeric(12,2);
  v_baslangic     date;
  v_bitis         date;
BEGIN
  -- Yetki kontrolü
  SELECT fk.firma_id, fk.rol INTO v_firma_id, v_yetki
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici','operasyoncu','muhasebeci')
   LIMIT 1;
  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Yetki yok: hafta kapatmak için sahip/yönetici/operasyoncu/muhasebeci rolü gerekli.'
      USING ERRCODE = '42501';
  END IF;

  -- Şoför adı snapshot için ilk kayıttan al
  SELECT k.sofor_ad INTO v_sofor_ad
    FROM public.harcirah_kayitlari k
   WHERE k.firma_id = v_firma_id
     AND k.sofor_user_id = p_sofor_user_id
     AND k.hafta_yili = p_hafta_yili
     AND k.hafta_no = p_hafta_no
     AND k.durum <> 'iptal'
   LIMIT 1;

  -- Toplam ve aralık
  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(k.manuel_tutar, k.hesaplanan_tutar, 0) + k.ek_masraflar), 0),
    COALESCE(SUM(k.avans_dusum), 0),
    COALESCE(SUM(k.net_tutar), 0),
    MIN(k.is_tarihi),
    MAX(k.is_tarihi)
  INTO v_kayit_sayisi, v_brut, v_avans, v_net, v_baslangic, v_bitis
  FROM public.harcirah_kayitlari k
  WHERE k.firma_id = v_firma_id
    AND k.sofor_user_id = p_sofor_user_id
    AND k.hafta_yili = p_hafta_yili
    AND k.hafta_no = p_hafta_no
    AND k.durum <> 'iptal';

  IF v_kayit_sayisi IS NULL OR v_kayit_sayisi = 0 THEN
    RAISE EXCEPTION 'Bu hafta için kapatılacak kayıt yok.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Snapshot insert (UNIQUE constraint nedeniyle aynı hafta tekrar kapatılamaz —
  -- önce iptal edilmesi gerekir).
  INSERT INTO public.harcirah_haftalik (
    firma_id, sofor_user_id, sofor_ad,
    hafta_no, hafta_yili,
    baslangic_tarih, bitis_tarih,
    kayit_sayisi, toplam_brut, toplam_avans, toplam_net,
    durum, notlar, kapatan_user_id
  ) VALUES (
    v_firma_id, p_sofor_user_id, v_sofor_ad,
    p_hafta_no, p_hafta_yili,
    v_baslangic, v_bitis,
    v_kayit_sayisi, v_brut, v_avans, v_net,
    'kapali', p_notlar, auth.uid()
  ) RETURNING id INTO v_haftalik_id;

  -- Kayıtları "ops_onay"a yükselt (sofor_onay'da kalanlar dahil)
  UPDATE public.harcirah_kayitlari
     SET durum = 'ops_onay',
         ops_onay_at = COALESCE(ops_onay_at, now()),
         ops_onay_user_id = COALESCE(ops_onay_user_id, auth.uid())
   WHERE firma_id = v_firma_id
     AND sofor_user_id = p_sofor_user_id
     AND hafta_yili = p_hafta_yili
     AND hafta_no = p_hafta_no
     AND durum IN ('beklemede', 'sofor_onay');

  -- Bildirim
  BEGIN
    PERFORM public.notify_create(
      v_firma_id,
      'genel',
      COALESCE(v_sofor_ad, 'Şoför') || ' — ' || p_hafta_yili::text || '/Hafta ' || p_hafta_no::text || ' kapatıldı',
      v_kayit_sayisi::text || ' kayıt · ' || to_char(v_net, 'FM999G999D90') || ' ₺ net',
      'haftalik',
      v_haftalik_id::text,
      NULL,
      v_sofor_ad,
      'normal'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_haftalik_id;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_hafta_kapat(uuid, integer, integer, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) Hafta iptali (snapshot'ı geri al — kayıtlar durum etkilenmez)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_hafta_iptal(p_haftalik_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
BEGIN
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici')
   LIMIT 1;
  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Yetki yok' USING ERRCODE = '42501';
  END IF;

  UPDATE public.harcirah_haftalik
     SET durum = 'iptal'
   WHERE id = p_haftalik_id
     AND firma_id = v_firma_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Haftalık kayıt bulunamadı: %', p_haftalik_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_hafta_iptal(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) Haftalık ödeme işaretleme
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_hafta_oden(
  p_haftalik_id   uuid,
  p_yontem        text,
  p_referans      text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
  v_sofor_user_id uuid;
  v_hafta_yili integer;
  v_hafta_no integer;
BEGIN
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici','muhasebeci')
   LIMIT 1;
  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Yetki yok' USING ERRCODE = '42501';
  END IF;

  -- Hafta bilgisini al
  SELECT sofor_user_id, hafta_yili, hafta_no INTO v_sofor_user_id, v_hafta_yili, v_hafta_no
    FROM public.harcirah_haftalik
   WHERE id = p_haftalik_id AND firma_id = v_firma_id;
  IF v_sofor_user_id IS NULL THEN
    RAISE EXCEPTION 'Haftalık kayıt bulunamadı';
  END IF;

  -- Snapshot ödendi
  UPDATE public.harcirah_haftalik
     SET durum = 'odendi',
         odeme_at = now(),
         odeme_yontemi = p_yontem,
         odeme_referans = p_referans
   WHERE id = p_haftalik_id;

  -- Bağlı tüm kayıtları odendi yap
  UPDATE public.harcirah_kayitlari
     SET durum = 'odendi',
         odeme_at = now(),
         odeme_user_id = auth.uid(),
         odeme_yontemi = p_yontem,
         odeme_referans = p_referans
   WHERE firma_id = v_firma_id
     AND sofor_user_id = v_sofor_user_id
     AND hafta_yili = v_hafta_yili
     AND hafta_no = v_hafta_no
     AND durum <> 'iptal';
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_hafta_oden(uuid, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) Tüm şoförler için tek seferde hafta kapatma (yardımcı)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_hafta_kapat_tumu(
  p_hafta_yili integer,
  p_hafta_no   integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
  v_count    integer := 0;
  v_sofor    record;
BEGIN
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici','operasyoncu','muhasebeci')
   LIMIT 1;
  IF v_firma_id IS NULL THEN RAISE EXCEPTION 'Yetki yok' USING ERRCODE = '42501'; END IF;

  FOR v_sofor IN
    SELECT DISTINCT k.sofor_user_id
      FROM public.harcirah_kayitlari k
     WHERE k.firma_id = v_firma_id
       AND k.hafta_yili = p_hafta_yili
       AND k.hafta_no = p_hafta_no
       AND k.durum <> 'iptal'
       AND k.sofor_user_id IS NOT NULL
       -- Daha önce kapatılmamış
       AND NOT EXISTS (
         SELECT 1 FROM public.harcirah_haftalik h
          WHERE h.firma_id = v_firma_id
            AND h.sofor_user_id = k.sofor_user_id
            AND h.hafta_yili = p_hafta_yili
            AND h.hafta_no = p_hafta_no
            AND h.durum <> 'iptal'
       )
  LOOP
    BEGIN
      PERFORM public.harcirah_hafta_kapat(v_sofor.sofor_user_id, p_hafta_yili, p_hafta_no, NULL);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Tek bir şoförde hata diğerlerini durdurmasın
      RAISE WARNING 'Hafta kapatma hata (%): %', v_sofor.sofor_user_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_hafta_kapat_tumu(integer, integer) TO authenticated;

COMMIT;
