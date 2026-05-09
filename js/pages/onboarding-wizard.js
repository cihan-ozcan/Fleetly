/* =============================================================================
 * onboarding-wizard.js — Yeni firma kayıt sonrası 5-adımlı kurulum sihirbazı
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_09b__firma_onboarding.sql
 *
 * Tetikleyici:
 *   - Login sonrası firmalar.onboarding_done = false ise overlay açılır
 *   - Eski firmalar (backfill ile true) wizard görmez
 *
 * Adımlar:
 *   1. Firma adres + web (firmalar UPDATE)
 *   2. İlk araç (araclar INSERT — kullanıcı sahibi olduğu firmaya kaydedilir)
 *   3. İlk sürücü davet (suruculer + surucu_davetleri — atlamak yaygın)
 *   4. İlk müşteri (musteriler INSERT — atlamak yaygın)
 *   5. Harcırah ayarları (harcirah_kural_seti UPSERT)
 *
 * Atla davranışı:
 *   - "Atla" butonu mevcut adımı boş geçer, sonraki adıma gider
 *   - "Tüm sihirbazı atla" en altta, hiç doldurmadan onboarding_done=true yapar
 *   - Adım 2 (araç) hariç hepsi opsiyonel; araçta validation ileriye geçişi engeller
 *
 * Bağımlılıklar (window):
 *   - sbUrl, sbHeaders, currentFirmaId, getSB
 *   - showToast (varsa)
 * =========================================================================== */

