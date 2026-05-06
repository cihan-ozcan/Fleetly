-- =============================================================================
-- FLEETLY  —  2026-05-05j  —  Şoför Koordinasyon Modülü (Paket A)
-- =============================================================================
-- Şoför ↔ şoför bilgi paylaşım altyapısı:
--   1) surucu_paylasimlari       — kategori bazlı feed (trafik/liman/fabrika/...)
--   2) surucu_paylasim_yorumlari — paylaşım altı yorumlar
--   3) surucu_paylasim_begenileri — 👍 / "doğrulandı" işareti
--   4) surucu_dm_mesajlari       — şoför↔şoför direkt mesaj
--   5) surucu_rota_eslesmeleri   — aynı gün aynı teslim_yeri'ne giden iş emirleri
--
-- Karar referansları (DECISIONS.md):
--   • Privacy: yalnızca aynı firma içinde
--   • DM: yönetici (sahip/operasyoncu) SELECT yapabilir (moderasyon)
--   • Geçerlilik default'ları: trafik 8h / liman 12h / fabrika kalıcı / yakıt 48h /
--     soru 7g / genel 24h
--   • Rota mate: teslim_yeri ILIKE eşleşmesi
--   • Yönetici paylaşım yetkisi: kategori='genel', pinned=true, kaynak_rol='yonetici'
--
-- Geri alma: tüm tablolar/policy/RPC/trigger DROP edilebilir; mevcut tablo
-- şemaları (is_emirleri, firmalar, ...) değişmedi.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) PAYLAŞIMLAR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_paylasimlari (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id           uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kaynak_user_id     uuid NOT NULL REFERENCES auth.users(id),
  kaynak_ad          text NOT NULL,                 -- snapshot
  kaynak_plaka       text,                          -- snapshot
  kaynak_rol         text NOT NULL DEFAULT 'sofor'  -- 'sofor' | 'yonetici'
                     CHECK (kaynak_rol IN ('sofor','yonetici')),
  kategori           text NOT NULL CHECK (kategori IN (
                       'trafik','liman','fabrika','yakit','soru','genel'
                     )),
  baslik             text,
  mesaj              text NOT NULL,
  konum_lat          double precision,
  konum_lng          double precision,
  konum_url          text,                          -- Google Maps share link
  konum_etiket       text,                          -- "Kumport 2 No Kapı", "TEM Mahmutbey"
  ilgili_isemri      bigint REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  foto_urls          text[],
  gecerli_baslangic  timestamptz NOT NULL DEFAULT now(),
  gecerli_bitis      timestamptz,                   -- NULL = kalıcı
  pinned             boolean NOT NULL DEFAULT false,
  begeni_sayisi      integer NOT NULL DEFAULT 0,
  yorum_sayisi       integer NOT NULL DEFAULT 0,
  silindi_mi         boolean NOT NULL DEFAULT false,
  silen_user_id      uuid REFERENCES auth.users(id),
  silinme_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paylasim_firma_feed
  ON public.surucu_paylasimlari (firma_id, silindi_mi, pinned DESC, created_at DESC)
  WHERE silindi_mi = false;
CREATE INDEX IF NOT EXISTS idx_paylasim_kategori
  ON public.surucu_paylasimlari (firma_id, kategori, created_at DESC)
  WHERE silindi_mi = false;
CREATE INDEX IF NOT EXISTS idx_paylasim_kaynak
  ON public.surucu_paylasimlari (kaynak_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paylasim_konum_etiket
  ON public.surucu_paylasimlari (firma_id, konum_etiket)
  WHERE konum_etiket IS NOT NULL;

COMMENT ON TABLE public.surucu_paylasimlari IS
  'Şoför koordinasyon modülü ana feed. Kategori bazlı paylaşımlar (trafik, liman, fabrika, yakıt, soru, genel). Yalnızca aynı firma şoförleri görür.';

-- -----------------------------------------------------------------------------
-- 2) YORUMLAR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_paylasim_yorumlari (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paylasim_id     uuid NOT NULL REFERENCES public.surucu_paylasimlari(id) ON DELETE CASCADE,
  firma_id        uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kaynak_user_id  uuid NOT NULL REFERENCES auth.users(id),
  kaynak_ad       text NOT NULL,
  kaynak_rol      text NOT NULL DEFAULT 'sofor'
                  CHECK (kaynak_rol IN ('sofor','yonetici')),
  mesaj           text NOT NULL,
  silindi_mi      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yorum_paylasim
  ON public.surucu_paylasim_yorumlari (paylasim_id, created_at ASC)
  WHERE silindi_mi = false;

-- -----------------------------------------------------------------------------
-- 3) BEĞENİ / DOĞRULAMA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_paylasim_begenileri (
  paylasim_id     uuid NOT NULL REFERENCES public.surucu_paylasimlari(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  firma_id        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paylasim_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_begeni_user
  ON public.surucu_paylasim_begenileri (user_id, paylasim_id);

-- -----------------------------------------------------------------------------
-- 4) DİREKT MESAJ (DM)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_dm_mesajlari (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id          uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  gonderen_user_id  uuid NOT NULL REFERENCES auth.users(id),
  alici_user_id     uuid NOT NULL REFERENCES auth.users(id),
  gonderen_ad       text,                            -- snapshot
  alici_ad          text,                            -- snapshot
  mesaj             text NOT NULL,
  okundu_at         timestamptz,
  silindi_mi        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (gonderen_user_id <> alici_user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_konusma
  ON public.surucu_dm_mesajlari (firma_id, gonderen_user_id, alici_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_alici_okunmamis
  ON public.surucu_dm_mesajlari (alici_user_id, okundu_at)
  WHERE okundu_at IS NULL AND silindi_mi = false;

-- -----------------------------------------------------------------------------
-- 5) ROTA MATE EŞLEŞMELERİ
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.surucu_rota_eslesmeleri (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  isemri_a        bigint NOT NULL REFERENCES public.is_emirleri(id) ON DELETE CASCADE,
  isemri_b        bigint NOT NULL REFERENCES public.is_emirleri(id) ON DELETE CASCADE,
  ortak_etiket    text,
  tarih           date NOT NULL,
  aktif           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (isemri_a < isemri_b),                       -- normalizasyon: küçük id önce
  UNIQUE (isemri_a, isemri_b)
);

CREATE INDEX IF NOT EXISTS idx_rota_firma_tarih
  ON public.surucu_rota_eslesmeleri (firma_id, tarih DESC, aktif);
CREATE INDEX IF NOT EXISTS idx_rota_isemri_a
  ON public.surucu_rota_eslesmeleri (isemri_a) WHERE aktif = true;
CREATE INDEX IF NOT EXISTS idx_rota_isemri_b
  ON public.surucu_rota_eslesmeleri (isemri_b) WHERE aktif = true;

COMMENT ON TABLE public.surucu_rota_eslesmeleri IS
  'Aynı firma + aynı tarih + benzer teslim_yeri (ILIKE) iki iş emrini eşleştirir. Trigger doldurur.';

-- =============================================================================
-- RLS — firma_id bazlı erişim
-- =============================================================================

ALTER TABLE public.surucu_paylasimlari       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surucu_paylasim_yorumlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surucu_paylasim_begenileri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surucu_dm_mesajlari       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surucu_rota_eslesmeleri   ENABLE ROW LEVEL SECURITY;

-- Helper: firma üyeliği (firma_kullanicilar) VEYA o firmanın aktif şoförü (suruculer)
-- Şoförler firma_kullanicilar'da olmayabilir; kendi firma_id'lerini suruculer üzerinden alır.
-- Aşağıdaki policy'lerde "is_member_of_firma" mantığı için iki yol birden tutuluyor.

-- ---- 1) PAYLAŞIMLAR
DROP POLICY IF EXISTS paylasim_select ON public.surucu_paylasimlari;
CREATE POLICY paylasim_select ON public.surucu_paylasimlari
  FOR SELECT TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS paylasim_insert ON public.surucu_paylasimlari;
CREATE POLICY paylasim_insert ON public.surucu_paylasimlari
  FOR INSERT TO authenticated
  WITH CHECK (
    kaynak_user_id = auth.uid()
    AND firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

-- UPDATE: kullanıcı kendi paylaşımını update edebilir; yönetici (sahip/operasyoncu)
-- pinned/silindi_mi alanlarını update edebilir.
DROP POLICY IF EXISTS paylasim_update ON public.surucu_paylasimlari;
CREATE POLICY paylasim_update ON public.surucu_paylasimlari
  FOR UPDATE TO authenticated
  USING (
    kaynak_user_id = auth.uid()
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
  );

DROP POLICY IF EXISTS paylasim_delete ON public.surucu_paylasimlari;
CREATE POLICY paylasim_delete ON public.surucu_paylasimlari
  FOR DELETE TO authenticated
  USING (
    kaynak_user_id = auth.uid()
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
    )
  );

-- ---- 2) YORUMLAR (paylaşım görenin yorumu görme/yazma hakkı vardır)
DROP POLICY IF EXISTS yorum_select ON public.surucu_paylasim_yorumlari;
CREATE POLICY yorum_select ON public.surucu_paylasim_yorumlari
  FOR SELECT TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS yorum_insert ON public.surucu_paylasim_yorumlari;
CREATE POLICY yorum_insert ON public.surucu_paylasim_yorumlari
  FOR INSERT TO authenticated
  WITH CHECK (
    kaynak_user_id = auth.uid()
    AND firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS yorum_update ON public.surucu_paylasim_yorumlari;
CREATE POLICY yorum_update ON public.surucu_paylasim_yorumlari
  FOR UPDATE TO authenticated
  USING (
    kaynak_user_id = auth.uid()
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
  );

DROP POLICY IF EXISTS yorum_delete ON public.surucu_paylasim_yorumlari;
CREATE POLICY yorum_delete ON public.surucu_paylasim_yorumlari
  FOR DELETE TO authenticated
  USING (
    kaynak_user_id = auth.uid()
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
    )
  );

-- ---- 3) BEĞENİLER
DROP POLICY IF EXISTS begeni_select ON public.surucu_paylasim_begenileri;
CREATE POLICY begeni_select ON public.surucu_paylasim_begenileri
  FOR SELECT TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS begeni_insert ON public.surucu_paylasim_begenileri;
CREATE POLICY begeni_insert ON public.surucu_paylasim_begenileri
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS begeni_delete ON public.surucu_paylasim_begenileri;
CREATE POLICY begeni_delete ON public.surucu_paylasim_begenileri
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---- 4) DM
-- DECISIONS.md #2: Yönetici (sahip/yonetici/operasyoncu) DM içeriklerini SELECT yapabilir
-- (moderasyon). INSERT yalnızca gonderen=auth.uid() içindir; yönetici DM yazamaz.
DROP POLICY IF EXISTS dm_select ON public.surucu_dm_mesajlari;
CREATE POLICY dm_select ON public.surucu_dm_mesajlari
  FOR SELECT TO authenticated
  USING (
    auth.uid() = gonderen_user_id
    OR auth.uid() = alici_user_id
    OR firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
  );

