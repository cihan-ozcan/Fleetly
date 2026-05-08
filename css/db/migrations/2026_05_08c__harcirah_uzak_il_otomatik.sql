-- 2026-05-08c — Uzak il harcırahı otomatik hesaplama (3 katmanlı)
--
-- KÖK PROBLEM
-- -----------
-- Mevcut harcirah_tarifeleri tablosu yakın bölge sabit tarifeleri için ideal
-- (Çorlu = 600, Edirne = 750 vs.) ama uzak iller için tarife yok → eşleşmediğinde
-- şoför ve işveren manuel pazarlık yapıyor → kavga (4500 vs 6000 TL).
--
-- ÇÖZÜM — 3 KATMANLI HESAPLAMA
-- ----------------------------
--   Katman 1: harcirah_tarifeleri    (mevcut, dokunulmadı — sabit yakın bölge tarifeleri)
--   Katman 2: harcirah_il_tarife     (YENİ — il bazlı km birim, bölgeyi override eder)
--   Katman 3: harcirah_bolge_tarife  (YENİ — bölge bazlı km birim, varsayılan)
--   Sonrasında ortak: kural_seti (dolu/boş %, kademe, konaklama, minimum)
--
-- Mesafe kaynağı: is_emirleri.yukle_lat/lng + teslim_lat/lng (haversine fallback)
-- veya web tarafının zaten Maps'ten aldığı mesafe (fonksiyon parametresi olarak iletilebilir).

-- ════════════════════════════════════════════════════════════
-- 1) tr_il_bolge — Türkiye il→bölge eşlemesi (sistem geneli, sabit)
-- ════════════════════════════════════════════════════════════
create table if not exists public.tr_il_bolge (
  il    text primary key,
  bolge text not null check (bolge in (
    'marmara','ege','akdeniz','ic_anadolu','karadeniz','dogu_anadolu','guneydogu'
  ))
);
comment on table public.tr_il_bolge is 'Türkiye 81 il → 7 coğrafi bölge eşlemesi. Sistem geneli, sabit. Harcırah hesaplamasında firma il bazlı tarife belirtmediyse il→bölge üzerinden bölge tarifesi uygulanır.';

-- 81 il seed (i ekleme/türkçe karakter normalizasyonu için karşılaştırmalarda lower(il) kullanılacak)
insert into public.tr_il_bolge (il, bolge) values
  -- MARMARA (11)
  ('İstanbul','marmara'),('Tekirdağ','marmara'),('Edirne','marmara'),('Kırklareli','marmara'),
  ('Çanakkale','marmara'),('Balıkesir','marmara'),('Bursa','marmara'),('Yalova','marmara'),
  ('Kocaeli','marmara'),('Sakarya','marmara'),('Bilecik','marmara'),
  -- EGE (8)
  ('İzmir','ege'),('Aydın','ege'),('Muğla','ege'),('Manisa','ege'),
  ('Denizli','ege'),('Kütahya','ege'),('Uşak','ege'),('Afyonkarahisar','ege'),
  -- AKDENİZ (8)
  ('Antalya','akdeniz'),('Mersin','akdeniz'),('Adana','akdeniz'),('Hatay','akdeniz'),
  ('Osmaniye','akdeniz'),('Kahramanmaraş','akdeniz'),('Isparta','akdeniz'),('Burdur','akdeniz'),
  -- İÇ ANADOLU (13)
  ('Ankara','ic_anadolu'),('Konya','ic_anadolu'),('Eskişehir','ic_anadolu'),('Kayseri','ic_anadolu'),
  ('Sivas','ic_anadolu'),('Yozgat','ic_anadolu'),('Çankırı','ic_anadolu'),('Kırıkkale','ic_anadolu'),
  ('Kırşehir','ic_anadolu'),('Niğde','ic_anadolu'),('Nevşehir','ic_anadolu'),('Aksaray','ic_anadolu'),
  ('Karaman','ic_anadolu'),
  -- KARADENİZ (18)
  ('Trabzon','karadeniz'),('Samsun','karadeniz'),('Ordu','karadeniz'),('Giresun','karadeniz'),
  ('Rize','karadeniz'),('Artvin','karadeniz'),('Gümüşhane','karadeniz'),('Bayburt','karadeniz'),
  ('Sinop','karadeniz'),('Kastamonu','karadeniz'),('Çorum','karadeniz'),('Tokat','karadeniz'),
  ('Amasya','karadeniz'),('Bartın','karadeniz'),('Karabük','karadeniz'),('Zonguldak','karadeniz'),
  ('Bolu','karadeniz'),('Düzce','karadeniz'),
  -- DOĞU ANADOLU (14)
  ('Erzurum','dogu_anadolu'),('Erzincan','dogu_anadolu'),('Kars','dogu_anadolu'),('Iğdır','dogu_anadolu'),
  ('Ardahan','dogu_anadolu'),('Ağrı','dogu_anadolu'),('Bingöl','dogu_anadolu'),('Bitlis','dogu_anadolu'),
  ('Elazığ','dogu_anadolu'),('Hakkari','dogu_anadolu'),('Malatya','dogu_anadolu'),('Muş','dogu_anadolu'),
  ('Tunceli','dogu_anadolu'),('Van','dogu_anadolu'),
  -- GÜNEYDOĞU ANADOLU (9)
  ('Gaziantep','guneydogu'),('Şanlıurfa','guneydogu'),('Diyarbakır','guneydogu'),('Mardin','guneydogu'),
  ('Batman','guneydogu'),('Siirt','guneydogu'),('Şırnak','guneydogu'),('Kilis','guneydogu'),
  ('Adıyaman','guneydogu')
