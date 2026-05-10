/**
 * Fleetly — notify-driver Edge Function
 *
 * Çağrı örneği (Supabase DB Webhook veya app.html'den):
 *   POST /functions/v1/notify-driver
 *   Authorization: Bearer <SERVICE_ROLE_KEY>
 *   {
 *     "surucu_id": "uuid",
 *     "is_emri_id": 123,
 *     "title": "🚛 Yeni İş Emri",
 *     "body": "34 ABC 123 — Ambarlı Liman teslimi atandı.",
 *     "url": "/sofor.html?t=...",
 *     "type": "is_emri"   // (opsiyonel — mobile data payload için: 'is_emri'|'pod'|'mesaj')
 *   }
 *
 * Şoförün KAYITLI KANALLARI:
 *   • Web tarayıcı PWA  → suruculer.push_subscription (VAPID + web-push)
 *   • Android app      → suruculer.fcm_token         (FCM HTTP v1)
 *
 * Hangisi/hangileri varsa o kanal(lar)dan gönderim yapılır. İkisi birden olabilir
 * (şoför hem PWA hem app kuruyor olabilir) — paralel gönderilir.
 *
 * SUPABASE SECRETS (Dashboard > Edge Functions > Secrets):
 *   ── Web Push (eskiden mevcut) ──
 *     VAPID_PUBLIC_KEY              <base64url public key>
 *     VAPID_PRIVATE_KEY             <base64url private key>
 *     VAPID_SUBJECT                 mailto:info@firmaniz.com
 *
 *   ── FCM (yeni — 2026_05_07 mobile bildirim fix) ──
 *     FIREBASE_SERVICE_ACCOUNT_JSON {tüm service account JSON içeriği — tek string}
 *       Firebase Console > Project Settings > Service Accounts > "Generate new private key"
 *       İndirilen JSON dosyasının tamamını (newline'lar dahil) tek değer olarak yapıştır.
 *
 * DEPLOY:
 *   supabase functions deploy notify-driver --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import webpush   from "npm:web-push@3.6.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Yeni Supabase API Keys sistemi: SUPABASE_SECRET_KEY öncelikli (sb_secret_...).
// Geriye uyum: SUPABASE_SERVICE_ROLE_KEY (eski JWT, deprecated ama hâlâ çalışıyor).
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")  ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@fleetly.app";

// Firebase service account JSON — tek string olarak (Firebase Console'dan indirilen
// dosyanın tüm içeriği). Lazy parse: sadece FCM gönderimi gerektiğinde parse edilir.
const FIREBASE_SERVICE_ACCOUNT_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// FCM HTTP v1 — OAuth2 erişim token cache'li gönderim
// ─────────────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let _serviceAccountCache: ServiceAccount | null = null;
function getServiceAccount(): ServiceAccount | null {
  if (_serviceAccountCache) return _serviceAccountCache;
  if (!FIREBASE_SERVICE_ACCOUNT_RAW) return null;
  try {
    _serviceAccountCache = JSON.parse(FIREBASE_SERVICE_ACCOUNT_RAW);
    return _serviceAccountCache;
  } catch (e) {
    console.error("[notify-driver] FIREBASE_SERVICE_ACCOUNT_JSON parse hatası:", e);
    return null;
  }
}

// Erişim token'ı 1 saat geçerli — Deno isolate yaşadığı sürece cache'le.
let _fcmAccessTokenCache: { token: string; expiresAt: number } | null = null;

/** PEM private key → ArrayBuffer (PKCS#8). */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** Base64URL encode (Uint8Array veya string). */
function base64url(input: Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else bytes = input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Service account ile JWT imzala → OAuth2'den access_token al. */
async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  // Cache check (60sn buffer)
  if (_fcmAccessTokenCache && _fcmAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return _fcmAccessTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const headerB64  = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // RSA-SHA256 imza
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = base64url(new Uint8Array(sigBuf));
  const jwt = `${signingInput}.${sigB64}`;

  // OAuth2 token exchange
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`OAuth2 token exchange başarısız: ${tokenRes.status} ${errText}`);
  }
  const tokenJson = await tokenRes.json();
  const access = tokenJson.access_token as string;
  // Cache 55 dakika boyunca (token 60dk geçerli, 5dk güvenlik buffer)
  _fcmAccessTokenCache = { token: access, expiresAt: Date.now() + 55 * 60_000 };
  return access;
}

