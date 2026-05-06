-- =============================================================================
-- FLEETLY  —  2026-05-06g  —  Şoför Duraksamaları
-- =============================================================================
-- Şoförün limanda / fabrikada / yolda uzun süreli durduğu noktaları kayıt altına
-- alır. Trafikten ayırt edilir (trafik = yavaş hareket eden konum, duraksama =
-- sabit konum). Otomatik (server-side trigger) ve manuel (şoför butonu) modlar.
--
-- Eşikler (kullanıcı onayı, 2026-05-06):
--   • Min duraksama süresi    : 10 dakika
--   • Sabit kalma yarıçapı    : 75 m
--   • "Hareket başladı" eşiği : merkezden > 100 m  VEYA  hız > 5 km/sa
--   • Max ort hız (içeride)   : 3 km/sa (yürüme altı = duraksama)
--
-- Bölge etiketi: otomatik (yakın iş emrinin yukle/teslim/bos_alim_yer'den 200m
-- içinde) doldurulur, şoför manuel düzenleyebilir.
--
-- Bağımlılık: 2026_05_06d (konum_hiz kolonu), is_emirleri (lat/lng alanları)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) HAVERSINE YARDIMCI FONKSİYON
-- -----------------------------------------------------------------------------
-- earthdistance extension'a gerek kalmadan haversine ile mesafe (metre).
CREATE OR REPLACE FUNCTION public._mesafe_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  R    double precision := 6371000.0;     -- dünya yarıçapı (m)
  dLat double precision;
  dLng double precision;
  a    double precision;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  dLat := radians(lat2 - lat1);
  dLng := radians(lng2 - lng1);
  a := sin(dLat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLng/2)^2;
  RETURN R * 2 * asin(sqrt(a));
END $$;

COMMENT ON FUNCTION public._mesafe_m IS
  'İki lat/lng noktası arasındaki haversine mesafesi (metre). NULL girişte NULL döner.';

-- -----------------------------------------------------------------------------
-- 2) TABLO
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_duraksamalar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  is_emri_id      bigint REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  baslangic_at    timestamptz NOT NULL DEFAULT now(),
  bitis_at        timestamptz,                            -- NULL = aktif duraksama
  merkez_lat      double precision NOT NULL,
  merkez_lng      double precision NOT NULL,
  yaricap_m       integer DEFAULT 75,                     -- gerçek hareket alanı
  bolge_etiket    text,                                   -- "Kumport", "Mardaş 2 No Kapı" — otomatik veya manuel
  otomatik_mi     boolean NOT NULL DEFAULT true,          -- false = şoför manuel başlattı
  notlar          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_duraksama_user_aktif
  ON public.surucu_duraksamalar(user_id, baslangic_at DESC)
  WHERE bitis_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_duraksama_isemri
  ON public.surucu_duraksamalar(is_emri_id) WHERE is_emri_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_duraksama_firma
  ON public.surucu_duraksamalar(firma_id, baslangic_at DESC);

COMMENT ON TABLE public.surucu_duraksamalar IS
  'Şoför duraksamaları (idle/bekleme noktaları). Trafik durumlarından (yavaş hareket) ayırt edilir. Otomatik trigger + manuel RPC ile yazılır.';

-- -----------------------------------------------------------------------------
-- 3) RLS — aynı firma + kendi kayıtları
-- -----------------------------------------------------------------------------
ALTER TABLE public.surucu_duraksamalar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS duraksama_select ON public.surucu_duraksamalar;
CREATE POLICY duraksama_select ON public.surucu_duraksamalar
  FOR SELECT TO authenticated
  USING (
    firma_id IN (SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS duraksama_insert ON public.surucu_duraksamalar;
CREATE POLICY duraksama_insert ON public.surucu_duraksamalar
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());  -- otomatik trigger SECURITY DEFINER ile çalıştığı için bypass'lar

DROP POLICY IF EXISTS duraksama_update ON public.surucu_duraksamalar;
CREATE POLICY duraksama_update ON public.surucu_duraksamalar
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
  );

DROP POLICY IF EXISTS duraksama_delete ON public.surucu_duraksamalar;
CREATE POLICY duraksama_delete ON public.surucu_duraksamalar
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
    )
  );

