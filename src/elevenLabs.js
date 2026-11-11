'use strict';
/**
 * ElevenLabs Voice Note — TTS untuk Callista.
 *
 * - Pengaturan dibaca dari data/elevenlabs_settings.json SETIAP panggilan,
 *   jadi perubahan dari dashboard langsung aktif tanpa restart.
 * - Teks diproses dulu (tag ekspresi Jepang, singkatan, ketawa) supaya
 *   hemat kredit dan terdengar natural sebagai voice note.
 * - Hasil MP3 dikonversi ke OGG/Opus agar terkirim sebagai voice message
 *   Discord (bukan sekadar lampiran audio).
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { MessageFlags } = require('discord.js');

const DATA_DIR = path.resolve(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'elevenlabs_settings.json');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICES_URL = 'https://api.elevenlabs.io/v1/voices';
const MODELS_URL = 'https://api.elevenlabs.io/v1/models';

// Audio tag Jepang hanya dijalankan Eleven v3/v4. Model v2 membacanya keras-keras.
const TAG_MODEL = 'eleven_v3';
const FALLBACK_MODEL = 'eleven_multilingual_v2';

// VN style: pelan, natural, tidak over-dramatis.
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.80,
  style: 0.15,
  use_speaker_boost: true,
};

const DEFAULTS = {
  enabled: false,
  apiKey: '',
  voiceId: '',
  modelId: TAG_MODEL,
  chance: 0.30,            // 30% default, dashboard bisa 0-100%
  creditsRemaining: 10000, // proyeksi kredit (editable)
  voiceSettings: DEFAULT_VOICE_SETTINGS,
};

// Ekspresi natural untuk VN. Digabung dalam SATU tag agar hemat kredit.
const EMOTION_TAGS = {
  senang: ['明るく', '楽しそう'],
  ketawa: ['笑いながら'],
  manja: ['甘える', '優しく'],
  kesal: ['苛立ち'],
  marah: ['怒り'],
  malu: ['照れながら'],
  bingung: ['困惑'],
  sinis: ['皮肉'],
  santuy: ['普段の声'],
  kaget: ['驚き'],
  cringe: ['呆れた口調'],
  sedih: ['悲しい'],
  takut: ['緊張'],
  neutral: ['普段の声'],
};

// Singkatan chat yang kalau dibacakan TTS terdengar aneh/terpotong.
const ABBREVIATIONS = {
  yg: 'yang',
  bgt: 'banget',
  gk: 'nggak',
  ga: 'nggak',
  gak: 'nggak',
  ngga: 'nggak',
  engga: 'enggak',
  gpp: 'nggak apa-apa',
  gmn: 'gimana',
  sdg: 'sedang',
  sdh: 'sudah',
  udh: 'udah',
  dah: 'udah',
  blm: 'belum',
  knp: 'kenapa',
  klo: 'kalau',
  kl: 'kalau',
  dgn: 'dengan',
  utk: 'untuk',
  dr: 'dari',
  jd: 'jadi',
  jg: 'juga',
  lg: 'lagi',
  aja: 'saja',
  bs: 'bisa',
  hrs: 'harus',
  bkn: 'bukan',
  trs: 'terus',
  tp: 'tapi',
  jgn: 'jangan',
  skrg: 'sekarang',
  td: 'tadi',
  sm: 'sama',
  kmu: 'kamu',
  kmrn: 'kemarin',
  kemaen: 'kemarin',
  tlg: 'tolong',
  mgkn: 'mungkin',
  bntr: 'sebentar',
  sampe: 'sampai',
  gw: 'gue',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSettings() {
  ensureDataDir();
  let raw = {};
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('[EL] Gagal baca settings:', e.message);
  }
  return {
    ...DEFAULTS,
    ...raw,
    voiceSettings: { ...DEFAULT_VOICE_SETTINGS, ...(raw.voiceSettings || {}) },
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
    console.error('[EL] Gagal simpan settings:', e.message);
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
  if (updates.clearApiKey === true) data.apiKey = '';
  if (typeof updates.voiceId === 'string') data.voiceId = updates.voiceId.trim();
  if (typeof updates.modelId === 'string' && updates.modelId.trim()) data.modelId = updates.modelId.trim();

  if (typeof updates.chance === 'number' && Number.isFinite(updates.chance)) {
    data.chance = Math.max(0, Math.min(1, updates.chance));
  } else if (typeof updates.chancePercent === 'number' && Number.isFinite(updates.chancePercent)) {
    data.chance = Math.max(0, Math.min(100, updates.chancePercent)) / 100;
  }

  if (typeof updates.creditsRemaining === 'number' && Number.isFinite(updates.creditsRemaining)) {
    data.creditsRemaining = Math.max(0, Math.floor(updates.creditsRemaining));
  }

  if (updates.voiceSettings && typeof updates.voiceSettings === 'object') {
    data.voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...updates.voiceSettings };
  }

  saveSettings(data);
  return data;
}

function countBillableChars(text) {
  return Array.from(String(text || '')).length;
}

/** 1 karakter terkirim ke ElevenLabs = 1 kredit. */
function deductCredits(charCount) {
  const amount = Math.max(0, Math.floor(Number(charCount) || 0));
  if (!amount) return loadSettings().creditsRemaining;
  const data = loadSettings();
  data.creditsRemaining = Math.max(0, (data.creditsRemaining || 0) - amount);
  saveSettings(data);
  return data.creditsRemaining;
}

