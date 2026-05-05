-- =============================================================================
-- FLEETLY  —  2026-05-05d  —  Harcırah Sistemi (Paket A)
-- =============================================================================
-- Şoför harcırah/günlük yönetimi:
--   1) harcirah_tarifeleri  — firma rate card (rota + tip + durum → tutar)
--   2) harcirah_kayitlari   — gerçekleşen harcırahlar (iş emri başına)
--   3) harcirah_haftalik    — haftalık kapatma / arşiv
--
-- İş akışı (referans):
--   • İş emri oluşturulur → tarifeden eşleşen kayıt bulunur → harcırah kaydı
--     otomatik üretilir (Paket B'de trigger olarak gelecek)
--   • Şoför hafta içinde tamamladığı işleri görür ve onaylar
--   • Yönetici hafta sonu onaylar, ödeme yapılır → masraf_kayitlari'na transfer
--   • Hafta kapatılır, PDF üretilir, yeni hafta başlar
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) HARCIRAH TARİFELERİ (firma rate card)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.harcirah_tarifeleri (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  baslik          text NOT NULL,                 -- "Kumport → Çatalca 40 DC Dolu"
  alim_yeri       text,                          -- "Kumport"
  teslim_yeri     text,                          -- "Çatalca" / "Mega Metal"
  bos_donus_yeri  text,                          -- "Marport" (opsiyonel)
  kont_tip        text,                          -- "20 DC", "40 DC", "40 HC", "Reefer", null=tüm tipler
  kont_durum      text CHECK (kont_durum IS NULL OR kont_durum IN ('Dolu','Boş')),
  dorse_tipi      text,                          -- "frigorifik", "tenteli" vb. (dorse_tipleri.kod)
  tutar           numeric(10,2) NOT NULL CHECK (tutar >= 0),
  para_birimi     text NOT NULL DEFAULT 'TRY',
  -- Rota tahmini (opsiyonel — ek metrik)
  tahmini_km      numeric,
  tahmini_sure_dk integer,
  -- Geçerlilik
  gecerli_baslangic date NOT NULL DEFAULT CURRENT_DATE,
  gecerli_bitis     date,                        -- NULL = açık uçlu
  aktif_mi          boolean NOT NULL DEFAULT true,
  oncelik           smallint NOT NULL DEFAULT 100, -- match önceliği (düşük sayı önce)
  notlar            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_tarife_firma_aktif
  ON public.harcirah_tarifeleri(firma_id, aktif_mi)
  WHERE aktif_mi = true;
CREATE INDEX IF NOT EXISTS idx_tarife_match
  ON public.harcirah_tarifeleri(firma_id, alim_yeri, teslim_yeri, kont_tip)
  WHERE aktif_mi = true;

COMMENT ON TABLE public.harcirah_tarifeleri IS
  'Firma harcırah rate card. İş emri açılınca alim_yeri+teslim_yeri+kont_tip+kont_durum kombinasyonuna göre match yapılır.';

-- -----------------------------------------------------------------------------
-- 2) HARCIRAH KAYITLARI (iş emri başına gerçekleşen)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.harcirah_kayitlari (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id          uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  is_emri_id        bigint REFERENCES public.is_emirleri(id) ON DELETE SET NULL,
  sofor_user_id     uuid REFERENCES auth.users(id),
  sofor_ad          text,                        -- snapshot
  arac_id           text REFERENCES public.araclar(id) ON DELETE SET NULL,
  arac_plaka        text,                        -- snapshot
  -- Eşleşen tarife (varsa)
  tarife_id         uuid REFERENCES public.harcirah_tarifeleri(id) ON DELETE SET NULL,
  -- Hesaplanan vs. ödenecek tutar
  hesaplanan_tutar  numeric(10,2),               -- tarife match'inden gelen
  manuel_tutar      numeric(10,2),               -- yönetici manuel girdi (override)
  ek_masraflar      numeric(10,2) NOT NULL DEFAULT 0,  -- HGS, köprü, mola vb.
  ek_masraf_aciklama text,
  avans_dusum       numeric(10,2) NOT NULL DEFAULT 0,  -- önceden alınmış avans
  -- Final tutar (manuel || hesaplanan) + ek_masraflar - avans_dusum
  net_tutar         numeric(10,2) GENERATED ALWAYS AS (
                      COALESCE(manuel_tutar, hesaplanan_tutar, 0) + ek_masraflar - avans_dusum
                    ) STORED,
  -- Onay akışı
  durum             text NOT NULL DEFAULT 'beklemede' CHECK (durum IN (
                      'beklemede',     -- otomatik oluştu, henüz hiç dokunulmadı
                      'sofor_onay',    -- şoför kontrol etti, onaylandı
                      'sofor_itiraz',  -- şoför itiraz etti
                      'ops_onay',      -- operasyon onayladı
                      'odendi',        -- ödeme yapıldı
                      'iptal'
                    )),
  itiraz_tutar      numeric(10,2),               -- şoför itiraz ettiğinde önerdiği tutar
  itiraz_aciklama   text,
  -- Hafta bilgisi (kayıt oluşurken hesaplanır)
  hafta_no          integer,                     -- ISO 8601 hafta no
  hafta_yili        integer,
  is_tarihi         date NOT NULL DEFAULT CURRENT_DATE,
  -- Aksiyon zamanları
  sofor_onay_at     timestamptz,
  ops_onay_at       timestamptz,
  ops_onay_user_id  uuid REFERENCES auth.users(id),
  odeme_at          timestamptz,
  odeme_user_id     uuid REFERENCES auth.users(id),
  odeme_yontemi     text CHECK (odeme_yontemi IS NULL OR odeme_yontemi IN ('Nakit','EFT','Çek','Mahsup','Diğer')),
  odeme_referans    text,
  -- Masraf kaydına bağlama (hafta kapatıldığında doldurulur)
  masraf_kaydi_id   text,
  -- Ek
  aciklama          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harc_firma_durum
  ON public.harcirah_kayitlari(firma_id, durum, is_tarihi DESC);
CREATE INDEX IF NOT EXISTS idx_harc_sofor_hafta
  ON public.harcirah_kayitlari(sofor_user_id, hafta_yili, hafta_no);
CREATE INDEX IF NOT EXISTS idx_harc_isemri
  ON public.harcirah_kayitlari(is_emri_id)
  WHERE is_emri_id IS NOT NULL;

-- Hafta no/yılı otomatik doldur
CREATE OR REPLACE FUNCTION public.trg_harcirah_hafta_doldur()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_tarihi IS NOT NULL THEN
    NEW.hafta_no   := EXTRACT(WEEK FROM NEW.is_tarihi)::int;
    NEW.hafta_yili := EXTRACT(ISOYEAR FROM NEW.is_tarihi)::int;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_harcirah_hafta_doldur ON public.harcirah_kayitlari;
CREATE TRIGGER trg_harcirah_hafta_doldur
  BEFORE INSERT OR UPDATE OF is_tarihi ON public.harcirah_kayitlari
  FOR EACH ROW EXECUTE FUNCTION public.trg_harcirah_hafta_doldur();

COMMENT ON TABLE public.harcirah_kayitlari IS
  'Gerçekleşen harcırah kayıtları (iş emri başına bir kayıt). net_tutar otomatik hesaplanır.';

-- -----------------------------------------------------------------------------
-- 3) HAFTALIK KAPANIŞ (arşiv)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.harcirah_haftalik (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id        uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  sofor_user_id   uuid REFERENCES auth.users(id),
  sofor_ad        text,                          -- snapshot
  hafta_no        integer NOT NULL,
  hafta_yili      integer NOT NULL,
  baslangic_tarih date NOT NULL,
  bitis_tarih     date NOT NULL,
  kayit_sayisi    integer NOT NULL DEFAULT 0,
  toplam_brut     numeric(12,2) NOT NULL DEFAULT 0,    -- ek masraflar dahil
  toplam_avans    numeric(12,2) NOT NULL DEFAULT 0,
  toplam_net      numeric(12,2) NOT NULL DEFAULT 0,
  durum           text NOT NULL DEFAULT 'kapali' CHECK (durum IN ('kapali','odendi','iptal')),
  pdf_url         text,
  notlar          text,
  kapatildi_at    timestamptz NOT NULL DEFAULT now(),
  kapatan_user_id uuid REFERENCES auth.users(id),
  odeme_at        timestamptz,
  odeme_yontemi   text,
  odeme_referans  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firma_id, sofor_user_id, hafta_yili, hafta_no)
);

