/**
 * Class Session Manager — Pengelola antrian pesan tertunda selama jam kelas Callista.
 *
 * Logika:
 * 1. Saat jam kelas aktif:
 *    - User pertama kali chat -> kirim 1 template deterministik (dari 30 template) per sesi.
 *    - Pesan ditampung ke antrian pending (maksimal 10 pesan terakhir per sesi).
 * 2. Saat jam kelas berakhir:
 *    - Mengevaluasi pesan pending dengan AI.
 *    - Jika hanya sapaan kosong ("p", "halo"), diabaikan (silent).
 *    - Jika ada hal penting/pertanyaan/obrolan menarik, kirim 1 balasan terpadu.
 * 3. Atomic save ke data/class_pending.json agar tidak hilang saat restart.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const collegeRoadmap = require('./collegeRoadmap');
const dailyStore = require('./dailyContextStore');
const naturalTyping = require('./naturalTyping');
const llm = require('./llm');

const PENDING_FILE = path.resolve(__dirname, '../data/class_pending.json');
const MAX_PENDING_PER_SESSION = 10;

// State in-memory
let pendingData = {
  sessions: {},       // sessionKey -> { classInfo, channelId, messages: [] }
  notifiedUsers: {},  // `${sessionKey}:${userId}` -> timestamp
};

function ensureDataDir() {
  const dir = path.dirname(PENDING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  ensureDataDir();
  try {
    if (fs.existsSync(PENDING_FILE)) {
      const raw = fs.readFileSync(PENDING_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        pendingData = {
          sessions: parsed.sessions || {},
          notifiedUsers: parsed.notifiedUsers || {},
        };
        return pendingData;
      }
    }
  } catch (err) {
    console.warn('[CLASS_MANAGER] Gagal membaca class_pending.json:', err.message);
  }
  return pendingData;
}

function saveState() {
  ensureDataDir();
  const tmpFile = `${PENDING_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(pendingData, null, 2), 'utf8');
    fs.renameSync(tmpFile, PENDING_FILE);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[CLASS_MANAGER] Gagal menyimpan class_pending.json:', err.message);
    return false;
  }
}

// Inisialisasi awal saat modul di-load
loadState();

/**
 * Cek apakah user sudah pernah diberi tahu template sibuk di sesi kelas ini.
 */
function hasBeenNotified(sessionKey, userId) {
  const key = `${sessionKey}:${userId}`;
  return Boolean(pendingData.notifiedUsers[key]);
}

/**
 * Tandai user sudah menerima template notifikasi untuk sesi kelas ini.
 */
function markNotified(sessionKey, userId) {
  const key = `${sessionKey}:${userId}`;
  pendingData.notifiedUsers[key] = Date.now();
  saveState();
}

/**
 * Masukkan pesan ke antrian sesi kelas (maksimal 10 pesan terakhir).
 */
function enqueueMessage(sessionKey, classInfo, msgData) {
  if (!pendingData.sessions[sessionKey]) {
    pendingData.sessions[sessionKey] = {
      classInfo,
      channelId: msgData.channelId,
      messages: [],
      createdAt: Date.now(),
    };
  }

  const s = pendingData.sessions[sessionKey];
  s.channelId = msgData.channelId; // update ke channel aktif terakhir
  s.messages.push({
    userId: msgData.userId,
    username: msgData.username,
    content: msgData.content,
    timestamp: msgData.timestamp || Date.now(),
  });

  // Jaga maksimal 10 pesan terakhir
  if (s.messages.length > MAX_PENDING_PER_SESSION) {
    s.messages = s.messages.slice(-MAX_PENDING_PER_SESSION);
  }

  saveState();
  return s.messages.length;
}

/**
 * Ambil daftar sesi yang sudah berakhir berdasarkan waktu sekarang.
 */
function getExpiredSessions(now = new Date(), timezone = 'Asia/Jakarta') {
  const { dateStr, timeStr } = dailyStore.getTimeInTimezone(now, timezone);
  const expired = [];

  for (const [sessionKey, sessionData] of Object.entries(pendingData.sessions)) {
    const info = sessionData.classInfo;
    if (!info) continue;

    // Jika sesi berasal dari tanggal sebelumnya ATAU hari ini tapi jam sudah >= end
    const isPastDate = info.dateStr && info.dateStr < dateStr;
    const isTodayPastTime = info.dateStr === dateStr && timeStr >= info.end;

    if (isPastDate || isTodayPastTime) {
      expired.push({ sessionKey, sessionData });
    }
  }

  return expired;
}

/**
 * Hapus sesi dan notifikasi lamanya dari memori & file.
 */
function removeSession(sessionKey) {
  delete pendingData.sessions[sessionKey];

  // Bersihkan juga notifiedUsers untuk sessionKey ini
  for (const key of Object.keys(pendingData.notifiedUsers)) {
    if (key.startsWith(`${sessionKey}:`)) {
      delete pendingData.notifiedUsers[key];
    }
  }

  saveState();
}

