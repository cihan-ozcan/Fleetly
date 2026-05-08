/* ════════════════════════════════════════════════════════════════
   HARCIRAH — Mesafe Hesabı (standalone, OSRM + Nominatim)
   ════════════════════════════════════════════════════════════════
   Sekme: Harcırah → 🧮 Mesafe Hesabı
   Bağımlılıklar (window):
     - window.OsrmHelper       — js/integrations/osrm-helper.js
     - window.sbUrl, sbHeaders — Supabase REST yardımcıları
     - window.currentFirmaId   — aktif firma_id
     - window.openHarcIlTarifeModal — Uzak İller modülü (Yeni İl / Düzenle)
     - window.openOpsIsEmriModal    — app-chunk-05'teki yeni iş emri modali
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let _state   = { yukle: null, teslim: null, sonRoute: null, sonHarc: null };
  let _yukleDeb, _teslimDeb;
  let _setupDone = false;

  function _$(id)   { return document.getElementById(id); }
  function _toast(msg, kind) {
    if (typeof window.toast === 'function') return window.toast(msg, kind);
    if (kind === 'error') console.error(msg); else console.log(msg);
  }

  // Input metni URL veya ham koordinat çiftine benziyor mu?
  // (Nominatim'e text-search yapılması anlamsız olan içerik tipleri)
  function _looksLikeUrlOrCoord(s) {
    const t = String(s || '').trim();
    if (!t) return false;
    if (/^https?:\/\//i.test(t)) return true;
    if (/^geo:/i.test(t)) return true;
    if (/^\/\/\/[a-z]+\.[a-z]+\.[a-z]+/i.test(t)) return true; // ///w3w
    if (/^maps\.app\.goo\.gl|^goo\.gl|^maps\.google\./i.test(t)) return true;
    // Ham koordinat: "41.0123,28.5678"
    if (/^-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}$/.test(t)) return true;
    return false;
  }

  // ──────────────────────────────────────────────────────────
  // Public — sekme açıldığında çağrılır (harcirah-page.js)
  // ──────────────────────────────────────────────────────────
  function harcRenderMesafe() {
    if (!_setupDone) _setupAutocompleteler();
    // Sekmeye geri gelindiğinde önceki sonuç kalmasın
    const sonuc = _$('harc-mesafe-sonuc');
    if (sonuc) sonuc.style.display = 'none';
  }

  function _setupAutocompleteler() {
    _bindAutocomplete('harc-mesafe-yukle',  'harc-mesafe-yukle-sug',  'harc-mesafe-yukle-info',  'yukle');
    _bindAutocomplete('harc-mesafe-teslim', 'harc-mesafe-teslim-sug', 'harc-mesafe-teslim-info', 'teslim');
    // Dış tıklamada öneri panelini kapat
    document.addEventListener('click', (ev) => {
      ['yukle', 'teslim'].forEach(k => {
        const sug = _$('harc-mesafe-' + k + '-sug');
        const inp = _$('harc-mesafe-' + k);
        if (!sug || !inp) return;
        if (sug.contains(ev.target) || inp.contains(ev.target)) return;
        sug.style.display = 'none';
      });
    });
    _setupDone = true;
  }

  function _bindAutocomplete(inputId, sugId, infoId, kind) {
    const inp = _$(inputId);
    const sug = _$(sugId);
    if (!inp || !sug) return;

    inp.addEventListener('input', () => {
      const q = inp.value.trim();
      _state[kind] = null;  // input değişti — eski seçim geçersiz
      const info = _$(infoId);
      if (info) info.textContent = '—';
      clearTimeout(kind === 'yukle' ? _yukleDeb : _teslimDeb);
      if (q.length < 3) { sug.style.display = 'none'; return; }

      // 🔗 Maps URL / koordinat algılama — Nominatim text search'a gitmeden
      // parseKonumUrl ile lat/lng çıkarılabiliyorsa direkt onu kullan.
      if (_looksLikeUrlOrCoord(q) && typeof window.parseKonumUrl === 'function') {
        const parsed = window.parseKonumUrl(q);
        if (parsed && parsed._shortLink) {
          // Kısa linki backend'e yolla (pg_net RPC) → uzun URL'i alıp yeniden parse et
          sug.style.display = 'none';
          if (info) info.textContent = '🔗 Kısa link çözümleniyor…';
          const reqQ = q;
          (async () => {
            const longUrl = await window.OsrmHelper.resolveShortUrl(reqQ);
            // Kullanıcı bu arada başka bir şey yazdıysa atla
            if (inp.value.trim() !== reqQ) return;
            if (!longUrl) {
              sug.innerHTML = `
                <div style="padding:10px 12px;font-size:11px;line-height:1.45;color:var(--text);">
                  ⚠ <strong>Kısa link çözümlenemedi.</strong><br>
                  <span style="opacity:.75;">Linki yeni sekmede açın → adres çubuğundaki uzun linki yapıştırın.</span>
                </div>`;
              sug.style.display = 'block';
              if (info) info.textContent = '—';
              return;
            }
            const reparsed = window.parseKonumUrl(longUrl);
            if (!reparsed || !isFinite(reparsed.lat) || !isFinite(reparsed.lng)) {
              sug.innerHTML = `
                <div style="padding:10px 12px;font-size:11px;line-height:1.45;color:var(--text);">
                  ⚠ <strong>Linkten koordinat çıkarılamadı.</strong>
                  <span style="opacity:.7;">Düz adres yazıp listeden seçebilirsiniz.</span>
                </div>`;
              sug.style.display = 'block';
              if (info) info.textContent = '—';
              return;
            }
            if (info) info.textContent = `✓ ${reparsed.lat.toFixed(4)}, ${reparsed.lng.toFixed(4)} · adres çözümleniyor…`;
            const reverse = await window.OsrmHelper.reverseGeocode(reparsed.lat, reparsed.lng);
            if (inp.value.trim() !== reqQ) return;
            const display = reverse?.display_name || `Koordinat ${reparsed.lat.toFixed(4)}, ${reparsed.lng.toFixed(4)}`;
            _state[kind] = { display_name: display, lat: reparsed.lat, lng: reparsed.lng, raw: reverse?.raw || null };
            if (info) info.textContent = `✓ ${reparsed.lat.toFixed(4)}, ${reparsed.lng.toFixed(4)}`;
          })();
          return;
        }
        if (parsed && parsed._w3w) {
          sug.innerHTML = `
            <div style="padding:10px 12px;font-size:11px;line-height:1.45;color:var(--text);opacity:.85;">
              ⚠ <strong>What3Words</strong> formatı şu an desteklenmiyor — koordinat veya tam adres yapıştırın.
            </div>`;
          sug.style.display = 'block';
          return;
        }
        if (parsed && isFinite(parsed.lat) && isFinite(parsed.lng)) {
          sug.style.display = 'none';
          if (info) info.textContent = `✓ ${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)} · adres çözümleniyor…`;
          // Reverse geocode ile insanca adres bul (DB'nin il tespiti için gerekli)
          (async () => {
            const reverse = await window.OsrmHelper.reverseGeocode(parsed.lat, parsed.lng);
            const display = reverse?.display_name || `Koordinat ${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)}`;
            _state[kind] = { display_name: display, lat: parsed.lat, lng: parsed.lng, raw: reverse?.raw || null };
            if (info) info.textContent = `✓ ${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)}`;
          })();
          return;
        }
        // URL gibi görünüyor ama parse edilemedi — Nominatim'e göndermek anlamsız
        sug.innerHTML = `
          <div style="padding:10px 12px;font-size:11px;line-height:1.45;color:var(--text);opacity:.85;">
            ⚠ Linkten koordinat çıkarılamadı. <span style="opacity:.7;">Düz adres metni yazıp listeden seçebilirsiniz.</span>
          </div>`;
        sug.style.display = 'block';
        return;
      }

      const t = setTimeout(async () => {
        if (!window.OsrmHelper) return;
        const results = await window.OsrmHelper.geocode(q, { limit: 5 });
        if (!results.length) {
          sug.innerHTML = '<div style="padding:10px;color:var(--muted);font-size:11px;">Sonuç bulunamadı</div>';
          sug.style.display = 'block';
          return;
        }
        sug.innerHTML = results.map((r, i) => `
          <div class="harc-mesafe-sug-item" data-idx="${i}"
               style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12px;line-height:1.4;"
               onmouseover="this.style.background='rgba(59,130,246,.10)'" onmouseout="this.style.background=''">
            ${r.display_name}
          </div>`).join('');
        sug.dataset.results = JSON.stringify(results);
        sug.style.display = 'block';
      }, 400);
      if (kind === 'yukle') _yukleDeb = t; else _teslimDeb = t;
    });

    sug.addEventListener('click', (ev) => {
      const item = ev.target.closest('.harc-mesafe-sug-item');
      if (!item) return;
      const idx = parseInt(item.dataset.idx, 10);
      const results = JSON.parse(sug.dataset.results || '[]');
      const r = results[idx];
      if (!r) return;
      inp.value = r.display_name;
      _state[kind] = r;
      sug.style.display = 'none';
      const info = _$(infoId);
      if (info) info.textContent = `✓ ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Hesapla / Temizle
  // ──────────────────────────────────────────────────────────
  async function harcMesafeHesapla() {
    if (!_state.yukle || !_state.teslim) {
      _toast('Önce iki adresi de listeden seçin', 'error');
      return;
    }
    const sonucEl  = _$('harc-mesafe-sonuc');
    const icerikEl = _$('harc-mesafe-sonuc-icerik');
    const btnIl    = _$('harc-mesafe-btn-il-ekle');
    if (!sonucEl || !icerikEl) return;
    sonucEl.style.display = '';
    icerikEl.innerHTML = '<div style="opacity:.7;font-size:13px;">⏳ Mesafe hesaplanıyor…</div>';
    if (btnIl) btnIl.style.display = 'none';

    const r = await window.OsrmHelper.route(
      _state.yukle.lat,  _state.yukle.lng,
      _state.teslim.lat, _state.teslim.lng
    );
    if (!r || r.km == null) {
      icerikEl.innerHTML = '⚠ Mesafe hesaplanamadı.';
      return;
    }
    _state.sonRoute = r;

    const kmTxt   = window.OsrmHelper.formatKm(r.km);
    const sureTxt = window.OsrmHelper.formatSure(r.sureDk);
    const kaynakTxt = r.kaynak === 'osrm'
      ? '<span style="color:#22c55e;font-size:11px;font-weight:600;">(OSRM)</span>'
      : '<span style="color:#eab308;font-size:11px;font-weight:600;">(yaklaşık)</span>';

    // Harcırah ön hesabı
    let harcHtml = '';
    _state.sonHarc = null;
    try {
      const firmaId = window.currentFirmaId;
      if (firmaId && window.sbUrl && window.sbHeaders) {
        const res = await fetch(window.sbUrl('rpc/harcirah_uzak_hesapla'), {
          method: 'POST',
          headers: { ...window.sbHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_firma_id:    firmaId,
            p_yukle_yeri:  _state.yukle.display_name,
            p_teslim_yeri: _state.teslim.display_name,
            p_yukle_lat:   _state.yukle.lat,  p_yukle_lng:  _state.yukle.lng,
            p_teslim_lat:  _state.teslim.lat, p_teslim_lng: _state.teslim.lng,
            p_kont_durum:  'Dolu',
            p_tahmini_km:  r.km
          })
        });
        if (res.ok) {
          const j = await res.json();
          _state.sonHarc = j;
          if (j && j.basari === true) {
            const tutarTxt = Number(j.tutar).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
            const birimTxt = j.km_birim != null ? (j.km_birim + ' TL/km') : 'sabit';
            harcHtml = `
              <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);">
                <div style="font-size:15px;">💰 Tahmini harcırah: <strong>${tutarTxt} ₺</strong></div>
                <div style="font-size:11px;opacity:.7;margin-top:3px;">
                  ${j.il || '?'} / ${j.bolge || '?'} · ${birimTxt} · kaynak: ${j.kaynak || '?'}
                </div>
              </div>`;
            if (btnIl && j.il && j.kaynak === 'bolge') btnIl.style.display = 'inline-flex';
          } else if (j && j.basari === false) {
            harcHtml = `
              <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#eab308;">
                ⚠ ${j.sebep || 'Harcırah hesaplanamadı'}
              </div>`;
            // İl tespit edilebildiyse "il tarifesine ekle" butonu açık olsun
            if (btnIl && j.il) btnIl.style.display = 'inline-flex';
          }
        }
      }
    } catch (e) {
      if (window.CFG && window.CFG.DEBUG) console.warn('[mesafe] harcırah hata:', e.message);
    }

    icerikEl.innerHTML = `
      <div style="font-size:20px;font-weight:700;line-height:1.3;">📍 ${kmTxt} km · ⏱ ${sureTxt} ${kaynakTxt}</div>
      <div style="font-size:11px;opacity:.65;margin-top:6px;line-height:1.4;">
        ${_state.yukle.display_name.split(',').slice(0,2).join(',')} <strong>→</strong>
        ${_state.teslim.display_name.split(',').slice(0,2).join(',')}
      </div>
      ${harcHtml}
    `;
  }

  function harcMesafeTemizle() {
    _state = { yukle: null, teslim: null, sonRoute: null, sonHarc: null };
    ['yukle', 'teslim'].forEach(k => {
      const inp = _$('harc-mesafe-' + k);
      if (inp) inp.value = '';
      const info = _$('harc-mesafe-' + k + '-info');
      if (info) info.textContent = '—';
      const sug = _$('harc-mesafe-' + k + '-sug');
      if (sug) sug.style.display = 'none';
    });
    const sonuc = _$('harc-mesafe-sonuc');
    if (sonuc) sonuc.style.display = 'none';
    const btnIl = _$('harc-mesafe-btn-il-ekle');
    if (btnIl) btnIl.style.display = 'none';
  }

  // ──────────────────────────────────────────────────────────
  // Aksiyon butonları
  // ──────────────────────────────────────────────────────────
  function harcMesafeIlTarifeyeEkle() {
    const il = _state.sonHarc && _state.sonHarc.il;
    if (!il) { _toast('İl bilgisi yok — önce hesaplayın', 'error'); return; }
    if (typeof window.openHarcIlTarifeModal === 'function') {
      // Yeni il ekleme moduna geç (mevcut tarife yoksa Düzenle/yeni fark etmez —
      // aynı modal her iki durumu da işliyor)
      window.openHarcIlTarifeModal(il);
    } else {
      _toast('Uzak İller modülü yüklenmemiş', 'error');
    }
  }

  function harcMesafeIsEmriAc() {
    if (typeof window.openOpsIsEmriModal !== 'function') {
      _toast('İş emri modülü yüklenmemiş', 'error'); return;
    }
    if (!_state.yukle || !_state.teslim) {
      _toast('Önce mesafeyi hesaplayın', 'error'); return;
    }
    // Modal'ı yeni-mod aç (parametresiz), sonra alanları doldur.
    // openOpsIsEmriModal({...}) çağrısı _opsDuzenlemeId'yi undefined yapıp
    // düzenleme akışını yanlışlıkla tetikleyebileceği için bilinçli olarak
    // parametresiz çağırıyoruz, sonra setTimeout ile alanları yazıyoruz.
    window.openOpsIsEmriModal();
    setTimeout(() => {
      const set = (id, v) => {
        const el = _$(id);
        if (el && v != null && v !== '') el.value = v;
      };
      const yk = _state.yukle, tk = _state.teslim, rt = _state.sonRoute;
      // Yer adları — display_name'in baş kısmı (genelde işyeri/mahalle)
      set('ops-m-yukle',  yk.display_name.split(',')[0].trim());
      set('ops-m-teslim', tk.display_name.split(',')[0].trim());
      // Konum URL'leri raw "lat,lng" formatında ver — parseKonumUrl bu formatı destekliyor
      set('ops-m-yukle-konum',  yk.lat + ',' + yk.lng);
      set('ops-m-teslim-konum', tk.lat + ',' + tk.lng);
      set('ops-m-tahmini-km',      rt && rt.km     != null ? rt.km     : '');
      set('ops-m-tahmini-sure-dk', rt && rt.sureDk != null ? rt.sureDk : '');
      // Preview badge'leri ve OSRM ön-hesap badge'i tetikle
      ['yukle', 'teslim'].forEach(k => {
        const inp = _$('ops-m-' + k + '-konum');
        if (inp && typeof window.opsKonumLinkPreview === 'function') {
          window.opsKonumLinkPreview(inp, 'ops-m-' + k + '-konum-preview');
        }
      });
    }, 60);
  }

  // ──────────────────────────────────────────────────────────
  // Export
  // ──────────────────────────────────────────────────────────
  window.harcRenderMesafe         = harcRenderMesafe;
  window.harcMesafeHesapla        = harcMesafeHesapla;
  window.harcMesafeTemizle        = harcMesafeTemizle;
  window.harcMesafeIlTarifeyeEkle = harcMesafeIlTarifeyeEkle;
  window.harcMesafeIsEmriAc       = harcMesafeIsEmriAc;
})();
