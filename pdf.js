/* ================================================================
   ORTAK PDF YARDIMCILARI
   ================================================================ */
const LOGO_B64_SHARED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAFHUlEQVR4nO3dTW7UQBAF4JyCq3EQ7sARsuAC3IAtWbOBJZtssgCBhFCEkCCZmeD2zBgnmfFP13vdVdXVUolNZE/6ozztKrdzcUEaf1+9eIhYHiwH8ag9Md4jUBuKgG0kAreBCNwGImAbicBtIALYeQRuAxG4DUTgNhAB7DwCt4EIYOcRwM4jcBuIAHYeAew8Ath5BLDzCODM2N58fNjdfuv/rf1ZZoFrfwiLsdtu9vHnd/XPMotc+wNYix52t9vH/Z34eGkEMCjGIxv4iNvF5upS/DmejgAG4OZOZsrY/8BbOC4DuQlg1ESOszctshi4aOQAXorbLajGwExcJLJ7YNQEPsrejNVzABcGXoXbXY4l2RvAinF74G5BNQB3t0klcFHIAbwIWJa9uciIOXALjMPdim+NAlg1sDx7A1gr7rgsKcjeHGTUXLgDRk7aOHtRnaOSuE0Br8Z9VJaUXZ7Hsfn8vhiuO2BW9iLbgpufX/bRQR8/M3NOmgBejSssS57F/fB2j/v9uticuAGmZS+g5zsAd7CbXz+G7A1gAPDa4/SP4xCy9+7Nyz1ul8El58UFMHLBIi1Lnos+e9Pl+eZTANcFxmdvD3xYXJWeG/PAtOwFFDYG3C5ra2RvAD8D9pW95oGhuOCy5ICbsjctrgreGgXwKWBCWbIHrpi9poGhuMSyZJ+9Fb57TQNPjSxgVlnycGt0/+51ACOAs3BZZcmUvYXLki6AqdmLLEsevntrZq8r4JxjscqSNZoKLoDx2UssSxZuKrgGzj0eI3vTJblGU8E8MB6XVJas1FQI4GfA/sqSZoHhuMyypKLsbRdYuA30LLCy7DUBDMdlFTaOTQVF2aseeGpkA5PLkrXnzAVwNi5gG+hJXAVNBXPAnOwd3RoRypLpwbra82YeOBvh6tJ1U8EUMCV7x7dGyLKkkqaCC2DJMWlNhYqP45gEpuCysvfYVOiga89b28CAt9M9DW1NBRPAFFzA2+lOxdBUUNASbBu4obKkamAKLrMsaSB71QBPDREwcxO34pWzGWARLqssqbSpoBaYl73cbaC15808sPS41LKkkeytDlwke5G3RkZWzuqBpcdtsamgDpiGy3reKuF2iyutTYV2gAnbQC00FVQB03BZ20ANNBXaACYUNvqmgsHFVTVgGi6rLGmkqeAfmLANtH95meHsLQ7MwqVtAz2WJY1mb1HgqSE9Nq0safC+Vx0w4tjRVKgMXCx7Gy9LFgXe3X6dBYach9nQN569UOAEeiqo2cssSzrIXgjwOdg5YMh/KkZZ8pi9xhdXEOBc3PHlO/vcrLKk0aYCHHgOdw5YiswoSw67BJ1kLxV4DlcCTC9LGmwqQIER2StBZpQlrTcVigIvxc0BppUljTcVigFPDQQwoyw5ZK+j797iwOd+fj1wNBWowMjL81rkKEsWAJ5DZuHugYmP4zgoS54ETgMJ/BR57mcXnzPKknm4DOA1sfichG2gnpoKpoFphQ3H2SsCRiEvPhejLOmsqWAWmLYN9NBU0PjyMhXAUuTF5yC8nc5jU2ESuDTyYgjW2+kcNhUmcSXAa6BXH3Pc8wWVJYddgo4XVxTgU+DiY6TVc7r/ZfyhZodlyUlgBrI0+s5Rt8hCPY7juakwi6sRGB2a/p5RFWDvyBZePUjF9YzsvamwGNcrsveV8ypcb8D94irdHjn+7l0N7A25iZJk7qj9C0SQYANZb0BxA1lXUHADun7QYQO7EdQlo/bEWAuWwz+aKJThdQXEYAAAAABJRU5ErkJggg==';

function _pdfSave(doc, filename) {
  try {
    doc.save(filename);
  } catch(e) {
    var blob = doc.output('blob');
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }
}

