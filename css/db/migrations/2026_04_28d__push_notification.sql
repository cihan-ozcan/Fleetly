-- =============================================================================
-- FLEETLY  —  2026-04-28d  —  Push Bildirim Altyapısı
-- =============================================================================
-- 1) suruculer tablosuna push_subscription kolonu ekle
-- 2) is_emirleri INSERT/UPDATE → pg_net ile Edge Function'ı çağır
--
-- Ön koşul: Supabase projesinde pg_net extension etkin olmalı.
--   Dashboard > Database > Extensions > pg_net = ENABLED
--
-- Edge Function deploy edildikten sonra bu SQL çalıştırılmalıdır.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) push_subscription kolonu
-- ---------------------------------------------------------------------------
ALTER TABLE public.suruculer
  ADD COLUMN IF NOT EXISTS push_subscription jsonb;

COMMENT ON COLUMN public.suruculer.push_subscription IS
  'Web Push API abonelik nesnesi (endpoint, keys.p256dh, keys.auth). '
  'Şoför tarayıcısı ilk açılışta kaydeder; 410 Gone alınınca NULL yapılır.';


-- ---------------------------------------------------------------------------
-- 2) is_emirleri → notify-driver Edge Function tetikleyici
--
--    Çalışma koşulları:
--      • Yeni kayıt (INSERT) veya surucu_id alanı değişti (UPDATE)
--      • surucu_id dolu olmalı
--      • durum 'İptal' olmamalı
--
--    pg_net'in async HTTP çağrısı; hata olsa iş emri kaydını ETKILEMEZ.
-- ---------------------------------------------------------------------------

-- Supabase proje URL'i ve servis anahtarını DB ayarlarına kaydet
-- (Dashboard > Database > Vault veya burada direkt gir)
-- NOT: Üretimde bu değerleri Vault'a alın; aşağıdaki yorum satırları örnektir.
-- SELECT set_config('app.supabase_url',      'https://XXXXX.supabase.co', false);
-- SELECT set_config('app.service_role_key',  'eyJ...', false);

CREATE OR REPLACE FUNCTION public.trg_is_emri_notify_sofor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_surl  text := current_setting('app.supabase_url',      true);
  v_skey  text := current_setting('app.service_role_key',  true);
  v_kontno text;
  v_token  text;
  v_url    text;
BEGIN
  -- Koşul: yeni atama var mı?
  IF NEW.surucu_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.durum = 'İptal'    THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.surucu_id IS NOT DISTINCT FROM NEW.surucu_id THEN
    RETURN NEW;  -- surucu_id değişmedi, bildirim gerekmez
  END IF;

  -- pg_net veya app ayarları eksikse sessizce geç
  IF v_surl IS NULL OR v_skey IS NULL THEN RETURN NEW; END IF;

  -- Şoför linki için base64 token oluştur (sofor.html'in atob() decode'u ile uyumlu)
  v_kontno := COALESCE(NEW.konteyner_no, 'İş Emri #' || NEW.id::text);
  v_token  := replace(
                encode(convert_to('ops_' || NEW.id::text || '_0', 'UTF8'), 'base64'),
                chr(10), ''   -- satır sonlarını temizle
              );
  v_url    := '/sofor.html?t=' || v_token;

  -- Edge Function'ı asenkron çağır (pg_net)
  PERFORM net.http_post(
    url     := v_surl || '/functions/v1/notify-driver',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_skey
               ),
    body    := jsonb_build_object(
                 'surucu_id',  NEW.surucu_id,
                 'is_emri_id', NEW.id,
                 'title',      '🚛 Yeni İş Emri Atandı',
                 'body',       split_part(v_kontno, E'\n', 1) || ' — Detaylar için dokunun.',
                 'url',        v_url
               )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS is_emri_notify_sofor ON public.is_emirleri;
CREATE TRIGGER is_emri_notify_sofor
AFTER INSERT OR UPDATE OF surucu_id, durum ON public.is_emirleri
FOR EACH ROW EXECUTE FUNCTION public.trg_is_emri_notify_sofor();

COMMIT;

-- =============================================================================
-- KURULUM ADIMLARI (bu SQL'den sonra yapılacaklar)
-- =============================================================================
--
-- A) VAPID anahtar çifti üretin (bir kez, terminal'de):
--      npx web-push generate-vapid-keys
--    Çıktı:
--      Public Key : BNxyz...
--      Private Key: abc123...
--
-- B) config.js'e public key ekleyin:
--      window.FILO_CONFIG = {
--        ...
--        VAPID_PUBLIC_KEY: 'BNxyz...'
--      };
--
-- C) Supabase Dashboard > Edge Functions > notify-driver > Secrets:
--      VAPID_PUBLIC_KEY   = BNxyz...
--      VAPID_PRIVATE_KEY  = abc123...
--      VAPID_SUBJECT      = mailto:info@firmaniz.com
--
-- D) Edge Function'ı deploy edin:
--      supabase functions deploy notify-driver
--
-- E) DB ayarlarını girin (Supabase SQL Editor'da):
--      ALTER DATABASE postgres
--        SET "app.supabase_url"     = 'https://XXXXX.supabase.co';
--      ALTER DATABASE postgres
--        SET "app.service_role_key" = 'eyJhbGc...';
--
-- F) pg_net extension'ın etkin olduğunu doğrulayın:
--      SELECT * FROM pg_extension WHERE extname = 'pg_net';
--
-- =============================================================================
