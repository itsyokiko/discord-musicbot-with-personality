'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.resolve(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'elevenlabs_settings.json');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICES_URL = 'https://api.elevenlabs.io/v1/voices';
const MODELS_URL = 'https://api.elevenlabs.io/v1/models';

// Default voice settings — VN style: pelan, natural, bukan dubbing
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.72,
  similarity_boost: 0.80,
  style: 0.12,          // subtle, tidak over-emotive
  use_speaker_boost: true,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSettings() {
  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    enabled: false,
    apiKey: '',
    voiceId: '',
    modelId: 'eleven_multilingual_v2',
    chance: 0.30,            // 30% default
    creditsRemaining: 10000, // proyeksi awal
    voiceSettings: DEFAULT_VOICE_SETTINGS,
  };
}

function saveSettings(data) {
  ensureDataDir();
  const tmp = `${SETTINGS_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, SETTINGS_FILE);
    return true;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

function getSettings() {
  return loadSettings();
}

function updateSettings(updates = {}) {
  const data = loadSettings();
  if (typeof updates.enabled === 'boolean') data.enabled = updates.enabled;
  if (typeof updates.apiKey === 'string' && updates.apiKey.trim()) data.apiKey = updates.apiKey.trim();
  if (typeof updates.voiceId === 'string') data.voiceId = updates.voiceId.trim();
  if (typeof updates.modelId === 'string') data.modelId = updates.modelId.trim();
  if (typeof updates.chance === 'number') data.chance = Math.max(0, Math.min(1, updates.chance));
  if (typeof updates.creditsRemaining === 'number') data.creditsRemaining = Math.max(0, updates.creditsRemaining);
  if (updates.voiceSettings && typeof updates.voiceSettings === 'object') {
    data.voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...updates.voiceSettings };
  }
  saveSettings(data);
  return data;
}

/**
 * Kurangi kredit berdasarkan jumlah karakter yang diproses ElevenLabs.
 * 1 karakter = 1 kredit ElevenLabs.
 */
function deductCredits(charCount) {
  const data = loadSettings();
  data.creditsRemaining = Math.max(0, (data.creditsRemaining || 0) - charCount);
  saveSettings(data);
  return data.creditsRemaining;
}

/**
 * Preprocessing teks untuk gaya VN (Visual Novel):
 * - Ganti ekspresi ketawa dengan 笑 (hemat karakter)
 * - Buang kata filler sendirian yang tidak perlu
 * - Bersihkan teks agar natural sebagai suara
 */
function preprocessTextForVN(text) {
  if (!text || typeof text !== 'string') return '';

  let t = text.trim();

  // Ganti ekspresi ketawa → 笑 (1 karakter, sangat hemat)
  t = t.replace(/\b(wkwk+|haha+|hehe+|hihi+|lol|xd|😂|🤣)\b/gi, '笑');
  // Jangan ada 笑 berulang
  t = t.replace(/(笑\s*){2,}/g, '笑');

  // Buang kata filler yang berdiri sendiri (tidak hemat karakter, tidak makna)
  // Hanya kalau jadi seluruh kalimat / sangat pendek
  if (/^(ya|yaa|yaaa|iya|iyaa|ok|okay|oke|hm+|hmm+|eh+|ah+|oh+|wah+)\.?!?$/i.test(t)) return '';

  // Bersihkan spasi ganda
  t = t.replace(/\s{2,}/g, ' ').trim();

  return t;
}

/**
 * RNG: apakah respon ini harus dikirim sebagai voice note?
 */
function shouldSendAsVoice() {
  const s = loadSettings();
  if (!s.enabled || !s.apiKey || !s.voiceId) return false;
  if ((s.creditsRemaining || 0) <= 0) return false;
  return Math.random() < (s.chance || 0.30);
}

/**
 * Synthesize teks ke audio MP3 buffer via ElevenLabs TTS API.
 * Return: Buffer (mp3) atau null jika gagal.
 */
async function synthesize(rawText) {
  const s = loadSettings();
  if (!s.enabled || !s.apiKey || !s.voiceId) return null;

  const text = preprocessTextForVN(rawText);
  if (!text) return null;

  const url = `${TTS_URL}/${s.voiceId}`;
  const body = {
    text,
    model_id: s.modelId || 'eleven_multilingual_v2',
    voice_settings: s.voiceSettings || DEFAULT_VOICE_SETTINGS,
    output_format: 'mp3_44100_128',
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': s.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[EL] TTS HTTP ${res.status}: ${errText.substring(0, 200)}`);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    // Deduct credits: ElevenLabs = 1 kredit per karakter
    const remaining = deductCredits(text.length);
    console.log(`[EL] Synthesized ${text.length} chars -> ${buf.length} bytes MP3. Credits left: ${remaining}`);
    return { buffer: buf, text, charCount: text.length };
  } catch (err) {
    console.error(`[EL] synthesize error: ${err.message}`);
    return null;
  }
}

/**
 * Fetch daftar suara dari ElevenLabs API (untuk dashboard).
 */
async function fetchVoices(apiKey) {
  const key = apiKey || loadSettings().apiKey;
  if (!key) return null;
  try {
    const res = await fetch(VOICES_URL, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.voices || []).map(v => ({ voice_id: v.voice_id, name: v.name, category: v.category || 'premade' }));
  } catch (e) {
    return null;
  }
}

/**
 * Fetch daftar model dari ElevenLabs API (untuk dashboard).
 */
async function fetchModels(apiKey) {
  const key = apiKey || loadSettings().apiKey;
  if (!key) return null;
  try {
    const res = await fetch(MODELS_URL, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data)
      ? data.map(m => ({ model_id: m.model_id, name: m.name, description: m.description || '' }))
      : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  loadSettings,
  getSettings,
  updateSettings,
  deductCredits,
  preprocessTextForVN,
  shouldSendAsVoice,
  synthesize,
  fetchVoices,
  fetchModels,
};
