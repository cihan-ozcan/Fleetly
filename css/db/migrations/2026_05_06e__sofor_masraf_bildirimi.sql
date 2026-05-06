-- =============================================================================
-- FLEETLY  —  2026-05-06e  —  Şoför Masraf Bildirimi
-- =============================================================================
-- Şoför park, otoyol/HGS, cepten yakıt, mola, acil tamir gibi masraflarını
-- mobil uygulamadan makbuz fotoğrafı ile birlikte bildirir. Yönetici onayladıktan
-- sonra tutar şoförün ilgili iş emrindeki harcırah ek_masraflar'ına otomatik
-- eklenir (trigger).
--
-- Mevcut public.masraflar tablosunu genişletiyoruz (yeni tablo değil).
-- Geri alma: kolon DROP + trigger DROP + RLS rollback edilebilir.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) YENİ KOLONLAR
-- -----------------------------------------------------------------------------
ALTER TABLE public.masraflar
  ADD COLUMN IF NOT EXISTS is_emri_id      bigint REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sofor_user_id   uuid REFERENCES auth.users(id),
  -- Onay akışı: beklemede (şoför girdi) → onayli (yönetici onay) → odendi
  --             VEYA red (yönetici reddi). Yönetici doğrudan kayıt giriyorsa
  --             default 'onayli' olduğu için review akışına girmez (geri uyumlu).
  ADD COLUMN IF NOT EXISTS durum           text NOT NULL DEFAULT 'onayli'
                           CHECK (durum IN ('beklemede','onayli','red','odendi')),
  ADD COLUMN IF NOT EXISTS makbuz_url      text,           -- Storage URL (zorunlu — uygulama tarafında zorlanır)
  ADD COLUMN IF NOT EXISTS onay_at         timestamptz,
  ADD COLUMN IF NOT EXISTS onay_user_id    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS onay_not        text,
  ADD COLUMN IF NOT EXISTS red_neden       text;

CREATE INDEX IF NOT EXISTS idx_masraf_isemri
  ON public.masraflar(is_emri_id) WHERE is_emri_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_masraf_sofor_durum
  ON public.masraflar(sofor_user_id, durum, tarih DESC) WHERE sofor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_masraf_firma_beklemede
  ON public.masraflar(firma_id, durum) WHERE durum = 'beklemede';

COMMENT ON COLUMN public.masraflar.sofor_user_id IS
  'Bu masrafın bağlı olduğu şoför (auth.users.id). Şoför girdiyse user_id=sofor_user_id.';
COMMENT ON COLUMN public.masraflar.durum IS
  'beklemede=şoför girdi review bekliyor; onayli=yönetici onayladı; red=reddedildi; odendi=harcırahta ödendi.';
COMMENT ON COLUMN public.masraflar.makbuz_url IS
  'Makbuz/fiş fotoğrafı public URL. Şoför girdiğinde zorunlu (BEFORE INSERT trigger zorlar).';

-- -----------------------------------------------------------------------------
-- 2) RLS — şoför kendi kayıtları + firma yönetimi
-- -----------------------------------------------------------------------------
ALTER TABLE public.masraflar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS masraf_select ON public.masraflar;
CREATE POLICY masraf_select ON public.masraflar
  FOR SELECT TO authenticated
  USING (
    -- Aynı firma yönetimi tüm masrafları görür
    firma_id IN (SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid())
    -- VEYA şoför kendi kayıtlarını görür
    OR sofor_user_id = auth.uid()
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS masraf_insert ON public.masraflar;
CREATE POLICY masraf_insert ON public.masraflar
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Yönetici/operasyoncu/muhasebeci kendi firma kayıtlarını ekleyebilir
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid()
        AND fk.rol IN ('sahip','yonetici','operasyoncu','muhasebeci')
    )
    -- VEYA şoför kendi adına (sofor_user_id=auth.uid()) ekleyebilir
    OR (sofor_user_id = auth.uid() AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS masraf_update ON public.masraflar;
CREATE POLICY masraf_update ON public.masraflar
  FOR UPDATE TO authenticated
  USING (
    -- Yönetici onay/red/ödedi yapabilir
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid()
        AND fk.rol IN ('sahip','yonetici','operasyoncu','muhasebeci')
    )
    -- Şoför sadece beklemede kaydını düzeltebilir
    OR (sofor_user_id = auth.uid() AND durum = 'beklemede')
  );

