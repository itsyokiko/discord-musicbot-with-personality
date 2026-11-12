/**
 * Parser perintah musik deterministik (tanpa AI).
 *
 * Dua jalur:
 * - Prefix ">"  → selalu diproses. Contoh: ">skip", ">stop", ">play one ok rock".
 * - Natural     → hanya perintah kontrol, dan hanya kalau dipanggil namanya,
 *                 reply ke Callista, atau ada queue aktif. Contoh: "cal, skip lagu ini".
 *
 * File ini sengaja pure (tanpa Discord/DisTube) supaya bisa dites langsung.
 */

const ALIASES = {
  skip: ['skip', 'next', 'lewatin', 'lewati'],
  stop: ['stop', 'berhenti', 'setop', 'matiin', 'matikan'],
  pause: ['pause', 'paus', 'jeda'],
  resume: ['resume', 'unpause', 'lanjut', 'lanjutin'],
  queue: ['queue', 'q', 'antrian', 'antrean'],
  shuffle: ['shuffle', 'acak'],
  np: ['np', 'nowplaying', 'now'],
  join: ['join', 'masuk', 'joinvc', 'masukvc'],
  leave: ['leave', 'keluar', 'cabut', 'exit'],
  play: ['play', 'putar', 'puter', 'mainin'],
  move: ['moveto', 'pindah', 'pindahke'],
  playlist: ['playlist', 'pl'],
  help: ['help', 'bantuan', 'commands', 'cmd'],
  loop: ['loop', 'ulang', 'repeat'],
  unloop: ['unloop', 'stoploop', 'noloop'],
  sfx: ['sfx'],
  lyrics: ['lyrics', 'lyric', 'lirik'],
};

const BY_ALIAS = Object.fromEntries(
  Object.entries(ALIASES).flatMap(([command, aliases]) => aliases.map(a => [a, command]))
);

// Singkatan pendek HANYA untuk mode prefix (">p lagu"), supaya chat natural
// seperti "cal, l" tidak tiba-tiba dianggap perintah.
const SHORT_ALIASES = {
  // play / putar
  p: 'play',
  pl: 'play',
  put: 'play',

  // kontrol playback
  sk: 'skip',
  n: 'skip',           // next
  nxt: 'skip',
  st: 'stop',
  pa: 'pause',
  pu: 'pause',
  rs: 'resume',
  re: 'resume',
  co: 'resume',        // continue

  // loop
  l: 'loop',
  lp: 'loop',
  ul: 'unloop',
  nol: 'unloop',       // no loop

  // shuffle / acak
  sh: 'shuffle',
  ac: 'shuffle',       // acak

  // queue / antrian
  q: 'queue',
  qu: 'queue',
  ant: 'queue',

  // now playing
  np: 'np',
  now: 'np',

  // join / leave
  j: 'join',
  lv: 'leave',
  cl: 'leave',         // close / keluar

  // help
  h: 'help',
  '?': 'help',

  // player refresh
  plr: 'player',
  player: 'player',

  // sfx (audio lokal)
  sfx: 'sfx',

  // lirik lagu
  lr: 'lyrics',
  lirik: 'lyrics',
  lyrics: 'lyrics',

  // jump (sudah di-tambah di langkah sebelumnya)
  jp: 'jump',
  skp: 'jump',         // skip to position
};

// Perintah yang boleh dipakai tanpa prefix ">" (natural language).
const CONTROL = new Set(['skip', 'stop', 'pause', 'resume', 'queue', 'shuffle', 'np', 'join', 'leave', 'help', 'loop', 'unloop', 'player', 'sfx', 'lyrics']);

// Kata-kata yang boleh muncul setelah perintah kontrol tanpa mengubah arti.
const FILLERS = new Set([
  'lagu', 'lagunya', 'ini', 'itu', 'musik', 'musiknya', 'music', 'song', 'nya',
  'dong', 'deh', 'ya', 'yah', 'nih', 'sih', 'wkwk', 'aja', 'saja', 'pls', 'please',
  'tolong', 'banget', 'bgt', 'sekarang', 'skrg', 'lagi', 'yang', 'diputer', 'diputar',
  'antrian', 'antrean', 'queue', 'playing', 'dulu', 'gitu', 'lah', 'kok', 'deh',
  'bentar', 'sebentar', 'yak', 'yuk', 'gas',
]);

