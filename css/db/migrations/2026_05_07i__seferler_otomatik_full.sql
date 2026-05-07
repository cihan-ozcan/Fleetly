-- =============================================================================
-- FLEETLY  —  2026-05-07i  —  Seferler otomasyonu + masraf entegrasyonu
-- =============================================================================
-- HEDEF:
--   "Teslim Edildi" durumuna geçen iş emrinden otomatik seferler kaydı oluştur.
--   Kaynak ne olursa olsun (web operasyon paneli / mobile şoför POD imzalama /
--   RPC) DB tarafında garantili olsun.
--
-- NEDEN DB TARAFI:
--   Şu ana kadar bu mantık `app-chunk-05.js opsAutoCreateSefer()` ile sadece
--   web frontend'inde çalışıyordu. Şoför mobile'dan POD imzalayıp teslim
--   ettiğinde JavaScript fonksiyonu çağrılmıyordu → sefer kaydı oluşmuyordu →
--   ana sayfa "Son Seferler" kartı mobile teslimleri görmüyordu.
--
-- KAPSAM:
--   1) seferler.ops_id UNIQUE index — idempotency
--   2) is_emirleri AFTER UPDATE trigger — durum 'Teslim Edildi'ye geçince INSERT
--      - Yakıt litre/tutar: yakit_girisleri'nden km aralığı SUM ile otomatik
--      - Ücret: 0 (manuel doldurma — CRM eşleştirmesi karmaşık, sahaya bırakıldı)
--   3) Geriye dönük backfill — mevcut Teslim Edildi iş emirleri için sefer yoksa oluştur
--   4) View v_sefer_detay — sefer + masraf toplamı + iş emri özeti
--      Web ve ana sayfa kartı bunu okur.
--
-- BAĞLI MİGRATİONlar:
--   2026_05_06e (masraflar.is_emri_id, sofor_user_id, durum kolonları)
--   2026_05_07e (sofor_user_id otomatik trigger — burada kullanmıyoruz ama tutarlı)
--   2026_05_07b (RLS — seferler için policy var)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) ops_id UNIQUE — aynı iş emrinden iki sefer oluşmasın
-- -----------------------------------------------------------------------------
-- WHERE clause: ops_id NULL olabilir (manuel sefer ekleme), bunlar UNIQUE check'e dahil değil
CREATE UNIQUE INDEX IF NOT EXISTS seferler_ops_id_uq
  ON public.seferler (ops_id) WHERE ops_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) Yakıt aralığı yardımcı fonksiyonu — km1..km2 arasında belirli aracın yakıt SUM
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_yakit_km_araligi(
  p_arac_id text,
  p_bas_km  numeric,
  p_bit_km  numeric
)
RETURNS TABLE(litre numeric, tutar numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(yg.litre), 0)::numeric           AS litre,
         COALESCE(SUM(yg.litre * COALESCE(yg.litre_fiyat, yg.fiyat, 0)), 0)::numeric AS tutar
    FROM public.yakit_girisleri yg
   WHERE yg.arac_id = p_arac_id
     AND p_bas_km IS NOT NULL AND p_bit_km IS NOT NULL
     AND p_bit_km > p_bas_km
     AND yg.km BETWEEN p_bas_km AND p_bit_km;
$$;

-- -----------------------------------------------------------------------------
-- 3) Otomatik sefer oluşturucu trigger fonksiyonu
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_isemri_otomatik_sefer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- RLS bypass: şoför kullanıcısı seferler INSERT edemeyebilir, trigger postgres rolüyle çalışır
SET search_path = public
AS $$
DECLARE
  v_km            numeric;
  v_yakit_litre   numeric;
  v_yakit_tutar   numeric;
  v_kalkis        text;
  v_varis         text;
  v_yuk           text;
  v_notlar        text;
  v_sefer_id      text;
  v_user_id       uuid;
  v_konteynerler  text;
