-- =============================================================================
-- FLEETLY  —  2026-05-06l  —  Limanlar / Fabrikalar + Ziyaret Sistemi (Phase 2)
-- =============================================================================
-- Filo trafik (Phase 1) üzerine kurulur:
--   • Liman/fabrika polygonları (PostGIS Polygon) — yönetici çizer
--   • konum_izleri trigger: araç polygon'a girince/çıkınca event üretir
--   • liman_ziyaretleri: her ziyaretin giriş/çıkış zamanı + hareketsiz süresi
--   • RPC: aktif yoğunluk + ortalama bekleme + son saat trendi
--
-- Kullanım senaryosu:
--   • Operasyon panelinde "Limanlar" sayfasından Kumport, Marport vb. polygonlar çizilir
--   • Şoför limana girdiğinde otomatik kayıt + yöneticiye bildirim
--   • Şoför mobil iş emrinde: "📍 Kumport şu an 12 araç içeride, ort. 47dk bekleme"
--   • Yönetici filo haritasında: liman polygon'u + canlı sıra göstergesi
--
-- Bağımlılık: PostGIS extension. Supabase Cloud'da Dashboard üzerinden etkinleştirilebilir
-- (Database → Extensions → "postgis" enable). Aşağıdaki CREATE EXTENSION yoksa hata olur.
--
-- Bağımlılık: surucu_duraksamalar (2026_05_06g) — bekleme süresi ile çapraz referans
-- Geri alma: TRIGGER + tablo + RPC DROP edilebilir.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0) PostGIS extension — polygon containment için şart
-- -----------------------------------------------------------------------------
-- Supabase Cloud: extensions schema kullanılır. Local Postgres için public.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
  -- Bazı Supabase projelerinde "postgis" extension Dashboard üzerinden etkinleştirilmeden
  -- migration uygulanırsa hata alır. Hatayı yutmuyoruz — kullanıcıya bildiriyoruz.
  RAISE EXCEPTION 'PostGIS extension yok. Supabase Dashboard → Database → Extensions → "postgis" enable yapın.';
END $$;

-- -----------------------------------------------------------------------------
-- 1) LİMANLAR/FABRİKALAR TABLOSU
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.limanlar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- firma_id NULL = global liman (tüm firmalar görür), NOT NULL = firmaya özel depo
  firma_id        uuid REFERENCES public.firmalar(id) ON DELETE CASCADE,
  ad              text NOT NULL,                 -- "Kumport", "Marport", "Mega Metal Çatalca"
  tip             text NOT NULL DEFAULT 'liman'
                  CHECK (tip IN ('liman','fabrika','terminal','depo','servis')),
  poligon         geometry(Polygon, 4326) NOT NULL,    -- WGS84 lat/lng
  merkez_lat      double precision GENERATED ALWAYS AS (ST_Y(ST_Centroid(poligon))) STORED,
  merkez_lng      double precision GENERATED ALWAYS AS (ST_X(ST_Centroid(poligon))) STORED,
  aktif           boolean NOT NULL DEFAULT true,
  notlar          text,
  ortalama_bekleme_dk integer,                    -- günde 1 RPC ile öğrenilen
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_limanlar_poligon
  ON public.limanlar USING GIST(poligon);
CREATE INDEX IF NOT EXISTS idx_limanlar_firma_aktif
  ON public.limanlar(firma_id, aktif) WHERE aktif = true;

COMMENT ON TABLE public.limanlar IS
  'Liman/fabrika polygonları. konum_izleri trigger giriş/çıkış event üretir. Phase 2 — 2026_05_06l.';

