-- =============================================================================
-- FLEETLY  —  2026-05-11g  —  Sistem Geneli Bakım Modu Trigger
-- =============================================================================
-- AÇIK:
--   platform_ayarlari.bakim_modu_aktif = true → tüm INSERT/UPDATE/DELETE
--   engellenir (SELECT serbest). Platform admin'ler bypass eder.
--
-- KORUNAN TABLOLAR: is_emirleri, araclar, suruculer, musteriler,
--                   yakit_girisleri, masraflar, harcirah_kayitlari,
--                   bakim_kayitlari, surucu_paylasimlari, konum_izleri,
--                   firmalar UPDATE (yeni firma kaydı kayit_acik flag'ine bağlı)
--
-- BAĞIMLILIK: 2026_05_11a (_is_platform_admin), 2026_05_11f (platform_ayarlari)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Helper — bakım modu aktif mi?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._platform_bakim_modu_aktif()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT (deger)::text::boolean
  FROM public.platform_ayarlari
  WHERE anahtar = 'bakim_modu_aktif'
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public._platform_bakim_modu_aktif() TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 2) Trigger fonksiyonu (yazma için ortak engelleyici)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_bakim_modu_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Platform admin bypass eder — sistem onarımı yapabilir
  IF public._is_platform_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public._platform_bakim_modu_aktif() THEN
    RAISE EXCEPTION 'Sistem bakım modunda. Yazma işlemleri geçici olarak kapalı.'
      USING ERRCODE = '57P03';   -- "cannot connect now" — anlamlı hata kodu
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- -----------------------------------------------------------------------------
-- 3) Trigger'ları korunan tablolara bağla (INSERT + UPDATE + DELETE)
-- -----------------------------------------------------------------------------
-- Yardımcı block: tablo listesi üzerinde döner, trigger ekler
DO $$
DECLARE
  v_tablo text;
  v_tablo_list text[] := ARRAY[
    'is_emirleri', 'araclar', 'suruculer', 'musteriler',
    'yakit_girisleri', 'masraflar', 'harcirah_kayitlari',
    'bakim_kayitlari', 'surucu_paylasimlari', 'konum_izleri',
    'limanlar', 'liman_ziyaretleri', 'firmalar', 'firma_kullanicilar',
    'firma_kullanici_davetleri', 'bildirimler', 'app_errors',
    'odeme_gecmisi', 'surucu_belgeler'
  ];
BEGIN
  FOREACH v_tablo IN ARRAY v_tablo_list
  LOOP
    -- Tablo var mı kontrol
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tablo
    ) THEN
      -- Eski trigger varsa düşür
      EXECUTE format('DROP TRIGGER IF EXISTS trg_bakim_modu_%I ON public.%I', v_tablo, v_tablo);

      -- INSERT, UPDATE, DELETE için tek trigger
      EXECUTE format($f$
        CREATE TRIGGER trg_bakim_modu_%I
          BEFORE INSERT OR UPDATE OR DELETE ON public.%I
          FOR EACH ROW EXECUTE FUNCTION public.trg_bakim_modu_check()
      $f$, v_tablo, v_tablo);
    END IF;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.trg_bakim_modu_check IS
  'Bakım modu aktifken yazma engelleyici. Platform admin bypass eder.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Bakım modunu aç (platform admin olarak):
--   SELECT admin_ayar_set('bakim_modu_aktif', 'true'::jsonb);
--
-- 2) Normal kullanıcı olarak yazma dene (bir başka oturum) — 57P03 hatası beklenir:
--   INSERT INTO is_emirleri (...) VALUES (...);
--
-- 3) Platform admin olarak yazma dene — başarılı olmalı.
--
-- 4) Bakım modunu kapat:
--   SELECT admin_ayar_set('bakim_modu_aktif', 'false'::jsonb);
-- =============================================================================
