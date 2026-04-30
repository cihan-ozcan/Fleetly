/* ============================================================================
   app-chunk-pod.js — POD (Proof of Delivery) Sistemi
   ----------------------------------------------------------------------------
   FAZ 1 — Sürücü Akışı:
     • İmza canvas (touch + mouse)
     • Taslak PDF üretimi (jsPDF, A4 portrait)
     • Supabase Storage upload (pod-documents bucket)
     • is_emirleri kolon güncellemeleri (pod_taslak_url, pod_durum, ...)
     • Bottom-sheet teslim onay modalı

   FAZ 2 (sonra) — Yönetici Akışı:
     • POD onay modalı + final PDF (QR + onay damgası)
     • notify-driver bildirimi

   Hem chunk-06 (in-app sürücü) hem sofor.html (token paylaşım linki)
   tarafından kullanılabilir. Çağıran taraf isEmri objesini ve
   uploadFn (Storage upload yöntemi — auth/anon farklı) sağlar.
   ============================================================================ */

window.podState = {
  isEmri        : null,      // aktif iş emri
  imzaCanvas    : null,
  imzaCtx       : null,
  imzaBosMu     : true,
  imzaPenSize   : 2,
  yukleniyor    : false,
  /** Upload yöntemi: chunk-06 → SDK, sofor.html → REST fetch */
  uploadFn      : null,
  /** Update yöntemi: is_emirleri patch */
  patchFn       : null,
};
const _POD = window.podState;

/* ──────────────────────────────────────────────────────────────────────
   1) MODAL HTML — bir kez DOM'a inject edilir (sürücü tarafında)
   ──────────────────────────────────────────────────────────────────── */