function _pdfCommonSetup(title, subtitle, accentColor) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, ML = 14, MR = 14, CW = PW - ML - MR;

  function tr(s) {
    if (!s) return '';
    return String(s)
      .replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C').replace(/ı/g,'i').replace(/İ/g,'I')
      .replace(/â/g,'a').replace(/Â/g,'A').replace(/î/g,'i');
  }

  const C = {
    bg:[8,12,16], surface:[17,24,32], surface2:[24,32,44], border:[37,47,62],
    accent: accentColor,
    text:[226,234,243], text2:[168,184,204], muted:[82,96,112],
    green:[34,197,94], yellow:[245,158,11], red:[239,68,68],
    blue:[56,189,248], orange:[249,115,22], purple:[167,139,250], white:[255,255,255],
  };

  const setFill = c => doc.setFillColor(...c);
  const setTxt  = c => doc.setTextColor(...c);
  const rect    = (x,y,w,h,s='F') => doc.rect(x,y,w,h,s);
  const rRect   = (x,y,w,h,r,s='F') => doc.roundedRect(x,y,w,h,r,r,s);

  let pageNum = 1;
  function addFooter() {
    setTxt(C.muted); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(tr('Filo Takip Sistemi - ') + tr(title), ML, PH-8);
    doc.text(tr('Sayfa ') + pageNum, PW-MR, PH-8, {align:'right'});
    doc.text(new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'}), PW/2, PH-8, {align:'center'});
    setTxt([50,62,78]); doc.setFontSize(6);
    doc.text('created by cihanozcan app.', PW/2, PH-3, {align:'center'});
  }
  function newPage() {
    addFooter(); doc.addPage(); pageNum++;
    setFill(C.bg); rect(0,0,PW,PH);
  }

  // Arka plan
  setFill(C.bg); rect(0,0,PW,PH);

  // Header bandı
  setFill(C.surface); rect(0,0,PW,44);
  setFill(C.accent);  rect(0,0,4,44);
  setTxt(C.white); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text(tr(title), ML+8, 20);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); setTxt(C.text2);
  doc.text(tr(subtitle), ML+8, 29);
  const dateStr = new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'});
  setFill(C.surface2); rRect(PW-ML-58,10,58,20,3);
  setTxt(C.accent); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr(dateStr), PW-ML-29, 21, {align:'center'});

  return { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage, getPage: ()=>pageNum };
}

function _pdfKpiRow(doc, ML, CW, y, cards, C, setFill, setTxt, rRect) {
  const n = cards.length;
  const cW = (CW - (n-1)*3) / n;
  cards.forEach((card, i) => {
    const cx = ML + i*(cW+3);
    setFill(C.surface); rRect(cx, y, cW, 22, 2);
    setFill(card.color.map ? card.color : C.accent);
    rRect(cx, y, 3, 22, 1);
    setTxt(card.color); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(card.val, cx+6, y+10);
    setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
    doc.text(card.lbl.toUpperCase(), cx+6, y+18);
  });
  return y + 28;
}

/* ================================================================
   SEFERLERi PDF
   ================================================================ */
