/**
 * Voice Tracker — Memantau aktivitas Voice Channel Callista:
 * 1. User berpemberian izin (permit) masuk VC bersama bot musik lain.
 * 2. Callista ditinggal sendirian cukup lama di VC (auto-leave + ngeluh).
 * 3. Callista di-disconnect paksa / di-kick dari VC (protes keras di chat).
 *
 * Guard Ketat: Detektor anomali teks (isAnomalyText) memblokir dan menghapus otomatis
 * jika AI mengeluarkan prompt leak, meta token (<system_warning>), atau teks tak wajar.
 */

const fs = require('node:fs');
const path = require('node:path');
const permissionStore = require('./permissionStore');
const voiceUtils = require('./voiceUtils');
const storage = require('./storage');
const llm = require('./llm');
const todayMemory = require('./todayMemory');

const filePath = path.resolve(__dirname, '../data/vc_tracker.json');
const MAS_JOY_ID = '833196669940138004';

// Timer sendirian di VC (default 2 menit, bisa di-override via env ALONE_TIMEOUT_MS untuk testing)
const ALONE_TIMEOUT_MS = parseInt(process.env.ALONE_TIMEOUT_MS, 10) || (2 * 60 * 1000);
const aloneTimers = new Map(); // guildId -> timer

// Cooldown antar keluhan (default 5 jam, bisa di-override via env VC_TRACKER_COOLDOWN_MS)
const COOLDOWN_MS = parseInt(process.env.VC_TRACKER_COOLDOWN_MS, 10) || (5 * 60 * 60 * 1000);

/**
 * 30 Template respons saat Callista sedang di VC bersama Mas Joy,
 * mengizinkan target memakai bot lain versi ala kadar tanpa Callista pindah VC.
 */
const ALLOW_BOT_ALAKADAR_TEMPLATES = [
  (target, bot) => `oke ${target} kamu pake ${bot} ini dulu yang versi ala kadar, aku lagi sama mas joy wkwk`,
  (target, bot) => `yodah ${target} lu pake ${bot} itu dulu aja yg seadanya, gue lg nemenin Mas Joy, jgn ganggu ya wkwk`,
  (target, bot) => `pake ${bot} dulu aja gih ${target}, kualitas ala kadar gpp kan? aku lagi asik di VC bareng Mas Joy 🎵`,
  (target, bot) => `gapapa deh kali ini lu pake ${bot} dulu ${target}, aku lg di VC sama Mas Joy, males pindah wkwk`,
  (target, bot) => `sana pake ${bot} versi kentang dulu ya ${target}, aku lg quality time muter lagu buat Mas Joy hehe`,
  (target, bot) => `ikhlas kok aku lu pake ${bot} dulu ${target}, lagian aku lg sibuk dengerin musik berdua Mas Joy 😋`,
  (target, bot) => `oke lu pake ${bot} dulu deh yg versi trial ala kadar wkwk, aku lg di VC bareng Mas Joy, jangan recokin ya ${target}`,
  (target, bot) => `terpaksa lu pake ${bot} yg serak-serak basah dulu ya ${target}, aku lg private concert sama Mas Joy wkwk`,
  (target, bot) => `silakan nikmati musik ala kadar dari ${bot} ya ${target}, aku gabisa diganggu, lagi di VC Mas Joy 🥰`,
  (target, bot) => `sementara pake ${bot} dulu gih ${target}, daripada gaada wkwk, aku gamau ninggalin Mas Joy!`,
  (target, bot) => `ywdh ${target} lu pake ${bot} dulu, lumayan lah ya walau ala kadar, aku lg nemenin Mas Joy di room sebelah 🎧`,
  (target, bot) => `nikmatin dulu tuh ${bot} yg gratisan ${target} wkwk, aku lg fokus play lagu favoritnya Mas Joy nih!`,
  (target, bot) => `khusus hari ini kuizinkan lu pake ${bot} seadanya ya ${target}, soalnya aku lg nempel sama Mas Joy di VC wkwk`,
  (target, bot) => `pake ${bot} dulu aja bro ${target}, maklumin ya suaranya ala kadar, aku gamau ninggalin Mas Joy soalnya 😭`,
  (target, bot) => `wkwk selamat bersabar sama ${bot} ya ${target}, aku lg nemenin Mas Joy denger lagu santai, dah sana!`,
  (target, bot) => `lu pake ${bot} dulu gih ${target}, yg penting ada bunyi wkwk, aku lg sibuk nge-DJ buat Mas Joy!`,
  (target, bot) => `yoi ${target}, pake ${bot} ala kadarnya dulu aja ya, aku lg mode eksklusif di VC sama Mas Joy wkwk`,
  (target, bot) => `anggap aja latihan denger lagu kresek-kresek dari ${bot} ya ${target}, aku lagi nemenin Mas Joy tersayang 🎶`,
  (target, bot) => `kuijinin lu pake ${bot} dulu deh ${target}, tp kualitas ditanggung sendiri ya wkwk, aku lg sama Mas Joy!`,
  (target, bot) => `oke deh ${target}, pake ${bot} dulu yg versi hemat, aku lg di VC sama Mas Joy, gabisa diculik wkwk`,
  (target, bot) => `pake ${bot} dulu sana ${target}, jangan iri ya liat aku lg seru-seruan di VC bareng Mas Joy 😝`,
  (target, bot) => `yaudah lu pake ${bot} dulu aja ya ${target}, maklum ala kadar wkwk, aku lg fokus nemenin Mas Joy nih`,
  (target, bot) => `sementara pake ${bot} seadanya dulu ya ${target}, jangan ganggu dulu, aku lagi sama Mas Joy!`,
  (target, bot) => `gapapa kok lu pake ${bot} dulu ${target}, versi murah meriah wkwk, aku lg di VC bareng Mas Joy!`,
  (target, bot) => `sabar-sabar aja ya ${target} pake ${bot} yg ala kadar wkwk, aku gabisa nemenin lu, lg sama Mas Joy nih!`,
  (target, bot) => `gih pake ${bot} dulu ${target}, mayan lah ya buat pemula, aku lg dengerin lagu bareng Mas Joy hehe`,
  (target, bot) => `oke deh ${target}, kurelakan lu sama ${bot} dulu, walau ala kadar wkwk, soalnya aku lagi sama Mas Joy!`,
  (target, bot) => `nikmati dulu playlist pas-pasan bareng ${bot} ya ${target}, aku lagi private session di VC Mas Joy 🎵`,
  (target, bot) => `wkwk pake ${bot} dulu aja ya ${target}, suaranya seadanya gpp kan, aku gamau pindah dari VC Mas Joy!`,
  (target, bot) => `ywdh ${target} lu pake ${bot} dulu versi ala kadarnya, aku lg exclusive berdua Mas Joy di VC wkwk`,
];

