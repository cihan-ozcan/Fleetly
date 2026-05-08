-- 2026-05-08i — `_tr_il_tespit` Türkçe karakter / Unicode toleransı
--
-- Sorun: Nominatim (OSM) il adlarını ASCII'ye yakın yazıyor — "Izmir" (Latin I),
-- ama tr_il_bolge.il değerleri Türkçe karakterli ("İzmir"). PostgreSQL'in
-- lower() fonksiyonu standart UTF-8 collation altında "İ" (U+0130) → "i" + 0x307
-- combining dot olarak çevirir; bu da basit substring match'i bozar.
--
-- Çözüm: hem girdi hem il listesi `unaccent + lower` ile normalleştirilip
-- karşılaştırılır. `unaccent` extension Supabase'de varsayılan kuruludur;
-- yine de `create extension if not exists` ile garantiye alıyoruz.

create extension if not exists unaccent;

create or replace function public._tr_il_tespit(p_text text)
returns text
language plpgsql
stable
as $$
declare
  v_il   text;
  v_norm text;
begin
  if p_text is null or trim(p_text) = '' then return null; end if;
  -- Girdiyi bir kez normalize et (her satırda yeniden yapma)
  v_norm := lower(unaccent(p_text));

  -- TR il listesinden uzun-isim öncelikli arama (ör. "Şanlıurfa" > "Urfa")
  select il into v_il
    from public.tr_il_bolge
   where v_norm like '%' || lower(unaccent(il)) || '%'
   order by length(il) desc
   limit 1;
  return v_il;
end $$;

comment on function public._tr_il_tespit(text) is 'Serbest metinden TR ili tespit eder. Türkçe karakter ve case farklılıklarını unaccent + lower ile tolere eder.';
