/**
 * Lyrics Store — Pengambil & penyimpan lirik lagu via LRCLIB API.
 *
 * Fitur:
 * - Membersihkan judul YouTube dari noise ([OFFICIAL VIDEO], ft., dll).
 * - Mencari lirik sinkron (LRC dengan timestamp) ke LRCLIB API (gratis, tanpa API key).
 * - Menyimpan lirik ke data/lyrics_cache.json (atomic write via tmp+rename).
 * - Parser LRC ke array baris berwaktu [{ time: detik, text: string }].
 * - Helper getSnippet(lines, currentTime) untuk tampilan karaoke 3 baris di Discord embed.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const CACHE_FILE = path.resolve(__dirname, '../data/lyrics_cache.json');
const MAX_CACHE_ENTRIES = 1000;

function ensureDataDir() {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCache() {
  ensureDataDir();
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') return data;
    }
  } catch (e) {
    console.warn('[LYRICS] Gagal membaca lyrics_cache.json:', e.message);
  }
  return {};
}

let cache = loadCache();

function saveCache() {
  ensureDataDir();
  const tmpFile = `${CACHE_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmpFile, CACHE_FILE);
    return true;
  } catch (e) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[LYRICS] Gagal menyimpan lyrics_cache.json:', e.message);
    return false;
  }
}

/**
 * Bersihkan judul lagu YouTube agar mudah dicocokkan di LRCLIB API.
 * Menghapus: [OFFICIAL VIDEO], (Audio), [MV], ft./feat., 4K, HD, dll.
 */
function cleanSongTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let title = rawTitle;

  // Hapus tag bracket [] dan () yang berisi kata-kata umum video/audio
  title = title.replace(/\[(?:official\s*(?:music\s*)?video|official\s*audio|video|audio|mv|lyrics?|visualizer|clip|hd|4k|remastered|live)\]/gi, ' ');
  title = title.replace(/\((?:official\s*(?:music\s*)?video|official\s*audio|video|audio|mv|lyrics?|visualizer|clip|hd|4k|remastered|live)\)/gi, ' ');

  // Hapus pola bracket tersisa jika berisi official/video dsb
  title = title.replace(/\[[^\]]*(?:official|video|audio|lyrics?|clip)[^\]]*\]/gi, ' ');
  title = title.replace(/\([^)]*(?:official|video|audio|lyrics?|clip)[^)]*\)/gi, ' ');

  // Bersihkan karakter pemisah berlebih
  title = title.replace(/[:|]/g, ' ');
  title = title.replace(/\s+/g, ' ').trim();

  return title;
}

/**
 * Buat key normalisasi untuk caching.
 */
function normalizeKey(title) {
  return cleanSongTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse string LRC menjadi array baris berwaktu.
 * Format LRC: [mm:ss.xx] teks
 */
function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = [];
  const rawLines = lrcText.split(/\r?\n/);

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Lewati metadata seperti [ar: artist], [ti: title], [length: ...]
    if (/^\[[a-z]+:/i.test(trimmed)) continue;

    // Menangani timestamp berganda [00:10.00][00:20.00] text
    const timeMatches = [...trimmed.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/g)];
    if (!timeMatches.length) continue;

    const text = trimmed.replace(/(?:\[\d{1,2}:\d{2}(?:\.\d+)?\])+/g, '').trim();
    if (!text) continue;

    for (const match of timeMatches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const totalSeconds = Math.max(0, minutes * 60 + seconds);
      lines.push({ time: totalSeconds, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Ambil cuplikan karaoke 3 baris berdasarkan detik aktif saat ini.
 * @param {Array<{time: number, text: string}>} lines
 * @param {number} currentTime
 */
function getCurrentSnippet(lines, currentTime = 0) {
  if (!Array.isArray(lines) || !lines.length) return null;

  const t = Math.max(0, Number(currentTime) || 0);
  let idx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) {
      idx = i;
    } else {
      break;
    }
  }

  // Jika lagu masih di intro sebelum lirik pertama
  if (idx === -1) {
    return {
      prev: null,
      current: { time: 0, text: '🎵 (Musik / Intro)' },
      next: lines[0] || null,
    };
  }

  const current = lines[idx];
  const prev = idx > 0 ? lines[idx - 1] : null;
  const next = idx < lines.length - 1 ? lines[idx + 1] : null;

  return { prev, current, next };
}

/**
 * HTTP GET request helper untuk LRCLIB API (zero-dependency).
 */
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'CallistaDiscordBot/1.0 (https://github.com/callista)',
          'Accept': 'application/json',
        },
        timeout: 6000,
      },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          return resolve(null);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Invalid JSON dari LRCLIB'));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LRCLIB request timeout'));
    });
    req.on('error', reject);
  });
}

