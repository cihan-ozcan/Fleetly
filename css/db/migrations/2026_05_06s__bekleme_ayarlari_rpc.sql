-- =============================================================================
-- FLEETLY  —  2026-05-06s  —  Bekleme ayarları kaydet RPC
-- =============================================================================
-- 2026_05_06r migration ile firmalar tablosuna bekleme eşikleri + saatlik ücret
-- kolonları eklendi. Yöneticiler bu değerleri SQL yazmadan harcırah panelinden
-- değiştirebilsin diye yetki-kontrollü RPC ekliyoruz.
--
-- Yetki: sahip / yonetici / operasyoncu rollerindeki firma_kullanicilar.
-- Güvenlik: SECURITY DEFINER + auth.uid kontrolü → kullanıcı kendi firmasının
--           ayarlarını günceller, başka firmayı etkileyemez.
--
-- Bağımlılık: 2026_05_06r__fabrika_bekleme_takip.sql.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bekleme_ayarlari_kaydet(
  p_sofor_esik_dk    integer DEFAULT NULL,
  p_musteri_esik_dk  integer DEFAULT NULL,
  p_musteri_saat_tl  numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
BEGIN
  -- Kullanıcının yönetici olduğu firma
  SELECT fk.firma_id INTO v_firma_id
    FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid()
      AND fk.rol IN ('sahip','yonetici','operasyoncu')
    LIMIT 1;
  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'Bekleme ayarlarını değiştirme yetkisi yok' USING ERRCODE = '42501';
  END IF;

  -- Validasyon
  IF p_sofor_esik_dk IS NOT NULL AND p_sofor_esik_dk < 60 THEN
    RAISE EXCEPTION 'Şoför eşiği en az 60 dakika olmalı (% verildi)', p_sofor_esik_dk
      USING ERRCODE = '23514';
  END IF;
  IF p_musteri_esik_dk IS NOT NULL AND p_musteri_esik_dk < 60 THEN
    RAISE EXCEPTION 'Müşteri eşiği en az 60 dakika olmalı (% verildi)', p_musteri_esik_dk
      USING ERRCODE = '23514';
  END IF;
  IF p_musteri_saat_tl IS NOT NULL AND p_musteri_saat_tl < 0 THEN
    RAISE EXCEPTION 'Müşteri saatlik tutar negatif olamaz' USING ERRCODE = '23514';
  END IF;

  -- Sadece NULL olmayan parametreleri güncelle (kısmi update destekli)
  UPDATE public.firmalar
     SET bekleme_sofor_esik_dk    = COALESCE(p_sofor_esik_dk,   bekleme_sofor_esik_dk),
         bekleme_musteri_esik_dk  = COALESCE(p_musteri_esik_dk, bekleme_musteri_esik_dk),
         bekleme_musteri_saat_tl  = COALESCE(p_musteri_saat_tl, bekleme_musteri_saat_tl)
   WHERE id = v_firma_id;
END $$;

GRANT EXECUTE ON FUNCTION public.bekleme_ayarlari_kaydet(integer, integer, numeric) TO authenticated;

COMMENT ON FUNCTION public.bekleme_ayarlari_kaydet IS
  'Firma bekleme eşikleri + müşteri saatlik tutarı güncelleme. Yetki: sahip/yonetici/operasyoncu.';

-- -----------------------------------------------------------------------------
-- Mevcut bekleme_ayarlari_getir RPC'sini panel için genişlet
-- -----------------------------------------------------------------------------
-- Mobile zaten kullanıyor (musteri_esik_dk, sofor_esik_dk, musteri_saat_tl,
-- sofor_sabit_tl). Web panel için aynı RPC yeterli — değişiklik yok.

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Mevcut ayarları görüntüle:
--    SELECT * FROM bekleme_ayarlari_getir();
--
-- 2) Şoför eşiğini 6 saate al:
--    SELECT bekleme_ayarlari_kaydet(p_sofor_esik_dk => 360);
--
-- 3) Müşteri saatlik ücreti 200 TL yap:
--    SELECT bekleme_ayarlari_kaydet(p_musteri_saat_tl => 200);
--
-- 4) Hepsini birden:
--    SELECT bekleme_ayarlari_kaydet(
--      p_sofor_esik_dk => 420,
--      p_musteri_esik_dk => 360,
--      p_musteri_saat_tl => 175
--    );
--
-- 5) Yetkisiz test (sofor rolü):
--    SET ROLE authenticated;
--    SELECT bekleme_ayarlari_kaydet(p_sofor_esik_dk => 360);
--    -- Beklenen: 42501 error
-- =============================================================================
