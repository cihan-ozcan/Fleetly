-- =============================================================================
-- FLEETLY  —  2026-05-06c  —  sofor_konum_gonder OVERLOAD FIX
-- =============================================================================
-- Hata (mobil log):
--   "Could not choose the best candidate function between:
--    public.sofor_konum_gonder(..., p_dogruluk => double precision, ...),
--    public.sofor_konum_gonder(..., p_dogruluk => numeric, ...)"
--
-- Sebep: DB içinde iki sürüm bir arada (eski numeric + yeni double precision).
-- CREATE OR REPLACE FUNCTION imzaları farklı olduğunda eskiyi silmez, yenisini
-- ekler — overload kalır, PostgREST seçim yapamaz.
--
-- Çözüm: aynı isimli tüm sürümleri DROP edip tek (canonical) sürümü yeniden tanımla.
-- Geri alma: bu migration'ı çalıştırmadan önceki şema iki overload'lı haldedir;
-- istenirse eski script'ten elle yeniden eklenebilir, ama mantık olarak gerekli değil.
-- =============================================================================

BEGIN;

-- ---- 1) Mevcut tüm overload'ları kaldır ----------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname = 'sofor_konum_gonder'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- ---- 2) Canonical sürümü yeniden oluştur ---------------------------------
-- 2026_04_29__konum_izleri_guzergah.sql ile aynı imza/davranış.
CREATE OR REPLACE FUNCTION public.sofor_konum_gonder(
  p_lat       double precision,
  p_lng       double precision,
  p_dogruluk  double precision DEFAULT NULL,
  p_hiz       numeric          DEFAULT NULL,
  p_batarya   integer          DEFAULT NULL,
  p_is_emri   bigint           DEFAULT NULL,
  p_tip       text             DEFAULT 'auto'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_ize_id bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  INSERT INTO public.konum_izleri
    (is_emri_id, lat, lng, hiz, dogruluk, tip, batarya, user_id, ts)
  VALUES
    (p_is_emri, p_lat, p_lng, p_hiz, p_dogruluk,
     COALESCE(p_tip, 'auto'), p_batarya, v_uid, now())
  RETURNING id INTO v_ize_id;

  IF p_is_emri IS NOT NULL THEN
    UPDATE public.is_emirleri
       SET konum_lat   = p_lat,
           konum_lng   = p_lng,
           konum_zaman = now()
     WHERE id = p_is_emri
       AND (sofor_user_id = v_uid OR user_id = v_uid OR firma_id IN (
             SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = v_uid
           ));
  END IF;

  RETURN v_ize_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sofor_konum_gonder(
  double precision, double precision, double precision, numeric,
  integer, bigint, text
) TO authenticated;

COMMENT ON FUNCTION public.sofor_konum_gonder IS
  'Şoför konum kayıt RPC (canonical sürüm). 2026_05_06c overload fix sonrası tek imza.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Sadece bir sürüm kaldı mı:
--    SELECT oid::regprocedure FROM pg_proc
--    WHERE proname = 'sofor_konum_gonder'
--      AND pronamespace = 'public'::regnamespace;
--
-- 2) Mobil log'daki hata kaybolmalı; uygulamayı yeniden başlat.
-- =============================================================================
