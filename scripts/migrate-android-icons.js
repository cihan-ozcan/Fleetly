/* Android Material Icons → FleetlyIcons migration scripti.
   Hem usage'leri hem import'ları değiştirir.
   node scripts/migrate-android-icons.js                  → kuru çalışma
   node scripts/migrate-android-icons.js --apply          → uygula
   --root=<path>  varsayılan: C:/Users/cihan/Desktop/Fleetly-Android
*/
const fs = require('fs'), path = require('path');

// Material Icons referansı → FleetlyIcons üye adı
const ICON_MAP = {
  'Icons.AutoMirrored.Filled.ArrowBack':           'FleetlyIcons.ArrowLeft',
  'Icons.AutoMirrored.Filled.KeyboardArrowRight':  'FleetlyIcons.ChevronRight',
  'Icons.AutoMirrored.Filled.KeyboardArrowLeft':   'FleetlyIcons.ChevronLeft',
  'Icons.AutoMirrored.Filled.ArrowForward':        'FleetlyIcons.ArrowRight',
  'Icons.AutoMirrored.Filled.Send':                'FleetlyIcons.Send',
  'Icons.Filled.Check':           'FleetlyIcons.Check',
  'Icons.Filled.CheckCircle':     'FleetlyIcons.CheckCircle',
  'Icons.Filled.Close':           'FleetlyIcons.X',
  'Icons.Filled.AddAPhoto':       'FleetlyIcons.AddAPhoto',
  'Icons.Filled.Schedule':        'FleetlyIcons.Schedule',
  'Icons.Filled.Add':             'FleetlyIcons.Plus',
  'Icons.Filled.PhotoLibrary':    'FleetlyIcons.PhotoLibrary',
  'Icons.Filled.PhotoCamera':     'FleetlyIcons.PhotoCamera',
  'Icons.Filled.Phone':           'FleetlyIcons.Phone',
  'Icons.Filled.Navigation':      'FleetlyIcons.Navigation',
  'Icons.Filled.Lock':            'FleetlyIcons.Lock',
  'Icons.Filled.CalendarMonth':   'FleetlyIcons.CalendarMonth',
  'Icons.Outlined.Inventory':     'FleetlyIcons.Inventory',
  'Icons.Filled.Settings':        'FleetlyIcons.Settings',
  'Icons.Filled.PushPin':         'FleetlyIcons.PushPin',
  'Icons.Filled.Map':             'FleetlyIcons.Map',
  'Icons.Filled.LocalShipping':   'FleetlyIcons.LocalShipping',
  'Icons.Filled.LocalGasStation': 'FleetlyIcons.LocalGasStation',
  'Icons.Filled.Forum':           'FleetlyIcons.Forum',
  'Icons.Filled.Clear':           'FleetlyIcons.Clear',
  'Icons.Filled.ChevronRight':    'FleetlyIcons.ChevronRight',
  'Icons.Filled.ChevronLeft':     'FleetlyIcons.ChevronLeft',
  'Icons.Outlined.Place':         'FleetlyIcons.Place',
  'Icons.Outlined.Info':          'FleetlyIcons.Info',
  'Icons.Filled.Warning':         'FleetlyIcons.Warning',
  'Icons.Filled.Today':           'FleetlyIcons.Today',
  'Icons.Filled.ReportProblem':   'FleetlyIcons.ReportProblem',
  'Icons.Filled.Refresh':         'FleetlyIcons.Refresh',
  'Icons.Filled.Place':           'FleetlyIcons.Place',
  'Icons.Filled.PictureAsPdf':    'FleetlyIcons.PictureAsPdf',
  'Icons.Filled.PhoneAndroid':    'FleetlyIcons.PhoneAndroid',
  'Icons.Filled.Person':          'FleetlyIcons.Person',
  'Icons.Filled.LocationOn':      'FleetlyIcons.LocationOn',
  'Icons.Filled.Inventory2':      'FleetlyIcons.Inventory2',
  'Icons.Filled.Home':            'FleetlyIcons.Home',
  'Icons.Filled.FavoriteBorder':  'FleetlyIcons.FavoriteBorder',
  'Icons.Filled.Favorite':        'FleetlyIcons.Favorite',
  'Icons.Filled.ExitToApp':       'FleetlyIcons.ExitToApp',
  'Icons.Filled.Event':           'FleetlyIcons.Event',
  'Icons.Filled.Edit':            'FleetlyIcons.Edit',
  'Icons.Filled.Description':     'FleetlyIcons.Description',
  'Icons.Filled.ChatBubbleOutline':'FleetlyIcons.ChatBubbleOutline',
  'Icons.Filled.Cancel':          'FleetlyIcons.Cancel',
  'Icons.Filled.CameraAlt':       'FleetlyIcons.CameraAlt',
  'Icons.Filled.Build':           'FleetlyIcons.Build',
  'Icons.Filled.Brightness7':     'FleetlyIcons.Brightness7',
  'Icons.Filled.Brightness4':     'FleetlyIcons.Brightness4',
  'Icons.Filled.Apps':            'FleetlyIcons.Apps',
  'Icons.Filled.Star':            'FleetlyIcons.StarFilled',
  'Icons.Filled.StarBorder':      'FleetlyIcons.Star',
  'Icons.Filled.Search':          'FleetlyIcons.Search',
  'Icons.Filled.Delete':          'FleetlyIcons.Trash',
  'Icons.Filled.Email':           'FleetlyIcons.Mail',
  'Icons.Filled.Notifications':   'FleetlyIcons.Bell',
};

