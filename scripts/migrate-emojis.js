/* Tek seferlik HTML emoji → <i data-icon="..."> migration scripti.
   node scripts/migrate-emojis.js                 (kuru çalıştır — sadece raporla)
   node scripts/migrate-emojis.js --apply         (gerçek değişiklik)
*/
const fs = require('fs'), path = require('path');

const ALIAS = {
  '✓':'check','✗':'x','✕':'x','✎':'edit','✏':'edit',
  '✅':'check','❌':'x','➕':'plus',
  '⚠':'alert-triangle','✉':'mail','⚓':'anchor',
  '⚙':'settings','⚡':'zap','★':'star-filled',
  '❄':'snowflake','⚖':'percent',
  '📋':'clipboard','📊':'chart-bar',
  '📈':'trending-up','📉':'trending-down',
  '📌':'pin','📍':'map-pin',
  '📅':'calendar','🗓':'calendar-month','📆':'calendar',
  '📦':'container','📤':'export','📥':'import',
  '📐':'sliders','📏':'sliders','📎':'paperclip',
  '📞':'phone','📧':'mail','📨':'mail',
  '📲':'phone-android','📷':'camera','📸':'camera',
  '📱':'phone-android',
  '📝':'note','📄':'file-text','📜':'description',
  '📃':'description','📂':'folder','📁':'folder',
  '🗂':'folder-open','📑':'description',
  '📘':'file-text','📕':'file-text','📢':'megaphone',
  '🔍':'search','🔎':'search','🔒':'lock','🔓':'unlock',
  '🔐':'lock','🔑':'key','🔗':'link','🔔':'bell',
  '🔕':'bell-off','🔧':'wrench','🔨':'tools','🔩':'screwdriver',
  '🛠':'tools','🛞':'wheel','🛣':'road','🛡':'shield',
  '🚛':'truck','🚚':'truck','🚐':'truck','🚗':'truck',
  '🚙':'truck','🚌':'truck','🚔':'truck','🛻':'truck',
  '🚢':'ship','🚦':'traffic-light','🚧':'warning-cone',
  '🚨':'siren','🚫':'ban','🚪':'log-out',
  '🚀':'rocket','🚉':'building',
  '🏠':'home','🏢':'building','🏨':'building',
  '🏭':'factory','🏥':'building','🏦':'building',
  '🏗':'building','🏁':'flag-finish','🏆':'trophy',
  '👤':'user','👥':'users','👨':'user','👩':'user',
  '👋':'wave','👈':'chevron-left','👉':'chevron-right',
  '👍':'thumb-up','🤝':'handshake','🪪':'credit-card',
  '💰':'money','💵':'banknote','💸':'banknote',
  '💳':'credit-card','💼':'briefcase',
  '💬':'message-circle','💭':'message-circle',
  '💡':'lightbulb','💾':'save','💎':'sparkles',
  '🕐':'clock','🕒':'clock','⏰':'clock','⏱':'timer',
  '🗺':'map','🗑':'trash','🗒':'note',
  '🎯':'target','🎉':'party','🎨':'sparkles',
  '🎬':'apps','🎛':'sliders',
  '🧮':'calculator','🧭':'compass','🧠':'lightbulb',
  '🧹':'broom','🅿':'parking',
  '🌐':'globe','🌍':'globe','🔥':'flame',
  '🔄':'refresh','🔃':'refresh','🔁':'refresh',
  '📡':'globe','📶':'activity',
  '🟢':'circle-filled','🔴':'circle-filled','🟡':'circle-filled',
  '🟠':'circle-filled','🔵':'circle-filled','⚫':'circle-filled',
  '🔲':'circle','◯':'circle',
  '✈':'send','✍':'edit','👁':'eye','🔖':'bookmark','❤':'heart-filled',
  '🍪':'circle','🍽':'circle','🆕':'sparkles',
  '🛏':'home','🛑':'no-entry','☰':'menu',
  '🇹':'flag','🇷':'flag','🫧':'sparkles',
};

const TARGETS = ['html'];

function findFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes:true })) {
    if (e.name === '_backup_pre_refactor' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, out);
    else if (TARGETS.includes(e.name.split('.').pop())) out.push(p);
  }
}

const apply = process.argv.includes('--apply');
const root = process.argv.find(a => a.startsWith('--root='))?.slice(7) || '.';
const files = [];
findFiles(root, files);

// Sıralı escape: emoji listesi UTF-16 surrogate pair'leri içeriyor olabilir
const allKeys = Object.keys(ALIAS).sort((a,b) => b.length - a.length);
const escaped = allKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const emojiRe = new RegExp('(' + escaped.join('|') + ')', 'g');

let totalReplaced = 0;
const fileReports = [];

for (const file of files) {
  const orig = fs.readFileSync(file, 'utf8');
  let count = 0;
  // <script>, <style>, <!---->, attribute (tag) içerikleri korunsun.
  // Text node'larda değişiklik yap.
  // <title>, <script>, <style>, <textarea>, <option> raw-text elementleri ve <!---->
  // korunsun — içeriklerine HTML enjekte edemeyiz.
  const out = orig.replace(/<title[^>]*>[\s\S]*?<\/title>|<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>|<textarea[^>]*>[\s\S]*?<\/textarea>|<option[^>]*>[\s\S]*?<\/option>|<!--[\s\S]*?-->|<[^>]*>|[^<]+/g, (match) => {
    if (match.startsWith('<') || match.startsWith('<!')) return match;
    return match.replace(emojiRe, (em) => {
      const name = ALIAS[em];
      if (!name) return em;
      count++;
      return `<i data-icon="${name}" aria-hidden="true"></i>`;
    });
  });
  if (count > 0) {
    if (apply) fs.writeFileSync(file, out, 'utf8');
    totalReplaced += count;
    fileReports.push([file, count]);
  }
}

console.log(`\n${apply ? 'Uygulandı' : 'KURU ÇALIŞMA'}: ${totalReplaced} emoji, ${fileReports.length} HTML dosyası.\n`);
fileReports.sort((a,b) => b[1] - a[1]).forEach(([f, c]) => console.log(`  ${String(c).padStart(4)}  ${f}`));
if (!apply) console.log('\n--apply ile gerçek değişiklik yapılır.');
