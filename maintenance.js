/* ================================================================
   YAKIT RAPORU PDF İNDİRME
   ================================================================ */

async function downloadSingleVehiclePDF() {
  const vehicleId = activeFuelVehicleId;
  const v = vehicles.find(x => x.id === vehicleId);
  if (!v) { showToast('Araç bulunamadı.', 'error'); return; }
  const ve = (fuelData[vehicleId] || []).slice().sort((a,b) => new Date(a.tarih)-new Date(b.tarih) || a.km-b.km);
  if (ve.length === 0) { showToast('Bu araca ait yakıt kaydı yok.', 'error'); return; }
  showToast('PDF hazırlanıyor…', 'info');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, ML = 14, MR = 14, CW = PW - ML - MR;
  const C = {
    bg:[8,12,16], surface:[17,24,32], surface2:[24,32,44], border:[37,47,62],
    accent:[249,115,22], text:[226,234,243], text2:[168,184,204],
    muted:[82,96,112], green:[34,197,94], yellow:[245,158,11],
    red:[239,68,68], blue:[56,189,248], white:[255,255,255],
  };
  function _tr(s) {
    if (!s) return '';
    return String(s)
      .replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C').replace(/ı/g,'i').replace(/İ/g,'I');
  }
  const _logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAFHUlEQVR4nO3dTW7UQBAF4JyCq3EQ7sARsuAC3IAtWbOBJZtssgCBhFCEkCCZmeD2zBgnmfFP13vdVdXVUolNZE/6ozztKrdzcUEaf1+9eIhYHiwH8ag9Md4jUBuKgG0kAreBCNwGImAbicBtIALYeQRuAxG4DUTgNhAB7DwCt4EIYOcRwM4jcBuIAHYeAew8Ath5BLDzCODM2N58fNjdfuv/rf1ZZoFrfwiLsdtu9vHnd/XPMotc+wNYix52t9vH/Z34eGkEMCjGIxv4iNvF5upS/DmejgAG4OZOZsrY/8BbOC4DuQlg1ESOszctshi4aOQAXorbLajGwExcJLJ7YNQEPsrejNVzABcGXoXbXY4l2RvAinF74G5BNQB3t0klcFHIAbwIWJa9uciIOXALjMPdim+NAlg1sDx7A1gr7rgsKcjeHGTUXLgDRk7aOHtRnaOSuE0Br8Z9VJaUXZ7Hsfn8vhiuO2BW9iLbgpufX/bRQR8/M3NOmgBejSssS57F/fB2j/v9uticuAGmZS+g5zsAd7CbXz+G7A1gAPDa4/SP4xCy9+7Nyz1ul8El58UFMHLBIi1Lnos+e9Pl+eZTANcFxmdvD3xYXJWeG/PAtOwFFDYG3C5ra2RvAD8D9pW95oGhuOCy5ICbsjctrgreGgXwKWBCWbIHrpi9poGhuMSyZJ+9Fb57TQNPjSxgVlnycGt0/+51ACOAs3BZZcmUvYXLki6AqdmLLEsevntrZq8r4JxjscqSNZoKLoDx2UssSxZuKrgGzj0eI3vTJblGU8E8MB6XVJas1FQI4GfA/sqSZoHhuMyypKLsbRdYuA30LLCy7DUBDMdlFTaOTQVF2aseeGpkA5PLkrXnzAVwNi5gG+hJXAVNBXPAnOwd3RoRypLpwbra82YeOBvh6tJ1U8EUMCV7x7dGyLKkkqaCC2DJMWlNhYqP45gEpuCysvfYVOiga89b28CAt9M9DW1NBRPAFFzA2+lOxdBUUNASbBu4obKkamAKLrMsaSB71QBPDREwcxO34pWzGWARLqssqbSpoBaYl73cbaC15808sPS41LKkkeytDlwke5G3RkZWzuqBpcdtsamgDpiGy3reKuF2iyutTYV2gAnbQC00FVQB03BZ20ANNBXaACYUNvqmgsHFVTVgGi6rLGmkqeAfmLANtH95meHsLQ7MwqVtAz2WJY1mb1HgqSE9Nq0safC+Vx0w4tjRVKgMXCx7Gy9LFgXe3X6dBYach9nQN569UOAEeiqo2cssSzrIXgjwOdg5YMh/KkZZ8pi9xhdXEOBc3PHlO/vcrLKk0aYCHHgOdw5YiswoSw67BJ1kLxV4DlcCTC9LGmwqQIER2StBZpQlrTcVigIvxc0BppUljTcVigFPDQQwoyw5ZK+j797iwOd+fj1wNBWowMjL81rkKEsWAJ5DZuHugYmP4zgoS54ETgMJ/BR57mcXnzPKknm4DOA1sfichG2gnpoKpoFphQ3H2SsCRiEvPhejLOmsqWAWmLYN9NBU0PjyMhXAUuTF5yC8nc5jU2ESuDTyYgjW2+kcNhUmcSXAa6BXH3Pc8wWVJYddgo4XVxTgU+DiY6TVc7r/ZfyhZodlyUlgBrI0+s5Rt8hCPY7juakwi6sRGB2a/p5RFWDvyBZePUjF9YzsvamwGNcrsveV8ypcb8D94irdHjn+7l0N7A25iZJk7qj9C0SQYANZb0BxA1lXUHADun7QYQO7EdQlo/bEWAuWwz+aKJThdQXEYAAAAABJRU5ErkJggg==';
  function sf(c) { doc.setFillColor(...c); }
  function st(c) { doc.setTextColor(...c); }
  function rc(x,y,w,h,s='F') { doc.rect(x,y,w,h,s); }
  function rr(x,y,w,h,r,s='F') { doc.roundedRect(x,y,w,h,r,r,s); }
  let pg = 1;
  function footer() {
    st(C.muted); doc.setFontSize(8);
    doc.text(_tr('Filo Takip | ') + _tr(v.plaka||''), ML, PH-8);
    doc.text(_tr('Sayfa ') + pg, PW-MR, PH-8, {align:'right'});
    doc.text(new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'}), PW/2, PH-8, {align:'center'});
    doc.setFontSize(6); doc.setTextColor(50,62,78);
    doc.text('created by cihanozcan app.', PW/2, PH-3, {align:'center'});
  }
  function newPage() { footer(); doc.addPage(); pg++; sf(C.bg); rc(0,0,PW,PH); }
  sf(C.bg); rc(0,0,PW,PH);
  sf(C.surface); rc(0,0,PW,42);
  sf(C.accent); rc(0,0,4,42);
  doc.addImage(_logo,'PNG',ML,7,28,28);
  st(C.white); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text(_tr(v.plaka||'—'), ML+32, 18);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); st(C.text2);
  doc.text(_tr([v.tip,v.sofor].filter(Boolean).join('  |  ')||'Filo Takip'), ML+32, 26);
  sf(C.surface2); rr(PW-ML-52,12,52,18,3);
  st(C.accent); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(_tr(new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'})), PW-ML-26, 22, {align:'center'});
  let y = 52;
  const totalL  = ve.reduce((s,e)=>s+(e.litre||0),0);
  const totalTL = ve.reduce((s,e)=>s+((e.litre||0)*(e.fiyat||0)),0);
  const kmRange = ve.length>=2 ? ve[ve.length-1].km-ve[0].km : 0;
  const usedL   = ve.slice(1).reduce((s,e)=>s+(e.litre||0),0);
  const avgC    = kmRange>0 ? (usedL/kmRange)*100 : null;
  const lastFiy = ve[ve.length-1]?.fiyat||0;
  const cards = [
    {l:_tr('Toplam Dolum'), v:ve.length+' kez', c:C.blue},
    {l:_tr('Toplam Litre'), v:totalL.toLocaleString('tr-TR',{maximumFractionDigits:1})+' L', c:C.accent},
    {l:_tr('Toplam Maliyet'), v:totalTL>0?totalTL.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'--', c:C.green},
    {l:_tr('Toplam Mesafe'), v:kmRange>0?kmRange.toLocaleString('tr-TR')+' km':'--', c:C.yellow},
    {l:_tr('Ort. L/100km'), v:avgC?avgC.toFixed(1)+' L/100km':'--', c:avgC?(avgC<25?C.green:avgC<35?C.yellow:C.red):C.muted},
    {l:_tr('Son Fiyat'), v:lastFiy>0?lastFiy.toFixed(2)+' TL':'--', c:[167,139,250]},
  ];
  const cW = (CW-10)/6;
  cards.forEach((card,i) => {
    const cx = ML+i*(cW+2);
    sf(C.surface); rr(cx,y,cW,22,2);
    sf(card.c); rr(cx,y,3,22,1);
    st(card.c); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text(card.v, cx+cW/2, y+10, {align:'center'});
    st(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
    doc.text(card.l.toUpperCase(), cx+cW/2, y+17, {align:'center'});
  });
  y += 30;
  const now2 = new Date();
  const months12 = [];
  for (let i=11;i>=0;i--) {
    const d = new Date(now2.getFullYear(), now2.getMonth()-i, 1);
    months12.push({key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), d});
  }
  const mL = {}; months12.forEach(m=>{mL[m.key]=0;});
  ve.forEach(e=>{const mk=e.tarih?e.tarih.slice(0,7):''; if(mk in mL) mL[mk]+=(e.litre||0);});
  const chartCanvas = document.createElement('canvas');
  chartCanvas.width=900; chartCanvas.height=260; document.body.appendChild(chartCanvas);
  const chartInst = new Chart(chartCanvas, {
    type:'bar',
    data:{labels:months12.map(m=>m.d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'})),
      datasets:[{label:'Litre (L)',data:months12.map(m=>+(mL[m.key]||0).toFixed(1)),
        backgroundColor:'rgba(249,115,22,0.75)',borderColor:'rgba(249,115,22,1)',borderWidth:1.5,borderRadius:4}]},
    options:{responsive:false,animation:false,
      plugins:{legend:{labels:{color:'#a8b8cc',font:{size:10}}}},
      scales:{x:{ticks:{color:'#a8b8cc',font:{size:9}},grid:{color:'rgba(255,255,255,0.06)'}},
        y:{ticks:{color:'var(--accent)',font:{size:9}},grid:{color:'rgba(255,255,255,0.06)'},
           title:{display:true,text:'Litre',color:'var(--accent)',font:{size:9}}}}}
  });
  await new Promise(res=>setTimeout(res,200));
  st(C.accent); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(_tr('Aylik Yakit Tuketimi (Son 12 Ay)'), ML, y); y+=4;
  const chartH = Math.min(60, PH-y-80);
  doc.addImage(chartCanvas.toDataURL('image/png'),'PNG',ML,y,CW,chartH);
  y += chartH+10; chartInst.destroy(); chartCanvas.remove();
  if (y > PH-50) { newPage(); y=18; }
  st(C.accent); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(_tr('Yakit Giris Gecmisi'), ML, y); y+=6;
  const dCols = [
    {l:_tr('Tarih'),w:24},{l:_tr('KM Sayaci'),w:28},{l:_tr('Litre'),w:20},
    {l:_tr('Birim Fiyat'),w:26},{l:_tr('Tutar (TL)'),w:26},
    {l:_tr('L/100km'),w:24},{l:_tr('KM Fark'),w:22},{l:_tr('Not'),w:CW-170},
  ];
  function drawHdr(yy) {
    sf(C.surface2); rc(ML,yy,CW,7);
    sf(C.accent); rc(ML,yy,CW,0.7); rc(ML,yy+6.3,CW,0.7);
    st(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
    let hx=ML+2; dCols.forEach(dc=>{doc.text(dc.l.toUpperCase(),hx,yy+4.8);hx+=dc.w;});
    return yy+8;
  }
  y = drawHdr(y);
  ve.forEach((e,ei) => {
    if (y > PH-18) { newPage(); y=15; y=drawHdr(y); }
    const prev = ei>0?ve[ei-1]:null;
    const kmFark = prev?e.km-prev.km:null;
    const cons = (kmFark&&kmFark>0)?(e.litre/kmFark)*100:null;
    const tutar = e.litre*(e.fiyat||0);
    sf(ei%2===0?C.surface:C.bg); rc(ML,y,CW,6.5);
    doc.setFontSize(7); doc.setFont('helvetica','normal');
    let rx=ML+2;
    st(C.text2); doc.text(e.tarih?e.tarih.split('-').reverse().join('.'):'—',rx,y+4.5); rx+=dCols[0].w;
    st(C.text);  doc.text(e.km?e.km.toLocaleString('tr-TR')+' km':'—',rx,y+4.5); rx+=dCols[1].w;
    st(C.accent);doc.text(e.litre?e.litre.toLocaleString('tr-TR',{minimumFractionDigits:1})+' L':'—',rx,y+4.5); rx+=dCols[2].w;
    st(C.text2); doc.text(e.fiyat?e.fiyat.toFixed(2)+' TL':'—',rx,y+4.5); rx+=dCols[3].w;
    st(C.green); doc.text(tutar>0?tutar.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—',rx,y+4.5); rx+=dCols[4].w;
    if (cons!==null) { st(cons<25?C.green:cons<35?C.yellow:C.red); doc.text(cons.toFixed(1)+' L',rx,y+4.5); }
    else { st(C.muted); doc.text(ei===0?'Ref.':'—',rx,y+4.5); }
    rx+=dCols[5].w;
    st(C.blue); doc.text(kmFark!==null?'+'+kmFark.toLocaleString('tr-TR')+' km':'—',rx,y+4.5); rx+=dCols[6].w;
    st(C.muted); doc.text(_tr((e.not||'').slice(0,22)),rx,y+4.5);
    y+=6.5;
  });
  sf(C.border); rc(ML,y,CW,0.5);
  footer();
  _pdfSave(doc, 'yakit_' + (v.plaka||'arac').replace(/\s+/g,'_') + '_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('PDF indirildi ✓', 'success');
}

async function downloadFuelPDF() {
  loadFuelData();

  // Veri kontrolü
  const allEntries = [];
  vehicles.forEach(v => {
    const entries = (fuelData[v.id] || []).map(e => ({ ...e, plaka: v.plaka, tip: v.tip || '' }));
    allEntries.push(...entries);
  });

  if (allEntries.length === 0) {
    showToast('İndirilecek yakıt verisi yok.', 'error');
    return;
  }

  showToast('PDF hazırlanıyor…', 'info');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210;

  function tr(s) {
    if (!s) return '';
    return String(s)
      .replace(/ş/g,'s').replace(/Ş/g,'S')
      .replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U')
      .replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C')
      .replace(/ı/g,'i').replace(/İ/g,'I');
  }
  const LOGO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAFHUlEQVR4nO3dTW7UQBAF4JyCq3EQ7sARsuAC3IAtWbOBJZtssgCBhFCEkCCZmeD2zBgnmfFP13vdVdXVUolNZE/6ozztKrdzcUEaf1+9eIhYHiwH8ag9Md4jUBuKgG0kAreBCNwGImAbicBtIALYeQRuAxG4DUTgNhAB7DwCt4EIYOcRwM4jcBuIAHYeAew8Ath5BLDzCODM2N58fNjdfuv/rf1ZZoFrfwiLsdtu9vHnd/XPMotc+wNYix52t9vH/Z34eGkEMCjGIxv4iNvF5upS/DmejgAG4OZOZsrY/8BbOC4DuQlg1ESOszctshi4aOQAXorbLajGwExcJLJ7YNQEPsrejNVzABcGXoXbXY4l2RvAinF74G5BNQB3t0klcFHIAbwIWJa9uciIOXALjMPdim+NAlg1sDx7A1gr7rgsKcjeHGTUXLgDRk7aOHtRnaOSuE0Br8Z9VJaUXZ7Hsfn8vhiuO2BW9iLbgpufX/bRQR8/M3NOmgBejSssS57F/fB2j/v9uticuAGmZS+g5zsAd7CbXz+G7A1gAPDa4/SP4xCy9+7Nyz1ul8El58UFMHLBIi1Lnos+e9Pl+eZTANcFxmdvD3xYXJWeG/PAtOwFFDYG3C5ra2RvAD8D9pW95oGhuOCy5ICbsjctrgreGgXwKWBCWbIHrpi9poGhuMSyZJ+9Fb57TQNPjSxgVlnycGt0/+51ACOAs3BZZcmUvYXLki6AqdmLLEsevntrZq8r4JxjscqSNZoKLoDx2UssSxZuKrgGzj0eI3vTJblGU8E8MB6XVJas1FQI4GfA/sqSZoHhuMyypKLsbRdYuA30LLCy7DUBDMdlFTaOTQVF2aseeGpkA5PLkrXnzAVwNi5gG+hJXAVNBXPAnOwd3RoRypLpwbra82YeOBvh6tJ1U8EUMCV7x7dGyLKkkqaCC2DJMWlNhYqP45gEpuCysvfYVOiga89b28CAt9M9DW1NBRPAFFzA2+lOxdBUUNASbBu4obKkamAKLrMsaSB71QBPDREwcxO34pWzGWARLqssqbSpoBaYl73cbaC15808sPS41LKkkeytDlwke5G3RkZWzuqBpcdtsamgDpiGy3reKuF2iyutTYV2gAnbQC00FVQB03BZ20ANNBXaACYUNvqmgsHFVTVgGi6rLGmkqeAfmLANtH95meHsLQ7MwqVtAz2WJY1mb1HgqSE9Nq0safC+Vx0w4tjRVKgMXCx7Gy9LFgXe3X6dBYach9nQN569UOAEeiqo2cssSzrIXgjwOdg5YMh/KkZZ8pi9xhdXEOBc3PHlO/vcrLKk0aYCHHgOdw5YiswoSw67BJ1kLxV4DlcCTC9LGmwqQIER2StBZpQlrTcVigIvxc0BppUljTcVigFPDQQwoyw5ZK+j797iwOd+fj1wNBWowMjL81rkKEsWAJ5DZuHugYmP4zgoS54ETgMJ/BR57mcXnzPKknm4DOA1sfichG2gnpoKpoFphQ3H2SsCRiEvPhejLOmsqWAWmLYN9NBU0PjyMhXAUuTF5yC8nc5jU2ESuDTyYgjW2+kcNhUmcSXAa6BXH3Pc8wWVJYddgo4XVxTgU+DiY6TVc7r/ZfyhZodlyUlgBrI0+s5Rt8hCPY7juakwi6sRGB2a/p5RFWDvyBZePUjF9YzsvamwGNcrsveV8ypcb8D94irdHjn+7l0N7A25iZJk7qj9C0SQYANZb0BxA1lXUHADun7QYQO7EdQlo/bEWAuWwz+aKJThdQXEYAAAAABJRU5ErkJggg==';

  const PH = 297; // A4 height mm
  const ML = 14;  // margin left
  const MR = 14;  // margin right
  const CW = PW - ML - MR; // content width

  // ── Renk paleti ──
  const C = {
    bg:       [8,  12, 16],
    surface:  [17, 24, 32],
    surface2: [24, 32, 44],
    border:   [37, 47, 62],
    accent:   [249,115,22],
    accentD:  [124,56,16],
    text:     [226,234,243],
    text2:    [168,184,204],
    muted:    [82, 96, 112],
    green:    [34, 197,94],
    greenD:   [20, 83, 45],
    yellow:   [245,158,11],
    yellowD:  [113,63,18],
    red:      [239,68, 68],
    redD:     [127,29,29],
    blue:     [56, 189,248],
    blueD:    [12, 74, 110],
    white:    [255,255,255],
  };

  function setFill(c)   { doc.setFillColor(...c); }
  function setStroke(c) { doc.setDrawColor(...c); }
  function setTxt(c)    { doc.setTextColor(...c); }
  function rect(x,y,w,h,style='F') { doc.rect(x,y,w,h,style); }
  function roundRect(x,y,w,h,r,style='F') { doc.roundedRect(x,y,w,h,r,r,style); }

  let pageNum = 1;
  function addPageNum() {
    setTxt(C.muted);
    doc.setFontSize(8);
    doc.text(tr('Filo Takip Sistemi - Yakit Raporu'), ML, PH - 8);
    doc.text(tr('Sayfa ') + pageNum, PW - MR, PH - 8, { align: 'right' });
    doc.text(new Date().toLocaleDateString('tr-TR', {day:'2-digit',month:'2-digit',year:'numeric'}), PW/2, PH - 8, {align:'center'});
  }

  function newPage() {
    addPageNum();
    doc.addPage();
    pageNum++;
    // Sayfa arka planı
    setFill(C.bg);
    rect(0, 0, PW, PH);
  }

  // ── SAYFA 1 ARKA PLAN ──
  setFill(C.bg);
  rect(0, 0, PW, PH);

  // ── HEADER BANDI ──
  setFill(C.surface);
  rect(0, 0, PW, 42);
  // Accent şerit
  setFill(C.accent);
  rect(0, 0, 4, 42);
  doc.addImage(LOGO_B64, 'PNG', ML, 7, 28, 28);
  // Başlık
  setTxt(C.white);
  doc.setFontSize(18);
  doc.setFont('helvetica','bold');
  doc.text(tr('Yakit Tuketim Raporu'), ML+32, 18);
  doc.setFontSize(9);
  doc.setFont('helvetica','normal');
  setTxt(C.text2);
  doc.text(tr('Filo Takip Sistemi  |  Tum Araclar'), ML+32, 26);
  // Tarih badge
  const dateStr = new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'});
  setFill(C.surface2);
  roundRect(PW-ML-52, 12, 52, 18, 3);
  setTxt(C.accent);
  doc.setFontSize(8);
  doc.setFont('helvetica','bold');
  doc.text(dateStr, PW-ML-26, 22, {align:'center'});

  let y = 52;

  // ── ÖZET İSTATİSTİK KARTLARI ──
  const allSorted = allEntries.slice().sort((a,b) => new Date(a.tarih)-new Date(b.tarih)||a.km-b.km);
  const totalL   = allSorted.reduce((s,e)=>s+(e.litre||0),0);
  const totalTL  = allSorted.reduce((s,e)=>s+((e.litre||0)*(e.fiyat||0)),0);
  const vCount   = vehicles.length;
  const dCount   = allSorted.length;

  // Ortalama tüketim (tüm araçlar için)
  let avgCons = null;
  const allByVehicle = {};
  vehicles.forEach(v => {
    const ve = (fuelData[v.id]||[]).slice().sort((a,b)=>a.km-b.km);
    if (ve.length >= 2) {
      const kmRange = ve[ve.length-1].km - ve[0].km;
      const usedL = ve.slice(1).reduce((s,e)=>s+(e.litre||0),0);
      if (kmRange > 0) allByVehicle[v.id] = (usedL/kmRange)*100;
    }
  });
  const consVals = Object.values(allByVehicle);
  if (consVals.length > 0) avgCons = consVals.reduce((a,b)=>a+b,0)/consVals.length;

  const cards = [
    { label:'Toplam Dolum', value: dCount+' adet',      color: C.blue,   icon:'D' },
    { label:'Toplam Litre', value: totalL.toLocaleString('tr-TR',{maximumFractionDigits:0})+' L', color: C.accent, icon:'L' },
    { label:'Toplam Maliyet', value: totalTL > 0 ? totalTL.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL' : '--', color: C.green, icon:'M' },
    { label:'Ort. Tuketim', value: avgCons ? avgCons.toFixed(1)+' L/100km' : '--', color: avgCons ? (avgCons<25?C.green:avgCons<35?C.yellow:C.red) : C.muted, icon:'T' },
  ];

  const cardW = (CW - 9) / 4;
  cards.forEach((c, i) => {
    const cx = ML + i*(cardW+3);
    setFill(C.surface);
    roundRect(cx, y, cardW, 26, 3);
    // Sol şerit
    setFill(c.color);
    roundRect(cx, y, 3, 26, 1);
    // İkon dairesi
    setFill(c.color.map(x=>Math.round(x*0.2)));
    roundRect(cx+5, y+5, 14, 16, 2);
    setTxt(c.color);
    doc.setFontSize(8);
    doc.setFont('helvetica','bold');
    doc.text(c.icon, cx+12, y+15, {align:'center'});
    // Değer
    setTxt(C.white);
    doc.setFontSize(10);
    doc.setFont('helvetica','bold');
    doc.text(c.value, cx+22, y+12);
    // Etiket
    setTxt(C.muted);
    doc.setFontSize(7.5);
    doc.setFont('helvetica','normal');
    doc.text(c.label, cx+22, y+20);
  });
  y += 34;

  // ── ARAÇ BAZLI ÖZET TABLO ──
  setTxt(C.accent);
  doc.setFontSize(10);
  doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Ozet'), ML, y);
  y += 6;

  // Tablo header
  const vCols = [
    { label:'Plaka', w:30 },
    { label:'Tip', w:25 },
    { label:'Dolum', w:20 },
    { label:'Toplam L', w:28 },
    { label:'Toplam TL', w:30 },
    { label:'Ort. L/100km', w:35 },
    { label:'Son Tarih', w:CW-168 },
  ];
  setFill(C.surface2);
  rect(ML, y, CW, 8);
  setFill(C.accent);
  rect(ML, y, CW, 1);

  setTxt(C.muted);
  doc.setFontSize(7);
  doc.setFont('helvetica','bold');
  let hx = ML + 2;
  vCols.forEach(col => {
    doc.text(col.label.toUpperCase(), hx, y+5.5);
    hx += col.w;
  });
  y += 9;

  vehicles.forEach((v, vi) => {
    if (y > PH - 30) { newPage(); y = 20; }
    const ve = (fuelData[v.id]||[]).slice().sort((a,b)=>new Date(a.tarih)-new Date(b.tarih));
    if (ve.length === 0) return;
    const vL   = ve.reduce((s,e)=>s+(e.litre||0),0);
    const vTL  = ve.reduce((s,e)=>s+((e.litre||0)*(e.fiyat||0)),0);
    const vc   = allByVehicle[v.id];
    const last = ve[ve.length-1];

    setFill(vi%2===0 ? C.surface : C.bg);
    rect(ML, y, CW, 7.5);

    setTxt(C.accent);
    doc.setFontSize(8);
    doc.setFont('helvetica','bold');
    let rx = ML+2;
    doc.text(tr(v.plaka||'—'), rx, y+5); rx += vCols[0].w;
    setTxt(C.text2);
    doc.setFont('helvetica','normal');
    doc.text(tr(v.tip||'—'), rx, y+5); rx += vCols[1].w;
    doc.text(ve.length.toString(), rx, y+5); rx += vCols[2].w;
    setTxt(C.accent);
    doc.text(vL.toLocaleString('tr-TR',{maximumFractionDigits:1})+' L', rx, y+5); rx += vCols[3].w;
    setTxt(C.green);
    doc.text(vTL>0 ? vTL.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', rx, y+5); rx += vCols[4].w;
    if (vc !== undefined) {
      setTxt(vc<25?C.green:vc<35?C.yellow:C.red);
      doc.text(vc.toFixed(1)+' L/100km', rx, y+5);
    } else {
      setTxt(C.muted);
      doc.text('—', rx, y+5);
    }
    rx += vCols[5].w;
    setTxt(C.text2);
    doc.text(last ? last.tarih.split('-').reverse().join('.') : '—', rx, y+5);
    y += 7.5;
  });

  // Alt border
  setFill(C.border);
  rect(ML, y, CW, 0.5);
  y += 10;

  // ── AYLIK LİTRE GRAFİĞİ (Canvas ile çiz) ──
  // Ay bazlı veri topla (son 12 ay)
  const now2 = new Date();
  const months12 = [];
  for (let i=11; i>=0; i--) {
    const d = new Date(now2.getFullYear(), now2.getMonth()-i, 1);
    months12.push({ key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), d });
  }
  const monthL = {};
  const monthTL = {};
  months12.forEach(m => { monthL[m.key]=0; monthTL[m.key]=0; });
  allSorted.forEach(e => {
    const mk = e.tarih ? e.tarih.slice(0,7) : '';
    if (mk in monthL) { monthL[mk]+=(e.litre||0); monthTL[mk]+=((e.litre||0)*(e.fiyat||0)); }
  });

  // Canvas grafiği çiz
  const chartCanvas = document.createElement('canvas');
  chartCanvas.width = 900; chartCanvas.height = 320;
  document.body.appendChild(chartCanvas);

  const labels = months12.map(m => {
    const d = m.d;
    return d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'});
  });
  const litreData  = months12.map(m => +(monthL[m.key]||0).toFixed(1));
  const tutarData  = months12.map(m => +(monthTL[m.key]||0).toFixed(0));

  // Chart.js ile canvas grafiği oluştur
  const chartInst = new Chart(chartCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Litre (L)',
          data: litreData,
          backgroundColor: 'rgba(249,115,22,0.75)',
          borderColor: 'rgba(249,115,22,1)',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: 'Maliyet (TL)',
          data: tutarData,
          type: 'line',
          borderColor: 'rgba(34,197,94,1)',
          backgroundColor: 'rgba(34,197,94,0.1)',
          borderWidth: 2,
          pointBackgroundColor: 'rgba(34,197,94,1)',
          pointRadius: 4,
          fill: true,
          tension: 0.35,
          yAxisID: 'y2',
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { labels: { color: '#a8b8cc', font: { size: 11 } } },
      },
      scales: {
        x: { ticks:{ color:'#a8b8cc', font:{size:9} }, grid:{ color:'rgba(255,255,255,0.06)' } },
        y: { ticks:{ color:'var(--accent)', font:{size:9} }, grid:{ color:'rgba(255,255,255,0.06)' }, title:{display:true,text:'Litre',color:'var(--accent)',font:{size:9}} },
        y2:{ position:'right', ticks:{ color:'#22c55e', font:{size:9} }, grid:{drawOnChartArea:false}, title:{display:true,text:'Maliyet (TL)',color:'#22c55e',font:{size:9}} }
      }
    }
  });

  // Grafik başlığı
  if (y + 75 > PH - 25) { newPage(); y = 20; }
  setTxt(C.accent);
  doc.setFontSize(10);
  doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Litre ve Maliyet Grafigi (Son 12 Ay)'), ML, y);
  y += 5;

  // Canvas'ı PNG'ye dönüştür, PDF'e ekle
  await new Promise(res => setTimeout(res, 200)); // Chart.js render bekle
  const chartImg = chartCanvas.toDataURL('image/png');
  const chartH = Math.min(65, PH - y - 30);
  doc.addImage(chartImg, 'PNG', ML, y, CW, chartH);
  y += chartH + 8;
  chartInst.destroy();
  chartCanvas.remove();

  // ── ARAÇ BAZLI DETAY TABLOLARI ──
  for (const v of vehicles) {
    const ve = (fuelData[v.id]||[]).slice().sort((a,b)=>new Date(a.tarih)-new Date(b.tarih)||a.km-b.km);
    if (ve.length === 0) continue;

    // Yeni sayfa başlangıcı
    newPage();
    y = 18;

    // Araç başlık bandı
    setFill(C.surface);
    roundRect(ML, y, CW, 14, 3);
    setFill(C.accent);
    roundRect(ML, y, 3, 14, 1);
    setTxt(C.accent);
    doc.setFontSize(11);
    doc.setFont('helvetica','bold');
    doc.text(tr(v.plaka||'—'), ML+7, y+9.5);
    setTxt(C.text2);
    doc.setFontSize(8);
    doc.setFont('helvetica','normal');
    const vMeta = tr([v.tip, v.sofor].filter(Boolean).join('  ·  '));
    doc.text(vMeta, ML+38, y+9.5);

    // Araç özet kartları (mini)
    const ve2 = ve;
    const vTotalL  = ve2.reduce((s,e)=>s+(e.litre||0),0);
    const vTotalTL = ve2.reduce((s,e)=>s+((e.litre||0)*(e.fiyat||0)),0);
    const vKmRange = ve2.length>=2 ? ve2[ve2.length-1].km-ve2[0].km : 0;
    const vCons    = allByVehicle[v.id];
    const vLastFiyat = ve2[ve2.length-1]?.fiyat||0;
    y += 18;

    const mCards = [
      { l:'Dolum',   v:ve2.length+' kez',   c:C.blue },
      { l:'Litre',   v:vTotalL.toLocaleString('tr-TR',{maximumFractionDigits:1})+' L', c:C.accent },
      { l:'Maliyet', v:vTotalTL>0?vTotalTL.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', c:C.green },
      { l:'Mesafe',  v:vKmRange>0?vKmRange.toLocaleString('tr-TR')+' km':'—', c:C.yellow },
      { l:'L/100km', v:vCons?vCons.toFixed(1):'—', c:vCons?(vCons<25?C.green:vCons<35?C.yellow:C.red):C.muted },
      { l:'Son Fiyat', v:vLastFiyat>0?vLastFiyat.toFixed(2)+' TL':'—', c:C.purple||C.text2 },
    ];
    const mcW = (CW-5*2)/6;
    mCards.forEach((mc, mi) => {
      const mx = ML + mi*(mcW+2);
      setFill(C.surface2);
      roundRect(mx, y, mcW, 16, 2);
      setTxt(mc.c);
      doc.setFontSize(9);
      doc.setFont('helvetica','bold');
      doc.text(mc.v, mx+mcW/2, y+7.5, {align:'center'});
      setTxt(C.muted);
      doc.setFontSize(6.5);
      doc.setFont('helvetica','normal');
      doc.text(mc.l.toUpperCase(), mx+mcW/2, y+13, {align:'center'});
    });
    y += 22;

    // Araç için aylık grafik (canvas)
    const vMonthL = {};
    months12.forEach(m => { vMonthL[m.key]=0; });
    ve2.forEach(e => {
      const mk = e.tarih?e.tarih.slice(0,7):'';
      if (mk in vMonthL) vMonthL[mk]+=(e.litre||0);
    });
    const vLitreData = months12.map(m => +(vMonthL[m.key]||0).toFixed(1));

    const vCanvas = document.createElement('canvas');
    vCanvas.width=900; vCanvas.height=240;
    document.body.appendChild(vCanvas);
    const vChart = new Chart(vCanvas, {
      type:'bar',
      data:{
        labels,
        datasets:[{
          label:'Litre (L)',
          data:vLitreData,
          backgroundColor:'rgba(249,115,22,0.7)',
          borderColor:'rgba(249,115,22,1)',
          borderWidth:1.5, borderRadius:4,
        }]
      },
      options:{
        responsive:false, animation:false,
        plugins:{legend:{labels:{color:'#a8b8cc',font:{size:10}}}},
        scales:{
          x:{ticks:{color:'#a8b8cc',font:{size:8}},grid:{color:'rgba(255,255,255,0.06)'}},
          y:{ticks:{color:'var(--accent)',font:{size:8}},grid:{color:'rgba(255,255,255,0.06)'},
             title:{display:true,text:'Litre',color:'var(--accent)',font:{size:8}}}
        }
      }
    });
    await new Promise(res=>setTimeout(res,150));
    const vImg = vCanvas.toDataURL('image/png');
    const vChH = Math.min(48, PH-y-80);
    setTxt(C.text2);
    doc.setFontSize(8.5);
    doc.setFont('helvetica','bold');
    doc.text(tr('Aylik Yakit Tuketimi'), ML, y); y+=4;
    doc.addImage(vImg,'PNG',ML,y,CW,vChH);
    y += vChH+8;
    vChart.destroy(); vCanvas.remove();

    // Detay tablo başlığı
    setTxt(C.text2);
    doc.setFontSize(8.5);
    doc.setFont('helvetica','bold');
    doc.text(tr('Yakit Giris Gecmisi'), ML, y); y+=5;

    // Tablo header
    const dCols = [
      {l:'Tarih', w:24},
      {l:'KM Sayaci', w:28},
      {l:'Litre', w:20},
      {l:'Birim Fiyat', w:26},
      {l:'Tutar (TL)', w:26},
      {l:'L/100km', w:24},
      {l:'KM Fark', w:22},
      {l:'Not', w:CW-170},
    ];
    setFill(C.surface2);
    rect(ML, y, CW, 7);
    setFill(C.accent);
    rect(ML, y, CW, 0.7);
    rect(ML, y+6.3, CW, 0.7);
    setTxt(C.muted);
    doc.setFontSize(6.5);
    doc.setFont('helvetica','bold');
    let dhx = ML+2;
    dCols.forEach(dc => { doc.text(dc.l.toUpperCase(), dhx, y+4.8); dhx+=dc.w; });
    y+=8;

    // Satırlar
    ve2.forEach((e, ei) => {
      if (y > PH-18) {
        addPageNum();
        doc.addPage(); pageNum++;
        setFill(C.bg); rect(0,0,PW,PH);
        y=15;
        // Header tekrar
        setFill(C.surface2); rect(ML,y,CW,7);
        setFill(C.accent); rect(ML,y,CW,0.7); rect(ML,y+6.3,CW,0.7);
        setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
        let dhx2=ML+2;
        dCols.forEach(dc=>{doc.text(dc.l.toUpperCase(),dhx2,y+4.8);dhx2+=dc.w;});
        y+=8;
      }

      const prev = ei>0?ve2[ei-1]:null;
      const kmFark = prev?e.km-prev.km:null;
      const cons = (kmFark&&kmFark>0)?(e.litre/kmFark)*100:null;
      const tutar = e.litre*(e.fiyat||0);

      setFill(ei%2===0?C.surface:C.bg);
      rect(ML,y,CW,6.5);

      setTxt(C.text2);
      doc.setFontSize(7); doc.setFont('helvetica','normal');
      let rx2=ML+2;
      // Tarih
      doc.text(e.tarih?e.tarih.split('-').reverse().join('.'):'—', rx2, y+4.5); rx2+=dCols[0].w;
      // KM
      setTxt(C.text);
      doc.text(e.km?e.km.toLocaleString('tr-TR')+' km':'—', rx2, y+4.5); rx2+=dCols[1].w;
      // Litre
      setTxt(C.accent);
      doc.text(e.litre?e.litre.toLocaleString('tr-TR',{minimumFractionDigits:1})+' L':'—', rx2, y+4.5); rx2+=dCols[2].w;
      // Birim Fiyat
      setTxt(C.text2);
      doc.text(e.fiyat?e.fiyat.toFixed(2)+' TL':'—', rx2, y+4.5); rx2+=dCols[3].w;
      // Tutar
      setTxt(C.green);
      doc.text(tutar>0?tutar.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', rx2, y+4.5); rx2+=dCols[4].w;
      // Tüketim
      if (cons!==null) {
        setTxt(cons<25?C.green:cons<35?C.yellow:C.red);
        doc.text(cons.toFixed(1)+' L', rx2, y+4.5);
      } else {
        setTxt(C.muted); doc.text(ei===0?'Ref.':'—', rx2, y+4.5);
      }
      rx2+=dCols[5].w;
      // KM Fark
      setTxt(C.blue);
      doc.text(kmFark!==null?'+'+kmFark.toLocaleString('tr-TR')+' km':'—', rx2, y+4.5); rx2+=dCols[6].w;
      // Not
      setTxt(C.muted);
      const notTxt = tr((e.not||'').slice(0,22));
      doc.text(notTxt, rx2, y+4.5);
      y+=6.5;
    });

    // Alt çizgi
    setFill(C.border); rect(ML,y,CW,0.5);
    y+=5;
  }

  addPageNum();
  _pdfSave(doc, 'yakit_raporu_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('PDF indirildi ✓', 'success');
}

/* ================================================================
   BAKIM / ARIZA RAPORU PDF İNDİRME
   ================================================================ */

async function downloadMaintPDF() {
  // Veri kontrolü
  const allMaintEntries = [];
  vehicles.forEach(v => {
    const entries = (maintData[v.id] || []).map(e => ({ ...e, plaka: v.plaka, tip: v.tip || '', sofor: v.sofor || '' }));
    allMaintEntries.push(...entries);
  });

  if (allMaintEntries.length === 0) {
    showToast('İndirilecek bakım/arıza kaydı yok.', 'error');
    return;
  }

  showToast('Bakım raporu hazırlanıyor…', 'info');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, ML = 14, MR = 14, CW = PW - ML - MR;

  function tr(s) {
    if (!s) return '';
    return String(s)
      .replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C').replace(/ı/g,'i').replace(/İ/g,'I');
  }

  const LOGO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAFHUlEQVR4nO3dTW7UQBAF4JyCq3EQ7sARsuAC3IAtWbOBJZtssgCBhFCEkCCZmeD2zBgnmfFP13vdVdXVUolNZE/6ozztKrdzcUEaf1+9eIhYHiwH8ag9Md4jUBuKgG0kAreBCNwGImAbicBtIALYeQRuAxG4DUTgNhAB7DwCt4EIYOcRwM4jcBuIAHYeAew8Ath5BLDzCODM2N58fNjdfuv/rf1ZZoFrfwiLsdtu9vHnd/XPMotc+wNYix52t9vH/Z34eGkEMCjGIxv4iNvF5upS/DmejgAG4OZOZsrY/8BbOC4DuQlg1ESOszctshi4aOQAXorbLajGwExcJLJ7YNQEPsrejNVzABcGXoXbXY4l2RvAinF74G5BNQB3t0klcFHIAbwIWJa9uciIOXALjMPdim+NAlg1sDx7A1gr7rgsKcjeHGTUXLgDRk7aOHtRnaOSuE0Br8Z9VJaUXZ7Hsfn8vhiuO2BW9iLbgpufX/bRQR8/M3NOmgBejSssS57F/fB2j/v9uticuAGmZS+g5zsAd7CbXz+G7A1gAPDa4/SP4xCy9+7Nyz1ul8El58UFMHLBIi1Lnos+e9Pl+eZTANcFxmdvD3xYXJWeG/PAtOwFFDYG3C5ra2RvAD8D9pW95oGhuOCy5ICbsjctrgreGgXwKWBCWbIHrpi9poGhuMSyZJ+9Fb57TQNPjSxgVlnycGt0/+51ACOAs3BZZcmUvYXLki6AqdmLLEsevntrZq8r4JxjscqSNZoKLoDx2UssSxZuKrgGzj0eI3vTJblGU8E8MB6XVJas1FQI4GfA/sqSZoHhuMyypKLsbRdYuA30LLCy7DUBDMdlFTaOTQVF2aseeGpkA5PLkrXnzAVwNi5gG+hJXAVNBXPAnOwd3RoRypLpwbra82YeOBvh6tJ1U8EUMCV7x7dGyLKkkqaCC2DJMWlNhYqP45gEpuCysvfYVOiga89b28CAt9M9DW1NBRPAFFzA2+lOxdBUUNASbBu4obKkamAKLrMsaSB71QBPDREwcxO34pWzGWARLqssqbSpoBaYl73cbaC15808sPS41LKkkeytDlwke5G3RkZWzuqBpcdtsamgDpiGy3reKuF2iyutTYV2gAnbQC00FVQB03BZ20ANNBXaACYUNvqmgsHFVTVgGi6rLGmkqeAfmLANtH95meHsLQ7MwqVtAz2WJY1mb1HgqSE9Nq0safC+Vx0w4tjRVKgMXCx7Gy9LFgXe3X6dBYach9nQN569UOAEeiqo2cssSzrIXgjwOdg5YMh/KkZZ8pi9xhdXEOBc3PHlO/vcrLKk0aYCHHgOdw5YiswoSw67BJ1kLxV4DlcCTC9LGmwqQIER2StBZpQlrTcVigIvxc0BppUljTcVigFPDQQwoyw5ZK+j797iwOd+fj1wNBWowMjL81rkKEsWAJ5DZuHugYmP4zgoS54ETgMJ/BR57mcXnzPKknm4DOA1sfichG2gnpoKpoFphQ3H2SsCRiEvPhejLOmsqWAWmLYN9NBU0PjyMhXAUuTF5yC8nc5jU2ESuDTyYgjW2+kcNhUmcSXAa6BXH3Pc8wWVJYddgo4XVxTgU+DiY6TVc7r/ZfyhZodlyUlgBrI0+s5Rt8hCPY7juakwi6sRGB2a/p5RFWDvyBZePUjF9YzsvamwGNcrsveV8ypcb8D94irdHjn+7l0N7A25iZJk7qj9C0SQYANZb0BxA1lXUHADun7QYQO7EdQlo/bEWAuWwz+aKJThdQXEYAAAAABJRU5ErkJggg==';

  const C = {
    bg:[8,12,16], surface:[17,24,32], surface2:[24,32,44], border:[37,47,62],
    accent:[56,189,248],   // BLUE for maintenance
    accentD:[12,74,110],
    text:[226,234,243], text2:[168,184,204], muted:[82,96,112],
    green:[34,197,94], yellow:[245,158,11], red:[239,68,68],
    blue:[56,189,248], orange:[249,115,22], purple:[167,139,250], white:[255,255,255],
  };

  function setFill(c)   { doc.setFillColor(...c); }
  function setTxt(c)    { doc.setTextColor(...c); }
  function rect(x,y,w,h,s='F')       { doc.rect(x,y,w,h,s); }
  function roundRect(x,y,w,h,r,s='F'){ doc.roundedRect(x,y,w,h,r,r,s); }

  let pageNum = 1;
  function addFooter() {
    setTxt(C.muted); doc.setFontSize(8);
    doc.text(tr('Filo Takip Sistemi - Bakim/Ariza Raporu'), ML, PH-8);
    doc.text(tr('Sayfa ')+pageNum, PW-MR, PH-8, {align:'right'});
    doc.text(new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'}), PW/2, PH-8, {align:'center'});
    setTxt([50,62,78]); doc.setFontSize(6);
    doc.text('created by cihanozcan app.', PW/2, PH-3, {align:'center'});
  }
  function newPage() {
    addFooter(); doc.addPage(); pageNum++;
    setFill(C.bg); rect(0,0,PW,PH);
  }

  // ── ARKA PLAN ──
  setFill(C.bg); rect(0,0,PW,PH);

  // ── HEADER BANDI ──
  setFill(C.surface); rect(0,0,PW,42);
  setFill(C.accent);  rect(0,0,4,42);
  doc.addImage(LOGO_B64,'PNG',ML,7,28,28);
  setTxt(C.white); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text(tr('Bakim / Ariza Raporu'), ML+32, 18);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); setTxt(C.text2);
  doc.text(tr('Filo Takip Sistemi  |  Tum Araclar'), ML+32, 26);
  const dateStr = new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'});
  setFill(C.surface2); roundRect(PW-ML-52,12,52,18,3);
  setTxt(C.accent); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr(dateStr), PW-ML-26, 22, {align:'center'});

  let y = 52;

  // ── GENEL ÖZET İSTATİSTİK KARTLARI ──
  const allByVehicle = vehicles.map(v => {
    const entries = maintData[v.id] || [];
    return { v, entries };
  }).filter(x => x.entries.length > 0);

  const totalKayit   = allMaintEntries.length;
  const totalAriza   = allMaintEntries.filter(e => e.tur === 'ariza').length;
  const totalMaliyet = allMaintEntries.reduce((s,e) => s+(e.maliyet||0), 0);
  const totalBakim   = allMaintEntries.filter(e => e.tur === 'bakim').length;
  const totalParca   = allMaintEntries.filter(e => e.tur === 'parca').length;

  // Gecikmiş bakım sayısı
  let gecikmisSayisi = 0;
  allMaintEntries.forEach(e => {
    if (e.sonraki_tarih) {
      const dl = daysLeft(e.sonraki_tarih);
      if (dl !== null && dl < 0) gecikmisSayisi++;
    }
  });

  const summaryCards = [
    { label:tr('Toplam Kayit'),    value: totalKayit.toString(),    color: C.blue,   icon:'K' },
    { label:tr('Arizа/Onarim'),    value: totalAriza.toString(),    color: C.red,    icon:'A' },
    { label:tr('Toplam Maliyet'),  value: totalMaliyet > 0 ? totalMaliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL' : '--', color: C.green, icon:'M' },
    { label:tr('Parca Degisimi'),  value: totalParca.toString(),    color: C.yellow, icon:'P' },
    { label:tr('Gecikmis Bakim'),  value: gecikmisSayisi.toString(),color: gecikmisSayisi>0?C.red:C.green, icon:'!' },
    { label:tr('Aktif Arac'),      value: allByVehicle.length + ' / ' + vehicles.length, color: C.orange, icon:'V' },
  ];

  const cW = (CW - 5*2) / 6;
  summaryCards.forEach((card, i) => {
    const cx = ML + i*(cW+2);
    setFill(C.surface); roundRect(cx, y, cW, 26, 2);
    setFill(card.color); roundRect(cx, y, 3, 26, 1);
    // İkon dairesi
    setFill(card.color.map(x => Math.round(x*0.18)));
    roundRect(cx+5, y+5, 14, 16, 2);
    setTxt(card.color); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text(card.icon, cx+12, y+15, {align:'center'});
    // Değer
    setTxt(C.white); doc.setFontSize(9.5); doc.setFont('helvetica','bold');
    doc.text(card.value, cx+22, y+12);
    // Etiket
    setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
    doc.text(card.label.toUpperCase(), cx+22, y+20);
  });
  y += 34;

  // ── ARIZA TÜRÜ DAĞILIMI ÇUBUĞU ──
  if (y + 18 > PH - 30) { newPage(); y = 20; }
  setTxt(C.accent); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Tur Dagilimi'), ML, y); y += 6;

  const turList = [
    { key:'bakim',   label:tr('Periyodik Bakim'), color:C.blue,   count: allMaintEntries.filter(e=>e.tur==='bakim').length },
    { key:'ariza',   label:tr('Ariza/Onarim'),    color:C.red,    count: totalAriza },
    { key:'parca',   label:tr('Parca Degisimi'),  color:C.yellow, count: totalParca },
    { key:'muayene', label:tr('Muayene'),          color:C.green,  count: allMaintEntries.filter(e=>e.tur==='muayene').length },
    { key:'diger',   label:tr('Diger'),            color:C.muted,  count: allMaintEntries.filter(e=>e.tur==='diger').length },
  ].filter(t => t.count > 0);

  const maxCount = Math.max(...turList.map(t=>t.count), 1);
  turList.forEach(t => {
    if (y + 8 > PH - 20) { newPage(); y = 20; }
    setTxt(t.color); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text(t.label, ML, y+5);
    const barX = ML + 48;
    const barW = CW - 48 - 22;
    setFill(C.surface2); rect(barX, y, barW, 6);
    const fillW = Math.max(2, (t.count/maxCount)*barW);
    setFill(t.color); rect(barX, y, fillW, 6);
    setTxt(C.text2); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
    doc.text(t.count.toString(), barX+barW+3, y+5);
    y += 9;
  });
  y += 6;

  // ── ARAÇ BAZLI ÖZET TABLO ──
  if (y + 20 > PH - 30) { newPage(); y = 20; }
  setTxt(C.accent); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Bakim Ozeti'), ML, y); y += 6;

  const vCols = [
    { label:tr('Plaka'),      w:30 },
    { label:tr('Tip'),        w:25 },
    { label:tr('Kayit'),      w:18 },
    { label:tr('Ariza'),      w:16 },
    { label:tr('Toplam TL'),  w:32 },
    { label:tr('Bu Yil TL'), w:30 },
    { label:tr('Sonraki Bakim'), w:CW-151 },
  ];
  setFill(C.surface2); rect(ML, y, CW, 8);
  setFill(C.accent); rect(ML, y, CW, 0.8); rect(ML, y+7.2, CW, 0.8);
  setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
  let hx = ML+2;
  vCols.forEach(col => { doc.text(col.label.toUpperCase(), hx, y+5.5); hx += col.w; });
  y += 9;

  const buYil = new Date().getFullYear().toString();
  vehicles.forEach((v, vi) => {
    if (y > PH - 20) { newPage(); y = 20; }
    const entries = (maintData[v.id] || []);
    if (entries.length === 0) return;
    const vAriza   = entries.filter(e=>e.tur==='ariza').length;
    const vMaliyet = entries.reduce((s,e)=>s+(e.maliyet||0),0);
    const vBuYilM  = entries.filter(e=>e.tarih&&e.tarih.startsWith(buYil)).reduce((s,e)=>s+(e.maliyet||0),0);
    const planlı   = entries.filter(e=>e.sonraki_tarih).sort((a,b)=>a.sonraki_tarih.localeCompare(b.sonraki_tarih));
    const nextBakim = planlı.length > 0 ? planlı[0] : null;

    setFill(vi%2===0 ? C.surface : C.bg); rect(ML, y, CW, 7.5);
    let rx = ML+2;
    setTxt(C.accent); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text(tr(v.plaka||'—'), rx, y+5); rx += vCols[0].w;
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(tr(v.tip||'—'), rx, y+5); rx += vCols[1].w;
    setTxt(C.blue);
    doc.text(entries.length.toString(), rx, y+5); rx += vCols[2].w;
    setTxt(vAriza>0?C.red:C.muted);
    doc.text(vAriza.toString(), rx, y+5); rx += vCols[3].w;
    setTxt(C.green);
    doc.text(vMaliyet>0?vMaliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', rx, y+5); rx += vCols[4].w;
    setTxt(C.yellow);
    doc.text(vBuYilM>0?vBuYilM.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', rx, y+5); rx += vCols[5].w;
    if (nextBakim) {
      const dl = daysLeft(nextBakim.sonraki_tarih);
      const clr = dl===null?C.muted:(dl<0?C.red:dl<=30?C.yellow:C.green);
      setTxt(clr);
      const dlTxt = dl===null?'—':(dl<0?Math.abs(dl)+' gun gec':dl===0?'Bugun':dl+' gun');
      doc.text(tr(nextBakim.sonraki_tarih.split('-').reverse().join('.'))+' ('+dlTxt+')', rx, y+5);
    } else {
      setTxt(C.muted); doc.text('—', rx, y+5);
    }
    y += 7.5;
  });
  setFill(C.border); rect(ML, y, CW, 0.5);
  y += 10;

  // ── AYLIK BAKIM MALİYET GRAFİĞİ ──
  if (y + 60 > PH - 30) { newPage(); y = 20; }
  const now2 = new Date();
  const months12 = [];
  for (let i=11; i>=0; i--) {
    const d = new Date(now2.getFullYear(), now2.getMonth()-i, 1);
    months12.push({ key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), d });
  }
  const monthMaliyet = {}; const monthKayit = {};
  months12.forEach(m => { monthMaliyet[m.key]=0; monthKayit[m.key]=0; });
  allMaintEntries.forEach(e => {
    const mk = e.tarih?e.tarih.slice(0,7):'';
    if (mk in monthMaliyet) { monthMaliyet[mk]+=(e.maliyet||0); monthKayit[mk]++; }
  });

  const chartCanvas = document.createElement('canvas');
  chartCanvas.width=900; chartCanvas.height=300; document.body.appendChild(chartCanvas);
  const labels = months12.map(m=>m.d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'}));
  const chartInst = new Chart(chartCanvas, {
    type:'bar',
    data:{
      labels,
      datasets:[
        { label:tr('Maliyet (TL)'), data:months12.map(m=>+(monthMaliyet[m.key]||0).toFixed(0)),
          backgroundColor:'rgba(56,189,248,0.7)', borderColor:'rgba(56,189,248,1)', borderWidth:1.5, borderRadius:4, yAxisID:'y' },
        { label:tr('Kayit Sayisi'), data:months12.map(m=>monthKayit[m.key]||0),
          type:'line', borderColor:'rgba(249,115,22,1)', backgroundColor:'rgba(249,115,22,0.08)',
          borderWidth:2, pointBackgroundColor:'rgba(249,115,22,1)', pointRadius:4, fill:true, tension:0.35, yAxisID:'y2' }
      ]
    },
    options:{
      responsive:false, animation:false,
      plugins:{legend:{labels:{color:'#a8b8cc',font:{size:10}}}},
      scales:{
        x:{ticks:{color:'#a8b8cc',font:{size:9}},grid:{color:'rgba(255,255,255,0.06)'}},
        y:{ticks:{color:'#38bdf8',font:{size:9}},grid:{color:'rgba(255,255,255,0.06)'},title:{display:true,text:'Maliyet (TL)',color:'#38bdf8',font:{size:9}}},
        y2:{position:'right',ticks:{color:'var(--accent)',font:{size:9}},grid:{drawOnChartArea:false},title:{display:true,text:'Kayit',color:'var(--accent)',font:{size:9}}}
      }
    }
  });

  setTxt(C.accent); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Bakim Maliyeti ve Kayit Sayisi (Son 12 Ay)'), ML, y); y += 5;
  await new Promise(res=>setTimeout(res,220));
  const chartImg = chartCanvas.toDataURL('image/png');
  const chartH = Math.min(65, PH-y-30);
  doc.addImage(chartImg,'PNG',ML,y,CW,chartH);
  y += chartH+8;
  chartInst.destroy(); chartCanvas.remove();

  // ── ARAÇ BAZLI DETAY TABLOLARI ──
  const turColors = { bakim:C.blue, ariza:C.red, parca:C.yellow, muayene:C.green, diger:C.muted };
  const turLabels = { bakim:tr('Periyodik Bakim'), ariza:tr('Ariza/Onarim'), parca:tr('Parca Degisimi'), muayene:tr('Muayene'), diger:tr('Diger') };
  const dCols = [
    { label:tr('Tarih'),        w:24 },
    { label:tr('Tur'),          w:30 },
    { label:tr('KM'),           w:24 },
    { label:tr('Maliyet (TL)'), w:28 },
    { label:tr('Sonraki Tarih'),w:26 },
    { label:tr('Sonraki KM'),   w:26 },
    { label:tr('Servis'),       w:28 },
    { label:tr('Aciklama'),     w:CW-186 },
  ];

  function drawDHeader(yy) {
    setFill(C.surface2); rect(ML, yy, CW, 7.5);
    setFill(C.accent); rect(ML, yy, CW, 0.7); rect(ML, yy+6.8, CW, 0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; dCols.forEach(dc=>{ doc.text(dc.label.toUpperCase(),hxx,yy+5.2); hxx+=dc.w; });
    return yy+8.5;
  }

  for (const v of vehicles) {
    const entries = (maintData[v.id]||[]).slice().sort((a,b)=>(a.tarih||'').localeCompare(b.tarih||''));
    if (entries.length===0) continue;

    newPage(); y=18;

    // Araç başlık bandı
    setFill(C.surface); roundRect(ML, y, CW, 14, 3);
    setFill(C.accent); roundRect(ML, y, 3, 14, 1);
    setTxt(C.accent); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(tr(v.plaka||'—'), ML+7, y+9.5);
    setTxt(C.text2); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(tr([v.tip, v.sofor].filter(Boolean).join('  ·  ')), ML+38, y+9.5);
    y += 18;

    // Araç mini özet kartları
    const vToplam  = entries.length;
    const vAriza   = entries.filter(e=>e.tur==='ariza').length;
    const vMaliyet = entries.reduce((s,e)=>s+(e.maliyet||0),0);
    const vBuYilM  = entries.filter(e=>e.tarih&&e.tarih.startsWith(buYil)).reduce((s,e)=>s+(e.maliyet||0),0);
    const vPlanlı  = entries.filter(e=>e.sonraki_tarih).sort((a,b)=>a.sonraki_tarih.localeCompare(b.sonraki_tarih));
    const vSonraki = vPlanlı.length>0?vPlanlı[0]:null;
    const vDL      = vSonraki?daysLeft(vSonraki.sonraki_tarih):null;

    const mCards = [
      { l:tr('Toplam Kayit'),  v:vToplam.toString(),      c:C.blue },
      { l:tr('Ariza'),         v:vAriza.toString(),        c:vAriza>0?C.red:C.muted },
      { l:tr('Toplam Maliyet'),v:vMaliyet>0?vMaliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', c:C.green },
      { l:tr('Bu Yil Maliyet'),v:vBuYilM>0?vBuYilM.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', c:C.yellow },
      { l:tr('Sonraki Bakim'), v:vSonraki?(vDL<0?Math.abs(vDL)+' gun gec':vDL===0?'Bugun':vDL+' gun'):'—',
        c:vSonraki?(vDL<0?C.red:vDL<=30?C.yellow:C.green):C.muted },
    ];
    const mcW=(CW-4*2)/5;
    mCards.forEach((mc,mi)=>{
      const mx=ML+mi*(mcW+2);
      setFill(C.surface2); roundRect(mx,y,mcW,16,2);
      setTxt(mc.c); doc.setFontSize(9); doc.setFont('helvetica','bold');
      doc.text(mc.v, mx+mcW/2, y+7.5, {align:'center'});
      setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
      doc.text(mc.l.toUpperCase(), mx+mcW/2, y+13, {align:'center'});
    });
    y += 22;

    // Tablo
    setTxt(C.accent); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text(tr('Kayit Gecmisi'), ML, y); y += 5;
    y = drawDHeader(y);

    entries.forEach((e, ei) => {
      if (y > PH-18) { newPage(); y=15; y=drawDHeader(y); }
      setFill(ei%2===0?C.surface:C.bg); rect(ML, y, CW, 6.5);
      doc.setFontSize(6.8); doc.setFont('helvetica','normal');
      let rx=ML+2;
      const turColor = turColors[e.tur]||C.muted;
      setTxt(C.text2); doc.text(e.tarih?e.tarih.split('-').reverse().join('.'):'—', rx, y+4.5); rx+=dCols[0].w;
      setTxt(turColor); doc.setFont('helvetica','bold');
      doc.text(turLabels[e.tur]||tr(e.tur||'—'), rx, y+4.5); rx+=dCols[1].w;
      setTxt(C.text2); doc.setFont('helvetica','normal');
      doc.text(e.km?e.km.toLocaleString('tr-TR')+' km':'—', rx, y+4.5); rx+=dCols[2].w;
      setTxt(C.green);
      doc.text(e.maliyet>0?e.maliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})+' TL':'—', rx, y+4.5); rx+=dCols[3].w;
      if (e.sonraki_tarih) {
        const dl2=daysLeft(e.sonraki_tarih);
        setTxt(dl2<0?C.red:dl2<=30?C.yellow:C.green);
        doc.text(e.sonraki_tarih.split('-').reverse().join('.'), rx, y+4.5);
      } else { setTxt(C.muted); doc.text('—', rx, y+4.5); }
      rx+=dCols[4].w;
      setTxt(C.blue);
      doc.text(e.sonraki_km?e.sonraki_km.toLocaleString('tr-TR')+' km':'—', rx, y+4.5); rx+=dCols[5].w;
      setTxt(C.text2);
      doc.text(tr((e.servis||'').slice(0,18)), rx, y+4.5); rx+=dCols[6].w;
      setTxt(C.muted);
      doc.text(tr((e.aciklama||'').slice(0,30)), rx, y+4.5);
      y+=6.5;
    });
    setFill(C.border); rect(ML, y, CW, 0.5);
  }

  addFooter();
  _pdfSave(doc, 'bakim_ariza_raporu_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('Bakım Raporu PDF indirildi ✓', 'success');
}


