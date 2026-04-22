/* ===================================================================
   app-chunk-02.js — app.html içinden otomatik taşındı (Phase 4, mekanik)
   Orijinal konum: 9. <script> tag'i (app.html).
   İçerik AYNEN korunur; global değişkenler, fonksiyon isimleri,
   yükleme sırası değiştirilmedi. İleride modülerleştirilecek.
   ================================================================= */

/* ================================================================
   ⚙️  YAPILANDIRMA — config.js dosyasından okunur (.gitignore'da)
   ================================================================ */

// config.js yüklenmemişse kullanıcıyı bilgilendir
if (!window.FILO_CONFIG) {
  document.addEventListener('DOMContentLoaded', () => {
    const err = document.getElementById('login-error');
    if (err) err.textContent = '⚠ config.js bulunamadı. config.example.js dosyasını kopyalayıp doldurun.';
  });
}

const CFG = window.FILO_CONFIG || { SUPABASE_URL: '', SUPABASE_ANON: '' };

// Supabase istemcisi (SDK ile)
let _sb = null;
function getSB() {
  if (!_sb && CFG.SUPABASE_URL && CFG.SUPABASE_ANON) {
    _sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON);
  }
  return _sb;
}

// Oturumdaki kullanıcı JWT token'ı — RLS için
let _authToken = null;

/* ---- DURUM ---- */
let vehicles    = [];
let editingId   = null;
let activeFilter= 'all';
let sortField   = null;
let sortAsc     = true;
let currentPage = 1;
let pageSize    = 25;
let currentFirmaId = null;

async function loadFirmaId() {
  try {
    const sb = getSB();
    if (!sb) return;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { data, error } = await sb
      .from('firma_kullanicilar')
      .select('firma_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (!error && data?.firma_id) {
      currentFirmaId = data.firma_id;
    }
  } catch (e) {
    // hata olursa currentFirmaId null kalır
  }
}

/* ================================================================
   GİRİŞ / ÇIKIŞ — Supabase Auth
   ================================================================ */

// Brute-force koruması
const _loginAttempts = { count: 0, lockedUntil: 0 };

async function updateFirmaHeader() {
  try {
    const el = document.getElementById('header-subtitle');
    if (!el) return;
    if (!currentFirmaId) return; // firma_id yoksa default metni koru

    const sb = getSB();
    if (!sb) return;
    const { data, error } = await sb
      .from('firmalar')
      .select('ad')
      .eq('id', currentFirmaId)
      .single();

    if (error || !data?.ad) return;

    el.textContent = data.ad + ' Araç ve Bilgi Yönetim Sistemi';
  } catch (e) {
    // hata olursa sessizce geç, default metin kalır
  }
}

let _authListenerRegistered = false;
let _isLoggingOut = false;

async function checkAuth() {
  const sb = getSB();
  if (!sb) { showLoginOverlay(); return; }

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    _authToken = session.access_token;
    await loadFirmaId();
    await updateFirmaHeader();
    hideLoginOverlay();
    // Abonelik kontrolü yap
    await checkSubscription();
    loadVehicles();
    opsLoadLocal(); // Adım 4b: operasyon stat kartı başlangıçta yüklensin
    // Müşteri stat kartı ve operasyon modal listesi için arka planda yükle
    crmLoadData().then(() => {
      updateMusteriStat();
      // Operasyon modalı açıksa select'i güncelle
      _opsPopulateMusteriSelect();
    }).catch(() => {});
  } else {
    showLoginOverlay();
  }

  // Dinleyiciyi yalnızca bir kez kaydet
  if (_authListenerRegistered) return;
  _authListenerRegistered = true;

  // Oturum değişikliklerini dinle (token yenileme, çıkış vb.)
  sb.auth.onAuthStateChange(async (event, session) => {
    // Çıkış yapılıyorken gelen sahte SIGNED_IN eventini yoksay
    if (_isLoggingOut && event === 'SIGNED_IN') return;

    if (event === 'SIGNED_IN' && session) {
      _authToken = session.access_token;
      await loadFirmaId();
      await updateFirmaHeader();
      hideLoginOverlay();
      await checkSubscription();
      // Müşteri verisini arka planda çek
      crmLoadData().then(() => {
        updateMusteriStat();
        _opsPopulateMusteriSelect();
      }).catch(() => {});
    } else if (event === 'SIGNED_OUT') {
      _isLoggingOut = false;
      _authToken = null;
      currentFirmaId = null;
      hideSubscriptionOverlay();
      hideTrialBanner();
      showLoginOverlay();
    } else if (event === 'TOKEN_REFRESHED' && session) {
      _authToken = session.access_token;
    }
  });
}

/* ================================================================
   ABONELİK / DENEME SÜRESİ KONTROL SİSTEMİ
   ================================================================ */

let _secilenSubPlan = 'aylik';

async function checkSubscription() {
  // ── Firma ID yoksa kullanıcının firması henüz oluşturulmamış ──
  // (E-posta onaylı yeni kayıtlarda RPC register sırasında çalışamaz; burada tamamlanır)
  if (!currentFirmaId) {
    try {
      const sb = getSB();
      if (!sb) return;
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        // localStorage'da kayıt formundan gelen firma bilgileri var mı?
        const firmaAdi = localStorage.getItem('fleetly_firma_adi') || user.email.split('@')[0];
        const firmaFn  = localStorage.getItem('fleetly_firma_tel') || null;
        const firmaVn  = localStorage.getItem('fleetly_firma_vno') || null;

        showToast('⏳ Firma kaydınız tamamlanıyor…', 'info');

        const { error: rpcErr } = await sb.rpc('firma_kayit_et', {
          p_firma_adi : firmaAdi,
          p_email     : user.email,
          p_telefon   : firmaFn,
          p_vergi_no  : firmaVn
        });

        if (!rpcErr) {
          // localStorage temizle
          ['fleetly_firma_adi','fleetly_firma_tel','fleetly_firma_vno'].forEach(k => localStorage.removeItem(k));
          // firma_id'yi yeniden yükle ve devam et
          await loadFirmaId();
          if (currentFirmaId) {
            await updateFirmaHeader();
            showToast('✅ Firma kaydınız tamamlandı.', 'success');
            await checkSubscription(); // geri kalanı normal akışta çalıştır
          } else {
            showToast('⚠ Firma kaydı oluşturulamadı. Lütfen destek alın.', 'error');
          }
        } else {
          console.error('Firma RPC hatası:', rpcErr.message);
          showToast('⚠ Firma kaydı oluşturulamadı: ' + rpcErr.message, 'error');
        }
      }
    } catch(e) { console.error('checkSubscription firma hatası:', e); }
    return;
  }

  try {
    const sb = getSB();
    if (!sb) return;

    // ── Önce RPC dene, hata alırsa doğrudan tablodan oku ──
    let durum = null, kalanGun = 0, bitis = null;

    const { data: rpcData, error: rpcErr } = await sb.rpc('firma_abonelik_durumu', {
      p_firma_id: currentFirmaId
    });

    if (!rpcErr && rpcData && rpcData.durum) {
      // RPC başarılı
      durum    = rpcData.durum;
      kalanGun = (typeof rpcData.kalan_gun === 'number') ? rpcData.kalan_gun : 0;
      bitis    = rpcData.bitis;
      console.log('Abonelik (RPC):', durum, kalanGun, 'gün');
    } else {
      // RPC yoksa veya hata aldıysa → doğrudan firmalar tablosunu oku
      console.warn('RPC kullanılamıyor, tablo sorgusuyla devam:', rpcErr?.message);

      const { data: firmaRow, error: firmaErr } = await sb
        .from('firmalar')
        .select('deneme_bitis, abonelik_bitis, abonelik_durumu, abonelik_plani')
        .eq('id', currentFirmaId)
        .single();

      if (firmaErr || !firmaRow) {
        console.warn('Firma verisi alınamadı, erişim açık bırakılıyor:', firmaErr?.message);
        return; // Hata durumunda engelleme!
      }

      const now = new Date();

      // Aktif ücretli abonelik var mı?
      if (firmaRow.abonelik_bitis && new Date(firmaRow.abonelik_bitis) > now) {
        const ms = new Date(firmaRow.abonelik_bitis) - now;
        kalanGun = Math.max(0, Math.floor(ms / 86400000));
        durum    = 'aktif';
        bitis    = firmaRow.abonelik_bitis;
      }
      // Deneme süresi devam ediyor mu?
      else if (firmaRow.deneme_bitis && new Date(firmaRow.deneme_bitis) > now) {
        const ms = new Date(firmaRow.deneme_bitis) - now;
        kalanGun = Math.max(0, Math.floor(ms / 86400000));
        durum    = 'deneme';
        bitis    = firmaRow.deneme_bitis;
      }
      // Deneme_bitis hiç set edilmemişse → yeni firma, 7 gün ver
      else if (!firmaRow.deneme_bitis) {
        console.info('deneme_bitis null — firma yeni, deneme başlatılıyor');
        // Supabase'de deneme_bitis güncelle
        const yeniTarih = new Date(Date.now() + 7 * 86400000).toISOString();
        await sb.from('firmalar').update({
          deneme_bitis: yeniTarih,
          abonelik_durumu: 'deneme'
        }).eq('id', currentFirmaId);
        kalanGun = 7;
        durum    = 'deneme';
        bitis    = yeniTarih;
      }
      // Süresi dolmuş
      else {
        durum    = 'suresi_dolmus';
        kalanGun = 0;
      }

      console.log('Abonelik (tablo):', durum, kalanGun, 'gün');
    }

    // ── Duruma göre UI ──
    if (durum === 'aktif') {
      hideSubscriptionOverlay();
      hideTrialBanner();
      if (kalanGun <= 10) {
        showToast('⚠ Aboneliğiniz ' + kalanGun + ' gün içinde sona eriyor.', 'warning');
      }
      return;
    }

    if (durum === 'deneme') {
      hideSubscriptionOverlay();
      showTrialBanner(kalanGun, bitis);
      return;
    }

    if (durum === 'suresi_dolmus') {
      showSubscriptionOverlay('suresi_dolmus', kalanGun);
      return;
    }

    console.warn('Bilinmeyen abonelik durumu:', durum);

  } catch (e) {
    // Beklenmedik hata → ASLA engelleme, sadece logla
    console.warn('checkSubscription beklenmedik hata (görmezden gelindi):', e.message);
  }
}

function showTrialBanner(kalanGun, bitis) {
  const banner = document.getElementById('trial-banner');
  const text   = document.getElementById('trial-banner-text');
  if (!banner) return;

  let renk = kalanGun <= 2 ? 'var(--red)' : (kalanGun <= 5 ? 'var(--yellow)' : 'var(--accent)');
  let emoji = kalanGun <= 2 ? '🚨' : (kalanGun <= 5 ? '⚠' : '⏱');

  const bitisTarih = bitis ? new Date(bitis).toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' }) : '';
  text.innerHTML = emoji + ' <strong style="color:' + renk + '">Ücretsiz Deneme</strong> — <span style="color:var(--text2)">' + kalanGun + ' gün kaldı' + (bitisTarih ? ' (' + bitisTarih + ')' : '') + '</span>';

  banner.style.display = 'flex';
  banner.classList.remove('hidden');
}

function hideTrialBanner() {
  const banner = document.getElementById('trial-banner');
  if (!banner) return;
  banner.style.display = 'none';
  banner.classList.add('hidden');
}

function showSubscriptionOverlay(neden, kalanGun) {
  const overlay = document.getElementById('subscription-overlay');
  if (!overlay) return;

  const icon  = document.getElementById('sub-icon');
  const title = document.getElementById('sub-title');
  const msg   = document.getElementById('sub-msg');

  if (neden === 'suresi_dolmus') {
    if (icon)  icon.textContent  = '⏰';
    if (title) title.textContent = 'Deneme Süreniz Doldu';
    if (msg)   msg.textContent   = '7 günlük ücretsiz deneme süreniz sona erdi. Fleetly\'yi kullanmaya devam etmek için bir plan seçin.';
  } else if (neden === 'manuel') {
    if (icon)  icon.textContent  = '💳';
    if (title) title.textContent = 'Plan Seçin';
    if (msg)   msg.textContent   = 'Dilediğiniz planı seçerek Fleetly\'den tam verim alın.';
  }

  overlay.style.display = 'flex';
  overlay.classList.remove('hidden');
  selectSubPlan('aylik');
}

function hideSubscriptionOverlay() {
  const overlay = document.getElementById('subscription-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.classList.add('hidden');
}

function openSubscriptionModal() {
  // Deneme devam ederken "Abone Ol" butonuna basınca aynı overlay'i açar
  showSubscriptionOverlay('manuel');
}

function selectSubPlan(plan) {
  _secilenSubPlan = plan;
  const aylik  = document.getElementById('sub-plan-aylik');
  const yillik = document.getElementById('sub-plan-yillik');
  if (aylik)  aylik.style.borderColor  = plan === 'aylik'  ? 'var(--accent)' : 'var(--border)';
  if (yillik) yillik.style.borderColor = plan === 'yillik' ? 'var(--accent)' : 'var(--border)';
  if (aylik)  aylik.style.background   = plan === 'aylik'  ? 'rgba(249,115,22,.06)' : 'var(--surface2)';
  if (yillik) yillik.style.background  = plan === 'yillik' ? 'rgba(249,115,22,.06)' : 'var(--surface2)';
}

function subPlanSatin() {
  // ── Shopier ödeme linkleri ──────────────────────────────────────
  // Shopier panelinden ürün oluşturduktan sonra linkleri buraya yapıştırın.
  // Shopier → Ürünler → Yeni Ürün → "Ödeme Linki"ni kopyalayın.
  const SHOPIER_LINKS = {
    aylik : 'https://www.shopier.com/45898631',
    yillik: 'https://www.shopier.com/45898648'
  };
  // ───────────────────────────────────────────────────────────────

  const link = SHOPIER_LINKS[_secilenSubPlan];

  // Henüz link eklenmemişse uyarı ver
  if (!link || link.includes('BURAYA')) {
    showToast('⚠ Ödeme linki henüz tanımlanmadı. Shopier panelinden linki ekleyin.', 'error');
    return;
  }

  const btn = document.getElementById('sub-buy-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Shopier ödeme sayfasına yönlendiriliyorsunuz…';
  }

  // Shopier linkine firma_id'yi parametre olarak ekle (takip için)
  const url = new URL(link);
  if (currentFirmaId) url.searchParams.set('ref', currentFirmaId);

  // Yeni sekmede aç — kullanıcı ödeyip geri döndüğünde uygulama hâlâ açık olsun
  window.open(url.toString(), '_blank');

  // 3 saniye sonra butonu tekrar aktif et
  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💳 Shopier ile Güvenli Öde →';
    }
    showToast('💡 Ödemeyi tamamladıysanız aboneliğiniz 24 saat içinde aktif edilecektir.', 'info');
  }, 3000);
}

function showLoginOverlay() {
  const el = document.getElementById('login-overlay');
  if (!el) return;
  el.classList.remove('hidden');
  el.style.display = 'flex';
}
function hideLoginOverlay() {
  const el = document.getElementById('login-overlay');
  if (!el) return;
  el.classList.add('hidden');
  el.style.display = 'none';
}

async function doLogin() {
  // Brute-force kilidi kontrolü
  if (Date.now() < _loginAttempts.lockedUntil) {
    const kalan = Math.ceil((_loginAttempts.lockedUntil - Date.now()) / 1000);
    document.getElementById('login-error').textContent = `⏳ Çok fazla deneme. ${kalan} saniye bekleyin.`;
    return;
  }

  const sb = getSB();
  if (!sb) {
    document.getElementById('login-error').textContent = '⚠ Yapılandırma eksik. config.js dosyasını kontrol edin.';
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');

  if (!email || !pass) { errEl.textContent = '❌ E-posta ve şifre zorunludur.'; return; }

  btn.textContent = '⏳ Giriş yapılıyor…';
  btn.disabled = true;
  errEl.textContent = '';

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  btn.textContent = '🔓 Giriş Yap';
  btn.disabled = false;

  if (error) {
    _loginAttempts.count++;
    if (_loginAttempts.count >= 5) {
      _loginAttempts.lockedUntil = Date.now() + 60_000; // 60 sn kilit
      _loginAttempts.count = 0;
      errEl.textContent = '🔒 Çok fazla hatalı deneme. 60 saniye beklemeniz gerekiyor.';
    } else {
      errEl.textContent = `❌ Giriş başarısız. (${5 - _loginAttempts.count} deneme kaldı)`;
    }
    document.getElementById('login-pass').value = '';
    return;
  }

  // Başarılı giriş
  _loginAttempts.count = 0;
  _authToken = data.session.access_token;
  errEl.textContent = '';
  await loadFirmaId();
  await updateFirmaHeader();
  hideLoginOverlay();
  await checkSubscription();
  loadVehicles();
  opsLoadLocal(); // Adım 4b: operasyon stat kartı login sonrası yüklensin
}

async function doResetPassword() {
  const sb = getSB();
  if (!sb) return;
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    document.getElementById('login-error').textContent = '❌ Önce e-posta adresinizi girin.';
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) {
    document.getElementById('login-error').textContent = '❌ Gönderilemedi: ' + error.message;
  } else {
    document.getElementById('login-error').style.color = 'var(--green)';
    document.getElementById('login-error').textContent = '✅ Şifre sıfırlama e-postası gönderildi.';
  }
}

async function doLogout() {
  // Açık olan menü/dropdown'ları kapat
  try { closeSettings(); } catch(e) {}
  try { closeMobMenu(); } catch(e) {}

  // Race condition'ı önle: signOut sırasında gelen SIGNED_IN eventini yoksay
  _isLoggingOut = true;

  try {
    const sb = getSB();
    if (sb) await sb.auth.signOut();
  } catch(e) { _isLoggingOut = false; }
  _authToken = null;
  currentFirmaId = null;
  vehicles = [];
  try { fuelData = {}; } catch(e) {}
  try { maintData = {}; } catch(e) {}
  try { seferData = []; } catch(e) {}
  try { masrafData = []; } catch(e) {}
  try { driverData = []; } catch(e) {}
  // Abonelik ekranlarını gizle
  hideSubscriptionOverlay();
  hideTrialBanner();
  // Login ekranını göster
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
    loginOverlay.style.display = 'flex';
  }
  const sub = document.getElementById('header-subtitle');
  if (sub) sub.textContent = 'Araç Yönetim Sistemi';
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-pass');
  const errEl   = document.getElementById('login-error');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
  if (errEl)   errEl.textContent = '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });
});

/* ================================================================
   BULUT VERİ (Supabase REST — kullanıcı JWT token ile)
   ================================================================ */

// Supabase REST API yardımcıları — artık anon key değil, kullanıcı JWT kullanır
function sbHeaders() {
  return {
    'Content-Type' : 'application/json',
    'apikey'       : CFG.SUPABASE_ANON,
    'Authorization': 'Bearer ' + (_authToken || CFG.SUPABASE_ANON),
    'Prefer'       : 'return=representation'
  };
}

function sbUrl(path) {
  return CFG.SUPABASE_URL + '/rest/v1/' + path;
}

// localStorage yedeği kullanılıyor mu? (URL girilmemişse)
function isLocalMode() {
  return !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('PROJE_ID');
}

async function loadVehicles() {
  // Supabase URL girilmemişse localStorage'a geri dön
  if (isLocalMode()) {
    vehicles = JSON.parse(localStorage.getItem('filo_araclar') || '[]');
    seedDemo();
    refresh();
    return;
  }

  showToast('Veriler yükleniyor…', 'info');
  try {
    // REFACTOR 2026-04-22: Önce v_arac_secim view'ını dene (yeni şema).
    //   View mevcut değilse (henüz migration çalıştırılmamışsa) araclar'a fallback.
    //   View sorgusu başarılıysa gosterim_adi + bos_mu alanları da gelir.
    let rows = null;
    let useView = false;
    try {
      const resV = await fetch(sbUrl('v_arac_secim?select=*&order=plaka.asc'), { headers: sbHeaders() });
      if (resV.ok) { rows = await resV.json(); useView = true; }
    } catch (_) { /* fallback below */ }

    if (!useView) {
      const res = await fetch(sbUrl('araclar?select=*&order=created_at.asc'), {
        headers: sbHeaders()
      });
      if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
      rows = await res.json();
    }

    // Supabase satırlarını uygulama formatına dönüştür.
    // View kullanılıyorsa gosterim_adi/bos_mu doğrudan gelir; yoksa eski şekilde üret.
    vehicles = rows.map(r => {
      const sofor = useView ? (r.sofor_ad || '') : (r.sofor || '');
      return {
        id      : r.id,
        plaka   : r.plaka,
        tip     : useView ? (r.arac_tipi || '') : (r.tip || ''),
        esleme  : r.esleme   || '',
        sofor   : sofor,
        telefon : useView ? (r.sofor_tel || '') : (r.telefon || ''),
        durum   : useView ? (r.arac_durumu || 'Aktif') : (r.durum || 'Aktif'),
        muayene : r.muayene  || '',
        sigorta : r.sigorta  || '',
        takograf: r.takograf || '',
        notlar  : r.notlar   || '',
        marka   : r.marka    || '',
        model   : r.model    || '',
        yil     : r.yil      || null,
        // REFACTOR 2026-04-22: Yeni alanlar — view'dan gelir, yoksa hesapla
        surucu_id    : useView ? (r.surucu_id || null) : null,
        gosterim_adi : useView
          ? (r.gosterim_adi || r.plaka)
          : (r.plaka + (sofor ? ' — ' + sofor : ' (boş)')),
        bos_mu       : useView ? !!r.bos_mu : !sofor,
      };
    });
    localStorage.setItem('filo_araclar', JSON.stringify(vehicles));
    showToast('Veriler buluttan yüklendi ✓', 'success');
  } catch (err) {
    console.error(err);
    showToast('Bulut bağlantısı kurulamadı, yerel veriler kullanılıyor.', 'error');
    vehicles = JSON.parse(localStorage.getItem('filo_araclar') || '[]');
  }
  seedDemo();
  refresh();
  // Araçlar yüklendikten sonra yakıt, bakım ve aktivite verilerini de çek
  await loadFuelData();
  updateFuelStat();
  updateFuelSummaryPanel();
  await loadMaintData();
  updateMaintStat();
  await loadDriverData();
  updateDriverStat();
  await loadSeferData();
  await loadMasrafData();
  await loadTeklifler();
  await loadTarifeler();
  updateTeklifStat();
  updateRaporStat();
  updateMusteriStat();
}

