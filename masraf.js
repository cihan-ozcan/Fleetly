/* ================================================================
   MASRAF TAKİBİ
   ================================================================ */
let masrafData = [];

async function loadMasrafData() {
  try { masrafData = JSON.parse(localStorage.getItem('filo_masraf') || '[]'); }
  catch { masrafData = []; }

  if (isLocalMode()) { updateMasrafStat(); return; }

  // Auth token hazır değilse bulut isteği atma (RLS boş döndürür)
  if (!_authToken) { updateMasrafStat(); return; }

  try {
    const res = await fetch(sbUrl('masraflar?select=*&order=tarih.desc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('Masraflar yüklenemedi: ' + res.status);
    const rows = await res.json();
    masrafData = rows.map(r => ({
      id       : r.id,
      tarih    : r.tarih,
      aracId   : r.arac_id   || '',
      plaka    : r.plaka     || 'Genel',
      kategori : r.kategori  || '',
      tutar    : r.tutar     || 0,
      makbuz   : r.makbuz    || '',
      aciklama : r.aciklama  || '',
    }));
    localStorage.setItem('filo_masraf', JSON.stringify(masrafData));
  } catch (err) {
    console.warn('Masraflar Supabase hatası, localStorage kullanılıyor:', err);
  }
  updateMasrafStat();
}

async function saveMasrafData() {
  localStorage.setItem('filo_masraf', JSON.stringify(masrafData));
}

async function saveMasrafEntryCloud(entry) {
  if (isLocalMode()) return;
  try {
    const { data: { user } } = await getSB().auth.getUser();
    if (!user) return;
    const row = {
      id       : entry.id,
      user_id  : user.id,
      firma_id : currentFirmaId || null,
      tarih    : entry.tarih,
      arac_id  : entry.aracId  || null,
      plaka    : entry.plaka   || null,
      kategori : entry.kategori,
      tutar    : entry.tutar,
      makbuz   : entry.makbuz  || null,
      aciklama : entry.aciklama|| null,
    };
    const res = await fetch(sbUrl('masraflar'), {
      method : 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify(row)
    });
    if (!res.ok) { const e = await res.text(); throw new Error(e); }
  } catch (err) { console.error('Masraf buluta kaydedilemedi:', err); showToast('Masraf yerel kaydedildi (bulut hatası).', 'error'); }
}

async function deleteMasrafEntryCloud(id) {
  if (isLocalMode()) return;
  try {
    await fetch(sbUrl('masraflar?id=eq.' + id), { method: 'DELETE', headers: sbHeaders() });
  } catch (err) { console.error('Masraf buluttan silinemedi:', err); }
}

function openMasrafModal() {
  _fillMasrafAracSelect();
  document.getElementById('f-masraf-tarih').value = new Date().toISOString().slice(0,10);
  document.getElementById('f-masraf-id').value = '';
  switchMasrafTab('liste');
  renderMasrafTable();
  renderMasrafStats();
  document.getElementById('masraf-backdrop').classList.remove('hidden');
}
function closeMasrafModal() { document.getElementById('masraf-backdrop').classList.add('hidden'); }
function closeMasrafModalBackdrop(e) { if(e.target.id==='masraf-backdrop') closeMasrafModal(); }

function switchMasrafTab(t) {
  ['liste','ekle','ozet'].forEach(n=>{
    document.getElementById('masraf-tab-'+n)?.classList.toggle('active',n===t);
    document.getElementById('masraf-panel-'+n)?.classList.toggle('active',n===t);
  });
  if(t==='ozet') renderMasrafOzet();
  if(t==='liste') renderMasrafTable();
}

function _fillMasrafAracSelect() {
  const sel = document.getElementById('f-masraf-arac');
  if(!sel) return;
  sel.innerHTML = '<option value="">— Tüm Filo —</option>' +
    vehicles.map(v=>`<option value="${v.id}">${v.plaka}${v.sofor?' · '+v.sofor:''}</option>`).join('');
}

function saveMasrafEntry() {
  const tarih     = document.getElementById('f-masraf-tarih').value;
  const aracId    = document.getElementById('f-masraf-arac').value;
  const kategori  = document.getElementById('f-masraf-kategori').value;
  const tutar     = parseFloat(document.getElementById('f-masraf-tutar').value)||0;
  const makbuz    = document.getElementById('f-masraf-makbuz').value.trim();
  const aciklama  = document.getElementById('f-masraf-aciklama').value.trim();
  const eid       = document.getElementById('f-masraf-id').value;

  if(!tarih||!kategori||tutar<=0){ showToast('Tarih, Kategori ve Tutar zorunludur.','error'); return; }

  const veh = vehicles.find(v=>v.id===aracId);
  const entry = { id: eid||uid(), tarih, aracId, plaka: veh?.plaka||'Genel', kategori, tutar, makbuz, aciklama };

  if(eid) { const i=masrafData.findIndex(m=>m.id===eid); if(i!==-1) masrafData[i]=entry; }
  else masrafData.push(entry);

  saveMasrafData();
  saveMasrafEntryCloud(entry);
  updateMasrafStat();

  // Aktivite logu
  const _masDetail = kategori + ' · ' + tutar.toLocaleString('tr-TR') + ' ₺' + (aciklama ? ' · ' + aciklama.slice(0,30) : '');
  addActivity(eid ? 'masraf_düzenle' : 'masraf_ekle', entry.plaka || 'Genel', _masDetail);

  document.getElementById('f-masraf-id').value='';
  ['f-masraf-arac','f-masraf-kategori','f-masraf-tutar','f-masraf-makbuz','f-masraf-aciklama'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  showToast('Masraf kaydedildi ✓','success');
  switchMasrafTab('liste');
}

function deleteMasrafEntry(id) {
  if(!confirm('Bu masraf kaydını silmek istiyor musunuz?')) return;
  const _masDel = masrafData.find(m=>m.id===id);
  masrafData = masrafData.filter(m=>m.id!==id);
  saveMasrafData();
  deleteMasrafEntryCloud(id);
  addActivity('masraf_sil', _masDel?.plaka || 'Genel', (_masDel?.kategori||'') + (_masDel?.tutar ? ' · ' + _masDel.tutar.toLocaleString('tr-TR') + ' ₺' : ''));
  updateMasrafStat(); renderMasrafTable(); renderMasrafStats();
  showToast('Masraf silindi.','error');
}

const MASRAF_ICONS = {
  'Otoyol / Köprü':'🛣','Lastik':'🔄','Ceza':'🚔','Hasar / Tamir':'🔨',
  'Yıkama':'🫧','Konaklama':'🏨','Yemek / Gündelik':'🍽','Diğer':'📋'
};

function renderMasrafTable() {
  const tbody = document.getElementById('masraf-table-body');
  if(!tbody) return;
  const sorted = [...masrafData].sort((a,b)=>b.tarih.localeCompare(a.tarih));
  if(sorted.length===0){
    tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted)">Henüz masraf kaydı yok. ➕ Yeni Masraf sekmesinden ekleyin.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(m=>`
    <tr>
      <td>${fmtDate(m.tarih)}</td>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${m.plaka||'Genel'}</span></td>
      <td><span style="background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11.5px">${(MASRAF_ICONS[m.kategori]||'📋')+' '+m.kategori}</span></td>
      <td style="color:var(--text2)">${m.aciklama||'—'}</td>
      <td style="font-family:var(--font-mono);color:var(--red);font-weight:700">₺${m.tutar.toLocaleString('tr',{minimumFractionDigits:2})}</td>
      <td style="color:var(--muted);font-size:12px">${m.makbuz||'—'}</td>
      <td><button class="srm-del-btn" onclick="deleteMasrafEntry('${m.id}')">✕</button></td>
    </tr>`).join('');
}

function renderMasrafStats() {
  const el = document.getElementById('masraf-stats-row');
  if(!el) return;
  const toplam = masrafData.reduce((a,m)=>a+(m.tutar||0),0);
  const buAy   = new Date().toISOString().slice(0,7);
  const buAyT  = masrafData.filter(m=>m.tarih&&m.tarih.startsWith(buAy)).reduce((a,m)=>a+(m.tutar||0),0);
  const byKat  = {};
  masrafData.forEach(m=>{ byKat[m.kategori]=(byKat[m.kategori]||0)+(m.tutar||0); });
  const topKat = Object.entries(byKat).sort((a,b)=>b[1]-a[1])[0];
  el.innerHTML = [
    {val:'₺'+toplam.toLocaleString('tr',{minimumFractionDigits:0}), lbl:'Toplam Masraf', color:'var(--red)'},
    {val:'₺'+buAyT.toLocaleString('tr',{minimumFractionDigits:0}), lbl:'Bu Ay', color:'var(--yellow)'},
    {val:masrafData.length, lbl:'Kayıt Sayısı', color:'var(--blue)'},
    {val:topKat?(MASRAF_ICONS[topKat[0]]||'📋')+' '+topKat[0]:'—', lbl:'En Yüksek Kategori', color:'var(--text2)'},
  ].map(s=>`<div class="srm-stat"><div class="srm-stat-val" style="color:${s.color};font-size:${s.val.toString().length>10?'14px':'22px'}">${s.val}</div><div class="srm-stat-lbl">${s.lbl}</div></div>`).join('');
}

function renderMasrafOzet() {
  const el = document.getElementById('masraf-ozet-content');
  if(!el) return;
  // Araç bazlı masraf
  const byArac = {};
  masrafData.forEach(m=>{
    const key = m.plaka||'Genel';
    if(!byArac[key]) byArac[key]={plaka:key,tutar:0,count:0};
    byArac[key].tutar += m.tutar||0;
    byArac[key].count++;
  });
  const aracRows = Object.values(byArac).sort((a,b)=>b.tutar-a.tutar);
  const maxArac  = aracRows[0]?.tutar||1;

  // Kategori bazlı masraf
  const byKat = {};
  masrafData.forEach(m=>{
    if(!byKat[m.kategori]) byKat[m.kategori]={kat:m.kategori,tutar:0,count:0};
    byKat[m.kategori].tutar += m.tutar||0;
    byKat[m.kategori].count++;
  });
  const katRows = Object.values(byKat).sort((a,b)=>b.tutar-a.tutar);
  const maxKat  = katRows[0]?.tutar||1;

  el.innerHTML = `
  <div class="rapor-grid">
    <div class="rapor-card">
      <div class="rapor-card-title" style="color:var(--yellow)">🚛 Araç Bazlı Masraf</div>
      ${aracRows.length===0?'<p style="color:var(--muted);font-size:13px">Veri yok.</p>':
        aracRows.map(r=>`
        <div class="rapor-row">
          <div>
            <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${r.plaka}</div>
            <div style="color:var(--muted);font-size:11px">${r.count} kayıt</div>
            <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${Math.round(r.tutar/maxArac*100)}%;background:linear-gradient(90deg,var(--yellow),#fcd34d)"></div></div>
          </div>
          <div class="rapor-row-val" style="color:var(--red)">₺${r.tutar.toLocaleString('tr',{minimumFractionDigits:0})}</div>
        </div>`).join('')}
    </div>
    <div class="rapor-card">
      <div class="rapor-card-title" style="color:var(--red)">📋 Kategori Bazlı Masraf</div>
      ${katRows.length===0?'<p style="color:var(--muted);font-size:13px">Veri yok.</p>':
        katRows.map(r=>`
        <div class="rapor-row">
          <div>
            <div style="font-weight:600">${(MASRAF_ICONS[r.kat]||'📋')+' '+r.kat}</div>
            <div style="color:var(--muted);font-size:11px">${r.count} kayıt</div>
            <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${Math.round(r.tutar/maxKat*100)}%;background:linear-gradient(90deg,var(--red),#f87171)"></div></div>
          </div>
          <div class="rapor-row-val" style="color:var(--red)">₺${r.tutar.toLocaleString('tr',{minimumFractionDigits:0})}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

function updateMasrafStat() {
  const toplam = masrafData.length;
  const toplamTutar = masrafData.reduce((a,m) => a + (m.tutar||0), 0);
  const buAy = new Date().toISOString().slice(0,7);
  const buAyTutar = masrafData.filter(m => m.tarih && m.tarih.startsWith(buAy)).reduce((a,m) => a + (m.tutar||0), 0);

  // En büyük kategori
  const byKat = {};
  masrafData.forEach(m => { byKat[m.kategori] = (byKat[m.kategori]||0) + (m.tutar||0); });
  const topKat = Object.entries(byKat).sort((a,b) => b[1]-a[1])[0];

  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('stat-masraf-toplam',   toplam.toLocaleString('tr-TR'));
  set('stat-masraf-tutar',    toplamTutar > 0 ? '₺' + toplamTutar.toLocaleString('tr-TR', {maximumFractionDigits:0}) : '—');
  set('stat-masraf-kategori', topKat ? topKat[0] : '—');

  const trendEl = document.getElementById('trend-masraf');
  if (trendEl) {
    trendEl.textContent = 'Bu ay: ' + (buAyTutar > 0 ? '₺' + buAyTutar.toLocaleString('tr-TR', {maximumFractionDigits:0}) : '—');
    trendEl.className = buAyTutar > 0 ? 'stat-trend warn' : 'stat-trend ok';
  }

  // Rapor kartını da güncelle
  updateRaporStat();
}

function updateRaporStat() {
  const toplamCiro  = seferData.reduce((a,s) => a + (s.ucret||0), 0);
  const toplamYakit = Object.values(fuelData).flat().reduce((a,e) => a + (e.fiyat ? e.fiyat*e.litre : 0), 0);
  const toplamBakim = Object.values(maintData).flat().reduce((a,e) => a + (e.maliyet||0), 0);
  const toplamMasraf = masrafData.reduce((a,m) => a + (m.tutar||0), 0);
  const toplamGider = toplamYakit + toplamBakim + toplamMasraf;
  const netKar = toplamCiro - toplamGider;

  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('stat-rapor-ciro',  toplamCiro > 0  ? '₺' + toplamCiro.toLocaleString('tr-TR', {maximumFractionDigits:0})  : '—');
  set('stat-rapor-gider', toplamGider > 0 ? '₺' + toplamGider.toLocaleString('tr-TR', {maximumFractionDigits:0}) : '—');

  const karEl = document.getElementById('stat-rapor-kar');
  if (karEl) {
    if (toplamCiro === 0 && toplamGider === 0) {
      karEl.textContent = '—';
      karEl.style.color = '#e879f9';
    } else {
      karEl.textContent = (netKar >= 0 ? '+' : '') + '₺' + Math.abs(netKar).toLocaleString('tr-TR', {maximumFractionDigits:0});
      karEl.style.color = netKar >= 0 ? 'var(--green)' : 'var(--red)';
    }
  }
}

function updateMusteriStat() {
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  const toplam = crmMusteriler.length;
  const aktif  = crmMusteriler.filter(m=>m.durum==='Aktif').length;
  const ciro   = crmSiparisler.filter(s=>s.durum!=='İptal').reduce((a,s)=>a+(s.tutar||0),0);
  set('stat-musteri-toplam', toplam || '—');
  set('stat-musteri-aktif',  aktif);
  set('stat-musteri-ciro',   ciro > 0 ? '₺'+ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}) : '—');
}

