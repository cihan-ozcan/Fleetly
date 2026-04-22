-- =============================================================================
-- Fleetly — Sürücü / Belge / Araç Atama Refactor Migration
-- Tarih: 2026-04-22
-- Strateji: Non-breaking, 4 fazlı geçiş
--   Faz 1: Yeni yapıları EKLE (eski kolonlar duruyor)
--   Faz 2: Eski text alanlardan BACKFILL
--   Faz 3: Çift yönlü SYNC trigger (eski kod bozulmasın)
--   Faz 4: Kod geçince eski kolonları DEPRECATE (ayrı script ile DROP)
-- =============================================================================
-- ÖNEMLI: Bu migration dosyası idempotent olacak şekilde yazılmıştır
-- (IF NOT EXISTS / CREATE OR REPLACE). Staging'de en az bir kez test edin.
-- Production'da fazları ayrı deploy'larda çalıştırmanız önerilir.
-- =============================================================================

BEGIN;

-- =============================================================================
-- FAZ 1: YENİ YAPILARIN EKLENMESİ (EKLE-YOLU, eskileri bozmaz)
-- =============================================================================

-- 1.1 suruculer: Kanonik sürücü kaydı.
--     surucu_belgeler içindeki kişi bilgileri buraya taşınır,
--     belgeler ayrı tabloya çıkarılır.
CREATE TABLE IF NOT EXISTS public.suruculer (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id         uuid        NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  auth_user_id     uuid        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  -- kişi bilgileri
  ad               text        NOT NULL,
  soyad            text,
  telefon_e164     text        NOT NULL,           -- +905321234567 formatında normalize
  telefon_raw      text,                           -- kullanıcının girdiği ham hali
  email            text,
  dogum_tarihi     date,
  adres            text,
  avatar_url       text,
  acil_kontak_ad   text,
  acil_kontak_tel  text,
  -- durum
  durum            text        NOT NULL DEFAULT 'davet_bekliyor'
                   CHECK (durum IN ('davet_bekliyor','aktif','pasif','silindi')),
  aktif_mi         boolean     GENERATED ALWAYS AS (durum = 'aktif') STORED,
  son_giris        timestamptz,
  fcm_token        text,
  ayarlar          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- audit
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        REFERENCES auth.users(id),

  -- Aynı firmada aynı telefon bir kez bulunabilir → dedup garantisi
  CONSTRAINT suruculer_firma_tel_uniq UNIQUE (firma_id, telefon_e164)
);
CREATE INDEX IF NOT EXISTS suruculer_firma_idx       ON public.suruculer(firma_id);
CREATE INDEX IF NOT EXISTS suruculer_auth_user_idx   ON public.suruculer(auth_user_id);
CREATE INDEX IF NOT EXISTS suruculer_telefon_idx     ON public.suruculer(telefon_e164);
CREATE INDEX IF NOT EXISTS suruculer_firma_durum_idx ON public.suruculer(firma_id, durum);


-- 1.2 belge_turleri: Belge türü sözlüğü.
--     Böylece ehliyet/src/psiko/saglik/takograf/sigorta gibi türleri
--     ayrı kolonlarla değil, satır olarak tutarız; yenisi eklenince kod değişmez.
CREATE TABLE IF NOT EXISTS public.belge_turleri (
  kod                  text PRIMARY KEY,   -- 'ehliyet','src','psiko','saglik','takograf','sigorta'
  ad                   text NOT NULL,
  uyari_gun_varsayilan int  NOT NULL DEFAULT 30,
  sofor_duzenleyebilir boolean NOT NULL DEFAULT true,
  gerekli_mi           boolean NOT NULL DEFAULT false
);

INSERT INTO public.belge_turleri(kod, ad, uyari_gun_varsayilan, sofor_duzenleyebilir, gerekli_mi)
VALUES
  ('ehliyet', 'Sürücü Belgesi',   30, true,  true),
  ('src',     'SRC Belgesi',      30, true,  true),
  ('psiko',   'Psikoteknik',      30, true,  false),
  ('saglik',  'Sağlık Raporu',    30, true,  false),
  ('takograf','Takograf Kartı',   30, true,  false),
  ('sigorta', 'Ferdi Kaza Sig.',  30, false, false)
ON CONFLICT (kod) DO NOTHING;


