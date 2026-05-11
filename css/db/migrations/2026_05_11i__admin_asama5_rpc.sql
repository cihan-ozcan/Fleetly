-- =============================================================================
-- FLEETLY  —  2026-05-11i  —  Aşama 5 RPC Paketi (Analytics + Webhook Log + CMS public)
-- =============================================================================
-- AÇIK:
--   Platform admin paneli Aşama 5:
--     • admin_log üzerinden aktivite analizi
--     • Tüm edge function çağrıları (pg_net üzerinden)
--     • CMS içeriği anonymous okuma RPC'si (HTML sayfalar için)
--     • Impersonation tracking (mevcut audit log üzerinden ek RPC)
--
-- BAĞIMLILIK: 2026_05_11a, 2026_05_11f, 2026_05_11h
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ADMIN ANALYTICS — Audit Log üzerinden genel aktivite
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_analytics_ozet(p_son_gun integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'toplam_islem',     (SELECT COUNT(*) FROM public.platform_audit_log
                          WHERE created_at > now() - (p_son_gun || ' days')::interval),
    'aktif_admin',      (SELECT COUNT(DISTINCT user_id) FROM public.platform_audit_log
                          WHERE created_at > now() - (p_son_gun || ' days')::interval),
    'basarili',         (SELECT COUNT(*) FROM public.platform_audit_log
                          WHERE basarili = true
                            AND created_at > now() - (p_son_gun || ' days')::interval),
    'basarisiz',        (SELECT COUNT(*) FROM public.platform_audit_log
                          WHERE basarili = false
                            AND created_at > now() - (p_son_gun || ' days')::interval),
    'son_24sa',         (SELECT COUNT(*) FROM public.platform_audit_log
                          WHERE created_at > now() - interval '24 hours'),

    -- İşlem tipi dağılımı
    'islem_tipi_dagilim', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tip', islem_tipi, 'sayi', sayi
      ) ORDER BY sayi DESC), '[]'::jsonb)
      FROM (
        SELECT islem_tipi, COUNT(*) AS sayi
        FROM public.platform_audit_log
        WHERE created_at > now() - (p_son_gun || ' days')::interval
        GROUP BY islem_tipi
        ORDER BY COUNT(*) DESC
        LIMIT 15
      ) t
    ),

    -- Admin başına aktivite
    'admin_aktivitesi', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id',  user_id,
        'email',    email,
        'ad_soyad', ad_soyad,
        'toplam',   toplam,
        'son',      son_islem
      ) ORDER BY toplam DESC), '[]'::jsonb)
      FROM (
        SELECT
          al.user_id,
          u.email::text AS email,
          pa.ad_soyad,
          COUNT(*) AS toplam,
          MAX(al.created_at) AS son_islem
        FROM public.platform_audit_log al
        LEFT JOIN auth.users u ON u.id = al.user_id
        LEFT JOIN public.platform_adminler pa ON pa.user_id = al.user_id
        WHERE al.created_at > now() - (p_son_gun || ' days')::interval
        GROUP BY al.user_id, u.email, pa.ad_soyad
        ORDER BY COUNT(*) DESC
        LIMIT 20
      ) a
    ),

    -- Günlük aktivite trendi
    'gunluk_trend', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.gun), '[]'::jsonb)
      FROM (
        SELECT
          to_char(d, 'YYYY-MM-DD') AS gun,
          (SELECT COUNT(*) FROM public.platform_audit_log
            WHERE date_trunc('day', created_at) = d) AS islem,
          (SELECT COUNT(DISTINCT user_id) FROM public.platform_audit_log
            WHERE date_trunc('day', created_at) = d) AS admin
        FROM generate_series(
          (now() - (p_son_gun || ' days')::interval)::date,
          now()::date,
          '1 day'
        ) d
      ) t
    ),

    -- Saatlik dağılım (24 saat × 7 gün ortalama)
    'saatlik_dagilim', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'saat', saat, 'sayi', sayi
      ) ORDER BY saat), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(HOUR FROM created_at)::int AS saat, COUNT(*) AS sayi
        FROM public.platform_audit_log
        WHERE created_at > now() - (p_son_gun || ' days')::interval
        GROUP BY EXTRACT(HOUR FROM created_at)
      ) s
    ),

    -- Hedef tip dağılımı
    'hedef_tip_dagilim', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tip', hedef_tip, 'sayi', sayi
      ) ORDER BY sayi DESC), '[]'::jsonb)
      FROM (
        SELECT hedef_tip, COUNT(*) AS sayi
        FROM public.platform_audit_log
        WHERE created_at > now() - (p_son_gun || ' days')::interval
          AND hedef_tip IS NOT NULL
        GROUP BY hedef_tip
      ) ht
    ),

    -- Impersonation kayıtları (son N gün)
    'son_impersonate', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'admin_email', detay->>'admin_email',
        'target_email', detay->>'target_email',
        'neden', detay->>'neden',
        'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM (
        SELECT id, detay, created_at FROM public.platform_audit_log
        WHERE islem_tipi = 'user_impersonate'
          AND created_at > now() - (p_son_gun || ' days')::interval
        ORDER BY created_at DESC
        LIMIT 20
      ) imp
    )
  ) INTO v_result;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_analytics_ozet(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) EDGE FUNCTION ÇAĞRILARI (pg_net üzerinden, fonksiyon adına göre filtre)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_edge_function_log(
  p_fn_name text DEFAULT NULL,   -- 'send-email', 'iyzipay-init', vs. NULL=tümü
  p_limit   integer DEFAULT 50
)
RETURNS TABLE(
  request_id    bigint,
  fn_name       text,
  url           text,
  status_code   integer,
  created_at    timestamptz,
  body_preview  text,
  response_preview text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      r.id,
      -- URL'den fn adını çıkar: ".../functions/v1/iyzipay-init" → "iyzipay-init"
      COALESCE(
        substring(r.url FROM 'functions/v1/([^?/]+)'),
        '—'
      )::text AS fn_name,
      r.url,
      resp.status_code,
      r.created,
      LEFT(r.body::text, 200),
      LEFT(resp.content::text, 300)
    FROM net.http_request_queue r
    LEFT JOIN net._http_response resp ON resp.id = r.id
    WHERE r.url ILIKE '%/functions/v1/%'
      AND (p_fn_name IS NULL
           OR r.url ILIKE '%/functions/v1/' || p_fn_name || '%')
    ORDER BY r.created DESC
    LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_edge_function_log(text, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) EDGE FUNCTION ÖZET (fonksiyon başına çağrı/hata sayısı)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_edge_function_ozet(p_son_gun integer DEFAULT 7)
RETURNS TABLE(
  fn_name       text,
  toplam        bigint,
  basarili      bigint,
  basarisiz     bigint,
  ortalama_ms   numeric,
  son_cagri     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(substring(r.url FROM 'functions/v1/([^?/]+)'), 'bilinmeyen')::text,
      COUNT(*),
      SUM(CASE WHEN resp.status_code >= 200 AND resp.status_code < 300 THEN 1 ELSE 0 END),
      SUM(CASE WHEN resp.status_code IS NULL OR resp.status_code >= 400 THEN 1 ELSE 0 END),
      AVG(CASE WHEN resp.created IS NOT NULL AND r.created IS NOT NULL
                THEN EXTRACT(EPOCH FROM (resp.created - r.created)) * 1000
                ELSE NULL END)::numeric(10,2),
      MAX(r.created)
    FROM net.http_request_queue r
    LEFT JOIN net._http_response resp ON resp.id = r.id
    WHERE r.url ILIKE '%/functions/v1/%'
      AND r.created > now() - (p_son_gun || ' days')::interval
    GROUP BY 1
    ORDER BY COUNT(*) DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_edge_function_ozet(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) CMS İÇERİĞİ — Public Anonymous Read (HTML sayfaları için)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.icerik_getir(p_kod text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT to_jsonb(si.*) FROM public.sistem_icerikleri si WHERE si.kod = p_kod LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.icerik_getir(text) TO anon, authenticated;

COMMENT ON FUNCTION public.icerik_getir IS
  'CMS içeriği — anon dahil okur. KVKK/Şartlar HTML sayfalarının runtime çekmesi için.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Analytics:
--    SELECT admin_analytics_ozet(30);
--
-- 2) Edge function log:
--    SELECT * FROM admin_edge_function_log(NULL, 20);
--    SELECT * FROM admin_edge_function_log('iyzipay-init', 10);
--
-- 3) Edge function özet:
--    SELECT * FROM admin_edge_function_ozet(7);
--
-- 4) Public CMS:
--    SELECT icerik_getir('kvkk');
-- =============================================================================