-- -----------------------------------------------------------------------------
-- 4) BÖLGE ETİKET BUL — otomatik
-- -----------------------------------------------------------------------------
-- 200m içinde yukle_yeri / teslim_yeri / bos_alim_yer eşleşmesi var mı kontrol et,
-- en yakını al. Yoksa NULL döner.
CREATE OR REPLACE FUNCTION public._duraksama_etiket_bul(
  p_user_id uuid, p_is_emri_id bigint, p_lat double precision, p_lng double precision
) RETURNS text
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_etiket text;
  v_dist   double precision;
  v_best   double precision := 999999;
BEGIN
  IF p_is_emri_id IS NOT NULL THEN
    SELECT
      COALESCE(
        CASE WHEN i.yukle_lat IS NOT NULL
             AND public._mesafe_m(p_lat, p_lng, i.yukle_lat, i.yukle_lng) < 200
             THEN i.yukle_yeri END,
        CASE WHEN i.teslim_lat IS NOT NULL
             AND public._mesafe_m(p_lat, p_lng, i.teslim_lat, i.teslim_lng) < 200
             THEN i.teslim_yeri END,
        i.bos_alim_yer  -- son çare: text snapshot
      )
      INTO v_etiket
      FROM public.is_emirleri i
      WHERE i.id = p_is_emri_id;
  END IF;
  RETURN v_etiket;
END $$;

-- -----------------------------------------------------------------------------
-- 5) OTOMATİK ALGI TRIGGER — konum_izleri AFTER INSERT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_konum_duraksama_algila()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open       public.surucu_duraksamalar%ROWTYPE;
  v_dist       double precision;
  v_kmh        numeric;
  v_firma_id   uuid;
  v_etiket     text;
  v_son10dk_count int;
  v_son10dk_max_dist double precision;
  v_merkez_lat double precision;
  v_merkez_lng double precision;
  v_son10dk_avg_kmh numeric;
  v_baslangic_at timestamptz;
