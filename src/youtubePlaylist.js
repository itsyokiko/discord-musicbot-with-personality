/**
 * YouTube Playlist Resolver — pengganti @distube/ytpl.
 *
 * Latar belakang:
 * Sejak akhir 2025 YouTube mengganti struktur halaman playlist:
 * - header: `playlistHeaderRenderer` -> `pageHeaderRenderer`
 * - item video: `playlistVideoRenderer` -> `lockupViewModel`
 * - daftar video di-lazy-load (butuh continuation)
 *
 * @distube/ytpl 1.2.4 (versi terbaru) masih memakai struktur lama, sehingga
 * selalu gagal dengan "Empty playlist / Unsupported YouTube Playlist response".
 *
 * Resolver ini memakai Innertube (endpoint `browse`) langsung, mendukung
 * struktur baru + continuation, dan hanya mengambil metadata ringan
 * (judul, durasi, thumbnail). Metadata stream tetap diurus plugin DisTube.
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Fallback kalau halaman YouTube tidak bisa diambil (mis. kena 429).
const FALLBACK_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const FALLBACK_CLIENT_VERSION = '2.20261020.01.00';

const REQUEST_TIMEOUT_MS = 15000;
const CONFIG_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam
const MAX_PAGES = 12;

let cachedConfig = null;

function parseDuration(text) {
  if (!text || typeof text !== 'string') return 0;
  if (!/^\d+(:\d+)+$/.test(text.trim())) return 0; // "LIVE", "PREMIERE", dsb.
  return text
    .trim()
    .split(':')
    .reverse()
    .reduce((total, part, i) => total + (Number(part) || 0) * Math.pow(60, i), 0);
}

/** Ambil JSON setelah `var <name> = ` dengan pencocokan kurung kurawal. */
function extractJsonAfter(html, varName) {
  const marker = `var ${varName} = `;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start + marker.length, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function extractYtcfg(html) {
  const match = html.match(/ytcfg\.set\((\{.*?\})\);/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

function extractClientConfig(html) {
  const cfg = extractYtcfg(html);
  if (!cfg) return null;
  const apiKey = cfg.INNERTUBE_API_KEY;
  const clientVersion = cfg.INNERTUBE_CLIENT_VERSION;
  if (!apiKey || !clientVersion) return null;
  return {
    apiKey,
    clientVersion,
    visitorData: cfg.VISITOR_DATA || null,
    fetchedAt: Date.now(),
  };
}

async function getClientConfig(playlistId) {
  if (cachedConfig && Date.now() - cachedConfig.fetchedAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }

  const urls = [
    `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    'https://www.youtube.com/',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const config = extractClientConfig(html);
      if (config) {
        cachedConfig = config;
        return config;
      }
    } catch (e) {
      // coba URL berikutnya
    }
  }

  // Fallback supaya tetap bisa mencoba walau halaman tidak bisa diambil
  cachedConfig = {
    apiKey: FALLBACK_API_KEY,
    clientVersion: FALLBACK_CLIENT_VERSION,
    visitorData: null,
    fetchedAt: Date.now(),
  };
  return cachedConfig;
}

async function browse(config, payload) {
  const url =
    'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false' +
    (config.apiKey ? `&key=${config.apiKey}` : '');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': DEFAULT_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': config.clientVersion,
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: config.clientVersion,
          hl: 'en',
          gl: 'US',
          ...(config.visitorData ? { visitorData: config.visitorData } : {}),
        },
      },
      ...payload,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`YouTube browse HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Telusuri seluruh objek, kumpulkan video dari renderer lama & baru.
 * @returns {{videos: Array, continuation: string|null, alerts: string[]}}
 */
function collectFromResponse(root) {
  const videos = [];
  const seen = new Set();
  const alerts = [];
  let continuation = null;

  function addVideo(id, title, duration, thumbnail) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    videos.push({
      id,
      title: title || '',
      duration: duration || 0,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  }

  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 60) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    // Struktur baru (2025+)
    const lockup = node.lockupViewModel;
    if (lockup && lockup.contentId) {
      const isVideo =
        !lockup.contentType || String(lockup.contentType).toUpperCase().includes('VIDEO');
      if (isVideo) {
        const meta = lockup.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || meta?.title?.simpleText || '';
        let duration = 0;
        const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || [];
        for (const overlay of overlays) {
          const badges = overlay?.thumbnailBottomOverlayViewModel?.badges || [];
          for (const badge of badges) {
            const text = badge?.thumbnailBadgeViewModel?.text;
            if (text && /^\d+(:\d+)+$/.test(text)) {
              duration = parseDuration(text);
              break;
            }
          }
          if (duration) break;
        }
        addVideo(lockup.contentId, title, duration);
      }
    }

    // Struktur lama (fallback)
    const legacy = node.playlistVideoRenderer;
    if (legacy && legacy.videoId) {
      const title =
        legacy.title?.runs?.map((r) => r.text).join('') ||
        legacy.title?.simpleText ||
        '';
      addVideo(
        legacy.videoId,
        title,
        parseDuration(legacy.lengthText?.simpleText),
        legacy.thumbnail?.thumbnails?.slice(-1)?.[0]?.url
      );
    }

    // Token continuation (beberapa bentuk)
    if (!continuation) {
      const cont =
        node.continuationItemViewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token ||
        node.continuationItemViewModel?.continuationCommand?.token ||
        node.continuationItemViewModel?.button?.buttonRenderer?.command?.continuationCommand?.token ||
        node.continuationCommand?.token ||
        node.nextContinuationData?.continuation;
      if (cont) continuation = cont;
    }

    // Pesan error dari YouTube (mis. playlist private)
    if (node.alertRenderer || node.alertWithButtonRenderer) {
      const alert = node.alertRenderer || node.alertWithButtonRenderer;
      const text =
        alert.text?.runs?.map((r) => r.text).join('') ||
        alert.text?.simpleText ||
        '';
      if (text) alerts.push(text);
    }

    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  }

  walk(root, 0);
  return { videos, continuation, alerts };
}

function extractTitle(root) {
  return (
    root?.metadata?.playlistMetadataRenderer?.title ||
    root?.header?.pageHeaderRenderer?.pageTitle ||
    root?.header?.playlistHeaderRenderer?.title?.simpleText ||
    root?.header?.pageHeaderViewModel?.title?.dynamicTextViewModel?.text?.content ||
    null
  );
}

/**
 * Ambil daftar video sebuah playlist.
 * @param {string} playlistId
 * @param {{maxSongs?: number}} [options]
 * @returns {Promise<{id: string, name: string, videos: Array}>}
 */
async function fetchPlaylist(playlistId, { maxSongs = 100 } = {}) {
  if (!playlistId) throw new Error('Playlist ID kosong');

  const config = await getClientConfig(playlistId);
  const first = await browse(config, { browseId: `VL${playlistId}` });

  const title = extractTitle(first) || 'YouTube Playlist';
  let { videos, continuation, alerts } = collectFromResponse(first);

  let pages = 0;
  while (continuation && videos.length < maxSongs && pages < MAX_PAGES) {
    const next = await browse(config, { continuation });
    const parsed = collectFromResponse(next);
    videos = videos.concat(parsed.videos);
    // dedupe
    const unique = new Map();
    for (const v of videos) unique.set(v.id, v);
    videos = [...unique.values()];
    continuation = parsed.continuation;
    if (parsed.alerts.length) alerts = alerts.concat(parsed.alerts);
    pages++;
  }

  if (videos.length > maxSongs) videos = videos.slice(0, maxSongs);

  if (!videos.length) {
    const reason = alerts.length ? alerts.join(' ') : null;
    const err = new Error(
      reason
        ? `Playlist tidak bisa diakses: ${reason}`
        : 'Playlist kosong atau tidak bisa diakses (mungkin private/dihapus)'
    );
    err.code = 'EMPTY_PLAYLIST';
    throw err;
  }

  return { id: playlistId, name: title, videos };
}

/**
 * Ambil ID playlist dari URL YouTube (atau ID mentah).
 * @param {string} input
 * @returns {string|null}
 */
function extractPlaylistId(input) {
  if (!input) return null;
  const value = String(input).trim();

  // ID mentah
  if (/^(PL|UU|OL|LL|FL|RD|WL)[A-Za-z0-9_-]{10,}$/.test(value)) return value;

  try {
    const url = new URL(value);
    const list = url.searchParams.get('list');
    if (list) return list;
  } catch (e) {
    // bukan URL
  }
  return null;
}

module.exports = {
  fetchPlaylist,
  extractPlaylistId,
  parseDuration,
};