/**
 * Evaluasi batch pesan pasca-kelas via AI.
 * Memilih pesan yang pantas dibalas dan mengabaikan sapaan kosong.
 */
async function evaluatePendingBatch(messages, classInfo) {
  if (!messages || messages.length === 0) return null;

  const msgsFormatted = messages.map((m, idx) => {
    return `${idx + 1}. [${m.username}]: "${m.content}"`;
  }).join('\n');

  const systemPrompt = `Kamu adalah Callista Clarissa Firka, mahasiswi Desain Komunikasi Visual (DKV) semester 5.
Kamu baru saja selesai kelas kuliah: "${classInfo.courseName || 'Kuliah'}" di ${classInfo.location || 'kampus'}.
Saat berada di kelas tadi, kamu tidak bisa membuka HP dan sempat mengirim template singkat bahwa kamu lagi di kelas.
Sekarang kelas sudah selesai, dan kamu sedang mengecek HP untuk melihat pesan-pesan yang masuk selama kelas tadi (maksimal 10 pesan terakhir).

Pesan yang masuk:
${msgsFormatted}

Tugas Evaluasi & Balasan:
1. Jika semua pesan hanya sapaan kosong, spam 'p', 'halo', 'tes', atau obrolan yang sudah basi tanpa esensi, ABAIKAN dengan format JSON:
   {"shouldReply": false, "reason": "hanya sapaan kosong"}
2. Jika ada pertanyaan nyata, ajakan mabar/ngobrol seru, curhatan penting, atau pesan dari Mas Joy:
   - Buatkan 1 balasan terpadu yang ramah, natural, dan santai khas mahasiswi DKV yang baru beres kelas (misal: ceritakan sekilas baru selesai kelas apa, lalu tanggapi inti pesan mereka secara hangat).
   - Format JSON:
   {"shouldReply": true, "reply": "teks balasan Callista...", "reason": "alasan membalas"}

Balas HANYA dengan format JSON valid di atas tanpa teks pembuka atau markdown.`;

  try {
    const res = await llm.chatCompletion({
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.7,
      timeoutMs: 30000,
      maxTokens: 500,
    });

    if (!res || !res.content) return null;

    let text = res.content.trim();
    if (text.startsWith('```json')) text = text.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (text.startsWith('```')) text = text.replace(/^```/, '').replace(/```$/, '').trim();

    const parsed = JSON.parse(text);
    return parsed;
  } catch (err) {
    console.warn('[CLASS_MANAGER] Gagal evaluasi pending messages via AI:', err.message);
    return null;
  }
}

/**
 * Cek dan proses sesi-sesi kelas yang baru saja berakhir.
 * Dipanggil secara berkala (misal tiap 30-60 detik) dari loop bot.
 */
async function checkAndFlushSessions(client, timezone = 'Asia/Jakarta') {
  const expired = getExpiredSessions(new Date(), timezone);
  if (!expired.length) return 0;

  let processedCount = 0;

  for (const { sessionKey, sessionData } of expired) {
    const { classInfo, channelId, messages } = sessionData;

    try {
      if (messages && messages.length > 0 && client && channelId) {
        const channel = client.channels.cache.get(channelId);
        if (channel && typeof channel.send === 'function') {
          console.log(`[CLASS_MANAGER] Kelas "${classInfo.courseName}" selesai. Mengevaluasi ${messages.length} pesan pending...`);
          
          const decision = await evaluatePendingBatch(messages, classInfo);
          if (decision && decision.shouldReply && decision.reply) {
            const humanized = naturalTyping.humanizeTyping(decision.reply);
            await channel.send(humanized);
            console.log(`[CLASS_MANAGER] Balasan pasca-kelas terkirim ke #${channel.name || channelId}: "${humanized.slice(0, 80)}..."`);
          } else {
            console.log(`[CLASS_MANAGER] Pesan pending diabaikan (alasan: ${decision?.reason || 'tidak ada hal penting'}).`);
          }
        }
      }
    } catch (err) {
      console.error(`[CLASS_MANAGER] Gagal memproses sesi ${sessionKey}:`, err.message);
    } finally {
      // Hapus sesi agar tidak diproses berulang kali
      removeSession(sessionKey);
      processedCount++;
    }
  }

  return processedCount;
}

function getPendingSessions() {
  return pendingData.sessions || {};
}

module.exports = {
  loadState,
  saveState,
  hasBeenNotified,
  markNotified,
  enqueueMessage,
  getExpiredSessions,
  removeSession,
  evaluatePendingBatch,
  checkAndFlushSessions,
  getPendingSessions,
  MAX_PENDING_PER_SESSION,
  __test: {
    pendingData,
    PENDING_FILE,
  }
};
