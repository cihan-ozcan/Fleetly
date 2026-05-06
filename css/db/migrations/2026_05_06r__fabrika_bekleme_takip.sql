-- =============================================================================
-- FLEETLY  —  2026-05-06r  —  Fabrika Bekleme Süresi Takibi & Otomatik Harcırah
-- =============================================================================
-- Şoför fabrikada uzun süre beklediğinde:
--   • 6 saat (default) dolduğunda → MÜŞTERİ FİRMAYA bekleme ücreti tahakkuk eder
--     (saatlik tutar üzerinden — operasyon paneli faturalandırma için görür)
--   • 7 saat (default) dolduğunda → ŞOFÖRE bekleme harcırahı verilir
--     (firma'nın `harcirah_ek_hizmetler` tablosunda kod='bekleme' kaydının sabit
--      tutarı, mevcut trigger ile harcırah'a otomatik akar)
--
-- Veri akışı:
--   1) Şoför mobil "Mega Metal'a Vardım" → fabrika_giris = now()
--   2) Şoför mobil "Mega Metal'dan Çıktım" → fabrika_cikis = now()
--   3) BEFORE UPDATE trigger:
--      - sure_dk = (cikis - giris) / 60
--      - musteri_esik_dk geçildi → musteri_bekleme_borc hesapla + yaz
--      - sofor_esik_dk geçildi + sofor_bekleme_eklendi=false →
--          masraflar'a kayıt ekle (kategori='fabrika_bekleme', durum='onayli')
--          → trg_masraf_onay_harcirah_ekle ile harcırah'a otomatik akar
--          sofor_bekleme_eklendi=true (idempotent — bir daha eklenmez)
--
-- Bağımlılık: 2026_05_05d (harcirah_kayitlari), 2026_05_05e (harcirah_ek_hizmetler),
--             2026_05_06e (masraflar + trg_masraf_makbuz_zorunlu).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) FİRMA AYARLARI — eşikler + müşteri saatlik tutar
-- -----------------------------------------------------------------------------
-- Şoför sabit tutar zaten harcirah_ek_hizmetler kod='bekleme' kaydında.
-- Burada sadece (a) eşikler, (b) müşteri saatlik ücretini tutuyoruz.
ALTER TABLE public.firmalar
  ADD COLUMN IF NOT EXISTS bekleme_musteri_esik_dk integer NOT NULL DEFAULT 360,  -- 6 sa
  ADD COLUMN IF NOT EXISTS bekleme_sofor_esik_dk   integer NOT NULL DEFAULT 420,  -- 7 sa
  ADD COLUMN IF NOT EXISTS bekleme_musteri_saat_tl numeric(10,2) NOT NULL DEFAULT 150;

COMMENT ON COLUMN public.firmalar.bekleme_musteri_esik_dk IS
  'Müşteri firmaya bekleme ücreti tahakkuk eden eşik (dakika). Default 360 = 6 saat.';
COMMENT ON COLUMN public.firmalar.bekleme_sofor_esik_dk IS
  'Şoföre bekleme harcırahı verilen eşik (dakika). Default 420 = 7 saat.';
COMMENT ON COLUMN public.firmalar.bekleme_musteri_saat_tl IS
  'Müşteri firma için bekleme saatlik ücreti (TL). Eşik üzeri kısım × bu oran.';

-- -----------------------------------------------------------------------------
-- 2) İŞ EMRİ KOLONLARI — hesaplanmış değerler + idempotent flag
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS fabrika_bekleme_dk        integer,
  ADD COLUMN IF NOT EXISTS musteri_bekleme_borc_dk   integer,
  ADD COLUMN IF NOT EXISTS musteri_bekleme_borc_tl   numeric(12,2),
  ADD COLUMN IF NOT EXISTS sofor_bekleme_eklendi     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.is_emirleri.fabrika_bekleme_dk IS
  'Fabrikada beklenen toplam süre (dakika). fabrika_cikis dolduğunda hesaplanır.';
COMMENT ON COLUMN public.is_emirleri.musteri_bekleme_borc_dk IS
  'Müşteri firmaya tahakkuk eden bekleme süresi (dakika). 6sa+ kısım.';
COMMENT ON COLUMN public.is_emirleri.musteri_bekleme_borc_tl IS
  'Müşteri firmaya tahakkuk eden bekleme tutarı (TL). musteri_bekleme_borc_dk × saatlik / 60.';
COMMENT ON COLUMN public.is_emirleri.sofor_bekleme_eklendi IS
  'Şoför bekleme harcırahı kaydı oluşturuldu mu? Idempotent flag — masraflar kaydı bir kez eklenir.';

