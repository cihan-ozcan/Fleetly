-- =============================================================================
-- FLEETLY  —  2026-05-11h  —  Aşama 4 RPC Paketi (Sistem Sağlık)
-- =============================================================================
-- AÇIK:
--   Platform admin paneli Aşama 4 için DB-level monitoring RPC'leri:
--     • App Errors (frontend/mobile hata logu) — listele, detay, çözümle
--     • pg_cron jobları — liste + son çalışmalar
--     • Storage bucket kullanımı — boyut + dosya sayısı
--     • DB tablo boyutları + genel istatistikler
--
-- BAĞIMLILIK: 2026_05_11a (helper'lar), pg_cron extension (Supabase aktif),
--             storage schema (Supabase native)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) APP ERRORS — LİSTELE (tüm firmalar, platform admin görür)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_app_errors_listele(
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0,
  p_arama       text    DEFAULT NULL,
  p_severity    text    DEFAULT NULL,   -- 'error','warn','info'
  p_platform    text    DEFAULT NULL,   -- 'web','android'
  p_resolved    text    DEFAULT NULL,   -- 'true','false', NULL=tümü
  p_firma_id    uuid    DEFAULT NULL,
  p_son_gun     integer DEFAULT 30      -- son N gün
)
RETURNS TABLE(
  id            bigint,
  firma_id      uuid,
  firma_ad      text,
  user_id       uuid,
  user_email    text,
  platform      text,
  severity      text,
  message       text,
  source        text,
  url           text,
  resolved      boolean,
  resolved_at   timestamptz,
  resolved_note text,
  created_at    timestamptz,
  toplam        bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_toplam bigint;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_toplam FROM public.app_errors ae
    LEFT JOIN public.firmalar f ON f.id = ae.firma_id
   WHERE (p_arama IS NULL
            OR ae.message ILIKE '%' || p_arama || '%'
            OR ae.source  ILIKE '%' || p_arama || '%'
            OR ae.url     ILIKE '%' || p_arama || '%')
     AND (p_severity IS NULL OR ae.severity = p_severity)
     AND (p_platform IS NULL OR ae.platform = p_platform)
     AND (p_resolved IS NULL
            OR (p_resolved = 'true'  AND ae.resolved = true)
            OR (p_resolved = 'false' AND ae.resolved = false))
     AND (p_firma_id IS NULL OR ae.firma_id = p_firma_id)
     AND (p_son_gun IS NULL OR ae.created_at > now() - (p_son_gun || ' days')::interval);

  RETURN QUERY
    SELECT
      ae.id, ae.firma_id, f.ad AS firma_ad,
      ae.user_id, ae.user_email,
      ae.platform, ae.severity,
      ae.message, ae.source, ae.url,
      ae.resolved, ae.resolved_at, ae.resolved_note,
      ae.created_at,
      v_toplam
    FROM public.app_errors ae
    LEFT JOIN public.firmalar f ON f.id = ae.firma_id
    WHERE (p_arama IS NULL
             OR ae.message ILIKE '%' || p_arama || '%'
             OR ae.source  ILIKE '%' || p_arama || '%'
             OR ae.url     ILIKE '%' || p_arama || '%')
      AND (p_severity IS NULL OR ae.severity = p_severity)
      AND (p_platform IS NULL OR ae.platform = p_platform)
      AND (p_resolved IS NULL
             OR (p_resolved = 'true'  AND ae.resolved = true)
             OR (p_resolved = 'false' AND ae.resolved = false))
      AND (p_firma_id IS NULL OR ae.firma_id = p_firma_id)
      AND (p_son_gun IS NULL OR ae.created_at > now() - (p_son_gun || ' days')::interval)
    ORDER BY ae.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_app_errors_listele(integer, integer, text, text, text, text, uuid, integer)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) APP ERROR — DETAY
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_app_error_detay(p_id bigint)
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

  SELECT to_jsonb(ae.*) || jsonb_build_object(
    'firma_ad', (SELECT ad FROM public.firmalar WHERE id = ae.firma_id),
    'benzer_sayi', (
      SELECT COUNT(*) FROM public.app_errors
      WHERE message = ae.message AND id != ae.id
        AND created_at > now() - interval '30 days'
    )
  ) INTO v_result
  FROM public.app_errors ae
  WHERE ae.id = p_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Hata kaydı bulunamadı: %', p_id USING ERRCODE = '02000';
  END IF;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_app_error_detay(bigint) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) APP ERROR — RESOLVE (çözüldü işaretle)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_app_error_resolve(
  p_id   bigint,
  p_note text DEFAULT NULL
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
  UPDATE public.app_errors
     SET resolved = true,
         resolved_at = now(),
         resolved_by = auth.uid(),
         resolved_note = p_note
   WHERE id = p_id;
  PERFORM public.admin_log(
    'app_error_resolve', 'app_error', p_id::text,
    'Hata çözüldü işaretlendi #' || p_id,
    jsonb_build_object('id', p_id, 'note', p_note)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_app_error_resolve(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_app_error_toplu_resolve(
  p_ids  bigint[],
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_errors
     SET resolved = true,
         resolved_at = now(),
         resolved_by = auth.uid(),
         resolved_note = COALESCE(p_note, 'Toplu çözüm')
   WHERE id = ANY(p_ids) AND resolved = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.admin_log(
    'app_error_toplu_resolve', 'app_error', NULL,
    v_count || ' hata toplu çözüldü',
    jsonb_build_object('count', v_count, 'ids', p_ids, 'note', p_note)
  );
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_app_error_toplu_resolve(bigint[], text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) APP ERRORS — ÖZET İSTATİSTİKLER
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_app_errors_ozet(p_son_gun integer DEFAULT 7)
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
    'toplam',           (SELECT COUNT(*) FROM public.app_errors WHERE created_at > now() - (p_son_gun || ' days')::interval),
    'cozulmemis',       (SELECT COUNT(*) FROM public.app_errors WHERE resolved = false AND created_at > now() - (p_son_gun || ' days')::interval),
    'error',            (SELECT COUNT(*) FROM public.app_errors WHERE severity = 'error' AND created_at > now() - (p_son_gun || ' days')::interval),
    'warn',             (SELECT COUNT(*) FROM public.app_errors WHERE severity = 'warn'  AND created_at > now() - (p_son_gun || ' days')::interval),
    'web',              (SELECT COUNT(*) FROM public.app_errors WHERE platform = 'web'     AND created_at > now() - (p_son_gun || ' days')::interval),
    'android',          (SELECT COUNT(*) FROM public.app_errors WHERE platform = 'android' AND created_at > now() - (p_son_gun || ' days')::interval),
    'son_24sa',         (SELECT COUNT(*) FROM public.app_errors WHERE created_at > now() - interval '24 hours'),
    'gunluk_trend', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.gun), '[]'::jsonb)
      FROM (
        SELECT
          to_char(d, 'YYYY-MM-DD') AS gun,
          (SELECT COUNT(*) FROM public.app_errors
            WHERE date_trunc('day', created_at) = d) AS toplam,
          (SELECT COUNT(*) FROM public.app_errors
            WHERE date_trunc('day', created_at) = d AND severity = 'error') AS error
        FROM generate_series(
          (now() - (p_son_gun || ' days')::interval)::date,
          now()::date,
          '1 day'
        ) d
      ) t
    ),
    'en_sik_mesajlar', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'message', message, 'sayi', sayi
      ) ORDER BY sayi DESC), '[]'::jsonb)
      FROM (
        SELECT message, COUNT(*) AS sayi FROM public.app_errors
        WHERE created_at > now() - (p_son_gun || ' days')::interval
        GROUP BY message
        ORDER BY COUNT(*) DESC
        LIMIT 10
      ) m
    )
  ) INTO v_result;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_app_errors_ozet(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) CRON JOB'LAR — LİSTELE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cron_joblari()
