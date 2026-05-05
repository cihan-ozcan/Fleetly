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
// Harcırah kayıt cache: { is_emri_id → kayıt } — kanban/tablo render'ında pill için
let _opsHarcirahCache = {};

/* Harcırah kayıtlarını yükle ve is_emri_id'ye göre cache'le */
async function opsHarcirahCacheYukle() {
  if (typeof HarcirahAPI === 'undefined') return;
  try {
    const list = await HarcirahAPI.kayitList({});
    const map = {};
    (list || []).forEach(k => { if (k.is_emri_id != null) map[String(k.is_emri_id)] = k; });
    _opsHarcirahCache = map;
  } catch (e) {
    console.warn('[ops] harcirah cache yüklenemedi:', e.message || e);
  }
}

function opsHarcirahKayit(isEmriId) {
  return _opsHarcirahCache[String(isEmriId)] || null;
}

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
    yakit_litre      : r.yakit_litre   != null ? parseFloat(r.yakit_litre)  : null,
    yakit_tutar      : r.yakit_tutar   != null ? parseFloat(r.yakit_tutar)  : null,
    diger_masraf     : r.diger_masraf  != null ? parseFloat(r.diger_masraf) : null,
    /* ── POD (Teslim Belgesi) ── */
    teslim_alan_ad      : r.teslim_alan_ad      || null,
    teslim_not_musteri  : r.teslim_not_musteri   || null,
    imza_url            : r.imza_url             || null,
    pod_taslak_url      : r.pod_taslak_url      || null,
    pod_final_url       : r.pod_final_url       || null,
    pod_olusturma_zaman : r.pod_olusturma_zaman || null,
    pod_onay_zaman      : r.pod_onay_zaman      || null,
    pod_onaylayan       : r.pod_onaylayan       || null,
    pod_onay_notu       : r.pod_onay_notu       || null,
    pod_durum           : r.pod_durum           || null,
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

  // Filo (Çekici/Dorse) FK'leri — yalnızca migration uygulanmışsa payload'a ekle.
  // Aksi halde "column does not exist" 400 hatası tüm iş emri kaydını bozar.
  // FiloAPI.isMigrationMissing() ilk dorseTipleri/aktifEslesmeler çağrısında doğru bayrağı koyar.
  const _migMissing = window.FiloAPI && window.FiloAPI.isMigrationMissing && window.FiloAPI.isMigrationMissing();
  if (!_migMissing) {
    if (obj.cekici_id !== undefined) row.cekici_id = obj.cekici_id || null;
    if (obj.dorse_id  !== undefined) row.dorse_id  = obj.dorse_id  || null;
  }
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
  opsRenderAll();
  opsStartClock();
  await opsLoadCloud();
  // sofor_user_id eksik iş emirleri varsa geriye dönük eşleştir
  opsSoforUserIdEslestiir().then(n => { if (n > 0) console.log(`${n} iş emrine sofor_user_id atandı`); }).catch(()=>{});
  // Harcırah kayıtlarını cache'le (kanban/tablo pill'leri için)
  await opsHarcirahCacheYukle();
  opsRenderAll();
  opsStartRealtime();
}
function closeOperasyonPage() {
  document.getElementById('operasyon-page').classList.remove('open');
  document.body.style.overflow = '';
  opsStopRealtime();
  opsStopClock();
}