function podModalEnsure() {
  if (document.getElementById('pod-sheet')) return;
  const html = `
    <div id="pod-sheet-bg" class="pod-sheet-bg" onclick="podModalKapat()"></div>
    <div id="pod-sheet" class="pod-sheet" role="dialog" aria-modal="true">
      <div class="pod-sheet-handle"></div>
      <div class="pod-sheet-head">
        <div class="pod-sheet-title">✅ Teslimatı Tamamla</div>
        <button class="pod-sheet-close" onclick="podModalKapat()" aria-label="Kapat">✕</button>
      </div>
      <div class="pod-sheet-body">
        <div>
          <div class="pod-field-label">📝 Teslim Notu <span class="opt">isteğe bağlı</span></div>
          <textarea id="pod-modal-not" class="pod-textarea" placeholder="Örn: Kapıcıya bırakıldı, hasar yok..."></textarea>
        </div>
        <div>
          <div class="pod-field-label">👤 Teslim Alan Kişi <span class="opt">isteğe bağlı</span></div>
          <input id="pod-modal-alan" class="pod-input" placeholder="Örn: Ahmet Yılmaz" />
        </div>
        <div>
          <div class="pod-field-label">✍️ Müşteri İmzası</div>
          <div class="pod-imza-wrap">
            <canvas id="pod-imza" class="pod-imza-canvas"></canvas>
            <div id="pod-imza-ph" class="pod-imza-placeholder">Buraya imza atın</div>
          </div>
          <div class="pod-imza-toolbar">
            <span class="pod-imza-info">Parmağınız veya kalemle imzalayın</span>
            <button class="pod-imza-clear" onclick="podImzaTemizle()">🗑 Temizle</button>
          </div>
        </div>
        <div>
          <div class="pod-field-label">📸 Teslim Fotoğrafları <span class="opt" id="pod-foto-count">0 yüklü</span></div>
          <div class="pod-foto-row" id="pod-foto-row">
            <div style="font-size:11.5px;color:var(--muted);">Mevcut fotoğraflarınız taslakta otomatik kullanılacak.</div>
          </div>
        </div>
        <button id="pod-onayla-btn" class="pod-onay-btn" onclick="podTeslimOnayla()">
          <span>✅</span><span>Teslimi Onayla ve POD Oluştur</span>
        </button>
        <div id="pod-progress" class="pod-progress"></div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
}

/* ──────────────────────────────────────────────────────────────────────
   2) MODAL AÇ / KAPAT
   ──────────────────────────────────────────────────────────────────── */
function podModalAc(opts = {}) {
  // opts: { isEmri, uploadFn, patchFn, onTamamlandi }
  if (!opts.isEmri) { console.warn('podModalAc: isEmri gerekli'); return; }
  podModalEnsure();
  _POD.isEmri       = opts.isEmri;
  _POD.uploadFn     = opts.uploadFn || _podUploadDefault;
  _POD.patchFn      = opts.patchFn  || _podPatchDefault;
  _POD.onTamamlandi = opts.onTamamlandi || null;

  document.getElementById('pod-modal-not').value  = '';
  document.getElementById('pod-modal-alan').value = '';
  _podFotoCountUpdate();

  document.getElementById('pod-sheet-bg').classList.add('open');
  document.getElementById('pod-sheet').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Canvas'ı bir frame sonra başlat (modal açılma animasyonu boyut versin)
  setTimeout(() => podImzaBaslat(), 60);
}

function podModalKapat() {
  document.getElementById('pod-sheet-bg')?.classList.remove('open');
  document.getElementById('pod-sheet')?.classList.remove('open');
  document.body.style.overflow = '';
  podImzaBaglantilariSok();
}

function _podFotoCountUpdate() {
  const el = document.getElementById('pod-foto-count');
  if (!el) return;
  let n = 0;
  try {
    const f = _POD.isEmri?.fotograflar;
    const arr = Array.isArray(f) ? f : (typeof f === 'string' ? JSON.parse(f || '[]') : []);
    n = arr.length;
  } catch {}
  el.textContent = `${n} yüklü`;
}

/* ──────────────────────────────────────────────────────────────────────
   3) İMZA CANVAS
   ──────────────────────────────────────────────────────────────────── */
let _podImzaListeners = [];

function podImzaBaslat() {
  const canvas = document.getElementById('pod-imza');
  if (!canvas) return;
  // Retina için scale
  const rect = canvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000000'; ctx.lineWidth = _POD.imzaPenSize;
  _POD.imzaCanvas = canvas;
  _POD.imzaCtx    = ctx;
  _POD.imzaBosMu  = true;

  let drawing = false, lastX = 0, lastY = 0;
  const getXY = (ev) => {
    const r = canvas.getBoundingClientRect();
    if (ev.touches?.length) return [ev.touches[0].clientX - r.left, ev.touches[0].clientY - r.top];
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const start = (ev) => {
    ev.preventDefault();
    drawing = true;
    [lastX, lastY] = getXY(ev);
    if (_POD.imzaBosMu) {
      const ph = document.getElementById('pod-imza-ph');
      if (ph) ph.style.display = 'none';
      _POD.imzaBosMu = false;
    }
  };
  const move = (ev) => {
    if (!drawing) return;
    ev.preventDefault();
    const [x, y] = getXY(ev);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    [lastX, lastY] = [x, y];
  };
  const end = () => { drawing = false; };

  const opts = { passive: false };
  canvas.addEventListener('pointerdown', start, opts);
  canvas.addEventListener('pointermove', move, opts);
  canvas.addEventListener('pointerup',   end);
  canvas.addEventListener('pointerleave',end);
  // iOS Safari için touch fallback
  canvas.addEventListener('touchstart', start, opts);
  canvas.addEventListener('touchmove',  move,  opts);
  canvas.addEventListener('touchend',   end);

  _podImzaListeners = [
    ['pointerdown', start], ['pointermove', move],
    ['pointerup', end], ['pointerleave', end],
    ['touchstart', start], ['touchmove', move], ['touchend', end]
  ];
}

function podImzaBaglantilariSok() {
  if (!_POD.imzaCanvas) return;
  _podImzaListeners.forEach(([ev, fn]) => _POD.imzaCanvas.removeEventListener(ev, fn));
  _podImzaListeners = [];
  _POD.imzaCanvas = null; _POD.imzaCtx = null;
}

function podImzaTemizle() {
  const canvas = _POD.imzaCanvas;
  const ctx    = _POD.imzaCtx;
  if (!canvas || !ctx) return;
  const r = canvas.getBoundingClientRect();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, r.width, r.height);
  ctx.strokeStyle = '#000000'; ctx.lineWidth = _POD.imzaPenSize;
  _POD.imzaBosMu = true;
  const ph = document.getElementById('pod-imza-ph');
  if (ph) ph.style.display = '';
}

function podImzaPngBlob() {
  const canvas = _POD.imzaCanvas;
  if (!canvas) return Promise.resolve(null);
  return new Promise(res => canvas.toBlob(b => res(b), 'image/png'));
}

/* ──────────────────────────────────────────────────────────────────────
   4) STORAGE UPLOAD (varsayılan SDK ile, sofor.html REST ile override eder)
   ──────────────────────────────────────────────────────────────────── */
async function _podUploadDefault({ path, blob, contentType }) {
  const sb = (typeof getSB === 'function') ? getSB() : null;
  if (!sb) throw new Error('Supabase istemcisi yok');
  const { error } = await sb.storage.from('pod-documents').upload(path, blob, {
    contentType, upsert: true
  });
  if (error) throw error;
  // Private bucket → signed URL (1 yıl)
  const { data, error: urlErr } = await sb.storage
    .from('pod-documents')
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (urlErr) throw urlErr;
  return data.signedUrl;
}

async function _podPatchDefault(isEmriId, patch) {
  const sb = (typeof getSB === 'function') ? getSB() : null;
  if (!sb) throw new Error('Supabase istemcisi yok');
  const { error } = await sb.from('is_emirleri').update(patch).eq('id', isEmriId);
  if (error) throw error;
}

/* ──────────────────────────────────────────────────────────────────────
   5) URL → BASE64 (PDF'e foto gömmek için)
   ──────────────────────────────────────────────────────────────────── */
async function podUrlToDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('podUrlToDataUrl hata:', url, err);
    return null;
  }
}

function podBlobToDataUrl(blob) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

/* ──────────────────────────────────────────────────────────────────────
   6) TASLAK PDF ÜRETİMİ (jsPDF)
   ──────────────────────────────────────────────────────────────────── */
async function podTaslakPdfUret(opts) {
  /* opts: {
       isEmri, firmaAdi, sofor, imzaDataUrl, teslimNotu, teslimAlan,
       fotoUrls (max 4), kapakRengi
     }
     Döner: Blob (application/pdf)                                       */
  if (!window.jspdf) throw new Error('jsPDF yüklü değil');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210, H = 297;
  const e = opts.isEmri || {};
  const acc = opts.kapakRengi || [232, 82, 26]; // turuncu
  const tr  = (s) => _podTrAscii(s);

  // ── ÜST BANT ──
  pdf.setFillColor(acc[0], acc[1], acc[2]);
  pdf.rect(0, 0, W, 28, 'F');
  pdf.setTextColor(255,255,255);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18);
  pdf.text(tr('TESLİMAT MAKBUZU'), 14, 16);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  pdf.text(tr('TASLAK · Yönetici onayı bekliyor'), 14, 22);
  pdf.setFontSize(10);
  pdf.text(tr(opts.firmaAdi || 'Fleetly'), W - 14, 16, { align: 'right' });
  const tarih = new Date(e.teslim_zamani || Date.now()).toLocaleDateString('tr-TR');
  const saat  = new Date(e.teslim_zamani || Date.now()).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
  pdf.text(tr(`${tarih} ${saat}`), W - 14, 22, { align: 'right' });

  // ── BAŞ BÖLÜMÜ ──
  let y = 38;
  pdf.setTextColor(20, 25, 50);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
  pdf.text(tr('İŞ EMRİ #' + (e.id || '?')), 14, y);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  pdf.text(tr('Müşteri: ' + (e.musteri_adi || '—')), W - 14, y, { align: 'right' });
  y += 6;
  if (e.referans_no) {
    pdf.setFontSize(9); pdf.setTextColor(120, 130, 150);
    pdf.text(tr('Ref: ' + e.referans_no), 14, y);
    y += 5;
  }
  pdf.setDrawColor(220,225,240); pdf.line(14, y, W-14, y); y += 7;

  // ── DETAY GRID (2 sütun) ──
  pdf.setTextColor(20, 25, 50);
  const detay = [
    ['Sürücü',          opts.sofor || e.sofor || '—'],
    ['Araç Plaka',      e.arac_plaka || '—'],
    ['Yükleme Yeri',    e.yukle_yeri || '—'],
    ['Teslim Yeri',     e.teslim_yeri || '—'],
    ['Konteyner',       (e.konteyner_no || '—').split('\n')[0]],
    ['Konteyner Tipi',  e.kont_tip || '—'],
    ['Mühür No',        e.muhur_no || '—'],
    ['Boş Dönüş',       e.bos_donus || '—'],
  ];
  pdf.setFontSize(9);
  detay.forEach((row, i) => {
    const col = i % 2;
    const r   = Math.floor(i / 2);
    const x   = col === 0 ? 14 : 110;
    const yy  = y + r * 6;
    pdf.setTextColor(120, 130, 150); pdf.setFont('helvetica', 'normal');
    pdf.text(tr(row[0] + ':'), x, yy);
    pdf.setTextColor(20, 25, 50); pdf.setFont('helvetica', 'bold');
    pdf.text(tr(row[1] || '—'), x + 30, yy);
  });
  y += Math.ceil(detay.length / 2) * 6 + 8;

  // ── KM / SÜRE ──
  if (e.baslangic_km != null || e.bitis_km != null) {
    pdf.setFontSize(9); pdf.setTextColor(120, 130, 150);
    pdf.text(tr('Km Aralığı:'), 14, y);
    pdf.setTextColor(20, 25, 50); pdf.setFont('helvetica', 'bold');
    const km = (e.baslangic_km != null && e.bitis_km != null) ? `(${(+e.bitis_km - +e.baslangic_km).toLocaleString('tr-TR')} km)` : '';
    pdf.text(`${e.baslangic_km ?? '?'} → ${e.bitis_km ?? '?'} ${km}`, 44, y);
    pdf.setFont('helvetica', 'normal');
    y += 6;
  }
  if (e.konum_lat && e.konum_lng) {
    pdf.setTextColor(120,130,150);
    pdf.text(tr('Teslim Konumu:'), 14, y);
    pdf.setTextColor(20, 25, 50);
    pdf.text(`${(+e.konum_lat).toFixed(5)}, ${(+e.konum_lng).toFixed(5)}`, 44, y);
    y += 6;
  }
  y += 2;
  pdf.setDrawColor(220,225,240); pdf.line(14, y, W-14, y); y += 8;

  // ── TESLİM NOTU + İMZA (yan yana) ──
  pdf.setTextColor(20,25,50); pdf.setFont('helvetica','bold'); pdf.setFontSize(10);
  pdf.text(tr('TESLİM NOTU'), 14, y);
  pdf.text(tr('MÜŞTERİ İMZASI'), 110, y);
  y += 4;
  pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(60,70,100);

  // Teslim notu + alan kişi (sol)
  const not = (opts.teslimNotu || e.teslim_not_musteri || '').trim();
  const alan= (opts.teslimAlan|| e.teslim_alan_ad || '').trim();
  const notLines = pdf.splitTextToSize(tr(not || 'Not yok.'), 90);
  pdf.text(notLines, 14, y + 5);
  if (alan) {
    pdf.setFont('helvetica','bold'); pdf.setTextColor(20,25,50);
    pdf.text(tr('Teslim Alan: ' + alan), 14, y + 5 + notLines.length * 4 + 4);
  }

  // İmza (sağ)
  if (opts.imzaDataUrl) {
    try {
      pdf.addImage(opts.imzaDataUrl, 'PNG', 110, y, 86, 30);
    } catch (err) {
      console.warn('İmza PDF\'e eklenemedi:', err);
    }
  } else {
    pdf.setTextColor(160, 170, 195); pdf.setFont('helvetica','italic');
    pdf.text(tr('İmza alınmadı.'), 110, y + 16);
  }
  pdf.setDrawColor(160,170,195);
  pdf.line(110, y + 32, 196, y + 32); // imza alt çizgisi
  y += 40;

  // ── FOTOĞRAFLAR ──
  const fotos = (opts.fotoUrls || []).slice(0, 4);
  if (fotos.length) {
    pdf.setTextColor(20,25,50); pdf.setFont('helvetica','bold'); pdf.setFontSize(10);
    pdf.text(tr('TESLİM FOTOĞRAFLARI'), 14, y); y += 5;
    pdf.setDrawColor(220,225,240); pdf.line(14, y, W-14, y); y += 4;

    const cellW = (W - 28 - 12) / 4;  // 4 sütun, 4mm gap
    const cellH = 36;
    for (let i = 0; i < fotos.length; i++) {
      const x = 14 + i * (cellW + 4);
      try {
        pdf.addImage(fotos[i], undefined, x, y, cellW, cellH, undefined, 'FAST');
        pdf.setDrawColor(220,225,240);
        pdf.rect(x, y, cellW, cellH);
      } catch (err) {
        console.warn('Foto PDF\'e eklenemedi:', err);
        pdf.setFillColor(245, 247, 252);
        pdf.rect(x, y, cellW, cellH, 'F');
        pdf.setTextColor(160,170,195); pdf.setFontSize(8);
        pdf.text('(yüklenemedi)', x + cellW/2, y + cellH/2, { align: 'center' });
      }
    }
    y += cellH + 6;
  }

  // ── DURUM BANDI ──
  if (y > 250) y = 250;
  pdf.setFillColor(212, 168, 71, 0.20); // sarı tonu
  pdf.setDrawColor(212, 168, 71);
  pdf.roundedRect(14, y, W-28, 12, 2, 2, 'FD');
  pdf.setTextColor(120, 95, 25); pdf.setFont('helvetica','bold'); pdf.setFontSize(10);
  pdf.text(tr('⏳ DURUM: TASLAK — YÖNETİCİ ONAYI BEKLİYOR'), W/2, y + 8, { align: 'center' });

  // ── FOOTER ──
  pdf.setFontSize(8); pdf.setTextColor(160,170,195); pdf.setFont('helvetica','normal');
  pdf.text(tr('Bu belge Fleetly tarafından üretilmiştir · fleetly.app'), 14, 290);
  pdf.text(tr(`Oluşturma: ${new Date().toLocaleString('tr-TR')}`), W-14, 290, { align: 'right' });

  return pdf.output('blob');
}

/* ──────────────────────────────────────────────────────────────────────
   7) ANA AKIŞ — TESLİM ONAYLA
   ──────────────────────────────────────────────────────────────────── */
async function podTeslimOnayla() {
  if (_POD.yukleniyor) return;
  const e = _POD.isEmri;
  if (!e) { _podToast('İş emri bulunamadı', 'error'); return; }

  if (_POD.imzaBosMu) {
    if (!confirm('İmza alınmadı. Yine de teslimi tamamlayıp PODu oluşturayım mı?')) return;
  }

  _POD.yukleniyor = true;
  const btn  = document.getElementById('pod-onayla-btn');
  const prog = document.getElementById('pod-progress');
  if (btn)  { btn.disabled = true; btn.querySelector('span:last-child').textContent = 'POD oluşturuluyor...'; }
  if (prog) { prog.classList.add('show'); prog.textContent = '1/4 — İmza yükleniyor...'; }

  try {
    const firmaId   = e.firma_id || (typeof currentFirmaId !== 'undefined' ? currentFirmaId : null);
    if (!firmaId) throw new Error('firma_id bulunamadı');
    const teslimNot  = (document.getElementById('pod-modal-not')?.value || '').trim();
    const teslimAlan = (document.getElementById('pod-modal-alan')?.value || '').trim();

    const yil = new Date().getFullYear();
    const ay  = new Date().getMonth() + 1;
    const baseDir = `${firmaId}/${yil}/${ay}/${e.id}`;

    // ── 1) İmza yükle (varsa) ──
    let imzaUrl = e.imza_url || null;
    let imzaDataUrl = null;
    if (!_POD.imzaBosMu) {
      const imzaBlob = await podImzaPngBlob();
      if (imzaBlob) {
        imzaDataUrl = await podBlobToDataUrl(imzaBlob);
        try {
          imzaUrl = await _POD.uploadFn({
            path: `${baseDir}/imza.png`, blob: imzaBlob, contentType: 'image/png'
          });
        } catch (uErr) {
          console.warn('İmza upload hatası, yerel data URL kullanılacak:', uErr);
        }
      }
    }

    // ── 2) Mevcut fotoğrafları al ──
    if (prog) prog.textContent = '2/4 — Fotoğraflar hazırlanıyor...';
    const fotoUrls = _podFotoUrlsFromIE(e);
    const fotoDataUrls = [];
    for (const u of fotoUrls.slice(0, 4)) {
      const d = await podUrlToDataUrl(u);
      if (d) fotoDataUrls.push(d);
    }

    // ── 3) Taslak PDF üret ──
    if (prog) prog.textContent = '3/4 — PDF üretiliyor...';
    const firmaAdi = (typeof currentFirmaAdi !== 'undefined' && currentFirmaAdi) ? currentFirmaAdi
                    : (e.firma_adi || 'Fleetly');
    const sofor    = e.sofor || (typeof soforState !== 'undefined' ? `${soforState.surucu?.ad || ''} ${soforState.surucu?.soyad || ''}`.trim() : '');
    const pdfBlob  = await podTaslakPdfUret({
      isEmri: e,
      firmaAdi,
      sofor,
      imzaDataUrl,
      teslimNotu: teslimNot,
      teslimAlan: teslimAlan,
      fotoUrls: fotoDataUrls
    });

    // ── 4) PDF'i yükle ──
    if (prog) prog.textContent = '4/4 — Bulutta saklanıyor...';
    let pdfUrl = null;
    try {
      pdfUrl = await _POD.uploadFn({
        path: `${baseDir}/pod_taslak.pdf`, blob: pdfBlob, contentType: 'application/pdf'
      });
    } catch (uErr) {
      console.warn('PDF upload hatası, yerel indirme fallback:', uErr);
      // Fallback: tarayıcıda indir
      const blobUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = `POD_taslak_${e.id}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    // ── 5) DB güncelle ──
    const now = new Date().toISOString();
    const patch = {
      durum               : 'Teslim Edildi',
      teslim_zamani       : e.teslim_zamani || now,
      teslim_not_musteri  : teslimNot || e.teslim_not_musteri || null,
      teslim_alan_ad      : teslimAlan || e.teslim_alan_ad || null,
      imza_url            : imzaUrl || e.imza_url || null,
      pod_taslak_url      : pdfUrl || null,
      pod_olusturma_zaman : now,
      pod_durum           : 'taslak',
    };
    try {
      await _POD.patchFn(e.id, patch);
    } catch (pErr) {
      console.warn('is_emirleri patch hatası:', pErr);
      _podToast('POD oluşturuldu ama kayıt güncellenemedi: ' + (pErr?.message || ''), 'warn');
    }

    // ── 6) Başarı ──
    Object.assign(e, patch);
    if (prog) prog.textContent = '✅ POD oluşturuldu!';
    _podToast('Teslimat tamamlandı, POD oluşturuldu', 'ok');

    // Callback (caller'a sinyal — sürücü ekranını yenile)
    if (typeof _POD.onTamamlandi === 'function') {
      try { _POD.onTamamlandi({ pdfUrl, imzaUrl, isEmri: e }); } catch {}
    }

    setTimeout(() => podModalKapat(), 900);
  } catch (err) {
    console.error('POD hatası:', err);
    _podToast('POD oluşturulamadı: ' + (err?.message || 'hata'), 'error');
    if (prog) prog.textContent = '❌ Hata: ' + (err?.message || 'bilinmeyen');
  } finally {
    _POD.yukleniyor = false;
    if (btn) { btn.disabled = false; btn.querySelector('span:last-child').textContent = 'Teslimi Onayla ve POD Oluştur'; }
  }
}

