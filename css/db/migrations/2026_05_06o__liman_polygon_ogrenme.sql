-- =============================================================================
-- FLEETLY  —  2026-05-06o  —  Anonim Liman Polygon Öğrenme (Crowd-Sourced)
-- =============================================================================
-- Pre-seed limanların (Kumport, Marport, Mardaş ...) gerçek sınırları kabaca
-- dikdörtgen — Maps'ten elle çizmek külfetli ve yanlış. Bunun yerine: şoförler
-- "Kumport" yazılı iş emrinde fiilen Kumport içine girip durduklarında bu
-- noktaları ANONİM olarak biriktir. Yeterli veri (≥30 nokta) toplanınca
-- ConvexHull ile gerçek polygon türet → limanlar.poligon UPDATE.
--
-- Mantık:
--   1) Şoför iş emrinde teslim_yeri = "Kumport" + duraksama yaşadı (10dk+)
--   2) Trigger → liman_polygon_egitim'e (liman_id, lat, lng) ekle (firma_id YOK)
--   3) Cron / manuel RPC: 30+ noktası olan limanlar için ConvexHull hesapla
--   4) Eski "Pre-seed" notlu polygon'u öğrenilenle değiştir
--
-- Kullanıcı görmesi gereken: "Kumport sınırı son güncelleme N nokta ile öğrenildi"
-- yerine sessizce limanlar.notlar = "Auto-learned 2026-05-06, 47 nokta" yazar.
-- Yöneticiler isterse manuel düzenleyebilir (liman_guncelle); auto-learn üzerine
-- yazmaz (notlar Pre-seed/Auto-learned değilse, manuel kabul edilir → öğrenme atlar).
--
-- ÖNEMLİ: Kullanıcılar "araçlarınızdan veri toplandığını" bilmesin.
-- Eğitim verisi tablosu da firma_id, user_id YOK — anonim, geri çevrilemez.
--
-- Bağımlılık: 2026_05_06l (limanlar), 2026_05_06g (surucu_duraksamalar),
--             2026_05_06n (liman_by_text fonksiyonu).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ANONİM EĞİTİM TABLOSU
-- -----------------------------------------------------------------------------
-- firma_id YOK, user_id YOK → kayıt geri çevrilemez. Sadece liman_id + nokta.
-- kaynak: hangi mekanizma noktayı ekledi (analiz için, ama firma sızdırmaz).
CREATE TABLE IF NOT EXISTS public.liman_polygon_egitim (
  id              bigserial PRIMARY KEY,
  liman_id        uuid NOT NULL REFERENCES public.limanlar(id) ON DELETE CASCADE,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  kaynak          text NOT NULL DEFAULT 'duraksama'
                  CHECK (kaynak IN ('duraksama','teslim_noktasi','liman_ziyareti')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polygon_egitim_liman
  ON public.liman_polygon_egitim(liman_id, created_at DESC);

COMMENT ON TABLE public.liman_polygon_egitim IS
  'Liman sınırı öğrenme verisi — anonim crowd-source. firma_id ve user_id YOK. Şoför duraksamalarından beslenir, ConvexHull ile polygon türetilir.';

-- -----------------------------------------------------------------------------
-- 2) RLS — bu tabloya doğrudan SELECT yok (anonimliği güçlendir)
-- -----------------------------------------------------------------------------
-- Sadece SECURITY DEFINER fonksiyonlar bu tabloyu okur. Uygulama hesapları
-- ham noktaları görmesin (gerçi zaten firma_id yok ama defansif).
ALTER TABLE public.liman_polygon_egitim ENABLE ROW LEVEL SECURITY;
-- Hiç policy yok = hiç kimse okuyamaz/yazamaz. SECURITY DEFINER bypass eder.

-- -----------------------------------------------------------------------------
-- 3) DURAKSAMA TRIGGER — şoför limanda durdu mu? Eğitim verisine ekle
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_duraksama_liman_egitim()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_teslim_yeri  text;
  v_teslim_lat   double precision;
  v_teslim_lng   double precision;
  v_liman_id     uuid;
  v_point        geometry;