DROP POLICY IF EXISTS masraf_delete ON public.masraflar;
CREATE POLICY masraf_delete ON public.masraflar
  FOR DELETE TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
    )
    -- Şoför kendi beklemede kaydını silebilir (yanlış girmiş olabilir)
    OR (sofor_user_id = auth.uid() AND durum = 'beklemede')
  );

-- -----------------------------------------------------------------------------
-- 3) ZORUNLU MAKBUZ TRIGGER — şoförün girdiği kayıtlarda makbuz_url null olamaz
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_masraf_makbuz_zorunlu()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- sofor_user_id doluysa şoför girişi → makbuz zorunlu
  IF NEW.sofor_user_id IS NOT NULL
     AND (NEW.makbuz_url IS NULL OR length(trim(NEW.makbuz_url)) = 0) THEN
    RAISE EXCEPTION 'Şoför masraf bildiriminde makbuz/fiş fotoğrafı zorunludur.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_masraf_makbuz_zorunlu ON public.masraflar;
CREATE TRIGGER trg_masraf_makbuz_zorunlu
  BEFORE INSERT OR UPDATE ON public.masraflar
  FOR EACH ROW EXECUTE FUNCTION public.trg_masraf_makbuz_zorunlu();

-- -----------------------------------------------------------------------------
-- 4) ONAY → HARCIRAH OTOMATİK EKLEME TRIGGER
-- -----------------------------------------------------------------------------
-- durum 'onayli'ye geçtiğinde, aynı iş emrine ve şoföre ait harcırah kaydını
-- bul → ek_masraflar += masraf.tutar, ek_masraf_aciklama'a satır ekle.
-- Eğer kayıt yoksa veya durum 'odendi'/'iptal' ise sessizce no-op (logla).
CREATE OR REPLACE FUNCTION public.trg_masraf_onay_harcirah_ekle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_etiket text;
  v_eklendi int;
BEGIN
  IF NEW.durum <> 'onayli' THEN RETURN NEW; END IF;
  IF OLD.durum = 'onayli'  THEN RETURN NEW; END IF;        -- önceden onaylanmış, tekrar fire olmasın
  IF NEW.is_emri_id IS NULL OR NEW.sofor_user_id IS NULL THEN RETURN NEW; END IF;

  v_etiket := COALESCE(NEW.kategori, 'masraf') || ' ' ||
              to_char(COALESCE(NEW.tutar, 0), 'FM999990.00') || '₺';

  UPDATE public.harcirah_kayitlari
     SET ek_masraflar       = COALESCE(ek_masraflar, 0) + COALESCE(NEW.tutar, 0),
         ek_masraf_aciklama = NULLIF(
                                TRIM(BOTH ' · ' FROM
                                  COALESCE(ek_masraf_aciklama || ' · ', '') || v_etiket
                                ), '')
   WHERE is_emri_id    = NEW.is_emri_id
     AND sofor_user_id = NEW.sofor_user_id
     AND durum NOT IN ('odendi','iptal');

  GET DIAGNOSTICS v_eklendi = ROW_COUNT;
  IF v_eklendi = 0 THEN
    RAISE NOTICE 'Masraf onaylandı (id=%) ama eşleşen harcırah kaydı yok (is_emri=%, sofor=%). Manuel ekleme gerekebilir.',
      NEW.id, NEW.is_emri_id, NEW.sofor_user_id;
  END IF;

  -- onay_at tetikleyici tarafında garanti et (uygulama yazmadıysa)
  IF NEW.onay_at IS NULL THEN NEW.onay_at := now(); END IF;
  IF NEW.onay_user_id IS NULL THEN NEW.onay_user_id := auth.uid(); END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_masraf_onay_harcirah ON public.masraflar;
CREATE TRIGGER trg_masraf_onay_harcirah
  BEFORE UPDATE OF durum ON public.masraflar
  FOR EACH ROW
  WHEN (OLD.durum IS DISTINCT FROM NEW.durum)
  EXECUTE FUNCTION public.trg_masraf_onay_harcirah_ekle();

