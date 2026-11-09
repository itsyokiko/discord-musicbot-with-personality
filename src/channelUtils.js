/**
 * Channel Utilities — helper untuk info channel Discord (text only)
 */

function formatChannelList(guild, options = {}) {
  const {
    includeCategories = true,
    includeVoice = false,
    includeThreads = false,
    filterType = null, // 'GUILD_TEXT', 'GUILD_VOICE', 'GUILD_CATEGORY', 'GUILD_NEWS', etc
    maxChannels = 50,
  } = options;

  if (!guild) return '❌ Guild tidak ditemukan.';

  const channels = [...guild.channels.cache.values()];

  // Filter
  let filtered = channels.filter(c => {
    if (filterType && c.type !== filterType) return false;
    if (!includeVoice && c.isVoiceBased?.()) return false;
    if (!includeThreads && c.isThread?.()) return false;
    if (!includeCategories && c.type === 4) return false; // GUILD_CATEGORY
    return true;
  });

  // Sort: categories first, then by position
  filtered.sort((a, b) => {
    if (a.type === 4 && b.type !== 4) return -1;
    if (a.type !== 4 && b.type === 4) return 1;
    return (a.rawPosition || 0) - (b.rawPosition || 0);
  });

  if (filtered.length === 0) {
    return '📭 Tidak ada channel yang cocok filter.';
  }

  // Limit
  const limited = filtered.slice(0, maxChannels);
  const hasMore = filtered.length > maxChannels;

  const lines = limited.map(c => {
    const typeIcon = getTypeIcon(c.type);
    const id = c.id;
    const name = c.name || 'unknown';
    const parent = c.parent ? ` ⟵ ${c.parent.name}` : '';
    return `\`${id}\` ${typeIcon} **${name}**${parent}`;
  });

  if (hasMore) {
    lines.push(`\n... dan ${filtered.length - maxChannels} channel lagi (pakai filter atau minta spesifik)`);
  }

  return lines.join('\n');
}

function getTypeIcon(type) {
  switch (type) {
    case 0: return '💬'; // GUILD_TEXT
    case 2: return '🔊'; // GUILD_VOICE
    case 4: return '📁'; // GUILD_CATEGORY
    case 5: return '📢'; // GUILD_NEWS
    case 10: return '🧵'; // GUILD_NEWS_THREAD
    case 11: return '🧵'; // GUILD_PUBLIC_THREAD
    case 12: return '🧵'; // GUILD_PRIVATE_THREAD
    case 13: return '🎭'; // GUILD_STAGE_VOICE
    case 14: return '📚'; // GUILD_DIRECTORY
    case 15: return '🗺️'; // GUILD_FORUM
    case 16: return '📺'; // GUILD_MEDIA
    default: return '❓';
  }
}

function getChannelInfo(channel) {
  if (!channel) return '❌ Channel tidak ditemukan.';

  const lines = [
    `**${getTypeIcon(channel.type)} ${channel.name || 'unknown'}**`,
    `> **ID:** \`${channel.id}\``,
    `> **Tipe:** ${getTypeName(channel.type)}`,
  ];

  if (channel.topic) lines.push(`> **Topik:** ${channel.topic}`);
  if (channel.nsfw) lines.push('> **NSFW:** Ya');
  if (channel.parent) lines.push(`> **Kategori:** ${channel.parent.name} (\`${channel.parent.id}\`)`);
  if (channel.rateLimitPerUser) lines.push(`> **Slowmode:** ${channel.rateLimitPerUser} detik`);
  if (channel.position !== undefined) lines.push(`> **Posisi:** #${channel.rawPosition + 1}`);
  if (channel.isThread?.()) {
    lines.push(`> **Thread dari:** ${channel.parent?.name || '?'} (\`${channel.parentId || '?'}\`)`);
    lines.push(`> **Archive:** ${channel.autoArchiveDuration} menit`);
  }

  return lines.join('\n');
}

function getTypeName(type) {
  const names = {
    0: 'Text Channel',
    2: 'Voice Channel',
    4: 'Category',
    5: 'Announcement (News)',
    10: 'News Thread',
    11: 'Public Thread',
    12: 'Private Thread',
    13: 'Stage Voice',
    14: 'Directory',
    15: 'Forum',
    16: 'Media',
  };
  return names[type] || `Unknown (${type})`;
}

function findChannelByNameOrId(guild, query) {
  if (!guild) return null;
  const q = query.toLowerCase().trim();

  // Cari by ID exact
  if (/^\d{17,20}$/.test(q)) {
    return guild.channels.cache.get(q) || null;
  }

  // Cari by name (case-insensitive, partial)
  // Support both Map (mock) and Collection (Discord.js)
  const channels = guild.channels.cache;
  if (typeof channels.find === 'function') {
    return channels.find(c => c.name.toLowerCase().includes(q)) || null;
  }
  // Fallback for Map
  for (const c of channels.values()) {
    if (c.name.toLowerCase().includes(q)) return c;
  }
  return null;
}

function findChannelsByName(guild, query) {
  if (!guild) return [];
  const q = query.toLowerCase().trim();
  const channels = guild.channels.cache;
  if (typeof channels.filter === 'function') {
    return channels.filter(c => c.name.toLowerCase().includes(q));
  }
  // Fallback for Map
  const results = [];
  for (const c of channels.values()) {
    if (c.name.toLowerCase().includes(q)) results.push(c);
  }
  return results;
}

function buildChannelPromptSnippet() {
  return `
[CHANNEL INFO TERSEDIA]:
Callista bisa menyediakan info channel server Discord saat ini via format CHANNEL_LIST dan CHANNEL_INFO.

Format respons tambahan:
- CHANNEL_LIST: Kirim daftar channel (ID + nama). Set "channelFilter" ke "text" | "voice" | "category" | "all". Pakai saat user nanya "channel apa aja", "daftar channel", "id channel apa aja".
- CHANNEL_INFO: Kirim info detail 1 channel. Set "channelQuery" ke nama atau ID channel. Pakai saat user nanya "channel ini id berapa", "info channel #general", "channel #general detailnya apa".

Aturan penggunaan:
- Hanya jawab pertanyaan channel info YANG DITANYAKAN LANGSUNG (jangan proaktif menampilkan daftar).
- CHANNEL_LIST default filter "text" (hanya text channel). User bisa minta "voice", "category", atau "all".
- CHANNEL_INFO cari by nama partial (case-insensitive) atau ID exact.
- Info yang dikirim: ID, nama, tipe, topik, kategori parent, slowmode, NSFW, posisi.
- INI BUKAN akses admin/bot — hanya info publik yang terlihat member biasa.`;
}

module.exports = {
  formatChannelList,
  getChannelInfo,
  getTypeIcon,
  getTypeName,
  findChannelByNameOrId,
  findChannelsByName,
  buildChannelPromptSnippet,
};