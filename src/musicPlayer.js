/**
 * Music Player — wrapper DisTube v5 untuk Callista.
 *
 * PENTING (DisTube v5):
 * - WAJIB pakai `plugins` (YouTubePluginV5). Tanpa plugin, play() akan gagal.
 * - Opsi v4 seperti leaveOnStop/leaveOnEmpty/leaveOnFinish/searchSongs SUDAH DIHAPUS.
 * - Event `error` signature = (error, queue, song), BUKAN (channel, error).
 * - Event `finish` (bukan `finishQueue`). Tidak ada event `empty` di v5.
 *
 * Hanya Mas Joy yang boleh pakai. Validasi dilakukan di bot.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DisTube, RepeatMode, Song, Playlist, ExtractorPlugin } = require('distube');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { YouTubePluginV5, MAX_PLAYLIST_SONGS, extractVideoId } = require('./youtubePluginV5');
const { TikTokPlugin, isTikTokUrl } = require('./tiktokPlugin');
const { SpotifyPlugin, isSpotifyUrl } = require('./spotifyPlugin');
const youtubePlaylist = require('./youtubePlaylist');
const playbackHistoryStore = require('./playbackHistoryStore');
const sfxStore = require('./sfxStore');
const lyricsStore = require('./lyricsStore');

class SfxPlugin extends ExtractorPlugin {
  constructor() {
    super();
  }

  validate(url) {
    return typeof url === 'string' && (url.includes('/api/sfx/stream') || url === 'sfx://current');
  }

  async resolve(url, options = {}) {
    const sfxInfo = sfxStore.getSfxInfo();
    const streamUrl = sfxStore.getStreamUrl();
    return new Song(
      {
        plugin: this,
        source: 'sfx',
        playFromSource: true,
        id: 'sfx-current',
        name: `🔊 ${sfxInfo?.originalName || 'Audio SFX'}`,
        url: streamUrl,
        duration: Number(sfxInfo?.duration) || 0,
        formattedDuration: sfxInfo?.formattedDuration || '00:00',
      },
      options
    );
  }

  async getStreamURL(song) {
    return sfxStore.getStreamUrl();
  }
}

let distubeInstance = null;
let youtubePluginInstance = null;
let tiktokPluginInstance = null;
let spotifyPluginInstance = null;
let sfxPluginInstance = null;
// Cache status shuffle per guild (v5 tidak expose `queue.shuffled`)
const shuffleState = new Map();
// Cache pesan Now Playing per guild — untuk edit-in-place saat loop
const nowPlayingMessages = new Map(); // guildId → { message, songId, interval? }
// Cache interval progress per guild — untuk update embed tiap 5 detik
const playerProgress = new Map(); // guildId → { interval }
// Cache halaman queue per guild yang sedang ditampilkan di embed
const queuePageState = new Map(); // guildId → { page: number, showing: boolean }
// Cache tombol switch cepat playlist per guild (Play {playlist} Now)
const pendingPlaylistSwitch = new Map(); // guildId → playlist object
// Cache lirik lagu yang sedang diputar per guild
const guildLyrics = new Map(); // guildId → { songId, lyrics }
// Cache notifikasi lagu yang baru ditambahkan ke antrian per guild (10 detik)
const recentQueueAdds = new Map(); // guildId → { text: string, timer: Timeout, expiresAt: number }

function setRecentQueueAdd(guildId, text) {
  if (!guildId) return;
  const existing = recentQueueAdds.get(guildId);
  if (existing?.timer) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    recentQueueAdds.delete(guildId);
    renderPlayerView(guildId).catch(() => {});
  }, 10000);

  recentQueueAdds.set(guildId, { text, timer, expiresAt: Date.now() + 10000 });
}

function clearRecentQueueAdd(guildId) {
  if (!guildId) return;
  const existing = recentQueueAdds.get(guildId);
  if (existing?.timer) clearTimeout(existing.timer);
  recentQueueAdds.delete(guildId);
}

/**
 * Buat embed notifikasi kecil (hijau) di bawah embed player utama
 * untuk lagu/playlist yang baru saja ditambahkan ke antrian.
 * Kadaluarsa otomatis setelah 10 detik.
 */
function buildQueueAddEmbed(guildId) {
  const recentAdd = guildId ? recentQueueAdds.get(guildId) : null;
  if (!recentAdd || !recentAdd.text) return null;
  if (recentAdd.expiresAt && Date.now() >= recentAdd.expiresAt) return null;
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setDescription(`-# 🟢 ${recentAdd.text}`);
}

function setPendingPlaylistSwitch(guildId, playlist) {
  if (!guildId) return;
  pendingPlaylistSwitch.set(guildId, playlist);
}

function getPendingPlaylistSwitch(guildId) {
  if (!guildId) return null;
  return pendingPlaylistSwitch.get(guildId) || null;
}

function clearPendingPlaylistSwitch(guildId) {
  if (!guildId) return;
  pendingPlaylistSwitch.delete(guildId);
}

function getFfmpegPath() {
  try {
    return require('ffmpeg-static') || undefined;
  } catch (e) {
    return undefined;
  }
}

/** Terjemahkan error teknis jadi pesan yang enak dibaca. */
function describeMusicError(message) {
  const text = String(message || '');
  if (/429|rate_limited|too many requests/i.test(text)) {
    return 'YouTube lagi nge-limit request (429) 😭 coba lagi beberapa menit ya';
  }
  if (/sign in to confirm|not a bot|login_required/i.test(text)) {
    return 'YouTube minta verifikasi bot nih mas joy 😭 perlu cookies atau coba lagi nanti';
  }
  if (/empty playlist|playlist kosong/i.test(text)) {
    return 'playlist-nya kosong atau private mas joy 😭';
  }
  if (/playable formats/i.test(text)) {
    return 'YouTube lagi ga ngasih format audio buat lagu itu 😭 coba lagu lain atau ulangi nanti';
  }
  if (/410|unavailable|not available|video unavailable/i.test(text)) {
    return 'video-nya ga bisa diakses mas joy 😭';
  }
  if (/tiktok.*private|stream url tidak ditemukan/i.test(text)) {
    return 'video TikTok-nya private atau udah dihapus mas joy 😭';
  }
  if (/tiktok.*timeout|tiktok request/i.test(text)) {
    return 'TikTok lagi lambat / ga bisa diakses mas joy, coba lagi nanti 😭';
  }
  if (/spotify.*tidak ditemukan|spotify.*empty|spotify.*kosong/i.test(text)) {
    return 'lagu atau playlist Spotify-nya ga bisa dimuat / kosong mas joy 😭';
  }
  return 'uhh ada error pas muter musik nih 😭';
}