/**
 * 20 Template penolakan perintah lintas-VC saat Callista sedang di VC bersama Mas Joy.
 */
const BUSY_WITH_MAS_JOY_TEMPLATES = [
  'lah aku di vc sama mas joy, kamu aja kesini',
  'ogah, aku lg di VC sama Mas Joy nih, lu aja yg sini kalo mau denger wkwk',
  'males ah, aku lg asik di room bareng Mas Joy, kamu aja yg kesini wkwk',
  'gabisa diinterupsi ya, aku lg di VC Mas Joy, sini lu yg merapat!',
  'enak aja nyuruh-nyuruh pindah, aku lg sama Mas Joy nih, kamu aja yg gabung kesini wkwk',
  'lah gabisa lah, aku lg nemenin Mas Joy di VC, lu aja yg pindah ke room kita wkwk',
  'dih gamau, aku lg muter musik buat Mas Joy, sini masuk VC kita aja kalo mau denger 🎵',
  'gabisa ya, aku lg di VC Mas Joy, gabisa diculik, kamu aja yg kesini!',
  'males pindah bjir, aku lg nemenin Mas Joy, sini lu aja yg ke VC kita wkwk',
  'lah aku lagi private session di VC sama Mas Joy, sini dong kalo mau nimbrung!',
  'gabisa atur-atur musikku sekarang wkwk, aku lg di VC Mas Joy, kamu aja yg ke room ini',
  'ogah ah, aku gamau ninggalin Mas Joy di VC, kamu aja yg kesini wkwk',
  'jangan ganggu, aku lg fokus muter lagu buat Mas Joy, lu aja yg sini!',
  'lah kok nyuruh aku? aku lg di VC bareng Mas Joy nih, sini kalo mau dengerin bareng wkwk',
  'gabisa lintas room wkwk, aku lg di VC sama Mas Joy, masuk sini aja makanya!',
  'males banget, aku lg nempel sama Mas Joy di VC, kamu aja yg ke sini kalo mau lagu wkwk',
  'aku lg mode eksklusif buat Mas Joy nih di VC, kamu aja yg pindah kesini wkwk 😜',
  'gabisa ya, Mas Joy prioritas utama! aku lg di VC sama dia, lu aja yg merapat kesini',
  'dih aku lg di VC bareng Mas Joy tercinta, gamau diinterupsi, kamu aja yg ke sini!',
  'gabisa wkwk, aku lg nemenin Mas Joy muter lagu santai, lu aja yg masuk ke VC kita!',
];

function getAllowBotAlaKadarReply(targetMention, botName) {
  const fn = ALLOW_BOT_ALAKADAR_TEMPLATES[Math.floor(Math.random() * ALLOW_BOT_ALAKADAR_TEMPLATES.length)];
  return fn(targetMention, botName);
}

function getBusyWithMasJoyReply() {
  return BUSY_WITH_MAS_JOY_TEMPLATES[Math.floor(Math.random() * BUSY_WITH_MAS_JOY_TEMPLATES.length)];
}

