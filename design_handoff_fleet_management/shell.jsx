/* App shell: sidebar + topbar */

const NAV_GROUPS = [
  { label: "Genel", items: [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "map", label: "Canlı Harita", icon: "map" },
  ]},
  { label: "Operasyon", items: [
    { id: "vehicles", label: "Araçlar", icon: "truck" },
    { id: "drivers", label: "Sürücüler", icon: "users" },
    { id: "trips", label: "Seferler", icon: "route", badge: 7 },
    { id: "maintenance", label: "Bakım", icon: "wrench", badge: 3 },
  ]},
  { label: "Analiz", items: [
    { id: "fuel", label: "Yakıt & Maliyet", icon: "fuel" },
    { id: "reports", label: "Raporlar", icon: "chart" },
  ]},
  { label: "Sistem", items: [
    { id: "new", label: "Yeni Kayıt", icon: "plus" },
    { id: "notifications", label: "Bildirimler", icon: "bell", badge: 12 },
  ]},
];

const PAGE_TITLES = {
  dashboard: { title: "Komuta Merkezi", crumb: "Genel Bakış" },
  map: { title: "Canlı Filo Haritası", crumb: "Operasyon / Harita" },
  vehicles: { title: "Araç Filosu", crumb: "Operasyon / Araçlar" },
  vehicleDetail: { title: "Araç Detay", crumb: "Operasyon / Araçlar / Detay" },
  drivers: { title: "Sürücüler", crumb: "Operasyon / Sürücüler" },
  driverDetail: { title: "Sürücü Detay", crumb: "Operasyon / Sürücüler / Detay" },
  trips: { title: "Seferler & Sevkiyat", crumb: "Operasyon / Seferler" },
  maintenance: { title: "Bakım Planlama", crumb: "Operasyon / Bakım" },
  fuel: { title: "Yakıt & Maliyet Analizi", crumb: "Analiz / Yakıt" },
  reports: { title: "Raporlama Merkezi", crumb: "Analiz / Raporlar" },
  new: { title: "Yeni Kayıt", crumb: "Sistem / Yeni Kayıt" },
  notifications: { title: "Bildirim Merkezi", crumb: "Sistem / Bildirimler" },
};

const Sidebar = ({ active, onNavigate, collapsed, onToggleCollapse }) => (
  <aside className="sidebar">
    <div className="sidebar__brand">
      <button className="sidebar__brand-mark" onClick={onToggleCollapse} title="Daralt">
        <LogoMark size={32}/>
      </button>
      <div className="sidebar__brand-name">Fleetly<span>.fit</span></div>
    </div>
    <nav className="sidebar__nav">
      {NAV_GROUPS.map(g => (
        <div key={g.label}>
          <div className="sidebar__group">{g.label}</div>
          {g.items.map(it => (
            <div
              key={it.id}
              className={`sidebar__item ${active === it.id ? 'active' : ''}`}
              onClick={() => onNavigate(it.id)}
              title={it.label}
            >
              <Icon name={it.icon}/>
              <span className="sidebar__item-label">{it.label}</span>
              {it.badge && <span className="sidebar__item-badge">{it.badge}</span>}
            </div>
          ))}
        </div>
      ))}
    </nav>
    <div className="sidebar__footer">
      <div className="sidebar__avatar">EÖ</div>
      <div className="sidebar__user-info">
        <div className="sidebar__user-name">Erkan Öner</div>
        <div className="sidebar__user-role">Genel Müdür</div>
      </div>
    </div>
  </aside>
);

const Header = ({ page, theme, setTheme }) => {
  const cfg = PAGE_TITLES[page] || { title: page, crumb: "" };
  return (
    <header className="header">
      <div>
        <div className="header__breadcrumb">{cfg.crumb}</div>
        <div className="header__title">{cfg.title}</div>
      </div>
      <div className="header__search">
        <Icon name="search"/>
        <input placeholder="Plaka, sürücü, sefer no, müşteri ara…"/>
      </div>
      <div className="header__actions">
        <button className="icon-btn" title="Tema" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'}/>
        </button>
        <button className="icon-btn" title="Yardım"><Icon name="settings"/></button>
        <button className="icon-btn" title="Bildirimler">
          <Icon name="bell"/>
          <span className="icon-btn__dot"/>
        </button>
      </div>
    </header>
  );
};

window.Sidebar = Sidebar;
window.Header = Header;
window.PAGE_TITLES = PAGE_TITLES;
