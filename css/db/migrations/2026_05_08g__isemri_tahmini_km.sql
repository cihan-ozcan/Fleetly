-- 2026-05-08g — İş emrine tahmini karayolu mesafesi/süresi kolonları
--
-- Frontend OSRM (router.project-osrm.org) çağrısı ile yükleme/teslim koordinatları
-- arasındaki gerçek karayolu km'sini ve süresini önceden hesaplayıp iş emrine yazar.
-- Harcırah trigger'ı (trg_isemri_harcirah_olustur → harcirah_uzak_hesapla) bu değeri
-- önceliklendirir; null ise haversine fallback'e düşer (mevcut davranış).
--
-- Mobile (Room v10) ve web operasyon panelinde "📍 ~645 km · 7s 12dk" badge'i
-- bu kolonlara dayanır.

alter table public.is_emirleri
  add column if not exists tahmini_km      numeric,
  add column if not exists tahmini_sure_dk integer;

comment on column public.is_emirleri.tahmini_km      is 'OSRM ile hesaplanmış tahmini karayolu km. Harcırah hesabında haversine yerine öncelikli kullanılır.';
comment on column public.is_emirleri.tahmini_sure_dk is 'OSRM tahmini sürüş süresi (dakika). UI gösterimi için.';

-- Negatif/anormal değerler engellensin
alter table public.is_emirleri
  drop constraint if exists is_emirleri_tahmini_km_pozitif;
alter table public.is_emirleri
  add  constraint is_emirleri_tahmini_km_pozitif
       check (tahmini_km is null or tahmini_km >= 0);

alter table public.is_emirleri
  drop constraint if exists is_emirleri_tahmini_sure_pozitif;
alter table public.is_emirleri
  add  constraint is_emirleri_tahmini_sure_pozitif
       check (tahmini_sure_dk is null or tahmini_sure_dk >= 0);
