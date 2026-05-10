-- =============================================================================
-- FLEETLY  —  2026-05-10b  —  GÜVENLİK: SECURITY DEFINER RPC firma_id yetki fix
-- =============================================================================
-- KRİTİK MULTI-TENANT SIZINTI:
--   Aşağıdaki SECURITY DEFINER RPC'ler client'tan p_firma_id alıyor ama
--   içeride caller'ın o firmaya yetkili olup olmadığını kontrol ETMİYORDU.
--   SECURITY DEFINER → RLS bypass → herhangi bir authenticated kullanıcı
--   başka bir firma'nın UUID'sini geçirip iş yaptırabiliyordu.
--
--   1) notify_create(p_firma_id, ...)        → cross-tenant bildirim spam
--                                              (başka firmaya sahte uyarı atmak)
--   2) sofor_davet_olustur_v2(p_firma_id,..) → cross-tenant şoför ekleme
--                                              (suruculer + surucu_davetleri INSERT
--                                               başka firmanın hesabına)
--   3) harcirah_tarife_bul(p_firma_id, ...)  → cross-tenant tarife okuma
--                                              (rakip firmanın fiyatlandırması)
--   4) _firma_kullanim_aktif_mi(p_firma_id)  → abonelik durum information leak
--                                              (rakip aktif mi öğrenme)
--
-- ÇÖZÜM:
--   - 1, 2, 3: Body başına `auth.uid() is not null` ise yetki kontrolü ekle.
--             auth.uid() NULL ise (service_role / server-side trigger) bypass —
--             trigger'lar etkilenmesin. RLS WITH CHECK zaten son katmanda korur.
--   - 4: GRANT'i `authenticated`'tan kaldır — yalnızca SECURITY DEFINER
--        trigger'lar (trg_abonelik_check_insert) tarafından kullanılıyor zaten.
--
-- BAĞIMLILIK:
--   2026_05_07b__rls_emergency_fix.sql           (_user_firma_ids helper)
--   2026_05_07__sofor_davet_olustur_v2_firma_fallback.sql
--   2026_05_05e__harcirah_bolgeler_ek_hizmetler.sql
--   2026_05_09f__read_only_mod_trigger.sql
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) notify_create — bildirim oluştur (cross-tenant spam fix)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_create(
  p_firma_id       uuid,
  p_tip            text,
  p_baslik         text,
  p_mesaj          text default null,
  p_ilgili_tur     text default null,
  p_ilgili_id      text default null,
  p_kaynak_user_id uuid default null,
  p_kaynak_ad      text default null,
  p_oncelik        text default 'normal'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_firma_id  uuid := p_firma_id;
begin
  -- p_firma_id NULL ise auth.uid() üzerinden çöz
  if v_firma_id is null then
    select fk.firma_id into v_firma_id
      from public.firma_kullanicilar fk
     where fk.user_id = auth.uid()
     limit 1;
  end if;

  if v_firma_id is null then
    raise exception
      'notify_create: firma_id NULL. SQL Editor üzerinden çağırıyorsanız auth.uid() boştur — firma_id''yi parametreyle elle verin.'
      using errcode = '23502';
  end if;

  -- 🔒 YETKI: client'tan çağrılıyorsa (auth.uid() var), v_firma_id caller'ın
  -- üye olduğu firmalardan biri olmalı. service_role / server-side trigger
  -- (auth.uid() NULL) bypass — trigger zaten NEW.firma_id'yi RLS WITH CHECK
  -- ile doğruluyor.
  if auth.uid() is not null
     and v_firma_id not in (select public._user_firma_ids()) then
    raise exception 'Yetkisiz: bu firmaya bildirim oluşturamazsınız (firma_id=%)', v_firma_id
      using errcode = '42501';
  end if;

  insert into public.bildirimler
    (firma_id, tip, baslik, mesaj, ilgili_tur, ilgili_id, kaynak_user_id, kaynak_ad, oncelik)
  values
    (v_firma_id, p_tip, p_baslik, p_mesaj, p_ilgili_tur, p_ilgili_id, p_kaynak_user_id, p_kaynak_ad, p_oncelik)
  returning id into v_id;
  return v_id;
end $$;

comment on function public.notify_create(uuid, text, text, text, text, text, uuid, text, text) is
  'Bildirim oluştur. SECURITY DEFINER. 2026-05-10b: caller p_firma_id''ye üye değilse 42501 reddedilir.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) sofor_davet_olustur_v2 — sürücü davet (cross-tenant kayıt fix)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sofor_davet_olustur_v2(
  p_firma_id uuid,
  p_ad       text,
  p_telefon  text,
  p_arac_id  text  default null,
  p_not      text  default null
) returns table(davet_id bigint, davet_kodu text, surucu_id uuid, yeni_sofor boolean)
language plpgsql security definer
set search_path = public
as $$
declare
  v_tel    text := public.fn_normalize_tel(p_telefon);
  v_firma  uuid := p_firma_id;
  v_surucu public.suruculer%rowtype;
  v_kod    text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_yeni   boolean := false;
  v_davet_id bigint;