// Import'ları kaldırma listesi
const REMOVE_IMPORT_PATTERNS = [
  /^\s*import\s+androidx\.compose\.material\.icons\.Icons\s*$/m,
  /^\s*import\s+androidx\.compose\.material\.icons\.filled\.[A-Za-z0-9_]+\s*$/m,
  /^\s*import\s+androidx\.compose\.material\.icons\.outlined\.[A-Za-z0-9_]+\s*$/m,
  /^\s*import\s+androidx\.compose\.material\.icons\.automirrored\.filled\.[A-Za-z0-9_]+\s*$/m,
];

const FLEETLY_IMPORT = 'import com.fleetly.driver.presentation.ui.icons.FleetlyIcons';

const apply = process.argv.includes('--apply');
const rootArg = process.argv.find(a => a.startsWith('--root='))?.slice(7);
const root = rootArg || 'C:/Users/cihan/Desktop/Fleetly-Android';

function findKt(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes:true })) {
    if (e.name === 'build' || e.name === '.gradle' || e.name === '.idea' || e.name === 'icons') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findKt(p, out);
    else if (e.name.endsWith('.kt')) out.push(p);
  }
}

const files = [];
findKt(path.join(root, 'app/src/main'), files);

let totalReplaced = 0;
const reports = [];

// Sıralı escape: uzun olan önce eşleşsin
const keys = Object.keys(ICON_MAP).sort((a,b) => b.length - a.length);
const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const usageRe = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'g');

for (const file of files) {
  // FleetlyIcons.kt dosyasını skip et
  if (file.endsWith('FleetlyIcons.kt')) continue;
  let txt = fs.readFileSync(file, 'utf8');
  let count = 0;

  // 1) Usage'leri değiştir
  const newTxt = txt.replace(usageRe, (m) => {
    const repl = ICON_MAP[m];
    if (!repl) return m;
    count++;
    return repl;
  });

  if (count === 0) continue;

  // 2) FleetlyIcons import'ı yoksa ekle (package satırından sonra ilk import bloğuna)
  let updated = newTxt;
  if (!updated.includes(FLEETLY_IMPORT)) {
    // Hem package satırından sonra hem de mevcut import'lar arasında uygun yere ekle
    const lines = updated.split('\n');
    let firstImportIdx = -1;
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\s+/.test(lines[i])) {
        if (firstImportIdx < 0) firstImportIdx = i;
        lastImportIdx = i;
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, FLEETLY_IMPORT);
      updated = lines.join('\n');
    } else {
      // Hiç import yok — package'tan sonra ekle
      const pkgIdx = lines.findIndex(l => l.startsWith('package '));
      if (pkgIdx >= 0) {
        lines.splice(pkgIdx + 2, 0, FLEETLY_IMPORT, '');
        updated = lines.join('\n');
      }
    }
  }

  // 3) Eski Material Icons import'larını temizle (sadece dosyada hâlâ kullanılmıyorsa)
  // Önce tüm "Icons.Filled.X" referanslarını topla — eğer migration sonrası kalmadıysa import'u kaldır
  const remainingIconUsage = updated.match(/\bIcons\.(Filled|Outlined|AutoMirrored\.Filled|AutoMirrored\.Outlined|Rounded|Sharp|TwoTone)\.[A-Za-z0-9_]+\b/g);
  if (!remainingIconUsage) {
    // Tüm Material Icons import'larını kaldır
    updated = updated.split('\n').filter(l => {
      return !REMOVE_IMPORT_PATTERNS.some(re => re.test(l));
    }).join('\n');
  } else {
    // Hâlâ kullanılan Material icon'lar var; sadece migration yapılanların import'ları kaldırılır
    const stillUsed = new Set();
    for (const m of remainingIconUsage) {
      // Icons.Filled.X → "X"
      const last = m.split('.').pop();
      stillUsed.add(last);
    }
    updated = updated.split('\n').filter(l => {
      const m = l.match(/^\s*import\s+androidx\.compose\.material\.icons\.(filled|outlined|automirrored\.filled)\.([A-Za-z0-9_]+)\s*$/);
      if (!m) return true;
      // Hâlâ kullanılıyorsa tut
      return stillUsed.has(m[2]);
    }).join('\n');
  }

  if (apply) fs.writeFileSync(file, updated, 'utf8');
  totalReplaced += count;
  reports.push([file, count]);
}

console.log(`\n${apply ? 'Uygulandı' : 'KURU ÇALIŞMA'}: ${totalReplaced} kullanım, ${reports.length} Kotlin dosyası.\n`);
reports.sort((a,b) => b[1] - a[1]).forEach(([f, c]) => {
  const rel = path.relative(root, f);
  console.log(`  ${String(c).padStart(4)}  ${rel}`);
});
if (!apply) console.log('\n--apply ile gerçek değişiklik yapılır.');