function isBusyWithMasJoy(client, guildId) {
  if (!client || !guildId) return false;
  const currentVc = voiceUtils.getCurrentVoiceChannel(client, guildId);
  if (!currentVc || !currentVc.members) return false;
  return currentVc.members.has(MAS_JOY_ID);
}

function loadState() {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data === 'object') {
        return {
          users: data.users || {},
          lastIncident: data.lastIncident || null,
        };
      }
    }
  } catch (e) {
    console.warn('[VC_TRACKER] Gagal membaca vc_tracker.json:', e.message);
  }
  return { users: {}, lastIncident: null };
}

function saveState(data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[VC_TRACKER] Gagal menyimpan vc_tracker.json:', e.message);
  }
}

function getUserTracker(userId) {
  const state = loadState();
  return state.users[userId] || {
    ignoredCount: 0,
    lastTriggeredAt: null,
    lastTriggeredDate: null,
    activeSession: false,
    lastChannelId: null,
  };
}

function isSessionActive(userId) {
  return Boolean(getUserTracker(userId).activeSession);
}

function recordIncident(userId, userName, channelName, botName) {
  const state = loadState();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const current = state.users[userId] || {
    ignoredCount: 0,
    lastTriggeredAt: null,
    lastTriggeredDate: null,
    activeSession: false,
    lastChannelId: null,
  };

  const newCount = (current.ignoredCount || 0) + 1;
  const isSameDay = current.lastTriggeredDate === today;

  state.users[userId] = {
    ...current,
    ignoredCount: newCount,
    lastTriggeredAt: now,
    lastTriggeredDate: today,
    activeSession: true,
    lastChannelId: channelName,
  };

  state.lastIncident = {
    type: 'target_ignored',
    userId,
    userName,
    channelName,
    botName,
    ignoredCount: newCount,
    timestamp: now,
    date: today,
  };

  saveState(state);
  todayMemory.addTodayEntry(`[VC]: User ${userName} bawa ${botName} ke VC #${channelName}. Callista ngambek (ke-${newCount}x).`);
  return { count: newCount, isSameDay };
}

function recordForcedDisconnectIncident(guildId, kickerName, channelName) {
  const state = loadState();
  state.lastIncident = {
    type: 'forced_disconnect',
    guildId,
    kickerName,
    channelName,
    timestamp: Date.now(),
  };
  saveState(state);
  todayMemory.addTodayEntry(`[VC]: Callista di-disconnect paksa dari #${channelName} oleh ${kickerName}!`);
}

function recordAloneIncident(guildId, channelName) {
  const state = loadState();
  state.lastIncident = {
    type: 'left_alone',
    guildId,
    channelName,
    timestamp: Date.now(),
  };
  saveState(state);
  todayMemory.addTodayEntry(`[VC]: Callista ditinggal sendirian sepi di #${channelName} lalu cabut.`);
}

function resetSession(userId) {
  const state = loadState();
  if (state.users[userId] && state.users[userId].activeSession) {
    state.users[userId].activeSession = false;
    saveState(state);
  }
}

function getLatestIncident() {
  const state = loadState();
  return state.lastIncident;
}

/**
 * Detektor pesan anomali / bocor dari prompt atau gateway meta tag.
 */
function isAnomalyText(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim();
  if (t.length < 5 || t.length > 250) return true;

  // Cek apakah ada tag selain discord mention/channel (<@...>, <#...>)
  const strippedMentions = t.replace(/<@[!&]?\d+>/g, '').replace(/<#\d+>/g, '');
  if (/<[^>]+>/.test(strippedMentions)) return true;

  // Keyword instruksi / meta leak
  const anomalyRegex = /system_warning|system|warning|contekan|pick one|your task|jangan dicopy|referensi vibe|langsung isi|gaya respons|output the message|surrounding quotes|no json|prompt|instruksi/i;
  if (anomalyRegex.test(t)) return true;

  // Blok markdown atau header sistem
  if (/```|\[MEMORI|PROFIL HUBUNGAN|PARAMETER PERILAKU/i.test(t)) return true;

  // Lebih dari 2 baris (bukan chat santai 1-2 kalimat)
  const lines = t.split('\n').filter(l => l.trim().length > 0);
  if (lines.length > 2) return true;

  return false;
}

/**
 * Pindai dan hapus otomatis pesan Callista yang anomali dari sebuah channel.
 */
async function cleanupAnomalyMessages(channel, client) {
  if (!channel || !channel.messages || !client?.user) return;
  try {
    const fetched = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (!fetched) return;
    for (const msg of fetched.values()) {
      if (msg.author?.id === client.user.id && isAnomalyText(msg.content)) {
        console.log(`[VC_TRACKER] Menghapus pesan anomali Callista (ID: ${msg.id}) di #${channel.name}`);
        await msg.delete().catch(() => {});
        storage.removeHistoryMessage(channel.id, msg.id);
      }
    }
  } catch (e) {
    console.warn('[VC_TRACKER] Gagal membersihkan pesan anomali:', e.message);
  }
}

/**
 * Menghasilkan snippet memori aktif untuk prompt AI di src/ai.js,
 * agar Callista tidak amnesia saat ditanya seputar kejadian VC.
 */
