/* =============================================================================
 * admin/dashboard.js — Platform admin dashboard
 *
 * KPI'lar (3×3) + Son 12 ay trend grafiği + Son işlemler özet
 * ===========================================================================*/

(function () {
  'use strict';

  let _data = null;
  let _chart = null;

  async function fetch() {
    const T = window.AdmAPI;
    try {
      _data = await T.rpc('admin_dashboard_metrikler');
      render();
    } catch (err) {
      console.error(err);
      T.toast('Dashboard verisi yüklenemedi: ' + err.message, 'error');
      document.getElementById('adm-dashboard-content').innerHTML =
        '<div class="adm-empty">Veri yüklenemedi. Migration uygulanmış mı?</div>';
    }
  }

  function render() {
    const T = window.AdmAPI;
    if (!_data) return;
    const d = _data;

    const html = `
      <!-- KPI 3×3 -->
      <div class="adm-kpi-grid">
        <div class="adm-kpi">
          <div class="adm-kpi-label">Toplam Firma</div>
          <div class="adm-kpi-value">${T.fmt.num(d.firma_toplam)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(d.firma_aktif)} aktif · ${T.fmt.num(d.firma_demo)} demo</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Bu Ay Yeni Firma</div>
          <div class="adm-kpi-value positive">${T.fmt.num(d.firma_bu_ay)}</div>
          <div class="adm-kpi-sub">Son 30 günde ${T.fmt.num(d.firma_30g)}</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Aylık Tahmini Gelir</div>
          <div class="adm-kpi-value positive"><span class="pre">TL </span>${T.fmt.try(d.mrr_yaklasik)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(d.abonelik_aktif)} aktif abonelik</div>
        </div>

        <div class="adm-kpi">
          <div class="adm-kpi-label">Kullanıcı</div>
          <div class="adm-kpi-value">${T.fmt.num(d.kullanici_toplam)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(d.kullanici_30g_aktif)} son 30g aktif</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Şoför</div>
          <div class="adm-kpi-value">${T.fmt.num(d.surucu_toplam)}</div>
          <div class="adm-kpi-sub">${T.fmt.num(d.surucu_aktif)} aktif</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Filo Araç Toplam</div>
          <div class="adm-kpi-value">${T.fmt.num(d.arac_toplam)}</div>
          <div class="adm-kpi-sub">Çekici · dorse · tek parça</div>
        </div>

        <div class="adm-kpi">
          <div class="adm-kpi-label">Bu Ay Sefer</div>
          <div class="adm-kpi-value">${T.fmt.num(d.sefer_30g)}</div>
          <div class="adm-kpi-sub">Bugün ${T.fmt.num(d.sefer_bugun)} sefer</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Askıdaki Firma</div>
          <div class="adm-kpi-value">${T.fmt.num(d.firma_suspended)}</div>
          <div class="adm-kpi-sub">Manuel suspend</div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-label">Bu Ay Yeni Abonelik</div>
          <div class="adm-kpi-value positive">${T.fmt.num(d.abonelik_bu_ay)}</div>
          <div class="adm-kpi-sub">iyzipay üzerinden</div>
        </div>
      </div>

      <!-- TREND -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 01</span>Aylık Trend</h2>
        <span class="meta">Son 12 ay · yeni firma · yeni kullanıcı · sefer</span>
      </div>
      <div class="adm-chart-wrap">
        <canvas id="adm-trend-chart" class="adm-chart"></canvas>
      </div>

      <!-- Son audit özet -->
      <div class="adm-subhead">
        <h2><span class="adm-num-prefix">§ 02</span>Son Platform Aksiyonları</h2>
        <a class="meta" href="#audit" style="text-decoration:none;color:var(--adm-ink-2);">Tümünü gör →</a>
      </div>
      <div id="adm-dashboard-audit"><div class="adm-empty">Yükleniyor…</div></div>
    `;

    document.getElementById('adm-dashboard-content').innerHTML = html;

    // Grafik
    drawChart(d.aylik_trend || []);

    // Son audit
    fetchRecentAudit();
  }

  function drawChart(trend) {
    if (_chart) { _chart.destroy(); _chart = null; }
    const ctx = document.getElementById('adm-trend-chart');
    if (!ctx || !window.Chart) return;

    const labels = trend.map(t => t.ay);
    _chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Yeni Firma',
            data: trend.map(t => t.yeni_firma || 0),
            backgroundColor: 'rgba(63,68,75,0.92)',
            borderRadius: 0,
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: 'Yeni Kullanıcı',
            data: trend.map(t => t.yeni_kullanici || 0),
            backgroundColor: 'rgba(184,179,163,0.8)',
            borderRadius: 0,
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: 'Sefer',
            data: trend.map(t => t.sefer || 0),
            type: 'line',
            borderColor: 'rgba(31,110,68,1)',
            backgroundColor: 'rgba(31,110,68,0.08)',
            borderWidth: 1.6,
            pointBackgroundColor: 'rgba(31,110,68,1)',
            pointRadius: 3,
            tension: 0.3,
            fill: true,
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { labels: { color: '#15181c', font: { size: 11, weight: 500 } } },
        },
        scales: {
          x: {
            ticks: { color: '#3f444b', font: { size: 10 } },
            grid: { color: 'rgba(214,207,185,0.5)' },
          },
          y: {
            position: 'left',
            ticks: { color: '#3f444b', font: { size: 10 } },
            grid: { color: 'rgba(214,207,185,0.4)' },
            title: { display: true, text: 'Firma & Kullanıcı', color: '#15181c', font: { size: 10, weight: 600 } },
          },
          y2: {
            position: 'right',
            ticks: { color: '#1f6e44', font: { size: 10 } },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Sefer', color: '#1f6e44', font: { size: 10, weight: 600 } },
          },
        },
      },
    });
  }

  async function fetchRecentAudit() {
    const T = window.AdmAPI;
    try {
      const rows = await T.rpc('platform_audit_log_listele', { p_limit: 8, p_offset: 0 });
      const el = document.getElementById('adm-dashboard-audit');
      if (!rows || !rows.length) {
        el.innerHTML = '<div class="adm-empty">Henüz platform aksiyonu yok.</div>';
        return;
      }
      el.innerHTML = `
        <table class="adm-table">
          <thead><tr>
            <th>Zaman</th><th>Admin</th><th>İşlem</th><th>Hedef</th><th>Özet</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><span style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--adm-ink-3);">${T.esc(T.fmt.relative(r.created_at))}</span></td>
                <td>${T.esc(r.user_ad || r.user_email || '—')}</td>
                <td><span class="adm-badge ${r.basarili ? '' : 'adm-badge-danger'}">${T.esc(r.islem_tipi)}</span></td>
                <td><span class="muted">${T.esc(r.hedef_tip || '—')}</span></td>
                <td>${T.esc(r.ozet || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      document.getElementById('adm-dashboard-audit').innerHTML =
        '<div class="adm-empty">Log alınamadı.</div>';
    }
  }

  window.AdmModule_dashboard = {
    init: fetch,
    onShow: () => { /* yenile değil; explicit "yenile" butonu var */ },
  };
  window.admDashboardYenile = fetch;
})();
