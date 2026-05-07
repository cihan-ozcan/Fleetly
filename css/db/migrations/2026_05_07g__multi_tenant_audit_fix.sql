-- =============================================================================
-- FLEETLY  —  2026-05-07g  —  Multi-tenant audit fix (RLS açıkları)
-- =============================================================================
-- KAPSAM:
--   2026_05_07b emergency fix bazı tablolara RLS ekledi ama aşağıdaki tablolar
--   atlanmıştı. Bu migration onları kapatır:
--     - activity_log (audit log — başka firmalar görebiliyordu)
--     - kayit_log (kayıt log — aynı sorun)
--     - odeme_gecmisi (faturalama / abonelik geçmişi)
--     - siparisler (eski CRM modülü)
--     - arac_sofor_atamalari (atama tarihçesi)
--     - konum_izleri (rota geçmişi — firma_id YOK, is_emri_id üzerinden çöz)
--     - surucu_paylasimlari (firma_id sınırı policy'lerde eksikti)
--
-- KAPSAM DIŞI (ayrı iş):
--     - tarifeler   (firma_id kolonu BIGINT, firmalar.id UUID — şema uyumsuz)
--     - bildirimler (broadcast guard RPC tarafında yapılmalı, ayrı PR)
--     - storage     (pod-documents path validation, ayrı PR)
--
-- Bağımlılık: 2026_05_07b__rls_emergency_fix.sql (helper fonksiyonlar)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) activity_log — audit log
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='activity_log') THEN
    EXECUTE 'ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS activity_log_v2_select ON public.activity_log';
    EXECUTE $POL$
      CREATE POLICY activity_log_v2_select ON public.activity_log
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids())
               OR user_id = auth.uid())
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS activity_log_v2_insert ON public.activity_log';
    EXECUTE $POL$
      CREATE POLICY activity_log_v2_insert ON public.activity_log
        FOR INSERT TO authenticated
        WITH CHECK (firma_id IN (SELECT public._user_firma_ids())
                    OR user_id = auth.uid())
    $POL$;
    -- UPDATE/DELETE: yok (immutable audit log)
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) kayit_log — kayıt log (aynı pattern, bigint id)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='kayit_log') THEN
    EXECUTE 'ALTER TABLE public.kayit_log ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS kayit_log_v2_select ON public.kayit_log';
    EXECUTE $POL$
      CREATE POLICY kayit_log_v2_select ON public.kayit_log
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids())
               OR user_id = auth.uid())
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS kayit_log_v2_insert ON public.kayit_log';
    EXECUTE $POL$
      CREATE POLICY kayit_log_v2_insert ON public.kayit_log
        FOR INSERT TO authenticated
        WITH CHECK (firma_id IN (SELECT public._user_firma_ids())
                    OR user_id = auth.uid())
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) odeme_gecmisi — abonelik / fatura geçmişi
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='odeme_gecmisi') THEN
    EXECUTE 'ALTER TABLE public.odeme_gecmisi ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS odeme_gecmisi_v2_select ON public.odeme_gecmisi';
    EXECUTE $POL$
      CREATE POLICY odeme_gecmisi_v2_select ON public.odeme_gecmisi
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;
    -- INSERT/UPDATE/DELETE: SADECE backend (service role / SECURITY DEFINER RPC)
    -- Müşteri faturayı düzenleyemesin diye policy yok → default deny.
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4) siparisler — eski CRM siparis modülü
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='siparisler') THEN
    EXECUTE 'ALTER TABLE public.siparisler ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS siparisler_v2_select ON public.siparisler';
    EXECUTE $POL$
      CREATE POLICY siparisler_v2_select ON public.siparisler
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS siparisler_v2_modify ON public.siparisler';
    EXECUTE $POL$
      CREATE POLICY siparisler_v2_modify ON public.siparisler
        FOR ALL TO authenticated
        USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
        WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()))
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5) arac_sofor_atamalari — atama tarihçesi
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='arac_sofor_atamalari') THEN
    EXECUTE 'ALTER TABLE public.arac_sofor_atamalari ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS arac_atama_v2_select ON public.arac_sofor_atamalari';
    EXECUTE $POL$
      CREATE POLICY arac_atama_v2_select ON public.arac_sofor_atamalari
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS arac_atama_v2_modify ON public.arac_sofor_atamalari';
    EXECUTE $POL$
      CREATE POLICY arac_atama_v2_modify ON public.arac_sofor_atamalari
        FOR ALL TO authenticated
        USING (firma_id IN (SELECT public._user_firma_yetkili_ids()))
        WITH CHECK (firma_id IN (SELECT public._user_firma_yetkili_ids()))
    $POL$;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6) konum_izleri — firma_id YOK, is_emri_id veya user_id üzerinden çöz
