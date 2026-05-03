/* MiniMap + Map page — stylized fleet command center map */

const COMMAND_MAP_BG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
  <defs>
    <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(120,150,200,0.10)" stroke-width="1"/>
    </pattern>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="rgba(44,90,158,0.25)"/>
      <stop offset="100%" stop-color="rgba(44,90,158,0)"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="600" fill="#0A1A30"/>
  <rect width="1000" height="600" fill="url(#glow)"/>
  <rect width="1000" height="600" fill="url(#g)"/>
  <!-- stylized Turkey-like land mass -->
  <path d="M 80 280 Q 100 200 200 180 Q 300 160 420 200 Q 540 220 640 200 Q 760 180 880 220 Q 940 240 920 320 Q 880 380 760 400 Q 640 420 500 400 Q 360 380 220 400 Q 120 410 80 360 Z"
    fill="rgba(40,80,140,0.35)" stroke="rgba(120,170,230,0.4)" stroke-width="1.2"/>
  <!-- routes -->
  <path d="M 220 320 Q 380 240 580 280 Q 720 310 820 260" stroke="rgba(255,107,31,0.55)" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/>
  <path d="M 180 360 Q 320 380 480 340 Q 620 310 780 340" stroke="rgba(74,127,196,0.5)" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/>
  <path d="M 280 250 Q 440 270 560 240 Q 680 220 760 280" stroke="rgba(74,127,196,0.4)" stroke-width="1" fill="none" stroke-dasharray="4 4"/>
  <!-- city markers -->
  <g fill="rgba(160,200,240,0.6)" font-family="ui-monospace,monospace" font-size="10">
    <circle cx="220" cy="320" r="2.5"/><text x="228" y="324">İSTANBUL</text>
    <circle cx="420" cy="340" r="2.5"/><text x="428" y="344">ANKARA</text>
    <circle cx="280" cy="380" r="2.5"/><text x="288" y="384">İZMİR</text>
    <circle cx="540" cy="370" r="2.5"/><text x="548" y="374">KONYA</text>
    <circle cx="620" cy="380" r="2.5"/><text x="628" y="384">ADANA</text>
    <circle cx="780" cy="320" r="2.5"/><text x="788" y="324">GAZİANTEP</text>
    <circle cx="350" cy="290" r="2.5"/><text x="358" y="294">BURSA</text>
  </g>
</svg>
`)}`;

const LIGHT_MAP_BG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
  <defs>
    <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(60,100,160,0.10)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1000" height="600" fill="#DCE6F2"/>
  <rect width="1000" height="600" fill="url(#g)"/>
  <path d="M 80 280 Q 100 200 200 180 Q 300 160 420 200 Q 540 220 640 200 Q 760 180 880 220 Q 940 240 920 320 Q 880 380 760 400 Q 640 420 500 400 Q 360 380 220 400 Q 120 410 80 360 Z"
    fill="rgba(180,205,235,0.7)" stroke="rgba(80,120,180,0.4)" stroke-width="1.2"/>
  <path d="M 220 320 Q 380 240 580 280 Q 720 310 820 260" stroke="rgba(255,107,31,0.55)" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/>
  <path d="M 180 360 Q 320 380 480 340 Q 620 310 780 340" stroke="rgba(44,90,158,0.5)" stroke-width="1.5" fill="none" stroke-dasharray="4 4"/>
  <g fill="rgba(60,100,160,0.7)" font-family="ui-monospace,monospace" font-size="10">
    <circle cx="220" cy="320" r="2.5"/><text x="228" y="324">İSTANBUL</text>
    <circle cx="420" cy="340" r="2.5"/><text x="428" y="344">ANKARA</text>
    <circle cx="280" cy="380" r="2.5"/><text x="288" y="384">İZMİR</text>
    <circle cx="540" cy="370" r="2.5"/><text x="548" y="374">KONYA</text>
    <circle cx="620" cy="380" r="2.5"/><text x="628" y="384">ADANA</text>
    <circle cx="780" cy="320" r="2.5"/><text x="788" y="324">GAZİANTEP</text>
    <circle cx="350" cy="290" r="2.5"/><text x="358" y="294">BURSA</text>
  </g>
</svg>
`)}`;

