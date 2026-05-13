-- =============================================================================
-- FLEETLY  —  2026-05-13b  —  konum_izleri Realtime Publication
-- =============================================================================
-- AÇIK:
--   Operasyon canlı takip sayfası şu an `is_emirleri.konum_lat/lng/zaman` üzerinden
--   sürücü konumunu okuyor. Bu kolonlar her sample'da UPDATE ediliyor ve realtime
--   publication'da olduğu için push gönderiyor.
--
--   AMA `konum_izleri` tablosu (geçmiş iz, polyline, hız analizi) realtime'a
--   dahil DEĞİL. Operasyoncu canlı takip sayfasında 24 saatlik izi görmek için
--   sayfa açıldığında bir kez fetch eder; sonradan yeni sample'lar gelmez —
--   refresh basana kadar polyline güncellenmez.
--
-- ÇÖZÜM:
--   konum_izleri'yi supabase_realtime publication'a ekle. Web tarafı INSERT
--   event'leriyle polyline'a yeni sample eklemek için subscribe edebilir.
--   Mevcut çalışan publication'larda kullanılan idempotent pattern uygulanır.
--
-- BAĞIMLILIK:
--   2026_04_29__konum_izleri_guzergah.sql (tablo)
--   2026_05_13a__konum_outlier_guard.sql  (önceki — sıralı çalışsın)
--
-- GERİ ALMA:
--   alter publication supabase_realtime drop table public.konum_izleri;
--
-- NOT:
--   - REPLICA IDENTITY varsayılan kalır. konum_izleri INSERT-only kullanılıyor
--     (BEFORE INSERT trigger var ama UPDATE/DELETE yok), bu yüzden tüm payload
--     INSERT'te gelir.
--   - Web canlı takip subscribe pattern'i Faz 5+'te eklenecek (şu an polling
--     ile yetiniliyor; bu migration alt yapıyı hazırlar).
-- =============================================================================

begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.konum_izleri;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
-- 1) Publication'a dahil mi:
--    select tablename
--      from pg_publication_tables
--     where pubname = 'supabase_realtime'
--       and schemaname = 'public'
--       and tablename = 'konum_izleri';
--    Beklenen: 1 satır (konum_izleri).
--
-- 2) Tekrar çalıştırma idempotent mi:
--    Migration'ı 2. kez çalıştır → hata vermeden tamamlanmalı.
-- =============================================================================
