/* =============================================================================
 * admin/saglik.js — Sistem Sağlık (Cron + Storage + DB + Email)
 * ===========================================================================*/

(function () {
  'use strict';

  let _state = {
    dbStats: null,
    cronJobs: [],
    storageBuckets: [],
    tabloBoyutlari: [],
    emailGonderim: [],
    edgeFnOzet: [],
    edgeFnLog: [],
    edgeFnFiltre: null,
  };

  function fmtBytes(n) {
    if (n == null) return '—';
    n = Number(n);
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
    if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + ' MB';
    return (n/1024/1024/1024).toFixed(2) + ' GB';
  }

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-saglik-content');
    if (!el) return;
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      const [stats, jobs, buckets, tablolar, emails, fnOzet, fnLog] = await Promise.all([
        T.rpc('admin_db_stats').catch(() => null),
        T.rpc('admin_cron_joblari').catch(() => []),
        T.rpc('admin_storage_bucket_kullanim').catch(() => []),
        T.rpc('admin_db_tablo_boyutlari', { p_limit: 15 }).catch(() => []),
        T.rpc('admin_email_gonderim_son', { p_limit: 30 }).catch(() => []),
        T.rpc('admin_edge_function_ozet', { p_son_gun: 7 }).catch(() => []),
        T.rpc('admin_edge_function_log', { p_fn_name: _state.edgeFnFiltre, p_limit: 30 }).catch(() => []),
      ]);
      _state.dbStats = stats;
      _state.cronJobs = jobs || [];
      _state.storageBuckets = buckets || [];
      _state.tabloBoyutlari = tablolar || [];
      _state.emailGonderim = emails || [];
      _state.edgeFnOzet = fnOzet || [];
      _state.edgeFnLog = fnLog || [];
      render();
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-saglik-content');
    const s = _state.dbStats || {};

    el.innerHTML = `
      <!-- DB GENEL -->
      <div class="adm-kpi-grid" style="margin-bottom:30px;">
        <div class="adm-kpi">
          <div class="adm-kpi-label">DB Boyut</div>
          <div class="adm-kpi-value">${T.esc(s.db_boyut_pretty || '—')}</div>
          <div class="adm-kpi-sub">${T.fmt.num(s.tablo_sayisi)} tablo · ${T.fmt.num(s.view_sayisi)} view</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Aktif Bağlantı</div>
          <div class="adm-kpi-value">${T.fmt.num(s.aktif_baglanti)}<span class="unit">/${T.fmt.num(s.toplam_baglanti)}</span></div>
          <div class="adm-kpi-sub">${T.fmt.num(s.uzun_sorgu_sayisi)} uzun sorgu (>5sn)</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Fonksiyon Sayısı</div>
          <div class="adm-kpi-value">${T.fmt.num(s.fonksiyon_sayisi)}</div>
          <div class="adm-kpi-sub">${(s.extensions || []).length} aktif extension</div>
        </div>
      </div>

      <!-- CRON JOBLARI -->
      ${renderCron()}

      <!-- STORAGE -->
      ${renderStorage()}

      <!-- DB TABLO BOYUTLARI -->
      ${renderTabloBoyutlari()}

      <!-- EMAIL GÖNDERIM -->
      ${renderEmailGonderim()}

      <!-- EDGE FUNCTION ÖZET -->
      ${renderEdgeFnOzet()}

      <!-- EDGE FUNCTION LOG -->
      ${renderEdgeFnLog()}
    `;
  }

  function renderEdgeFnOzet() {
    const T = window.AdmAPI;
    if (_state.edgeFnOzet.length === 0) {
      return `
        <div class="adm-subhead">
          <h2><span class="adm-num-prefix">§ 05</span>Edge Function Çağrıları (7g)</h2>
        </div>
        <div class="adm-empty">Çağrı kaydı yok.</div>
      `;
    }
    return `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 05</span>Edge Function Çağrıları (7g)</h2>
        <span class="meta">${_state.edgeFnOzet.length} fonksiyon</span>
      </div>
      <table class="adm-table" style="margin-bottom:30px;">
        <thead><tr>
          <th>Fonksiyon</th>
          <th class="r">Toplam</th>
          <th class="r">Başarılı</th>
          <th class="r">Hata</th>
          <th class="r">Ort. Süre</th>
          <th>Son Çağrı</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_state.edgeFnOzet.map(f => {
            const successRate = f.toplam > 0 ? (Number(f.basarili) / Number(f.toplam) * 100).toFixed(0) : 0;
            return `
              <tr>
                <td><strong style="font-family:'Geist Mono',monospace;font-size:12px;">${T.esc(f.fn_name)}</strong></td>
                <td class="r">${T.fmt.num(f.toplam)}</td>
                <td class="r pos">${T.fmt.num(f.basarili)} <span class="muted">(${successRate}%)</span></td>
                <td class="r ${f.basarisiz > 0 ? 'neg' : 'muted'}">${T.fmt.num(f.basarisiz)}</td>
                <td class="r">${f.ortalama_ms ? Number(f.ortalama_ms).toFixed(0) + ' ms' : '—'}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.relative(f.son_cagri))}</span></td>
                <td>
                  <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_saglik.fnFiltrele('${T.esc(f.fn_name)}')">
                    <i data-icon="filter"></i> Filtrele
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function renderEdgeFnLog() {
    const T = window.AdmAPI;
    if (_state.edgeFnLog.length === 0) {
      return '';
    }
    const baslik = _state.edgeFnFiltre
      ? `Son 30 Çağrı — <code>${T.esc(_state.edgeFnFiltre)}</code>`
      : 'Son 30 Edge Function Çağrısı (tümü)';
    return `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 06</span>${baslik}</h2>
        ${_state.edgeFnFiltre
          ? `<button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_saglik.fnFiltrele(null)"><i data-icon="x"></i> Filtreyi Kaldır</button>`
          : '<span class="meta">Hepsi</span>'}
      </div>
      <table class="adm-table">
        <thead><tr>
          <th>Tarih</th>
          <th>Fonksiyon</th>
          <th class="r">HTTP</th>
          <th>Yanıt</th>
        </tr></thead>
        <tbody>
          ${_state.edgeFnLog.map(e => {
            const ok = e.status_code && e.status_code >= 200 && e.status_code < 300;
            return `
              <tr>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.dateTime(e.created_at))}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(e.fn_name)}</span></td>
                <td class="r"><span class="${ok ? 'pos' : e.status_code ? 'neg' : 'muted'}">${e.status_code || '—'}</span></td>
                <td><span style="font-size:10.5px;font-family:'Geist Mono',monospace;color:var(--adm-ink-3);">${T.esc((e.response_preview || e.body_preview || '').slice(0, 100))}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function fnFiltrele(name) {
    _state.edgeFnFiltre = name || null;
    fetch();
  }

  function renderCron() {
    const T = window.AdmAPI;
    if (_state.cronJobs.length === 0) {
      return `
        <div class="adm-subhead">
          <h2><span class="adm-num-prefix">§ 01</span>Cron Job'lar</h2>
        </div>
        <div class="adm-empty">pg_cron extension aktif değil veya hiç job yok.</div>
      `;
    }
    return `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 01</span>Cron Job'lar</h2>
        <span class="meta">${_state.cronJobs.length} job · pg_cron</span>
      </div>
      <table class="adm-table" style="margin-bottom:30px;">
        <thead><tr>
          <th>İsim</th>
          <th>Schedule</th>
          <th>Komut</th>
          <th>Durum</th>
          <th>Son Çalışma</th>
          <th class="r">Toplam / Hata</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${_state.cronJobs.map(j => {
            const son = j.son_durum === 'succeeded' ? '<span class="adm-badge adm-badge-success">OK</span>'
                     : j.son_durum === 'failed'    ? '<span class="adm-badge adm-badge-danger">FAIL</span>'
                     : j.son_durum                  ? '<span class="adm-badge">' + T.esc(j.son_durum) + '</span>'
                                                     : '<span class="muted">—</span>';
            const aktif = j.active ? '<span class="adm-badge adm-badge-success">Aktif</span>' : '<span class="adm-badge">Pasif</span>';
            return `
              <tr>
                <td><strong>${T.esc(j.jobname || ('#' + j.jobid))}</strong></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(j.schedule)}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:10.5px;color:var(--adm-ink-2);">${T.esc((j.command||'').slice(0, 60))}…</span></td>
                <td>${aktif} ${son}</td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.relative(j.son_calisma))}</span></td>
                <td class="r">${T.fmt.num(j.toplam_calisma)} <span class="muted">/</span> <span class="${j.toplam_hata>0?'neg':'muted'}">${T.fmt.num(j.toplam_hata)}</span></td>
                <td>
                  <button class="adm-btn adm-btn-ghost adm-btn-small" onclick="AdmModule_saglik.cronDetay(${j.jobid}, '${T.esc(j.jobname||'')}')">
                    <i data-icon="history"></i> Geçmiş
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function renderStorage() {
    const T = window.AdmAPI;
    if (_state.storageBuckets.length === 0) {
      return `
        <div class="adm-subhead">
          <h2><span class="adm-num-prefix">§ 02</span>Storage Bucket Kullanımı</h2>
        </div>
        <div class="adm-empty">Storage bucket yok.</div>
      `;
    }
    const toplamByte = _state.storageBuckets.reduce((s,b) => s + Number(b.toplam_byte||0), 0);
    const toplamDosya = _state.storageBuckets.reduce((s,b) => s + Number(b.dosya_sayisi||0), 0);
    return `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 02</span>Storage Bucket Kullanımı</h2>
        <span class="meta">${_state.storageBuckets.length} bucket · ${fmtBytes(toplamByte)} · ${T.fmt.num(toplamDosya)} dosya</span>
      </div>
      <table class="adm-table" style="margin-bottom:30px;">
        <thead><tr>
          <th>Bucket</th>
          <th>Görünürlük</th>
          <th class="r">Dosya Sayısı</th>
          <th class="r">Toplam Boyut</th>
          <th class="r">Ort. Dosya</th>
          <th>Son Yükleme</th>
        </tr></thead>
        <tbody>
          ${_state.storageBuckets.map(b => `
            <tr>
              <td><strong>${T.esc(b.bucket_id)}</strong></td>
              <td>${b.public_mi ? '<span class="adm-badge adm-badge-warning">Public</span>' : '<span class="adm-badge adm-badge-info">Private</span>'}</td>
              <td class="r">${T.fmt.num(b.dosya_sayisi)}</td>
              <td class="r"><strong>${fmtBytes(b.toplam_byte)}</strong></td>
              <td class="r"><span class="muted">${fmtBytes(b.ortalama_byte)}</span></td>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.relative(b.son_yukleme))}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderTabloBoyutlari() {
    const T = window.AdmAPI;
    return `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 03</span>En Büyük 15 Tablo</h2>
        <span class="meta">total_relation_size</span>
      </div>
      <table class="adm-table" style="margin-bottom:30px;">
        <thead><tr>
          <th>Tablo</th>
          <th>Schema</th>
          <th class="r">Satır (tahmini)</th>
          <th class="r">Toplam</th>
          <th class="r">Data</th>
          <th class="r">Index</th>
          <th class="r">TOAST</th>
        </tr></thead>
        <tbody>
          ${_state.tabloBoyutlari.map(t => `
            <tr>
              <td><strong style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(t.tablo_adi)}</strong></td>
              <td><span class="muted">${T.esc(t.schema_adi)}</span></td>
              <td class="r">${T.fmt.num(t.satir_yaklasik)}</td>
              <td class="r"><strong>${fmtBytes(t.toplam_byte)}</strong></td>
              <td class="r">${fmtBytes(t.table_byte)}</td>
              <td class="r muted">${fmtBytes(t.index_byte)}</td>
              <td class="r muted">${fmtBytes(t.toast_byte)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderEmailGonderim() {
    const T = window.AdmAPI;
    if (_state.emailGonderim.length === 0) {
      return `
        <div class="adm-subhead">
          <h2><span class="adm-num-prefix">§ 04</span>E-posta Gönderim Son ${_state.emailGonderim.length}</h2>
        </div>
        <div class="adm-empty">E-posta gönderim kaydı yok.</div>
      `;
    }
    const basarili = _state.emailGonderim.filter(e => e.status_code >= 200 && e.status_code < 300).length;
    const hatali   = _state.emailGonderim.filter(e => !e.status_code || e.status_code >= 400).length;
    return `
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 04</span>E-posta Gönderim Son 30</h2>
        <span class="meta">${basarili} başarılı · ${hatali} hatalı</span>
      </div>
      <table class="adm-table">
        <thead><tr>
          <th>Tarih</th>
          <th>URL</th>
          <th class="r">HTTP</th>
          <th>Body</th>
        </tr></thead>
        <tbody>
          ${_state.emailGonderim.map(e => {
            const ok = e.status_code && e.status_code >= 200 && e.status_code < 300;
            return `
              <tr>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.relative(e.created_at))}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:10.5px;color:var(--adm-ink-2);">${T.esc((e.url||'').slice(0, 60))}…</span></td>
                <td class="r"><span class="${ok ? 'pos' : e.status_code ? 'neg' : 'muted'}">${e.status_code || '—'}</span></td>
                <td><span style="font-size:10.5px;font-family:'Geist Mono',monospace;color:var(--adm-ink-3);">${T.esc((e.body_preview||'').slice(0, 80))}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  async function cronDetay(jobid, jobname) {
    const T = window.AdmAPI;
    T.modalAc(jobname + ' — Son Çalışmalar', '<div class="adm-empty">Yükleniyor…</div>');
    try {
      const rows = await T.rpc('admin_cron_son_calismalar', { p_jobid: jobid, p_limit: 30 });
      if (!rows || rows.length === 0) {
        document.getElementById('adm-modal-body').innerHTML = '<div class="adm-empty">Çalışma kaydı yok.</div>';
        return;
      }
      const html = `
        <table class="adm-table">
          <thead><tr>
            <th>Başlangıç</th>
            <th>Süre</th>
            <th>Durum</th>
            <th>Sonuç</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const dur = (r.start_time && r.end_time)
                ? Math.round((new Date(r.end_time) - new Date(r.start_time)) / 1000) + ' sn'
                : '—';
              const dCls = r.status === 'succeeded' ? 'pos' : r.status === 'failed' ? 'neg' : 'muted';
              return `
                <tr>
                  <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.dateTime(r.start_time))}</span></td>
                  <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${dur}</span></td>
                  <td class="${dCls}"><strong>${T.esc(r.status || '—')}</strong></td>
                  <td><span style="font-size:10.5px;font-family:'Geist Mono',monospace;">${T.esc((r.return_message || '—').slice(0, 100))}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div class="adm-modal-actions">
          <button class="adm-btn adm-btn-primary" onclick="admModalKapat()">Kapat</button>
        </div>
      `;
      document.getElementById('adm-modal-body').innerHTML = html;
    } catch (err) {
      T.toast('Geçmiş yüklenemedi: ' + err.message, 'error');
    }
  }

  window.AdmModule_saglik = {
    init: fetch,
    onShow: fetch,
    cronDetay, fnFiltrele,
  };
  window.admSaglikYenile = fetch;
})();
