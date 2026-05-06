-- =============================================================================
-- FLEETLY  —  2026-05-06k  —  Filo-İçi Trafik Sistemi (Phase 1)
-- =============================================================================
-- Kendi filomuzun GPS verilerinden trafik haritası üreten sistem. TomTom/Mapbox
-- gibi 3rd-party servislere alternatif — kendi DB'mizde, sıfır API maliyeti.
--
-- Mantık:
--   • Her konum noktası bir GRID HÜCRESİ'ne düşer (~110m × ~85m, lat/lng round 3 ondalık)
--   • Her hücre için son 30 dk anlık ortalama hız (kısa pencere)
--   • Geçmiş 7 günden p95 hız = "beklenen hız" (free-flow proxy)
--   • Web tarafı: kisa_ort_hiz / beklenen_hiz oranı → yeşil/sarı/kırmızı
--
-- İleride üstüne kurulacaklar (Phase 2 — bu migration kapsam dışı):
--   • Liman polygonları (Kumport, Marport, Mardaş, ...)
--   • Liman ziyaret tablosu (giriş/çıkış event'leri trigger)
--   • Sıra tahmini: "Marport şu anda 47 dk bekleme — son 1sa içinde N araç"
--
-- Bağımlılık: konum_izleri (mevcut), is_emirleri.firma_id
-- Geri alma: trigger DROP + tablo DROP — veri kaybı.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) GRID TABLOSU
-- -----------------------------------------------------------------------------
-- hucre_id formatı: "lat3,lng3" — ROUND(lat,3)||','||ROUND(lng,3)
-- Türkiye lat 36-42° arasında: 0.001° lat ≈ 111m, 0.001° lng ≈ 80-90m
-- → ortalama 100m × 100m hücre, harita zoom 14-16'da rahat görünür.
--
-- multi-tenant: (firma_id, hucre_id) bileşik PK. Aynı hücre farklı firmaların
-- aktif kullanımıyla bağımsız ortalamalar tutar. İleride global agregat ayrı
-- bir view ile çıkarılabilir.
CREATE TABLE IF NOT EXISTS public.filo_trafik_grid (
  firma_id          uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  hucre_id          text NOT NULL,                  -- "40.123,28.456"
  merkez_lat        double precision NOT NULL,
  merkez_lng        double precision NOT NULL,

  -- Kısa pencere (son 30 dk içindeki rolling average) — anlık trafik
  kisa_ort_hiz      numeric(5,2) NOT NULL DEFAULT 0,
  kisa_ornek        integer NOT NULL DEFAULT 0,
  kisa_son_at       timestamptz NOT NULL DEFAULT now(),

  -- Uzun pencere — geçmiş 7 günün p95 hızı (free-flow proxy)
  beklenen_hiz      numeric(5,2),
  beklenen_ornek    integer NOT NULL DEFAULT 0,
  beklenen_guncel_at timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firma_id, hucre_id)
);

CREATE INDEX IF NOT EXISTS idx_trafik_firma_aktif
  ON public.filo_trafik_grid(firma_id, kisa_son_at DESC);
-- Spatial-ish index — bbox sorguları için (ileride PostGIS ile değişebilir)
CREATE INDEX IF NOT EXISTS idx_trafik_lat_lng
  ON public.filo_trafik_grid(firma_id, merkez_lat, merkez_lng);

COMMENT ON TABLE public.filo_trafik_grid IS
  'Filo-içi trafik analizi — kendi GPS verilerinden grid bazlı yoğunluk haritası. konum_izleri INSERT trigger''ı doldurur.';

-- -----------------------------------------------------------------------------
-- 2) RLS — firma_id bazlı
-- -----------------------------------------------------------------------------
ALTER TABLE public.filo_trafik_grid ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trafik_grid_select ON public.filo_trafik_grid;
CREATE POLICY trafik_grid_select ON public.filo_trafik_grid
  FOR SELECT TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE yalnızca SECURITY DEFINER trigger üzerinden — public policy yok.

