const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('./storage');
const background = require('./background');
const stickerEmoji = require('./stickerEmojiStore');
const gifSearch = require('./gifSearch');
const musicStore = require('./musicStore');
const sfxStore = require('./sfxStore');

function startServer(port) {
  sfxStore.setServerPort(port);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      const htmlPath = path.resolve(__dirname, '../public/index.html');
      fs.readFile(htmlPath, (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading dashboard');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(storage.getConfig()));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bot-state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(storage.getBotState()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bot-state/toggle') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const current = storage.getBotState();
          let target = !current.isResponding;
          if (body) {
            try {
              const parsed = JSON.parse(body);
              if (typeof parsed.isResponding === 'boolean') {
                target = parsed.isResponding;
              }
            } catch (e) {}
          }
          const updated = storage.setBotResponding(target, 'Toggle dari Web Dashboard');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const updated = storage.updateConfig(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'GET' && url.pathname === '/api/background') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        background: background.getCallistaBackground(),
        isCustom: background.hasCustomBackground(),
        file: 'data/callista_background.txt'
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/background') {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 100000 && !tooLarge) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
        }
      });
      req.on('error', () => {}); // suppress destroy-induced error
      req.on('end', () => {
        if (tooLarge) return;
        try {
          const { background: text } = JSON.parse(body);
          const saved = background.saveCallistaBackground(text);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, length: saved.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/memory') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(storage.getMemory()));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/daily-context') {
      const dailyStore = require('./dailyContextStore');
      const cfg = storage.getConfig();
      const ctx = dailyStore.loadDailyContext(cfg.timezone || 'Asia/Jakarta');
      const current = dailyStore.getCurrentActivityInfo(ctx);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ context: ctx, current }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health/state') {
      const moodSystem = require('./moodSystem');
      const dailyStore = require('./dailyContextStore');
      const cfg = storage.getConfig();
      const tz = cfg.timezone || 'Asia/Jakarta';
      const { dateStr } = dailyStore.getTimeInTimezone(new Date(), tz);
      const result = moodSystem.calculateMood(dateStr, { syncBotState: false });
      const healthData = moodSystem.loadHealthState(dateStr);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, healthData }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/academic/roadmap') {
      const collegeRoadmap = require('./collegeRoadmap');
      const dailyStore = require('./dailyContextStore');
      const cfg = storage.getConfig();
      const tz = cfg.timezone || 'Asia/Jakarta';
      const { dateStr } = dailyStore.getTimeInTimezone(new Date(), tz);

      const roadmap = collegeRoadmap.loadRoadmap();
      const status = collegeRoadmap.getAcademicStatus(dateStr, roadmap);
      const classesToday = collegeRoadmap.getClassesForDate(dateStr, roadmap);
      const activeAssignments = collegeRoadmap.getActiveAssignments(dateStr, roadmap);
      const currentSession = collegeRoadmap.getCurrentClassSession(new Date(), tz);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        date: dateStr,
        roadmap,
        academicStatus: status,
        currentSession,
        classesToday,
        activeAssignments,
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/academic/next-semester') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const collegeRoadmap = require('./collegeRoadmap');
          const options = JSON.parse(body || '{}');
          const updated = collegeRoadmap.generateNextSemesterRoadmap(options);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, roadmap: updated }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Gagal generate semester' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/academic/set-break') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const collegeRoadmap = require('./collegeRoadmap');
          const roadmap = collegeRoadmap.loadRoadmap();
          if (!roadmap) throw new Error('Roadmap tidak ditemukan');

          const { startDate, endDate, description } = JSON.parse(body || '{}');
          if (!roadmap.semester_transition) roadmap.semester_transition = {};
          roadmap.semester_transition.break_period = {
            start_date: startDate || null,
            end_date: endDate || null,
            status: startDate ? 'scheduled' : 'not_scheduled',
            description: description || 'Libur jeda antar-semester',
          };
          roadmap.last_updated = new Date().toISOString();
          collegeRoadmap.saveRoadmap(roadmap);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, breakPeriod: roadmap.semester_transition.break_period }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Gagal mengatur libur' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/relationships') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(storage.getConfig().relationships || {}));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/relationships') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { key, ...profile } = JSON.parse(body);
          if (!key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing key' }));
            return;
          }
          // updateRelationshipProfile tidak ada; gunakan updateUserMemory
          const updated = storage.updateUserMemory(key, profile);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'POST' && url.pathname === '/api/memory/user') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { userId, ...updates } = JSON.parse(body);
          if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing userId' }));
            return;
          }
          const updated = storage.updateUserMemory(userId, updates);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'DELETE' && url.pathname === '/api/memory/user') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { userId } = JSON.parse(body);
          if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing userId' }));
            return;
          }
          const ok = storage.deleteUserMemory(userId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: ok }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    // ===== STICKER & EMOJI MANAGEMENT =====

    if (req.method === 'GET' && url.pathname === '/api/sticker-emoji') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...stickerEmoji.loadStickerEmoji(),
        expressions: stickerEmoji.getAllExpressions()
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sticker-emoji/custom-expression') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { value, label } = JSON.parse(body);
          const expr = stickerEmoji.addCustomExpression(value, label);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, expression: expr }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/sticker-emoji/custom-expression') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { value, label } = JSON.parse(body);
          if (!value) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing value' }));
            return;
          }
          const expr = stickerEmoji.updateCustomExpression(value, { label });
          if (!expr) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Custom expression not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, expression: expr }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/sticker-emoji/custom-expression') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { value } = JSON.parse(body);
          if (!value) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing value' }));
            return;
          }
          const ok = stickerEmoji.deleteCustomExpression(value);
          if (!ok) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Tidak bisa hapus: ekspresi masih dipakai oleh emoji/sticker' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'GET' && url.pathname === '/api/sticker-emoji/settings') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stickerEmoji.getSettings()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sticker-emoji/settings') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const settings = stickerEmoji.updateSettings(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(settings));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sticker-emoji/emoji') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { label, expression, code } = JSON.parse(body);
          const emoji = stickerEmoji.addEmoji({ label, expression, code });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, emoji }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sticker-emoji/sticker') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { label, expression, stickerId } = JSON.parse(body);
          const sticker = stickerEmoji.addSticker({ label, expression, stickerId });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sticker }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/sticker-emoji/emoji') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id, ...updates } = JSON.parse(body);
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id' }));
            return;
          }
          const emoji = stickerEmoji.updateEmoji(id, updates);
          if (!emoji) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Emoji not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, emoji }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/sticker-emoji/sticker') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id, ...updates } = JSON.parse(body);
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id' }));
            return;
          }
          const sticker = stickerEmoji.updateSticker(id, updates);
          if (!sticker) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Sticker not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sticker }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/sticker-emoji/emoji') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id' }));
            return;
          }
          const ok = stickerEmoji.deleteEmoji(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: ok }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'DELETE' && url.pathname === '/api/sticker-emoji/sticker') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id' }));
            return;
          }
          const ok = stickerEmoji.deleteSticker(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: ok }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    // ===== GIF (GIPHY) MANAGEMENT =====

    if (req.method === 'GET' && url.pathname === '/api/gif/settings') {
      const settings = gifSearch.getGifSettings();
      // Sembunyikan API key sebagian untuk keamanan tampilan
      const masked = { ...settings };
      if (masked.apiKey) {
        masked.apiKeyMasked = masked.apiKey.slice(0, 6) + '...' + masked.apiKey.slice(-4);
        delete masked.apiKey; // JANGAN kirim key mentah ke browser
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...masked,
        defaultKeywords: gifSearch.DEFAULT_KEYWORDS
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gif/settings') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const settings = gifSearch.updateGifSettings(parsed);
          const masked = { ...settings };
          if (masked.apiKey) {
            masked.apiKeyMasked = masked.apiKey.slice(0, 6) + '...' + masked.apiKey.slice(-4);
          }
          delete masked.apiKey;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, settings: masked }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gif/test') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { expression } = JSON.parse(body || '{}');
          const expr = expression || 'senang';
          const result = await gifSearch.searchRandomGif(expr, 5);
          if (!result) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Tidak ada GIF ditemukan atau GIF nonaktif' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...result }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Internal server error' }));
        }
      });
      return;
    }

    // ===== MUSIC PLAYLIST MANAGEMENT =====

    if (req.method === 'GET' && url.pathname === '/api/playlists') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ playlists: musicStore.listPlaylists() }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/playlists') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { name, url: plUrl, aliases } = JSON.parse(body);
          if (!name || !plUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Nama dan URL wajib diisi' }));
            return;
          }
          const result = musicStore.addPlaylist({ name, url: plUrl, aliases });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'DELETE' && url.pathname === '/api/playlists/song') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { playlistId, songId } = JSON.parse(body);
          if (!playlistId || !songId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing playlistId or songId' }));
            return;
          }
          const pl = musicStore.getPlaylistById(playlistId);
          if (!pl || !musicStore.isLocalPlaylist(pl)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Playlist lokal tidak ditemukan' }));
            return;
          }
          const removed = musicStore.removeSongsFromPlaylist(pl, s => s.id === songId || s.url === songId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, removedCount: removed.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }



    if (req.method === 'DELETE' && url.pathname === '/api/playlists') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id' }));
            return;
          }
          const result = musicStore.removePlaylist(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // ===== SFX Audio API =====
    if (req.method === 'GET' && url.pathname === '/api/sfx') {
      const info = sfxStore.getSfxInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ loaded: Boolean(info), sfx: info }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sfx') {
      const chunks = [];
      let totalLength = 0;
      const MAX_SIZE = 50 * 1024 * 1024; // 50MB
      let tooLarge = false;

      req.on('data', chunk => {
        totalLength += chunk.length;
        if (totalLength > MAX_SIZE && !tooLarge) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File terlalu besar (maksimal 50MB)' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (tooLarge) return;
        try {
          const buffer = Buffer.concat(chunks);
          const contentType = req.headers['content-type'] || '';
          let fileBuffer = buffer;
          let fileName = 'audio.mp3';

          if (contentType.includes('application/json')) {
            const parsed = JSON.parse(buffer.toString('utf8'));
            if (!parsed.data) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing audio data' }));
              return;
            }
            fileBuffer = Buffer.from(parsed.data, 'base64');
            if (parsed.name) fileName = parsed.name;
          } else {
            const rawHeader = req.headers['x-file-name'];
            if (rawHeader) {
              try { fileName = decodeURIComponent(rawHeader); } catch (_) { fileName = rawHeader; }
            }
          }

          const sfxInfo = sfxStore.saveSfxFile(fileBuffer, fileName);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sfx: sfxInfo }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Gagal memproses file' }));
        }
      });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/sfx') {
      const result = sfxStore.deleteSfx();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/sfx/stream') {
      if (!sfxStore.hasSfx()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('SFX not found');
        return;
      }

      const filePath = sfxStore.getSfxFilePath();
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('SFX file not found');
        return;
      }

      const mimeType = sfxStore.getMimeType(filePath);
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        if (isNaN(start) || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
        const chunkSize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.on('error', (e) => console.error('[SERVER] HTTP error:', e.message));
  server.listen(port, () => {
    console.log(`Callista controller listening at http://localhost:${port}`);
  });

  return server;
}

module.exports = {
  startServer
};
