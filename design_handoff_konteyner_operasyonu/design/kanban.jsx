/* Kanban board (full screen redesign) */

const KanbanBoard = () => {
  const cols = [
    {
      key: "bekliyor", title: "Bekliyor", count: 2,
      hint: "Sürücü atanmamış",
      cards: [
        { plate: "—", containerNo: "MSCU7741209", type: "20 DC", customer: "Çelikler Demir", driver: "Sürücü atanmamış", status: "bekliyor", urgency: "normal", loaded: false, origin: "Marport · Ambarlı", destination: "İkitelli OSB" },
        { plate: "—", containerNo: "HLBU3981430", type: "40 HC", customer: "Mega Plastik", driver: "Sürücü atanmamış", status: "bekliyor", urgency: "normal", loaded: false, origin: "Kumport", destination: "Tuzla Org." },
      ],
    },
    {
      key: "yolda", title: "Yolda", count: 3,
      hint: "Aktif sevkiyat",
      cards: [
        { plate: "34JC0608", containerNo: "21313", type: "40 DC", customer: "Test A.Ş", driver: "Cihan Özcan", driverPhone: "+90 538 459 41 38", status: "yolda", urgency: "urgent", loaded: false, eta: "02:54 (gecikti)", duration: "12s 32dk", lastPing: "26 dk önce", origin: "Kumport · Ambarlı", destination: "Mega Metal · Çatalca", progress: 0.62 },
        { plate: "34DU8419", containerNo: "SEKU1484480", type: "40 DC", customer: "Arçelik Çayırova", driver: "Hasan Yılmaz", driverPhone: "+90 532 118 22 90", status: "yolda", urgency: "delayed", loaded: true, eta: "16:42", duration: "3s 18dk", lastPing: "4 dk önce", origin: "Asyaport · Tekirdağ", destination: "Çayırova Fab.", progress: 0.45, delayMin: 18 },
        { plate: "34KAL204", containerNo: "ABCU1234567", type: "20 DC", customer: "Sütaş Karacabey", driver: "Murat Demir", driverPhone: "+90 545 220 11 04", status: "yolda", urgency: "normal", loaded: true, eta: "18:10", duration: "2s 04dk", lastPing: "1 dk önce", origin: "Borusan · Gemlik", destination: "Karacabey", progress: 0.28 },
      ],
    },
    {
      key: "fabrikada", title: "Fabrikada", count: 1,
      hint: "Boşaltma · belge",
      cards: [
        { plate: "34ENA024", containerNo: "TGHU8821145", type: "40 HC", customer: "Test A.Ş", driver: "Erkan Aydın", driverPhone: "+90 533 776 89 12", status: "fabrikada", urgency: "normal", loaded: true, eta: "Beklemede", duration: "0s 42dk", lastPing: "12 dk önce", origin: "Kumport", destination: "Mega Metal · Çatalca", progress: 1.0 },
      ],
    },
    {
      key: "teslim", title: "Teslim", count: 4,
      hint: "Bugün tamamlandı",
      cards: [
        { plate: "34JC0608", containerNo: "234234", type: "40 DC", customer: "Test A.Ş", driver: "Cihan Özcan", status: "teslim", urgency: "normal", loaded: true, km: 44, kmLeft: 22, pod: true },
        { plate: "34JC0608", containerNo: "12313", type: "20 DC", customer: "Test A.Ş", driver: "Cihan Özcan", status: "teslim", urgency: "normal", loaded: true, km: 66, kmLeft: 22, pod: true },
        { plate: "15PS475", containerNo: "SDF889102", type: "40 DC", customer: "Erkunt Tarım", driver: "Bülent Kaya", status: "teslim", urgency: "normal", loaded: false, km: 128, kmLeft: 0, pod: true },
        { plate: "34KNG497", containerNo: "FCIU2210447", type: "20 DC", customer: "Eti Maden", driver: "İlker Ç.", status: "teslim", urgency: "normal", loaded: true, km: 87, kmLeft: 14, pod: false },
      ],
    },
  ];

  return (
    <div style={{ background: "#0A0E1A", color: "#E8ECF5", fontFamily: "Inter, sans-serif", display: "grid", gridTemplateRows: "auto auto auto 1fr" }}>
      {/* Top app bar */}
      <AppBar />
      {/* KPI bar */}
      <window.KPIBar />
      {/* View tabs + filters */}
      <ViewBar active="canli" />
      {/* Kanban columns */}
      <div style={{
        padding: "16px 20px 24px 20px",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12,
        minHeight: 760, alignContent: "start",
      }}>
        {cols.map(col => (
          <KanbanColumn key={col.key} col={col} />
        ))}
      </div>
    </div>
  );
};