/** Retry sekali untuk error sementara (429/timeout), supaya tidak langsung menyerah. */
function addStreamRetry(plugin, retries = 1, delayMs = 3000) {
  const original = plugin.getStreamURL.bind(plugin);
  plugin.getStreamURL = async (song) => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await original(song);
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err);
        const transient = /429|too many requests|ETIMEDOUT|ECONNRESET|socket hang up/i.test(msg);
        if (!transient || attempt === retries) break;
        console.warn(`[MUSIC] getStreamURL gagal (${msg}), retry ${attempt + 1}/${retries}...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  };
}

/**
 * Cookies YouTube opsional. Membantu kalau IP kena 429 / bot-check.
 * Sumber:
 * - env YOUTUBE_COOKIES (JSON array, header "name=value; ...", atau Netscape)
 * - data/youtube_cookies.json (hasil scripts/import-youtube-cookies.js)
 *
 * ytdl-core v5 menerima cookie dalam bentuk string header.
 */
function toCookieHeader(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const parts = value
      .filter((cookie) => cookie && cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return parts.length ? parts.join('; ') : undefined;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getYoutubeCookie() {
  if (process.env.YOUTUBE_COOKIES) {
    const raw = process.env.YOUTUBE_COOKIES.trim();
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try {
        const header = toCookieHeader(JSON.parse(raw));
        if (header) return header;
      } catch (e) {
        console.warn('[MUSIC] YOUTUBE_COOKIES bukan JSON valid, dipakai sebagai teks.');
      }
    }
    // Header "name=value; ..." atau ekspor Netscape
    if (raw) return raw;
  }

  try {
    const file = path.resolve(__dirname, '../data/youtube_cookies.json');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) return undefined;
      if (raw.startsWith('[') || raw.startsWith('{')) {
        return toCookieHeader(JSON.parse(raw));
      }
      // Netscape cookies.txt
      return raw;
    }
  } catch (e) {
    console.warn('[MUSIC] Gagal membaca data/youtube_cookies.json:', e.message);
  }
  return undefined;
}

/**
 * Inisialisasi DisTube. Dipanggil sekali saat bot ready.
 * @param {import('discord.js').Client} client
 */
function initDisTube(client) {
  if (distubeInstance) return distubeInstance;

  const ffmpegPath = getFfmpegPath();
  const cookie = getYoutubeCookie();

  youtubePluginInstance = new YouTubePluginV5(cookie ? { cookie } : {});
  addStreamRetry(youtubePluginInstance);
  if (cookie) console.log('[MUSIC] YouTube cookies loaded');

  tiktokPluginInstance = new TikTokPlugin();
  spotifyPluginInstance = new SpotifyPlugin({ youtubePlugin: youtubePluginInstance });
  sfxPluginInstance = new SfxPlugin();

  distubeInstance = new DisTube(client, {
    plugins: [youtubePluginInstance, tiktokPluginInstance, spotifyPluginInstance, sfxPluginInstance],
    emitNewSongOnly: true,
    savePreviousSongs: true,
    nsfw: false,
    emitAddSongWhenCreatingQueue: true,
    emitAddListWhenCreatingQueue: true,
    joinNewVoiceChannel: true,
    ...(ffmpegPath ? { ffmpeg: { path: ffmpegPath } } : {}),
  });

  distubeInstance.on('playSong', async (queue, song) => {
    console.log(`[MUSIC] Playing in #${queue.voiceChannel?.name || '?'}: ${song.name} (${song.formattedDuration})`);
    playbackHistoryStore.addSongToHistory(song);

    const guildId = queue.voiceChannel?.guild?.id || queue.id;
    if (guildId) {
      guildLyrics.delete(guildId);
      if (song.source !== 'sfx') {
        lyricsStore.getLyrics(song.name, song.uploader?.name || '', song.duration).then((lyrics) => {
          if (lyrics && (lyrics.lines?.length > 0 || lyrics.plainLyrics)) {
            const currentSong = queue.songs && queue.songs[0];
            if (currentSong && (currentSong.id === song.id || currentSong.name === song.name)) {
              guildLyrics.set(guildId, {
                songId: song.id || song.url || song.name,
                songName: song.name,
                lyrics,
              });
              renderPlayerView(guildId).catch(() => {});
            }
          }
        }).catch(() => {});
      }
    }

    await sendOrUpdateNowPlaying(queue.textChannel, queue, song);
  });

  distubeInstance.on('addSong', (queue, song) => {
    console.log(`[MUSIC] Added to queue: ${song.name}`);
    const guildId = queue.voiceChannel?.guild?.id || queue.id;
    if (!guildId) return;

    // Jika lagu ditambah ke antrian yang sedang berjalan -> notifikasi embed kecil hijau di bawah player (10 detik)
    if (queue.songs.length > 1) {
      const pos = queue.songs.length;
      const text = `Ditambahkan: **${song.name}** \`(${song.formattedDuration})\` • antrian #${pos}`;
      setRecentQueueAdd(guildId, text);
      renderPlayerView(guildId).catch(() => {});
    }
  });

  distubeInstance.on('addList', (queue, playlist) => {
    console.log(`[MUSIC] Added playlist: ${playlist.name} (${playlist.songs.length} songs)`);
    const guildId = queue.voiceChannel?.guild?.id || queue.id;
    if (!guildId) return;

    const text = `Ditambahkan playlist: **${playlist.name}** \`(${playlist.songs.length} lagu)\``;
    setRecentQueueAdd(guildId, text);
    renderPlayerView(guildId).catch(() => {});
  });

  // v5: error signature = (error, queue, song)
  distubeInstance.on('error', (error, queue) => {
    const message = String(error?.message || error);
    console.error('[MUSIC ERROR]', message);
    safeSend(queue?.textChannel, describeMusicError(message));
  });

  distubeInstance.on('finish', async (queue) => {
    console.log(`[MUSIC] Queue finished in #${queue.voiceChannel?.name || '?'}`);
    const guildId = queue.voiceChannel?.guild?.id;
    if (guildId) {
      guildLyrics.delete(guildId);
      pendingPlaylistSwitch.delete(guildId);
    }
    await markNowPlayingEnded(guildId, '⏹ Queue selesai');
    safeSend(queue.textChannel, 'udah habis playlist-nya mas joy, mau muter lagi atau ganti? wkwk');
  });

  distubeInstance.on('disconnect', (queue) => {
    const guildId = queue.voiceChannel?.guild?.id || queue.id;
    shuffleState.delete(guildId);
    nowPlayingMessages.delete(guildId);
    pendingPlaylistSwitch.delete(guildId);
    guildLyrics.delete(guildId);
    clearRecentQueueAdd(guildId);
    console.log(`[MUSIC] Disconnected from #${queue.voiceChannel?.name || '?'}`);
  });

  console.log('[MUSIC] DisTube v5 initialized (YouTubePluginV5 + TikTokPlugin + SpotifyPlugin active)');
  return distubeInstance;
}

function isLyricEntryMatch(lyricEntry, song) {
  if (!lyricEntry || !lyricEntry.lyrics || !song) return false;
  return Boolean(
    lyricEntry.songId === song.id ||
    lyricEntry.songId === song.url ||
    lyricEntry.songId === song.name ||
    (song.name && lyricEntry.songName === song.name)
  );
}

/**
 * Format detik → MM:SS
 */
