'use strict';
/**
 * LogStream — Sistem Realtime Streaming untuk Terminal System Logs & Discord Chat
 * 
 * Fitur:
 * 1. Capture otomatis console.log, console.info, console.warn, console.error tanpa mengganggu terminal asli.
 * 2. Circular buffer in-memory untuk log sistem (maks 500) dan chat Discord (maks 200).
 * 3. Server-Sent Events (SSE) native tanpa dependensi eksternal, auto-reconnect di browser.
 * 4. Pembedaan tag dan kategori log (INPUT, OUTPUT, CMD, AI, VOICE/MUSIC, ERROR, SYSTEM).
 * 5. Perekaman pesan Discord (user & bot) lengkap dengan channel, author, avatar badge, reply context.
 */

const util = require('node:util');

const MAX_LOGS = 500;
const MAX_CHATS = 200;

const logsBuffer = [];
const chatsBuffer = [];
const sseClients = new Set();

let logCounter = 0;
let chatCounter = 0;
let isCaptured = false;

// Format waktu HH:mm:ss.SSS untuk log sistem
function formatTime(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// Format waktu jam:menit untuk chat Discord
function formatChatTime(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Deteksi tag & kategori dari string log
function parseLogMeta(text) {
  // Regex mencari [TAG] di awal string, misal [INPUT], [OUTPUT], [CMD], dll
  const tagMatch = text.match(/^\[([A-Z0-9_\s-]+)\]/i);
  const tag = tagMatch ? tagMatch[1].toUpperCase().trim() : '';

  let category = 'system';
  if (/^(INPUT|OUTPUT|CMD|LIB|SEARCH)$/i.test(tag)) {
    category = 'chat';
  } else if (/^(AI|AI DECISION|AI TOKENS|LLM|CLASS_MODE|BURST|PROTOCOL BREACH)$/i.test(tag)) {
    category = 'ai';
  } else if (/^(MUSIC|VOICE|VOICE_WAITER|VC_TRACKER|SFX|SPOTIFY|TIKTOK|EL)$/i.test(tag)) {
    category = 'voice';
  } else if (/^(ERROR|CRITICAL|ANOMALY)$/i.test(tag)) {
    category = 'error';
  }

  return { tag: tag ? `[${tag}]` : '', category };
}

// Broadcast pesan SSE ke semua client terhubung
function broadcast(type, data) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// Inisialisasi penangkapan console (idempotent)
function initLogCapture() {
  if (isCaptured) return;
  isCaptured = true;

  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  function capture(level, args) {
    try {
      const rawText = util.format(...args);
      // Hapus ANSI escape code warna jika ada
      const cleanText = rawText.replace(/\u001b\[[0-9;]*m/g, '');
      const { tag, category } = parseLogMeta(cleanText);

      const logItem = {
        id: ++logCounter,
        timestamp: Date.now(),
        timeStr: formatTime(),
        level, // 'info' | 'warn' | 'error'
        tag,
        category, // 'chat' | 'ai' | 'voice' | 'error' | 'system'
        message: cleanText
      };

      logsBuffer.push(logItem);
      if (logsBuffer.length > MAX_LOGS) {
        logsBuffer.shift();
      }

      broadcast('log', logItem);
    } catch (_) {}
  }

  console.log = function(...args) {
    originalLog.apply(console, args);
    capture('info', args);
  };

  console.info = function(...args) {
    originalInfo.apply(console, args);
    capture('info', args);
  };

  console.warn = function(...args) {
    originalWarn.apply(console, args);
    capture('warn', args);
  };

  console.error = function(...args) {
    originalError.apply(console, args);
    capture('error', args);
  };
}

// Rekam pesan Discord untuk tab Chat Realtime
function recordChat(msgData = {}) {
  try {
    const rawDate = msgData.timestamp ? new Date(msgData.timestamp) : new Date();
    const isBot = Boolean(msgData.isBot);
    const userId = String(msgData.userId || '');
    const authorName = msgData.authorName || (isBot ? 'Callista' : 'User');
    const isJoy = userId === '833196669940138004' || authorName.toLowerCase() === 'rieka' || authorName.toLowerCase().includes('mas joy');
    const content = String(msgData.content || '').trim();
    const isVoiceNote = content.startsWith('[voice_note]');
    const channelLabel = msgData.channelLabel || (msgData.channelId ? `#${msgData.channelId}` : '#channel');

    const chatItem = {
      id: msgData.id || `chat_${++chatCounter}_${Date.now()}`,
      timestamp: rawDate.getTime(),
      timeStr: formatChatTime(rawDate),
      channelId: msgData.channelId || 'general',
      channelLabel,
      authorName,
      userId,
      isBot,
      isJoy,
      isVoiceNote,
      content,
      replyToAuthorName: msgData.replyToAuthorName || null,
      replyToContent: msgData.replyToContent || null
    };

    chatsBuffer.push(chatItem);
    if (chatsBuffer.length > MAX_CHATS) {
      chatsBuffer.shift();
    }

    broadcast('chat', chatItem);
  } catch (_) {}
}

// Handler HTTP Server-Sent Events (SSE)
function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Kirim data snapshot awal
  const initPayload = JSON.stringify({
    type: 'init',
    data: {
      logs: logsBuffer.slice(-250),
      chats: chatsBuffer.slice(-100)
    }
  });
  res.write(`data: ${initPayload}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
}

// Heartbeat ping berkala agar koneksi SSE tidak terputus oleh proxy/browser (15s)
const heartbeat = setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch (_) {
      sseClients.delete(client);
    }
  }
}, 15000);
if (heartbeat.unref) heartbeat.unref();

function getSnapshot() {
  return {
    logs: logsBuffer,
    chats: chatsBuffer,
    connectedClients: sseClients.size
  };
}

function clearLogs() {
  logsBuffer.length = 0;
  broadcast('clear_logs', {});
}

function clearChats() {
  chatsBuffer.length = 0;
  broadcast('clear_chats', {});
}

module.exports = {
  initLogCapture,
  recordChat,
  handleSse,
  getSnapshot,
  clearLogs,
  clearChats
};
