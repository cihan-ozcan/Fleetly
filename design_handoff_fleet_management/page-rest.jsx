/* Maintenance, Fuel & cost, Reports, New record form, Notifications */

const MaintenancePage = () => {
  const M = window.MOCK;
  const overdue = M.maintenance.filter(m => m.daysLeft < 0);
  const upcoming = M.maintenance.filter(m => m.daysLeft >= 0 && m.daysLeft < 14);
  const future = M.maintenance.filter(m => m.daysLeft >= 14);
  const totalCost = M.maintenance.reduce((s,m) => s + m.estCost, 0);

  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="wrench" size={22}/>Bakım Planlama</div>
          <div className="page-header__sub">{M.maintenance.length} planlanmış bakım · Tahmini maliyet ₺{totalCost.toLocaleString('tr-TR')}</div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--outline"><Icon name="calendar" size={14}/>Takvim</button>
          <button className="btn btn--accent"><Icon name="plus" size={14}/>Bakım Planla</button>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <KPICard label="Gecikti" value={overdue.length} icon="bolt" iconKind="danger" suffix=" bakım"/>
        <KPICard label="2 Hafta İçinde" value={upcoming.length} icon="calendar" iconKind="warning" suffix=" bakım"/>
        <KPICard label="Tahmini Maliyet" value={totalCost} format={v => '₺' + (v/1000).toFixed(0) + 'K'} icon="money" iconKind="accent"/>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        {[
          { title: 'Gecikti', items: overdue, color: 'var(--danger)' },
          { title: 'Yaklaşan (14g)', items: upcoming, color: 'var(--warning)' },
          { title: 'Planlanan', items: future, color: 'var(--navy-500)' },
        ].map(col => (
          <div key={col.title} className="card">
            <div className="card__head">
              <div className="row"><span className="dot" style={{background:col.color}}/><div className="card__title">{col.title}</div></div>
              <span className="chip">{col.items.length}</span>
            </div>
            <div className="card__body card__body--flush" style={{ minHeight: 200 }}>
              {col.items.length === 0 ? (
                <div className="muted" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>Kayıt yok</div>
              ) : col.items.map(m => (
                <div key={m.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div className="row--between">
                    <div className="mono fw-6" style={{ fontSize: 13 }}>{m.plate}</div>
                    <div className="mono" style={{ fontSize: 11, color: m.daysLeft < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {m.daysLeft < 0 ? `${Math.abs(m.daysLeft)}g geç` : `${m.daysLeft}g`}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{m.type}</div>
                  <div className="row--between" style={{ marginTop: 6 }}>
                    <span className="muted mono" style={{ fontSize: 11 }}>{m.dueDate}</span>
                    <span className="mono fw-6" style={{ fontSize: 12 }}>₺{m.estCost.toLocaleString('tr-TR')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const FuelPage = () => {
  const M = window.MOCK;
  const totalFuel = M.days30.reduce((s,d)=>s+d.fuel,0);
  const totalCost = M.days30.reduce((s,d)=>s+d.cost,0);
  const totalKm = M.days30.reduce((s,d)=>s+d.km,0);
  const avgConsumption = (totalFuel/totalKm*100).toFixed(2);
  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="fuel" size={22}/>Yakıt & Maliyet Analizi</div>
          <div className="page-header__sub">Son 30 gün performansı</div>
        </div>
        <div className="page-header__actions">
          <select className="field__select" style={{width:180}}>
            <option>Son 30 gün</option><option>Son 7 gün</option><option>Bu ay</option><option>Bu yıl</option>
          </select>
          <button className="btn btn--outline"><Icon name="download" size={14}/>Rapor</button>
        </div>
      </div>
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <KPICard label="Toplam Yakıt" value={totalFuel} format={v=>(v/1000).toFixed(1)+'K'} suffix=" L" icon="fuel" delta="-3.2%" deltaUp/>
        <KPICard label="Yakıt Maliyeti" value={totalCost} format={v=>'₺'+(v/1000000).toFixed(2)+'M'} icon="money" iconKind="accent" delta="+1.4%"/>
        <KPICard label="Toplam KM" value={totalKm} format={v=>(v/1000).toFixed(0)+'K'} suffix=" km" icon="route" iconKind="success" delta="+8.1%" deltaUp/>
        <KPICard label="Ort. Tüketim" value={parseFloat(avgConsumption)} format={v=>v.toFixed(2)} suffix=" L/100km" icon="speed" delta="-0.8%" deltaUp/>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card__head">
          <div className="card__title">Günlük Yakıt Tüketimi & Maliyet</div>
          <div className="row" style={{ gap: 14, fontSize: 12 }}>
            <span className="row" style={{ gap: 6 }}><span className="dot" style={{background:'var(--accent-500)'}}/>Yakıt (L)</span>
            <span className="row" style={{ gap: 6 }}><span className="dot" style={{background:'var(--navy-500)'}}/>Maliyet (₺)</span>
          </div>
        </div>
        <div className="card__body"><BigChart data={M.days30}/></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card__head"><div className="card__title">En Yüksek Tüketim — Araç Bazında</div></div>
          <div className="card__body card__body--flush">
            {M.vehicles.slice(0,8).map((v,i) => {
              const liters = 800 + Math.round(Math.random()*1500);
              return (
                <div key={v.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div className="row--between" style={{ marginBottom: 6 }}>
                    <span className="mono fw-6" style={{ fontSize: 13 }}>{v.plate}</span>
                    <span className="mono fw-6" style={{ fontSize: 13 }}>{liters.toLocaleString('tr-TR')} L</span>
                  </div>
                  <div className="bar"><div className="bar__fill bar__fill--accent" style={{ width: (liters/2300*100)+'%' }}/></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card__head"><div className="card__title">Maliyet Kırılımı (Bu Ay)</div></div>
          <div className="card__body">
            {[
              { l: 'Yakıt', v: 1240000, c: '#FF6B1F' },
              { l: 'Bakım & Servis', v: 380000, c: '#2C5A9E' },
              { l: 'Sigorta', v: 145000, c: '#16A974' },
              { l: 'Vergi & Harç', v: 92000, c: '#FFC53D' },
              { l: 'Sürücü Maaş', v: 680000, c: '#7889A1' },
              { l: 'Diğer', v: 88000, c: '#A3C4F0' },
            ].map((r, i, arr) => {
              const total = arr.reduce((s,x)=>s+x.v,0);
              return (
                <div key={r.l} style={{ marginBottom: 12 }}>
                  <div className="row--between" style={{ marginBottom: 4 }}>
                    <span className="row"><span className="dot" style={{background:r.c}}/><span style={{fontSize:13}}>{r.l}</span></span>
                    <span className="mono fw-6" style={{ fontSize: 13 }}>₺{r.v.toLocaleString('tr-TR')} <span className="muted" style={{fontSize:11}}>· %{(r.v/total*100).toFixed(1)}</span></span>
                  </div>
                  <div className="bar"><div className="bar__fill" style={{ width: (r.v/total*100)+'%', background: r.c }}/></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReportsPage = () => {
  const reports = [
    { id:1, name:'Aylık Filo Performans Raporu', desc:'KPI özeti, hareket istatistikleri, kâr/zarar', type:'PDF', date:'30.04.2026' },
    { id:2, name:'Yakıt Tüketim Analizi', desc:'Araç bazlı yakıt verimliliği ve trend analizi', type:'XLSX', date:'30.04.2026' },
    { id:3, name:'Sürücü Performans Skorları', desc:'Hız, frenleme, rota uyumu, yakıt verimi', type:'PDF', date:'29.04.2026' },
    { id:4, name:'Bakım & Servis Maliyetleri', desc:'Önleyici ve onarıcı bakım maliyet kırılımı', type:'XLSX', date:'28.04.2026' },
    { id:5, name:'Sefer & Teslimat Raporu', desc:'Tamamlanan, geciken ve iptal seferler', type:'PDF', date:'27.04.2026' },
    { id:6, name:'Sigorta & Belge Takibi', desc:'Yaklaşan yenileme tarihleri ve eksik belgeler', type:'PDF', date:'25.04.2026' },
  ];
  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="chart" size={22}/>Raporlama Merkezi</div>
          <div className="page-header__sub">Hazır raporlar ve özel analizler</div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--outline"><Icon name="calendar" size={14}/>Tarih aralığı</button>
          <button className="btn btn--accent"><Icon name="plus" size={14}/>Özel Rapor</button>
        </div>
      </div>

      <div className="grid grid-2">
        {reports.map(r => (
          <div key={r.id} className="card" style={{ cursor: 'pointer', transition: 'transform .15s' }}>
            <div className="card__body" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div className="kpi__icon" style={{ width: 44, height: 44, flexShrink: 0 }}>
                <Icon name="file" size={20}/>
              </div>
              <div style={{ flex: 1 }}>
                <div className="row--between" style={{ marginBottom: 4 }}>
                  <div className="fw-6" style={{ fontSize: 14.5 }}>{r.name}</div>
                  <span className="chip chip--info">{r.type}</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{r.desc}</div>
                <div className="row--between">
                  <span className="muted mono" style={{ fontSize: 11 }}>Son: {r.date}</span>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn--ghost btn--sm"><Icon name="eye" size={12}/></button>
                    <button className="btn btn--outline btn--sm"><Icon name="download" size={12}/>İndir</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const NewRecordPage = () => {
  const [type, setType] = React.useState('vehicle');
  const types = [
    { k:'vehicle', l:'Araç', icon:'truck', desc:'Yeni filo aracı kaydı' },
    { k:'driver', l:'Sürücü', icon:'user', desc:'Yeni sürücü ekle' },
    { k:'trip', l:'Sefer', icon:'route', desc:'Yeni sevkiyat planla' },
    { k:'maintenance', l:'Bakım', icon:'wrench', desc:'Bakım kaydı oluştur' },
    { k:'fuel', l:'Yakıt', icon:'fuel', desc:'Yakıt fişi gir' },
    { k:'expense', l:'Gider', icon:'money', desc:'Genel gider kaydı' },
  ];
  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="plus" size={22}/>Yeni Kayıt</div>
          <div className="page-header__sub">Hızlı veri girişi — tek ekranda</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', gap: 18 }}>
        <div className="card">
          <div className="card__head"><div className="card__title">Kayıt Türü</div></div>
          <div className="card__body card__body--flush">
            {types.map(t => (
              <div key={t.k} onClick={() => setType(t.k)} style={{
                padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center',
                cursor: 'pointer',
                background: type === t.k ? 'var(--navy-50)' : 'transparent',
                borderLeft: type === t.k ? '3px solid var(--accent-500)' : '3px solid transparent',
                borderBottom: '1px solid var(--border)',
              }}>
                <div className={`kpi__icon ${type===t.k?'':''}`} style={{ width:36, height:36 }}>
                  <Icon name={t.icon} size={16}/>
                </div>
                <div>
                  <div className="fw-6" style={{ fontSize: 13.5 }}>{t.l}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="card__title">{types.find(t=>t.k===type).l} Bilgileri</div>
            <span className="chip chip--info">Otomatik kayıt aktif</span>
          </div>
          <div className="card__body">
            {type === 'vehicle' && <VehicleForm/>}
            {type === 'driver' && <DriverForm/>}
            {type === 'trip' && <TripForm/>}
            {type === 'maintenance' && <MaintenanceForm/>}
            {type === 'fuel' && <FuelForm/>}
            {type === 'expense' && <ExpenseForm/>}
          </div>
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost">İptal</button>
            <button className="btn btn--outline">Taslak Kaydet</button>
            <button className="btn btn--accent"><Icon name="check" size={14}/>Kaydet & Devam</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, hint, children, span = 1 }) => (
  <div className="field" style={{ gridColumn: `span ${span}` }}>
    <label className="field__label">{label}</label>
    {children}
    {hint && <div className="field__hint">{hint}</div>}
  </div>
);

const VehicleForm = () => (
  <div className="grid grid-3">
    <Field label="Plaka *"><input className="field__input mono" placeholder="34 ABC 1234" defaultValue=""/></Field>
    <Field label="Araç Tipi *">
      <select className="field__select"><option>Tır / Çekici</option><option>Kamyon</option><option>Kamyonet</option><option>Konteyner</option><option>Otomobil</option></select>
    </Field>
    <Field label="Marka & Model *"><input className="field__input" placeholder="Mercedes Actros 1845"/></Field>
    <Field label="Model Yılı"><input className="field__input mono" type="number" defaultValue="2024"/></Field>
    <Field label="Şase No"><input className="field__input mono" placeholder="WDB..."/></Field>
    <Field label="Motor No"><input className="field__input mono" placeholder=""/></Field>
    <Field label="Yakıt Tipi">
      <select className="field__select"><option>Dizel</option><option>Benzin</option><option>LPG</option><option>Elektrik</option></select>
    </Field>
    <Field label="Açılış KM"><input className="field__input mono" type="number" defaultValue="0"/></Field>
    <Field label="Atanan Sürücü">
      <select className="field__select"><option>Seçiniz…</option><option>Mehmet Yılmaz</option><option>Ahmet Kaya</option></select>
    </Field>
    <Field label="Sigorta Başlangıç"><input className="field__input" type="date"/></Field>
    <Field label="Muayene Tarihi"><input className="field__input" type="date"/></Field>
    <Field label="Trafik Tescil"><input className="field__input"/></Field>
    <Field label="Notlar" span={3}><textarea className="field__textarea" rows="3" placeholder="Ek bilgiler…"/></Field>
  </div>
);
const DriverForm = () => (
  <div className="grid grid-2">
    <Field label="Ad Soyad *"><input className="field__input" placeholder="Mehmet Yılmaz"/></Field>
    <Field label="TC Kimlik"><input className="field__input mono"/></Field>
    <Field label="Telefon *"><input className="field__input mono" placeholder="+90 555 000 00 00"/></Field>
    <Field label="Email"><input className="field__input" type="email"/></Field>
    <Field label="Ehliyet Sınıfı"><select className="field__select"><option>B</option><option>C</option><option>C+E</option><option>D</option><option>E</option></select></Field>
    <Field label="Ehliyet Bitiş"><input className="field__input" type="date"/></Field>
    <Field label="İşe Başlama"><input className="field__input" type="date"/></Field>
    <Field label="Atanan Araç"><select className="field__select"><option>—</option><option>34 ABC 1234</option></select></Field>
    <Field label="SRC Belgeleri">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {['SRC1','SRC2','SRC3','SRC4','SRC5','ADR'].map(s => (
          <label key={s} className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" style={{margin:0}}/> {s}</label>
        ))}
      </div>
    </Field>
    <Field label="Adres" span={2}><textarea className="field__textarea" rows="2"/></Field>
  </div>
);
const TripForm = () => (
  <div className="grid grid-2">
    <Field label="Sefer No"><input className="field__input mono" defaultValue="SF-24831" readOnly/></Field>
    <Field label="Tarih"><input className="field__input" type="date"/></Field>
    <Field label="Çıkış Noktası *"><input className="field__input" placeholder="İstanbul"/></Field>
    <Field label="Varış Noktası *"><input className="field__input" placeholder="Ankara"/></Field>
    <Field label="Araç *"><select className="field__select"><option>Seçiniz…</option><option>34 ABC 1234</option></select></Field>
    <Field label="Sürücü *"><select className="field__select"><option>Seçiniz…</option></select></Field>
    <Field label="Yük Tipi"><select className="field__select"><option>Tekstil</option><option>Beyaz Eşya</option><option>Gıda</option><option>Soğuk Zincir</option></select></Field>
    <Field label="Tonaj"><input className="field__input mono" type="number" placeholder="20.5"/></Field>
    <Field label="Müşteri"><input className="field__input"/></Field>
    <Field label="Anlaşılan Ücret"><input className="field__input mono" placeholder="₺"/></Field>
    <Field label="Notlar" span={2}><textarea className="field__textarea" rows="2"/></Field>
  </div>
);
const MaintenanceForm = () => (
  <div className="grid grid-2">
    <Field label="Araç *"><select className="field__select"><option>Seçiniz…</option></select></Field>
    <Field label="Bakım Tipi *"><select className="field__select"><option>Periyodik</option><option>Lastik</option><option>Yağ</option><option>Fren</option></select></Field>
    <Field label="Planlanan Tarih"><input className="field__input" type="date"/></Field>
    <Field label="Servis"><input className="field__input"/></Field>
    <Field label="Tahmini Maliyet"><input className="field__input mono" placeholder="₺"/></Field>
    <Field label="Mevcut KM"><input className="field__input mono" type="number"/></Field>
    <Field label="Açıklama" span={2}><textarea className="field__textarea" rows="3"/></Field>
  </div>
);
const FuelForm = () => (
  <div className="grid grid-2">
    <Field label="Araç *"><select className="field__select"><option>Seçiniz…</option></select></Field>
    <Field label="Tarih"><input className="field__input" type="datetime-local"/></Field>
    <Field label="Litre *"><input className="field__input mono" type="number" step="0.01"/></Field>
    <Field label="Tutar (₺) *"><input className="field__input mono" type="number" step="0.01"/></Field>
    <Field label="KM"><input className="field__input mono" type="number"/></Field>
    <Field label="İstasyon"><input className="field__input"/></Field>
    <Field label="Fiş No"><input className="field__input mono"/></Field>
    <Field label="Yakıt Tipi"><select className="field__select"><option>Dizel</option><option>Benzin</option></select></Field>
  </div>
);
const ExpenseForm = () => (
  <div className="grid grid-2">
    <Field label="Gider Türü"><select className="field__select"><option>Köprü/Otoyol</option><option>Konaklama</option><option>Yemek</option><option>Diğer</option></select></Field>
    <Field label="Tarih"><input className="field__input" type="date"/></Field>
    <Field label="Tutar (₺)"><input className="field__input mono" type="number"/></Field>
    <Field label="Araç / Sefer"><select className="field__select"><option>—</option></select></Field>
    <Field label="Açıklama" span={2}><textarea className="field__textarea" rows="2"/></Field>
  </div>
);

const NotificationsPage = () => {
  const M = window.MOCK;
  const ext = [
    ...M.alerts.map(a => ({ ...a, time:a.time, severity:a.severity, title:a.title, sub:a.sub, icon:a.icon, kind: 'alert' })),
    { title:'Sigorta Yenileme', sub:'34 ABC 1234 — sigorta 15 gün içinde sona eriyor', time:'2 sa', severity:'warning', icon:'📄', kind:'doc' },
    { title:'Sürücü Ehliyet', sub:'Mehmet Yılmaz — ehliyet 30 gün içinde sona eriyor', time:'5 sa', severity:'info', icon:'🪪', kind:'doc' },
    { title:'Aylık Rapor Hazır', sub:'Nisan 2026 filo performans raporu indirilebilir', time:'1 gün', severity:'info', icon:'📊', kind:'system' },
    { title:'Sefer Tamamlandı', sub:'SF-24812 İstanbul → Ankara teslim edildi', time:'2 gün', severity:'info', icon:'✅', kind:'trip' },
  ];
  return (
    <div className="page slide-up">
      <div className="page-header">
        <div>
          <div className="page-header__title"><Icon name="bell" size={22}/>Bildirim Merkezi</div>
          <div className="page-header__sub">{ext.length} bildirim · {ext.filter(e=>e.severity==='danger'||e.severity==='warning').length} öncelikli</div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--outline"><Icon name="check" size={14}/>Tümünü okundu işaretle</button>
          <button className="btn btn--ghost"><Icon name="settings" size={14}/>Ayarlar</button>
        </div>
      </div>
      <div className="card">
        <div className="card__body card__body--flush">
          {ext.map((n, i) => (
            <div key={i} style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', gap:14, alignItems:'flex-start' }}>
              <div className="notif__icon" style={{
                width:40, height:40,
                background: n.severity==='danger'?'var(--danger-bg)':n.severity==='warning'?'var(--warning-bg)':'var(--navy-100)',
                color: n.severity==='danger'?'var(--danger)':n.severity==='warning'?'var(--warning)':'var(--navy-500)',
                fontSize: 18,
              }}>{n.icon}</div>
              <div style={{ flex: 1 }}>
                <div className="row--between">
                  <div className="fw-6" style={{ fontSize: 14 }}>{n.title}</div>
                  <span className="muted" style={{ fontSize: 11.5 }}>{n.time}</span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{n.sub}</div>
              </div>
              {i < 4 && <div className="notif__unread" style={{alignSelf:'flex-start', marginTop:8}}/>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.MaintenancePage = MaintenancePage;
window.FuelPage = FuelPage;
window.ReportsPage = ReportsPage;
window.NewRecordPage = NewRecordPage;
window.NotificationsPage = NotificationsPage;
