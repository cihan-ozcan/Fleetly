/* ════════════════════════════════════════════════════════════════
   HARCIRAH — Uzak İller + Ayarlar sekmeleri (2026-05-08, REST pattern)
   ════════════════════════════════════════════════════════════════
   Bağımlılıklar (window):
     - window.sbUrl(path)          — Supabase REST URL helper
     - window.sbHeaders()          — Auth header builder (Bearer + apikey)
     - window.currentFirmaId       — aktif firma_id (HarcirahAPI ile aynı)
     - toast() — bildirim helper (varsa)
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

  function _firmaId() { return window.currentFirmaId || null; }
  function _toast(msg, kind) {
    if (typeof window.toast === 'function') return window.toast(msg, kind);
    if (kind === 'error') console.error(msg); else console.log(msg);
  }
  function fmtNum(v, decimals) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('tr-TR', {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals || 2
    });
  }

  // ──────────────────────────────────────────────────────────
  // Supabase REST helpers (HarcirahAPI ile aynı pattern)
  // ──────────────────────────────────────────────────────────
  async function _sb(method, path, body) {
    if (!window.sbUrl || !window.sbHeaders) {
      throw new Error('Supabase yardımcıları yüklü değil');
    }
    const opts = {
      method,
      headers: { ...window.sbHeaders(), 'Content-Type': 'application/json' }
    };
    // PostgREST: select() davranışı için representation
    if (method === 'POST' || method === 'PATCH') {
      opts.headers['Prefer'] = 'return=representation,resolution=merge-duplicates';
    }
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(window.sbUrl(path), opts);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : null;
  }

  async function _rpc(name, params) {
    return _sb('POST', `rpc/${name}`, params);
  }

  // ════════════════════════════════════════════════════════════
  // UZAK İLLER SEKMESİ
  // ════════════════════════════════════════════════════════════
  let _bolgeOnerileri = {};

  async function harcRenderUzakIller() {
    if (!_firmaId()) {
      console.warn('[harcirah-uzak-iller] firma_id yok, render iptal');
      return;
    }
    await Promise.all([
      _loadBolgeTarifeleri(),
      _loadIlTarifeleri(),
      _loadIlListesi()
    ]);
  }

  async function _loadBolgeTarifeleri() {
    const firmaId = _firmaId();
    if (!firmaId) return;
    let kayitlar = [];
    try {
      kayitlar = await _sb('GET',
        `harcirah_bolge_tarife?firma_id=eq.${firmaId}&select=*`) || [];
    } catch (e) { console.warn('Bölge tarifeleri yüklenemedi:', e); }

    const map = {};
    kayitlar.forEach(k => { map[k.bolge] = k; });

    const tbody = document.getElementById('harc-bolge-tbody');
    if (!tbody) return;
    tbody.innerHTML = BOLGE_LISTE.map(b => {
      const k = map[b.kod];
      const oneri = _bolgeOnerileri[b.kod];
      const oneriText = oneri
        ? `💡 ${fmtNum(oneri.onerilen_tl_km, 1)} TL/km`
        : '<span style="color:var(--muted);font-size:11px;">öneri için yukarıdaki butona tıkla</span>';
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
    const firmaId = _firmaId();
    if (!firmaId) {
      _toast('Firma bilgisi yüklenmemiş — sayfayı yenileyip tekrar deneyin', 'error');
      return;
    }
    try {
      const data = await _rpc('harcirah_km_birim_oneri',
        { p_firma_id: firmaId, p_bolge: null });
      _bolgeOnerileri = {};
      (data || []).forEach(r => { _bolgeOnerileri[r.bolge] = r; });
      await _loadBolgeTarifeleri();
      const adet = Object.keys(_bolgeOnerileri).length;
      _toast(`✓ ${adet} bölge için öneri hesaplandı`, 'success');
    } catch (e) {
      console.error(e);
      _toast('Öneri alınamadı: ' + e.message, 'error');
    }
  }

  async function harcBolgeTarifeKaydet(bolge) {
    const firmaId = _firmaId();
    if (!firmaId) return;
    const inp = document.getElementById('bolge-km-' + bolge);
    const val = parseFloat((inp?.value || '').replace(',', '.'));
    if (!val || val <= 0) {
      // Boş bırakıldıysa kaydı sil
      try {
        await _sb('DELETE',
          `harcirah_bolge_tarife?firma_id=eq.${firmaId}&bolge=eq.${bolge}`);
      } catch {}
      return;
    }
    try {
      await _sb('POST', 'harcirah_bolge_tarife', {
        firma_id: firmaId, bolge, km_birim: val, aktif_mi: true
      });
      _toast(`✓ ${BOLGE_LISTE.find(b => b.kod === bolge)?.ad} = ${val} TL/km`, 'success');
      _loadBolgeTarifeleri();
    } catch (e) {
      _toast('Kaydedilemedi: ' + e.message, 'error');
    }
  }

  async function harcBolgeTarifeAktif(bolge, aktif) {
    const firmaId = _firmaId();
    if (!firmaId) return;
    try {
      await _sb('PATCH',
        `harcirah_bolge_tarife?firma_id=eq.${firmaId}&bolge=eq.${bolge}`,
        { aktif_mi: aktif });
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
    const firmaId = _firmaId();
    if (!firmaId) return;
    try {
      const data = await _sb('GET',
        `harcirah_il_tarife?firma_id=eq.${firmaId}&select=*&order=il.asc`) || [];
      const tbody = document.getElementById('harc-il-tbody');
      if (!tbody) return;
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Henüz il bazlı özel tarife yok.</td></tr>';
        return;
      }
      tbody.innerHTML = data.map(r => {
        const tip   = r.km_birim != null ? 'TL/km' : 'Sabit';
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
    try {
      const data = await _sb('GET', 'tr_il_bolge?select=il,bolge&order=il.asc') || [];
      const dl = document.getElementById('harc-il-list');
      if (dl) {
        dl.innerHTML = data.map(r =>
          `<option value="${r.il}">${r.il} (${BOLGE_LISTE.find(b => b.kod === r.bolge)?.ad || r.bolge})</option>`
        ).join('');
      }
    } catch {}
  }

  function openHarcIlTarifeModal(eskiIl) {
    const firmaId = _firmaId();
    if (!firmaId) { _toast('Firma bilgisi yüklenmemiş', 'error'); return; }

    document.getElementById('harc-il-eski-il').value = eskiIl || '';
    document.getElementById('harc-il-modal-title').textContent =
      eskiIl ? `📍 ${eskiIl} — Tarife Düzenle` : '📍 Yeni İl Tarifesi';

    if (eskiIl) {
      (async () => {
        try {
          const arr = await _sb('GET',
            `harcirah_il_tarife?firma_id=eq.${firmaId}&il=eq.${encodeURIComponent(eskiIl)}&select=*`) || [];
          const data = arr[0];
          if (data) {
            document.getElementById('harc-il-il').value = data.il;
            document.getElementById('harc-il-il').disabled = true;
            if (data.km_birim != null) {
              document.querySelector('input[name="harc-il-tip"][value="km_birim"]').checked = true;
              document.getElementById('harc-il-km').value = data.km_birim;
              document.getElementById('harc-il-sabit').value = '';
            } else {
              document.querySelector('input[name="harc-il-tip"][value="sabit_tutar"]').checked = true;
              document.getElementById('harc-il-sabit').value = data.sabit_tutar;
              document.getElementById('harc-il-km').value = '';
            }
            document.getElementById('harc-il-notlar').value = data.notlar || '';
            harcIlTipSwitch();
          }
        } catch (e) { console.warn(e); }
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
    document.getElementById('harc-il-km-grup').style.display    = tip === 'km_birim'    ? '' : 'none';
    document.getElementById('harc-il-sabit-grup').style.display = tip === 'sabit_tutar' ? '' : 'none';
  }

  async function harcIlTarifeKaydet() {
    const firmaId = _firmaId();
    if (!firmaId) { _toast('Firma bilgisi yok', 'error'); return; }
    const il = document.getElementById('harc-il-il').value.trim();
    if (!il) { _toast('İl seçin', 'error'); return; }
    const tip = document.querySelector('input[name="harc-il-tip"]:checked').value;
    const payload = {
      firma_id: firmaId, il, aktif_mi: true,
      notlar: document.getElementById('harc-il-notlar').value.trim() || null,
      km_birim: null, sabit_tutar: null
    };
    if (tip === 'km_birim') {
      const v = parseFloat(document.getElementById('harc-il-km').value);
      if (!v || v <= 0) { _toast('Geçerli TL/km girin', 'error'); return; }
      payload.km_birim = v;
    } else {
      const v = parseFloat(document.getElementById('harc-il-sabit').value);
      if (!v || v <= 0) { _toast('Geçerli sabit tutar girin', 'error'); return; }
      payload.sabit_tutar = v;
    }
    try {
      await _sb('POST', 'harcirah_il_tarife', payload);
      _toast(`✓ ${il} kaydedildi`, 'success');
      closeHarcIlTarifeModal();
      _loadIlTarifeleri();
    } catch (e) {
      _toast('Kaydedilemedi: ' + e.message, 'error');
    }
  }

  async function harcIlTarifeSil(il) {
    if (!confirm(`${il} özel tarifesi silinsin mi? Sonrasında bölge tarifesi kullanılır.`)) return;
    const firmaId = _firmaId();
    try {
      await _sb('DELETE',
        `harcirah_il_tarife?firma_id=eq.${firmaId}&il=eq.${encodeURIComponent(il)}`);
      _toast(`✓ ${il} silindi`, 'success');
      _loadIlTarifeleri();
    } catch (e) {
      _toast('Silinemedi: ' + e.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════════
  // AYARLAR SEKMESİ — kural seti
  // ════════════════════════════════════════════════════════════
  async function harcKuralYukle() {
    const firmaId = _firmaId();
    if (!firmaId) {
      console.warn('[harcirah] firma_id yok, ayarlar yüklenemiyor');
      return;
    }
    try {
      const arr = await _sb('GET',
        `harcirah_kural_seti?firma_id=eq.${firmaId}&select=*`) || [];
      const k = arr[0] || {};
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
      set('harc-set-dolu-yuzde',      k.dolu_donus_yuzde     ?? 50);
      set('harc-set-bos-yuzde',       k.bos_donus_yuzde      ?? 0);
      set('harc-set-minimum',         k.minimum_tutar        ?? 600);
      set('harc-set-kademe-500',      k.kademe_500plus_yuzde ?? 0);
      set('harc-set-kademe-900',      k.kademe_900plus_yuzde ?? 0);
      setChk('harc-set-konaklama-aktif', k.konaklama_aktif    || false);
      set('harc-set-konaklama-km',    k.konaklama_min_km     ?? 900);
      set('harc-set-konaklama-tutar', k.konaklama_tutar      ?? 0);
      set('harc-set-notlar',          k.notlar               || '');
    } catch (e) {
      console.warn('Kural seti yüklenemedi:', e);
    }
  }

  async function harcKuralKaydet() {
    const firmaId = _firmaId();
    if (!firmaId) { _toast('Firma bilgisi yok', 'error'); return; }
    const num = (id, dflt) => {
      const el = document.getElementById(id);
      const v = el ? parseFloat(el.value) : NaN;
      return isNaN(v) ? dflt : v;
    };
    const intval = (id, dflt) => {
      const el = document.getElementById(id);
      const v = el ? parseInt(el.value, 10) : NaN;
      return isNaN(v) ? dflt : v;
    };
    const chk = (id) => !!document.getElementById(id)?.checked;
    const txt = (id) => document.getElementById(id)?.value?.trim() || null;

    const payload = {
      firma_id:             firmaId,
      dolu_donus_yuzde:     num('harc-set-dolu-yuzde',    50),
      bos_donus_yuzde:      num('harc-set-bos-yuzde',     0),
      minimum_tutar:        num('harc-set-minimum',       600),
      kademe_500plus_yuzde: num('harc-set-kademe-500',    0),
      kademe_900plus_yuzde: num('harc-set-kademe-900',    0),
      konaklama_aktif:      chk('harc-set-konaklama-aktif'),
      konaklama_min_km:     intval('harc-set-konaklama-km',    900),
      konaklama_tutar:      num('harc-set-konaklama-tutar',    0),
      notlar:               txt('harc-set-notlar')
    };
    try {
      await _sb('POST', 'harcirah_kural_seti', payload);
      _toast('✓ Ayarlar kaydedildi', 'success');
    } catch (e) {
      console.error(e);
      _toast('Kaydedilemedi: ' + e.message, 'error');
    }
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