function fmt(t) {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Progress bar teks: 00:30 ━━━━━●━━━━━━━━ 03:45
 * Panjang track 20 char, posisi kepala (●) di slot yang proporsional.
 */
function buildProgressBar(current, total) {
  const TRACK = 20;
  const pct = total > 0 ? Math.min(1, current / total) : 0;
  const head = Math.round(TRACK * pct);
  const left  = '━'.repeat(head);
  const right = '━'.repeat(TRACK - head);
  return `\`${fmt(current)}\` ${left}●${right} \`${fmt(total)}\``;
}

/**
 * Buat embed "Now Playing" card.
 */
function buildNowPlayingEmbed(song, queue, { currentTime = 0, isPaused = false, isLoop = false } = {}) {
  const repeatMode = queue?.repeatMode ?? 0;
  const shuffled   = queue ? isShuffled(queue.voiceChannel?.guild?.id) : false;

  const badgeParts = [];
  if (isPaused)                   badgeParts.push('⏸ Paused');
  if (repeatMode === 1 || isLoop) badgeParts.push('🔂 Loop');
  if (repeatMode === 2)           badgeParts.push('🔁 Queue Loop');
  if (shuffled)                   badgeParts.push('🔀 Shuffle');
  const badges = badgeParts.length ? badgeParts.join('  ·  ') : '▶ Playing';

  const queueSize = (queue?.songs?.length ?? 1) - 1;

  // Durasi lagu yang sedang diputar (BUKAN total queue)
  const total   = Math.max(1, Number(song.duration) || 0);
  const current = Math.max(0, Number(currentTime));

  const progressBar = buildProgressBar(current, total);

  // Sumber lagu (YouTube / TikTok / SFX / dll)
  let source = 'Unknown';
  if (song.source === 'sfx') {
    source = 'Audio Lokal (SFX)';
  } else if (song.source) {
    source = song.source.charAt(0).toUpperCase() + song.source.slice(1);
  }

  // Warna: ungu saat playing, abu saat pause
  const color = isPaused ? 0x747F8D : 0x9B59B6;

  const guildId = queue?.voiceChannel?.guild?.id || queue?.id;
  const lyricEntry = guildId ? guildLyrics.get(guildId) : null;
  let lyricText = '';

  if (isLyricEntryMatch(lyricEntry, song)) {
    const lines = lyricEntry.lyrics.lines;
    if (lines && lines.length > 0) {
      const snippet = lyricsStore.getCurrentSnippet(lines, current);
      if (snippet) {
        const parts = [];
        if (snippet.prev?.text) parts.push(`-# *${snippet.prev.text}*`);
        parts.push(`💬 **${snippet.current.text}**`);
        if (snippet.next?.text) parts.push(`-# *${snippet.next.text}*`);
        lyricText = parts.join('\n');
      }
    } else if (lyricEntry.lyrics.plainLyrics) {
      lyricText = '-# 📜 *Lirik teks tersedia (klik tombol 📜 Lirik untuk melihat)*';
    }
  }

  const descParts = [
    progressBar,
    '',
    `\`${badges}\``,
  ];

  if (lyricText) {
    descParts.push('', '-# 🎤 Lirik:', lyricText);
  }

  const description = descParts.join('\n');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: isPaused ? '⏸ Dipaused' : '🎵 Now Playing' })
    .setTitle(song.name)
    .setURL(song.url || null)
    .setThumbnail(song.thumbnail || null)
    .setDescription(description)
    .addFields(
      { name: '👤 Diminta oleh', value: song.member?.displayName || 'Mas Joy', inline: true },
      { name: '🎧 Sumber',       value: source,                                 inline: true },
      { name: '📋 Antrian',      value: queueSize > 0 ? `${queueSize} lagu lagi` : 'Lagu terakhir', inline: true },
    );

  embed.setFooter({ text: `Durasi total: ${fmt(total)}` });

  return embed;
}

// Build the button row separately (discord.js v14: components go on the message, not the embed)
function buildPlayerComponents(queue, isPaused, { viewMode = 'player', showingQueue = false, queuePage = 0, totalSongs = 0 } = {}) {
  const currentView = viewMode || (showingQueue ? 'queue' : 'player');
  const isQueue = currentView === 'queue' || showingQueue;
  const isLyrics = currentView === 'lyrics';
  const SONGS_PER_PAGE = 10;
  const hasMultiPage = totalSongs > SONGS_PER_PAGE + 1; // +1 karena lagu pertama = now playing
  const guildId = queue?.voiceChannel?.guild?.id || queue?.id;
  const shuffled = guildId ? isShuffled(guildId) : false;
  const repeatMode = queue?.repeatMode ?? 0;

  // Baris 1: Kontrol Playback
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('player_prev')
      .setLabel('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!(queue && queue.songs && queue.songs.length > 1)),
    new ButtonBuilder()
      .setCustomId('player_pause')
      .setLabel(isPaused ? '▶️' : '⏸️')
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('player_skip')
      .setLabel('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player_stop')
      .setLabel('⏹️')
      .setStyle(ButtonStyle.Danger),
  );

  // Baris 2: Mode (Loop, Shuffle) & Queue & Lirik
  let loopLabel = '🔂 Loop';
  let loopStyle = ButtonStyle.Secondary;
  if (repeatMode === 1) {
    loopLabel = '🔂 Loop: Lagu';
    loopStyle = ButtonStyle.Primary;
  } else if (repeatMode === 2) {
    loopLabel = '🔁 Loop: Queue';
    loopStyle = ButtonStyle.Success;
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('player_loop')
      .setLabel(loopLabel)
      .setStyle(loopStyle),
    new ButtonBuilder()
      .setCustomId('player_shuffle')
      .setLabel('🔀 Shuffle')
      .setStyle(shuffled ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!(queue && queue.songs && queue.songs.length > 1)),
    new ButtonBuilder()
      .setCustomId('player_queue')
      .setLabel(isQueue ? '🎵 Player' : '📋 Queue')
      .setStyle(isQueue ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player_lyrics')
      .setLabel(isLyrics ? '🎵 Player' : '📜 Lirik')
      .setStyle(isLyrics ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  const rows = [row1, row2];

  // Tombol Cepat: Play {playlist} Now (jika ada permintaan playlist spesifik yang baru dimasukkan antrian)
  const pendingSwitch = (guildId ? getPendingPlaylistSwitch(guildId) : null);
  if (pendingSwitch && pendingSwitch.name) {
    const playNowRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`player_play_now:${pendingSwitch.name}`)
        .setLabel(`▶️ Play "${pendingSwitch.name}" Now`)
        .setStyle(ButtonStyle.Success)
    );
    rows.push(playNowRow);
  }

  // Baris 3: Navigasi queue (hanya tampil kalau queue view aktif dan ada > 1 halaman)
  if (isQueue && hasMultiPage) {
    const canPrev = queuePage > 0;
    const maxPage = Math.ceil((totalSongs - 1) / SONGS_PER_PAGE) - 1;
    const canNext = queuePage < maxPage;
    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('player_queue_prev')
        .setLabel('◀ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canPrev),
      new ButtonBuilder()
        .setCustomId('player_queue_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canNext),
    );
    rows.push(row3);
  }

  return rows;
}

/**
 * Buat embed Full Lirik untuk tampilan monitor yang bersih dan huruf besar.
 */
function buildFullLyricsEmbed(song, queue, { currentTime = 0, isPaused = false } = {}) {
  const current = Number(currentTime) || 0;
  const total = song.duration || 0;
  const progressBar = buildProgressBar(current, total);
  const color = isPaused ? 0x747F8D : 0x9B59B6;

  const guildId = queue?.voiceChannel?.guild?.id || queue?.id;
  const lyricEntry = guildId ? guildLyrics.get(guildId) : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: isPaused ? '⏸️ Lirik (Dipaused)' : '📜 Full Lyrics' })
    .setTitle(song.name)
    .setURL(song.url || null)
    .setThumbnail(song.thumbnail || null);

  const descParts = [];

  if (song.uploader?.name) {
    descParts.push(`### 👤 *${song.uploader.name}*`, '');
  }

  const hasLyrics = isLyricEntryMatch(lyricEntry, song);

  if (hasLyrics && lyricEntry.lyrics.lines && lyricEntry.lyrics.lines.length > 0) {
    const lines = lyricEntry.lyrics.lines;
    const snippet = lyricsStore.getCurrentSnippet(lines, current);

    if (snippet?.current) {
      descParts.push(`## 💬 ${snippet.current.text}`);
      if (snippet.next?.text) {
        descParts.push(`### ⏭️ ${snippet.next.text}`);
      }
      descParts.push('');

      const currentIdx = lines.findIndex((l) => l.time === snippet.current.time && l.text === snippet.current.text);
      const start = Math.max(0, (currentIdx >= 0 ? currentIdx : 0) - 2);
      const end = Math.min(lines.length, start + 6);
      const contextLines = [];
      for (let i = start; i < end; i++) {
        if (i === currentIdx) {
          contextLines.push(`> 🎵 **${lines[i].text}**`);
        } else if (i < currentIdx) {
          contextLines.push(`-# ${lines[i].text}`);
        } else {
          contextLines.push(`${lines[i].text}`);
        }
      }
      if (contextLines.length > 0) {
        descParts.push(contextLines.join('\n'));
      }
    }
  } else if (hasLyrics && lyricEntry.lyrics.plainLyrics) {
    descParts.push('## 📜 Lirik Lengkap:', '');
    const plain = lyricEntry.lyrics.plainLyrics.trim();
    const truncated = plain.length > 3500 ? plain.slice(0, 3500) + '\n\n*... (dipotong karena batasan Discord)*' : plain;
    descParts.push(truncated);
  } else {
    descParts.push(
      '## 🔍 Lirik Belum Tersedia',
      'Callista belum menemukan lirik sinkron untuk lagu ini mas joy 🥺',
      '',
      '-# *Lagu versi instrumental, cover, atau tanpa metadata LRCLIB mungkin belum tersedia.*'
    );
  }

  descParts.push('', progressBar);
  embed.setDescription(descParts.join('\n'));
  embed.setFooter({ text: `Durasi: ${fmt(current)} / ${fmt(total)} • Tekan '🎵 Player' untuk kembali` });

  return embed;
}

