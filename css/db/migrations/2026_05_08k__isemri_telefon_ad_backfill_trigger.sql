-- 2026-05-08k — is_emirleri sofor_user_id auto-fill: telefon + ad fallback
--
-- KÖK SORUN:
--   2026_05_07e migration'ı trigger'a sadece "surucu_id <-> sofor_user_id"
--   eşleştirmesini koymuş. Telefon + ad ile fallback YALNIZCA backfill UPDATE
--   tarafında (migration sonu) vardı — TEK SEFERLİK.
--
--   Yeni iş emrinde web payload bazen sadece sofor (ad) + sofor_tel ile geliyor
--   (çoklu konteyner formu hardcoded NULL gönderir; tek-iş formunda da
--   _opsSoforUserId set akışı her zaman çalışmaz). Bu durumda trigger şoförü
--   bulup atamadığı için iş emri ŞOFÖRSÜZ kalıyor:
--     • surucu_id NULL  → push trigger erken return → bildirim gitmez
--     • sofor_user_id NULL  → RLS SELECT engelliyor → şoför hiç göremez
--                               (realtime/polling/refresh dahil)
--
-- ÇÖZÜM:
--   Backfill UPDATE'indeki 2b/2c logic'ini trigger fonksiyonunun içine taşı.
--   Trigger böylece her INSERT/UPDATE'te şu sırayla şoförü bulur:
--     1) surucu_id varsa → suruculer'dan sofor_user_id çek (mevcut)
--     2) sofor_user_id varsa → suruculer'dan surucu_id çek (mevcut)
--     3) ikisi de NULL ama firma_id + sofor_tel varsa → telefon eşleşmesi (YENI)
--     4) yine NULL ama firma_id + sofor (ad) varsa, firma içinde tek isimli
--        şoför varsa → ad eşleşmesi (YENI)
--
--   Tetikleyiciye sofor_tel + sofor kolonları da eklenir; bu alanların
--   güncellenmesi (örn. modal'da şoför değişikliği) trigger'ı yeniden çalıştırır.
--
-- BONUS:
--   Migration sonunda mevcut NULL kayıtları geriye dönük doldurur — 2026-05-07e
--   sonrası açılmış olup hâlâ orphan kalan iş emirleri kurtarılır (ID 63 vb.).

begin;

create or replace function public.trg_isemri_sofor_user_id_doldur()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surucu record;
begin
  -- 1) surucu_id var, sofor_user_id eksik → suruculer.auth_user_id
  if new.sofor_user_id is null and new.surucu_id is not null then
    select s.auth_user_id into new.sofor_user_id
      from public.suruculer s
     where s.id = new.surucu_id
     limit 1;
  end if;

  -- 2) sofor_user_id var, surucu_id eksik → suruculer.id
  if new.surucu_id is null and new.sofor_user_id is not null then
    select s.id into new.surucu_id
      from public.suruculer s
     where s.auth_user_id = new.sofor_user_id
       and (new.firma_id is null or s.firma_id = new.firma_id)
     order by s.created_at desc nulls last
     limit 1;
  end if;

  -- 3) İkisi de NULL ama firma + telefon varsa → tam eşleşme ile her ikisini doldur
  if new.surucu_id is null
     and new.sofor_user_id is null
     and new.firma_id is not null
     and new.sofor_tel is not null
     and trim(new.sofor_tel) <> '' then
    select s.* into v_surucu
      from public.suruculer s
     where s.firma_id = new.firma_id
       and s.telefon_e164 = public.fn_normalize_tel(new.sofor_tel)
       and s.auth_user_id is not null
     order by s.created_at desc nulls last
     limit 1;
    if v_surucu.id is not null then
      new.surucu_id     := v_surucu.id;
      new.sofor_user_id := v_surucu.auth_user_id;
    end if;
  end if;

  -- 4) Yine yoksa firma + sofor (ad) ile, ANCAK firma içinde aynı isimde
  --    auth bağlı tek şoför varsa atama yap. Birden fazla varsa atama yapma
  --    (yanlış atama riski). Bu davranış 2026_05_07e'deki backfill 2c ile aynı.
  if new.surucu_id is null
     and new.sofor_user_id is null
     and new.firma_id is not null
     and new.sofor is not null
     and trim(new.sofor) <> '' then
    if (select count(*) from public.suruculer s2
         where s2.firma_id = new.firma_id
           and lower(trim(s2.ad)) = lower(trim(new.sofor))
           and s2.auth_user_id is not null) = 1 then
      select s.* into v_surucu
        from public.suruculer s
       where s.firma_id = new.firma_id
         and lower(trim(s.ad)) = lower(trim(new.sofor))
         and s.auth_user_id is not null
       limit 1;
      if v_surucu.id is not null then
        new.surucu_id     := v_surucu.id;
        new.sofor_user_id := v_surucu.auth_user_id;
      end if;
    end if;
  end if;

  return new;
