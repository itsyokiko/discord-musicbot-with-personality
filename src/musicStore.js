/**
 * Music Player Store — simpan & kelola playlist favorit untuk Mas Joy.
 *
 * Penyimpanan:
 * - data/playlists.json: daftar playlist (URL + nama + aliases + cached video IDs)
 * - Runtime: DisTube handle queue/shuffle/skip pada guild tertentu
 *
 * Aturan:
 * - Hanya Mas Joy yang bisa menyimpan/play playlist.
 * - Non-Mas Joy yang suruh putar → ditolak dengan alasan natural.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.resolve(__dirname, '../data');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');

const MAS_JOY_USER_ID = '833196669940138004';
const FAVORITES_NAME = 'Favorit';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPlaylists() {
  ensureDataDir();
  try {
    if (fs.existsSync(PLAYLISTS_FILE)) {
      const raw = fs.readFileSync(PLAYLISTS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
        cachedAt: parsed.cachedAt || null,
      };
    }
  } catch (e) {
    console.error('[PLAYLISTS LOAD ERROR]', e.message);
  }
  return { playlists: [], cachedAt: null };
}

function savePlaylists(data) {
  ensureDataDir();
  const tmpFile = `${PLAYLISTS_FILE}.tmp`;
  try {
    const toWrite = { ...data, cachedAt: new Date().toISOString() };
    fs.writeFileSync(tmpFile, JSON.stringify(toWrite, null, 2), 'utf8');
    fs.renameSync(tmpFile, PLAYLISTS_FILE);
    console.log('[PLAYLISTS] Saved');
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
    return false;
  }
}

function addPlaylist({ name, url, type = 'youtube_playlist', addedBy = 'Mas Joy', aliases = [] }) {
  if (!name || !url) return { success: false, error: 'Nama dan URL wajib diisi' };
  const data = loadPlaylists();
  // Cek duplikat URL
  const urlExists = data.playlists.some(p => p.url && p.url.trim() === url.trim());
  if (urlExists) return { success: false, error: 'URL playlist sudah ada' };
  const id = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const playlist = {
    id,
    name: name.trim(),
    url: url.trim(),
    type,
    addedBy,
    createdAt: new Date().toISOString(),
    aliases: Array.isArray(aliases)
      ? aliases
          .filter(a => typeof a === 'string' && a.trim())
          .map(a => a.trim())
          // Buang alias yang sebenarnya URL (mis. kepencet autofill browser)
          .filter(a => !/^https?:\/\//i.test(a) && !/youtu\.?be/i.test(a))
      : [],
    cachedVideoIds: [],
    cachedAt: null,
  };
  data.playlists.push(playlist);
  savePlaylists(data);
  return { success: true, playlist };
}

function isLocalPlaylist(playlist) {
  return Boolean(playlist && (playlist.type === 'local' || Array.isArray(playlist.songs)));
}

/**
 * Bikin playlist lokal kosong (bukan playlist YouTube remote).
 */
