/**
 * Spotify Extractor Plugin untuk DisTube v5.
 *
 * Mengambil metadata lagu, album, playlist, artist, dan podcast/episode
 * dari Spotify tanpa memerlukan API credentials berbayar (zero external dependencies,
 * menggunakan native Node fetch pada endpoint embed & oEmbed Spotify).
 *
 * Audio di-bridge secara lazy ke YouTube (YouTubePluginV5) saat lagu akan diputar,
 * sehingga playlist 50–100 lagu dapat masuk ke antrian secara instan tanpa rate-limit.
 *
 * Mendukung semua format link Spotify:
 * - Track: https://open.spotify.com/track/ID
 * - Album: https://open.spotify.com/album/ID
 * - Playlist: https://open.spotify.com/playlist/ID
 * - Artist (Top Tracks): https://open.spotify.com/artist/ID
 * - Episode / Podcast: https://open.spotify.com/episode/ID
 * - Show: https://open.spotify.com/show/ID
 * - Localized URLs: https://open.spotify.com/intl-id/track/ID (semua subpath intl-*)
 * - Spotify URIs: spotify:track:ID, spotify:album:ID, spotify:playlist:ID, dsb.
 * - Short links: https://spotify.link/xxx, https://spoti.fi/xxx
 */

'use strict';

const { ExtractorPlugin, Playlist, Song } = require('distube');

const SPOTIFY_HOSTS = new Set([
  'open.spotify.com',
  'spotify.com',
  'www.spotify.com',
  'spotify.link',
  'spoti.fi',
]);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Ekstrak URL atau URI Spotify murni dari string (membersihkan prefix bot lain seperti m!p atau tag < >).
 */
function extractSpotifyUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (raw.startsWith('spotify:')) {
    const m = raw.match(/spotify:(?:track|album|playlist|artist|episode|show):[A-Za-z0-9]+/i);
    return m ? m[0] : null;
  }
  const match = raw.match(/https?:\/\/(?:open\.|www\.)?(?:spotify\.com|spotify\.link|spoti\.fi)\/[^\s<>]+/i);
  return match ? match[0] : null;
}

/**
 * Cek apakah input adalah link atau URI Spotify.
 */
