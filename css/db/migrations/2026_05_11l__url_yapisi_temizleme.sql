-- =============================================================================
-- FLEETLY  —  2026-05-11l  —  URL yapısı temizleme (.html → klasör)
-- =============================================================================
-- AÇIK:
--   Site URL yapısı .html uzantılarından temizlendi (B seçeneği, profesyonel
--   URL'ler). Eski:
--     https://fleetly.fit/accept-invite.html?kod=XXX
--     /app.html#harcirah?id=YY
--   Yeni:
--     https://fleetly.fit/davet/?kod=XXX
--     /app/#harcirah?id=YY
--
--   DB içindeki RPC ve trigger fonksiyon body'lerinde hardcoded URL'ler var
--   (davet email helper, davet listesi, davet oluştur, harcırah itiraz push
--   gibi). Email gönderildiğinde veya bildirim oluştuğunda 404 verir.
--
-- ÇÖZÜM:
--   pg_get_functiondef ile her fonksiyon tanımını al → string replace ile
--   eski URL'leri yeni karşılıklarıyla değiştir → EXECUTE ile CREATE OR REPLACE.
--   Tek transaction. Hata olursa rollback.
--
-- URL EŞLEŞTİRMELERİ:
--   accept-invite.html       → davet/
--   app.html                 → app/
--   register.html            → kayit/
--   reset-password.html      → sifre-sifirla/
--   abonelik-sonuc.html      → abonelik/
--   kvkk-aydinlatma.html     → kvkk/
--   kullanim-sartlari.html   → kullanim/
--   musteri_takip.html       → takip/
--   portal.html              → portal/
--   sofor.html               → sofor/
--   sofor-profil.html        → profil/
--   admin.html               → admin/
--
-- ETKİLENMESİ BEKLENEN FONKSİYONLAR:
--   firma_kullanici_davet_olustur (2026_05_09c/m)
--   firma_kullanici_davet_listele (2026_05_09c)
--   firma_kullanici_davet_email_gonder (2026_05_09h)
--   trg_harcirah_itiraz_push (2026_05_08f)
--   ve içinde .html geçen başka herhangi bir public.* fonksiyon
--
-- BAĞIMLILIK:
--   pg_get_functiondef (yerleşik PostgreSQL)
--   _user_firma_ids / SECURITY DEFINER fonksiyonları korunur (RPC body'leri
--   değişmez, sadece string literal URL'ler güncellenir).
--
-- GERİ ALMA:
--   Eski URL'lere geri dönmek için reverse mapping ile aynı pattern.
-- =============================================================================

begin;

do $$
declare
  r record;
  v_def text;
  v_changed boolean;
  v_olds text[] := array[
    'accept-invite.html',
    'app.html',
    'register.html',
    'reset-password.html',
    'abonelik-sonuc.html',
    'kvkk-aydinlatma.html',
    'kullanim-sartlari.html',
    'musteri_takip.html',
    'sofor-profil.html',
    'sofor.html',
    'portal.html',
    'admin.html'
  ];
  v_news text[] := array[
    'davet/',
    'app/',
    'kayit/',
    'sifre-sifirla/',
    'abonelik/',
    'kvkk/',
    'kullanim/',
    'takip/',
    'profil/',
    'sofor/',
    'portal/',
    'admin/'
  ];
  i int;
  v_count int := 0;
begin
  if array_length(v_olds, 1) <> array_length(v_news, 1) then
    raise exception 'URL eşleştirme array uzunlukları uyuşmuyor';
  end if;

  for r in
    select n.nspname, p.proname, p.oid as poid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_functiondef(p.oid) ~ '\.html'
  loop
    v_def := pg_get_functiondef(r.poid);
    v_changed := false;
    for i in 1..array_length(v_olds, 1) loop
      if position(v_olds[i] in v_def) > 0 then
        v_def := replace(v_def, v_olds[i], v_news[i]);
        v_changed := true;
      end if;
    end loop;
    if v_changed then
      execute v_def;
      v_count := v_count + 1;
      raise notice 'URL güncellendi: %.%', r.nspname, r.proname;
    end if;
  end loop;

  raise notice 'Toplam % fonksiyon güncellendi.', v_count;
end $$;

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) .html referansı kalmadı:
--    select p.proname
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and pg_get_functiondef(p.oid) ~ '\.html';
--    Beklenen: 0 satır.
--
-- 2) Davet linki güncel mi (yeni davet oluştur, link'i kontrol et):
--    select public.firma_kullanici_davet_olustur('test@example.com', 'yonetici', null);
--    select davet_kodu, davet_link from public.firma_kullanici_davet_listele();
--    Beklenen: davet_link sütununda https://fleetly.fit/davet/?kod=XXXX (eski accept-invite.html değil)
--
-- 3) Harcırah itiraz push test (manuel):
--    select pg_get_functiondef('public.trg_harcirah_itiraz_push'::regprocedure);
--    İçinde '/app/#harcirah' geçmeli, '/app.html#' geçmemeli.
-- =============================================================================
