-- =============================================================================
-- FLEETLY  —  2026-05-06  —  Şoför Duyuru "Anlaşıldı" mekanizması
-- =============================================================================
-- Yöneticinin (sahip/yonetici/operasyoncu) Şoför Akışı'na bıraktığı pinli
-- duyurular, şoförün ana ekranında banner olarak görünür. Şoför "Anlaşıldı"
-- dedikten sonra banner kaybolur (ama paylaşım hâlâ feed'de kalır).
--
-- Bağımlılık: 2026_05_05j__surucu_paylasimlari.sql (ana modül)
--
-- Yeni:
--   1) surucu_paylasim_okundu       — kullanıcı × paylaşım dismiss tablosu
--   2) surucu_duyuru_dismiss(uuid)  — RPC: bir duyuruyu okundu işaretle
--   3) surucu_aktif_duyurular()     — RPC: ana ekran için "açıkta kalan"
--                                     pinli yönetici duyuruları
--
-- Geri alma: Tablo + 2 RPC DROP edilebilir; ana modül etkilenmez.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) DISMISS TABLOSU
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_paylasim_okundu (
  paylasim_id  uuid NOT NULL REFERENCES public.surucu_paylasimlari(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  okundu_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paylasim_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_paylasim_okundu_user
  ON public.surucu_paylasim_okundu (user_id, okundu_at DESC);

COMMENT ON TABLE public.surucu_paylasim_okundu IS
  'Şoförün "Anlaşıldı" dediği duyuru kayıtları. Banner artık görünmez ama paylaşım feed''te kalır.';

-- RLS: kullanıcı sadece kendi dismiss kaydını görür/yazar
ALTER TABLE public.surucu_paylasim_okundu ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS okundu_select ON public.surucu_paylasim_okundu;
CREATE POLICY okundu_select ON public.surucu_paylasim_okundu
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS okundu_insert ON public.surucu_paylasim_okundu;
CREATE POLICY okundu_insert ON public.surucu_paylasim_okundu
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS okundu_delete ON public.surucu_paylasim_okundu;
CREATE POLICY okundu_delete ON public.surucu_paylasim_okundu
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2) RPC: dismiss
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.surucu_duyuru_dismiss(
  p_paylasim_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.surucu_paylasim_okundu (paylasim_id, user_id)
    VALUES (p_paylasim_id, v_user_id)
    ON CONFLICT (paylasim_id, user_id) DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_duyuru_dismiss(uuid) TO authenticated;

COMMENT ON FUNCTION public.surucu_duyuru_dismiss IS
  'Şoför "Anlaşıldı" tıkladığında çağırır — duyuru artık banner olarak görünmez.';

-- -----------------------------------------------------------------------------
-- 3) RPC: aktif duyurular (ana ekran banner'ı)
-- -----------------------------------------------------------------------------
-- Kriter (DECISIONS.md #6):
--   • kaynak_rol = 'yonetici'   (sadece yönetici/operasyoncu/sahip duyuruları)
--   • pinned     = true         (yönetici post'ları RPC default'tan zaten true)
--   • silindi_mi = false
--   • gecerli_bitis IS NULL OR > now()
--   • bu kullanıcı tarafından dismiss edilmemiş
--
-- Aynı firma kontrolü: RLS zaten paylaşımları aynı firma içine kısıtlıyor;
-- SECURITY DEFINER olduğumuz için biz de elle aynı firma filtresi koyuyoruz.
CREATE OR REPLACE FUNCTION public.surucu_aktif_duyurular()
RETURNS TABLE (
  id              uuid,
  firma_id        uuid,
  kaynak_user_id  uuid,
  kaynak_ad       text,
  kaynak_plaka    text,
  kaynak_rol      text,
  kategori        text,
  baslik          text,
  mesaj           text,
  konum_lat       double precision,
  konum_lng       double precision,
  konum_url       text,
  konum_etiket    text,
  ilgili_isemri   bigint,
  foto_urls       text[],
  gecerli_baslangic timestamptz,
  gecerli_bitis   timestamptz,
  pinned          boolean,
  begeni_sayisi   integer,
  yorum_sayisi    integer,
  silindi_mi      boolean,
  suresi_doldu_mu boolean,
  created_at      timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_firma_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  -- Aynı kullanıcının firma_id'sini çöz (firma_kullanicilar veya suruculer)
  SELECT firma_id INTO v_firma_id FROM (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = v_user_id
    UNION
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = v_user_id
  ) x LIMIT 1;

  IF v_firma_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT
      p.id, p.firma_id, p.kaynak_user_id, p.kaynak_ad, p.kaynak_plaka, p.kaynak_rol,
      p.kategori, p.baslik, p.mesaj,
      p.konum_lat, p.konum_lng, p.konum_url, p.konum_etiket,
      p.ilgili_isemri, p.foto_urls,
      p.gecerli_baslangic, p.gecerli_bitis, p.pinned,
      p.begeni_sayisi, p.yorum_sayisi, p.silindi_mi,
      false AS suresi_doldu_mu,                           -- aktif olduğu garanti
      p.created_at
    FROM public.surucu_paylasimlari p
    WHERE p.firma_id = v_firma_id
      AND p.silindi_mi = false
      AND p.kaynak_rol = 'yonetici'
      AND p.pinned     = true
      AND (p.gecerli_bitis IS NULL OR p.gecerli_bitis > now())
      AND NOT EXISTS (
        SELECT 1 FROM public.surucu_paylasim_okundu o
         WHERE o.paylasim_id = p.id AND o.user_id = v_user_id
      )
    ORDER BY p.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_aktif_duyurular() TO authenticated;

COMMENT ON FUNCTION public.surucu_aktif_duyurular IS
  'Şoför ana ekranı banner''ı için: pinli + yönetici + süresi dolmamış + dismiss edilmemiş duyurular.';

-- -----------------------------------------------------------------------------
-- 4) Realtime publication — dismiss tablosu (opsiyonel, ileride faydalı)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.surucu_paylasim_okundu;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Aktif duyuruları çek (oturumlu kullanıcı):
--    SELECT id, baslik, mesaj, kaynak_ad, created_at
--      FROM public.surucu_aktif_duyurular();
--
-- 2) Birini "Anlaşıldı" işaretle:
--    SELECT public.surucu_duyuru_dismiss('<paylasim_uuid>');
--
-- 3) Tekrar çek — aynı paylaşım listede olmamalı:
--    SELECT id FROM public.surucu_aktif_duyurular() WHERE id = '<paylasim_uuid>';
-- =============================================================================
