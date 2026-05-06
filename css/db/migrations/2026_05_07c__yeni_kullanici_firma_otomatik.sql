-- =============================================================================
-- FLEETLY  —  2026-05-07c  —  Yeni kullanıcı için otomatik firma + sahip rolü
-- =============================================================================
-- Mevcut sorun: Yeni hesap açan kullanıcı auth.users'a ekleniyor ama firmalar
-- ve firma_kullanicilar tablolarına otomatik kayıt OLUŞMUYOR. Sonuç:
--   • Kullanıcı login olabiliyor ama firma_id null
--   • currentFirmaId hep null
--   • "Firma bulunamadı" hatası, RLS'siz iken başka firma verileri sızıyordu
--
-- JS tarafı `firma_kayit_et` RPC'sini çağırıyordu ama RPC backend'de yoktu.
-- Bu migration:
--   1) firma_kayit_et RPC'si — frontend signup formundan çağrılır (firma adı,
--      telefon, vergi no kullanıcı tarafından gönderilir)
--   2) auth.users AFTER INSERT trigger'ı — backstop güvencesi: RPC çağrılmazsa
--      bile (Dashboard signup, magic link vs.) yeni kullanıcıya otomatik firma
--      yaratılır + sahip rolü atanır
--
-- Davet kabul akışıyla çakışma engellenir: sürücü email'leri (@driver.fleetly.local)
-- trigger tarafından ATLANIR — onlar suruculer.auth_user_id ile bağlanır.
--
-- Bağımlılık: 2026_05_07b__rls_emergency_fix.sql (RLS açık olmalı)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) RPC: firma_kayit_et — frontend signup formundan açıkça çağrılabilir
-- -----------------------------------------------------------------------------
-- Kullanıcı sayfada email + password + firma_adi + telefon + vergi_no girer.
-- Auth.signUp() sonrası bu RPC çağrılır, bilinen firma bilgileriyle kayıt yapılır.
-- Trigger zaten default firma yaratmış olabilir → bu RPC mevcudu GÜNCELLER veya
-- yoksa yeni yaratır (idempotent).
--
-- NOT: Eski versiyon farklı return type'la (muhtemelen void) tanımlı olabilir;
-- CREATE OR REPLACE return type değişimine izin vermez → önce DROP.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig FROM pg_proc
     WHERE proname = 'firma_kayit_et' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.firma_kayit_et(
  p_firma_adi text,
  p_email     text DEFAULT NULL,
  p_telefon   text DEFAULT NULL,
  p_vergi_no  text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_firma_id uuid;
  v_ad text := COALESCE(NULLIF(trim(p_firma_adi), ''), 'Yeni Firma');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Oturum yok' USING ERRCODE = '42501';
  END IF;

  -- Mevcut firma kaydı var mı?
  SELECT firma_id INTO v_firma_id
    FROM public.firma_kullanicilar
    WHERE user_id = v_uid AND rol = 'sahip'
    LIMIT 1;

  IF v_firma_id IS NOT NULL THEN
    -- Var — adı güncelle (kullanıcının açıkça verdiği değer kullanılır)
    UPDATE public.firmalar
       SET ad              = v_ad,
           iletisim_email  = COALESCE(p_email,    iletisim_email),
           iletisim_tel    = COALESCE(p_telefon,  iletisim_tel),
           vergi_no        = COALESCE(p_vergi_no, vergi_no)
     WHERE id = v_firma_id;
    RETURN v_firma_id;
  END IF;

  -- Yok — yeni firma + sahip rolü oluştur (14 gün deneme)
  INSERT INTO public.firmalar (ad, iletisim_email, iletisim_tel, vergi_no,
                                abonelik_durumu, deneme_bitis)
  VALUES (v_ad, p_email, p_telefon, p_vergi_no,
          'deneme', now() + interval '14 days')
  RETURNING id INTO v_firma_id;

  INSERT INTO public.firma_kullanicilar (user_id, firma_id, rol)
  VALUES (v_uid, v_firma_id, 'sahip')
  ON CONFLICT DO NOTHING;

  RETURN v_firma_id;
END $$;

GRANT EXECUTE ON FUNCTION public.firma_kayit_et(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.firma_kayit_et IS
  'Yeni firma kaydı (idempotent). auth.uid() zaten sahip rolüyle bir firmaya
   bağlıysa o firmanın bilgilerini günceller, aksi halde yeni firma + üyelik yaratır.';

-- -----------------------------------------------------------------------------
-- 2) auth.users TRIGGER — KALDIRILDI (Supabase Cloud kısıtlaması)
-- -----------------------------------------------------------------------------
-- NOT: Supabase Cloud'da auth.users tablosu auth_admin'e ait — public role
-- (postgres) trigger ekleyemez ("must be owner of relation users" hatası).
--
-- Bunun yerine: frontend `firma_kayit_et` RPC'sini her login sonrası çağırıyor
-- (app-chunk-02.js → checkSubscription içinde currentFirmaId boşsa otomatik
-- çağrılır). Bu yeterli — geriye dönük temizlik aşağıda yapılıyor.

-- -----------------------------------------------------------------------------
-- 3) GERİYE DÖNÜK: Henüz firmasız olan auth.users kullanıcılarını bağla
-- -----------------------------------------------------------------------------
-- (Sizin yeni açtığınız test hesabı dahil — manuel SQL çalıştırmanız gerekmesin.)
DO $$
DECLARE
  r RECORD;
  v_firma_id uuid;
  v_firma_adi text;
  v_email_local text;
