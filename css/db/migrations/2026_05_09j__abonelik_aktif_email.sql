-- =============================================================================
-- 2026_05_09j__abonelik_aktif_email.sql
-- Faz 6 — Iyzipay başarılı ödeme sonrası abonelik_aktif email'i.
--
-- abonelik_iyzipay_aktif_et RPC'sini override eder; orijinal mantık aynen
-- korunur, sona _email_gonder('abonelik_aktif', ...) eklenir (fail-soft).
-- =============================================================================

create or replace function public.abonelik_iyzipay_aktif_et(
  p_odeme_id              text,
  p_iyzipay_payment_id    text,
  p_iyzipay_token         text,
  p_iyzipay_raw           jsonb,
  p_tutar                 numeric default null
)
returns table (firma_id uuid, abonelik_bitis timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_odeme        record;
  v_yeni_bitis   timestamptz;
  v_firma_ad     text;
  v_plan_ad      text;
  v_alici_email  text;
begin
  -- Bekleyen odemeyi bul
  select * into v_odeme from public.odeme_gecmisi
   where id = p_odeme_id and durum = 'bekliyor'
   limit 1;
  if v_odeme.id is null then
    raise exception 'Bekleyen ödeme kaydı bulunamadı: %', p_odeme_id using errcode = '22023';
  end if;

  -- Tutar uyumsuzluğu kontrolü
  if p_tutar is not null and abs(p_tutar - v_odeme.tutar) > 0.01 then
    update public.odeme_gecmisi
       set durum = 'tutar_uyumsuz',
           iyzipay_payment_id = p_iyzipay_payment_id,
           iyzipay_token      = p_iyzipay_token,
           iyzipay_raw        = p_iyzipay_raw,
           notlar             = 'Iyzipay tutarı (' || p_tutar || ') beklenenden (' || v_odeme.tutar || ') farklı'
     where id = p_odeme_id;
    raise exception 'Tutar uyumsuzluğu' using errcode = '22023';
  end if;

  -- Odemeyi başarılı işaretle
  update public.odeme_gecmisi
     set durum                 = 'basarili',
         iyzipay_payment_id    = p_iyzipay_payment_id,
         iyzipay_token         = p_iyzipay_token,
         iyzipay_raw           = p_iyzipay_raw,
         notlar                = 'Iyzipay ödeme başarılı'
   where id = p_odeme_id;

  -- Firma aboneliği — yenileme ise bitiş tarihi uzar, yeni ise bugünden başlar
  select greatest(coalesce(abonelik_bitis, now()), now()) + (
           (select sure_gun from public.abonelik_planlari where id = v_odeme.plan_id) || ' days'
         )::interval
    into v_yeni_bitis
    from public.firmalar where id = v_odeme.firma_id;

  update public.firmalar
     set abonelik_durumu = 'aktif',
         abonelik_plani  = v_odeme.plan_id,
         abonelik_bitis  = v_yeni_bitis,
         odeme_ref       = p_iyzipay_payment_id
   where id = v_odeme.firma_id;

  -- Email gonder: abonelik aktif (fail-soft)
  select f.ad, p.ad
    into v_firma_ad, v_plan_ad
    from public.firmalar f
    left join public.abonelik_planlari p on p.id = v_odeme.plan_id
    where f.id = v_odeme.firma_id;

  -- Sahip emailini bul (tahsilat sahibinin sorumluluğu)
  select u.email::text into v_alici_email
    from public.firma_kullanicilar fk
    join auth.users u on u.id = fk.user_id
    where fk.firma_id = v_odeme.firma_id and fk.rol = 'sahip'
    limit 1;

  if v_alici_email is not null then
    perform public._email_gonder(
      'abonelik_aktif',
      v_alici_email,
      jsonb_build_object(
        'firma_id',     v_odeme.firma_id,
        'firma_ad',     coalesce(v_firma_ad, 'Firmanız'),
        'plan_ad',      coalesce(v_plan_ad, v_odeme.plan_id),
        'tutar_pretty', to_char(v_odeme.tutar, 'FM999G999D00') || ' ' || coalesce(v_odeme.para_birimi, 'TRY'),
        'payment_id',   p_iyzipay_payment_id,
        'bitis_pretty', to_char(v_yeni_bitis at time zone 'Europe/Istanbul', 'DD.MM.YYYY'),
        'fatura_email', v_alici_email
      )
    );
  end if;

  return query select v_odeme.firma_id, v_yeni_bitis;
end $$;

grant execute on function public.abonelik_iyzipay_aktif_et(text, text, text, jsonb, numeric) to authenticated, service_role;

comment on function public.abonelik_iyzipay_aktif_et(text, text, text, jsonb, numeric) is
  'Faz 4+6 — Iyzipay basarili odeme sonrasi abonelik aktive + abonelik_aktif email.';
