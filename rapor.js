/* ================================================================
   RAPORLAR
   ================================================================ */
function openRaporModal() {
  _buildRaporDonemSelect();
  renderRaporlar();
  document.getElementById('rapor-backdrop').classList.remove('hidden');
}
function closeRaporModal() { document.getElementById('rapor-backdrop').classList.add('hidden'); }
function closeRaporModalBackdrop(e) { if(e.target.id==='rapor-backdrop') closeRaporModal(); }

function _buildRaporDonemSelect() {
  const sel = document.getElementById('rapor-donem');
  const months = new Set();
  [...seferData,...masrafData].forEach(e=>{ if(e.tarih) months.add(e.tarih.slice(0,7)); });
  Object.values(fuelData).flat().forEach(e=>{ if(e.tarih) months.add(e.tarih.slice(0,7)); });
  Object.values(maintData).flat().forEach(e=>{ if(e.tarih) months.add(e.tarih.slice(0,7)); });
  const sorted = [...months].sort().reverse();
  sel.innerHTML = '<option value="all">Tüm Zamanlar</option>' +
    sorted.map(m=>{
      const [y,mo]=m.split('-');
      const label=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][parseInt(mo)-1]+' '+y;
      return `<option value="${m}">${label}</option>`;
    }).join('');
}