async function downloadSeferPDF() {
  if (seferData.length === 0) { showToast('Indirilecek sefer kaydi yok.', 'error'); return; }
  showToast('Sefer raporu hazirlaniyor...', 'info');

  const { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage } = _pdfCommonSetup(
    'Sefer Raporu', 'Fleetly  |  Tüm Seferler  |  Detaylı Lojistik Analizi', [167,139,250]
  );

  let y = 54;

  // ── KPI KARTI SATIRI ──
  const totalSefer  = seferData.length;
  const totalKm     = seferData.reduce((a,s)=>a+(s.km||0),0);
  const totalCiro   = seferData.reduce((a,s)=>a+(s.ucret||0),0);
  const buAy        = new Date().toISOString().slice(0,7);
  const buAySeferler= seferData.filter(s=>s.tarih&&s.tarih.startsWith(buAy));
  const buAyCiro    = buAySeferler.reduce((a,s)=>a+(s.ucret||0),0);
  const ortUcret    = totalSefer>0 ? totalCiro/totalSefer : 0;
  const ortKm       = totalSefer>0 ? totalKm/totalSefer : 0;

  const kpiCards = [
    { val: totalSefer.toString(),                                          lbl: 'Toplam Sefer',    color: C.purple },
    { val: totalKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',lbl: 'Toplam Mesafe',   color: C.blue   },
    { val: 'TL '+totalCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}), lbl: 'Toplam Ciro',  color: C.green  },
    { val: 'TL '+buAyCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}),  lbl: 'Bu Ay Ciro',   color: C.orange },
    { val: 'TL '+ortUcret.toLocaleString('tr-TR',{maximumFractionDigits:0}),  lbl: 'Sefer Basi Ucret', color: C.yellow},
    { val: ortKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',  lbl: 'Ort. Mesafe',    color: C.text2  },
  ];
  y = _pdfKpiRow(doc, ML, CW, y, kpiCards, C, setFill, setTxt, rRect);

  // ── ARAÇ BAZLI ÖZET ──
  if (y + 14 > PH-30) { newPage(); y=20; }
  setTxt(C.purple); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Sefer Ozeti'), ML, y); y += 7;

  const byArac = {};
  seferData.forEach(s => {
    const key = s.plaka || s.aracId || 'Bilinmiyor';
    if (!byArac[key]) byArac[key] = { plaka:key, sefer:0, km:0, ciro:0 };
    byArac[key].sefer++;
    byArac[key].km   += s.km||0;
    byArac[key].ciro += s.ucret||0;
  });
  const aracRows = Object.values(byArac).sort((a,b)=>b.ciro-a.ciro);
  const maxCiro  = aracRows[0]?.ciro||1;

  const aColW = [28,22,30,30,CW-110];
  const aColH = ['Plaka','Sefer','Mesafe (km)','Ciro (TL)','Bar'];
  setFill(C.surface2); rect(ML,y,CW,7);
  setFill(C.purple); rect(ML,y,CW,0.7); rect(ML,y+6.3,CW,0.7);
  setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
  let hx=ML+2; aColH.forEach((h,i)=>{ doc.text(tr(h).toUpperCase(),hx,y+5); hx+=aColW[i]; });
  y += 8;

  aracRows.forEach((r,ri)=>{
    if (y+7 > PH-20) { newPage(); y=20; }
    setFill(ri%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(7.5); let rx=ML+2;
    setTxt(C.purple); doc.setFont('helvetica','bold');
    doc.text(tr(r.plaka), rx, y+5); rx+=aColW[0];
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(r.sefer.toString(), rx, y+5); rx+=aColW[1];
    setTxt(C.blue);
    doc.text(r.km.toLocaleString('tr-TR',{maximumFractionDigits:0}), rx, y+5); rx+=aColW[2];
    setTxt(C.green);
    doc.text(r.ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}), rx, y+5); rx+=aColW[3];
    // Bar
    const barW = aColW[4]-4;
    const pct  = Math.max(2, Math.round((r.ciro/maxCiro)*barW));
    setFill(C.surface2); rect(rx,y+2,barW,3);
    setFill(C.purple);   rect(rx,y+2,pct,3);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── EN ÇOK KULLANILAN ROTALAR ──
  if (y + 14 > PH-30) { newPage(); y=20; }
  setTxt(C.blue); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('En Cok Kullanilan Rotalar'), ML, y); y+=7;

  const byRota = {};
  seferData.forEach(s=>{
    const key = (s.kalkis||'?') + ' → ' + (s.varis||'?');
    if (!byRota[key]) byRota[key]={rota:key,count:0,ciro:0,km:0};
    byRota[key].count++;
    byRota[key].ciro += s.ucret||0;
    byRota[key].km   += s.km||0;
  });
  const rotaRows = Object.values(byRota).sort((a,b)=>b.count-a.count).slice(0,10);
  const maxRota  = rotaRows[0]?.count||1;

  rotaRows.forEach((r,ri)=>{
    if (y+7 > PH-20) { newPage(); y=20; }
    setFill(ri%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(7); let rx=ML+2;
    setTxt(C.text); doc.setFont('helvetica','bold');
    doc.text(tr(r.rota.slice(0,50)), rx, y+5); rx+=110;
    setTxt(C.purple);
    doc.text(r.count+' sefer', rx, y+5); rx+=22;
    setTxt(C.green);
    doc.text('TL '+r.ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}), rx, y+5); rx+=28;
    const barW2 = CW-162;
    const pct2  = Math.max(2, Math.round((r.count/maxRota)*barW2));
    setFill(C.surface2); rect(rx,y+2,barW2,3);
    setFill(C.blue);     rect(rx,y+2,pct2,3);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── AYLIK SEFER & CİRO TRENDİ ──
  if (y + 14 > PH-30) { newPage(); y=20; }
  setTxt(C.green); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Sefer ve Ciro Trendi (Son 12 Ay)'), ML, y); y+=7;

  const now12 = new Date();
  const months12 = [];
  for (let i=11;i>=0;i--) {
    const d = new Date(now12.getFullYear(), now12.getMonth()-i, 1);
    months12.push({ key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), d });
  }
  const mSef={}, mCiro={};
  months12.forEach(m=>{ mSef[m.key]=0; mCiro[m.key]=0; });
  seferData.forEach(s=>{ if(s.tarih&&mSef[s.tarih.slice(0,7)]!==undefined){ mSef[s.tarih.slice(0,7)]++; mCiro[s.tarih.slice(0,7)]+=(s.ucret||0); } });
  const maxSef  = Math.max(1,...Object.values(mSef));
  const maxMCiro= Math.max(1,...Object.values(mCiro));

  const mColW = (CW-40)/12;
  const tblH  = 36;
  months12.forEach((m,i)=>{
    const cx = ML+40+i*mColW;
    const label = m.d.toLocaleDateString('tr-TR',{month:'short'}).slice(0,3)+' '+String(m.d.getFullYear()).slice(2);
    setTxt(C.muted); doc.setFontSize(5.5); doc.setFont('helvetica','normal');
    doc.text(tr(label), cx+mColW/2, y+tblH+4, {align:'center'});
    // Sefer çubuğu (mavi)
    const barH1 = Math.max(1, (mSef[m.key]/maxSef)*tblH*0.45);
    setFill(C.purple); rect(cx+1, y+tblH-barH1, mColW*0.45, barH1);
    // Ciro çubuğu (yeşil)
    const barH2 = Math.max(1, (mCiro[m.key]/maxMCiro)*tblH*0.45);
    setFill(C.green);  rect(cx+mColW*0.5, y+tblH-barH2, mColW*0.45, barH2);
  });
  // Eksen
  setFill(C.border); rect(ML+40,y,CW-40,0.5); rect(ML+40,y+tblH,CW-40,0.5);
  // Sol etiketler
  setTxt(C.purple); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
  doc.text(tr('Sefer Sayisi'), ML, y+tblH/3);
  setTxt(C.green);
  doc.text(tr('Ciro (TL)'), ML, y+tblH*0.66);
  y += tblH+12;

  // ── TÜM SEFER KAYITLARI ──
  newPage(); y=20;
  setTxt(C.purple); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Tum Sefer Kayitlari'), ML, y); y+=7;

  const cols = [
    {h:'Tarih',w:22},{h:'Arac',w:22},{h:'Sofor',w:28},{h:'Kalkis',w:28},
    {h:'Varis',w:28},{h:'Km',w:18},{h:'Yuk/Musteri',w:30},{h:'Ucret (TL)',w:CW-176}
  ];
  const drawSefHeader = (yy) => {
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.purple); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; cols.forEach(c=>{ doc.text(tr(c.h).toUpperCase(),hxx,yy+5); hxx+=c.w; });
    return yy+8;
  };
  y = drawSefHeader(y);

  const sorted = [...seferData].sort((a,b)=>(b.tarih||'').localeCompare(a.tarih||''));
  sorted.forEach((s,si)=>{
    if (y+7 > PH-18) { newPage(); y=15; y=drawSefHeader(y); }
    setFill(si%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx=ML+2;
    const fmtD = d => d ? d.split('-').reverse().join('.') : '—';
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(fmtD(s.tarih), rx, y+5); rx+=cols[0].w;
    setTxt(C.purple); doc.setFont('helvetica','bold');
    doc.text(tr(s.plaka||'—'), rx, y+5); rx+=cols[1].w;
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(tr((s.sofor||'—').slice(0,14)), rx, y+5); rx+=cols[2].w;
    doc.text(tr((s.kalkis||'—').slice(0,14)), rx, y+5); rx+=cols[3].w;
    doc.text(tr((s.varis||'—').slice(0,14)), rx, y+5); rx+=cols[4].w;
    setTxt(C.blue);
    doc.text(s.km?s.km.toLocaleString('tr-TR',{maximumFractionDigits:0}):'—', rx, y+5); rx+=cols[5].w;
    setTxt(C.text2);
    doc.text(tr((s.yuk||'—').slice(0,16)), rx, y+5); rx+=cols[6].w;
    setTxt(s.ucret>0?C.green:C.muted); doc.setFont('helvetica','bold');
    doc.text(s.ucret?s.ucret.toLocaleString('tr-TR',{maximumFractionDigits:0}):'—', rx, y+5);
    y+=7;
  });

  // Toplam satırı
  setFill(C.surface2); rect(ML,y,CW,8);
  setFill(C.purple); rect(ML,y,CW,0.5);
  setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(tr('TOPLAM'), ML+2, y+6);
  doc.text(totalKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km', ML+122, y+6);
  setTxt(C.green);
  doc.text('TL '+totalCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+176, y+6);

  addFooter();
  _pdfSave(doc, 'sefer_raporu_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('Sefer Raporu PDF indirildi!', 'success');
}

/* ================================================================
   MASRAF PDF
   ================================================================ */
async function downloadMasrafPDF() {
  if (masrafData.length === 0) { showToast('Indirilecek masraf kaydi yok.', 'error'); return; }
  showToast('Masraf raporu hazirlaniyor...', 'info');

  const { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage } = _pdfCommonSetup(
    'Masraf Raporu', 'Fleetly  |  Gider Analizi  |  Muhasebe & Lojistik', [245,158,11]
  );

  C.accent = [245,158,11];
  let y = 54;

  // ── KPI ──
  const totalMasraf = masrafData.reduce((a,m)=>a+(m.tutar||0),0);
  const buAym       = new Date().toISOString().slice(0,7);
  const buAyMasraf  = masrafData.filter(m=>m.tarih&&m.tarih.startsWith(buAym)).reduce((a,m)=>a+(m.tutar||0),0);
  const ortMasraf   = masrafData.length>0 ? totalMasraf/masrafData.length : 0;
  const byKatObj    = {};
  masrafData.forEach(m=>{ byKatObj[m.kategori]=(byKatObj[m.kategori]||0)+(m.tutar||0); });
  const topKat      = Object.entries(byKatObj).sort((a,b)=>b[1]-a[1])[0];

  const kpiCards = [
    { val: masrafData.length.toString(),                                            lbl:'Toplam Kayit',    color:C.blue   },
    { val:'TL '+totalMasraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),      lbl:'Toplam Masraf',   color:C.yellow },
    { val:'TL '+buAyMasraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),       lbl:'Bu Ay Masraf',    color:C.orange },
    { val:'TL '+ortMasraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),        lbl:'Kayit Basi Ort.', color:C.text2  },
    { val: topKat ? tr(topKat[0]).slice(0,12) : '—',                               lbl:'En Buyuk Kalem',  color:C.red    },
    { val: Object.keys(byKatObj).length.toString(),                                 lbl:'Kategori Sayisi', color:C.purple },
  ];
  y = _pdfKpiRow(doc, ML, CW, y, kpiCards, C, setFill, setTxt, rRect);

  // ── KATEGORİ BAZLI ÖZET ──
  if (y+14>PH-30) { newPage(); y=20; }
  setTxt(C.yellow); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Kategori Bazli Masraf Dagilimi'), ML, y); y+=7;

  const katRows = Object.entries(byKatObj).sort((a,b)=>b[1]-a[1]);
  const maxKat  = katRows[0]?.[1]||1;
  katRows.forEach(([ kat, tutar ],ki)=>{
    if (y+7>PH-20) { newPage(); y=20; }
    const pct   = (tutar/totalMasraf*100).toFixed(1);
    const barW  = CW-100;
    const barFW = Math.max(2, Math.round((tutar/maxKat)*barW));
    setFill(ki%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text(tr(kat), ML+2, y+5);
    setTxt(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(pct+'%', ML+82, y+5);
    setFill(C.surface2); rect(ML+100,y+2,barW,3);
    setFill(C.yellow);   rect(ML+100,y+2,barFW,3);
    setTxt(C.red); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('TL '+tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+100+barW+3, y+5);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── ARAÇ BAZLI MASRAF ──
  if (y+14>PH-30) { newPage(); y=20; }
  setTxt(C.orange); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Masraf Ozeti'), ML, y); y+=7;

  const byAracM = {};
  masrafData.forEach(m=>{
    const k = m.plaka||'Genel';
    if(!byAracM[k]) byAracM[k]={plaka:k,tutar:0,count:0};
    byAracM[k].tutar+=m.tutar||0; byAracM[k].count++;
  });
  const aracRowsM = Object.values(byAracM).sort((a,b)=>b.tutar-a.tutar);
  const maxAracM  = aracRowsM[0]?.tutar||1;
  aracRowsM.forEach((r,ri)=>{
    if (y+7>PH-20) { newPage(); y=20; }
    const barFill2 = Math.max(2,Math.round((r.tutar/maxAracM)*(CW-100)));
    setFill(ri%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    setTxt(C.orange); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text(tr(r.plaka), ML+2, y+5);
    setTxt(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(r.count+' kayit', ML+62, y+5);
    setFill(C.surface2); rect(ML+100,y+2,CW-100,3);
    setFill(C.orange);   rect(ML+100,y+2,barFill2,3);
    setTxt(C.red); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('TL '+r.tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+100+(CW-100)+3, y+5);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── AYLIK MASRAF TRENDİ (grafik çubuk) ──
  if (y+14>PH-30) { newPage(); y=20; }
  setTxt(C.red); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Masraf Trendi (Son 12 Ay)'), ML, y); y+=7;

  const now12m = new Date(); const months12m = [];
  for(let i=11;i>=0;i--){
    const d=new Date(now12m.getFullYear(),now12m.getMonth()-i,1);
    months12m.push({key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),d});
  }
  const mTutar={};
  months12m.forEach(m=>{mTutar[m.key]=0;});
  masrafData.forEach(m=>{if(m.tarih&&mTutar[m.tarih.slice(0,7)]!==undefined)mTutar[m.tarih.slice(0,7)]+=(m.tutar||0);});
  const maxTutar=Math.max(1,...Object.values(mTutar));
  const mColW2=(CW-40)/12; const tblH2=32;
  months12m.forEach((m,i)=>{
    const cx=ML+40+i*mColW2;
    const label=m.d.toLocaleDateString('tr-TR',{month:'short'}).slice(0,3)+'\''+String(m.d.getFullYear()).slice(2);
    setTxt(C.muted); doc.setFontSize(5.5); doc.setFont('helvetica','normal');
    doc.text(tr(label),cx+mColW2/2,y+tblH2+4,{align:'center'});
    const bH=Math.max(1,(mTutar[m.key]/maxTutar)*tblH2);
    setFill(C.yellow); rect(cx+1,y+tblH2-bH,mColW2-2,bH);
    if(mTutar[m.key]>0){
      setTxt(C.text2); doc.setFontSize(4.5);
      doc.text('TL '+Math.round(mTutar[m.key]/1000)+'K',cx+mColW2/2,y+tblH2-bH-1.5,{align:'center'});
    }
  });
  setFill(C.border); rect(ML+40,y+tblH2,CW-40,0.5);
  y+=tblH2+12;

  // ── TÜM MASRAF KAYITLARI ──
  newPage(); y=20;
  setTxt(C.yellow); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Tum Masraf Kayitlari'), ML, y); y+=7;

  const mCols=[
    {h:'Tarih',w:22},{h:'Arac',w:22},{h:'Kategori',w:36},
    {h:'Aciklama',w:46},{h:'Makbuz No',w:28},{h:'Tutar (TL)',w:CW-154}
  ];
  const drawMHeader=(yy)=>{
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.yellow); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; mCols.forEach(c=>{doc.text(tr(c.h).toUpperCase(),hxx,yy+5);hxx+=c.w;});
    return yy+8;
  };
  y=drawMHeader(y);
  const sortedM=[...masrafData].sort((a,b)=>(b.tarih||'').localeCompare(a.tarih||''));
  sortedM.forEach((m,mi)=>{
    if(y+7>PH-18){newPage();y=15;y=drawMHeader(y);}
    setFill(mi%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx=ML+2;
    const fmtD=d=>d?d.split('-').reverse().join('.'):'—';
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(fmtD(m.tarih),rx,y+5); rx+=mCols[0].w;
    setTxt(C.orange); doc.setFont('helvetica','bold');
    doc.text(tr(m.plaka||'Genel'),rx,y+5); rx+=mCols[1].w;
    setTxt(C.yellow); doc.setFont('helvetica','normal');
    doc.text(tr((m.kategori||'—').slice(0,18)),rx,y+5); rx+=mCols[2].w;
    setTxt(C.text2);
    doc.text(tr((m.aciklama||'—').slice(0,22)),rx,y+5); rx+=mCols[3].w;
    setTxt(C.muted);
    doc.text(tr((m.makbuz||'—').slice(0,14)),rx,y+5); rx+=mCols[4].w;
    setTxt(C.red); doc.setFont('helvetica','bold');
    doc.text(m.tutar.toLocaleString('tr-TR',{maximumFractionDigits:2}),rx,y+5);
    y+=7;
  });
  // Toplam
  setFill(C.surface2); rect(ML,y,CW,8);
  setFill(C.yellow); rect(ML,y,CW,0.5);
  setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(tr('TOPLAM MASRAF'),ML+2,y+6);
  setTxt(C.red);
  doc.text('TL '+totalMasraf.toLocaleString('tr-TR',{maximumFractionDigits:2}),ML+154,y+6);

  addFooter();
  _pdfSave(doc, 'masraf_raporu_'+new Date().toISOString().slice(0,10)+'.pdf');
  showToast('Masraf Raporu PDF indirildi!','success');
}

/* ================================================================
   KAPSAMLI YÖNETİM RAPORU PDF (Raporlar modalındaki)
   ================================================================ */
async function downloadRaporPDF() {
  const donem   = document.getElementById('rapor-donem')?.value||'all';
  const flt     = e => !donem||donem==='all'||!e.tarih||e.tarih.startsWith(donem);

  const seferler  = seferData.filter(flt);
  const masraflar = masrafData.filter(flt);
  const yakitlar  = Object.values(fuelData).flat().filter(flt);
  const bakimlar  = Object.values(maintData).flat().filter(flt);

  if (seferler.length+masraflar.length+yakitlar.length+bakimlar.length===0) {
    showToast('Bu donem icin veri yok.','error'); return;
  }
  showToast('Yonetim raporu hazirlaniyor...','info');

  // Dönem etiketi
  let donemLabel='Tum Zamanlar';
  if(donem!=='all'){
    const [y,mo]=donem.split('-');
    donemLabel=['Ocak','Subat','Mart','Nisan','Mayis','Haziran','Temmuz','Agustos','Eylul','Ekim','Kasim','Aralik'][parseInt(mo)-1]+' '+y;
  }

  const { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage } = _pdfCommonSetup(
    'Yonetim Raporu', 'Fleetly  |  Kapsamlı Gelir-Gider Analizi  |  '+donemLabel, [34,197,94]
  );

  C.accent=[34,197,94];
  let y=54;

  // ── ÜSTTE DÖNEM ETIKETI ──
  setFill(C.surface2); rRect(ML,y,CW,10,3);
  setTxt(C.green); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text(tr('Donem: ')+tr(donemLabel), ML+6, y+7);
  y+=16;

  // ── ANA KPI KARTLARI ──
  const toplamCiro   = seferler.reduce((a,s)=>a+(s.ucret||0),0);
  const toplamYakit  = yakitlar.reduce((a,e)=>a+(e.fiyat?e.fiyat*e.litre:0),0);
  const toplamBakim  = bakimlar.reduce((a,e)=>a+(e.maliyet||0),0);
  const toplamMasraf = masraflar.reduce((a,m)=>a+(m.tutar||0),0);
  const toplamGider  = toplamYakit+toplamBakim+toplamMasraf;
  const netKar       = toplamCiro-toplamGider;
  const toplamKm     = seferler.reduce((a,s)=>a+(s.km||0),0);
  const kmMaliyet    = toplamKm>0 ? toplamGider/toplamKm : 0;
  const karMarji     = toplamCiro>0 ? (netKar/toplamCiro*100) : 0;

  const kpiCards=[
    {val:'TL '+toplamCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}),  lbl:'Toplam Ciro',    color:C.green },
    {val:'TL '+toplamGider.toLocaleString('tr-TR',{maximumFractionDigits:0}), lbl:'Toplam Gider',   color:C.red   },
    {val:(netKar>=0?'+':'')+'TL '+Math.abs(netKar).toLocaleString('tr-TR',{maximumFractionDigits:0}), lbl:netKar>=0?'Net Kar':'Net Zarar', color:netKar>=0?C.green:C.red},
    {val:'%'+karMarji.toFixed(1),                                             lbl:'Kar Marji',      color:karMarji>=20?C.green:karMarji>=10?C.yellow:C.red},
    {val:seferler.length.toString(),                                          lbl:'Sefer Sayisi',   color:C.purple},
    {val:toplamKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',   lbl:'Toplam Mesafe',  color:C.blue  },
  ];
  y=_pdfKpiRow(doc,ML,CW,y,kpiCards,C,setFill,setTxt,rRect);

  // ── GELİR/GİDER DAĞILIMI YAN YANA ──
  if(y+14>PH-30){newPage();y=20;}
  setTxt(C.text2); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Gelir-Gider Analizi'), ML, y); y+=7;

  // Sol: Gider dağılımı
  const halfW=(CW-6)/2;
  const gItems=[
    {lbl:tr('Yakit'),  val:toplamYakit,  color:C.orange},
    {lbl:tr('Bakim'),  val:toplamBakim,  color:C.blue  },
    {lbl:tr('Masraf'), val:toplamMasraf, color:C.yellow},
  ];
  setFill(C.surface); rRect(ML,y,halfW,54,3);
  setFill(C.orange); rRect(ML,y,3,54,1);
  setTxt(C.orange); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr('Gider Dagilimi'), ML+6, y+8);
  gItems.forEach((g,gi)=>{
    const pct=toplamGider>0?(g.val/toplamGider*100):0;
    const bH=Math.max(1,(g.val/(Math.max(...gItems.map(x=>x.val))||1))*(halfW-50));
    setFill(C.surface2); rect(ML+50,y+14+gi*13,halfW-54,5);
    setFill(g.color);    rect(ML+50,y+14+gi*13,bH,5);
    setTxt(g.color); doc.setFontSize(7);
    doc.text(g.lbl,ML+6,y+18+gi*13);
    setTxt(C.text2); doc.setFontSize(6.5);
    doc.text(pct.toFixed(1)+'%  TL '+g.val.toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+50+halfW-54+2,y+18+gi*13);
  });

  // Sağ: Kar/Zarar
  const rx2=ML+halfW+6;
  setFill(C.surface); rRect(rx2,y,halfW,54,3);
  setFill(netKar>=0?C.green:C.red); rRect(rx2,y,3,54,1);
  setTxt(C.text2); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr('Kar / Zarar Ozeti'), rx2+6, y+8);
  [
    {lbl:tr('Toplam Ciro'),  val:'TL '+toplamCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}), color:C.green},
    {lbl:tr('Toplam Gider'), val:'TL '+toplamGider.toLocaleString('tr-TR',{maximumFractionDigits:0}),color:C.red  },
    {lbl:tr('Net Sonuc'),    val:(netKar>=0?'+':'')+'TL '+Math.abs(netKar).toLocaleString('tr-TR',{maximumFractionDigits:0}), color:netKar>=0?C.green:C.red},
    {lbl:tr('Km Maliyeti'),  val:'TL '+kmMaliyet.toFixed(2)+'/km', color:C.yellow},
  ].forEach((row,ri)=>{
    setTxt(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(row.lbl, rx2+6, y+16+ri*10);
    setTxt(row.color); doc.setFont('helvetica','bold');
    doc.text(row.val, rx2+halfW-3, y+16+ri*10, {align:'right'});
  });
  y+=60;

  // ── ARAÇ BAZLI KAR/ZARAR TABLOSU ──
  if(y+14>PH-30){newPage();y=20;}
  setTxt(C.green); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Karlılık Analizi'), ML, y); y+=7;

  const byAracR={};
  vehicles.forEach(v=>{byAracR[v.id]={plaka:v.plaka,ciro:0,yakit:0,bakim:0,masraf:0,km:0,sefer:0};});
  seferler.forEach(s=>{
    if(!byAracR[s.aracId]) byAracR[s.aracId]={plaka:s.plaka||s.aracId||'?',ciro:0,yakit:0,bakim:0,masraf:0,km:0,sefer:0};
    byAracR[s.aracId].ciro+=s.ucret||0; byAracR[s.aracId].km+=s.km||0; byAracR[s.aracId].sefer++;
  });
  Object.entries(fuelData).forEach(([vid,entries])=>{
    if(!byAracR[vid]) return;
    entries.filter(flt).forEach(e=>{byAracR[vid].yakit+=(e.fiyat?e.fiyat*e.litre:0);});
  });
  Object.entries(maintData).forEach(([vid,entries])=>{
    if(!byAracR[vid]) return;
    entries.filter(flt).forEach(e=>{byAracR[vid].bakim+=(e.maliyet||0);});
  });
  masraflar.forEach(m=>{if(byAracR[m.aracId]) byAracR[m.aracId].masraf+=m.tutar||0;});

  const aracRRows=Object.values(byAracR)
    .map(a=>({...a,gider:a.yakit+a.bakim+a.masraf,kar:a.ciro-(a.yakit+a.bakim+a.masraf)}))
    .filter(a=>a.ciro>0||a.gider>0).sort((a,b)=>b.kar-a.kar);

  const rCols=[
    {h:'Plaka',w:24},{h:'Sefer',w:14},{h:'Mesafe',w:22},{h:'Ciro (TL)',w:28},
    {h:'Yakit',w:26},{h:'Bakim',w:26},{h:'Masraf',w:26},{h:'Net Kar (TL)',w:CW-166}
  ];
  const drawRHeader=(yy)=>{
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.green); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; rCols.forEach(c=>{doc.text(tr(c.h).toUpperCase(),hxx,yy+5);hxx+=c.w;});
    return yy+8;
  };
  y=drawRHeader(y);
  aracRRows.forEach((a,ai)=>{
    if(y+7>PH-18){newPage();y=15;y=drawRHeader(y);}
    setFill(ai%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx3=ML+2;
    setTxt(C.orange); doc.setFont('helvetica','bold');
    doc.text(tr(a.plaka),rx3,y+5); rx3+=rCols[0].w;
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(a.sefer.toString(),rx3,y+5); rx3+=rCols[1].w;
    setTxt(C.blue);
    doc.text(a.km.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',rx3,y+5); rx3+=rCols[2].w;
    setTxt(C.green);
    doc.text(a.ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[3].w;
    setTxt(C.orange);
    doc.text(a.yakit.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[4].w;
    setTxt(C.blue);
    doc.text(a.bakim.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[5].w;
    setTxt(C.yellow);
    doc.text(a.masraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[6].w;
    setTxt(a.kar>=0?C.green:C.red); doc.setFont('helvetica','bold');
    doc.text((a.kar>=0?'+':'')+a.kar.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5);
    y+=7;
  });
  setFill(C.surface2); rect(ML,y,CW,8);
  setFill(C.green); rect(ML,y,CW,0.5);
  setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(tr('GENEL TOPLAM'),ML+2,y+6);
  setTxt(C.green); doc.text('TL '+toplamCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+60,y+6);
  setTxt(C.red);   doc.text('TL '+toplamGider.toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+112,y+6);
  setTxt(netKar>=0?C.green:C.red);
  doc.text((netKar>=0?'+':'')+'TL '+Math.abs(netKar).toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+166,y+6);
  y+=14;

  // ── AYLIK ÖZET TABLO ──
  if(y+14>PH-30){newPage();y=20;}
  setTxt(C.blue); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Ozet (Son 6 Ay)'), ML, y); y+=7;

  const allMonths=new Set();
  [...seferData,...masrafData,...Object.values(fuelData).flat(),...Object.values(maintData).flat()]
    .forEach(e=>{if(e.tarih) allMonths.add(e.tarih.slice(0,7));});
  const sorted6=[...allMonths].sort().reverse().slice(0,6).reverse();

  const mCols2=[{h:'Donem',w:26},{h:'Sefer',w:16},{h:'Ciro',w:28},{h:'Yakit',w:28},
    {h:'Bakim',w:28},{h:'Masraf',w:28},{h:'Net',w:CW-154}];
  const drawM2=(yy)=>{
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.blue); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; mCols2.forEach(c=>{doc.text(tr(c.h).toUpperCase(),hxx,yy+5);hxx+=c.w;});
    return yy+8;
  };
  y=drawM2(y);
  const moNames=['Oca','Sub','Mar','Nis','May','Haz','Tem','Agu','Eyl','Eki','Kas','Ara'];
  sorted6.forEach((m,mi)=>{
    if(y+7>PH-18){newPage();y=15;y=drawM2(y);}
    const [my,mmo]=m.split('-');
    const label=moNames[parseInt(mmo)-1]+' '+my;
    const sf=seferData.filter(s=>s.tarih&&s.tarih.startsWith(m));
    const mf=masrafData.filter(x=>x.tarih&&x.tarih.startsWith(m));
    const yf=Object.values(fuelData).flat().filter(x=>x.tarih&&x.tarih.startsWith(m));
    const bf=Object.values(maintData).flat().filter(x=>x.tarih&&x.tarih.startsWith(m));
    const ciro   =sf.reduce((a,s)=>a+(s.ucret||0),0);
    const yakit  =yf.reduce((a,e)=>a+(e.fiyat?e.fiyat*e.litre:0),0);
    const bakim  =bf.reduce((a,e)=>a+(e.maliyet||0),0);
    const masraf2=mf.reduce((a,x)=>a+(x.tutar||0),0);
    const net2   =ciro-(yakit+bakim+masraf2);
    setFill(mi%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx4=ML+2;
    setTxt(C.text); doc.setFont('helvetica','bold');
    doc.text(tr(label),rx4,y+5); rx4+=mCols2[0].w;
    setTxt(C.purple); doc.setFont('helvetica','normal');
    doc.text(sf.length.toString(),rx4,y+5); rx4+=mCols2[1].w;
    setTxt(C.green);
    doc.text('TL '+ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[2].w;
    setTxt(C.orange);
    doc.text('TL '+yakit.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[3].w;
    setTxt(C.blue);
    doc.text('TL '+bakim.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[4].w;
    setTxt(C.yellow);
    doc.text('TL '+masraf2.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[5].w;
    setTxt(net2>=0?C.green:C.red); doc.setFont('helvetica','bold');
    doc.text((net2>=0?'+':'')+'TL '+Math.abs(net2).toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5);
    y+=7;
  });

  addFooter();
  _pdfSave(doc, 'yonetim_raporu_'+new Date().toISOString().slice(0,10)+'.pdf');
  showToast('Yonetim Raporu PDF indirildi!','success');
}
