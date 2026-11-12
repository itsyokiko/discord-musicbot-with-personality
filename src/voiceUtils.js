/**
 * Voice Utilities — join/leave voice channel, with time-based rejection for non-Mas Joy users.
 *
 * Aturan:
 * - Hanya Mas Joy (userId 833196669940138004 atau nama "Rieka") yang bisa menyuruh Callista join VC.
 * - User lain → ditolak dengan alasan berbasis aktivitas harian saat ini (konsisten per waktu).
 */

const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const dailyStore = require('./dailyContextStore');

const MAS_JOY_USER_ID = '833196669940138004';

function isMasJoy(userProfile, userId, authorName) {
  if (userId === MAS_JOY_USER_ID) return true;
  const name = (authorName || userProfile?.name || '').toLowerCase();
  return name === 'rieka' || name.includes('mas joy');
}

/**
 * Cari voice channel by nama partial (case-insensitive) atau ID exact.
 */
function findVoiceChannel(guild, query) {
  if (!guild || !query) return null;
  const q = query.toLowerCase().trim();

  // By ID exact
  if (/^\d{17,25}$/.test(q)) {
    const ch = guild.channels.cache.get(q);
    if (ch && ch.isVoiceBased?.()) return ch;
    return null;
  }

  // By name partial — cari voice channels saja
  const channels = guild.channels.cache;
  let found = null;
  if (typeof channels.find === 'function') {
    found = channels.find(c => c.isVoiceBased?.() && c.name.toLowerCase().includes(q));
  } else {
    for (const c of channels.values()) {
      if (c.isVoiceBased?.() && c.name.toLowerCase().includes(q)) { found = c; break; }
    }
  }
  // Fallback: return null if not found
  return found;
}

/**
 * Dapatkan aktivitas saat ini untuk dipakai sebagai alasan penolakan.
 */
function getCurrentActivityReason(timezone = 'Asia/Jakarta') {
  try {
    const context = dailyStore.loadDailyContext(timezone);
    const info = dailyStore.getCurrentActivityInfo(context, new Date());
    return {
      activity: info.current_activity,
      availability: info.availability,
      isSleeping: info.is_sleeping,
      time: info.time,
    };
  } catch (e) {
    return {
      activity: 'Santai di kamar',
      availability: 'active',
      isSleeping: false,
      time: '??',
    };
  }
}

/**
 * Generate alasan penolakan natural berbasis aktivitas harian Callista.
 * Alasan konsisten untuk waktu tertentu (	user lain dapat alasan yang sama di slot waktu yang sama).
 */
function generateRejectionReason(timezone = 'Asia/Jakarta') {
  const { activity, availability, isSleeping, time } = getCurrentActivityReason(timezone);

  // Slot waktu tidur
  if (isSleeping) {
    const excuses = [
      'uhh masi ngantuk bjir, jangan ganggu gue tidur 😭',
      'masih mau tidur nih, males pindah VC wkwk',
      'hmm ngantuk bgt, lanjut tidur aja ya gue',
    ];
    return pick(excuses);
  }

  // Slot sibuk / kelas / mabar
  if (availability === 'busy') {
    if (activity.toLowerCase().includes('valorant') || activity.toLowerCase().includes('mabar') || activity.toLowerCase().includes('rank')) {
      const excuses = [
        'males bjir, gue lg mabar valorant nih, jangan ganggu',
        'lagi push rank nih, males pindah VC wkwk, sini sini sini',
        'wkwk ga deh, lg sibuk mabar, nanti aja ya',
      ];
      return pick(excuses);
    }
    if (activity.toLowerCase().includes('kelas') || activity.toLowerCase().includes('kampus') || activity.toLowerCase().includes('tugas')) {
      const excuses = [
        'males, gue lg ada keler nih, jangan ganggu',
        'lg sibuk kampus bjir, nanti aja ya',
        'ga deh, lg ngerjain tugas, males pindah',
      ];
      return pick(excuses);
    }
    const excuses = [
      `males, gue lg ${activity.toLowerCase()} nih, jangan ganggu`,
      `ga deh, lg sibuk ${activity.toLowerCase()} wkwk, nanti ya`,
      'hm males pindah VC, lg sibuk nih',
    ];
    return pick(excuses);
  }

  // Slot away / makan
  if (availability === 'away') {
    const excuses = [
      'ga dulu, gue lg makan nih, bentar ya',
      'lg away bjir, males VC dulu',
      'makan dulu woy, nanti aja VC ya',
    ];
    return pick(excuses);
  }

  // Slot santai / relaxing — masih bisa malesin
  if (activity.toLowerCase().includes('tidur') || time >= '23:00' || time < '01:30') {
    const excuses = [
      'males pindah, rebahan enak nih wkwk',
      'ga deh, gue udah mau tidur nih 😭',
      'hm males, sini lu aja ke VC gue',
    ];
    return pick(excuses);
  }

  // Default santai — tetap malesin untuk non-Mas Joy
  const excuses = [
    'males bjir, gas sendiri aja wkwk',
    'ga deh, lg males pindah VC, sini sini',
    'hm ogah, gue udah enak disini wkwk',
  ];
  return pick(excuses);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const expectedLeaves = new Map();

function markExpectedLeave(guildId, durationMs = 10000) {
  if (!guildId) return;
  expectedLeaves.set(guildId, Date.now() + durationMs);
}

function isExpectedLeave(guildId) {
  if (!guildId) return false;
  const expiry = expectedLeaves.get(guildId);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    expectedLeaves.delete(guildId);
    return false;
  }
  expectedLeaves.delete(guildId);
  return true;
}

