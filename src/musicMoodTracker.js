'use strict';

/**
 * Music Mood Tracker (Freqblog / Essentia Audio Intelligence)
 *
 * Menganalisis audio features lagu yang sedang diputar di voice channel,
 * mengklasifikasikan suasana/vibe emosional lagu (melow, santai, enerjik, dll),
 * memperbarui status Voice Channel Discord secara otonom, dan menyuntikkan
 * kesadaran suasana lagu ke AI prompt Callista.
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const settingsPath = path.resolve(__dirname, '../data/music_mood_settings.json');
const cachePath = path.resolve(__dirname, '../data/music_mood_cache.json');

// In-memory runtime state
const activeGuildMoods = new Map(); // guildId -> moodInfo
const lastStatusByGuild = new Map(); // guildId -> last status string

// Kumpulan template status Voice Channel Callista per kategori suasana (12 varian per kategori)
const STATUS_TEMPLATES = {
  mellow: [
    'lagunya melow sendu... 🌧️',
    'vibes galau merenung 🥀',
    'lagi melow di VC, enak bgt lagunya ☕',
    'lagunya adem tapi sedih 🥺',
    'merenung tipis dengerin lagu ini 🌧️',
    'bengong bentar, lagunya ngena bgt 🥀',
    'hujan sore vibes, melow bgt 🌧️',
    'lagunya dalam bgt, berasa di film sedih 🎬',
    'lagi mode melankolis di VC 🎧',
    'bikin overthinking tipis lagunya wkwk 🥀',
    'adem, syahdu, tapi bikin galau 🥺',
    'dengerin yang sendu-sendu dulu ☕',
  ],
  chill: [
    'vibes-nya adem banget 🍃',
    'lagi santai dengerin musik ☕',
    'akustikan santai di VC 🎧',
    'adem bgt lagunya bikin rileks ✨',
    'santai dulu ga sih 🛋️',
    'lagunya enak buat nemenin santai 🌿',
    'vibes sore yang tenang ☕',
    'petikan gitarnya bikin tenang ✨',
    'rehat sejenak sambil dengerin lagu 🍃',
    'lagunya menenangkan bgt di kuping 🎧',
    'lagi chill mode on 🌿',
    'cozy vibes di VC ✨',
  ],
  hype: [
    'lagunya naikin mood bgt 🔥',
    'hype parah! gas pol ⚡',
    'lagi mode berenergi ✨',
    'asik bgt beat-nya 🚀',
    'vibes semangat gaspol ⚡',
    'langsung melek denger lagu ini 🔥',
    'auto semangat denger beat-nya 💥',
    'lagunya seru bgt parah ⚡',
    'bikin pengen loncat-loncat wkwk 🔥',
    'energi 100% mode on 🚀',
    'joget tipis di kursi 💃',
    'lagu booster mood hari ini ✨',
  ],
  groovy: [
    'beat-nya nagih bgt 🕺',
    'vibes-nya asik buat goyang tipis ✨',
    'groovin in VC 🎶',
    'lagunya asik parah 🎧',
    'bassline-nya enak bgt didenger 🎵',
    'ketukannya candu wkwk 🕺',
    'ikut goyang kepala denger ini 🎧',
    'asik bgt ritmenya ✨',
    'lagu vibing asik di VC 🎶',
    'nagih bgt iramanya 🔥',
    'groove-nya dapet bgt 🕺',
    'asik buat nemenin ngapain aja 🎵',
  ],
  intense: [
    'lagi dengerin yang cadas 🎸',
    'distorsi keras mode on ⚡',
    'headbang tipis di VC 🤘',
    'energi meluap lagunya keras 🔥',
    'riff gitarnya gahar bgt 🎸',
    'mode cadas dulu gaes ⚡',
    'pecah bgt suaranya 🤘',
    'lagu beroktan tinggi 🔥',
    'hentakan drumnya mantap 🥁',
    'gahar bgt vibes-nya 🎸',
    'distorsi maksimal di VC ⚡',
    'lagi mode rock/metal 🤘',
  ],
  neutral: [
    'lagi dengerin musik 🎧',
    'vibes musik di VC 🎵',
    'santai dengerin lagu ✨',
    'lagu pilihan di VC 🎶',
    'nemani suasana di voice chat 🎧',
    'musik santai mengalun 🎵',
    'dengerin track enak ✨',
    'lagunya pas buat nemenin VC ☕',
    'vibes lagu di room 🎶',
    'dengerin playlist favorit 🎧',
    'menikmati alunan lagu 🎶',
    'lagu santai pengisi ruangan ☕',
  ],
};

function defaultSettings() {
  return {
    enabled: true,
    apiKey: process.env.FREQBLOG_API_KEY || 'fb_live_77c92e071c4f9e96e090c7a603287fd0bd3ae74e6e287979',
    autoSetVoiceStatus: true,
    cacheEnabled: true,
  };
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { ...defaultSettings(), ...(parsed || {}) };
    }
  } catch (e) {
    console.warn('[MUSIC_MOOD] Gagal membaca music_mood_settings.json:', e.message);
  }
  const def = defaultSettings();
  saveSettings(def);
  return def;
}

function saveSettings(data) {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const tmp = `${settingsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, settingsPath);
  } catch (e) {
    console.error('[MUSIC_MOOD] Gagal menyimpan music_mood_settings.json:', e.message);
  }
}

function updateSettings(updates = {}) {
  const current = loadSettings();
  const next = { ...current, ...updates };
  saveSettings(next);
  return next;
}

// Cache persistent
let memoryCache = null;

function loadCache() {
  if (memoryCache) return memoryCache;
  try {
    if (fs.existsSync(cachePath)) {
      memoryCache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {};
      return memoryCache;
    }
  } catch (_) {}
  memoryCache = {};
  return memoryCache;
}

function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, cachePath);
  } catch (_) {}
}

function clearCache() {
  memoryCache = {};
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch (_) {}
}

/**
 * Bersihkan judul lagu dan artis dari tag-tag video YouTube (Official Video, MV, Lyrics, dll).
 */