BEGIN
  FOR r IN
    SELECT u.id, u.email, u.raw_user_meta_data
      FROM auth.users u
      LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
     WHERE fk.user_id IS NULL                                      -- bağsız
       AND (u.email IS NULL OR u.email NOT LIKE '%@driver.fleetly.local')   -- sürücü değil
       AND NOT EXISTS (SELECT 1 FROM public.suruculer s WHERE s.auth_user_id = u.id)
  LOOP
    v_firma_adi := NULLIF(trim(COALESCE(r.raw_user_meta_data->>'firma_adi', '')), '');
    IF v_firma_adi IS NULL THEN
      v_email_local := split_part(COALESCE(r.email, ''), '@', 1);
      v_firma_adi := CASE
        WHEN v_email_local <> '' THEN initcap(v_email_local) || ' Lojistik'
        ELSE 'Yeni Firma'
      END;
    END IF;

    INSERT INTO public.firmalar (ad, iletisim_email, abonelik_durumu, deneme_bitis)
    VALUES (v_firma_adi, r.email, 'deneme', now() + interval '14 days')
    RETURNING id INTO v_firma_id;

    INSERT INTO public.firma_kullanicilar (user_id, firma_id, rol)
    VALUES (r.id, v_firma_id, 'sahip')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Bağsız kullanıcı bağlandı: % → firma %', r.email, v_firma_id;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) RPC tanımlı mı:
--    SELECT proname FROM pg_proc WHERE proname = 'firma_kayit_et';
--
-- 2) Tüm kullanıcılar firma'ya bağlı mı (sürücüler hariç):
--    SELECT u.email, fk.firma_id, fk.rol
--      FROM auth.users u
--      LEFT JOIN public.firma_kullanicilar fk ON fk.user_id = u.id
--     WHERE u.email NOT LIKE '%@driver.fleetly.local'
--     ORDER BY u.created_at DESC;
--    Hepsinde firma_id dolu olmalı (geriye dönük DO bloğu bağlamış olmalı).
--
-- 3) Yeni signup testi:
--    Site'de yeni hesap aç → kullanıcı login olur olmaz checkSubscription
--    firma_kayit_et çağırır → currentFirmaId dolu olmalı, davet çalışmalı.
-- =============================================================================
