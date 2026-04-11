/* ================================================================
   YAKIT TAKİP SİSTEMİ
   ================================================================ */

let fuelData = {}; // { vehicleId: [ {id, tarih, km, litre, fiyat, not} ] }
let activeFuelVehicleId = null;
let fuelLoaded = false; // buluttan yüklenip yüklenmediği

// ── localStorage yedek ──
function loadFuelDataLocal() {
  try { fuelData = JSON.parse(localStorage.getItem('filo_yakit') || '{}'); }
  catch { fuelData = {}; }
}

function saveFuelDataLocal() {
  localStorage.setItem('filo_yakit', JSON.stringify(fuelData));
}

// ── Supabase: tüm yakıt verilerini çek ──
async function loadFuelData() {
  loadFuelDataLocal(); // önce lokali yükle (hızlı görünüm)
  if (isLocalMode()) { fuelLoaded = true; return; }
  try {
    const res = await fetch(sbUrl('yakit_girisleri?select=*&order=tarih.asc,km.asc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    // Satırları { vehicleId: [...] } yapısına dönüştür
    fuelData = {};
    rows.forEach(r => {
      if (!fuelData[r.arac_id]) fuelData[r.arac_id] = [];
      fuelData[r.arac_id].push({
        id    : r.id,
        tarih : r.tarih,
        km    : r.km,
        litre : r.litre,
        fiyat : r.fiyat || 0,
        not   : r.aciklama || ''
      });
    });
    saveFuelDataLocal();
    fuelLoaded = true;
  } catch (err) {
    console.error('Yakıt verisi yüklenemedi:', err);
    fuelLoaded = true; // lokali kullan
  }
}

// ── Supabase: tek kayıt ekle / güncelle (upsert) ──
async function saveFuelEntry(vehicleId, entry) {
  saveFuelDataLocal();
  if (isLocalMode()) return;

  const { data: { user } } = await getSB().auth.getUser();
  if (!user) return;

  try {
    const row = {
      id      : entry.id,
      user_id : user.id,
      firma_id: currentFirmaId,       // ← firma bazlı paylaşım
      arac_id : vehicleId,
      tarih   : entry.tarih,
      km      : entry.km,
      litre   : entry.litre,
      fiyat   : entry.fiyat || 0,
      aciklama: entry.not   || null
    };
    const res = await fetch(sbUrl('yakit_girisleri'), {
      method : 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify(row)
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t); }
  } catch (err) {
    console.error('Yakıt Supabase kayıt hatası:', err);
    showToast('Buluta kaydedilemedi — yerel yedek alındı.', 'error');
  }
}

// ── Supabase: tek kayıt sil ──
async function deleteFuelEntryCloud(entryId) {
  saveFuelDataLocal();
  if (isLocalMode()) return;
  try {
    await fetch(sbUrl('yakit_girisleri?id=eq.' + entryId), {
      method : 'DELETE',
      headers: sbHeaders()
    });
  } catch (err) { console.error('Yakıt silme hatası:', err); }
}

// ── Eski arayüz uyumluluğu için sync saveFuelData (sadece local) ──
function saveFuelData() { saveFuelDataLocal(); }

// Ana sayfa yakıt stat kartını güncelle
function updateFuelStat() {
  loadFuelDataLocal();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let totalL = 0;        // TÜM zamanlardaki toplam litre
  let thisMonthL = 0;    // Bu ayki litre

  // Son 6 ay verisini topla
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const monthTotals = {};
  months.forEach(m => monthTotals[m] = 0);

  Object.values(fuelData).forEach(entries => {
    entries.forEach(e => {
      totalL += (e.litre || 0); // Tüm zamanlardaki toplam
      if (e.tarih && e.tarih.startsWith(thisMonth)) thisMonthL += (e.litre || 0);
      const m = e.tarih ? e.tarih.slice(0,7) : '';
      if (m in monthTotals) monthTotals[m] += (e.litre || 0);
    });
  });

  const statEl = document.getElementById('stat-yakit');
  if (statEl) statEl.textContent = totalL > 0 ? totalL.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' L' : '0 L';

  // Trend badge - Bu ay kaç litre
  const trendEl = document.getElementById('trend-yakit');
  if (trendEl) {
    if (thisMonthL > 0) {
      trendEl.textContent = 'Bu ay: ' + thisMonthL.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' L';
      trendEl.className = 'stat-trend ok';
    } else {
      trendEl.textContent = 'Bu ay: 0 L';
      trendEl.className = 'stat-trend warn';
    }
  }

  // Stat label güncelle
  const statLabel = document.querySelector('#stats-grid .stat-card:last-child .stat-label');
  // Yakıt kartının label'ı HTML'de "Toplam Yakıt" olarak kalsın

  // Spark çubuğu
  const sparkWrap = document.getElementById('spark-wrap');
  if (sparkWrap) {
    const vals = months.map(m => monthTotals[m]);
    const maxV = Math.max(...vals, 1);
    sparkWrap.innerHTML = vals.map((v, i) => {
      const h = Math.max(4, Math.round((v / maxV) * 28));
      const isNow = i === 5;
      const color = isNow ? 'var(--accent)' : 'var(--border2)';
      return `<div class="spark-bar" style="height:${h}px;background:${color}" title="${months[i]}: ${v.toLocaleString('tr-TR',{maximumFractionDigits:0})} L"></div>`;
    }).join('');
  }
}

// Yakıt modali aç
async function openFuelModal(vehicleId) {
  activeFuelVehicleId = vehicleId;
  const v = vehicles.find(x => x.id === vehicleId);
  document.getElementById('fuel-modal-plate').textContent = v ? v.plaka : '—';

  // Bugünü varsayılan yap
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-fuel-tarih').value = today;
  document.getElementById('f-fuel-km').value    = '';
  document.getElementById('f-fuel-litre').value = '';
  document.getElementById('f-fuel-fiyat').value = '';
  document.getElementById('f-fuel-not').value   = '';
  document.getElementById('fuel-preview').textContent = '';

  document.getElementById('fuel-modal-backdrop').classList.remove('hidden');
  renderFuelModal(); // önce mevcut veriyle göster

  // Supabase'den taze veri çek
  await loadFuelData();
  renderFuelModal();
}

function closeFuelModal() {
  document.getElementById('fuel-modal-backdrop').classList.add('hidden');
  activeFuelVehicleId = null;
}

function closeFuelModalBackdrop(e) {
  if (e.target === document.getElementById('fuel-modal-backdrop')) closeFuelModal();
}

// Yakıt girişi ekle
function addFuelEntry() {
  const km     = parseFloat(document.getElementById('f-fuel-km').value);
  const litre  = parseFloat(document.getElementById('f-fuel-litre').value);
  const fiyat  = parseFloat(document.getElementById('f-fuel-fiyat').value) || 0;
  const tarih  = document.getElementById('f-fuel-tarih').value;
  const not    = document.getElementById('f-fuel-not').value.trim();

  if (!tarih)         { showToast('Tarih giriniz.', 'error'); return; }
  if (!km || km <= 0) { showToast('Geçerli km sayacı giriniz.', 'error'); return; }
  if (!litre || litre <= 0) { showToast('Geçerli litre giriniz.', 'error'); return; }

  if (!fuelData[activeFuelVehicleId]) fuelData[activeFuelVehicleId] = [];

  // Km kontrolü: bir önceki kayıttan küçükse uyar ama devam et
  const entries = fuelData[activeFuelVehicleId];
  if (entries.length > 0) {
    const lastKm = Math.max(...entries.map(e => e.km));
    if (km <= lastKm) {
      if (!confirm(`Girilen km (${km.toLocaleString('tr-TR')}) daha önceki bir kayıttan (${lastKm.toLocaleString('tr-TR')}) küçük veya eşit. Yine de eklensin mi?`)) return;
    }
  }

  const entry = {
    id: uid(),
    tarih,
    km,
    litre,
    fiyat,
    not
  };
  fuelData[activeFuelVehicleId].push(entry);
  fuelData[activeFuelVehicleId].sort((a, b) => new Date(a.tarih) - new Date(b.tarih) || a.km - b.km);
  saveFuelDataLocal();
  saveFuelEntry(activeFuelVehicleId, entry); // Supabase'e async kaydet
  updateFuelStat();
  updateStats(); // Filo Özeti panelini de güncelle
  const _fuelV = vehicles.find(x => x.id === activeFuelVehicleId);
  addActivity('yakıt_ekle', _fuelV?.plaka || '—', litre.toLocaleString('tr-TR',{maximumFractionDigits:1}) + ' L · ' + tarih);
  renderFuelModal();

  // Formu temizle
  document.getElementById('f-fuel-km').value    = '';
  document.getElementById('f-fuel-litre').value = '';
  document.getElementById('f-fuel-fiyat').value = '';
  document.getElementById('f-fuel-not').value   = '';
  document.getElementById('fuel-preview').textContent = '';

  showToast('Yakıt kaydı eklendi ✓', 'success');
}

// Yakıt kaydı sil
function deleteFuelEntry(vehicleId, entryId) {
  if (!fuelData[vehicleId]) return;
  if (!confirm('Bu yakıt kaydını silmek istediğinize emin misiniz?')) return;
  const _dv = vehicles.find(x => x.id === vehicleId);
  fuelData[vehicleId] = fuelData[vehicleId].filter(e => e.id !== entryId);
  saveFuelDataLocal();
  deleteFuelEntryCloud(entryId); // Supabase'den async sil
  updateFuelStat();
  renderFuelModal();
  updateStats(); // Filo Özeti panelini güncelle
  addActivity('yakıt_sil', _dv?.plaka || '—', '');
  showToast('Kayıt silindi.', 'error');
}

// Yakıt kaydı düzenle - formu doldur ve eski kaydı sil
function editFuelEntry(vehicleId, entryId) {
  if (!fuelData[vehicleId]) return;
  const entry = fuelData[vehicleId].find(e => e.id === entryId);
  if (!entry) return;

  // Formu doldur
  document.getElementById('f-fuel-tarih').value = entry.tarih || '';
  document.getElementById('f-fuel-km').value    = entry.km    || '';
  document.getElementById('f-fuel-litre').value = entry.litre || '';
  document.getElementById('f-fuel-fiyat').value = entry.fiyat || '';
  document.getElementById('f-fuel-not').value   = entry.not   || '';
  updateFuelPreview();

  // Eski kaydı sil (kaydet butonuyla yeniden eklenecek)
  deleteFuelEntryCloud(entryId); // Supabase'den eski kaydı sil
  fuelData[vehicleId] = fuelData[vehicleId].filter(e => e.id !== entryId);
  saveFuelDataLocal();
  renderFuelModal();
  const _ev = vehicles.find(x => x.id === vehicleId);
  addActivity('yakıt_düzenle', _ev?.plaka || '—', '');
  showToast('Kaydı düzenleyip "+ Ekle" butonuna basın.', 'info');
}

// L/100km hesapla
function calcConsumption(entries, idx) {
  if (idx === 0) return null;
  const curr = entries[idx];
  const prev = entries[idx - 1];
  const kmFark = curr.km - prev.km;
  if (kmFark <= 0) return null;
  return (curr.litre / kmFark) * 100;
}

function consumptionClass(l100) {
  if (l100 === null) return '';
  if (l100 < 25) return 'good';
  if (l100 < 35) return 'medium';
  return 'bad';
}

// Yakıt modalini render et
function renderFuelModal() {
  const entries = (fuelData[activeFuelVehicleId] || []).slice().sort((a,b) => new Date(a.tarih)-new Date(b.tarih) || a.km-b.km);

  // -- Özet kartlar --
  const totalL   = entries.reduce((s, e) => s + e.litre, 0);
  const totalTL  = entries.reduce((s, e) => s + (e.litre * e.fiyat), 0);
  const kmRange  = entries.length >= 2
    ? entries[entries.length-1].km - entries[0].km
    : 0;

  // Ağırlıklı ortalama tüketim
  let avgCons = null;
  if (entries.length >= 2) {
    const totalKm = entries[entries.length-1].km - entries[0].km;
    // İlk dolumu sayma (referans noktası)
    const usedL = entries.slice(1).reduce((s,e) => s + e.litre, 0);
    if (totalKm > 0) avgCons = (usedL / totalKm) * 100;
  }

  const lastEntry = entries.length > 0 ? entries[entries.length-1] : null;
  const lastFiyat = lastEntry ? lastEntry.fiyat : 0;
  const dolumCnt  = entries.length;

  const statsEl = document.getElementById('fuel-stats-row');
  statsEl.innerHTML = `
    <div class="fuel-stat">
      <div class="fuel-stat-val" style="color:var(--blue)">${dolumCnt}</div>
      <div class="fuel-stat-lbl">Toplam Dolum</div>
    </div>
    <div class="fuel-stat">
      <div class="fuel-stat-val" style="color:var(--accent)">${totalL.toLocaleString('tr-TR',{maximumFractionDigits:1})} L</div>
      <div class="fuel-stat-lbl">Toplam Litre</div>
    </div>
    <div class="fuel-stat">
      <div class="fuel-stat-val" style="color:var(--green)">${totalTL > 0 ? totalTL.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' ₺' : '—'}</div>
      <div class="fuel-stat-lbl">Toplam Tutar</div>
    </div>
    <div class="fuel-stat">
      <div class="fuel-stat-val" style="color:var(--yellow)">${kmRange > 0 ? kmRange.toLocaleString('tr-TR') + ' km' : '—'}</div>
      <div class="fuel-stat-lbl">Toplam Mesafe</div>
    </div>
    <div class="fuel-stat">
      <div class="fuel-stat-val" style="color:var(--purple)">${lastFiyat > 0 ? lastFiyat.toLocaleString('tr-TR',{minimumFractionDigits:2}) + ' ₺' : '—'}</div>
      <div class="fuel-stat-lbl">Son Birim Fiyat</div>
    </div>
    <div class="fuel-stat">
      <div class="fuel-stat-val" style="color:${avgCons ? (avgCons < 25 ? 'var(--green)' : avgCons < 35 ? 'var(--yellow)' : 'var(--red)') : 'var(--muted)'}">${avgCons ? avgCons.toFixed(1) + ' L' : '—'}</div>
      <div class="fuel-stat-lbl">Ort. L/100km</div>
    </div>
  `;

  // -- Verim çubuğu --
  const barSection = document.getElementById('fuel-eff-bar');
  const effVal     = document.getElementById('fuel-eff-val');
  const barFill    = document.getElementById('fuel-bar-fill');
  if (avgCons !== null) {
    barSection.style.display = 'block';
    effVal.textContent = avgCons.toFixed(1) + ' L/100km';
    effVal.style.color = avgCons < 25 ? 'var(--green)' : avgCons < 35 ? 'var(--yellow)' : 'var(--red)';
    const pct = Math.min(100, (avgCons / 50) * 100);
    barFill.style.width  = pct + '%';
    barFill.className    = 'fuel-bar-fill ' + (avgCons < 25 ? 'good' : avgCons < 35 ? 'medium' : 'bad');
  } else {
    barSection.style.display = 'none';
  }

  // -- Geçmiş tablo --
  const countEl = document.getElementById('fuel-entry-count');
  if (countEl) countEl.textContent = dolumCnt + ' kayıt';

  const tbody = document.getElementById('fuel-history-body');
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="fuel-empty"><div class="icon">⛽</div><p>Henüz yakıt kaydı yok. Yukarıdan ekleyin.</p></div></td></tr>`;
    return;
  }

  // Ters sırayla göster (en yeni üstte)
  const reversed = entries.slice().reverse();
  tbody.innerHTML = reversed.map((e, ri) => {
    const origIdx = entries.indexOf(e); // Orijinal index (tüketim hesabı için)
    const cons    = calcConsumption(entries, origIdx);
    const consCls = consumptionClass(cons);
    const tutar   = e.litre * e.fiyat;
    const kmFark  = origIdx > 0 ? e.km - entries[origIdx-1].km : null;
    const consTxt = cons !== null ? cons.toFixed(1) + ' L/100km' : '—';
    // vehicleId'yi veri attribute olarak HTML'e gömdük — activeFuelVehicleId'ye bağımlılığı kaldırıyoruz
    const vid = activeFuelVehicleId;
    return `
      <tr>
        <td class="mono">${fmtDate(e.tarih)}</td>
        <td class="mono">${e.km.toLocaleString('tr-TR')} km</td>
        <td class="mono" style="color:var(--accent)">${e.litre.toLocaleString('tr-TR',{minimumFractionDigits:1})} L</td>
        <td class="mono" style="color:var(--text2)">${e.fiyat > 0 ? e.fiyat.toLocaleString('tr-TR',{minimumFractionDigits:2}) + ' ₺' : '—'}</td>
        <td class="mono" style="color:var(--green)">${tutar > 0 ? tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' ₺' : '—'}</td>
        <td>${cons !== null ? `<span class="fuel-consumption-badge ${consCls}">${consTxt}</span>` : '<span style="color:var(--muted);font-size:12px">—</span>'}</td>
        <td class="mono" style="color:var(--text2)">${kmFark !== null ? '+' + kmFark.toLocaleString('tr-TR') + ' km' : '<span style="color:var(--muted)">Referans</span>'}</td>
        <td style="color:var(--muted);font-size:12px">${e.not || '—'}</td>
        <td class="col-islem">
          <div style="display:flex;gap:5px;align-items:center">
            <button class="fuel-del-btn" style="color:var(--blue);font-size:14px;width:26px;height:26px;border-radius:6px;border:1px solid rgba(56,189,248,.25);background:rgba(56,189,248,.06);display:flex;align-items:center;justify-content:center" onclick="editFuelEntry('${vid}','${e.id}')" title="Düzenle">✎</button>
            <button class="fuel-del-btn" style="font-size:14px;width:26px;height:26px;border-radius:6px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.06);display:flex;align-items:center;justify-content:center" onclick="deleteFuelEntry('${vid}','${e.id}')" title="Sil">✕</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// Canlı önizleme (form input değiştiğinde)
function updateFuelPreview() {
  const km    = parseFloat(document.getElementById('f-fuel-km').value);
  const litre = parseFloat(document.getElementById('f-fuel-litre').value);
  const fiyat = parseFloat(document.getElementById('f-fuel-fiyat').value);
  const prev  = document.getElementById('fuel-preview');

  const parts = [];
  if (litre > 0 && fiyat > 0) {
    const tutar = litre * fiyat;
    parts.push(`💰 Tutar: <strong style="color:var(--green)">${tutar.toLocaleString('tr-TR',{maximumFractionDigits:2})} ₺</strong>`);
  }

  // Tüketim tahmini (son km ile karşılaştır)
  if (km > 0 && litre > 0 && activeFuelVehicleId) {
    const entries = (fuelData[activeFuelVehicleId] || []).slice().sort((a,b) => a.km - b.km);
    if (entries.length > 0) {
      const lastKm = entries[entries.length-1].km;
      const diff   = km - lastKm;
      if (diff > 0) {
        const cons = (litre / diff) * 100;
        const cls  = consumptionClass(cons);
        const clr  = cls === 'good' ? 'var(--green)' : cls === 'medium' ? 'var(--yellow)' : 'var(--red)';
        parts.push(`⚡ Tüketim: <strong style="color:${clr}">${cons.toFixed(1)} L/100km</strong>`);
        parts.push(`📏 +${diff.toLocaleString('tr-TR')} km`);
      }
    }
  }

  prev.innerHTML = parts.length > 0 ? parts.join('&nbsp;&nbsp;|&nbsp;&nbsp;') : '';
}

// Tüm araçlar yakıt özeti (ana stat kart tıklama) — Araç seçim modalını açar
function openFuelSummary() {
  if (vehicles.length === 0) { showToast('Önce araç ekleyin.', 'error'); return; }
  if (vehicles.length === 1) {
    openFuelModal(vehicles[0].id);
    return;
  }
  loadFuelData();
  document.getElementById('vs-search').value = '';
  switchVsTab('araclar');
  renderVehicleSelect();
  renderVsSummary();
  renderVsManagement();
  document.getElementById('vehicle-select-backdrop').classList.remove('hidden');
}

// Sekme geçişi
function switchVsTab(name) {
  ['araclar','ozet','ayarlar'].forEach(t => {
    document.getElementById('vs-tab-' + t)?.classList.toggle('active', t === name);
    document.getElementById('vspanel-' + t)?.classList.toggle('active', t === name);
  });
  if (name === 'ozet') renderVsSummary();
  if (name === 'ayarlar') renderVsManagement();
}

// Seçili ay filtresi (null = tüm zamanlar)
let vsSummaryMonth = null;

// Genel özet panelini render et
function renderVsSummary() {
  const allMonths = new Set();
  Object.values(fuelData).forEach(entries => {
    entries.forEach(e => { if (e.tarih) allMonths.add(e.tarih.slice(0,7)); });
  });
  const sortedMonths = Array.from(allMonths).sort().reverse().slice(0, 12);

  const tabsEl = document.getElementById('vs-month-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = `<button class="vs-month-tab ${vsSummaryMonth===null?'active':''}" onclick="setVsSummaryMonth(null)">Tümü</button>` +
      sortedMonths.map(m => {
        const [y, mo] = m.split('-');
        return `<button class="vs-month-tab ${vsSummaryMonth===m?'active':''}" onclick="setVsSummaryMonth('${m}')">${mo}/${y}</button>`;
      }).join('');
  }

  let totalDolum = 0, totalLitre = 0, totalTutar = 0;
  let fiyatSamples = [], litreByVehicle = {};
  const aracSayisi = vehicles.filter(v => (fuelData[v.id]||[]).length > 0).length;

  vehicles.forEach(v => {
    const entries = (fuelData[v.id] || []).filter(e => !vsSummaryMonth || (e.tarih && e.tarih.startsWith(vsSummaryMonth)));
    const litre = entries.reduce((s,e) => s+(e.litre||0), 0);
    totalDolum += entries.length;
    totalLitre += litre;
    totalTutar += entries.reduce((s,e) => s+(e.litre||0)*(e.fiyat||0), 0);
    entries.forEach(e => { if (e.fiyat > 0) fiyatSamples.push(e.fiyat); });
    if (litre > 0) litreByVehicle[v.id] = { plaka: v.plaka, litre };
  });

  const avgFiyat = fiyatSamples.length > 0 ? fiyatSamples.reduce((a,b)=>a+b,0)/fiyatSamples.length : null;

  let tuketimSamples = [];
  vehicles.forEach(v => {
    const entries = (fuelData[v.id] || [])
      .filter(e => !vsSummaryMonth || (e.tarih && e.tarih.startsWith(vsSummaryMonth)))
      .slice().sort((a,b) => a.km-b.km);
    if (entries.length >= 2) {
      const totalKm = entries[entries.length-1].km - entries[0].km;
      const usedL = entries.slice(1).reduce((s,e) => s+e.litre, 0);
      if (totalKm > 0) tuketimSamples.push((usedL/totalKm)*100);
    }
  });
  const avgTuketim = tuketimSamples.length > 0 ? tuketimSamples.reduce((a,b)=>a+b,0)/tuketimSamples.length : null;

  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('vs-s-dolum',    totalDolum.toLocaleString('tr-TR'));
  set('vs-s-litre',    totalLitre > 0 ? totalLitre.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' L' : '—');
  set('vs-s-tutar',    totalTutar > 0 ? totalTutar.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' ₺' : '—');
  set('vs-s-arac',     aracSayisi + ' / ' + vehicles.length);
  set('vs-s-ort-fiyat', avgFiyat ? avgFiyat.toLocaleString('tr-TR',{minimumFractionDigits:2}) + ' ₺' : '—');

  const tuketimEl = document.getElementById('vs-s-ort-tuketim');
  if (tuketimEl) {
    if (avgTuketim !== null) {
      tuketimEl.textContent = avgTuketim.toFixed(1) + ' L/100km';
      tuketimEl.style.color = avgTuketim < 25 ? 'var(--green)' : avgTuketim < 35 ? 'var(--yellow)' : 'var(--red)';
    } else {
      tuketimEl.textContent = '—';
      tuketimEl.style.color = 'var(--muted)';
    }
  }

  const topEl = document.getElementById('vs-top-vehicles');
  if (topEl) {
    const sorted = Object.entries(litreByVehicle).sort((a,b) => b[1].litre - a[1].litre).slice(0,5);
    const maxL = sorted.length > 0 ? sorted[0][1].litre : 1;
    topEl.innerHTML = sorted.length === 0
      ? `<div style="color:var(--muted);font-size:12px">Bu dönemde kayıt yok.</div>`
      : sorted.map(([, info]) => {
          const pct = Math.max(4, Math.round((info.litre/maxL)*100));
          return `<div class="vs-top-row">
            <div class="vs-top-plaka">${info.plaka}</div>
            <div class="vs-top-bar-wrap"><div class="vs-top-bar" style="width:${pct}%"></div></div>
            <div class="vs-top-val">${info.litre.toLocaleString('tr-TR',{maximumFractionDigits:0})} L</div>
          </div>`;
        }).join('');
  }
}

function setVsSummaryMonth(m) {
  vsSummaryMonth = m;
  renderVsSummary();
}

// Yönetim sekmesini render et
function renderVsManagement() {
  const el = document.getElementById('vs-per-vehicle-delete');
  if (!el) return;
  const btns = vehicles.map(v => {
    const cnt = (fuelData[v.id] || []).length;
    if (cnt === 0) return '';
    return `<button class="vs-danger-btn" style="font-size:11px;padding:5px 11px" onclick="confirmDeleteVehicleFuel('${v.id}','${v.plaka}')">
      ${v.plaka} <span style="opacity:.6;font-weight:400">(${cnt})</span>
    </button>`;
  }).join('');
  el.innerHTML = btns || '<span style="color:var(--muted);font-size:12px">Henüz yakıt kaydı yok.</span>';
}

// Tüm yakıt verilerini sil
async function confirmDeleteAllFuel() {
  const total = Object.values(fuelData).reduce((s, a) => s + a.length, 0);
  if (total === 0) { showToast('Silinecek yakıt kaydı yok.', 'error'); return; }
  if (!confirm(`Tüm ${total} yakıt kaydı silinecek. Bu işlem geri alınamaz!\n\nDevam edilsin mi?`)) return;
  if (!isLocalMode()) {
    try {
      await fetch(sbUrl('yakit_girisleri?id=neq.null'), { method: 'DELETE', headers: sbHeaders() });
    } catch(e) { console.error(e); }
  }
  fuelData = {};
  saveFuelDataLocal();
  updateFuelStat();
  updateStats();
  renderVsSummary();
  renderVsManagement();
  showToast('Tüm yakıt kayıtları silindi.', 'error');
}

// Tek araç yakıt verilerini sil
async function confirmDeleteVehicleFuel(vehicleId, plaka) {
  const cnt = (fuelData[vehicleId] || []).length;
  if (cnt === 0) { showToast('Bu araçta kayıt yok.', 'error'); return; }
  if (!confirm(`"${plaka}" aracına ait ${cnt} yakıt kaydı silinecek.\n\nDevam edilsin mi?`)) return;
  if (!isLocalMode()) {
    try {
      await fetch(sbUrl('yakit_girisleri?arac_id=eq.' + vehicleId), { method: 'DELETE', headers: sbHeaders() });
    } catch(e) { console.error(e); }
  }
  delete fuelData[vehicleId];
  saveFuelDataLocal();
  updateFuelStat();
  updateStats();
  renderVsSummary();
  renderVsManagement();
  showToast(`${plaka} yakıt kayıtları silindi.`, 'error');
}

// Yakıt verilerini JSON olarak indir
function exportFuelJSON() {
  const out = { exportDate: new Date().toISOString(), vehicles: [] };
  vehicles.forEach(v => {
    const entries = fuelData[v.id] || [];
    if (entries.length > 0) out.vehicles.push({ plaka: v.plaka, tip: v.tip, entries });
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'yakit_verileri_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  showToast('JSON indirildi ✓', 'success');
}

function closeVehicleSelect() {
  document.getElementById('vehicle-select-backdrop').classList.add('hidden');
}

function closeVehicleSelectBackdrop(e) {
  if (e.target === document.getElementById('vehicle-select-backdrop')) closeVehicleSelect();
}

function renderVehicleSelect() {
  const q = (document.getElementById('vs-search').value || '').toLowerCase().trim();
  const list = document.getElementById('vs-vehicle-list');
  const tipIcon = { 'Çekici': '🚛', 'Dorse': '🚚', 'Kamyon': '🚚', 'Kamyonet': '🛻', 'Minivan': '🚐', 'Binek Araç': '🚗' };

  const filtered = vehicles.filter(v => {
    if (!q) return true;
    return (v.plaka || '').toLowerCase().includes(q) || (v.sofor || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="vs-empty"><div class="icon">🔍</div><p>Araç bulunamadı.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(v => {
    const entries = fuelData[v.id] || [];
    const totalL  = entries.reduce((s, e) => s + (e.litre || 0), 0);
    const icon    = tipIcon[v.tip] || '🚗';
    const dolum   = entries.length;
    return `<button class="vs-vehicle-item" onclick="selectVehicleForFuel('${v.id}')">
      <div class="vs-vehicle-icon">${icon}</div>
      <div class="vs-vehicle-info">
        <div class="vs-vehicle-plaka">${v.plaka || '—'}</div>
        <div class="vs-vehicle-meta">${v.tip || ''}${v.sofor ? ' · ' + v.sofor : ''}</div>
      </div>
      <div class="vs-vehicle-fuel">
        <span class="vs-fuel-count">${dolum > 0 ? dolum + ' dolum' : 'Kayıt yok'}</span>
        ${totalL > 0 ? `<span class="vs-fuel-total">${totalL.toLocaleString('tr-TR', {maximumFractionDigits:0})} L</span>` : ''}
      </div>
      <span class="vs-arrow">›</span>
    </button>`;
  }).join('');
}

function selectVehicleForFuel(vehicleId) {
  closeVehicleSelect();
  openFuelModal(vehicleId);
}

// Form input event'leri bağla (modal açıldıktan sonra çalışır)
document.addEventListener('DOMContentLoaded', function() {
  ['f-fuel-km','f-fuel-litre','f-fuel-fiyat'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateFuelPreview);
  });
});

// (Yakıt silme, deleteVehicle içine entegre edildi)