BEGIN
  -- Sadece is_emri_id'li duraksamalar (rastgele duraksamalardan öğrenme yok)
  IF NEW.is_emri_id IS NULL OR NEW.merkez_lat IS NULL OR NEW.merkez_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- İş emrinin teslim adresini al
  SELECT teslim_yeri, teslim_lat, teslim_lng
    INTO v_teslim_yeri, v_teslim_lat, v_teslim_lng
    FROM public.is_emirleri
   WHERE id = NEW.is_emri_id;

  IF v_teslim_yeri IS NULL THEN RETURN NEW; END IF;

  -- 1) ÖNCE: lat/lng polygon match dene (mevcut polygon doğru çalışıyorsa)
  v_point := ST_SetSRID(ST_MakePoint(NEW.merkez_lng, NEW.merkez_lat), 4326);
  SELECT id INTO v_liman_id
    FROM public.limanlar
   WHERE aktif = true
     AND ST_Contains(poligon, v_point)
   ORDER BY (firma_id IS NULL)
   LIMIT 1;

  -- 2) Polygon match başarısızsa text match dene (Pre-seed polygon yanlış olabilir)
  IF v_liman_id IS NULL THEN
    v_liman_id := public.liman_by_text(v_teslim_yeri);
    -- Text match yapıldıysa: duraksama noktasının teslim_lat/lng'ye yakın olması da şart
    -- (teslim "Kumport" yazıyor ama şoför Avcılar'da yemek yiyor olabilir).
    IF v_liman_id IS NOT NULL AND v_teslim_lat IS NOT NULL THEN
      IF public._mesafe_m(NEW.merkez_lat, NEW.merkez_lng, v_teslim_lat, v_teslim_lng) > 1500 THEN
        v_liman_id := NULL;   -- 1.5 km'den uzaksa "limanda değil"
      END IF;
    END IF;
  END IF;

  IF v_liman_id IS NULL THEN RETURN NEW; END IF;

  -- 3) Eğitim verisine ekle (anonim)
  INSERT INTO public.liman_polygon_egitim (liman_id, lat, lng, kaynak)
  VALUES (v_liman_id, NEW.merkez_lat, NEW.merkez_lng, 'duraksama');

  -- 4) Bu liman için yeterince veri birikti mi? Eşik: 30 nokta + son polygon
  --    güncellemesi 24 saatten eski. Tetikledikten sonra polygon yeniden hesaplanır.
  PERFORM public.liman_polygon_belki_ogren(v_liman_id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_duraksama_liman_egitim ON public.surucu_duraksamalar;
CREATE TRIGGER trg_duraksama_liman_egitim
  AFTER INSERT ON public.surucu_duraksamalar
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_duraksama_liman_egitim();

-- -----------------------------------------------------------------------------
-- 4) POLYGON HESAPLAMA — ConvexHull (yeterince veri varsa)
-- -----------------------------------------------------------------------------
-- 30+ eğitim noktası varsa bir limanın polygon'unu yeniden hesaplar.
-- Sadece "Pre-seed" veya "Auto-learned" notlu limanlar güncellenir →
-- manuel çizilmiş polygon'lara dokunulmaz (yöneticiler güvensin).
CREATE OR REPLACE FUNCTION public.liman_polygon_belki_ogren(p_liman_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_nokta_say   integer;
  v_son_ogren   timestamptz;
  v_notlar      text;
  v_yeni_geom   geometry;
  v_eski_geom   geometry;
  v_alan_orani  double precision;
BEGIN
  -- Mevcut liman bilgisi
  SELECT notlar, poligon INTO v_notlar, v_eski_geom
    FROM public.limanlar WHERE id = p_liman_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Manuel düzenlenmiş polygon'u koru — sadece pre-seed/auto-learned'e dokun
  IF v_notlar IS NULL OR
     NOT (v_notlar LIKE 'Pre-seed%' OR v_notlar LIKE 'Auto-learned%') THEN
    RETURN false;
  END IF;

  -- Bu limanın eğitim noktası sayısı
  SELECT COUNT(*) INTO v_nokta_say
    FROM public.liman_polygon_egitim
    WHERE liman_id = p_liman_id;

  IF v_nokta_say < 30 THEN RETURN false; END IF;

  -- Son polygon güncellemesi tarihi (notlardan parse et)
  -- Format: "Auto-learned YYYY-MM-DD, N nokta"
  IF v_notlar LIKE 'Auto-learned%' THEN
    BEGIN
      v_son_ogren := substring(v_notlar from 'Auto-learned (\d{4}-\d{2}-\d{2})')::timestamptz;
    EXCEPTION WHEN OTHERS THEN v_son_ogren := NULL; END;
  END IF;

  -- 24 saatte bir öğren (gereksiz hesaplama yok)
  IF v_son_ogren IS NOT NULL AND v_son_ogren > now() - interval '24 hours' THEN
    RETURN false;
  END IF;

  -- ConvexHull hesapla — tüm eğitim noktalarını saran en küçük dışbükey polygon
  -- Buffer ile küçük bir margin (~50m) ekleyelim ki sınır noktalar dışta kalmasın.
  SELECT ST_Buffer(
           ST_ConvexHull(ST_Collect(ST_SetSRID(ST_MakePoint(lng, lat), 4326))),
           0.0005    -- yaklaşık 50m (1 derece ≈ 111km)
         )::geometry(Polygon, 4326)
    INTO v_yeni_geom
    FROM public.liman_polygon_egitim
    WHERE liman_id = p_liman_id;

  IF v_yeni_geom IS NULL THEN RETURN false; END IF;

  -- Sanity check: yeni polygon eski polygonun en az %20'si büyüklükte mi?
  -- (tek bir outlier ile aşırı küçük polygon türemesin)
  IF v_eski_geom IS NOT NULL THEN
    v_alan_orani := ST_Area(v_yeni_geom) / NULLIF(ST_Area(v_eski_geom), 0);
    IF v_alan_orani IS NULL OR v_alan_orani < 0.2 THEN
      RAISE LOG 'liman_polygon_belki_ogren(%): yeni polygon çok küçük (%.0f%%), atlandı',
                p_liman_id, v_alan_orani * 100;
      RETURN false;
    END IF;
  END IF;

  -- Polygon güncelle
  UPDATE public.limanlar
     SET poligon = v_yeni_geom,
         notlar  = format('Auto-learned %s, %s nokta',
                          to_char(now(), 'YYYY-MM-DD'),
                          v_nokta_say),
         updated_at = now()
   WHERE id = p_liman_id;

  RAISE LOG 'liman_polygon_belki_ogren(%): polygon güncellendi, % nokta',
            p_liman_id, v_nokta_say;
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_polygon_belki_ogren(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) Toplu öğrenme — tüm limanlar için (cron ile saatlik/günlük)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liman_polygonlari_ogren()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  r           record;
  v_guncellendi integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT liman_id FROM public.liman_polygon_egitim
  LOOP
    IF public.liman_polygon_belki_ogren(r.liman_id) THEN
      v_guncellendi := v_guncellendi + 1;
    END IF;
  END LOOP;
  RETURN v_guncellendi;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_polygonlari_ogren() TO authenticated;

COMMENT ON FUNCTION public.liman_polygonlari_ogren IS
  'Tüm limanların polygon''larını eğitim verisinden ConvexHull ile yeniden hesaplar. Sadece Pre-seed/Auto-learned notlu olanlar güncellenir. Cron ile günlük çağrı önerilir.';

-- -----------------------------------------------------------------------------
-- 6) İstatistik RPC — yöneticilere "kaç nokta" göstermeden polygon kalitesi
-- -----------------------------------------------------------------------------
-- Bu RPC çağrılmazsa hiçbir UI öğrenme verisini göstermez. UI gösterirse de
-- kasıtlı (ileride admin paneli için). Şimdilik bu fonksiyon sadece debug.
CREATE OR REPLACE FUNCTION public.liman_polygon_egitim_durum()
RETURNS TABLE (
  liman_id        uuid,
  liman_ad        text,
  egitim_nokta    integer,
  son_egitim_at   timestamptz,
  notlar          text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    l.id, l.ad,
    COALESCE((SELECT COUNT(*)::int FROM public.liman_polygon_egitim
                WHERE liman_id = l.id), 0),
    (SELECT MAX(created_at) FROM public.liman_polygon_egitim
       WHERE liman_id = l.id),
    l.notlar
  FROM public.limanlar l
  WHERE l.aktif = true
  ORDER BY l.ad;
$$;

GRANT EXECUTE ON FUNCTION public.liman_polygon_egitim_durum() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) Eski eğitim verisi temizliği (cron) — 90 günden eski → sil
-- -----------------------------------------------------------------------------
-- Tablonun büyümesini engellemek için. Limanlar zamanla genişler/değişebilir;
-- 90 günlük rolling window optimumdur.
CREATE OR REPLACE FUNCTION public.liman_polygon_egitim_temizle()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.liman_polygon_egitim
   WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_polygon_egitim_temizle() TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA / TEST
