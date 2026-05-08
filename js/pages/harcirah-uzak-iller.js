/* ════════════════════════════════════════════════════════════════
   HARCIRAH — Uzak İller + Ayarlar sekmeleri (2026-05-08)
   ════════════════════════════════════════════════════════════════
   Bağımlılıklar:
     - getSB() — Supabase client
     - toast() — bildirim helper
     - harcirah-page.js — switchHarcirahTab fonksiyonu içinden tetiklenir
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const BOLGE_LISTE = [
    { kod: 'marmara',      ad: 'Marmara' },
    { kod: 'ege',          ad: 'Ege' },
    { kod: 'akdeniz',      ad: 'Akdeniz' },
    { kod: 'ic_anadolu',   ad: 'İç Anadolu' },
    { kod: 'karadeniz',    ad: 'Karadeniz' },
    { kod: 'dogu_anadolu', ad: 'Doğu Anadolu' },
    { kod: 'guneydogu',    ad: 'Güneydoğu' }
  ];

  function getSB() { return window.supabase || window.sb || null; }

  function fmtNum(v, decimals) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('tr-TR', {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals || 2
    });
  }

  // ════════════════════════════════════════════════════════════
  // UZAK İLLER SEKMESİ
  // ════════════════════════════════════════════════════════════
  let _bolgeOnerileri = {};   // {kod: {onerilen_tl_km, hesap_notu}}

  async function harcRenderUzakIller() {
    await Promise.all([
      _loadBolgeTarifeleri(),
      _loadIlTarifeleri(),
      _loadIlListesi()
    ]);
  }

  async function _loadBolgeTarifeleri() {
    const sb = getSB();
    if (!sb) return;
    let kayitlar = [];
    try {
      const { data, error } = await sb.from('harcirah_bolge_tarife').select('*');
      if (error) throw error;
      kayitlar = data || [];
    } catch (e) {
      console.warn('Bölge tarifeleri yüklenemedi:', e);
    }
    const map = {};
    kayitlar.forEach(k => { map[k.bolge] = k; });

    const tbody = document.getElementById('harc-bolge-tbody');
    if (!tbody) return;
    tbody.innerHTML = BOLGE_LISTE.map(b => {
      const k = map[b.kod];
      const oneri = _bolgeOnerileri[b.kod];
      const oneriText = oneri ? `💡 ${fmtNum(oneri.onerilen_tl_km, 1)} TL/km` : '<span style="color:var(--muted);font-size:11px;">öneri için yukarıdaki butona tıkla</span>';
      const oneriTitle = oneri ? oneri.hesap_notu : '';
      return `<tr data-bolge="${b.kod}">
        <td style="font-weight:600;">${b.ad}</td>
        <td>
          <input type="number" min="0" step="0.1" class="srm-inp" style="width:100px;"
                 id="bolge-km-${b.kod}" value="${k && k.km_birim != null ? k.km_birim : ''}"
                 onblur="harcBolgeTarifeKaydet('${b.kod}')"
                 placeholder="—" />
        </td>
        <td title="${oneriTitle}">
          ${oneriText}
          ${oneri ? `<button class="srm-btn-sec" style="font-size:10px;padding:2px 8px;margin-left:6px;" onclick="harcBolgeOneriKabul('${b.kod}', ${oneri.onerilen_tl_km})">Kabul</button>` : ''}
        </td>
        <td>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;">
            <input type="checkbox" ${k && k.aktif_mi ? 'checked' : ''}
                   onchange="harcBolgeTarifeAktif('${b.kod}', this.checked)" />
            ${k && k.aktif_mi ? 'Aktif' : 'Pasif'}
          </label>
        </td>
      </tr>`;
    }).join('');
  }

  async function harcLoadBolgeOnerileri() {
    const sb = getSB();
    if (!sb) return;
    const firmaId = await _getFirmaId();
    if (!firmaId) return;
    try {
      const { data, error } = await sb.rpc('harcirah_km_birim_oneri', {
        p_firma_id: firmaId, p_bolge: null
      });
      if (error) throw error;
      _bolgeOnerileri = {};
      (data || []).forEach(r => { _bolgeOnerileri[r.bolge] = r; });
      await _loadBolgeTarifeleri();
      if (typeof toast === 'function') toast('Öneriler yakın tarifelerden hesaplandı', 'success');
    } catch (e) {
      console.error(e);
      if (typeof toast === 'function') toast('Öneri alınamadı: ' + e.message, 'error');
    }
  }

  async function harcBolgeTarifeKaydet(bolge) {
    const sb = getSB();
    if (!sb) return;
    const firmaId = await _getFirmaId();
    if (!firmaId) return;
    const inp = document.getElementById('bolge-km-' + bolge);
    const val = parseFloat((inp.value || '').replace(',', '.'));
    if (!val || val <= 0) {
      // Boş bırakıldıysa kaydı sil
      try {
        await sb.from('harcirah_bolge_tarife').delete()
          .eq('firma_id', firmaId).eq('bolge', bolge);
      } catch {}
      return;
    }
    try {
      const { error } = await sb.from('harcirah_bolge_tarife').upsert({
        firma_id: firmaId, bolge, km_birim: val, aktif_mi: true
      });
      if (error) throw error;
      if (typeof toast === 'function') toast(`✓ ${BOLGE_LISTE.find(b => b.kod === bolge)?.ad} tarife kaydedildi`, 'success');
      _loadBolgeTarifeleri();
    } catch (e) {
      if (typeof toast === 'function') toast('Kaydedilemedi: ' + e.message, 'error');
    }
  }

  async function harcBolgeTarifeAktif(bolge, aktif) {
    const sb = getSB();
    if (!sb) return;
    const firmaId = await _getFirmaId();
    if (!firmaId) return;
    try {
      await sb.from('harcirah_bolge_tarife').update({ aktif_mi: aktif })
        .eq('firma_id', firmaId).eq('bolge', bolge);
      _loadBolgeTarifeleri();
    } catch (e) { console.warn(e); }
  }

  async function harcBolgeOneriKabul(bolge, deger) {
    const inp = document.getElementById('bolge-km-' + bolge);
    if (inp) inp.value = deger;
    await harcBolgeTarifeKaydet(bolge);
  }

  // ────── İl bazlı tarifeler ──────
  async function _loadIlTarifeleri() {
    const sb = getSB();
    if (!sb) return;
    try {
      const { data, error } = await sb.from('harcirah_il_tarife').select('*').order('il');
      if (error) throw error;
      const tbody = document.getElementById('harc-il-tbody');
      if (!tbody) return;
      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Henüz il bazlı özel tarife yok.</td></tr>';
        return;
      }
      tbody.innerHTML = data.map(r => {
        const tip  = r.km_birim != null ? 'TL/km' : 'Sabit';
        const tutar = r.km_birim != null
          ? fmtNum(r.km_birim, 1) + ' TL/km'
          : fmtNum(r.sabit_tutar, 0) + ' ₺';
        return `<tr>
          <td style="font-weight:600;">${r.il}</td>
          <td><span class="srm-pill" style="font-size:10px;">${tip}</span></td>
          <td style="font-family:var(--font-mono);">${tutar}</td>
          <td>${r.aktif_mi ? '✓' : '—'}</td>
          <td style="font-size:11px;color:var(--muted);">${r.notlar || ''}</td>
          <td>
            <button class="srm-btn-sec" style="font-size:11px;padding:3px 8px;" onclick="openHarcIlTarifeModal('${r.il}')">Düzenle</button>
            <button class="srm-btn-sec" style="font-size:11px;padding:3px 8px;color:var(--red);" onclick="harcIlTarifeSil('${r.il}')">Sil</button>
          </td>
        </tr>`;
      }).join('');
    } catch (e) {
      console.warn('İl tarifeleri yüklenemedi:', e);
    }
  }

  async function _loadIlListesi() {
    const sb = getSB();
    if (!sb) return;
    try {
      const { data, error } = await sb.from('tr_il_bolge').select('il, bolge').order('il');
      if (error) throw error;
      const dl = document.getElementById('harc-il-list');
      if (dl) {
        dl.innerHTML = (data || []).map(r =>
          `<option value="${r.il}">${r.il} (${BOLGE_LISTE.find(b => b.kod === r.bolge)?.ad || r.bolge})</option>`
        ).join('');
      }
    } catch {}
  }

  function openHarcIlTarifeModal(eskiIl) {
    document.getElementById('harc-il-eski-il').value = eskiIl || '';
    document.getElementById('harc-il-modal-title').textContent =
      eskiIl ? `📍 ${eskiIl} — Tarife Düzenle` : '📍 Yeni İl Tarifesi';
    if (eskiIl) {
      // Mevcut kaydı yükle
      (async () => {
        const sb = getSB();
        const firmaId = await _getFirmaId();
        const { data } = await sb.from('harcirah_il_tarife').select('*')
          .eq('firma_id', firmaId).eq('il', eskiIl).maybeSingle();
        if (data) {
          document.getElementById('harc-il-il').value = data.il;
          document.getElementById('harc-il-il').disabled = true;
          if (data.km_birim != null) {
            document.querySelector('input[name="harc-il-tip"][value="km_birim"]').checked = true;
            document.getElementById('harc-il-km').value = data.km_birim;
          } else {
            document.querySelector('input[name="harc-il-tip"][value="sabit_tutar"]').checked = true;
            document.getElementById('harc-il-sabit').value = data.sabit_tutar;
          }
          document.getElementById('harc-il-notlar').value = data.notlar || '';
          harcIlTipSwitch();
        }
      })();
    } else {
      document.getElementById('harc-il-il').value = '';
      document.getElementById('harc-il-il').disabled = false;
      document.getElementById('harc-il-km').value = '';
      document.getElementById('harc-il-sabit').value = '';
      document.getElementById('harc-il-notlar').value = '';
      document.querySelector('input[name="harc-il-tip"][value="km_birim"]').checked = true;
      harcIlTipSwitch();
    }
    document.getElementById('harc-il-modal-bg').classList.remove('hidden');
  }

  function closeHarcIlTarifeModal() {
    document.getElementById('harc-il-modal-bg').classList.add('hidden');
  }

  function harcIlTipSwitch() {
    const tip = document.querySelector('input[name="harc-il-tip"]:checked').value;
    document.getElementById('harc-il-km-grup').style.display    = tip === 'km_birim' ? '' : 'none';
    document.getElementById('harc-il-sabit-grup').style.display = tip === 'sabit_tutar' ? '' : 'none';
  }

  async function harcIlTarifeKaydet() {
    const sb = getSB();
    const firmaId = await _getFirmaId();
    if (!sb || !firmaId) return;
    const il = document.getElementById('harc-il-il').value.trim();
    if (!il) { if (typeof toast === 'function') toast('İl seçin', 'error'); return; }
    const tip = document.querySelector('input[name="harc-il-tip"]:checked').value;
    const payload = { firma_id: firmaId, il, aktif_mi: true,
                      notlar: document.getElementById('harc-il-notlar').value.trim() || null,
                      km_birim: null, sabit_tutar: null };
    if (tip === 'km_birim') {
      const v = parseFloat(document.getElementById('harc-il-km').value);
      if (!v || v <= 0) { if (typeof toast === 'function') toast('Geçerli TL/km girin', 'error'); return; }
      payload.km_birim = v;
    } else {
      const v = parseFloat(document.getElementById('harc-il-sabit').value);
      if (!v || v <= 0) { if (typeof toast === 'function') toast('Geçerli sabit tutar girin', 'error'); return; }
      payload.sabit_tutar = v;
    }
    try {
      const { error } = await sb.from('harcirah_il_tarife').upsert(payload);
      if (error) throw error;
      if (typeof toast === 'function') toast(`✓ ${il} tarifesi kaydedildi`, 'success');
      closeHarcIlTarifeModal();
      _loadIlTarifeleri();
    } catch (e) {
      if (typeof toast === 'function') toast('Kaydedilemedi: ' + e.message, 'error');
    }
  }

  async function harcIlTarifeSil(il) {
    if (!confirm(`${il} özel tarifesi silinsin mi? Sonrasında bölge tarifesi kullanılır.`)) return;
    const sb = getSB();
    const firmaId = await _getFirmaId();
    try {
      await sb.from('harcirah_il_tarife').delete().eq('firma_id', firmaId).eq('il', il);
      if (typeof toast === 'function') toast(`✓ ${il} silindi`, 'success');
      _loadIlTarifeleri();
    } catch (e) {
      if (typeof toast === 'function') toast('Silinemedi: ' + e.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════════
  // AYARLAR SEKMESİ — kural seti
  // ════════════════════════════════════════════════════════════
  async function harcKuralYukle() {
    const sb = getSB();
    const firmaId = await _getFirmaId();
    if (!sb || !firmaId) return;
    try {
      const { data } = await sb.from('harcirah_kural_seti').select('*')
        .eq('firma_id', firmaId).maybeSingle();
      const k = data || {};
      document.getElementById('harc-set-dolu-yuzde').value      = k.dolu_donus_yuzde ?? 50;
      document.getElementById('harc-set-bos-yuzde').value       = k.bos_donus_yuzde ?? 0;
      document.getElementById('harc-set-minimum').value         = k.minimum_tutar ?? 600;
      document.getElementById('harc-set-kademe-500').value      = k.kademe_500plus_yuzde ?? 0;
      document.getElementById('harc-set-kademe-900').value      = k.kademe_900plus_yuzde ?? 0;
      document.getElementById('harc-set-konaklama-aktif').checked = k.konaklama_aktif || false;
      document.getElementById('harc-set-konaklama-km').value    = k.konaklama_min_km ?? 900;
      document.getElementById('harc-set-konaklama-tutar').value = k.konaklama_tutar ?? 0;
      document.getElementById('harc-set-notlar').value          = k.notlar || '';
    } catch (e) {
      console.warn('Kural seti yüklenemedi:', e);
    }
  }

  async function harcKuralKaydet() {
    const sb = getSB();
    const firmaId = await _getFirmaId();
    if (!sb || !firmaId) return;
    const payload = {
      firma_id: firmaId,
      dolu_donus_yuzde:     parseFloat(document.getElementById('harc-set-dolu-yuzde').value)      || 0,
      bos_donus_yuzde:      parseFloat(document.getElementById('harc-set-bos-yuzde').value)       || 0,
      minimum_tutar:        parseFloat(document.getElementById('harc-set-minimum').value)         || 0,
      kademe_500plus_yuzde: parseFloat(document.getElementById('harc-set-kademe-500').value)      || 0,
      kademe_900plus_yuzde: parseFloat(document.getElementById('harc-set-kademe-900').value)      || 0,
      konaklama_aktif:      document.getElementById('harc-set-konaklama-aktif').checked,
      konaklama_min_km:     parseInt(document.getElementById('harc-set-konaklama-km').value, 10)  || 900,
      konaklama_tutar:      parseFloat(document.getElementById('harc-set-konaklama-tutar').value) || 0,
      notlar:               document.getElementById('harc-set-notlar').value.trim() || null
    };
    try {
      const { error } = await sb.from('harcirah_kural_seti').upsert(payload);
      if (error) throw error;
      if (typeof toast === 'function') toast('✓ Ayarlar kaydedildi', 'success');
    } catch (e) {
      if (typeof toast === 'function') toast('Kaydedilemedi: ' + e.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════════
  // Yardımcı: aktif firma_id
  // ════════════════════════════════════════════════════════════
  async function _getFirmaId() {
    if (window.activeFirmaId) return window.activeFirmaId;
    if (window.fleetlyFirmaId) return window.fleetlyFirmaId;
    try {
      const sb = getSB();
      const u = (await sb.auth.getUser())?.data?.user;
      if (!u) return null;
      const { data } = await sb.from('firma_kullanicilar').select('firma_id')
        .eq('user_id', u.id).limit(1).maybeSingle();
      return data?.firma_id || null;
    } catch { return null; }
  }

  // ════════════════════════════════════════════════════════════
  // GLOBAL EXPORTS
  // ════════════════════════════════════════════════════════════
  window.harcRenderUzakIller    = harcRenderUzakIller;
  window.harcLoadBolgeOnerileri = harcLoadBolgeOnerileri;
  window.harcBolgeTarifeKaydet  = harcBolgeTarifeKaydet;
  window.harcBolgeTarifeAktif   = harcBolgeTarifeAktif;
  window.harcBolgeOneriKabul    = harcBolgeOneriKabul;
  window.openHarcIlTarifeModal  = openHarcIlTarifeModal;
  window.closeHarcIlTarifeModal = closeHarcIlTarifeModal;
  window.harcIlTipSwitch        = harcIlTipSwitch;
  window.harcIlTarifeKaydet     = harcIlTarifeKaydet;
  window.harcIlTarifeSil        = harcIlTarifeSil;
  window.harcKuralYukle         = harcKuralYukle;
  window.harcKuralKaydet        = harcKuralKaydet;
})();