(function () {
  'use strict';

  let _step = 1;
  const TOTAL = 5;

  function _$(id) { return document.getElementById(id); }
  function _toast(msg, kind) {
    if (typeof window.showToast === 'function') return window.showToast(msg, kind);
    if (kind === 'error') console.error(msg); else console.log(msg);
  }

  // ──────────────────────────────────────────────────────────
  // Görünürlük + adım state
  // ──────────────────────────────────────────────────────────
  function showOnboarding() {
    const ov = _$('onb-overlay');
    if (!ov) return;
    ov.style.display = 'flex';
    ov.classList.remove('hidden');
    _renderStep(1);
  }

  function hideOnboarding() {
    const ov = _$('onb-overlay');
    if (!ov) return;
    ov.style.display = 'none';
    ov.classList.add('hidden');
  }

  const STEP_TITLES = {
    1: 'Firma Logo & Adres',
    2: 'İlk Araç',
    3: 'İlk Sürücü Davet',
    4: 'İlk Müşteri',
    5: 'Harcırah Ayarları'
  };

  function _renderStep(n) {
    _step = n;
    document.querySelectorAll('[data-onb-step]').forEach(el => {
      el.style.display = (Number(el.getAttribute('data-onb-step')) === n) ? '' : 'none';
    });
    const t = _$('onb-step-title'); if (t) t.textContent = STEP_TITLES[n] || '';
    const num = _$('onb-step-num'); if (num) num.textContent = `Adım ${n} / ${TOTAL}`;
    const prog = _$('onb-progress'); if (prog) prog.style.width = (n / TOTAL * 100) + '%';
    const back = _$('onb-back-btn');
    if (back) back.style.visibility = (n > 1) ? 'visible' : 'hidden';
    const nextBtn = _$('onb-next-btn');
    if (nextBtn) nextBtn.innerHTML = (n === TOTAL) ? '✓ Tamamla' : 'İleri →';
    const err = _$('onb-error');
    if (err) { err.textContent = ''; err.style.display = 'none'; }
  }

  function _setError(msg) {
    const err = _$('onb-error');
    if (!err) return;
    err.textContent = msg;
    err.style.display = msg ? 'block' : 'none';
  }

  // ──────────────────────────────────────────────────────────
  // Adım kaydetme — başarısızsa kullanıcıya error göster, ileri geçme
  // ──────────────────────────────────────────────────────────

  async function _saveStep(n) {
    if (!window.sbUrl || !window.sbHeaders) return false;
    const firmaId = window.currentFirmaId;
    if (!firmaId) {
      _setError('Firma bilgisi yüklenmedi, lütfen sayfayı yenileyin.');
      return false;
    }

    try {
      if (n === 1) {
        // Firma adres + web — boşsa atla, sayar
        const adres = _$('onb-firma-adres')?.value.trim() || null;
        const web   = _$('onb-firma-web')?.value.trim()   || null;
        if (!adres && !web) return true;  // boş bırakıldı, kayıt yok
        const patch = {};
        if (adres) patch.adres = adres;
        if (web)   patch.web_sitesi = web;
        const res = await fetch(window.sbUrl(`firmalar?id=eq.${firmaId}`), {
          method: 'PATCH',
          headers: { ...window.sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify(patch)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          // adres/web_sitesi kolonu yoksa sessizce atla (eski schema)
          if (/column .* does not exist/i.test(txt)) return true;
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        return true;
      }

      if (n === 2) {
        // İlk araç — plaka zorunlu
        const plaka = _$('onb-arac-plaka')?.value.trim().toUpperCase() || '';
        const tip   = _$('onb-arac-tip')?.value || 'cekici';
        const marka = _$('onb-arac-marka')?.value.trim() || null;
        if (!plaka) {
          _setError('Plaka zorunludur — operasyonların başlaması için en az bir araç gerek.');
          return false;
        }
        const id = (window.crypto?.randomUUID ? crypto.randomUUID() : 'arac-' + Date.now());
        const row = {
          id, firma_id: firmaId, plaka, kind: tip, marka, durum: 'aktif'
        };
        const res = await fetch(window.sbUrl('araclar'), {
          method: 'POST',
          headers: { ...window.sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify(row)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          // Aynı plaka çakışması olabilir — kullanıcıya net mesaj
          if (res.status === 409 || /duplicate/i.test(txt)) {
            _setError('Bu plaka zaten kayıtlı. Farklı bir plaka deneyin.');
            return false;
          }
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        return true;
      }

      if (n === 3) {
        // Sürücü davet — boşsa atla
        const ad  = _$('onb-sofor-ad')?.value.trim()  || '';
        const tel = _$('onb-sofor-tel')?.value.trim() || '';
        if (!ad && !tel) return true;
        if (!ad || !tel) {
          _setError('Hem ad hem telefon girin veya "Atla"yı tıklayın.');
          return false;
        }
        // sofor_davet_olustur RPC'si mevcut (handoff'ta görüldü)
        try {
          const res = await fetch(window.sbUrl('rpc/sofor_davet_olustur_v2'), {
            method: 'POST',
            headers: { ...window.sbHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_ad: ad, p_telefon: tel })
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.warn('[onb] sürücü davet RPC hata, atlanıyor:', txt);
          }
        } catch (e) {
          console.warn('[onb] sürücü davet hata, atlanıyor:', e?.message);
        }
        return true;  // davet RPC fail etse de wizard'ı durdurmasın
      }

      if (n === 4) {
        // İlk müşteri — boşsa atla
        const firma   = _$('onb-musteri-firma')?.value.trim()   || '';
        const yetkili = _$('onb-musteri-yetkili')?.value.trim() || null;
        const tel     = _$('onb-musteri-tel')?.value.trim()     || null;
        if (!firma) return true;
        const id = (window.crypto?.randomUUID ? crypto.randomUUID() : 'm-' + Date.now());
        const row = {
          id, firma_id: firmaId, firma,
          yetkili_ad: yetkili, telefon: tel
        };
        const res = await fetch(window.sbUrl('musteriler'), {
          method: 'POST',
          headers: { ...window.sbHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify(row)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          // Müşteri schema farklı olabilir; sessizce devam
          console.warn('[onb] müşteri kayıt başarısız, atlanıyor:', txt);
        }
        return true;
      }

      if (n === 5) {
        // Harcırah kural seti — varsayılanlarla UPSERT
        const minimum = parseFloat(_$('onb-harc-min')?.value) || 600;
        const dolu    = parseInt(_$('onb-harc-dolu')?.value, 10);
        const payload = {
          firma_id: firmaId,
          minimum_tutar: minimum,
          dolu_donus_yuzde: isFinite(dolu) ? dolu : 50,
          bos_donus_yuzde: 0
        };
        const res = await fetch(window.sbUrl('harcirah_kural_seti'), {
          method: 'POST',
          headers: { ...window.sbHeaders(), 'Prefer': 'return=minimal,resolution=merge-duplicates' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.warn('[onb] harcırah kural seti kayıt başarısız:', txt);
        }
        return true;
      }
      return true;
    } catch (e) {
      console.error('[onb] adım kaydı hata:', e);
      _setError('Kaydedilemedi: ' + (e?.message || 'hata'));
      return false;
    }
  }

  async function _markComplete() {
    if (!window.sbUrl || !window.sbHeaders || !window.currentFirmaId) return;
    try {
      await fetch(window.sbUrl(`firmalar?id=eq.${window.currentFirmaId}`), {
        method: 'PATCH',
        headers: { ...window.sbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          onboarding_done: true,
          onboarding_done_at: new Date().toISOString()
        })
      });
    } catch (e) {
      console.warn('[onb] complete flag hata:', e?.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Public — buton handler'ları
  // ──────────────────────────────────────────────────────────
  async function onbNext() {
    _setError('');
    const btn = _$('onb-next-btn');
    if (btn) { btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '⏳'; setTimeout(() => {}, 0);
      const ok = await _saveStep(_step);
      btn.innerHTML = old; btn.disabled = false;
      if (!ok) return;
    }
    if (_step >= TOTAL) {
      await _markComplete();
      hideOnboarding();
      _toast('🎉 Hoş geldiniz! Fleetly hazır.', 'success');
      // Sayfayı yenile ki yeni eklenen araç/müşteri vs. görünsün
      setTimeout(() => location.reload(), 1200);
      return;
    }
    _renderStep(_step + 1);
  }

  function onbBack() {
    _setError('');
    if (_step > 1) _renderStep(_step - 1);
  }

  function onbSkip() {
    _setError('');
    if (_step >= TOTAL) {
      // Son adımda atla = tamamla (boş)
      onbNext();
      return;
    }
    _renderStep(_step + 1);
  }

  async function onbSkipAll() {
    if (!confirm('Tüm sihirbazı atlamak istediğinize emin misiniz? Daha sonra Ayarlar sekmesinden yapılandırabilirsiniz.')) return;
    await _markComplete();
    hideOnboarding();
    _toast('Sihirbaz atlandı. Ayarlar sekmesinden istediğiniz zaman yapılandırabilirsiniz.', 'info');
  }

  // ──────────────────────────────────────────────────────────
  // checkOnboarding — login sonrası app-chunk-02 bunu çağırır
  // ──────────────────────────────────────────────────────────
  async function checkOnboarding() {
    if (!window.sbUrl || !window.sbHeaders || !window.currentFirmaId) return;
    try {
      const res = await fetch(
        window.sbUrl(`firmalar?id=eq.${window.currentFirmaId}&select=onboarding_done`),
        { headers: window.sbHeaders() }
      );
      if (!res.ok) return;  // kolon yoksa sessizce atla (migration uygulanmamış)
      const rows = await res.json();
      const row = Array.isArray(rows) && rows[0];
      if (row && row.onboarding_done === false) {
        showOnboarding();
      }
    } catch (e) {
      console.warn('[onb] check hata:', e?.message);
    }
  }

  // Global expose
  window.onbNext         = onbNext;
  window.onbBack         = onbBack;
  window.onbSkip         = onbSkip;
  window.onbSkipAll      = onbSkipAll;
  window.checkOnboarding = checkOnboarding;
  window.showOnboarding  = showOnboarding;   // debug için
  window.hideOnboarding  = hideOnboarding;

  console.info('[onboarding] modül yüklendi');
})();
