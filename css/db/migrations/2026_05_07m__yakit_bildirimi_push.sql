-- =============================================================================
-- FLEETLY  —  2026-05-07m  —  Yakıt fişi onay/red push bildirimi
-- =============================================================================
-- HEDEF:
--   Operasyon yakıt fişi bildirimini onayladığında veya reddettiğinde şoföre
--   push notification git. Şoför "fişim onaylandı mı?" diye sormasın, anlık
--   geri bildirim alsın.
--
-- AKIŞ:
--   yakit_girisleri.UPDATE  (durum: 'beklemede' → 'onayli'/'red')
--           ↓
--   trg_yakit_durum_bildir trigger
--           ↓
--   notify-driver Edge Function (FCM + Web Push)
--           ↓
--   Şoför cihazı: bildirim gösterir
--
-- BAĞIMLI:
--   2026_04_28d (notify-driver Edge Function + pg_net)
--   2026_05_07l (yakit_girisleri.durum, sofor_user_id, red_neden kolonları)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Trigger fonksiyonu — durum 'beklemede' → 'onayli'/'red' geçişinde push
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_yakit_durum_bildir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_surl       text := current_setting('app.supabase_url',     true);
  v_skey       text := current_setting('app.service_role_key', true);
  v_surucu_id  uuid;
  v_title      text;
  v_body       text;
BEGIN
  -- Yalnızca durum geçişinde çalış (UPDATE OF durum)
  IF NEW.durum IS NOT DISTINCT FROM OLD.durum THEN RETURN NEW; END IF;
  -- Sadece beklemede → onayli/red geçişlerinde
  IF OLD.durum <> 'beklemede' THEN RETURN NEW; END IF;
  IF NEW.durum NOT IN ('onayli','red') THEN RETURN NEW; END IF;
  -- Şoför auth user_id zorunlu
  IF NEW.sofor_user_id IS NULL THEN RETURN NEW; END IF;
  -- App ayarları yoksa sessizce çık (notify-driver çağrısı yapılamaz)
  IF v_surl IS NULL OR v_skey IS NULL THEN RETURN NEW; END IF;

  -- notify-driver "surucu_id" parametresi suruculer.id bekliyor
  -- (sofor_user_id = auth.users.id farklı). Suruculer'dan çöz.
  SELECT id INTO v_surucu_id
    FROM public.suruculer
   WHERE auth_user_id = NEW.sofor_user_id
   LIMIT 1;
  IF v_surucu_id IS NULL THEN RETURN NEW; END IF;

  -- Mesaj içeriği
  IF NEW.durum = 'onayli' THEN
    v_title := '✅ Yakıt fişi onaylandı';
    v_body  := COALESCE(NULLIF(NEW.istasyon, '') || ' · ', '')
            || COALESCE(NEW.litre::text || ' L · ', '')
            || COALESCE('₺' || NEW.fiyat::text, '');
    IF v_body = '' THEN v_body := 'Bildirdiğin yakıt fişi onaylandı.'; END IF;
  ELSE  -- 'red'
    v_title := '❌ Yakıt fişi reddedildi';
    v_body  := 'Sebep: ' || COALESCE(NULLIF(NEW.red_neden, ''), 'Belirtilmemiş');
  END IF;

  -- Edge Function çağrısı — async, yakıt UPDATE'ini etkilemez
  PERFORM net.http_post(
    url     := v_surl || '/functions/v1/notify-driver',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_skey
               ),
    body    := jsonb_build_object(
                 'surucu_id',  v_surucu_id::text,
                 'title',      v_title,
                 'body',       v_body,
                 'type',       'yakit',
                 'url',        '/sofor.html',
                 'is_emri_id', NEW.is_emri_id  -- mobile NextStepCard derin link için
               )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS yakit_durum_bildir ON public.yakit_girisleri;
CREATE TRIGGER yakit_durum_bildir
AFTER UPDATE OF durum ON public.yakit_girisleri
FOR EACH ROW EXECUTE FUNCTION public.trg_yakit_durum_bildir();

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Trigger oluştu mu:
--    SELECT tgname FROM pg_trigger WHERE tgname='yakit_durum_bildir';
--
-- 2) Test: şoför bekleyen kayıt → onay → push gitmeli
--    UPDATE yakit_girisleri
--       SET durum='onayli', litre=237, fiyat=17070, arac_id='34ABC',
--           onay_at=now(), onay_user_id=auth.uid()
--     WHERE id='<bildirim_id>';
--    Şoför mobile cihazda 1-3sn içinde bildirim gelmeli.
--
-- 3) Edge Function logları (Dashboard > Edge Functions > notify-driver > Logs):
--    "type": "yakit" data ile çağrı görmeli, FCM 200 OK dönmeli.
-- =============================================================================