-- -----------------------------------------------------------------------------
-- 5) RPC: şoför kayıt oluşturur (SECURITY DEFINER ile firma_id otomatik çözülsün)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sofor_masraf_bildir(
  p_kategori   text,
  p_tutar      numeric,
  p_makbuz_url text,
  p_is_emri_id bigint  DEFAULT NULL,
  p_aciklama   text    DEFAULT NULL,
  p_tarih      date    DEFAULT CURRENT_DATE
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_firma_id  uuid;
  v_id        text;
  v_plaka     text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501'; END IF;
  IF p_makbuz_url IS NULL OR length(trim(p_makbuz_url)) = 0 THEN
    RAISE EXCEPTION 'Makbuz fotoğrafı zorunludur.' USING ERRCODE = '23514';
  END IF;
  IF p_tutar IS NULL OR p_tutar <= 0 THEN
    RAISE EXCEPTION 'Tutar pozitif olmalı.' USING ERRCODE = '22023';
  END IF;

  SELECT s.firma_id INTO v_firma_id FROM public.suruculer s WHERE s.auth_user_id = v_uid LIMIT 1;
  IF v_firma_id IS NULL THEN
    SELECT fk.firma_id INTO v_firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = v_uid LIMIT 1;
  END IF;
  IF v_firma_id IS NULL THEN RAISE EXCEPTION 'firma bulunamadı' USING ERRCODE = '23502'; END IF;

  -- Aktif iş emri varsa plakayı snapshot al (rapor için)
  IF p_is_emri_id IS NOT NULL THEN
    SELECT i.arac_plaka INTO v_plaka FROM public.is_emirleri i WHERE i.id = p_is_emri_id;
  END IF;

  v_id := 'MSF-' || to_char(now(),'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  INSERT INTO public.masraflar
    (id, user_id, firma_id, sofor_user_id, is_emri_id, plaka,
     tarih, kategori, tutar, makbuz_url, aciklama, durum)
  VALUES
    (v_id, v_uid, v_firma_id, v_uid, p_is_emri_id, v_plaka,
     p_tarih, p_kategori, p_tutar, p_makbuz_url, p_aciklama, 'beklemede');

  -- Yöneticiye bildirim
  PERFORM public.notify_create(
    v_firma_id, 'genel', '💰 Yeni masraf bildirimi',
    p_kategori || ' · ' || to_char(p_tutar, 'FM999990.00') || '₺' ||
      CASE WHEN p_is_emri_id IS NOT NULL THEN ' · iş #' || p_is_emri_id::text ELSE '' END,
    'masraf', v_id, v_uid, NULL, 'normal'
  );

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.sofor_masraf_bildir(text, numeric, text, bigint, text, date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) Yönetici onay/red yardımcıları
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.masraf_onayla(p_id text, p_not text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.masraflar
     SET durum = 'onayli', onay_at = now(), onay_user_id = auth.uid(), onay_not = p_not
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'masraf bulunamadı' USING ERRCODE = '02000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.masraf_reddet(p_id text, p_neden text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_neden IS NULL OR length(trim(p_neden)) = 0 THEN
    RAISE EXCEPTION 'Red nedeni zorunlu.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.masraflar
     SET durum = 'red', onay_at = now(), onay_user_id = auth.uid(), red_neden = p_neden
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'masraf bulunamadı' USING ERRCODE = '02000'; END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.masraf_onayla(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.masraf_reddet(text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) Realtime publication
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.masraflar;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- STORAGE BUCKET — Supabase dashboard'undan oluşturulmalı:
--   Bucket adı: masraf-makbuz
--   Public:     true (URL ile okunabilsin; yine de RLS path bazlı koruma)
--   File path:  {firma_id}/{user_id}/{timestamp}_{kategori}.jpg
-- Storage policy:
--   • SELECT: anon — public read (URL bilen kim olursa olsun erişir)
--   • INSERT: authenticated AND auth.uid() üyesi olduğu firma path'in ilk segmentinde
-- =============================================================================
