# Filo Takip Sistemi — Kurulum Rehberi

## 📁 Dosya Yapısı

```
filo-takip/
├── index.html              ← Ana uygulama (repoya gider ✅)
├── config.js               ← GİZLİ — repoya GİTMEZ ❌ (.gitignore'da)
├── config.example.js       ← Şablon — repoya gider ✅
├── supabase_setup.sql      ← Tablo + RLS kurulumu ✅
├── .gitignore              ← config.js'yi dışarıda tutar ✅
└── README.md
```

---

## 🚀 Kurulum Adımları

### 1. config.js Oluşturun
```bash
cp config.example.js config.js
```
`config.js` dosyasını açıp kendi Supabase bilgilerinizi girin:
```js
window.FILO_CONFIG = {
  SUPABASE_URL  : 'https://XXXXX.supabase.co',
  SUPABASE_ANON : 'eyJhbGciOiJIUzI1NiIsInR5cCI6...',
};
```

> ⚠️ `config.js` hiçbir zaman `git add` etmeyin. `.gitignore` bunu otomatik engeller.

---

### 2. Supabase Kurulumu

**a) Tabloları ve RLS politikalarını oluşturun:**
- Supabase Dashboard → SQL Editor'ü açın
- `supabase_setup.sql` içeriğini yapıştırın ve çalıştırın

**b) Kullanıcı ekleyin (sadece siz):**
- Authentication → Users → **Add User** butonuna tıklayın
- E-posta ve güçlü bir şifre belirleyin

**c) Yeni kayıtları kapatın:**
- Authentication → Providers → Email
- **"Enable Signups"** seçeneğini **KAPATIN**
- Böylece başka kimse kayıt olamaz

**d) Site URL'yi ayarlayın:**
- Authentication → URL Configuration
- Site URL: `https://KULLANICIADINI.github.io/REPO_ADI`

---

### 3. GitHub Pages Ayarı

1. Repository → Settings → Pages
2. Source: `Deploy from a branch` → `main` / `root`
3. Kaydedin — birkaç dakika içinde yayında olur

---

## 🔒 Güvenlik Mimarisi

| Katman | Eski Durum | Yeni Durum |
|--------|-----------|------------|
| Kimlik bilgileri | HTML içinde açık ✗ | `config.js` — gitignore'da ✅ |
| Giriş sistemi | SHA-256 hash, client-side ✗ | Supabase Auth (sunucu tarafı) ✅ |
| Oturum | localStorage flag ✗ | JWT token, otomatik yenileme ✅ |
| Veri erişimi | Anon key, tümü açık ✗ | RLS: sadece kendi verileriniz ✅ |
| Brute-force | Korumasız ✗ | 5 denemede 60 sn kilit ✅ |
| Şifre sıfırlama | Yok ✗ | E-posta ile sıfırlama ✅ |

### Row Level Security (RLS) Nasıl Çalışır?

Her tablo satırında `user_id` alanı vardır. Supabase'in RLS politikaları şunu yapar:

```sql
-- Kullanıcı sadece kendi user_id'sine eşit satırları görebilir
for select using (auth.uid() = user_id);
```

Yani anon key ele geçirilse bile: veritabanına istek atılabilir, ama **giriş yapılmadan tek satır bile okunamaz veya yazılamaz.**

---

## ⚠️ Mevcut Verileri Geçirme

Eski tablonuzda `user_id` sütunu yoksa SQL Editor'de:

```sql
-- 1. Sütun ekle
alter table araclar add column if not exists
  user_id uuid references auth.users(id) on delete cascade;

alter table yakit_girisleri add column if not exists
  user_id uuid references auth.users(id) on delete cascade;

-- 2. Kendi user ID'nizi bulun
select id from auth.users where email = 'sizin@email.com';

-- 3. Mevcut kayıtları size atayın
update araclar set user_id = 'BURAYA_USER_ID' where user_id is null;
update yakit_girisleri set user_id = 'BURAYA_USER_ID' where user_id is null;

-- 4. Sütunu zorunlu yapın
alter table araclar alter column user_id set not null;
alter table yakit_girisleri alter column user_id set not null;
```

---

## 🔑 Şifre Değiştirme

Uygulamaya girişten sonra Supabase Dashboard → Authentication → Users'dan şifre güncelleyebilirsiniz. Alternatif olarak giriş ekranındaki "Şifremi unuttum" bağlantısını kullanabilirsiniz.
