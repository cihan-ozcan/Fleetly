/* ===================================================================
   app-chunk-01.js — app.html içinden otomatik taşındı (Phase 4, mekanik)
   Orijinal konum: 8. <script> tag'i (app.html).
   İçerik AYNEN korunur; global değişkenler, fonksiyon isimleri,
   yükleme sırası değiştirilmedi. İleride modülerleştirilecek.
   ================================================================= */

/* ─── CRM TAB GEÇİŞ (standalone tab ID'leri için uyumluluk katmanı) ─── */
/* Bu tab'lar id="tab-musteriler" vb. kullanıyor; crm- prefix'li olanlar crmXxx fonksiyonlarına bağlı */
function switchTab(name, btn) {
  document.querySelectorAll('#crm-page .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ['musteriler','siparisler','analiz'].forEach(t=>{
    const el = document.getElementById('tab-'+t);
    if(el) el.classList.toggle('section-hidden', t!==name);
  });
  if(name==='siparisler') { fillMusteriSelect('siparis-musteri'); renderSiparisler(); }
  if(name==='analiz') renderAnaliz();
}

/* Standalone HTML element'leri için köprü fonksiyonlar — tümü crmMusteriler/crmSiparisler'i kullanır */
function renderStats() { crmRenderStats(); }
function renderMusteriler() { crmRenderMusteriler(); }
function renderSiparisler() { crmRenderSiparisler(); }
function renderAnaliz() { crmRenderAnaliz(); }
function fillMusteriSelect(id) { crmFillMusteriSelect(id); }

/* Standalone modal ve drawer köprüleri */
function openMusteriModal(id=null) { openCrmMusteriModal(id); }
function closeMusteriModal() { closeCrmMusteriModal(); }
function editMusteri(id) { openCrmMusteriModal(id); }
function saveMusterieri() { saveCrmMusteri(); }
function deleteMusteri(id) { deleteCrmMusteri(id); }
function openSiparisModal() { openCrmSiparisModal(); }
function closeSiparisModal() { closeCrmSiparisModal(); }
function saveSiparis() { saveCrmSiparis(); }
function deleteSiparis(id) { deleteCrmSiparis(id); }
function openDrawer(id) { openCrmDrawer(id); }
function closeDrawer() { closeCrmDrawer(); }
function exportCSV() { crmExportCSV(); }