/**
 * Satu tag, tanpa spasi di dalamnya. Prioritas: emosi dari AI,
 * lalu mood Callista, lalu gaya VN netral.
 */
function resolveExpressionTag(emotion, mood) {
  const key = String(emotion || '').trim().toLowerCase();
  const tags = EMOTION_TAGS[key];
  if (tags && tags.length) return `[${tags.slice(0, 2).join('・')}]`;

  const m = Number(mood);
  if (Number.isFinite(m)) {
    if (m >= 80) return '[明るく・楽しそう]';
    if (m < 25) return '[疲れた・小声]';
    if (m < 45) return '[落ち着いて]';
  }
  return '[普段の声]';
}

function expandAbbreviations(text) {
  return String(text || '').replace(/\b([a-z]+)\b/gi, (word) => {
    const lower = word.toLowerCase();
    return ABBREVIATIONS[lower] || word;
  });
}

function replaceLaughs(text) {
  return String(text || '')
    .replace(/(?:wkwk+|wkk+|kwk+|haha+|hehe+|hihi+|lol+|xixi+|😂|🤣)+/gi, '[笑]')
    .replace(/(?:\[笑\]\s*){2,}/g, '[笑]');
}

/**
 * Bersihkan teks chat menjadi teks yang layak dibacakan:
 * buang emoji/markdown/link, baca singkatan, ganti ketawa jadi [笑],
 * lalu tempel satu tag ekspresi Jepang di depan.
 */
