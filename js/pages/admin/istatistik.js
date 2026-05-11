/* =============================================================================
 * admin/istatistik.js — Platform admin aktivite analytics
 *
 * Audit log üzerinden agregasyon: en aktif admin, işlem tipi dağılımı,
 * günlük trend, saatlik histogram, impersonation kayıtları.
 * ===========================================================================*/

(function () {
  'use strict';

  let _state = { sonGun: 30, data: null };
  let _charts = {};

  async function fetch() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-istatistik-content');
    if (!el) return;
    el.innerHTML = '<div class="adm-empty">Yükleniyor…</div>';
    try {
      _state.data = await T.rpc('admin_analytics_ozet', { p_son_gun: _state.sonGun });
      render();
    } catch (err) {
      el.innerHTML = '<div class="adm-empty">Yüklenemedi: ' + T.esc(err.message) + '</div>';
    }
  }

  function render() {
    const T = window.AdmAPI;
    const el = document.getElementById('adm-istatistik-content');
    const d = _state.data || {};

    el.innerHTML = `
      <div class="adm-kpi-grid" style="margin-bottom:30px;">
        <div class="adm-kpi">
          <div class="adm-kpi-label">Son ${_state.sonGun}g İşlem</div>
          <div class="adm-kpi-value">${T.fmt.num(d.toplam_islem)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(d.aktif_admin)} farklı admin</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Son 24 Saat</div>
          <div class="adm-kpi-value positive">${T.fmt.num(d.son_24sa)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(d.basarili)} başarılı / ${T.fmt.num(d.basarisiz)} hata</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Başarı Oranı</div>
          <div class="adm-kpi-value">${d.toplam_islem > 0 ? ((d.basarili/d.toplam_islem)*100).toFixed(1) : 0}<span class="unit">%</span></div>
          <div class="adm-kpi-sub">Tüm dönem</div>
        </div>
      </div>

      <!-- Günlük Trend -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 01</span>Günlük Aktivite</h2>
        <span class="meta">Son ${_state.sonGun} gün</span>
      </div>
      <div class="adm-chart-wrap">
        <canvas id="adm-ist-gunluk" class="adm-chart"></canvas>
      </div>

      <!-- Admin başına aktivite -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 02</span>Admin Aktivitesi</h2>
        <span class="meta">${(d.admin_aktivitesi || []).length} kişi</span>
      </div>
      <table class="adm-table" style="margin-bottom:30px;">
        <thead><tr>
          <th>Admin</th>
          <th class="r">Toplam İşlem</th>
          <th>Son İşlem</th>
        </tr></thead>
        <tbody>
          ${(d.admin_aktivitesi || []).map(a => `
            <tr>
              <td>
                <strong>${T.esc(a.ad_soyad || a.email || '—')}</strong>
                <div style="font-family:'Geist Mono',monospace;font-size:10.5px;color:var(--adm-ink-3);">${T.esc(a.email || '')}</div>
              </td>
              <td class="r"><strong>${T.fmt.num(a.toplam)}</strong></td>
              <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-2);">${T.esc(T.fmt.relative(a.son))}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- İşlem Tipi Dağılımı + Saatlik Histogram (yan yana) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:30px;">
        <div>
          <div class="adm-subhead">
            <h2><span class="adm-num-prefix">§ 03</span>İşlem Tipi</h2>
            <span class="meta">Top 10</span>
          </div>
          <div class="adm-chart-wrap"><canvas id="adm-ist-tip" class="adm-chart" style="height:240px;"></canvas></div>
        </div>
        <div>
          <div class="adm-subhead">
            <h2><span class="adm-num-prefix">§ 04</span>Saatlik Dağılım</h2>
            <span class="meta">24 saat</span>
          </div>
          <div class="adm-chart-wrap"><canvas id="adm-ist-saat" class="adm-chart" style="height:240px;"></canvas></div>
        </div>
      </div>

      <!-- Impersonation Kayıtları -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 05</span>Impersonation Kayıtları</h2>
        <span class="meta">Son ${_state.sonGun}g · ${(d.son_impersonate || []).length} kayıt</span>
      </div>
      ${(d.son_impersonate || []).length === 0
        ? '<div class="adm-empty">Impersonation yapılmamış.</div>'
        : `
        <table class="adm-table">
          <thead><tr>
            <th>Zaman</th>
            <th>Admin</th>
            <th>Hedef Kullanıcı</th>
            <th>Neden</th>
          </tr></thead>
          <tbody>
            ${(d.son_impersonate || []).map(i => `
              <tr>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;">${T.esc(T.fmt.dateTime(i.created_at))}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;">${T.esc(i.admin_email || '—')}</span></td>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11.5px;color:var(--adm-warning);">${T.esc(i.target_email || '—')}</span></td>
                <td><span style="font-style:italic;color:var(--adm-ink-2);">${T.esc(i.neden || '—')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    `;

    drawCharts();
  }

  function drawCharts() {
    if (!window.Chart) return;
    Object.values(_charts).forEach(c => c?.destroy?.());
    _charts = {};

    const d = _state.data || {};
    const COLOR_INK = '#15181c';
    const COLOR_INK2 = '#3f444b';
    const COLOR_INK4 = '#b8b3a3';
    const COLOR_POS = '#1f6e44';
    const COLOR_NEG = '#a8392c';

    // §01 Günlük trend
    const gunCtx = document.getElementById('adm-ist-gunluk');
    if (gunCtx) {
      const trend = d.gunluk_trend || [];
      _charts.gunluk = new Chart(gunCtx, {
        type: 'bar',
        data: {
          labels: trend.map(t => t.gun),
          datasets: [
            { label: 'İşlem', data: trend.map(t => t.islem || 0),
              backgroundColor: 'rgba(63,68,75,.9)', borderRadius: 0 },
            { label: 'Admin', data: trend.map(t => t.admin || 0),
              type: 'line', borderColor: COLOR_POS,
              backgroundColor: 'rgba(31,110,68,.08)',
              tension: .3, pointRadius: 3, fill: true, yAxisID: 'y2' },
          ],
        },
        options: chartOpts({ y2: { position:'right', text:'Admin' } }),
      });
    }

    // §03 İşlem tipi (pie/doughnut)
    const tipCtx = document.getElementById('adm-ist-tip');
    if (tipCtx) {
      const tipler = d.islem_tipi_dagilim || [];
      const palette = [COLOR_INK, COLOR_INK2, COLOR_POS, COLOR_NEG, COLOR_INK4,
                       '#7a8299', '#b87333', '#5b6b82', '#1f6e44', '#a8392c'];
      _charts.tip = new Chart(tipCtx, {
        type: 'doughnut',
        data: {
          labels: tipler.map(t => t.tip),
          datasets: [{
            data: tipler.map(t => t.sayi),
            backgroundColor: tipler.map((_, i) => palette[i % palette.length]),
            borderColor: '#faf7f0',
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { position:'right', labels: { color: COLOR_INK, font: { size: 10 } } },
          },
        },
      });
    }

    // §04 Saatlik histogram
    const saatCtx = document.getElementById('adm-ist-saat');
    if (saatCtx) {
      const saatler = d.saatlik_dagilim || [];
      // 0-23 saatleri eksiksiz doldur
      const labels = Array.from({length:24}, (_,i) => String(i).padStart(2,'0'));
      const values = labels.map(s => {
        const f = saatler.find(x => String(x.saat).padStart(2,'0') === s);
        return f ? f.sayi : 0;
      });
      _charts.saat = new Chart(saatCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'İşlem',
            data: values,
            backgroundColor: 'rgba(31,110,68,.85)',
            borderRadius: 0,
          }],
        },
        options: chartOpts(),
      });
    }
  }

  function chartOpts(extra) {
    extra = extra || {};
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#15181c', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#3f444b', font: { size: 10 } }, grid: { color: 'rgba(214,207,185,.5)' } },
        y: { ticks: { color: '#3f444b', font: { size: 10 } }, grid: { color: 'rgba(214,207,185,.4)' } },
        ...(extra.y2 ? {
          y2: {
            position: 'right',
            ticks: { color: '#1f6e44', font: { size: 10 } },
            grid: { drawOnChartArea: false },
            title: { display: true, text: extra.y2.text, color: '#1f6e44', font: { size: 10, weight: 600 } },
          },
        } : {}),
      },
    };
  }

  function bindFilters() {
    const sel = document.getElementById('adm-ist-songun');
    sel?.addEventListener('change', () => {
      _state.sonGun = parseInt(sel.value);
      fetch();
    });
  }

  window.AdmModule_istatistik = {
    init: () => { bindFilters(); fetch(); },
    onShow: fetch,
  };
  window.admIstatistikYenile = fetch;
})();