/* ── CANLI saat (AppBar) ─────────────────────────────────── */
let _opsClockTimer = null;
function opsStartClock() {
  const tick = () => {
    const el = document.getElementById('ops-clock');
    if (!el) return;
    const d = new Date();
    el.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  tick();
  if (_opsClockTimer) clearInterval(_opsClockTimer);
  _opsClockTimer = setInterval(tick, 30000);
}
function opsStopClock() {
  if (_opsClockTimer) { clearInterval(_opsClockTimer); _opsClockTimer = null; }
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
  const aktifAcil = isEmirleri.filter(e =>
    e.durum !== 'İptal' && e.durum !== 'Teslim Edildi' &&
    typeof opsAlertInfo === 'function' && opsAlertInfo(e).level === 'alert'
  ).length;

  const cells = [
    { val: toplam,    lbl: 'Toplam İş Emri', sub: 'tüm aktif', active: false },
    { val: bekliyor,  lbl: 'Bekliyor',       sub: 'atanmadı',  active: false,
      trend: bekliyor ? `<span class="ops-kpi__trend ops-kpi__trend--warn">${bekliyor} aday</span>` : '' },
    { val: yolda,     lbl: 'Yolda',          sub: 'aktif sevkiyat', active: true,
      trend: aktifAcil ? `<span class="ops-kpi__trend ops-kpi__trend--down">▼ ${aktifAcil} acil</span>` : '' },
    { val: fabrikada, lbl: 'Fabrikada',      sub: 'boşaltma',  active: false },
    { val: teslim,    lbl: 'Teslim',         sub: 'tamamlandı', active: false,
      trend: teslim ? `<span class="ops-kpi__trend ops-kpi__trend--up">▲ +${teslim} bugün</span>` : '' },
  ];

  document.getElementById('ops-stat-bar').innerHTML = cells.map(c => `
    <div class="ops-kpi__cell${c.active ? ' is-active' : ''}">
      <div class="ops-kpi__label">${c.lbl}</div>
      <div class="ops-kpi__row">
        <span class="ops-kpi__value">${c.val}</span>
        ${c.trend || ''}
      </div>
      <div class="ops-kpi__sub">${c.sub}</div>
    </div>`).join('');
}

/* ── DİKKAT BANDI (geciken / sinyalsiz / ETA aşımı) ───────── */
function opsRenderAlertBar() {
  const bar = document.getElementById('ops-alert-bar');
  if (!bar) return;
  // Dismiss penceresi (4 saat) içindeyse gösterme
  try {
    const until = parseInt(sessionStorage.getItem('ops_alert_dismiss_until') || '0', 10);
    if (until && Date.now() < until) {
      bar.style.cssText = 'display:none;';
      bar.innerHTML = '';
      return;
    }
  } catch {}
  const aktif = isEmirleri.filter(e => e.durum !== 'İptal' && e.durum !== 'Teslim Edildi');
  const dikkat = aktif
    .map(e => ({ e, info: opsAlertInfo(e) }))
    .filter(x => x.info.level !== 'normal');
  if (!dikkat.length) {
    bar.style.cssText = 'display:none;';
    bar.innerHTML = '';
    return;
  }
  // En kritik kaydı öne çıkar (alert > warn). Çoklu vakada CTA "Detay" en kritik kaydı açar.
  dikkat.sort((a, b) => (a.info.level === 'alert' ? -1 : 1) - (b.info.level === 'alert' ? -1 : 1));
  const top = dikkat[0];
  const alerts = dikkat.filter(x => x.info.level === 'alert').length;
  const warns  = dikkat.filter(x => x.info.level === 'warn').length;
  const labelTxt = alerts ? `${alerts} ACİL` : `${warns} UYARI`;
  const plate = top.e.arac_plaka || (top.e.konteyner_no || '').split('\n')[0] || `#${top.e.id}`;
  const reason = top.info.reasons[0] || '';
  const escAttr = s => String(s).replace(/"/g,'&quot;');

  bar.style.cssText = '';
  bar.innerHTML = `
    <div class="ops-alert" onclick="openOpsDrawer(${top.e.id})" role="button" tabindex="0">
      <span class="ops-alert__bang" aria-hidden="true">!</span>
      <span class="ops-alert__label">${labelTxt}</span>
      <span class="ops-alert__plate">${plate}</span>
      <span class="ops-alert__msg" title="${escAttr(top.info.reasons.join(' • '))}">${reason}${dikkat.length > 1 ? ` <span style="color:var(--text-dim);">· +${dikkat.length - 1} daha</span>` : ''}</span>
      <span class="ops-alert__actions">
        ${top.e.sofor_tel ? `<a class="ops-btn ops-btn--ghost ops-btn--sm" href="tel:${escAttr(top.e.sofor_tel)}" onclick="event.stopPropagation()">📞 Sürücüyü Ara</a>` : ''}
        <button class="ops-btn ops-btn--danger ops-btn--sm" onclick="event.stopPropagation();openOpsDrawer(${top.e.id})">Detay</button>
        <button class="ops-icon-btn ops-icon-btn--sm" title="Bandı kapat" onclick="event.stopPropagation();opsAlertDismiss()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>
    </div>`;
}

/* Acil bandı kapatma — 4 saat sessize alır */
function opsAlertDismiss() {
  try {
    const until = Date.now() + 4 * 60 * 60 * 1000;
    sessionStorage.setItem('ops_alert_dismiss_until', String(until));
  } catch {}
  const bar = document.getElementById('ops-alert-bar');
  if (bar) { bar.style.cssText = 'display:none;'; bar.innerHTML = ''; }
}

/* ── KANBAN SÜRÜKLE-BIRAK ─────────────────────────────────── */
let _opsDragId = null;

function opsKanbanDragStart(ev, id) {
  _opsDragId = id;
  try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(id)); } catch {}
  ev.currentTarget.classList.add('is-dragging');
}
function opsKanbanDragEnd(ev) {
  ev.currentTarget.classList.remove('is-dragging');
  document.querySelectorAll('#operasyon-page .ops-kanban__col').forEach(c => c.classList.remove('is-droptarget'));
}
function opsKanbanDragOver(ev) {
  ev.preventDefault();
  try { ev.dataTransfer.dropEffect = 'move'; } catch {}
  ev.currentTarget.classList.add('is-droptarget');
}
function opsKanbanDragLeave(ev) {
  ev.currentTarget.classList.remove('is-droptarget');
}
async function opsKanbanDrop(ev, hedefDurum) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('is-droptarget');
  const id = _opsDragId || parseInt(ev.dataTransfer.getData('text/plain'), 10);
  _opsDragId = null;
  if (!id) return;
  const e = opsById(id);
  if (!e) return;
  if (e.durum === hedefDurum) return;
  // Riskli geçişlerde onay iste
  if (hedefDurum === 'Teslim Edildi') {
    if (!confirm(`#${e.id} (${e.arac_plaka || ''}) "Teslim Edildi" olarak işaretlensin mi? Bu işlem sefer kaydı oluşturur.`)) return;
  }
  try {
    await opsGuncelleDurum(id, hedefDurum);
    showToast(`#${e.id} → ${hedefDurum}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Durum güncellenemedi: ' + (err?.message || 'hata'), 'error');
  }
}

/* ── GÜZERGAH HARİTASI (Drawer içi) ──────────────────────── */
let _opsGuzergahMap = null;
let _opsGuzergahLayers = []; // polyline + markerlar

function _opsGuzergahHaritaInit() {
  const el = document.getElementById('ops-drawer-guzergah-map');
  if (!el || _opsGuzergahMap) return _opsGuzergahMap;
  _opsGuzergahMap = L.map(el, { zoomControl: true, attributionControl: false }).setView([39.9, 32.8], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(_opsGuzergahMap);
  L.control.attribution({ prefix: '© OpenStreetMap' }).addTo(_opsGuzergahMap);
  return _opsGuzergahMap;
}

function _opsGuzergahHaritaTemizle() {
  _opsGuzergahLayers.forEach(l => { try { _opsGuzergahMap.removeLayer(l); } catch {} });
  _opsGuzergahLayers = [];
}

/** Drawer'daki aktif iş emri için konum_izleri çek, çiz */
async function opsGuzergahYukle() {
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  if (!e) return;
  const dbId = e._dbId || e.id;
  const sec      = document.getElementById('ops-drawer-guzergah-section');
  const mapEl    = document.getElementById('ops-drawer-guzergah-map');
  const statsEl  = document.getElementById('ops-drawer-guzergah-stats');
  const cntEl    = document.getElementById('ops-drawer-guzergah-count');
  const emptyEl  = document.getElementById('ops-drawer-guzergah-empty');
  const btn      = document.getElementById('ops-drawer-guzergah-refresh');
  if (!sec || !mapEl) return;

  if (btn) { btn.disabled = true; btn.textContent = '↻ Yükleniyor...'; }

  try {
    const sb = getSB();
    if (!sb) throw new Error('Supabase istemcisi yok');
    const { data, error } = await sb
      .from('konum_izleri')
      .select('lat,lng,hiz,ts')
      .eq('is_emri_id', dbId)
      .order('ts', { ascending: true });
    if (error) throw error;

    const izler = data || [];
    if (cntEl) {
      cntEl.textContent = izler.length;
      cntEl.style.display = izler.length ? '' : 'none';
    }

    if (!izler.length) {
      mapEl.style.display    = 'none';
      statsEl.innerHTML      = '';
      emptyEl.style.display  = '';
      return;
    }
    mapEl.style.display    = '';
    emptyEl.style.display  = 'none';

    // İstatistik hesapla
    const dist = (a, b) => {
      const R = 6371, toRad = d => d*Math.PI/180;
      const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
      const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
      return R * 2 * Math.asin(Math.sqrt(x));
    };
    let toplamKm = 0;
    let hizSayac = 0, hizToplam = 0;
    for (let i = 1; i < izler.length; i++) {
      toplamKm += dist(izler[i-1], izler[i]);
      if (izler[i].hiz != null && izler[i].hiz > 0) { hizToplam += +izler[i].hiz; hizSayac++; }
    }
    const sureMs = new Date(izler[izler.length-1].ts) - new Date(izler[0].ts);
    const sureDk = Math.round(sureMs / 60000);
    const sureStr = sureDk < 60 ? `${sureDk} dk` : `${Math.floor(sureDk/60)}s ${sureDk%60}dk`;
    const ortHiz  = hizSayac ? Math.round(hizToplam / hizSayac) : null;
    const baslaStr = new Date(izler[0].ts).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const bitirStr = new Date(izler[izler.length-1].ts).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

    statsEl.innerHTML = `
      <span title="Toplam katedilen mesafe" style="background:rgba(56,189,248,.10);border:1px solid rgba(56,189,248,.25);color:var(--blue);padding:3px 10px;border-radius:5px;font-weight:700;">📏 ${toplamKm.toFixed(1)} km</span>
      <span title="GPS sürelerine göre" style="background:rgba(99,102,241,.10);border:1px solid rgba(99,102,241,.25);color:var(--accent);padding:3px 10px;border-radius:5px;">⏱ ${sureStr}</span>
      ${ortHiz != null ? `<span title="GPS ortalama hızı" style="background:var(--surface3);border:1px solid var(--border2);color:var(--text);padding:3px 10px;border-radius:5px;">🚚 ort ${ortHiz} km/sa</span>` : ''}
      <span style="background:var(--surface3);border:1px solid var(--border2);color:var(--text2);padding:3px 10px;border-radius:5px;">${izler.length} nokta</span>
      <span style="color:var(--muted);font-size:10.5px;align-self:center;">${baslaStr} → ${bitirStr}</span>`;

    // Harita
    _opsGuzergahHaritaInit();
    setTimeout(() => _opsGuzergahMap.invalidateSize(), 60);
    _opsGuzergahHaritaTemizle();

    const latlngs = izler.map(p => [p.lat, p.lng]);
    const polyline = L.polyline(latlngs, { color: '#38bdf8', weight: 4, opacity: .9 }).addTo(_opsGuzergahMap);
    _opsGuzergahLayers.push(polyline);

    // Başlangıç markeri (yeşil)
    const startIcon = L.divIcon({
      className: 'ops-marker-start',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7]
    });
    const endIcon = L.divIcon({
      className: 'ops-marker-end',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7]
    });
    const m1 = L.marker(latlngs[0], { icon: startIcon, title: 'Başlangıç: ' + baslaStr }).addTo(_opsGuzergahMap);
    const m2 = L.marker(latlngs[latlngs.length-1], { icon: endIcon, title: 'Son nokta: ' + bitirStr }).addTo(_opsGuzergahMap);
    _opsGuzergahLayers.push(m1, m2);

    _opsGuzergahMap.fitBounds(polyline.getBounds(), { padding: [20, 20] });
  } catch (err) {
    console.error('Güzergah yükleme hatası:', err);
    if (statsEl) statsEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.textContent = 'Güzergah yüklenemedi: ' + (err?.message || 'hata');
    }
    if (mapEl) mapEl.style.display = 'none';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Yenile'; }
  }
}

/* ── "NEREDESİN?" PUSH GÖNDER ─────────────────────────────── */
async function opsPushNeredesin(opsId) {
  const e = isEmirleri.find(x => x.id === opsId);
  if (!e) return;
  const surucuId = e.surucu_id || e.sofor_user_id;
  if (!surucuId) {
    showToast('Bu işe bağlı sürücü bulunamadı', 'error');
    return;
  }
  const btn = document.getElementById('ops-push-neredesin-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = '📡 Gönderiliyor...'; }
  try {
    const sb = getSB();
    if (!sb) throw new Error('Supabase istemcisi yok');
    const plaka = e.arac_plaka || '';
    const { error } = await sb.functions.invoke('notify-driver', {
      body: {
        surucu_id : surucuId,
        is_emri_id: e._dbId || e.id,
        title     : '📡 Operasyon: Neredesin?',
        body      : (plaka ? `${plaka} — ` : '') + 'Operasyon ekibi konumunuzu sordu. Lütfen uygulamayı açın.',
        url       : '/sofor.html'
      }
    });
    if (error) throw error;
    showToast('Sürücüye bildirim gönderildi', 'success');
    if (btn) { btn.textContent = '✓ Gönderildi'; setTimeout(() => { if(btn){btn.disabled=false;btn.style.opacity='';btn.textContent='📡 Neredesin?';}}, 4000); }
  } catch (err) {
    console.error('Push gönderim hatası:', err);
    showToast('Bildirim gönderilemedi: ' + (err?.message || 'hata'), 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '📡 Neredesin?'; }
  }
}

/* ── REALTIME SUBSCRIPTION + PERİYODİK YENİDEN RENDER ────── */
let _opsRealtimeChannel = null;
let _opsAutoRefreshTimer = null;
let _opsTickTimer = null;

function opsStartRealtime() {
  if (_opsRealtimeChannel) return; // already subscribed
  const sb = getSB();
  if (!sb) return;
  try {
    _opsRealtimeChannel = sb
      .channel('ops-is-emirleri')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'is_emirleri' },
          () => { opsLoadCloud().then(() => { opsRenderAll(); }); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Ops realtime hata, polling fallback devrede');
        }
      });
  } catch (err) {
    console.warn('Realtime subscribe hata:', err);
  }
  // Yedek: realtime düşerse bile her 30sn'de bir bulut çek
  if (!_opsAutoRefreshTimer) {
    _opsAutoRefreshTimer = setInterval(() => {
      if (!document.getElementById('operasyon-page')?.classList.contains('open')) return;
      opsLoadCloud().then(() => opsRenderAll()).catch(()=>{});
    }, 30000);
  }
  // Tick: süre/konum yaşı saniye saniye değişmesin diye 20sn'de re-render
  if (!_opsTickTimer) {
    _opsTickTimer = setInterval(() => {
      if (!document.getElementById('operasyon-page')?.classList.contains('open')) return;
      opsRenderKanban();
      opsRenderTable();
      opsRenderAlertBar();
    }, 20000);
  }
}
function opsStopRealtime() {
  try { if (_opsRealtimeChannel) getSB()?.removeChannel(_opsRealtimeChannel); } catch {}
  _opsRealtimeChannel = null;
  if (_opsAutoRefreshTimer) { clearInterval(_opsAutoRefreshTimer); _opsAutoRefreshTimer = null; }
  if (_opsTickTimer) { clearInterval(_opsTickTimer); _opsTickTimer = null; }
}

/* Tüm operasyon görünümlerini tek seferde yenile */
function opsRenderAll() {
  opsRenderStats();
  opsRenderAlertBar();
  opsRenderTable();
  opsRenderKanban();
  opsRenderArsiv();
  if (typeof updateOpsStatCard === 'function') updateOpsStatCard();
}

/* ── DURUM BADGE HTML ────────────────────────────────────── */
function opsDurumBadge(durum, opts) {
  const tone = ({
    'Bekliyor':      'neutral',
    'Yolda':         'info',
    'Fabrikada':     'purple',
    'Teslim Edildi': 'success',
    'İptal':         'danger',
  })[durum] || 'neutral';
  const suffix = opts && opts.suffix ? `<span style="opacity:.75;font-weight:500;">· ${opts.suffix}</span>` : '';
  return `<span class="ops-pill ops-pill--${tone}"><span class="ops-pill__dot"></span>${durum}${suffix}</span>`;
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

/* ── GEÇEN SÜREYİ "x dk önce / 2s 14dk" GİBİ FORMATLA ─────── */
function opsRelTime(iso) {
  if (!iso) return '';
  const dk = Math.round((Date.now() - new Date(iso)) / 60000);
  if (!isFinite(dk) || dk < 0) return '';
  if (dk < 1) return 'az önce';
  if (dk < 60) return dk + ' dk önce';
  const h = Math.floor(dk / 60), m = dk % 60;
  if (h < 24) return m ? `${h}s ${m}dk önce` : `${h}s önce`;
  const g = Math.floor(h / 24);
  return g + ' gün önce';
}

/* ── BİR İŞ EMRİNİN "DİKKAT" SİNYALLERİNİ HESAPLA ─────────── */
/* Döner: { level: 'normal'|'warn'|'alert', reasons: [string], color: cssVar }
   - alert : >6 saat yolda, >2 saat fabrikada, son konum >30dk önce
   - warn  : >3 saat yolda, >1 saat fabrikada, son konum >15dk önce, ETA aşıldı       */
function opsAlertInfo(e) {
  const reasons = [];
  let level = 'normal';
  const now = Date.now();
  const dur = e.durum || 'Bekliyor';

  if (dur === 'Yolda' && e.yola_zaman) {
    const dk = Math.round((now - new Date(e.yola_zaman)) / 60000);
    if (dk > 360)      { level = 'alert'; reasons.push(`6+ saattir yolda (${Math.floor(dk/60)}s)`); }
    else if (dk > 180) { if (level==='normal') level='warn'; reasons.push(`3+ saattir yolda (${Math.floor(dk/60)}s ${dk%60}dk)`); }
  }
  if (dur === 'Fabrikada' && e.fabrika_giris && !e.fabrika_cikis) {
    const dk = Math.round((now - new Date(e.fabrika_giris)) / 60000);
    if (dk > 120)     { level = 'alert'; reasons.push(`Fabrikada 2+ saat (${Math.floor(dk/60)}s ${dk%60}dk)`); }
    else if (dk > 60) { if (level==='normal') level='warn'; reasons.push(`Fabrikada 1+ saat (${dk} dk)`); }
  }
  if (['Yolda','Fabrikada'].includes(dur) && e.konum_zaman) {
    const dk = Math.round((now - new Date(e.konum_zaman)) / 60000);
    if (dk > 30)      { level = 'alert'; reasons.push(`Konum ${dk} dk güncellenmedi`); }
    else if (dk > 15) { if (level==='normal') level='warn'; reasons.push(`Konum ${dk} dk önce güncellendi`); }
  } else if (['Yolda','Fabrikada'].includes(dur) && !e.konum_zaman) {
    if (level==='normal') level='warn';
    reasons.push('Konum sinyali yok');
  }
  if (dur === 'Yolda' && e.eta_iso) {
    const gec = Math.round((now - new Date(e.eta_iso)) / 60000);
    if (gec > 0) {
      if (gec > 30) { level = 'alert'; reasons.push(`ETA ${gec} dk aşıldı`); }
      else { if (level==='normal') level='warn'; reasons.push(`ETA ${gec} dk aşıldı`); }
    }
  }
  const color = level === 'alert' ? 'var(--red)' : level === 'warn' ? 'var(--yellow)' : 'var(--text2)';
  return { level, reasons, color };
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
    tbody.innerHTML = `<tr><td colspan="18"><div class="ops-empty" style="padding:36px 12px;">
      <div class="ops-empty__icon">+</div>
      <div class="ops-empty__title">Aktif iş emri yok</div>
      <div class="ops-empty__msg">Yeni bir konteyner sevkiyatı için iş emri oluştur.</div>
      <button class="ops-btn ops-btn--primary ops-btn--sm" style="margin-top:8px;" onclick="openOpsIsEmriModal()">+ Yeni İş Emri</button>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(e => {
    const alert     = (typeof opsAlertInfo === 'function') ? opsAlertInfo(e) : { level: 'normal' };
    const rowCls    = alert.level === 'alert' ? 'is-urgent' : alert.level === 'warn' ? 'is-warn' : '';
    const kontNolar = (e.konteyner_no || '—').split('\n').filter(Boolean);
    const kontHtml  = kontNolar.map(k => `<div class="col-container">${k}</div>`).join('') || '<span style="color:var(--text-dim);">—</span>';
    const dbTone    = e.kont_durum === 'Boş' ? 'neutral' : 'brand';
    const dbLabel   = e.kont_durum === 'Boş' ? 'Boş' : 'Dolu';

    const syncBadge = (e._syncPending === true || (e._dbId == null && !isLocalMode()))
      ? `<span title="${(e._syncError || 'Buluta kaydedilmedi — yeniden denenecek').replace(/"/g,'&quot;')}" style="display:inline-block;margin-left:4px;width:7px;height:7px;border-radius:50%;background:var(--ops-warning);box-shadow:0 0 0 2px rgba(229,162,75,.2);vertical-align:middle;cursor:help;"></span>`
      : '';

    /* Durum suffix — ACİL / +Xdk */
    let durumSuffix = '';
    if (alert.level === 'alert')      durumSuffix = 'ACİL';
    else if (alert.level === 'warn')  durumSuffix = `+${alert.delayMin || 15}dk`;

    /* Yola çıkış sütunu — ana saat + alt rel time */
    let yolaSubCls = '';
    if (e.yola_zaman) {
      const dk = Math.round((Date.now() - new Date(e.yola_zaman)) / 60000);
      if (dk > 60) yolaSubCls = 'is-warn';
      if (dk > 180 && e.durum === 'Yolda') yolaSubCls = 'is-urgent';
    }

    /* Bekleme süresi — > 30dk warn */
    let beklemeColor = 'var(--text-muted)';
    if (e.fabrika_giris && e.fabrika_cikis) {
      const dk = Math.round((new Date(e.fabrika_cikis) - new Date(e.fabrika_giris)) / 60000);
      beklemeColor = dk > 30 ? 'var(--ops-warning)' : 'var(--text-primary)';
    }

    /* Km bloğu */
    const km = (e.baslangic_km != null && e.bitis_km != null) ? (e.bitis_km - e.baslangic_km) : null;
    const kmHtml = e.baslangic_km != null
      ? `<div class="col-mono" style="font-size:11.5px;color:var(--text-primary);">${e.baslangic_km.toLocaleString('tr-TR')}${e.bitis_km!=null?` → ${e.bitis_km.toLocaleString('tr-TR')}`:''}</div>${km!=null?`<div class="col-mono" style="font-size:10px;color:var(--ops-info);font-weight:600;">${km.toLocaleString('tr-TR')} km</div>`:''}`
      : '<span style="color:var(--text-dim);font-size:11px;">—</span>';

    // Dorse bilgisi (varsa) — Araç sütununun altına küçük satır
    let dorseSubHtml = '';
    if (e.dorse_id && typeof vehicles !== 'undefined') {
      const dorse = vehicles.find(v => v.id === e.dorse_id);
      if (dorse) {
        dorseSubHtml = `<div class="col-time__sub" style="color:var(--ops-info,#5B9DF9);font-family:var(--ops-font-mono,var(--font-mono));margin-top:2px;">⌖ ${dorse.plaka}</div>`;
      }
    }

    return `
    <tr class="${rowCls}">
      <td><span class="col-mono col-plate">#${e.id}</span>${syncBadge}</td>
      <td>${e.musteri_adi || '—'}</td>
      <td><span class="col-plate">${e.arac_plaka || '—'}</span>${dorseSubHtml}</td>
      <td>${kontHtml}</td>
      <td><span class="ops-pill ops-pill--neutral ops-pill--mono">${e.kont_tip || '—'}</span></td>
      <td><span class="ops-pill ops-pill--${dbTone}">${dbLabel}</span></td>
      <td style="font-size:12px;">${e.yukle_yeri || '<span style="color:var(--text-dim);">—</span>'}</td>
      <td style="font-size:12px;">${e.teslim_yeri || '<span style="color:var(--text-dim);">—</span>'}</td>
      <td style="font-size:11.5px;color:var(--ops-success);">${e.bos_donus || '<span style="color:var(--text-dim);">—</span>'}</td>
      <td>${opsDurumBadge(e.durum, durumSuffix ? { suffix: durumSuffix } : null)}</td>
      <td><span class="col-time">${opsFmtZaman(e.yola_zaman)}</span>${e.yola_zaman&&e.durum==='Yolda'?`<span class="col-time__sub ${yolaSubCls}">${opsRelTime(e.yola_zaman)} önce</span>`:''}</td>
      <td>${kmHtml}</td>
      <td><span class="col-mono" style="font-size:11.5px;color:var(--text-primary);">${opsFmtZaman(e.fabrika_giris)}</span></td>
      <td><span class="col-mono" style="font-size:11.5px;color:var(--text-primary);">${opsFmtZaman(e.fabrika_cikis)}</span></td>
      <td><span class="col-mono" style="font-size:11.5px;color:${beklemeColor};">${opsBeklemeSuresi(e.fabrika_giris, e.fabrika_cikis)}</span></td>
      <td>${(() => {
        const h = (typeof opsHarcirahKayit === 'function') ? opsHarcirahKayit(e._dbId ?? e.id) : null;
        if (!h) return '<span style="color:var(--text-dim);font-size:11px;">—</span>';
        const tutar = Number(h.manuel_tutar ?? h.hesaplanan_tutar ?? 0);
        if (!tutar) return '<span style="color:var(--text-dim);font-size:11px;">—</span>';
        const dColor = ({ beklemede:'#22c55e', sofor_onay:'#22c55e', sofor_itiraz:'#f59e0b', ops_onay:'#22c55e', odendi:'#0ea5e9', iptal:'var(--text-dim)' })[h.durum] || '#22c55e';
        const dIco   = ({ beklemede:'🕐', sofor_onay:'✓', sofor_itiraz:'⚠', ops_onay:'✓✓', odendi:'💵', iptal:'✕' })[h.durum] || '🕐';
        return `<div class="col-mono" style="font-size:12px;font-weight:700;color:${dColor};">${tutar.toLocaleString('tr-TR')} ₺</div><div style="font-size:10px;color:var(--text-muted);margin-top:1px;">${dIco} ${h.durum.replace('_',' ')}</div>`;
      })()}</td>
      <td><span class="ops-pill ops-pill--neutral ops-pill--mono">${opsFotoArray(e).length}</span></td>
      <td class="col-actions col-islem">
        <div style="display:inline-flex;gap:2px;">
          <button class="ops-icon-btn ops-icon-btn--sm" onclick="event.stopPropagation();openOpsDrawer(${e.id})" title="Detay">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/></svg>
          </button>
          <button class="ops-icon-btn ops-icon-btn--sm" onclick="event.stopPropagation();openOpsIsEmriDuzenle(${e.id})" title="Düzenle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="ops-icon-btn ops-icon-btn--sm ops-icon-btn--danger" onclick="event.stopPropagation();deleteOpsIsEmri(${e.id})" title="Sil">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`; }).join('');
}

/* ── KANBAN ──────────────────────────────────────────────── */
function opsRenderKanban() {
  const kolonlar = [
    { key: 'Bekliyor',     label: 'Bekliyor',  status: 'bekliyor',  hint: 'sürücü/araç ata',     emptyMsg: 'Yeni iş emri açıldığında burada belirir.', emptyCta: '+ İş emri ekle' },
    { key: 'Yolda',        label: 'Yolda',     status: 'yolda',     hint: 'sahada · canlı',      emptyMsg: 'Atanmış araç henüz yola çıkmadı.',          emptyCta: null },
    { key: 'Fabrikada',    label: 'Fabrikada', status: 'fabrikada', hint: 'boşaltma sırası',     emptyMsg: 'Fabrikaya giren araç bulunmuyor.',          emptyCta: null },
    { key: 'Teslim Edildi',label: 'Teslim',    status: 'teslim',    hint: 'POD bekleyen / OK',   emptyMsg: 'Bugün teslim edilen sevkiyat yok.',         emptyCta: null },
  ];
  const aktif = isEmirleri.filter(e => e.durum !== 'İptal');

  document.getElementById('ops-kanban').innerHTML = kolonlar.map(kol => {
    const kartlar = aktif.filter(e => e.durum === kol.key);
    const cards = kartlar.map(e => opsBuildContainerCard(e, kol.status)).join('');
    const empty = kartlar.length ? '' : `
      <div class="ops-empty">
        <div class="ops-empty__icon">${kol.status === 'bekliyor' ? '+' : '·'}</div>
        <div class="ops-empty__title">${kol.label} kolonu boş</div>
        <div class="ops-empty__msg">${kol.emptyMsg}</div>
      </div>`;
    const addBtn = kol.key === 'Bekliyor'
      ? `<button class="ops-kanban__add" onclick="openOpsIsEmriModal()">+ İş emri ekle</button>`
      : '';
    return `
      <div class="ops-kanban__col" data-status="${kol.status}" data-durum="${kol.key}"
           ondragover="opsKanbanDragOver(event)"
           ondragleave="opsKanbanDragLeave(event)"
           ondrop="opsKanbanDrop(event,'${kol.key}')">
        <div class="ops-kanban__head">
          <span class="ops-kanban__dot"></span>
          <span class="ops-kanban__title">${kol.label}</span>
          <span class="ops-kanban__count">${kartlar.length}</span>
          <span class="ops-kanban__hint">${kol.hint}</span>
          <button class="ops-icon-btn ops-icon-btn--sm ops-kanban__menu" title="Kolon ayarları" onclick="event.stopPropagation()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
          </button>
        </div>
        <div class="ops-kanban__list">${cards || empty}</div>
        ${addBtn}
      </div>`;
  }).join('');
}

/* ── ContainerCard — handoff anatomi (head / container / driver / route / metrics) */
function opsBuildContainerCard(e, status) {
  const alert = (typeof opsAlertInfo === 'function') ? opsAlertInfo(e) : { level: 'normal', reasons: [] };
  const isDelayed = alert.level === 'warn';
  const isUrgent  = alert.level === 'alert';

  const variantClass = (
    status === 'bekliyor'  ? 'is-waiting'    :
    status === 'yolda'     ? (isUrgent ? 'is-urgent' : isDelayed ? 'is-delayed' : 'is-enroute') :
    status === 'fabrikada' ? 'is-at-factory' :
    status === 'teslim'    ? 'is-delivered'  : ''
  );

  const escAttr = s => String(s == null ? '' : s).replace(/"/g, '&quot;');
  const kontNolar = (e.konteyner_no || '').split('\n').filter(Boolean);
  const kontLabel = kontNolar.length > 1 ? `${kontNolar[0]} +${kontNolar.length - 1}` : (kontNolar[0] || '—');

  /* head: plaka · dorse pill · tip pill · dolu/boş pill · sağda durum-bazlı pill */
  const tipPill = e.kont_tip ? `<span class="ops-pill ops-pill--neutral ops-pill--mono">${e.kont_tip}</span>` : '';
  const dbPill = e.kont_durum === 'Boş'
    ? `<span class="ops-pill ops-pill--neutral">Boş</span>`
    : `<span class="ops-pill ops-pill--brand">Dolu</span>`;
  // Dorse pill (varsa)
  let dorsePill = '';
  if (e.dorse_id && typeof vehicles !== 'undefined') {
    const dorse = vehicles.find(v => v.id === e.dorse_id);
    if (dorse) {
      dorsePill = `<span class="ops-pill ops-pill--info ops-pill--mono" title="${escAttr((dorse.dorse_tipi_ad || dorse.dorse_tipi || 'Dorse') + ' — ' + (dorse.plaka || ''))}">⌖ ${dorse.plaka}</span>`;
    }
  }

  // Harcırah pill (varsa)
  let harcirahPill = '';
  const _harc = (typeof opsHarcirahKayit === 'function') ? opsHarcirahKayit(e._dbId ?? e.id) : null;
  if (_harc) {
    const tutar = Number(_harc.manuel_tutar ?? _harc.hesaplanan_tutar ?? 0);
    if (tutar > 0) {
      const durumIco = ({
        beklemede:    '🕐',
        sofor_onay:   '✓',
        sofor_itiraz: '⚠',
        ops_onay:     '✓✓',
        odendi:       '💵',
        iptal:        '✕'
      })[_harc.durum] || '🕐';
      const durumColor = ({
        beklemede:    'success',
        sofor_onay:   'success',
        sofor_itiraz: 'warning',
        ops_onay:     'success',
        odendi:       'success',
        iptal:        'neutral'
      })[_harc.durum] || 'success';
      harcirahPill = `<span class="ops-pill ops-pill--${durumColor}" title="Harcırah · ${_harc.durum}" style="cursor:pointer;">💰 ${tutar.toLocaleString('tr-TR')}₺ ${durumIco}</span>`;
    }
  }
  let statusPill = '';
  if (isUrgent)        statusPill = `<span class="ops-pill ops-pill--solid-danger">ACİL</span>`;
  else if (isDelayed)  statusPill = `<span class="ops-pill ops-pill--warning">+${(alert.delayMin || 15)}dk</span>`;
  else if (status === 'teslim') statusPill = `<span class="ops-pill ops-pill--solid-success">✓ POD</span>`;
  else if (status === 'fabrikada') statusPill = `<span class="ops-pill ops-pill--purple">Fabrikada</span>`;

  const podBadge = (typeof podKanbanBadgeHtml === 'function') ? podKanbanBadgeHtml(e) : '';

  /* driver satırı (avatar + isim + telefon + canlı dot) */
  const sofor = e.sofor || e.sofor_adi || '';
  const initials = sofor ? sofor.split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase() : '—';
  const onlineMin = e.konum_zaman ? Math.round((Date.now() - new Date(e.konum_zaman)) / 60000) : null;
  const isOnline = onlineMin != null && onlineMin <= 5;
  const driverRow = (sofor || e.sofor_tel) ? `
    <div class="ops-card__driver">
      <span class="ops-card__avatar" aria-hidden="true">${initials}</span>
      <div class="ops-card__driver-info">
        <span class="ops-card__driver-name">${sofor || 'Atanmadı'}</span>
        ${e.sofor_tel ? `<span class="ops-card__driver-phone">${e.sofor_tel}</span>` : ''}
      </div>
      <span class="ops-card__online-dot${isOnline ? '' : ' is-offline'}" title="${isOnline ? 'Canlı' : (onlineMin != null ? onlineMin + ' dk önce' : 'çevrimdışı')}"></span>
    </div>` : '';

  /* route satırı (Yolda + Fabrikada) */
  const showRoute = (status === 'yolda' || status === 'fabrikada') && (e.yukle_yeri || e.teslim_yeri);
  const progress = status === 'yolda' ? 0.55 : status === 'fabrikada' ? 0.85 : status === 'teslim' ? 1 : 0;
  const routeRow = showRoute ? `
    <div class="ops-card__route">
      <div class="ops-card__route-line">
        <span class="ops-card__route-origin" title="${escAttr(e.yukle_yeri)}">${e.yukle_yeri || '—'}</span>
        <span class="ops-card__route-arrow">→</span>
        <span class="ops-card__route-dest" title="${escAttr(e.teslim_yeri)}">${e.teslim_yeri || '—'}</span>
      </div>
      <div class="ops-card__progress"><div class="ops-card__progress-fill" style="width:${Math.round(progress * 100)}%"></div></div>
    </div>` : '';

  /* metric şeridi — Bekliyor: atama zamanı, Yolda: ETA/süre/son ping, Fabrikada: giriş, Teslim: km/dönüş km */
  let metrics = '';
  if (status === 'bekliyor') {
    metrics = `
      <div class="ops-card__metrics">
        <div class="ops-card__metric"><div class="ops-card__metric-label">Atama</div><div class="ops-card__metric-value">${e.atama_zamani ? opsFmtZaman(e.atama_zamani) : '—'}</div></div>
        ${e.referans_no ? `<div class="ops-card__metric"><div class="ops-card__metric-label">Ref</div><div class="ops-card__metric-value">${e.referans_no}</div></div>` : ''}
      </div>`;
  } else if (status === 'yolda') {
    const etaCls   = isUrgent ? 'ops-card__metric--danger' : isDelayed ? 'ops-card__metric--warn' : '';
    const pingMin  = onlineMin;
    const pingCls  = pingMin == null ? '' : pingMin > 20 ? 'ops-card__metric--danger' : pingMin > 10 ? 'ops-card__metric--warn' : '';
    metrics = `
      <div class="ops-card__metrics">
        <div class="ops-card__metric ${etaCls}"><div class="ops-card__metric-label">ETA</div><div class="ops-card__metric-value">${e.eta || '—'}</div></div>
        <div class="ops-card__metric"><div class="ops-card__metric-label">Süre</div><div class="ops-card__metric-value">${e.yola_zaman ? opsRelTime(e.yola_zaman) : '—'}</div></div>
        <div class="ops-card__metric ${pingCls}"><div class="ops-card__metric-label">Son Ping</div><div class="ops-card__metric-value">${pingMin != null ? pingMin + ' dk' : '—'}</div></div>
      </div>`;
  } else if (status === 'fabrikada') {
    metrics = `
      <div class="ops-card__metrics">
        <div class="ops-card__metric"><div class="ops-card__metric-label">Giriş</div><div class="ops-card__metric-value">${e.fabrika_giris ? opsRelTime(e.fabrika_giris) : '—'}</div></div>
        <div class="ops-card__metric"><div class="ops-card__metric-label">Kapı</div><div class="ops-card__metric-value">${e.fabrika_kapi || '—'}</div></div>
      </div>`;
  } else if (status === 'teslim') {
    const km = (e.bitis_km != null && e.baslangic_km != null) ? (e.bitis_km - e.baslangic_km) : null;
    metrics = `
      <div class="ops-card__metrics">
        <div class="ops-card__metric"><div class="ops-card__metric-label">Mesafe</div><div class="ops-card__metric-value">${km != null ? km.toLocaleString('tr-TR') + ' km' : '—'}</div></div>
        ${e.bos_donus ? `<div class="ops-card__metric"><div class="ops-card__metric-label">Dönüş</div><div class="ops-card__metric-value">${e.bos_donus}</div></div>` : ''}
      </div>`;
  }

  return `
    <div class="ops-card ${variantClass}" draggable="true" data-id="${e.id}"
         ondragstart="opsKanbanDragStart(event,${e.id})"
         ondragend="opsKanbanDragEnd(event)"
         onclick="openOpsDrawer(${e.id})">
      <div class="ops-card__head">
        <span class="ops-card__plate">${e.arac_plaka || '—'}</span>
        ${dorsePill}
        ${tipPill}
        ${dbPill}
        ${podBadge}
        <span class="ops-card__head-spacer"></span>
        ${harcirahPill}
        ${statusPill}
      </div>
      <div class="ops-card__container">
        <svg class="ops-card__container-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="1"/><line x1="7" y1="6" x2="7" y2="18"/><line x1="12" y1="6" x2="12" y2="18"/><line x1="17" y1="6" x2="17" y2="18"/></svg>
        <span class="ops-card__container-no">${kontLabel}</span>
        <span class="ops-card__customer" title="${escAttr(e.musteri_adi)}">${e.musteri_adi || '—'}</span>
      </div>
      ${driverRow}
      ${routeRow}
      ${metrics}
    </div>`;
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

  // Araç (çekici) arama alanını doldur
  const aSel = document.getElementById('ops-m-arac');
  const aSearch = document.getElementById('ops-m-arac-search');
  const cekiciHidden = document.getElementById('ops-m-cekici-id');
  if (aSel)    aSel.value    = d.arac_plaka || '';
  if (aSearch) aSearch.value = d.arac_plaka || '';
  if (cekiciHidden) cekiciHidden.value = d.cekici_id || '';
  const aDD = document.getElementById('ops-arac-dropdown');
  if (aDD) aDD.style.display = 'none';

  // Dorse alanını doldur (varsa)
  const dorseHidden = document.getElementById('ops-m-dorse-id');
  const dorseSearch = document.getElementById('ops-m-dorse-search');
  const dorseClear  = document.getElementById('ops-m-dorse-clear');
  if (dorseHidden) dorseHidden.value = d.dorse_id || '';
  if (d.dorse_id && typeof vehicles !== 'undefined') {
    const ds = vehicles.find(v => v.id === d.dorse_id);
    if (ds && dorseSearch) {
      dorseSearch.value = ds.plaka + (ds.dorse_tipi ? ' · ' + ds.dorse_tipi : '');
      if (dorseClear) dorseClear.style.display = 'inline-block';
    }
  } else {
    if (dorseSearch) dorseSearch.value = '';
    if (dorseClear)  dorseClear.style.display = 'none';
  }
  const dorseDD = document.getElementById('ops-dorse-dropdown');
  if (dorseDD) dorseDD.style.display = 'none';

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
  // Adım 1'e dön ve kaydedilmiş alanlardan kontTip segmented'i senkronize et
  opsStepperGoto(1);
  _opsKontTipSyncSegmented();
  setTimeout(() => { try { _opsKmAutoHint(); } catch(e) {} }, 50);
}

/* =========================================================================
 * STEPPER (4 adımlı) — kontrol fonksiyonları
 * ========================================================================= */
let _opsCurrentStep = 1;
const _OPS_STEP_LABELS = [
  null,
  'Müşteri ve konteyner bilgileri',
  'Çekici, dorse ve sürücü',
  'Alım, teslim ve dönüş rotası',
  'Kontrol et ve kaydet'
];

function opsStepperGoto(n) {
  n = Math.max(1, Math.min(4, n | 0));
  _opsCurrentStep = n;
  // Step paneller
  document.querySelectorAll('#ops-modal-bg .ops-step').forEach(p => {
    p.classList.toggle('is-active', String(n) === p.dataset.step);
  });
  // Rail bullets
  document.querySelectorAll('#ops-modal-bg .ops-stepper-rail__step').forEach(s => {
    const k = parseInt(s.dataset.step, 10);
    s.classList.toggle('is-active', k === n);
    s.classList.toggle('is-done', k < n);
    const b = s.querySelector('.ops-stepper-rail__bullet');
    if (b) b.textContent = (k < n) ? '✓' : String(k);
  });
  // Header alt başlık
  const cur = document.getElementById('ops-stepper-current');
  const sub = document.getElementById('ops-stepper-sub');
  if (cur) cur.textContent = String(n);
  if (sub) sub.innerHTML = `Adım <span id="ops-stepper-current">${n}</span>/4 · ${_OPS_STEP_LABELS[n] || ''}`;
  // Footer butonları
  const prevBtn = document.getElementById('ops-stepper-prev');
  const nextBtn = document.getElementById('ops-stepper-next');
  const saveBtn = document.getElementById('ops-stepper-save');
  if (prevBtn) prevBtn.style.display = (n === 1) ? 'none' : 'inline-flex';
  if (nextBtn) nextBtn.style.display = (n === 4) ? 'none' : 'inline-flex';
  if (saveBtn) saveBtn.style.display = (n === 4) ? 'inline-flex' : 'none';
  // Hata bandını temizle
  document.querySelectorAll('#ops-modal-bg .ops-step__error').forEach(e => { e.style.display = 'none'; e.textContent = ''; });
  // Adım 4 ise özet kart üret
  if (n === 4) _opsBuildSummary();
  // Body scroll'u en üste
  const body = document.querySelector('#ops-modal-bg .srm-body');
  if (body) body.scrollTop = 0;
  // Aktif adımdaki ilk input'a fokus
  setTimeout(() => {
    const first = document.querySelector(`#ops-modal-bg .ops-step.is-active input:not([type=hidden]), #ops-modal-bg .ops-step.is-active select, #ops-modal-bg .ops-step.is-active textarea`);
    if (first) try { first.focus(); } catch (_) {}
  }, 50);
}

function opsStepperNext() {
  if (!_opsStepperValidate(_opsCurrentStep)) return;
  if (_opsCurrentStep < 4) opsStepperGoto(_opsCurrentStep + 1);
}
function opsStepperPrev() {
  if (_opsCurrentStep > 1) opsStepperGoto(_opsCurrentStep - 1);
}

function _opsStepperShowErr(step, msg) {
  const el = document.getElementById('ops-step' + step + '-err');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
}

function _opsStepperValidate(step) {
  if (step === 1) {
    const m = document.getElementById('ops-m-musteri')?.value;
    const k = (document.getElementById('ops-m-konteyner')?.value || '').trim();
    if (!m) { _opsStepperShowErr(1, 'Müşteri seçimi zorunlu.'); return false; }
    if (!k) { _opsStepperShowErr(1, 'En az bir konteyner numarası girin.'); return false; }
    return true;
  }
  if (step === 2) {
    const arac = document.getElementById('ops-m-arac')?.value;
    if (!arac) { _opsStepperShowErr(2, 'Çekici seçimi zorunlu.'); return false; }
    return true;
  }
  // Adım 3 ve 4 zorunlu alan içermez
  return true;
}

/* Konteyner tipi segmented seçici */
function opsKontTipSec(btn) {
  const val = btn?.dataset?.val || '';
  const sel = document.getElementById('ops-m-kont-tip');
  if (sel) sel.value = val;
  document.querySelectorAll('#ops-m-kont-tip-segmented button').forEach(b => {
    b.classList.toggle('is-active', b === btn);
  });
}
function _opsKontTipSyncSegmented() {
  const v = document.getElementById('ops-m-kont-tip')?.value || '';
  document.querySelectorAll('#ops-m-kont-tip-segmented button').forEach(b => {
    b.classList.toggle('is-active', b.dataset.val === v);
  });
}
// Mevcut opsDorseSec konteyner tipini select.value ile dolduruyor; segmented'ı senkronize et
const _origOpsDorseSec = (typeof opsDorseSec === 'function') ? opsDorseSec : null;
if (_origOpsDorseSec) {
  opsDorseSec = function(...args) {
    const r = _origOpsDorseSec.apply(this, args);
    try { _opsKontTipSyncSegmented(); } catch(_) {}
    return r;
  };
  window.opsDorseSec = opsDorseSec;
}

/* Adım 4 özet kartı */
function _opsBuildSummary() {
  const host = document.getElementById('ops-stepper-summary');
  if (!host) return;
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const musteriSel = document.getElementById('ops-m-musteri');
  const musteriAd = musteriSel?.options?.[musteriSel.selectedIndex]?.text || '—';
  const kontNolar = v('ops-m-konteyner').split('\n').filter(Boolean);
  const kontDurum = v('ops-m-kont-durum') || '—';
  const kontTip   = v('ops-m-kont-tip')   || '—';
  const aracPlaka = v('ops-m-arac')       || '—';
  const cekiciId  = v('ops-m-cekici-id');
  const dorseId   = v('ops-m-dorse-id');
  const sofor     = v('ops-m-sofor')      || '—';
  const soforTel  = v('ops-m-sofor-tel');
  const yukle     = v('ops-m-yukle')      || '—';
  const teslim    = v('ops-m-teslim')     || '—';
  const ref       = v('ops-m-referans');
  const muhur     = v('ops-m-muhur');
  const bosDonus  = v('ops-m-bos-donus');

  let dorseInfo = '—';
  if (dorseId && typeof vehicles !== 'undefined') {
    const d = vehicles.find(x => x.id === dorseId);
    if (d) dorseInfo = d.plaka + (d.dorse_tipi ? ' · ' + d.dorse_tipi : '');
  }

  const row = (k, val, mono) => `<div class="ops-summary__row"><span class="key">${k}</span><span class="val${mono ? ' mono' : ''}">${val}</span></div>`;

  host.innerHTML = `
    <div class="ops-summary__group">
      <div class="ops-summary__title">Müşteri &amp; Konteyner</div>
      ${row('Müşteri', musteriAd)}
      ${row('Konteyner Durumu', `<span class="ops-pill ops-pill--${kontDurum === 'Boş' ? 'neutral' : 'brand'}">${kontDurum}</span>`)}
      ${row('Konteyner Tipi', kontTip === '—' ? '—' : `<span class="ops-pill ops-pill--neutral ops-pill--mono">${kontTip}</span>`)}
      ${row('Konteyner No', kontNolar.length ? kontNolar.join(' · ') : '—', true)}
    </div>
    <div class="ops-summary__group">
      <div class="ops-summary__title">Sürücü &amp; Araç</div>
      ${row('Çekici', aracPlaka, true)}
      ${row('Dorse', dorseInfo, true)}
      ${row('Sürücü', sofor + (soforTel ? ` · <span class="mono">${soforTel}</span>` : ''))}
    </div>
    <div class="ops-summary__group">
      <div class="ops-summary__title">Rota</div>
      ${row('Alım', yukle)}
      ${row('Teslim', teslim)}
      ${bosDonus ? row('Boş Dönüş', bosDonus) : ''}
      ${ref      ? row('Referans No', ref, true) : ''}
      ${muhur    ? row('Mühür No', muhur, true) : ''}
    </div>`;
}

/* Modal kapatma — taslak uyarısı (modify edilmiş alan varsa) */
function opsModalDismiss() {
  // Eğer kullanıcı bir şey yazmışsa onaylı kapat
  const dirty = ['ops-m-konteyner','ops-m-arac','ops-m-yukle','ops-m-teslim','ops-m-notlar','ops-m-referans','ops-m-muhur'].some(id => {
    const el = document.getElementById(id);
    return el && (el.value || '').trim().length > 0;
  });
  if (dirty && !confirm('Yarım kalan iş emri kapatılsın mı? Bilgiler kaydedilmedi.')) return;
  closeOpsIsEmriModal();
}

/* ⌘+Enter / Ctrl+Enter ile sonraki adım (modal açıkken) */
document.addEventListener('keydown', function (ev) {
  const bg = document.getElementById('ops-modal-bg');
  if (!bg || bg.classList.contains('hidden')) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
    ev.preventDefault();
    if (_opsCurrentStep < 4) opsStepperNext();
    else { try { saveOpsIsEmri(); } catch(_) {} }
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    opsModalDismiss();
  }
});

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
  const cekiciId  = document.getElementById('ops-m-cekici-id')?.value || null;
  const dorseId   = document.getElementById('ops-m-dorse-id')?.value  || null;
  if (!musteriId || !aracPlaka) { showToast('Müşteri ve araç zorunlu', 'error'); return; }

  const musteriObj = typeof crmMusteriler !== 'undefined' ? crmMusteriler.find(m => m.id == musteriId) : null;

  if (_opsDuzenlemeId !== null) {
    // Düzenleme modu
    const e = opsById(_opsDuzenlemeId);
    if (!e) return;
    e.musteri_id   = parseInt(musteriId);
    e.musteri_adi  = musteriObj ? musteriObj.firma : e.musteri_adi;
    e.arac_plaka   = aracPlaka;
    e.cekici_id    = cekiciId || e.cekici_id || null;
    e.dorse_id     = dorseId  || null;
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
    cekici_id      : cekiciId,
    dorse_id       : dorseId,
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
  _opsDrawerRender(e);
  document.getElementById('ops-drawer-bg').classList.remove('hidden');
  document.getElementById('ops-drawer').classList.remove('hidden');
  // Sekme: varsayılan "Detaylar"a dön
  opsDrawerSwitchTab('detaylar');
  // Güzergah verisini çek (drawer açıldığında bir kere)
  setTimeout(() => opsGuzergahYukle(), 80);
}

/* ── DRAWER tabs (Detaylar / Olay Akışı / Belgeler / Yakıt) ─── */
function opsDrawerSwitchTab(name, btn) {
  const drawer = document.getElementById('ops-drawer');
  if (!drawer) return;
  drawer.dataset.activeTab = name;
  // Tab butonlarının aktif sınıfını güncelle
  document.querySelectorAll('#ops-drawer .ops-drawer-tab').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tab === name);
  });
  // Sticky scroll'u sıfırla
  const body = document.querySelector('#ops-drawer .drawer-body');
  if (body) body.scrollTop = 0;
}

