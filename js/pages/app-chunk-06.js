/* ===================================================================
   app-chunk-06.js — app.html içinden otomatik taşındı (Phase 4, mekanik)
   Orijinal konum: 13. <script> tag'i (app.html).
   İçerik AYNEN korunur; global değişkenler, fonksiyon isimleri,
   yükleme sırası değiştirilmedi. İleride modülerleştirilecek.
   ================================================================= */

/* ================================================================
   ŞOFÖR PORTAL — Client State & Routing
   ================================================================ */

// Global state
const soforState = {
  davet         : null,   // {davet_id, firma_id, firma_adi, ad, telefon_son4, arac_id, expires_at}
  session       : null,   // Supabase auth session
  profil        : null,   // {id, ad, tel, firma_id, arac_id, plaka}
  isEmirleri    : [],
  aktifIsEmri   : null,
  konumInterval : null,
  fisFotoBlob   : null
};

// URL: #/sofor → sofor modu
function soforCheckRoute() {
  const isSofor = location.hash.startsWith('#/sofor');
  document.body.classList.toggle('sofor-mode', isSofor);
  const app = document.getElementById('sofor-app');
  if (!app) return;
  app.classList.toggle('active', isSofor);
  if (isSofor) {
    soforInit();
  }
}
window.addEventListener('hashchange', soforCheckRoute);
window.addEventListener('DOMContentLoaded', soforCheckRoute);

async function soforInit() {
  try {
    const sb = getSB();
    if (!sb) { soforStepGoster('kod'); return; }

    // Mevcut Supabase session var mı?
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      soforState.session = session;
      // Şoför mü? firma_kullanicilar'da rol=sofor olmalı
      const isSofor = await soforKullaniciMi();
      if (isSofor) {
        await soforDashboardAc();
        return;
      }
    }

    // URL'de ?kod=XXX varsa otomatik doldur
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const kodParam = qs.get('kod');
    if (kodParam) {
      const el = document.getElementById('sofor-kod');
      if (el) el.value = kodParam.toUpperCase();
    }
    soforScreenGoster('login');
    soforStepGoster('kod');
  } catch (e) {
    console.error('Sofor init hatası:', e);
    soforScreenGoster('login');
    soforStepGoster('kod');
  }
}

function soforScreenGoster(name) {
  const screens = ['login','home','konum','profil','yakit','ayarlar'];
  screens.forEach(s => {
    const el = document.getElementById('sofor-screen-' + s);
    if (el) el.style.display = (s === name ? '' : 'none');
  });
  const tabbar = document.getElementById('sofor-tabbar');
  const header = document.getElementById('sofor-top-header');
  const showChrome = (name !== 'login');
  if (tabbar) tabbar.style.display = showChrome ? '' : 'none';
  if (header) header.style.display = showChrome ? '' : 'none';

  // Aktif tab vurgusu
  document.querySelectorAll('#sofor-tabbar .sofor-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-screen') === name);
  });
  // Header başlığı
  const titles = { home:'Anasayfa', konum:'Konum', profil:'Profil', yakit:'Yakıt', ayarlar:'Ayarlar' };
  const tag = document.getElementById('sofor-hdr-screen');
  if (tag && titles[name]) tag.textContent = titles[name];
  soforState.aktifEkran = name;
}

function soforStepGoster(name) {
  ['kod','tel','otp'].forEach(s => {
    document.getElementById('sofor-step-' + s)?.classList.toggle('active', s === name);
  });
  // Hata/başarı kutularını temizle
  document.querySelectorAll('#sofor-app .sofor-error, #sofor-app .sofor-success').forEach(e => e.classList.remove('show'));
}

function soforHata(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

/* ---- ADIM 1: Davet kodu kontrol ---- */
async function soforDavetKontrol() {
  const kod = (document.getElementById('sofor-kod').value || '').trim().toUpperCase();
  if (kod.length < 6) { soforHata('sofor-err-kod', 'Geçerli bir davet kodu girin.'); return; }

  try {
    const sb = getSB();
    const { data, error } = await sb.rpc('sofor_davet_dogrula', { p_kod: kod });
    if (error) throw error;
    const rec = Array.isArray(data) ? data[0] : data;
    if (!rec) throw new Error('Kod bulunamadı veya süresi dolmuş.');

    soforState.davet = { ...rec, davet_kodu: kod };
    document.getElementById('sofor-davet-ad').textContent    = rec.ad || '—';
    document.getElementById('sofor-davet-firma').textContent = rec.firma_adi || '';
    document.getElementById('sofor-davet-tel').textContent   = rec.telefon_son4 || '';
    soforStepGoster('tel');
  } catch (err) {
    console.error(err);
    soforHata('sofor-err-kod', 'Kod geçersiz veya süresi dolmuş.');
  }
}

/* ---- ADIM 2: Telefon OTP gönder ---- */
async function soforOtpGonder() {
  const telRaw = (document.getElementById('sofor-tel').value || '').trim();
  let tel = telRaw.replace(/[^\d+]/g, '');
  if (!tel.startsWith('+')) {
    tel = tel.replace(/\D/g, '');
    if (tel.length === 10) tel = '+90' + tel;
    else if (tel.length === 11 && tel.startsWith('0')) tel = '+9' + tel;
    else if (tel.length === 12 && tel.startsWith('90')) tel = '+' + tel;
    else { soforHata('sofor-err-tel', 'Geçerli bir telefon numarası girin.'); return; }
  }

  try {
    const sb = getSB();
    const { error } = await sb.auth.signInWithOtp({
      phone: tel,
      options: { shouldCreateUser: true }
    });
    if (error) throw error;
    soforState.telefon = tel;
    document.getElementById('sofor-otp-hedef').textContent = tel;
    soforStepGoster('otp');
  } catch (err) {
    console.error(err);
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('sms') || msg.includes('provider')) {
      soforHata('sofor-err-tel', 'SMS servisi yapılandırılmamış. Yöneticinize bildirin.');
    } else {
      soforHata('sofor-err-tel', 'Kod gönderilemedi: ' + (err?.message || 'hata'));
    }
  }
}

/* ---- ADIM 3: OTP kodu doğrula + davet kabul ---- */
async function soforOtpDogrula() {
  const otp = (document.getElementById('sofor-otp').value || '').trim();
  if (otp.length < 4) { soforHata('sofor-err-otp', 'Geçerli bir kod girin.'); return; }
  const tel = soforState.telefon;
  if (!tel) { soforHata('sofor-err-otp', 'Telefon bilgisi kayıp. Baştan başlayın.'); return; }

  try {
    const sb = getSB();
    const { data, error } = await sb.auth.verifyOtp({ phone: tel, token: otp, type: 'sms' });
    if (error) throw error;
    soforState.session = data.session;

    // Davet kabul RPC — REFACTOR 2026-04-22: önce _v2, yoksa v1
    const kod = soforState.davet?.davet_kodu;
    if (kod) {
      let kabulErr;
      ({ error: kabulErr } = await sb.rpc('sofor_davet_kabul_v2', { p_kod: kod }));
      if (kabulErr && /function.*does not exist|42883/i.test(kabulErr.message || kabulErr.code || '')) {
        ({ error: kabulErr } = await sb.rpc('sofor_davet_kabul', { p_kod: kod }));
      }
      if (kabulErr) {
        console.warn('Davet kabul hatası:', kabulErr);
        // telefon uyuşmazlığı en tipik hata
        soforHata('sofor-err-otp', kabulErr.message || 'Davet kabul edilemedi.');
        return;
      }
    }

    const el = document.getElementById('sofor-suc-otp');
    el.textContent = '✓ Giriş başarılı, yönlendiriliyorsunuz…';
    el.classList.add('show');
    setTimeout(() => soforDashboardAc(), 600);
  } catch (err) {
    console.error(err);
    soforHata('sofor-err-otp', 'Kod hatalı veya süresi dolmuş.');
  }
}

