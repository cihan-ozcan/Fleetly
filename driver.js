/* ================================================================
   SÜRÜCÜ BELGE TAKİP SİSTEMİ
   ================================================================ */

let driverData = []; // [ {id, ad, tel, arac_id, ehliyet, src, psiko, takograf} ]
let editingDriverId = null;
let driverModalVehicleFilter = null; // null = tümü
let driverLoaded = false;

// ── LocalStorage yedek ──
function loadDriverDataLocal() {
  try { driverData = JSON.parse(localStorage.getItem('filo_surucu') || '[]'); }
  catch { driverData = []; }
}
function saveDriverDataLocal() {
  localStorage.setItem('filo_surucu', JSON.stringify(driverData));
}

// ── Supabase: tüm sürücüleri çek ──
async function loadDriverData() {
  loadDriverDataLocal(); // önce lokali yükle (hızlı görünüm)
  if (isLocalMode()) { driverLoaded = true; return; }
  try {
    const sb = getSB();
    if (!sb) { driverLoaded = true; return; }

    // surucu_belgeler tablosundan kayıtları çek
    const { data: rows, error } = await sb
      .from('surucu_belgeler')
      .select('*')
      .order('ad', { ascending: true });

    if (error) {
      console.error('Sürücü yükle Supabase hatası:', error.code, error.message, error.details);
    }

    const belgeRows = (rows || []).map(r => ({
      id      : r.id,
      ad      : r.ad,
      tel     : r.tel      || '',
      plaka   : r.arac_id  || '',
      ehliyet : r.ehliyet  || '',
      src     : r.src      || '',
      psiko   : r.psiko    || '',
      takograf: r.takograf || '',
      _kaynak : 'belge'
    }));

    // araclar tablosundaki sofor alanından da sürücüleri çek
    // vehicles zaten yüklenmiş olmalı; değilse Supabase'den al
    let aracList = vehicles.length > 0 ? vehicles : [];
    if (aracList.length === 0) {
      const { data: aracRows } = await sb.from('araclar').select('id,plaka,sofor,telefon');
      aracList = (aracRows || []).map(r => ({ id: r.id, plaka: r.plaka, sofor: r.sofor, telefon: r.telefon }));
    }

    // Araçlarda şoför adı olan ama surucu_belgeler'de kaydı olmayan sürücüleri ekle
    const belgeAracIds = new Set(belgeRows.map(d => d.plaka).filter(Boolean));
    const belgeAdlar   = new Set(belgeRows.map(d => (d.ad||'').toLowerCase().trim()).filter(Boolean));

    const aracKaynakli = aracList
      .filter(v => v.sofor && v.sofor.trim())
      .filter(v => !belgeAracIds.has(v.id) && !belgeAdlar.has(v.sofor.toLowerCase().trim()))
      .map(v => ({
        id      : 'arac_' + v.id,
        ad      : v.sofor,
        tel     : v.telefon || '',
        plaka   : v.id,
        ehliyet : '',
        src     : '',
        psiko   : '',
        takograf: '',
        _kaynak : 'arac'   // belge eklenmemiş, araçtan geliyor
      }));

    // Araçtan gelen listede aynı isim birden fazla araçta olabilir (çekici + dorse).
    // Ad + tel kombinasyonunu tekilleştir; plaka bilgisini ilk eşleşmeden al.
    const aracKaynakliUniq = [];
    const seen = new Set();
    aracKaynakli.forEach(d => {
      const key = (d.ad||'').toLowerCase().trim() + '|' + (d.tel||'').trim();
      if (!seen.has(key)) {
        seen.add(key);
        aracKaynakliUniq.push(d);
      }
    });

    driverData = [...belgeRows, ...aracKaynakliUniq]
      .sort((a, b) => (a.ad||'').localeCompare(b.ad||'', 'tr'));

    console.log('Sürücü verisi:', belgeRows.length, 'belgeli +', aracKaynakliUniq.length, 'araçtan =', driverData.length, 'toplam');
    saveDriverDataLocal();
    driverLoaded = true;
  } catch (err) {
    console.error('Sürücü verisi yüklenemedi:', err);
    driverLoaded = true;
  }
}