on conflict (il) do nothing;

-- ════════════════════════════════════════════════════════════
-- 2) harcirah_bolge_tarife — Firma bazlı bölge km birimi
-- ════════════════════════════════════════════════════════════
create table if not exists public.harcirah_bolge_tarife (
  firma_id  uuid not null references public.firmalar(id) on delete cascade,
  bolge     text not null check (bolge in (
    'marmara','ege','akdeniz','ic_anadolu','karadeniz','dogu_anadolu','guneydogu'
  )),
  km_birim  numeric not null check (km_birim > 0),
  aktif_mi  boolean not null default true,
  notlar    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (firma_id, bolge)
);
create index if not exists idx_harcirah_bolge_tarife_firma on public.harcirah_bolge_tarife(firma_id);

-- ════════════════════════════════════════════════════════════
-- 3) harcirah_il_tarife — İl bazlı override (bölgeyi ezer)
-- ════════════════════════════════════════════════════════════
create table if not exists public.harcirah_il_tarife (
  firma_id     uuid not null references public.firmalar(id) on delete cascade,
  il           text not null,
  km_birim     numeric check (km_birim is null or km_birim > 0),
  sabit_tutar  numeric check (sabit_tutar is null or sabit_tutar >= 0),
  aktif_mi     boolean not null default true,
  notlar       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (firma_id, il),
  -- Ya km_birim ya sabit_tutar olmalı (ikisi birden veya hiçbiri olmamalı)
  check ((km_birim is not null)::int + (sabit_tutar is not null)::int = 1)
);
create index if not exists idx_harcirah_il_tarife_firma on public.harcirah_il_tarife(firma_id);