-- -----------------------------------------------------------------------------
-- 3) HÜCRE GÜNCELLEME TRIGGER — konum_izleri AFTER INSERT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_konum_filo_trafik()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hucre      text;
  v_lat        numeric;
  v_lng        numeric;
  v_kmh        numeric;
  v_firma_id   uuid;
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- m/s → km/sa (negatif/null sıfırla)
  v_kmh := GREATEST(COALESCE(NEW.hiz, 0) * 3.6, 0);
  -- Çok yüksek değerler GPS hatası olabilir — > 200 km/sa kayıtları yok say
  IF v_kmh > 200 THEN RETURN NEW; END IF;

  -- Hücre id: 3 ondalık (~100m)
  v_lat := ROUND(NEW.lat::numeric, 3);
  v_lng := ROUND(NEW.lng::numeric, 3);
  v_hucre := v_lat::text || ',' || v_lng::text;

  -- Firma id — şoförün firmasını çöz
  SELECT firma_id INTO v_firma_id FROM (
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = NEW.user_id
    UNION
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = NEW.user_id
  ) x LIMIT 1;

  IF v_firma_id IS NULL THEN RETURN NEW; END IF;

  -- Hücreyi UPSERT et:
  --   • Son 30dk'dan eski güncelleme varsa pencereyi SIFIRLA (yeni veriyle başlat)
  --   • Aksi halde rolling average (cap=100 örnek; eski örnekleri yumuşak unutur)
  INSERT INTO public.filo_trafik_grid
    (firma_id, hucre_id, merkez_lat, merkez_lng,
     kisa_ort_hiz, kisa_ornek, kisa_son_at)
  VALUES
    (v_firma_id, v_hucre, v_lat, v_lng,
     v_kmh, 1, NEW.ts)
  ON CONFLICT (firma_id, hucre_id) DO UPDATE SET
    kisa_ort_hiz = CASE
      WHEN public.filo_trafik_grid.kisa_son_at < now() - interval '30 minutes'
        THEN v_kmh
      ELSE
        (public.filo_trafik_grid.kisa_ort_hiz * public.filo_trafik_grid.kisa_ornek + v_kmh)
        / (public.filo_trafik_grid.kisa_ornek + 1)
    END,
    kisa_ornek = CASE
      WHEN public.filo_trafik_grid.kisa_son_at < now() - interval '30 minutes' THEN 1
      ELSE LEAST(public.filo_trafik_grid.kisa_ornek + 1, 100)
    END,
    kisa_son_at = NEW.ts,
    updated_at  = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_konum_filo_trafik ON public.konum_izleri;
CREATE TRIGGER trg_konum_filo_trafik
  AFTER INSERT ON public.konum_izleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_konum_filo_trafik();

-- -----------------------------------------------------------------------------
-- 4) BEKLENEN HIZ ÖĞRENME (free-flow proxy)
-- -----------------------------------------------------------------------------
-- Geçmiş 7 günün p95 hızı = "engelsiz akış" yaklaşımı.
-- Bu fonksiyon manuel veya cron ile periyodik (saatlik/günlük) çağrılır.
-- Şimdilik konum_izleri'nden direkt hesaplar; ileride aggregat tablo eklenebilir.
CREATE OR REPLACE FUNCTION public.filo_trafik_beklenen_hiz_ogren()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Geçmiş 7 gün, hücre başına p95 (ROUND ile aynı hücreye düşürerek aggregate)
  WITH son7g AS (
    SELECT
      ROUND(k.lat::numeric, 3) AS lat3,
      ROUND(k.lng::numeric, 3) AS lng3,
      k.user_id,
      k.hiz * 3.6 AS kmh,
      (SELECT firma_id FROM (
        SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = k.user_id
        UNION
        SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = k.user_id
      ) x LIMIT 1) AS firma_id
    FROM public.konum_izleri k
    WHERE k.ts > now() - interval '7 days'
      AND k.lat IS NOT NULL AND k.lng IS NOT NULL AND k.hiz IS NOT NULL
      AND k.hiz * 3.6 BETWEEN 1 AND 200    -- gürültü / GPS hatası filtre
  ),
  hesaplanan AS (
    SELECT
      firma_id,
      lat3::text || ',' || lng3::text AS hucre_id,
      lat3,
      lng3,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY kmh) AS p95,
      COUNT(*) AS ornek
    FROM son7g
    WHERE firma_id IS NOT NULL
    GROUP BY firma_id, lat3, lng3
    HAVING COUNT(*) >= 5            -- en az 5 örnekle anlamlı p95
  )
  UPDATE public.filo_trafik_grid g
     SET beklenen_hiz       = h.p95,
         beklenen_ornek     = h.ornek,
         beklenen_guncel_at = now()
    FROM hesaplanan h
   WHERE g.firma_id = h.firma_id AND g.hucre_id = h.hucre_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.filo_trafik_beklenen_hiz_ogren() TO authenticated;

