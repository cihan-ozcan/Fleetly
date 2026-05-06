-- =============================================================================
-- FLEETLY  —  2026-05-07b  —  ACİL RLS DÜZELTMESİ (multi-tenant izolasyon)
-- =============================================================================
-- KRİTİK: Bazı eski tablolarda RLS hiç açılmamış veya policy eksik.
-- Sonuç: yeni hesap açan başka bir firma kullanıcısı, mevcut firma'nın
-- araç listesi, iş emri, müşteri, davet kodları gibi verilerini görebiliyordu.
-- (Veritabanı yapımı supabase_setup_v2.sql'den geliyor — orada policy yoktu.)
--
-- Bu migration:
--   1) Kritik tablolarda RLS'i ENABLE eder (zaten açıksa no-op)
--   2) Standart firma_id-bazlı SELECT/ALL policy'leri ekler
--   3) firmalar + firma_kullanicilar için özel policy'ler (üyelik kontrolü)
--
-- Eski policy'lere dokunmuyoruz — yeni adlandırma ile (suffix _v2_emergency)
-- ekliyoruz. RLS'te policy'ler OR ile birleşir → güvenlik bozulmaz.
--
-- Bağımlılık: supabase_setup_v2.sql + tüm önceki migration'lar
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Yardımcı: kullanıcının üye olduğu firma_id'ler
-- -----------------------------------------------------------------------------
-- (RLS subquery'lerinde tekrar tekrar kullanılıyor; STABLE + SECURITY DEFINER
--  ile RLS recursion'ından kaçınıyoruz — auth.uid() context'i korunur)
CREATE OR REPLACE FUNCTION public._user_firma_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid()
  UNION
  SELECT firma_id FROM public.suruculer WHERE auth_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public._user_firma_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public._user_firma_yetkili_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT firma_id FROM public.firma_kullanicilar
   WHERE user_id = auth.uid()
     AND rol IN ('sahip','yonetici','operasyoncu','muhasebeci');
$$;

GRANT EXECUTE ON FUNCTION public._user_firma_yetkili_ids() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2) ARAÇLAR — filo listesi (en kritik sızıntı buradan oldu)
-- -----------------------------------------------------------------------------
ALTER TABLE public.araclar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS araclar_v2_select ON public.araclar;
CREATE POLICY araclar_v2_select ON public.araclar
  FOR SELECT TO authenticated
  USING (firma_id IN (SELECT public._user_firma_ids()));

DROP POLICY IF EXISTS araclar_v2_modify ON public.araclar;
CREATE POLICY araclar_v2_modify ON public.araclar
  FOR ALL TO authenticated
  USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
  WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()));

-- -----------------------------------------------------------------------------
-- 3) İŞ EMİRLERİ
-- -----------------------------------------------------------------------------
ALTER TABLE public.is_emirleri ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS is_emirleri_v2_select ON public.is_emirleri;
CREATE POLICY is_emirleri_v2_select ON public.is_emirleri
  FOR SELECT TO authenticated
  USING (
    firma_id IN (SELECT public._user_firma_ids())
    OR sofor_user_id = auth.uid()
  );

DROP POLICY IF EXISTS is_emirleri_v2_modify ON public.is_emirleri;
CREATE POLICY is_emirleri_v2_modify ON public.is_emirleri
  FOR ALL TO authenticated
  USING (
    firma_id IN (SELECT public._user_firma_yetkili_ids())
    OR sofor_user_id = auth.uid()
  )
  WITH CHECK (
    firma_id IN (SELECT public._user_firma_yetkili_ids())
    OR sofor_user_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- 4) MÜŞTERİLER (CRM)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='musteriler') THEN
    EXECUTE 'ALTER TABLE public.musteriler ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS musteriler_v2_select ON public.musteriler';
    EXECUTE $POL$
      CREATE POLICY musteriler_v2_select ON public.musteriler
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;
    EXECUTE 'DROP POLICY IF EXISTS musteriler_v2_modify ON public.musteriler';
    EXECUTE $POL$
      CREATE POLICY musteriler_v2_modify ON public.musteriler
        FOR ALL TO authenticated
        USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
        WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()))
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5) SÜRÜCÜ DAVETLERİ (kullanıcı bunları gördü diye yazdı — kritik)
-- -----------------------------------------------------------------------------
ALTER TABLE public.surucu_davetleri ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS surucu_davetleri_v2_select ON public.surucu_davetleri;
CREATE POLICY surucu_davetleri_v2_select ON public.surucu_davetleri
  FOR SELECT TO authenticated
  USING (firma_id IN (SELECT public._user_firma_ids()));

DROP POLICY IF EXISTS surucu_davetleri_v2_modify ON public.surucu_davetleri;
CREATE POLICY surucu_davetleri_v2_modify ON public.surucu_davetleri
  FOR ALL TO authenticated
  USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
  WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()));