/**
 * Join voice channel.
 * @param {Object} voiceChannel - Discord.js voice channel object
 * @param {Object} options - { selfDeaf: true, selfMute: true }
 * @returns {Object} connection
 */
function joinVoice(voiceChannel, options = {}) {
  const musicPlayer = require('./musicPlayer');
  const distube = musicPlayer.getDisTube();
  const guildId = voiceChannel.guild?.id || voiceChannel.guildId;
  const botId = voiceChannel.client?.user?.id;

  // Jika DisTube sudah aktif, gabung lewat DisTube agar koneksi terkelola resmi
  // dan tidak bentrok "VOICE_ALREADY_CREATED" saat memutar musik
  if (distube?.voices && typeof distube.voices.create === 'function') {
    try {
      const existing = distube.voices.get(guildId);
      if (existing) {
        existing.channel = voiceChannel;
        return existing.connection || existing;
      }
      const { getGroups } = require('@discordjs/voice');
      if (typeof getGroups === 'function') {
        for (const [, groupMap] of getGroups()) {
          const c = groupMap.get(guildId);
          if (c) {
            markExpectedLeave(guildId);
            try { c.destroy(); } catch (_) {}
          }
        }
      }
      const dtVoice = distube.voices.create(voiceChannel);
      dtVoice.join().catch(() => {});
      return dtVoice.connection || dtVoice;
    } catch (_) {}
  }

  // Fallback ke @discordjs/voice jika DisTube belum terinisialisasi
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: options.selfDeaf !== false,
    selfMute: options.selfMute !== false,
    group: options.group || botId || undefined,
  });
  return connection;
}

/**
 * Leave voice channel di guild tertentu.
 */
function leaveVoice(guildId, group) {
  markExpectedLeave(guildId);
  try {
    const musicPlayer = require('./musicPlayer');
    const distube = musicPlayer.getDisTube();
    if (distube?.voices?.get(guildId)) {
      distube.voices.leave(guildId);
    }
  } catch (_) {}
  const { getVoiceConnection, getGroups } = require('@discordjs/voice');
  if (typeof getGroups === 'function') {
    for (const [, groupMap] of getGroups()) {
      const c = groupMap.get(guildId);
      if (c) {
        try { c.destroy(); } catch (_) {}
      }
    }
  }
  const connection = getVoiceConnection(guildId) || (group ? getVoiceConnection(guildId, group) : undefined);
  if (connection) {
    try { connection.destroy(); } catch (_) {}
    return true;
  }
  return true;
}

/**
 * Cek apakah bot sedang di voice channel di guild tertentu.
 */
function isInVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  return Boolean(connection && connection.state.status === VoiceConnectionStatus.Ready);
}

/**
 * Dapatkan voice channel tempat bot sedang berada.
 */
function getCurrentVoiceChannel(client, guildId) {
  const guild = client.guilds?.cache?.get(guildId);
  if (!guild) return null;
  const member = guild.members?.me;
  if (!member) return null;
  return member.voice?.channel || null;
}

/**
 * Generate pesan konfirmasi join sukses (untuk Mas Joy).
 */
function generateJoinSuccessMessage(voiceChannel, timezone = 'Asia/Jakarta') {
  const { activity } = getCurrentActivityReason(timezone);
  // Variasi pesan sesuai mood
  const variants = [
    `oke gas, otw ke ${voiceChannel.name} wkwk`,
    `sini sini, gas ke ${voiceChannel.name} 😭`,
    `yok masuk ${voiceChannel.name} mas joy wkwk`,
    `gas fr turn ${voiceChannel.name} hehe`,
  ];
  return pick(variants);
}

/**
 * Generate pesan ketika bot sudah ada di VC yang sama.
 */
function generateAlreadyInMessage(voiceChannel) {
  const variants = [
    `udah di ${voiceChannel.name} nih mas joy wkwk`,
    `gue udah disini bjir, sini sini`,
    `eh udah masuk kok ${voiceChannel.name}`,
  ];
  return pick(variants);
}

