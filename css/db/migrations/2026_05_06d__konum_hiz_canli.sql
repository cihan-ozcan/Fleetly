-- =============================================================================
-- FLEETLY  —  2026-05-06d  —  Canlı hız göstergesi
-- =============================================================================
-- Şoförün anlık hızı (km/sa) yönetici operasyon panelinde ve mobil iş emri
-- ekranında Google Maps / Yandex stilinde gösterilsin.
--
-- Yapı:
--   1) is_emirleri.konum_hiz numeric  — anlık hız snapshot'ı (km/sa)
--   2) sofor_konum_gonder RPC güncelleniyor → is_emirleri.konum_hiz da UPDATE edilir
--      (konum_izleri.hiz zaten m/s — RPC'de km/sa'ya çeviriyoruz: hiz_ms × 3.6)
--
-- Bağımlılık: 2026_05_06c__sofor_konum_gonder_overload_fix.sql (canonical RPC)
-- Geri alma: kolon DROP, RPC önceki sürüme geri alınabilir.
-- =============================================================================

BEGIN;

-- ---- 1) Yeni kolon ----------------------------------------------------------
ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS konum_hiz numeric;

COMMENT ON COLUMN public.is_emirleri.konum_hiz IS
  'Şoförün son konum sample''ındaki hız (km/sa). sofor_konum_gonder RPC günceller. Realtime üzerinden web/mobil dinler.';

-- ---- 2) RPC: hız da UPDATE edilsin -----------------------------------------
-- 2026_05_06c'deki canonical sürümü hız ile genişletiyoruz.
CREATE OR REPLACE FUNCTION public.sofor_konum_gonder(
  p_lat       double precision,
  p_lng       double precision,
  p_dogruluk  double precision DEFAULT NULL,
  p_hiz       numeric          DEFAULT NULL,   -- m/s — Android Location.speed alanı
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
  v_kmh    numeric;
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

  -- m/s → km/sa (negatif/anlamsız değerleri sıfıra al)
  v_kmh := CASE
    WHEN p_hiz IS NULL THEN NULL
    WHEN p_hiz < 0 THEN 0
    ELSE ROUND((p_hiz * 3.6)::numeric, 1)
  END;

  IF p_is_emri IS NOT NULL THEN
    UPDATE public.is_emirleri
       SET konum_lat   = p_lat,
           konum_lng   = p_lng,
           konum_zaman = now(),
           konum_hiz   = v_kmh
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

COMMIT;
