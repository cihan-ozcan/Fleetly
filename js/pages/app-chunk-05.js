/* ===================================================================
   app-chunk-05.js — app.html içinden otomatik taşındı (Phase 4, mekanik)
   Orijinal konum: 12. <script> tag'i (app.html).
   İçerik AYNEN korunur; global değişkenler, fonksiyon isimleri,
   yükleme sırası değiştirilmedi. İleride modülerleştirilecek.
   ================================================================= */


/* ─── CRM SAYFA AÇ/KAPA ──────────────────────── */
async function openMusteriPage() {
  document.getElementById('crm-page').classList.add('open');
  document.body.style.overflow = 'hidden';
  await crmLoadData();
  crmRenderStats();
  crmRenderMusteriler();
}
function closeMusteriPage() {
  document.getElementById('crm-page').classList.remove('open');
  document.body.style.overflow = '';
}

/* ─── VERİ ─────────────────────────────────────── */
const CRM_COLORS = ['var(--accent)','#38bdf8','#22c55e','#a78bfa','#f59e0b','#ef4444','#06b6d4','#84cc16'];

let crmEditingMusteriId = null;
let crmMusteriler = [];
let crmSiparisler = [];

/* ─── SUPABASE CRM LOAD ─────────────────────────── */
async function crmLoadData() {
  // Önce localStorage'dan hızlı yükle
  try {
    const lsM = localStorage.getItem('crm_musteriler');
    const lsS = localStorage.getItem('crm_siparisler');
    if (lsM) crmMusteriler = JSON.parse(lsM);
    if (lsS) crmSiparisler = JSON.parse(lsS);
  } catch(e) {}

  if (isLocalMode() || !_authToken) {
    // Demo verisi yükle (ilk kullanım)
    if (!crmMusteriler.length) {
      crmMusteriler = [
        { id:1, firma:'Güven Taşımacılık', yetkili:'Hasan Güven', sektor:'Perakende', tel:'0532 111 22 33', email:'info@guven.com', adres:'Bağcılar, İstanbul', vkn:'1234567890', vade:30, durum:'Aktif', notlar:'VIP müşteri' },
        { id:2, firma:'Anadolu Market Zinciri', yetkili:'Fatma Çelik', sektor:'Gıda', tel:'0533 222 33 44', email:'lojistik@anadolu.com', adres:'Çerkezköy, Tekirdağ', vkn:'9876543210', vade:45, durum:'Aktif', notlar:'' },
        { id:3, firma:'Özkan İnşaat', yetkili:'Murat Özkan', sektor:'İnşaat', tel:'0544 333 44 55', email:'murat@ozkan.com', adres:'Esenyurt, İstanbul', vkn:'1111111111', vade:15, durum:'Aktif', notlar:'Nakit ödeme tercih eder' },
      ];
      crmSiparisler = [
        { id:'SIP-001', musteri_id:1, yukle:'İstanbul/Tuzla', teslim:'Ankara/Ostim', tarih:'2025-03-10', durum:'Teslim Edildi', tutar:18500, odeme:'Ödendi', yuk:'Paletli', agirlik:22, notlar:'' },
        { id:'SIP-002', musteri_id:2, yukle:'Tekirdağ/Çorlu', teslim:'İzmir/Torbalı', tarih:'2025-03-18', durum:'Teslim Edildi', tutar:24000, odeme:'Ödendi', yuk:'Dökme', agirlik:28, notlar:'' },
      ];
      crmSaveLocal();
    }
    updateMusteriStat();
    return;
  }

  try {
    // Müşterileri Supabase'den yükle
    const resM = await fetch(sbUrl('musteriler?select=*&order=created_at.desc'), { headers: sbHeaders() });
    if (resM.ok) {
      const rows = await resM.json();
      crmMusteriler = rows.map(r => ({
        id      : r.id,
        firma   : r.firma,
        yetkili : r.yetkili || '',
        sektor  : r.sektor  || 'Diğer',
        tel     : r.tel     || '',
        email   : r.email   || '',
        adres   : r.adres   || '',
        vkn     : r.vkn     || '',
        vade    : r.vade    || 30,
        durum   : r.durum   || 'Aktif',
        notlar  : r.notlar  || '',
      }));
      localStorage.setItem('crm_musteriler', JSON.stringify(crmMusteriler));
    }

    // Siparişleri Supabase'den yükle
    const resS = await fetch(sbUrl('siparisler?select=*&order=created_at.desc'), { headers: sbHeaders() });
    if (resS.ok) {
      const rows = await resS.json();
      crmSiparisler = rows.map(r => ({
        id         : r.id,
        musteri_id : r.musteri_id,
        yukle      : r.yukle   || '',
        teslim     : r.teslim  || '',
        tarih      : r.tarih   || '',
        durum      : r.durum   || 'Bekliyor',
        tutar      : r.tutar   || 0,
        odeme      : r.odeme   || 'Bekliyor',
        yuk        : r.yuk     || '',
        agirlik    : r.agirlik || 0,
        notlar     : r.notlar  || '',
      }));
      localStorage.setItem('crm_siparisler', JSON.stringify(crmSiparisler));
    }
  } catch(err) {
    console.warn('CRM Supabase hatası, localStorage kullanılıyor:', err);
  }
  updateMusteriStat();
}

function crmSaveLocal() {
  localStorage.setItem('crm_musteriler', JSON.stringify(crmMusteriler));
  localStorage.setItem('crm_siparisler', JSON.stringify(crmSiparisler));
}

async function crmSaveMusteriCloud(obj, isEdit) {
  if (isLocalMode() || !_authToken) return;
  try {
    const { data: { user } } = await getSB().auth.getUser();
    if (!user) return;
    const row = {
      firma_id : currentFirmaId || undefined,
      user_id  : user.id,
      firma    : obj.firma,
      yetkili  : obj.yetkili  || null,
      sektor   : obj.sektor   || 'Diğer',
      tel      : obj.tel      || null,
      email    : obj.email    || null,
      adres    : obj.adres    || null,
      vkn      : obj.vkn      || null,
      vade     : obj.vade     || 30,
      durum    : obj.durum    || 'Aktif',
      notlar   : obj.notlar   || null,
    };
    if (isEdit && typeof obj.id === 'number') {
      // Supabase'de bigint ID ile güncelle
      await fetch(sbUrl('musteriler?id=eq.' + obj.id), {
        method : 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body   : JSON.stringify(row)
      });
    } else {
      const res = await fetch(sbUrl('musteriler'), {
        method : 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body   : JSON.stringify(row)
      });
      if (res.ok) {
        const created = await res.json();
        if (created && created[0]) obj.id = created[0].id; // Supabase'den dönen gerçek ID
      }
    }
  } catch(err) { console.error('Müşteri buluta kaydedilemedi:', err); }
}

async function crmDeleteMusteriCloud(id) {
  if (isLocalMode() || !_authToken) return;
  try {
    await fetch(sbUrl('musteriler?id=eq.' + id), { method: 'DELETE', headers: sbHeaders() });
  } catch(err) { console.error('Müşteri buluttan silinemedi:', err); }
}

async function crmSaveSiparisCloud(obj, isEdit) {
  if (isLocalMode() || !_authToken) return;
  try {
    const { data: { user } } = await getSB().auth.getUser();
    if (!user) return;
    const row = {
      firma_id   : currentFirmaId || undefined,
      user_id    : user.id,
      musteri_id : obj.musteri_id,
      yukle      : obj.yukle,
      teslim     : obj.teslim,
      tarih      : obj.tarih,
      durum      : obj.durum   || 'Bekliyor',
      tutar      : obj.tutar   || 0,
      odeme      : obj.odeme   || 'Bekliyor',
      yuk        : obj.yuk     || null,
      agirlik    : obj.agirlik || null,
      notlar     : obj.notlar  || null,
    };
    if (isEdit) {
      await fetch(sbUrl('siparisler?id=eq.' + obj.id), {
        method : 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body   : JSON.stringify(row)
      });
    } else {
      const res = await fetch(sbUrl('siparisler'), {
        method : 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body   : JSON.stringify(row)
      });
      if (res.ok) {
        const created = await res.json();
        if (created && created[0]) obj.id = created[0].id;
      }
    }
  } catch(err) { console.error('Sipariş buluta kaydedilemedi:', err); }
}

async function crmDeleteSiparisCloud(id) {
  if (isLocalMode() || !_authToken) return;
  try {
    await fetch(sbUrl('siparisler?id=eq.' + id), { method: 'DELETE', headers: sbHeaders() });
  } catch(err) { console.error('Sipariş buluttan silinemedi:', err); }
}

function crmSave() {
  crmSaveLocal();
  updateMusteriStat();
}

