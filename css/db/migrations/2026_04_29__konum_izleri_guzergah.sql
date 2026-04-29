-- =============================================================================
-- FLEETLY  —  2026-04-29  —  Konum İzleri (Güzergah Kaydı)
-- =============================================================================
-- Amaç: Şoför iş emrini "Yolda" yaparken her GPS güncellemesini konum_izleri'ne
-- kaydet. Operasyon/yönetim sonradan haritada güzergahı görsün.
--
-- Tablo zaten mevcut (id, is_emri_id, lat, lng, hiz, ts, user_id, dogruluk,
-- tip, batarya). Bu migration:
--   • Performans için index'ler
--   • RLS politikaları (sürücü kendi izini yazar, firma operasyon okur)
--   • sofor_konum_gonder RPC (chunk-06.js bunu çağırıyor)
--   • is_emri_guzergah_ozet view (OPS drawer için hızlı özet)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Index'ler — drawer "is_emri_id ile sırala by ts" sorgusu hızlı olsun
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_konum_izleri_is_emri_ts
  ON public.konum_izleri (is_emri_id, ts);

CREATE INDEX IF NOT EXISTS idx_konum_izleri_user_ts
  ON public.konum_izleri (user_id, ts DESC);


-- ---------------------------------------------------------------------------
-- 2) RLS — Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.konum_izleri ENABLE ROW LEVEL SECURITY;

-- Eski politikalar varsa temizle (tekrar çalıştırılabilir olsun)
DROP POLICY IF EXISTS konum_izleri_insert_self    ON public.konum_izleri;
DROP POLICY IF EXISTS konum_izleri_insert_anon    ON public.konum_izleri;
DROP POLICY IF EXISTS konum_izleri_select_firma   ON public.konum_izleri;
DROP POLICY IF EXISTS konum_izleri_select_self    ON public.konum_izleri;

-- Authenticated sürücü: kendi user_id'siyle insert
CREATE POLICY konum_izleri_insert_self
  ON public.konum_izleri FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Anon sürücü (sofor.html token-link akışı): is_emri_id geçerliyse insert
-- Not: Bu, paylaşım linkiyle gelen anon kullanıcının iş emrine konum yazmasına izin verir.
-- Geçmiş tasarımla uyumlu — kötüye kullanım için ileride token doğrulaması eklenebilir.
CREATE POLICY konum_izleri_insert_anon
  ON public.konum_izleri FOR INSERT TO anon
  WITH CHECK (
    is_emri_id IS NOT NULL
    AND user_id IS NULL
    AND lat BETWEEN -90  AND 90
    AND lng BETWEEN -180 AND 180
  );

-- Sürücü kendi izlerini okuyabilir
CREATE POLICY konum_izleri_select_self
  ON public.konum_izleri FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Firma üyeleri (yönetici/operasyoncu) ait oldukları iş emirlerinin izlerini okuyabilir
CREATE POLICY konum_izleri_select_firma
  ON public.konum_izleri FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.is_emirleri ie
        JOIN public.firma_kullanicilar fk ON fk.firma_id = ie.firma_id
       WHERE ie.id = konum_izleri.is_emri_id
         AND fk.user_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 3) sofor_konum_gonder RPC — chunk-06.js bu fonksiyonu çağırıyor
--
--    Yapar:
--      • konum_izleri'ne yeni satır insert eder
--      • is_emri varsa is_emirleri.konum_lat/lng/zaman'ı da günceller
--    Avantaj:
--      • RLS'de tek policy (insert) yeter, update için ayrı policy gerekmez
--      • SECURITY DEFINER ile sürücü kendi iş emrini güncelleyebilir
-- ---------------------------------------------------------------------------
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

  -- 1) Konum izine yaz
  INSERT INTO public.konum_izleri
    (is_emri_id, lat, lng, hiz, dogruluk, tip, batarya, user_id, ts)
  VALUES
    (p_is_emri, p_lat, p_lng, p_hiz, p_dogruluk,
     COALESCE(p_tip, 'auto'), p_batarya, v_uid, now())
  RETURNING id INTO v_ize_id;

  -- 2) İş emrine son konum + zaman bilgisi (canlı takip için)
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


-- ---------------------------------------------------------------------------
-- 4) is_emri_guzergah_ozet view — OPS drawer'da hızlı özet
--    Toplam km (Haversine), nokta sayısı, başlangıç/bitiş zamanı, ort. hız
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.is_emri_guzergah_ozet AS
WITH izler AS (
  SELECT
    is_emri_id,
    lat,
    lng,
    hiz,
    ts,
    LAG(lat) OVER (PARTITION BY is_emri_id ORDER BY ts) AS prev_lat,
    LAG(lng) OVER (PARTITION BY is_emri_id ORDER BY ts) AS prev_lng
  FROM public.konum_izleri
  WHERE is_emri_id IS NOT NULL
),
mesafeler AS (
  SELECT
    is_emri_id,
    -- Haversine yaklaşımı (küçük mesafeler için yeterli)
    CASE
      WHEN prev_lat IS NULL THEN 0
      ELSE 6371 * 2 * asin(sqrt(
        power(sin(radians((lat - prev_lat)/2)), 2) +
        cos(radians(prev_lat)) * cos(radians(lat)) *
        power(sin(radians((lng - prev_lng)/2)), 2)
      ))
    END AS segment_km,
    hiz,
    ts
  FROM izler
)
SELECT
  is_emri_id,
  COUNT(*)               AS nokta_sayisi,
  MIN(ts)                AS basla_ts,
  MAX(ts)                AS bitir_ts,
  ROUND(SUM(segment_km)::numeric, 2) AS toplam_km,
  ROUND(AVG(NULLIF(hiz, 0))::numeric, 1) AS ort_hiz_kmh
FROM mesafeler
GROUP BY is_emri_id;

GRANT SELECT ON public.is_emri_guzergah_ozet TO authenticated;


COMMIT;

-- =============================================================================
-- TEST SORGULARI (migration sonrası elle deneyin)
-- =============================================================================
-- 1) RPC test (sadece authenticated kullanıcı):
--    SELECT public.sofor_konum_gonder(40.99, 28.81, 12.5, 80, 95, 20, 'auto');
--
-- 2) Bir iş emrinin güzergahını listele:
--    SELECT lat, lng, ts FROM konum_izleri
--      WHERE is_emri_id = 20 ORDER BY ts;
--
-- 3) Özet view:
--    SELECT * FROM is_emri_guzergah_ozet WHERE is_emri_id = 20;
-- =============================================================================