-- ════════════════════════════════════════════════════════════
-- 4) harcirah_kural_seti — Firma bazlı genel kurallar
-- ════════════════════════════════════════════════════════════
create table if not exists public.harcirah_kural_seti (
  firma_id              uuid primary key references public.firmalar(id) on delete cascade,
  -- Dolu/boş dönüş ek yüzdesi (ana harcırah üzerine)
  dolu_donus_yuzde      numeric not null default 50  check (dolu_donus_yuzde  >= 0 and dolu_donus_yuzde  <= 200),
  bos_donus_yuzde       numeric not null default 0   check (bos_donus_yuzde   >= 0 and bos_donus_yuzde   <= 100),
  -- Minimum harcırah (en kısa işin bile altına düşmeyeceği taban)
  minimum_tutar         numeric not null default 600 check (minimum_tutar >= 0),
  -- Mesafe kademeleri (uzun yolda ek yüzde)
  kademe_500plus_yuzde  numeric not null default 0   check (kademe_500plus_yuzde  >= 0 and kademe_500plus_yuzde  <= 100),
  kademe_900plus_yuzde  numeric not null default 0   check (kademe_900plus_yuzde  >= 0 and kademe_900plus_yuzde  <= 100),
  -- Konaklama (>= konaklama_min_km mesafede otomatik eklenir)
  konaklama_aktif       boolean not null default false,
  konaklama_min_km      integer not null default 900 check (konaklama_min_km > 0),
  konaklama_tutar       numeric not null default 0   check (konaklama_tutar >= 0),
  -- Not alanı
  notlar                text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════
-- 5) RLS — Sürücüler okuyabilir (kendi hesabını görsün), yetkililer yönetir
-- ════════════════════════════════════════════════════════════
alter table public.tr_il_bolge            enable row level security;
alter table public.harcirah_bolge_tarife  enable row level security;
alter table public.harcirah_il_tarife     enable row level security;
alter table public.harcirah_kural_seti    enable row level security;

-- tr_il_bolge: herkese SELECT (sistem geneli sabit veri, gizli değil)
drop policy if exists tr_il_bolge_select on public.tr_il_bolge;
create policy tr_il_bolge_select on public.tr_il_bolge
  for select to authenticated using (true);

-- harcirah_bolge_tarife: firma üyeleri SELECT, yetkililer yazabilir
drop policy if exists harcirah_bolge_tarife_select on public.harcirah_bolge_tarife;
create policy harcirah_bolge_tarife_select on public.harcirah_bolge_tarife
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists harcirah_bolge_tarife_modify on public.harcirah_bolge_tarife;
create policy harcirah_bolge_tarife_modify on public.harcirah_bolge_tarife
  for all to authenticated
  using      (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- harcirah_il_tarife: aynı pattern
drop policy if exists harcirah_il_tarife_select on public.harcirah_il_tarife;
create policy harcirah_il_tarife_select on public.harcirah_il_tarife
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists harcirah_il_tarife_modify on public.harcirah_il_tarife;
create policy harcirah_il_tarife_modify on public.harcirah_il_tarife
  for all to authenticated
  using      (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- harcirah_kural_seti: aynı pattern
drop policy if exists harcirah_kural_seti_select on public.harcirah_kural_seti;
create policy harcirah_kural_seti_select on public.harcirah_kural_seti
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

drop policy if exists harcirah_kural_seti_modify on public.harcirah_kural_seti;
create policy harcirah_kural_seti_modify on public.harcirah_kural_seti
  for all to authenticated
  using      (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- ════════════════════════════════════════════════════════════
-- 6) updated_at otomatik güncelleme trigger'ları
-- ════════════════════════════════════════════════════════════
create or replace function public._set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_harcirah_bolge_tarife_upd on public.harcirah_bolge_tarife;
create trigger trg_harcirah_bolge_tarife_upd before update on public.harcirah_bolge_tarife
  for each row execute function public._set_updated_at();

drop trigger if exists trg_harcirah_il_tarife_upd on public.harcirah_il_tarife;
create trigger trg_harcirah_il_tarife_upd before update on public.harcirah_il_tarife
  for each row execute function public._set_updated_at();

drop trigger if exists trg_harcirah_kural_seti_upd on public.harcirah_kural_seti;
create trigger trg_harcirah_kural_seti_upd before update on public.harcirah_kural_seti
  for each row execute function public._set_updated_at();

comment on table public.harcirah_bolge_tarife is 'Firma bazlı bölge km birim tarifeleri. Yakın bölgelerde harcirah_tarifeleri sabit tarifeler kullanılır; uzak iller için bölge × km hesabı yapılır.';
comment on table public.harcirah_il_tarife    is 'İl bazlı km birim VEYA sabit tutar (örn. Aydın=7 TL/km, Trabzon=9 TL/km). Eşleşen il varsa bölge tarifesini override eder.';
comment on table public.harcirah_kural_seti   is 'Firma bazlı kurallar: dolu dönüş %, kademe yüzdeleri, konaklama, minimum.';