function renderRaporlar() {
  const el = document.getElementById('rapor-body');
  if(!el) return;
  const donem = document.getElementById('rapor-donem')?.value||'all';
  const flt = e => !donem||donem==='all'||!e.tarih||e.tarih.startsWith(donem);

  // Veri topla
  const seferler = seferData.filter(flt);
  const masraflar = masrafData.filter(flt);
  const yakitlar = Object.values(fuelData).flat().filter(flt);
  const bakimlar = Object.values(maintData).flat().filter(flt);

  const toplamCiro    = seferler.reduce((a,s)=>a+(s.ucret||0),0);
  const toplamYakit   = yakitlar.reduce((a,e)=>a+(e.fiyat?e.fiyat*e.litre:0),0);
  const toplamBakim   = bakimlar.reduce((a,e)=>a+(e.maliyet||0),0);
  const toplamMasraf  = masraflar.reduce((a,m)=>a+(m.tutar||0),0);
  const toplamGider   = toplamYakit + toplamBakim + toplamMasraf;
  const netKar        = toplamCiro - toplamGider;
  const toplamKm      = seferler.reduce((a,s)=>a+(s.km||0),0);
  const kmBasiMaliyet = toplamKm>0 ? toplamGider/toplamKm : 0;

  // Araç bazlı kârlılık
  const byArac = {};
  vehicles.forEach(v=>{ byArac[v.id]={plaka:v.plaka,ciro:0,yakit:0,bakim:0,masraf:0,km:0,sefer:0}; });
  seferler.forEach(s=>{
    if(!byArac[s.aracId]) byArac[s.aracId]={plaka:s.plaka||s.aracId,ciro:0,yakit:0,bakim:0,masraf:0,km:0,sefer:0};
    byArac[s.aracId].ciro  += s.ucret||0;
    byArac[s.aracId].km    += s.km||0;
    byArac[s.aracId].sefer++;
  });
  (Object.entries(fuelData)).forEach(([vid,entries])=>{
    if(!byArac[vid]) return;
    entries.filter(flt).forEach(e=>{ byArac[vid].yakit += (e.fiyat?e.fiyat*e.litre:0); });
  });
  (Object.entries(maintData)).forEach(([vid,entries])=>{
    if(!byArac[vid]) return;
    entries.filter(flt).forEach(e=>{ byArac[vid].bakim += (e.maliyet||0); });
  });
  masraflar.forEach(m=>{
    if(!byArac[m.aracId]) return;
    byArac[m.aracId].masraf += m.tutar||0;
  });

  const aracRows = Object.values(byArac)
    .map(a=>({...a, gider:a.yakit+a.bakim+a.masraf, kar:a.ciro-(a.yakit+a.bakim+a.masraf)}))
    .filter(a=>a.ciro>0||a.gider>0)
    .sort((a,b)=>b.kar-a.kar);

  const karColor = n => n>=0?'var(--green)':'var(--red)';

  el.innerHTML = `
  <!-- KPI Satırı -->
  <div class="srm-stats" style="margin-bottom:20px">
    ${[
      {val:'₺'+toplamCiro.toLocaleString('tr',{minimumFractionDigits:0}), lbl:'Toplam Ciro', color:'var(--green)'},
      {val:'₺'+toplamGider.toLocaleString('tr',{minimumFractionDigits:0}), lbl:'Toplam Gider', color:'var(--red)'},
      {val:'₺'+Math.abs(netKar).toLocaleString('tr',{minimumFractionDigits:0}), lbl:(netKar>=0?'Net Kâr':'Net Zarar'), color:karColor(netKar)},
      {val:seferler.length, lbl:'Sefer Sayısı', color:'var(--purple)'},
      {val:toplamKm.toLocaleString('tr')+' km', lbl:'Toplam Km', color:'var(--blue)'},
      {val:'₺'+(kmBasiMaliyet>0?kmBasiMaliyet.toFixed(2):'—'), lbl:'Maliyet / Km', color:'var(--yellow)'},
    ].map(s=>`<div class="srm-stat"><div class="srm-stat-val" style="color:${s.color};font-size:${s.val.toString().length>10?'14px':'22px'}">${s.val}</div><div class="srm-stat-lbl">${s.lbl}</div></div>`).join('')}
  </div>

  <!-- Gider Dağılımı + Araç Kârlılığı -->
  <div class="rapor-grid">
    <div class="rapor-card">
      <div class="rapor-card-title">📉 Gider Dağılımı</div>
      ${[
        {lbl:'⛽ Yakıt', val:toplamYakit, color:'var(--accent)'},
        {lbl:'🔧 Bakım', val:toplamBakim, color:'var(--blue)'},
        {lbl:'💸 Diğer Masraf', val:toplamMasraf, color:'var(--yellow)'},
      ].map(r=>{
        const pct = toplamGider>0?Math.round(r.val/toplamGider*100):0;
        return `<div class="rapor-row">
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span class="rapor-row-label">${r.lbl}</span>
              <span class="rapor-row-val" style="color:${r.color}">₺${r.val.toLocaleString('tr',{minimumFractionDigits:0})} <span style="color:var(--muted);font-size:11px">(${pct}%)</span></span>
            </div>
            <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${pct}%;background:${r.color}"></div></div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="rapor-card">
      <div class="rapor-card-title">🚛 Araç Bazlı Kârlılık</div>
      ${aracRows.length===0?'<p style="color:var(--muted);font-size:13px">Sefer ve gider verisi girildikçe bu tablo dolacak.</p>':
        aracRows.map(a=>`
        <div class="rapor-row">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${a.plaka}</span>
              <span style="font-size:11px;color:var(--muted)">${a.sefer} sefer · ${a.km.toLocaleString('tr')} km</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">
              Ciro: <span style="color:var(--green)">₺${a.ciro.toLocaleString('tr',{minimumFractionDigits:0})}</span>
              &nbsp;Gider: <span style="color:var(--red)">₺${a.gider.toLocaleString('tr',{minimumFractionDigits:0})}</span>
            </div>
          </div>
          <div class="rapor-row-val" style="color:${karColor(a.kar)}">
            ${a.kar>=0?'+':''}₺${Math.abs(a.kar).toLocaleString('tr',{minimumFractionDigits:0})}
          </div>
        </div>`).join('')}
    </div>
  </div>

  <!-- Aylık Trend -->
  <div class="rapor-card" style="margin-top:0">
    <div class="rapor-card-title">📅 Aylık Özet (Son 6 Ay)</div>
    <div style="overflow-x:auto">
      <table class="srm-table" style="min-width:500px">
        <thead><tr>
          <th>Dönem</th><th>Sefer</th><th>Ciro</th><th>Yakıt</th><th>Bakım</th><th>Masraf</th><th>Net</th>
        </tr></thead>
        <tbody>
          ${(()=>{
            const months = new Set();
            [...seferData,...masrafData,...Object.values(fuelData).flat(),...Object.values(maintData).flat()]
              .forEach(e=>{ if(e.tarih) months.add(e.tarih.slice(0,7)); });
            const sorted = [...months].sort().reverse().slice(0,6);
            if(sorted.length===0) return '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">Veri yok</td></tr>';
            return sorted.map(m=>{
              const [y,mo]=m.split('-');
              const label=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][parseInt(mo)-1]+' '+y;
              const sf = seferData.filter(s=>s.tarih&&s.tarih.startsWith(m));
              const mf = masrafData.filter(x=>x.tarih&&x.tarih.startsWith(m));
              const yf = Object.values(fuelData).flat().filter(x=>x.tarih&&x.tarih.startsWith(m));
              const bf = Object.values(maintData).flat().filter(x=>x.tarih&&x.tarih.startsWith(m));
              const ciro   = sf.reduce((a,s)=>a+(s.ucret||0),0);
              const yakit  = yf.reduce((a,e)=>a+(e.fiyat?e.fiyat*e.litre:0),0);
              const bakim  = bf.reduce((a,e)=>a+(e.maliyet||0),0);
              const masraf = mf.reduce((a,x)=>a+(x.tutar||0),0);
              const net    = ciro-(yakit+bakim+masraf);
              const nc     = net>=0?'var(--green)':'var(--red)';
              return `<tr>
                <td style="font-weight:600">${label}</td>
                <td style="color:var(--purple);font-family:var(--font-mono)">${sf.length}</td>
                <td style="color:var(--green);font-family:var(--font-mono)">₺${ciro.toLocaleString('tr',{minimumFractionDigits:0})}</td>
                <td style="color:var(--accent);font-family:var(--font-mono)">₺${yakit.toLocaleString('tr',{minimumFractionDigits:0})}</td>
                <td style="color:var(--blue);font-family:var(--font-mono)">₺${bakim.toLocaleString('tr',{minimumFractionDigits:0})}</td>
                <td style="color:var(--yellow);font-family:var(--font-mono)">₺${masraf.toLocaleString('tr',{minimumFractionDigits:0})}</td>
                <td style="color:${nc};font-family:var(--font-mono);font-weight:700">${net>=0?'+':''}₺${Math.abs(net).toLocaleString('tr',{minimumFractionDigits:0})}</td>
              </tr>`;
            }).join('');
          })()}
        </tbody>
      </table>
    </div>
  </div>`;
}

/* ================================================================
   EXCEL — dinamik SheetJS yükleyici (sayfa açılışını etkilemez)
   ================================================================ */
function _loadXLSX() {
  return new Promise(function(resolve, reject) {
    if (window.XLSX) { resolve(window.XLSX); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = function() { resolve(window.XLSX); };
    s.onerror = function() { reject(new Error('SheetJS yüklenemedi')); };
    document.head.appendChild(s);
  });
}

/* ── Sefer Excel ── */
async function downloadSeferExcel() {
  if (!seferData || seferData.length === 0) { showToast('İndirilecek sefer kaydı yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var fmtD = function(d){ return d ? d.split('-').reverse().join('.') : '—'; };
    var sorted = [...seferData].sort(function(a,b){ return (b.tarih||'').localeCompare(a.tarih||''); });
    var rows = [['Tarih','Araç Plakası','Sürücü','Kalkış','Varış','Mesafe (km)','Yük / Müşteri','Sefer Ücreti (₺)','Notlar']];
    sorted.forEach(function(s){ rows.push([fmtD(s.tarih),s.plaka||s.aracId||'—',s.sofor||'—',s.kalkis||'—',s.varis||'—',s.km||'',s.yuk||'—',s.ucret||'',s.not||'']); });
    rows.push(['TOPLAM','','','','',seferData.reduce(function(a,s){return a+(s.km||0);},0),'',seferData.reduce(function(a,s){return a+(s.ucret||0);},0),'']);
    var ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:12},{wch:14},{wch:18},{wch:18},{wch:18},{wch:13},{wch:24},{wch:18},{wch:24}];
    XL.utils.book_append_sheet(WB, ws, 'Sefer Kayıtları');
    var byA={};
    seferData.forEach(function(s){ var k=s.plaka||s.aracId||'?'; if(!byA[k])byA[k]={p:k,n:0,km:0,c:0}; byA[k].n++;byA[k].km+=s.km||0;byA[k].c+=s.ucret||0; });
    var ar=[['Araç','Sefer Sayısı','Toplam km','Toplam Ciro (₺)']];
    Object.values(byA).sort(function(a,b){return b.c-a.c;}).forEach(function(a){ar.push([a.p,a.n,a.km,a.c]);});
    var ws2 = XL.utils.aoa_to_sheet(ar);
    ws2['!cols'] = [{wch:14},{wch:12},{wch:14},{wch:16}];
    XL.utils.book_append_sheet(WB, ws2, 'Araç Özeti');
    XL.writeFile(WB, 'sefer_raporu_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

/* ── Masraf Excel ── */
async function downloadMasrafExcel() {
  if (!masrafData || masrafData.length === 0) { showToast('İndirilecek masraf kaydı yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var fmtD = function(d){ return d ? d.split('-').reverse().join('.') : '—'; };
    var sorted = [...masrafData].sort(function(a,b){ return (b.tarih||'').localeCompare(a.tarih||''); });
    var rows=[['Tarih','Araç Plakası','Kategori','Açıklama','Tutar (₺)','Makbuz No']];
    sorted.forEach(function(m){ rows.push([fmtD(m.tarih),m.plaka||m.aracId||'—',m.kategori||'—',m.aciklama||'—',m.tutar||'',m.makbuz||'']); });
    rows.push(['TOPLAM','','','',masrafData.reduce(function(a,m){return a+(m.tutar||0);},0),'']);
    var ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:12},{wch:14},{wch:20},{wch:28},{wch:14},{wch:18}];
    XL.utils.book_append_sheet(WB, ws, 'Masraf Kayıtları');
    var byK={};
    masrafData.forEach(function(m){ var k=m.kategori||'Diğer'; if(!byK[k])byK[k]={k:k,n:0,t:0}; byK[k].n++;byK[k].t+=m.tutar||0; });
    var kr=[['Kategori','Kayıt Sayısı','Toplam (₺)']];
    Object.values(byK).sort(function(a,b){return b.t-a.t;}).forEach(function(k){kr.push([k.k,k.n,k.t]);});
    var ws2 = XL.utils.aoa_to_sheet(kr);
    ws2['!cols'] = [{wch:22},{wch:14},{wch:16}];
    XL.utils.book_append_sheet(WB, ws2, 'Kategori Özeti');
    XL.writeFile(WB, 'masraf_raporu_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

/* ── Yakıt Excel ── */
async function downloadFuelExcel() {
  var allE=[];
  Object.entries(fuelData).forEach(function(kv){ kv[1].forEach(function(e){ allE.push(Object.assign({},e,{_vid:kv[0]})); }); });
  if (!allE.length) { showToast('İndirilecek yakıt kaydı yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var pm={};vehicles.forEach(function(v){pm[v.id]=v.plaka||v.id;});
    var fmtD = function(d){ return d ? d.split('-').reverse().join('.') : '—'; };
    var rows=[['Araç Plakası','Tarih','Km','Litre','Birim Fiyat (₺)','Toplam (₺)','Not']];
    allE.sort(function(a,b){return (b.tarih||'').localeCompare(a.tarih||'');}).forEach(function(e){
      var t=(e.fiyat&&e.litre)?+(e.fiyat*e.litre).toFixed(2):'';
      rows.push([pm[e._vid]||e._vid,fmtD(e.tarih),e.km||'',e.litre||'',e.fiyat||'',t,e.not||'']);
    });
    var ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:14},{wch:12},{wch:10},{wch:10},{wch:16},{wch:12},{wch:22}];
    XL.utils.book_append_sheet(WB, ws, 'Yakıt Kayıtları');
    var ar=[['Araç Plakası','Dolum Sayısı','Toplam Litre','Toplam Maliyet (₺)']];
    Object.entries(fuelData).forEach(function(kv){
      var en=kv[1]; if(!en.length)return;
      var lt=en.reduce(function(a,e){return a+(e.litre||0);},0);
      var tt=en.reduce(function(a,e){return a+(e.fiyat?e.fiyat*e.litre:0);},0);
      ar.push([pm[kv[0]]||kv[0],en.length,+lt.toFixed(2),+tt.toFixed(2)]);
    });
    var ws2 = XL.utils.aoa_to_sheet(ar);
    ws2['!cols'] = [{wch:14},{wch:14},{wch:14},{wch:18}];
    XL.utils.book_append_sheet(WB, ws2, 'Araç Özeti');
    XL.writeFile(WB, 'yakit_raporu_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

/* ── Bakım/Arıza Excel ── */
async function downloadMaintExcel() {
  var allE=[];
  vehicles.forEach(function(v){ (maintData[v.id]||[]).forEach(function(e){ allE.push(Object.assign({},e,{plaka:v.plaka||v.id})); }); });
  if (!allE.length) { showToast('İndirilecek bakım/arıza kaydı yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var fmtD = function(d){ return d ? d.split('-').reverse().join('.') : '—'; };
    var rows=[['Araç Plakası','Tarih','Tür','Açıklama','Km','Maliyet (₺)','Sonraki Tarih','Servis']];
    allE.sort(function(a,b){return (b.tarih||'').localeCompare(a.tarih||'');}).forEach(function(e){
      rows.push([e.plaka,fmtD(e.tarih),e.tur||'—',e.aciklama||'—',e.km||'',e.maliyet||'',fmtD(e.sonraki_tarih),e.servis||'']);
    });
    rows.push(['TOPLAM','','','','',allE.reduce(function(a,e){return a+(e.maliyet||0);},0),'','']);
    var ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:14},{wch:12},{wch:14},{wch:28},{wch:10},{wch:14},{wch:14},{wch:22}];
    XL.utils.book_append_sheet(WB, ws, 'Bakım-Arıza Kayıtları');
    var byA={};
    allE.forEach(function(e){ if(!byA[e.plaka])byA[e.plaka]={p:e.plaka,n:0,t:0}; byA[e.plaka].n++;byA[e.plaka].t+=e.maliyet||0; });
    var ar=[['Araç','Kayıt Sayısı','Toplam Maliyet (₺)']];
    Object.values(byA).sort(function(a,b){return b.t-a.t;}).forEach(function(a){ar.push([a.p,a.n,a.t]);});
    var ws2 = XL.utils.aoa_to_sheet(ar);
    ws2['!cols'] = [{wch:14},{wch:14},{wch:18}];
    XL.utils.book_append_sheet(WB, ws2, 'Araç Özeti');
    XL.writeFile(WB, 'bakim_ariza_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

/* ── Sürücü Belgeleri Excel ── */
async function downloadDriverExcel() {
  if (!driverData || driverData.length === 0) { showToast('İndirilecek sürücü kaydı yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var fmtD = function(d){ return d ? d.split('-').reverse().join('.') : '—'; };
    var today = new Date(); today.setHours(0,0,0,0);
    var gun = function(d){ if(!d)return null; var t=new Date(d);t.setHours(0,0,0,0);return Math.round((t-today)/86400000); };
    var dur = function(d){ if(!d)return '—'; var g=gun(d); return g<0?'GEÇMİŞ':g<=30?'UYARI('+g+'g)':'Geçerli('+g+'g)'; };
    var rows=[['Ad Soyad','Telefon','Araç','Ehliyet Bitiş','Ehliyet Durum','SRC Bitiş','SRC Durum','Psiko Bitiş','Psiko Durum','Takoğraf Bitiş','Takoğraf Durum']];
    driverData.forEach(function(d){ rows.push([d.ad||'—',d.tel||'—',d.plaka||'—',fmtD(d.ehliyet),dur(d.ehliyet),fmtD(d.src),dur(d.src),fmtD(d.psiko),dur(d.psiko),fmtD(d.takograf),dur(d.takograf)]); });
    var ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:20},{wch:14},{wch:14},{wch:14},{wch:18},{wch:14},{wch:18},{wch:14},{wch:18},{wch:14},{wch:18}];
    XL.utils.book_append_sheet(WB, ws, 'Sürücü Belgeleri');
    var kr=[['Ad Soyad','Araç','Belge','Bitiş Tarihi','Kalan Gün']];
    driverData.forEach(function(d){
      [{tur:'Ehliyet',t:d.ehliyet},{tur:'SRC',t:d.src},{tur:'Psiko',t:d.psiko},{tur:'Takoğraf',t:d.takograf}].forEach(function(b){
        if(!b.t)return; var g=gun(b.t); if(g!==null&&g<=60)kr.push([d.ad||'—',d.plaka||'—',b.tur,fmtD(b.t),g]);
      });
    });
    if(kr.length===1)kr.push(['Kritik belge yok','','','','']);
    var ws2 = XL.utils.aoa_to_sheet(kr);
    ws2['!cols'] = [{wch:20},{wch:14},{wch:14},{wch:14},{wch:12}];
    XL.utils.book_append_sheet(WB, ws2, 'Kritik Belgeler');
    XL.writeFile(WB, 'surucu_belgeleri_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

/* ── Kapsamlı Rapor Excel ── */
async function downloadRaporExcel() {
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var donem = document.getElementById('rapor-donem')?.value||'all';
    var flt = function(e){ return !donem||donem==='all'||!e.tarih||e.tarih.startsWith(donem); };
    var sf=seferData.filter(flt), mf=masrafData.filter(flt);
    var yf=Object.values(fuelData).flat().filter(flt), bf=Object.values(maintData).flat().filter(flt);
    if(!sf.length&&!mf.length&&!yf.length&&!bf.length){ showToast('Seçili dönemde veri yok.','error');return; }
    var ciro=sf.reduce(function(a,s){return a+(s.ucret||0);},0);
    var yakit=yf.reduce(function(a,e){return a+(e.fiyat?e.fiyat*e.litre:0);},0);
    var bakim=bf.reduce(function(a,e){return a+(e.maliyet||0);},0);
    var masraf=mf.reduce(function(a,m){return a+(m.tutar||0);},0);
    var gider=yakit+bakim+masraf;
    var ozet=[['Metrik','Değer'],['Toplam Ciro (₺)',ciro],['Yakıt Gideri (₺)',yakit],['Bakım Gideri (₺)',bakim],['Diğer Masraf (₺)',masraf],['Toplam Gider (₺)',gider],['Net Kâr/Zarar (₺)',ciro-gider],['Sefer Sayısı',sf.length],['Toplam km',sf.reduce(function(a,s){return a+(s.km||0);},0)]];
    var ws0 = XL.utils.aoa_to_sheet(ozet);
    ws0['!cols'] = [{wch:24},{wch:16}];
    XL.utils.book_append_sheet(WB, ws0, 'Genel Özet');
    var now=new Date(); var aylar=[];
    for(var i=11;i>=0;i--){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); aylar.push({k:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),l:d.toLocaleDateString('tr-TR',{month:'long',year:'numeric'})}); }
    var ayr=[['Dönem','Sefer','Ciro (₺)','Yakıt (₺)','Bakım (₺)','Masraf (₺)','Net (₺)']];
    aylar.forEach(function(m){
      var s2=seferData.filter(function(x){return x.tarih&&x.tarih.startsWith(m.k);});
      var m2=masrafData.filter(function(x){return x.tarih&&x.tarih.startsWith(m.k);});
      var y2=Object.values(fuelData).flat().filter(function(x){return x.tarih&&x.tarih.startsWith(m.k);});
      var b2=Object.values(maintData).flat().filter(function(x){return x.tarih&&x.tarih.startsWith(m.k);});
      var c2=s2.reduce(function(a,s){return a+(s.ucret||0);},0);
      var ya2=y2.reduce(function(a,e){return a+(e.fiyat?e.fiyat*e.litre:0);},0);
      var ba2=b2.reduce(function(a,e){return a+(e.maliyet||0);},0);
      var ma2=m2.reduce(function(a,x){return a+(x.tutar||0);},0);
      ayr.push([m.l,s2.length,c2,ya2,ba2,ma2,c2-(ya2+ba2+ma2)]);
    });
    var ws1 = XL.utils.aoa_to_sheet(ayr);
    ws1['!cols'] = [{wch:22},{wch:8},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12}];
    XL.utils.book_append_sheet(WB, ws1, 'Aylık Trend');
    XL.writeFile(WB, 'yonetim_raporu_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

// Başlangıçta yerel verilerden hızlı gösterim (auth sonrası loadVehicles içinde buluttan güncellenir)
loadFuelData().then(() => { updateFuelStat(); updateFuelSummaryPanel(); });
loadMaintData().then(() => { updateMaintStat(); });
loadDriverData().then(() => { updateDriverStat(); });
loadSeferData();
loadMasrafData();