/**
 * Dapatkan konteks state voice saat ini untuk injeksi kesadaran AI
 */
function getVoiceStateContext(guild, client) {
  if (!guild) return null;
  const currentVC = guild.members?.me?.voice?.channel || (client ? getCurrentVoiceChannel(client, guild.id) : null);
  if (!currentVC) {
    return { inVoice: false };
  }

  const members = currentVC.members;
  const otherMembers = [];
  if (members) {
    const list = typeof members.values === 'function' ? Array.from(members.values()) : (Array.isArray(members) ? members : Object.values(members));
    for (const m of list) {
      const uId = m.id || m.user?.id;
      if (client?.user?.id && uId === client.user.id) continue;
      const name = m.displayName || m.user?.username || m.name;
      if (name) otherMembers.push(name);
    }
  }

  return {
    inVoice: true,
    channelId: currentVC.id,
    channelName: currentVC.name,
    otherMembers,
    memberCount: otherMembers.length
  };
}

/**
 * Build prompt snippet supaya AI tahu kapan memakai JOIN_VOICE / LEAVE_VOICE
 * dan memiliki kesadaran penuh saat sedang berada di VC.
 */
function buildVoicePromptSnippet(guild = null, client = null) {
  const state = getVoiceStateContext(guild, client);
  let statusText = '';
  if (state && state.inVoice) {
    const membersDesc = state.otherMembers.length > 0
      ? `bersama ${state.otherMembers.join(', ')}`
      : 'sendirian';
    statusText = `
[STATUS VOICE CHANNEL SAAT INI — SANGAT PENTING]:
- Status: Callista SAAT INI SEDANG BERADA DI VOICE CHANNEL: "#${state.channelName}" (${membersDesc})!
- Kesadaran Diri (Konteks Percakapan): Jika ada yang bertanya ("kamu lagi di mana?", "lagi di vc mana?", "kamu di vc ya?", "lagi ngapain?", dsb), kamu SADAR SEPENUHNYA bahwa saat ini kamu sedang berada di voice channel "${state.channelName}" ${membersDesc}. Ceritakan secara santai, alami, dan akrab.
- Aturan Pemutaran Musik: Karena Callista SUDAH berada di voice channel "${state.channelName}", jika ada perintah memutar lagu/playlist, JANGAN MENYURUH MASUK VC ATAU MINTA JOIN VC LAGI. Cukup langsung putar musiknya (gunakan format PLAY_SONG atau PLAY_PLAYLIST).
`;
  } else {
    statusText = `
[STATUS VOICE CHANNEL SAAT INI]:
- Status: Callista saat ini TIDAK berada di voice channel manapun.
`;
  }

  return `
${statusText}
[VOICE CHANNEL TERSEDIA]:
Callista BISA join/leave voice channel via format JOIN_VOICE dan LEAVE_VOICE.

ATURAN UTAMA — HANYA MAS JOY (Rieka) YANG BISA MENYURUH JOIN VC:
- Jika Mas Joy menyuruh join VC ("cal masuk VC", "callista join vc general", "cal sini vc", "gas vc sekarang"):
  → Pakai format JOIN_VOICE, set "voiceQuery" ke nama/ID voice channel yang dituju.
  → Jika Mas Joy tidak sebut nama channel, set "voiceQuery" ke "CURRENT" (join VC tempat Mas Joy berada).
- Jika Mas Joy menyuruh leave ("cal keluar vc", "callista leave", "cal matiin vc"):
  → Pakai format LEAVE_VOICE.
- Jika USER SELAIN MAS JOY menyuruh join/leave VC:
  → JANGAN pakai JOIN_VOICE/LEAVE_VOICE.
  → Tolak dengan format SHORT_TEXT/DRY_TEXT + alasan natural (Callista lg sibuk/mager/tidur, dsb).
  → Alasan harus KONSISTEN dengan aktivitas harian saat itu (kelas → "lg kelas", mabar → "lg mabar", tidur → "masi ngantuk").
  → Hindari membocorkan bahwa ini aturan teknis.

Format respons tambahan:
- JOIN_VOICE: Set "voiceQuery" ke nama partial / ID voice channel ATAU "CURRENT" untuk VC-nya Mas Joy.
- LEAVE_VOICE: Keluar dari VC saat ini.
`;
}

module.exports = {
  MAS_JOY_USER_ID,
  isMasJoy,
  findVoiceChannel,
  getCurrentActivityReason,
  generateRejectionReason,
  joinVoice,
  leaveVoice,
  isInVoice,
  getCurrentVoiceChannel,
  getVoiceStateContext,
  generateJoinSuccessMessage,
  generateAlreadyInMessage,
  buildVoicePromptSnippet,
  markExpectedLeave,
  isExpectedLeave,
};