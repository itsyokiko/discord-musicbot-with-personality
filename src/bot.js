const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const storage = require('./storage');
const ai = require('./ai');
const decision = require('./decision');
const dailyStore = require('./dailyContextStore');
const naturalTyping = require('./naturalTyping');
const stickerEmoji = require('./stickerEmojiStore');
const gifSearch = require('./gifSearch');
const channelUtils = require('./channelUtils');
const voiceUtils = require('./voiceUtils');
const musicPlayer = require('./musicPlayer');
const musicStore = require('./musicStore');
const musicCommands = require('./musicCommands');
const youtubePlaylist = require('./youtubePlaylist');
const tinyfishSearch = require('./tinyfishSearch');
const permissionStore = require('./permissionStore');
const playbackHistoryStore = require('./playbackHistoryStore');
const sfxStore = require('./sfxStore');
const lyricsStore = require('./lyricsStore');
const voiceTracker = require('./voiceTracker');
const todayMemory = require('./todayMemory');
const collegeRoadmap = require('./collegeRoadmap');
const classSessionManager = require('./classSessionManager');
const moodSystem = require('./moodSystem');

const processedMessageIds = new Set();
const activeBursts = new Map();
// Menyimpan link yang nunggu jawaban "masukin ke playlist mana?"
const pendingSongAdds = new Map();
const PENDING_ADD_TTL_MS = 5 * 60 * 1000;

function pendingAddKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ==================== TEMPLATE RESPONS (tanpa AI) ====================
   Dipilih secara random agar respons bot terkesan bervariat dan alami,
   mirip jawaban generatif tapi tetap deterministik. */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Kontrol musik ---
const SKIP_SUCCESS = ['⏭️', 'udah di-skip, lagu berikutnya yuk', 'oki skip, cabut dari lagunya wkwk', 'skipnya udah aku lakuin'];
const SKIP_FAIL = ['ga ada yang lagi diputer buat di-skip nih 😭', 'antreannya kosong banget, skip apa sih wkwk', 'nyala dulu baru bisa di-skip wkwk'];
const STOP_SUCCESS = ['oke stop, aku cabut dulu ya', 'stop, aku keluar dari VC', 'udah, aku cabut wkwk', 'berhenti dulu, sampai situ ya', 'oke, gue stop dan cabut'];
const STOP_FAIL = ['ga lagi muter musik kok 😭', 'gak ada musik yang nyala, stop apa sih wkwk', 'udah mati kok, stop apa sih'];
const PAUSE_SUCCESS = ['⏸️', 'udah di-pause, lanjut nanti ya', 'diem dulu lagunya wkwk', 'jedanya udah aku nyalakan'];
const PAUSE_FAIL = ['ga lagi muter bos 😭', 'nyala dulu baru bisa di-pause wkwk', 'udah di-pause kok, pause apa sih'];
const RESUME_SUCCESS = ['▶️', 'lanjutin lagi wkwk', 'nyalain balik lagunya', 'oke, lanjutin lagi'];
const RESUME_FAIL = ['ga ada yang di-pause bjir 😭', 'udah nyala kok, resume apa sih wkwk', 'gak ada yang jeda, resume apa'];
const SHUFFLE_SUCCESS = ['oke di-shuffle wkwk 🎲', 'udah di-acak2, akak-acak wkwk', 'shuffle selesai, random mode on', 'antreannya udah di-acak'];
const SHUFFLE_FAIL_NONE = ['ga ada queue buat di-shuffle mas joy 😭', 'antreannya kosong, acak apa sih wkwk', 'kosong banget, shuffle apa'];
const SHUFFLE_FAIL_LESS = ['lagu di queue kurang dari 2, ga bisa di-shuffle bjir 😭', 'cuma 1 lagu, acak-acak gimana sih wkwk', 'butuh minimal 2 lagu buat di-shuffle'];
const QUEUE_EMPTY = ['queue kosong mas joy 😭', 'antreannya kosong banget wkwk', 'belum ada lagu yang diantre'];
const NP_FAIL = ['ga ada lagu yang lagi diputer bjir 😭', 'nyala dulu baru tau now playing wkwk', 'udah mati kok, np apa sih'];
const PLAY_FAIL_NO_ARGS = ['mau puter lagu apa mas joy? 😭', 'judulnya apa sih, mas joy?', 'lagu apa yang mau diputar?'];
const PLAY_FAIL_NO_VC = ['mas joy masuk VC dulu, atau suruh gue join dulu 😭', 'masuk VC dulu baru aku bantu puter wkwk', 'gabisa kalau mas joy belum masuk VC'];
const PLAYLIST_EMPTY = (name) => `playlist lokal **${name}** masih kosong. Tambahin dulu: \`>add <link> >>${name}\``;
const PLAYLIST_NOT_FOUND = (name) => `ga nemu playlist "${name}" mas joy 😭`;
const PLAYLIST_FAIL_NO_VC = ['mas joy masuk VC dulu, atau suruh gue join dulu 😭', 'masuk VC dulu baru bisa puter playlist wkwk'];
const BACK_SUCCESS = (name) => `oke, aku balik ke **${name}** ya Mas Joy 🎵`;
const BACK_ALREADY = ['gue udah di sini mas joy 😭', 'udah ada di sini kok, balik kemana wkwk', 'udah ada di VC itu kok'];
const BACK_FAIL_NO_VC = ['mas joy belum masuk VC mana-mana, mau balik kemana? 😭', 'masuk VC dulu baru bisa balik wkwk'];
const LOOP_SUCCESS = ['oke, lagu ini di-loop terus ya 🔂', 'loop nyala, ulang-ulang aja wkwk', 'loop-mode: ON, ulang terus wkwk'];
const LOOP_FAIL = ['ga ada lagu yang lagi diputer buat di-loop 😭', 'nyala dulu baru bisa di-loop wkwk', 'udah mati kok, loop apa sih'];
const UNLOOP_SUCCESS = ['oke, loop-nya dimatiin 👍', 'udah mati loopnya wkwk', 'loop sudah aku matiin'];
const UNLOOP_FAIL = ['ga ada lagu yang lagi diputer 😭', 'udah mati kok, unloop apa sih wkwk'];
const JOIN_FAIL_NOT_IN_VC = ['mas joy lu sendiri aja belum masuk VC wkwk, masuk dulu dong 😭', 'masuk VC dulu baru aku ikut wkwk', 'gabisa kalau mas joy belum ada di VC'];
const MOVE_FAIL_NOT_FOUND = (name) => `ga nemu VC "${name}" mas joy 😭`;
const LEAVE_FAIL = ['ga lagi di VC, Mas Joy', 'udah keluar kok, leave apa sih wkwk', 'udah di luar kok'];

// --- Playlist / Library ---
const LIB_INFO_EMPTY = (name) => `playlist **${name}** masih kosong mas joy 😭`;
const LIB_CREATE_EXISTS = (name) => `playlist **${name}** udah ada mas joy 😭`;
const LIB_CREATE_REMOTE = (name) => `nama **${name}** udah dipakai playlist YouTube remote. Pilih nama lain dong 😭`;
const LIB_CREATE_FAIL = (err) => `gagal bikin playlist: ${err}`;
const LIB_ADD_NO_URL = ['link YouTube/TikTok/Spotify-nya mana? contoh: `>add https://youtu.be/... >>Favorit`', 'link-nya mana sih wkwk, kasih link YouTube, TikTok, atau Spotify-nya'];
const LIB_ADD_NO_CURRENT = ['ga ada lagu yang lagi diputer buat disimpen 😭', 'nyala dulu baru bisa simpan lagu sekarang wkwk'];
const LIB_ADD_NO_TARGET = (options) => `masukin kemana ini?\n${options}\n\nBalas \`di ${options.split('\n')[0] || 'Favorit'}\` atau nama playlist lokal lain. Playlist YouTube remote nggak bisa ditambahin.`;
const LIB_ADD_REMOTE = (name) => `playlist **${name}** itu YouTube remote, cuma bisa diputar. Nggak bisa ditambahin lagu. Bikin playlist lokal dulu: \`cal, buat playlist ${name}\``;
const LIB_ADD_DUPLICATE = (name, total) => `semua lagu udah ada di **${name}** (${total} lagu)`;
const LIB_ADD_SUCCESS = (name, added, duplicate, total) => {
  let msg = `masuk **${name}**: ${added} lagu ditambahin`;
  if (duplicate) msg += `, ${duplicate} udah ada`;
  msg += ` (total ${total})`;
  return msg;
};
const LIB_ADD_FAIL = (err) => `gagal nyimpen: ${err}`;
const LIB_INFO_NOT_FOUND = (name) => `ga nemu playlist lokal "${name}" mas joy 😭`;

// --- Search (TinyFish) ---
const SEARCH_NO_RESULTS = (query) => `ga nemu hasil buat "${query}" di YouTube 😭 coba kata kunci lain.`;
const SEARCH_ERROR = (err) => `uhh gagal nyari di YouTube: ${err.message} 😭`;
const SEARCH_PICK_FAIL_INDEX = (total) => `hasil pencarian cuma ada ${total}. Pilih nomor 1-${total} ya.`;
const SEARCH_PICK_NO_VC = ['mas joy masuk VC dulu, atau suruh gue join dulu 😭', 'masuk VC dulu baru bisa muter hasil cari wkwk'];
const SEARCH_PICK_ERROR = (err) => `uhh gagal muter: ${err.message} 😭`;
const SEARCH_PLAY_OK = (title) => `oke, muter **${title}** 🎵`;

/* ==================================================================== */

function getChannelLabel(channel) {
  if (!channel) return 'Unknown';
  if (channel.name) return `#${channel.name}`;
  return channel.isDMBased?.() ? 'DM' : '#channel';
}

/**
 * Ambil GuildMember dengan aman. Cache bisa kosong (mis. setelah restart),
 * jadi fallback ke fetch supaya voice/music tetap jalan.
 */
async function resolveMember(guild, userId) {
  if (!guild) return null;
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  try {
    return await guild.members.fetch(userId);
  } catch (e) {
    return null;
  }
}

/**
 * Tunggu sampai bot benar-benar hilang dari voice channel (state Discord),
 * supaya balasan "udah keluar" tidak dikirim sebelum bot beneran keluar.
 */
async function waitForVoiceLeave(client, guildId, timeoutMs = 2000) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!guild.members.me?.voice?.channel) return;
    await sleep(100);
  }
}

function formatQueueText(q) {
  if (!q) return null;
  const lines = [];
  const status = q.isPaused ? '⏸️' : (q.isPlaying ? '▶️' : '⏹️');
  const shuf = q.isShuffled ? ' 🔀' : '';
  const rep = q.repeatMode === 1 ? ' 🔂' : (q.repeatMode === 2 ? ' 🔁' : '');
  lines.push(`${status}${shuf}${rep} Antrian lagu (total ${q.total}):`);
  q.songs.forEach((s) => {
    const marker = s.isCurrent ? '▶️ ' : '   ';
    lines.push(`${marker}${s.position}. ${s.name} (${s.duration})`);
  });
  if (q.total > q.songs.length) {
    lines.push(`... dan ${q.total - q.songs.length} lagu lagi`);
  }
  return lines.join('\n');
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x9B59B6)
    .setAuthor({ name: '🎵 Panduan Perintah Musik Callista' })
    .setDescription('Gunakan prefix `>` untuk perintah cepat, atau sapa Callista secara natural.')
    .addFields(
      {
        name: '▶️ Pemutar Musik',
        value: [
          '`>play <judul/link>` / `>p` — Putar lagu atau playlist acak',
          '`>p <judul> >>loop` — Putar lagu lalu langsung loop',
          '`>skip` (`>sk`) · `>stop` (`>st`) · `>pause` · `>resume`',
          '`>loop` / `>unloop` — Ulangi lagu / matikan loop',
          '`>shuffle` (`>sh`) — Acak urutan antrian',
          '`>queue` (`>q`) — Buka/tutup antrian di embed player',
          '`>player` (`>plr`) — Segarkan tampilan pemutar aktif',
          '`>jump <menit>` — Lompat ke posisi menit (cth: `>jump 1.5`)',
          '`>sfx` — Putar audio lokal / SFX dari Dashboard',
          '`>lyrics` (`>lirik`) — Tampilkan lirik lagu lengkap',
          '`>np` — Informasi lagu yang sedang diputar',
          '`>join` / `>leave` — Masuk / keluar Voice Channel',
        ].join('\n'),
      },
      {
        name: '🔍 Pencarian Lagu (YouTube)',
        value: [
          '`>sc <judul>` / `>search` — Cari 10 lagu (embed interaktif)',
          '`>p 1` / `nomor 1` — Putar nomor hasil pencarian',
          '`nomor 1 ke <nama>` — Simpan hasil ke playlist lokal',
        ].join('\n'),
      },
      {
        name: '📁 Playlist Lokal & Remote',
        value: [
          '`>playlist <nama>` / `>pl` — Putar playlist tersimpan',
          '`>add <link>` — Simpan lagu ke playlist lokal',
          '`>like <link>` — Simpan langsung ke Favorit',
          '`>create <nama>` — Buat playlist lokal baru',
          '`>pl-rm <link> >>Nama` — Simpan playlist YouTube remote',
        ].join('\n'),
      },
      {
        name: '🛡️ Izin Perintah (Mas Joy)',
        value: '`>permit @user` · `>unpermit @user` · `>permit` (cek daftar)',
      }
    )
    .setFooter({ text: 'Singkatan cepat hanya berlaku memakai prefix >' });
}