// ── Supabase: kaydet (upsert) ──
async function saveDriverEntryCloud(entry) {
  saveDriverDataLocal();
  if (isLocalMode()) return;
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const row = {
      id      : entry.id,
      user_id : user.id,
      ad      : entry.ad,
      tel     : entry.tel     || null,
      arac_id : entry.plaka   || null,
      ehliyet : entry.ehliyet || null,
      src     : entry.src     || null,
      psiko   : entry.psiko   || null,
      takograf: entry.takograf || null
    };
    const { error } = await sb
      .from('surucu_belgeler')
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('Sürücü Supabase kayıt hatası:', err);
    showToast('Buluta kaydedilemedi — yerel yedek alındı.', 'error');
  }
}

// ── Supabase: sil ──
async function deleteDriverEntryCloud(id) {
  saveDriverDataLocal();
  if (isLocalMode()) return;
  try {
    const sb = getSB();
    const { error } = await sb
      .from('surucu_belgeler')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) { console.error('Sürücü silme hatası:', err); }
}

// ── Yardımcılar ──
function driverDocStatus(iso) {
  if (!iso) return { cls: 'empty', days: null, txt: '—' };
  const dl = daysLeft(iso);
  if (dl === null) return { cls: 'empty', days: null, txt: '—' };
  if (dl < 0)  return { cls: 'overdue', days: dl, txt: Math.abs(dl) + ' gün geçti' };
  if (dl <= 30) return { cls: 'warn',   days: dl, txt: dl + ' gün kaldı' };
  return { cls: 'ok', days: dl, txt: dl + ' gün kaldı' };
}

function driverDocHTML(icon, label, iso) {
  const s = driverDocStatus(iso);
  const dateStr = iso ? fmtDate(iso) : '—';
  const daysHtml = s.days !== null
    ? `<span class="driver-doc-sep">·</span><span class="driver-doc-days">${s.txt}</span>`
    : '';
  return `<span class="driver-doc ${s.cls}" title="${label}">
    <span class="driver-doc-icon">${icon}</span>
    <span class="driver-doc-label">${label}</span>
    <span class="driver-doc-val">${dateStr}</span>
    ${daysHtml}
  </span>`;
}

// ── Modal aç / kapat ──
async function openDriverModal() {
  driverModalVehicleFilter = null;
  _resetDriverForm();
  _fillDriverPlacaSelect();
  switchDsTab('suruculer');
  renderDsDriverList();
  renderDsSummary();
  document.getElementById('ds-search').value = '';
  document.getElementById('driver-select-backdrop').classList.remove('hidden');
  await loadDriverData();
  renderDsDriverList();
  renderDsSummary();
}

async function openDriverModalForVehicle(vehicleId) {
  driverModalVehicleFilter = vehicleId;
  const v = vehicles.find(x => x.id === vehicleId);
  // Arama kutusuna plakayı yaz
  const searchEl = document.getElementById('ds-search');
  if (searchEl) searchEl.value = v ? v.plaka : '';
  // Ayarlar sekmesinde formu otomatik doldur
  if (v && v.sofor) {
    const existing = driverData.find(d => d.plaka === vehicleId || d.ad === v.sofor);
    if (existing) { _fillDriverForm(existing); }
    else {
      _resetDriverForm();
      document.getElementById('f-driver-ad').value  = v.sofor || '';
      document.getElementById('f-driver-tel').value = v.telefon || '';
    }
  } else { _resetDriverForm(); }
  _fillDriverPlacaSelect(vehicleId);
  switchDsTab('suruculer');
  renderDsDriverList();
  document.getElementById('driver-select-backdrop').classList.remove('hidden');
  await loadDriverData();
  renderDsDriverList();
}

function closeDriverModal() { closeDriverSelect(); }
function closeDriverSelect() {
  document.getElementById('driver-select-backdrop').classList.add('hidden');
  driverModalVehicleFilter = null;
  _resetDriverForm();
}
function closeDriverSelectBackdrop(e) {
  if (e.target === document.getElementById('driver-select-backdrop')) closeDriverSelect();
}