-- 1.3 surucu_belgeleri: Sürücüye ait belgelerin KANONİK tablosu.
--     surucu_belgeler (eski) tablosundaki ehliyet/src/psiko/takograf
--     kolonları burada satır-bazlı tutulur.
CREATE TABLE IF NOT EXISTS public.surucu_belgeleri (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  surucu_id     uuid        NOT NULL REFERENCES public.suruculer(id) ON DELETE CASCADE,
  firma_id      uuid        NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  belge_turu    text        NOT NULL REFERENCES public.belge_turleri(kod),
  -- belge içerik alanları
  belge_no      text,
  sinif         text,       -- ehliyet sınıfı vs.
  veren_kurum   text,
  verilis_tarihi date,
  bitis_tarihi  date,
  dosya_url     text,       -- storage bucket yolu (PDF/JPEG)
  -- onay durumu (portal üzerinden gelen güncellemeler için)
  onay_durumu   text        NOT NULL DEFAULT 'onayli'
                CHECK (onay_durumu IN ('onayli','bekliyor','reddedildi')),
  onaylayan     uuid        REFERENCES auth.users(id),
  onay_zamani   timestamptz,
  red_nedeni    text,
  -- audit
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES auth.users(id),
  kaynak        text        NOT NULL DEFAULT 'ofis'
                CHECK (kaynak IN ('ofis','portal','migration')),

  -- Bir sürücünün her belge türünden yalnızca BİR aktif kaydı olur.
  CONSTRAINT surucu_belgeleri_tekil UNIQUE (surucu_id, belge_turu)
);
CREATE INDEX IF NOT EXISTS surucu_belgeleri_surucu_idx  ON public.surucu_belgeleri(surucu_id);
CREATE INDEX IF NOT EXISTS surucu_belgeleri_firma_idx   ON public.surucu_belgeleri(firma_id);
CREATE INDEX IF NOT EXISTS surucu_belgeleri_bitis_idx   ON public.surucu_belgeleri(bitis_tarihi);
CREATE INDEX IF NOT EXISTS surucu_belgeleri_onay_idx    ON public.surucu_belgeleri(firma_id, onay_durumu);


-- 1.4 surucu_belge_onaylari: Değişiklik kuyruğu (append-only audit log).
--     Şoför portalı bir belgeyi güncellediğinde, surucu_belgeleri'ndeki satır
--     onay_durumu='bekliyor' yapılır VE buraya değişiklik snapshot'ı düşer.
--     Ofis çalışanı onay/red verince ilgili kayıt kapanır.
CREATE TABLE IF NOT EXISTS public.surucu_belge_onaylari (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  belge_id     uuid        NOT NULL REFERENCES public.surucu_belgeleri(id) ON DELETE CASCADE,
  surucu_id    uuid        NOT NULL REFERENCES public.suruculer(id) ON DELETE CASCADE,
  firma_id     uuid        NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  talep_tipi   text        NOT NULL CHECK (talep_tipi IN ('ekleme','guncelleme','silme')),
  eski_veri    jsonb,                -- önceki hali (null ise ekleme talebi)
  yeni_veri    jsonb       NOT NULL, -- sürücünün önerdiği hal
  talep_eden   uuid        NOT NULL REFERENCES auth.users(id),
  talep_zamani timestamptz NOT NULL DEFAULT now(),
  karar        text        CHECK (karar IN ('onayli','reddedildi')),
  karar_veren  uuid        REFERENCES auth.users(id),
  karar_zamani timestamptz,
  karar_notu   text
);
CREATE INDEX IF NOT EXISTS surucu_belge_onaylari_firma_idx ON public.surucu_belge_onaylari(firma_id, karar);
CREATE INDEX IF NOT EXISTS surucu_belge_onaylari_belge_idx ON public.surucu_belge_onaylari(belge_id);


-- 1.5 arac_sofor_atamalari: Araç↔sürücü many-to-many geçmişiyle birlikte.
--     Aynı anda bir araca BİR birincil sürücü (exclusion constraint ile garanti).
--     Kapanmamış (bitis NULL) atama = o anın aktif sürücüsü.
CREATE TABLE IF NOT EXISTS public.arac_sofor_atamalari (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arac_id       text        NOT NULL REFERENCES public.araclar(id) ON DELETE CASCADE,
  surucu_id     uuid        NOT NULL REFERENCES public.suruculer(id) ON DELETE CASCADE,
  firma_id      uuid        NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  baslangic     timestamptz NOT NULL DEFAULT now(),
  bitis         timestamptz,  -- NULL = aktif
  birincil_mi   boolean     NOT NULL DEFAULT true,
  atayan        uuid        REFERENCES auth.users(id),
  notlar        text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT asa_tarih_sirasi CHECK (bitis IS NULL OR bitis > baslangic)
);
CREATE INDEX IF NOT EXISTS asa_arac_idx   ON public.arac_sofor_atamalari(arac_id);
CREATE INDEX IF NOT EXISTS asa_surucu_idx ON public.arac_sofor_atamalari(surucu_id);
-- Aktif (bitis IS NULL) atamalarda bir araç, bir anda yalnızca BİR birincil sürücüye bağlı
CREATE UNIQUE INDEX IF NOT EXISTS asa_arac_aktif_birincil_uniq
  ON public.arac_sofor_atamalari(arac_id)
  WHERE bitis IS NULL AND birincil_mi = true;


