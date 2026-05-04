/* Design tokens artboard — Renk paleti, tipografi, spacing, ikonografi */
const TokensArtboard = () => {
  const colorGroups = [
    {
      name: "Yüzey (Surfaces)",
      desc: "Tek bir derin lacivert temel; üstüne yükseltilmiş yüzeyler için 2–3 katman.",
      swatches: [
        { name: "bg/base",     hex: "#0A0E1A", role: "Sayfa zemin" },
        { name: "bg/raised",   hex: "#0F1524", role: "Kart, panel" },
        { name: "bg/elevated", hex: "#151D31", role: "Modal, drawer" },
        { name: "bg/hover",    hex: "#1A2238", role: "Hover, satır" },
        { name: "border/subtle", hex: "#1E2740", role: "Bölücü çizgi" },
        { name: "border/strong", hex: "#2A3553", role: "Vurgulu çerçeve" },
      ],
    },
    {
      name: "Metin (Text)",
      desc: "Kontrast ile hiyerarşi. WCAG AA (≥4.5:1) gözetildi.",
      swatches: [
        { name: "text/primary",   hex: "#E8ECF5", role: "Ana metin"    },
        { name: "text/secondary", hex: "#A4ADC2", role: "Yardımcı"     },
        { name: "text/muted",     hex: "#6B7490", role: "Etiket"       },
        { name: "text/dim",       hex: "#4A5269", role: "Pasif"        },
      ],
    },
    {
      name: "Semantik",
      desc: "Renk = anlam. Marka turuncusu yalnızca CTA + 'gerçek acil' için.",
      swatches: [
        { name: "danger",  hex: "#F26B5E", role: "Acil, gecikme"   },
        { name: "warning", hex: "#E5A24B", role: "Uyarı, yavaşlama" },
        { name: "success", hex: "#4ADE80", role: "Teslim, OK"      },
        { name: "info",    hex: "#5B9DF9", role: "Yolda, devam"    },
        { name: "neutral", hex: "#7A8299", role: "Bekliyor"        },
        { name: "brand",   hex: "#FF7A45", role: "CTA, marka"      },
      ],
    },
  ];

  const typeScale = [
    { token: "display", size: "32 / 40", weight: 600, font: "Inter",       sample: "Operasyon Kontrol" },
    { token: "h1",      size: "22 / 30", weight: 600, font: "Inter",       sample: "Canlı Takip" },
    { token: "h2",      size: "16 / 22", weight: 600, font: "Inter",       sample: "Bölüm başlığı" },
    { token: "body",    size: "13 / 18", weight: 400, font: "Inter",       sample: "Normal metin akışı" },
    { token: "caption", size: "11 / 14", weight: 500, font: "Inter",       sample: "ETİKET · CAPS" },
    { token: "mono",    size: "12 / 16", weight: 500, font: "JetBrains Mono", sample: "34JC0608 · 21313" },
  ];

  const spacing = [1, 2, 3, 4, 6, 8, 12, 16, 24];

  return (
    <div style={{ padding: "32px 36px", color: "#E8ECF5", fontFamily: "Inter, sans-serif" }}>
      <Header
        eyebrow="00 — Tasarım Sistemi"
        title="Renk, tipografi, spacing"
        subtitle="Sakin koyu temel · marka turuncusu nadir · renk = anlam"
      />

      {/* Colors */}
      <div style={{ marginTop: 28, display: "grid", gap: 24 }}>
        {colorGroups.map(g => (
          <div key={g.name}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <h3 style={{ font: "600 13px Inter", margin: 0, letterSpacing: 0.2 }}>{g.name}</h3>
              <span style={{ font: "400 12px Inter", color: "#6B7490" }}>{g.desc}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
              {g.swatches.map(s => (
                <div key={s.name} style={{
                  background: "#0F1524", border: "1px solid #1E2740", borderRadius: 8, overflow: "hidden",
                }}>
                  <div style={{ height: 56, background: s.hex, borderBottom: "1px solid #1E2740" }} />
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ font: "500 11px JetBrains Mono, monospace", color: "#E8ECF5" }}>{s.name}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span style={{ font: "400 10px JetBrains Mono, monospace", color: "#6B7490" }}>{s.hex}</span>
                      <span style={{ font: "400 10px Inter", color: "#A4ADC2" }}>{s.role}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Type */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ font: "600 13px Inter", margin: "0 0 10px 0" }}>Tipografi ölçeği</h3>
        <div style={{ background: "#0F1524", border: "1px solid #1E2740", borderRadius: 10, overflow: "hidden" }}>
          {typeScale.map((t, i) => (
            <div key={t.token} style={{
              display: "grid",
              gridTemplateColumns: "120px 110px 90px 1fr",
              gap: 16, alignItems: "baseline",
              padding: "14px 16px",
              borderTop: i ? "1px solid #1E2740" : "none",
            }}>
              <span style={{ font: "500 11px JetBrains Mono, monospace", color: "#A4ADC2" }}>{t.token}</span>
              <span style={{ font: "400 11px JetBrains Mono, monospace", color: "#6B7490" }}>{t.size}px / {t.weight}</span>
              <span style={{ font: "400 11px Inter", color: "#6B7490" }}>{t.font}</span>
              <span style={{
                fontFamily: t.font === "JetBrains Mono" ? "JetBrains Mono, monospace" : "Inter, sans-serif",
                fontSize: parseInt(t.size), fontWeight: t.weight, color: "#E8ECF5",
                letterSpacing: t.token === "caption" ? 1.2 : 0,
                textTransform: t.token === "caption" ? "uppercase" : "none",
              }}>{t.sample}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Spacing */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ font: "600 13px Inter", margin: "0 0 10px 0" }}>Spacing — 4px grid</h3>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, padding: 16, background: "#0F1524", border: "1px solid #1E2740", borderRadius: 10 }}>
          {spacing.map(s => (
            <div key={s} style={{ textAlign: "center" }}>
              <div style={{ width: s * 4, height: s * 4, background: "#FF7A45", borderRadius: 2, marginBottom: 6 }} />
              <div style={{ font: "500 10px JetBrains Mono, monospace", color: "#A4ADC2" }}>{s * 4}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Principles */}
      <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[
          { t: "Tarama hızı", d: "3 saniyede 'acil olan ne?' sorusu cevaplanmalı. Tek bir renk vurgusu (turuncu/kırmızı) bunu sağlar." },
          { t: "Bilgi yoğunluğu", d: "Bloomberg mantığı. Boşluk değil, anlam. Mono font + kompakt satırlar = 2× veri / ekran." },
          { t: "Aksiyon önceliği", d: "Her kartta tek primary aksiyon. Sürücü ara · Konum gör · Yenile." },
          { t: "Sakin renk", d: "Acil değilse nötr. 5 işten 1'i acilse, ekranın %5'i turuncu olmalı — daha fazla değil." },
        ].map(p => (
          <div key={p.t} style={{ background: "#0F1524", border: "1px solid #1E2740", borderRadius: 10, padding: 16 }}>
            <div style={{ font: "600 13px Inter", color: "#E8ECF5", marginBottom: 4 }}>{p.t}</div>
            <div style={{ font: "400 12px Inter", color: "#A4ADC2", lineHeight: 1.5 }}>{p.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Header = ({ eyebrow, title, subtitle }) => (
  <div>
    <div style={{ font: "500 11px JetBrains Mono, monospace", letterSpacing: 1.2, color: "#FF7A45", textTransform: "uppercase" }}>{eyebrow}</div>
    <h1 style={{ font: "600 24px Inter", margin: "6px 0 4px 0", color: "#E8ECF5" }}>{title}</h1>
    <div style={{ font: "400 13px Inter", color: "#A4ADC2" }}>{subtitle}</div>
  </div>
);

window.TokensArtboard = TokensArtboard;
window.OpHeader = Header;
