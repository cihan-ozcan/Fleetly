-- =============================================================================
-- FLEETLY  —  2026-05-05i  —  Harcırah: sofor_user_id eşleştirme düzeltmesi
-- =============================================================================
-- Sorun: Şoför Android'de "Kazançlarım"da onaylanmış kayıtları göremiyor.
-- Sebep: harcirah_kayitlari.sofor_user_id NULL olarak kaydediliyor çünkü
--        is_emirleri.sofor_user_id de NULL olabiliyor (şoför davet sonrası
--        uygulamaya bağlanmadıysa veya backfill çalışmadıysa).
--        Şoför listForWeek sorgusu eq("sofor_user_id", driverUserId) yapar →
--        NULL kayıtlar gelmez → liste boş.
--
-- Düzeltmeler:
--   1) trg_isemri_harcirah_olustur — sofor_user_id NULL ise davet tablosundan
--      telefon match'i ile bul.
--   2) Yeni trigger: is_emirleri.sofor_user_id UPDATE olduğunda harcirah
--      kayıtları senkronlanır (sonradan eşleşme yapılırsa).
--   3) Geriye dönük tek seferlik UPDATE — mevcut NULL kayıtları doldur.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Yardımcı: telefon normalizasyonu (boşluk, tire, parantez kaldırır)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tel_normalize(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(coalesce(p, ''), '[\s\-\(\)\.]+', '', 'g'), '');
$$;

-- -----------------------------------------------------------------------------
-- 2) Yardımcı: iş emrinin sofor_user_id'sini bul (varsa direkt, yoksa davet
--    tablosundan telefon ile match)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_emri_sofor_user_id(p_isemri public.is_emirleri)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_isemri.sofor_user_id IS NOT NULL THEN
    RETURN p_isemri.sofor_user_id;
  END IF;

  -- Telefon ile davet tablosundan match
  IF p_isemri.sofor_tel IS NOT NULL THEN
    SELECT d.kullanan_user_id INTO v_user
      FROM public.surucu_davetleri d
     WHERE d.kullanildi_at IS NOT NULL
       AND d.kullanan_user_id IS NOT NULL
       AND _tel_normalize(d.telefon) = _tel_normalize(p_isemri.sofor_tel)
     ORDER BY d.kullanildi_at DESC
     LIMIT 1;
    IF v_user IS NOT NULL THEN RETURN v_user; END IF;
  END IF;

  -- Ad ile match (fallback — daha az güvenilir, son çare)
  IF p_isemri.sofor IS NOT NULL THEN
    SELECT d.kullanan_user_id INTO v_user
      FROM public.surucu_davetleri d
     WHERE d.kullanildi_at IS NOT NULL
       AND d.kullanan_user_id IS NOT NULL
       AND lower(trim(d.ad)) = lower(trim(p_isemri.sofor))
     ORDER BY d.kullanildi_at DESC
     LIMIT 1;
  END IF;

  RETURN v_user;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Harcırah oluşturma trigger'ını güncelle — sofor_user_id'yi davet'ten çöz
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_isemri_harcirah_olustur()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tarife        record;
  v_kayit_id      uuid;
  v_dorse_tipi    text;
  v_is_tarihi     date;
  v_arac_plaka    text;
  v_baslik        text;
  v_mesaj         text;
  v_sofor_user_id uuid;