/* ---- Şoför kullanıcı mı kontrolü ---- */
async function soforKullaniciMi() {
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;
    const { data, error } = await sb
      .from('firma_kullanicilar')
      .select('firma_id, rol')
      .eq('user_id', user.id)
      .eq('rol', 'sofor')
      .limit(1);
    if (error) return false;
    return !!(data && data.length);
  } catch (e) { return false; }
}

/* ---- Dashboard aç ---- */
async function soforDashboardAc() {
  soforScreenGoster('home');
  await soforProfilYukle();
  await soforIsEmirleriYukle();
}

async function soforProfilYukle(force) {
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // cache (force değilse 15 sn)
    if (!force && soforState.profil && (Date.now() - (soforState._profilTs||0)) < 15000) {
      return soforState.profil;
    }

    const { data: profil, error } = await sb
      .from('v_sofor_profil')
      .select('*')
      .limit(1)
      .maybeSingle();

    // Profil tabanı: v_sofor_profil'den gelen ya da boş obje
    const profilObj = (!error && profil) ? { ...profil } : {};

    // --- surucu_belgeler'dan eksik belge tarihlerini tamamla ---
    // Önce SECURITY DEFINER RPC ile dene (RLS bypass, server-side normalize telefon).
    // Fallback: doğrudan tablo sorgusu (telefon varyantları).
    const belgelerEksik = !profilObj.ehliyet_bitis && !profilObj.src_bitis && !profilObj.psiko_bitis;
    if (belgelerEksik) {
      try {
        let belge = null;

        // -- Strateji 1: SECURITY DEFINER RPC (en güvenilir, RLS'i bypass eder) --
        try {
          const { data: rpcSonuc, error: rpcErr } = await sb.rpc('get_sofor_belgeler_for_me');
          if (!rpcErr && rpcSonuc?.length) belge = rpcSonuc[0];
          else if (rpcErr) console.warn('get_sofor_belgeler_for_me RPC hatası:', rpcErr.message);
        } catch(rpcEx) { console.warn('get_sofor_belgeler_for_me çağrılamadı:', rpcEx); }

        // -- Strateji 2: Doğrudan tablo + firma_id + telefon varyantları --
        if (!belge && user?.id && user.phone) {
          let firmaId = null;
          const { data: fk } = await sb
            .from('firma_kullanicilar')
            .select('firma_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();
          if (fk?.firma_id) firmaId = fk.firma_id;

          const telVaryantlari = _soforTelVariantlari(user.phone);
          for (const tel of telVaryantlari) {
            const q = sb
              .from('surucu_belgeler')
              .select('ad, tel, ehliyet, src, psiko, takograf, ehliyet_bitis, src_bitis, psiko_bitis, saglik_bitis, ehliyet_no, ehliyet_sinifi')
              .eq('tel', tel)
              .limit(1)
              .maybeSingle();
            if (firmaId) q.eq('firma_id', firmaId);
            const { data: b } = await q;
            if (b) { belge = b; break; }
          }
        }

        if (belge) {
          // Yeni sütunu tercih et, yoksa eski sütuna bak
          const eh  = belge.ehliyet_bitis || belge.ehliyet  || null;
          const src = belge.src_bitis     || belge.src      || null;
          const ps  = belge.psiko_bitis   || belge.psiko    || null;
          const sg  = belge.saglik_bitis  || belge.takograf || null;
          if (eh  && !profilObj.ehliyet_bitis)  profilObj.ehliyet_bitis  = eh;
          if (src && !profilObj.src_bitis)      profilObj.src_bitis      = src;
          if (ps  && !profilObj.psiko_bitis)    profilObj.psiko_bitis    = ps;
          if (sg  && !profilObj.saglik_bitis)   profilObj.saglik_bitis   = sg;
          if (belge.ehliyet_no     && !profilObj.ehliyet_no)     profilObj.ehliyet_no     = belge.ehliyet_no;
          if (belge.ehliyet_sinifi && !profilObj.ehliyet_sinifi) profilObj.ehliyet_sinifi = belge.ehliyet_sinifi;
          if (belge.ad && !profilObj.ad) profilObj.ad = belge.ad;
          // Bulunan tarihleri sofor_profil_guncelle ile kalıcı hale getir (arka planda)
          try {
            await sb.rpc('sofor_profil_guncelle', {
              p_ehliyet_bitis  : eh  || null,
              p_src_bitis      : src || null,
              p_psiko_bitis    : ps  || null,
              p_saglik_bitis   : sg  || null,
              p_ehliyet_no     : belge.ehliyet_no     || null,
              p_ehliyet_sinifi : belge.ehliyet_sinifi || null,
            });
          } catch(syncErr) { /* RPC erişim yoksa sessizce geç */ }
        }
      } catch(belgeErr) { console.warn('surucu_belgeler erişim hatası:', belgeErr); }
    }
    // -------------------------------------------------------

    soforState.profil = profilObj;
    soforState._profilTs = Date.now();

    const ad = profilObj.ad || user.phone || 'Şoför';
    const gn = document.getElementById('sofor-greet-name'); if (gn) gn.textContent = ad;
    const pl = document.getElementById('sofor-greet-plaka');
    if (pl) {
      const plakaTxt = profilObj.arac_plaka || profilObj.plaka;
      pl.innerHTML = plakaTxt
        ? `<span class="plaka">🚛 ${plakaTxt}</span>${profilObj.arac_tip?'<span style="font-size:11px;color:#94a3b8;margin-left:8px">'+profilObj.arac_tip+'</span>':''}`
        : '<span style="font-size:12px;color:#94a3b8">🚛 Sabit araç atanmamış — sefer bazlı</span>';
    }
    const fe = document.getElementById('sofor-greet-firma');
    if (fe) fe.textContent = profilObj.firma_adi || '';

    return soforState.profil;
  } catch (e) {
    console.error('Profil yüklenemedi:', e);
  }
}

// Şoförün telefon numarasından olası format varyantlarını üretir
function _soforTelVariantlari(rawPhone) {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (digits.length < 10) return [];
  const core = digits.slice(-10); // son 10 rakam (ülke kodu olmadan)
  return [
    '0' + core,                                                                          // "05321234567"
    '+90' + core,                                                                        // "+905321234567"
    '90' + core,                                                                         // "905321234567"
    '0' + core.slice(0,3) + ' ' + core.slice(3,6) + ' ' + core.slice(6,8) + ' ' + core.slice(8), // "0532 123 45 67"
    core.slice(0,3) + ' ' + core.slice(3,6) + ' ' + core.slice(6,8) + ' ' + core.slice(8),       // "532 123 45 67"
  ];
}

