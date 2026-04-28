/* ============================================================
   Fleetly Push Notify  —  İstemci tarafı Web Push kaydı
   ============================================================
   Kullanım:
     import { registerPush } from '/js/core/push-notify.js';
     // veya global script olarak yüklenince:
     window.FleetlyPush.register(surucuId);
   ============================================================ */
(function (global) {
  'use strict';

  // VAPID public key config.js'den veya window.FILO_CONFIG'dan alınır
  function getVapidKey() {
    return (window.FILO_CONFIG?.VAPID_PUBLIC_KEY) || '';
  }

  // base64url → Uint8Array (Web Push VAPID için gerekli)
  function urlB64ToUint8Array(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const base64  = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function register(surucuId) {
    const vapidKey = getVapidKey();
    if (!vapidKey) {
      console.warn('[Push] VAPID_PUBLIC_KEY config.js içinde tanımlı değil.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Bu tarayıcı Web Push desteklemiyor.');
      return;
    }

    try {
      // 1. Service Worker kaydet (zaten kayıtlıysa mevcut döner)
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // 2. Daha önce kaydedilmişse tekrar sorma
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await _saveToDb(surucuId, existing);
        return;
      }

      // 3. Bildirim izni iste
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        console.info('[Push] Bildirim izni reddedildi.');
        return;
      }

      // 4. Push aboneliği oluştur
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly    : true,
        applicationServerKey: urlB64ToUint8Array(vapidKey)
      });

      // 5. Supabase'e kaydet
      await _saveToDb(surucuId, subscription);
      console.info('[Push] Bildirim aboneliği kaydedildi ✓');
    } catch (err) {
      console.warn('[Push] Abonelik hatası:', err.message);
    }
  }

  async function _saveToDb(surucuId, subscription) {
    if (!surucuId) return;
    const CFG = window.FILO_CONFIG || {};
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON) return;

    // Auth token varsa kullan, yoksa anon key
    let authToken = CFG.SUPABASE_ANON;
    try {
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('sb-') && k.includes('auth-token'));
      for (const k of keys) {
        const s = JSON.parse(localStorage.getItem(k) || '{}');
        if (s?.access_token) { authToken = s.access_token; break; }
      }
    } catch {}

    await fetch(`${CFG.SUPABASE_URL}/rest/v1/suruculer?id=eq.${surucuId}`, {
      method : 'PATCH',
      headers: {
        'apikey'      : CFG.SUPABASE_ANON,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'Prefer'      : 'return=minimal'
      },
      body: JSON.stringify({ push_subscription: subscription.toJSON() })
    });
  }

  // Aboneliği iptal et (çıkış yaparken çağrılabilir)
  async function unregister() {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  }

  global.FleetlyPush = { register, unregister };
})(window);