-- -----------------------------------------------------------------------------
-- 6) SEFERLER
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='seferler' AND column_name='firma_id') THEN
    EXECUTE 'ALTER TABLE public.seferler ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS seferler_v2_select ON public.seferler';
    EXECUTE $POL$
      CREATE POLICY seferler_v2_select ON public.seferler
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;
    EXECUTE 'DROP POLICY IF EXISTS seferler_v2_modify ON public.seferler';
    EXECUTE $POL$
      CREATE POLICY seferler_v2_modify ON public.seferler
        FOR ALL TO authenticated
        USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
        WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()))
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7) YAKIT GİRİŞLERİ
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='yakit_girisleri' AND column_name='firma_id') THEN
    EXECUTE 'ALTER TABLE public.yakit_girisleri ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS yakit_v2_select ON public.yakit_girisleri';
    EXECUTE $POL$
      CREATE POLICY yakit_v2_select ON public.yakit_girisleri
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;
    EXECUTE 'DROP POLICY IF EXISTS yakit_v2_modify ON public.yakit_girisleri';
    EXECUTE $POL$
      CREATE POLICY yakit_v2_modify ON public.yakit_girisleri
        FOR ALL TO authenticated
        USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
        WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()))
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8) DORSE TİPLERİ — varsa firma'ya özelse korunmalı
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='dorse_tipleri' AND column_name='firma_id') THEN
    EXECUTE 'ALTER TABLE public.dorse_tipleri ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS dorse_tip_v2_select ON public.dorse_tipleri';
    EXECUTE $POL$
      CREATE POLICY dorse_tip_v2_select ON public.dorse_tipleri
        FOR SELECT TO authenticated
        USING (firma_id IS NULL OR firma_id IN (SELECT public._user_firma_ids()))
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 9) FİRMALAR — kullanıcı yalnızca üye olduğu firma(lar)ı görsün
-- -----------------------------------------------------------------------------
ALTER TABLE public.firmalar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firmalar_v2_select ON public.firmalar;
CREATE POLICY firmalar_v2_select ON public.firmalar
  FOR SELECT TO authenticated
  USING (id IN (SELECT public._user_firma_ids()));

-- Sahip rolündeki kullanıcı kendi firma kaydını güncelleyebilir
DROP POLICY IF EXISTS firmalar_v2_update ON public.firmalar;
CREATE POLICY firmalar_v2_update ON public.firmalar
  FOR UPDATE TO authenticated
  USING (id IN (
    SELECT firma_id FROM public.firma_kullanicilar
    WHERE user_id = auth.uid() AND rol IN ('sahip','yonetici','operasyoncu')
  ));

-- -----------------------------------------------------------------------------
-- 10) FİRMA KULLANICILARI — kullanıcı kendi atamalarını görsün
-- -----------------------------------------------------------------------------
ALTER TABLE public.firma_kullanicilar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firma_kul_v2_select ON public.firma_kullanicilar;
CREATE POLICY firma_kul_v2_select ON public.firma_kullanicilar
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR firma_id IN (
      SELECT firma_id FROM public.firma_kullanicilar
      WHERE user_id = auth.uid() AND rol IN ('sahip','yonetici')
    )
  );

-- INSERT/DELETE: sadece sahip/yonetici (yeni kullanıcı atayabilir)
DROP POLICY IF EXISTS firma_kul_v2_modify ON public.firma_kullanicilar;
CREATE POLICY firma_kul_v2_modify ON public.firma_kullanicilar
  FOR ALL TO authenticated
  USING (firma_id IN (
    SELECT firma_id FROM public.firma_kullanicilar
    WHERE user_id = auth.uid() AND rol IN ('sahip','yonetici')
  ))
  WITH CHECK (firma_id IN (
    SELECT firma_id FROM public.firma_kullanicilar
    WHERE user_id = auth.uid() AND rol IN ('sahip','yonetici')
  ));

-- -----------------------------------------------------------------------------
-- 11) MASRAFLAR — eğer firma_id varsa
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='masraflar' AND column_name='firma_id') THEN
    EXECUTE 'ALTER TABLE public.masraflar ENABLE ROW LEVEL SECURITY';
    -- 2026_05_06e migration'da policy var; biz ek olarak v2 koyuyoruz (OR ile birleşir)
    EXECUTE 'DROP POLICY IF EXISTS masraflar_v2_select ON public.masraflar';
    EXECUTE $POL$
      CREATE POLICY masraflar_v2_select ON public.masraflar
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids())
               OR sofor_user_id = auth.uid()
               OR user_id = auth.uid())
    $POL$;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA — uygulamadan sonra çalıştırın
-- =============================================================================
-- 1) Tüm kritik tablolarda RLS açık mı:
--    SELECT tablename, rowsecurity FROM pg_tables
--     WHERE schemaname='public'
--       AND tablename IN ('araclar','is_emirleri','musteriler','suruculer',
--                         'surucu_davetleri','seferler','yakit_girisleri',
--                         'firmalar','firma_kullanicilar','masraflar');
--    Hepsi `rowsecurity=true` olmalı.
--
-- 2) Yeni kullanıcı (firma_kullanicilar'da kaydı yok) test:
--    SET request.jwt.claim.sub = '<yeni_user_id>';
--    SELECT count(*) FROM araclar;     → 0 dönmeli (artık başka firma görmez)
--    SELECT count(*) FROM is_emirleri; → 0
--
-- =============================================================================
