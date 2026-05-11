-- =============================================================================
-- FLEETLY  —  2026-05-11f  —  Aşama 3 Schema (Duyurular + CMS + Sistem Ayarları)
-- =============================================================================
-- AÇIK:
--   Platform admin paneli Aşama 3 için DB altyapısı:
--     • platform_duyurular            → tüm/seçili firmalara in-app banner
--     • platform_duyuru_okundu        → kullanıcı kapatma kaydı
--     • sistem_icerikleri             → KVKK, Şartlar, SSS metinleri (CMS)
--     • platform_ayarlari             → key-value config (feature flags, vs.)
--
-- BAĞIMLILIK: 2026_05_11a (_is_platform_admin, admin_log)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) PLATFORM DUYURULAR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_duyurular (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baslik          text NOT NULL,
  icerik          text NOT NULL,           -- markdown / kısa HTML
  tip             text NOT NULL DEFAULT 'bilgi'
                  CHECK (tip IN ('bilgi','uyari','bakim','yeni_ozellik','kampanya')),
  -- Hedef filtre: NULL = tüm aktif firmalar
  -- jsonb örnek: {"abonelik_durumu":["aktif","deneme"]} veya {"firma_id":["uuid",...]}
  hedef_filtre    jsonb,
  baslangic       timestamptz NOT NULL DEFAULT now(),
  bitis           timestamptz,             -- NULL = süresiz
  aktif           boolean NOT NULL DEFAULT true,
  -- Kapatılabilir mi? false → kullanıcı dismiss edemez (kritik duyurular için)
  kapatilabilir   boolean NOT NULL DEFAULT true,
  link_url        text,                    -- opsiyonel "Detay" butonu
  link_text       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_duyurular_aktif
  ON public.platform_duyurular(aktif, baslangic DESC) WHERE aktif = true;

COMMENT ON TABLE public.platform_duyurular IS
  'Platform admin → firma kullanıcılarına yönelik duyurular. 2026_05_11f.';

ALTER TABLE public.platform_duyurular ENABLE ROW LEVEL SECURITY;

-- Tüm authenticated kullanıcılar AKTİF duyuruları okur (kendisine yönelik filtre RPC'de)
DROP POLICY IF EXISTS duyurular_select ON public.platform_duyurular;
CREATE POLICY duyurular_select ON public.platform_duyurular
  FOR SELECT TO authenticated
  USING (aktif = true);

-- INSERT/UPDATE/DELETE: sadece platform admin (RPC üzerinden)

-- -----------------------------------------------------------------------------
-- 2) DUYURU OKUNDU / KAPATILDI
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_duyuru_okundu (
  duyuru_id     uuid NOT NULL REFERENCES public.platform_duyurular(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  okundu_at     timestamptz,
  kapatildi_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (duyuru_id, user_id)
);

ALTER TABLE public.platform_duyuru_okundu ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS duyuru_okundu_select ON public.platform_duyuru_okundu;
CREATE POLICY duyuru_okundu_select ON public.platform_duyuru_okundu
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS duyuru_okundu_insert ON public.platform_duyuru_okundu;
CREATE POLICY duyuru_okundu_insert ON public.platform_duyuru_okundu
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS duyuru_okundu_update ON public.platform_duyuru_okundu;
CREATE POLICY duyuru_okundu_update ON public.platform_duyuru_okundu
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3) SİSTEM İÇERİKLERİ (CMS — KVKK / Şartlar / SSS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sistem_icerikleri (
  kod             text PRIMARY KEY,        -- 'kvkk', 'sartlar', 'sss', 'hakkimizda', 'iade_politikasi'
  baslik          text NOT NULL,
  icerik_html     text NOT NULL DEFAULT '',
  icerik_md       text,                    -- markdown (opsiyonel kaynak)
  son_guncelleme  timestamptz NOT NULL DEFAULT now(),
  guncelleyen     uuid REFERENCES auth.users(id),
  versiyon        integer NOT NULL DEFAULT 1
);

COMMENT ON TABLE public.sistem_icerikleri IS
  'Platform CMS — KVKK, Şartlar, SSS, vb. statik metinler. Admin paneli yönetir.';

ALTER TABLE public.sistem_icerikleri ENABLE ROW LEVEL SECURITY;

-- Public select: KVKK/Şartlar herkes (anon dahil) okur — login öncesi sayfalar için
DROP POLICY IF EXISTS sistem_icerik_select ON public.sistem_icerikleri;
CREATE POLICY sistem_icerik_select ON public.sistem_icerikleri
  FOR SELECT USING (true);

GRANT SELECT ON public.sistem_icerikleri TO anon, authenticated;

-- INSERT/UPDATE/DELETE: sadece platform admin (RPC ile)

-- Pre-seed (boş içerik — admin doldurur)
INSERT INTO public.sistem_icerikleri(kod, baslik, icerik_html) VALUES
  ('kvkk',         'KVKK Aydınlatma Metni',         ''),
  ('sartlar',      'Kullanım Şartları',              ''),
  ('sss',          'Sıkça Sorulan Sorular',          ''),
  ('hakkimizda',   'Hakkımızda',                     ''),
  ('iade_politikasi','İade Politikası',              '')
ON CONFLICT (kod) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) PLATFORM AYARLARI (key-value config)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_ayarlari (
  anahtar         text PRIMARY KEY,        -- 'bakim_modu_aktif', 'bakim_modu_mesaj', 'kayit_acik', ...
  deger           jsonb NOT NULL,          -- true / "metin" / {"a":1} — tip bağımsız
  aciklama        text,
  guncelleme_at   timestamptz NOT NULL DEFAULT now(),
  guncelleyen     uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.platform_ayarlari IS
  'Platform geneli key-value ayarlar (feature flags, bakım modu, vb.). 2026_05_11f.';

ALTER TABLE public.platform_ayarlari ENABLE ROW LEVEL SECURITY;

-- Public read: belirli "public" anahtarları herkes okuyabilir (bakım modu, kayıt açık mı, vb.)
-- Diğerleri sadece platform admin
DROP POLICY IF EXISTS ayar_select ON public.platform_ayarlari;
CREATE POLICY ayar_select ON public.platform_ayarlari
  FOR SELECT USING (
    public._is_platform_admin()
    OR anahtar IN ('bakim_modu_aktif', 'bakim_modu_mesaj', 'kayit_acik', 'duyuru_banner_aktif')
  );

GRANT SELECT ON public.platform_ayarlari TO anon, authenticated;

-- Pre-seed
INSERT INTO public.platform_ayarlari(anahtar, deger, aciklama) VALUES
  ('bakim_modu_aktif',    'false'::jsonb, 'Sistem bakım modu aktif mi? true → tüm yazma engellenir.'),
  ('bakim_modu_mesaj',    '"Sistem bakımdadır, kısa süre içinde dönecektir."'::jsonb, 'Bakım modu banner mesajı.'),
  ('bakim_modu_baslama',  'null'::jsonb,  'Bakım modu başlangıç zamanı.'),
  ('bakim_modu_bitis',    'null'::jsonb,  'Bakım modu tahmini bitiş.'),
  ('kayit_acik',          'true'::jsonb,  'Yeni firma kaydı açık mı?')
ON CONFLICT (anahtar) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5) RPC: kullanici_aktif_duyurular  — frontend banner için
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kullanici_aktif_duyurular()
RETURNS TABLE(
  id            uuid,
  baslik        text,
  icerik        text,
  tip           text,
  link_url      text,
  link_text     text,
  kapatilabilir boolean,
  baslangic     timestamptz,
  bitis         timestamptz,
  zaten_kapatildi boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_firma_id uuid;
  v_durum    text;
BEGIN
  -- Kullanıcının firmasını ve durumunu bul
  SELECT fk.firma_id, f.abonelik_durumu
    INTO v_firma_id, v_durum
    FROM public.firma_kullanicilar fk
    LEFT JOIN public.firmalar f ON f.id = fk.firma_id
    WHERE fk.user_id = auth.uid()
    LIMIT 1;

  -- Şoför ise:
  IF v_firma_id IS NULL THEN
    SELECT s.firma_id, f.abonelik_durumu
      INTO v_firma_id, v_durum
      FROM public.suruculer s
      LEFT JOIN public.firmalar f ON f.id = s.firma_id
      WHERE s.auth_user_id = auth.uid()
      LIMIT 1;
  END IF;

  RETURN QUERY
    SELECT
      d.id, d.baslik, d.icerik, d.tip,
      d.link_url, d.link_text, d.kapatilabilir,
      d.baslangic, d.bitis,
      EXISTS(
        SELECT 1 FROM public.platform_duyuru_okundu o
         WHERE o.duyuru_id = d.id AND o.user_id = auth.uid()
      ) AS zaten_kapatildi
    FROM public.platform_duyurular d
    WHERE d.aktif = true
      AND d.baslangic <= now()
      AND (d.bitis IS NULL OR d.bitis > now())
      AND (
        d.hedef_filtre IS NULL
        OR (
          (d.hedef_filtre ? 'abonelik_durumu' = false
            OR v_durum = ANY(SELECT jsonb_array_elements_text(d.hedef_filtre->'abonelik_durumu')))
          AND
          (d.hedef_filtre ? 'firma_id' = false
            OR v_firma_id::text = ANY(SELECT jsonb_array_elements_text(d.hedef_filtre->'firma_id')))
        )
      )
    ORDER BY
      CASE d.tip WHEN 'bakim' THEN 0 WHEN 'uyari' THEN 1 ELSE 2 END,
      d.baslangic DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.kullanici_aktif_duyurular() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) RPC: duyuru_kapat — kullanıcı kapatma kaydı
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duyuru_kapat(p_duyuru_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.platform_duyuru_okundu(duyuru_id, user_id, okundu_at, kapatildi_at)
  VALUES (p_duyuru_id, auth.uid(), now(), now())
  ON CONFLICT (duyuru_id, user_id) DO UPDATE
    SET kapatildi_at = now();
END $$;

GRANT EXECUTE ON FUNCTION public.duyuru_kapat(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) ADMIN RPC'LERİ — Duyurular
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_duyuru_olustur(
  p_baslik        text,
  p_icerik        text,
  p_tip           text DEFAULT 'bilgi',
  p_hedef_filtre  jsonb DEFAULT NULL,
  p_baslangic     timestamptz DEFAULT now(),
  p_bitis         timestamptz DEFAULT NULL,
  p_kapatilabilir boolean DEFAULT true,
  p_link_url      text DEFAULT NULL,
  p_link_text     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.platform_duyurular(
    baslik, icerik, tip, hedef_filtre, baslangic, bitis,
    kapatilabilir, link_url, link_text, created_by
  ) VALUES (
    p_baslik, p_icerik, p_tip, p_hedef_filtre, p_baslangic, p_bitis,
    p_kapatilabilir, p_link_url, p_link_text, auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.admin_log(
    'duyuru_olustur', 'duyuru', v_id::text,
    'Duyuru: ' || p_baslik,
    jsonb_build_object('id', v_id, 'tip', p_tip, 'hedef', p_hedef_filtre)
  );

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_duyuru_olustur(text, text, text, jsonb, timestamptz, timestamptz, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_duyuru_sil(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_baslik text;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  SELECT baslik INTO v_baslik FROM public.platform_duyurular WHERE id = p_id;
  DELETE FROM public.platform_duyurular WHERE id = p_id;
  PERFORM public.admin_log(
    'duyuru_sil', 'duyuru', p_id::text,
    'Duyuru silindi: ' || COALESCE(v_baslik, p_id::text),
    jsonb_build_object('id', p_id, 'baslik', v_baslik)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_duyuru_sil(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_duyuru_aktiflik(p_id uuid, p_aktif boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  UPDATE public.platform_duyurular SET aktif = p_aktif, updated_at = now() WHERE id = p_id;
  PERFORM public.admin_log(
    CASE WHEN p_aktif THEN 'duyuru_aktiflestir' ELSE 'duyuru_durdur' END,
    'duyuru', p_id::text,
    'Duyuru ' || CASE WHEN p_aktif THEN 'aktifleştirildi' ELSE 'durduruldu' END,
    jsonb_build_object('id', p_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_duyuru_aktiflik(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_duyurular_listele(
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id              uuid,
  baslik          text,
  icerik          text,
  tip             text,
  hedef_filtre    jsonb,
  baslangic       timestamptz,
  bitis           timestamptz,
  aktif           boolean,
  kapatilabilir   boolean,
  link_url        text,
  link_text       text,
  okundu_sayisi   bigint,
  created_at      timestamptz,
  created_by_email text,
  toplam          bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_toplam bigint;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(*) INTO v_toplam FROM public.platform_duyurular;

  RETURN QUERY
    SELECT
      d.id, d.baslik, d.icerik, d.tip, d.hedef_filtre,
      d.baslangic, d.bitis, d.aktif, d.kapatilabilir,
      d.link_url, d.link_text,
      (SELECT COUNT(*) FROM public.platform_duyuru_okundu o WHERE o.duyuru_id = d.id),
      d.created_at,
      u.email::text,
      v_toplam
    FROM public.platform_duyurular d
    LEFT JOIN auth.users u ON u.id = d.created_by
    ORDER BY d.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_duyurular_listele(integer, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8) ADMIN RPC'LERİ — CMS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_icerik_kaydet(
  p_kod         text,
  p_baslik      text,
  p_icerik_html text,
  p_icerik_md   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.sistem_icerikleri(kod, baslik, icerik_html, icerik_md, son_guncelleme, guncelleyen, versiyon)
  VALUES (p_kod, p_baslik, p_icerik_html, p_icerik_md, now(), auth.uid(), 1)
  ON CONFLICT (kod) DO UPDATE
    SET baslik = EXCLUDED.baslik,
        icerik_html = EXCLUDED.icerik_html,
        icerik_md = EXCLUDED.icerik_md,
        son_guncelleme = now(),
        guncelleyen = auth.uid(),
        versiyon = public.sistem_icerikleri.versiyon + 1;

  PERFORM public.admin_log(
    'icerik_guncelle', 'icerik', p_kod,
    'İçerik güncellendi: ' || p_kod,
    jsonb_build_object('kod', p_kod, 'baslik', p_baslik, 'uzunluk', length(p_icerik_html))
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_icerik_kaydet(text, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9) ADMIN RPC'LERİ — Sistem Ayarları
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ayar_set(
  p_anahtar text,
  p_deger   jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_eski jsonb;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  SELECT deger INTO v_eski FROM public.platform_ayarlari WHERE anahtar = p_anahtar;

  INSERT INTO public.platform_ayarlari(anahtar, deger, guncelleme_at, guncelleyen)
  VALUES (p_anahtar, p_deger, now(), auth.uid())
  ON CONFLICT (anahtar) DO UPDATE
    SET deger = EXCLUDED.deger,
        guncelleme_at = now(),
        guncelleyen = auth.uid();

  PERFORM public.admin_log(
    'ayar_set', 'ayar', p_anahtar,
    'Ayar değişti: ' || p_anahtar,
    jsonb_build_object('anahtar', p_anahtar, 'eski', v_eski, 'yeni', p_deger)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_ayar_set(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ayarlari_listele()
RETURNS TABLE(
  anahtar       text,
  deger         jsonb,
  aciklama      text,
  guncelleme_at timestamptz,
  guncelleyen   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Yetkisiz' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT pa.anahtar, pa.deger, pa.aciklama, pa.guncelleme_at, pa.guncelleyen
    FROM public.platform_ayarlari pa
    ORDER BY pa.anahtar;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_ayarlari_listele() TO authenticated;

-- -----------------------------------------------------------------------------
-- 10) PUBLIC: ayar_get (anon dahil — bakım modu için)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ayar_get(p_anahtar text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT deger FROM public.platform_ayarlari WHERE anahtar = p_anahtar
$$;

GRANT EXECUTE ON FUNCTION public.ayar_get(text) TO anon, authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Duyuru oluştur:
--   SELECT admin_duyuru_olustur(
--     'Hoşgeldin Fleetly v3.0!',
--     'Yeni dashboard, daha hızlı raporlar ve POD imza geliştirmeleri.',
--     'yeni_ozellik'
--   );
--
-- 2) Aktif duyuruları al (kullanıcı görünür):
--   SELECT * FROM kullanici_aktif_duyurular();
--
-- 3) İçerik kaydet:
--   SELECT admin_icerik_kaydet('kvkk', 'KVKK Aydınlatma Metni', '<h1>...</h1>');
--
-- 4) Bakım modu aç:
--   SELECT admin_ayar_set('bakim_modu_aktif', 'true'::jsonb);
--   SELECT admin_ayar_set('bakim_modu_mesaj', '"Yarın 02:00-04:00 bakım"'::jsonb);
-- =============================================================================
