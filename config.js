// ╔══════════════════════════════════════════════════════════════╗
// ║  config.js — Bu dosya .gitignore'da! Repoya GİTMEZ.         ║
// ║  Gerçek değerleri buraya girin.                              ║
// ╚══════════════════════════════════════════════════════════════╝

window.FILO_CONFIG = {
  SUPABASE_URL  : 'https://fjetoktgzpubegpvhhng.supabase.co',
  SUPABASE_ANON : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqZXRva3RnenB1YmVncHZoaG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTYwMjMsImV4cCI6MjA5MDczMjAyM30.WSTtAwD9vtm4fgJsa6K4DyLHFD4iUyGuF6qkR-0Uop0',

  // ── Web Push VAPID (npx web-push generate-vapid-keys ile üretin) ──
  // Ürettikten sonra buraya Public Key'i yapıştırın:
  VAPID_PUBLIC_KEY: 'BD9qOxaOfmLEfObwOqQv5MxqgQ5Oka28oHZgapdbiW-zoPo1hwJYkW57W6ZkHnxvWW_0o-5VnnV4s5mIcnIp24Y',

  // ── Google Analytics 4 (opsiyonel — boş bırakırsanız yüklenmez) ──
  // analytics.google.com → Admin → Data Streams → Web → fleetly.fit
  // Measurement ID: 'G-XXXXXXXXXX'
  GA4_ID: '',

  // ── Onboarding videosu (register.html sol panelinde) ──
  // YouTube video ID (ör. 'dQw4w9WgXcQ'). Boş ise card gizli.
  // Click-to-load — kullanıcı tıklamadan YouTube'a istek atılmaz.
  ONBOARDING_VIDEO_ID: '',
};
