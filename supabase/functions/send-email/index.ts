/**
 * Fleetly — send-email Edge Function (Faz 6, 2026-05-09)
 *
 * Tüm transactional email'lerin tek giriş noktası. Resend API kullanır.
 *
 * AKIŞ:
 *   1. SQL RPC çağırır:
 *        select _email_gonder('davet', 'kullanici@x.com', '{...}'::jsonb);
 *   2. Helper pg_net ile bu fonksiyona POST atar.
 *   3. Authorization: Bearer <EMAIL_INTERNAL_SECRET> kontrolü.
 *   4. Template render → Resend POST → response.
 *
 * DEPLOY:
 *   supabase secrets set RESEND_API_KEY=re_xxxxx
 *   supabase secrets set RESEND_FROM='Fleetly <noreply@fleetly.fit>'
 *   supabase secrets set RESEND_REPLY_TO=destek@fleetly.fit
 *   supabase secrets set EMAIL_INTERNAL_SECRET=$(openssl rand -hex 32)
 *   # Aynı EMAIL_INTERNAL_SECRET'i DB'ye de aktar:
 *   #   alter database postgres set app.email_internal_secret = '...';
 *   supabase functions deploy send-email --no-verify-jwt
 *
 * NOT: --no-verify-jwt kullanıyoruz çünkü Authorization header'ını biz
 * EMAIL_INTERNAL_SECRET ile manuel doğruluyoruz. Bu sayede frontend'den
 * doğrudan çağrılamaz; yalnızca DB tarafından (pg_net) tetiklenir.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY        = Deno.env.get("RESEND_API_KEY")        ?? "";
const RESEND_FROM           = Deno.env.get("RESEND_FROM")           ?? "Fleetly <noreply@fleetly.fit>";
const RESEND_REPLY_TO       = Deno.env.get("RESEND_REPLY_TO")       ?? "destek@fleetly.fit";
const EMAIL_INTERNAL_SECRET = Deno.env.get("EMAIL_INTERNAL_SECRET") ?? "";
const APP_URL               = Deno.env.get("FLEETLY_APP_URL")       ?? "https://fleetly.fit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
};

// ──────────────────────────────────────────────────────────────────────────────
// HTML template'lerinin paylaştığı kabuk: header (logo) + footer (KVKK, unsubscribe)
// ──────────────────────────────────────────────────────────────────────────────
function shell(opts: { title: string; preview: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0B1A2F;">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(opts.preview)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F6FA;">
    <tr><td align="center" style="padding:24px 12px 32px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;border:1px solid #E1E7F0;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#0B1A2F;padding:20px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.01em;">
                FLEETLY<span style="color:#FF6B1F;">.fit</span>
              </td>
              <td align="right" style="font-size:11px;color:#9DB1CC;letter-spacing:.06em;text-transform:uppercase;font-weight:600;">
                Filo Yönetim Sistemi
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 36px 24px;color:#0B1A2F;font-size:15px;line-height:1.6;">
          ${opts.bodyHtml}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 36px 26px;background:#F8FAFD;border-top:1px solid #E1E7F0;font-size:12px;color:#5B6B82;line-height:1.6;">
          Bu e-posta Fleetly.fit operasyon paneli tarafından otomatik gönderilmiştir.<br>
          Sorularınız için: <a href="mailto:${escapeHtml(RESEND_REPLY_TO)}" style="color:#FF6B1F;text-decoration:none;">${escapeHtml(RESEND_REPLY_TO)}</a> ·
          <a href="${escapeHtml(APP_URL)}/kvkk/" style="color:#5B6B82;text-decoration:underline;">KVKK</a> ·
          <a href="${escapeHtml(APP_URL)}/kullanim/" style="color:#5B6B82;text-decoration:underline;">Kullanım Şartları</a>
        </td></tr>
      </table>
      <div style="margin-top:14px;font-size:11px;color:#5B6B82;">
        © 2026 Fleetly.fit · ${escapeHtml(APP_URL.replace(/^https?:\/\//, ""))}
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(label: string, href: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;">
    <tr><td style="background:#FF6B1F;border-radius:10px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14.5px;letter-spacing:.01em;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ──────────────────────────────────────────────────────────────────────────────
// Templates — { subject, build(data) → { html, text } }
// ──────────────────────────────────────────────────────────────────────────────
type TemplateBuilder = {
  subject: (data: Record<string, any>) => string;
  build:   (data: Record<string, any>) => { html: string; text: string };
};

const TEMPLATES: Record<string, TemplateBuilder> = {

  // 1) Ekip daveti — Faz 2 RPC tetikler
  davet: {
    subject: (d) => `${d.firma_ad ?? "Fleetly"} sizi ekibe davet etti`,
    build: (d) => {
      const link = d.davet_link ?? `${APP_URL}/davet/?kod=${encodeURIComponent(d.davet_kodu ?? "")}`;
      const rolLabel: Record<string, string> = {
        yonetici: "Yönetici", operasyoncu: "Operasyoncu", muhasebeci: "Muhasebeci"
      };
      const rol = rolLabel[d.rol] ?? (d.rol ?? "Kullanıcı");
      const davet_eden = d.davet_eden_ad ?? d.davet_eden_email ?? "Yöneticiniz";
      const expires = d.expires_at_pretty ?? "48 saat içinde";

      const html = shell({
        title: `Fleetly daveti — ${d.firma_ad ?? ""}`,
        preview: `${d.firma_ad ?? "Fleetly"} ekibine ${rol} olarak davet edildiniz.`,
        bodyHtml: `
          <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;letter-spacing:-0.01em;color:#0B1A2F;">
            Ekibe davet edildiniz 🎉
          </h1>
          <p style="margin:0 0 12px;">Merhaba${d.ad ? ' <strong>' + escapeHtml(d.ad) + '</strong>' : ''},</p>
          <p style="margin:0 0 16px;">
            <strong>${escapeHtml(davet_eden)}</strong>, sizi
            <strong>${escapeHtml(d.firma_ad ?? "Fleetly firması")}</strong> ekibine
            <strong>${escapeHtml(rol)}</strong> rolü ile davet etti.
          </p>
          <p style="margin:0 0 6px;">Daveti kabul etmek için aşağıdaki butona tıklayın:</p>
          ${btn("Daveti Kabul Et", link)}
          <p style="margin:14px 0 0;font-size:13px;color:#5B6B82;">
            Buton çalışmazsa bu bağlantıyı tarayıcınıza yapıştırın:<br>
            <a href="${escapeHtml(link)}" style="color:#FF6B1F;word-break:break-all;">${escapeHtml(link)}</a>
          </p>
          <div style="margin-top:22px;padding:14px 16px;background:#EEF4FB;border-left:3px solid #2C5A9E;border-radius:6px;font-size:13.5px;color:#0B1A2F;">
            ⏱ Bu davet <strong>${escapeHtml(expires)}</strong> geçerlidir. Yeni hesap oluşturabilir veya mevcut Fleetly hesabınızla giriş yapabilirsiniz.
          </div>
          <p style="margin:22px 0 0;font-size:13px;color:#5B6B82;">
            Bu daveti beklemiyorsanız bu e-postayı yok sayabilirsiniz — herhangi bir hesap açılmayacaktır.
          </p>
        `
      });

      const text =
`${d.firma_ad ?? "Fleetly"} ekibine ${rol} olarak davet edildiniz.

Daveti kabul etmek için: ${link}

Bu davet ${expires} geçerlidir. Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.

— Fleetly.fit`;
      return { html, text };
    }
  },

  // 2) Abonelik bitiş uyarısı — pg_cron tetikler
  abonelik_uyari: {
    subject: (d) => {
      const tip = d.tip === 'deneme' ? 'Deneme süreniz' : 'Aboneliğiniz';
      return `${tip} ${d.kalan_gun ?? ""} gün sonra sona eriyor`;
    },
    build: (d) => {
      const link = `${APP_URL}/app/`;
      const tipBaslik = d.tip === 'deneme' ? 'Deneme süreniz' : 'Aboneliğiniz';
      const kalan = Number(d.kalan_gun ?? 0);
      const renk = kalan <= 1 ? '#DC3838' : '#E5A100';

      const html = shell({
        title: `${tipBaslik} ${kalan} gün sonra sona eriyor`,
        preview: `${tipBaslik} ${kalan} gün sonra bitiyor — kesintiyi önlemek için planınızı seçin.`,
        bodyHtml: `
          <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;letter-spacing:-0.01em;color:${renk};">
            ⏳ ${escapeHtml(tipBaslik)} ${kalan} gün sonra sona eriyor
          </h1>
          <p style="margin:0 0 14px;">
            <strong>${escapeHtml(d.firma_ad ?? "Firmanızın")}</strong> Fleetly hesabı için
            ${escapeHtml(tipBaslik.toLowerCase())} <strong>${kalan} gün</strong> içinde sona erecek
            (${escapeHtml(d.bitis_pretty ?? "")}).
          </p>
          <p style="margin:0 0 8px;">
            Kesintisiz kullanmaya devam etmek için planınızı seçip ödemeyi tamamlayın.
            Ödeme alındıktan sonra abonelik süresi otomatik uzatılır.
          </p>
          ${btn("Planımı Seç", link)}
          <div style="margin-top:18px;padding:14px 16px;background:#FFF7DD;border-left:3px solid #E5A100;border-radius:6px;font-size:13.5px;color:#0B1A2F;">
            ⚠ ${escapeHtml(tipBaslik)} bitince hesabınız <strong>salt-okunur moda</strong> alınır:
            verileriniz korunur ancak yeni iş emri/sürücü/araç ekleyemezsiniz.
            Verileriniz kaybolmaz, dilediğinizde abone olarak devam edebilirsiniz.
          </div>
          <p style="margin:22px 0 0;font-size:13px;color:#5B6B82;">
            Kart bilgileri Fleetly sunucularına iletilmez — ödeme BDDK lisanslı iyzico altyapısı üzerinden 3D Secure ile alınır.
          </p>
        `
      });

      const text =
`${tipBaslik} ${kalan} gün sonra sona eriyor (${d.bitis_pretty ?? ""}).

Kesintiyi önlemek için planınızı seçin: ${link}

— Fleetly.fit`;
      return { html, text };
    }
  },

  // 3) Abonelik aktivasyonu — Iyzipay callback sonrası
  abonelik_aktif: {
    subject: (d) => `Aboneliğiniz aktif — ${d.firma_ad ?? "Fleetly"}`,
    build: (d) => {
      const link = `${APP_URL}/app/`;
      const html = shell({
        title: `Aboneliğiniz aktif`,
        preview: `Ödemeniz alındı; aboneliğiniz ${d.bitis_pretty ?? ""} tarihine kadar aktif.`,
        bodyHtml: `
          <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;color:#16A974;">
            ✅ Aboneliğiniz aktif
          </h1>
          <p style="margin:0 0 12px;">
            <strong>${escapeHtml(d.firma_ad ?? "Firmanız")}</strong> için
            <strong>${escapeHtml(d.plan_ad ?? "")}</strong> planı ödemeniz alındı.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F4F6FA;border-radius:10px;margin:14px 0;">
            <tr><td style="padding:14px 18px;font-size:13.5px;line-height:1.7;">
              <strong>Tutar:</strong> ${escapeHtml(d.tutar_pretty ?? "")}<br>
              <strong>Ödeme No:</strong> ${escapeHtml(d.payment_id ?? "")}<br>
              <strong>Bitiş tarihi:</strong> ${escapeHtml(d.bitis_pretty ?? "")}
            </td></tr>
          </table>
          ${btn("Panele Git", link)}
          <p style="margin:18px 0 0;font-size:13px;color:#5B6B82;">
            Faturanız e-arşiv olarak ${escapeHtml(d.fatura_email ?? "kayıtlı email adresinize")} ayrıca gönderilecektir.
          </p>
        `
      });

      const text =
`Aboneliğiniz aktif: ${d.firma_ad ?? "Fleetly"} - ${d.plan_ad ?? ""}.
Tutar: ${d.tutar_pretty ?? ""}
Bitiş: ${d.bitis_pretty ?? ""}
Panele git: ${link}

— Fleetly.fit`;
      return { html, text };
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// HTTP handler
// ──────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  // Authorization guard — yalnızca DB pg_net çağırabilir
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${EMAIL_INTERNAL_SECRET}`;
  if (!EMAIL_INTERNAL_SECRET || auth !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY yapılandırılmamış" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const template = String(body?.template ?? "").trim();
    const to       = String(body?.to ?? "").trim();
    const data     = (body?.data && typeof body.data === "object") ? body.data : {};

    if (!template || !to) {
      return new Response(JSON.stringify({ error: "template ve to zorunlu" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const tpl = TEMPLATES[template];
    if (!tpl) {
      return new Response(JSON.stringify({ error: "Bilinmeyen template: " + template }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const subject = tpl.subject(data);
    const { html, text } = tpl.build(data);

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to:   [to],
        subject,
        html,
        text,
        reply_to: RESEND_REPLY_TO,
        // Resend tags — dashboard'da template/firma bazlı filtre için
        tags: [
          { name: "template", value: template },
          ...(data.firma_id ? [{ name: "firma_id", value: String(data.firma_id).slice(0, 60) }] : [])
        ]
      })
    });

    const j = await r.json().catch(() => null);
    if (!r.ok) {
      return new Response(JSON.stringify({
        error: "Resend HTTP " + r.status,
        details: j
      }), { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, id: j?.id, template, to }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
