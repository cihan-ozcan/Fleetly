/**
 * Fleetly — iyzipay-init Edge Function (Faz 4)
 *
 * Frontend "Iyzipay ile Güvenli Öde" butonuna basınca çağrılır.
 * Iyzipay Checkout Form Initialize API'sini server-side çağırır,
 * paymentPageUrl alır, frontend'e döndürür.
 *
 * AKIŞ:
 *   1. Frontend RPC abonelik_odeme_baslat → odeme_id alır
 *   2. POST /functions/v1/iyzipay-init { odeme_id, plan_id, tutar, ... }
 *   3. Bu fonksiyon Iyzipay PaymentRequest atar
 *   4. paymentPageUrl frontend'e döner
 *   5. Frontend yönlendirir → kullanıcı Iyzipay sayfasında öder
 *   6. Iyzipay → iyzipay-callback Edge Function çağırır (callback URL)
 *
 * SUPABASE SECRETS (Dashboard > Edge Functions > Secrets):
 *   IYZIPAY_API_KEY      sandbox-xxx (Iyzipay panel: Ayarlar > Merchant)
 *   IYZIPAY_SECRET_KEY   sandbox-yyy
 *   IYZIPAY_BASE_URL     https://sandbox-api.iyzipay.com  (prod: https://api.iyzipay.com)
 *   IYZIPAY_CALLBACK_URL https://<project>.supabase.co/functions/v1/iyzipay-callback
 *
 * DEPLOY:
 *   supabase functions deploy iyzipay-init
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const IYZIPAY_API_KEY      = Deno.env.get("IYZIPAY_API_KEY")!;
const IYZIPAY_SECRET_KEY   = Deno.env.get("IYZIPAY_SECRET_KEY")!;
const IYZIPAY_BASE_URL     = Deno.env.get("IYZIPAY_BASE_URL")     ?? "https://sandbox-api.iyzipay.com";
const IYZIPAY_CALLBACK_URL = Deno.env.get("IYZIPAY_CALLBACK_URL") ?? "";

// Auth doğrulama için (2026-05-10 — odeme_id sahip kontrolü)
const SUPABASE_URL_AUTH  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
};

// ──────────────────────────────────────────────────────────────────────────
// Iyzipay V1 Auth: HMAC-SHA1(authString) base64
// authString = apiKey + randomString + secretKey + JSON.stringify(body)
// header     = IYZWS apiKey:randomString:signature
// ──────────────────────────────────────────────────────────────────────────
async function iyzipayAuthHeader(bodyStr: string): Promise<string> {
  const randomString = crypto.randomUUID().replace(/-/g, "");
  const authString   = IYZIPAY_API_KEY + randomString + IYZIPAY_SECRET_KEY + bodyStr;
  // HMAC-SHA1 → base64
  const enc = new TextEncoder();
  const keyData = enc.encode(IYZIPAY_SECRET_KEY);
  const key = await crypto.subtle.importKey(
    "raw", keyData,
    { name: "HMAC", hash: "SHA-1" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(authString));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `IYZWS ${IYZIPAY_API_KEY}:${randomString}:${b64}`;
}

// Iyzipay V1 ayrıca daha eski format kabul ediyor: apiKey + randomString + secretKey
// + (request bodyText) → SHA1 hash. Test edip değişebilir. V2 daha güvenli ama
// Checkout Form için V1 yeterli.
async function iyzipayAuthHeaderV1Sha1(bodyStr: string): Promise<{ header: string; randomString: string }> {
  const randomString = crypto.randomUUID().replace(/-/g, "");
  const authString = IYZIPAY_API_KEY + randomString + IYZIPAY_SECRET_KEY + bodyStr;
  const data = new TextEncoder().encode(authString);
  const hashBuf = await crypto.subtle.digest("SHA-1", data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
  return {
    header: `IYZWS ${IYZIPAY_API_KEY}:${randomString}:${b64}`,
    randomString
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: kullanıcı IP'si (Iyzipay buyer.ip için zorunlu — uzun değil)
// ──────────────────────────────────────────────────────────────────────────
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0].trim();
  return ip || "85.105.0.1";   // fallback (Iyzipay format kontrol eder)
}

function splitName(full: string): { name: string; surname: string } {
  const parts = (full || "").trim().split(/\s+/);
  if (parts.length === 0) return { name: "Müşteri", surname: "Soyad" };
  if (parts.length === 1) return { name: parts[0], surname: parts[0] };
  return { name: parts[0], surname: parts.slice(1).join(" ") };
}

// ──────────────────────────────────────────────────────────────────────────
// Auth helpers — caller'ın odeme_id'ye yetkisini doğrula (2026-05-10)
// Eski versiyon hiç kontrol yapmıyordu → A firması B'nin odeme_id'siyle
// Iyzipay sayfasını başlatabilir, ödeme yapsa B'nin aboneliği aktif olur.
// ──────────────────────────────────────────────────────────────────────────
async function getCallerUserId(authHeader: string): Promise<string | null> {
  const jwt = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  try {
    const r = await fetch(`${SUPABASE_URL_AUTH}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.id ?? null;
  } catch {
    return null;
  }
}

async function callerOwnsOdeme(callerId: string, odemeId: string): Promise<boolean> {
  try {
    const fkRes = await fetch(
      `${SUPABASE_URL_AUTH}/rest/v1/firma_kullanicilar?user_id=eq.${callerId}&select=firma_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (!fkRes.ok) return false;
    const fkRows: { firma_id: string }[] = await fkRes.json();
    if (fkRows.length === 0) return false;
    const firmaIds = new Set(fkRows.map(r => r.firma_id));

    const odRes = await fetch(
      `${SUPABASE_URL_AUTH}/rest/v1/odeme_gecmisi?id=eq.${encodeURIComponent(odemeId)}&select=firma_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (!odRes.ok) return false;
    const odRows: { firma_id: string }[] = await odRes.json();
    if (odRows.length === 0) return false;
    return firmaIds.has(odRows[0].firma_id);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { odeme_id, plan_id, tutar, plan_ad, firma_email, firma_ad } = body || {};

    if (!odeme_id || !plan_id || !tutar) {
      return new Response(JSON.stringify({ error: "odeme_id, plan_id, tutar zorunlu" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // 🔒 YETKI (2026-05-10): caller bu odeme_id'ye sahip mi?
    // Eski akışta kontrol yoktu → cross-tenant ödeme manipülasyonu mümkündü.
    const callerId = await getCallerUserId(req.headers.get("Authorization") || "");
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Yetkisiz: oturum gerekli" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }
    if (!(await callerOwnsOdeme(callerId, String(odeme_id)))) {
      return new Response(JSON.stringify({ error: "Bu ödeme size ait değil" }),
        { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    if (!IYZIPAY_API_KEY || !IYZIPAY_SECRET_KEY) {
      return new Response(JSON.stringify({
        error: "Iyzipay API anahtarları yapılandırılmamış. Supabase Secrets'a IYZIPAY_API_KEY ve IYZIPAY_SECRET_KEY ekleyin."
      }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Iyzipay payment request body
    const priceStr = Number(tutar).toFixed(2);   // "990.00"
    const { name, surname } = splitName(firma_ad || firma_email || "Fleetly Müşteri");
    const ip = clientIp(req);

    const iyzReqBody = {
      locale: "tr",
      conversationId: odeme_id,                                 // bizim odeme_id ↔ Iyzipay conversation
      price: priceStr,
      paidPrice: priceStr,
      currency: "TRY",
      basketId: odeme_id,
      paymentGroup: "PRODUCT",
      callbackUrl: IYZIPAY_CALLBACK_URL || `${IYZIPAY_BASE_URL}/`,
      enabledInstallments: [1, 2, 3, 6, 9, 12],
      buyer: {
        id: odeme_id.slice(0, 24),
        name,
        surname,
        gsmNumber: "+905550000000",
        email: firma_email || "noreply@fleetly.fit",
        identityNumber: "11111111111",                         // sandbox için yeterli; prod'da TC kimlik
        registrationAddress: "Fleetly Abonelik",
        ip,
        city: "Istanbul",
        country: "Turkey",
        zipCode: "34000"
      },
      shippingAddress: {
        contactName: firma_ad || "Fleetly Müşteri",
        city: "Istanbul",
        country: "Turkey",
        address: "Fleetly Abonelik (dijital)",
        zipCode: "34000"
      },
      billingAddress: {
        contactName: firma_ad || "Fleetly Müşteri",
        city: "Istanbul",
        country: "Turkey",
        address: "Fleetly Abonelik (dijital)",
        zipCode: "34000"
      },
      basketItems: [
        {
          id: plan_id,
          name: `Fleetly ${plan_ad || plan_id} Abonelik`,
          category1: "SaaS Abonelik",
          itemType: "VIRTUAL",
          price: priceStr
        }
      ]
    };

    const bodyStr = JSON.stringify(iyzReqBody);
    const auth = await iyzipayAuthHeaderV1Sha1(bodyStr);

    const url = `${IYZIPAY_BASE_URL}/payment/iyzipos/checkoutform/initialize/auth/ecom`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": auth.header,
        "Content-Type": "application/json",
        "x-iyzi-rnd": auth.randomString,
      },
      body: bodyStr
    });

    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      return new Response(JSON.stringify({
        error: "Iyzipay HTTP " + r.status,
        details: j
      }), { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    if (j.status !== "success" || !j.paymentPageUrl) {
      return new Response(JSON.stringify({
        error: "Iyzipay reddetti",
        errorCode: j.errorCode,
        errorMessage: j.errorMessage,
        raw: j
      }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Başarılı — paymentPageUrl frontend'e dönsün
    return new Response(JSON.stringify({
      paymentPageUrl: j.paymentPageUrl,
      token: j.token,
      checkoutFormContent: j.checkoutFormContent  // opsiyonel: popup'ta inline render için
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
