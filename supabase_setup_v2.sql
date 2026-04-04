-- ================================================================
--  FILO TAKİP — Supabase Güvenlik Kurulumu (Mevcut Tablo için)
--  Supabase Dashboard → SQL Editor → Adım adım çalıştırın.
-- ================================================================


-- ════════════════════════════════════════════════════════════════
--  ADIM 1: user_id sütunlarını ekle (önce nullable olarak)
-- ════════════════════════════════════════════════════════════════

alter table araclar
  add column if not exists user_id uuid
  references auth.users(id) on delete cascade;

alter table yakit_girisleri
  add column if not exists user_id uuid
  references auth.users(id) on delete cascade;


-- ════════════════════════════════════════════════════════════════
--  ADIM 2: Kendi user_id'nizi bulun
--  (Bu sorguyu çalıştırın, çıkan UUID'yi kopyalayın)
-- ════════════════════════════════════════════════════════════════

select id, email, created_at
from auth.users
order by created_at desc;


-- ════════════════════════════════════════════════════════════════
--  ADIM 3: Mevcut tüm kayıtları size atayın
--  ↓ BURAYA_USER_ID yerine yukarıdan kopyaladığınız UUID'yi yazın
-- ════════════════════════════════════════════════════════════════

update araclar
  set user_id = 'BURAYA_USER_ID'
  where user_id is null;

update yakit_girisleri
  set user_id = 'BURAYA_USER_ID'
  where user_id is null;


-- ════════════════════════════════════════════════════════════════
--  ADIM 4: Sütunu zorunlu (NOT NULL) yap
-- ════════════════════════════════════════════════════════════════

alter table araclar
  alter column user_id set not null;

alter table yakit_girisleri
  alter column user_id set not null;


-- ════════════════════════════════════════════════════════════════
--  ADIM 5: RLS'i aç
-- ════════════════════════════════════════════════════════════════

alter table araclar         enable row level security;
alter table yakit_girisleri enable row level security;


-- ════════════════════════════════════════════════════════════════
--  ADIM 6: Eski "allow all" politikasını temizle, yenilerini ekle
-- ════════════════════════════════════════════════════════════════

-- Eski politikaları sil (varsa)
drop policy if exists "allow all"    on araclar;
drop policy if exists "allow all"    on yakit_girisleri;
drop policy if exists "araclar_select" on araclar;
drop policy if exists "araclar_insert" on araclar;
drop policy if exists "araclar_update" on araclar;
drop policy if exists "araclar_delete" on araclar;
drop policy if exists "yakit_select"   on yakit_girisleri;
drop policy if exists "yakit_insert"   on yakit_girisleri;
drop policy if exists "yakit_update"   on yakit_girisleri;
drop policy if exists "yakit_delete"   on yakit_girisleri;

-- ARAÇLAR: sadece kendi satırlarına erişim
create policy "araclar_select" on araclar
  for select using (auth.uid() = user_id);

create policy "araclar_insert" on araclar
  for insert with check (auth.uid() = user_id);

create policy "araclar_update" on araclar
  for update using (auth.uid() = user_id);

create policy "araclar_delete" on araclar
  for delete using (auth.uid() = user_id);

-- YAKIT GİRİŞLERİ: sadece kendi satırlarına erişim
create policy "yakit_select" on yakit_girisleri
  for select using (auth.uid() = user_id);

create policy "yakit_insert" on yakit_girisleri
  for insert with check (auth.uid() = user_id);

create policy "yakit_update" on yakit_girisleri
  for update using (auth.uid() = user_id);

create policy "yakit_delete" on yakit_girisleri
  for delete using (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════
--  ADIM 7: Performans indeksleri
-- ════════════════════════════════════════════════════════════════

create index if not exists idx_araclar_user_id
  on araclar(user_id);

create index if not exists idx_yakit_user_id
  on yakit_girisleri(user_id);

create index if not exists idx_yakit_arac_id
  on yakit_girisleri(arac_id);

create index if not exists idx_yakit_tarih
  on yakit_girisleri(tarih desc);


-- ════════════════════════════════════════════════════════════════
--  KONTROL: Her şey doğru mu? Bu sorgu sonuç döndürüyorsa tamam.
-- ════════════════════════════════════════════════════════════════

select
  (select count(*) from araclar)         as arac_sayisi,
  (select count(*) from yakit_girisleri) as yakit_kayit_sayisi;