-- -----------------------------------------------------------------------------
-- 2) ZİYARET KAYIT TABLOSU
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.liman_ziyaretleri (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liman_id        uuid NOT NULL REFERENCES public.limanlar(id) ON DELETE CASCADE,
  is_emri_id      bigint REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  firma_id        uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  giris_at        timestamptz NOT NULL DEFAULT now(),
  cikis_at        timestamptz,                     -- NULL = aktif (içeride)
  hareketsiz_sn   integer NOT NULL DEFAULT 0,      -- duraksama toplamı (cron ile günceller)
  giris_lat       double precision,
  giris_lng       double precision,
  cikis_lat       double precision,
  cikis_lng       double precision,
  notlar          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ziyaret_aktif
  ON public.liman_ziyaretleri(liman_id, giris_at DESC) WHERE cikis_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ziyaret_user_aktif
  ON public.liman_ziyaretleri(user_id, giris_at DESC) WHERE cikis_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ziyaret_firma
  ON public.liman_ziyaretleri(firma_id, giris_at DESC);
CREATE INDEX IF NOT EXISTS idx_ziyaret_isemri
  ON public.liman_ziyaretleri(is_emri_id) WHERE is_emri_id IS NOT NULL;

COMMENT ON TABLE public.liman_ziyaretleri IS
  'Araçların liman/fabrikaya giriş-çıkış event''leri. Trigger doldurur, sıra tahmini RPC kullanır.';

-- -----------------------------------------------------------------------------
-- 3) RLS — limanlar
-- -----------------------------------------------------------------------------
ALTER TABLE public.limanlar             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liman_ziyaretleri    ENABLE ROW LEVEL SECURITY;

-- LIMANLAR: global olanları herkes görür; firmaya özel olanları o firma görür
DROP POLICY IF EXISTS limanlar_select ON public.limanlar;
CREATE POLICY limanlar_select ON public.limanlar
  FOR SELECT TO authenticated
  USING (
    firma_id IS NULL
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: yalnızca firma yönetimi (sahip/yonetici/operasyoncu)
DROP POLICY IF EXISTS limanlar_insert ON public.limanlar;
CREATE POLICY limanlar_insert ON public.limanlar
  FOR INSERT TO authenticated
  WITH CHECK (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
  );

DROP POLICY IF EXISTS limanlar_update ON public.limanlar;
CREATE POLICY limanlar_update ON public.limanlar
  FOR UPDATE TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
  );

DROP POLICY IF EXISTS limanlar_delete ON public.limanlar;
CREATE POLICY limanlar_delete ON public.limanlar
  FOR DELETE TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
    )
  );