BEGIN
  -- Sadece 'Teslim Edildi'ye GEÇİŞTE çalış (idempotency 1: durum değişimi)
  IF NEW.durum IS DISTINCT FROM 'Teslim Edildi' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.durum = 'Teslim Edildi' THEN
    -- Zaten 'Teslim Edildi'ydi (örn. operasyon başka bir alanı düzenledi) — skip
    RETURN NEW;
  END IF;

  -- Idempotency 2: bu iş emrinden zaten sefer oluşmuşsa skip
  -- (UNIQUE index zaten korur ama explicit check daha temiz log)
  IF EXISTS (SELECT 1 FROM public.seferler WHERE ops_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- ── KM ─────────────────────────────────────────
  -- Öncelik: bitis_km - baslangic_km. Yoksa NULL — frontend haversine fallback yapar.
  IF NEW.baslangic_km IS NOT NULL AND NEW.bitis_km IS NOT NULL
     AND NEW.bitis_km > NEW.baslangic_km THEN
    v_km := (NEW.bitis_km - NEW.baslangic_km)::numeric;
  ELSE
    v_km := NULL;
  END IF;

  -- ── YAKIT ──────────────────────────────────────
  -- arac_id (text) ile yakit_girisleri.arac_id eşleşmesi.
  -- is_emirleri.cekici_id varsa onu kullan (yeni şema), yoksa arac_plaka'dan araç bul.
  -- Pratikte arac_id kolonu yoksa skip. Önce cekici_id'yi dene.
  v_yakit_litre := NULL;
  v_yakit_tutar := NULL;

  IF v_km IS NOT NULL AND NEW.cekici_id IS NOT NULL THEN
    SELECT y.litre, y.tutar
      INTO v_yakit_litre, v_yakit_tutar
      FROM public.fn_yakit_km_araligi(NEW.cekici_id, NEW.baslangic_km, NEW.bitis_km) y;
    -- 0,0 dönerse NULL'a çevir (UI'da "—" gösterilebilsin)
    IF v_yakit_litre = 0 AND v_yakit_tutar = 0 THEN
      v_yakit_litre := NULL;
      v_yakit_tutar := NULL;
    END IF;
  END IF;

  -- arac_plaka üzerinden fallback — eski şema iş emirleri için
  IF v_yakit_litre IS NULL AND v_km IS NOT NULL AND NEW.arac_plaka IS NOT NULL THEN
    DECLARE
      v_arac_id text;
    BEGIN
      SELECT id INTO v_arac_id FROM public.araclar
       WHERE plaka = NEW.arac_plaka
         AND (NEW.firma_id IS NULL OR firma_id = NEW.firma_id)
       LIMIT 1;
      IF v_arac_id IS NOT NULL THEN
        SELECT y.litre, y.tutar
          INTO v_yakit_litre, v_yakit_tutar
          FROM public.fn_yakit_km_araligi(v_arac_id, NEW.baslangic_km, NEW.bitis_km) y;
        IF v_yakit_litre = 0 AND v_yakit_tutar = 0 THEN
          v_yakit_litre := NULL;
          v_yakit_tutar := NULL;
        END IF;
      END IF;
    END;
  END IF;

  -- ── KALKIŞ / VARIŞ ─────────────────────────────
  -- 3-nokta akışında final teslim noktası bos_donus (varsa) ya da teslim_yeri
  v_kalkis := COALESCE(NULLIF(NEW.yukle_yeri, ''), '—');
  v_varis  := COALESCE(NULLIF(NEW.bos_donus, ''),
                       NULLIF(NEW.teslim_yeri, ''),
                       '—');

  -- ── YÜK (konteyner · tip · müşteri) ────────────
  v_konteynerler := COALESCE(REPLACE(NEW.konteyner_no, E'\n', ', '), '');
  v_yuk := NULLIF(
    array_to_string(ARRAY[
      NULLIF(v_konteynerler, ''),
      NULLIF(NEW.kont_tip, ''),
      NULLIF(NEW.musteri_adi, '')
    ]::text[], ' · '), ''
  );

  -- ── NOT (operasyon özeti) ──────────────────────
  v_notlar := 'Ops #' || NEW.id::text;
  IF NEW.referans_no IS NOT NULL AND NEW.referans_no <> '' THEN
    v_notlar := v_notlar || ' · Ref: ' || NEW.referans_no;
  END IF;
  IF NEW.muhur_no IS NOT NULL AND NEW.muhur_no <> '' THEN
    v_notlar := v_notlar || ' · Mühür: ' || NEW.muhur_no;
  END IF;
  IF NEW.kont_durum IS NOT NULL AND NEW.kont_durum <> '' THEN
    v_notlar := v_notlar || ' · ' || NEW.kont_durum;
  END IF;

  -- ── user_id (NOT NULL constraint var) ──────────
  -- Tercih: sofor_user_id (şoför teslim ettiyse). Yoksa firma sahibi.
  v_user_id := NEW.sofor_user_id;
  IF v_user_id IS NULL THEN
    SELECT user_id INTO v_user_id
      FROM public.firma_kullanicilar
     WHERE firma_id = NEW.firma_id AND rol = 'sahip'
     LIMIT 1;
  END IF;
  IF v_user_id IS NULL THEN
    -- Son çare: firma sahibi de bulunamazsa current auth user (RPC çağrısında)
    v_user_id := auth.uid();
  END IF;
  IF v_user_id IS NULL THEN
    -- Yine de NULL ise sefer oluşturulamaz (NOT NULL constraint patlatır)
    RAISE WARNING '[trg_isemri_otomatik_sefer] user_id çözümlenemedi, iş emri %, sefer atlandı', NEW.id;
    RETURN NEW;
  END IF;

  -- ── SEFER ID ───────────────────────────────────
  v_sefer_id := 'AUTO-' || NEW.id::text || '-' || extract(epoch from now())::bigint::text;

  -- ── INSERT ─────────────────────────────────────
  INSERT INTO public.seferler (
    id, user_id, firma_id, surucu_id,
    tarih, arac_id, plaka, sofor,
    kalkis, varis,
    km, baslangic_km, bitis_km,
    yakit_litre, yakit_tutar,
    yuk, ucret, notlar,
    ops_id
  ) VALUES (
    v_sefer_id, v_user_id, NEW.firma_id, NEW.surucu_id,
    COALESCE(NEW.teslim_zamani::date, CURRENT_DATE),
    NULL,  -- arac_id text → opsiyonel; UI cloud'dan plakaya göre map'liyor
    NEW.arac_plaka, NEW.sofor,
    v_kalkis, v_varis,
    v_km, NEW.baslangic_km, NEW.bitis_km,
    v_yakit_litre, v_yakit_tutar,
    v_yuk, 0,                    -- ücret manuel girilecek
    v_notlar,
    NEW.id
  )
  ON CONFLICT (ops_id) WHERE ops_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS isemri_otomatik_sefer ON public.is_emirleri;
