-- ============================================================
-- FLEETLY — ABONELIK & DENEME SÜRESİ MİGRASYONU
-- Supabase SQL Editor'da çalıştırın
-- ============================================================

-- 1. ABONELIK PLANLARI tablosu
CREATE TABLE IF NOT EXISTS public.abonelik_planlari (
  id          text NOT NULL,
  ad          text NOT NULL,           -- 'aylik' | 'yillik'
  fiyat       numeric NOT NULL,        -- ₺ cinsinden
  sure_gun    integer NOT NULL,        -- 30 veya 365
  aciklama    text,
  aktif       boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT abonelik_planlari_pkey PRIMARY KEY (id)
);

-- Varsayılan planları ekle (fiyatları kendinize göre düzenleyin)
INSERT INTO public.abonelik_planlari (id, ad, fiyat, sure_gun, aciklama) VALUES
  ('aylik',  'Aylık Plan',  990,  30,  'Her ay yenilenebilir. İstediğiniz zaman iptal.'),
  ('yillik', 'Yıllık Plan', 8900, 365, '%25 tasarruf. Yıllık tek ödeme.')
ON CONFLICT (id) DO NOTHING;


-- 2. FİRMALAR tablosuna abonelik sütunları ekle
ALTER TABLE public.firmalar
  ADD COLUMN IF NOT EXISTS deneme_bitis    timestamptz,   -- deneme bitiş tarihi
  ADD COLUMN IF NOT EXISTS abonelik_durumu text DEFAULT 'deneme',
  -- 'deneme' | 'aktif' | 'suresi_dolmus' | 'iptal'
  ADD COLUMN IF NOT EXISTS abonelik_plani  text,          -- 'aylik' | 'yillik'
  ADD COLUMN IF NOT EXISTS abonelik_bitis  timestamptz,   -- ödeme bitiş tarihi
  ADD COLUMN IF NOT EXISTS odeme_ref       text,          -- ödeme sağlayıcı referansı
  ADD COLUMN IF NOT EXISTS max_arac        integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS iletisim_email  text,          -- fatura e-postası
  ADD COLUMN IF NOT EXISTS telefon         text,
  ADD COLUMN IF NOT EXISTS vergi_no        text;


-- 3. ÖDEME GEÇMİŞİ tablosu
CREATE TABLE IF NOT EXISTS public.odeme_gecmisi (
  id              text NOT NULL DEFAULT gen_random_uuid()::text,
  firma_id        uuid NOT NULL,
  plan_id         text NOT NULL,
  tutar           numeric NOT NULL,
  para_birimi     text DEFAULT 'TRY',
  durum           text DEFAULT 'bekliyor',  -- 'bekliyor' | 'tamamlandi' | 'basarisiz' | 'iade'
  odeme_ref       text,                     -- harici ödeme referansı (İyzico, Stripe vb.)
  baslangic       timestamptz NOT NULL DEFAULT now(),
  bitis           timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now(),
  notlar          text,
  CONSTRAINT odeme_gecmisi_pkey PRIMARY KEY (id),
  CONSTRAINT odeme_gecmisi_firma_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id),
  CONSTRAINT odeme_gecmisi_plan_fkey  FOREIGN KEY (plan_id)  REFERENCES public.abonelik_planlari(id)
);


-- 4. KAYIT LOG tablosu (audit trail)
CREATE TABLE IF NOT EXISTS public.kayit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firma_id   uuid,
  user_id    uuid,
  olay       text NOT NULL,   -- 'kayit', 'giris', 'abonelik_aktif', 'deneme_doldu' vb.
  detay      jsonb,
  ip_adresi  text,
  ts         timestamptz DEFAULT now()
);


-- 5. RLS POLİTİKALARI

-- abonelik_planlari: herkese okuma
ALTER TABLE public.abonelik_planlari ENABLE ROW LEVEL SECURITY;
CREATE POLICY "herkes okuyabilir" ON public.abonelik_planlari
  FOR SELECT USING (true);

-- odeme_gecmisi: sadece kendi firması
ALTER TABLE public.odeme_gecmisi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firma uyesi okur" ON public.odeme_gecmisi
  FOR SELECT USING (
    firma_id IN (
      SELECT firma_id FROM public.firma_kullanicilar WHERE user_id = auth.uid()
    )
  );

-- kayit_log: admin dışı okuma yok
ALTER TABLE public.kayit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sadece servis rolü" ON public.kayit_log
  USING (false);  -- client tarafından okunamaz


