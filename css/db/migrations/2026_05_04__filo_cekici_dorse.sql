-- =============================================================================
-- FLEETLY  —  2026-05-04  —  Filo: Çekici & Dorse Ayrımı
-- =============================================================================
-- Karar dokümanı: docs/filo-cekici-dorse.md
--
-- Özet:
--   1. araclar tablosuna `kind` ve dorse-spesifik kolonlar eklenir.
--   2. dorse_tipleri lookup tablosu + seed.
--   3. arac_dorse_atamalari zamansal eşleşme tablosu + uniq partial index
--      (bir dorse aynı anda tek aktif çekiciye bağlı olabilir).
--   4. is_emirleri tablosuna cekici_id ve dorse_id FK eklenir
--      (arac_plaka cache olarak kalır).
--   5. RLS: yeni tablolarda firma_id bazlı policy (mevcut pattern).
--
-- Geri alma: bu migration idempotent değildir. DROP için ayrı down dosyası
--           yazılmalıdır (MIGRATION-LOG.md kuralına göre).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) DORSE TİPLERİ (lookup)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dorse_tipleri (
  kod                       text PRIMARY KEY,
  ad                        text NOT NULL,
  aciklama                  text,
  varsayilan_kapasite_m3    numeric,
  varsayilan_kapasite_ton   numeric,
  has_temperatur            boolean NOT NULL DEFAULT false,
  sira                      smallint NOT NULL DEFAULT 100,
  created_at                timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dorse_tipleri (kod, ad, varsayilan_kapasite_m3, varsayilan_kapasite_ton, has_temperatur, sira) VALUES
  ('teleskopik', 'Teleskopik',                NULL, NULL, false, 10),
  ('sabit_40',   'Sabit 40lık (40 DC)',         67,   28, false, 20),
  ('sabit_20',   'Sabit 20lik (20 DC)',         33,   28, false, 30),
  ('tenteli',    'Tenteli (Pillow / Curtain)',  90,   24, false, 40),
  ('frigorifik', 'Frigorifik / Reefer',         80,   22, true,  50),
  ('lowbed',     'Lowbed',                     NULL,   40, false, 60),
  ('silobas',    'Silobas',                     60,   28, false, 70),
  ('kuruyuk',    'Kuru Yük (Sabit Kasa)',       80,   28, false, 80)
ON CONFLICT (kod) DO NOTHING;

-- Lookup tablosu herkese okunabilir (tipleri seçim listesinden alacağız).
ALTER TABLE public.dorse_tipleri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dorse_tipleri_select ON public.dorse_tipleri;
CREATE POLICY dorse_tipleri_select ON public.dorse_tipleri
  FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- 2) araclar tablosuna kind + dorse-spesifik kolonlar
-- -----------------------------------------------------------------------------
ALTER TABLE public.araclar
  ADD COLUMN IF NOT EXISTS kind          text NOT NULL DEFAULT 'cekici',
  ADD COLUMN IF NOT EXISTS dorse_tipi    text,
  ADD COLUMN IF NOT EXISTS kapasite_m3   numeric,
  ADD COLUMN IF NOT EXISTS kapasite_ton  numeric,
  ADD COLUMN IF NOT EXISTS aks_sayisi    smallint,
  ADD COLUMN IF NOT EXISTS frigorifik    boolean NOT NULL DEFAULT false;

-- kind kontrolü
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'araclar_kind_chk'
  ) THEN
    ALTER TABLE public.araclar
      ADD CONSTRAINT araclar_kind_chk
      CHECK (kind IN ('cekici','dorse','tek_parca'));
  END IF;
END $$;

-- dorse_tipi FK (yalnızca dorse satırlarında dolu olmalı; uygulama tarafında doğrula)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'araclar_dorse_tipi_fkey'
  ) THEN
    ALTER TABLE public.araclar
      ADD CONSTRAINT araclar_dorse_tipi_fkey
      FOREIGN KEY (dorse_tipi) REFERENCES public.dorse_tipleri(kod)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- Hızlı liste sorguları için
CREATE INDEX IF NOT EXISTS idx_araclar_kind          ON public.araclar(kind);
CREATE INDEX IF NOT EXISTS idx_araclar_firma_kind    ON public.araclar(firma_id, kind);

COMMENT ON COLUMN public.araclar.kind IS
  'Araç türü: cekici (motorlu çekici), dorse (yarı-römork), tek_parca (kamyon/tır tek parça).';
COMMENT ON COLUMN public.araclar.dorse_tipi IS
  'Dorse tipi kodu (yalnızca kind=dorse olduğunda anlamlı). dorse_tipleri.kod''a referans.';

-- -----------------------------------------------------------------------------
-- 3) arac_dorse_atamalari (zamansal eşleşme)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arac_dorse_atamalari (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cekici_id   text NOT NULL REFERENCES public.araclar(id) ON DELETE CASCADE,
  dorse_id    text NOT NULL REFERENCES public.araclar(id) ON DELETE CASCADE,
  firma_id    uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  baslangic   timestamptz NOT NULL DEFAULT now(),
  bitis       timestamptz,
  birincil_mi boolean NOT NULL DEFAULT false,
  notlar      text,
  atayan      uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cekici_dorse_diff CHECK (cekici_id <> dorse_id)
);

