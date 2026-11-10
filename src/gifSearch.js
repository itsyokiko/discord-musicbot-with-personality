const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.resolve(__dirname, '../data');
const GIF_SETTINGS_FILE = path.join(DATA_DIR, 'gif_settings.json');

const DEFAULT_GIPHY_KEY = 'OwpbfVJEP7bdsv5bYseqfK2IDYHhADsf';
const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const GIPHY_RANDOM_URL = 'https://api.giphy.com/v1/gifs/random';

// Default keyword per ekspresi (Bahasa Inggris, karena Giphy lebih optimal)
const DEFAULT_KEYWORDS = {
  senang: ['happy', 'excited', 'yay'],
  ketawa: ['laughing', 'lol', 'haha'],
  manja: ['cute clingy', 'uwu', 'puppy eyes'],
  bingung: ['confused', 'what', 'confused math'],
  mikir: ['thinking', 'hmm thinking', 'calculating'],
  malas: ['lazy', 'meh', 'bored'],
  kesal: ['annoyed', 'ugh', 'irritated'],
  ngantuk: ['sleepy', 'tired', 'yawn'],
  kaget: ['shocked', 'surprised', 'whoa'],
  deadpan: ['deadpan stare', 'blank stare', 'unimpressed'],
  nangis: ['crying', 'sad tears', 'sobbing'],
  marah: ['angry', 'mad', 'rage'],
  menggelitik: ['facepalm', 'scratch head', 'awkward'],
  jijik: ['disgusted', 'yuck', 'gross'],
  creepy: ['creepy', 'shiver', 'goosebumps'],
  cringe: ['cringe', 'awkward cringe', 'yikes'],
  sinis: ['smirk', 'smug', 'sarcastic'],
  malu: ['blushing', 'shy', 'embarrassed'],
  susah_kata: ['speechless', 'no words', 'what just happened'],
  ngeri: ['scared', 'terrified', 'yikes scared'],
  lelah_total: ['exhausted', 'dead tired', 'drained'],
  galau: ['sad thinking', 'melancholy', 'heartbroken'],
  terharu: ['touched', 'emotional', 'teary happy'],
  skeptis: ['skeptical', 'side eye', 'doubt'],
  penasaran: ['curious', 'interested', 'ooh'],
  ngakak_sinis: ['evil laugh', 'smug laugh', 'haha sarcastic'],
  wtf: ['what the', 'wtf confused', 'blank face'],
  santuy: ['chill', 'cool', 'relaxed'],
  pusing: ['headache', 'dizzy', 'overwhelmed'],
  gelisah: ['anxious', 'restless', 'nervous']
};

const EMOTION_MAP = {
  happy: 'senang',
  excited: 'senang',
  laugh: 'ketawa',
  laughing: 'ketawa',
  lol: 'ketawa',
  haha: 'ketawa',
  funny: 'ketawa',
  cute: 'manja',
  clingy: 'manja',
  confused: 'bingung',
  thinking: 'mikir',
  lazy: 'malas',
  bored: 'malas',
  annoyed: 'kesal',
  irritated: 'kesal',
  sleepy: 'ngantuk',
  tired: 'ngantuk',
  shocked: 'kaget',
  surprised: 'kaget',
  deadpan: 'deadpan',
  sad: 'nangis',
  crying: 'nangis',
  angry: 'marah',
  mad: 'marah',
  rage: 'marah',
  disgusted: 'jijik',
  cringe: 'cringe',
  smirk: 'sinis',
  sarcastic: 'sinis',
  shy: 'malu',
  embarrassed: 'malu',
  blushing: 'malu',
  scared: 'ngeri',
  exhausted: 'lelah_total',
  chill: 'santuy',
  relaxed: 'santuy',
  dizzy: 'pusing',
  headache: 'pusing',
  anxious: 'gelisah',
  nervous: 'gelisah',
  wtf: 'wtf',
  neutral: 'neutral'
};

function normalizeEmotion(rawEmotion) {
  if (!rawEmotion || typeof rawEmotion !== 'string') return '';
  const clean = rawEmotion.trim().toLowerCase().replace(/[^a-z_]/g, '');
  if (DEFAULT_KEYWORDS[clean]) return clean;
  if (EMOTION_MAP[clean]) return EMOTION_MAP[clean];
  return clean;
}

const lastGifTimes = new Map(); // channelId -> timestamp

