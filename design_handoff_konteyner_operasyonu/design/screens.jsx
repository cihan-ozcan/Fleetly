/* Table redesign + Modal stepper + Detail drawer + Before/After */

// ─── Table ────────────────────────────────────────────────────────────
const TableArtboard = () => {
  const rows = [
    { id: "#37", customer: "Test A.Ş",        plate: "34JC0608", cont: "21313",        type: "40 DC", db: "Boş",  durum: "yolda",   urgency: "urgent",  yola: "04/05 02:54", ago: "12s 32dk önce", km: 111, fabGiris: "04/05 12:07", fabCikis: "04/05 12:08", bekleme: "0dk", driver: "Cihan Özcan" },
    { id: "#38", customer: "Mega Plastik",    plate: "34DU8419", cont: "SEKU1484480",  type: "40 DC", db: "Dolu", durum: "yolda",   urgency: "delayed", yola: "04/05 13:14", ago: "3s 18dk önce",  km: 86,  fabGiris: "—",          fabCikis: "—",          bekleme: "—",   driver: "Hasan Yılmaz" },
    { id: "#39", customer: "Arçelik Çayırova", plate: "34KAL204", cont: "ABCU1234567", type: "20 DC", db: "Dolu", durum: "yolda",   urgency: "normal",  yola: "04/05 14:28", ago: "2s 04dk önce",  km: 42,  fabGiris: "—",          fabCikis: "—",          bekleme: "—",   driver: "Murat Demir" },
    { id: "#40", customer: "Test A.Ş",        plate: "34ENA024", cont: "TGHU8821145",  type: "40 HC", db: "Dolu", durum: "fabrikada", urgency: "normal", yola: "04/05 09:14", ago: "7s 18dk önce",  km: 92,  fabGiris: "04/05 15:50", fabCikis: "—",          bekleme: "42dk", driver: "Erkan Aydın" },
    { id: "#41", customer: "Sütaş Karacabey", plate: "34JC0608", cont: "234234",       type: "40 DC", db: "Dolu", durum: "teslim",  urgency: "normal",  yola: "04/05 06:00", ago: "8s 12dk önce",  km: 44,  fabGiris: "04/05 09:40", fabCikis: "04/05 10:12", bekleme: "32dk", driver: "Cihan Özcan" },
    { id: "#42", customer: "Eti Maden",       plate: "34KNG497", cont: "FCIU2210447",  type: "20 DC", db: "Dolu", durum: "teslim",  urgency: "normal",  yola: "04/05 05:42", ago: "9s 04dk önce",  km: 87,  fabGiris: "04/05 11:08", fabCikis: "04/05 11:42", bekleme: "34dk", driver: "İlker Ç." },
    { id: "#43", customer: "Çelikler Demir",  plate: "—",        cont: "MSCU7741209",  type: "20 DC", db: "Boş",  durum: "bekliyor", urgency: "normal", yola: "—",            ago: "—",             km: 0,   fabGiris: "—",          fabCikis: "—",          bekleme: "—",   driver: "—" },
  ];
  const cols = [
    { k: "id",        h: "ID",       w: 50,  align: "left",  mono: true },
    { k: "customer",  h: "Müşteri",  w: 150, align: "left" },
    { k: "plate",     h: "Araç",     w: 95,  align: "left",  mono: true, accent: true },
    { k: "cont",      h: "Konteyner", w: 130, align: "left", mono: true },
    { k: "type",      h: "Tip",      w: 60,  align: "left" },
    { k: "db",        h: "D/B",      w: 50,  align: "left" },
    { k: "durum",     h: "Durum",    w: 95,  align: "left" },
    { k: "yola",      h: "Yola Çıkış", w: 130, align: "left", mono: true },
    { k: "km",        h: "KM",       w: 50,  align: "right", mono: true },
    { k: "fabGiris",  h: "Fab. Giriş", w: 110, align: "left", mono: true },
    { k: "fabCikis",  h: "Fab. Çıkış", w: 110, align: "left", mono: true },
    { k: "bekleme",   h: "Bekleme",  w: 70,  align: "right" },
    { k: "driver",    h: "Sürücü",   w: 130, align: "left" },
  ];

  return (
    <div style={{ background: "#0A0E1A", color: "#E8ECF5", fontFamily: "Inter, sans-serif" }}>
      <window.AppBar />
      <window.KPIBar alert={false} />
      <window.ViewBar active="emirler" />

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", background: "#0A0E1A", borderBottom: "1px solid #1E2740" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 10px", height: 30,
          background: "#0F1524", border: "1px solid #1E2740", borderRadius: 6,
          flex: 1, maxWidth: 460,
        }}>
          <span style={{ font: "400 12px Inter", color: "#6B7490" }}>⌕</span>
          <span style={{ font: "400 12px Inter", color: "#6B7490", flex: 1 }}>Konteyner no, referans, müşteri, araç, liman…</span>
        </div>
        <button style={{ ...window.opBtn("ghost"), height: 30 }}>Tüm Durumlar ▾</button>
        <button style={{ ...window.opBtn("ghost"), height: 30 }}>Bugün ▾</button>
        <button style={{ ...window.opBtn("ghost"), height: 30 }}>Müşteri ▾</button>
        <span style={{ flex: 1 }} />
        <span style={{ font: "400 11px JetBrains Mono, monospace", color: "#6B7490" }}>7 kayıt · 3 aktif · 1 acil</span>
        <button style={{ ...window.opBtn("ghost"), height: 30 }}>↓ Dışa aktar</button>
      </div>

      {/* Table */}
      <div style={{ padding: "0 0 24px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols.map(c => `${c.w}px`).join(" ") + " 110px",
          background: "#0A0E1A",
          borderBottom: "1px solid #1E2740",
          padding: "0 20px",
        }}>
          {cols.map(c => (
            <div key={c.k} style={{
              padding: "10px 8px",
              font: "500 10px Inter", letterSpacing: 1.2,
              textTransform: "uppercase", color: "#6B7490",
              textAlign: c.align,
            }}>{c.h}</div>
          ))}
          <div style={{ padding: "10px 8px", font: "500 10px Inter", letterSpacing: 1.2, textTransform: "uppercase", color: "#6B7490", textAlign: "right" }}>İşlem</div>
        </div>
        {rows.map((r, idx) => {
          const isUrgent = r.urgency === "urgent";
          const isDelayed = r.urgency === "delayed";
          return (
            <div key={r.id} style={{
              display: "grid",
              gridTemplateColumns: cols.map(c => `${c.w}px`).join(" ") + " 110px",
              padding: "0 20px",
              background: idx % 2 ? "#0C1220" : "#0A0E1A",
              borderLeft: isUrgent ? "2px solid #F26B5E" : isDelayed ? "2px solid #E5A24B" : "2px solid transparent",
              transition: "background 200ms",
            }}>
              {cols.map(c => {
                const v = r[c.k];
                let content = v;
                if (c.k === "durum") {
                  const s = window.STATUS[v];
                  content = (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      font: "500 11px Inter", color: s.color,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: 6, background: s.color, boxShadow: `0 0 0 2px ${s.glow}` }} />
                      {s.label}
                      {isUrgent && <span style={{ font: "600 10px Inter", color: "#F26B5E", marginLeft: 4 }}>· ACİL</span>}
                      {isDelayed && <span style={{ font: "600 10px Inter", color: "#E5A24B", marginLeft: 4 }}>· +18dk</span>}
                    </span>
                  );
                } else if (c.k === "yola" && v !== "—") {
                  content = (
                    <div>
                      <div style={{ font: "500 12px JetBrains Mono, monospace", color: "#E8ECF5" }}>{v}</div>
                      <div style={{
                        font: "400 10px JetBrains Mono, monospace",
                        color: isUrgent ? "#F26B5E" : isDelayed ? "#E5A24B" : "#6B7490",
                      }}>{r.ago}</div>
                    </div>
                  );
                } else if (c.k === "type") {
                  content = <window.Pill mono sm color="#A4ADC2">{v}</window.Pill>;
                } else if (c.k === "db") {
                  content = <window.Pill sm color={v === "Dolu" ? "#4ADE80" : "#A4ADC2"} bg={v === "Dolu" ? "rgba(74,222,128,0.10)" : "rgba(255,255,255,0.04)"}>{v}</window.Pill>;
                } else if (c.k === "bekleme" && v !== "—") {
                  const minutes = parseInt(v);
                  const overLimit = minutes > 30;
                  content = <span style={{
                    font: "500 11px JetBrains Mono, monospace",
                    color: overLimit ? "#E5A24B" : "#A4ADC2",
                  }}>{v}</span>;
                } else if (c.accent && v !== "—") {
                  content = <span style={{ color: "#FF7A45", font: "500 12px JetBrains Mono, monospace" }}>{v}</span>;
                } else if (c.mono && v !== "—") {
                  content = <span style={{ font: "500 12px JetBrains Mono, monospace", color: "#E8ECF5" }}>{v}</span>;
                } else if (v === "—") {
                  content = <span style={{ color: "#4A5269" }}>—</span>;
                }
                return (
                  <div key={c.k} style={{
                    padding: "10px 8px", textAlign: c.align,
                    font: "400 12px Inter", color: "#E8ECF5",
                    display: "flex", alignItems: "center",
                    justifyContent: c.align === "right" ? "flex-end" : "flex-start",
                    borderTop: idx === 0 ? "none" : "1px solid #14192B",
                  }}>{content}</div>
                );
              })}
              {/* Action cluster */}
              <div style={{
                padding: "8px 8px", textAlign: "right",
                display: "flex", justifyContent: "flex-end", gap: 4, alignItems: "center",
                borderTop: idx === 0 ? "none" : "1px solid #14192B",
              }}>
                <ActionBtn label="Detay" icon="↗" />
                <ActionBtn label="Düzenle" icon="✎" />
                <ActionBtn label="Duraklat" icon="⏸" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ActionBtn = ({ label, icon }) => (
  <button title={label} style={{
    width: 26, height: 26, borderRadius: 5,
    background: "transparent", border: "1px solid #1E2740",
    color: "#A4ADC2", cursor: "pointer",
    display: "grid", placeItems: "center",
    font: "500 12px Inter",
  }}>{icon}</button>
);

// ─── Modal stepper ───────────────────────────────────────────────────
const ModalArtboard = () => {
  const steps = [
    { n: 1, label: "Müşteri & Konteyner", state: "done" },
    { n: 2, label: "Sürücü & Araç",       state: "active" },
    { n: 3, label: "Rota",                state: "future" },
    { n: 4, label: "Onay",                state: "future" },
  ];
  return (
    <div style={{
      background: "#0A0E1A", padding: 40,
      display: "grid", placeItems: "center",
      fontFamily: "Inter, sans-serif", color: "#E8ECF5",
    }}>
      {/* Backdrop hint */}
      <div style={{
        width: 720, background: "#151D31",
        border: "1px solid #2A3553", borderRadius: 10,
        boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid #2A3553",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "rgba(255,122,69,0.14)", color: "#FF7A45",
            display: "grid", placeItems: "center",
            font: "600 14px Inter",
          }}>+</div>
          <div>
            <div style={{ font: "600 14px Inter" }}>Yeni İş Emri</div>
            <div style={{ font: "400 11px Inter", color: "#A4ADC2" }}>4 adımda tamamla · taslak otomatik kaydediliyor</div>
          </div>
          <span style={{ flex: 1 }} />
          <button style={window.opIconBtn()}>✕</button>
        </div>

        {/* Stepper rail */}
        <div style={{ display: "flex", padding: "16px 20px 0 20px", gap: 12 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 11,
                background: s.state === "done" ? "#4ADE80" : s.state === "active" ? "#FF7A45" : "#1A2238",
                color: s.state === "future" ? "#6B7490" : "#0A0E1A",
                display: "grid", placeItems: "center",
                font: "600 11px Inter",
                border: s.state === "active" ? "3px solid rgba(255,122,69,0.25)" : "none",
              }}>{s.state === "done" ? "✓" : s.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{
                  font: `${s.state === "active" ? 600 : 500} 11px Inter`,
                  color: s.state === "future" ? "#6B7490" : s.state === "active" ? "#E8ECF5" : "#A4ADC2",
                  letterSpacing: 0.2,
                }}>{s.label}</div>
                <div style={{
                  height: 2, marginTop: 4, borderRadius: 2,
                  background: s.state === "done" ? "#4ADE80" : s.state === "active" ? "#FF7A45" : "#1A2238",
                  opacity: s.state === "future" ? 0.4 : 1,
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* Body — step 2 active */}
        <div style={{ padding: "20px 20px 8px 20px" }}>
          <div style={{ font: "600 12px Inter", color: "#E8ECF5", letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 4 }}>
            Sürücü & Araç
          </div>
          <div style={{ font: "400 12px Inter", color: "#A4ADC2", marginBottom: 18 }}>
            Sürücüyü plakadan ya da telefondan ara. Mobil uygulamaya bağlıysa otomatik bildirim gider.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Sürücü ara" hint="Plaka, isim ya da telefon">
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "0 10px", height: 36,
                background: "#0A0E1A", border: "1px solid #FF7A45", borderRadius: 6,
                boxShadow: "0 0 0 3px rgba(255,122,69,0.15)",
              }}>
                <span style={{ color: "#FF7A45" }}>⌕</span>
                <span style={{ font: "500 13px JetBrains Mono, monospace", color: "#E8ECF5", flex: 1 }}>34JC|</span>
              </div>
              {/* Suggestions dropdown */}
              <div style={{
                marginTop: 6, background: "#0F1524",
                border: "1px solid #2A3553", borderRadius: 6, overflow: "hidden",
              }}>
                {[
                  { plate: "34JC0608", driver: "Cihan Özcan", phone: "+90 538 459 41 38", online: true, active: true },
                  { plate: "34JC1142", driver: "Hasan Yılmaz", phone: "+90 532 118 22 90", online: true, active: false },
                  { plate: "34JC8849", driver: "Murat Demir", phone: "+90 545 220 11 04", online: false, active: false },
                ].map(d => (
                  <div key={d.plate} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px",
                    background: d.active ? "rgba(255,122,69,0.06)" : "transparent",
                    borderBottom: "1px solid #1E2740",
                  }}>
                    <span style={{ font: "500 12px JetBrains Mono, monospace", color: "#FF7A45" }}>{d.plate}</span>
                    <span style={{ font: "400 12px Inter", color: "#E8ECF5" }}>{d.driver}</span>
                    <span style={{ font: "400 11px JetBrains Mono, monospace", color: "#6B7490", marginLeft: "auto" }}>{d.phone}</span>
                    <span style={{
                      width: 6, height: 6, borderRadius: 6,
                      background: d.online ? "#4ADE80" : "#4A5269",
                      boxShadow: d.online ? "0 0 0 2px rgba(74,222,128,0.18)" : "none",
                    }} />
                  </div>
                ))}
              </div>
            </Field>

            <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
              <Field label="Sürücü adı">
                <Input value="Cihan Özcan" />
              </Field>
              <Field label="Telefon">
                <Input value="+90 538 459 41 38" mono />
              </Field>
              <Field label="Konteyner tipi">
                <div style={{ display: "flex", gap: 6 }}>
                  {["20 DC", "40 DC", "40 HC", "Reefer"].map(t => (
                    <button key={t} style={{
                      height: 32, padding: "0 10px", borderRadius: 5,
                      border: "1px solid",
                      borderColor: t === "40 DC" ? "#FF7A45" : "#1E2740",
                      background: t === "40 DC" ? "rgba(255,122,69,0.10)" : "#0A0E1A",
                      color: t === "40 DC" ? "#FF7A45" : "#A4ADC2",
                      font: "500 12px Inter", cursor: "pointer",
                    }}>{t}</button>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "16px 20px",
          borderTop: "1px solid #2A3553",
          background: "#0F1524",
        }}>
          <span style={{ font: "400 11px Inter", color: "#6B7490" }}>
            ⌘+Enter ile sonraki adım
          </span>
          <span style={{ flex: 1 }} />
          <button style={window.opBtn("ghost")}>İptal</button>
          <button style={window.opBtn("default")}>← Geri</button>
          <button style={window.opBtn("primary")}>Sonraki →</button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, hint, children }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
      <span style={{ font: "500 10px Inter", letterSpacing: 1.2, textTransform: "uppercase", color: "#A4ADC2" }}>{label}</span>
      {hint && <span style={{ font: "400 10px Inter", color: "#6B7490" }}>{hint}</span>}
    </div>
    {children}
  </div>
);
const Input = ({ value, mono }) => (
  <div style={{
    display: "flex", alignItems: "center",
    padding: "0 10px", height: 36,
    background: "#0A0E1A", border: "1px solid #1E2740", borderRadius: 6,
    font: `500 12px ${mono ? "JetBrains Mono, monospace" : "Inter, sans-serif"}`,
    color: "#E8ECF5",
  }}>{value}</div>
);