-- ZİYARETLER: firma içi okuma; insert trigger üzerinden
DROP POLICY IF EXISTS ziyaret_select ON public.liman_ziyaretleri;
CREATE POLICY ziyaret_select ON public.liman_ziyaretleri
  FOR SELECT TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- 4) GİRİŞ/ÇIKIŞ ALGILAMA TRIGGER (konum_izleri INSERT)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_konum_liman_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_liman      public.limanlar%ROWTYPE;
  v_aktif      public.liman_ziyaretleri%ROWTYPE;
  v_firma_id   uuid;
  v_point      geometry;
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);

  -- Şoförün firma_id'si
  SELECT firma_id INTO v_firma_id FROM (
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = NEW.user_id
    UNION
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = NEW.user_id
  ) x LIMIT 1;

  IF v_firma_id IS NULL THEN RETURN NEW; END IF;

  -- 1) Bu noktayı içeren AKTIF bir liman var mı? (global VEYA aynı firma)
  SELECT * INTO v_liman
    FROM public.limanlar l
    WHERE l.aktif = true
      AND (l.firma_id IS NULL OR l.firma_id = v_firma_id)
      AND ST_Contains(l.poligon, v_point)
    LIMIT 1;

  -- 2) Bu kullanıcının açık ziyareti var mı?
  SELECT * INTO v_aktif
    FROM public.liman_ziyaretleri
    WHERE user_id = NEW.user_id AND cikis_at IS NULL
    ORDER BY giris_at DESC LIMIT 1;

  -- ── DURUMLAR ──
  IF FOUND AND v_liman.id IS NOT NULL THEN
    -- A) Açık ziyaret var + hâlâ liman içinde
    IF v_aktif.liman_id = v_liman.id THEN
      -- Aynı liman, devam ediyor — no-op (ileride hareketsiz_sn rolling update yapılabilir)
      RETURN NEW;
    ELSE
      -- Farklı liman — eskiyi kapat, yeniyi aç
      UPDATE public.liman_ziyaretleri
         SET cikis_at = now(), cikis_lat = NEW.lat, cikis_lng = NEW.lng
       WHERE id = v_aktif.id;
      INSERT INTO public.liman_ziyaretleri
        (liman_id, is_emri_id, user_id, firma_id, giris_at, giris_lat, giris_lng)
      VALUES
        (v_liman.id, NEW.is_emri_id, NEW.user_id, v_firma_id, NEW.ts, NEW.lat, NEW.lng);
      PERFORM public.notify_create(
        v_firma_id, 'is_emri_durum',
        '📍 ' || v_liman.ad || ' girişi',
        'Araç ' || v_liman.ad || ' bölgesine girdi.',
        'liman', v_liman.id::text, NEW.user_id, NULL, 'normal'
      );
    END IF;
  ELSIF v_liman.id IS NOT NULL THEN
    -- B) Liman içinde + açık ziyaret YOK → yeni ziyaret aç
    INSERT INTO public.liman_ziyaretleri
      (liman_id, is_emri_id, user_id, firma_id, giris_at, giris_lat, giris_lng)
    VALUES
      (v_liman.id, NEW.is_emri_id, NEW.user_id, v_firma_id, NEW.ts, NEW.lat, NEW.lng);
    PERFORM public.notify_create(
      v_firma_id, 'is_emri_durum',
      '📍 ' || v_liman.ad || ' girişi',
      'Araç ' || v_liman.ad || ' bölgesine girdi.',
      'liman', v_liman.id::text, NEW.user_id, NULL, 'normal'
    );
  ELSIF FOUND AND v_aktif.id IS NOT NULL THEN
    -- C) Liman dışında + açık ziyaret VAR → kapat
    UPDATE public.liman_ziyaretleri
       SET cikis_at = now(), cikis_lat = NEW.lat, cikis_lng = NEW.lng
     WHERE id = v_aktif.id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_konum_liman_event ON public.konum_izleri;
CREATE TRIGGER trg_konum_liman_event
  AFTER INSERT ON public.konum_izleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_konum_liman_event();

-- -----------------------------------------------------------------------------
-- 5) RPC'ler
-- -----------------------------------------------------------------------------

