-- =============================================================================
-- FLEETLY  —  2026-05-11a  —  Platform Admin (Super Admin) Sistemi
-- =============================================================================
-- AÇIK:
--   Mevcut sistem multi-tenant; her firma kendi kullanıcılarını/verilerini görür.
--   Ancak sistem geneli kararlar (global limanlar, duyurular, abonelik düzeltme,
--   destek için firma adına giriş, vb.) için tüm firmaların ÜSTÜNDE bir
--   "platform admin" katmanı gerekiyor.
--
-- ÇÖZÜM:
--   • platform_adminler tablosu (user_id PK, opsiyonel notlar)
--   • _is_platform_admin() helper (SECURITY DEFINER, auth.uid bu tabloda mı?)
--   • platform_audit_log tablosu (her admin işleminin kim/ne/ne zaman kaydı)
--   • admin_log() helper — RPC'lerden çağırılır, log yazar
--   • RLS: tablolar default kapalı; sadece platform admin görür
--
-- BAĞIMLILIK: auth schema (Supabase native)
--
-- DOĞRULAMA: aşağıda. Yeni platform admin eklemek için ayrı dosya:
--   2026_05_11c__cihan_platform_admin_ekle.sql (sen Dashboard'da çalıştırırsın)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) PLATFORM ADMİNLER TABLOSU
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_adminler (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_soyad        text,
  eklenme_tarihi  timestamptz NOT NULL DEFAULT now(),
  ekleyen_user_id uuid REFERENCES auth.users(id),
  aktif           boolean NOT NULL DEFAULT true,
  notlar          text
);

CREATE INDEX IF NOT EXISTS idx_platform_adminler_aktif
  ON public.platform_adminler(user_id) WHERE aktif = true;

COMMENT ON TABLE public.platform_adminler IS
  'Platform admin (super admin) listesi. Tüm firmaların üstünde yetkili kullanıcılar. 2026_05_11a.';

ALTER TABLE public.platform_adminler ENABLE ROW LEVEL SECURITY;

-- Sadece kendisini okuyabilir (auth.uid). Diğerleri için 0 satır.
DROP POLICY IF EXISTS platform_adminler_self_select ON public.platform_adminler;
CREATE POLICY platform_adminler_self_select ON public.platform_adminler
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE: sadece platform admin (RPC üzerinden — direct yasak)
-- Tablo direkt insert/update için kapalı; aşağıdaki RPC ile yönetilir.

-- -----------------------------------------------------------------------------
-- 2) HELPER — _is_platform_admin()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_platform_admin(p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.platform_adminler
    WHERE user_id = COALESCE(p_user_id, auth.uid())
      AND aktif = true
  );
$$;

GRANT EXECUTE ON FUNCTION public._is_platform_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public._is_platform_admin IS
  'Kullanıcı platform admin mi? Default: auth.uid(). SECURITY DEFINER ile tablodaki RLS bypass eder.';

