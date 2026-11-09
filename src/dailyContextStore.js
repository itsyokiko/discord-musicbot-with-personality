const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.resolve(__dirname, '../data');
const DAILY_CONTEXT_FILE = path.join(DATA_DIR, 'daily_context.json');
const LOCK_FILE = path.join(DATA_DIR, '.generator.lock');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getTimeInTimezone(date = new Date(), timezone = 'Asia/Jakarta') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value || '2026';
    const m = parts.find(p => p.type === 'month')?.value || '10';
    const d = parts.find(p => p.type === 'day')?.value || '19';
    let h = parts.find(p => p.type === 'hour')?.value || '00';
    let min = parts.find(p => p.type === 'minute')?.value || '00';
    if (h === '24') h = '00';

    return {
      dateStr: `${y}-${m}-${d}`,
      timeStr: `${h.padStart(2, '0')}:${min.padStart(2, '0')}`,
      hours: parseInt(h, 10),
      minutes: parseInt(min, 10)
    };
  } catch (e) {
    const iso = date.toISOString();
    return {
      dateStr: iso.slice(0, 10),
      timeStr: iso.slice(11, 16),
      hours: date.getUTCHours(),
      minutes: date.getUTCMinutes()
    };
  }
}

function getFallbackDailyContext(date = new Date(), timezone = 'Asia/Jakarta') {
  const { dateStr } = getTimeInTimezone(date, timezone);
  return {
    version: '1.0.0',
    date: dateStr,
    timezone,
    updated_at: new Date().toISOString(),
    status: 'fallback',
    sleep_schedule: {
      sleep_time: '02:00',
      wake_time: '09:30'
    },
    schedule: [
      { start_time: '00:00', end_time: '02:00', activity: 'Main game santai di kasur & scroll sosmed', availability: 'relaxing', reply_tendency: 'casual' },
      { start_time: '02:00', end_time: '09:30', activity: 'Tidur lelap di kamar', availability: 'sleeping', reply_tendency: 'unlikely' },
      { start_time: '09:30', end_time: '11:00', activity: 'Bangun, sarapan, & nonton YouTube santai', availability: 'active', reply_tendency: 'responsive' },
      { start_time: '11:00', end_time: '13:00', activity: 'Mabar santai Genshin / nugas ringan', availability: 'active', reply_tendency: 'casual' },
      { start_time: '13:00', end_time: '14:30', activity: 'Makan siang & rebahan santai', availability: 'relaxing', reply_tendency: 'responsive' },
      { start_time: '14:30', end_time: '17:00', activity: 'Push rank Valorant bareng circle Discord', availability: 'busy', reply_tendency: 'delayed' },
      { start_time: '17:00', end_time: '19:00', activity: 'Mandi, bantu rumah, & santai sore', availability: 'away', reply_tendency: 'delayed' },
      { start_time: '19:00', end_time: '21:30', activity: 'Online di Discord, dengerin musik di kamar', availability: 'active', reply_tendency: 'responsive' },
      { start_time: '21:30', end_time: '23:59', activity: 'Mabar malam atau nobar santai bareng teman', availability: 'active', reply_tendency: 'responsive' }
    ],
    plans: [
      'Selesaikan daily quest game siang nanti',
      'Push rank bareng circle sore nanti',
      'Santai online di Discord malam'
    ],
    daily_events: [
      'Bangun pagi terasa segar, siap santai seharian'
    ],
    mood: 60,
    mood_state: 'Biasa / Netral'
  };
}

function validateContextSchema(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.date !== 'string') return false;
  if (!Array.isArray(obj.schedule) || obj.schedule.length === 0) return false;
  if (!obj.sleep_schedule || typeof obj.sleep_schedule !== 'object') return false;
  // mood harian bersifat opsional (0-100); kalau ada, harus valid.
  if (obj.mood !== undefined && (typeof obj.mood !== 'number' || obj.mood < 0 || obj.mood > 100)) {
    return false;
  }
  return true;
}

