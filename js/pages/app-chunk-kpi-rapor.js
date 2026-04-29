/* ============================================================================
   app-chunk-kpi-rapor.js — Aylık Sürücü Bazlı KPI Raporu
   ----------------------------------------------------------------------------
   • Ay/yıl seçimi
   • is_emirleri + seferler + yakit_girisleri tablolarından veri toplama
   • Sürücü başına 4 kategoride KPI hesaplama + 0-100 performans skoru
   • Excel (3 sayfa) ve PDF (kapak + sürücü + özet) export
   ============================================================================ */

window.kpiRaporState = {
  ay         : null,    // 'YYYY-MM'
  filtre     : 'all',   // 'all' | surucu_id
  suruculer  : [],      // {id, ad, soyad, avatar_url, durum}
  veri       : null,    // { perDriver: [...], range: {bas, bit} }
  yukleniyor : false,
};
const _KPI = window.kpiRaporState;

/* ──────────────────────────────────────────────────────────────────────
   TÜRKÇE FONT YÜKLEYİCİ — jsPDF'in default Helvetica'sı Latin-1, Türkçe
   karakterleri (ş ğ ı İ ç ö ü) göstermez. CDN'den Roboto TTF çekip
   jsPDF'e kaydederek Türkçe destekli PDF üretiyoruz.
   ──────────────────────────────────────────────────────────────────── */
let _kpiPdfFont = 'helvetica'; // fallback (font yüklenmezse)
const _KPI_FONT_CDN = {
  reg : 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/Roboto_400Regular.ttf',
  bold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/Roboto_700Bold.ttf',
};

function _kpiArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // chunk'lı çevirim büyük buffer'lar için stack overflow'u önler
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function _kpiLoadTurkceFont(pdf) {
  // Cache: önceki PDF'ten kalan base64'leri varsa tekrar fetch etme
  try {
    if (!window._kpiRobotoReg || !window._kpiRobotoBold) {
      const [regBuf, boldBuf] = await Promise.all([
        fetch(_KPI_FONT_CDN.reg).then(r => { if (!r.ok) throw new Error('reg ' + r.status); return r.arrayBuffer(); }),
        fetch(_KPI_FONT_CDN.bold).then(r => { if (!r.ok) throw new Error('bold ' + r.status); return r.arrayBuffer(); }),
      ]);
      window._kpiRobotoReg  = _kpiArrayBufferToBase64(regBuf);
      window._kpiRobotoBold = _kpiArrayBufferToBase64(boldBuf);
    }
    pdf.addFileToVFS('Roboto-Regular.ttf', window._kpiRobotoReg);
    pdf.addFileToVFS('Roboto-Bold.ttf',    window._kpiRobotoBold);
    pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    pdf.addFont('Roboto-Bold.ttf',    'Roboto', 'bold');
    _kpiPdfFont = 'Roboto';
    return true;
  } catch (err) {
    console.warn('KPI: Türkçe font yüklenemedi, ASCII fallback kullanılacak:', err);
    _kpiPdfFont = 'helvetica';
    return false;
  }
}

/** Helvetica fallback için Türkçe → ASCII transliterasyon (font yüklenmezse) */
function _kpiTrAscii(s) {
  if (_kpiPdfFont !== 'helvetica' || s == null) return String(s ?? '');
  return String(s)
    .replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
    .replace(/ı/g,'i').replace(/İ/g,'I').replace(/ç/g,'c').replace(/Ç/g,'C')
    .replace(/ö/g,'o').replace(/Ö/g,'O').replace(/ü/g,'u').replace(/Ü/g,'U');
}

/* ──────────────────────────────────────────────────────────────────────
   GİRİŞ — Sürücü Belge Yönetimi modal'ı 'kpi' tab'ı açıldığında çağrılır
   ──────────────────────────────────────────────────────────────────── */