const AppBar = () => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12,
    padding: "10px 20px",
    background: "#0A0E1A",
    borderBottom: "1px solid #1E2740",
  }}>
    <button style={{ ...window.opBtn("ghost"), height: 30 }}>
      <span style={{ opacity: 0.6 }}>‹</span> Ana Sayfa
    </button>
    <div style={{ width: 1, height: 18, background: "#1E2740" }} />
    <div style={{
      width: 26, height: 26, borderRadius: 6,
      background: "linear-gradient(135deg, #FF7A45, #E5562A)",
      display: "grid", placeItems: "center",
      font: "700 13px Inter", color: "#0A0E1A",
    }}>K</div>
    <div>
      <div style={{ font: "600 14px Inter", color: "#E8ECF5", lineHeight: 1.1 }}>Konteyner Operasyonu</div>
      <div style={{ font: "400 11px Inter", color: "#6B7490" }}>İş emri yönetimi & saha takibi</div>
    </div>
    <span style={{ flex: 1 }} />
    {/* Live indicator */}
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 4,
      background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.18)",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: "#4ADE80", boxShadow: "0 0 0 3px rgba(74,222,128,0.18)" }} />
      <span style={{ font: "500 11px JetBrains Mono, monospace", color: "#4ADE80" }}>CANLI</span>
      <span style={{ font: "400 11px JetBrains Mono, monospace", color: "#A4ADC2" }}>· 14:32:08</span>
    </div>
    {/* Search */}
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "0 10px", height: 30,
      background: "#0F1524", border: "1px solid #1E2740", borderRadius: 6,
      width: 280,
    }}>
      <span style={{ font: "400 12px Inter", color: "#6B7490" }}>⌕</span>
      <span style={{ font: "400 12px Inter", color: "#6B7490", flex: 1 }}>Konteyner, plaka, müşteri…</span>
      <kbd style={{
        font: "500 10px JetBrains Mono, monospace", color: "#6B7490",
        padding: "1px 5px", border: "1px solid #1E2740", borderRadius: 3,
      }}>⌘K</kbd>
    </div>
    <button style={{ ...window.opBtn("primary"), height: 30 }}>
      <span style={{ font: "600 14px Inter" }}>+</span> İş Emri Oluştur
    </button>
  </div>
);

const ViewBar = ({ active }) => {
  const tabs = [
    { key: "emirler", label: "İş Emirleri", count: 5 },
    { key: "canli",   label: "Canlı Takip", count: null, live: true },
    { key: "harita",  label: "Filo Haritası" },
    { key: "arsiv",   label: "Arşiv" },
  ];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "0 20px",
      borderBottom: "1px solid #1E2740",
      background: "#0A0E1A",
    }}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <div key={t.key} style={{
            position: "relative",
            padding: "10px 14px",
            font: `${isActive ? 600 : 500} 12px Inter`,
            color: isActive ? "#E8ECF5" : "#A4ADC2",
            cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {t.live && <span style={{ width: 6, height: 6, borderRadius: 6, background: "#F26B5E", boxShadow: "0 0 0 3px rgba(242,107,94,0.18)" }} />}
            {t.label}
            {t.count != null && (
              <span style={{
                font: "500 10px JetBrains Mono, monospace",
                color: isActive ? "#FF7A45" : "#6B7490",
                background: isActive ? "rgba(255,122,69,0.10)" : "rgba(255,255,255,0.04)",
                padding: "1px 5px", borderRadius: 3,
              }}>{t.count}</span>
            )}
            {isActive && (
              <span style={{
                position: "absolute", left: 12, right: 12, bottom: -1, height: 2,
                background: "#FF7A45", borderRadius: 2,
              }} />
            )}
          </div>
        );
      })}
      <span style={{ flex: 1 }} />
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        font: "400 11px Inter", color: "#6B7490",
      }}>
        <span>Otomatik yenileme</span>
        <span style={{ font: "500 11px JetBrains Mono, monospace", color: "#4ADE80" }}>30s</span>
      </div>
      <div style={{ width: 1, height: 16, background: "#1E2740", margin: "0 8px" }} />
      <button style={{ ...window.opBtn("ghost"), height: 26, padding: "0 10px" }}>Filtrele</button>
      <button style={{ ...window.opBtn("ghost"), height: 26, padding: "0 10px" }}>Bugün ▾</button>
    </div>
  );
};

