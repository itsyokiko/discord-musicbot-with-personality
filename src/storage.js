const fs = require('node:fs');
const path = require('node:path');

const configPath = path.resolve(__dirname, '../config.json');
const historyPath = path.resolve(__dirname, '../history.json');
const memoryPath = path.resolve(__dirname, '../memory.json');
const botStatePath = path.resolve(__dirname, '../data/bot_state.json');

function loadJSON(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`[STORAGE] Corrupt JSON at ${filePath}:`, e.message);
  }
  return fallback;
}

function saveJSON(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[STORAGE] Failed to save ${filePath}:`, e.message);
  }
}

const defaultBotState = {
  isResponding: true,
  silencedAt: null,
  silencedReason: null,
  lastDisabledPeriod: null,
  mood: 80,
  silenceCount: 0,
  moodLog: [
    { timestamp: Date.now(), delta: 0, newMood: 80, reason: 'Status awal' }
  ]
};

let botState = { ...defaultBotState, ...loadJSON(botStatePath, defaultBotState) };

function getMoodLabel(score) {
  if (score >= 85) return 'Sangat Bahagia / Ceria';
  if (score >= 65) return 'Senang / Baik';
  if (score >= 45) return 'Biasa / Netral';
  if (score >= 25) return 'Sensi / Kurang Mood';
  return 'Ngambek / Baper Parah';
}

function getBotState() {
  const silencedDurationMinutes = botState.silencedAt
    ? Math.max(0, Math.round((Date.now() - botState.silencedAt) / 60000))
    : 0;
  return {
    ...botState,
    moodState: getMoodLabel(botState.mood ?? 80),
    silencedDurationMinutes
  };
}

function setBotResponding(isResponding, reason = '') {
  const current = Boolean(botState.isResponding);
  const target = Boolean(isResponding);

  if (current && !target) {
    // Dimatikan
    botState.isResponding = false;
    botState.silencedAt = Date.now();
    botState.silencedReason = reason || 'Manual toggle';
  } else if (!current && target) {
    // Dinyalakan kembali
    const durMs = botState.silencedAt ? Date.now() - botState.silencedAt : 0;
    botState.lastDisabledPeriod = {
      disabledAt: botState.silencedAt,
      enabledAt: Date.now(),
      durationMinutes: Math.max(1, Math.round(durMs / 60000)),
      reason: botState.silencedReason
    };
    botState.isResponding = true;
    botState.silencedAt = null;
    botState.silencedReason = null;
  }

  if (current !== target) saveJSON(botStatePath, botState);
  return getBotState();
}

function adjustMood(delta, reason = '') {
  const prev = botState.mood ?? 80;
  const updated = Math.max(0, Math.min(100, Math.round(prev + delta)));
  botState.mood = updated;

  const reasonStr = (reason || '').toLowerCase();
  if (delta < 0 && (reasonStr.includes('diam') || reasonStr.includes('mute'))) {
    botState.silenceCount = (botState.silenceCount || 0) + 1;
  }

  if (!Array.isArray(botState.moodLog)) {
    botState.moodLog = [];
  }
  botState.moodLog.unshift({
    timestamp: Date.now(),
    delta,
    newMood: updated,
    reason: reason || 'Penyesuaian mood'
  });
  if (botState.moodLog.length > 15) {
    botState.moodLog = botState.moodLog.slice(0, 15);
  }

  saveJSON(botStatePath, botState);
  try {
    const todayMemory = require('./todayMemory');
    if (reason) todayMemory.addTodayEntry(`[Mood]: ${reason} (Mood: ${updated}/100)`);
  } catch (e) {}
  return getBotState();
}

function getMood() {
  return botState.mood ?? 80;
}

function getSilencedContextForPrompt(timezone = 'Asia/Jakarta') {
  const state = getBotState();
  if (!state.lastDisabledPeriod) return '';
  const { disabledAt, enabledAt, durationMinutes } = state.lastDisabledPeriod;
  if (!disabledAt || !enabledAt) return '';

  const minutesSinceEnabled = Math.round((Date.now() - enabledAt) / 60000);
  if (minutesSinceEnabled > 24 * 60) return '';

  let excuse = '';
  let durationDesc = '';
  if (durationMinutes < 15) {
    durationDesc = `${durationMinutes || 5} menit yang lalu`;
    excuse = 'tadi lagi ke toilet / ambil minum bentar / afk';
  } else if (durationMinutes < 90) {
    durationDesc = `${durationMinutes} menit yang lalu`;
    excuse = 'tadi lagi bantu nyokap / ada urusan rumah / nugas DKV dadakan bentar';
  } else if (durationMinutes < 300) {
    const hours = Math.round(durationMinutes / 60);
    durationDesc = `${hours} jam yang lalu`;
    excuse = 'tadi lagi sibuk nugas deadline DKV dadakan / ngerender tugas tugas kampus';
  } else {
    durationDesc = 'cukup lama / dari tadi';
    excuse = 'tadi lagi sibuk urusan kampus offline / nugas seharian / ketiduran';
  }

  return `
[KONTEKS OFF / TIDAK MEMBALAS SEBELUMNYA]:
Callista sempat tidak merespon/afk selama sekitar ${durationDesc}.
Jika lawan bicara bertanya kenapa tadi diam saja, tidak menjawab, atau kemana saja:
Jawab secara santai dan realistis layaknya manusia dengan alasan: "${excuse}".
DILARANG KERAS mengatakan "bot dimatikan", "toggle mati", "disuruh diam Mas Joy", atau alasan teknis sistem!`;
}

let config = loadJSON(configPath, {
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.relink-gateway.biz.id/v1',
  name: 'Callista',
  aliases: ['firka', 'callista', 'cal'],
  burstWindowMs: 2500,
  timezone: 'Asia/Jakarta',
  port: 3000,
  maxHistoryPerChannel: 10,
  activity: 77,
  initiative: 10,
  humor: 60,
  warmth: 70,
  empathy: 75,
  assertiveness: 45,
  formality: 25,
  brevity: 88,
  spontaneity: 35,
  emojiFrequency: 30,
  directAddressThreshold: 60,
  conversationFocus: 60,
  interruptionTolerance: 30
});

let history = loadJSON(historyPath, {});
let memory = loadJSON(memoryPath, {});
// Defensive init: file lama mungkin tidak punya semua field
memory.users     = memory.users     || {};
memory.focus     = memory.focus     || {};
memory.summaries = memory.summaries || {};

function getConfig() {
  return config;
}

function updateConfig(newConfig) {
  config = { ...config, ...newConfig };
  saveJSON(configPath, config);
  return config;
}

function getHistory(channelId) {
  return history[channelId] || [];
}

function addHistory(channelId, messageRecord) {
  if (!history[channelId]) {
    history[channelId] = [];
  }
  history[channelId].push(messageRecord);
  const max = config.maxHistoryPerChannel || 10;
  if (history[channelId].length > max) {
    history[channelId] = history[channelId].slice(-max);
  }
  saveJSON(historyPath, history);
}

function removeHistoryMessage(channelId, messageId) {
  if (history[channelId]) {
    history[channelId] = history[channelId].filter(m => m.id !== messageId);
    saveJSON(historyPath, history);
  }
}

function getMemory() {
  return memory;
}

function getDefaultUserProfile(userId, name = '') {
  const cleanName = (name || '').trim();
  const lowerName = cleanName.toLowerCase();

  // 1. Mas Joy (User ID 833196669940138004 atau nama Rieka / Mas Joy)
  if (userId === '833196669940138004' || lowerName === 'rieka' || lowerName.includes('mas joy')) {
    return {
      name: cleanName || 'Rieka',
      style: 'clingy',
      affection: 100,
      relationship: 'Sangat Spesial / Dicintai (Mas Joy)',
      nicknames: ['Mas Joy', 'Ayah', 'Daddy'],
      notes: 'Sosok paling disayangi (Mas Joy). Manja, ceria, perhatian.',
      interactionCount: 1,
      lastSeen: new Date().toISOString()
    };
  }

  // 2. Fusyu match (ID 693089730685829180 atau nama Fusyu)
  const isFusyuName = cleanName === '``Fusyu >_<' || cleanName === 'Fusyu >_< [ᓚᘏᗢ]' || lowerName === 'fusyu' || lowerName === '``fusyu >_<';
  if (userId === '693089730685829180' || isFusyuName) {
    return {
      name: cleanName || '``Fusyu >_<',
      style: 'playfully_hostile',
      affection: 0,
      relationship: 'Ga Suka / Antipati Fiktif',
      nicknames: ['purwanto'],
      notes: 'Antipati fiktif, ketus, cuek, usil/sinis.',
      interactionCount: 1,
      lastSeen: new Date().toISOString()
    };
  }

  // 3. Sonasona match
  if (userId === '704959380180828210' || lowerName === 'sonasona') {
    return {
      name: cleanName || 'Sonasona',
      style: 'playfully_hostile',
      affection: 15,
      relationship: 'Ga Suka / Antipati Fiktif',
      nicknames: [],
      notes: 'Antipati fiktif, ketus, cuek, santai.',
      interactionCount: 1,
      lastSeen: new Date().toISOString()
    };
  }

  // 4. Default untuk siapa pun pengguna baru yang berinteraksi: Ramah / Teman!
  return {
    name: cleanName || userId,
    style: 'friendly',
    affection: 20,
    relationship: 'Teman (Ramah)',
    nicknames: [],
    notes: 'Pengguna baru (otomatis terdaftar)',
    interactionCount: 1,
    lastSeen: new Date().toISOString()
  };
}

function getUserMemory(userId, name = '') {
  if (!memory.users) {
    memory.users = {};
  }

  if (!memory.users[userId]) {
    memory.users[userId] = getDefaultUserProfile(userId, name);
    saveJSON(memoryPath, memory);
  } else {
    if (name && memory.users[userId].name !== name) {
      memory.users[userId].name = name;
      saveJSON(memoryPath, memory);
    }
  }

  const user = memory.users[userId];
  const isVip = userId === '833196669940138004' || (user.name || '').toLowerCase().includes('rieka');
  if (isVip) {
    user.style = 'clingy';
    user.affection = 100;
    if (!user.nicknames || user.nicknames.length === 0) {
      user.nicknames = ['Mas Joy', 'Ayah', 'Daddy'];
    }
  } else if (!user.style) {
    const def = getDefaultUserProfile(userId, user.name || name);
    user.style = def.style;
    if (!user.nicknames && def.nicknames) user.nicknames = def.nicknames;
  }
  const isHostile = user.style === 'playfully_hostile';

  let warmthModifier = 0;
  if (user.style === 'playfully_hostile') warmthModifier = -40;
  else if (user.style === 'cold') warmthModifier = -20;
  else if (user.style === 'neutral') warmthModifier = 0;
  else if (user.style === 'friendly') warmthModifier = 10;
  else if (user.style === 'close') warmthModifier = 25;
  else if (user.style === 'clingy') warmthModifier = 50;

  return {
    userId,
    isVIP: isVip,
    isHostile,
    warmthModifier,
    ...user
  };
}

function updateUserMemory(userId, updates) {
  const current = getUserMemory(userId);
  let nicknames = updates.nicknames !== undefined ? updates.nicknames : current.nicknames;
  if (typeof nicknames === 'string') {
    nicknames = nicknames.split(',').map(s => s.trim()).filter(Boolean);
  }

  memory.users[userId] = {
    name: updates.name !== undefined ? updates.name : current.name,
    style: updates.style || current.style || 'friendly',
    affection: updates.affection !== undefined ? (() => { const p = parseInt(updates.affection, 10); return isNaN(p) ? current.affection : Math.max(0, Math.min(100, p)); })() : current.affection,
    relationship: updates.relationship || current.relationship || 'Teman (Ramah)',
    nicknames: Array.isArray(nicknames) ? nicknames : [],
    notes: updates.notes !== undefined ? updates.notes : (current.notes || ''),
    interactionCount: updates.interactionCount !== undefined ? updates.interactionCount : (current.interactionCount || 1),
    lastSeen: updates.lastSeen || current.lastSeen || new Date().toISOString()
  };

  saveJSON(memoryPath, memory);
  return getUserMemory(userId);
}

function deleteUserMemory(userId) {
  if (memory.users && memory.users[userId]) {
    delete memory.users[userId];
    saveJSON(memoryPath, memory);
    return true;
  }
  return false;
}

function recordInteraction(userId, name = '') {
  const user = getUserMemory(userId, name);
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { timeZone: config.timezone || 'Asia/Jakarta' }) + ' ' + 
                  now.toLocaleTimeString('id-ID', { timeZone: config.timezone || 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });

  updateUserMemory(userId, {
    interactionCount: (user.interactionCount || 0) + 1,
    lastSeen: dateStr
  });
}

function getRelationshipProfile(userId, displayName = '') {
  if (userId === '833196669940138004' || (displayName && displayName.trim().toLowerCase() === 'rieka')) {
    return getUserMemory('833196669940138004', displayName || 'Rieka');
  }
  const fusyuExact = ['fusyu >_< [ᓚᘏᗢ]', '``fusyu >_<', 'fusyu'];
  if (userId === '693089730685829180' || (displayName && fusyuExact.includes(displayName.trim().toLowerCase()))) {
    return getUserMemory(userId || '693089730685829180', displayName || '``Fusyu >_<');
  }
  if (userId === '704959380180828210' || (displayName && displayName.trim().toLowerCase() === 'sonasona')) {
    return getUserMemory(userId || '704959380180828210', displayName);
  }
  if (userId && memory.users && memory.users[userId]) {
    const u = getUserMemory(userId, displayName);
    if (u.style && u.style !== 'friendly') return u;
  }
  return null;
}

function getFocus(channelId) {
  const f = memory.focus[channelId];
  if (!f) return null;
  if (Date.now() > f.expiresAt) {
    delete memory.focus[channelId];
    saveJSON(memoryPath, memory);
    return null;
  }
  return f;
}

function setFocus(channelId, userId, durationSeconds) {
  const expiresAt = Date.now() + (durationSeconds || config.conversationFocus || 60) * 1000;
  memory.focus[channelId] = { userId, expiresAt };
  saveJSON(memoryPath, memory);
}

function clearFocus(channelId) {
  if (memory.focus[channelId]) {
    delete memory.focus[channelId];
    saveJSON(memoryPath, memory);
  }
}

function saveSummary(channelId, summary) {
  memory.summaries[channelId] = summary;
  saveJSON(memoryPath, memory);
}

module.exports = {
  getConfig,
  updateConfig,
  getHistory,
  addHistory,
  removeHistoryMessage,
  getMemory,
  getDefaultUserProfile,
  getUserMemory,
  updateUserMemory,
  deleteUserMemory,
  recordInteraction,
  getRelationshipProfile,
  getFocus,
  setFocus,
  clearFocus,
  saveSummary,
  getBotState,
  setBotResponding,
  adjustMood,
  getMood,
  getMoodLabel,
  getSilencedContextForPrompt
};
