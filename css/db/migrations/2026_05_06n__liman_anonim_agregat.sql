-- =============================================================================
-- FLEETLY  —  2026-05-06n  —  Anonim Liman Yoğunluk Agregatı
-- =============================================================================
-- Liman bekleme süreleri ve giriş/çıkış istatistiklerini ANONİM olarak biriktirir.
-- Şu anki `liman_aktif_yogunluk` RPC'si ham `liman_ziyaretleri`'nden okuyor —
-- tek firma + RLS varken sıkıntı yok ama veri büyüdükçe:
--   • Crowd-sourced agregatların sızmaması için ham tabloya parametrelerden
--     bağımsız erişim engellenmeli
--   • Anlık RPC sorguları 1000+ ziyaret olunca yavaşlayacak
--
-- Çözüm: 5 dakikalık bucket'larda istatistik tut. firma_id YOK, user_id YOK.
-- Sadece sayılar. RPC'ler bu tablodan okur, ham `liman_ziyaretleri` artık
-- anonim agregata sızmaz.
--
-- ÖNEMLİ: Bu agregat her firmadan veri toplar. Kullanıcılar bu mekanizmadan
-- haberdar değildir — RPC'ler "bu liman şu an X araç" der, kaynağı belirtmez.
-- (Yöneticiler "kaynak: kendi araçlarınız + diğer firma araçları" demez.)
--
-- Bağımlılık: 2026_05_06l (limanlar + liman_ziyaretleri).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ANONİM AGREGAT TABLOSU
-- -----------------------------------------------------------------------------
-- 5 dakikalık bucket — bir limanın o zaman dilimindeki istatistikleri.
-- Bekleme süresi ortalaması: bekleme_toplam_dk / bekleme_ornek
-- "Şu an içeride" = liman_ziyaretleri'nden anlık COUNT (RPC içinde, sızmaz)
CREATE TABLE IF NOT EXISTS public.liman_global_yogunluk_5dk (
  liman_id          uuid        NOT NULL REFERENCES public.limanlar(id) ON DELETE CASCADE,
  bucket_5dk        timestamptz NOT NULL,    -- bucket başlangıcı (5dk floor)
  giris_say         integer     NOT NULL DEFAULT 0,
  cikis_say         integer     NOT NULL DEFAULT 0,
  bekleme_toplam_dk numeric     NOT NULL DEFAULT 0,
  bekleme_ornek     integer     NOT NULL DEFAULT 0,
  guncel_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (liman_id, bucket_5dk)
);

CREATE INDEX IF NOT EXISTS idx_liman_yogunluk_bucket
  ON public.liman_global_yogunluk_5dk(bucket_5dk DESC);

COMMENT ON TABLE public.liman_global_yogunluk_5dk IS
  'Liman yoğunluk anonim agregatı — 5 dakikalık bucket. firma_id ve user_id YOK. Tüm firmaların ziyaret event''lerinden trigger ile beslenir.';

-- -----------------------------------------------------------------------------
-- 2) RLS — herkese SELECT, INSERT/UPDATE sadece SECURITY DEFINER trigger
-- -----------------------------------------------------------------------------
ALTER TABLE public.liman_global_yogunluk_5dk ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yogunluk_select ON public.liman_global_yogunluk_5dk;
CREATE POLICY yogunluk_select ON public.liman_global_yogunluk_5dk
  FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE policy YOK → public.role bypass eder, ama trigger SECURITY DEFINER
-- olduğu için postgres rolü ile yazıp policy'i bypass ediyor. Bu hassas tablo
-- için doğru pattern — uygulama hesaplarından doğrudan yazma yolu yok.

-- -----------------------------------------------------------------------------
-- 3) BUCKET HESAPLAMA YARDIMCISI
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bucket_5dk(p_at timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT date_trunc('hour', p_at) +
         ((FLOOR(EXTRACT(MINUTE FROM p_at) / 5))::int * 5) * interval '1 minute';
$$;

-- -----------------------------------------------------------------------------
-- 4) AGREGAT TRIGGER — liman_ziyaretleri AFTER INSERT/UPDATE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_ziyaret_global_yogunluk()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bucket  timestamptz;
  v_dk      numeric;
