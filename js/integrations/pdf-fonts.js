/* =============================================================================
 * pdf-fonts.js — jsPDF için Türkçe karakter destekli font lazy loader
 * -----------------------------------------------------------------------------
 * jsPDF'in default Helvetica fontu sadece Latin-1 destekler — Türkçe karakterler
 * (ı, İ, ş, Ş, ğ, Ğ, ü, Ü, ö, Ö, ç, Ç) yanlış basılır.
 *
 * Bu modül 2 font ailesi yükler (Fontsource CDN, latin-ext subset):
 *   • Roboto (sans-serif)         — Regular + Bold + Italic + BoldItalic
 *   • Newsreader (editorial serif) — Regular + Italic (büyük H1 başlıklar için)
 *
 * Mono için jsPDF'in native Courier fontu kullanılır (ek yük yok). Courier
 * Latin-1 olduğundan tabular sayıları (TL, %, km) doğru basar; Türkçe metin
 * mono ile basılmaz, sadece numerik içerik gider.
 *
 * Kullanım:
 *
 *   const { jsPDF } = window.jspdf;
 *   const doc = new jsPDF();
 *   const ok = await PdfFonts.load(doc, { serif: true });   // ikisini de yükler
 *   doc.setFont('Roboto', 'normal');     // Türkçe sans
 *   doc.setFont('Newsreader', 'italic'); // Türkçe italic serif (H1)
 *   doc.setFont('courier', 'normal');    // tabular sayılar (native)
 * ===========================================================================*/

(function () {
  'use strict';

  // Fontsource CDN — Latin-Ext subset Türkçe içerir
  const URLS = {
    robotoRegular:    'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/files/roboto-latin-ext-400-normal.ttf',
    robotoBold:       'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/files/roboto-latin-ext-700-normal.ttf',
    robotoItalic:     'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/files/roboto-latin-ext-400-italic.ttf',
    robotoBoldItalic: 'https://cdn.jsdelivr.net/fontsource/fonts/roboto@latest/files/roboto-latin-ext-700-italic.ttf',
    newsreaderRegular:'https://cdn.jsdelivr.net/fontsource/fonts/newsreader@latest/files/newsreader-latin-ext-400-normal.ttf',
    newsreaderItalic: 'https://cdn.jsdelivr.net/fontsource/fonts/newsreader@latest/files/newsreader-latin-ext-400-italic.ttf',
  };

  let _cacheSans = null;       // { regular, bold, italic, boldItalic }
  let _cacheSerif = null;      // { regular, italic }
  let _loadSansPromise = null;
  let _loadSerifPromise = null;

  async function _ab2b64(buf) {
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  async function _fetchAsB64(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('font ' + r.status + ' ' + url);
    return _ab2b64(await r.arrayBuffer());
  }

  async function _fetchSans() {
    if (_cacheSans) return _cacheSans;
    if (_loadSansPromise) return _loadSansPromise;
    _loadSansPromise = (async () => {
      try {
        const [reg, bold, ita, bita] = await Promise.all([
          _fetchAsB64(URLS.robotoRegular),
          _fetchAsB64(URLS.robotoBold),
          _fetchAsB64(URLS.robotoItalic).catch(() => null),
          _fetchAsB64(URLS.robotoBoldItalic).catch(() => null),
        ]);
        _cacheSans = { regular: reg, bold: bold, italic: ita, boldItalic: bita };
        return _cacheSans;
      } catch (err) {
        _loadSansPromise = null;
        throw err;
      }
    })();
    return _loadSansPromise;
  }

  async function _fetchSerif() {
    if (_cacheSerif) return _cacheSerif;
    if (_loadSerifPromise) return _loadSerifPromise;
    _loadSerifPromise = (async () => {
      try {
        const [reg, ita] = await Promise.all([
          _fetchAsB64(URLS.newsreaderRegular),
          _fetchAsB64(URLS.newsreaderItalic),
        ]);
        _cacheSerif = { regular: reg, italic: ita };
        return _cacheSerif;
      } catch (err) {
        _loadSerifPromise = null;
        throw err;
      }
    })();
    return _loadSerifPromise;
  }

  /**
   * jsPDF doc'una fontları yükler.
   * @param {jsPDF} doc
   * @param {Object} opts
   * @param {boolean} [opts.serif=false]  — Newsreader (büyük italic H1 için)
   * @returns {Promise<{sans:boolean, serif:boolean}>}
   */
  async function load(doc, opts) {
    opts = opts || {};
    const wantSerif = !!opts.serif;
    const result = { sans: false, serif: false };
    if (!doc || typeof doc.addFileToVFS !== 'function') {
      console.warn('[PdfFonts] doc geçersiz');
      return result;
    }

    // Sans her zaman yüklenir — Türkçe gövde metni için zorunlu
    try {
      const f = await _fetchSans();
      doc.addFileToVFS('Roboto-Regular.ttf', f.regular);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.addFileToVFS('Roboto-Bold.ttf', f.bold);
      doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      if (f.italic) {
        doc.addFileToVFS('Roboto-Italic.ttf', f.italic);
        doc.addFont('Roboto-Italic.ttf', 'Roboto', 'italic');
      }
      if (f.boldItalic) {
        doc.addFileToVFS('Roboto-BoldItalic.ttf', f.boldItalic);
        doc.addFont('Roboto-BoldItalic.ttf', 'Roboto', 'bolditalic');
      }
      doc.setFont('Roboto', 'normal');
      result.sans = true;
    } catch (err) {
      console.warn('[PdfFonts] Roboto yüklenemedi:', err.message);
    }

    if (wantSerif) {
      try {
        const f = await _fetchSerif();
        doc.addFileToVFS('Newsreader-Regular.ttf', f.regular);
        doc.addFont('Newsreader-Regular.ttf', 'Newsreader', 'normal');
        doc.addFileToVFS('Newsreader-Italic.ttf', f.italic);
        doc.addFont('Newsreader-Italic.ttf', 'Newsreader', 'italic');
        result.serif = true;
      } catch (err) {
        console.warn('[PdfFonts] Newsreader yüklenemedi:', err.message);
      }
    }
    return result;
  }

  /** Uygulama açılışında "warm cache" için ön-yükleme. */
  function preload(opts) {
    const tasks = [_fetchSans().catch(() => null)];
    if (opts && opts.serif) tasks.push(_fetchSerif().catch(() => null));
    return Promise.all(tasks);
  }

  function isCached() { return { sans: _cacheSans != null, serif: _cacheSerif != null }; }

  window.PdfFonts = { load, preload, isCached };
})();
