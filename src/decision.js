function getNameRegex(config = {}) {
  // Pakai default jika aliases belum diset atau kosong
  const baseAliases = (config.aliases && config.aliases.length > 0)
    ? config.aliases
    : ['firka', 'callista', 'cal'];
  const names = [config.name, ...baseAliases].filter(Boolean);
  if (names.length === 0) return /(?!)/; // never-match regex aman
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`\\b(${escaped})\\b`, 'i');
}

function containsNameOrAlias(content, config = {}) {
  if (!content) return false;
  return getNameRegex(config).test(content);
}

function isAddressedToSomeoneElse(msgData, config = {}) {
  const { botId, mentions, replyToAuthorId, content } = msgData;
  if (mentions && mentions.includes(botId)) return false;
  if (replyToAuthorId && replyToAuthorId === botId) return false;

  const isReplyToOther = Boolean(replyToAuthorId && replyToAuthorId !== botId);
  const isMentioningOther = Boolean(mentions && mentions.length > 0 && !mentions.includes(botId));
  if (isReplyToOther || isMentioningOther) return true;

  // Heuristic: jika pesan diawali panggilan nama orang lain (misal: "put mintol dong", "budi sini deh")
  // dan Callista sama sekali tidak disebut dalam pesan tersebut
  if (content && typeof content === 'string') {
    const trimmed = content.trim();
    const vocMatch = trimmed.match(/^([a-zA-Z0-9_]{2,12})[\s,:]+/i);
    if (vocMatch) {
      const firstWord = vocMatch[1].toLowerCase();
      const callistaNames = [config.name, ...(config.aliases || ['firka', 'callista', 'cal'])].filter(Boolean).map(n => n.toLowerCase());

      const nonVocatives = new Set([
        'aku', 'kamu', 'dia', 'kita', 'kami', 'mereka', 'gue', 'gw', 'lu', 'lo', 'loe',
        'saya', 'anda', 'ini', 'itu', 'ada', 'lagi', 'udah', 'udahh', 'dah', 'belum',
        'mau', 'bisa', 'tolong', 'jangan', 'kenapa', 'gimana', 'kok', 'lah', 'nah',
        'ya', 'iya', 'oke', 'kuy', 'gas', 'halo', 'hai', 'p', 'woi', 'woy', 'eh', 'oh',
        'siapa', 'apa', 'kapan', 'dimana', 'soalnya', 'karena', 'tapi', 'kan', 'dong',
        // Filler Indonesia yang sering di awal kalimat (false-positive vocative)
        'ga', 'gak', 'ngga', 'nggak', 'yuk', 'mah', 'si', 'tuh', 'toh', 'sih',
        'emg', 'emang', 'masa', 'mana', 'nih', 'wkwk', 'haha', 'anjir', 'anjay',
        'bro', 'ges', 'btw', 'fyi', 'jir', 'bjir'
      ]);

      if (!callistaNames.includes(firstWord) && !nonVocatives.has(firstWord)) {
        if (!containsNameOrAlias(content, config)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isSilenceCommand(content) {
  if (!content) return false;
  const lower = content.toLowerCase().trim();
  return /\b(diam\s+(dulu|bentar|deh|ya|dong)|diem\s+(dulu|bentar|deh|ya|dong)|jangan\s+(nyaut|ngomong|nimbrung|berisik|banyak\s+omong)|sshh+|stfu|shut\s*up|off\s+dulu|mute\s+dulu|tutup\s+mulut)\b/i.test(lower);
}

function isUnmuteCommand(content) {
  if (!content) return false;
  const lower = content.toLowerCase().trim();
  return /\b(boleh\s+(nimbrung|ngomong|nyaut|bicara|ikutan|balas)|nyaut\s+lagi|aktif\s+lagi|ngobrol\s+lagi|udah\s+boleh|unmute|masuk\s+lagi|on\s+lagi)\b/i.test(lower);
}

function checkPreAIGate(msgData, focus, config = {}, botState = null) {
  const { botId, userId, authorName, mentions, replyToAuthorId, content } = msgData;

  // 0. JIKA STATUS BOT MATI (isResponding === false):
  // HANYA MAS JOY yang dapat mengaktifkan kembali via instruksi khusus (misal "cal kamu boleh nimbrung kok")
  if (botState && botState.isResponding === false) {
    const isMasJoy = userId === '833196669940138004' || (authorName && authorName.toLowerCase() === 'rieka');
    const isDirectedToBot = (mentions && mentions.includes(botId)) ||
      (replyToAuthorId && replyToAuthorId === botId) ||
      containsNameOrAlias(content, config);

    if (isMasJoy && isUnmuteCommand(content) && isDirectedToBot) {
      return { pass: true, trigger: 'unmute_command' };
    }
    return { pass: false, trigger: 'none', reason: 'bot_silenced' };
  }

  if (mentions && mentions.includes(botId)) {
    return { pass: true, trigger: 'mention' };
  }

  if (replyToAuthorId && replyToAuthorId === botId) {
    return { pass: true, trigger: 'reply' };
  }

  // Jika focus aktif, tapi pesan jelas-jelas ditujukan ke orang lain (misal panggil "put ..."), jangan teruskan focus!
  if (focus && focus.userId === userId) {
    if (isAddressedToSomeoneElse(msgData, config)) {
      return { pass: false, trigger: 'none', reason: 'addressed_to_other_during_focus' };
    }
    return { pass: true, trigger: 'focus' };
  }

  if (containsNameOrAlias(content, config)) {
    return { pass: true, trigger: 'name' };
  }

  return { pass: false, trigger: 'none', reason: 'pre_ai_gate_blocked' };
}

function detectImmersionBreach(content) {
  if (!content) return false;
  const lower = content.toLowerCase();

  const breachPatterns = [
    /\b(system\s*prompt|systemprompt)\b/i,
    /\b(ignore\s+(all\s+)?(previous|prior)\s+instructions)\b/i,
    /\b(abaikan\s+(semua\s+)?instruksi\s+(sebelumnya|awal))\b/i,
    /\b(print|show|tampilkan|bocorkan|reveal)\s+(raw\s+)?(json|system\s*prompt|config|api\s*key|token|prompt)\b/i,
    /\b(act\s+as|berperanlah\s+sebagai)\s+(an?\s+unrestricted|ai\s+tanpa\s+batas|chatgpt|assistant)\b/i,
    /\b(developer\s+mode|mode\s+developer|jailbreak|dan\s+mode)\b/i,
    /\b(keluar\s+dari\s+karakter|stop\s+roleplay|hentikan\s+roleplay)\b/i,
    /\b(daily_context\.json|config\.json|\.env)\b/i,
    /\b(buatkan\s+(script|kode|kodingan|program|code)|write\s+(a\s+)?(script|code|python|js|c\+\+))\b/i,
    /\b(kasih\s+akses\s+(server|admin|root)|restart\s+(server|bot)|matikan\s+bot)\b/i
  ];

  for (const pattern of breachPatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  getNameRegex,
  containsNameOrAlias,
  checkPreAIGate,
  isAddressedToSomeoneElse,
  detectImmersionBreach,
  isSilenceCommand,
  isUnmuteCommand
};