BEGIN
  -- INSERT (yeni giriş): bucket giris_say +1
  IF TG_OP = 'INSERT' THEN
    v_bucket := public._bucket_5dk(NEW.giris_at);
    INSERT INTO public.liman_global_yogunluk_5dk
      (liman_id, bucket_5dk, giris_say)
    VALUES (NEW.liman_id, v_bucket, 1)
    ON CONFLICT (liman_id, bucket_5dk) DO UPDATE
      SET giris_say = public.liman_global_yogunluk_5dk.giris_say + 1,
          guncel_at = now();
    RETURN NEW;
  END IF;

  -- UPDATE: çıkış event'i — cikis_at NULL'dan dolu duruma geçtiyse
  IF TG_OP = 'UPDATE'
     AND OLD.cikis_at IS NULL
     AND NEW.cikis_at IS NOT NULL
     AND NEW.giris_at IS NOT NULL THEN
    v_bucket := public._bucket_5dk(NEW.cikis_at);
    v_dk := GREATEST(EXTRACT(EPOCH FROM (NEW.cikis_at - NEW.giris_at)) / 60.0, 0);
    INSERT INTO public.liman_global_yogunluk_5dk
      (liman_id, bucket_5dk, cikis_say, bekleme_toplam_dk, bekleme_ornek)
    VALUES (NEW.liman_id, v_bucket, 1, v_dk, 1)
    ON CONFLICT (liman_id, bucket_5dk) DO UPDATE
      SET cikis_say          = public.liman_global_yogunluk_5dk.cikis_say + 1,
          bekleme_toplam_dk  = public.liman_global_yogunluk_5dk.bekleme_toplam_dk + v_dk,
          bekleme_ornek      = public.liman_global_yogunluk_5dk.bekleme_ornek + 1,
          guncel_at          = now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ziyaret_global_yogunluk ON public.liman_ziyaretleri;
CREATE TRIGGER trg_ziyaret_global_yogunluk
  AFTER INSERT OR UPDATE ON public.liman_ziyaretleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ziyaret_global_yogunluk();

