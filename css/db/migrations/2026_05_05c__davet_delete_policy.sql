-- =============================================================================
-- FLEETLY  —  2026-05-05c  —  surucu_davetleri DELETE policy + soft fields
-- =============================================================================
-- Davet ekranında "kalıcı sil" butonunu çalıştırmak için DELETE policy ekler.
-- Yalnızca sahip/yönetici rolündeki kullanıcılar silebilir.
--
-- Mevcut SELECT/INSERT/UPDATE policy'lerine dokunulmaz.
-- =============================================================================

BEGIN;

-- DELETE policy — yalnızca firma sahip/yöneticisi
DROP POLICY IF EXISTS surucu_davetleri_delete ON public.surucu_davetleri;
CREATE POLICY surucu_davetleri_delete ON public.surucu_davetleri
  FOR DELETE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
  ));

COMMIT;

-- =============================================================================
-- DOĞRULAMA
--   SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid = 'public.surucu_davetleri'::regclass;
-- =============================================================================
