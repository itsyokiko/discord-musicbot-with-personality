/**
 * SFX Store — Pengelola audio lokal / efek suara tunggal untuk Callista.
 *
 * Aturan:
 * - Hanya 1 file audio lokal yang dimuat dalam satu waktu.
 * - File audio disimpan di data/sfx/sfx_audio.<ext>
 * - Metadata disimpan di data/sfx/sfx_meta.json (atomic write via tmp+rename).
 * - Durasi dihitung otomatis memakai ffmpeg-static bila tersedia.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const SFX_DIR = path.resolve(__dirname, '../data/sfx');
const META_FILE = path.join(SFX_DIR, 'sfx_meta.json');

let activeServerPort = Number(process.env.PORT) || 3000;
let cachedMeta = null;

function setServerPort(port) {
  if (port && Number(port)) {
    activeServerPort = Number(port);
  }
}

function getServerPort() {
  return activeServerPort;
}

function getStreamUrl() {
  return `http://127.0.0.1:${activeServerPort}/api/sfx/stream`;
}

function ensureSfxDir() {
  if (!fs.existsSync(SFX_DIR)) {
    fs.mkdirSync(SFX_DIR, { recursive: true });
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.m4a': return 'audio/mp4';
    case '.flac': return 'audio/flac';
    case '.aac': return 'audio/aac';
    case '.webm': return 'audio/webm';
    case '.opus': return 'audio/opus';
    default: return 'application/octet-stream';
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function probeAudioDuration(filePath) {
  try {
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return 0;
    const res = cp.spawnSync(ffmpegPath, ['-i', filePath], { encoding: 'utf8', timeout: 5000 });
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(res.stderr || '');
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      return Math.round(hours * 3600 + minutes * 60 + seconds);
    }
  } catch (e) {
    console.warn('[SFX] Gagal membaca durasi audio:', e.message);
  }
  return 0;
}

function loadMeta() {
  ensureSfxDir();
  try {
    if (fs.existsSync(META_FILE)) {
      const raw = fs.readFileSync(META_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.fileName) {
        const fullPath = path.join(SFX_DIR, data.fileName);
        if (fs.existsSync(fullPath)) {
          data.path = fullPath;
          return data;
        }
      }
    }
  } catch (e) {
    console.warn('[SFX LOAD ERROR]', e.message);
  }
  return null;
}

cachedMeta = loadMeta();

function getSfxInfo() {
  if (cachedMeta && cachedMeta.path && fs.existsSync(cachedMeta.path)) {
    return cachedMeta;
  }
  cachedMeta = loadMeta();
  return cachedMeta;
}

function hasSfx() {
  const info = getSfxInfo();
  return Boolean(info && info.path && fs.existsSync(info.path));
}

function getSfxFilePath() {
  const info = getSfxInfo();
  return info?.path || null;
}

/**
 * Simpan file SFX baru (menggantikan yang lama jika ada).
 * @param {Buffer} buffer - Buffer file audio
 * @param {string} originalName - Nama asli file yang diupload (mis. "bruh.mp3")
 */
function saveSfxFile(buffer, originalName = 'audio.mp3') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer audio kosong atau tidak valid');
  }

  ensureSfxDir();

  // Hapus semua file lama di folder sfx
  try {
    const existing = fs.readdirSync(SFX_DIR);
    for (const f of existing) {
      try {
        fs.unlinkSync(path.join(SFX_DIR, f));
      } catch (_) {}
    }
  } catch (_) {}

  const rawExt = path.extname(originalName || '').toLowerCase();
  const ext = rawExt || '.mp3';
  const fileName = `sfx_audio${ext}`;
  const targetPath = path.join(SFX_DIR, fileName);

  fs.writeFileSync(targetPath, buffer);

  const duration = probeAudioDuration(targetPath);
  const formattedDuration = formatDuration(duration);
  const formattedSize = formatFileSize(buffer.length);

  const meta = {
    originalName: path.basename(originalName || `audio${ext}`),
    fileName,
    path: targetPath,
    ext,
    size: buffer.length,
    formattedSize,
    duration,
    formattedDuration,
    mimeType: getMimeType(targetPath),
    loadedAt: new Date().toISOString(),
  };

  const tmpMeta = `${META_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2), 'utf8');
    fs.renameSync(tmpMeta, META_FILE);
  } catch (e) {
    try { if (fs.existsSync(tmpMeta)) fs.unlinkSync(tmpMeta); } catch (_) {}
    console.error('[SFX META SAVE ERROR]', e.message);
  }

  cachedMeta = meta;
  return meta;
}

/**
 * Hapus SFX yang tersimpan.
 */
function deleteSfx() {
  ensureSfxDir();
  try {
    const existing = fs.readdirSync(SFX_DIR);
    for (const f of existing) {
      try {
        fs.unlinkSync(path.join(SFX_DIR, f));
      } catch (_) {}
    }
  } catch (_) {}
  cachedMeta = null;
  return { success: true };
}

module.exports = {
  hasSfx,
  getSfxInfo,
  getSfxFilePath,
  saveSfxFile,
  deleteSfx,
  getMimeType,
  setServerPort,
  getServerPort,
  getStreamUrl,
  formatDuration,
  formatFileSize,
  // Ekspor untuk pengujian
  __test: {
    probeAudioDuration,
    META_FILE,
    SFX_DIR,
  },
};