function formatHelpText() {
  return [
    '🎵 **Command Musik Callista**',
    '`>play <judul/link>` / `>p` — putar lagu / playlist acak',
    '`>p <judul> >>loop` — putar lalu langsung loop',
    '`>skip` / `>stop` / `>pause` / `>resume` — kontrol pemutar',
    '`>loop` / `>unloop` — ulang lagu / matikan loop',
    '`>shuffle` / `>queue` (`>q`) / `>player` (`>plr`) — antrian & controller',
    '`>jump <menit>` — lompat ke menit tertentu (cth: `>jump 1.5`)',
    '`>sfx` — putar audio lokal / SFX dari Dashboard',
    '`>lyrics` (`>lirik`) — tampilkan lirik lagu lengkap',
    '`>np` — lagu yang sedang diputar',
    '`>join` / `>leave` — masuk / keluar VC',
    '`>playlist <nama>` — putar playlist',
    '',
    '**Pencarian (YouTube):**',
    '`>sc <judul>` — cari 10 lagu dengan embed interaktif',
    '`>p 1` / `nomor 1` — putar nomor hasil pencarian',
    '`nomor 1 ke <nama>` — simpan hasil ke playlist',
    '',
    '**Playlist:**',
    '`>add <link> >>Nama` / `>like <link>` — simpan lagu',
    '`>create <nama>` — buat playlist lokal baru',
    '`>pl-rm <link> >>Nama` — simpan playlist YouTube remote',
    '',
    '**Izin (Mas Joy):** `>permit @user` / `>unpermit @user` / `>permit`',
  ].join('\n');
}

function formatReply(text, isJoy) {
  if (!isJoy) return text;
  return text
    .replace(/\blu\b/gi, 'Mas Joy')
    .replace(/\bkamu\b/gi, 'Mas Joy')
    .replace(/\bgue\b/gi, 'aku')
    .replace(/\bgw\b/gi, 'aku');
}

const STOP_VARIANTS = [
  'oke stop, aku cabut dulu ya',
  'stop, aku keluar dari VC',
  'udah, aku cabut wkwk',
  'berhenti dulu, sampai situ ya',
  'oke, gue stop dan cabut',
];
const LEAVE_VARIANTS = [
  'oke aku cabut dari VC dulu ya',
  'cabut dulu, sampai nanti',
  'keluar dulu, sampai situ',
  'aku cabut ya mas joy',
  'sudah, aku pergi dulu',
];

function makeCommandReply(client, message, config) {
  const channelId = message.channelId;
  return async (payload) => {
    try {
      let options;
      let historyContent;
      if (typeof payload === 'string') {
        const safeText = payload.length > 1950 ? `${payload.slice(0, 1950)}...` : payload;
        options = { content: safeText, allowedMentions: { repliedUser: false } };
        historyContent = safeText;
      } else {
        options = { allowedMentions: { repliedUser: false }, ...payload };
        historyContent = payload.content || (payload.embeds ? '[embed]' : '[message]');
      }
      const sent = await message.reply(options);
      storage.addHistory(channelId, {
        id: sent.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: historyContent,
        timestamp: sent.createdTimestamp,
        isBot: true
      });
      storage.setFocus(channelId, message.author.id, config.conversationFocus);
    } catch (e) {
      console.error('[CMD REPLY ERROR]', e.message);
    }
  };
}

function isFavoritesName(name) {
  return /^(?:fav|favorit|favorite|likes|suka)$/i.test(String(name || '').trim());
}

/**
 * Eksekusi perintah musik deterministik. Proses aksi dulu, reaksi belakangan.
 * Dipanggil dari messageCreate sebelum gate/AI, jadi tidak ada overhead LLM.
 */