-- Bir dorse aynı anda yalnızca tek aktif çekiciye bağlı olabilir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ada_dorse_aktif
  ON public.arac_dorse_atamalari(dorse_id)
  WHERE bitis IS NULL;

-- Bir çekicinin aktif birincil dorsesi yalnız bir tane olabilir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ada_cekici_birincil_aktif
  ON public.arac_dorse_atamalari(cekici_id)
  WHERE bitis IS NULL AND birincil_mi = true;

CREATE INDEX IF NOT EXISTS idx_ada_cekici_aktif
  ON public.arac_dorse_atamalari(cekici_id)
  WHERE bitis IS NULL;

CREATE INDEX IF NOT EXISTS idx_ada_firma
  ON public.arac_dorse_atamalari(firma_id);

ALTER TABLE public.arac_dorse_atamalari ENABLE ROW LEVEL SECURITY;

-- Policy: kullanıcı yalnızca kendi firmasının kayıtlarını görür/yazar.
-- (firma_kullanicilar üzerinden mevcut pattern'in birebir kopyası.)
DROP POLICY IF EXISTS ada_select ON public.arac_dorse_atamalari;
CREATE POLICY ada_select ON public.arac_dorse_atamalari
  FOR SELECT TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS ada_insert ON public.arac_dorse_atamalari;
CREATE POLICY ada_insert ON public.arac_dorse_atamalari
  FOR INSERT TO authenticated
  WITH CHECK (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS ada_update ON public.arac_dorse_atamalari;
CREATE POLICY ada_update ON public.arac_dorse_atamalari
  FOR UPDATE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici','operasyoncu')
  ));

DROP POLICY IF EXISTS ada_delete ON public.arac_dorse_atamalari;
CREATE POLICY ada_delete ON public.arac_dorse_atamalari
  FOR DELETE TO authenticated
  USING (firma_id IN (
    SELECT fk.firma_id FROM public.firma_kullanicilar fk
    WHERE fk.user_id = auth.uid() AND fk.rol IN ('sahip','yonetici')
  ));

COMMENT ON TABLE public.arac_dorse_atamalari IS
  'Çekici - dorse zamansal eşleşmesi. Aktif kayıt = bitis IS NULL. Bir dorse aynı anda tek aktif çekiciye bağlı olabilir (uq_ada_dorse_aktif).';

-- -----------------------------------------------------------------------------
-- 4) is_emirleri tablosuna cekici_id + dorse_id (FK)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='is_emirleri') THEN
    -- Kolonlar
    BEGIN
      ALTER TABLE public.is_emirleri ADD COLUMN cekici_id text;
    EXCEPTION WHEN duplicate_column THEN END;

    BEGIN
      ALTER TABLE public.is_emirleri ADD COLUMN dorse_id text;
    EXCEPTION WHEN duplicate_column THEN END;

    -- FK'ler
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='is_emirleri_cekici_fkey') THEN
      ALTER TABLE public.is_emirleri
        ADD CONSTRAINT is_emirleri_cekici_fkey
        FOREIGN KEY (cekici_id) REFERENCES public.araclar(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='is_emirleri_dorse_fkey') THEN
      ALTER TABLE public.is_emirleri
        ADD CONSTRAINT is_emirleri_dorse_fkey
        FOREIGN KEY (dorse_id) REFERENCES public.araclar(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_isemirleri_cekici ON public.is_emirleri(cekici_id);
    CREATE INDEX IF NOT EXISTS idx_isemirleri_dorse  ON public.is_emirleri(dorse_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5) Hizmet view'ları
-- -----------------------------------------------------------------------------
-- Aktif çekici-dorse eşleşmeleri (UI dropdown'ları için)
CREATE OR REPLACE VIEW public.v_aktif_eslesmeler AS
SELECT
  ada.id              AS atama_id,
  ada.cekici_id,
  c.plaka             AS cekici_plaka,
  c.marka             AS cekici_marka,
  c.model             AS cekici_model,
  ada.dorse_id,
  d.plaka             AS dorse_plaka,
  d.marka             AS dorse_marka,
  d.dorse_tipi,
  dt.ad               AS dorse_tipi_ad,
  d.kapasite_m3,
  d.kapasite_ton,
  d.frigorifik,
  ada.birincil_mi,
  ada.baslangic,
  ada.firma_id
FROM public.arac_dorse_atamalari ada
JOIN public.araclar c   ON c.id = ada.cekici_id AND c.kind = 'cekici'
JOIN public.araclar d   ON d.id = ada.dorse_id  AND d.kind = 'dorse'
LEFT JOIN public.dorse_tipleri dt ON dt.kod = d.dorse_tipi
WHERE ada.bitis IS NULL;

GRANT SELECT ON public.v_aktif_eslesmeler TO authenticated;

COMMIT;

-- =============================================================================
-- DOĞRULAMA SORGULARI (manuel çalıştırılır)
-- =============================================================================
-- Yeni kolonların geldiği:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='araclar' AND column_name IN ('kind','dorse_tipi','kapasite_m3','frigorifik');
--
-- Lookup seed'i:
--   SELECT kod, ad FROM public.dorse_tipleri ORDER BY sira;
--
-- Eşleşme insert testi (manuel):
--   INSERT INTO public.arac_dorse_atamalari (cekici_id, dorse_id, firma_id, birincil_mi)
--   VALUES ('CEKICI-001','DORSE-001','<firma_uuid>', true);
-- =============================================================================
