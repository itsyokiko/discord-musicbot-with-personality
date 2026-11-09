#!/usr/bin/env node
/**
 * Impor cookies YouTube untuk mengatasi "Sign in to confirm you're not a bot"
 * atau error 429 dari YouTube.
 *
 * Pemakaian:
 *   node scripts/import-youtube-cookies.js path\ke\cookies.txt
 *   node scripts/import-youtube-cookies.js path\ke\cookies.json
 *
 * Format .txt yang didukung: Netscape cookies.txt
 * (bisa diekspor dari ekstensi browser "Get cookies.txt LOCALLY").
 *
 * Hasil disimpan ke data/youtube_cookies.json dan otomatis dipakai bot
 * saat restart.
 */

const fs = require('node:fs');
const path = require('node:path');

const INPUT = process.argv[2];
const OUTPUT = path.resolve(__dirname, '../data/youtube_cookies.json');

if (!INPUT) {
  console.error('Pemakaian: node scripts/import-youtube-cookies.js <cookies.txt|cookies.json>');
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), INPUT);
if (!fs.existsSync(inputPath)) {
  console.error('File tidak ditemukan:', inputPath);
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8').trim();

let cookies = [];

if (raw.startsWith('[') || raw.startsWith('{')) {
  // Sudah JSON
  const parsed = JSON.parse(raw);
  cookies = Array.isArray(parsed) ? parsed : parsed.cookies || [];
} else {
  // Netscape cookies.txt
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine;
    let httpOnly = false;

    // Baris HttpOnly di Netscape diawali "#HttpOnly_"
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (!line || line.startsWith('#')) {
      continue;
    }

    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domain, flag, cookiePath, secure, expiration, name, value] = parts;

    // ytdl-core memasang cookie ke https://www.youtube.com, jadi cookie
    // domain .google.com akan membuat createAgent() error. Simpan yang
    // domainnya youtube.com saja (YouTube menyimpan salinan cookie login
    // di domain .youtube.com).
    if (!/(^|\.)youtube\.com$/i.test(domain)) continue;

    cookies.push({
      name,
      value,
      domain,
      path: cookiePath || '/',
      secure: secure === 'TRUE',
      httpOnly: httpOnly || flag === 'TRUE',
      expirationDate: Number(expiration) || undefined,
    });
  }
}

if (!cookies.length) {
  console.error(
    'Tidak ada cookie domain youtube.com yang ditemukan. ' +
      'Pastikan kamu mengekspor cookies saat sedang membuka youtube.com (bukan google.com).'
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(cookies, null, 2), 'utf8');

console.log(`✅ ${cookies.length} cookie YouTube disimpan ke ${OUTPUT}`);
console.log('   Restart bot (npm start) agar cookies dipakai.');
console.log('   Penting: jangan bagikan file ini — isinya sesi login akun YouTube.');
