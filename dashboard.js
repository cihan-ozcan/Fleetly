/* ================================================================
   DASHBOARD KART YÖNETİMİ
   ================================================================ */

const DASH_CARDS = [
  { id: 'filo-stat-card',    label: 'Filo Özeti',        sub: 'Toplam araç, çekici, dorse sayıları',   icon: '🚛', color: 'rgba(34,197,94,.12)',    def: true },
  { id: 'musteri-stat-card', label: 'Müşteri & Sipariş', sub: 'Müşteri portföyü ve sipariş yönetimi',  icon: '🤝', color: 'rgba(45,212,191,.12)',   def: true },
  { id: 'muayene-stat-card', label: 'Muayene Takibi',    sub: 'Muayenesi yaklaşan araçlar',            icon: '🔍', color: 'rgba(245,158,11,.12)',   def: true },
  { id: 'sigorta-stat-card', label: 'Sigorta Takibi',    sub: 'Sigortası yaklaşan araçlar',            icon: '🛡', color: 'rgba(239,68,68,.12)',    def: true },
  { id: 'yakit-stat-card',   label: 'Yakıt Yönetimi',    sub: 'Toplam yakıt tüketimi ve maliyeti',     icon: '⛽', color: 'rgba(249,115,22,.12)',   def: true },
  { id: 'driver-stat-card',  label: 'Sürücü Belgeleri',  sub: 'Ehliyet, SRC, psikoteknik takibi',      icon: '👤', color: 'rgba(34,197,94,.12)',    def: true },
  { id: 'maint-stat-card',   label: 'Bakım & Arıza',     sub: 'Bakım geçmişi ve arıza kayıtları',      icon: '🔧', color: 'rgba(56,189,248,.12)',   def: true },
  { id: 'sefer-stat-card',   label: 'Sefer Takibi',      sub: 'Toplam sefer, ciro ve km bilgisi',      icon: '🗺', color: 'rgba(167,139,250,.12)',  def: true },
  { id: 'masraf-stat-card',  label: 'Masraf Takibi',     sub: 'Gider kayıtları ve kategori analizi',   icon: '💸', color: 'rgba(245,158,11,.12)',   def: true },
  { id: 'rapor-stat-card',   label: 'Raporlar & Analiz', sub: 'Net kâr/zarar, ciro ve gider özeti',    icon: '📊', color: 'rgba(232,121,249,.12)',  def: true },
  { id: 'ops-stat-card',     label: 'Aktif Operasyonlar', sub: 'Bugün açık iş emirleri',               icon: '📦', color: 'rgba(232,82,26,.12)',    def: true },
];

function loadDashPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('filo_dash_prefs') || '{}');
    return saved;
  } catch { return {}; }
}

function saveDashPrefs(prefs) {
  localStorage.setItem('filo_dash_prefs', JSON.stringify(prefs));
}

function applyDashCards() {
  const prefs = loadDashPrefs();
  DASH_CARDS.forEach(card => {
    const el = document.getElementById(card.id);
    if (!el) return;
    // Eğer localStorage'da bu kart hiç kaydedilmemişse varsayılanı kullan (yeni eklenen kartlar her zaman görünür)
    const visible = Object.prototype.hasOwnProperty.call(prefs, card.id) ? prefs[card.id] : card.def;
    el.style.display = visible ? '' : 'none';
  });
}

function openDashEdit() {
  const prefs = loadDashPrefs();
  const list = document.getElementById('dash-card-list');
  list.innerHTML = DASH_CARDS.map(card => {
    const visible = prefs[card.id] !== undefined ? prefs[card.id] : card.def;
    return `<div class="dash-card-item ${visible ? '' : 'disabled-item'}" id="dash-item-${card.id}">
      <div class="dash-card-left">
        <div class="dash-card-icon" style="background:${card.color}">${card.icon}</div>
        <div>
          <div class="dash-card-name">${card.label}</div>
          <div class="dash-card-sub">${card.sub}</div>
        </div>
      </div>
      <label class="toggle-wrap">
        <input type="checkbox" ${visible ? 'checked' : ''} onchange="toggleDashCard('${card.id}', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  }).join('');
  document.getElementById('dash-edit-backdrop').classList.remove('hidden');
}

function closeDashEdit() {
  document.getElementById('dash-edit-backdrop').classList.add('hidden');
}

function dashEditBackdropClick(e) {
  if (e.target.id === 'dash-edit-backdrop') closeDashEdit();
}

function toggleDashCard(cardId, visible) {
  const prefs = loadDashPrefs();
  prefs[cardId] = visible;
  saveDashPrefs(prefs);
  applyDashCards();
  // Item stilini güncelle
  const item = document.getElementById('dash-item-' + cardId);
  if (item) item.classList.toggle('disabled-item', !visible);
}

function resetDashCards() {
  localStorage.removeItem('filo_dash_prefs');
  applyDashCards();
  openDashEdit(); // paneli yenile
}

// ── Ayarlar dropdown ──
function toggleSettings() {
  const dd = document.getElementById('settings-dropdown');
  dd.classList.toggle('hidden');
}
function closeSettings() {
  document.getElementById('settings-dropdown')?.classList.add('hidden');
}
// Dışarı tıklayınca ayarlar menüsünü kapat
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('settings-wrap');
  if (wrap && !wrap.contains(e.target)) closeSettings();
});

// ── Mobil menü ──
function toggleMobMenu() {
  const m = document.getElementById('mob-menu');
  m.classList.toggle('open');
}
function closeMobMenu() {
  document.getElementById('mob-menu').classList.remove('open');
}
// Dışarı tıklanınca menüyü kapat
document.addEventListener('click', (e) => {
  const menu = document.getElementById('mob-menu');
  const btn  = document.getElementById('mob-menu-btn');
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// Supabase Auth oturumunu kontrol et — yüklü ise sayfayı göster
checkAuth();

// Dashboard kart tercihlerini uygula
applyDashCards();
// Müşteri kartı yeni eklendiği için eski localStorage'da olmayabilir — zorla göster
(function(){ const el=document.getElementById('musteri-stat-card'); if(el) el.style.display=''; })();