async function soforIsEmirleriYukle() {
  const list = document.getElementById('sofor-job-list');
  if (!list) return;
  list.innerHTML = '<div class="sofor-empty">Yükleniyor…</div>';

  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { soforScreenGoster('login'); return; }

    const bugun = new Date();
    const d0 = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()).toISOString();

    const FIELDS = 'id, referans_no, konteyner_no, yukle_yeri, teslim_yeri, durum, kont_tip, musteri_adi, atama_zamani, created_at, fotograflar';
    const DURUMLAR = ['Bekliyor','Yolda','Fabrikada','Teslim Edildi'];

    // user.phone: Supabase'in sakladığı E.164 formatı (+905321234567)
    // Bunu olası tüm formatlara çevirerek OR filtresi oluştur
    const telVaryantlari = _soforTelVariantlari(user.phone || '');
    const telOrParcalari = telVaryantlari.map(t => `sofor_tel.eq.${t}`).join(',');
    const orFiltre = `sofor_user_id.eq.${user.id}${telOrParcalari ? ',' + telOrParcalari : ''}`;

    const { data, error } = await sb
      .from('is_emirleri')
      .select(FIELDS)
      .or(orFiltre)
      .in('durum', DURUMLAR)
      .order('atama_zamani', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    // sofor_user_id boş olanları arka planda güncelle (bir daha arama gerekmesin)
    (data || []).filter(e => !e.sofor_user_id).forEach(e => {
      (async () => { try { await sb.from('is_emirleri').update({ sofor_user_id: user.id }).eq('id', e.id); } catch(_){} })();
    });

    soforState.isEmirleri = data || [];

    // Stat
    const bugunkiler = soforState.isEmirleri.filter(e => {
      const t = e.atama_zamani || e.created_at;
      if (!t) return false;
      return t.slice(0,10) === d0.slice(0,10);
    });
    const aktifler = soforState.isEmirleri.filter(e => ['Yolda','Fabrikada'].includes(e.durum));
    document.getElementById('sofor-stat-bugun').textContent = bugunkiler.length;
    document.getElementById('sofor-stat-aktif').textContent = aktifler.length;

    if (!soforState.isEmirleri.length) {
      list.innerHTML = '<div class="sofor-empty">🎉 Atanan iş emriniz yok. İyi dinlenmeler!</div>';
      return;
    }

    list.innerHTML = soforState.isEmirleri.map(e => {
      const d = (e.durum || '').toLowerCase();
      const stCls = d.includes('yolda')   ? 'yolda'
                  : d.includes('fabrika') ? 'yolda'
                  : d.includes('teslim')  ? 'teslim'
                  : d.includes('iptal')   ? 'iptal' : 'yeni';
      return `
      <div class="sofor-job-card" onclick="soforJobAc('${e.id}')">
        <div class="top">
          <span class="ref">${e.referans_no || e.konteyner_no || e.id}</span>
          <span class="status ${stCls}">${e.durum || 'Bekliyor'}</span>
        </div>
        <div class="route">
          <span>📍 ${e.yukle_yeri || '—'}</span>
          <span class="arrow">→</span>
          <span>🏁 ${e.teslim_yeri || '—'}</span>
        </div>
        <div class="meta">
          ${e.musteri_adi ? '🏢 ' + e.musteri_adi : ''}
          ${e.kont_tip   ? '· 📦 ' + e.kont_tip : ''}
          ${e.atama_zamani ? '· 🗓 ' + new Date(e.atama_zamani).toLocaleDateString('tr-TR') : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('İş emirleri yüklenemedi:', err);
    list.innerHTML = '<div class="sofor-empty" style="color:#fca5a5">Liste yüklenemedi: ' + (err?.message || 'hata') + '</div>';
  }
}

/* ---- İş Emri Detay Drawer ---- */
function soforJobAc(id) {
  const e = soforState.isEmirleri.find(x => String(x.id) === String(id));
  if (!e) return;
  soforState.aktifIsEmri = e;
  document.getElementById('sofor-job-title').textContent = e.referans_no || e.konteyner_no || 'İş Emri';

  const body = document.getElementById('sofor-job-body');
  const actions = soforJobActionsHTML(e);

  // Navigasyon butonları — yükleme & teslim yerlerine Google Maps linki
  const navBtns = [];
  if (e.yukle_yeri) {
    navBtns.push(`<button class="sofor-big-btn sec" onclick="soforNavigate('${(e.yukle_yeri||'').replace(/'/g,"\\'")}')">🗺 Yükleme Noktasına Git</button>`);
  }
  if (e.teslim_yeri) {
    navBtns.push(`<button class="sofor-big-btn sec" onclick="soforNavigate('${(e.teslim_yeri||'').replace(/'/g,"\\'")}')">🏁 Teslim Noktasına Git</button>`);
  }

  // Fotoğraflar bölümü
  let fotolar = [];
  try {
    if (e.fotograflar) {
      fotolar = typeof e.fotograflar === 'string' ? JSON.parse(e.fotograflar) : (Array.isArray(e.fotograflar) ? e.fotograflar : []);
    }
  } catch(_) { fotolar = []; }

  const fotoHtml = `
    <div class="sofor-section-title" style="margin-top:14px">
      <span>📸 Fotoğraflar ${fotolar.length ? `<span style="background:rgba(129,140,248,.2);color:#a5b4fc;border-radius:99px;padding:1px 7px;font-size:10px;margin-left:4px;">${fotolar.length}</span>` : ''}</span>
      <button onclick="soforFotoEkleAc()" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;border-radius:8px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;">+ Fotoğraf Ekle</button>
    </div>
    ${fotolar.length ? `
    <div class="sofor-foto-grid">
      ${fotolar.map((f, i) => `
        <div class="sofor-foto-item" onclick="soforFotoGoruntule('${f.url}')">
          <img src="${f.url}" alt="${f.tip || 'Fotoğraf'}" loading="lazy">
          <div class="sofor-foto-tip">${f.tip || 'Fotoğraf'}</div>
        </div>`).join('')}
    </div>` : `<div class="sofor-foto-bos">Henüz fotoğraf eklenmedi.<br><small>Konteyner, mühür veya hasar fotoğrafı ekleyin.</small></div>`}`;

  body.innerHTML = `
    <div class="sofor-info-grid">
      <div class="sofor-info full"><div class="lbl">Durum</div><div class="val">
        <span class="sofor-doc"><span class="badge ok" style="background:rgba(129,140,248,.15);color:#818cf8">${e.durum || 'Bekliyor'}</span></span>
      </div></div>
      <div class="sofor-info"><div class="lbl">📍 Yükleme</div><div class="val">${e.yukle_yeri || '—'}</div></div>
      <div class="sofor-info"><div class="lbl">🏁 Teslim</div><div class="val">${e.teslim_yeri || '—'}</div></div>
      ${e.musteri_adi ? `<div class="sofor-info full"><div class="lbl">🏢 Müşteri</div><div class="val">${e.musteri_adi}</div></div>` : ''}
      ${e.konteyner_no ? `<div class="sofor-info"><div class="lbl">Konteyner</div><div class="val">${e.konteyner_no}</div></div>` : ''}
      ${e.kont_tip ? `<div class="sofor-info"><div class="lbl">Tip</div><div class="val">${e.kont_tip}</div></div>` : ''}
      ${e.atama_zamani ? `<div class="sofor-info full"><div class="lbl">🗓 Atama Zamanı</div><div class="val">${new Date(e.atama_zamani).toLocaleString('tr-TR')}</div></div>` : ''}
    </div>
    ${fotoHtml}
    ${navBtns.length ? `<div class="sofor-section-title" style="margin-top:14px"><span>🧭 Navigasyon</span></div><div class="sofor-action-btns">${navBtns.join('')}</div>` : ''}
    <div class="sofor-section-title" style="margin-top:14px"><span>⚡ İşlemler</span></div>
    <div class="sofor-action-btns">${actions}</div>`;
  document.getElementById('sofor-job-drawer').classList.add('open');
}