function _resetDriverForm() {
  editingDriverId = null;
  document.getElementById('f-driver-id').value    = '';
  document.getElementById('f-driver-ad').value    = '';
  document.getElementById('f-driver-tel').value   = '';
  document.getElementById('f-driver-ehliyet').value = '';
  document.getElementById('f-driver-src').value   = '';
  document.getElementById('f-driver-psiko').value    = '';
  document.getElementById('f-driver-takograf').value = '';
  const btn = document.querySelector('#driver-form-section .driver-add-btn');
  if (btn) btn.textContent = '👤 + Kaydet';
}

function _fillDriverForm(d) {
  editingDriverId = d.id;
  document.getElementById('f-driver-id').value      = d.id;
  document.getElementById('f-driver-ad').value      = d.ad || '';
  document.getElementById('f-driver-tel').value     = d.tel || '';
  document.getElementById('f-driver-plaka').value   = d.plaka || '';
  document.getElementById('f-driver-ehliyet').value = d.ehliyet || '';
  document.getElementById('f-driver-src').value     = d.src || '';
  document.getElementById('f-driver-psiko').value    = d.psiko    || '';
  document.getElementById('f-driver-takograf').value = d.takograf || '';
  const btn = document.querySelector('#driver-form-section .driver-add-btn');
  if (btn) btn.textContent = '💾 Güncelle';
}

function _fillDriverPlacaSelect(selectedId) {
  const sel = document.getElementById('f-driver-plaka');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Araç Seçin —</option>' +
    vehicles.map(v => `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${v.plaka}${v.sofor ? ' · ' + v.sofor : ''}</option>`).join('');
}

// ── Kaydet ──
function saveDriverEntry() {
  const ad     = document.getElementById('f-driver-ad').value.trim();
  const tel    = document.getElementById('f-driver-tel').value.trim();
  const plaka  = document.getElementById('f-driver-plaka').value;
  const ehliyet= document.getElementById('f-driver-ehliyet').value;
  const src    = document.getElementById('f-driver-src').value;
  const psiko    = document.getElementById('f-driver-psiko').value;
  const takograf = document.getElementById('f-driver-takograf').value;

  if (!ad) { showToast('Ad Soyad zorunludur.', 'error'); return; }

  if (editingDriverId) {
    const idx = driverData.findIndex(d => d.id === editingDriverId);
    if (idx !== -1) {
      // Araç kaynağından geliyorsa yeni bir gerçek ID ver (surucu_belgeler'e yazılacak)
      const isAracKaynakli = editingDriverId.startsWith('arac_');
      const newId = isAracKaynakli ? uid() : editingDriverId;
      driverData[idx] = { ...driverData[idx], id: newId, ad, tel, plaka, ehliyet, src, psiko, takograf, _kaynak: 'belge' };
      editingDriverId = newId;
      showToast('Sürücü güncellendi ✓', 'success');
    }
  } else {
    driverData.push({ id: uid(), ad, tel, plaka, ehliyet, src, psiko, takograf, _kaynak: 'belge' });
    showToast('Sürücü eklendi ✓', 'success');
  }
  saveDriverDataLocal();
  // Yeni ya da düzenlenmiş kaydı bul ve buluta gönder
  const _savedEntry = editingDriverId
    ? driverData.find(d => d.id === editingDriverId)
    : driverData[driverData.length - 1];
  if (_savedEntry) saveDriverEntryCloud(_savedEntry);
  _resetDriverForm();
  renderDsDriverList();
  renderDsSummary();
  updateDriverStat();
  updateAlerts();
}

// ── Sil ──
function deleteDriverEntry(id) {
  if (!confirm('Bu sürücü kaydını silmek istiyor musunuz?')) return;
  driverData = driverData.filter(d => d.id !== id);
  saveDriverDataLocal();
  deleteDriverEntryCloud(id);
  renderDsDriverList();
  renderDsSummary();
  updateDriverStat();
  updateAlerts();
  showToast('Sürücü silindi.', 'error');
}

