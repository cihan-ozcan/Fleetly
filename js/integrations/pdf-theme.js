/* =============================================================================
 * pdf-theme.js — Fleetly editorial PDF tasarım kütüphanesi
 * -----------------------------------------------------------------------------
 * Tüm PDF üretim noktalarında (yakıt, bakım, sefer, harcırah, POD, KPI,
 * yönetim raporu...) ortak görsel dil için helper modülü.
 *
 * Tasarım dili (yonetim raporu HTML şablonundan):
 *   • Krem zemin (#faf7f0) + koyu mürekkep (#15181c)
 *   • Newsreader (serif italic) — büyük H1 + § başlıklar + KPI değer + alıntı
 *   • Roboto (sans) — gövde, eyebrow caps, etiketler
 *   • Courier (mono) — tabular sayılar, sayfa numarası, belge no
 *   • Hairline çizgilerle bölümleme — koyu siyah ana ayraç + krem hairline
 *   • Köşe kayıt işaretleri (registration marks)
 *   • Tablo: krem zebra + mono right-align numlar + accent yeşil net kâr
 *   • Donut grafiği SVG arc taklidi
 *
 * Kullanım örneği:
 *
 *   const ctx = await PdfTheme.init({ orientation:'portrait' });
 *   PdfTheme.drawPageBg(ctx);
 *   let y = PdfTheme.drawTopbar(ctx, { brand:'Fleetly', meta:[
 *     { key:'Belge No', value:'FL-YR-2026-0510' },
 *     { key:'Sayfa',    value:'01 / 02' },
 *   ]});
 *   y = PdfTheme.drawTitleBlock(ctx, {
 *     title:'Yönetim', titleEm:'Raporu.',
 *     deck:'Filo operasyonlarına ait kapsamlı analiz.',
 *     badge:'Gizli — İç Kullanım', dateStamp:'10 . MAYIS . 2026', y:y+6
 *   });
 *   y = PdfTheme.drawMetaStrip(ctx, { y, items:[
 *     { key:'Dönem', value:'01.12.2025 — 10.05.2026' },
 *     { key:'Hazırlayan', value:'Operasyon' },
 *   ]});
 *   y = PdfTheme.drawKpiGrid(ctx, { y, items:[ ... ] });
 *   y = PdfTheme.drawSectionHead(ctx, { y, num:'01', title:'Gelir-Gider Analizi' });
 *   PdfTheme.drawFooter(ctx, { label:'Fleetly · Yönetim Raporu', pageNo:1, totalPages:2 });
 *   ctx.doc.save('rapor.pdf');
 * ===========================================================================*/

