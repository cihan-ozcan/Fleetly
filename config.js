// ╔══════════════════════════════════════════════════════════════╗
// ║  config.js — Bu dosya .gitignore'da! Repoya GİTMEZ.         ║
// ║  Gerçek değerleri buraya girin.                              ║
// ╚══════════════════════════════════════════════════════════════╝

window.FILO_CONFIG = {
  SUPABASE_URL  : 'https://fjetoktgzpubegpvhhng.supabase.co',
  SUPABASE_ANON : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqZXRva3RnenB1YmVncHZoaG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTYwMjMsImV4cCI6MjA5MDczMjAyM30.WSTtAwD9vtm4fgJsa6K4DyLHFD4iUyGuF6qkR-0Uop0',
};

let currentFirmaId = null;

async function loadFirmaId() {
  const { data } = await _sb
    .from('firma_kullanicilar')
    .select('firma_id')
    .single();
  currentFirmaId = data?.firma_id || null;
}
