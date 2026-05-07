-- =============================================================================
-- FLEETLY  —  2026-05-07h  —  belge_turleri seed + RLS policy
-- =============================================================================
-- SORUN:
--   Mobile DocumentsScreen'de "Belge tanımı bulunamadı" uyarısı görünüyor.
--   Web'de operasyon ehliyet bilgisini güncelliyor (surucu_belgeleri'ne yazıyor)
--   ama şoför mobile DocumentRepositoryImpl.listRows() sürücüye gösterilen
--   belgeleri ÖNCE belge_turleri tablosundan iterate ediyor:
--
--     types = listTypes()               → belge_turleri'nden tüm türler
--     docs  = listMyDocuments(driverId) → surucu_belgeleri'nden onaylı kayıtlar
--     return types.map { t ->           ← TÜRLER FOREACH
--       BelgeRow(turu=t, belge=docs.find{...}, onayBekleyen=...)
--     }
--
--   Eğer types boşsa → list boş → UI "Belge tanımı bulunamadı" gösterir.
--
-- KÖK NEDEN ADAYI 1: belge_turleri tablosu BOŞ.
--   supabase_setup_v2.sql tabloyu CREATE eder ama INSERT yok (initial seed
--   sadece 2026_04_22__surucu_refactor.sql'de — o migration uygulanmadıysa
--   ya da yarım uygulandıysa tablo boş kalmış).
--
-- KÖK NEDEN ADAYI 2: RLS açıldı ama SELECT policy yok → default deny.
--   `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` çalıştırılmış ama policy
--   eklenmemişse, authenticated user dahil hiç kimse okuyamaz.
--
-- ÇÖZÜM:
--   1) ON CONFLICT DO NOTHING ile 6 standart belge türünü seed et (idempotent
--      — mevcut veriye dokunmaz)
--   2) RLS açıkken policy yoksa SELECT'i tüm authenticated user'lara aç
--      (belge_turleri global sözlük tablosu, gizli bilgi yok)
--   3) INSERT/UPDATE/DELETE: kapalı kalır (default deny) — admin DB'den
--      manuel ekler, rastgele kullanıcı tanım eklemesin
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Standart belge türlerini seed et (idempotent)
-- -----------------------------------------------------------------------------
INSERT INTO public.belge_turleri (kod, ad, uyari_gun_varsayilan, sofor_duzenleyebilir, gerekli_mi)
VALUES
  ('ehliyet',  'Sürücü Belgesi',   30, true,  true),
  ('src',      'SRC Belgesi',      30, true,  true),
  ('psiko',    'Psikoteknik',      30, true,  false),
  ('saglik',   'Sağlık Raporu',    30, true,  false),
  ('takograf', 'Takograf Kartı',   30, true,  false),
  ('sigorta',  'Ferdi Kaza Sig.',  30, false, false)
ON CONFLICT (kod) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2) RLS — global sözlük, herkese SELECT açık
-- -----------------------------------------------------------------------------
-- ENABLE idempotent değildir ama IF EXISTS check ile sarıyoruz.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='belge_turleri') THEN
    EXECUTE 'ALTER TABLE public.belge_turleri ENABLE ROW LEVEL SECURITY';

    -- SELECT herkese açık — bu sözlük tablosu, gizli bilgi yok.
    -- Mobile (sürücü) ve web (ofis) ikisi de okuyabilir.
    EXECUTE 'DROP POLICY IF EXISTS belge_turleri_v2_select ON public.belge_turleri';
    EXECUTE $POL$
      CREATE POLICY belge_turleri_v2_select ON public.belge_turleri
        FOR SELECT TO authenticated
        USING (true)
    $POL$;

    -- INSERT/UPDATE/DELETE: policy yok → default deny.
    -- Admin DB konsolundan manuel ekler. Rastgele kullanıcı tür uyduramaz.
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Tabloda kayıt var mı:
--    SELECT count(*) FROM belge_turleri;        -- en az 6 olmalı
--    SELECT * FROM belge_turleri ORDER BY kod;
--
-- 2) RLS policy aktif mi:
--    SELECT tablename, rowsecurity FROM pg_tables
--     WHERE schemaname='public' AND tablename='belge_turleri';  -- rowsecurity=true
--    SELECT policyname FROM pg_policies WHERE tablename='belge_turleri';
--
-- 3) Authenticated user okuyabilir mi:
--    SET request.jwt.claim.sub = '<herhangi_bir_user_id>';
--    SELECT count(*) FROM belge_turleri;        -- 6 dönmeli
--
-- 4) Mobile testi:
--    Şoför app'te Belgeler ekranını aç → 6 satırlık liste gözükmeli
--    (her belge türü için "Belge yok / Eklendi" durumuyla)
--    Operasyondan eklediğiniz ehliyet bitiş tarihi 'ehliyet' satırında
--    görünmeli ('onayli' durumda olduğu için).
-- =============================================================================
