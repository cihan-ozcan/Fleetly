-- =============================================================================
-- FLEETLY  —  2026-05-11j  —  Şoför Güzergah Paylaşım Sistemi (şema)
-- =============================================================================
-- AÇIK:
--   Şoför, X fabrika/limana gittiği TIR için doğru bilinen güzergahı diğer
--   çalışma arkadaşlarıyla paylaşabilsin. Bazı yollar TIR için fiziksel olarak
--   uygun değil (alçak köprü, dar sokak, ağırlık limiti, yasak). Deneyimli
--   şoför "buradan değil, şuradan dönüyorsun" der; bu bilgi yazılı kalmadığı
--   için yeni şoför aynı yanlışı yapıyor. Kolektif zekâ ile gizli müşteri
--   kayıpları (gecikme, yakıt, ceza) engellenir.
--
-- ÇÖZÜM:
--   3 tablo + indeksler + RLS + realtime publication:
--     1) guzergahlar               — ana güzergah (polyline, hedef, sayaçlar)
--     2) guzergah_kullanim_log     — kim/ne zaman/hangi iş emrinde kullandı
--     3) guzergah_begeniler        — beğeni (toggle, PK guzergah_id+surucu_id)
--   Polyline Google "Encoded Polyline" formatında (kompakt) saklanır;
--   bitiş noktası PostGIS generated kolonla indekslenir (hedef öneri sorgusu).
--   RPC'ler ayrı migration'da (2026_05_11k).
--
--   ⚠️ CROSS-FIRMA gizlilik='platform' UI'dan kapalı tutulur. RLS SELECT
--   yalnızca firma içi (firma_id IN _user_firma_ids). Enum'da kalır ileride
--   tasarım turu için ama şu an etkin değil. (Memory:
--    project_guzergah_cross_firma_reddedildi.)
--
-- BAĞIMLILIK:
--   2026_05_06l__limanlar_ve_ziyaretler.sql      (PostGIS extension + limanlar)
--   2026_05_07b__rls_emergency_fix.sql           (_user_firma_ids helper)
--   firmalar / suruculer / is_emirleri / firma_kullanicilar mevcut tablolar
--
-- GERİ ALMA:
--   drop table public.guzergah_begeniler;
--   drop table public.guzergah_kullanim_log;
--   drop table public.guzergahlar;
--   drop function public.guzergahlar_updated_at_trg();
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ANA TABLO: guzergahlar
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.guzergahlar (
  id                    uuid primary key default gen_random_uuid(),
  firma_id              uuid not null references public.firmalar(id) on delete cascade,
  olusturan_surucu_id   uuid not null references public.suruculer(id) on delete cascade,

  -- Hedef: limanlar tablosuna referans varsa (polygon match), yoksa serbest text
  hedef_liman_id        uuid references public.limanlar(id) on delete set null,
  hedef_ad              text not null,

  -- Başlangıç noktası
  baslangic_lat         double precision not null,
  baslangic_lng         double precision not null,
  baslangic_ad          text,

  -- Bitiş noktası
  bitis_lat             double precision not null,
  bitis_lng             double precision not null,

  -- PostGIS: hedef öneri sorgusu (ST_DWithin) için indekslenebilir kolon.
  -- Generated column → INSERT/UPDATE'te otomatik üretilir, manuel set gerekmez.
  bitis_geo             geometry(Point, 4326) generated always as
                          (ST_SetSRID(ST_MakePoint(bitis_lng, bitis_lat), 4326)) stored,

  -- Polyline (Google encoded polyline formatı — kompakt, ~10x küçük)
  polyline_encoded      text not null,
  -- LineString geometry (opsiyonel — ileride ST_PointN / yakın güzergah sorgusu için).
  -- Şimdilik client encode ediyor; PostgreSQL tarafında decode yok → NULL bırakılır.
  polyline_geo          geometry(LineString, 4326),

  -- Metadata
  baslik                text not null,
  notlar                text,
  mesafe_km             numeric,
  tahmini_sure_dk       integer,

  -- Sosyal sayaçlar (denormalize — RPC'lerde inc/dec edilir; trigger gerekmez)
  begeni_sayisi         integer not null default 0,
  kullanim_sayisi       integer not null default 0,

  -- Yönetim
  durum                 text not null default 'aktif'
                          check (durum in ('aktif','reddedildi','silindi')),
  gizlilik              text not null default 'firma'
                          check (gizlilik in ('firma','platform')),
  yonetici_notu         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.guzergahlar is
  'Şoför güzergah paylaşımı — TIR için doğru bilinen yol bilgisi. 2026-05-11j.';
comment on column public.guzergahlar.polyline_encoded is
  'Google encoded polyline (developers.google.com/maps/documentation/utilities/polylinealgorithm).';
comment on column public.guzergahlar.gizlilik is
  'firma=yalnız firma içi (default, etkin), platform=enum''da ama RLS''de etkin değil.';
comment on column public.guzergahlar.durum is
  'aktif=görünür, reddedildi=yönetici reddetti (gizli), silindi=soft delete.';

create index if not exists idx_guzergah_firma_hedef
  on public.guzergahlar (firma_id, hedef_liman_id, durum)
  where durum = 'aktif';

create index if not exists idx_guzergah_firma_aktif
  on public.guzergahlar (firma_id, durum, created_at desc)
  where durum = 'aktif';

create index if not exists idx_guzergah_bitis_geo
  on public.guzergahlar using gist (bitis_geo)
  where durum = 'aktif';

create index if not exists idx_guzergah_polyline_geo
  on public.guzergahlar using gist (polyline_geo)
  where polyline_geo is not null;

create index if not exists idx_guzergah_kullanim
  on public.guzergahlar (firma_id, kullanim_sayisi desc)
  where durum = 'aktif';

create index if not exists idx_guzergah_surucu
  on public.guzergahlar (olusturan_surucu_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) KULLANIM LOGU: guzergah_kullanim_log
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.guzergah_kullanim_log (
  id            bigserial primary key,
  guzergah_id   uuid not null references public.guzergahlar(id) on delete cascade,
  surucu_id     uuid not null references public.suruculer(id) on delete cascade,
  firma_id      uuid not null references public.firmalar(id) on delete cascade,
  is_emri_id    bigint references public.is_emirleri(id) on delete set null,
  kullanim_at   timestamptz not null default now()
);

comment on table public.guzergah_kullanim_log is
  'Şoför güzergahı Google Maps''te açtığında log. kullanim_sayisi sayacı RPC içinde inc edilir.';

create index if not exists idx_guzergah_log_g
  on public.guzergah_kullanim_log (guzergah_id, kullanim_at desc);
create index if not exists idx_guzergah_log_firma
  on public.guzergah_kullanim_log (firma_id, kullanim_at desc);
create index if not exists idx_guzergah_log_surucu
  on public.guzergah_kullanim_log (surucu_id, kullanim_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) BEĞENİLER: guzergah_begeniler
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.guzergah_begeniler (
  guzergah_id   uuid not null references public.guzergahlar(id) on delete cascade,
  surucu_id     uuid not null references public.suruculer(id) on delete cascade,
  begeni_at     timestamptz not null default now(),
  primary key (guzergah_id, surucu_id)
);

comment on table public.guzergah_begeniler is
  'Güzergah beğeni toggle. PK ile dup engellenir; sayaç RPC içinde inc/dec edilir.';

create index if not exists idx_guzergah_begeni_surucu
  on public.guzergah_begeniler (surucu_id, begeni_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guzergahlar_updated_at_trg()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guzergahlar_updated_at on public.guzergahlar;
create trigger trg_guzergahlar_updated_at
  before update on public.guzergahlar
  for each row execute function public.guzergahlar_updated_at_trg();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RLS — firma içi izolasyon (cross-firma "platform" RLS'de etkin değil)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.guzergahlar             enable row level security;
alter table public.guzergah_kullanim_log   enable row level security;
alter table public.guzergah_begeniler      enable row level security;

-- ---- guzergahlar SELECT ----
-- Şoför + yönetici, kendi firmalarının aktif/reddedilmiş güzergahlarını görür.
-- "silindi" durumdaki güzergahlar kimseye görünmez (yönetici dahil; gerekirse
-- ayrı admin view ile gösterilir).
drop policy if exists guzergah_select on public.guzergahlar;
create policy guzergah_select on public.guzergahlar
  for select to authenticated
  using (
    firma_id in (select public._user_firma_ids())
    and durum <> 'silindi'
  );

-- INSERT/UPDATE/DELETE direkt kapalı — RPC zorunlu (SECURITY DEFINER + içeride
-- yetki + iş kuralı kontrolü). RLS'de policy tanımlamıyoruz → default deny.

-- ---- guzergah_kullanim_log SELECT ----
-- Firma içi kullanım istatistikleri (yönetici dashboard'u + şoför "kullanım sayısı").
drop policy if exists guzergah_log_select on public.guzergah_kullanim_log;
create policy guzergah_log_select on public.guzergah_kullanim_log
  for select to authenticated
  using (firma_id in (select public._user_firma_ids()));

-- INSERT direkt kapalı — RPC guzergah_kullanildi içeriden insert eder.

-- ---- guzergah_begeniler SELECT ----
-- Aynı firmadaki güzergahlara ait beğenileri görme (şoför kendisinin beğendiği
-- güzergahları işaretleyebilsin diye).
drop policy if exists guzergah_begeni_select on public.guzergah_begeniler;
create policy guzergah_begeni_select on public.guzergah_begeniler
  for select to authenticated
  using (
    guzergah_id in (
      select g.id from public.guzergahlar g
      where g.firma_id in (select public._user_firma_ids())
    )
  );

-- INSERT/DELETE direkt kapalı — RPC guzergah_begen toggle eder.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) REALTIME PUBLICATION
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.guzergahlar;
    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.guzergah_begeniler;
    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.guzergah_kullanim_log;
    exception when duplicate_object then null; end;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Tablolar oluştu mu:
--    SELECT table_name FROM information_schema.tables
--     WHERE table_schema='public' AND table_name LIKE 'guzergah%'
--     ORDER BY table_name;
--    Beklenen: guzergah_begeniler, guzergah_kullanim_log, guzergahlar
--
-- 2) RLS aktif mi:
--    SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('guzergahlar','guzergah_kullanim_log','guzergah_begeniler');
--    Beklenen: hepsi true
--
-- 3) İndeksler:
--    SELECT indexname FROM pg_indexes
--     WHERE tablename='guzergahlar' ORDER BY indexname;
--    Beklenen 6 adet: idx_guzergah_bitis_geo, idx_guzergah_firma_aktif,
--      idx_guzergah_firma_hedef, idx_guzergah_kullanim, idx_guzergah_polyline_geo,
--      idx_guzergah_surucu
--
-- 4) Politika listesi (sadece SELECT olmalı; INSERT/UPDATE/DELETE policy YOK):
--    SELECT policyname, cmd FROM pg_policies
--     WHERE tablename='guzergahlar';
--    Beklenen: guzergah_select | SELECT
--
-- 5) Direct INSERT engelleniyor mu (RPC zorunlu):
--    INSERT INTO public.guzergahlar (firma_id, olusturan_surucu_id, hedef_ad,
--      baslangic_lat, baslangic_lng, bitis_lat, bitis_lng, polyline_encoded, baslik)
--    VALUES ('<firma_uuid>','<surucu_uuid>','Test',41.0,28.0,40.0,29.0,'_p~iF~ps|U_ulLnnqC_mqNvxq`@','Test');
--    Beklenen: RLS engeller (no policy → deny).
--
-- 6) PostGIS generated column çalışıyor mu:
--    SELECT id, ST_AsText(bitis_geo) FROM public.guzergahlar LIMIT 1;
--    Beklenen: POINT(lng lat)
-- =============================================================================
