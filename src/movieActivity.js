'use strict';

/**
 * Callista Movie Player & Discord Activity Engine
 *
 * Mengintegrasikan streaming drama (Oppadrama) & anime (Otakudesu) dari "Callista Movie Player",
 * mempertahankan original web layout di Kamar Callista,
 * menyediakan tombol & mode "Activity Mode" (Cinema Nobar VC)
 * dengan sinkronisasi realtime multi-user via WebSocket.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocketServer, WebSocket } = require('ws');

// File konfigurasi domain scraper
const CONFIG_FILE = path.resolve(__dirname, '../data/movie_config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[MOVIE] Error reading movie_config.json:', e.message);
  }
  return {
    domainDrama: 'https://oppadrama.io',
    domainAnime: 'https://otakudesu.blog'
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[MOVIE] Error saving movie_config.json:', e.message);
    return false;
  }
}

/* ============================================================
   HELPER: Image Proxy URL Generator (Bypass Discord CSP & Anti-Hotlinking)
   ============================================================ */
function proxyImg(imgUrl) {
  if (!imgUrl || typeof imgUrl !== 'string') {
    return 'https://placehold.co/240x340/EDE9FE/9CA3AF?text=No+Poster';
  }
  if (imgUrl.startsWith('/assets/') || imgUrl.startsWith('data:') || imgUrl.startsWith('/image-proxy')) {
    return imgUrl;
  }
  return `/image-proxy?url=${encodeURIComponent(imgUrl)}`;
}

/* ============================================================
   HELPER: Fetch HTML dengan headers browser-like
   ============================================================ */
const fetchHtml = async (url, referer) => {
  const cfg = loadConfig();
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
      'Referer': referer || (url.includes('otakudesu') ? cfg.domainAnime + '/' : cfg.domainDrama + '/')
    },
    timeout: 15000
  });
  return data;
};

/* ============================================================
   DETEKSI TIPE HALAMAN
   ============================================================ */
function detectPageType($, targetUrl, mode) {
  if (mode === 'anime') {
    if (targetUrl.includes('/episode/') || $('#pembed, .responsive-embed-stream').length > 0) {
      return 'player';
    }
    if (targetUrl.includes('/anime/') && $('.infozingle, .fotoanime, .episodelist').length > 0) {
      return 'series';
    }
    return 'catalog';
  } else {
    const hasPlayer = $('select.mirror, #pembed, .video-content, #embed_holder').length > 0
      || ($('iframe').length > 0 && ($('.naveps, .episodelist').length > 0));

    if (hasPlayer) return 'player';

    const hasQueryFilter = /[?&](status|country|type|order|s)/.test(targetUrl);
    const hasSingleSeriesIndicators = $('.eplister, .seriestumed, .infox .spe').length > 0;
    const hasArchiveCards = $('.listupd .bsx, .listupd article').length > 0;

    if (!hasQueryFilter && hasSingleSeriesIndicators && !hasArchiveCards) return 'series';

    return 'catalog';
  }
}

/* ============================================================
   SCRAPER: Sidebar Data per Mode
   ============================================================ */
async function scrapeSidebar(mode) {
  const cfg = loadConfig();
  if (mode === 'anime') {
    try {
      const html = await fetchHtml(cfg.domainAnime + '/');
      const $ = cheerio.load(html);

      const navMenu = [
        { name: '🔥 Ongoing Anime', url: `${cfg.domainAnime}/ongoing-anime/` },
        { name: '🏆 Complete Anime', url: `${cfg.domainAnime}/complete-anime/` },
        { name: '📜 Daftar Anime (A-Z)', url: `${cfg.domainAnime}/anime-list/` },
        { name: '📅 Jadwal Rilis', url: `${cfg.domainAnime}/jadwal-rilis/` }
      ];

      const genres = [];
      const seenG = new Set();
      $('a[href*="/genres/"]').each((i, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href') || '';
        if (name && href && !seenG.has(name.toLowerCase())) {
          seenG.add(name.toLowerCase());
          genres.push({ name, href });
        }
      });

      const ongoing = [];
      $('.venz li, .detpost').slice(0, 10).each((i, el) => {
        const title = $(el).find('.jdlflm').text().replace(/\s+/g, ' ').trim() || $(el).find('h2, h3').text().trim();
        const link = $(el).find('a').first().attr('href') || '';
        const img = $(el).find('img').attr('src') || '';
        const ep = $(el).find('.epz').text().replace(/\s+/g, ' ').trim();
        if (title && link) ongoing.push({ title, link, img, ep });
      });

      return { navMenu, genres: genres.slice(0, 20), ongoing };
    } catch (e) {
      console.error('[MOVIE] Anime sidebar scrape error:', e.message);
      return { navMenu: [], genres: [], ongoing: [] };
    }
  } else {
    try {
      const html = await fetchHtml(cfg.domainDrama + '/');
      const $ = cheerio.load(html);

      const navMenu = [
        { name: '🔥 Ongoing Drama', url: `${cfg.domainDrama}/series/?status=Ongoing&type=&order=update` },
        { name: '🏆 Completed Drama', url: `${cfg.domainDrama}/series/?status=Completed&type=Drama&order=update` }
      ];

      const countries = [
        { name: '🇰🇷 Drama Korea',    url: `${cfg.domainDrama}/series/?country%5B%5D=south-korea&status=&type=Drama&order=update` },
        { name: '🇨🇳 Drama China',    url: `${cfg.domainDrama}/series/?country%5B%5D=china&type=Drama&order=update` },
        { name: '🇯🇵 Drama Japan',    url: `${cfg.domainDrama}/series/?country%5B%5D=japan&type=Drama&order=update` },
        { name: '🇹🇭 Drama Thailand', url: `${cfg.domainDrama}/series/?country%5B%5D=thailand&status=&type=Drama&order=update` },
        { name: '🇹🇼 Drama Taiwan',   url: `${cfg.domainDrama}/series/?country%5B%5D=taiwan&status=&type=Drama&order=update` },
        { name: '🇵🇭 Drama Filipina', url: `${cfg.domainDrama}/series/?country%5B%5D=philippines&type=Drama&order=update` },
        { name: '🇺🇸 Drama Barat',   url: `${cfg.domainDrama}/series/?country%5B%5D=usa&type=Drama&order=update` },
        { name: '🍿 Netflix',        url: `${cfg.domainDrama}/network/netflix/` }
      ];

      const genres = [];
      const seenG = new Set();
      $('a[href*="/genres/"]').each((i, el) => {
        const name = $(el).text().trim();
        const href = $(el).attr('href') || '';
        if (name && href && !seenG.has(name.toLowerCase())) {
          seenG.add(name.toLowerCase());
          genres.push({ name, href });
        }
      });

      const onAir = [];
      $('#sidebar .serieslist li, #sidebar li.ntli').each((i, el) => {
        const title = $(el).find('.ntitle, h4, .ltx').text().replace(/\s+/g,' ').trim();
        const ep    = $(el).find('.nftitle, .lxtes').text().replace(/\s+/g,' ').trim();
        const link  = $(el).find('a').first().attr('href') || '';
        const img   = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
        if (title && link) onAir.push({ title, ep, link, img });
      });

      return { navMenu, countries, genres: genres.slice(0, 20), onAir };
    } catch (e) {
      console.error('[MOVIE] Drama sidebar scrape error:', e.message);
      return { navMenu: [], countries: [], genres: [], onAir: [] };
    }
  }
}

/* ============================================================
   RENDER HELPER: Sidebar HTML
   ============================================================ */
