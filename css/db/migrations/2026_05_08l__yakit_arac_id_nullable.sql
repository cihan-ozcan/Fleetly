-- 2026-05-08l — yakit_girisleri.arac_id nullable
--
-- KÖK SORUN:
--   Şoför mobil yakıt fişi bildirirken (durum='beklemede') aracı bilmiyor —
--   operasyon foto'dan okuyup detayları doldururken doğru aracı atayacak.
--   Ama mevcut tablo:
--     arac_id text NOT NULL  +  FK references araclar(id)
--   Mobile boş string '' göndermek zorunda kalıyor (NOT NULL ihlal etmemek için)
--   ve bu da FK ihlal ediyor: araclar tablosunda id='' yok →
--     "insert or update on table 'yakit_girisleri' violates foreign key
--      constraint 'yakit_girisleri_arac_id_fkey' (Key is not present)"
--
-- ÇÖZÜM:
--   arac_id'yi nullable yap. Şoför INSERT'inde NULL kalır (FK NULL'u tolere eder).
--   Operasyon "Onayla" derken UPDATE ile doldurur. Onaylanmış kayıtlarda zaten
--   arac_id NULL kalmamalı; bunun için ek bir CHECK ekleyebiliriz: durum='onayli'
--   ise arac_id NOT NULL olmalı (yumuşak garantili).

begin;

alter table public.yakit_girisleri
  alter column arac_id drop not null;

-- Onaylanmış kayıtlarda arac_id zorunlu — operasyon onaylarken doldurmuş olmalı.
-- 'beklemede' veya 'red' durumlarında NULL serbest.
alter table public.yakit_girisleri
  drop constraint if exists yakit_girisleri_onayli_arac_zorunlu;
alter table public.yakit_girisleri
  add  constraint yakit_girisleri_onayli_arac_zorunlu
       check (durum <> 'onayli' or arac_id is not null);

comment on column public.yakit_girisleri.arac_id is
  'araclar.id FK. Şoför fiş bildiriminde NULL kalır; operasyon onaylarken doldurur. durum=onayli için NOT NULL (CHECK).';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOĞRULAMA
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Şoför INSERT testi (arac_id GÖNDERİLMEZ — payload'da yok):
--    INSERT INTO yakit_girisleri (id, user_id, firma_id, surucu_id,
--                                 sofor_user_id, tarih, km, litre, fiyat, durum)
--    VALUES (...);
--    → arac_id NULL kabul edilmeli, FK ihlal etmemeli.
--
-- 2) Operasyon UPDATE durum='onayli' arac_id NULL ile → CHECK constraint engellemeli.
--    UPDATE yakit_girisleri SET durum='onayli' WHERE id='...';
--    → "yakit_girisleri_onayli_arac_zorunlu" hatası.
--
-- 3) Operasyon UPDATE durum='onayli' arac_id dolu ile → BAŞARILI.