function cleanSongTitle(title = '') {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/\s*[\(\[](?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|mv)?|lyrics?|audio|hd|4k|mv|remastered|live)[\)\]]/gi, '')
    .replace(/\s*\|\s*.*$/g, '') // strip '| ...'
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ekstraksi track dan artist dari nama lagu DisTube.
 */
function parseTrackAndArtist(songName = '', uploaderName = '') {
  let cleanName = cleanSongTitle(songName);
  let artist = (uploaderName || '').replace(/ - Topic$/i, '').trim();
  let track = cleanName;

  // Cek apakah ada pemisah ' - ' di judul: "Artist - Track"
  if (cleanName.includes(' - ')) {
    const parts = cleanName.split(' - ');
    const potentialArtist = parts[0].trim();
    const potentialTrack = parts.slice(1).join(' - ').trim();
    if (potentialArtist.length > 0 && potentialTrack.length > 0) {
      artist = potentialArtist;
      track = potentialTrack;
    }
  }

  // Bersihkan embel-embel 'feat.' atau 'ft.' di nama track untuk query Freqblog
  track = track.replace(/\s*(?:\(feat\.?|\(ft\.?|feat\.?|ft\.?).*$/i, '').trim();

  return { track, artist };
}

/**
 * Klasifikasikan data Essentia / Freqblog ke kategori suasana (mood).
 */
function classifyMood(audioFeatures) {
  if (!audioFeatures || typeof audioFeatures !== 'object') {
    return {
      moodKey: 'neutral',
      moodLabel: 'Netral & Santai',
      description: 'Lagu bernada standar',
      suggestedVcStatus: pickRandomTemplate('neutral'),
      features: null,
    };
  }

  const energy = typeof audioFeatures.energy === 'number' ? audioFeatures.energy : 0.5;
  const valence = typeof audioFeatures.valence === 'number' ? audioFeatures.valence : 0.5;
  const acousticness = typeof audioFeatures.acousticness === 'number' ? audioFeatures.acousticness : 0.2;
  const danceability = typeof audioFeatures.danceability === 'number' ? audioFeatures.danceability : 0.5;
  const bpm = typeof audioFeatures.bpm === 'number' ? Math.round(audioFeatures.bpm) : 120;
  const loudness = typeof audioFeatures.loudness_db === 'number' ? audioFeatures.loudness_db : -10;
  const mv = audioFeatures.mood_vector || {};
  const sadVal = mv.sad || 0;
  const relaxedVal = mv.relaxed || 0;
  const happyVal = mv.happy || 0;
  const partyVal = mv.party || 0;
  const aggressiveVal = mv.aggressive || 0;

  let key = 'neutral';
  let label = 'Netral & Santai';
  let desc = 'Irama musik santai berkarakter umum';

  // 1. Mellow & Galau Sendu
  if (
    (energy < 0.48 && (sadVal > 0.55 || valence < 0.42)) ||
    sadVal > 0.8 ||
    (energy < 0.4 && acousticness > 0.7 && valence < 0.48)
  ) {
    key = 'mellow';
    label = 'Melow & Sendu';
    desc = 'Suasana melankolis, lambat, dan sendu. Pas untuk merenung atau bengong.';
  }
  // 2. Cadas & Intens (Rock / Metal / Hardcore)
  else if (energy >= 0.72 && (aggressiveVal > 0.45 || (aggressiveVal > 0.3 && valence < 0.45))) {
    key = 'intense';
    label = 'Cadas & Intens';
    desc = 'Irama keras, penuh distorsi dan energi meluap.';
  }
  // 3. Hype & Enerjik (Upbeat / Party / EDM / Pop Ceria)
  else if (energy >= 0.65 && (valence > 0.5 || happyVal > 0.4 || partyVal > 0.4 || bpm > 125)) {
    key = 'hype';
    label = 'Hype & Enerjik';
    desc = 'Tempo bersemangat, ceria, dan membangkitkan mood.';
  }
  // 4. Groovy & Asik (Rhythmic / Danceable)
  else if (danceability >= 0.64 && energy >= 0.52) {
    key = 'groovy';
    label = 'Groovy & Asik';
    desc = 'Irama ritmis dan catchy, asik untuk bergoyang santai.';
  }
  // 5. Cozy & Santai (Chill / Akustik)
  else if (energy < 0.58 && (relaxedVal > 0.55 || acousticness > 0.65 || valence >= 0.45)) {
    key = 'chill';
    label = 'Adem & Santai';
    desc = 'Vibes tenang, akustik, dan menenangkan telinga.';
  }

  return {
    moodKey: key,
    moodLabel: label,
    description: desc,
    suggestedVcStatus: pickRandomTemplate(key),
    features: {
      bpm,
      energy: Number(energy.toFixed(3)),
      valence: Number(valence.toFixed(3)),
      acousticness: Number(acousticness.toFixed(3)),
      danceability: Number(danceability.toFixed(3)),
      loudnessDb: Number(loudness.toFixed(1)),
      dominantMood: audioFeatures.mood || key,
    },
  };
}

function pickRandomTemplate(category, excludeText = '') {
  const list = STATUS_TEMPLATES[category] || STATUS_TEMPLATES.neutral;
  const filtered = excludeText ? list.filter(t => t !== excludeText) : list;
  const pool = filtered.length > 0 ? filtered : list;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

/**
 * Panggil Freqblog API untuk lookup audio features.
 */
function queryFreqblogApi(track, artist, apiKey, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!apiKey) {
      return resolve({ ok: false, error: 'No API key provided' });
    }

    const query = new URLSearchParams({
      track: track || '',
      artist: artist || '',
      wait: '5', // Tunggu hingga 5 detik jika lagu baru di-queue
    });

    const options = {
      hostname: 'api.freqblog.com',
      path: `/lookup?${query.toString()}`,
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'User-Agent': 'Callista-MusicMood/1.0',
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(rawData);
            return resolve({ ok: true, data: json });
          } catch (e) {
            return resolve({ ok: false, error: 'Invalid JSON response' });
          }
        }
        if (res.statusCode === 202) {
          // Status queued on-demand
          return resolve({ ok: false, status: 202, error: 'Track queued for analysis on Freqblog' });
        }
        return resolve({ ok: false, status: res.statusCode, error: `Freqblog error: ${res.statusCode}` });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Request timeout' });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });

    req.end();
  });
}