function soforNavigate(adres) {
  if (!adres) return;
  const u = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(adres)}`;
  window.open(u, '_blank');
}

/* ---- Müşteriye telefonla ulaş / problem bildir ---- */
async function soforMusteriAra() {
  const e = soforState.aktifIsEmri; if (!e) return;
  try {
    const sb = getSB();
    const { data } = await sb.from('is_emirleri')
      .select('musteri_tel, yetkili_tel, iletisim_tel')
      .eq('id', e.id).maybeSingle();
    const tel = data?.yetkili_tel || data?.iletisim_tel || data?.musteri_tel;
    if (!tel) { soforToast('Müşteri telefonu kayıtlı değil', 'err'); return; }
    window.location.href = 'tel:' + tel;
  } catch { soforToast('Bulunamadı', 'err'); }
}

async function soforProblemBildir() {
  const e = soforState.aktifIsEmri; if (!e) return;
  const mesaj = prompt('Problemi yazın (operasyon ekibine iletilecek):');
  if (!mesaj || !mesaj.trim()) return;
  try {
    const sb = getSB();
    // is_emirleri.aciklama'ya ekle (append)
    const { data: cur } = await sb.from('is_emirleri').select('aciklama').eq('id', e.id).maybeSingle();
    const eskisi = cur?.aciklama || '';
    const yeni = (eskisi ? eskisi + '\n\n' : '') + `[ŞOFÖR · ${new Date().toLocaleString('tr-TR')}] ${mesaj.trim()}`;
    const { error } = await sb.from('is_emirleri').update({ aciklama: yeni }).eq('id', e.id);
    if (error) throw error;
    soforToast('Bildirim gönderildi ✓', 'ok');
  } catch (err) {
    soforToast('Gönderilemedi: ' + (err?.message||'hata'), 'err');
  }
}

function soforJobKapat() {
  document.getElementById('sofor-job-drawer').classList.remove('open');
  soforState.aktifIsEmri = null;
  soforKonumStop();
}

function soforJobActionsHTML(e) {
  const d = (e.durum || 'Bekliyor').toLowerCase();
  const btns = [];
  // is_emirleri.durum CHECK: ('Bekliyor','Yolda','Fabrikada','Teslim Edildi','İptal')
  if (d.includes('bekliyor') || d === '') {
    btns.push(`<button class="sofor-big-btn yolda" onclick="soforDurumGuncelle('Yolda')">🚛 Yola Çıktım</button>`);
  } else if (d.includes('yolda')) {
    btns.push(`<button class="sofor-big-btn primary" onclick="soforDurumGuncelle('Fabrikada')">🏭 Fabrikadayım</button>`);
    btns.push(`<button class="sofor-big-btn teslim" onclick="soforDurumGuncelle('Teslim Edildi')">✅ Teslim Ettim</button>`);
  } else if (d.includes('fabrika')) {
    btns.push(`<button class="sofor-big-btn teslim" onclick="soforDurumGuncelle('Teslim Edildi')">✅ Teslim Ettim</button>`);
  }
  btns.push(`<button class="sofor-big-btn sec" onclick="soforYakitFisAc()">⛽ Yakıt Fişi Yükle</button>`);
  btns.push(`<button class="sofor-big-btn sec" onclick="soforMusteriAra()">📞 Müşteriyi Ara</button>`);
  btns.push(`<button class="sofor-big-btn sec" onclick="soforProblemBildir()" style="color:#fbbf24;border-color:rgba(245,158,11,.3)">⚠️ Problem Bildir</button>`);
  btns.push(`<button class="sofor-big-btn sec" onclick="soforJobKapat()">Kapat</button>`);
  return btns.join('');
}

/* ================================================================
   FOTOĞRAF YÖNETİMİ — Şoför portalı iş emri fotoğrafları
   ================================================================ */

/** Foto tipi seçim sayfasını aç */
function soforFotoEkleAc() {
  const sheet = document.getElementById('sofor-foto-sheet');
  if (sheet) sheet.classList.add('open');
}

/** Foto sayfasını kapat */
function soforFotoEkleKapat() {
  const sheet = document.getElementById('sofor-foto-sheet');
  if (sheet) sheet.classList.remove('open');
}

/** Tip seçildi → kamera/galeri aç */
function soforFotoTipSec(tip) {
  soforState.aktifFotoTip = tip;
  soforFotoEkleKapat();
  const input = document.getElementById('sofor-foto-input');
  if (input) { input.value = ''; input.click(); }
}

/** Dosya seçildi → upload et → is_emirleri.fotograflar güncelle */
async function soforFotoIsle(event) {
  const file = event.target.files?.[0];
  if (!file || !soforState.aktifIsEmri) return;
  const tip = soforState.aktifFotoTip || 'Diğer';
  const e = soforState.aktifIsEmri;

  soforToast('Fotoğraf yükleniyor…', '');

  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();

    // 1) Storage'a yükle (bucket: operasyon-foto)
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
    const yol = `${e.id}/${user.id}_${Date.now()}.${ext}`;
    let fotoUrl = null;
    try {
      const up = await sb.storage.from('operasyon-foto').upload(yol, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      const pub = sb.storage.from('operasyon-foto').getPublicUrl(yol);
      fotoUrl = pub?.data?.publicUrl || null;
    } catch (upErr) {
      console.warn('Storage yükleme hatası — base64 fallback:', upErr);
      // Offline / bucket yoksa base64 olarak sakla
      fotoUrl = await new Promise((res) => {
        const reader = new FileReader();
        reader.onload = (ev) => res(ev.target.result);
        reader.readAsDataURL(file);
      });
    }

    // 2) Mevcut fotograflar'ı çek, yeni kaydı ekle
    const { data: cur } = await sb.from('is_emirleri').select('fotograflar').eq('id', e.id).maybeSingle();
    let fotolar = [];
    try {
      if (cur?.fotograflar) {
        fotolar = typeof cur.fotograflar === 'string' ? JSON.parse(cur.fotograflar) : (Array.isArray(cur.fotograflar) ? cur.fotograflar : []);
      }
    } catch(_) { fotolar = []; }
    fotolar.push({ url: fotoUrl, tip, ts: new Date().toISOString() });

    // 3) is_emirleri güncelle
    const { error } = await sb.from('is_emirleri')
      .update({ fotograflar: JSON.stringify(fotolar) })
      .eq('id', e.id);
    if (error) throw error;

    // 4) Yerel state güncelle ve drawer'ı yeniden render et
    e.fotograflar = JSON.stringify(fotolar);
    soforToast('Fotoğraf eklendi ✓', 'ok');
    soforJobAc(e.id);
  } catch (err) {
    console.error('Fotoğraf yükleme hatası:', err);
    soforToast('Fotoğraf eklenemedi: ' + (err?.message || 'hata'), 'err');
  }
}

/** Fotoğrafı yeni sekmede tam ekran aç */
function soforFotoGoruntule(url) {
  window.open(url, '_blank');
}

async function soforDurumGuncelle(yeniDurum) {
  const e = soforState.aktifIsEmri;
  if (!e) return;
  try {
    const sb = getSB();
    const now = new Date().toISOString();
    const durumPatch = { durum: yeniDurum };
    if (yeniDurum === 'Yolda'         && !e.yola_zaman)    { durumPatch.yola_zaman    = now; e.yola_zaman    = now; }
    if (yeniDurum === 'Fabrikada'     && !e.fabrika_giris) { durumPatch.fabrika_giris = now; e.fabrika_giris = now; }
    if (yeniDurum === 'Teslim Edildi' && !e.teslim_zamani) { durumPatch.teslim_zamani = now; e.teslim_zamani = now; }
    const { error } = await sb
      .from('is_emirleri')
      .update(durumPatch)
      .eq('id', e.id);
    if (error) throw error;
    e.durum = yeniDurum;
    soforJobAc(e.id); // yeniden render
    soforIsEmirleriYukle();

    // "Yolda" ise konum takibini başlat; diğer durumlarda durdur
    if (yeniDurum === 'Yolda') soforKonumStart();
    else soforKonumStop();
  } catch (err) {
    console.error(err);
    alert('Durum güncellenemedi: ' + (err?.message || 'hata'));
  }
}

/* ---- Konum takibi (Yolda iken veya manuel "Canlı" toggle ile 60 sn'de bir) ---- */
function soforKonumStart(manual) {
  if (soforState.konumInterval) return;
  if (!('geolocation' in navigator)) return;
  const gonder = async () => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        // Konum ekranı açıksa UI'ı da güncelle
        if (soforState.aktifEkran === 'konum') _soforKonumHeroGuncelle(pos);
        const sb = getSB();
        const e = soforState.aktifIsEmri;
        const batarya = await _soforBatarya();
        await sb.rpc('sofor_konum_gonder', {
          p_lat      : pos.coords.latitude,
          p_lng      : pos.coords.longitude,
          p_dogruluk : pos.coords.accuracy || null,
          p_hiz      : pos.coords.speed || null,
          p_batarya  : batarya,
          p_is_emri  : e?.id || null,
          p_tip      : manual ? 'live' : 'auto'
        });
        // Müşteri takip sayfasının okuyabilmesi için is_emirleri'ni de doğrudan güncelle
        if (e?.id) {
          await sb.from('is_emirleri').update({
            konum_lat   : pos.coords.latitude,
            konum_lng   : pos.coords.longitude,
            konum_zaman : new Date().toISOString(),
          }).eq('id', e.id);
        }
      } catch (err) { /* sessiz */ }
    }, () => {}, { enableHighAccuracy:true, timeout:15000, maximumAge:30000 });
  };
  gonder();
  soforState.konumInterval = setInterval(gonder, 60000);
  soforState.konumMode = manual ? 'manual' : 'job';
  // Konum ekranındaysa toggle'ı işaretle
  const tg = document.getElementById('sofor-konum-toggle');
  if (tg) tg.checked = true;
}
function soforKonumStop() {
  if (soforState.konumInterval) {
    clearInterval(soforState.konumInterval);
    soforState.konumInterval = null;
  }
  soforState.konumMode = null;
  const tg = document.getElementById('sofor-konum-toggle');
  if (tg) tg.checked = false;
}

/* ---- Yakıt Fiş Yükle ---- */
function soforYakitFisAc() {
  // Tarihi bugün
  document.getElementById('sofor-fuel-tarih').value = new Date().toISOString().slice(0,10);
  document.getElementById('sofor-fuel-modal').classList.add('open');
}
function soforYakitKapat() {
  document.getElementById('sofor-fuel-modal').classList.remove('open');
  soforState.fisFotoBlob = null;
  ['sofor-fuel-km','sofor-fuel-litre','sofor-fuel-birim','sofor-fuel-toplam','sofor-fuel-istasyon'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value='';
  });
  const prev = document.getElementById('sofor-fuel-preview');
  if (prev) prev.innerHTML = '📷 Fotoğraf çek / seç';
}
function soforFisFotoSec(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  soforState.fisFotoBlob = file;
  const url = URL.createObjectURL(file);
  document.getElementById('sofor-fuel-preview').innerHTML = `<img src="${url}" alt="fiş">`;
}

// Toplam otomatik hesapla
document.addEventListener('input', (e) => {
  if (!e.target || !e.target.id) return;
  if (['sofor-fuel-litre','sofor-fuel-birim'].includes(e.target.id)) {
    const l = parseFloat(document.getElementById('sofor-fuel-litre').value) || 0;
    const b = parseFloat(document.getElementById('sofor-fuel-birim').value) || 0;
    const t = (l * b).toFixed(2);
    document.getElementById('sofor-fuel-toplam').value = t;
  }
});

async function soforFisYukle() {
  const tarih   = document.getElementById('sofor-fuel-tarih').value;
  const km      = parseFloat(document.getElementById('sofor-fuel-km').value);
  const litre   = parseFloat(document.getElementById('sofor-fuel-litre').value);
  const birim   = parseFloat(document.getElementById('sofor-fuel-birim').value);
  const istas   = document.getElementById('sofor-fuel-istasyon').value.trim();
  const toplam  = parseFloat(document.getElementById('sofor-fuel-toplam').value);

  const errEl = document.getElementById('sofor-fuel-err');
  const sucEl = document.getElementById('sofor-fuel-suc');
  errEl.classList.remove('show'); sucEl.classList.remove('show');

  if (!tarih || !km || !litre || !birim) {
    errEl.textContent = 'Tarih, km, litre ve birim fiyat zorunludur.'; errEl.classList.add('show'); return;
  }
  if (!soforState.fisFotoBlob) {
    errEl.textContent = 'Fiş fotoğrafı zorunludur.'; errEl.classList.add('show'); return;
  }
  const aracId = soforState.profil?.arac_id;
  if (!aracId) {
    errEl.textContent = 'Aracınız atanmamış. Operasyoncuya başvurun.'; errEl.classList.add('show'); return;
  }

  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();

    // 1) Fotoyu Supabase Storage'a yükle (bucket: yakit-fisleri)
    const dosya = soforState.fisFotoBlob;
    const ext   = (dosya.name.split('.').pop() || 'jpg').toLowerCase();
    const yol   = `${user.id}/${tarih}_${Date.now()}.${ext}`;
    let fisUrl  = null;
    try {
      const up = await sb.storage.from('yakit-fisleri').upload(yol, dosya, { contentType: dosya.type, upsert: false });
      if (up.error) throw up.error;
      const pub = sb.storage.from('yakit-fisleri').getPublicUrl(yol);
      fisUrl = pub?.data?.publicUrl || null;
    } catch (upErr) {
      console.warn('Fiş yükleme hatası:', upErr);
      // yine de kaydı oluştur; fotoğraf sonra eklenebilir
    }

    // 2) yakit_girisleri insert — id text NOT NULL (client-side generated)
    const genId = 'YK-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const { error } = await sb.from('yakit_girisleri').insert({
      id          : genId,
      user_id     : user.id,
      arac_id     : aracId,
      tarih       : tarih,
      km          : km,
      litre       : litre,
      litre_fiyat : birim,           // ₺/litre
      fiyat       : toplam,          // toplam tutar
      istasyon    : istas || null,
      fis_url     : fisUrl,
      sofor       : soforState.profil?.ad || null
    });
    if (error) throw error;

    sucEl.textContent = '✓ Fiş başarıyla yüklendi';
    sucEl.classList.add('show');
    setTimeout(() => soforYakitKapat(), 1200);
  } catch (err) {
    console.error(err);
    errEl.textContent = 'Kaydedilemedi: ' + (err?.message || 'hata'); errEl.classList.add('show');
  }
}

/* ================================================================
   ŞOFÖR PORTAL v2 — Router + Profil + Konum + Yakıt + Ayarlar
   ================================================================ */

function soforGoto(screen) {
  soforScreenGoster(screen);
  // Lazy load per-screen
  switch (screen) {
    case 'home'    : soforIsEmirleriYukle(); soforProfilYukle(); break;
    case 'konum'   : soforKonumEkranAc();  break;
    case 'profil'  : soforProfilEkranAc(); break;
    case 'yakit'   : soforYakitEkranAc();  break;
    case 'ayarlar' : soforAyarlarEkranAc(); break;
  }
  // Scroll top
  document.getElementById('sofor-app')?.scrollTo({ top:0, behavior:'auto' });
}

/* ---- Toast helper ---- */
function soforToast(msg, type='') {
  const t = document.getElementById('sofor-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'sofor-toast show ' + type;
  clearTimeout(soforToast._t);
  soforToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---- Online/offline indikatörü ---- */
function _soforOnlineUpdate() {
  const dot = document.getElementById('sofor-online-dot');
  if (!dot) return;
  dot.classList.toggle('offline', !navigator.onLine);
  dot.title = navigator.onLine ? 'Çevrimiçi' : 'Çevrimdışı';
}
window.addEventListener('online',  _soforOnlineUpdate);
window.addEventListener('offline', _soforOnlineUpdate);

/* ================================================================
   PROFİL — Bilgileri yükle + renderla + düzenle
   ================================================================ */
async function soforProfilEkranAc() {
  await Promise.all([ soforProfilYukle(true), soforIstatistikYukle() ]);
  _soforProfilRender();
}

async function soforIstatistikYukle() {
  try {
    const sb = getSB();
    const { data, error } = await sb.from('v_sofor_istatistik').select('*').maybeSingle();
    if (error) throw error;
    soforState.istatistik = data || null;
    // Home'daki genel statler (lifetime)
    if (data) {
      const buay = document.getElementById('sofor-st-buay'); if (buay) buay.textContent = data.bu_ay_sefer ?? 0;
      const sef  = document.getElementById('sofor-st-sefer'); if (sef)  sef.textContent  = data.toplam_sefer ?? 0;
      const ak   = document.getElementById('sofor-st-aktif'); if (ak)   ak.textContent   = data.aktif_sefer ?? 0;
    }
  } catch (e) { console.warn('İstatistik yüklenemedi:', e); }
}

function _fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('tr-TR'); } catch { return d; }
}
function _belgeBadge(bitis) {
  if (!bitis) return { cls:'na', txt:'Eklenmedi' };
  const b = new Date(bitis); const now = new Date();
  const gun = Math.round((b - now) / (1000*60*60*24));
  if (gun < 0)      return { cls:'red',  txt:'Süresi dolmuş' };
  if (gun <= 30)    return { cls:'warn', txt:gun+' gün kaldı' };
  return { cls:'ok', txt:'Geçerli · '+_fmtDate(bitis) };
}

function _soforProfilRender() {
  const p = soforState.profil || {};
  // Avatar
  const imgEl = document.getElementById('sofor-avatar-img');
  const fbEl  = document.getElementById('sofor-avatar-fallback');
  if (p.avatar_url) {
    imgEl.src = p.avatar_url; imgEl.style.display = ''; if (fbEl) fbEl.style.display='none';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (fbEl)  { fbEl.style.display=''; fbEl.textContent = (p.ad||'?').trim().charAt(0).toUpperCase() || '?'; }
  }
  const set = (id,v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
  const setMuted = (id,v) => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = v || 'Eklenmemiş';
    el.classList.toggle('muted', !v);
  };
  set('sofor-pr-ad',  p.ad);
  set('sofor-pr-firma', p.firma_adi);
  set('pr-kv-ad',   p.ad);
  set('pr-kv-tel',  p.tel);
  setMuted('pr-kv-email',  p.email);
  setMuted('pr-kv-dogum',  p.dogum_tarihi ? _fmtDate(p.dogum_tarihi) : '');
  setMuted('pr-kv-adres',  p.adres);
  setMuted('pr-kv-acil-ad',  p.acil_kontak_ad);
  setMuted('pr-kv-acil-tel', p.acil_kontak_tel);
  set('pr-kv-plaka',    p.arac_plaka);
  set('pr-kv-arac-tip', p.arac_tip);
  set('pr-kv-arac-mm',  [p.arac_marka, p.arac_model].filter(Boolean).join(' '));
  set('pr-kv-arac-yil', p.arac_yil);

  // Belgeler
  const docs = [
    { ico:'🪪', ad:'Ehliyet',        sinifi:p.ehliyet_sinifi, bitis:p.ehliyet_bitis, no:p.ehliyet_no },
    { ico:'📘', ad:'SRC Belgesi',    bitis:p.src_bitis },
    { ico:'🧠', ad:'Psikoteknik',    bitis:p.psiko_bitis },
    { ico:'❤️', ad:'Sağlık Raporu', bitis:p.saglik_bitis }
  ];
  const dl = document.getElementById('sofor-doc-list');
  if (dl) dl.innerHTML = docs.map(d => {
    const b = _belgeBadge(d.bitis);
    const det = [];
    if (d.sinifi) det.push('Sınıf: ' + d.sinifi);
    if (d.no)     det.push('No: ' + d.no);
    if (d.bitis)  det.push('Bitiş: ' + _fmtDate(d.bitis));
    return `<div class="sofor-doc">
      <div class="ico">${d.ico}</div>
      <div class="info"><div class="t">${d.ad}</div><div class="d">${det.join(' · ') || 'Bilgi yok'}</div></div>
      <div class="badge ${b.cls}">${b.txt}</div>
    </div>`;
  }).join('');

  // Home greeting — firma adı
  const fe = document.getElementById('sofor-greet-firma');
  if (fe) fe.textContent = p.firma_adi || '';

  // Warn şeridi — home
  const warns = [];
  if (p.ehliyet_uyari) warns.push({t:'Ehliyetiniz 30 gün içinde dolacak', red:false});
  if (p.src_uyari)     warns.push({t:'SRC belgeniz 30 gün içinde dolacak', red:false});
  if (p.psiko_uyari)   warns.push({t:'Psikoteknik raporunuz 30 gün içinde dolacak', red:false});
  if (p.saglik_uyari)  warns.push({t:'Sağlık raporunuz 30 gün içinde dolacak', red:false});
  if (p.ehliyet_bitis && new Date(p.ehliyet_bitis) < new Date()) warns.push({t:'Ehliyetinizin süresi dolmuş!', red:true});
  const wl = document.getElementById('sofor-warn-list');
  if (wl) {
    if (warns.length) {
      wl.style.display = '';
      wl.innerHTML = warns.map(w => `<div class="sofor-warn ${w.red?'red':''}"><span class="ico">${w.red?'🚨':'⚠️'}</span>${w.t}</div>`).join('');
    } else {
      wl.style.display = 'none'; wl.innerHTML = '';
    }
  }
}

/* ---- Profil DÜZENLE MODAL ---- */
let _soforEditCtx = null;

function soforProfilDuzenle(bolum) {
  const p = soforState.profil || {};
  const title = document.getElementById('sofor-edit-title');
  const body  = document.getElementById('sofor-edit-body');
  const err   = document.getElementById('sofor-edit-err'); err.classList.remove('show');

  let html = '';
  _soforEditCtx = { bolum };

  const inp = (id, label, value, type='text', attrs='') =>
    `<div class="sofor-editor-field"><label>${label}</label>
      <input class="sofor-inp" type="${type}" id="${id}" value="${value??''}" ${attrs}/></div>`;

  if (bolum === 'kisisel') {
    title.textContent = 'Kişisel Bilgileri Düzenle';
    html += inp('ed-ad',    'Ad Soyad',   p.ad);
    html += inp('ed-tel',   'Telefon',    p.tel, 'tel', 'placeholder="+90 5XX XXX XX XX"');
    html += inp('ed-email', 'E-posta',    p.email, 'email');
    html += inp('ed-dogum', 'Doğum Tarihi', p.dogum_tarihi ? p.dogum_tarihi.slice(0,10) : '', 'date');
    html += `<div class="sofor-editor-field"><label>Adres</label>
      <textarea class="sofor-inp" id="ed-adres" rows="2">${p.adres||''}</textarea></div>`;
  } else if (bolum === 'acil') {
    title.textContent = 'Acil Durum Kontağı';
    html += inp('ed-acil-ad',  'Ad',       p.acil_kontak_ad);
    html += inp('ed-acil-tel', 'Telefon',  p.acil_kontak_tel, 'tel');
  } else if (bolum === 'belge') {
    title.textContent = 'Belgeler & Sertifikalar';
    html += inp('ed-eh-no',     'Ehliyet No',              p.ehliyet_no);
    html += inp('ed-eh-sinifi', 'Ehliyet Sınıfı',          p.ehliyet_sinifi, 'text', 'placeholder="B, C, D, E ..."');
    html += inp('ed-eh-bitis',  'Ehliyet Bitiş',           p.ehliyet_bitis ? p.ehliyet_bitis.slice(0,10) : '', 'date');
    html += inp('ed-src-bitis', 'SRC Belgesi Bitiş',       p.src_bitis ? p.src_bitis.slice(0,10) : '', 'date');
    html += inp('ed-psk-bitis', 'Psikoteknik Bitiş',       p.psiko_bitis ? p.psiko_bitis.slice(0,10) : '', 'date');
    html += inp('ed-sag-bitis', 'Sağlık Raporu Bitiş',     p.saglik_bitis ? p.saglik_bitis.slice(0,10) : '', 'date');
  }
  body.innerHTML = html;
  document.getElementById('sofor-edit-modal').classList.add('open');
}

function soforEditKapat() {
  document.getElementById('sofor-edit-modal').classList.remove('open');
  _soforEditCtx = null;
}

async function soforEditKaydet() {
  const ctx = _soforEditCtx; if (!ctx) return;
  const err = document.getElementById('sofor-edit-err'); err.classList.remove('show');

  const v = id => (document.getElementById(id)?.value || '').trim();
  let patch = {};
  try {
    if (ctx.bolum === 'kisisel') {
      patch = {
        p_ad:           v('ed-ad')    || null,
        p_tel:          v('ed-tel')   || null,
        p_email:        v('ed-email') || null,
        p_dogum_tarihi: v('ed-dogum') || null,
        p_adres:        v('ed-adres') || null
      };
    } else if (ctx.bolum === 'acil') {
      patch = {
        p_acil_kontak_ad:  v('ed-acil-ad')  || null,
        p_acil_kontak_tel: v('ed-acil-tel') || null
      };
    } else if (ctx.bolum === 'belge') {
      patch = {
        p_ehliyet_no:     v('ed-eh-no')     || null,
        p_ehliyet_sinifi: v('ed-eh-sinifi') || null,
        p_ehliyet_bitis:  v('ed-eh-bitis')  || null,
        p_src_bitis:      v('ed-src-bitis') || null,
        p_psiko_bitis:    v('ed-psk-bitis') || null,
        p_saglik_bitis:   v('ed-sag-bitis') || null
      };
    }
    const sb = getSB();
    const { error } = await sb.rpc('sofor_profil_guncelle', patch);
    if (error) throw error;
    soforEditKapat();
    soforToast('Güncellendi ✓', 'ok');
    await soforProfilYukle(true);
    _soforProfilRender();
  } catch (e) {
    console.error(e);
    err.textContent = 'Kaydedilemedi: ' + (e?.message || 'hata');
    err.classList.add('show');
  }
}

/* ---- Avatar upload ---- */
async function soforAvatarSec(ev) {
  const file = ev.target.files?.[0]; if (!file) return;
  if (file.size > 4 * 1024 * 1024) { soforToast('Dosya çok büyük (max 4 MB)', 'err'); return; }
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${user.id}/avatar_${Date.now()}.${ext}`;

    soforToast('Yükleniyor…');
    const up = await sb.storage.from('sofor-avatars').upload(path, file, { contentType:file.type, upsert:true });
    if (up.error) throw up.error;
    const pub = sb.storage.from('sofor-avatars').getPublicUrl(path);
    const url = pub?.data?.publicUrl || null;
    if (!url) throw new Error('URL alınamadı');

    const { error: rpcErr } = await sb.rpc('sofor_profil_guncelle', { p_avatar_url: url });
    if (rpcErr) throw rpcErr;

    soforToast('Fotoğraf güncellendi ✓', 'ok');
    await soforProfilYukle(true);
    _soforProfilRender();
  } catch (e) {
    console.error(e); soforToast('Yüklenemedi: ' + (e?.message || 'hata'), 'err');
  } finally {
    ev.target.value = '';
  }
}

