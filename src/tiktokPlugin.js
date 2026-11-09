/**
 * TikTok extractor untuk DisTube v5.
 *
 * Mengambil stream URL audio/video dari halaman TikTok tanpa library eksternal.
 * Mendukung:
 * - URL pendek:  vt.tiktok.com/xxx, vm.tiktok.com/xxx
 * - URL lengkap: www.tiktok.com/@user/video/ID
 *
 * Stream URL yang dikembalikan adalah MP4 (ada audio), lalu DisTube/ffmpeg
 * akan mengambil track audionya. Ini cukup karena konten TikTok rata-rata
 * pendek (15–60 detik).
 *
 * ponytail: Scraping HTML TikTok. Kalau TikTok ganti struktur JSON-nya,
 *           extractor ini perlu update. Upgrade path: ganti ke library
 *           dedicated (misal @tobyg74/tiktok-api-dl) atau API TikTok resmi.
 */

'use strict';

const https = require('node:https');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { ExtractorPlugin, Song } = require('distube');

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
]);

function isTikTokUrl(input) {
  try {
    const raw = String(input || '').trim();
    if (!raw) return false;
    const str = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(str);
    return TIKTOK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function extractVideoId(url) {
  const m = String(url).match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

/** GET dengan follow redirect sekali (untuk short URL). */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body, cookies }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('TikTok request timeout')); });
  });
}

/**
 * Extract string value from JSON-in-HTML.
 * Handles Unicode escapes (\u002F → /) and standard JSON escape sequences.
 */
function extractJsonStr(body, key) {
  const search = `"${key}":"`;
  const start = body.indexOf(search);
  if (start === -1) return null;
  let i = start + search.length;
  let result = '';
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\\') {
      const next = body[i + 1];
      if (next === 'u' && /[0-9a-fA-F]{4}/.test(body.substring(i + 2, i + 6))) {
        result += String.fromCharCode(parseInt(body.substring(i + 2, i + 6), 16));
        i += 6;
      } else if (next === '"') { result += '"'; i += 2; }
      else if (next === '\\') { result += '\\'; i += 2; }
      else if (next === 'n') { result += '\n'; i += 2; }
      else { result += ch; i++; }
    } else if (ch === '"') {
      break;
    } else {
      result += ch;
      i++;
    }
  }
  return result || null;
}

function extractJsonNum(body, key) {
  const search = `"${key}":`;
  const start = body.indexOf(search);
  if (start === -1) return null;
  const m = body.substring(start + search.length, start + search.length + 20).match(/^(\d+)/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Fetch halaman TikTok dan extract metadata + stream URL.
 * @param {string} inputUrl URL TikTok (short atau long)
 * @returns {{ id, url, name, streamUrl, thumbnail, duration, uploader }}
 */
async function fetchTikTokInfo(inputUrl) {
  let pageUrl = String(inputUrl).trim();

  // Follow redirect sampai dapat body HTML (maks 5 hop)
  for (let hop = 0; hop < 5; hop++) {
    const r = await httpsGet(pageUrl);
    if (r.redirect) {
      // Redirect — ikuti
      const resolved = new URL(r.redirect, pageUrl);
      pageUrl = `${resolved.origin}${resolved.pathname}`; // drop query params
      continue;
    }
    if (!r.body || r.status !== 200) {
      throw new Error(`TikTok: HTTP ${r.status}`);
    }

    // Extract video ID
    const videoId = extractVideoId(pageUrl);
    if (!videoId) throw new Error('TikTok: gagal parse video ID dari URL');

    const body = r.body;
    const playAddr = extractJsonStr(body, 'playAddr');
    if (!playAddr) throw new Error('TikTok: stream URL tidak ditemukan (mungkin video private/dihapus)');

    const desc = extractJsonStr(body, 'desc');
    const duration = extractJsonNum(body, 'duration');
    const thumbnail = extractJsonStr(body, 'originCover') || extractJsonStr(body, 'cover');
    const uploader = extractJsonStr(body, 'nickname') || extractJsonStr(body, 'uniqueId') || 'TikTok';

    const name = desc && desc.trim()
      ? desc.trim().replace(/\s+/g, ' ').substring(0, 120)
      : `TikTok ${videoId}`;

    return {
      id: videoId,
      url: pageUrl,         // canonical URL dengan @username, bisa di-fetch ulang
      name,
      streamUrl: playAddr,
      cookies: r.cookies || '',  // ttwid dll — wajib untuk akses CDN
      thumbnail: thumbnail || undefined,
      duration: duration || 0,
      uploader,
    };
  }
  throw new Error('TikTok: terlalu banyak redirect');
}

/**
 * Buka koneksi ke CDN TikTok dengan header yang benar.
 * TikTok CDN menolak request tanpa cookie session (ttwid) — sudah diuji:
 * tanpa cookie selalu 403. Karena ffmpeg tidak bisa mengirim header, stream
 * ini harus diproksi lewat localhost (lihat ensureProxy).
 *
 * `start` = byte offset untuk Range; dipakai juga saat menyambung ulang kalau
 * CDN memutus koneksi di tengah video.
 *
 * Resolve dengan { statusCode, headers, stream } supaya proxy bisa meneruskan
 * status + Content-Range asli ke ffmpeg sebelum body dikirim.
 */
function openStream(url, cookies, start = 0, end = null, _depth = 0) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      'Referer': 'https://www.tiktok.com/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Range': `bytes=${start}-${end != null ? end : ''}`,
    };
    if (cookies) headers['Cookie'] = cookies;

    const client = String(url).startsWith('http:') ? http : https;
    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && _depth < 3) {
        res.resume();
        resolve(openStream(new URL(res.headers.location, url).href, cookies, start, end, _depth + 1));
        return;
      }
      resolve({ statusCode: res.statusCode, headers: res.headers, stream: res });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('TikTok stream timeout')); });
  });
}