-- 6. ABONELIK DURUMU KONTROL FONKSİYONU
-- Bu fonksiyon, uygulamanın auth sonrasında çağırabileceği RPC'dir
CREATE OR REPLACE FUNCTION public.firma_abonelik_durumu(p_firma_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_firma public.firmalar;
  v_durum text;
  v_kalan_gun integer;
  v_mesaj text;
BEGIN
  SELECT * INTO v_firma FROM public.firmalar WHERE id = p_firma_id;

  IF v_firma IS NULL THEN
    RETURN jsonb_build_object('durum', 'hata', 'mesaj', 'Firma bulunamadı');
  END IF;

  -- Aktif abonelik var mı?
  IF v_firma.abonelik_bitis IS NOT NULL AND v_firma.abonelik_bitis > now() THEN
    v_kalan_gun := EXTRACT(day FROM (v_firma.abonelik_bitis - now()))::integer;
    RETURN jsonb_build_object(
      'durum', 'aktif',
      'plan', v_firma.abonelik_plani,
      'bitis', v_firma.abonelik_bitis,
      'kalan_gun', v_kalan_gun,
      'mesaj', 'Abonelik aktif'
    );
  END IF;

  -- Deneme süresi devam ediyor mu?
  IF v_firma.deneme_bitis IS NOT NULL AND v_firma.deneme_bitis > now() THEN
    v_kalan_gun := EXTRACT(day FROM (v_firma.deneme_bitis - now()))::integer;
    RETURN jsonb_build_object(
      'durum', 'deneme',
      'bitis', v_firma.deneme_bitis,
      'kalan_gun', v_kalan_gun,
      'mesaj', 'Ücretsiz deneme süresi devam ediyor'
    );
  END IF;

  -- Deneme veya abonelik süresi dolmuş
  RETURN jsonb_build_object(
    'durum', 'suresi_dolmus',
    'kalan_gun', 0,
    'mesaj', 'Deneme süreniz dolmuştur. Lütfen bir plan seçin.'
  );
END;
$$;


-- 7. YENİ FİRMA KAYIT FONKSİYONU (register.html tarafından çağrılır)
CREATE OR REPLACE FUNCTION public.firma_kayit_et(
  p_firma_adi   text,
  p_email       text,
  p_telefon     text DEFAULT NULL,
  p_vergi_no    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id  uuid;
  v_firma_id uuid;
  v_deneme_bitis timestamptz;
BEGIN
  -- Mevcut oturum kullanıcısı
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('basarili', false, 'hata', 'Oturum bulunamadı');
  END IF;

  -- Kullanıcı zaten bir firmaya bağlı mı?
  IF EXISTS (SELECT 1 FROM public.firma_kullanicilar WHERE user_id = v_user_id) THEN
    RETURN jsonb_build_object('basarili', false, 'hata', 'Bu kullanıcı zaten bir firmaya kayıtlı');
  END IF;

  -- 7 günlük deneme bitiş tarihi
  v_deneme_bitis := now() + interval '7 days';

  -- Firma oluştur
  INSERT INTO public.firmalar (ad, deneme_bitis, abonelik_durumu, iletisim_email, telefon, vergi_no)
  VALUES (p_firma_adi, v_deneme_bitis, 'deneme', p_email, p_telefon, p_vergi_no)
  RETURNING id INTO v_firma_id;

  -- Kullanıcıyı firmaya "admin" olarak bağla
  INSERT INTO public.firma_kullanicilar (user_id, firma_id, rol)
  VALUES (v_user_id, v_firma_id, 'admin');

  -- Kayıt logla
  INSERT INTO public.kayit_log (firma_id, user_id, olay, detay)
  VALUES (v_firma_id, v_user_id, 'yeni_kayit', jsonb_build_object(
    'firma_adi', p_firma_adi,
    'email', p_email,
    'deneme_bitis', v_deneme_bitis
  ));

  RETURN jsonb_build_object(
    'basarili', true,
    'firma_id', v_firma_id,
    'deneme_bitis', v_deneme_bitis
  );
END;
$$;


-- 8. ABONELİK AKTİF ETME FONKSİYONU
-- Ödeme doğrulandıktan sonra backend/webhook tarafından çağrılır
CREATE OR REPLACE FUNCTION public.abonelik_aktif_et(
  p_firma_id  uuid,
  p_plan_id   text,
  p_odeme_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan    public.abonelik_planlari;
  v_bitis   timestamptz;
  v_mevcut  timestamptz;
BEGIN
  SELECT * INTO v_plan FROM public.abonelik_planlari WHERE id = p_plan_id AND aktif = true;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('basarili', false, 'hata', 'Plan bulunamadı');
  END IF;

  -- Mevcut abonelik varsa üzerine ekle, yoksa bugünden başlat
  SELECT abonelik_bitis INTO v_mevcut FROM public.firmalar WHERE id = p_firma_id;
  IF v_mevcut IS NULL OR v_mevcut < now() THEN
    v_bitis := now() + (v_plan.sure_gun || ' days')::interval;
  ELSE
    v_bitis := v_mevcut + (v_plan.sure_gun || ' days')::interval;
  END IF;

  -- Firmayı güncelle
  UPDATE public.firmalar SET
    abonelik_durumu = 'aktif',
    abonelik_plani  = p_plan_id,
    abonelik_bitis  = v_bitis,
    odeme_ref       = p_odeme_ref
  WHERE id = p_firma_id;

  -- Ödeme kaydı
  INSERT INTO public.odeme_gecmisi (firma_id, plan_id, tutar, durum, bitis, odeme_ref)
  SELECT p_firma_id, p_plan_id, fiyat, 'tamamlandi', v_bitis, p_odeme_ref
  FROM public.abonelik_planlari WHERE id = p_plan_id;

  -- Log
  INSERT INTO public.kayit_log (firma_id, olay, detay)
  VALUES (p_firma_id, 'abonelik_aktif', jsonb_build_object(
    'plan', p_plan_id,
    'bitis', v_bitis,
    'odeme_ref', p_odeme_ref
  ));

  RETURN jsonb_build_object('basarili', true, 'bitis', v_bitis);
END;
$$;


-- 9. MEVCUT FİRMALAR için deneme süresi retroaktif güncelle (zaten kaydolmuşlar için)
-- Eğer mevcut firmalar varsa onlara da deneme süresi ver:
UPDATE public.firmalar
SET
  deneme_bitis    = now() + interval '7 days',
  abonelik_durumu = 'deneme'
WHERE deneme_bitis IS NULL AND abonelik_durumu IS NULL;


-- ============================================================
-- TAMAMLANDI
-- Sonraki adım: register.html ve index.html değişikliklerini uygulayın
-- ============================================================
