/* =============================================================================
 * surucu-paylasim-page.js — Şoför Akışı yönetici sayfası (Paket B)
 * -----------------------------------------------------------------------------
 * Bağımlılıklar (window):
 *   • SuruciuPaylasimAPI   (js/integrations/surucu-paylasim-api.js)
 *   • sbUrl, sbHeaders     (Supabase yardımcıları — config.js)
 *   • currentFirmaId       (auth state)
 *
 * Açılış: openSuruciuAkisPage()
 *   • İlk açılışta modal DOM'u dinamik kurulur (#surucu-akis-page).
 *   • Sekme yapısı: Akış (moderasyon) / DM Trafiği / Duyuru Gönder.
 *   • Polling 30sn (SuruciuPaylasimAPI.startPolling).
 *
 * Kapanış: closeSuruciuAkisPage()
 *
 * Tasarım kararları:
 *   • Bu sayfada şoförler arası DM içeriği görüntülenir (DECISIONS.md #2).
 *     UI'da "Moderasyon görünümü — kullanıcılar bilgilendirilmiştir" notu var.
 *   • Yönetici paylaşım atarsa kategori='genel' + pinned=true (RPC zaten
 *     kaynak_rol='yonetici' yazıyor).
 * =========================================================================== */

(function () {
  'use strict';

  const state = {
    activeTab: 'akis',     // 'akis' | 'dm' | 'duyuru'
    feed: [],
    dms: [],
    dmStats: [],
    stats: null,
    kategoriFilter: 'all',
    includeStale: false,
    initialized: false
  };

  function _$(id) { return document.getElementById(id); }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function _fmtZaman(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function _kategoriMeta(k) {
    const m = {
      trafik:  { emoji: '🚧', label: 'Trafik',  color: '#ef4444' },
      liman:   { emoji: '⚓', label: 'Liman',   color: '#0284c7' },
      fabrika: { emoji: '🏭', label: 'Fabrika', color: '#7c3aed' },
      yakit:   { emoji: '⛽', label: 'Yakıt',   color: '#f59e0b' },
      soru:    { emoji: '💬', label: 'Soru',    color: '#22c55e' },
      genel:   { emoji: '📌', label: 'Genel',   color: 'var(--muted)' }
    };
    return m[k] || { emoji: '•', label: k || '—', color: 'var(--muted)' };
  }

  // ─────────────────────────────────────────────────────────────
  // DOM kurulum (ilk açılışta)
  // ─────────────────────────────────────────────────────────────
  function _ensureDom() {
    if (_$('surucu-akis-page')) return;
    const page = document.createElement('div');
    page.id = 'surucu-akis-page';
    page.className = 'page-fullscreen hidden';
    page.innerHTML = `
      <style>
        #surucu-akis-page {
          position: fixed; inset: 0; z-index: 1500; background: var(--bg, #0b1220);
          color: var(--text, #f1f5f9); display: flex; flex-direction: column;
          overflow: hidden; font-family: inherit;
        }
        #surucu-akis-page.hidden { display: none; }
        #sap-topbar {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; border-bottom: 1px solid var(--border, #1e293b);
          background: var(--surface, #0f172a);
        }
        #sap-topbar h1 { margin: 0; font-size: 17px; font-weight: 700; }
        #sap-topbar .sap-subtitle { font-size: 12px; color: var(--muted, #64748b); }
        #sap-tabs {
          display: flex; gap: 0; border-bottom: 1px solid var(--border, #1e293b);
          background: var(--surface, #0f172a);
        }
        #sap-tabs .sap-tab {
          padding: 12px 18px; font-size: 13px; font-weight: 600;
          color: var(--muted, #64748b); cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        #sap-tabs .sap-tab.active {
          color: var(--accent, #f97316);
          border-bottom-color: var(--accent, #f97316);
        }
        #sap-content { flex: 1; overflow-y: auto; padding: 16px; }
        .sap-stat-grid {
          display: grid; grid-template-columns: repeat(7, 1fr);
          gap: 8px; margin-bottom: 16px;
        }
        @media (max-width: 768px) {
          .sap-stat-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .sap-stat-card {
          padding: 12px; border-radius: 10px;
          background: var(--surface, #0f172a);
          border: 1px solid var(--border, #1e293b);
          cursor: pointer; transition: border-color .15s;
        }
        .sap-stat-card:hover { border-color: var(--accent, #f97316); }
        .sap-stat-card.active { border-color: var(--accent, #f97316); background: rgba(249,115,22,.08); }
        .sap-stat-emoji { font-size: 22px; }
        .sap-stat-num { font-size: 20px; font-weight: 700; margin-top: 4px; }
        .sap-stat-label { font-size: 11px; color: var(--muted, #64748b); }
        .sap-card {
          padding: 14px; border-radius: 10px;
          background: var(--surface, #0f172a);
          border: 1px solid var(--border, #1e293b);
          margin-bottom: 8px;
        }
        .sap-card.pinned { border-color: var(--accent, #f97316); border-width: 2px; }
        .sap-card.stale { opacity: 0.6; }
        .sap-card-row {
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
        }
        .sap-rol-badge {
          display: inline-block; padding: 2px 8px; border-radius: 6px;
          font-size: 11px; font-weight: 600;
          background: rgba(249,115,22,.15); color: var(--accent, #f97316);
        }
        .sap-card-actions {
          display: flex; gap: 8px; margin-top: 10px;
        }
        .sap-btn {
          padding: 6px 12px; border-radius: 8px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          border: 1px solid var(--border, #1e293b);
          background: transparent; color: var(--text, #f1f5f9);
        }
        .sap-btn:hover { border-color: var(--accent, #f97316); color: var(--accent, #f97316); }
        .sap-btn.primary { background: var(--accent, #f97316); color: #fff; border-color: var(--accent, #f97316); }
        .sap-empty {
          text-align: center; padding: 60px 20px;
          color: var(--muted, #64748b);
        }
        .sap-form-row { margin-bottom: 12px; }
        .sap-form-row label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--muted); }
        .sap-form-row input, .sap-form-row textarea, .sap-form-row select {
          width: 100%; padding: 10px;
          background: var(--surface, #0f172a); border: 1px solid var(--border, #1e293b);
          border-radius: 8px; color: var(--text, #f1f5f9); font-size: 13px;
        }
        .sap-warning-banner {
          padding: 10px 14px; border-radius: 8px;
          background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.30);
          color: #f59e0b; font-size: 12px; margin-bottom: 14px;
        }
        .sap-dm-row {
          display: grid; grid-template-columns: 1fr 1fr 80px;
          gap: 8px; padding: 10px; align-items: center;
          border-bottom: 1px solid var(--border, #1e293b); font-size: 12px;
        }
        .sap-dm-row .sap-dm-msg { color: var(--muted); font-style: italic; }
      </style>
      <div id="sap-topbar">
        <button class="sap-btn" id="sap-close-btn" type="button">← Kapat</button>
        <div style="flex:1">
          <h1>🤝 Şoför Akışı</h1>
          <div class="sap-subtitle">Moderasyon · paylaşımlar · DM trafiği · duyuru</div>
        </div>
      </div>
      <div id="sap-tabs">
        <div class="sap-tab active" data-tab="akis">📋 Akış</div>
        <div class="sap-tab" data-tab="dm">💬 DM Trafiği</div>
        <div class="sap-tab" data-tab="duyuru">📢 Duyuru Gönder</div>
      </div>
      <div id="sap-content"></div>
    `;
    document.body.appendChild(page);

    // Listener'ları bağla
    page.querySelector('#sap-close-btn').addEventListener('click', closeSuruciuAkisPage);
    page.querySelectorAll('.sap-tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Sayfa aç / kapat
  // ─────────────────────────────────────────────────────────────
  async function openSuruciuAkisPage() {
    _ensureDom();
    const page = _$('surucu-akis-page');
    page.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (!state.initialized) {
      // İlk yükleme + polling başlat
      if (window.SuruciuPaylasimAPI) {
        window.SuruciuPaylasimAPI.onChange(_onFeedChange);
        window.SuruciuPaylasimAPI.startPolling(30000);
      }
      state.initialized = true;
    }
    await _refreshAll();
    switchTab(state.activeTab);
  }

  function closeSuruciuAkisPage() {
    const page = _$('surucu-akis-page');
    if (page) page.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function _onFeedChange(snap) {
    state.feed = snap;
    if (state.activeTab === 'akis') _renderAkis();
  }

  async function _refreshAll() {
    if (!window.SuruciuPaylasimAPI) {
      _$('sap-content').innerHTML =
        '<div class="sap-empty">SuruciuPaylasimAPI yüklü değil — js/integrations/surucu-paylasim-api.js dahil edildi mi?</div>';
      return;
    }
    try {
      const [feed, stats] = await Promise.all([
        window.SuruciuPaylasimAPI.feedList({
          kategori: state.kategoriFilter,
          includeStale: state.includeStale
        }),
        window.SuruciuPaylasimAPI.categoryStats()
      ]);
      state.feed = feed;
      state.stats = stats;
    } catch (e) {
      console.warn('[SuruciuAkisPage] yükleme hata:', e.message);
    }
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('#sap-tabs .sap-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    if (tab === 'akis') _renderAkis();
    else if (tab === 'dm') _renderDm();
    else if (tab === 'duyuru') _renderDuyuru();
  }

  // ─────────────────────────────────────────────────────────────
  // Sekme: Akış (moderasyon)
  // ─────────────────────────────────────────────────────────────
  function _renderAkis() {
    const c = _$('sap-content');
    if (!c) return;
    const stats = state.stats || { trafik:0, liman:0, fabrika:0, yakit:0, soru:0, genel:0, total:0 };
    const cats = ['all','trafik','liman','fabrika','yakit','soru','genel'];
    const statHtml = cats.map(cat => {
      const meta = cat === 'all'
        ? { emoji: '🌐', label: 'Hepsi' }
        : _kategoriMeta(cat);
      const num = cat === 'all' ? stats.total : (stats[cat] || 0);
      const isActive = state.kategoriFilter === cat;
      return `
        <div class="sap-stat-card ${isActive ? 'active' : ''}" data-cat="${cat}">
          <div class="sap-stat-emoji">${meta.emoji}</div>
          <div class="sap-stat-num">${num}</div>
          <div class="sap-stat-label">${_esc(meta.label)}</div>
        </div>`;
    }).join('');

    const toggleStaleBtn = `
      <button class="sap-btn" id="sap-toggle-stale">
        ${state.includeStale ? '📜 Eski paylaşımlar açık' : '📜 Eski paylaşımlar kapalı'}
      </button>`;

    const list = (state.feed || []);
    const cardsHtml = list.length === 0
      ? '<div class="sap-empty">Bu filtrede paylaşım yok.</div>'
      : list.map(_paylasimCardHtml).join('');

    c.innerHTML = `
      <div class="sap-stat-grid">${statHtml}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <div style="font-size:13px; font-weight:600;">${list.length} paylaşım</div>
        ${toggleStaleBtn}
      </div>
      ${cardsHtml}
    `;
    // Listener'lar
    c.querySelectorAll('.sap-stat-card').forEach(el => {
      el.addEventListener('click', () => {
        state.kategoriFilter = el.dataset.cat;
        _refreshAll().then(_renderAkis);
      });
    });
    c.querySelector('#sap-toggle-stale')?.addEventListener('click', () => {
      state.includeStale = !state.includeStale;
      _refreshAll().then(_renderAkis);
    });
    c.querySelectorAll('[data-action="pin"]').forEach(el => {
      el.addEventListener('click', () => _pinToggle(el.dataset.id, el.dataset.next === 'true'));
    });
    c.querySelectorAll('[data-action="delete"]').forEach(el => {
      el.addEventListener('click', () => _moderateDelete(el.dataset.id));
    });
  }

  function _paylasimCardHtml(p) {
    const meta = _kategoriMeta(p.kategori);
    const isStale = !!p.suresi_doldu_mu;
    const yoneticiBadge = p.kaynak_rol === 'yonetici'
      ? '<span class="sap-rol-badge">👨‍💼 Duyuru</span>'
      : '';
    const pinClass = p.pinned ? 'pinned' : '';
    const staleClass = isStale ? 'stale' : '';
    const konumChip = p.konum_etiket
      ? `<span style="font-size:11px; color:var(--muted)">📍 ${_esc(p.konum_etiket)}</span>`
      : '';
    return `
      <div class="sap-card ${pinClass} ${staleClass}">
        <div class="sap-card-row">
          <span style="font-size: 18px;">${meta.emoji}</span>
          <span style="font-weight: 700;">${_esc(p.kaynak_ad || 'Bilinmeyen')}</span>
          ${yoneticiBadge}
          ${p.kaynak_plaka ? `<span style="font-size:11px; color:var(--muted); font-family:monospace;">${_esc(p.kaynak_plaka)}</span>` : ''}
          <span style="margin-left:auto; font-size:11px; color:var(--muted);">${_fmtZaman(p.created_at)}</span>
        </div>
        ${p.baslik ? `<div style="font-weight:600; margin-bottom:4px;">${_esc(p.baslik)}</div>` : ''}
        <div style="font-size: 13px; line-height: 1.5;">${_esc(p.mesaj)}</div>
        <div class="sap-card-row" style="margin-top: 8px;">
          <span style="font-size:11px; color:${meta.color}">${meta.label}</span>
          ${konumChip}
          <span style="font-size:11px; color:var(--muted);">👍 ${p.begeni_sayisi || 0}</span>
          <span style="font-size:11px; color:var(--muted);">💬 ${p.yorum_sayisi || 0}</span>
          ${isStale ? '<span style="font-size:11px; color:var(--muted);">📜 Süresi geçmiş</span>' : ''}
        </div>
        <div class="sap-card-actions">
          <button class="sap-btn" data-action="pin" data-id="${p.id}" data-next="${!p.pinned}">
            ${p.pinned ? '📌 Pin kaldır' : '📌 Pinle'}
          </button>
          <button class="sap-btn" data-action="delete" data-id="${p.id}" style="color: #ef4444">
            🗑 Sil
          </button>
        </div>
      </div>
    `;
  }

  async function _pinToggle(id, next) {
    if (!id) return;
    try {
      await window.SuruciuPaylasimAPI.pinToggle(id, next);
      await _refreshAll();
      _renderAkis();
    } catch (e) {
      alert('Pinleme hatası: ' + e.message);
    }
  }

  async function _moderateDelete(id) {
    if (!id) return;
    if (!confirm('Bu paylaşımı silmek istiyor musunuz? (Soft delete — feed\'den kaldırılır)')) return;
    try {
      await window.SuruciuPaylasimAPI.softDelete(id);
      await _refreshAll();
      _renderAkis();
    } catch (e) {
      alert('Silme hatası: ' + e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Sekme: DM Trafiği (DECISIONS.md #2 — moderasyon görünümü)
  // ─────────────────────────────────────────────────────────────
  async function _renderDm() {
    const c = _$('sap-content');
    if (!c) return;
    c.innerHTML = '<div class="sap-empty">DM verileri yükleniyor…</div>';
    try {
      const [stats, recent] = await Promise.all([
        window.SuruciuPaylasimAPI.dmStats(),
        window.SuruciuPaylasimAPI.dmList({ limit: 100 })
      ]);
      state.dmStats = stats;
      state.dms = recent;
    } catch (e) {
      c.innerHTML = '<div class="sap-empty">DM verileri çekilemedi: ' + _esc(e.message) + '</div>';
      return;
    }
    const statsHtml = state.dmStats.length === 0
      ? '<div class="sap-empty" style="padding:30px;">Son 30 günde DM yok.</div>'
      : `
        <div class="sap-warning-banner">
          ⚠ Şoförlerin birbirleriyle yazdığı özel mesajları okuyorsunuz. Şoförlere
          bu yetkinin kullanılabileceği bildirilmiştir (DECISIONS.md #2).
        </div>
        <h3 style="font-size:13px; margin: 12px 0 8px;">Konuşma Sayımı (son 30 gün)</h3>
        <div class="sap-card" style="padding:0;">
          ${state.dmStats.slice(0, 20).map(c => `
            <div class="sap-dm-row">
              <div>${_esc(c.ad_a || c.a)}</div>
              <div>${_esc(c.ad_b || c.b)}</div>
              <div style="text-align:right; font-weight:700;">${c.sayim}</div>
            </div>
          `).join('')}
        </div>
        <h3 style="font-size:13px; margin: 18px 0 8px;">Son 100 Mesaj</h3>
        <div class="sap-card" style="padding:0;">
          ${state.dms.slice(0, 100).map(m => `
            <div class="sap-dm-row">
              <div><strong>${_esc(m.gonderen_ad || m.gonderen_user_id.slice(0,8))}</strong> →
                   ${_esc(m.alici_ad || m.alici_user_id.slice(0,8))}</div>
              <div class="sap-dm-msg">"${_esc(m.mesaj.slice(0, 80))}${m.mesaj.length > 80 ? '…' : ''}"</div>
              <div style="text-align:right; color:var(--muted); font-size:11px;">${_fmtZaman(m.created_at)}</div>
            </div>
          `).join('')}
        </div>
      `;
    c.innerHTML = statsHtml;
  }

  // ─────────────────────────────────────────────────────────────
  // Sekme: Duyuru Gönder (yönetici → şoförler)
  // ─────────────────────────────────────────────────────────────
  function _renderDuyuru() {
    const c = _$('sap-content');
    if (!c) return;
    c.innerHTML = `
      <div class="sap-card" style="max-width: 640px;">
        <h2 style="margin: 0 0 12px; font-size: 16px;">📢 Tüm Şoförlere Duyuru</h2>
        <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
          Bu form şoför akışına 📌 pinli bir duyuru paylaşımı oluşturur. Şoförlere otomatik push gider.
          (Karar: DECISIONS.md #6 — kategori='genel', pinned=true, kaynak_rol='yonetici', 👨‍💼 rozet.)
        </p>
        <div class="sap-form-row">
          <label for="sap-duyuru-baslik">Başlık (opsiyonel)</label>
          <input id="sap-duyuru-baslik" type="text" maxlength="80" placeholder="Örn. Yarın liman 8'de açılacak">
        </div>
        <div class="sap-form-row">
          <label for="sap-duyuru-mesaj">Mesaj</label>
          <textarea id="sap-duyuru-mesaj" rows="4" maxlength="500" placeholder="Duyuru içeriği..."></textarea>
        </div>
        <div class="sap-form-row">
          <label for="sap-duyuru-sure">Geçerlilik</label>
          <select id="sap-duyuru-sure">
            <option value="">Default (24 saat — kategori 'genel')</option>
            <option value="2">2 saat</option>
            <option value="12">12 saat</option>
            <option value="24">1 gün</option>
            <option value="168">1 hafta</option>
            <option value="">Kalıcı (NULL — tarih sınırsız)</option>
          </select>
        </div>
        <button class="sap-btn primary" id="sap-duyuru-gonder">📢 Duyuruyu Gönder</button>
        <div id="sap-duyuru-sonuc" style="margin-top:12px; font-size:12px;"></div>
      </div>
    `;
    _$('sap-duyuru-gonder').addEventListener('click', _gonderDuyuru);
  }

  async function _gonderDuyuru() {
    const baslik = (_$('sap-duyuru-baslik')?.value || '').trim();
    const mesaj  = (_$('sap-duyuru-mesaj')?.value || '').trim();
    const sureV  = _$('sap-duyuru-sure')?.value || '';
    const sonuc  = _$('sap-duyuru-sonuc');
    if (!mesaj) {
      sonuc.innerHTML = '<span style="color:#ef4444">Mesaj boş olamaz.</span>';
      return;
    }
    sonuc.innerHTML = 'Gönderiliyor…';
    try {
      const id = await window.SuruciuPaylasimAPI.create({
        kategori:  'genel',
        baslik:    baslik || null,
        mesaj:     mesaj,
        pinned:    true,
        gecerli_saat: sureV ? Number(sureV) : null
      });
      sonuc.innerHTML = '<span style="color:#22c55e">✓ Duyuru gönderildi (id: ' + _esc(String(id || '')) + ')</span>';
      _$('sap-duyuru-baslik').value = '';
      _$('sap-duyuru-mesaj').value = '';
      _$('sap-duyuru-sure').value = '';
    } catch (e) {
      sonuc.innerHTML = '<span style="color:#ef4444">Hata: ' + _esc(e.message) + '</span>';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Export
  // ─────────────────────────────────────────────────────────────
  window.openSuruciuAkisPage = openSuruciuAkisPage;
  window.closeSuruciuAkisPage = closeSuruciuAkisPage;

  if (window.CFG && window.CFG.DEBUG) console.info('[SuruciuAkisPage] hazır — openSuruciuAkisPage()');
})();
