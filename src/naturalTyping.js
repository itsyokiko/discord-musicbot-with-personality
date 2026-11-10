/**
 * Natural Discord Typing Simulator
 * - Menyingkat kata-kata umum secara kasual (lg, bgt, dah, ga, bntr, dll)
 * - Mensimulasikan typo alami berbasis tetangga tombol keyboard QWERTY (misal: "iyq", "wlwl", "nys")
 * - Membatasi panjang pesan agar santai dan tidak bertele-tele
 */

const QWERTY_NEIGHBORS = {
  a: ['q', 'w', 's', 'z'],
  b: ['v', 'g', 'h', 'n'],
  c: ['x', 'd', 'f', 'v'],
  d: ['s', 'e', 'r', 'f', 'x', 'c'],
  e: ['w', 'r', 's', 'd'],
  f: ['d', 'r', 't', 'g', 'c', 'v'],
  g: ['f', 't', 'y', 'h', 'v', 'b'],
  h: ['g', 'y', 'u', 'j', 'b', 'n'],
  i: ['u', 'o', 'j', 'k'],
  j: ['h', 'u', 'i', 'k', 'n', 'm'],
  k: ['j', 'i', 'o', 'l', 'm'],
  l: ['k', 'o', 'p'],
  m: ['n', 'j', 'k'],
  n: ['b', 'h', 'j', 'm'],
  o: ['i', 'p', 'k', 'l'],
  p: ['o', 'l'],
  q: ['w', 'a'],
  r: ['e', 't', 'd', 'f'],
  s: ['a', 'w', 'e', 'd', 'z', 'x'],
  t: ['r', 'y', 'f', 'g'],
  u: ['y', 'i', 'h', 'j'],
  v: ['c', 'f', 'g', 'b'],
  w: ['q', 'e', 'a', 's'],
  x: ['z', 's', 'd', 'c'],
  y: ['t', 'u', 'g', 'h'],
  z: ['a', 's', 'x']
};

const COMMON_ABBREVIATIONS = {
  lagi: ['lg'],
  udah: ['dah', 'udh'],
  sudah: ['dah', 'udh'],
  banget: ['bgt'],
  bisa: ['bs'],
  dengan: ['dgn'],
  kenapa: ['knp'],
  gimana: ['gmn'],
  tapi: ['tp'],
  kalo: ['klo', 'kl'],
  kalau: ['klo', 'kl'],
  sebentar: ['bentar', 'bntr'],
  bukan: ['bkn'],
  terus: ['trs'],
  jangan: ['jgn'],
  sekarang: ['skrg'],
  kemarin: ['kmrn', 'kemaen'],
  kemaren: ['kemaen', 'kmrn'],
  tolong: ['tlg'],
  sedang: ['sdg'],
  mungkin: ['mgkn'],
  enggak: ['ga', 'ngga'],
  nggak: ['ga', 'ngga'],
  ngga: ['ga'],
  tidak: ['ga'],
  sampai: ['sampe'],
  hanya: ['cuma'],
  belum: ['blm']
};

const PROTECTED_WORDS = new Set([
  'mas', 'joy', 'rieka', 'callista', 'firka', 'cal', 'daddy', 'ayah',
  'genshin', 'valorant', 'discord', 'dkv', 'mochi', 'http', 'https'
]);

/**
 * Singkat kata-kata umum secara natural
 */
function abbreviateWords(text, chance = 0.65) {
  if (!text) return text;

  // Split by whitespace keeping delimiters
  const tokens = text.split(/(\s+|[.,!?~()]+)/);

  const processed = tokens.map(token => {
    const lower = token.toLowerCase();
    if (COMMON_ABBREVIATIONS[lower]) {
      if (Math.random() < chance) {
        const variants = COMMON_ABBREVIATIONS[lower];
        const chosen = variants[Math.floor(Math.random() * variants.length)];
        // Preserve capital first letter if original had it
        if (token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase()) {
          return chosen.charAt(0).toUpperCase() + chosen.slice(1);
        }
        return chosen;
      }
    }
    return token;
  });

  return processed.join('');
}

/**
 * Menyuntikkan 1 typo keyboard alami berdasarkan tetangga tombol QWERTY
 * Contoh: "iya" -> "iyq", "wkwk" -> "wlwl", "nya" -> "nys"
 */
function injectKeyboardTypo(text, chance = 0.22) {
  if (!text || Math.random() > chance) return text;

  // Temukan kandidat kata yang layak kena typo (hanya huruf, panjang 3-7)
  const words = text.split(/(\s+)/);
  const candidateIndices = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i].trim();
    if (w.length >= 3 && w.length <= 8 && /^[a-zA-Z]+$/.test(w)) {
      if (!PROTECTED_WORDS.has(w.toLowerCase())) {
        candidateIndices.push(i);
      }
    }
  }

  if (candidateIndices.length === 0) return text;

  // Pilih 1 kata secara acak untuk diselipkan typo
  const targetIdx = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
  const word = words[targetIdx];

  // Khusus kata-kata khas yang diminta:
  // "iya" -> "iyq" (karena a dan q sebelahan di keyboard)
  if (word.toLowerCase() === 'iya') {
    words[targetIdx] = word[0] === 'I' ? 'Iyq' : 'iyq';
    return words.join('');
  }
  // "wkwk" -> "wlwl" (karena k dan l sebelahan di keyboard)
  if (word.toLowerCase() === 'wkwk') {
    words[targetIdx] = 'wlwl';
    return words.join('');
  }
  // "nya" -> "nys" (karena a dan s sebelahan di keyboard)
  if (word.toLowerCase() === 'nya') {
    words[targetIdx] = 'nys';
    return words.join('');
  }

  // Pilih salah satu karakter di dalam kata (utamakan tengah/akhir)
  const charIdx = Math.floor(Math.random() * (word.length - 1)) + 1;
  const originalChar = word[charIdx];
  const lowerChar = originalChar.toLowerCase();
  const neighbors = QWERTY_NEIGHBORS[lowerChar];

  if (!neighbors || neighbors.length === 0) return text;

  const typoNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
  const replacement = originalChar === originalChar.toUpperCase()
    ? typoNeighbor.toUpperCase()
    : typoNeighbor;

  words[targetIdx] = word.slice(0, charIdx) + replacement + word.slice(charIdx + 1);
  return words.join('');
}

/**
 * Pipeline penuh untuk memanusiakan gaya ketik:
 * 1. Menyingkat kata-kata umum (tidak 100% utuh di tiap kalimat)
 * 2. Sesekali ada typo QWERTY tetangga tombol alami
 */
function humanizeTyping(text, options = {}) {
  if (!text || typeof text !== 'string') return text;

  const abbrevChance = options.abbrevChance ?? 0.60;
  const typoChance = options.typoChance ?? 0.20;

  // 1. Singkat kata umum
  let result = abbreviateWords(text, abbrevChance);

  // 2. Suntikkan typo alami (maksimal 1 typo per pesan)
  result = injectKeyboardTypo(result, typoChance);

  // 3. Jika mood sedang rendah/sensi (< 45), hilangkan tawa ceria wkwk/haha
  if (options.noWkwk || (typeof options.mood === 'number' && options.mood < 45)) {
    result = result.replace(/\b(w+k+w+k+|w+l+w+l+|ha+ha+|he+he+|xi+xi+)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

  return result;
}

module.exports = {
  QWERTY_NEIGHBORS,
  COMMON_ABBREVIATIONS,
  abbreviateWords,
  injectKeyboardTypo,
  humanizeTyping
};
