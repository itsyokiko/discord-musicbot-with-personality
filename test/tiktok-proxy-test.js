/**
 * Cek lokal untuk proxy stream TikTok (src/tiktokPlugin.js).
 *
 * Mensimulasikan CDN TikTok yang memutus koneksi di tengah file (kasus nyata:
 * video panjang berhenti di menit awal karena CDN menutup koneksi, lalu ffmpeg
 * melihat EOF dan menganggap lagu selesai). Proxy harus menyambung ulang dari
 * byte terakhir dan meneruskan HTTP Range dengan benar.
 *
 * Jalankan: node test/tiktok-proxy-test.js
 */

const assert = require('node:assert');
const http = require('node:http');
const { __test } = require('../src/tiktokPlugin');

const SIZE = 4 * 1024 * 1024;
const CAP = 1024 * 1024; // tiap koneksi cuma boleh 1 MB, lalu diputus
const ORIGIN = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) ORIGIN[i] = i % 251;

const originRanges = [];
const origin = http.createServer((req, res) => {
  const m = /^bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = m ? Number(m[1]) : 0;
  const reqEnd = m && m[2] ? Number(m[2]) : SIZE - 1;
  const end = Math.min(reqEnd, SIZE - 1);
  originRanges.push(start);

  const slice = ORIGIN.subarray(start, end + 1);
  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': String(slice.length),
    'Content-Range': `bytes ${start}-${end}/${SIZE}`,
    'Accept-Ranges': 'bytes',
  });

  let sent = 0;
  const step = 64 * 1024;
  const pump = () => {
    while (sent < slice.length && sent < CAP) {
      const to = Math.min(sent + step, slice.length, CAP);
      const chunk = slice.subarray(sent, to);
      sent = to;
      if (sent >= slice.length) { res.end(chunk); return; }
      if (sent >= CAP) { res.write(chunk, () => res.destroy()); return; } // CDN memutus koneksi
      if (!res.write(chunk)) { res.once('drain', pump); return; }
    }
  };
  pump();
});

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const originPort = origin.address().port;

  assert.deepStrictEqual(__test.parseRange('bytes=123-'), { start: 123, end: null });
  assert.deepStrictEqual(__test.parseRange('bytes=123-456'), { start: 123, end: 456 });
  assert.deepStrictEqual(__test.parseRange('bytes=0-'), { start: 0, end: null });
  assert.deepStrictEqual(__test.parseRange(undefined), { start: 0, end: null });
  console.log('ok   parseRange');

  __test.proxyTokens.set('test-token', {
    pageUrl: `http://127.0.0.1:${originPort}/video`,
    info: { streamUrl: `http://127.0.0.1:${originPort}/video`, cookies: '' },
    at: Date.now(),
  });

  const proxyPort = await __test.ensureProxy();
  const proxyUrl = `http://127.0.0.1:${proxyPort}/test-token`;

  // 1) Request penuh: harus dapat 4 MB walau CDN memutus tiap 1 MB.
  const full = await get(proxyUrl, { Range: 'bytes=0-' });
  assert.strictEqual(full.status, 200, `status ${full.status}`);
  assert.strictEqual(full.body.length, SIZE, `panjang body ${full.body.length}`);
  assert.ok(full.body.equals(ORIGIN), 'isi body tidak sama dengan aslinya');
  assert.ok(originRanges.length >= 4, `harus ada resume, tapi cuma ${originRanges.length} request`);
  assert.deepStrictEqual(originRanges.slice(1), [CAP, CAP * 2, CAP * 3], 'offset resume salah');
  console.log(`ok   full stream 4 MB via ${originRanges.length} koneksi`);

  // 2) Range terbuka dari ffmpeg: 206 + Content-Range + sisa file.
  originRanges.length = 0;
  const offset = 1024 * 1024;
  const part = await get(proxyUrl, { Range: `bytes=${offset}-` });
  assert.strictEqual(part.status, 206, `status ${part.status}`);
  assert.strictEqual(part.headers['content-range'], `bytes ${offset}-${SIZE - 1}/${SIZE}`);
  assert.strictEqual(part.body.length, SIZE - offset);
  assert.ok(part.body.equals(ORIGIN.subarray(offset)), 'isi range tidak sama');
  console.log('ok   range terbuka 206 + Content-Range');

  // 3) Range tertutup (ffmpeg baca atom moov di akhir MP4): harus dipotong pas.
  originRanges.length = 0;
  const from = SIZE - 4096;
  const to = SIZE - 1;
  const tail = await get(proxyUrl, { Range: `bytes=${from}-${to}` });
  assert.strictEqual(tail.status, 206, `status ${tail.status}`);
  assert.strictEqual(tail.headers['content-range'], `bytes ${from}-${to}/${SIZE}`);
  assert.strictEqual(tail.body.length, to - from + 1);
  assert.ok(tail.body.equals(ORIGIN.subarray(from, to + 1)), 'isi tail tidak sama');
  console.log('ok   range tertutup dipotong tepat');

  console.log('ALL PASS');
  origin.close();
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message);
  origin.close();
  process.exit(1);
});