BEGIN
  IF NEW.firma_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.durum = 'İptal'  THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.harcirah_kayitlari WHERE is_emri_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_is_tarihi  := COALESCE(NEW.atama_zamani::date, NEW.created_at::date, CURRENT_DATE);
  v_arac_plaka := COALESCE(NEW.arac_plaka, '');

  -- *** YENİ: sofor_user_id'yi davet tablosundan da dene ***
  v_sofor_user_id := public._is_emri_sofor_user_id(NEW);

  -- Dorse tipi (varsa)
  v_dorse_tipi := NULL;
  IF NEW.dorse_id IS NOT NULL THEN
    SELECT a.dorse_tipi INTO v_dorse_tipi
      FROM public.araclar a
     WHERE a.id = NEW.dorse_id
     LIMIT 1;
  END IF;

  -- Tarife bul
  BEGIN
    SELECT * INTO v_tarife FROM public.harcirah_tarife_bul(
      NEW.firma_id, NEW.yukle_yeri, NEW.teslim_yeri, NEW.kont_tip, NEW.kont_durum,
      v_dorse_tipi, v_is_tarihi
    ) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_tarife := NULL;
  END;

  IF v_tarife.id IS NOT NULL THEN
    INSERT INTO public.harcirah_kayitlari (
      firma_id, is_emri_id, sofor_user_id, sofor_ad, arac_id, arac_plaka,
      tarife_id, hesaplanan_tutar, is_tarihi, durum
    ) VALUES (
      NEW.firma_id, NEW.id,
      v_sofor_user_id,                    -- *** Davet'ten çözülmüş user_id ***
      NEW.sofor,
      COALESCE(NEW.cekici_id, NULL),
      v_arac_plaka,
      v_tarife.id,
      v_tarife.tutar,
      v_is_tarihi,
      'beklemede'
    ) RETURNING id INTO v_kayit_id;

    v_baslik := COALESCE(v_arac_plaka, '#' || NEW.id::text) || ' — Harcırah hesaplandı: ' ||
                to_char(v_tarife.tutar, 'FM999G999D90') || ' ₺';
    v_mesaj  := COALESCE(v_tarife.baslik, '') ||
                CASE WHEN v_tarife.eslesen_bolge IS NOT NULL THEN ' · Bölge: ' || v_tarife.eslesen_bolge ELSE '' END ||
                ' · ' || COALESCE(NEW.musteri_adi, 'Müşteri');
    BEGIN
      PERFORM public.notify_create(
        NEW.firma_id, 'genel', v_baslik, v_mesaj,
        'is_emri', NEW.id::text, v_sofor_user_id,
        COALESCE(NEW.sofor, v_arac_plaka), 'normal'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSE
    v_baslik := COALESCE(v_arac_plaka, '#' || NEW.id::text) || ' — Tarife eşleşmedi';
    v_mesaj  := 'Bu rota için tarife bulunamadı: ' ||
                COALESCE(NEW.yukle_yeri, '?') || ' → ' || COALESCE(NEW.teslim_yeri, '?') ||
                CASE WHEN NEW.kont_tip IS NOT NULL THEN ' · ' || NEW.kont_tip ELSE '' END ||
                '. Harcırah modülünden manuel girilebilir.';
    BEGIN
      PERFORM public.notify_create(
        NEW.firma_id, 'genel', v_baslik, v_mesaj,
        'is_emri', NEW.id::text, NULL,
        COALESCE(NEW.sofor, v_arac_plaka), 'normal'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_isemri_harcirah_olustur hata: %', SQLERRM;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- 4) is_emirleri.sofor_user_id sonradan dolarsa harcirah'ı senkronize et
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_isemri_harcirah_sofor_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- sofor_user_id NULL'dan değere döndüyse harcırah kayıtlarını da güncelle
  IF NEW.sofor_user_id IS NOT NULL
     AND (OLD.sofor_user_id IS NULL OR OLD.sofor_user_id <> NEW.sofor_user_id) THEN
    UPDATE public.harcirah_kayitlari
       SET sofor_user_id = NEW.sofor_user_id,
           sofor_ad      = COALESCE(sofor_ad, NEW.sofor)
     WHERE is_emri_id = NEW.id
       AND (sofor_user_id IS NULL OR sofor_user_id <> NEW.sofor_user_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_isemri_harcirah_sofor_sync ON public.is_emirleri;
CREATE TRIGGER trg_isemri_harcirah_sofor_sync
  AFTER UPDATE OF sofor_user_id ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_isemri_harcirah_sofor_sync();

-- -----------------------------------------------------------------------------
-- 5) Geriye dönük backfill — mevcut NULL kayıtları doldur (tek seferlik)
-- -----------------------------------------------------------------------------
-- 5a) Önce iş emirlerindeki NULL sofor_user_id'leri davet'ten doldur
UPDATE public.is_emirleri ie
   SET sofor_user_id = sub.kullanan_user_id
  FROM (
    SELECT DISTINCT ON (d.kullanan_user_id)
           d.kullanan_user_id,
           _tel_normalize(d.telefon) AS norm_tel,
           lower(trim(d.ad))         AS norm_ad
      FROM public.surucu_davetleri d
     WHERE d.kullanildi_at IS NOT NULL
       AND d.kullanan_user_id IS NOT NULL
     ORDER BY d.kullanan_user_id, d.kullanildi_at DESC
  ) sub
 WHERE ie.sofor_user_id IS NULL
   AND (
     (_tel_normalize(ie.sofor_tel) = sub.norm_tel AND ie.sofor_tel IS NOT NULL)
     OR (lower(trim(ie.sofor)) = sub.norm_ad AND ie.sofor IS NOT NULL)
   );

-- 5b) Şimdi harcirah_kayitlari'ndaki NULL'ları is_emirleri'nden doldur
UPDATE public.harcirah_kayitlari hk
   SET sofor_user_id = ie.sofor_user_id,
       sofor_ad      = COALESCE(hk.sofor_ad, ie.sofor)
  FROM public.is_emirleri ie
 WHERE hk.is_emri_id = ie.id
   AND hk.sofor_user_id IS NULL
   AND ie.sofor_user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6) Manuel düzeltme RPC — yönetici tek tıkla mevcut NULL'ları yeniden dener
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_sofor_match_yenile()
RETURNS TABLE (isemri_guncellenen integer, harcirah_guncellenen integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
  v_isemri   integer;
  v_harc     integer;
BEGIN
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid()
     AND fk.rol IN ('sahip','yonetici','operasyoncu')
   LIMIT 1;
  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Yetki yok' USING ERRCODE = '42501';
  END IF;

  -- 1) is_emirleri NULL'lerini davet'ten doldur
  WITH upd AS (
    UPDATE public.is_emirleri ie
       SET sofor_user_id = sub.kullanan_user_id
      FROM (
        SELECT DISTINCT ON (d.kullanan_user_id)
               d.kullanan_user_id,
               _tel_normalize(d.telefon) AS norm_tel,
               lower(trim(d.ad))         AS norm_ad
          FROM public.surucu_davetleri d
         WHERE d.kullanildi_at IS NOT NULL
           AND d.kullanan_user_id IS NOT NULL
         ORDER BY d.kullanan_user_id, d.kullanildi_at DESC
      ) sub
     WHERE ie.firma_id = v_firma_id
       AND ie.sofor_user_id IS NULL
       AND (
         (_tel_normalize(ie.sofor_tel) = sub.norm_tel AND ie.sofor_tel IS NOT NULL)
         OR (lower(trim(ie.sofor)) = sub.norm_ad AND ie.sofor IS NOT NULL)
       )
     RETURNING ie.id
  )
  SELECT count(*)::integer INTO v_isemri FROM upd;

  -- 2) harcirah_kayitlari NULL'larını is_emirleri'nden doldur
  WITH upd2 AS (
    UPDATE public.harcirah_kayitlari hk
       SET sofor_user_id = ie.sofor_user_id,
           sofor_ad      = COALESCE(hk.sofor_ad, ie.sofor)
      FROM public.is_emirleri ie
     WHERE hk.firma_id = v_firma_id
       AND hk.is_emri_id = ie.id
       AND hk.sofor_user_id IS NULL
       AND ie.sofor_user_id IS NOT NULL
     RETURNING hk.id
  )
  SELECT count(*)::integer INTO v_harc FROM upd2;

  RETURN QUERY SELECT v_isemri, v_harc;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_sofor_match_yenile() TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1. Backfill durumu — kaç kayıt NULL kaldı?
--    SELECT
--      count(*) FILTER (WHERE sofor_user_id IS NULL)  AS null_kayitlar,
--      count(*) FILTER (WHERE sofor_user_id IS NOT NULL) AS dolu_kayitlar
--    FROM public.harcirah_kayitlari;
--
-- 2. Manuel yeniden eşleştirme:
--    SELECT * FROM public.harcirah_sofor_match_yenile();
--
-- 3. Hangi şoförlere ait kayıt var:
--    SELECT sofor_user_id, sofor_ad, count(*) FROM public.harcirah_kayitlari
--    GROUP BY 1, 2 ORDER BY count(*) DESC;
-- =============================================================================