/* ===== Proxy stream lokal =====
   DisTube v5 mewajibkan getStreamURL() mengembalikan string URL, lalu string
   itu diserahkan ke ffmpeg. ffmpeg tidak bisa membawa Cookie/Referer, jadi
   plugin menyediakan HTTP server kecil di 127.0.0.1 yang menyuntikkan header
   tersebut lalu mem-pipe stream TikTok. ffmpeg cukup membaca URL localhost.

   Proxy ini meneruskan dukungan HTTP Range + melanjutkan unduhan dari byte
   terakhir kalau CDN memutus koneksi di tengah video. Tanpa resume, video
   panjang (mis. 11 menit) berhenti di ~2 menit karena TikTok menutup koneksi
   panjang, lalu ffmpeg melihat EOF dan menganggap lagu selesai.

   ponytail: satu server global per proses, token berumur 1 jam (di-refresh
   selama dipakai), tanpa autentikasi (hanya listen di loopback). Kalau nanti
   butuh per-guild atau multi-region, pecah jadi instance proxy terpisah. */
let proxyServer = null;
let proxyPort = 0;
const proxyTokens = new Map(); // token -> { pageUrl, info, at }
const TOKEN_TTL_MS = 60 * 60 * 1000;
// ponytail: batas resume per request. 200 cukup untuk video 1 jam dengan
// koneksi CDN yang putus tiap ~2 menit; kalau CDN makin agresif, naikkan.
const MAX_RESUMES = 200;

function sweepTokens() {
  const now = Date.now();
  for (const [token, entry] of proxyTokens) {
    if (now - entry.at > TOKEN_TTL_MS) proxyTokens.delete(token);
  }
}

function parseRange(rangeHeader) {
  const m = /^bytes=(\d+)-(\d*)/.exec(String(rangeHeader || '').trim());
  if (!m) return { start: 0, end: null };
  return {
    start: Number(m[1]),
    end: m[2] ? Number(m[2]) : null,
  };
}

/**
 * Alirkan satu entry ke ffmpeg.
 * - Meneruskan HTTP Range dari ffmpeg (ffmpeg boleh minta sebagian file,
 *   mis. untuk baca atom moov di akhir MP4).
 * - Menyambung ulang dari byte terakhir kalau CDN memutus koneksi sebelum
 *   rentang yang diminta selesai terkirim.
 */