async function handleDirectMusicCommand({ client, message, command, args, source, member, isJoy, allowed, config, bare, shuffle }) {
  const guild = message.guild;

  const rawReply = makeCommandReply(client, message, config);
  const reply = async (payload) => {
    if (typeof payload === 'string') {
      return rawReply(isJoy ? formatReply(payload, true) : formatReply(payload, false));
    }
    return rawReply(payload);
  };

  const react = async (emoji) => {
    try { await message.react(emoji); } catch (e) {}
  };

  const safeDeleteCommandMessage = async () => {
    try {
      if (source === 'prefix' && message && typeof message.delete === 'function') {
        await message.delete().catch(() => {});
      }
    } catch (_) {}
  };

  if (command !== 'help' && !allowed) {
    // Prefix dari user lain dianggap quote/chat biasa: jangan berisik.
    if (source === 'natural') await reply(musicPlayer.generateRejectReason());
    else console.log(`[CMD] ${command} ignored (not Mas Joy)`);
    return;
  }

  if (!guild) {
    await reply('ini DM, ga bisa kontrol musik disini 😭');
    return;
  }

  switch (command) {
    case 'skip': {
      if (!(await musicPlayer.skipSong(guild.id))) return reply(pick(SKIP_FAIL));
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('⏭️');
      return;
    }
    case 'stop': {
      if (!(await musicPlayer.stopMusic(guild.id))) return reply(pick(STOP_FAIL));
      await waitForVoiceLeave(client, guild.id);
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('⏹️');
      const msg = pick(STOP_SUCCESS);
      return reply(msg);
    }
    case 'pause': {
      if (!(await musicPlayer.pauseMusic(guild.id))) return reply(pick(PAUSE_FAIL));
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('⏸️');
      return;
    }
    case 'resume': {
      if (!(await musicPlayer.resumeMusic(guild.id))) return reply(pick(RESUME_FAIL));
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('▶️');
      return;
    }
    case 'shuffle': {
      const res = await musicPlayer.toggleShuffle(guild.id);
      if (res === null) return reply(pick(SHUFFLE_FAIL_NONE));
      if (res === false) return reply(pick(SHUFFLE_FAIL_LESS));
      await musicPlayer.renderPlayerView(guild.id);
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('🔀');
      return reply(pick(SHUFFLE_SUCCESS));
    }
    case 'queue': {
      // Edit embed player in-place (toggle queue view) alih-alih kirim chat baru.
      const toggled = await musicPlayer.toggleQueueView(guild.id, 0);
      if (!toggled) {
        // Tidak ada embed aktif → fallback teks
        return reply(formatQueueText(musicPlayer.getQueueList(guild.id)) || pick(QUEUE_EMPTY));
      }
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      // Berhasil edit embed, kasih konfirmasi kecil
      await react('📋');
      return;
    }
    case 'np': {
      const q = musicPlayer.getQueueList(guild.id);
      const current = q?.songs?.find(s => s.isCurrent);
      if (!current) return reply(pick(NP_FAIL));
      return reply(`🎵 **${current.name}** (${current.duration})${q.isPaused ? ' ⏸️' : ''}`);
    }
    case 'sfx': {
      if (!sfxStore.hasSfx()) {
        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle('🔊 SFX Belum Dimuat')
          .setDescription('Belum ada file audio SFX yang dimuat nih mas joy 😭\n\nSilakan upload lagu / audio lokal lewat Web Dashboard di menu **Music Player** ➔ **Load SFX**.')
          .setFooter({ text: 'Callista Music • SFX Player' });
        return reply({ embeds: [embed] });
      }

      const res = await musicPlayer.playSfx(member, message.channel);
      if (!res.success) {
        if (res.code === 'NO_VOICE') return reply(pick(PLAY_FAIL_NO_VC));
        return reply(`gagal muter SFX: ${res.error || 'error tidak diketahui'} 😭`);
      }
      return react('🔊');
    }
    case 'lyrics': {
      const q = musicPlayer.getQueueList(guild.id);
      const current = q?.songs?.find(s => s.isCurrent);
      const query = args || current?.name;
      if (!query) return reply('lagu apa yang mau dicari liriknya mas joy? 😭');

      // Ambil lirik dari cache aktif player guild jika tanpa query manual
      let lyrics = !args ? musicPlayer.getGuildLyrics(guild.id) : null;
      if (!lyrics) {
        const artist = args ? '' : (current?.uploader?.name || '');
        lyrics = await lyricsStore.getLyrics(query, artist, current?.duration || 0);
      }
      if (!lyrics) return reply(`lirik untuk **${query}** tidak ditemukan di LRCLIB mas joy 😭`);

      let textContent = '';
      if (lyrics.lines && lyrics.lines.length > 0) {
        textContent = lyrics.lines.map(l => l.text).join('\n');
      } else if (lyrics.plainLyrics) {
        textContent = lyrics.plainLyrics;
      }

      if (!textContent) return reply(`lirik untuk **${query}** kosong mas joy 😭`);

      if (textContent.length > 3900) {
        textContent = textContent.slice(0, 3900) + '\n... (dipotong karena terlalu panjang)';
      }

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🎤 Lirik: ${lyrics.trackName || query}`)
        .setDescription(textContent)
        .setFooter({ text: lyrics.artistName ? `Artis: ${lyrics.artistName} • LRCLIB` : 'LRCLIB' });

      await react('📜');
      return reply({ embeds: [embed] });
    }
    case 'join': {
      let channel = member?.voice?.channel || null;
      if (args) {
        const q = args.replace(/^(?:vc|voice|channel)\s+/i, '').trim();
        if (q && !/^(?:current|vc|voice|channel)$/i.test(q)) {
          channel = voiceUtils.findVoiceChannel(guild, q) || channel;
        }
      }
      if (!channel) return reply(pick(JOIN_FAIL_NOT_IN_VC));

      const current = voiceUtils.getCurrentVoiceChannel(client, guild.id);
      if (current && current.id === channel.id) return reply(voiceUtils.generateAlreadyInMessage(channel));

      if (musicPlayer.isPlaying(guild.id)) {
        await musicPlayer.stopMusic(guild.id);
        await waitForVoiceLeave(client, guild.id);
      }
      try {
        voiceUtils.joinVoice(channel);
        return reply(voiceUtils.generateJoinSuccessMessage(channel, config.timezone));
      } catch (e) {
        return reply(`gagal join VC: ${e.message} 😭`);
      }
    }
    case 'move': {
      if (!args) return reply('pindah ke VC mana, Mas Joy? 😭');
      const targetName = args.replace(/^(?:vc|voice|channel)\s+/i, '').trim();
      const targetChannel = voiceUtils.findVoiceChannel(guild, targetName);
      if (!targetChannel) return reply(MOVE_FAIL_NOT_FOUND(targetName));
      if (musicPlayer.isPlaying(guild.id)) await musicPlayer.stopMusic(guild.id);
      await waitForVoiceLeave(client, guild.id);
      try {
        voiceUtils.joinVoice(targetChannel);
        return reply(`oke, aku pindah ke **${targetChannel.name}** ya Mas Joy 🎵`);
      } catch (e) {
        return reply(`gagal pindah VC: ${e.message} 😭`);
      }
    }
    case 'leave': {
      const stopped = await musicPlayer.stopMusic(guild.id);
      const left = voiceUtils.leaveVoice(guild.id, client.user.id);
      if (stopped || left) await waitForVoiceLeave(client, guild.id);
      return reply((stopped || left) ? pick(LEAVE_VARIANTS) : pick(LEAVE_FAIL));
    }
    case 'play': {
      const isBare = Boolean(bare || !args || musicCommands.parseBarePlayRequest(args).bare);
      const shouldShuffle = Boolean(shuffle || (args && musicCommands.parseBarePlayRequest(args).shuffle));

      if (isBare) {
        // 1. Cek riwayat putar terlebih dahulu
        const historySongs = playbackHistoryStore.getHistorySongs();
        if (historySongs.length > 0) {
          const res = await musicPlayer.playPlaylist(member, message.channel, {
            id: 'playback_history',
            name: 'Riwayat Putar',
            songs: historySongs,
          });
          if (!res.success) {
            return reply(pick(PLAYLIST_FAIL_NO_VC));
          }

          await react('🎵');
          if (shouldShuffle) {
            await sleep(800);
            await musicPlayer.toggleShuffle(guild.id);
            return reply(`oke, muter riwayat putar (${historySongs.length} lagu, di-shuffle 🎲) ya Mas Joy 🎵`);
          }
          return reply(`oke, muter riwayat putar (${historySongs.length} lagu) ya Mas Joy 🎵`);
        }

        // 2. Fallback jika riwayat masih kosong: putar playlist tersimpan
        const allPlaylists = musicStore.loadPlaylists().playlists || [];
        const remotes = allPlaylists.filter(p => !musicStore.isLocalPlaylist(p) && p.url);
        let chosen = null;
        if (remotes.length > 0) {
          chosen = remotes[Math.floor(Math.random() * remotes.length)];
        } else {
          const localsWithSongs = allPlaylists.filter(p => musicStore.isLocalPlaylist(p) && p.songs && p.songs.length > 0);
          if (localsWithSongs.length > 0) {
            chosen = localsWithSongs[Math.floor(Math.random() * localsWithSongs.length)];
          }
        }

        if (!chosen) {
          return reply('belum ada playlist tersimpan mas joy 😭 simpan dulu di dashboard atau bikin playlist lokal: `>create <nama>`');
        }

        const res = await musicPlayer.playPlaylist(member, message.channel, chosen);
        if (!res.success) {
          if (res.code === 'EMPTY_PLAYLIST') return reply(PLAYLIST_EMPTY(chosen.name));
          return reply(pick(PLAYLIST_FAIL_NO_VC));
        }

        await react('🎵');
        if (shouldShuffle) {
          await sleep(800);
          await musicPlayer.toggleShuffle(guild.id);
          return reply(`oke, muter playlist **${chosen.name}** (di-shuffle 🎲) ya Mas Joy 🎵`);
        }
        return reply(`oke, muter playlist **${chosen.name}** ya Mas Joy 🎵`);
      }

      const { title, withLoop } = musicCommands.parsePlayLoopSuffix(args);
      if (!title) return reply(pick(PLAY_FAIL_NO_ARGS));
      const urlMatch = title.match(/(?:https?:\/\/|spotify:)[^\s<>]+/i);
      const queryToPlay = urlMatch ? urlMatch[0] : title;
      const res = await musicPlayer.playSong(member, message.channel, queryToPlay);
      if (!res.success) return reply(pick(PLAY_FAIL_NO_VC));
      if (withLoop) {
        // Tunggu queue settle lalu set loop
        await new Promise(r => setTimeout(r, 500));
        await musicPlayer.setRepeatMode(guild.id, 1);
      }
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      return react('▶️');
    }
    case 'playlist': {
      if (!args) return reply('playlist-nya apa mas joy? 😭');

      // Cek apakah args memuat URL (mis. Spotify / YouTube playlist link)
      const urlMatch = args.match(/(?:https?:\/\/|spotify:)[^\s<>]+/i);
      if (urlMatch) {
        const cleanUrl = urlMatch[0];
        const res = await musicPlayer.playPlaylist(member, message.channel, cleanUrl);
        if (!res.success) {
          if (res.code === 'EMPTY_PLAYLIST') return reply('playlist kosong atau tidak bisa dimuat mas joy 😭');
          return reply(pick(PLAYLIST_FAIL_NO_VC));
        }
        await react('🎵');
        return reply(`oke, muter playlist dari link tersebut ya Mas Joy 🎵`);
      }

      let pl = musicStore.findPlaylistByName(args);
      if (!pl && isFavoritesName(args)) pl = musicStore.ensureFavoritesPlaylist();
      if (!pl) return reply(PLAYLIST_NOT_FOUND(args));

      const isCurrentlyPlaying = musicPlayer.isPlaying(guild.id);
      const res = await musicPlayer.playPlaylist(member, message.channel, pl);
      if (!res.success) {
        if (res.code === 'EMPTY_PLAYLIST') return reply(PLAYLIST_EMPTY(pl.name));
        return reply(pick(PLAYLIST_FAIL_NO_VC));
      }
      await react('🎵');

      if (isCurrentlyPlaying) {
        musicPlayer.setPendingPlaylistSwitch(guild.id, pl);
        await musicPlayer.renderPlayerView(guild.id);
        return reply(`oke, playlist **${pl.name}** dimasukkan ke antrian. Atau klik tombol **[Play "${pl.name}" Now]** di player untuk langsung ganti sekarang! 🎵`);
      }

      return reply(`oke, muter playlist **${pl.name}** ya Mas Joy 🎵`);
    }
    case 'back': {
      // Kembali ke VC Mas Joy saat ini (atau VC tempat bot sudah berada).
      let channel = member?.voice?.channel || null;
      if (!channel) return reply(pick(BACK_FAIL_NO_VC));
      const current = voiceUtils.getCurrentVoiceChannel(client, guild.id);
      if (current && current.id === channel.id) return reply(pick(BACK_ALREADY));
      if (musicPlayer.isPlaying(guild.id)) await musicPlayer.stopMusic(guild.id);
      await waitForVoiceLeave(client, guild.id);
      try {
        voiceUtils.joinVoice(channel);
        return reply(`oke, aku balik ke **${channel.name}** ya Mas Joy 🎵`);
      } catch (e) {
        return reply(`gagal balik ke VC: ${e.message} 😭`);
      }
    }
    case 'loop': {
      const ok = await musicPlayer.setRepeatMode(guild.id, 1); // 1 = repeat song
      if (!ok) return reply(pick(LOOP_FAIL));
      await musicPlayer.renderPlayerView(guild.id);
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('🔂');
      return reply(pick(LOOP_SUCCESS));
    }
    case 'unloop': {
      const ok = await musicPlayer.setRepeatMode(guild.id, 0); // 0 = off
      if (!ok) return reply(pick(UNLOOP_FAIL));
      await musicPlayer.renderPlayerView(guild.id);
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('▶️');
      return reply(pick(UNLOOP_SUCCESS));
    }
    case 'help':
      return reply({ embeds: [buildHelpEmbed()] });
    case 'player': {
      const result = await musicPlayer.refreshPlayer(guild.id, message.channel);
      if (!result.success) {
        if (result.code === 'NO_QUEUE') return reply('ga ada musik yang lagi diputar mas joy 😭');
        return reply('gagal refresh player nih, coba lagi ya 😭');
      }
      if (source === 'prefix') {
        await safeDeleteCommandMessage();
        return;
      }
      await react('🎵');
      return;
    }
    default:
      return;
  }
}

/**
 * Tambah lagu ke playlist lokal / bikin playlist lokal.
 * Tidak memutar apa pun.
 */
async function handleLibraryCommand({ client, message, member, isJoy, allowed, config, lib }) {
  const rawReply = makeCommandReply(client, message, config);
  const reply = async (text) => rawReply(isJoy ? formatReply(text, true) : formatReply(text, false));
  const guild = message.guild;

  if (!allowed) {
    // Prefix dari user lain dianggap quote/chat biasa: jangan berisik.
    if (lib.source === 'natural') await reply(musicPlayer.generateRejectReason());
    else console.log('[LIB] ignored (not Mas Joy)');
    return false;
  }

  if (!guild) {
    await reply('ini DM, ga bisa ngatur playlist disini 😭');
    return false;
  }

  if (lib.command === 'info') {
    let plName = lib.name;
    // Dinamis: jika parse gagal atau kosong, scan pesan untuk nama playlist apa pun.
    if (!plName || !musicStore.findLocalPlaylistByName(plName)) {
      const dynamicName = musicStore.findPlaylistMentionInText ? musicStore.findPlaylistMentionInText(message.content) : null;
      if (dynamicName) plName = dynamicName;
    }
    const pl = musicStore.findLocalPlaylistByName(plName) || (plName && isFavoritesName(plName) ? musicStore.ensureFavoritesPlaylist() : null);
    if (!pl) {
      await reply(LIB_INFO_NOT_FOUND(plName || lib.name));
      return false;
    }
    const songs = pl.songs || [];
    if (!songs.length) {
      await reply(LIB_INFO_EMPTY(pl.name));
      return false;
    }
    const list = songs.map((s, i) => `${i + 1}. ${s.title || s.url}`).join('\n');
    await reply(`isi **${pl.name}** (${songs.length} lagu):\n${list}`);
    return true;
  }

  if (lib.command === 'delete') {
    let targetName = lib.name;
    if (!targetName || isFavoritesName(targetName)) targetName = 'Favorit';
    const target = musicStore.findLocalPlaylistByName(targetName) || musicStore.ensureFavoritesPlaylist();
    if (!target) {
      await reply(`ga nemu playlist \"${targetName}\" buat dihapus 😭`);
      return false;
    }
    const current = musicPlayer.getQueueList(guild.id)?.songs?.find(s => s.isCurrent);
    if (current && !lib.name) {
      target.songs = (target.songs || []).filter(s => s.id !== current.id);
      musicStore.savePlaylists();
      await reply(`udah gue hapus lagu \"${current.title || current.url}\" dari **${target.name}** ya Mas Joy`);
      return true;
    }
    const titleQuery = lib.name?.toLowerCase() || '';
    if (!titleQuery) {
      await reply('nama lagu yang mau ghisi? contoh: \`>delete fur elise >>Favorit\`');
      return false;
    }
    const beforeCount = (target.songs || []).length;
    const removed = musicStore.removeSongsFromPlaylist(target, (s) =>
      String(s.title || s.url).toLowerCase().includes(titleQuery)
    );
    if (!removed.length) {
      await reply(`lagu \"${lib.name}\" gak ada di **${target.name}** 😭`);
      return false;
    }
    musicStore.savePlaylists();
    await reply(`gue hapusin **${target.name}**: ${removed.map(s => s.title || s.url).join(', ')}`);
    return true;
  }

  if (lib.command === 'create') {
    const created = musicStore.createLocalPlaylist(lib.name);
    if (created.success) {
      await reply(`oke, playlist lokal **${created.playlist.name}** udah dibikin. Masih kosong, tinggal tambahin lagu pake \`>add <link> >>${created.playlist.name}\``);
      return true;
    }
    if (created.playlist && musicStore.isLocalPlaylist(created.playlist)) {
      await reply(LIB_CREATE_EXISTS(created.playlist.name));
    } else if (created.playlist) {
      await reply(LIB_CREATE_REMOTE(created.playlist.name));
    } else {
      await reply(LIB_CREATE_FAIL(created.error));
    }
    return false;
  }

  if (lib.command !== 'add') return false;

  let urls = Array.isArray(lib.urls) ? [...lib.urls] : [];
  if (lib.currentSong) {
    const current = musicPlayer.getQueueList(guild.id)?.songs?.find(s => s.isCurrent);
    if (!current?.url) {
      await reply(pick(LIB_ADD_NO_CURRENT));
      return false;
    }
    urls = [current.url];
  }

  const validUrls = urls.filter(url => musicPlayer.isVideoUrl(url));
  const invalidCount = urls.length - validUrls.length;
  if (!validUrls.length) {
    await reply(pick(LIB_ADD_NO_URL));
    return false;
  }

  let target = lib.target ? musicStore.findLocalPlaylistByName(lib.target) : null;
  if (!target && lib.target && isFavoritesName(lib.target)) {
    target = musicStore.ensureFavoritesPlaylist();
  }

  if (!target) {
    if (lib.target) {
      const remote = musicStore.findRemotePlaylistByName(lib.target);
      if (remote) {
        await reply(LIB_ADD_REMOTE(lib.target));
        return false;
      }
    }

    let locals = musicStore.listLocalPlaylists();
    if (!locals.length) {
      musicStore.ensureFavoritesPlaylist();
      locals = musicStore.listLocalPlaylists();
    }
    const key = pendingAddKey(message.channelId, message.author.id);
    const existing = pendingSongAdds.get(key);
    const merged = existing && Date.now() - existing.at < PENDING_ADD_TTL_MS
      ? [...new Set([...existing.urls, ...validUrls])]
      : validUrls;
    pendingSongAdds.set(key, { urls: merged, at: Date.now() });
    const options = locals.map(p => `- **${p.name}** (${p.songs?.length || 0} lagu)`).join('\n');
    await reply(LIB_ADD_NO_TARGET(options));
    return false;
  }

  // Metadata dari hasil pencarian dipakai langsung; kalau tidak ada, resolve satu per satu.
  const hints = new Map();
  if (Array.isArray(lib.songInfos)) {
    for (const info of lib.songInfos) {
      if (info && info.url) hints.set(info.url, info);
    }
  }

  const songs = [];
  for (const url of validUrls) {
    const hint = hints.get(url);
    if (hint) {
      songs.push({
        id: hint.id || musicPlayer.videoId(url) || url,
        title: hint.title || null,
        url,
        duration: hint.duration || 0,
      });
      continue;
    }

    let info = null;
    try {
      info = await musicPlayer.resolveSongInfo(url);
    } catch (e) {
      console.warn(`[LIB] Gagal resolve "${url}": ${e.message}`);
    }
    songs.push({
      id: info?.id || musicPlayer.videoId(url) || url,
      title: info?.name || null,
      url,
      duration: info?.duration || 0,
    });
  }

  const added = musicStore.addSongsToPlaylist(target.id, songs);
  if (!added.success) {
    await reply(`gagal nyimpen: ${added.error}`);
    return false;
  }

  const total = added.playlist.songs.length;
  let msg;
  if (added.added === 0 && added.duplicate > 0) {
    msg = LIB_ADD_DUPLICATE(added.playlist.name, total);
  } else {
    msg = LIB_ADD_SUCCESS(added.playlist.name, added.added, added.duplicate, total);
  }
  if (invalidCount) msg += `\n${invalidCount} link dilewati (bukan video YouTube)`;

  console.log(`[LIB] ${added.added} lagu masuk "${added.playlist.name}" (total ${total})`);
  await reply(msg);
  return true;
}

/**
 * Cari lagu lewat TinyFish (deterministik, tanpa AI).
 * Hasil disimpan per channel+user supaya bisa dipilih "nomor 1".
 */
async function handleSearchCommand({ client, message, isJoy, allowed, config, query, source }) {
  const reply = makeCommandReply(client, message, config);

  if (!allowed) {
    // Prefix dari user lain dianggap quote/chat biasa: jangan berisik.
    if (source === 'natural') await reply(musicPlayer.generateRejectReason());
    else console.log('[SEARCH] ignored (not Mas Joy)');
    return;
  }

  if (!query) {
    await reply('cari lagu apa mas joy? contoh: `>sc unethical faouzia`');
    return;
  }

  try {
    const found = await tinyfishSearch.searchYouTube(query, { limit: 10 });
    if (!found.results.length) {
      await reply(`ga nemu hasil buat "${query}" di YouTube 😭 coba kata kunci lain.`);
      return;
    }

    const embed = tinyfishSearch.buildSearchEmbed(found.query, found.results, { page: 0, isHidden: false });
    const components = tinyfishSearch.buildSearchComponents(message.author.id, found.results, { page: 0, isHidden: false });

    console.log(`[SEARCH] "${query}" -> ${found.results.length} hasil`);
    const sent = await message.reply({
      embeds: [embed],
      components,
      allowedMentions: { repliedUser: false },
    });

    tinyfishSearch.saveSearch(message.channelId, message.author.id, {
      ...found,
      messageId: sent.id,
    });

    storage.addHistory(message.channelId, {
      id: sent.id,
      channelId: message.channelId,
      userId: client.user.id,
      authorName: config.name || 'Callista',
      content: `[search: ${found.query}] ${found.results.length} hasil`,
      timestamp: sent.createdTimestamp,
      isBot: true,
    });
    storage.setFocus(message.channelId, message.author.id, config.conversationFocus);
  } catch (e) {
    console.error('[SEARCH ERROR]', e.message);
    await reply(`uhh gagal nyari di YouTube: ${e.message} 😭`);
  }
}

/**
 * Pilih hasil pencarian: putar, atau simpan ke playlist lokal.
 * Cuma jalan kalau user itu punya hasil pencarian aktif.
 */
