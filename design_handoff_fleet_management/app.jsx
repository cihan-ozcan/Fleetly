/* Main App */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light"
}/*EDITMODE-END*/;

const App = () => {
  const [page, setPage] = React.useState('dashboard');
  const [collapsed, setCollapsed] = React.useState(false);
  const [selectedVehicle, setSelectedVehicle] = React.useState(null);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme || 'light');
  }, [tweaks.theme]);

  const isFullPage = page === 'map';

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard onNavigate={setPage} onSelectVehicle={setSelectedVehicle}/>;
      case 'map': return <MapPage onSelectVehicle={setSelectedVehicle}/>;
      case 'vehicles': return <VehiclesPage onSelectVehicle={setSelectedVehicle}/>;
      case 'drivers': return <DriversPage/>;
      case 'trips': return <TripsPage/>;
      case 'maintenance': return <MaintenancePage/>;
      case 'fuel': return <FuelPage/>;
      case 'reports': return <ReportsPage/>;
      case 'new': return <NewRecordPage/>;
      case 'notifications': return <NotificationsPage/>;
      default: return <Dashboard onNavigate={setPage} onSelectVehicle={setSelectedVehicle}/>;
    }
  };

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar active={page} onNavigate={setPage} collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)}/>
      <Header page={page} theme={tweaks.theme} setTheme={(t) => setTweak('theme', t)}/>
      <main className={`main ${isFullPage ? 'main--full' : ''}`}>
        {isFullPage ? <div className="page page--full">{renderPage()}</div> : renderPage()}
      </main>

      {selectedVehicle && <VehicleDrawer vehicle={selectedVehicle} onClose={() => setSelectedVehicle(null)}/>}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Görünüm">
          <TweakRadio label="Tema" value={tweaks.theme} onChange={v => setTweak('theme', v)}
            options={[{value:'light',label:'Açık'},{value:'dark',label:'Koyu'}]}/>
        </TweakSection>
        <TweakSection title="Hızlı Geçiş">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {Object.keys(PAGE_TITLES).filter(k => !k.includes('Detail')).map(k => (
              <button key={k} onClick={() => setPage(k)}
                className="btn btn--sm"
                style={{
                  background: page === k ? 'var(--navy-500)' : 'var(--bg-sunk)',
                  color: page === k ? 'white' : 'var(--text-muted)',
                  justifyContent: 'flex-start'
                }}>{PAGE_TITLES[k].title}</button>
            ))}
          </div>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
