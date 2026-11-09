/**
 * Today Memory — Memori Episodik Harian Callista (Layer 1).
 *
 * Mencatat peristiwa dan interaksi aktual yang dialami Callista hari ini
 * (chat penting, kejadian VC, mood, pujian Mas Joy) lengkap dengan slot waktu
 * (Pagi/Siang/Sore/Malam) agar Callista tidak amnesia dan memiliki kesadaran waktu.
 * Otomatis di-reset saat pergantian tanggal (Asia/Jakarta).
 */

const fs = require('node:fs');
const path = require('node:path');

const filePath = path.resolve(__dirname, '../data/today_memory.json');
const MAX_ENTRIES = 40;

function getTimeInfo(date = new Date(), timezone = 'Asia/Jakarta') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value || '2026';
    const m = parts.find(p => p.type === 'month')?.value || '11';
    const d = parts.find(p => p.type === 'day')?.value || '09';
    let h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    let min = parts.find(p => p.type === 'minute')?.value || '00';
    if (h === 24) h = 0;

    let slot = 'Malam';
    if (h >= 4 && h < 11) slot = 'Pagi';
    else if (h >= 11 && h < 15) slot = 'Siang';
    else if (h >= 15 && h < 18) slot = 'Sore';

    const timeStr = `${String(h).padStart(2, '0')}:${min.padStart(2, '0')}`;
    const dateStr = `${y}-${m}-${d}`;

    return { dateStr, timeStr, slot };
  } catch (e) {
    const iso = date.toISOString();
    return {
      dateStr: iso.slice(0, 10),
      timeStr: iso.slice(11, 16),
      slot: 'Hari ini',
    };
  }
}

function loadTodayMemory() {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data === 'object') {
        return {
          date: data.date || '',
          entries: Array.isArray(data.entries) ? data.entries : [],
        };
      }
    }
  } catch (e) {
    console.warn('[TODAY_MEMORY] Gagal membaca today_memory.json:', e.message);
  }
  return { date: '', entries: [] };
}

function saveTodayMemory(data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[TODAY_MEMORY] Gagal menyimpan today_memory.json:', e.message);
  }
}

function addTodayEntry(text, options = {}) {
  if (!text || typeof text !== 'string') return;
  const timezone = options.timezone || 'Asia/Jakarta';
  const { dateStr, timeStr, slot } = getTimeInfo(options.date || new Date(), timezone);

  const data = loadTodayMemory();

  // Reset otomatis jika sudah berganti tanggal
  if (data.date !== dateStr) {
    data.date = dateStr;
    data.entries = [];
  }

  // Bersihkan teks & batasi panjang agar hemat token (maks 130 char per entry)
  let cleanText = text.replace(/\s+/g, ' ').trim();
  if (cleanText.length > 130) {
    cleanText = `${cleanText.slice(0, 127)}...`;
  }

  data.entries.push({
    time: timeStr,
    slot,
    text: cleanText,
  });

  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }

  saveTodayMemory(data);
}

function getTodayEntries(timezone = 'Asia/Jakarta') {
  const { dateStr } = getTimeInfo(new Date(), timezone);
  const data = loadTodayMemory();
  if (data.date !== dateStr) {
    return [];
  }
  return data.entries;
}

function clearTodayMemory() {
  saveTodayMemory({ date: '', entries: [] });
}

function buildTodayMemoryPromptSnippet(timezone = 'Asia/Jakarta') {
  const { dateStr } = getTimeInfo(new Date(), timezone);
  const entries = getTodayEntries(timezone);

  if (entries.length === 0) return '';

  const lines = entries.map(e => `- [${e.time} ${e.slot}]: ${e.text}`);

  return `
[INGATAN PERCAKAPAN & KEJADIAN HARI INI (${dateStr})]:
(Ini adalah catatan kejadian/obrolan nyata yang dialami Callista hari ini. Gunakan untuk menyambung topik dan memahami waktu: pagi vs siang vs sore vs malam agar tidak amnesia!)
${lines.join('\n')}`;
}

module.exports = {
  getTimeInfo,
  loadTodayMemory,
  saveTodayMemory,
  addTodayEntry,
  getTodayEntries,
  clearTodayMemory,
  buildTodayMemoryPromptSnippet,
};