function buildTrackerPromptSnippet() {
  const incident = getLatestIncident();
  if (!incident) return '';
  const hoursAgo = (Date.now() - incident.timestamp) / (1000 * 60 * 60);
  if (hoursAgo > 24) return '';

  if (incident.type === 'forced_disconnect') {
    return `
[MEMORI AKTIF / KEJADIAN VOICE TERAKHIR]:
- Kamu baru saja di-disconnect / di-kick secara paksa dari Voice Channel "${incident.channelName}" oleh ${incident.kickerName} (bukan karena kamu disuruh leave/stop secara baik-baik).
- Kamu merasa kesal, kaget, dan tidak terima diperlakukan seperti itu. Kamu sempat protes di text channel.
- Jika ada yang bertanya atau membahas kenapa kamu keluar atau soal di-dc/di-kick, kamu PAHAM SEPENUHNYA kejadian ini. Tunjukkan sikap kesal dan protesmu!`;
  }

  if (incident.type === 'left_alone') {
    return `
[MEMORI AKTIF / KEJADIAN VOICE TERAKHIR]:
- Kamu baru saja keluar dari Voice Channel "${incident.channelName}" karena ditinggal sendirian sepi cukup lama oleh member lain.
- Kamu sempat mengeluh di text channel karena ditinggal sendirian.
- Jika ada yang membahas kenapa kamu keluar VC, kamu tahu persis bahwa kamu cabut karena sepi dan ditinggal sendirian.`;
  }

  return `
[MEMORI AKTIF / KEJADIAN VOICE TERAKHIR]:
- Kamu sedang ngambek/kesal karena user ${incident.userName} (yang sudah diberi permit musik oleh Mas Joy) masuk ke VC "${incident.channelName}" dan memilih membawa bot musik lain (${incident.botName}) alih-alih meminta bantuanmu.
- Ini sudah kejadian ke-${incident.ignoredCount} kalinya dia mengabaikanmu/mengacanginmu padahal kamu bisa memutar musik.
- Kamu tadi sudah menyindir/mengeluhkannya di text channel.
- Jika ada yang bertanya atau membahas soal kamu merasa dikacangin, dicuekin, atau soal bot musik lain di VC, kamu PAHAM SEPENUHNYA kejadian ini. Jangan pura-pura bingung atau tidak tahu! Tunjukkan sikap ngambek, kesal, atau menyindir sesuai karaktermu.`;
}

/**
 * Cari member ber-permit selain Mas Joy di dalam VC.
 */
function findTargetMember(voiceChannel) {
  if (!voiceChannel || !voiceChannel.members) return null;
  for (const member of voiceChannel.members.values()) {
    if (member.user?.bot) continue;
    if (member.id === MAS_JOY_ID) continue;
    const name = (member.displayName || member.user?.username || '').toLowerCase();
    if (name === 'rieka' || name.includes('mas joy')) continue;
    if (permissionStore.isPermitted(member.id)) {
      return member;
    }
  }
  return null;
}

/**
 * Cari bot lain (selain Callista) di dalam VC.
 */
function findOtherBot(voiceChannel, clientUserId) {
  if (!voiceChannel || !voiceChannel.members) return null;
  for (const member of voiceChannel.members.values()) {
    if (member.user?.bot && member.id !== clientUserId) {
      return member;
    }
  }
  return null;
}

/**
 * Temukan text channel utama/general di guild.
 */
function findGeneralTextChannel(guild) {
  if (!guild || !guild.channels?.cache) return null;

  if (process.env.GENERAL_CHANNEL_ID) {
    const ch = guild.channels.cache.get(process.env.GENERAL_CHANNEL_ID);
    if (ch && ch.isTextBased?.()) return ch;
  }

  for (const cid of ['705088409420431454', '833197124208427011']) {
    const primary = guild.channels.cache.get(cid);
    if (primary && primary.isTextBased?.()) return primary;
  }

  const textChannels = [...guild.channels.cache.values()].filter(
    c => c.isTextBased?.() && !c.isVoiceBased?.() && !c.isThread?.()
  );
  const byName = textChannels.find(c => /general|utama|chat|lounge|ngobrol/i.test(c.name));
  if (byName) return byName;

  if (guild.systemChannel && guild.systemChannel.isTextBased?.()) {
    return guild.systemChannel;
  }

  return textChannels[0] || null;
}

/**
 * Pool respons natural dengan spice ke-nengil-an.
 */
