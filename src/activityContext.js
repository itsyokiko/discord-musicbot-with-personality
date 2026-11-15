'use strict';
/**
 * Activity Context & Context Synthesizer (Episodic Context Distillation)
 *
 * Mengumpulkan aktivitas dan obrolan lintas-channel (chat, musik, voice)
 * dan merangkumnya secara inkremental di background menggunakan LLM tanpa
 * membawa prompt persona Callista yang berat.
 *
 * Menghemat token dengan:
 * 1. Delta threshold: hanya menganalisis jika ada minimal N pesan baru (default: 15).
 * 2. Caching: jika obrolan belum bertambah, skip pemanggilan LLM (0 token).
 * 3. Inkremental: pembaruan berikutnya hanya menyandingkan ringkasan lama + aktivitas delta terbaru,
 *    bukan mengulang 100 chat mentah dari awal.
 * 4. Output ringkas: menghasilkan 3-5 poin padat (~80-150 token) untuk disuapkan ke Callista.
 */

const fs = require('node:fs');
const path = require('node:path');

const filePath = path.resolve(__dirname, '../data/activity_context.json');
const MAX_ACTIVITIES = 100;
const DEFAULT_DELTA_THRESHOLD = 15;

const activitiesBuffer = [];
let activityCounter = 0;
let newActivitiesSinceSynthesis = 0;
let periodicTimer = null;

// Format waktu jam:menit
function formatTime(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function loadState() {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data === 'object') {
        return {
          last_synthesized_at: data.last_synthesized_at || null,
          last_activity_id: data.last_activity_id || 0,
          summary: data.summary || '',
          last_delta_count: data.last_delta_count || 0,
        };
      }
    }
  } catch (e) {
    console.warn('[ACTIVITY_CONTEXT] Gagal membaca activity_context.json:', e.message);
  }
  return {
    last_synthesized_at: null,
    last_activity_id: 0,
    summary: '',
    last_delta_count: 0,
  };
}

let currentState = loadState();

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[ACTIVITY_CONTEXT] Gagal menyimpan activity_context.json:', e.message);
  }
}

/**
 * Catat aktivitas baru (chat, pemutaran musik, kejadian voice).
 */
function recordActivity({ type = 'chat', channelId = '', channelLabel = '', authorName = '', text = '', isBot = false, isJoy = false, timestamp = Date.now() }) {
  if (!text || typeof text !== 'string') return;
  const rawDate = new Date(timestamp);

  // Bersihkan teks & batasi panjang per item agar buffer tetap ringan
  let cleanText = text.replace(/\s+/g, ' ').trim();
  if (cleanText.length > 150) {
    cleanText = `${cleanText.slice(0, 147)}...`;
  }

  const chan = channelLabel || (channelId ? `#${channelId}` : '#channel');
  const author = authorName || (isBot ? 'Callista' : 'User');

  const item = {
    id: ++activityCounter,
    timestamp,
    timeStr: formatTime(rawDate),
    type, // 'chat' | 'music' | 'voice'
    channel: chan,
    author,
    isBot: Boolean(isBot),
    isJoy: Boolean(isJoy),
    text: cleanText,
  };

  activitiesBuffer.push(item);
  if (activitiesBuffer.length > MAX_ACTIVITIES) {
    activitiesBuffer.shift();
  }

  newActivitiesSinceSynthesis++;
}

/**
 * Cek apakah perlu dilakukan sintesis AI berdasarkan jumlah aktivitas baru.
 */
function shouldSynthesize(deltaThreshold = DEFAULT_DELTA_THRESHOLD) {
  // Jika buffer masih kosong atau tidak ada aktivitas baru sama sekali
  if (activitiesBuffer.length === 0 || newActivitiesSinceSynthesis === 0) {
    return false;
  }
  // Belum pernah disintesis sebelumnya -> butuh minimal 8 aktivitas
  if (!currentState.summary && activitiesBuffer.length >= 8) {
    return true;
  }
  // Sudah ada ringkasan -> hanya jalankan jika sudah melewati threshold delta
  return newActivitiesSinceSynthesis >= deltaThreshold;
}

/**
 * Jalankan sintesis konteks menggunakan LLM di background.
 * options.llmClient = fungsi mock opsional untuk unit test
 * options.force = paksa sintesis tanpa mengecek threshold
 */