/**
 * Hentikan interval update progress (lagu selesai / dihentikan / di-pause).
 */
function stopPlayerProgress(guildId) {
  const st = playerProgress.get(guildId);
  if (st?.interval) {
    clearInterval(st.interval);
    playerProgress.delete(guildId);
  }
}

/**
 * Reset interval progress (pukul mundur 3 detik dari sekarang)
 * agar aksi tombol user tidak langsung tertimpa/terinterupsi oleh tick interval.
 */
function resetPlayerProgress(guildId) {
  const st = playerProgress.get(guildId);
  if (!st || !st.sent) return;
  const q = safeGetQueue(guildId);
  if (!q || !q.songs || !q.songs.length || q.paused) return;
  const qs = queuePageState.get(guildId);
  if (qs?.showing) return;
  startPlayerProgress(guildId, st.sent, q, q.songs[0]);
}

/**
 * Start interval update progress setiap 3 detik → edit embed Now Playing.
 * Ambil queue live dari distubeInstance setiap tick agar currentTime tidak stale.
 * Berhenti otomatis kalau queue berhenti / empty / paused.
 */
function startPlayerProgress(guildId, sent, _queue, song) {
  stopPlayerProgress(guildId);
  const interval = setInterval(async () => {
    const entry = playerProgress.get(guildId);
    if (entry?.isEditing) return; // Sedang di-edit oleh aksi tombol/interaksi, skip tick ini

    // Ambil queue fresh setiap tick — closure queue bisa stale currentTime-nya
    const q = safeGetQueue(guildId);
    if (!q || !q.songs || !q.songs.length) { stopPlayerProgress(guildId); return; }
    if (q.paused) { stopPlayerProgress(guildId); return; }

    // Jangan timpa queue view yang sedang dibuka user
    const qs = queuePageState.get(guildId);
    if (qs?.showing || qs?.mode === 'queue') return;

    const liveSong = q.songs[0] || song;
    let embeds;
    let updatedComponents;

    if (qs?.mode === 'lyrics') {
      const lyricEmbed = buildFullLyricsEmbed(liveSong, q, {
        currentTime: q.currentTime || 0,
        isPaused: false,
      });
      embeds = [lyricEmbed];
      updatedComponents = buildPlayerComponents(q, false, { viewMode: 'lyrics', totalSongs: q.songs.length });
    } else {
      const updated = buildNowPlayingEmbed(liveSong, q, {
        currentTime: q.currentTime || 0,
        isPaused: false,
        isLoop: false,
      });
      embeds = [updated];
      const notif = buildQueueAddEmbed(guildId);
      if (notif) embeds.push(notif);
      updatedComponents = buildPlayerComponents(q, false, { viewMode: 'player', totalSongs: q.songs.length });
    }

    if (entry) entry.isEditing = true;
    try {
      await sent.edit({ embeds, components: updatedComponents });
    } catch (e) {
      stopPlayerProgress(guildId);
    } finally {
      const cur = playerProgress.get(guildId);
      if (cur) cur.isEditing = false;
    }
  }, 3000);
  playerProgress.set(guildId, { interval, sent, isEditing: false });
}

/**
 * Kirim atau edit card Now Playing.
 * - Lagu baru         → edit pesan yang sama, simpan ke nowPlayingMessages
 * - Lagu sama (loop)  → edit embed yang sudah ada (tidak spam chat)
 */
async function sendOrUpdateNowPlaying(channel, queue, song) {
  const guildId = queue.voiceChannel?.guild?.id || channel?.guildId;
  if (!guildId) return;

  const prev = nowPlayingMessages.get(guildId);
  const isLoop = prev && prev.songId === (song.id || song.url);

  // Hentikan interval lama kalau lagu berubah (bukan loop)
  if (!isLoop) stopPlayerProgress(guildId);

  const embed = buildNowPlayingEmbed(song, queue, {
    currentTime: queue.currentTime || 0,
    isPaused: queue.paused || false,
    isLoop
  });
  queuePageState.delete(guildId); // lagu baru: reset queue view
  const components = buildPlayerComponents(queue, queue.paused || false, { showingQueue: false, totalSongs: queue.songs.length });

  const embeds = [embed];
  const notif = buildQueueAddEmbed(guildId);
  if (notif) embeds.push(notif);

  if (isLoop && prev?.message) {
    // Edit-in-place: tidak kirim pesan baru saat repeat
    try {
      await prev.message.edit({ embeds, components });
      // Lanjutkan progress interval untuk lagu yang sama
      startPlayerProgress(guildId, prev.message, queue, song);
    } catch (e) {
      nowPlayingMessages.delete(guildId);
      await sendOrUpdateNowPlaying(channel, queue, song);
    }
    return;
  }

  // Lagu baru: edit pesan sebelumnya kalau ada, baru kirim
  try {
    if (prev?.message) {
      await prev.message.edit({ embeds, components });
      startPlayerProgress(guildId, prev.message, queue, song);
    } else {
      const sent = await channel.send({ embeds, components });
      nowPlayingMessages.set(guildId, { message: sent, songId: song.id || song.url });
      startPlayerProgress(guildId, sent, queue, song);
    }
  } catch (e) {
    console.warn('[MUSIC] Failed to send/reply Now Playing card:', e.message);
    stopPlayerProgress(guildId);
  }
}

/**
 * Edit card terakhir menjadi status "selesai" / "berhenti".
 */
