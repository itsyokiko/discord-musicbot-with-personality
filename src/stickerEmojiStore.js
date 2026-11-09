const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.resolve(__dirname, '../data');
const STICKER_EMOJI_FILE = path.join(DATA_DIR, 'sticker_emoji.json');

/**
 * Kategori ekspresi PRESET yang tersedia untuk klasifikasi sticker/emoji.
 * Dipakai di dashboard (dropdown) dan di AI prompt.
 *
 * Dibagi dua:
 * - PRESET_EXPRESSIONS: kategori bawaan (dasar + nuanced)
 * - Custom expressions: ditambahkan user via dashboard, disimpan di file JSON
 *
 * User bisa menambahkan kategori sendiri bebas (misal: "menggelitik", "jijik", "creepy", dll).
 */

// Kategori dasar (emosi umum)
const PRESET_BASIC = [
  { value: 'senang',   label: '😊 Senang / Ceria' },
  { value: 'ketawa',   label: '😂 Ketawa / Ngakak' },
  { value: 'manja',    label: '🥺 Manja / Clingy' },
  { value: 'bingung',  label: '🤔 Bingung / Ga Paham' },
  { value: 'mikir',    label: '🤓 Mikir / Lagi Nugas' },
  { value: 'malas',    label: '😪 Malas / Mager' },
  { value: 'kesal',    label: '😤 Kesal / Sebal' },
  { value: 'ngantuk',  label: '😴 Ngantuk / Mau Tidur' },
  { value: 'kaget',    label: '😲 Kaget / Terkejut' },
  { value: 'deadpan',  label: '🗿 Deadpan / Speechless' },
  { value: 'nangis',   label: '😭 Nangis / Sedih' },
  { value: 'marah',    label: '😡 Marah / Benci' }
];

// Kategori nuanced (reaksi spesifik, bukan emosi dasar kaku)
const PRESET_NUANCED = [
  { value: 'menggelitik',    label: '😆 Menggelitik / Garuk Kepala' },
  { value: 'jijik',          label: '🤢 Jijik / Muak' },
  { value: 'creepy',         label: '😨 Creepy / Merinding' },
  { value: 'cringe',         label: '🫠 Cringe / Nggak Tahan' },
  { value: 'sinis',          label: '😏 Sinis / Senyum Sindir' },
  { value: 'malu',           label: '😳 Malu / Salting' },
  { value: 'susah_kata',     label: '🫤 Susah Dijelaskan / Gimana Gitu' },
  { value: 'ngeri',          label: '😬 Ngeri / Seram' },
  { value: 'lelah_total',    label: '🫠 Lelah Total / Wantob' },
  { value: 'galau',          label: '🥀 Galau / Baper Sendiri' },
  { value: 'terharu',        label: '🥹 Terharu / Nyaris Nangis' },
  { value: 'skeptis',        label: '🙄 Skeptis / Ga Percaya' },
  { value: 'penasaran',      label: '🧐 Penasaran / Wuhuu' },
  { value: 'ngakak_sinis',   label: '🤡 Ngakak Sinis / Ngalah' },
  { value: 'wtf',            label: '❓ WTF / Logika Dimana' },
  { value: 'santuy',         label: '😎 Santuy / Ga Peduli' },
  { value: 'pusing',         label: '😵 Pusing / Headache' },
  { value: 'gelisah',        label: '😖 Gelisah / Ga Tenang' }
];

const VALID_EXPRESSIONS = [...PRESET_BASIC, ...PRESET_NUANCED];

const VALID_EXPRESSION_VALUES = VALID_EXPRESSIONS.map(e => e.value);

function isValidExpression(expr) {
  if (!expr || typeof expr !== 'string') return false;
  // Cek preset dulu
  if (VALID_EXPRESSION_VALUES.includes(expr)) return true;
  // Cek custom expressions
  const data = loadStickerEmoji();
  return (data.customExpressions || []).some(e => e.value === expr);
}

/**
 * Dapatkan semua ekspresi yang tersedia (preset + custom).
 * Format: [{ value, label, isCustom }]
 */
function getAllExpressions() {
  const data = loadStickerEmoji();
  const custom = (data.customExpressions || []).map(e => ({ ...e, isCustom: true }));
  return [...VALID_EXPRESSIONS.map(e => ({ ...e, isCustom: false })), ...custom];
}

