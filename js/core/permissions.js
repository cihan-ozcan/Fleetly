/* =============================================================================
 * permissions.js — Rol bazlı UI gating (Faz 3)
 * -----------------------------------------------------------------------------
 * Migration: css/db/migrations/2026_05_09d__kullanici_rol_getir.sql
 *
 * Roller:
 *   sahip       — Firma sahibi. Her şeye erişim.
 *   yonetici    — Sahibi dışında her şey. Abonelik & firma silme HARİÇ.
 *   operasyoncu — Operasyon, filo, sürücü, müşteri, yakıt onay, harcırah onay.
 *   muhasebeci  — Yalnızca harcırah, masraf, raporlar.
 *   sofor       — Bu uygulamayı görmemeli (mobile app var).
 *   uye         — Default — hiçbir şey yapamaz.
 *
 * KULLANIM:
 *   import değil, global script — login sonrası app-chunk-02 çağırır:
 *     await loadCurrentUserRole();   // window._authUserRol set eder
 *     applyRoleGating(window._authUserRol);
 *
 *   Programatik check:
 *     if (canDoAction('manage_subscription')) { ... }
 *     if (canSeeItem('sidebar-item-ekip'))    { ... }
 * =========================================================================== */

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────────
  // İzin matrisi: hangi rol hangi UI elementi/action'ı görür
  // ──────────────────────────────────────────────────────────────────────────
  // Sidebar item ID'leri → izinli roller. Listede olmayan id default tüm roller görür.
  // Eksiklikten ziyade fazlalık tarafında olalım — yeni eklenenler explicit listelensin.
  const ITEM_ROLES = {
    // Yönetim grubu — yalnızca sahip + yönetici
    'sidebar-item-ekip':         ['sahip', 'yonetici'],
    'sidebar-item-veri':         ['sahip', 'yonetici'],   // Faz 5: KVKK ihraç + sil (silme tab'ı sahip-only modal içinde)
    'sidebar-group-ayarlar':     ['sahip', 'yonetici'],
    // İleride eklenecek:
    // 'sidebar-item-abonelik':  ['sahip'],   // ödeme, plan değiştirme
    // 'sidebar-item-hata-log':  ['sahip'],   // app_errors panel
  };

  // Programatik action izinleri
  const ACTION_ROLES = {
    'manage_subscription':   ['sahip'],                                       // Faz 4
    'manage_firma_settings': ['sahip'],                                       // Faz 4
    'delete_account':        ['sahip'],                                       // Faz 5 — hesabı silme talebi
    'export_data':           ['sahip', 'yonetici'],                           // Faz 5 — KVKK m.11 veri ihracı
    'manage_team':           ['sahip', 'yonetici'],                           // Faz 2 (Ekip)
    'view_app_errors':       ['sahip', 'yonetici'],                           // DIY logger
    'manage_fleet':          ['sahip', 'yonetici', 'operasyoncu'],            // Filo CRUD
    'manage_drivers':        ['sahip', 'yonetici', 'operasyoncu'],            // Sürücü CRUD
    'manage_customers':      ['sahip', 'yonetici', 'operasyoncu'],            // Müşteri CRUD
    'manage_operations':     ['sahip', 'yonetici', 'operasyoncu'],            // İş emri CRUD
    'approve_fuel':          ['sahip', 'yonetici', 'operasyoncu'],            // Yakıt onay
    'approve_harcirah':      ['sahip', 'yonetici', 'operasyoncu', 'muhasebeci'],
    'view_reports':          ['sahip', 'yonetici', 'operasyoncu', 'muhasebeci'],
    'view_dashboard':        ['sahip', 'yonetici', 'operasyoncu', 'muhasebeci'],
  };

  function _currentRole() {
    return (window._authUserRol || '').toLowerCase();
  }

  function canSeeItem(itemId) {
    const allowed = ITEM_ROLES[itemId];
    if (!allowed) return true;          // listelenmemiş = herkes görür
    return allowed.includes(_currentRole());
  }

  function canDoAction(actionKey) {
    const allowed = ACTION_ROLES[actionKey];
    if (!allowed) return true;          // listelenmemiş = herkes
    return allowed.includes(_currentRole());
  }

  /**
   * DOM'a gating uygula — yetkisi olmayan kullanıcı için ITEM_ROLES'taki
   * elementlerin display:none. Yeniden çağrılabilir (rol değişirse).
   */
  function applyRoleGating(rol) {
    if (rol) window._authUserRol = String(rol).toLowerCase();
    const current = _currentRole();
    if (!current) {
      console.warn('[permissions] rol yüklenmemiş, gating yapılmıyor');
      return;
    }
    Object.keys(ITEM_ROLES).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const allowed = ITEM_ROLES[id].includes(current);
      el.style.display = allowed ? '' : 'none';
      el.setAttribute('data-role-gated', allowed ? 'visible' : 'hidden');
    });

    // data-roles attribute'lı dinamik elementler — UI'da inline kullanım için
    document.querySelectorAll('[data-roles]').forEach(el => {
      const allowed = el.getAttribute('data-roles').split(',').map(s => s.trim()).includes(current);
      el.style.display = allowed ? '' : 'none';
    });

    // Body'e rol class'ı — CSS ile seçici gating yapmak isteyenler için
    document.body.classList.remove(
      'role-sahip','role-yonetici','role-operasyoncu','role-muhasebeci','role-sofor','role-uye'
    );
    document.body.classList.add('role-' + current);
    console.info('[permissions] rol uygulandı:', current);
  }

  /**
   * Supabase RPC'den rolü çek, window._authUserRol'a yaz.
   */
  async function loadCurrentUserRole() {
    try {
      const sb = (typeof window.getSB === 'function') ? window.getSB() : null;
      if (!sb) return null;
      const { data, error } = await sb.rpc('firma_kullanici_rol_getir');
      if (error) {
        console.warn('[permissions] rol RPC hata:', error?.message);
        return null;
      }
      const row = Array.isArray(data) && data[0];
      if (row?.rol) {
        window._authUserRol = String(row.rol).toLowerCase();
        if (row.firma_id) window.currentFirmaId = row.firma_id;
        if (row.ad) window._authUserAd = row.ad;
        return row.rol;
      }
      // RPC dolu döner ama satır yok → kullanıcı henüz firma_kullanicilar'da yok
      window._authUserRol = 'uye';
      return 'uye';
    } catch (err) {
      console.warn('[permissions] rol yüklenemedi:', err?.message);
      return null;
    }
  }

  // Global expose
  window.canSeeItem          = canSeeItem;
  window.canDoAction         = canDoAction;
  window.applyRoleGating     = applyRoleGating;
  window.loadCurrentUserRole = loadCurrentUserRole;

  console.info('[permissions] modül yüklendi');
})();
