/* Vehicles list + detail drawer, Drivers list + detail, Trips */

const VehiclesPage = ({ onSelectVehicle }) => {
  const M = window.MOCK;
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState('plate');
  const types = ['all', 'Tır', 'Kamyon', 'Kamyonet', 'Konteyner', 'Otomobil'];

  const filtered = M.vehicles.filter(v => {
    if (filter !== 'all' && v.type !== filter) return false;
    if (search && !`${v.plate} ${v.driver} ${v.brand}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="truck" size={22}/>Araç Filosu</div>
          <div className="page-header__sub">{M.vehicles.length} araç · {M.vehicles.filter(v=>v.status==='moving').length} hareket halinde</div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--outline"><Icon name="download" size={14}/>Dışa aktar</button>
          <button className="btn btn--accent"><Icon name="plus" size={14}/>Yeni Araç</button>
        </div>
      </div>

      {/* filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="header__search" style={{ maxWidth: 280, flex: 1, margin: 0 }}>
            <Icon name="search"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Plaka, sürücü, marka…"/>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {types.map(t => (
              <button key={t} onClick={() => setFilter(t)}
                className="btn btn--sm"
                style={{ background: filter === t ? 'var(--navy-500)' : 'var(--bg-sunk)', color: filter === t ? 'white' : 'var(--text-muted)' }}>
                {t === 'all' ? 'Tümü' : t}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto' }} className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{filtered.length} sonuç</div>
        </div>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Plaka</th><th>Tip / Marka</th><th>Sürücü</th><th>Durum</th>
              <th>Hız</th><th>Konum</th><th>Yakıt</th><th>Km</th><th>Sonraki Bakım</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id} onClick={() => onSelectVehicle(v)} style={{ cursor: 'pointer' }}>
                  <td className="tbl__num tbl__primary">{v.plate}</td>
                  <td>
                    <div>{v.brand}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{v.type} · {v.year}</div>
                  </td>
                  <td>{v.driver}</td>
                  <td><StatusDot status={v.status}/></td>
                  <td className="tbl__num">{v.status === 'moving' ? `${v.speed} km/h` : '—'}</td>
                  <td>{v.location} <Icon name="arrowRight" size={10}/> <span className="muted">{v.destination}</span></td>
                  <td style={{ width: 90 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <div className="bar" style={{ flex: 1 }}>
                        <div className={`bar__fill ${v.fuel < 25 ? 'bar__fill--danger' : v.fuel < 50 ? 'bar__fill--warning' : 'bar__fill--success'}`} style={{ width: v.fuel + '%' }}/>
                      </div>
                      <span className="mono" style={{ fontSize: 11 }}>{v.fuel}%</span>
                    </div>
                  </td>
                  <td className="tbl__num">{v.odometer.toLocaleString('tr-TR')}</td>
                  <td className="tbl__num">
                    <span style={{ color: v.maintDueDays < 0 ? 'var(--danger)' : v.maintDueDays < 14 ? 'var(--warning)' : 'var(--text)' }}>
                      {v.maintDueDays < 0 ? `${Math.abs(v.maintDueDays)}g geç` : `${v.maintDueDays}g`}
                    </span>
                  </td>
                  <td><Icon name="chevron" size={14} style={{ color: 'var(--text-subtle)' }}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const VehicleDrawer = ({ vehicle, onClose }) => {
  if (!vehicle) return null;
  const v = vehicle;
  // generate mini telemetry
  const speedHistory = Array.from({length: 24}, (_,i) => 30 + Math.round(Math.sin(i/3)*20 + Math.random()*15));
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer__head">
          <div>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="mono fw-7" style={{ fontSize: 18 }}>{v.plate}</span>
              <StatusDot status={v.status}/>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{v.brand} · {v.year}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="close"/></button>
        </div>
        <div className="drawer__body">
          <div className="grid grid-2" style={{ marginBottom: 18 }}>
            <DetailStat label="Sürücü" value={v.driver}/>
            <DetailStat label="Tip" value={v.type}/>
            <DetailStat label="Anlık Konum" value={v.location}/>
            <DetailStat label="Hedef" value={v.destination}/>
            <DetailStat label="Hız" value={`${v.speed} km/h`} mono/>
            <DetailStat label="Yakıt" value={`%${v.fuel}`} mono/>
            <DetailStat label="Toplam KM" value={v.odometer.toLocaleString('tr-TR')} mono/>
            <DetailStat label="Son Güncelleme" value={v.lastUpdate}/>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__head"><div className="card__title">Son 24 Saat — Hız Profili</div></div>
            <div className="card__body">
              <svg viewBox="0 0 400 80" width="100%" height="80">
                <defs>
                  <linearGradient id="gSpeed" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#2C5A9E" stopOpacity="0.4"/>
                    <stop offset="100%" stopColor="#2C5A9E" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                {(() => {
                  const max = Math.max(...speedHistory);
                  const pts = speedHistory.map((s, i) => [i * (400/(speedHistory.length-1)), 75 - (s/max)*65]);
                  const line = pts.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' ');
                  const area = `${line} L400,80 L0,80 Z`;
                  return <>
                    <path d={area} fill="url(#gSpeed)"/>
                    <path d={line} stroke="#2C5A9E" strokeWidth="1.8" fill="none"/>
                  </>;
                })()}
              </svg>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card__head"><div className="card__title">Bakım</div></div>
              <div className="card__body">
                <DetailStat label="Sonraki Bakım" value={v.maintDueDays < 0 ? `${Math.abs(v.maintDueDays)} gün gecikti` : `${v.maintDueDays} gün sonra`}
                  valueColor={v.maintDueDays < 0 ? 'var(--danger)' : v.maintDueDays < 14 ? 'var(--warning)' : 'var(--text)'}/>
                <DetailStat label="Bakım Mesafesi" value={`${v.nextMaintKm.toLocaleString('tr-TR')} km`} mono/>
              </div>
            </div>
            <div className="card">
              <div className="card__head"><div className="card__title">Belgeler</div></div>
              <div className="card__body">
                <DetailStat label="Sigorta Bitiş" value={`${v.insuranceDue < 0 ? 'GEÇTİ' : v.insuranceDue + ' gün'}`}
                  valueColor={v.insuranceDue < 0 ? 'var(--danger)' : v.insuranceDue < 30 ? 'var(--warning)' : 'var(--text)'}/>
                <DetailStat label="Muayene" value="Geçerli"/>
              </div>
            </div>
          </div>
        </div>
        <div className="drawer__foot">
          <button className="btn btn--outline"><Icon name="map" size={14}/>Haritada Göster</button>
          <button className="btn btn--outline"><Icon name="edit" size={14}/>Düzenle</button>
          <button className="btn btn--primary"><Icon name="file" size={14}/>Detay Sayfası</button>
        </div>
      </div>
    </>
  );
};

const DetailStat = ({ label, value, mono, valueColor }) => (
  <div style={{ marginBottom: 10 }}>
    <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{label}</div>
    <div className={mono ? 'mono fw-6' : 'fw-6'} style={{ fontSize: 14, color: valueColor || 'var(--text)', marginTop: 2 }}>{value}</div>
  </div>
);

/* DRIVERS */
const DriversPage = () => {
  const M = window.MOCK;
  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="users" size={22}/>Sürücüler</div>
          <div className="page-header__sub">{M.drivers.length} sürücü · {M.drivers.filter(d=>d.status==='active').length} aktif</div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--outline"><Icon name="download" size={14}/>Dışa aktar</button>
          <button className="btn btn--accent"><Icon name="plus" size={14}/>Yeni Sürücü</button>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        {[...M.drivers].sort((a,b)=>b.score-a.score).slice(0,3).map((d,i) => (
          <div key={d.id} className="card" style={{ overflow: 'visible', position: 'relative' }}>
            <div style={{ padding: 18, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <div className="avatar avatar--xl">{d.initials}</div>
                {i === 0 && <div style={{ position:'absolute', bottom:-4, right:-4, background:'#FFC53D', width:24, height:24, borderRadius:'50%', display:'grid', placeItems:'center', boxShadow:'var(--shadow-sm)' }}><Icon name="star" size={12} style={{color:'white'}}/></div>}
              </div>
              <div style={{ flex: 1 }}>
                <div className="row"><span className="muted mono fw-7" style={{fontSize:11}}>#{i+1}</span><span className="fw-6" style={{ fontSize: 15 }}>{d.name}</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{d.experience} yıl deneyim · {d.license}</div>
                <div className="row" style={{ marginTop: 8, gap: 16 }}>
                  <div><div className="mono fw-7" style={{ fontSize: 18, color: 'var(--success)' }}>{d.score}</div><div className="muted" style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.04em'}}>SKOR</div></div>
                  <div><div className="mono fw-7" style={{ fontSize: 18 }}>{d.tripsThisMonth}</div><div className="muted" style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.04em'}}>SEFER</div></div>
                  <div><div className="mono fw-7" style={{ fontSize: 18 }}>{(d.kmThisMonth/1000).toFixed(1)}K</div><div className="muted" style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.04em'}}>KM</div></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Sürücü</th><th>Telefon</th><th>Ehliyet</th><th>Aktif Araç</th>
              <th>Bu Ay Sefer</th><th>Bu Ay KM</th><th>Skor</th><th>Durum</th>
            </tr></thead>
            <tbody>
              {M.drivers.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }}>
                  <td>
                    <div className="row"><div className="avatar avatar--sm">{d.initials}</div><span className="fw-6">{d.name}</span></div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{d.phone}</td>
                  <td><span className="chip chip--info">{d.license}</span> <span className="muted" style={{fontSize:11}}>· {d.licenseExpiry}</span></td>
                  <td className="mono">{d.activeVehicle}</td>
                  <td className="tbl__num">{d.tripsThisMonth}</td>
                  <td className="tbl__num">{d.kmThisMonth.toLocaleString('tr-TR')}</td>
                  <td>
                    <div className="row">
                      <div className="bar" style={{ width: 60 }}>
                        <div className={`bar__fill bar__fill--${d.scoreClass}`} style={{ width: d.score + '%' }}/>
                      </div>
                      <span className="mono fw-6" style={{ fontSize: 13, color: `var(--${d.scoreClass === 'info' ? 'navy-500' : d.scoreClass})` }}>{d.score}</span>
                    </div>
                  </td>
                  <td><StatusDot status={d.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* TRIPS */
const TripsPage = () => {
  const M = window.MOCK;
  const [tab, setTab] = React.useState('all');
  const filtered = tab === 'all' ? M.trips : M.trips.filter(t => t.status === tab);
  const counts = {
    all: M.trips.length,
    'in-transit': M.trips.filter(t => t.status === 'in-transit').length,
    delivered: M.trips.filter(t => t.status === 'delivered').length,
    delayed: M.trips.filter(t => t.status === 'delayed').length,
    scheduled: M.trips.filter(t => t.status === 'scheduled').length,
  };
  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="route" size={22}/>Seferler & Sevkiyat</div>
          <div className="page-header__sub">Bugün {M.trips.length} sefer planlandı · ₺{M.trips.reduce((s,t)=>s+t.revenue,0).toLocaleString('tr-TR')} ciro</div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--outline"><Icon name="filter" size={14}/>Filtrele</button>
          <button className="btn btn--accent"><Icon name="plus" size={14}/>Yeni Sefer</button>
        </div>
      </div>

      <div className="tabs">
        {[
          { k:'all', l:'Tümü' },
          { k:'in-transit', l:'Yolda' },
          { k:'loading', l:'Yükleme' },
          { k:'scheduled', l:'Planlı' },
          { k:'delivered', l:'Tamamlandı' },
          { k:'delayed', l:'Gecikme' },
        ].map(t => (
          <button key={t.k} className={`tab ${tab===t.k?'active':''}`} onClick={() => setTab(t.k)}>
            {t.l} {counts[t.k] !== undefined && <span className="muted">· {counts[t.k]}</span>}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Sefer No</th><th>Plaka</th><th>Sürücü</th><th>Güzergah</th>
              <th>Yük</th><th>İlerleme</th><th>ETA</th><th>Ciro</th><th>Durum</th>
            </tr></thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }}>
                  <td className="tbl__num tbl__primary">{t.id}</td>
                  <td className="tbl__num">{t.vehiclePlate}</td>
                  <td>{t.driver}</td>
                  <td>
                    <span className="muted">{t.from}</span>
                    <Icon name="arrowRight" size={10} style={{ margin: '0 6px', verticalAlign: 'middle' }}/>
                    <b>{t.to}</b>
                  </td>
                  <td><div>{t.cargo}</div><div className="muted mono" style={{ fontSize: 11 }}>{t.tons} ton</div></td>
                  <td style={{ width: 160 }}>
                    <div className="row">
                      <div className="bar" style={{ flex: 1 }}>
                        <div className={`bar__fill ${t.status==='delayed'?'bar__fill--danger':t.status==='delivered'?'bar__fill--success':''}`} style={{ width: t.progress + '%' }}/>
                      </div>
                      <span className="mono" style={{ fontSize: 11, width: 32, color: 'var(--text-muted)' }}>{t.progress}%</span>
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{t.eta}</td>
                  <td className="mono fw-6">₺{t.revenue.toLocaleString('tr-TR')}</td>
                  <td><StatusDot status={t.status}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

window.VehiclesPage = VehiclesPage;
window.VehicleDrawer = VehicleDrawer;
window.DriversPage = DriversPage;
window.TripsPage = TripsPage;