/**
 * Dapatkan mood info lagu (cek cache -> query Freqblog -> classify).
 */
async function lookupMood(track, artist, options = {}) {
  const settings = loadSettings();
  const apiKey = options.apiKey || settings.apiKey;
  const cleanT = (track || '').trim();
  const cleanA = (artist || '').trim();

  if (!cleanT) {
    return classifyMood(null);
  }

  const cacheKey = `${cleanA.toLowerCase()}___${cleanT.toLowerCase()}`;
  const cache = loadCache();

  if (settings.cacheEnabled && cache[cacheKey]) {
    return cache[cacheKey];
  }

  // Jika ada mock API client untuk testing
  if (typeof options.mockApi === 'function') {
    const mockRes = await options.mockApi(cleanT, cleanA);
    const classified = classifyMood(mockRes);
    classified.track = cleanT;
    classified.artist = cleanA;
    if (settings.cacheEnabled) {
      cache[cacheKey] = classified;
      saveCache(cache);
    }
    return classified;
  }

  if (!apiKey) {
    console.warn('[MUSIC_MOOD] Freqblog API key belum diset.');
    const fallback = classifyMood(null);
    fallback.track = cleanT;
    fallback.artist = cleanA;
    return fallback;
  }

  const res = await queryFreqblogApi(cleanT, cleanA, apiKey, options.timeoutMs || 7000);
  if (res.ok && res.data) {
    const classified = classifyMood(res.data);
    classified.track = res.data.track_name || cleanT;
    classified.artist = res.data.artist_name || cleanA;
    classified.genre = res.data.genre || null;
    if (settings.cacheEnabled) {
      cache[cacheKey] = classified;
      saveCache(cache);
    }
    return classified;
  }

  // Fallback netral jika tidak ditemukan / status 202
  const fallback = classifyMood(null);
  fallback.track = cleanT;
  fallback.artist = cleanA;
  fallback.note = res.error || 'Fallback mood';
  return fallback;
}

