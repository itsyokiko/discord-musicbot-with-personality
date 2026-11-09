/**
 * Plugin DisTube v5 berbasis @distube/ytdl-core v5.
 *
 * Kenapa bukan @distube/youtube?
 * - @distube/youtube@1.0.4 memakai ytdl-core 4.16.12 yang sudah tidak bisa
 *   membaca signature player YouTube terbaru ("Could not parse decipher
 *   function") -> error "Failed to find any playable formats".
 * - ytdl-core 5.x menyelesaikan signature secara lokal, mendukung PO token,
 *   dan menyediakan URL audio langsung.
 *
 * Plugin ini menangani video tunggal, pencarian, dan playlist
 * (playlist memakai resolver Innertube di src/youtubePlaylist.js).
 */

const { ExtractorPlugin, Playlist, Song } = require('distube');
const { SearchType, Ytdl } = require('@distube/ytdl-core');
const youtubePlaylist = require('./youtubePlaylist');

const INFO_CACHE_TTL_MS = 5 * 60 * 1000;
const INFO_CACHE_MAX = 60;
const MAX_PLAYLIST_SONGS = 100;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

function parseYouTubeUrl(input) {
  try {
    const url = new URL(String(input || '').trim());
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch (e) {
    return null;
  }
}

/** Ambil ID video dari URL YouTube atau ID mentah. */
function extractVideoId(input) {
  const value = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  const url = parseYouTubeUrl(value);
  if (!url) return null;

  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

  const match = url.pathname.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function isYouTubeUrl(input) {
  return Boolean(parseYouTubeUrl(input));
}

function pickThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return undefined;
  return thumbnails[thumbnails.length - 1]?.url;
}

class YouTubePluginV5 extends ExtractorPlugin {
  constructor(options = {}) {
    super();
    this.yt = new Ytdl(options.cookie ? { cookie: options.cookie } : {});
    this.infoCache = new Map();
  }

  validate(url) {
    if (!isYouTubeUrl(url)) return false;
    return Boolean(extractVideoId(url) || youtubePlaylist.extractPlaylistId(url));
  }

  #cacheInfo(videoId, info) {
    if (!videoId) return;
    this.infoCache.set(videoId, { info, at: Date.now() });
    if (this.infoCache.size > INFO_CACHE_MAX) {
      const oldest = this.infoCache.keys().next().value;
      this.infoCache.delete(oldest);
    }
  }

  async #getInfo(url) {
    const videoId = extractVideoId(url);
    const cached = videoId ? this.infoCache.get(videoId) : null;
    if (cached && Date.now() - cached.at < INFO_CACHE_TTL_MS) {
      return cached.info;
    }

    const info = await this.yt.getInfo(url);
    this.#cacheInfo(videoId || info.videoDetails?.id, info);
    return info;
  }

  #songFromInfo(info, options = {}) {
    const details = info.videoDetails || {};
    return new Song(
      {
        plugin: this,
        source: 'youtube',
        playFromSource: true,
        id: details.id,
        name: details.title,
        url: details.url,
        thumbnail: pickThumbnail(details.thumbnails),
        duration: Number(details.lengthSeconds) || 0,
        views: Number(details.viewCount) || 0,
        likes: Number(details.likes) || 0,
        isLive: Boolean(details.isLive),
        uploader: {
          name: details.author?.name,
          url: details.author?.url,
        },
        ageRestricted: Boolean(details.isAgeRestricted),
      },
      options
    );
  }

  #songFromSummary(video, options = {}) {
    return new Song(
      {
        plugin: this,
        source: 'youtube',
        playFromSource: true,
        id: video.id,
        name: video.title,
        url: video.url,
        thumbnail: pickThumbnail(video.thumbnails),
        duration: Number(video.lengthSeconds) || 0,
        views: Number(video.viewCount) || 0,
        uploader: {
          name: video.author?.name,
          url: video.author?.url,
        },
      },
      options
    );
  }

  async resolve(url, options = {}) {
    const videoId = extractVideoId(url);

    // URL /playlist?list=... (tanpa video) -> playlist
    if (!videoId) {
      const playlistId = youtubePlaylist.extractPlaylistId(url);
      if (playlistId) {
        const info = await youtubePlaylist.fetchPlaylist(playlistId, {
          maxSongs: MAX_PLAYLIST_SONGS,
        });
        const songs = info.videos.map((video) =>
          new Song(
            {
              plugin: this,
              source: 'youtube',
              playFromSource: true,
              id: video.id,
              name: video.title || video.id,
              url: `https://www.youtube.com/watch?v=${video.id}`,
              thumbnail: video.thumbnail,
              duration: Number(video.duration) || 0,
            },
            options
          )
        );

        return new Playlist(
          {
            source: 'youtube',
            id: info.id,
            name: info.name,
            url: `https://www.youtube.com/playlist?list=${info.id}`,
            thumbnail: songs.find((song) => song.thumbnail)?.thumbnail,
            songs,
          },
          options
        );
      }
    }

    const info = await this.#getInfo(url);
    return this.#songFromInfo(info, options);
  }

  async searchSong(query, options = {}) {
    const results = await this.yt.search(query, {
      type: SearchType.Video,
      limit: 1,
    });
    const first = results[0];
    if (!first) return null;
    return this.#songFromSummary(first, options);
  }

  async getStreamURL(song) {
    const info = await this.#getInfo(song.url);
    const formats = (info.formats || []).filter(
      (format) => format.hasAudio && format.url && !format.isDrm
    );
    if (!formats.length) {
      throw new Error('Failed to find any playable formats: YouTube tidak mengirim format audio');
    }

    // Utamakan audio-only, lalu bitrate tertinggi.
    const audioOnly = formats.filter((format) => !format.hasVideo);
    const pool = audioOnly.length ? audioOnly : formats;
    pool.sort(
      (a, b) =>
        (Number(b.audioBitrate) || 0) - (Number(a.audioBitrate) || 0) ||
        (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0)
    );

    return pool[0].url;
  }

  async getRelatedSongs(song) {
    try {
      const related = await this.yt.getRelated(song.url);
      return related
        .slice(0, 10)
        .filter((video) => video.id !== song.id)
        .map((video) => this.#songFromSummary(video, {}));
    } catch (e) {
      return [];
    }
  }
}

module.exports = {
  YouTubePluginV5,
  extractVideoId,
  isYouTubeUrl,
  MAX_PLAYLIST_SONGS,
};
