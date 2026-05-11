-- =============================================================================
-- FLEETLY  —  2026-05-11e  —  Aşama 2 RPC Paketi (kullanıcı/şoför/abonelik aksiyonları)
-- =============================================================================
-- AÇIK:
--   Platform admin paneli Aşama 2 — kullanıcı/şoför/abonelik üzerinde
--   aksiyon alma yetenekleri:
--     • Kullanıcı detay (firmaları, sürücülüğü, push token, son IP)
--     • Kullanıcı ban / unban / email confirm / sil
--     • Şoför listele / detay / durum_degistir / sil
--     • Abonelik listele / iptal / iade kaydet
--
-- NOT:
--   Şifre sıfırlama + Impersonation ayrı Edge Function ile yapılır
--   (admin-password-reset, admin-impersonate) — service_role gerekli.
--   Bu migration sadece DB-level aksiyonlar.
--
-- BAĞIMLILIK: 2026_05_11a, 2026_05_11d
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) KULLANICI: DETAY
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_detay(p_user_id uuid)
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
    'user', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'phone', u.phone,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'email_confirmed_at', u.email_confirmed_at,
      'phone_confirmed_at', u.phone_confirmed_at,
      'banned_until', u.banned_until,
      'raw_user_meta_data', u.raw_user_meta_data,
      'raw_app_meta_data', u.raw_app_meta_data,
      'is_platform_admin', public._is_platform_admin(u.id)
    ),
    'firmalar', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'firma_id', fk.firma_id,
        'firma_ad', f.ad,
        'rol', fk.rol,
        'abonelik_durumu', f.abonelik_durumu,
        'suspended', COALESCE(f.suspended, false)
      )), '[]'::jsonb)
      FROM public.firma_kullanicilar fk
      LEFT JOIN public.firmalar f ON f.id = fk.firma_id
      WHERE fk.user_id = p_user_id
    ),
    'surucu', (
      SELECT to_jsonb(s.*)
      FROM public.suruculer s
      WHERE s.auth_user_id = p_user_id
      LIMIT 1
    ),
    'son_giris_kayitlari', (
      -- auth.audit_log_entries varsa son 10 olay
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ip', ip_address::text,
        'action', payload->>'action',
        'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM auth.audit_log_entries
        WHERE (payload->>'actor_id')::uuid = p_user_id
        ORDER BY created_at DESC LIMIT 10
      ) ale
    )
  ) INTO v_result
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Kullanıcı bulunamadı: %', p_user_id USING ERRCODE = '02000';
  END IF;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_user_detay(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) KULLANICI: BAN / UNBAN