CREATE INDEX IF NOT EXISTS idx_harc_haftalik_firma
  ON public.harcirah_haftalik(firma_id, hafta_yili DESC, hafta_no DESC);

COMMENT ON TABLE public.harcirah_haftalik IS
  'Haftalık şoför bazında kapanış kayıtları. Hafta kapatıldığında harcirah_kayitlari satırları güncellenir + bu tabloya özet yazılır.';

-- -----------------------------------------------------------------------------
-- 4) RLS — firma_id bazlı erişim
-- -----------------------------------------------------------------------------
ALTER TABLE public.harcirah_tarifeleri  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harcirah_kayitlari   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harcirah_haftalik    ENABLE ROW LEVEL SECURITY;

-- Helper macro: firma erişimi
-- TARİFE policy'leri
DROP POLICY IF EXISTS harc_tarife_select ON public.harcirah_tarifeleri;
CREATE POLICY harc_tarife_select ON public.harcirah_tarifeleri
  FOR SELECT TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS harc_tarife_insert ON public.harcirah_tarifeleri;
CREATE POLICY harc_tarife_insert ON public.harcirah_tarifeleri
  FOR INSERT TO authenticated
  WITH CHECK (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS harc_tarife_update ON public.harcirah_tarifeleri;
CREATE POLICY harc_tarife_update ON public.harcirah_tarifeleri
  FOR UPDATE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS harc_tarife_delete ON public.harcirah_tarifeleri;
CREATE POLICY harc_tarife_delete ON public.harcirah_tarifeleri
  FOR DELETE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
  ));