// ─── Detail Drawer ───────────────────────────────────────────────────
const DrawerArtboard = () => {
  return (
    <div style={{
      background: "#0A0E1A", color: "#E8ECF5", fontFamily: "Inter, sans-serif",
      display: "grid", gridTemplateColumns: "1fr 440px", minHeight: 760,
    }}>
      {/* Faded background */}
      <div style={{ position: "relative", overflow: "hidden", background: "#0A0E1A" }}>
        <div style={{ filter: "blur(2px) opacity(0.45)", pointerEvents: "none" }}>
          <window.AppBar />
          <window.KPIBar />
        </div>
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(90deg, rgba(10,14,26,0.4) 0%, rgba(10,14,26,0.85) 100%)",
        }} />
      </div>

      {/* Drawer */}
      <div style={{
        background: "#151D31", borderLeft: "1px solid #2A3553",
        display: "flex", flexDirection: "column",
        boxShadow: "-30px 0 80px rgba(0,0,0,0.45)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A3553" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <window.Pill sm color="#5B9DF9" bg="rgba(91,157,249,0.12)">
              <span style={{ width: 5, height: 5, borderRadius: 5, background: "#5B9DF9" }} /> Yolda
            </window.Pill>
            <window.Pill sm color="#F26B5E" bg="rgba(242,107,94,0.12)">
              <span style={{ width: 5, height: 5, borderRadius: 5, background: "#F26B5E" }} /> ACİL
            </window.Pill>
            <span style={{ flex: 1 }} />
            <button style={window.opIconBtn()}>↻</button>
            <button style={window.opIconBtn()}>⤢</button>
            <button style={window.opIconBtn()}>✕</button>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ font: "600 22px Inter" }}>21313</span>
            <span style={{ font: "500 13px JetBrains Mono, monospace", color: "#FF7A45" }}>· 34JC0608</span>
          </div>
          <div style={{ font: "400 12px Inter", color: "#A4ADC2", marginTop: 4 }}>
            40 DC · Boş · Test A.Ş · Cihan Özcan
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <button style={window.opBtn("primary")}>📞 Sürücüyü Ara</button>
            <button style={window.opBtn("default")}>📍 Konum</button>
            <button style={window.opBtn("default")}>↻ Yenile</button>
          </div>
        </div>

        {/* Live route — most important */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A3553" }}>
          <SectionHeader>Canlı Rota</SectionHeader>
          <RouteTimeline />
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", padding: "0 20px",
          borderBottom: "1px solid #2A3553",
        }}>
          {["Detaylar", "Olay Akışı", "Belgeler", "Yakıt"].map((t, i) => (
            <div key={t} style={{
              padding: "10px 14px",
              font: `${i === 0 ? 600 : 500} 12px Inter`,
              color: i === 0 ? "#E8ECF5" : "#A4ADC2",
              borderBottom: i === 0 ? "2px solid #FF7A45" : "2px solid transparent",
              cursor: "pointer",
            }}>{t}</div>
          ))}
        </div>

        {/* Detail rows */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <DetailGroup title="Durum & Konteyner" rows={[
            ["Müşteri", "Test A.Ş"],
            ["Araç", <span style={{ color: "#FF7A45", font: "500 12px JetBrains Mono, monospace" }}>34JC0608</span>],
            ["Sürücü", <span>Cihan Özcan <span style={{ color: "#4ADE80", font: "500 11px Inter", marginLeft: 6 }}>● Bağlı</span></span>],
            ["Sürücü Tel.", <span style={{ font: "500 12px JetBrains Mono, monospace" }}>+90 538 459 41 38</span>],
            ["Konteyner No", <span style={{ font: "500 12px JetBrains Mono, monospace" }}>21313</span>],
            ["Konteyner Tipi", <window.Pill mono sm>40 DC</window.Pill>],
            ["Dolu / Boş", <window.Pill sm color="#A4ADC2">Boş</window.Pill>],
          ]} />
          <DetailGroup title="Belgeler & Referans" rows={[
            ["Referans No", "—"],
            ["Mühür No", "—"],
            ["Alım Noktası", "Kumport · Ambarlı"],
            ["Teslim Yeri", "Mega Metal · Çatalca"],
            ["Boş Dönüş", "—"],
          ]} />
          <DetailGroup title="Süre & Mesafe" rows={[
            ["Bekleme Süresi", <span style={{ color: "#E8ECF5", font: "500 12px JetBrains Mono, monospace" }}>0dk</span>],
            ["Km Aralığı", <span style={{ font: "500 12px JetBrains Mono, monospace" }}>111 → 134</span>],
            ["Toplam Süre", <span style={{ color: "#F26B5E", font: "500 12px JetBrains Mono, monospace" }}>12s 32dk</span>],
          ]} />
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({ children }) => (
  <div style={{
    font: "500 10px Inter", letterSpacing: 1.4, textTransform: "uppercase",
    color: "#6B7490", marginBottom: 10,
  }}>{children}</div>
);

const DetailGroup = ({ title, rows }) => (
  <div style={{ borderBottom: "1px solid #1E2740" }}>
    <div style={{ padding: "12px 20px 6px 20px" }}>
      <SectionHeader>{title}</SectionHeader>
    </div>
    {rows.map(([k, v], i) => (
      <div key={k} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 20px",
        font: "400 12px Inter",
      }}>
        <span style={{ color: "#A4ADC2" }}>{k}</span>
        <span style={{ color: "#E8ECF5", textAlign: "right" }}>{v}</span>
      </div>
    ))}
  </div>
);

