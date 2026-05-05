-- =============================================================================
-- FLEETLY  —  2026-05-05e  —  Harcırah: çoklu bölge + ek hizmetler
-- =============================================================================
-- Referans çalışmadaki gerçek tarife mantığı:
--   • Bir tarife BİRDEN ÇOK semte/bölgeye uygulanabilir
--     (örn. "Avcılar-Esenyurt-Hadımköy-Çatalca-Silivri" = 500 TL tek satır)
--   • Ek hizmetler ayrı tutar (Aktarma +300, Bekleme 7sa +350, ATS +100)
--
-- Bu migration:
--   1) harcirah_tarifeleri'ne bolgeler text[] kolonu ekle (eski teslim_yeri korunur)
--   2) Yeni tablo: harcirah_ek_hizmetler (Boş/Dolu Aktarma, ATS, Bekleme vb.)
--   3) Tarife match RPC'sini bolgeler[] kullanacak şekilde güncelle
--
-- Önkoşul: 2026_05_05d__harcirah_sistemi.sql çalıştırılmış olmalı.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) bolgeler text[] kolonu
-- -----------------------------------------------------------------------------
ALTER TABLE public.harcirah_tarifeleri
  ADD COLUMN IF NOT EXISTS bolgeler text[];

COMMENT ON COLUMN public.harcirah_tarifeleri.bolgeler IS
  'Bu tarifenin geçerli olduğu semt/bölge listesi (örn. ["Avcılar","Esenyurt","Çatalca"]). teslim_yeri kolonu geriye uyum için tutulur.';

-- GIN indeksi: bolgeler array içinde arama hızlı olsun
CREATE INDEX IF NOT EXISTS idx_tarife_bolgeler_gin
  ON public.harcirah_tarifeleri USING GIN (bolgeler);

-- -----------------------------------------------------------------------------
-- 2) Ek hizmetler tablosu
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.harcirah_ek_hizmetler (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id      uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kod           text NOT NULL,                  -- 'aktarma' | 'bekleme' | 'ats' | 'yari_harcirah' | 'diger'
  ad            text NOT NULL,                  -- "Boş/Dolu Aktarma"
  tutar         numeric(10,2) NOT NULL CHECK (tutar >= 0),
  hesaplama_tipi text NOT NULL DEFAULT 'sabit'
                CHECK (hesaplama_tipi IN ('sabit','yuzde','saatlik','yarim_tarife')),
  aciklama      text,                            -- "7 saat dolduğunda" gibi tetikleyici
  aktif_mi      boolean NOT NULL DEFAULT true,
  sira          smallint NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firma_id, kod)
);

CREATE INDEX IF NOT EXISTS idx_ek_hiz_firma_aktif
  ON public.harcirah_ek_hizmetler(firma_id, aktif_mi)
  WHERE aktif_mi = true;

COMMENT ON TABLE public.harcirah_ek_hizmetler IS
  'Ek hizmet tutarları (Aktarma, Bekleme, ATS, Yarı Harcırah vb.). Harcırah kaydında ek_masraflar olarak hesaba katılır.';

ALTER TABLE public.harcirah_ek_hizmetler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ek_hiz_select ON public.harcirah_ek_hizmetler;
CREATE POLICY ek_hiz_select ON public.harcirah_ek_hizmetler
  FOR SELECT TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS ek_hiz_insert ON public.harcirah_ek_hizmetler;
CREATE POLICY ek_hiz_insert ON public.harcirah_ek_hizmetler
  FOR INSERT TO authenticated
  WITH CHECK (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS ek_hiz_update ON public.harcirah_ek_hizmetler;
CREATE POLICY ek_hiz_update ON public.harcirah_ek_hizmetler
  FOR UPDATE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS ek_hiz_delete ON public.harcirah_ek_hizmetler;
CREATE POLICY ek_hiz_delete ON public.harcirah_ek_hizmetler
  FOR DELETE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
  ));

-- -----------------------------------------------------------------------------
-- 3) Tarife match RPC — bolgeler[] aware (eski teslim_yeri ile geriye uyumlu)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.harcirah_tarife_bul(uuid, text, text, text, text, text, date);