/* ================================================================
   KONUM EKRANI
   ================================================================ */
async function soforKonumEkranAc() {
  soforKonumSonlariYukle();
  // Mevcut konumu hemen bir kez al
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(pos => {
      _soforKonumHeroGuncelle(pos);
    }, () => {
      const sub = document.getElementById('sofor-konum-sub');
      if (sub) sub.textContent = 'Konum izni verilmedi. Lütfen tarayıcı/telefon ayarlarını kontrol edin.';
    }, { enableHighAccuracy:true, timeout:10000, maximumAge:15000 });
  }
  // Toggle'ı mevcut duruma göre senkronla
  const tg = document.getElementById('sofor-konum-toggle');
  if (tg) tg.checked = !!soforState.konumInterval;
}

function _soforKonumHeroGuncelle(pos) {
  if (!pos || !pos.coords) return;
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  const acc = pos.coords.accuracy, spd = pos.coords.speed;
  soforState.sonKonum = { lat, lng, acc, spd, ts: Date.now() };

  const el1 = document.getElementById('sofor-konum-latlng');
  const el2 = document.getElementById('sofor-konum-dogruluk');
  const el3 = document.getElementById('sofor-konum-hiz');
  if (el1) el1.textContent = lat.toFixed(5) + ' · ' + lng.toFixed(5);
  if (el2) el2.textContent = (acc != null ? Math.round(acc) + ' m' : '—');
  if (el3) el3.textContent = (spd != null ? Math.round((spd||0) * 3.6) + ' km/h' : '—');

  // OSM embed
  const harita = document.getElementById('sofor-konum-harita');
  if (harita) {
    const d = 0.008;
    const bbox = `${lng-d}%2C${lat-d}%2C${lng+d}%2C${lat+d}`;
    harita.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  }
  const sub = document.getElementById('sofor-konum-sub');
  if (sub) sub.textContent = soforState.konumInterval
    ? '✓ Canlı konum paylaşımı açık · 60 sn\'de bir güncellenir'
    : 'Konum alındı. "Canlı" açarak sürekli paylaşım başlatabilirsiniz.';
}

