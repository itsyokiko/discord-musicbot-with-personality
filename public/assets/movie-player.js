/**
 * movie-player.js — Callista Kamar Client JS
 * Extracted from inline <script> to comply with Discord Desktop CSP
 * (script-src 'self' only; no 'unsafe-inline' allowed in Electron Activity iframe)
 *
 * Config is read from <body data-is-discord-env data-room-id ...>
 */

// ─── 1. Discord SDK Init ─────────────────────────────────────────────────────
(async function initOfficialDiscordSdk() {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams(window.location.search);
  const frameId = sp.get('frame_id') || (function() {
    try { return sessionStorage.getItem('dc_frame_id'); } catch (_) { return null; }
  })();
  if (!frameId) return;
  const clientId = sp.get('client_id') || (function() {
    try { return sessionStorage.getItem('dc_client_id'); } catch (_) { return null; }
  })() || '1561650922281762836';
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

// ─── 2. Runtime Config (from <body data-*>) ──────────────────────────────────
const isDiscordEnv = (function() {
  const sp = new URLSearchParams(window.location.search);
  if (sp.has('frame_id') || sp.has('instance_id')) return true;
  if (window.location.hostname.includes('discordsays.com')) return true;
  try { if (sessionStorage.getItem('dc_frame_id')) return true; } catch (_) {}
  return false;
})();
window.isDiscordEnv = isDiscordEnv;

// ─── 3. Theme ────────────────────────────────────────────────────────────────
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

(function applyStoredTheme() {
  const savedTheme = localStorage.getItem('callista_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeEmoji();
  }
})();

// ─── 4. Settings Modal ───────────────────────────────────────────────────────
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

// ─── 5. Sidebar & Panel ──────────────────────────────────────────────────────
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
  document.body.classList.remove('episode-open');
}

function toggleEpisodePanel() {
  const ep = document.getElementById('episodePanel');
  const bd = document.getElementById('sidebarBackdrop');
  if (!ep) return;
  const isOpen = ep.classList.toggle('open');
  if (bd) bd.classList.toggle('show', isOpen);
  document.body.classList.toggle('episode-open', isOpen);
}

// ─── 6. Page Transition Overlay ──────────────────────────────────────────────
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

document.addEventListener('click', function(e) {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
  if (a.target === '_blank') return;
  if (document.body.classList.contains('is-viewer') && document.documentElement.classList.contains('activity-mode-on')) return;
  showPageLoading('Membuka ' + (a.textContent.trim().substring(0, 25) || 'halaman') + '…');
});

window.addEventListener('beforeunload', function() {
  showPageLoading('Memuat tayangan…');
});

// ─── 7. Ad Shield & Misc ─────────────────────────────────────────────────────
function toggleAdShield() {
  const btn = document.getElementById('adBtn');
  const lbl = document.getElementById('adLbl');
  if (!btn) return;
  const isOn = btn.classList.toggle('on');
  if (lbl) lbl.textContent = isOn ? 'Shield: ON' : 'Shield: OFF';
}

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
    url.searchParams.set('activity', '0');
  }
  window.location.href = url.toString();
}

function reloadPlayer() {
  const frame = document.getElementById('playerFrame');
  const v = document.getElementById('callistaVideo');
  if (window._currentPlayerMode === 'local' && v && v.src) {
    const src = v.src;
    v.src = '';
    setTimeout(function() { v.src = src; }, 100);
  } else if (frame && frame.src) {
    const src = frame.src;
    frame.src = '';
    setTimeout(function() { frame.src = src; }, 100);
  }
}

// ─── 8. WebSocket Realtime Sync ──────────────────────────────────────────────
window.isHost = false;
window._wsReady = false;
window._currentPlayerMode = 'local';
window._isInternalMediaSync = false;
let ws = null;

const myClientId = (function() {
  let cid = '';
  try { cid = sessionStorage.getItem('callista_client_id'); } catch (_) {}
  if (!cid) {
    cid = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    try { sessionStorage.setItem('callista_client_id', cid); } catch (_) {}
  }
  return cid;
})();

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
  u.searchParams.delete('user_id');
  u.searchParams.delete('uid');
  u.searchParams.delete('cid');
  ['frame_id', 'instance_id', 'client_id', 'platform', 'channel_id', 'guild_id'].forEach(function(p) {
    const val = getStoredDcParam(p);
    if (val && !u.searchParams.has(p)) u.searchParams.set(p, val);
  });
  return u.pathname + u.search;
}

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
      v.controls = false;
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

