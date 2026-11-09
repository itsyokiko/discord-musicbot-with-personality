/**
 * TinyFish Search API — pencarian lagu YouTube tanpa AI.
 *
 * Kenapa modul terpisah:
 * - Parser perintah tetap pure (musicCommands.js).
 * - Bot cuma butuh satu fungsi: searchYouTube(query).
 * - Hasil pencarian disimpan per channel+user supaya bisa dipilih
 *   lewat "nomor 1 ke abcd" tanpa memanggil API lagi.
 *
 * API key: TINYFISH_API_KEY di .env (jangan hardcode).
 */

const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai';
const SEARCH_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 10;
const PAGE_SIZE = 5;
const CACHE_MAX = 200;

const STORE_PATH = path.resolve(__dirname, '../data/searches.json');
const MAX_PERSISTED_SEARCHES = 100;

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (data && typeof data === 'object') {
        return {
          searches: typeof data.searches === 'object' && data.searches ? data.searches : {},
          latestByUser: typeof data.latestByUser === 'object' && data.latestByUser ? data.latestByUser : {},
        };
      }
    }
  } catch (e) {
    console.warn('[SEARCH] Gagal load searches.json:', e.message);
  }
  return { searches: {}, latestByUser: {} };
}

let store = loadStore();

function saveStore() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.error('[SEARCH] Gagal simpan searches.json:', e.message);
  }
}

const searchCache = new Map();

function getApiKey() {
  return String(process.env.TINYFISH_API_KEY || '').trim();
}

function cacheKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

const VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?[^#]*\bv=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

function youtubeVideoId(url) {
  const match = String(url || '').match(VIDEO_ID_RE);
  return match ? match[1] : null;
}

function normalizeYouTubeUrl(url) {
  const id = youtubeVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/**
 * Cari video YouTube lewat TinyFish.
 * Query selalu ditambah "youtube" + include_domains=youtube.com.
 *
 * @returns {Promise<{query: string, results: Array<{position:number,id:string,title:string,url:string,snippet:string,siteName:string}>}>}
 */
async function searchYouTube(query, { limit = MAX_RESULTS } = {}) {
  const key = getApiKey();
  if (!key) throw new Error('TINYFISH_API_KEY belum di-set di .env');

  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) throw new Error('Query pencarian kosong');

  // Hapus semua kemunculan kata "youtube" dari query sebelum append, bukan hanya trailing.
  const baseQuery = cleanQuery.replace(/\byoutube\b/gi, '').replace(/\s{2,}/g, ' ').trim() || cleanQuery;

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('query', `${baseQuery} youtube`);
  url.searchParams.set('include_domains', 'youtube.com');
  url.searchParams.set('language', 'en');
  url.searchParams.set('purpose', 'Find a YouTube video link to play or save to a music playlist');

  const res = await fetch(url, {
    headers: { 'X-API-Key': key },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TinyFish ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }

  const data = await res.json();
  const results = [];
  const seen = new Set();

  for (const item of Array.isArray(data.results) ? data.results : []) {
    const id = youtubeVideoId(item?.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push({
      position: results.length + 1,
      id,
      title: String(item.title || `YouTube ${id}`).trim(),
      url: `https://www.youtube.com/watch?v=${id}`,
      snippet: String(item.snippet || '').trim(),
      siteName: String(item.site_name || 'youtube.com').trim(),
    });
    if (results.length >= limit) break;
  }

  return { query: cleanQuery, results };
}

function saveSearch(channelId, userId, { query, results, messageId = null, page = 0, isHidden = false } = {}) {
  const now = Date.now();
  const cKey = cacheKey(channelId, userId);
  const entry = {
    messageId: messageId || null,
    channelId,
    userId,
    query: String(query || '').trim(),
    results: Array.isArray(results) ? results : [],
    page: page || 0,
    isHidden: Boolean(isHidden),
    at: now,
  };

  for (const [key, item] of searchCache) {
    if (now - item.at > SEARCH_TTL_MS) searchCache.delete(key);
  }
  if (searchCache.size >= CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(cKey, entry);

  if (messageId) {
    store.searches[messageId] = entry;
    store.latestByUser[cKey] = messageId;

    const keys = Object.keys(store.searches);
    if (keys.length > MAX_PERSISTED_SEARCHES) {
      const oldestKey = keys.sort((a, b) => (store.searches[a].at || 0) - (store.searches[b].at || 0))[0];
      if (oldestKey) delete store.searches[oldestKey];
    }
    saveStore();
  }
}

function getSearchByMessageId(messageId) {
  if (!messageId) return null;
  return store.searches[messageId] || null;
}

function updateSearchState(messageId, { page, isHidden } = {}) {
  if (!messageId || !store.searches[messageId]) return;
  if (page !== undefined) store.searches[messageId].page = page;
  if (isHidden !== undefined) store.searches[messageId].isHidden = isHidden;
  saveStore();
}

function getSearch(channelId, userId, messageId = null) {
  if (messageId && store.searches[messageId]) {
    return store.searches[messageId];
  }

  const cKey = cacheKey(channelId, userId);
  const latestMessageId = store.latestByUser[cKey];
  if (latestMessageId && store.searches[latestMessageId]) {
    return store.searches[latestMessageId];
  }

  const entry = searchCache.get(cKey);
  if (entry) return entry;

  return null;
}

function clearSearch(channelId, userId) {
  const cKey = cacheKey(channelId, userId);
  searchCache.delete(cKey);
  delete store.latestByUser[cKey];
  saveStore();
}

/**
 * Buat embed hasil pencarian YouTube (halaman 5 data, atau mode ringkas disembunyikan).
 */
function buildSearchEmbed(query, results = [], { page = 0, isHidden = false } = {}) {
  const total = results.length;
  const embed = new EmbedBuilder().setColor(0xED4245);

  if (isHidden) {
    embed
      .setAuthor({ name: '🔍 Hasil Pencarian' })
      .setTitle(`"${query}"`)
      .setFooter({ text: `${total} hasil disembunyikan · Balas >p 1-${total} untuk memutar` });
    return embed;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = results.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const lines = slice.map((r) => {
    const cleanTitle = (r.title || 'Video YouTube').replace(/[\[\]]/g, '');
    return `**${r.position}.** [${cleanTitle}](${r.url})`;
  });

  embed
    .setAuthor({ name: '🔍 Hasil Pencarian YouTube' })
    .setTitle(`"${query}"`)
    .setDescription(lines.length ? lines.join('\n\n') : '_(tidak ada hasil)_')
    .setFooter({
      text: `Halaman ${safePage + 1}/${totalPages} (${total} hasil) · Balas >p 1-${total} untuk memutar`,
    });

  return embed;
}

/**
 * Buat komponen tombol pagination & sembunyikan untuk hasil pencarian.
 */
function buildSearchComponents(userId, results = [], { page = 0, isHidden = false } = {}) {
  const total = results.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const row = new ActionRowBuilder();

  if (isHidden) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`search_show:${userId}:${safePage}`)
        .setLabel('👁️ Tampilkan')
        .setStyle(ButtonStyle.Success)
    );
    return [row];
  }

  if (totalPages > 1 && safePage > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`search_page:${userId}:${safePage - 1}`)
        .setLabel('◀ Prev')
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (totalPages > 1 && safePage < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`search_page:${userId}:${safePage + 1}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`search_hide:${userId}:${safePage}`)
      .setLabel('👁️ Sembunyikan')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

module.exports = {
  SEARCH_TTL_MS,
  MAX_RESULTS,
  PAGE_SIZE,
  youtubeVideoId,
  normalizeYouTubeUrl,
  searchYouTube,
  saveSearch,
  getSearch,
  getSearchByMessageId,
  updateSearchState,
  clearSearch,
  buildSearchEmbed,
  buildSearchComponents,
};