function soforKonumToggleDegisti(on) {
  if (on) soforKonumStart(true);  // ekran modunda (is_emri_id olmadan)
  else soforKonumStop();
  const sub = document.getElementById('sofor-konum-sub');
  if (sub) sub.textContent = on
    ? '✓ Canlı konum paylaşımı açık · 60 sn\'de bir güncellenir'
    : 'Canlı paylaşım kapalı.';
}

async function soforKonumSimdiGonder() {
  if (!('geolocation' in navigator)) { soforToast('Konum desteklenmiyor', 'err'); return; }
  soforToast('Konum alınıyor…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    _soforKonumHeroGuncelle(pos);
    try {
      const sb = getSB();
      const batarya = await _soforBatarya();
      const e = soforState.aktifIsEmri;
      const { error } = await sb.rpc('sofor_konum_gonder', {
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
        p_dogruluk: pos.coords.accuracy || null,
        p_hiz: pos.coords.speed || null,
        p_batarya: batarya,
        p_is_emri: e?.id || null,
        p_tip: 'manual'
      });
      if (error) throw error;
      // is_emirleri'ni de doğrudan güncelle (müşteri takip için)
      if (e?.id) {
        await sb.from('is_emirleri').update({
          konum_lat   : pos.coords.latitude,
          konum_lng   : pos.coords.longitude,
          konum_zaman : new Date().toISOString(),
        }).eq('id', e.id);
      }
      soforToast('Konum gönderildi ✓', 'ok');
      soforKonumSonlariYukle();
    } catch (err) { soforToast('Gönderilemedi: ' + (err?.message||'hata'), 'err'); }
  }, err => soforToast('Konum alınamadı: ' + (err.message||'izin verilmedi'), 'err'),
    { enableHighAccuracy:true, timeout:12000, maximumAge:5000 });
}