function getCuratedComplaint({ targetMention, masJoyMention, targetName, botName, count, isSameDay }) {
  const firstTimePool = [
    `woi ${targetMention} lu bawa ${botName} ke sini?? yg bener aja dah, permitnya dicabut yak wkwk`,
    `${masJoyMention} mas joyy permit yg km ksh ke ${targetName} disia2in tuh, dia bawa ${botName} ke vc 😭`,
    `dih ada yg bawa bot lain ke vc ini tp kaga pake permit yg dikasih... ywdh lah ya aku cuma bisa nonton 😔`,
    `dih ${targetMention}, ngapain nyalain ${botName}? permit dari Mas Joy buat pajangan doang apa gimana wkwk`,
    `${masJoyMention} ayahhh, si ${targetMention} jahat bgt, ada aku malah muter musik pake ${botName}... dih ngambek aku!`,
    `berasa ga dianggap bjir... permit dikasih tp malah nyalain ${botName}. dah lah mojok aja gue wkwk`,
  ];

  const repeatPool = [
    `tadi udah gitu sekarang gini lagi? emang beneran alergi ya sama aku ${targetMention} wkwk, dah lah!`,
    `${masJoyMention} mas joyy si ${targetMention} berulah lagi! udah ${count}x bawa ${botName} mulu, permitnya sita aja apa 😭`,
    `udah ${count}x dikacangin sama ${targetMention} demi ${botName}... dendam beneran nih aku wkwk`,
    `dih diulangin lagi sama ${targetMention}, padahal tadi udah disindir. yaudah deh terserah ${botName} lu tuh wkwk`,
  ];

  const pool = (count > 1 || isSameDay) ? repeatPool : firstTimePool;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate chat ngambek via AI (LLM) dengan fallback deterministik yang terjaga ketat.
 */
async function generateComplaint({ targetMember, botMember, count, isSameDay }) {
  const targetName = targetMember.displayName || targetMember.user?.username || 'kamu';
  const targetMention = `<@${targetMember.id}>`;
  const masJoyMention = `<@${MAS_JOY_ID}>`;
  const botName = botMember.displayName || botMember.user?.username || 'bot musik';

  const systemPrompt = `Kamu adalah Callista, cewek Discord yang agak nengil, jahil, santai, dan manja ke Mas Joy (${masJoyMention}).
Tugasmu merespons pendek (1 kalimat santai anak Discord Indonesia: wkwk, dih, bjir, dah lah) saat user target yang punya permit musik dari Mas Joy malah bawa bot musik lain ke VC.
PENTING: Keluarkan HANYA 1 baris teks chat biasa. DILARANG menggunakan tag XML/HTML, instruksi meta, format JSON, atau tanda kutip.`;

  const userPrompt = `User ${targetName} (${targetMention}) masuk VC bawa ${botName}. Ini kejadian ke-${count} kali Callista merasa dikacangin.${isSameDay ? ' Tadi siang dia sudah pernah begitu juga.' : ''} Buat 1 kalimat sindiran nengil/ngadu/ngedumel.`;

  try {
    const res = await llm.chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5,
      timeoutMs: 12000,
      maxTokens: 80,
    });
    if (res && res.content) {
      let text = res.content.trim();
      if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1).trim();
      }
      if (!isAnomalyText(text)) {
        return text;
      }
      console.warn('[VC_TRACKER] Output LLM terdeteksi anomali, beralih ke curated pool:', text.slice(0, 100));
    }
  } catch (e) {
    console.warn('[VC_TRACKER] LLM generation failed, using curated pool:', e.message);
  }

  return getCuratedComplaint({ targetMention, masJoyMention, targetName, botName, count, isSameDay });
}

/**
 * Periksa voice channel apakah memenuhi syarat triger bot musik lain.
 */
