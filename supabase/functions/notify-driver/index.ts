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
 *     "url": "/sofor.html?t=..."
 *   }
 *
 * Supabase Secrets (Dashboard > Edge Functions > Secrets):
 *   VAPID_PUBLIC_KEY   = <base64url public key>
 *   VAPID_PRIVATE_KEY  = <base64url private key>
 *   VAPID_SUBJECT      = mailto:info@firmaniz.com
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import webpush   from "npm:web-push@3.6.6";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@fleetly.app";

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
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { surucu_id, is_emri_id, title, body: msgBody, url } = body;

  if (!surucu_id) {
    return new Response("surucu_id gerekli", { status: 400 });
  }

  // Şoförün push_subscription'ını DB'den çek
  const dbRes = await fetch(
    `${SUPABASE_URL}/rest/v1/suruculer?id=eq.${surucu_id}&select=push_subscription,ad`,
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

  if (!row?.push_subscription) {
    // Şoförün aboneliği yoksa sessizce geç (henüz tarayıcısını açmamış)
    return new Response(
      JSON.stringify({ sent: false, reason: "push_subscription yok" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // VAPID ayarla
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Bildirim içeriğini oluştur
  const notifPayload = JSON.stringify({
    title: title ?? "🚛 Yeni İş Emri",
    body : msgBody ?? `${row.ad ?? "Şoför"}, yeni bir operasyon atandı.`,
    url  : url ?? "/sofor.html",
    tag  : `is-emri-${is_emri_id ?? Date.now()}`,
  });

  try {
    await webpush.sendNotification(row.push_subscription, notifPayload);
    return new Response(
      JSON.stringify({ sent: true, surucu: row.ad }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 410 Gone = abonelik iptal edilmiş, DB'den temizle
    if (errMsg.includes("410") || errMsg.includes("Gone")) {
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
    }
    return new Response(
      JSON.stringify({ sent: false, error: errMsg }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
});