/* Mevcut iş emrindeki foto URL listesini çıkar */
function _podFotoUrlsFromIE(e) {
  try {
    const f = e.fotograflar;
    const arr = Array.isArray(f) ? f : (typeof f === 'string' ? JSON.parse(f || '[]') : []);
    return arr.map(x => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') return x.url || x.src || null;
      return null;
    }).filter(Boolean);
  } catch { return []; }
}

/* ──────────────────────────────────────────────────────────────────────
   YARDIMCILAR
   ──────────────────────────────────────────────────────────────────── */
function _podToast(msg, type = 'ok') {
  if (typeof showToast === 'function') return showToast(msg, type);
  if (typeof soforToast === 'function') return soforToast(msg, type === 'error' ? 'err' : type);
  console.log('[POD]', type, msg);
}

/* jsPDF default Helvetica Latin-1 — Türkçe karakter fallback */
function _podTrAscii(s) {
  if (s == null) return '';
  return String(s)
    .replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
    .replace(/ı/g,'i').replace(/İ/g,'I').replace(/ç/g,'c').replace(/Ç/g,'C')
    .replace(/ö/g,'o').replace(/Ö/g,'O').replace(/ü/g,'u').replace(/Ü/g,'U');
}

/* ──────────────────────────────────────────────────────────────────────
   sofor.html için ANON UPLOAD HELPER (REST API)
   ──────────────────────────────────────────────────────────────────── */