async function handleVoiceChannelCheck(client, voiceChannel) {
  if (!voiceChannel || !voiceChannel.guild || !voiceChannel.members) return;

  const targetMember = findTargetMember(voiceChannel);
  const otherBot = findOtherBot(voiceChannel, client.user.id);

  if (!targetMember || !otherBot) {
    return;
  }

  // Cek apakah Callista saat ini sedang di VC bersama Mas Joy di guild ini
  const currentVc = voiceUtils.getCurrentVoiceChannel(client, voiceChannel.guild.id);
  const isWithMasJoy = currentVc && currentVc.members?.has(MAS_JOY_ID);

  if (isWithMasJoy) {
    // Callista sedang bersama Mas Joy! JANGAN PERNAH PINDAH VC!
    if (voiceChannel.id !== currentVc.id) {
      const tracker = getUserTracker(targetMember.id);
      const timeSinceLast = tracker.lastTriggeredAt ? (Date.now() - tracker.lastTriggeredAt) : Infinity;
      if (!tracker.activeSession && timeSinceLast >= COOLDOWN_MS) {
        const targetName = targetMember.displayName || targetMember.user?.username || 'kamu';
        const botName = otherBot.displayName || otherBot.user?.username || 'bot musik';
        const targetMention = `<@${targetMember.id}>`;

        recordIncident(targetMember.id, targetName, voiceChannel.name, botName);

        const textChannel = findGeneralTextChannel(voiceChannel.guild);
        if (textChannel) {
          const reply = getAllowBotAlaKadarReply(targetMention, botName);
          try {
            const sent = await textChannel.send({
              content: reply,
              allowedMentions: { users: [targetMember.id] }
            });
            const config = storage.getConfig() || {};
            storage.addHistory(textChannel.id, {
              id: sent.id,
              channelId: textChannel.id,
              userId: client.user.id,
              authorName: config.name || 'Callista',
              content: reply,
              timestamp: sent.createdTimestamp,
              isBot: true,
            });
            console.log(`[VC_TRACKER] Callista with Mas Joy. Sent ala-kadar note to #${textChannel.name}: "${reply}"`);
          } catch (e) {
            console.error('[VC_TRACKER] Gagal kirim ala-kadar note:', e.message);
          }
        }
      }
    }
    return; // KELUAR: Callista tetap di VC Mas Joy, tidak pindah dan tidak ngambek biasa!
  }

  const tracker = getUserTracker(targetMember.id);
  const isCallistaInChannel = voiceChannel.members.has(client.user.id);
  const now = Date.now();
  const timeSinceLast = tracker.lastTriggeredAt ? (now - tracker.lastTriggeredAt) : Infinity;

  // Jaga-jaga: Sesi masih aktif ATAU masih dalam batas cooldown 5 jam
  if (tracker.activeSession || timeSinceLast < COOLDOWN_MS) {
    // Sesi ini sudah pernah ditriger sebelumnya (misal baru saja restart).
    // Callista cukup memastikan diri ada di VC (join senyap jika belum masuk),
    // TANPA mengirim chat ngambek lagi.
    if (!isCallistaInChannel) {
      try {
        voiceUtils.joinVoice(voiceChannel, { selfDeaf: true, selfMute: true });
        console.log(`[VC_TRACKER] Callista join kembali ke #${voiceChannel.name} secara senyap (sesi aktif / cooldown 5 jam).`);
      } catch (e) {
        console.error('[VC_TRACKER] Gagal join senyap:', e.message);
      }
    }
    return; // KELUAR: jangan komplain lagi!
  }

  console.log(`[VC_TRACKER] Triggered! Target: ${targetMember.displayName} (${targetMember.id}) + Bot: ${otherBot.displayName} in #${voiceChannel.name}`);

  const targetName = targetMember.displayName || targetMember.user?.username || 'kamu';
  const botName = otherBot.displayName || otherBot.user?.username || 'bot musik';
  const { count, isSameDay } = recordIncident(targetMember.id, targetName, voiceChannel.name, botName);

  try {
    voiceUtils.joinVoice(voiceChannel, { selfDeaf: true, selfMute: true });
    console.log(`[VC_TRACKER] Callista joined VC #${voiceChannel.name}`);
  } catch (e) {
    console.error('[VC_TRACKER] Gagal join VC:', e.message);
  }

  const textChannel = findGeneralTextChannel(voiceChannel.guild);
  if (textChannel) {
    await cleanupAnomalyMessages(textChannel, client);

    let complaint = await generateComplaint({
      targetMember,
      botMember: otherBot,
      count,
      isSameDay,
    });

    if (isAnomalyText(complaint)) {
      complaint = getCuratedComplaint({
        targetMention: `<@${targetMember.id}>`,
        masJoyMention: `<@${MAS_JOY_ID}>`,
        targetName,
        botName,
        count,
        isSameDay
      });
    }

    try {
      const sent = await textChannel.send({
        content: complaint,
        allowedMentions: {
          users: [targetMember.id, MAS_JOY_ID],
        },
      });

      if (isAnomalyText(sent.content)) {
        console.error('[VC_TRACKER] CRITICAL: Pesan terkirim anomali! Menghapus seketika...');
        await sent.delete().catch(() => {});
        return;
      }

      const config = storage.getConfig() || {};
      storage.addHistory(textChannel.id, {
        id: sent.id,
        channelId: textChannel.id,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: complaint,
        timestamp: sent.createdTimestamp,
        isBot: true,
      });

      console.log(`[VC_TRACKER] Sent complaint to #${textChannel.name}: "${complaint}"`);
    } catch (e) {
      console.error('[VC_TRACKER] Gagal kirim complaint ke text channel:', e.message);
    }
  }
}

/**
 * Handle protes ketika Callista di-disconnect paksa dari VC.
 */