-- KAYIT policy'leri (Şoför kendi kayıtlarını görebilmeli)
DROP POLICY IF EXISTS harc_kayit_select ON public.harcirah_kayitlari;
CREATE POLICY harc_kayit_select ON public.harcirah_kayitlari
  FOR SELECT TO authenticated
  USING (
    -- Firma personeli tüm kayıtları görür
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid()
    )
    -- VEYA şoför kendi kayıtlarını görür (firma_kullanicilar üyesi olmasa bile)
    OR sofor_user_id = auth.uid()
  );

DROP POLICY IF EXISTS harc_kayit_insert ON public.harcirah_kayitlari;
CREATE POLICY harc_kayit_insert ON public.harcirah_kayitlari
  FOR INSERT TO authenticated
  WITH CHECK (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS harc_kayit_update ON public.harcirah_kayitlari;
CREATE POLICY harc_kayit_update ON public.harcirah_kayitlari
  FOR UPDATE TO authenticated
  USING (
    firma_id IN (
      SELECT fk.firma_id FROM public.firma_kullanicilar fk
      WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
    )
    -- Şoför kendi kaydını sadece itiraz/onay amaçlı update edebilir (uygulama tarafında doğrula)
    OR sofor_user_id = auth.uid()
  );

DROP POLICY IF EXISTS harc_kayit_delete ON public.harcirah_kayitlari;
CREATE POLICY harc_kayit_delete ON public.harcirah_kayitlari
  FOR DELETE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
  ));

-- HAFTALIK policy'leri
DROP POLICY IF EXISTS harc_haftalik_select ON public.harcirah_haftalik;
CREATE POLICY harc_haftalik_select ON public.harcirah_haftalik
  FOR SELECT TO authenticated
  USING (
    firma_id IN (SELECT fk.firma_id FROM public.firma_kullanicilar fk WHERE fk.user_id = auth.uid())
    OR sofor_user_id = auth.uid()
  );