function handleWsIncoming(data) {
  if (data.type === 'INIT_STATE') {
    updateRoleUI(data.isHost);
    const countEl = document.getElementById('roomMemberCount');
    if (countEl && data.count) countEl.textContent = '👥 ' + data.count + ' Penonton';
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
        setTimeout(function() { window.location.href = buildActivityUrl(data.currentRoute); }, 250);
        return;
      }
    }
    if (!data.isHost && data.mediaState && data.mediaState.src) {
      setTimeout(function() { syncViewerToMediaState(data.mediaState); }, 500);
    }
  } else if (data.type === 'NAVIGATE_TO') {
    if (!window.isHost && data.route) {
      showSyncToast('🎬 Host membuka: ' + (data.title || 'tayangan baru'));
      showPageLoading('🎬 Host membuka: ' + (data.title || 'tayangan baru') + '…');
      setTimeout(function() { window.location.href = buildActivityUrl(data.route); }, 200);
    }
  } else if (data.type === 'HOST_CLOSED_SESSION') {
    showSyncToast('🎬 ' + (data.message || 'Host telah keluar. Sesi nobar selesai.'));
    showPageLoading('Host telah keluar. Sesi nobar selesai…');
    setTimeout(function() {
      try { sessionStorage.removeItem('callista_client_id'); } catch (_) {}
      window.location.href = '/';
    }, 1200);
  } else if (data.type === 'MEDIA_SYNC') {
    if (!window.isHost) syncViewerToMediaState(data);
  } else if (data.type === 'USER_COUNT') {
    const countEl = document.getElementById('roomMemberCount');
    if (countEl) countEl.textContent = '👥 ' + data.count + ' Penonton';
  } else if (data.type === 'ROLE_UPDATE') {
    updateRoleUI(data.isHost);
    showSyncToast(data.isHost ? '👑 Anda sekarang Host!' : '👁️ Peran berpindah ke Penonton');
  } else if (data.type === 'REACTION') {
    spawnFloatingEmoji(data.emoji);
  } else if (data.type === 'CHANGE_SERVER') {
    if (!window.isHost) {
      showSyncToast('🔄 Host ganti server: ' + (data.name || 'baru'));
      const frame = document.getElementById('playerFrame');
      const loader = document.getElementById('playerLoader');
      // Aktifkan tombol server yang sesuai berdasarkan data-src
      document.querySelectorAll('.srv-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.src === data.src);
      });
      if (loader) loader.style.display = 'flex';
      if (frame) frame.src = data.src;
      if (window._currentPlayerMode === 'local') {
        loadMediaToLocalPlayer(data.src);
      } else {
        setTimeout(function() { if (loader) loader.style.display = 'none'; }, 1500);
      }
    }
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

// ─── 9. Local Player ─────────────────────────────────────────────────────────
function initCallistaVideoEvents() {
  const v = document.getElementById('callistaVideo');
  if (!v || v._eventsInitialized) return;
  v._eventsInitialized = true;
  v.addEventListener('play', function() { sendMediaSync(true); });
  v.addEventListener('pause', function() { sendMediaSync(false); });
  v.addEventListener('seeked', function() { sendMediaSync(!v.paused); });
}

// Heartbeat
setInterval(function() {
  if (window.isHost && ws && ws.readyState === WebSocket.OPEN) {
    const v = document.getElementById('callistaVideo');
    if (v && v.src && !v.paused) sendMediaSync(true);
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
      const isAct = document.documentElement.classList.contains('activity-mode-on') || isDiscordEnv;
      const targetSrc = (isAct && res.proxyUrl) ? res.proxyUrl : (res.directUrl || res.rawUrl);
      const isHLS = /\.m3u8/i.test(targetSrc);

      if (window._hlsInstance) {
        window._hlsInstance.destroy();
        window._hlsInstance = null;
      }

      if (isHLS && window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
          enableWorker: false,
          xhrSetup: function(xhr, url) {
            if (!url.startsWith('/') && !url.startsWith(window.location.origin)) {
              xhr.open('GET', '/media-stream?url=' + encodeURIComponent(url), true);
            }
          }
        });
        window._hlsInstance = hls;
        hls.loadSource(targetSrc);
        hls.attachMedia(v);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
          if (loader) loader.style.display = 'none';
          v.play().catch(function() {});
        });
        hls.on(window.Hls.Events.ERROR, function(event, data) {
          if (data.fatal) {
            hls.destroy();
            window._hlsInstance = null;
            setPlayerMode('embed');
          }
        });
      } else if (isHLS && v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = targetSrc;
        v.onloadedmetadata = function() { if (loader) loader.style.display = 'none'; };
        v.onerror = function() { setPlayerMode('embed'); };
      } else if (!isHLS) {
        v.src = targetSrc;
        v.onloadedmetadata = function() { if (loader) loader.style.display = 'none'; };
        v.onerror = function() {
          if (res.proxyUrl && v.src !== res.proxyUrl) {
            v.src = res.proxyUrl;
            v.onerror = function() { setPlayerMode('embed'); };
          } else if (res.directUrl && v.src !== res.directUrl) {
            v.src = res.directUrl;
            v.onerror = function() { setPlayerMode('embed'); };
          } else {
            setPlayerMode('embed');
          }
        };
      } else {
        setPlayerMode('embed');
      }

      v.style.display = 'block';
      if (frame) frame.style.display = 'none';
      document.getElementById('btnLocalMode')?.classList.add('active');
      document.getElementById('btnEmbedMode')?.classList.remove('active');
      window._currentPlayerMode = 'local';
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
    if (v) { v.pause(); v.style.display = 'none'; }
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
  if (frame) frame.src = src;
  if (window._currentPlayerMode === 'local') loadMediaToLocalPlayer(src);
  if (ws && ws.readyState === WebSocket.OPEN && window.isHost) {
    ws.send(JSON.stringify({ type: 'HOST_CHANGE_SERVER', src, name: btn.textContent.trim() }));
  }
}

