-- =============================================================================
-- FLEETLY  —  2026-05-07e  —  is_emirleri.sofor_user_id OTOMATIK DOLDURMA
-- =============================================================================
-- KÖK SORUN:
--   RLS policy'si (2026_05_07b) is_emirleri UPDATE için iki yol açıyor:
--     a) firma_id IN (yetkili firmalar)  — operasyon kullanıcıları
--     b) sofor_user_id = auth.uid()      — şoförün kendi iş emri
--   Şoförler `firma_kullanicilar`'da yer almaz (kendi auth akışı: suruculer.auth_user_id).
--   Yani şoför için sadece (b) çalışır.
--
--   ANCAK iş emri yaratılırken `sofor_user_id` çoğu zaman NULL kalıyor:
--     - Tek-iş-emri formu: operasyon kullanıcısı şoförü seçtiğinde _opsSoforUserId
--       state'i set edilirse dolar; her zaman set edilmiyor (eski koddan kalan
--       şoförler ya da formu kısa yoldan dolduran yollar).
--     - Çoklu konteyner formu (app-chunk-05.js:2948): sofor_user_id: null HARDKODE.
--
--   Sonuç:
--     • Şoför mobile'dan "Yola Çıktım"/"Fabrikaya Vardım"/"Teslim Ettim" basıyor
--     • PATCH PostgREST üzerinden gidiyor → RLS satırı görmüyor (NULL ≠ uid)
--     • PostgREST 200 OK döner ama AFFECTED ROWS = 0
--     • Mobile sessizce "başarılı" sanıyor (optimistic UI gösterilir)
--     • Operasyon panelinde iş emri hâlâ "Bekliyor" gözükür, başlangıç_km görünmez
--
-- ÇÖZÜM (üç katman):
--   1) BEFORE INSERT/UPDATE trigger: sofor_user_id NULL ise surucu_id'den
--      (suruculer.auth_user_id) otomatik doldur. Yeni iş emirlerinde + atama
--      değişikliklerinde DB seviyesinde garanti.
--   2) Geriye dönük backfill: tüm sofor_user_id IS NULL olan kayıtlar için
--      surucu_id → auth_user_id ile doldur. Mevcut "stuck" iş emirleri kurtarılır.
--   3) Web/mobile tarafında kalan hardcoded NULL'lar ayrıca kod fix'i
--      (bu migration kapsamı dışında, ayrı PR ile).
--
-- Not: Bu migration RLS policy'sine DOKUNMAZ — tek değişiklik veri katmanında.
--      Policy zaten doğru, sorun verinin policy şartına uymaması.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Otomatik dolduran trigger fonksiyonu
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_isemri_sofor_user_id_doldur()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- suruculer'a okuma için (RLS bypass; sadece auth_user_id okur)
SET search_path = public
AS $$
BEGIN
  -- Şoför atanmış (surucu_id var) ama sofor_user_id eksikse, suruculer'dan al.
  IF NEW.sofor_user_id IS NULL AND NEW.surucu_id IS NOT NULL THEN
    SELECT s.auth_user_id INTO NEW.sofor_user_id
      FROM public.suruculer s
     WHERE s.id = NEW.surucu_id
     LIMIT 1;
  END IF;

  -- Tersine senkronizasyon: eğer sofor_user_id var ama surucu_id eksikse,
  -- suruculer kaydını bulup ata. (auth_user_id unique değil firmaya göre,
  -- kullanmadan önce LIMIT 1 + en son atanan al.)
  IF NEW.surucu_id IS NULL AND NEW.sofor_user_id IS NOT NULL THEN
    SELECT s.id INTO NEW.surucu_id
      FROM public.suruculer s
     WHERE s.auth_user_id = NEW.sofor_user_id
       AND (NEW.firma_id IS NULL OR s.firma_id = NEW.firma_id)
     ORDER BY s.created_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS isemri_sofor_user_id_doldur ON public.is_emirleri;
CREATE TRIGGER isemri_sofor_user_id_doldur
BEFORE INSERT OR UPDATE OF surucu_id, sofor_user_id ON public.is_emirleri
FOR EACH ROW EXECUTE FUNCTION public.trg_isemri_sofor_user_id_doldur();

-- -----------------------------------------------------------------------------
-- 2) Geriye dönük backfill — mevcut "stuck" iş emirlerini kurtar
-- -----------------------------------------------------------------------------
-- 2a) sofor_user_id NULL + surucu_id var → suruculer'dan auth_user_id çek
UPDATE public.is_emirleri ie
   SET sofor_user_id = s.auth_user_id
  FROM public.suruculer s
 WHERE ie.surucu_id = s.id
   AND ie.sofor_user_id IS NULL
   AND s.auth_user_id IS NOT NULL;

-- 2b) sofor_user_id NULL + surucu_id NULL → telefon ile şoförü bul, ikisini de doldur
UPDATE public.is_emirleri ie
   SET surucu_id     = s.id,
       sofor_user_id = s.auth_user_id
  FROM public.suruculer s
 WHERE ie.surucu_id IS NULL
   AND ie.sofor_user_id IS NULL
   AND s.firma_id = ie.firma_id
   AND s.telefon_e164 = public.fn_normalize_tel(ie.sofor_tel)
   AND s.auth_user_id IS NOT NULL;

-- 2c) Telefon eşleşmesi yok ama sofor (text ad) doluysa ve firma'da o adda
--     auth bağlı tek bir sürücü varsa onu ata
UPDATE public.is_emirleri ie
   SET surucu_id     = s.id,
       sofor_user_id = s.auth_user_id
  FROM public.suruculer s
 WHERE ie.surucu_id IS NULL
   AND ie.sofor_user_id IS NULL
   AND s.firma_id = ie.firma_id
   AND lower(trim(s.ad)) = lower(trim(ie.sofor))
   AND s.auth_user_id IS NOT NULL
   -- Aynı firma + aynı isimli birden fazla sürücü varsa atama yapma
   AND (SELECT count(*) FROM public.suruculer s2
         WHERE s2.firma_id = ie.firma_id
           AND lower(trim(s2.ad)) = lower(trim(ie.sofor))
           AND s2.auth_user_id IS NOT NULL) = 1;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Hâlâ NULL kalan iş emri var mı? (Şoföre atanmış olanlar arasında)
--    SELECT count(*) FROM is_emirleri
--     WHERE sofor_user_id IS NULL
--       AND (surucu_id IS NOT NULL OR sofor IS NOT NULL OR sofor_tel IS NOT NULL);
--    İdeal: 0. Sıfırdan büyükse o kayıtlardaki sürücü auth'a bağlanmamış demektir.
--
-- 2) Trigger çalışıyor mu? Yeni bir iş emri eklerken surucu_id ile:
--    INSERT INTO is_emirleri (firma_id, surucu_id, durum)
--    VALUES ('<firma>', '<surucu_uuid>', 'Bekliyor') RETURNING sofor_user_id;
--    sofor_user_id otomatik dolu gelmeli.
--
-- 3) Şoför artık UPDATE edebiliyor mu? Mobile'dan "Yola Çıktım" → operasyon
--    panelinde durum 'Yolda' olarak gözükmeli (hard refresh / Ctrl+F5).
-- =============================================================================