-- -----------------------------------------------------------------------------
-- 3) PLATFORM AUDIT LOG TABLOSU
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  islem_tipi      text NOT NULL,                  -- 'liman_olustur', 'firma_suspend', 'kullanici_sil', ...
  hedef_tip       text,                            -- 'liman', 'firma', 'user', 'subscription'
  hedef_id        text,                            -- uuid veya text id
  ozet            text,                            -- "Marport polygon güncellendi"
  detay           jsonb,                           -- ham veriler (eski/yeni değer, IP, vb.)
  ip              inet,
  user_agent      text,
  basarili        boolean NOT NULL DEFAULT true,
  hata_mesaji     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_zaman
  ON public.platform_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tip_zaman
  ON public.platform_audit_log(islem_tipi, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_hedef
  ON public.platform_audit_log(hedef_tip, hedef_id);
CREATE INDEX IF NOT EXISTS idx_audit_zaman
  ON public.platform_audit_log(created_at DESC);

COMMENT ON TABLE public.platform_audit_log IS
  'Platform admin işlemleri kaydı. Hangi admin, ne zaman, neyi değiştirdi. 2026_05_11a.';

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;

-- Sadece platform admin'ler okur
DROP POLICY IF EXISTS audit_log_platform_admin_read ON public.platform_audit_log;
CREATE POLICY audit_log_platform_admin_read ON public.platform_audit_log
  FOR SELECT TO authenticated
  USING (public._is_platform_admin());

-- INSERT: sadece RPC üzerinden (admin_log helper)
-- Direkt insert kapalı, RPC ile yapılır.

-- -----------------------------------------------------------------------------
-- 4) HELPER — admin_log()
-- -----------------------------------------------------------------------------
-- Diğer admin RPC'leri her başarılı/başarısız işlem için bunu çağırır.
CREATE OR REPLACE FUNCTION public.admin_log(
  p_islem_tipi text,
  p_hedef_tip  text DEFAULT NULL,
  p_hedef_id   text DEFAULT NULL,
  p_ozet       text DEFAULT NULL,
  p_detay      jsonb DEFAULT NULL,
  p_basarili   boolean DEFAULT true,
  p_hata       text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Sadece platform admin log yazabilir' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.platform_audit_log(
    user_id, islem_tipi, hedef_tip, hedef_id, ozet, detay, basarili, hata_mesaji
  )
  VALUES (
    auth.uid(), p_islem_tipi, p_hedef_tip, p_hedef_id, p_ozet, p_detay, p_basarili, p_hata
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_log(text, text, text, text, jsonb, boolean, text)
  TO authenticated;

COMMENT ON FUNCTION public.admin_log IS
  'Platform admin işlemleri için audit log yazıcısı. Sadece platform admin çağırabilir.';

-- -----------------------------------------------------------------------------
-- 5) PLATFORM ADMIN YÖNETİM RPC'LERİ
-- -----------------------------------------------------------------------------

