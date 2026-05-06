/* =============================================================================
 * pdf-fonts.js — jsPDF için Türkçe karakter destekli font lazy loader
 * -----------------------------------------------------------------------------
 * jsPDF'in default Helvetica fontu sadece Latin-1 destekler — Türkçe karakterler
 * (ı, İ, ş, Ş, ğ, Ğ, ü, Ü, ö, Ö, ç, Ç) yanlış basılır. Bu modül:
 *
 *   • Roboto Latin-Ext TTF dosyalarını CDN'den fetch eder (Regular + Bold)
 *   • Base64'e çevirip jsPDF VFS'ine ekler
 *   • Fontu "Roboto" adıyla kaydeder (doc.setFont('Roboto'))
 *   • Cache'ler — sonraki PDF'lerde tekrar yüklemez
 *
 * Kullanım (PDF üretim fonksiyonunda):
 *
 *   const { jsPDF } = window.jspdf;
 *   const doc = new jsPDF();
 *   await PdfFonts.load(doc);
 *   doc.setFont('Roboto', 'normal');   // Türkçe destekli
 *   doc.text('Şoför Mehmet Yılmaz', 10, 20);
 *
 * ===========================================================================*/

(function () {
  'use strict';

  // Fontsource CDN — TTF dosyaları doğrudan, latin-ext alt-set Türkçe içerir
  const FONT_REGULAR_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/files/roboto-latin-ext-400-normal.ttf';
  const FONT_BOLD_URL    = 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/files/roboto-latin-ext-700-normal.ttf';

  let _cache = null;          // { regular: base64, bold: base64 }
  let _loadPromise = null;    // re-entrancy: aynı anda iki PDF üretimi olursa tek fetch

  async function _arrayBufferToBase64(buf) {
    // Büyük buffer'lar için chunk'lı base64 (yığın taşmasını önler)
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  async function _fetchFonts() {
    if (_cache) return _cache;
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      try {
        const [regBuf, boldBuf] = await Promise.all([
          fetch(FONT_REGULAR_URL).then(r => {
            if (!r.ok) throw new Error('Regular font ' + r.status);
            return r.arrayBuffer();
          }),
          fetch(FONT_BOLD_URL).then(r => {
            if (!r.ok) throw new Error('Bold font ' + r.status);
            return r.arrayBuffer();
          })
        ]);
        _cache = {
          regular: await _arrayBufferToBase64(regBuf),
          bold:    await _arrayBufferToBase64(boldBuf)
        };
        return _cache;
      } catch (err) {
        _loadPromise = null;  // tekrar denenebilir
        throw err;
      }
    })();

    return _loadPromise;
  }

  /**
   * jsPDF doc'una Roboto fontunu yükler ve aktif font olarak set eder.
   * Hata olursa false döner — çağıran fallback'a (Helvetica + ascii çevirisi) düşebilir.
   */
  async function load(doc) {
    if (!doc || typeof doc.addFileToVFS !== 'function') {
      console.warn('[PdfFonts] doc geçersiz');
      return false;
    }
    try {
      const fonts = await _fetchFonts();
      doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold);
      doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      doc.setFont('Roboto', 'normal');
      return true;
    } catch (err) {
      console.warn('[PdfFonts] yüklenemedi:', err.message);
      return false;
    }
  }

  /** Fontların önceden yüklenmesi (uygulama açılışında "warm cache" için). */
  function preload() {
    return _fetchFonts().catch(() => null);
  }

  function isCached() { return _cache != null; }

  window.PdfFonts = { load, preload, isCached };
})();
