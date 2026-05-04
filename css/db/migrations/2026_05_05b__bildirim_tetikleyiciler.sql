-- =============================================================================
-- FLEETLY  —  2026-05-05b  —  Bildirim tetikleyicileri (Paket B)
-- =============================================================================
-- Sürücüden gelen 3 olay tipi için trigger ekler:
--   1) is_emirleri.fotograflar UPDATE  → "Şoför fotoğraf yükledi"
--   2) yakit_girisleri  INSERT          → "Şoför yakıt aldı"
--   3) bakim_kayitlari INSERT (tur='ariza') → "Şoför arıza bildirdi" (KRİTİK)
--
-- Ön koşul: 2026_05_05__bildirimler.sql çalıştırılmış olmalı (notify_create RPC).
--
-- Geri alma: aşağıdaki trigger'lar DROP edilebilir, veriye dokunmaz.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) is_emirleri.fotograflar UPDATE → bildirim
--    fotograflar text DEFAULT '[]' (JSON-string olarak tutuluyor).
--    Yeni öğe eklendiyse (uzunluk arttıysa) bildirim üret.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_is_emri_foto_bildirim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_count int := 0;
  v_new_count int := 0;
  v_diff      int := 0;
  v_baslik    text;
  v_mesaj     text;
  v_kaynak_ad text;
BEGIN
  -- firma_id yoksa çık (eski kayıt)
  IF NEW.firma_id IS NULL THEN RETURN NEW; END IF;

  -- fotograflar gerçekten değişmediyse çık
  IF NEW.fotograflar IS NOT DISTINCT FROM OLD.fotograflar THEN
    RETURN NEW;
  END IF;

  -- JSON-array parse (text → jsonb), boş/geçersizse 0
  BEGIN
    v_old_count := jsonb_array_length(COALESCE(OLD.fotograflar, '[]')::jsonb);
  EXCEPTION WHEN OTHERS THEN v_old_count := 0;
  END;
  BEGIN
    v_new_count := jsonb_array_length(COALESCE(NEW.fotograflar, '[]')::jsonb);
  EXCEPTION WHEN OTHERS THEN v_new_count := 0;
  END;

  v_diff := v_new_count - v_old_count;
  IF v_diff <= 0 THEN
    -- Sadece silindi ya da değişmedi → bildirim yok
    RETURN NEW;
  END IF;

  v_kaynak_ad := COALESCE(NEW.sofor, NEW.arac_plaka, '—');
  v_baslik    := COALESCE(NEW.arac_plaka, '#' || NEW.id::text)
                 || ' — yeni fotoğraf yüklendi'
                 || CASE WHEN v_diff > 1 THEN ' (' || v_diff::text || ' adet)' ELSE '' END;
  v_mesaj     := 'Toplam ' || v_new_count::text || ' fotoğraf · '
                 || COALESCE(NEW.musteri_adi, 'Müşteri')
                 || CASE WHEN NEW.konteyner_no IS NOT NULL
                         THEN ' · ' || split_part(NEW.konteyner_no, E'\n', 1)
                         ELSE '' END;

  PERFORM public.notify_create(
    NEW.firma_id,
    'is_emri_foto',
    v_baslik,
    v_mesaj,
    'is_emri',
    NEW.id::text,
    NEW.sofor_user_id,
    v_kaynak_ad,
    'normal'
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_is_emri_foto_bildirim ON public.is_emirleri;
CREATE TRIGGER trg_is_emri_foto_bildirim
  AFTER UPDATE OF fotograflar ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_is_emri_foto_bildirim();

-- -----------------------------------------------------------------------------
-- 2) yakit_girisleri INSERT → bildirim
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_yakit_giris_bildirim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_baslik    text;
  v_mesaj     text;
  v_plaka     text;
  v_kaynak    text;
  v_total_tl  numeric;