end $$;

-- Tetikleyiciyi sofor_tel + sofor kolonlarını da kapsayacak şekilde genişlet.
-- Böylece modal'da şoför değişikliği (sadece tel/ad güncelleyen yollarda da)
-- yeniden eşleştirme tetiklenir.
drop trigger if exists isemri_sofor_user_id_doldur on public.is_emirleri;
create trigger isemri_sofor_user_id_doldur
before insert or update of surucu_id, sofor_user_id, sofor_tel, sofor on public.is_emirleri
for each row execute function public.trg_isemri_sofor_user_id_doldur();

-- ─────────────────────────────────────────────────────────────────────────────
-- Geriye dönük backfill — 2026-05-07e sonrası açılmış orphan iş emirleri
-- (örn. ID 63). UPDATE trigger'ı çağıracak ki push da geç de olsa atılsın.
-- ─────────────────────────────────────────────────────────────────────────────

-- Telefon eşleşmesi
update public.is_emirleri ie
   set surucu_id     = s.id,
       sofor_user_id = s.auth_user_id
  from public.suruculer s
 where ie.surucu_id is null
   and ie.sofor_user_id is null
   and s.firma_id = ie.firma_id
   and s.telefon_e164 = public.fn_normalize_tel(ie.sofor_tel)
   and s.auth_user_id is not null;

-- Ad eşleşmesi (firma içinde tek isimli auth-bağlı şoför)
update public.is_emirleri ie
   set surucu_id     = s.id,
       sofor_user_id = s.auth_user_id
  from public.suruculer s
 where ie.surucu_id is null
   and ie.sofor_user_id is null
   and s.firma_id = ie.firma_id
   and lower(trim(s.ad)) = lower(trim(ie.sofor))
   and s.auth_user_id is not null
   and (select count(*) from public.suruculer s2
         where s2.firma_id = ie.firma_id
           and lower(trim(s2.ad)) = lower(trim(ie.sofor))
           and s2.auth_user_id is not null) = 1;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOĞRULAMA (manuel)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ID 63 düzelmiş mi?
--    select id, sofor, sofor_tel, surucu_id, sofor_user_id from is_emirleri where id = 63;
--    → surucu_id ve sofor_user_id artık dolu olmalı.
--
-- 2) NULL kalan başka iş emri var mı? (atanmış olanlar arasında)
--    select count(*) from is_emirleri
--     where (sofor_user_id is null or surucu_id is null)
--       and (sofor is not null or sofor_tel is not null);
--    → İdeal: 0. Kalanlar varsa o sürücü auth'a bağlanmamış demektir.
--
-- 3) Trigger çalışıyor mu? Test:
--    insert into is_emirleri (firma_id, sofor, sofor_tel, durum)
--    values ('<firma>', 'Test Sürücü', '+90...', 'Bekliyor')
--    returning surucu_id, sofor_user_id;
--    → Eşleşme varsa ikisi de dolu gelmeli.
