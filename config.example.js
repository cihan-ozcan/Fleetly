// ╔══════════════════════════════════════════════════════════════╗
// ║  config.example.js — Bu dosya repoya gider (örnek şablon).  ║
// ║                                                              ║
// ║  Kullanım:                                                   ║
// ║    1. Bu dosyayı kopyalayın → config.js                     ║
// ║    2. Kendi Supabase bilgilerinizi girin                     ║
// ║    3. config.js dosyasını .gitignore'a ekleyin               ║
// ╚══════════════════════════════════════════════════════════════╝

window.FILO_CONFIG = {
  SUPABASE_URL  : 'https://PROJE_ID.supabase.co',
  SUPABASE_ANON : 'eyJ...',

  // ─────────────────────────────────────────────────────────────
  // TRAFİK OVERLAY — opsiyonel
  // ─────────────────────────────────────────────────────────────
  // Filo haritalarında "🚦 Trafik" toggle'ı sadece bir anahtar
  // doluysa aktif olur. Hangisini yazarsanız o kullanılır:
  //
  //   TOMTOM_KEY    — ÖNERİLEN. 2.500 transaction/gün ücretsiz.
  //                   Türkiye trafiği iyi, sonrası $0.50 / 1.000.
  //                   Anahtar: https://developer.tomtom.com/
  //
  //   HERE_KEY      — Alternatif. 250K transaction/ay ücretsiz.
  //                   Anahtar: https://platform.here.com/
  //
  //   MAPBOX_TOKEN  — PAHALI. 200K yükleme/ay sonra $5 / 1.000.
  //                   Yalnızca abonelik almak istiyorsanız.
  //                   Anahtar: https://account.mapbox.com/access-tokens/
  //
  // Hiçbiri verilmezse "Trafik" butonu görünür ama disabled olur.
  // ─────────────────────────────────────────────────────────────
  TOMTOM_KEY   : '',
  HERE_KEY     : '',
  MAPBOX_TOKEN : '',

  // ─────────────────────────────────────────────────────────────
  // LİMAN GLOBAL DÜZENLEME — geçici flag
  // ─────────────────────────────────────────────────────────────
  // Pre-seed limanlar (Kumport, Marport, Mardaş, Galataport ...) global
  // (firma_id IS NULL) olarak yüklenir. Polygon'ları kabaca dikdörtgen.
  // Manuel ayar fazında (sahip kullanıcı sınırları düzeltirken) bu flag
  // true kalır → "Limanlar" sayfasında ✎ Düzenle ve 🗑 Sil butonları
  // global limanlarda da gözükür. Sınırlar bittikten sonra `false`
  // yaparak butonları gizleyin → kaza sonucu yanlış düzenlemeleri önler.
  //
  // NOT: false yapsanız da yetkili (sahip/yonetici) RPC üzerinden
  // doğrudan SQL ile düzenleyebilir — bu sadece UI gizliliği.
  // ─────────────────────────────────────────────────────────────
  LIMAN_GLOBAL_EDIT : true,
};
