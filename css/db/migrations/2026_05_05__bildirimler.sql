-- =============================================================================
-- FLEETLY  —  2026-05-05  —  Bildirimler (yönetici tarafı)
-- =============================================================================
-- Şoför iş emrine fotoğraf yükledi / yola çıktı / teslim etti / yakıt aldı /
-- arıza bildirdi → yöneticiye anında bildirim.
--
-- Yapı:
--   1) bildirimler tablosu (firma_id bazlı, RLS)
--   2) Yardımcı RPC: notify_create(...)
--   3) is_emirleri durum değişimi trigger'ı (Bekliyor → Yolda / Teslim / Fabrikada)
--
-- Diğer tetikleyiciler (foto, yakıt, arıza) ayrı bir migration'da gelecek;
-- bu dosya yalnızca temel altyapı + iş emri durum değişimini bağlar.
--
-- Geri alma: aşağıdaki tablo ve trigger DROP edilebilir; veri kayıpsız geri alınır.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) bildirimler tablosu
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bildirimler (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id      uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  -- Hangi olay türü (UI rengi/ikonu için)
  tip           text NOT NULL CHECK (tip IN (
                  'is_emri_durum',     -- iş emri durum değişti
                  'is_emri_foto',      -- şoför fotoğraf yükledi
                  'is_emri_yola',      -- şoför yola çıktı
                  'is_emri_teslim',    -- şoför teslim etti
                  'yakit',             -- şoför yakıt fişi yükledi
                  'ariza',             -- şoför arıza bildirdi
                  'genel'              -- serbest tip
                )),
  baslik        text NOT NULL,
  mesaj         text,
  -- Tıklanınca yönlendirilecek kayıt (ör. ilgili iş emri / arıza)
  ilgili_tur    text,                  -- 'is_emri' | 'bakim' | 'arac' | 'sefer' | NULL
  ilgili_id     text,                  -- referans kayıt id (text — uuid/int hepsi)
  -- Şoför bilgisi (kim tetikledi)
  kaynak_user_id uuid REFERENCES auth.users(id),
  kaynak_ad     text,                  -- şoför adı snapshot (hızlı render için)
  -- Yönetici görme durumu
  okundu_mu     boolean NOT NULL DEFAULT false,
  okundu_at     timestamptz,
  okudu_user_id uuid REFERENCES auth.users(id),
  -- Önemlilik (UI'da farklı işaret)
  oncelik       text NOT NULL DEFAULT 'normal' CHECK (oncelik IN ('dusuk','normal','yuksek','kritik')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bildirimler_firma_okundu
  ON public.bildirimler(firma_id, okundu_mu, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bildirimler_ilgili
  ON public.bildirimler(ilgili_tur, ilgili_id);

COMMENT ON TABLE public.bildirimler IS
  'Yönetici/operasyon ekibine yönelik iç bildirimler. Sürücü tarafından üretilen olaylar için merkezi feed.';

-- -----------------------------------------------------------------------------
-- 2) RLS — firma_id bazlı
-- -----------------------------------------------------------------------------
ALTER TABLE public.bildirimler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bildirimler_select ON public.bildirimler;
CREATE POLICY bildirimler_select ON public.bildirimler
  FOR SELECT TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid()
  ));

-- INSERT'i SECURITY DEFINER RPC üzerinden yapacağız (trigger ve client kodu),
-- yine de policy gerekiyor — auth.uid() üzerinden gelen INSERT'lere izin ver.
DROP POLICY IF EXISTS bildirimler_insert ON public.bildirimler;
CREATE POLICY bildirimler_insert ON public.bildirimler
  FOR INSERT TO authenticated
  WITH CHECK (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid()
  ));

-- Yalnızca okundu işaretleme amacıyla UPDATE
DROP POLICY IF EXISTS bildirimler_update ON public.bildirimler;
CREATE POLICY bildirimler_update ON public.bildirimler
  FOR UPDATE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid()
  ));

-- DELETE: sadece sahip/yönetici (eski temizlik için)
DROP POLICY IF EXISTS bildirimler_delete ON public.bildirimler;
CREATE POLICY bildirimler_delete ON public.bildirimler
  FOR DELETE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
  ));