-- -----------------------------------------------------------------------------
-- 5) RPC — Tek liman için anlık + tarihsel istatistik
-- -----------------------------------------------------------------------------
-- "icerideki_arac" anlık COUNT — liman_ziyaretleri'nden, ama sadece sayı döner →
-- firma_id sızmaz. SECURITY DEFINER + tek scalar geri dönüş.
CREATE OR REPLACE FUNCTION public.liman_global_yogunluk(p_liman_id uuid)
RETURNS TABLE (
  liman_id              uuid,
  liman_ad              text,
  liman_tip             text,
  icerideki_arac        integer,
  son_1sa_giren         integer,
  son_1sa_cikan         integer,
  ort_bekleme_son1sa_dk numeric,
  ort_bekleme_son7g_dk  numeric,
  hareket_var           boolean,    -- son 15dk içinde herhangi bir aktivite
  guncel_at             timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agg AS (
    SELECT
      SUM(giris_say) FILTER (WHERE bucket_5dk > now() - interval '1 hour')::int   AS giren_1sa,
      SUM(cikis_say) FILTER (WHERE bucket_5dk > now() - interval '1 hour')::int   AS cikan_1sa,
      SUM(bekleme_toplam_dk) FILTER (WHERE bucket_5dk > now() - interval '1 hour')::numeric AS bek_top_1sa,
      SUM(bekleme_ornek) FILTER (WHERE bucket_5dk > now() - interval '1 hour')::int        AS bek_orn_1sa,
      SUM(bekleme_toplam_dk) FILTER (WHERE bucket_5dk > now() - interval '7 days')::numeric AS bek_top_7g,
      SUM(bekleme_ornek) FILTER (WHERE bucket_5dk > now() - interval '7 days')::int         AS bek_orn_7g,
      MAX(guncel_at)                                                              AS son_at
    FROM public.liman_global_yogunluk_5dk
    WHERE liman_id = p_liman_id
  )
  SELECT
    p_liman_id,
    l.ad,
    l.tip,
    (SELECT COUNT(*)::int FROM public.liman_ziyaretleri
       WHERE liman_id = p_liman_id AND cikis_at IS NULL),
    COALESCE(agg.giren_1sa, 0),
    COALESCE(agg.cikan_1sa, 0),
    CASE WHEN COALESCE(agg.bek_orn_1sa, 0) > 0
         THEN ROUND(agg.bek_top_1sa / agg.bek_orn_1sa, 1)
         ELSE NULL END,
    CASE WHEN COALESCE(agg.bek_orn_7g, 0) > 0
         THEN ROUND(agg.bek_top_7g / agg.bek_orn_7g, 1)
         ELSE NULL END,
    COALESCE(agg.son_at > now() - interval '15 minutes', false),
    agg.son_at
  FROM public.limanlar l, agg
  WHERE l.id = p_liman_id;
$$;

GRANT EXECUTE ON FUNCTION public.liman_global_yogunluk(uuid) TO authenticated;

COMMENT ON FUNCTION public.liman_global_yogunluk IS
  'Liman için anonim yoğunluk + bekleme istatistikleri. Tüm firmaların verisi agregelenir, kaynak gizlenir.';

-- -----------------------------------------------------------------------------
-- 6) RPC — Tüm aktif limanlar için özet (harita render için)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.limanlar_global_ozet()
RETURNS TABLE (
  liman_id              uuid,
  liman_ad              text,
  liman_tip             text,
  merkez_lat            double precision,
  merkez_lng            double precision,
  icerideki_arac        integer,
  son_1sa_giren         integer,
  ort_bekleme_son1sa_dk numeric,
  hareket_var           boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    l.id, l.ad, l.tip, l.merkez_lat, l.merkez_lng,
    (SELECT COUNT(*)::int FROM public.liman_ziyaretleri
       WHERE liman_id = l.id AND cikis_at IS NULL),
    COALESCE((SELECT SUM(giris_say)::int FROM public.liman_global_yogunluk_5dk
                WHERE liman_id = l.id AND bucket_5dk > now() - interval '1 hour'), 0),
    (SELECT CASE WHEN SUM(bekleme_ornek) > 0
                 THEN ROUND(SUM(bekleme_toplam_dk) / SUM(bekleme_ornek), 1)
                 ELSE NULL END
       FROM public.liman_global_yogunluk_5dk
       WHERE liman_id = l.id AND bucket_5dk > now() - interval '1 hour'),
    EXISTS (SELECT 1 FROM public.liman_global_yogunluk_5dk
              WHERE liman_id = l.id AND bucket_5dk > now() - interval '15 minutes')
  FROM public.limanlar l
  WHERE l.aktif = true;
$$;

GRANT EXECUTE ON FUNCTION public.limanlar_global_ozet() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) RPC — Bir lat/lng noktasını içeren liman var mı? (mobile için)
-- -----------------------------------------------------------------------------
-- Şoförün iş emrindeki teslimat lat/lng'si bir liman polygon'una düşüyor mu?
-- Düşüyorsa o liman_id döner — mobile bu id ile yoğunluk RPC'sini çağırır.
CREATE OR REPLACE FUNCTION public.liman_at_point(
  p_lat double precision, p_lng double precision
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT id FROM public.limanlar
   WHERE aktif = true
     AND ST_Contains(poligon, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
   ORDER BY (firma_id IS NULL)   -- önce global, sonra firma-özel
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.liman_at_point(double precision, double precision) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8) RPC — Bir text alanını liman adıyla eşle (teslim_yeri → liman_id)
-- -----------------------------------------------------------------------------
-- Şoförün iş emrindeki teslim_yeri metni "Kumport", "kumport limanı", "KUMPORT - AMBARLI"
-- olabilir. Pre-seed sınırı yanlış polygon yüzünden lat/lng match başarısızsa, text
-- match yedek olur. Polygon öğrenme sistemi (06o migration) bu eşleşmeyle besleniyor.
CREATE OR REPLACE FUNCTION public.liman_by_text(p_text text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH nrm AS (
    SELECT lower(regexp_replace(coalesce(p_text, ''), '[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ ]', '', 'g')) AS t
  )
  SELECT l.id FROM public.limanlar l, nrm
   WHERE l.aktif = true
     AND nrm.t <> ''
     AND lower(l.ad) = ANY(string_to_array(nrm.t, ' '))    -- "kumport" tek kelime match
        OR position(lower(l.ad) IN nrm.t) > 0              -- içerme (Kumport Limanı, vs)
   ORDER BY length(l.ad) DESC, (l.firma_id IS NULL)        -- en uzun ad önce, sonra global
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.liman_by_text(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9) TEMİZLİK — eski bucket'ları sil (cron ile periyodik)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liman_yogunluk_temizle()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.liman_global_yogunluk_5dk
   WHERE bucket_5dk < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_yogunluk_temizle() TO authenticated;

-- -----------------------------------------------------------------------------
-- 10) Realtime publication
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.liman_global_yogunluk_5dk;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Bucket trigger çalışıyor mu:
--    INSERT INTO liman_ziyaretleri (...) VALUES (...);
--    SELECT * FROM liman_global_yogunluk_5dk ORDER BY guncel_at DESC LIMIT 5;
--
-- 2) RPC'ler:
--    SELECT * FROM liman_global_yogunluk('uuid-of-kumport');
--    SELECT * FROM limanlar_global_ozet();
--    SELECT liman_at_point(40.982, 28.700);   -- Kumport içi
--    SELECT liman_by_text('kumport limanı');
-- =============================================================================
