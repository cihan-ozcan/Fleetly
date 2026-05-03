/* Dashboard — Manager command center */

const Dashboard = ({ onNavigate, onSelectVehicle }) => {
  const M = window.MOCK;
  const totalVehicles = M.vehicles.length;
  const moving = M.vehicles.filter(v => v.status === 'moving').length;
  const idle = M.vehicles.filter(v => v.status === 'idle').length;
  const stopped = M.vehicles.filter(v => v.status === 'stopped').length;
  const maint = M.vehicles.filter(v => v.status === 'maint').length;
  const alarm = M.vehicles.filter(v => v.status === 'alarm').length;

  const todayTrips = M.trips.length;
  const delivered = M.trips.filter(t => t.status === 'delivered').length;
  const inTransit = M.trips.filter(t => t.status === 'in-transit').length;
  const delayed = M.trips.filter(t => t.status === 'delayed').length;

  const activeAlerts = M.alerts.length;

  // Aggregated numbers
  const todayKm = 28453;
  const monthKm = 487120;
  const todayFuel = M.hours.reduce((s, h) => s + h.fuel, 0);
  const monthRevenue = M.days30.reduce((s, d) => s + d.revenue, 0);
  const monthCost = M.days30.reduce((s, d) => s + d.cost, 0);
  const profit = monthRevenue - monthCost;
  const margin = (profit / monthRevenue * 100).toFixed(1);

  const sparkRev = M.days30.map(d => d.revenue);
  const sparkCost = M.days30.map(d => d.cost);
  const sparkFuel = M.days30.map(d => d.fuel);
  const sparkKm = M.days30.map(d => d.km);

  return (
    <div className="page slide-up">
      {/* CINEMATIC BANNER */}
      <div className="cine-banner" style={{ marginBottom: 22 }}>
        <div className="row--between" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="live-pill"><span className="dot dot--pulse" style={{ color: '#16A974', background:'#16A974' }}/>Canlı</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500 }}>3 Mayıs 2026 — Pazar · {new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'white', marginBottom: 6 }}>
              Günaydın, Erkan Bey 👋
            </div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, maxWidth: 560 }}>
              Filonun <b style={{ color: '#FF8C4A' }}>%{Math.round(moving/totalVehicles*100)}'i</b> aktif yolda.
              Bugün <b style={{ color: 'white' }}>{delivered} teslimat</b> tamamlandı, <b style={{ color: 'white' }}>{inTransit} sevkiyat</b> devam ediyor.
              {alarm > 0 && <> Filoda <b style={{ color: '#FF8C4A' }}>{alarm + activeAlerts} aktif uyarı</b> var.</>}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--outline" style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)', color: 'white' }} onClick={() => onNavigate('reports')}>
              <Icon name="download" size={14}/> Günlük Rapor
            </button>
            <button className="btn btn--accent" onClick={() => onNavigate('new')}>
              <Icon name="plus" size={14}/> Yeni Sefer
            </button>
          </div>
        </div>

        {/* status strip */}
        <div style={{ marginTop: 22, display: 'flex', gap: 0, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 18 }}>
          {[
            { label: 'Hareket', value: moving, color: '#16A974' },
            { label: 'Rölanti', value: idle, color: '#FFC53D' },
            { label: 'Park', value: stopped, color: '#7889A1' },
            { label: 'Bakımda', value: maint, color: '#FF6B1F' },
            { label: 'Alarm', value: alarm, color: '#FF5757' },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ flex: 1, minWidth: 0, paddingRight: 16, borderRight: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none', paddingLeft: i === 0 ? 0 : 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
                <span className="dot" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }}/>{s.label}
              </div>
              <div className="mono" style={{ fontSize: 28, fontWeight: 600, color: 'white', marginTop: 4, letterSpacing: '-0.02em' }}>
                <CountUp value={s.value}/><span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>/ {totalVehicles}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TOP KPI ROW */}
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <KPICard label="Bugün Tamamlanan" value={delivered} suffix=" sefer" delta="+12%" deltaUp icon="package" iconKind="success" spark={sparkKm.slice(-14)}/>
        <KPICard label="Toplam KM (Bugün)" value={todayKm} format={v => v.toLocaleString('tr-TR')} suffix=" km" delta="+4.8%" deltaUp icon="route" spark={sparkKm.slice(-14)}/>
        <KPICard label="Yakıt Tüketimi (Bugün)" value={Math.round(todayFuel/100)*10} suffix=" L" delta="-2.1%" deltaUp icon="fuel" iconKind="warning" spark={sparkFuel.slice(-14).map(v=>-v)}/>
        <KPICard label="Aylık Net Kâr" value={profit} format={v => '₺' + (v/1000000).toFixed(2) + 'M'} delta={`+%${margin}`} deltaUp icon="money" iconKind="accent" spark={sparkRev.slice(-14)}/>
      </div>

      {/* MAIN ROW: Map + Alerts */}
      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', marginBottom: 18 }}>
        {/* Mini map */}
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Canlı Konum Haritası</div>
              <div className="card__sub">{moving} araç hareket halinde · {idle} rölantide</div>
            </div>
            <div className="row">
              <span className="live-pill"><span className="dot dot--pulse" style={{ color:'var(--success)', background:'var(--success)' }}/>Canlı</span>
              <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('map')}>Tam ekran <Icon name="arrowRight" size={12}/></button>
            </div>
          </div>
          <div className="card__body card__body--flush" style={{ height: 380 }}>
            <MiniMap onSelectVehicle={onSelectVehicle}/>
          </div>
        </div>

        {/* Alerts */}
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Aktif Uyarılar</div>
              <div className="card__sub">{activeAlerts} uyarı bekleniyor</div>
            </div>
            <button className="btn btn--ghost btn--sm">Tümü</button>
          </div>
          <div className="card__body" style={{ padding: 8, maxHeight: 380, overflowY: 'auto' }}>
            {M.alerts.map(a => (
              <div key={a.id} className="notif">
                <div className="notif__icon" style={{
                  background: a.severity === 'danger' ? 'var(--danger-bg)' : a.severity === 'warning' ? 'var(--warning-bg)' : 'var(--navy-100)',
                  color: a.severity === 'danger' ? 'var(--danger)' : a.severity === 'warning' ? 'var(--warning)' : 'var(--navy-500)',
                  fontSize: 16
                }}>{a.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="notif__title">{a.title}</div>
                  <div className="notif__sub">{a.sub}</div>
                </div>
                <div className="notif__time">{a.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CHART ROW */}
      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', marginBottom: 18 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Son 30 Gün — Gelir, Maliyet, KM</div>
              <div className="card__sub">Aylık performans trendi</div>
            </div>
            <div className="row" style={{ gap: 14, fontSize: 12 }}>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background:'var(--navy-500)' }}/>Gelir</span>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background:'var(--accent-500)' }}/>Maliyet</span>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background:'var(--success)' }}/>KM</span>
            </div>
          </div>
          <div className="card__body">
            <BigChart data={M.days30}/>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Yaklaşan Bakımlar</div>
              <div className="card__sub">Önümüzdeki 30 gün</div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('maintenance')}>Tümü <Icon name="arrowRight" size={12}/></button>
          </div>
          <div className="card__body card__body--flush">
            {M.maintenance.slice(0,6).map(m => (
              <div key={m.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 8, background: m.daysLeft < 0 ? 'var(--danger-bg)' : m.daysLeft < 7 ? 'var(--warning-bg)' : 'var(--navy-50)', color: m.daysLeft < 0 ? 'var(--danger)' : m.daysLeft < 7 ? 'var(--warning)' : 'var(--navy-500)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="wrench" size={18}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="fw-6" style={{ fontSize: 13.5 }}>{m.plate} <span className="muted" style={{ fontWeight: 400 }}>· {m.type}</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{m.dueDate}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono fw-6" style={{ fontSize: 13, color: m.daysLeft < 0 ? 'var(--danger)' : m.daysLeft < 7 ? 'var(--warning)' : 'var(--text)' }}>
                    {m.daysLeft < 0 ? `${Math.abs(m.daysLeft)} gün gecikti` : `${m.daysLeft} gün`}
                  </div>
                  <div className="mono muted" style={{ fontSize: 11 }}>~₺{m.estCost.toLocaleString('tr-TR')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* BOTTOM ROW: Top drivers + recent trips */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.6fr' }}>
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">En İyi Sürücüler</div>
              <div className="card__sub">Bu ay performans skoru</div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('drivers')}>Tümü <Icon name="arrowRight" size={12}/></button>
          </div>
          <div className="card__body card__body--flush">
            {[...M.drivers].sort((a,b) => b.score - a.score).slice(0,5).map((d, i) => (
              <div key={d.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="mono fw-7" style={{ width: 22, color: 'var(--text-subtle)', fontSize: 13 }}>#{i+1}</div>
                <div className="avatar">{d.initials}</div>
                <div style={{ flex: 1 }}>
                  <div className="fw-6" style={{ fontSize: 13.5 }}>{d.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{d.tripsThisMonth} sefer · {d.kmThisMonth.toLocaleString('tr-TR')} km</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono fw-6" style={{ fontSize: 16, color: d.scoreClass === 'success' ? 'var(--success)' : d.scoreClass === 'warning' ? 'var(--warning)' : 'var(--text)' }}>
                    {d.score}
                  </div>
                  <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>SKOR</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Son Seferler</div>
              <div className="card__sub">Aktif ve son tamamlanan</div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('trips')}>Tümü <Icon name="arrowRight" size={12}/></button>
          </div>
          <div className="card__body card__body--flush">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Sefer</th><th>Plaka</th><th>Güzergah</th><th>İlerleme</th><th>Durum</th></tr></thead>
                <tbody>
                  {M.trips.slice(0,6).map(t => (
                    <tr key={t.id}>
                      <td className="tbl__num fw-6">{t.id}</td>
                      <td className="tbl__num">{t.vehiclePlate}</td>
                      <td><span className="muted">{t.from}</span> <Icon name="arrowRight" size={10}/> <b>{t.to}</b></td>
                      <td style={{ width: 140 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <div className="bar" style={{ flex: 1 }}>
                            <div className={`bar__fill ${t.status === 'delayed' ? 'bar__fill--danger' : t.status === 'delivered' ? 'bar__fill--success' : ''}`} style={{ width: t.progress + '%' }}/>
                          </div>
                          <span className="mono muted" style={{ fontSize: 11, width: 32 }}>{t.progress}%</span>
                        </div>
                      </td>
                      <td><StatusDot status={t.status}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const KPICard = ({ label, value, format = v => v.toLocaleString('tr-TR'), prefix='', suffix='', delta, deltaUp, icon, iconKind, spark }) => (
  <div className="kpi">
    <div className="kpi__head">
      <div className="kpi__label">{label}</div>
      <div className={`kpi__icon ${iconKind ? 'kpi__icon--' + iconKind : ''}`}>
        <Icon name={icon} size={18}/>
      </div>
    </div>
    <div className="kpi__value">
      <CountUp value={value} format={format} prefix={prefix} suffix={suffix}/>
    </div>
    {delta && (
      <div className={`kpi__delta ${deltaUp ? 'kpi__delta--up' : 'kpi__delta--down'}`}>
        <Icon name={deltaUp ? 'arrowUp' : 'arrowDown'} size={12}/> {delta}
        <span className="muted" style={{ fontWeight: 400, marginLeft: 4 }}>geçen aya göre</span>
      </div>
    )}
    {spark && <Sparkline data={spark}/>}
  </div>
);

window.Dashboard = Dashboard;
window.KPICard = KPICard;
