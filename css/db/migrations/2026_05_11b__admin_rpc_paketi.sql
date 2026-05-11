-- =============================================================================
-- FLEETLY  —  2026-05-11b  —  Admin RPC Paketi (firma, kullanıcı, liman kilit, KPI)
-- =============================================================================
-- AÇIK:
--   Platform admin paneli için DB tarafında gerekli RPC'ler:
--     • Liman global edit sıkılaştır (manuel ayar fazı kapanıyor)
--     • Tüm firmaları listele + detay + suspend/aktif
--     • Tüm kullanıcıları listele + detay
--     • Dashboard KPI metrikleri
--
-- BAĞIMLILIK: 2026_05_11a (_is_platform_admin, admin_log helper)
--
-- DOĞRULAMA: en altta.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) LİMAN GLOBAL EDIT — KİLİT
-- -----------------------------------------------------------------------------
-- 2026_05_06p'deki "manuel ayar fazı" kuralını sıkılaştır:
-- Global limanlar (firma_id IS NULL) için sadece PLATFORM ADMIN düzenleyebilir.
-- Firma özel limanlar için mevcut yetki devam (sahip/yonetici).

CREATE OR REPLACE FUNCTION public.liman_guncelle(
  p_id          uuid,
  p_ad          text DEFAULT NULL,
  p_tip         text DEFAULT NULL,
  p_poligon_geojson text DEFAULT NULL,
  p_aktif       boolean DEFAULT NULL,
  p_notlar      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_geom    geometry;
  v_yetki   boolean;
  v_liman   public.limanlar%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Liman id zorunlu' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_liman FROM public.limanlar WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liman bulunamadı: %', p_id USING ERRCODE = '02000';
  END IF;

  -- Yetki: global → platform admin; firma özel → firma yöneticisi
  IF v_liman.firma_id IS NULL THEN
    v_yetki := public._is_platform_admin();
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.firma_id = v_liman.firma_id
         AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ) INTO v_yetki;
  END IF;

  IF NOT v_yetki THEN
    RAISE EXCEPTION 'Liman düzenleme yetkisi yok' USING ERRCODE = '42501';
  END IF;

  IF p_poligon_geojson IS NOT NULL THEN
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_poligon_geojson), 4326);
    IF GeometryType(v_geom) <> 'POLYGON' THEN
      RAISE EXCEPTION 'Geometry Polygon olmalı (% verildi)', GeometryType(v_geom);
    END IF;
  END IF;

  UPDATE public.limanlar
     SET ad      = COALESCE(p_ad, ad),
         tip     = COALESCE(p_tip, tip),
         poligon = COALESCE(v_geom, poligon),
         aktif   = COALESCE(p_aktif, aktif),
         notlar  = COALESCE(p_notlar, notlar),
         updated_at = now()
   WHERE id = p_id;

  -- Audit (sadece platform admin global liman değişikliğinde)
  IF v_liman.firma_id IS NULL THEN
    PERFORM public.admin_log(
      'liman_guncelle', 'liman', p_id::text,
      'Global liman güncellendi: ' || COALESCE(p_ad, v_liman.ad),
      jsonb_build_object(
        'id', p_id, 'eski_ad', v_liman.ad, 'yeni_ad', p_ad,
        'polygon_degisti', p_poligon_geojson IS NOT NULL
      )
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_guncelle(uuid, text, text, text, boolean, text) TO authenticated;

-- Liman silme — global için platform admin
CREATE OR REPLACE FUNCTION public.liman_sil(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_liman   public.limanlar%ROWTYPE;
  v_yetki   boolean;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Liman id zorunlu' USING ERRCODE = '23502';
  END IF;
  SELECT * INTO v_liman FROM public.limanlar WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liman bulunamadı: %', p_id USING ERRCODE = '02000';
  END IF;

  IF v_liman.firma_id IS NULL THEN
    v_yetki := public._is_platform_admin();
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.firma_id = v_liman.firma_id
         AND fk.rol IN ('sahip','yonetici')
    ) INTO v_yetki;
  END IF;

  IF NOT v_yetki THEN
    RAISE EXCEPTION 'Liman silme yetkisi yok' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.limanlar WHERE id = p_id;

  IF v_liman.firma_id IS NULL THEN
    PERFORM public.admin_log(
      'liman_sil', 'liman', p_id::text,
      'Global liman silindi: ' || v_liman.ad,
      jsonb_build_object('id', p_id, 'ad', v_liman.ad, 'tip', v_liman.tip)
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_sil(uuid) TO authenticated;

-- Eski 5-paramlı overload'u kaldır (parametre adı p_firma_ozel idi, yeniden tasarlandı)
DROP FUNCTION IF EXISTS public.liman_olustur(text, text, text, boolean, text);

-- Yeni liman oluştur (global mi firma özel mi parametre ile)
CREATE OR REPLACE FUNCTION public.liman_olustur(
  p_ad                text,
  p_tip               text,
  p_poligon_geojson   text,
  p_global            boolean DEFAULT false,
  p_firma_id          uuid    DEFAULT NULL,
  p_notlar            text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_geom   geometry;
  v_id     uuid;
  v_firma  uuid;
  v_yetki  boolean;
BEGIN
  IF p_ad IS NULL OR length(trim(p_ad)) = 0 THEN
    RAISE EXCEPTION 'Liman adı zorunlu' USING ERRCODE = '23502';
  END IF;
  IF p_tip NOT IN ('liman','fabrika','terminal','depo','servis') THEN
    RAISE EXCEPTION 'Geçersiz tip: %', p_tip USING ERRCODE = '22023';
  END IF;
  IF p_poligon_geojson IS NULL THEN
    RAISE EXCEPTION 'Polygon zorunlu' USING ERRCODE = '23502';
  END IF;

  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_poligon_geojson), 4326);
  IF GeometryType(v_geom) <> 'POLYGON' THEN
    RAISE EXCEPTION 'Geometry Polygon olmalı (% verildi)', GeometryType(v_geom);
  END IF;

  IF p_global THEN
    -- Global liman → sadece platform admin
    IF NOT public._is_platform_admin() THEN
      RAISE EXCEPTION 'Global liman oluşturma yetkisi yok' USING ERRCODE = '42501';
    END IF;
    v_firma := NULL;
  ELSE
    -- Firma özel → kullanıcı bu firmada yönetici olmalı
    v_firma := COALESCE(p_firma_id, (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid() LIMIT 1
    ));
    IF v_firma IS NULL THEN
      RAISE EXCEPTION 'firma_id belirlenemedi' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.firma_id = v_firma
         AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ) INTO v_yetki;
    IF NOT v_yetki THEN
      RAISE EXCEPTION 'Firma içinde liman oluşturma yetkisi yok' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.limanlar(firma_id, ad, tip, poligon, notlar, created_by)
  VALUES (v_firma, p_ad, p_tip, v_geom, p_notlar, auth.uid())
  RETURNING id INTO v_id;

  IF p_global THEN
    PERFORM public.admin_log(
      'liman_olustur', 'liman', v_id::text,
      'Yeni global liman: ' || p_ad,
      jsonb_build_object('id', v_id, 'ad', p_ad, 'tip', p_tip)
    );
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_olustur(text, text, text, boolean, uuid, text) TO authenticated;