function onFrameLoad() {
  const loader = document.getElementById('playerLoader');
  if (loader) loader.style.display = 'none';
  const v = document.getElementById('callistaVideo');
  if (v && !v.src) {
    const frame = document.getElementById('playerFrame');
    if (frame && frame.src) loadMediaToLocalPlayer(frame.src);
  }
}

function sendReaction(emoji) {
  spawnFloatingEmoji(emoji);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'REACTION', emoji }));
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

function toggleVideoFullscreen() {
  const box = document.getElementById('videoBox');
  const btn = document.getElementById('fsBtnText');
  const floatFs = document.getElementById('floatFsBtn');
  if (!box) return;
  const isFs = box.classList.toggle('fs-active');
  document.body.classList.toggle('in-fullscreen', isFs);
  if (btn) btn.textContent = isFs ? 'Tutup' : 'Fullscreen';
  if (floatFs) floatFs.title = isFs ? 'Keluar Fullscreen' : 'Fullscreen';
  document.body.style.overflow = isFs ? 'hidden' : '';
  if (isFs && document.fullscreenEnabled && !document.fullscreenElement) {
    try { box.requestFullscreen().catch(function() {}); } catch (_) {}
  } else if (!isFs && document.fullscreenElement) {
    try { document.exitFullscreen().catch(function() {}); } catch (_) {}
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeSidebar();
  }
});

// ─── 10. Activity Navigation Intercept ───────────────────────────────────────
document.addEventListener('click', function(e) {
  if (!document.documentElement.classList.contains('activity-mode-on')) return;
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || a.pathname === '/settings') return;
  if (!window.isHost) {
    e.preventDefault();
    showSyncToast('👁️ Hanya Host yang dapat memilih tayangan');
    return;
  }
  if (a.origin === window.location.origin) {
    e.preventDefault();
    const nextUrl = buildActivityUrl(a.pathname + a.search);
    notifyHostNavigate(nextUrl, a.textContent.trim() || document.title);
    showPageLoading('Membuka ' + (a.textContent.trim().substring(0, 25) || 'tayangan') + '…');
    setTimeout(function() { window.location.href = nextUrl; }, 120);
  }
});

// ─── 11. Event Delegation (replaces all onclick= attributes) ─────────────────
document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'toggleSidebar') { toggleSidebar(); }
  else if (action === 'closeSidebar') { closeSidebar(); }
  else if (action === 'toggleEpisodePanel') { toggleEpisodePanel(); }
  else if (action === 'openSettingsModal') { openSettingsModal(); }
  else if (action === 'closeSettingsModal') { closeSettingsModal(); }
  else if (action === 'saveDomainSettings') { saveDomainSettings(); }
  else if (action === 'toggleTheme') { toggleTheme(); }
  else if (action === 'toggleAdShield') { toggleAdShield(); }
  else if (action === 'toggleActivityMode') { toggleActivityMode(); }
  else if (action === 'reloadPlayer') { reloadPlayer(); }
  else if (action === 'toggleVideoFullscreen') { toggleVideoFullscreen(); }
  else if (action === 'toggleViewerMute') { toggleViewerMute(); }
  else if (action === 'setPlayerModeLocal') { setPlayerMode('local'); }
  else if (action === 'setPlayerModeEmbed') { setPlayerMode('embed'); }
  else if (action === 'sendReaction') { sendReaction(el.dataset.emoji || el.textContent.trim()); }
  else if (action === 'changeServer') { changeServer(el, el.dataset.src); }
});

document.addEventListener('input', function(e) {
  if (e.target.id === 'viewerVolSlider') setViewerVolume(e.target.value);
});

// iframe onload via event (not attribute)
document.addEventListener('DOMContentLoaded', function() {
  const frame = document.getElementById('playerFrame');
  if (frame) frame.addEventListener('load', onFrameLoad);

  // Auto-connect WS
  if (isDiscordEnv && document.documentElement.classList.contains('activity-mode-on')) {
    initActivityWebSocket();
  }
});