CREATE OR REPLACE FUNCTION public.harcirah_tarife_bul(
  p_firma_id    uuid,
  p_alim_yeri   text,
  p_teslim_yeri text,
  p_kont_tip    text  DEFAULT NULL,
  p_kont_durum  text  DEFAULT NULL,
  p_dorse_tipi  text  DEFAULT NULL,
  p_tarih       date  DEFAULT CURRENT_DATE
) RETURNS TABLE (id uuid, tutar numeric, baslik text, eslesen_bolge text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_teslim_norm text := lower(coalesce(p_teslim_yeri, ''));
BEGIN
  RETURN QUERY
  WITH cand AS (
    SELECT
      t.id, t.tutar, t.baslik,
      -- Bölge eşleşmesi: bolgeler[] içinden ilk match olanı al
      (
        SELECT b
        FROM unnest(COALESCE(t.bolgeler, ARRAY[]::text[])) AS b
        WHERE v_teslim_norm <> '' AND (
          v_teslim_norm LIKE '%' || lower(b) || '%' OR
          lower(b)      LIKE '%' || v_teslim_norm || '%'
        )
        LIMIT 1
      ) AS bolge_match,
      t.alim_yeri, t.teslim_yeri, t.kont_tip, t.kont_durum, t.dorse_tipi,
      t.bolgeler, t.oncelik, t.created_at
    FROM public.harcirah_tarifeleri t
    WHERE t.firma_id = p_firma_id
      AND t.aktif_mi = true
      AND (t.gecerli_baslangic IS NULL OR t.gecerli_baslangic <= p_tarih)
      AND (t.gecerli_bitis     IS NULL OR t.gecerli_bitis     >= p_tarih)
  )
  SELECT
    cand.id, cand.tutar, cand.baslik, cand.bolge_match
  FROM cand
  WHERE
    -- Bölge listesi varsa: en az bir bölge eşleşmeli
    (
      cand.bolgeler IS NULL OR array_length(cand.bolgeler, 1) IS NULL
      OR cand.bolge_match IS NOT NULL
    )
    -- Eski teslim_yeri (geriye uyum)
    AND (
      cand.teslim_yeri IS NULL OR p_teslim_yeri IS NULL
      OR lower(p_teslim_yeri) LIKE '%' || lower(cand.teslim_yeri) || '%'
      OR lower(cand.teslim_yeri) LIKE '%' || lower(p_teslim_yeri) || '%'
    )
    -- Alım yeri
    AND (
      cand.alim_yeri IS NULL OR p_alim_yeri IS NULL
      OR lower(p_alim_yeri) LIKE '%' || lower(cand.alim_yeri) || '%'
      OR lower(cand.alim_yeri) LIKE '%' || lower(p_alim_yeri) || '%'
    )
    -- Konteyner tipi
    AND (cand.kont_tip   IS NULL OR cand.kont_tip   = p_kont_tip)
    -- Dolu/Boş
    AND (cand.kont_durum IS NULL OR p_kont_durum IS NULL OR cand.kont_durum = p_kont_durum)
    -- Dorse tipi
    AND (cand.dorse_tipi IS NULL OR p_dorse_tipi IS NULL OR cand.dorse_tipi = p_dorse_tipi)
  ORDER BY
    -- Daha spesifik tarifeler önce gelsin
    (CASE WHEN cand.bolge_match IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN cand.alim_yeri   IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN cand.kont_tip    IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN cand.kont_durum  IS NOT NULL THEN 0 ELSE 1 END),
    cand.oncelik ASC,
    cand.created_at DESC
  LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_tarife_bul TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) Otomatik seed: ilk firma için referans tarifeleri (yorum — manuel çalıştır)
-- -----------------------------------------------------------------------------
-- Aşağıdaki örnek INSERT'leri kendi firma_id'nizle çalıştırabilirsiniz:
--
-- INSERT INTO public.harcirah_ek_hizmetler (firma_id, kod, ad, tutar, hesaplama_tipi, aciklama, sira) VALUES
--   ('<firma_uuid>', 'aktarma', 'Boş/Dolu Aktarma', 300, 'sabit', 'Liman içi aktarma işlemi', 10),
--   ('<firma_uuid>', 'bekleme', 'Bekleme (7sa+)',   350, 'sabit', '7 saat dolduğunda eklenir',  20),
--   ('<firma_uuid>', 'ats',     'ATS & Kolcu Farkı', 100, 'sabit', '',                          30),
--   ('<firma_uuid>', 'yari_harcirah', 'Yarı Harcırah (Ambarlı↔Gebze)', 0, 'yarim_tarife', 'Ambarlı-Gebze arası tam tarifenin yarısı', 40)
-- ON CONFLICT (firma_id, kod) DO NOTHING;

COMMIT;

-- =============================================================================
-- DOĞRULAMA / TEST
-- =============================================================================
-- 1. Bölge listesi olan tarife ekle:
--    INSERT INTO public.harcirah_tarifeleri (firma_id, baslik, bolgeler, kont_tip, kont_durum, tutar)
--    VALUES (
--      (SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid() LIMIT 1),
--      'Avrupa Yakası Batı (500)',
--      ARRAY['Avcılar','Esenyurt','Beylikdüzü','Hadımköy','Çatalca','Silivri'],
--      '40 DC', 'Dolu', 500
--    );
--
-- 2. Match testi:
--    SELECT * FROM public.harcirah_tarife_bul(
--      (SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid() LIMIT 1),
--      'Kumport', 'Mega Metal Çatalca', '40 DC', 'Dolu'
--    );
--    → eslesen_bolge: 'Çatalca' ile 500 TL döner.
-- =============================================================================