async function streamEntry(entry, res, start, requestedEnd) {
  let done = false;
  let position = start;
  let total = null;
  let endByte = requestedEnd;
  let current = null;
  let resumes = 0;

  res.on('close', () => {
    done = true;
    try { current?.destroy(); } catch (e) {}
  });

  const openAt = async (from, to) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let up = await openStream(entry.info.streamUrl, entry.info.cookies, from, to);
        // Stream URL TikTok TTL-nya pendek: kalau kedaluwarsa, ambil ulang sekali.
        if (up.statusCode === 403 || up.statusCode === 410) {
          up.stream.destroy();
          entry.info = await fetchTikTokInfo(entry.pageUrl);
          up = await openStream(entry.info.streamUrl, entry.info.cookies, from, to);
        }
        return up;
      } catch (e) {
        lastError = e;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw lastError;
  };

  const first = await openAt(start, requestedEnd);
  if (first.statusCode !== 200 && first.statusCode !== 206) {
    first.stream.destroy();
    res.writeHead(502);
    res.end();
    return;
  }

  const rangeTotal = /\/(\d+)\s*$/.exec(String(first.headers['content-range'] || ''));
  if (rangeTotal) total = Number(rangeTotal[1]);
  else if (first.statusCode === 200 && first.headers['content-length']) {
    total = Number(first.headers['content-length']);
  }

  if (total != null) {
    endByte = endByte == null ? total - 1 : Math.min(endByte, total - 1);
    if (start >= total) {
      first.stream.destroy();
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
  }

  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  if (endByte != null) {
    headers['Content-Length'] = String(endByte - start + 1);
    if (start > 0 || requestedEnd != null) {
      headers['Content-Range'] = `bytes ${start}-${endByte}/${total ?? '*'}`;
    }
  } else if (total != null) {
    headers['Content-Length'] = String(total - start);
  }
  res.writeHead(start > 0 || requestedEnd != null ? 206 : 200, headers);

  const attach = (stream, skipBytes) => {
    current = stream;
    let skip = skipBytes;
    let settled = false;
    let reachedEnd = false;

    const finishOrResume = async (premature) => {
      if (settled || done) return;
      settled = true;
      try { stream.destroy(); } catch (e) {}

      const needsMore = reachedEnd
        ? false
        : endByte != null
          ? position <= endByte
          : premature;

      if (!needsMore) {
        done = true;
        res.end();
        return;
      }

      if (resumes++ >= MAX_RESUMES) {
        done = true;
        res.destroy();
        return;
      }

      entry.at = Date.now();
      try {
        const next = await openAt(position, endByte);
        if (next.statusCode === 200 || next.statusCode === 206) {
          // CDN yang mengabaikan Range kirim dari awal -> buang byte yang sudah terkirim.
          attach(next.stream, next.statusCode === 200 ? position : 0);
          return;
        }
        next.stream.destroy();
      } catch (e) {
        // jatuh ke destroy di bawah
      }
      done = true;
      res.destroy();
    };

    stream.on('data', (chunk) => {
      if (done) return;
      if (skip > 0) {
        if (chunk.length <= skip) {
          skip -= chunk.length;
          return;
        }
        chunk = chunk.subarray(skip);
        skip = 0;
      }

      if (endByte != null) {
        const remaining = endByte + 1 - position;
        if (remaining <= 0) {
          reachedEnd = true;
          return;
        }
        if (chunk.length >= remaining) {
          chunk = chunk.subarray(0, remaining);
          reachedEnd = true;
        }
      }

      position += chunk.length;
      if (!res.write(chunk)) {
        stream.pause();
        res.once('drain', () => { if (!done) stream.resume(); });
      }

      if (reachedEnd) {
        done = true;
        try { stream.destroy(); } catch (e) {}
        res.end();
      }
    });
    stream.on('end', () => finishOrResume(stream.complete === false));
    stream.on('error', () => finishOrResume(true));
  };

  attach(first.stream, first.statusCode === 200 && start > 0 ? start : 0);
}

async function ensureProxy() {
  if (proxyServer) return proxyPort;

  const server = http.createServer((req, res) => {
    const token = String(req.url || '').split('?')[0].replace(/^\//, '');
    const entry = proxyTokens.get(token);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }

    // Tandai masih dipakai supaya token tidak keburu disapu TTL.
    entry.at = Date.now();

    const { start, end } = parseRange(req.headers.range);
    streamEntry(entry, res, start, end).catch((e) => {
      console.error('[TIKTOK] Proxy stream error:', e.message);
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  server.on('error', (e) => console.error('[TIKTOK] Proxy error:', e.message));

  proxyServer = server;
  proxyPort = server.address().port;
  console.log(`[TIKTOK] Proxy stream lokal aktif di 127.0.0.1:${proxyPort}`);
  return proxyPort;
}

class TikTokPlugin extends ExtractorPlugin {
  constructor() {
    super();
  }

  validate(url) {
    return isTikTokUrl(url);
  }

  async resolve(url, options = {}) {
    const info = await fetchTikTokInfo(url);
    return new Song(
      {
        plugin: this,
        source: 'tiktok',
        playFromSource: true,
        id: info.id,
        name: info.name,
        url: info.url,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: { name: info.uploader },
      },
      options
    );
  }

  async getStreamURL(song) {
    // Ambil metadata + cookie segar, lalu kembalikan URL proxy localhost.
    // DisTube hanya menerima string URL di sini, bukan stream.
    const info = await fetchTikTokInfo(song.url);
    if (!info.streamUrl) throw new Error('TikTok: stream URL tidak ditemukan');

    const port = await ensureProxy();
    sweepTokens();
    const token = randomUUID();
    proxyTokens.set(token, { pageUrl: info.url, info, at: Date.now() });

    return `http://127.0.0.1:${port}/${token}`;
  }
}

module.exports = {
  TikTokPlugin,
  isTikTokUrl,
  // Dipakai test lokal (test/tiktok-proxy-test.js) untuk menyuntik origin palsu.
  __test: { proxyTokens, ensureProxy, parseRange },
};