/**
 * Validasi value custom expression (huruf/angka/underscore, 2-30 char).
 */
function isValidExpressionValue(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[a-z0-9_]{2,30}$/.test(value);
}

function addCustomExpression(value, label) {
  const cleanValue = (value || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (!isValidExpressionValue(cleanValue)) {
    throw new Error('Value ekspresi tidak valid. Gunakan huruf kecil, angka, underscore (2-30 char).');
  }
  if (VALID_EXPRESSION_VALUES.includes(cleanValue)) {
    throw new Error(`Ekspresi "${cleanValue}" sudah ada di preset.`);
  }

  const data = loadStickerEmoji();
  if (!data.customExpressions) data.customExpressions = [];
  if (data.customExpressions.some(e => e.value === cleanValue)) {
    throw new Error(`Ekspresi custom "${cleanValue}" sudah ada.`);
  }

  const expr = {
    value: cleanValue,
    label: (label || '').trim() || cleanValue,
    createdAt: new Date().toISOString()
  };
  data.customExpressions.push(expr);
  saveStickerEmoji(data);
  return expr;
}

function updateCustomExpression(value, updates = {}) {
  const data = loadStickerEmoji();
  if (!data.customExpressions) return null;
  const idx = data.customExpressions.findIndex(e => e.value === value);
  if (idx === -1) return null;

  if (updates.label !== undefined) {
    data.customExpressions[idx].label = (updates.label || '').trim() || value;
  }
  saveStickerEmoji(data);
  return data.customExpressions[idx];
}

function deleteCustomExpression(value) {
  const data = loadStickerEmoji();
  if (!data.customExpressions) return false;
  const before = data.customExpressions.length;
  data.customExpressions = data.customExpressions.filter(e => e.value !== value);

  // Cek apakah ada emoji/sticker yang masih pakai ekspresi ini
  const usedByEmoji = data.emojis.some(e => e.expression === value);
  const usedBySticker = data.stickers.some(s => s.expression === value);
  if (usedByEmoji || usedBySticker) {
    // Tolak hapus jika masih dipakai
    return false;
  }

  if (data.customExpressions.length < before) {
    saveStickerEmoji(data);
    return true;
  }
  return false;
}

/**
 * Dapatkan label ekspresi (preset atau custom).
 */
function getExpressionLabel(value) {
  const preset = VALID_EXPRESSIONS.find(e => e.value === value);
  if (preset) return preset.label;
  const data = loadStickerEmoji();
  const custom = (data.customExpressions || []).find(e => e.value === value);
  return custom ? custom.label : value;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStickerEmoji() {
  ensureDataDir();
  try {
    if (fs.existsSync(STICKER_EMOJI_FILE)) {
      const raw = fs.readFileSync(STICKER_EMOJI_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        emojis: Array.isArray(parsed.emojis) ? parsed.emojis : [],
        stickers: Array.isArray(parsed.stickers) ? parsed.stickers : [],
        customExpressions: Array.isArray(parsed.customExpressions) ? parsed.customExpressions : [],
        settings: {
          mode: parsed.settings?.mode === 'manual' ? 'manual' : 'auto',
          manualFrequency: typeof parsed.settings?.manualFrequency === 'number'
            ? Math.max(0, Math.min(100, parsed.settings.manualFrequency))
            : 20
        }
      };
    }
  } catch (e) {}
  return {
    emojis: [],
    stickers: [],
    customExpressions: [],
    settings: { mode: 'auto', manualFrequency: 20 }
  };
}

function saveStickerEmoji(data) {
  ensureDataDir();
  const tmpFile = `${STICKER_EMOJI_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, STICKER_EMOJI_FILE);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
    return false;
  }
}

/**
 * Validasi format emoji code.
 * Static:  <:name:id>
 * Animated: <a:name:id>
 */
function validateEmojiCode(code) {
  if (!code || typeof code !== 'string') return false;
  return /^<a?:[a-zA-Z0-9_]+:\d+>$/.test(code.trim());
}

function isAnimatedEmoji(code) {
  return /^<a:/.test((code || '').trim());
}

/**
 * Ekstrak nama dan ID dari emoji code untuk dipakai di discord.js react().
 * <:name:id> → { name: 'name', id: 'id', identifier: 'name:id' }
 */
function parseEmojiCode(code) {
  const match = (code || '').match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (!match) return null;
  return {
    animated: match[1] === 'a',
    name: match[2],
    id: match[3],
    identifier: `${match[2]}:${match[3]}`,
    code: code.trim()
  };
}

/**
 * Validasi sticker ID (hanya angka, panjang 17-25).
 */
function validateStickerId(stickerId) {
  if (!stickerId || typeof stickerId !== 'string') return false;
  return /^\d{17,25}$/.test(stickerId.trim());
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addEmoji({ label, expression, code }) {
  const data = loadStickerEmoji();
  const trimmedCode = (code || '').trim();
  if (!validateEmojiCode(trimmedCode)) {
    throw new Error('Format emoji tidak valid. Gunakan format <:nama:id> atau <a:nama:id>');
  }
  if (!isValidExpression(expression)) {
    throw new Error(`Kategori ekspresi tidak valid. Pilih dari preset atau daftarkan custom expression dulu.`);
  }

  const emoji = {
    id: generateId('emoji'),
    label: (label || '').trim() || 'Tanpa Nama',
    expression,
    code: trimmedCode,
    animated: isAnimatedEmoji(trimmedCode)
  };
  data.emojis.push(emoji);
  saveStickerEmoji(data);
  return emoji;
}

function addSticker({ label, expression, stickerId }) {
  const data = loadStickerEmoji();
  const trimmedId = (stickerId || '').trim();
  if (!validateStickerId(trimmedId)) {
    throw new Error('Sticker ID tidak valid. Harus berupa angka (17-25 digit).');
  }
  if (!isValidExpression(expression)) {
    throw new Error(`Kategori ekspresi tidak valid. Pilih dari preset atau daftarkan custom expression dulu.`);
  }

  const sticker = {
    id: generateId('sticker'),
    label: (label || '').trim() || 'Tanpa Nama',
    expression,
    stickerId: trimmedId
  };
  data.stickers.push(sticker);
  saveStickerEmoji(data);
  return sticker;
}

function updateEmoji(id, updates) {
  const data = loadStickerEmoji();
  const idx = data.emojis.findIndex(e => e.id === id);
  if (idx === -1) return null;

  if (updates.code) {
    const trimmed = updates.code.trim();
    if (!validateEmojiCode(trimmed)) {
      throw new Error('Format emoji tidak valid. Gunakan format <:nama:id> atau <a:nama:id>');
    }
    data.emojis[idx].code = trimmed;
    data.emojis[idx].animated = isAnimatedEmoji(trimmed);
  }
  if (updates.label !== undefined) data.emojis[idx].label = (updates.label || '').trim() || 'Tanpa Nama';
  if (updates.expression) {
    if (!isValidExpression(updates.expression)) {
      throw new Error(`Kategori ekspresi tidak valid.`);
    }
    data.emojis[idx].expression = updates.expression;
  }
  saveStickerEmoji(data);
  return data.emojis[idx];
}

function updateSticker(id, updates) {
  const data = loadStickerEmoji();
  const idx = data.stickers.findIndex(s => s.id === id);
  if (idx === -1) return null;

  if (updates.stickerId) {
    const trimmed = updates.stickerId.trim();
    if (!validateStickerId(trimmed)) {
      throw new Error('Sticker ID tidak valid.');
    }
    data.stickers[idx].stickerId = trimmed;
  }
  if (updates.label !== undefined) data.stickers[idx].label = (updates.label || '').trim() || 'Tanpa Nama';
  if (updates.expression) {
    if (!isValidExpression(updates.expression)) {
      throw new Error(`Kategori ekspresi tidak valid.`);
    }
    data.stickers[idx].expression = updates.expression;
  }
  saveStickerEmoji(data);
  return data.stickers[idx];
}

function deleteEmoji(id) {
  const data = loadStickerEmoji();
  const before = data.emojis.length;
  data.emojis = data.emojis.filter(e => e.id !== id);
  if (data.emojis.length < before) {
    saveStickerEmoji(data);
    return true;
  }
  return false;
}

function deleteSticker(id) {
  const data = loadStickerEmoji();
  const before = data.stickers.length;
  data.stickers = data.stickers.filter(s => s.id !== id);
  if (data.stickers.length < before) {
    saveStickerEmoji(data);
    return true;
  }
  return false;
}

function getEmojisByExpression(expression) {
  const data = loadStickerEmoji();
  return data.emojis.filter(e => e.expression === expression);
}

function getStickersByExpression(expression) {
  const data = loadStickerEmoji();
  return data.stickers.filter(s => s.expression === expression);
}

function getRandomEmojiByExpression(expression) {
  const emojis = getEmojisByExpression(expression);
  if (emojis.length === 0) return null;
  return emojis[Math.floor(Math.random() * emojis.length)];
}

function getRandomStickerByExpression(expression) {
  const stickers = getStickersByExpression(expression);
  if (stickers.length === 0) return null;
  return stickers[Math.floor(Math.random() * stickers.length)];
}

function hasAnyStickerOrEmoji() {
  const data = loadStickerEmoji();
  return data.emojis.length > 0 || data.stickers.length > 0;
}

// ===== SETTINGS MANAGEMENT =====

function getSettings() {
  return loadStickerEmoji().settings;
}

function updateSettings(updates) {
  const data = loadStickerEmoji();
  if (!data.settings) data.settings = { mode: 'auto', manualFrequency: 20 };
  if (updates.mode === 'manual' || updates.mode === 'auto') {
    data.settings.mode = updates.mode;
  }
  if (typeof updates.manualFrequency === 'number') {
    data.settings.manualFrequency = Math.max(0, Math.min(100, parseInt(updates.manualFrequency, 10) || 0));
  }
  saveStickerEmoji(data);
  return data.settings;
}

// ===== PROBABILITY ENGINE (Auto Mode) =====

/**
 * Hitung probabilitas pemakaian sticker/emoji-only berdasarkan:
 * - Affection (makin rendah → makin sering ketus/sticker)
 * - Relationship style (hostile → lebih sering)
 * - Mood (mood rendah → lebih sering sticker ketus)
 *
 * Returns: { probability: 0-1, preferredExpression: string|null, hint: string }
 */
function calculateStickerEmojiProbability(userProfile, mood = 80) {
  if (!userProfile) return { probability: 0, preferredExpression: null, hint: '' };

  const affection = userProfile.affection ?? 50;
  const style = userProfile.style || 'friendly';
  const isHostile = style === 'playfully_hostile' || userProfile.isHostile;
  const isVip = userProfile.isVIP || style === 'clingy';

  // Base probability berdasarkan affection tier
  let prob = 0;
  let preferredExpr = null;

  if (affection <= 15 || isHostile) {
    // Hostile / antipati: 45% chance sticker/emoji only
    prob = 0.45;
    preferredExpr = ['malas', 'deadpan', 'kesal', 'marah'][Math.floor(Math.random() * 4)];
  } else if (affection <= 30) {
    // Cold: 35% chance
    prob = 0.35;
    preferredExpr = ['malas', 'deadpan', 'bingung'][Math.floor(Math.random() * 3)];
  } else if (affection <= 50) {
    // Neutral: 25% chance
    prob = 0.25;
    preferredExpr = ['bingung', 'deadpan', 'mikir'][Math.floor(Math.random() * 3)];
  } else if (affection <= 75) {
    // Friendly: 20% chance
    prob = 0.20;
    preferredExpr = null; // AI bebas pilih
  } else {
    // Clingy / Mas Joy: 15% chance
    prob = 0.15;
    preferredExpr = null;
  }

  // Mood modifier
  if (mood < 35) {
    // Mood sensi/ngambek → +15% lebih mungkin sticker ketus
    prob = Math.min(0.65, prob + 0.15);
    if (!preferredExpr) preferredExpr = ['malas', 'kesal', 'deadpan'][Math.floor(Math.random() * 3)];
  } else if (mood > 80) {
    // Mood ceria → lebih variatif
    prob = Math.max(0.10, prob);
  }

  // VIP cap disesuaikan
  if (isVip) {
    prob = Math.min(prob, 0.20);
  }

  // Build hint string untuk AI
  let hint = '';
  const percent = Math.round(prob * 100);
  if (percent >= 35) {
    hint = `Saat ini Callista SANGAT CENDERUNG berekspresi visual (~${percent}%). Prioritaskan STICKER_ONLY atau EMOJI_ONLY jika ekspresi cocok, atau selipkan custom emoji di dalam teks.`;
  } else if (percent >= 20) {
    hint = `Saat ini Callista CENDERUNG berekspresi visual (~${percent}%). Gunakan STICKER_ONLY/EMOJI_ONLY untuk reaksi spontan, atau selipkan custom emoji di dalam teks pesan.`;
  } else {
    hint = `Saat ini Callista aktif menggunakan visual (~${percent}%). Boleh gunakan STICKER_ONLY/EMOJI_ONLY untuk momen yang pas, atau selipkan custom emoji di akhir kalimat teks.`;
  }

  if (preferredExpr) {
    hint += ` Ekspresi yang cocok untuk user ini: ${preferredExpr}.`;
  }

  return { probability: prob, preferredExpression: preferredExpr, hint };
}

/**
 * Deteksi pesan "absurd" yang cocok dijawab dengan sticker (misal: "logikanya dimana").
 * Heuristik sederhana: pesan tidak nyambung, terlalu random, atau berisi pertanyaan aneh.
 */
function detectAbsurdMessage(content) {
  if (!content || typeof content !== 'string') return false;
  const lower = content.toLowerCase().trim();

  // Pesan tidak jelas / random
  if (lower.length < 3 && !/^[a-zA-Z]+$/.test(lower)) return true;

  // Keyboard smash / random chars
  if (/^(asdf|qwer|zxcv|ajsj|skks|hahaha[a-z]{10,}|wkwkw[a-z]{10,})/i.test(lower)) return true;

  // Pertanyaan absurd / tidak masuk akal
  const absurdPatterns = [
    /\b(kenapa\s+langit\s+biru|kenapa\s+ayam\s+melewati\s+jalan|apakah\s+saya\s+ganjil)\b/i,
    /\b(bumi\s+datar|flat\s+earth|2\s*\+\s*2\s*=?\s*5)\b/i
  ];
  for (const p of absurdPatterns) {
    if (p.test(lower)) return true;
  }

  return false;
}

/**
 * Tentukan apakah mode auto menyarankan sticker/emoji untuk respons ini.
 * Dipanggil sebelum AI call untuk memberikan hint.
 */
function getAutoModeHint(userProfile, mood, messageContent) {
  const settings = getSettings();
  if (settings.mode !== 'auto') return null;

  if (!hasAnyStickerOrEmoji()) return null;

  const { probability, preferredExpression, hint } = calculateStickerEmojiProbability(userProfile, mood);

  // Jika pesan absurd → force suggest sticker bingung/deadpan
  let absurdHint = '';
  if (detectAbsurdMessage(messageContent)) {
    const absurdExpr = ['bingung', 'deadpan', 'kaget'][Math.floor(Math.random() * 3)];
    absurdHint = `\n[DETEKSI PESAN ABSURD]: Pesan user terdeteksi absurd/tidak masuk akal. SANGAT DIREKOMENDASIKAN merespons dengan STICKER_ONLY atau EMOJI_ONLY berkategori "${absurdExpr}" jika tersedia.`;
  }

  return {
    probability,
    preferredExpression,
    hint: hint + absurdHint
  };
}

/**
 * Mode manual: hitung probabilitas dari slider.
 */
function getManualModeHint() {
  const settings = getSettings();
  if (settings.mode !== 'manual') return null;
  if (!hasAnyStickerOrEmoji()) return null;

  const freq = settings.manualFrequency / 100;
  let hint = '';
  const percent = Math.round(freq * 100);
  if (percent >= 40) {
    hint = `Frekuensi sticker/emoji-only disetel TINGGI (~${percent}%). Callista sering merespons dengan STICKER_ONLY/EMOJI_ONLY.`;
  } else if (percent >= 15) {
    hint = `Frekuensi sticker/emoji-only disetel SEDANG (~${percent}%). Callista kadang merespons dengan STICKER_ONLY/EMOJI_ONLY sesuai konteks.`;
  } else if (percent > 0) {
    hint = `Frekuensi sticker/emoji-only disetel RENDAH (~${percent}%). Callista jarang merespons dengan sticker/emoji-only, hanya untuk momen khusus.`;
  } else {
    hint = `Frekuensi sticker/emoji-only disetel 0%. Callista TIDAK memakai sticker/emoji-only. Hanya boleh selipkan custom emoji inline di teks atau sebagai reaction.`;
  }

  return { probability: freq, preferredExpression: null, hint };
}

function getModeHint(userProfile, mood, messageContent) {
  const settings = getSettings();
  if (settings.mode === 'manual') {
    return getManualModeHint();
  }
  return getAutoModeHint(userProfile, mood, messageContent);
}

/**
 * Membangun blok teks ringkas untuk di-inject ke system prompt AI.
 * Token-efficient: hanya tampilkan yang ada, dikelompokkan per ekspresi.
 */
function buildPromptSnippet(modeHint = '') {
  const data = loadStickerEmoji();
  if (data.emojis.length === 0 && data.stickers.length === 0) {
    return '';
  }

  // Kelompokkan per ekspresi (preset + custom)
  const allExprValues = getAllExpressions().map(e => e.value);
  const byExpression = {};
  for (const expr of allExprValues) {
    const emojis = data.emojis.filter(e => e.expression === expr);
    const stickers = data.stickers.filter(s => s.expression === expr);
    if (emojis.length > 0 || stickers.length > 0) {
      byExpression[expr] = { emojis, stickers, label: getExpressionLabel(expr) };
    }
  }

  const exprKeys = Object.keys(byExpression);
  if (exprKeys.length === 0) return '';

  let lines = [];
  lines.push('[STICKER & CUSTOM EMOJI TERSEDIA]:');
  lines.push('Callista bisa merespons HANYA dengan sticker atau custom emoji (tanpa teks) jika ekspresi tersebut lebih kuat dari kata-kata.');
  lines.push('');
  lines.push('Ekspresi tersedia:');

  for (const expr of exprKeys) {
    const { emojis, stickers, label } = byExpression[expr];
    const parts = [];
    if (emojis.length > 0) {
      parts.push(`emoji: ${emojis.map(e => e.code).join(' / ')}`);
    }
    if (stickers.length > 0) {
      parts.push(`sticker: ${stickers.map(s => s.label).join(' / ')}`);
    }
    lines.push(`- ${label} (${expr}) → ${parts.join(' | ')}`);
  }

  lines.push('');
  lines.push('Format respons visual:');
  lines.push('- STICKER_ONLY: Kirim HANYA 1 sticker tanpa teks. Set "stickerExpression" ke salah satu kategori di atas. Sangat cocok saat ekspresi visual lebih kena.');
  lines.push('- EMOJI_ONLY: Kirim HANYA 1 custom emoji tanpa teks. Set "emojiExpression" dan "customEmojiCode" ke salah satu emoji di atas.');
  lines.push('- REACTION_ONLY: "reactionEmoji" bisa unicode emoji ATAU custom emoji code dari daftar di atas.');
  lines.push('');
  lines.push('PANDUAN EKSPRESI DISCORD (EMOJI & STIKER):');
  lines.push('- DISARANKAN: Selipkan 1 custom emoji code (misal: <:meng_05:...>, <:nanii:...>, <:WKWKWK:...>) langsung di akhir kalimat teks (SHORT_TEXT/STACKED_TEXT) layaknya anak Discord yang ekspresif.');
  lines.push('- Pakai STICKER_ONLY atau EMOJI_ONLY ketika reaksi visual terasa lebih spontan dan pas (misal saat kaget, deadpan, mager/malas, atau heran).');
  lines.push('- Pilih kategori ekspresi yang cocok dengan konteks & emosi Callista saat ini.');

  if (modeHint) {
    lines.push('');
    lines.push(`[FREKUENSI STICKER/EMOJI SAAT INI]: ${modeHint}`);
  }

  return lines.join('\n');
}

module.exports = {
  STICKER_EMOJI_FILE,
  VALID_EXPRESSIONS,
  VALID_EXPRESSION_VALUES,
  isValidExpression,
  isValidExpressionValue,
  getAllExpressions,
  addCustomExpression,
  updateCustomExpression,
  deleteCustomExpression,
  getExpressionLabel,
  loadStickerEmoji,
  saveStickerEmoji,
  validateEmojiCode,
  validateStickerId,
  parseEmojiCode,
  addEmoji,
  addSticker,
  updateEmoji,
  updateSticker,
  deleteEmoji,
  deleteSticker,
  getEmojisByExpression,
  getStickersByExpression,
  getRandomEmojiByExpression,
  getRandomStickerByExpression,
  hasAnyStickerOrEmoji,
  getSettings,
  updateSettings,
  calculateStickerEmojiProbability,
  detectAbsurdMessage,
  getAutoModeHint,
  getManualModeHint,
  getModeHint,
  buildPromptSnippet
};
