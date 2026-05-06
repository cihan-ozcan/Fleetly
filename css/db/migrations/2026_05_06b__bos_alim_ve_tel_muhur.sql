-- =============================================================================
-- FLEETLY  —  2026-05-06b  —  Boş Alım ön-fazı + Gümrük Tel Mühür akışı
-- =============================================================================
-- İki gerçek senaryoyu kapsar:
--
-- 1) Mardaş'tan boş 20'lik konteyner ön-alımı + ertesi gün yükleme
--    Şoför: Yolda → Mardaş'a git → "Boş Aldım" → durum='Boş Alındı'
--    'Boş Alındı'da konum yayını şoför uygulamasında DURUR (LocationService).
--    Ertesi sabah "Yüklemeye Çıkıyorum" → tekrar 'Yolda' → konum açılır → Fabrikada → ...
--
-- 2) Marport'tan dolu konteyner alımı + gümrük muhafaza tel mühür (kolcu)
--    Operasyon iş emrine gümrük gerekli işaretler + yetkili ad/tel girer.
--    Şoför limanda "Tel Mühür Takıldı" → mühür no + zorunlu foto.
--    Tel mühür gerekliyse mühür no VE foto OLMADAN durum 'Teslim Edildi'ye geçemez
--    (BEFORE UPDATE trigger ile zorlanır — RAISE EXCEPTION).
--
-- Bağımlılık: supabase_setup_v2.sql (is_emirleri tablosu)
-- Geri alma: kolon DROP + trigger DROP + CHECK constraint geri al ('Boş Alındı'
--            satırları varsa elle 'Yolda'ya çevirin).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) DURUM ENUM'A 'Boş Alındı' EKLE
-- -----------------------------------------------------------------------------
-- Mevcut implicit constraint (is_emirleri_durum_check) ad farklı olabilir;
-- pg_constraint üzerinden bul ve drop.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.is_emirleri'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%durum%'
      AND pg_get_constraintdef(oid) ILIKE '%Bekliyor%'
  LOOP
    EXECUTE 'ALTER TABLE public.is_emirleri DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

ALTER TABLE public.is_emirleri
  ADD CONSTRAINT is_emirleri_durum_check
  CHECK (durum = ANY (ARRAY[
    'Bekliyor'::text,
    'Yolda'::text,
    'Fabrikada'::text,
    'Boş Alındı'::text,
    'Teslim Edildi'::text,
    'İptal'::text
  ]));

-- -----------------------------------------------------------------------------
-- 2) BOŞ ALIM KAYIT ALANLARI
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS bos_alindi_zaman   timestamptz,
  ADD COLUMN IF NOT EXISTS bos_alim_konteyner text,
  ADD COLUMN IF NOT EXISTS bos_alim_yer       text;

COMMENT ON COLUMN public.is_emirleri.bos_alindi_zaman IS
  'Şoför "Boş Aldım" butonuyla işaretledi — durum=Boş Alındı geçişi anı. Konum yayını mobile tarafında bu noktadan itibaren durur.';

-- -----------------------------------------------------------------------------
-- 3) GÜMRÜK TEL MÜHÜR ALANLARI
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS gumruk_muhur_gerekli boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gumruk_yetkili_ad    text,
  ADD COLUMN IF NOT EXISTS gumruk_yetkili_tel   text,
  ADD COLUMN IF NOT EXISTS gumruk_muhur_no      text,
  ADD COLUMN IF NOT EXISTS gumruk_muhur_zaman   timestamptz,
  ADD COLUMN IF NOT EXISTS gumruk_muhur_foto    text;

COMMENT ON COLUMN public.is_emirleri.gumruk_muhur_gerekli IS
  'Operasyon işaretler. true ise şoför takmadan ve foto yüklemeden iş "Teslim Edildi"ye geçemez.';
COMMENT ON COLUMN public.is_emirleri.gumruk_muhur_no IS
  'Şoförün limanda taktığı kolcu/gümrük tel mührünün numarası.';