COMMENT ON FUNCTION public.filo_trafik_beklenen_hiz_ogren IS
  'Geçmiş 7 günün p95 hızını her hücre için hesaplar ve beklenen_hiz alanına yazar. Cron ile günlük çağrılması önerilir.';

-- -----------------------------------------------------------------------------
-- 5) BBOX RPC — harita render için
-- -----------------------------------------------------------------------------
-- Web tarafı haritada görünen bbox + zoom seviyesini parametre verir, RPC
-- son 30 dk içinde aktif olan hücreleri döndürür. Renk hesabı client-side.
CREATE OR REPLACE FUNCTION public.filo_trafik_bbox(
  p_lat_min  double precision,
  p_lng_min  double precision,
  p_lat_max  double precision,
  p_lng_max  double precision
)
RETURNS TABLE (
  hucre_id      text,
  merkez_lat    double precision,
  merkez_lng    double precision,
  kisa_ort_hiz  numeric,
  kisa_ornek    integer,
  beklenen_hiz  numeric,
  yas_dk        integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    g.hucre_id, g.merkez_lat, g.merkez_lng,
    g.kisa_ort_hiz, g.kisa_ornek, g.beklenen_hiz,
    EXTRACT(EPOCH FROM (now() - g.kisa_son_at))::int / 60 AS yas_dk
  FROM public.filo_trafik_grid g
  WHERE g.firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
    UNION
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = auth.uid()
  )
    AND g.merkez_lat BETWEEN p_lat_min AND p_lat_max
    AND g.merkez_lng BETWEEN p_lng_min AND p_lng_max
    AND g.kisa_son_at > now() - interval '30 minutes'
    AND g.kisa_ornek >= 2                  -- en az 2 örnek = istatistiksel anlamlı
  ORDER BY g.kisa_son_at DESC
  LIMIT 5000;                              -- güvenlik kapağı
$$;

GRANT EXECUTE ON FUNCTION public.filo_trafik_bbox(
  double precision, double precision, double precision, double precision
) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) TEMİZLİK — eski hücreleri sil (cron ile periyodik)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filo_trafik_grid_temizle()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.filo_trafik_grid
   WHERE kisa_son_at < now() - interval '14 days'
     AND (beklenen_guncel_at IS NULL OR beklenen_guncel_at < now() - interval '30 days');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.filo_trafik_grid_temizle() TO authenticated;

COMMENT ON FUNCTION public.filo_trafik_grid_temizle IS
  '14 günden eski + beklenen_hiz''i de eski hücreleri siler. Tablonun sürekli büyümesini engeller.';

-- -----------------------------------------------------------------------------
-- 7) Realtime publication
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.filo_trafik_grid;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- PHASE 2 PLANI — bu migration kapsam dışı, ileride eklenecek:
-- =============================================================================
--   1) limanlar tablosu (id, ad, poligon — PostGIS Polygon)
--   2) liman_ziyaretleri (id, liman_id, is_emri_id, user_id, giris_at, cikis_at,
--      hareketsiz_sn, sira_uzunlugu_giriste, ...)
--   3) konum_izleri trigger genişletmesi: ST_Contains(poligon, point) ile liman
--      içine giriş/çıkış event'leri yarat
--   4) RPC: liman_aktif_yoğunluk(liman_id) → "şu anda içeride X araç, ortalama
--      bekleme Y dakika"
--   5) Web: liman polygon'larını haritada göster + canlı sıra göstergesi
--
-- Filo büyüdükçe (50+ aktif araç) bu sistem TomTom seviyesinde olmasa da
-- liman çevresi gibi YEREL noktalarda çok daha doğru sonuç verir.
-- =============================================================================
