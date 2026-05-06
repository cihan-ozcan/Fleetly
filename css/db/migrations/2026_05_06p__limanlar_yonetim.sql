-- =============================================================================
-- FLEETLY  —  2026-05-06p  —  Limanlar yönetim: güncelleme yetki + silme RPC
-- =============================================================================
-- Mevcut durumda:
--   • limanlar_update / limanlar_delete RLS policy'leri firma_id IS NULL olan
--     global limanlara izin vermiyor → kimse silemiyor / düzenleyemiyor.
--   • liman_guncelle RPC'si var ama yetki kontrolü YOK → SECURITY DEFINER ile
--     herhangi bir authenticated kullanıcı çağırabilir (potansiyel kötüye kullanım).
--   • liman_sil RPC'si yok.
--
-- Bu migration:
--   1) liman_guncelle'ye yetki kontrolü ekler (sahip/yonetici/operasyoncu)
--   2) liman_sil RPC'sini oluşturur (aynı yetki kontrolü + soft check: aktif
--      ziyaret varsa uyarı vermeden devam — manual cleanup için)
--   3) Global limanları (firma_id IS NULL) düzenleme yetkisi: herhangi firma'nın
--      sahip/yonetici rolündeki kullanıcı yeterli (geçici, manuel ayar fazı için).
--
-- ROADMAP — manuel ayar tamamlandıktan sonra:
--   • Web UI'da düzenle/sil butonlarını gizlemek yeterli (CFG.LIMAN_GLOBAL_EDIT=false)
--   • Bu migration'ı geri almak ve global liman düzenlemeyi sadece super-admin'e
--     bırakan yeni bir migration yazılabilir (ileride).
--
-- Bağımlılık: 2026_05_06l (limanlar tablosu, mevcut liman_guncelle RPC).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) liman_guncelle — yetki kontrolü eklenmiş sürüm
-- -----------------------------------------------------------------------------
-- p_id NULL ise hata. Kullanıcı sahip/yonetici/operasyoncu olmalı (herhangi firma).
-- Global limanlar (firma_id NULL) için de aynı yetki yeterli.
CREATE OR REPLACE FUNCTION public.liman_guncelle(
  p_id          uuid,
  p_ad          text DEFAULT NULL,
  p_tip         text DEFAULT NULL,
  p_poligon_geojson text DEFAULT NULL,
  p_aktif       boolean DEFAULT NULL,
  p_notlar      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_geom    geometry;
  v_yetki   boolean;
  v_liman   public.limanlar%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Liman id zorunlu' USING ERRCODE = '23502';
  END IF;

  -- Hedef liman var mı?
  SELECT * INTO v_liman FROM public.limanlar WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liman bulunamadı: %', p_id USING ERRCODE = '02000';
  END IF;

  -- Yetki kontrolü
  --   • Firma-özel liman (firma_id NOT NULL): kullanıcı O firmanın yöneticisi olmalı
  --   • Global liman (firma_id IS NULL): kullanıcı HERHANGİ firmanın sahip/yöneticisi olmalı
  --     (manuel ayar fazı için; ileride sıkılaştırılabilir)
  IF v_liman.firma_id IS NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ) INTO v_yetki;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.firma_id = v_liman.firma_id
         AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ) INTO v_yetki;
  END IF;

  IF NOT v_yetki THEN
    RAISE EXCEPTION 'Liman düzenleme yetkisi yok' USING ERRCODE = '42501';
  END IF;

  -- Polygon parse (verildiyse)
  IF p_poligon_geojson IS NOT NULL THEN
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_poligon_geojson), 4326);
    IF GeometryType(v_geom) <> 'POLYGON' THEN
      RAISE EXCEPTION 'Geometry Polygon olmalı (% verildi)', GeometryType(v_geom);
    END IF;
  END IF;

  UPDATE public.limanlar
     SET ad      = COALESCE(p_ad, ad),
         tip     = COALESCE(p_tip, tip),
         poligon = COALESCE(v_geom, poligon),
         aktif   = COALESCE(p_aktif, aktif),
         notlar  = COALESCE(p_notlar, notlar),
         updated_at = now()
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_guncelle(uuid, text, text, text, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.liman_guncelle IS
  'Liman güncelleme — sahip/yonetici/operasyoncu yetkisi gerek. Global limanlar (firma_id NULL) için herhangi firma yöneticisi yeterli (manuel ayar fazı).';

-- -----------------------------------------------------------------------------
-- 2) liman_sil — yeni RPC
-- -----------------------------------------------------------------------------
-- Aynı yetki kontrolü. ON DELETE CASCADE: liman_ziyaretleri ve
-- liman_global_yogunluk_5dk + liman_polygon_egitim de temizlenir.
CREATE OR REPLACE FUNCTION public.liman_sil(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_liman   public.limanlar%ROWTYPE;
  v_yetki   boolean;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Liman id zorunlu' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_liman FROM public.limanlar WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liman bulunamadı: %', p_id USING ERRCODE = '02000';
  END IF;

  -- Yetki: aynı liman_guncelle mantığı
  IF v_liman.firma_id IS NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.rol IN ('sahip','yonetici','operasyoncu')
    ) INTO v_yetki;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.firma_kullanicilar fk
       WHERE fk.user_id = auth.uid()
         AND fk.firma_id = v_liman.firma_id
         AND fk.rol IN ('sahip','yonetici')
    ) INTO v_yetki;
  END IF;

  IF NOT v_yetki THEN
    RAISE EXCEPTION 'Liman silme yetkisi yok' USING ERRCODE = '42501';
  END IF;

  -- DELETE — CASCADE'ler liman_ziyaretleri, yogunluk_5dk, polygon_egitim'i siler
  DELETE FROM public.limanlar WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.liman_sil(uuid) TO authenticated;

COMMENT ON FUNCTION public.liman_sil IS
  'Liman silme — sahip/yonetici yetkisi gerek. Global limanlar için herhangi firma yöneticisi yeterli (manuel ayar fazı). CASCADE ile ziyaret/yoğunluk/eğitim verisi de temizlenir.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Pre-seed limanlardan birini düzenle:
--    SELECT liman_guncelle(
--      (SELECT id FROM limanlar WHERE ad='Kumport' AND firma_id IS NULL),
--      p_notlar => 'Manuel ayarlandı 2026-05-06'
--    );
--
-- 2) Polygon güncelle:
--    SELECT liman_guncelle(
--      'uuid-kumport',
--      p_poligon_geojson => '{"type":"Polygon","coordinates":[...]}'
--    );
--
-- 3) Sil:
--    SELECT liman_sil('uuid-yesilkoy-kargo');
--
-- 4) Yetkisiz çağrı testi: 'sofor' rolündeki bir kullanıcıyla
--    SELECT liman_guncelle('uuid', p_ad => 'X');  -- 42501 error beklenir
-- =============================================================================
