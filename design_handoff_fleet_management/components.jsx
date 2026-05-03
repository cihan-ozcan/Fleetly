/* Shared icons + small components for Fleetly */

// Heroicons-inspired stroked SVG icons
const Icon = ({ name, size = 18, ...rest }) => {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    map: <><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></>,
    truck: <><rect x="1" y="6" width="13" height="11" rx="1.5"/><polyline points="14 9 18 9 21 12 21 17 14 17"/><circle cx="6" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></>,
    list: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>,
    users: <><circle cx="9" cy="9" r="3.5"/><path d="M2 20c0-3.5 3.1-6.5 7-6.5s7 3 7 6.5"/><circle cx="17" cy="8" r="3"/><path d="M22 18c0-2.5-2-4.5-5-4.5"/></>,
    route: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h6a4 4 0 0 1 0 8H10a4 4 0 0 0 0 8h6"/></>,
    wrench: <><path d="M14.7 6.3a4 4 0 1 1 4 4l-9 9-3 1 1-3 7-11z"/></>,
    fuel: <><rect x="3" y="4" width="10" height="16" rx="1.5"/><path d="M13 9h2a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0 2-2V8l-3-3"/><line x1="6" y1="8" x2="10" y2="8"/></>,
    bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
    chart: <><line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="11" width="3" height="9"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    search: <><circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    chevron: <><polyline points="9 6 15 12 9 18"/></>,
    chevronDown: <><polyline points="6 9 12 15 18 9"/></>,
    chevronLeft: <><polyline points="15 18 9 12 15 6"/></>,
    arrowUp: <><line x1="12" y1="20" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/></>,
    arrowDown: <><line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/></>,
    arrowRight: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></>,
    play: <><polygon points="6 4 20 12 6 20 6 4"/></>,
    pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    filter: <><polygon points="3 4 21 4 14 13 14 20 10 20 10 13 3 4"/></>,
    close: <><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></>,
    more: <><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/></>,
    moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    menu: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    pin: <><path d="M12 22s7-7 7-13a7 7 0 1 0-14 0c0 6 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></>,
    speed: <><path d="M12 14l3-5"/><path d="M3 14a9 9 0 0 1 18 0"/><circle cx="12" cy="14" r="1"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="1.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></>,
    layers: <><polygon points="12 2 22 8 12 14 2 8 12 2"/><polyline points="2 14 12 20 22 14"/></>,
    package: <><polygon points="3 7 12 2 21 7 21 17 12 22 3 17 3 7"/><line x1="12" y1="22" x2="12" y2="12"/><polyline points="3 7 12 12 21 7"/></>,
    money: <><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></>,
    check: <><polyline points="5 12 10 17 19 7"/></>,
    refresh: <><polyline points="3 4 3 10 9 10"/><path d="M3.5 14a8 8 0 1 0 1-7.5L3 10"/></>,
    bolt: <><polygon points="13 2 3 14 11 14 11 22 21 10 13 10 13 2"/></>,
    star: <><polygon points="12 2 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9 12 2"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths[name] || null}
    </svg>
  );
};

// Logo mark — a stylized truck arrow
const LogoMark = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="2" y="3" width="28" height="26" rx="7" fill="#0F2440"/>
    <path d="M6 12 L6 22 L22 22 L26 19 L26 14 L22 12 Z" fill="#FF6B1F"/>
    <path d="M9 9 L18 9 L21 12 L17 12 Z" fill="#FF6B1F" opacity="0.7"/>
    <circle cx="10" cy="22" r="2.5" fill="#0F2440" stroke="#FF6B1F" strokeWidth="1.4"/>
    <circle cx="20" cy="22" r="2.5" fill="#0F2440" stroke="#FF6B1F" strokeWidth="1.4"/>
    <path d="M14 16 L20 16 M14 13 L18 13" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

// CountUp — animates from 0 to value on mount
const CountUp = ({ value, duration = 900, format = (v) => v.toLocaleString('tr-TR'), prefix = '', suffix = '' }) => {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tnum">{prefix}{format(v)}{suffix}</span>;
};

// Sparkline (small inline svg)
const Sparkline = ({ data, width = 100, height = 36, color = "var(--navy-400)", area = true }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  const line = pts.map(([x,y], i) => (i===0 ? `M${x},${y}` : `L${x},${y}`)).join(' ');
  const areaPath = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg className="kpi__spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {area && <path d={areaPath} className="spark-area"/>}
      <path d={line} className="spark-line" style={{stroke: color}}/>
    </svg>
  );
};

// Status dot
const StatusDot = ({ status }) => {
  const cfg = {
    moving:   { color: 'var(--success)',   label: 'Hareket' },
    idle:     { color: 'var(--warning)',   label: 'Rölanti' },
    stopped:  { color: 'var(--text-subtle)',label: 'Park' },
    maint:    { color: 'var(--accent-500)',label: 'Bakım' },
    alarm:    { color: 'var(--danger)',    label: 'Alarm' },
    delivered:{ color: 'var(--success)',   label: 'Teslim' },
    'in-transit':{ color: 'var(--navy-500)',label: 'Yolda' },
    loading:  { color: 'var(--warning)',   label: 'Yükleme' },
    scheduled:{ color: 'var(--text-subtle)',label: 'Planlı' },
    delayed:  { color: 'var(--danger)',    label: 'Gecikme' },
    active:   { color: 'var(--success)',   label: 'Aktif' },
    off:      { color: 'var(--text-subtle)',label: 'Çıkış' },
    leave:    { color: 'var(--warning)',   label: 'İzinli' },
    overdue:  { color: 'var(--danger)',    label: 'Gecikti' },
    'in-progress':{ color: 'var(--navy-500)', label: 'İşlemde' },
  }[status] || { color: 'var(--text-subtle)', label: status };
  return (
    <span className={`status status--${status}`} style={{color: cfg.color}}>
      <span className="dot" style={{background: cfg.color}}/>
      {cfg.label}
    </span>
  );
};

window.Icon = Icon;
window.LogoMark = LogoMark;
window.CountUp = CountUp;
window.Sparkline = Sparkline;
window.StatusDot = StatusDot;