const RouteTimeline = () => {
  const stops = [
    { label: "Kumport · Ambarlı",  time: "04/05 02:54", state: "done",    detail: "Yola çıktı" },
    { label: "TEM otoyol",          time: "04/05 04:18", state: "done",    detail: "Hareket halinde" },
    { label: "Hadımköy mola",       time: "04/05 06:42", state: "done",    detail: "32dk durdu" },
    { label: "Çatalca girişi",      time: "Şu an",      state: "current", detail: "Son ping 26 dk önce", urgent: true },
    { label: "Mega Metal · Çatalca", time: "ETA 07:30 (gecikti)", state: "future", detail: "≈ 22 km · 18 dk" },
  ];
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", left: 8, top: 6, bottom: 6, width: 1, background: "#2A3553" }} />
      {stops.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", position: "relative" }}>
          <div style={{
            width: 17, height: 17, borderRadius: 9,
            background: s.state === "done" ? "#4ADE80" : s.state === "current" ? (s.urgent ? "#F26B5E" : "#5B9DF9") : "#1A2238",
            border: s.state === "future" ? "1px solid #2A3553" : "none",
            display: "grid", placeItems: "center", flexShrink: 0,
            zIndex: 1, marginTop: 2,
            boxShadow: s.state === "current" ? `0 0 0 4px ${s.urgent ? "rgba(242,107,94,0.18)" : "rgba(91,157,249,0.18)"}` : "none",
            color: "#0A0E1A", font: "700 9px Inter",
          }}>{s.state === "done" ? "✓" : s.state === "current" ? "●" : ""}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{
                font: `${s.state === "current" ? 600 : 500} 12px Inter`,
                color: s.state === "future" ? "#6B7490" : "#E8ECF5",
              }}>{s.label}</span>
              <span style={{
                font: "500 11px JetBrains Mono, monospace",
                color: s.urgent ? "#F26B5E" : s.state === "future" ? "#6B7490" : "#A4ADC2",
              }}>{s.time}</span>
            </div>
            <div style={{ font: "400 11px Inter", color: s.urgent ? "#F26B5E" : "#6B7490", marginTop: 1 }}>{s.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Card variants showcase ──────────────────────────────────────────
const CardVariantsArtboard = () => {
  const variants = [
    { title: "Bekliyor — Sürücü atanmamış", props: { plate: "—", containerNo: "MSCU7741209", type: "20 DC", customer: "Çelikler Demir", driver: "Sürücü atanmamış", driverPhone: "—", status: "bekliyor", urgency: "normal", loaded: false, origin: "Marport", destination: "İkitelli OSB" } },
    { title: "Yolda — Normal akış", props: { plate: "34KAL204", containerNo: "ABCU1234567", type: "20 DC", customer: "Sütaş Karacabey", driver: "Murat Demir", driverPhone: "+90 545 220 11 04", status: "yolda", urgency: "normal", loaded: true, eta: "18:10", duration: "2s 04dk", lastPing: "1 dk önce", origin: "Borusan · Gemlik", destination: "Karacabey", progress: 0.28 } },
    { title: "Yolda — Gecikme (+18dk)", props: { plate: "34DU8419", containerNo: "SEKU1484480", type: "40 DC", customer: "Arçelik Çayırova", driver: "Hasan Yılmaz", driverPhone: "+90 532 118 22 90", status: "yolda", urgency: "delayed", loaded: true, eta: "16:42", duration: "3s 18dk", lastPing: "4 dk önce", origin: "Asyaport", destination: "Çayırova Fab.", progress: 0.45, delayMin: 18 } },
    { title: "Yolda — ACİL (sinyal kaybı)", props: { plate: "34JC0608", containerNo: "21313", type: "40 DC", customer: "Test A.Ş", driver: "Cihan Özcan", driverPhone: "+90 538 459 41 38", status: "yolda", urgency: "urgent", loaded: false, eta: "02:54 (gecikti)", duration: "12s 32dk", lastPing: "26 dk önce", origin: "Kumport", destination: "Mega Metal · Çatalca", progress: 0.62 } },
    { title: "Fabrikada — Boşaltma", props: { plate: "34ENA024", containerNo: "TGHU8821145", type: "40 HC", customer: "Test A.Ş", driver: "Erkan Aydın", driverPhone: "+90 533 776 89 12", status: "fabrikada", urgency: "normal", loaded: true, eta: "Beklemede", duration: "0s 42dk", lastPing: "12 dk önce", origin: "Kumport", destination: "Mega Metal", progress: 1.0 } },
    { title: "Teslim — POD onaylı", props: { plate: "34JC0608", containerNo: "234234", type: "40 DC", customer: "Test A.Ş", driver: "Cihan Özcan", driverPhone: "+90 538 459 41 38", status: "teslim", urgency: "normal", loaded: true, km: 44, kmLeft: 22, pod: true } },
  ];
  return (
    <div style={{ padding: 32, background: "#0A0E1A", color: "#E8ECF5", fontFamily: "Inter, sans-serif" }}>
      <window.OpHeader
        eyebrow="01 — Komponent: Konteyner kartı"
        title="6 varyant · tek anatomi"
        subtitle="Kenar rengi = aciliyet. Pill = duruluk. Mono = identifier. Ufak ping noktası = sürücü canlı."
      />
      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, 320px)", gap: 14 }}>
        {variants.map(v => (
          <div key={v.title}>
            <div style={{ font: "500 11px Inter", letterSpacing: 0.4, color: "#A4ADC2", marginBottom: 8 }}>{v.title}</div>
            <window.ContainerCard {...v.props} />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Before / After ──────────────────────────────────────────────────
const BeforeAfterArtboard = () => {
  const issues = [
    { issue: "Görsel hiyerarşi zayıf", before: "Acil bandı · KPI'lar · kanban hep aynı görsel ağırlıkta.", after: "Tek bir kırmızı vurgu (bant) ve tek primary CTA. KPI sayıları büyük + mono; etiketler küçük + caps." },
    { issue: "Boşluk israfı", before: "Kanban kolonları geniş, boş kolonlar 70% boş.", after: "Daha dar kolonlar, 8px gap, kompakt kart anatomisi. Boş kolonlar empty-state ile dolar." },
    { issue: "Bilgi yoğunluğu düşük", before: "Kart 3 satır metin gösteriyor; ETA, sürücü, son ping yok.", after: "Kartta plaka · konteyner · tip · D/B · sürücü + tel · rota + progress · ETA · son ping. Aynı 220px yükseklikte 3× veri." },
    { issue: "Renk kodlaması karışık", before: "Turuncu acil + yolda + marka rengi olarak kullanılıyor.", after: "Yolda = mavi (info), Acil = kırmızı, Brand = turuncu (sadece CTA), Teslim = yeşil. Renk semantik." },
    { issue: "Tipografi tek boyut", before: "Sayılar ve etiketler aynı ağırlıkta.", after: "KPI'lar 28px mono · etiketler 10px caps. 6 düzeyli ölçek. Mono sadece identifier ve sayı için." },
    { issue: "Modal bunaltıcı", before: "15+ alan tek seferde.", after: "4 adımlı stepper · adım başı 3-4 alan · taslak otomatik kaydediliyor · ⌘+Enter ile sonraki." },
    { issue: "Tablo aksiyonları gizli", before: "İşlem ikonları belirsiz, tooltip yok.", after: "Sabit 3 ikon (Detay/Düzenle/Duraklat) · tooltip · klavye kısayolu satır seçildiğinde." },
    { issue: "Empty state yok", before: "'Boş' yazısı tek başına.", after: "İkon + başlık + 1 cümle açıklama + ilgili CTA (+ İş emri)." },
    { issue: "Acil bandı pasif", before: "Kapatılamıyor, tıklanamıyor.", after: "Bant tıklanabilir; içinde 'Sürücüyü Ara' + 'Detay' aksiyonları + kapat butonu." },
  ];

  return (
    <div style={{ padding: 32, background: "#0A0E1A", color: "#E8ECF5", fontFamily: "Inter, sans-serif" }}>
      <window.OpHeader
        eyebrow="06 — Önce / Sonra"
        title="9 büyük değişiklik"
        subtitle="Her satır: sorun · mevcut durum · yeniden tasarım gerekçesi"
      />
      <div style={{ marginTop: 20, background: "#0F1524", border: "1px solid #1E2740", borderRadius: 10, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "220px 1fr 1fr",
          padding: "12px 16px", background: "#0C1220",
          borderBottom: "1px solid #1E2740",
          font: "500 10px Inter", letterSpacing: 1.4, textTransform: "uppercase", color: "#6B7490",
        }}>
          <span>Sorun</span>
          <span>Önce</span>
          <span>Sonra</span>
        </div>
        {issues.map((it, i) => (
          <div key={it.issue} style={{
            display: "grid", gridTemplateColumns: "220px 1fr 1fr",
            padding: "14px 16px",
            borderTop: i ? "1px solid #1E2740" : "none",
            font: "400 12px Inter", lineHeight: 1.55,
          }}>
            <span style={{ font: "600 13px Inter", color: "#E8ECF5" }}>{it.issue}</span>
            <span style={{ color: "#A4ADC2", paddingRight: 16 }}>{it.before}</span>
            <span style={{ color: "#E8ECF5" }}>
              <span style={{ color: "#4ADE80", marginRight: 6 }}>→</span>{it.after}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

window.TableArtboard = TableArtboard;
window.ModalArtboard = ModalArtboard;
window.DrawerArtboard = DrawerArtboard;
window.CardVariantsArtboard = CardVariantsArtboard;
window.BeforeAfterArtboard = BeforeAfterArtboard;
