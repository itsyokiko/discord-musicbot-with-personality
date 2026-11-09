/**
 * Playback History Store — Riwayat putar lagu Callista.
 *
 * Menyimpan semua lagu yang pernah diputar ke data/playback_history.json.
 * Aturan:
 * - Link/URL selalu unik (deduplikasi).
 * - Lagu yang baru diputar dipindahkan ke posisi paling depan (terbaru).
 * - Persisten ke file JSON menggunakan atomic write (tmp + rename).
 */

const fs = require('node:fs');
const path = require('node:path');
const { isTikTokUrl } = require('./tiktokPlugin');

const STORE_PATH = path.resolve(__dirname, '../data/playback_history.json');
const MAX_HISTORY_ITEMS = 500;

function ensureDataDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadHistory() {
  ensureDataDir();
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data?.history)) {
        return data.history.filter((item) => {
          if (!item || !item.url) return false;
          if (isTikTokUrl(item.url) || /tiktok\.com/i.test(item.url)) return false;
          return true;
        });
      }
    }
  } catch (e) {
    console.warn('[HISTORY LOAD ERROR]', e.message);
  }
  return [];
}

let historyCache = loadHistory();

function saveHistory() {
  ensureDataDir();
  const tmpFile = `${STORE_PATH}.tmp`;
  try {
    const payload = {
      history: historyCache,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpFile, STORE_PATH);
    return true;
  } catch (e) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[HISTORY SAVE ERROR]', e.message);
    return false;
  }
}

/**
 * Catat lagu yang baru saja diputar.
 * Jika URL sudah pernah ada, pindahkan ke urutan paling atas.
 */
function addSongToHistory(song) {
  if (!song) return false;
  if (song.source === 'sfx') return false; // Jangan catat audio lokal SFX ke riwayat
  if (song.source === 'tiktok') return false; // Jangan catat TikTok ke riwayat

  const url = song.url || (song.id ? `https://www.youtube.com/watch?v=${song.id}` : null);
  if (!url) return false;
  if (isTikTokUrl(url) || isTikTokUrl(song.id) || /tiktok\.com/i.test(url)) return false; // Jangan catat link TikTok ke riwayat

  const id = song.id || url;
  const title = song.name || 'Unknown Title';
  const duration = Number(song.duration) || 0;
  const formattedDuration = song.formattedDuration || '00:00';
  const thumbnail = song.thumbnail || null;
  const playedAt = new Date().toISOString();

  // Hapus entri lama dengan URL atau ID yang sama (deduplikasi, link harus baru)
  historyCache = historyCache.filter((item) => item.url !== url && item.id !== id);

  // Masukkan di urutan paling depan
  historyCache.unshift({
    id,
    title,
    url,
    duration,
    formattedDuration,
    thumbnail,
    playedAt,
  });

  if (historyCache.length > MAX_HISTORY_ITEMS) {
    historyCache = historyCache.slice(0, MAX_HISTORY_ITEMS);
  }

  saveHistory();
  return true;
}

/**
 * Ambil daftar lagu riwayat untuk diputar.
 */
function getHistorySongs() {
  return [...historyCache];
}

/**
 * Jumlah lagu dalam riwayat.
 */
function getHistoryCount() {
  return historyCache.length;
}

/**
 * Kosongkan riwayat (untuk pengujian atau reset).
 */
function clearHistory() {
  historyCache = [];
  saveHistory();
}

module.exports = {
  addSongToHistory,
  getHistorySongs,
  getHistoryCount,
  clearHistory,
  loadHistory,
};