async function saveVehicles() {
  // Yerel yedek her zaman al
  localStorage.setItem('filo_araclar', JSON.stringify(vehicles));

  if (isLocalMode()) return;

  // Oturumdaki kullanıcının ID'sini al
  const { data: { user } } = await getSB().auth.getUser();
  if (!user) { showToast('Oturum süresi dolmuş, lütfen tekrar giriş yapın.', 'error'); return; }

  try {
    const rows = vehicles.map(v => {
      const row = {
        id      : v.id,
        user_id : user.id,
        firma_id: currentFirmaId,       // ← firma bazlı paylaşım
        plaka   : v.plaka,
        tip     : v.tip,
        esleme  : v.esleme   || null,
        // REFACTOR 2026-04-22: sofor/telefon text alanları Faz 4'te drop edilecek.
        //   Şimdilik trigger ile birincil_surucu_id'den sync ediliyor; frontend de yazmaya
        //   devam ediyor ki eski kod (migration deploy öncesi) çalışsın.
        sofor   : v.sofor    || null,
        telefon : v.telefon  || null,
        durum   : v.durum    || 'Aktif',
        muayene : v.muayene  || null,
        sigorta : v.sigorta  || null,
        takograf: v.takograf || null,
        notlar  : v.notlar   || null,
      };
      // Yeni şema kolonu varsa doldur; yoksa upsert payload'ında görünmez olur
      //   (Supabase text→json cast yapmaz, undefined alan payload'dan düşer).
      if (v.surucu_id) row.birincil_surucu_id = v.surucu_id;
      return row;
    });

    const res = await fetch(sbUrl('araclar'), {
      method : 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify(rows)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
  } catch (err) {
    console.error(err);
    showToast('Buluta kaydedilemedi — yerel yedek alındı.', 'error');
  }
}

// Tek araç sil (Supabase'den de kaldır)
async function deleteFromCloud(id) {
  if (isLocalMode()) return;
  try {
    await fetch(sbUrl(`araclar?id=eq.${id}`), {
      method : 'DELETE',
      headers: sbHeaders()
    });
  } catch (err) {
    console.error('Buluttan silinemedi:', err);
  }
}

// Tüm araçları buluttan sil (sadece oturumdaki kullanıcının verileri - RLS zaten korur)
async function deleteAllFromCloud() {
  if (isLocalMode()) return;
  try {
    // RLS sayesinde sadece auth.uid() == user_id olan satırlar silinir
    await fetch(sbUrl('araclar?id=neq.null'), { method: 'DELETE', headers: sbHeaders() });
    await fetch(sbUrl('yakit_girisleri?id=neq.null'), { method: 'DELETE', headers: sbHeaders() });
    await fetch(sbUrl('bakim_kayitlari?id=neq.null'), { method: 'DELETE', headers: sbHeaders() });
    await fetch(sbUrl('surucu_belgeler?id=neq.null'), { method: 'DELETE', headers: sbHeaders() });
  } catch (err) {
    console.error('Buluttan toplu silinemedi:', err);
  }
}

/* ================================================================
   YARDIMCI FONKSİYONLAR
   ================================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ISO tarih → GG.AA.YYYY
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// GG.AA.YYYY → ISO
function dmyToISO(s) {
  if (!s || !s.includes('.')) return s;
  const [d, m, y] = s.split('.');
  return `${y}-${m}-${d}`;
}

// ISO tarih → kalan gün (sigorta veya takograf veya muayene + 1 yıl)
// Burada "gün kalan" = sigorta bitiş - bugün (en kritik)
function daysLeft(iso) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(iso); d.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}

// En kritik tarihi al (sigorta / takograf / muayene) ve en az kalan günü döndür
// Muayene alanı doğrudan muayenenin biteceği tarihi tutar
function minDaysLeft(v) {
  const dates = [];
  if (v.sigorta)  dates.push(daysLeft(v.sigorta));
  if (v.takograf) dates.push(daysLeft(v.takograf));
  if (v.muayene)  dates.push(daysLeft(v.muayene));
  if (dates.length === 0) return null;
  return Math.min(...dates.filter(d => d !== null));
}

function colorClass(days) {
  if (days === null) return '';
  if (days < 0)   return 'red expired';
  if (days <= 30) return 'red';
  if (days <= 60) return 'yellow';
  return 'ok';
}

function statusBadge(durum) {
  const map = { 'Aktif': 'green', 'Bakımda': 'yellow', 'Pasif': 'gray' };
  return `<span class="badge ${map[durum] || 'gray'}">${durum || 'Aktif'}</span>`;
}

function tipBadge(tip) {
  const map = {
    'Çekici'    : 'orange',
    'Dorse'     : 'blue',
    'Kamyonet'  : 'green',
    'Kamyon'    : 'green',
    'Minivan'   : 'purple',
    'Binek Araç': 'gray',
  };
  return `<span class="badge ${map[tip] || 'gray'}">${tip || '—'}</span>`;
}

/* ================================================================
   ÖZET KARTLAR
   ================================================================ */
function updateStats() {
  const cekici  = vehicles.filter(v => v.tip === 'Çekici').length;
  const dorse   = vehicles.filter(v => v.tip === 'Dorse').length;
  const diger   = vehicles.filter(v => v.tip !== 'Çekici' && v.tip !== 'Dorse').length;
  const toplam  = vehicles.length;
  const aktif   = vehicles.filter(v => v.durum === 'Aktif').length;
  const bakim   = vehicles.filter(v => v.durum === 'Bakımda').length;
  const pasif   = vehicles.filter(v => v.durum === 'Pasif').length;

  const today = new Date(); today.setHours(0,0,0,0);
  const in30  = new Date(today); in30.setDate(in30.getDate() + 30);

  function near(iso) {
    if (!iso) return false;
    const d = new Date(iso); d.setHours(0,0,0,0);
    return d <= in30;
  }

  const muayeneCnt = vehicles.filter(v => near(v.muayene)).length;
  const sigortaCnt = vehicles.filter(v => near(v.sigorta)).length;

  // Stat kartlar
  document.getElementById('stat-cekici').textContent  = cekici;
  document.getElementById('stat-dorse').textContent   = dorse;
  document.getElementById('stat-diger').textContent   = diger;
  document.getElementById('stat-toplam').textContent  = toplam;
  // Birleşik kart mini sayaçlar
  const mc = document.getElementById('_cekici-mini'); if(mc) mc.textContent = cekici;
  const md = document.getElementById('_dorse-mini');  if(md) md.textContent = dorse;
  const mg = document.getElementById('_diger-mini');  if(mg) mg.textContent = diger;
  document.getElementById('stat-muayene').textContent = muayeneCnt;
  document.getElementById('stat-sigorta').textContent = sigortaCnt;

  // Trend badges
  const tm = document.getElementById('trend-muayene');
  const ts = document.getElementById('trend-sigorta');
  tm.style.display = muayeneCnt > 0 ? 'inline-flex' : 'none';
  ts.style.display = sigortaCnt > 0 ? 'inline-flex' : 'none';
  tm.textContent = muayeneCnt + ' araç';
  ts.textContent = sigortaCnt + ' araç';

  // Filo özeti paneli
  document.getElementById('sum-cekici').textContent = cekici;
  document.getElementById('sum-dorse').textContent  = dorse;
  document.getElementById('sum-diger').textContent  = diger;
  document.getElementById('sum-aktif').textContent  = aktif;
  document.getElementById('sum-bakim').textContent  = bakim;
  document.getElementById('sum-pasif').textContent  = pasif;

  // Yakıt özeti: veri zaten yüklüyse hemen yaz, değilse yüklendikten sonra yaz
  updateFuelSummaryPanel();
}

function updateFuelSummaryPanel() {
  const fuelNow = new Date();
  const fuelThisMonth = `${fuelNow.getFullYear()}-${String(fuelNow.getMonth()+1).padStart(2,'0')}`;
  let fuelTotalL = 0, fuelTotalTL = 0, fuelThisMonthL = 0, fuelDolum = 0;
  Object.values(fuelData).forEach(entries => {
    entries.forEach(e => {
      fuelTotalL  += (e.litre || 0);
      fuelTotalTL += (e.litre || 0) * (e.fiyat || 0);
      fuelDolum   += 1;
      if (e.tarih && e.tarih.startsWith(fuelThisMonth)) fuelThisMonthL += (e.litre || 0);
    });
  });
  const sdolum = document.getElementById('sum-fuel-dolum');
  const slitre = document.getElementById('sum-fuel-litre');
  const stutar = document.getElementById('sum-fuel-tutar');
  const sbuay  = document.getElementById('sum-fuel-buay');
  if (sdolum) sdolum.textContent = fuelDolum > 0 ? fuelDolum + ' dolum' : '—';
  if (slitre) slitre.textContent = fuelTotalL > 0 ? fuelTotalL.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' L' : '—';
  if (stutar) stutar.textContent = fuelTotalTL > 0 ? fuelTotalTL.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' ₺' : '—';
  if (sbuay)  sbuay.textContent  = fuelThisMonthL > 0 ? fuelThisMonthL.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' L' : '—';
}

/* ================================================================
   ACİL DURUMLAR
   ================================================================ */
function updateAlerts() {
  const list = document.getElementById('alert-list');
  const items = [];

  vehicles.forEach(v => {
    // Sigorta
    if (v.sigorta) {
      const dl = daysLeft(v.sigorta);
      if (dl !== null && dl <= 30) {
        const cls = dl < 0 ? 'red' : 'yellow';
        const txt = dl < 0 ? `Sigorta ${Math.abs(dl)} gün önce bitti` : `Sigorta ${dl} gün içinde bitiyor`;
        items.push({ cls, plate: v.plaka, info: txt, days: dl });
      }
    }
    // Takograf
    if (v.takograf) {
      const dl = daysLeft(v.takograf);
      if (dl !== null && dl <= 30) {
        const cls = dl < 0 ? 'red' : 'yellow';
        const txt = dl < 0 ? `Takograf ${Math.abs(dl)} gün önce bitti` : `Takograf ${dl} gün içinde bitiyor`;
        items.push({ cls, plate: v.plaka, info: txt, days: dl });
      }
    }
    // Muayene (bitiş tarihi doğrudan alanda saklanır)
    if (v.muayene) {
      const dl = daysLeft(v.muayene);
      if (dl !== null && dl <= 30) {
        const cls = dl < 0 ? 'red' : 'yellow';
        const txt = dl < 0 ? `Muayene ${Math.abs(dl)} gün önce geçti` : `Muayene ${dl} gün içinde bitiyor`;
        items.push({ cls, plate: v.plaka, info: txt, days: dl });
      }
    }
  });

  // Sürücü belge uyarıları
  driverData.forEach(d => {
    const docMap = [
      { iso: d.ehliyet, label: 'Ehliyet' },
      { iso: d.src,     label: 'SRC Belgesi' },
      { iso: d.psiko,    label: 'Psikoteknik' },
      { iso: d.takograf, label: 'Takoğraf Kartı' },
    ];
    docMap.forEach(({ iso, label }) => {
      if (!iso) return;
      const dl = daysLeft(iso);
      if (dl !== null && dl <= 30) {
        const cls = dl < 0 ? 'red' : 'yellow';
        const txt = dl < 0
          ? `${d.ad} — ${label} ${Math.abs(dl)} gün önce bitti`
          : `${d.ad} — ${label} ${dl} gün içinde bitiyor`;
        items.push({ cls, plate: d.ad, info: txt, days: dl });
      }
    });
  });

  items.sort((a, b) => a.days - b.days);

  const badge = document.getElementById('alert-count-badge');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>Acil durum yok</p></div>';
    if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
    return;
  }
  if (badge) { badge.style.display = 'inline-flex'; badge.textContent = items.length; }

  list.innerHTML = items.map(it => `
    <div class="alert-item ${it.cls}">
      <div class="plate">${it.plate}</div>
      <div class="info">${it.info}</div>
      <span class="badge ${it.cls}">${it.days < 0 ? 'GEÇMİŞ' : it.days + ' GÜN'}</span>
    </div>
  `).join('');
}

/* ================================================================
   FİLTRE / SIRALAMA
   ================================================================ */
function setFilter(f, el) {
  activeFilter = f;
  currentPage  = 1;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderTable();
}

function sortBy(field) {
  if (sortField === field) sortAsc = !sortAsc;
  else { sortField = field; sortAsc = true; }
  currentPage = 1;
  document.querySelectorAll('th').forEach(th => th.classList.remove('sorted'));
  const thEls = document.querySelectorAll('th');
  // map field to column index
  const fieldMap = { plaka:0, tip:1, muayene:5, sigorta:6, takograf:7, kalanGun:8, tuketim:10 };
  if (fieldMap[field] !== undefined) thEls[fieldMap[field]].classList.add('sorted');
  renderTable();
}

/* L/100km hesapla — km sıralamalı girişlerden ardışık dolumların ortalaması */
function calcTuketim(vehicleId) {
  const entries = (fuelData[vehicleId] || [])
    .filter(e => e.km > 0 && e.litre > 0)
    .slice().sort((a, b) => a.km - b.km);
  if (entries.length < 2) return null;
  let totalL = 0, totalKm = 0;
  for (let i = 1; i < entries.length; i++) {
    const km = entries[i].km - entries[i-1].km;
    if (km > 0 && km < 5000) { // aşırı uç değerleri ele
      totalL  += entries[i].litre;
      totalKm += km;
    }
  }
  if (totalKm < 1) return null;
  return (totalL / totalKm) * 100;
}

function getFilteredSorted() {
  const q = document.getElementById('search-input').value.toLowerCase();
  let list = vehicles.filter(v => {
    if (q && !v.plaka?.toLowerCase().includes(q) && !v.sofor?.toLowerCase().includes(q)) return false;
    if (activeFilter === 'Çekici' && v.tip !== 'Çekici') return false;
    if (activeFilter === 'Dorse'  && v.tip !== 'Dorse')  return false;
    if (activeFilter === 'yaklasan') {
      const md = minDaysLeft(v);
      if (md === null || md > 60) return false;
    }
    return true;
  });

  if (sortField) {
    list = list.slice().sort((a, b) => {
      let av, bv;
      if      (sortField === 'plaka')    { av = a.plaka || ''; bv = b.plaka || ''; }
      else if (sortField === 'tip')      { av = a.tip   || ''; bv = b.tip   || ''; }
      else if (sortField === 'muayene')  { av = a.muayene  || ''; bv = b.muayene  || ''; }
      else if (sortField === 'sigorta')  { av = a.sigorta  || ''; bv = b.sigorta  || ''; }
      else if (sortField === 'takograf') { av = a.takograf || ''; bv = b.takograf || ''; }
      else if (sortField === 'kalanGun') { av = minDaysLeft(a) ?? 9999; bv = minDaysLeft(b) ?? 9999; }
      else if (sortField === 'tuketim')  { av = calcTuketim(a.id) ?? 9999; bv = calcTuketim(b.id) ?? 9999; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ?  1 : -1;
      return 0;
    });
  }
  return list;
}

/* ================================================================
   TABLO RENDER
   ================================================================ */
function renderTable() {
  const tbody    = document.getElementById('table-body');
  const fullList = getFilteredSorted();
  const total    = fullList.length;
  const totPages = pageSize >= 9999 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totPages) currentPage = totPages;

  const countEl = document.getElementById('table-count');
  if (countEl) countEl.textContent = total + ' araç';

  // sayfalanmış dilim
  const sliceStart = pageSize >= 9999 ? 0 : (currentPage - 1) * pageSize;
  const list = pageSize >= 9999 ? fullList : fullList.slice(sliceStart, sliceStart + pageSize);

  // ── Mobil kart render ──
  const mobList = document.getElementById('mob-card-list');
  if (mobList) {
    if (fullList.length === 0) {
      mobList.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>Sonuç bulunamadı</p></div>';
    } else {
      mobList.innerHTML = list.map(v => {
        const md   = minDaysLeft(v);
        const cls  = colorClass(md);
        const days = md === null ? '—' : (md < 0 ? Math.abs(md) + ' gün geçti' : md + ' gün kaldı');
        const muayeneCls = v.muayene ? colorClass(daysLeft(v.muayene)) : '';
        const sigortaCls = v.sigorta ? colorClass(daysLeft(v.sigorta)) : '';
        const tuketim = calcTuketim(v.id);
        const tuketimColor = tuketim === null ? 'var(--muted)' : (tuketim <= 25 ? 'var(--green)' : tuketim <= 35 ? 'var(--yellow)' : 'var(--red)');
        return `
        <div class="mob-card">
          <div class="mob-card-header">
            <div class="mob-card-meta">
              <span class="mob-card-plaka">${v.plaka || '—'}</span>
              ${tipBadge(v.tip)}
              ${statusBadge(v.durum)}
            </div>
            ${md !== null ? `<span class="mob-card-days ${cls}">⏱ ${days}</span>` : ''}
          </div>
          <div class="mob-card-body">
            ${v.sofor ? `<div class="mob-card-field"><span class="mob-card-label">Şoför</span><span class="mob-card-value">${v.sofor}</span></div>` : ''}
            ${v.telefon ? `<div class="mob-card-field"><span class="mob-card-label">Telefon</span><span class="mob-card-value mono">${v.telefon}</span></div>` : ''}
            ${v.esleme ? `<div class="mob-card-field"><span class="mob-card-label">Eşleşme</span><span class="mob-card-value mono">${v.esleme}</span></div>` : ''}
            <div class="mob-card-field"><span class="mob-card-label">Muayene</span><span class="mob-card-value mono ${muayeneCls}">${fmtDate(v.muayene)}</span></div>
            <div class="mob-card-field"><span class="mob-card-label">Sigorta</span><span class="mob-card-value mono ${sigortaCls}">${fmtDate(v.sigorta)}</span></div>
            <div class="mob-card-field"><span class="mob-card-label">Takograf</span><span class="mob-card-value mono">${fmtDate(v.takograf)}</span></div>
            <div class="mob-card-field"><span class="mob-card-label">Tüketim</span><span class="mob-card-value mono" style="color:${tuketimColor};font-weight:700">${tuketim !== null ? tuketim.toFixed(1) + ' L/100km' : '—'}</span></div>
            ${v.notlar ? `<div class="mob-card-field" style="grid-column:1/-1"><span class="mob-card-label">Not</span><span class="mob-card-value" style="white-space:normal">${v.notlar}</span></div>` : ''}
          </div>
          <div class="mob-card-actions">
            <button class="icon-btn fuel" onclick="openFuelModal('${v.id}')">⛽<span>Yakıt</span></button>
            <button class="icon-btn maint" onclick="openMaintModal('${v.id}')">🔧<span>Bakım</span></button>
            <button class="icon-btn edit" onclick="openModal('${v.id}')">✎<span>Düzenle</span></button>
            <button class="icon-btn del" onclick="deleteVehicle('${v.id}')">✕<span>Sil</span></button>
          </div>
        </div>`;
      }).join('');
    }
  }

  if (fullList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12">
      <div class="empty-state"><div class="icon">🔍</div><p>Sonuç bulunamadı</p></div>
    </td></tr>`;
    renderPaginationBar(0, 1);
    return;
  }

  tbody.innerHTML = list.map(v => {
    const md   = minDaysLeft(v);
    const cls  = colorClass(md);
    const days = md === null ? '—' : (md < 0 ? `${Math.abs(md)} gün geçti` : `${md} gün`);
    const muayeneCls = v.muayene ? colorClass(daysLeft(v.muayene)) : '';
    const sigortaCls  = v.sigorta  ? colorClass(daysLeft(v.sigorta))  : '';
    const tuketim = calcTuketim(v.id);
    const tuketimVal = tuketim === null ? '—' : tuketim.toFixed(1);
    const tuketimCls = tuketim === null ? 'muted' : (tuketim <= 25 ? 'green' : tuketim <= 35 ? 'yellow' : 'red');
    const tuketimColor = tuketim === null ? 'var(--muted)' : (tuketim <= 25 ? 'var(--green)' : tuketim <= 35 ? 'var(--yellow)' : 'var(--red)');
    return `
    <tr>
      <td class="plate-cell">${v.plaka || '—'}</td>
      <td class="tip-cell">${tipBadge(v.tip)}</td>
      <td class="esleme-cell">${v.esleme || '—'}</td>
      <td>${v.sofor || '<span style="color:var(--muted)">Boşta</span>'}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${v.telefon || '—'}</td>
      <td class="date-cell ${muayeneCls}">${fmtDate(v.muayene)}</td>
      <td class="date-cell ${sigortaCls}">${fmtDate(v.sigorta)}</td>
      <td class="date-cell">${fmtDate(v.takograf)}</td>
      <td><div class="days-cell ${cls}">${days}</div></td>
      <td>${statusBadge(v.durum)}</td>
      <td style="font-family:var(--font-mono);font-size:12.5px;font-weight:700;color:${tuketimColor};text-align:center" title="${tuketim === null ? 'Hesaplamak için en az 2 km girişi gerekli' : tuketim.toFixed(2) + ' L/100km'}">${tuketimVal}${tuketim !== null ? '<span style="font-size:10px;font-weight:400;color:var(--muted);margin-left:2px">L</span>' : ''}</td>
      <td style="max-width:130px;white-space:normal;font-size:12px;color:var(--muted)">${v.notlar || ''}</td>
      <td>
        <div class="action-btns">
          <button class="icon-btn fuel"  title="Yakıt Ekle"         onclick="openFuelModal('${v.id}')">⛽</button>
          <button class="icon-btn maint" title="Bakım / Arıza Takibi" onclick="openMaintModal('${v.id}')">🔧</button>
          <button class="icon-btn driver" title="Sürücü Belgeleri" onclick="openDriverModalForVehicle('${v.id}')">👤</button>
          <button class="icon-btn edit"  title="Düzenle"              onclick="openModal('${v.id}')">✎</button>
          <button class="icon-btn del"  title="Sil"     onclick="deleteVehicle('${v.id}')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderPaginationBar(total, totPages);
}

function renderPaginationBar(total, totPages) {
  const bar = document.getElementById('pagination-bar');
  if (!bar) return;
  if (totPages <= 1) { bar.innerHTML = ''; return; }

  const pBtn = (label, page, isActive, isDisabled) => {
    const base = `min-width:32px;height:32px;padding:0 10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid;transition:all .15s;display:inline-flex;align-items:center;justify-content:center;`;
    const style = isActive
      ? base + 'background:var(--accent);border-color:var(--accent);color:#fff;'
      : base + `background:var(--surface2);border-color:var(--border2);color:var(--text2);opacity:${isDisabled ? '.35' : '1'};`;
    return `<button style="${style}" onclick="${isDisabled || isActive ? '' : `currentPage=${page};renderTable()`}" ${isDisabled ? 'disabled' : ''}>${label}</button>`;
  };

  let html = pBtn('‹', currentPage - 1, false, currentPage === 1);

  // akıllı sayfa numaraları
  const pages = [];
  for (let i = 1; i <= totPages; i++) {
    if (i === 1 || i === totPages || (i >= currentPage - 2 && i <= currentPage + 2)) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  pages.forEach(p => {
    if (p === '…') html += `<span style="color:var(--muted);padding:0 2px;align-self:center;font-size:13px">…</span>`;
    else html += pBtn(p, p, p === currentPage, false);
  });

  html += pBtn('›', currentPage + 1, false, currentPage === totPages);

  const from = pageSize >= 9999 ? 1 : (currentPage - 1) * pageSize + 1;
  const to   = pageSize >= 9999 ? total : Math.min(currentPage * pageSize, total);
  html += `<span style="font-size:11.5px;color:var(--muted);margin-left:8px">${from}–${to} / ${total} araç</span>`;

  bar.innerHTML = html;
}

const MAX_ACTIVITY = 50;

async function loadActivityLog() {
  try {
    let query = _sb
      .from('activity_log')
      .select('*')
      .order('ts', { ascending: false })
      .limit(MAX_ACTIVITY);
    // Sadece bu firmanın kayıtlarını göster (SaaS izolasyonu)
    if (currentFirmaId) {
      query = query.eq('firma_id', currentFirmaId);
    } else {
      // firma_id yoksa yalnızca kendi user kayıtları
      const { data: { user } } = await _sb.auth.getUser();
      if (user) query = query.eq('user_id', user.id);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (e) {
    return [];
  }
}

async function addActivity(type, plaka, detail) {
  try {
    const { data: { user } } = await _sb.auth.getUser();
    if (!user) return;
    const { error } = await _sb.from('activity_log').insert([{
      id: Date.now() + Math.random().toString(36).slice(2),
      type,
      plaka,
      detail,
      ts: new Date().toISOString(),
      user_id: user.id,
      firma_id: currentFirmaId       // ← firma bazlı paylaşım
    }]);
    if (error) throw error;
  } catch (e) {
    console.error('Activity log hatası:', e);
  }
  // Insert tamamlandıktan SONRA listeyi yenile
  await renderActivityLog();
}

// Geriye dönük uyumluluk: bazı modüller logActivity(detailHTML) çağırıyor.
// Sessizce addActivity'e yönlendiriyoruz; hata atmamalı ki ana akışı bozmasın.
function logActivity(detailHtml) {
  try {
    // HTML tag'lerini temizle, type tahmin et
    const plainText = String(detailHtml || '').replace(/<[^>]+>/g, '').trim();
    let type = 'info';
    if (/iş emri|konteyner|operasyon/i.test(plainText)) type = 'ops';
    else if (/yakıt|dolum/i.test(plainText)) type = 'yakit';
    else if (/şoför|sürücü/i.test(plainText)) type = 'sofor';
    // Plaka regex: 2 rakam + 1-3 harf + 2-4 rakam
    const plakaMatch = plainText.match(/\b\d{2}\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}\b/i);
    const plaka = plakaMatch ? plakaMatch[0].toUpperCase() : '';
    // addActivity async'dir; await etmeyiz — çağıran sync olabilir
    return addActivity(type, plaka, detailHtml);
  } catch (e) {
    console.warn('logActivity bridge hata (yoksayıldı):', e);
  }
}

async function clearActivityLog() {
  if (!confirm('Aktivite geçmişi silinsin mi?')) return;
  try {
    const { data: { user } } = await _sb.auth.getUser();
    if (!user) return;
    let del = _sb.from('activity_log').delete();
    // Firma varsa sadece o firmanın kayıtlarını sil
    if (currentFirmaId) {
      del = del.eq('firma_id', currentFirmaId);
    } else {
      del = del.eq('user_id', user.id);
    }
    const { error } = await del;
    if (error) throw error;
  } catch (e) {
    console.error('Silme hatası:', e);
  }
  renderActivityLog();
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'Az önce';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' dk önce';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' sa önce';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' gün önce';
  return new Date(isoStr).toLocaleDateString('tr-TR');
}

function fmtActivityTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('tr-TR', {day:'2-digit',month:'2-digit',year:'numeric'})
    + ' ' + d.toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'});
}

async function renderActivityLog() {
  const list = document.getElementById('activity-list');
  if (!list) return;
  list.innerHTML = '<div class="activity-empty"><div class="icon">⏳</div><p>Yükleniyor…</p></div>';
  const log = await loadActivityLog();
  if (log.length === 0) {
    list.innerHTML = '<div class="activity-empty"><div class="icon">📋</div><p>Henüz düzenleme yok.</p></div>';
    return;
  }
  const typeMap = {
    'araç_ekle':      { icon: '🚛', dot: 'green',  label: 'Yeni araç eklendi' },
    'araç_düzenle':   { icon: '✎',  dot: 'blue',   label: 'Araç düzenlendi' },
    'araç_sil':       { icon: '✕',  dot: 'red',    label: 'Araç silindi' },
    'yakıt_ekle':     { icon: '⛽', dot: 'orange', label: 'Yakıt girişi eklendi' },
    'yakıt_sil':      { icon: '🗑', dot: 'red',    label: 'Yakıt kaydı silindi' },
    'yakıt_düzenle':  { icon: '✎',  dot: 'purple', label: 'Yakıt kaydı düzenlendi' },
    'bakım_ekle':     { icon: '🔧', dot: 'blue',   label: 'Bakım kaydı eklendi' },
    'bakım_sil':      { icon: '🗑', dot: 'red',    label: 'Bakım kaydı silindi' },
    'bakım_düzenle':  { icon: '✎',  dot: 'purple', label: 'Bakım kaydı düzenlendi' },
    'sefer_ekle':     { icon: '🗺', dot: 'green',  label: 'Yeni sefer eklendi' },
    'sefer_düzenle':  { icon: '✎',  dot: 'blue',   label: 'Sefer düzenlendi' },
    'sefer_sil':      { icon: '🗑', dot: 'red',    label: 'Sefer silindi' },
    'masraf_ekle':    { icon: '💸', dot: 'yellow', label: 'Yeni masraf eklendi' },
    'masraf_düzenle': { icon: '✎',  dot: 'purple', label: 'Masraf düzenlendi' },
    'masraf_sil':     { icon: '🗑', dot: 'red',    label: 'Masraf silindi' },
  };
  list.innerHTML = log.map(entry => {
    const cfg = typeMap[entry.type] || { icon: '•', dot: 'blue', label: entry.type };
    return `<div class="activity-item">
      <div class="activity-dot ${cfg.dot}"></div>
      <div class="activity-icon">${cfg.icon}</div>
      <div class="activity-body">
        <div class="activity-title">${cfg.label} — <strong>${entry.plaka || '—'}</strong>${entry.detail ? ' <span style="color:var(--text2);font-size:11.5px;font-weight:400">· ' + entry.detail + '</span>' : ''}</div>
        <div class="activity-time" title="${fmtActivityTime(entry.ts)}">${timeAgo(entry.ts)} &nbsp;·&nbsp; ${fmtActivityTime(entry.ts)}</div>
      </div>
    </div>`;
  }).join('');
}

/* ================================================================
   MODAL
   ================================================================ */
function openModal(id) {
  editingId = id || null;
  const modal = document.getElementById('modal-backdrop');
  document.getElementById('modal-title').textContent = id ? 'Araç Düzenle' : 'Yeni Araç Ekle';
  clearForm();
  if (id) {
    const v = vehicles.find(x => x.id === id);
    if (v) populateForm(v);
  }
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  editingId = null;
}

function closeModalBackdrop(e) {
  if (e.target === document.getElementById('modal-backdrop')) closeModal();
}

function clearForm() {
  ['f-plaka','f-esleme','f-sofor','f-telefon','f-muayene','f-sigorta','f-takograf','f-notlar'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-tip').value   = '';
  document.getElementById('f-durum').value = 'Aktif';
}

function populateForm(v) {
  document.getElementById('f-plaka').value    = v.plaka    || '';
  document.getElementById('f-tip').value      = v.tip      || '';
  document.getElementById('f-esleme').value   = v.esleme   || '';
  document.getElementById('f-sofor').value    = v.sofor    || '';
  document.getElementById('f-telefon').value  = v.telefon  || '';
  document.getElementById('f-durum').value    = v.durum    || 'Aktif';
  document.getElementById('f-muayene').value  = v.muayene  || '';
  document.getElementById('f-sigorta').value  = v.sigorta  || '';
  document.getElementById('f-takograf').value = v.takograf || '';
  document.getElementById('f-notlar').value   = v.notlar   || '';
}

function saveVehicle() {
  const plaka = document.getElementById('f-plaka').value.trim().toUpperCase();
  const tip   = document.getElementById('f-tip').value;
  if (!plaka) { showToast('Plaka / Kod zorunludur.', 'error'); return; }
  if (!tip)   { showToast('Araç tipi seçiniz.', 'error'); return; }

  const data = {
    plaka,
    tip,
    esleme:   document.getElementById('f-esleme').value.trim(),
    sofor:    document.getElementById('f-sofor').value.trim(),
    telefon:  document.getElementById('f-telefon').value.trim(),
    durum:    document.getElementById('f-durum').value,
    muayene:  document.getElementById('f-muayene').value,
    sigorta:  document.getElementById('f-sigorta').value,
    takograf: document.getElementById('f-takograf').value,
    notlar:   document.getElementById('f-notlar').value.trim(),
  };

  if (editingId) {
    const idx = vehicles.findIndex(v => v.id === editingId);
    if (idx !== -1) vehicles[idx] = { ...vehicles[idx], ...data };
    addActivity('araç_düzenle', plaka, data.tip || '');
    showToast('Araç güncellendi ✓', 'success');
  } else {
    vehicles.push({ id: uid(), ...data });
    addActivity('araç_ekle', plaka, data.tip || '');
    showToast('Araç eklendi ✓', 'success');
  }

  saveVehicles();
  closeModal();
  refresh();
}

/* ================================================================
   SİL
   ================================================================ */
function deleteVehicle(id) {
  const v = vehicles.find(x => x.id === id);
  if (!confirm(`"${v?.plaka}" plakalı aracı silmek istediğinize emin misiniz?`)) return;
  const plaka = v?.plaka || '—';
  vehicles = vehicles.filter(x => x.id !== id);
  localStorage.setItem('filo_araclar', JSON.stringify(vehicles));
  // Yakıt verilerini de temizle
  if (fuelData[id]) {
    delete fuelData[id];
    saveFuelDataLocal();
    if (!isLocalMode()) {
      fetch(sbUrl('yakit_girisleri?arac_id=eq.' + id), { method: 'DELETE', headers: sbHeaders() })
        .catch(err => console.error('Yakıt silme hatası:', err));
    }
  }
  deleteFromCloud(id);
  addActivity('araç_sil', plaka, '');
  refresh();
  showToast('Araç silindi.', 'error');
}

/* ================================================================
   VERİLERİ SIFIRLA
   ================================================================ */
function confirmReset() {
  if (confirm('TÜM araç ve yakıt verileri silinecek! Bu işlem geri alınamaz. Devam etmek istiyor musunuz?')) {
    vehicles = [];
    fuelData = {};
    localStorage.setItem('filo_seeded', 'true');
    localStorage.setItem('filo_araclar', '[]');
    localStorage.setItem('filo_yakit', '{}');
    deleteAllFromCloud();
    refresh();
    showToast('Tüm veriler sıfırlandı.', 'error');
  }
}

/* ================================================================
   JSON EXPORT / IMPORT
   ================================================================ */
function exportJSON() {
  const blob = new Blob([JSON.stringify(vehicles, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `filo_yedek_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  showToast('Veriler dışa aktarıldı ✓', 'success');
}

function importJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error();
      if (!confirm(`${data.length} araç içe aktarılacak. Mevcut veriler korunacak. Devam edilsin mi?`)) return;
      const existingIds = new Set(vehicles.map(v => v.id));
      data.forEach(v => {
        if (!existingIds.has(v.id)) vehicles.push(v);
      });
      saveVehicles();
      refresh();
      showToast(`${data.length} araç içe aktarıldı ✓`, 'success');
    } catch {
      showToast('Geçersiz dosya formatı.', 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

/* ================================================================
   TOAST
   ================================================================ */
function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : '❌';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ================================================================
   ANA YENİLE
   ================================================================ */
function refresh() {
  updateStats();
  updateAlerts();
  renderTable();
  updateFuelStat();
  updateMaintStat();
  updateDriverStat();
}

/* ================================================================
   DEMO VERİSİ
   ================================================================ */
function seedDemo() {
  // Kullanıcı daha önce sıfırladıysa veya veri varsa demo ekleme
  if (localStorage.getItem('filo_seeded') === 'true') return;
  if (vehicles.length > 0) {
    localStorage.setItem('filo_seeded', 'true');
    return;
  }
  const today = new Date();
  function addDays(d, n) {
    const x = new Date(d); x.setDate(x.getDate() + n);
    return x.toISOString().split('T')[0];
  }
  function subDays(d, n) { return addDays(d, -n); }

  vehicles = [
    {
      id: uid(), plaka: '15PS475', tip: 'Çekici', esleme: 'Dorse: 06ZZZ001',
      sofor: 'Ahmet Yılmaz', telefon: '0532 111 22 33', durum: 'Aktif',
      muayene: subDays(today, 320), sigorta: addDays(today, 18),
      takograf: addDays(today, 45), notlar: 'Motor revizyonu yapıldı'
    },
    {
      id: uid(), plaka: '06ZZZ001', tip: 'Dorse', esleme: 'Çekici: 15PS475',
      sofor: 'Ahmet Yılmaz', telefon: '0532 111 22 33', durum: 'Aktif',
      muayene: subDays(today, 200), sigorta: addDays(today, 90),
      takograf: '', notlar: 'Soğutmalı kasa'
    },
    {
      id: uid(), plaka: '34KK8834', tip: 'Çekici', esleme: '',
      sofor: 'Mehmet Demir', telefon: '0541 999 00 11', durum: 'Bakımda',
      muayene: subDays(today, 10), sigorta: subDays(today, 5),
      takograf: addDays(today, 120), notlar: 'Fren sistemi arızalı'
    },
    {
      id: uid(), plaka: '35AA1234', tip: 'Kamyonet', esleme: '',
      sofor: 'Ali Koç', telefon: '0555 444 33 22', durum: 'Aktif',
      muayene: subDays(today, 180), sigorta: addDays(today, 200),
      takograf: '', notlar: ''
    },
    {
      id: uid(), plaka: '07BB5678', tip: 'Dorse', esleme: '',
      sofor: '', telefon: '', durum: 'Pasif',
      muayene: subDays(today, 400), sigorta: addDays(today, 25),
      takograf: '', notlar: 'Depoda bekliyor'
    },
  ];
  localStorage.setItem('filo_seeded', 'true');
  saveVehicles();
}

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
  // Auth token hazır değilse bulut isteği atma — yoksa RLS boş döner ve
  // localStorage yedeğini ezip yeni eklenen kayıtları "silinmiş gibi" gösterir.
  if (!_authToken) { fuelLoaded = true; return; }
  try {
    const res = await fetch(sbUrl('yakit_girisleri?select=*&order=tarih.asc,km.asc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    // Satırları { vehicleId: [...] } yapısına dönüştür
    const next = {};
    rows.forEach(r => {
      if (!next[r.arac_id]) next[r.arac_id] = [];
      next[r.arac_id].push({
        id        : r.id,
        tarih     : r.tarih,
        km        : r.km,
        litre     : r.litre,
        fiyat     : r.fiyat || 0,
        not       : r.aciklama || '',
        sofor     : r.sofor || '',
        yakitTuru : r.yakit_turu || '',
        istasyon  : r.istasyon || '',
        odemeTipi : r.odeme_tipi || '',
        fisNo     : r.fis_no || '',
        litreFiyat: r.litre_fiyat || (r.litre > 0 ? +(((r.fiyat||0)/r.litre).toFixed(2)) : 0),
        anomaliFlag: r.anomali_flag || ''
      });
    });
    // Güvenlik kapısı: cloud boş döndüyse ve local'de veri varsa
    // localStorage'ı EZME. (Genelde RLS/politika/token sorunudur.)
    const localAdet = Object.values(fuelData || {}).reduce((a,arr)=>a+(arr?.length||0),0);
    const cloudAdet = rows.length;
    if (cloudAdet === 0 && localAdet > 0) {
      console.warn('Cloud fuelData boş, local (' + localAdet + ' kayıt) korunuyor.');
      fuelLoaded = true;
      return;
    }
    fuelData = next;
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
      id         : entry.id,
      user_id    : user.id,
      firma_id   : currentFirmaId,       // ← firma bazlı paylaşım
      arac_id    : vehicleId,
      tarih      : entry.tarih,
      km         : entry.km,
      litre      : entry.litre,
      fiyat      : entry.fiyat || 0,
      aciklama   : entry.not   || null,
      sofor      : entry.sofor || null,
      yakit_turu : entry.yakitTuru || null,
      istasyon   : entry.istasyon || null,
      odeme_tipi : entry.odemeTipi || null,
      fis_no     : entry.fisNo || null,
      litre_fiyat: entry.litre > 0 ? +(((entry.fiyat||0)/entry.litre).toFixed(2)) : 0,
      anomali_flag: entry.anomaliFlag || null
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
  if (document.getElementById('f-fuel-sofor'))    document.getElementById('f-fuel-sofor').value    = v?.sofor || '';
  if (document.getElementById('f-fuel-istasyon')) document.getElementById('f-fuel-istasyon').value = '';
  if (document.getElementById('f-fuel-odeme'))    document.getElementById('f-fuel-odeme').value    = '';
  if (document.getElementById('f-fuel-fis'))      document.getElementById('f-fuel-fis').value      = '';
  document.getElementById('fuel-preview').textContent = '';

  // Şoför & istasyon otomatik tamamlama önerileri
  populateFuelAutocomplete();

  document.getElementById('fuel-modal-backdrop').classList.remove('hidden');
  renderFuelModal(); // önce mevcut veriyle göster

  // Supabase'den taze veri çek
  await loadFuelData();
  populateFuelAutocomplete();
  renderFuelModal();
}

// Şoför & istasyon datalist'lerini mevcut verilerle doldur
function populateFuelAutocomplete() {
  const soforSet = new Set();
  const istSet = new Set();
  vehicles.forEach(v => { if (v.sofor) soforSet.add(v.sofor); });
  Object.values(fuelData || {}).forEach(arr => arr.forEach(e => {
    if (e.sofor)    soforSet.add(e.sofor);
    if (e.istasyon) istSet.add(e.istasyon);
  }));
  const sdl = document.getElementById('fuel-sofor-list');
  const idl = document.getElementById('fuel-istasyon-list');
  if (sdl) sdl.innerHTML = Array.from(soforSet).map(s => `<option value="${s.replace(/"/g,'&quot;')}"></option>`).join('');
  if (idl) idl.innerHTML = Array.from(istSet).map(s => `<option value="${s.replace(/"/g,'&quot;')}"></option>`).join('');
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
  const km       = parseFloat(document.getElementById('f-fuel-km').value);
  const litre    = parseFloat(document.getElementById('f-fuel-litre').value);
  const fiyat    = parseFloat(document.getElementById('f-fuel-fiyat').value) || 0;
  const tarih    = document.getElementById('f-fuel-tarih').value;
  const not      = document.getElementById('f-fuel-not').value.trim();
  const sofor    = (document.getElementById('f-fuel-sofor')?.value || '').trim();
  const yakitTuru= document.getElementById('f-fuel-turu')?.value || 'Motorin';
  const istasyon = (document.getElementById('f-fuel-istasyon')?.value || '').trim();
  const odemeTipi= document.getElementById('f-fuel-odeme')?.value || '';
  const fisNo    = (document.getElementById('f-fuel-fis')?.value || '').trim();

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

  // Aynı gün/araç çift dolum uyarısı
  const sameDay = entries.filter(e => e.tarih === tarih);
  if (sameDay.length >= 1) {
    if (!confirm(`⚠️ Bu araç için ${tarih} tarihinde zaten ${sameDay.length} dolum kaydı var. Yeni dolum eklensin mi?`)) return;
  }

  const entry = {
    id: uid(),
    tarih, km, litre, fiyat, not,
    sofor, yakitTuru, istasyon, odemeTipi, fisNo,
    litreFiyat: litre > 0 ? +(fiyat/litre).toFixed(2) : 0,
    anomaliFlag: detectEntryAnomaly({km, litre, fiyat, tarih}, entries)
  };
  fuelData[activeFuelVehicleId].push(entry);
  fuelData[activeFuelVehicleId].sort((a, b) => new Date(a.tarih) - new Date(b.tarih) || a.km - b.km);
  saveFuelDataLocal();
  saveFuelEntry(activeFuelVehicleId, entry); // Supabase'e async kaydet
  updateFuelStat();
  updateStats(); // Filo Özeti panelini de güncelle
  const _fuelV = vehicles.find(x => x.id === activeFuelVehicleId);
  addActivity('yakıt_ekle', _fuelV?.plaka || '—', litre.toLocaleString('tr-TR',{maximumFractionDigits:1}) + ' L · ' + tarih + (sofor ? ' · '+sofor : ''));
  renderFuelModal();

  // Formu temizle (tarih dışında)
  document.getElementById('f-fuel-km').value    = '';
  document.getElementById('f-fuel-litre').value = '';
  document.getElementById('f-fuel-fiyat').value = '';
  document.getElementById('f-fuel-not').value   = '';
  if (document.getElementById('f-fuel-sofor'))    document.getElementById('f-fuel-sofor').value    = '';
  if (document.getElementById('f-fuel-istasyon')) document.getElementById('f-fuel-istasyon').value = '';
  if (document.getElementById('f-fuel-odeme'))    document.getElementById('f-fuel-odeme').value    = '';
  if (document.getElementById('f-fuel-fis'))      document.getElementById('f-fuel-fis').value      = '';
  document.getElementById('fuel-preview').textContent = '';

  if (entry.anomaliFlag) {
    showToast('Kayıt eklendi — ⚠ Anomali tespit edildi: ' + entry.anomaliFlag, 'error');
  } else {
    showToast('Yakıt kaydı eklendi ✓', 'success');
  }
}

// Tekil kayıt için anomali tespiti
function detectEntryAnomaly(newE, entries) {
  // 1) Litre > 500 — muhtemelen yanlış giriş
  if (newE.litre > 500) return 'Yüksek litre (>500L)';
  // 2) Birim fiyat anormal (<5 veya >150)
  if (newE.fiyat > 0 && (newE.fiyat < 5 || newE.fiyat > 150)) return 'Anormal birim fiyat';
  if (!entries || entries.length === 0) return '';
  // 3) Km düşüşü
  const lastKm = Math.max(...entries.map(e => e.km));
  if (newE.km < lastKm) return 'Km sayacı geri gitti';
  // 4) Aynı gün çift dolum
  const sameDay = entries.filter(e => e.tarih === newE.tarih);
  if (sameDay.length >= 1) return 'Aynı gün çift dolum';
  // 5) Yüksek tüketim (>60 L/100km)
  const prev = entries.slice().sort((a,b)=>a.km-b.km).pop();
  if (prev && newE.km > prev.km) {
    const cons = (newE.litre / (newE.km - prev.km)) * 100;
    if (cons > 60) return 'Yüksek tüketim (>60L/100km)';
    if (cons < 5 && newE.km - prev.km > 50) return 'Şüpheli düşük tüketim';
  }
  return '';
}

/* ══════════════════════════════════════════════════════════════
   KM ARALIĞI → YAKIT HESAPLAMA
   Bir aracın belirli bir km aralığında yaptığı yakıt dolumlarını
   toplar. Sefer / iş emri başına yakıt maliyetini bulmak için
   kullanılır.
   Dönüş: { litre, tl, km, count, entries }
══════════════════════════════════════════════════════════════ */
function calcFuelForKmRange(vehicleId, startKm, endKm) {
  const empty = { litre: 0, tl: 0, km: 0, count: 0, entries: [] };
  if (!vehicleId) return empty;
  const s = parseFloat(startKm), e = parseFloat(endKm);
  if (!isFinite(s) || !isFinite(e) || e <= s) return empty;
  const arr = (fuelData && fuelData[vehicleId]) || [];
  // startKm < y.km <= endKm (sefer sırasında yapılan dolum)
  const hits = arr.filter(x => {
    const k = parseFloat(x.km);
    return isFinite(k) && k > s && k <= e;
  });
  const litre = hits.reduce((a, x) => a + (parseFloat(x.litre)||0), 0);
  const tl    = hits.reduce((a, x) => a + (parseFloat(x.fiyat)||0), 0);
  return {
    litre: +litre.toFixed(2),
    tl   : +tl.toFixed(2),
    km   : +(e - s).toFixed(2),
    count: hits.length,
    entries: hits,
  };
}

/* Aynı aracın iki ardışık dolumu arasındaki tüketimi hesaplar.
   Seferin baslangic_km/bitis_km yoksa bu fallback'i kullanabiliriz:
   TL/km * sefer.km yaklaşık maliyet. */
function calcAvgTLPerKm(vehicleId) {
  const arr = (fuelData && fuelData[vehicleId]) || [];
  if (arr.length < 2) return 0;
  const sorted = arr.slice().sort((a,b) => (a.km||0) - (b.km||0));
  let totalKm = 0, totalTl = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = (sorted[i].km||0) - (sorted[i-1].km||0);
    if (d > 0 && d < 5000) { // anomali filtresi
      totalKm += d;
      totalTl += (sorted[i].fiyat||0);
    }
  }
  return totalKm > 0 ? +(totalTl / totalKm).toFixed(2) : 0;
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
  if (document.getElementById('f-fuel-sofor'))    document.getElementById('f-fuel-sofor').value    = entry.sofor     || '';
  if (document.getElementById('f-fuel-turu'))     document.getElementById('f-fuel-turu').value     = entry.yakitTuru || 'Motorin';
  if (document.getElementById('f-fuel-istasyon')) document.getElementById('f-fuel-istasyon').value = entry.istasyon  || '';
  if (document.getElementById('f-fuel-odeme'))    document.getElementById('f-fuel-odeme').value    = entry.odemeTipi || '';
  if (document.getElementById('f-fuel-fis'))      document.getElementById('f-fuel-fis').value      = entry.fisNo     || '';
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
    tbody.innerHTML = `<tr><td colspan="15"><div class="fuel-empty"><div class="icon">⛽</div><p>Henüz yakıt kaydı yok. Yukarıdan ekleyin.</p></div></td></tr>`;
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
    // Anomali yeniden hesapla (güncel verilerle)
    const flag = detectEntryAnomaly(e, entries.filter(x => x.id !== e.id && new Date(x.tarih) <= new Date(e.tarih)));
    const flagBadge = flag
      ? `<span title="${flag}" style="display:inline-block;padding:2px 7px;border-radius:999px;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.35);color:var(--red);font-size:10.5px;font-weight:700">⚠ ${flag}</span>`
      : `<span style="display:inline-block;padding:2px 7px;border-radius:999px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:var(--green);font-size:10.5px;font-weight:700">✓ OK</span>`;
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
        <td style="color:var(--text2);font-size:12px">${e.sofor || '<span style="color:var(--muted)">—</span>'}</td>
        <td style="color:var(--text2);font-size:12px">${e.istasyon || '<span style="color:var(--muted)">—</span>'}</td>
        <td style="color:var(--text2);font-size:12px">${e.yakitTuru || '<span style="color:var(--muted)">—</span>'}</td>
        <td style="color:var(--text2);font-size:12px">${e.odemeTipi || '<span style="color:var(--muted)">—</span>'}</td>
        <td class="mono" style="color:var(--text2);font-size:12px">${e.fisNo || '<span style="color:var(--muted)">—</span>'}</td>
        <td style="color:var(--muted);font-size:12px">${e.not || '—'}</td>
        <td>${flagBadge}</td>
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
  ['araclar','ozet','trend','sofor','anomali','sefer','ayarlar'].forEach(t => {
    document.getElementById('vs-tab-' + t)?.classList.toggle('active', t === name);
    document.getElementById('vspanel-' + t)?.classList.toggle('active', t === name);
  });
  if (name === 'ozet')    renderVsSummary();
  if (name === 'trend')   renderVsTrendCharts();
  if (name === 'sofor')   renderVsSoforAnalizi();
  if (name === 'anomali') renderVsAnomaliler();
  if (name === 'sefer')   renderVsSeferAnalizi();
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

  // ---- Maliyet Analizi: TL/km, önceki aya göre, en pahalı dolum ----
  // Toplam km: her araç için (max-min) aralığı toplamı (seçili dönemde)
  let donemKm = 0;
  vehicles.forEach(v => {
    const entries = (fuelData[v.id] || [])
      .filter(e => !vsSummaryMonth || (e.tarih && e.tarih.startsWith(vsSummaryMonth)))
      .slice().sort((a,b) => a.km-b.km);
    if (entries.length >= 2) donemKm += Math.max(0, entries[entries.length-1].km - entries[0].km);
  });
  const tlKm = donemKm > 0 && totalTutar > 0 ? totalTutar / donemKm : null;
  set('vs-s-tl-km', tlKm !== null ? tlKm.toLocaleString('tr-TR',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₺' : '—');

  // Önceki aya göre (sadece vsSummaryMonth set edildiğinde anlamlı)
  const ayDeltaEl = document.getElementById('vs-s-ay-delta');
  if (ayDeltaEl) {
    if (vsSummaryMonth) {
      // prevMonth = vsSummaryMonth - 1
      const [yy, mm] = vsSummaryMonth.split('-').map(Number);
      const prev = new Date(yy, mm-2, 1);
      const prevKey = prev.getFullYear() + '-' + String(prev.getMonth()+1).padStart(2,'0');
      let prevTL = 0;
      Object.values(fuelData).forEach(arr => arr.forEach(e => {
        if (e.tarih && e.tarih.startsWith(prevKey)) prevTL += (e.litre||0)*(e.fiyat||0);
      }));
      if (prevTL > 0) {
        const diffPct = ((totalTutar - prevTL) / prevTL) * 100;
        const arrow = diffPct >= 0 ? '↑' : '↓';
        const clr = diffPct > 5 ? 'var(--red)' : diffPct < -5 ? 'var(--green)' : 'var(--yellow)';
        ayDeltaEl.textContent = arrow + ' %' + Math.abs(diffPct).toFixed(1);
        ayDeltaEl.style.color = clr;
      } else {
        ayDeltaEl.textContent = '— (önceki ay yok)';
        ayDeltaEl.style.color = 'var(--muted)';
      }
    } else {
      // Tümü seçiliyken bu ay vs önceki ay
      const now = new Date();
      const thisK = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
      const prevD = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const prevK = prevD.getFullYear()+'-'+String(prevD.getMonth()+1).padStart(2,'0');
      let thisTL=0, prevTL=0;
      Object.values(fuelData).forEach(arr => arr.forEach(e => {
        if (!e.tarih) return;
        if (e.tarih.startsWith(thisK)) thisTL += (e.litre||0)*(e.fiyat||0);
        if (e.tarih.startsWith(prevK)) prevTL += (e.litre||0)*(e.fiyat||0);
      }));
      if (prevTL > 0) {
        const diffPct = ((thisTL - prevTL) / prevTL) * 100;
        const arrow = diffPct >= 0 ? '↑' : '↓';
        ayDeltaEl.textContent = arrow + ' %' + Math.abs(diffPct).toFixed(1);
        ayDeltaEl.style.color = diffPct > 5 ? 'var(--red)' : diffPct < -5 ? 'var(--green)' : 'var(--yellow)';
        ayDeltaEl.title = 'Bu ay (' + thisK + ') önceki aya göre';
      } else {
        ayDeltaEl.textContent = '—';
        ayDeltaEl.style.color = 'var(--muted)';
      }
    }
  }

  // En pahalı dolum
  let enPahali = null;
  vehicles.forEach(v => {
    (fuelData[v.id] || []).forEach(e => {
      if (!vsSummaryMonth || (e.tarih && e.tarih.startsWith(vsSummaryMonth))) {
        const t = (e.litre||0)*(e.fiyat||0);
        if (!enPahali || t > enPahali.tutar) enPahali = {tutar: t, plaka: v.plaka, tarih: e.tarih};
      }
    });
  });
  const enPahaliEl = document.getElementById('vs-s-en-pahali');
  if (enPahaliEl) {
    enPahaliEl.textContent = enPahali && enPahali.tutar > 0 ? enPahali.tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' ₺' : '—';
    enPahaliEl.title = enPahali ? (enPahali.plaka + ' · ' + enPahali.tarih) : '';
  }

  // En çok dolum yapılan istasyonlar
  const istEl = document.getElementById('vs-top-istasyonlar');
  if (istEl) {
    const istMap = {};
    Object.values(fuelData).forEach(arr => arr.forEach(e => {
      if (!vsSummaryMonth || (e.tarih && e.tarih.startsWith(vsSummaryMonth))) {
        const k = (e.istasyon || '').trim();
        if (!k) return;
        if (!istMap[k]) istMap[k] = {cnt:0, litre:0, tutar:0};
        istMap[k].cnt++;
        istMap[k].litre += (e.litre||0);
        istMap[k].tutar += (e.litre||0)*(e.fiyat||0);
      }
    }));
    const sortedI = Object.entries(istMap).sort((a,b) => b[1].litre - a[1].litre).slice(0,5);
    const maxIL = sortedI.length > 0 ? sortedI[0][1].litre : 1;
    istEl.innerHTML = sortedI.length === 0
      ? `<div style="color:var(--muted);font-size:12px">Henüz istasyon bilgisi girilmedi.</div>`
      : sortedI.map(([k, info]) => {
          const pct = Math.max(4, Math.round((info.litre/maxIL)*100));
          return `<div class="vs-top-row">
            <div class="vs-top-plaka">${k}</div>
            <div class="vs-top-bar-wrap"><div class="vs-top-bar" style="width:${pct}%;background:linear-gradient(90deg,#22d3ee,#06b6d4)"></div></div>
            <div class="vs-top-val">${info.cnt} dolum · ${info.litre.toLocaleString('tr-TR',{maximumFractionDigits:0})} L</div>
          </div>`;
        }).join('');
  }
}

// ─────────────────────────────────────────────────────────────────
// TREND & GRAFİK SEKMESI
// ─────────────────────────────────────────────────────────────────
let _chartAylik = null, _chartFiyat = null, _chartArac = null, _chartSofor = null;

function renderVsTrendCharts() {
  if (typeof Chart === 'undefined') return;
  const now = new Date();
  const months = [];
  for (let i=11; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), d});
  }
  const litreByMonth = {}, tutarByMonth = {}, priceByMonth = {};
  months.forEach(m => { litreByMonth[m.key]=0; tutarByMonth[m.key]=0; priceByMonth[m.key]=[]; });

  Object.values(fuelData).forEach(arr => arr.forEach(e => {
    if (!e.tarih) return;
    const k = e.tarih.slice(0,7);
    if (k in litreByMonth) {
      litreByMonth[k] += (e.litre||0);
      tutarByMonth[k] += (e.litre||0)*(e.fiyat||0);
      if (e.fiyat > 0) priceByMonth[k].push(e.fiyat);
    }
  }));

  const labels = months.map(m => m.d.toLocaleDateString('tr-TR',{month:'short',year:'2-digit'}));

  // Grafik 1: Aylık trend (bar+line)
  if (_chartAylik) _chartAylik.destroy();
  const el1 = document.getElementById('chart-aylik-trend');
  if (el1) {
    _chartAylik = new Chart(el1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type:'bar',  label: 'Litre (L)', data: months.map(m => +litreByMonth[m.key].toFixed(1)), backgroundColor:'rgba(249,115,22,0.6)', borderColor:'#f97316', borderWidth:1.5, yAxisID:'y' },
          { type:'line', label: 'Maliyet (₺)', data: months.map(m => +tutarByMonth[m.key].toFixed(0)), borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,0.15)', tension:0.35, fill:false, yAxisID:'y1', pointRadius:3 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:'#a8b8cc', font:{size:11} } } },
        scales: {
          x:  { ticks:{ color:'#a8b8cc' }, grid:{ color:'rgba(255,255,255,0.05)' } },
          y:  { position:'left', ticks:{ color:'#f97316' }, grid:{ color:'rgba(255,255,255,0.05)' }, title:{ display:true, text:'Litre', color:'#f97316' } },
          y1: { position:'right', ticks:{ color:'#22c55e' }, grid:{ drawOnChartArea:false }, title:{ display:true, text:'TL', color:'#22c55e' } }
        }
      }
    });
  }

  // Grafik 2: Birim fiyat trend (line)
  if (_chartFiyat) _chartFiyat.destroy();
  const el2 = document.getElementById('chart-fiyat-trend');
  if (el2) {
    const avgP = months.map(m => {
      const arr = priceByMonth[m.key];
      return arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2) : null;
    });
    _chartFiyat = new Chart(el2, {
      type: 'line',
      data: {
        labels,
        datasets: [{ label:'Ort. Birim Fiyat (₺/L)', data: avgP, borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,0.15)', fill:true, tension:0.4, spanGaps:true, pointRadius:3 }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:'#a8b8cc' } } },
        scales: {
          x: { ticks:{ color:'#a8b8cc' }, grid:{ color:'rgba(255,255,255,0.05)' } },
          y: { ticks:{ color:'#a78bfa' }, grid:{ color:'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  // Grafik 3: Araç bazlı bar
  if (_chartArac) _chartArac.destroy();
  const el3 = document.getElementById('chart-arac-bar');
  if (el3) {
    const arr = vehicles.map(v => {
      const litre = (fuelData[v.id] || []).reduce((s,e) => s+(e.litre||0), 0);
      return { plaka: v.plaka, litre };
    }).filter(r => r.litre > 0).sort((a,b) => b.litre - a.litre).slice(0, 10);
    _chartArac = new Chart(el3, {
      type: 'bar',
      data: {
        labels: arr.map(r => r.plaka),
        datasets: [{ label:'Toplam Litre', data: arr.map(r => +r.litre.toFixed(1)), backgroundColor:'rgba(56,189,248,0.65)', borderColor:'#38bdf8', borderWidth:1.5 }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales: {
          x: { ticks:{ color:'#a8b8cc' }, grid:{ color:'rgba(255,255,255,0.05)' } },
          y: { ticks:{ color:'#a8b8cc' }, grid:{ color:'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// ŞOFÖR ANALİZİ SEKMESİ
// ─────────────────────────────────────────────────────────────────
function renderVsSoforAnalizi() {
  // Şoför bazlı toplam
  const map = {}; // sofor → { dolum, litre, tutar, prices:[], cons:[] }
  vehicles.forEach(v => {
    const entries = (fuelData[v.id] || []).slice().sort((a,b) => a.km-b.km);
    // Araç bazlı ortalama tüketim (bu araç için)
    const vehAvg = entries.length >= 2 && (entries[entries.length-1].km - entries[0].km) > 0
      ? (entries.slice(1).reduce((s,e)=>s+(e.litre||0),0) / (entries[entries.length-1].km - entries[0].km)) * 100
      : null;
    entries.forEach(e => {
      const key = (e.sofor || '').trim() || (v.sofor || '').trim() || '— Bilinmeyen —';
      if (!map[key]) map[key] = { dolum:0, litre:0, tutar:0, prices:[], vehCons:new Set() };
      map[key].dolum++;
      map[key].litre += (e.litre||0);
      map[key].tutar += (e.litre||0)*(e.fiyat||0);
      if (e.fiyat > 0) map[key].prices.push(e.fiyat);
      if (vehAvg !== null) map[key].vehCons.add(vehAvg);
    });
  });

  const rows = Object.entries(map).map(([sofor, v]) => {
    const ortP = v.prices.length ? v.prices.reduce((a,b)=>a+b,0)/v.prices.length : null;
    const consArr = Array.from(v.vehCons);
    const ortCons = consArr.length ? consArr.reduce((a,b)=>a+b,0)/consArr.length : null;
    return { sofor, ...v, ortP, ortCons };
  }).sort((a,b) => b.litre - a.litre);

  // Skor hesabı: düşük L/100km ve düşük ₺/L iyi. 0-100 skala.
  const maxCons = Math.max(...rows.map(r => r.ortCons || 0), 1);
  const maxPrice = Math.max(...rows.map(r => r.ortP || 0), 1);
  rows.forEach(r => {
    if (r.ortCons === null) { r.skor = null; return; }
    const consSkor = Math.max(0, 100 - ((r.ortCons / maxCons) * 100));
    const priceSkor = r.ortP ? Math.max(0, 100 - ((r.ortP / maxPrice) * 60)) : 80;
    r.skor = Math.round(consSkor * 0.7 + priceSkor * 0.3);
  });

  const tbody = document.getElementById('vs-sofor-body');
  if (tbody) {
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px">Henüz şoför bazlı kayıt yok.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => {
        const skorClr = r.skor === null ? 'var(--muted)' : r.skor >= 75 ? 'var(--green)' : r.skor >= 50 ? 'var(--yellow)' : 'var(--red)';
        const skorBadge = r.skor === null ? '—' : `<span style="padding:3px 9px;border-radius:999px;background:${skorClr===('var(--green)')?'rgba(34,197,94,.15)':skorClr===('var(--yellow)')?'rgba(245,158,11,.15)':'rgba(239,68,68,.15)'};color:${skorClr};font-weight:700">${r.skor}/100</span>`;
        return `<tr>
          <td style="font-weight:600">${r.sofor}</td>
          <td class="mono">${r.dolum}</td>
          <td class="mono" style="color:var(--accent)">${r.litre.toLocaleString('tr-TR',{maximumFractionDigits:0})} L</td>
          <td class="mono" style="color:var(--green)">${r.tutar > 0 ? r.tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' ₺' : '—'}</td>
          <td class="mono">${r.ortP ? r.ortP.toFixed(2) + ' ₺' : '—'}</td>
          <td class="mono" style="color:${r.ortCons ? (r.ortCons<25?'var(--green)':r.ortCons<35?'var(--yellow)':'var(--red)') : 'var(--muted)'}">${r.ortCons ? r.ortCons.toFixed(1) + ' L' : '—'}</td>
          <td>${skorBadge}</td>
        </tr>`;
      }).join('');
    }
  }

  // Grafik
  if (_chartSofor) _chartSofor.destroy();
  const el = document.getElementById('chart-sofor-bar');
  if (el && rows.filter(r => r.ortCons).length > 0) {
    const top = rows.filter(r => r.ortCons).sort((a,b) => a.ortCons - b.ortCons).slice(0, 10);
    _chartSofor = new Chart(el, {
      type:'bar',
      data: {
        labels: top.map(r => r.sofor),
        datasets: [{ label:'Ort. L/100km', data: top.map(r => +r.ortCons.toFixed(1)),
          backgroundColor: top.map(r => r.ortCons<25?'rgba(34,197,94,.7)':r.ortCons<35?'rgba(245,158,11,.7)':'rgba(239,68,68,.7)'),
          borderWidth:1.2 }]
      },
      options: {
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales: {
          x: { ticks:{ color:'#a8b8cc' }, grid:{ color:'rgba(255,255,255,0.05)' } },
          y: { ticks:{ color:'#a8b8cc' }, grid:{ color:'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// ANOMALİ TESPİT SEKMESİ
// ─────────────────────────────────────────────────────────────────
function renderVsAnomaliler() {
  const anoms = []; // {tarih, plaka, sofor, litre, km, fiyat, problem}
  let doubleFill = 0, kmBack = 0, highCons = 0;

  vehicles.forEach(v => {
    const entries = (fuelData[v.id] || []).slice().sort((a,b) => new Date(a.tarih) - new Date(b.tarih) || a.km - b.km);
    entries.forEach((e, i) => {
      const problems = [];
      // 1) Km geri gitmiş
      if (i > 0 && e.km < entries[i-1].km) { problems.push('Km sayacı geri gitti'); kmBack++; }
      // 2) Aynı gün çift dolum
      if (i > 0 && e.tarih === entries[i-1].tarih) { problems.push('Aynı gün çift dolum'); doubleFill++; }
      // 3) Yüksek tüketim
      if (i > 0 && entries[i-1].km < e.km) {
        const cons = (e.litre / (e.km - entries[i-1].km)) * 100;
        if (cons > 60) { problems.push('Yüksek tüketim ('+cons.toFixed(1)+' L/100km)'); highCons++; }
      }
      // 4) Anormal birim fiyat
      if (e.fiyat > 0 && (e.fiyat < 5 || e.fiyat > 150)) problems.push('Anormal birim fiyat ('+e.fiyat+' ₺)');
      // 5) Yüksek litre
      if (e.litre > 500) problems.push('Yüksek litre ('+e.litre+' L)');
      // 6) Mevcut flag
      if (e.anomaliFlag && !problems.some(p => p.startsWith(e.anomaliFlag))) problems.push(e.anomaliFlag);

      if (problems.length > 0) {
        anoms.push({
          tarih: e.tarih, plaka: v.plaka, sofor: e.sofor || v.sofor || '—',
          litre: e.litre, km: e.km, fiyat: e.fiyat,
          problem: problems.join(' · ')
        });
      }
    });
  });

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('anom-total', anoms.length);
  set('anom-doublefill', doubleFill);
  set('anom-kmback', kmBack);
  set('anom-highcons', highCons);

  const tbody = document.getElementById('vs-anom-body');
  if (tbody) {
    if (anoms.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--green);padding:18px;font-weight:600">✓ Tüm kayıtlar normal görünüyor. Herhangi bir anomali bulunamadı.</td></tr>`;
    } else {
      tbody.innerHTML = anoms
        .sort((a,b) => new Date(b.tarih) - new Date(a.tarih))
        .map(a => `<tr>
          <td class="mono">${fmtDate(a.tarih)}</td>
          <td style="font-weight:600">${a.plaka}</td>
          <td>${a.sofor}</td>
          <td class="mono" style="color:var(--accent)">${(a.litre||0).toLocaleString('tr-TR',{maximumFractionDigits:1})} L</td>
          <td class="mono">${(a.km||0).toLocaleString('tr-TR')} km</td>
          <td class="mono">${a.fiyat > 0 ? a.fiyat.toFixed(2) + ' ₺' : '—'}</td>
          <td><span style="color:var(--red);font-weight:600;font-size:11.5px">⚠ ${a.problem}</span></td>
        </tr>`).join('');
    }
  }
}

function setVsSummaryMonth(m) {
  vsSummaryMonth = m;
  renderVsSummary();
}

/* ══════════════════════════════════════════════════════════════
   SEFER ANALİZİ — Her sefer için yakıt ve kâr hesapla
   ══════════════════════════════════════════════════════════ */
function _computeSeferYakitRows() {
  // Hem seferData hem isEmirleri'yi birleştir. Öncelik seferData'da,
  // iş emri ile bağlı seferler aynı satıra düşer.
  const rows = [];
  if (typeof seferData !== 'undefined' && Array.isArray(seferData)) {
    seferData.forEach(s => {
      const veh = vehicles.find(v => v.id === s.aracId || v.plaka === s.plaka);
      const hasKmRange = (s.baslangic_km != null && s.bitis_km != null && s.bitis_km > s.baslangic_km);
      const km = hasKmRange ? (s.bitis_km - s.baslangic_km) : (s.km || 0);
      let litre = 0, tl = 0, count = 0, note = '';
      if (veh && hasKmRange) {
        const r = calcFuelForKmRange(veh.id, s.baslangic_km, s.bitis_km);
        litre = r.litre; tl = r.tl; count = r.count;
      } else if (s.yakit_tutar != null) {
        litre = +(s.yakit_litre || 0); tl = +s.yakit_tutar; note = 'cache';
      } else if (veh && km > 0) {
        const tlkm = calcAvgTLPerKm(veh.id);
        if (tlkm > 0) { tl = +(tlkm * km).toFixed(0); note = 'tahmin'; }
      }
      const ucret = +(s.ucret || 0);
      const kar   = ucret > 0 ? ucret - tl : null;
      const marj  = ucret > 0 ? (kar / ucret) * 100 : null;
      rows.push({
        kaynak: 'sefer',
        id: s.id,
        tarih: s.tarih,
        plaka: s.plaka || veh?.plaka || '',
        sofor: s.sofor || '',
        rota : (s.kalkis || '') + ' → ' + (s.varis || ''),
        km, litre, tl, ucret, kar, marj, count, note,
      });
    });
  }
  return rows;
}

function renderVsSeferAnalizi() {
  const rows = _computeSeferYakitRows();

  // Özet kartları
  const totSefer = rows.length;
  const totKm    = rows.reduce((a, r) => a + (r.km || 0), 0);
  const totTl    = rows.reduce((a, r) => a + (r.tl || 0), 0);
  const totCiro  = rows.reduce((a, r) => a + (r.ucret || 0), 0);
  const totKar   = totCiro > 0 ? totCiro - totTl : 0;

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('sef-toplam', totSefer ? totSefer.toLocaleString('tr-TR') : '—');
  setTxt('sef-km',     totKm    ? totKm.toFixed(0).toLocaleString('tr-TR') + ' km' : '—');
  setTxt('sef-yakit',  totTl    ? '₺' + totTl.toLocaleString('tr-TR') : '—');
  setTxt('sef-kar',    totCiro  ? '₺' + totKar.toLocaleString('tr-TR') : '—');
  const karEl = document.getElementById('sef-kar');
  if (karEl) karEl.style.color = (totKar >= 0) ? 'var(--green)' : 'var(--red)';

  // Tablo
  const body = document.getElementById('vs-sefer-body');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:14px">Henüz sefer kaydı yok.</td></tr>';
    return;
  }
  const sorted = rows.slice().sort((a,b) => (b.tarih||'').localeCompare(a.tarih||''));
  body.innerHTML = sorted.map(r => {
    const karTxt  = (r.kar == null) ? '—' : '₺' + r.kar.toLocaleString('tr-TR');
    const marjTxt = (r.marj == null) ? '—' : ('%' + r.marj.toFixed(1));
    const karClr  = (r.kar == null) ? 'var(--muted)' : (r.kar >= 0 ? 'var(--green)' : 'var(--red)');
    const tlkm    = (r.km > 0 && r.tl > 0) ? '₺' + (r.tl / r.km).toFixed(2) : '—';
    const noteTag = r.note ? `<span style="font-size:9.5px;color:var(--muted);margin-left:4px;">(${r.note})</span>` : '';
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:11.5px;">${r.tarih || '—'}</td>
      <td style="font-weight:700;">${r.plaka || '—'}</td>
      <td>${r.sofor || '—'}</td>
      <td style="font-size:11.5px;">${r.rota || '—'}</td>
      <td style="font-family:var(--font-mono);">${r.km ? r.km.toFixed(0) : '—'}</td>
      <td style="font-family:var(--font-mono);">${r.litre ? r.litre.toLocaleString('tr-TR') : '—'}</td>
      <td style="font-family:var(--font-mono);color:var(--accent);">${r.tl ? '₺' + r.tl.toLocaleString('tr-TR') + noteTag : '—'}</td>
      <td style="font-family:var(--font-mono);">${tlkm}</td>
      <td style="font-family:var(--font-mono);color:var(--blue);">${r.ucret ? '₺' + r.ucret.toLocaleString('tr-TR') : '—'}</td>
      <td style="font-family:var(--font-mono);color:${karClr};font-weight:700;">${karTxt}</td>
      <td style="font-family:var(--font-mono);color:${karClr};">${marjTxt}</td>
    </tr>`;
  }).join('');
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
   BAKIM / ARIZA TAKİP SİSTEMİ
   ================================================================ */

let maintData = {}; // { vehicleId: [ {id, tarih, tur, aciklama, km, maliyet, sonraki_tarih, sonraki_km, servis} ] }
let activeMaintVehicleId = null;
let maintLoaded = false;

// ── localStorage yedek ──
function loadMaintDataLocal() {
  try { maintData = JSON.parse(localStorage.getItem('filo_bakim') || '{}'); }
  catch { maintData = {}; }
}
function saveMaintDataLocal() {
  localStorage.setItem('filo_bakim', JSON.stringify(maintData));
}

// ── Supabase: tüm bakım verilerini çek ──
async function loadMaintData() {
  loadMaintDataLocal();
  if (isLocalMode()) { maintLoaded = true; return; }
  // Auth token hazır değilse bulut isteği atma — RLS boş döner ve
  // localStorage'ı ezip yeni eklenen kayıtları kaybeder.
  if (!_authToken) { maintLoaded = true; return; }
  try {
    const res = await fetch(sbUrl('bakim_kayitlari?select=*&order=tarih.desc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const next = {};
    rows.forEach(r => {
      if (!next[r.arac_id]) next[r.arac_id] = [];
      next[r.arac_id].push({
        id            : r.id,
        tarih         : r.tarih,
        tur           : r.tur,
        aciklama      : r.aciklama || '',
        km            : r.km || null,
        maliyet       : r.maliyet || 0,
        sonraki_tarih : r.sonraki_tarih || null,
        sonraki_km    : r.sonraki_km || null,
        servis        : r.servis || ''
      });
    });
    // Güvenlik kapısı: cloud boş ama local'de veri varsa EZME
    const localAdet = Object.values(maintData || {}).reduce((a,arr)=>a+(arr?.length||0),0);
    if (rows.length === 0 && localAdet > 0) {
      console.warn('Cloud maintData boş, local (' + localAdet + ' kayıt) korunuyor.');
      maintLoaded = true;
      return;
    }
    maintData = next;
    saveMaintDataLocal();
    maintLoaded = true;
  } catch (err) {
    console.error('Bakım verisi yüklenemedi:', err);
    maintLoaded = true;
  }
}

// ── Supabase: tek kayıt ekle ──
async function saveMaintEntry(vehicleId, entry) {
  saveMaintDataLocal();
  if (isLocalMode()) return;
  const { data: { user } } = await getSB().auth.getUser();
  if (!user) return;
  try {
    const row = {
      id            : entry.id,
      user_id       : user.id,
      firma_id      : currentFirmaId, // ← firma bazlı paylaşım
      arac_id       : vehicleId,
      tarih         : entry.tarih,
      tur           : entry.tur,
      aciklama      : entry.aciklama || null,
      km            : entry.km || null,
      maliyet       : entry.maliyet || 0,
      sonraki_tarih : entry.sonraki_tarih || null,
      sonraki_km    : entry.sonraki_km || null,
      servis        : entry.servis || null
    };
    const res = await fetch(sbUrl('bakim_kayitlari'), {
      method : 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify(row)
    });
    if (!res.ok) { const t = await res.text(); throw new Error(t); }
  } catch (err) {
    console.error('Bakım Supabase kayıt hatası:', err);
    showToast('Buluta kaydedilemedi — yerel yedek alındı.', 'error');
  }
}

// ── Supabase: tek kayıt sil ──
async function deleteMaintEntryCloud(entryId) {
  saveMaintDataLocal();
  if (isLocalMode()) return;
  try {
    await fetch(sbUrl('bakim_kayitlari?id=eq.' + entryId), {
      method : 'DELETE',
      headers: sbHeaders()
    });
  } catch (err) { console.error('Bakım silme hatası:', err); }
}

// ── Modal aç ──
async function openMaintModal(vehicleId) {
  activeMaintVehicleId = vehicleId;
  const v = vehicles.find(x => x.id === vehicleId);
  document.getElementById('maint-modal-plate').textContent = v ? v.plaka : '—';

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-maint-tarih').value       = today;
  document.getElementById('f-maint-tur').value         = '';
  document.getElementById('f-maint-km').value          = '';
  document.getElementById('f-maint-maliyet').value     = '';
  document.getElementById('f-maint-sonraki').value     = '';
  document.getElementById('f-maint-sonraki-km').value  = '';
  document.getElementById('f-maint-aciklama').value    = '';
  document.getElementById('f-maint-servis').value      = '';

  document.getElementById('maint-modal-backdrop').classList.remove('hidden');
  renderMaintModal();
  await loadMaintData();
  renderMaintModal();
}

function closeMaintModal() {
  document.getElementById('maint-modal-backdrop').classList.add('hidden');
  activeMaintVehicleId = null;
}

function closeMaintModalBackdrop(e) {
  if (e.target === document.getElementById('maint-modal-backdrop')) closeMaintModal();
}

// ── Yeni kayıt ekle ──
function addMaintEntry() {
  const tarih    = document.getElementById('f-maint-tarih').value;
  const tur      = document.getElementById('f-maint-tur').value;
  const aciklama = document.getElementById('f-maint-aciklama').value.trim();
  const km       = parseFloat(document.getElementById('f-maint-km').value) || null;
  const maliyet  = parseFloat(document.getElementById('f-maint-maliyet').value) || 0;
  const sonraki_tarih = document.getElementById('f-maint-sonraki').value || null;
  const sonraki_km    = parseFloat(document.getElementById('f-maint-sonraki-km').value) || null;
  const servis   = document.getElementById('f-maint-servis').value.trim();

  if (!tarih)    { showToast('Tarih giriniz.', 'error'); return; }
  if (!tur)      { showToast('İşlem türü seçiniz.', 'error'); return; }
  if (!aciklama) { showToast('Açıklama giriniz.', 'error'); return; }

  if (!maintData[activeMaintVehicleId]) maintData[activeMaintVehicleId] = [];

  const entry = { id: uid(), tarih, tur, aciklama, km, maliyet, sonraki_tarih, sonraki_km, servis };
  maintData[activeMaintVehicleId].unshift(entry); // en yeni başa
  saveMaintDataLocal();
  saveMaintEntry(activeMaintVehicleId, entry);

  const _v = vehicles.find(x => x.id === activeMaintVehicleId);
  addActivity('bakım_ekle', _v?.plaka || '—', maintTurLabel(tur) + (aciklama ? ' · ' + aciklama.slice(0,30) : ''));
  renderMaintModal();

  // Formu temizle (tarih kalsın)
  document.getElementById('f-maint-tur').value         = '';
  document.getElementById('f-maint-km').value          = '';
  document.getElementById('f-maint-maliyet').value     = '';
  document.getElementById('f-maint-sonraki').value     = '';
  document.getElementById('f-maint-sonraki-km').value  = '';
  document.getElementById('f-maint-aciklama').value    = '';
  document.getElementById('f-maint-servis').value      = '';

  showToast('Bakım kaydı eklendi ✓', 'success');
  updateMaintStat();
}

// ── Kayıt sil ──
function deleteMaintEntry(vehicleId, entryId) {
  if (!maintData[vehicleId]) return;
  if (!confirm('Bu bakım kaydını silmek istiyor musunuz?')) return;
  const _v = vehicles.find(x => x.id === vehicleId);
  maintData[vehicleId] = maintData[vehicleId].filter(e => e.id !== entryId);
  saveMaintDataLocal();
  deleteMaintEntryCloud(entryId);
  addActivity('bakım_sil', _v?.plaka || '—', '');
  renderMaintModal();
  showToast('Kayıt silindi.', 'error');
  updateMaintStat();
}

// ── Kayıt düzenle ──
function editMaintEntry(vehicleId, entryId) {
  if (!maintData[vehicleId]) return;
  const entry = maintData[vehicleId].find(e => e.id === entryId);
  if (!entry) return;
  document.getElementById('f-maint-tarih').value       = entry.tarih || '';
  document.getElementById('f-maint-tur').value         = entry.tur   || '';
  document.getElementById('f-maint-km').value          = entry.km    || '';
  document.getElementById('f-maint-maliyet').value     = entry.maliyet || '';
  document.getElementById('f-maint-sonraki').value     = entry.sonraki_tarih || '';
  document.getElementById('f-maint-sonraki-km').value  = entry.sonraki_km   || '';
  document.getElementById('f-maint-aciklama').value    = entry.aciklama || '';
  document.getElementById('f-maint-servis').value      = entry.servis   || '';
  deleteMaintEntryCloud(entryId);
  maintData[vehicleId] = maintData[vehicleId].filter(e => e.id !== entryId);
  saveMaintDataLocal();
  const _v = vehicles.find(x => x.id === vehicleId);
  addActivity('bakım_düzenle', _v?.plaka || '—', '');
  renderMaintModal();
  showToast('Kaydı düzenleyip "+ Kayıt Ekle" butonuna basın.', 'info');
}

// ── Ana ekran Bakım/Arıza özet kartını güncelle ──
function updateMaintStat() {
  // Tüm araçların bakım kayıtlarını topla
  let toplamKayit = 0;
  let toplamAriza = 0;
  let toplamMaliyet = 0;
  let enYakinSonraki = null; // en yakın gelecek bakım tarihi
  let enYakinGecikme = null; // en yakın gecikmiş bakım

  vehicles.forEach(v => {
    const entries = maintData[v.id] || [];
    toplamKayit += entries.length;
    toplamAriza += entries.filter(e => e.tur === 'ariza').length;
    toplamMaliyet += entries.reduce((s, e) => s + (e.maliyet || 0), 0);

    // Sonraki bakım tarihleri — gelecekteki en yakın + gecikmiş
    entries.filter(e => e.sonraki_tarih).forEach(e => {
      const dl = daysLeft(e.sonraki_tarih);
      if (dl !== null) {
        if (dl < 0) {
          // Gecikmiş
          if (!enYakinGecikme || dl > enYakinGecikme.dl) enYakinGecikme = { tarih: e.sonraki_tarih, dl };
        } else {
          // Gelecekte
          if (!enYakinSonraki || dl < enYakinSonraki.dl) enYakinSonraki = { tarih: e.sonraki_tarih, dl };
        }
      }
    });
  });

  // Toplam kayıt
  const statEl = document.getElementById('stat-maint-toplam');
  if (statEl) statEl.textContent = toplamKayit.toLocaleString('tr-TR');

  // Arıza sayısı
  const arizaEl = document.getElementById('stat-maint-ariza');
  if (arizaEl) arizaEl.textContent = toplamAriza;

  // Toplam maliyet
  const maliyetEl = document.getElementById('stat-maint-maliyet');
  if (maliyetEl) maliyetEl.textContent = toplamMaliyet > 0
    ? toplamMaliyet.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺'
    : '—';

  // Sonraki bakım
  const sonrakiEl = document.getElementById('stat-maint-sonraki');
  if (sonrakiEl) {
    if (enYakinSonraki) {
      const d = enYakinSonraki.dl;
      sonrakiEl.textContent = d === 0 ? 'Bugün!' : d + ' gün';
      sonrakiEl.style.color = d <= 7 ? 'var(--red)' : d <= 30 ? 'var(--yellow)' : 'var(--purple)';
    } else if (enYakinGecikme) {
      sonrakiEl.textContent = Math.abs(enYakinGecikme.dl) + ' gün geç';
      sonrakiEl.style.color = 'var(--red)';
    } else {
      sonrakiEl.textContent = '—';
      sonrakiEl.style.color = 'var(--purple)';
    }
  }

  // Trend badge
  const trendOk  = document.getElementById('trend-maint-ok');
  const trendGec = document.getElementById('trend-maint-gecikme');
  if (trendOk && trendGec) {
    if (enYakinGecikme) {
      trendGec.style.display = '';
      trendOk.style.display  = 'none';
    } else if (toplamKayit > 0) {
      trendOk.style.display  = '';
      trendGec.style.display = 'none';
    } else {
      trendOk.style.display  = 'none';
      trendGec.style.display = 'none';
    }
  }
}

// ── Bakım özeti modalını aç (tüm araçlar) ──
function openMaintSummaryModal() {
  if (vehicles.length === 0) { showToast('Önce araç ekleyin.', 'error'); return; }
  loadMaintData();
  document.getElementById('msvs-search').value = '';
  switchMsTab('araclar');
  renderMsVehicleList();
  renderMsSummary();
  renderMsManagement();
  document.getElementById('maint-select-backdrop').classList.remove('hidden');
}

function closeMaintSelect() {
  document.getElementById('maint-select-backdrop').classList.add('hidden');
}
function closeMaintSelectBackdrop(e) {
  if (e.target === document.getElementById('maint-select-backdrop')) closeMaintSelect();
}

function switchMsTab(name) {
  ['araclar','ozet','ayarlar'].forEach(t => {
    document.getElementById('ms-tab-' + t)?.classList.toggle('active', t === name);
    document.getElementById('mspanel-' + t)?.classList.toggle('active', t === name);
  });
  if (name === 'ozet') renderMsSummary();
  if (name === 'ayarlar') renderMsManagement();
}

let msSummaryMonth = null;

function setMsSummaryMonth(m) {
  msSummaryMonth = m;
  renderMsSummary();
}

function renderMsVehicleList() {
  const q = (document.getElementById('msvs-search').value || '').toLowerCase().trim();
  const list = document.getElementById('ms-vehicle-list');
  const tipIcon = { 'Çekici':'🚛','Dorse':'🚚','Kamyon':'🚚','Kamyonet':'🛻','Minivan':'🚐','Binek Araç':'🚗' };
  const turLabel = { bakim:'Bakım', ariza:'Arıza', parca:'Parça', muayene:'Muayene', diger:'Diğer' };
  const turColor = { bakim:'var(--blue)', ariza:'var(--red)', parca:'var(--yellow)', muayene:'var(--green)', diger:'var(--muted)' };

  const filtered = vehicles.filter(v => {
    if (!q) return true;
    return (v.plaka||'').toLowerCase().includes(q) || (v.sofor||'').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="vs-empty"><div class="icon">🔍</div><p>Araç bulunamadı.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(v => {
    const entries = maintData[v.id] || [];
    const toplam  = entries.length;
    const maliyet = entries.reduce((s,e) => s+(e.maliyet||0), 0);
    const icon    = tipIcon[v.tip] || '🚗';
    // Son kayıt türü
    const sonKayit = entries.length > 0 ? entries.slice().sort((a,b)=>(b.tarih||'').localeCompare(a.tarih||''))[0] : null;
    // Sonraki yakın bakım
    const planlı  = entries.filter(e=>e.sonraki_tarih).sort((a,b)=>a.sonraki_tarih.localeCompare(b.sonraki_tarih));
    const sonraki = planlı.length>0 ? planlı[0] : null;
    const dl      = sonraki ? daysLeft(sonraki.sonraki_tarih) : null;
    const dlTxt   = dl===null ? '' : (dl<0 ? `<span style="color:var(--red);font-size:10.5px;font-weight:700">${Math.abs(dl)} gün gecikmiş ⚠</span>` : dl===0 ? `<span style="color:var(--yellow);font-size:10.5px;font-weight:700">Bugün!</span>` : `<span style="color:${dl<=30?'var(--yellow)':'var(--green)'};font-size:10.5px">${dl} gün kaldı</span>`);

    return `<button class="vs-vehicle-item blue-hover" style="border-color:${dl!==null&&dl<0?'rgba(239,68,68,.3)':'var(--border)'}" onclick="selectVehicleForMaint('${v.id}')">
      <div class="vs-vehicle-icon">${icon}</div>
      <div class="vs-vehicle-info">
        <div class="vs-vehicle-plaka" style="color:var(--blue)">${v.plaka||'—'}</div>
        <div class="vs-vehicle-meta">${v.tip||''}${v.sofor?' · '+v.sofor:''}</div>
        ${sonraki ? `<div style="margin-top:3px">${dlTxt}</div>` : ''}
      </div>
      <div class="vs-vehicle-fuel">
        <span class="vs-fuel-count" style="color:var(--blue)">${toplam>0?toplam+' kayıt':'Kayıt yok'}</span>
        ${maliyet>0 ? `<span class="vs-fuel-total" style="color:var(--green)">${maliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})} ₺</span>` : ''}
        ${sonKayit ? `<span style="font-size:10px;color:${turColor[sonKayit.tur]||'var(--muted)'}">${turLabel[sonKayit.tur]||sonKayit.tur}</span>` : ''}
      </div>
      <span class="vs-arrow" style="${dl!==null&&dl<0?'color:var(--red)':''}">›</span>
    </button>`;
  }).join('');
}

function selectVehicleForMaint(vehicleId) {
  closeMaintSelect();
  openMaintModal(vehicleId);
}

function renderMsSummary() {
  // Ay sekmeleri
  const allMonths = new Set();
  Object.values(maintData).forEach(entries => {
    entries.forEach(e => { if (e.tarih) allMonths.add(e.tarih.slice(0,7)); });
  });
  const sortedMonths = Array.from(allMonths).sort().reverse().slice(0,12);
  const tabsEl = document.getElementById('ms-month-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = `<button class="vs-month-tab ${msSummaryMonth===null?'active':''}" onclick="setMsSummaryMonth(null)">Tümü</button>` +
      sortedMonths.map(m => {
        const [y,mo] = m.split('-');
        return `<button class="vs-month-tab ${msSummaryMonth===m?'active':''}" onclick="setMsSummaryMonth('${m}')">${mo}/${y}</button>`;
      }).join('');
  }

  // İstatistik hesapla
  let totalKayit=0, totalAriza=0, totalBakim=0, totalMaliyet=0, toplamGecikme=0;
  let maliyetByVehicle = {};

  vehicles.forEach(v => {
    const entries = (maintData[v.id]||[]).filter(e => !msSummaryMonth || (e.tarih&&e.tarih.startsWith(msSummaryMonth)));
    const maliyet = entries.reduce((s,e)=>s+(e.maliyet||0),0);
    totalKayit  += entries.length;
    totalAriza  += entries.filter(e=>e.tur==='ariza').length;
    totalBakim  += entries.filter(e=>e.tur==='bakim').length;
    totalMaliyet+= maliyet;
    // Gecikmiş bakımlar (ay filtresine bakılmaksızın)
    const allEntries = maintData[v.id]||[];
    allEntries.filter(e=>e.sonraki_tarih).forEach(e=>{
      const dl=daysLeft(e.sonraki_tarih);
      if(dl!==null&&dl<0) toplamGecikme++;
    });
    if (maliyet>0) maliyetByVehicle[v.id]={plaka:v.plaka,maliyet};
  });
  // gecikme sayısını sadece bir kez say (tüm araç-entry çiftleri, filtreden bağımsız)
  // Already calculated above per-vehicle

  const set = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('ms-s-kayit',  totalKayit.toLocaleString('tr-TR'));
  set('ms-s-ariza',  totalAriza.toString());
  set('ms-s-bakim',  totalBakim.toString());
  set('ms-s-maliyet', totalMaliyet>0?totalMaliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})+' ₺':'—');
  set('ms-s-gecikme', toplamGecikme.toString());
  const gecEl = document.getElementById('ms-s-gecikme');
  if (gecEl) gecEl.style.color = toplamGecikme>0?'var(--red)':'var(--green)';

  // En yüksek maliyetli araçlar
  const topEl = document.getElementById('ms-top-vehicles');
  if (topEl) {
    const sorted = Object.entries(maliyetByVehicle).sort((a,b)=>b[1].maliyet-a[1].maliyet).slice(0,5);
    const maxM = sorted.length>0?sorted[0][1].maliyet:1;
    topEl.innerHTML = sorted.length===0
      ? `<div style="color:var(--muted);font-size:12px">Bu dönemde maliyet kaydı yok.</div>`
      : sorted.map(([,info])=>{
          const pct = Math.max(4,Math.round((info.maliyet/maxM)*100));
          return `<div class="vs-top-row">
            <div class="vs-top-plaka" style="color:var(--blue)">${info.plaka}</div>
            <div class="vs-top-bar-wrap"><div class="vs-top-bar" style="width:${pct}%;background:linear-gradient(90deg,var(--blue),#7dd3fc)"></div></div>
            <div class="vs-top-val">${info.maliyet.toLocaleString('tr-TR',{maximumFractionDigits:0})} ₺</div>
          </div>`;
        }).join('');
  }
}

function renderMsManagement() {
  const el = document.getElementById('ms-per-vehicle-delete');
  if (!el) return;
  const btns = vehicles.map(v => {
    const cnt = (maintData[v.id]||[]).length;
    if (cnt===0) return '';
    return `<button class="vs-danger-btn" style="font-size:11px;padding:5px 11px" onclick="confirmDeleteVehicleMaint('${v.id}','${v.plaka}')">
      ${v.plaka} <span style="opacity:.6;font-weight:400">(${cnt})</span>
    </button>`;
  }).join('');
  el.innerHTML = btns || '<span style="color:var(--muted);font-size:12px">Henüz bakım kaydı yok.</span>';
}

async function confirmDeleteAllMaint() {
  const total = Object.values(maintData).reduce((s,a)=>s+a.length,0);
  if (total===0) { showToast('Silinecek bakım kaydı yok.','error'); return; }
  if (!confirm(`Tüm ${total} bakım kaydı silinecek. Bu işlem geri alınamaz!\n\nDevam edilsin mi?`)) return;
  if (!isLocalMode()) {
    try { await fetch(sbUrl('bakim_girisleri?id=neq.null'),{method:'DELETE',headers:sbHeaders()}); } catch(e){console.error(e);}
  }
  maintData = {};
  saveMaintDataLocal();
  updateMaintStat();
  renderMsSummary();
  renderMsManagement();
  showToast('Tüm bakım kayıtları silindi.','error');
}

async function confirmDeleteVehicleMaint(vehicleId, plaka) {
  const cnt = (maintData[vehicleId]||[]).length;
  if (cnt===0) { showToast('Bu araçta kayıt yok.','error'); return; }
  if (!confirm(`"${plaka}" aracına ait ${cnt} bakım kaydı silinecek.\n\nDevam edilsin mi?`)) return;
  if (!isLocalMode()) {
    try { await fetch(sbUrl('bakim_girisleri?arac_id=eq.'+vehicleId),{method:'DELETE',headers:sbHeaders()}); } catch(e){console.error(e);}
  }
  delete maintData[vehicleId];
  saveMaintDataLocal();
  updateMaintStat();
  renderMsSummary();
  renderMsManagement();
  showToast(`${plaka} bakım kayıtları silindi.`,'error');
}

// ── Tür label yardımcısı ──
function maintTurLabel(tur) {
  const map = { bakim:'Periyodik Bakım', ariza:'Arıza/Onarım', parca:'Parça Değişimi', muayene:'Muayene', diger:'Diğer' };
  return map[tur] || tur;
}

// ── Modal render ──
function renderMaintModal() {
  const entries = maintData[activeMaintVehicleId] || [];

  // Özet kartlar
  const toplam = entries.length;
  const toplamMaliyet = entries.reduce((s, e) => s + (e.maliyet || 0), 0);
  const ariza = entries.filter(e => e.tur === 'ariza').length;
  const buYil = new Date().getFullYear().toString();
  const buYilMaliyet = entries.filter(e => e.tarih && e.tarih.startsWith(buYil)).reduce((s, e) => s + (e.maliyet || 0), 0);

  // Bir sonraki planlı bakım: sonraki_tarih alanı dolu olanların en yakını
  const planlılar = entries.filter(e => e.sonraki_tarih).sort((a, b) => a.sonraki_tarih.localeCompare(b.sonraki_tarih));
  const sonraki = planlılar.length > 0 ? planlılar[0] : null;

  document.getElementById('maint-stats-row').innerHTML = `
    <div class="maint-stat">
      <div class="maint-stat-val" style="color:var(--blue)">${toplam}</div>
      <div class="maint-stat-lbl">Toplam Kayıt</div>
    </div>
    <div class="maint-stat">
      <div class="maint-stat-val" style="color:var(--red)">${ariza}</div>
      <div class="maint-stat-lbl">Arıza / Onarım</div>
    </div>
    <div class="maint-stat">
      <div class="maint-stat-val" style="color:var(--green)">${toplamMaliyet > 0 ? toplamMaliyet.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' ₺' : '—'}</div>
      <div class="maint-stat-lbl">Toplam Maliyet</div>
    </div>
    <div class="maint-stat">
      <div class="maint-stat-val" style="color:var(--yellow)">${buYilMaliyet > 0 ? buYilMaliyet.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' ₺' : '—'}</div>
      <div class="maint-stat-lbl">Bu Yıl Maliyet</div>
    </div>
    <div class="maint-stat">
      <div class="maint-stat-val" style="color:var(--purple)">${sonraki ? fmtDate(sonraki.sonraki_tarih) : '—'}</div>
      <div class="maint-stat-lbl">Sonraki Bakım</div>
    </div>
  `;

  // Bir sonraki planlı bakım çubuğu
  const nextBar  = document.getElementById('maint-next-bar');
  const nextVal  = document.getElementById('maint-next-val');
  const barFill  = document.getElementById('maint-bar-fill');
  if (sonraki) {
    const dl = daysLeft(sonraki.sonraki_tarih);
    nextBar.style.display = 'block';
    const dlTxt = dl === null ? '—' : (dl < 0 ? Math.abs(dl) + ' gün geçti' : dl + ' gün kaldı');
    nextVal.textContent = fmtDate(sonraki.sonraki_tarih) + ' · ' + dlTxt;
    nextVal.style.color = dl === null ? 'var(--muted)' : (dl < 0 ? 'var(--red)' : (dl <= 30 ? 'var(--yellow)' : 'var(--green)'));
    const barCls = dl === null ? 'ok' : (dl < 0 ? 'overdue' : (dl <= 30 ? 'warn' : 'ok'));
    const pct = dl === null ? 0 : Math.min(100, Math.max(4, 100 - (dl / 90) * 100));
    barFill.style.width = pct + '%';
    barFill.className = 'maint-bar-fill ' + barCls;
  } else {
    nextBar.style.display = 'none';
  }

  // Planlı bakım takvim kartları — sonraki_tarih veya sonraki_km dolu tüm kayıtlar
  const planGrid = document.getElementById('maint-plan-grid');
  const planItems = entries.filter(e => e.sonraki_tarih || e.sonraki_km)
    .sort((a, b) => (a.sonraki_tarih || '9999').localeCompare(b.sonraki_tarih || '9999'));

  if (planItems.length === 0) {
    planGrid.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Bakım kaydı eklenirken "Sonraki Bakım Tarihi" girilirse burada görünür.</div>';
  } else {
    const turIcons = { bakim:'🔧', ariza:'🚨', parca:'🔩', muayene:'🔍', diger:'📋' };
    planGrid.innerHTML = planItems.map(e => {
      const dl = e.sonraki_tarih ? daysLeft(e.sonraki_tarih) : null;
      const cls = dl === null ? 'ok' : (dl < 0 ? 'overdue' : (dl <= 30 ? 'warn' : 'ok'));
      const dlTxt = dl === null ? '' : (dl < 0 ? Math.abs(dl) + ' gün gecikmiş' : dl === 0 ? 'Bugün!' : dl + ' gün kaldı');
      return `<div class="maint-plan-card ${cls}">
        <div class="maint-plan-card-icon">${turIcons[e.tur] || '📋'}</div>
        <div class="maint-plan-card-name">${maintTurLabel(e.tur)}</div>
        ${e.aciklama ? `<div style="font-size:11.5px;color:var(--text2);margin-bottom:6px;white-space:normal">${e.aciklama.slice(0,50)}</div>` : ''}
        ${e.sonraki_tarih ? `<div class="maint-plan-card-due">${fmtDate(e.sonraki_tarih)}</div>` : ''}
        ${e.sonraki_km ? `<div style="font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-bottom:4px">${e.sonraki_km.toLocaleString('tr-TR')} km'de</div>` : ''}
        <div class="maint-plan-card-days">${dlTxt}</div>
      </div>`;
    }).join('');
  }

  // Geçmiş tablosu
  const countEl = document.getElementById('maint-entry-count');
  if (countEl) countEl.textContent = toplam + ' kayıt';

  const tbody = document.getElementById('maint-history-body');
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="maint-empty"><div class="icon">🔧</div><p>Henüz bakım kaydı yok. Yukarıdan ekleyin.</p></div></td></tr>`;
    return;
  }

  const turBadge = (tur) => {
    const labels = { bakim:'Periyodik Bakım', ariza:'Arıza/Onarım', parca:'Parça Değişimi', muayene:'Muayene', diger:'Diğer' };
    return `<span class="maint-type-badge ${tur}">${labels[tur] || tur}</span>`;
  };

  const vid = activeMaintVehicleId;
  tbody.innerHTML = entries.map(e => `
    <tr>
      <td class="mono">${fmtDate(e.tarih)}</td>
      <td>${turBadge(e.tur)}</td>
      <td style="max-width:220px;white-space:normal;font-size:12.5px;color:var(--text)">${e.aciklama || '—'}</td>
      <td class="mono" style="color:var(--text2)">${e.km ? e.km.toLocaleString('tr-TR') + ' km' : '—'}</td>
      <td class="mono" style="color:var(--green)">${e.maliyet > 0 ? e.maliyet.toLocaleString('tr-TR', {maximumFractionDigits:0}) + ' ₺' : '—'}</td>
      <td class="mono" style="color:var(--blue)">${e.sonraki_tarih ? fmtDate(e.sonraki_tarih) : '—'}</td>
      <td class="mono" style="color:var(--muted)">${e.sonraki_km ? e.sonraki_km.toLocaleString('tr-TR') + ' km' : '—'}</td>
      <td style="color:var(--muted);font-size:12px">${e.servis || '—'}</td>
      <td class="col-islem">
        <div style="display:flex;gap:5px;align-items:center">
          <button class="maint-del-btn" style="color:var(--blue);font-size:14px;width:26px;height:26px;border-radius:6px;border:1px solid rgba(56,189,248,.25);background:rgba(56,189,248,.06);display:flex;align-items:center;justify-content:center" onclick="editMaintEntry('${vid}','${e.id}')" title="Düzenle">✎</button>
          <button class="maint-del-btn" style="font-size:14px;width:26px;height:26px;border-radius:6px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.06);display:flex;align-items:center;justify-content:center" onclick="deleteMaintEntry('${vid}','${e.id}')" title="Sil">✕</button>
        </div>
      </td>
    </tr>`).join('');
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

    // REFACTOR 2026-04-22: Önce v_surucu_dosyasi view'ını dene (tek kaynaklı).
    //   View yoksa eski surucu_belgeler + araclar birleşimine fallback.
    let belgeRows = null;
    let viewOk = false;
    try {
      const { data: vdata, error: verr } = await sb
        .from('v_surucu_dosyasi')
        .select('*')
        .eq('firma_id', currentFirmaId)
        .order('ad', { ascending: true });
      if (!verr && Array.isArray(vdata)) {
        viewOk = true;
        belgeRows = vdata.map(r => {
          // belgeler jsonb array; her belge türünü ayrı alan olarak expose et
          const byTur = {};
          (r.belgeler || []).forEach(b => { byTur[b.tur] = b; });
          return {
            id       : r.surucu_id,
            surucu_id: r.surucu_id,
            auth_user_id: r.auth_user_id,
            ad       : r.ad,
            tel      : r.telefon_e164 || '',
            plaka    : r.arac_id || '',
            ehliyet  : byTur.ehliyet?.bitis  || '',
            src      : byTur.src?.bitis      || '',
            psiko    : byTur.psiko?.bitis    || '',
            takograf : byTur.takograf?.bitis || '',
            saglik   : byTur.saglik?.bitis   || '',
            ehliyet_no    : byTur.ehliyet?.belge_no || '',
            ehliyet_sinifi: byTur.ehliyet?.sinif    || '',
            belgeler : r.belgeler || [],
            _kaynak  : 'view'
          };
        });
      }
    } catch (_) { /* view yok → fallback */ }

    if (!viewOk) {
      // LEGACY FALLBACK: surucu_belgeler tablosundan kayıtları çek
      const { data: rows, error } = await sb
        .from('surucu_belgeler')
        .select('*')
        .order('ad', { ascending: true });

      if (error) {
        console.error('Sürücü yükle Supabase hatası:', error.code, error.message, error.details);
      }

      belgeRows = (rows || []).map(r => ({
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
    }

    // REFACTOR 2026-04-22: View aktifse araclar fallback mantığını atla — view kapsar.
    let aracKaynakliUniq = [];
    if (!viewOk) {
      // LEGACY PATH: araclar.sofor text alanından dedup'lu sürücü türet
      let aracList = vehicles.length > 0 ? vehicles : [];
      if (aracList.length === 0) {
        const { data: aracRows } = await sb.from('araclar').select('id,plaka,sofor,telefon');
        aracList = (aracRows || []).map(r => ({ id: r.id, plaka: r.plaka, sofor: r.sofor, telefon: r.telefon }));
      }

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
          _kaynak : 'arac'
        }));

      const seen = new Set();
      aracKaynakli.forEach(d => {
        const key = (d.ad||'').toLowerCase().trim() + '|' + (d.tel||'').trim();
        if (!seen.has(key)) { seen.add(key); aracKaynakliUniq.push(d); }
      });
    }

    driverData = [...belgeRows, ...aracKaynakliUniq]
      .sort((a, b) => (a.ad||'').localeCompare(b.ad||'', 'tr'));

    console.log('Sürücü verisi [' + (viewOk ? 'view' : 'legacy') + ']:',
                belgeRows.length, 'sürücü +', aracKaynakliUniq.length, 'araçtan =',
                driverData.length, 'toplam');
    saveDriverDataLocal();
    driverLoaded = true;
  } catch (err) {
    console.error('Sürücü verisi yüklenemedi:', err);
    driverLoaded = true;
  }
}

// ── Supabase: kaydet (upsert) ──
// REFACTOR 2026-04-22: Yeni şema varsa suruculer + surucu_belgeleri'ne böl,
//   yoksa eski surucu_belgeler tablosuna upsert (fallback).
async function saveDriverEntryCloud(entry) {
  saveDriverDataLocal();
  if (isLocalMode()) return;
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // Yeni yapıya yaz (suruculer tablosu varsa)
    let useNew = false;
    if (entry.surucu_id) {
      useNew = true;
    } else {
      // Var mı kontrolü: suruculer tablosu mevcut mu? Boş select ile probe et.
      try {
        const { error: probeErr } = await sb.from('suruculer').select('id').limit(0);
        useNew = !probeErr;
      } catch (_) { useNew = false; }
    }

    if (useNew) {
      // 1) Kişi kaydı: mevcutsa update, yoksa upsert
      const telE164 = _telNormalize(entry.tel);
      let surucuId = entry.surucu_id;
      if (!surucuId && telE164) {
        const { data: found } = await sb.from('suruculer').select('id')
          .eq('firma_id', currentFirmaId)
          .eq('telefon_e164', telE164).maybeSingle();
        surucuId = found?.id || null;
      }
      if (surucuId) {
        await sb.from('suruculer').update({
          ad           : entry.ad,
          telefon_e164 : telE164,
          telefon_raw  : entry.tel || null,
        }).eq('id', surucuId);
      } else {
        const ins = await sb.from('suruculer').insert({
          firma_id     : currentFirmaId,
          ad           : entry.ad,
          telefon_e164 : telE164,
          telefon_raw  : entry.tel || null,
          durum        : 'pasif',
          created_by   : user.id
        }).select('id').single();
        surucuId = ins.data?.id;
      }

      // 2) Belgeler: her türü ayrı satır olarak upsert
      const belgeler = [
        ['ehliyet', entry.ehliyet, entry.ehliyet_sinifi, entry.ehliyet_no],
        ['src',     entry.src,     null, null],
        ['psiko',   entry.psiko,   null, null],
        ['takograf',entry.takograf,null, null],
        ['saglik',  entry.saglik,  null, null],
      ].filter(([,bitis,,no]) => bitis || no);

      for (const [tur, bitis, sinif, no] of belgeler) {
        await sb.from('surucu_belgeleri').upsert({
          surucu_id    : surucuId,
          firma_id     : currentFirmaId,
          belge_turu   : tur,
          bitis_tarihi : bitis || null,
          sinif        : sinif || null,
          belge_no     : no || null,
          onay_durumu  : 'onayli',
          kaynak       : 'ofis',
          updated_by   : user.id
        }, { onConflict: 'surucu_id,belge_turu' });
      }

      // 3) Araç ataması değiştiyse
      if (entry.plaka) {
        const { error: ataErr } = await sb.rpc('arac_sofor_ata', {
          p_arac_id  : entry.plaka,
          p_surucu_id: surucuId
        });
        if (ataErr) console.warn('Araç atama uyarısı:', ataErr.message);
      }
      return;
    }

    // LEGACY: eski tek-satır upsert (migration öncesi)
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

// REFACTOR 2026-04-22: Araç seçicileri merkezi helper'dan besle.
//   v_arac_secim view yüklendiyse gosterim_adi (örn. "34FSB145 — Cihan Özcan")
//   ve bos_mu bayrağı hazır gelir; yoksa vehicles objesi üzerinde hesaplanır.
function _aracSecimOption(v, opts) {
  const selectedId = opts && opts.selectedId;
  const label = v.gosterim_adi || (v.plaka + (v.sofor ? ' — ' + v.sofor : ' (boş)'));
  const sel = (selectedId != null && v.id === selectedId) ? ' selected' : '';
  return `<option value="${v.id}"${sel} data-bos="${v.bos_mu ? 1 : 0}">${label}</option>`;
}
function _filteredVehicles(filter) {
  // filter: { onlyEmpty?: bool, durum?: 'Aktif' }
  let list = vehicles;
  if (filter && filter.onlyEmpty) list = list.filter(v => v.bos_mu);
  if (filter && filter.durum)    list = list.filter(v => (v.durum || 'Aktif') === filter.durum);
  return list;
}

function _fillDriverPlacaSelect(selectedId) {
  const sel = document.getElementById('f-driver-plaka');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Araç Seçin —</option>' +
    _filteredVehicles().map(v => _aracSecimOption(v, { selectedId })).join('');
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
  ['suruculer','ozet','davet','onay','ayarlar'].forEach(t => {
    document.getElementById('ds-tab-' + t)?.classList.toggle('active', t === name);
    document.getElementById('dspanel-' + t)?.classList.toggle('active', t === name);
  });
  if (name === 'ozet')     renderDsSummary();
  if (name === 'ayarlar')  _fillDriverPlacaSelect();
  if (name === 'davet') {
    _fillDavetAracSelect();
    soforDavetlerYukle();
  }
  if (name === 'onay') onayKuyruguYukle();
}

// REFACTOR 2026-04-22: Belge onay kuyruğu — surucu_belge_onaylari tablosu
async function onayKuyruguYukle() {
  const host = document.getElementById('onay-liste');
  if (!host) return;
  if (isLocalMode() || !_authToken) {
    host.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px">Buluta bağlı değilsiniz.</div>';
    return;
  }
  host.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px">Yükleniyor…</div>';
  try {
    const sb = getSB();
    const { data, error } = await sb.from('surucu_belge_onaylari')
      .select('id, talep_tipi, eski_veri, yeni_veri, talep_zamani, karar, belge_id, surucu:suruculer(ad, telefon_e164)')
      .is('karar', null)
      .eq('firma_id', currentFirmaId)
      .order('talep_zamani', { ascending: false });

    if (error) {
      // Tablo yoksa (migration öncesi) kullanıcıyı bilgilendir
      if (/relation|does not exist|42P01/i.test(error.message || error.code || '')) {
        host.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px">Onay kuyruğu sistem güncellemesi bekleniyor.<br>(Migration henüz deploy edilmedi)</div>';
        return;
      }
      throw error;
    }

    const badge = document.getElementById('ds-onay-badge');
    if (badge) {
      badge.textContent = String((data || []).length);
      badge.style.display = (data || []).length > 0 ? '' : 'none';
    }

    if (!data || data.length === 0) {
      host.innerHTML = '<div style="text-align:center;color:var(--muted);padding:26px;font-size:12px">✓ Bekleyen onay yok.</div>';
      return;
    }

    host.innerHTML = data.map(o => _onayKartiHtml(o)).join('');
  } catch (err) {
    console.error('Onay kuyruğu hatası:', err);
    host.innerHTML = '<div style="text-align:center;color:#ef4444;padding:18px;font-size:12px">Yüklenemedi: ' + (err.message||'hata') + '</div>';
  }
}

function _onayKartiHtml(o) {
  const ad  = o.surucu?.ad || '—';
  const tel = o.surucu?.telefon_e164 || '';
  const eski = o.eski_veri || {};
  const yeni = o.yeni_veri || {};
  const zaman = o.talep_zamani ? new Date(o.talep_zamani).toLocaleString('tr-TR') : '—';
  const tur = yeni.belge_turu || '—';

  // diff için anahtarlar: bitis_tarihi, belge_no, sinif, veren_kurum
  const alanlar = ['belge_turu','belge_no','sinif','veren_kurum','verilis_tarihi','bitis_tarihi','dosya_url'];
  const rows = alanlar.map(k => {
    const e = eski[k] ?? '';
    const y = yeni[k] ?? '';
    if (e === y) return '';
    return `<div style="display:flex;gap:8px;font-size:11px;padding:3px 0;border-bottom:1px dashed var(--border2)">
      <span style="min-width:100px;color:var(--muted)">${k}</span>
      <span style="color:#94a3b8;text-decoration:line-through;flex:1">${e || '—'}</span>
      <span style="color:#22c55e;font-weight:600;flex:1">${y || '—'}</span>
    </div>`;
  }).join('') || '<div style="font-size:11px;color:var(--muted);padding:4px 0">(değişiklik tespit edilemedi)</div>';

  return `
  <div style="border:1px solid var(--border2);border-radius:12px;padding:12px;background:var(--card)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div>
        <div style="font-weight:700;font-size:13px">${ad} <span style="color:var(--muted);font-weight:500">· ${tel}</span></div>
        <div style="font-size:11px;color:var(--muted)">${o.talep_tipi === 'ekleme' ? '+ Yeni Belge' : '✎ Güncelleme'} · ${tur} · ${zaman}</div>
      </div>
    </div>
    ${rows}
    <div style="display:flex;gap:8px;margin-top:10px">
      <button onclick="onayKarar(${o.id}, 'onayli')" style="flex:1;background:linear-gradient(135deg,#10b981,#22c55e);border:none;color:#fff;border-radius:8px;padding:8px;font-size:12px;font-weight:600;cursor:pointer">✓ Onayla</button>
      <button onclick="onayKarar(${o.id}, 'reddedildi')" style="flex:1;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);color:#ef4444;border-radius:8px;padding:8px;font-size:12px;font-weight:600;cursor:pointer">✗ Reddet</button>
    </div>
  </div>`;
}

async function onayKarar(onayId, karar) {
  let not = null;
  if (karar === 'reddedildi') {
    not = prompt('Red nedeni (şoför görecek):', '');
    if (not === null) return; // iptal
  }
  try {
    const sb = getSB();
    const { error } = await sb.rpc('surucu_belge_onayla', {
      p_onay_id: onayId, p_karar: karar, p_not: not
    });
    if (error) throw error;
    showToast(karar === 'onayli' ? 'Onaylandı ✓' : 'Reddedildi', karar === 'onayli' ? 'success' : 'info');
    onayKuyruguYukle();
  } catch (err) {
    console.error(err);
    showToast('Karar kaydedilemedi: ' + (err.message||'hata'), 'error');
  }
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

/* ================================================================
   ŞOFÖR DAVET AKIŞI — operasyoncu/yönetici tarafı
   ================================================================ */

// Son oluşturulan davetin bilgileri (kopyala + whatsapp için)
let _sonDavet = null;

// Araç listesini davet formundaki select'e doldur
function _fillDavetAracSelect() {
  const sel = document.getElementById('f-davet-arac');
  if (!sel) return;
  // Davette sadece boş araç filtresi var mı?
  const onlyEmpty = !!document.getElementById('f-davet-sadece-bos')?.checked;
  sel.innerHTML = '<option value="">— Sabit araç yok (sefer bazlı) —</option>' +
    _filteredVehicles({ onlyEmpty }).map(v => _aracSecimOption(v)).join('');
}

// Davet kodu oluştur — RPC çağırır
// REFACTOR 2026-04-22: Telefon normalizasyon yardımcısı (frontend tarafı)
//   Migration'daki fn_normalize_tel ile aynı kuralı uygular. TR default +90.
function _telNormalize(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10)                             return '+90' + d;
  if (d.length === 11 && d.startsWith('0'))        return '+90' + d.substring(1);
  if (d.length === 12 && d.startsWith('90'))       return '+'   + d;
  if (String(raw).startsWith('+'))                 return '+'   + d;
  return '+' + d;
}

// REFACTOR 2026-04-22: Telefon alanı blur'unda mevcut sürücüyü ara.
//   Eşleşme varsa ad alanı otomatik dolar ve "mevcut sürücü" rozeti çıkar.
//   suruculer tablosu yoksa (migration deploy öncesi) sessizce vazgeçer.
async function soforDavetTelLookup(rawTel) {
  const hint = document.getElementById('f-davet-tel-hint');
  const adInp = document.getElementById('f-davet-ad');
  if (!hint || !adInp) return;
  hint.style.display = 'none';
  hint.textContent = '';
  const tel = _telNormalize(rawTel);
  if (!tel || isLocalMode() || !_authToken) return;
  try {
    const sb = getSB();
    // Yeni şema: suruculer tablosundan telefonla ara
    const { data, error } = await sb.from('suruculer')
      .select('id, ad, durum, telefon_e164')
      .eq('firma_id', currentFirmaId)
      .eq('telefon_e164', tel)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') return; // tablo yok → sessiz fallback
    if (data) {
      if (!adInp.value.trim()) adInp.value = data.ad || '';
      hint.style.color = '#22c55e';
      hint.textContent = '✓ Mevcut sürücü bulundu: ' + (data.ad || '—')
        + ' · ' + (data.durum === 'aktif' ? 'Aktif' : 'Davet bekliyor');
      hint.style.display = '';
    } else {
      hint.style.color = '#818cf8';
      hint.textContent = 'ℹ Bu telefon sisteme yeni kaydedilecek.';
      hint.style.display = '';
    }
  } catch (_) { /* sessiz */ }
}

async function soforDavetOlustur() {
  const ad    = (document.getElementById('f-davet-ad').value   || '').trim();
  const tel   = (document.getElementById('f-davet-tel').value  || '').trim();
  const arac  = document.getElementById('f-davet-arac').value || '';
  const not   = (document.getElementById('f-davet-not').value  || '').trim();

  if (!ad)  { showToast('Ad Soyad zorunludur.', 'error'); return; }
  if (!tel) { showToast('Telefon numarası zorunludur.', 'error'); return; }

  // Basit telefon temizle (sadece rakam)
  const telDigits = tel.replace(/\D/g, '');
  if (telDigits.length < 10) {
    showToast('Geçerli bir telefon numarası girin (en az 10 hane).', 'error');
    return;
  }

  if (isLocalMode() || !_authToken) {
    showToast('Davet oluşturmak için buluta bağlı olmanız gerekir.', 'error');
    return;
  }

  try {
    const sb = getSB();
    // REFACTOR 2026-04-22: Önce v2 RPC'yi dene (telefon-first dedup).
    //   v2 yoksa (migration deploy öncesi) v1'e fallback.
    let data, error;
    ({ data, error } = await sb.rpc('sofor_davet_olustur_v2', {
      p_firma_id: currentFirmaId,
      p_ad      : ad,
      p_telefon : tel,
      p_arac_id : arac || null,
      p_not     : not  || null
    }));
    if (error && /function.*does not exist|42883/i.test(error.message || error.code || '')) {
      // v1 fallback
      ({ data, error } = await sb.rpc('sofor_davet_olustur', {
        p_ad      : ad,
        p_telefon : tel,
        p_arac_id : arac || null,
        p_not     : not  || null
      }));
    }
    if (error) throw error;

    // RPC surucu_davetleri satırını tam döndürür (v1) veya {davet_kodu, surucu_id, yeni_sofor} (v2)
    const rec = Array.isArray(data) ? data[0] : data;
    if (!rec || !rec.davet_kodu) throw new Error('Davet kodu üretilemedi.');

    // v2 ise yeni/mevcut ayrımını kullanıcıya bildir
    if (rec.yeni_sofor === false) {
      showToast('Mevcut sürücü kaydı kullanıldı ✓', 'info');
    }

    _sonDavet = {
      kod      : rec.davet_kodu,
      ad       : rec.ad || ad,
      telefon  : rec.telefon || tel,
      expires  : rec.expires_at || null,
      arac_id  : rec.arac_id || arac || null
    };

    // Sonuç kartını göster
    document.getElementById('davet-sonuc-kart').style.display  = '';
    document.getElementById('davet-sonuc-kod').textContent     = rec.davet_kodu;
    const expTxt = rec.expires_at ? new Date(rec.expires_at).toLocaleString('tr-TR') : '—';
    document.getElementById('davet-sonuc-bilgi').innerHTML =
      `<b>${rec.ad || ad}</b> · ${rec.telefon || tel}<br>Geçerlilik bitişi: <b>${expTxt}</b>`;

    // Formu temizle
    document.getElementById('f-davet-ad').value   = '';
    document.getElementById('f-davet-tel').value  = '';
    document.getElementById('f-davet-not').value  = '';
    document.getElementById('f-davet-arac').value = '';

    showToast('Davet kodu oluşturuldu ✓', 'success');
    // Listeyi tazele
    soforDavetlerYukle();
  } catch (err) {
    console.error('Davet oluşturma hatası:', err);
    const mesaj = (err?.message || '').toLowerCase();
    if (mesaj.includes('yetki') || mesaj.includes('permission')) {
      showToast('Bu işlem için yetkiniz yok.', 'error');
    } else if (mesaj.includes('telefon')) {
      showToast('Geçersiz telefon numarası.', 'error');
    } else {
      showToast('Davet oluşturulamadı: ' + (err?.message || 'bilinmeyen hata'), 'error');
    }
  }
}

// Son oluşturulan davet kodunu panoya kopyala
async function soforDavetKoduKopyala() {
  if (!_sonDavet) return;
  try {
    await navigator.clipboard.writeText(_sonDavet.kod);
    showToast('Kod panoya kopyalandı ✓', 'success');
  } catch (e) {
    // Fallback: geçici input
    const ta = document.createElement('textarea');
    ta.value = _sonDavet.kod;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Kod kopyalandı ✓', 'success');
  }
}

// WhatsApp üzerinden davet mesajı gönder
function soforDavetWhatsApp() {
  if (!_sonDavet) return;
  const kod = _sonDavet.kod;
  const ad  = _sonDavet.ad;
  const tel = _sonDavet.telefon;

  // Davet linki — şoför portalı app.html#/sofor olarak açacak
  const portalUrl = location.origin + location.pathname + '#/sofor?kod=' + encodeURIComponent(kod);

  const mesaj = [
    `Merhaba ${ad},`,
    ``,
    `Fleetly Şoför Portalı'na davet edildiniz 🚛`,
    ``,
    `📱 Davet Kodunuz: *${kod}*`,
    `📞 Kayıtlı Telefon: ${tel}`,
    ``,
    `Aşağıdaki bağlantıya tıklayın ve kodu girin:`,
    portalUrl,
    ``,
    `Bu kod 48 saat içinde kullanılmalıdır.`,
    ``,
    `_Fleetly - Filo Yönetim Sistemi_`
  ].join('\n');

  // Türkiye normalize
  let waNum = tel.replace(/\D/g, '');
  if (waNum.startsWith('0'))        waNum = '90' + waNum.slice(1);
  else if (!waNum.startsWith('90')) waNum = '90' + waNum;

  const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(mesaj)}`;
  window.open(waUrl, '_blank');
  showToast('WhatsApp açılıyor…');
}

// Davet listesini Supabase'ten yükle
async function soforDavetlerYukle() {
  const list = document.getElementById('davet-liste');
  if (!list) return;

  if (isLocalMode() || !_authToken) {
    list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px">Buluta bağlı değil.</div>';
    return;
  }

  list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px">Yükleniyor…</div>';

  try {
    const sb = getSB();
    const { data, error } = await sb
      .from('surucu_davetleri')
      .select('id, ad, telefon, davet_kodu, arac_id, expires_at, kullanildi_at, kullanan_user_id, iptal_mi, notlar, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    if (!data || data.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px">Henüz davet yok.</div>';
      return;
    }

    const now = Date.now();
    list.innerHTML = data.map(d => {
      const expMs = d.expires_at ? new Date(d.expires_at).getTime() : 0;
      let durumTxt, durumColor;
      if (d.iptal_mi) { durumTxt = '🚫 İptal Edildi'; durumColor = 'var(--muted)'; }
      else if (d.kullanildi_at) { durumTxt = '✅ Kullanıldı'; durumColor = '#22c55e'; }
      else if (expMs && expMs < now) { durumTxt = '⏰ Süresi Doldu'; durumColor = 'var(--muted)'; }
      else { durumTxt = '🕐 Bekliyor'; durumColor = '#f59e0b'; }

      const aktif = !d.iptal_mi && !d.kullanildi_at && expMs > now;
      const plaka = d.arac_id ? (vehicles.find(v => v.id === d.arac_id)?.plaka || d.arac_id) : null;
      const createdTxt = d.created_at ? new Date(d.created_at).toLocaleString('tr-TR') : '';
      const expTxt     = d.expires_at ? new Date(d.expires_at).toLocaleString('tr-TR') : '—';

      // Telefon maskele: son 4 hane görünür
      const tel = d.telefon || '';
      const telMask = tel.length >= 4 ? '****' + tel.slice(-4) : tel;

      return `
        <div style="border:1px solid var(--border2);border-radius:10px;padding:10px 12px;background:var(--card);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
              <span style="font-weight:700;color:var(--text)">${d.ad}</span>
              <span style="font-size:11px;color:var(--muted)">· ${telMask}</span>
              ${plaka ? `<span style="font-size:11px;background:rgba(56,189,248,.12);color:#38bdf8;padding:2px 6px;border-radius:4px;font-weight:600">${plaka}</span>` : ''}
            </div>
            <div style="display:flex;gap:10px;align-items:center;margin-top:4px;flex-wrap:wrap">
              <span style="font-family:monospace;font-size:13px;font-weight:700;letter-spacing:1.5px;color:#818cf8">${d.davet_kodu}</span>
              <span style="font-size:10.5px;color:${durumColor};font-weight:700">${durumTxt}</span>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:3px">
              Oluşturuldu: ${createdTxt}${aktif ? ' · Bitiş: ' + expTxt : ''}
              ${d.notlar ? ' · <i>' + d.notlar + '</i>' : ''}
            </div>
          </div>
          ${aktif ? `
            <div style="display:flex;gap:6px">
              <button onclick="soforDavetTekrarPaylas(${d.id})" title="Tekrar paylaş" style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35);color:#22c55e;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">💬</button>
              <button onclick="soforDavetIptal(${d.id})" title="Daveti iptal et" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#ef4444;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">🚫</button>
            </div>
          ` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Davet listesi yüklenemedi:', err);
    list.innerHTML = '<div style="text-align:center;color:var(--red);padding:18px;font-size:12px">Liste yüklenemedi: ' + (err?.message || 'hata') + '</div>';
  }
}

// Tekrar WhatsApp paylaş (listeden)
async function soforDavetTekrarPaylas(davetId) {
  try {
    const sb = getSB();
    const { data, error } = await sb
      .from('surucu_davetleri')
      .select('ad, telefon, davet_kodu, expires_at, arac_id')
      .eq('id', davetId)
      .single();
    if (error) throw error;
    _sonDavet = {
      kod     : data.davet_kodu,
      ad      : data.ad,
      telefon : data.telefon,
      expires : data.expires_at,
      arac_id : data.arac_id
    };
    soforDavetWhatsApp();
  } catch (err) {
    showToast('Davet bilgisi alınamadı.', 'error');
  }
}

// Daveti iptal et (soft delete)
async function soforDavetIptal(davetId) {
  if (!confirm('Bu daveti iptal etmek istediğinize emin misiniz?')) return;
  try {
    const sb = getSB();
    const { error } = await sb
      .from('surucu_davetleri')
      .update({ iptal_mi: true })
      .eq('id', davetId);
    if (error) throw error;
    showToast('Davet iptal edildi.', 'success');
    soforDavetlerYukle();
  } catch (err) {
    console.error('Davet iptal hatası:', err);
    showToast('İptal edilemedi: ' + (err?.message || 'hata'), 'error');
  }
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


/* ================================================================
   ORTAK PDF YARDIMCILARI
   ================================================================ */
const LOGO_B64_SHARED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAFHUlEQVR4nO3dTW7UQBAF4JyCq3EQ7sARsuAC3IAtWbOBJZtssgCBhFCEkCCZmeD2zBgnmfFP13vdVdXVUolNZE/6ozztKrdzcUEaf1+9eIhYHiwH8ag9Md4jUBuKgG0kAreBCNwGImAbicBtIALYeQRuAxG4DUTgNhAB7DwCt4EIYOcRwM4jcBuIAHYeAew8Ath5BLDzCODM2N58fNjdfuv/rf1ZZoFrfwiLsdtu9vHnd/XPMotc+wNYix52t9vH/Z34eGkEMCjGIxv4iNvF5upS/DmejgAG4OZOZsrY/8BbOC4DuQlg1ESOszctshi4aOQAXorbLajGwExcJLJ7YNQEPsrejNVzABcGXoXbXY4l2RvAinF74G5BNQB3t0klcFHIAbwIWJa9uciIOXALjMPdim+NAlg1sDx7A1gr7rgsKcjeHGTUXLgDRk7aOHtRnaOSuE0Br8Z9VJaUXZ7Hsfn8vhiuO2BW9iLbgpufX/bRQR8/M3NOmgBejSssS57F/fB2j/v9uticuAGmZS+g5zsAd7CbXz+G7A1gAPDa4/SP4xCy9+7Nyz1ul8El58UFMHLBIi1Lnos+e9Pl+eZTANcFxmdvD3xYXJWeG/PAtOwFFDYG3C5ra2RvAD8D9pW95oGhuOCy5ICbsjctrgreGgXwKWBCWbIHrpi9poGhuMSyZJ+9Fb57TQNPjSxgVlnycGt0/+51ACOAs3BZZcmUvYXLki6AqdmLLEsevntrZq8r4JxjscqSNZoKLoDx2UssSxZuKrgGzj0eI3vTJblGU8E8MB6XVJas1FQI4GfA/sqSZoHhuMyypKLsbRdYuA30LLCy7DUBDMdlFTaOTQVF2aseeGpkA5PLkrXnzAVwNi5gG+hJXAVNBXPAnOwd3RoRypLpwbra82YeOBvh6tJ1U8EUMCV7x7dGyLKkkqaCC2DJMWlNhYqP45gEpuCysvfYVOiga89b28CAt9M9DW1NBRPAFFzA2+lOxdBUUNASbBu4obKkamAKLrMsaSB71QBPDREwcxO34pWzGWARLqssqbSpoBaYl73cbaC15808sPS41LKkkeytDlwke5G3RkZWzuqBpcdtsamgDpiGy3reKuF2iyutTYV2gAnbQC00FVQB03BZ20ANNBXaACYUNvqmgsHFVTVgGi6rLGmkqeAfmLANtH95meHsLQ7MwqVtAz2WJY1mb1HgqSE9Nq0safC+Vx0w4tjRVKgMXCx7Gy9LFgXe3X6dBYach9nQN569UOAEeiqo2cssSzrIXgjwOdg5YMh/KkZZ8pi9xhdXEOBc3PHlO/vcrLKk0aYCHHgOdw5YiswoSw67BJ1kLxV4DlcCTC9LGmwqQIER2StBZpQlrTcVigIvxc0BppUljTcVigFPDQQwoyw5ZK+j797iwOd+fj1wNBWowMjL81rkKEsWAJ5DZuHugYmP4zgoS54ETgMJ/BR57mcXnzPKknm4DOA1sfichG2gnpoKpoFphQ3H2SsCRiEvPhejLOmsqWAWmLYN9NBU0PjyMhXAUuTF5yC8nc5jU2ESuDTyYgjW2+kcNhUmcSXAa6BXH3Pc8wWVJYddgo4XVxTgU+DiY6TVc7r/ZfyhZodlyUlgBrI0+s5Rt8hCPY7juakwi6sRGB2a/p5RFWDvyBZePUjF9YzsvamwGNcrsveV8ypcb8D94irdHjn+7l0N7A25iZJk7qj9C0SQYANZb0BxA1lXUHADun7QYQO7EdQlo/bEWAuWwz+aKJThdQXEYAAAAABJRU5ErkJggg==';

function _pdfSave(doc, filename) {
  try {
    doc.save(filename);
  } catch(e) {
    var blob = doc.output('blob');
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }
}

function _pdfCommonSetup(title, subtitle, accentColor) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, ML = 14, MR = 14, CW = PW - ML - MR;

  function tr(s) {
    if (!s) return '';
    return String(s)
      .replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C').replace(/ı/g,'i').replace(/İ/g,'I')
      .replace(/â/g,'a').replace(/Â/g,'A').replace(/î/g,'i');
  }

  const C = {
    bg:[8,12,16], surface:[17,24,32], surface2:[24,32,44], border:[37,47,62],
    accent: accentColor,
    text:[226,234,243], text2:[168,184,204], muted:[82,96,112],
    green:[34,197,94], yellow:[245,158,11], red:[239,68,68],
    blue:[56,189,248], orange:[249,115,22], purple:[167,139,250], white:[255,255,255],
  };

  const setFill = c => doc.setFillColor(...c);
  const setTxt  = c => doc.setTextColor(...c);
  const rect    = (x,y,w,h,s='F') => doc.rect(x,y,w,h,s);
  const rRect   = (x,y,w,h,r,s='F') => doc.roundedRect(x,y,w,h,r,r,s);

  let pageNum = 1;
  function addFooter() {
    setTxt(C.muted); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(tr('Filo Takip Sistemi - ') + tr(title), ML, PH-8);
    doc.text(tr('Sayfa ') + pageNum, PW-MR, PH-8, {align:'right'});
    doc.text(new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'}), PW/2, PH-8, {align:'center'});
    setTxt([50,62,78]); doc.setFontSize(6);
    doc.text('created by cihanozcan app.', PW/2, PH-3, {align:'center'});
  }
  function newPage() {
    addFooter(); doc.addPage(); pageNum++;
    setFill(C.bg); rect(0,0,PW,PH);
  }

  // Arka plan
  setFill(C.bg); rect(0,0,PW,PH);

  // Header bandı
  setFill(C.surface); rect(0,0,PW,44);
  setFill(C.accent);  rect(0,0,4,44);
  setTxt(C.white); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text(tr(title), ML+8, 20);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); setTxt(C.text2);
  doc.text(tr(subtitle), ML+8, 29);
  const dateStr = new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'long',year:'numeric'});
  setFill(C.surface2); rRect(PW-ML-58,10,58,20,3);
  setTxt(C.accent); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr(dateStr), PW-ML-29, 21, {align:'center'});

  return { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage, getPage: ()=>pageNum };
}

function _pdfKpiRow(doc, ML, CW, y, cards, C, setFill, setTxt, rRect) {
  const n = cards.length;
  const cW = (CW - (n-1)*3) / n;
  cards.forEach((card, i) => {
    const cx = ML + i*(cW+3);
    setFill(C.surface); rRect(cx, y, cW, 22, 2);
    setFill(card.color.map ? card.color : C.accent);
    rRect(cx, y, 3, 22, 1);
    setTxt(card.color); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(card.val, cx+6, y+10);
    setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
    doc.text(card.lbl.toUpperCase(), cx+6, y+18);
  });
  return y + 28;
}

/* ================================================================
   SEFERLERi PDF
   ================================================================ */
async function downloadSeferPDF() {
  if (seferData.length === 0) { showToast('Indirilecek sefer kaydi yok.', 'error'); return; }
  showToast('Sefer raporu hazirlaniyor...', 'info');

  const { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage } = _pdfCommonSetup(
    'Sefer Raporu', 'Fleetly  |  Tüm Seferler  |  Detaylı Lojistik Analizi', [167,139,250]
  );

  let y = 54;

  // ── KPI KARTI SATIRI ──
  const totalSefer  = seferData.length;
  const totalKm     = seferData.reduce((a,s)=>a+(s.km||0),0);
  const totalCiro   = seferData.reduce((a,s)=>a+(s.ucret||0),0);
  const buAy        = new Date().toISOString().slice(0,7);
  const buAySeferler= seferData.filter(s=>s.tarih&&s.tarih.startsWith(buAy));
  const buAyCiro    = buAySeferler.reduce((a,s)=>a+(s.ucret||0),0);
  const ortUcret    = totalSefer>0 ? totalCiro/totalSefer : 0;
  const ortKm       = totalSefer>0 ? totalKm/totalSefer : 0;

  const kpiCards = [
    { val: totalSefer.toString(),                                          lbl: 'Toplam Sefer',    color: C.purple },
    { val: totalKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',lbl: 'Toplam Mesafe',   color: C.blue   },
    { val: 'TL '+totalCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}), lbl: 'Toplam Ciro',  color: C.green  },
    { val: 'TL '+buAyCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}),  lbl: 'Bu Ay Ciro',   color: C.orange },
    { val: 'TL '+ortUcret.toLocaleString('tr-TR',{maximumFractionDigits:0}),  lbl: 'Sefer Basi Ucret', color: C.yellow},
    { val: ortKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',  lbl: 'Ort. Mesafe',    color: C.text2  },
  ];
  y = _pdfKpiRow(doc, ML, CW, y, kpiCards, C, setFill, setTxt, rRect);

  // ── ARAÇ BAZLI ÖZET ──
  if (y + 14 > PH-30) { newPage(); y=20; }
  setTxt(C.purple); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Sefer Ozeti'), ML, y); y += 7;

  const byArac = {};
  seferData.forEach(s => {
    const key = s.plaka || s.aracId || 'Bilinmiyor';
    if (!byArac[key]) byArac[key] = { plaka:key, sefer:0, km:0, ciro:0 };
    byArac[key].sefer++;
    byArac[key].km   += s.km||0;
    byArac[key].ciro += s.ucret||0;
  });
  const aracRows = Object.values(byArac).sort((a,b)=>b.ciro-a.ciro);
  const maxCiro  = aracRows[0]?.ciro||1;

  const aColW = [28,22,30,30,CW-110];
  const aColH = ['Plaka','Sefer','Mesafe (km)','Ciro (TL)','Bar'];
  setFill(C.surface2); rect(ML,y,CW,7);
  setFill(C.purple); rect(ML,y,CW,0.7); rect(ML,y+6.3,CW,0.7);
  setTxt(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
  let hx=ML+2; aColH.forEach((h,i)=>{ doc.text(tr(h).toUpperCase(),hx,y+5); hx+=aColW[i]; });
  y += 8;

  aracRows.forEach((r,ri)=>{
    if (y+7 > PH-20) { newPage(); y=20; }
    setFill(ri%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(7.5); let rx=ML+2;
    setTxt(C.purple); doc.setFont('helvetica','bold');
    doc.text(tr(r.plaka), rx, y+5); rx+=aColW[0];
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(r.sefer.toString(), rx, y+5); rx+=aColW[1];
    setTxt(C.blue);
    doc.text(r.km.toLocaleString('tr-TR',{maximumFractionDigits:0}), rx, y+5); rx+=aColW[2];
    setTxt(C.green);
    doc.text(r.ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}), rx, y+5); rx+=aColW[3];
    // Bar
    const barW = aColW[4]-4;
    const pct  = Math.max(2, Math.round((r.ciro/maxCiro)*barW));
    setFill(C.surface2); rect(rx,y+2,barW,3);
    setFill(C.purple);   rect(rx,y+2,pct,3);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── EN ÇOK KULLANILAN ROTALAR ──
  if (y + 14 > PH-30) { newPage(); y=20; }
  setTxt(C.blue); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('En Cok Kullanilan Rotalar'), ML, y); y+=7;

  const byRota = {};
  seferData.forEach(s=>{
    const key = (s.kalkis||'?') + ' → ' + (s.varis||'?');
    if (!byRota[key]) byRota[key]={rota:key,count:0,ciro:0,km:0};
    byRota[key].count++;
    byRota[key].ciro += s.ucret||0;
    byRota[key].km   += s.km||0;
  });
  const rotaRows = Object.values(byRota).sort((a,b)=>b.count-a.count).slice(0,10);
  const maxRota  = rotaRows[0]?.count||1;

  rotaRows.forEach((r,ri)=>{
    if (y+7 > PH-20) { newPage(); y=20; }
    setFill(ri%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(7); let rx=ML+2;
    setTxt(C.text); doc.setFont('helvetica','bold');
    doc.text(tr(r.rota.slice(0,50)), rx, y+5); rx+=110;
    setTxt(C.purple);
    doc.text(r.count+' sefer', rx, y+5); rx+=22;
    setTxt(C.green);
    doc.text('TL '+r.ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}), rx, y+5); rx+=28;
    const barW2 = CW-162;
    const pct2  = Math.max(2, Math.round((r.count/maxRota)*barW2));
    setFill(C.surface2); rect(rx,y+2,barW2,3);
    setFill(C.blue);     rect(rx,y+2,pct2,3);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── AYLIK SEFER & CİRO TRENDİ ──
  if (y + 14 > PH-30) { newPage(); y=20; }
  setTxt(C.green); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Sefer ve Ciro Trendi (Son 12 Ay)'), ML, y); y+=7;

  const now12 = new Date();
  const months12 = [];
  for (let i=11;i>=0;i--) {
    const d = new Date(now12.getFullYear(), now12.getMonth()-i, 1);
    months12.push({ key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'), d });
  }
  const mSef={}, mCiro={};
  months12.forEach(m=>{ mSef[m.key]=0; mCiro[m.key]=0; });
  seferData.forEach(s=>{ if(s.tarih&&mSef[s.tarih.slice(0,7)]!==undefined){ mSef[s.tarih.slice(0,7)]++; mCiro[s.tarih.slice(0,7)]+=(s.ucret||0); } });
  const maxSef  = Math.max(1,...Object.values(mSef));
  const maxMCiro= Math.max(1,...Object.values(mCiro));

  const mColW = (CW-40)/12;
  const tblH  = 36;
  months12.forEach((m,i)=>{
    const cx = ML+40+i*mColW;
    const label = m.d.toLocaleDateString('tr-TR',{month:'short'}).slice(0,3)+' '+String(m.d.getFullYear()).slice(2);
    setTxt(C.muted); doc.setFontSize(5.5); doc.setFont('helvetica','normal');
    doc.text(tr(label), cx+mColW/2, y+tblH+4, {align:'center'});
    // Sefer çubuğu (mavi)
    const barH1 = Math.max(1, (mSef[m.key]/maxSef)*tblH*0.45);
    setFill(C.purple); rect(cx+1, y+tblH-barH1, mColW*0.45, barH1);
    // Ciro çubuğu (yeşil)
    const barH2 = Math.max(1, (mCiro[m.key]/maxMCiro)*tblH*0.45);
    setFill(C.green);  rect(cx+mColW*0.5, y+tblH-barH2, mColW*0.45, barH2);
  });
  // Eksen
  setFill(C.border); rect(ML+40,y,CW-40,0.5); rect(ML+40,y+tblH,CW-40,0.5);
  // Sol etiketler
  setTxt(C.purple); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
  doc.text(tr('Sefer Sayisi'), ML, y+tblH/3);
  setTxt(C.green);
  doc.text(tr('Ciro (TL)'), ML, y+tblH*0.66);
  y += tblH+12;

  // ── TÜM SEFER KAYITLARI ──
  newPage(); y=20;
  setTxt(C.purple); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Tum Sefer Kayitlari'), ML, y); y+=7;

  const cols = [
    {h:'Tarih',w:22},{h:'Arac',w:22},{h:'Sofor',w:28},{h:'Kalkis',w:28},
    {h:'Varis',w:28},{h:'Km',w:18},{h:'Yuk/Musteri',w:30},{h:'Ucret (TL)',w:CW-176}
  ];
  const drawSefHeader = (yy) => {
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.purple); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; cols.forEach(c=>{ doc.text(tr(c.h).toUpperCase(),hxx,yy+5); hxx+=c.w; });
    return yy+8;
  };
  y = drawSefHeader(y);

  const sorted = [...seferData].sort((a,b)=>(b.tarih||'').localeCompare(a.tarih||''));
  sorted.forEach((s,si)=>{
    if (y+7 > PH-18) { newPage(); y=15; y=drawSefHeader(y); }
    setFill(si%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx=ML+2;
    const fmtD = d => d ? d.split('-').reverse().join('.') : '—';
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(fmtD(s.tarih), rx, y+5); rx+=cols[0].w;
    setTxt(C.purple); doc.setFont('helvetica','bold');
    doc.text(tr(s.plaka||'—'), rx, y+5); rx+=cols[1].w;
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(tr((s.sofor||'—').slice(0,14)), rx, y+5); rx+=cols[2].w;
    doc.text(tr((s.kalkis||'—').slice(0,14)), rx, y+5); rx+=cols[3].w;
    doc.text(tr((s.varis||'—').slice(0,14)), rx, y+5); rx+=cols[4].w;
    setTxt(C.blue);
    doc.text(s.km?s.km.toLocaleString('tr-TR',{maximumFractionDigits:0}):'—', rx, y+5); rx+=cols[5].w;
    setTxt(C.text2);
    doc.text(tr((s.yuk||'—').slice(0,16)), rx, y+5); rx+=cols[6].w;
    setTxt(s.ucret>0?C.green:C.muted); doc.setFont('helvetica','bold');
    doc.text(s.ucret?s.ucret.toLocaleString('tr-TR',{maximumFractionDigits:0}):'—', rx, y+5);
    y+=7;
  });

  // Toplam satırı
  setFill(C.surface2); rect(ML,y,CW,8);
  setFill(C.purple); rect(ML,y,CW,0.5);
  setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(tr('TOPLAM'), ML+2, y+6);
  doc.text(totalKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km', ML+122, y+6);
  setTxt(C.green);
  doc.text('TL '+totalCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+176, y+6);

  addFooter();
  _pdfSave(doc, 'sefer_raporu_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('Sefer Raporu PDF indirildi!', 'success');
}

/* ================================================================
   MASRAF PDF
   ================================================================ */
async function downloadMasrafPDF() {
  if (masrafData.length === 0) { showToast('Indirilecek masraf kaydi yok.', 'error'); return; }
  showToast('Masraf raporu hazirlaniyor...', 'info');

  const { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage } = _pdfCommonSetup(
    'Masraf Raporu', 'Fleetly  |  Gider Analizi  |  Muhasebe & Lojistik', [245,158,11]
  );

  C.accent = [245,158,11];
  let y = 54;

  // ── KPI ──
  const totalMasraf = masrafData.reduce((a,m)=>a+(m.tutar||0),0);
  const buAym       = new Date().toISOString().slice(0,7);
  const buAyMasraf  = masrafData.filter(m=>m.tarih&&m.tarih.startsWith(buAym)).reduce((a,m)=>a+(m.tutar||0),0);
  const ortMasraf   = masrafData.length>0 ? totalMasraf/masrafData.length : 0;
  const byKatObj    = {};
  masrafData.forEach(m=>{ byKatObj[m.kategori]=(byKatObj[m.kategori]||0)+(m.tutar||0); });
  const topKat      = Object.entries(byKatObj).sort((a,b)=>b[1]-a[1])[0];

  const kpiCards = [
    { val: masrafData.length.toString(),                                            lbl:'Toplam Kayit',    color:C.blue   },
    { val:'TL '+totalMasraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),      lbl:'Toplam Masraf',   color:C.yellow },
    { val:'TL '+buAyMasraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),       lbl:'Bu Ay Masraf',    color:C.orange },
    { val:'TL '+ortMasraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),        lbl:'Kayit Basi Ort.', color:C.text2  },
    { val: topKat ? tr(topKat[0]).slice(0,12) : '—',                               lbl:'En Buyuk Kalem',  color:C.red    },
    { val: Object.keys(byKatObj).length.toString(),                                 lbl:'Kategori Sayisi', color:C.purple },
  ];
  y = _pdfKpiRow(doc, ML, CW, y, kpiCards, C, setFill, setTxt, rRect);

  // ── KATEGORİ BAZLI ÖZET ──
  if (y+14>PH-30) { newPage(); y=20; }
  setTxt(C.yellow); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Kategori Bazli Masraf Dagilimi'), ML, y); y+=7;

  const katRows = Object.entries(byKatObj).sort((a,b)=>b[1]-a[1]);
  const maxKat  = katRows[0]?.[1]||1;
  katRows.forEach(([ kat, tutar ],ki)=>{
    if (y+7>PH-20) { newPage(); y=20; }
    const pct   = (tutar/totalMasraf*100).toFixed(1);
    const barW  = CW-100;
    const barFW = Math.max(2, Math.round((tutar/maxKat)*barW));
    setFill(ki%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text(tr(kat), ML+2, y+5);
    setTxt(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(pct+'%', ML+82, y+5);
    setFill(C.surface2); rect(ML+100,y+2,barW,3);
    setFill(C.yellow);   rect(ML+100,y+2,barFW,3);
    setTxt(C.red); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('TL '+tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+100+barW+3, y+5);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── ARAÇ BAZLI MASRAF ──
  if (y+14>PH-30) { newPage(); y=20; }
  setTxt(C.orange); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Masraf Ozeti'), ML, y); y+=7;

  const byAracM = {};
  masrafData.forEach(m=>{
    const k = m.plaka||'Genel';
    if(!byAracM[k]) byAracM[k]={plaka:k,tutar:0,count:0};
    byAracM[k].tutar+=m.tutar||0; byAracM[k].count++;
  });
  const aracRowsM = Object.values(byAracM).sort((a,b)=>b.tutar-a.tutar);
  const maxAracM  = aracRowsM[0]?.tutar||1;
  aracRowsM.forEach((r,ri)=>{
    if (y+7>PH-20) { newPage(); y=20; }
    const barFill2 = Math.max(2,Math.round((r.tutar/maxAracM)*(CW-100)));
    setFill(ri%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    setTxt(C.orange); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text(tr(r.plaka), ML+2, y+5);
    setTxt(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(r.count+' kayit', ML+62, y+5);
    setFill(C.surface2); rect(ML+100,y+2,CW-100,3);
    setFill(C.orange);   rect(ML+100,y+2,barFill2,3);
    setTxt(C.red); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text('TL '+r.tutar.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+100+(CW-100)+3, y+5);
    y+=7;
  });
  setFill(C.border); rect(ML,y,CW,0.5); y+=10;

  // ── AYLIK MASRAF TRENDİ (grafik çubuk) ──
  if (y+14>PH-30) { newPage(); y=20; }
  setTxt(C.red); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Masraf Trendi (Son 12 Ay)'), ML, y); y+=7;

  const now12m = new Date(); const months12m = [];
  for(let i=11;i>=0;i--){
    const d=new Date(now12m.getFullYear(),now12m.getMonth()-i,1);
    months12m.push({key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),d});
  }
  const mTutar={};
  months12m.forEach(m=>{mTutar[m.key]=0;});
  masrafData.forEach(m=>{if(m.tarih&&mTutar[m.tarih.slice(0,7)]!==undefined)mTutar[m.tarih.slice(0,7)]+=(m.tutar||0);});
  const maxTutar=Math.max(1,...Object.values(mTutar));
  const mColW2=(CW-40)/12; const tblH2=32;
  months12m.forEach((m,i)=>{
    const cx=ML+40+i*mColW2;
    const label=m.d.toLocaleDateString('tr-TR',{month:'short'}).slice(0,3)+'\''+String(m.d.getFullYear()).slice(2);
    setTxt(C.muted); doc.setFontSize(5.5); doc.setFont('helvetica','normal');
    doc.text(tr(label),cx+mColW2/2,y+tblH2+4,{align:'center'});
    const bH=Math.max(1,(mTutar[m.key]/maxTutar)*tblH2);
    setFill(C.yellow); rect(cx+1,y+tblH2-bH,mColW2-2,bH);
    if(mTutar[m.key]>0){
      setTxt(C.text2); doc.setFontSize(4.5);
      doc.text('TL '+Math.round(mTutar[m.key]/1000)+'K',cx+mColW2/2,y+tblH2-bH-1.5,{align:'center'});
    }
  });
  setFill(C.border); rect(ML+40,y+tblH2,CW-40,0.5);
  y+=tblH2+12;

  // ── TÜM MASRAF KAYITLARI ──
  newPage(); y=20;
  setTxt(C.yellow); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Tum Masraf Kayitlari'), ML, y); y+=7;

  const mCols=[
    {h:'Tarih',w:22},{h:'Arac',w:22},{h:'Kategori',w:36},
    {h:'Aciklama',w:46},{h:'Makbuz No',w:28},{h:'Tutar (TL)',w:CW-154}
  ];
  const drawMHeader=(yy)=>{
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.yellow); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; mCols.forEach(c=>{doc.text(tr(c.h).toUpperCase(),hxx,yy+5);hxx+=c.w;});
    return yy+8;
  };
  y=drawMHeader(y);
  const sortedM=[...masrafData].sort((a,b)=>(b.tarih||'').localeCompare(a.tarih||''));
  sortedM.forEach((m,mi)=>{
    if(y+7>PH-18){newPage();y=15;y=drawMHeader(y);}
    setFill(mi%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx=ML+2;
    const fmtD=d=>d?d.split('-').reverse().join('.'):'—';
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(fmtD(m.tarih),rx,y+5); rx+=mCols[0].w;
    setTxt(C.orange); doc.setFont('helvetica','bold');
    doc.text(tr(m.plaka||'Genel'),rx,y+5); rx+=mCols[1].w;
    setTxt(C.yellow); doc.setFont('helvetica','normal');
    doc.text(tr((m.kategori||'—').slice(0,18)),rx,y+5); rx+=mCols[2].w;
    setTxt(C.text2);
    doc.text(tr((m.aciklama||'—').slice(0,22)),rx,y+5); rx+=mCols[3].w;
    setTxt(C.muted);
    doc.text(tr((m.makbuz||'—').slice(0,14)),rx,y+5); rx+=mCols[4].w;
    setTxt(C.red); doc.setFont('helvetica','bold');
    doc.text(m.tutar.toLocaleString('tr-TR',{maximumFractionDigits:2}),rx,y+5);
    y+=7;
  });
  // Toplam
  setFill(C.surface2); rect(ML,y,CW,8);
  setFill(C.yellow); rect(ML,y,CW,0.5);
  setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(tr('TOPLAM MASRAF'),ML+2,y+6);
  setTxt(C.red);
  doc.text('TL '+totalMasraf.toLocaleString('tr-TR',{maximumFractionDigits:2}),ML+154,y+6);

  addFooter();
  _pdfSave(doc, 'masraf_raporu_'+new Date().toISOString().slice(0,10)+'.pdf');
  showToast('Masraf Raporu PDF indirildi!','success');
}

/* ================================================================
   KAPSAMLI YÖNETİM RAPORU PDF (Raporlar modalındaki)
   ================================================================ */
async function downloadRaporPDF() {
  const donem   = document.getElementById('rapor-donem')?.value||'all';
  const flt     = e => !donem||donem==='all'||!e.tarih||e.tarih.startsWith(donem);

  const seferler  = seferData.filter(flt);
  const masraflar = masrafData.filter(flt);
  const yakitlar  = Object.values(fuelData).flat().filter(flt);
  const bakimlar  = Object.values(maintData).flat().filter(flt);

  if (seferler.length+masraflar.length+yakitlar.length+bakimlar.length===0) {
    showToast('Bu donem icin veri yok.','error'); return;
  }
  showToast('Yonetim raporu hazirlaniyor...','info');

  // Dönem etiketi
  let donemLabel='Tum Zamanlar';
  if(donem!=='all'){
    const [y,mo]=donem.split('-');
    donemLabel=['Ocak','Subat','Mart','Nisan','Mayis','Haziran','Temmuz','Agustos','Eylul','Ekim','Kasim','Aralik'][parseInt(mo)-1]+' '+y;
  }

  const { doc, PW, PH, ML, MR, CW, C, tr, setFill, setTxt, rect, rRect, addFooter, newPage } = _pdfCommonSetup(
    'Yonetim Raporu', 'Fleetly  |  Kapsamlı Gelir-Gider Analizi  |  '+donemLabel, [34,197,94]
  );

  C.accent=[34,197,94];
  let y=54;

  // ── ÜSTTE DÖNEM ETIKETI ──
  setFill(C.surface2); rRect(ML,y,CW,10,3);
  setTxt(C.green); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text(tr('Donem: ')+tr(donemLabel), ML+6, y+7);
  y+=16;

  // ── ANA KPI KARTLARI ──
  const toplamCiro   = seferler.reduce((a,s)=>a+(s.ucret||0),0);
  const toplamYakit  = yakitlar.reduce((a,e)=>a+(e.fiyat?e.fiyat*e.litre:0),0);
  const toplamBakim  = bakimlar.reduce((a,e)=>a+(e.maliyet||0),0);
  const toplamMasraf = masraflar.reduce((a,m)=>a+(m.tutar||0),0);
  const toplamGider  = toplamYakit+toplamBakim+toplamMasraf;
  const netKar       = toplamCiro-toplamGider;
  const toplamKm     = seferler.reduce((a,s)=>a+(s.km||0),0);
  const kmMaliyet    = toplamKm>0 ? toplamGider/toplamKm : 0;
  const karMarji     = toplamCiro>0 ? (netKar/toplamCiro*100) : 0;

  const kpiCards=[
    {val:'TL '+toplamCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}),  lbl:'Toplam Ciro',    color:C.green },
    {val:'TL '+toplamGider.toLocaleString('tr-TR',{maximumFractionDigits:0}), lbl:'Toplam Gider',   color:C.red   },
    {val:(netKar>=0?'+':'')+'TL '+Math.abs(netKar).toLocaleString('tr-TR',{maximumFractionDigits:0}), lbl:netKar>=0?'Net Kar':'Net Zarar', color:netKar>=0?C.green:C.red},
    {val:'%'+karMarji.toFixed(1),                                             lbl:'Kar Marji',      color:karMarji>=20?C.green:karMarji>=10?C.yellow:C.red},
    {val:seferler.length.toString(),                                          lbl:'Sefer Sayisi',   color:C.purple},
    {val:toplamKm.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',   lbl:'Toplam Mesafe',  color:C.blue  },
  ];
  y=_pdfKpiRow(doc,ML,CW,y,kpiCards,C,setFill,setTxt,rRect);

  // ── GELİR/GİDER DAĞILIMI YAN YANA ──
  if(y+14>PH-30){newPage();y=20;}
  setTxt(C.text2); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Gelir-Gider Analizi'), ML, y); y+=7;

  // Sol: Gider dağılımı
  const halfW=(CW-6)/2;
  const gItems=[
    {lbl:tr('Yakit'),  val:toplamYakit,  color:C.orange},
    {lbl:tr('Bakim'),  val:toplamBakim,  color:C.blue  },
    {lbl:tr('Masraf'), val:toplamMasraf, color:C.yellow},
  ];
  setFill(C.surface); rRect(ML,y,halfW,54,3);
  setFill(C.orange); rRect(ML,y,3,54,1);
  setTxt(C.orange); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr('Gider Dagilimi'), ML+6, y+8);
  gItems.forEach((g,gi)=>{
    const pct=toplamGider>0?(g.val/toplamGider*100):0;
    const bH=Math.max(1,(g.val/(Math.max(...gItems.map(x=>x.val))||1))*(halfW-50));
    setFill(C.surface2); rect(ML+50,y+14+gi*13,halfW-54,5);
    setFill(g.color);    rect(ML+50,y+14+gi*13,bH,5);
    setTxt(g.color); doc.setFontSize(7);
    doc.text(g.lbl,ML+6,y+18+gi*13);
    setTxt(C.text2); doc.setFontSize(6.5);
    doc.text(pct.toFixed(1)+'%  TL '+g.val.toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+50+halfW-54+2,y+18+gi*13);
  });

  // Sağ: Kar/Zarar
  const rx2=ML+halfW+6;
  setFill(C.surface); rRect(rx2,y,halfW,54,3);
  setFill(netKar>=0?C.green:C.red); rRect(rx2,y,3,54,1);
  setTxt(C.text2); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text(tr('Kar / Zarar Ozeti'), rx2+6, y+8);
  [
    {lbl:tr('Toplam Ciro'),  val:'TL '+toplamCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}), color:C.green},
    {lbl:tr('Toplam Gider'), val:'TL '+toplamGider.toLocaleString('tr-TR',{maximumFractionDigits:0}),color:C.red  },
    {lbl:tr('Net Sonuc'),    val:(netKar>=0?'+':'')+'TL '+Math.abs(netKar).toLocaleString('tr-TR',{maximumFractionDigits:0}), color:netKar>=0?C.green:C.red},
    {lbl:tr('Km Maliyeti'),  val:'TL '+kmMaliyet.toFixed(2)+'/km', color:C.yellow},
  ].forEach((row,ri)=>{
    setTxt(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(row.lbl, rx2+6, y+16+ri*10);
    setTxt(row.color); doc.setFont('helvetica','bold');
    doc.text(row.val, rx2+halfW-3, y+16+ri*10, {align:'right'});
  });
  y+=60;

  // ── ARAÇ BAZLI KAR/ZARAR TABLOSU ──
  if(y+14>PH-30){newPage();y=20;}
  setTxt(C.green); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Arac Bazli Karlılık Analizi'), ML, y); y+=7;

  const byAracR={};
  vehicles.forEach(v=>{byAracR[v.id]={plaka:v.plaka,ciro:0,yakit:0,bakim:0,masraf:0,km:0,sefer:0};});
  seferler.forEach(s=>{
    if(!byAracR[s.aracId]) byAracR[s.aracId]={plaka:s.plaka||s.aracId||'?',ciro:0,yakit:0,bakim:0,masraf:0,km:0,sefer:0};
    byAracR[s.aracId].ciro+=s.ucret||0; byAracR[s.aracId].km+=s.km||0; byAracR[s.aracId].sefer++;
  });
  Object.entries(fuelData).forEach(([vid,entries])=>{
    if(!byAracR[vid]) return;
    entries.filter(flt).forEach(e=>{byAracR[vid].yakit+=(e.fiyat?e.fiyat*e.litre:0);});
  });
  Object.entries(maintData).forEach(([vid,entries])=>{
    if(!byAracR[vid]) return;
    entries.filter(flt).forEach(e=>{byAracR[vid].bakim+=(e.maliyet||0);});
  });
  masraflar.forEach(m=>{if(byAracR[m.aracId]) byAracR[m.aracId].masraf+=m.tutar||0;});

  const aracRRows=Object.values(byAracR)
    .map(a=>({...a,gider:a.yakit+a.bakim+a.masraf,kar:a.ciro-(a.yakit+a.bakim+a.masraf)}))
    .filter(a=>a.ciro>0||a.gider>0).sort((a,b)=>b.kar-a.kar);

  const rCols=[
    {h:'Plaka',w:24},{h:'Sefer',w:14},{h:'Mesafe',w:22},{h:'Ciro (TL)',w:28},
    {h:'Yakit',w:26},{h:'Bakim',w:26},{h:'Masraf',w:26},{h:'Net Kar (TL)',w:CW-166}
  ];
  const drawRHeader=(yy)=>{
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.green); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; rCols.forEach(c=>{doc.text(tr(c.h).toUpperCase(),hxx,yy+5);hxx+=c.w;});
    return yy+8;
  };
  y=drawRHeader(y);
  aracRRows.forEach((a,ai)=>{
    if(y+7>PH-18){newPage();y=15;y=drawRHeader(y);}
    setFill(ai%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx3=ML+2;
    setTxt(C.orange); doc.setFont('helvetica','bold');
    doc.text(tr(a.plaka),rx3,y+5); rx3+=rCols[0].w;
    setTxt(C.text2); doc.setFont('helvetica','normal');
    doc.text(a.sefer.toString(),rx3,y+5); rx3+=rCols[1].w;
    setTxt(C.blue);
    doc.text(a.km.toLocaleString('tr-TR',{maximumFractionDigits:0})+' km',rx3,y+5); rx3+=rCols[2].w;
    setTxt(C.green);
    doc.text(a.ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[3].w;
    setTxt(C.orange);
    doc.text(a.yakit.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[4].w;
    setTxt(C.blue);
    doc.text(a.bakim.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[5].w;
    setTxt(C.yellow);
    doc.text(a.masraf.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5); rx3+=rCols[6].w;
    setTxt(a.kar>=0?C.green:C.red); doc.setFont('helvetica','bold');
    doc.text((a.kar>=0?'+':'')+a.kar.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx3,y+5);
    y+=7;
  });
  setFill(C.surface2); rect(ML,y,CW,8);
  setFill(C.green); rect(ML,y,CW,0.5);
  setTxt(C.text); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(tr('GENEL TOPLAM'),ML+2,y+6);
  setTxt(C.green); doc.text('TL '+toplamCiro.toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+60,y+6);
  setTxt(C.red);   doc.text('TL '+toplamGider.toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+112,y+6);
  setTxt(netKar>=0?C.green:C.red);
  doc.text((netKar>=0?'+':'')+'TL '+Math.abs(netKar).toLocaleString('tr-TR',{maximumFractionDigits:0}),ML+166,y+6);
  y+=14;

  // ── AYLIK ÖZET TABLO ──
  if(y+14>PH-30){newPage();y=20;}
  setTxt(C.blue); doc.setFontSize(10); doc.setFont('helvetica','bold');
  doc.text(tr('Aylik Ozet (Son 6 Ay)'), ML, y); y+=7;

  const allMonths=new Set();
  [...seferData,...masrafData,...Object.values(fuelData).flat(),...Object.values(maintData).flat()]
    .forEach(e=>{if(e.tarih) allMonths.add(e.tarih.slice(0,7));});
  const sorted6=[...allMonths].sort().reverse().slice(0,6).reverse();

  const mCols2=[{h:'Donem',w:26},{h:'Sefer',w:16},{h:'Ciro',w:28},{h:'Yakit',w:28},
    {h:'Bakim',w:28},{h:'Masraf',w:28},{h:'Net',w:CW-154}];
  const drawM2=(yy)=>{
    setFill(C.surface2); rect(ML,yy,CW,7);
    setFill(C.blue); rect(ML,yy,CW,0.7); rect(ML,yy+6.3,CW,0.7);
    setTxt(C.muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
    let hxx=ML+2; mCols2.forEach(c=>{doc.text(tr(c.h).toUpperCase(),hxx,yy+5);hxx+=c.w;});
    return yy+8;
  };
  y=drawM2(y);
  const moNames=['Oca','Sub','Mar','Nis','May','Haz','Tem','Agu','Eyl','Eki','Kas','Ara'];
  sorted6.forEach((m,mi)=>{
    if(y+7>PH-18){newPage();y=15;y=drawM2(y);}
    const [my,mmo]=m.split('-');
    const label=moNames[parseInt(mmo)-1]+' '+my;
    const sf=seferData.filter(s=>s.tarih&&s.tarih.startsWith(m));
    const mf=masrafData.filter(x=>x.tarih&&x.tarih.startsWith(m));
    const yf=Object.values(fuelData).flat().filter(x=>x.tarih&&x.tarih.startsWith(m));
    const bf=Object.values(maintData).flat().filter(x=>x.tarih&&x.tarih.startsWith(m));
    const ciro   =sf.reduce((a,s)=>a+(s.ucret||0),0);
    const yakit  =yf.reduce((a,e)=>a+(e.fiyat?e.fiyat*e.litre:0),0);
    const bakim  =bf.reduce((a,e)=>a+(e.maliyet||0),0);
    const masraf2=mf.reduce((a,x)=>a+(x.tutar||0),0);
    const net2   =ciro-(yakit+bakim+masraf2);
    setFill(mi%2===0?C.surface:C.bg); rect(ML,y,CW,7);
    doc.setFontSize(6.8); let rx4=ML+2;
    setTxt(C.text); doc.setFont('helvetica','bold');
    doc.text(tr(label),rx4,y+5); rx4+=mCols2[0].w;
    setTxt(C.purple); doc.setFont('helvetica','normal');
    doc.text(sf.length.toString(),rx4,y+5); rx4+=mCols2[1].w;
    setTxt(C.green);
    doc.text('TL '+ciro.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[2].w;
    setTxt(C.orange);
    doc.text('TL '+yakit.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[3].w;
    setTxt(C.blue);
    doc.text('TL '+bakim.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[4].w;
    setTxt(C.yellow);
    doc.text('TL '+masraf2.toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5); rx4+=mCols2[5].w;
    setTxt(net2>=0?C.green:C.red); doc.setFont('helvetica','bold');
    doc.text((net2>=0?'+':'')+'TL '+Math.abs(net2).toLocaleString('tr-TR',{maximumFractionDigits:0}),rx4,y+5);
    y+=7;
  });

  addFooter();
  _pdfSave(doc, 'yonetim_raporu_'+new Date().toISOString().slice(0,10)+'.pdf');
  showToast('Yonetim Raporu PDF indirildi!','success');
}
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
      baslangic_km: (r.baslangic_km !== null && r.baslangic_km !== undefined) ? r.baslangic_km : null,
      bitis_km    : (r.bitis_km     !== null && r.bitis_km     !== undefined) ? r.bitis_km     : null,
      yakit_litre : (r.yakit_litre  !== null && r.yakit_litre  !== undefined) ? r.yakit_litre  : null,
      yakit_tutar : (r.yakit_tutar  !== null && r.yakit_tutar  !== undefined) ? r.yakit_tutar  : null,
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
      baslangic_km: (entry.baslangic_km !== null && entry.baslangic_km !== undefined) ? entry.baslangic_km : null,
      bitis_km    : (entry.bitis_km     !== null && entry.bitis_km     !== undefined) ? entry.bitis_km     : null,
      yakit_litre : (entry.yakit_litre  !== null && entry.yakit_litre  !== undefined) ? entry.yakit_litre  : null,
      yakit_tutar : (entry.yakit_tutar  !== null && entry.yakit_tutar  !== undefined) ? entry.yakit_tutar  : null,
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
    _filteredVehicles().map(v => _aracSecimOption(v)).join('');
}

function saveSeferEntry() {
  const tarih   = document.getElementById('f-sefer-tarih').value;
  const aracId  = document.getElementById('f-sefer-arac').value;
  const sofor   = document.getElementById('f-sefer-sofor').value.trim();
  const kalkis  = document.getElementById('f-sefer-kalkis').value.trim();
  const varis   = document.getElementById('f-sefer-varis').value.trim();
  let   km      = parseFloat(document.getElementById('f-sefer-km').value)||0;
  const basKm   = parseFloat(document.getElementById('f-sefer-bas-km')?.value)||null;
  const bitKm   = parseFloat(document.getElementById('f-sefer-bit-km')?.value)||null;
  const yuk     = document.getElementById('f-sefer-yuk').value.trim();
  const ucret   = parseFloat(document.getElementById('f-sefer-ucret').value)||0;
  const not     = document.getElementById('f-sefer-not').value.trim();
  const eid     = document.getElementById('f-sefer-id').value;

  if(!tarih||!kalkis||!varis){ showToast('Tarih, Kalkış ve Varış zorunludur.','error'); return; }

  // Başlangıç/Bitiş km doluysa sefer mesafesini otomatik hesapla
  if (basKm !== null && bitKm !== null) {
    if (bitKm <= basKm) { showToast('Bitiş km, başlangıç km\'den büyük olmalı.','error'); return; }
    if (!km) km = +(bitKm - basKm).toFixed(2);
  }

  // Km aralığından yakıt maliyetini hesapla (cache için)
  let yakitLitre = null, yakitTutar = null;
  if (aracId && basKm !== null && bitKm !== null) {
    const r = calcFuelForKmRange(aracId, basKm, bitKm);
    if (r.count > 0) { yakitLitre = r.litre; yakitTutar = r.tl; }
  }

  const veh = vehicles.find(v=>v.id===aracId);
  const entry = { id: eid||uid(), tarih, aracId, plaka: veh?.plaka||'', sofor: sofor||(veh?.sofor||''), kalkis, varis, km, baslangic_km: basKm, bitis_km: bitKm, yakit_litre: yakitLitre, yakit_tutar: yakitTutar, yuk, ucret, not };

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
  ['f-sefer-arac','f-sefer-sofor','f-sefer-kalkis','f-sefer-varis','f-sefer-km','f-sefer-bas-km','f-sefer-bit-km','f-sefer-yuk','f-sefer-ucret','f-sefer-not'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  showToast('Sefer kaydedildi ✓','success');
  switchSeferTab('liste');
}

/* Başlangıç / Bitiş km girildiğinde mesafeyi otomatik hesapla */
function _seferKmAutoCalc() {
  const basEl = document.getElementById('f-sefer-bas-km');
  const bitEl = document.getElementById('f-sefer-bit-km');
  const kmEl  = document.getElementById('f-sefer-km');
  if (!basEl || !bitEl || !kmEl) return;
  const b = parseFloat(basEl.value), e = parseFloat(bitEl.value);
  if (isFinite(b) && isFinite(e) && e > b) {
    // Kullanıcı km'yi manuel girmediyse (veya boşsa) doldur
    if (!kmEl.value || Math.abs(parseFloat(kmEl.value) - (e - b)) < 0.01) {
      kmEl.value = (e - b).toFixed(0);
    }
  }
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
  tbody.innerHTML = sorted.map(s=>{
    // Ops bağlantısı varsa ilgili iş emrini bul (müşteri adı için)
    const bagliOps = s._opsId ? isEmirleri.find(e => String(e._dbId||e.id) === String(s._opsId)) : null;
    const musteriAdi = bagliOps?.musteri_adi || '';
    const kmStr  = s.km   > 0 ? s.km.toLocaleString('tr-TR')+' km' : '—';
    const ucretStr = s.ucret > 0 ? '₺'+s.ucret.toLocaleString('tr-TR',{minimumFractionDigits:0}) : '—';
    return `
    <tr>
      <td>${fmtDate(s.tarih)}</td>
      <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${s.plaka||'—'}</span></td>
      <td>${s.sofor||'—'}</td>
      <td style="color:var(--text2)">${s.kalkis}</td>
      <td style="color:var(--text2)">${s.varis}</td>
      <td style="font-family:var(--font-mono);color:var(--blue)">${kmStr}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;">
        ${musteriAdi ? `<div style="font-weight:600;color:var(--text);margin-bottom:1px;">${musteriAdi}</div>` : ''}
        <div style="color:var(--muted)">${s.yuk||'—'}</div>
      </td>
      <td style="font-family:var(--font-mono);color:var(--green);font-weight:700">${ucretStr}</td>
      <td>
        ${s._opsId
          ? `<span title="Operasyon #${s._opsId}" style="display:inline-flex;align-items:center;gap:3px;background:rgba(249,115,22,.12);color:var(--accent);font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;white-space:nowrap;" onclick="closeSeferModal();setTimeout(()=>{openOperasyonPage();setTimeout(()=>openOpsDrawer(${s._opsId}),600)},100)">📦 Ops #${s._opsId}</span>`
          : `<span style="font-size:11px;color:var(--muted);">${s.not||''}</span>`
        }
      </td>
      <td><button class="srm-del-btn" onclick="deleteSeferEntry('${s.id}')">✕</button></td>
    </tr>`;
  }).join('');
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

  function barChart(rows, colorFrom, colorTo, keyFn, lbl1Fn, lbl2Fn) {
    if (!rows.length) return '<p style="color:var(--muted);font-size:13px">Henüz sefer kaydı yok.</p>';
    const maxU = rows[0].ucret || 1;
    return rows.map(r=>`
      <div class="rapor-row">
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-mono);font-weight:700;color:var(--accent);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${keyFn(r)}</div>
          <div style="color:var(--muted);font-size:10.5px;margin-top:1px;">${lbl1Fn(r)}${lbl2Fn(r)?` · ${lbl2Fn(r)}`:''}</div>
          <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${Math.round((r.ucret||0)/maxU*100)}%;background:linear-gradient(90deg,${colorFrom},${colorTo})"></div></div>
        </div>
        <div class="rapor-row-val" style="color:var(--green);flex-shrink:0;">₺${(r.ucret||0).toLocaleString('tr-TR',{minimumFractionDigits:0})}</div>
      </div>`).join('');
  }

  // ── Araç bazlı ────────────────────────────────────────────
  const byArac = {};
  seferData.forEach(s=>{
    const k = s.plaka || s.aracId || '—';
    if(!byArac[k]) byArac[k]={plaka:k,sefer:0,km:0,ucret:0};
    byArac[k].sefer++;
    byArac[k].km    += s.km   ||0;
    byArac[k].ucret += s.ucret||0;
  });
  const aracRows = Object.values(byArac).sort((a,b)=>b.ucret-a.ucret);

  // ── Müşteri bazlı (ops bağlantısı olan seferler) ─────────
  const byMusteri = {};
  seferData.forEach(s=>{
    if(!s._opsId) return; // sadece operasyona bağlı seferler
    const ops = isEmirleri.find(e=>String(e._dbId||e.id)===String(s._opsId));
    const k   = ops?.musteri_adi || ops?.musteri_id || null;
    if(!k) return;
    if(!byMusteri[k]) byMusteri[k]={musteri:k,sefer:0,km:0,ucret:0};
    byMusteri[k].sefer++;
    byMusteri[k].km    += s.km   ||0;
    byMusteri[k].ucret += s.ucret||0;
  });
  const musteriRows = Object.values(byMusteri).sort((a,b)=>b.ucret-a.ucret);

  el.innerHTML = `
    <div class="rapor-card" style="margin-bottom:16px">
      <div class="rapor-card-title" style="color:var(--purple)">🚛 Araç Bazlı Sefer Özeti</div>
      ${barChart(aracRows,'var(--purple)','#c4b5fd',r=>r.plaka,r=>`${r.sefer} sefer`,r=>r.km>0?r.km.toLocaleString('tr-TR')+' km':'')}
    </div>
    ${musteriRows.length ? `
    <div class="rapor-card">
      <div class="rapor-card-title" style="color:var(--blue)">🏢 Müşteri Bazlı Sefer Özeti</div>
      ${barChart(musteriRows,'var(--blue)','#7dd3fc',r=>r.musteri,r=>`${r.sefer} sefer`,r=>r.km>0?r.km.toLocaleString('tr-TR')+' km':'')}
    </div>` : ''}`;
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

/* ================================================================
   FİYAT TEKLİFİ MODÜLÜ (TEKLİFLER + TARİFELER)
   ================================================================ */
let teklifData = [];
let tarifeData = [];
let teklifKalemler = [];          // Form sayfasındaki açık teklif satırları
let _teklifChart = null;          // Analiz Chart.js referansı

/* --- Para formatı --- */
function _tekPara(v, cur) {
  cur = cur || (document.getElementById('f-tek-para')?.value || 'TL');
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '₺';
  return sym + (Number(v || 0)).toLocaleString('tr-TR', {maximumFractionDigits:2});
}
function _tekParaOnly(v) { return (Number(v || 0)).toLocaleString('tr-TR', {maximumFractionDigits:2}); }

/* --- Okunabilir teklif numarası üret --- */
function _teklifNoUret() {
  const y = new Date().getFullYear();
  const mevcut = teklifData
    .map(t => (t.teklif_no || '').match(new RegExp('^TKF-' + y + '-(\\d+)$')))
    .filter(x => x)
    .map(x => parseInt(x[1], 10));
  const son = mevcut.length ? Math.max.apply(null, mevcut) : 0;
  return 'TKF-' + y + '-' + String(son + 1).padStart(4, '0');
}

/* --- Modal aç/kapat --- */
async function openTeklifModal() {
  // Veriler yoksa bir kez yükle
  if (!teklifData.length && !tarifeData.length) {
    await loadTeklifler();
    await loadTarifeler();
  }
  _teklifAracSelectDoldur();
  _teklifCrmSelectDoldur();
  _tarifeCrmSelectDoldur();
  switchTeklifTab('liste');
  document.getElementById('teklif-backdrop').classList.remove('hidden');
}
function closeTeklifModal() { document.getElementById('teklif-backdrop').classList.add('hidden'); }

function switchTeklifTab(t) {
  ['liste','form','tarife','analiz'].forEach(n => {
    document.getElementById('teklif-tab-'+n)?.classList.toggle('active', n===t);
    document.getElementById('teklif-panel-'+n)?.classList.toggle('active', n===t);
  });
  if (t === 'liste')  { renderTeklifTable(); renderTeklifStatsRow(); }
  if (t === 'form')   { /* form open */ }
  if (t === 'tarife') { renderTarifeTable(); }
  if (t === 'analiz') { renderTeklifAnaliz(); }
}

/* --- Araç / CRM select doldur --- */
function _teklifAracSelectDoldur() {
  const sel = document.getElementById('f-tek-arac');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Araç Seç —</option>' +
    (vehicles || []).map(v => `<option value="${v.id}" data-plaka="${v.plaka||''}">${v.plaka || '?'}${v.sofor ? ' · ' + v.sofor : ''}</option>`).join('');
}
function _teklifCrmSelectDoldur() {
  const sel = document.getElementById('f-tek-crm');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Yeni müşteri / Seç —</option>' +
    (crmMusteriler || []).map(m => `<option value="${m.id}">${m.firma || m.ad || '—'}</option>`).join('');
}
function _tarifeCrmSelectDoldur() {
  const sel = document.getElementById('f-tarife-musteri');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Tüm müşteriler —</option>' +
    (crmMusteriler || []).map(m => `<option value="${m.id}">${m.firma || m.ad || '—'}</option>`).join('');
}

/* --- CRM müşteri seçince form alanlarını doldur --- */
function _teklifCrmSec() {
  const id = document.getElementById('f-tek-crm').value;
  if (!id) return;
  const m = (crmMusteriler || []).find(x => String(x.id) === String(id));
  if (!m) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('f-tek-musteri', m.firma || m.ad || '');
  set('f-tek-vergi',   m.vergi || m.vkn || '');
  set('f-tek-tel',     m.tel || m.telefon || '');
  set('f-tek-eposta',  m.eposta || m.email || '');
  set('f-tek-adres',   m.adres || '');
  _teklifTarifeBul();
}

/* --- Yakıt öneri bandı: km × avgTL/km --- */
function _teklifYakitOnerisi() {
  const box = document.getElementById('f-tek-oneri');
  if (!box) return;
  const km   = parseFloat(document.getElementById('f-tek-km').value) || 0;
  const vId  = document.getElementById('f-tek-arac').value;
  const tl   = vId ? (calcAvgTLPerKm(vId) || 0) : 0;
  if (km > 0 && tl > 0) {
    const est = km * tl;
    box.style.display = 'block';
    box.innerHTML = '⛽ <strong>Yakıt tahmini:</strong> ' + km.toLocaleString('tr-TR') +
      ' km × ₺' + tl.toFixed(2) + '/km ≈ <strong style="color:#22d3ee">₺' + _tekParaOnly(est) +
      '</strong> &nbsp; <button onclick="_teklifEkleYakit()" style="background:rgba(34,211,238,.18);border:1px solid rgba(34,211,238,.4);color:#22d3ee;border-radius:6px;padding:2px 10px;font-size:11px;font-weight:700;cursor:pointer;">+ Kalem olarak ekle</button>';
  } else if (km > 0 && !tl) {
    box.style.display = 'block';
    box.innerHTML = '⚠ <strong>Yakıt tahmini yok:</strong> Bu araç için yeterli yakıt kaydı bulunamadı. Elle kalem ekleyerek devam edebilirsin.';
  } else {
    box.style.display = 'none';
  }
}

/* --- Tarife eşleştirme: kalkış + teslim + konteyner + tonaj --- */
function _teklifTarifeBul() {
  const infoEl = document.getElementById('tek-tarife-info');
  if (!infoEl) return;
  const kalkis = (document.getElementById('f-tek-kalkis').value || '').trim().toLowerCase();
  const teslim = (document.getElementById('f-tek-teslim').value || '').trim().toLowerCase();
  const kont   = (document.getElementById('f-tek-kont').value   || '').trim();
  const ton    = parseFloat(document.getElementById('f-tek-ton').value) || 0;
  const musId  = document.getElementById('f-tek-crm').value || null;

  if (!kalkis || !teslim) { infoEl.textContent = '—'; return; }

  const adayList = (tarifeData || []).filter(t => {
    if (!t.aktif) return false;
    if ((t.kalkis_yeri || '').toLowerCase() !== kalkis) return false;
    if ((t.teslim_yeri || '').toLowerCase() !== teslim) return false;
    if (t.konteyner_tip && kont && t.konteyner_tip !== kont) return false;
    if (ton > 0 && (ton < (t.tonaj_min || 0) || ton > (t.tonaj_max || 99999))) return false;
    if (t.musteri_id && musId && String(t.musteri_id) !== String(musId)) return false;
    return true;
  });

  // Önce müşteriye özel tarife, sonra genel — puana göre sırala
  const puan = t => (t.musteri_id ? 10 : 0) + (t.konteyner_tip ? 5 : 0);
  adayList.sort((a, b) => puan(b) - puan(a));

  if (!adayList.length) { infoEl.textContent = 'Bu rota için kayıtlı tarife yok — manuel kalem ekleyin.'; return; }
  const t = adayList[0];
  const fiyat = t.birim_fiyat || 0;
  infoEl.innerHTML = '<strong>' + (t.musteri_id ? 'Müşteriye özel' : 'Genel') + '</strong> tarife bulundu: ' +
    _tekPara(fiyat, t.para_birimi) + ' / sefer ' +
    '<button onclick="_teklifTarifeUygula(' + t.id + ')" style="background:rgba(34,197,94,.18);border:1px solid rgba(34,197,94,.4);color:#22c55e;border-radius:5px;padding:1px 8px;font-size:10.5px;font-weight:700;cursor:pointer;margin-left:6px;">Uygula</button>';
}

function _teklifTarifeUygula(tarifeId) {
  const t = (tarifeData || []).find(x => String(x.id) === String(tarifeId));
  if (!t) { showToast('Tarife bulunamadı', 'error'); return; }
  // Mevcut 'tarife' tipli kalemleri temizle
  teklifKalemler = teklifKalemler.filter(k => k.tip !== 'tarife');
  const adet = parseInt(document.getElementById('f-tek-adet').value) || 1;
  teklifKalemler.push({
    tip: 'tarife',
    aciklama: 'Tarife: ' + (t.kalkis_yeri || '') + ' → ' + (t.teslim_yeri || '') + (t.konteyner_tip ? ' (' + t.konteyner_tip + ')' : ''),
    birim: 'sefer',
    miktar: adet,
    birim_fiyat: t.birim_fiyat || 0,
    tutar: (t.birim_fiyat || 0) * adet,
    tarife_id: t.id
  });
  _teklifKalemRender();
  _teklifHesapla();
  document.getElementById('tek-tarife-info').innerHTML = '<span style="color:#22c55e">✓ Uygulandı</span> — ' + (t.kalkis_yeri || '') + '→' + (t.teslim_yeri || '') + ': ' + _tekPara(t.birim_fiyat, t.para_birimi);
  showToast('Tarife uygulandı ✓', 'success');
}

/* --- Kalem ekle / sil / değiştir --- */
function _teklifEkleYakit() {
  const km   = parseFloat(document.getElementById('f-tek-km').value) || 0;
  const vId  = document.getElementById('f-tek-arac').value;
  const tl   = vId ? (calcAvgTLPerKm(vId) || 0) : 0;
  if (km <= 0) { showToast('Önce Km girin.', 'error'); return; }
  if (tl <= 0) { showToast('Bu araç için yakıt ortalaması yok — manuel ekleyin.', 'error'); return; }
  // Önce varsa eski yakıt kalemini temizle
  teklifKalemler = teklifKalemler.filter(k => k.tip !== 'yakit');
  teklifKalemler.push({
    tip: 'yakit',
    aciklama: 'Yakıt (' + km + ' km × ₺' + tl.toFixed(2) + '/km)',
    birim: 'km',
    miktar: km,
    birim_fiyat: tl,
    tutar: +(km * tl).toFixed(2)
  });
  _teklifKalemRender();
  _teklifHesapla();
}
function _teklifEkleKalem(tip, aciklama, birim, miktar) {
  teklifKalemler.push({
    tip: tip || 'diger',
    aciklama: aciklama || 'Kalem',
    birim: birim || 'adet',
    miktar: miktar || 1,
    birim_fiyat: 0,
    tutar: 0
  });
  _teklifKalemRender();
  _teklifHesapla();
}
function _teklifKalemSil(i) {
  teklifKalemler.splice(i, 1);
  _teklifKalemRender();
  _teklifHesapla();
}
function _teklifKalemGuncelle(i, alan, val) {
  if (!teklifKalemler[i]) return;
  if (alan === 'aciklama') teklifKalemler[i].aciklama = val;
  else if (alan === 'birim') teklifKalemler[i].birim = val;
  else if (alan === 'miktar') teklifKalemler[i].miktar = parseFloat(val) || 0;
  else if (alan === 'birim_fiyat') teklifKalemler[i].birim_fiyat = parseFloat(val) || 0;
  // Tutar = miktar × birim_fiyat
  teklifKalemler[i].tutar = +((teklifKalemler[i].miktar || 0) * (teklifKalemler[i].birim_fiyat || 0)).toFixed(2);
  // Tutar hücresini tek başına güncelle
  const td = document.querySelector('#teklif-kalem-body tr[data-i="'+i+'"] .tek-k-tutar');
  if (td) td.textContent = _tekPara(teklifKalemler[i].tutar);
  _teklifHesapla();
}
function _teklifKalemRender() {
  const tb = document.getElementById('teklif-kalem-body');
  if (!tb) return;
  if (!teklifKalemler.length) {
    tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px;font-size:11.5px">Kalem yok — yukarıdaki düğmeler veya "Tarife" eşleşmesiyle başlayın.</td></tr>';
    return;
  }
  const tipRenk = { yakit:'#22d3ee', sofor:'#a78bfa', yol:'#3b82f6', tonaj:'#e8521a', tarife:'#22c55e', diger:'#94a3b8' };
  tb.innerHTML = teklifKalemler.map((k, i) => {
    const renk = tipRenk[k.tip] || '#94a3b8';
    return '<tr data-i="' + i + '">' +
      '<td><span style="background:' + renk + '22;color:' + renk + ';border:1px solid ' + renk + '55;border-radius:5px;padding:2px 7px;font-size:10.5px;font-weight:700;text-transform:uppercase;">' + k.tip + '</span></td>' +
      '<td><input class="srm-inp" style="padding:4px 7px;font-size:11.5px" value="' + (k.aciklama || '').replace(/"/g, '&quot;') + '" oninput="_teklifKalemGuncelle(' + i + ', \'aciklama\', this.value)"/></td>' +
      '<td><input class="srm-inp" style="padding:4px 7px;font-size:11.5px" value="' + (k.birim || '') + '" oninput="_teklifKalemGuncelle(' + i + ', \'birim\', this.value)"/></td>' +
      '<td><input class="srm-inp" type="number" step="0.01" style="padding:4px 7px;font-size:11.5px" value="' + (k.miktar || 0) + '" oninput="_teklifKalemGuncelle(' + i + ', \'miktar\', this.value)"/></td>' +
      '<td><input class="srm-inp" type="number" step="0.01" style="padding:4px 7px;font-size:11.5px" value="' + (k.birim_fiyat || 0) + '" oninput="_teklifKalemGuncelle(' + i + ', \'birim_fiyat\', this.value)"/></td>' +
      '<td class="tek-k-tutar" style="font-family:var(--font-mono);font-weight:700;text-align:right;">' + _tekPara(k.tutar || 0) + '</td>' +
      '<td><button onclick="_teklifKalemSil(' + i + ')" style="background:transparent;border:none;color:#ef4444;cursor:pointer;font-size:14px;">✕</button></td>' +
      '</tr>';
  }).join('');
}

/* --- Hesaplama --- */
function _teklifHesapla() {
  const maliyet = teklifKalemler.reduce((a, k) => a + (k.tutar || 0), 0);
  const marj    = parseFloat(document.getElementById('f-tek-marj').value) || 0;
  const kdv     = parseFloat(document.getElementById('f-tek-kdv').value)  || 0;
  const kar     = +(maliyet * marj / 100).toFixed(2);
  const ara     = +(maliyet + kar).toFixed(2);
  const kdvTl   = +(ara * kdv / 100).toFixed(2);
  const genel   = +(ara + kdvTl).toFixed(2);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = _tekPara(v); };
  set('tek-sum-maliyet', maliyet);
  set('tek-sum-kar',     kar);
  set('tek-sum-ara',     ara);
  set('tek-sum-kdv',     kdvTl);
  set('tek-sum-genel',   genel);
}

/* --- Form reset --- */
function _teklifFormReset() {
  teklifKalemler = [];
  ['f-tek-id','f-tek-crm','f-tek-musteri','f-tek-vergi','f-tek-tel','f-tek-eposta','f-tek-adres',
   'f-tek-kalkis','f-tek-teslim','f-tek-km','f-tek-arac','f-tek-kont','f-tek-ton','f-tek-yuk',
   'f-tek-notlar','f-tek-sartlar']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('f-tek-adet', 1);
  set('f-tek-tarih', new Date().toISOString().slice(0,10));
  set('f-tek-gecerlilik', 7);
  set('f-tek-odeme', 'Peşin');
  set('f-tek-para', 'TL');
  set('f-tek-marj', 15);
  set('f-tek-kdv', 20);
  document.getElementById('f-tek-oneri').style.display = 'none';
  document.getElementById('tek-tarife-info').textContent = '—';
  _teklifKalemRender();
  _teklifHesapla();
}

/* --- Düzenle: mevcut teklifi forma yükle --- */
function editTeklif(id) {
  const t = teklifData.find(x => String(x.id) === String(id));
  if (!t) return;
  _teklifFormReset();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === null || v === undefined) ? '' : v; };
  set('f-tek-id',        t.id);
  set('f-tek-crm',       t.musteri_id || '');
  set('f-tek-musteri',   t.musteri_adi);
  set('f-tek-vergi',     t.musteri_vergi);
  set('f-tek-tel',       t.musteri_tel);
  set('f-tek-eposta',    t.musteri_eposta);
  set('f-tek-adres',     t.musteri_adres);
  set('f-tek-kalkis',    t.kalkis_yeri);
  set('f-tek-teslim',    t.teslim_yeri);
  set('f-tek-km',        t.tahmini_km);
  set('f-tek-arac',      t.arac_id || '');
  set('f-tek-kont',      t.konteyner_tip);
  set('f-tek-adet',      t.konteyner_adet || 1);
  set('f-tek-ton',       t.tonaj);
  set('f-tek-yuk',       t.yuk_cinsi);
  set('f-tek-tarih',     t.teklif_tarih);
  set('f-tek-gecerlilik',t.gecerlilik_gun || 7);
  set('f-tek-odeme',     t.odeme_kosul || 'Peşin');
  set('f-tek-para',      t.para_birimi || 'TL');
  set('f-tek-notlar',    t.notlar);
  set('f-tek-sartlar',   t.sartlar);
  set('f-tek-marj',      t.kar_marji_pct ?? 15);
  set('f-tek-kdv',       t.kdv_orani     ?? 20);
  teklifKalemler = Array.isArray(t.kalemler) ? JSON.parse(JSON.stringify(t.kalemler)) : [];
  _teklifKalemRender();
  _teklifHesapla();
  _teklifYakitOnerisi();
  switchTeklifTab('form');
}

/* --- Kaydet --- */
async function saveTeklif(durum) {
  const musteri = (document.getElementById('f-tek-musteri').value || '').trim();
  if (!musteri) { showToast('Müşteri adı zorunlu', 'error'); return null; }
  const kalkis  = (document.getElementById('f-tek-kalkis').value || '').trim();
  const teslim  = (document.getElementById('f-tek-teslim').value || '').trim();
  if (!kalkis || !teslim) { showToast('Kalkış ve Teslim zorunlu', 'error'); return null; }
  if (!teklifKalemler.length) { showToast('En az bir maliyet kalemi ekleyin', 'error'); return null; }

  const idStr = document.getElementById('f-tek-id').value;
  const id    = idStr ? parseInt(idStr, 10) : null;
  const aracSel = document.getElementById('f-tek-arac');
  const aracPlaka = aracSel?.selectedOptions?.[0]?.dataset?.plaka || '';
  const tek = {
    id: id,
    teklif_no     : id ? (teklifData.find(x => x.id === id)?.teklif_no || _teklifNoUret()) : _teklifNoUret(),
    firma_id      : currentFirmaId || null,
    musteri_id    : document.getElementById('f-tek-crm').value || null,
    musteri_adi   : musteri,
    musteri_vergi : document.getElementById('f-tek-vergi').value || null,
    musteri_tel   : document.getElementById('f-tek-tel').value || null,
    musteri_eposta: document.getElementById('f-tek-eposta').value || null,
    musteri_adres : document.getElementById('f-tek-adres').value || null,
    arac_id       : aracSel?.value || null,
    arac_plaka    : aracPlaka || null,
    kalkis_yeri   : kalkis,
    teslim_yeri   : teslim,
    tahmini_km    : parseFloat(document.getElementById('f-tek-km').value) || null,
    konteyner_tip : document.getElementById('f-tek-kont').value || null,
    konteyner_adet: parseInt(document.getElementById('f-tek-adet').value) || 1,
    tonaj         : parseFloat(document.getElementById('f-tek-ton').value) || null,
    yuk_cinsi     : document.getElementById('f-tek-yuk').value || null,
    kalemler      : JSON.parse(JSON.stringify(teklifKalemler)),
    kar_marji_pct : parseFloat(document.getElementById('f-tek-marj').value) || 0,
    kdv_orani     : parseFloat(document.getElementById('f-tek-kdv').value)  || 0,
    para_birimi   : document.getElementById('f-tek-para').value || 'TL',
    teklif_tarih  : document.getElementById('f-tek-tarih').value || new Date().toISOString().slice(0,10),
    gecerlilik_gun: parseInt(document.getElementById('f-tek-gecerlilik').value) || 7,
    odeme_kosul   : document.getElementById('f-tek-odeme').value || null,
    notlar        : document.getElementById('f-tek-notlar').value || null,
    sartlar       : document.getElementById('f-tek-sartlar').value || null,
    durum         : durum || 'Taslak'
  };
  // Client tarafı hesaplar (DB trigger de aynısını yapar ama UI için tekrar)
  tek.maliyet_toplam = tek.kalemler.reduce((a, k) => a + (k.tutar || 0), 0);
  tek.kar_tutar      = +(tek.maliyet_toplam * tek.kar_marji_pct / 100).toFixed(2);
  tek.ara_toplam     = +(tek.maliyet_toplam + tek.kar_tutar).toFixed(2);
  tek.kdv_tutar      = +(tek.ara_toplam * tek.kdv_orani / 100).toFixed(2);
  tek.genel_toplam   = +(tek.ara_toplam + tek.kdv_tutar).toFixed(2);
  const dt = new Date(tek.teklif_tarih); dt.setDate(dt.getDate() + tek.gecerlilik_gun);
  tek.son_gecerlilik = dt.toISOString().slice(0,10);

  // Locale
  const idx = id ? teklifData.findIndex(x => x.id === id) : -1;
  if (idx >= 0) { teklifData[idx] = { ...teklifData[idx], ...tek }; }
  else {
    // Local için geçici id (DB tarafı auto, ama local gösterim için şimdi üret)
    if (!tek.id) tek.id = Date.now();
    teklifData.unshift(tek);
  }
  localStorage.setItem('fleetly_teklifler', JSON.stringify(teklifData));

  // Bulut
  const kaydedilen = await saveTeklifCloud(tek, idx >= 0);
  if (kaydedilen && kaydedilen.id) {
    // Gerçek DB id'sini al
    const i = teklifData.findIndex(x => x.id === tek.id);
    if (i >= 0) teklifData[i] = { ...teklifData[i], ...kaydedilen };
    localStorage.setItem('fleetly_teklifler', JSON.stringify(teklifData));
    tek.id = kaydedilen.id;
  }

  showToast('Teklif ' + (durum === 'Gönderildi' ? 'gönderildi' : 'kaydedildi') + ' ✓', 'success');
  renderTeklifTable();
  renderTeklifStatsRow();
  updateTeklifStat?.();
  switchTeklifTab('liste');
  return tek;
}

async function saveTeklifCloud(tek, isUpdate) {
  if (isLocalMode() || !_authToken) return null;
  try {
    const { data: { user } } = await getSB().auth.getUser();
    if (!user) return null;
    const row = {
      firma_id: tek.firma_id || currentFirmaId || null,
      user_id : user.id,
      teklif_no: tek.teklif_no,
      musteri_id: tek.musteri_id ? parseInt(tek.musteri_id, 10) : null,
      musteri_adi: tek.musteri_adi,
      musteri_vergi: tek.musteri_vergi,
      musteri_tel: tek.musteri_tel,
      musteri_eposta: tek.musteri_eposta,
      musteri_adres: tek.musteri_adres,
      arac_id: tek.arac_id,
      arac_plaka: tek.arac_plaka,
      kalkis_yeri: tek.kalkis_yeri,
      teslim_yeri: tek.teslim_yeri,
      tahmini_km: tek.tahmini_km,
      konteyner_tip: tek.konteyner_tip,
      konteyner_adet: tek.konteyner_adet,
      tonaj: tek.tonaj,
      yuk_cinsi: tek.yuk_cinsi,
      kalemler: tek.kalemler,
      kar_marji_pct: tek.kar_marji_pct,
      kdv_orani: tek.kdv_orani,
      para_birimi: tek.para_birimi,
      teklif_tarih: tek.teklif_tarih,
      gecerlilik_gun: tek.gecerlilik_gun,
      odeme_kosul: tek.odeme_kosul,
      notlar: tek.notlar,
      sartlar: tek.sartlar,
      durum: tek.durum
    };
    let res;
    if (isUpdate && tek.id && typeof tek.id === 'number' && tek.id < 1e12) {
      // Gerçek DB id (bigint küçük)
      res = await fetch(sbUrl('teklifler?id=eq.' + tek.id), {
        method : 'PATCH',
        headers: sbHeaders(),
        body   : JSON.stringify(row)
      });
    } else {
      res = await fetch(sbUrl('teklifler'), {
        method : 'POST',
        headers: sbHeaders(),
        body   : JSON.stringify(row)
      });
    }
    if (!res.ok) { const e = await res.text(); throw new Error(e); }
    const arr = await res.json();
    return Array.isArray(arr) ? arr[0] : arr;
  } catch (err) {
    console.error('Teklif buluta kaydedilemedi:', err);
    showToast('Teklif yerel kaydedildi (bulut hatası).', 'error');
    return null;
  }
}

async function deleteTeklif(id) {
  if (!confirm('Bu teklifi silmek istediğinize emin misiniz?')) return;
  teklifData = teklifData.filter(x => x.id !== id);
  localStorage.setItem('fleetly_teklifler', JSON.stringify(teklifData));
  if (!isLocalMode() && _authToken && typeof id === 'number' && id < 1e12) {
    try { await fetch(sbUrl('teklifler?id=eq.' + id), { method: 'DELETE', headers: sbHeaders() }); }
    catch (err) { console.error('Teklif buluttan silinemedi:', err); }
  }
  renderTeklifTable();
  renderTeklifStatsRow();
  updateTeklifStat?.();
  showToast('Teklif silindi.', 'error');
}

async function updateTeklifDurum(id, yeniDurum) {
  const t = teklifData.find(x => x.id === id);
  if (!t) return;
  t.durum = yeniDurum;
  localStorage.setItem('fleetly_teklifler', JSON.stringify(teklifData));
  if (!isLocalMode() && _authToken && typeof id === 'number' && id < 1e12) {
    try { await fetch(sbUrl('teklifler?id=eq.' + id), { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ durum: yeniDurum }) }); }
    catch (err) { console.error('Durum güncellenemedi:', err); }
  }
  renderTeklifTable();
  renderTeklifStatsRow();
  updateTeklifStat?.();
  showToast('Durum: ' + yeniDurum, 'success');
}

async function teklifSureKontrol() {
  const bugun = new Date().toISOString().slice(0,10);
  let n = 0;
  teklifData.forEach(t => {
    if ((t.durum === 'Taslak' || t.durum === 'Gönderildi') && t.son_gecerlilik && t.son_gecerlilik < bugun) {
      t.durum = 'Süresi Doldu';
      n++;
    }
  });
  if (n > 0) {
    localStorage.setItem('fleetly_teklifler', JSON.stringify(teklifData));
    if (!isLocalMode() && _authToken) {
      try {
        await fetch(sbUrl('rpc/teklif_sure_kontrol'), {
          method: 'POST', headers: sbHeaders(),
          body: JSON.stringify({ p_firma_id: currentFirmaId })
        });
      } catch (err) { console.warn('rpc teklif_sure_kontrol hatası:', err); }
    }
    showToast(n + ' teklif süresi dolmuş olarak işaretlendi.', 'success');
  } else {
    showToast('Süresi dolmuş teklif yok ✓', 'info');
  }
  renderTeklifTable();
  renderTeklifStatsRow();
  updateTeklifStat?.();
}

/* --- Yükle --- */
async function loadTeklifler() {
  try { teklifData = JSON.parse(localStorage.getItem('fleetly_teklifler') || '[]'); }
  catch { teklifData = []; }
  if (isLocalMode() || !_authToken) { updateTeklifStat?.(); return; }
  try {
    const res = await fetch(sbUrl('teklifler?select=*&order=teklif_tarih.desc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('Teklifler yüklenemedi: ' + res.status);
    const rows = await res.json();
    teklifData = rows.map(r => ({
      ...r,
      // normalize JSONB
      kalemler: Array.isArray(r.kalemler) ? r.kalemler : (typeof r.kalemler === 'string' ? JSON.parse(r.kalemler) : [])
    }));
    localStorage.setItem('fleetly_teklifler', JSON.stringify(teklifData));
  } catch (err) {
    console.warn('Teklifler Supabase hatası, localStorage kullanılıyor:', err);
  }
  updateTeklifStat?.();
}

async function loadTarifeler() {
  try { tarifeData = JSON.parse(localStorage.getItem('fleetly_tarifeler') || '[]'); }
  catch { tarifeData = []; }
  if (isLocalMode() || !_authToken) return;
  try {
    const res = await fetch(sbUrl('tarifeler?select=*&order=olusturma.desc'), { headers: sbHeaders() });
    if (!res.ok) throw new Error('Tarifeler yüklenemedi: ' + res.status);
    tarifeData = await res.json();
    localStorage.setItem('fleetly_tarifeler', JSON.stringify(tarifeData));
  } catch (err) {
    console.warn('Tarifeler Supabase hatası, localStorage kullanılıyor:', err);
  }
}

/* --- Tarife CRUD --- */
function _tarifeFormToggle(show) {
  const w = document.getElementById('tarife-form-wrap');
  if (!w) return;
  if (show === false) { w.style.display = 'none'; return; }
  w.style.display = (w.style.display === 'none' || !w.style.display) ? 'block' : 'none';
  if (w.style.display === 'block') {
    document.getElementById('f-tarife-id').value = '';
  }
}
async function saveTarife() {
  const kalkis = (document.getElementById('f-tarife-kalkis').value || '').trim();
  const teslim = (document.getElementById('f-tarife-teslim').value || '').trim();
  const fiyat  = parseFloat(document.getElementById('f-tarife-fiyat').value) || 0;
  if (!kalkis || !teslim) { showToast('Kalkış ve Teslim zorunlu', 'error'); return; }
  if (fiyat <= 0) { showToast('Birim fiyat zorunlu', 'error'); return; }
  const musId = document.getElementById('f-tarife-musteri').value;
  const musAdi = musId ? ((crmMusteriler.find(m => String(m.id) === String(musId)) || {}).firma || '') : '';
  const idStr = document.getElementById('f-tarife-id').value;
  const id = idStr ? parseInt(idStr, 10) : null;
  const t = {
    id: id,
    firma_id: currentFirmaId || null,
    musteri_id: musId ? parseInt(musId, 10) : null,
    musteri_adi: musAdi || null,
    kalkis_yeri: kalkis,
    teslim_yeri: teslim,
    konteyner_tip: document.getElementById('f-tarife-kont').value || null,
    tonaj_min: parseFloat(document.getElementById('f-tarife-ton-min').value) || 0,
    tonaj_max: parseFloat(document.getElementById('f-tarife-ton-max').value) || 99999,
    birim_fiyat: fiyat,
    para_birimi: document.getElementById('f-tarife-para').value || 'TL',
    km_tahmini: parseFloat(document.getElementById('f-tarife-km').value) || null,
    aciklama: document.getElementById('f-tarife-aciklama').value || null,
    aktif: true
  };
  const idx = id ? tarifeData.findIndex(x => x.id === id) : -1;
  if (idx >= 0) tarifeData[idx] = { ...tarifeData[idx], ...t };
  else {
    if (!t.id) t.id = Date.now();
    tarifeData.unshift(t);
  }
  localStorage.setItem('fleetly_tarifeler', JSON.stringify(tarifeData));

  if (!isLocalMode() && _authToken) {
    try {
      const { data: { user } } = await getSB().auth.getUser();
      if (user) {
        const row = { ...t, user_id: user.id };
        delete row.id;
        if (idx >= 0 && typeof t.id === 'number' && t.id < 1e12) {
          await fetch(sbUrl('tarifeler?id=eq.' + t.id), { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(row) });
        } else {
          const res = await fetch(sbUrl('tarifeler'), { method: 'POST', headers: sbHeaders(), body: JSON.stringify(row) });
          if (res.ok) {
            const arr = await res.json();
            const saved = Array.isArray(arr) ? arr[0] : arr;
            if (saved && saved.id) {
              const i = tarifeData.findIndex(x => x.id === t.id);
              if (i >= 0) tarifeData[i] = { ...tarifeData[i], ...saved };
              localStorage.setItem('fleetly_tarifeler', JSON.stringify(tarifeData));
            }
          }
        }
      }
    } catch (err) { console.error('Tarife buluta kaydedilemedi:', err); }
  }

  showToast('Tarife kaydedildi ✓', 'success');
  _tarifeFormToggle(false);
  renderTarifeTable();
}
function editTarife(id) {
  const t = tarifeData.find(x => x.id === id);
  if (!t) return;
  _tarifeFormToggle(true);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v === null || v === undefined) ? '' : v; };
  set('f-tarife-id', t.id);
  set('f-tarife-musteri', t.musteri_id || '');
  set('f-tarife-kalkis', t.kalkis_yeri);
  set('f-tarife-teslim', t.teslim_yeri);
  set('f-tarife-kont', t.konteyner_tip || '');
  set('f-tarife-ton-min', t.tonaj_min ?? 0);
  set('f-tarife-ton-max', t.tonaj_max ?? 30);
  set('f-tarife-fiyat', t.birim_fiyat);
  set('f-tarife-para', t.para_birimi || 'TL');
  set('f-tarife-km', t.km_tahmini);
  set('f-tarife-aciklama', t.aciklama);
}
async function deleteTarife(id) {
  if (!confirm('Bu tarifeyi silmek istediğinize emin misiniz?')) return;
  tarifeData = tarifeData.filter(x => x.id !== id);
  localStorage.setItem('fleetly_tarifeler', JSON.stringify(tarifeData));
  if (!isLocalMode() && _authToken && typeof id === 'number' && id < 1e12) {
    try { await fetch(sbUrl('tarifeler?id=eq.' + id), { method: 'DELETE', headers: sbHeaders() }); }
    catch (err) { console.error('Tarife buluttan silinemedi:', err); }
  }
  renderTarifeTable();
}
async function toggleTarifeAktif(id) {
  const t = tarifeData.find(x => x.id === id);
  if (!t) return;
  t.aktif = !t.aktif;
  localStorage.setItem('fleetly_tarifeler', JSON.stringify(tarifeData));
  if (!isLocalMode() && _authToken && typeof id === 'number' && id < 1e12) {
    try { await fetch(sbUrl('tarifeler?id=eq.' + id), { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify({ aktif: t.aktif }) }); }
    catch (err) { console.error('Tarife durumu güncellenemedi:', err); }
  }
  renderTarifeTable();
}

/* --- Render: Teklif tablosu --- */
function renderTeklifTable() {
  const tb = document.getElementById('teklif-table-body');
  if (!tb) return;
  const q = (document.getElementById('teklif-search')?.value || '').toLowerCase().trim();
  const df = document.getElementById('teklif-filtre-durum')?.value || '';
  let list = (teklifData || []).slice();
  if (df) list = list.filter(t => t.durum === df);
  if (q) list = list.filter(t =>
    (t.musteri_adi || '').toLowerCase().includes(q) ||
    (t.teklif_no   || '').toLowerCase().includes(q) ||
    (t.kalkis_yeri || '').toLowerCase().includes(q) ||
    (t.teslim_yeri || '').toLowerCase().includes(q)
  );
  list.sort((a, b) => (b.teklif_tarih || '').localeCompare(a.teklif_tarih || ''));

  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="9" class="srm-empty" style="text-align:center;color:var(--muted);padding:18px">Kayıt bulunamadı.</td></tr>';
    return;
  }

  const durumBadge = d => {
    const renk = {
      'Taslak'       : ['#64748b','rgba(100,116,139,.15)'],
      'Gönderildi'   : ['#f59e0b','rgba(245,158,11,.15)'],
      'Kabul'        : ['#22c55e','rgba(34,197,94,.15)'],
      'Red'          : ['#ef4444','rgba(239,68,68,.15)'],
      'Süresi Doldu' : ['#a78bfa','rgba(167,139,250,.15)'],
      'İptal'        : ['#94a3b8','rgba(148,163,184,.15)']
    }[d] || ['#94a3b8','rgba(148,163,184,.15)'];
    return '<span style="background:' + renk[1] + ';color:' + renk[0] + ';border:1px solid ' + renk[0] + '55;border-radius:5px;padding:2px 8px;font-size:10.5px;font-weight:700;white-space:nowrap;">' + d + '</span>';
  };
  const fmt = d => d ? d.split('-').reverse().join('.') : '—';

  tb.innerHTML = list.map(t => {
    const cur = t.para_birimi || 'TL';
    const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '₺';
    const kontStr = (t.konteyner_tip ? (t.konteyner_adet || 1) + '×' + t.konteyner_tip : '—') + (t.tonaj ? ' · ' + t.tonaj + 't' : '');
    return '<tr>' +
      '<td style="font-family:var(--font-mono);font-size:11.5px">' + (t.teklif_no || '—') + '</td>' +
      '<td>' + fmt(t.teklif_tarih) + '</td>' +
      '<td><strong>' + (t.musteri_adi || '—') + '</strong></td>' +
      '<td style="font-size:11.5px">' + (t.kalkis_yeri || '—') + ' → ' + (t.teslim_yeri || '—') + '</td>' +
      '<td style="font-size:11.5px">' + kontStr + '</td>' +
      '<td style="font-family:var(--font-mono);font-weight:700;text-align:right">' + sym + _tekParaOnly(t.genel_toplam) + '</td>' +
      '<td>' + durumBadge(t.durum) + '</td>' +
      '<td style="font-size:11px;color:' + (t.son_gecerlilik && t.son_gecerlilik < new Date().toISOString().slice(0,10) ? 'var(--red)' : 'var(--muted)') + '">' + fmt(t.son_gecerlilik) + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button onclick="downloadTeklifPDF(' + t.id + ')" title="PDF" style="background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.35);color:#3b82f6;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;margin-right:3px">📄</button>' +
        '<button onclick="editTeklif(' + t.id + ')" title="Düzenle" style="background:rgba(34,211,238,.15);border:1px solid rgba(34,211,238,.35);color:#22d3ee;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;margin-right:3px">✎</button>' +
        (t.durum === 'Gönderildi'
          ? '<button onclick="updateTeklifDurum(' + t.id + ',\'Kabul\')" title="Kabul" style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);color:#22c55e;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;margin-right:3px">✓</button>' +
            '<button onclick="updateTeklifDurum(' + t.id + ',\'Red\')" title="Red" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#ef4444;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;margin-right:3px">✗</button>'
          : '') +
        '<button onclick="deleteTeklif(' + t.id + ')" title="Sil" style="background:transparent;border:none;color:#ef4444;font-size:14px;cursor:pointer;">🗑</button>' +
      '</td>' +
      '</tr>';
  }).join('');
}

function renderTeklifStatsRow() {
  const el = document.getElementById('teklif-stats-row');
  if (!el) return;
  const n = teklifData.length;
  const gond = teklifData.filter(t => t.durum === 'Gönderildi').length;
  const kab  = teklifData.filter(t => t.durum === 'Kabul').length;
  const red  = teklifData.filter(t => t.durum === 'Red').length;
  const toplamKabul = teklifData.filter(t => t.durum === 'Kabul').reduce((a, t) => a + (t.genel_toplam || 0), 0);
  const sureli = teklifData.filter(t => t.durum === 'Gönderildi' && t.son_gecerlilik && t.son_gecerlilik >= new Date().toISOString().slice(0,10)).length;
  const kabulOrani = (kab + red) > 0 ? (kab * 100 / (kab + red)).toFixed(0) + '%' : '—';
  el.innerHTML = [
    { ico:'📋', lbl:'Toplam', val:n, c:'#64748b' },
    { ico:'📤', lbl:'Gönderilen', val:gond, c:'#f59e0b' },
    { ico:'⏱', lbl:'Bekleyen (süreli)', val:sureli, c:'#22d3ee' },
    { ico:'✓', lbl:'Kabul', val:kab, c:'#22c55e' },
    { ico:'📈', lbl:'Kabul Oranı', val:kabulOrani, c:'#a78bfa' },
    { ico:'💰', lbl:'Kabul Tutar', val:'₺' + _tekParaOnly(toplamKabul), c:'var(--accent)' }
  ].map(s => '<div class="srm-stat" style="border-color:' + s.c + '33"><div class="srm-stat-ico">' + s.ico + '</div><div><div class="srm-stat-val" style="color:' + s.c + '">' + s.val + '</div><div class="srm-stat-lbl">' + s.lbl + '</div></div></div>').join('');
}

/* --- Render: Tarife tablosu --- */
function renderTarifeTable() {
  const tb = document.getElementById('tarife-table-body');
  if (!tb) return;
  const q = (document.getElementById('tarife-search')?.value || '').toLowerCase().trim();
  let list = (tarifeData || []).slice();
  if (q) list = list.filter(t =>
    (t.musteri_adi || '').toLowerCase().includes(q) ||
    (t.kalkis_yeri || '').toLowerCase().includes(q) ||
    (t.teslim_yeri || '').toLowerCase().includes(q)
  );
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">Kayıt bulunamadı.</td></tr>';
    return;
  }
  tb.innerHTML = list.map(t => {
    const cur = t.para_birimi || 'TL';
    const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '₺';
    const tonStr = (t.tonaj_min || 0) + '–' + (t.tonaj_max >= 99999 ? '∞' : t.tonaj_max) + ' t';
    return '<tr>' +
      '<td>' + (t.musteri_adi || '<em style="color:var(--muted)">Tüm müşteriler</em>') + '</td>' +
      '<td><strong>' + (t.kalkis_yeri || '—') + '</strong> → <strong>' + (t.teslim_yeri || '—') + '</strong></td>' +
      '<td>' + (t.konteyner_tip || '<em style="color:var(--muted)">Tüm tipler</em>') + '</td>' +
      '<td style="font-size:11.5px">' + tonStr + '</td>' +
      '<td style="font-family:var(--font-mono);font-weight:700">' + sym + _tekParaOnly(t.birim_fiyat) + '</td>' +
      '<td>' + (t.km_tahmini || '—') + '</td>' +
      '<td><span onclick="toggleTarifeAktif(' + t.id + ')" style="cursor:pointer;background:' + (t.aktif ? 'rgba(34,197,94,.15)' : 'rgba(100,116,139,.15)') + ';color:' + (t.aktif ? '#22c55e' : '#64748b') + ';border:1px solid ' + (t.aktif ? 'rgba(34,197,94,.4)' : 'rgba(100,116,139,.4)') + ';border-radius:5px;padding:2px 8px;font-size:10.5px;font-weight:700;">' + (t.aktif ? '● Aktif' : '○ Pasif') + '</span></td>' +
      '<td style="white-space:nowrap">' +
        '<button onclick="editTarife(' + t.id + ')" style="background:rgba(34,211,238,.15);border:1px solid rgba(34,211,238,.35);color:#22d3ee;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;margin-right:3px">✎</button>' +
        '<button onclick="deleteTarife(' + t.id + ')" style="background:transparent;border:none;color:#ef4444;font-size:14px;cursor:pointer;">🗑</button>' +
      '</td>' +
      '</tr>';
  }).join('');
}

/* --- Render: Analiz paneli --- */
function renderTeklifAnaliz() {
  // KPI
  const kpiEl = document.getElementById('teklif-analiz-kpi');
  if (kpiEl) {
    const durumGroup = {};
    teklifData.forEach(t => { durumGroup[t.durum] = (durumGroup[t.durum] || 0) + 1; });
    const kabul = durumGroup['Kabul']   || 0;
    const red   = durumGroup['Red']     || 0;
    const toplam = teklifData.length;
    const ortTutar = toplam > 0 ? teklifData.reduce((a, t) => a + (t.genel_toplam || 0), 0) / toplam : 0;
    const kabulOrani = (kabul + red) > 0 ? (kabul * 100 / (kabul + red)).toFixed(1) : 0;
    const kabulTutar = teklifData.filter(t => t.durum === 'Kabul').reduce((a, t) => a + (t.genel_toplam || 0), 0);
    kpiEl.innerHTML = [
      { ico:'📋', lbl:'Toplam Teklif',    val:toplam,                      c:'#64748b' },
      { ico:'✓', lbl:'Kabul',             val:kabul,                       c:'#22c55e' },
      { ico:'📈', lbl:'Kabul Oranı',      val:kabulOrani + '%',            c:'#a78bfa' },
      { ico:'💰', lbl:'Ort. Tutar',       val:'₺' + _tekParaOnly(ortTutar), c:'#f59e0b' },
      { ico:'🏆', lbl:'Kabul Toplamı',    val:'₺' + _tekParaOnly(kabulTutar), c:'var(--accent)' }
    ].map(s => '<div style="background:var(--surface2);border:1px solid ' + s.c + '33;border-radius:10px;padding:11px 13px;display:flex;gap:8px;align-items:center;"><div style="font-size:18px">' + s.ico + '</div><div><div style="font-size:15px;font-weight:800;color:' + s.c + '">' + s.val + '</div><div style="font-size:10.5px;color:var(--muted);font-weight:600">' + s.lbl + '</div></div></div>').join('');
  }
  // Durum chart
  try {
    const ctx = document.getElementById('chart-teklif-durum');
    if (ctx && typeof Chart !== 'undefined') {
      const durum = {};
      teklifData.forEach(t => { durum[t.durum || '—'] = (durum[t.durum || '—'] || 0) + 1; });
      const labels = Object.keys(durum);
      const data = labels.map(l => durum[l]);
      const colors = labels.map(l => ({
        'Taslak':'#64748b','Gönderildi':'#f59e0b','Kabul':'#22c55e','Red':'#ef4444','Süresi Doldu':'#a78bfa','İptal':'#94a3b8'
      }[l] || '#cbd5e1'));
      if (_teklifChart) { try { _teklifChart.destroy(); } catch(e){} }
      _teklifChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }] },
        options: { plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } }, cutout: '60%' }
      });
    }
  } catch (err) { console.warn('Teklif durum chart hatası:', err); }
  // Müşteri kabul oranları tablosu
  const mb = document.getElementById('teklif-analiz-musteri-body');
  if (mb) {
    const g = {};
    teklifData.forEach(t => {
      const k = t.musteri_adi || '—';
      if (!g[k]) g[k] = { ad:k, toplam:0, kabul:0, red:0, kabulTutar:0 };
      g[k].toplam++;
      if (t.durum === 'Kabul') { g[k].kabul++; g[k].kabulTutar += (t.genel_toplam || 0); }
      if (t.durum === 'Red')   g[k].red++;
    });
    const rows = Object.values(g).sort((a,b) => b.toplam - a.toplam);
    if (!rows.length) { mb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:14px">Veri yok.</td></tr>'; return; }
    mb.innerHTML = rows.map(r => {
      const or = (r.kabul + r.red) > 0 ? (r.kabul * 100 / (r.kabul + r.red)).toFixed(1) + '%' : '—';
      return '<tr>' +
        '<td><strong>' + r.ad + '</strong></td>' +
        '<td>' + r.toplam + '</td>' +
        '<td style="color:#22c55e;font-weight:700">' + r.kabul + '</td>' +
        '<td style="color:#ef4444;font-weight:700">' + r.red + '</td>' +
        '<td>' + or + '</td>' +
        '<td style="font-family:var(--font-mono);font-weight:700">₺' + _tekParaOnly(r.kabulTutar) + '</td>' +
        '</tr>';
    }).join('');
  }
}

/* --- Dashboard mini stat --- */
function updateTeklifStat() {
  const el  = document.getElementById('stat-teklif-toplam');
  const el2 = document.getElementById('stat-teklif-bekleyen');
  const el3 = document.getElementById('stat-teklif-kabul-tutar');
  const tr  = document.getElementById('trend-teklif');
  if (el)  el.textContent  = (teklifData.length || 0).toLocaleString('tr-TR');
  const bekleyen = teklifData.filter(t => t.durum === 'Gönderildi').length;
  const kabulTutar = teklifData.filter(t => t.durum === 'Kabul').reduce((a, t) => a + (t.genel_toplam || 0), 0);
  if (el2) el2.textContent = bekleyen > 0 ? bekleyen + ' bekliyor' : '—';
  if (el3) el3.textContent = kabulTutar > 0 ? '₺' + kabulTutar.toLocaleString('tr-TR', {maximumFractionDigits:0}) : '—';
  if (tr) {
    tr.textContent = bekleyen > 0 ? bekleyen + ' teklif cevap bekliyor' : 'Aktif teklif yok';
    tr.className = bekleyen > 0 ? 'stat-trend warn' : 'stat-trend ok';
  }
}

/* --- PDF — profesyonel teklif dökümanı --- */
async function saveTeklifAndDownloadPDF() {
  const saved = await saveTeklif('Gönderildi');
  if (!saved) return;
  setTimeout(() => { downloadTeklifPDF(saved.id); }, 200);
}
function downloadTeklifPDF(id) {
  const t = teklifData.find(x => x.id === id);
  if (!t) { showToast('Teklif bulunamadı', 'error'); return; }
  if (typeof window.jspdf === 'undefined') { showToast('PDF kütüphanesi yüklenemedi', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const cur = t.para_birimi || 'TL';
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? 'EUR ' : 'TL ';
  const para = v => sym + (Number(v || 0)).toLocaleString('tr-TR', {maximumFractionDigits:2});
  const fmtD = d => d ? d.split('-').reverse().join('.') : '—';

  // Başlık
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18); doc.setTextColor(255,255,255);
  doc.text('FIYAT TEKLIFI', 14, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text((t.teklif_no || '—') + '  |  ' + fmtD(t.teklif_tarih), 14, 20);

  // Geçerlilik kutusu
  doc.setFillColor(255, 255, 255); doc.setDrawColor(245,158,11);
  doc.rect(140, 5, 62, 17, 'FD');
  doc.setTextColor(245,158,11); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text('GECERLILIK', 143, 10);
  doc.setTextColor(30,30,30); doc.setFontSize(11);
  doc.text(fmtD(t.son_gecerlilik) + ' (' + (t.gecerlilik_gun || 0) + ' gun)', 143, 16);

  let y = 34;
  doc.setTextColor(30,30,30);

  // Müşteri bloğu
  doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.setFillColor(245, 245, 245);
  doc.rect(14, y, 182, 6, 'F');
  doc.text('MUSTERI', 17, y + 4);
  y += 8;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.setFont('helvetica','bold'); doc.text((t.musteri_adi || '—'), 14, y); doc.setFont('helvetica','normal');
  y += 5;
  if (t.musteri_vergi)  { doc.setFontSize(9); doc.text('VKN/TCKN: ' + t.musteri_vergi, 14, y); y += 4; }
  if (t.musteri_adres)  { doc.setFontSize(9); const lines = doc.splitTextToSize(t.musteri_adres, 180); doc.text(lines, 14, y); y += 4 * lines.length; }
  if (t.musteri_tel || t.musteri_eposta) {
    doc.setFontSize(9); doc.text([t.musteri_tel, t.musteri_eposta].filter(Boolean).join('  |  '), 14, y); y += 4;
  }

  // Sevkiyat bloğu
  y += 4;
  doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.setFillColor(245, 245, 245); doc.rect(14, y, 182, 6, 'F');
  doc.text('SEVKIYAT BILGILERI', 17, y + 4);
  y += 9;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const sevkRow = [
    ['Kalkis:', t.kalkis_yeri || '—'],
    ['Teslim:', t.teslim_yeri || '—'],
    ['Konteyner:', (t.konteyner_tip ? (t.konteyner_adet || 1) + ' x ' + t.konteyner_tip : '—')],
    ['Tonaj:', t.tonaj ? (t.tonaj + ' ton') : '—'],
    ['Yuk:', t.yuk_cinsi || '—'],
    ['Tahmini Km:', t.tahmini_km ? (t.tahmini_km + ' km') : '—']
  ];
  sevkRow.forEach((r, i) => {
    const col = i % 2;
    const rowIdx = Math.floor(i / 2);
    const x = 14 + col * 92;
    const yy = y + rowIdx * 5;
    doc.setFont('helvetica','bold'); doc.text(r[0], x, yy); doc.setFont('helvetica','normal');
    doc.text(r[1], x + 25, yy);
  });
  y += Math.ceil(sevkRow.length / 2) * 5 + 4;

  // Kalemler tablosu
  doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.setFillColor(30, 41, 59); doc.setTextColor(255,255,255);
  doc.rect(14, y, 182, 7, 'F');
  doc.text('ACIKLAMA', 17, y + 5);
  doc.text('BIRIM', 100, y + 5);
  doc.text('MIK.', 122, y + 5);
  doc.text('BIRIM FIYAT', 145, y + 5);
  doc.text('TUTAR', 180, y + 5, { align: 'right' });
  y += 10;
  doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setFontSize(9);
  (t.kalemler || []).forEach((k, i) => {
    if (y > 240) { doc.addPage(); y = 20; }
    if (i % 2 === 0) { doc.setFillColor(248, 248, 248); doc.rect(14, y - 4, 182, 6, 'F'); }
    const aciklama = doc.splitTextToSize(k.aciklama || '', 80);
    doc.text(aciklama[0] || '', 17, y);
    doc.text(k.birim || '—', 100, y);
    doc.text(String(k.miktar || 0), 122, y);
    doc.text(para(k.birim_fiyat), 145, y);
    doc.text(para(k.tutar), 195, y, { align: 'right' });
    y += 5;
  });

  // Toplamlar
  if (y > 230) { doc.addPage(); y = 20; }
  y += 3;
  doc.setDrawColor(200, 200, 200);
  doc.line(120, y, 196, y); y += 5;
  doc.setFontSize(9);
  doc.text('Toplam Maliyet:', 120, y); doc.text(para(t.maliyet_toplam), 195, y, { align: 'right' }); y += 4.5;
  doc.text('Kar (' + (t.kar_marji_pct || 0) + '%):', 120, y); doc.text(para(t.kar_tutar), 195, y, { align: 'right' }); y += 4.5;
  doc.setFont('helvetica','bold'); doc.text('Ara Toplam:', 120, y); doc.text(para(t.ara_toplam), 195, y, { align: 'right' }); doc.setFont('helvetica','normal'); y += 4.5;
  doc.text('KDV (' + (t.kdv_orani || 0) + '%):', 120, y); doc.text(para(t.kdv_tutar), 195, y, { align: 'right' }); y += 5;
  doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.8);
  doc.line(120, y, 196, y); y += 5;
  doc.setFillColor(245, 158, 11); doc.rect(120, y - 4.5, 76, 8, 'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('GENEL TOPLAM', 123, y + 1);
  doc.text(para(t.genel_toplam), 194, y + 1, { align: 'right' });
  doc.setTextColor(30,30,30); doc.setFont('helvetica','normal'); doc.setLineWidth(0.2);
  y += 10;

  // Odeme & Notlar
  if (t.odeme_kosul) { doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.text('Odeme Kosulu: ', 14, y); doc.setFont('helvetica','normal'); doc.text(t.odeme_kosul, 42, y); y += 5; }
  if (t.notlar) {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFont('helvetica','bold'); doc.text('Notlar:', 14, y); y += 4;
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    const nl = doc.splitTextToSize(t.notlar, 182); doc.text(nl, 14, y); y += 4 * nl.length + 2;
  }
  if (t.sartlar) {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFont('helvetica','bold'); doc.text('Sartlar:', 14, y); y += 4;
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    const sl = doc.splitTextToSize(t.sartlar, 182); doc.text(sl, 14, y); y += 4 * sl.length;
  }

  // Footer
  const ph = doc.internal.pageSize.height;
  doc.setFontSize(7); doc.setTextColor(140,140,140);
  doc.text('Bu teklif belirtilen gecerlilik suresi boyunca gecerlidir. Fleetly Filo Yonetim Sistemi ile olusturulmustur.', 105, ph - 8, { align: 'center' });

  doc.save('Teklif_' + (t.teklif_no || t.id) + '_' + (t.musteri_adi || 'musteri').replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
  showToast('PDF indirildi ✓', 'success');
}

/* --- Excel export --- */
async function downloadTekliflerExcel() {
  if (!teklifData || !teklifData.length) { showToast('İndirilecek teklif yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    const XL = await _loadXLSX();
    const WB = XL.utils.book_new();
    const fmtD = d => d ? d.split('-').reverse().join('.') : '—';
    const rows = [['Teklif No','Tarih','Müşteri','Vergi','Kalkış','Teslim','Konteyner','Adet','Tonaj','Yük','Km','Maliyet','Kâr %','Ara','KDV %','KDV','Genel','Para','Durum','Son Geç.','Ödeme','Notlar']];
    teklifData.forEach(t => {
      rows.push([
        t.teklif_no || '',
        fmtD(t.teklif_tarih),
        t.musteri_adi || '',
        t.musteri_vergi || '',
        t.kalkis_yeri || '',
        t.teslim_yeri || '',
        t.konteyner_tip || '',
        t.konteyner_adet || '',
        t.tonaj || '',
        t.yuk_cinsi || '',
        t.tahmini_km || '',
        t.maliyet_toplam || 0,
        t.kar_marji_pct || 0,
        t.ara_toplam || 0,
        t.kdv_orani || 0,
        t.kdv_tutar || 0,
        t.genel_toplam || 0,
        t.para_birimi || 'TL',
        t.durum || '',
        fmtD(t.son_gecerlilik),
        t.odeme_kosul || '',
        t.notlar || ''
      ]);
    });
    const ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:16},{wch:11},{wch:22},{wch:14},{wch:16},{wch:16},{wch:12},{wch:7},{wch:8},{wch:16},{wch:9},{wch:12},{wch:9},{wch:12},{wch:8},{wch:11},{wch:12},{wch:7},{wch:14},{wch:11},{wch:16},{wch:28}];
    XL.utils.book_append_sheet(WB, ws, 'Teklifler');

    // Kalemler ayrıntı sayfası
    const kalRows = [['Teklif No','Müşteri','Tip','Açıklama','Birim','Miktar','Birim Fiyat','Tutar']];
    teklifData.forEach(t => {
      (t.kalemler || []).forEach(k => {
        kalRows.push([
          t.teklif_no || '',
          t.musteri_adi || '',
          k.tip || '',
          k.aciklama || '',
          k.birim || '',
          k.miktar || 0,
          k.birim_fiyat || 0,
          k.tutar || 0
        ]);
      });
    });
    if (kalRows.length > 1) {
      const ws2 = XL.utils.aoa_to_sheet(kalRows);
      ws2['!cols'] = [{wch:16},{wch:22},{wch:10},{wch:36},{wch:9},{wch:9},{wch:12},{wch:12}];
      XL.utils.book_append_sheet(WB, ws2, 'Kalemler');
    }
    XL.writeFile(WB, 'teklifler_' + new Date().toISOString().slice(0,10) + '.xlsx');
    showToast('Excel indirildi ✓', 'success');
  } catch (err) {
    console.error(err); showToast('Excel hatası: ' + err.message, 'error');
  }
}

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
    _filteredVehicles().map(v => _aracSecimOption(v)).join('');
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

/* ── Yakıt Excel (detaylı, 5 sayfa) ── */
async function downloadFuelExcel() {
  var allE=[];
  Object.entries(fuelData).forEach(function(kv){ kv[1].forEach(function(e){ allE.push(Object.assign({},e,{_vid:kv[0]})); }); });
  if (!allE.length) { showToast('İndirilecek yakıt kaydı yok.', 'error'); return; }
  showToast('Excel hazırlanıyor…', 'info');
  try {
    var XL = await _loadXLSX();
    var WB = XL.utils.book_new();
    var pm={}, sofMap={};
    vehicles.forEach(function(v){pm[v.id]=v.plaka||v.id; sofMap[v.id]=v.sofor||'';});
    var fmtD = function(d){ return d ? d.split('-').reverse().join('.') : '—'; };

    // --- Sayfa 1: Detaylı kayıtlar ---
    var rows=[['Araç Plakası','Tarih','Şoför','Km','Litre','Birim Fiyat (₺)','Toplam (₺)','Yakıt Türü','İstasyon','Ödeme','Fiş No','Not','Anomali']];
    allE.sort(function(a,b){return (b.tarih||'').localeCompare(a.tarih||'');}).forEach(function(e){
      var t=(e.fiyat&&e.litre)?+(e.fiyat*e.litre).toFixed(2):'';
      var sof = e.sofor || sofMap[e._vid] || '';
      rows.push([
        pm[e._vid]||e._vid, fmtD(e.tarih), sof, e.km||'', e.litre||'', e.fiyat||'', t,
        e.yakitTuru||'', e.istasyon||'', e.odemeTipi||'', e.fisNo||'', e.not||'', e.anomaliFlag||''
      ]);
    });
    var ws = XL.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:14},{wch:12},{wch:18},{wch:10},{wch:10},{wch:14},{wch:14},{wch:12},{wch:18},{wch:14},{wch:14},{wch:22},{wch:20}];
    ws['!autofilter'] = { ref: XL.utils.encode_range({s:{r:0,c:0}, e:{r:0, c:12}}) };
    XL.utils.book_append_sheet(WB, ws, 'Detay Kayıtlar');

    // --- Sayfa 2: Araç Özeti ---
    var ar=[['Araç Plakası','Dolum Sayısı','Toplam Litre','Toplam Maliyet (₺)','Ort. ₺/L','İlk Km','Son Km','Toplam Km','Ort. L/100km']];
    Object.entries(fuelData).forEach(function(kv){
      var en=kv[1]; if(!en.length)return;
      var sorted = en.slice().sort(function(a,b){ return a.km - b.km; });
      var lt=en.reduce(function(a,e){return a+(e.litre||0);},0);
      var tt=en.reduce(function(a,e){return a+(e.fiyat?e.fiyat*e.litre:0);},0);
      var prices=en.filter(function(e){return e.fiyat>0;}).map(function(e){return e.fiyat;});
      var ortP = prices.length ? prices.reduce(function(a,b){return a+b;},0)/prices.length : 0;
      var ilk=sorted[0].km, son=sorted[sorted.length-1].km;
      var kmR=son-ilk;
      var usedL = sorted.slice(1).reduce(function(a,e){return a+(e.litre||0);},0);
      var avgC = (kmR > 0 && sorted.length >= 2) ? (usedL/kmR)*100 : null;
      ar.push([pm[kv[0]]||kv[0], en.length, +lt.toFixed(2), +tt.toFixed(2), +ortP.toFixed(2), ilk, son, kmR, avgC !== null ? +avgC.toFixed(2) : '']);
    });
    var ws2 = XL.utils.aoa_to_sheet(ar);
    ws2['!cols'] = [{wch:14},{wch:14},{wch:14},{wch:18},{wch:12},{wch:12},{wch:12},{wch:12},{wch:14}];
    XL.utils.book_append_sheet(WB, ws2, 'Araç Özeti');

    // --- Sayfa 3: Şoför Özeti ---
    var sofBy = {};
    allE.forEach(function(e){
      var key = (e.sofor || sofMap[e._vid] || '— Bilinmeyen —').trim() || '— Bilinmeyen —';
      if(!sofBy[key]) sofBy[key] = {n:0, l:0, t:0, p:[]};
      sofBy[key].n++;
      sofBy[key].l += (e.litre||0);
      sofBy[key].t += (e.litre||0)*(e.fiyat||0);
      if (e.fiyat > 0) sofBy[key].p.push(e.fiyat);
    });
    var sofR = [['Şoför','Dolum','Toplam Litre','Toplam Maliyet (₺)','Ort. ₺/L']];
    Object.entries(sofBy).sort(function(a,b){return b[1].t - a[1].t;}).forEach(function(kv){
      var v = kv[1];
      var op = v.p.length ? v.p.reduce(function(a,b){return a+b;},0)/v.p.length : 0;
      sofR.push([kv[0], v.n, +v.l.toFixed(2), +v.t.toFixed(2), +op.toFixed(2)]);
    });
    var ws3 = XL.utils.aoa_to_sheet(sofR);
    ws3['!cols'] = [{wch:22},{wch:10},{wch:14},{wch:18},{wch:12}];
    XL.utils.book_append_sheet(WB, ws3, 'Şoför Özeti');

    // --- Sayfa 4: İstasyon Özeti ---
    var istBy = {};
    allE.forEach(function(e){
      var key = (e.istasyon || '').trim() || '— Belirtilmemiş —';
      if(!istBy[key]) istBy[key] = {n:0, l:0, t:0, p:[]};
      istBy[key].n++;
      istBy[key].l += (e.litre||0);
      istBy[key].t += (e.litre||0)*(e.fiyat||0);
      if (e.fiyat > 0) istBy[key].p.push(e.fiyat);
    });
    var istR = [['İstasyon','Dolum','Toplam Litre','Toplam Maliyet (₺)','Ort. ₺/L']];
    Object.entries(istBy).sort(function(a,b){return b[1].l - a[1].l;}).forEach(function(kv){
      var v = kv[1];
      var op = v.p.length ? v.p.reduce(function(a,b){return a+b;},0)/v.p.length : 0;
      istR.push([kv[0], v.n, +v.l.toFixed(2), +v.t.toFixed(2), +op.toFixed(2)]);
    });
    var ws4 = XL.utils.aoa_to_sheet(istR);
    ws4['!cols'] = [{wch:22},{wch:10},{wch:14},{wch:18},{wch:12}];
    XL.utils.book_append_sheet(WB, ws4, 'İstasyon Özeti');

    // --- Sayfa 5: Aylık Pivot ---
    var ayBy = {};
    allE.forEach(function(e){
      if (!e.tarih) return;
      var k = e.tarih.slice(0,7);
      if (!ayBy[k]) ayBy[k] = {n:0, l:0, t:0};
      ayBy[k].n++;
      ayBy[k].l += (e.litre||0);
      ayBy[k].t += (e.litre||0)*(e.fiyat||0);
    });
    var ayR = [['Ay','Dolum','Toplam Litre','Toplam Maliyet (₺)','Ort. ₺/L']];
    Object.entries(ayBy).sort(function(a,b){return a[0].localeCompare(b[0]);}).forEach(function(kv){
      var v = kv[1];
      var op = v.l > 0 ? v.t/v.l : 0;
      ayR.push([kv[0], v.n, +v.l.toFixed(2), +v.t.toFixed(2), +op.toFixed(2)]);
    });
    var ws5 = XL.utils.aoa_to_sheet(ayR);
    ws5['!cols'] = [{wch:12},{wch:10},{wch:14},{wch:18},{wch:12}];
    XL.utils.book_append_sheet(WB, ws5, 'Aylık Pivot');

    // --- Sayfa 6: Anomaliler ---
    var anomR = [['Araç','Tarih','Şoför','Litre','Km','₺/L','Sorun']];
    vehicles.forEach(function(v){
      var en = (fuelData[v.id]||[]).slice().sort(function(a,b){return new Date(a.tarih)-new Date(b.tarih) || a.km-b.km;});
      en.forEach(function(e, i){
        var problems = [];
        if (i > 0 && e.km < en[i-1].km) problems.push('Km geri gitti');
        if (i > 0 && e.tarih === en[i-1].tarih) problems.push('Aynı gün çift dolum');
        if (i > 0 && en[i-1].km < e.km) {
          var cons = (e.litre / (e.km - en[i-1].km)) * 100;
          if (cons > 60) problems.push('Yüksek tüketim ' + cons.toFixed(1));
        }
        if (e.fiyat > 0 && (e.fiyat < 5 || e.fiyat > 150)) problems.push('Anormal fiyat');
        if (e.litre > 500) problems.push('Yüksek litre');
        if (problems.length) {
          anomR.push([v.plaka, fmtD(e.tarih), e.sofor || v.sofor || '—', e.litre, e.km, e.fiyat||'', problems.join(' · ')]);
        }
      });
    });
    if (anomR.length === 1) anomR.push(['— Anomali bulunamadı —','','','','','','']);
    var ws6 = XL.utils.aoa_to_sheet(anomR);
    ws6['!cols'] = [{wch:14},{wch:12},{wch:18},{wch:10},{wch:12},{wch:10},{wch:32}];
    XL.utils.book_append_sheet(WB, ws6, 'Anomaliler');

    XL.writeFile(WB, 'yakit_raporu_'+new Date().toISOString().slice(0,10)+'.xlsx');
    showToast('Excel indirildi ✓ (6 sayfa)', 'success');
  } catch(err){ console.error(err); showToast('Excel hatası: '+err.message, 'error'); }
}

/* ══════════════════════════════════════════════════════════════
   İŞ KÂRLILIK PDF — Sefer bazlı gelir - yakıt = net kâr
══════════════════════════════════════════════════════════════ */
async function downloadIsKarlilikPDF() {
  try {
    if (typeof jspdf === 'undefined') { showToast('PDF kütüphanesi yüklenemedi', 'error'); return; }
    const { jsPDF } = jspdf;
    const rows = _computeSeferYakitRows();
    if (!rows.length) { showToast('Kayıtlı sefer yok', 'error'); return; }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();

    // Başlık bandı
    doc.setFillColor(232, 82, 26);
    doc.rect(0, 0, W, 60, 'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold'); doc.setFontSize(18);
    doc.text('IS KARLILIK RAPORU', 30, 28);
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text('Sefer bazli gelir - yakit maliyeti = net kar', 30, 46);
    doc.setFontSize(9);
    const today = new Date().toLocaleDateString('tr-TR');
    doc.text(today, W - 30, 28, { align: 'right' });
    doc.text((currentFirmaAdi || 'Fleetly') + '', W - 30, 46, { align: 'right' });

    // KPI satırı
    const totSefer = rows.length;
    const totKm    = rows.reduce((a,r)=>a+(r.km||0), 0);
    const totLt    = rows.reduce((a,r)=>a+(r.litre||0), 0);
    const totTl    = rows.reduce((a,r)=>a+(r.tl||0), 0);
    const totCiro  = rows.reduce((a,r)=>a+(r.ucret||0), 0);
    const totKar   = totCiro > 0 ? totCiro - totTl : 0;
    const marj     = totCiro > 0 ? (totKar / totCiro) * 100 : 0;

    let y = 85;
    doc.setTextColor(15,23,42);
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text('OZET GOSTERGELER', 30, y);
    y += 10;
    const kpis = [
      { lbl: 'Toplam Sefer', val: totSefer.toString(), color: [59,130,246] },
      { lbl: 'Toplam Km',    val: totKm.toFixed(0) + ' km', color: [232,82,26] },
      { lbl: 'Yakit (L)',    val: totLt.toFixed(0) + ' L', color: [34,211,238] },
      { lbl: 'Yakit Maliyeti', val: 'TL ' + totTl.toLocaleString('tr-TR'), color: [245,158,11] },
      { lbl: 'Toplam Gelir', val: 'TL ' + totCiro.toLocaleString('tr-TR'), color: [59,130,246] },
      { lbl: 'Net Kar',      val: 'TL ' + totKar.toLocaleString('tr-TR'), color: totKar >= 0 ? [34,197,94] : [239,68,68] },
      { lbl: 'Marj',         val: '%' + marj.toFixed(1), color: totKar >= 0 ? [34,197,94] : [239,68,68] },
    ];
    const kpiW = (W - 60) / kpis.length;
    kpis.forEach((k, i) => {
      const x = 30 + i * kpiW;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, kpiW - 8, 48, 5, 5, 'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.setTextColor(100,116,139);
      doc.text(k.lbl.toUpperCase(), x + 8, y + 14);
      doc.setFont('helvetica','bold'); doc.setFontSize(13);
      doc.setTextColor(k.color[0], k.color[1], k.color[2]);
      doc.text(k.val, x + 8, y + 34);
    });
    y += 60;

    // Detay tablo
    doc.setTextColor(15,23,42);
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text('SEFER DETAYLARI', 30, y);
    y += 8;

    const headers = ['Tarih','Arac','Sofor','Rota','Km','Litre','Yakit TL','TL/km','Gelir','Net Kar','Marj'];
    const cw      = [55, 60, 70, 175, 40, 45, 65, 45, 65, 70, 45];
    const startX  = 30;
    doc.setFillColor(232, 82, 26);
    doc.rect(startX, y, cw.reduce((a,b)=>a+b,0), 20, 'F');
    doc.setTextColor(255,255,255); doc.setFontSize(9);
    let cx = startX + 5;
    headers.forEach((h, i) => { doc.text(h, cx, y + 13); cx += cw[i]; });
    y += 20;

    const sorted = rows.slice().sort((a,b) => (b.tarih||'').localeCompare(a.tarih||''));
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(30,41,59);
    sorted.forEach((r, idx) => {
      if (y > 540) {
        doc.addPage();
        y = 40;
        doc.setFillColor(232, 82, 26);
        doc.rect(startX, y, cw.reduce((a,b)=>a+b,0), 20, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9);
        let cxh = startX + 5;
        headers.forEach((h, i) => { doc.text(h, cxh, y + 13); cxh += cw[i]; });
        y += 20;
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(30,41,59);
      }
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(startX, y, cw.reduce((a,b)=>a+b,0), 18, 'F');
      }
      const cells = [
        r.tarih || '-',
        r.plaka || '-',
        (r.sofor || '-').slice(0, 15),
        (r.rota  || '-').slice(0, 40),
        r.km ? r.km.toFixed(0) : '-',
        r.litre ? r.litre.toFixed(1) : '-',
        r.tl ? r.tl.toLocaleString('tr-TR') : '-',
        (r.km > 0 && r.tl > 0) ? (r.tl / r.km).toFixed(2) : '-',
        r.ucret ? r.ucret.toLocaleString('tr-TR') : '-',
        (r.kar == null) ? '-' : r.kar.toLocaleString('tr-TR'),
        (r.marj == null) ? '-' : '%' + r.marj.toFixed(1),
      ];
      let cellX = startX + 5;
      cells.forEach((c, i) => {
        const val = String(c);
        // Net Kar + Marj renkli
        if (i === 9 || i === 10) {
          if (r.kar != null) {
            if (r.kar >= 0) doc.setTextColor(34,197,94);
            else doc.setTextColor(239,68,68);
          } else doc.setTextColor(100,116,139);
        } else doc.setTextColor(30,41,59);
        doc.text(val, cellX, y + 12);
        cellX += cw[i];
      });
      y += 18;
    });

    doc.save('is-karlilik-raporu-' + new Date().toISOString().slice(0,10) + '.pdf');
    showToast('Kârlılık PDF indirildi ✓', 'success');
  } catch(err) { console.error(err); showToast('PDF hatası: ' + err.message, 'error'); }
}

/* ══════════════════════════════════════════════════════════════
   İŞ KÂRLILIK EXCEL — Detaylı sefer + iş emri analizi
══════════════════════════════════════════════════════════════ */
async function downloadIsKarlilikExcel() {
  try {
    if (typeof XLSX === 'undefined') {
      // dinamik yükle
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const rows = _computeSeferYakitRows();
    if (!rows.length) { showToast('Kayıtlı sefer yok', 'error'); return; }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Sefer bazlı kârlılık
    const sef = rows.map(r => ({
      'Tarih'      : r.tarih || '',
      'Araç'       : r.plaka || '',
      'Şoför'      : r.sofor || '',
      'Kalkış→Varış': r.rota || '',
      'Km'         : r.km || 0,
      'Litre'      : r.litre || 0,
      'Yakıt ₺'    : r.tl || 0,
      '₺/km'       : (r.km > 0 && r.tl > 0) ? +(r.tl / r.km).toFixed(2) : 0,
      'L/100km'    : (r.km > 0 && r.litre > 0) ? +((r.litre * 100) / r.km).toFixed(2) : 0,
      'Gelir ₺'    : r.ucret || 0,
      'Net Kâr ₺'  : r.kar != null ? r.kar : '',
      'Marj %'     : r.marj != null ? +r.marj.toFixed(2) : '',
      'Kaynak'     : r.note || 'Km aralığı eşleşmesi',
    }));
    const ws1 = XLSX.utils.json_to_sheet(sef);
    XLSX.utils.book_append_sheet(wb, ws1, 'Sefer Kârlılık');

    // Sheet 2: Araç bazlı özet
    const byVeh = {};
    rows.forEach(r => {
      const k = r.plaka || '—';
      if (!byVeh[k]) byVeh[k] = { plaka: k, sefer: 0, km: 0, litre: 0, tl: 0, ciro: 0 };
      byVeh[k].sefer += 1;
      byVeh[k].km    += r.km || 0;
      byVeh[k].litre += r.litre || 0;
      byVeh[k].tl    += r.tl || 0;
      byVeh[k].ciro  += r.ucret || 0;
    });
    const veh = Object.values(byVeh).map(v => ({
      'Araç'       : v.plaka,
      'Sefer'      : v.sefer,
      'Toplam Km'  : +v.km.toFixed(0),
      'Toplam Litre': +v.litre.toFixed(1),
      'Yakıt ₺'    : +v.tl.toFixed(0),
      'Gelir ₺'    : +v.ciro.toFixed(0),
      'Net Kâr ₺'  : +(v.ciro - v.tl).toFixed(0),
      'Marj %'     : v.ciro > 0 ? +(((v.ciro - v.tl) / v.ciro) * 100).toFixed(2) : 0,
      '₺/km'       : v.km > 0 ? +(v.tl / v.km).toFixed(2) : 0,
    }));
    const ws2 = XLSX.utils.json_to_sheet(veh);
    XLSX.utils.book_append_sheet(wb, ws2, 'Araç Bazlı');

    // Sheet 3: Şoför bazlı özet
    const bySof = {};
    rows.forEach(r => {
      const k = r.sofor || '— Bilinmeyen —';
      if (!bySof[k]) bySof[k] = { sofor: k, sefer: 0, km: 0, litre: 0, tl: 0, ciro: 0 };
      bySof[k].sefer += 1;
      bySof[k].km    += r.km || 0;
      bySof[k].litre += r.litre || 0;
      bySof[k].tl    += r.tl || 0;
      bySof[k].ciro  += r.ucret || 0;
    });
    const sof = Object.values(bySof).map(v => ({
      'Şoför'      : v.sofor,
      'Sefer'      : v.sefer,
      'Toplam Km'  : +v.km.toFixed(0),
      'Yakıt ₺'    : +v.tl.toFixed(0),
      'Gelir ₺'    : +v.ciro.toFixed(0),
      'Net Kâr ₺'  : +(v.ciro - v.tl).toFixed(0),
      'L/100km'    : v.km > 0 ? +((v.litre * 100) / v.km).toFixed(2) : 0,
    }));
    const ws3 = XLSX.utils.json_to_sheet(sof);
    XLSX.utils.book_append_sheet(wb, ws3, 'Şoför Bazlı');

    // Sheet 4: İş Emri kârlılık (baslangic_km/bitis_km dolu olanlar)
    const isRows = (isEmirleri || [])
      .filter(e => e.baslangic_km != null && e.bitis_km != null && e.bitis_km > e.baslangic_km)
      .map(e => {
        const veh = vehicles.find(v => v.plaka === e.arac_plaka);
        const r = veh ? calcFuelForKmRange(veh.id, e.baslangic_km, e.bitis_km) : { litre: 0, tl: 0, count: 0 };
        const bagli = seferData.find(s => s._opsId === e.id || s._opsId === e._dbId);
        const ucret = +(bagli?.ucret || 0);
        const km    = e.bitis_km - e.baslangic_km;
        const kar   = ucret > 0 ? ucret - r.tl : null;
        return {
          'İş Emri'    : e.konteyner_no || ('#' + (e._dbId ?? e.id)),
          'Müşteri'    : e.musteri_adi || '',
          'Araç'       : e.arac_plaka || '',
          'Şoför'      : e.sofor || '',
          'Rota'       : (e.yukle_yeri || '') + ' → ' + (e.teslim_yeri || ''),
          'Başlangıç Km': e.baslangic_km,
          'Bitiş Km'   : e.bitis_km,
          'Katedilen Km': km,
          'Litre'      : r.litre,
          'Yakıt ₺'    : r.tl,
          'Gelir ₺'    : ucret,
          'Net Kâr ₺'  : kar,
          'Marj %'     : (ucret > 0 && kar != null) ? +((kar / ucret) * 100).toFixed(2) : '',
          'Durum'      : e.durum || '',
        };
      });
    const ws4 = XLSX.utils.json_to_sheet(isRows);
    XLSX.utils.book_append_sheet(wb, ws4, 'İş Emri Kârlılık');

    XLSX.writeFile(wb, 'is-karlilik-' + new Date().toISOString().slice(0,10) + '.xlsx');
    showToast('Excel indirildi ✓ (4 sayfa)', 'success');
  } catch(err) { console.error(err); showToast('Excel hatası: ' + err.message, 'error'); }
}

/* ── Aylık Yönetici Raporu (PDF) ── */
async function downloadYoneticiRaporu() {
  var ay = document.getElementById('yonetici-rapor-ay')?.value;
  if (!ay) {
    var d = new Date();
    d.setMonth(d.getMonth() - 1);
    ay = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }
  var allE = [];
  Object.entries(fuelData).forEach(function(kv){
    kv[1].forEach(function(e){
      if (e.tarih && e.tarih.startsWith(ay)) allE.push(Object.assign({}, e, {_vid: kv[0]}));
    });
  });
  if (!allE.length) { showToast('Seçili ayda (' + ay + ') yakıt kaydı yok.', 'error'); return; }
  showToast('Yönetici raporu hazırlanıyor…', 'info');

  var pm = {}, sofMap = {};
  vehicles.forEach(function(v){ pm[v.id] = v.plaka || v.id; sofMap[v.id] = v.sofor || ''; });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, ML = 14, MR = 14, CW = PW - ML - MR;
  const C = {
    bg:[8,12,16], surface:[17,24,32], surface2:[24,32,44], border:[37,47,62],
    accent:[249,115,22], text:[226,234,243], text2:[168,184,204], muted:[82,96,112],
    green:[34,197,94], yellow:[245,158,11], red:[239,68,68], blue:[56,189,248],
    purple:[167,139,250], white:[255,255,255],
  };
  function _tr(s) {
    if (!s) return '';
    return String(s).replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G')
      .replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ö/g,'o').replace(/Ö/g,'O')
      .replace(/ç/g,'c').replace(/Ç/g,'C').replace(/ı/g,'i').replace(/İ/g,'I');
  }
  function sf(c){doc.setFillColor(...c);} function st(c){doc.setTextColor(...c);}
  function rc(x,y,w,h,s='F'){doc.rect(x,y,w,h,s);} function rr(x,y,w,h,r,s='F'){doc.roundedRect(x,y,w,h,r,r,s);}
  let pg = 1;
  function footer() {
    st(C.muted); doc.setFontSize(8);
    doc.text(_tr('Aylik Yonetici Raporu | ') + ay, ML, PH-8);
    doc.text(_tr('Sayfa ') + pg, PW-MR, PH-8, {align:'right'});
    doc.text(new Date().toLocaleDateString('tr-TR'), PW/2, PH-8, {align:'center'});
  }
  function newPage() { footer(); doc.addPage(); pg++; sf(C.bg); rc(0,0,PW,PH); }

  // --- Kapak ---
  sf(C.bg); rc(0,0,PW,PH);
  sf(C.surface); rc(0,0,PW,55);
  sf(C.purple); rc(0,0,4,55);
  st(C.white); doc.setFontSize(22); doc.setFont('helvetica','bold');
  doc.text(_tr('AYLIK YAKIT YONETICI RAPORU'), ML, 22);
  doc.setFontSize(14); doc.setFont('helvetica','normal'); st(C.text2);
  const [yy, mm] = ay.split('-');
  const ayAd = new Date(yy, mm-1, 1).toLocaleDateString('tr-TR', {month:'long', year:'numeric'});
  doc.text(_tr(ayAd), ML, 32);
  sf(C.surface2); rr(PW-ML-62, 14, 62, 28, 3);
  st(C.purple); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text(_tr('FIRMA SAHIBI ICIN'), PW-MR-31, 24, {align:'center'});
  doc.setFontSize(7); st(C.muted); doc.setFont('helvetica','normal');
  doc.text(_tr('Gizli / Ic Kullanim'), PW-MR-31, 32, {align:'center'});

  let y = 68;

  // --- Üst seviye KPI kartları ---
  const totalL = allE.reduce(function(s,e){return s+(e.litre||0);},0);
  const totalTL = allE.reduce(function(s,e){return s+(e.litre||0)*(e.fiyat||0);},0);
  const prices = allE.filter(function(e){return e.fiyat>0;}).map(function(e){return e.fiyat;});
  const ortP = prices.length ? prices.reduce(function(a,b){return a+b;},0)/prices.length : 0;
  const dolumCnt = allE.length;

  // Önceki ay
  const prevD = new Date(parseInt(yy), parseInt(mm)-2, 1);
  const prevK = prevD.getFullYear() + '-' + String(prevD.getMonth()+1).padStart(2,'0');
  let prevTL = 0, prevL = 0;
  Object.values(fuelData).forEach(function(arr){
    arr.forEach(function(e){
      if (e.tarih && e.tarih.startsWith(prevK)) {
        prevTL += (e.litre||0)*(e.fiyat||0);
        prevL += (e.litre||0);
      }
    });
  });
  const tlDelta = prevTL > 0 ? ((totalTL - prevTL) / prevTL * 100) : null;
  const lDelta  = prevL > 0 ? ((totalL - prevL) / prevL * 100) : null;

  const cards = [
    {l:'Toplam Gider', v: totalTL.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' TL', c:C.green},
    {l:'Toplam Litre', v: totalL.toLocaleString('tr-TR',{maximumFractionDigits:1}) + ' L', c:C.accent},
    {l:'Dolum Sayisi', v: dolumCnt + ' dolum', c:C.blue},
    {l:'Ort. Birim Fiyat', v: ortP > 0 ? ortP.toFixed(2) + ' TL/L' : '--', c:C.purple},
  ];
  const cW = (CW - 9) / 4;
  cards.forEach(function(card, i) {
    const cx = ML + i * (cW + 3);
    sf(C.surface); rr(cx, y, cW, 26, 3);
    sf(card.c); rr(cx, y, 3, 26, 1);
    st(card.c); doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text(card.v, cx+cW/2, y+13, {align:'center'});
    st(C.muted); doc.setFontSize(7); doc.setFont('helvetica','normal');
    doc.text(_tr(card.l).toUpperCase(), cx+cW/2, y+20, {align:'center'});
  });
  y += 34;

  // --- Önceki aya göre karşılaştırma ---
  sf(C.surface); rr(ML, y, CW, 22, 3);
  st(C.purple); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(_tr('Onceki Aya Gore Karsilastirma (' + prevK + ')'), ML+5, y+7);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); st(C.text2);
  let cmpTxt = '';
  if (tlDelta !== null) {
    const arr = tlDelta >= 0 ? '^' : 'v';
    const clr = Math.abs(tlDelta) < 5 ? C.yellow : (tlDelta > 0 ? C.red : C.green);
    st(clr); doc.setFont('helvetica','bold');
    doc.text(_tr('Maliyet: ' + arr + ' %' + Math.abs(tlDelta).toFixed(1)) + '  (' + prevTL.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' TL -> ' + totalTL.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' TL)', ML+5, y+14);
  } else {
    st(C.muted); doc.text(_tr('Onceki ay verisi yok.'), ML+5, y+14);
  }
  if (lDelta !== null) {
    const arr2 = lDelta >= 0 ? '^' : 'v';
    const clr2 = Math.abs(lDelta) < 5 ? C.yellow : (lDelta > 0 ? C.red : C.green);
    st(clr2); doc.setFont('helvetica','bold');
    doc.text(_tr('Litre: ' + arr2 + ' %' + Math.abs(lDelta).toFixed(1)), ML+CW/2+5, y+14);
  }
  y += 28;

  // --- En çok yakıt yakan 5 araç ---
  const byVeh = {};
  allE.forEach(function(e){
    const k = pm[e._vid] || e._vid;
    if (!byVeh[k]) byVeh[k] = {l:0, t:0, n:0};
    byVeh[k].l += (e.litre||0);
    byVeh[k].t += (e.litre||0)*(e.fiyat||0);
    byVeh[k].n++;
  });
  const topVeh = Object.entries(byVeh).sort(function(a,b){return b[1].t - a[1].t;}).slice(0,5);
  st(C.accent); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(_tr('En Cok Yakit Gideri Olan 5 Arac'), ML, y); y += 6;
  sf(C.surface2); rc(ML, y, CW, 7);
  st(C.muted); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(_tr('PLAKA'), ML+3, y+4.8);
  doc.text(_tr('DOLUM'), ML+55, y+4.8);
  doc.text(_tr('LITRE'), ML+80, y+4.8);
  doc.text(_tr('MALIYET (TL)'), ML+115, y+4.8);
  doc.text(_tr('PAY %'), ML+165, y+4.8);
  y += 8;
  topVeh.forEach(function(kv, i){
    sf(i%2===0?C.surface:C.bg); rc(ML, y, CW, 7);
    const pct = totalTL > 0 ? (kv[1].t / totalTL * 100).toFixed(1) : '0.0';
    st(C.text); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text(_tr(kv[0]), ML+3, y+4.8);
    doc.setFont('helvetica','normal'); st(C.text2);
    doc.text(String(kv[1].n), ML+55, y+4.8);
    doc.text(kv[1].l.toLocaleString('tr-TR',{maximumFractionDigits:1}), ML+80, y+4.8);
    st(C.green); doc.setFont('helvetica','bold');
    doc.text(kv[1].t.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+115, y+4.8);
    st(C.purple);
    doc.text('%' + pct, ML+165, y+4.8);
    y += 7;
  });
  y += 6;
  if (y > PH - 100) { newPage(); y = 15; }

  // --- En çok yakıt yakan 5 şoför ---
  const bySof = {};
  allE.forEach(function(e){
    const k = (e.sofor || sofMap[e._vid] || '— Bilinmeyen —').trim() || '— Bilinmeyen —';
    if (!bySof[k]) bySof[k] = {l:0, t:0, n:0};
    bySof[k].l += (e.litre||0);
    bySof[k].t += (e.litre||0)*(e.fiyat||0);
    bySof[k].n++;
  });
  const topSof = Object.entries(bySof).sort(function(a,b){return b[1].t - a[1].t;}).slice(0,5);
  st(C.purple); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(_tr('En Cok Yakit Gideri Olan 5 Sofor'), ML, y); y += 6;
  sf(C.surface2); rc(ML, y, CW, 7);
  st(C.muted); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(_tr('SOFOR'), ML+3, y+4.8);
  doc.text(_tr('DOLUM'), ML+70, y+4.8);
  doc.text(_tr('LITRE'), ML+95, y+4.8);
  doc.text(_tr('MALIYET (TL)'), ML+125, y+4.8);
  doc.text(_tr('PAY %'), ML+170, y+4.8);
  y += 8;
  topSof.forEach(function(kv, i){
    sf(i%2===0?C.surface:C.bg); rc(ML, y, CW, 7);
    const pct = totalTL > 0 ? (kv[1].t / totalTL * 100).toFixed(1) : '0.0';
    st(C.text); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text(_tr(kv[0]), ML+3, y+4.8);
    doc.setFont('helvetica','normal'); st(C.text2);
    doc.text(String(kv[1].n), ML+70, y+4.8);
    doc.text(kv[1].l.toLocaleString('tr-TR',{maximumFractionDigits:1}), ML+95, y+4.8);
    st(C.green); doc.setFont('helvetica','bold');
    doc.text(kv[1].t.toLocaleString('tr-TR',{maximumFractionDigits:0}), ML+125, y+4.8);
    st(C.purple);
    doc.text('%' + pct, ML+170, y+4.8);
    y += 7;
  });
  y += 6;

  // --- Anomali Özeti ---
  if (y > PH - 60) { newPage(); y = 15; }
  st(C.red); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(_tr('Bu Ayda Tespit Edilen Anomaliler'), ML, y); y += 6;
  const monthAnoms = [];
  vehicles.forEach(function(v){
    const en = (fuelData[v.id]||[]).slice().sort(function(a,b){return new Date(a.tarih)-new Date(b.tarih) || a.km-b.km;});
    en.forEach(function(e, i){
      if (!e.tarih || !e.tarih.startsWith(ay)) return;
      const problems = [];
      if (i > 0 && e.km < en[i-1].km) problems.push('Km geri gitti');
      if (i > 0 && e.tarih === en[i-1].tarih) problems.push('Ayni gun cift dolum');
      if (i > 0 && en[i-1].km < e.km) {
        const cons = (e.litre / (e.km - en[i-1].km)) * 100;
        if (cons > 60) problems.push('Yuksek tuketim ' + cons.toFixed(1));
      }
      if (e.fiyat > 0 && (e.fiyat < 5 || e.fiyat > 150)) problems.push('Anormal fiyat');
      if (e.litre > 500) problems.push('Yuksek litre');
      if (problems.length) monthAnoms.push({plaka: v.plaka, tarih: e.tarih, sofor: e.sofor || v.sofor || '—', problem: problems.join(' · ')});
    });
  });
  if (monthAnoms.length === 0) {
    sf(C.surface); rr(ML, y, CW, 16, 3);
    st(C.green); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text(_tr('✓ Bu ayda anomali tespit edilmedi. Tum dolum kayitlari normal goruyor.'), ML+5, y+10);
    y += 20;
  } else {
    sf(C.surface2); rc(ML, y, CW, 7);
    st(C.muted); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
    doc.text(_tr('TARIH'), ML+3, y+4.8);
    doc.text(_tr('PLAKA'), ML+28, y+4.8);
    doc.text(_tr('SOFOR'), ML+60, y+4.8);
    doc.text(_tr('SORUN'), ML+105, y+4.8);
    y += 8;
    monthAnoms.slice(0, 20).forEach(function(a, i){
      if (y > PH - 18) { newPage(); y = 15; }
      sf(i%2===0?C.surface:C.bg); rc(ML, y, CW, 6.5);
      st(C.text2); doc.setFontSize(8); doc.setFont('helvetica','normal');
      doc.text(_tr(a.tarih.split('-').reverse().join('.')), ML+3, y+4.5);
      doc.setFont('helvetica','bold');
      doc.text(_tr(a.plaka), ML+28, y+4.5);
      doc.setFont('helvetica','normal'); st(C.muted);
      doc.text(_tr(a.sofor).slice(0,18), ML+60, y+4.5);
      st(C.red);
      doc.text(_tr(a.problem).slice(0,60), ML+105, y+4.5);
      y += 6.5;
    });
    if (monthAnoms.length > 20) {
      st(C.muted); doc.setFontSize(8); doc.setFont('helvetica','italic');
      doc.text(_tr('(... ve ' + (monthAnoms.length - 20) + ' anomali daha)'), ML, y+5);
      y += 10;
    }
  }

  // --- Yönetici Yorumları ---
  if (y > PH - 50) { newPage(); y = 15; }
  y += 4;
  st(C.accent); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(_tr('Ozet ve Oneriler'), ML, y); y += 6;
  sf(C.surface); rr(ML, y, CW, 34, 3);
  st(C.text2); doc.setFontSize(9); doc.setFont('helvetica','normal');
  let suggestion = '';
  if (tlDelta !== null && tlDelta > 10) suggestion += '• Toplam gider onceki aya gore %' + tlDelta.toFixed(1) + ' artti. Fiyat artisi veya fazladan dolum kontrol edilmeli.  \n';
  if (tlDelta !== null && tlDelta < -10) suggestion += '• Toplam gider onceki aya gore %' + Math.abs(tlDelta).toFixed(1) + ' dustu. Iyi yonde ilerleme.  \n';
  if (monthAnoms.length > 0) suggestion += '• ' + monthAnoms.length + ' anomali tespit edildi; ilgili soforlerle gorusulmeli.  \n';
  if (topVeh.length > 0) suggestion += '• En yuksek gider ' + topVeh[0][0] + ' aracinda (' + topVeh[0][1].t.toLocaleString('tr-TR',{maximumFractionDigits:0}) + ' TL).  \n';
  if (!suggestion) suggestion = '• Bu ay icin otomatik oneri bulunmadi. Manuel inceleme tavsiye edilir.';
  const lines = doc.splitTextToSize(_tr(suggestion), CW - 10);
  doc.text(lines, ML+5, y+7);

  footer();
  doc.save('yonetici_raporu_' + ay + '.pdf');
  showToast('Yönetici raporu indirildi ✓', 'success');
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