-- Liman oluşturma — frontend GeoJSON polygon string'i gönderir
CREATE OR REPLACE FUNCTION public.liman_olustur(
  p_ad          text,
  p_tip         text,
  p_poligon_geojson text,           -- GeoJSON Polygon — örn. {"type":"Polygon","coordinates":[[[lng,lat],...]]}
  p_firma_ozel  boolean DEFAULT false,    -- true = sadece bu firma için, false = global
  p_notlar      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id        uuid;
  v_firma_id  uuid;
  v_geom      geometry;
BEGIN
  IF p_ad IS NULL OR length(trim(p_ad)) = 0 THEN
    RAISE EXCEPTION 'Liman adı zorunlu' USING ERRCODE = '23502';
  END IF;
  IF p_poligon_geojson IS NULL THEN
    RAISE EXCEPTION 'Polygon zorunlu' USING ERRCODE = '23502';
  END IF;

  -- GeoJSON → geometry
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_poligon_geojson), 4326);
  IF GeometryType(v_geom) <> 'POLYGON' THEN
    RAISE EXCEPTION 'Geometry Polygon olmalı (%)', GeometryType(v_geom);
  END IF;

  -- Firma id (kullanıcının yönetici olduğu firma)
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid()
      AND fk.rol IN ('sahip','yonetici','operasyoncu')
    LIMIT 1;
  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Liman oluşturma yetkisi yok' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.limanlar (firma_id, ad, tip, poligon, notlar, created_by)
  VALUES (
    CASE WHEN p_firma_ozel THEN v_firma_id ELSE NULL END,
    p_ad,
    COALESCE(p_tip, 'liman'),
    v_geom,
    p_notlar,
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_olustur(text, text, text, boolean, text) TO authenticated;

-- Liman güncelleme — polygon revize
CREATE OR REPLACE FUNCTION public.liman_guncelle(
  p_id          uuid,
  p_ad          text DEFAULT NULL,
  p_tip         text DEFAULT NULL,
  p_poligon_geojson text DEFAULT NULL,
  p_aktif       boolean DEFAULT NULL,
  p_notlar      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_geom geometry;
BEGIN
  IF p_poligon_geojson IS NOT NULL THEN
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_poligon_geojson), 4326);
    IF GeometryType(v_geom) <> 'POLYGON' THEN
      RAISE EXCEPTION 'Geometry Polygon olmalı';
    END IF;
  END IF;
  UPDATE public.limanlar
     SET ad      = COALESCE(p_ad, ad),
         tip     = COALESCE(p_tip, tip),
         poligon = COALESCE(v_geom, poligon),
         aktif   = COALESCE(p_aktif, aktif),
         notlar  = COALESCE(p_notlar, notlar),
         updated_at = now()
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_guncelle(uuid, text, text, text, boolean, text) TO authenticated;