DROP POLICY IF EXISTS harc_haftalik_insert ON public.harcirah_haftalik;
CREATE POLICY harc_haftalik_insert ON public.harcirah_haftalik
  FOR INSERT TO authenticated
  WITH CHECK (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS harc_haftalik_update ON public.harcirah_haftalik;
CREATE POLICY harc_haftalik_update ON public.harcirah_haftalik
  FOR UPDATE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

-- -----------------------------------------------------------------------------
-- 5) Yardımcı RPC: tarife match (Paket B trigger'ı bunu çağıracak)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harcirah_tarife_bul(
  p_firma_id    uuid,
  p_alim_yeri   text,
  p_teslim_yeri text,
  p_kont_tip    text  DEFAULT NULL,
  p_kont_durum  text  DEFAULT NULL,
  p_dorse_tipi  text  DEFAULT NULL,
  p_tarih       date  DEFAULT CURRENT_DATE
) RETURNS TABLE (id uuid, tutar numeric, baslik text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.tutar, t.baslik
  FROM public.harcirah_tarifeleri t
  WHERE t.firma_id = p_firma_id
    AND t.aktif_mi = true
    AND (t.gecerli_baslangic IS NULL OR t.gecerli_baslangic <= p_tarih)
    AND (t.gecerli_bitis     IS NULL OR t.gecerli_bitis     >= p_tarih)
    -- Alım yeri eşleşmesi (case-insensitive partial)
    AND (t.alim_yeri IS NULL OR p_alim_yeri IS NULL
         OR lower(p_alim_yeri) LIKE '%' || lower(t.alim_yeri) || '%'
         OR lower(t.alim_yeri) LIKE '%' || lower(p_alim_yeri) || '%')
    -- Teslim yeri
    AND (t.teslim_yeri IS NULL OR p_teslim_yeri IS NULL
         OR lower(p_teslim_yeri) LIKE '%' || lower(t.teslim_yeri) || '%'
         OR lower(t.teslim_yeri) LIKE '%' || lower(p_teslim_yeri) || '%')
    -- Konteyner tipi (NULL = tüm tipler)
    AND (t.kont_tip IS NULL OR t.kont_tip = p_kont_tip)
    -- Dolu/Boş
    AND (t.kont_durum IS NULL OR p_kont_durum IS NULL OR t.kont_durum = p_kont_durum)
    -- Dorse tipi (frigorifik vs.)
    AND (t.dorse_tipi IS NULL OR p_dorse_tipi IS NULL OR t.dorse_tipi = p_dorse_tipi)
  ORDER BY
    -- Daha spesifik tarifeler önce gelsin: alim+teslim+kont_tip+kont_durum dolu olanlar
    (CASE WHEN t.alim_yeri    IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN t.teslim_yeri  IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN t.kont_tip     IS NOT NULL THEN 0 ELSE 1 END),
    (CASE WHEN t.kont_durum   IS NOT NULL THEN 0 ELSE 1 END),
    t.oncelik ASC,
    t.created_at DESC
  LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.harcirah_tarife_bul TO authenticated;

COMMENT ON FUNCTION public.harcirah_tarife_bul IS
  'Tarife match: rota+tip+durum kombinasyonuna göre en spesifik aktif tarifeyi döner. Paket B''de iş emri trigger''ı tarafından çağrılacak.';

-- -----------------------------------------------------------------------------
-- 6) View: aktif hafta özet (yönetici dashboard'u için)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_harcirah_haftalik_ozet AS
SELECT
  h.firma_id,
  h.sofor_user_id,
  h.sofor_ad,
  h.hafta_yili,
  h.hafta_no,
  COUNT(*)                            AS kayit_sayisi,
  SUM(COALESCE(h.manuel_tutar, h.hesaplanan_tutar, 0)) AS toplam_brut,
  SUM(h.ek_masraflar)                 AS toplam_ek,
  SUM(h.avans_dusum)                  AS toplam_avans,
  SUM(h.net_tutar)                    AS toplam_net,
  COUNT(*) FILTER (WHERE h.durum = 'beklemede')   AS beklemede,
  COUNT(*) FILTER (WHERE h.durum = 'sofor_onay')  AS sofor_onayli,
  COUNT(*) FILTER (WHERE h.durum = 'ops_onay')    AS ops_onayli,
  COUNT(*) FILTER (WHERE h.durum = 'odendi')      AS odendi,
  MIN(h.is_tarihi)                    AS hafta_baslangic,
  MAX(h.is_tarihi)                    AS hafta_bitis
FROM public.harcirah_kayitlari h
GROUP BY h.firma_id, h.sofor_user_id, h.sofor_ad, h.hafta_yili, h.hafta_no;

GRANT SELECT ON public.v_harcirah_haftalik_ozet TO authenticated;

COMMIT;

-- =============================================================================
-- TEST / SEED ÖRNEKLERİ
-- =============================================================================
-- 1. Tarife ekle:
--    INSERT INTO public.harcirah_tarifeleri (firma_id, baslik, alim_yeri, teslim_yeri, kont_tip, kont_durum, tutar)
--    VALUES (
--      (SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid() LIMIT 1),
--      'Kumport → Çatalca 40 DC Dolu',
--      'Kumport', 'Çatalca', '40 DC', 'Dolu', 2500.00
--    );
--
-- 2. Match testi:
--    SELECT * FROM public.harcirah_tarife_bul(
--      (SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid() LIMIT 1),
--      'Kumport Limanı', 'Mega Metal Çatalca', '40 DC', 'Dolu'
--    );
--
-- 3. Manuel kayıt (Paket B trigger gelmeden):
--    INSERT INTO public.harcirah_kayitlari (firma_id, is_emri_id, sofor_ad, arac_plaka, hesaplanan_tutar, is_tarihi)
--    VALUES (<firma_id>, <is_emri_id>, 'Mehmet Yılmaz', '34EE5314', 2500.00, CURRENT_DATE);
--
-- 4. Haftalık özet:
--    SELECT * FROM public.v_harcirah_haftalik_ozet WHERE hafta_yili = 2026 AND hafta_no = 19;
-- =============================================================================
