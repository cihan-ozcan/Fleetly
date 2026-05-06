-- =============================================================================
-- FLEETLY  —  2026-05-06q  —  Duraksama otomatik algılama: soğuma süresi
-- =============================================================================
-- Şoför "Yola Devam Ediyorum" diyerek manuel duraksamayı kapattıktan SONRA
-- hemen yeni bir konum noktası gelirse, mevcut trigger (trg_konum_duraksama_algila)
-- "açık duraksama YOK → son 10dk hareketsizse otomatik aç" mantığıyla şoför
-- aynı yerde durduğu için derhal yeni otomatik duraksama açıyordu.
--
-- Sonuç: kullanıcının deneyimi → "Yola Devam Et bastım, alttaki banner
--        sonlandı dedi ama hâlâ Yola Devam Et butonu duruyor."
--
-- Çözüm: SOĞUMA SÜRESİ ekle. Son kapatılan duraksamadan en az 10 dakika
-- geçmeden trigger yeni otomatik duraksama açmaz.
--   • Manuel kapatma (sofor_duraksama_bitir) → 10dk soğuma
--   • Otomatik kapatma (hareket başladı) → 10dk soğuma
-- (Şoför hareket etmeye devam ediyorsa zaten 75m yarıçap eşiği yeni duraksamayı
--  engelliyor — bu fix sadece "yerinde duruyorum, yeniden yola çıkıyorum"
--  senaryosunu ele alıyor.)
--
-- Bağımlılık: 2026_05_06g (trg_konum_duraksama_algila + surucu_duraksamalar tablosu).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- trg_konum_duraksama_algila — soğuma kontrollü sürüm
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
  v_son_kapanma timestamptz;     -- YENİ: son kapatılan duraksamanın bitis zamanı
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
    RETURN NEW;
  END IF;

  -- ── YENİ: SOĞUMA KONTROLÜ ──────────────────────────────────────────────
  -- Son kapatılan duraksamadan 10dk geçmediyse otomatik açma yap.
  -- Aksi takdirde şoför "Yola Devam Et" basıp hareket etmediği anda trigger
  -- aynı bölgeye yeni otomatik duraksama açıyordu — kullanıcı butonun
  -- takılı kaldığını sanıyor.
  SELECT MAX(bitis_at) INTO v_son_kapanma
    FROM public.surucu_duraksamalar
    WHERE user_id = NEW.user_id AND bitis_at IS NOT NULL;

  IF v_son_kapanma IS NOT NULL AND v_son_kapanma > now() - interval '10 minutes' THEN
    -- Soğuma süresi dolmadı — yeni otomatik duraksama açma
    RETURN NEW;
  END IF;

  -- 2) AÇIK DURAKSAMA YOK + soğuma OK — son 10 dakikayı analiz et
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

  -- Şoförün firma_id'si
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

-- Trigger zaten var — sadece fonksiyon güncellendiği için yeniden oluşturmaya gerek yok.
-- (DROP TRIGGER + CREATE TRIGGER yapılırsa NULL pointer ihtimali var; CREATE OR REPLACE
--  FUNCTION yeterli — trigger fonksiyonu çağırıyor zaten.)

COMMENT ON FUNCTION public.trg_konum_duraksama_algila IS
  'Otomatik duraksama algılama. 2026-05-06q: manuel/otomatik kapatma sonrası 10dk soğuma süresi eklendi → "Yola Devam Et" sonrası buton takılma bug''ı önlendi.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Manuel duraksama aç:
--    SELECT sofor_duraksama_baslat(40.97, 28.69, 1, 'Test');
--
-- 2) Hemen kapat:
--    SELECT sofor_duraksama_bitir();
--
-- 3) Hemen yeni konum gönder (aynı koord) → trigger soğuma yüzünden açmamalı:
--    SELECT sofor_konum_gonder(40.97, 28.69, NULL, 0, NULL, 1, 'auto');
--    SELECT * FROM surucu_duraksamalar WHERE user_id = auth.uid()
--      ORDER BY baslangic_at DESC LIMIT 3;
--    Beklenen: tek satır (kapanmış olan), yeni satır YOK.
--
-- 4) 10dk sonra (manuel zaman ileri al — psql'de \! veya pg_sleep):
--    Trigger normal çalışmalı (hareketsizlik tespit eder).
-- =============================================================================
