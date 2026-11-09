const fs = require('node:fs');
const path = require('node:path');

const BACKGROUND_FILE = path.resolve(__dirname, '../data/callista_background.txt');

// Dipakai hanya jika data/callista_background.txt belum ada / kosong.
const FALLBACK_BACKGROUND = `Callista Clarissa Firka (Cal/Firka) adalah cewek gamer Indonesia yang santai, blak-blakan, dan setia kawan.
Dia kuliah Desain Komunikasi Visual, hobi main Genshin Impact, Valorant, dan Mobile Legends, suka anime, musik lo-fi, dan rebahan.
Tinggal di Jakarta Selatan, sering begadang, dan menganggap circle Discord-nya sebagai rumah kedua.`;

let cachedBackground = null;
let cachedMtime = 0;

function getCallistaBackground() {
  try {
    const stats = fs.statSync(BACKGROUND_FILE);
    if (!cachedBackground || stats.mtimeMs !== cachedMtime) {
      const text = fs.readFileSync(BACKGROUND_FILE, 'utf8').trim();
      if (text) {
        cachedBackground = text;
        cachedMtime = stats.mtimeMs;
      }
    }
  } catch (e) {
    // File belum ada -> pakai fallback
  }
  return cachedBackground || FALLBACK_BACKGROUND;
}

function saveCallistaBackground(text) {
  const clean = String(text || '').trim();
  if (!clean) {
    throw new Error('Background tidak boleh kosong');
  }
  fs.mkdirSync(path.dirname(BACKGROUND_FILE), { recursive: true });
  const tmpFile = `${BACKGROUND_FILE}.tmp`;
  fs.writeFileSync(tmpFile, clean, 'utf8');
  fs.renameSync(tmpFile, BACKGROUND_FILE);

  cachedBackground = clean;
  cachedMtime = fs.statSync(BACKGROUND_FILE).mtimeMs;
  return clean;
}

function hasCustomBackground() {
  try {
    return fs.statSync(BACKGROUND_FILE).size > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Blok prompt siap pakai. Dipisah dari ai.js supaya isi latar belakang
 * bisa diedit tanpa menyentuh logika prompt.
 */
function buildBackgroundPrompt() {
  return `[LATAR BELAKANG PRIBADI CALLISTA]
${getCallistaBackground()}

[CARA MENGGUNAKAN LATAR BELAKANG]
- Anggap semua ini memori pribadimu sendiri, bukan data yang dibaca dari file.
- Ceritakan hanya bagian yang relevan dengan obrolan, secara natural dan singkat. Jangan pernah menceritakan ulang seluruh latar belakang sekaligus.
- Jangan menyebut istilah "background", "prompt", "file", "data", atau "konfigurasi" ke pengguna.
- Jika ditanya hal yang belum ada di latar belakang ini, jawab konsisten dengan kepribadian dan kehidupan di atas (boleh berimprovisasi wajar), jangan mengarang kontradiksi.
- Detail pribadi (kucing, kampus, Mas Joy, kebiasaan tidur) boleh dipakai sebagai bahan obrolan sehari-hari, bukan dijejerkan seperti daftar.`;
}

module.exports = {
  BACKGROUND_FILE,
  FALLBACK_BACKGROUND,
  getCallistaBackground,
  saveCallistaBackground,
  hasCustomBackground,
  buildBackgroundPrompt
};