/* Belgeler sekmesi sayım rozetini güncelle (foto sayısı) */
function _opsDrawerUpdateBelgelerCount() {
  const cntEl = document.getElementById('ops-drawer-belgeler-count');
  if (!cntEl) return;
  const fotoCntEl = document.getElementById('ops-drawer-foto-count');
  const fotoTxt = (fotoCntEl?.textContent || '').trim();
  const n = parseInt(fotoTxt, 10);
  if (isFinite(n) && n > 0) {
    cntEl.textContent = String(n);
    cntEl.style.display = 'inline-block';
  } else {
    cntEl.style.display = 'none';
  }
}

/** Tüm drawer içeriğini yeniden render eder */
function _opsDrawerRender(e) {
  if (!e) return;
  const eId = e._dbId ?? e.id;

  document.getElementById('ops-drawer-title').textContent = e.konteyner_no
    ? e.konteyner_no.split('\n')[0] + (e.konteyner_no.split('\n').length > 1 ? ` +${e.konteyner_no.split('\n').length-1}` : '')
    : ('İş Emri #' + e.id);
  document.getElementById('ops-drawer-sub').textContent =
    [e.arac_plaka, e.kont_tip, e.kont_durum, e.musteri_adi, e.sofor].filter(Boolean).join(' · ');

  // Durum + mühür + başlangıç km rozeti (header'da, durum pill'i + ek rozetler)
  document.getElementById('ops-drawer-durum-row').innerHTML =
    opsDurumBadge(e.durum) +
    (e.muhur_no ? `<span class="ops-pill ops-pill--neutral ops-pill--mono" title="Mühür">Mühür: ${e.muhur_no}</span>` : '') +
    (e.baslangic_km != null ? `<span class="ops-pill ops-pill--neutral ops-pill--mono" title="Başlangıç km">🛣 ${e.baslangic_km.toLocaleString('tr-TR')}</span>` : '');

  // 3 birincil aksiyon — etkinlik durumu
  const callBtn = document.getElementById('ops-drawer-call-btn');
  if (callBtn) {
    if (e.sofor_tel) { callBtn.disabled = false; callBtn.style.opacity = ''; callBtn.dataset.tel = e.sofor_tel; }
    else             { callBtn.disabled = true;  callBtn.style.opacity = '.5';  delete callBtn.dataset.tel; }
  }
  const locBtn = document.getElementById('ops-drawer-loc-btn');
  if (locBtn) {
    const hasLoc = isFinite(parseFloat(e.konum_lat)) && isFinite(parseFloat(e.konum_lng));
    if (hasLoc) {
      locBtn.disabled = false; locBtn.style.opacity = '';
      locBtn.dataset.lat = e.konum_lat; locBtn.dataset.lng = e.konum_lng;
    } else {
      locBtn.disabled = true; locBtn.style.opacity = '.5';
      delete locBtn.dataset.lat; delete locBtn.dataset.lng;
    }
  }

  // Bağlantılı sefer kaydını bul
  const bagliSefer = seferData.find(s => s._opsId === e.id || s._opsId === e._dbId);

  // Şoför bağlantı durumu
  const soforBagliMi = !!e.sofor_user_id;
  const soforBagliHtml = soforBagliMi
    ? `<span style="font-size:10px;background:rgba(34,197,94,.15);color:var(--green);border:1px solid rgba(34,197,94,.3);border-radius:4px;padding:1px 7px;margin-left:6px;">✓ Uygulamaya bağlı</span>`
    : `<span style="font-size:10px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25);border-radius:4px;padding:1px 7px;margin-left:6px;">⚠ Bağlı değil</span>`;

  const kmSatiri = (e.baslangic_km != null || e.bitis_km != null)
    ? `<div class="detail-row"><span class="detail-key">Km Aralığı</span><span class="detail-val" style="font-family:var(--font-mono);">${e.baslangic_km ?? '?'} → ${e.bitis_km ?? '?'}${(e.baslangic_km != null && e.bitis_km != null) ? ` <span style="color:var(--blue);">(${(e.bitis_km - e.baslangic_km).toLocaleString('tr-TR')} km)</span>` : ''}</span></div>`
    : '';

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
  ].map(([k,v]) => `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`).join('') +
  kmSatiri +
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
  + ''; // (bağlı değil uyarısı artık "Şoför Daveti" bölümünde gösteriliyor)

  // ── Şoför anlık durum (GPS + KM) ──
  _opsRenderSoforDurum(e);

  // ── Teslim belgesi (POD) ──
  _opsRenderPOD(e);

  // ⛽ Yakıt / Maliyet kartı
  const yakitCardEl = document.getElementById('ops-drawer-yakit-card');
  if (yakitCardEl) {
    yakitCardEl.innerHTML = _opsYakitCardHtml(e);
    // GPS güzergah verisi async geldikten sonra "📡 GPS X km / sapma" satırını ekle
    _opsYakitGpsKarsilastirmaYukle(e).catch(()=>{});
  }

  // 📊 Aynı güzergahta geçmiş seferler (sürücü karşılaştırması)
  opsBenzerSeferleriYukle().catch(()=>{});

  // ── Zaman çizelgesi (km bilgisiyle zenginleştirilmiş) ──
  const milestones = [
    { label: 'İş Emri Atandı',   zaman: e.atama_zamani,  km: null },
    { label: 'Yola Çıkıldı',     zaman: e.yola_zaman,    km: e.baslangic_km },
    { label: 'Fabrika Girişi',   zaman: e.fabrika_giris, km: null },
    { label: 'Fabrikadan Çıkış', zaman: e.fabrika_cikis, km: null },
    { label: 'Teslim Tamamlandı',zaman: e.teslim_zamani, km: e.bitis_km },
  ];
  const durumSira = ['Bekliyor','Yolda','Fabrikada','Fabrikada','Teslim Edildi'];
  const aktifIdx  = durumSira.indexOf(e.durum);
  document.getElementById('ops-drawer-timeline').innerHTML = milestones.map((m, i) => {
    const cls  = m.zaman ? 'done' : (i === aktifIdx ? 'active' : 'pending');
    const icon = m.zaman ? '✓'   : (i === aktifIdx ? '●' : '○');
    const kmBadge = m.km != null
      ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--blue);margin-left:6px;">${m.km.toLocaleString('tr-TR')} km</span>`
      : '';
    return `<div class="ops-tl-item">
      <div class="ops-tl-dot ${cls}">${icon}</div>
      <div class="ops-tl-body">
        <div class="ops-tl-label">${m.label}${kmBadge}</div>
        <div class="ops-tl-time">${m.zaman ? opsFmtZaman(m.zaman) : '—'}</div>
      </div>
    </div>`;
  }).join('');

  // ── Fotoğraflar ──
  const fotos = opsFotoArray(e);
  document.getElementById('ops-drawer-foto-count').textContent = fotos.length || '';
  // Belgeler sekmesi rozet sayım'ını güncelle
  try { _opsDrawerUpdateBelgelerCount(); } catch (_) {}

  // ── Harcırah ──
  try { _opsDrawerHarcirahRender(e); } catch (_) {}
  // Zorunlu fotoğraflar checklist'i — sürücü app'iyle aynı kurallar:
  //   • Konteyner Ön Yüzü — tüm işlerde
  //   • Dorse Plakası — tüm işlerde
  //   • Mühür — sadece kont_durum='Boş' işlerde
  const checklistHtml = _opsZorunluFotoCheckHtml(e, fotos);

  document.getElementById('ops-drawer-fotograflar').innerHTML = checklistHtml + (fotos.length ?
    `<div class="ops-foto-grid">${fotos.map((f, fi) => `
      <div class="ops-foto-card" style="position:relative;">
        <img src="${f.url}" alt="${f.tip||''}" onclick="window.open('${f.url}','_blank')" style="cursor:pointer;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <div style="display:none;align-items:center;justify-content:center;height:100%;font-size:24px;">📷</div>
        <div class="ops-foto-tip">${f.tip||''}</div>
        <button onclick="event.stopPropagation();opsFotoSil(${eId},${fi})" title="Fotoğrafı sil" style="position:absolute;top:4px;right:4px;background:rgba(239,68,68,.85);border:none;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;color:#fff;font-weight:900;line-height:1;padding:0;">✕</button>
      </div>`).join('')}</div>` :
    `<div class="ops-foto-empty">📷<br>Şoför henüz fotoğraf eklemedi</div>`) +
    `<div style="margin-top:10px;">
      <label style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:border-color .15s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border2)'">
        📎 Operasyon Fotoğrafı Ekle
        <input type="file" accept="image/*" multiple style="display:none;" onchange="opsFotoEkle(${eId}, this)">
      </label>
    </div>`;

  // ── Durum güncelleme butonları ──
  const durumSecenekler = ['Bekliyor','Yolda','Fabrikada','Teslim Edildi','İptal'].filter(d => d !== e.durum);
  document.getElementById('ops-drawer-actions').innerHTML = durumSecenekler.map(d => {
    const renk = { 'Bekliyor':'var(--yellow)','Yolda':'var(--blue)','Fabrikada':'var(--accent)','Teslim Edildi':'var(--green)','İptal':'var(--red)' }[d];
    return `<button onclick="opsGuncelleDurum(${eId},'${d}')" style="display:flex;align-items:center;gap:7px;background:var(--surface2);border:1px solid var(--border2);color:${renk};border-radius:8px;padding:8px 14px;font-family:var(--font-body);font-size:12.5px;font-weight:600;cursor:pointer;transition:border-color .15s;width:100%;" onmouseover="this.style.borderColor='${renk}'" onmouseout="this.style.borderColor='var(--border2)'">
      → ${d} olarak işaretle
    </button>`;
  }).join('');

  // ── Mesaj thread'i ──
  _opsRenderMesajlar(e);

  // ── Şoför davet bölümü (bağlı değilse) ──
  const erisimEl  = document.getElementById('ops-drawer-sofor-erisim');
  const erisimSec = document.getElementById('ops-drawer-sofor-erisim-section');
  if (erisimEl && erisimSec) {
    if (!soforBagliMi && e.sofor) {
      erisimSec.style.display = '';
      erisimEl.innerHTML = `
        <button onclick="opsWhatsappGonder()" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#25d366,#128c7e);border:none;color:#fff;border-radius:9px;padding:11px;font-family:var(--font-body);font-size:13px;font-weight:700;cursor:pointer;margin-bottom:6px;">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp ile Davet Gönder
        </button>
        <div style="font-size:11px;color:var(--muted);text-align:center;margin-bottom:8px;">Şoför daveti kabul edince iş emri portale otomatik düşer</div>
        <button id="ops-sofor-ata-btn-${eId}" onclick="opsManuelSoforAta(${eId})" style="width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--accent);border-radius:8px;padding:8px 14px;font-family:var(--font-body);font-size:12px;font-weight:700;cursor:pointer;">🔗 Manuel Bağla</button>
        <div id="ops-sofor-ata-secim-${eId}"></div>`;
    } else {
      erisimSec.style.display = 'none';
    }
  }
}