begin
  if v_tel is null then
    raise exception 'Geçersiz telefon' using errcode = '22023';
  end if;

  -- p_firma_id verilmediyse auth.uid() üzerinden çöz (sahip > yonetici > operasyoncu)
  if v_firma is null then
    select fk.firma_id into v_firma
      from public.firma_kullanicilar fk
      where fk.user_id = auth.uid()
        and fk.rol in ('sahip','yonetici','operasyoncu')
      order by (fk.rol = 'sahip') desc
      limit 1;
    if v_firma is null then
      raise exception 'Firma bulunamadı — lütfen sayfayı yenileyip tekrar deneyin'
        using errcode = '42501';
    end if;
  end if;

  -- 🔒 YETKI: client'tan çağrılıyorsa, p_firma_id'de davet oluşturma yetkisi
  -- (sahip/yonetici/operasyoncu) olmalı.
  if auth.uid() is not null and not exists (
    select 1 from public.firma_kullanicilar fk
     where fk.user_id = auth.uid()
       and fk.firma_id = v_firma
       and fk.rol in ('sahip','yonetici','operasyoncu')
  ) then
    raise exception 'Yetkisiz: bu firmada şoför davet oluşturma yetkiniz yok (firma_id=%)', v_firma
      using errcode = '42501';
  end if;

  -- Aynı firmada aynı telefon var mı?
  select * into v_surucu
  from public.suruculer
  where firma_id = v_firma and telefon_e164 = v_tel;

  if not found then
    insert into public.suruculer(firma_id, ad, telefon_e164, telefon_raw, durum, created_by)
    values (v_firma, p_ad, v_tel, p_telefon, 'davet_bekliyor', auth.uid())
    returning * into v_surucu;
    v_yeni := true;
  else
    if v_surucu.ad is null or v_surucu.ad = 'İsimsiz' then
      update public.suruculer set ad = p_ad where id = v_surucu.id;
    end if;
  end if;

  insert into public.surucu_davetleri(
    firma_id, davet_eden, ad, telefon, telefon_e164,
    surucu_id, arac_id, davet_kodu, notlar, davet_durumu
  ) values (
    v_firma, auth.uid(), coalesce(v_surucu.ad, p_ad), p_telefon, v_tel,
    v_surucu.id, p_arac_id, v_kod, p_not, 'gonderildi'
  ) returning id into v_davet_id;

  return query select v_davet_id, v_kod, v_surucu.id, v_yeni;
end $$;

comment on function public.sofor_davet_olustur_v2(uuid, text, text, text, text) is
  'Sürücü davet oluştur. p_firma_id NULL ise auth.uid()''den çözülür.
   2026-05-10b: caller p_firma_id''de sahip/yonetici/operasyoncu rolünde olmalı.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) harcirah_tarife_bul — tarife okuma (cross-tenant okuma fix)