/**
 * FCM HTTP v1 ile tek cihaza gönderim.
 * Hata durumunda exception fırlatır (caller catch eder, başka kanalı denemeye devam).
 *
 * data payload — mobile FleetlyMessagingService.onMessageReceived bekliyor:
 *   type:        'is_emri' | 'pod' | 'mesaj' | 'ariza'
 *   jobId:       iş emri id (Long, string olarak)
 *   is_emri_id:  alternatif key (geri uyum)
 *   title, body: notification text
 */
async function sendFcm(
  fcmToken: string,
  projectId: string,
  accessToken: string,
  payload: {
    title: string;
    body: string;
    type: string;
    is_emri_id?: number;
    url?: string;
  }
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const message: Record<string, unknown> = {
    token: fcmToken,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    // Data payload — string-only (FCM v1 spec). Long → string.
    data: {
      type: payload.type,
      ...(payload.is_emri_id != null
        ? { jobId: String(payload.is_emri_id), is_emri_id: String(payload.is_emri_id) }
        : {}),
      ...(payload.url ? { url: payload.url } : {}),
      title: payload.title,
      body: payload.body,
    },
    android: {
      priority: "HIGH",
      notification: {
        channel_id:
          payload.type === "is_emri" || payload.type === "atama" ? "fleetly_is_emri"
          : payload.type === "pod" || payload.type === "ariza"   ? "fleetly_pod"
          : "fleetly_mesaj",
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    }
  );

  if (res.ok) return { ok: true, status: res.status };

  const errText = await res.text();
  // FCM 404 (UNREGISTERED) veya 400 (INVALID_ARGUMENT) — token geçersiz, DB'den temizlenebilir
  return { ok: false, status: res.status, error: errText };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper — caller JWT'sinden user_id çıkar (--no-verify-jwt deploy edildiği
// için manuel doğrulama yapıyoruz; aksi halde herhangi biri push spam'leyebilir).
// ─────────────────────────────────────────────────────────────────────────────
async function getCallerUserId(authHeader: string): Promise<string | null> {
  const jwt = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.id ?? null;
  } catch {
    return null;
  }
}

/** Caller'ın bağlı olduğu firma_id setini topla (firma_kullanicilar + suruculer). */
async function getCallerFirmaIds(callerId: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const fkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/firma_kullanicilar?user_id=eq.${callerId}&select=firma_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (fkRes.ok) {
      const rows: { firma_id: string }[] = await fkRes.json();
      rows.forEach(r => out.add(r.firma_id));
    }
  } catch (_) { /* yoksay */ }
  try {
    const surRes = await fetch(
      `${SUPABASE_URL}/rest/v1/suruculer?auth_user_id=eq.${callerId}&select=firma_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (surRes.ok) {
      const rows: { firma_id: string }[] = await surRes.json();
      rows.forEach(r => out.add(r.firma_id));
    }
  } catch (_) { /* yoksay */ }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Push (mevcut akış — VAPID)
// ─────────────────────────────────────────────────────────────────────────────

async function sendWebPush(
  subscription: unknown,
  notifPayload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { ok: false, error: "VAPID anahtarları yok (web push devre dışı)" };
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(subscription, JSON.stringify(notifPayload));
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // CORS — Supabase Dashboard'dan test için
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin" : "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // İstek gövdesini parse et
  let body: {
    surucu_id?: string;
    is_emri_id?: number;
    title?: string;
    body?: string;
    url?: string;
    type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { surucu_id, is_emri_id, title, body: msgBody, url, type } = body;

  if (!surucu_id) {
    return new Response("surucu_id gerekli", { status: 400 });
  }

  // 🔒 YETKI (2026-05-10): caller'ın authenticated olduğunu ve hedef sürücünün
  // caller'ın firma'sında bulunduğunu doğrula. --no-verify-jwt ile deploy
  // edildiği için manuel kontrol gerekiyor; aksi halde herhangi biri her
  // sürücüye push spam atabilir.
  const callerId = await getCallerUserId(req.headers.get("Authorization") || "");
  if (!callerId) {
    return new Response(
      JSON.stringify({ sent: false, reason: "Yetkisiz: oturum gerekli" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Şoförün firma_id + PUSH KANALLARINI çek (service role — yetki kontrolü manuel)
  const dbRes = await fetch(
    `${SUPABASE_URL}/rest/v1/suruculer?id=eq.${surucu_id}&select=firma_id,push_subscription,fcm_token,ad`,
    {
      headers: {
        apikey       : SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!dbRes.ok) {
    return new Response("DB hatası: " + await dbRes.text(), { status: 500 });
  }

  const rows = await dbRes.json();
  const row  = rows?.[0];

  if (!row) {
    return new Response(
      JSON.stringify({ sent: false, reason: "surucu bulunamadı" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 🔒 Caller bu sürücünün firmasında mı?
  const callerFirmaIds = await getCallerFirmaIds(callerId);
  if (!callerFirmaIds.has(row.firma_id)) {
    return new Response(
      JSON.stringify({ sent: false, reason: "Yetkisiz: bu sürücü sizin firmanızda değil" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const finalTitle = title ?? "🚛 Yeni İş Emri";
  const finalBody  = msgBody ?? `${row.ad ?? "Şoför"}, yeni bir operasyon atandı.`;
  const finalUrl   = url ?? "/sofor.html";
  const finalType  = type ?? "is_emri";

  // İki kanalı paralel dene — sonuçları topla
  const tasks: Promise<{ channel: string; ok: boolean; error?: string }>[] = [];

  // ── Web Push ──
  if (row.push_subscription) {
    tasks.push(
      sendWebPush(row.push_subscription, {
        title: finalTitle,
        body:  finalBody,
        url:   finalUrl,
        tag:   `is-emri-${is_emri_id ?? Date.now()}`,
      }).then(r => ({ channel: "web", ...r }))
    );
  }

  // ── FCM (Android app) ──
  if (row.fcm_token) {
    const sa = getServiceAccount();
    if (!sa) {
      tasks.push(Promise.resolve({
        channel: "fcm",
        ok: false,
        error: "FIREBASE_SERVICE_ACCOUNT_JSON secret eksik — FCM gönderilemedi"
      }));
    } else {
      tasks.push((async () => {
        try {
          const accessToken = await getFcmAccessToken(sa);
          const r = await sendFcm(row.fcm_token, sa.project_id, accessToken, {
            title:      finalTitle,
            body:       finalBody,
            type:       finalType,
            is_emri_id: is_emri_id,
            url:        finalUrl,
          });
          // Token geçersiz → DB'den temizle
          if (!r.ok && (r.status === 404 || (r.status === 400 && (r.error || "").includes("INVALID_ARGUMENT")))) {
            try {
              await fetch(
                `${SUPABASE_URL}/rest/v1/suruculer?id=eq.${surucu_id}`,
                {
                  method : "PATCH",
                  headers: {
                    apikey        : SERVICE_ROLE_KEY,
                    Authorization : `Bearer ${SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer        : "return=minimal",
                  },
                  body: JSON.stringify({ fcm_token: null }),
                }
              );
            } catch (_) { /* sessiz */ }
          }
          return { channel: "fcm", ok: r.ok, error: r.error };
        } catch (e) {
          return {
            channel: "fcm",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })());
    }
  }

  // Hiç kanal yoksa
  if (tasks.length === 0) {
    return new Response(
      JSON.stringify({
        sent: false,
        reason: "Şoförde kayıtlı push kanalı yok (push_subscription ve fcm_token ikisi de boş)",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const results = await Promise.all(tasks);

  // 410 Gone → web push aboneliği expired, DB'den temizle
  const webResult = results.find(r => r.channel === "web");
  if (webResult && !webResult.ok && webResult.error &&
      (webResult.error.includes("410") || webResult.error.includes("Gone"))) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/suruculer?id=eq.${surucu_id}`,
        {
          method : "PATCH",
          headers: {
            apikey        : SERVICE_ROLE_KEY,
            Authorization : `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer        : "return=minimal",
          },
          body: JSON.stringify({ push_subscription: null }),
        }
      );
    } catch (_) { /* sessiz */ }
  }

  const anyOk = results.some(r => r.ok);
  return new Response(
    JSON.stringify({
      sent: anyOk,
      surucu: row.ad,
      results,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
