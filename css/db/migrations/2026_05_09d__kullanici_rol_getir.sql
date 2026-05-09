-- 2026-05-09d — Kullanıcının kendi rolünü çeken RPC (Faz 3)
--
-- Frontend rol bazlı UI gating için: login sonrası kullanıcının firmasındaki
-- rolünü tek atışta öğrensin. firma_kullanicilar tablosuna direkt SELECT
-- yapmak yerine RPC kullanmak daha temiz (RLS policy'sinden bağımsız).
--
-- Çoklu firma rolü: bir kullanıcı birden fazla firmaya bağlı olabilir
-- (gelecekte). Şu an tek firma varsayımı; en yetkili rolü döner.

create or replace function public.firma_kullanici_rol_getir()
returns table (firma_id uuid, rol text, ad text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  return query
    select
      fk.firma_id,
      fk.rol,
      coalesce(
        (u.raw_user_meta_data->>'ad')::text,
        split_part(u.email::text, '@', 1)
      ) as ad
    from public.firma_kullanicilar fk
    join auth.users u on u.id = fk.user_id
    where fk.user_id = v_uid
    -- Sahip > yönetici > operasyoncu > muhasebeci > diğer sırasıyla
    order by case fk.rol
      when 'sahip'       then 1
      when 'yonetici'    then 2
      when 'operasyoncu' then 3
      when 'muhasebeci'  then 4
      else 5 end
    limit 1;
end $$;

revoke all on function public.firma_kullanici_rol_getir() from public;
grant execute on function public.firma_kullanici_rol_getir() to authenticated;

comment on function public.firma_kullanici_rol_getir() is
  'Login sonrası frontend rol gating için kullanıcının (auth.uid) en yetkili rolünü döner. RLS bypass — security definer.';