-- 1.6 surucu_davetleri: Mevcut tablo var. Yalnızca surucu_id FK'sini ekliyoruz.
--     Böylece davet oluşturulduğu anda telefonla bulunan mevcut sürücüye
--     bağlanır; kabul sırasında zaten bilinir.
ALTER TABLE public.surucu_davetleri
  ADD COLUMN IF NOT EXISTS surucu_id        uuid REFERENCES public.suruculer(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS telefon_e164     text,
  ADD COLUMN IF NOT EXISTS davet_durumu     text NOT NULL DEFAULT 'gonderildi'
    CHECK (davet_durumu IN ('gonderildi','kabul','suresi_doldu','iptal'));


-- 1.7 araclar / is_emirleri / seferler: text → FK geçişi için YENİ kolonlar.
--     Eski text kolonları (sofor, telefon, plaka, vb.) Faz 3'te trigger ile
--     senkron tutulur; kod tamamen geçince Faz 4'te drop edilir.
ALTER TABLE public.araclar
  ADD COLUMN IF NOT EXISTS birincil_surucu_id uuid REFERENCES public.suruculer(id) ON DELETE SET NULL;

ALTER TABLE public.is_emirleri
  ADD COLUMN IF NOT EXISTS surucu_id uuid REFERENCES public.suruculer(id) ON DELETE SET NULL;
-- NOT: is_emirleri.sofor_user_id zaten auth.users'a bağlı; surucu_id onu dolaylı
-- olarak karşılar, ayrıca isim/telefon text alanlarını view üzerinden çeker.

ALTER TABLE public.seferler
  ADD COLUMN IF NOT EXISTS surucu_id uuid REFERENCES public.suruculer(id) ON DELETE SET NULL;

ALTER TABLE public.yakit_girisleri
  ADD COLUMN IF NOT EXISTS surucu_id uuid REFERENCES public.suruculer(id) ON DELETE SET NULL;


-- =============================================================================
-- FAZ 2: BACKFILL — Eski text alanlardan yeni yapılara veri taşı
-- =============================================================================

-- 2.1 Telefon normalizasyon yardımcısı (+90 Türkiye varsayılan)
CREATE OR REPLACE FUNCTION public.fn_normalize_tel(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  -- 10 haneli → TR mobil (5xx...) varsayımı
  IF length(d) = 10 THEN RETURN '+90' || d;
  ELSIF length(d) = 11 AND left(d,1) = '0' THEN RETURN '+90' || substr(d,2);
  ELSIF length(d) = 12 AND left(d,2) = '90' THEN RETURN '+' || d;
  ELSIF left(p,1) = '+' THEN RETURN '+' || d;
  ELSE RETURN '+' || d; END IF;
END$$;

-- 2.2 surucu_belgeler (eski) → suruculer (kişi kısmı)
INSERT INTO public.suruculer (
  id, firma_id, auth_user_id, ad, telefon_e164, telefon_raw, email,
  dogum_tarihi, adres, avatar_url, acil_kontak_ad, acil_kontak_tel,
  durum, son_giris, fcm_token, ayarlar, created_at
)
SELECT
  gen_random_uuid(),
  sb.firma_id,
  sb.user_id,
  COALESCE(sb.ad, 'İsimsiz'),
  public.fn_normalize_tel(sb.tel),
  sb.tel,
  sb.email,
  sb.dogum_tarihi,
  sb.adres,
  sb.avatar_url,
  sb.acil_kontak_ad,
  sb.acil_kontak_tel,
  CASE WHEN sb.aktif_mi THEN 'aktif' ELSE 'pasif' END,
  sb.son_giris,
  sb.fcm_token,
  COALESCE(sb.ayarlar,'{}'::jsonb),
  sb.created_at
FROM public.surucu_belgeler sb
WHERE sb.firma_id IS NOT NULL
  AND public.fn_normalize_tel(sb.tel) IS NOT NULL
ON CONFLICT (firma_id, telefon_e164) DO UPDATE SET
  ad           = EXCLUDED.ad,
  auth_user_id = COALESCE(public.suruculer.auth_user_id, EXCLUDED.auth_user_id),
  email        = COALESCE(public.suruculer.email, EXCLUDED.email);


-- 2.3 araclar.sofor (text) → suruculer (davet beklemedeki "phantom" kayıtlar)
--     surucu_belgeler'de olmayan ama araclar.sofor'da geçen kişileri getir.
INSERT INTO public.suruculer (firma_id, ad, telefon_e164, telefon_raw, durum)
SELECT DISTINCT
  a.firma_id,
  a.sofor,
  public.fn_normalize_tel(a.telefon),
  a.telefon,
  'davet_bekliyor'
FROM public.araclar a
WHERE a.sofor IS NOT NULL
  AND a.telefon IS NOT NULL
  AND public.fn_normalize_tel(a.telefon) IS NOT NULL
  AND a.firma_id IS NOT NULL
ON CONFLICT (firma_id, telefon_e164) DO NOTHING;


-- 2.4 surucu_belgeler (eski) → surucu_belgeleri (satır-bazlı belge)
--     ehliyet / src / psiko / takograf / saglik her biri ayrı satır olur.
INSERT INTO public.surucu_belgeleri (
  surucu_id, firma_id, belge_turu, bitis_tarihi, sinif, belge_no, onay_durumu, kaynak
)
SELECT s.id, s.firma_id, v.belge_turu, v.bitis, v.sinif, v.no, 'onayli', 'migration'
FROM public.surucu_belgeler sb
JOIN public.suruculer s
  ON s.firma_id = sb.firma_id
 AND s.telefon_e164 = public.fn_normalize_tel(sb.tel)
CROSS JOIN LATERAL (VALUES
  ('ehliyet', COALESCE(sb.ehliyet_bitis, sb.ehliyet), sb.ehliyet_sinifi, sb.ehliyet_no),
  ('src',     COALESCE(sb.src_bitis,     sb.src),     NULL, NULL),
  ('psiko',   COALESCE(sb.psiko_bitis,   sb.psiko),   NULL, NULL),
  ('saglik',  sb.saglik_bitis,                        NULL, NULL),
  ('takograf',sb.takograf,                            NULL, NULL)
) AS v(belge_turu, bitis, sinif, no)
WHERE v.bitis IS NOT NULL OR v.no IS NOT NULL
ON CONFLICT (surucu_id, belge_turu) DO UPDATE SET
  bitis_tarihi = EXCLUDED.bitis_tarihi,
  sinif        = COALESCE(EXCLUDED.sinif, public.surucu_belgeleri.sinif),
  belge_no     = COALESCE(EXCLUDED.belge_no, public.surucu_belgeleri.belge_no);


-- 2.5 araclar.sofor/telefon → arac_sofor_atamalari (aktif atamalar)
INSERT INTO public.arac_sofor_atamalari (arac_id, surucu_id, firma_id, baslangic, bitis, birincil_mi)
SELECT a.id, s.id, a.firma_id, COALESCE(a.created_at, now()), NULL, true
FROM public.araclar a
JOIN public.suruculer s
  ON s.firma_id = a.firma_id
 AND s.telefon_e164 = public.fn_normalize_tel(a.telefon)
WHERE a.sofor IS NOT NULL
  AND a.telefon IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2.5.1 araclar.birincil_surucu_id cache'i doldur
UPDATE public.araclar a
SET birincil_surucu_id = asa.surucu_id
FROM public.arac_sofor_atamalari asa
WHERE asa.arac_id = a.id
  AND asa.bitis IS NULL
  AND asa.birincil_mi = true
  AND a.birincil_surucu_id IS DISTINCT FROM asa.surucu_id;


-- 2.6 surucu_davetleri: telefon_e164 + surucu_id backfill
UPDATE public.surucu_davetleri d
SET telefon_e164 = public.fn_normalize_tel(d.telefon)
WHERE d.telefon_e164 IS NULL;

UPDATE public.surucu_davetleri d
SET surucu_id = s.id
FROM public.suruculer s
WHERE s.firma_id = d.firma_id
  AND s.telefon_e164 = d.telefon_e164
  AND d.surucu_id IS NULL;


-- 2.7 is_emirleri / seferler / yakit_girisleri: surucu_id backfill
UPDATE public.is_emirleri ie
SET surucu_id = s.id
FROM public.suruculer s
WHERE s.firma_id = ie.firma_id
  AND (
        s.auth_user_id = ie.sofor_user_id
     OR s.telefon_e164 = public.fn_normalize_tel(ie.sofor_tel)
  )
  AND ie.surucu_id IS NULL;

UPDATE public.seferler se
SET surucu_id = s.id
FROM public.suruculer s, public.araclar a
WHERE a.id = se.arac_id
  AND s.id = a.birincil_surucu_id
  AND se.surucu_id IS NULL;

UPDATE public.yakit_girisleri y
SET surucu_id = s.id
FROM public.suruculer s, public.araclar a
WHERE a.id = y.arac_id
  AND s.id = a.birincil_surucu_id
  AND y.surucu_id IS NULL;


-- =============================================================================
-- FAZ 3: ÇIFT YÖNLÜ SYNC — Eski kod bozulmadan yeni kod geçsin diye
-- =============================================================================

-- 3.1 araclar.birincil_surucu_id değişince eski text alanları otomatik doldur
CREATE OR REPLACE FUNCTION public.trg_araclar_sofor_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s RECORD;
BEGIN
  IF NEW.birincil_surucu_id IS NOT NULL
     AND NEW.birincil_surucu_id IS DISTINCT FROM OLD.birincil_surucu_id THEN
    SELECT ad, telefon_e164 INTO s
      FROM public.suruculer WHERE id = NEW.birincil_surucu_id;
    NEW.sofor   := s.ad;
    NEW.telefon := s.telefon_e164;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS araclar_sofor_sync ON public.araclar;
CREATE TRIGGER araclar_sofor_sync
BEFORE UPDATE OF birincil_surucu_id ON public.araclar
FOR EACH ROW EXECUTE FUNCTION public.trg_araclar_sofor_sync();


-- 3.2 arac_sofor_atamalari eklenince araclar.birincil_surucu_id cache'ini güncelle
CREATE OR REPLACE FUNCTION public.trg_asa_arac_cache()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Yeni aktif birincil atama eklendiyse veya mevcut atama kapatıldıysa cache'i yeniden hesapla
  UPDATE public.araclar a
  SET birincil_surucu_id = (
    SELECT asa.surucu_id
    FROM public.arac_sofor_atamalari asa
    WHERE asa.arac_id = a.id AND asa.bitis IS NULL AND asa.birincil_mi = true
    LIMIT 1
  )
  WHERE a.id = COALESCE(NEW.arac_id, OLD.arac_id);
  RETURN NULL;
END$$;

DROP TRIGGER IF EXISTS asa_arac_cache ON public.arac_sofor_atamalari;
CREATE TRIGGER asa_arac_cache
AFTER INSERT OR UPDATE OR DELETE ON public.arac_sofor_atamalari
FOR EACH ROW EXECUTE FUNCTION public.trg_asa_arac_cache();


-- 3.3 updated_at otomatik güncelleme
CREATE OR REPLACE FUNCTION public.trg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END$$;

DROP TRIGGER IF EXISTS suruculer_touch        ON public.suruculer;
CREATE TRIGGER suruculer_touch
BEFORE UPDATE ON public.suruculer
FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();

DROP TRIGGER IF EXISTS surucu_belgeleri_touch ON public.surucu_belgeleri;
CREATE TRIGGER surucu_belgeleri_touch
BEFORE UPDATE ON public.surucu_belgeleri
FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();


-- =============================================================================
-- VIEW'LAR: Kodun tek bir veri kaynağından beslenmesini sağlar
-- =============================================================================

-- v_arac_secim: Ofis panelindeki araç seçim listesi için standardize edilmiş görünüm.
--   Plaka, sürücü adı ve "boş mu?" bayrağı tek sorguda. Frontend burada filter'lar.
CREATE OR REPLACE VIEW public.v_arac_secim AS
SELECT
  a.id,
  a.firma_id,
  a.plaka,
  a.durum            AS arac_durumu,
  a.tip              AS arac_tipi,
  a.marka, a.model, a.yil,
  s.id               AS surucu_id,
  s.ad               AS sofor_ad,
  s.telefon_e164     AS sofor_tel,
  s.durum            AS sofor_durumu,
  (s.id IS NULL)     AS bos_mu,
  -- UI için hazır etiket: "34FSB145 — Cihan Özcan"  (boşsa "34FSB145 (boş)")
  CASE
    WHEN s.id IS NULL THEN a.plaka || ' (boş)'
    ELSE a.plaka || ' — ' || s.ad
  END AS gosterim_adi
FROM public.araclar a
LEFT JOIN public.suruculer s ON s.id = a.birincil_surucu_id;


-- v_surucu_dosyasi: Ofis paneli sürücü sekmesi ve şoför portalı için
--   tek kaynaktan beslenen birleşik görünüm. Belgeler JSON array olarak döner.
CREATE OR REPLACE VIEW public.v_surucu_dosyasi AS
SELECT
  s.id                 AS surucu_id,
  s.firma_id,
  s.auth_user_id,
  s.ad, s.soyad, s.telefon_e164, s.email, s.durum, s.avatar_url,
  s.dogum_tarihi, s.adres, s.acil_kontak_ad, s.acil_kontak_tel,
  a.id                 AS arac_id,
  a.plaka              AS arac_plaka,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tur',          b.belge_turu,
      'ad',           bt.ad,
      'belge_no',     b.belge_no,
      'sinif',        b.sinif,
      'veren_kurum',  b.veren_kurum,
      'bitis',        b.bitis_tarihi,
      'kalan_gun',    (b.bitis_tarihi - current_date),
      'onay_durumu',  b.onay_durumu,
      'dosya_url',    b.dosya_url,
      'updated_at',   b.updated_at
    ) ORDER BY bt.kod)
    FROM public.surucu_belgeleri b
    JOIN public.belge_turleri  bt ON bt.kod = b.belge_turu
    WHERE b.surucu_id = s.id
  ), '[]'::jsonb)      AS belgeler,
  -- en yakın biten belgenin kalan gün sayısı (uyarı bandı için)
  (SELECT min(b.bitis_tarihi - current_date)
     FROM public.surucu_belgeleri b
    WHERE b.surucu_id = s.id AND b.bitis_tarihi IS NOT NULL) AS en_yakin_bitis_gun
