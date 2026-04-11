/* ================================================================
   SEFER TAKİBİ
   ================================================================ */
let seferData = [];

async function loadSeferData() {
  // Önce localStorage'dan yükle (anlık gösterim için)
  try { seferData = JSON.parse(localStorage.getItem('filo_sefer') || '[]'); }
  catch { seferData = []; }

  if (isLocalMode()) { updateSeferStat(); return; }

  // Auth token hazır değilse bulut isteği atma (RLS boş döndürür)
  if (!_authToken) { updateSeferStat(); return; }

  try {
    const res = await fetch(sbUrl('seferler?select=*&order=tarih.desc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('Seferler yüklenemedi: ' + res.status);
    const rows = await res.json();
    seferData = rows.map(r => ({
      id      : r.id,
      tarih   : r.tarih,
      aracId  : r.arac_id || '',
      plaka   : r.plaka   || '',
      sofor   : r.sofor   || '',
      kalkis  : r.kalkis  || '',
      varis   : r.varis   || '',
      km      : r.km      || 0,
      yuk     : r.yuk     || '',
      ucret   : r.ucret   || 0,
      not     : r.notlar  || '',
      _opsId  : r.ops_id  || null,
    }));
    localStorage.setItem('filo_sefer', JSON.stringify(seferData));
  } catch (err) {
    console.warn('Seferler Supabase hatası, localStorage kullanılıyor:', err);
  }
  updateSeferStat();
}

async function saveSeferData() {
  localStorage.setItem('filo_sefer', JSON.stringify(seferData));
}

async function saveSeferEntryCloud(entry) {
  if (isLocalMode()) return;
  try {
    const { data: { user } } = await getSB().auth.getUser();
    if (!user) return;
    const row = {
      id      : entry.id,
      user_id : user.id,
      firma_id: currentFirmaId || null,
      tarih   : entry.tarih,
      arac_id : entry.aracId  || null,
      plaka   : entry.plaka   || null,
      sofor   : entry.sofor   || null,
      kalkis  : entry.kalkis,
      varis   : entry.varis,
      km      : entry.km      || null,
      yuk     : entry.yuk     || null,
      ucret   : entry.ucret   || null,
      notlar  : entry.not     || null,
      ops_id  : entry._opsId  || null,
    };
    const res = await fetch(sbUrl('seferler'), {
      method : 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify(row)
    });
    if (!res.ok) { const e = await res.text(); throw new Error(e); }
  } catch (err) { console.error('Sefer buluta kaydedilemedi:', err); showToast('Sefer yerel kaydedildi (bulut hatası).', 'error'); }
}

async function deleteSeferEntryCloud(id) {
  if (isLocalMode()) return;
  try {
    await fetch(sbUrl('seferler?id=eq.' + id), { method: 'DELETE', headers: sbHeaders() });
  } catch (err) { console.error('Sefer buluttan silinemedi:', err); }
}

function openSeferModal() {
  _fillSeferAracSelect();
  document.getElementById('f-sefer-tarih').value = new Date().toISOString().slice(0,10);
  document.getElementById('f-sefer-id').value = '';
  switchSeferTab('liste');
  renderSeferTable();
  renderSeferStats();
  document.getElementById('sefer-backdrop').classList.remove('hidden');
}
function closeSeferModal() { document.getElementById('sefer-backdrop').classList.add('hidden'); }
function closeSeferModalBackdrop(e) { if(e.target.id==='sefer-backdrop') closeSeferModal(); }

function switchSeferTab(t) {
  ['liste','ekle','ozet'].forEach(n => {
    document.getElementById('sefer-tab-'+n)?.classList.toggle('active', n===t);
    document.getElementById('sefer-panel-'+n)?.classList.toggle('active', n===t);
  });
  if(t==='ozet') renderSeferOzet();
  if(t==='liste') renderSeferTable();
}

function _fillSeferAracSelect() {
  const sel = document.getElementById('f-sefer-arac');
  if(!sel) return;
  sel.innerHTML = '<option value="">— Araç Seçin —</option>' +
    vehicles.map(v=>`<option value="${v.id}">${v.plaka}${v.sofor?' · '+v.sofor:''}</option>`).join('');
}

function saveSeferEntry() {
  const tarih   = document.getElementById('f-sefer-tarih').value;
  const aracId  = document.getElementById('f-sefer-arac').value;
  const sofor   = document.getElementById('f-sefer-sofor').value.trim();
  const kalkis  = document.getElementById('f-sefer-kalkis').value.trim();
  const varis   = document.getElementById('f-sefer-varis').value.trim();
  const km      = parseFloat(document.getElementById('f-sefer-km').value)||0;
  const yuk     = document.getElementById('f-sefer-yuk').value.trim();
  const ucret   = parseFloat(document.getElementById('f-sefer-ucret').value)||0;
  const not     = document.getElementById('f-sefer-not').value.trim();
  const eid     = document.getElementById('f-sefer-id').value;

  if(!tarih||!kalkis||!varis){ showToast('Tarih, Kalkış ve Varış zorunludur.','error'); return; }

  const veh = vehicles.find(v=>v.id===aracId);
  const entry = { id: eid||uid(), tarih, aracId, plaka: veh?.plaka||'', sofor: sofor||(veh?.sofor||''), kalkis, varis, km, yuk, ucret, not };

  if(eid) { const i=seferData.findIndex(s=>s.id===eid); if(i!==-1) seferData[i]=entry; }
  else seferData.push(entry);

  saveSeferData();
  saveSeferEntryCloud(entry);
  updateSeferStat();

  // Aktivite logu
  const _sefDetail = kalkis + ' → ' + varis + (ucret ? ' · ' + ucret.toLocaleString('tr-TR') + ' ₺' : '');
  addActivity(eid ? 'sefer_düzenle' : 'sefer_ekle', entry.plaka || '—', _sefDetail);

  document.getElementById('f-sefer-id').value='';
  // formu sıfırla
  ['f-sefer-arac','f-sefer-sofor','f-sefer-kalkis','f-sefer-varis','f-sefer-km','f-sefer-yuk','f-sefer-ucret','f-sefer-not'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  showToast('Sefer kaydedildi ✓','success');
  switchSeferTab('liste');
}

function deleteSeferEntry(id) {
  if(!confirm('Bu sefer kaydını silmek istiyor musunuz?')) return;
  const _sefDel = seferData.find(s=>s.id===id);
  seferData = seferData.filter(s=>s.id!==id);
  saveSeferData();
  deleteSeferEntryCloud(id);
  addActivity('sefer_sil', _sefDel?.plaka || '—', (_sefDel?.kalkis||'') + (_sefDel?.varis ? ' → ' + _sefDel.varis : ''));
  updateSeferStat(); renderSeferTable(); renderSeferStats();
  showToast('Sefer silindi.','error');
}

function renderSeferTable() {
  const tbody = document.getElementById('sefer-table-body');
  if(!tbody) return;
  const sorted = [...seferData].sort((a,b)=>b.tarih.localeCompare(a.tarih));
  if(sorted.length===0){
    tbody.innerHTML=`<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--muted)">Henüz sefer kaydı yok. ➕ Yeni Sefer sekmesinden ekleyin.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(s=>`
    <tr>
      <td>${fmtDate(s.tarih)}</td>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${s.plaka||'—'}</span></td>
      <td>${s.sofor||'—'}</td>
      <td>${s.kalkis}</td>
      <td>${s.varis}</td>
      <td style="font-family:var(--font-mono);color:var(--blue)">${s.km?s.km.toLocaleString('tr')+' km':'—'}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${s.yuk||'—'}</td>
      <td style="font-family:var(--font-mono);color:var(--green);font-weight:700">${s.ucret?'₺'+s.ucret.toLocaleString('tr',{minimumFractionDigits:0}):'—'}</td>
      <td style="color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis">
        ${s._opsId ? `<span title="Konteyner Operasyonu #${s._opsId}" style="display:inline-flex;align-items:center;gap:3px;background:rgba(249,115,22,.12);color:var(--accent);font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:4px;margin-bottom:2px;cursor:pointer;" onclick="closeSeferModal();setTimeout(()=>{ openOperasyonPage(); setTimeout(()=>openOpsDrawer(${s._opsId}),600); },100)">📦 Ops #${s._opsId}</span><br>` : ''}
        ${s.not||''}
      </td>
      <td><button class="srm-del-btn" onclick="deleteSeferEntry('${s.id}')">✕</button></td>
    </tr>`).join('');
}

function renderSeferStats() {
  const el = document.getElementById('sefer-stats-row');
  if(!el) return;
  const toplamSefer = seferData.length;
  const toplamKm    = seferData.reduce((a,s)=>a+(s.km||0),0);
  const toplamUcret = seferData.reduce((a,s)=>a+(s.ucret||0),0);
  const buAy = new Date().toISOString().slice(0,7);
  const buAySeferler = seferData.filter(s=>s.tarih&&s.tarih.startsWith(buAy));
  const buAyUcret = buAySeferler.reduce((a,s)=>a+(s.ucret||0),0);
  el.innerHTML = [
    {val:toplamSefer, lbl:'Toplam Sefer', color:'var(--purple)'},
    {val:toplamKm.toLocaleString('tr')+' km', lbl:'Toplam Mesafe', color:'var(--blue)'},
    {val:'₺'+toplamUcret.toLocaleString('tr',{minimumFractionDigits:0}), lbl:'Toplam Ciro', color:'var(--green)'},
    {val:'₺'+buAyUcret.toLocaleString('tr',{minimumFractionDigits:0}), lbl:'Bu Ay Ciro', color:'var(--accent)'},
  ].map(s=>`<div class="srm-stat"><div class="srm-stat-val" style="color:${s.color}">${s.val}</div><div class="srm-stat-lbl">${s.lbl}</div></div>`).join('');
}

function renderSeferOzet() {
  const el = document.getElementById('sefer-ozet-content');
  if(!el) return;
  // Araç bazlı özet
  const byArac = {};
  seferData.forEach(s=>{
    if(!byArac[s.aracId]) byArac[s.aracId]={plaka:s.plaka||s.aracId,sefer:0,km:0,ucret:0};
    byArac[s.aracId].sefer++;
    byArac[s.aracId].km += s.km||0;
    byArac[s.aracId].ucret += s.ucret||0;
  });
  const rows = Object.values(byArac).sort((a,b)=>b.ucret-a.ucret);
  const maxUcret = rows[0]?.ucret||1;
  el.innerHTML = `
    <div class="rapor-card" style="margin-bottom:16px">
      <div class="rapor-card-title" style="color:var(--purple)">🚛 Araç Bazlı Sefer Özeti</div>
      ${rows.length===0?'<p style="color:var(--muted);font-size:13px">Henüz sefer kaydı yok.</p>':
        rows.map(r=>`
        <div class="rapor-row">
          <div>
            <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:13px">${r.plaka}</div>
            <div style="color:var(--muted);font-size:11px">${r.sefer} sefer · ${r.km.toLocaleString('tr')} km</div>
            <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${Math.round(r.ucret/maxUcret*100)}%;background:linear-gradient(90deg,var(--purple),#c4b5fd)"></div></div>
          </div>
          <div class="rapor-row-val" style="color:var(--green)">₺${r.ucret.toLocaleString('tr',{minimumFractionDigits:0})}</div>
        </div>`).join('')}
    </div>`;
}

function updateSeferStat() {
  const toplam   = seferData.length;
  const toplamKm = seferData.reduce((a,s) => a + (s.km||0), 0);
  const toplamCiro = seferData.reduce((a,s) => a + (s.ucret||0), 0);
  const ortUcret = toplam > 0 ? toplamCiro / toplam : 0;
  const buAy = new Date().toISOString().slice(0,7);
  const buAySayisi = seferData.filter(s => s.tarih && s.tarih.startsWith(buAy)).length;

  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('stat-sefer-toplam', toplam.toLocaleString('tr-TR'));
  set('stat-sefer-ciro',   toplamCiro > 0 ? '₺' + toplamCiro.toLocaleString('tr-TR', {maximumFractionDigits:0}) : '—');
  set('stat-sefer-km',     toplamKm > 0 ? toplamKm.toLocaleString('tr-TR') + ' km' : '—');
  set('stat-sefer-ort',    ortUcret > 0 ? '₺' + ortUcret.toLocaleString('tr-TR', {maximumFractionDigits:0}) : '—');

  const trendEl = document.getElementById('trend-sefer');
  if (trendEl) {
    trendEl.textContent = 'Bu ay: ' + buAySayisi + ' sefer';
    trendEl.className = buAySayisi > 0 ? 'stat-trend ok' : 'stat-trend warn';
  }

  // Rapor kartını da güncelle
  updateRaporStat();
}