-- 5a) Platform admin ekle (sadece mevcut platform admin yapabilir — chicken-and-egg
--     için ilk admin Dashboard SQL ile direkt INSERT eklenecek)
CREATE OR REPLACE FUNCTION public.platform_admin_ekle(
  p_user_id  uuid,
  p_ad_soyad text DEFAULT NULL,
  p_notlar   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Sadece platform admin yeni admin ekleyebilir' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id zorunlu' USING ERRCODE = '23502';
  END IF;
  INSERT INTO public.platform_adminler(user_id, ad_soyad, ekleyen_user_id, notlar)
  VALUES (p_user_id, p_ad_soyad, auth.uid(), p_notlar)
  ON CONFLICT (user_id) DO UPDATE
    SET aktif = true,
        ad_soyad = COALESCE(EXCLUDED.ad_soyad, public.platform_adminler.ad_soyad),
        notlar = COALESCE(EXCLUDED.notlar, public.platform_adminler.notlar);
  PERFORM public.admin_log(
    'platform_admin_ekle', 'user', p_user_id::text,
    'Platform admin eklendi: ' || COALESCE(p_ad_soyad, p_user_id::text),
    jsonb_build_object('user_id', p_user_id, 'ad_soyad', p_ad_soyad)
  );
  RETURN p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_admin_ekle(uuid, text, text) TO authenticated;

-- 5b) Platform admin kaldır
CREATE OR REPLACE FUNCTION public.platform_admin_kaldir(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Sadece platform admin işlem yapabilir' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Kendinizi kaldıramazsınız' USING ERRCODE = '22023';
  END IF;
  UPDATE public.platform_adminler SET aktif = false WHERE user_id = p_user_id;
  PERFORM public.admin_log(
    'platform_admin_kaldir', 'user', p_user_id::text,
    'Platform admin kaldırıldı', jsonb_build_object('user_id', p_user_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.platform_admin_kaldir(uuid) TO authenticated;

-- 5c) Platform adminleri listele
CREATE OR REPLACE FUNCTION public.platform_adminler_listele()
RETURNS TABLE(
  user_id uuid,
  email text,
  ad_soyad text,
  aktif boolean,
  eklenme_tarihi timestamptz,
  ekleyen_user_id uuid,
  notlar text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Sadece platform admin listeleyebilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT pa.user_id, u.email::text, pa.ad_soyad, pa.aktif, pa.eklenme_tarihi,
           pa.ekleyen_user_id, pa.notlar
    FROM public.platform_adminler pa
    LEFT JOIN auth.users u ON u.id = pa.user_id
    ORDER BY pa.aktif DESC, pa.eklenme_tarihi DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_adminler_listele() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) AUDIT LOG LİSTELE RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_audit_log_listele(
  p_limit       integer DEFAULT 100,
  p_offset      integer DEFAULT 0,
  p_user_id     uuid    DEFAULT NULL,
  p_islem_tipi  text    DEFAULT NULL,
  p_hedef_tip   text    DEFAULT NULL,
  p_arama       text    DEFAULT NULL
)
RETURNS TABLE(
  id           bigint,
  user_id      uuid,
  user_email   text,
  user_ad      text,
  islem_tipi   text,
  hedef_tip    text,
  hedef_id     text,
  ozet         text,
  detay        jsonb,
  basarili     boolean,
  hata_mesaji  text,
  created_at   timestamptz,
  toplam       bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_toplam bigint;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Sadece platform admin log görüntüleyebilir' USING ERRCODE = '42501';
  END IF;

  -- Toplam sayım (aynı filtre ile)
  SELECT COUNT(*) INTO v_toplam
  FROM public.platform_audit_log al
  WHERE (p_user_id IS NULL OR al.user_id = p_user_id)
    AND (p_islem_tipi IS NULL OR al.islem_tipi = p_islem_tipi)
    AND (p_hedef_tip IS NULL OR al.hedef_tip = p_hedef_tip)
    AND (p_arama IS NULL OR al.ozet ILIKE '%' || p_arama || '%');

  RETURN QUERY
    SELECT al.id, al.user_id, u.email::text, pa.ad_soyad,
           al.islem_tipi, al.hedef_tip, al.hedef_id,
           al.ozet, al.detay, al.basarili, al.hata_mesaji, al.created_at,
           v_toplam
    FROM public.platform_audit_log al
    LEFT JOIN auth.users u ON u.id = al.user_id
    LEFT JOIN public.platform_adminler pa ON pa.user_id = al.user_id
    WHERE (p_user_id IS NULL OR al.user_id = p_user_id)
      AND (p_islem_tipi IS NULL OR al.islem_tipi = p_islem_tipi)
      AND (p_hedef_tip IS NULL OR al.hedef_tip = p_hedef_tip)
      AND (p_arama IS NULL OR al.ozet ILIKE '%' || p_arama || '%')
    ORDER BY al.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_audit_log_listele(integer, integer, uuid, text, text, text)
  TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) İlk platform admin'i kendin Dashboard'dan ekle:
--    INSERT INTO public.platform_adminler(user_id, ad_soyad, notlar, ekleyen_user_id)
--    VALUES (
--      (SELECT id FROM auth.users WHERE email = 'cihan@fleetly.fit'),
--      'Cihan Özcan', 'Platform sahibi (ilk admin)',
--      (SELECT id FROM auth.users WHERE email = 'cihan@fleetly.fit')
--    );
--
-- 2) Kontrol:
--    SELECT _is_platform_admin();    -- senin oturumunda true dönmeli
--    SELECT * FROM platform_adminler_listele();
--
-- 3) Audit log yaz:
--    SELECT admin_log('test', 'system', NULL, 'İlk test logu');
--    SELECT * FROM platform_audit_log_listele(10, 0);
-- =============================================================================