async function synthesizeContext(options = {}) {
  const threshold = options.deltaThreshold || DEFAULT_DELTA_THRESHOLD;
  const force = Boolean(options.force);

  if (!force && !shouldSynthesize(threshold)) {
    return currentState.summary;
  }

  const deltaCount = newActivitiesSinceSynthesis;
  const itemsCount = (currentState.summary && !options.fromScratch) ? deltaCount : Math.max(deltaCount, 25);
  const recentItems = activitiesBuffer.slice(-Math.max(itemsCount, 1));

  // Format daftar aktivitas untuk input LLM (hanya fakta: [jam] [channel] [author]: text)
  const lines = recentItems.map(item => {
    if (item.type === 'music') {
      return `[${item.timeStr}] [${item.channel}] [MUSIK]: ${item.author} ${item.text}`;
    }
    if (item.type === 'voice') {
      return `[${item.timeStr}] [${item.channel}] [VOICE]: ${item.text}`;
    }
    return `[${item.timeStr}] [${item.channel}] [${item.author}]: ${item.text}`;
  });

  const activitiesText = lines.join('\n');

  // Prompt ringkas tanpa persona Callista (pure fact extraction)
  const systemPrompt = `Kamu adalah penganalisis konteks percakapan dan aktivitas server Discord.
Tugasmu merangkum dinamika situasi dan percakapan terkini dalam 3-5 poin padat (maksimal 120 kata total).
Fokus pada:
- Topik utama yang sedang dibahas anggota server & siapa yang membicarakan apa.
- Apa yang baru saja dikatakan atau dilakukan Callista (jika ada).
- Peristiwa musik / voice / kejadian menarik lain (jika ada).
DILARANG berakting, DILARANG bertele-tele, DILARANG memakai format selain poin-poin ringkas.`;

  let userPrompt = '';
  if (currentState.summary && !options.fromScratch) {
    // Mode Inkremental: Perbarui ringkasan lama dengan delta terbaru
    userPrompt = `[RINGKASAN SITUASI SEBELUMNYA]:
${currentState.summary}

[AKTIVITAS & OBROLAN TERBARU BARU SAJA]:
${activitiesText}

Perbarui ringkasan situasi server di atas dengan informasi terbaru menjadi 3-5 poin padat:`;
  } else {
    // Mode Awal: Buat ringkasan dari nol
    userPrompt = `[AKTIVITAS & OBROLAN SERVER TERAKHIR]:
${activitiesText}

Buat ringkasan situasi server terkini dalam 3-5 poin padat:`;
  }

  try {
    let summaryText = '';
    if (typeof options.llmClient === 'function') {
      summaryText = await options.llmClient({ systemPrompt, userPrompt });
    } else {
      const llm = require('./llm');
      const res = await llm.chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        timeoutMs: 15000,
        maxTokens: 180,
      });
      if (res && res.content) {
        summaryText = res.content.trim();
      }
    }

    if (summaryText && summaryText.length > 10) {
      // Bersihkan jika ada tanda kutip luar
      if ((summaryText.startsWith('"') && summaryText.endsWith('"')) || (summaryText.startsWith("'") && summaryText.endsWith("'"))) {
        summaryText = summaryText.slice(1, -1).trim();
      }

      currentState = {
        last_synthesized_at: Date.now(),
        last_activity_id: activityCounter,
        summary: summaryText,
        last_delta_count: deltaCount,
      };

      saveState(currentState);
      newActivitiesSinceSynthesis = 0;
      console.log(`[ACTIVITY_CONTEXT] Context synthesized (${deltaCount} events processed). Summary: "${summaryText.replace(/\n/g, ' ')}"`);
    }
  } catch (e) {
    console.warn('[ACTIVITY_CONTEXT] Gagal mensintesis konteks:', e.message);
  }

  return currentState.summary;
}

/**
 * Menghasilkan snippet konteks yang disuntikkan ke prompt Callista di src/ai.js.
 */
function buildPromptSnippet() {
  if (!currentState.summary) {
    return '';
  }

  return `
[KONTEKS SITUASI & AKTIVITAS SERVER TERKINI]:
(Ini ringkasan situasi obrolan lintas-channel dan aktivitas server saat ini. Callista sadar konteks ini untuk menjawab lebih nyambung dan tidak amnesia):
${currentState.summary}`;
}

function getState() {
  return {
    ...currentState,
    newActivitiesSinceSynthesis,
    bufferedActivitiesCount: activitiesBuffer.length,
  };
}

function getActivityHistory() {
  return [...activitiesBuffer];
}

function clearState() {
  activitiesBuffer.length = 0;
  activityCounter = 0;
  newActivitiesSinceSynthesis = 0;
  currentState = {
    last_synthesized_at: null,
    last_activity_id: 0,
    summary: '',
    last_delta_count: 0,
  };
  saveState(currentState);
}

/**
 * Jalankan interval berkala di background (default: setiap 5 menit).
 */
function startPeriodicSynthesizer(client, intervalMs = 5 * 60 * 1000) {
  if (periodicTimer) {
    clearInterval(periodicTimer);
  }

  periodicTimer = setInterval(async () => {
    try {
      if (shouldSynthesize(DEFAULT_DELTA_THRESHOLD)) {
        await synthesizeContext({ deltaThreshold: DEFAULT_DELTA_THRESHOLD });
      }
    } catch (_) {}
  }, intervalMs);

  if (periodicTimer.unref) {
    periodicTimer.unref();
  }
}

function stopPeriodicSynthesizer() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

module.exports = {
  recordActivity,
  shouldSynthesize,
  synthesizeContext,
  buildPromptSnippet,
  getState,
  getActivityHistory,
  clearState,
  startPeriodicSynthesizer,
  stopPeriodicSynthesizer,
  DEFAULT_DELTA_THRESHOLD,
};