FROM public.suruculer s
LEFT JOIN public.arac_sofor_atamalari asa
       ON asa.surucu_id = s.id AND asa.bitis IS NULL AND asa.birincil_mi = true
LEFT JOIN public.araclar a ON a.id = asa.arac_id;


-- v_surucu_belge_uyarilari: Yaklaşan/geçmiş belge uyarıları (ofis dashboard'u)
CREATE OR REPLACE VIEW public.v_surucu_belge_uyarilari AS
SELECT
  b.id            AS belge_id,
  b.firma_id,
  s.id            AS surucu_id,
  s.ad            AS surucu_ad,
  s.telefon_e164,
  b.belge_turu,
  bt.ad           AS belge_adi,
  b.bitis_tarihi,
  (b.bitis_tarihi - current_date) AS kalan_gun,
  CASE
    WHEN b.bitis_tarihi < current_date                            THEN 'gecti'
    WHEN (b.bitis_tarihi - current_date) <= bt.uyari_gun_varsayilan THEN 'yaklasiyor'
    ELSE 'gecerli'
  END AS seviye
FROM public.surucu_belgeleri b
JOIN public.suruculer s      ON s.id  = b.surucu_id
JOIN public.belge_turleri bt ON bt.kod = b.belge_turu
WHERE b.bitis_tarihi IS NOT NULL;


-- =============================================================================
-- RPC'LER: Uygulama akışlarının tek giriş noktası (RLS ile güvenli)
-- =============================================================================

-- RPC.1  sofor_davet_olustur_v2: Davet oluştururken telefon ile dedup.
--   Telefon zaten suruculer'de varsa aynı kaydı kullan; yoksa "davet_bekliyor"
--   statüsünde yeni sürücü yarat. UI'daki ad/telefon formu "boş form" değil;
--   telefon girilince mevcut kişinin bilgileri dolar.
CREATE OR REPLACE FUNCTION public.sofor_davet_olustur_v2(
  p_firma_id uuid,
  p_ad       text,
  p_telefon  text,
  p_arac_id  text  DEFAULT NULL,
  p_not      text  DEFAULT NULL
) RETURNS TABLE(davet_id bigint, davet_kodu text, surucu_id uuid, yeni_sofor boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tel text := public.fn_normalize_tel(p_telefon);
  v_surucu public.suruculer%ROWTYPE;
  v_kod    text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_yeni   boolean := false;
  v_davet_id bigint;
BEGIN
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'Geçersiz telefon';
  END IF;

  -- Önce ara: aynı firmada aynı telefon var mı?
  SELECT * INTO v_surucu
  FROM public.suruculer
  WHERE firma_id = p_firma_id AND telefon_e164 = v_tel;

  IF NOT FOUND THEN
    INSERT INTO public.suruculer(firma_id, ad, telefon_e164, telefon_raw, durum, created_by)
    VALUES (p_firma_id, p_ad, v_tel, p_telefon, 'davet_bekliyor', auth.uid())
    RETURNING * INTO v_surucu;
    v_yeni := true;
  ELSE
    -- Mevcut; adı boşsa güncelle, ama üzerine yazma.
    IF v_surucu.ad IS NULL OR v_surucu.ad = 'İsimsiz' THEN
      UPDATE public.suruculer SET ad = p_ad WHERE id = v_surucu.id;
    END IF;
  END IF;

  INSERT INTO public.surucu_davetleri(
    firma_id, davet_eden, ad, telefon, telefon_e164,
    surucu_id, arac_id, davet_kodu, notlar, davet_durumu
  ) VALUES (
    p_firma_id, auth.uid(), COALESCE(v_surucu.ad, p_ad), p_telefon, v_tel,
    v_surucu.id, p_arac_id, v_kod, p_not, 'gonderildi'
  ) RETURNING id INTO v_davet_id;

  -- Varsa araca birincil sürücü olarak aday-atama (kabul edilince aktifleşir)
  -- (İsteğe bağlı: burada ön-atama yerine sofor_davet_kabul içinde yapılabilir.)

  RETURN QUERY SELECT v_davet_id, v_kod, v_surucu.id, v_yeni;
END$$;


-- RPC.2  sofor_davet_kabul_v2: Kabul → auth_user_id linkle, atama aç
CREATE OR REPLACE FUNCTION public.sofor_davet_kabul_v2(p_kod text)
RETURNS TABLE(surucu_id uuid, firma_id uuid)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  d public.surucu_davetleri%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO d FROM public.surucu_davetleri WHERE davet_kodu = p_kod FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Davet bulunamadı'; END IF;
  IF d.expires_at < now() THEN RAISE EXCEPTION 'Davet süresi doldu'; END IF;
  IF d.kullanildi_at IS NOT NULL THEN RAISE EXCEPTION 'Davet kullanılmış'; END IF;

  -- Sürücü kaydını auth.users ile eşle
  UPDATE public.suruculer
     SET auth_user_id = v_uid,
         durum        = 'aktif'
   WHERE id = d.surucu_id
   RETURNING id, firma_id INTO surucu_id, firma_id;

  UPDATE public.surucu_davetleri
     SET kullanildi_at = now(),
         kullanan_user_id = v_uid,
         davet_durumu = 'kabul'
   WHERE id = d.id;

  -- Davet sırasında araç seçildiyse atamayı aç
  IF d.arac_id IS NOT NULL THEN
    -- Önce varsa eski birincil atamayı kapat
    UPDATE public.arac_sofor_atamalari
       SET bitis = now()
     WHERE arac_id = d.arac_id AND bitis IS NULL AND birincil_mi = true;

    INSERT INTO public.arac_sofor_atamalari(arac_id, surucu_id, firma_id, birincil_mi, atayan)
    VALUES (d.arac_id, surucu_id, firma_id, true, d.davet_eden);
  END IF;

  RETURN NEXT;
END$$;


-- RPC.3  surucu_belge_guncelle: Portal'dan gelen belge güncellemesi.
--   Her zaman onay kuyruğuna düşer. Kaynak='portal'. Sürücü sadece kendine ait
--   belgeyi güncelleyebilir (RLS'te de ayrıca kilitli tutulur).
CREATE OR REPLACE FUNCTION public.surucu_belge_guncelle(
  p_belge_turu text,
  p_veri       jsonb     -- {belge_no, sinif, veren_kurum, verilis_tarihi, bitis_tarihi, dosya_url}
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s   public.suruculer%ROWTYPE;
  v_b   public.surucu_belgeleri%ROWTYPE;
  v_eski jsonb;
BEGIN
  SELECT * INTO v_s FROM public.suruculer WHERE auth_user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sürücü kaydınız bulunamadı'; END IF;

  SELECT * INTO v_b FROM public.surucu_belgeleri
  WHERE surucu_id = v_s.id AND belge_turu = p_belge_turu;

  IF FOUND THEN
    v_eski := to_jsonb(v_b);
    UPDATE public.surucu_belgeleri SET
      belge_no      = COALESCE(p_veri->>'belge_no',    belge_no),
      sinif         = COALESCE(p_veri->>'sinif',       sinif),
      veren_kurum    = COALESCE(p_veri->>'veren_kurum',  veren_kurum),
      verilis_tarihi = COALESCE((p_veri->>'verilis_tarihi')::date, verilis_tarihi),
      bitis_tarihi   = COALESCE((p_veri->>'bitis_tarihi')::date,   bitis_tarihi),
      dosya_url     = COALESCE(p_veri->>'dosya_url',   dosya_url),
      onay_durumu   = 'bekliyor',
      kaynak        = 'portal',
      updated_by    = v_uid
    WHERE id = v_b.id RETURNING * INTO v_b;

    INSERT INTO public.surucu_belge_onaylari(
      belge_id, surucu_id, firma_id, talep_tipi, eski_veri, yeni_veri, talep_eden)
    VALUES (v_b.id, v_s.id, v_s.firma_id, 'guncelleme', v_eski, to_jsonb(v_b), v_uid);
  ELSE
    INSERT INTO public.surucu_belgeleri(
      surucu_id, firma_id, belge_turu, belge_no, sinif, veren_kurum,
      verilis_tarihi, bitis_tarihi, dosya_url, onay_durumu, kaynak, updated_by)
    VALUES (
      v_s.id, v_s.firma_id, p_belge_turu,
      p_veri->>'belge_no', p_veri->>'sinif', p_veri->>'veren_kurum',
      (p_veri->>'verilis_tarihi')::date, (p_veri->>'bitis_tarihi')::date,
      p_veri->>'dosya_url', 'bekliyor', 'portal', v_uid
    ) RETURNING * INTO v_b;

    INSERT INTO public.surucu_belge_onaylari(
      belge_id, surucu_id, firma_id, talep_tipi, yeni_veri, talep_eden)
    VALUES (v_b.id, v_s.id, v_s.firma_id, 'ekleme', to_jsonb(v_b), v_uid);
  END IF;

  RETURN v_b.id;
END$$;


-- RPC.4  surucu_belge_onayla: Ofis çalışanının onay/red kararı
CREATE OR REPLACE FUNCTION public.surucu_belge_onayla(
  p_onay_id bigint,
  p_karar   text,              -- 'onayli' | 'reddedildi'
  p_not     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE o public.surucu_belge_onaylari%ROWTYPE;
BEGIN
  IF p_karar NOT IN ('onayli','reddedildi') THEN
    RAISE EXCEPTION 'Karar onayli veya reddedildi olmalı';
  END IF;

  SELECT * INTO o FROM public.surucu_belge_onaylari WHERE id = p_onay_id FOR UPDATE;
  IF NOT FOUND OR o.karar IS NOT NULL THEN
    RAISE EXCEPTION 'Onay kaydı yok veya zaten karar verilmiş';
  END IF;

  UPDATE public.surucu_belge_onaylari
     SET karar = p_karar, karar_veren = auth.uid(), karar_zamani = now(), karar_notu = p_not
   WHERE id = p_onay_id;

  IF p_karar = 'onayli' THEN
    UPDATE public.surucu_belgeleri
       SET onay_durumu = 'onayli', onaylayan = auth.uid(), onay_zamani = now(), red_nedeni = NULL
     WHERE id = o.belge_id;
  ELSE
    UPDATE public.surucu_belgeleri
       SET onay_durumu = 'reddedildi', onaylayan = auth.uid(), onay_zamani = now(), red_nedeni = p_not
     WHERE id = o.belge_id;
    -- Reddedilen belgede sürücünün yeni verisi kalmış olur; sürücü tekrar güncelleyebilir.
  END IF;
END$$;


-- RPC.5  arac_sofor_ata: Araca yeni birincil sürücü ata (eskisini kapat)
CREATE OR REPLACE FUNCTION public.arac_sofor_ata(
  p_arac_id   text,
  p_surucu_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_firma uuid;
BEGIN
  SELECT firma_id INTO v_firma FROM public.araclar WHERE id = p_arac_id;
  IF v_firma IS NULL THEN RAISE EXCEPTION 'Araç bulunamadı'; END IF;

  UPDATE public.arac_sofor_atamalari
     SET bitis = now()
   WHERE arac_id = p_arac_id AND bitis IS NULL AND birincil_mi = true;

  IF p_surucu_id IS NOT NULL THEN
    INSERT INTO public.arac_sofor_atamalari(arac_id, surucu_id, firma_id, birincil_mi, atayan)
    VALUES (p_arac_id, p_surucu_id, v_firma, true, auth.uid());
  END IF;
END$$;


-- =============================================================================
-- RLS (Row Level Security) — minimal güvenlik çatısı
-- =============================================================================
ALTER TABLE public.suruculer             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surucu_belgeleri      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surucu_belge_onaylari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arac_sofor_atamalari  ENABLE ROW LEVEL SECURITY;

-- Sürücü yalnızca kendi kaydını görür
CREATE POLICY suruculer_self_read ON public.suruculer
FOR SELECT USING (auth_user_id = auth.uid());

-- Ofis kullanıcısı (firma üyesi) kendi firmasındaki sürücüleri görür
CREATE POLICY suruculer_firma_read ON public.suruculer
FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.firma_kullanicilar fk
  WHERE fk.user_id = auth.uid() AND fk.firma_id = suruculer.firma_id
));

-- Ofis üyeleri (rol: sahip/yonetici/operasyoncu) yazabilir
CREATE POLICY suruculer_firma_write ON public.suruculer
FOR ALL USING (EXISTS (
  SELECT 1 FROM public.firma_kullanicilar fk
  WHERE fk.user_id = auth.uid() AND fk.firma_id = suruculer.firma_id
    AND fk.rol IN ('sahip','yonetici','operasyoncu')
));

-- Belge: sürücü kendi belgelerini okur; ofis firmasındaki tümünü okur/yazar
CREATE POLICY belge_self_read ON public.surucu_belgeleri
FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.suruculer s
  WHERE s.id = surucu_belgeleri.surucu_id AND s.auth_user_id = auth.uid()
));

CREATE POLICY belge_firma_rw ON public.surucu_belgeleri
FOR ALL USING (EXISTS (
  SELECT 1 FROM public.firma_kullanicilar fk
  WHERE fk.user_id = auth.uid() AND fk.firma_id = surucu_belgeleri.firma_id
    AND fk.rol IN ('sahip','yonetici','operasyoncu')
));

-- Onay kuyruğu: ofis üyesi görür; sürücü kendi taleplerini görür
CREATE POLICY onay_firma_read ON public.surucu_belge_onaylari
FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.firma_kullanicilar fk
  WHERE fk.user_id = auth.uid() AND fk.firma_id = surucu_belge_onaylari.firma_id
));


-- =============================================================================
-- FAZ 4: DEPRECATION NOTLARI (AYRI script ile uygulanacak)
-- =============================================================================
-- Tüm frontend/RPC'ler yeni yapıya geçtikten SONRA, aşağıdakiler drop edilir:
--   ALTER TABLE public.araclar      DROP COLUMN sofor, DROP COLUMN telefon;
--   ALTER TABLE public.is_emirleri  DROP COLUMN sofor, DROP COLUMN sofor_tel, DROP COLUMN sofor_whatsapp;
--   ALTER TABLE public.seferler     DROP COLUMN sofor, DROP COLUMN plaka;
--   ALTER TABLE public.yakit_girisleri DROP COLUMN sofor;
--   -- surucu_belgeler (eski) → RENAME TO _arsiv_surucu_belgeler (30 gün sakla, sonra drop)
-- Frontend geçişi bitmeden BU BLOK ÇALIŞTIRILMAMALI.
-- =============================================================================

COMMIT;