BEGIN
  IF NEW.user_id IS NULL OR NEW.lat IS NULL OR NEW.lng IS NULL THEN
    RETURN NEW;
  END IF;

  v_kmh := COALESCE(NEW.hiz, 0) * 3.6;

  -- 1) AÇIK DURAKSAMA VAR MI?
  SELECT * INTO v_open
    FROM public.surucu_duraksamalar
    WHERE user_id = NEW.user_id AND bitis_at IS NULL
    ORDER BY baslangic_at DESC LIMIT 1;

  IF FOUND THEN
    v_dist := public._mesafe_m(v_open.merkez_lat, v_open.merkez_lng, NEW.lat, NEW.lng);
    -- Hareket başladı mı? merkezden > 100m VEYA hız > 5 km/sa
    IF (v_dist IS NOT NULL AND v_dist > 100) OR v_kmh > 5 THEN
      UPDATE public.surucu_duraksamalar SET bitis_at = now() WHERE id = v_open.id;
    END IF;
    -- Aktif duraksama varken yeni başlatma — return
    RETURN NEW;
  END IF;

  -- 2) AÇIK DURAKSAMA YOK — son 10 dakikayı analiz et
  -- Şoförün son 10 dakika içindeki tüm noktaları
  SELECT COUNT(*),
         AVG(lat), AVG(lng),
         MAX(public._mesafe_m(NEW.lat, NEW.lng, lat, lng)),
         AVG(COALESCE(hiz, 0)) * 3.6,
         MIN(ts)
    INTO v_son10dk_count, v_merkez_lat, v_merkez_lng, v_son10dk_max_dist, v_son10dk_avg_kmh, v_baslangic_at
    FROM public.konum_izleri
    WHERE user_id = NEW.user_id
      AND ts > now() - interval '10 minutes';

  -- En az 5 nokta + tüm noktalar 75m yarıçap içinde + ort hız < 3 km/sa
  IF v_son10dk_count IS NULL OR v_son10dk_count < 5 THEN RETURN NEW; END IF;
  IF v_son10dk_max_dist IS NULL OR v_son10dk_max_dist > 75 THEN RETURN NEW; END IF;
  IF v_son10dk_avg_kmh IS NOT NULL AND v_son10dk_avg_kmh > 3 THEN RETURN NEW; END IF;

  -- Şoförün firma_id'si — suruculer veya firma_kullanicilar
  SELECT firma_id INTO v_firma_id FROM (
    SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = NEW.user_id
    UNION
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = NEW.user_id
  ) x LIMIT 1;
  IF v_firma_id IS NULL THEN RETURN NEW; END IF;

  -- Bölge etiketi otomatik bul
  v_etiket := public._duraksama_etiket_bul(NEW.user_id, NEW.is_emri_id, v_merkez_lat, v_merkez_lng);

  INSERT INTO public.surucu_duraksamalar
    (firma_id, user_id, is_emri_id, baslangic_at,
     merkez_lat, merkez_lng, yaricap_m, bolge_etiket, otomatik_mi)
  VALUES
    (v_firma_id, NEW.user_id, NEW.is_emri_id, COALESCE(v_baslangic_at, now()),
     v_merkez_lat, v_merkez_lng, GREATEST(v_son10dk_max_dist::int, 30), v_etiket, true);

  -- Yöneticiye sade bildirim
  PERFORM public.notify_create(
    v_firma_id, 'genel',
    '🅿️ Duraksama algılandı',
    COALESCE(v_etiket, 'Bilinmeyen bölge') || ' — 10dk+ hareketsiz',
    'duraksama', NULL, NEW.user_id, NULL, 'dusuk'
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_konum_duraksama_algila ON public.konum_izleri;
CREATE TRIGGER trg_konum_duraksama_algila
  AFTER INSERT ON public.konum_izleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_konum_duraksama_algila();

-- -----------------------------------------------------------------------------
-- 6) MANUEL RPC'ler — şoför "duraksıyorum" tıkladığında
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sofor_duraksama_baslat(
  p_lat       double precision,
  p_lng       double precision,
  p_is_emri_id bigint DEFAULT NULL,
  p_etiket    text   DEFAULT NULL,
  p_notlar    text   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_firma_id uuid;
  v_etiket   text := p_etiket;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'Konum (lat,lng) zorunlu.' USING ERRCODE = '23502';
  END IF;

  SELECT firma_id INTO v_firma_id FROM (
    SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = v_uid
    UNION
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = v_uid
  ) x LIMIT 1;
  IF v_firma_id IS NULL THEN RAISE EXCEPTION 'firma bulunamadı' USING ERRCODE = '23502'; END IF;

  -- Otomatik etiket dene (kullanıcı vermediyse)
  IF v_etiket IS NULL OR length(trim(v_etiket)) = 0 THEN
    v_etiket := public._duraksama_etiket_bul(v_uid, p_is_emri_id, p_lat, p_lng);
  END IF;

  -- Açık duraksaması varsa onu kapat (yeni manuel)
  UPDATE public.surucu_duraksamalar SET bitis_at = now()
   WHERE user_id = v_uid AND bitis_at IS NULL;

  INSERT INTO public.surucu_duraksamalar
    (firma_id, user_id, is_emri_id, merkez_lat, merkez_lng, yaricap_m,
     bolge_etiket, otomatik_mi, notlar)
  VALUES
    (v_firma_id, v_uid, p_is_emri_id, p_lat, p_lng, 50,
     v_etiket, false, p_notlar)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.sofor_duraksama_bitir(p_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501'; END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.surucu_duraksamalar SET bitis_at = now()
     WHERE id = p_id AND user_id = v_uid AND bitis_at IS NULL;
  ELSE
    UPDATE public.surucu_duraksamalar SET bitis_at = now()
     WHERE user_id = v_uid AND bitis_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END $$;

CREATE OR REPLACE FUNCTION public.sofor_duraksama_etiket_guncelle(p_id uuid, p_etiket text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.surucu_duraksamalar SET bolge_etiket = NULLIF(trim(p_etiket), '')
   WHERE id = p_id AND (user_id = auth.uid() OR firma_id IN (
     SELECT fk.firma_id FROM public.firma_kullanicilar fk
     WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
   ));
END $$;

GRANT EXECUTE ON FUNCTION public.sofor_duraksama_baslat(double precision, double precision, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sofor_duraksama_bitir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sofor_duraksama_etiket_guncelle(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) Realtime publication
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.surucu_duraksamalar;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;