-- Liman polygon listesi — harita render için (GeoJSON döner)
CREATE OR REPLACE FUNCTION public.limanlari_listele()
RETURNS TABLE (
  id            uuid,
  ad            text,
  tip           text,
  firma_id      uuid,
  aktif         boolean,
  merkez_lat    double precision,
  merkez_lng    double precision,
  poligon_geojson text,
  ortalama_bekleme_dk integer,
  notlar        text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT
    l.id, l.ad, l.tip, l.firma_id, l.aktif,
    l.merkez_lat, l.merkez_lng,
    ST_AsGeoJSON(l.poligon)::text AS poligon_geojson,
    l.ortalama_bekleme_dk, l.notlar
  FROM public.limanlar l
  WHERE l.firma_id IS NULL
     OR l.firma_id IN (
        SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
        UNION
        SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = auth.uid()
     );
$$;

GRANT EXECUTE ON FUNCTION public.limanlari_listele() TO authenticated;

-- AKTİF YOĞUNLUK + sıra tahmini RPC'si
CREATE OR REPLACE FUNCTION public.liman_aktif_yogunluk(p_liman_id uuid)
RETURNS TABLE (
  liman_id          uuid,
  liman_ad          text,
  icerideki_arac    integer,
  son_1sa_giren     integer,
  son_1sa_cikan     integer,
  ort_bekleme_son1sa_dk numeric,
  ort_bekleme_son7g_dk  numeric,
  son_giren_at      timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
    iceride AS (
      SELECT COUNT(*)::int AS n, MAX(giris_at) AS son_giris
      FROM public.liman_ziyaretleri
      WHERE liman_id = p_liman_id AND cikis_at IS NULL
    ),
    son1sa AS (
      SELECT
        COUNT(*) FILTER (WHERE giris_at > now() - interval '1 hour')::int AS giren,
        COUNT(*) FILTER (WHERE cikis_at > now() - interval '1 hour')::int AS cikan,
        AVG(EXTRACT(EPOCH FROM (cikis_at - giris_at))/60)
          FILTER (WHERE cikis_at > now() - interval '1 hour')::numeric AS ort_dk
      FROM public.liman_ziyaretleri
      WHERE liman_id = p_liman_id
        AND (giris_at > now() - interval '1 hour' OR cikis_at > now() - interval '1 hour')
    ),
    son7g AS (
      SELECT AVG(EXTRACT(EPOCH FROM (cikis_at - giris_at))/60)::numeric AS ort_dk
      FROM public.liman_ziyaretleri
      WHERE liman_id = p_liman_id
        AND cikis_at > now() - interval '7 days'
        AND cikis_at IS NOT NULL
    )
  SELECT
    p_liman_id, l.ad,
    iceride.n, son1sa.giren, son1sa.cikan,
    ROUND(son1sa.ort_dk, 1), ROUND(son7g.ort_dk, 1),
    iceride.son_giris
  FROM public.limanlar l, iceride, son1sa, son7g
  WHERE l.id = p_liman_id;
$$;

GRANT EXECUTE ON FUNCTION public.liman_aktif_yogunluk(uuid) TO authenticated;

-- Tüm limanlar için tek seferde özet (harita için)
CREATE OR REPLACE FUNCTION public.limanlar_yogunluk_ozet()
RETURNS TABLE (
  liman_id          uuid,
  liman_ad          text,
  icerideki_arac    integer,
  ort_bekleme_son1sa_dk numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH gorunen AS (
    SELECT id, ad FROM public.limanlar
    WHERE aktif = true
      AND (firma_id IS NULL OR firma_id IN (
        SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
        UNION
        SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = auth.uid()
      ))
  )
  SELECT
    g.id, g.ad,
    COALESCE(SUM(CASE WHEN z.cikis_at IS NULL THEN 1 ELSE 0 END), 0)::int AS icerideki,
    ROUND(AVG(EXTRACT(EPOCH FROM (z.cikis_at - z.giris_at))/60)
          FILTER (WHERE z.cikis_at > now() - interval '1 hour'), 1) AS ort_son1sa
  FROM gorunen g
  LEFT JOIN public.liman_ziyaretleri z ON z.liman_id = g.id
   AND (z.cikis_at IS NULL OR z.cikis_at > now() - interval '1 hour')
  GROUP BY g.id, g.ad;
$$;

GRANT EXECUTE ON FUNCTION public.limanlar_yogunluk_ozet() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) ortalama_bekleme_dk öğrenmek (cron ile periyodik)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.limanlar_ortalama_bekleme_ogren()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  WITH ort AS (
    SELECT liman_id,
           ROUND(AVG(EXTRACT(EPOCH FROM (cikis_at - giris_at))/60))::int AS dk
      FROM public.liman_ziyaretleri
      WHERE cikis_at IS NOT NULL
        AND cikis_at > now() - interval '30 days'
      GROUP BY liman_id
      HAVING COUNT(*) >= 5
  )
  UPDATE public.limanlar l
     SET ortalama_bekleme_dk = o.dk,
         updated_at = now()
    FROM ort o
   WHERE l.id = o.liman_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.limanlar_ortalama_bekleme_ogren() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) Realtime publication
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.limanlar;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.liman_ziyaretleri;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Test liman oluştur (Kumport civarı, kabaca):
--    SELECT public.liman_olustur(
--      'Kumport Test',
--      'liman',
--      '{"type":"Polygon","coordinates":[[[28.674,40.998],[28.683,40.998],[28.683,41.005],[28.674,41.005],[28.674,40.998]]]}',
--      false  -- global
--    );
--
-- 2) Liman listesi:
--    SELECT id, ad, tip, merkez_lat, merkez_lng FROM public.limanlari_listele();
--
-- 3) Test ziyaret (manuel insert konum_izleri — trigger tetiklensin):
--    INSERT INTO public.konum_izleri (lat, lng, user_id, ts)
--    VALUES (41.001, 28.679, auth.uid(), now());
--    SELECT * FROM public.liman_ziyaretleri ORDER BY giris_at DESC LIMIT 5;
--
-- 4) Aktif yoğunluk:
--    SELECT * FROM public.limanlar_yogunluk_ozet();
-- =============================================================================