async function handleSearchPick({ client, message, member, isJoy, allowed, config, pick, search: providedSearch }) {
  const reply = makeCommandReply(client, message, config);

  if (!allowed) return false;

  const search = providedSearch
    || (message.reference?.messageId ? tinyfishSearch.getSearchByMessageId(message.reference.messageId) : null)
    || tinyfishSearch.getSearch(message.channelId, message.author.id);
  if (!search) return false;

  const item = search.results.find(r => r.position === pick.index) || search.results[pick.index - 1];
  if (!item) {
    await reply(`hasil pencarian cuma ada ${search.results.length}. Pilih nomor 1-${search.results.length} ya.`);
    return true;
  }

  if (pick.play && !pick.target) {
    try {
      const res = await musicPlayer.playSong(member, message.channel, item.url);
      if (!res.success) {
        await reply('mas joy masuk VC dulu, atau suruh gue join dulu 😭');
        return true;
      }
      await message.react('▶️').catch(() => {});
      if (pick.withLoop) {
        await new Promise(r => setTimeout(r, 500));
        await musicPlayer.setRepeatMode(message.guild.id, 1);
      }
      await reply(`oke, muter **${item.title}**${pick.withLoop ? ' (di-loop 🔂)' : ''} 🎵`);
    } catch (e) {
      console.error('[SEARCH PLAY ERROR]', e.message);
      await reply(`uhh gagal muter: ${e.message} 😭`);
    }
    return true;
  }

  await handleLibraryCommand({
    client, message, member, isJoy, allowed, config,
    lib: {
      command: 'add',
      urls: [item.url],
      target: pick.target,
      currentSong: false,
      songInfos: [{ id: item.id, title: item.title, url: item.url, duration: 0 }],
      source: 'search',
    },
  });
  // Hapus cache pencarian setelah user pick (baik play maupun save)
  tinyfishSearch.clearSearch(message.channelId, message.author.id);
  return true;
}

/**
 * `>permit @user` / `>unpermit @user` / `>permit` (daftar).
 * Hanya Mas Joy yang boleh mengubah daftar izin — pemegang izin pun tidak bisa
 * menambahkan orang lain.
 */
async function handlePermitCommand({ client, message, config, isJoy, permitCmd }) {
  const reply = makeCommandReply(client, message, config);

  if (!isJoy) {
    await reply(musicPlayer.generateRejectReason());
    return;
  }

  if (permitCmd.action === 'list') {
    const users = permissionStore.list();
    if (!users.length) {
      await reply('belum ada yang aku izinin nyuruh-nyuruh. contoh: `>permit @user`');
      return;
    }
    const lines = users.map((u) => `- **${u.name || u.id}** (${u.id})`).join('\n');
    await reply(`yang boleh nyuruh aku sekarang:\n${lines}\n\nCabut izin: \`>unpermit @user\``);
    return;
  }

  if (permitCmd.action === 'revoke') {
    if (!permitCmd.ids.length) {
      await reply('cabut izin siapa? contoh: `>unpermit @user`');
      return;
    }
    const removed = [];
    for (const id of permitCmd.ids) {
      const user = message.mentions.users.get(id);
      if (permissionStore.revoke(id)) removed.push(user?.username || id);
    }
    await reply(removed.length
      ? `oke, ${removed.join(', ')} udah nggak boleh nyuruh aku lagi`
      : 'ga ada yang perlu dicabut, mereka belum diizinin kok');
    return;
  }

  const granted = [];
  for (const id of permitCmd.ids) {
    const user = message.mentions.users.get(id);
    const name = user?.displayName || user?.globalName || user?.username || id;
    if (permissionStore.grant(id, name, message.author.id)) granted.push(name);
  }
  console.log(`[PERMIT] ${message.author.id} mengizinkan: ${granted.join(', ')}`);
  await reply(granted.length
    ? `oke, ${granted.join(', ')} sekarang boleh pakai perintah aku (musik, playlist, cari lagu, voice juga)`
    : 'tag orangnya dong, contoh: `>permit @user`');
}

/**
 * `>pl-rm <link playlist youtube> >>Nama` — simpan playlist YouTube remote
 * dengan nama custom. Playlist remote cuma bisa diputar, nggak bisa ditambahin lagu.
 */
async function handleRemotePlaylistCommand({ client, message, isJoy, allowed, config, remote }) {
  const reply = makeCommandReply(client, message, config);

  if (!allowed) {
    await reply(musicPlayer.generateRejectReason());
    return;
  }

  const playlistId = youtubePlaylist.extractPlaylistId(remote.url);
  if (!playlistId) {
    await reply('itu bukan link playlist youtube. contoh: `>pl-rm https://www.youtube.com/playlist?list=PLxxxx >>Harutya`');
    return;
  }
  if (!remote.name) {
    await reply('kasih namanya dong, contoh: `>pl-rm <link> >>Harutya`');
    return;
  }

  const url = `https://www.youtube.com/playlist?list=${playlistId}`;
  const result = musicStore.createRemotePlaylist(remote.name, url, {
    addedBy: isJoy ? 'Mas Joy' : message.author.username,
  });

  if (!result.success) {
    if (result.playlist) {
      await reply(`nama "${remote.name}" udah dipakai playlist lain, pilih nama lain ya`);
    } else {
      await reply(result.error || 'gagal nyimpen playlist');
    }
    return;
  }

  console.log(`[PLAYLIST] remote "${result.playlist.name}" -> ${url}`);
  await reply(`oke, playlist remote **${result.playlist.name}** kesimpen. tinggal bilang "cal, puter ${result.playlist.name}"`);
}

function formatPlayTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * `>jump <menit>` — lompat ke menit tertentu di lagu yang sedang diputar.
 * Contoh: `>jump 5` = 5:00, `>jump 1.5` = 1:30.
 */
async function handleJumpCommand({ client, message, isJoy, allowed, config, jump }) {
  const reply = makeCommandReply(client, message, config);

  if (!allowed) {
    await reply(musicPlayer.generateRejectReason());
    return;
  }
  if (jump.minutes == null) {
    await reply('lompat ke menit berapa? contoh: `>jump 5`');
    return;
  }

  const seconds = Math.round(jump.minutes * 60);
  const result = await musicPlayer.seekMusic(message.guildId, seconds);

  if (result.success) {
    try {
      if (message && typeof message.delete === 'function') {
        await message.delete().catch(() => {});
      }
    } catch (_) {}
    return;
  } else if (result.code === 'NO_QUEUE' || result.code === 'NO_SONG') {
    await reply('ga ada musik yang lagi diputar sekarang');
  } else if (result.code === 'NO_DURATION') {
    await reply('durasi lagu ini ga diketahui, jadi ga bisa lompat ke menit tertentu');
  } else if (result.code === 'BEYOND_DURATION') {
    await reply(`lagunya cuma ${formatPlayTime(result.duration)}, ga bisa lompat ke ${formatPlayTime(seconds)}`);
  } else {
    await reply('gagal lompat, coba lagi ya');
  }
}