function closeOpsDrawer() {
  document.getElementById('ops-drawer-bg').classList.add('hidden');
  document.getElementById('ops-drawer').classList.add('hidden');
  opsDrawerActiveId = null;
  // Güzergah haritasını temizle (sonraki açılışta tazelensin)
  if (_opsGuzergahMap) {
    try { _opsGuzergahHaritaTemizle(); _opsGuzergahMap.remove(); } catch {}
    _opsGuzergahMap = null;
    _opsGuzergahLayers = [];
  }
}

/* ── DRAWER birincil aksiyonlar (Sürücüyü Ara · Konum) ────── */
function opsDrawerSoforAra() {
  const btn = document.getElementById('ops-drawer-call-btn');
  const tel = btn?.dataset?.tel;
  if (!tel) {
    if (typeof showToast === 'function') showToast('Sürücü telefonu kayıtlı değil', 'warn');
    return;
  }
  // Telefonu temizle (boşluk, tire, parantez kaldır)
  const clean = String(tel).replace(/[\s\-\(\)]/g, '');
  // tel: link masaüstünde de işletim sistemine yönlendirir (Skype/FaceTime/WhatsApp Beam)
  window.location.href = 'tel:' + clean;
}

function opsDrawerKonumAc() {
  const btn = document.getElementById('ops-drawer-loc-btn');
  const lat = btn?.dataset?.lat;
  const lng = btn?.dataset?.lng;
  if (!lat || !lng) {
    if (typeof showToast === 'function') showToast('Son bilinen konum yok', 'warn');
    return;
  }
  // Google Maps'te yeni sekmede aç
  const url = 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ─── DRAWER · Harcırah özeti + ek masraf düzenleme ─────── */
function _opsDrawerHarcirahRender(e) {
  const host = document.getElementById('ops-drawer-harcirah-body');
  if (!host) return;
  const eId = e._dbId ?? e.id;
  const h = (typeof opsHarcirahKayit === 'function') ? opsHarcirahKayit(eId) : null;

  if (!h) {
    host.innerHTML = `
      <div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.20);border-left:3px solid var(--ops-warning);border-radius:6px;padding:10px 12px;font-size:11.5px;color:var(--text-secondary);line-height:1.5;">
        ⚠ Bu iş emri için harcırah kaydı yok.<br>
        <span style="color:var(--text-muted);">Tarife eşleşmemiş olabilir veya iş emri bu özellik aktif olmadan oluşturulmuş.</span>
        <div style="margin-top:8px;display:flex;gap:6px;">
          <button onclick="opsDrawerHarcirahYenidenHesapla()" class="ops-btn ops-btn--quiet ops-btn--sm">↻ Yeniden Hesapla</button>
          <button onclick="opsDrawerHarcirahManuel()" class="ops-btn ops-btn--quiet ops-btn--sm">+ Manuel Gir</button>
        </div>
      </div>`;
    return;
  }

  const tutarBase = Number(h.manuel_tutar ?? h.hesaplanan_tutar ?? 0);
  const ekMasraf  = Number(h.ek_masraflar || 0);
  const avans     = Number(h.avans_dusum || 0);
  const net       = Number(h.net_tutar || (tutarBase + ekMasraf - avans));
  const fmt = (n) => Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const durumLabel = ({
    beklemede:    'Beklemede',
    sofor_onay:   'Şoför Onayladı',
    sofor_itiraz: 'Şoför İtiraz Etti',
    ops_onay:     'Operasyon Onayladı',
    odendi:       'Ödendi',
    iptal:        'İptal'
  })[h.durum] || h.durum;
  const durumColor = ({
    beklemede:    '#f59e0b',
    sofor_onay:   '#22c55e',
    sofor_itiraz: '#ef4444',
    ops_onay:     '#22c55e',
    odendi:       '#0ea5e9',
    iptal:        'var(--text-muted)'
  })[h.durum] || '#f59e0b';

  host.innerHTML = `
    <div style="background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:8px;padding:12px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
        <div>
          <span style="font-family:var(--ops-font-mono);font-size:22px;font-weight:700;color:#22c55e;">${fmt(net)} ₺</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">net</span>
        </div>
        <span style="font-size:10.5px;font-weight:700;background:${durumColor}22;color:${durumColor};padding:3px 10px;border-radius:99px;letter-spacing:.4px;">${durumLabel}</span>
      </div>

      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:11.5px;margin-bottom:10px;">
        <span style="color:var(--text-muted);">Tarife</span>
        <span style="color:var(--text-primary);font-weight:600;text-align:right;font-family:var(--ops-font-mono);">${fmt(tutarBase)} ₺</span>
        ${ekMasraf > 0 ? `<span style="color:var(--text-muted);">Ek masraf</span><span style="color:var(--ops-warning);font-weight:600;text-align:right;font-family:var(--ops-font-mono);">+ ${fmt(ekMasraf)} ₺</span>` : ''}
        ${avans > 0 ? `<span style="color:var(--text-muted);">Avans düşümü</span><span style="color:#0ea5e9;font-weight:600;text-align:right;font-family:var(--ops-font-mono);">− ${fmt(avans)} ₺</span>` : ''}
      </div>

      ${h.ek_masraf_aciklama ? `<div style="font-size:10.5px;color:var(--text-muted);font-style:italic;margin-bottom:8px;">"${h.ek_masraf_aciklama}"</div>` : ''}

      <!-- Hızlı ek masraf ekleme -->
      <div style="display:flex;gap:6px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-subtle);">
        <input id="ops-drawer-harc-ek-tutar" type="number" min="0" step="0.01" placeholder="₺" style="width:80px;background:var(--bg-base);border:1px solid var(--border-subtle);color:var(--text-primary);border-radius:5px;padding:5px 8px;font-size:11.5px;font-family:var(--ops-font-mono);">
        <input id="ops-drawer-harc-ek-aciklama" placeholder="Ek masraf açıklaması (HGS, mola…)" style="flex:1;background:var(--bg-base);border:1px solid var(--border-subtle);color:var(--text-primary);border-radius:5px;padding:5px 8px;font-size:11.5px;">
        <button onclick="opsDrawerHarcirahEkMasrafEkle('${h.id}')" class="ops-btn ops-btn--quiet ops-btn--sm">+ Ekle</button>
      </div>

      <!-- Onay aksiyonları -->
      <div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;">
        ${h.durum === 'beklemede' || h.durum === 'sofor_onay' ? `
          <button onclick="opsDrawerHarcirahOnayla('${h.id}')" class="ops-btn ops-btn--primary ops-btn--sm">✓ Operasyon Onayla</button>
        ` : ''}
        ${h.durum === 'ops_onay' ? `
          <button onclick="opsDrawerHarcirahOdendi('${h.id}')" class="ops-btn ops-btn--primary ops-btn--sm">💵 Ödendi İşaretle</button>
        ` : ''}
        ${h.durum !== 'odendi' && h.durum !== 'iptal' ? `
          <button onclick="opsDrawerHarcirahIptal('${h.id}')" class="ops-btn ops-btn--quiet ops-btn--sm" style="color:var(--ops-danger);">✕ İptal</button>
        ` : ''}
      </div>
    </div>`;
}

async function opsDrawerHarcirahYenidenHesapla() {
  if (!opsDrawerActiveId) return;
  if (typeof HarcirahAPI === 'undefined') {
    if (typeof showToast === 'function') showToast('HarcirahAPI yüklü değil', 'error');
    return;
  }
  try {
    const e = opsById(opsDrawerActiveId);
    const dbId = e?._dbId ?? e?.id ?? opsDrawerActiveId;
    const newId = await HarcirahAPI.isEmriHesapla(dbId);
    if (!newId) {
      if (typeof showToast === 'function') showToast('Tarife eşleşmedi. Manuel girilebilir.', 'warn');
    } else {
      if (typeof showToast === 'function') showToast('Harcırah yeniden hesaplandı', 'success');
    }
    await opsHarcirahCacheYukle();
    if (e) _opsDrawerHarcirahRender(e);
    opsRenderTable(); opsRenderKanban();
  } catch (err) {
    console.error(err);
    if (typeof showToast === 'function') showToast('Hesaplanamadı: ' + (err.message || 'hata'), 'error');
  }
}

async function opsDrawerHarcirahManuel() {
  if (!opsDrawerActiveId) return;
  const tutarStr = prompt('Manuel harcırah tutarı (₺):');
  if (tutarStr == null) return;
  const tutar = parseFloat(tutarStr);
  if (!isFinite(tutar) || tutar < 0) {
    if (typeof showToast === 'function') showToast('Geçerli tutar girin', 'error');
    return;
  }
  try {
    const e = opsById(opsDrawerActiveId);
    const dbId = e?._dbId ?? e?.id ?? opsDrawerActiveId;
    await HarcirahAPI.kayitCreate({
      is_emri_id:       dbId,
      sofor_user_id:    e?.sofor_user_id || null,
      sofor_ad:         e?.sofor || null,
      arac_plaka:       e?.arac_plaka || null,
      arac_id:          e?.cekici_id || null,
      manuel_tutar:     tutar,
      hesaplanan_tutar: null,
      durum:            'beklemede',
      is_tarihi:        (e?.atama_zamani || new Date().toISOString()).slice(0, 10)
    });
    if (typeof showToast === 'function') showToast('Manuel harcırah eklendi', 'success');
    await opsHarcirahCacheYukle();
    if (e) _opsDrawerHarcirahRender(e);
    opsRenderTable(); opsRenderKanban();
  } catch (err) {
    console.error(err);
    if (typeof showToast === 'function') showToast('Eklenemedi: ' + err.message, 'error');
  }
}

async function opsDrawerHarcirahEkMasrafEkle(kayitId) {
  const tutarEl = document.getElementById('ops-drawer-harc-ek-tutar');
  const aciklEl = document.getElementById('ops-drawer-harc-ek-aciklama');
  const tutar = parseFloat(tutarEl?.value);
  const aciklama = (aciklEl?.value || '').trim();
  if (!isFinite(tutar) || tutar <= 0) {
    if (typeof showToast === 'function') showToast('Geçerli ek tutar girin', 'error');
    return;
  }
  try {
    // Mevcut ek_masraflar'a ekle (additive)
    const cur = opsHarcirahKayit(opsDrawerActiveId) || {};
    const yeniToplam = Number(cur.ek_masraflar || 0) + tutar;
    const yeniAcikl  = (cur.ek_masraf_aciklama ? cur.ek_masraf_aciklama + ' · ' : '') + (aciklama || (tutar + '₺'));
    await HarcirahAPI.kayitUpdate(kayitId, {
      ek_masraflar:       yeniToplam,
      ek_masraf_aciklama: yeniAcikl
    });
    if (typeof showToast === 'function') showToast('Ek masraf eklendi', 'success');
    await opsHarcirahCacheYukle();
    const e = opsById(opsDrawerActiveId);
    if (e) _opsDrawerHarcirahRender(e);
    opsRenderTable(); opsRenderKanban();
  } catch (err) {
    console.error(err);
    if (typeof showToast === 'function') showToast('Eklenemedi: ' + err.message, 'error');
  }
}

async function opsDrawerHarcirahOnayla(kayitId) {
  if (!confirm('Bu harcırah operasyon tarafından onaylansın mı?')) return;
  try {
    await HarcirahAPI.kayitOpsOnay(kayitId);
    if (typeof showToast === 'function') showToast('Onaylandı', 'success');
    await opsHarcirahCacheYukle();
    const e = opsById(opsDrawerActiveId);
    if (e) _opsDrawerHarcirahRender(e);
    opsRenderTable(); opsRenderKanban();
  } catch (err) {
    if (typeof showToast === 'function') showToast('Onaylanamadı: ' + err.message, 'error');
  }
}

async function opsDrawerHarcirahOdendi(kayitId) {
  const yontem = prompt('Ödeme yöntemi: (Nakit / EFT / Çek / Mahsup)', 'EFT');
  if (yontem == null) return;
  try {
    await HarcirahAPI.kayitOdendi(kayitId, { yontem: yontem.trim() || 'EFT' });
    if (typeof showToast === 'function') showToast('Ödeme kaydedildi', 'success');
    await opsHarcirahCacheYukle();
    const e = opsById(opsDrawerActiveId);
    if (e) _opsDrawerHarcirahRender(e);
    opsRenderTable(); opsRenderKanban();
  } catch (err) {
    if (typeof showToast === 'function') showToast('Kaydedilemedi: ' + err.message, 'error');
  }
}

async function opsDrawerHarcirahIptal(kayitId) {
  if (!confirm('Bu harcırah kaydı iptal edilsin mi?')) return;
  try {
    await HarcirahAPI.kayitUpdate(kayitId, { durum: 'iptal' });
    if (typeof showToast === 'function') showToast('İptal edildi', 'success');
    await opsHarcirahCacheYukle();
    const e = opsById(opsDrawerActiveId);
    if (e) _opsDrawerHarcirahRender(e);
    opsRenderTable(); opsRenderKanban();
  } catch (err) {
    if (typeof showToast === 'function') showToast('İptal edilemedi: ' + err.message, 'error');
  }
}

/* ── Şoför anlık GPS + KM durumu ── */
function _opsRenderSoforDurum(e) {
  const el  = document.getElementById('ops-drawer-sofor-durum');
  if (!el) return;
  const hasKonum  = e.konum_lat != null && e.konum_lng != null;
  const hasKm     = e.baslangic_km != null;
  const hasEta    = e.eta_iso != null;
  const hasMesafe = e.kalan_km != null;
  const surucuId  = e.surucu_id || e.sofor_user_id || null;
  const pushBtn   = surucuId
    ? `<button id="ops-push-neredesin-btn" onclick="opsPushNeredesin(${e.id})" style="background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.35);color:var(--blue);border-radius:7px;padding:6px 12px;font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">📡 Neredesin?</button>`
    : '';
  if (!hasKonum && !hasKm && !hasEta) {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="font-size:12px;color:var(--muted);flex:1;">Şoför henüz konum veya km bilgisi göndermedi.</div>${pushBtn}</div>`;
    return;
  }
  const konumZaman = e.konum_zaman
    ? new Date(e.konum_zaman).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
    : null;
  el.innerHTML = `${pushBtn ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">${pushBtn}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
    ${hasKonum ? `<div style="background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.2);border-radius:9px;padding:10px 12px;grid-column:1/-1;">
      <div style="font-size:10px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">📍 Son Konum</div>
      <div style="font-family:var(--font-mono);font-size:11.5px;color:var(--text);">${e.konum_lat.toFixed(5)}, ${e.konum_lng.toFixed(5)}</div>
      ${konumZaman ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;">${konumZaman}</div>` : ''}
      <a href="https://www.google.com/maps?q=${e.konum_lat},${e.konum_lng}" target="_blank" style="display:inline-block;margin-top:6px;font-size:11px;color:var(--blue);text-decoration:none;font-weight:600;">🗺 Haritada Gör →</a>
    </div>` : ''}
    ${hasEta ? `<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:9px;padding:10px 12px;">
      <div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">⏱ Tahmini Varış</div>
      <div style="font-size:13px;font-weight:700;color:var(--text);">${new Date(e.eta_iso).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' })}</div>
    </div>` : ''}
    ${hasMesafe ? `<div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:9px;padding:10px 12px;">
      <div style="font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">🛣 Kalan Mesafe</div>
      <div style="font-size:13px;font-weight:700;color:var(--text);">${Math.round(e.kalan_km)} km</div>
    </div>` : ''}
    ${hasKm ? `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:9px;padding:10px 12px;">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">📏 Km Sayacı</div>
      <div style="font-family:var(--font-mono);font-size:12px;color:var(--text);">${e.baslangic_km != null ? e.baslangic_km.toLocaleString('tr-TR') : '?'} → ${e.bitis_km != null ? e.bitis_km.toLocaleString('tr-TR') : '?'}</div>
      ${(e.baslangic_km != null && e.bitis_km != null) ? `<div style="font-size:11px;color:var(--blue);font-weight:700;margin-top:2px;">${(e.bitis_km - e.baslangic_km).toLocaleString('tr-TR')} km</div>` : ''}
    </div>` : ''}
  </div>`;
}

/* ── Teslim belgesi (POD) ── */
function _opsRenderPOD(e) {
  const el  = document.getElementById('ops-drawer-pod');
  const sec = document.getElementById('ops-drawer-pod-section');
  if (!el || !sec) return;
  const teslim = e.durum === 'Teslim Edildi';
  const hasPODData = e.teslim_alan_ad || e.imza_url || e.pod_taslak_url || e.pod_final_url;
  // Teslim edildiyse her zaman göster (POD yoksa "oluşturulmadı" diyelim)
  sec.style.display = (teslim || hasPODData) ? '' : 'none';
  if (!sec.style.display) return;

  const dur = e.pod_durum;
  const safe = (s) => s == null ? '' : String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // Durum bandı
  let durumBand = '';
  if (dur === 'onayli') {
    const tarih = e.pod_onay_zaman ? new Date(e.pod_onay_zaman).toLocaleString('tr-TR') : '';
    durumBand = `<div style="background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.35);color:var(--green);border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
      ✅ Onaylandı <span style="font-weight:500;color:var(--text2);font-size:11.5px;margin-left:auto;">${safe(tarih)}</span>
    </div>`;
  } else if (dur === 'reddedildi') {
    durumBand = `<div style="background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.35);color:var(--red);border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;">
      ❌ Reddedildi ${e.pod_onay_notu ? `<div style="font-weight:500;color:var(--text2);font-size:11.5px;margin-top:3px;">${safe(e.pod_onay_notu)}</div>` : ''}
    </div>`;
  } else if (dur === 'taslak' || e.pod_taslak_url) {
    durumBand = `<div style="background:rgba(212,168,71,.10);border:1px solid rgba(212,168,71,.35);color:var(--yellow);border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;">
      ⏳ Taslak — Yönetici onayı bekleniyor
    </div>`;
  } else if (teslim) {
    durumBand = `<div style="background:rgba(99,102,241,.10);border:1px solid rgba(99,102,241,.35);color:var(--accent);border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;">
      📋 POD oluşturulmadı — Onaylayarak final makbuzu üretebilirsiniz
    </div>`;
  }

  // PDF butonları
  const pdfBtns = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      ${e.pod_taslak_url ? `<a href="${safe(e.pod_taslak_url)}" target="_blank" rel="noopener" style="flex:1;min-width:140px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(212,168,71,.12);border:1px solid rgba(212,168,71,.35);color:var(--yellow);border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;text-decoration:none;">📄 Taslak PDF</a>` : ''}
      ${e.pod_final_url ? `<a href="${safe(e.pod_final_url)}" target="_blank" rel="noopener" style="flex:1;min-width:140px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35);color:var(--green);border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;text-decoration:none;">✅ Final PDF</a>` : ''}
      ${(teslim && dur !== 'onayli') ? `<button onclick="podOnayModalAc(opsById(${e.id}))" style="flex:1;min-width:140px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(135deg,var(--green),#15a346);border:0;color:#fff;border-radius:8px;padding:9px 12px;font-size:12.5px;font-weight:700;cursor:pointer;">✅ POD'u Onayla</button>` : ''}
      ${(dur === 'onayli') ? `<button onclick="podOnayModalAc(opsById(${e.id}))" style="background:rgba(255,255,255,.04);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:9px 12px;font-size:12px;cursor:pointer;">↻ Yeniden onay</button>` : ''}
    </div>`;

  // Detay
  const detay = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
    ${e.teslim_alan_ad ? `<div class="detail-row"><span class="detail-key">Teslim Alan</span><span class="detail-val">${safe(e.teslim_alan_ad)}</span></div>` : ''}
    ${e.teslim_not_musteri ? `<div class="detail-row"><span class="detail-key">Müşteri Notu</span><span class="detail-val">${safe(e.teslim_not_musteri)}</span></div>` : ''}
    ${e.pod_onay_notu && dur === 'onayli' ? `<div class="detail-row"><span class="detail-key">Onay Notu</span><span class="detail-val">${safe(e.pod_onay_notu)}</span></div>` : ''}
    ${e.imza_url ? `<div style="margin-top:10px;"><div style="font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Dijital İmza</div>
      <img src="${safe(e.imza_url)}" alt="İmza" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid var(--border2);background:#fff;cursor:pointer;" onclick="window.open('${safe(e.imza_url)}','_blank')" /></div>` : ''}
  </div>`;

  el.innerHTML = durumBand + pdfBtns + detay;
}

/* ── Mesaj thread'i render ── */
function _opsRenderMesajlar(e) {
  const el    = document.getElementById('ops-drawer-mesajlar');
  const cntEl = document.getElementById('ops-drawer-mesaj-count');
  if (!el) return;
  const satirlar = (e.notlar || '').split('\n').filter(s => s.trim());
  if (cntEl) { cntEl.textContent = satirlar.length || ''; cntEl.style.display = satirlar.length ? '' : 'none'; }
  if (!satirlar.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:10px 0;">Henüz mesaj veya not yok.</div>';
    return;
  }
  el.innerHTML = satirlar.map(s => {
    const isSofor  = /\[ŞOFÖR/i.test(s);
    const isDuyuru = /\[DUYURU/i.test(s);
    const match  = s.match(/^\[([^\]]+)\]\s*(.*)/s);
    const prefix = match ? match[1] : '';
    const metin  = match ? match[2] : s;
    if (isSofor) return `<div style="border-radius:10px;border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.07);padding:10px 12px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:4px;">🚛 Şoför &nbsp;<span style="font-weight:400;color:var(--muted);font-size:10px;">${prefix.replace(/ŞOFÖR[\s·]*/i,'').trim()}</span></div>
      <div style="font-size:13px;color:var(--text);line-height:1.5;">${metin}</div></div>`;
    if (isDuyuru) return `<div style="border-radius:10px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.09);padding:10px 12px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:var(--yellow);margin-bottom:4px;">📢 Duyuru &nbsp;<span style="font-weight:400;color:var(--muted);font-size:10px;">${prefix.replace(/DUYURU[\s·]*/i,'').trim()}</span></div>
      <div style="font-size:13px;color:var(--text);line-height:1.5;">${metin}</div></div>`;
    return `<div style="border-radius:10px;border:1px solid rgba(100,116,139,.2);background:rgba(100,116,139,.06);padding:10px 12px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px;">📝 OPS &nbsp;<span style="font-weight:400;font-size:10px;">${prefix.replace(/İÇ NOT[\s·]*/i,'').replace(/OPS[\s·]*/i,'').trim()}</span></div>
      <div style="font-size:13px;color:var(--text);line-height:1.5;">${metin}</div></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

/* ── Drawer yenile — Supabase'den güncel veriyi çek ── */
async function opsDrawerYenile() {
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  if (!e || !(e._dbId > 0)) { showToast('Kayıt henüz senkronize edilmedi', 'error'); return; }
  showToast('Yenileniyor…');
  try {
    const { data, error } = await getSB().from('is_emirleri').select('*').eq('id', e._dbId).maybeSingle();
    if (error) throw error;
    if (!data) { showToast('Kayıt bulunamadı', 'error'); return; }
    Object.assign(e, opsRowToObj(data));
    opsSaveLocal();
    _opsDrawerRender(e);
    showToast('Güncellendi ✓');
  } catch (err) {
    console.error('Drawer yenileme hatası:', err);
    showToast('Yenilenemedi: ' + (err?.message || 'hata'), 'error');
  }
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
  // Aracın geçmiş ortalama tüketimi — fişlerden tank-to-tank
  const avgLper100 = veh ? calcAvgConsumption(veh.id) : 0;
  const avgTLperKm = veh ? calcAvgTLPerKm(veh.id) : 0;

  if (veh && hasKm) {
    const r = calcFuelForKmRange(veh.id, e.baslangic_km, e.bitis_km);
    litre = r.litre; tl = r.tl; count = r.count;
    // Bu aralıkta dolum yoksa tüketim ortalamasından tahmin et
    if (count === 0 && avgLper100 > 0) {
      litre = +((avgLper100 * katedilenKm) / 100).toFixed(2);
      tl    = +(avgTLperKm * katedilenKm).toFixed(0);
      note  = `Tahmini (ort ${avgLper100} L/100km)`;
    }
  } else if (e.yakit_tutar != null) {
    litre = +(e.yakit_litre || 0);
    tl    = +e.yakit_tutar;
    count = 0;
    note  = 'Önceden kaydedilmiş cache';
  } else if (veh && katedilenKm > 0) {
    // Fallback: km bilgisi yok ama sefer.km var
    if (avgLper100 > 0) {
      litre = +((avgLper100 * katedilenKm) / 100).toFixed(2);
      tl    = +(avgTLperKm * katedilenKm).toFixed(0);
      note  = `Tahmini (ort ${avgLper100} L/100km)`;
    } else if (avgTLperKm > 0) {
      tl = +(avgTLperKm * katedilenKm).toFixed(0);
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
      ${kpi('Mesafe', katedilenKm > 0 ? katedilenKm.toFixed(0) + ' km' : '—', hasKm ? 'sürücü beyanı' : '')}
      ${kpi('Yakıt', litre > 0 ? litre.toLocaleString('tr-TR') + ' L' : '—')}
      ${kpi('Yakıt TL', tl > 0 ? '₺' + tl.toLocaleString('tr-TR') : '—', '', 'var(--accent)')}
      ${kpi('TL/km', tlPerKm !== '—' ? '₺' + tlPerKm : '—')}
      ${kpi('L/100km', lPer100)}
      ${kpi('Gelir', ucret > 0 ? '₺' + ucret.toLocaleString('tr-TR') : '—', '', 'var(--blue)')}
      ${kpi('Net Kâr', (netKar != null) ? '₺' + netKar.toLocaleString('tr-TR') : '—',
            (karPct != null) ? ('%' + karPct + ' marj') : '', karRenk)}
    </div>
    <!-- GPS karşılaştırma satırı, async olarak _opsYakitGpsKarsilastirmaYukle ile dolar -->
    <div id="ops-yakit-gps-row" style="margin-bottom:8px;"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted);">
      <span>${count > 0 ? `🔎 Bu aralıkta ${count} dolum eşleşti` : (note || 'Sefer bazlı hesap')}</span>
      ${hasKm ? `<span style="font-family:var(--font-mono);">Km: ${e.baslangic_km} → ${e.bitis_km}</span>` : ''}
    </div>
  </div>`;
}

/* ── GPS Güzergah Özeti ile Yakıt/Mesafe Karşılaştırma ───────────
   `is_emri_guzergah_ozet` view'inden bu işin GPS toplam km'sini, süresini
   ve nokta sayısını çeker; yakıt kartının altına ek bir satır olarak basar.
   Sürücünün beyanı (bitis-baslangic) ile GPS arasındaki sapmayı vurgular —
   "aynı işi yapan farklı sürücüler arasında km kıyaslama" ihtiyacının
   ilk temelidir. */
const _opsGuzergahOzetCache = {};

async function _opsGuzergahOzetGetir(dbId) {
  if (!dbId) return null;
  if (_opsGuzergahOzetCache[dbId]) return _opsGuzergahOzetCache[dbId];
  try {
    const sb = getSB();
    if (!sb) return null;
    const { data, error } = await sb
      .from('is_emri_guzergah_ozet')
      .select('toplam_km, basla_ts, bitir_ts, ort_hiz_kmh, nokta_sayisi')
      .eq('is_emri_id', dbId)
      .maybeSingle();
    if (error) throw error;
    if (data) _opsGuzergahOzetCache[dbId] = data;
    return data;
  } catch (err) {
    console.warn('[ops] guzergah ozet:', err);
    return null;
  }
}

async function _opsYakitGpsKarsilastirmaYukle(e) {
  const row = document.getElementById('ops-yakit-gps-row');
  if (!row) return;
  const dbId = e._dbId || e.id;
  console.log('[ops-yakit-gps] dbId =', dbId, 'iş emri:', e.id, 'durum:', e.durum);
  const ozet = await _opsGuzergahOzetGetir(dbId);
  console.log('[ops-yakit-gps] guzergah ozet:', ozet);
  if (!ozet || !ozet.toplam_km || ozet.toplam_km <= 0) {
    row.innerHTML = `<div style="font-size:11px;color:var(--muted);background:var(--surface2);border:1px dashed var(--border2);border-radius:6px;padding:6px 10px;">
      📡 GPS güzergah kaydı yok — sürücü "Yola çıktım" yapsın ve telefon konum verirken birkaç dakika hareket etsin.
    </div>`;
    return;
  }
  const gpsKm = +ozet.toplam_km;
  const veh = vehicles.find(v => v.plaka === e.arac_plaka);
  const avgLper100 = veh ? calcAvgConsumption(veh.id) : 0;
  const avgTLperKm = veh ? calcAvgTLPerKm(veh.id) : 0;

  // Sürücü beyanı km (baslangic→bitis); yoksa null
  const beyanKm = (e.baslangic_km != null && e.bitis_km != null && e.bitis_km > e.baslangic_km)
    ? (e.bitis_km - e.baslangic_km) : null;

  // Sapma — beyan vs GPS
  let sapmaHtml = '';
  if (beyanKm != null) {
    const fark = gpsKm - beyanKm;
    const farkPct = beyanKm > 0 ? (fark / beyanKm) * 100 : 0;
    const farkRenk = Math.abs(farkPct) > 15 ? 'var(--red)' : (Math.abs(farkPct) > 7 ? 'var(--yellow)' : 'var(--green)');
    const ok = Math.abs(farkPct) <= 7;
    sapmaHtml = `<span style="background:var(--surface2);border:1px solid var(--border2);color:${farkRenk};padding:3px 10px;border-radius:5px;font-weight:700;font-family:var(--font-mono);">
      Δ ${fark >= 0 ? '+' : ''}${fark.toFixed(1)} km (${fark >= 0 ? '+' : ''}${farkPct.toFixed(1)}%) ${ok ? '✓' : '⚠'}
    </span>`;
  }

  // GPS bazlı yakıt tahmini
  let gpsYakitHtml = '';
  if (avgLper100 > 0) {
    const tahminLitre = +((avgLper100 * gpsKm) / 100).toFixed(1);
    const tahminTL    = avgTLperKm > 0 ? Math.round(avgTLperKm * gpsKm) : null;
    gpsYakitHtml = `<span title="Aracın geçmiş ortalama tüketimine göre tahmin" style="background:rgba(99,102,241,.10);border:1px solid rgba(99,102,241,.25);color:var(--accent);padding:3px 10px;border-radius:5px;font-family:var(--font-mono);">
      ⛽ tahmin ${tahminLitre} L${tahminTL != null ? ' • ₺' + tahminTL.toLocaleString('tr-TR') : ''}
    </span>`;
  }

  row.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px;">
    <span style="background:rgba(56,189,248,.10);border:1px solid rgba(56,189,248,.25);color:var(--blue);padding:3px 10px;border-radius:5px;font-weight:700;font-family:var(--font-mono);">📡 GPS ${gpsKm.toFixed(1)} km</span>
    ${sapmaHtml}
    ${gpsYakitHtml}
    <span style="color:var(--muted);font-size:10.5px;align-self:center;">${ozet.nokta_sayisi} nokta · ort ${ozet.ort_hiz_kmh ?? '—'} km/sa</span>
  </div>`;
}

/* ── BU GÜZERGAHTA GEÇMİŞ SEFERLER (Sürücü Karşılaştırma) ───────
   Aynı yukle_yeri + teslim_yeri çiftine yapılmış son N seferi listeler.
   Her satır: tarih, sürücü, plaka, beyan km, GPS km, süre, yakıt(L).
   GPS km'ye göre artan sıralama → en kestirme rotalı sürücü en üstte,
   en uzun yol kullanan en altta. Aktif iş emri (e) hariç tutulur. */
async function opsBenzerSeferleriYukle() {
  const body  = document.getElementById('ops-drawer-karsilastirma-body');
  const cnt   = document.getElementById('ops-drawer-karsilastirma-count');
  const sec   = document.getElementById('ops-drawer-karsilastirma-section');
  const btn   = document.getElementById('ops-drawer-karsilastirma-refresh');
  if (!body || !sec) return;
  if (!opsDrawerActiveId) return;
  const e = opsById(opsDrawerActiveId);
  if (!e) return;
  if (!e.yukle_yeri || !e.teslim_yeri) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  if (btn) { btn.disabled = true; btn.textContent = '↻ Yükleniyor…'; }
  body.innerHTML = `<div style="font-size:11px;color:var(--muted);">Aynı güzergahtaki geçmiş seferler taranıyor…</div>`;

  try {
    const sb = getSB();
    if (!sb) throw new Error('Supabase istemcisi yok');
    const dbId = e._dbId || e.id;
    // Aynı yukle/teslim çiftine yapılmış son seferler — kendi hariç
    let q = sb.from('is_emirleri')
      .select('id, durum, sofor, surucu_id, arac_plaka, baslangic_km, bitis_km, yola_zaman, teslim_zamani, atama_zamani')
      .eq('yukle_yeri', e.yukle_yeri)
      .eq('teslim_yeri', e.teslim_yeri)
      .neq('id', dbId)
      .order('teslim_zamani', { ascending: false, nullsFirst: false })
      .limit(20);
    if (currentFirmaId) q = q.or('firma_id.eq.' + currentFirmaId + ',firma_id.is.null');
    const { data, error } = await q;
    if (error) throw error;
    let rows = data || [];

    if (rows.length === 0) {
      body.innerHTML = `<div style="background:var(--surface2);border:1px dashed var(--border2);border-radius:8px;padding:12px;font-size:12px;color:var(--muted);text-align:center;">
        Bu güzergaha (<b>${_esc(e.yukle_yeri)} → ${_esc(e.teslim_yeri)}</b>) yapılmış başka bir sefer bulunmadı.<br>
        İleride aynı çifte yapılan işler burada otomatik karşılaştırılacak.
      </div>`;
      if (cnt) { cnt.style.display = 'none'; }
      return;
    }

    // Geçmiş seferlerin GPS özetlerini tek seferde çek
    const ids = rows.map(r => r.id);
    let ozetMap = {};
    try {
      const { data: ozetler } = await sb
        .from('is_emri_guzergah_ozet')
        .select('is_emri_id, toplam_km, basla_ts, bitir_ts, ort_hiz_kmh')
        .in('is_emri_id', ids);
      (ozetler || []).forEach(o => { ozetMap[o.is_emri_id] = o; });
    } catch (e2) { /* ignore */ }

    // Aktif iş emrinin GPS özeti — referans satırı için
    const aktifOzet = await _opsGuzergahOzetGetir(dbId).catch(()=>null);

    // Sürücü adı çözümleme: snapshot driverData
    const snap = (window._fleetly && window._fleetly.snapshot) || {};
    const driverById = {};
    (snap.driverData || []).forEach(d => { if (d) driverById[d.id] = d; });
    const drvName = (r) => {
      if (r.surucu_id && driverById[r.surucu_id]) {
        const d = driverById[r.surucu_id];
        return ((d.ad || '') + ' ' + (d.soyad || '')).trim() || r.sofor || '—';
      }
      return r.sofor || '—';
    };

    // Her satır için karşılaştırma metriği — GPS km öncelikli, yoksa beyan km
    const enrich = rows.map(r => {
      const beyanKm = (r.baslangic_km != null && r.bitis_km != null && r.bitis_km > r.baslangic_km)
        ? +(r.bitis_km - r.baslangic_km).toFixed(1) : null;
      const ozet = ozetMap[r.id];
      const gpsKm = ozet && ozet.toplam_km > 0 ? +(+ozet.toplam_km).toFixed(1) : null;
      const sortKm = gpsKm != null ? gpsKm : (beyanKm != null ? beyanKm : Infinity);
      let sureDk = null;
      if (ozet && ozet.basla_ts && ozet.bitir_ts) {
        sureDk = Math.max(0, Math.round((new Date(ozet.bitir_ts) - new Date(ozet.basla_ts)) / 60000));
      } else if (r.yola_zaman && r.teslim_zamani) {
        sureDk = Math.max(0, Math.round((new Date(r.teslim_zamani) - new Date(r.yola_zaman)) / 60000));
      }
      return { r, beyanKm, gpsKm, sortKm, sureDk, ozet };
    });
    enrich.sort((a, b) => a.sortKm - b.sortKm);

    // En düşük & en yüksek km — vurgulamak için
    const finiteKms = enrich.filter(x => isFinite(x.sortKm)).map(x => x.sortKm);
    const minKm = finiteKms.length ? Math.min.apply(null, finiteKms) : null;
    const maxKm = finiteKms.length ? Math.max.apply(null, finiteKms) : null;

    if (cnt) { cnt.textContent = String(enrich.length); cnt.style.display = ''; }

    const fmtKm   = (v) => v == null ? '—' : v.toLocaleString('tr-TR') + ' km';
    const fmtSure = (m) => {
      if (m == null) return '—';
      if (m < 60) return m + ' dk';
      return Math.floor(m/60) + 's ' + (m%60) + 'dk';
    };
    const fmtDate = (s) => s ? new Date(s).toLocaleDateString('tr-TR', {day:'2-digit',month:'2-digit',year:'2-digit'}) : '—';

    // Aktif iş emrinin referans satırı
    const aktifBeyanKm = (e.baslangic_km != null && e.bitis_km != null && e.bitis_km > e.baslangic_km)
      ? +(e.bitis_km - e.baslangic_km).toFixed(1) : null;
    const aktifGpsKm = aktifOzet && aktifOzet.toplam_km > 0 ? +(+aktifOzet.toplam_km).toFixed(1) : null;
    const aktifSureDk = aktifOzet && aktifOzet.basla_ts && aktifOzet.bitir_ts
      ? Math.max(0, Math.round((new Date(aktifOzet.bitir_ts) - new Date(aktifOzet.basla_ts)) / 60000))
      : (e.yola_zaman && e.teslim_zamani
          ? Math.max(0, Math.round((new Date(e.teslim_zamani) - new Date(e.yola_zaman)) / 60000))
          : null);

    const refBg = 'background:rgba(99,102,241,.10);border-left:3px solid var(--accent);';
    const refRow = `<tr style="${refBg}">
      <td style="padding:7px 8px;font-weight:700;color:var(--accent);">▶ Bu iş</td>
      <td style="padding:7px 8px;">${_esc(opsDrvNameForRow(e))}</td>
      <td style="padding:7px 8px;font-family:var(--font-mono);">${_esc(e.arac_plaka || '—')}</td>
      <td style="padding:7px 8px;font-family:var(--font-mono);text-align:right;">${fmtKm(aktifBeyanKm)}</td>
      <td style="padding:7px 8px;font-family:var(--font-mono);text-align:right;">${fmtKm(aktifGpsKm)}</td>
      <td style="padding:7px 8px;font-family:var(--font-mono);text-align:right;">${fmtSure(aktifSureDk)}</td>
    </tr>`;

    const dataRows = enrich.map(({r, beyanKm, gpsKm, sortKm, sureDk}) => {
      const isMin = minKm != null && sortKm === minKm;
      const isMax = maxKm != null && sortKm === maxKm && minKm !== maxKm;
      const tag = isMin ? `<span style="background:rgba(34,197,94,.15);color:var(--green);font-weight:700;padding:1px 6px;border-radius:99px;font-size:10px;margin-left:4px;">en kısa</span>`
                : isMax ? `<span style="background:rgba(239,68,68,.15);color:var(--red);font-weight:700;padding:1px 6px;border-radius:99px;font-size:10px;margin-left:4px;">en uzun</span>` : '';
      const kmCellStyle = isMin ? 'color:var(--green);font-weight:700;' : (isMax ? 'color:var(--red);font-weight:700;' : '');
      return `<tr style="border-top:1px solid var(--border2);cursor:pointer;" onclick="openOpsDrawer(${r.id})" onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background=''">
        <td style="padding:7px 8px;color:var(--muted);">${fmtDate(r.teslim_zamani || r.yola_zaman || r.atama_zamani)}</td>
        <td style="padding:7px 8px;">${_esc(drvName(r))} ${tag}</td>
        <td style="padding:7px 8px;font-family:var(--font-mono);">${_esc(r.arac_plaka || '—')}</td>
        <td style="padding:7px 8px;font-family:var(--font-mono);text-align:right;">${fmtKm(beyanKm)}</td>
        <td style="padding:7px 8px;font-family:var(--font-mono);text-align:right;${kmCellStyle}">${fmtKm(gpsKm)}</td>
        <td style="padding:7px 8px;font-family:var(--font-mono);text-align:right;color:var(--muted);">${fmtSure(sureDk)}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `<div style="overflow-x:auto;border:1px solid var(--border2);border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr style="background:var(--surface2);color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:.04em;">
            <th style="padding:7px 8px;text-align:left;font-weight:700;">Tarih</th>
            <th style="padding:7px 8px;text-align:left;font-weight:700;">Sürücü</th>
            <th style="padding:7px 8px;text-align:left;font-weight:700;">Plaka</th>
            <th style="padding:7px 8px;text-align:right;font-weight:700;" title="Sürücünün girdiği bitiş - başlangıç farkı">Beyan</th>
            <th style="padding:7px 8px;text-align:right;font-weight:700;" title="GPS güzergahından hesaplanan gerçek mesafe">GPS</th>
            <th style="padding:7px 8px;text-align:right;font-weight:700;">Süre</th>
          </tr>
        </thead>
        <tbody>${refRow}${dataRows}</tbody>
      </table>
    </div>
    <div style="margin-top:6px;font-size:10.5px;color:var(--muted);">
      ↑ GPS km'ye göre sıralı (en kısa rota üstte). Satıra tıklayınca o iş emrinin detayı açılır.
    </div>`;
  } catch (err) {
    console.error('[ops] benzer seferler yüklenemedi:', err);
    body.innerHTML = `<div style="font-size:11px;color:var(--red);background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.25);border-radius:6px;padding:8px 10px;">Karşılaştırma yüklenemedi: ${_esc(err?.message || 'hata')}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Yenile'; }
  }
}

// Aktif iş emri için sürücü adı çözümleme (snapshot'tan tek satır)
function opsDrvNameForRow(e) {
  const snap = (window._fleetly && window._fleetly.snapshot) || {};
  const drv = (e.surucu_id && Array.isArray(snap.driverData))
    ? snap.driverData.find(d => d && d.id === e.surucu_id)
    : null;
  return drv ? (((drv.ad || '') + ' ' + (drv.soyad || '')).trim() || e.sofor || '—') : (e.sofor || '—');
}

// HTML escape — string güvenliği için
function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}

/* ── Foto Tip Eşleştirme — şoför app'indeki PhotoTypeMatcher ile birebir ──
   Konteyner çekicinin üstünde olduğu için pratikte konteyner ön yüzü +
   dorse plakası tek karede çekiliyor → tek "Konteyner & Plaka" rolü.
   Eski etiket varyantları geriye uyumluluk için hâlâ kabul edilir. */
const _OPS_FOTO_MATCHERS = {
  konteynerPlaka: (label) => {
    const l = String(label || '').trim().toLowerCase();
    return l === 'konteyner & plaka'
        || l === 'konteyner & çekici plaka'
        || l === 'konteyner ön yüzü'
        || l === 'dorse plakası'
        || l === 'konteyner'
        || l === 'plaka';
  },
  muhur: (label) => {
    const l = String(label || '').trim().toLowerCase();
    return l === 'mühür' || l === 'muhur';
  }
};

/* Drawer'da fotoğraflar listesinin üstüne basılır:
   her zorunlu tip için ✓ / ✗ rozeti + eksiklerin biri varsa "Şoföre hatırlat" butonu. */
function _opsZorunluFotoCheckHtml(e, fotos) {
  const isBosKonteyner = (e.kont_durum || '').toLowerCase() === 'boş';
  const items = [
    { key: 'konteynerPlaka', label: 'Konteyner & Plaka', emoji: '🚛',
      done: (fotos || []).some(f => _OPS_FOTO_MATCHERS.konteynerPlaka(f.tip)) },
  ];
  if (isBosKonteyner) {
    items.push({ key: 'muhur', label: 'Mühür', emoji: '🔒',
      done: (fotos || []).some(f => _OPS_FOTO_MATCHERS.muhur(f.tip)) });
  }
  const eksikler = items.filter(i => !i.done);
  const allDone  = eksikler.length === 0;
  const dbId     = e._dbId || e.id;

  const itemsHtml = items.map(i => {
    const renk = i.done ? 'var(--green)' : 'var(--red)';
    const icon = i.done ? '✓' : '✗';
    const bg   = i.done ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.08)';
    return `<span style="display:inline-flex;align-items:center;gap:5px;background:${bg};border:1px solid ${i.done ? 'rgba(34,197,94,.30)' : 'rgba(239,68,68,.25)'};color:${renk};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;font-family:var(--font-mono);">
      <span>${i.emoji}</span><span style="font-family:var(--font-body);">${i.label}</span><span style="font-weight:900;">${icon}</span>
    </span>`;
  }).join('');

  const hintHtml = allDone
    ? `<div style="font-size:11px;color:var(--green);font-weight:600;">Tüm zorunlu fotoğraflar tamam.</div>`
    : `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="font-size:11px;color:var(--red);font-weight:600;">Eksik: ${eksikler.map(x => x.label).join(', ')}</div>
        ${(e.surucu_id || e.sofor_user_id)
          ? `<button onclick="opsZorunluFotoHatirlat(${dbId})" id="ops-foto-hatirlat-${dbId}" style="background:rgba(232,82,26,.12);border:1px solid rgba(232,82,26,.35);color:var(--accent);border-radius:6px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;">📡 Şoföre hatırlat</button>`
          : ''}
       </div>`;

  return `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">
        📋 Zorunlu Fotoğraflar${isBosKonteyner ? ' <span style="color:var(--accent);text-transform:none;">(boş konteyner)</span>' : ''}
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${itemsHtml}</div>
    ${hintHtml}
  </div>`;
}

/* Eksik fotoğraflar için şoföre push bildirimi — mevcut notify-driver Edge Function'ı kullanır.
   Drawer kapatılmadan önce eksikleri göndereceği için tekrarlanan istek korunur (4sn debounce). */
async function opsZorunluFotoHatirlat(opsId) {
  const e = isEmirleri.find(x => (x.id === opsId) || (x._dbId === opsId));
  if (!e) return;
  const surucuId = e.surucu_id || e.sofor_user_id;
  if (!surucuId) { showToast('Sürücü bağlı değil — hatırlatma gönderilemez', 'error'); return; }

  const fotos = opsFotoArray(e);
  const isBosKonteyner = (e.kont_durum || '').toLowerCase() === 'boş';
  const eksikler = [];
  if (!fotos.some(f => _OPS_FOTO_MATCHERS.konteynerPlaka(f.tip))) eksikler.push('Konteyner & Plaka');
  if (isBosKonteyner && !fotos.some(f => _OPS_FOTO_MATCHERS.muhur(f.tip))) eksikler.push('Mühür');

  if (eksikler.length === 0) { showToast('Eksik fotoğraf yok', 'success'); return; }

  const btn = document.getElementById('ops-foto-hatirlat-' + (e._dbId || e.id));
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = '📡 Gönderiliyor...'; }

  try {
    const sb = getSB();
    if (!sb) throw new Error('Supabase istemcisi yok');
    const plaka = e.arac_plaka || '';
    const { error } = await sb.functions.invoke('notify-driver', {
      body: {
        surucu_id : surucuId,
        is_emri_id: e._dbId || e.id,
        title     : '📸 Eksik fotoğraf hatırlatması',
        body      : (plaka ? `${plaka} — ` : '') + 'Lütfen şu fotoğrafları çekin: ' + eksikler.join(', '),
        url       : '/sofor.html'
      }
    });
    if (error) throw error;
    showToast('Hatırlatma gönderildi: ' + eksikler.join(', '), 'success');
    if (btn) { btn.textContent = '✓ Gönderildi'; setTimeout(()=>{ if(btn){btn.disabled=false;btn.style.opacity='';btn.textContent='📡 Şoföre hatırlat';}}, 4000); }
  } catch (err) {
    console.error('foto hatırlatma hatası:', err);
    showToast('Hatırlatma gönderilemedi: ' + (err?.message || 'hata'), 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.textContent = '📡 Şoföre hatırlat'; }
  }
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
  // [İÇ NOT] prefix — şoför görmez, sadece ops takibi için
  e.notlar = (e.notlar ? e.notlar + '\n' : '') + '[İÇ NOT · ' + tarih + '] ' + notMetin;
  opsSaveLocal();
  opsSaveCloud(e);
  inp.value = '';
  _opsRenderMesajlar(e);
  showToast('Not eklendi ✓');
}

/** Şoför panelinde duyuru olarak gösterilecek mesaj gönder */
function opsDrawerDuyuruGonder() {
  if (!opsDrawerActiveId) return;
  const inp = document.getElementById('ops-drawer-duyuru-inp');
  if (!inp) return;
  const metin = inp.value.trim();
  if (!metin) { showToast('Duyuru boş olamaz', 'error'); return; }
  const e = opsById(opsDrawerActiveId);
  if (!e) return;
  const tarih = new Date().toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  // [DUYURU] prefix — şoförün panelinde belirgin biçimde gösterilir
  e.notlar = (e.notlar ? e.notlar + '\n' : '') + '[DUYURU · ' + tarih + '] ' + metin;
  opsSaveLocal();
  opsSaveCloud(e);
  inp.value = '';
  _opsRenderMesajlar(e);
  showToast('📢 Duyuru şoföre gönderildi ✓');
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
  // Yalnızca çekici / tek_parca — dorse'ler "Dorse Ara" alanında listelenir.
  // Kayıtlarda kind eksikse 'cekici' varsay (Karar 7).
  const cekiciler = vehicles.filter(v => {
    const k = v.kind || 'cekici';
    return k === 'cekici' || k === 'tek_parca';
  });
  const list = cekiciler.filter(v =>
    !query ||
    (v.plaka  || '').toLowerCase().includes(query) ||
    (v.sofor  || '').toLowerCase().includes(query) ||
    (v.marka  || '').toLowerCase().includes(query) ||
    (v.model  || '').toLowerCase().includes(query) ||
    (v.esleme || '').toLowerCase().includes(query)
  );
  if (!list.length) {
    dd.style.display = 'none';
    return;
  }
  const tipIcon = { 'cekici': '🚛', 'tek_parca': '🚐' };
  dd.style.display = 'block';
  dd.innerHTML = list.map(v => {
    const k = v.kind || 'cekici';
    const ico = tipIcon[k] || '🚛';
    const markaModel = [v.marka, v.model].filter(Boolean).join(' ');
    return `
    <div onclick="opsAracSec('${v.id || ''}','${v.plaka}','${(v.sofor||'').replace(/'/g,"\\'")}','${(v.telefon||'').replace(/'/g,"\\'")}')"
      style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <span style="font-size:18px;flex-shrink:0">${ico}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:13px;">${v.plaka}</div>
        ${markaModel ? `<div style="font-size:11px;color:var(--text2);">${markaModel}${v.yil ? ` · ${v.yil}` : ''}</div>` : ''}
        ${v.sofor ? `<div style="font-size:10.5px;color:var(--muted);">👤 ${v.sofor}${v.telefon?' · 📞 '+v.telefon:''}</div>` : ''}
      </div>
      <span style="font-size:10px;color:var(--muted);background:var(--surface3);padding:2px 6px;border-radius:4px;">${k === 'tek_parca' ? 'Tek Parça' : 'Çekici'}</span>
    </div>`;
  }).join('');
}

async function opsAracSec(cekiciId, plaka, sofor, tel) {
  // Backward compat: eski çağrılarda sadece plaka/sofor/tel verilirdi
  if (arguments.length <= 3) { tel = sofor; sofor = plaka; plaka = cekiciId; cekiciId = ''; }
  const aracHidden  = document.getElementById('ops-m-arac');
  const cekiciHidden= document.getElementById('ops-m-cekici-id');
  if (aracHidden)  aracHidden.value  = plaka;
  if (cekiciHidden) cekiciHidden.value = cekiciId || '';
  document.getElementById('ops-m-arac-search').value = plaka;
  const soforEl = document.getElementById('ops-m-sofor');
  const telEl   = document.getElementById('ops-m-sofor-tel');
  if (soforEl && !soforEl.value && sofor) soforEl.value = sofor;
  if (telEl   && !telEl.value   && tel)   telEl.value   = tel;
  const dd = document.getElementById('ops-arac-dropdown');
  if (dd) dd.style.display = 'none';
  // Çekiciye atanmış birincil dorseyi otomatik öner (hidden = boş kalır;
  // kullanıcı dorse alanına focus edince listede üstte görür)
  if (cekiciId) opsDorseSugest(cekiciId);
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

/* ── DORSE ARAMA (iş emri formunda — opsiyonel) ─────────── */
async function opsDorseAra(q) {
  const dd = document.getElementById('ops-dorse-dropdown');
  if (!dd) return;
  const query = (q || '').toLowerCase().trim();
  const cekiciId = document.getElementById('ops-m-cekici-id')?.value || '';

  // Tüm dorseler
  const dorseler = (typeof vehicles !== 'undefined' ? vehicles : []).filter(v => v.kind === 'dorse');
  if (!dorseler.length) {
    dd.innerHTML = `<div style="padding:14px;text-align:center;color:var(--muted);font-size:11.5px;">
      Henüz dorse tanımlı değil. <a onclick="closeOpsIsEmriModal();openFiloPage();" style="color:var(--accent);cursor:pointer;font-weight:600;">Filo'ya git</a></div>`;
    dd.style.display = 'block';
    return;
  }

  // Eşleşmeleri çek (varsa cache'lenmiş)
  let eslesmeler = [];
  try {
    eslesmeler = (window.FiloAPI ? await window.FiloAPI.aktifEslesmeler() : []) || [];
  } catch (_) { eslesmeler = []; }

  // Tip lookup
  let tipler = [];
  try { tipler = (window.FiloAPI ? await window.FiloAPI.dorseTipleri() : []) || []; } catch (_) {}
  const tipMap = Object.fromEntries(tipler.map(t => [t.kod, t.ad]));

  // Filtrele
  const list = dorseler.filter(d =>
    !query ||
    (d.plaka || '').toLowerCase().includes(query) ||
    (d.marka || '').toLowerCase().includes(query) ||
    (d.dorse_tipi || '').toLowerCase().includes(query) ||
    ((tipMap[d.dorse_tipi] || '').toLowerCase()).includes(query)
  );

  // Sırala: önce seçili çekiciye atananlar (birincil en üstte), sonra serbest, sonra başka çekicide
  const sortKey = (d) => {
    const e = eslesmeler.find(x => x.dorse_id === d.id);
    if (cekiciId && e && e.cekici_id === cekiciId) return e.birincil_mi ? 0 : 1; // bu çekicinin
    if (!e) return 2; // serbest
    return 3; // başka çekicide
  };
  list.sort((a, b) => sortKey(a) - sortKey(b));

  if (!list.length) {
    dd.style.display = 'none';
    return;
  }
  dd.style.display = 'block';
  dd.innerHTML = list.slice(0, 30).map(d => {
    const e = eslesmeler.find(x => x.dorse_id === d.id);
    const tipAd = d.dorse_tipi ? (tipMap[d.dorse_tipi] || d.dorse_tipi) : '';
    const kap = [];
    if (d.kapasite_m3 != null)  kap.push(d.kapasite_m3 + ' m³');
    if (d.kapasite_ton != null) kap.push(d.kapasite_ton + ' ton');
    if (d.frigorifik) kap.push('❄️');
    let badge = '';
    if (cekiciId && e && e.cekici_id === cekiciId) {
      badge = e.birincil_mi
        ? '<span style="background:rgba(255,107,31,.15);color:var(--accent);padding:2px 7px;border-radius:99px;font-size:10px;font-weight:700;">★ Birincil</span>'
        : '<span style="background:rgba(56,189,248,.15);color:var(--blue);padding:2px 7px;border-radius:99px;font-size:10px;font-weight:700;">Bağlı</span>';
    } else if (e) {
      badge = `<span style="background:rgba(234,179,8,.15);color:var(--yellow);padding:2px 7px;border-radius:99px;font-size:10px;font-weight:600;" title="Şu an ${e.cekici_plaka} çekicisinde">⚠ ${e.cekici_plaka}</span>`;
    } else {
      badge = '<span style="color:var(--muted);font-size:10px;">— serbest</span>';
    }
    const safeTip   = (d.dorse_tipi || '').replace(/'/g,"\\'");
    const safeMarka = (d.marka || '').replace(/'/g,"\\'");
    return `
    <div onclick="opsDorseSec('${d.id}','${d.plaka}','${safeTip}','${safeMarka}')"
      style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <span style="font-size:18px;flex-shrink:0">📦</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-family:var(--font-mono);font-weight:700;color:var(--blue);font-size:13px;">${d.plaka}</span>
          ${tipAd ? `<span style="font-size:10.5px;color:var(--text2);background:var(--surface3);padding:1px 6px;border-radius:4px;">${tipAd}</span>` : ''}
        </div>
        ${kap.length ? `<div style="font-family:var(--font-mono);font-size:10.5px;color:var(--muted);margin-top:2px;">${kap.join(' · ')}</div>` : ''}
      </div>
      ${badge}
    </div>`;
  }).join('');
}

function opsDorseSec(dorseId, plaka, dorseTipi, marka) {
  const search = document.getElementById('ops-m-dorse-search');
  const hidden = document.getElementById('ops-m-dorse-id');
  const clear  = document.getElementById('ops-m-dorse-clear');
  if (search) search.value = plaka + (dorseTipi ? ' · ' + dorseTipi : '');
  if (hidden) hidden.value = dorseId;
  if (clear)  clear.style.display = 'inline-block';
  // Konteyner tipi alanı boşsa ve dorse tipi container ise otomatik öner
  const kontTip = document.getElementById('ops-m-kont-tip');
  if (kontTip && !kontTip.value) {
    if (dorseTipi === 'sabit_40') kontTip.value = '40 DC';
    else if (dorseTipi === 'sabit_20') kontTip.value = '20 DC';
    else if (dorseTipi === 'frigorifik') kontTip.value = 'Reefer';
  }
  const dd = document.getElementById('ops-dorse-dropdown');
  if (dd) dd.style.display = 'none';
}

function opsDorseTemizle() {
  const search = document.getElementById('ops-m-dorse-search');
  const hidden = document.getElementById('ops-m-dorse-id');
  const clear  = document.getElementById('ops-m-dorse-clear');
  if (search) search.value = '';
  if (hidden) hidden.value = '';
  if (clear)  clear.style.display = 'none';
  search?.focus();
}

/* Çekici seçilince: o çekicinin birincil dorsesi varsa otomatik öner (kullanıcı dorse alanı boşsa). */
async function opsDorseSugest(cekiciId) {
  if (!cekiciId || !window.FiloAPI) return;
  const search = document.getElementById('ops-m-dorse-search');
  if (!search || search.value.trim()) return; // kullanıcı zaten yazdıysa müdahale etme
  try {
    const baglılar = await window.FiloAPI.cekicininDorseleri(cekiciId);
    const birincil = baglılar.find(b => b.birincil_mi) || baglılar[0];
    if (birincil) opsDorseSec(birincil.dorse_id, birincil.dorse_plaka, birincil.dorse_tipi, birincil.dorse_marka);
  } catch (_) {}
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