// ── Düzenle ──
function editDriverEntry(id) {
  const d = driverData.find(x => x.id === id);
  if (!d) return;
  _fillDriverForm(d);
  _fillDriverPlacaSelect(d.plaka);
  switchDsTab('ayarlar');
  document.getElementById('driver-form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Sekme geçişi ──
function switchDsTab(name) {
  ['suruculer','ozet','ayarlar'].forEach(t => {
    document.getElementById('ds-tab-' + t)?.classList.toggle('active', t === name);
    document.getElementById('dspanel-' + t)?.classList.toggle('active', t === name);
  });
  if (name === 'ozet')     renderDsSummary();
  if (name === 'ayarlar')  _fillDriverPlacaSelect();
}

// ── Sürücü Listesi Render (Sekme 1) ──
function renderDsDriverList() {
  const list    = document.getElementById('ds-driver-list');
  const q       = (document.getElementById('ds-search')?.value || '').toLowerCase().trim();

  let filtered = driverData.filter(d => {
    if (!q) return true;
    const veh = vehicles.find(v => v.id === d.plaka);
    return (d.ad||'').toLowerCase().includes(q)
        || (d.tel||'').toLowerCase().includes(q)
        || (veh?.plaka||'').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    list.innerHTML = q
      ? '<div class="driver-empty"><div class="icon">🔍</div><p>Sürücü bulunamadı.</p></div>'
      : '<div class="driver-empty"><div class="icon">👤</div><p>Henüz sürücü eklenmedi.<br>⚙️ Yönetim sekmesinden ekleyin.</p></div>';
    return;
  }

  // Uyarılıları üste sırala
  filtered = filtered.slice().sort((a, b) => {
    const worstStatus = d => {
      const docs = [d.ehliyet, d.src, d.psiko, d.takograf].filter(Boolean);
      if (docs.length === 0) return 999;
      return Math.min(...docs.map(iso => daysLeft(iso) ?? 999));
    };
    return worstStatus(a) - worstStatus(b);
  });

  list.innerHTML = filtered.map(d => {
    const veh      = vehicles.find(v => v.id === d.plaka);
    const allDocs  = [d.ehliyet, d.src, d.psiko, d.takograf];
    const statuses = allDocs.filter(Boolean).map(iso => driverDocStatus(iso).cls);
    const cardCls  = statuses.includes('overdue') ? 'has-overdue'
                   : statuses.includes('warn')    ? 'has-warn' : '';

    const noBelge = d._kaynak === 'arac';
    return `<div class="driver-card ${cardCls}" style="${noBelge ? 'border-color:rgba(245,158,11,.25);' : ''}">
      <div class="driver-avatar">👤</div>
      <div class="driver-info">
        <div class="driver-name">
          ${d.ad}
          ${veh ? `<span class="driver-plate-badge">${veh.plaka}</span>` : ''}
          ${noBelge ? `<span style="font-size:10px;font-weight:600;color:var(--yellow);background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);padding:1px 7px;border-radius:5px;letter-spacing:.03em">BELGE EKLENMEMİŞ</span>` : ''}
        </div>
        <div class="driver-phone">${d.tel || 'Telefon girilmemiş'}</div>
        <div class="driver-docs">
          ${driverDocHTML('🪪', 'Ehliyet', d.ehliyet)}
          ${driverDocHTML('📋', 'SRC', d.src)}
          ${driverDocHTML('🧠', 'Psikoteknik', d.psiko)}
          ${driverDocHTML('📡', 'Takoğraf Kartı', d.takograf)}
        </div>
      </div>
      <div class="driver-actions">
        <button class="driver-edit-btn" onclick="editDriverEntry('${d.id}')" title="Düzenle">✎</button>
        ${noBelge ? '' : `<button class="driver-del-btn" onclick="deleteDriverEntry('${d.id}')" title="Sil">✕</button>`}
      </div>
    </div>`;
  }).join('');
}

// ── Genel Özet Render (Sekme 2) ──
function renderDsSummary() {
  let toplam = driverData.length;
  let gecmis = 0, warn30 = 0;
  let ehliyet_u = 0, src_u = 0, psiko_tako_u = 0;

  driverData.forEach(d => {
    const docMap = [
      { iso: d.ehliyet,  type: 'ehliyet' },
      { iso: d.src,      type: 'src' },
      { iso: d.psiko,    type: 'psiko' },
      { iso: d.takograf, type: 'takograf' },
    ];
    docMap.forEach(({ iso, type }) => {
      if (!iso) return;
      const dl = daysLeft(iso);
      if (dl === null) return;
      const isUyari = dl < 0 || dl <= 30;
      if (!isUyari) return;
      if (dl < 0) gecmis++;
      else warn30++;
      if (type === 'ehliyet')                 ehliyet_u++;
      else if (type === 'src')                src_u++;
      else if (type === 'psiko' || type === 'takograf') psiko_tako_u++;
    });
  });

  const s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  s('ds-s-toplam', toplam);
  s('ds-s-gecmis', gecmis  > 0 ? gecmis  : '—');
  s('ds-s-warn',   warn30  > 0 ? warn30  : '—');
  s('ds-s-ehliyet', ehliyet_u   > 0 ? ehliyet_u   : '—');
  s('ds-s-src',     src_u       > 0 ? src_u       : '—');
  s('ds-s-psiko',   psiko_tako_u > 0 ? psiko_tako_u : '—');

  // Kritik sürücüler listesi
  const critEl = document.getElementById('ds-critical-list');
  if (!critEl) return;
  const critItems = [];
  driverData.forEach(d => {
    const veh = vehicles.find(v => v.id === d.plaka);
    [
      { iso: d.ehliyet,  label: 'Ehliyet' },
      { iso: d.src,      label: 'SRC' },
      { iso: d.psiko,    label: 'Psikoteknik' },
      { iso: d.takograf, label: 'Takoğraf Kartı' },
    ].forEach(({ iso, label }) => {
      if (!iso) return;
      const dl = daysLeft(iso);
      if (dl === null || dl > 30) return;
      const cls   = dl < 0 ? 'red' : 'yellow';
      const badge = dl < 0 ? 'GEÇMİŞ' : dl + ' GÜN';
      critItems.push({ dl, html: `
        <div class="alert-item ${cls}" style="border-radius:10px">
          <div class="plate">${d.ad}</div>
          <div class="info">${label}${veh ? ' · ' + veh.plaka : ''}</div>
          <span class="badge ${cls}">${badge}</span>
        </div>` });
    });
  });
  critItems.sort((a, b) => a.dl - b.dl);
  critEl.innerHTML = critItems.length > 0
    ? critItems.map(x => x.html).join('')
    : '<div style="color:var(--muted);font-size:12px;padding:8px 0">Kritik belge durumu yok ✓</div>';
}

// ── Tüm sürücüleri sil ──
function confirmDeleteAllDrivers() {
  if (!confirm('Tüm sürücü kayıtları silinecek! Bu işlem geri alınamaz.')) return;
  const ids = driverData.map(d => d.id);
  driverData = [];
  saveDriverDataLocal();
  // Supabase'den de sil
  if (!isLocalMode()) {
    ids.forEach(id => deleteDriverEntryCloud(id));
  }
  renderDsDriverList();
  renderDsSummary();
  updateDriverStat();
  updateAlerts();
  showToast('Tüm sürücü kayıtları silindi.', 'error');
}

// ── Ana ekran stat kartı ──
function updateDriverStat() {
  let uyari = 0, gecmis = 0, warn30 = 0;
  driverData.forEach(d => {
    [d.ehliyet, d.src, d.psiko, d.takograf].filter(Boolean).forEach(iso => {
      const dl = daysLeft(iso);
      if (dl === null) return;
      if (dl < 0)     { gecmis++; uyari++; }
      else if (dl <= 30) { warn30++; uyari++; }
    });
  });

  const toplamEl  = document.getElementById('stat-driver-toplam');
  const uyariEl   = document.getElementById('stat-driver-uyari');
  const gecmisEl  = document.getElementById('stat-driver-gecmis');
  const warnEl    = document.getElementById('stat-driver-warn');
  const trendOk   = document.getElementById('trend-driver-ok');
  const trendWarn = document.getElementById('trend-driver-uyari');

  if (toplamEl)  toplamEl.textContent  = driverData.length;
  if (uyariEl)   uyariEl.textContent   = uyari;
  if (gecmisEl)  gecmisEl.textContent  = gecmis > 0 ? gecmis : '—';
  if (warnEl)    warnEl.textContent    = warn30 > 0 ? warn30 : '—';

  if (trendOk && trendWarn) {
    if (uyari > 0) {
      trendWarn.style.display = ''; trendOk.style.display = 'none';
    } else if (driverData.length > 0) {
      trendOk.style.display = '';  trendWarn.style.display = 'none';
    } else {
      trendOk.style.display = 'none'; trendWarn.style.display = 'none';
    }
  }
}