const NAME_RE = /^(?:cal|callista|calista|firka|cay|sayang)\b[\s,.:!-]*/i;
const LEAD_RE = /^(?:tolong|please|pls|nih|eh|woy|woi|coba)\s+/i;

// "Play tanpa konteks": kata-kata yang kalau jadi satu-satunya argumen
// berarti user mau diputarin apa aja dari playlist tersimpan (acak).
const PLAY_NO_CONTEXT = new Set([
  'musik', 'music', 'lagu', 'lagunya', 'song', 'playlist', 'sesuatu',
  'bebas', 'apapun', 'random', 'apa', 'aja', 'saja',
]);
// Kata sambung gaya "puter musik dan di shuffle" — bukan judul.
const PLAY_CONNECTORS = new Set(['dan', 'sambil', 'lalu', 'abis', 'terus', 'trus', 'sekalian', 'juga', 'jg']);
const SHUFFLE_RE = /\b(?:di\s+)?(?:shuffle|shufle|shufel|acak|acak2|acakk|teracak|random)\b/i;

/**
 * Deteksi perintah play TANPA konteks: ">play", "cal, puter musik",
 * "cal, putar musik dong", "cal, mainin musik dan di shuffle".
 * Bila bare, Callista memutar playlist tersimpan secara acak (opsional + shuffle).
 * Bila ada judul nyata ("puter lagu renegades"), return bare=false → tetap lewat AI.
 */
function parseBarePlayRequest(args) {
  let text = String(args || '').toLowerCase().trim();
  const shuffle = SHUFFLE_RE.test(text);
  text = text.replace(SHUFFLE_RE, ' ');
  const words = text.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (PLAY_NO_CONTEXT.has(w) || PLAY_CONNECTORS.has(w) || FILLERS.has(w)) continue;
    return { bare: false, shuffle };
  }
  return { bare: true, shuffle };
}

const CONTROL_FORMATS = {
  skip: 'SKIP_SONG',
  stop: 'STOP_MUSIC',
  pause: 'PAUSE_MUSIC',
  resume: 'RESUME_MUSIC',
  queue: 'QUEUE_LIST',
  shuffle: 'SHUFFLE_MUSIC',
  loop: 'LOOP_SONG',
  unloop: 'UNLOOP_SONG',
};

function clean(content) {
  return String(content || '').replace(/<@!?\d+>/g, ' ').trim();
}

/**
 * @returns {{command: string, args: string, source: 'prefix'|'natural'}|null}
 */
function parseDirectCommand(content, {
  isMentioned = false,
  isReplyToCallista = false,
  hasQueue = false,
} = {}) {
  let text = clean(content);
  if (!text) return null;

  const prefixMode = text.startsWith('>');
  let addressed = prefixMode || isMentioned || isReplyToCallista;

  if (prefixMode) {
    text = text.slice(1).trim();
  } else {
    const name = text.match(NAME_RE);
    if (name) {
      addressed = true;
      text = text.slice(name[0].length).trim();
    }
  }

  text = text.replace(LEAD_RE, '').replace(/[\s.!,?~]+$/g, '').trim();
  if (!text) return null;

  const words = text.split(/\s+/);
  const first = words[0].toLowerCase();
  let command = BY_ALIAS[first] || (prefixMode ? SHORT_ALIASES[first] : null) || null;
  if (!command && first === 'now' && (words[1] || '').toLowerCase() === 'playing') command = 'np';
  if (!command) return null;

  const rawArgs = text.slice(words[0].length).trim();

  if (!prefixMode) {
    // Natural: perintah kontrol + play TANPA konteks ("cal, puter musik" ->
    // playlist acak). "puter <judul>" tetap lewat AI supaya bisa dibedakan
    // playlist vs lagu.
    if (command === 'play') {
      const bare = parseBarePlayRequest(rawArgs);
      if (!bare.bare || !addressed) return null;
      return { command: 'play', args: '', source: 'natural', bare: true, shuffle: bare.shuffle };
    }
    if (!CONTROL.has(command)) return null;
    if (!addressed && !(hasQueue && CONTROL.has(command))) return null;
    if (command === 'join') return { command, args: rawArgs, source: 'natural' };
    if (command === 'leave' || command === 'help') return { command, args: '', source: 'natural' };

    const rest = words.slice(1).map(w => w.toLowerCase());
    if (rest.some(w => !FILLERS.has(w))) return null;
    return { command, args: '', source: 'natural' };
  }

  // Prefix mode: play/playlist butuh argumen bebas, sisanya diabaikan.
  if (command === 'play') {
    const bare = parseBarePlayRequest(rawArgs);
    if (bare.bare) return { command: 'play', args: '', source: 'prefix', bare: true, shuffle: bare.shuffle };
    return { command: 'play', args: rawArgs, source: 'prefix' };
  }
  if (command === 'playlist') {
    return { command: 'playlist', args: rawArgs, source: 'prefix' };
  }
  if (command === 'join' || command === 'move') {
    return { command, args: rawArgs, source: 'prefix' };
  }
  return { command, args: '', source: 'prefix' };
}