CREATE TRIGGER isemri_otomatik_sefer
AFTER INSERT OR UPDATE OF durum ON public.is_emirleri
FOR EACH ROW EXECUTE FUNCTION public.trg_isemri_otomatik_sefer();

-- -----------------------------------------------------------------------------
-- 4) Geriye dönük backfill — mevcut Teslim Edildi iş emirleri için sefer yoksa oluştur
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r        RECORD;
  v_count  int := 0;
BEGIN
  FOR r IN
    SELECT ie.*
      FROM public.is_emirleri ie
     WHERE ie.durum = 'Teslim Edildi'
       AND NOT EXISTS (SELECT 1 FROM public.seferler s WHERE s.ops_id = ie.id)
  LOOP
    -- Trigger fonksiyonunu manuel çağır (NEW context simulate ederek)
    -- En basit: UPDATE durum=durum yaparak trigger'ı tetikle. Ama OLD.durum='Teslim Edildi' check
    -- ettiğimiz için trigger skip eder (kasıtlı: tekrar tetiklemeyi önler).
    -- Alternatif: aynı INSERT logic'i burada inline.
    DECLARE
      v_km           numeric;
      v_yakit_litre  numeric;
      v_yakit_tutar  numeric;
      v_user_id      uuid;
      v_sefer_id     text;
      v_kalkis       text;
      v_varis        text;
      v_yuk          text;
      v_notlar       text;
      v_arac_id      text;
    BEGIN
      v_km := CASE WHEN r.baslangic_km IS NOT NULL AND r.bitis_km IS NOT NULL
                    AND r.bitis_km > r.baslangic_km
                   THEN (r.bitis_km - r.baslangic_km)::numeric ELSE NULL END;

      v_yakit_litre := NULL; v_yakit_tutar := NULL;
      IF v_km IS NOT NULL THEN
        v_arac_id := r.cekici_id;
        IF v_arac_id IS NULL AND r.arac_plaka IS NOT NULL THEN
          SELECT id INTO v_arac_id FROM public.araclar
           WHERE plaka = r.arac_plaka
             AND (r.firma_id IS NULL OR firma_id = r.firma_id)
           LIMIT 1;
        END IF;
        IF v_arac_id IS NOT NULL THEN
          SELECT y.litre, y.tutar
            INTO v_yakit_litre, v_yakit_tutar
            FROM public.fn_yakit_km_araligi(v_arac_id, r.baslangic_km, r.bitis_km) y;
          IF v_yakit_litre = 0 AND v_yakit_tutar = 0 THEN
            v_yakit_litre := NULL; v_yakit_tutar := NULL;
          END IF;
        END IF;
      END IF;

      v_kalkis := COALESCE(NULLIF(r.yukle_yeri, ''), '—');
      v_varis  := COALESCE(NULLIF(r.bos_donus, ''), NULLIF(r.teslim_yeri, ''), '—');
      v_yuk := NULLIF(
        array_to_string(ARRAY[
          NULLIF(REPLACE(COALESCE(r.konteyner_no,''), E'\n', ', '), ''),
          NULLIF(r.kont_tip, ''),
          NULLIF(r.musteri_adi, '')
        ]::text[], ' · '), ''
      );
      v_notlar := 'Ops #' || r.id::text;
      IF r.referans_no IS NOT NULL AND r.referans_no <> '' THEN
        v_notlar := v_notlar || ' · Ref: ' || r.referans_no;
      END IF;
      IF r.muhur_no IS NOT NULL AND r.muhur_no <> '' THEN
        v_notlar := v_notlar || ' · Mühür: ' || r.muhur_no;
      END IF;
      IF r.kont_durum IS NOT NULL AND r.kont_durum <> '' THEN
        v_notlar := v_notlar || ' · ' || r.kont_durum;
      END IF;

      v_user_id := r.sofor_user_id;
      IF v_user_id IS NULL THEN
        SELECT user_id INTO v_user_id FROM public.firma_kullanicilar
         WHERE firma_id = r.firma_id AND rol = 'sahip' LIMIT 1;
      END IF;
      IF v_user_id IS NULL THEN
        CONTINUE;  -- bu iş emrini atla
      END IF;

      v_sefer_id := 'BACKFILL-' || r.id::text;

      INSERT INTO public.seferler (
        id, user_id, firma_id, surucu_id, tarih,
        plaka, sofor, kalkis, varis,
        km, baslangic_km, bitis_km,
        yakit_litre, yakit_tutar, yuk, ucret, notlar, ops_id
      ) VALUES (
        v_sefer_id, v_user_id, r.firma_id, r.surucu_id,
        COALESCE(r.teslim_zamani::date, CURRENT_DATE),
        r.arac_plaka, r.sofor, v_kalkis, v_varis,
        v_km, r.baslangic_km, r.bitis_km,
        v_yakit_litre, v_yakit_tutar, v_yuk, 0, v_notlar, r.id
      )
      ON CONFLICT (ops_id) WHERE ops_id IS NOT NULL DO NOTHING;

      v_count := v_count + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill tamamlandı: % sefer oluşturuldu', v_count;