/**
 * Ambil lirik lagu. Cek cache JSON dulu, jika tidak ada cari ke LRCLIB.
 * @param {string} rawTitle - Judul lagu dari YouTube / player
 * @param {string} [artist] - Opsional nama artis
 * @param {number} [duration] - Durasi lagu dalam detik (opsional)
 */
async function getLyrics(rawTitle, artist = '', duration = 0) {
  if (!rawTitle) return null;

  const key = normalizeKey(artist ? `${artist} ${rawTitle}` : rawTitle);
  if (!key) return null;

  // 1. Cek cache lokal
  if (cache[key]) {
    if (cache[key].notFound) return null;
    return cache[key];
  }

  // 2. Bersihkan query untuk pencarian
  const cleaned = cleanSongTitle(rawTitle);
  const cleanArtist = cleanSongTitle(artist);
  const query = cleanArtist ? `${cleanArtist} ${cleaned}` : cleaned;

  try {
    let chosen = null;

    // A. Coba exact match API terlebih dahulu jika artist diketahui
    if (cleanArtist && cleaned) {
      try {
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleaned)}&artist_name=${encodeURIComponent(cleanArtist)}${duration > 0 ? `&duration=${Math.round(duration)}` : ''}`;
        const exact = await httpGetJson(getUrl);
        if (exact && (exact.syncedLyrics || exact.plainLyrics)) {
          chosen = exact;
        }
      } catch (_) {}
    }

    // B. Coba search query umum jika exact match belum ketemu
    if (!chosen) {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const results = await httpGetJson(searchUrl);
      if (Array.isArray(results) && results.length > 0) {
        chosen = results.find((r) => r && r.syncedLyrics) || results[0];
      }
    }

    // C. Fallback search hanya dengan judul jika sebelumnya dengan artist nihil
    if (!chosen && cleanArtist) {
      try {
        const fallbackUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleaned)}`;
        const fallbackResults = await httpGetJson(fallbackUrl);
        if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
          chosen = fallbackResults.find((r) => r && r.syncedLyrics) || fallbackResults[0];
        }
      } catch (_) {}
    }

    if (chosen && (chosen.syncedLyrics || chosen.plainLyrics)) {
      const parsedLines = chosen.syncedLyrics ? parseLrc(chosen.syncedLyrics) : [];
      const entry = {
        trackName: chosen.trackName || cleaned,
        artistName: chosen.artistName || artist || '',
        hasSynced: Boolean(chosen.syncedLyrics && parsedLines.length > 0),
        lines: parsedLines,
        plainLyrics: chosen.plainLyrics || '',
        updatedAt: new Date().toISOString(),
      };

      cache[key] = entry;

      // Jaga ukuran cache
      const keys = Object.keys(cache);
      if (keys.length > MAX_CACHE_ENTRIES) {
        delete cache[keys[0]];
      }

      saveCache();
      return entry;
    }

    // Catat not found agar tidak spam API untuk lagu tanpa lirik
    cache[key] = { notFound: true, updatedAt: new Date().toISOString() };
    saveCache();
    return null;
  } catch (err) {
    console.warn(`[LYRICS] Gagal mencari lirik untuk "${query}":`, err.message);
    return null;
  }
}

/**
 * Hapus seluruh cache lirik (untuk testing).
 */
function clearCache() {
  cache = {};
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch (_) {}
}

module.exports = {
  cleanSongTitle,
  normalizeKey,
  parseLrc,
  getCurrentSnippet,
  getLyrics,
  clearCache,
  __test: {
    CACHE_FILE,
  },
};
