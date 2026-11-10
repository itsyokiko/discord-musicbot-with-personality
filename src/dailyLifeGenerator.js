const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const storage = require('./storage');
const store = require('./dailyContextStore');
const collegeRoadmap = require('./collegeRoadmap');
const llm = require('./llm');

function getDayOfWeek(dateStr) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const d = new Date(dateStr);
  return days[d.getDay()] || 'Hari ini';
}

async function requestChat(messages) {
  const result = await llm.chatCompletion({
    messages,
    temperature: 0.8,
    timeoutMs: 45000,
    maxTokens: 2000
  });

  if (!result) return null;

  llm.logUsage('DAILY GENERATOR', result.usage);
  return result.content;
}

function parseGeneratedJSON(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
  }

  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s !== -1 && e !== -1) {
    try {
      return JSON.parse(cleaned.slice(s, e + 1));
    } catch (err) {}
  }
  return null;
}

async function generateDailyContext(targetDate = new Date()) {
  const config = storage.getConfig();
  const timezone = config.timezone || 'Asia/Jakarta';
  const { dateStr } = store.getTimeInTimezone(targetDate, timezone);
  const dayName = getDayOfWeek(dateStr);

  console.log(`[DAILY GENERATOR] Generating 24h daily context for ${dayName}, ${dateStr} (${timezone})...`);

  const todayClasses = collegeRoadmap.getClassesForDate(dateStr);
  const activeAssignments = collegeRoadmap.getActiveAssignments(dateStr);

  let academicPromptBlock = '';
  if (todayClasses.length > 0) {
    academicPromptBlock += `\n[ACUAN MUTLAK - JADWAL KULIAH HARI INI]:\n`;
    todayClasses.forEach(c => {
      academicPromptBlock += `- Jam ${c.start} - ${c.end}: Kuliah/Praktikum ${c.courseName} (${c.courseId}) di ${c.location} bareng ${c.lecturer}. Wajib masuk schedule dengan availability="busy" dan reply_tendency="delayed".\n`;
    });
  } else {
    academicPromptBlock += `\n[HARI INI TIDAK ADA KELAS KULIAH TATAP MUKA DI KAMPUS]\n`;
  }

  if (activeAssignments.length > 0) {
    academicPromptBlock += `\n[TUGAS/PR DKV AKTIF YANG SEDANG BERJALAN]:\n`;
    activeAssignments.slice(0, 5).forEach(a => {
      academicPromptBlock += `- [${a.priority.toUpperCase()}] ${a.title} (${a.courseName}) - Deadline: ${a.dueDate} (Status: ${a.status}, progress: ${a.progress}%)\n`;
    });
  }

  const systemPrompt = `Kamu adalah arsitek simulasi kehidupan harian untuk karakter fiksi bernama "Callista" (alias: Firka).
Karakter: Mahasiswi Desain Komunikasi Visual (DKV) Semester 5 di universitas. Selain kuliah, dia juga gamer santai, suka dengar musik, rebahan, dan nongkrong di Discord.
${academicPromptBlock}
Tugas: Buat rencana jadwal 24 jam (00:00 hingga 23:59) untuk tanggal ${dateStr} (${dayName}).
PANDUAN UTAMA:
1. JADWAL KULIAH DI ATAS ADALAH ACUAN MUTLAK: Seluruh jam kuliah hari ini HARUS muncul di jadwal (schedule) pada rentang jam yang tepat, dengan nama matkul dan lokasi studio/lab.
2. TUGAS / PR DKV: Masukkan agenda pengerjaan tugas DKV di atas ke dalam field "plans" dan alokasikan waktu nugas/proyek di luar jam kuliah.
3. WAKTU TIDUR & BANGUN: Jika ada kelas pagi jam 08:00, waktu bangun (wake_time) harus antara 06:15 - 07:00 (bukan jam 09:30).
4. Sisa waktu di luar jam kuliah dan nugas bisa dialokasikan untuk makan, istirahat, mabar game (Genshin, Valo), santai dengerin musik, atau nongkrong di Discord.

Aturan JSON:
Balas HANYA dengan format JSON valid berikut (tanpa markdown atau teks pembuka):
{
  "version": "1.0.0",
  "date": "${dateStr}",
  "timezone": "${timezone}",
  "status": "ok",
  "mood": 62,
  "mood_state": "Biasa / Netral",
  "sleep_schedule": {
    "sleep_time": "01:30",
    "wake_time": "${todayClasses.some(c => c.start <= '08:30') ? '06:45' : '09:00'}"
  },
  "schedule": [
    { "start_time": "00:00", "end_time": "01:30", "activity": "Main game santai di kasur", "availability": "relaxing", "reply_tendency": "casual" },
    { "start_time": "01:30", "end_time": "${todayClasses.some(c => c.start <= '08:30') ? '06:45' : '09:00'}", "activity": "Tidur lelap di kamar", "availability": "sleeping", "reply_tendency": "unlikely" },
    { "start_time": "${todayClasses.some(c => c.start <= '08:30') ? '06:45' : '09:00'}", "end_time": "12:00", "activity": "Aktivitas pagi / kuliah kampus", "availability": "active", "reply_tendency": "responsive" },
    { "start_time": "12:00", "end_time": "15:30", "activity": "Makan siang / kuliah lanjutan / studio", "availability": "busy", "reply_tendency": "delayed" },
    { "start_time": "15:30", "end_time": "18:00", "activity": "Pulang kampus / nugas santai / mabar", "availability": "active", "reply_tendency": "casual" },
    { "start_time": "18:00", "end_time": "20:00", "activity": "Mandi, makan malam & istirahat", "availability": "away", "reply_tendency": "delayed" },
    { "start_time": "20:00", "end_time": "23:59", "activity": "Online di Discord, nugas DKV, dengerin musik", "availability": "active", "reply_tendency": "responsive" }
  ],
  "plans": [
    "Kuliah tepat waktu",
    "Lanjutin PR tugas DKV",
    "Santai malam di Discord"
  ],
  "daily_events": [
    "Hari kuliah DKV kampus"
  ]
}

Ketentuan:
- availability hanya boleh: "sleeping", "busy", "active", "relaxing", "away".
- reply_tendency hanya boleh: "unlikely", "delayed", "casual", "responsive".
- Sesi kuliah di kelas WAJIB menggunakan availability: "busy" dan reply_tendency: "delayed".
- mood hanya boleh angka 0-100 (fase hari ini). mood_state wajib label singkat fase (mis. "Biasa / Netral", "Mager / Santai Lebih Lama", "Ceria / Antusias", "Stres Tugas").
- schedule harus mencakup keseluruhan 24 jam dari 00:00 sampai 23:59 tanpa celah waktu kosong.
- Variasikan fase mood harian konsisten dengan jadwal hari tersebut.`;

  const userPrompt = `Buatkan jadwal kehidupan harian Callista untuk hari ${dayName}, ${dateStr}. Pastikan jadwal kuliah riil dan tugas DKV aktif terintegrasi dengan tepat ke dalam 24 jam.`;

  const raw = await requestChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  const parsed = parseGeneratedJSON(raw);
  if (parsed && store.validateContextSchema(parsed)) {
    parsed.updated_at = new Date().toISOString();
    parsed.date = dateStr;
    parsed.timezone = timezone;
    parsed.status = 'ok';
    store.saveDailyContext(parsed);
    console.log(`[DAILY GENERATOR] Successfully generated and saved daily context for ${dateStr}!`);
    return parsed;
  }

  console.warn(`[DAILY GENERATOR] AI response invalid or failed. Falling back to existing/default context.`);
  if (fs.existsSync(store.DAILY_CONTEXT_FILE)) {
    const existing = store.loadDailyContext(timezone);
    if (existing && existing.date === dateStr) {
      return existing;
    }
  }

  const fallback = store.getFallbackDailyContext(targetDate, timezone);
  fallback.updated_at = new Date().toISOString();
  fallback.status = 'fallback';
  store.saveDailyContext(fallback);
  console.log(`[DAILY GENERATOR] Saved reliable fallback daily context for ${dateStr}.`);
  return fallback;
}