async function markNowPlayingEnded(guildId, label = '⏹ Queue ended') {
  if (guildId) {
    guildLyrics.delete(guildId);
    clearRecentQueueAdd(guildId);
  }
  const prev = nowPlayingMessages.get(guildId);
  if (!prev?.message) return;
  stopPlayerProgress(guildId);
  try {
    const ended = EmbedBuilder.from(prev.message.embeds[0])
      .setColor(0x555555)
      .setAuthor({ name: label })
      .setFooter(null);
    await prev.message.edit({ embeds: [ended], components: [] });
  } catch (e) { /* pesan mungkin dihapus */ }
  nowPlayingMessages.delete(guildId);
}

function safeSend(channel, content) {
  try {
    if (channel && typeof channel.send === 'function') {
      channel.send(content).catch(() => {});
    }
  } catch (e) {}
}

const QUEUE_PAGE_SIZE = 10;

/**
 * Buat embed daftar antrian lagu (halaman-an, 10 lagu per halaman).
 * Lagu pertama (now playing) selalu tampil di header; halaman berisi lagu 2+.
 */
function buildQueueEmbed(queue, page = 0) {
  const songs = queue?.songs || [];
  const current = songs[0];
  const waiting = songs.slice(1); // lagu yang menunggu (bukan now playing)

  const totalWaiting = waiting.length;
  const totalPages = Math.max(1, Math.ceil(totalWaiting / QUEUE_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = waiting.slice(safePage * QUEUE_PAGE_SIZE, (safePage + 1) * QUEUE_PAGE_SIZE);

  const repeatMode = queue?.repeatMode ?? 0;
  const shuffled = isShuffled(queue?.voiceChannel?.guild?.id);
  const flags = [
    repeatMode === 1 ? '🔂 Loop' : null,
    repeatMode === 2 ? '🔁 Queue Loop' : null,
    shuffled ? '🔀 Shuffle' : null,
  ].filter(Boolean).join('  ·  ') || null;

  const lines = [];
  if (current) {
    lines.push(`▶ **${current.name}** \`${current.formattedDuration || '??:??'}\` ← sekarang`);
    lines.push('');
  }

  if (!slice.length) {
    lines.push('_(tidak ada lagu dalam antrian)_');
  } else {
    slice.forEach((s, i) => {
      const num = safePage * QUEUE_PAGE_SIZE + i + 2; // +2: 1=now playing, lalu lanjut
      lines.push(`\`${num}.\` ${s.name} \`${s.formattedDuration || '??:??'}\``);
    });
  }

  if (flags) lines.push('', `\`${flags}\``);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: '📋 Antrian Lagu' })
    .setDescription(lines.join('\n'))
    .setFooter({
      text: totalWaiting > 0
        ? `Halaman ${safePage + 1}/${totalPages}  ·  ${totalWaiting} lagu menunggu`
        : 'Tidak ada lagu dalam antrian',
    });

  return { embed, page: safePage, totalSongs: songs.length };
}

/**
 * Deactivate embed lama (abu-abu, hapus kontrol), lalu kirim embed baru ke channel.
 * Dipakai oleh perintah >player / >plr.
 */
async function refreshPlayer(guildId, channel) {
  const q = safeGetQueue(guildId);
  if (!q || !q.songs || !q.songs.length) {
    return { success: false, code: 'NO_QUEUE' };
  }
  const song = q.songs[0];

  // Matikan embed lama
  const prev = nowPlayingMessages.get(guildId);
  stopPlayerProgress(guildId);
  if (prev?.message) {
    try {
      const deactivated = EmbedBuilder.from(prev.message.embeds[0])
        .setColor(0x36393F)
        .setAuthor({ name: '⬛ Player Tidak Aktif' })
        .setFooter({ text: 'Gunakan >player untuk memperbarui' });
      await prev.message.edit({ embeds: [deactivated], components: [] });
    } catch (e) { /* pesan mungkin sudah dihapus */ }
    nowPlayingMessages.delete(guildId);
  }

  // Kirim embed baru
  const embed = buildNowPlayingEmbed(song, q, {
    currentTime: q.currentTime || 0,
    isPaused: q.paused || false,
  });
  queuePageState.delete(guildId);
  const components = buildPlayerComponents(q, q.paused || false, { showingQueue: false, totalSongs: q.songs.length });
  const embeds = [embed];
  const notif = buildQueueAddEmbed(guildId);
  if (notif) embeds.push(notif);
  try {
    const sent = await channel.send({ embeds, components });
    nowPlayingMessages.set(guildId, { message: sent, songId: song.id || song.url });
    startPlayerProgress(guildId, sent, q, song);
    return { success: true };
  } catch (e) {
    return { success: false, code: 'SEND_FAIL', error: e.message };
  }
}

/**
 * Render ulang embed player / queue saat ini (mis. setelah pause/resume/loop/shuffle).
 * @returns {boolean} true kalau berhasil edit
 */
async function renderPlayerView(guildId) {
  const prev = nowPlayingMessages.get(guildId);
  if (!prev?.message) return false;

  const q = safeGetQueue(guildId);
  if (!q || !q.songs || !q.songs.length) return false;
  const song = q.songs[0];

  const state = queuePageState.get(guildId) || { showing: false, mode: 'player', page: 0 };
  const entry = playerProgress.get(guildId);
  if (entry) entry.isEditing = true;

  try {
    if (state.mode === 'lyrics') {
      const embed = buildFullLyricsEmbed(song, q, {
        currentTime: q.currentTime || 0,
        isPaused: q.paused || false,
      });
      const components = buildPlayerComponents(q, q.paused || false, { viewMode: 'lyrics', totalSongs: q.songs.length });
      await prev.message.edit({ embeds: [embed], components });
      return true;
    } else if (state.mode === 'queue' || state.showing) {
      const { embed, page, totalSongs } = buildQueueEmbed(q, state.page);
      const components = buildPlayerComponents(q, q.paused || false, { viewMode: 'queue', showingQueue: true, queuePage: page, totalSongs });
      await prev.message.edit({ embeds: [embed], components });
      return true;
    } else {
      const embed = buildNowPlayingEmbed(song, q, {
        currentTime: q.currentTime || 0,
        isPaused: q.paused || false,
      });
      const components = buildPlayerComponents(q, q.paused || false, { viewMode: 'player', showingQueue: false, totalSongs: q.songs.length });
      const embeds = [embed];
      const notif = buildQueueAddEmbed(guildId);
      if (notif) embeds.push(notif);
      await prev.message.edit({ embeds, components });
      if (!q.paused) {
        resetPlayerProgress(guildId);
      }
      return true;
    }
  } catch (e) {
    return false;
  } finally {
    if (entry) entry.isEditing = false;
  }
}

/**
 * Toggle queue view di embed Now Playing yang ada.
 * - Saat buka queue: hentikan interval update progress agar tampilan antrian tidak terganggu/tertimpa.
 * - Saat kembali ke player: render tampilan player dan nyalakan kembali interval progress.
 * @returns {boolean} true kalau berhasil edit
 */
