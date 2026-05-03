/* Mock data for Fleetly.fit */

const MOCK = (() => {
  const driverNames = [
    "Mehmet Yılmaz","Ahmet Kaya","Mustafa Demir","Hüseyin Şahin","İbrahim Çelik",
    "Ali Öztürk","Hasan Aydın","Ramazan Doğan","Yusuf Arslan","Murat Kılıç",
    "Emre Polat","Serkan Aksoy","Burak Yıldız","Cengiz Korkmaz","Tolga Erdoğan",
    "Selim Tunç","Kerem Akın","Onur Çetin","Volkan Güneş","Tarık Bozkurt"
  ];
  const cities = ["İstanbul","Ankara","İzmir","Bursa","Konya","Adana","Gaziantep","Mersin","Antalya","Kayseri","Kocaeli","Samsun","Trabzon","Eskişehir"];
  const brands = ["Mercedes Actros","Volvo FH16","Scania R450","MAN TGX","Renault T520","Iveco S-Way","DAF XF","Ford F-MAX"];
  const lcv = ["Ford Transit","Mercedes Sprinter","Iveco Daily","Volkswagen Crafter","Renault Master"];
  const cars = ["Volkswagen Passat","Renault Megane","Toyota Corolla","Skoda Superb","Ford Focus"];

  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  // Deterministic-ish using mulberry32
  let s = 1234567;
  const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const irnd = (n) => Math.floor(rnd() * n);
  const prnd = (arr) => arr[irnd(arr.length)];

  const vehicles = [];
  const plates = new Set();
  const types = ["Tır","Tır","Tır","Kamyon","Kamyon","Kamyonet","Kamyonet","Konteyner","Otomobil"];
  for (let i = 0; i < 48; i++) {
    let plate;
    do {
      const l1 = String.fromCharCode(65 + irnd(26));
      const l2 = String.fromCharCode(65 + irnd(26));
      const l3 = String.fromCharCode(65 + irnd(26));
      plate = `34 ${l1}${l2} ${1000 + irnd(8999)}`;
    } while (plates.has(plate));
    plates.add(plate);
    const type = prnd(types);
    const brand = type === "Otomobil" ? prnd(cars) : type === "Kamyonet" ? prnd(lcv) : prnd(brands);
    const statuses = ["moving","moving","moving","moving","idle","stopped","maint","alarm"];
    const status = prnd(statuses);
    vehicles.push({
      id: `V${(1000+i).toString()}`,
      plate, type, brand,
      year: 2018 + irnd(7),
      driver: prnd(driverNames),
      status,
      speed: status === "moving" ? 40 + irnd(50) : 0,
      odometer: 50000 + irnd(450000),
      fuel: 20 + irnd(80),
      location: prnd(cities),
      destination: prnd(cities),
      lastUpdate: irnd(15) + " dk önce",
      nextMaintKm: 1000 + irnd(15000),
      maintDueDays: irnd(90) - 10,
      insuranceDue: irnd(180) - 30,
      x: 0.1 + rnd() * 0.85,
      y: 0.1 + rnd() * 0.8,
    });
  }

  const trips = [];
  const tripStatus = ["delivered","in-transit","loading","scheduled","delayed"];
  for (let i = 0; i < 30; i++) {
    const v = prnd(vehicles);
    const st = prnd(tripStatus);
    trips.push({
      id: `SF-${24800 + i}`,
      vehiclePlate: v.plate,
      driver: v.driver,
      from: prnd(cities),
      to: prnd(cities.filter(c => c !== v.location)),
      cargo: prnd(["Tekstil","Beyaz Eşya","Gıda","İnşaat Mlz.","Otomotiv Parça","Kimyasal","Soğuk Zincir"]),
      tons: (5 + rnd() * 25).toFixed(1),
      status: st,
      progress: st === "delivered" ? 100 : st === "scheduled" ? 0 : st === "loading" ? 5 : 20 + irnd(75),
      eta: st === "delivered" ? "Tamamlandı" : `${irnd(8)}s ${irnd(60)}dk`,
      revenue: 4000 + irnd(15000),
    });
  }

  const drivers = driverNames.slice(0, 18).map((name, i) => {
    const initials = name.split(" ").map(n => n[0]).join("");
    const score = 70 + irnd(30);
    return {
      id: `DR${100+i}`,
      name, initials,
      phone: `+90 5${irnd(10)}${irnd(10)} ${100+irnd(900)} ${10+irnd(90)} ${10+irnd(90)}`,
      license: prnd(["B","C","C+E","D","E"]),
      licenseExpiry: `${10+irnd(20)}.${1+irnd(12)}.202${6+irnd(4)}`,
      experience: 2 + irnd(20),
      activeVehicle: prnd(vehicles).plate,
      tripsThisMonth: 8 + irnd(40),
      kmThisMonth: 2000 + irnd(8000),
      score,
      scoreClass: score >= 90 ? "success" : score >= 80 ? "info" : score >= 70 ? "warning" : "danger",
      status: prnd(["active","active","active","off","leave"]),
    };
  });

  const maintenance = vehicles.slice(0, 12).map((v, i) => ({
    id: `MT${500+i}`,
    plate: v.plate,
    type: prnd(["Periyodik Bakım","Lastik Değişimi","Yağ Değişimi","Fren Sistemi","Akü","Klima","Genel Servis"]),
    dueDate: `${10+irnd(20)}.${5+irnd(2)}.2026`,
    daysLeft: irnd(60) - 10,
    km: v.odometer,
    nextKm: v.odometer + 1000 + irnd(8000),
    estCost: 2000 + irnd(15000),
    priority: prnd(["yüksek","orta","düşük"]),
    status: prnd(["scheduled","overdue","in-progress"])
  }));

  const alerts = [
    { id:1, type:"speed", title:"Hız İhlali", sub:"34 ABC 4521 — 95 km/h (Sınır 80)", time:"2 dk", severity:"danger", icon:"⚡" },
    { id:2, type:"route", title:"Rota Dışı", sub:"34 KLM 7733 planlanan rotanın dışında", time:"8 dk", severity:"warning", icon:"📍" },
    { id:3, type:"fuel", title:"Yakıt Düşük", sub:"34 XYZ 2089 — %12 yakıt kaldı", time:"15 dk", severity:"warning", icon:"⛽" },
    { id:4, type:"maint", title:"Bakım Gecikti", sub:"34 DEF 1156 — 4 gün gecikme", time:"1 sa", severity:"danger", icon:"🔧" },
    { id:5, type:"idle", title:"Uzun Rölanti", sub:"34 GHI 4477 — 38 dk rölantide", time:"35 dk", severity:"info", icon:"⏱" },
    { id:6, type:"door", title:"Kapı Açık", sub:"34 RST 8821 — Yük kapısı açık (durağan)", time:"5 dk", severity:"warning", icon:"🚪" },
  ];

  // 24h fuel/cost data
  const hours = Array.from({length: 24}, (_, h) => ({
    h: `${h.toString().padStart(2,'0')}:00`,
    trips: irnd(12) + (h > 6 && h < 22 ? 8 : 1),
    fuel: 200 + irnd(800) + (h > 7 && h < 20 ? 600 : 0),
  }));

  // Last 30 days
  const days30 = Array.from({length: 30}, (_, d) => ({
    d: d+1,
    fuel: 8000 + irnd(4000),
    cost: 65000 + irnd(35000),
    revenue: 110000 + irnd(60000),
    km: 9500 + irnd(3500),
  }));

  return { vehicles, trips, drivers, maintenance, alerts, hours, days30, cities };
})();

window.MOCK = MOCK;
