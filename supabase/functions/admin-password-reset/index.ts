/**
 * Fleetly — admin-password-reset Edge Function
 *
 * Platform admin'in herhangi bir kullanıcıya şifre sıfırlama linki oluşturup
 * göndermesini sağlar. Supabase admin API service_role key gerektirir.
 *
 * AKIŞ:
 *   1. Frontend Authorization: Bearer <user_jwt> ile çağırır.
 *   2. Bu function user JWT'yi doğrular → kullanıcı oturumu açıkmı?
 *   3. _is_platform_admin() RPC ile platform admin olduğunu doğrular.
 *   4. Admin SDK ile target user için recovery link üretir.
 *   5. send-email RPC'sine yönlendirir veya link'i admin'e döndürür.
 *
 * REQUEST:
 *   POST /functions/v1/admin-password-reset
 *   Authorization: Bearer <user_jwt>
 *   { "target_user_id": "uuid", "redirect_to": "https://fleetly.fit/reset-password.html" }
 *
 * RESPONSE:
 *   { "ok": true, "recovery_link": "https://...", "sent_email": true }
 *
 * DEPLOY:
 *   supabase functions deploy admin-password-reset
 *   (service_role anahtarı Supabase tarafından otomatik enjekte edilir)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")              ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON         = Deno.env.get("SUPABASE_ANON_KEY")         ?? "";
const APP_URL               = Deno.env.get("FLEETLY_APP_URL")           ?? "https://fleetly.fit";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "POST required" }, 405);

  try {
    // 1) Authorization header → user JWT
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization" }, 401);
    }
    const userJwt = authHeader.replace("Bearer ", "");

    // User-scoped client (RLS uygulanır)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // 2) Platform admin kontrolü
    const { data: isAdmin, error: rpcErr } = await userClient.rpc("_is_platform_admin");
    if (rpcErr) return json({ error: "RPC failed: " + rpcErr.message }, 500);
    if (!isAdmin) return json({ error: "Not a platform admin" }, 403);

    // 3) Body
    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body.target_user_id || "");
    const redirectTo   = String(body.redirect_to || (APP_URL + "/reset-password.html"));
    if (!targetUserId) return json({ error: "target_user_id required" }, 400);

    // 4) Admin client (service_role)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Target user'ın email'ini al
    const { data: targetUserData, error: getErr } = await admin.auth.admin.getUserById(targetUserId);
    if (getErr || !targetUserData?.user?.email) {
      return json({ error: "Target user not found or has no email" }, 404);
    }
    const targetEmail = targetUserData.user.email;

    // 5) Recovery link üret
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: targetEmail,
      options: { redirectTo },
    });

    if (linkErr) return json({ error: "Link generation failed: " + linkErr.message }, 500);

    // 6) Audit log yaz
    await userClient.rpc("admin_log", {
      p_islem_tipi: "user_password_reset",
      p_hedef_tip:  "user",
      p_hedef_id:   targetUserId,
      p_ozet:       `Şifre sıfırlama linki üretildi: ${targetEmail}`,
      p_detay:      { user_id: targetUserId, email: targetEmail },
    });

    // 7) Cevap — link admin'e dön (admin manuel email atabilir veya kopyalayabilir).
    // Otomatik e-posta için: ekstra olarak Resend / send-email çağrısı eklenebilir.
    return json({
      ok: true,
      recovery_link: linkData?.properties?.action_link ?? null,
      email: targetEmail,
      sent_email: false,  // şu an manuel; ileride otomatik gönderim eklenebilir
    });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