function loadDailyContext(timezone = 'Asia/Jakarta') {
  ensureDataDir();
  try {
    if (fs.existsSync(DAILY_CONTEXT_FILE)) {
      const raw = fs.readFileSync(DAILY_CONTEXT_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (validateContextSchema(parsed)) {
        return parsed;
      }
    }
  } catch (err) {}
  return getFallbackDailyContext(new Date(), timezone);
}

function saveDailyContext(context) {
  ensureDataDir();
  const tmpFile = `${DAILY_CONTEXT_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(context, null, 2), 'utf8');
    fs.renameSync(tmpFile, DAILY_CONTEXT_FILE);
    return true;
  } catch (err) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (e) {}
    return false;
  }
}

function acquireLock(maxAgeMs = 120000) {
  ensureDataDir();
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stats = fs.statSync(LOCK_FILE);
      const isStale = (Date.now() - stats.mtimeMs) > maxAgeMs;
      if (isStale) {
        fs.unlinkSync(LOCK_FILE);
      } else {
        return false;
      }
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: Date.now() }), { flag: 'wx' });
    return true;
  } catch (e) {
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (e) {}
}

function getCurrentActivityInfo(context, now = new Date()) {
  const tz = context?.timezone || 'Asia/Jakarta';
  const { dateStr, timeStr } = getTimeInTimezone(now, tz);
  const isExpired = context?.date !== dateStr;

  const schedule = context?.schedule || [];
  let currentItem = null;
  let nextItem = null;

  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    const { start_time, end_time } = item;

    let isMatch = false;
    if (start_time <= end_time) {
      isMatch = timeStr >= start_time && timeStr < end_time;
    } else {
      isMatch = timeStr >= start_time || timeStr < end_time;
    }

    if (isMatch) {
      currentItem = item;
      nextItem = schedule[(i + 1) % schedule.length];
      break;
    }
  }

  if (!currentItem) {
    currentItem = {
      activity: 'Santai di kamar',
      availability: 'active',
      reply_tendency: 'casual'
    };
  }

  const isSleeping = currentItem.availability === 'sleeping';

  // Fase mood otomatis dari konteks harian (dikeluarkan AI per hari).
  const moodScore = Number.isFinite(Number(context?.mood)) ? Math.max(0, Math.min(100, Math.round(Number(context.mood)))) : 60;
  const moodState = context?.mood_state || 'Biasa / Netral';

  return {
    date: dateStr,
    time: timeStr,
    current_activity: currentItem.activity,
    availability: currentItem.availability || 'active',
    reply_tendency: currentItem.reply_tendency || 'casual',
    upcoming_plan: nextItem ? nextItem.activity : (context?.plans?.[0] || 'Santai di Discord'),
    mood: moodScore,
    mood_state: moodState,
    is_sleeping: isSleeping,
    is_expired: isExpired,
    status: isExpired ? 'expired' : (context?.status || 'ok')
  };
}

function getBriefContextForPrompt(now = new Date(), timezone = 'Asia/Jakarta') {
  const context = loadDailyContext(timezone);
  const info = getCurrentActivityInfo(context, now);

  let sleepNote = '';
  if (info.is_sleeping) {
    sleepNote = ' (Saat ini adalah waktu tidur Callista. Nada bicara agak mengantuk/ogah-ogahan jika bangun, namun tetap ramah/manja jika Mas Joy yang menyapa).';
  }

  const moodNote = ` - Fase mood hari ini: ${info.mood}/100 (${info.mood_state})`;

  return `Kondisi Harian Callista (Waktu ${info.time} WIB, ${info.date}):
- Aktivitas saat ini: ${info.current_activity}${sleepNote}
- Ketersediaan: ${info.availability} (Kecenderungan balas: ${info.reply_tendency})
- Rencana nanti: ${info.upcoming_plan}
${moodNote}
- Catatan mood: ${info.mood < 45 ? 'Fase ini rendah/mager — Callista boleh lebih cuek, malas, atau DRY_TEXT ke Mas Joy.' : info.mood > 75 ? 'Fase ini tinggi/ceria — Callista boleh lebih manja, antusias, dan eksplisit bercanda.' : 'Fase ini netral/biasa — tetap santai ala Callista.'}`;
}

module.exports = {
  DAILY_CONTEXT_FILE,
  LOCK_FILE,
  getTimeInTimezone,
  getFallbackDailyContext,
  validateContextSchema,
  loadDailyContext,
  saveDailyContext,
  acquireLock,
  releaseLock,
  getCurrentActivityInfo,
  getBriefContextForPrompt
};