RETURNS TABLE(
  jobid        bigint,
  schedule     text,
  command      text,
  jobname      text,
  active       boolean,
  son_calisma  timestamptz,
  son_durum    text,
  son_hata     text,
  toplam_calisma  bigint,
  toplam_hata     bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  -- pg_cron extension yoksa boş döner
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      j.jobid,
      j.schedule,
      j.command,
      j.jobname,
      j.active,
      (SELECT MAX(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid),
      (SELECT d.status FROM cron.job_run_details d
        WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1),
      (SELECT d.return_message FROM cron.job_run_details d
        WHERE d.jobid = j.jobid AND d.status = 'failed'
        ORDER BY d.start_time DESC LIMIT 1),
      (SELECT COUNT(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid),
      (SELECT COUNT(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'failed')
    FROM cron.job j
    ORDER BY j.jobid;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_cron_joblari() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) CRON JOB — SON ÇALIŞMALAR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cron_son_calismalar(
  p_jobid bigint DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  runid          bigint,
  jobid          bigint,
  jobname        text,
  start_time     timestamptz,
  end_time       timestamptz,
  status         text,
  return_message text,
  command        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      d.runid, d.jobid, j.jobname,
      d.start_time, d.end_time, d.status, d.return_message,
      j.command
    FROM cron.job_run_details d
    LEFT JOIN cron.job j ON j.jobid = d.jobid
    WHERE (p_jobid IS NULL OR d.jobid = p_jobid)
    ORDER BY d.start_time DESC
    LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_cron_son_calismalar(bigint, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) STORAGE BUCKET KULLANIMI
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_storage_bucket_kullanim()
RETURNS TABLE(
  bucket_id     text,
  public_mi     boolean,
  dosya_sayisi  bigint,
  toplam_byte   bigint,
  ortalama_byte numeric,
  son_yukleme   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      b.id::text,
      b.public,
      COALESCE(s.dosya_sayisi, 0),
      COALESCE(s.toplam_byte, 0),
      CASE WHEN COALESCE(s.dosya_sayisi, 0) > 0
        THEN ROUND((COALESCE(s.toplam_byte, 0)::numeric / s.dosya_sayisi), 0)
        ELSE 0
      END,
      s.son_yukleme
    FROM storage.buckets b
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS dosya_sayisi,
        SUM(COALESCE((metadata->>'size')::bigint, 0)) AS toplam_byte,
        MAX(created_at) AS son_yukleme
      FROM storage.objects
      WHERE bucket_id = b.id
    ) s ON true
    ORDER BY s.toplam_byte DESC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_storage_bucket_kullanim() TO authenticated;

-- -----------------------------------------------------------------------------
-- 8) DB TABLO BOYUTLARI
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_db_tablo_boyutlari(
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  schema_adi   text,
  tablo_adi    text,
  toplam_byte  bigint,
  index_byte   bigint,
  toast_byte   bigint,
  table_byte   bigint,
  satir_yaklasik bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      t.table_schema::text,
      t.table_name::text,
      pg_total_relation_size((t.table_schema||'.'||t.table_name)::regclass),
      pg_indexes_size((t.table_schema||'.'||t.table_name)::regclass),
      COALESCE(
        (SELECT pg_total_relation_size(reltoastrelid)
         FROM pg_class
         WHERE oid = (t.table_schema||'.'||t.table_name)::regclass
           AND reltoastrelid <> 0),
        0
      )::bigint,
      pg_relation_size((t.table_schema||'.'||t.table_name)::regclass),
      (SELECT n_live_tup FROM pg_stat_user_tables
       WHERE schemaname = t.table_schema AND relname = t.table_name)
    FROM information_schema.tables t
    WHERE t.table_schema IN ('public', 'auth', 'storage')
      AND t.table_type = 'BASE TABLE'
    ORDER BY pg_total_relation_size((t.table_schema||'.'||t.table_name)::regclass) DESC
    LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_db_tablo_boyutlari(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9) DB GENEL İSTATİSTİKLER
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_db_stats()
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
    'db_boyut',          pg_database_size(current_database()),
    'db_boyut_pretty',   pg_size_pretty(pg_database_size(current_database())),
    'tablo_sayisi',      (SELECT COUNT(*) FROM information_schema.tables
                          WHERE table_schema IN ('public','auth','storage')
                            AND table_type = 'BASE TABLE'),
    'view_sayisi',       (SELECT COUNT(*) FROM information_schema.views
                          WHERE table_schema = 'public'),
    'fonksiyon_sayisi',  (SELECT COUNT(*) FROM information_schema.routines
                          WHERE routine_schema = 'public'),
    'aktif_baglanti',    (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'),
    'toplam_baglanti',   (SELECT COUNT(*) FROM pg_stat_activity),
    'uzun_sorgu_sayisi', (SELECT COUNT(*) FROM pg_stat_activity
                           WHERE state = 'active' AND now() - query_start > interval '5 seconds'),
    'extensions', (
      SELECT COALESCE(jsonb_agg(extname ORDER BY extname), '[]'::jsonb)
      FROM pg_extension
    )
  ) INTO v_result;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_db_stats() TO authenticated;

-- -----------------------------------------------------------------------------
-- 10) E-POSTA GÖNDERIM TARİHÇESİ
-- -----------------------------------------------------------------------------
-- Mevcut _email_gonder pg_net üzerinden send-email function'ını çağırıyor;
-- log'lar pg_net.http_request_queue tablosunda. Burada özetleyelim.
CREATE OR REPLACE FUNCTION public.admin_email_gonderim_son(p_limit integer DEFAULT 50)
RETURNS TABLE(
  request_id    bigint,
  url           text,
  status_code   integer,
  created_at    timestamptz,
  body_preview  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  -- pg_net extension yoksa boş döner
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      r.id,
      r.url,
      resp.status_code,
      r.created,
      LEFT(r.body::text, 200)
    FROM net.http_request_queue r
    LEFT JOIN net._http_response resp ON resp.id = r.id
    WHERE r.url ILIKE '%send-email%'
    ORDER BY r.created DESC
    LIMIT p_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_email_gonderim_son(integer) TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) App errors:
--   SELECT * FROM admin_app_errors_listele(10, 0);
--   SELECT admin_app_errors_ozet(7);
--
-- 2) Cron:
--   SELECT * FROM admin_cron_joblari();
--   SELECT * FROM admin_cron_son_calismalar(NULL, 20);
--
-- 3) Storage:
--   SELECT * FROM admin_storage_bucket_kullanim();
--
-- 4) DB:
--   SELECT * FROM admin_db_tablo_boyutlari(10);
--   SELECT admin_db_stats();
-- =============================================================================
