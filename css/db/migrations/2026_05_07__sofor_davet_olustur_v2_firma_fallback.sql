-- =============================================================================
-- FLEETLY  —  2026-05-07  —  sofor_davet_olustur_v2 firma_id fallback
-- =============================================================================
-- Bug: JS tarafında loadFirmaId() oturum sonrası async çağrılıyor; bazen
-- kullanıcı "Davet Oluştur"a bastığında currentFirmaId hâlâ null oluyor.
-- Bu durumda RPC'ye p_firma_id = NULL gidiyor → suruculer INSERT NOT NULL
-- constraint hatası: "null value in column firma_id violates not-null constraint".
--
-- Çözüm: RPC içinde p_firma_id NULL gelirse firma_kullanicilar tablosundan
-- auth.uid() ile firma'yı kendisi çözsün. Eski çağrılarla geriye uyumlu —
-- p_firma_id verilirse o kullanılır.
--
-- Bağımlılık: 2026_04_22__surucu_refactor.sql (RPC ilk versiyonu)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sofor_davet_olustur_v2(
  p_firma_id uuid,
  p_ad       text,
  p_telefon  text,
  p_arac_id  text  DEFAULT NULL,
  p_not      text  DEFAULT NULL
) RETURNS TABLE(davet_id bigint, davet_kodu text, surucu_id uuid, yeni_sofor boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tel    text := public.fn_normalize_tel(p_telefon);
  v_firma  uuid := p_firma_id;
  v_surucu public.suruculer%ROWTYPE;
  v_kod    text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_yeni   boolean := false;
  v_davet_id bigint;
BEGIN
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'Geçersiz telefon' USING ERRCODE = '22023';
  END IF;

  -- ── YENİ: firma_id fallback (2026-05-07) ─────────────────────────────
  -- JS tarafından p_firma_id verilmediyse (race condition vs.) auth.uid()
  -- üzerinden kullanıcının firmasını çöz. Çoklu firma rolü varsa ilk match alınır.
  IF v_firma IS NULL THEN
    -- firma_kullanicilar tablosunda created_at yok (sadece user_id, firma_id, rol).
    -- Sahip rolü öncelikli, sonra herhangi bir yönetici rolü.
    SELECT fk.firma_id INTO v_firma
      FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid()
        AND fk.rol IN ('sahip','yonetici','operasyoncu')
      ORDER BY (fk.rol = 'sahip') DESC
      LIMIT 1;
    IF v_firma IS NULL THEN
      RAISE EXCEPTION 'Firma bulunamadı — lütfen sayfayı yenileyip tekrar deneyin'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Önce ara: aynı firmada aynı telefon var mı?
  SELECT * INTO v_surucu
  FROM public.suruculer
  WHERE firma_id = v_firma AND telefon_e164 = v_tel;

  IF NOT FOUND THEN
    INSERT INTO public.suruculer(firma_id, ad, telefon_e164, telefon_raw, durum, created_by)
    VALUES (v_firma, p_ad, v_tel, p_telefon, 'davet_bekliyor', auth.uid())
    RETURNING * INTO v_surucu;
    v_yeni := true;
  ELSE
    -- Mevcut; adı boşsa güncelle, ama üzerine yazma.
    IF v_surucu.ad IS NULL OR v_surucu.ad = 'İsimsiz' THEN
      UPDATE public.suruculer SET ad = p_ad WHERE id = v_surucu.id;
    END IF;
  END IF;

  INSERT INTO public.surucu_davetleri(
    firma_id, davet_eden, ad, telefon, telefon_e164,
    surucu_id, arac_id, davet_kodu, notlar, davet_durumu
  ) VALUES (
    v_firma, auth.uid(), COALESCE(v_surucu.ad, p_ad), p_telefon, v_tel,
    v_surucu.id, p_arac_id, v_kod, p_not, 'gonderildi'
  ) RETURNING id INTO v_davet_id;

  RETURN QUERY SELECT v_davet_id, v_kod, v_surucu.id, v_yeni;
END $$;

COMMENT ON FUNCTION public.sofor_davet_olustur_v2 IS
  'Davet oluştur — telefon dedup. p_firma_id boşsa auth.uid() üzerinden firma_kullanicilar''den çözülür (2026-05-07 fallback).';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Normal akış (p_firma_id explicit):
--    SELECT * FROM sofor_davet_olustur_v2(
--      '<firma_uuid>', 'Test Sürücü', '+905551234567', NULL, NULL
--    );
--
-- 2) Fallback (p_firma_id NULL):
--    SELECT * FROM sofor_davet_olustur_v2(
--      NULL, 'Test 2', '+905551234568', NULL, NULL
--    );
--    → Yönetici kullanıcı çağırırsa kendi firmasıyla yaratır
--    → Sofor rolündeki kullanıcı çağırırsa "Firma bulunamadı" hatası (42501)
-- =============================================================================
