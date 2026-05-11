-- =============================================================================
-- FLEETLY  —  2026-05-11c  —  İLK Platform Admin (Cihan) Ekleme — ÖRNEK
-- =============================================================================
-- BU MIGRATION REPOYA EKLENMEZ — sadece şablon. Kendi e-postanı koyup Supabase
-- Dashboard → SQL Editor'da MANUEL çalıştır.
--
-- AÇIK:
--   2026_05_11a ile platform_adminler tablosu kuruldu. Ancak ilk admin'i
--   eklemek "chicken-and-egg" sorunu: RPC'ler "platform_admin olmalı" kontrolü
--   yapıyor. Bu yüzden ilk admin direkt INSERT ile, Dashboard'da çalıştırılır.
--
-- KULLANIM:
--   1. Aşağıdaki email'i kendi adminliğin için kullanacağın hesabınkiyle değiştir.
--   2. Bu kullanıcının daha önce auth.users'a kayıt olmuş olması gerek (Fleetly'de
--      normal kayıt yapmış olmalı).
--   3. Supabase Dashboard → SQL Editor → bu SQL'i yapıştır → Run.
--   4. Doğrula: SELECT * FROM platform_adminler_listele();
-- =============================================================================

INSERT INTO public.platform_adminler(user_id, ad_soyad, notlar, ekleyen_user_id)
VALUES (
  -- KENDI EMAIL'IN — DEĞİŞTİR:
  (SELECT id FROM auth.users WHERE email = 'cihan@fleetly.fit' LIMIT 1),
  'Cihan Özcan',
  'Platform sahibi — ilk admin, 2026-05-11',
  -- Ekleyen aynı kişi (self-bootstrap):
  (SELECT id FROM auth.users WHERE email = 'cihan@fleetly.fit' LIMIT 1)
)
ON CONFLICT (user_id) DO UPDATE
  SET aktif = true,
      ad_soyad = EXCLUDED.ad_soyad,
      notlar   = EXCLUDED.notlar;

-- Doğrulama (kontrol için çalıştır):
-- SELECT _is_platform_admin();                       -- senin oturumunda true
-- SELECT * FROM platform_adminler;                   -- direct tablo
-- SELECT * FROM platform_adminler_listele();         -- RPC
-- =============================================================================