async function podUploadAnon({ path, blob, contentType }) {
  const url = (typeof SB_URL !== 'undefined') ? SB_URL : (window.FILO_CONFIG?.SUPABASE_URL || '');
  const tok = (typeof getSBToken === 'function') ? getSBToken()
            : (window.FILO_CONFIG?.SUPABASE_ANON || '');
  const apikey = (typeof SB_ANON !== 'undefined') ? SB_ANON : (window.FILO_CONFIG?.SUPABASE_ANON || '');
  if (!url) throw new Error('SUPABASE_URL yok');

  const res = await fetch(`${url}/storage/v1/object/pod-documents/${path}`, {
    method: 'POST',
    headers: {
      'apikey': apikey,
      'Authorization': `Bearer ${tok || apikey}`,
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: blob
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Upload hatası: ' + res.status + ' ' + txt);
  }
  // Public URL (private bucket'a anon erişim için signed URL endpoint kullanılabilir)
  return `${url}/storage/v1/object/public/pod-documents/${path}`;
}

async function podPatchAnon(isEmriId, patch) {
  const url = (typeof SB_URL !== 'undefined') ? SB_URL : (window.FILO_CONFIG?.SUPABASE_URL || '');
  const tok = (typeof getSBToken === 'function') ? getSBToken()
            : (window.FILO_CONFIG?.SUPABASE_ANON || '');
  const apikey = (typeof SB_ANON !== 'undefined') ? SB_ANON : (window.FILO_CONFIG?.SUPABASE_ANON || '');
  const dbId = (window.isEmri && window.isEmri._dbId) ? window.isEmri._dbId : isEmriId;
  const res = await fetch(`${url}/rest/v1/is_emirleri?id=eq.${dbId}`, {
    method: 'PATCH',
    headers: {
      'apikey': apikey,
      'Authorization': `Bearer ${tok || apikey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(patch)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Patch hatası: ' + res.status + ' ' + txt);
  }
}

// Window'a expose
window.podModalAc        = podModalAc;
window.podModalKapat     = podModalKapat;
window.podImzaTemizle    = podImzaTemizle;
window.podTeslimOnayla   = podTeslimOnayla;
window.podUploadAnon     = podUploadAnon;
window.podPatchAnon      = podPatchAnon;
window.podTaslakPdfUret  = podTaslakPdfUret;
window.podUrlToDataUrl   = podUrlToDataUrl;
