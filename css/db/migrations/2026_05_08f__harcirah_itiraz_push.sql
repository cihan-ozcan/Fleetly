-- 2026-05-08f — Harcırah itiraz push bildirimi (yönetici + operasyoncu)
--
-- Şoför "İtiraz Et" tıklayınca harcirah_kayitlari.durum = 'sofor_itiraz' olur.
-- Bu trigger durum geçişini yakalar → firmanın tüm yöneticilerine ve
-- operasyoncularına push gönderir (FCM + Web Push).

create or replace function public.trg_harcirah_itiraz_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surl   text := current_setting('app.supabase_url',     true);
  v_skey   text := current_setting('app.service_role_key', true);
  v_title  text;
  v_body   text;
  v_role_user record;
begin
  -- Yalnızca durum sofor_itiraz'a geçişte
  if new.durum is not distinct from old.durum then return new; end if;
  if new.durum <> 'sofor_itiraz' then return new; end if;

  if v_surl is null or v_skey is null then return new; end if;

  v_title := '⚠️ Harcırah itirazı';
  v_body  := coalesce(new.sofor_ad, 'Şoför') || ' (' || coalesce(new.arac_plaka, '?') || ') — ' ||
             'Önerilen: ' || to_char(coalesce(new.itiraz_tutar, 0), 'FM999G999D90') || ' ₺' ||
             case when new.itiraz_aciklama is not null and length(new.itiraz_aciklama) > 0
                  then ' · ' || left(new.itiraz_aciklama, 80)
                  else '' end;

  -- Firmanın tüm yetkililerine (yönetici, sahip, operasyoncu) push
  for v_role_user in
    select fk.user_id
      from public.firma_kullanicilar fk
     where fk.firma_id = new.firma_id
       and fk.rol in ('sahip','yonetici','operasyoncu')
  loop
    -- notify-driver Edge Function bunu hem FCM hem Web Push'a gönderir
    -- (Edge Function user_id'den fcm_token + push_subscription'ı kendi çözüyor)
    perform net.http_post(
      url     := v_surl || '/functions/v1/notify-driver',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_skey
                 ),
      body    := jsonb_build_object(
                   'user_id',    v_role_user.user_id,
                   'title',      v_title,
                   'body',       v_body,
                   'type',       'harcirah_itiraz',
                   'url',        '/app.html#harcirah?id=' || new.id::text,
                   'is_emri_id', new.is_emri_id,
                   'kayit_id',   new.id::text
                 )
    );
  end loop;

  -- Bildirimler tablosuna da kaydet (uygulama içinde de görünsün)
  begin
    perform public.notify_create(
      new.firma_id, 'genel', v_title, v_body,
      'harcirah', new.id::text, new.sofor_user_id,
      coalesce(new.sofor_ad, new.arac_plaka), 'yuksek'
    );
  exception when others then null;
  end;

  return new;
exception when others then
  raise warning 'trg_harcirah_itiraz_push hata: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_harcirah_itiraz_push on public.harcirah_kayitlari;
create trigger trg_harcirah_itiraz_push
  after update of durum on public.harcirah_kayitlari
  for each row
  execute function public.trg_harcirah_itiraz_push();

comment on function public.trg_harcirah_itiraz_push() is '2026-05-08f: Şoför harcırah itirazında bulunduğunda firmanın yönetici/sahip/operasyoncu rolündeki kullanıcılarına push bildirim atar (FCM + Web Push). notify-driver Edge Function user_id''den token çözmeyi destekliyor.';
