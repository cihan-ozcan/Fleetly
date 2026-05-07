-- =============================================================================
-- FLEETLY  —  2026-05-07d  —  RLS recursion fix + firma_kayit_et kolon fix
-- =============================================================================
-- Önceki migration'lardan iki bug çıktı:
--   1) firma_kullanicilar policy'si kendi tablosuna subquery yapıyordu →
--      "infinite recursion detected in policy for relation firma_kullanicilar"
--      → tüm site fonksiyonları (sürücü listesi, iş emirleri, dashboard) çöktü.
--   2) firma_kayit_et RPC'si "iletisim_tel" kolonu kullanıyordu, gerçek ad
--      firmalar.telefon → "column iletisim_tel does not exist" → yeni hesaplar
--      firma_id NULL kalıyordu.
--
-- Bu migration:
--   1) firma_kullanicilar policy'sini SADELEŞTİRİR — sadece user_id=auth.uid()
--      ile self-read. INSERT/UPDATE/DELETE policy yok (RPC SECURITY DEFINER bypass eder).
--   2) firma_kayit_et RPC'sini doğru kolon adıyla yeniden tanımlar (iletisim_tel→telefon)
--   3) Geriye dönük bağsız kullanıcıları bağlar (yeni açılan test hesabı dahil)
--
-- Bağımlılık: 2026_05_07b__rls_emergency_fix.sql, 2026_05_07c__yeni_kullanici_firma_otomatik.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) firma_kullanicilar — recursion fix
-- -----------------------------------------------------------------------------
-- Eski policy:
--   USING (user_id = auth.uid()
--          OR firma_id IN (SELECT firma_id FROM firma_kullanicilar
--                          WHERE user_id = auth.uid() AND rol IN (...)))
-- ↑ Bu kendisine subquery → her satır kontrolünde policy tekrar tetikleniyor
--   → infinite recursion (PostgreSQL 42P17 hata).
--
-- Yeni policy: SADECE kendi atamalarını görür. Yöneticilerin firma'nın diğer
-- üyelerini görmesi gerekiyorsa SECURITY DEFINER RPC ile yapılır.
DROP POLICY IF EXISTS firma_kul_v2_select ON public.firma_kullanicilar;
DROP POLICY IF EXISTS firma_kul_v2_modify ON public.firma_kullanicilar;

CREATE POLICY firma_kul_v2_select ON public.firma_kullanicilar
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE: hiç policy yok → default deny.
-- firma_kayit_et (SECURITY DEFINER) postgres rolü ile bypass eder.

-- -----------------------------------------------------------------------------
-- 2) firma_kayit_et — iletisim_tel kolonu yok, doğru ad: telefon
-- -----------------------------------------------------------------------------
-- firmalar tablo şeması (supabase_setup_v2.sql):
--   id, ad, iletisim_email, telefon, vergi_no, ...
-- "iletisim_tel" diye bir kolon HİÇ yok — yanlış varsaydım, fix:
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT oid::regprocedure::text AS sig FROM pg_proc
    WHERE proname='firma_kayit_et' AND pronamespace='public'::regnamespace
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE'; END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.firma_kayit_et(
  p_firma_adi text,
  p_email     text DEFAULT NULL,
  p_telefon   text DEFAULT NULL,
  p_vergi_no  text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_firma_id uuid;
  v_ad       text := COALESCE(NULLIF(trim(p_firma_adi), ''), 'Yeni Firma');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Oturum yok' USING ERRCODE = '42501';
  END IF;

  -- Mevcut firma var mı (sahip rolüyle)?
  SELECT firma_id INTO v_firma_id
    FROM public.firma_kullanicilar
    WHERE user_id = v_uid AND rol = 'sahip'
    LIMIT 1;

  IF v_firma_id IS NOT NULL THEN
    -- Var — adı + iletişim bilgilerini güncelle
    UPDATE public.firmalar
       SET ad             = v_ad,
           iletisim_email = COALESCE(p_email,    iletisim_email),
           telefon        = COALESCE(p_telefon,  telefon),
           vergi_no       = COALESCE(p_vergi_no, vergi_no)
     WHERE id = v_firma_id;
    RETURN v_firma_id;
  END IF;

  -- Yok — yeni firma + sahip rolü oluştur (14 gün deneme)
  INSERT INTO public.firmalar (ad, iletisim_email, telefon, vergi_no,
                                abonelik_durumu, deneme_bitis)
  VALUES (v_ad, p_email, p_telefon, p_vergi_no,
          'deneme', now() + interval '14 days')
  RETURNING id INTO v_firma_id;

  INSERT INTO public.firma_kullanicilar (user_id, firma_id, rol)
  VALUES (v_uid, v_firma_id, 'sahip')
  ON CONFLICT DO NOTHING;

  RETURN v_firma_id;
END $$;

GRANT EXECUTE ON FUNCTION public.firma_kayit_et(text, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) Geriye dönük: bağsız kullanıcıları bağla (cihanozcan1404 dahil)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_firma_id uuid;
  v_firma_adi text;
  v_email_local text;
BEGIN
  FOR r IN
    SELECT u.id, u.email, u.raw_user_meta_data
      FROM auth.users u
      LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
     WHERE fk.user_id IS NULL
       AND (u.email IS NULL OR u.email NOT LIKE '%@driver.fleetly.local')
       AND NOT EXISTS (SELECT 1 FROM public.suruculer s WHERE s.auth_user_id = u.id)
  LOOP
    v_firma_adi := NULLIF(trim(COALESCE(r.raw_user_meta_data->>'firma_adi', '')), '');
    IF v_firma_adi IS NULL THEN
      v_email_local := split_part(COALESCE(r.email, ''), '@', 1);
      v_firma_adi := CASE
        WHEN v_email_local <> '' THEN initcap(v_email_local) || ' Lojistik'
        ELSE 'Yeni Firma'
      END;
    END IF;

    INSERT INTO public.firmalar (ad, iletisim_email, abonelik_durumu, deneme_bitis)
    VALUES (v_firma_adi, r.email, 'deneme', now() + interval '14 days')
    RETURNING id INTO v_firma_id;

    INSERT INTO public.firma_kullanicilar (user_id, firma_id, rol)
    VALUES (r.id, v_firma_id, 'sahip')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Bağsız kullanıcı bağlandı: % → firma % (%)', r.email, v_firma_id, v_firma_adi;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Recursion gitti mi (basit SELECT çalışmalı):
--    SELECT count(*) FROM firma_kullanicilar;
--
-- 2) Yeni hesap firma'sı bağlandı mı:
--    SELECT u.email, fk.firma_id, fk.rol, f.ad
--      FROM auth.users u
--      LEFT JOIN firma_kullanicilar fk ON fk.user_id = u.id
--      LEFT JOIN firmalar f ON f.id = fk.firma_id
--     ORDER BY u.created_at DESC LIMIT 5;
--
-- 3) RPC sorunsuz çalışıyor mu (yeni kullanıcı login → ilk login'de
--    checkSubscription firma_kayit_et çağırır, "iletisim_tel" hatası gelmez):
--    SELECT firma_kayit_et('Test Firma', 'test@example.com', '0500', '12345');
-- =============================================================================
