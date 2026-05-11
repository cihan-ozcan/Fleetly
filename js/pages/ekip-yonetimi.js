/* =============================================================================
 * ekip-yonetimi.js — Ofis kullanıcı davet, rol değiştirme, kaldırma
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_09c__firma_kullanici_davet.sql
 *
 * RPC'ler:
 *   - firma_kullanici_davet_olustur(p_email, p_rol, p_ad, p_notlar)
 *   - firma_kullanici_davet_kabul_et(p_kod)   ← /davet/ çağırır
 *   - firma_kullanici_davet_iptal(p_davet_id)
 *   - firma_kullanici_listele()
 *   - firma_kullanici_rol_degistir(p_user_id, p_yeni_rol)
 *   - firma_kullanici_kaldir(p_user_id)
 *
 * Yetki: yalnızca sahip / yonetici. Bu modülün tetikleyici sidebar item'ı
 * sadece bu rollerde görünecek (rol bazlı UI gating Faz 3'te tam kapsanır;
 * Faz 2'de davet RPC'si zaten DB seviyesinde engelleyecek).
 * =========================================================================== */

(function () {
  'use strict';

  const ROL_LABEL = {
    sahip: 'Sahip', yonetici: 'Yönetici',
    operasyoncu: 'Operasyoncu', muhasebeci: 'Muhasebeci',
    sofor: 'Şoför', uye: 'Üye'
  };
  const ROL_COLORS = {
    sahip: '#FF6B1F', yonetici: '#3b82f6',
    operasyoncu: '#10b981', muhasebeci: '#a78bfa',
    sofor: '#64748b', uye: '#64748b'
  };

  function _$(id) { return document.getElementById(id); }
  function _toast(msg, kind) {
    if (typeof window.showToast === 'function') return window.showToast(msg, kind);
    if (kind === 'error') console.error(msg); else console.log(msg);
  }

  function openEkipModal() {
    const bg = _$('ekip-modal-bg');
    if (!bg) return;
    bg.style.display = 'flex';
    bg.classList.remove('hidden');
    ekipListeYukle();
  }

  function closeEkipModal() {
    const bg = _$('ekip-modal-bg');
    if (!bg) return;
    bg.style.display = 'none';
    bg.classList.add('hidden');
    // Form alanlarını temizle
    ['ekip-davet-email','ekip-davet-ad'].forEach(id => { const e = _$(id); if (e) e.value = ''; });
    _$('ekip-davet-error').style.display = 'none';
    _$('ekip-davet-success').style.display = 'none';
  }

  function _setDavetErr(msg) {
    const el = _$('ekip-davet-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
    _$('ekip-davet-success').style.display = 'none';
  }

  function _setDavetSuccess(html) {
    const el = _$('ekip-davet-success');
    if (!el) return;
    el.innerHTML = html;
    el.style.display = html ? 'block' : 'none';
    _$('ekip-davet-error').style.display = 'none';
  }

  async function ekipDavetOlustur() {
    _setDavetErr(''); _setDavetSuccess('');
    const email = _$('ekip-davet-email').value.trim().toLowerCase();
    const ad    = _$('ekip-davet-ad').value.trim() || null;
    const rol   = _$('ekip-davet-rol').value;
    if (!email || !email.includes('@')) return _setDavetErr('Geçerli email girin');
    if (!['yonetici','operasyoncu','muhasebeci'].includes(rol)) return _setDavetErr('Rol geçersiz');

    const btn = _$('ekip-davet-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Oluşturuluyor…'; }
    try {
      // SDK yerine doğrudan fetch — Supabase JS SDK auth zincirinde
      // askıda kalıyor (V5 known issue). sbUrl + sbHeaders memory pattern.
      if (typeof window.sbUrl !== 'function' || typeof window.sbHeaders !== 'function') {
        // app-chunk-02.js'deki global fonksiyonlar; window. olmadan da erişilebilir
        if (typeof sbUrl !== 'function' || typeof sbHeaders !== 'function') {
          throw new Error('sbUrl/sbHeaders yok — config.js yüklenmemiş olabilir');
        }
      }
      const _sbUrl     = (typeof window.sbUrl === 'function')     ? window.sbUrl     : sbUrl;
      const _sbHeaders = (typeof window.sbHeaders === 'function') ? window.sbHeaders : sbHeaders;

      const ctrl = new AbortController();
      const tId  = setTimeout(() => ctrl.abort(), 12000);
      let res;
      try {
        res = await fetch(_sbUrl('rpc/firma_kullanici_davet_olustur'), {
          method:  'POST',
          headers: { ..._sbHeaders(), 'Content-Type': 'application/json' },
          body:    JSON.stringify({ p_email: email, p_rol: rol, p_ad: ad }),
          signal:  ctrl.signal
        });
      } finally {
        clearTimeout(tId);
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || j?.hint || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const error = null;
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const link = row?.davet_link || ('https://fleetly.fit/davet/?kod=' + row?.davet_kodu);
      _setDavetSuccess(`
        ✓ <strong>${email}</strong> için davet oluşturuldu (${ROL_LABEL[rol]}).
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input readonly value="${link}" style="flex:1;min-width:260px;padding:6px 10px;font-size:11px;font-family:var(--font-mono,monospace);background:#fff;border:1px solid #d1d5db;border-radius:5px;color:#111;" onclick="this.select()" />
          <button onclick="ekipKopyalLink('${link}', this)" style="background:#10b981;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:inherit;font-weight:600;">📋 Kopyala</button>
        </div>
        <div style="font-size:11px;opacity:.85;margin-top:6px;">Bu linki davet ettiğiniz kişiye WhatsApp / email yoluyla iletin. Link 48 saat geçerlidir.</div>
      `);
      _$('ekip-davet-email').value = '';
      _$('ekip-davet-ad').value = '';
      ekipListeYukle();
    } catch (err) {
      _setDavetErr(err?.message || 'Davet oluşturulamadı');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Davet Oluştur'; }
    }
  }

  function ekipKopyalLink(link, btn) {
    navigator.clipboard?.writeText(link).then(() => {
      if (btn) {
        const old = btn.innerHTML;
        btn.innerHTML = '✓ Kopyalandı';
        setTimeout(() => { btn.innerHTML = old; }, 1500);
      }
    }).catch(() => _toast('Kopyalanamadı', 'error'));
  }

  async function ekipListeYukle() {
    const liste = _$('ekip-liste');
    if (!liste) return;
    liste.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted,#506080);">⏳ Yükleniyor…</div>';
    try {
      const sb = window.getSB ? window.getSB() : null;
      if (!sb) throw new Error('Supabase yok');
      const { data, error } = await sb.rpc('firma_kullanici_listele');
      if (error) throw error;
      _renderListe(data || []);
    } catch (err) {
      liste.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">⚠ Yüklenemedi: ${err?.message || 'hata'}</div>`;
    }
  }

  function _renderListe(rows) {
    const liste = _$('ekip-liste');
    if (!liste) return;
    if (!rows.length) {
      liste.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted,#506080);">Henüz başka kullanıcı yok.</div>';
      return;
    }
    const aktifler = rows.filter(r => r.durum === 'aktif');
    const bekleyenler = rows.filter(r => r.durum === 'davet_bekliyor');

    let html = '';
    if (aktifler.length) {
      html += `<div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#506080);margin:6px 0;">Aktif (${aktifler.length})</div>`;
      html += '<div style="display:flex;flex-direction:column;gap:6px;">';
      aktifler.forEach(r => {
        const c = ROL_COLORS[r.rol] || '#64748b';
        const isSahip = r.rol === 'sahip';
        html += `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface2,#161b34);border:1px solid var(--border,#222844);border-radius:8px;">
            <div style="width:34px;height:34px;border-radius:50%;background:${c}22;color:${c};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none;">
              ${(r.ad || r.email || '?').charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(r.ad || r.email)}</div>
              <div style="font-size:11px;color:var(--text2,#a8b8d8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(r.email)}</div>
            </div>
            <span style="font-size:10.5px;font-weight:700;color:${c};background:${c}15;padding:3px 9px;border-radius:99px;letter-spacing:.04em;text-transform:uppercase;">${ROL_LABEL[r.rol] || r.rol}</span>
            ${isSahip ? '<span style="font-size:10.5px;color:var(--muted,#506080);padding:3px 8px;">— korumalı</span>' :
              `<select onchange="ekipRolDegistir('${r.user_id}', this.value, this)" style="background:var(--surface,#10142a);border:1px solid var(--border,#222844);color:var(--text);border-radius:6px;padding:5px 8px;font-size:11.5px;font-family:inherit;cursor:pointer;">
                <option value="">Rol değiştir…</option>
                ${['yonetici','operasyoncu','muhasebeci'].filter(x => x !== r.rol).map(x => `<option value="${x}">${ROL_LABEL[x]}</option>`).join('')}
              </select>
              <button onclick="ekipKaldir('${r.user_id}', '${_esc(r.email)}')" style="background:transparent;border:1px solid rgba(239,68,68,.4);color:#ef4444;border-radius:6px;padding:5px 10px;font-size:11.5px;cursor:pointer;font-family:inherit;">Kaldır</button>`}
          </div>`;
      });
      html += '</div>';
    }

    if (bekleyenler.length) {
      html += `<div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#506080);margin:14px 0 6px;">Bekleyen Davetler (${bekleyenler.length})</div>`;
      html += '<div style="display:flex;flex-direction:column;gap:6px;">';
      bekleyenler.forEach(r => {
        const c = ROL_COLORS[r.rol] || '#64748b';
        const exp = new Date(r.expires_at);
        const expTxt = exp.toLocaleString('tr-TR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
        html += `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface2,#161b34);border:1px dashed rgba(234,179,8,.40);border-radius:8px;">
            <div style="width:34px;height:34px;border-radius:50%;background:rgba(234,179,8,.15);color:#d4a847;display:flex;align-items:center;justify-content:center;font-size:14px;flex:none;">⏳</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;">${_esc(r.ad || r.email)}</div>
              <div style="font-size:11px;color:var(--text2,#a8b8d8);">${_esc(r.email)} · son geçerlik: ${expTxt}</div>
            </div>
            <span style="font-size:10.5px;font-weight:700;color:${c};background:${c}15;padding:3px 9px;border-radius:99px;letter-spacing:.04em;text-transform:uppercase;">${ROL_LABEL[r.rol] || r.rol}</span>
            <button onclick="ekipKopyalLink('${r.davet_link}', this)" style="background:transparent;border:1px solid var(--border2,#2c3558);color:var(--text2,#a8b8d8);border-radius:6px;padding:5px 10px;font-size:11.5px;cursor:pointer;font-family:inherit;">📋 Link</button>
            <button onclick="ekipDavetIptal(${r.davet_id})" style="background:transparent;border:1px solid rgba(239,68,68,.4);color:#ef4444;border-radius:6px;padding:5px 10px;font-size:11.5px;cursor:pointer;font-family:inherit;">İptal</button>
          </div>`;
      });
      html += '</div>';
    }
    liste.innerHTML = html;
  }

  function _esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  async function ekipRolDegistir(userId, yeniRol, selectEl) {
    if (!yeniRol) return;
    if (!confirm(`Bu kullanıcının rolünü ${ROL_LABEL[yeniRol]} olarak değiştirmek istediğinize emin misiniz?`)) {
      if (selectEl) selectEl.value = '';
      return;
    }
    try {
      const sb = window.getSB ? window.getSB() : null;
      const { error } = await sb.rpc('firma_kullanici_rol_degistir', {
        p_user_id: userId, p_yeni_rol: yeniRol
      });
      if (error) throw error;
      _toast('✓ Rol değiştirildi', 'success');
      ekipListeYukle();
    } catch (err) {
      _toast('Değiştirilemedi: ' + (err?.message || 'hata'), 'error');
    }
  }

  async function ekipKaldir(userId, email) {
    if (!confirm(`${email} firma erişiminden kaldırılsın mı? Tüm operasyon yetkisi son bulur.`)) return;
    try {
      const sb = window.getSB ? window.getSB() : null;
      const { error } = await sb.rpc('firma_kullanici_kaldir', { p_user_id: userId });
      if (error) throw error;
      _toast('✓ Kullanıcı kaldırıldı', 'success');
      ekipListeYukle();
    } catch (err) {
      _toast('Kaldırılamadı: ' + (err?.message || 'hata'), 'error');
    }
  }

  async function ekipDavetIptal(davetId) {
    if (!confirm('Bu davet iptal edilsin mi? Link geçersiz hale gelir.')) return;
    try {
      const sb = window.getSB ? window.getSB() : null;
      const { error } = await sb.rpc('firma_kullanici_davet_iptal', { p_davet_id: davetId });
      if (error) throw error;
      _toast('✓ Davet iptal edildi', 'success');
      ekipListeYukle();
    } catch (err) {
      _toast('İptal başarısız: ' + (err?.message || 'hata'), 'error');
    }
  }

  // Backdrop tıklama ile kapatma
  document.addEventListener('DOMContentLoaded', () => {
    const bg = _$('ekip-modal-bg');
    if (bg) {
      bg.addEventListener('click', (ev) => {
        if (ev.target === bg) closeEkipModal();
      });
    }
  });

  // Global expose
  window.openEkipModal      = openEkipModal;
  window.closeEkipModal     = closeEkipModal;
  window.ekipDavetOlustur   = ekipDavetOlustur;
  window.ekipKopyalLink     = ekipKopyalLink;
  window.ekipListeYukle     = ekipListeYukle;
  window.ekipRolDegistir    = ekipRolDegistir;
  window.ekipKaldir         = ekipKaldir;
  window.ekipDavetIptal     = ekipDavetIptal;

  console.info('[ekip-yonetimi] modül yüklendi');
})();