/**
 * Update Voice Channel Status di Discord.
 */
async function setVoiceChannelStatus(voiceChannel, statusText) {
  if (!voiceChannel) return false;
  try {
    if (typeof voiceChannel.setStatus === 'function') {
      await voiceChannel.setStatus(statusText);
      return true;
    }
    if (voiceChannel.client?.rest) {
      const { Routes } = require('discord.js');
      if (Routes && typeof Routes.channelVoiceStatus === 'function') {
        await voiceChannel.client.rest.put(Routes.channelVoiceStatus(voiceChannel.id), {
          body: { status: statusText },
        });
        return true;
      }
    }
  } catch (err) {
    console.warn(`[MUSIC_MOOD] Gagal set status VC #${voiceChannel.name}:`, err.message);
  }
  return false;
}

/**
 * Dipanggil saat lagu mulai diputar (DisTube playSong).
 */
async function onSongPlay(queue, song) {
  const settings = loadSettings();
  if (!settings.enabled) return null;

  const guildId = queue?.voiceChannel?.guild?.id || queue?.id;
  if (!guildId) return null;

  try {
    const { track, artist } = parseTrackAndArtist(song.name, song.uploader?.name);
    const moodInfo = await lookupMood(track, artist);
    const prevStatus = lastStatusByGuild.get(guildId) || '';
    const freshStatus = pickRandomTemplate(moodInfo.moodKey, prevStatus);
    lastStatusByGuild.set(guildId, freshStatus);

    const guildMoodData = {
      ...moodInfo,
      suggestedVcStatus: freshStatus,
      songName: song.name,
      updatedAt: Date.now(),
    };
    activeGuildMoods.set(guildId, guildMoodData);

    console.log(`[MUSIC_MOOD] Track "${track}" by "${artist}" → Mood: ${moodInfo.moodLabel} | VC Status: "${freshStatus}"`);

    // Perbarui status Voice Channel jika opsi diaktifkan
    if (settings.autoSetVoiceStatus && queue.voiceChannel) {
      await setVoiceChannelStatus(queue.voiceChannel, freshStatus);
    }

    return guildMoodData;
  } catch (err) {
    console.warn('[MUSIC_MOOD] onSongPlay error:', err.message);
    return null;
  }
}

/**
 * Dipanggil saat lagu berakhir / queue selesai / bot stop musik.
 */
async function onSongEnd(queue, guildIdInput) {
  const guildId = guildIdInput || queue?.voiceChannel?.guild?.id || queue?.id;
  if (!guildId) return;

  activeGuildMoods.delete(guildId);
  lastStatusByGuild.delete(guildId);

  const voiceChannel = queue?.voiceChannel;
  if (voiceChannel) {
    try {
      await setVoiceChannelStatus(voiceChannel, '');
    } catch (_) {}
  }
}

/**
 * Ambil mood lagu aktif saat ini di guild tertentu (untuk diinjeksikan ke AI).
 */
function getCurrentMood(guildId) {
  if (!guildId) return null;
  return activeGuildMoods.get(guildId) || null;
}

/**
 * Helper untuk format masked API key (e.g. fb_live_77c...979).
 */
function maskApiKey(key = '') {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 12) return '********';
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

module.exports = {
  loadSettings,
  saveSettings,
  updateSettings,
  cleanSongTitle,
  parseTrackAndArtist,
  classifyMood,
  lookupMood,
  setVoiceChannelStatus,
  onSongPlay,
  onSongEnd,
  getCurrentMood,
  maskApiKey,
  clearCache,
  STATUS_TEMPLATES,
};
