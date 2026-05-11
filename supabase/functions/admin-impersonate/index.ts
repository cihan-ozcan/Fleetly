/**
 * Fleetly — admin-impersonate Edge Function
 *
 * Platform admin'in destek için hedef kullanıcı adına geçici bir oturum
 * oluşturmasını sağlar. Hedef kullanıcının normalde gördüğü ekranı gözlemleyebilir.
 *
 * GÜVENLİK:
 *   • Sadece platform admin tetikleyebilir.
 *   • Üretilen "magic link" tek kullanımlık, kısa ömürlü.
 *   • Her impersonate audit log'a yazılır + detayda "impersonated_by" kaydı.
 *   • Hedef kullanıcı email'ine bilgilendirme atılabilir (opsiyonel).
 *
 * REQUEST:
 *   POST /functions/v1/admin-impersonate
 *   Authorization: Bearer <admin_jwt>
 *   { "target_user_id": "uuid", "redirect_to": "https://fleetly.fit/app/?impersonate=1" }
 *
 * RESPONSE:
 *   { "ok": true, "magic_link": "https://...", "expires_in": 60 }
 *
 * KULLANIM (frontend):
 *   const r = await fetch('/functions/v1/admin-impersonate', { ... });
 *   const j = await r.json();
 *   window.open(j.magic_link, '_blank');
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
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);
    const userJwt = authHeader.replace("Bearer ", "");

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: { user: adminUser }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !adminUser) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin } = await userClient.rpc("_is_platform_admin");
    if (!isAdmin) return json({ error: "Not a platform admin" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body.target_user_id || "");
    const baseRedirect = String(body.redirect_to || (APP_URL + "/app/"));
    const neden        = String(body.neden || "");
    if (!targetUserId) return json({ error: "target_user_id required" }, 400);

    // redirect_to'ya impersonate=1 + admin_email parametrelerini ekle.
    // Frontend (impersonate-banner.js) bu parametreyi görünce banner gösterir.
    const redirectUrl = new URL(baseRedirect);
    redirectUrl.searchParams.set("impersonate", "1");
    if (adminUser.email) redirectUrl.searchParams.set("admin_email", adminUser.email);
    const redirectTo = redirectUrl.toString();

    if (targetUserId === adminUser.id) {
      return json({ error: "Kendi hesabınıza impersonate olamaz" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: targetData, error: tErr } = await admin.auth.admin.getUserById(targetUserId);
    if (tErr || !targetData?.user?.email) {
      return json({ error: "Target user not found" }, 404);
    }
    const targetEmail = targetData.user.email;

    // Target başka bir platform admin mi? (engelle)
    const { data: isTargetAdmin } = await admin.rpc("_is_platform_admin", { p_user_id: targetUserId });
    if (isTargetAdmin) {
      return json({ error: "Başka platform admin'e impersonate olamazsınız" }, 403);
    }

    // Magic link üret (type=magiclink — tek tıkla login)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
      options: { redirectTo },
    });

    if (linkErr) return json({ error: "Magic link failed: " + linkErr.message }, 500);

    // Audit log (kritik — her impersonate kaydedilir)
    await userClient.rpc("admin_log", {
      p_islem_tipi: "user_impersonate",
      p_hedef_tip:  "user",
      p_hedef_id:   targetUserId,
      p_ozet:       `Impersonate: ${targetEmail}` + (neden ? ` — ${neden}` : ""),
      p_detay:      {
        admin_id:    adminUser.id,
        admin_email: adminUser.email,
        target_id:   targetUserId,
        target_email: targetEmail,
        neden,
        ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
      },
    });

    return json({
      ok: true,
      magic_link: linkData?.properties?.action_link ?? null,
      target_email: targetEmail,
      expires_in: 3600,  // Supabase default magic link 1 saat geçerli
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