-- limanlar tablosu RLS — global INSERT'i de kilitle (RPC dışı yol kapalı)
DROP POLICY IF EXISTS limanlar_insert ON public.limanlar;
CREATE POLICY limanlar_insert ON public.limanlar
  FOR INSERT TO authenticated
  WITH CHECK (
    (firma_id IS NULL AND public._is_platform_admin())
    OR
    (firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ))
  );

DROP POLICY IF EXISTS limanlar_update ON public.limanlar;
CREATE POLICY limanlar_update ON public.limanlar
  FOR UPDATE TO authenticated
  USING (
    (firma_id IS NULL AND public._is_platform_admin())
    OR
    (firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ))
  );

DROP POLICY IF EXISTS limanlar_delete ON public.limanlar;
CREATE POLICY limanlar_delete ON public.limanlar
  FOR DELETE TO authenticated
  USING (
    (firma_id IS NULL AND public._is_platform_admin())
    OR
    (firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
    ))
  );

-- -----------------------------------------------------------------------------
-- 2) ADMIN: FİRMA LİSTESİ + DETAY
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_firmalar_listele(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_arama   text    DEFAULT NULL,
  p_durum   text    DEFAULT NULL    -- 'aktif', 'suspended', 'demo', NULL=tümü
)
RETURNS TABLE(
  id                  uuid,
  ad                  text,
  kayit_tarihi        timestamptz,
  son_giris           timestamptz,
  kullanici_sayisi    integer,
  surucu_sayisi       integer,
  arac_sayisi         integer,
  sefer_30g           integer,
  abonelik_plan       text,
  abonelik_durum      text,
  abonelik_bitis      timestamptz,
  suspended           boolean,
  is_demo             boolean,
  toplam              bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_toplam bigint;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  -- Toplam sayım
  SELECT COUNT(*) INTO v_toplam FROM public.firmalar f
   WHERE (p_arama IS NULL OR f.ad ILIKE '%' || p_arama || '%')
     AND (
       p_durum IS NULL
       OR (p_durum = 'aktif'      AND COALESCE(f.suspended, false) = false AND COALESCE(f.is_demo, false) = false)
       OR (p_durum = 'suspended'  AND f.suspended = true)
       OR (p_durum = 'demo'       AND f.is_demo = true)
     );

  RETURN QUERY
    SELECT
      f.id,
      f.ad,
      f.created_at AS kayit_tarihi,
      (SELECT MAX(u.last_sign_in_at)
         FROM auth.users u
         JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
        WHERE fk.firma_id = f.id) AS son_giris,
      (SELECT COUNT(*)::int FROM public.firma_kullanicilar fk WHERE fk.firma_id = f.id) AS kullanici_sayisi,
      (SELECT COUNT(*)::int FROM public.suruculer s WHERE s.firma_id = f.id) AS surucu_sayisi,
      (SELECT COUNT(*)::int FROM public.araclar a WHERE a.firma_id = f.id AND COALESCE(a.silindi, false) = false) AS arac_sayisi,
      (SELECT COUNT(*)::int FROM public.is_emirleri ie
        WHERE ie.firma_id = f.id
          AND ie.olusturma_zamani > now() - interval '30 days') AS sefer_30g,
      ab.plan_kodu                  AS abonelik_plan,
      ab.durum                      AS abonelik_durum,
      ab.bitis_tarihi               AS abonelik_bitis,
      COALESCE(f.suspended, false)  AS suspended,
      COALESCE(f.is_demo, false)    AS is_demo,
      v_toplam                      AS toplam
    FROM public.firmalar f
    LEFT JOIN LATERAL (
      SELECT plan_kodu, durum, bitis_tarihi
      FROM public.abonelikler ab2
      WHERE ab2.firma_id = f.id
      ORDER BY ab2.created_at DESC LIMIT 1
    ) ab ON true
    WHERE (p_arama IS NULL OR f.ad ILIKE '%' || p_arama || '%')
      AND (
        p_durum IS NULL
        OR (p_durum = 'aktif'      AND COALESCE(f.suspended, false) = false AND COALESCE(f.is_demo, false) = false)
        OR (p_durum = 'suspended'  AND f.suspended = true)
        OR (p_durum = 'demo'       AND f.is_demo = true)
      )
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_firmalar_listele(integer, integer, text, text) TO authenticated;

-- Firma detay (1 firma için kapsamlı bilgi)
CREATE OR REPLACE FUNCTION public.admin_firma_detay(p_firma_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'firma', to_jsonb(f.*),
    'kullanicilar', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', fk.user_id,
        'email', u.email,
        'rol', fk.rol,
        'son_giris', u.last_sign_in_at,
        'eklenme', fk.created_at
      ) ORDER BY fk.created_at), '[]'::jsonb)
      FROM public.firma_kullanicilar fk
      LEFT JOIN auth.users u ON u.id = fk.user_id
      WHERE fk.firma_id = p_firma_id
    ),
    'suruculer', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'ad', s.ad, 'telefon', s.telefon, 'aktif', s.aktif,
        'son_giris', s.son_giris_at
      ) ORDER BY s.ad), '[]'::jsonb)
      FROM public.suruculer s WHERE s.firma_id = p_firma_id
    ),
    'arac_sayisi', (SELECT COUNT(*) FROM public.araclar a WHERE a.firma_id = p_firma_id AND COALESCE(a.silindi, false) = false),
    'sefer_30g',   (SELECT COUNT(*) FROM public.is_emirleri ie WHERE ie.firma_id = p_firma_id AND ie.olusturma_zamani > now() - interval '30 days'),
    'sefer_90g',   (SELECT COUNT(*) FROM public.is_emirleri ie WHERE ie.firma_id = p_firma_id AND ie.olusturma_zamani > now() - interval '90 days'),
    'abonelik', (
      SELECT to_jsonb(ab.*) FROM public.abonelikler ab
       WHERE ab.firma_id = p_firma_id
       ORDER BY ab.created_at DESC LIMIT 1
    ),
    'davetler_acik', (
      SELECT COUNT(*) FROM public.firma_kullanici_davetleri d
       WHERE d.firma_id = p_firma_id AND d.kullanildi = false AND d.expires_at > now()
    )
  ) INTO v_result
  FROM public.firmalar f
  WHERE f.id = p_firma_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Firma bulunamadı: %', p_firma_id USING ERRCODE = '02000';
  END IF;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_firma_detay(uuid) TO authenticated;