async function _soforBatarya() {
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      return Math.round((b.level || 0) * 100);
    }
  } catch {}
  return null;
}

function soforKonumAcHarita() {
  const k = soforState.sonKonum;
  if (!k) { soforToast('Önce konum al', 'err'); return; }
  window.open(`https://www.google.com/maps?q=${k.lat},${k.lng}`, '_blank');
}

async function soforKonumSonlariYukle() {
  const list = document.getElementById('sofor-konum-list');
  if (!list) return;
  try {
    const sb = getSB();
    const { data, error } = await sb.from('v_sofor_son_konum').select('*').limit(10);
    if (error) throw error;
    if (!data || !data.length) {
      list.innerHTML = '<div class="sofor-empty">Henüz konum gönderilmedi.</div>';
      return;
    }
    list.innerHTML = data.map(k => {
      const t = k.ts ? new Date(k.ts).toLocaleString('tr-TR') : '—';
      const spd = k.hiz != null ? Math.round((k.hiz||0)*3.6) + ' km/h' : '—';
      return `<div class="sofor-fuel-row" onclick="window.open('https://www.google.com/maps?q=${k.lat},${k.lng}','_blank')">
        <div><div class="date">${t}${k.tip==='manual'?' · Manuel':''}</div>
          <div class="station">${k.lat.toFixed(5)}, ${k.lng.toFixed(5)}</div></div>
        <div class="litre">${spd}</div>
        <div class="tut" style="color:#818cf8">›</div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="sofor-empty" style="color:#fca5a5">Yüklenemedi</div>';
  }
}

/* ================================================================
   YAKIT GEÇMİŞİ EKRANI
   ================================================================ */
async function soforYakitEkranAc() {
  try {
    const sb = getSB();
    const { data, error } = await sb.from('v_sofor_yakit').select('*').limit(200);
    if (error) throw error;
    const list = data || [];
    let totLitre = 0, totTut = 0;
    list.forEach(r => { totLitre += (+r.litre||0); totTut += (+r.fiyat||0); });
    document.getElementById('yk-st-fis').textContent   = list.length;
    document.getElementById('yk-st-litre').textContent = totLitre.toFixed(0);
    document.getElementById('yk-st-tut').textContent   = '₺' + totTut.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

    const holder = document.getElementById('sofor-yakit-list');
    if (!list.length) { holder.innerHTML = '<div class="sofor-empty">Henüz fiş yok. İlk fişinizi yükleyin!</div>'; return; }
    holder.innerHTML = list.map(r => `
      <div class="sofor-fuel-row" ${r.fis_url?`onclick="window.open('${r.fis_url}','_blank')"`:''}>
        <div>
          <div class="date">${_fmtDate(r.tarih)} ${r.arac_plaka?'· '+r.arac_plaka:''}</div>
          <div class="station">${r.istasyon || 'İstasyon belirtilmedi'}</div>
          <div class="litre">${(+r.litre||0).toFixed(1)} L${r.litre_fiyat?' · ₺'+r.litre_fiyat+'/L':''}</div>
        </div>
        <div class="tut">₺${(+r.fiyat||0).toLocaleString('tr-TR', {maximumFractionDigits:0})}</div>
        ${r.fis_url ? `<div class="foto"><img src="${r.fis_url}" alt="fiş"/></div>` : '<div></div>'}
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
    document.getElementById('sofor-yakit-list').innerHTML = '<div class="sofor-empty" style="color:#fca5a5">Yüklenemedi</div>';
  }
}

/* ================================================================
   AYARLAR EKRANI
   ================================================================ */
function soforAyarlarEkranAc() {
  // Bildirim
  const bd = document.getElementById('ay-bildirim-state');
  const bdDesc = document.getElementById('ay-bildirim-d');
  if ('Notification' in window) {
    const p = Notification.permission;
    if (bd) bd.textContent = p === 'granted' ? 'Açık' : (p === 'denied' ? 'Engelli' : 'Kapalı');
    if (bdDesc) bdDesc.textContent = p === 'denied' ? 'Tarayıcı ayarlarından açın' : 'Push bildirimlerini yönet';
  } else {
    if (bd) bd.textContent = 'Desteklenmiyor';
  }
  // Tema
  const t = localStorage.getItem('sofor-tema') || 'dark';
  const td = document.getElementById('ay-tema-d');
  if (td) td.textContent = t === 'light' ? 'Açık tema' : 'Koyu tema';
  // Konum
  if (navigator.permissions?.query) {
    navigator.permissions.query({name:'geolocation'}).then(r => {
      const d = document.getElementById('ay-konum-d');
      if (d) d.textContent = r.state === 'granted' ? '✓ İzin verildi' : (r.state==='denied'?'Engelli':'İzin sorulacak');
    }).catch(()=>{});
  }
}

async function soforBildirimDegistir() {
  if (!('Notification' in window)) { soforToast('Tarayıcı desteklemiyor', 'err'); return; }
  if (Notification.permission === 'default') {
    const p = await Notification.requestPermission();
    soforToast(p === 'granted' ? 'Bildirimler açıldı ✓' : 'İzin verilmedi', p === 'granted' ? 'ok' : 'err');
  } else if (Notification.permission === 'denied') {
    alert('Bildirimler engellenmiş. Tarayıcı ayarlarından tekrar açın.');
  } else {
    alert('Bildirimler zaten açık. Kapatmak için tarayıcı ayarlarına girin.');
  }
  soforAyarlarEkranAc();
}
function soforTemaDegistir() {
  const cur = localStorage.getItem('sofor-tema') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('sofor-tema', next);
  soforToast(next === 'dark' ? 'Koyu tema' : 'Açık tema', 'ok');
  soforAyarlarEkranAc();
}
function soforDilDegistir() {
  soforToast('Dil seçeneği yakında', '');
}
function soforKonumIzniYardim() {
  alert('Konum izni adımları:\n\n1. Tarayıcınızın adres çubuğundaki 🔒 simgesine tıklayın\n2. "Konum" → "İzin ver" seçin\n3. Mobilde: Ayarlar → Uygulamalar → Tarayıcı → İzinler → Konum');
}
function soforYardim() {
  const p = soforState.profil;
  const tel = '902125555555';
  const msg = 'Merhaba, Fleetly Şoför Portalı hakkında yardım istiyorum.';
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
}
function soforHakkinda() {
  alert('Fleetly Şoför Portalı\nSürüm 2.0\n\nFilo yönetim sistemi — şoförler için mobil uygulama.\n\n© Fleetly');
}

async function soforCikis() {
  if (!confirm('Çıkış yapmak istediğinize emin misiniz?')) return;
  try { await getSB().auth.signOut(); } catch (e) {}
  soforState.profil = null;
  soforState.session = null;
  soforKonumStop();
  soforScreenGoster('login');
  soforStepGoster('kod');
  // Hash'i temizle
  location.hash = '#/sofor';
}

/* ---- PWA / Service Worker (basit) ---- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.getRegistrations().then(() => {
    // Opsiyonel: sw.js dosyası varsa kaydet. Yoksa sessizce geç.
    fetch('/sw.js', { method: 'HEAD' }).then(r => {
      if (r.ok) navigator.serviceWorker.register('/sw.js').catch(() => {});
    }).catch(() => {});
  });
}