/**
 * Deteksi perintah kontrol dari awal pesan (tanpa peduli sisa kalimat).
 * Dipakai sebagai guard kalau AI salah pilih PLAY_* untuk perintah kontrol.
 */
function detectControlVerb(content) {
  let text = clean(content);
  if (!text) return null;
  if (text.startsWith('>')) text = text.slice(1).trim();
  text = text.replace(NAME_RE, '').replace(LEAD_RE, '').trim();

  const first = text.toLowerCase().split(/\s+/)[0];
  const command = BY_ALIAS[first];
  return command && CONTROL.has(command) ? command : null;
}

function extractUrls(content) {
  const matches = String(content || '').match(/https?:\/\/[^\s<>]+/gi) || [];
  return matches
    .map((url) => url.split('>>')[0].replace(/[),.!?\]}]+$/g, ''))
    .filter(Boolean);
}

function cleanTarget(value) {
  return String(value || '').trim()
    .replace(/https?:\/\/[^\s<>]+/gi, ' ')
    .replace(/^playlist\s+/i, '')
    .replace(/^yang\s+/i, '')
    .replace(/["'`]/g, '')
    .replace(/\b(?:dong|deh|ya|yah|nih|sih|wkwk|pls|please|aja|saja|ada|yang)\b/gi, ' ')
    .replace(/\byang\b.*$/i, '')
    .replace(/\b(?:isinya|isi|berapa|apa)\b.*$/i, '')
    .replace(/[\s.!,?~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTarget(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s<>]+/gi, ' ');

  const arrow = withoutUrls.match(/(?:^|\s)>>\s*(.+)/);
  if (arrow) {
    const target = cleanTarget(arrow[1]);
    if (target) return target;
  }

  const preposition = withoutUrls.match(
    /\b(?:di|ke|masukin\s+ke|masukkan\s+ke|simpan\s+ke|taruh\s+di|taruh\s+ke)\s+(?:playlist\s+)?(.+)$/i
  );
  if (preposition) {
    const target = cleanTarget(preposition[1]);
    // Nama playlist wajar pendek; kalau kepanjangan berarti itu kalimat biasa.
    if (target && target.split(/\s+/).length <= 6) return target;
  }
  return null;
}

/**
 * Parser perintah library lagu (tanpa AI):
 * - tambah/add/like/simpan URL ke playlist lokal
 * - tambah lagu yang sedang diputar ke playlist lokal
 * - buat playlist lokal baru
 */
function parseLibraryCommand(content, { isMentioned = false, isReplyToCallista = false } = {}) {
  let text = clean(content);
  if (!text) return null;

  const prefixMode = text.startsWith('>');
  let addressed = prefixMode || isMentioned || isReplyToCallista;

  if (prefixMode) {
    text = text.slice(1).trim();
  } else {
    const name = text.match(NAME_RE);
    if (name) {
      addressed = true;
      text = text.slice(name[0].length).trim();
    }
  }

  text = text.replace(LEAD_RE, '').replace(/[\s.!,?~]+$/g, '').trim();
  if (!text) return null;

  // Prefix ">add" / natural "cal, tambah ..." harus ditujukan ke Callista.
  if (!addressed) return null;

  const createMatch = text.match(/^(?:buat|bikin|create|new)\s+(?:(?:playlist|pl)\s+)?(.+)$/i);
  if (createMatch) {
    // Natural wajib pakai kata "playlist" supaya "cal, buat apa" nggak bikin playlist.
    const naturalCreate = /^(?:buat|bikin)\s+(?:playlist|pl)\b/i.test(text);
    if (!prefixMode && !naturalCreate) return null;
    const name = cleanTarget(createMatch[1]);
    if (!name) return null;
    return { command: 'create', name, source: prefixMode ? 'prefix' : 'natural' };
  }

  let infoName = null;
  const deleteMatch = text.match(/^(?:delete|hapus|remove|hapuskan)\b(?:\s+(.+))?$/i);
  if (deleteMatch) {
    const name = deleteMatch[1] ? cleanTarget(deleteMatch[1]) : null;
    return { command: 'delete', name, source: prefixMode ? 'prefix' : 'natural' };
  }

  const infoMatch = text.match(/^(?:isi|cek|lihat|info)\s+(?:playlist\s+)?(.+)$/i);
  if (infoMatch) {
    infoName = cleanTarget(infoMatch[1]);
  } else if (/\b(?:isi|cek)\b/i.test(text)) {
    const afterKeyword = text.split(/\b(?:isi|cek)\b/i)[1] || '';
    const target = cleanTarget(afterKeyword) || extractTarget(text);
    if (target) infoName = target;
  }
  if (infoName) {
    return { command: 'info', name: infoName, source: prefixMode ? 'prefix' : 'natural' };
  }

  const addMatch = text.match(/^(?:add|tambah|tambahin|simpan|save|masukin|masukkan|taruh)\b(.*)$/i);
  const likeMatch = text.match(/^(?:like|suka|fav|favorit)\b(.*)$/i);
  const urlFirst = !addMatch && !likeMatch && extractUrls(text).length > 0 &&
    /\b(?:masukin|masukkan|taruh|simpan|tambah(?:in)?)\b/i.test(text);

  if (!addMatch && !likeMatch && !urlFirst) return null;

  const urls = extractUrls(text);
  const target = likeMatch ? 'favorit' : extractTarget(text);
  const currentSong = /\b(?:lagu|musik|song)\s+(?:sekarang|ini|yang\s+lagi\s+diputar|yang\s+lagi\s+diputer|lagi\s+diputar|lagi\s+diputer)\b|\b(?:current|now\s+playing|now)\b/i.test(text);

  // Natural tanpa link & tanpa "lagu sekarang" bukan perintah add (biar "cal, tambahin aku dong" tetap ke AI).
  if (!prefixMode && urls.length === 0 && !currentSong) return null;

  return {
    command: 'add',
    urls,
    target,
    currentSong,
    source: prefixMode ? 'prefix' : 'natural',
  };
}

/**
 * Jawaban atas pertanyaan "masukin kemana ini?".
 * Contoh: "di abcd", "favorit", "masukin ke playlist abcd".
 */
function parsePendingTarget(content, { isMentioned = false } = {}) {
  let text = clean(content);
  if (!text) return null;
  if (extractUrls(text).length > 0) return null;

  const name = text.match(NAME_RE);
  if (name) text = text.slice(name[0].length).trim();
  text = text.replace(LEAD_RE, '').trim();

  // Kalau ternyata perintah baru (bukan jawaban target), biarkan parser lain yang urus.
  if (/^(?:buat|bikin|create|add|tambah|tambahin|like|suka|fav|play|puter|putar|skip|stop|pause|resume|queue|antrian|shuffle|join|leave|help)\b/i.test(text)) {
    return null;
  }

  text = text
    .replace(/^(?:(?:di|ke|masukin\s+ke|masukkan\s+ke|simpan\s+ke|taruh\s+di|taruh\s+ke)\s+)?(?:playlist\s+)?/i, '')
    .replace(/^yang\s+/i, '')
    .replace(/\b(?:dong|deh|ya|yah|nih|sih|wkwk|pls|please)\b/gi, ' ')
    .replace(/\s+(?:aja|saja)$/i, '')
    .replace(/[\s.!,?~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;
  if (text.split(/\s+/).length > 5) return null;
  return text;
}

function cleanSearchQuery(raw) {
  return String(raw || '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\b(?:cal|callista|calista|firka|cay|sayang)\b[\s,.:!-]*/gi, ' ')
    .replace(/^(?:lagu|musik|music|song)\b\s*/i, '')
    .replace(/\b(?:di|ke)\s+youtube\b/gi, ' ')
    .replace(/\b(?:dong|deh|ya|yah|nih|sih|wkwk|pls|please)\b/gi, ' ')
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parser pencarian lagu (deterministik, tanpa AI).
 * Contoh: "cal, cari lagu renegades one ok rock dong" -> query "renegades one ok rock"
 */
function parseSearchCommand(content, { isMentioned = false, isReplyToCallista = false } = {}) {
  let text = clean(content);
  if (!text) return null;

  const prefixMode = text.startsWith('>');
  let addressed = prefixMode || isMentioned || isReplyToCallista;

  if (prefixMode) {
    text = text.slice(1).trim();
  } else {
    const name = text.match(NAME_RE);
    if (name) {
      addressed = true;
      text = text.slice(name[0].length).trim();
    }
  }

  text = text.replace(LEAD_RE, '').trim();
  if (!addressed) return null;

  // Eksplisit command: >sc <query>, >search <query>, >cari <query>, cal, sc <query>
  const directMatch = text.match(/^(?:sc|search|cari)\b\s*([\s\S]*)$/i);
  if (directMatch) {
    return {
      command: 'search',
      query: cleanSearchQuery(directMatch[1]),
      source: prefixMode ? 'prefix' : 'natural',
    };
  }

  // Sensitif: "cari" bisa di mana saja dalam kalimat.
  const cariPos = text.search(/\b(?:cariin|carikan|cari|search)\b/i);
  if (cariPos === -1) return null;

  let before = text.slice(0, cariPos).trim();
  let after = text.slice(cariPos).replace(/\b(?:cariin|carikan|cari|search)\b/i, '').trim();
  // Bersihkan filler sebelum/selesai query
  before = before.replace(/^(?:oke|kalau|gmn|bagaimana|coba|cobain)\s+/i, '').trim();
  before = before.replace(/\b(?:oke|kalau|gmn|bagaimana|coba|cobain)\b[.,!?:;]*\s*/gi, ' ').trim();
  after = after.replace(/\b(?:gmn|bagaimana|oke|kalau)\b[.,!?:;]*\s*/gi, ' ').trim();
  // Gabungkan: jika keduanya ada, gabung; jika salah satu kosong, pakai yang ada.
  let queryRaw;
  if (after && before) queryRaw = `${before} ${after}`.trim();
  else if (after)      queryRaw = after;
  else                 queryRaw = before || '';

  const queryPart = queryRaw;
  // Untuk unaddressed, wajib ada kata musik; untuk addressed (reply/mention/name), bebas.
  const relaxed = prefixMode || isMentioned || isReplyToCallista || !!text.match(NAME_RE);
  if (!relaxed && !prefixMode && !/\b(?:lagu|musik|music|song|video)\b/i.test(queryPart)) {
    return null;
  }

  return {
    command: 'search',
    query: cleanSearchQuery(queryRaw || queryPart || ''),
    source: prefixMode ? 'prefix' : 'natural',
  };
}

/**
 * Parser pemilihan hasil pencarian.
 * Contoh: "masukin link nomor 1 ke abcd", "nomor 1 ke favorit", "puter nomor 1".
 */
function parseSearchPick(content) {
  let text = clean(content);
  if (!text) return null;

  const prefixMode = text.startsWith('>');

  if (prefixMode) {
    text = text.slice(1).trim();
  } else {
    const name = text.match(NAME_RE);
    if (name) text = text.slice(name[0].length).trim();
  }

  text = text.replace(LEAD_RE, '').trim();

  // Sengaja tidak wajib addressed: Mas Joy biasanya langsung jawab
  // "masukin link nomor 1 ke abcd" tanpa mention. Bot tetap cek
  // apakah user itu punya hasil pencarian aktif sebelum eksekusi.
  // Harus eksplisit: "nomor 1", "link 1", "pick 1", ">p 1", ">play 1", atau cuma angka "1".
  const match =
    text.match(/^(?:play|p|puter|putar|mainin|mainkan)\s+(?:nomor|nomer|no|#)?\s*(\d{1,2})\b/i) ||
    text.match(/\b(?:nomor|nomer|no|#)\s*(\d{1,2})\b/i) ||
    text.match(/\blink\s+(\d{1,2})\b/i) ||
    text.match(/^(?:pick|pilih)\s+(?:link\s+)?(\d{1,2})\b/i) ||
    text.match(/^(\d{1,2})$/i);

  if (!match) return null;

  const index = Number(match[1]);
  if (index < 1 || index > 10) return null;

  const target = extractTarget(text);
  const startsPlay = /^(?:puter|putar|mainin|mainkan|play|p)\b/i.test(text);
  const startsAdd = /^(?:masukin|masukkan|taruh|simpan|tambah|tambahin)\b/i.test(text);
  const withLoop = />>loop\b/i.test(text);

  return {
    command: 'pick',
    index,
    target,
    play: startsPlay || (!target && !startsAdd),
    withLoop,
    source: prefixMode ? 'prefix' : 'natural',
  };
}

/**
 * Pisahkan title dari suffix >>loop di perintah play.
 * Contoh: ">play renegades >>loop" -> { title: 'renegades', withLoop: true }
 */
function parsePlayLoopSuffix(args) {
  const match = String(args || '').match(/^(.*?)\s*>>loop\s*$/i);
  if (match) return { title: match[1].trim(), withLoop: true };
  return { title: String(args || '').trim(), withLoop: false };
}

/**
 * Perintah izin. Prefix saja (">permit @user"), karena ini kontrol akses.
 * - ">permit @user [@user2 ...]" -> action 'grant'
 * - ">unpermit @user"            -> action 'revoke'
 * - ">permit" (tanpa mention)    -> action 'list'
 *
 * @returns {{action: 'grant'|'revoke'|'list', ids: string[]}|null}
 */
function parsePermitCommand(content) {
  // Jangan pakai clean(): fungsinya membuang <@id>, padahal itu justru target izin.
  const text = String(content || '').trim();
  if (!text.startsWith('>')) return null;

  const body = text.slice(1).trim();
  const m = body.match(/^(permit|unpermit|cabut\s+izin)\b\s*([\s\S]*)$/i);
  if (!m) return null;

  const revoke = /^unpermit|cabut/i.test(m[1]);
  const rest = m[2] || '';
  const ids = [...rest.matchAll(/<@!?(\d+)>/g)].map(x => x[1]);

  if (ids.length === 0) return { action: revoke ? 'revoke' : 'list', ids: [] };
  return { action: revoke ? 'revoke' : 'grant', ids: [...new Set(ids)] };
}

/**
 * Perintah tambah playlist YouTube remote dengan nama custom.
 * Contoh: ">pl-rm https://www.youtube.com/playlist?list=PLxxx >>Harutya"
 *
 * Prefix saja, karena ini nulis ke store (bukan natural chat).
 * @returns {{url: string, name: string, source: 'prefix'}|null}
 */
function parseRemotePlaylistCommand(content) {
  const text = String(content || '').trim();
  if (!text.startsWith('>')) return null;

  const body = text.slice(1).trim();
  const m = body.match(/^(pl-rm|plrm|playlist-rm|remote-playlist)\b\s*([\s\S]*)$/i);
  if (!m) return null;

  const rest = m[2] || '';
  return {
    url: extractUrls(rest)[0] || '',
    name: extractTarget(rest) || '',
    source: 'prefix',
  };
}

/**
 * Perintah lompat ke menit tertentu di lagu yang sedang diputar.
 * Contoh: ">jump 5" -> 5:00, ">jump 1.5" -> 1:30 (90 detik).
 *
 * @returns {{minutes: number|null}|null} minutes null = argumen kosong
 */
function parseJumpCommand(content) {
  const text = String(content || '').trim();
  if (!text.startsWith('>')) return null;

  const m = text.slice(1).trim().match(/^jump\b\s*([\d.,]*)\s*$/i);
  if (!m) return null;

  const raw = (m[1] || '').replace(',', '.');
  if (!raw) return { minutes: null };

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return { minutes };
}

module.exports = {
  parseDirectCommand,
  detectControlVerb,
  parseBarePlayRequest,
  parseLibraryCommand,
  parsePendingTarget,
  parseSearchCommand,
  parseSearchPick,
  parsePlayLoopSuffix,
  parsePermitCommand,
  parseRemotePlaylistCommand,
  parseJumpCommand,
  extractUrls,
  CONTROL_FORMATS,
};
