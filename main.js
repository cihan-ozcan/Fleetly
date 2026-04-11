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
    const res = await fetch(sbUrl('araclar?select=*&order=created_at.asc'), {
      headers: sbHeaders()
    });
    if (!res.ok) throw new Error('Sunucu hatası: ' + res.status);
    const rows = await res.json();
    // Supabase satırlarını uygulama formatına dönüştür
    vehicles = rows.map(r => ({
      id      : r.id,
      plaka   : r.plaka,
      tip     : r.tip,
      esleme  : r.esleme   || '',
      sofor   : r.sofor    || '',
      telefon : r.telefon  || '',
      durum   : r.durum    || 'Aktif',
      muayene : r.muayene  || '',
      sigorta : r.sigorta  || '',
      takograf: r.takograf || '',
      notlar  : r.notlar   || '',
    }));
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
    const rows = vehicles.map(v => ({
      id      : v.id,
      user_id : user.id,
      firma_id: currentFirmaId,       // ← firma bazlı paylaşım
      plaka   : v.plaka,
      tip     : v.tip,
      esleme  : v.esleme   || null,
      sofor   : v.sofor    || null,
      telefon : v.telefon  || null,
      durum   : v.durum    || 'Aktif',
      muayene : v.muayene  || null,
      sigorta : v.sigorta  || null,
      takograf: v.takograf || null,
      notlar  : v.notlar   || null,
    }));

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