-- -----------------------------------------------------------------------------
-- Şoför kendi yazdığı konum'u görsün; yöneticiler kendi firma'larının iş
-- emirlerine bağlı tüm konumları görsün; başka firma görmesin.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='konum_izleri') THEN
    EXECUTE 'ALTER TABLE public.konum_izleri ENABLE ROW LEVEL SECURITY';

    -- Eski policy'ler 2026_04_29'dan kalmış olabilir; v2 ile değiştir
    EXECUTE 'DROP POLICY IF EXISTS konum_izleri_v2_select ON public.konum_izleri';
    EXECUTE $POL$
      CREATE POLICY konum_izleri_v2_select ON public.konum_izleri
        FOR SELECT TO authenticated
        USING (
          user_id = auth.uid()
          OR is_emri_id IN (
            SELECT id FROM public.is_emirleri
             WHERE firma_id IN (SELECT public._user_firma_ids())
          )
        )
    $POL$;

    -- INSERT: şoför kendi yazdığı konum (user_id = auth.uid()) veya iş emri sahibi
    EXECUTE 'DROP POLICY IF EXISTS konum_izleri_v2_insert ON public.konum_izleri';
    EXECUTE $POL$
      CREATE POLICY konum_izleri_v2_insert ON public.konum_izleri
        FOR INSERT TO authenticated
        WITH CHECK (
          user_id = auth.uid()
          OR is_emri_id IN (
            SELECT id FROM public.is_emirleri
             WHERE firma_id IN (SELECT public._user_firma_ids())
          )
        )
    $POL$;
    -- UPDATE/DELETE: yok (immutable trail)
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7) surucu_paylasimlari — firma sınırı önceki policy'lerde eksikti
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='surucu_paylasimlari')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='surucu_paylasimlari'
                   AND column_name='firma_id') THEN
    EXECUTE 'ALTER TABLE public.surucu_paylasimlari ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS surucu_paylasim_v2_select ON public.surucu_paylasimlari';
    EXECUTE $POL$
      CREATE POLICY surucu_paylasim_v2_select ON public.surucu_paylasimlari
        FOR SELECT TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS surucu_paylasim_v2_modify ON public.surucu_paylasimlari';
    EXECUTE $POL$
      CREATE POLICY surucu_paylasim_v2_modify ON public.surucu_paylasimlari
        FOR ALL TO authenticated
        USING (firma_id IN (SELECT public._user_firma_ids()))
        WITH CHECK (firma_id IN (SELECT public._user_firma_ids()))
    $POL$;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Tüm fixed tablolarda RLS açık mı:
--    SELECT tablename, rowsecurity FROM pg_tables
--     WHERE schemaname='public'
--       AND tablename IN ('activity_log','kayit_log','odeme_gecmisi','siparisler',
--                         'arac_sofor_atamalari','konum_izleri','surucu_paylasimlari');
--
-- 2) Çapraz firma sızıntısı testi:
--    SET request.jwt.claim.sub = '<firma_A_user>';
--    SELECT count(*) FROM siparisler WHERE firma_id IN (SELECT id FROM firmalar WHERE ad LIKE '%firma B%');
--    -> 0 olmalı.
-- =============================================================================
