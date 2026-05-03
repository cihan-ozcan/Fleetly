/* BigChart — multi-line area chart for dashboard */

const BigChart = ({ data }) => {
  const W = 760, H = 240, P = { l: 40, r: 16, t: 10, b: 28 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const revs = data.map(d => d.revenue);
  const costs = data.map(d => d.cost);
  const kms = data.map(d => d.km);
  const max = Math.max(...revs);
  const x = (i) => P.l + (i / (data.length - 1)) * iw;
  const y = (v) => P.t + ih - (v / max) * ih;
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const area = (arr) => `${line(arr)} L${x(arr.length-1)},${P.t+ih} L${x(0)},${P.t+ih} Z`;
  const kmMax = Math.max(...kms);
  const kmY = (v) => P.t + ih - (v / kmMax) * ih * 0.8;
  const kmLine = kms.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${kmY(v)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="gRev" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2C5A9E" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="#2C5A9E" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="gCost" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FF6B1F" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#FF6B1F" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const yy = P.t + ih * t;
        return (
          <g key={i}>
            <line x1={P.l} x2={W-P.r} y1={yy} y2={yy} stroke="var(--border)" strokeDasharray="2 4"/>
            <text x={P.l - 6} y={yy + 4} fontSize="10" fill="var(--text-subtle)" textAnchor="end" fontFamily="ui-monospace, monospace">
              {((1-t) * max / 1000000).toFixed(1)}M
            </text>
          </g>
        );
      })}
      {/* area: rev */}
      <path d={area(revs)} fill="url(#gRev)"/>
      <path d={area(costs)} fill="url(#gCost)"/>
      {/* lines */}
      <path d={line(revs)} stroke="#2C5A9E" strokeWidth="2" fill="none"/>
      <path d={line(costs)} stroke="#FF6B1F" strokeWidth="2" fill="none"/>
      <path d={kmLine} stroke="#16A974" strokeWidth="1.5" fill="none" strokeDasharray="3 3"/>
      {/* x labels */}
      {data.filter((_, i) => i % 5 === 0).map((d, j) => (
        <text key={j} x={x(j*5)} y={H - 8} fontSize="10" fill="var(--text-subtle)" textAnchor="middle" fontFamily="ui-monospace,monospace">
          {d.d.toString().padStart(2,'0')}
        </text>
      ))}
    </svg>
  );
};

window.BigChart = BigChart;