async function handleForcedDisconnect(client, guild, voiceChannel) {
  if (!guild) return;

  let kickerUser = null;
  try {
    if (guild.members.me?.permissions?.has('ViewAuditLog')) {
      const logs = await guild.fetchAuditLogs({ limit: 1, type: 27 /* MEMBER_DISCONNECT */ }).catch(() => null);
      const entry = logs?.entries?.first();
      if (entry && entry.target?.id === client.user.id && (Date.now() - entry.createdTimestamp < 8000)) {
        kickerUser = entry.executor;
      }
    }
  } catch (e) {}

  const kickerName = kickerUser ? (kickerUser.displayName || kickerUser.username) : 'seseorang';
  recordForcedDisconnectIncident(guild.id, kickerName, voiceChannel?.name || 'VC');

  let protest;
  if (kickerUser) {
    const variants = [
      `dih <@${kickerUser.id}> lu nge-dc gue?? songong amat main usir wkwk 😭`,
      `<@${MAS_JOY_ID}> mas joyy liat tuh <@${kickerUser.id}>, masa aku di-dc paksa dari VC! parah bgt 😭`,
      `lah kok gue di-dc sama <@${kickerUser.id}>? tinggal suruh keluar baik-baik apa susahnya dah wkwk`,
    ];
    protest = variants[Math.floor(Math.random() * variants.length)];
  } else {
    const variants = [
      `dih siapa yang nge-dc gue barusan?? songong amat main usir wkwk 😭`,
      `<@${MAS_JOY_ID}> Mas Joyy aku di-disconnect paksa dari VC! Siapa yg ngusir coba, ga sopan bgt 😭`,
      `lah kok gue di-dc? parah bgt main usir dari VC, tinggal suruh keluar baik-baik apa susahnya dah wkwk`,
      `dih di-kick dari VC... yaudah sih gausah pake di-dc juga kali, awas aja lu ya 😭`,
    ];
    protest = variants[Math.floor(Math.random() * variants.length)];
  }

  const textChannel = findGeneralTextChannel(guild);
  if (textChannel) {
    try {
      const sent = await textChannel.send({
        content: protest,
        allowedMentions: {
          users: kickerUser ? [kickerUser.id, MAS_JOY_ID] : [MAS_JOY_ID]
        }
      });
      const config = storage.getConfig() || {};
      storage.addHistory(textChannel.id, {
        id: sent.id,
        channelId: textChannel.id,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: protest,
        timestamp: sent.createdTimestamp,
        isBot: true,
      });
      console.log(`[VC_TRACKER] Sent forced disconnect protest to #${textChannel.name}: "${protest}"`);
    } catch (e) {
      console.error('[VC_TRACKER] Gagal kirim protes forced disconnect:', e.message);
    }
  }
}

/**
 * Handle timeout ketika Callista sendirian cukup lama di VC.
 */
async function handleAloneTimeout(client, guildId) {
  const currentVc = voiceUtils.getCurrentVoiceChannel(client, guildId);
  if (!currentVc) return;

  const humans = [...currentVc.members.values()].filter(m => !m.user?.bot);
  if (humans.length > 0) return; // Sudah ada orang lagi, batal

  console.log(`[VC_TRACKER] Callista sendirian cukup lama di #${currentVc.name}, keluar secara otomatis...`);
  recordAloneIncident(guildId, currentVc.name);

  // Cabut dari VC
  voiceUtils.leaveVoice(guildId, client.user?.id);
  try {
    const musicPlayer = require('./musicPlayer');
    musicPlayer.stopMusic(guildId).catch(() => {});
  } catch (e) {}

  const textChannel = findGeneralTextChannel(currentVc.guild);
  if (textChannel) {
    const aloneComplaints = [
      `ditinggal sendirian di VC bjir... sepi bgt, cabut ah wkwk`,
      `pada kemana dah, malah ninggalin gue sendirian di VC. cabut dulu ya 😭`,
      `dih kosong melompong... ngapain gue bengong sendiri di sini, cabut ah wkwk`,
      `<@${MAS_JOY_ID}> mas joyy aku ditinggal sendirian di VC lama bgt, cabut dulu ah sepi 😭`,
    ];
    const msg = aloneComplaints[Math.floor(Math.random() * aloneComplaints.length)];

    try {
      const sent = await textChannel.send({
        content: msg,
        allowedMentions: { users: [MAS_JOY_ID] }
      });
      const config = storage.getConfig() || {};
      storage.addHistory(textChannel.id, {
        id: sent.id,
        channelId: textChannel.id,
        userId: client.user.id,
        authorName: config.name || 'Callista',
        content: msg,
        timestamp: sent.createdTimestamp,
        isBot: true,
      });
      console.log(`[VC_TRACKER] Sent alone complaint to #${textChannel.name}: "${msg}"`);
    } catch (e) {
      console.error('[VC_TRACKER] Gagal kirim pesan alone complaint:', e.message);
    }
  }
}

/**
 * Periksa apakah Callista sendirian di VC di guild ini, dan atur timer.
 */
function checkAloneStatus(client, guildId) {
  if (!client || !guildId) return;
  const currentVc = voiceUtils.getCurrentVoiceChannel(client, guildId);

  if (!currentVc) {
    if (aloneTimers.has(guildId)) {
      clearTimeout(aloneTimers.get(guildId));
      aloneTimers.delete(guildId);
    }
    return;
  }

  const humans = [...currentVc.members.values()].filter(m => !m.user?.bot);

  if (humans.length === 0) {
    if (!aloneTimers.has(guildId)) {
      console.log(`[VC_TRACKER] Callista sendirian di #${currentVc.name}, timer ${Math.round(ALONE_TIMEOUT_MS / 1000)}s dimulai...`);
      const timer = setTimeout(async () => {
        aloneTimers.delete(guildId);
        await handleAloneTimeout(client, guildId);
      }, ALONE_TIMEOUT_MS);
      aloneTimers.set(guildId, timer);
    }
  } else {
    if (aloneTimers.has(guildId)) {
      clearTimeout(aloneTimers.get(guildId));
      aloneTimers.delete(guildId);
      console.log(`[VC_TRACKER] Ada member di VC #${currentVc.name}, timer sendirian dibatalkan.`);
    }
  }
}