function shouldTriggerGif(emotion, channelId, options = {}) {
  const settings = loadGifSettings();
  if (!settings.enabled) return false;

  const normalized = normalizeEmotion(emotion);
  if (!normalized || normalized === 'neutral') return false;

  // Anti-spam per channel: minimal jeda 90 detik antar GIF
  const cooldownMs = options.cooldownMs || 90 * 1000;
  const lastTime = lastGifTimes.get(channelId) || 0;
  if (Date.now() - lastTime < cooldownMs) {
    return false;
  }

  // Peluang RNG (default 30% atau dari settings/options/env)
  const defaultChance = typeof settings.chance === 'number' ? settings.chance : 0.30;
  const chance = typeof options.chance === 'number' ? options.chance : (parseFloat(process.env.GIF_CHANCE) || defaultChance);
  const roll = Math.random();

  if (roll < chance) {
    lastGifTimes.set(channelId, Date.now());
    return true;
  }
  return false;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadGifSettings() {
  ensureDataDir();
  try {
    if (fs.existsSync(GIF_SETTINGS_FILE)) {
      const raw = fs.readFileSync(GIF_SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled === true,
        apiKey: typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : DEFAULT_GIPHY_KEY,
        rating: parsed.rating || 'pg-13',
        contentFilter: parsed.contentFilter || 'high',
        chance: typeof parsed.chance === 'number' ? parsed.chance : 0.30,
        keywords: parsed.keywords && typeof parsed.keywords === 'object' ? parsed.keywords : {}
      };
    }
  } catch (e) {}
  return {
    enabled: false,
    apiKey: process.env.GIPHY_API_KEY || DEFAULT_GIPHY_KEY,
    rating: 'pg-13',
    contentFilter: 'high',
    chance: 0.30,
    keywords: {}
  };
}

function saveGifSettings(data) {
  ensureDataDir();
  const tmpFile = `${GIF_SETTINGS_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, GIF_SETTINGS_FILE);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
    return false;
  }
}

function getGifSettings() {
  return loadGifSettings();
}

function updateGifSettings(updates = {}) {
  const data = loadGifSettings();
  if (typeof updates.enabled === 'boolean') data.enabled = updates.enabled;
  if (typeof updates.apiKey === 'string' && updates.apiKey.trim()) data.apiKey = updates.apiKey.trim();
  if (typeof updates.rating === 'string') data.rating = updates.rating;
  if (typeof updates.contentFilter === 'string') data.contentFilter = updates.contentFilter;
  if (typeof updates.chance === 'number') data.chance = updates.chance;
  if (updates.keywords && typeof updates.keywords === 'object') {
    data.keywords = { ...data.keywords, ...updates.keywords };
  }
  saveGifSettings(data);
  return data;
}

/**
 * Dapatkan daftar keyword untuk sebuah ekspresi.
 * Prioritas: custom keywords user → default keywords.
 */
function getKeywordsForExpression(expression) {
  const settings = loadGifSettings();
  const custom = settings.keywords?.[expression];

  if (Array.isArray(custom) && custom.length > 0) {
    return custom.filter(k => typeof k === 'string' && k.trim());
  }
  if (typeof custom === 'string' && custom.trim()) {
    // Bisa berupa string dipisah koma
    return custom.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_KEYWORDS[expression] || [expression];
}

/**
 * Search GIF di Giphy, ambil beberapa hasil, lalu pilih 1 secara acak.
 * @param {string} expression - kategori ekspresi
 * @param {number} limit - berapa GIF yang diambil untuk diacak (default 5)
 * @returns {Promise<{url: string, keyword: string} | null>}
 */
async function searchRandomGif(expression, limit = 5) {
  const settings = loadGifSettings();
  if (!settings.enabled) return null;
  if (!settings.apiKey) return null;

  const keywords = getKeywordsForExpression(expression);
  if (!keywords || keywords.length === 0) return null;

  // Pilih keyword acak dari daftar
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];

  try {
    const url = new URL(GIPHY_SEARCH_URL);
    url.searchParams.set('api_key', settings.apiKey);
    url.searchParams.set('q', keyword);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('rating', settings.rating || 'pg-13');
    url.searchParams.set('lang', 'en');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      console.error(`[GIF] Giphy HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const results = data?.data || [];
    if (results.length === 0) {
      console.log(`[GIF] Tidak ada hasil untuk keyword "${keyword}"`);
      return null;
    }

    // Pilih random dari hasil
    const picked = results[Math.floor(Math.random() * results.length)];
    // Prioritaskan downsize/original untuk kualitas baik
    const gifUrl = picked?.images?.downsized?.url
      || picked?.images?.original?.url
      || picked?.url;

    if (!gifUrl) return null;

    console.log(`[GIF] Picked GIF for "${expression}" via keyword "${keyword}" (${results.length} results)`);
    return { url: gifUrl, keyword };
  } catch (err) {
    console.error(`[GIF ERROR] ${err.message}`);
    return null;
  }
}

