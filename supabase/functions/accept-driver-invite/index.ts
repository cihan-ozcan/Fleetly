/**
 * Fleetly — accept-driver-invite Edge Function
 *
 * Anonymous sign-in olmadan şoför davet kabulü (password-based, 2026-05-07 refactor):
 *  1) Davet kodu + PIN doğrula (sofor_davet_dogrula_v3 RPC, secret/service_role ile)
 *  2) Sürücüye özel sentetik email + RANDOM password ile auth.user yarat veya güncelle
 *  3) Client {email, password} ile signInWithEmail çağırarak session açar
 *  4) suruculer.auth_user_id'yi bağla, davetin kullanildi_at'ını güncelle
 *
 * MAGIC-LINK YAKLAŞIMINDAN GEÇİŞ NEDENİ:
 *  • magic-link OTP, Supabase auth URL configuration + key rotation'a duyarlı
 *  • "Token has expired or is invalid" hataları yaşandı (2026-05-07)
 *  • Password-based daha sağlam, deterministik, time skew etkilenmez.
 *  • Password tek kullanımlık — kayıt sonrası tekrar davet kabulünde yenilenir
 *
 * Çağrı:
 *   POST /functions/v1/accept-driver-invite
 *   { "kod": "ABCD1234", "pin": "1234" }
 *
 * Cevap (başarılı):
 *   { "ok": true, "email": "...", "password": "...", "surucu_id": "uuid", "firma_id": "uuid" }
 *
 * Cevap (hata):
 *   { "ok": false, "hata": "PIN_HATALI" | "BULUNAMADI" | "KILITLI" | "SURESI_DOLDU"
 *                        | "KULLANILMIS" | "BASKA_CIHAZA_BAGLI" | "INTERNAL", ... }
 *
 * Deploy: supabase functions deploy accept-driver-invite --no-verify-jwt
 *  (--no-verify-jwt zorunlu — davet'e gelen kullanıcı henüz auth'lu değil)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Yeni Supabase API Keys sistemi: SUPABASE_SECRET_KEY öncelikli (sb_secret_...).
// Geriye uyum: SUPABASE_SERVICE_ROLE_KEY (eski JWT, deprecated ama hâlâ çalışıyor).
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Sürücü için kullanılan iç email domain — gerçek bir domain değil,
// Supabase auth'un email gerektirmesi için sentetik. Asla mail gönderilmez.
const INTERNAL_EMAIL_DOMAIN = "driver.fleetly.local";

const corsHeaders = {
  "Access-Control-Allow-Origin" : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

const json = (status: number, body: unknown) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")   return json(405, { ok: false, hata: "METHOD_NOT_ALLOWED" });

  let payload: { kod?: string; pin?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, hata: "INVALID_JSON" });
  }

  const kod = (payload.kod ?? "").trim().toUpperCase();
  const pin = (payload.pin ?? "").trim();
  if (!kod || !pin) return json(400, { ok: false, hata: "KOD_VEYA_PIN_BOS" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ── 1) Davet doğrula (mevcut RPC — yanlış PIN sayacı ve kilit dahil) ──
    const { data: dogrulaData, error: dogrulaErr } = await admin.rpc("sofor_davet_dogrula_v3", {
      p_kod: kod,
      p_pin: pin,
    });
    if (dogrulaErr) {
      console.error("[accept-invite] dogrula RPC hata:", dogrulaErr);
      return json(500, { ok: false, hata: "INTERNAL", detay: dogrulaErr.message });
    }
    if (dogrulaData && typeof dogrulaData === "object" && "hata" in dogrulaData) {
      // PIN_HATALI / BULUNAMADI / KILITLI / SURESI_DOLDU / KULLANILMIS
      return json(200, { ok: false, ...dogrulaData });
    }

    // ── 2) Davet detayını al (surucu_id, firma_id, telefon, ad) ──
    const { data: davetRows, error: davetErr } = await admin
      .from("surucu_davetleri")
      .select("id, surucu_id, firma_id, ad, telefon, telefon_e164, kullanildi_at")
      .eq("davet_kodu", kod)
      .limit(1);
    if (davetErr || !davetRows || davetRows.length === 0) {
      return json(200, { ok: false, hata: "BULUNAMADI" });
    }
    const davet = davetRows[0];
    if (davet.kullanildi_at) {
      return json(200, { ok: false, hata: "KULLANILMIS" });
    }

    // ── 3) Sürücü kaydının zaten bağlı olduğu auth_user_id var mı? ──
    let authUserId: string | null = null;
    if (davet.surucu_id) {
      const { data: surRows } = await admin
        .from("suruculer")
        .select("auth_user_id")
        .eq("id", davet.surucu_id)
        .limit(1);
      authUserId = surRows?.[0]?.auth_user_id ?? null;
    }

    // ── 4) Sentetik email — sürücü için stabil, sadece auth eşlemesi için ──
    // Format: surucu-{surucu_id}@driver.fleetly.local (UUID benzersizliği yeterli)
    const email = `surucu-${davet.surucu_id}@${INTERNAL_EMAIL_DOMAIN}`.toLowerCase();

    // ── 5) Tek kullanımlık random password — sentetik, sadece bu oturum için ──
    // Kullanıcı bunu hiç görmez; mobile signInWithEmail ile session açar açmaz
    // password JWT olarak hatırlanır. Tekrar davet kabulünde yeni password üretilir.
    //
    // NOT: bcrypt password ≤ 72 karakter (Supabase auth bunu zorunlu kılıyor).
    // Tek UUID 36 karakter + 122 bit entropy → güvenli + limit altında.
    const password = "fl-" + crypto.randomUUID();   // 39 karakter

    // ── 6) Auth user — yoksa yarat, varsa password yenile ──
    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          surucu_id : davet.surucu_id,
          firma_id  : davet.firma_id,
          ad        : davet.ad,
          telefon   : davet.telefon_e164 ?? davet.telefon ?? null,
          kaynak    : "fleetly_driver_invite",
        },
      });
      if (createErr) {
        // Email zaten varsa: aynı sürücü için tekrar davet — listele + password güncelle
        if (/already.*registered|duplicate|exists/i.test(createErr.message)) {
          const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
          const found = list?.users.find(u => (u.email ?? "").toLowerCase() === email);
          authUserId = found?.id ?? null;
          if (!authUserId) {
            console.error("[accept-invite] user var ama bulunamadı:", email);
            return json(500, { ok: false, hata: "INTERNAL", detay: "AUTH_USER_NOT_FOUND" });
          }
          // Mevcut user'ın password'ünü yeni random ile güncelle
          const { error: pwErr } = await admin.auth.admin.updateUserById(authUserId, {
            password,
            email_confirm: true,
          });
          if (pwErr) {
            console.error("[accept-invite] password update hata:", pwErr);
            return json(500, { ok: false, hata: "INTERNAL", detay: pwErr.message });
          }
        } else {
          console.error("[accept-invite] createUser hata:", createErr);
          return json(500, { ok: false, hata: "INTERNAL", detay: createErr.message });
        }
      } else {
        authUserId = created.user?.id ?? null;
      }
    } else {
      // Sürücü zaten auth_user_id'li — password'ünü yeni random ile güncelle.
      // (Aynı cihazdan tekrar davet → yeni session)
      const { error: pwErr } = await admin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
      });
      if (pwErr) {
        console.error("[accept-invite] password yenileme hata:", pwErr);
        return json(500, { ok: false, hata: "INTERNAL", detay: pwErr.message });
      }
    }

    if (!authUserId) {
      return json(500, { ok: false, hata: "INTERNAL", detay: "AUTH_USER_ID_YOK" });
    }

    // ── 6) suruculer.auth_user_id'yi bağla — başka bir cihaza bağlıysa hata ──
    if (davet.surucu_id) {
      const { data: bindRows, error: bindErr } = await admin
        .from("suruculer")
        .update({
          auth_user_id: authUserId,
          durum       : "aktif",
          son_giris   : new Date().toISOString(),
          updated_at  : new Date().toISOString(),
        })
        .eq("id", davet.surucu_id)
        .or(`auth_user_id.is.null,auth_user_id.eq.${authUserId}`)
        .select("id");
      if (bindErr) {
        console.error("[accept-invite] suruculer bind hata:", bindErr);
        return json(500, { ok: false, hata: "INTERNAL", detay: bindErr.message });
      }
      if (!bindRows || bindRows.length === 0) {
        return json(200, { ok: false, hata: "BASKA_CIHAZA_BAGLI" });
      }
    }

    // ── 7) Daveti "kullanıldı" işaretle ──
    const { error: kullanildiErr } = await admin
      .from("surucu_davetleri")
      .update({
        kullanildi_at   : new Date().toISOString(),
        kullanan_user_id: authUserId,
        davet_durumu    : "kabul",
      })
      .eq("id", davet.id);
    if (kullanildiErr) {
      console.error("[accept-invite] davet kullanildi update hata:", kullanildiErr);
      // Devam et — auth_user_id zaten bağlı, kritik değil
    }

    // ── 8) Response — client signInWithEmail({email, password}) ile session açar ──
    return json(200, {
      ok        : true,
      email,
      password,
      surucu_id : davet.surucu_id,
      firma_id  : davet.firma_id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[accept-invite] beklenmedik hata:", err);
    return json(500, { ok: false, hata: "INTERNAL", detay: msg });
  }
});