function createLocalPlaylist(name, { addedBy = 'Mas Joy', aliases = [] } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { success: false, error: 'Nama playlist wajib diisi' };

  const data = loadPlaylists();
  const normalized = normalizeName(trimmed);
  const existing = data.playlists.find(p => normalizeName(p.name) === normalized);
  if (existing) {
    return { success: false, error: 'Nama playlist sudah dipakai', playlist: existing };
  }

  const baseAliases = Array.isArray(aliases)
    ? aliases.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim())
    : [];
  const favAliases = normalized === normalizeName(FAVORITES_NAME)
    ? ['favorit', 'favorite', 'fav', 'likes', 'suka']
    : [];

  const playlist = {
    id: `pl-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    url: '',
    type: 'local',
    addedBy,
    createdAt: new Date().toISOString(),
    aliases: [...new Set([...baseAliases, ...favAliases])],
    songs: [],
    cachedVideoIds: [],
    cachedAt: null,
  };
  data.playlists.push(playlist);
  savePlaylists(data);
  return { success: true, playlist };
}

/**
 * Simpan playlist YouTube remote (read-only) dengan nama custom.
 * Link sudah divalidasi/dikanonikalisasi pemanggil (lihat youtubePlaylist.extractPlaylistId).
 */
function createRemotePlaylist(name, url, { addedBy = 'Mas Joy', aliases = [] } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { success: false, error: 'Nama playlist wajib diisi' };
  if (!url) return { success: false, error: 'Link playlist wajib diisi' };

  const data = loadPlaylists();
  const normalized = normalizeName(trimmed);
  const existing = data.playlists.find(p => normalizeName(p.name) === normalized);
  if (existing) {
    return { success: false, error: 'Nama playlist sudah dipakai', playlist: existing };
  }

  return addPlaylist({ name: trimmed, url, type: 'youtube_playlist', addedBy, aliases });
}

function ensureFavoritesPlaylist() {
  const found = findPlaylistByName(FAVORITES_NAME, isLocalPlaylist);
  if (found) return found;

  const created = createLocalPlaylist(FAVORITES_NAME, {
    aliases: ['favorit', 'favorite', 'fav', 'likes', 'suka'],
  });
  if (created.success) return created.playlist;

  // Nama "Favorit" sudah dipakai playlist remote -> pakai nama lokal alternatif.
  if (created.playlist && !isLocalPlaylist(created.playlist)) {
    const alt = createLocalPlaylist(`${FAVORITES_NAME} Lokal`, {
      aliases: ['favorit', 'favorite', 'fav', 'likes', 'suka'],
    });
    return alt.playlist || null;
  }
  return created.playlist || null;
}

function findLocalPlaylistByName(query) {
  return findPlaylistByName(query, isLocalPlaylist);
}

function findRemotePlaylistByName(query) {
  return findPlaylistByName(query, (p) => !isLocalPlaylist(p));
}

function newLocalSong(song) {
  const id = song.id || song.url;
  return {
    id,
    title: song.title || `YouTube ${id}`,
    url: song.url,
    duration: Number(song.duration) || 0,
    addedAt: new Date().toISOString(),
  };
}

function addSongsToPlaylist(playlistId, songs) {
  const data = loadPlaylists();
  const playlist = data.playlists.find(p => p.id === playlistId);
  if (!playlist) return { success: false, error: 'Playlist tidak ditemukan' };
  if (!isLocalPlaylist(playlist)) {
    return { success: false, error: 'Playlist remote cuma bisa diputar, nggak bisa ditambahin lagu', remote: true };
  }

  playlist.songs = Array.isArray(playlist.songs) ? playlist.songs : [];
  let added = 0;
  let duplicate = 0;

  for (const song of songs) {
    if (!song || !song.url) continue;
    const id = song.id || song.url;
    const exists = playlist.songs.some(
      (s) => (s.id && s.id === id) || s.url === song.url
    );
    if (exists) {
      duplicate++;
      continue;
    }
    playlist.songs.push(newLocalSong({ ...song, id }));
    added++;
  }

  if (added > 0) savePlaylists(data);
  return { success: true, added, duplicate, playlist };
}

function addSongToPlaylist(playlistId, song) {
  return addSongsToPlaylist(playlistId, [song]);
}

function removeSongsFromPlaylist(playlist, predicate) {
  const data = loadPlaylists();
  const pl = data.playlists.find(p => p.id === (playlist.id || playlist));
  if (!pl || !isLocalPlaylist(pl)) return [];
  const before = pl.songs || [];
  const removed = predicate ? before.filter(s => predicate(s)) : before.slice(); // remove all
  pl.songs = before.filter(s => predicate ? !predicate(s) : false);
  savePlaylists(data);
  return removed;
}

function listLocalPlaylists() {
  return loadPlaylists().playlists.filter(isLocalPlaylist);
}

function removePlaylist(id) {
  const data = loadPlaylists();
  const idx = data.playlists.findIndex(p => p.id === id);
  if (idx === -1) return { success: false, error: 'Playlist tidak ditemukan' };
  data.playlists.splice(idx, 1);
  savePlaylists(data);
  return { success: true };
}

function findPlaylistMentionInText(text) {
  const data = loadPlaylists();
  const candidates = data.playlists.filter(p => p.type === 'local' || (p.aliases && p.aliases.some(a => /favorit/i.test(a))));
  const names = [];
  candidates.forEach(p => {
    names.push(p.name);
    if (p.aliases) p.aliases.forEach(a => names.push(a));
  });
  names.sort((a, b) => b.length - a.length);
  const cleanText = String(text || '').toLowerCase();
  for (const n of names) {
    const lowerN = String(n).toLowerCase();
    if (cleanText.includes(lowerN)) return String(n);
  }
  return null;
}

function findPlaylistByName(query, predicate = null) {
  if (!query) return null;
  const data = loadPlaylists();
  const playlists = predicate ? data.playlists.filter(predicate) : data.playlists;
  if (playlists.length === 0) return null;

  const q = normalizeName(query);

  // 0. Exact match on alias
  for (const p of playlists) {
    if (Array.isArray(p.aliases)) {
      for (const alias of p.aliases) {
        if (normalizeName(alias) === q) return p;
      }
    }
  }

  // 1. Exact match on name (normalized)
  let best = null;
  let bestScore = -1;
  for (const p of playlists) {
    const pn = normalizeName(p.name);
    if (pn === q) return p;
    const score = similarityScore(q, pn);
    if (score > bestScore) { bestScore = score; best = p; }
    // also score against aliases
    if (Array.isArray(p.aliases)) {
      for (const alias of p.aliases) {
        const an = normalizeName(alias);
        if (an === q) return p;
        const s = similarityScore(q, an);
        if (s > bestScore) { bestScore = s; best = p; }
      }
    }
  }

  // 2. Partial match (q contains playlist name or vice versa)
  for (const p of playlists) {
    const candidates = [normalizeName(p.name)];
    if (Array.isArray(p.aliases)) candidates.push(...p.aliases.map(normalizeName));
    for (const cn of candidates) {
      if (cn.includes(q) || q.includes(cn)) return p;
    }
  }

  // 3. Fuzzy: high similarity (>0.6) — handle typo
  if (best && bestScore >= 0.6) {
    console.log(`[MUSIC] Fuzzy match: "${query}" -> "${best.name}" (score ${bestScore.toFixed(2)})`);
    return best;
  }

  return null;
}

/**
 * Normalize nama untuk matching:
 * - lowercase
 * - hapus karakter non-alfanumerik (spasi, strip, tanda baca)
 *
 * Contoh: "One Ok Rock" -> "oneokrock"
 *         "one oke rock" -> "oneokerock"
 */
function normalizeName(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Levenshtein distance.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/**
 * Similarity score 0-1 based on Levenshtein distance.
 */
function similarityScore(query, target) {
  if (!query && !target) return 1;
  const maxLen = Math.max(query.length, target.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(query, target);
  return 1 - (dist / maxLen);
}

function getPlaylistById(id) {
  const data = loadPlaylists();
  return data.playlists.find(p => p.id === id) || null;
}

function listPlaylists() {
  if (!fs.existsSync(PLAYLISTS_FILE)) return [];
  return loadPlaylists().playlists;
}

function updatePlaylistCache(id, videoIds) {
  const data = loadPlaylists();
  const pl = data.playlists.find(p => p.id === id);
  if (!pl) return false;
  pl.cachedVideoIds = Array.isArray(videoIds) ? videoIds : [];
  pl.cachedAt = new Date().toUTCString();
  savePlaylists(data);
  return true;
}

function isMasJoy(userProfile, userId, authorName) {
  if (userId === MAS_JOY_USER_ID) return true;
  const name = (authorName || userProfile?.name || '').toLowerCase();
  return name === 'rieka' || name.includes('mas joy');
}

/**
 * Build prompt snippet for AI.
 */
function buildMusicPromptSnippet() {
  const data = loadPlaylists();
  if (data.playlists.length === 0) {
    return `
[MUSIC PLAYER TERSEDIA — HANYA UNTUK MAS JOY]:
Callista BISA muter musik dari YouTube, TikTok, dan Spotify (lagu, album, playlist, artist, podcast), untuk Mas Joy saja.
Saat ini belum ada playlist tersimpan. Kalau Mas Joy nyuruh puter musik, minta dia tambah playlist dulu via dashboard.

PRIORITAS PERINTAH KONTROL:
- Kalau pesan terakhir Mas Joy cuma perintah kontrol (skip/stop/pause/resume/queue/antrian/shuffle/acak), WAJIB pakai format kontrol itu. JANGAN replay playlist/lagu dari pesan sebelumnya.
- Contoh: "cal, skip" -> SKIP_SONG; "cal, stop" -> STOP_MUSIC; "cal, antrian" -> QUEUE_LIST; "cal, lanjut" -> RESUME_MUSIC.`;
  }
  const playlistNames = data.playlists.map(p => {
    const aliasesStr = (p.aliases && p.aliases.length) ? ` (alias: ${p.aliases.join(', ')})` : '';
    if (isLocalPlaylist(p)) {
      const songsLine = (p.songs || []).map(s => `  - ${s.title || s.url}`).join('\n');
      const songCount = p.songs ? p.songs.length : 0;
      return `- "${p.name}"${aliasesStr} — playlist lokal (${songCount} lagu)\n${songsLine}`;
    }
    return `- "${p.name}"${aliasesStr} — playlist YouTube remote`;
  }).join('\n\n');

  return `
[MUSIC PLAYER TERSEDIA — HANYA UNTUK MAS JOY]:
Callista BISA muter musik dari YouTube, TikTok, dan Spotify (lagu, album, playlist, artist, podcast), untuk Mas Joy saja.

Playlist tersimpan saat ini:
${playlistNames}

Format respons tambahan (HANYA untuk Mas Joy):
- PLAY_PLAYLIST: Play playlist. Set "musicQuery" ke nama playlist. Bot akan join VC lalu putar.
- PLAY_SONG: Play satu lagu/search YouTube. Set "musicQuery" ke query search.
- SKIP_SONG: Skip lagu saat ini.
- STOP_MUSIC: Stop musik + leave VC.
- SHUFFLE_MUSIC: Toggle shuffle on/off.
- QUEUE_LIST: Tampilkan antrian lagu.
- PAUSE_MUSIC / RESUME_MUSIC: Pause/resume playback.
- LOOP_SONG: Loop lagu saat ini (diulang terus). Pakai saat Mas Joy minta "ulang lagu ini", "loop lagu ini", "putar terus".
- UNLOOP_SONG: Matikan loop lagu saat ini. Pakai saat Mas Joy minta "jangan loop", "stop loop", "jangan ulang".
- PLAY_SONG_AND_LOOP: Cari lagu berdasarkan judul lalu putar dan langsung loop. Set "musicQuery" ke judul lagu. Pakai saat Mas Joy minta "putar X berulang-ulang", "loop X sekarang".
- SAVE_CURRENT_SONG: Simpan lagu yang sedang diputar ke playlist favorit (atau playlist tertentu). Set "musicQuery" ke nama target playlist (default: "favorit"). Pakai saat Mas Joy minta "simpan lagu ini ke favorit", "favoritkan lagu ini", "masukin lagu ini ke favorit".
- SEARCH_AND_PLAY: Cari lagu di YouTube lalu langsung putar (tanpa menunggu konfirmasi). Set "musicQuery" ke judul/query lagu. Pakai saat Mas Joy minta "cari dan putar X", "putar lagu X" tapi lagu tidak ada di playlist tersimpan dan konteks jelas ingin langsung putar.

PRIORITAS PERINTAH KONTROL:
- Kalau pesan terakhir Mas Joy cuma perintah kontrol (skip/stop/pause/resume/queue/antrian/shuffle/acak), WAJIB pakai format kontrol itu.
- JANGAN mengulang PLAY_PLAYLIST/PLAY_SONG dari pesan sebelumnya. Fokus ke pesan terakhir saja.
- Contoh: "cal, skip" -> SKIP_SONG; "cal, stop" -> STOP_MUSIC; "cal, antrian" -> QUEUE_LIST; "cal, lanjut" -> RESUME_MUSIC.
- Format kontrol tidak butuh musicQuery.

Aturan:
- HANYA Mas Joy yang bisa suruh muter musik. User lain DITOLAK dengan alasan natural (Callista lg rebahan/mager/bukan DJ pribadi lu).
- Mendukung link YouTube, TikTok, dan Spotify (track, album, playlist, artist, episode/podcast).
- Playlist lokal (type "local") bisa ditambahin lagu. Playlist YouTube remote READ-ONLY, cuma bisa diputar.
- Pencarian lagu dilakukan lewat perintah deterministik "cal, cari lagu <judul>" (TinyFish). Jangan mengarang link YouTube.
- Kalau Mas Joy sebut nama playlist yang ada (e.g. "puter one ok rock"), pakai PLAY_PLAYLIST.
- Kalau Mas Joy sebut judul lagu spesifik (e.g. "puter bombo bloodborne"), pakai PLAY_SONG.
- Bila sedang play, pake SKIP_SONG/STOP_MUSIC/SHUFFLE_MUSIC/QUEUE_LIST.
- Bot akan otomatis join VC dulu sebelum play.
- MUSIK: Nama playlist boleh TYPO / variasi ejaan. Bot akan mencocokkan fuzzy.
  Contoh: "one oke rock" tetap cocok ke "One Ok Rock".
  Kalau Mas Joy sebut judul lagu spesifik seperti "renegades", pakai PLAY_SONG (bukan PLAY_PLAYLIST).
  Jika ragu apakah nama playlist atau judul lagu, dan yang disebut MIRIP dengan salah satu playlist tersimpan, pakai PLAY_PLAYLIST.
  Sebaliknya, gunakan PLAY_SONG.`;
}

module.exports = {
  PLAYLISTS_FILE,
  MAS_JOY_USER_ID,
  FAVORITES_NAME,
  loadPlaylists,
  savePlaylists,
  addPlaylist,
  removePlaylist,
  findPlaylistByName,
  findLocalPlaylistByName,
  findRemotePlaylistByName,
  isLocalPlaylist,
  createLocalPlaylist,
  createRemotePlaylist,
  ensureFavoritesPlaylist,
  addSongToPlaylist,
  addSongsToPlaylist,
  listLocalPlaylists,
  getPlaylistById,
  listPlaylists,
  updatePlaylistCache,
  isMasJoy,
  buildMusicPromptSnippet,
  removeSongsFromPlaylist,
  findPlaylistMentionInText,
};