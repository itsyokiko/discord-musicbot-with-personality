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
    console.log('Testing GET / (Kamar Callista Home Page)...');
    const resHome = await get('/');
    assert.strictEqual(resHome.status, 200);
    assert.ok(resHome.body.includes('Kamar Callista'), 'Harus menampilkan judul Kamar Callista');
    // Tombol Mode Activity dihapus dari kamar home (auto-detect only via Discord env)
    assert.ok(!resHome.body.includes('btn-activity-portal'), 'Tombol Mode Activity tidak boleh ada di kamar home web biasa');
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
    assert.strictEqual(resAsset.headers['access-control-allow-origin'], '*', 'Asset harus punya CORS header');

    // Test D1: GET /image-proxy (tanpa url = 400)
    console.log('Testing GET /image-proxy (no url = 400)...');
    const resImgProxyNoUrl = await get('/image-proxy');
    assert.strictEqual(resImgProxyNoUrl.status, 400, '/image-proxy tanpa url harus 400');

    // Test D2: GET /api/movie/settings
    console.log('Testing GET /api/movie/settings...');
    const resMovieSettings = await get('/api/movie/settings');
    assert.strictEqual(resMovieSettings.status, 200);
    const parsedCfg = JSON.parse(resMovieSettings.body);
    assert.strictEqual(parsedCfg.domainDrama, cfg.domainDrama);

    // Test E: WebSocket Nobar VC Sync (Host & Viewer Navigation)
    console.log('Testing WebSocket realtime sync (/ws/activity)...');
    await new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:${testPort}/ws/activity?room=test-room-vc`;
      const client1 = new WebSocket(wsUrl);
      let client2 = null;

      let client1IsHost = false;
      let client2ReceivedNav = false;

      client1.on('message', (msg) => {
        const data = JSON.parse(msg.toString());
        if (data.type === 'INIT_STATE') {
          client1IsHost = data.isHost;
          assert.strictEqual(client1IsHost, true, 'Client 1 harus menjadi Host');
          
          // Setelah client 1 jadi host, koneksikan client 2 (Viewer)
          client2 = new WebSocket(wsUrl);
          client2.on('message', (msg2) => {
            const data2 = JSON.parse(msg2.toString());
            if (data2.type === 'INIT_STATE') {
              assert.strictEqual(data2.isHost, false, 'Client 2 harus menjadi Viewer/ReadOnly');
              // Host kirim perpindahan rute tayangan
              client1.send(JSON.stringify({
                type: 'HOST_NAVIGATE',
                route: '/?mode=anime&url=test-anime-eps-1',
                title: 'Anime Keren Episode 1'
              }));
            } else if (data2.type === 'NAVIGATE_TO') {
              assert.strictEqual(data2.route, '/?mode=anime&url=test-anime-eps-1');
              assert.strictEqual(data2.title, 'Anime Keren Episode 1');
              client2ReceivedNav = true;
              client1.close();
              client2.close();
              resolve();
            }
          });
        }
      });

      setTimeout(() => {
        if (!client2ReceivedNav) {
          if (client1) client1.close();
          if (client2) client2.close();
          reject(new Error('WebSocket sync host navigation timeout'));
        }
      }, 4000);
    });
    console.log('WebSocket sync & Host-Viewer auto-follow verified successfully!');

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