/**
 * Build snippet untuk system prompt AI (token-efficient).
 */
function buildGifPromptSnippet() {
  const settings = loadGifSettings();
  if (!settings.enabled) return '';

  let lines = [];
  lines.push('[GIF TERSEDIA VIA GIPHY]:');
  lines.push('Callista bisa mengirim GIF reaksi (bukan sticker, bukan emoji) via format GIF_ONLY.');
  lines.push('');
  lines.push('Ekspresi yang tersedia (kirim nama ekspresi di "gifExpression"):');

  const allExpr = [
    'senang', 'ketawa', 'manja', 'bingung', 'mikir', 'malas', 'kesal', 'ngantuk',
    'kaget', 'deadpan', 'nangis', 'marah', 'menggelitik', 'jijik', 'creepy', 'cringe',
    'sinis', 'malu', 'susah_kata', 'ngeri', 'lelah_total', 'galau', 'terharu', 'skeptis',
    'penasaran', 'ngakak_sinis', 'wtf', 'santuy', 'pusing', 'gelisah'
  ];
  lines.push(allExpr.join(', '));
  lines.push('');
  lines.push('Format respons GIF:');
  lines.push('- TEKS + GIF (SANGAT DIREKOMENDASIKAN): Kirim pesan teks (SHORT_TEXT, STACKED_TEXT, DRY_TEXT) SEKALIGUS isi field "gifExpression" dengan kategori di atas (contoh: "gifExpression": "ketawa" atau "marah"). Bot akan mengirim teks kamu DULUAN lalu menyusul dengan GIF reaksi dari Giphy!');
  lines.push('- GIF_ONLY: Kirim HANYA 1 GIF reaksi tanpa teks. Set "gifExpression" ke salah satu kategori di atas jika reaksi visual sudah mewakili segalanya.');
  lines.push('');
  lines.push('PANDUAN EKSPRESI GIF:');
  lines.push('- Gunakan "gifExpression" saat reaksi Callista dramatis, ngakak banget, kesel, salting, heran/wtf, atau geregetan.');
  lines.push('- Pilih kategori ekspresi yang paling sesuai dengan emosi.');

  return lines.join('\n');
}

/**
 * Search GIF by raw query string (bukan expression), random pick dari index 1–limit.
 * Dipakai untuk fitur greeting GIF dan sejenisnya.
 */
async function searchGifByQuery(query, limit = 10) {
  const settings = loadGifSettings();
  if (!settings.enabled) return null;
  if (!settings.apiKey) return null;

  try {
    const url = new URL(GIPHY_SEARCH_URL);
    url.searchParams.set('api_key', settings.apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('rating', settings.rating || 'pg-13');
    url.searchParams.set('lang', 'en');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = await res.json();
    const results = data?.data || [];
    if (results.length === 0) return null;

    // ponytail: random dari seluruh hasil (sudah dibatasi limit 10 dari API)
    const picked = results[Math.floor(Math.random() * results.length)];
    const gifUrl = picked?.images?.downsized?.url
      || picked?.images?.original?.url
      || picked?.url;

    if (!gifUrl) return null;
    console.log(`[GIF] searchGifByQuery "${query}" -> ${results.length} results, picked one`);
    return { url: gifUrl, query };
  } catch (err) {
    console.error(`[GIF ERROR] searchGifByQuery: ${err.message}`);
    return null;
  }
}

module.exports = {
  GIF_SETTINGS_FILE,
  DEFAULT_KEYWORDS,
  loadGifSettings,
  saveGifSettings,
  getGifSettings,
  updateGifSettings,
  getKeywordsForExpression,
  searchRandomGif,
  searchGifByQuery,
  buildGifPromptSnippet,
  EMOTION_MAP,
  normalizeEmotion,
  shouldTriggerGif,
};