COMMENT ON COLUMN public.is_emirleri.gumruk_muhur_foto IS
  'Tel mühür fotoğrafının Storage URL''si (zorunlu).';

-- -----------------------------------------------------------------------------
-- 4) DURUM GEÇİŞ KONTROL TRIGGER'I
-- -----------------------------------------------------------------------------
-- Tel mühür gerekliyse mühür no + foto OLMADAN 'Teslim Edildi'ye izin verme.
-- Mevcut bildirim trigger'ı (trg_is_emri_durum_bildirim) AFTER UPDATE; biz
-- BEFORE UPDATE ile çalışıyoruz, sıralama doğru — engellersek bildirim üretilmez.
CREATE OR REPLACE FUNCTION public.trg_is_emri_durum_gecis_kontrol()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Yalnızca durum değiştiğinde devreye gir
  IF NEW.durum IS NOT DISTINCT FROM OLD.durum THEN
    RETURN NEW;
  END IF;

  -- 'Teslim Edildi'ye geçiş — gümrük mühür gerekliyse zorunlu alanları doğrula
  IF NEW.durum = 'Teslim Edildi'
     AND COALESCE(NEW.gumruk_muhur_gerekli, false) = true THEN
    IF NEW.gumruk_muhur_no IS NULL OR length(trim(NEW.gumruk_muhur_no)) = 0 THEN
      RAISE EXCEPTION 'Gümrük tel mühür numarası girilmeden iş "Teslim Edildi" olamaz (id=%).', NEW.id
        USING ERRCODE = '23514';
    END IF;
    IF NEW.gumruk_muhur_foto IS NULL OR length(trim(NEW.gumruk_muhur_foto)) = 0 THEN
      RAISE EXCEPTION 'Gümrük tel mühür fotoğrafı yüklenmeden iş "Teslim Edildi" olamaz (id=%).', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_is_emri_durum_gecis_kontrol ON public.is_emirleri;
CREATE TRIGGER trg_is_emri_durum_gecis_kontrol
  BEFORE UPDATE OF durum ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_is_emri_durum_gecis_kontrol();

COMMENT ON FUNCTION public.trg_is_emri_durum_gecis_kontrol IS
  'Durum geçiş kuralı: gümrük mühür gerekliyse mühür no + foto olmadan Teslim Edildi engellenir.';

-- -----------------------------------------------------------------------------
-- 5) Mevcut ROTA MATE TRIGGER'I — 'Boş Alındı' eşleşme dışı bırakılsın
--    (Boş Alındı ön-faz, asıl yükleme/teslim yarın olacak; bugünkü teslim_yeri
--     eşleşmesi yanıltıcı olabilir.)
-- -----------------------------------------------------------------------------
-- 2026_05_05j migration'ında durum filtresi NOT IN ('İptal','Teslim Edildi');
-- şimdi 'Boş Alındı'yı da hariç tutacak şekilde fonksiyonu yeniden tanımla.
CREATE OR REPLACE FUNCTION public.trg_is_emri_rota_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diger     RECORD;
  v_etiket    text;
  v_a         bigint;
  v_b         bigint;
  v_tarih     date;
