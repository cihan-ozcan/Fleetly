/**
 * Fleetly — iyzipay-callback Edge Function (Faz 4)
 *
 * Iyzipay Checkout Form ödemesi tamamlanınca POST callbackUrl'e döner.
 * Bu fonksiyon:
 *   1. Iyzipay'in gönderdiği token'ı alır
 *   2. Iyzipay'in retrieve API'sine çağrı yapar (token ile detayları al)
 *   3. status='success' ise RPC abonelik_iyzipay_aktif_et çağrılır
 *   4. status='failure' ise RPC abonelik_iyzipay_basarisiz çağrılır
 *   5. Kullanıcıyı /abonelik/'e yönlendirir (success/fail param ile)
 *
 * Iyzipay callback format (form-data):
 *   token=...&status=success
 *
 * SUPABASE SECRETS:
 *   IYZIPAY_API_KEY
 *   IYZIPAY_SECRET_KEY
 *   IYZIPAY_BASE_URL                  https://sandbox-api.iyzipay.com
 *   FLEETLY_APP_URL                   https://fleetly.fit  (callback redirect base)
 *   SUPABASE_URL                      otomatik
 *   SUPABASE_SECRET_KEY veya SUPABASE_SERVICE_ROLE_KEY (RPC çağırmak için)
 *
 * DEPLOY:
 *   supabase functions deploy iyzipay-callback --no-verify-jwt
 *   (Iyzipay public POST yapıyor, JWT yok)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const IYZIPAY_API_KEY    = Deno.env.get("IYZIPAY_API_KEY")!;
const IYZIPAY_SECRET_KEY = Deno.env.get("IYZIPAY_SECRET_KEY")!;
const IYZIPAY_BASE_URL   = Deno.env.get("IYZIPAY_BASE_URL")   ?? "https://sandbox-api.iyzipay.com";
const FLEETLY_APP_URL    = Deno.env.get("FLEETLY_APP_URL")    ?? "https://fleetly.fit";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function iyzipayAuthV1Sha1(bodyStr: string): Promise<{ header: string; randomString: string }> {
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

async function rpc(name: string, params: any) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(params)
  });
  const txt = await r.text();
  let json: any = null;
  try { json = JSON.parse(txt); } catch { /* boş */ }
  return { ok: r.ok, status: r.status, json, raw: txt };
}

function redirect(url: string) {
  return new Response(null, { status: 303, headers: { Location: url } });
}

serve(async (req) => {
  try {
    // Iyzipay form-data POST (application/x-www-form-urlencoded)
    let token = "";
    let statusParam = "";
    if (req.method === "POST") {
      const ct = (req.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/x-www-form-urlencoded")) {
        const txt = await req.text();
        const p = new URLSearchParams(txt);
        token = p.get("token") || "";
        statusParam = p.get("status") || "";
      } else if (ct.includes("application/json")) {
        const j = await req.json().catch(() => ({}));
        token = j.token || "";
        statusParam = j.status || "";
      }
    } else if (req.method === "GET") {
      const u = new URL(req.url);
      token = u.searchParams.get("token") || "";
      statusParam = u.searchParams.get("status") || "";
    }

    if (!token) {
      return redirect(`${FLEETLY_APP_URL}/abonelik/?status=fail&reason=${encodeURIComponent("Token alınamadı")}`);
    }

    // Iyzipay retrieve — token ile gerçek ödeme detaylarını al
    const retrieveBody = JSON.stringify({
      locale: "tr",
      conversationId: token,   // Iyzipay'in dönen kayıtla eşleşmesi için
      token
    });
    const auth = await iyzipayAuthV1Sha1(retrieveBody);
    const retR = await fetch(`${IYZIPAY_BASE_URL}/payment/iyzipos/checkoutform/auth/ecom/detail`, {
      method: "POST",
      headers: {
        "Authorization": auth.header,
        "Content-Type": "application/json",
        "x-iyzi-rnd": auth.randomString
      },
      body: retrieveBody
    });
    const retJ = await retR.json().catch(() => null);

    if (!retJ) {
      return redirect(`${FLEETLY_APP_URL}/abonelik/?status=fail&reason=${encodeURIComponent("Iyzipay yanıt vermedi")}`);
    }

    // Iyzipay paymentStatus: 'SUCCESS' | 'FAILURE' | 'INIT_THREEDS' | ...
    // status: 'success' | 'failure' (üst seviye)
    const odemeId = retJ.basketId || retJ.conversationId;
    const isSuccess = retJ.status === "success" && retJ.paymentStatus === "SUCCESS";

    if (!odemeId) {
      return redirect(`${FLEETLY_APP_URL}/abonelik/?status=fail&reason=${encodeURIComponent("Ödeme ID bulunamadı")}`);
    }

    if (isSuccess) {
      // RPC: abonelik aktif et
      const rpcRes = await rpc("abonelik_iyzipay_aktif_et", {
        p_odeme_id: odemeId,
        p_iyzipay_payment_id: retJ.paymentId,
        p_iyzipay_token: token,
        p_iyzipay_raw: retJ,
        p_tutar: parseFloat(retJ.paidPrice || retJ.price || "0")
      });
      if (!rpcRes.ok) {
        return redirect(`${FLEETLY_APP_URL}/abonelik/?status=fail&reason=${encodeURIComponent("Abonelik aktif edilemedi: " + rpcRes.raw.slice(0, 120))}`);
      }
      // RPC dönen abonelik_bitis tarihini parametreye ekle
      const result = Array.isArray(rpcRes.json) ? rpcRes.json[0] : rpcRes.json;
      const bitisIso = result?.abonelik_bitis ? new Date(result.abonelik_bitis).toISOString() : "";
      const planAd = retJ.basketItems?.[0]?.name || "";
      return redirect(`${FLEETLY_APP_URL}/abonelik/?status=success&odeme_id=${odemeId}&plan_ad=${encodeURIComponent(planAd)}&bitis=${encodeURIComponent(bitisIso)}`);
    } else {
      // Başarısız — RPC ile işaretle
      await rpc("abonelik_iyzipay_basarisiz", {
        p_odeme_id: odemeId,
        p_hata_kodu: retJ.errorCode || "",
        p_hata_mesaj: retJ.errorMessage || "",
        p_iyzipay_raw: retJ
      });
      const reason = retJ.errorMessage || "Ödeme reddedildi";
      return redirect(`${FLEETLY_APP_URL}/abonelik/?status=fail&odeme_id=${odemeId}&reason=${encodeURIComponent(reason)}`);
    }

  } catch (err) {
    return redirect(`${FLEETLY_APP_URL}/abonelik/?status=fail&reason=${encodeURIComponent(String(err?.message || err))}`);
  }
});