-- -----------------------------------------------------------------------------
-- 3) Yardımcı RPC: notify_create
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_create(
  p_firma_id      uuid,
  p_tip           text,
  p_baslik        text,
  p_mesaj         text DEFAULT NULL,
  p_ilgili_tur    text DEFAULT NULL,
  p_ilgili_id     text DEFAULT NULL,
  p_kaynak_user_id uuid DEFAULT NULL,
  p_kaynak_ad     text DEFAULT NULL,
  p_oncelik       text DEFAULT 'normal'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.bildirimler
    (firma_id, tip, baslik, mesaj, ilgili_tur, ilgili_id, kaynak_user_id, kaynak_ad, oncelik)
  VALUES
    (p_firma_id, p_tip, p_baslik, p_mesaj, p_ilgili_tur, p_ilgili_id, p_kaynak_user_id, p_kaynak_ad, p_oncelik)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.notify_create(uuid, text, text, text, text, text, uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.notify_create IS
  'Yardımcı: bildirim oluştur. SECURITY DEFINER — RLS bypass eder, çağıran her zaman insert edebilir.';

-- -----------------------------------------------------------------------------
-- 4) is_emirleri durum değişimi → bildirim trigger
-- -----------------------------------------------------------------------------
-- Hangi durum değişimleri bildirim üretir:
--   * → 'Yolda'           → "Şoför yola çıktı"
--   * → 'Fabrikada'       → "Fabrikaya giriş yaptı"
--   * → 'Teslim Edildi'   → "Teslim tamamlandı"
--   Diğer geçişler (Bekliyor, İptal vs.) bildirim üretmez.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_is_emri_durum_bildirim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_baslik   text;
  v_mesaj    text;
  v_oncelik  text := 'normal';
  v_tip      text;
  v_kaynak_ad text;
BEGIN
  -- Yalnızca durum gerçekten değiştiğinde
  IF NEW.durum IS NOT DISTINCT FROM OLD.durum THEN
    RETURN NEW;
  END IF;

  -- firma_id eksikse bildirim yarat ma (eski kayıt + RLS)
  IF NEW.firma_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_kaynak_ad := COALESCE(NEW.sofor, NEW.arac_plaka, '—');

  IF NEW.durum = 'Yolda' THEN
    v_tip     := 'is_emri_yola';
    v_baslik  := COALESCE(NEW.arac_plaka, '#' || NEW.id::text) || ' yola çıktı';
    v_mesaj   := COALESCE(NEW.musteri_adi, 'Müşteri') ||
                 ' · ' || COALESCE(NEW.yukle_yeri,  'Alım') ||
                 ' → ' || COALESCE(NEW.teslim_yeri, 'Teslim');
  ELSIF NEW.durum = 'Fabrikada' THEN
    v_tip     := 'is_emri_durum';
    v_baslik  := COALESCE(NEW.arac_plaka, '#' || NEW.id::text) || ' fabrikaya giriş yaptı';
    v_mesaj   := COALESCE(NEW.musteri_adi, 'Müşteri') ||
                 ' · ' || COALESCE(NEW.teslim_yeri, 'Teslim noktası');
  ELSIF NEW.durum = 'Teslim Edildi' THEN
    v_tip     := 'is_emri_teslim';
    v_baslik  := COALESCE(NEW.arac_plaka, '#' || NEW.id::text) || ' teslim edildi';
    v_mesaj   := COALESCE(NEW.musteri_adi, 'Müşteri') ||
                 ' · ' || COALESCE(NEW.konteyner_no, 'Konteyner') ||
                 ' → ' || COALESCE(NEW.teslim_yeri, 'Teslim');
    v_oncelik := 'yuksek';
  ELSE
    -- Diğer durumlar bildirim üretmez (örn. Bekliyor'a dönüş, İptal)
    RETURN NEW;
  END IF;

  PERFORM public.notify_create(
    NEW.firma_id,
    v_tip,
    v_baslik,
    v_mesaj,
    'is_emri',
    NEW.id::text,
    NEW.sofor_user_id,
    v_kaynak_ad,
    v_oncelik
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_is_emri_durum_bildirim ON public.is_emirleri;
CREATE TRIGGER trg_is_emri_durum_bildirim
  AFTER UPDATE OF durum ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_is_emri_durum_bildirim();

-- -----------------------------------------------------------------------------
-- 5) View — listeleme kolaylığı için (firma izniyle)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_bildirimler_son AS
SELECT b.*, b.created_at AS ts
FROM public.bildirimler b
ORDER BY b.created_at DESC;

GRANT SELECT ON public.v_bildirimler_son TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA (manuel)
-- =============================================================================
-- 1. Bir iş emri durumunu güncelle:
--    UPDATE public.is_emirleri SET durum = 'Yolda' WHERE id = <bir_id>;
--
-- 2. Bildirimleri kontrol et:
--    SELECT id, tip, baslik, mesaj, ilgili_id, oncelik, created_at
--    FROM public.bildirimler
--    WHERE firma_id = (SELECT firma_id FROM public.firma_kullanicilar
--                      WHERE user_id = auth.uid() LIMIT 1)
--    ORDER BY created_at DESC LIMIT 10;
--
-- 3. RPC ile manuel bildirim:
--    SELECT public.notify_create(
--      (SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid() LIMIT 1),
--      'genel', 'Test bildirimi', 'Bu bir testtir', NULL, NULL, NULL, 'Sistem', 'normal');
-- =============================================================================