-- -----------------------------------------------------------------------------
-- 3) trg_masraf_makbuz_zorunlu — sistem otomatik girdileri için bypass
-- -----------------------------------------------------------------------------
-- Mevcut trigger şoför girişlerinde makbuz zorunlu kılıyor. Sistem otomatik
-- girdilerinde (kategori='fabrika_bekleme') makbuz olmaz — istisna ekleyelim.
CREATE OR REPLACE FUNCTION public.trg_masraf_makbuz_zorunlu()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sistem otomatik kategorileri makbuz zorunlu değil
  IF COALESCE(NEW.kategori, '') IN ('fabrika_bekleme') THEN
    RETURN NEW;
  END IF;
  -- Şoför girişi → makbuz zorunlu
  IF NEW.sofor_user_id IS NOT NULL
     AND (NEW.makbuz_url IS NULL OR length(trim(NEW.makbuz_url)) = 0) THEN
    RAISE EXCEPTION 'Şoför masraf bildiriminde makbuz/fiş fotoğrafı zorunludur.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- 4) trg_isemri_fabrika_bekleme — fabrika_cikis dolunca hesaplama
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_isemri_fabrika_bekleme()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sure_dk          integer;
  v_musteri_esik     integer;
  v_sofor_esik       integer;
  v_musteri_saat_tl  numeric;
  v_musteri_borc_dk  integer;
  v_musteri_borc_tl  numeric;
  v_sofor_borc_dk    integer;
  v_sofor_tarife     RECORD;
  v_masraf_id        text;
BEGIN
  -- Yalnızca fabrika_cikis NULL'dan dolu hale geçtiğinde çalış
  IF NOT (OLD.fabrika_cikis IS NULL AND NEW.fabrika_cikis IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF NEW.fabrika_giris IS NULL THEN
    RETURN NEW;   -- giriş yoksa hesap yok
  END IF;

  -- Süre hesabı (negatif olamaz)
  v_sure_dk := GREATEST(
    EXTRACT(EPOCH FROM (NEW.fabrika_cikis - NEW.fabrika_giris))::integer / 60,
    0
  );
  NEW.fabrika_bekleme_dk := v_sure_dk;

  -- Firma ayarlarını oku
  SELECT
    COALESCE(bekleme_musteri_esik_dk, 360),
    COALESCE(bekleme_sofor_esik_dk, 420),
    COALESCE(bekleme_musteri_saat_tl, 150)
  INTO v_musteri_esik, v_sofor_esik, v_musteri_saat_tl
  FROM public.firmalar
  WHERE id = NEW.firma_id;

  -- ── 5) MÜŞTERİ TAHAKKUKU (6sa+ kısım) ──
  IF v_sure_dk > v_musteri_esik THEN
    v_musteri_borc_dk := v_sure_dk - v_musteri_esik;
    v_musteri_borc_tl := ROUND((v_musteri_borc_dk::numeric / 60) * v_musteri_saat_tl, 2);
    NEW.musteri_bekleme_borc_dk := v_musteri_borc_dk;
    NEW.musteri_bekleme_borc_tl := v_musteri_borc_tl;

    -- Yöneticiye bildirim
    PERFORM public.notify_create(
      NEW.firma_id,
      'is_emri_durum',
      '⏱ Müşteri bekleme ücreti tahakkuk etti',
      format('İş #%s · %s · %s sa %s dk fabrika beklemesi → %s TL faturalanacak',
        NEW.id,
        COALESCE(NEW.musteri_adi, '—'),
        v_sure_dk / 60, v_sure_dk % 60,
        to_char(v_musteri_borc_tl, 'FM999990.00')),
      'is_emri', NEW.id::text, NULL, NULL, 'normal'
    );
  ELSE
    NEW.musteri_bekleme_borc_dk := 0;
    NEW.musteri_bekleme_borc_tl := 0;
  END IF;

  -- ── 6) ŞOFÖR HARCIRAHI (7sa+) — sabit tutar harcirah_ek_hizmetler'den ──
  IF v_sure_dk > v_sofor_esik
     AND NOT COALESCE(OLD.sofor_bekleme_eklendi, false)
     AND NEW.sofor_user_id IS NOT NULL THEN

    v_sofor_borc_dk := v_sure_dk - v_sofor_esik;

    -- Bekleme tarifesini bul (kod='bekleme')
    SELECT id, ad, tutar INTO v_sofor_tarife
      FROM public.harcirah_ek_hizmetler
      WHERE firma_id = NEW.firma_id AND kod = 'bekleme' AND aktif_mi = true
      LIMIT 1;

    IF FOUND AND v_sofor_tarife.tutar > 0 THEN
      -- masraflar'a otomatik kayıt → trg_masraf_onay_harcirah_ekle ile harcıraha akar
      v_masraf_id := 'BEK-' || to_char(now(), 'YYMMDD') || '-' ||
                     substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      INSERT INTO public.masraflar
        (id, firma_id, is_emri_id, sofor_user_id, kategori, tutar,
         tarih, durum, aciklama, makbuz_url, user_id, plaka)
      VALUES
        (v_masraf_id,
         NEW.firma_id,
         NEW.id,
         NEW.sofor_user_id,
         'fabrika_bekleme',
         v_sofor_tarife.tutar,
         CURRENT_DATE,
         'onayli',                    -- otomatik onaylı (sistem girişi)
         format('Otomatik: %s · %s sa %s dk fabrika beklemesi (eşik %s sa)',
           COALESCE(v_sofor_tarife.ad, 'Bekleme'),
           v_sure_dk / 60, v_sure_dk % 60, v_sofor_esik / 60),
         NULL,                        -- sistem girişi, makbuz yok (trigger bypass eder)
         NEW.sofor_user_id,
         NEW.arac_plaka);

      NEW.sofor_bekleme_eklendi := true;

      -- Yöneticiye bildirim
      PERFORM public.notify_create(
        NEW.firma_id,
        'is_emri_durum',
        '💰 Şoföre bekleme harcırahı eklendi',
        format('İş #%s · %s · %s TL bekleme harcırahı (sürdü: %s sa %s dk)',
          NEW.id, COALESCE(NEW.sofor, '—'),
          to_char(v_sofor_tarife.tutar, 'FM999990.00'),
          v_sure_dk / 60, v_sure_dk % 60),
        'is_emri', NEW.id::text, NEW.sofor_user_id, NULL, 'normal'
      );
    ELSE
      -- Tarife tanımlı değil — sessiz log, kullanıcıya bildirilmez
      RAISE NOTICE 'Bekleme tarifesi yok (firma=%) — şoför harcırahı atlandı', NEW.firma_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_isemri_fabrika_bekleme ON public.is_emirleri;