-- Firma suspend (aktif/pasif)
CREATE OR REPLACE FUNCTION public.admin_firma_suspend(
  p_firma_id uuid,
  p_suspended boolean,
  p_neden text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  UPDATE public.firmalar SET suspended = p_suspended WHERE id = p_firma_id;
  PERFORM public.admin_log(
    CASE WHEN p_suspended THEN 'firma_suspend' ELSE 'firma_reaktive' END,
    'firma', p_firma_id::text,
    CASE WHEN p_suspended THEN 'Firma askıya alındı' ELSE 'Firma yeniden aktif' END
      || COALESCE(': ' || p_neden, ''),
    jsonb_build_object('firma_id', p_firma_id, 'suspended', p_suspended, 'neden', p_neden)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_firma_suspend(uuid, boolean, text) TO authenticated;

-- Manuel abonelik uzat
CREATE OR REPLACE FUNCTION public.admin_abonelik_uzat(
  p_firma_id uuid,
  p_yeni_bitis timestamptz,
  p_plan text DEFAULT NULL,
  p_not text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_eski_bitis timestamptz;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  SELECT bitis_tarihi INTO v_eski_bitis FROM public.abonelikler
   WHERE firma_id = p_firma_id ORDER BY created_at DESC LIMIT 1;

  UPDATE public.abonelikler
     SET bitis_tarihi = p_yeni_bitis,
         plan_kodu = COALESCE(p_plan, plan_kodu),
         durum = 'aktif',
         guncellenme_tarihi = now()
   WHERE firma_id = p_firma_id
     AND id = (SELECT id FROM public.abonelikler WHERE firma_id = p_firma_id ORDER BY created_at DESC LIMIT 1);

  PERFORM public.admin_log(
    'abonelik_uzat', 'firma', p_firma_id::text,
    'Abonelik uzatıldı → ' || to_char(p_yeni_bitis, 'YYYY-MM-DD'),
    jsonb_build_object(
      'firma_id', p_firma_id, 'eski_bitis', v_eski_bitis,
      'yeni_bitis', p_yeni_bitis, 'plan', p_plan, 'not', p_not
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_abonelik_uzat(uuid, timestamptz, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) ADMIN: KULLANICI LİSTESİ
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_kullanicilar_listele(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_arama   text    DEFAULT NULL,
  p_tip     text    DEFAULT NULL   -- 'ofis', 'surucu', NULL=tümü
)
RETURNS TABLE(
  user_id           uuid,
  email             text,
  tip               text,        -- 'ofis' veya 'surucu'
  ad_soyad          text,
  firma_ad          text,
  firma_id          uuid,
  rol               text,
  son_giris         timestamptz,
  kayit_tarihi      timestamptz,
  aktif             boolean,
  toplam            bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_toplam bigint;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_toplam FROM (
    SELECT 1 FROM auth.users u
    LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
    LEFT JOIN public.suruculer s ON s.auth_user_id = u.id
    WHERE (p_arama IS NULL OR u.email ILIKE '%' || p_arama || '%')
      AND (p_tip IS NULL
           OR (p_tip = 'ofis'   AND fk.user_id IS NOT NULL)
           OR (p_tip = 'surucu' AND s.id IS NOT NULL))
    GROUP BY u.id
  ) sub;

  RETURN QUERY
    SELECT
      u.id,
      u.email::text,
      CASE
        WHEN fk.user_id IS NOT NULL THEN 'ofis'::text
        WHEN s.id      IS NOT NULL THEN 'surucu'::text
        ELSE 'belirsiz'::text
      END AS tip,
      COALESCE(s.ad, u.raw_user_meta_data->>'ad_soyad', u.email::text) AS ad_soyad,
      f.ad AS firma_ad,
      COALESCE(fk.firma_id, s.firma_id) AS firma_id,
      fk.rol AS rol,
      u.last_sign_in_at AS son_giris,
      u.created_at AS kayit_tarihi,
      (u.banned_until IS NULL OR u.banned_until < now()) AS aktif,
      v_toplam AS toplam
    FROM auth.users u
    LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
    LEFT JOIN public.suruculer s          ON s.auth_user_id = u.id
    LEFT JOIN public.firmalar f           ON f.id = COALESCE(fk.firma_id, s.firma_id)
    WHERE (p_arama IS NULL OR u.email ILIKE '%' || p_arama || '%')
      AND (p_tip IS NULL
           OR (p_tip = 'ofis'   AND fk.user_id IS NOT NULL)
           OR (p_tip = 'surucu' AND s.id IS NOT NULL))
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_kullanicilar_listele(integer, integer, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) DASHBOARD KPI METRİKLERİ
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dashboard_metrikler()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'firma_toplam',         (SELECT COUNT(*) FROM public.firmalar),
    'firma_aktif',          (SELECT COUNT(*) FROM public.firmalar WHERE COALESCE(suspended, false) = false AND COALESCE(is_demo, false) = false),
    'firma_demo',           (SELECT COUNT(*) FROM public.firmalar WHERE COALESCE(is_demo, false) = true),
    'firma_suspended',      (SELECT COUNT(*) FROM public.firmalar WHERE suspended = true),
    'firma_bu_ay',          (SELECT COUNT(*) FROM public.firmalar WHERE created_at > date_trunc('month', now())),
    'firma_30g',            (SELECT COUNT(*) FROM public.firmalar WHERE created_at > now() - interval '30 days'),

    'kullanici_toplam',     (SELECT COUNT(*) FROM auth.users),
    'kullanici_30g_aktif',  (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'surucu_toplam',        (SELECT COUNT(*) FROM public.suruculer),
    'surucu_aktif',         (SELECT COUNT(*) FROM public.suruculer WHERE aktif = true),

    'arac_toplam',          (SELECT COUNT(*) FROM public.araclar WHERE COALESCE(silindi, false) = false),
    'sefer_30g',            (SELECT COUNT(*) FROM public.is_emirleri WHERE olusturma_zamani > now() - interval '30 days'),
    'sefer_bugun',          (SELECT COUNT(*) FROM public.is_emirleri WHERE olusturma_zamani::date = current_date),

    'abonelik_aktif',       (SELECT COUNT(*) FROM public.abonelikler WHERE durum = 'aktif' AND bitis_tarihi > now()),
    'abonelik_bu_ay',       (SELECT COUNT(*) FROM public.abonelikler WHERE created_at > date_trunc('month', now())),
    'mrr_yaklasik',         (SELECT COALESCE(SUM(
                              CASE WHEN plan_kodu = 'pro' THEN 499
                                   WHEN plan_kodu = 'premium' THEN 999
                                   WHEN plan_kodu = 'kurumsal' THEN 1999
                                   ELSE 0 END
                            ), 0)
                            FROM public.abonelikler
                            WHERE durum = 'aktif' AND bitis_tarihi > now()),

    'aylik_trend', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.ay), '[]'::jsonb)
      FROM (
        SELECT
          to_char(d, 'YYYY-MM') AS ay,
          (SELECT COUNT(*) FROM public.firmalar f
            WHERE date_trunc('month', f.created_at) = d) AS yeni_firma,
          (SELECT COUNT(*) FROM auth.users u
            WHERE date_trunc('month', u.created_at) = d) AS yeni_kullanici,
          (SELECT COUNT(*) FROM public.is_emirleri ie
            WHERE date_trunc('month', ie.olusturma_zamani) = d) AS sefer
        FROM generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          '1 month'
        ) d
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrikler() TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) E-POSTA → USER_ID LOOKUP (yeni admin ekleme için)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_lookup_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM auth.users WHERE email = lower(trim(p_email));
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_user_lookup_by_email(text) TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- Önce 2026_05_11a ile platform admin olduğundan emin ol:
--   SELECT _is_platform_admin();    -- true dönmeli
--
-- 1) Dashboard metrikleri:
--   SELECT admin_dashboard_metrikler();
--
-- 2) Firma listesi:
--   SELECT * FROM admin_firmalar_listele(10, 0);
--
-- 3) Firma detay:
--   SELECT admin_firma_detay((SELECT id FROM firmalar LIMIT 1));
--
-- 4) Liman global kilit:
--   - Platform admin değil iken liman_guncelle() ile global liman değiştirmeye
--     çalış → 42501 hata bekleniyor.
--   - Platform admin iken → çalışmalı + platform_audit_log'a satır eklemeli.
-- =============================================================================