function isSpotifyUrl(input) {
  if (!input || typeof input !== 'string') return false;
  const raw = input.trim();
  if (/^spotify:(?:track|album|playlist|artist|episode|show):[A-Za-z0-9]+$/i.test(raw)) return true;
  const extracted = extractSpotifyUrl(raw);
  if (!extracted) return false;
  try {
    const parsed = new URL(extracted);
    return SPOTIFY_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Parse dan normalisasi input Spotify ke format type & ID standar.
 */
async function parseSpotifyInput(input) {
  if (!input || typeof input !== 'string') return null;
  let raw = extractSpotifyUrl(input) || input.trim();

  // 1. Spotify URI (spotify:track:ID)
  if (raw.startsWith('spotify:')) {
    const parts = raw.split(':');
    if (parts.length >= 3) {
      const type = parts[1].toLowerCase();
      const id = parts[2];
      return {
        type,
        id,
        url: `https://open.spotify.com/${type}/${id}`,
        embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
      };
    }
    return null;
  }

  // 2. Short links (spotify.link / spoti.fi) -> follow redirect
  if (/^https?:\/\/(?:www\.)?(?:spotify\.link|spoti\.fi)\//i.test(raw)) {
    try {
      const res = await fetch(raw, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.url) {
        raw = res.url;
      }
    } catch (e) {
      // fallback gunakan url asli
    }
  }

  // 3. Regular open.spotify.com URL
  try {
    const str = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(str);
    if (!SPOTIFY_HOSTS.has(parsed.hostname.toLowerCase())) return null;

    // Pattern mencakup intl-id, intl-es, dsb: /(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i
    const match = parsed.pathname.match(/(?:intl-[a-z]{2,5}(?:-[a-z]{2,5})?\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i);
    if (!match) return null;

    const type = match[1].toLowerCase();
    const id = match[2];

    return {
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
      embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
    };
  } catch {
    return null;
  }
}

/**
 * Ambil metadata dari halaman Spotify embed (JSON di __NEXT_DATA__).
 */
async function fetchSpotifyEmbedData(embedUrl) {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match || !match[1]) return null;

    const json = JSON.parse(match[1]);
    return json.props?.pageProps?.state?.data?.entity || null;
  } catch {
    return null;
  }
}

/**
 * Fallback oEmbed jika halaman embed tidak menghasilkan data.
 */
async function fetchSpotifyOembed(cleanUrl) {
  try {
    const oembedEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const res = await fetch(oembedEndpoint, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

class SpotifyPlugin extends ExtractorPlugin {
  constructor(options = {}) {
    super();
    this.youtubePlugin = options.youtubePlugin || null;
  }

  async validate(url) {
    return isSpotifyUrl(url);
  }

  async resolve(url, options = {}) {
    const info = await parseSpotifyInput(url);
    if (!info) {
      throw new Error(`URL Spotify tidak valid: ${url}`);
    }

    const entity = await fetchSpotifyEmbedData(info.embedUrl);
    const member = options.member;

    // A. Single Track / Episode
    if (info.type === 'track' || info.type === 'episode') {
      let title = entity?.name || entity?.title;
      let artist = (entity?.artists
        ? entity.artists.map((a) => a.name).join(', ')
        : (entity?.subtitle || entity?.show?.name || '')).replace(/\u00A0/g, ' ').trim();
      let duration = entity?.duration ? Math.round(entity.duration / 1000) : 0;
      let thumbnail = entity?.visualIdentity?.image?.[0]?.url || undefined;

      // Fallback ke oEmbed jika embed entity kosong
      if (!title) {
        const oembed = await fetchSpotifyOembed(info.url);
        if (oembed) {
          title = oembed.title || `Spotify ${info.type}`;
          artist = oembed.author_name || '';
          thumbnail = oembed.thumbnail_url || thumbnail;
        }
      }

      if (!title) {
        throw new Error(`Gagal mengambil metadata Spotify untuk track ${info.id}`);
      }

      const searchQuery = artist ? `${title} ${artist}` : title;

      return new Song(
        {
          plugin: this,
          source: 'spotify',
          playFromSource: true,
          id: info.id,
          name: title,
          url: info.url,
          thumbnail,
          duration,
          uploader: { name: artist },
          metadata: {
            spotifyType: info.type,
            spotifyId: info.id,
            artist,
            searchQuery,
            ...options.metadata,
          },
        },
        { member }
      );
    }

    // B. Playlist / Album / Artist / Show (Multi-track collection)
    let collectionName = entity?.name || entity?.title || 'Spotify Playlist';
    let collectionThumbnail = entity?.visualIdentity?.image?.[0]?.url || undefined;
    const rawTracks = entity?.trackList || [];

    // Fallback oEmbed jika judul kosong
    if (!collectionName || collectionName === 'Spotify Playlist') {
      const oembed = await fetchSpotifyOembed(info.url);
      if (oembed && oembed.title) {
        collectionName = oembed.title;
        collectionThumbnail = oembed.thumbnail_url || collectionThumbnail;
      }
    }

    if (!rawTracks.length && !entity) {
      throw new Error(`Gagal memuat playlist Spotify dari ${info.url}`);
    }

    const songs = rawTracks.map((t, idx) => {
      const trackTitle = t.title || t.name || `Track #${idx + 1}`;
      const trackArtist = (t.subtitle || (t.artists ? t.artists.map((a) => a.name).join(', ') : '')).replace(/\u00A0/g, ' ').trim();
      const trackDuration = t.duration ? Math.round(t.duration / 1000) : 0;
      const trackId = t.uri ? t.uri.replace(/^spotify:track:/, '') : (t.uid || `${info.id}_${idx}`);
      const trackUrl = t.uri && t.uri.startsWith('spotify:track:')
        ? `https://open.spotify.com/track/${trackId}`
        : info.url;
      const searchQuery = trackArtist ? `${trackTitle} ${trackArtist}` : trackTitle;

      return new Song(
        {
          plugin: this,
          source: 'spotify',
          playFromSource: true,
          id: trackId,
          name: trackTitle,
          url: trackUrl,
          thumbnail: collectionThumbnail,
          duration: trackDuration,
          uploader: { name: trackArtist },
          metadata: {
            spotifyType: 'track',
            spotifyId: trackId,
            artist: trackArtist,
            searchQuery,
            playlistName: collectionName,
            ...options.metadata,
          },
        },
        { member }
      );
    });

    if (!songs.length) {
      throw new Error(`Playlist Spotify "${collectionName}" kosong atau tidak memiliki lagu yang dapat diputar`);
    }

    return new Playlist(
      {
        source: 'spotify',
        id: info.id,
        name: collectionName,
        url: info.url,
        thumbnail: collectionThumbnail,
        songs,
      },
      { member }
    );
  }

  async getStreamURL(song) {
    if (song._cachedStreamUrl && Date.now() < song._cachedStreamExpiry) {
      return song._cachedStreamUrl;
    }

    if (!this.youtubePlugin) {
      throw new Error('SpotifyPlugin memerlukan YouTubePluginV5 untuk bridging audio stream');
    }

    const searchQuery = song.metadata?.searchQuery
      || (song.uploader?.name ? `${song.name} ${song.uploader.name}` : song.name);

    console.log(`[SPOTIFY] Bridging stream for "${searchQuery}" to YouTube...`);
    const ytSong = await this.youtubePlugin.searchSong(searchQuery);
    if (!ytSong) {
      throw new Error(`Lagu "${song.name}" tidak ditemukan di YouTube untuk diputar`);
    }

    const streamUrl = await this.youtubePlugin.getStreamURL(ytSong);
    song._cachedStreamUrl = streamUrl;
    song._cachedStreamExpiry = Date.now() + 30 * 60 * 1000; // cache selama 30 menit
    return streamUrl;
  }

  async getRelatedSongs() {
    return [];
  }
}

module.exports = {
  SpotifyPlugin,
  isSpotifyUrl,
  parseSpotifyInput,
  fetchSpotifyEmbedData,
  fetchSpotifyOembed,
};
