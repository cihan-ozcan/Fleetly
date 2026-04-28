-- =============================================================================
-- FLEETLY  —  2026-04-28  —  Belge Tarihleri Senkronizasyon Hotfix
-- =============================================================================
-- Problem:
--   2026-04-22 refactor migration'ı surucu_belgeler (eski) → surucu_belgeleri
--   (yeni) arasında tek seferlik backfill yaptı.  Sonraki ops düzenlemeleri
--   zaman zaman eski tabloya gittiğinden iki tablo arasında tarih kayması oluştu:
--     • Ops paneli acil durum: eski tablo + localStorage cache → doğru tarih
--     • Şoför portalı (v_surucu_dosyasi → surucu_belgeleri): expired / boş
--     • Sürücüler formu: boş alanlar
--
-- Bu migration iki şey yapar:
--   1) Mevcut tüm kayıtları resync eder (GREATEST → daha ileri tarih kazanır).
--   2) trg_surucu_belgeler_to_new trigger'ı ekler: eski tabloya gelen her
--      INSERT/UPDATE'i otomatik yeni tabloya yansıtır (tek yön, loop yok).
--
-- NOT: Ters yön (yeni → eski) trigger eklenmez — çift tetikleyici sonsuz döngü
--      oluşturur.  Yeni yol (saveDriverEntryCloud → surucu_belgeleri) doğrudan
--      yeni tabloya yazdığından ters senkronizasyona gerek yoktur.
--
-- Tamamen idempotenttir; birden fazla kez güvenle çalıştırılabilir.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1)  ONE-TIME RESYNC
--     surucu_belgeler (eski) → surucu_belgeleri (yeni)
--     GREATEST() ile iki tablodaki en ileri (gelecekteki) tarihi koru.
--     Bekliyor/reddedildi onay süreçlerine dokunma.
-- ---------------------------------------------------------------------------
INSERT INTO public.surucu_belgeleri
  (surucu_id, firma_id, belge_turu, bitis_tarihi, sinif, belge_no, onay_durumu, kaynak)
SELECT
  s.id,
  s.firma_id,
  v.belge_turu,
  v.bitis::date,
  v.sinif,
  v.no,
  'onayli',
  'migration'
FROM public.surucu_belgeler sb
JOIN public.suruculer s
  ON  s.firma_id     = sb.firma_id
  AND s.telefon_e164 = public.fn_normalize_tel(sb.tel)
CROSS JOIN LATERAL (VALUES
  ('ehliyet',  GREATEST(sb.ehliyet_bitis, sb.ehliyet),  sb.ehliyet_sinifi, sb.ehliyet_no),
  ('src',      GREATEST(sb.src_bitis,     sb.src),      NULL::text,        NULL::text),
  ('psiko',    GREATEST(sb.psiko_bitis,   sb.psiko),    NULL,              NULL),
  ('saglik',   sb.saglik_bitis,                         NULL,              NULL),
  ('takograf', sb.takograf,                             NULL,              NULL)
) AS v(belge_turu, bitis, sinif, no)
WHERE v.bitis IS NOT NULL
ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
  bitis_tarihi = GREATEST(EXCLUDED.bitis_tarihi,  public.surucu_belgeleri.bitis_tarihi),
  sinif        = COALESCE(EXCLUDED.sinif,          public.surucu_belgeleri.sinif),
  belge_no     = COALESCE(EXCLUDED.belge_no,       public.surucu_belgeleri.belge_no),
  updated_at   = now()
WHERE public.surucu_belgeleri.onay_durumu = 'onayli';
-- ↑ onay_durumu 'bekliyor' veya 'reddedildi' olan satırları atlıyoruz;
--   şoförün devam eden onay talebini ezme.


-- ---------------------------------------------------------------------------
-- 2)  FORWARD SYNC TRIGGER  (eski → yeni, TEK YÖN)
--     surucu_belgeler'de her INSERT/UPDATE sonrası surucu_belgeleri'ni
--     otomatik güncelle.  Ters trigger eklenmez (sonsuz döngü önlemi).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_surucu_belgeler_to_new()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_sid  uuid;
  v_fid  uuid;