BEGIN
  IF NEW.firma_id IS NULL THEN RETURN NEW; END IF;

  -- Aracın plakasını bul
  SELECT a.plaka INTO v_plaka
    FROM public.araclar a
   WHERE a.id = NEW.arac_id
   LIMIT 1;
  v_plaka := COALESCE(v_plaka, '—');

  v_kaynak    := COALESCE(NEW.sofor, v_plaka, 'Şoför');
  v_total_tl  := COALESCE(NEW.fiyat, 0);

  v_baslik := v_plaka || ' yakıt aldı';

  v_mesaj := COALESCE(NEW.litre::text, '?') || ' L'
          || CASE WHEN v_total_tl > 0
                  THEN ' · ' || to_char(v_total_tl, 'FM999G999G999D90') || ' ₺'
                  ELSE '' END
          || CASE WHEN NEW.istasyon IS NOT NULL THEN ' · ' || NEW.istasyon ELSE '' END
          || CASE WHEN NEW.km IS NOT NULL
                  THEN ' · km ' || to_char(NEW.km, 'FM999G999G999')
                  ELSE '' END;

  PERFORM public.notify_create(
    NEW.firma_id,
    'yakit',
    v_baslik,
    v_mesaj,
    'yakit',
    NEW.id::text,
    NULL,        -- yakit_girisleri.user_id var ama auth.uid bilgisini saklamıyor olabilir
    v_kaynak,
    CASE WHEN COALESCE(NEW.anomali_flag, '') <> '' THEN 'yuksek' ELSE 'normal' END
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_yakit_giris_bildirim ON public.yakit_girisleri;
CREATE TRIGGER trg_yakit_giris_bildirim
  AFTER INSERT ON public.yakit_girisleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_yakit_giris_bildirim();

-- -----------------------------------------------------------------------------
-- 3) bakim_kayitlari INSERT (tur='ariza') → bildirim (KRİTİK)
--    Diğer bakım türleri (Periyodik, Lastik vb.) bildirim üretmez —
--    bunlar genelde yönetici tarafından elle eklenir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bakim_ariza_bildirim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plaka     text;
  v_baslik    text;
  v_mesaj     text;
  v_kaynak_ad text;
BEGIN
  IF NEW.firma_id IS NULL THEN RETURN NEW; END IF;

  -- Yalnızca arıza kayıtları için bildirim
  IF lower(COALESCE(NEW.tur, '')) <> 'ariza' AND
     lower(COALESCE(NEW.tur, '')) <> 'arıza' THEN
    RETURN NEW;
  END IF;

  -- Aracın plakası
  SELECT a.plaka INTO v_plaka
    FROM public.araclar a
   WHERE a.id = NEW.arac_id
   LIMIT 1;
  v_plaka := COALESCE(v_plaka, '—');

  -- Kaynak adı: bakım kaydındaki user_id varsa o kullanıcının ad bilgisini al
  -- (firma_kullanicilar üzerinden değil — yine de basit tutalım, plaka yeterli)
  v_kaynak_ad := v_plaka;

  v_baslik := v_plaka || ' — ARIZA bildirildi';
  v_mesaj  := COALESCE(NEW.aciklama, 'Açıklama yok')
           || CASE WHEN NEW.km IS NOT NULL
                   THEN ' · km ' || to_char(NEW.km, 'FM999G999G999')
                   ELSE '' END
           || CASE WHEN NEW.servis IS NOT NULL THEN ' · Servis: ' || NEW.servis ELSE '' END;

  PERFORM public.notify_create(
    NEW.firma_id,
    'ariza',
    v_baslik,
    v_mesaj,
    'bakim',
    NEW.id::text,
    NULL,
    v_kaynak_ad,
    'kritik'   -- arıza her zaman kritik öncelik
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bakim_ariza_bildirim ON public.bakim_kayitlari;
CREATE TRIGGER trg_bakim_ariza_bildirim
  AFTER INSERT ON public.bakim_kayitlari
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bakim_ariza_bildirim();

COMMIT;

-- =============================================================================
-- DOĞRULAMA TESTLERİ (manuel)
-- =============================================================================
-- 1) Fotoğraf bildirimi:
--    SELECT id, fotograflar FROM public.is_emirleri WHERE durum = 'Yolda' LIMIT 1;
--    UPDATE public.is_emirleri
--    SET fotograflar = COALESCE(fotograflar::jsonb, '[]'::jsonb) || '["test.jpg"]'::jsonb
--    WHERE id = <id>;
--
-- 2) Yakıt bildirimi:
--    INSERT INTO public.yakit_girisleri (id, arac_id, tarih, km, litre, fiyat, firma_id, user_id, istasyon)
--    VALUES ('test-' || extract(epoch from now())::text,
--            (SELECT id FROM public.araclar LIMIT 1),
--            CURRENT_DATE, 154500, 250, 12500,
--            (SELECT firma_id FROM public.araclar LIMIT 1),
--            auth.uid(), 'Shell Test');
--
-- 3) Arıza bildirimi:
--    INSERT INTO public.bakim_kayitlari (id, user_id, arac_id, tarih, tur, aciklama, firma_id)
--    VALUES ('arz-' || extract(epoch from now())::text,
--            auth.uid(),
--            (SELECT id FROM public.araclar LIMIT 1),
--            CURRENT_DATE, 'ariza', 'Hidrolik kaçak — kontrol gerekli',
--            (SELECT firma_id FROM public.araclar LIMIT 1));
--
-- 4) Tüm yeni bildirimler:
--    SELECT tip, baslik, mesaj, oncelik, kaynak_ad, created_at
--    FROM public.bildirimler
--    ORDER BY created_at DESC LIMIT 10;
-- =============================================================================