/* ─── YARDIMCI ─────────────────────────────────── */
function crmNextId(arr) { return arr.length ? Math.max(...arr.map(x => typeof x.id === 'number' ? x.id : 0)) + 1 : 1; }
function crmNextSipId() {
  const nums = crmSiparisler.map(s => {
    const n = parseInt((s.id||'').toString().replace(/[^0-9]/g,''));
    return isNaN(n) ? 0 : n;
  });
  return 'SIP-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4,'0');
}
function crmFmt(n) { return (n||0).toLocaleString('tr-TR'); }
function crmColor(str) { let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))&0xffff; return CRM_COLORS[h%CRM_COLORS.length]; }
function crmInitials(str) { return (str||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function crmDurumBadge(d) {
  const map = { 'Aktif':'badge-green','Pasif':'badge-muted','Potansiyel':'badge-blue','Bekliyor':'badge-yellow','Yolda':'badge-blue','Teslim Edildi':'badge-green','İptal':'badge-red','Ödendi':'badge-green','Kısmi':'badge-yellow' };
  return `<span class="badge ${map[d]||'badge-muted'}">${d}</span>`;
}
function crmMusteriById(id) { return crmMusteriler.find(m=>m.id==id); }
function crmSiparisleriByMusteri(id) { return crmSiparisler.filter(s=>s.musteri_id==id); }
function crmCiroByMusteri(id) { return crmSiparisleriByMusteri(id).filter(s=>s.durum!=='İptal').reduce((a,s)=>a+(s.tutar||0),0); }


/* ─── STAT KARTLARI ─────────────────────────────── */
function crmRenderStats() {
  const aktif = crmMusteriler.filter(m=>m.durum==='Aktif').length;
  const toplamCiro = crmSiparisler.filter(s=>s.durum!=='İptal').reduce((a,s)=>a+(s.tutar||0),0);
  const bekleyen = crmSiparisler.filter(s=>s.odeme==='Bekliyor'&&s.durum!=='İptal').reduce((a,s)=>a+(s.tutar||0),0);
  const yolda = crmSiparisler.filter(s=>s.durum==='Yolda').length;

  const cards = [
    { icon:'🏢', val: crmMusteriler.length, lbl:'Toplam Müşteri', sub:`${aktif} aktif`, color:'var(--accent)' },
    { icon:'📦', val: crmSiparisler.length, lbl:'Toplam Sipariş', sub:`${yolda} yolda`, color:'var(--blue)' },
    { icon:'💰', val:'₺'+crmFmt(toplamCiro), lbl:'Toplam Ciro', sub:'İptal hariç', color:'var(--green)' },
    { icon:'⏳', val:'₺'+crmFmt(bekleyen), lbl:'Tahsilat Bekleyen', sub:'Açık bakiye', color:'var(--yellow)' },
  ];
  document.getElementById('crm-stat-grid').innerHTML = cards.map(c=>`
    <div class="stat-card">
      <div class="stat-icon" style="background:${c.color}22;color:${c.color}">${c.icon}</div>
      <div class="stat-val" style="color:${c.color}">${c.val}</div>
      <div class="stat-lbl">${c.lbl}</div>
      <div class="stat-sub">${c.sub}</div>
    </div>`).join('');
}

/* ─── MÜŞTERİLER ─────────────────────────────── */
function crmRenderMusteriler() {
  const q = document.getElementById('crm-musteri-search').value.toLowerCase();
  const sektor = document.getElementById('crm-musteri-sektor').value;
  const durum = document.getElementById('crm-musteri-durum').value;

  let list = crmMusteriler.filter(m=>{
    const match = m.firma.toLowerCase().includes(q) || (m.yetkili||'').toLowerCase().includes(q);
    return match && (!sektor||m.sektor===sektor) && (!durum||m.durum===durum);
  });

  document.getElementById('crm-musteri-count').textContent = `${list.length} kayıt`;

  const tbody = document.getElementById('crm-musteri-tbody');
  if(!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">🏢</div><div class="empty-state-title">Müşteri bulunamadı</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(m=>{
    const sefers = crmSiparisleriByMusteri(m.id);
    const ciro = crmCiroByMusteri(m.id);
    const sonSefer = sefers.sort((a,b)=>b.tarih.localeCompare(a.tarih))[0];
    const bg = crmColor(m.firma);
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar" style="background:${bg}22;color:${bg}">${crmInitials(m.firma)}</div>
          <div>
            <div style="font-weight:600;">${m.firma}</div>
            <div style="font-size:11px;color:var(--muted);">${m.adres||''}</div>
          </div>
        </div>
      </td>
      <td style="color:var(--text2);">${m.yetkili||'—'}</td>
      <td><span class="badge badge-muted">${m.sektor||'—'}</span></td>
      <td>${crmDurumBadge(m.durum)}</td>
      <td class="mono">${sefers.length}</td>
      <td class="mono" style="color:var(--green);">₺${crmFmt(ciro)}</td>
      <td style="color:var(--text2);font-size:12px;">${sonSefer ? sonSefer.tarih : '—'}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Detay" onclick="openCrmDrawer(${m.id})">👁</button>
          <button class="icon-btn" title="Düzenle" onclick="crmEditMusteri(${m.id})">✏️</button>
          <button class="icon-btn" title="Sil" onclick="deleteCrmMusteri(${m.id})">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ─── SİPARİŞLER ─────────────────────────────── */
function crmRenderSiparisler() {
  const q = document.getElementById('crm-siparis-search').value.toLowerCase();
  const durum = document.getElementById('crm-siparis-durum').value;
  const filterMusteriId = parseInt(document.getElementById('crm-siparis-musteri').value)||0;

  let list = crmSiparisler.filter(s=>{
    const m = crmMusteriById(s.musteri_id);
    const match = String(s.id).toLowerCase().includes(q) || (m&&m.firma.toLowerCase().includes(q))
      || (s.yukle||'').toLowerCase().includes(q) || (s.teslim||'').toLowerCase().includes(q);
    return match && (!durum||s.durum===durum) && (!filterMusteriId||s.musteri_id==filterMusteriId);
  }).sort((a,b)=>b.tarih.localeCompare(a.tarih));

  const tbody = document.getElementById('crm-siparis-tbody');
  if(!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">Sipariş bulunamadı</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s=>{
    const m = crmMusteriById(s.musteri_id);
    return `<tr>
      <td class="mono" style="color:var(--accent);">${s.id}</td>
      <td style="font-weight:600;">${m?m.firma:'—'}</td>
      <td style="color:var(--text2);font-size:12px;">${s.yukle} → ${s.teslim}</td>
      <td style="color:var(--text2);font-size:12px;">${s.tarih}</td>
      <td>${crmDurumBadge(s.durum)}</td>
      <td class="mono" style="color:var(--green);">₺${crmFmt(s.tutar)}</td>
      <td>${crmDurumBadge(s.odeme)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Sil" onclick="deleteCrmSiparis('${s.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function crmFillMusteriSelect(selId) {
  const sel = document.getElementById(selId);
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = crmMusteriler.map(m=>`<option value="${m.id}">${m.firma}</option>`).join('');
  if(cur) sel.value = cur;
}

/* ─── ANALİZ ─────────────────────────────────── */
let crmChartCiro=null, crmChartTrend=null;
function crmRenderAnaliz() {
  // Tablo
  const tbody = document.getElementById('crm-analiz-tbody');
  const now = new Date();
  const rows = crmMusteriler.map(m=>{
    const sefers = crmSiparisleriByMusteri(m.id).filter(s=>s.durum!=='İptal');
    const ciro = sefers.reduce((a,s)=>a+(s.tutar||0),0);
    const son30 = sefers.filter(s=>{
      const d = new Date(s.tarih); return (now-d)/864e5<=30;
    }).reduce((a,s)=>a+(s.tutar||0),0);
    const ort = sefers.length ? Math.round(ciro/sefers.length) : 0;
    return { firma:m.firma, sefer:sefers.length, ciro, ort, son30, durum:m.durum };
  }).sort((a,b)=>b.ciro-a.ciro);

  tbody.innerHTML = rows.map(r=>`<tr>
    <td style="font-weight:600;">${r.firma}</td>
    <td class="mono">${r.sefer}</td>
    <td class="mono" style="color:var(--green);">₺${crmFmt(r.ciro)}</td>
    <td class="mono">₺${crmFmt(r.ort)}</td>
    <td class="mono" style="color:var(--accent);">₺${crmFmt(r.son30)}</td>
    <td>${crmDurumBadge(r.durum)}</td>
  </tr>`).join('');

  // Ciro bar chart
  const top5 = rows.slice(0,6);
  if(crmChartCiro) crmChartCiro.destroy();
  crmChartCiro = new Chart(document.getElementById('crm-chart-ciro'), {
    type:'bar',
    data:{
      labels: top5.map(r=>r.firma.split(' ')[0]),
      datasets:[{ label:'Ciro (₺)', data: top5.map(r=>r.ciro),
        backgroundColor: CRM_COLORS.slice(0,6).map(c=>c+'88'),
        borderColor: CRM_COLORS.slice(0,6), borderWidth:2, borderRadius:6 }]
    },
    options:{ plugins:{legend:{display:false}}, scales:{
      x:{ticks:{color:'#526070',font:{size:10}},grid:{color:'#252f3e'}},
      y:{ticks:{color:'#526070',font:{size:10}},grid:{color:'#252f3e'},
        callback:v=>'₺'+v.toLocaleString('tr-TR')}
    }}
  });

  // Aylık trend
  const aylar=[];
  for(let i=5;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    aylar.push({k:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),l:d.toLocaleDateString('tr-TR',{month:'short'})});
  }
  const counts = aylar.map(a=>crmSiparisler.filter(s=>s.tarih.startsWith(a.k)&&s.durum!=='İptal').length);
  if(crmChartTrend) crmChartTrend.destroy();
  crmChartTrend = new Chart(document.getElementById('crm-chart-trend'), {
    type:'line',
    data:{
      labels:aylar.map(a=>a.l),
      datasets:[{ label:'Sipariş', data:counts,
        borderColor:'var(--accent)', backgroundColor:'rgba(249,115,22,.12)',
        tension:.4, fill:true, pointBackgroundColor:'var(--accent)', pointRadius:4 }]
    },
    options:{ plugins:{legend:{display:false}}, scales:{
      x:{ticks:{color:'#526070',font:{size:10}},grid:{color:'#252f3e'}},
      y:{ticks:{color:'#526070',font:{size:10}},grid:{color:'#252f3e'},stepSize:1}
    }}
  });
}

/* ─── TAB ─────────────────────────────────────── */
function switchCrmTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ['musteriler','siparisler','analiz'].forEach(t=>{
    const el=document.getElementById('crm-tab-'+t);
    if(el) el.classList.toggle('section-hidden', t!==name);
  });
  if(name==='siparisler') { crmFillMusteriSelect('crm-siparis-musteri'); crmRenderSiparisler(); }
  if(name==='analiz') crmRenderAnaliz();
}

/* ─── MÜŞTERİ MODAL ─────────────────────────── */
function openCrmMusteriModal(id=null) {
  crmEditingMusteriId = id;
  const m = id ? crmMusteriler.find(x=>x.id==id) : null;
  document.getElementById('crm-musteri-modal-title').textContent = m ? 'Müşteriyi Düzenle' : 'Yeni Müşteri';
  ['firma','yetkili','tel','email','adres','vkn'].forEach(f=>{
    document.getElementById('crm-m-'+f).value = m ? (m[f]||'') : '';
  });
  // notlar alanı - HTML input id'si crm-m-not ama veri alanı notlar
  document.getElementById('crm-m-not').value = m ? (m.notlar||'') : '';
  document.getElementById('crm-m-sektor').value = m ? (m.sektor||'Perakende') : 'Perakende';
  document.getElementById('crm-m-durum').value = m ? (m.durum||'Aktif') : 'Aktif';
  document.getElementById('crm-m-vade').value = m ? (m.vade||30) : 30;
  document.getElementById('crm-musteri-modal-bg').classList.remove('hidden');
}
function closeCrmMusteriModal() { document.getElementById('crm-musteri-modal-bg').classList.add('hidden'); }
function crmEditMusteri(id) { openCrmMusteriModal(id); }

function saveCrmMusteri() {
  const firma = document.getElementById('crm-m-firma').value.trim();
  if(!firma) { showToast('Firma adı zorunlu','error'); return; }
  const obj = {
    firma,
    yetkili : document.getElementById('crm-m-yetkili').value.trim(),
    sektor  : document.getElementById('crm-m-sektor').value,
    tel     : document.getElementById('crm-m-tel').value.trim(),
    email   : document.getElementById('crm-m-email').value.trim(),
    adres   : document.getElementById('crm-m-adres').value.trim(),
    vkn     : document.getElementById('crm-m-vkn').value.trim(),
    vade    : parseInt(document.getElementById('crm-m-vade').value)||30,
    durum   : document.getElementById('crm-m-durum').value,
    notlar  : document.getElementById('crm-m-not').value.trim(),
  };
  const isEdit = !!crmEditingMusteriId;
  if (isEdit) {
    const idx = crmMusteriler.findIndex(m=>m.id===crmEditingMusteriId);
    crmMusteriler[idx] = { ...crmMusteriler[idx], ...obj };
    crmSaveMusteriCloud({ ...crmMusteriler[idx] }, true);
    showToast('Müşteri güncellendi ✓');
  } else {
    obj.id = crmNextId(crmMusteriler);
    crmMusteriler.push(obj);
    crmSaveMusteriCloud(obj, false).then(() => {
      crmSaveLocal(); // ID güncellenmiş olabilir
      crmRenderMusteriler();
    });
    showToast('Müşteri eklendi ✓');
  }
  crmSave(); closeCrmMusteriModal(); crmRenderMusteriler(); crmRenderStats();
}

async function deleteCrmMusteri(id) {
  if(!confirm('Bu müşteriyi silmek istiyor musunuz?')) return;
  crmMusteriler = crmMusteriler.filter(m=>m.id!=id);
  crmSiparisler = crmSiparisler.filter(s=>s.musteri_id!=id);
  crmSave(); crmRenderMusteriler(); crmRenderStats(); showToast('Müşteri silindi');
  await crmDeleteMusteriCloud(id);
}

/* ─── SİPARİŞ MODAL ─────────────────────────── */
function openCrmSiparisModal() {
  crmFillMusteriSelect('crm-s-musteri');
  document.getElementById('crm-s-tarih').value = new Date().toISOString().slice(0,10);
  ['yukle','teslim','yuk','not'].forEach(f=>{ document.getElementById('crm-s-'+f).value=''; });
  document.getElementById('crm-s-tutar').value='';
  document.getElementById('crm-s-agirlik').value='';
  document.getElementById('crm-s-durum').value='Bekliyor';
  document.getElementById('crm-s-odeme').value='Bekliyor';
  document.getElementById('crm-siparis-modal-bg').classList.remove('hidden');
}
function closeCrmSiparisModal() { document.getElementById('crm-siparis-modal-bg').classList.add('hidden'); }

function saveCrmSiparis() {
  const musteri_id = parseInt(document.getElementById('crm-s-musteri').value);
  const yukle = document.getElementById('crm-s-yukle').value.trim();
  const teslim = document.getElementById('crm-s-teslim').value.trim();
  if(!musteri_id||!yukle||!teslim){ showToast('Müşteri, yükleme ve teslim noktası zorunlu','error'); return; }
  const obj = {
    id         : crmNextSipId(),
    musteri_id,
    yukle, teslim,
    tarih  : document.getElementById('crm-s-tarih').value,
    durum  : document.getElementById('crm-s-durum').value,
    tutar  : parseFloat(document.getElementById('crm-s-tutar').value)||0,
    odeme  : document.getElementById('crm-s-odeme').value,
    yuk    : document.getElementById('crm-s-yuk').value.trim(),
    agirlik: parseFloat(document.getElementById('crm-s-agirlik').value)||0,
    notlar : document.getElementById('crm-s-not').value.trim(),
  };
  crmSiparisler.push(obj);
  crmSaveSiparisCloud(obj, false);
  crmSave(); closeCrmSiparisModal();
  crmFillMusteriSelect('crm-siparis-musteri');
  crmRenderSiparisler(); crmRenderStats();
  showToast('Sipariş eklendi ✓');
}

async function deleteCrmSiparis(id) {
  if(!confirm('Bu siparişi silmek istiyor musunuz?')) return;
  crmSiparisler = crmSiparisler.filter(s=>s.id!==id);
  crmSave(); crmRenderSiparisler(); crmRenderStats(); showToast('Sipariş silindi');
  await crmDeleteSiparisCloud(id);
}

/* ─── DRAWER ─────────────────────────────────── */
function openCrmDrawer(id) {
  const m = crmMusteriById(id);
  if(!m) return;
  _crmDrawerActiveMusteriId = id;
  const sefers = crmSiparisleriByMusteri(id).sort((a,b)=>b.tarih.localeCompare(a.tarih));
  const ciro = sefers.filter(s=>s.durum!=='İptal').reduce((a,s)=>a+(s.tutar||0),0);
  const bekleyen = sefers.filter(s=>s.odeme==='Bekliyor'&&s.durum!=='İptal').reduce((a,s)=>a+(s.tutar||0),0);
  const bg = crmColor(m.firma);

  document.getElementById('crm-drawer-avatar').textContent = crmInitials(m.firma);
  document.getElementById('crm-drawer-avatar').style.background = bg+'22';
  document.getElementById('crm-drawer-avatar').style.color = bg;
  document.getElementById('crm-drawer-firma').textContent = m.firma;
  document.getElementById('crm-drawer-sektor').textContent = m.sektor + (m.durum ? ' · '+m.durum : '');

  const detaylar = [
    ['Yetkili', m.yetkili||'—'],
    ['Telefon', m.tel||'—'],
    ['E-Posta', m.email||'—'],
    ['Adres', m.adres||'—'],
    ['Vergi No', m.vkn||'—'],
    ['Ödeme Vadesi', m.vade ? m.vade+' gün' : '—'],
    ['Not', m.notlar||'—'],
  ];
  document.getElementById('crm-drawer-detaylar').innerHTML = detaylar.map(([k,v])=>`
    <div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`).join('');

  const son5 = sefers.slice(0,5);
  document.getElementById('crm-drawer-siparisler').innerHTML = son5.length ? son5.map(s=>`
    <div class="siparis-row">
      <div>
        <div class="mono" style="color:var(--accent);font-size:11px;">${s.id}</div>
        <div style="font-size:12px;color:var(--text2);">${s.yukle} → ${s.teslim}</div>
        <div style="font-size:11px;color:var(--muted);">${s.tarih}</div>
      </div>
      <div style="text-align:right;">
        ${crmDurumBadge(s.durum)}
        <div class="mono" style="color:var(--green);font-size:12px;margin-top:4px;">₺${crmFmt(s.tutar)}</div>
      </div>
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px;">Henüz sipariş yok.</div>';

  document.getElementById('crm-drawer-mali').innerHTML = [
    ['Toplam Sefer', sefers.length],
    ['Toplam Ciro', '₺'+crmFmt(ciro)],
    ['Tahsilat Bekleyen', '₺'+crmFmt(bekleyen)],
    ['Ort. Sefer Tutarı', sefers.length ? '₺'+crmFmt(Math.round(ciro/sefers.length)) : '—'],
  ].map(([k,v])=>`<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val" style="color:var(--green);">${v}</span></div>`).join('');

  document.getElementById('crm-drawer-bg').classList.remove('hidden');
  document.getElementById('crm-musteri-drawer').classList.remove('hidden');
}
function closeCrmDrawer() {
  document.getElementById('crm-drawer-bg').classList.add('hidden');
  document.getElementById('crm-musteri-drawer').classList.add('hidden');
  _crmDrawerActiveMusteriId = null;
}

/* ─── MÜŞTERİ PORTAL LİNKİ (CRM drawer) ──────── */
let _crmDrawerActiveMusteriId = null;

function _crmPortalUrl(musteriId) {
  if (!currentFirmaId) return null;
  const tok  = btoa('mtp_' + musteriId + '_' + currentFirmaId);
  const base = window.location.href.replace(/[^/]*$/, '');
  return base + 'portal.html?c=' + tok;
}
function crmPortalLink() {
  if (!_crmDrawerActiveMusteriId) return;
  if (!currentFirmaId) { showToast('Firma bilgisi yüklenemedi. Sayfayı yenileyin.', 'error'); return; }
  const url = _crmPortalUrl(_crmDrawerActiveMusteriId);
  navigator.clipboard.writeText(url)
    .then(() => showToast('📋 Müşteri portal linki kopyalandı!', 'success'))
    .catch(() => { prompt('Müşteri portal linki:', url); });
}
function crmPortalLinkOpen() {
  if (!_crmDrawerActiveMusteriId) return;
  if (!currentFirmaId) { showToast('Firma bilgisi yüklenemedi. Sayfayı yenileyin.', 'error'); return; }
  window.open(_crmPortalUrl(_crmDrawerActiveMusteriId), '_blank');
}

/* ─── CSV ─────────────────────────────────────── */
function crmExportCSV() {
  const rows = [['Firma','Yetkili','Sektör','Durum','Toplam Sefer','Toplam Ciro (₺)','Telefon','E-Posta']];
  crmMusteriler.forEach(m=>{
    rows.push([m.firma,m.yetkili,m.sektor,m.durum,crmSiparisleriByMusteri(m.id).length,crmCiroByMusteri(m.id),m.tel,m.email]);
  });
  const csv = rows.map(r=>r.map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  a.download = 'musteriler_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  showToast('CSV indirildi ✓');
}

/* ═══════════════════════════════════════════════════════════
   OPERASYON MODÜLÜ
   ═══════════════════════════════════════════════════════════ */

let isEmirleri = [];
let opsDrawerActiveId = null;

/* ── VERİ KATMANI ────────────────────────────────────────── */

// ---- LocalStorage yedek ----
function opsLoadLocal() {
  try { isEmirleri = JSON.parse(localStorage.getItem('fleetly_is_emirleri') || '[]'); }
  catch(e) { isEmirleri = []; }
  // Dashboard stat kartını güncelle
  if (typeof updateOpsStatCard === 'function') updateOpsStatCard();
}
function opsSaveLocal() {
  localStorage.setItem('fleetly_is_emirleri', JSON.stringify(isEmirleri));
}
// Geriye dönük uyumluluk
function opsLoad()  { opsLoadLocal(); }
function opsSave()  { opsSaveLocal(); }

function opsNextId() {
  return isEmirleri.length ? Math.max(...isEmirleri.map(e => e.id || 0)) + 1 : 1;
}
function opsById(id) {
  const sid = String(id);
  return isEmirleri.find(e => String(e.id) === sid || (e._dbId != null && String(e._dbId) === sid));
}

// fotograflar alanı Supabase'den string JSON gelebilir, localStorage'dan array —
// her durumda güvenli array döndür
function opsFotoArray(e) {
  if (!e) return [];
  const f = e.fotograflar;
  if (Array.isArray(f)) return f;
  if (typeof f === 'string') {
    try { const p = JSON.parse(f); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// Supabase satırını → uygulama objesine dönüştür
function opsRowToObj(r) {
  return {
    id            : r.id,
    _dbId         : r.id,
    firma_id      : r.firma_id      || null,
    musteri_id    : r.musteri_id    || null,
    musteri_adi   : r.musteri_adi   || '',
    arac_plaka    : r.arac_plaka    || '',
    sofor         : r.sofor         || '',
    sofor_tel     : r.sofor_tel     || '',
    sofor_user_id : r.sofor_user_id || null,
    konteyner_no  : r.konteyner_no  || '',
    kont_tip      : r.kont_tip      || '',
    kont_durum    : r.kont_durum    || 'Dolu',
    referans_no   : r.referans_no   || '',
    muhur_no      : r.muhur_no      || '',
    yukle_yeri    : r.yukle_yeri    || '',
    teslim_yeri   : r.teslim_yeri   || '',
    yukle_lat     : r.yukle_lat     || null,
    yukle_lng     : r.yukle_lng     || null,
    teslim_lat    : r.teslim_lat    || null,
    teslim_lng    : r.teslim_lng    || null,
    bos_donus     : r.bos_donus     || '',
    boslama_zaman : r.boslama_zaman || null,
    durum         : r.durum         || 'Bekliyor',
    atama_zamani  : r.atama_zamani  || null,
    yola_zaman    : r.yola_zaman    || null,
    fabrika_giris : r.fabrika_giris || null,
    fabrika_cikis : r.fabrika_cikis || null,
    teslim_zamani : r.teslim_zamani || null,
    fotograflar   : (() => { try { return JSON.parse(r.fotograflar || '[]'); } catch(e) { return []; } })(),
    notlar        : r.notlar        || '',
    /* ── Konum & ETA (şoför tarafından doldurulur) ── */
    konum_lat     : r.konum_lat     != null ? parseFloat(r.konum_lat)  : null,
    konum_lng     : r.konum_lng     != null ? parseFloat(r.konum_lng)  : null,
    konum_zaman   : r.konum_zaman   || null,
    eta_iso       : r.eta_iso       || null,
    kalan_km      : r.kalan_km      != null ? parseFloat(r.kalan_km)   : null,
    rota_polyline : r.rota_polyline || null,
    /* ── Km sayacı & yakıt cache ── */
    baslangic_km  : r.baslangic_km  != null ? parseFloat(r.baslangic_km) : null,
    bitis_km      : r.bitis_km      != null ? parseFloat(r.bitis_km)     : null,
    yakit_litre   : r.yakit_litre   != null ? parseFloat(r.yakit_litre)  : null,
    yakit_tutar   : r.yakit_tutar   != null ? parseFloat(r.yakit_tutar)  : null,
    diger_masraf  : r.diger_masraf  != null ? parseFloat(r.diger_masraf) : null,
  };
}

// Uygulama objesini → Supabase satırına dönüştür
async function opsObjToRow(obj, isEdit) {
  // Auth token yoksa getSB().auth.getUser() yerine mevcut token'dan user_id al
  let userId = null;
  try {
    const { data: { user } } = await getSB().auth.getUser();
    userId = user?.id || null;
  } catch(e) { console.warn('opsObjToRow getUser hata:', e); }

  const row = {
    firma_id      : currentFirmaId || null,
    user_id       : userId,
    musteri_id    : obj.musteri_id    || null,
    musteri_adi   : obj.musteri_adi   || null,
    arac_plaka    : obj.arac_plaka    || null,
    sofor         : obj.sofor         || null,
    sofor_tel     : obj.sofor_tel     || null,
    sofor_user_id : obj.sofor_user_id || null,
    konteyner_no  : obj.konteyner_no  || null,
    kont_tip      : obj.kont_tip      || null,
    kont_durum    : obj.kont_durum    || 'Dolu',
    referans_no   : obj.referans_no   || null,
    muhur_no      : obj.muhur_no      || null,
    yukle_yeri    : obj.yukle_yeri    || null,
    teslim_yeri   : obj.teslim_yeri   || null,
    bos_donus     : obj.bos_donus     || null,
    boslama_zaman : obj.boslama_zaman || null,
    durum         : obj.durum         || 'Bekliyor',
    atama_zamani  : obj.atama_zamani  || null,
    yola_zaman    : obj.yola_zaman    || null,
    fabrika_giris : obj.fabrika_giris || null,
    fabrika_cikis : obj.fabrika_cikis || null,
    teslim_zamani : obj.teslim_zamani || null,
    fotograflar   : (() => {
      const f = obj.fotograflar;
      if (Array.isArray(f)) return JSON.stringify(f);
      if (typeof f === 'string') { try { JSON.parse(f); return f; } catch {} }
      return '[]';
    })(),
    notlar        : obj.notlar        || null,
    baslangic_km  : (obj.baslangic_km != null ? obj.baslangic_km : null),
    bitis_km      : (obj.bitis_km     != null ? obj.bitis_km     : null),
    yakit_litre   : (obj.yakit_litre  != null ? obj.yakit_litre  : null),
    yakit_tutar   : (obj.yakit_tutar  != null ? obj.yakit_tutar  : null),
  };
  // GENERATED ALWAYS AS IDENTITY — yeni kayıtta id GÖNDERİLMEZ
  // Düzenleme modunda (isEdit=true) id URL parametresine gider, body'e değil
  return row;
}

// ---- CLOUD LOAD ----
async function opsLoadCloud() {
  if (isLocalMode() || !_authToken) return;
  try {
    let url = sbUrl('is_emirleri?select=*&order=id.desc');
    if (currentFirmaId) {
      // firma_id eşleşen VEYA firma_id boş olan kayıtları al
      url += '&or=(firma_id.eq.' + currentFirmaId + ',firma_id.is.null)';
    }
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    // Cloud'dan gelen kayıtları parse et
    const cloudObjs = rows.map(opsRowToObj);
    // Local'de buluta kaydedilememiş (_syncPending veya _dbId yok) kayıtları koru
    // Böylece POST hatası (RLS, network, vs.) sonrası kullanıcının yeni eklediği iş
    // emirleri refresh sonrası kaybolmaz — ekranda durum göstergesiyle kalır.
    const pendingLocal = (isEmirleri || []).filter(e =>
      e && (e._syncPending === true || e._dbId == null)
    );
    // Cloud'dan dönen id'ler setinde olan pending'leri ele (dbId eşleşirse cloud galip)
    const cloudIds = new Set(cloudObjs.map(o => o._dbId).filter(Boolean));
    const keep = pendingLocal.filter(e => !(e._dbId != null && cloudIds.has(e._dbId)));
    isEmirleri = [...keep, ...cloudObjs];
    opsSaveLocal();
    // Bekleyenleri tekrar buluta göndermeyi dene
    if (keep.length) {
      console.log('is_emirleri: ' + keep.length + ' pending kayıt yeniden buluta gönderiliyor...');
      keep.forEach(e => { opsSaveCloud(e).catch(()=>{}); });
    }
  } catch(err) {
    console.warn('is_emirleri cloud yüklenemedi, localStorage kullanılıyor:', err);
    opsLoadLocal();
  }
}

// ---- CLOUD UPSERT (yeni kayıt veya güncelleme) ----
async function opsSaveCloud(obj) {
  opsSaveLocal(); // önce yerel yedek
  if (isLocalMode()) return;

  // _authToken yoksa Supabase SDK'dan taze token al
  if (!_authToken) {
    try {
      const { data: { session } } = await getSB().auth.getSession();
      if (session?.access_token) _authToken = session.access_token;
    } catch(e) {}
  }
  if (!_authToken) {
    console.warn('opsSaveCloud: auth token yok, kayıt erteleniyor');
    obj._syncPending = true;
    opsSaveLocal();
    return;
  }

  try {
    // isEdit: obj._dbId varsa (Supabase'den yüklenmiş gerçek id), güncelleme
    // obj.id geçici local id olabilir; obj._dbId gerçek Supabase id'si
    const dbId   = obj._dbId ?? (typeof obj.id === 'number' && obj.id < 1e9 ? null : obj.id);
    const isEdit = !!dbId;
    const row    = await opsObjToRow(obj, isEdit);

    if (isEdit) {
      const res = await fetch(sbUrl('is_emirleri?id=eq.' + dbId), {
        method : 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body   : JSON.stringify(row),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('PATCH hatası:', res.status, err);
        obj._syncPending = true;
        obj._syncError   = 'HTTP ' + res.status + ': ' + (err || '').slice(0, 200);
        opsSaveLocal();
        if (typeof showToast === 'function') {
          showToast('İş emri güncellenemedi (senkron hatası): ' + res.status, 'error');
        }
      } else {
        obj._syncPending = false;
        obj._syncError   = null;
        opsSaveLocal();
      }
    } else {
      // YENİ KAYIT — id body'e eklenmez, Supabase otomatik atar
      const res = await fetch(sbUrl('is_emirleri'), {
        method : 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body   : JSON.stringify(row),
      });
      if (res.ok) {
        const created = await res.json();
        if (created?.[0]?.id) {
          // Supabase'nin atadığı gerçek id'yi sakla — hem _dbId hem id güncelle
          const realId = created[0].id;
          obj._dbId = realId;
          obj.id    = realId;
          obj._syncPending = false;
          obj._syncError   = null;
          const idx = isEmirleri.findIndex(e => e === obj);
          if (idx !== -1) {
            isEmirleri[idx]._dbId = realId;
            isEmirleri[idx].id    = realId;
            isEmirleri[idx]._syncPending = false;
            isEmirleri[idx]._syncError   = null;
          }
          opsSaveLocal();
          console.log('is_emirleri kayıt OK, Supabase id:', realId);
        }
      } else {
        const err = await res.text();
        console.error('POST hatası:', res.status, err);
        obj._syncPending = true;
        obj._syncError   = 'HTTP ' + res.status + ': ' + (err || '').slice(0, 200);
        opsSaveLocal();
        if (typeof showToast === 'function') {
          let msg = 'İş emri buluta kaydedilemedi (HTTP ' + res.status + ')';
          if (res.status === 401 || res.status === 403) {
            msg += ' — oturum süresi dolmuş olabilir, tekrar giriş yapın.';
          } else if (res.status === 400 || res.status === 422) {
            msg += ' — veri doğrulama hatası. Detay: ' + (err || '').slice(0, 120);
          } else if (res.status === 409) {
            msg += ' — kayıt çakışması (RLS / yetki).';
          }
          showToast(msg, 'error');
        }
      }
    }
  } catch(err) {
    console.error('is_emirleri buluta kaydedilemedi:', err);
    obj._syncPending = true;
    obj._syncError   = String(err?.message || err);
    opsSaveLocal();
    if (typeof showToast === 'function') {
      showToast('İş emri kaydında ağ hatası — yerel olarak saklandı, yeniden denenecek.', 'error');
    }
  }
}

// ---- MUSTERI SELECT YENİLE (modal kapalıyken de çağrılabilir) ----
function _opsPopulateMusteriSelect() {
  const mSel = document.getElementById('ops-m-musteri');
  if (!mSel) return;
  const current = mSel.value;
  mSel.innerHTML = '<option value="">Müşteri seçin...</option>' +
    (crmMusteriler || []).filter(m => m.durum !== 'Pasif')
      .map(m => `<option value="${m.id}">${m.firma}</option>`).join('');
  if (current) mSel.value = current;
}

// ---- CLOUD DELETE ----
async function opsDeleteCloud(id) {
  if (isLocalMode()) return;
  if (!_authToken) {
    try {
      const { data: { session } } = await getSB().auth.getSession();
      if (session?.access_token) _authToken = session.access_token;
    } catch(e) {}
  }
  if (!_authToken) return;
  // _dbId'yi bul — silinecek kaydın gerçek Supabase id'si
  const obj = isEmirleri.find(e => e.id === id || e._dbId === id);
  const dbId = obj?._dbId ?? id;
  try {
    await fetch(sbUrl('is_emirleri?id=eq.' + dbId), {
      method : 'DELETE',
      headers: sbHeaders(),
    });
  } catch(err) { console.error('is_emirleri buluttan silinemedi:', err); }
}

// ---- FULL LOAD (local önce, cloud sonra) ----
async function opsLoadData() {
  opsLoadLocal(); // hızlı ilk render için
  await opsLoadCloud(); // sonra buluttan güncel veriyi al
}

/* ── SAYFA AÇ/KAPAT ─────────────────────────────────────── */
async function openOperasyonPage() {
  opsLoadLocal();
  document.getElementById('operasyon-page').classList.add('open');
  document.body.style.overflow = 'hidden';
  opsRenderStats();
  opsRenderTable();
  opsRenderKanban();
  opsRenderArsiv();
  await opsLoadCloud();
  // sofor_user_id eksik iş emirleri varsa geriye dönük eşleştir
  opsSoforUserIdEslestiir().then(n => { if (n > 0) console.log(`${n} iş emrine sofor_user_id atandı`); }).catch(()=>{});
  opsRenderStats();
  opsRenderTable();
  opsRenderKanban();
  opsRenderArsiv();
  updateOpsStatCard();
}
function closeOperasyonPage() {
  document.getElementById('operasyon-page').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── SEKME ───────────────────────────────────────────────── */
async function switchOpsTab(name, btn) {
  document.querySelectorAll('#operasyon-page .srm-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#operasyon-page .srm-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('ops-panel-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'canli')  opsRenderKanban();
  if (name === 'arsiv')  opsRenderArsiv();
  if (name === 'harita') await opsRenderFleetMap();
}

/* ── STAT ÇUBUĞU ─────────────────────────────────────────── */
function opsRenderStats() {
  const toplam    = isEmirleri.length;
  const bekliyor  = isEmirleri.filter(e => e.durum === 'Bekliyor').length;
  const yolda     = isEmirleri.filter(e => e.durum === 'Yolda').length;
  const fabrikada = isEmirleri.filter(e => e.durum === 'Fabrikada').length;
  const teslim    = isEmirleri.filter(e => e.durum === 'Teslim Edildi').length;
  const stats = [
    { val: toplam,    lbl: 'Toplam',     color: 'var(--text2)' },
    { val: bekliyor,  lbl: 'Bekliyor',   color: 'var(--yellow)' },
    { val: yolda,     lbl: 'Yolda',      color: 'var(--blue)' },
    { val: fabrikada, lbl: 'Fabrikada',  color: 'var(--accent)' },
    { val: teslim,    lbl: 'Teslim',     color: 'var(--green)' },
  ];
  document.getElementById('ops-stat-bar').innerHTML = stats.map(s => `
    <div style="display:flex;flex-direction:column;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 18px;">
      <span style="font-family:var(--font-display);font-size:26px;font-weight:900;color:${s.color};line-height:1;">${s.val}</span>
      <span style="font-family:var(--font-mono);font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:2px;">${s.lbl}</span>
    </div>`).join('');
}

/* ── DURUM BADGE HTML ────────────────────────────────────── */
function opsDurumBadge(durum) {
  const map = { 'Bekliyor':'bekliyor','Yolda':'yolda','Fabrikada':'fabrikada','Teslim Edildi':'teslim','İptal':'iptal' };
  return `<span class="ops-badge ${map[durum]||'bekliyor'}">${durum}</span>`;
}

/* ── BEKLEME SÜRESİ HESAPLA ─────────────────────────────── */
function opsBeklemeSuresi(giris, cikis) {
  if (!giris || !cikis) return '—';
  const dk = Math.round((new Date(cikis) - new Date(giris)) / 60000);
  if (dk < 0) return '—';
  const h = Math.floor(dk / 60), m = dk % 60;
  return h > 0 ? `${h}s ${m}dk` : `${m}dk`;
}

/* ── ZAMAN FORMATLA ──────────────────────────────────────── */
function opsFmtZaman(z) {
  if (!z) return '—';
  const d = new Date(z);
  return d.toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit' }) + ' ' +
         d.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
}

/* ── TABLO ───────────────────────────────────────────────── */
function opsRenderTable() {
  const q      = (document.getElementById('ops-search')?.value || '').toLowerCase();
  const durumF = document.getElementById('ops-filter-durum')?.value || '';
  const aktif  = isEmirleri.filter(e => e.durum !== 'Teslim Edildi' && e.durum !== 'İptal');
  const filtered = aktif.filter(e => {
    const match = !q || [e.konteyner_no, e.muhur_no, e.referans_no, e.arac_plaka, e.musteri_adi, e.sofor, e.yukle_yeri, e.teslim_yeri, e.bos_donus].join(' ').toLowerCase().includes(q);
    const durumMatch = !durumF || e.durum === durumF;
    return match && durumMatch;
  });
  const sorted = [...filtered].sort((a, b) => b.id - a.id);
  document.getElementById('ops-table-count').textContent = sorted.length + ' kayıt';
  const tbody = document.getElementById('ops-table-body');
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="srm-empty"><div style="text-align:center;padding:32px;color:var(--muted);">Henüz aktif iş emri yok. <button onclick="openOpsIsEmriModal()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font-body);font-size:13px;font-weight:600;">+ Yeni oluştur</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(e => {
    const kontNolar = (e.konteyner_no || '—').split('\n').filter(Boolean);
    const kontHtml = kontNolar.map(k => `<div style="font-family:var(--font-mono);font-weight:600;letter-spacing:.04em;font-size:11.5px;">${k}</div>`).join('');
    const doluBosRenk = e.kont_durum === 'Boş' ? 'var(--muted)' : 'var(--accent)';
    const doluBosIcon = e.kont_durum === 'Boş' ? '🔲 Boş' : '📦 Dolu';
    const syncBadge = (e._syncPending === true || (e._dbId == null && !isLocalMode()))
      ? `<span title="${(e._syncError || 'Buluta kaydedilmedi — yeniden denenecek').replace(/"/g,'&quot;')}" style="display:inline-block;margin-left:4px;width:8px;height:8px;border-radius:50%;background:var(--yellow);box-shadow:0 0 0 2px rgba(234,179,8,.2);vertical-align:middle;cursor:help;"></span>`
      : '';
    return `
    <tr>
      <td><span class="mono" style="color:var(--accent);">#${e.id}</span>${syncBadge}</td>
      <td>${e.musteri_adi || '—'}</td>
      <td><span class="plate-cell">${e.arac_plaka || '—'}</span></td>
      <td>${kontHtml}</td>
      <td><span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);padding:2px 7px;border-radius:4px;">${e.kont_tip || '—'}</span></td>
      <td><span style="font-size:11px;color:${doluBosRenk};font-weight:600;">${doluBosIcon}</span></td>
      <td style="font-size:12px;color:var(--text2);">${e.yukle_yeri || '—'}</td>
      <td style="font-size:12px;color:var(--text2);">${e.teslim_yeri || '—'}</td>
      <td style="font-size:11.5px;color:var(--teal);">${e.bos_donus || '—'}</td>
      <td>${opsDurumBadge(e.durum)}</td>
      <td><span style="font-family:var(--font-mono);font-size:11.5px;">${opsFmtZaman(e.fabrika_giris)}</span></td>
      <td><span style="font-family:var(--font-mono);font-size:11.5px;">${opsFmtZaman(e.fabrika_cikis)}</span></td>
      <td><span style="font-family:var(--font-mono);font-size:11.5px;color:${e.fabrika_giris&&e.fabrika_cikis?'var(--yellow)':'var(--muted)'};">${opsBeklemeSuresi(e.fabrika_giris, e.fabrika_cikis)}</span></td>
      <td><span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);padding:2px 7px;border-radius:99px;">${opsFotoArray(e).length} foto</span></td>
      <td class="col-islem">
        <div style="display:flex;gap:4px;">
          <button onclick="openOpsDrawer(${e.id})" class="icon-btn" title="Detay" style="color:var(--accent);border-color:rgba(232,82,26,.25);">⊙</button>
          <button onclick="openOpsIsEmriDuzenle(${e.id})" class="icon-btn" title="Düzenle" style="color:var(--blue);border-color:rgba(56,189,248,.25);">✎</button>
          <button onclick="deleteOpsIsEmri(${e.id})" class="icon-btn del" title="Sil">🗑</button>
        </div>
      </td>
    </tr>`; }).join('');
}

/* ── KANBAN ──────────────────────────────────────────────── */
function opsRenderKanban() {
  const kolonlar = [
    { key: 'Bekliyor',  label: 'Bekliyor',   color: 'var(--yellow)' },
    { key: 'Yolda',     label: 'Yolda',      color: 'var(--blue)' },
    { key: 'Fabrikada', label: 'Fabrikada',  color: 'var(--accent)' },
    { key: 'Teslim Edildi', label: 'Teslim', color: 'var(--green)' },
  ];
  const aktif = isEmirleri.filter(e => e.durum !== 'İptal');
  document.getElementById('ops-kanban').innerHTML = kolonlar.map(kol => {
    const kartlar = aktif.filter(e => e.durum === kol.key);
    return `
      <div class="ops-kanban-col">
        <div class="ops-kanban-col-header">
          <span style="color:${kol.color};">${kol.label}</span>
          <span class="ops-kanban-count" style="color:${kol.color};">${kartlar.length}</span>
        </div>
        ${kartlar.length ? kartlar.map(e => {
          const kontNolar = (e.konteyner_no || '').split('\n').filter(Boolean);
          const kontLabel = kontNolar.length > 1 ? kontNolar[0] + ` +${kontNolar.length-1}` : (kontNolar[0] || '—');
          const doluBosBadge = e.kont_durum === 'Boş' ? '<span style="font-size:10px;color:var(--muted);">🔲 Boş</span>' : '<span style="font-size:10px;color:var(--accent);">📦 Dolu</span>';
          return `
          <div class="ops-kcard" onclick="openOpsDrawer(${e.id})">
            <div class="ops-kcard-plaka">${e.arac_plaka || '—'} ${e.kont_tip ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--muted);margin-left:4px;">${e.kont_tip}</span>` : ''}</div>
            <div class="ops-kcard-cont">📦 ${kontLabel} ${doluBosBadge}</div>
            <div class="ops-kcard-musteri">${e.musteri_adi || '—'}</div>
            ${e.bos_donus ? `<div style="font-size:10.5px;color:var(--teal);margin-top:3px;">↩ ${e.bos_donus}</div>` : ''}
            <div class="ops-kcard-time">${opsFmtZaman(e.atama_zamani)}</div>
          </div>`;}).join('') :
          `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px;">Boş</div>`}
      </div>`;
  }).join('');
}

/* ── FİLO HARİTASI ──────────────────────────────────────── */
let _fleetMap = null;
let _fleetMarkers = [];
let _fleetRefreshTimer = null;

async function opsRenderFleetMap() {
  // Init Leaflet map once
  if (!_fleetMap) {
    _fleetMap = L.map('ops-fleet-map', { zoomControl: true, attributionControl: false })
      .setView([39.9, 32.8], 6); // Türkiye merkezi
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18
    }).addTo(_fleetMap);
    L.control.attribution({ prefix: '© OpenStreetMap' }).addTo(_fleetMap);
  }
  setTimeout(() => _fleetMap.invalidateSize(), 80);

  // Harita açıldığında güncel konum verisini cloud'dan çek
  await opsLoadCloud();

  // Remove old markers
  _fleetMarkers.forEach(m => _fleetMap.removeLayer(m));
  _fleetMarkers = [];

  // Only vehicles with valid coordinates
  const withLoc = isEmirleri.filter(e =>
    e.durum !== 'İptal' &&
    isFinite(parseFloat(e.konum_lat)) && isFinite(parseFloat(e.konum_lng))
  );

  // Update count badge
  const aktifKonum = withLoc.filter(e => !['Teslim Edildi'].includes(e.durum)).length;
  const countEl = document.getElementById('fleet-map-count');
  if (countEl) countEl.textContent = aktifKonum + ' aktif araç';

  if (!withLoc.length) {
    // Show TR center, nothing else
    return;
  }

  const bounds = [];

  withLoc.forEach(e => {
    const lat = parseFloat(e.konum_lat), lng = parseFloat(e.konum_lng);
    const durum = (e.durum || 'Bekliyor').toLowerCase().replace(' ', '');
    const durumKey = durum === 'teslimedileddi' ? 'teslim' : durum;
    const cls = { 'yolda':'yolda', 'fabrikada':'fabrikada', 'bekliyor':'bekliyor', 'teslimedileddi':'teslim', 'teslim edildi':'teslim' }[e.durum?.toLowerCase()] || 'bekliyor';

    // Truck icon
    const icon = L.divIcon({
      className: '',
      html: `<div class="fleet-truck-icon ${cls}" title="${e.arac_plaka||''}">🚛</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });

    // ETA line
    let etaLine = '';
    if (e.eta_iso && e.durum === 'Yolda') {
      const ms = Date.parse(e.eta_iso) - Date.now();
      if (ms > 0) {
        const min = Math.round(ms / 60000);
        etaLine = min < 60
          ? `<div class="fleet-popup-row">⏱ ETA: <b>${min} dk</b></div>`
          : `<div class="fleet-popup-row">⏱ ETA: <b>${Math.floor(min/60)}s ${min%60}dk</b></div>`;
      }
    } else if (e.kalan_km && e.durum === 'Yolda') {
      etaLine = `<div class="fleet-popup-row">📏 Kalan: <b>${e.kalan_km} km</b></div>`;
    }

    // Age of last position
    let ageStr = '';
    if (e.konum_zaman) {
      const ageSec = Math.round((Date.now() - Date.parse(e.konum_zaman)) / 1000);
      ageStr = ageSec < 60 ? `${ageSec}s önce` : ageSec < 3600 ? `${Math.round(ageSec/60)} dk önce` : `${Math.round(ageSec/3600)} sa önce`;
    }

    const popup = `
      <div class="fleet-popup-plaka">${e.arac_plaka || '—'}</div>
      <div class="fleet-popup-row">👤 ${e.sofor || '—'}</div>
      <div class="fleet-popup-row">📦 ${(e.konteyner_no||'—').split('\n')[0]}</div>
      <div class="fleet-popup-row">🏢 ${e.musteri_adi || '—'}</div>
      <div class="fleet-popup-row">📍 ${opsDurumLabel(e.durum)}${ageStr?' · '+ageStr:''}</div>
      ${etaLine}
      <button class="fleet-popup-btn" onclick="_fleetMap.closePopup();openOpsDrawer(${e.id})">Detay →</button>`;

    const marker = L.marker([lat, lng], { icon })
      .addTo(_fleetMap)
      .bindPopup(popup, { maxWidth: 240 });

    _fleetMarkers.push(marker);
    bounds.push([lat, lng]);
  });

  if (bounds.length === 1) {
    _fleetMap.setView(bounds[0], 12);
  } else if (bounds.length > 1) {
    _fleetMap.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
  }
}

function opsDurumLabel(d) {
  return { 'Yolda':'🔵 Yolda','Fabrikada':'🟠 Fabrikada','Bekliyor':'🟡 Bekliyor','Teslim Edildi':'🟢 Teslim' }[d] || d || '—';
}

/* ── ARŞİV ───────────────────────────────────────────────── */
function opsRenderArsiv() {
  const arsiv = isEmirleri.filter(e => e.durum === 'Teslim Edildi' || e.durum === 'İptal').sort((a,b) => b.id - a.id);
  const tbody = document.getElementById('ops-arsiv-body');
  if (!arsiv.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--muted);">Arşivde kayıt yok.</td></tr>`;
    return;
  }
  tbody.innerHTML = arsiv.map(e => {
    const kontNolar = (e.konteyner_no || '—').split('\n').filter(Boolean);
    const kontHtml  = kontNolar.map(k => `<div style="font-family:var(--font-mono);font-weight:600;font-size:11.5px;">${k}</div>`).join('');
    return `
    <tr>
      <td><span class="mono" style="color:var(--accent);">#${e.id}</span></td>
      <td>${e.musteri_adi || '—'}</td>
      <td><span class="plate-cell">${e.arac_plaka || '—'}</span></td>
      <td>${kontHtml}</td>
      <td><span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);padding:2px 7px;border-radius:4px;">${e.kont_tip || '—'}</span></td>
      <td><span style="font-size:11px;font-weight:600;color:${e.kont_durum==='Boş'?'var(--muted)':'var(--accent)'};">${e.kont_durum || '—'}</span></td>
      <td style="font-size:12px;color:var(--text2);">${e.yukle_yeri || '—'}</td>
      <td style="font-size:11.5px;color:var(--teal);">${e.bos_donus || '—'}</td>
      <td><span style="font-family:var(--font-mono);font-size:11.5px;">${opsFmtZaman(e.teslim_zamani)}</span></td>
      <td><span style="font-family:var(--font-mono);font-size:11.5px;color:var(--yellow);">${opsBeklemeSuresi(e.fabrika_giris, e.fabrika_cikis)}</span></td>
      <td><span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);padding:2px 7px;border-radius:99px;">${opsFotoArray(e).length}</span></td>
      <td class="col-islem">
        <button onclick="openOpsDrawer(${e.id})" class="icon-btn" title="Detay" style="color:var(--accent);border-color:rgba(232,82,26,.25);">⊙</button>
      </td>
    </tr>`;}).join('');
}

/* ── İŞ EMRİ MODAL ───────────────────────────────────────── */
let _opsDuzenlemeId = null; // null = yeni kayıt, number = düzenleme
let _opsSoforUserId = null; // Seçilen şoförün Supabase auth user_id'si

function openOpsIsEmriModal(duzenlemeObj) {
  _opsDuzenlemeId = duzenlemeObj ? duzenlemeObj.id : null;
  _opsSoforUserId = duzenlemeObj ? (duzenlemeObj.sofor_user_id || null) : null;

  // Başlık güncelle
  const titleEl = document.querySelector('#ops-modal-bg .maint-modal-title');
  if (titleEl) titleEl.textContent = _opsDuzenlemeId ? 'İŞ EMRİ DÜZENLE' : 'YENİ İŞ EMRİ';

  // Müşteri dropdown doldur (crmLoadData bitmemişse arka planda tamamlanır)
  _opsPopulateMusteriSelect();
  const mSel = document.getElementById('ops-m-musteri');
  // Müşteri listesi boşsa arka planda yükle
  if (!crmMusteriler.length) {
    crmLoadData().then(() => _opsPopulateMusteriSelect()).catch(() => {});
  }

  // Alanları temizle / duzenleme için doldur
  const d = duzenlemeObj || {};

  // Araç arama alanını doldur
  const aSel = document.getElementById('ops-m-arac');
  const aSearch = document.getElementById('ops-m-arac-search');
  if (aSel)    aSel.value    = d.arac_plaka || '';
  if (aSearch) aSearch.value = d.arac_plaka || '';
  // Dropdown'u gizle
  const aDD = document.getElementById('ops-arac-dropdown');
  if (aDD) aDD.style.display = 'none';

  if (d.musteri_id) mSel.value = d.musteri_id;
  const map = {
    sofor          : d.sofor,
    'sofor-tel'    : d.sofor_tel,
    konteyner      : d.konteyner_no,
    'kont-tip'     : d.kont_tip,
    'kont-durum'   : d.kont_durum,
    referans       : d.referans_no,
    muhur          : d.muhur_no,
    yukle          : d.yukle_yeri,
    teslim         : d.teslim_yeri,
    'bos-donus'    : d.bos_donus,
    'boslama-zaman': d.boslama_zaman,
    notlar         : d.notlar,
    'yukle-konum'  : d.yukle_konum_url  || '',
    'teslim-konum' : d.teslim_konum_url || '',
    'bas-km'       : (d.baslangic_km != null ? d.baslangic_km : ''),
    'bit-km'       : (d.bitis_km     != null ? d.bitis_km     : ''),
  };
  Object.entries(map).forEach(([k, v]) => {
    const el = document.getElementById('ops-m-' + k);
    if (el) el.value = v || '';
  });
  // Preview badge'leri güncelle
  ['yukle','teslim'].forEach(kind => {
    const inp = document.getElementById(`ops-m-${kind}-konum`);
    const prev = document.getElementById(`ops-m-${kind}-konum-preview`);
    if (inp && prev) opsKonumLinkPreview(inp, `ops-m-${kind}-konum-preview`);
  });

  document.getElementById('ops-modal-bg').classList.remove('hidden');
  setTimeout(() => { try { _opsKmAutoHint(); } catch(e) {} }, 50);
}

function openOpsIsEmriDuzenle(id) {
  const e = opsById(id);
  if (!e) return;
  openOpsIsEmriModal(e);
}
function closeOpsIsEmriModal() {
  document.getElementById('ops-modal-bg').classList.add('hidden');
}

/* İş emri formunda başlangıç/bitiş km girildiğinde canlı tahmini göster */
function _opsKmAutoHint() {
  const hintEl = document.getElementById('ops-km-hint');
  if (!hintEl) return;
  const bas = parseFloat(document.getElementById('ops-m-bas-km')?.value);
  const bit = parseFloat(document.getElementById('ops-m-bit-km')?.value);
  const aracPlaka = document.getElementById('ops-m-arac')?.value;
  if (!isFinite(bas) || !isFinite(bit) || bit <= bas) {
    hintEl.style.display = 'none'; return;
  }
  const dKm = bit - bas;
  const veh = vehicles.find(v => v.plaka === aracPlaka);
  if (!veh) {
    hintEl.style.display = 'block';
    hintEl.innerHTML = `📏 Mesafe: <strong>${dKm.toFixed(0)} km</strong> · Yakıt tahmini için araç seçin.`;
    return;
  }
  const r = calcFuelForKmRange(veh.id, bas, bit);
  const tlkm = calcAvgTLPerKm(veh.id);
  hintEl.style.display = 'block';
  if (r.count > 0) {
    hintEl.innerHTML =
      `📏 Mesafe: <strong>${dKm.toFixed(0)} km</strong> &nbsp;·&nbsp; ` +
      `⛽ ${r.litre.toLocaleString('tr-TR')} L &nbsp;·&nbsp; ` +
      `💰 <strong>${r.tl.toLocaleString('tr-TR')} ₺</strong> &nbsp;·&nbsp; ` +
      `${r.count} dolum (km aralığındaki)`;
  } else if (tlkm > 0) {
    const est = +(tlkm * dKm).toFixed(0);
    hintEl.innerHTML =
      `📏 Mesafe: <strong>${dKm.toFixed(0)} km</strong> &nbsp;·&nbsp; ` +
      `📈 TL/km ort. <strong>${tlkm.toLocaleString('tr-TR')}</strong> &nbsp;·&nbsp; ` +
      `tahmini yakıt <strong>~${est.toLocaleString('tr-TR')} ₺</strong> ` +
      `<span style="color:var(--muted);">(bu aralıkta dolum yok)</span>`;
  } else {
    hintEl.innerHTML =
      `📏 Mesafe: <strong>${dKm.toFixed(0)} km</strong> · Yakıt verisi yetersiz.`;
  }
}
/* ══════════════════════════════════════════════════════════════
   KONUM URL PARSER — Google Maps / Apple Maps / Yandex / Here
   Desteklenen formatlar:
     maps.google.com/maps?q=LAT,LNG
     maps.google.com/maps?ll=LAT,LNG
     google.com/maps/place/.../@LAT,LNG,ZOOMz
     google.com/maps/search/.../@LAT,LNG
     google.com/maps?q=LAT,LNG
     maps.app.goo.gl/<shortcode>  →  kısa link, tarayıcı redirect ile açılır (parse edilemez)
     goo.gl/maps/<id>              →  kısa link, parse edilemez
     maps.apple.com/?ll=LAT,LNG
     maps.apple.com/?q=LAT,LNG
     maps.here.com/?map=LAT,LNG
     share.here.com/l/LAT,LNG
     yandex.com.tr/maps/...?ll=LNG,LAT  (Yandex: lng önce!)
     openstreetmap.org/...#map=Z/LAT/LNG
     geo:LAT,LNG (Android intent)
══════════════════════════════════════════════════════════════ */
function parseKonumUrl(url) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();

  // ── geo:LAT,LNG URI ──
  const geoM = url.match(/^geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/i);
  if (geoM) return { lat: +geoM[1], lng: +geoM[2] };

  // ── Ham koordinat çifti "41.123,28.456" veya "41.123, 28.456" ──
  const rawCoord = url.match(/^(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})$/);
  if (rawCoord) return { lat: +rawCoord[1], lng: +rawCoord[2] };

  let parsed = null;
  try { parsed = new URL(url.startsWith('http')?url:'https://'+url); } catch { return null; }
  const href = parsed.href;
  const hostname = parsed.hostname.replace('www.','');
  const path = parsed.pathname;
  const params = parsed.searchParams;

  // ── Google Maps ──
  if (hostname.includes('google.') || hostname.includes('goo.gl')) {
    // @LAT,LNG,ZOOMz — most common format from share
    const atMatch = href.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/);
    if (atMatch) return { lat: +atMatch[1], lng: +atMatch[2] };
    // ?q=LAT,LNG
    const q = params.get('q') || params.get('query') || params.get('ll') || params.get('center');
    if (q) {
      const m = q.match(/^(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/);
      if (m) return { lat: +m[1], lng: +m[2] };
    }
    // daddr/saddr
    const addr = params.get('daddr') || params.get('saddr');
    if (addr) {
      const m = addr.match(/^(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/);
      if (m) return { lat: +m[1], lng: +m[2] };
    }
    // maps.app.goo.gl short links — cannot be resolved client-side
    if (hostname === 'maps.app.goo.gl' || (hostname === 'goo.gl' && path.startsWith('/maps'))) {
      return { _shortLink: true, url };
    }
    return null;
  }

  // ── Apple Maps ──
  if (hostname.includes('apple.com') && path.includes('maps')) {
    const ll = params.get('ll') || params.get('q');
    if (ll) { const m = ll.match(/^(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/); if (m) return { lat: +m[1], lng: +m[2] }; }
    return null;
  }

  // ── Here Maps ──
  if (hostname.includes('here.com')) {
    const map = params.get('map') || params.get('ll');
    if (map) { const m = map.match(/^(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/); if (m) return { lat: +m[1], lng: +m[2] }; }
    const pathM = path.match(/\/([-+]?\d+\.?\d+),([-+]?\d+\.?\d+)/);
    if (pathM) return { lat: +pathM[1], lng: +pathM[2] };
    return null;
  }

  // ── OpenStreetMap ──
  if (hostname.includes('openstreetmap.org')) {
    const fragM = parsed.hash.match(/map=\d+\/([-+]?\d+\.?\d+)\/([-+]?\d+\.?\d+)/);
    if (fragM) return { lat: +fragM[1], lng: +fragM[2] };
    const latP = params.get('mlat') || params.get('lat');
    const lngP = params.get('mlon') || params.get('lon');
    if (latP && lngP) return { lat: +latP, lng: +lngP };
    return null;
  }

  // ── Yandex Maps (ll=LNG,LAT — TERS!) ──
  if (hostname.includes('yandex.')) {
    const ll = params.get('ll');
    if (ll) { const m = ll.match(/^(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/); if (m) return { lat: +m[2], lng: +m[1] }; }
    const rtext = params.get('rtext');
    if (rtext) {
      const m = rtext.split('~')[1]?.match(/^(-?\d+\.?\d+),\s*(-?\d+\.?\d+)/);
      if (m) return { lat: +m[1], lng: +m[2] };
    }
    return null;
  }

  // ── what3words ──
  if (hostname.includes('what3words.com')) {
    return { _w3w: true, url }; // sunucu çözümleme gerekir
  }

  return null;
}

/* Konum link girişine yazınca anında ✓ / ⚠ badge'i göster */
function opsKonumLinkPreview(inputEl, previewId) {
  const val = inputEl.value.trim();
  const badge = document.getElementById(previewId);
  if (!badge) return;
  if (!val) { badge.style.display = 'none'; return; }
  const parsed = parseKonumUrl(val);
  if (!parsed) {
    badge.textContent = '⚠ Okunamadı';
    badge.style.cssText = 'display:inline-block;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:5px;font-size:10px;font-weight:700;padding:2px 7px;';
  } else if (parsed._shortLink) {
    badge.textContent = '🔗 Kısa link';
    badge.style.cssText = 'display:inline-block;background:rgba(234,179,8,.15);color:#eab308;border:1px solid rgba(234,179,8,.3);border-radius:5px;font-size:10px;font-weight:700;padding:2px 7px;';
  } else if (parsed._w3w) {
    badge.textContent = '///w3w';
    badge.style.cssText = 'display:inline-block;background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.3);border-radius:5px;font-size:10px;font-weight:700;padding:2px 7px;';
  } else {
    badge.textContent = `✓ ${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)}`;
    badge.style.cssText = 'display:inline-block;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);border-radius:5px;font-size:10px;font-weight:700;padding:2px 7px;';
  }
}

function saveOpsIsEmri() {
  const musteriId = document.getElementById('ops-m-musteri').value;
  const aracPlaka = document.getElementById('ops-m-arac').value;
  if (!musteriId || !aracPlaka) { showToast('Müşteri ve araç zorunlu', 'error'); return; }

  const musteriObj = typeof crmMusteriler !== 'undefined' ? crmMusteriler.find(m => m.id == musteriId) : null;

  if (_opsDuzenlemeId !== null) {
    // Düzenleme modu
    const e = opsById(_opsDuzenlemeId);
    if (!e) return;
    e.musteri_id   = parseInt(musteriId);
    e.musteri_adi  = musteriObj ? musteriObj.firma : e.musteri_adi;
    e.arac_plaka   = aracPlaka;
    e.sofor        = document.getElementById('ops-m-sofor').value.trim();
    e.sofor_tel    = document.getElementById('ops-m-sofor-tel').value.trim();
    e.sofor_user_id = _opsSoforUserId !== null ? _opsSoforUserId : (e.sofor_user_id || null);
    e.konteyner_no = document.getElementById('ops-m-konteyner').value.trim().toUpperCase();
    e.kont_tip     = document.getElementById('ops-m-kont-tip').value;
    e.kont_durum   = document.getElementById('ops-m-kont-durum').value;
    e.referans_no  = document.getElementById('ops-m-referans').value.trim().toUpperCase();
    e.muhur_no     = document.getElementById('ops-m-muhur').value.trim();
    e.yukle_yeri   = document.getElementById('ops-m-yukle').value.trim();
    e.teslim_yeri  = document.getElementById('ops-m-teslim').value.trim();
    e.bos_donus    = document.getElementById('ops-m-bos-donus').value.trim();
    e.boslama_zaman= document.getElementById('ops-m-boslama-zaman').value;
    e.notlar       = document.getElementById('ops-m-notlar').value.trim();
    // Km sayacı + yakıt cache
    const _bk = parseFloat(document.getElementById('ops-m-bas-km')?.value);
    const _bi = parseFloat(document.getElementById('ops-m-bit-km')?.value);
    e.baslangic_km = isFinite(_bk) ? _bk : null;
    e.bitis_km     = isFinite(_bi) ? _bi : null;
    // Yakıt maliyet cache (araç plakadan id'yi bul)
    if (e.baslangic_km != null && e.bitis_km != null && e.bitis_km > e.baslangic_km) {
      const _vh = vehicles.find(v => v.plaka === e.arac_plaka);
      if (_vh) {
        const r = calcFuelForKmRange(_vh.id, e.baslangic_km, e.bitis_km);
        e.yakit_litre = r.count ? r.litre : null;
        e.yakit_tutar = r.count ? r.tl    : null;
      }
    } else { e.yakit_litre = null; e.yakit_tutar = null; }
    // Konum linkleri
    const yukleKonumUrl  = document.getElementById('ops-m-yukle-konum')?.value.trim()  || '';
    const teslimKonumUrl = document.getElementById('ops-m-teslim-konum')?.value.trim() || '';
    e.yukle_konum_url  = yukleKonumUrl  || null;
    e.teslim_konum_url = teslimKonumUrl || null;
    const yk = parseKonumUrl(yukleKonumUrl);
    const tk = parseKonumUrl(teslimKonumUrl);
    if (yk) { e.yukle_lat  = yk.lat; e.yukle_lng  = yk.lng; }
    if (tk) { e.teslim_lat = tk.lat; e.teslim_lng = tk.lng; }
    opsSaveLocal();
    opsSaveCloud(e);
    closeOpsIsEmriModal();
    opsRenderStats(); opsRenderTable(); opsRenderKanban(); opsRenderArsiv();
    logActivity(`📝 İş emri güncellendi — <strong>${e.konteyner_no || e.arac_plaka}</strong>`);
    showToast('İş emri güncellendi ✓');
    return;
  }

  // Yeni kayıt modu
  const obj = {
    id             : opsNextId(),
    musteri_id     : parseInt(musteriId),
    musteri_adi    : musteriObj ? musteriObj.firma : '',
    arac_plaka     : aracPlaka,
    sofor          : document.getElementById('ops-m-sofor').value.trim(),
    sofor_tel      : document.getElementById('ops-m-sofor-tel').value.trim(),
    sofor_user_id  : _opsSoforUserId,
    konteyner_no   : document.getElementById('ops-m-konteyner').value.trim().toUpperCase(),
    kont_tip       : document.getElementById('ops-m-kont-tip').value,
    kont_durum     : document.getElementById('ops-m-kont-durum').value,
    referans_no    : document.getElementById('ops-m-referans').value.trim().toUpperCase(),
    muhur_no       : document.getElementById('ops-m-muhur').value.trim(),
    yukle_yeri     : document.getElementById('ops-m-yukle').value.trim(),
    teslim_yeri    : document.getElementById('ops-m-teslim').value.trim(),
    bos_donus      : document.getElementById('ops-m-bos-donus').value.trim(),
    boslama_zaman  : document.getElementById('ops-m-boslama-zaman').value,
    notlar         : document.getElementById('ops-m-notlar').value.trim(),
    yukle_konum_url : (() => { const v=document.getElementById('ops-m-yukle-konum')?.value.trim(); return v||null; })(),
    teslim_konum_url: (() => { const v=document.getElementById('ops-m-teslim-konum')?.value.trim(); return v||null; })(),
    yukle_lat      : (() => { const p=parseKonumUrl(document.getElementById('ops-m-yukle-konum')?.value||''); return p?.lat||null; })(),
    yukle_lng      : (() => { const p=parseKonumUrl(document.getElementById('ops-m-yukle-konum')?.value||''); return p?.lng||null; })(),
    teslim_lat     : (() => { const p=parseKonumUrl(document.getElementById('ops-m-teslim-konum')?.value||''); return p?.lat||null; })(),
    teslim_lng     : (() => { const p=parseKonumUrl(document.getElementById('ops-m-teslim-konum')?.value||''); return p?.lng||null; })(),
    baslangic_km   : (() => { const v=parseFloat(document.getElementById('ops-m-bas-km')?.value); return isFinite(v)?v:null; })(),
    bitis_km       : (() => { const v=parseFloat(document.getElementById('ops-m-bit-km')?.value); return isFinite(v)?v:null; })(),
    yakit_litre    : null,
    yakit_tutar    : null,
    durum          : 'Bekliyor',
    atama_zamani   : new Date().toISOString(),
    yola_zaman     : null,
    fabrika_giris  : null,
    fabrika_cikis  : null,
    teslim_zamani  : null,
    fotograflar    : '[]',
  };
  // Yakıt maliyet cache'i — km aralığı girildiyse hemen hesapla
  if (obj.baslangic_km != null && obj.bitis_km != null && obj.bitis_km > obj.baslangic_km) {
    const _vh = vehicles.find(v => v.plaka === obj.arac_plaka);
    if (_vh) {
      const r = calcFuelForKmRange(_vh.id, obj.baslangic_km, obj.bitis_km);
      if (r.count > 0) { obj.yakit_litre = r.litre; obj.yakit_tutar = r.tl; }
    }
  }
  isEmirleri.push(obj);
  opsSaveLocal();
  opsSaveCloud(obj).then(() => {
    // Cloud'dan _dbId döndükten sonra local'i tekrar kaydet
    opsSaveLocal();
  });
  closeOpsIsEmriModal();
  opsRenderStats(); opsRenderTable(); opsRenderKanban();
  updateOpsStatCard();
  logActivity(`📦 İş emri oluşturuldu — <strong>${obj.konteyner_no || obj.arac_plaka}</strong> · ${obj.musteri_adi}`);
  showToast('İş emri oluşturuldu ✓');
}

/* ── SİL ─────────────────────────────────────────────────── */
function deleteOpsIsEmri(id) {
  if (!confirm('Bu iş emrini silmek istiyor musunuz?')) return;
  const obj = isEmirleri.find(e => e.id === id || e._dbId === id);
  if (!obj) return;
  isEmirleri = isEmirleri.filter(e => e !== obj);
  opsSaveLocal();
  opsDeleteCloud(obj._dbId ?? obj.id);
  opsRenderStats();
  opsRenderTable();
  opsRenderKanban();
  opsRenderArsiv();
  showToast('İş emri silindi');
}

/* ── DRAWER ──────────────────────────────────────────────── */
function openOpsDrawer(id) {
  const e = opsById(id);
  if (!e) return;
  opsDrawerActiveId = id;
  const eId = e._dbId ?? e.id; // gerçek Supabase id (inline onclick'lerde kullanılır)

  document.getElementById('ops-drawer-title').textContent = e.konteyner_no ? e.konteyner_no.split('\n')[0] + (e.konteyner_no.split('\n').length > 1 ? ` +${e.konteyner_no.split('\n').length-1}` : '') : ('İş Emri #' + e.id);
  document.getElementById('ops-drawer-sub').textContent   =
    [e.arac_plaka, e.kont_tip, e.kont_durum, e.musteri_adi, e.sofor].filter(Boolean).join(' · ');

  // Durum + konteyner/mühür
  document.getElementById('ops-drawer-durum-row').innerHTML =
    opsDurumBadge(e.durum) +
    (e.muhur_no ? `<span style="font-family:var(--font-mono);font-size:11px;background:var(--surface3);border:1px solid var(--border);padding:2px 8px;border-radius:5px;">Mühür: ${e.muhur_no}</span>` : '');

  // Bağlantılı sefer kaydını bul
  const bagliSefer = seferData.find(s => s._opsId === e.id || s._opsId === e._dbId);

  // Şoför bağlantı durumu
  const soforBagliMi = !!e.sofor_user_id;
  const soforBagliHtml = soforBagliMi
    ? `<span style="font-size:10px;background:rgba(34,197,94,.15);color:var(--green);border:1px solid rgba(34,197,94,.3);border-radius:4px;padding:1px 7px;margin-left:6px;">✓ Uygulamaya bağlı</span>`
    : `<span style="font-size:10px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:4px;padding:1px 7px;margin-left:6px;">⚠ Bağlı değil</span>`;

  document.getElementById('ops-drawer-detaylar').innerHTML = [
    ['Müşteri',           e.musteri_adi || '—'],
    ['Araç',              e.arac_plaka  || '—'],
    ['Sürücü',            (e.sofor || '—') + soforBagliHtml],
    ['Sürücü Tel',        e.sofor_tel   || '—'],
    ['Konteyner No(lar)', (e.konteyner_no || '—').replace(/\n/g, ' · ')],
    ['Konteyner Tipi',    e.kont_tip    || '—'],
    ['Dolu / Boş',        e.kont_durum  || '—'],
    ['Referans No',       e.referans_no || '—'],
    ['Mühür No',          e.muhur_no    || '—'],
    ['Alım Noktası',      e.yukle_yeri  || '—'],
    ['Teslim Yeri',       e.teslim_yeri || '—'],
    ['Boş Dönüş',         e.bos_donus   || '—'],
    ['Bekleme Süresi',    opsBeklemeSuresi(e.fabrika_giris, e.fabrika_cikis)],
    ['Notlar',            e.notlar      || '—'],
  ].map(([k,v]) => `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`).join('') +
  (bagliSefer ? `<div style="margin-top:8px;background:rgba(167,139,250,.08);border-radius:9px;padding:10px 12px;border:1px solid rgba(167,139,250,.25);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:11px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.05em;">🗺 Sefer Kaydı</span>
      <button onclick="closeOpsDrawer();openSeferModal()" style="background:rgba(167,139,250,.18);border:1px solid rgba(167,139,250,.35);color:var(--purple);border-radius:5px;padding:2px 9px;font-size:10px;font-weight:700;cursor:pointer;">Görüntüle →</button>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:5px;">${bagliSefer.kalkis} → ${bagliSefer.varis}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      ${bagliSefer.km > 0   ? `<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--blue);">📏 ${bagliSefer.km} km</span>` : ''}
      ${bagliSefer.ucret > 0 ? `<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--green);font-weight:700;">₺${(bagliSefer.ucret||0).toLocaleString('tr-TR')}</span>` : ''}
      ${bagliSefer.tarih    ? `<span style="font-size:11px;color:var(--muted);">${bagliSefer.tarih}</span>` : ''}
    </div>
  </div>` : (e.durum === 'Teslim Edildi' ? '' : `<div style="margin-top:8px;opacity:.5;font-size:11px;color:var(--muted);padding:4px 0;">🗺 Sefer kaydı "Teslim Edildi" durumunda otomatik oluşturulur</div>`))
  + (!soforBagliMi && e.sofor ? `
    <div style="margin-top:10px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px 12px;">
      <div style="font-size:11px;color:var(--red);font-weight:700;margin-bottom:6px;">⚠ Şoför uygulamaya bağlı değil</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Şoför bu iş emrini kendi panelinde göremez. Daveti kabul ettikten sonra manuel olarak bağlayabilirsiniz.</div>
      <button id="ops-sofor-ata-btn-${eId}" onclick="opsManuelSoforAta(${eId})"
        style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;">
        🔗 Şoföre Bağla
      </button>
      <div id="ops-sofor-ata-secim-${eId}"></div>
    </div>` : '');

  // ⛽ Yakıt / Maliyet kartı — iş emrine düşen yakıt ve kâr hesabı
  const yakitCardEl = document.getElementById('ops-drawer-yakit-card');
  if (yakitCardEl) yakitCardEl.innerHTML = _opsYakitCardHtml(e);

  // Zaman çizelgesi
  const milestones = [
    { label: 'İş Emri Atandı',    zaman: e.atama_zamani,  },
    { label: 'Yola Çıkıldı',      zaman: e.yola_zaman,    },
    { label: 'Fabrika Girişi',     zaman: e.fabrika_giris, },
    { label: 'Fabrikadan Çıkış',   zaman: e.fabrika_cikis, },
    { label: 'Teslim Tamamlandı',  zaman: e.teslim_zamani, },
  ];
  const durumSira = ['Bekliyor','Yolda','Fabrikada','Fabrikada','Teslim Edildi'];
  const aktifIdx  = durumSira.indexOf(e.durum);
  document.getElementById('ops-drawer-timeline').innerHTML = milestones.map((m, i) => {
    const cls = m.zaman ? 'done' : (i === aktifIdx ? 'active' : 'pending');
    const icon = m.zaman ? '✓' : (i === aktifIdx ? '●' : '○');
    return `
      <div class="ops-tl-item">
        <div class="ops-tl-dot ${cls}">${icon}</div>
        <div class="ops-tl-body">
          <div class="ops-tl-label">${m.label}</div>
          <div class="ops-tl-time">${m.zaman ? opsFmtZaman(m.zaman) : '—'}</div>
        </div>
      </div>`;
  }).join('');

  // Fotoğraflar — fotograflar alanı string JSON veya array olabilir
  const fotos = opsFotoArray(e);
  document.getElementById('ops-drawer-foto-count').textContent = fotos.length;
  document.getElementById('ops-drawer-fotograflar').innerHTML = (fotos.length ?
    `<div class="ops-foto-grid">${fotos.map((f, fi) => `
      <div class="ops-foto-card" style="position:relative;">
        <img src="${f.url}" alt="${f.tip}" onclick="window.open('${f.url}','_blank')" style="cursor:pointer;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div style="display:none;align-items:center;justify-content:center;height:100%;font-size:24px;">📷</div>
        <div class="ops-foto-tip">${f.tip}</div>
        <button onclick="event.stopPropagation();opsFotoSil(${eId},${fi})" title="Fotoğrafı sil" style="position:absolute;top:4px;right:4px;background:rgba(239,68,68,.85);border:none;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;color:#fff;font-weight:900;line-height:1;padding:0;">✕</button>
      </div>`).join('')}</div>` :
    `<div class="ops-foto-empty">📷<br>Henüz fotoğraf yüklenmedi</div>`) +
    `<div style="margin-top:10px;">
      <label style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:border-color .15s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
        📎 Fotoğraf Ekle
        <input type="file" accept="image/*" multiple style="display:none;" onchange="opsFotoEkle(${eId}, this)">
      </label>
      <span style="font-size:10.5px;color:var(--muted);margin-left:8px;">JPG/PNG — cihazdan seç</span>
    </div>`;

  // Durum güncelleme butonları
  const durumSecenekler = ['Bekliyor','Yolda','Fabrikada','Teslim Edildi','İptal'].filter(d => d !== e.durum);
  document.getElementById('ops-drawer-actions').innerHTML = durumSecenekler.map(d => {
    const renk = { 'Bekliyor':'var(--yellow)','Yolda':'var(--blue)','Fabrikada':'var(--accent)','Teslim Edildi':'var(--green)','İptal':'var(--red)' }[d];
    return `<button onclick="opsGuncelleDurum(${eId},'${d}')" style="display:flex;align-items:center;gap:7px;background:var(--surface2);border:1px solid var(--border2);color:${renk};border-radius:8px;padding:8px 14px;font-family:var(--font-body);font-size:12.5px;font-weight:600;cursor:pointer;transition:border-color .15s;width:100%;" onmouseover="this.style.borderColor='${renk}'" onmouseout="this.style.borderColor='var(--border2)'">
      → ${d} olarak işaretle
    </button>`;
  }).join('');

  document.getElementById('ops-drawer-bg').classList.remove('hidden');
  document.getElementById('ops-drawer').classList.remove('hidden');
}
function closeOpsDrawer() {
  document.getElementById('ops-drawer-bg').classList.add('hidden');
  document.getElementById('ops-drawer').classList.add('hidden');
  opsDrawerActiveId = null;
}

/* ══════════════════════════════════════════════════════════════
   İŞ EMRİ — YAKIT / KÂR KARTI
   - baslangic_km & bitis_km doluysa aralıktaki dolumları toplar
   - bagli sefer kaydı varsa onun ucret'ini gelir olarak kullanır
══════════════════════════════════════════════════════════════ */
function _opsYakitCardHtml(e) {
  const veh = vehicles.find(v => v.plaka === e.arac_plaka);
  const bagliSefer = seferData.find(s => s._opsId === e.id || s._opsId === e._dbId);
  const ucret = +(bagliSefer?.ucret || 0);

  const hasKm = (e.baslangic_km != null && e.bitis_km != null && e.bitis_km > e.baslangic_km);
  const katedilenKm = hasKm ? (e.bitis_km - e.baslangic_km) : (bagliSefer?.km || 0);

  let litre = 0, tl = 0, count = 0, note = '';
  if (veh && hasKm) {
    const r = calcFuelForKmRange(veh.id, e.baslangic_km, e.bitis_km);
    litre = r.litre; tl = r.tl; count = r.count;
  } else if (e.yakit_tutar != null) {
    litre = +(e.yakit_litre || 0);
    tl    = +e.yakit_tutar;
    count = 0;
    note  = 'Önceden kaydedilmiş cache';
  } else if (veh && katedilenKm > 0) {
    // Fallback: ortalama TL/km × mesafe
    const tlkm = calcAvgTLPerKm(veh.id);
    if (tlkm > 0) {
      tl = +(tlkm * katedilenKm).toFixed(0);
      note = 'Tahmini (TL/km × mesafe)';
    }
  }

  if (!hasKm && tl === 0) {
    return `<div style="background:var(--surface2);border:1px dashed var(--border2);border-radius:10px;padding:14px;color:var(--muted);font-size:12px;line-height:1.6;">
      <strong>⛽ Yakıt & Maliyet</strong><br>
      Bu iş emrinde yakıt & kâr analizi için <strong>Başlangıç Km</strong> ve <strong>Bitiş Km</strong> girilmelidir.
      <div style="margin-top:8px;">
        <button onclick="openOpsIsEmriDuzenle(${e._dbId ?? e.id})" style="background:rgba(232,82,26,.12);border:1px solid rgba(232,82,26,.35);color:var(--accent);border-radius:6px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;">Km Bilgisi Ekle</button>
      </div>
    </div>`;
  }

  const tlPerKm = katedilenKm > 0 ? (tl / katedilenKm).toFixed(2) : '—';
  const lPer100 = (katedilenKm > 0 && litre > 0) ? ((litre * 100) / katedilenKm).toFixed(1) : '—';
  const netKar  = ucret > 0 ? (ucret - tl) : null;
  const karPct  = (ucret > 0) ? ((netKar / ucret) * 100).toFixed(1) : null;
  const karRenk = (netKar == null) ? 'var(--muted)' : (netKar >= 0 ? 'var(--green)' : 'var(--red)');

  const kpi = (label, val, sub='', color='var(--text)') =>
    `<div style="flex:1;min-width:110px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;padding:9px 11px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${label}</div>
      <div style="font-family:var(--font-mono);font-size:15px;font-weight:800;color:${color};margin-top:3px;">${val}</div>
      ${sub ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">${sub}</div>` : ''}
    </div>`;

  return `<div style="background:linear-gradient(135deg,rgba(59,130,246,.06),rgba(16,185,129,.06));border:1px solid var(--border2);border-radius:10px;padding:12px;">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      ${kpi('Mesafe', katedilenKm > 0 ? katedilenKm.toFixed(0) + ' km' : '—')}
      ${kpi('Yakıt', litre > 0 ? litre.toLocaleString('tr-TR') + ' L' : '—')}
      ${kpi('Yakıt TL', tl > 0 ? '₺' + tl.toLocaleString('tr-TR') : '—', '', 'var(--accent)')}
      ${kpi('TL/km', tlPerKm !== '—' ? '₺' + tlPerKm : '—')}
      ${kpi('L/100km', lPer100)}
      ${kpi('Gelir', ucret > 0 ? '₺' + ucret.toLocaleString('tr-TR') : '—', '', 'var(--blue)')}
      ${kpi('Net Kâr', (netKar != null) ? '₺' + netKar.toLocaleString('tr-TR') : '—',
            (karPct != null) ? ('%' + karPct + ' marj') : '', karRenk)}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted);">
      <span>${count > 0 ? `🔎 Bu aralıkta ${count} dolum eşleşti` : (note || 'Sefer bazlı hesap')}</span>
      ${hasKm ? `<span style="font-family:var(--font-mono);">Km: ${e.baslangic_km} → ${e.bitis_km}</span>` : ''}
    </div>
  </div>`;
}

/* ── DURUM GÜNCELLE ─────────────────────────────────────── */
async function opsGuncelleDurum(id, yeniDurum) {
  const e = opsById(id);
  if (!e) return;
  e.durum = yeniDurum;
  if (yeniDurum === 'Yolda'         && !e.yola_zaman)    e.yola_zaman    = new Date().toISOString();
  if (yeniDurum === 'Fabrikada'     && !e.fabrika_giris) e.fabrika_giris = new Date().toISOString();
  if (yeniDurum === 'Teslim Edildi' && !e.teslim_zamani) e.teslim_zamani = new Date().toISOString();
  // fabrika çıkışı — Fabrikada'dan başka duruma geçince otomatik kapat
  if (e.fabrika_giris && !e.fabrika_cikis && yeniDurum !== 'Fabrikada') {
    e.fabrika_cikis = new Date().toISOString();
  }
  opsSaveLocal();
  // Cloud'a kaydet ve _dbId'nin geri dönmesini bekle (sefer için gerekli)
  await opsSaveCloud(e);
  // Teslim Edildi → otomatik sefer kaydı oluştur (_dbId artık hazır)
  if (yeniDurum === 'Teslim Edildi') {
    opsAutoCreateSefer(e);
  }
  opsRenderStats();
  opsRenderTable();
  opsRenderKanban();
  opsRenderArsiv();
  updateOpsStatCard();
  openOpsDrawer(e._dbId ?? e.id); // drawer'ı güncel id ile aç
  logActivity(`📦 <strong>${e.konteyner_no||e.arac_plaka}</strong> → ${yeniDurum}`);
  showToast('Durum güncellendi: ' + yeniDurum);
}

/* ── DRAWER NOT EKLE ────────────────────────────────────── */
function opsDrawerNotEkle() {
  if (!opsDrawerActiveId) return;
  const inp = document.getElementById('ops-drawer-not-inp');
  if (!inp) return;
  const notMetin = inp.value.trim();
  if (!notMetin) { showToast('Not boş olamaz', 'error'); return; }
  const e = opsById(opsDrawerActiveId);
  if (!e) return;
  const tarih = new Date().toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  e.notlar = (e.notlar ? e.notlar + '\n' : '') + '[' + tarih + '] ' + notMetin;
  opsSaveLocal();
  opsSaveCloud(e);
  inp.value = '';
  // Drawer detaylar bölümünü güncelle
  const detaylar = document.getElementById('ops-drawer-detaylar');
  if (detaylar) {
    const rows = detaylar.querySelectorAll('.detail-row');
    rows.forEach(r => {
      const key = r.querySelector('.detail-key');
      if (key && key.textContent === 'Notlar') {
        const val = r.querySelector('.detail-val');
        if (val) val.textContent = e.notlar;
      }
    });
  }
  showToast('Not eklendi ✓');
}

/* ── ŞOFÖRE LİNK ─────────────────────────────────────────── */
function opsKopyalaLink() {
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  const useId = (e && e._dbId && e._dbId > 0) ? e._dbId : opsDrawerActiveId;
  if (!useId || useId < 0) {
    showToast('İş emri henüz Supabase\'e kaydedilmedi. Bekleyip tekrar deneyin.', 'error'); return;
  }
  const token = btoa('ops_' + useId + '_' + Date.now());
  const url   = window.location.origin + '/sofor.html?t=' + token;
  localStorage.setItem('ops_token_' + token, String(useId));
  navigator.clipboard.writeText(url).then(() => showToast('🔗 Şoför linki kopyalandı ✓')).catch(() => {
    prompt('Linki kopyalayın:', url);
  });
}

/* ── MÜŞTERİ PORTAL LİNKİ (ops drawer) ──────────────────── */
function opsPortalLink() {
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  if (!e || !e.musteri_id) { showToast('Bu iş emrinde müşteri atanmamış', 'error'); return; }
  if (!currentFirmaId) { showToast('Firma bilgisi yüklenemedi. Sayfayı yenileyin.', 'error'); return; }
  const tok = btoa('mtp_' + e.musteri_id + '_' + currentFirmaId);
  const base = window.location.href.replace(/[^/]*$/, '');
  const url  = base + 'portal.html?c=' + tok;
  navigator.clipboard.writeText(url)
    .then(() => showToast('📋 Müşteri portal linki kopyalandı!', 'success'))
    .catch(() => { prompt('Müşteri portal linki:', url); });
}

/* Tek sevkiyat için canlı takip linki (musteri_takip.html) */
function opsTekliTakipLink() {
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  if (!e) return;
  const dbId = e._dbId || e.id;
  if (!dbId || dbId < 0) {
    showToast('İş emri henüz kaydedilmedi. Lütfen bekleyin.', 'error'); return;
  }
  const tok = btoa('mtr_' + dbId + '_' + Date.now());
  const base = window.location.href.replace(/[^/]*$/, '');
  const url  = base + 'musteri_takip.html?m=' + tok;
  navigator.clipboard.writeText(url)
    .then(() => showToast('📍 Tekil takip linki kopyalandı!', 'success'))
    .catch(() => { prompt('Müşteri takip linki:', url); });
}

/* ── ARAÇ ARAMA (Autocomplete) ───────────────────────────── */
function opsAracAra(q) {
  const dd = document.getElementById('ops-arac-dropdown');
  if (!dd) return;
  const query = (q || '').toLowerCase().trim();
  const list = vehicles.filter(v =>
    !query ||
    (v.plaka  || '').toLowerCase().includes(query) ||
    (v.sofor  || '').toLowerCase().includes(query) ||
    (v.esleme || '').toLowerCase().includes(query)
  );
  if (!list.length) {
    dd.style.display = 'none';
    return;
  }
  const tipIcon = { 'Çekici':'🚛','Dorse':'🚚','Kamyon':'🚚','Kamyonet':'🛻','Binek Araç':'🚗' };
  dd.style.display = 'block';
  dd.innerHTML = list.map(v => `
    <div onclick="opsAracSec('${v.plaka}','${(v.sofor||'').replace(/'/g,"\\'")}','${(v.telefon||'').replace(/'/g,"\\'")}')"
      style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <span style="font-size:18px;flex-shrink:0">${tipIcon[v.tip]||'🚗'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:13px;">${v.plaka}</div>
        ${v.sofor ? `<div style="font-size:11px;color:var(--muted);">👤 ${v.sofor}${v.telefon?' · 📞 '+v.telefon:''}</div>` : ''}
        ${v.esleme ? `<div style="font-size:10px;color:var(--border2);">${v.esleme}</div>` : ''}
      </div>
      <span style="font-size:10px;color:var(--muted);background:var(--surface3);padding:2px 6px;border-radius:4px;">${v.tip||'—'}</span>
    </div>`).join('');
}

async function opsAracSec(plaka, sofor, tel) {
  document.getElementById('ops-m-arac').value        = plaka;
  document.getElementById('ops-m-arac-search').value = plaka;
  const soforEl = document.getElementById('ops-m-sofor');
  const telEl   = document.getElementById('ops-m-sofor-tel');
  if (soforEl && !soforEl.value && sofor) soforEl.value = sofor;
  if (telEl   && !telEl.value   && tel)   telEl.value   = tel;
  const dd = document.getElementById('ops-arac-dropdown');
  if (dd) dd.style.display = 'none';
  // Şoförün Supabase auth user_id'sini surucu_davetleri'nden bul
  _opsSoforUserId = null;
  try {
    const sb = getSB();
    const { data } = await sb
      .from('surucu_davetleri')
      .select('kullanan_user_id, ad, telefon')
      .not('kullanildi_at', 'is', null)
      .order('kullanildi_at', { ascending: false })
      .limit(50);
    if (data && data.length > 0) {
      const arananTel = (tel  || '').replace(/[\s\-\(\)]/g, '');
      const arananAd  = (sofor|| '').toLowerCase().trim();
      const eslesme =
        data.find(d => arananTel && (d.telefon||'').replace(/[\s\-\(\)]/g,'') === arananTel) ||
        data.find(d => arananAd  && (d.ad||'').toLowerCase().trim() === arananAd);
      if (eslesme?.kullanan_user_id) _opsSoforUserId = eslesme.kullanan_user_id;
    }
  } catch(e) { console.warn('opsAracSec: şoför user_id aranamadı', e); }
}

/* ── ŞOFÖR USER_ID EŞLEŞTIR (geriye dönük düzeltme) ─────── */
async function opsSoforUserIdEslestiir() {
  const sb = getSB();
  // Kabul edilmiş tüm davetleri arac_id dahil çek
  const { data: davetler, error: dErr } = await sb
    .from('surucu_davetleri')
    .select('kullanan_user_id, ad, telefon, arac_id')
    .not('kullanildi_at', 'is', null)
    .neq('iptal_mi', true);
  if (dErr || !davetler?.length) { console.warn('Davet listesi alınamadı', dErr); return 0; }

  // arac_id → normalize plaka haritası (vehicles dizisinden)
  const aracPlakaMap = {};
  davetler.forEach(d => {
    if (d.arac_id) {
      const v = (vehicles || []).find(v => v.id === d.arac_id);
      if (v?.plaka) aracPlakaMap[d.arac_id] = v.plaka.toUpperCase().replace(/\s/g, '');
    }
  });

  // sofor_user_id boş, buluta kaydedilmiş iş emirleri
  const bosIsEmirleri = (isEmirleri || []).filter(e => !e.sofor_user_id && e._dbId);
  if (!bosIsEmirleri.length) return 0;

  let guncellenen = 0;
  for (const e of bosIsEmirleri) {
    const arananPlaka = (e.arac_plaka || '').toUpperCase().replace(/\s/g, '');
    const arananTel   = (e.sofor_tel  || '').replace(/[\s\-\(\)]/g, '');
    const arananAd    = (e.sofor      || '').toLowerCase().trim();

    const eslesme =
      // 1) Plaka (en güvenilir: davet arac_id → vehicles → plaka → iş emri arac_plaka)
      davetler.find(d => d.arac_id && arananPlaka && aracPlakaMap[d.arac_id] === arananPlaka) ||
      // 2) Telefon (normalize: boşluk/tire/parantez yok)
      davetler.find(d => arananTel && (d.telefon||'').replace(/[\s\-\(\)]/g,'') === arananTel) ||
      // 3) Ad (son çare)
      davetler.find(d => arananAd && (d.ad||'').toLowerCase().trim() === arananAd);

    if (eslesme?.kullanan_user_id) {
      e.sofor_user_id = eslesme.kullanan_user_id;
      const res = await fetch(sbUrl('is_emirleri?id=eq.' + e._dbId), {
        method : 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
        body   : JSON.stringify({ sofor_user_id: eslesme.kullanan_user_id }),
      });
      if (res.ok) guncellenen++;
      else console.warn('sofor_user_id patch hata:', e._dbId, res.status);
    }
  }
  opsSaveLocal();
  return guncellenen;
}

/* ── MANUEL ŞOFÖRE BAĞLA (drawer'dan elle atama) ─────────── */
async function opsManuelSoforAta(dbId) {
  const sb = getSB();
  const btnEl = document.getElementById('ops-sofor-ata-btn-' + dbId);
  if (btnEl) { btnEl.textContent = '⌛ Yükleniyor…'; btnEl.disabled = true; }

  const { data: davetler, error } = await sb
    .from('surucu_davetleri')
    .select('kullanan_user_id, ad, telefon, arac_id')
    .not('kullanildi_at', 'is', null)
    .neq('iptal_mi', true)
    .order('kullanildi_at', { ascending: false });

  if (btnEl) { btnEl.textContent = '🔗 Şoföre Bağla'; btnEl.disabled = false; }

  if (error || !davetler?.length) {
    showToast('Kabul edilmiş davet bulunamadı. Şoförün önce daveti onaylaması gerekiyor.', 'error');
    return;
  }

  const konteyner = document.getElementById('ops-sofor-ata-secim-' + dbId);
  if (!konteyner) return;
  konteyner.innerHTML = `
    <div style="margin-top:8px;background:var(--surface2);border:1px solid var(--accent);border-radius:8px;padding:10px;">
      <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px;text-transform:uppercase;">Hangi şoförle eşleştirilsin?</div>
      ${davetler.map(d => {
        const plaka = d.arac_id ? ((vehicles||[]).find(v=>v.id===d.arac_id)?.plaka||'') : '';
        return `<button onclick="opsSoforAtaOnayla(${dbId},'${d.kullanan_user_id}',this)"
          style="display:block;width:100%;text-align:left;background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:8px 11px;margin-bottom:5px;cursor:pointer;font-family:var(--font-body);font-size:12.5px;color:var(--text);">
          👤 <strong>${d.ad}</strong>${d.telefon?'&nbsp;·&nbsp;📞 '+d.telefon:''}${plaka?'&nbsp;·&nbsp;🚛 '+plaka:''}
        </button>`;
      }).join('')}
      <button onclick="document.getElementById('ops-sofor-ata-secim-${dbId}').innerHTML=''" style="font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:2px;">İptal</button>
    </div>`;
}

async function opsSoforAtaOnayla(dbId, kullananUserId, clickedBtn) {
  if (clickedBtn) { clickedBtn.textContent = '⌛ Kaydediliyor…'; clickedBtn.disabled = true; }
  const res = await fetch(sbUrl('is_emirleri?id=eq.' + dbId), {
    method : 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body   : JSON.stringify({ sofor_user_id: kullananUserId }),
  });
  if (res.ok) {
    const e = isEmirleri.find(x => x._dbId == dbId || x._dbId === Number(dbId));
    if (e) { e.sofor_user_id = kullananUserId; opsSaveLocal(); }
    showToast('✅ Şoförle bağlandı! Şoför artık bu iş emrini görebilir.', 'success');
    if (opsDrawerActiveId != null) setTimeout(() => openOpsDrawer(opsDrawerActiveId), 200);
  } else {
    showToast('Bağlantı kurulamadı: ' + res.status, 'error');
    if (clickedBtn) { clickedBtn.textContent = '(tekrar dene)'; clickedBtn.disabled = false; }
  }
}

/* ── WHATSAPP PAYLAŞIMI ──────────────────────────────────── */
function opsWhatsappGonder() {
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  if (!e) return;

  const tel = (e.sofor_tel || '').replace(/\D/g, ''); // sadece rakam
  if (!tel) {
    showToast('Sürücü telefon numarası girilmemiş!', 'error');
    return;
  }

  const tarih = new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const kontNo = (e.konteyner_no || '—').replace(/\n/g, ', ');

  const mesaj = [
    `📦 *İŞ EMRİ #${e.id}*`,
    `━━━━━━━━━━━━━━`,
    `📅 Tarih: ${tarih}`,
    `🚛 Araç: ${e.arac_plaka || '—'}`,
    `👤 Sürücü: ${e.sofor || '—'}`,
    ``,
    `📋 Konteyner: ${kontNo}`,
    e.kont_tip    ? `📐 Tip: ${e.kont_tip}`           : null,
    e.kont_durum  ? `📊 Durum: ${e.kont_durum}`        : null,
    e.referans_no ? `🔖 Referans: ${e.referans_no}`    : null,
    e.muhur_no    ? `🔒 Mühür: ${e.muhur_no}`          : null,
    ``,
    `📍 Alım: ${e.yukle_yeri || '—'}`,
    `📍 Teslim: ${e.teslim_yeri || '—'}`,
    e.bos_donus   ? `↩ Boş Dönüş: ${e.bos_donus}`     : null,
    e.musteri_adi ? `🏢 Müşteri: ${e.musteri_adi}`     : null,
    e.notlar      ? `\n📝 Not: ${e.notlar}`            : null,
    ``,
    `_Fleetly - Filo Yönetim Sistemi_`,
  ].filter(x => x !== null).join('\n');

  // Türkiye numarası: 05XX → 905XX
  let waNum = tel;
  if (waNum.startsWith('0')) waNum = '90' + waNum.slice(1);
  else if (!waNum.startsWith('90')) waNum = '90' + waNum;

  const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(mesaj)}`;
  window.open(waUrl, '_blank');
  showToast('WhatsApp açılıyor…');
}

/* ── FOTOĞRAF SİL ────────────────────────────────────────── */
function opsFotoSil(isEmriId, fotoIndex) {
  if (!confirm('Bu fotoğrafı silmek istiyor musunuz?')) return;
  const e = opsById(isEmriId);
  if (!e) return;
  const fotos = opsFotoArray(e);
  fotos.splice(fotoIndex, 1);
  e.fotograflar = fotos;
  opsSaveLocal();
  opsSaveCloud(e);
  openOpsDrawer(isEmriId); // drawer'ı yenile
  showToast('Fotoğraf silindi.');
}

/* ── FOTOĞRAF EKLE (base64 — yerel önizleme) ────────────── */
function opsFotoEkle(isEmriId, inputEl) {
  const e = opsById(isEmriId);
  if (!e || !inputEl.files || inputEl.files.length === 0) return;
  const fotos = opsFotoArray(e);

  // Basit tip seçimi
  const tipler = ['Alım', 'Teslim', 'Konteyner', 'Hasarlı', 'Diğer'];
  const tipStr = tipler.map((t, i) => `${i+1}. ${t}`).join('  |  ');
  const secim  = prompt(`Fotoğraf tipi seçin (numara girin):\n${tipStr}`, '1');
  const tipIdx = parseInt(secim) - 1;
  const tip    = (tipIdx >= 0 && tipIdx < tipler.length) ? tipler[tipIdx] : 'Diğer';

  let processed = 0;
  const total = inputEl.files.length;
  Array.from(inputEl.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      fotos.push({ url: ev.target.result, tip, ts: new Date().toISOString() });
      processed++;
      if (processed === total) {
        e.fotograflar = fotos;
        opsSaveLocal();
        opsSaveCloud(e);
        openOpsDrawer(isEmriId);
        showToast(`${total} fotoğraf eklendi ✓`, 'success');
      }
    };
    reader.readAsDataURL(file);
  });
  inputEl.value = '';
}

/* ── TAMAMLANAN İŞ EMRİNDEN OTOMATİK SEFER OLUŞTUR ──────── */
function opsAutoCreateSefer(e) {
  // Aynı iş emrinden daha önce sefer oluşturulmuş mu?
  const mevcutSefer = seferData.find(s => s._opsId === e.id || s._opsId === e._dbId);
  if (mevcutSefer) return; // zaten var

  // ── 1) KM: koordinatlardan haversine mesafesi ──────────────
  function _haversine(la1,ln1,la2,ln2) {
    const R=6371,r=x=>x*Math.PI/180;
    const dLa=r(la2-la1),dLn=r(ln2-ln1);
    const a=Math.sin(dLa/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(dLn/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }
  let km = 0;
  const yLat=parseFloat(e.yukle_lat), yLng=parseFloat(e.yukle_lng);
  const tLat=parseFloat(e.teslim_lat), tLng=parseFloat(e.teslim_lng);
  if (isFinite(yLat) && isFinite(yLng) && isFinite(tLat) && isFinite(tLng)) {
    km = Math.round(_haversine(yLat, yLng, tLat, tLng));
  }

  // ── 2) ÜCRET: CRM siparişlerinden müşteri eşleştirmesi ─────
  // Bu ayın ya da en yakın tarihteki açık siparişin tutarını al
  let ucret = 0;
  if (e.musteri_id && crmSiparisler.length) {
    const musteriSiparisleri = crmSiparisler
      .filter(s => s.musteri_id == e.musteri_id && s.durum !== 'İptal' && (s.tutar||0) > 0)
      .sort((a,b) => b.tarih.localeCompare(a.tarih)); // en yeniden başla
    if (musteriSiparisleri.length) {
      ucret = musteriSiparisleri[0].tutar || 0;
    }
  }

  // ── 3) YÜK: konteyner bilgisi + müşteri ───────────────────
  const konteynerler = (e.konteyner_no || '').split('\n').map(s=>s.trim()).filter(Boolean);
  const yukStr = [
    konteynerler.join(', ') || null,
    e.kont_tip              || null,
    e.musteri_adi           || null,
  ].filter(Boolean).join(' · ');

  // ── 4) NOT: operasyon özeti ────────────────────────────────
  const notParcalar = [`Ops #${e.id}`];
  if (e.referans_no)  notParcalar.push(`Ref: ${e.referans_no}`);
  if (e.muhur_no)     notParcalar.push(`Mühür: ${e.muhur_no}`);
  if (e.kont_durum)   notParcalar.push(e.kont_durum);
  if (ucret > 0)      notParcalar.push(`CRM: ₺${ucret.toLocaleString('tr-TR')}`);

  // ── 5) ARAÇ ───────────────────────────────────────────────
  const veh = vehicles.find(v => v.plaka === e.arac_plaka);

  // ── 6) KM ARALIĞI: iş emrinden devral → daha doğru yakıt eşleşmesi ──
  const basKm = (e.baslangic_km != null) ? +e.baslangic_km : null;
  const bitKm = (e.bitis_km     != null) ? +e.bitis_km     : null;
  if (basKm != null && bitKm != null && bitKm > basKm && !km) {
    km = +(bitKm - basKm).toFixed(0);
  }
  // Yakıt cache'ini hemen hesapla
  let yakitLitre = null, yakitTutar = null;
  if (veh && basKm != null && bitKm != null && bitKm > basKm) {
    const r = calcFuelForKmRange(veh.id, basKm, bitKm);
    if (r.count > 0) { yakitLitre = r.litre; yakitTutar = r.tl; }
  }

  const seferEntry = {
    id     : uid(),
    _opsId : e._dbId ?? e.id,
    tarih  : e.teslim_zamani ? e.teslim_zamani.slice(0, 10) : new Date().toISOString().slice(0, 10),
    aracId : veh ? veh.id : '',
    plaka  : e.arac_plaka || '',
    sofor  : e.sofor      || '',
    kalkis : e.yukle_yeri  || '—',
    varis  : e.teslim_yeri || '—',
    km,
    baslangic_km: basKm,
    bitis_km    : bitKm,
    yakit_litre : yakitLitre,
    yakit_tutar : yakitTutar,
    yuk    : yukStr,
    ucret,
    not    : notParcalar.join(' · '),
  };

  seferData.push(seferEntry);
  saveSeferData();
  saveSeferEntryCloud(seferEntry);
  updateSeferStat();
  addActivity('sefer_ekle', seferEntry.plaka || '—', seferEntry.kalkis + ' → ' + seferEntry.varis);

  const kmStr   = km   > 0 ? ` · ${km} km`       : '';
  const ucretStr = ucret > 0 ? ` · ₺${ucret.toLocaleString('tr-TR')}` : '';
  showToast(`✅ Sefer kaydı oluşturuldu — ${seferEntry.kalkis} → ${seferEntry.varis}${kmStr}${ucretStr}`, 'success');
}


/* ─── OPS DASHBOARD STAT GÜNCELLEME ─────────────────────────── */
function updateOpsStatCard() {
  try {
    const aktif   = isEmirleri.filter(e => e.durum !== 'Teslim Edildi' && e.durum !== 'İptal').length;
    const teslim  = isEmirleri.filter(e => e.durum === 'Teslim Edildi').length;
    const yolda   = isEmirleri.filter(e => e.durum === 'Yolda').length;
    const fabrika = isEmirleri.filter(e => e.durum === 'Fabrikada').length;
    const elAktif   = document.getElementById('stat-ops-aktif');
    const elTeslim  = document.getElementById('stat-ops-teslim');
    const elYolda   = document.getElementById('stat-ops-yolda');
    const elFabrika = document.getElementById('stat-ops-fabrika');
    const elTrend   = document.getElementById('trend-ops');
    if (elAktif)   elAktif.textContent   = aktif;
    if (elTeslim)  elTeslim.textContent  = teslim;
    if (elYolda)   elYolda.textContent   = yolda;
    if (elFabrika) elFabrika.textContent = fabrika;
    if (elTrend)   elTrend.textContent   = aktif > 0 ? aktif + ' açık' : 'Hepsi teslim';
  } catch(err) { /* sessiz hata */ }
}

/* ─── INIT ─────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════
   MARKA & PORTAL AYARLARI MODALI
══════════════════════════════════════════════════════════════ */
async function openBrandingModal() {
  // Pre-fill from DB if possible
  let firma = '', logoUrl = '', markaRengi = '#e8521a';
  if (SB_URL && SB_ANON && currentFirmaId) {
    try {
      const r = await fetch(sbUrl(`firmalar?id=eq.${currentFirmaId}&select=firma,logo_url,marka_rengi`), { headers: sbHeaders() });
      if (r.ok) {
        const d = await r.json();
        if (d?.[0]) { firma = d[0].firma||''; logoUrl = d[0].logo_url||''; markaRengi = d[0].marka_rengi||'#e8521a'; }
      }
    } catch {}
  }
  document.getElementById('branding-firma').value      = firma;
  document.getElementById('branding-logo').value       = logoUrl;
  document.getElementById('branding-renk').value       = markaRengi;
  document.getElementById('branding-renk-hex').value   = markaRengi;
  brandingPreview();
  document.getElementById('branding-modal-bg').classList.remove('hidden');
}
function closeBrandingModal() {
  document.getElementById('branding-modal-bg').classList.add('hidden');
}
function brandingPreview() {
  const c = document.getElementById('branding-renk').value;
  document.getElementById('branding-hex-preview').style.background = c;
  document.getElementById('branding-renk-hex').value = c;
  const logoUrl = document.getElementById('branding-logo').value.trim();
  const mark = document.getElementById('branding-mark-preview');
  if (logoUrl) {
    mark.innerHTML = `<img src="${logoUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:8px;" onerror="this.style.display='none'">`;
    mark.style.background = '#fff';
  } else {
    const firma = document.getElementById('branding-firma').value.trim();
    mark.innerHTML = firma ? firma.charAt(0).toUpperCase() : '⬡';
    mark.style.background = `linear-gradient(135deg,${c},${c}cc)`;
  }
}
function brandingHexInput() {
  const hex = document.getElementById('branding-renk-hex').value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    document.getElementById('branding-renk').value = hex;
    brandingPreview();
  }
}
async function saveBranding() {
  const firma      = document.getElementById('branding-firma').value.trim();
  const logo_url   = document.getElementById('branding-logo').value.trim() || null;
  const marka_rengi= document.getElementById('branding-renk').value;
  if (!firma) { showToast('Firma adı boş olamaz', 'error'); return; }
  if (!SB_URL || !SB_ANON || !currentFirmaId) {
    showToast('Supabase bağlantısı yok — demo modda kaydedilemez', 'error');
    closeBrandingModal(); return;
  }
  try {
    const r = await fetch(sbUrl(`firmalar?id=eq.${currentFirmaId}`), {
      method: 'PATCH',
      headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ firma, logo_url, marka_rengi })
    });
    if (r.ok) {
      showToast('✅ Marka ayarları kaydedildi!', 'success');
      closeBrandingModal();
    } else {
      showToast('Kayıt hatası: ' + r.status, 'error');
    }
  } catch { showToast('Bağlantı hatası', 'error'); }
}