BEGIN
  -- Telefon ile suruculer tablosundan sürücüyü bul
  SELECT id, firma_id
    INTO v_sid, v_fid
    FROM public.suruculer
   WHERE firma_id     = NEW.firma_id
     AND telefon_e164 = public.fn_normalize_tel(NEW.tel)
   LIMIT 1;

  IF v_sid IS NULL THEN RETURN NEW; END IF;  -- eşleşme yok, geç

  -- Ehliyet
  IF GREATEST(NEW.ehliyet_bitis, NEW.ehliyet) IS NOT NULL THEN
    INSERT INTO public.surucu_belgeleri
      (surucu_id, firma_id, belge_turu, bitis_tarihi, sinif, belge_no, onay_durumu, kaynak)
    VALUES
      (v_sid, v_fid, 'ehliyet',
       GREATEST(NEW.ehliyet_bitis, NEW.ehliyet),
       NEW.ehliyet_sinifi, NEW.ehliyet_no, 'onayli', 'ofis')
    ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
      bitis_tarihi = GREATEST(EXCLUDED.bitis_tarihi, public.surucu_belgeleri.bitis_tarihi),
      sinif        = COALESCE(EXCLUDED.sinif,         public.surucu_belgeleri.sinif),
      belge_no     = COALESCE(EXCLUDED.belge_no,      public.surucu_belgeleri.belge_no),
      updated_at   = now()
    WHERE public.surucu_belgeleri.onay_durumu = 'onayli';
  END IF;

  -- SRC
  IF GREATEST(NEW.src_bitis, NEW.src) IS NOT NULL THEN
    INSERT INTO public.surucu_belgeleri
      (surucu_id, firma_id, belge_turu, bitis_tarihi, onay_durumu, kaynak)
    VALUES
      (v_sid, v_fid, 'src', GREATEST(NEW.src_bitis, NEW.src), 'onayli', 'ofis')
    ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
      bitis_tarihi = GREATEST(EXCLUDED.bitis_tarihi, public.surucu_belgeleri.bitis_tarihi),
      updated_at   = now()
    WHERE public.surucu_belgeleri.onay_durumu = 'onayli';
  END IF;

  -- Psikoteknik
  IF GREATEST(NEW.psiko_bitis, NEW.psiko) IS NOT NULL THEN
    INSERT INTO public.surucu_belgeleri
      (surucu_id, firma_id, belge_turu, bitis_tarihi, onay_durumu, kaynak)
    VALUES
      (v_sid, v_fid, 'psiko', GREATEST(NEW.psiko_bitis, NEW.psiko), 'onayli', 'ofis')
    ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
      bitis_tarihi = GREATEST(EXCLUDED.bitis_tarihi, public.surucu_belgeleri.bitis_tarihi),
      updated_at   = now()
    WHERE public.surucu_belgeleri.onay_durumu = 'onayli';
  END IF;

  -- Sağlık Raporu
  IF NEW.saglik_bitis IS NOT NULL THEN
    INSERT INTO public.surucu_belgeleri
      (surucu_id, firma_id, belge_turu, bitis_tarihi, onay_durumu, kaynak)
    VALUES
      (v_sid, v_fid, 'saglik', NEW.saglik_bitis, 'onayli', 'ofis')
    ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
      bitis_tarihi = GREATEST(EXCLUDED.bitis_tarihi, public.surucu_belgeleri.bitis_tarihi),
      updated_at   = now()
    WHERE public.surucu_belgeleri.onay_durumu = 'onayli';
  END IF;

  -- Takoğraf Kartı
  IF NEW.takograf IS NOT NULL THEN
    INSERT INTO public.surucu_belgeleri
      (surucu_id, firma_id, belge_turu, bitis_tarihi, onay_durumu, kaynak)
    VALUES
      (v_sid, v_fid, 'takograf', NEW.takograf, 'onayli', 'ofis')
    ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
      bitis_tarihi = GREATEST(EXCLUDED.bitis_tarihi, public.surucu_belgeleri.bitis_tarihi),
      updated_at   = now()
    WHERE public.surucu_belgeleri.onay_durumu = 'onayli';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS surucu_belgeler_to_new ON public.surucu_belgeler;
CREATE TRIGGER surucu_belgeler_to_new
AFTER INSERT OR UPDATE ON public.surucu_belgeler
FOR EACH ROW EXECUTE FUNCTION public.trg_surucu_belgeler_to_new();


-- ---------------------------------------------------------------------------
-- 3)  VIEW yetkilerini yenile
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.v_surucu_dosyasi         TO anon, authenticated, service_role;
GRANT SELECT ON public.v_arac_secim             TO anon, authenticated, service_role;
GRANT SELECT ON public.v_surucu_belge_uyarilari TO anon, authenticated, service_role;

COMMIT;

-- =============================================================================
-- Sonu.  Bu dosya tek işlemde (BEGIN/COMMIT) çalışır;
-- herhangi bir adım başarısız olursa tüm değişiklikler rollback edilir.
-- =============================================================================