-- =============================================================================
-- 1) Bir şoförün Kumport'ta duraksaması simüle:
--    INSERT INTO surucu_duraksamalar (firma_id, user_id, is_emri_id, baslangic_at,
--                                     merkez_lat, merkez_lng, otomatik_mi)
--    VALUES (..., ..., 46, now(), 40.982, 28.700, true);
--    -- Trigger'ın liman_polygon_egitim'e nokta eklediğini gör:
--    SELECT * FROM liman_polygon_egitim ORDER BY id DESC LIMIT 5;
--
-- 2) Manuel öğrenme tetikle:
--    SELECT liman_polygon_belki_ogren('uuid-of-kumport');
--
-- 3) Tüm limanlar için:
--    SELECT liman_polygonlari_ogren();
--
-- 4) Durum:
--    SELECT * FROM liman_polygon_egitim_durum();
--
-- ROADMAP:
--   • Şu anki ConvexHull bazen aşırı geniş alan üretebilir (outlier şoförler).
--     İleride alpha-shape veya DBSCAN clustering ile dış kümeler atılabilir.
--   • Kaynak çeşitliliği: 'teslim_noktasi' (yüklü teslim sırasında lat/lng) ve
--     'liman_ziyareti' (mevcut polygon ziyareti — feedback loop) eklenecek.
-- =============================================================================