BEGIN
  IF NEW.firma_id IS NULL OR NEW.teslim_yeri IS NULL OR length(trim(NEW.teslim_yeri)) < 3 THEN
    RETURN NEW;
  END IF;

  v_tarih := COALESCE((NEW.created_at)::date, CURRENT_DATE);

  FOR v_diger IN
    SELECT i.id, i.teslim_yeri, i.sofor, i.sofor_user_id
    FROM public.is_emirleri i
    WHERE i.firma_id = NEW.firma_id
      AND i.id <> NEW.id
      AND i.teslim_yeri IS NOT NULL
      AND i.durum NOT IN ('İptal','Teslim Edildi','Boş Alındı')
      AND (i.created_at)::date = v_tarih
      AND (
        i.teslim_yeri ILIKE '%' || NEW.teslim_yeri || '%'
        OR NEW.teslim_yeri ILIKE '%' || i.teslim_yeri || '%'
      )
  LOOP
    IF v_diger.id < NEW.id THEN
      v_a := v_diger.id; v_b := NEW.id;
    ELSE
      v_a := NEW.id; v_b := v_diger.id;
    END IF;

    v_etiket := LOWER(TRIM(LEAST(NEW.teslim_yeri, v_diger.teslim_yeri)));

    INSERT INTO public.surucu_rota_eslesmeleri (firma_id, isemri_a, isemri_b, ortak_etiket, tarih)
      VALUES (NEW.firma_id, v_a, v_b, v_etiket, v_tarih)
      ON CONFLICT (isemri_a, isemri_b) DO NOTHING;

    IF NEW.sofor_user_id IS NOT NULL THEN
      PERFORM public.notify_create(
        NEW.firma_id, 'genel', '🤝 Rota arkadaşı bulundu',
        'Bugün ' || COALESCE(v_etiket, 'aynı bölge') || ' rotasında ' ||
          COALESCE(v_diger.sofor, 'başka bir şoför') || ' de var.',
        'is_emri', NEW.id::text, NULL, 'Sistem', 'normal'
      );
    END IF;
    IF v_diger.sofor_user_id IS NOT NULL
       AND v_diger.sofor_user_id <> COALESCE(NEW.sofor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      PERFORM public.notify_create(
        NEW.firma_id, 'genel', '🤝 Rota arkadaşı bulundu',
        'Bugün ' || COALESCE(v_etiket, 'aynı bölge') || ' rotasında ' ||
          COALESCE(NEW.sofor, 'başka bir şoför') || ' de var.',
        'is_emri', v_diger.id::text, NULL, 'Sistem', 'normal'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- 6) BİLDİRİM TRIGGER'I — 'Boş Alındı' geçişi de bildirim üretsin
-- -----------------------------------------------------------------------------
-- Mevcut trg_is_emri_durum_bildirim 'Yolda' / 'Fabrikada' / 'Teslim Edildi'
-- için mesaj üretiyor; 'Boş Alındı' için de yöneticiye haber verelim.
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
  IF NEW.durum IS NOT DISTINCT FROM OLD.durum THEN
    RETURN NEW;
  END IF;
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
  ELSIF NEW.durum = 'Boş Alındı' THEN
    v_tip     := 'is_emri_durum';
    v_baslik  := COALESCE(NEW.arac_plaka, '#' || NEW.id::text) || ' boş konteyner aldı';
    v_mesaj   := COALESCE(NEW.bos_alim_yer, NEW.yukle_yeri, 'Alım yeri') ||
                 ' · ' || COALESCE(NEW.bos_alim_konteyner, NEW.konteyner_no, 'Konteyner');
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

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Yeni durum kabul ediliyor mu:
--    UPDATE public.is_emirleri SET durum='Boş Alındı', bos_alindi_zaman=now()
--    WHERE id=<test_id>;
--
-- 2) Tel mühür koruması:
--    -- Önce gerekli işaretle:
--    UPDATE is_emirleri SET gumruk_muhur_gerekli=true, gumruk_yetkili_ad='Ali',
--      gumruk_yetkili_tel='0532...' WHERE id=<test_id>;
--    -- Mühür no/foto olmadan teslime al — HATA döner:
--    UPDATE is_emirleri SET durum='Teslim Edildi' WHERE id=<test_id>;
--    --> ERROR: Gümrük tel mühür numarası girilmeden iş "Teslim Edildi" olamaz
--
-- 3) Mühür no + foto var ise geçer:
--    UPDATE is_emirleri SET gumruk_muhur_no='TM12345', gumruk_muhur_foto='https://...',
--      gumruk_muhur_zaman=now() WHERE id=<test_id>;
--    UPDATE is_emirleri SET durum='Teslim Edildi' WHERE id=<test_id>;  -- OK
-- =============================================================================