const VehiclePin = ({ v, onClick, large = false }) => {
  const colors = {
    moving: '#16A974',
    idle: '#FFC53D',
    stopped: '#7889A1',
    maint: '#FF6B1F',
    alarm: '#FF5757',
  };
  const color = colors[v.status] || '#7889A1';
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        left: `${v.x * 100}%`,
        top: `${v.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        cursor: 'pointer',
        zIndex: v.status === 'alarm' ? 10 : 1,
      }}
      title={`${v.plate} — ${v.driver}`}
    >
      {(v.status === 'moving' || v.status === 'alarm') && (
        <div style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          background: color, opacity: 0.4,
          animation: 'pulse 2.4s cubic-bezier(.16,1,.3,1) infinite',
        }}/>
      )}
      <div style={{
        position: 'relative',
        width: large ? 18 : 12, height: large ? 18 : 12,
        borderRadius: '50%',
        background: color,
        border: '2px solid rgba(255,255,255,0.9)',
        boxShadow: `0 0 12px ${color}, 0 1px 3px rgba(0,0,0,0.3)`,
      }}/>
    </div>
  );
};

const MiniMap = ({ onSelectVehicle }) => {
  const M = window.MOCK;
  return (
    <div className="map-stage" style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `var(--map-bg, url("${COMMAND_MAP_BG}"))`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }} className="map-bg-image"/>
      {M.vehicles.slice(0, 36).map(v => (
        <VehiclePin key={v.id} v={v} onClick={() => onSelectVehicle && onSelectVehicle(v)}/>
      ))}
      {/* legend */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'rgba(11,26,47,0.85)', backdropFilter: 'blur(8px)',
        padding: '10px 14px', borderRadius: 10,
        display: 'flex', gap: 14, fontSize: 11, color: '#C8D3E2',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {[
          { c: '#16A974', l: 'Hareket' },
          { c: '#FFC53D', l: 'Rölanti' },
          { c: '#FF6B1F', l: 'Bakım' },
          { c: '#FF5757', l: 'Alarm' },
        ].map(x => (
          <span key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: x.c, boxShadow: `0 0 6px ${x.c}` }}/>{x.l}
          </span>
        ))}
      </div>
      {/* live counter */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(11,26,47,0.85)', backdropFilter: 'blur(8px)',
        padding: '6px 12px', borderRadius: 999,
        fontSize: 11, color: '#16A974', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 6,
        border: '1px solid rgba(22,169,116,0.3)',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A974', boxShadow: '0 0 8px #16A974' }}/>
        Canlı · {M.vehicles.filter(v => v.status === 'moving').length} hareket
      </div>
    </div>
  );
};

// Full map page
const MapPage = ({ onSelectVehicle }) => {
  const M = window.MOCK;
  const [filter, setFilter] = React.useState('all');
  const filtered = filter === 'all' ? M.vehicles : M.vehicles.filter(v => v.status === filter);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: '100%' }}>
      {/* Side panel */}
      <div style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-elev)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <div className="row--between" style={{ marginBottom: 10 }}>
            <div className="fw-7" style={{ fontSize: 15 }}>Filo Listesi</div>
            <span className="chip chip--info">{filtered.length}</span>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {[
              { k: 'all', l: 'Tümü' },
              { k: 'moving', l: 'Hareket' },
              { k: 'idle', l: 'Rölanti' },
              { k: 'maint', l: 'Bakım' },
              { k: 'alarm', l: 'Alarm' },
            ].map(f => (
              <button key={f.k} onClick={() => setFilter(f.k)}
                className="btn btn--sm"
                style={{
                  background: filter === f.k ? 'var(--navy-500)' : 'var(--bg-sunk)',
                  color: filter === f.k ? 'white' : 'var(--text-muted)',
                }}>{f.l}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(v => (
            <div key={v.id} onClick={() => onSelectVehicle(v)} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 6, height: 36, borderRadius: 3, background: ({moving:'#16A974',idle:'#FFC53D',stopped:'#7889A1',maint:'#FF6B1F',alarm:'#FF5757'})[v.status] }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fw-6 mono" style={{ fontSize: 13 }}>{v.plate}</div>
                <div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.driver} · {v.location}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono fw-6" style={{ fontSize: 13 }}>{v.speed} <span className="muted" style={{ fontSize: 10 }}>km/h</span></div>
                <div className="muted" style={{ fontSize: 11 }}>{v.lastUpdate}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="map-stage" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `var(--map-bg, url("${COMMAND_MAP_BG}"))`, backgroundSize: 'cover', backgroundPosition: 'center' }} className="map-bg-image"/>
        {filtered.map(v => <VehiclePin key={v.id} v={v} onClick={() => onSelectVehicle(v)} large/>)}
        <div style={{ position:'absolute', top:16, left:16, background:'rgba(11,26,47,0.85)', backdropFilter:'blur(8px)', padding:'10px 14px', borderRadius:10, color:'#C8D3E2', fontSize:11, border:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize:10, color:'#7889A1', textTransform:'uppercase', letterSpacing:'.06em', fontWeight:600, marginBottom:4 }}>Aktif Görünüm</div>
          <div className="fw-6" style={{ color:'white' }}>{filter === 'all' ? 'Tüm Filo' : filter}</div>
          <div style={{ color:'#7889A1' }}>{filtered.length} araç</div>
        </div>
      </div>
    </div>
  );
};

// Theme-aware map background
const styleEl = document.createElement('style');
styleEl.textContent = `
  :root { --map-bg: url("${COMMAND_MAP_BG}"); }
  [data-theme="dark"] { --map-bg: url("${COMMAND_MAP_BG}"); }
  :root:not([data-theme="dark"]) { --map-bg: url("${LIGHT_MAP_BG}"); }
`;
document.head.appendChild(styleEl);

window.MiniMap = MiniMap;
window.MapPage = MapPage;
window.VehiclePin = VehiclePin;