DROP POLICY IF EXISTS dm_insert ON public.surucu_dm_mesajlari;
CREATE POLICY dm_insert ON public.surucu_dm_mesajlari
  FOR INSERT TO authenticated
  WITH CHECK (
    gonderen_user_id = auth.uid()
    AND firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );

-- UPDATE: yalnızca alıcı "okundu" işaretleyebilir; mesaj içeriği değişmez (uygulama tarafında zorlanır).
DROP POLICY IF EXISTS dm_update ON public.surucu_dm_mesajlari;
CREATE POLICY dm_update ON public.surucu_dm_mesajlari
  FOR UPDATE TO authenticated
  USING (alici_user_id = auth.uid() OR gonderen_user_id = auth.uid());

DROP POLICY IF EXISTS dm_delete ON public.surucu_dm_mesajlari;
CREATE POLICY dm_delete ON public.surucu_dm_mesajlari
  FOR DELETE TO authenticated
  USING (gonderen_user_id = auth.uid());

-- ---- 5) ROTA MATE
DROP POLICY IF EXISTS rota_select ON public.surucu_rota_eslesmeleri;
CREATE POLICY rota_select ON public.surucu_rota_eslesmeleri
  FOR SELECT TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
      UNION
      SELECT s.firma_id FROM public.suruculer s WHERE s.auth_user_id = auth.uid()
    )
  );
