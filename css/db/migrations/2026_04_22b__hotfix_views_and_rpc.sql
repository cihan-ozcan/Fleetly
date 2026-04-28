-- =============================================================================
-- FLEETLY HOTFIX  —  2026-04-22b
-- =============================================================================
-- Ana refactor (2026_04_22__surucu_refactor.sql) deploy edildikten sonra ortaya
-- çıkan üç üretim hatasını giderir. Tamamen idempotenttir; birden fazla kez
-- güvenle çalıştırılabilir.
--
-- Bug 1  "Tek sürücü iki defa listeleniyor"
--        Sürücü hem çekici hem dorsede birincil_mi=true olduğunda
--        v_surucu_dosyasi'ndaki LEFT JOIN N×1 yerine N×M satır üretiyordu
--        → sürücü sayısı olduğundan fazla görünüyor, liste tekrarlı.
--
-- Bug 2  "Kayıtlı muayene bitiş tarihleri panelde artık gözükmüyor"
--        v_arac_secim görünümü muayene/sigorta/takograf/esleme/notlar
--        sütunlarını expose etmiyordu; loadVehicles() view'ı tercih edince
--        bu alanlar r.muayene = undefined olup boş string atandı.
--
-- Bug 3  "Şoför SMS kodu girince 'column reference firma_id is ambiguous'"
--        sofor_davet_kabul_v2 fonksiyonunun
--          RETURNS TABLE(surucu_id uuid, firma_id uuid)
--        OUT parametre isimleri, RETURNING id, firma_id INTO ... INTO cümlesinde
--        suruculer.firma_id sütunu ile çakıştı (PG 42702).
--        Ayrıca arac_sofor_atamalari.firma_id VALUES listesinde de aynı ad
--        görünüyordu. İç değişkenler v_surucu_id / v_firma_id ile ayırıyoruz
--        ve OUT isimlerini out_... önekiyle yeniden adlandırıyoruz.
-- =============================================================================

BEGIN;


-- -----------------------------------------------------------------------------
-- 1) v_arac_secim  —  muayene/sigorta/takograf/esleme/notlar sütunlarını ekle
-- -----------------------------------------------------------------------------
-- NOT: PostgreSQL'de CREATE OR REPLACE VIEW yalnızca mevcut sütunların
-- SONUNA yeni sütun eklemeye izin verir; sütun sırasını değiştirmek veya
-- araya sütun sokmak 42P16 hatası verir. Bu hotfix her iki view'ı da
-- yeniden yapılandırdığı için önce DROP, sonra CREATE yapıyoruz.
DROP VIEW IF EXISTS public.v_arac_secim;
CREATE VIEW public.v_arac_secim AS
SELECT
  a.id,
  a.firma_id,
  a.plaka,
  a.durum            AS arac_durumu,
  a.tip              AS arac_tipi,
  a.marka, a.model, a.yil,
  -- HOTFIX 2026-04-22b: Panelde kaybolan bakım/belge alanlarını geri getir
  a.muayene,
  a.sigorta,
  a.takograf,
  a.esleme,
  a.notlar,
  s.id               AS surucu_id,
  s.ad               AS sofor_ad,
  s.telefon_e164     AS sofor_tel,
  s.durum            AS sofor_durumu,
  (s.id IS NULL)     AS bos_mu,
  CASE
    WHEN s.id IS NULL THEN a.plaka || ' (boş)'
    ELSE a.plaka || ' — ' || s.ad
  END                AS gosterim_adi
FROM public.araclar a
LEFT JOIN public.suruculer s ON s.id = a.birincil_surucu_id;