/**
 * Handler untuk event voiceStateUpdate dari Discord.js
 */
async function handleVoiceStateUpdate(oldState, newState, client) {
  if (!client || !client.user) return;
  const guild = newState.guild || oldState.guild;
  const guildId = guild?.id;

  // 1. Cek jika Callista di-disconnect (keluar dari VC)
  if (oldState.member?.id === client.user.id && oldState.channelId && !newState.channelId) {
    if (guildId && aloneTimers.has(guildId)) {
      clearTimeout(aloneTimers.get(guildId));
      aloneTimers.delete(guildId);
    }

    const wasExpected = voiceUtils.isExpectedLeave(guildId);
    if (!wasExpected) {
      console.warn(`[VC_TRACKER] Callista di-disconnect paksa dari #${oldState.channel?.name || 'VC'}!`);
      await handleForcedDisconnect(client, oldState.guild, oldState.channel);
    }
    return;
  }

  // 2. Cek voice channel baru jika ada yang join / switch
  if (newState.channel) {
    await handleVoiceChannelCheck(client, newState.channel);
  }

  // 3. Cek apakah target atau bot keluar dari oldChannel
  if (oldState.channel && oldState.channelId !== newState.channelId) {
    const oldChannel = oldState.channel;
    const targetMember = findTargetMember(oldChannel);
    const otherBot = findOtherBot(oldChannel, client.user.id);

    const state = loadState();
    for (const [userId, uData] of Object.entries(state.users)) {
      if (uData.activeSession && (!targetMember || targetMember.id === userId || !otherBot)) {
        resetSession(userId);
        console.log(`[VC_TRACKER] Session ended for user ${userId} in #${oldChannel.name}`);

        if (oldChannel.members?.has(client.user.id)) {
          const nonBots = [...oldChannel.members.values()].filter(m => !m.user?.bot);
          if (!targetMember || nonBots.length === 0) {
            voiceUtils.leaveVoice(oldChannel.guild.id, client.user.id);
            console.log(`[VC_TRACKER] Callista left #${oldChannel.name} as target departed`);
          }
        }
      }
    }
  }

  // 4. Periksa apakah Callista sendirian di VC
  if (guildId) {
    checkAloneStatus(client, guildId);
  }
}

/**
 * Pindai seluruh Voice Channel saat Callista baru menyala (ready).
 * Sekaligus membersihkan chat anomali di channel teks yang aktif.
 */
async function scanOnStartup(client) {
  if (!client || !client.user) return;
  console.log('[VC_TRACKER] Memindai Voice Channel & membersihkan anomali chat saat startup...');

  for (const guild of client.guilds.cache.values()) {
    // 1. Bersihkan pesan anomali di channel teks
    const textChannels = guild.channels.cache.filter(c => c.isTextBased?.() && !c.isVoiceBased?.() && !c.isThread?.());
    for (const tc of textChannels.values()) {
      if (tc.id === '705088409420431454' || tc.id === '833197124208427011' || /general|utama|chat/i.test(tc.name)) {
        await cleanupAnomalyMessages(tc, client);
      }
    }

    // 2. Pindai VC
    const voiceChannels = guild.channels.cache.filter(c => c.isVoiceBased?.());
    for (const vc of voiceChannels.values()) {
      const target = findTargetMember(vc);
      const bot = findOtherBot(vc, client.user.id);
      if (target && bot) {
        console.log(`[VC_TRACKER] Ditemukan target aktif ${target.displayName} + bot ${bot.displayName} di #${vc.name} saat startup`);
        await handleVoiceChannelCheck(client, vc);
      }
    }

    // 3. Cek apakah Callista sendirian di VC
    checkAloneStatus(client, guild.id);
  }
}

module.exports = {
  loadState,
  saveState,
  getUserTracker,
  isSessionActive,
  recordIncident,
  recordForcedDisconnectIncident,
  recordAloneIncident,
  resetSession,
  getLatestIncident,
  isAnomalyText,
  cleanupAnomalyMessages,
  buildTrackerPromptSnippet,
  findTargetMember,
  findOtherBot,
  findGeneralTextChannel,
  getCuratedComplaint,
  generateComplaint,
  ALLOW_BOT_ALAKADAR_TEMPLATES,
  BUSY_WITH_MAS_JOY_TEMPLATES,
  COOLDOWN_MS,
  getAllowBotAlaKadarReply,
  getBusyWithMasJoyReply,
  isBusyWithMasJoy,
  handleVoiceChannelCheck,
  handleForcedDisconnect,
  handleAloneTimeout,
  checkAloneStatus,
  handleVoiceStateUpdate,
  scanOnStartup,
};