function getMsUntilNextMidnight(timezone = 'Asia/Jakarta') {
  const now = new Date();
  const { dateStr } = store.getTimeInTimezone(now, timezone);

  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);

  const nextDay = new Date(Date.UTC(y, m, d + 1, 0, 0, 5));
  let diff = nextDay.getTime() - now.getTime();
  if (diff <= 0) diff = 86400000;
  return diff;
}

async function runGenerator() {
  if (!store.acquireLock()) {
    console.warn(`[DAILY GENERATOR] Another generator process is currently active or lock is held. Exiting.`);
    return;
  }

  try {
    const config = storage.getConfig();
    const timezone = config.timezone || 'Asia/Jakarta';
    const now = new Date();
    const { dateStr } = store.getTimeInTimezone(now, timezone);

    const currentContext = store.loadDailyContext(timezone);
    if (!currentContext || currentContext.date !== dateStr || currentContext.status === 'fallback') {
      await generateDailyContext(now);
    } else {
      console.log(`[DAILY GENERATOR] Context for ${dateStr} is already up to date.`);
    }
  } finally {
    store.releaseLock();
  }
}

function startDaemon() {
  console.log(`[DAILY GENERATOR] Daemon process started. Monitoring schedule at 00:00 (${storage.getConfig().timezone || 'Asia/Jakarta'}).`);

  runGenerator().catch(err => console.error('[DAILY GENERATOR] Startup error:', err.message));

  function scheduleNext() {
    const config = storage.getConfig();
    const timezone = config.timezone || 'Asia/Jakarta';
    const msUntilMidnight = getMsUntilNextMidnight(timezone);
    const hours = (msUntilMidnight / 3600000).toFixed(1);
    console.log(`[DAILY GENERATOR] Next run scheduled at 00:00:05 WIB (in ${hours} hours).`);

    setTimeout(async () => {
      try {
        await runGenerator();
      } catch (err) {
        console.error('[DAILY GENERATOR] Scheduled run error:', err.message);
      }
      scheduleNext();
    }, msUntilMidnight);
  }

  scheduleNext();
}

if (require.main === module) {
  const isOnce = process.argv.includes('--once');
  if (isOnce) {
    runGenerator()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('[DAILY GENERATOR] Error:', err.message);
        process.exit(1);
      });
  } else {
    startDaemon();
  }
}

module.exports = {
  generateDailyContext,
  runGenerator,
  startDaemon
};