-- -----------------------------------------------------------------------------
-- 2) v_surucu_dosyasi  —  bir sürücü = bir satır (çoklu araç desteği korunur)
-- -----------------------------------------------------------------------------
-- Sürücü birden fazla araçta (ör. çekici + dorse) birincil_mi=true ise eski
-- LEFT JOIN her araç için yeni bir satır üretiyordu. Yeni tasarımda ana satır
-- suruculer'den gelir; araç atamaları scalar sub-query'ler ile tekilleştirilir
-- ve ayrıca 'arac_plakalari' / 'arac_sayisi' alanlarında hepsi toplanır.
-- Sütun sırası değiştiği için DROP + CREATE (bkz. 42P16 notu yukarıda).
DROP VIEW IF EXISTS public.v_surucu_dosyasi;
CREATE VIEW public.v_surucu_dosyasi AS
SELECT
  s.id                 AS surucu_id,
  s.firma_id,
  s.auth_user_id,
  s.ad, s.soyad, s.telefon_e164, s.email, s.durum, s.avatar_url,
  s.dogum_tarihi, s.adres, s.acil_kontak_ad, s.acil_kontak_tel,

  -- "Birincil" (tekil) araç — UI'da eski "plaka" alanı ile uyum için
  -- plakaya göre en düşüğü deterministik olarak seçiyoruz.
  (SELECT a.id
     FROM public.arac_sofor_atamalari asa
     JOIN public.araclar a ON a.id = asa.arac_id
    WHERE asa.surucu_id = s.id
      AND asa.bitis     IS NULL
      AND asa.birincil_mi = true
    ORDER BY a.plaka
    LIMIT 1)                         AS arac_id,

  (SELECT a.plaka
     FROM public.arac_sofor_atamalari asa
     JOIN public.araclar a ON a.id = asa.arac_id
    WHERE asa.surucu_id = s.id
      AND asa.bitis     IS NULL
      AND asa.birincil_mi = true
    ORDER BY a.plaka
    LIMIT 1)                         AS arac_plaka,

  -- Aktif tüm atamaların plaka listesi (UI "tümünü göster" için)
  COALESCE((
    SELECT array_agg(a.plaka ORDER BY a.plaka)
      FROM public.arac_sofor_atamalari asa
      JOIN public.araclar a ON a.id = asa.arac_id
     WHERE asa.surucu_id = s.id
       AND asa.bitis     IS NULL
  ), ARRAY[]::text[])                AS arac_plakalari,

  COALESCE((
    SELECT count(*)::int
      FROM public.arac_sofor_atamalari asa
     WHERE asa.surucu_id = s.id
       AND asa.bitis     IS NULL
  ), 0)                              AS arac_sayisi,

  -- Belgeler JSON array (refactor'dan aynı)
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
  ), '[]'::jsonb)                    AS belgeler,

  (SELECT min(b.bitis_tarihi - current_date)
     FROM public.surucu_belgeleri b
    WHERE b.surucu_id = s.id
      AND b.bitis_tarihi IS NOT NULL) AS en_yakin_bitis_gun

FROM public.suruculer s;


-- -----------------------------------------------------------------------------
-- 3) sofor_davet_kabul_v2  —  OUT param isim çakışmasını gider
-- -----------------------------------------------------------------------------
-- OUT parametre isimleri değiştiği için CREATE OR REPLACE yetmez → DROP + CREATE.
DROP FUNCTION IF EXISTS public.sofor_davet_kabul_v2(text);

CREATE FUNCTION public.sofor_davet_kabul_v2(p_kod text)
RETURNS TABLE(out_surucu_id uuid, out_firma_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d           public.surucu_davetleri%ROWTYPE;
  v_uid       uuid := auth.uid();
  v_surucu_id uuid;
  v_firma_id  uuid;
BEGIN
  -- Davet kilidini al
  SELECT * INTO d
    FROM public.surucu_davetleri
   WHERE davet_kodu = p_kod
   FOR UPDATE;

  IF NOT FOUND                   THEN RAISE EXCEPTION 'Davet bulunamadı'; END IF;
  IF d.expires_at < now()        THEN RAISE EXCEPTION 'Davet süresi doldu'; END IF;
  IF d.kullanildi_at IS NOT NULL THEN RAISE EXCEPTION 'Davet kullanılmış'; END IF;

  -- Sürücü kaydını auth.users ile eşle
  -- HOTFIX 2026-04-22b: RETURNING hedefleri artık yerel değişkenler
  -- → firma_id sütunu ↔ OUT parametresi çakışması yok.
  UPDATE public.suruculer AS s
     SET auth_user_id = v_uid,
         durum        = 'aktif'
   WHERE s.id = d.surucu_id
   RETURNING s.id, s.firma_id
        INTO v_surucu_id, v_firma_id;

  UPDATE public.surucu_davetleri
     SET kullanildi_at    = now(),
         kullanan_user_id = v_uid,
         davet_durumu     = 'kabul'
   WHERE id = d.id;

  -- Davet sırasında araç seçildiyse atamayı aç
  IF d.arac_id IS NOT NULL THEN
    UPDATE public.arac_sofor_atamalari
       SET bitis = now()
     WHERE arac_id     = d.arac_id
       AND bitis       IS NULL
       AND birincil_mi = true;

    INSERT INTO public.arac_sofor_atamalari
      (arac_id, surucu_id, firma_id, birincil_mi, atayan)
    VALUES
      (d.arac_id, v_surucu_id, v_firma_id, true, d.davet_eden);
  END IF;

  out_surucu_id := v_surucu_id;
  out_firma_id  := v_firma_id;
  RETURN NEXT;
END;
$$;

-- RLS / PostgREST için yetkileri geri yükle
REVOKE ALL ON FUNCTION public.sofor_davet_kabul_v2(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sofor_davet_kabul_v2(text) TO authenticated;

-- View'ları DROP ettiğimiz için Supabase/PostgREST'in okuyabilmesi
-- adına SELECT yetkilerini açıkça veriyoruz (ana migration eskiden
-- default grants'a güveniyordu; DROP sonrası bunlar kaybolur).
GRANT SELECT ON public.v_arac_secim      TO anon, authenticated, service_role;
GRANT SELECT ON public.v_surucu_dosyasi  TO anon, authenticated, service_role;

COMMIT;

-- =============================================================================
-- Sonu. Bu dosya tek işlemde (BEGIN/COMMIT) çalıştırılır;
-- herhangi bir adım başarısız olursa tüm değişiklikler rollback edilir.
-- =============================================================================
