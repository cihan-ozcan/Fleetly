/* Container card system + KPI bar + Alert strip */

// ─── Status semantic mapping ─────────────────────────────────────────
const STATUS = {
  bekliyor:  { label: "Bekliyor",  color: "#7A8299", glow: "rgba(122,130,153,0.18)" },
  yolda:     { label: "Yolda",     color: "#5B9DF9", glow: "rgba(91,157,249,0.20)" },
  fabrikada: { label: "Fabrikada", color: "#9F7AEA", glow: "rgba(159,122,234,0.20)" },
  teslim:    { label: "Teslim",    color: "#4ADE80", glow: "rgba(74,222,128,0.18)" },
};

const Pill = ({ children, color = "#A4ADC2", bg, mono, sm }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: sm ? "1px 6px" : "2px 8px",
    borderRadius: 4,
    fontFamily: mono ? "JetBrains Mono, monospace" : "Inter, sans-serif",
    fontSize: sm ? 10 : 11, fontWeight: 500,
    color, background: bg || "rgba(255,255,255,0.04)",
    border: bg ? "none" : "1px solid rgba(255,255,255,0.06)",
    letterSpacing: mono ? 0 : 0.2,
    whiteSpace: "nowrap",
  }}>{children}</span>
);

// ─── KPI Bar (redesigned) ────────────────────────────────────────────
const KPIBar = ({ alert = true }) => {
  const items = [
    { label: "Toplam",    value: 5, color: "#E8ECF5", trend: null,           sub: "iş emri"   },
    { label: "Bekliyor",  value: 0, color: "#7A8299", trend: null,           sub: "atanmadı"  },
    { label: "Yolda",     value: 1, color: "#5B9DF9", trend: { d: -1, t: "1 acil" }, accent: true, sub: "aktif sevkiyat" },
    { label: "Fabrikada", value: 0, color: "#9F7AEA", trend: null,           sub: "boşaltma"   },
    { label: "Teslim",    value: 4, color: "#4ADE80", trend: { d: +2, t: "bugün" }, sub: "tamamlandı" },
  ];

  return (
    <div style={{ background: "#0A0E1A" }}>
      {/* Alert strip — actionable */}
      {alert && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 20px",
          background: "linear-gradient(90deg, rgba(242,107,94,0.10) 0%, rgba(242,107,94,0.02) 60%)",
          borderBottom: "1px solid rgba(242,107,94,0.25)",
          borderLeft: "3px solid #F26B5E",
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 9,
            background: "rgba(242,107,94,0.18)", color: "#F26B5E",
            display: "grid", placeItems: "center",
            font: "700 11px Inter",
          }}>!</div>
          <span style={{ font: "600 12px Inter", color: "#F26B5E", letterSpacing: 0.2 }}>1 ACİL</span>
          <span style={{ font: "400 12px Inter", color: "#E8ECF5" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#F26B5E" }}>34JC0608</span>
            {"  ·  "}
            6+ saattir yolda · ETA gecikti
          </span>
          <span style={{ flex: 1 }} />
          <button style={btn("ghost")}>Sürücüyü Ara</button>
          <button style={btn("danger")}>Detay</button>
          <button style={iconBtn()} aria-label="Kapat">✕</button>
        </div>
      )}

      {/* KPI strip — Bloomberg-like */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        borderBottom: "1px solid #1E2740",
      }}>
        {items.map((k, i) => (
          <div key={k.label} style={{
            padding: "16px 20px",
            borderRight: i < 4 ? "1px solid #1E2740" : "none",
            position: "relative",
            background: k.accent ? "rgba(91,157,249,0.04)" : "transparent",
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{
                font: "600 28px JetBrains Mono, monospace", color: k.color,
                letterSpacing: -0.5, lineHeight: 1,
              }}>{k.value}</span>
              {k.trend && (
                <span style={{
                  font: "500 11px JetBrains Mono, monospace",
                  color: k.trend.d > 0 ? "#4ADE80" : "#F26B5E",
                }}>
                  {k.trend.d > 0 ? "▲" : "▼"} {k.trend.t}
                </span>
              )}
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginTop: 6,
            }}>
              <span style={{
                font: "500 10px Inter", letterSpacing: 1.4,
                textTransform: "uppercase", color: "#A4ADC2",
              }}>{k.label}</span>
              <span style={{ font: "400 10px Inter", color: "#6B7490" }}>{k.sub}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const btn = (variant = "default") => {
  const base = {
    height: 28, padding: "0 12px", borderRadius: 6,
    font: "500 12px Inter", border: "1px solid", cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 6,
  };
  if (variant === "primary") return { ...base, background: "#FF7A45", borderColor: "#FF7A45", color: "#0A0E1A" };
  if (variant === "danger")  return { ...base, background: "rgba(242,107,94,0.12)", borderColor: "rgba(242,107,94,0.45)", color: "#F26B5E" };
  if (variant === "ghost")   return { ...base, background: "transparent", borderColor: "rgba(232,236,245,0.12)", color: "#E8ECF5" };
  return { ...base, background: "#1A2238", borderColor: "#2A3553", color: "#E8ECF5" };
};
const iconBtn = () => ({
  width: 24, height: 24, borderRadius: 4, border: "1px solid transparent",
  background: "transparent", color: "#A4ADC2", cursor: "pointer",
  display: "grid", placeItems: "center", font: "500 12px Inter",
});

// ─── Container Card — rich + scannable ────────────────────────────────
// status: "bekliyor" | "yolda" | "fabrikada" | "teslim"
// urgency: "normal" | "urgent" | "delayed"
const ContainerCard = ({
  plate = "34JC0608", containerNo = "21313", type = "40 DC",
  customer = "Test A.Ş", driver = "Cihan Özcan", driverPhone = "+90 538 459 41 38",
  status = "yolda", urgency = "normal",
  loaded = false, // dolu / boş
  eta = "02:54", lastPing = "26 dk önce", duration = "12s 32dk",
  km = 111, kmLeft = 22,
  origin = "Kumport", destination = "Mega Metal · Çatalca",
  progress = 0.72,
  pod = false,
  delayMin = null,
}) => {
  const s = STATUS[status];
  const isUrgent = urgency === "urgent";
  const isDelayed = urgency === "delayed";

  // Border + accent based on urgency, not status
  let borderColor = "#1E2740";
  let leftAccent = s.color;
  let leftAccentWidth = 2;
  let bg = "#0F1524";
  if (isUrgent) {
    borderColor = "rgba(242,107,94,0.50)";
    leftAccent = "#F26B5E";
    leftAccentWidth = 3;
    bg = "linear-gradient(90deg, rgba(242,107,94,0.06) 0%, #0F1524 30%)";
  } else if (isDelayed) {
    borderColor = "rgba(229,162,75,0.40)";
    leftAccent = "#E5A24B";
  }

  return (
    <div style={{
      position: "relative",
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      overflow: "hidden",
      boxShadow: isUrgent ? "0 0 0 1px rgba(242,107,94,0.12), 0 8px 20px rgba(0,0,0,0.30)" : "0 2px 6px rgba(0,0,0,0.25)",
    }}>
      {/* left accent bar */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: leftAccentWidth, background: leftAccent,
      }} />

      {/* Top row: plate + type + status pill */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px 8px 14px",
      }}>
        <span style={{
          font: "600 13px JetBrains Mono, monospace",
          color: "#E8ECF5", letterSpacing: 0.3,
        }}>{plate}</span>
        <Pill mono sm color="#A4ADC2">{type}</Pill>
        <Pill sm color={loaded ? "#4ADE80" : "#A4ADC2"} bg={loaded ? "rgba(74,222,128,0.10)" : "rgba(255,255,255,0.04)"}>
          <span style={{ width: 5, height: 5, borderRadius: 5, background: loaded ? "#4ADE80" : "#7A8299" }} />
          {loaded ? "Dolu" : "Boş"}
        </Pill>
        <span style={{ flex: 1 }} />
        {isUrgent && (
          <Pill sm color="#F26B5E" bg="rgba(242,107,94,0.14)">
            <span style={{ width: 5, height: 5, borderRadius: 5, background: "#F26B5E" }} />
            ACİL
          </Pill>
        )}
        {isDelayed && (
          <Pill sm color="#E5A24B" bg="rgba(229,162,75,0.12)">+{delayMin || 18}dk</Pill>
        )}
        {pod && (
          <Pill sm color="#4ADE80" bg="rgba(74,222,128,0.10)">✓ POD</Pill>
        )}
      </div>

      {/* Container line */}
      <div style={{ padding: "0 12px 8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ font: "500 12px JetBrains Mono, monospace", color: "#A4ADC2" }}>
          ⬛ {containerNo}
        </span>
        <span style={{ color: "#2A3553", font: "400 11px Inter" }}>·</span>
        <span style={{ font: "400 12px Inter", color: "#A4ADC2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {customer}
        </span>
      </div>

      {/* Driver */}
      <div style={{
        padding: "8px 12px 8px 14px",
        display: "flex", alignItems: "center", gap: 8,
        borderTop: "1px solid #1E2740",
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 11,
          background: "linear-gradient(135deg, #2A3553, #1A2238)",
          display: "grid", placeItems: "center",
          font: "600 10px Inter", color: "#E8ECF5",
        }}>{driver.split(" ").map(w => w[0]).join("").slice(0,2)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "500 12px Inter", color: "#E8ECF5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {driver}
          </div>
          <div style={{ font: "400 10px JetBrains Mono, monospace", color: "#6B7490" }}>{driverPhone}</div>
        </div>
        <span title="Sürücü uygulamaya bağlı" style={{
          width: 6, height: 6, borderRadius: 6, background: "#4ADE80",
          boxShadow: "0 0 0 3px rgba(74,222,128,0.15)",
        }} />
      </div>

      {/* Route + progress */}
      {(status === "yolda" || status === "fabrikada") && (
        <div style={{ padding: "8px 12px 4px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ font: "400 11px Inter", color: "#A4ADC2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>{origin}</span>
            <span style={{ font: "400 11px Inter", color: "#A4ADC2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%", textAlign: "right" }}>{destination}</span>
          </div>
          <div style={{ height: 3, background: "#1A2238", borderRadius: 2, position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", top: 0, left: 0, height: "100%",
              width: `${progress * 100}%`,
              background: isUrgent ? "#F26B5E" : isDelayed ? "#E5A24B" : "#5B9DF9",
            }} />
          </div>
        </div>
      )}

      {/* Metrics footer */}
      <div style={{
        padding: "8px 12px 10px 14px",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        {status !== "teslim" && status !== "bekliyor" && (
          <>
            <Metric icon="ETA" value={eta} mono />
            <Metric icon="◷" value={duration} muted />
            <Metric
              icon="⬤" value={lastPing}
              color={isUrgent ? "#F26B5E" : isDelayed ? "#E5A24B" : "#A4ADC2"}
            />
          </>
        )}
        {status === "teslim" && (
          <>
            <Metric icon="✓" value={`${km} km`} color="#4ADE80" />
            <Metric icon="+" value={`${kmLeft} km dönüş`} muted />
          </>
        )}
        {status === "bekliyor" && (
          <Metric icon="◷" value="atanmadı" muted />
        )}
      </div>
    </div>
  );
};

const Metric = ({ icon, value, mono, color = "#A4ADC2", muted }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    font: `${mono ? "500" : "400"} 11px ${mono ? "JetBrains Mono, monospace" : "Inter, sans-serif"}`,
    color: muted ? "#6B7490" : color,
  }}>
    <span style={{ font: "500 10px Inter", color: muted ? "#4A5269" : color, opacity: 0.9 }}>{icon}</span>
    {value}
  </span>
);

window.STATUS = STATUS;
window.Pill = Pill;
window.KPIBar = KPIBar;
window.ContainerCard = ContainerCard;
window.opBtn = btn;
window.opIconBtn = iconBtn;
