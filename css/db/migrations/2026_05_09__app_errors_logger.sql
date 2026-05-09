-- 2026-05-09 — DIY Error Logger: app_errors tablosu
--
-- AMAÇ:
--   Sahada şoför/yönetici hata aldığında ekran görüntüsü + console paylaşması
--   şart olmasın. Web `window.onerror` + `unhandledrejection` + console.error,
--   Mobile `CoroutineExceptionHandler` + Timber otomatik bu tabloya yazar.
--   Geliştirici Supabase'den filtreli sorgu ile son hataları görür.
--
-- VERİ MODELİ:
--   firma_id, user_id NULL olabilir (auth bozuk durumda da log girsin).
--   platform: 'web' | 'android'
--   severity: 'error' | 'warn' | 'info'  (info nadir kullanılır)
--   resolved: işaretlenebilir, "bu bug fix edildi" notu için
--
-- RLS:
--   INSERT: authenticated role (auth bozuksa zaten 401 yakalayıcı reload yapar)
--   SELECT: yalnızca firma yetkilisi (yönetici) — kendi firmasının log'ları
--   UPDATE: yalnızca firma yetkilisi (resolved işareti vb.)

begin;

create table if not exists public.app_errors (
  id          bigserial primary key,
  firma_id    uuid references public.firmalar(id) on delete set null,
  user_id     uuid references auth.users(id)     on delete set null,
  user_email  text,
  platform    text not null check (platform in ('web', 'android')),
  severity    text not null default 'error' check (severity in ('error', 'warn', 'info')),
  message     text not null,
  stack       text,
  source      text,         -- "file:line:col" (web) veya class.method (android)
  url         text,          -- web: location.href; android: aktivite/ekran adı
  user_agent  text,          -- web: navigator.userAgent; android: build/device
  context     jsonb,         -- ek bilgi: build versiyonu, ekran, vb.
  resolved    boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_note text,
  created_at  timestamptz not null default now()
);

-- En sık sorgu: bir firmanın son N hatası
create index if not exists idx_app_errors_firma_created
  on public.app_errors (firma_id, created_at desc);

-- "Çözülmemiş" filtreli sorgu (panel için partial index)
create index if not exists idx_app_errors_unresolved
  on public.app_errors (firma_id, created_at desc)
  where resolved = false;

-- Severity filtresi
create index if not exists idx_app_errors_severity
  on public.app_errors (severity, created_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.app_errors enable row level security;

drop policy if exists app_errors_insert on public.app_errors;
create policy app_errors_insert on public.app_errors
  for insert to authenticated
  with check (true);  -- firma_id NULL olabilir (auth bozuk), insert serbest

drop policy if exists app_errors_select on public.app_errors;
create policy app_errors_select on public.app_errors
  for select to authenticated
  using (
    firma_id in (select public._user_firma_yetkili_ids())
    or firma_id is null   -- orphan log'lar (auth bozuk durumda) admin görsün
  );

drop policy if exists app_errors_update on public.app_errors;
create policy app_errors_update on public.app_errors
  for update to authenticated
  using (firma_id in (select public._user_firma_yetkili_ids()))
  with check (firma_id in (select public._user_firma_yetkili_ids()));

-- ── Otomatik temizleme: 30 günden eski resolved log'ları sil ───────────────
-- Cron yerine manuel: developer haftada bir çalıştırabilir, veya
-- pg_cron mevcutsa schedule edilebilir. Şimdilik fonksiyon olarak.
create or replace function public.app_errors_cleanup(p_days int default 30)
returns int
language plpgsql
security definer
as $$
declare
  v_deleted int;
begin
  delete from public.app_errors
   where resolved = true
     and resolved_at < now() - (p_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.app_errors_cleanup(int) from public;
grant execute on function public.app_errors_cleanup(int) to authenticated;

comment on table public.app_errors is 'DIY error logger. Web/mobile uygulamalar otomatik buraya yazar. Yönetici Supabase Dashboard veya admin paneli üzerinden inceler.';

commit;
