/* =============================================================================
 * veri-yonetimi.js — KVKK Veri İhracı + Hesap Silme (Faz 5, 2026-05-09)
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_09g__kvkk_veri_silme_ihrac.sql
 *
 * RPC'ler:
 *   - firma_veri_ihrac()                 → JSON (sahip|yönetici)
 *   - firma_veri_silme_talep_et(p_onay)  → 30 gün soft-delete (sahip)
 *   - firma_veri_silme_iptal()           → talep iptal (sahip)
 *   - firma_veri_silme_durum()           → UI banner state
 *
 * UI: app.html içindeki #veri-modal-bg modalı.
 *   - Verimi İndir butonu  → ihraç (sahip|yönetici görür)
 *   - Tehlikeli Alan kutusu → sadece sahip görür (data-roles="sahip" gating)
 * =========================================================================== */

(function () {
  'use strict';

  function _$(id) { return document.getElementById(id); }

  function _toast(msg, kind) {
    if (typeof window.showToast === 'function') return window.showToast(msg, kind);
    if (kind === 'error') console.error(msg); else console.log(msg);
  }

  function _isSahip() {
    return (window._authUserRol || '').toLowerCase() === 'sahip';
  }

  function openVeriModal() {
    const bg = _$('veri-modal-bg');
    if (!bg) return;
    bg.style.display = 'flex';
    bg.classList.remove('hidden');

    // Form temizle
    const onay = _$('veri-silme-onay-inp');
    if (onay) onay.value = '';
    const err = _$('veri-silme-error');
    if (err) { err.textContent = ''; err.style.display = 'none'; }

    // Aktif silme talebi varsa banner göster
    veriSilmeDurumYukle();
  }

  function closeVeriModal() {
    const bg = _$('veri-modal-bg');
    if (!bg) return;
    bg.style.display = 'none';
    bg.classList.add('hidden');
  }

  // ── Veri ihracı: RPC çağır, JSON dosyası olarak indir ─────────────────────
  async function veriIhracIndir() {
    const btn = _$('veri-ihrac-btn');
    const sb = (typeof window.getSB === 'function') ? window.getSB() : null;
    if (!sb) return _toast('Bağlantı yok', 'error');

    if (btn) {
      btn.disabled = true;
      btn.dataset.orig = btn.innerHTML;
      btn.innerHTML = '⏳ Hazırlanıyor…';
    }

    try {
      const { data, error } = await sb.rpc('firma_veri_ihrac');
      if (error) throw error;

      // Dosya adı: fleetly_<firmaad>_<ts>.json
      const firmaAd = (data?.firma?.ad || 'firma')
        .toString().replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 30);
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const filename = `fleetly_${firmaAd}_${ts}.json`;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      _toast('✅ Verileriniz indirildi: ' + filename, 'success');
    } catch (err) {
      console.error('[veri-yonetimi] ihraç hatası:', err);
      _toast('❌ Veri ihracı başarısız: ' + (err?.message || 'bilinmeyen hata'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
      }
    }
  }

  // ── Silme talebi (30 gün soft-delete) ─────────────────────────────────────
  async function veriSilmeTalep() {
    if (!_isSahip()) {
      _toast('Yalnızca firma sahibi silme talebi başlatabilir', 'error');
      return;
    }

    const inp = _$('veri-silme-onay-inp');
    const err = _$('veri-silme-error');
    const onay = (inp?.value || '').trim();
    const expected = 'HESABIMI SIL';

    if (onay !== expected) {
      if (err) {
        err.textContent = `Onay için kutuya tam olarak "${expected}" yazın (büyük harf, Türkçesiz).`;
        err.style.display = 'block';
      }
      return;
    }

    if (!confirm(
      'Hesabınız 30 gün sonra kalıcı olarak silinecek.\n\n' +
      'Tüm araçlar, sürücüler, müşteriler, iş emirleri, yakıt fişleri, ' +
      'harcırah ve POD kayıtları SİLİNECEK. Bu süre içinde giriş yaparak iptal edebilirsiniz.\n\n' +
      'Devam edilsin mi?'
    )) return;

    const btn = _$('veri-silme-talep-btn');
    if (btn) {
      btn.disabled = true;
      btn.dataset.orig = btn.innerHTML;
      btn.innerHTML = '⏳ Talep gönderiliyor…';
    }

    try {
      const sb = window.getSB();
      const { data, error } = await sb.rpc('firma_veri_silme_talep_et', { p_onay_metni: onay });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      _toast('✅ ' + (row?.mesaj || 'Talep alındı'), 'success');
      if (inp) inp.value = '';
      if (err) { err.textContent = ''; err.style.display = 'none'; }
      await veriSilmeDurumYukle();
    } catch (e) {
      console.error('[veri-yonetimi] silme talep hatası:', e);
      _toast('❌ ' + (e?.message || 'Hata'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
      }
    }
  }

  // ── Silme talebi iptal ────────────────────────────────────────────────────
  async function veriSilmeIptal() {
    if (!_isSahip()) {
      _toast('Yalnızca sahip iptal edebilir', 'error');
      return;
    }
    if (!confirm('Silme talebi iptal edilsin mi?')) return;

    const btn = _$('veri-silme-iptal-btn');
    if (btn) {
      btn.disabled = true;
      btn.dataset.orig = btn.innerHTML;
      btn.innerHTML = '⏳…';
    }

    try {
      const sb = window.getSB();
      const { data, error } = await sb.rpc('firma_veri_silme_iptal');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      _toast('✅ ' + (row?.mesaj || 'İptal edildi'), 'success');
      await veriSilmeDurumYukle();
    } catch (e) {
      console.error('[veri-yonetimi] iptal hatası:', e);
      _toast('❌ ' + (e?.message || 'Hata'), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
      }
    }
  }

  // ── Durum sorgu (modal açılışında banner doldur) ──────────────────────────
  async function veriSilmeDurumYukle() {
    const banner   = _$('veri-silme-banner');
    const formArea = _$('veri-silme-form-area');
    if (!banner) return;

    try {
      const sb = window.getSB();
      const { data, error } = await sb.rpc('firma_veri_silme_durum');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;

      if (row?.silme_aktif) {
        const tarih = row.kalici_at
          ? new Date(row.kalici_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
          : '—';
        const kalan = (row.kalan_gun ?? 0) + ' gün';
        banner.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
            <div style="flex:1;min-width:240px;">
              <div style="font-size:13px;font-weight:700;color:#fb923c;">⚠ Silme talebi aktif</div>
              <div style="margin-top:5px;font-size:12px;color:var(--text2,#a8b8d8);line-height:1.55;">
                Hesabınız <strong>${tarih}</strong> tarihinde kalıcı olarak silinecek.
                Kalan: <strong>${kalan}</strong>.
              </div>
            </div>
            <button onclick="veriSilmeIptal()" id="veri-silme-iptal-btn"
              style="background:#16A974;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;">
              Talebi İptal Et
            </button>
          </div>
        `;
        banner.style.display = 'block';
        if (formArea) formArea.style.display = 'none';
      } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
        if (formArea) formArea.style.display = '';
      }
    } catch (e) {
      console.warn('[veri-yonetimi] durum yüklenemedi:', e?.message);
      // Sessiz fail — banner gizli kalır, form normal görünür
    }
  }

  // ── Global expose ─────────────────────────────────────────────────────────
  window.openVeriModal       = openVeriModal;
  window.closeVeriModal      = closeVeriModal;
  window.veriIhracIndir      = veriIhracIndir;
  window.veriSilmeTalep      = veriSilmeTalep;
  window.veriSilmeIptal      = veriSilmeIptal;
  window.veriSilmeDurumYukle = veriSilmeDurumYukle;

  console.info('[veri-yonetimi] modül yüklendi');
})();