async function toggleQueueView(guildId, pageOffset = 0) {
  const prev = nowPlayingMessages.get(guildId);
  if (!prev?.message) return false;

  const q = safeGetQueue(guildId);
  if (!q || !q.songs || !q.songs.length) return false;

  const state = queuePageState.get(guildId) || { showing: false, mode: 'player', page: 0 };

  if (pageOffset !== 0) {
    // Navigasi halaman queue (Prev / Next) — pastikan interval tetap berhenti
    stopPlayerProgress(guildId);
    const newPage = Math.max(0, state.page + pageOffset);
    queuePageState.set(guildId, { showing: true, mode: 'queue', page: newPage });
    return renderPlayerView(guildId);
  }

  // Toggle tombol Queue <-> Player
  const toQueue = state.mode !== 'queue';
  if (toQueue) {
    // 1. Tampilkan Queue: Hentikan interval agar tidak ada interupsi update progres
    stopPlayerProgress(guildId);
    queuePageState.set(guildId, { showing: true, mode: 'queue', page: 0 });
    return renderPlayerView(guildId);
  } else {
    // 2. Kembali ke Player: Render tampilan player dan nyalakan kembali interval progres
    queuePageState.set(guildId, { showing: false, mode: 'player', page: 0 });
    const ok = await renderPlayerView(guildId);
    if (ok && !q.paused) {
      const liveSong = q.songs[0];
      startPlayerProgress(guildId, prev.message, q, liveSong);
    }
    return ok;
  }
}

/**
 * Toggle Full Lirik view di embed Now Playing yang ada.
 * - Saat buka lyrics: switch mode = 'lyrics'
 * - Saat kembali ke player: switch mode = 'player'
 * @returns {boolean} true kalau berhasil edit
 */
async function toggleLyricsView(guildId) {
  const prev = nowPlayingMessages.get(guildId);
  if (!prev?.message) return false;

  const q = safeGetQueue(guildId);
  if (!q || !q.songs || !q.songs.length) return false;

  const state = queuePageState.get(guildId) || { showing: false, mode: 'player', page: 0 };
  const toLyrics = state.mode !== 'lyrics';

  if (toLyrics) {
    const song = q.songs[0];
    const lyricEntry = guildLyrics.get(guildId);
    if (!isLyricEntryMatch(lyricEntry, song) && song.source !== 'sfx') {
      lyricsStore.getLyrics(song.name, song.uploader?.name || '', song.duration).then((lyrics) => {
        if (lyrics && (lyrics.lines?.length > 0 || lyrics.plainLyrics)) {
          const liveQ = safeGetQueue(guildId);
          const currentSong = liveQ?.songs?.[0];
          if (currentSong && (currentSong.id === song.id || currentSong.name === song.name)) {
            guildLyrics.set(guildId, {
              songId: song.id || song.url || song.name,
              songName: song.name,
              lyrics,
            });
            renderPlayerView(guildId).catch(() => {});
          }
        }
      }).catch(() => {});
    }

    queuePageState.set(guildId, { showing: false, mode: 'lyrics', page: 0 });
    const ok = await renderPlayerView(guildId);
    if (ok && !q.paused) {
      const liveSong = q.songs[0];
      startPlayerProgress(guildId, prev.message, q, liveSong);
    }
    return ok;
  } else {
    queuePageState.set(guildId, { showing: false, mode: 'player', page: 0 });
    const ok = await renderPlayerView(guildId);
    if (ok && !q.paused) {
      const liveSong = q.songs[0];
      startPlayerProgress(guildId, prev.message, q, liveSong);
    }
    return ok;
  }
}

function getDisTube() {
  return distubeInstance;
}

/**
 * DisTube v5 menolak play jika sudah ada koneksi @discordjs/voice mentah
 * di guild (error VOICE_ALREADY_CREATED) — misalnya dari JOIN_VOICE manual.
 * Hapus koneksi "asing" itu, tapi JANGAN hapus koneksi milik DisTube sendiri.
 */
async function clearForeignVoiceConnection(guildId) {
  if (!distubeInstance || !guildId) return;
  try {
    // Jika DisTube sudah punya koneksi voice sah di guild ini, jangan ganggu
    if (distubeInstance.voices.get(guildId)) return;

    const { getGroups } = require('@discordjs/voice');
    let destroyed = false;
    if (typeof getGroups === 'function') {
      for (const [, groupMap] of getGroups()) {
        const c = groupMap.get(guildId);
        if (c) {
          voiceUtils.markExpectedLeave(guildId);
          try { c.destroy(); } catch (_) {}
          destroyed = true;
        }
      }
    }
    if (destroyed) {
      console.log(`[MUSIC] Destroyed unmanaged voice connection in guild ${guildId} before play`);
      await new Promise(r => setTimeout(r, 350));
    }
  } catch (e) {
    // diamkan saja
  }
}

/**
 * Bungkus pemanggilan distubeInstance.play dengan auto-recovery jika terjadi VOICE_ALREADY_CREATED
 */