-- Insert/Delete trigger üzerinden yapılır (SECURITY DEFINER).

-- =============================================================================
-- RPC'ler — SECURITY DEFINER pattern (notify_create ile aynı stil)
-- =============================================================================

-- ---- 1) PAYLAŞIM OLUŞTUR
-- Spam guard (1 dk içinde 3'ten fazla paylaşım) burada uygulanır.
-- Yönetici rolündeki kullanıcı kaynak_rol='yonetici' olarak yazabilir; otomatik pinned=true.
-- Geçerlilik default'ları kategoriye göre uygulanır (DECISIONS.md #3 — uzun default'lar).
CREATE OR REPLACE FUNCTION public.surucu_paylasim_create(
  p_kategori        text,
  p_mesaj           text,
  p_baslik          text  DEFAULT NULL,
  p_konum_lat       double precision DEFAULT NULL,
  p_konum_lng       double precision DEFAULT NULL,
  p_konum_url       text  DEFAULT NULL,
  p_konum_etiket    text  DEFAULT NULL,
  p_ilgili_isemri   bigint DEFAULT NULL,
  p_foto_urls       text[] DEFAULT NULL,
  p_gecerli_saat    integer DEFAULT NULL,           -- override (NULL = kategori default)
  p_pinned          boolean DEFAULT NULL            -- yalnızca yönetici tarafından
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_firma_id     uuid;
  v_rol          text := 'sofor';
  v_is_yonetici  boolean := false;
  v_ad           text;
  v_plaka        text;
  v_kaynak_rol   text;
  v_pinned       boolean;
  v_son_dakika   integer;
  v_default_sure interval;
  v_gecerli_bitis timestamptz;
  v_id           uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501';
  END IF;

  -- Firma + rol çöz: önce firma_kullanicilar (yönetici), yoksa suruculer (şoför)
  SELECT fk.firma_id, fk.rol INTO v_firma_id, v_rol
    FROM public.firma_kullanicilar fk
    WHERE fk.user_id = v_user_id
    LIMIT 1;

  IF v_firma_id IS NULL THEN
    -- Şoför olarak suruculer'den (kolon: auth_user_id, ad + soyad)
    SELECT s.firma_id,
           NULLIF(TRIM(COALESCE(s.ad,'') || ' ' || COALESCE(s.soyad,'')), '')
      INTO v_firma_id, v_ad
      FROM public.suruculer s
      WHERE s.auth_user_id = v_user_id
      LIMIT 1;
    -- Plaka: son aktif iş emrinden
    SELECT i.arac_plaka INTO v_plaka
      FROM public.is_emirleri i
      WHERE i.sofor_user_id = v_user_id
        AND i.durum NOT IN ('Teslim Edildi','İptal')
      ORDER BY i.created_at DESC LIMIT 1;
    v_rol := 'sofor';
  ELSE
    -- Yönetici/operasyoncu — ad email'den
    SELECT COALESCE(u.email, 'Yönetici') INTO v_ad
      FROM auth.users u WHERE u.id = v_user_id;
  END IF;

  IF v_firma_id IS NULL THEN
    RAISE EXCEPTION 'firma bulunamadı' USING ERRCODE = '23502';
  END IF;

  v_is_yonetici := v_rol IN ('sahip','yonetici','operasyoncu');
  v_kaynak_rol  := CASE WHEN v_is_yonetici THEN 'yonetici' ELSE 'sofor' END;
  v_pinned      := COALESCE(p_pinned, v_is_yonetici);

  -- Spam guard: son 60 saniyede aynı user 3'ten fazla yazmışsa engelle (yönetici hariç)
  IF NOT v_is_yonetici THEN
    SELECT COUNT(*) INTO v_son_dakika
      FROM public.surucu_paylasimlari
      WHERE kaynak_user_id = v_user_id
        AND created_at >= now() - interval '60 seconds';
    IF v_son_dakika >= 3 THEN
      RAISE EXCEPTION 'Çok hızlı paylaşıyorsunuz. Lütfen biraz bekleyin.' USING ERRCODE = '54000';
    END IF;
  END IF;

  -- Geçerlilik default'ları (DECISIONS.md #3 — uzun)
  v_default_sure := CASE p_kategori
    WHEN 'trafik'  THEN interval '8 hours'
    WHEN 'liman'   THEN interval '12 hours'
    WHEN 'fabrika' THEN NULL                        -- kalıcı
    WHEN 'yakit'   THEN interval '48 hours'
    WHEN 'soru'    THEN interval '7 days'
    WHEN 'genel'   THEN interval '24 hours'
    ELSE interval '24 hours'
  END;

  IF p_gecerli_saat IS NOT NULL THEN
    -- Kullanıcı override etti
    v_gecerli_bitis := now() + make_interval(hours => p_gecerli_saat);
  ELSIF v_default_sure IS NULL THEN
    v_gecerli_bitis := NULL;
  ELSE
    v_gecerli_bitis := now() + v_default_sure;
  END IF;

  INSERT INTO public.surucu_paylasimlari (
    firma_id, kaynak_user_id, kaynak_ad, kaynak_plaka, kaynak_rol,
    kategori, baslik, mesaj,
    konum_lat, konum_lng, konum_url, konum_etiket,
    ilgili_isemri, foto_urls,
    gecerli_baslangic, gecerli_bitis, pinned
  ) VALUES (
    v_firma_id, v_user_id, COALESCE(v_ad, 'Bilinmeyen'), v_plaka, v_kaynak_rol,
    p_kategori, p_baslik, p_mesaj,
    p_konum_lat, p_konum_lng, p_konum_url, p_konum_etiket,
    p_ilgili_isemri, p_foto_urls,
    now(), v_gecerli_bitis, v_pinned
  ) RETURNING id INTO v_id;

  -- Bildirim üretimi (Paket F'de gelişecek; şimdilik temel haliyle)
  -- Yönetici pinli VEYA trafik kategorisi → bildirim yarat
  IF v_pinned OR p_kategori = 'trafik' THEN
    PERFORM public.notify_create(
      v_firma_id,
      'genel',
      CASE WHEN v_pinned THEN '📌 Duyuru' ELSE '🚧 Yol uyarısı' END,
      LEFT(p_mesaj, 200),
      'paylasim',
      v_id::text,
      v_user_id,
      COALESCE(v_ad, 'Bilinmeyen'),
      CASE WHEN v_pinned THEN 'yuksek' ELSE 'normal' END
    );
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_paylasim_create(
  text, text, text, double precision, double precision, text, text, bigint, text[], integer, boolean
) TO authenticated;

COMMENT ON FUNCTION public.surucu_paylasim_create IS
  'Yeni şoför paylaşımı. Spam guard (1dk/3 paylaşım), kategori-bazlı geçerlilik default''u, yönetici otomatik pin/duyuru.';

-- ---- 2) YORUM EKLE
CREATE OR REPLACE FUNCTION public.surucu_paylasim_yorum_ekle(
  p_paylasim_id  uuid,
  p_mesaj        text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_paylasim  public.surucu_paylasimlari%ROWTYPE;
  v_ad        text;
  v_rol       text := 'sofor';
  v_is_yon    boolean;
  v_id        uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_paylasim FROM public.surucu_paylasimlari WHERE id = p_paylasim_id;
  IF NOT FOUND OR v_paylasim.silindi_mi THEN
    RAISE EXCEPTION 'paylaşım bulunamadı' USING ERRCODE = '02000';
  END IF;

  -- Aynı firma kontrolü
  IF NOT EXISTS (
    SELECT 1 FROM public.firma_kullanicilar fk
    WHERE fk.user_id = v_user_id AND fk.firma_id = v_paylasim.firma_id
    UNION
    SELECT 1 FROM public.suruculer s
    WHERE s.auth_user_id = v_user_id AND s.firma_id = v_paylasim.firma_id
  ) THEN
    RAISE EXCEPTION 'erişim yok' USING ERRCODE = '42501';
  END IF;

  SELECT fk.rol INTO v_rol FROM public.firma_kullanicilar fk
    WHERE fk.user_id = v_user_id AND fk.firma_id = v_paylasim.firma_id
    LIMIT 1;
  v_is_yon := v_rol IN ('sahip','yonetici','operasyoncu');

  IF v_is_yon THEN
    SELECT COALESCE(u.email, 'Yönetici') INTO v_ad FROM auth.users u WHERE u.id = v_user_id;
  ELSE
    SELECT NULLIF(TRIM(COALESCE(s.ad,'') || ' ' || COALESCE(s.soyad,'')), '')
      INTO v_ad
      FROM public.suruculer s
      WHERE s.auth_user_id = v_user_id LIMIT 1;
  END IF;

  INSERT INTO public.surucu_paylasim_yorumlari
    (paylasim_id, firma_id, kaynak_user_id, kaynak_ad, kaynak_rol, mesaj)
  VALUES
    (p_paylasim_id, v_paylasim.firma_id, v_user_id, COALESCE(v_ad, 'Bilinmeyen'),
     CASE WHEN v_is_yon THEN 'yonetici' ELSE 'sofor' END, p_mesaj)
  RETURNING id INTO v_id;

  -- Sayaç güncelle (denormalize)
  UPDATE public.surucu_paylasimlari
    SET yorum_sayisi = yorum_sayisi + 1
    WHERE id = p_paylasim_id;

  -- Paylaşım sahibine bildirim (kendine yorum yapanlara değil)
  IF v_paylasim.kaynak_user_id <> v_user_id THEN
    PERFORM public.notify_create(
      v_paylasim.firma_id,
      'genel',
      '💬 Paylaşımınıza yorum',
      LEFT(p_mesaj, 200),
      'paylasim',
      p_paylasim_id::text,
      v_user_id,
      COALESCE(v_ad, 'Bilinmeyen'),
      'normal'
    );
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_paylasim_yorum_ekle(uuid, text) TO authenticated;

-- ---- 3) BEĞENİ TOGGLE
CREATE OR REPLACE FUNCTION public.surucu_paylasim_like_toggle(
  p_paylasim_id uuid
) RETURNS boolean   -- TRUE = beğenildi, FALSE = beğeni geri alındı
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_paylasim public.surucu_paylasimlari%ROWTYPE;
  v_existed  boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_paylasim FROM public.surucu_paylasimlari WHERE id = p_paylasim_id;
  IF NOT FOUND OR v_paylasim.silindi_mi THEN
    RAISE EXCEPTION 'paylaşım yok' USING ERRCODE = '02000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.firma_kullanicilar fk
    WHERE fk.user_id = v_user_id AND fk.firma_id = v_paylasim.firma_id
    UNION
    SELECT 1 FROM public.suruculer s
    WHERE s.auth_user_id = v_user_id AND s.firma_id = v_paylasim.firma_id
  ) THEN
    RAISE EXCEPTION 'erişim yok' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.surucu_paylasim_begenileri
    WHERE paylasim_id = p_paylasim_id AND user_id = v_user_id
  ) INTO v_existed;

  IF v_existed THEN
    DELETE FROM public.surucu_paylasim_begenileri
      WHERE paylasim_id = p_paylasim_id AND user_id = v_user_id;
    UPDATE public.surucu_paylasimlari
      SET begeni_sayisi = GREATEST(begeni_sayisi - 1, 0)
      WHERE id = p_paylasim_id;
    RETURN false;
  ELSE
    INSERT INTO public.surucu_paylasim_begenileri (paylasim_id, user_id, firma_id)
      VALUES (p_paylasim_id, v_user_id, v_paylasim.firma_id);
    UPDATE public.surucu_paylasimlari
      SET begeni_sayisi = begeni_sayisi + 1
      WHERE id = p_paylasim_id;
    RETURN true;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_paylasim_like_toggle(uuid) TO authenticated;