-- -----------------------------------------------------------------------------
-- auth.users.banned_until UPDATE — SECURITY DEFINER ile auth schema'ya yazma yetkisi
CREATE OR REPLACE FUNCTION public.admin_user_ban(
  p_user_id uuid,
  p_until   timestamptz DEFAULT NULL,   -- NULL = sınırsız (uzak gelecek)
  p_neden   text        DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Kendinizi banlayamazsınız' USING ERRCODE = '22023';
  END IF;
  IF public._is_platform_admin(p_user_id) THEN
    RAISE EXCEPTION 'Başka bir platform admin banlanamaz. Önce admin yetkisini kaldırın.' USING ERRCODE = '22023';
  END IF;

  UPDATE auth.users
     SET banned_until = COALESCE(p_until, now() + interval '100 years')
   WHERE id = p_user_id
   RETURNING email INTO v_email;

  PERFORM public.admin_log(
    'user_ban', 'user', p_user_id::text,
    'Kullanıcı banlandı: ' || COALESCE(v_email, p_user_id::text)
      || COALESCE(' (' || to_char(p_until, 'YYYY-MM-DD') || '''e kadar)', ' (kalıcı)'),
    jsonb_build_object('user_id', p_user_id, 'email', v_email, 'until', p_until, 'neden', p_neden)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_user_ban(uuid, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_user_unban(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE v_email text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users SET banned_until = NULL WHERE id = p_user_id
    RETURNING email INTO v_email;

  PERFORM public.admin_log(
    'user_unban', 'user', p_user_id::text,
    'Ban kaldırıldı: ' || COALESCE(v_email, p_user_id::text),
    jsonb_build_object('user_id', p_user_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_user_unban(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) KULLANICI: EMAIL CONFIRM (manuel doğrulama)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_email_confirm(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE v_email text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
     SET email_confirmed_at = COALESCE(email_confirmed_at, now())
   WHERE id = p_user_id
   RETURNING email INTO v_email;

  PERFORM public.admin_log(
    'user_email_confirm', 'user', p_user_id::text,
    'E-posta manuel doğrulandı: ' || COALESCE(v_email, p_user_id::text),
    jsonb_build_object('user_id', p_user_id, 'email', v_email)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_user_email_confirm(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) KULLANICI: SİL (KVKK uyumlu — cascade yapar)
-- -----------------------------------------------------------------------------
-- auth.users DELETE → cascade ile firma_kullanicilar, suruculer (auth_user_id NULL'a set),
-- diğer tablolar (ON DELETE CASCADE veya SET NULL). Auth schema'ya DELETE yetkisi
-- SECURITY DEFINER ile.
CREATE OR REPLACE FUNCTION public.admin_user_sil(
  p_user_id uuid,
  p_neden   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_email text;
  v_admin boolean;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Kendinizi silemezsiniz' USING ERRCODE = '22023';
  END IF;
  v_admin := public._is_platform_admin(p_user_id);
  IF v_admin THEN
    RAISE EXCEPTION 'Başka bir platform admin silinemez. Önce admin yetkisini kaldırın.' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;

  -- Önce log yaz (DELETE sonrası user_id geçersiz olabilir — ama admin_log auth.uid() yazar, sorun değil)
  PERFORM public.admin_log(
    'user_sil', 'user', p_user_id::text,
    'Kullanıcı silindi: ' || COALESCE(v_email, p_user_id::text),
    jsonb_build_object('user_id', p_user_id, 'email', v_email, 'neden', p_neden)
  );

  -- Cascade silme: auth.users DELETE → FK'lar ON DELETE CASCADE veya SET NULL
  DELETE FROM auth.users WHERE id = p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_user_sil(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) ŞOFÖR: LİSTELE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_suruculer_listele(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_arama   text    DEFAULT NULL,
  p_durum   text    DEFAULT NULL,    -- 'aktif', 'pasif', 'davet_bekliyor'
  p_firma_id uuid   DEFAULT NULL
)
RETURNS TABLE(
  id              uuid,
  firma_id        uuid,
  firma_ad        text,
  auth_user_id    uuid,
  auth_email      text,
  ad              text,
  soyad           text,
  telefon         text,
  email           text,
  durum           text,
  son_giris       timestamptz,
  kayit_tarihi    timestamptz,
  belge_sayisi    integer,
  toplam          bigint
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

  SELECT COUNT(*) INTO v_toplam FROM public.suruculer s
    LEFT JOIN public.firmalar f ON f.id = s.firma_id
   WHERE s.durum <> 'silindi'
     AND (p_arama IS NULL OR s.ad ILIKE '%' || p_arama || '%'
                          OR s.soyad ILIKE '%' || p_arama || '%'
                          OR s.telefon_e164 ILIKE '%' || p_arama || '%'
                          OR f.ad ILIKE '%' || p_arama || '%')
     AND (p_durum IS NULL OR s.durum = p_durum)
     AND (p_firma_id IS NULL OR s.firma_id = p_firma_id);

  RETURN QUERY
    SELECT
      s.id, s.firma_id, f.ad AS firma_ad,
      s.auth_user_id, u.email::text AS auth_email,
      s.ad, s.soyad,
      s.telefon_e164, s.email,
      s.durum,
      s.son_giris, s.created_at,
      (SELECT COUNT(*)::int FROM public.surucu_belgeler sb WHERE sb.surucu_id = s.id),
      v_toplam
    FROM public.suruculer s
    LEFT JOIN public.firmalar f ON f.id = s.firma_id
    LEFT JOIN auth.users u ON u.id = s.auth_user_id
    WHERE s.durum <> 'silindi'
      AND (p_arama IS NULL OR s.ad ILIKE '%' || p_arama || '%'
                            OR s.soyad ILIKE '%' || p_arama || '%'
                            OR s.telefon_e164 ILIKE '%' || p_arama || '%'
                            OR f.ad ILIKE '%' || p_arama || '%')
      AND (p_durum IS NULL OR s.durum = p_durum)
      AND (p_firma_id IS NULL OR s.firma_id = p_firma_id)
    ORDER BY s.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_suruculer_listele(integer, integer, text, text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) ŞOFÖR: DETAY
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_surucu_detay(p_surucu_id uuid)
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
    'surucu', to_jsonb(s.*),
    'firma',  to_jsonb(f.*),
    'belgeler', (
      SELECT COALESCE(jsonb_agg(to_jsonb(sb.*) ORDER BY sb.bitis_tarihi NULLS LAST), '[]'::jsonb)
      FROM public.surucu_belgeler sb WHERE sb.surucu_id = p_surucu_id
    ),
    'son_seferler', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ie.id,
        'tarih', ie.created_at,
        'durum', ie.durum,
        'musteri', ie.musteri_adi,
        'yukle', ie.yukle_yeri,
        'teslim', ie.teslim_yeri
      ) ORDER BY ie.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.is_emirleri
        WHERE sofor_tel = (SELECT telefon_e164 FROM public.suruculer WHERE id = p_surucu_id)
        ORDER BY created_at DESC LIMIT 10
      ) ie
    )
  ) INTO v_result
  FROM public.suruculer s
  LEFT JOIN public.firmalar f ON f.id = s.firma_id
  WHERE s.id = p_surucu_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Şoför bulunamadı: %', p_surucu_id USING ERRCODE = '02000';
  END IF;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_surucu_detay(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) ŞOFÖR: DURUM DEĞİŞTİR (aktif / pasif / silindi)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_surucu_durum_degistir(
  p_surucu_id uuid,
  p_durum     text,
  p_neden     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_ad text; v_eski text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  IF p_durum NOT IN ('aktif','pasif','silindi','davet_bekliyor') THEN
    RAISE EXCEPTION 'Geçersiz durum: %', p_durum USING ERRCODE = '22023';
  END IF;

  SELECT TRIM(BOTH FROM ad || ' ' || COALESCE(soyad,'')), durum
    INTO v_ad, v_eski
    FROM public.suruculer WHERE id = p_surucu_id;

  UPDATE public.suruculer SET durum = p_durum, updated_at = now()
   WHERE id = p_surucu_id;

  PERFORM public.admin_log(
    'surucu_durum_degistir', 'surucu', p_surucu_id::text,
    v_ad || ': ' || v_eski || ' → ' || p_durum,
    jsonb_build_object('surucu_id', p_surucu_id, 'eski', v_eski, 'yeni', p_durum, 'neden', p_neden)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_surucu_durum_degistir(uuid, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8) ABONELİK: LİSTELE (firmalardan derler)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_abonelikler_listele(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_arama   text    DEFAULT NULL,
  p_durum   text    DEFAULT NULL    -- aktif, deneme, suresi_dolmus, iptal, odeme_bekliyor
)
RETURNS TABLE(
  firma_id        uuid,
  firma_ad        text,
  iletisim_email  text,
  plan            text,
  durum           text,
  deneme_bitis    timestamptz,
  bitis_tarihi    timestamptz,
  kalan_gun       integer,
  son_odeme_tarihi timestamptz,
  son_odeme_tutar numeric,
  son_odeme_durum text,
  toplam          bigint
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

  SELECT COUNT(*) INTO v_toplam FROM public.firmalar f
   WHERE (p_arama IS NULL OR f.ad ILIKE '%' || p_arama || '%' OR f.iletisim_email ILIKE '%' || p_arama || '%')
     AND (p_durum IS NULL OR f.abonelik_durumu = p_durum);

  RETURN QUERY
    SELECT
      f.id,
      f.ad,
      f.iletisim_email,
      f.abonelik_plani,
      f.abonelik_durumu,
      f.deneme_bitis,
      f.abonelik_bitis,
      CASE
        WHEN f.abonelik_durumu = 'aktif' AND f.abonelik_bitis > now()
          THEN EXTRACT(DAY FROM f.abonelik_bitis - now())::int
        WHEN f.abonelik_durumu = 'deneme' AND f.deneme_bitis > now()
          THEN EXTRACT(DAY FROM f.deneme_bitis - now())::int
        ELSE 0
      END AS kalan_gun,
      (SELECT og.created_at FROM public.odeme_gecmisi og
        WHERE og.firma_id = f.id AND og.durum = 'basarili'
        ORDER BY og.created_at DESC LIMIT 1),
      (SELECT og.tutar FROM public.odeme_gecmisi og
        WHERE og.firma_id = f.id AND og.durum = 'basarili'
        ORDER BY og.created_at DESC LIMIT 1),
      (SELECT og.durum FROM public.odeme_gecmisi og
        WHERE og.firma_id = f.id
        ORDER BY og.created_at DESC LIMIT 1),
      v_toplam
    FROM public.firmalar f
    WHERE (p_arama IS NULL OR f.ad ILIKE '%' || p_arama || '%' OR f.iletisim_email ILIKE '%' || p_arama || '%')
      AND (p_durum IS NULL OR f.abonelik_durumu = p_durum)
    ORDER BY
      CASE WHEN f.abonelik_durumu = 'aktif' THEN 0
           WHEN f.abonelik_durumu = 'odeme_bekliyor' THEN 1
           WHEN f.abonelik_durumu = 'deneme' THEN 2
           WHEN f.abonelik_durumu = 'suresi_dolmus' THEN 3
           ELSE 4 END,
      f.abonelik_bitis DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_abonelikler_listele(integer, integer, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9) ABONELİK: İPTAL (manuel)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_abonelik_iptal(
  p_firma_id uuid,
  p_neden    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_eski text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  SELECT abonelik_durumu INTO v_eski FROM public.firmalar WHERE id = p_firma_id;

  UPDATE public.firmalar
     SET abonelik_durumu = 'iptal'
   WHERE id = p_firma_id;

  PERFORM public.admin_log(
    'abonelik_iptal', 'firma', p_firma_id::text,
    'Abonelik manuel iptal edildi',
    jsonb_build_object('firma_id', p_firma_id, 'eski_durum', v_eski, 'neden', p_neden)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_abonelik_iptal(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 10) ABONELİK: İADE KAYDI (manual refund — iyzipay'i tetiklemez, sadece log)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_abonelik_iade(
  p_firma_id uuid,
  p_odeme_id uuid DEFAULT NULL,
  p_tutar    numeric DEFAULT NULL,
  p_neden    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_odeme_tutar numeric;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;

  IF p_odeme_id IS NOT NULL THEN
    UPDATE public.odeme_gecmisi
       SET durum = 'iade',
           hata_mesaji = COALESCE(hata_mesaji || ' | ', '') || 'Manuel iade: ' || COALESCE(p_neden, '—')
     WHERE id = p_odeme_id AND firma_id = p_firma_id
     RETURNING tutar INTO v_odeme_tutar;
  END IF;

  PERFORM public.admin_log(
    'abonelik_iade', 'firma', p_firma_id::text,
    'Manuel iade kaydı' || COALESCE(' (' || COALESCE(p_tutar, v_odeme_tutar)::text || ' TL)', ''),
    jsonb_build_object(
      'firma_id', p_firma_id,
      'odeme_id', p_odeme_id,
      'tutar', COALESCE(p_tutar, v_odeme_tutar),
      'neden', p_neden
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_abonelik_iade(uuid, uuid, numeric, text) TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- Kullanıcı:
--   SELECT admin_user_detay((SELECT id FROM auth.users LIMIT 1));
--
-- Şoför:
--   SELECT * FROM admin_suruculer_listele(10, 0);
--   SELECT admin_surucu_detay((SELECT id FROM suruculer LIMIT 1));
--
-- Abonelik:
--   SELECT * FROM admin_abonelikler_listele(10, 0);
-- =============================================================================
