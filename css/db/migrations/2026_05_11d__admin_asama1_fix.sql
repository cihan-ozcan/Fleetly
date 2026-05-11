-- =============================================================================
-- FLEETLY  —  2026-05-11d  —  Aşama 1 RPC Şema Düzeltmesi
-- =============================================================================
-- AÇIK:
--   2026_05_11b migration'ında yazılan RPC'ler hatalı tablo/kolon referansları
--   içeriyordu:
--     • public.abonelikler tablosu yok → firmalar.abonelik_durumu/plani/bitis
--     • firmalar.suspended kolonu yok → yeni kolon ekleniyor
--     • firmalar.is_demo yok → mevcut demo_yuklendi kullanılacak
--     • araclar.silindi yok → tüm araclar geçerli
--     • is_emirleri.olusturma_zamani yok → created_at
--     • suruculer.aktif yok → aktif_mi GENERATED
--     • suruculer.son_giris_at yok → son_giris
--     • firmalar.eposta yok → iletisim_email
--     • firmalar.adres yok → kaldırıldı
--
-- ÇÖZÜM:
--   1) firmalar tablosuna 'suspended' kolonu ekle (manuel platform admin için)
--   2) Aşama 1'deki tüm RPC'leri DROP + CREATE doğru şemayla
--
-- BAĞIMLILIK: 2026_05_11a (helper'lar), 2026_05_11b (fonksiyon imzaları)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) FIRMALAR: 'suspended' kolonu
-- -----------------------------------------------------------------------------
ALTER TABLE public.firmalar
  ADD COLUMN IF NOT EXISTS suspended           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_neden     text,
  ADD COLUMN IF NOT EXISTS suspended_at        timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by        uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_firmalar_suspended
  ON public.firmalar(suspended) WHERE suspended = true;

COMMENT ON COLUMN public.firmalar.suspended IS
  'true = manuel platform admin tarafından askıya alındı. abonelik_durumu''ndan bağımsız.';

-- -----------------------------------------------------------------------------
-- 2) admin_firmalar_listele — DROP + CREATE (gerçek şemayla)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_firmalar_listele(integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.admin_firmalar_listele(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_arama   text    DEFAULT NULL,
  p_durum   text    DEFAULT NULL    -- 'aktif', 'deneme', 'suspended', 'demo', 'suresi_dolmus'
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
  deneme_bitis        timestamptz,
  suspended           boolean,
  is_demo             boolean,
  iletisim_email      text,
  telefon             text,
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

  SELECT COUNT(*) INTO v_toplam FROM public.firmalar f
   WHERE (p_arama IS NULL OR f.ad ILIKE '%' || p_arama || '%' OR f.iletisim_email ILIKE '%' || p_arama || '%')
     AND (
       p_durum IS NULL
       OR (p_durum = 'aktif'         AND f.abonelik_durumu = 'aktif' AND COALESCE(f.suspended, false) = false)
       OR (p_durum = 'deneme'        AND f.abonelik_durumu = 'deneme')
       OR (p_durum = 'suspended'     AND f.suspended = true)
       OR (p_durum = 'demo'          AND COALESCE(f.demo_yuklendi, false) = true)
       OR (p_durum = 'suresi_dolmus' AND f.abonelik_durumu = 'suresi_dolmus')
       OR (p_durum = 'odeme_bekliyor' AND f.abonelik_durumu = 'odeme_bekliyor')
     );

  RETURN QUERY
    SELECT
      f.id,
      f.ad,
      f.created_at,
      (SELECT MAX(u.last_sign_in_at)
         FROM auth.users u
         JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
        WHERE fk.firma_id = f.id),
      (SELECT COUNT(*)::int FROM public.firma_kullanicilar fk WHERE fk.firma_id = f.id),
      (SELECT COUNT(*)::int FROM public.suruculer s WHERE s.firma_id = f.id AND s.durum <> 'silindi'),
      (SELECT COUNT(*)::int FROM public.araclar a WHERE a.firma_id = f.id),
      (SELECT COUNT(*)::int FROM public.is_emirleri ie
        WHERE ie.firma_id = f.id AND ie.created_at > now() - interval '30 days'),
      f.abonelik_plani,
      f.abonelik_durumu,
      f.abonelik_bitis,
      f.deneme_bitis,
      COALESCE(f.suspended, false),
      COALESCE(f.demo_yuklendi, false),
      f.iletisim_email,
      f.telefon,
      v_toplam
    FROM public.firmalar f
    WHERE (p_arama IS NULL OR f.ad ILIKE '%' || p_arama || '%' OR f.iletisim_email ILIKE '%' || p_arama || '%')
      AND (
        p_durum IS NULL
        OR (p_durum = 'aktif'         AND f.abonelik_durumu = 'aktif' AND COALESCE(f.suspended, false) = false)
        OR (p_durum = 'deneme'        AND f.abonelik_durumu = 'deneme')
        OR (p_durum = 'suspended'     AND f.suspended = true)
        OR (p_durum = 'demo'          AND COALESCE(f.demo_yuklendi, false) = true)
        OR (p_durum = 'suresi_dolmus' AND f.abonelik_durumu = 'suresi_dolmus')
        OR (p_durum = 'odeme_bekliyor' AND f.abonelik_durumu = 'odeme_bekliyor')
      )
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_firmalar_listele(integer, integer, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) admin_firma_detay — DROP + CREATE
-- -----------------------------------------------------------------------------
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
        'email_confirmed_at', u.email_confirmed_at,
        'banned_until', u.banned_until
      ) ORDER BY fk.rol, u.email), '[]'::jsonb)
      FROM public.firma_kullanicilar fk
      LEFT JOIN auth.users u ON u.id = fk.user_id
      WHERE fk.firma_id = p_firma_id
    ),
    'suruculer', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'ad', s.ad, 'soyad', s.soyad,
        'telefon', s.telefon_e164, 'durum', s.durum,
        'son_giris', s.son_giris,
        'auth_user_id', s.auth_user_id
      ) ORDER BY s.ad), '[]'::jsonb)
      FROM public.suruculer s
      WHERE s.firma_id = p_firma_id AND s.durum <> 'silindi'
    ),
    'arac_sayisi', (SELECT COUNT(*) FROM public.araclar a WHERE a.firma_id = p_firma_id),
    'sefer_30g',   (SELECT COUNT(*) FROM public.is_emirleri ie WHERE ie.firma_id = p_firma_id AND ie.created_at > now() - interval '30 days'),
    'sefer_90g',   (SELECT COUNT(*) FROM public.is_emirleri ie WHERE ie.firma_id = p_firma_id AND ie.created_at > now() - interval '90 days'),
    'sefer_toplam',(SELECT COUNT(*) FROM public.is_emirleri ie WHERE ie.firma_id = p_firma_id),
    'davetler_acik', (
      SELECT COUNT(*) FROM public.firma_kullanici_davetleri d
       WHERE d.firma_id = p_firma_id AND COALESCE(d.kullanildi, false) = false
         AND COALESCE(d.expires_at, now() + interval '1 day') > now()
    ),
    'son_odemeler', (
      SELECT COALESCE(jsonb_agg(to_jsonb(og.*) ORDER BY og.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.odeme_gecmisi
        WHERE firma_id = p_firma_id
        ORDER BY created_at DESC LIMIT 10
      ) og
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

-- -----------------------------------------------------------------------------
-- 4) admin_firma_suspend — gerçek kolonla
-- -----------------------------------------------------------------------------
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

  UPDATE public.firmalar
     SET suspended = p_suspended,
         suspended_neden = CASE WHEN p_suspended THEN p_neden ELSE NULL END,
         suspended_at    = CASE WHEN p_suspended THEN now() ELSE NULL END,
         suspended_by    = CASE WHEN p_suspended THEN auth.uid() ELSE NULL END
   WHERE id = p_firma_id;

  PERFORM public.admin_log(
    CASE WHEN p_suspended THEN 'firma_suspend' ELSE 'firma_reaktive' END,
    'firma', p_firma_id::text,
    CASE WHEN p_suspended THEN 'Firma askıya alındı' ELSE 'Firma yeniden aktif' END
      || COALESCE(': ' || p_neden, ''),
    jsonb_build_object('firma_id', p_firma_id, 'suspended', p_suspended, 'neden', p_neden)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_firma_suspend(uuid, boolean, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) admin_abonelik_uzat — firmalar tablosu üzerinden
-- -----------------------------------------------------------------------------
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
  v_eski_plan text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT abonelik_bitis, abonelik_plani INTO v_eski_bitis, v_eski_plan
    FROM public.firmalar WHERE id = p_firma_id;

  UPDATE public.firmalar
     SET abonelik_bitis  = p_yeni_bitis,
         abonelik_plani  = COALESCE(p_plan, abonelik_plani),
         abonelik_durumu = 'aktif'
   WHERE id = p_firma_id;

  PERFORM public.admin_log(
    'abonelik_uzat', 'firma', p_firma_id::text,
    'Abonelik uzatıldı → ' || to_char(p_yeni_bitis, 'YYYY-MM-DD'),
    jsonb_build_object(
      'firma_id', p_firma_id,
      'eski_bitis', v_eski_bitis, 'yeni_bitis', p_yeni_bitis,
      'eski_plan', v_eski_plan,   'yeni_plan',  p_plan,
      'not', p_not
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_abonelik_uzat(uuid, timestamptz, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) admin_kullanicilar_listele — gerçek şemayla
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_kullanicilar_listele(integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.admin_kullanicilar_listele(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_arama   text    DEFAULT NULL,
  p_tip     text    DEFAULT NULL    -- 'ofis', 'surucu', NULL=tümü
)
RETURNS TABLE(
  user_id           uuid,
  email             text,
  tip               text,
  ad_soyad          text,
  firma_ad          text,
  firma_id          uuid,
  rol               text,
  son_giris         timestamptz,
  kayit_tarihi      timestamptz,
  email_confirmed   boolean,
  banned_until      timestamptz,
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
    SELECT u.id FROM auth.users u
    LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
    LEFT JOIN public.suruculer s ON s.auth_user_id = u.id
    WHERE (p_arama IS NULL OR u.email ILIKE '%' || p_arama || '%'
            OR s.ad ILIKE '%' || p_arama || '%'
            OR s.soyad ILIKE '%' || p_arama || '%')
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
      COALESCE(TRIM(BOTH FROM s.ad || ' ' || COALESCE(s.soyad, '')),
               u.raw_user_meta_data->>'ad_soyad',
               u.email::text) AS ad_soyad,
      f.ad AS firma_ad,
      COALESCE(fk.firma_id, s.firma_id) AS firma_id,
      fk.rol AS rol,
      u.last_sign_in_at AS son_giris,
      u.created_at AS kayit_tarihi,
      (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
      u.banned_until,
      (u.banned_until IS NULL OR u.banned_until < now()) AS aktif,
      v_toplam AS toplam
    FROM auth.users u
    LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
    LEFT JOIN public.suruculer s          ON s.auth_user_id = u.id
    LEFT JOIN public.firmalar f           ON f.id = COALESCE(fk.firma_id, s.firma_id)
    WHERE (p_arama IS NULL OR u.email ILIKE '%' || p_arama || '%'
            OR s.ad ILIKE '%' || p_arama || '%'
            OR s.soyad ILIKE '%' || p_arama || '%')
      AND (p_tip IS NULL
           OR (p_tip = 'ofis'   AND fk.user_id IS NOT NULL)
           OR (p_tip = 'surucu' AND s.id IS NOT NULL))
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_kullanicilar_listele(integer, integer, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) admin_dashboard_metrikler — gerçek şemayla
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
    'firma_aktif',          (SELECT COUNT(*) FROM public.firmalar WHERE abonelik_durumu = 'aktif' AND COALESCE(suspended, false) = false),
    'firma_deneme',         (SELECT COUNT(*) FROM public.firmalar WHERE abonelik_durumu = 'deneme' AND COALESCE(suspended, false) = false),
    'firma_suresi_dolmus',  (SELECT COUNT(*) FROM public.firmalar WHERE abonelik_durumu = 'suresi_dolmus'),
    'firma_demo',           (SELECT COUNT(*) FROM public.firmalar WHERE COALESCE(demo_yuklendi, false) = true),
    'firma_suspended',      (SELECT COUNT(*) FROM public.firmalar WHERE COALESCE(suspended, false) = true),
    'firma_bu_ay',          (SELECT COUNT(*) FROM public.firmalar WHERE created_at > date_trunc('month', now())),
    'firma_30g',            (SELECT COUNT(*) FROM public.firmalar WHERE created_at > now() - interval '30 days'),

    'kullanici_toplam',     (SELECT COUNT(*) FROM auth.users),
    'kullanici_30g_aktif',  (SELECT COUNT(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days'),
    'surucu_toplam',        (SELECT COUNT(*) FROM public.suruculer WHERE durum <> 'silindi'),
    'surucu_aktif',         (SELECT COUNT(*) FROM public.suruculer WHERE durum = 'aktif'),

    'arac_toplam',          (SELECT COUNT(*) FROM public.araclar),
    'sefer_30g',            (SELECT COUNT(*) FROM public.is_emirleri WHERE created_at > now() - interval '30 days'),
    'sefer_bugun',          (SELECT COUNT(*) FROM public.is_emirleri WHERE created_at::date = current_date),

    'abonelik_aktif',       (SELECT COUNT(*) FROM public.firmalar WHERE abonelik_durumu = 'aktif' AND abonelik_bitis > now()),
    'abonelik_bu_ay',       (SELECT COUNT(*) FROM public.odeme_gecmisi WHERE created_at > date_trunc('month', now()) AND durum = 'basarili'),
    'mrr_yaklasik',         (
      SELECT COALESCE(SUM(
        CASE
          WHEN f.abonelik_plani = 'pro'      THEN 499
          WHEN f.abonelik_plani = 'premium'  THEN 999
          WHEN f.abonelik_plani = 'kurumsal' THEN 1999
          ELSE 0
        END
      ), 0)
      FROM public.firmalar f
      WHERE f.abonelik_durumu = 'aktif' AND f.abonelik_bitis > now()
    ),

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
            WHERE date_trunc('month', ie.created_at) = d) AS sefer
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

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Dashboard:    SELECT admin_dashboard_metrikler();
-- 2) Firmalar:     SELECT * FROM admin_firmalar_listele(5, 0);
-- 3) Detay:        SELECT admin_firma_detay((SELECT id FROM firmalar LIMIT 1));
-- 4) Kullanıcılar: SELECT * FROM admin_kullanicilar_listele(5, 0);
-- =============================================================================