async function processBurst(channelId, client) {
  const burst = activeBursts.get(channelId);
  if (!burst) return;
  activeBursts.delete(channelId);

  const { userId, authorName, channelLabel, messages, lastDiscordMessage, hasTrigger } = burst;

  for (const m of messages) {
    processedMessageIds.add(m.id);
  }
  if (processedMessageIds.size > 2000) {
    const arr = Array.from(processedMessageIds);
    arr.slice(0, 1000).forEach(id => processedMessageIds.delete(id));
  }

  if (!hasTrigger) {
    console.log(`[BURST] Settled ${messages.length} message(s) from [${authorName}] in [${channelLabel}] -> No Callista trigger, skipping AI.`);
    return;
  }

  const config = storage.getConfig();
  const botState = storage.getBotState();
  const lastMsg = messages[messages.length - 1];

  // A. Jika bot sedang mati dan ini BUKAN trigger unmute dari Mas Joy: skip eksekusi
  const isMasJoy = userId === '833196669940138004' || (authorName && authorName.toLowerCase() === 'rieka');
  const isUnmute = isMasJoy && decision.isUnmuteCommand(lastMsg.content);

  if (!botState.isResponding && !isUnmute) {
    console.log(`[BURST] Callista dalam status SILENCED / MATI. Skipping execution.`);
    return;
  }

  // B. Mas Joy memberikan instruksi untuk nimbrung kembali (Unmute Command)
  if (isUnmute) {
    storage.setBotResponding(true, 'Diaktifkan kembali oleh Mas Joy via Discord');
    const moodScore = storage.getMood();

    const rawUnmute = moodScore < 45
      ? 'huhu makasih Mas Joy, kirain kamu marah beneran sama aku T_T kangen nimbrung'
      : 'yesss akhirnya boleh ngomong lagi Mas Joy wkwk, kangen nimbrung 😭';
    const unmuteReply = naturalTyping.humanizeTyping(rawUnmute);

    if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
    await sleep(600);
    console.log(`[OUTPUT] [${channelLabel}] Respon aktivasi dari Mas Joy (Mood: ${moodScore}): "${unmuteReply}"`);
    const sentMsg = await lastDiscordMessage.reply({ content: unmuteReply, allowedMentions: { repliedUser: false } });
    storage.addHistory(channelId, {
      id: sentMsg.id,
      channelId,
      userId: client.user.id,
      authorName: config.name || 'Callista',
      content: unmuteReply,
      timestamp: sentMsg.createdTimestamp,
      isBot: true
    });
    storage.setFocus(channelId, userId, config.conversationFocus || 60);
    return;
  }

  // C. Mas Joy memberikan instruksi untuk diam (Silence Command)
  const isSilence = isMasJoy && decision.isSilenceCommand(lastMsg.content);
  if (isSilence) {
    const moodScore = storage.getMood();

    const silenceReply = moodScore < 45
      ? 'MAS JOY JUJUR AKU SALAH APA YA T_T'
      : 'iya Mas Joy, aku diem dulu ya 😭';

    if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
    await sleep(600);
    console.log(`[OUTPUT] [${channelLabel}] Respon disuruh diam (Mood: ${moodScore}): "${silenceReply}"`);
    const sentMsg = await lastDiscordMessage.reply({ content: silenceReply, allowedMentions: { repliedUser: false } });
    storage.addHistory(channelId, {
      id: sentMsg.id,
      channelId,
      userId: client.user.id,
      authorName: config.name || 'Callista',
      content: silenceReply,
      timestamp: sentMsg.createdTimestamp,
      isBot: true
    });

    storage.setBotResponding(false, 'Disuruh diam oleh Mas Joy');
    storage.clearFocus(channelId);
    console.log(`[BOT STATE] Callista berhasil dinonaktifkan oleh Mas Joy. Sekarang masuk mode MURNI TIDAK NYAUT.`);
    return;
  }

  // 1. HARD FILTER: Cek apakah pesan secara spesifik ditujukan ke orang lain
  if (decision.isAddressedToSomeoneElse(lastMsg, config)) {
    console.log(`[CHECK] [${channelLabel}] Addressed specifically to another user -> SILENCE & focus cleared.`);
    storage.clearFocus(channelId);
    return;
  }

  console.log(`[BURST] Processing settled burst (${messages.length} message${messages.length > 1 ? 's' : ''}) from [${authorName}] in [${channelLabel}]`);

  const history = storage.getHistory(channelId);
  const userProfile = storage.getUserMemory(userId, authorName);

  // 2. SOFT FILTER: Tanya AI basis API key (tidak masuk obrolan) untuk memahami kalimat
  // apakah sedang berbicara DENGAN Callista, MEMBICARAKAN Callista, atau BICARA KE ORANG LAIN
  console.log(`[SOFT FILTER] Analyzing conversation intent with AI...`);
  const classification = await ai.classifyConversationIntent(history, messages, config);
  console.log(`[SOFT FILTER] Target: [${classification.target}] | SensitiveExistence: [${classification.isSensitiveExistence}] | Reason: "${classification.reason}"`);

  // Skenario A: Lawan bicara sedang berbicara ke orang lain (misal panggil Put, Budi, dll)
  if (classification.target === 'TO_OTHER') {
    console.log(`[OUTPUT] [${channelLabel}] SILENCE (Speaker is addressing someone else, clearing focus)`);
    storage.clearFocus(channelId);
    return;
  }

  // Skenario B: Obrolan TENTANG Callista (hanya membicarakannya sebagai orang ketiga)
  if (classification.target === 'ABOUT_CALLISTA') {
    if (!classification.isSensitiveExistence) {
      // Tidak sensitif -> Callista tidak kepedean, tetap diam (SILENCE)
      console.log(`[OUTPUT] [${channelLabel}] SILENCE (Talking about Callista without sensitive trigger, remaining silent)`);
      return;
    }

    // SKENARIO 1: Sensitif (meragukan eksistensinya / dibilang bot / hal jelek) -> Menyerobot protokol!
    console.log(`[PROTOCOL BREACH] [${channelLabel}] Skenario 1: Sensitive existence detected -> Callista interrupts without reply!`);
    const clarifyResult = await ai.generateClarificationResponse(history, messages, userProfile);
    if (!clarifyResult || !clarifyResult.messages || clarifyResult.messages.length === 0) {
      console.log(`[OUTPUT] [${channelLabel}] No clarification generated.`);
      return;
    }

    const rawClarify = clarifyResult.messages[0];
    const clarifyText = naturalTyping.humanizeTyping(rawClarify);
    if (lastDiscordMessage.channel.sendTyping) {
      await lastDiscordMessage.channel.sendTyping();
    }
    await sleep(600);

    // Di-sela TANPA reply siapapun (kirim biasa ke channel)
    console.log(`[OUTPUT] [${channelLabel}] Sela tanpa reply (SKENARIO 1): "${clarifyText}"`);
    const sentMsg = await lastDiscordMessage.channel.send(clarifyText);

    storage.addHistory(channelId, {
      id: sentMsg.id,
      channelId,
      userId: client.user.id,
      authorName: config.name || 'Callista',
      content: clarifyText,
      timestamp: sentMsg.createdTimestamp,
      isBot: true
    });

    // PENTING: JANGAN set conversation focus! Supaya kalau orang lain lanjut ngobrol sesama mereka, Callista tidak ikut campur lagi.
    return;
  }

  // SKENARIO 2: Berbicara DENGAN Callista (TO_CALLISTA) -> Jawab pertanyaan sesuai kepribadian
  const dailyInfo = dailyStore.getCurrentActivityInfo(dailyStore.loadDailyContext(config.timezone));
  console.log(`[DAILY CONTEXT] Status: [${dailyInfo.availability.toUpperCase()}] | Activity: "${dailyInfo.current_activity}" (Time: ${dailyInfo.time})`);

  // Cek apakah Callista sedang di dalam jam perkuliahan di kelas (Acuan Mutlak dari collage_roadmap.json)
  const classStatus = collegeRoadmap.getCurrentClassSession(new Date(), config.timezone);
  if (classStatus.inClass && classStatus.session) {
    const session = classStatus.session;
    const authorId = lastDiscordMessage.author.id;
    const authorName = lastDiscordMessage.author.displayName || lastDiscordMessage.author.username;

    // 1. Tampung pesan ke antrian sesi kelas (maksimal 10 pesan terakhir)
    classSessionManager.enqueueMessage(session.sessionKey, session, {
      channelId,
      userId: authorId,
      username: authorName,
      content: lastMsg.content,
      timestamp: Date.now(),
    });

    // 2. Kirim 1 template pemberitahuan jika user belum diberi tahu di sesi kelas ini
    if (!classSessionManager.hasBeenNotified(session.sessionKey, authorId)) {
      const template = collegeRoadmap.getRandomClassTemplate(session.courseName);
      const replyText = naturalTyping.humanizeTyping(template);
      console.log(`[CLASS_MODE] [${channelLabel}] User ${authorName} menyapa saat kelas "${session.courseName}". Mengirim template sibuk: "${replyText}"`);

      if (lastDiscordMessage.channel.sendTyping) {
        await lastDiscordMessage.channel.sendTyping().catch(() => {});
      }
      await sleep(500);
      const sentMsg = await lastDiscordMessage.reply({ content: replyText, allowedMentions: { repliedUser: false } }).catch(() => {});
      if (sentMsg) {
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: replyText,
          timestamp: sentMsg.createdTimestamp,
          isBot: true,
        });
      }

      classSessionManager.markNotified(session.sessionKey, authorId);
    } else {
      console.log(`[CLASS_MODE] [${channelLabel}] User ${authorName} mengirim pesan lagi saat kelas "${session.courseName}". Ditampung ke antrian pending tanpa spam template.`);
    }

    // Callista sedang di dalam kelas: tidak panggil LLM saat ini
    return;
  }

  console.log(`[AI] Evaluating conversation context & generating response...`);
  const result = await ai.evaluateAndGenerate(history, messages, userProfile, {
    guild: lastDiscordMessage.guild,
    client
  });

  if (!result) {
    console.log(`[AI ERROR] Failed to get response from LLM.`);
    return;
  }

  console.log(`[AI DECISION] Intent: ${result.intent} | Format: ${result.format} | ShouldReply: ${result.shouldReply} | Reason: "${result.reason || '-'}"`);

  // AI GUARD: perintah kontrol dasar jangan sampai diproses jadi PLAY_* dan replay playlist.
  if (result.format === 'PLAY_PLAYLIST' || result.format === 'PLAY_SONG') {
    const forced = musicCommands.detectControlVerb(lastMsg.content);
    const forcedFormat = forced ? musicCommands.CONTROL_FORMATS[forced] : null;
    if (forcedFormat) {
      console.log(`[AI GUARD] ${result.format} -> ${forcedFormat} (perintah kontrol "${forced}")`);
      result.format = forcedFormat;
      result.musicQuery = '';
    }
  }

  if (!result.shouldReply || result.format === 'SILENCE') {
    console.log(`[OUTPUT] [${channelLabel}] SILENCE (Callista remains silent)`);
    return;
  }

  try {
    // GIF_ONLY: Kirim hanya GIF reaksi tanpa teks
    if (result.format === 'GIF_ONLY' && result.gifExpression) {
      const gif = await gifSearch.searchRandomGif(result.gifExpression, 5);
      if (!gif) {
        console.log(`[OUTPUT] [${channelLabel}] GIF_ONLY: Tidak ada GIF untuk ekspresi "${result.gifExpression}". Fallback ke SILENCE.`);
        return;
      }
      console.log(`[OUTPUT] [${channelLabel}] Sending GIF (expression: ${result.gifExpression}, keyword: "${gif.keyword}"): ${gif.url}`);
      if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
      await sleep(500);
      const sentMsg = await lastDiscordMessage.reply({ content: gif.url, allowedMentions: { repliedUser: false } });
      storage.addHistory(channelId, {
        id: sentMsg.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: `[gif: ${result.gifExpression}] ${gif.url}`,
        timestamp: sentMsg.createdTimestamp,
        isBot: true
      });
      storage.setFocus(channelId, userId, config.conversationFocus);
      return;
    }

    // CHANNEL_LIST: Kirim daftar channel di server
    if (result.format === 'CHANNEL_LIST') {
      const guild = lastDiscordMessage.guild;
      if (!guild) {
        console.log(`[OUTPUT] [${channelLabel}] CHANNEL_LIST: Bukan di server (DM).`);
        return;
      }
      const filter = result.channelFilter || 'text';
      let filterType = null;
      if (filter === 'text') filterType = 0;
      else if (filter === 'voice') filterType = 2;
      else if (filter === 'category') filterType = 4;
      // 'all' = null (no filter)

      const listText = channelUtils.formatChannelList(guild, {
        includeVoice: filter !== 'text',
        includeCategories: filter !== 'text' && filter !== 'voice',
        filterType,
        maxChannels: 50,
      });

      if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
      await sleep(400);
      const sentMsg = await lastDiscordMessage.reply({ content: listText, allowedMentions: { repliedUser: false } });
      storage.addHistory(channelId, {
        id: sentMsg.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: `[channel list: ${filter}] ${listText.substring(0, 200)}...`,
        timestamp: sentMsg.createdTimestamp,
        isBot: true
      });
      storage.setFocus(channelId, userId, config.conversationFocus);
      return;
    }

    // CHANNEL_INFO: Kirim info detail 1 channel
    if (result.format === 'CHANNEL_INFO' && result.channelQuery) {
      const guild = lastDiscordMessage.guild;
      if (!guild) {
        console.log(`[OUTPUT] [${channelLabel}] CHANNEL_INFO: Bukan di server (DM).`);
        return;
      }
      const channel = channelUtils.findChannelByNameOrId(guild, result.channelQuery);
      if (!channel) {
        console.log(`[OUTPUT] [${channelLabel}] CHANNEL_INFO: Channel "${result.channelQuery}" tidak ditemukan.`);
        const notFoundMsg = await lastDiscordMessage.reply({
          content: `🔍 Channel "${result.channelQuery}" gak ketemu di server ini.`,
          allowedMentions: { repliedUser: false }
        });
        storage.addHistory(channelId, {
          id: notFoundMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: `Channel "${result.channelQuery}" tidak ditemukan.`,
          timestamp: notFoundMsg.createdTimestamp,
          isBot: true
        });
        return;
      }

      const infoText = channelUtils.getChannelInfo(channel);

      if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
      await sleep(400);
      const sentMsg = await lastDiscordMessage.reply({ content: infoText, allowedMentions: { repliedUser: false } });
      storage.addHistory(channelId, {
        id: sentMsg.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: `[channel info: ${channel.name}] ${infoText.substring(0, 200)}...`,
        timestamp: sentMsg.createdTimestamp,
        isBot: true
      });
      storage.setFocus(channelId, userId, config.conversationFocus);
      return;
    }

    // JOIN_VOICE: Join voice channel (HANYA untuk Mas Joy)
    if (result.format === 'JOIN_VOICE') {
      const guild = lastDiscordMessage.guild;
      const timezone = config.timezone || 'Asia/Jakarta';

      // SAFETY CHECK: Hanya Mas Joy (atau user yang di-`>permit`) yang bisa menyuruh join VC
      const isJoy = voiceUtils.isMasJoy(userProfile, userId, authorName);
      if (!isJoy && guild && voiceTracker.isBusyWithMasJoy(client, guild.id)) {
        const busyReply = voiceTracker.getBusyWithMasJoyReply();
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(400);
        const sentMsg = await lastDiscordMessage.reply({ content: busyReply, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: busyReply,
          timestamp: sentMsg.createdTimestamp,
          isBot: true
        });
        return;
      }
      if (!isJoy && !permissionStore.isPermitted(userId)) {
        const rejection = naturalTyping.humanizeTyping(voiceUtils.generateRejectionReason(timezone));
        console.log(`[OUTPUT] [${channelLabel}] JOIN_VOICE rejected (not Mas Joy): "${rejection}"`);
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(600);
        const sentMsg = await lastDiscordMessage.reply({ content: rejection, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: rejection,
          timestamp: sentMsg.createdTimestamp,
          isBot: true
        });
        storage.setFocus(channelId, userId, config.conversationFocus);
        return;
      }

      if (!guild) {
        console.log(`[OUTPUT] [${channelLabel}] JOIN_VOICE: Bukan di server (DM).`);
        return;
      }

      // Cari voice channel
      let voiceChannel = null;
      const query = result.voiceQuery || 'CURRENT';

      if (query === 'CURRENT' || query.trim().toLowerCase() === 'current') {
        // Join VC tempat Mas Joy berada
        const masJoyMember = await resolveMember(guild, userId);
        voiceChannel = masJoyMember?.voice?.channel || null;
        if (!voiceChannel) {
          const notInVC = naturalTyping.humanizeTyping('mas joy lu sendiri aja belum masuk VC wkwk, masuk dulu dong 😭');
          if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
          await sleep(500);
          const sentMsg = await lastDiscordMessage.reply({ content: notInVC, allowedMentions: { repliedUser: false } });
          storage.addHistory(channelId, {
            id: sentMsg.id,
            channelId,
            userId: client.user.id,
            authorName: config.name || 'Callista',
            content: notInVC,
            timestamp: sentMsg.createdTimestamp,
            isBot: true
          });
          storage.setFocus(channelId, userId, config.conversationFocus);
          return;
        }
      } else {
        voiceChannel = voiceUtils.findVoiceChannel(guild, query);
        if (!voiceChannel) {
          const notFound = naturalTyping.humanizeTyping(`vc "${query}" gak ketemu mas joy wkwk, nama vc nya apa bener? 😭`);
          if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
          await sleep(500);
          const sentMsg = await lastDiscordMessage.reply({ content: notFound, allowedMentions: { repliedUser: false } });
          storage.addHistory(channelId, {
            id: sentMsg.id,
            channelId,
            userId: client.user.id,
            authorName: config.name || 'Callista',
            content: notFound,
            timestamp: sentMsg.createdTimestamp,
            isBot: true
          });
          return;
        }
      }

      // Cek apakah bot sudah ada di VC yang sama
      const currentVC = voiceUtils.getCurrentVoiceChannel(client, guild.id);
      if (currentVC && currentVC.id === voiceChannel.id) {
        const alreadyMsg = naturalTyping.humanizeTyping(voiceUtils.generateAlreadyInMessage(voiceChannel));
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(400);
        const sentMsg = await lastDiscordMessage.reply({ content: alreadyMsg, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: alreadyMsg,
          timestamp: sentMsg.createdTimestamp,
          isBot: true
        });
        storage.setFocus(channelId, userId, config.conversationFocus);
        return;
      }

      // Join voice channel
      try {
        // Kalau musik DisTube sedang jalan, stop dulu supaya tidak bentrok koneksi VC
        if (musicPlayer.isPlaying(guild.id)) {
          await musicPlayer.stopMusic(guild.id);
          await waitForVoiceLeave(client, guild.id);
          console.log(`[OUTPUT] [${channelLabel}] JOIN_VOICE: Stopped music to avoid voice conflict.`);
        }
        voiceUtils.joinVoice(voiceChannel, { selfDeaf: true, selfMute: false });
        const successMsg = naturalTyping.humanizeTyping(voiceUtils.generateJoinSuccessMessage(voiceChannel, timezone));
        console.log(`[OUTPUT] [${channelLabel}] JOIN_VOICE: Joined "${voiceChannel.name}" (${voiceChannel.id}), ordered by Mas Joy.`);
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(600);
        const sentMsg = await lastDiscordMessage.reply({ content: successMsg, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: `${successMsg} [joined VC: ${voiceChannel.name}]`,
          timestamp: sentMsg.createdTimestamp,
          isBot: true
        });
        todayMemory.addTodayEntry(`[Voice]: Join ke voice channel "${voiceChannel.name}" atas ajakan Mas Joy.`);
        storage.setFocus(channelId, userId, config.conversationFocus);
      } catch (err) {
        console.error(`[VOICE JOIN ERROR] ${err.message}`);
        const errMsg = naturalTyping.humanizeTyping('uhh gabisa join vc nih mas joy, ada error gtu 😭');
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(500);
        const sentMsg = await lastDiscordMessage.reply({ content: errMsg, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: errMsg,
          timestamp: sentMsg.createdTimestamp,
          isBot: true
        });
      }
      return;
    }

    // LEAVE_VOICE: Keluar dari voice channel
    if (result.format === 'LEAVE_VOICE') {
      const guild = lastDiscordMessage.guild;
      const timezone = config.timezone || 'Asia/Jakarta';

      // SAFETY CHECK: Hanya Mas Joy (atau user yang di-`>permit`) yang bisa menyuruh leave VC
      const isJoy = voiceUtils.isMasJoy(userProfile, userId, authorName);
      if (!isJoy && !permissionStore.isPermitted(userId)) {
        const rejection = naturalTyping.humanizeTyping(voiceUtils.generateRejectionReason(timezone));
        console.log(`[OUTPUT] [${channelLabel}] LEAVE_VOICE rejected (not Mas Joy): "${rejection}"`);
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(500);
        const sentMsg = await lastDiscordMessage.reply({ content: rejection, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: sentMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: rejection,
          timestamp: sentMsg.createdTimestamp,
          isBot: true
        });
        storage.setFocus(channelId, userId, config.conversationFocus);
        return;
      }

      if (!guild) {
        console.log(`[OUTPUT] [${channelLabel}] LEAVE_VOICE: Bukan di server (DM).`);
        return;
      }

      // Stop musik + leave sekaligus (stopMusic sekarang benar-benar keluar VC)
      const stopped = await musicPlayer.stopMusic(guild.id);
      if (stopped) console.log(`[OUTPUT] [${channelLabel}] LEAVE_VOICE: Stopped music before leaving.`);

      const left = voiceUtils.leaveVoice(guild.id, client.user.id);
      if (stopped || left) await waitForVoiceLeave(client, guild.id);
      const variants = ['udah ya gue cabut wkwk', 'oke gue leave dulu', 'gas cabut, sambutan ya 😭'];
      const msg = (stopped || left)
        ? naturalTyping.humanizeTyping(variants[Math.floor(Math.random() * variants.length)])
        : naturalTyping.humanizeTyping('bjir gue belum masuk VC, cabut apaan wkwk');
      console.log(`[OUTPUT] [${channelLabel}] LEAVE_VOICE: ${stopped || left ? 'Left VC' : 'Not in VC'}.`);
      if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
      await sleep(500);
      const sentMsg = await lastDiscordMessage.reply({ content: msg, allowedMentions: { repliedUser: false } });
      storage.addHistory(channelId, {
        id: sentMsg.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: msg,
        timestamp: sentMsg.createdTimestamp,
        isBot: true
      });
      if (stopped || left) {
        todayMemory.addTodayEntry(`[Voice]: Keluar dari voice channel atas perintah Mas Joy.`);
      }
      storage.setFocus(channelId, userId, config.conversationFocus);
      return;
    }

    // ===== MUSIC PLAYER (DisTube) — MAS JOY + USER YANG DI-`>permit` =====
    const MUSIC_FORMATS = ['PLAY_PLAYLIST', 'PLAY_SONG', 'SKIP_SONG', 'STOP_MUSIC', 'SHUFFLE_MUSIC', 'QUEUE_LIST', 'PAUSE_MUSIC', 'RESUME_MUSIC', 'LOOP_SONG', 'UNLOOP_SONG', 'PLAY_SONG_AND_LOOP', 'SAVE_CURRENT_SONG', 'SEARCH_AND_PLAY'];
    if (MUSIC_FORMATS.includes(result.format)) {
      const guild = lastDiscordMessage.guild;
      const isJoy = musicStore.isMasJoy(userProfile, userId, authorName);
      const allowed = isJoy || permissionStore.isPermitted(userId);

      // Helper kirim teks balasan
      const reply = async (text) => {
        if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
        await sleep(500);
        const m = await lastDiscordMessage.reply({ content: text, allowedMentions: { repliedUser: false } });
        storage.addHistory(channelId, {
          id: m.id, channelId, userId: client.user.id,
          authorName: config.name || 'Callista',
          content: text, timestamp: m.createdTimestamp, isBot: true
        });
        storage.setFocus(channelId, userId, config.conversationFocus);
      };

      // Bukan Mas Joy dan bukan pemegang izin: tolak
      if (!allowed) {
        const rej = naturalTyping.humanizeTyping(musicPlayer.generateRejectReason());
        console.log(`[OUTPUT] [${channelLabel}] MUSIC ${result.format} rejected (not permitted).`);
        await reply(rej);
        return;
      }

      if (!guild) {
        await reply('bjir ini DM, gak bisa muter musik disini 😭');
        return;
      }

      // PLAY_PLAYLIST
      if (result.format === 'PLAY_PLAYLIST') {
        const query = (result.musicQuery || '').trim();
        const isGeneric = !query || /^(?:musik|music|lagu|song|playlist|apa\s*aja|bebas|random)$/i.test(query);
        let playlist = !isGeneric ? musicStore.findPlaylistByName(query) : null;
        if (!playlist && isFavoritesName(query)) playlist = musicStore.ensureFavoritesPlaylist();
        if (!playlist && isGeneric) {
          const allPlaylists = musicStore.loadPlaylists().playlists || [];
          const remotes = allPlaylists.filter(p => !musicStore.isLocalPlaylist(p) && p.url);
          playlist = (remotes.length > 0)
            ? remotes[Math.floor(Math.random() * remotes.length)]
            : allPlaylists.find(p => musicStore.isLocalPlaylist(p) && p.songs && p.songs.length > 0);
        }
        if (!playlist) {
          console.log(`[MUSIC] PLAY_PLAYLIST: "${query}" not found. Searching YouTube instead.`);
          // Fallback: search YouTube dengan query asli
          const member = await resolveMember(guild, userId);
          try {
            const playResult = await musicPlayer.playSong(member, lastDiscordMessage.channel, query);
            if (!playResult.success) {
              await reply('mas joy masuk VC dulu, atau suruh gue join dulu 😭');
              return;
            }
            console.log(`[MUSIC] Fallback PLAY_SONG "${query}" by Mas Joy.`);
          } catch (err) {
            console.error('[MUSIC PLAY ERROR]', err.message);
            await reply(`uhh gabisa muter musik nih mas joy: ${err.message} 😭`);
          }
          return;
        }
        const member = await resolveMember(guild, userId);
        try {
          const playResult = await musicPlayer.playPlaylist(member, lastDiscordMessage.channel, playlist);
          if (!playResult.success) {
            if (playResult.code === 'EMPTY_PLAYLIST') {
              await reply(`playlist lokal **${playlist.name}** masih kosong. Tambahin dulu: \`>add <link> >>${playlist.name}\``);
              return;
            }
            await reply('mas joy masuk VC dulu, atau suruh gue join dulu 😭');
            return;
          }
          console.log(`[MUSIC] PLAY_PLAYLIST "${playlist.name}" by Mas Joy in #${lastDiscordMessage.channel.name}.`);
          const userAskedShuffle = /\b(?:shuffle|shufle|acak)\b/i.test(lastMsg?.content || '');
          if (userAskedShuffle) {
            await sleep(800);
            await musicPlayer.toggleShuffle(guild.id);
          }
          // DisTube.events akan ngirim pesan/addList/playSong sendiri
        } catch (err) {
          console.error('[MUSIC PLAY ERROR]', err.message);
          await reply(`uhh gabisa muter playlist nih mas joy, error: ${err.message} 😭`);
        }
        return;
      }

      // PLAY_SONG
      if (result.format === 'PLAY_SONG') {
        const query = result.musicQuery || '';
        if (!query.trim()) {
          await reply('judul lagunya apa mas joy? 😭');
          return;
        }
        const member = await resolveMember(guild, userId);
        try {
          const playResult = await musicPlayer.playSong(member, lastDiscordMessage.channel, query);
          if (!playResult.success) {
            await reply('mas joy masuk VC dulu, atau suruh gue join dulu 😭');
            return;
          }
          console.log(`[MUSIC] PLAY_SONG "${query}" by Mas Joy.`);
        } catch (err) {
          console.error('[MUSIC PLAY ERROR]', err.message);
          await reply(`gabisa muter lagunya nih mas joy: ${err.message} 😭`);
        }
        return;
      }

      // SKIP_SONG
      if (result.format === 'SKIP_SONG') {
        const ok = await musicPlayer.skipSong(guild.id);
        if (!ok) {
          await reply('ga ada lagu yang lagi diputer bjir 😭');
        } else {
          console.log('[MUSIC] Skip requested by Mas Joy');
        }
        return;
      }

      // STOP_MUSIC
      if (result.format === 'STOP_MUSIC') {
        const ok = await musicPlayer.stopMusic(guild.id);
        if (ok) {
          console.log('[MUSIC] Stop + leave requested by Mas Joy');
          await waitForVoiceLeave(client, guild.id);
          await reply('oke stop, gue cabut dulu ya wkwk');
        } else {
          await reply('ga lagi muter musik kok 😭');
        }
        return;
      }

      // SHUFFLE_MUSIC
      if (result.format === 'SHUFFLE_MUSIC') {
        const resultShuffle = await musicPlayer.toggleShuffle(guild.id);
        if (resultShuffle === null) {
          await reply('ga ada queue buat di-shuffle mas joy 😭');
        } else if (resultShuffle === false) {
          await reply('lagu di queue kurang dari 2, ga bisa di-shuffle bjir 😭');
        } else {
          await reply('oke di-shuffle wkwk 🎲');
        }
        return;
      }

      // QUEUE_LIST
      if (result.format === 'QUEUE_LIST') {
        await reply(formatQueueText(musicPlayer.getQueueList(guild.id)) || 'queue kosong mas joy 😭');
        return;
      }

      // PAUSE_MUSIC / RESUME_MUSIC
      if (result.format === 'PAUSE_MUSIC') {
        const ok = await musicPlayer.pauseMusic(guild.id);
        if (!ok) await reply('ga lagi muter bos 😭');
        return;
      }
      if (result.format === 'RESUME_MUSIC') {
        const ok = await musicPlayer.resumeMusic(guild.id);
        if (!ok) await reply('ga ada yang di-pause bjir 😭');
        return;
      }

      // LOOP_SONG
      if (result.format === 'LOOP_SONG') {
        const ok = await musicPlayer.setRepeatMode(guild.id, 1);
        if (!ok) {
          await reply('ga ada lagu yang lagi diputer buat di-loop 😭');
        } else {
          console.log('[MUSIC] Loop activated by Mas Joy');
        }
        return;
      }

      // UNLOOP_SONG
      if (result.format === 'UNLOOP_SONG') {
        const ok = await musicPlayer.setRepeatMode(guild.id, 0);
        if (!ok) {
          await reply('ga ada lagu yang lagi diputer 😭');
        } else {
          console.log('[MUSIC] Loop deactivated by Mas Joy');
        }
        return;
      }

      // PLAY_SONG_AND_LOOP
      if (result.format === 'PLAY_SONG_AND_LOOP') {
        const query = result.musicQuery || '';
        if (!query.trim()) {
          await reply('judul lagunya apa mas joy? 😭');
          return;
        }

        // Cari dulu di local playlists
        let songUrl = null;
        const localPlaylists = musicStore.listLocalPlaylists();
        for (const pl of localPlaylists) {
          const q = query.toLowerCase();
          const found = (pl.songs || []).find(s =>
            (s.title || '').toLowerCase().includes(q) || q.includes((s.title || '').toLowerCase())
          );
          if (found) { songUrl = found.url; break; }
        }

        if (!songUrl) {
          try {
            const searchRes = await tinyfishSearch.searchYouTube(query);
            if (searchRes.results.length > 0) {
              songUrl = searchRes.results[0].url;
            }
          } catch (err) {
            console.error('[PLAY_SONG_AND_LOOP SEARCH ERROR]', err.message);
          }
        }

        const playQuery = songUrl || query;
        const member = await resolveMember(guild, userId);
        try {
          const playResult = await musicPlayer.playSong(member, lastDiscordMessage.channel, playQuery);
          if (!playResult.success) {
            await reply('mas joy masuk VC dulu, atau suruh gue join dulu 😭');
            return;
          }
          await new Promise(r => setTimeout(r, 500));
          await musicPlayer.setRepeatMode(guild.id, 1);
          console.log(`[MUSIC] PLAY_SONG_AND_LOOP "${query}" by Mas Joy.`);
        } catch (err) {
          console.error('[MUSIC PLAY ERROR]', err.message);
          await reply(`gabisa muter lagunya nih mas joy: ${err.message} 😭`);
        }
        return;
      }

      // SAVE_CURRENT_SONG
      if (result.format === 'SAVE_CURRENT_SONG') {
        const targetName = result.musicQuery || 'favorit';
        let target = musicStore.findLocalPlaylistByName(targetName);
        if (!target && isFavoritesName(targetName)) target = musicStore.ensureFavoritesPlaylist();
        if (!target) target = musicStore.ensureFavoritesPlaylist();

        const q = musicPlayer.getQueueList(guild.id);
        const current = q?.songs?.find(s => s.isCurrent);
        if (!current?.url) {
          await reply('ga ada lagu yang lagi diputer buat disimpen 😭');
          return;
        }

        const fakeMember = await resolveMember(guild, userId);
        await handleLibraryCommand({
          client, message: lastDiscordMessage, member: fakeMember, isJoy, allowed, config,
          lib: {
            command: 'add',
            urls: [current.url],
            target: targetName,
            currentSong: false,
            source: 'ai',
          }
        });
        return;
      }

      // SEARCH_AND_PLAY
      if (result.format === 'SEARCH_AND_PLAY') {
        const query = result.musicQuery || '';
        if (!query.trim()) {
          await reply('cariin lagu apa mas joy? 😭');
          return;
        }

        // Cari dulu di local playlists
        let songUrl = null;
        const localPlaylists = musicStore.listLocalPlaylists();
        for (const pl of localPlaylists) {
          const q = query.toLowerCase();
          const found = (pl.songs || []).find(s =>
            (s.title || '').toLowerCase().includes(q) || q.includes((s.title || '').toLowerCase())
          );
          if (found) { songUrl = found.url; break; }
        }

        if (!songUrl) {
          try {
            const searchRes = await tinyfishSearch.searchYouTube(query);
            if (searchRes.results.length > 0) {
              songUrl = searchRes.results[0].url;
              tinyfishSearch.saveSearch(channelId, userId, searchRes);
            }
          } catch (err) {
            console.error('[SEARCH_AND_PLAY ERROR]', err.message);
            await reply(`uhh gagal nyari "${query}" di YouTube: ${err.message} 😭`);
            return;
          }
        }

        if (!songUrl) {
          await reply(`ga nemu "${query}" mas joy 😭 coba kata kunci lain`);
          return;
        }

        const member = await resolveMember(guild, userId);
        try {
          const playResult = await musicPlayer.playSong(member, lastDiscordMessage.channel, songUrl);
          if (!playResult.success) {
            await reply('mas joy masuk VC dulu, atau suruh gue join dulu 😭');
            return;
          }
          console.log(`[MUSIC] SEARCH_AND_PLAY "${query}" by Mas Joy.`);
        } catch (err) {
          console.error('[MUSIC PLAY ERROR]', err.message);
          await reply(`gabisa muter lagunya nih mas joy: ${err.message} 😭`);
        }
        return;
      }
    }

    // STICKER_ONLY: Kirim hanya sticker tanpa teks
    if (result.format === 'STICKER_ONLY' && result.stickerExpression) {
      const sticker = stickerEmoji.getRandomStickerByExpression(result.stickerExpression);
      if (!sticker) {
        console.log(`[OUTPUT] [${channelLabel}] STICKER_ONLY: Tidak ada sticker untuk ekspresi "${result.stickerExpression}". Fallback ke SILENCE.`);
        return;
      }
      console.log(`[OUTPUT] [${channelLabel}] Sending sticker (expression: ${result.stickerExpression}, label: "${sticker.label}"): ${sticker.stickerId}`);
      const sentMsg = await lastDiscordMessage.channel.send({ stickers: [sticker.stickerId] });
      storage.addHistory(channelId, {
        id: sentMsg.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: `[sticker: ${sticker.label}]`,
        timestamp: sentMsg.createdTimestamp,
        isBot: true
      });
      storage.setFocus(channelId, userId, config.conversationFocus);
      return;
    }

    // EMOJI_ONLY: Kirim hanya custom emoji tanpa teks
    if (result.format === 'EMOJI_ONLY') {
      let emojiCode = result.customEmojiCode;
      if (!emojiCode && result.emojiExpression) {
        const emoji = stickerEmoji.getRandomEmojiByExpression(result.emojiExpression);
        if (emoji) emojiCode = emoji.code;
      }
      if (!emojiCode) {
        console.log(`[OUTPUT] [${channelLabel}] EMOJI_ONLY: Tidak ada emoji untuk ekspresi "${result.emojiExpression}". Fallback ke SILENCE.`);
        return;
      }
      console.log(`[OUTPUT] [${channelLabel}] Sending emoji only: ${emojiCode}`);
      if (lastDiscordMessage.channel.sendTyping) await lastDiscordMessage.channel.sendTyping();
      await sleep(500);
      const sentMsg = await lastDiscordMessage.reply({ content: emojiCode, allowedMentions: { repliedUser: false } });
      storage.addHistory(channelId, {
        id: sentMsg.id,
        channelId,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: emojiCode,
        timestamp: sentMsg.createdTimestamp,
        isBot: true
      });
      storage.setFocus(channelId, userId, config.conversationFocus);
      return;
    }

    // REACTION_ONLY: React ke pesan user dengan emoji (unicode atau custom)
    if (result.format === 'REACTION_ONLY' && result.reactionEmoji) {
      console.log(`[OUTPUT] [${channelLabel}] Reacting with emoji: ${result.reactionEmoji}`);
      try {
        await lastDiscordMessage.react(result.reactionEmoji);
      } catch (reactErr) {
        // Jika custom emoji gagal, coba parse ID-nya
        const parsed = stickerEmoji.parseEmojiCode(result.reactionEmoji);
        if (parsed) {
          await lastDiscordMessage.react(parsed.identifier);
        } else {
          console.error(`[REACTION ERROR] ${reactErr.message}`);
        }
      }
      return;
    }

    const rawReplies = result.messages || [];
    if (rawReplies.length === 0) {
      console.log(`[OUTPUT] [${channelLabel}] No reply text generated.`);
      return;
    }
    const replyTexts = rawReplies.map(m => naturalTyping.humanizeTyping(m));

    if (lastDiscordMessage.channel.sendTyping) {
      await lastDiscordMessage.channel.sendTyping();
    }

    console.log(`[OUTPUT] [${channelLabel}] Replying (${result.format}${result.format === 'STACKED_TEXT' ? ` 1/${replyTexts.length}` : ''}): "${replyTexts[0]}"`);
    const firstMsg = await lastDiscordMessage.reply({
      content: replyTexts[0],
      allowedMentions: { repliedUser: false }
    });

    storage.addHistory(channelId, {
      id: firstMsg.id,
      channelId,
      userId: client.user.id,
      authorName: config.name || 'Callista',
      content: replyTexts[0],
      timestamp: firstMsg.createdTimestamp,
      isBot: true
    });
    todayMemory.addTodayEntry(`[Chat]: ${authorName} ngobrol sama Callista. Balasan: "${replyTexts[0]}"`);

    if (result.format === 'STACKED_TEXT' && replyTexts.length > 1) {
      for (let i = 1; i < replyTexts.length; i++) {
        await sleep(900);
        if (lastDiscordMessage.channel.sendTyping) {
          await lastDiscordMessage.channel.sendTyping();
        }
        await sleep(500);
        console.log(`[OUTPUT] [${channelLabel}] Sending (STACKED_TEXT ${i + 1}/${replyTexts.length}): "${replyTexts[i]}"`);
        const nextMsg = await lastDiscordMessage.channel.send(replyTexts[i]);
        storage.addHistory(channelId, {
          id: nextMsg.id,
          channelId,
          userId: client.user.id,
          authorName: config.name || 'Callista',
          content: replyTexts[i],
          timestamp: nextMsg.createdTimestamp,
          isBot: true
        });
      }
    }

    // Reaksi GIF Pendukung (Paralel via Tag Emosi + RNG Berbobot)
    const emotion = result.emotion || result.gifExpression;
    if (emotion && result.format !== 'GIF_ONLY' && gifSearch.shouldTriggerGif(emotion, channelId)) {
      const normalized = gifSearch.normalizeEmotion(emotion);
      console.log(`[GIF] RNG hit for emotion "${emotion}" (${normalized}) in [${channelLabel}] -> fetching companion GIF in background...`);
      gifSearch.searchRandomGif(normalized, 5).then(async (gif) => {
        if (!gif) return;
        await sleep(700);
        console.log(`[OUTPUT] [${channelLabel}] Sending companion GIF (emotion: ${normalized}, keyword: "${gif.keyword}"): ${gif.url}`);
        const gifMsg = await lastDiscordMessage.channel.send(gif.url).catch(() => null);
        if (gifMsg) {
          storage.addHistory(channelId, {
            id: gifMsg.id,
            channelId,
            userId: client.user.id,
            authorName: config.name || 'Callista',
            content: `[gif: ${normalized}] ${gif.url}`,
            timestamp: gifMsg.createdTimestamp,
            isBot: true
          });
          todayMemory.addTodayEntry(`[GIF]: Mengirim GIF reaksi ${normalized} ke ${channelLabel}`);
        }
      }).catch(err => {
        console.warn('[GIF] Companion GIF error:', err.message);
      });
    }

    storage.setFocus(channelId, userId, config.conversationFocus);

    // Affection adjustments based on relationship style
    if (userProfile.style === 'clingy' || userProfile.isVIP) {
      storage.updateUserMemory(userId, { affection: 100 });
      console.log(`[MEMORY] Focus set with [${authorName}] for ${config.conversationFocus}s | Affection: 100/100 (Mas Joy / Clingy)`);
    } else if (userProfile.style === 'playfully_hostile' || userProfile.isHostile) {
      const curAff = userProfile.affection || 15;
      const newAffection = Math.min(30, curAff + 1);
      storage.updateUserMemory(userId, { affection: newAffection });
      console.log(`[MEMORY] Focus set with [${authorName}] for ${config.conversationFocus}s | Affection: ${newAffection}/100 (Playfully Hostile)`);
    } else {
      const newAffection = Math.min(100, (userProfile.affection || 10) + 1);
      storage.updateUserMemory(userId, { affection: newAffection });
      console.log(`[MEMORY] Focus set with [${authorName}] for ${config.conversationFocus}s | Affection: ${newAffection}/100`);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to send message to Discord:`, err.message);
  }
}

function startBot(token) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  client.once('ready', () => {
    console.log(`Callista connected as ${client.user.tag}`);
    try {
      musicPlayer.initDisTube(client);
      console.log('[MUSIC] DisTube ready');
    } catch (e) {
      console.error('[MUSIC] DisTube init failed:', e.message);
    }
    setTimeout(() => {
      voiceTracker.scanOnStartup(client).catch(err => {
        console.error('[VC_TRACKER] Startup scan error:', err.message);
      });
      const cfg = storage.getConfig();
      classSessionManager.checkAndFlushSessions(client, cfg.timezone || 'Asia/Jakarta').catch(err => {
        console.error('[CLASS_MANAGER] Startup flush error:', err.message);
      });
    }, 3000);

    // Periodic check setiap 30 detik untuk memproses pesan pending saat kelas berakhir
    setInterval(() => {
      const cfg = storage.getConfig();
      classSessionManager.checkAndFlushSessions(client, cfg.timezone || 'Asia/Jakarta').catch(() => {});
    }, 30000);

    // Recalculate mood harian di startup + setiap 60 menit
    function recalculateDailyMood() {
      try {
        const cfg = storage.getConfig();
        const tz = cfg.timezone || 'Asia/Jakarta';
        const { dateStr } = dailyStore.getTimeInTimezone(new Date(), tz);
        moodSystem.calculateMood(dateStr, { syncBotState: true });
        console.log('[MOOD] Recalculated for', dateStr, '→', storage.getMood());
      } catch (e) {
        console.error('[MOOD] Recalculation error:', e.message);
      }
    }
    recalculateDailyMood();
    setInterval(recalculateDailyMood, 60 * 60 * 1000);
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    voiceTracker.handleVoiceStateUpdate(oldState, newState, client).catch(err => {
      console.error('[VC_TRACKER] voiceStateUpdate error:', err.message);
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const guildId = interaction.guildId;
    if (!guildId) return;

    const customId = interaction.customId;

    // Tombol interaktif hasil pencarian (>sc)
    if (customId.startsWith('search_page:') || customId.startsWith('search_hide:') || customId.startsWith('search_show:')) {
      const parts = customId.split(':');
      const action = parts[0];
      const targetUserId = parts[1];
      const page = parseInt(parts[2] || '0', 10) || 0;

      const isJoy = musicStore.isMasJoy(null, interaction.user.id, interaction.user.username);
      const isAllowed = isJoy || permissionStore.isPermitted(interaction.user.id) || interaction.user.id === targetUserId;
      if (!isAllowed) {
        await interaction.reply({ content: musicPlayer.generateRejectReason(), ephemeral: true }).catch(() => {});
        return;
      }

      const messageId = interaction.message?.id;
      const search = (messageId ? tinyfishSearch.getSearchByMessageId(messageId) : null)
        || tinyfishSearch.getSearch(interaction.channelId, targetUserId);

      if (!search || !search.results || !search.results.length) {
        await interaction.reply({ content: 'pencarian tidak ditemukan mas joy 😭 coba `>sc` lagi ya', ephemeral: true }).catch(() => {});
        return;
      }

      const isHidden = action === 'search_hide';
      const newEmbed = tinyfishSearch.buildSearchEmbed(search.query, search.results, { page, isHidden });
      const newComponents = tinyfishSearch.buildSearchComponents(targetUserId, search.results, { page, isHidden });

      if (messageId) {
        tinyfishSearch.updateSearchState(messageId, { page, isHidden });
      }

      await interaction.update({ embeds: [newEmbed], components: newComponents }).catch(() => {});
      return;
    }

    // Tombol switch cepat playlist: Play {playlist} Now
    if (customId.startsWith('player_play_now:')) {
      const isJoy = musicStore.isMasJoy(null, interaction.user.id, interaction.user.username);
      const allowed = isJoy || permissionStore.isPermitted(interaction.user.id);
      if (!allowed) {
        await interaction.reply({ content: musicPlayer.generateRejectReason(), ephemeral: true }).catch(() => {});
        return;
      }
      const plName = customId.slice('player_play_now:'.length);
      let pl = musicStore.findPlaylistByName(plName);
      if (!pl && isFavoritesName(plName)) pl = musicStore.ensureFavoritesPlaylist();
      if (!pl) {
        await interaction.reply({ content: `playlist "${plName}" ga ketemu mas joy 😭`, ephemeral: true }).catch(() => {});
        return;
      }
      const member = await resolveMember(interaction.guild, interaction.user.id);
      await musicPlayer.playPlaylistNow(member, interaction.channel, pl);
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    const isJoy = musicStore.isMasJoy(null, interaction.user.id, interaction.user.username);
    const allowed = isJoy || permissionStore.isPermitted(interaction.user.id);
    if (!allowed) {
      await interaction.reply({ content: musicPlayer.generateRejectReason(), ephemeral: true }).catch(() => {});
      return;
    }
    try {
      switch (customId) {
        case 'player_pause': {
          const dt = musicPlayer.getDisTube();
          const q = dt?.getQueue(guildId);
          if (q?.paused) {
            await musicPlayer.resumeMusic(guildId);
          } else {
            await musicPlayer.pauseMusic(guildId);
          }
          await interaction.deferUpdate().catch(() => {});
          break;
        }
        case 'player_skip': {
          await musicPlayer.skipSong(guildId);
          await interaction.deferUpdate().catch(() => {});
          break;
        }
        case 'player_stop': {
          await musicPlayer.stopMusic(guildId);
          await interaction.deferUpdate().catch(() => {});
          break;
        }
        case 'player_prev': {
          await interaction.reply({ content: '⏮️ Lagu sebelumnya belum tersedia', ephemeral: true });
          break;
        }
        case 'player_loop': {
          const dt = musicPlayer.getDisTube();
          const q = dt?.getQueue(guildId);
          if (!q) {
            await interaction.reply({ content: 'ga ada musik yang lagi diputar mas joy 😭', ephemeral: true });
            break;
          }
          const nextMode = (q.repeatMode + 1) % 3;
          await musicPlayer.setRepeatMode(guildId, nextMode);
          await musicPlayer.renderPlayerView(guildId);
          await interaction.deferUpdate().catch(() => {});
          break;
        }
        case 'player_shuffle': {
          const dt = musicPlayer.getDisTube();
          const q = dt?.getQueue(guildId);
          if (!q) {
            await interaction.reply({ content: 'ga ada musik yang lagi diputar mas joy 😭', ephemeral: true });
            break;
          }
          if (!q.songs || q.songs.length < 2) {
            await interaction.reply({ content: 'antrian kurang dari 2 lagu buat di-shuffle mas joy 😭', ephemeral: true });
            break;
          }
          await musicPlayer.toggleShuffle(guildId);
          await musicPlayer.renderPlayerView(guildId);
          await interaction.deferUpdate().catch(() => {});
          break;
        }
        case 'player_queue': {
          // Toggle antara player view ↔ queue view, edit embed in-place
          const toggled = await musicPlayer.toggleQueueView(guildId, 0);
          if (toggled) {
            await interaction.deferUpdate().catch(() => {});
          } else {
            await interaction.reply({ content: 'ga ada antrian mas joy 😭', ephemeral: true });
          }
          break;
        }
        case 'player_lyrics': {
          // Toggle antara player view ↔ full lyrics view, edit embed in-place
          const toggled = await musicPlayer.toggleLyricsView(guildId);
          if (toggled) {
            await interaction.deferUpdate().catch(() => {});
          } else {
            await interaction.reply({ content: 'ga ada musik yang lagi diputar mas joy 😭', ephemeral: true });
          }
          break;
        }
        case 'player_queue_next': {
          await musicPlayer.toggleQueueView(guildId, +1);
          await interaction.deferUpdate().catch(() => {});
          break;
        }
        case 'player_queue_prev': {
          await musicPlayer.toggleQueueView(guildId, -1);
          await interaction.deferUpdate().catch(() => {});
          break;
        }
      }
    } catch (e) {
      console.error('[INTERACTION ERROR]', e.message);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Gagal eksekusi perintah', ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: 'Gagal eksekusi perintah', ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    if (message.author.bot) return;
    if (processedMessageIds.has(message.id)) return;

    const channelId = message.channelId;
    const channelLabel = getChannelLabel(message.channel);
    const userId = message.author.id;
    const authorName = message.member?.displayName || message.author.globalName || message.author.username;
    const content = message.content || '';

    let replyToAuthorId = null;
    let replyToAuthorName = null;
    let replyToContent = null;

    if (message.reference?.messageId) {
      try {
        const history = storage.getHistory(channelId);
        const cachedRef = history.find(m => m.id === message.reference.messageId);
        if (cachedRef) {
          replyToAuthorId = cachedRef.userId;
          replyToAuthorName = cachedRef.authorName;
          replyToContent = cachedRef.content;
        } else {
          const refMsg = await message.channel.messages.fetch(message.reference.messageId);
          replyToAuthorId = refMsg.author.id;
          replyToAuthorName = refMsg.member?.displayName || refMsg.author.globalName || refMsg.author.username;
          replyToContent = refMsg.content;
        }
      } catch (e) {}
    }

    const mentions = Array.from(message.mentions.users.keys());
    const isMentioned = mentions.includes(client.user.id);
    const isReplyToCallista = Boolean(replyToAuthorId && replyToAuthorId === client.user.id);

    const msgData = {
      id: message.id,
      channelId,
      userId,
      authorName,
      content,
      timestamp: message.createdTimestamp,
      mentions,
      replyToId: message.reference?.messageId || null,
      replyToAuthorId,
      replyToAuthorName,
      replyToContent,
      botId: client.user.id
    };

    let replyTag = '';
    if (isReplyToCallista) {
      replyTag = ` [REPLY to Callista: "${replyToContent?.slice(0, 25) || ''}..."]`;
    } else if (replyToAuthorName) {
      replyTag = ` [REPLY to ${replyToAuthorName}: "${replyToContent?.slice(0, 25) || ''}..."]`;
    }
    const mentionTag = isMentioned ? ' [@MENTIONED]' : '';

    console.log(`[INPUT] [${channelLabel}] [${authorName}]: "${content}"${replyTag}${mentionTag}`);

    storage.addHistory(channelId, { ...msgData, isBot: false });

    const config = storage.getConfig();
    const botState = storage.getBotState();
    const focus = storage.getFocus(channelId);
    const isJoy = musicStore.isMasJoy(null, userId, authorName);
    // allowed = boleh memerintah Callista (Mas Joy atau user yang di-`>permit`).
    // isJoy tetap dipakai untuk panggilan/format khusus Mas Joy.
    const allowed = isJoy || permissionStore.isPermitted(userId);

    // Kontrol izin. Hanya Mas Joy; bypass AI sepenuhnya.
    const permitCmd = musicCommands.parsePermitCommand(content);
    if (permitCmd) {
      processedMessageIds.add(message.id);
      try {
        await handlePermitCommand({ client, message, config, isJoy, permitCmd });
      } catch (e) {
        console.error('[PERMIT ERROR]', e.message);
      }
      return;
    }

    // Tambah playlist YouTube remote dengan nama custom: ">pl-rm <link> >>Nama".
    const remotePlCmd = musicCommands.parseRemotePlaylistCommand(content);
    if (remotePlCmd) {
      processedMessageIds.add(message.id);
      pendingSongAdds.delete(pendingAddKey(channelId, userId));
      try {
        await handleRemotePlaylistCommand({ client, message, isJoy, allowed, config, remote: remotePlCmd });
      } catch (e) {
        console.error('[PLAYLIST REMOTE ERROR]', e.message);
      }
      return;
    }

    async function rejectIfBusyWithMasJoy() {
      if (isJoy || !message.guild) return false;
      if (voiceTracker.isBusyWithMasJoy(client, message.guild.id)) {
        const reply = voiceTracker.getBusyWithMasJoyReply();
        const sent = await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
        const cfg = storage.getConfig() || {};
        storage.addHistory(message.channelId, {
          id: sent.id,
          channelId: message.channelId,
          userId: client.user.id,
          authorName: cfg.name || 'Callista',
          content: reply,
          timestamp: sent.createdTimestamp,
          isBot: true,
        });
        return true;
      }
      return false;
    }

    // Lompat ke menit tertentu: ">jump 5".
    const jumpCmd = musicCommands.parseJumpCommand(content);
    if (jumpCmd) {
      processedMessageIds.add(message.id);
      if (await rejectIfBusyWithMasJoy()) return;
      try {
        await handleJumpCommand({ client, message, isJoy, allowed, config, jump: jumpCmd });
      } catch (e) {
        console.error('[JUMP ERROR]', e.message);
      }
      return;
    }

    // Pencarian lagu deterministik (TinyFish). AI cuma buat ngobrol, bukan nyari.
    const searchCmd = musicCommands.parseSearchCommand(content, { isMentioned, isReplyToCallista });
    if (searchCmd) {
      processedMessageIds.add(message.id);
      pendingSongAdds.delete(pendingAddKey(channelId, userId));
      if (await rejectIfBusyWithMasJoy()) return;
      console.log(`[SEARCH] [${channelLabel}] [${authorName}]: "${searchCmd.query}"`);
      try {
        await handleSearchCommand({
          client, message, isJoy, allowed, config,
          query: searchCmd.query, source: searchCmd.source,
        });
      } catch (e) {
        console.error('[SEARCH ERROR]', e.message);
      }
      return;
    }

    // Pilih hasil pencarian: "nomor 1 ke abcd" / "puter nomor 1" / ">p 1".
    const activeSearch = allowed ? tinyfishSearch.getSearch(channelId, userId, message.reference?.messageId) : null;
    if (activeSearch) {
      const pick = musicCommands.parseSearchPick(content);
      if (pick) {
        processedMessageIds.add(message.id);
        if (await rejectIfBusyWithMasJoy()) return;
        const member = await resolveMember(message.guild, userId);
        console.log(`[SEARCH] [${channelLabel}] [${authorName}]: pilih nomor ${pick.index}${pick.target ? ` -> ${pick.target}` : ''}`);
        try {
          await handleSearchPick({ client, message, member, isJoy, allowed, config, pick, search: activeSearch });
        } catch (e) {
          console.error('[SEARCH PICK ERROR]', e.message);
        }
        return;
      }
    }

    // Follow-up pertanyaan "masukin kemana ini?" -> simpan ke playlist yang dipilih.
    if (allowed) {
      const key = pendingAddKey(channelId, userId);
      const pending = pendingSongAdds.get(key);
      if (pending) {
        if (Date.now() - pending.at > PENDING_ADD_TTL_MS) {
          pendingSongAdds.delete(key);
        } else {
          const target = musicCommands.parsePendingTarget(content, { isMentioned });
          // Cuma intersep kalau target-nya benar-benar playlist lokal yang ada,
          // biar chat lain ("di rumah") nggak kebajak.
          const localMatch = target
            ? (musicStore.findLocalPlaylistByName(target) ||
               (isFavoritesName(target) ? musicStore.ensureFavoritesPlaylist() : null))
            : null;
          if (localMatch) {
            processedMessageIds.add(message.id);
            if (await rejectIfBusyWithMasJoy()) return;
            const member = await resolveMember(message.guild, userId);
            console.log(`[LIB] Pending add -> "${target}"`);
            try {
              const applied = await handleLibraryCommand({
                client, message, member, isJoy, allowed, config,
                lib: { command: 'add', urls: pending.urls, target, currentSong: false, source: 'pending' }
              });
              if (applied) pendingSongAdds.delete(key);
            } catch (e) {
              console.error('[LIB ERROR]', e.message);
            }
            return;
          }
        }
      }
    }

    // Perintah library lagu (add/simpan/buat playlist) — bypass AI.
    const lib = musicCommands.parseLibraryCommand(content, { isMentioned, isReplyToCallista });
    if (lib) {
      processedMessageIds.add(message.id);
      // Perintah baru yang udah jelas targetnya bikin pending lama nggak relevan.
      if (lib.command === 'create' || lib.target) {
        pendingSongAdds.delete(pendingAddKey(channelId, userId));
      }
      if (await rejectIfBusyWithMasJoy()) return;
      const member = await resolveMember(message.guild, userId);
      console.log(`[LIB] [${channelLabel}] [${authorName}]: ${lib.command}${lib.target ? ` -> ${lib.target}` : ''}`);
      try {
        await handleLibraryCommand({ client, message, member, isJoy, allowed, config, lib });
      } catch (e) {
        console.error('[LIB ERROR]', e.message);
        try {
          await message.reply({ content: `uhh gagal proses playlist: ${e.message} 😭`, allowedMentions: { repliedUser: false } });
        } catch (_) {}
      }
      return;
    }

    // Perintah musik deterministik (prefix ">" / natural control) — bypass AI sepenuhnya.
    let direct = musicCommands.parseDirectCommand(content, {
      isMentioned,
      isReplyToCallista
    });
    // Bare control ("skip" tanpa nama) hanya valid kalau ada queue aktif.
    if (!direct && message.guild && musicCommands.detectControlVerb(content)) {
      let hasQueue = false;
      try { hasQueue = Boolean(musicPlayer.getQueueList(message.guild.id)); } catch (e) {}
      if (hasQueue) direct = musicCommands.parseDirectCommand(content, { isMentioned, isReplyToCallista, hasQueue });
    }
    if (direct) {
      processedMessageIds.add(message.id);
      if (await rejectIfBusyWithMasJoy()) return;
      const member = await resolveMember(message.guild, userId);
      console.log(`[CMD] [${channelLabel}] [${authorName}]: ${direct.source === 'prefix' ? '>' : ''}${direct.command}${direct.args ? ` ${direct.args}` : ''}`);
      try {
        await handleDirectMusicCommand({ client, message, member, isJoy, allowed, config, ...direct });
      } catch (e) {
        console.error('[CMD ERROR]', e.message);
        try {
          await message.reply({ content: `uhh command-nya error: ${e.message} 😭`, allowedMentions: { repliedUser: false } });
        } catch (_) {}
      }
      return;
    }

    const gateCheck = decision.checkPreAIGate(msgData, focus, config, botState);

    if (gateCheck.pass) {
      console.log(`[GATE] PASS -> Trigger: [${gateCheck.trigger.toUpperCase()}] | Buffering into burst window (${config.burstWindowMs || 2500}ms)...`);
      storage.recordInteraction(userId, authorName);
    } else {
      if (gateCheck.reason === 'bot_silenced') {
        console.log(`[GATE] BLOCKED -> Callista sedang dalam mode DIAM / TIDAK MERESPON (Toggle OFF). Zero AI overhead.`);
        return;
      } else if (gateCheck.reason === 'addressed_to_other_during_focus') {
        console.log(`[GATE] SKIP -> Addressed to someone else during focus. Focus cleared.`);
        storage.clearFocus(channelId);
      } else {
        console.log(`[GATE] SKIP -> No mention, reply, name, or focus. Zero AI overhead.`);
      }
    }

    const existingBurst = activeBursts.get(channelId);
    if (existingBurst && existingBurst.userId === userId) {
      clearTimeout(existingBurst.timer);
      existingBurst.messages.push(msgData);
      existingBurst.lastDiscordMessage = message;
      if (gateCheck.pass) {
        existingBurst.hasTrigger = true;
      }
      console.log(`[BURST] Aggregated message into current burst from [${authorName}] (Total: ${existingBurst.messages.length})`);
      existingBurst.timer = setTimeout(() => {
        processBurst(channelId, client);
      }, config.burstWindowMs || 2500);
    } else {
      if (existingBurst) {
        clearTimeout(existingBurst.timer);
        processBurst(channelId, client);
      }

      const timer = setTimeout(() => {
        processBurst(channelId, client);
      }, config.burstWindowMs || 2500);

      activeBursts.set(channelId, {
        userId,
        authorName,
        channelLabel,
        messages: [msgData],
        lastDiscordMessage: message,
        hasTrigger: gateCheck.pass,
        timer
      });
    }
  });

  client.login(token).catch(err => {
    console.error('Discord login error:', err.message);
  });

  return client;
}

module.exports = {
  startBot,
  processBurst
};
