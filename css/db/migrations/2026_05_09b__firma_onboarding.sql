-- 2026-05-09b — Onboarding wizard flag (Faz 1)
--
-- Yeni firma kayıt sonrası 5-adımlı kurulum sihirbazı tetiklenir:
--   1. Firma logosu + adres
--   2. İlk araç (zorunlu)
--   3. İlk sürücü davet (opsiyonel)
--   4. İlk müşteri (opsiyonel)
--   5. Harcırah ayarları (opsiyonel)
--
-- onboarding_done = true: tamamlandı veya kullanıcı "atla"yı tıkladı
-- onboarding_done_at: bilgilendirici, ne zaman tamamlandı
-- Mevcut firmalar (migrasyon öncesi açılmış) wizard görmesin → backfill ile true.

begin;

alter table public.firmalar
  add column if not exists onboarding_done    boolean     not null default false,
  add column if not exists onboarding_done_at timestamptz;

-- Geriye dönük: mevcut tüm firmaları "tamamlandı" olarak işaretle
-- (yeni eklenecek kayıtlar default false → wizard görür)
update public.firmalar
   set onboarding_done    = true,
       onboarding_done_at = coalesce(onboarding_done_at, created_at, now())
 where onboarding_done = false
   and created_at < now() - interval '5 minutes';   -- son 5 dk içinde açılan yeni kayıtları atla

comment on column public.firmalar.onboarding_done is
  'true ise onboarding wizard tamamlanmış veya atlanmış. Yeni kayıtlarda false → ilk login wizard tetikler.';

commit;