function renderSidebar(sidebar, mode, activeCat = '') {
  return `
    <aside class="app-sidebar" id="appSidebar">
      <button class="sidebar-close-btn" onclick="toggleSidebar()" aria-label="Tutup Sidebar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <!-- SWITCHER DI SIDEBAR -->
      <div class="sidebar-block sb-mode-block">
        <div class="sb-section-label">Pilih Mode Tontonan</div>
        <div class="sb-mode-selector">
          <a href="/" class="sb-mode-pill ${mode==='home'?'active':''}">
            <span class="pill-emoji">🏠</span>
            <span>Kamar Utama</span>
            ${mode==='home'?'<span class="active-dot"></span>':''}
          </a>
          <a href="/?mode=drama" class="sb-mode-pill ${mode==='drama'?'active':''}">
            <span class="pill-emoji">🎬</span>
            <span>Ruang Drama</span>
            ${mode==='drama'?'<span class="active-dot"></span>':''}
          </a>
          <a href="/?mode=anime" class="sb-mode-pill ${mode==='anime'?'active':''}">
            <span class="pill-emoji">🌸</span>
            <span>Ruang Anime (Otakudesu)</span>
            ${mode==='anime'?'<span class="active-dot"></span>':''}
          </a>
          <a href="/?activity=1" class="sb-mode-pill" style="border: 1px dashed var(--lav);">
            <span class="pill-emoji">🎦</span>
            <span>Nobar VC (Activity)</span>
          </a>
        </div>
      </div>

      <!-- MENU UTAMA -->
      <div class="sidebar-block">
        <div class="sb-section-label">Menu ${mode === 'anime' ? 'Anime' : 'Drama'}</div>
        <nav class="sb-nav-list">
          <a href="/?mode=${mode}" class="sb-nav-item ${!activeCat?'active':''}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Koleksi Terbaru
          </a>
          ${(sidebar.navMenu || []).map(m => `
            <a href="/?mode=${mode}&cat=${encodeURIComponent(m.url)}" class="sb-nav-item ${activeCat===m.url?'active':''}">
              ${m.name}
            </a>
          `).join('')}
        </nav>
      </div>

      <!-- NEGARA (Drama) -->
      ${mode === 'drama' && sidebar.countries ? `
        <div class="sidebar-block">
          <div class="sb-section-label">Drama per Negara</div>
          <nav class="sb-nav-list">
            ${sidebar.countries.map(c => `
              <a href="/?mode=drama&cat=${encodeURIComponent(c.url)}" class="sb-nav-item ${activeCat===c.url?'active':''}">
                ${c.name}
              </a>
            `).join('')}
          </nav>
        </div>
      ` : ''}

      <!-- GENRE -->
      ${sidebar.genres && sidebar.genres.length > 0 ? `
        <div class="sidebar-block">
          <div class="sb-section-label">Genre ${mode === 'anime' ? 'Anime' : 'Drama'}</div>
          <div class="sb-genre-cloud">
            ${sidebar.genres.map(g => `
              <a href="/?mode=${mode}&cat=${encodeURIComponent(g.href)}" class="sb-genre-pill">${g.name}</a>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- WIDGET TAMBAHAN -->
      ${mode === 'drama' && sidebar.onAir && sidebar.onAir.length > 0 ? `
        <div class="sidebar-block">
          <div class="sb-section-label">📺 Sedang Tayang</div>
          <div class="sb-mini-list">
            ${sidebar.onAir.slice(0, 8).map(item => `
              <a href="/?mode=drama&url=${encodeURIComponent(item.link)}" class="sb-mini-item">
                <div class="sb-mini-thumb">
                  <img src="${proxyImg(item.img)}" alt="${item.title}" loading="lazy"
                    onerror="this.src='https://placehold.co/60x80/E8ECF8/9CA3AF?text=?'"/>
                </div>
                <div class="sb-mini-info">
                  <span class="sb-mini-title">${item.title}</span>
                  ${item.ep ? `<span class="sb-mini-ep">${item.ep}</span>` : ''}
                </div>
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${mode === 'anime' && sidebar.ongoing && sidebar.ongoing.length > 0 ? `
        <div class="sidebar-block">
          <div class="sb-section-label">🔥 Sedang Tayang (Ongoing)</div>
          <div class="sb-mini-list">
            ${sidebar.ongoing.slice(0, 8).map(item => `
              <a href="/?mode=anime&url=${encodeURIComponent(item.link)}" class="sb-mini-item">
                ${item.img ? `
                  <div class="sb-mini-thumb">
                    <img src="${proxyImg(item.img)}" alt="${item.title}" loading="lazy"/>
                  </div>
                ` : ''}
                <div class="sb-mini-info">
                  <span class="sb-mini-title">${item.title}</span>
                  ${item.ep ? `<span class="sb-mini-ep">${item.ep}</span>` : ''}
                </div>
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </aside>
  `;
}

/* ============================================================
   RENDER HELPER: Panel Episode (Player Page)
   ============================================================ */
function renderEpisodePanel(episodeList, currentUrl, mode) {
  if (!episodeList.length) return '';
  return `
    <aside class="episode-panel" id="episodePanel">
      <div class="ep-panel-header">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/>
        </svg>
        <span>Episode</span>
        <span class="ep-panel-count">${episodeList.length}</span>
        <button class="ep-close-btn" onclick="toggleEpisodePanel()" title="Tutup Episode">&times;</button>
      </div>
      <div class="ep-panel-scroll">
        <div class="ep-grid-blocks">
          ${episodeList.map(ep => `
            <a href="/?mode=${mode}&url=${encodeURIComponent(ep.epLink)}"
               class="ep-num-box ${ep.isCurrent ? 'current' : ''}"
               title="${ep.epTitle.replace(/"/g, '&quot;')}">${ep.epNum || '?'}</a>
          `).join('')}
        </div>
      </div>
    </aside>
  `;
}

/* ============================================================
   RENDER: HALAMAN UTAMA / DEPAN "KAMAR CALLISTA"
   (Original Layout dipertahankan + Tombol Mode Activity & Dashboard)
   ============================================================ */
function renderKamarHome(isActivity = false) {
  return `
    <div class="kamar-immersive-screen">
      <!-- Overlay tipis lembut, mempertahankan gambar kamar tetap tajam -->
      <div class="kamar-gentle-overlay"></div>

      <!-- Kontrol Pojok Kanan Atas di Kamar -->
      <div class="kamar-top-controls">
        ${!isActivity ? `
        <a href="/settings" class="kamar-ctrl-btn" title="Buka Dashboard Pengaturan Bot Callista">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>Dashboard Bot</span>
        </a>` : ''}
        <button class="kamar-ctrl-btn" onclick="openSettingsModal()" title="Pengaturan Domain Scraper">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span>Domain Scraper</span>
        </button>
        <button class="kamar-ctrl-btn" onclick="toggleTheme()" id="kamarThemeBtn">
          <span>🌙/☀️</span>
          <span>Tema</span>
        </button>
      </div>

      <!-- Konten Utama: Mengapung Elegan Tanpa Card Tebal -->
      <div class="kamar-floating-hero">
        <div class="callista-photo-holder">
          <img src="/assets/callista_profile.jpg" alt="Callista" class="callista-avatar">
          <span class="callista-status-badge">
            <span>✨</span> Kamar Callista
          </span>
        </div>

        <div class="kamar-hero-details">
          <div class="kamar-branding-row">
            <img src="/assets/tittle.png" alt="Logo" class="kamar-logo-icon">
            <h1 class="kamar-title-text">Kamar Callista</h1>
          </div>

          <p class="kamar-desc-text">
            Selamat datang di ruang santai pribadiku! Di sini kamu bisa menikmati streaming Drama Asia favorit dan Anime sub Indo dalam nuansa warna pastel yang lembut, bebas dari iklan pop-up yang mengganggu, serta pemutar yang mulus. Silakan pilih ruang yang ingin kamu tuju:
          </p>

          <div class="kamar-actions-row">
            <a href="/?mode=drama" class="kamar-portal-btn btn-drama-portal">
              <span style="font-size:1.3rem">🎬</span>
              <span>Masuk ke Ruang Drama</span>
            </a>
            <a href="/?mode=anime" class="kamar-portal-btn btn-anime-portal">
              <span style="font-size:1.3rem">🌸</span>
              <span>Masuk ke Ruang Anime</span>
            </a>
          </div>
        </div>
      </div>

      <!-- Bottom Bar -->
      <div class="kamar-bottom-bar">
        <span>Kamar Callista &bull; Ruang Nonton Santai &bull; 2026</span>
      </div>
    </div>
  `;
}

/* ============================================================
   MASTER TEMPLATE (PASTEL SMOOTH DENGAN MODAL & ACTIVITY SYNC)
   ============================================================ */
function masterLayout({ title, sidebarHtml = '', contentHtml, episodePanelHtml = '', pageType = 'catalog', searchQuery = '', mode = 'drama', isActivity = false }) {
  const isAnime = mode === 'anime';
  const isHome  = mode === 'home';
  const cfg     = loadConfig();

  return `<!DOCTYPE html>
<html lang="id" data-theme="light" data-mode="${mode}" data-palette="lavender" class="${isActivity ? 'activity-mode-on' : ''}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; frame-src *; connect-src *;">
  <title>${title} — Kamar Callista</title>
  <link rel="icon" type="image/png" href="/assets/tittle.png">
  <link rel="apple-touch-icon" href="/assets/tittle.png">
  
  <!-- Font dengan fallback non-blocking agar Discord Desktop tidak hang/layar putih -->
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" media="print" onload="this.media='all'">
  <!-- Discord Embedded App SDK: Bundle Resmi & Standalone Handshake -->
  <script src="/assets/discord-sdk.js"></script>
  <script src="/assets/discord-sdk-handshake.js"></script>
  <script>
    (async function initOfficialDiscordSdk() {
      if (typeof window === 'undefined') return;
      const sp = new URLSearchParams(window.location.search);
      const frameId = sp.get('frame_id') || (function() { try { return sessionStorage.getItem('dc_frame_id'); } catch (_) { return null; } })();
      if (!frameId) return;
      const clientId = sp.get('client_id') || (function() { try { return sessionStorage.getItem('dc_client_id'); } catch (_) { return null; } })() || '1561650922281762836';
      if (window.DiscordSDK && window.DiscordSDK.DiscordSDK) {
        try {
          const sdk = new window.DiscordSDK.DiscordSDK(clientId);
          await sdk.ready();
          console.log('[DISCORD_SDK] Official SDK ready signal sent to Discord Desktop/Web!');
        } catch (e) {
          console.warn('[DISCORD_SDK] SDK ready warning:', e.message || e);
        }
      }
    })();
  </script>
  <style>
    /* ═══════════════════════════════════════════════════════
       DESIGN TOKENS — KAMAR CALLISTA PASTEL SMOOTH
    ═══════════════════════════════════════════════════════ */
    :root {
      --font: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;

      --bg            : #F6F7FD;
      --bg-mesh       : radial-gradient(ellipse at 10% 10%, rgba(224,231,255,.75) 0%, transparent 45%),
                        radial-gradient(ellipse at 90% 85%, rgba(254,226,226,.6) 0%, transparent 45%),
                        radial-gradient(ellipse at 50% 50%, rgba(245,235,255,.45) 0%, transparent 50%),
                        #F6F7FD;
      --surface       : #FFFFFF;
      --surface-soft  : #F1F3FB;
      --surface-glass : rgba(255,255,255,.88);

      --border        : rgba(220,228,250,.9);
      --border-hover  : rgba(166,164,255,.55);

      --txt-1 : #23273D;
      --txt-2 : #646C82;
      --txt-3 : #9EA8BC;

      --lav     : #7B73F0;
      --lav-l   : #EDECFF;
      --lav-d   : #5E56D1;

      --peach   : #FF8F94;
      --peach-l : #FFF0F1;

      --sakura  : #FA759F;
      --sakura-l: #FFEBF2;

      --mint    : #2FC87A;
      --mint-l  : #E6F9F1;

      --sky     : #3B82F6;
      --sky-l   : #E0F2FE;

      --gold    : #F59E0B;
      --gold-l  : #FEF3C7;

      --mode-accent   : ${isAnime ? 'var(--sakura)' : 'var(--lav)'};
      --mode-accent-l : ${isAnime ? 'var(--sakura-l)' : 'var(--lav-l)'};

      --r-sm  : 10px;
      --r-md  : 16px;
      --r-lg  : 22px;
      --r-xl  : 28px;
      --r-pill: 9999px;

      --sh-sm : 0 2px 8px rgba(123,115,240,.06);
      --sh-md : 0 8px 28px rgba(123,115,240,.09), 0 2px 8px rgba(0,0,0,.03);
      --sh-lg : 0 18px 40px rgba(123,115,240,.13), 0 4px 14px rgba(0,0,0,.04);
      --sh-glow: 0 0 0 3px rgba(123,115,240,.18);

      --ease  : cubic-bezier(.16,1,.3,1);
      --dur   : 240ms;

      --sidebar-w  : 260px;
      --ep-panel-w : 310px;
      --navbar-h   : 68px;
    }

    [data-theme="dark"] {
      --bg            : #0E0F18;
      --bg-mesh       : radial-gradient(ellipse at 10% 15%, rgba(65,55,130,.32) 0%, transparent 45%),
                        radial-gradient(ellipse at 90% 85%, rgba(110,40,75,.25) 0%, transparent 45%),
                        #0E0F18;
      --surface       : #171926;
      --surface-soft  : #212336;
      --surface-glass : rgba(23,25,38,.9);

      --border        : rgba(255,255,255,.09);
      --border-hover  : rgba(165,155,255,.45);

      --txt-1 : #EEF0F8;
      --txt-2 : #9BA3BC;
      --txt-3 : #616780;

      --lav     : #9B94FF;
      --lav-l   : rgba(155,148,255,.15);
      --peach   : #FFB0B5;
      --peach-l : rgba(255,176,181,.15);
      --sakura  : #FF85B3;
      --sakura-l: rgba(255,133,179,.16);

      --mint    : #5CD498;
      --mint-l  : rgba(92,212,152,.14);
      --sky     : #60A5FA;
      --sky-l   : rgba(96,165,250,.14);

      --sh-sm : 0 2px 8px rgba(0,0,0,.3);
      --sh-md : 0 8px 28px rgba(0,0,0,.45);
      --sh-lg : 0 18px 40px rgba(0,0,0,.6);
    }

    /* Pilihan Palet Warna Kustom */
    [data-palette="sakura"] { --mode-accent: #FA759F; --mode-accent-l: #FFEBF2; }
    [data-palette="mint"]   { --mode-accent: #2FC87A; --mode-accent-l: #E6F9F1; }
    [data-palette="peach"]  { --mode-accent: #FF8F94; --mode-accent-l: #FFF0F1; }
    [data-palette="sky"]    { --mode-accent: #3B82F6; --mode-accent-l: #E0F2FE; }

    *,*::before,*::after { box-sizing:border-box; margin:0; padding:0 }
    html { scroll-behavior: smooth }

    body {
      font-family: var(--font);
      background: var(--bg);
      background-image: var(--bg-mesh);
      background-attachment: fixed;
      color: var(--txt-1);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    a { text-decoration:none; color:inherit }
    img { display:block; max-width:100% }
    button, input { font-family:inherit }

    /* ════════════════════════════════
       NAVBAR
    ════════════════════════════════ */
    .navbar {
      position: sticky; top:0; z-index:200;
      height: var(--navbar-h);
      background: var(--surface-glass);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center;
      padding: 0 24px;
      gap: 16px;
      transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
    }

    .nav-left { display: flex; align-items: center; gap: 12px; }
    .nav-toggle-btn {
      width: 40px; height: 40px; border-radius: var(--r-md);
      border: 1px solid var(--border); background: var(--surface);
      color: var(--txt-1); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all var(--dur) var(--ease);
    }
    .nav-toggle-btn:hover { background: var(--surface-soft); border-color: var(--border-hover); }

    .brand-link { display: flex; align-items: center; gap: 10px; }
    .brand-icon {
      width: 36px; height: 36px; border-radius: var(--r-md);
      display: flex; align-items: center; justify-content: center;
      background: var(--mode-accent-l); color: var(--mode-accent);
      font-size: 1.15rem; flex-shrink: 0;
    }
    .brand-text { display: flex; flex-direction: column; }
    .brand-title { font-weight: 700; font-size: 1.05rem; letter-spacing: -0.02em; line-height: 1.2; }
    .brand-sub { font-size: 0.73rem; color: var(--txt-2); font-weight: 500; }

    /* Mode Switcher Pills */
    .mode-pills {
      display: flex; align-items: center; background: var(--surface-soft);
      border: 1px solid var(--border); border-radius: var(--r-pill);
      padding: 4px; gap: 2px;
    }
    .mode-pill {
      padding: 6px 14px; border-radius: var(--r-pill); font-size: 0.82rem; font-weight: 600;
      color: var(--txt-2); transition: all var(--dur) var(--ease); display: flex; align-items: center; gap: 6px;
    }
    .mode-pill:hover { color: var(--txt-1); }
    .mode-pill.active {
      background: var(--surface); color: var(--mode-accent);
      box-shadow: var(--sh-sm); border: 1px solid var(--border);
    }

    /* Search Box */
    .nav-search {
      flex: 1; max-width: 440px; position: relative;
    }
    .nav-search form { display: flex; align-items: center; }
    .search-input {
      width: 100%; height: 42px; border-radius: var(--r-pill);
      border: 1px solid var(--border); background: var(--surface);
      color: var(--txt-1); padding: 0 42px 0 16px; font-size: 0.88rem;
      transition: all var(--dur) var(--ease);
    }
    .search-input:focus { outline: none; border-color: var(--mode-accent); box-shadow: var(--sh-glow); }
    .search-btn {
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
      width: 30px; height: 30px; border-radius: var(--r-pill); border: none;
      background: transparent; color: var(--txt-3); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: color var(--dur) var(--ease);
    }
    .search-btn:hover { color: var(--mode-accent); }

    .nav-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
    .nav-icon-btn {
      height: 40px; padding: 0 12px; border-radius: var(--r-md);
      border: 1px solid var(--border); background: var(--surface);
      color: var(--txt-1); cursor: pointer; font-size: 0.82rem; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
      transition: all var(--dur) var(--ease);
    }
    .nav-icon-btn:hover { background: var(--surface-soft); border-color: var(--border-hover); }

    .btn-act-toggle {
      background: linear-gradient(135deg, #7B73F0, #5865F2);
      color: #fff !important;
      border: none;
      box-shadow: 0 2px 10px rgba(88,101,242,0.3);
    }
    .btn-act-toggle:hover { opacity: 0.95; transform: translateY(-1px); }

    /* ════════════════════════════════
       APP LAYOUT WRAPPER
    ════════════════════════════════ */
    .app-layout {
      display: flex; width: 100%; min-height: calc(100vh - var(--navbar-h));
      position: relative;
    }
    .app-main {
      flex: 1; min-width: 0; padding: 24px 32px 60px;
      transition: padding var(--dur) var(--ease);
    }

    /* ════════════════════════════════
       SIDEBAR
    ════════════════════════════════ */
    .app-sidebar {
      width: var(--sidebar-w); background: var(--surface);
      border-right: 1px solid var(--border); flex-shrink: 0;
      padding: 20px 16px; overflow-y: auto; height: calc(100vh - var(--navbar-h));
      position: sticky; top: var(--navbar-h); display: flex; flex-direction: column; gap: 20px;
      transition: transform var(--dur) var(--ease);
    }
    .sidebar-close-btn { display: none; }
    .sidebar-block { display: flex; flex-direction: column; gap: 10px; }
    .sb-section-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--txt-3); }
    .sb-mode-selector { display: flex; flex-direction: column; gap: 6px; }
    .sb-mode-pill {
      display: flex; align-items: center; gap: 10px; padding: 8px 12px;
      border-radius: var(--r-md); font-size: 0.85rem; font-weight: 600; color: var(--txt-2);
      border: 1px solid transparent; transition: all var(--dur) var(--ease);
    }
    .sb-mode-pill:hover { background: var(--surface-soft); color: var(--txt-1); }
    .sb-mode-pill.active { background: var(--mode-accent-l); color: var(--mode-accent); border-color: var(--border); }
    .active-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mode-accent); margin-left: auto; }

    .sb-nav-list { display: flex; flex-direction: column; gap: 4px; }
    .sb-nav-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 12px;
      border-radius: var(--r-md); font-size: 0.83rem; font-weight: 500; color: var(--txt-2);
      transition: all var(--dur) var(--ease);
    }
    .sb-nav-item:hover { background: var(--surface-soft); color: var(--txt-1); }
    .sb-nav-item.active { background: var(--surface-soft); color: var(--mode-accent); font-weight: 700; }

    .sb-genre-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
    .sb-genre-pill {
      padding: 4px 10px; border-radius: var(--r-pill); font-size: 0.76rem;
      background: var(--surface-soft); color: var(--txt-2); border: 1px solid var(--border);
      transition: all var(--dur) var(--ease);
    }
    .sb-genre-pill:hover { border-color: var(--mode-accent); color: var(--mode-accent); }

    .sb-mini-list { display: flex; flex-direction: column; gap: 8px; }
    .sb-mini-item {
      display: flex; align-items: center; gap: 10px; padding: 6px 8px;
      border-radius: var(--r-md); transition: background var(--dur) var(--ease);
    }
    .sb-mini-item:hover { background: var(--surface-soft); }
    .sb-mini-thumb { width: 44px; height: 58px; border-radius: var(--r-sm); overflow: hidden; flex-shrink: 0; }
    .sb-mini-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .sb-mini-info { display: flex; flex-direction: column; min-width: 0; }
    .sb-mini-title { font-size: 0.8rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sb-mini-ep { font-size: 0.72rem; color: var(--txt-3); }

    /* ════════════════════════════════
       CATALOG / CARDS VIEW
    ════════════════════════════════ */
    .catalog-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .catalog-title { font-size: 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .count-badge { padding: 4px 10px; border-radius: var(--r-pill); background: var(--surface-soft); font-size: 0.78rem; font-weight: 600; color: var(--txt-2); border: 1px solid var(--border); }

    .drama-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 20px;
    }
    .drama-card {
      display: flex; flex-direction: column; border-radius: var(--r-lg);
      background: var(--surface); border: 1px solid var(--border); overflow: hidden;
      box-shadow: var(--sh-sm); transition: all var(--dur) var(--ease); position: relative;
    }
    .drama-card:hover { transform: translateY(-4px); box-shadow: var(--sh-md); border-color: var(--border-hover); }
    .card-thumb { position: relative; aspect-ratio: 5/7; overflow: hidden; background: var(--surface-soft); }
    .card-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--dur) var(--ease); }
    .drama-card:hover .card-thumb img { transform: scale(1.04); }

    .card-tags-top { position: absolute; top: 8px; left: 8px; right: 8px; display: flex; justify-content: space-between; gap: 6px; pointer-events: none; }
    .tag { padding: 3px 8px; border-radius: var(--r-pill); font-size: 0.7rem; font-weight: 700; backdrop-filter: blur(8px); }
    .tag-type { background: rgba(0,0,0,0.65); color: #fff; }
    .tag-sub  { background: rgba(123,115,240,0.9); color: #fff; }

    .card-ep-badge { position: absolute; bottom: 8px; right: 8px; }
    .tag-ep { padding: 3px 8px; border-radius: var(--r-pill); font-size: 0.72rem; font-weight: 700; background: rgba(0,0,0,0.7); color: #fff; }

    .card-hover-play {
      position: absolute; inset: 0; background: rgba(0,0,0,0.3); display: flex;
      align-items: center; justify-content: center; opacity: 0; transition: opacity var(--dur) var(--ease);
    }
    .drama-card:hover .card-hover-play { opacity: 1; }
    .play-ring {
      width: 46px; height: 46px; border-radius: 50%; background: var(--mode-accent);
      color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: var(--sh-md);
    }

    .card-caption { padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
    .card-title { font-size: 0.88rem; font-weight: 600; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .card-time { font-size: 0.72rem; color: var(--txt-3); }

    /* Pagination */
    .pagination { display: flex; justify-content: center; align-items: center; gap: 6px; margin-top: 36px; }
    .pg-btn {
      min-width: 38px; height: 38px; padding: 0 12px; border-radius: var(--r-md);
      display: flex; align-items: center; justify-content: center; font-size: 0.83rem; font-weight: 600;
      background: var(--surface); border: 1px solid var(--border); color: var(--txt-2); transition: all var(--dur) var(--ease);
    }
    .pg-btn:hover { border-color: var(--mode-accent); color: var(--mode-accent); }
    .pg-btn.active { background: var(--mode-accent); color: #fff; border-color: var(--mode-accent); }
    .pg-btn.dots { border: none; background: transparent; }

    /* ════════════════════════════════
       PLAYER CARD & VIDEO FRAME
    ════════════════════════════════ */
    .player-main { display: flex; flex-direction: column; gap: 16px; }
    .player-breadcrumb { display: flex; align-items: center; gap: 12px; }
    .back-link {
      display: flex; align-items: center; gap: 6px; font-size: 0.85rem; font-weight: 600;
      color: var(--txt-2); padding: 6px 12px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--border);
    }
    .back-link:hover { color: var(--mode-accent); border-color: var(--mode-accent); }
    .player-page-title { font-size: 1.25rem; font-weight: 700; line-height: 1.3; }

    .player-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--r-xl); overflow: hidden; box-shadow: var(--sh-md);
    }
    .player-topbar {
      padding: 12px 18px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
    }
    .server-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .server-lbl { font-size: 0.78rem; font-weight: 700; color: var(--txt-3); display: flex; align-items: center; gap: 6px; text-transform: uppercase; }
    .srv-btn {
      padding: 6px 12px; border-radius: var(--r-pill); border: 1px solid var(--border);
      background: var(--surface-soft); color: var(--txt-2); font-size: 0.8rem; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all var(--dur) var(--ease);
    }
    .srv-btn:hover { color: var(--txt-1); border-color: var(--border-hover); }
    .srv-btn.active { background: var(--mode-accent); color: #fff; border-color: var(--mode-accent); }

    .action-row { display: flex; align-items: center; gap: 6px; }
    .act-btn {
      padding: 6px 12px; border-radius: var(--r-pill); border: 1px solid var(--border);
      background: var(--surface-soft); color: var(--txt-2); font-size: 0.78rem; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; gap: 5px; transition: all var(--dur) var(--ease);
    }
    .act-btn:hover { background: var(--surface); color: var(--txt-1); border-color: var(--border-hover); }
    .act-btn.on { background: var(--mode-accent-l); color: var(--mode-accent); border-color: var(--mode-accent); }

    .video-box { position: relative; width: 100%; aspect-ratio: 16/9; background: #000; overflow: hidden; }
    /* Loading overlay: tittle.png di tengah cincin spinner */
    .video-loader {
      position: absolute; inset: 0; background: rgba(0,0,0,0.9); display: flex;
      flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #fff;
      font-size: 0.82rem; font-weight: 500; transition: opacity var(--dur) var(--ease); z-index: 10;
    }
    .loader-logo-wrap {
      position: relative; width: 76px; height: 76px;
      display: flex; align-items: center; justify-content: center;
    }
    .loader-logo-wrap img {
      width: 42px; height: 42px; object-fit: contain; border-radius: 10px; position: relative; z-index: 2;
    }
    .loader-ring {
      position: absolute; inset: 0; border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: var(--mode-accent);
      animation: spin 0.85s linear infinite;
    }
    /* legacy spinner kecil (dipakai di tempat lain jika ada) */
    .spinner { width: 34px; height: 34px; border: 3px solid rgba(255,255,255,0.2); border-top-color: var(--mode-accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    #playerFrame { width: 100%; height: 100%; border: none; display: block; }

    /* Tombol fullscreen native (karena Discord Desktop blokir requestFullscreen di iframe) */
    .video-fullscreen-btn {
      position: absolute; bottom: 8px; right: 8px; z-index: 20;
      background: rgba(0,0,0,0.65); border: none; border-radius: 6px;
      color: #fff; padding: 5px 7px; cursor: pointer; font-size: 0.8rem;
      display: flex; align-items: center; gap: 4px; transition: background 0.15s;
      backdrop-filter: blur(4px);
    }
    .video-fullscreen-btn:hover { background: rgba(0,0,0,0.9); }
    .video-box.fs-active {
      position: fixed !important; inset: 0 !important; top: 0 !important; left: 0 !important;
      right: 0 !important; bottom: 0 !important; z-index: 999999 !important;
      aspect-ratio: unset !important; border-radius: 0 !important;
      width: 100vw !important; height: 100vh !important;
      max-width: 100vw !important; max-height: 100vh !important;
      background: #000 !important; margin: 0 !important; padding: 0 !important;
    }
    .video-box.fs-active #callistaVideo,
    .video-box.fs-active #playerFrame {
      width: 100% !important; height: 100% !important; max-height: 100vh !important;
      border-radius: 0 !important; object-fit: contain !important;
    }
    body.in-fullscreen {
      overflow: hidden !important;
    }
    body.in-fullscreen .navbar,
    body.in-fullscreen .app-sidebar,
    body.in-fullscreen .player-topbar,
    body.in-fullscreen .player-nav-bar,
    body.in-fullscreen .dl-card,
    body.in-fullscreen .activity-sync-bar,
    body.in-fullscreen .activity-ep-floating-btn {
      display: none !important;
    }

    .player-nav-bar {
      padding: 14px 18px; border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    }
    .nav-ep-btn {
      padding: 8px 16px; border-radius: var(--r-pill); border: 1px solid var(--border);
      background: var(--surface-soft); color: var(--txt-1); font-size: 0.82rem; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all var(--dur) var(--ease);
    }
    .nav-ep-btn:hover:not(:disabled) { background: var(--surface); border-color: var(--mode-accent); color: var(--mode-accent); }
    .nav-ep-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .tip-pill { font-size: 0.78rem; color: var(--txt-3); display: flex; align-items: center; gap: 6px; }
    .tip-tag { padding: 2px 6px; border-radius: var(--r-sm); background: var(--gold-l); color: var(--gold); font-weight: 700; font-size: 0.7rem; }

    /* Episode Side Panel — Grid 4 kolom minimalis */
    .episode-panel {
      width: var(--ep-panel-w); background: var(--surface); border-left: 1px solid var(--border);
      height: calc(100vh - var(--navbar-h)); position: sticky; top: var(--navbar-h);
      display: flex; flex-direction: column; flex-shrink: 0;
    }
    .ep-panel-header {
      padding: 16px; border-bottom: 1px solid var(--border); font-size: 0.9rem; font-weight: 700;
      display: flex; align-items: center; gap: 8px;
    }
    .ep-panel-count { padding: 2px 8px; border-radius: var(--r-pill); background: var(--surface-soft); font-size: 0.75rem; margin-left: auto; color: var(--txt-2); }
    .ep-close-btn {
      background: none; border: none; color: var(--txt-3);
      font-size: 1.4rem; line-height: 1; cursor: pointer; padding: 0 4px;
      transition: color var(--dur) var(--ease); display: flex; align-items: center; justify-content: center;
    }
    .ep-close-btn:hover { color: var(--mode-accent); }
    /* Grid blok episode — 4 kolom, angka minimalis */
    .ep-panel-scroll { flex: 1; overflow-y: auto; padding: 10px; }
    .ep-grid-blocks {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .ep-num-box {
      display: flex; align-items: center; justify-content: center;
      height: 36px; border-radius: 8px;
      border: 1px solid var(--border); background: var(--surface-soft);
      font-size: 0.78rem; font-weight: 700; color: var(--txt-2);
      transition: all var(--dur) var(--ease); cursor: pointer;
    }
    .ep-num-box:hover { background: var(--surface); border-color: var(--mode-accent); color: var(--mode-accent); }
    .ep-num-box.current { background: var(--mode-accent); color: #fff; border-color: var(--mode-accent); }
    /* Legacy: .ep-panel-item tetap ada untuk backward compat */
    .ep-panel-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border-radius: var(--r-md); border: 1px solid transparent; background: var(--surface-soft);
      font-size: 0.82rem; font-weight: 500; transition: all var(--dur) var(--ease);
    }
    .ep-panel-item:hover { background: var(--surface); border-color: var(--border-hover); color: var(--mode-accent); }
    .ep-panel-item.current { background: var(--mode-accent-l); color: var(--mode-accent); border-color: var(--mode-accent); font-weight: 700; }
    .ep-num-badge {
      width: 26px; height: 26px; border-radius: var(--r-sm); background: var(--surface);
      display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0;
    }

    /* Downloads */
    .dl-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); padding: 20px; box-shadow: var(--sh-sm); }
    .sec-title { font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .dl-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
    .dl-row {
      display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
      border-radius: var(--r-md); background: var(--surface-soft); border: 1px solid var(--border);
      font-size: 0.82rem; transition: all var(--dur) var(--ease);
    }
    .dl-row:hover { border-color: var(--mode-accent); color: var(--mode-accent); background: var(--surface); }
    .dl-srv { font-weight: 600; }
    .dl-qual { font-size: 0.72rem; padding: 2px 6px; border-radius: var(--r-sm); background: var(--mode-accent-l); color: var(--mode-accent); font-weight: 700; }
    .dl-go { font-size: 0.78rem; font-weight: 600; }

    /* ════════════════════════════════
       SERIES DETAIL VIEW
    ════════════════════════════════ */
    .series-hero { display: flex; gap: 32px; margin-bottom: 32px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); padding: 28px; box-shadow: var(--sh-sm); }
    .series-poster { width: 220px; flex-shrink: 0; border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--sh-md); }
    .series-poster img { width: 100%; height: 100%; object-fit: cover; }
    .series-info { flex: 1; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .badge-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { padding: 4px 10px; border-radius: var(--r-pill); font-size: 0.75rem; font-weight: 700; }
    .badge-status { background: var(--mint-l); color: var(--mint); }
    .badge-type   { background: var(--lav-l); color: var(--lav); }
    .badge-country{ background: var(--sky-l); color: var(--sky); }
    .badge-dur    { background: var(--peach-l); color: var(--peach); }
    .series-title-big { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; }
    .genre-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
    .genre-chip { padding: 4px 12px; border-radius: var(--r-pill); font-size: 0.78rem; background: var(--surface-soft); border: 1px solid var(--border); color: var(--txt-2); }
    .synopsis { font-size: 0.88rem; line-height: 1.6; color: var(--txt-2); }
    .synopsis h4 { font-size: 0.9rem; font-weight: 700; color: var(--txt-1); margin-bottom: 4px; }
    .meta-box { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.82rem; color: var(--txt-2); padding: 14px; border-radius: var(--r-md); background: var(--surface-soft); border: 1px solid var(--border); }
    .meta-box .full { grid-column: span 2; }
    .cta-btn {
      align-self: flex-start; padding: 10px 22px; border-radius: var(--r-pill);
      background: var(--mode-accent); color: #fff; font-size: 0.88rem; font-weight: 700;
      display: flex; align-items: center; gap: 8px; box-shadow: var(--sh-md); transition: opacity var(--dur) var(--ease);
    }
    .cta-btn:hover { opacity: 0.9; }

    .ep-section-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-xl); padding: 24px; box-shadow: var(--sh-sm); }
    .ep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .ep-row {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px;
      border-radius: var(--r-md); background: var(--surface-soft); border: 1px solid var(--border);
      transition: all var(--dur) var(--ease);
    }
    .ep-row:hover { background: var(--surface); border-color: var(--mode-accent); color: var(--mode-accent); }
    .ep-circle { width: 30px; height: 30px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 700; flex-shrink: 0; box-shadow: var(--sh-sm); }
    .ep-row-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .ep-row-title { font-size: 0.85rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ep-row-date { font-size: 0.72rem; color: var(--txt-3); }

    /* ════════════════════════════════
       KAMAR CALLISTA (IMMERSIVE HOME)
    ════════════════════════════════ */
    .kamar-immersive-screen {
      position: fixed; inset: 0; z-index: 999;
      background-color: #0E0F18;
      background-image: url('/assets/kamar.png');
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
      display: flex; flex-direction: column; justify-content: space-between;
      padding: 32px 40px; overflow-y: auto;
    }
    .kamar-gentle-overlay {
      position: absolute; inset: 0;
      background: radial-gradient(circle at center, rgba(14,15,24,0.18) 0%, rgba(14,15,24,0.55) 100%);
      pointer-events: none;
    }
    .kamar-top-controls {
      position: relative; z-index: 10; display: flex; justify-content: flex-end; gap: 12px;
    }
    .kamar-ctrl-btn {
      display: flex; align-items: center; gap: 8px; padding: 10px 18px;
      border-radius: var(--r-pill); border: 1px solid rgba(255,255,255,0.2);
      background: rgba(14,15,24,0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      color: #fff; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all var(--dur) var(--ease);
    }
    .kamar-ctrl-btn:hover { background: rgba(255,255,255,0.2); transform: translateY(-1px); }

    .kamar-floating-hero {
      position: relative; z-index: 10; margin: auto 0;
      display: flex; align-items: center; gap: 36px; max-width: 900px;
      padding: 36px 44px; border-radius: var(--r-xl);
      background: rgba(14,15,24,0.65); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
    .callista-photo-holder { display: flex; flex-direction: column; align-items: center; gap: 12px; flex-shrink: 0; }
    .callista-avatar {
      width: 140px; height: 140px; border-radius: 50%; object-fit: cover;
      border: 4px solid rgba(255,255,255,0.8); box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    }
    .callista-status-badge {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px;
      border-radius: var(--r-pill); background: rgba(255,255,255,0.15); color: #fff;
      font-size: 0.75rem; font-weight: 700;
    }

    .kamar-hero-details { display: flex; flex-direction: column; gap: 16px; color: #fff; }
    .kamar-branding-row { display: flex; align-items: center; gap: 14px; }
    .kamar-logo-icon { width: 42px; height: 42px; object-fit: contain; }
    .kamar-title-text { font-size: 2.2rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; color: #fff; }
    .kamar-desc-text { font-size: 0.92rem; line-height: 1.65; color: rgba(255,255,255,0.85); }
    .kamar-actions-row { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; }
    .kamar-portal-btn {
      display: flex; align-items: center; gap: 10px; padding: 12px 24px;
      border-radius: var(--r-pill); font-size: 0.9rem; font-weight: 700;
      transition: all var(--dur) var(--ease);
    }
    .btn-drama-portal { background: linear-gradient(135deg, #FF8F94, #FA759F); color: #fff; box-shadow: 0 4px 18px rgba(250,117,159,0.35); }
    .btn-anime-portal { background: linear-gradient(135deg, #7B73F0, #5E56D1); color: #fff; box-shadow: 0 4px 18px rgba(123,115,240,0.35); }
    .kamar-portal-btn:hover { transform: translateY(-2px); opacity: 0.95; }
    .kamar-bottom-bar { position: relative; z-index: 10; font-size: 0.75rem; color: rgba(255,255,255,0.45); text-align: center; }

    /* ════════════════════════════════
       DISCORD ACTIVITY MODE (CINEMA & NOBAR)
    ════════════════════════════════ */
    .activity-mode-on {
      --navbar-h: 46px;
    }
    .activity-mode-on {
      --navbar-h: 46px;
    }
    /* Sidebar kiri di mode activity: drawer overlay, tidak menggeser konten */
    html.activity-mode-on .app-sidebar,
    html.activity-mode-on #appSidebar {
      position: fixed !important;
      top: var(--navbar-h) !important;
      left: 0 !important;
      bottom: 0 !important;
      width: 260px !important;
      max-width: 260px !important;
      min-width: unset !important;
      z-index: 1000 !important;
      transform: translateX(-100%) !important;
      transition: transform 0.25s ease !important;
      box-shadow: 4px 0 24px rgba(0,0,0,0.35) !important;
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      overflow-y: auto !important;
      padding: 20px 16px !important;
      margin: 0 !important;
    }
    html.activity-mode-on .app-sidebar.open,
    html.activity-mode-on #appSidebar.open {
      transform: translateX(0) !important;
    }
    /* Backdrop untuk menutup sidebar saat klik di luar (z-index di belakang sidebar & episode panel) */
    .sidebar-backdrop {
      display: none; position: fixed; inset: 0; z-index: 995;
      background: rgba(0,0,0,0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    }
    html.activity-mode-on .sidebar-backdrop.show { display: block; }
    /* Episode panel di activity: overlay dari kanan, berdiri di atas backdrop */
    html.activity-mode-on aside.episode-panel,
    html.activity-mode-on .episode-panel {
      position: fixed !important;
      top: var(--navbar-h) !important;
      right: 0 !important;
      bottom: 0 !important;
      width: var(--ep-panel-w) !important;
      max-width: 90vw !important;
      z-index: 1001 !important;
      transform: translateX(100%) !important;
      transition: transform 0.25s ease !important;
      box-shadow: -4px 0 24px rgba(0,0,0,0.35) !important;
      display: flex !important;
      flex-direction: column !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      border-left: 1px solid var(--border) !important;
      overflow: hidden !important;
    }
    html.activity-mode-on .episode-panel.open {
      transform: translateX(0) !important;
    }
    /* Tombol toggle episode panel di mode activity */
    .ep-toggle-btn {
      display: none;
    }
    html.activity-mode-on .ep-toggle-btn {
      display: flex;
    }
    html.activity-mode-on .app-layout {
      display: block !important;
      grid-template-columns: 1fr !important;
    }
    html.activity-mode-on .app-main {
      padding: 6px 12px 30px !important;
      margin-left: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    .activity-mode-on .player-card { border-radius: 12px; }
    .activity-mode-on .video-box { aspect-ratio: 16/9; max-height: calc(100vh - 110px); }

    /* Ukuran Card di Mode Activity (Super Mini, Ringkas, dan Hemat Tempat untuk Nobar) */
    .activity-mode-on .drama-grid,
    .activity-mode-on .media-grid {
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)) !important;
      gap: 6px !important;
    }
    .activity-mode-on .drama-card,
    .activity-mode-on .media-card {
      border-radius: 6px !important;
      padding: 2px !important;
      box-shadow: none !important;
      border: 1px solid var(--border) !important;
      background: var(--surface) !important;
    }
    .activity-mode-on .card-thumb {
      aspect-ratio: 5/7 !important;
      border-radius: 4px !important;
      height: auto !important;
    }
    .activity-mode-on .card-caption {
      padding: 3px 5px !important;
    }
    .activity-mode-on .card-title {
      font-size: 0.62rem !important;
      line-height: 1.2 !important;
      height: 2.4em !important;
      margin: 2px 0 0 !important;
      -webkit-line-clamp: 2 !important;
    }
    .activity-mode-on .card-tags-top,
    .activity-mode-on .card-ep-badge,
    .activity-mode-on .card-hover-play,
    .activity-mode-on .card-time,
    .activity-mode-on .card-meta {
      display: none !important;
    }
    .activity-mode-on .kamar-hero {
      padding: 8px 12px !important;
      margin-bottom: 6px !important;
      border-radius: 10px !important;
    }
    .activity-mode-on .kamar-hero h1 { font-size: 1.05rem !important; margin-bottom: 2px !important; }
    .activity-mode-on .kamar-hero p { font-size: 0.72rem !important; }
    .activity-mode-on .kamar-portal-grid {
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)) !important;
      gap: 4px !important;
    }
    .activity-mode-on .kamar-portal-btn {
      padding: 6px 8px !important;
      font-size: 0.72rem !important;
      border-radius: 6px !important;
    }

    /* Floating Nobar Live Bar */
    .activity-sync-bar {
      display: none;
      align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 14px; border-radius: var(--r-md); background: rgba(14,15,24,0.92);
      backdrop-filter: blur(16px); color: #fff; margin-bottom: 8px;
      border: 1px solid rgba(88,101,242,0.45); box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      flex-wrap: wrap;
    }
    .activity-mode-on .activity-sync-bar { display: flex; }

    .sync-status-indicator { display: flex; align-items: center; gap: 6px; font-size: 0.76rem; font-weight: 700; }
    .pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: #2ECC71; box-shadow: 0 0 8px #2ECC71; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }

    .role-badge {
      padding: 3px 8px; border-radius: var(--r-pill); font-size: 0.7rem; font-weight: 700;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .role-badge-host { background: linear-gradient(135deg, #F59E0B, #D97706); color: #fff; box-shadow: 0 2px 8px rgba(245,158,11,0.4); }
    .role-badge-viewer { background: rgba(255,255,255,0.14); color: #E0E7FF; border: 1px solid rgba(255,255,255,0.2); }

    .sync-controls-row { display: flex; align-items: center; gap: 4px; }
    .sync-btn {
      padding: 4px 10px; border-radius: var(--r-pill); border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.1); color: #fff; font-size: 0.72rem; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all var(--dur) var(--ease);
    }
    .sync-btn:hover { background: rgba(255,255,255,0.25); }

    .reaction-bar { display: flex; align-items: center; gap: 3px; }
    .react-btn {
      width: 28px; height: 28px; border-radius: 50%; border: none;
      background: rgba(255,255,255,0.12); font-size: 0.9rem; cursor: pointer;
      display: flex; align-items: center; justify-content: center; transition: transform 0.15s;
    }
    .react-btn:hover { transform: scale(1.2); }
    .react-btn:active { transform: scale(0.9); }

    /* Viewer Toast / Notification */
    .sync-toast {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(17,24,39,0.92); backdrop-filter: blur(8px);
      color: #fff; border: 1px solid rgba(123,115,240,0.5);
      padding: 6px 16px; border-radius: var(--r-pill); font-size: 0.75rem;
      font-weight: 600; z-index: 10000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: none; animation: fadeInToast 0.3s ease;
    }
    @keyframes fadeInToast { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }

    /* Proteksi Mutlak Penonton (ReadOnly Mode) — Penonton tidak bisa mengacak-acak tayangan */
    body.is-viewer a[href],
    body.is-viewer .media-card,
    body.is-viewer .drama-card,
    body.is-viewer .ep-panel-item,
    body.is-viewer .ep-num-box,
    body.is-viewer .nav-ep-btn,
    body.is-viewer .srv-btn,
    body.is-viewer .kamar-portal-btn {
      pointer-events: none !important;
      cursor: default !important;
    }
    /* Sembunyikan search bar untuk viewer — viewer dilarang mengubah UI */
    body.is-viewer .nav-search {
      display: none !important;
    }

    /* Khusus Mode Activity: Sembunyikan semua tombol unduh, daftar unduhan, dan dashboard bot */
    html.activity-mode-on .dl-card,
    html.activity-mode-on .dl-list,
    html.activity-mode-on .download-section,
    html.activity-mode-on [class*="dl-card"],
    html.activity-mode-on [class*="download"],
    html.activity-mode-on a[href="/settings"],
    html.activity-mode-on .kamar-ctrl-btn[href="/settings"] {
      display: none !important;
    }

    /* Floating Episode Button di Pojok Bawah (Khusus Mode Activity) */
    .activity-ep-floating-btn {
      display: none;
    }
    html.activity-mode-on .activity-ep-floating-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      position: fixed;
      bottom: 22px;
      right: 22px;
      z-index: 1000;
      padding: 10px 18px;
      border-radius: var(--r-pill);
      background: rgba(14, 15, 24, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      color: #fff;
      border: 1.5px solid var(--mode-accent);
      box-shadow: 0 8px 24px rgba(0,0,0,0.55), 0 0 14px rgba(123,115,240,0.45);
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    html.activity-mode-on .activity-ep-floating-btn:hover {
      transform: translateY(-2px) scale(1.05);
      background: rgba(25, 27, 42, 0.98);
      box-shadow: 0 12px 28px rgba(0,0,0,0.65), 0 0 18px rgba(123,115,240,0.65);
    }
    /* Sembunyikan tombol floating episode saat panel episode terbuka */
    body.episode-open .activity-ep-floating-btn {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
    }

    /* Global Page Transition Overlay (Hitam transparan dengan tittle.png & ring loader) */
    .global-transition-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(14, 15, 24, 0.88);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      color: #fff;
    }
    .transition-loader-text {
      font-size: 0.9rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: rgba(255,255,255,0.92);
    }
    /* Pengecualian: Tombol di Nobar Bar, Reaksi, Fullscreen, & Klaim Host tetap aktif */
    body.is-viewer .activity-sync-bar,
    body.is-viewer .activity-sync-bar *,
    body.is-viewer .reaction-bar,
    body.is-viewer .reaction-bar *,
    body.is-viewer .video-fullscreen-btn,
    body.is-viewer .video-fullscreen-btn *,
    body.is-viewer #claimHostBtn,
    body.is-viewer #claimHostBtn * {
      pointer-events: auto !important;
      cursor: pointer !important;
    }

    /* Floating Emoji Container */
    .floating-emoji-layer { position: fixed; inset: 0; pointer-events: none; z-index: 9999; overflow: hidden; }
    .floating-emoji {
      position: absolute; bottom: 20px; font-size: 2rem;
      animation: floatUp 2.4s ease-out forwards;
    }
    @keyframes floatUp {
      0% { opacity: 1; transform: translateY(0) scale(0.8); }
      70% { opacity: 0.9; transform: translateY(-50vh) scale(1.2); }
      100% { opacity: 0; transform: translateY(-70vh) scale(1.5); }
    }

    /* Modal Domain Settings */
    .modal-overlay {
      display: none; position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
      align-items: center; justify-content: center; padding: 20px;
    }
    .modal-card {
      width: 100%; max-width: 480px; background: var(--surface); border-radius: var(--r-xl);
      border: 1px solid var(--border); box-shadow: var(--sh-lg); padding: 24px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .modal-header { display: flex; align-items: center; justify-content: space-between; }
    .modal-title { font-size: 1.1rem; font-weight: 700; }
    .modal-close { background: transparent; border: none; font-size: 1.2rem; cursor: pointer; color: var(--txt-3); }
    .modal-body { display: flex; flex-direction: column; gap: 12px; font-size: 0.85rem; }
    .modal-field { display: flex; flex-direction: column; gap: 4px; }
    .modal-field label { font-weight: 600; color: var(--txt-2); }
    .modal-input {
      width: 100%; height: 40px; border-radius: var(--r-md); border: 1px solid var(--border);
      background: var(--surface-soft); padding: 0 12px; font-size: 0.85rem; color: var(--txt-1);
    }
    .modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .btn-save { padding: 8px 18px; border-radius: var(--r-pill); background: var(--mode-accent); color: #fff; font-weight: 700; border: none; cursor: pointer; }
    .btn-cancel { padding: 8px 14px; border-radius: var(--r-pill); background: var(--surface-soft); color: var(--txt-2); font-weight: 600; border: 1px solid var(--border); cursor: pointer; }
  </style>
</head>
<body>

  <!-- Floating Emoji Reaction Layer -->
  <div class="floating-emoji-layer" id="emojiLayer"></div>
  <!-- Sidebar backdrop (activity mode) -->
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="closeSidebar()"></div>

  ${isHome ? contentHtml : `
    <!-- NAVBAR (Hanya muncul saat browsing Drama/Anime) -->
    <header class="navbar">
      <div class="nav-left">
        <button class="nav-toggle-btn" onclick="toggleSidebar()" aria-label="Toggle Sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        <a href="/" class="brand-link">
          <div class="brand-icon">
            <img src="/assets/tittle.png" alt="Logo" style="width:26px;height:26px;object-fit:contain;">
          </div>
          <div class="brand-text">
            <span class="brand-title">Kamar Callista</span>
            <span class="brand-sub">${isAnime ? 'Ruang Anime' : 'Ruang Drama'}</span>
          </div>
        </a>

        <div class="mode-pills">
          <a href="/?mode=drama" class="mode-pill ${!isAnime?'active':''}">
            <span>🎬</span><span>Drama</span>
          </a>
          <a href="/?mode=anime" class="mode-pill ${isAnime?'active':''}">
            <span>🌸</span><span>Anime</span>
          </a>
        </div>
      </div>

      <div class="nav-search">
        <form action="/" method="GET">
          <input type="hidden" name="mode" value="${mode}">
          <input type="text" name="s" class="search-input" placeholder="Cari judul ${isAnime ? 'anime' : 'drama'}..." value="${searchQuery || ''}">
          <button type="submit" class="search-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
        </form>
      </div>

      <div class="nav-right">
        <button class="nav-icon-btn" onclick="toggleTheme()" title="Ganti Tema">
          <span id="themeEmoji">🌙</span>
        </button>
      </div>
    </header>

    <div class="app-layout">
      ${sidebarHtml}
      <main class="app-main">
        <!-- Live Nobar Sync Bar (muncul di mode Activity) -->
        <div class="sync-toast" id="syncToast"></div>
        <div class="activity-sync-bar" id="activitySyncBar">
          <div class="sync-status-indicator">
            <span class="pulse-dot"></span>
            <span>NOBAR VC</span>
            <span class="role-badge role-badge-host" id="roleBadge">👑 Host</span>
            <span style="opacity:0.75;font-size:0.72rem" id="roomMemberCount">👥 1 Penonton</span>
          </div>

          <div class="reaction-bar">
            <button class="react-btn" onclick="sendReaction('🍿')" title="Popcorn">🍿</button>
            <button class="react-btn" onclick="sendReaction('❤️')" title="Love">❤️</button>
            <button class="react-btn" onclick="sendReaction('😭')" title="Sedih">😭</button>
            <button class="react-btn" onclick="sendReaction('🤣')" title="Ketawa">🤣</button>
            <button class="react-btn" onclick="sendReaction('🔥')" title="Keren">🔥</button>
          </div>
        </div>

        ${contentHtml}
      </main>
      ${episodePanelHtml}
      ${(isActivity && episodePanelHtml) ? `
        <button class="activity-ep-floating-btn" onclick="toggleEpisodePanel()" title="Buka Daftar Episode">
          <span style="font-size:1.15rem">📺</span>
          <span>Episode</span>
        </button>
      ` : ''}
    </div>
  `}

  <!-- Global Page Transition Overlay -->
  <div class="global-transition-overlay" id="pageTransitionOverlay" style="display:none;">
    <div class="loader-logo-wrap">
      <div class="loader-ring"></div>
      <img src="/assets/tittle.png" alt="Callista" draggable="false">
    </div>
    <span class="transition-loader-text" id="pageTransitionText">Memuat Kamar Callista…</span>
  </div>

  <!-- Modal Pengaturan Domain -->
  <div class="modal-overlay" id="settingsModal">
    <div class="modal-card">
      <div class="modal-header">
        <h3 class="modal-title">Pengaturan Domain Scraper</h3>
        <button class="modal-close" onclick="closeSettingsModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Domain Oppadrama (Drama Asia):</label>
          <input type="text" id="cfgDrama" class="modal-input" value="${cfg.domainDrama}">
        </div>
        <div class="modal-field">
          <label>Domain Otakudesu (Anime):</label>
          <input type="text" id="cfgAnime" class="modal-input" value="${cfg.domainAnime}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" onclick="closeSettingsModal()">Batal</button>
        <button class="btn-save" onclick="saveDomainSettings()">Simpan</button>
      </div>
    </div>
  </div>

  <script>
    // Auto-detect Discord Activity environment
    const isDiscordEnv = (function() {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('frame_id') || sp.has('instance_id')) return true;
      if (window.location.hostname.includes('discordsays.com')) return true;
      try { if (sessionStorage.getItem('dc_frame_id')) return true; } catch (_) {}
      return false;
    })();
    // Expose for SDK handshake
    window.isDiscordEnv = isDiscordEnv;

    // Theme Switcher
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('callista_theme', next);
      updateThemeEmoji();
    }

    function updateThemeEmoji() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const el = document.getElementById('themeEmoji');
      if (el) el.textContent = isDark ? '☀️' : '🌙';
    }

    const savedTheme = localStorage.getItem('callista_theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      updateThemeEmoji();
    }

    // Modal Settings
    function openSettingsModal() {
      const m = document.getElementById('settingsModal');
      if (m) m.style.display = 'flex';
    }
    function closeSettingsModal() {
      const m = document.getElementById('settingsModal');
      if (m) m.style.display = 'none';
    }
    async function saveDomainSettings() {
      const drama = document.getElementById('cfgDrama').value.trim();
      const anime = document.getElementById('cfgAnime').value.trim();
      try {
        const res = await fetch('/api/movie/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domainDrama: drama, domainAnime: anime })
        });
        const data = await res.json();
        if (data.success) {
          alert('Pengaturan domain berhasil disimpan!');
          location.reload();
        } else {
          alert('Gagal menyimpan pengaturan.');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    // Sidebar & Player Utilities
    function toggleSidebar() {
      const sb = document.getElementById('appSidebar');
      const bd = document.getElementById('sidebarBackdrop');
      if (!sb) return;
      const isOpen = sb.classList.toggle('open');
      if (bd) bd.classList.toggle('show', isOpen);
    }

    function closeSidebar() {
      const sb = document.getElementById('appSidebar');
      const ep = document.getElementById('episodePanel');
      const bd = document.getElementById('sidebarBackdrop');
      if (sb) sb.classList.remove('open');
      if (ep) ep.classList.remove('open');
      if (bd) bd.classList.remove('show');
    }

    function toggleEpisodePanel() {
      const ep = document.getElementById('episodePanel');
      const bd = document.getElementById('sidebarBackdrop');
      if (!ep) return;
      const isOpen = ep.classList.toggle('open');
      if (bd) bd.classList.toggle('show', isOpen);
      document.body.classList.toggle('episode-open', isOpen);
    }

    // Global Page Transition Loading Functions
    function showPageLoading(text) {
      const el = document.getElementById('pageTransitionOverlay');
      const txt = document.getElementById('pageTransitionText');
      if (!el) return;
      if (txt && text) txt.textContent = text;
      el.style.display = 'flex';
    }

    function hidePageLoading() {
      const el = document.getElementById('pageTransitionOverlay');
      if (el) el.style.display = 'none';
    }

    // Intercept link clicks untuk menampilkan overlay transisi loading
    document.addEventListener('click', function(e) {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (a.target === '_blank') return;
      if (document.body.classList.contains('is-viewer') && document.documentElement.classList.contains('activity-mode-on')) {
        return;
      }
      showPageLoading('Membuka ' + (a.textContent.trim().substring(0, 25) || 'halaman') + '…');
    });

    window.addEventListener('beforeunload', function() {
      showPageLoading('Memuat tayangan…');
    });

    function toggleAdShield() {
      const btn = document.getElementById('adBtn');
      const lbl = document.getElementById('adLbl');
      if (!btn) return;
      const isOn = btn.classList.toggle('on');
      lbl.textContent = isOn ? 'Shield: ON' : 'Shield: OFF';
    }

    // Activity Mode Toggle
    function toggleActivityMode() {
      const html = document.documentElement;
      const isNow = html.classList.toggle('activity-mode-on');
      const btnText = document.getElementById('actToggleText');
      if (btnText) btnText.textContent = isNow ? 'Keluar Activity' : 'Mode Activity';
      
      const url = new URL(window.location.href);
      if (isNow) {
        url.searchParams.set('activity', '1');
      } else {
        url.searchParams.delete('activity');
        url.searchParams.set('activity', '0'); // Explicit disable agar cookie dihapus
      }
      window.location.href = url.toString();
    }

    // ══════════════════════════════════════════════════
    // WEBSOCKET REALTIME SYNC (HOST vs VIEWER NOBAR VC)
    // ══════════════════════════════════════════════════
    window.isHost = false;
    window._wsReady = false;
    window._currentPlayerMode = 'local';
    window._isInternalMediaSync = false;
    let ws = null;

    // Client ID persisten per browser tab/sesi lokal (TIDAK pernah dikirim lewat URL agar tidak bocor)
    const myClientId = (function() {
      let cid = '';
      try { cid = sessionStorage.getItem('callista_client_id'); } catch (_) {}
      if (!cid) {
        cid = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
        try { sessionStorage.setItem('callista_client_id', cid); } catch (_) {}
      }
      return cid;
    })();

    // Helper: Simpan & baca parameter Discord dari sessionStorage agar tidak hilang saat navigasi
    function getStoredDcParam(name) {
      const sp = new URLSearchParams(window.location.search);
      const v = sp.get(name);
      if (v) {
        try { sessionStorage.setItem('dc_' + name, v); } catch (_) {}
        return v;
      }
      try { return sessionStorage.getItem('dc_' + name); } catch (_) { return null; }
    }

    function buildActivityUrl(targetPath) {
      const u = new URL(targetPath, window.location.origin);
      u.searchParams.set('activity', '1');
      // Bersihkan param user_id/uid/cid dari URL agar identitas lokal tetap terisolasi
      u.searchParams.delete('user_id');
      u.searchParams.delete('uid');
      u.searchParams.delete('cid');
      ['frame_id', 'instance_id', 'client_id', 'platform', 'channel_id', 'guild_id'].forEach(function(p) {
        const val = getStoredDcParam(p);
        if (val && !u.searchParams.has(p)) {
          u.searchParams.set(p, val);
        }
      });
      return u.pathname + u.search;
    }

    // Room ID: Dipastikan 100% KONSISTEN untuk semua pengguna di Voice Channel yang sama
    const currentRoomId = (function() {
      const cId = getStoredDcParam('channel_id');
      if (cId) return cId;
      const iId = getStoredDcParam('instance_id');
      if (iId) return iId;
      return 'callista-nobar-shared';
    })();

    function showSyncToast(text) {
      const toast = document.getElementById('syncToast');
      if (!toast) return;
      toast.textContent = text;
      toast.style.display = 'block';
      clearTimeout(toast._timer);
      toast._timer = setTimeout(function() { toast.style.display = 'none'; }, 2600);
    }

    function updateRoleUI(isHostNow) {
      window.isHost = isHostNow;
      document.body.classList.toggle('is-host', isHostNow);
      document.body.classList.toggle('is-viewer', !isHostNow);

      const roleBadge = document.getElementById('roleBadge');
      if (roleBadge) {
        roleBadge.textContent = isHostNow ? '👑 Host' : '👁️ Penonton';
        roleBadge.className = 'role-badge ' + (isHostNow ? 'role-badge-host' : 'role-badge-viewer');
      }

      const v = document.getElementById('callistaVideo');
      const viewerBar = document.getElementById('viewerControlBar');
      if (v) {
        if (isHostNow) {
          v.controls = true;
          if (viewerBar) viewerBar.style.display = 'none';
        } else {
          v.controls = false; // NON-HOST DILARANG KERAS MENGATUR PLAYER!
          if (viewerBar) viewerBar.style.display = 'flex';
        }
      }
    }

    function setViewerVolume(val) {
      const v = document.getElementById('callistaVideo');
      if (v) {
        v.volume = parseFloat(val);
        v.muted = (parseFloat(val) === 0);
        const icon = document.getElementById('viewerVolIcon');
        if (icon) icon.textContent = v.muted ? '🔇' : (v.volume < 0.5 ? '🔉' : '🔊');
      }
    }

    function toggleViewerMute() {
      const v = document.getElementById('callistaVideo');
      const slider = document.getElementById('viewerVolSlider');
      const icon = document.getElementById('viewerVolIcon');
      if (!v) return;
      v.muted = !v.muted;
      if (v.muted) {
        if (icon) icon.textContent = '🔇';
      } else {
        if (icon) icon.textContent = v.volume < 0.5 ? '🔉' : '🔊';
        if (slider && v.volume === 0) { v.volume = 0.5; slider.value = 0.5; }
      }
    }

    function notifyHostNavigate(route, title) {
      if (ws && ws.readyState === WebSocket.OPEN && window.isHost) {
        ws.send(JSON.stringify({ type: 'HOST_NAVIGATE', route, title }));
      }
    }

    function sendMediaSync(isPlaying) {
      if (window._isInternalMediaSync || !window.isHost) return;
      const v = document.getElementById('callistaVideo');
      if (v && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'HOST_MEDIA_STATE',
          src: v.src,
          time: v.currentTime,
          isPlaying: isPlaying !== undefined ? isPlaying : !v.paused
        }));
      }
    }

    function syncViewerToMediaState(mState) {
      if (!mState || window.isHost) return;
      const v = document.getElementById('callistaVideo');
      if (!v) return;

      if (mState.src && v.src !== mState.src) {
        v.src = mState.src;
        v.style.display = 'block';
        const frame = document.getElementById('playerFrame');
        if (frame) frame.style.display = 'none';
        const loader = document.getElementById('playerLoader');
        if (loader) loader.style.display = 'none';
      }

      let targetTime = mState.time || 0;
      if (mState.isPlaying && mState.lastUpdate) {
        const elapsed = (Date.now() - mState.lastUpdate) / 1000;
        targetTime += elapsed;
      }

      if (Math.abs(v.currentTime - targetTime) > 1.2) {
        window._isInternalMediaSync = true;
        v.currentTime = targetTime;
        setTimeout(function() { window._isInternalMediaSync = false; }, 350);
      }

      if (mState.isPlaying && v.paused) {
        v.play().catch(function() {});
      } else if (!mState.isPlaying && !v.paused) {
        v.pause();
      }
    }

    function initActivityWebSocket() {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const wsUrl = proto + location.host + '/ws/activity?room=' + encodeURIComponent(currentRoomId) + '&cid=' + encodeURIComponent(myClientId);

      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = function() {
          window._wsReady = true;
          console.log('[NOBAR WS] Connected, room:', currentRoomId, 'cid:', myClientId);
        };
        ws.onmessage = function(event) {
          try { handleWsIncoming(JSON.parse(event.data)); } catch (_) {}
        };
        ws.onclose = function() {
          window._wsReady = false;
          setTimeout(function() {
            if (isDiscordEnv && document.documentElement.classList.contains('activity-mode-on')) {
              initActivityWebSocket();
            }
          }, 2500);
        };
        ws.onerror = function() { ws.close(); };
      } catch (e) {
        console.warn('[NOBAR WS] Connection failed:', e.message);
      }
    }

    function handleWsIncoming(data) {
      if (data.type === 'INIT_STATE') {
        updateRoleUI(data.isHost);
        const countEl = document.getElementById('roomMemberCount');
        if (countEl && data.count) countEl.textContent = '👥 ' + data.count + ' Penonton';

        // Sinkronisasi mutlak: jika penonton baru join dan host sedang buka rute tertentu (bukan di rute ini)
        if (!data.isHost && data.currentRoute) {
          const currentClean = (window.location.pathname + window.location.search)
            .replace(/[?&](activity|frame_id|instance_id|client_id|platform|channel_id|guild_id|user_id|cid|uid)=[^&]*/g, '')
            .replace(/[?&]$/, '');
          const hostClean = data.currentRoute
            .replace(/[?&](activity|frame_id|instance_id|client_id|platform|channel_id|guild_id|user_id|cid|uid)=[^&]*/g, '')
            .replace(/[?&]$/, '');

          if (hostClean && hostClean !== currentClean) {
            showSyncToast('🎬 Menyelaraskan ke tayangan Host…');
            showPageLoading('🎬 Menyelaraskan ke tayangan Host…');
            setTimeout(function() {
              window.location.href = buildActivityUrl(data.currentRoute);
            }, 250);
            return;
          }
        }

        // Jika rute sudah cocok dan host sedang memutar video, sinkronkan video & menitnya langsung
        if (!data.isHost && data.mediaState && data.mediaState.src) {
          setTimeout(function() {
            syncViewerToMediaState(data.mediaState);
          }, 500);
        }
      } else if (data.type === 'NAVIGATE_TO') {
        if (!window.isHost && data.route) {
          showSyncToast('🎬 Host membuka: ' + (data.title || 'tayangan baru'));
          showPageLoading('🎬 Host membuka: ' + (data.title || 'tayangan baru') + '…');
          setTimeout(function() {
            window.location.href = buildActivityUrl(data.route);
          }, 200);
        }
      } else if (data.type === 'HOST_CLOSED_SESSION') {
        showSyncToast('🎬 ' + (data.message || 'Host telah keluar. Sesi nobar selesai.'));
        showPageLoading('Host telah keluar. Sesi nobar selesai…');
        setTimeout(function() {
          try { sessionStorage.removeItem('callista_client_id'); } catch (_) {}
          window.location.href = '/';
        }, 1200);
      } else if (data.type === 'MEDIA_SYNC') {
        if (!window.isHost) {
          syncViewerToMediaState(data);
        }
      } else if (data.type === 'USER_COUNT') {
        const countEl = document.getElementById('roomMemberCount');
        if (countEl) countEl.textContent = '👥 ' + data.count + ' Penonton';
      } else if (data.type === 'ROLE_UPDATE') {
        updateRoleUI(data.isHost);
        showSyncToast(data.isHost ? '👑 Anda sekarang Host!' : '👁️ Peran berpindah ke Penonton');
      } else if (data.type === 'REACTION') {
        spawnFloatingEmoji(data.emoji);
      } else if (data.type === 'CHANGE_SERVER') {
        // Viewer: host ganti server → ikuti otomatis
        if (!window.isHost) {
          showSyncToast('🔄 Host ganti server: ' + (data.name || 'baru'));
          const frame = document.getElementById('playerFrame');
          const loader = document.getElementById('playerLoader');
          // Aktifkan tombol server yang sesuai (cari berdasarkan src)
          document.querySelectorAll('.srv-btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('onclick') && b.getAttribute('onclick').includes(JSON.stringify(data.src)));
          });
          if (loader) loader.style.display = 'flex';
          if (frame) frame.src = data.src;
          if (window._currentPlayerMode === 'local') {
            loadMediaToLocalPlayer(data.src);
          } else {
            setTimeout(function() {
              if (loader) loader.style.display = 'none';
            }, 1500);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════
    // PLAYER LOKAL: KONTROL MEDIA MANDIRI & SINKRONISASI
    // ══════════════════════════════════════════════════
    function initCallistaVideoEvents() {
      const v = document.getElementById('callistaVideo');
      if (!v || v._eventsInitialized) return;
      v._eventsInitialized = true;

      // Host Play event -> broadcast ke semua Viewer
      v.addEventListener('play', function() {
        sendMediaSync(true);
      });

      // Host Pause event -> broadcast ke semua Viewer
      v.addEventListener('pause', function() {
        sendMediaSync(false);
      });

      // Host Seek event -> broadcast ke semua Viewer
      v.addEventListener('seeked', function() {
        sendMediaSync(!v.paused);
      });
    }

    // Heartbeat berkala sinkronisasi Host setiap 3 detik
    setInterval(function() {
      if (window.isHost && ws && ws.readyState === WebSocket.OPEN) {
        const v = document.getElementById('callistaVideo');
        if (v && v.src && !v.paused) {
          sendMediaSync(true);
        }
      }
    }, 3000);

    async function loadMediaToLocalPlayer(sourceUrl) {
      const v = document.getElementById('callistaVideo');
      const frame = document.getElementById('playerFrame');
      const loader = document.getElementById('playerLoader');
      const loaderText = document.getElementById('loaderText');

      if (!v) return;
      if (loader) {
        if (loaderText) loaderText.textContent = 'Menyiapkan Player Lokal…';
        loader.style.display = 'flex';
      }

      try {
        const resp = await fetch('/api/resolve-media?url=' + encodeURIComponent(sourceUrl));
        const res = await resp.json();

        if (res.success && (res.directUrl || res.rawUrl)) {
          initCallistaVideoEvents();
          // Di Discord Desktop / Activity, prioritaskan res.proxyUrl agar lolos CSP Electron Discord
          const isAct = document.documentElement.classList.contains('activity-mode-on') || isDiscordEnv;
          const targetSrc = (isAct && res.proxyUrl) ? res.proxyUrl : (res.directUrl || res.rawUrl);
          v.src = targetSrc;
          v.style.display = 'block';
          if (frame) frame.style.display = 'none';
          document.getElementById('btnLocalMode')?.classList.add('active');
          document.getElementById('btnEmbedMode')?.classList.remove('active');
          window._currentPlayerMode = 'local';
          
          v.onloadedmetadata = function() {
            if (loader) loader.style.display = 'none';
          };
          
          v.onerror = function() {
            console.warn('[PLAYER] Video error with', v.src, ', trying fallback...');
            if (res.proxyUrl && v.src !== res.proxyUrl) {
              v.src = res.proxyUrl;
              v.onerror = function() {
                console.warn('[PLAYER] Proxy fallback failed, switching to embed frame...');
                setPlayerMode('embed');
              };
            } else if (res.directUrl && v.src !== res.directUrl) {
              v.src = res.directUrl;
              v.onerror = function() {
                setPlayerMode('embed');
              };
            } else {
              setPlayerMode('embed');
            }
          };
        } else {
          setPlayerMode('embed');
        }
      } catch (err) {
        setPlayerMode('embed');
      } finally {
        if (loader) loader.style.display = 'none';
      }
    }

    function setPlayerMode(mode) {
      if (!window.isHost && window._wsReady) {
        showSyncToast('👁️ Hanya Host yang dapat mengubah mode player');
        return;
      }
      window._currentPlayerMode = mode;
      const v = document.getElementById('callistaVideo');
      const frame = document.getElementById('playerFrame');
      const btnLocal = document.getElementById('btnLocalMode');
      const btnEmbed = document.getElementById('btnEmbedMode');

      if (mode === 'local') {
        if (v && v.src) {
          v.style.display = 'block';
          if (frame) frame.style.display = 'none';
          btnLocal?.classList.add('active');
          btnEmbed?.classList.remove('active');
        } else {
          const currentFrameSrc = frame ? frame.src : '';
          loadMediaToLocalPlayer(currentFrameSrc);
        }
      } else {
        if (v) {
          v.pause();
          v.style.display = 'none';
        }
        if (frame) frame.style.display = 'block';
        btnEmbed?.classList.add('active');
        btnLocal?.classList.remove('active');
      }
    }

    function changeServer(btn, src) {
      if (!window.isHost && window._wsReady) {
        showSyncToast('👁️ Hanya Host yang dapat mengganti server');
        return;
      }
      document.querySelectorAll('.srv-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      const frame = document.getElementById('playerFrame');
      const loader = document.getElementById('playerLoader');
      if (loader) loader.style.display = 'flex';
      if (frame) {
        frame.src = src;
      }
      if (window._currentPlayerMode === 'local') {
        loadMediaToLocalPlayer(src);
      }
      // Broadcast CHANGE_SERVER ke semua viewer
      if (ws && ws.readyState === WebSocket.OPEN && window.isHost) {
        ws.send(JSON.stringify({
          type: 'HOST_CHANGE_SERVER',
          src: src,
          name: btn.textContent.trim()
        }));
      }
    }

    function onFrameLoad() {
      const loader = document.getElementById('playerLoader');
      if (loader) loader.style.display = 'none';
      const v = document.getElementById('callistaVideo');
      if (v && !v.src) {
        const frame = document.getElementById('playerFrame');
        if (frame && frame.src) {
          loadMediaToLocalPlayer(frame.src);
        }
      }
    }

    function sendReaction(emoji) {
      spawnFloatingEmoji(emoji);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'REACTION', emoji: emoji }));
      }
    }

    function spawnFloatingEmoji(emoji) {
      const layer = document.getElementById('emojiLayer');
      if (!layer) return;
      const el = document.createElement('div');
      el.className = 'floating-emoji';
      el.textContent = emoji;
      el.style.left = (Math.random() * 80 + 10) + 'vw';
      layer.appendChild(el);
      setTimeout(function() { el.remove(); }, 2500);
    }

    // Tombol fullscreen manual (support CSS theater view + native browser fullscreen)
    function toggleVideoFullscreen() {
      const box = document.getElementById('videoBox');
      const btn = document.getElementById('fsBtnText');
      if (!box) return;
      const isFs = box.classList.toggle('fs-active');
      document.body.classList.toggle('in-fullscreen', isFs);
      if (btn) btn.textContent = isFs ? 'Tutup' : 'Fullscreen';
      document.body.style.overflow = isFs ? 'hidden' : '';

      if (isFs && document.fullscreenEnabled && !document.fullscreenElement) {
        try { box.requestFullscreen().catch(function() {}); } catch (_) {}
      } else if (!isFs && document.fullscreenElement) {
        try { document.exitFullscreen().catch(function() {}); } catch (_) {}
      }
    }

    // Intercept klik navigasi di mode activity
    document.addEventListener('click', function(e) {
      if (!document.documentElement.classList.contains('activity-mode-on')) return;
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || a.pathname === '/settings') return;

      // Proteksi Penonton: Cegah penonton mengacak-acak navigasi
      if (!window.isHost) {
        e.preventDefault();
        showSyncToast('👁️ Hanya Host yang dapat memilih tayangan');
        return;
      }

      // Host bernavigasi: Pertahankan parameter Discord & siarkan ke Penonton
      if (a.origin === window.location.origin) {
        e.preventDefault();
        const nextUrl = buildActivityUrl(a.pathname + a.search);
        notifyHostNavigate(nextUrl, a.textContent.trim() || document.title);
        showPageLoading('Membuka ' + (a.textContent.trim().substring(0, 25) || 'tayangan') + '…');
        setTimeout(function() {
          window.location.href = nextUrl;
        }, 120);
      }
    });

    // Auto-connect WS hanya di Discord Activity (bukan plain browser)
    if (isDiscordEnv && document.documentElement.classList.contains('activity-mode-on')) {
      initActivityWebSocket();
    }
  </script>
</body>
</html>`;
}

/* ============================================================
   REQUEST HANDLER UTAMA UNTUK SERVER HTTP CALLISTA
   ============================================================ */
async function handleMovieRequest(req, res, url) {
  const reqMode = url.searchParams.get('mode');
  const targetUrlParam = url.searchParams.get('url');
  const searchQuery = url.searchParams.get('s') || '';
  const catParam = url.searchParams.get('cat');
  const cookieHeader = req.headers.cookie || '';
  const explicitlyDisabled = url.searchParams.get('activity') === '0';

  // Auto-detect: Discord Activity hanya jika ada frame_id/instance_id atau host discordsays.com
  // Cookie activity hanya berlaku saat memang Discord env (bukan forced dari browser biasa)
  const hasDiscordActivityParam = url.searchParams.has('frame_id') || url.searchParams.has('instance_id')
    || Boolean(req.headers['x-forwarded-host'] && req.headers['x-forwarded-host'].includes('discordsays.com'));
  const hasCookieActivity = /(?:^|;\s*)callista_act=1/.test(cookieHeader);
  const hasQueryActivity = url.searchParams.get('activity') === '1';
  const isActivity = !explicitlyDisabled && (hasQueryActivity || hasDiscordActivityParam || hasCookieActivity);
  const cfg = loadConfig();

  // Helper untuk set status cookie activity
  const sendHtml = (statusCode, htmlContent) => {
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    };
    if (isActivity) {
      headers['Set-Cookie'] = 'callista_act=1; Path=/; SameSite=Lax';
    } else if (explicitlyDisabled) {
      headers['Set-Cookie'] = 'callista_act=0; Max-Age=0; Path=/; SameSite=Lax';
    }
    res.writeHead(statusCode, headers);
    res.end(htmlContent);
  };

  // 0. Image Proxy — bypass CSP/hotlink di Discord Desktop
  if (url.pathname === '/image-proxy') {
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url');
      return;
    }
    try {
      let referer = imgUrl;
      try { referer = new URL(imgUrl).origin + '/'; } catch (_) {}
      const imgResp = await axios.get(imgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': referer,
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
        },
        responseType: 'stream',
        timeout: 10000
      });
      const ct = imgResp.headers['content-type'] || 'image/jpeg';
      const cl = imgResp.headers['content-length'];
      const respH = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      };
      if (cl) respH['Content-Length'] = cl;
      res.writeHead(200, respH);
      imgResp.data.pipe(res);
    } catch (e) {
      // Fallback: redirect ke placeholder
      res.writeHead(302, { 'Location': 'https://placehold.co/240x340/EDE9FE/9CA3AF?text=No+Image' });
      res.end();
    }
    return;
  }

  // 1. API: Settings Domain
  if (url.pathname === '/api/movie/settings' || url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cfg));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (parsed.domainDrama) cfg.domainDrama = parsed.domainDrama.replace(/\/$/, '');
          if (parsed.domainAnime) cfg.domainAnime = parsed.domainAnime.replace(/\/$/, '');
          const success = saveConfig(cfg);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, config: cfg }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // 1b. API: Resolve Direct Media URL untuk Player Lokal Callista
  if (url.pathname === '/api/resolve-media') {
    let targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'URL required' }));
      return;
    }
    // Unwrap jika targetUrl dibungkus oleh /embed-proxy atau /anime-embed
    if (targetUrl.includes('url=')) {
      const match = targetUrl.match(/[?&]url=([^&]+)/);
      if (match) targetUrl = decodeURIComponent(match[1]);
    }

    try {
      let directUrl = '';
      if (/\.(mp4|m3u8)(?:\?|$)/i.test(targetUrl)) {
        directUrl = targetUrl;
      } else {
        // Build referer: use the origin of the target URL
        let referer = targetUrl;
        try { referer = new URL(targetUrl).origin + '/'; } catch (_) {}

        const { data } = await axios.get(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': referer
          },
          timeout: 10000
        });

        const $ = cheerio.load(data);
        $('video source, video').each((_, el) => {
          const s = $(el).attr('src');
          if (s && !directUrl) directUrl = s;
        });

        // Juga cari mp4 yang di-assign ke variabel JS (pola desustream: videoURL = "...")
        if (!directUrl) {
          const jsVarMatch = data.match(/(?:videoURL|videoUrl|video_url|file|src)\s*[=:]\s*["'`](https?:\/\/[^"'`\s]+\.(?:mp4|m3u8)[^"'`\s]*)["'`]/i);
          if (jsVarMatch) directUrl = jsVarMatch[1];
        }

        if (!directUrl) {
          const mp4Matches = data.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:\?[^\s"'<>]*)?/gi) || [];
          for (const m of mp4Matches) {
            if (!m.includes('preview') && !m.includes('thumb')) {
              directUrl = m;
              break;
            }
          }
        }

        // Jika terdapat iframe di dalam halaman, coba fetch isi iframe untuk mencari direct video stream
        if (!directUrl) {
          const ifr = $('iframe').first().attr('src') || '';
          if (ifr && ifr.startsWith('http')) {
            try {
              let ifrReferer = ifr;
              try { ifrReferer = new URL(ifr).origin + '/'; } catch (_) {}
              const ifrResp = await axios.get(ifr, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                  'Referer': ifrReferer
                },
                timeout: 8000
              });
              const ifrData = typeof ifrResp.data === 'string' ? ifrResp.data : '';
              const ifrMatch = ifrData.match(/(?:videoURL|videoUrl|video_url|file|src)\s*[=:]\s*["'`](https?:\/\/[^"'`\s]+\.(?:mp4|m3u8)[^"'`\s]*)["'`]/i);
              if (ifrMatch) directUrl = ifrMatch[1];
            } catch (_) {}
            if (!directUrl) directUrl = ifr;
          }
        }
      }

      if (directUrl) {
        const isDirectStream = /\.(mp4|m3u8)/i.test(directUrl);
        const proxySrc = `/media-stream?url=${encodeURIComponent(directUrl)}`;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          directUrl: directUrl,
          proxyUrl: proxySrc,
          rawUrl: directUrl,
          isNativeVideo: isDirectStream
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: false,
          fallbackUrl: targetUrl,
          message: 'Direct media stream not extracted'
        }));
      }
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, fallbackUrl: targetUrl, error: e.message }));
    }
    return;
  }

  // 1c. Stream Proxy Video Lokal dengan HTTP Range (Partial Content 206)
  if (url.pathname === '/media-stream') {
    const rawTarget = url.searchParams.get('url');
    if (!rawTarget) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url param');
      return;
    }
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Referer': new URL(rawTarget).origin + '/'
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }
      const streamResp = await axios.get(rawTarget, {
        headers,
        responseType: 'stream',
        validateStatus: () => true
      });
      const respHeaders = {
        'Content-Type': streamResp.headers['content-type'] || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Origin, Content-Type',
        'Cache-Control': 'public, max-age=3600'
      };
      if (streamResp.headers['content-range']) respHeaders['Content-Range'] = streamResp.headers['content-range'];
      if (streamResp.headers['content-length']) respHeaders['Content-Length'] = streamResp.headers['content-length'];
      res.writeHead(streamResp.status, respHeaders);
      streamResp.data.pipe(res);
      req.on('close', () => {
        try { streamResp.data.destroy(); } catch (_) {}
      });
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Media stream error: ' + err.message);
    }
    return;
  }

  // 2. UNIVERSAL EMBED PROXY (Bypass CSP, X-Frame-Options, dan rewrite videoURL ke /media-stream untuk Discord Desktop)
  if (url.pathname === '/embed-proxy' || url.pathname === '/anime-embed') {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('URL required');
      return;
    }
    try {
      let referer = targetUrl;
      try { referer = new URL(targetUrl).origin + '/'; } catch (_) {}
      const { data } = await axios.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': referer
        },
        timeout: 15000
      });

      let html = typeof data === 'string' ? data : data.toString();

      // 1. Rewrite videoURL di script desustream / anime agar menggunakan /media-stream
      html = html.replace(/(videoURL\s*=\s*["'])(https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)(["'])/gi, (m, p1, p2, p3) => {
        return `${p1}/media-stream?url=${encodeURIComponent(p2)}${p3}`;
      });

      // 2. Rewrite video & source src langsung
      html = html.replace(/(<video[^>]*?\ssrc=["'])(https?:\/\/[^"']+)(["'])/gi, (m, p1, p2, p3) => {
        return `${p1}/media-stream?url=${encodeURIComponent(p2)}${p3}`;
      });
      html = html.replace(/(<source[^>]*?\ssrc=["'])(https?:\/\/[^"']+)(["'])/gi, (m, p1, p2, p3) => {
        return `${p1}/media-stream?url=${encodeURIComponent(p2)}${p3}`;
      });

      // 3. Bypass anti-iframe / sandbox checks di player seperti abyssplayer
      html = html.replace(/top\.location\s*==\s*self\.location/g, 'false');
      html = html.replace(/top\.location\s*!==\s*self\.location/g, 'true');
      html = html.replace(/track\.window\s*>=\s*\d+/g, 'false');

      // 4. Injeksi base href jika belum ada
      const targetOrigin = new URL(targetUrl).origin;
      if (!html.includes('<base')) {
        html = html.replace(/<head>/i, `<head><base href="${targetOrigin}/">`);
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Gagal memuat embed proxy: ${err.message}`);
    }
    return;
  }

  // 3. MURNI HALAMAN DEPAN KAMAR CALLISTA
  // FIX: !isActivity dihapus — saat activity mode pun, URL root (/) selalu ke Kamar Utama
  if (!reqMode && !targetUrlParam && !searchQuery && !catParam) {
    const html = masterLayout({
      title: 'Kamar Callista',
      contentHtml: renderKamarHome(isActivity),
      mode: 'home',
      isActivity
    });
    sendHtml(200, html);
    return;
  }

  // 4. MODE DRAMA, ANIME, ATAU ACTIVITY VIEW
  const mode = reqMode === 'anime' ? 'anime' : 'drama';
  const BASE = mode === 'anime' ? cfg.domainAnime : cfg.domainDrama;

  let targetUrl = targetUrlParam;
  if (searchQuery) {
    targetUrl = mode === 'anime'
      ? `${BASE}/?s=${encodeURIComponent(searchQuery)}&post_type=anime`
      : `${BASE}/?s=${encodeURIComponent(searchQuery)}`;
  } else if (catParam) {
    targetUrl = catParam;
  } else if (!targetUrl) {
    targetUrl = `${BASE}/`;
  }

  if (targetUrl.startsWith('/')) targetUrl = BASE + targetUrl;

  try {
    const [html, sidebar] = await Promise.all([
      fetchHtml(targetUrl),
      scrapeSidebar(mode)
    ]);

    const $ = cheerio.load(html);
    const pageType = detectPageType($, targetUrl, mode);
    const sidebarHtml = renderSidebar(sidebar, mode, catParam || '');

    /* ─────────── PLAYER VIEW ─────────── */
    if (pageType === 'player') {
      let pageTitle = '';
      let mirrors = [];
      let prevLink = '';
      let nextLink = '';
      let seriesLink = '';
      let seriesName = '';
      let episodeList = [];
      let dlList = [];
      let initSrc = '';

      if (mode === 'anime') {
        pageTitle = $('h1.posttl').text().trim() || $('title').text().split('|')[0].trim();
        let iframeSrc = $('#pembed iframe, .responsive-embed-stream iframe').first().attr('src') || '';
        if (iframeSrc) {
          initSrc = `/embed-proxy?url=${encodeURIComponent(iframeSrc)}`;
          mirrors.push({ name: 'DesuStream (Utama)', src: initSrc });
        }
        $('.mirrorstream ul li a').each((i, el) => {
          const srvName = $(el).text().trim();
          if (srvName && !mirrors.some(m => m.name === srvName)) {
            mirrors.push({ name: srvName, src: initSrc });
          }
        });
        if (!mirrors.length && iframeSrc) {
          mirrors.push({ name: 'Server 1', src: initSrc });
        }
        $('.flir a').each((i, el) => {
          const txt = $(el).text().trim().toLowerCase();
          const href = $(el).attr('href') || '';
          if (txt.includes('previous') || txt.includes('prev')) prevLink = href;
          if (txt.includes('next')) nextLink = href;
          if (txt.includes('see all') || txt.includes('semua') || href.includes('/anime/')) {
            seriesLink = href;
            seriesName = 'Detail Anime';
          }
        });
        $('select option, .keyingpost li a').each((i, el) => {
          const epLink = $(el).attr('value') || $(el).attr('href') || '';
          const epTitle = $(el).text().trim();
          if (epLink && epLink.startsWith('http') && epTitle.toLowerCase().includes('episode')) {
            const epNum = epTitle.replace(/[^0-9]/g, '') || `${i + 1}`;
            const isCurrent = epLink.replace(/\/$/, '') === targetUrl.replace(/\/$/, '');
            episodeList.push({ epLink, epTitle, epNum, isCurrent });
          }
        });
        $('.download ul li').each((i, el) => {
          const qual = $(el).find('strong').text().trim() || 'HD';
          const size = $(el).find('i').text().trim() || '';
          $(el).find('a').each((j, a) => {
            const dHref = $(a).attr('href') || '';
            const srv   = $(a).text().trim();
            if (dHref.startsWith('http')) {
              dlList.push({ srv: `${srv} (${size})`, qual, text: 'Download', href: dHref });
            }
          });
        });
      } else {
        pageTitle = $('h1.entry-title, .entry-title, h1').first().text().replace(/\s+/g,' ').trim()
          || $('title').text().split('«')[0].trim();

        $('select.mirror option').each((i, el) => {
          const name = $(el).text().trim();
          const val  = $(el).attr('value');
          if (!val) return;
          try {
            const decoded = Buffer.from(val, 'base64').toString('utf-8');
            const match   = decoded.match(/src=["'](.*?)["']/i);
            const rawSrc  = match?.[1] || (decoded.startsWith('http') ? decoded.trim() : '');
            if (rawSrc) {
              const src = `/embed-proxy?url=${encodeURIComponent(rawSrc)}`;
              mirrors.push({ name: name || `Server ${mirrors.length+1}`, src });
            }
          } catch (_) {}
        });

        if (!mirrors.length) {
          $('iframe').each((i, el) => {
            const rawSrc = $(el).attr('src') || $(el).attr('data-src') || '';
            if (rawSrc && !rawSrc.includes('googletag') && !rawSrc.includes('facebook') && !rawSrc.includes('disqus')) {
              const src = `/embed-proxy?url=${encodeURIComponent(rawSrc)}`;
              mirrors.push({ name: `Server ${mirrors.length+1}`, src });
            }
          });
        }

        initSrc = mirrors[0]?.src || '';
        prevLink   = $('.naveps a:contains("Prev"), .ts-breadcrumb a:contains("Prev")').attr('href') || '';
        nextLink   = $('.naveps a:contains("Next"), .ts-breadcrumb a:contains("Next")').attr('href') || '';
        seriesLink = $('.ts-breadcrumb a, .naveps a').filter((_,el) => ($(el).attr('href')||'').includes('/series/')).first().attr('href') || '';
        seriesName = $('.ts-breadcrumb a, .naveps a').filter((_,el) => ($(el).attr('href')||'').includes('/series/')).first().text().trim() || 'Detail Series';

        $('.episodelist li, #chapterlist li').each((i, el) => {
          const epLink  = $(el).find('a').attr('href') || '';
          const epTitle = $(el).find('.playinfo span, .epl-title').text().trim() || $(el).find('a').text().trim();
          const epNum   = $(el).find('.playinfo h4, .epl-num').text().trim() || epTitle.match(/\d+/)?.[0] || '';
          const isCurrent = epLink.replace(/\/$/,'') === targetUrl.replace(/\/$/,'');
          if (epLink) episodeList.push({ epLink, epTitle, epNum, isCurrent });
        });

        $('.entry-content table tr, .soraddl').each((i, el) => {
          const srv  = $(el).find('td:first-child, strong').first().text().trim();
          const qual = $(el).find('td:nth-child(2)').first().text().trim();
          $(el).find('a').each((_,a) => {
            const href = $(a).attr('href') || '';
            if (href.startsWith('http')) dlList.push({ srv: srv||'Server', qual: qual||'HD', text: $(a).text().trim()||'Download', href });
          });
        });
      }

      const contentHtml = `
        <div class="player-main">
          <div class="player-breadcrumb">
            <a href="${seriesLink ? `/?mode=${mode}&url=`+encodeURIComponent(seriesLink) : `/?mode=${mode}`}" class="back-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              ${seriesName || 'Koleksi'}
            </a>
            <h1 class="player-page-title">${pageTitle}</h1>
          </div>

          <div class="player-card" id="playerCard">
            <!-- Top bar -->
            <div class="player-topbar">
              <div class="server-row">
                <span class="server-lbl">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
                    <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
                  </svg>
                  Server:
                </span>
                ${mirrors.map((m,idx) => `
                  <button class="srv-btn ${idx===0?'active':''}" onclick="changeServer(this,'${m.src}')">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    ${m.name}
                  </button>
                `).join('')}
              </div>

              <!-- Switcher Mode Player: Lokal vs Embed -->
              <div class="player-type-toggle" style="display:inline-flex;align-items:center;background:var(--surface-soft);padding:2px;border-radius:var(--r-pill);border:1px solid var(--border);gap:2px;">
                <button class="player-mode-btn active" id="btnLocalMode" onclick="setPlayerMode('local')" title="Player Video Lokal Callista dengan Kontrol Penuh & Sinkronisasi Nobar" style="padding:4px 10px;border-radius:var(--r-pill);border:none;background:var(--mode-accent);color:#fff;font-size:0.72rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
                  <span>⚡</span><span>Player Lokal</span>
                </button>
                <button class="player-mode-btn" id="btnEmbedMode" onclick="setPlayerMode('embed')" title="Player Web Bawaan Server" style="padding:4px 10px;border-radius:var(--r-pill);border:none;background:transparent;color:var(--txt-2);font-size:0.72rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
                  <span>🌐</span><span>Embed Web</span>
                </button>
              </div>

              <div class="action-row">
                <button class="act-btn on" id="adBtn" onclick="toggleAdShield()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span id="adLbl">Shield: ON</span>
                </button>
                <button class="act-btn ep-toggle-btn" onclick="toggleEpisodePanel()" title="Daftar Episode">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
                  Episode
                </button>
                <button class="act-btn" onclick="reloadPlayer()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  Reload
                </button>
              </div>
            </div>

            <!-- Video Aspect Box (16:9) -->
            <div class="video-box" id="videoBox">
              <div class="video-loader" id="playerLoader">
                <div class="loader-logo-wrap">
                  <div class="loader-ring"></div>
                  <img src="/assets/tittle.png" alt="Callista" draggable="false">
                </div>
                <span id="loaderText">Menyiapkan Video…</span>
              </div>

              <!-- 1. Player Video Lokal HTML5 Callista (Bisa di-play/pause/seek realtime nobar) -->
              <video id="callistaVideo" playsinline controls preload="metadata" style="display:none;width:100%;height:100%;background:#000;position:absolute;inset:0;z-index:3;"></video>

              <!-- Viewer Control Bar (Non-Host: hanya kontrol volume & info sinkron) -->
              <div id="viewerControlBar" style="display:none;position:absolute;bottom:10px;left:10px;z-index:25;background:rgba(14,15,24,0.85);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.2);border-radius:30px;padding:5px 14px;align-items:center;gap:10px;color:#fff;font-size:0.75rem;">
                <span id="viewerVolIcon" style="cursor:pointer;" onclick="toggleViewerMute()">🔊</span>
                <input type="range" id="viewerVolSlider" min="0" max="1" step="0.05" value="1" style="width:75px;cursor:pointer;accent-color:var(--mode-accent);" oninput="setViewerVolume(this.value)">
                <span style="opacity:0.65;font-size:0.7rem;">| 👁️ Mengikuti Host</span>
              </div>

              <!-- 2. Iframe Fallback Embed Stream -->
              <iframe id="playerFrame" src="${initSrc}"
                allowfullscreen webkitallowfullscreen mozallowfullscreen
                scrolling="no" frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; xr-spatial-tracking"
                onload="onFrameLoad()">
              </iframe>
              <button class="video-fullscreen-btn" onclick="toggleVideoFullscreen()" title="Fullscreen">
                <svg id="fsIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
                <span id="fsBtnText">Fullscreen</span>
              </button>
            </div>

            <!-- Bottom Nav -->
            <div class="player-nav-bar">
              ${prevLink
                ? `<a href="/?mode=${mode}&url=${encodeURIComponent(prevLink)}" class="nav-ep-btn">
                     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                     Episode Sebelumnya
                   </a>`
                : `<button class="nav-ep-btn" disabled>
                     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                     Episode Pertama
                   </button>`
              }

              <div class="tip-pill">
                <span class="tip-tag">💡 Tips</span>
                <span>Gunakan tombol Fullscreen untuk tampilan penuh atau putar via Player Lokal.</span>
              </div>

              ${nextLink
                ? `<a href="/?mode=${mode}&url=${encodeURIComponent(nextLink)}" class="nav-ep-btn">
                     Episode Selanjutnya
                     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                   </a>`
                : `<button class="nav-ep-btn" disabled>
                     Episode Terakhir
                     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                   </button>`
              }
            </div>
          </div>

          ${(!isActivity && dlList.length) ? `
            <div class="dl-card">
              <div class="sec-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download Episode
              </div>
              <div class="dl-list">
                ${dlList.map(d => `
                  <a href="${d.href}" target="_blank" rel="noopener noreferrer" class="dl-row">
                    <span class="dl-srv">${d.srv}</span>
                    <span class="dl-qual">${d.qual}</span>
                    <span class="dl-go">Unduh &rarr;</span>
                  </a>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;

      const pageHtml = masterLayout({
        title: pageTitle,
        sidebarHtml,
        contentHtml,
        episodePanelHtml: renderEpisodePanel(episodeList, targetUrl, mode),
        pageType: 'player',
        searchQuery,
        mode,
        isActivity
      });
      sendHtml(200, pageHtml);
      return;
    }

    /* ─────────── DETAIL SERIES / ANIME ─────────── */
    if (pageType === 'series') {
      let seriesTitle = '';
      let subTitle = '';
      let poster = '';
      let synopsis = '';
      let meta = {};
      let genres = [];
      let episodes = [];

      if (mode === 'anime') {
        seriesTitle = $('.jdlflm, h1').first().text().trim() || $('title').text().split('|')[0].trim();
        poster = $('.fotoanime img').first().attr('src') || '';
        synopsis = $('.sinopc p').text().trim() || 'Tidak ada sinopsis.';

        $('.infozingle p').each((_, el) => {
          const txt = $(el).text().trim();
          if (txt.includes(':')) {
            const parts = txt.split(':');
            meta[parts[0].trim()] = parts.slice(1).join(':').replace(/\s+/g, ' ').trim();
          }
        });

        if (meta['Genre']) {
          genres = meta['Genre'].split(',').map(g => g.trim());
        }

        $('.episodelist ul li').each((i, el) => {
          const a = $(el).find('a').first();
          const epLink = a.attr('href') || '';
          const epTitle = a.text().trim();
          const epDate = $(el).find('.zeebr').text().trim();
          if (epLink) {
            const epNum = epTitle.replace(/[^0-9]/g, '') || `${i + 1}`;
            episodes.push({ epNum, epTitle, epDate, epLink });
          }
        });
      } else {
        seriesTitle = $('h1.entry-title, h1').first().text().replace(/^Drama\s+/i,'').trim();
        poster      = $('.thumb img, .poster img').first().attr('src') || $('.thumb img').first().attr('data-src') || '';
        synopsis    = $('.entry-content p, .synopsis, .desc').first().text().trim() || 'Tidak ada deskripsi.';

        $('.spe span, .info-content span, .infox span').each((_,el) => {
          const txt = $(el).text().trim();
          if (txt.includes(':')) {
            const [k,...v] = txt.split(':');
            meta[k.trim()] = v.join(':').trim();
          }
        });

        const seenG = new Set();
        $('.genx a, a[href*="/genres/"]').each((_,el) => {
          const g = $(el).text().trim();
          if (g && !seenG.has(g)) { seenG.add(g); genres.push(g); }
        });

        $('.eplister ul li').each((_,el) => {
          const epNum   = $(el).find('.epl-num').text().trim();
          const epTitle = $(el).find('.epl-title').text().trim();
          const epDate  = $(el).find('.epl-date').text().trim();
          const epLink  = $(el).find('a').attr('href') || '';
          if (epLink) episodes.push({ epNum, epTitle, epDate, epLink });
        });
      }

      const contentHtml = `
        <div class="series-hero">
          <div class="series-poster">
            <img src="${proxyImg(poster)}" alt="${seriesTitle}"
              onerror="this.src='https://placehold.co/300x420/EDE9FE/9CA3AF?text=No+Poster'"/>
          </div>
          <div class="series-info">
            <div class="badge-row">
              ${meta['Status']  ? `<span class="badge badge-status">${meta['Status']}</span>`  : ''}
              ${meta['Tipe']    ? `<span class="badge badge-type">${meta['Tipe']}</span>`      : ''}
              ${meta['Negara']  ? `<span class="badge badge-country">${meta['Negara']}</span>`: ''}
              ${meta['Durasi']  ? `<span class="badge badge-dur">${meta['Durasi']}</span>`    : ''}
              ${meta['Skor']    ? `<span class="badge badge-status">★ ${meta['Skor']}</span>` : ''}
            </div>
            <h1 class="series-title-big">${seriesTitle}</h1>
            ${subTitle ? `<div class="series-sub-title">${subTitle}</div>` : ''}

            <div class="genre-cloud">
              ${genres.map(g=>`<span class="genre-chip">${g}</span>`).join('')}
            </div>
            <div class="synopsis">
              <h4>Sinopsis</h4>
              <p>${synopsis}</p>
            </div>
            <div class="meta-box">
              ${meta['Tanggal Rilis'] || meta['Tayang'] || meta['Dirilis'] ? `<div><strong>Rilis:</strong> ${meta['Tanggal Rilis'] || meta['Tayang'] || meta['Dirilis']}</div>`  : ''}
              ${meta['Studio'] || meta['Network'] ? `<div><strong>Studio/Network:</strong> ${meta['Studio'] || meta['Network']}</div>` : ''}
              ${meta['Artis'] ? `<div class="full"><strong>Pemeran:</strong> ${meta['Artis']}</div>` : ''}
              ${meta['Sutradara'] ? `<div class="full"><strong>Sutradara:</strong> ${meta['Sutradara']}</div>` : ''}
            </div>
            ${episodes.length ? `
              <a href="/?mode=${mode}&url=${encodeURIComponent(episodes[0].epLink)}" class="cta-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Tonton Episode ${episodes[0].epNum||'1'}
              </a>
            ` : ''}
          </div>
        </div>

        <div class="ep-section-card">
          <div class="sec-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/>
            </svg>
            Daftar Episode <span style="color:var(--txt-3);font-weight:400">(${episodes.length})</span>
          </div>
          <div class="ep-grid">
            ${episodes.map(ep => `
              <a href="/?mode=${mode}&url=${encodeURIComponent(ep.epLink)}" class="ep-row">
                <div class="ep-circle">${ep.epNum||'?'}</div>
                <div class="ep-row-info">
                  <span class="ep-row-title">${ep.epTitle}</span>
                  ${ep.epDate ? `<span class="ep-row-date">${ep.epDate}</span>` : ''}
                </div>
                <div class="ep-play-ico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </div>
              </a>
            `).join('')}
          </div>
        </div>
      `;

      const pageHtml = masterLayout({ title: seriesTitle, sidebarHtml, contentHtml, pageType: 'series', searchQuery, mode, isActivity });
      sendHtml(200, pageHtml);
      return;
    }

    /* ─────────── CATALOG VIEW ─────────── */
    {
      const items = [];
      const seenLinks = new Set();
      const pages = [];

      if (mode === 'anime') {
        $('.venz li, .detpost, .chivsrc li').each((_, el) => {
          const a = $(el).find('a').first();
          const link = a.attr('href') || $(el).find('.thumb a, h2 a').first().attr('href') || '';
          if (!link || seenLinks.has(link)) return;
          seenLinks.add(link);

          const title = $(el).find('.jdlflm, h2, h3').first().text().replace(/\s+/g, ' ').trim();
          const img = $(el).find('img').first().attr('src') || '';
          const epBadge = $(el).find('.epz, .epztipe').first().text().replace(/\s+/g, ' ').trim();
          const typeBadge = 'Anime';
          const subBadge = 'Sub Indo';

          items.push({ link, title, img, epBadge, typeBadge, subBadge, timeAgo: '' });
        });

        $('.pagination a, .page-numbers').each((_, el) => {
          const text = $(el).text().trim();
          const href = $(el).attr('href') || '';
          const isCurrent = $(el).hasClass('current');
          if (text && !pages.some(p => p.text === text)) {
            pages.push({ text, href, isCurrent });
          }
        });
      } else {
        $('.listupd .bsx, .listupd article, article.bs').each((_,el) => {
          const link = $(el).find('a').first().attr('href') || '';
          if (!link || seenLinks.has(link)) return;
          seenLinks.add(link);

          const rawTitle = $(el).find('h2').text().trim() || $(el).find('a').attr('title') || $(el).find('.tt').text().trim() || '';
          const title    = rawTitle.replace(/\s+/g,' ').trim();

          const img      = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
          const epBadge  = $(el).find('.epx, .bt .epx').first().text().trim();
          const typeBadge= $(el).find('.typez').first().text().trim();
          const subBadge = $(el).find('.sb').first().text().trim();
          const timeAgo  = $(el).find('.timeago').first().text().trim();

          items.push({ link, title, img, epBadge, typeBadge, subBadge, timeAgo });
        });

        $('.pagination a, .hpage a, .pagination span').each((_,el) => {
          const text      = $(el).text().trim();
          const href      = $(el).attr('href') || '';
          const isCurrent = $(el).hasClass('current');
          if (text) pages.push({ text, href, isCurrent });
        });
      }

      const headingLabel = searchQuery
        ? `Hasil Pencarian: &ldquo;${searchQuery}&rdquo;`
        : (catParam ? ($('title').text().split('|')[0].split('«')[0].trim() || (mode === 'anime' ? 'Koleksi Anime' : 'Koleksi Drama')) : (mode === 'anime' ? 'Update Anime Terbaru (Otakudesu)' : 'Update Drama Terbaru (Oppadrama)'));

      const contentHtml = `
        <div class="catalog-header">
          <h2 class="catalog-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
            ${headingLabel}
          </h2>
          <span class="count-badge">${items.length} judul</span>
        </div>

        ${items.length === 0 ? `
          <div style="text-align:center;padding:60px 20px;color:var(--txt-2);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 14px;opacity:.4">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="font-size:1rem;font-weight:600">Tidak ada judul ditemukan</p>
            <p style="font-size:.87rem;margin-top:6px">Coba kategori atau kata kunci lain.</p>
          </div>
        ` : ''}

        <div class="drama-grid">
          ${items.map(item => `
            <a class="drama-card" href="/?mode=${mode}&url=${encodeURIComponent(item.link)}">
              <div class="card-thumb">
                <img src="${proxyImg(item.img)}" alt="${item.title}" loading="lazy"
                  onerror="this.src='https://placehold.co/240x340/EDE9FE/9CA3AF?text=No+Poster'"/>
                <div class="card-hover-play">
                  <div class="play-ring">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  </div>
                </div>
                <div class="card-tags-top">
                  ${item.typeBadge ? `<span class="tag tag-type">${item.typeBadge}</span>` : '<span></span>'}
                  ${item.subBadge  ? `<span class="tag tag-sub">${item.subBadge}</span>`   : ''}
                </div>
                ${item.epBadge ? `<div class="card-ep-badge"><span class="tag-ep">${item.epBadge}</span></div>` : ''}
              </div>
              <div class="card-caption">
                <h4 class="card-title" title="${item.title}">${item.title}</h4>
                ${item.timeAgo ? `<span class="card-time">${item.timeAgo}</span>` : ''}
              </div>
            </a>
          `).join('')}
        </div>

        ${pages.length ? `
          <div class="pagination">
            ${pages.map(p => {
              if (p.isCurrent) return `<span class="pg-btn active">${p.text}</span>`;
              if (p.href)      return `<a href="/?mode=${mode}&url=${encodeURIComponent(p.href)}" class="pg-btn">${p.text}</a>`;
              return `<span class="pg-btn dots">${p.text}</span>`;
            }).join('')}
          </div>
        ` : ''}
      `;

      const pageHtml = masterLayout({
        title: headingLabel.replace(/&ldquo;|&rdquo;/g,'"'),
        sidebarHtml,
        contentHtml,
        pageType: 'catalog',
        searchQuery,
        mode,
        isActivity
      });
      sendHtml(200, pageHtml);
      return;
    }

  } catch (err) {
    console.error('[MOVIE] Request failed:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Koneksi Gagal — Kamar Callista</title>
      <link rel="icon" type="image/png" href="/assets/tittle.png">
      <style>body{font-family:sans-serif;background:#F6F7FD;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
      .box{background:#fff;padding:36px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.07);text-align:center;max-width:460px}
      h2{color:#FF8F94;margin-bottom:10px}p{color:#6B7280;font-size:14px;margin-bottom:18px}
      a{background:#7B73F0;color:#fff;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px}</style>
      </head><body><div class="box">
        <h2>Koneksi Gagal</h2><p>${err.message}</p>
        <a href="/">Kembali ke Kamar Callista</a>
      </div></body></html>
    `);
  }
}

/* ============================================================
   WEBSOCKET MANAGER: MULTI-USER REALTIME NOBAR SYNC (HOST & VIEWER)
   ============================================================ */
let wss = null;
const rooms = new Map();
// roomId -> {
//   hostUserId: string,
//   hostWs: WebSocket|null,
//   disconnectTimer: Timeout|null,
//   emptyTimer: Timeout|null,
//   currentRoute: string,
//   currentTitle: string,
//   mediaState: { src: string, time: number, isPlaying: boolean, lastUpdate: number },
//   users: Map<WebSocket, string> (ws -> userId)
// }

function initWebSocket(server) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/ws/activity') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, url);
        });
      }
    } catch (_) {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req, url) => {
    const roomId = url.searchParams.get('room') || 'default-vc';
    const clientId = url.searchParams.get('cid') || ('c_' + Math.random().toString(36).substring(2, 9));

    // Jika room belum ada: client pertama otomatis dan mutlak menjadi Host
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        hostClientId: clientId, // KUNCI MUTLAK: orang pertama yang membuka adalah Host
        hostWs: ws,
        disconnectTimer: null,
        currentRoute: '/',
        currentTitle: 'Kamar Callista',
        mediaState: { src: '', time: 0, isPlaying: false, lastUpdate: Date.now() },
        users: new Map() // ws -> clientId
      });
      console.log(`[NOBAR ROOM] Room created: ${roomId}, Host: ${clientId}`);
    }

    const room = rooms.get(roomId);
    room.users.set(ws, clientId);

    // Cek peran: Hanya clientId yang cocok dengan hostClientId yang bisa menjadi Host
    let isHost = false;
    if (room.hostClientId === clientId) {
      room.hostWs = ws;
      isHost = true;
      if (room.disconnectTimer) {
        clearTimeout(room.disconnectTimer);
        room.disconnectTimer = null;
      }
    }

    // Kirim initial sync state lengkap ke partisipan
    ws.send(JSON.stringify({
      type: 'INIT_STATE',
      isHost,
      currentRoute: room.currentRoute,
      currentTitle: room.currentTitle,
      mediaState: room.mediaState,
      count: room.users.size
    }));

    // Broadcast user count terbaru ke semua penonton di room
    broadcastToRoom(roomId, { type: 'USER_COUNT', count: room.users.size });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        // 1. Host bernavigasi rute
        if (data.type === 'HOST_NAVIGATE') {
          if (room.hostClientId === clientId) {
            room.currentRoute = data.route;
            room.currentTitle = data.title || 'Tayangan Nobar';
            broadcastToRoom(roomId, {
              type: 'NAVIGATE_TO',
              route: data.route,
              title: data.title
            }, ws);
          }
        }
        // 2. Host menyinkronkan status video (src, time, isPlaying)
        else if (data.type === 'HOST_MEDIA_STATE') {
          if (room.hostClientId === clientId) {
            room.mediaState = {
              src: data.src,
              time: data.time || 0,
              isPlaying: Boolean(data.isPlaying),
              lastUpdate: Date.now()
            };
            broadcastToRoom(roomId, {
              type: 'MEDIA_SYNC',
              src: data.src,
              time: data.time || 0,
              isPlaying: Boolean(data.isPlaying),
              lastUpdate: Date.now()
            }, ws);
          }
        }
        // 3. Reaksi emoji (bebas untuk semua penonton)
        else if (data.type === 'REACTION') {
          broadcastToRoom(roomId, data, ws);
        }
        // 4. Host ganti server mirror
        else if (data.type === 'HOST_CHANGE_SERVER') {
          if (room.hostClientId === clientId) {
            broadcastToRoom(roomId, {
              type: 'CHANGE_SERVER',
              src: data.src,
              name: data.name || ''
            }, ws);
          }
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      room.users.delete(ws);

      // Jika socket yang putus adalah Host:
      if (room.hostClientId === clientId) {
        room.hostWs = null;
        if (!room.disconnectTimer) {
          // Berikan toleransi 8 detik jika host hanya sedang berpindah halaman/episode
          room.disconnectTimer = setTimeout(() => {
            // Jika dalam 8 detik host TIDAK kembali: Host telah menutup activity / keluar!
            if (!room.hostWs) {
              console.log(`[NOBAR ROOM] Host ${clientId} has left room ${roomId}. Closing activity for all.`);
              // 1. Beritahu semua partisipan bahwa sesi ditutup dan kembali ke kamar utama
              broadcastToRoom(roomId, {
                type: 'HOST_CLOSED_SESSION',
                message: 'Host telah keluar. Sesi nobar selesai.'
              });
              // 2. Putus semua koneksi partisipan tersisa
              for (const clientWs of room.users.keys()) {
                try { clientWs.close(); } catch (_) {}
              }
              // 3. Hapus seluruh data progres activity dari memori (reset ke awal)
              rooms.delete(roomId);
            }
            room.disconnectTimer = null;
          }, 8000);
        }
      }

      if (room.users.size === 0 && !room.disconnectTimer) {
        rooms.delete(roomId);
      } else {
        broadcastToRoom(roomId, { type: 'USER_COUNT', count: room.users.size });
      }
    });
  });

  return wss;
}

function broadcastToRoom(roomId, data, senderWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(data);
  for (const client of room.users.keys()) {
    if (client.readyState === WebSocket.OPEN && client !== senderWs) {
      client.send(payload);
    }
  }
}

/**
 * Cek apakah URL request merupakan bagian dari Movie Player / Activity.
 */
function isMovieRoute(pathname) {
  return pathname === '/'
    || pathname === '/anime-embed'
    || pathname === '/embed-proxy'
    || pathname === '/image-proxy'
    || pathname === '/api/movie/settings'
    || pathname === '/api/settings'
    || pathname === '/api/resolve-media'
    || pathname === '/media-stream';
}

module.exports = {
  loadConfig,
  saveConfig,
  handleMovieRequest,
  initWebSocket,
  isMovieRoute
};