async function safeDistubePlay(voiceChannel, target, playOptions) {
  const guildId = voiceChannel.guildId || voiceChannel.guild?.id;
  await clearForeignVoiceConnection(guildId);
  try {
    return await distubeInstance.play(voiceChannel, target, playOptions);
  } catch (err) {
    const isVoiceConflict = err.errorCode === 'VOICE_ALREADY_CREATED' ||
      /already has a voice connection/i.test(err.message || '');
    if (isVoiceConflict) {
      console.warn(`[MUSIC] Caught VOICE_ALREADY_CREATED in guild ${guildId}, forcing voice cleanup & retrying...`);
      try { distubeInstance.voices.leave(guildId); } catch (_) {}
      try {
        const { getGroups } = require('@discordjs/voice');
        if (typeof getGroups === 'function') {
          for (const [, groupMap] of getGroups()) {
            const c = groupMap.get(guildId);
            if (c) {
              voiceUtils.markExpectedLeave(guildId);
              try { c.destroy(); } catch (_) {}
            }
          }
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
      return await distubeInstance.play(voiceChannel, target, playOptions);
    }
    throw err;
  }
}

/**
 * Tentukan VC tujuan musik:
 * 1. Jika Mas Joy dan Callista di VC yang sama -> langsung pakai VC tersebut.
 * 2. Jika Callista SUDAH berada di suatu VC dan Mas Joy di chat teks -> pakai VC tempat Callista berada (tanpa keluar masuk manual).
 * 3. Jika Mas Joy di VC lain / Callista belum masuk -> ikuti VC Mas Joy.
 *
 * @param {object} member - GuildMember Mas Joy
 * @param {Function} [connectionLookup] - opsional, untuk pengujian
 */
function resolveVoiceChannel(member, connectionLookup) {
  const guild = member?.guild;
  const memberVoice = member?.voice?.channel;
  const botVoice = guild?.members?.me?.voice?.channel;

  // 1. Jika Mas Joy dan Callista di VC yang sama -> langsung pakai VC tersebut
  if (memberVoice && botVoice && memberVoice.id === botVoice.id) {
    return botVoice;
  }

  // 2. Jika Callista SUDAH berada di suatu VC dan member tidak sedang di VC mana pun -> pakai VC tempat Callista berada
  if (botVoice && !memberVoice) {
    return botVoice;
  }

  // 3. Jika member berada di VC (dan Callista belum di VC atau member ada di VC lain) -> ikuti VC member
  if (memberVoice) {
    return memberVoice;
  }

  // 4. Jika Callista sudah di VC (fallback)
  if (botVoice) {
    return botVoice;
  }

  // 5. VC milik DisTube (kalau queue/voice sudah ada)
  try {
    const dtVoice = distubeInstance?.voices?.get(guild?.id);
    if (dtVoice?.channel) return dtVoice.channel;
  } catch (e) {
    // lanjut ke pengecekan koneksi mentah
  }

  // 6. Koneksi @discordjs/voice mentah (dibuat oleh JOIN_VOICE manual)
  try {
    const lookup = connectionLookup || require('@discordjs/voice').getVoiceConnection;
    if (guild?.id) {
      const conn = lookup(guild.id);
      const channelId = conn?.joinConfig?.channelId;
      if (channelId) {
        const channel = guild.channels?.cache?.get?.(channelId) || (typeof guild.channels?.cache?.get === 'function' ? guild.channels.cache.get(channelId) : null);
        if (channel) return channel;
      }
    }
  } catch (e) {
    // abaikan
  }

  return null;
}

/**
 * Susun objek Playlist DisTube dari hasil resolver kita.
 * Song dibuat langsung (tanpa resolve network per lagu) agar cepat & ringan.
 */
function buildPlaylist(member, info) {
  const songs = info.videos.map((v) => {
    // Playlist lokal boleh berisi lagu YouTube, TikTok, maupun Spotify — plugin dipilih per URL.
    const url = v.url || `https://www.youtube.com/watch?v=${v.id}`;
    const tiktok = isTikTokUrl(url);
    const spotify = isSpotifyUrl(url);
    return new Song(
      {
        plugin: spotify ? spotifyPluginInstance : (tiktok ? tiktokPluginInstance : youtubePluginInstance),
        source: spotify ? 'spotify' : (tiktok ? 'tiktok' : 'youtube'),
        playFromSource: true,
        id: v.id || url,
        name: v.title || v.id,
        url,
        thumbnail: v.thumbnail,
        duration: v.duration || 0,
      },
      { member }
    );
  });

  return new Playlist(
    {
      source: 'youtube',
      id: info.id,
      name: info.name,
      url: `https://www.youtube.com/playlist?list=${info.id}`,
      thumbnail: songs.find((s) => s.thumbnail)?.thumbnail,
      songs,
    },
    { member }
  );
}

function isVideoUrl(url) {
  return Boolean(extractVideoId(url)) || isTikTokUrl(url) || isSpotifyUrl(url);
}

function videoId(url) {
  return extractVideoId(url);
}

/**
 * Ambil metadata satu video YouTube (judul/durasi) untuk disimpan ke playlist lokal.
 * Return null kalau input ternyata playlist (bukan satu lagu).
 */
async function resolveSongInfo(url, timeoutMs = 10000) {
  if (!distubeInstance) throw new Error('DisTube not initialized');
  let timer;
  try {
    const resolved = await Promise.race([
      distubeInstance.handler.resolve(url),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('resolve timeout')), timeoutMs);
      }),
    ]);
    if (!resolved || Array.isArray(resolved.songs)) return null;
    const id = resolved.id || extractVideoId(url);
    return {
      id,
      name: resolved.name || `YouTube ${id}`,
      url: resolved.url || url,
      duration: resolved.duration || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function playPlaylist(member, textChannel, playlistOrUrl, options = {}) {
  if (!distubeInstance) throw new Error('DisTube not initialized');
  const voiceChannel = resolveVoiceChannel(member);
  if (!voiceChannel) {
    return { success: false, code: 'NO_VOICE', error: 'Tidak ada VC tujuan' };
  }

  // Playlist lokal (kumpulan lagu hasil >add), bukan playlist YouTube remote.
  if (playlistOrUrl && typeof playlistOrUrl === 'object' && Array.isArray(playlistOrUrl.songs)) {
    const songs = playlistOrUrl.songs;
    if (!songs.length) {
      return { success: false, code: 'EMPTY_PLAYLIST', error: 'Playlist lokal kosong' };
    }

    const playlist = buildPlaylist(member, {
      id: playlistOrUrl.id,
      name: playlistOrUrl.name,
      videos: songs.map((song) => ({
        id: song.id || extractVideoId(song.url),
        title: song.title,
        url: song.url,
        duration: song.duration || 0,
      })),
    });

    await safeDistubePlay(voiceChannel, playlist, {
      member,
      textChannel,
      skip: Boolean(options.skip),
      metadata: { source: 'local_playlist', playlistId: playlistOrUrl.id, ...options.metadata },
    });

    return {
      success: true,
      voiceChannel,
      playlist: { name: playlistOrUrl.name, total: songs.length },
    };
  }

  const playlistUrl = typeof playlistOrUrl === 'object'
    ? String(playlistOrUrl?.url || '')
    : String(playlistOrUrl || '');
  const playlistId = youtubePlaylist.extractPlaylistId(playlistUrl);
  if (!playlistId) {
    // Bukan URL playlist (mis. link video) -> mainkan sebagai lagu tunggal
    return playSong(member, textChannel, playlistUrl, options);
  }

  const info = await youtubePlaylist.fetchPlaylist(playlistId, {
    maxSongs: MAX_PLAYLIST_SONGS,
  });
  const playlist = buildPlaylist(member, info);

  await safeDistubePlay(voiceChannel, playlist, {
    member,
    textChannel,
    skip: Boolean(options.skip),
    metadata: { source: 'playlist', ...options.metadata },
  });

  if (info.videos.length >= MAX_PLAYLIST_SONGS) {
    console.warn(
      `[MUSIC] Playlist "${info.name}" dipotong ke ${MAX_PLAYLIST_SONGS} lagu pertama.`
    );
  }

  return {
    success: true,
    voiceChannel,
    playlist: { name: info.name, total: info.videos.length },
  };
}

/**
 * Langsung ganti lagu aktif dan antrian saat ini dengan playlist baru tanpa menunggu lagu selesai.
 */
async function playPlaylistNow(member, textChannel, playlistOrUrl, options = {}) {
  if (!distubeInstance) throw new Error('DisTube not initialized');
  const voiceChannel = resolveVoiceChannel(member);
  if (!voiceChannel) {
    return { success: false, code: 'NO_VOICE', error: 'Tidak ada VC tujuan' };
  }

  const guildId = voiceChannel.guildId;
  stopPlayerProgress(guildId);
  const queue = safeGetQueue(guildId);
  if (queue && queue.songs && queue.songs.length > 0) {
    // Sisakan hanya lagu aktif pertama karena skip: true akan men-skip lagu tersebut
    queue.songs = [queue.songs[0]];
  }
  clearPendingPlaylistSwitch(guildId);

  return playPlaylist(member, textChannel, playlistOrUrl, { ...options, skip: true });
}

async function playSong(member, textChannel, query, options = {}) {
  if (!distubeInstance) throw new Error('DisTube not initialized');
  const voiceChannel = resolveVoiceChannel(member);
  if (!voiceChannel) {
    return { success: false, code: 'NO_VOICE', error: 'Tidak ada VC tujuan' };
  }

  await safeDistubePlay(voiceChannel, query, {
    member,
    textChannel,
    metadata: { source: 'song', ...options.metadata },
  });

  return { success: true, voiceChannel };
}

async function playSfx(member, textChannel, options = {}) {
  if (!distubeInstance) throw new Error('DisTube not initialized');
  if (!sfxStore.hasSfx()) {
    return { success: false, code: 'NO_SFX', error: 'Belum ada SFX yang dimuat' };
  }

  const voiceChannel = resolveVoiceChannel(member);
  if (!voiceChannel) {
    return { success: false, code: 'NO_VOICE', error: 'Tidak ada VC tujuan' };
  }

  clearForeignVoiceConnection(voiceChannel.guildId);

  const sfxInfo = sfxStore.getSfxInfo();
  const streamUrl = sfxStore.getStreamUrl();

  const sfxSong = new Song(
    {
      source: 'sfx',
      playFromSource: true,
      id: 'sfx-current',
      name: `🔊 ${sfxInfo?.originalName || 'Audio SFX'}`,
      url: streamUrl,
      duration: Number(sfxInfo?.duration) || 0,
      formattedDuration: sfxInfo?.formattedDuration || '00:00',
      thumbnail: undefined,
    },
    { member, metadata: { source: 'sfx', ...options.metadata } }
  );
  sfxSong.stream.url = streamUrl;

  await safeDistubePlay(voiceChannel, sfxSong, {
    member,
    textChannel,
    skip: Boolean(options.skip),
    metadata: { source: 'sfx', ...options.metadata },
  });

  return { success: true, voiceChannel, song: sfxSong };
}

function safeGetQueue(guildId) {
  if (!distubeInstance) return null;
  try {
    return distubeInstance.getQueue(guildId) || null;
  } catch (e) {
    return null;
  }
}

async function skipSong(guildId) {
  const queue = safeGetQueue(guildId);
  if (!queue) return false;
  try {
    stopPlayerProgress(guildId);
    // Reset loop sebelum skip supaya lagu baru tidak mewarisi status loop
    if (queue.repeatMode === 1) queue.setRepeatMode(0);
    await queue.skip();
    return true;
  } catch (e) {
    return false;
  }
}

async function stopMusic(guildId) {
  try {
    const voiceUtils = require('./voiceUtils');
    voiceUtils.markExpectedLeave(guildId);
  } catch (e) {}
  const queue = safeGetQueue(guildId);
  if (!queue) {
    // Queue udah habis tapi bot masih nyangkut di VC: tetap cabut.
    try {
      if (distubeInstance?.voices?.get(guildId)) {
        distubeInstance.voices.leave(guildId);
        shuffleState.delete(guildId);
        stopPlayerProgress(guildId);
        await markNowPlayingEnded(guildId, '⏹ Musik dihentikan');
        return true;
      }
    } catch (e) {}
    return false;
  }
  // Pisahkan stop dan leave: leave harus jalan meski stop throw
  try { await queue.stop(); } catch (e) { console.warn('[MUSIC] queue.stop() error:', e.message); }
  shuffleState.delete(guildId);
  stopPlayerProgress(guildId);
  try { distubeInstance.voices.leave(guildId); } catch (e) {}
  await markNowPlayingEnded(guildId, '⏹ Musik dihentikan');
  return true;
}

async function pauseMusic(guildId) {
  const queue = safeGetQueue(guildId);
  if (!queue) return false;
  if (queue.paused) return true;
  try {
    await queue.pause();
    stopPlayerProgress(guildId);
    await renderPlayerView(guildId);
    return true;
  } catch (e) {
    return false;
  }
}

async function resumeMusic(guildId) {
  const queue = safeGetQueue(guildId);
  if (!queue) return false;
  try {
    await queue.resume();
    await renderPlayerView(guildId);
    const qs = queuePageState.get(guildId);
    const prev = nowPlayingMessages.get(guildId);
    if (!qs?.showing && prev?.message && queue.songs && queue.songs[0]) {
      startPlayerProgress(guildId, prev.message, queue, queue.songs[0]);
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Lompat ke detik tertentu di lagu yang sedang diputar.
 * DisTube hanya menerapkan `seek` kalau durasi lagu diketahui (lihat
 * DistubeHandler.playSong: `seek: willPlaySong.duration ? ... : undefined`),
 * jadi kalau durasi 0 kita tolak dengan jelas daripada diam-diam tidak jalan.
 */
async function seekMusic(guildId, seconds) {
  const queue = safeGetQueue(guildId);
  if (!queue) return { success: false, code: 'NO_QUEUE' };

  const song = queue.songs && queue.songs[0];
  if (!song) return { success: false, code: 'NO_SONG' };

  const duration = Number(song.duration) || 0;
  if (!duration) return { success: false, code: 'NO_DURATION', song };
  if (seconds >= duration) {
    return { success: false, code: 'BEYOND_DURATION', duration, song };
  }

  await queue.seek(seconds);
  return { success: true, position: seconds, duration, song };
}

/**
 * Toggle shuffle antrean.
 * mode: undefined = toggle biasa (perintah ">shuffle"),
 *       true      = paksa ON (play acak sekalian shuffle),
 *       false     = paksa OFF.
 */
async function toggleShuffle(guildId, mode) {
  const queue = safeGetQueue(guildId);
  if (!queue) return null;
  // Butuh minimal 2 lagu untuk shuffle bermakna
  if (!queue.songs || queue.songs.length < 2) return false;
  try {
    const want = mode === true ? true : mode === false ? false : !shuffleState.get(guildId);
    if (want) await queue.shuffle();
    shuffleState.set(guildId, want);
    return want;
  } catch (e) {
    return false;
  }
}

function isShuffled(guildId) {
  return Boolean(shuffleState.get(guildId));
}

function getQueueList(guildId, maxSongs = 15) {
  const queue = safeGetQueue(guildId);
  if (!queue) return null;

  const songs = queue.songs.slice(0, maxSongs).map((s, i) => ({
    position: i + 1,
    name: s.name,
    duration: s.formattedDuration,
    url: s.url,
    isCurrent: i === 0,
  }));

  return {
    songs,
    total: queue.songs.length,
    current: queue.songs[0]
      ? {
          name: queue.songs[0].name,
          duration: queue.songs[0].formattedDuration,
          position: queue.currentTime || 0,
        }
      : null,
    isPlaying: queue.playing,
    isPaused: queue.paused,
    isShuffled: isShuffled(guildId),
    repeatMode: queue.repeatMode,
  };
}

async function setRepeatMode(guildId, mode) {
  const queue = safeGetQueue(guildId);
  if (!queue) return false;
  try {
    queue.setRepeatMode(mode); // 0 = off, 1 = song, 2 = queue
    return true;
  } catch (e) {
    return false;
  }
}

function isPlaying(guildId) {
  const queue = safeGetQueue(guildId);
  return Boolean(queue && queue.playing);
}

function generateRejectReason() {
  const variants = [
    'males bjir, gue bukan DJ pribadi lu wkwk',
    'ga deh, sini lu nyanyi aja 😭',
    'ogah, gue lagi males muter musik, pake spotify sono',
    'wkwk gamau, mas joy aja yang suruh puter kalau mau',
    'ga dulu, males nih, dengerin spotify sendiri',
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function getGuildLyrics(guildId) {
  if (!guildId) return null;
  return guildLyrics.get(guildId)?.lyrics || null;
}

module.exports = {
  initDisTube,
  getDisTube,
  resolveVoiceChannel,
  buildPlaylist,
  buildNowPlayingEmbed,
  buildQueueAddEmbed,
  setRecentQueueAdd,
  clearRecentQueueAdd,
  buildPlayerComponents,
  buildQueueEmbed,
  buildFullLyricsEmbed,
  refreshPlayer,
  renderPlayerView,
  toggleQueueView,
  toggleLyricsView,
  isVideoUrl,
  videoId,
  resolveSongInfo,
  playPlaylist,
  playPlaylistNow,
  setPendingPlaylistSwitch,
  getPendingPlaylistSwitch,
  clearPendingPlaylistSwitch,
  playSong,
  playSfx,
  getGuildLyrics,
  skipSong,
  stopMusic,
  pauseMusic,
  resumeMusic,
  seekMusic,
  toggleShuffle,
  isShuffled,
  getQueueList,
  setRepeatMode,
  isPlaying,
  generateRejectReason,
  RepeatMode,
  isSpotifyUrl,
  __test: {
    guildLyrics,
    queuePageState,
  },
};