-- ─────────────────────────────────────────────────────────────────────────────
-- DROP gerekmiyor (imza aynı, sadece body değişiyor — CREATE OR REPLACE yeter).
create or replace function public.harcirah_tarife_bul(
  p_firma_id    uuid,
  p_alim_yeri   text,
  p_teslim_yeri text,
  p_kont_tip    text  default null,
  p_kont_durum  text  default null,
  p_dorse_tipi  text  default null,
  p_tarih       date  default current_date
) returns table (id uuid, tutar numeric, baslik text, eslesen_bolge text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_teslim_norm text := lower(coalesce(p_teslim_yeri, ''));
begin
  -- 🔒 YETKI: client'tan çağrılıyorsa (auth.uid() var), p_firma_id caller'ın
  -- üye olduğu firmalardan biri olmalı.
  if auth.uid() is not null
     and p_firma_id not in (select public._user_firma_ids()) then
    raise exception 'Yetkisiz: bu firmanın tarifelerine erişiminiz yok (firma_id=%)', p_firma_id
      using errcode = '42501';
  end if;

  return query
  with cand as (
    select
      t.id, t.tutar, t.baslik,
      (
        select b
        from unnest(coalesce(t.bolgeler, array[]::text[])) as b
        where v_teslim_norm <> '' and (
          v_teslim_norm like '%' || lower(b) || '%' or
          lower(b)      like '%' || v_teslim_norm || '%'
        )
        limit 1
      ) as bolge_match,
      t.alim_yeri, t.teslim_yeri, t.kont_tip, t.kont_durum, t.dorse_tipi,
      t.bolgeler, t.oncelik, t.created_at
    from public.harcirah_tarifeleri t
    where t.firma_id = p_firma_id
      and t.aktif_mi = true
      and (t.gecerli_baslangic is null or t.gecerli_baslangic <= p_tarih)
      and (t.gecerli_bitis     is null or t.gecerli_bitis     >= p_tarih)
  )
  select
    cand.id, cand.tutar, cand.baslik, cand.bolge_match
  from cand
  where
    (
      cand.bolgeler is null or array_length(cand.bolgeler, 1) is null
      or cand.bolge_match is not null
    )
    and (
      cand.teslim_yeri is null or p_teslim_yeri is null
      or lower(p_teslim_yeri) like '%' || lower(cand.teslim_yeri) || '%'
      or lower(cand.teslim_yeri) like '%' || lower(p_teslim_yeri) || '%'
    )
    and (
      cand.alim_yeri is null or p_alim_yeri is null
      or lower(p_alim_yeri) like '%' || lower(cand.alim_yeri) || '%'
      or lower(cand.alim_yeri) like '%' || lower(p_alim_yeri) || '%'
    )
    and (cand.kont_tip   is null or cand.kont_tip   = p_kont_tip)
    and (cand.kont_durum is null or p_kont_durum is null or cand.kont_durum = p_kont_durum)
    and (cand.dorse_tipi is null or p_dorse_tipi is null or cand.dorse_tipi = p_dorse_tipi)
  order by
    (case when cand.bolge_match is not null then 0 else 1 end),
    (case when cand.alim_yeri   is not null then 0 else 1 end),
    (case when cand.kont_tip    is not null then 0 else 1 end),
    (case when cand.kont_durum  is not null then 0 else 1 end),
    cand.oncelik asc,
    cand.created_at desc
  limit 1;
end $$;

comment on function public.harcirah_tarife_bul(uuid, text, text, text, text, text, date) is
  'Harcırah tarife eşleşmesi (firma rate card). 2026-05-10b: caller p_firma_id''ye üye olmalı.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) _firma_kullanim_aktif_mi — abonelik durum (information leak fix)
-- ─────────────────────────────────────────────────────────────────────────────
-- Sadece SECURITY DEFINER trigger/RPC'lerin (örn. trg_abonelik_check_insert)
-- içeriden kullanması gerekiyor. Authenticated client direkt çağırırsa rakip
-- firmaların abonelik durumunu öğrenebilir → grant'i kaldır.
revoke execute on function public._firma_kullanim_aktif_mi(uuid) from authenticated;
revoke execute on function public._firma_kullanim_aktif_mi(uuid) from public;
-- service_role yetkisi 2026_05_09f'den kalıyor — Edge Function'lar gerekirse kullanır.

comment on function public._firma_kullanim_aktif_mi(uuid) is
  'Firma aboneliği aktif mi? SECURITY DEFINER. 2026-05-10b: authenticated grant kaldırıldı,
   yalnızca SECURITY DEFINER trigger''lardan ve service_role''dan erişilebilir.';

-- PostgREST cache'i yenile
notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA (manuel)
-- =============================================================================
-- 1) notify_create cross-tenant test (kullanıcı A ile login):
--    SELECT public.notify_create(
--      '<firma_B_uuid>'::uuid, 'test', 'Sahte', 'spam', null, null, null, null, 'normal');
--    -> 42501 hatası bekleniyor.
--
-- 2) sofor_davet_olustur_v2 cross-tenant test:
--    SELECT * FROM public.sofor_davet_olustur_v2(
--      '<firma_B_uuid>'::uuid, 'Test', '+905551234567', null, null);
--    -> 42501 hatası bekleniyor.
--
-- 3) harcirah_tarife_bul cross-tenant test:
--    SELECT * FROM public.harcirah_tarife_bul(
--      '<firma_B_uuid>'::uuid, 'Istanbul', 'Ankara');
--    -> 42501 hatası bekleniyor.
--
-- 4) _firma_kullanim_aktif_mi grant kontrolü:
--    SELECT has_function_privilege('authenticated',
--      'public._firma_kullanim_aktif_mi(uuid)', 'execute');
--    -> false bekleniyor.
--
-- 5) Trigger akışı bozulmadı mı (regression):
--    Aktif aboneliği olan firmada UPDATE is_emirleri SET durum='Yolda' WHERE id=...;
--    -> Trigger çalışmalı, bildirim oluşmalı (notify_create caller=trigger,
--       auth.uid() request user'ın UID'si → kendi firmasının iş emri →
--       yetki kontrolü geçer).
-- =============================================================================
