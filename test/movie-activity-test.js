'use strict';

const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { WebSocket } = require('ws');

const movieActivity = require('../src/movieActivity');
const { startServer } = require('../src/server');

console.log('--- Testing Callista Movie Player & Activity Integration ---');

// 1. Test Config Loading
console.log('Checking config loading and route detection...');
const cfg = movieActivity.loadConfig();
assert.ok(cfg.domainDrama, 'domainDrama harus ada');
assert.ok(cfg.domainAnime, 'domainAnime harus ada');

assert.strictEqual(movieActivity.isMovieRoute('/'), true);
assert.strictEqual(movieActivity.isMovieRoute('/anime-embed'), true);
assert.strictEqual(movieActivity.isMovieRoute('/api/movie/settings'), true);
assert.strictEqual(movieActivity.isMovieRoute('/settings'), false);
assert.strictEqual(movieActivity.isMovieRoute('/api/config'), false);

// 2. Test Server Endpoints
async function runHttpTests() {
  console.log('Starting test server on ephemeral port...');
  const testPort = 39210;
  const server = startServer(testPort);

  function get(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${testPort}${urlPath}`, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
  }

  try {
    // Test A: GET / (Kamar Callista Home Page)
    console.log('Testing GET / (Kamar Callista & Activity Mode button)...');
    const resHome = await get('/');
    assert.strictEqual(resHome.status, 200);
    assert.ok(resHome.body.includes('Kamar Callista'), 'Harus menampilkan judul Kamar Callista');
    assert.ok(resHome.body.includes('Mode Activity (Nobar VC)'), 'Harus memiliki tombol Mode Activity');
    assert.ok(resHome.body.includes('/settings'), 'Harus memiliki link ke Dashboard Bot Callista');

    // Test B: GET /settings (Callista Dashboard)
    console.log('Testing GET /settings (Dashboard Bot Callista)...');
    const resSettings = await get('/settings');
    assert.strictEqual(resSettings.status, 200);
    assert.ok(resSettings.body.includes('Callista Control Center'), 'Harus menampilkan dashboard Callista Control Center');
    assert.ok(resSettings.body.includes('Kamar & Nobar'), 'Dashboard harus memiliki shortcut ke Kamar & Nobar');

    // Test C: GET /assets/tittle.png
    console.log('Testing static asset serving /assets/tittle.png...');
    const resAsset = await get('/assets/tittle.png');
    assert.strictEqual(resAsset.status, 200);
    assert.strictEqual(resAsset.headers['content-type'], 'image/png');

    // Test D: GET /api/movie/settings
    console.log('Testing GET /api/movie/settings...');
    const resMovieSettings = await get('/api/movie/settings');
    assert.strictEqual(resMovieSettings.status, 200);
    const parsedCfg = JSON.parse(resMovieSettings.body);
    assert.strictEqual(parsedCfg.domainDrama, cfg.domainDrama);

    // Test E: WebSocket Nobar VC Sync
    console.log('Testing WebSocket realtime sync (/ws/activity)...');
    await new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:${testPort}/ws/activity?room=test-room-vc`;
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);

      let client2ReceivedReaction = false;

      client2.on('message', (msg) => {
        const data = JSON.parse(msg.toString());
        if (data.type === 'REACTION' && data.emoji === '🍿') {
          client2ReceivedReaction = true;
          client1.close();
          client2.close();
          resolve();
        }
      });

      client1.on('open', () => {
        client2.on('open', () => {
          // Client 1 sends reaction
          client1.send(JSON.stringify({ type: 'REACTION', emoji: '🍿' }));
        });
      });

      setTimeout(() => {
        if (!client2ReceivedReaction) {
          client1.close();
          client2.close();
          reject(new Error('WebSocket sync reaction timeout'));
        }
      }, 3000);
    });
    console.log('WebSocket sync verified successfully!');

  } finally {
    server.close();
  }
}

module.exports = runHttpTests;

if (require.main === module) {
  runHttpTests().then(() => {
    console.log('All Movie Player & Activity integration tests passed successfully!');
  }).catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}