function preprocessTextForVN(rawText, { emotion = '', mood = 80 } = {}) {
  let text = String(rawText || '').trim();
  if (!text) return '';

  text = text.replace(/<a?:[A-Za-z0-9_]+:\d+>/g, ' ');             // custom emoji
  text = text.replace(/<@[!&]?\d+>|<#\d+>/g, ' ');                   // mention
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');              // [teks](link)
  text = text.replace(/https?:\/\/\S+/gi, ' ');                     // URL
  text = replaceLaughs(text);                                        // wkwk -> [笑]
  text = text.replace(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu, ' ');
  text = text.replace(/[*_~`|#>]/g, ' ');
  text = expandAbbreviations(text);
  text = text.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();

  if (!text || /^(?:\[笑\][\s,.!?]*)+$/.test(text)) return '';

  // Ketawa di awal kalimat sudah cukup jadi satu tag — jangan dobel.
  const startsWithLaugh = /^\[笑\][\s,]*/.test(text);
  if (startsWithLaugh) text = text.replace(/^\[笑\][\s,]*/, '').trim();
  if (!text) return '';

  const tag = startsWithLaugh ? '[笑いながら]' : resolveExpressionTag(emotion, mood);
  return `${tag}${text}`;
}

function shouldSendAsVoice() {
  const s = loadSettings();
  if (!s.enabled || !s.apiKey || !s.voiceId) return false;
  if ((s.creditsRemaining || 0) <= 0) return false;
  const chance = Number.isFinite(s.chance) ? s.chance : 0.30;
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  return Math.random() < chance;
}

function buildVoiceSettings(modelId, voiceSettings) {
  const vs = voiceSettings || DEFAULT_VOICE_SETTINGS;
  if (/^eleven_v[34]/.test(String(modelId || ''))) {
    // v3/v4 memakai stability 0 (Creative) / 0.5 (Natural) / 1 (Robust).
    const raw = Number(vs.stability);
    const stability = !Number.isFinite(raw) ? 0.5 : raw < 0.25 ? 0 : raw < 0.75 ? 0.5 : 1;
    return { stability, style: vs.style ?? 0.15 };
  }
  return vs;
}

async function requestTts(settings, text) {
  try {
    const res = await fetch(
      `${TTS_URL}/${encodeURIComponent(settings.voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': settings.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: settings.modelId,
          voice_settings: buildVoiceSettings(settings.modelId, settings.voiceSettings),
        }),
        signal: AbortSignal.timeout(25000),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[EL] TTS HTTP ${res.status} (${settings.modelId}): ${errText.slice(0, 200)}`);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch (err) {
    console.error(`[EL] TTS error: ${err.message}`);
    return null;
  }
}

/**
 * MP3 -> OGG/Opus (voice message Discord) + waveform + durasi.
 * Return null kalau ffmpeg tidak tersedia / gagal (bot fallback ke MP3).
 */
function convertToVoiceMessage(mp3Buffer) {
  let ffmpegPath = null;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (e) {
    return null;
  }
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return null;

  let tmpDir = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callista-vn-'));
    const oggPath = path.join(tmpDir, 'voice.ogg');

    // Satu proses ffmpeg: output OGG ke file, PCM 8kHz ke stdout untuk waveform.
    const run = cp.spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-f', 'ogg', oggPath,
      '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1',
    ], { input: mp3Buffer, maxBuffer: 64 * 1024 * 1024, timeout: 30000 });

    if (run.status !== 0 || !fs.existsSync(oggPath)) {
      if (run.stderr) console.warn('[EL] ffmpeg:', String(run.stderr).slice(0, 200));
      return null;
    }

    const buffer = fs.readFileSync(oggPath);
    if (!buffer.length) return null;

    const pcm = run.stdout || Buffer.alloc(0);
    const duration = pcm.length
      ? Math.round((pcm.length / 2 / 8000) * 10) / 10
      : Math.max(1, Math.round((mp3Buffer.length * 8) / 128000));

    return {
      buffer,
      duration: Math.max(1, duration),
      waveform: sampleWaveform(pcm).toString('base64'),
    };
  } catch (err) {
    console.error('[EL] Konversi voice message gagal:', err.message);
    return null;
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

/** Peak 256 sampel untuk waveform Discord. */
function sampleWaveform(pcm, count = 256) {
  const out = Buffer.alloc(count);
  const frames = Math.floor((pcm?.length || 0) / 2);
  if (!frames) return out;

  const block = Math.max(1, Math.floor(frames / count));
  for (let i = 0; i < count; i += 1) {
    const start = i * block * 2;
    const end = Math.min(pcm.length, start + block * 2);
    let peak = 0;
    for (let j = start; j + 1 < end; j += 2) {
      const v = Math.abs(pcm.readInt16LE(j));
      if (v > peak) peak = v;
    }
    out[i] = Math.min(255, Math.round((peak / 32768) * 255));
  }
  return out;
}

/**
 * Synthesize ke MP3 lalu konversi ke voice message.
 * Return { buffer, text, charCount, voice: { buffer, duration, waveform } | null }.
 */
async function synthesize(rawText, { emotion = '', mood = 80 } = {}) {
  const settings = loadSettings();
  if (!settings.enabled || !settings.apiKey || !settings.voiceId) return null;

  const text = preprocessTextForVN(rawText, { emotion, mood });
  if (!text) return null;

  let usedModel = settings.modelId;
  let billedText = text;
  let mp3 = await requestTts({ ...settings, modelId: usedModel }, billedText);

  // v3/v4 tidak tersedia di akun ini -> ulang tanpa tag memakai model v2.
  if (!mp3 && /^eleven_v[34]/.test(String(usedModel))) {
    usedModel = FALLBACK_MODEL;
    billedText = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if (billedText) {
      console.warn(`[EL] Fallback ke ${FALLBACK_MODEL} tanpa audio tag.`);
      mp3 = await requestTts({ ...settings, modelId: usedModel }, billedText);
    }
  }

  if (!mp3) return null;

  const charCount = countBillableChars(billedText);
  const creditsRemaining = deductCredits(charCount);
  const voice = convertToVoiceMessage(mp3);
  console.log(
    `[EL] ${charCount} chars via ${usedModel} -> ${voice ? 'voice message' : 'MP3'} | credits left: ${creditsRemaining}`
  );

  return { buffer: mp3, text: billedText, cleanText: String(rawText || '').trim(), charCount, creditsRemaining, voice };
}

/** Payload siap kirim untuk voice message Discord. */
function buildVoicePayload(result, name = 'callista_vn.ogg') {
  if (!result?.voice?.buffer) return null;
  return {
    files: [{
      attachment: result.voice.buffer,
      name,
      duration: result.voice.duration,
      waveform: result.voice.waveform,
    }],
    flags: MessageFlags.IsVoiceMessage,
  };
}

async function fetchVoices(apiKey) {
  const key = apiKey || loadSettings().apiKey;
  if (!key) return null;
  try {
    const res = await fetch(VOICES_URL, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[EL] fetchVoices HTTP', res.status, errText);
      return null;
    }
    const data = await res.json();
    return (data.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category || 'premade',
    }));
  } catch (e) {
    return null;
  }
}

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
      ? data.map(m => ({
          model_id: m.model_id,
          name: m.name,
          description: m.description || '',
        }))
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
  countBillableChars,
  resolveExpressionTag,
  preprocessTextForVN,
  shouldSendAsVoice,
  sampleWaveform,
  convertToVoiceMessage,
  synthesize,
  buildVoicePayload,
  fetchVoices,
  fetchModels,
};