END $$;

-- -----------------------------------------------------------------------------
-- 5) View: v_sefer_detay — sefer + masraf toplamı + iş emri özeti
-- -----------------------------------------------------------------------------
-- Web ve ana sayfa kartı bu view'u okur. Masraf toplamı LIVE — masraf eklendiğinde
-- bir sonraki SELECT'te toplam güncel gelir, cache invalidation derdi yok.
-- Sadece 'onayli' veya 'odendi' masraflar dahil — beklemede/red sayılmaz.
DROP VIEW IF EXISTS public.v_sefer_detay CASCADE;
CREATE VIEW public.v_sefer_detay
WITH (security_invoker = true)  -- RLS çağıran kullanıcının izinleriyle uygulanır
AS
SELECT
  s.id,
  s.user_id,
  s.firma_id,
  s.surucu_id,
  s.tarih,
  s.arac_id,
  s.plaka,
  s.sofor,
  s.kalkis,
  s.varis,
  s.km,
  s.baslangic_km,
  s.bitis_km,
  s.yakit_litre,
  s.yakit_tutar,
  s.yuk,
  s.ucret,
  s.notlar,
  s.ops_id,
  s.created_at,
  -- Bağlı masraf toplamı (sadece onayli/odendi — beklemede sayılmaz)
  COALESCE((
    SELECT SUM(m.tutar)
      FROM public.masraflar m
     WHERE m.is_emri_id = s.ops_id
       AND m.durum IN ('onayli','odendi')
  ), 0)::numeric AS masraf_toplam_tl,
  -- Bağlı masraf adeti (UI'da rozet için)
  COALESCE((
    SELECT count(*)::int
      FROM public.masraflar m
     WHERE m.is_emri_id = s.ops_id
       AND m.durum IN ('onayli','odendi')
  ), 0) AS masraf_adet,
  -- İş emri özeti (operasyon paneline link için kullanışlı)
  ie.referans_no,
  ie.musteri_adi,
  ie.firma_isemri_no
  FROM public.seferler s
  LEFT JOIN public.is_emirleri ie ON ie.id = s.ops_id;

GRANT SELECT ON public.v_sefer_detay TO authenticated;

COMMENT ON VIEW public.v_sefer_detay IS
  'Seferler + bağlı masraf toplamı + iş emri özeti. Web seferler ekranı ve ana sayfa Son Seferler kartı bu view''u okur.';

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Trigger çalışıyor mu (test):
--    UPDATE is_emirleri SET durum='Teslim Edildi' WHERE id=<test_id>;
--    SELECT * FROM seferler WHERE ops_id=<test_id>;  -- 1 satır olmalı, yakit_litre/tutar dolu (yakıt girişi varsa)
--
-- 2) Idempotency:
--    UPDATE is_emirleri SET durum='Teslim Edildi' WHERE id=<test_id>;  -- 2. kez
--    SELECT count(*) FROM seferler WHERE ops_id=<test_id>;  -- 1 (artmadı)
--
-- 3) Backfill:
--    SELECT count(*) FROM is_emirleri WHERE durum='Teslim Edildi'
--      AND NOT EXISTS (SELECT 1 FROM seferler s WHERE s.ops_id=is_emirleri.id);
--    İdeal: 0 (hepsi backfill edildi). >0 ise sofor_user_id veya firma sahibi bulunamamış.
--
-- 4) View'da masraf toplamı:
--    SELECT id, ops_id, masraf_toplam_tl, masraf_adet FROM v_sefer_detay LIMIT 5;
--    Bağlı masraf varsa toplam dolu görünmeli.
-- =============================================================================
