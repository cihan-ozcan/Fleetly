# Fleetly

Araç filosu, yakıt, bakım, sefer ve müşteri yönetimi için vanilla HTML/CSS/JS tabanlı bir PWA.

## Lokal çalıştırma

Bileşen include sistemi `fetch()` kullandığı için sayfaları doğrudan `file://` ile açmak yerine basit bir HTTP sunucusu ile çalıştırın:

```bash
python3 -m http.server 5173
```

Ardından `http://localhost:5173/index.html` adresini açın.

## Yapılandırma

`config.js` dosyası Supabase bağlantı bilgilerini içerir ve `.gitignore`'dadır.
Yeni ortamda `config.example.js` dosyasını kopyalayıp kendi anahtarınızı girin:

```bash
cp config.example.js config.js
# ardından config.js'i düzenleyin
```

## Belgeler

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — klasör yapısı, CSS/JS mimarisi, yükleme sırası.
- [`docs/MIGRATION-LOG.md`](docs/MIGRATION-LOG.md) — refactor sırasında yapılan her değişikliğin kaydı.
- [`components/README.md`](components/README.md) — `<fleetly-include>` kullanımı ve bileşen listesi.

---

created by cihanozcan
