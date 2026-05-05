-- =============================================================================
-- FLEETLY  —  2026-05-05g  —  İş emri açıldığında otomatik harcırah hesaplama
-- =============================================================================
-- İş akışı:
--   • is_emirleri INSERT → harcirah_tarife_bul(...) çağır
--   • Match varsa → harcirah_kayitlari'na kayıt oluştur (durum: 'beklemede')
--   • Match yoksa → yöneticiye bildirim ("Tarife eşleşmedi, manuel gir")
--   • Her iki durumda da iş emri INSERT'i etkilenmez (trigger atomic değil — hata
--     iş emrine etki etmez, sadece logla)
--
-- Önkoşullar:
--   • 2026_05_05d__harcirah_sistemi.sql
--   • 2026_05_05e__harcirah_bolgeler_ek_hizmetler.sql
--   • 2026_05_05f__harcirah_rpc_create.sql
--   • 2026_05_05__bildirimler.sql (notify_create RPC)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_isemri_harcirah_olustur()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tarife       record;
  v_kayit_id     uuid;
  v_dorse_tipi   text;
  v_is_tarihi    date;
  v_arac_plaka   text;
  v_dorse_kayit  record;
  v_baslik       text;
  v_mesaj        text;
BEGIN
  -- Firma yoksa çık
  IF NEW.firma_id IS NULL THEN RETURN NEW; END IF;

  -- İptal edilmiş iş için harcırah üretme
  IF NEW.durum = 'İptal' THEN RETURN NEW; END IF;

  -- Aynı iş_emri_id'ye sahip kayıt varsa tekrar üretme (idempotency)
  IF EXISTS (SELECT 1 FROM public.harcirah_kayitlari WHERE is_emri_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- İş tarihi: atama_zamani > created_at > today
  v_is_tarihi := COALESCE(NEW.atama_zamani::date, NEW.created_at::date, CURRENT_DATE);

  -- Plaka: önce çekici plakası, sonra arac_plaka
  v_arac_plaka := COALESCE(NEW.arac_plaka, '');

  -- Dorse tipi: NEW.dorse_id varsa araclar tablosundan dorse_tipi'ni çek
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
      NEW.firma_id,
      NEW.yukle_yeri,
      NEW.teslim_yeri,
      NEW.kont_tip,
      NEW.kont_durum,
      v_dorse_tipi,
      v_is_tarihi
    ) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_tarife := NULL;
  END;

  -- Match varsa harcırah kaydı oluştur
  IF v_tarife.id IS NOT NULL THEN
    INSERT INTO public.harcirah_kayitlari (
      firma_id, is_emri_id, sofor_user_id, sofor_ad, arac_id, arac_plaka,
      tarife_id, hesaplanan_tutar, is_tarihi, durum
    ) VALUES (
      NEW.firma_id, NEW.id,
      NEW.sofor_user_id, NEW.sofor,
      COALESCE(NEW.cekici_id, NULL),
      v_arac_plaka,
      v_tarife.id,
      v_tarife.tutar,
      v_is_tarihi,
      'beklemede'
    ) RETURNING id INTO v_kayit_id;

    -- Bildirim: harcırah hesaplandı (yöneticiye)
    v_baslik := COALESCE(v_arac_plaka, '#' || NEW.id::text) || ' — Harcırah hesaplandı: ' ||
                to_char(v_tarife.tutar, 'FM999G999D90') || ' ₺';
    v_mesaj  := COALESCE(v_tarife.baslik, '') ||
                CASE WHEN v_tarife.eslesen_bolge IS NOT NULL THEN ' · Bölge: ' || v_tarife.eslesen_bolge ELSE '' END ||
                ' · ' || COALESCE(NEW.musteri_adi, 'Müşteri');
    BEGIN
      PERFORM public.notify_create(
        NEW.firma_id,
        'genel',
        v_baslik,
        v_mesaj,
        'is_emri',
        NEW.id::text,
        NULL,
        COALESCE(NEW.sofor, v_arac_plaka),
        'normal'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Bildirim hatası iş emrini etkilemesin
      NULL;
    END;
  ELSE
    -- Match yok → yöneticiye uyarı bildirimi
    v_baslik := COALESCE(v_arac_plaka, '#' || NEW.id::text) || ' — Tarife eşleşmedi';
    v_mesaj  := 'Bu rota için tarife bulunamadı: ' ||
                COALESCE(NEW.yukle_yeri, '?') || ' → ' || COALESCE(NEW.teslim_yeri, '?') ||
                CASE WHEN NEW.kont_tip IS NOT NULL THEN ' · ' || NEW.kont_tip ELSE '' END ||
                '. Harcırah modülünden manuel girilebilir.';
    BEGIN
      PERFORM public.notify_create(
        NEW.firma_id,
        'genel',
        v_baslik,
        v_mesaj,
        'is_emri',
        NEW.id::text,
        NULL,
        COALESCE(NEW.sofor, v_arac_plaka),
        'normal'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Tüm hatalar yutulur — iş emri INSERT'i her durumda çalışsın
  RAISE WARNING 'trg_isemri_harcirah_olustur hata: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_isemri_harcirah_olustur ON public.is_emirleri;
CREATE TRIGGER trg_isemri_harcirah_olustur
  AFTER INSERT ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_isemri_harcirah_olustur();

COMMENT ON FUNCTION public.trg_isemri_harcirah_olustur IS
  'İş emri INSERT''inde tarife match yapıp harcirah_kayitlari''na kayıt oluşturur. Match yoksa yönetici bildirimi atar. Hatalar iş emrini etkilemez.';

-- -----------------------------------------------------------------------------
-- Yardımcı RPC: mevcut iş emri için harcırah hesapla (manuel re-trigger)
-- -----------------------------------------------------------------------------
-- Yönetici "Yeniden hesapla" butonuna basarsa veya tarife sonradan eklendiyse
-- mevcut bir iş emrine harcırah üretmek için.
CREATE OR REPLACE FUNCTION public.harcirah_isemri_hesapla(p_is_emri_id bigint)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_isemri      record;
  v_tarife      record;
  v_kayit_id    uuid;
  v_dorse_tipi  text;
  v_firma       uuid;
BEGIN
  SELECT * INTO v_isemri FROM public.is_emirleri WHERE id = p_is_emri_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'İş emri bulunamadı: %', p_is_emri_id USING ERRCODE = 'P0002';
  END IF;

  -- Yetki kontrolü
  SELECT fk.firma_id INTO v_firma
    FROM public.firma_kullanicilar fk
   WHERE fk.user_id = auth.uid() AND fk.firma_id = v_isemri.firma_id
   LIMIT 1;
  IF v_firma IS NULL THEN
    RAISE EXCEPTION 'Yetki yok' USING ERRCODE = '42501';
  END IF;

  -- Mevcut harcırah varsa sil (yeni hesap için)
  DELETE FROM public.harcirah_kayitlari WHERE is_emri_id = p_is_emri_id;

  -- Dorse tipi
  IF v_isemri.dorse_id IS NOT NULL THEN
    SELECT a.dorse_tipi INTO v_dorse_tipi FROM public.araclar a WHERE a.id = v_isemri.dorse_id LIMIT 1;
  END IF;

  SELECT * INTO v_tarife FROM public.harcirah_tarife_bul(
    v_isemri.firma_id,
    v_isemri.yukle_yeri,
    v_isemri.teslim_yeri,
    v_isemri.kont_tip,
    v_isemri.kont_durum,
    v_dorse_tipi,
    COALESCE(v_isemri.atama_zamani::date, v_isemri.created_at::date, CURRENT_DATE)
  ) LIMIT 1;

  IF v_tarife.id IS NULL THEN
    RETURN NULL;  -- match yok
  END IF;

  INSERT INTO public.harcirah_kayitlari (
    firma_id, is_emri_id, sofor_user_id, sofor_ad, arac_id, arac_plaka,
    tarife_id, hesaplanan_tutar, is_tarihi, durum
  ) VALUES (
    v_isemri.firma_id, v_isemri.id,
    v_isemri.sofor_user_id, v_isemri.sofor,
    COALESCE(v_isemri.cekici_id, NULL),
    v_isemri.arac_plaka,
    v_tarife.id,
    v_tarife.tutar,
    COALESCE(v_isemri.atama_zamani::date, v_isemri.created_at::date, CURRENT_DATE),
    'beklemede'
  ) RETURNING id INTO v_kayit_id;

  RETURN v_kayit_id;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_isemri_hesapla(bigint) TO authenticated;

COMMENT ON FUNCTION public.harcirah_isemri_hesapla IS
  'Mevcut bir iş emri için harcırah kaydını yeniden hesaplar (eskisini siler, yenisini oluşturur). Tarife sonradan eklendiyse veya rotada değişiklik varsa kullanılır.';

COMMIT;

-- =============================================================================
-- TEST
-- =============================================================================
-- 1) Yeni iş emri ekle:
--    INSERT INTO public.is_emirleri (firma_id, musteri_adi, arac_plaka, sofor,
--                                     yukle_yeri, teslim_yeri, kont_tip, kont_durum, durum)
--    VALUES (
--      (SELECT firma_id FROM firma_kullanicilar WHERE user_id = auth.uid() LIMIT 1),
--      'Test Müşteri', '34TEST01', 'Test Şoför',
--      'Kumport', 'Mega Metal Çatalca', '40 DC', 'Dolu', 'Bekliyor'
--    );
--
-- 2) Harcırah kaydı oluştu mu kontrol:
--    SELECT id, is_emri_id, sofor_ad, arac_plaka, hesaplanan_tutar, durum, hafta_no
--    FROM public.harcirah_kayitlari
--    ORDER BY created_at DESC LIMIT 5;
--
-- 3) Manuel yeniden hesapla:
--    SELECT public.harcirah_isemri_hesapla(<is_emri_id>);
-- =============================================================================