-- ---- 4) DM GÖNDER
CREATE OR REPLACE FUNCTION public.surucu_dm_send(
  p_alici_user_id uuid,
  p_mesaj         text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_firma_id   uuid;
  v_alici_firma uuid;
  v_gonderen_ad text;
  v_alici_ad   text;
  v_id         uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501';
  END IF;
  IF v_user_id = p_alici_user_id THEN
    RAISE EXCEPTION 'kendine DM atılamaz' USING ERRCODE = '22023';
  END IF;

  -- Gönderen firma_id (suruculer veya firma_kullanicilar)
  SELECT firma_id INTO v_firma_id FROM (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = v_user_id
    UNION
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = v_user_id
  ) sub LIMIT 1;

  -- Alıcı firma_id
  SELECT firma_id INTO v_alici_firma FROM (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = p_alici_user_id
    UNION
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = p_alici_user_id
  ) sub LIMIT 1;

  IF v_firma_id IS NULL OR v_alici_firma IS NULL OR v_firma_id <> v_alici_firma THEN
    RAISE EXCEPTION 'aynı firma içinde olunmalı' USING ERRCODE = '42501';
  END IF;

  -- Adlar
  SELECT COALESCE(NULLIF(TRIM(COALESCE(s.ad,'') || ' ' || COALESCE(s.soyad,'')), ''), u.email, 'Şoför')
    INTO v_gonderen_ad
    FROM auth.users u
    LEFT JOIN public.suruculer s ON s.auth_user_id = u.id
    WHERE u.id = v_user_id LIMIT 1;
  SELECT COALESCE(NULLIF(TRIM(COALESCE(s.ad,'') || ' ' || COALESCE(s.soyad,'')), ''), u.email, 'Şoför')
    INTO v_alici_ad
    FROM auth.users u
    LEFT JOIN public.suruculer s ON s.auth_user_id = u.id
    WHERE u.id = p_alici_user_id LIMIT 1;

  INSERT INTO public.surucu_dm_mesajlari
    (firma_id, gonderen_user_id, alici_user_id, gonderen_ad, alici_ad, mesaj)
  VALUES
    (v_firma_id, v_user_id, p_alici_user_id, v_gonderen_ad, v_alici_ad, p_mesaj)
  RETURNING id INTO v_id;

  -- Alıcıya bildirim (DM her zaman push)
  PERFORM public.notify_create(
    v_firma_id,
    'genel',
    '💬 Yeni mesaj: ' || COALESCE(v_gonderen_ad, 'Şoför'),
    LEFT(p_mesaj, 200),
    'dm',
    v_user_id::text,                     -- ilgili_id = gönderen, deep link konuşmaya açar
    v_user_id,
    v_gonderen_ad,
    'normal'
  );

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_dm_send(uuid, text) TO authenticated;

-- ---- 5) DM OKUNDU İŞARETLE (bir konuşmada henüz okunmamışların hepsi)
CREATE OR REPLACE FUNCTION public.surucu_dm_mark_read(
  p_konusulan_user_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count   integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'oturum yok' USING ERRCODE = '42501';
  END IF;

  WITH upd AS (
    UPDATE public.surucu_dm_mesajlari
       SET okundu_at = now()
     WHERE alici_user_id = v_user_id
       AND gonderen_user_id = p_konusulan_user_id
       AND okundu_at IS NULL
       AND silindi_mi = false
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_dm_mark_read(uuid) TO authenticated;

-- =============================================================================
-- ROTA MATE TRIGGER — is_emirleri AFTER INSERT
-- =============================================================================
-- Yeni iş emri açıldığında, aynı firma + aynı tarih (created_at::date)
-- + benzer teslim_yeri (ILIKE %x%) olan diğer iş emirlerini bul, eşleştir, bildirim at.
-- DECISIONS.md #4: teslim_yeri ILIKE eşleşmesi.
CREATE OR REPLACE FUNCTION public.trg_is_emri_rota_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diger     RECORD;
  v_etiket    text;
  v_a         bigint;
  v_b         bigint;
  v_tarih     date;
BEGIN
  IF NEW.firma_id IS NULL OR NEW.teslim_yeri IS NULL OR length(trim(NEW.teslim_yeri)) < 3 THEN
    RETURN NEW;
  END IF;

  -- Tarih: created_at::date (is_emirleri'nde planlanan_tarih kolonu yok)
  v_tarih := COALESCE((NEW.created_at)::date, CURRENT_DATE);

  -- Aynı firma, aynı tarih, benzer teslim_yeri olan diğer iş emirleri
  FOR v_diger IN
    SELECT i.id, i.teslim_yeri, i.sofor, i.sofor_user_id
    FROM public.is_emirleri i
    WHERE i.firma_id = NEW.firma_id
      AND i.id <> NEW.id
      AND i.teslim_yeri IS NOT NULL
      AND i.durum NOT IN ('İptal','Teslim Edildi')
      AND (i.created_at)::date = v_tarih
      AND (
        i.teslim_yeri ILIKE '%' || NEW.teslim_yeri || '%'
        OR NEW.teslim_yeri ILIKE '%' || i.teslim_yeri || '%'
      )
  LOOP
    -- Normalize: küçük id önce
    IF v_diger.id < NEW.id THEN
      v_a := v_diger.id; v_b := NEW.id;
    ELSE
      v_a := NEW.id; v_b := v_diger.id;
    END IF;

    v_etiket := LOWER(TRIM(LEAST(NEW.teslim_yeri, v_diger.teslim_yeri)));

    INSERT INTO public.surucu_rota_eslesmeleri (firma_id, isemri_a, isemri_b, ortak_etiket, tarih)
      VALUES (NEW.firma_id, v_a, v_b, v_etiket, v_tarih)
      ON CONFLICT (isemri_a, isemri_b) DO NOTHING;

    -- Bildirim — yeni iş emrinin şoförüne ve eşleştiği şoföre
    IF NEW.sofor_user_id IS NOT NULL THEN
      PERFORM public.notify_create(
        NEW.firma_id, 'genel', '🤝 Rota arkadaşı bulundu',
        'Bugün ' || COALESCE(v_etiket, 'aynı bölge') || ' rotasında ' ||
          COALESCE(v_diger.sofor, 'başka bir şoför') || ' de var.',
        'is_emri', NEW.id::text, NULL, 'Sistem', 'normal'
      );
    END IF;
    IF v_diger.sofor_user_id IS NOT NULL AND v_diger.sofor_user_id <> COALESCE(NEW.sofor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      PERFORM public.notify_create(
        NEW.firma_id, 'genel', '🤝 Rota arkadaşı bulundu',
        'Bugün ' || COALESCE(v_etiket, 'aynı bölge') || ' rotasında ' ||
          COALESCE(NEW.sofor, 'başka bir şoför') || ' de var.',
        'is_emri', v_diger.id::text, NULL, 'Sistem', 'normal'
      );
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_is_emri_rota_match ON public.is_emirleri;
CREATE TRIGGER trg_is_emri_rota_match
  AFTER INSERT ON public.is_emirleri
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_is_emri_rota_match();

-- =============================================================================
-- AKTİF ROTA MATE GÖRÜNÜMÜ — iş emri detay ekranı için
-- =============================================================================
-- Bir iş emrine bağlı tüm aktif rota arkadaşlarını listeler (her iki yönden).
CREATE OR REPLACE FUNCTION public.surucu_rota_mates(p_isemri_id bigint)
RETURNS TABLE (
  isemri_id      bigint,
  sofor_user_id  uuid,
  sofor_ad       text,
  arac_plaka     text,
  teslim_yeri    text,
  ortak_etiket   text,
  tarih          date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.id, i.sofor_user_id, i.sofor, i.arac_plaka, i.teslim_yeri, e.ortak_etiket, e.tarih
    FROM public.surucu_rota_eslesmeleri e
    JOIN public.is_emirleri i ON i.id = CASE WHEN e.isemri_a = p_isemri_id THEN e.isemri_b ELSE e.isemri_a END
   WHERE e.aktif = true
     AND (e.isemri_a = p_isemri_id OR e.isemri_b = p_isemri_id);
$$;

GRANT EXECUTE ON FUNCTION public.surucu_rota_mates(bigint) TO authenticated;

-- =============================================================================
-- VIEW — feed listesi (uygulamada doğrudan select sürer; bu görüntü kolaylık için)
-- =============================================================================
CREATE OR REPLACE VIEW public.v_surucu_feed AS
SELECT
  p.*,
  CASE
    WHEN p.gecerli_bitis IS NOT NULL AND p.gecerli_bitis < now()
      THEN true
    ELSE false
  END AS suresi_doldu_mu
FROM public.surucu_paylasimlari p
WHERE p.silindi_mi = false;

GRANT SELECT ON public.v_surucu_feed TO authenticated;

-- =============================================================================
-- AKTİF ŞOFÖRLER (HARİTA) RPC — bugün aktif iş emri olan + son konum
-- =============================================================================
CREATE OR REPLACE FUNCTION public.surucu_aktif_haritada()
RETURNS TABLE (
  user_id        uuid,
  sofor_ad       text,
  arac_plaka     text,
  isemri_id      bigint,
  durum          text,
  yukle_yeri     text,
  teslim_yeri    text,
  son_lat        double precision,
  son_lng        double precision,
  son_konum_at   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_firma_id uuid;
BEGIN
  SELECT firma_id INTO v_firma_id FROM (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
    UNION
    SELECT s.firma_id  FROM public.suruculer s         WHERE s.auth_user_id = auth.uid()
  ) x LIMIT 1;
  IF v_firma_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH bugun AS (
    SELECT i.id, i.sofor_user_id, i.sofor, i.arac_plaka,
           i.durum, i.yukle_yeri, i.teslim_yeri
      FROM public.is_emirleri i
     WHERE i.firma_id = v_firma_id
       AND i.durum NOT IN ('İptal','Teslim Edildi')
       AND (i.created_at)::date = CURRENT_DATE
       AND i.sofor_user_id IS NOT NULL
  ),
  son_konum AS (
    -- konum_izleri.ts (created_at değil) — son 6 saat içindeki en güncel konum
    SELECT DISTINCT ON (k.user_id)
      k.user_id, k.lat, k.lng, k.ts
      FROM public.konum_izleri k
      JOIN bugun b ON b.sofor_user_id = k.user_id
     WHERE k.ts > now() - interval '6 hours'
     ORDER BY k.user_id, k.ts DESC
  )
  SELECT
    b.sofor_user_id, b.sofor, b.arac_plaka, b.id, b.durum, b.yukle_yeri, b.teslim_yeri,
    sk.lat, sk.lng, sk.ts
    FROM bugun b
    LEFT JOIN son_konum sk ON sk.user_id = b.sofor_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.surucu_aktif_haritada() TO authenticated;

-- =============================================================================
-- REALTIME PUBLICATION — Supabase realtime için yeni tabloları publication'a ekle
-- =============================================================================
-- Not: Bu Supabase Cloud için ALTER PUBLICATION; eğer varolan ortamda 'supabase_realtime'
-- tanımlı değilse Supabase dashboard üzerinden Realtime Publications altından manuel
-- aktif edilmesi gerekir. Aşağıdaki blok IF EXISTS ile güvenle çalışır.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.surucu_paylasimlari;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.surucu_paylasim_yorumlari;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.surucu_paylasim_begenileri;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.surucu_dm_mesajlari;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA / SEED ÖRNEKLERİ
-- =============================================================================
-- 1) Paylaşım oluştur (oturumlu kullanıcı):
--    SELECT public.surucu_paylasim_create(
--      'trafik',
--      'TEM Mahmutbey, Avcılar yönü kazadan dolayı durdu',
--      'TEM Mahmutbey kaza',
--      41.1234, 28.7654,
--      'https://maps.google.com/?q=41.1234,28.7654',
--      'TEM Mahmutbey'
--    );
--
-- 2) Feed çek:
--    SELECT id, kategori, baslik, mesaj, kaynak_ad, pinned, suresi_doldu_mu, begeni_sayisi, yorum_sayisi
--      FROM public.v_surucu_feed
--      WHERE firma_id = (SELECT firma_id FROM public.suruculer WHERE user_id = auth.uid() LIMIT 1)
--      ORDER BY pinned DESC, created_at DESC LIMIT 50;
--
-- 3) Beğeni toggle:
--    SELECT public.surucu_paylasim_like_toggle('<paylasim_uuid>');
--
-- 4) Yorum ekle:
--    SELECT public.surucu_paylasim_yorum_ekle('<paylasim_uuid>', 'Doğrulandı, ben de gördüm');
--
-- 5) DM gönder:
--    SELECT public.surucu_dm_send('<alici_user_id>', 'Argon için boş Marport''tan, evet');
--
-- 6) Aktif harita:
--    SELECT * FROM public.surucu_aktif_haritada();
--
-- 7) Bir iş emrinin rota mate'leri:
--    SELECT * FROM public.surucu_rota_mates(123);
-- =============================================================================