CREATE TRIGGER trg_isemri_fabrika_bekleme
  BEFORE UPDATE OF fabrika_cikis ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_isemri_fabrika_bekleme();

COMMENT ON FUNCTION public.trg_isemri_fabrika_bekleme IS
  'Fabrika bekleme hesaplama: fabrika_cikis dolunca (a) süre yaz, (b) 6sa+ ise müşteri tahakkuk, (c) 7sa+ ise masraflar tablosuna otomatik kayıt → harcırah''a akar.';

-- -----------------------------------------------------------------------------
-- 5) RPC: bekleme ayarlarını mobile için tek yerden çekme
-- -----------------------------------------------------------------------------
-- Mobile JobDetailScreen canlı sayaç + eşik gösterimi için kullanır.
CREATE OR REPLACE FUNCTION public.bekleme_ayarlari_getir()
RETURNS TABLE (
  musteri_esik_dk    integer,
  sofor_esik_dk      integer,
  musteri_saat_tl    numeric,
  sofor_sabit_tl     numeric    -- harcirah_ek_hizmetler 'bekleme' kaydından
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH firma AS (
    SELECT f.id, f.bekleme_musteri_esik_dk, f.bekleme_sofor_esik_dk, f.bekleme_musteri_saat_tl
      FROM public.firmalar f
      WHERE f.id = (
        SELECT firma_id FROM (
          SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
          UNION
          SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
        ) x LIMIT 1
      )
  )
  SELECT
    COALESCE(firma.bekleme_musteri_esik_dk, 360),
    COALESCE(firma.bekleme_sofor_esik_dk, 420),
    COALESCE(firma.bekleme_musteri_saat_tl, 150),
    COALESCE((
      SELECT tutar FROM public.harcirah_ek_hizmetler
       WHERE firma_id = firma.id AND kod = 'bekleme' AND aktif_mi = true
       LIMIT 1
    ), 0)
  FROM firma;
$$;

GRANT EXECUTE ON FUNCTION public.bekleme_ayarlari_getir() TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Firma ayarları:
--    SELECT id, ad, bekleme_musteri_esik_dk, bekleme_sofor_esik_dk,
--           bekleme_musteri_saat_tl FROM firmalar;
--
-- 2) Bekleme tarifesi var mı:
--    SELECT * FROM harcirah_ek_hizmetler WHERE kod='bekleme';
--    -- Yoksa: INSERT INTO harcirah_ek_hizmetler (firma_id, kod, ad, tutar, hesaplama_tipi, aciklama, sira)
--    --        VALUES ('<firma>', 'bekleme', 'Bekleme (7sa+)', 350, 'sabit', '7 saat dolduğunda eklenir', 20);
--
-- 3) Mobile için RPC test:
--    SELECT * FROM bekleme_ayarlari_getir();
--
-- 4) Trigger testi (manuel):
--    UPDATE is_emirleri
--    SET fabrika_giris = now() - interval '8 hours',
--        fabrika_cikis = now()
--    WHERE id = <test_id>;
--    -- Sonra:
--    SELECT id, fabrika_bekleme_dk, musteri_bekleme_borc_dk, musteri_bekleme_borc_tl,
--           sofor_bekleme_eklendi FROM is_emirleri WHERE id = <test_id>;
--    SELECT * FROM masraflar WHERE is_emri_id = <test_id>;
-- =============================================================================