async function kpiRaporAc() {
  // Varsayılan ay = içinde bulunduğumuz ay
  if (!_KPI.ay) {
    const d = new Date();
    _KPI.ay = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  await _kpiRaporSuruculeriYukle();
  _kpiRaporRenderKontrol();
  _kpiRaporRenderTabloBosluk();
}

function kpiRaporKapat() { /* şimdilik state kalsın, ayar tekrar açıldığında korunur */ }

/* ──────────────────────────────────────────────────────────────────────
   1) SÜRÜCÜ LİSTESİ
   ──────────────────────────────────────────────────────────────────── */
async function _kpiRaporSuruculeriYukle() {
  const sb = (typeof getSB === 'function') ? getSB() : null;
  const firmaId = (typeof currentFirmaId !== 'undefined') ? currentFirmaId : null;
  if (!sb || !firmaId) { _KPI.suruculer = []; return; }
  try {
    const { data, error } = await sb.from('suruculer')
      .select('id, ad, soyad, avatar_url, durum')
      .eq('firma_id', firmaId)
      .neq('durum', 'silindi')
      .order('ad', { ascending: true });
    if (error) throw error;
    _KPI.suruculer = data || [];
  } catch (err) {
    console.error('KPI: sürücüler yüklenemedi', err);
    _KPI.suruculer = [];
  }
}

/* ──────────────────────────────────────────────────────────────────────
   2) UI — KONTROL ÇUBUĞU
   ──────────────────────────────────────────────────────────────────── */
function _kpiRaporRenderKontrol() {
  const host = document.getElementById('dspanel-kpi');
  if (!host) return;
  host.innerHTML = `
    <div class="kpi-panel">
      <div class="kpi-controls">
        <label>Ay/Yıl</label>
        <input type="month" id="kpi-ay" value="${_KPI.ay}" onchange="kpiRaporAyDegistir(this.value)" />
        <label>Sürücü</label>
        <select id="kpi-filtre" onchange="kpiRaporFiltreDegistir(this.value)">
          <option value="all">Tüm sürücüler</option>
          ${_KPI.suruculer.map(s => `<option value="${s.id}" ${_KPI.filtre===s.id?'selected':''}>${_kpiEsc(`${s.ad||''} ${s.soyad||''}`.trim())}</option>`).join('')}
        </select>
        <button class="kpi-btn kpi-btn-yukle" onclick="kpiRaporHesapla()">🔍 Hesapla</button>
        <div class="kpi-spacer"></div>
        <button class="kpi-btn kpi-btn-excel" id="kpi-btn-excel" onclick="kpiRaporExcelIndir()" disabled>📥 Excel</button>
        <button class="kpi-btn kpi-btn-pdf"   id="kpi-btn-pdf"   onclick="kpiRaporPdfIndir()"   disabled>📄 PDF</button>
      </div>
      <div class="kpi-summary" id="kpi-summary"></div>
      <div class="kpi-progress" id="kpi-progress"><div class="kpi-progress-bar" id="kpi-progress-bar"></div></div>
      <div class="kpi-table-wrap">
        <div class="kpi-table-head">
          <span>Sürücü Bazlı KPI Önizleme</span>
          <span class="meta" id="kpi-table-meta">Hesapla butonuyla rapor oluşturun</span>
        </div>
        <div id="kpi-table-host"></div>
      </div>
    </div>`;
}
function _kpiRaporRenderTabloBosluk() {
  const t = document.getElementById('kpi-table-host');
  if (t) t.innerHTML = `<div class="kpi-empty">📊 Hesaplanmış veri yok. Yukarıdan ay seçip "Hesapla" butonuna basın.</div>`;
}

function kpiRaporAyDegistir(v)    { _KPI.ay = v; _kpiBtnDurum(false); }
function kpiRaporFiltreDegistir(v){ _KPI.filtre = v; _kpiBtnDurum(false); }

function _kpiBtnDurum(hazir) {
  const e = document.getElementById('kpi-btn-excel');
  const p = document.getElementById('kpi-btn-pdf');
  if (e) e.disabled = !hazir;
  if (p) p.disabled = !hazir;
}

/* ──────────────────────────────────────────────────────────────────────
   3) HESAPLA — Veri çek + KPI hesapla + tabloyu doldur
   ──────────────────────────────────────────────────────────────────── */
async function kpiRaporHesapla() {
  const sb = getSB();
  const firmaId = currentFirmaId;
  if (!sb || !firmaId) {
    showToast?.('Bulut bağlantısı yok', 'error');
    return;
  }
  if (!_KPI.ay || !/^\d{4}-\d{2}$/.test(_KPI.ay)) {
    showToast?.('Geçerli bir ay seçin', 'error');
    return;
  }
  _KPI.yukleniyor = true;

  const host = document.getElementById('kpi-table-host');
  if (host) host.innerHTML = `<div class="kpi-loading"><div class="kpi-spin"></div>Veriler çekiliyor…</div>`;
  _kpiBtnDurum(false);

  // Tarih aralığı (UTC)
  const [yyyy, mm] = _KPI.ay.split('-').map(Number);
  const bas = new Date(Date.UTC(yyyy, mm-1, 1)).toISOString();
  const bit = new Date(Date.UTC(yyyy, mm,   1)).toISOString();

  try {
    // Üç tabloyu paralel çek
    const [iesRes, sefRes, ykRes] = await Promise.all([
      sb.from('is_emirleri')
        .select('id, surucu_id, durum, fotograflar, atama_zamani, teslim_zamani, created_at, baslangic_km, bitis_km, yukle_yeri, teslim_yeri, musteri_adi, arac_plaka')
        .eq('firma_id', firmaId)
        .gte('atama_zamani', bas)
        .lt('atama_zamani', bit),
      sb.from('seferler')
        .select('id, surucu_id, tarih, kalkis, varis, km, baslangic_km, bitis_km, ucret, yakit_litre, yakit_tutar')
        .eq('firma_id', firmaId)
        .gte('tarih', bas.slice(0,10))
        .lt('tarih',  bit.slice(0,10)),
      sb.from('yakit_girisleri')
        .select('id, surucu_id, arac_id, tarih, litre, fiyat, litre_fiyat')
        .eq('firma_id', firmaId)
        .gte('tarih', bas.slice(0,10))
        .lt('tarih',  bit.slice(0,10))
    ]);

    if (iesRes.error) throw iesRes.error;
    if (sefRes.error) throw sefRes.error;
    if (ykRes.error)  throw ykRes.error;

    const ies = iesRes.data || [];
    const sef = sefRes.data || [];
    const yk  = ykRes.data  || [];

    // KPI hesapla — her sürücü için
    const surucuIds = (_KPI.filtre === 'all')
      ? _KPI.suruculer.map(s => s.id)
      : [_KPI.filtre];

    const perDriver = surucuIds.map(sid => {
      const s = _KPI.suruculer.find(x => x.id === sid);
      const tam = `${s?.ad || ''} ${s?.soyad || ''}`.trim() || 'İsimsiz';
      const ie  = ies.filter(x => x.surucu_id === sid);
      const sf  = sef.filter(x => x.surucu_id === sid);
      const yc  = yk.filter(x  => x.surucu_id === sid);
      return _kpiHesapla(sid, tam, s?.avatar_url || null, ie, sf, yc);
    });

    _KPI.veri = { perDriver, range: { bas, bit, ay: _KPI.ay } };
    _kpiRaporOzetiRender(perDriver);
    _kpiRaporTablosunuRender(perDriver);
    _kpiBtnDurum(perDriver.length > 0);
  } catch (err) {
    console.error('KPI hesaplama hatası:', err);
    if (host) host.innerHTML = `<div class="kpi-empty" style="color:var(--red);">⚠ Hata: ${_kpiEsc(err?.message || 'Bilinmeyen hata')}</div>`;
    _kpiBtnDurum(false);
  } finally {
    _KPI.yukleniyor = false;
  }
}

/* ──────────────────────────────────────────────────────────────────────
   4) KPI HESAPLAMA — bir sürücü için
   ──────────────────────────────────────────────────────────────────── */
function _kpiHesapla(surucuId, ad, avatar, ies, seferler, yakitlar) {
  // A) Teslim & İş Emirleri
  const toplam_is   = ies.length;
  const tamamlanan  = ies.filter(e => e.durum === 'Teslim Edildi').length;
  const iptal       = ies.filter(e => e.durum === 'İptal').length;
  const basari_orani = toplam_is ? (tamamlanan / toplam_is) * 100 : 0;

  // Ortalama teslim süresi (saat) — atama_zamani → teslim_zamani
  const teslimDurations = ies
    .filter(e => e.durum === 'Teslim Edildi' && e.atama_zamani && e.teslim_zamani)
    .map(e => (new Date(e.teslim_zamani) - new Date(e.atama_zamani)) / 3600000);
  const ort_teslim_suresi = teslimDurations.length
    ? teslimDurations.reduce((a,b) => a+b, 0) / teslimDurations.length
    : 0;

  // B) Güzergah & KM (sefer veya is_emri'nden km)
  const seferKm = seferler.map(s => {
    if (s.km != null) return +s.km;
    if (s.baslangic_km != null && s.bitis_km != null && s.bitis_km > s.baslangic_km) return +s.bitis_km - +s.baslangic_km;
    return 0;
  });
  const isKm = ies.filter(e => e.baslangic_km != null && e.bitis_km != null && e.bitis_km > e.baslangic_km)
                  .map(e => +e.bitis_km - +e.baslangic_km);
  const kmList = [...seferKm, ...isKm].filter(k => isFinite(k) && k > 0);
  const toplam_sefer = seferler.length;
  const toplam_km    = kmList.reduce((a,b) => a+b, 0);
  const ort_sefer_km = kmList.length ? toplam_km / kmList.length : 0;

  // C) Yakıt & Maliyet
  const toplam_yakit_lt = yakitlar.reduce((s,y) => s + (+y.litre || 0), 0);
  const toplam_yakit_tl = yakitlar.reduce((s,y) => {
    if (y.fiyat) return s + (+y.fiyat || 0);
    if (y.litre && y.litre_fiyat) return s + (+y.litre * +y.litre_fiyat);
    return s;
  }, 0);
  const km_basi_lt_100km = toplam_km > 0 ? (toplam_yakit_lt / toplam_km) * 100 : 0;
  const km_basi_tl       = toplam_km > 0 ? (toplam_yakit_tl / toplam_km) : 0;

  // D) Fotoğraf & Uyum
  let foto_yuklenen_is = 0;
  let eksik_pod = 0;
  ies.forEach(e => {
    let fotos = [];
    try {
      fotos = typeof e.fotograflar === 'string' ? JSON.parse(e.fotograflar || '[]')
            : Array.isArray(e.fotograflar) ? e.fotograflar : [];
    } catch { fotos = []; }
    if (fotos.length > 0) foto_yuklenen_is++;
    else if (e.durum === 'Teslim Edildi') eksik_pod++;
  });
  const foto_yukleme_orani = toplam_is ? (foto_yuklenen_is / toplam_is) * 100 : 0;
  const uyum_skoru = foto_yukleme_orani; // basit: foto oranı

  // GENEL PERFORMANS SKORU (0-100) — 4 kategori × 25p
  const teslim_p   = (basari_orani / 100) * 25;
  const hiz_p      = ort_teslim_suresi > 0
    ? Math.max(0, Math.min(25, _kpiInterp(ort_teslim_suresi, 4, 24, 25, 0)))
    : (toplam_is ? 25 : 0); // hiç teslim yoksa hız nötr
  const verim_p    = km_basi_lt_100km > 0
    ? Math.max(0, Math.min(25, _kpiInterp(km_basi_lt_100km, 8, 20, 25, 0)))
    : (toplam_km ? 12.5 : 0); // yakıt verisi yoksa nötr-orta
  const uyum_p     = (uyum_skoru / 100) * 25;
  const performans_skoru = Math.round(teslim_p + hiz_p + verim_p + uyum_p);

  return {
    surucu_id: surucuId, ad, avatar,
    toplam_is, tamamlanan, iptal, basari_orani,
    ort_teslim_suresi,
    toplam_sefer, toplam_km, ort_sefer_km,
    toplam_yakit_lt, toplam_yakit_tl, km_basi_lt_100km, km_basi_tl,
    foto_yuklenen_is, foto_yukleme_orani, eksik_pod, uyum_skoru,
    teslim_p, hiz_p, verim_p, uyum_p, performans_skoru,
    _ies: ies // PDF/Excel detay sayfası için
  };
}

/** Lineer interpolasyon: x ∈ [a,b] → y ∈ [yA, yB] (a<b varsayar) */
function _kpiInterp(x, a, b, yA, yB) {
  if (x <= a) return yA;
  if (x >= b) return yB;
  return yA + (yB - yA) * ((x - a) / (b - a));
}

/* ──────────────────────────────────────────────────────────────────────
   5) ÖZET + TABLO RENDER
   ──────────────────────────────────────────────────────────────────── */
function _kpiRaporOzetiRender(perDriver) {
  const sumEl = document.getElementById('kpi-summary');
  if (!sumEl) return;
  const N = perDriver.length;
  const top_is        = perDriver.reduce((s,d) => s + d.toplam_is, 0);
  const top_tamamlanan= perDriver.reduce((s,d) => s + d.tamamlanan, 0);
  const top_km        = perDriver.reduce((s,d) => s + d.toplam_km, 0);
  const top_yakit_tl  = perDriver.reduce((s,d) => s + d.toplam_yakit_tl, 0);
  sumEl.innerHTML = `
    <div class="kpi-sum-card"><div class="kpi-sum-val">${N}</div><div class="kpi-sum-lbl">Sürücü</div></div>
    <div class="kpi-sum-card"><div class="kpi-sum-val" style="color:var(--blue);">${top_is.toLocaleString('tr-TR')}</div><div class="kpi-sum-lbl">Toplam İş Emri</div></div>
    <div class="kpi-sum-card"><div class="kpi-sum-val" style="color:var(--accent);">${Math.round(top_km).toLocaleString('tr-TR')} km</div><div class="kpi-sum-lbl">Toplam Mesafe</div></div>
    <div class="kpi-sum-card"><div class="kpi-sum-val" style="color:var(--green);">₺${Math.round(top_yakit_tl).toLocaleString('tr-TR')}</div><div class="kpi-sum-lbl">Toplam Yakıt Maliyeti</div></div>
  `;
}

function _kpiRaporTablosunuRender(perDriver) {
  const host = document.getElementById('kpi-table-host');
  const meta = document.getElementById('kpi-table-meta');
  if (!host) return;
  if (meta) meta.textContent = `${_KPI.ay} • ${perDriver.length} sürücü`;

  if (!perDriver.length) {
    host.innerHTML = `<div class="kpi-empty">Bu ay için sürücü yok.</div>`;
    return;
  }

  // Performans skoruna göre azalan
  const sorted = [...perDriver].sort((a,b) => b.performans_skoru - a.performans_skoru);
  host.innerHTML = `
    <table class="kpi-table">
      <thead><tr>
        <th>#</th><th>Sürücü</th>
        <th class="num">İş</th><th class="num">Tamam</th><th class="num">Başarı</th>
        <th class="num">Ort. Süre</th><th class="num">Km</th>
        <th class="num">Yakıt (lt)</th><th class="num">₺/km</th>
        <th class="num">Foto %</th><th class="num">Eksik POD</th>
        <th class="num">Skor</th>
      </tr></thead>
      <tbody>
        ${sorted.map((d, i) => {
          const skorCls = d.performans_skoru >= 75 ? 'high' : d.performans_skoru >= 50 ? 'mid' : 'low';
          return `<tr>
            <td>${i+1}</td>
            <td><strong>${_kpiEsc(d.ad)}</strong></td>
            <td class="num">${d.toplam_is}</td>
            <td class="num" style="color:var(--green);">${d.tamamlanan}</td>
            <td class="num">${_kpiPct(d.basari_orani)}</td>
            <td class="num">${d.ort_teslim_suresi ? d.ort_teslim_suresi.toFixed(1) + ' sa' : '—'}</td>
            <td class="num">${Math.round(d.toplam_km).toLocaleString('tr-TR')}</td>
            <td class="num">${d.toplam_yakit_lt ? d.toplam_yakit_lt.toFixed(1) : '—'}</td>
            <td class="num">${d.km_basi_tl ? '₺'+d.km_basi_tl.toFixed(2) : '—'}</td>
            <td class="num" style="color:${d.foto_yukleme_orani>=80?'var(--green)':d.foto_yukleme_orani>=50?'var(--yellow)':'var(--red)'};">${_kpiPct(d.foto_yukleme_orani)}</td>
            <td class="num" style="color:${d.eksik_pod?'var(--red)':'var(--muted)'};">${d.eksik_pod || '—'}</td>
            <td class="num"><span class="kpi-skor-pill ${skorCls}">${d.performans_skoru}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/* ──────────────────────────────────────────────────────────────────────
   6) EXCEL ÇIKTISI — SheetJS (xlsx) ile, 3 sayfa
   ──────────────────────────────────────────────────────────────────── */
async function kpiRaporExcelIndir() {
  if (typeof XLSX === 'undefined') { showToast?.('Excel kütüphanesi yüklenmedi', 'error'); return; }
  if (!_KPI.veri || !_KPI.veri.perDriver?.length) { showToast?.('Önce hesapla butonuna basın', 'error'); return; }

  const btn = document.getElementById('kpi-btn-excel');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }

  try {
    const wb = XLSX.utils.book_new();

    // ── SAYFA 1: Özet (tüm sürücülerin tek satırlık karşılaştırma tablosu) ──
    const sorted = [..._KPI.veri.perDriver].sort((a,b) => b.performans_skoru - a.performans_skoru);
    const ozetRows = [
      ['#', 'Sürücü', 'Toplam İş', 'Tamamlanan', 'İptal', 'Başarı %',
       'Ort. Teslim (sa)', 'Sefer', 'Toplam Km', 'Ort. Sefer Km',
       'Yakıt (lt)', 'Yakıt (₺)', 'lt/100km', '₺/km',
       'Fotolu İş', 'Foto Oranı %', 'Eksik POD', 'Uyum Skoru',
       'Teslim P (25)', 'Hız P (25)', 'Verim P (25)', 'Uyum P (25)', 'PERFORMANS (100)']
    ];
    sorted.forEach((d, i) => {
      ozetRows.push([
        i+1, d.ad,
        d.toplam_is, d.tamamlanan, d.iptal, _r1(d.basari_orani),
        _r1(d.ort_teslim_suresi), d.toplam_sefer, _r1(d.toplam_km), _r1(d.ort_sefer_km),
        _r1(d.toplam_yakit_lt), _r1(d.toplam_yakit_tl), _r1(d.km_basi_lt_100km), _r2(d.km_basi_tl),
        d.foto_yuklenen_is, _r1(d.foto_yukleme_orani), d.eksik_pod, _r1(d.uyum_skoru),
        _r1(d.teslim_p), _r1(d.hiz_p), _r1(d.verim_p), _r1(d.uyum_p), d.performans_skoru
      ]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(ozetRows);
    ws1['!cols'] = [{wch:4},{wch:24},{wch:9},{wch:11},{wch:7},{wch:9},{wch:14},{wch:7},{wch:11},{wch:13},{wch:11},{wch:11},{wch:9},{wch:8},{wch:9},{wch:13},{wch:11},{wch:13},{wch:11},{wch:11},{wch:11},{wch:11},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws1, 'Özet');

    // ── SAYFA 2: Detay (sürücü başına KPI kartı + iş emri listesi) ──
    const detayRows = [];
    sorted.forEach(d => {
      detayRows.push([`════ ${d.ad} • Performans: ${d.performans_skoru}/100 ════`]);
      detayRows.push(['Metrik', 'Değer', 'Birim']);
      detayRows.push(['Toplam İş Emri', d.toplam_is, 'adet']);
      detayRows.push(['Tamamlanan',     d.tamamlanan, 'adet']);
      detayRows.push(['İptal',          d.iptal,      'adet']);
      detayRows.push(['Başarı Oranı',   _r1(d.basari_orani), '%']);
      detayRows.push(['Ort. Teslim Süresi', _r1(d.ort_teslim_suresi), 'saat']);
      detayRows.push(['Toplam Sefer',   d.toplam_sefer, 'adet']);
      detayRows.push(['Toplam Km',      _r1(d.toplam_km), 'km']);
      detayRows.push(['Ort. Sefer Km',  _r1(d.ort_sefer_km), 'km']);
      detayRows.push(['Toplam Yakıt',   _r1(d.toplam_yakit_lt), 'litre']);
      detayRows.push(['Toplam Yakıt',   _r1(d.toplam_yakit_tl), '₺']);
      detayRows.push(['Yakıt Verimliliği', _r1(d.km_basi_lt_100km), 'lt/100km']);
      detayRows.push(['Km Başı Maliyet', _r2(d.km_basi_tl), '₺/km']);
      detayRows.push(['Fotoğraflı İş',  d.foto_yuklenen_is, 'adet']);
      detayRows.push(['Foto Yükleme Oranı', _r1(d.foto_yukleme_orani), '%']);
      detayRows.push(['Eksik POD (teslim ama foto yok)', d.eksik_pod, 'adet']);
      detayRows.push([]);
      detayRows.push(['── İŞ EMİRLERİ (sürücüye ait) ──']);
      detayRows.push(['#', 'Müşteri', 'Plaka', 'Yükle', 'Teslim', 'Durum', 'Atama', 'Teslim Zamanı']);
      d._ies.forEach(ie => {
        detayRows.push([
          ie.id, ie.musteri_adi || '', ie.arac_plaka || '',
          ie.yukle_yeri || '', ie.teslim_yeri || '', ie.durum || '',
          ie.atama_zamani ? new Date(ie.atama_zamani).toLocaleString('tr-TR') : '',
          ie.teslim_zamani ? new Date(ie.teslim_zamani).toLocaleString('tr-TR') : ''
        ]);
      });
      detayRows.push([]);
      detayRows.push([]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(detayRows);
    ws2['!cols'] = [{wch:36},{wch:24},{wch:10},{wch:24},{wch:24},{wch:14},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Detay');

    // ── SAYFA 3: Pivot Veri (ham iş emirleri) — kullanıcı kendi pivotunu yapar ──
    const pivotRows = [
      ['Sürücü', 'Sürücü ID', 'İş Emri ID', 'Müşteri', 'Plaka', 'Durum',
       'Atama Zamanı', 'Teslim Zamanı', 'Yükle', 'Teslim',
       'Başlangıç Km', 'Bitiş Km', 'Katedilen Km', 'Foto Sayısı']
    ];
    sorted.forEach(d => {
      d._ies.forEach(ie => {
        let fotoCount = 0;
        try {
          const f = typeof ie.fotograflar === 'string' ? JSON.parse(ie.fotograflar||'[]') : (ie.fotograflar||[]);
          fotoCount = Array.isArray(f) ? f.length : 0;
        } catch {}
        pivotRows.push([
          d.ad, d.surucu_id, ie.id, ie.musteri_adi || '', ie.arac_plaka || '', ie.durum || '',
          ie.atama_zamani ? new Date(ie.atama_zamani).toLocaleString('tr-TR') : '',
          ie.teslim_zamani ? new Date(ie.teslim_zamani).toLocaleString('tr-TR') : '',
          ie.yukle_yeri || '', ie.teslim_yeri || '',
          ie.baslangic_km ?? '', ie.bitis_km ?? '',
          (ie.baslangic_km != null && ie.bitis_km != null) ? Math.max(0, +ie.bitis_km - +ie.baslangic_km) : '',
          fotoCount
        ]);
      });
    });
    const ws3 = XLSX.utils.aoa_to_sheet(pivotRows);
    ws3['!cols'] = [{wch:22},{wch:38},{wch:8},{wch:22},{wch:10},{wch:14},{wch:18},{wch:18},{wch:24},{wch:24},{wch:11},{wch:9},{wch:11},{wch:9}];
    XLSX.utils.book_append_sheet(wb, ws3, 'Pivot Veri');

    // İndir
    const ad = `Surucu_KPI_${_KPI.ay}.xlsx`;
    XLSX.writeFile(wb, ad);
    if (btn) { btn.textContent = '✓ İndirildi'; setTimeout(() => { if(btn){btn.disabled=false;btn.textContent='📥 Excel';} }, 2500); }
  } catch (err) {
    console.error('Excel hatası:', err);
    showToast?.('Excel oluşturulamadı: ' + (err?.message || 'hata'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📥 Excel'; }
  }
}

/* ──────────────────────────────────────────────────────────────────────
   7) PDF ÇIKTISI — jsPDF, kapak + sürücü başına 1 sayfa + özet ranking
   ──────────────────────────────────────────────────────────────────── */
async function kpiRaporPdfIndir() {
  if (typeof window.jspdf === 'undefined') { showToast?.('PDF kütüphanesi yüklenmedi', 'error'); return; }
  if (!_KPI.veri || !_KPI.veri.perDriver?.length) { showToast?.('Önce hesapla butonuna basın', 'error'); return; }

  const btn = document.getElementById('kpi-btn-pdf');
  const prog = document.getElementById('kpi-progress');
  const bar  = document.getElementById('kpi-progress-bar');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ PDF oluşturuluyor...'; }
  if (prog) prog.classList.add('show');

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Türkçe karakter desteği: Roboto TTF yükle (başarısız olursa helvetica + ASCII fallback)
    if (btn) btn.textContent = '⏳ Font yükleniyor...';
    await _kpiLoadTurkceFont(pdf);
    if (btn) btn.textContent = '⏳ PDF oluşturuluyor...';

    const sorted = [..._KPI.veri.perDriver].sort((a,b) => b.performans_skoru - a.performans_skoru);

    const W = 210, H = 297;
    const firmaAdi = (typeof currentFirmaAdi !== 'undefined' && currentFirmaAdi) ? currentFirmaAdi : 'Fleetly';
    const ayLbl = _kpiAyLabel(_KPI.ay);

    // ── KAPAK ─────────────────────────────────────────────────────
    pdf.setFillColor(232, 82, 26); // accent
    pdf.rect(0, 0, W, 38, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont(_kpiPdfFont, 'bold'); pdf.setFontSize(22);
    pdf.text(_kpiTrAscii(firmaAdi), 14, 22);
    pdf.setFontSize(11); pdf.setFont(_kpiPdfFont, 'normal');
    pdf.text(_kpiTrAscii('Sürücü KPI Raporu'), 14, 30);

    pdf.setTextColor(20, 20, 30);
    pdf.setFont(_kpiPdfFont, 'bold'); pdf.setFontSize(34);
    pdf.text(_kpiTrAscii(ayLbl), 14, 70);
    pdf.setFontSize(11); pdf.setFont(_kpiPdfFont, 'normal');
    pdf.setTextColor(80, 96, 128);
    pdf.text(_kpiTrAscii('Aylık Sürücü Performans Karnesi'), 14, 80);

    // Genel istatistikler kapakta
    const top_is        = sorted.reduce((s,d) => s + d.toplam_is, 0);
    const top_tamamlanan= sorted.reduce((s,d) => s + d.tamamlanan, 0);
    const top_km        = sorted.reduce((s,d) => s + d.toplam_km, 0);
    const top_yakit_tl  = sorted.reduce((s,d) => s + d.toplam_yakit_tl, 0);
    const top_yakit_lt  = sorted.reduce((s,d) => s + d.toplam_yakit_lt, 0);
    const ortSkor       = sorted.length ? Math.round(sorted.reduce((s,d) => s+d.performans_skoru, 0) / sorted.length) : 0;

    let y = 100;
    _pdfStat(pdf, 14, y, 'Sürücü', sorted.length); _pdfStat(pdf, 65, y, 'İş Emri', top_is);
    _pdfStat(pdf, 116, y, 'Tamamlanan', top_tamamlanan); _pdfStat(pdf, 167, y, 'Ort. Skor', ortSkor + '/100');
    y += 28;
    _pdfStat(pdf, 14, y, 'Toplam Km', Math.round(top_km).toLocaleString('tr-TR'));
    _pdfStat(pdf, 65, y, 'Toplam Yakıt', _r1(top_yakit_lt) + ' lt');
    _pdfStat(pdf, 116, y, 'Yakıt Maliyeti', '₺' + Math.round(top_yakit_tl).toLocaleString('tr-TR'));
    _pdfStat(pdf, 167, y, 'Başarı', sorted.length ? _r1(top_is ? top_tamamlanan/top_is*100 : 0) + '%' : '—');

    pdf.setFontSize(9); pdf.setTextColor(120, 130, 150);
    const olusturma = new Date().toLocaleString('tr-TR', { dateStyle:'long', timeStyle:'short' });
    pdf.text(_kpiTrAscii('Oluşturma: ' + olusturma), 14, 285);
    pdf.text('Sayfa 1', W - 24, 285);

    // ── HER SÜRÜCÜ İÇİN 1 SAYFA ──────────────────────────────────
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      pdf.addPage();
      _pdfDriverPage(pdf, d, i+1, sorted.length, ayLbl, firmaAdi);
      if (bar) bar.style.width = Math.round(((i+1)/(sorted.length+1)) * 100) + '%';
      // Browser'ın boğulmasına engel ol — her sürücüde küçük yield
      if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
    }

    // ── SONA ÖZET / RANKING SAYFASI ──────────────────────────────
    pdf.addPage();
    _pdfRankingPage(pdf, sorted, ayLbl);
    if (bar) bar.style.width = '100%';

    // İndir
    pdf.save(`Surucu_KPI_${_KPI.ay}.pdf`);
    if (btn) { btn.textContent = '✓ İndirildi'; setTimeout(() => { if(btn){btn.disabled=false;btn.textContent='📄 PDF';} }, 2500); }
    setTimeout(() => { if (prog) prog.classList.remove('show'); if (bar) bar.style.width = '0%'; }, 800);
  } catch (err) {
    console.error('PDF hatası:', err);
    showToast?.('PDF oluşturulamadı: ' + (err?.message || 'hata'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📄 PDF'; }
    if (prog) prog.classList.remove('show');
  }
}

/* PDF: küçük stat kutusu */
function _pdfStat(pdf, x, y, lbl, val) {
  pdf.setFillColor(245, 247, 252);
  pdf.roundedRect(x, y, 44, 22, 2, 2, 'F');
  pdf.setTextColor(80, 96, 128);
  pdf.setFontSize(8); pdf.setFont(_kpiPdfFont, 'normal');
  pdf.text(_kpiTrAscii(lbl), x + 3, y + 6);
  pdf.setTextColor(20, 25, 50);
  pdf.setFontSize(13); pdf.setFont(_kpiPdfFont, 'bold');
  pdf.text(_kpiTrAscii(String(val)), x + 3, y + 17);
}

/* PDF: sürücü sayfası */
function _pdfDriverPage(pdf, d, idx, total, ayLbl, firmaAdi) {
  const W = 210;
  // Üst banner
  pdf.setFillColor(16, 20, 42); // surface
  pdf.rect(0, 0, W, 32, 'F');
  pdf.setTextColor(255,255,255);
  pdf.setFont(_kpiPdfFont, 'bold'); pdf.setFontSize(16);
  pdf.text(_kpiTrAscii(d.ad), 14, 16);
  pdf.setFont(_kpiPdfFont,'normal'); pdf.setFontSize(9);
  pdf.setTextColor(168, 184, 216);
  pdf.text(_kpiTrAscii(`${firmaAdi} • ${ayLbl}`), 14, 24);

  // Performans skoru rozeti
  const skorRenk = d.performans_skoru >= 75 ? [34,197,94] : d.performans_skoru >= 50 ? [212,168,71] : [239,68,68];
  pdf.setFillColor(skorRenk[0], skorRenk[1], skorRenk[2]);
  pdf.roundedRect(W-50, 6, 36, 20, 3, 3, 'F');
  pdf.setTextColor(255,255,255);
  pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(20);
  pdf.text(String(d.performans_skoru), W-46, 19);
  pdf.setFontSize(7); pdf.setFont(_kpiPdfFont,'normal');
  pdf.text('/ 100', W-23, 19);

  // 4 KPI kartı (2x2)
  let y = 44;
  _pdfKpiCard(pdf, 14,  y, '🎯 TESLİM',     `${d.tamamlanan}/${d.toplam_is}`, _r1(d.basari_orani)+'%', d.teslim_p, 25);
  _pdfKpiCard(pdf, 110, y, '⏱ HIZ',         d.ort_teslim_suresi ? _r1(d.ort_teslim_suresi)+' sa' : '—', 'ort.teslim', d.hiz_p, 25);
  y += 38;
  _pdfKpiCard(pdf, 14,  y, '⛽ VERİMLİLİK',   d.km_basi_lt_100km ? _r1(d.km_basi_lt_100km)+' lt/100km' : '—', d.km_basi_tl ? '₺'+_r2(d.km_basi_tl)+'/km' : '', d.verim_p, 25);
  _pdfKpiCard(pdf, 110, y, '📸 UYUM (POD)', _r1(d.foto_yukleme_orani)+'%', d.eksik_pod ? `${d.eksik_pod} eksik POD` : 'tam uyum', d.uyum_p, 25);

  // Detay metrik tablosu
  y += 44;
  pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(10); pdf.setTextColor(20,25,50);
  pdf.text(_kpiTrAscii('Detaylı Metrikler'), 14, y);
  y += 4;
  pdf.setDrawColor(220, 225, 240); pdf.line(14, y, W-14, y);
  y += 6;

  const metrics = [
    ['Toplam İş Emri',     d.toplam_is,           'adet'],
    ['Tamamlanan',         d.tamamlanan,          'adet'],
    ['İptal',              d.iptal,               'adet'],
    ['Toplam Sefer',       d.toplam_sefer,        'adet'],
    ['Toplam Km',          _r1(d.toplam_km),      'km'],
    ['Ort. Sefer Km',      _r1(d.ort_sefer_km),   'km'],
    ['Toplam Yakıt',       _r1(d.toplam_yakit_lt),'litre'],
    ['Yakıt Maliyeti',     '₺'+_r1(d.toplam_yakit_tl), ''],
    ['Fotoğraflı İş',      d.foto_yuklenen_is,    'adet'],
    ['Eksik POD',          d.eksik_pod,           'adet'],
  ];
  pdf.setFont(_kpiPdfFont,'normal'); pdf.setFontSize(9);
  metrics.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 14 : 110;
    const yy = y + row * 7;
    pdf.setTextColor(80, 96, 128);
    pdf.text(_kpiTrAscii(m[0]), x, yy);
    pdf.setTextColor(20, 25, 50); pdf.setFont(_kpiPdfFont,'bold');
    pdf.text(_kpiTrAscii(`${m[1]} ${m[2]}`), x + 60, yy, { align: 'right' });
    pdf.setFont(_kpiPdfFont,'normal');
  });
  y += Math.ceil(metrics.length / 2) * 7 + 6;

  // Skor breakdown bar
  pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(10); pdf.setTextColor(20,25,50);
  pdf.text(_kpiTrAscii('Performans Skoru Dağılımı (her bileşen 25 puan)'), 14, y);
  y += 4;
  const segs = [
    ['Teslim',   d.teslim_p, [34,197,94]],
    ['Hız',      d.hiz_p,    [56,189,248]],
    ['Verim',    d.verim_p,  [167,139,250]],
    ['Uyum',     d.uyum_p,   [232,82,26]]
  ];
  const barW = W - 28;
  // Arka zemin
  pdf.setFillColor(238, 240, 248);
  pdf.roundedRect(14, y+2, barW, 9, 2, 2, 'F');
  // Segmentler
  let cx = 14;
  segs.forEach(s => {
    const w = (s[1] / 100) * barW;
    pdf.setFillColor(s[2][0], s[2][1], s[2][2]);
    pdf.rect(cx, y+2, w, 9, 'F');
    cx += w;
  });
  // Legend
  y += 16;
  segs.forEach((s, i) => {
    const x = 14 + i * 50;
    pdf.setFillColor(s[2][0], s[2][1], s[2][2]);
    pdf.rect(x, y-3, 4, 4, 'F');
    pdf.setTextColor(80, 96, 128); pdf.setFontSize(8); pdf.setFont(_kpiPdfFont,'normal');
    pdf.text(_kpiTrAscii(`${s[0]}: ${_r1(s[1])}/25`), x + 6, y);
  });

  // İş emri özeti — son 5
  y += 14;
  pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(10); pdf.setTextColor(20,25,50);
  pdf.text(_kpiTrAscii('Son İş Emirleri (en güncel 5)'), 14, y);
  y += 5;
  pdf.setDrawColor(220, 225, 240); pdf.line(14, y, W-14, y); y += 5;

  pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(8); pdf.setTextColor(80,96,128);
  pdf.text('#', 14, y); pdf.text(_kpiTrAscii('Müşteri'), 25, y); pdf.text(_kpiTrAscii('Yükle → Teslim'), 75, y); pdf.text('Durum', 160, y);
  y += 4;
  pdf.setFont(_kpiPdfFont,'normal');
  const son = [...(d._ies||[])].sort((a,b)=>new Date(b.atama_zamani)-new Date(a.atama_zamani)).slice(0,5);
  son.forEach(ie => {
    pdf.setTextColor(20, 25, 50);
    pdf.text(String(ie.id), 14, y);
    pdf.text(_kpiTrAscii(_kpiTrunc(ie.musteri_adi || '—', 28)), 25, y);
    pdf.text(_kpiTrAscii(_kpiTrunc(`${ie.yukle_yeri || '—'} → ${ie.teslim_yeri || '—'}`, 50)), 75, y);
    pdf.text(_kpiTrAscii(ie.durum || '—'), 160, y);
    y += 5;
  });
  if (!son.length) {
    pdf.setTextColor(120,130,150);
    pdf.text(_kpiTrAscii('Bu ay iş emri yok.'), 14, y);
  }

  // Footer
  pdf.setFontSize(8); pdf.setTextColor(120,130,150);
  pdf.text(_kpiTrAscii(`${firmaAdi} • ${ayLbl}`), 14, 290);
  pdf.text(_kpiTrAscii(`Sayfa ${idx+1} / ${total+2}`), W - 30, 290);
}

/* PDF: KPI kartı */
function _pdfKpiCard(pdf, x, y, lbl, mainVal, sub, puan, maxPuan) {
  pdf.setFillColor(245, 247, 252);
  pdf.roundedRect(x, y, 86, 32, 3, 3, 'F');
  pdf.setTextColor(80, 96, 128); pdf.setFontSize(8); pdf.setFont(_kpiPdfFont,'bold');
  pdf.text(_kpiTrAscii(lbl), x + 4, y + 7);
  pdf.setTextColor(20, 25, 50); pdf.setFontSize(15);
  pdf.text(_kpiTrAscii(String(mainVal)), x + 4, y + 17);
  pdf.setFontSize(8); pdf.setFont(_kpiPdfFont,'normal'); pdf.setTextColor(120,130,150);
  pdf.text(_kpiTrAscii(String(sub || '')), x + 4, y + 23);
  // Puan
  pdf.setTextColor(20,25,50); pdf.setFontSize(7); pdf.setFont(_kpiPdfFont,'bold');
  pdf.text(`${_r1(puan)}/${maxPuan}p`, x + 82, y + 28, { align: 'right' });
}

/* PDF: ranking sayfası */
function _pdfRankingPage(pdf, sorted, ayLbl) {
  const W = 210;
  pdf.setFillColor(16, 20, 42); pdf.rect(0, 0, W, 22, 'F');
  pdf.setTextColor(255,255,255); pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(14);
  pdf.text(_kpiTrAscii('Sıralama Özeti'), 14, 14);
  pdf.setFont(_kpiPdfFont,'normal'); pdf.setFontSize(9); pdf.setTextColor(168,184,216);
  pdf.text(_kpiTrAscii(ayLbl), W-14, 14, { align: 'right' });

  // Top 5
  let y = 36;
  pdf.setTextColor(34, 197, 94); pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(12);
  pdf.text(_kpiTrAscii('🏆 En İyi 5'), 14, y); y += 6;
  const top5 = sorted.slice(0, 5);
  _pdfRankTable(pdf, 14, y, top5, [34,197,94]);
  y += top5.length * 8 + 10;

  // Bottom 5 (en kötüler)
  pdf.setTextColor(239, 68, 68); pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(12);
  pdf.text(_kpiTrAscii('⚠ Gelişim Gereken 5'), 14, y); y += 6;
  const bottom5 = sorted.slice(-5).reverse();
  _pdfRankTable(pdf, 14, y, bottom5, [239,68,68]);
  y += bottom5.length * 8 + 10;

  // Tüm sürücüler tablosu (kompakt)
  pdf.setTextColor(20,25,50); pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(11);
  pdf.text(_kpiTrAscii('Tüm Sürücüler — Tam Liste'), 14, y); y += 6;
  pdf.setDrawColor(220,225,240); pdf.line(14, y, W-14, y); y += 5;

  pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(8); pdf.setTextColor(80,96,128);
  ['#', 'Sürücü', 'İş', 'Tamam', 'Başarı %', 'Km', 'Foto %', 'Skor'].forEach((h, i) => {
    const xs = [14, 22, 90, 105, 122, 142, 162, 185];
    pdf.text(_kpiTrAscii(h), xs[i], y);
  });
  y += 4;
  pdf.setFont(_kpiPdfFont,'normal');
  sorted.forEach((d, i) => {
    if (y > 280) { pdf.addPage(); y = 20; }
    pdf.setTextColor(20,25,50);
    const xs = [14, 22, 90, 105, 122, 142, 162, 185];
    pdf.text(String(i+1), xs[0], y);
    pdf.text(_kpiTrAscii(_kpiTrunc(d.ad, 32)), xs[1], y);
    pdf.text(String(d.toplam_is), xs[2], y);
    pdf.text(String(d.tamamlanan), xs[3], y);
    pdf.text(_r1(d.basari_orani)+'%', xs[4], y);
    pdf.text(Math.round(d.toplam_km).toLocaleString('tr-TR'), xs[5], y);
    pdf.text(_r1(d.foto_yukleme_orani)+'%', xs[6], y);
    pdf.setFont(_kpiPdfFont,'bold');
    const c = d.performans_skoru >= 75 ? [34,197,94] : d.performans_skoru >= 50 ? [212,168,71] : [239,68,68];
    pdf.setTextColor(c[0],c[1],c[2]);
    pdf.text(String(d.performans_skoru), xs[7], y);
    pdf.setFont(_kpiPdfFont,'normal');
    y += 6;
  });
}

function _pdfRankTable(pdf, x, y, list, color) {
  list.forEach((d, i) => {
    pdf.setFillColor(color[0], color[1], color[2], 0.08);
    pdf.roundedRect(x, y - 5, 195, 7, 1, 1, 'F');
    pdf.setTextColor(color[0], color[1], color[2]); pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(10);
    pdf.text(_kpiTrAscii(`${i+1}. ${d.ad}`), x + 3, y);
    pdf.setTextColor(80,96,128); pdf.setFont(_kpiPdfFont,'normal'); pdf.setFontSize(8);
    pdf.text(_kpiTrAscii(`${d.tamamlanan}/${d.toplam_is} iş • ${Math.round(d.toplam_km)} km • ${_r1(d.foto_yukleme_orani)}% foto`), x + 60, y);
    pdf.setTextColor(20,25,50); pdf.setFont(_kpiPdfFont,'bold'); pdf.setFontSize(11);
    pdf.text(`${d.performans_skoru}/100`, x + 178, y);
    y += 8;
  });
}

/* ──────────────────────────────────────────────────────────────────────
   YARDIMCILAR
   ──────────────────────────────────────────────────────────────────── */
function _kpiEsc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function _kpiPct(v) { return (isFinite(v) ? v.toFixed(1) : '0.0') + '%'; }
function _r1(v) { return isFinite(v) ? Math.round(v * 10) / 10 : 0; }
function _r2(v) { return isFinite(v) ? Math.round(v * 100) / 100 : 0; }
function _kpiTrunc(s, n) { s = String(s||''); return s.length > n ? s.slice(0, n-1) + '…' : s; }
function _kpiAyLabel(ay) {
  if (!ay) return '';
  const [y, m] = ay.split('-').map(Number);
  const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${aylar[m-1]} ${y}`;
}
