-- 2026-05-08j — Google Maps kısa link çözümleyici (pg_net)
--
-- Sorun: maps.app.goo.gl/XXX kısa linkleri tarayıcıdan fetch edilemez (CORS).
-- Çözüm: Supabase'in pg_net extension'ı ile DB tarafından HTTP isteği at,
-- 301/302 yanıtının Location header'ını oku, frontend'e uzun URL'i döndür.
-- Frontend bu uzun URL'i parseKonumUrl ile lat/lng'ye çevirir.
--
-- Güvenlik: yalnızca beklenen Google Maps short-link host'larına izin verilir.
-- Aksi halde RPC arbitrary HTTP gateway'ine dönüşürdü.

create extension if not exists pg_net;

create or replace function public.resolve_short_url(p_url text)
returns text
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_id        bigint;
  v_status    int;
  v_headers   jsonb;
  v_loc       text;
  v_attempts  int := 0;
  v_max_iter  int := 30;   -- 30 × 100ms = 3sn max bekleme
begin
  if p_url is null or trim(p_url) = '' then return null; end if;

  -- Yalnızca Google Maps kısa link domain'leri kabul edilir
  if p_url !~* '^https?://(maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.[a-z.]+)/' then
    raise exception 'Sadece Google Maps kısa linkleri çözülebilir: %', p_url;
  end if;

  -- pg_net asenkron çalışır — istek gönder, request_id al
  v_id := net.http_get(url := p_url, timeout_milliseconds := 5000);

  -- Yanıt için poll et
  while v_attempts < v_max_iter loop
    select status_code, headers into v_status, v_headers
      from net._http_response where id = v_id;
    if v_status is not null then
      -- pg_net redirect'i otomatik takip etmez → Location header'ını oku
      if v_status between 300 and 399 then
        v_loc := coalesce(v_headers->>'location', v_headers->>'Location');
        return v_loc;
      end if;
      return null;  -- redirect değil (200/404 vb.) — kısa link bozuk
    end if;
    perform pg_sleep(0.1);
    v_attempts := v_attempts + 1;
  end loop;
  return null;  -- timeout
end $$;

revoke all on function public.resolve_short_url(text) from public;
grant execute on function public.resolve_short_url(text) to authenticated;

comment on function public.resolve_short_url(text) is 'Google Maps kısa linkini (maps.app.goo.gl) takip edip uzun URL döner. CORS olmadığı için tarayıcıdan yapılamayan iş.';