(function () {
  'use strict';

  // ── RENK PALETİ — HTML referansı ile birebir ──
  const COLOR = {
    paper:     [250, 247, 240],   // #faf7f0
    paper2:    [243, 236, 219],   // #f3ecdb
    ink:       [21, 24, 28],      // #15181c
    ink2:      [63, 68, 75],      // #3f444b
    ink3:      [139, 143, 150],   // #8b8f96
    ink4:      [184, 179, 163],   // #b8b3a3
    hairline:  [214, 207, 185],   // #d6cfb9
    hairline2: [232, 226, 207],   // #e8e2cf
    positive:  [31, 110, 68],     // #1f6e44
    negative:  [168, 57, 44],     // #a8392c
    accent:    [31, 110, 68],
    rowZebra:  [248, 245, 237],   // çok hafif krem
    plate:     [243, 236, 219],   // plaka rozeti zemin (paper2 ile aynı)
  };

  // ── SAYFA BOYUTLARI (mm) ──
  const PAGE = {
    A4_PORTRAIT:  { w: 210, h: 297 },
    A4_LANDSCAPE: { w: 297, h: 210 },
    margin: { top: 18, right: 18, bottom: 14, left: 18 },
  };

  // ── FONT İSİMLERİ ──
  const FONT = {
    serif:        'Newsreader',   // Fontsource
    serifFb:      'times',        // jsPDF native fallback
    sans:         'Roboto',       // Fontsource
    sansFb:       'helvetica',    // jsPDF native fallback
    mono:         'courier',      // jsPDF native (Latin-1, sadece sayılar için)
  };

  // Türkçe ASCII fallback (font yüklenemezse)
  function trAscii(s) {
    if (s == null) return '';
    return String(s)
      .replace(/ş/g,'s').replace(/Ş/g,'S')
      .replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U')
      .replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C')
      .replace(/ı/g,'i').replace(/İ/g,'I')
      .replace(/â/g,'a').replace(/Â/g,'A')
      .replace(/î/g,'i').replace(/Î/g,'I');
  }

  /**
   * Tema bağlamı oluşturur. jsPDF instance'ı yaratır, fontları yükler.
   * @param {Object} [opts]
   * @param {'portrait'|'landscape'} [opts.orientation='portrait']
   * @param {Object} [opts.margin]
   * @returns {Promise<Ctx>}
   */
  async function init(opts) {
    opts = opts || {};
    if (!window.jspdf) throw new Error('jsPDF yüklü değil');
    const { jsPDF } = window.jspdf;
    const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });

    // Font yükle (Türkçe için Roboto + editorial H1 için Newsreader)
    let loaded = { sans: false, serif: false };
    try {
      if (window.PdfFonts && typeof window.PdfFonts.load === 'function') {
        loaded = await window.PdfFonts.load(doc, { serif: true });
      }
    } catch (_) {}

    return _ctxFromDoc(doc, { orientation, margin: opts.margin, loaded });
  }

  /**
   * Var olan bir doc'tan bağlam oluşturur (font yükleme dış kontrole bırakılır).
   * Caller fontları kendisi yüklemişse `loaded.sans/serif` true geçilebilir.
   */
  function fromDoc(doc, opts) {
    return _ctxFromDoc(doc, opts || {});
  }

  function _ctxFromDoc(doc, opts) {
    const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
    const sz = orientation === 'landscape' ? PAGE.A4_LANDSCAPE : PAGE.A4_PORTRAIT;
    const margin = Object.assign({}, PAGE.margin, opts.margin || {});
    const loaded = opts.loaded || { sans: false, serif: false };

    const PW = sz.w, PH = sz.h;
    const ML = margin.left, MR = margin.right;
    const MT = margin.top,  MB = margin.bottom;
    const CW = PW - ML - MR;

    const sansName  = loaded.sans  ? FONT.sans  : FONT.sansFb;
    const serifName = loaded.serif ? FONT.serif : FONT.serifFb;
    // Roboto Türkçe destekli — pass-through; değilse ASCII'ye çevir
    const tr = loaded.sans ? (s => (s == null ? '' : String(s))) : trAscii;
    // Newsreader yoksa Times Italic kullanır → Türkçe yetersiz; serif metinler için ekstra ASCII
    const trSerif = loaded.serif ? tr : trAscii;

    function setFill(c)   { doc.setFillColor(c[0], c[1], c[2]); }
    function setStroke(c) { doc.setDrawColor(c[0], c[1], c[2]); }
    function setText(c)   { doc.setTextColor(c[0], c[1], c[2]); }
    function setSans(size, style)  { doc.setFont(sansName, style || 'normal'); doc.setFontSize(size); }
    function setSerif(size, style) { doc.setFont(serifName, style || 'normal'); doc.setFontSize(size); }
    function setMono(size, style)  { doc.setFont(FONT.mono, style || 'normal'); doc.setFontSize(size); }
    function hairline(w) { doc.setLineWidth(w == null ? 0.15 : w); }

    return {
      doc, PW, PH, ML, MR, MT, MB, CW,
      orientation, COLOR, FONT, loaded,
      tr, trSerif,
      setFill, setStroke, setText,
      setSans, setSerif, setMono,
      hairline,
    };
  }

  /** Sayfa zemini krem + köşe registration marks */
  function drawPageBg(ctx) {
    const { doc, PW, PH, COLOR, setFill } = ctx;
    setFill(COLOR.paper);
    doc.rect(0, 0, PW, PH, 'F');
    drawRegistrationMarks(ctx);
  }

  function drawRegistrationMarks(ctx) {
    const { doc, PW, PH, COLOR, setStroke, hairline } = ctx;
    setStroke(COLOR.ink3);
    hairline(0.25);
    // sol-üst: ⌐
    doc.line(8, 8, 12, 8);
    doc.line(8, 8, 8, 12);
    // sağ-alt: ⌐ döndürülmüş
    doc.line(PW - 8, PH - 8, PW - 12, PH - 8);
    doc.line(PW - 8, PH - 8, PW - 8, PH - 12);
  }

  /**
   * Üst bant: marka noktası + Fleetly + sağda "Belge No / Sürüm / Sayfa" key/value
   * y başlangıç noktası MT'dir; alt çizgi MT+8 civarındadır.
   * @returns {number} sonraki bloğun y'si (alt çizgiden ~10mm sonra)
   */
  function drawTopbar(ctx, opts) {
    const { doc, PW, ML, MR, MT, COLOR, tr, setText, setFill, setStroke, setSans, hairline } = ctx;
    opts = opts || {};
    const brand = opts.brand || 'Fleetly';
    const meta  = opts.meta  || [];
    const y = MT + 4;

    // Brand mark (küçük dolu daire)
    setFill(COLOR.ink);
    doc.circle(ML + 1.5, y - 1.4, 1.4, 'F');

    // Brand adı — caps spaced
    setText(COLOR.ink);
    setSans(8.5, 'bold');
    doc.text(tr(brand).toUpperCase(), ML + 5, y);

    // Sağdan sola meta yaz
    if (meta.length) {
      let x = PW - MR;
      const gap = 8;
      for (let i = meta.length - 1; i >= 0; i--) {
        const m = meta[i];
        const valTxt = ' ' + tr(m.value);
        const keyTxt = tr(m.key);
        doc.setFont(ctx.loaded.sans ? FONT.sans : FONT.sansFb, 'normal');
        doc.setFontSize(7.5);
        setText(COLOR.ink2);
        const vw = doc.getTextWidth(valTxt);
        doc.text(valTxt, x, y, { align: 'right' });
        x -= vw;
        doc.setFont(ctx.loaded.sans ? FONT.sans : FONT.sansFb, 'bold');
        setText(COLOR.ink);
        const kw = doc.getTextWidth(keyTxt);
        doc.text(keyTxt, x, y, { align: 'right' });
        x -= kw + gap;
      }
    }

    // Alt koyu siyah çizgi
    setStroke(COLOR.ink);
    hairline(0.4);
    doc.line(ML, y + 4, PW - MR, y + 4);

    return y + 4 + 8;
  }

  /**
   * Title block: büyük italik H1 + deck (sağda badge + tarih).
   * @param {Object} opts
   * @param {string} opts.title — H1 başlığı (normal weight)
   * @param {string} [opts.titleEm] — italic vurgu kelimesi (yeni satıra basılır)
   * @param {string} [opts.deck] — alt italik açıklama
   * @param {string} [opts.badge] — sağ üst rozet metni
   * @param {string} [opts.dateStamp] — sağ alt tarih damgası
   * @param {number} opts.y — başlangıç y
   * @returns {number} sonraki blok y'si
   */
  function drawTitleBlock(ctx, opts) {
    const { doc, PW, ML, MR, COLOR, tr, trSerif, setText, setStroke, setSans, setSerif, setMono, hairline } = ctx;
    const yStart = opts.y || 38;

    // Sol: H1 (Newsreader regular) + emphasis (italic)
    const titleSize = 32;
    setSerif(titleSize, 'normal');
    setText(COLOR.ink);
    doc.text(trSerif(opts.title || ''), ML, yStart);
    let h2Y = yStart + 11;
    if (opts.titleEm) {
      setSerif(titleSize, 'italic');
      setText(COLOR.ink2);
      doc.text(trSerif(opts.titleEm), ML, h2Y);
      h2Y += 4;
    }

    // Deck (italic küçük serif)
    if (opts.deck) {
      setSerif(10, 'italic');
      setText(COLOR.ink2);
      const lines = doc.splitTextToSize(trSerif(opts.deck), 90);
      doc.text(lines, ML, h2Y + 2);
    }

    // Sağ: badge (border'lı, caps) + dateStamp (mono)
    let ry = yStart - 2;
    if (opts.badge) {
      setSans(7, 'bold');
      const txt = tr(opts.badge).toUpperCase();
      const tw = doc.getTextWidth(txt);
      const bw = tw + 6;
      const bh = 5.5;
      const bx = PW - MR - bw;
      const by = ry - 4;
      setStroke(COLOR.ink);
      hairline(0.4);
      doc.rect(bx, by, bw, bh, 'S');
      setText(COLOR.ink);
      doc.text(txt, bx + 3, by + bh - 1.6);
      ry = by + bh + 4;
    }
    if (opts.dateStamp) {
      setMono(8.5, 'normal');
      setText(COLOR.ink2);
      doc.text(tr(opts.dateStamp), PW - MR, ry, { align: 'right' });
    }

    // Title bloğunun toplam yüksekliği titleEm var/yok'a göre değişir
    return Math.max(h2Y + (opts.deck ? 14 : 4), ry + 4);
  }

  /**
   * Meta strip: 4 (veya N) sütun key/value, üst+alt hairline çerçeve.
   */
  function drawMetaStrip(ctx, opts) {
    const { doc, ML, CW, COLOR, tr, setText, setSans, setStroke, hairline } = ctx;
    const items = opts.items || [];
    const y = opts.y || 0;
    const stripH = 14;
    if (items.length === 0) return y + stripH + 8;

    setStroke(COLOR.hairline);
    hairline(0.18);
    doc.line(ML, y, ML + CW, y);

    const colW = CW / items.length;
    items.forEach((it, i) => {
      const x = ML + i * colW + (i === 0 ? 0 : 4);
      setSans(7, 'bold');
      setText(COLOR.ink3);
      doc.text(tr(it.key).toUpperCase(), x, y + 5.5);
      setSans(9, 'normal');
      setText(COLOR.ink);
      doc.text(tr(it.value), x, y + 11);
      if (i < items.length - 1) {
        setStroke(COLOR.hairline2);
        hairline(0.12);
        doc.line(ML + (i + 1) * colW, y + 1, ML + (i + 1) * colW, y + stripH - 1);
      }
    });

    setStroke(COLOR.hairline);
    hairline(0.18);
    doc.line(ML, y + stripH, ML + CW, y + stripH);

    return y + stripH + 8;
  }

  /**
   * KPI grid: N×M (default 3 sütun). Her hücrede:
   *   eyebrow caps · büyük serif değer (opsiyonel pre/unit) · delta
   *
   * items: [{ label, value, pre?, unit?, positive?, delta?, deltaDir? }]
   *   deltaDir: 'up' | 'down' | undefined
   */
  function drawKpiGrid(ctx, opts) {
    const { doc, ML, CW, COLOR, tr, setText, setSerif, setSans, setMono, setStroke, hairline } = ctx;
    const items = opts.items || [];
    const cols = opts.cols || 3;
    const y = opts.y || 0;
    const rows = Math.ceil(items.length / cols);
    const colW = CW / cols;
    const rowH = 24;

    // Üst koyu çizgi
    setStroke(COLOR.ink);
    hairline(0.4);
    doc.line(ML, y, ML + CW, y);

    items.forEach((kpi, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cellX = ML + c * colW;
      const cellY = y + r * rowH;
      const padL = c === 0 ? 0 : 4;
      const x = cellX + padL;

      // Eyebrow
      setSans(7, 'bold');
      setText(COLOR.ink3);
      doc.text(tr(kpi.label || '').toUpperCase(), x, cellY + 6);

      // Değer satırı
      const valColor = kpi.positive ? COLOR.positive : COLOR.ink;
      let cx = x;
      const baseY = cellY + 16;
      if (kpi.pre) {
        setSans(8.5, 'normal');
        setText(kpi.positive ? COLOR.positive : COLOR.ink3);
        doc.text(tr(kpi.pre), cx, baseY);
        cx += doc.getTextWidth(tr(kpi.pre)) + 1.4;
      }
      setSerif(20, 'normal');
      setText(valColor);
      const valStr = tr(kpi.value || '');
      doc.text(valStr, cx, baseY);
      cx += doc.getTextWidth(valStr);
      if (kpi.unit) {
        setSans(8, 'normal');
        setText(COLOR.ink3);
        doc.text(tr(kpi.unit), cx + 1.5, baseY);
      }

      // Delta
      if (kpi.delta) {
        const baseDeltaY = cellY + 21;
        setMono(7, 'normal');
        const dirCol = kpi.deltaDir === 'up'   ? COLOR.positive
                     : kpi.deltaDir === 'down' ? COLOR.negative
                     : COLOR.ink3;
        let dx = x;
        if (kpi.deltaDir === 'up' || kpi.deltaDir === 'down') {
          setText(dirCol);
          doc.text(kpi.deltaDir === 'down' ? '▼' : '▲', dx, baseDeltaY);
          dx += 3.5;
        }
        setSans(7.5, 'normal');
        setText(COLOR.ink2);
        doc.text(tr(kpi.delta), dx, baseDeltaY);
      }

      // Sütun arası dikey hairline
      if (c < cols - 1) {
        setStroke(COLOR.hairline);
        hairline(0.12);
        doc.line(cellX + colW, cellY + 2, cellX + colW, cellY + rowH - 2);
      }
      // Satır arası yatay hairline
      if (r > 0 && c === 0) {
        setStroke(COLOR.hairline);
        hairline(0.12);
        doc.line(ML, cellY, ML + CW, cellY);
      }
    });

    // Alt koyu çizgi
    setStroke(COLOR.ink);
    hairline(0.4);
    doc.line(ML, y + rows * rowH, ML + CW, y + rows * rowH);

    return y + rows * rowH + 8;
  }

  /**
   * Section başlığı: "§ 0X" mono prefix + serif başlık + sağ caps meta.
   */
  function drawSectionHead(ctx, opts) {
    const { doc, PW, ML, MR, COLOR, tr, trSerif, setText, setSerif, setSans, setMono } = ctx;
    const y = opts.y || 0;

    let cx = ML;
    if (opts.num) {
      setMono(7.5, 'normal');
      setText(COLOR.ink3);
      const prefix = '§ ' + opts.num;
      doc.text(prefix, cx, y);
      cx += doc.getTextWidth(prefix) + 4;
    }
    setSerif(15, 'normal');
    setText(COLOR.ink);
    doc.text(trSerif(opts.title || ''), cx, y);

    if (opts.meta) {
      setSans(7, 'bold');
      setText(COLOR.ink3);
      doc.text(tr(opts.meta).toUpperCase(), PW - MR, y, { align: 'right' });
    }

    return y + 6;
  }

  /**
   * Tablo:
   *   columns: [{ label, w (% genişlik), align?, mono? }]
   *   rows:    [[cell, cell, ...], ...]   her cell: string | { text, bold?, color?, positive?, plate? }
   *   foot:    [cell, cell, ...]   (opsiyonel toplam satırı)
   *   onPageBreak: () => yeniSayfaY  (caller addPage çağırır + return y)
   *
   * Dön: tablo bittikten sonraki y.
   */
  function drawTable(ctx, opts) {
    const { doc, ML, CW, PH, MB, COLOR, tr, setText, setFill, setStroke, setSans, setMono, hairline } = ctx;
    const cols = opts.columns || [];
    const rows = opts.rows || [];
    const foot = opts.foot;
    const rowH = opts.rowH || 7;
    const headH = opts.headH || 8;
    const onPageBreak = opts.onPageBreak;
    let y = opts.y || 0;

    function drawHead(yy) {
      setStroke(COLOR.ink);
      hairline(0.35);
      doc.line(ML, yy, ML + CW, yy);

      setSans(6.8, 'bold');
      setText(COLOR.ink3);
      let cx = ML + 2;
      cols.forEach(col => {
        const w = (col.w * CW) / 100;
        const txt = tr(col.label || '').toUpperCase();
        if ((col.align || 'left') === 'right') {
          doc.text(txt, cx + w - 4, yy + 5.5);
        } else {
          doc.text(txt, cx, yy + 5.5);
        }
        cx += w;
      });

      doc.line(ML, yy + headH, ML + CW, yy + headH);
      return yy + headH + 1;
    }

    y = drawHead(y);

    rows.forEach((row, ri) => {
      // Sayfa sonu kontrolü
      if (y + rowH > PH - MB - 4) {
        if (typeof onPageBreak === 'function') {
          y = onPageBreak();
          y = drawHead(y);
        }
      }
      // Zebra
      if (ri % 2 === 1) {
        setFill(COLOR.rowZebra);
        doc.rect(ML, y, CW, rowH, 'F');
      }
      // Hücreler
      let cx = ML + 2;
      cols.forEach((col, ci) => {
        const w = (col.w * CW) / 100;
        const cell = row[ci];
        const isObj = cell && typeof cell === 'object' && !Array.isArray(cell);
        const text = isObj ? (cell.text == null ? '' : cell.text) : (cell == null ? '' : cell);
        const align = col.align || 'left';
        const isMono = col.mono === true || align === 'right';
        const cellColor = (isObj && cell.color) ? cell.color
                       : (isObj && cell.positive) ? COLOR.positive
                       : (isObj && cell.negative) ? COLOR.negative
                       : (isObj && cell.muted) ? COLOR.ink3
                       : (col.muted ? COLOR.ink2 : COLOR.ink);
        const bold = !!(isObj && cell.bold);

        if (isObj && cell.plate) {
          // Plaka rozeti — krem kapsül
          const plateTxt = tr(text);
          setMono(8, 'bold');
          const tw = doc.getTextWidth(plateTxt) + 5;
          const px = align === 'right' ? cx + w - 4 - tw : cx;
          setFill(COLOR.plate);
          setStroke(COLOR.hairline);
          hairline(0.15);
          doc.rect(px, y + 1.2, tw, rowH - 2.4, 'FD');
          setText(COLOR.ink);
          doc.text(plateTxt, px + 2.5, y + rowH - 2.4);
        } else {
          if (isMono) setMono(8, bold ? 'bold' : 'normal');
          else setSans(8, bold ? 'bold' : 'normal');
          setText(cellColor);
          const txt = tr(text);
          const tx = align === 'right' ? cx + w - 4 : cx;
          doc.text(txt, tx, y + rowH - 2.4, align === 'right' ? { align: 'right' } : undefined);
        }
        cx += w;
      });
      // Satır altı hairline
      setStroke(COLOR.hairline2);
      hairline(0.1);
      doc.line(ML, y + rowH, ML + CW, y + rowH);
      y += rowH;
    });

    if (foot) {
      setStroke(COLOR.ink);
      hairline(0.35);
      doc.line(ML, y, ML + CW, y);

      let cx = ML + 2;
      const footH = rowH + 2;
      cols.forEach((col, ci) => {
        const w = (col.w * CW) / 100;
        const cell = foot[ci];
        const isObj = cell && typeof cell === 'object' && !Array.isArray(cell);
        const text = isObj ? (cell.text == null ? '' : cell.text) : (cell == null ? '' : cell);
        const align = col.align || 'left';
        const isMono = col.mono === true || align === 'right';
        const cellColor = (isObj && cell.positive) ? COLOR.positive
                       : (isObj && cell.negative) ? COLOR.negative
                       : COLOR.ink;
        if (ci === 0) setSans(8, 'bold');
        else if (isMono) setMono(8, 'bold');
        else setSans(8, 'bold');
        setText(cellColor);
        const txt = tr(text);
        const tx = align === 'right' ? cx + w - 4 : cx;
        doc.text(txt, tx, y + footH - 2.4, align === 'right' ? { align: 'right' } : undefined);
        cx += w;
      });

      doc.line(ML, y + footH, ML + CW, y + footH);
      y += footH + 2;
    }

    return y + 4;
  }

  /**
   * Donut chart: dilimler stroke arc taklidi ile (jsPDF arc native değil, line approx).
   * slices: [{ label, value, color, highlight? }]
   */
  function drawDonut(ctx, opts) {
    const { doc, COLOR, trSerif, tr, setText, setSerif, setSans } = ctx;
    const slices = opts.slices || [];
    const cx = opts.cx, cy = opts.cy;
    const r = opts.r || 22;
    const strokeW = opts.strokeW || 7;
    const total = slices.reduce((s, x) => s + (x.value || 0), 0) || 1;
    let a0 = -Math.PI / 2;

    // Dilimleri çiz
    slices.forEach(slice => {
      const fr = (slice.value || 0) / total;
      if (fr <= 0) return;
      const a1 = a0 + fr * 2 * Math.PI;
      _drawArcStroke(doc, cx, cy, r, a0, a1, slice.color, strokeW);
      a0 = a1;
    });

    // Merkez yazısı
    if (opts.centerLabel) {
      setSerif(13, 'normal');
      setText(COLOR.ink);
      doc.text(trSerif(opts.centerLabel), cx, cy + 0.5, { align: 'center' });
    }
    if (opts.centerSubtext) {
      setSans(5.5, 'bold');
      setText(COLOR.ink3);
      doc.text(tr(opts.centerSubtext).toUpperCase(), cx, cy + 4.5, { align: 'center' });
    }
  }

  function _drawArcStroke(doc, cx, cy, r, startA, endA, color, strokeW) {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(strokeW);
    doc.setLineCap('butt');
    const segs = Math.max(16, Math.ceil(((endA - startA) * 24) / Math.PI));
    const dA = (endA - startA) / segs;
    let px = cx + r * Math.cos(startA);
    let py = cy + r * Math.sin(startA);
    for (let i = 1; i <= segs; i++) {
      const a = startA + i * dA;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      doc.line(px, py, x, y);
      px = x; py = y;
    }
  }

  /**
   * Donut yanı legend listesi (her satır: swatch · isim · % · TL ).
   */
  function drawDonutLegend(ctx, opts) {
    const { doc, COLOR, tr, setText, setFill, setSans, setMono, setStroke, hairline } = ctx;
    const slices = opts.slices || [];
    const x = opts.x, y = opts.y, w = opts.w;
    const total = opts.total || slices.reduce((s, sl) => s + (sl.value || 0), 0) || 1;
    const rowH = 9;
    let cy = y;
    slices.forEach((slice, i) => {
      // Üst: swatch + isim
      setFill(slice.color);
      doc.rect(x, cy, 2.2, 2.2, 'F');
      setSans(8, 'normal');
      setText(slice.highlight ? COLOR.positive : COLOR.ink);
      const nameStyle = slice.highlight ? 'bold' : 'normal';
      doc.setFont(ctx.loaded.sans ? FONT.sans : FONT.sansFb, nameStyle);
      doc.text(tr(slice.label || ''), x + 4, cy + 2);

      // Alt: %pct + TL amount sağa
      const pct = ((slice.value || 0) * 100 / total).toFixed(2).replace('.', ',');
      setMono(7, 'normal');
      setText(slice.highlight ? COLOR.positive : COLOR.ink3);
      doc.text('%' + pct, x + 14, cy + 6.5);

      setMono(7.5, slice.highlight ? 'bold' : 'normal');
      setText(slice.highlight ? COLOR.positive : COLOR.ink);
      const amt = slice.amount != null ? slice.amount : Math.round(slice.value || 0).toLocaleString('tr-TR');
      doc.text(tr(amt), x + w, cy + 6.5, { align: 'right' });

      // Hairline
      if (i < slices.length - 1) {
        setStroke(COLOR.hairline2);
        hairline(0.1);
        doc.line(x, cy + rowH - 0.5, x + w, cy + rowH - 0.5);
      }
      cy += rowH;
    });
    return cy;
  }

  /**
   * P/L (kâr-zarar) listesi — dikey rows, son satır toplam.
   * rows: [{ label, value, isTotal?, positive? }]
   */
  function drawPLList(ctx, opts) {
    const { doc, COLOR, tr, setText, setSans, setMono, setStroke, hairline } = ctx;
    const x = opts.x, y = opts.y, w = opts.w;
    const rows = opts.rows || [];
    let cy = y;
    rows.forEach((row, i) => {
      const isTotal = !!row.isTotal;
      const rowH = isTotal ? 10 : 8;
      if (isTotal) {
        setStroke(COLOR.ink);
        hairline(0.35);
        doc.line(x, cy, x + w, cy);
      }
      setSans(isTotal ? 9 : 8.5, isTotal ? 'bold' : 'normal');
      setText(isTotal ? COLOR.ink : COLOR.ink2);
      doc.text(tr(row.label || ''), x, cy + rowH - 2.4);

      setMono(isTotal ? 10 : 8.5, isTotal ? 'bold' : 'normal');
      setText(row.positive ? COLOR.positive : (isTotal ? COLOR.ink : COLOR.ink));
      doc.text(tr(row.value || ''), x + w, cy + rowH - 2.4, { align: 'right' });

      if (isTotal) {
        setStroke(COLOR.ink);
        hairline(0.35);
        doc.line(x, cy + rowH, x + w, cy + rowH);
      } else {
        setStroke(COLOR.hairline2);
        hairline(0.1);
        doc.line(x, cy + rowH, x + w, cy + rowH);
      }
      cy += rowH;
    });
    return cy + 2;
  }

  /**
   * Pull quote — editorial alıntı kutusu (üst+alt hairline + ¶ pilcrow).
   */
  function drawPullQuote(ctx, opts) {
    const { doc, ML, CW, COLOR, trSerif, setText, setSerif, setStroke, hairline } = ctx;
    const y = opts.y || 0;
    const padY = 6;

    setStroke(COLOR.hairline);
    hairline(0.18);
    doc.line(ML, y, ML + CW, y);

    setSerif(22, 'italic');
    setText(COLOR.ink3);
    doc.text('¶', ML + 2, y + padY + 7);

    setSerif(11, 'italic');
    setText(COLOR.ink);
    const lines = doc.splitTextToSize(trSerif(opts.text || ''), CW - 14);
    doc.text(lines, ML + 12, y + padY + 4);

    const blockH = padY + Math.max(10, lines.length * 5) + 6;
    setStroke(COLOR.hairline);
    hairline(0.18);
    doc.line(ML, y + blockH, ML + CW, y + blockH);

    return y + blockH + 6;
  }

  /**
   * Sign-off bloğu — Hazırlayan / Onaylayan iki sütun.
   */
  function drawSignOff(ctx, opts) {
    const { doc, ML, CW, COLOR, tr, setText, setSans, setStroke, hairline } = ctx;
    const y = opts.y || 0;
    const cWidth = (CW - 16) / 2;
    const lineY = y + 14;

    setSans(7, 'bold');
    setText(COLOR.ink3);
    doc.text(tr(opts.preparedLabel || 'HAZIRLAYAN'), ML, y);
    doc.text(tr(opts.approvedLabel || 'ONAYLAYAN'), ML + cWidth + 16, y);

    setStroke(COLOR.ink);
    hairline(0.4);
    doc.line(ML, lineY, ML + cWidth * 0.85, lineY);
    doc.line(ML + cWidth + 16, lineY, ML + cWidth + 16 + cWidth * 0.85, lineY);

    setSans(8, 'normal');
    setText(COLOR.ink2);
    if (opts.prepared) doc.text(tr(opts.prepared), ML, lineY + 4);
    if (opts.approved) doc.text(tr(opts.approved), ML + cWidth + 16, lineY + 4);

    return lineY + 10;
  }

  /**
   * Footer: alt hairline + sol etiket + sağ "01 / NN" mono sayfa.
   */
  function drawFooter(ctx, opts) {
    const { doc, PW, ML, MR, PH, MB, COLOR, tr, setText, setSans, setMono, setStroke, hairline } = ctx;
    const y = PH - MB;
    setStroke(COLOR.hairline);
    hairline(0.15);
    doc.line(ML, y, PW - MR, y);

    setSans(6.5, 'normal');
    setText(COLOR.ink3);
    doc.text(tr(opts.label || 'Fleetly'), ML, y + 4.5);

    if (opts.center) {
      setSans(6.5, 'normal');
      setText(COLOR.ink3);
      doc.text(tr(opts.center), PW / 2, y + 4.5, { align: 'center' });
    }

    if (opts.pageNo != null) {
      setMono(7, 'bold');
      setText(COLOR.ink2);
      const total = opts.totalPages != null ? ' / ' + String(opts.totalPages).padStart(2, '0') : '';
      const txt = String(opts.pageNo).padStart(2, '0') + total;
      doc.text(txt, PW - MR, y + 4.5, { align: 'right' });
    }
  }

  /**
   * Tüm sayfalara final pageNo basar (toplam sayfa belli olunca, en son çağır).
   */
  function stampPageNumbers(ctx, opts) {
    const { doc, PW, MR, PH, MB, COLOR, setText, setMono, setFill } = ctx;
    const total = doc.internal.getNumberOfPages();
    const labelTotal = String(total).padStart(2, '0');
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      // Sağ-alt sayfa noktasını üzerine kapat (krem ile) sonra yeniden bas
      setFill(COLOR.paper);
      doc.rect(PW - MR - 22, PH - MB + 1, 22, 5, 'F');
      setMono(7, 'bold');
      setText(COLOR.ink2);
      doc.text(String(p).padStart(2, '0') + ' / ' + labelTotal, PW - MR, PH - MB + 4.5, { align: 'right' });
    }
  }

  /**
   * Plaka rozeti çiz (krem kapsül + mono yazı). Tablo dışında inline kullanım için.
   */
  function drawPlate(ctx, plateText, x, y, opts) {
    const { doc, COLOR, tr, setFill, setStroke, setText, setMono, hairline } = ctx;
    opts = opts || {};
    const size = opts.size || 9;
    setMono(size, 'bold');
    const tw = doc.getTextWidth(tr(plateText)) + 6;
    const h = size * 0.55 + 2;
    setFill(COLOR.plate);
    setStroke(COLOR.hairline);
    hairline(0.18);
    doc.rect(x, y - h + 1, tw, h, 'FD');
    setText(COLOR.ink);
    doc.text(tr(plateText), x + 3, y - 1);
    return tw;
  }

  // Public API
  window.PdfTheme = {
    COLOR, FONT, PAGE,
    init, fromDoc,
    drawPageBg, drawRegistrationMarks,
    drawTopbar, drawTitleBlock, drawMetaStrip,
    drawKpiGrid, drawSectionHead,
    drawTable, drawDonut, drawDonutLegend, drawPLList,
    drawPullQuote, drawSignOff, drawFooter,
    drawPlate,
    stampPageNumbers,
    trAscii,
  };
})();