const KanbanColumn = ({ col }) => {
  const s = window.STATUS[col.key];
  const isEmpty = col.cards.length === 0;
  return (
    <div style={{
      background: "#0C1220",
      border: "1px solid #1E2740", borderRadius: 10,
      display: "flex", flexDirection: "column",
      minHeight: 720,
    }}>
      {/* Column header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 14px",
        borderBottom: "1px solid #1E2740",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 8, background: s.color, boxShadow: `0 0 0 3px ${s.glow}` }} />
        <span style={{ font: "600 12px Inter", color: "#E8ECF5", letterSpacing: 0.3, textTransform: "uppercase" }}>{col.title}</span>
        <span style={{
          font: "500 11px JetBrains Mono, monospace",
          color: s.color, background: s.glow,
          padding: "1px 6px", borderRadius: 4,
        }}>{col.count}</span>
        <span style={{ flex: 1 }} />
        <span style={{ font: "400 10px Inter", color: "#6B7490" }}>{col.hint}</span>
        <button style={window.opIconBtn()} aria-label="Daha fazla">⋯</button>
      </div>
      {/* Cards */}
      <div style={{
        padding: 10, display: "grid", gap: 8,
        flex: 1,
      }}>
        {col.cards.map((c, i) => (
          <window.ContainerCard key={i} {...c} />
        ))}
        {/* Empty state */}
        {isEmpty && (
          <div style={{
            border: "1px dashed #1E2740", borderRadius: 8,
            padding: "32px 16px", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            margin: "auto 0",
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              display: "grid", placeItems: "center",
              font: "400 16px Inter", color: "#4A5269",
            }}>{col.key === "bekliyor" ? "✎" : col.key === "fabrikada" ? "⌂" : "✓"}</div>
            <div style={{ font: "500 12px Inter", color: "#A4ADC2" }}>
              {col.key === "bekliyor" && "Bekleyen iş yok"}
              {col.key === "fabrikada" && "Fabrikada konteyner yok"}
              {col.key === "teslim" && "Bugün teslim yok"}
            </div>
            <div style={{ font: "400 11px Inter", color: "#6B7490", maxWidth: 200, lineHeight: 1.5 }}>
              {col.key === "bekliyor" && "Yeni iş emri oluştur ya da rezervden çek."}
              {col.key === "fabrikada" && "Konteyner fabrika girişi yapıldığında burada görünür."}
              {col.key === "teslim" && "Tamamlanan teslimler bu sütunda toplanır."}
            </div>
            {col.key === "bekliyor" && (
              <button style={{ ...window.opBtn("ghost"), marginTop: 4 }}>+ İş emri</button>
            )}
          </div>
        )}
        {/* "Add" affordance for non-empty columns */}
        {!isEmpty && col.key === "bekliyor" && (
          <button style={{
            border: "1px dashed #1E2740", borderRadius: 8,
            padding: "10px", background: "transparent", cursor: "pointer",
            font: "500 12px Inter", color: "#6B7490",
          }}>+ İş emri ekle</button>
        )}
      </div>
    </div>
  );
};

window.KanbanBoard = KanbanBoard;
window.AppBar = AppBar;
window.ViewBar = ViewBar;
